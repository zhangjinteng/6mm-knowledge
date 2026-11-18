import {importFastGptServiceVendorModule as service,importFastGptGlobalVendorModule as globalModule}from'./common/vendor/fastgpt-vendor.js';
import {DatasetRepository}from'./modules/dataset/dataset.repository.js';

export async function startDatasetSyncWorker(){
  const {getDatasetSyncWorker,reconcileDatasetSyncSchedulers}=await service('core/dataset/datasetSync');
  const {MongoDataset}=await service('core/dataset/schema');
  const {MongoDatasetCollection}=await service('core/dataset/collection/schema');
  const {syncCollection}=await service('core/dataset/collection/utils');
  const {DatasetCollectionTypeEnum}=await globalModule('core/dataset/constants');
  const repository=new DatasetRepository();
  getDatasetSyncWorker(async(job:any)=>{
    const dataset=await MongoDataset.findOne({_id:job.data.datasetId,deleteTime:{$exists:false}}).lean();
    if(!dataset)return;
    const collections=await MongoDatasetCollection.find({teamId:dataset.teamId,datasetId:dataset._id}).lean();
    let done=0;
    for(const collection of collections){
      if(collection.type===DatasetCollectionTypeEnum.link||collection.type===DatasetCollectionTypeEnum.apiFile){
        await syncCollection({...collection,dataset});
      }
      if(dataset.apiDatasetServer&&collection.type===DatasetCollectionTypeEnum.folder&&collection.apiFileId){
        // The original importer records explicitly selected source folders. Reusing it
        // discovers new files without importing unrelated folders or deleting user data.
        await repository.createApiDatasetCollection({
          teamId:dataset.teamId,tmbId:dataset.tmbId,dataset,
          apiFiles:[{id:collection.apiFileId,name:collection.name,type:'folder',hasChild:true}],
          customPdfParse:collection.customPdfParse,
          trainingType:collection.trainingType,chunkSize:collection.chunkSize,indexSize:collection.indexSize,
          chunkSettingMode:collection.chunkSettingMode,chunkSplitMode:collection.chunkSplitMode,
          chunkTriggerType:collection.chunkTriggerType,chunkTriggerMinSize:collection.chunkTriggerMinSize
        });
      }
      await job.updateProgress(++done/Math.max(collections.length,1)*100);
    }
    return{checked:done};
  });
  await reconcileDatasetSyncSchedulers();
}
