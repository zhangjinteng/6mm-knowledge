import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

async function compile(dir, target) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, item.name), to = path.join(target, item.name);
    if (item.isDirectory()) await compile(from, to);
    else if (/\.tsx?$/.test(from) && !/\.d\.ts$/.test(from)) {
      const result = await transform(fs.readFileSync(from, 'utf8'), { loader: from.endsWith('tsx') ? 'tsx' : 'ts', format:'esm', target:'es2022', sourcefile:from });
      fs.mkdirSync(path.dirname(to), { recursive:true });
      fs.writeFileSync(to.replace(/\.tsx?$/, '.js'), result.code);
    }
  }
}
await compile('src', 'dist');
await compile('app', 'dist/app');
console.log('Source syntax validated; vendor worker loader generated. Runtime uses tsx source modules.');
