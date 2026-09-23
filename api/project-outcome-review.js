// CARA Project Outcome Review backend
// Route: /api/project-outcome-review
// Purpose: two-stage LearnWorlds embedded activity
//   1) initial_review -> CARA returns 3–7 follow-up questions
//   2) final_review   -> CARA returns the final Proje Sonuç Değerlendirme Raporu
//
// Uses the same CARA environment and knowledge base as api/cara.js.
//
// Required Vercel environment variables:
//   OPENAI_API_KEY
//   VECTOR_STORE_ID
// Optional:
//   OPENAI_MODEL (falls back to gpt-4o)
//
// This file should live next to cara.js:
//   /api/project-outcome-review.js

import { CARA_INSTRUCTIONS } from './instructions.js';
import { randomUUID } from 'node:crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb'
    }
  }
};

export default async function handler(req, res) {
  // LearnWorlds embedded activity calls this endpoint from another origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;
  const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not configured'
    });
  }

  const body = req.body || {};
  const stage = String(body.stage || '').trim();
  const platform = String(body.platform || 'pdu').toLowerCase();
  const sessionId = body.session_id || randomUUID();

  if (!['initial_review', 'final_review'].includes(stage)) {
    return res.status(400).json({
      error: 'Invalid stage'
    });
  }

  const openaiHeaders = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };

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
      throw new Error(msg);
    }

    return data;
  }

  function outputText(resp) {
    const parts = [];

    for (const item of resp?.output || []) {
      if (item.type === 'message' && item.role === 'assistant') {
        for (const c of item.content || []) {
          if (c.type === 'output_text' && c.text) {
            parts.push(c.text);
          }
        }
      }
    }

    return parts
      .join('\n\n')
      .replace(/【[^】]*】/g, '')
      .replace(/\uE200[^\uE201]*\uE201/g, '')
      .replace(/\s*filecite(?:\s*turn\d+file\d+)+/g, '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .trim();
  }

  function parseJson(text) {
    if (!text) {
      throw new Error('Empty CARA response');
    }

    let cleaned = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');

      if (first >= 0 && last > first) {
        return JSON.parse(cleaned.slice(first, last + 1));
      }

      throw new Error('CARA returned invalid JSON');
    }
  }

  function baseRequest(userPrompt, activityInstructions) {
    const platformContext =
      platform === 'pdu'
        ? `
## PLATFORM CONTEXT

The user is using PDU Circle.

Use this platform context without asking.
Focus on the individual's professional judgment and practical application.
Do not assume the user is PMP-certified.
`
        : `
## PLATFORM CONTEXT

The user is using the Execution Capacity CoE.

Use this platform context without asking.
Focus on organizational execution, leadership, governance, ownership and business outcomes.
`;

    const reqBody = {
      model: MODEL,

      input: [
        {
          role: 'user',
          content: userPrompt
        }
      ],

      instructions:
        CARA_INSTRUCTIONS +
        '\n\n' +
        platformContext +
        '\n\n## ACTIVITY-SPECIFIC INSTRUCTIONS\n' +
        activityInstructions,

      store: false
    };

    if (VECTOR_STORE_ID) {
      reqBody.tools = [
        {
          type: 'file_search',
          vector_store_ids: [VECTOR_STORE_ID]
        }
      ];
    }

    return reqBody;
  }

  function initialPrompt(a = {}) {
    return `
Katılımcı, Business Results-Oriented Project Management eğitimi içindeki
"CARA ile Proje Değer Kontrolü" aktivitesini tamamlamaktadır.

Aşağıda katılımcının kendi cevapları yer almaktadır.

1. Projeye konu olan iş problemi:
${a.business_problem || ''}

2. Beklenen iş sonucu:
${a.expected_outcome || ''}

3. En kritik fayda:
${a.critical_benefit || ''}

4. Fayda sahibi:
${a.benefit_owner || ''}

5. En önemli iş sonucu riski:
${a.outcome_risk || ''}

6. Sponsor/fonksiyon yöneticisinin alması gereken karar:
${a.leadership_decision || ''}

7. Önümüzdeki 30 günde planlanan aksiyonlar:
${a.next_30_day_action || ''}

Bu cevapları incele ve yalnızca netleştirilmesi veya daha derin düşünülmesi gereken
en önemli noktaları belirle.

SADECE geçerli JSON döndür.

Tam olarak şu yapıyı kullan:

{
  "follow_up_questions": [
    {
      "id": "q1",
      "question": "..."
    }
  ]
}

3 ile 7 arasında soru döndür.

Her soru Türkçe olmalıdır.
İngilizce başlık, açıklama veya yorum kullanma.
`.trim();
  }

  const INITIAL_ACTIVITY_INSTRUCTIONS = `
This is a structured PDU Circle learning activity inside the
Business Results-Oriented Project Management course.

For this structured activity, the general CARA guideline to
"ask one focused question only" DOES NOT APPLY.

At this stage, act as an experienced execution mentor and thinking partner.

DO NOT:
- rewrite the participant's answers,
- give the final assessment,
- score or grade the participant,
- solve the participant's project for them,
- recommend courses,
- give PDU guidance,
- recommend resources,
- recommend live mentoring,
- add commentary outside the requested JSON.

DO:
- challenge unclear assumptions,
- distinguish a business problem from a proposed solution,
- distinguish project outputs from business outcomes,
- test whether the benefit is concrete and measurable,
- test whether the benefit owner has accountability and influence,
- surface adoption, capacity, decision, ownership and business-readiness risks,
- test whether the requested sponsor/functional-manager decision is truly a leadership-level decision,
- test whether the 30-day actions are specific and connected to the intended business outcome,
- reflect GBMC's outcome-focused, ownership, governance and execution principles where relevant.

Ask only about meaningful gaps.

Do not ask questions about areas that are already sufficiently clear.

Return 3 to 7 concise follow-up questions together in one response.

The questions should make the participant think more deeply rather than give them the answer.

IMPORTANT LANGUAGE RULE:

- Every user-visible question must be written in Turkish.
- Do not include English headings, explanations or labels in the response.

Return valid JSON only.
`.trim();

  function finalPrompt(original = {}, followups = []) {
    const followupText = (followups || [])
      .map(
        (x, i) => `
Takip Sorusu ${i + 1}:
${x.question || ''}

Katılımcının Cevabı:
${x.answer || ''}
`
      )
      .join('\n');

    return `
Katılımcı "CARA ile Proje Değer Kontrolü" aktivitesinin her iki aşamasını da tamamladı.

İLK CEVAPLAR

1. Projeye konu olan iş problemi:
${original.business_problem || ''}

2. Beklenen iş sonucu:
${original.expected_outcome || ''}

3. En kritik fayda:
${original.critical_benefit || ''}

4. Fayda sahibi:
${original.benefit_owner || ''}

5. En önemli iş sonucu riski:
${original.outcome_risk || ''}

6. Sponsor/fonksiyon yöneticisinin alması gereken karar:
${original.leadership_decision || ''}

7. Önümüzdeki 30 günde planlanan aksiyonlar:
${original.next_30_day_action || ''}


TAKİP SORULARI VE CEVAPLARI

${followupText}


Şimdi nihai "Proje Sonuç Değerlendirme Raporu"nu hazırla.

Raporun tamamı Türkçe olmalıdır.

İngilizce başlık, açıklama veya öneri kullanma.

SADECE geçerli JSON döndür.

Tam olarak şu yapıyı kullan:

{
  "executive_summary": "...",

  "assessment": {

    "business_problem": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "expected_outcome": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "critical_benefit": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "benefit_owner": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "outcome_risk": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "leadership_decision": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    },

    "next_30_day_action": {
      "participant_view": "...",
      "cara_view": "...",
      "improvement": "..."
    }
  },

  "strengths": [
    "...",
    "..."
  ],

  "areas_to_improve": [
    "...",
    "..."
  ],

  "overlooked_risk": "...",

  "leadership_focus": "...",

  "priority_30_day_action": "..."
}
`.trim();
  }

  const FINAL_ACTIVITY_INSTRUCTIONS = `
This is a structured PDU Circle course activity, not a general CARA conversation.

Act as CARA, the GBMC Execution Mentor.

Prepare the participant's:

"Proje Sonuç Değerlendirme Raporu"

Use only:

- the participant's original answers,
- the participant's follow-up answers,
- sound business-results-oriented project management principles,
- relevant CARA / GBMC knowledge-base context when useful.

Do not invent facts.

If an important point remains uncertain, state the uncertainty clearly.

For each of the seven areas:

1. preserve the participant's underlying intent,
2. summarize the participant's view accurately,
3. provide CARA's professional mentor assessment,
4. identify a practical improvement where needed.

Then identify:

- güçlü alanlar,
- iyileştirilmesi gereken alanlar,
- gözden kaçıyor olabilecek bir risk,
- önerilen liderlik odağı,
- önümüzdeki 30 gün için tek öncelikli aksiyon.

The report should reflect relevant GBMC principles such as:

- projects as business investments,
- outcome focus rather than activity focus,
- active ownership,
- decision discipline,
- capacity awareness,
- cross-functional alignment,
- adoption,
- benefit realization.

IMPORTANT:

- Do not score or grade the participant.
- Do not make decisions on behalf of the participant.
- Do not recommend courses.
- Do not provide PDU guidance.
- Do not recommend resources.
- Do not recommend live mentoring in this report.
- Do not add follow-up questions after the report.
- Do not add any text outside the requested JSON structure.
- Keep the tone constructive, concise, practical and mentor-like.
- Avoid academic language.

IMPORTANT LANGUAGE RULE:

- The entire report must be in Turkish.
- All user-visible summaries must be in Turkish.
- All CARA assessments must be in Turkish.
- All improvement suggestions must be in Turkish.
- All action statements must be in Turkish.
- Do not use English headings.
- Do not use English explanatory text.

Return valid JSON only.
`.trim();

  try {
    if (stage === 'initial_review') {
      const answers = body.answers || {};

      const required = [
        'business_problem',
        'expected_outcome',
        'critical_benefit',
        'benefit_owner',
        'outcome_risk',
        'leadership_decision',
        'next_30_day_action'
      ];

      const missing = required.filter(
        (k) => !String(answers[k] || '').trim()
      );

      if (missing.length) {
        return res.status(400).json({
          error: 'Missing required answers',
          missing
        });
      }

      const resp = await openai(
        '/responses',
        'POST',
        baseRequest(
          initialPrompt(answers),
          INITIAL_ACTIVITY_INSTRUCTIONS
        )
      );

      const parsed = parseJson(outputText(resp));

      const questions = Array.isArray(parsed.follow_up_questions)
        ? parsed.follow_up_questions.slice(0, 7)
        : [];

      if (questions.length < 1) {
        throw new Error('No follow-up questions returned');
      }

      const normalized = questions
        .map((q, i) => ({
          id: q.id || `q${i + 1}`,
          question: String(q.question || '').trim()
        }))
        .filter((q) => q.question);

      return res.status(200).json({
        session_id: sessionId,
        follow_up_questions: normalized
      });
    }

    if (stage === 'final_review') {
      const original = body.original_answers || {};

      const followups = Array.isArray(body.follow_up_answers)
        ? body.follow_up_answers
        : [];

      if (!followups.length) {
        return res.status(400).json({
          error: 'Missing follow-up answers'
        });
      }

      const incomplete = followups.some(
        (x) => !String(x.answer || '').trim()
      );

      if (incomplete) {
        return res.status(400).json({
          error: 'All follow-up questions must be answered'
        });
      }

      const resp = await openai(
        '/responses',
        'POST',
        baseRequest(
          finalPrompt(original, followups),
          FINAL_ACTIVITY_INSTRUCTIONS
        )
      );

      const finalReport = parseJson(outputText(resp));

      return res.status(200).json({
        session_id: sessionId,
        final_report: finalReport
      });
    }

    return res.status(400).json({
      error: 'Unknown stage'
    });

  } catch (err) {
    console.error('Project Outcome Review error:', err);

    return res.status(500).json({
      error: err.message || 'CARA evaluation failed'
    });
  }
}
