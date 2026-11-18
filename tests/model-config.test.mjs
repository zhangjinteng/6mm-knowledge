import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilities}from'../src/config.ts';
test('LLM alone is not advertised as embedding, vision, OCR or rerank',()=>{
  const c=capabilities([{type:'llm',isActive:true}],{});
  assert.equal(c.llm,true);for(const key of ['embedding','vision','rerank','enhancedPdf'])assert.equal(c[key],false);
  assert.equal(c.externalSources.feishu,'implemented-not-live-tested');
});
test('disabled models do not enable capabilities',()=>assert.equal(capabilities([{type:'embedding',isActive:false}],{}).embedding,false));
