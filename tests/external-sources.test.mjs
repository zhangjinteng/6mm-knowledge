import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('Feishu, DingTalk, Yuque and custom API adapters use provider contracts (MOCK servers, not live accounts)',async()=>{
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://test');
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({path:url.pathname,headers:req.headers,body});
    let data;
    if(url.pathname.endsWith('/tenant_access_token/internal'))data={code:0,tenant_access_token:'mock-feishu-token'};
    else if(url.pathname==='/open-apis/drive/v1/files')data={code:0,data:{files:[{token:'fs-doc',parent_token:'folder',name:'FS mock',type:'docx',modified_time:1,created_time:1}],has_more:false}};
    else if(url.pathname==='/open-apis/docx/v1/documents/fs-doc/raw_content')data={code:0,data:{content:'Feishu mock content'}};
    else if(url.pathname==='/open-apis/docx/v1/documents/fs-doc')data={code:0,data:{document:{title:'FS mock',type:'docx'}}};
    else if(url.pathname==='/v1.0/oauth2/accessToken')data={accessToken:'mock-ding-token',expireIn:7200};
    else if(url.pathname==='/topapi/v2/user/get')data={errcode:0,result:{unionid:'operator'}};
    else if(url.pathname==='/v2.0/wiki/nodes')data={nodes:[{nodeId:'ding-doc',name:'Ding mock',type:'document'}]};
    else if(url.pathname==='/v2.0/wiki/nodes/ding-doc')data={node:{nodeId:'ding-doc',name:'Ding mock',type:'document'}};
    else if(url.pathname==='/v1.0/doc/suites/documents/ding-doc/blocks')data={blocks:[{text:'Ding mock content'}]};
    else if(url.pathname==='/api/v2/repos/1/toc')data={data:[{id:'2',uuid:'doc-uuid',type:'DOC',title:'Yuque mock',parent_uuid:''}]};
    else if(url.pathname==='/api/v2/repos/1/docs/2')data={data:{title:'Yuque mock',body:'Yuque mock content'}};
    else if(url.pathname==='/v1/file/list')data={success:true,data:[{id:'custom-doc',name:'Custom mock',type:'file'}]};
    else if(url.pathname==='/v1/file/content')data={success:true,data:{title:'Custom mock',content:'Custom mock content'}};
    else{res.writeHead(404);res.end('{}');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env,{NODE_ENV:'development',FILE_TOKEN_KEY:'mock-file-token',AES256_SECRET_KEY:'mock-aes-key',FEISHU_BASE_URL:base,DINGTALK_BASE_URL:base,DINGTALK_OAPI_BASE_URL:base,YUQUE_DATASET_BASE_URL:base});
  const cache=new Map();globalThis.redisClient={get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v),del:async k=>cache.delete(k)};
  try{
    const {importFastGptServiceVendorModule:service}=await import('../src/common/vendor/fastgpt-vendor.ts');
    const {getApiDatasetRequest}=await service('core/dataset/apiDataset');
    const feishu=await getApiDatasetRequest({feishuServer:{appId:'mock-app',appSecret:'mock-secret',folderToken:'folder'}});
    assert.equal((await feishu.listFiles({}))[0].id,'fs-doc');
    assert.equal((await feishu.getFileContent({apiFileId:'fs-doc'})).rawText,'Feishu mock content');
    const ding=await getApiDatasetRequest({dingtalkServer:{appKey:'mock-app',appSecret:'mock-secret',userId:'user',rootNodeId:'root'}});
    assert.equal((await ding.listFiles({}))[0].id,'ding-doc');
    assert.match((await ding.getFileContent({apiFileId:'ding-doc'})).rawText,/Ding mock content/);
    const yuque=await getApiDatasetRequest({yuqueServer:{userId:'user',token:'mock-token',basePath:'1'}});
    assert.equal((await yuque.listFiles({}))[0].id,'1-2-doc-uuid');
    assert.equal((await yuque.getFileContent({apiFileId:'1-2-doc-uuid'})).rawText,'Yuque mock content');
    const custom=await getApiDatasetRequest({apiServer:{baseUrl:base,authorization:'mock-token'}});
    assert.equal((await custom.listFiles({}))[0].id,'custom-doc');
    assert.equal((await custom.getFileContent({apiFileId:'custom-doc'})).rawText,'Custom mock content');
    assert.ok(requests.some(r=>r.headers['x-auth-token']==='mock-token'));
    assert.ok(requests.some(r=>r.headers['x-acs-dingtalk-access-token']==='mock-ding-token'));
    assert.ok(requests.some(r=>r.headers.authorization==='Bearer mock-feishu-token'));
  }finally{await new Promise(r=>server.close(r));delete globalThis.redisClient;}
});
