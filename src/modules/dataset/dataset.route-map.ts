import type { DatasetRouteDefinition } from '@/modules/dataset/dataset.types.js';

/** dataset 原版 API 在 Fastify 中的统一路由前缀。 */
export const DatasetRoutePrefix = '/api/core/dataset';

/**
 * dataset 原版 NextJS 接口与 Fastify 原生实现的迁移清单。
 *
 * 该清单同时用于路由注册、Swagger 中文文档完整性校验和测试中的路由数量对齐。
 * 新增接口时必须同步补齐 `dataset.routes.ts` 中的 Swagger 说明，避免文档缺口。
 */
export const datasetRouteDefinitions: DatasetRouteDefinition[] = [
  {
    path: '/apiDataset/getCatalog',
    sourcePath: 'projects/app/src/pages/api/core/dataset/apiDataset/getCatalog.ts',
    status: 'migrated'
  },
  {
    path: '/apiDataset/getPathNames',
    sourcePath: 'projects/app/src/pages/api/core/dataset/apiDataset/getPathNames.ts',
    status: 'migrated'
  },
  {
    path: '/apiDataset/list',
    sourcePath: 'projects/app/src/pages/api/core/dataset/apiDataset/list.ts',
    status: 'migrated'
  },
  {
    path: '/apiDataset/listExistId',
    sourcePath: 'projects/app/src/pages/api/core/dataset/apiDataset/listExistId.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/apiCollection',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/apiCollection.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/apiCollectionV2',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/apiCollectionV2.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/backup',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/backup.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/fileId',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/fileId.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/images',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/images.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/link',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/link.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/localFile',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/localFile.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/reTrainingCollection',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/reTrainingCollection.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/template',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/template.ts',
    status: 'migrated'
  },
  {
    path: '/collection/create/text',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/create/text.ts',
    status: 'migrated'
  },
  {
    path: '/collection/delete',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/delete.ts',
    status: 'migrated'
  },
  {
    path: '/collection/detail',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/detail.ts',
    status: 'migrated'
  },
  {
    path: '/collection/export',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/export.ts',
    status: 'migrated'
  },
  {
    path: '/collection/list',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/list.ts',
    status: 'migrated'
  },
  {
    path: '/collection/listV2',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/listV2.ts',
    status: 'migrated'
  },
  {
    path: '/collection/paths',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/paths.ts',
    status: 'migrated'
  },
  {
    path: '/collection/read',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/read.ts',
    status: 'migrated'
  },
  {
    path: '/collection/scrollList',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/scrollList.ts',
    status: 'migrated'
  },
  {
    path: '/collection/sync',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/sync.ts',
    status: 'migrated'
  },
  {
    path: '/collection/trainingDetail',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/trainingDetail.ts',
    status: 'migrated'
  },
  {
    path: '/collection/update',
    sourcePath: 'projects/app/src/pages/api/core/dataset/collection/update.ts',
    status: 'migrated'
  },
  {
    path: '/create',
    sourcePath: 'projects/app/src/pages/api/core/dataset/create.ts',
    status: 'migrated'
  },
  {
    path: '/createWithFiles',
    sourcePath: 'projects/app/src/pages/api/core/dataset/createWithFiles.ts',
    status: 'migrated'
  },
  {
    path: '/data/delete',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/delete.ts',
    status: 'migrated'
  },
  {
    path: '/data/detail',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/detail.ts',
    status: 'migrated'
  },
  {
    path: '/data/getQuoteData',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/getQuoteData.ts',
    status: 'migrated'
  },
  {
    path: '/data/index/create',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/index/create.ts',
    status: 'migrated'
  },
  {
    path: '/data/index/delete',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/index/delete.ts',
    status: 'migrated'
  },
  {
    path: '/data/index/update',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/index/update.ts',
    status: 'migrated'
  },
  {
    path: '/data/insertData',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/insertData.ts',
    status: 'migrated'
  },
  {
    path: '/data/insertImages',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/insertImages.ts',
    status: 'migrated'
  },
  {
    path: '/data/list',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/list.ts',
    status: 'migrated'
  },
  {
    path: '/data/pushData',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/pushData.ts',
    status: 'migrated'
  },
  {
    path: '/data/update',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/update.ts',
    status: 'migrated'
  },
  {
    path: '/data/v2/list',
    sourcePath: 'projects/app/src/pages/api/core/dataset/data/v2/list.ts',
    status: 'migrated'
  },
  {
    path: '/delete',
    sourcePath: 'projects/app/src/pages/api/core/dataset/delete.ts',
    status: 'migrated'
  },
  {
    path: '/detail',
    sourcePath: 'projects/app/src/pages/api/core/dataset/detail.ts',
    status: 'migrated'
  },
  {
    path: '/exportAll',
    sourcePath: 'projects/app/src/pages/api/core/dataset/exportAll.ts',
    status: 'migrated'
  },
  {
    path: '/file/getPreviewChunks',
    sourcePath: 'projects/app/src/pages/api/core/dataset/file/getPreviewChunks.ts',
    status: 'migrated'
  },
  {
    path: '/file/getSearchTestImagePreviewUrls',
    sourcePath: 'projects/app/src/pages/api/core/dataset/file/getSearchTestImagePreviewUrls.ts',
    status: 'migrated'
  },
  {
    path: '/file/presignDatasetFilePostUrl',
    sourcePath: 'projects/app/src/pages/api/core/dataset/file/presignDatasetFilePostUrl.ts',
    status: 'migrated'
  },
  {
    path: '/file/presignSearchTestImage',
    sourcePath: 'projects/app/src/pages/api/core/dataset/file/presignSearchTestImage.ts',
    status: 'migrated'
  },
  {
    path: '/folder/create',
    sourcePath: 'projects/app/src/pages/api/core/dataset/folder/create.ts',
    status: 'migrated'
  },
  {
    path: '/getPermission',
    sourcePath: 'projects/app/src/pages/api/core/dataset/getPermission.ts',
    status: 'migrated'
  },
  {
    path: '/list',
    sourcePath: 'projects/app/src/pages/api/core/dataset/list.ts',
    status: 'migrated'
  },
  {
    path: '/paths',
    sourcePath: 'projects/app/src/pages/api/core/dataset/paths.ts',
    status: 'migrated'
  },
  {
    path: '/resumeInheritPermission',
    sourcePath: 'projects/app/src/pages/api/core/dataset/resumeInheritPermission.ts',
    status: 'migrated'
  },
  {
    path: '/searchTest',
    sourcePath: 'projects/app/src/pages/api/core/dataset/searchTest.ts',
    status: 'migrated'
  },
  {
    path: '/training/deleteTrainingData',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/deleteTrainingData.ts',
    status: 'migrated'
  },
  {
    path: '/training/getDatasetTrainingQueue',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/getDatasetTrainingQueue.ts',
    status: 'migrated'
  },
  {
    path: '/training/getTrainingDataDetail',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/getTrainingDataDetail.ts',
    status: 'migrated'
  },
  {
    path: '/training/getTrainingError',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/getTrainingError.ts',
    status: 'migrated'
  },
  {
    path: '/training/rebuildEmbedding',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/rebuildEmbedding.ts',
    status: 'migrated'
  },
  {
    path: '/training/updateTrainingData',
    sourcePath: 'projects/app/src/pages/api/core/dataset/training/updateTrainingData.ts',
    status: 'migrated'
  },
  {
    path: '/update',
    sourcePath: 'projects/app/src/pages/api/core/dataset/update.ts',
    status: 'migrated'
  }
];
