import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
test('60 distinct knowledge routes and two download routes are inventoried', () => {
  const routes = JSON.parse(fs.readFileSync(new URL('upstream/routes.json', root)));
  assert.equal(routes.length, 60);
  assert.equal(new Set(routes.map(r => r.path)).size, 60);
  for (const p of ['/exportAll', '/collection/export', '/searchTest']) assert.ok(routes.some(r => r.path === p));
});
test('extracted snapshot matches manifest and contains no secrets or production data', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('upstream/manifest.json', root)));
  for (const [file, entry] of Object.entries(manifest.files)) {
    assert.ok(!/(^|\/)(\.env[^/]*|node_modules)(\/|$)/.test(file), file);
    assert.ok(!file.startsWith('data/'), file);
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file, root))).digest('hex'), entry.extractedSha256, file);
  }
});
test('real upstream parse, QA and vector consumers are included', () => {
  for (const name of ['datasetParse', 'generateQA', 'generateVector']) {
    assert.ok(fs.existsSync(new URL(`app/service/core/dataset/queues/${name}.ts`, root)));
  }
});
