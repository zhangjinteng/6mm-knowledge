import fs from 'node:fs';
import assert from 'node:assert/strict';
const {initializeRuntime,closeRuntime}=await import('../src/runtime.ts');
const {importFastGptServiceVendorModule:service}=await import('../src/common/vendor/fastgpt-vendor.ts');
const runtime=await initializeRuntime();
try{
  const {readFileContentByBuffer}=await service('common/file/read/utils');
  for(const [name,customPdfParse]of [['native.pdf',false],['scanned.pdf',true]]){
    const result=await readFileContentByBuffer({teamId:'000000000000000000000001',tmbId:'000000000000000000000002',extension:'pdf',buffer:fs.readFileSync(`/tmp/knowledge-fixtures/${name}`),encoding:'utf-8',customPdfParse});
    assert.match(result.rawText,/KNOWLEDGE\s+OCR\s+TEST\s+ALPHA\s+2026/i);console.log(`PASS ${name}: upstream parser${customPdfParse?' + real OCR':''}`);
  }
}finally{await closeRuntime(runtime);}
