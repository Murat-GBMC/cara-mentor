// Increase body size limit for file uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  }
};

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

  const body = req.body;
  const { action, threadId, message, runId, language, sessionId, fileId } = body;

  const openaiHeaders = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  // ── Google Sheets logging ───────────────────────────────────────────────────
  async function getGoogleToken() {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now
    })}`;
    const { createSign } = await import('node:crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(unsigned);
    const jwt = `${unsigned}.${sign.sign(PRIVATE_KEY, 'base64url')}`;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    return (await r.json()).access_token;
  }

  async function logToSheet(sid, lang, msg) {
    try {
      const token = await getGoogleToken();
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:D:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[new Date().toISOString(), sid || '', lang || '', msg]] })
        }
      );
    } catch (e) { console.error('Sheet log error:', e.message); }
  }

  try {

    // ── Create thread ───────────────────────────────────────────────────────
    if (action === 'createThread') {
      const r = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST', headers: openaiHeaders, body: JSON.stringify({})
      });
      return res.status(200).json(await r.json());
    }

    // ── Upload file ─────────────────────────────────────────────────────────
    if (action === 'uploadFile') {
      const { fileData, fileName, fileType } = body;
      if (!fileData || !fileName) return res.status(400).json({ error: 'Missing file data' });

      console.log('Uploading file:', fileName, 'type:', fileType, 'size:', fileData.length);

      const fileBuffer = Buffer.from(fileData, 'base64');
      const boundary = '----VercelFormBoundary' + Math.random().toString(16).slice(2);
      const CRLF = '\r\n';

      const parts = [];
      // Purpose part
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="purpose"${CRLF}${CRLF}` +
        `assistants${CRLF}`
      ));
      // File part
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${fileType || 'application/octet-stream'}${CRLF}${CRLF}`
      ));
      parts.push(fileBuffer);
      parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));

      const formBody = Buffer.concat(parts);
      console.log('Form body size:', formBody.length, 'bytes');

      const uploadRes = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formBody
      });

      const uploadData = await uploadRes.json();
      console.log('OpenAI upload response status:', uploadRes.status);
      console.log('OpenAI upload response:', JSON.stringify(uploadData));

      if (!uploadRes.ok) {
        return res.status(400).json({ error: uploadData.error?.message || 'Upload failed', details: uploadData });
      }
      return res.status(200).json(uploadData);
    }

    // ── Add message ─────────────────────────────────────────────────────────
    if (action === 'addMessage') {
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

    // ── Run assistant ───────────────────────────────────────────────────────
    if (action === 'runAssistant') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
        method: 'POST', headers: openaiHeaders,
        body: JSON.stringify({ assistant_id: ASSISTANT_ID })
      });
      return res.status(200).json(await r.json());
    }

    // ── Poll run status ─────────────────────────────────────────────────────
    if (action === 'getRunStatus') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: openaiHeaders
      });
      return res.status(200).json(await r.json());
    }

    // ── Get messages ────────────────────────────────────────────────────────
    if (action === 'getMessages') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=1`, {
        headers: openaiHeaders
      });
      return res.status(200).json(await r.json());
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
