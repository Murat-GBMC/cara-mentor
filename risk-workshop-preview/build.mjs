import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const data=JSON.parse(process.env.RM1_CASE_JSON||'null');if(!data?.documents||data.documents.length!==7)throw Error('RM1_CASE_JSON missing or invalid');
mkdirSync('public',{recursive:true});writeFileSync('public/index.html',readFileSync('template.html','utf8').replace('__CONTENT__',JSON.stringify(data).replaceAll('</','<\\/')));
