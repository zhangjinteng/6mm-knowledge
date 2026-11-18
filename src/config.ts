import fs from 'node:fs';

export const dataDir = process.env.KNOWLEDGE_DATA_DIR || '/data';
export const modelsFile = process.env.KNOWLEDGE_MODELS_FILE || `${dataDir}/config/models.json`;
export const runtimeFile = process.env.KNOWLEDGE_RUNTIME_FILE || `${dataDir}/config/runtime.json`;

export function readModels() {
  if (!fs.existsSync(modelsFile)) return [];
  const models = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
  if (!Array.isArray(models)) throw new Error('models.json must contain an array');
  for (const model of models) {
    if (!['llm','embedding','rerank'].includes(model.type) || !model.model || !model.requestUrl) throw new Error('Invalid model configuration');
    const url = new URL(model.requestUrl);
    if (url.protocol !== 'https:' && process.env.ALLOW_TEST_MODEL_HTTP !== 'true') throw new Error('Model endpoint must use HTTPS');
    if (url.username || url.password) throw new Error('Do not embed credentials in model URLs');
  }
  return models;
}

export function capabilities(models: any[], system: any) {
  return {
    embedding: models.some(m => m.type === 'embedding' && m.isActive !== false),
    llm: models.some(m => m.type === 'llm' && m.isActive !== false),
    vision: models.some(m => m.type === 'llm' && m.vision && m.isActive !== false),
    rerank: models.some(m => m.type === 'rerank' && m.isActive !== false),
    enhancedPdf: !!(system.customPdfParse?.url || system.customPdfParse?.textinAppId || system.customPdfParse?.doc2xKey),
    externalSources: { feishu: 'implemented-not-live-tested', dingtalk:'implemented-not-live-tested', yuque:'implemented-not-live-tested' },
    deepRag: false
  };
}
