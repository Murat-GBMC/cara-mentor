// CARA backend — v10 (Responses API + Conversations API)
// Replaces the Assistants API version (retired by OpenAI on 26 Aug 2026).
// The frontend (index.html) is unchanged: it still calls the same actions
// createThread → addMessage → runAssistant → getRunStatus (poll) → getMessages.
//
// Required Vercel environment variables:
//   OPENAI_API_KEY      (existing)
//   VECTOR_STORE_ID     (NEW — the vs_... ID of CARA's knowledge base)
//   GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY   (existing, for logging)
// Optional:
//   CARA_PROMPT_ID      (a pmpt_... ID if you saved CARA's instructions as a Prompt in the OpenAI dashboard)
//   OPENAI_MODEL        (default: gpt-4o)
// If CARA_PROMPT_ID is not set, CARA's instructions are read from api/instructions.js.

import { CARA_INSTRUCTIONS } from './instructions.js';

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

  const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
  const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;
  const PROMPT_ID       = process.env.CARA_PROMPT_ID;
  const MODEL           = process.env.OPENAI_MODEL || 'gpt-4o';
  const SHEET_ID        = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL    = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY     = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const body = req.body || {};
  const { action, threadId, message, runId, language, sessionId } = body;

  const openaiHeaders = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };

  // ── OpenAI helper: throws with the real API error message so it shows in Vercel logs ──
  async function openai(path, method = 'GET', payload) {
    const r = await fetch(`https://api.openai.com/v1${path}`, {
      method,
      headers: openaiHeaders,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      console.error(`OpenAI ${method} ${path} failed:`, msg);
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  // ── Google Sheets logging (unchanged from v9) ───────────────────────────
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

  async function logToSheet(sid, lang, msg, answer = '') {
    try {
      if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
        console.error('Sheet logging: missing env vars', { SHEET_ID: !!SHEET_ID, CLIENT_EMAIL: !!CLIENT_EMAIL, PRIVATE_KEY: !!PRIVATE_KEY });
        return;
      }
      const token = await getGoogleToken();
      if (!token) { console.error('Sheet logging: failed to get token'); return; }

      const responseLength = answer ? answer.length : '';

      const unansweredPhrases = [
        "i don't have information",
        "i couldn't find",
        "i don't know",
        "i'm not sure",
        "no information available",
        "not covered in",
        "outside the scope",
        "i cannot find",
        "i was unable to find",
        "bu konuda bilgim yok",
        "bulamadım",
        "bilgi bulunamadı"
      ];
      const answeredFlag = answer
        ? (unansweredPhrases.some(p => answer.toLowerCase().includes(p)) ? 'No' : 'Yes')
        : '';

      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[
            new Date().toISOString(),  // Timestamp
            sid || '',                 // Session ID
            lang || '',                // Language
            msg || '',                 // Question
            answer || '',              // CARA's Answer
            answeredFlag,              // Answered? (Yes/No)
            responseLength             // Response Length (chars)
          ]] })
        }
      );
      const sheetData = await sheetRes.json();
      if (!sheetRes.ok) {
        console.error('Sheet log failed:', JSON.stringify(sheetData));
      } else {
        console.log('Sheet log success:', sheetData.updates?.updatedRange);
      }
    } catch (e) { console.error('Sheet log error:', e.message); }
  }

  // ── File text extraction ────────────────────────────────────────────────
  async function extractTextFromFile(fileData, fileName, fileType) {
    const base64 = fileData;

    if (fileType === 'application/pdf') {
      // Responses API reads PDFs natively via input_file
      const data = await openai('/responses', 'POST', {
        model: MODEL,
        max_output_tokens: 4000,
        input: [{
          role: 'user',
          content: [
            { type: 'input_file', filename: fileName || 'document.pdf', file_data: `data:application/pdf;base64,${base64}` },
            { type: 'input_text', text: 'Please extract and return ALL the text content from this document. Return the text as-is, preserving structure. Do not summarize - return the actual content.' }
          ]
        }]
      });
      return outputText(data) || null;
    }

    if (fileType === 'text/plain' || fileType === 'text/markdown' || fileType === 'text/csv') {
      const buffer = Buffer.from(base64, 'base64');
      return buffer.toString('utf-8').slice(0, 15000);
    }

    if (fileType === 'application/msword' ||
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        const buffer = Buffer.from(base64, 'base64');
        const str = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
        const textMatches = str.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
        if (textMatches.length > 0) {
          return textMatches
            .map(m => m.replace(/<[^>]+>/g, ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 15000);
        }
        const readable = str.replace(/[^\x20-\x7E\n\r\t]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        return readable.length > 100 ? readable : null;
      } catch (e) {
        console.error('Word extraction error:', e.message);
        return null;
      }
    }

    return null;
  }

  // ── Helpers for Responses API output ────────────────────────────────────
  function outputText(resp) {
    const parts = [];
    for (const item of resp?.output || []) {
      if (item.type === 'message' && item.role === 'assistant') {
        for (const c of item.content || []) {
          if (c.type === 'output_text' && c.text) parts.push(c.text);
        }
      }
    }
    // Strip any leftover citation markers like 【4:0†source】
    return parts.join('\n\n').replace(/【[^】]*】/g, '').trim();
  }

  // Map Responses statuses to the Assistants run statuses the frontend expects
  function mapStatus(s) {
    if (s === 'queued' || s === 'in_progress' || s === 'completed' || s === 'failed' || s === 'cancelled') return s;
    if (s === 'incomplete') return 'completed'; // partial answer (e.g. token limit) — still show it
    return 'failed';
  }

  function buildRequest(userMessage) {
    const hasFile = userMessage.includes('[User attached a file:');
    const reqBody = {
      model: MODEL,
      conversation: threadId,
      input: [{ role: 'user', content: userMessage }],
      store: true
    };
    if (PROMPT_ID) {
      reqBody.prompt = { id: PROMPT_ID };
    } else {
      reqBody.instructions = CARA_INSTRUCTIONS;
    }
    // Same rule as v9: when the user attached a file, skip knowledge-base search
    if (!hasFile && VECTOR_STORE_ID) {
      reqBody.tools = [{ type: 'file_search', vector_store_ids: [VECTOR_STORE_ID] }];
    } else if (!VECTOR_STORE_ID) {
      console.error('VECTOR_STORE_ID is not set — CARA is answering without her knowledge base');
    }
    return reqBody;
  }

  async function setPending(responseId) {
    await openai(`/conversations/${threadId}`, 'POST', { metadata: { last_response: responseId } });
  }

  async function getPending() {
    const conv = await openai(`/conversations/${threadId}`);
    return conv?.metadata?.last_response || null;
  }

  try {

    // ── Create thread → create conversation ──────────────────────────────
    if (action === 'createThread') {
      const conv = await openai('/conversations', 'POST', {});
      return res.status(200).json({ id: conv.id });
    }

    // ── Extract file text ─────────────────────────────────────────────────
    if (action === 'extractFile') {
      const { fileData, fileName, fileType } = body;
      if (!fileData || !fileName) return res.status(400).json({ error: 'Missing file data' });

      console.log('Extracting text from:', fileName, 'type:', fileType);
      const extractedText = await extractTextFromFile(fileData, fileName, fileType);

      if (!extractedText || extractedText.length < 50) {
        return res.status(200).json({ success: false, error: 'Could not extract readable text from this file' });
      }
      console.log('Extracted', extractedText.length, 'characters from', fileName);
      return res.status(200).json({ success: true, text: extractedText, fileName });
    }

    // ── Add message → start the response (in background) ─────────────────
    if (action === 'addMessage') {
      if (!threadId || !message) return res.status(400).json({ error: 'Missing threadId or message' });
      const reqBody = buildRequest(message);

      let resp;
      try {
        resp = await openai('/responses', 'POST', { ...reqBody, background: true });
      } catch (e) {
        // Fallback: if background mode is rejected, run synchronously
        if (/background/i.test(e.message)) {
          console.warn('Background mode rejected, running synchronously:', e.message);
          resp = await openai('/responses', 'POST', reqBody);
        } else {
          throw e;
        }
      }
      await setPending(resp.id);
      return res.status(200).json({ id: resp.id, status: resp.status });
    }

    // ── Run assistant → return the response started in addMessage ────────
    if (action === 'runAssistant') {
      const pendingId = await getPending();
      if (!pendingId) return res.status(200).json({ id: null, status: 'failed', error: 'No pending response' });
      const resp = await openai(`/responses/${pendingId}`);
      return res.status(200).json({ id: resp.id, status: mapStatus(resp.status) });
    }

    // ── Poll status ───────────────────────────────────────────────────────
    if (action === 'getRunStatus') {
      const resp = await openai(`/responses/${runId}`);
      if (resp.status === 'failed') console.error('Response failed:', JSON.stringify(resp.error));
      return res.status(200).json({ id: resp.id, status: mapStatus(resp.status) });
    }

    // ── Get the answer (returned in the same shape the frontend expects) ──
    if (action === 'getMessages') {
      const pendingId = await getPending();
      const resp = await openai(`/responses/${pendingId}`);
      const answerText = outputText(resp);

      const userQuestion = body.question || '';
      const isSystemMsg = userQuestion && (
        userQuestion.includes('MUST respond exclusively') ||
        userQuestion.includes('يجب عليك الرد') ||
        userQuestion.includes('Vous DEVEZ') ||
        userQuestion.includes('ESCLUSIVAMENTE') ||
        userQuestion.includes('仅使用中文') ||
        userQuestion.includes('systemPrompt')
      );
      if (answerText && userQuestion && !isSystemMsg) {
        await logToSheet(sessionId, language, userQuestion, answerText);
      }

      return res.status(200).json({
        data: [{
          role: 'assistant',
          content: [{ type: 'text', text: { value: answerText || 'Sorry — I could not generate an answer. Please try again.' } }]
        }]
      });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Server error', status: 'failed' });
  }
}
