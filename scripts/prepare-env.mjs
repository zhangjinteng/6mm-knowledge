import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const dir='/data/config';
const file=`${dir}/secrets.json`;
if(!fs.existsSync(file)) fs.writeFileSync(file,JSON.stringify(Object.fromEntries(['mongo','postgres','storage','token','file','aes','root'].map(k=>[k,randomBytes(32).toString('hex')]))),{mode:0o600,flag:'wx'});
const s=JSON.parse(fs.readFileSync(file,'utf8'));
fs.mkdirSync('/data/bootstrap',{recursive:true,mode:0o700});
if(!fs.existsSync('/data/bootstrap/mongo-admin'))fs.writeFileSync('/data/bootstrap/mongo-admin',randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
if(!fs.existsSync(`${dir}/runtime.json`))fs.writeFileSync(`${dir}/runtime.json`,JSON.stringify({systemEnv:{customPdfParse:{url:'http://127.0.0.1:9002/parse',price:0}}}),{mode:0o600});
if(!fs.existsSync(`${dir}/mongo.key`)) fs.writeFileSync(`${dir}/mongo.key`,randomBytes(256).toString('base64'),{mode:0o600});
fs.writeFileSync(`${dir}/pg-password`,s.postgres,{mode:0o600});
const e={
  MONGODB_URI:`mongodb://knowledge:${s.mongo}@127.0.0.1:27017/knowledge?authSource=admin&replicaSet=knowledge&directConnection=true`,
  MONGODB_LOG_URI:`mongodb://knowledge:${s.mongo}@127.0.0.1:27017/knowledge_logs?authSource=admin&replicaSet=knowledge&directConnection=true`,
  PG_URL:`postgresql://knowledge:${s.postgres}@127.0.0.1:5432/knowledge`,
  REDIS_URL:'redis://127.0.0.1:6379',
  STORAGE_S3_ENDPOINT:'http://127.0.0.1:9000',STORAGE_ACCESS_KEY_ID:'knowledge',STORAGE_SECRET_ACCESS_KEY:s.storage,
  MINIO_ROOT_USER:'knowledge',MINIO_ROOT_PASSWORD:s.storage,
  STORAGE_PUBLIC_BUCKET:'knowledge-public',STORAGE_PRIVATE_BUCKET:'knowledge-private',
  TOKEN_KEY:s.token,FILE_TOKEN_KEY:s.file,AES256_SECRET_KEY:s.aes,ROOT_KEY:s.root,
  OPENAI_BASE_URL:'https://api.openai.com/v1',CHAT_API_KEY:'configured-per-model',
  FE_DOMAIN:process.env.KNOWLEDGE_PUBLIC_URL||'http://127.0.0.1:8080',FILE_DOMAIN:process.env.KNOWLEDGE_PUBLIC_URL||'http://127.0.0.1:8080'
};
fs.writeFileSync(`${dir}/runtime.env`,Object.entries(e).map(([k,v])=>`export ${k}='${String(v).replaceAll("'","'\\''")}'`).join('\n')+'\n',{mode:0o600});
fs.rmSync('/data/infrastructure-ready',{force:true});
