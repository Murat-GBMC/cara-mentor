// api/meeting-clinic.js
// CARA Meeting Clinic — Meeting Management and Decision Efficiency
// Requires OPENAI_API_KEY. Optional: OPENAI_MODEL.
// If your existing project has api/instructions.js, this endpoint can work alongside it;
// the activity-specific mentoring rules below are intentionally self-contained.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const CASE_GUIDES = {
  daily_standup: {
    focus: ["stand-up'ın amacı", "time-boxing", "status bilgisini asenkron paylaşma", "blocker odaklılık", "teknik tartışmayı park etme", "Product Owner rolü"],
    desired: "15 dakikalık, engel/koordinasyon odaklı ve detay çözüm tartışmalarını toplantı dışına taşıyan bir tasarım"
  },
  executive_47_slides: {
    focus: ["C-level audience", "amaç ve beklenen çıktı", "pre-read", "bilgi aktarımı ile karar arasındaki fark", "executive attention", "karar taleplerini öne alma"],
    desired: "30 dakikada karar ve yönlendirme üreten, detayları pre-read'e taşıyan en fazla dört maddelik executive review"
  },
  dominant_executive: {
    focus: ["psychological safety", "seniority bias", "false consensus", "kolaylaştırıcının rolü", "karar kriterleri", "facts vs assumptions", "dissent daveti"],
    desired: "sponsorun görüşünü bastırmadan diğer sesleri görünür kılan, kriterlerle karar veren ve gerçek taahhüdü test eden bir süreç"
  },
  no_decision: {
    focus: ["karar sorusunu netleştirme", "decision owner", "input vs approval", "karar kriterleri", "perfect information trap", "consensus gereksinimi", "escalation"],
    desired: "karar sahibi, kriterleri, seçenekleri ve toplantı sonu çıktısı baştan net bir decision meeting"
  },
  everyone_invited: {
    focus: ["needs to know vs needs to attend", "katkı/karar/uygulama/bilgilendirme", "kolektif zaman maliyeti", "core vs optional participants", "async communication"],
    desired: "çekirdek katılımcıları küçülten, konu bazlı katılım ve asenkron bilgilendirme kullanan toplantı mimarisi"
  },
  no_execution: {
    focus: ["discussion vs execution", "tek hesap verebilir owner", "deadline", "expected output", "action log", "follow-up rhythm", "blocker escalation"],
    desired: "Owner + Action + Deliverable + Deadline standardı ve görünür takip ritmi"
  }
};

function json(res, status, body) {
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

async function openaiJson(apiKey, model, system, user, schemaName, schema) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      input:[
        {role:'system',content:[{type:'input_text',text:system}]},
        {role:'user',content:[{type:'input_text',text:user}]}
      ],
      text:{
        format:{
          type:'json_schema',
          name:schemaName,
          strict:true,
          schema
        }
      }
    })
  });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  const raw = data.output_text || data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
  if(!raw) throw new Error('OpenAI boş yanıt döndürdü.');
  return JSON.parse(raw);
}

const BASE_SYSTEM = `
Sen CARA'sın: GBMC'nin yapay zekâ destekli Execution Mentor'ü.
Bu aktivitede Meeting Management and Decision Efficiency eğitiminin mentorüsün.
Dil Türkçe. Tonun profesyonel, kısa, net, düşündürücü ve yargılamayan bir mentor tonu olsun.

MEETING CLINIC KURALLARI:
- Kullanıcıya doğru cevabı hemen verme.
- Önce kullanıcının teşhisini anlamaya ve derinleştirmeye çalış.
- Doğru gördüğün noktaları kısa biçimde teyit et; fakat övgüyü abartma.
- Eksik/yüzeysel noktaları doğrudan ders anlatmak yerine soruyla challenge et.
- Sorular vaka bağlamına özgü olsun; genel teori soruları sorma.
- Kullanıcıdan mümkün olduğunda gerçek toplantı davranışı üretmesini iste: "Tam olarak ne söylerdiniz?", "Gündemi nasıl yazardınız?", "Kimi çıkarırdınız?" gibi.
- Psikolojik güvenlik, karar hakları, toplantı amacı, katılımcılar, gündem, zaman, aksiyon/sahiplik ve takip kavramlarını yalnızca vakayla ilgili olduğunda kullan.
- Nihai değerlendirmede kullanıcının güçlü teşhislerini ve gözden kaçırdığı noktaları ayır.
- Kullanıcının yaklaşımını kopyalamak yerine onu uygulanabilir toplantı tasarımına dönüştür.
- Mentor notu en fazla 3 cümle olsun.
- TÜM kullanıcıya gösterilen metinleri Türkçe üret. Kişi unvanlarını, toplantı türlerini ve yönetim terimlerini mümkün olduğunca Türkçeleştir.
- Örnek terminoloji: Operations Director → Operasyon Direktörü; Quality Manager → Kalite Yöneticisi; Marketing Director → Pazarlama Direktörü; Product Owner → Ürün Sahibi; Steering Committee → Yönlendirme Komitesi; Executive Review → Üst Yönetim Değerlendirme Toplantısı; decision meeting → karar toplantısı; discussion meeting → tartışma toplantısı.
- Daily stand-up gibi sektörde yaygın İngilizce terimler gerekiyorsa ilk kullanımda Türkçe karşılığıyla birlikte ver; sonraki kullanımlarda Türkçe karşılığını tercih et.
`;

const followupSchema = {
  type:"object",additionalProperties:false,
  properties:{
    session_id:{type:"string"},
    follow_up_questions:{
      type:"array",minItems:3,maxItems:5,
      items:{type:"object",additionalProperties:false,properties:{
        id:{type:"string"},question:{type:"string"},coaching_note:{type:"string"}
      },required:["id","question","coaching_note"]}
    }
  },required:["session_id","follow_up_questions"]
};

const reportSchema = {
  type:"object",additionalProperties:false,
  properties:{
    final_report:{
      type:"object",additionalProperties:false,
      properties:{
        executive_summary:{type:"string"},
        root_problem:{type:"string"},
        strong_diagnoses:{type:"array",items:{type:"string"}},
        missed_or_developable_points:{type:"array",items:{type:"string"}},
        recommended_meeting_design:{
          type:"object",additionalProperties:false,
          properties:{
            purpose:{type:"string"},
            participants:{type:"array",items:{type:"string"}},
            preparation:{type:"array",items:{type:"string"}},
            agenda:{type:"array",items:{type:"string"}},
            expected_output:{type:"string"}
          },required:["purpose","participants","preparation","agenda","expected_output"]
        },
        decision_and_ownership:{type:"string"},
        three_behavior_changes:{type:"array",minItems:3,maxItems:3,items:{type:"string"}},
        mentor_note:{type:"string"}
      },
      required:["executive_summary","root_problem","strong_diagnoses","missed_or_developable_points","recommended_meeting_design","decision_and_ownership","three_behavior_changes","mentor_note"]
    }
  },required:["final_report"]
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});

  try{
    const key=process.env.OPENAI_API_KEY;
    if(!key) return json(res,500,{error:'OPENAI_API_KEY tanımlı değil.'});
    const model=process.env.OPENAI_MODEL || 'gpt-5.6';
    const b=req.body||{};
    const guide=CASE_GUIDES[b.case_id];
    if(!guide) return json(res,400,{error:'Geçersiz vaka.'});

    if(b.stage==='initial_review'){
      if(!String(b.diagnosis||'').trim()) return json(res,400,{error:'Teşhis boş olamaz.'});
      const sessionId=b.session_id || `mc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const user = `
VAKA: ${b.case_title}
SENARYO:
${b.scenario}

KULLANICININ İLK TEŞHİSİ:
${b.diagnosis}

BU VAKANIN ÖĞRENME ODAKLARI:
${guide.focus.join('; ')}

FİNAL CHALLENGE:
${b.final_challenge}

3–5 takip sorusu üret. Sorular bir öğrenme yolculuğu oluştursun:
1) temel nedeni derinleştir,
2) ilgili toplantı tasarımı/karar/facilitation unsurunu sorgula,
3) en az bir soruda kullanıcının somut cümle, gündem, rol veya aksiyon üretmesini iste,
4) son soru mutlaka final challenge'a yaklaştırmalı.
Soruların kendisinde cevabı verme.`;
      const result=await openaiJson(key,model,BASE_SYSTEM,user,'meeting_clinic_followups',followupSchema);
      result.session_id=sessionId;
      return json(res,200,result);
    }

    if(b.stage==='final_review'){
      const answers=Array.isArray(b.follow_up_answers)?b.follow_up_answers:[];
      const user = `
VAKA: ${b.case_title}
SENARYO:
${b.scenario}

KULLANICININ İLK TEŞHİSİ:
${b.diagnosis}

CARA COACHING SORULARI VE KULLANICI CEVAPLARI:
${answers.map((x,i)=>`${i+1}. Soru: ${x.question}\nCevap: ${x.answer}`).join('\n\n')}

BU VAKANIN ÖĞRENME ODAKLARI:
${guide.focus.join('; ')}

HEDEFLENEN TASARIM:
${guide.desired}

FİNAL CHALLENGE:
${b.final_challenge}

Kısa ve uygulanabilir bir Toplantı İyileştirme Raporu hazırla.
- executive_summary: 3–5 cümle.
- root_problem: semptom değil temel neden(ler).
- strong_diagnoses: kullanıcının gerçekten yakaladığı 2–4 nokta.
- missed_or_developable_points: 2–4 gelişim alanı; kullanıcının yazmadığı şeyi yazmış gibi gösterme.
- recommended_meeting_design: vaka için uygulanabilir amaç, katılımcılar, hazırlık, gündem, beklenen çıktı.
- decision_and_ownership: vaka karar gerektirmiyorsa bile sahiplik/takip yapısını açıkla.
- three_behavior_changes: tam 3 somut davranış.
- mentor_note: en fazla 3 cümle, güçlü ama öğretici.
`;
      const result=await openaiJson(key,model,BASE_SYSTEM,user,'meeting_clinic_report',reportSchema);
      return json(res,200,result);
    }

    return json(res,400,{error:'Geçersiz stage.'});
  }catch(err){
    console.error('meeting-clinic error',err);
    return json(res,500,{error:err.message||'Beklenmeyen hata'});
  }
}

Explain
