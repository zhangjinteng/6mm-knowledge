import fs from 'node:fs';
import mongoose from 'mongoose';
import pg from 'pg';
const {MongoClient}=mongoose.mongo;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const secret=JSON.parse(fs.readFileSync('/data/config/secrets.json','utf8'));
const adminPassword=fs.readFileSync('/data/bootstrap/mongo-admin','utf8');
const authenticated=`mongodb://knowledge:${secret.mongo}@127.0.0.1:27017/admin?directConnection=true`;
let ready=false;
for(let attempt=0;attempt<90;attempt++) {
  let client;
  try {
    client=new MongoClient(authenticated,{serverSelectionTimeoutMS:1500});
    await client.connect();
    await client.db('admin').command({connectionStatus:1});
    ready=true;break;
  } catch {
    await client?.close();
    try {
      client=new MongoClient('mongodb://127.0.0.1:27017/admin?directConnection=true',{serverSelectionTimeoutMS:1500});
      await client.connect();const admin=client.db('admin');
      try{await admin.command({replSetInitiate:{_id:'knowledge',members:[{_id:0,host:'127.0.0.1:27017'}]}});}catch(err){if(!['AlreadyInitialized','Unauthorized'].includes(err.codeName))throw err;}
      if(!(await admin.command({hello:1})).isWritablePrimary)throw Error('Primary not elected');
      try{await admin.command({createUser:'knowledge-admin',pwd:adminPassword,roles:[{role:'userAdminAnyDatabase',db:'admin'}]});}catch(err){if(err.codeName!=='Unauthorized'&&err.codeName!=='UserAlreadyExists')throw err;}
      await client.close();
      client=new MongoClient(`mongodb://knowledge-admin:${adminPassword}@127.0.0.1:27017/admin?directConnection=true`,{serverSelectionTimeoutMS:1500});
      await client.connect();
      try{await client.db('admin').command({createUser:'knowledge',pwd:secret.mongo,roles:[{role:'readWrite',db:'knowledge'},{role:'readWrite',db:'knowledge_logs'},{role:'clusterMonitor',db:'admin'}]});}catch(err){if(err.codeName!=='UserAlreadyExists')throw err;}
    } catch { /* Wait for election or existing authenticated instance. */ }
  } finally {await client?.close();}
  await sleep(1000);
}
if(!ready)throw Error('Mongo initialization timed out');
for(let attempt=0;attempt<60;attempt++){
  const pool=new pg.Pool({host:'127.0.0.1',user:'knowledge',password:secret.postgres,database:'postgres',connectionTimeoutMillis:1500});
  try{
    const found=await pool.query("SELECT 1 FROM pg_database WHERE datname='knowledge'");
    if(!found.rowCount)await pool.query('CREATE DATABASE knowledge');
    await pool.end();break;
  }catch(err){await pool.end();if(attempt===59)throw err;await sleep(1000);}
}
for(let i=0;i<60;i++){
  try{const r=await fetch('http://127.0.0.1:9000/minio/health/live');if(r.ok)break;throw Error('storage');}
  catch(err){if(i===59)throw err;await sleep(1000);}
}
fs.writeFileSync('/data/infrastructure-ready',String(Date.now()),{mode:0o600});
console.log('Isolated infrastructure initialized');
