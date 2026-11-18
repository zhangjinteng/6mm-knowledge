import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

const project=process.argv[2]||'/Users/mac/PhpstormProjects/agent/6mm-workflow';
const target=process.argv[3]||'private/models.json';
const { MongoClient }=createRequire(`${project}/package.json`)('mongodb');
const e=parseEnv(fs.readFileSync(`${project}/.env.local`,'utf8'));
const client=new MongoClient(`mongodb://${e.MONGODB_HOST}:${e.MONGODB_PORT||27017}`,{
  auth:{username:e.MONGODB_USER,password:e.MONGODB_PASSWORD},
  authSource:e.MONGODB_AUTH_SOURCE||e.MONGODB_DATABASE,
  tls:e.MONGODB_TLS==='true',serverSelectionTimeoutMS:5000,maxPoolSize:1
});
try {
  await client.connect(); const db=client.db(e.MONGODB_DATABASE||'workflow');
  const rows=await db.collection('workflow16080_models').find({deletedAt:{$exists:false},'metadata.isActive':true}).toArray();
  const result=[];
  for(const row of rows) {
    const m=row.metadata;
    if(!['llm','embedding','rerank'].includes(m.type))continue;
    if(m.protocol!=='openai') {console.warn(`Skipping unsupported protocol: ${m.protocol}`);continue;}
    const credential=await db.collection('workflow16080_credentials').findOne({_id:row.credentialId,modelId:row._id});
    if(!credential?.apiKey)continue;
    result.push({
      type:m.type,model:m.upstreamModel,name:m.name||m.upstreamModel,provider:m.providerId,isActive:true,isDefault:!result.some(r=>r.type===m.type),
      requestUrl:`${m.baseUrl.replace(/\/$/,'')}/${m.type==='llm'?'chat/completions':m.type==='embedding'?'embeddings':'rerank'}`,
      requestAuth:credential.apiKey,defaultConfig:m.defaultConfig||{},
      ...(m.type==='llm'?{maxContext:m.maxContext,maxResponse:m.maxResponse,quoteMaxToken:m.quoteMaxToken,functionCall:m.capabilities.includes('functionCall'),toolChoice:m.capabilities.includes('toolChoice'),vision:m.capabilities.includes('vision')}:{maxToken:8192,defaultToken:512,weight:1,batchSize:8,normalization:true})
    });
  }
  fs.mkdirSync(new URL('.',new URL(target,`file://${process.cwd()}/`)),{recursive:true,mode:0o700});
  fs.writeFileSync(target,JSON.stringify(result,null,2),{mode:0o600});
  fs.chmodSync(target,0o600);
  console.log(`Saved ${result.length} model configurations to ${target}; secrets not printed. Types: ${[...new Set(result.map(r=>r.type))].join(', ')}`);
} finally {await client.close();}
