import {session,json,redis,BASE,SCHOOL} from './_lib/rm-auth.js';
import {allowedRiskOrigins,priorityKey,priorityComplete,priorityFingerprint,exampleItems} from './_lib/rm-evaluation.js';
export default async function handler(req,res){
 if(req.headers.origin&&!allowedRiskOrigins().includes(req.headers.origin))return json(res,403,{error:'Geçersiz istek kaynağı.'});
 if(req.method!=='POST')return json(res,405,{error:'Yalnızca POST desteklenir.'});
 try{await session(req)}catch{return json(res,401,{error:'LearnWorlds oturumu gerekli.'})}
 let b=req.body;try{if(typeof b==='string')b=JSON.parse(b)}catch{return json(res,400,{error:'Geçersiz JSON.'})}
 if(!b||JSON.stringify(b).length>65000||!priorityComplete(b.submission))return json(res,400,{error:'Önce kendi ilk beşinizi ve gerekçelerinizi tamamlayın.'});
 try{const mark=await redis(['GET',priorityKey(req)]);if(mark!==priorityFingerprint(b.submission))return json(res,403,{error:'Önceliklendirme yanıtlarınız için CARA geri bildirimini yenileyin.'});const guide=JSON.parse(process.env.RM1_GUIDE_JSON||'{}');return json(res,200,{items:exampleItems(guide.A5),note:'Tek doğru liste değil, gerekçeli bir örnektir. Kendi seçiminizle ve gerekçelerinizle karşılaştırın.'})}catch{return json(res,503,{error:'Örnek şu an açılamadı. Biraz sonra tekrar deneyin.'})}
}
