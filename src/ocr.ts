import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile}from'node:child_process';
import {promisify}from'node:util';

const exec=promisify(execFile);
const app=Fastify({bodyLimit:20*1024*1024,logger:false});
await app.register(multipart,{limits:{files:1,fields:2,fileSize:20*1024*1024}});
let busy=false;
const command=(bin:string,args:string[])=>exec(bin,args,{timeout:60000,maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C'}});
app.get('/health',async()=>({status:'ok'}));
app.post('/parse',async(req,reply)=>{
  if(busy)return reply.code(429).send({error:'OCR service busy'});
  busy=true;let dir;
  try{
    const part=await req.file();if(!part) return reply.code(400).send({error:'PDF file required'});
    const buffer=await part.toBuffer();
    if(buffer.subarray(0,5).toString()!=='%PDF-')return reply.code(400).send({error:'Invalid PDF signature'});
    dir=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-ocr-'));
    const file=path.join(dir,'input.pdf');await fs.writeFile(file,buffer,{mode:0o600});
    const {stdout:info}=await command('pdfinfo',[file]);
    const pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if(!pages||pages>30)return reply.code(422).send({error:'PDF must contain 1 to 30 pages'});
    const sections=[];
    for(let page=1;page<=pages;page++){
      const {stdout:native}=await command('pdftotext',['-f',String(page),'-l',String(page),'-layout',file,'-']);
      let text=native.trim();
      if(text.replace(/\s/g,'').length<30){
        const prefix=path.join(dir,`page-${page}`);
        await command('pdftoppm',['-f',String(page),'-l',String(page),'-scale-to','1800','-singlefile','-png',file,prefix]);
        const {stdout:ocr}=await command('tesseract',[`${prefix}.png`,'stdout','-l','eng+chi_sim']);
        text=ocr.trim();await fs.rm(`${prefix}.png`,{force:true});
      }
      sections.push(`## Page ${page}\n\n${text}`);
      if(sections.join('\n\n').length>4*1024*1024)throw Error('Parsed output exceeds limit');
    }
    return {pages,markdown:sections.join('\n\n'),engine:'poppler+tesseract'};
  }catch(error:any){return reply.code(422).send({error:error.code==='FST_REQ_FILE_TOO_LARGE'?'PDF exceeds 20 MB':'PDF parsing failed'});}
  finally{busy=false;if(dir)await fs.rm(dir,{recursive:true,force:true});}
});
process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
await app.listen({host:'127.0.0.1',port:9002});
