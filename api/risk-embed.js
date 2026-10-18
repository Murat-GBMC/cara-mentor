import {random,digest,redis,html,limit,displayName,CLAIM} from './_lib/rm-auth.js';
import template from './_lib/rm-template.js';
// Public learning activity: display identifiers are not authenticated identities.
const js=v=>JSON.stringify(v).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
export default async function handler(req,res){
 if(req.method!=='GET')return html(res,405,'');
 try{
  const ip=digest(String(req.headers['x-forwarded-for']||'unknown').split(',')[0].trim());
  await limit('embed:start:'+ip,120,600);
  const content=JSON.parse(process.env.RM1_CASE_JSON||'null');
  if(!content?.documents||!process.env.RM1_GUIDE_JSON)throw Error('content_missing');
  const q=req.query||{},raw=typeof q.uid==='string'&&q.uid.length<=256&&!/[{}<>]/.test(q.uid)?q.uid:'';
  const uid=raw?digest('embed:'+raw):'guest';
  const name=displayName({name:typeof q.name==='string'?q.name:'',[CLAIM+'custom']:{}});
  const token=random();
  await redis(['SET','cara:rm1:lti:session:'+digest(token),JSON.stringify({subject:'embed:'+ip,caseId:'RM-1',expiresAt:Date.now()+86400000,mode:'public-embed'}),'EX',86400,'NX']);
  const messageScript=`<script>window.addEventListener('message',e=>{if(e.origin!=='https://gbmc-tr.learnworlds.com'||e.source!==window.parent||e.data?.type!=='cara-participant')return;window.CARA_PARTICIPANT={certificationName:e.data.certificationName,firstName:e.data.firstName};refreshParticipant()});window.parent.postMessage({type:'cara-ready'},'https://gbmc-tr.learnworlds.com');</script>`;
  let output=template.replace('__CONTENT__',()=>js(content)).replace('__AUTH__',()=>js({token,uid,name}));
  output=output.replace('LearnWorlds oturumu gerekli.','Etkinliği yeniden açın.').replaceAll('Dersinize dönüp etkinliği yeniden açın.','Etkinliği yeniden açın.');
  return html(res,200,output.replace('</html>',messageScript+'</html>'));
 }catch(e){console.error('rm1 embed',{type:e.message});return html(res,503,'<p>Atölye şu an açılamadı. Biraz sonra tekrar deneyin.</p>')}
}
