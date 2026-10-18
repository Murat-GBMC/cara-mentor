import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {CLAIM,APP,LAUNCH,verifyLaunch,takeState,digest,cookieName,session,displayName,publicJwks} from '../api/_lib/rm-auth.js';
const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});const jwk=await exportJWK(publicKey);jwk.kid='platform-test';const resolver=createLocalJWKSet({keys:[jwk]});
const p={issuer:'https://school.learnworlds.com',clientId:'registered-client',deploymentId:'registered-deploy'};const nonce='expected-nonce';
const now=Math.floor(Date.now()/1000);
const claims={sub:'learner-1',nonce,[CLAIM+'message_type']:'LtiResourceLinkRequest',[CLAIM+'version']:'1.3.0',[CLAIM+'deployment_id']:p.deploymentId,[CLAIM+'target_link_uri']:APP,[CLAIM+'resource_link']:{id:'lesson1'},[CLAIM+'roles']:['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],[CLAIM+'context']:{id:'course1'}};
async function signed(changes={},key=privateKey){return new SignJWT({...claims,...changes}).setProtectedHeader({alg:'RS256',kid:'platform-test'}).setIssuer(p.issuer).setAudience(p.clientId).setIssuedAt(changes.iat??now).setExpirationTime(changes.exp??now+300).sign(key)}
async function reject(changes){await assert.rejects(()=>verifyLaunch(signed(changes),p,{nonce},resolver))}
// Note token promises must be resolved before passing to verifier.
async function denied(changes={},key=privateKey,reg=p){const token=await signed(changes,key);await assert.rejects(()=>verifyLaunch(token,reg,{nonce},resolver))}
test('valid signed platform launch',async()=>assert.equal((await verifyLaunch(await signed(),p,{nonce},resolver)).sub,'learner-1'));
test('reject wrong issuer',async()=>denied({},privateKey,{...p,issuer:'https://other.learnworlds.com'}));
test('reject wrong audience',async()=>denied({},privateKey,{...p,clientId:'other'}));
test('reject wrong nonce',async()=>denied({nonce:'wrong'}));
test('reject wrong deployment',async()=>denied({[CLAIM+'deployment_id']:'other'}));
test('reject wrong target',async()=>denied({[CLAIM+'target_link_uri']:'https://other.example'}));
test('reject missing resource/role',async()=>{await denied({[CLAIM+'resource_link']:null});await denied({[CLAIM+'roles']:[]})});
test('reject wrong signature',async()=>{const other=await generateKeyPair('RS256');await denied({},other.privateKey)});
test('reject expired launch',async()=>denied({exp:now-100,iat:now-400}));
test('course allowlist',async()=>denied({},privateKey,{...p,allowedContextIds:['other-course']}));
test('tampered and unsigned token rejected',async()=>{const token=await signed();const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...claims,sub:'impersonated'})).toString('base64url');await assert.rejects(()=>verifyLaunch(parts.join('.'),p,{nonce},resolver));await assert.rejects(()=>verifyLaunch('eyJhbGciOiJub25lIn0.e30.',p,{nonce},resolver))});
test('display name uses custom certification field; no HTML markup',()=>{assert.deepEqual(displayName({...claims,name:'User Name',[CLAIM+'custom']:{cf_certification_name:'Murat Özbilen'},given_name:'Murat'}),{certificationName:'Murat Özbilen',firstName:'Murat'});assert.equal(displayName({name:'<script>'}).certificationName,'')});
process.env.KV_REST_API_URL='https://kv.example';process.env.KV_REST_API_TOKEN='fake';const store=new Map();
globalThis.fetch=async(url,opts)=>{const a=JSON.parse(opts.body);let result=null;if(a[0]==='GET')result=store.get(a[1])||null;if(a[0]==='EVAL'){if(store.get(a[3])===a[4]){store.delete(a[3]);result=1}else result=0}return {ok:true,json:async()=>({result})}};
test('browser bound state consumed once; no cookie rejected',async()=>{const state='a'.repeat(43),binding='browser-random';store.set('cara:rm1:lti:state:'+digest(state),JSON.stringify({nonce,binding:digest(binding)}));await assert.rejects(()=>takeState({headers:{}},state));const req={headers:{cookie:cookieName(state)+'='+binding}};assert.equal((await takeState(req,state)).nonce,nonce);await assert.rejects(()=>takeState(req,state))});
test('session requires opaque server token; cannot impersonate uid',async()=>{await assert.rejects(()=>session({headers:{},body:{uid:'learner-1'}}));await assert.rejects(()=>session({headers:{authorization:'Bearer '+ 'a'.repeat(43)}}));const token='b'.repeat(43);store.set('cara:rm1:lti:session:'+digest(token),JSON.stringify({subject:'verified-subject-hash',caseId:'RM-1',expiresAt:Date.now()+1000}));assert.equal((await session({headers:{authorization:'Bearer '+token}})).subject,'verified-subject-hash')});
test('JWKS never reveals private parameters',async()=>{const priv=await exportJWK(privateKey);priv.kid='tool-test';process.env.RM1_TOOL_PRIVATE_JWK=JSON.stringify(priv);const keys=publicJwks();assert.equal(keys.keys[0].kid,'tool-test');for(const k of ['d','p','q','dp','dq','qi'])assert.equal(keys.keys[0][k],undefined)});

test('accept signed LearnWorlds Launch URL target',async()=>assert.equal((await verifyLaunch(await signed({[CLAIM+'target_link_uri']:LAUNCH}),p,{nonce},resolver)).sub,'learner-1'));
test('target allowlist rejects suffixes, query strings and missing target',async()=>{for(const target of [APP+'/',LAUNCH+'?x=1',LAUNCH+'/extra',null])await denied({[CLAIM+'target_link_uri']:target})});
