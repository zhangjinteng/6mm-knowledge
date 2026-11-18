import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {serializerCompiler,validatorCompiler} from 'fastify-type-provider-zod';
import routes from '../src/modules/file-storage/file-storage.routes.ts';
import {FileStorageService} from '../src/modules/file-storage/file-storage.service.ts';

test('signed uploads retain bytes for text, JSON, PDF and Office MIME types',async()=>{
  const app=Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const original=FileStorageService.prototype.uploadFile;
  FileStorageService.prototype.uploadFile=async(_token,body)=>{
    assert.equal(typeof body.pipe,'function');
    const chunks=[];
    for await(const chunk of body)chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks),Buffer.from('binary\u0000upload\n2026'));
    return {uploaded:true};
  };
  try{
    await app.register(routes);
    for(const type of ['text/plain','text/markdown','text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream']){
      const r=await app.inject({method:'PUT',url:'/api/system/file/upload/test-token',headers:{'content-type':type},payload:Buffer.from('binary\u0000upload\n2026')});
      assert.equal(r.statusCode,200,type);
      assert.equal(r.json().data.uploaded,true,type);
    }
  }finally{
    FileStorageService.prototype.uploadFile=original;
    await app.close();
  }
});
