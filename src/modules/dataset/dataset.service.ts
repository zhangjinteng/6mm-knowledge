import type { FastifyRequest } from 'fastify';

import { AppError } from '@/common/errors/app-error.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import { HttpStatus } from '@/common/http/status-code.js';
import { DatasetRepository } from '@/modules/dataset/dataset.repository.js';
import { DatasetRoutePrefix } from '@/modules/dataset/dataset.route-map.js';

export class DatasetService {
  constructor(private readonly repository = new DatasetRepository()) {}

  /**
   * 返回 dataset 路由的显式迁移占位错误，避免对齐阶段出现 404 和静默遗漏。
   */
  getRouteNotMigratedError(path: string) {
    const route = this.repository.findRoute(path);

    return new AppError('该 dataset 接口已登记，但尚未完成 Fastify 迁移', {
      statusCode: HttpStatus.NotImplemented,
      code: ErrorCode.RouteNotMigrated,
      details: {
        sourcePath: route?.sourcePath ?? `projects/app/src/pages/api/core/dataset${path}.ts`,
        targetPath: `${DatasetRoutePrefix}${path}`,
        status: route?.status ?? 'pending'
      }
    });
  }

  /**
   * 分发 dataset 原生路由。未填业务实现的接口返回显式迁移错误，不再代理到 NextJS。
   */
  async handleNativeDatasetRoute(request: FastifyRequest) {
    const rawPath = (request.routeOptions.url ?? request.url).split('?')[0];
    const routePath = rawPath.startsWith(DatasetRoutePrefix)
      ? rawPath.slice(DatasetRoutePrefix.length) || '/'
      : rawPath;

    switch (routePath) {
      case '/apiDataset/getCatalog':
        return this.repository.getApiDatasetCatalog(request, request.body as Record<string, unknown>);
      case '/apiDataset/getPathNames':
        return this.repository.getApiDatasetPathNames(request, request.body as Record<string, unknown>);
      case '/apiDataset/list':
        return this.repository.listApiDatasetFiles(request, request.body as Record<string, unknown>);
      case '/apiDataset/listExistId':
        return this.repository.listApiDatasetExistIds(request, request.query as Record<string, unknown>);
      case '/collection/delete':
        return this.repository.deleteCollection(
          request,
          request.query as Record<string, unknown>,
          request.body as Record<string, unknown>
        );
      case '/collection/detail':
        return this.repository.getCollectionDetail(request, request.query as Record<string, unknown>);
      case '/collection/create':
        return this.repository.createCollection(request, request.body as Record<string, unknown>);
      case '/collection/create/apiCollection':
        return this.repository.createApiCollection(request, request.body as Record<string, unknown>);
      case '/collection/create/apiCollectionV2':
        return this.repository.createApiCollectionV2(request, request.body as Record<string, unknown>);
      case '/collection/create/backup':
        return this.repository.createBackupCollection(request, request.body as Record<string, unknown>);
      case '/collection/create/fileId':
        return this.repository.createCollectionByFileId(
          request,
          request.body as Record<string, unknown>
        );
      case '/collection/create/images':
        return this.repository.createImageCollection(request, request.body as Record<string, unknown>);
      case '/collection/create/link':
        return this.repository.createLinkCollection(request, request.body as Record<string, unknown>);
      case '/collection/create/localFile':
        return this.repository.createLocalFileCollection(
          request,
          request.body as Record<string, unknown>
        );
      case '/collection/create/reTrainingCollection':
        return this.repository.reTrainingCollection(
          request,
          request.body as Record<string, unknown>
        );
      case '/collection/create/template':
        return this.repository.createTemplateCollection(
          request,
          request.body as Record<string, unknown>
        );
      case '/collection/create/text':
        return this.repository.createTextCollection(request, request.body as Record<string, unknown>);
      case '/collection/export':
        return this.repository.exportCollection(request, request.body as Record<string, unknown>);
      case '/collection/list':
        return this.repository.listCollections(request, request.body as Record<string, unknown>);
      case '/collection/listV2':
        return this.repository.listCollectionsV2(request, request.body as Record<string, unknown>);
      case '/collection/paths':
        return this.repository.getCollectionPaths(request, request.query as Record<string, unknown>);
      case '/collection/read':
        return this.repository.readCollectionSource(request, request.body as Record<string, unknown>);
      case '/collection/scrollList':
        return this.repository.scrollCollections(
          request,
          request.body as Record<string, unknown>,
          request.query as Record<string, unknown>
        );
      case '/collection/sync':
        return this.repository.syncCollection(request, request.body as Record<string, unknown>);
      case '/collection/trainingDetail':
        return this.repository.getCollectionTrainingDetail(
          request,
          request.query as Record<string, unknown>
        );
      case '/collection/update':
        return this.repository.updateCollection(request, request.body as Record<string, unknown>);
      case '/create':
        return this.repository.createDataset(request, request.body as Record<string, unknown>);
      case '/createWithFiles':
        return this.repository.createDatasetWithFiles(request, request.body as Record<string, unknown>);
      case '/data/delete':
        return this.repository.deleteDatasetData(request, request.query as Record<string, unknown>);
      case '/data/detail':
        return this.repository.getDatasetDataDetail(request, request.query as Record<string, unknown>);
      case '/data/getQuoteData':
        return this.repository.getQuoteData(request, request.body as Record<string, unknown>);
      case '/data/index/create':
        return this.repository.createDatasetDataIndex(
          request,
          request.body as Record<string, unknown>
        );
      case '/data/index/delete':
        return this.repository.deleteDatasetDataIndex(
          request,
          request.body as Record<string, unknown>
        );
      case '/data/index/update':
        return this.repository.updateDatasetDataIndex(
          request,
          request.body as Record<string, unknown>
        );
      case '/data/insertData':
        return this.repository.insertDatasetData(request, request.body as Record<string, unknown>);
      case '/data/insertImages':
        return this.repository.insertDatasetImages(request, request.body as Record<string, unknown>);
      case '/data/list':
      case '/data/v2/list':
        return this.repository.listDatasetData(
          request,
          request.body as Record<string, unknown>,
          request.query as Record<string, unknown>
        );
      case '/data/pushData':
        return this.repository.pushDatasetData(request, request.body as Record<string, unknown>);
      case '/data/update':
        return this.repository.updateDatasetData(request, request.body as Record<string, unknown>);
      case '/delete':
        return this.repository.deleteDataset(request, request.query as Record<string, unknown>);
      case '/detail':
        return this.repository.getDatasetDetail(request, request.query as Record<string, unknown>);
      case '/exportAll':
        return this.repository.exportAllDataset(request, request.query as Record<string, unknown>);
      case '/folder/create':
        return this.repository.createDatasetFolder(request, request.body as Record<string, unknown>);
      case '/file/getPreviewChunks':
        return this.repository.getPreviewChunks(request, request.body as Record<string, unknown>);
      case '/file/getSearchTestImagePreviewUrls':
        return this.repository.getSearchTestImagePreviewUrls(
          request,
          request.body as Record<string, unknown>
        );
      case '/file/presignDatasetFilePostUrl':
        return this.repository.presignDatasetFilePostUrl(
          request,
          request.body as Record<string, unknown>
        );
      case '/file/presignSearchTestImage':
        return this.repository.presignSearchTestImage(request, request.body as Record<string, unknown>);
      case '/getPermission':
        return this.repository.getDatasetPermission(request, request.query as Record<string, unknown>);
      case '/list':
        return this.repository.listDatasets(request, request.body as Record<string, unknown>);
      case '/paths':
        return this.repository.getDatasetPaths(request, request.query as Record<string, unknown>);
      case '/resumeInheritPermission':
        return this.repository.resumeInheritPermission(request, request.body as Record<string, unknown>);
      case '/searchTest':
        return this.repository.searchTest(request, request.body as Record<string, unknown>);
      case '/training/getDatasetTrainingQueue':
        return this.repository.getDatasetTrainingQueue(
          request,
          request.query as Record<string, unknown>
        );
      case '/training/deleteTrainingData':
        return this.repository.deleteTrainingData(request, request.body as Record<string, unknown>);
      case '/training/getTrainingDataDetail':
        return this.repository.getTrainingDataDetail(
          request,
          request.body as Record<string, unknown>
        );
      case '/training/getTrainingError':
        return this.repository.getTrainingError(
          request,
          request.body as Record<string, unknown>,
          request.query as Record<string, unknown>
        );
      case '/training/rebuildEmbedding':
        return this.repository.rebuildEmbedding(request, request.body as Record<string, unknown>);
      case '/training/updateTrainingData':
        return this.repository.updateTrainingData(request, request.body as Record<string, unknown>);
      case '/update':
        return this.repository.updateDataset(request, request.body as Record<string, unknown>);
      default:
        throw this.getRouteNotMigratedError(routePath);
    }
  }
}
