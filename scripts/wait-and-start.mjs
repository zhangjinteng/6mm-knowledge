import fs from 'node:fs';
import {spawn}from'node:child_process';
const name=process.argv[2];
if(!['server','worker'].includes(name))throw Error('Unknown process');
for(let i=0;!fs.existsSync('/data/infrastructure-ready');i++){
  if(i>=180)throw Error('Infrastructure readiness timeout');
  await new Promise(r=>setTimeout(r,1000));
}
const child=spawn(process.execPath,['--import','tsx',`src/${name}.ts`],{stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
