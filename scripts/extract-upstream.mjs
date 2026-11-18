import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv[2] || '/Users/mac/Github/workflow-zjt');
const require = createRequire(path.join(source, 'fastify/package.json'));
const ts = require('typescript');
const files = new Map();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function save(relative, data, origin) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  if (origin) files.set(relative, {
    source: path.relative(source, origin),
    sourceSha256: sha(fs.readFileSync(origin)),
    extractedSha256: sha(data)
  });
}

function copyTree(from, to) {
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (['node_modules', '.git', '.DS_Store', 'test', '__tests__'].includes(item.name)) continue;
    if (/\.test\.[cm]?[jt]sx?$/.test(item.name) || item.name.startsWith('.env')) continue;
    const origin = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) copyTree(origin, target);
    else if (item.isFile()) save(target, fs.readFileSync(origin), origin);
  }
}

// The vendor service is shared infrastructure. HTTP exposure is knowledge-only.
copyTree(path.join(source, 'fastify/vendor'), 'vendor');
copyTree(path.join(source, 'fastify/src/modules/dataset'), 'src/modules/dataset');
copyTree(path.join(source, 'fastify/src/modules/file-storage'), 'src/modules/file-storage');
copyTree(path.join(source, 'fastify/src/common/errors'), 'src/common/errors');
copyTree(path.join(source, 'fastify/src/common/http'), 'src/common/http');
copyTree(path.join(source, 'fastify/src/common/vendor'), 'src/common/vendor');
const yaml=createRequire(path.join(root,'package.json'))('js-yaml');
const workspace=yaml.load(fs.readFileSync(path.join(source,'fastify/pnpm-workspace.yaml'),'utf8'));
workspace.catalog['@fastify/multipart']='^9.4.0';
save('pnpm-workspace.yaml',yaml.dump(workspace));

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Unresolved upstream module: ${path.relative(source, base)}`);
}

const appRoot = path.join(source, 'projects/app/src');
const visited = new Set();
function extractApp(origin) {
  origin = resolveFile(origin);
  if (visited.has(origin)) return;
  visited.add(origin);
  const dest = path.join('app', path.relative(appRoot, origin));
  const text = fs.readFileSync(origin, 'utf8');
  const ast = ts.createSourceFile(origin, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function walk(node) {
    let value;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) value = node.moduleSpecifier;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) value = node.arguments[0];
    if (value && ts.isStringLiteral(value)) {
      const spec = value.text;
      let target;
      if (spec.startsWith('@fastgpt/service/')) target = path.join('vendor/service', spec.slice('@fastgpt/service/'.length));
      else if (spec.startsWith('@fastgpt/global/')) target = path.join('vendor/global', spec.slice('@fastgpt/global/'.length));
      else if (spec.startsWith('@/') || spec.startsWith('.')) {
        const dependency = resolveFile(spec.startsWith('@/') ? path.join(appRoot, spec.slice(2)) : path.resolve(path.dirname(origin), spec));
        target = path.join('app', path.relative(appRoot, dependency));
        if (!(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) extractApp(dependency);
      }
      if (target) {
        let relative = path.relative(path.dirname(dest), target).replaceAll(path.sep, '/');
        if (!relative.startsWith('.')) relative = `./${relative}`;
        edits.push({ start: value.getStart(ast), end: value.getEnd(), text: JSON.stringify(relative) });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  let output = text;
  for (const edit of edits.sort((a,b) => b.start-a.start)) output = output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  save(dest, output, origin);
}
extractApp(path.join(appRoot, 'service/core/dataset/training/utils.ts'));

const patchDir=path.join(root,'patches');
const patches=fs.existsSync(patchDir)?fs.readdirSync(patchDir).filter(n=>n.endsWith('.patch')).sort():[];
for(const patch of patches) execFileSync('git',['apply',path.join(patchDir,patch)],{cwd:root});
for(const [file,entry]of files)entry.extractedSha256=sha(fs.readFileSync(path.join(root,file)));

save('LICENSE', fs.readFileSync(path.join(source, 'LICENSE')), path.join(source, 'LICENSE'));
const routeText = fs.readFileSync(path.join(source, 'fastify/src/modules/dataset/dataset.route-map.ts'), 'utf8');
const routeAst = ts.createSourceFile('routes.ts', routeText, ts.ScriptTarget.Latest, true);
const routes = [];
function collect(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const props = Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).filter(p => ts.isStringLiteral(p.initializer)).map(p => [p.name.getText(routeAst).replaceAll("'", ''), p.initializer.text]));
    if (props.path && props.sourcePath) routes.push({ path: props.path, sourcePath: props.sourcePath, implementation: 'extracted', validation: 'not-run' });
  }
  ts.forEachChild(node, collect);
}
collect(routeAst);
if (routes.length !== 60) throw new Error(`Expected 60 dataset routes, found ${routes.length}`);
save('upstream/routes.json', JSON.stringify(routes, null, 2)+'\n');
save('upstream/manifest.json', JSON.stringify({
  sourceRepository: 'workflow-zjt',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
  note: 'Shared vendor infrastructure retained; only knowledge HTTP routes are registered. See LICENSE.',
  patches,
  files: Object.fromEntries([...files.entries()].sort(([a],[b]) => a.localeCompare(b)))
}, null, 2)+'\n');
console.log(`Extracted ${files.size} files, ${routes.length} routes, ${visited.size} training dependencies. No environment or business data copied.`);
