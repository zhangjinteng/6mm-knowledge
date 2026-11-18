import fs from 'node:fs';
import pg from 'pg';
import { importFastGptServiceVendorModule as service } from './common/vendor/fastgpt-vendor.js';
import { readModels, runtimeFile, capabilities } from './config.js';

export async function initializeRuntime() {
  for (const key of ['MONGODB_URI','MONGODB_LOG_URI','PG_URL','REDIS_URL','STORAGE_S3_ENDPOINT','TOKEN_KEY','FILE_TOKEN_KEY','AES256_SECRET_KEY','ROOT_KEY']) {
    if (!process.env[key]) throw new Error(`Required environment variable missing: ${key}`);
  }
  const globals = globalThis as any;
  const systemConfig = fs.existsSync(runtimeFile) ? JSON.parse(fs.readFileSync(runtimeFile,'utf8')) : {};
  globals.systemEnv = {
    qaMaxProcess:1, vectorMaxProcess:1, datasetParseMaxProcess:1, hnswEfSearch:100,
    ...systemConfig.systemEnv
  };
  globals.feConfigs = { isPlus:false, show_dataset_enhance:false, uploadFileMaxSize:20, uploadFileMaxAmount:20,
    limit:{exportDatasetLimitMinutes:0,websiteSyncLimitMinuted:0},
    showCustomPdfParse: !!globals.systemEnv.customPdfParse,
    customPdfParsePrice:0
  };
  globals.subPlans = {};
  globals.systemVersion = '6mm-knowledge/0.1.0';
  globals.datasetParseQueueLen = 0; globals.qaQueueLen=0; globals.vectorQueueLen=0;
  // These match upstream Community behavior, not a bypass of a licensed Pro service.
  globals.textCensorHandler = async () => ({code:200});
  globals.authOpenApiHandler = async ({openApi}: any) => {
    if (openApi.limit?.expiredTime && new Date(openApi.limit.expiredTime).getTime() <= Date.now()) throw new Error('API key expired');
    if (openApi.limit?.maxUsagePoints >= 0 && openApi.usagePoints >= openApi.limit.maxUsagePoints) throw new Error('API key usage limit reached');
  };
  globals.createUsageHandler = () => undefined;
  globals.concatUsageHandler = () => undefined;
  globals.pushUsageItemsHandler = () => undefined;
  globals.deepRagHandler = async () => { throw Object.assign(new Error('DeepRAG requires a separately licensed upstream provider'),{statusCode:501}); };

  const { connectionMongo, connectionLogMongo } = await service('common/mongo');
  await Promise.all([connectionMongo,connectionLogMongo].map((db:any, i:number) => db.connect(i ? process.env.MONGODB_LOG_URI : process.env.MONGODB_URI, {
    maxPoolSize:5, serverSelectionTimeoutMS:10000, connectTimeoutMS:10000, socketTimeoutMS:60000
  })));
  const { getGlobalRedisConnection } = await service('common/redis');
  const redis = getGlobalRedisConnection();
  await redis.ping();
  const { initS3Buckets } = await service('common/s3');
  initS3Buckets();
  for (const bucket of Object.values(globals.s3BucketMap) as any[]) {
    await bucket.client.ensureBucket().catch((error:any)=>{
      if(error.Code!=='BucketAlreadyOwnedByYou')throw error;
    });
  }
  const { initVectorStore } = await service('common/vectorDB/controller');
  // Own the pool lifecycle; upstream connectPg retains its first checked-out connection.
  globals.pgClient ??= new pg.Pool({connectionString:process.env.PG_URL,max:5,min:0,connectionTimeoutMillis:5000,query_timeout:60000,statement_timeout:60000});
  await globals.pgClient.query('SELECT 1');
  await initVectorStore();
  const { PgClient } = await service('common/vectorDB/pg/controller');
  // Upstream initVectorStore logs and swallows errors: explicitly assert initialization.
  await PgClient.query('SELECT vector FROM modeldata LIMIT 0');

  const models = readModels();
  globals.systemModelList=models;
  globals.systemActiveModelList=models.filter((m:any)=>m.isActive!==false);
  for (const [type,key] of [['llm','llmModelMap'],['embedding','embeddingModelMap'],['rerank','reRankModelMap'],['tts','ttsModelMap'],['stt','sttModelMap']]) {
    const items=globals.systemActiveModelList.filter((m:any)=>m.type===type);
    globals[key]=new Map(items.flatMap((m:any)=>[[m.model,m],[m.name,m]]));
  }
  globals.systemDefaultModel = {
    llm:globals.systemActiveModelList.find((m:any)=>m.type==='llm'),
    datasetTextLLM:globals.systemActiveModelList.find((m:any)=>m.type==='llm'),
    datasetImageLLM:globals.systemActiveModelList.find((m:any)=>m.type==='llm'&&m.vision),
    embedding:globals.systemActiveModelList.find((m:any)=>m.type==='embedding'),
    rerank:globals.systemActiveModelList.find((m:any)=>m.type==='rerank')
  };
  globals.systemActiveDesensitizedModels=models.map(({requestAuth,requestUrl,...m}:any)=>m);
  return { mongo:connectionMongo, logMongo:connectionLogMongo, redis, pg:PgClient, capabilities:capabilities(models,globals.systemEnv) };
}

export async function closeRuntime(runtime:any) {
  const globals=globalThis as any;
  for(const worker of globals.workers?.values() || []) worker.removeAllListeners('closed');
  await Promise.all([...(globals.workers?.values() || [])].map((w:any)=>w.close()));
  await Promise.all([...(globals.queues?.values() || [])].map((q:any)=>q.close()));
  for(const pool of Object.values(globals.workerPoll || {}) as any[]) {
    for(const item of pool.workerQueue || []) await item.worker.terminate();
  }
  await Promise.all([runtime.mongo.disconnect(),runtime.logMongo.disconnect(),runtime.redis.quit()]);
  if(globals.pgClient)await globals.pgClient.end();
}
