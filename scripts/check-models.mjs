import fs from 'node:fs';
const file=process.argv[2]||'private/models.json';
const models=JSON.parse(fs.readFileSync(file,'utf8'));
for(const model of models){
  const body=model.type==='embedding'?{model:model.model,input:['Knowledge service connection test'],encoding_format:'float'}:
    model.type==='llm'?{model:model.model,messages:[{role:'user',content:'Reply OK'}],max_tokens:4,stream:false}:null;
  if(!body){console.log(JSON.stringify({type:model.type,model:model.model,result:'not-tested'}));continue;}
  try{
    const r=await fetch(model.requestUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${model.requestAuth}`},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const json=await r.json();
    const valid=model.type==='embedding'?Array.isArray(json.data?.[0]?.embedding):typeof json.choices?.[0]?.message?.content==='string';
    console.log(JSON.stringify({type:model.type,model:model.model,httpStatus:r.status,result:r.ok&&valid?'passed':'failed',...(model.type==='embedding'&&valid?{dimensions:json.data[0].embedding.length}:{})}));
  }catch(error){console.log(JSON.stringify({type:model.type,model:model.model,result:'failed',error:error.name}));}
}
