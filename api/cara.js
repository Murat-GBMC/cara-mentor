export default async function handler(req, res) {
  // Allow requests from any origin (your LearnWorlds school)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const ASSISTANT_ID   = process.env.ASSISTANT_ID;

  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  const { action, threadId, message, runId } = req.body;

  const headers = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  try {
    // Create a new thread
    if (action === 'createThread') {
      const r = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST', headers, body: JSON.stringify({})
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // Add a message to thread
    if (action === 'addMessage') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST', headers,
        body: JSON.stringify({ role: 'user', content: message })
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // Run the assistant
    if (action === 'runAssistant') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
        method: 'POST', headers,
        body: JSON.stringify({ assistant_id: ASSISTANT_ID })
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // Poll run status
    if (action === 'getRunStatus') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // Get latest message
    if (action === 'getMessages') {
      const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=1`, {
        headers
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
