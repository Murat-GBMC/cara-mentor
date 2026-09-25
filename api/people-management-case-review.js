// /api/people-management-case-review.js
import { CARA_INSTRUCTIONS } from './instructions.js';
import { randomUUID } from 'node:crypto';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.OPENAI_API_KEY;
  const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;
  const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

  if (!API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not configured'
    });
  }

  const body = req.body || {};
  const stage = String(body.stage || '').trim();
  const sessionId = body.session_id || randomUUID();
  const selectedCase = body.case || {};

  if (!['initial_review', 'final_review'].includes(stage)) {
    return res.status(400).json({ error: 'Invalid stage' });
  }

  if (
    !selectedCase.id ||
    !selectedCase.title ||
    !Array.isArray(selectedCase.body)
  ) {
    return res.status(400).json({
      error: 'Case context is missing'
    });
  }

  const caseText = [
    `VAKA: ${selectedCase.title}`,
    `ALAN: ${selectedCase.domain || ''}`,
    `SEKTÖR: ${selectedCase.sector || ''}`,
    '',
    ...(selectedCase.body || []),
    '',
    `BU VAKADA ÖZELLİKLE DEĞERLENDİRİLECEK TEMALAR: ${
      (selectedCase.focus || []).join(', ')
    }`
  ].join('\n');

  async function callOpenAI(payload) {
    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        `OpenAI HTTP ${response.status}`
      );
    }

    return data;
  }

  function outputText(response) {
    const parts = [];

    for (const item of response?.output || []) {
      if (
        item.type === 'message' &&
        item.role === 'assistant'
      ) {
        for (const content of item.content || []) {
          if (
            content.type === 'output_text' &&
            content.text
          ) {
            parts.push(content.text);
          }
        }
      }
    }

    return parts
      .join('\n\n')
      .replace(/【[^】]*】/g, '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .trim();
  }

  function parseJson(text) {
    let s = String(text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(s);
    } catch (_) {
      const first = s.indexOf('{');
      const last = s.lastIndexOf('}');

      if (first >= 0 && last > first) {
        return JSON.parse(
          s.slice(first, last + 1)
        );
      }

      throw new Error(
        'CARA returned invalid JSON'
      );
    }
  }

  function requestPayload(
    prompt,
    overrideInstructions
  ) {
    const payload = {
      model: MODEL,
      input: [
        {
          role: 'user',
          content: prompt
        }
      ],
      instructions:
        CARA_INSTRUCTIONS +
        '\n\n## PLATFORM CONTEXT\n' +
        'The user is using PDU Circle.' +
        '\n\n## STRUCTURED CASE ACTIVITY OVERRIDE\n' +
        overrideInstructions,
      store: false
    };

    if (VECTOR_STORE_ID) {
      payload.tools = [
        {
          type: 'file_search',
          vector_store_ids: [
            VECTOR_STORE_ID
          ]
        }
      ];
    }

    return payload;
  }

  const initialOverride = `
This is a structured case-study activity.
The general CARA rule to ask only one focused
question DOES NOT APPLY here.

Do not give the answer or final assessment yet.
Do not score or grade the participant.
Do not recommend courses, PDU guidance,
resources or live mentoring.

Do not ask generic questions when a
case-specific question would be stronger.

Challenge the participant where useful on:

- symptom versus root-cause diagnosis,
- adaptive leadership and individual differences,
- psychological safety and participation,
- difficult or dominant behavior,
- motivation and engagement,
- conflict and constructive boundary-setting,
- capacity versus individual performance,
- ownership and commitment,
- sponsor and functional-manager communication,
- prioritization of near-term actions.

Return 3 to 7 concise,
thought-provoking questions together.

Every user-visible question must be Turkish.

Return JSON only.
`.trim();

  const finalOverride = `
This is a structured course activity,
not a general CARA conversation.

Prepare a concise, practical,
mentor-like assessment of the participant's
people-management judgment.

Use the exact case context,
the participant's first answers,
follow-up answers,
and relevant GBMC knowledge.

Do not invent facts.
Do not score or grade.
Do not make decisions on behalf of the participant.
Do not add follow-up questions.
Do not recommend courses,
PDU guidance,
resources or live mentoring.
Do not add any text outside JSON.

Assess:

- situation diagnosis,
- individual differences and adaptive leadership,
- psychological safety and participation,
- conflict and difficult behavior,
- motivation and engagement,
- capacity and commitment,
- sponsor / manager communication.

The entire user-visible report
must be Turkish.

Return JSON only.
`.trim();

  const requiredKeys = [
    'main_people_issue',
    'root_causes',
    'first_conversation',
    'leadership_change',
    'next_two_weeks',
    'special_1',
    'special_2'
  ];

  try {

    if (stage === 'initial_review') {

      const answers =
        body.answers || {};

      const missing =
        requiredKeys.filter(
          k =>
            !String(
              answers[k] || ''
            ).trim()
        );

      if (missing.length) {
        return res.status(400).json({
          error:
            'Missing required answers',
          missing
        });
      }

      const prompt = `
${caseText}

KATILIMCININ İLK CEVAPLARI

1. En önemli insan yönetimi problemi:
${answers.main_people_issue}

2. Temel nedenler:
${answers.root_causes}

3. İlk konuşacağı kişi ve yaklaşımı:
${answers.first_conversation}

4. Proje lideri olarak değiştireceği
davranış / çalışma biçimi:
${answers.leadership_change}

5. Önümüzdeki iki haftadaki
ilk üç aksiyon:
${answers.next_two_weeks}

6. Vakaya özel soru 1 cevabı:
${answers.special_1}

7. Vakaya özel soru 2 cevabı:
${answers.special_2}

Katılımcının insan yönetimi muhakemesini
derinleştirmek için yalnızca gerçekten gerekli
3 ile 7 takip sorusu üret.

SADECE şu yapıda geçerli JSON döndür:

{
  "follow_up_questions":[
    {
      "id":"q1",
      "question":"..."
    }
  ]
}

Tüm sorular Türkçe olmalıdır.
`.trim();

      const response =
        await callOpenAI(
          requestPayload(
            prompt,
            initialOverride
          )
        );

      const parsed =
        parseJson(
          outputText(response)
        );

      const questions =
        Array.isArray(
          parsed.follow_up_questions
        )
          ? parsed.follow_up_questions.slice(
              0,
              7
            )
          : [];

      if (!questions.length) {
        throw new Error(
          'No follow-up questions returned'
        );
      }

      return res.status(200).json({
        session_id: sessionId,

        follow_up_questions:
          questions
            .map((q, i) => ({
              id:
                q.id ||
                `q${i + 1}`,

              question:
                String(
                  q.question || ''
                ).trim()
            }))
            .filter(
              q => q.question
            )
      });
    }

    const originalAnswers =
      body.original_answers || {};

    const followUps =
      Array.isArray(
        body.follow_up_answers
      )
        ? body.follow_up_answers
        : [];

    const missing =
      requiredKeys.filter(
        k =>
          !String(
            originalAnswers[k] || ''
          ).trim()
      );

    if (missing.length) {
      return res.status(400).json({
        error:
          'Missing original answers',
        missing
      });
    }

    if (
      !followUps.length ||
      followUps.some(
        x =>
          !String(
            x.answer || ''
          ).trim()
      )
    ) {
      return res.status(400).json({
        error:
          'Missing follow-up answers'
      });
    }

    const followUpText =
      followUps
        .map(
          (x, i) =>
            `Takip Sorusu ${i + 1}: ${x.question}
Cevap: ${x.answer}`
        )
        .join('\n\n');

    const prompt = `
${caseText}

KATILIMCININ İLK CEVAPLARI

En önemli insan yönetimi problemi:
${originalAnswers.main_people_issue}

Temel nedenler:
${originalAnswers.root_causes}

İlk konuşacağı kişi ve yaklaşımı:
${originalAnswers.first_conversation}

Değiştireceği liderlik davranışı /
çalışma biçimi:
${originalAnswers.leadership_change}

İlk iki haftalık aksiyonları:
${originalAnswers.next_two_weeks}

Vakaya özel cevap 1:
${originalAnswers.special_1}

Vakaya özel cevap 2:
${originalAnswers.special_2}


CARA TAKİP SORULARI
VE KATILIMCININ CEVAPLARI

${followUpText}


Türkçe
"Proje İnsan Yönetimi Değerlendirme Raporu"
hazırla.

SADECE şu yapıda geçerli JSON döndür:

{
  "executive_summary":"...",

  "assessment":{

    "situation_diagnosis":{
      "cara_view":"...",
      "improvement":"..."
    },

    "individual_management":{
      "cara_view":"...",
      "improvement":"..."
    },

    "psychological_safety":{
      "cara_view":"...",
      "improvement":"..."
    },

    "conflict_behavior":{
      "cara_view":"...",
      "improvement":"..."
    },

    "motivation_engagement":{
      "cara_view":"...",
      "improvement":"..."
    },

    "capacity_commitment":{
      "cara_view":"...",
      "improvement":"..."
    },

    "sponsor_communication":{
      "cara_view":"...",
      "improvement":"..."
    }
  },

  "strengths":[
    "..."
  ],

  "areas_to_improve":[
    "..."
  ],

  "overlooked_people_factor":"...",

  "leadership_risk":"...",

  "three_behaviors":[
    "...",
    "...",
    "..."
  ]
}

Raporun tamamı Türkçe olmalıdır.
`.trim();

    const response =
      await callOpenAI(
        requestPayload(
          prompt,
          finalOverride
        )
      );

    return res.status(200).json({

      session_id:
        sessionId,

      final_report:
        parseJson(
          outputText(response)
        )
    });

  } catch (error) {

    console.error(
      'People Management Case Review error:',
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        'CARA evaluation failed'
    });
  }
}
