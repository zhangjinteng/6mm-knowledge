import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {serializerCompiler,validatorCompiler}from'fastify-type-provider-zod';
import routes from '../src/modules/dataset/dataset.routes.ts';
import {DatasetRepository}from'../src/modules/dataset/dataset.repository.ts';
import {datasetRouteDefinitions}from'../src/modules/dataset/dataset.route-map.ts';
import {matchesServiceKey}from'../src/identity.ts';

test('all 60 HTTP paths dispatch to a real repository method (mocked persistence)',async()=>{
  const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  const methods=Object.getOwnPropertyNames(DatasetRepository.prototype).filter(n=>!['constructor','findRoute','listRoutes'].includes(n));
  const originals=new Map();
  for(const name of methods){originals.set(name,DatasetRepository.prototype[name]);DatasetRepository.prototype[name]=async()=>({method:name});}
  try{
    await app.register(routes,{prefix:'/api/core/dataset'});
    for(const definition of datasetRouteDefinitions){
      const response=await app.inject({method:'POST',url:'/api/core/dataset'+definition.path,payload:{}});
      assert.equal(response.statusCode,200,definition.path);
      assert.equal(response.json().code,200,definition.path);
      assert.ok(originals.has(response.json().data.method),definition.path);
    }
  }finally{for(const[name,value]of originals)DatasetRepository.prototype[name]=value;await app.close();}
});

test('exports return actual CSV bytes without JSON wrapping (mocked persistence)',async()=>{
  const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  const old=DatasetRepository.prototype.exportAllDataset;
  DatasetRepository.prototype.exportAllDataset=async()=>({filename:'test.csv',contentType:'text/csv',content:'q,a\nhello,world'});
  try{
    await app.register(routes,{prefix:'/api/core/dataset'});
    const r=await app.inject({url:'/api/core/dataset/exportAll?datasetId=x'});
    assert.equal(r.statusCode,200);assert.match(r.headers['content-type'],/text\/csv/);assert.equal(r.body,'q,a\nhello,world');
  }finally{DatasetRepository.prototype.exportAllDataset=old;await app.close();}
});

test('service key comparison rejects missing, malformed and wrong credentials',()=>{
  for(const header of [undefined,[],42,'secret','Basic secret','Bearer wrong'])assert.equal(matchesServiceKey(header,'secret'),false);
  assert.equal(matchesServiceKey('Bearer secret','secret'),true);
});
