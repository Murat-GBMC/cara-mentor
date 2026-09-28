// api/_lib/quota.js — CARA monthly fair-use limits (v11)
//
// Storage: Upstash Redis over its REST API (plain fetch, no npm dependency).
// Files under api/_lib are not exposed as routes by Vercel.
//
// What is enforced, per user and per calendar month (Europe/Istanbul time):
//   • message count   (CARA_LIMIT_<TIER>_MESSAGES)
//   • token budget    (CARA_LIMIT_<TIER>_TOKENS — real OpenAI usage, incl. file_search and PDF reading)
//   • per-minute rate (CARA_RATE_PER_MINUTE)
//   • optional global monthly token ceiling across all users (CARA_GLOBAL_MONTHLY_TOKENS)
// Tiers: coe, pdu, default (no/unknown platform), anon (no user id in the iframe URL).
// A limit of 0 means "no limit" for that dimension.
//
// Identity: the iframe URL carries ?uid=<LearnWorlds user id>. If LW_API_BASE, LW_CLIENT_ID and
// LW_ACCESS_TOKEN are set, each new uid is checked against the LearnWorlds API once (cached),
// so made-up ids cannot be used to get fresh quota.
//
// Fail-open: if Redis is not configured or unreachable, CARA keeps working and the error is logged.

const TZ_OFFSET_HOURS = 3;              // Europe/Istanbul is UTC+3 all year (no DST since 2016)
const MONTH_TTL = 40 * 24 * 3600;       // monthly counters expire on their own

function envInt(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

function config() {
  return {
    enabled: String(process.env.CARA_QUOTA_ENABLED ?? 'true').toLowerCase() !== 'false',
    requireUser: String(process.env.CARA_REQUIRE_USER || 'false').toLowerCase() === 'true',
    ratePerMinute: envInt('CARA_RATE_PER_MINUTE', 8),
    warnPct: envInt('CARA_WARN_PCT', 80),
    globalTokens: envInt('CARA_GLOBAL_MONTHLY_TOKENS', 0),
    tiers: {
      coe:     { messages: envInt('CARA_LIMIT_COE_MESSAGES', 200),     tokens: envInt('CARA_LIMIT_COE_TOKENS', 3000000) },
      pdu:     { messages: envInt('CARA_LIMIT_PDU_MESSAGES', 100),     tokens: envInt('CARA_LIMIT_PDU_TOKENS', 1500000) },
      default: { messages: envInt('CARA_LIMIT_DEFAULT_MESSAGES', 100), tokens: envInt('CARA_LIMIT_DEFAULT_TOKENS', 1500000) },
      anon:    { messages: envInt('CARA_LIMIT_ANON_MESSAGES', 20),     tokens: envInt('CARA_LIMIT_ANON_TOKENS', 200000) }
    }
  };
}

// ── Redis (Upstash REST) ──────────────────────────────────────────────────
function redisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redis(commands) {
  const c = redisCreds();
  const r = await fetch(`${c.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  const out = await r.json();
  return out.map(x => {
    if (x && x.error) throw new Error(`Redis: ${x.error}`);
    return x ? x.result : null;
  });
}

// ── Period & identity ─────────────────────────────────────────────────────
export function period(now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 3600e3);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
    resetAt: new Date(Date.UTC(y, m + 1, 1) - TZ_OFFSET_HOURS * 3600e3).toISOString()
  };
}

export function resolveUser(req, body) {
  const raw = String(body?.uid || '').trim().toLowerCase();
  // Rejects empty values and unresolved placeholders such as {{USER.ID}}
  if (/^[a-z0-9@._+\-]{1,128}$/.test(raw)) return { key: `u:${raw}`, uid: raw, anon: false };
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket?.remoteAddress || 'unknown';
  return { key: `ip:${ip}`, uid: '', anon: true };
}

function keys(user, p) {
  return {
    msg:  `cara:m:${p.key}:${user.key}`,
    tok:  `cara:t:${p.key}:${user.key}`,
    glob: `cara:g:${p.key}`,
    rate: `cara:r:${user.key}:${Math.floor(Date.now() / 60000)}`
  };
}

// ── Optional LearnWorlds user verification ────────────────────────────────
async function verifyLearnWorldsUser(uid) {
  const base = process.env.LW_API_BASE;
  const client = process.env.LW_CLIENT_ID;
  const token = process.env.LW_ACCESS_TOKEN;
  if (!base || !client || !token) return true; // verification not configured

  const cacheKey = `cara:lw:${uid}`;
  const [cached] = await redis([['GET', cacheKey]]);
  if (cached === '1') return true;
  if (cached === '0') return false;

  let ok;
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/v2/users/${encodeURIComponent(uid)}`, {
      headers: { 'Lw-Client': client, Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (r.ok) ok = true;
    else if (r.status === 404) ok = false;
    else { console.error('LearnWorlds verify: HTTP', r.status, '— allowing'); return true; }
  } catch (e) {
    console.error('LearnWorlds verify error — allowing:', e.message);
    return true;
  }
  await redis([['SET', cacheKey, ok ? '1' : '0', 'EX', ok ? 30 * 86400 : 3600]]);
  return ok;
}

// ── Public API ────────────────────────────────────────────────────────────
function tierFor(cfg, user, platform) {
  if (user.anon) return cfg.tiers.anon;
  return cfg.tiers[platform] || cfg.tiers.default;
}

function buildStatus(cfg, tier, p, { blocked = false, reason = null, msgs = 0, toks = 0 } = {}) {
  const pm = tier.messages ? msgs / tier.messages : 0;
  const pt = tier.tokens ? toks / tier.tokens : 0;
  const pct = Math.min(100, Math.round(Math.max(pm, pt) * 100));
  return {
    enabled: true,
    blocked,
    reason,
    messagesUsed: msgs,
    messagesLimit: tier.messages,
    pct,
    warn: !blocked && cfg.warnPct > 0 && pct >= cfg.warnPct,
    resetAt: p.resetAt
  };
}

/**
 * Check the user's quota and (optionally) count this request.
 *   opts.rate         — count toward the per-minute rate limit
 *   opts.countMessage — count one message toward the monthly message limit
 * Returns a status object; status.blocked === true means: do not call OpenAI.
 */
export async function checkQuota(req, body, platform, opts = {}) {
  const cfg = config();
  if (!cfg.enabled) return { enabled: false, blocked: false };
  if (!redisCreds()) {
    console.warn('Quota: Upstash Redis env vars not set — limits are NOT enforced');
    return { enabled: false, blocked: false };
  }

  const user = resolveUser(req, body);
  const tier = tierFor(cfg, user, platform);
  const p = period();

  try {
    if (user.anon && cfg.requireUser) return buildStatus(cfg, tier, p, { blocked: true, reason: 'no_user' });
    if (!user.anon && !(await verifyLearnWorldsUser(user.uid))) {
      return buildStatus(cfg, tier, p, { blocked: true, reason: 'unverified' });
    }

    const k = keys(user, p);
    const cmds = [['GET', k.msg], ['GET', k.tok], ['GET', k.glob]];
    if (opts.rate) cmds.push(['INCR', k.rate], ['EXPIRE', k.rate, 120]);
    const out = await redis(cmds);
    let msgs = parseInt(out[0] || '0', 10);
    const toks = parseInt(out[1] || '0', 10);
    const glob = parseInt(out[2] || '0', 10);

    if (opts.rate && cfg.ratePerMinute && out[3] > cfg.ratePerMinute) {
      return buildStatus(cfg, tier, p, { blocked: true, reason: 'rate', msgs, toks });
    }
    if (cfg.globalTokens && glob >= cfg.globalTokens) {
      console.error(`Quota: GLOBAL monthly token ceiling reached (${glob}/${cfg.globalTokens})`);
      return buildStatus(cfg, tier, p, { blocked: true, reason: 'global', msgs, toks });
    }
    if (tier.tokens && toks >= tier.tokens) return buildStatus(cfg, tier, p, { blocked: true, reason: 'tokens', msgs, toks });
    if (tier.messages && msgs >= tier.messages) return buildStatus(cfg, tier, p, { blocked: true, reason: 'messages', msgs, toks });

    if (opts.countMessage) {
      const [n] = await redis([['INCR', k.msg], ['EXPIRE', k.msg, MONTH_TTL]]);
      if (tier.messages && n > tier.messages) {           // lost a race with a parallel request
        await redis([['DECR', k.msg]]);
        return buildStatus(cfg, tier, p, { blocked: true, reason: 'messages', msgs: tier.messages, toks });
      }
      msgs = n;
    }
    return buildStatus(cfg, tier, p, { msgs, toks });
  } catch (e) {
    console.error('Quota check failed — allowing request:', e.message);
    return { enabled: false, blocked: false, error: true };
  }
}

/** Add real OpenAI token usage to the user's and the global monthly counters (once per dedupeId). */
export async function recordTokens(req, body, tokens, dedupeId) {
  const cfg = config();
  tokens = Math.max(0, Math.round(Number(tokens) || 0));
  if (!cfg.enabled || !redisCreds() || !tokens) return;
  try {
    const user = resolveUser(req, body);
    const k = keys(user, period());
    if (dedupeId) {
      const [ok] = await redis([['SET', `cara:c:${dedupeId}`, '1', 'NX', 'EX', 3 * 86400]]);
      if (ok !== 'OK') return; // already counted
    }
    await redis([
      ['INCRBY', k.tok, tokens], ['EXPIRE', k.tok, MONTH_TTL],
      ['INCRBY', k.glob, tokens], ['EXPIRE', k.glob, MONTH_TTL]
    ]);
  } catch (e) {
    console.error('Quota: recording tokens failed:', e.message);
  }
}
