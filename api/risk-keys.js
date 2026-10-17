import {publicJwks,json} from './_lib/rm-auth.js';
export default function handler(req,res){if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});try{const keys=publicJwks();res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','public, max-age=3600');res.end(JSON.stringify(keys))}catch{return json(res,503,{error:'tool_key_not_configured'})}}
