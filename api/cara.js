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
  const { action, threadId, message, runId, language, sessionId } = body;

  const openaiHeaders = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  // ── Google Sheets logging ───────────────────────────────────────────────
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

  async function logToSheet(sid, lang, msg, answer = '', answered = '') {
    try {
      if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
        console.error('Sheet logging: missing env vars', { SHEET_ID: !!SHEET_ID, CLIENT_EMAIL: !!CLIENT_EMAIL, PRIVATE_KEY: !!PRIVATE_KEY });
        return;
      }
      const token = await getGoogleToken();
      if (!token) { console.error('Sheet logging: failed to get token'); return; }

      const responseLength = answer ? answer.length : '';

      // Auto-detect if CARA answered or not
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

  // ── Extract text from PDF using OpenAI vision ───────────────────────────
  async function extractTextFromFile(fileData, fileName, fileType) {
    // For PDFs and docs, use OpenAI to extract/summarize the content
    // Send as a message to a temporary chat completion
    const base64 = fileData;
    
    if (fileType === 'application/pdf') {
      // Use GPT-4o to read the PDF
      const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please extract and return ALL the text content from this document. Return the text as-is, preserving structure. Do not summarize - return the actual content.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64}`,
                  detail: 'high'
                }
              }
            ]
          }]
        })
      });
      const extractData = await extractRes.json();
      return extractData.choices?.[0]?.message?.content || null;
    }
    
    // For Word docs and text files, decode directly
    if (fileType === 'text/plain' || fileType === 'text/markdown' || fileType === 'text/csv') {
      const buffer = Buffer.from(base64, 'base64');
      return buffer.toString('utf-8').slice(0, 15000); // limit to 15k chars
    }

    // For Word docs - extract raw text from XML
    if (fileType === 'application/msword' || 
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        const buffer = Buffer.from(base64, 'base64');
        // Try to extract readable text - look for text patterns
        const str = buffer.toString('utf-8', 0, Math.min(buffer.length, 500000));
        // Extract text between XML tags for docx
        const textMatches = str.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
        if (textMatches.length > 0) {
          const text = textMatches
            .map(m => m.replace(/<[^>]+>/g, ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 15000);
          return text;
        }
        // Fallback: extract any readable ASCII text
        const readable = str.replace(/[^\x20-\x7E\n\r\t]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        return readable.length > 100 ? readable : null;
      } catch(e) {
        console.error('Word extraction error:', e.message);
        return null;
      }
    }

    return null;
  }

  try {

    // ── Create thread ─────────────────────────────────────────────────────
    if (action === 'createThread') {
      const r = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST', headers: openaiHeaders, body: JSON.stringify({})
      });
      return res.status(200).json(await r.json());
    }

    // ── Extract file text (new approach - no file attachment) ─────────────
    if (action === 'extractFile') {
      const { fileData, fileName, fileType } = body;
      if (!fileData || !fileName) return res.status(400).json({ error: 'Missing file data' });

      console.log('Extracting text from:', fileName, 'type:', fileType);
      
      const extractedText = await extractTextFromFile(fileData, fileName, fileType);
      
      if (!extractedText || extractedText.length < 50) {
        return res.status(200).json({ 
          success: false, 
          error: 'Could not extract readable text from this file' 
        });
      }

      console.log('Extracted', extractedText.length, 'characters from', fileName);
      return res.status(200).json({ success: true, text: extractedText, fileName });
    }

    // ── Add message ───────────────────────────────────────────────────────
    if (action === 'addMessage') {
      // Logging is handled in getMessages after CARA replies (single complete row)
      const msgBody = { role: 'user', content: message };
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST', headers: openaiHeaders, body: JSON.stringify(msgBody)
      });
      return res.status(200).json(await r.json());
    }

    // ── Run assistant ─────────────────────────────────────────────────────
    if (action === 'runAssistant') {
      const hasFile = body.hasFile || false;
      const runBody = { assistant_id: ASSISTANT_ID };
      // If user sent a file, override tools to skip vector store search
      // CARA reads the file text directly from the message instead
      if (hasFile) {
        runBody.tools = [];
        console.log('Running without file_search (file text included in message)');
      }
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
        method: 'POST', headers: openaiHeaders,
        body: JSON.stringify(runBody)
      });
      return res.status(200).json(await r.json());
    }

    // ── Poll run status ───────────────────────────────────────────────────
    if (action === 'getRunStatus') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: openaiHeaders
      });
      return res.status(200).json(await r.json());
    }

    // ── Get messages ──────────────────────────────────────────────────────
    if (action === 'getMessages') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=1`, {
        headers: openaiHeaders
      });
      const data = await r.json();

      // Log one complete row: question (passed from frontend) + CARA's answer
      try {
        const assistantMsg = data?.data?.[0];
        if (assistantMsg?.role === 'assistant') {
          const answerText = (assistantMsg.content || [])
            .filter(c => c.type === 'text')
            .map(c => (c.text && c.text.value) ? c.text.value : '')
            .join(' ');

          const userQuestion = body.question || '';

          // Only log real user questions (skip system/language prompts)
          const isSystemMsg = userQuestion && (
            userQuestion.includes('MUST respond exclusively') ||
            userQuestion.includes('يجب عليك الرد') ||
            userQuestion.includes('Vous DEVEZ') ||
            userQuestion.includes('ESCLUSIVAMENTE') ||
            userQuestion.includes('仅使用中文') ||
            userQuestion.includes('systemPrompt')
          );

          if (answerText && !isSystemMsg) {
            logToSheet(sessionId, language, userQuestion, answerText);
          }
        }
      } catch (logErr) {
        console.error('Answer log error:', logErr.message);
      }

      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
