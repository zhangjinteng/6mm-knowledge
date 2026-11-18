import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:8080';
const identity=JSON.parse(fs.readFileSync(process.argv[3]||'/data/config/service-identity.json','utf8'));
const headers={Authorization:`Bearer ${identity.apiKey}`,'Content-Type':'application/json'};
const response=await fetch(base+'/api/common/file/presignTempFilePostUrl',{
  method:'POST',headers,body:JSON.stringify({filename:'storage-smoke.txt'}),signal:AbortSignal.timeout(15000)
});
assert.equal(response.status,200);
const {data}=await response.json();
const localUrl=value=>{
  const url=new URL(value,base);
  url.protocol=new URL(base).protocol;
  url.host=new URL(base).host;
  return url;
};
const bytes=Buffer.from('Knowledge signed storage test 2026\n');
const upload=await fetch(localUrl(data.url),{method:'PUT',headers:data.headers,body:bytes,signal:AbortSignal.timeout(15000)});
assert.equal(upload.status,200,await upload.text());
console.log('PASS signed text upload with returned Content-Type');
const download=await fetch(localUrl(data.previewUrl),{signal:AbortSignal.timeout(15000)});
assert.equal(download.status,200);
assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
console.log('PASS signed download bytes match');
const invalid=await fetch(base+'/api/system/file/download/invalid-token',{signal:AbortSignal.timeout(15000)});
assert.notEqual(invalid.status,200);
console.log('PASS malformed download signature rejected');
