import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:8080';
const identity=JSON.parse(fs.readFileSync(process.argv[3]||'/data/config/service-identity.json','utf8'));
const headers={Authorization:`Bearer ${identity.apiKey}`,'Content-Type':'application/json'};
async function call(path,body,auth=true){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:auth?headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const data=await r.json();return{status:r.status,data};
}
for(const path of ['/health/live','/health/ready']){
  const r=await call(path);assert.equal(r.status,200,path);console.log(`PASS ${path}`);
}
const unauth=await call('/api/core/dataset/list',{},false);assert.equal(unauth.status,401);console.log('PASS anonymous rejected');
const list=await call('/api/core/dataset/list',{});assert.equal(list.status,200,JSON.stringify(list.data));assert.equal(list.data.code,200);console.log('PASS authenticated dataset list');
const paths=await call('/api/core/dataset/paths?type=current');assert.equal(paths.status,200,JSON.stringify(paths.data));console.log('PASS authenticated root paths');
const cap=await call('/api/knowledge/capabilities');assert.equal(cap.status,200);
if(!cap.data.data.embedding){
  const blocked=await call('/api/core/dataset/create',{name:'smoke-missing-model'});
  assert.equal(blocked.status,503);console.log('PASS missing embedding explicitly rejected (NOT an ingestion pass)');
}
console.log('Core HTTP smoke completed. Ingestion/search/external providers require separate acceptance.');
