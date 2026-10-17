# CARA RM-1: authenticated LearnWorlds launch

Permanent content URL: https://cara-mentor.vercel.app/api/risk-workshop
Login initiation: https://cara-mentor.vercel.app/api/risk-lti-login
Launch/redirect URI: https://cara-mentor.vercel.app/api/risk-lti-launch
JWKS: https://cara-mentor.vercel.app/api/risk-keys
Deep Linking: not implemented; leave blank. Grade return: not implemented.

Register under LearnWorlds Settings → Integrations → LTI Tools.
Then set RM1_LTI_PLATFORM (server-only JSON) with issuer, clientId,
deploymentId, authorizationUrl, jwksUrl; optionally allowedContextIds.
All platform URLs are allowlisted to HTTPS LearnWorlds domains. No automatic registration.
If school-generated URLs use another official domain, review and add that exact host explicitly.

Use a non-graded Multimedia → LTI activity, content link above. Ordinary HTML
embedding does not prove a LearnWorlds session. No API secret belongs in HTML.
Existing LearnWorlds authentication, main CARA chat and other cases are unchanged.

Server requirements: OPENAI_API_KEY, RM1_CASE_JSON, RM1_GUIDE_JSON,
RM1_TOOL_PRIVATE_JWK, KV_REST_API_URL, KV_REST_API_TOKEN.
Case and rubric JSON stay in private Vercel environment values; never commit them.

Flow: registered issuer → browser-bound 5 minute state+nonce → RS256 verified launch
(issuer/audience/azp/nonce/expiry/deployment/resource/role/target) → 2 hour random
session in Redis → bearer-authenticated CARA requests. User existence alone is not auth.
State is consumed atomically. Session and rate records use a hashed platform subject,
not name/email. No participant answers are persisted on the server in this version.
Browser drafts are keyed by verified subject hash. No background cross-device sync.
Third party/partitioned cookies are needed for login CSRF binding; launch in a new
window if the browser blocks the binding. No cookie-check bypass or URL session tokens.

Names: signed custom cf_certification_name takes precedence, then signed full name.
Optional school API enrichment is attempted only if the signed subject matches the
returned school user id exactly. No lookup by a browser-provided name, email or uid.
Display data is not sent to the model; participant-written answers may contain names.

Tests: node --test test/rm-auth.test.mjs. Synthetic issuer keys only. Live school
handshake needs the actual school-generated registration data. No LTI certification claimed.
