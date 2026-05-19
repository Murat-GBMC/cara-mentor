export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const ASSISTANT_ID   = process.env.ASSISTANT_ID;
  const SHEET_ID       = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL   = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY    = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const { action, threadId, message, runId, language, sessionId, fileId } = req.body;

  const openaiHeaders = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  // ── Google Sheets JWT auth ──────────────────────────────────────────────────
  async function getGoogleToken() {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header  = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now
    };
    const unsigned = `${b64(header)}.${b64(payload)}`;
    const crypto = (await import('node:crypto')).default;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const signature = sign.sign(PRIVATE_KEY, 'base64url');
    const jwt = `${unsigned}.${signature}`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const td = await tokenRes.json();
    return td.access_token;
  }

  async function logToSheet(sid, lang, msg) {
    try {
      const token = await getGoogleToken();
      const row = [new Date().toISOString(), sid || 'unknown', lang || 'unknown', msg];
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:D:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        }
      );
    } catch (e) { console.error('Sheet log error:', e.message); }
  }

  try {

    if (action === 'createThread') {
      const r = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST', headers: openaiHeaders, body: JSON.stringify({})
      });
      return res.status(200).json(await r.json());
    }

    if (action === 'uploadFile') {
      const { fileData, fileName, fileType } = req.body;
      if (!fileData || !fileName) return res.status(400).json({ error: 'Missing file' });
      const buffer = Buffer.from(fileData, 'base64');
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const disposition = `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${fileType || 'application/octet-stream'}\r\n\r\n`;
      const purposePart = `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nassistants\r\n`;
      const filePart = `--${boundary}\r\n${disposition}`;
      const closing = `\r\n--${boundary}--`;
      const body = Buffer.concat([
        Buffer.from(purposePart),
        Buffer.from(filePart),
        buffer,
        Buffer.from(closing)
      ]);
      const r = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      });
      return res.status(200).json(await r.json());
    }

    if (action === 'addMessage') {
      // Log to sheet — skip language instruction messages
      const isSystemMsg = message && (
        message.includes('MUST respond exclusively') ||
        message.includes('يجب عليك الرد') ||
        message.includes('Vous DEVEZ') ||
        message.includes('ESCLUSIVAMENTE') ||
        message.includes('仅使用中文')
      );
      if (!isSystemMsg && message) {
        logToSheet(sessionId, language, message);
      }
      const msgBody = { role: 'user', content: message };
      if (fileId) {
        msgBody.attachments = [{ file_id: fileId, tools: [{ type: 'file_search' }] }];
      }
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST', headers: openaiHeaders, body: JSON.stringify(msgBody)
      });
      return res.status(200).json(await r.json());
    }

    if (action === 'runAssistant') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
        method: 'POST', headers: openaiHeaders,
        body: JSON.stringify({ assistant_id: ASSISTANT_ID })
      });
      return res.status(200).json(await r.json());
    }

    if (action === 'getRunStatus') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: openaiHeaders
      });
      return res.status(200).json(await r.json());
    }

    if (action === 'getMessages') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=1`, {
        headers: openaiHeaders
      });
      return res.status(200).json(await r.json());
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
