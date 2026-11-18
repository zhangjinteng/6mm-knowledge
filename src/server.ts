import Fastify from 'fastify';
import fs from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import datasetRoutes from './modules/dataset/dataset.routes.js';
import fileRoutes from './modules/file-storage/file-storage.routes.js';
import { errorHandler } from './common/errors/error-handler.js';
import { initializeRuntime,closeRuntime } from './runtime.js';
import { serviceIdentity,matchesServiceKey } from './identity.js';
import { dataDir } from './config.js';
import { importFastGptServiceVendorModule as service } from './common/vendor/fastgpt-vendor.js';

const runtime=await initializeRuntime();
const identity=await serviceIdentity();
const app=Fastify({bodyLimit:20*1024*1024,requestTimeout:120000,logger:{level:'info',redact:['req.headers.authorization','req.headers.token','req.headers.cookie','*.requestAuth','*.apiKey','*.password']}});
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.setErrorHandler(errorHandler);
await app.register(rateLimit,{max:120,timeWindow:60000});
await app.register(swagger,{openapi:{info:{title:'6MM Knowledge API',version:'0.1.0'},components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}}},security:[{bearerAuth:[]}]},transform:jsonSchemaTransform});
app.addHook('onRequest',async(req,reply)=>{
  if(req.url==='/health/live'||req.url==='/health/ready') return;
  if(req.url.startsWith('/docs')||req.url==='/api/knowledge/openapi.json')return;
  // File URLs carry narrowly scoped signed tokens; their original handlers verify them.
  if(req.url.startsWith('/api/system/file/')||req.url.startsWith('/api/common/file/read/')) return;
  if(matchesServiceKey(req.headers.authorization,identity.apiKey)) {
    const {authOpenApiKey}=await service('support/openapi/auth');
    await authOpenApiKey({apikey:identity.apiKey});
    await runtime.redis.expire(`session:${identity.token}`,7*24*60*60);
    req.headers.token=identity.token;
    return;
  }
  // Existing upstream sessions/API keys are still checked by the original tenant-aware handlers.
  if(req.url.startsWith('/api/') && (req.headers.authorization||req.headers.token||req.headers.cookie)) {
    const {parseHeaderCert}=await service('support/permission/auth/common');
    await parseHeaderCert({req,authToken:true,authApiKey:true});
    return;
  }
  return reply.code(401).send({code:401,message:'需要有效的知识库凭据',data:null});
});
app.addHook('preValidation',async(req,reply)=>{
  if(!runtime.capabilities.embedding&&['/api/core/dataset/create','/api/core/dataset/createWithFiles','/api/core/dataset/searchTest'].includes(req.url.split('?')[0])){
    return reply.code(503).send({code:503,message:'Embedding 模型尚未配置，请先配置真实向量模型 API',data:null});
  }
});
app.get('/health/live',async()=>({status:'ok'}));
app.get('/health/ready',async(_req,reply)=>{
  try {
    await Promise.all([runtime.mongo.connection.db.admin().ping(),runtime.redis.ping(),runtime.pg.query('SELECT 1'),fetch('http://127.0.0.1:9000/minio/health/live',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)throw Error('storage');})]);
    const heartbeat=Number(await runtime.redis.get('knowledge:worker:heartbeat'));
    if(!heartbeat||Date.now()-heartbeat>20000) throw Error('worker heartbeat expired');
    if((globalThis as any).systemEnv.customPdfParse?.url==='http://127.0.0.1:9002/parse'){
      const r=await fetch('http://127.0.0.1:9002/health',{signal:AbortSignal.timeout(2000)});
      if(!r.ok)throw Error('OCR service unavailable');
    }
    return {status:'ready',capabilities:runtime.capabilities};
  } catch {return reply.code(503).send({status:'not-ready'});}
});
app.get('/api/knowledge/capabilities',async()=>({code:200,data:runtime.capabilities}));
await app.register(swaggerUI,{routePrefix:'/docs'});
app.get('/api/knowledge/openapi.json',async()=>app.swagger());
await app.register(datasetRoutes,{prefix:'/api/core/dataset'});
await app.register(fileRoutes);
let stopping=false;
async function stop() {
  if(stopping)return; stopping=true;
  await app.close(); await closeRuntime(runtime); process.exit(0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
await app.listen({port:Number(process.env.PORT||8080),host:process.env.HOST||'127.0.0.1'});
fs.mkdirSync(dataDir,{recursive:true});
