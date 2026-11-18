import { initializeRuntime,closeRuntime } from './runtime.js';
import { importFastGptServiceVendorModule as service } from './common/vendor/fastgpt-vendor.js';
import {processImageTraining,isImageTrainingRunning}from'./image-training.js';
import {startDatasetSyncWorker}from'./dataset-sync.js';

const runtime=await initializeRuntime();
const { startTrainingQueue,createDatasetTrainingMongoWatch }=await import('../app/service/core/dataset/training/utils.ts');
const { initCollectionUpdateWorker }=await service('core/dataset/collection/mq');
const { initDatasetDeleteWorker }=await service('core/dataset/delete');
const { initS3MQWorker }=await service('common/s3');
initCollectionUpdateWorker();initDatasetDeleteWorker();await initS3MQWorker();
await startDatasetSyncWorker();
const watcher=createDatasetTrainingMongoWatch();
watcher.on('error',(error:any)=>console.error('Training change stream interrupted; periodic recovery remains active',error.name));
let stopping=false;
function scan() {if(!stopping){startTrainingQueue();void processImageTraining().catch(error=>console.error('Image training scan failed',error.name));}}
scan();
const scanTimer=setInterval(scan,5000);
const heartbeat=setInterval(()=>runtime.redis.set('knowledge:worker:heartbeat',String(Date.now()),'EX',30).catch(()=>{}),3000);
await runtime.redis.set('knowledge:worker:heartbeat',String(Date.now()),'EX',30);
async function stop() {
  if(stopping)return;stopping=true;clearInterval(scanTimer);clearInterval(heartbeat);await watcher.close();
  const start=Date.now();const globals=globalThis as any;
  while((globals.qaQueueLen||globals.vectorQueueLen||globals.datasetParseQueueLen||isImageTrainingRunning())&&Date.now()-start<45000) await new Promise(r=>setTimeout(r,100));
  await runtime.redis.del('knowledge:worker:heartbeat');await closeRuntime(runtime);process.exit(0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
