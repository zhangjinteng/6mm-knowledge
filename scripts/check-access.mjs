import fs from 'node:fs';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const base=process.argv[2]||'http://127.0.0.1:8080';
const routes=JSON.parse(fs.readFileSync('upstream/routes.json','utf8'));
for(const {path}of routes){
  const r=await fetch(base+'/api/core/dataset'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)
  });
  assert.equal(r.status,401,path);
}
console.log(`PASS all ${routes.length} dataset paths reject anonymous requests (not business success acceptance)`);

if(process.env.KNOWLEDGE_FIXTURE_TESTS!=='true'){
  console.log('SKIP cross-team fixture: opt in only against an isolated test database');
  process.exit(0);
}
const client=await new mongoose.mongo.MongoClient(process.env.MONGODB_URI).connect();
const fixtures=client.db().collection('datasets');
const id=new mongoose.Types.ObjectId();
try{
  await fixtures.insertOne({_id:id,teamId:new mongoose.Types.ObjectId(),tmbId:new mongoose.Types.ObjectId(),name:'disposable-cross-team-access-probe',type:'dataset'});
  const identity=JSON.parse(fs.readFileSync('/data/config/service-identity.json','utf8'));
  const r=await fetch(base+'/api/core/dataset/file/presignDatasetFilePostUrl',{
    method:'POST',headers:{Authorization:`Bearer ${identity.apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({filename:'probe.txt',datasetId:String(id)}),signal:AbortSignal.timeout(15000)
  });
  const data=await r.json();
  assert.notEqual(data.code,200);
  assert.equal(data.statusText,'unAuthDataset');
  console.log('PASS real cross-team fixture denied with upstream unAuthDataset');
}finally{
  await fixtures.deleteOne({_id:id});
  await client.close();
}
