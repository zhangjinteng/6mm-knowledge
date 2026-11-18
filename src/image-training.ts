import {importFastGptServiceVendorModule as service,importFastGptGlobalVendorModule as globalModule}from'./common/vendor/fastgpt-vendor.js';

let running=false;
export async function processImageTraining(){
  if(running)return;running=true;
  let task:any;
  const {MongoDatasetTraining}=await service('core/dataset/training/schema');
  try{
    const {TrainingModeEnum}=await globalModule('core/dataset/constants');
    task=await MongoDatasetTraining.findOneAndUpdate({mode:{$in:[TrainingModeEnum.image,TrainingModeEnum.imageParse]},retryCount:{$gt:0},lockTime:{$lte:new Date(Date.now()-180000)}},{$set:{lockTime:new Date()},$inc:{retryCount:-1}},{new:true}).populate('dataset').populate('collection').lean();
    if(!task)return;
    if(!task.dataset||!task.collection){await MongoDatasetTraining.deleteOne({_id:task._id});return;}
    const {getVlmModel,getEmbeddingModel}=await service('core/ai/model');
    const model=getVlmModel(task.dataset.vlmModel);
    if(!model){
      if(!getEmbeddingModel(task.dataset.vectorModel)?.vision)throw Error('A vision or multimodal embedding model is required');
      await MongoDatasetTraining.updateOne({_id:task._id,lockTime:task.lockTime},{$set:{mode:TrainingModeEnum.chunk,model:task.dataset.vectorModel,lockTime:new Date(0)},$unset:{errorMsg:1}});
      return;
    }
    const {uniqueDatasetDataMarkdownImageUrls}=await service('core/dataset/data/utils');
    const {getS3DatasetSource}=await service('common/s3/sources/dataset');
    const {isS3ObjectKey}=await service('common/s3/utils');
    const {normalizeImageToBase64}=await service('core/dataset/search/utils');
    const urls=task.imageId?[task.imageId]:uniqueDatasetDataMarkdownImageUrls([task.q||'']);
    if(!urls.length)throw Error('No image source in training task');
    if(urls.length>10)throw Error('At most 10 images per training task');
    const descriptions:Record<string,string>={};
    for(const url of urls){
      let image;
      if(isS3ObjectKey(url,'dataset')){
        if(!url.startsWith(`dataset/${task.datasetId}/`))throw Error('Image does not belong to the dataset');
        image=await getS3DatasetSource().getDatasetBase64Image(url);
      }else{image=await normalizeImageToBase64(url);}
      const response=await fetch(model.requestUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${model.requestAuth}`},body:JSON.stringify({model:model.model,...model.defaultConfig,messages:[{role:'user',content:[{type:'text',text:'提取图片中的文字、表格和事实信息，用于知识库检索。不要编造无法识别的内容。'},{type:'image_url',image_url:{url:image}}]}],max_tokens:Math.min(model.maxResponse||2048,4096)}),signal:AbortSignal.timeout(120000)});
      const data=await response.json();const description=data.choices?.[0]?.message?.content;
      if(!response.ok||typeof description!=='string'||!description.trim())throw Error(`Vision provider rejected request (${response.status})`);
      descriptions[url]=description.trim();
    }
    const q=task.imageId?Object.values(descriptions)[0]:[task.q||'',...Object.values(descriptions)].join('\n\n');
    await MongoDatasetTraining.updateOne({_id:task._id,lockTime:task.lockTime},{$set:{q,imageDescMap:{...task.imageDescMap,...descriptions},mode:TrainingModeEnum.chunk,model:task.dataset.vectorModel,lockTime:new Date(0)},$unset:{errorMsg:1}});
  }catch(error:any){
    if(task)await MongoDatasetTraining.updateOne({_id:task._id,lockTime:task.lockTime},{$set:{errorMsg:error.message||'Image training failed'}});
    else throw error;
  }finally{running=false;}
}
export function isImageTrainingRunning(){return running;}
