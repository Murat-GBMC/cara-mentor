import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/risk-embed.js';
test('public embed opens without LTI, sanitizes name and keeps rubric server-side',async()=>{
 const old=global.fetch;const saved={...process.env};
 process.env.RM1_CASE_JSON=JSON.stringify({documents:[],statements:[]});process.env.RM1_GUIDE_JSON='PRIVATE_RUBRIC_MARKER';process.env.KV_REST_API_URL='https://redis.example';process.env.KV_REST_API_TOKEN='test';
 const commands=[];global.fetch=async(u,o)=>{const c=JSON.parse(o.body);commands.push(c);return {ok:true,json:async()=>({result:c[0]==='EVAL'?1:'OK'})}};
 try{const res={setHeader(){},end(v){this.body=v}};await handler({method:'GET',headers:{'x-forwarded-for':'192.0.2.1'},query:{uid:'learner1',name:'<script>alert(1)</script>'}},res);
 assert.equal(res.statusCode,200);assert.ok(!res.body.includes('PRIVATE_RUBRIC_MARKER'));assert.ok(!res.body.includes('<script>alert(1)</script>'));assert.ok(!res.body.includes('__AUTH__'));assert.ok(res.body.includes('cara-ready'));
 const s=JSON.parse(commands.find(c=>c[0]==='SET')[2]);assert.equal(s.mode,'public-embed');assert.ok(s.subject.startsWith('embed:'));assert.ok(!JSON.stringify(s).includes('learner1'));
 }finally{global.fetch=old;process.env=saved}
});
