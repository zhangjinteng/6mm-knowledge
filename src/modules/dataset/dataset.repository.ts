import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FastifyRequest } from 'fastify';

import { datasetRouteDefinitions } from '@/modules/dataset/dataset.route-map.js';
import type { DatasetRouteDefinition } from '@/modules/dataset/dataset.types.js';
import {
  importFastGptGlobalVendorModule,
  importFastGptServiceVendorModule
} from '@/common/vendor/fastgpt-vendor.js';

const dynamicImport = <T = any>(specifier: string) => import(specifier) as Promise<T>;
const globalVendorImport = importFastGptGlobalVendorModule;
const serviceVendorImport = importFastGptServiceVendorModule;
const MultipartHeaderSeparator = Buffer.from('\r\n\r\n');
const MultipartLineBreak = Buffer.from('\r\n');

type MultipartUploadedFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  filename: string;
  path: string;
  size: number;
  buffer: Buffer;
};

type ParsedMultipartFormData = {
  data: Record<string, any>;
  files: MultipartUploadedFile[];
};

function trimTrailingLineBreak(value: Buffer) {
  return value.subarray(-2).equals(MultipartLineBreak) ? value.subarray(0, -2) : value;
}

function parseMultipartHeaderMap(headerText: string) {
  return Object.fromEntries(
    headerText
      .split('\r\n')
      .map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) return undefined;
        return [
          line.slice(0, separatorIndex).trim().toLowerCase(),
          line.slice(separatorIndex + 1).trim()
        ] as const;
      })
      .filter((item): item is readonly [string, string] => !!item)
  );
}

function parseContentDisposition(value = '') {
  const result: Record<string, string> = {};
  const matches = value.matchAll(/;\s*([^=]+)="([^"]*)"/g);

  for (const match of matches) {
    result[match[1].trim()] = match[2];
  }

  return result;
}

function getMultipartBoundary(contentType: string | string[] | undefined) {
  const raw = Array.isArray(contentType) ? contentType[0] : contentType;
  const match = raw?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  return match?.[1] || match?.[2]?.trim();
}

function normalizeExtension(value: string) {
  const ext = value.trim().toLowerCase();

  return ext.startsWith('.') ? ext.slice(1) : ext;
}

function assertAllowedFileExtension(filename: string, allowedExtensions?: string[]) {
  if (!allowedExtensions?.length) return;

  const allowed = new Set(allowedExtensions.map(normalizeExtension).filter(Boolean));
  const actual = normalizeExtension(path.extname(decodeURIComponent(filename)));

  if (!actual || !allowed.has(actual)) {
    throw new Error('Invalid upload file type');
  }
}

function writeMultipartFileToDisk(file: Omit<MultipartUploadedFile, 'path'>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-dataset-upload-'));
  const filepath = path.join(dir, file.filename);

  fs.writeFileSync(filepath, file.buffer);

  return filepath;
}

function clearMultipartTempFiles(files: MultipartUploadedFile[]) {
  for (const file of files) {
    fs.rmSync(file.path, { force: true });
    fs.rmSync(path.dirname(file.path), { recursive: true, force: true });
  }
}

function parseMultipartBody(
  request: Pick<FastifyRequest, 'body' | 'headers'>,
  {
    maxFileSizeMb,
    allowedExtensions
  }: {
    maxFileSizeMb?: number;
    allowedExtensions?: string[];
  } = {}
): ParsedMultipartFormData {
  if (!Buffer.isBuffer(request.body)) {
    throw new Error('Multipart body must be parsed as Buffer');
  }

  const boundary = getMultipartBoundary(request.headers['content-type']);
  if (!boundary) {
    throw new Error('Multipart boundary not found');
  }

  const body = request.body;
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: MultipartUploadedFile[] = [];
  const maxFileSize = (maxFileSizeMb ?? 500) * 1024 * 1024;
  let cursor = body.indexOf(delimiter);

  try {
    while (cursor !== -1) {
      cursor += delimiter.length;

      if (body.subarray(cursor, cursor + 2).toString() === '--') {
        break;
      }
      if (body.subarray(cursor, cursor + 2).equals(MultipartLineBreak)) {
        cursor += 2;
      }

      const nextBoundaryIndex = body.indexOf(delimiter, cursor);
      if (nextBoundaryIndex === -1) {
        break;
      }

      const rawPart = trimTrailingLineBreak(body.subarray(cursor, nextBoundaryIndex));
      const headerEndIndex = rawPart.indexOf(MultipartHeaderSeparator);

      if (headerEndIndex !== -1) {
        const headers = parseMultipartHeaderMap(
          rawPart.subarray(0, headerEndIndex).toString('utf8')
        );
        const content = rawPart.subarray(headerEndIndex + MultipartHeaderSeparator.length);
        const disposition = parseContentDisposition(headers['content-disposition']);
        const fieldName = disposition.name;
        const originalname = disposition.filename;

        if (fieldName && originalname !== undefined) {
          if (content.length > maxFileSize) {
            throw new Error('File size exceeds limit');
          }
          assertAllowedFileExtension(originalname, allowedExtensions);

          const ext = path.extname(decodeURIComponent(originalname));
          const fileWithoutPath = {
            fieldname: fieldName,
            originalname,
            encoding: '7bit',
            mimetype: headers['content-type'] || 'application/octet-stream',
            filename: `${Date.now()}-${files.length}-${Math.random().toString(16).slice(2)}${ext}`,
            size: content.length,
            buffer: Buffer.from(content)
          };

          files.push({
            ...fileWithoutPath,
            path: writeMultipartFileToDisk(fileWithoutPath)
          });
        } else if (fieldName) {
          fields[fieldName] = content.toString('utf8');
        }
      }

      cursor = nextBoundaryIndex;
    }

    if (files.length === 0) {
      throw new Error('File not found');
    }

    const parsedData = (() => {
      if (!fields.data) return {};
      try {
        const parsed = JSON.parse(fields.data);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    })();
    const plainFields = Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== 'data')
    );

    return {
      data: {
        ...plainFields,
        ...parsedData
      },
      files
    };
  } catch (error) {
    clearMultipartTempFiles(files);
    throw error;
  }
}

/**
 * Dataset 迁移仓储。保存原版 core/dataset 路由映射，并按需复用 WorkGPT service/global 能力。
 */
export class DatasetRepository {
  findRoute(path: string): DatasetRouteDefinition | undefined {
    return datasetRouteDefinitions.find((item) => item.path === path);
  }

  listRoutes(): DatasetRouteDefinition[] {
    return datasetRouteDefinitions;
  }

  async authDataset(
    request: Pick<FastifyRequest, 'headers'>,
    datasetId: string,
    per: number,
    authApiKey = true
  ) {
    const { authDataset } = await serviceVendorImport<any>('support/permission/dataset/auth');

    return authDataset({
      req: request,
      datasetId,
      authToken: true,
      ...(authApiKey && { authApiKey: true }),
      per
    });
  }

  async authCert(request: Pick<FastifyRequest, 'headers'>) {
    const { authCert } = await serviceVendorImport<any>('support/permission/auth/common');

    return authCert({ req: request, authToken: true });
  }

  async authDatasetCollection(
    request: Pick<FastifyRequest, 'headers'>,
    collectionId: string,
    per: number,
    authApiKey = true
  ) {
    const { authDatasetCollection } = await serviceVendorImport<any>('support/permission/dataset/auth');

    return authDatasetCollection({
      req: request,
      collectionId,
      authToken: true,
      ...(authApiKey && { authApiKey: true }),
      per
    });
  }

  async authUserPer(request: Pick<FastifyRequest, 'headers'>, per: number, authApiKey = true) {
    const { authUserPer } = await serviceVendorImport<any>('support/permission/user/auth');

    return authUserPer({
      req: request,
      authToken: true,
      ...(authApiKey && { authApiKey: true }),
      per
    });
  }

  async getPermissionConstants() {
    const constants = await globalVendorImport<any>('support/permission/constant');

    return constants;
  }

  async getTeamDatasetCreatePermissionVal() {
    const { TeamDatasetCreatePermissionVal } = await globalVendorImport<any>('support/permission/user/constant');

    return TeamDatasetCreatePermissionVal as number;
  }

  async replaceRegChars(value: string) {
    const { replaceRegChars } = await globalVendorImport<any>('common/string/tools');

    return replaceRegChars(value);
  }

  async parsePaginationRequest(body: Record<string, unknown>, query: Record<string, unknown>) {
    const { parsePaginationRequest } = await serviceVendorImport<any>('common/api/pagination');

    return parsePaginationRequest({ body, query });
  }

  async pushGenerateVectorUsage(props: Record<string, any>) {
    const { pushGenerateVectorUsage } = await serviceVendorImport<any>('support/wallet/usage/push');

    return pushGenerateVectorUsage(props);
  }

  async pushCollectionUpdate(collectionId: string, datasetId: string, teamId: string) {
    const { pushCollectionUpdateJob } = await serviceVendorImport<any>('core/dataset/collection/mq');

    pushCollectionUpdateJob({
      collectionId: String(collectionId),
      datasetId: String(datasetId),
      teamId: String(teamId)
    });
  }

  async createDataset(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { parseParentIdInMongo },
      { DatasetTypeEnum },
      { CreateDatasetBodySchema, CreateDatasetResponseSchema },
      { OwnerRoleVal, PerResourceTypeEnum, WritePermissionVal },
      { pushTrack },
      { mongoSessionRun },
      aiModel,
      { MongoDataset },
      { checkTeamDatasetLimit },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      { MongoResourcePermission },
      { getS3AvatarSource }
    ] = await Promise.all([
      globalVendorImport<any>('common/parentFolder/utils'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/middle/tracks/utils'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/schema'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('support/permission/schema'),
      serviceVendorImport<any>('common/s3/sources/avatar')
    ]);
    const parsed = CreateDatasetBodySchema.parse(body);
    const {
      parentId,
      name,
      intro,
      type = DatasetTypeEnum.dataset,
      avatar,
      vectorModel = aiModel.getDefaultEmbeddingModel()?.model,
      agentModel = aiModel.getDatasetModel()?.model,
      vlmModel = aiModel.getDefaultVLMModel()?.model,
      apiDatasetServer
    } = parsed;
    const { teamId, tmbId, userId } = parentId
      ? await this.authDataset(request, parentId, WritePermissionVal)
      : await this.authUserPer(request, await this.getTeamDatasetCreatePermissionVal());
    const vectorModelStore = aiModel.getEmbeddingModel(vectorModel);
    const agentModelStore = aiModel.getLLMModel(agentModel);

    if (!vectorModelStore) {
      return Promise.reject('System not embedding model');
    }
    if (!agentModelStore) {
      return Promise.reject('System not llm model');
    }

    await checkTeamDatasetLimit(teamId);

    const datasetId = await mongoSessionRun(async (session: any) => {
      const [dataset] = await MongoDataset.create(
        [
          {
            ...parseParentIdInMongo(parentId),
            name,
            intro,
            teamId,
            tmbId,
            vectorModel,
            agentModel,
            vlmModel,
            avatar,
            type,
            apiDatasetServer
          }
        ],
        { session, ordered: true }
      );

      await MongoResourcePermission.insertOne({
        teamId,
        tmbId,
        resourceId: dataset._id,
        permission: OwnerRoleVal,
        resourceType: PerResourceTypeEnum.dataset
      });
      await getS3AvatarSource().refreshAvatar(avatar, undefined, session);

      return dataset._id;
    });

    pushTrack.createDataset({
      type,
      teamId,
      tmbId,
      uid: userId
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_DATASET,
      params: {
        datasetName: name,
        datasetType: getI18nDatasetType(type)
      }
    });

    return CreateDatasetResponseSchema.parse(datasetId);
  }

  async deleteDataset(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { MongoDataset },
      { findDatasetAndAllChildren },
      { OwnerPermissionVal },
      { DeleteDatasetQuerySchema },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      { addDatasetDeleteJob },
      { mongoSessionRun },
      { deleteDatasetsImmediate }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/schema'),
      serviceVendorImport<any>('core/dataset/controller'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('core/dataset/delete'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('core/dataset/delete/processor')
    ]);
    const { id: datasetId } = DeleteDatasetQuerySchema.parse(query);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      datasetId,
      OwnerPermissionVal
    );
    const deleteDatasets = await findDatasetAndAllChildren({
      teamId,
      datasetId,
      fields: '_id'
    });
    const datasetIds = deleteDatasets.map((item: any) => item._id);

    await deleteDatasetsImmediate({
      teamId,
      datasetIds
    });
    await mongoSessionRun(async (session: any) => {
      await MongoDataset.updateMany(
        {
          _id: { $in: datasetIds },
          teamId
        },
        {
          deleteTime: new Date()
        },
        {
          session
        }
      );

      await addDatasetDeleteJob({
        teamId,
        datasetId
      });
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.DELETE_DATASET,
      params: {
        datasetName: dataset.name,
        datasetType: getI18nDatasetType(dataset.type)
      }
    });

    return {};
  }

  /**
   * 更新数据集基础配置、移动目录或切换同步配置；移动时会同步继承权限。
   */
  async updateDataset(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { MongoDataset },
      { ManagePermissionVal, PerResourceTypeEnum, ReadPermissionVal },
      { UpdateDatasetBodySchema },
      { DatasetTypeEnum, TrainingModeEnum },
      { parseParentIdInMongo },
      { mongoSessionRun },
      inheritPermission,
      { TeamDatasetCreatePermissionVal },
      { DatasetErrEnum },
      { MongoDatasetTraining },
      datasetSync,
      { delDatasetRelevantData },
      lodash,
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      aiModel,
      trainingUtils,
      { getResourceOwnedClbs },
      { getS3AvatarSource },
      { isInternalAddress, PRIVATE_URL_TEXT }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/schema'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('common/parentFolder/utils'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('support/permission/inheritPermission'),
      globalVendorImport<any>('support/permission/user/constant'),
      globalVendorImport<any>('common/error/code/dataset'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('core/dataset/datasetSync'),
      serviceVendorImport<any>('core/dataset/controller'),
      dynamicImport<any>('lodash'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('core/ai/model'),
      globalVendorImport<any>('core/dataset/training/utils'),
      serviceVendorImport<any>('support/permission/controller'),
      serviceVendorImport<any>('common/s3/sources/avatar'),
      serviceVendorImport<any>('common/system/utils')
    ]);
    let {
      id,
      parentId,
      name,
      avatar,
      intro,
      agentModel,
      vlmModel,
      websiteConfig,
      externalReadUrl,
      apiDatasetServer,
      autoSync,
      chunkSettings
    } = UpdateDatasetBodySchema.parse(body);

    if (websiteConfig?.url && (await isInternalAddress(websiteConfig.url))) {
      return Promise.reject(PRIVATE_URL_TEXT);
    }

    const isMove = parentId !== undefined;
    const { dataset, permission, tmbId, teamId } = await this.authDataset(
      request,
      id,
      ReadPermissionVal,
      false
    );
    let targetName = '';

    chunkSettings = chunkSettings
      ? trainingUtils.computedCollectionChunkSettings({
          ...chunkSettings,
          llmModel: aiModel.getLLMModel(dataset.agentModel),
          vectorModel: aiModel.getEmbeddingModel(dataset.vectorModel)
        })
      : undefined;

    if (isMove) {
      if (parentId) {
        const { dataset: targetDataset } = await this.authDataset(
          request,
          parentId,
          ManagePermissionVal,
          false
        );
        targetName = targetDataset.name;
      } else {
        targetName = 'root';
      }
      if (dataset.parentId) {
        await this.authDataset(request, dataset.parentId, ManagePermissionVal, false);
      }
      if (parentId === null || !dataset.parentId) {
        await this.authUserPer(request, TeamDatasetCreatePermissionVal, false);
      }
    } else if (!permission.hasWritePer) {
      return Promise.reject(DatasetErrEnum.unAuthDataset);
    }

    const updateTraining = async () => {
      if (!agentModel) return;

      await MongoDatasetTraining.updateMany(
        {
          teamId: dataset.teamId,
          datasetId: id,
          mode: { $in: [TrainingModeEnum.qa, TrainingModeEnum.auto] }
        },
        {
          $set: {
            model: agentModel,
            retryCount: 5,
            lockTime: new Date('2000/1/1')
          }
        }
      );
    };
    const updateSyncSchedule = async () => {
      if (typeof autoSync !== 'boolean') return;

      return autoSync
        ? datasetSync.upsertDatasetSyncJobScheduler({ datasetId: dataset._id })
        : datasetSync.removeDatasetSyncJobScheduler(dataset._id);
    };
    const flattenApiDatasetParams = (
      value: Record<string, any> | undefined,
      prefix = 'apiDatasetServer'
    ): Record<string, any> => {
      const result: Record<string, any> = {};

      if (!value || typeof value !== 'object') return result;

      Object.keys(value).forEach((key) => {
        const item = value[key];
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.assign(result, flattenApiDatasetParams(item, newKey));
        } else {
          result[newKey] = item;
        }
      });

      return result;
    };
    const onUpdate = async (session: any) => {
      if (
        dataset.type === DatasetTypeEnum.websiteDataset &&
        chunkSettings &&
        dataset.chunkSettings &&
        !lodash.isEqual(
          {
            imageIndex: dataset.chunkSettings.imageIndex,
            autoIndexes: dataset.chunkSettings.autoIndexes,
            trainingType: dataset.chunkSettings.trainingType,
            chunkSettingMode: dataset.chunkSettings.chunkSettingMode,
            chunkSplitMode: dataset.chunkSettings.chunkSplitMode,
            chunkSize: dataset.chunkSettings.chunkSize,
            chunkSplitter: dataset.chunkSettings.chunkSplitter,
            indexSize: dataset.chunkSettings.indexSize,
            qaPrompt: dataset.chunkSettings.qaPrompt
          },
          {
            imageIndex: chunkSettings.imageIndex,
            autoIndexes: chunkSettings.autoIndexes,
            trainingType: chunkSettings.trainingType,
            chunkSettingMode: chunkSettings.chunkSettingMode,
            chunkSplitMode: chunkSettings.chunkSplitMode,
            chunkSize: chunkSettings.chunkSize,
            chunkSplitter: chunkSettings.chunkSplitter,
            indexSize: chunkSettings.indexSize,
            qaPrompt: chunkSettings.qaPrompt
          }
        )
      ) {
        await delDatasetRelevantData({ datasets: [dataset], session });
      }

      await MongoDataset.findByIdAndUpdate(
        id,
        {
          ...parseParentIdInMongo(parentId),
          ...(name && { name }),
          ...(avatar && { avatar }),
          ...(agentModel && { agentModel }),
          ...(vlmModel && { vlmModel }),
          ...(websiteConfig && { websiteConfig }),
          ...(chunkSettings && { chunkSettings }),
          ...(intro !== undefined && { intro }),
          ...(externalReadUrl !== undefined && { externalReadUrl }),
          ...(isMove && { inheritPermission: true }),
          ...(typeof autoSync === 'boolean' && { autoSync }),
          ...flattenApiDatasetParams(apiDatasetServer)
        },
        { session }
      );

      await updateSyncSchedule();
      await getS3AvatarSource().refreshAvatar(avatar, dataset.avatar, session);
    };

    await updateTraining();
    await mongoSessionRun(async (session: any) => {
      if (isMove) {
        const parentClbs = await getResourceOwnedClbs({
          teamId: dataset.teamId,
          resourceId: parentId,
          resourceType: PerResourceTypeEnum.dataset,
          session
        });

        await inheritPermission.syncCollaborators({
          teamId: dataset.teamId,
          resourceId: id,
          resourceType: PerResourceTypeEnum.dataset,
          collaborators: parentClbs,
          session
        });
        await inheritPermission.syncChildrenPermission({
          resource: dataset,
          resourceType: PerResourceTypeEnum.dataset,
          resourceModel: MongoDataset,
          folderTypeList: [DatasetTypeEnum.folder],
          collaborators: parentClbs,
          session
        });
        void addAuditLog({
          tmbId,
          teamId,
          event: AuditEventEnum.MOVE_DATASET,
          params: {
            datasetName: dataset.name,
            targetFolderName: targetName,
            datasetType: getI18nDatasetType(dataset.type)
          }
        });
        return onUpdate(session);
      }

      void addAuditLog({
        tmbId,
        teamId,
        event: AuditEventEnum.UPDATE_DATASET,
        params: {
          datasetName: dataset.name,
          datasetType: getI18nDatasetType(dataset.type)
        }
      });
      return onUpdate(session);
    });

    return {};
  }

  async getApiDatasetCatalog(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [{ GetApiDatasetCatalogBodySchema, GetApiDatasetCatalogResponseSchema }, { getApiDatasetRequest }] =
      await Promise.all([
        globalVendorImport<any>('openapi/core/dataset/apiDataset/api'),
        serviceVendorImport<any>('core/dataset/apiDataset')
      ]);
    const { parentId, searchKey = '', apiDatasetServer } =
      GetApiDatasetCatalogBodySchema.parse(body);

    await this.authCert(request);
    if (apiDatasetServer) {
      Object.values(apiDatasetServer).forEach((server: any) => {
        if (server && 'basePath' in server && server.basePath) {
          delete server.basePath;
        }
      });
    }

    const data = await (
      await getApiDatasetRequest(apiDatasetServer)
    ).listFiles({ parentId, searchKey });
    const folders = data?.filter((item: any) => item.hasChild === true) ?? [];

    return GetApiDatasetCatalogResponseSchema.parse(folders);
  }

  async listApiDatasetFiles(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { GetApiDatasetFileListBodySchema, GetApiDatasetFileListResponseSchema },
      { getApiDatasetRequest },
      { ReadPermissionVal }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/apiDataset/api'),
      serviceVendorImport<any>('core/dataset/apiDataset'),
      globalVendorImport<any>('support/permission/constant')
    ]);
    const { datasetId, searchKey = '', parentId } = GetApiDatasetFileListBodySchema.parse(body);
    const { dataset } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const files = await (
      await getApiDatasetRequest(dataset.apiDatasetServer)
    ).listFiles({ searchKey, parentId });

    return GetApiDatasetFileListResponseSchema.parse(files);
  }

  async getApiDatasetPathNames(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { GetApiDatasetPathNamesBodySchema, GetApiDatasetPathNamesResponseSchema },
      { getApiDatasetRequest },
      { DatasetErrEnum },
      { ManagePermissionVal }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/apiDataset/api'),
      serviceVendorImport<any>('core/dataset/apiDataset'),
      globalVendorImport<any>('common/error/code/dataset'),
      globalVendorImport<any>('support/permission/constant')
    ]);
    const { datasetId, parentId, apiDatasetServer: bodyApiDatasetServer } =
      GetApiDatasetPathNamesBodySchema.parse(body);

    if (!parentId) return GetApiDatasetPathNamesResponseSchema.parse('');

    const apiDatasetServer = await (async () => {
      if (datasetId) {
        const { dataset } = await this.authDataset(request, datasetId, ManagePermissionVal);
        return dataset.apiDatasetServer;
      }

      await this.authCert(request);
      return bodyApiDatasetServer;
    })();
    const apiDataset = await getApiDatasetRequest(apiDatasetServer);

    if (!apiDataset?.getFileDetail) {
      return Promise.reject(DatasetErrEnum.noApiServer);
    }

    const getFullPath = async (currentId: string): Promise<string> => {
      const response = await apiDataset.getFileDetail({ apiFileId: currentId });
      if (!response) return '';
      if (response.parentId && response.parentId !== null) {
        const parentPath = await getFullPath(response.parentId);
        return `${parentPath}/${response.name}`;
      }
      return `/${response.name}`;
    };

    return GetApiDatasetPathNamesResponseSchema.parse(await getFullPath(parentId));
  }

  async createDatasetFolder(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { FolderImgUrl },
      { parseParentIdInMongo },
      { DatasetTypeEnum },
      { CreateDatasetFolderBodySchema },
      { PerResourceTypeEnum, WritePermissionVal },
      { mongoSessionRun },
      { MongoDataset },
      { createResourceDefaultCollaborators },
      { checkTeamDatasetFolderLimit },
      { addAuditLog },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('common/file/image/constants'),
      globalVendorImport<any>('common/parentFolder/utils'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('core/dataset/schema'),
      serviceVendorImport<any>('support/permission/controller'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { parentId, name, intro } = CreateDatasetFolderBodySchema.parse(body);
    const { teamId, tmbId } = parentId
      ? await this.authDataset(request, parentId, WritePermissionVal)
      : await this.authUserPer(request, await this.getTeamDatasetCreatePermissionVal());

    await checkTeamDatasetFolderLimit({ teamId });
    await mongoSessionRun(async (session: any) => {
      const [dataset] = await MongoDataset.create(
        [
          {
            ...parseParentIdInMongo(parentId),
            avatar: FolderImgUrl,
            name,
            intro,
            teamId,
            tmbId,
            type: DatasetTypeEnum.folder
          }
        ],
        { session, ordered: true }
      );

      await createResourceDefaultCollaborators({
        tmbId,
        session,
        resource: dataset,
        resourceType: PerResourceTypeEnum.dataset
      });
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_DATASET_FOLDER,
      params: {
        folderName: name
      }
    });

    return {};
  }

  async getDatasetPermission(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { GetDatasetPermissionQuerySchema, GetDatasetPermissionResponseSchema },
      { ReadPermissionVal },
      { DatasetErrEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/error/code/dataset')
    ]);
    const { id: datasetId } = GetDatasetPermissionQuerySchema.parse(query);

    try {
      const { permission, dataset } = await this.authDataset(
        request,
        datasetId,
        ReadPermissionVal
      );

      return GetDatasetPermissionResponseSchema.parse({
        datasetName: dataset.name,
        permission: {
          hasReadPer: permission.hasReadPer,
          hasWritePer: permission.hasWritePer
        }
      });
    } catch (error) {
      if (error === DatasetErrEnum.unAuthDataset) {
        return GetDatasetPermissionResponseSchema.parse({
          datasetName: '',
          permission: {
            hasWritePer: false,
            hasReadPer: false
          }
        });
      }

      return Promise.reject(error);
    }
  }

  async presignDatasetFilePostUrl(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { PresignDatasetFilePostUrlBodySchema },
      { getS3DatasetSource },
      { authFrequencyLimit },
      { addSeconds },
      { WritePermissionVal },
      { getTeamPlanStatus }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/file/api'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      serviceVendorImport<any>('common/system/frequencyLimit/utils'),
      dynamicImport<any>('date-fns'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/wallet/sub/utils')
    ]);
    const { filename, datasetId } = PresignDatasetFilePostUrlBodySchema.parse(body);
    const { teamId, userId } = await this.authDataset(request, datasetId, WritePermissionVal);
    const planStatus = await getTeamPlanStatus({ teamId });
    const feConfigs = (globalThis as any).feConfigs;

    await authFrequencyLimit({
      eventId: `${userId}-uploadfile`,
      maxAmount: planStatus.standard?.maxUploadFileCount || feConfigs.uploadFileMaxAmount,
      expiredTime: addSeconds(new Date(), 30)
    });

    return getS3DatasetSource().createUploadDatasetFileURL({
      datasetId,
      filename,
      maxFileSize: planStatus.standard?.maxUploadFileSize ?? feConfigs.uploadFileMaxSize
    });
  }

  async presignSearchTestImage(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { PresignSearchTestImageBodySchema, PresignSearchTestImageResponseSchema },
      { ReadPermissionVal },
      { authFrequencyLimit },
      { addSeconds },
      { getTeamPlanStatus },
      { imageFileType },
      { parseAllowedExtensions },
      { getFileS3Key },
      { S3PrivateBucket }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/file/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/system/frequencyLimit/utils'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('support/wallet/sub/utils'),
      globalVendorImport<any>('common/file/constants'),
      serviceVendorImport<any>('common/s3/utils/uploadConstraints'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('common/s3/buckets/private')
    ]);
    const { datasetId, filename } = PresignSearchTestImageBodySchema.parse(body);
    const { teamId, userId } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const planStatus = await getTeamPlanStatus({ teamId });
    const feConfigs = (globalThis as any).feConfigs;

    await authFrequencyLimit({
      eventId: `${userId}-uploadfile`,
      maxAmount: planStatus.standard?.maxUploadFileCount || feConfigs.uploadFileMaxAmount,
      expiredTime: addSeconds(new Date(), 30),
      num: 1
    });

    const bucket = new S3PrivateBucket();
    const { fileKey } = getFileS3Key.temp({ teamId, filename });
    const result = await bucket.createPresignedPutUrl(
      { rawKey: fileKey, filename },
      {
        expiredHours: 3,
        maxFileSize: planStatus.standard?.maxUploadFileSize ?? feConfigs.uploadFileMaxSize,
        uploadConstraints: {
          allowedExtensions: parseAllowedExtensions(imageFileType)
        }
      }
    );

    return PresignSearchTestImageResponseSchema.parse(result);
  }

  async getSearchTestImagePreviewUrls(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      {
        GetSearchTestImagePreviewUrlsBodySchema,
        GetSearchTestImagePreviewUrlsResponseSchema
      },
      { ReadPermissionVal },
      { addHours },
      { S3Buckets },
      s3Utils
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/file/api'),
      globalVendorImport<any>('support/permission/constant'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('common/s3/config/constants'),
      serviceVendorImport<any>('common/s3/utils')
    ]);
    const { datasetId, keys } = GetSearchTestImagePreviewUrlsBodySchema.parse(body);
    const { teamId } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const result = keys
      .filter((key: string) => s3Utils.isS3ObjectKey(key, 'temp') && key.startsWith(`temp/${teamId}/`))
      .map((key: string) => ({
        key,
        previewUrl: s3Utils.jwtSignS3DownloadToken({
          objectKey: key,
          bucketName: S3Buckets.private,
          expiredTime: addHours(new Date(), 1)
        })
      }));

    return GetSearchTestImagePreviewUrlsResponseSchema.parse(result);
  }

  async getPreviewChunks(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { DatasetSourceReadTypeEnum },
      datasetRead,
      { OwnerPermissionVal, WritePermissionVal },
      { authCollectionFile },
      trainingUtils,
      { CommonErrEnum },
      aiModel,
      { replaceS3KeyToPreviewUrl },
      { addDays },
      { GetPreviewChunksBodySchema, GetPreviewChunksResponseSchema }
    ] = await Promise.all([
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('core/dataset/read'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/auth/file'),
      globalVendorImport<any>('core/dataset/training/utils'),
      globalVendorImport<any>('common/error/code/common'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/utils'),
      dynamicImport<any>('date-fns'),
      globalVendorImport<any>('openapi/core/dataset/file/api')
    ]);
    const {
      type,
      sourceId,
      customPdfParse = false,
      overlapRatio,
      selector,
      datasetId,
      externalFileId,
      ...chunkSettings
    } = GetPreviewChunksBodySchema.parse(body);

    if (!sourceId) {
      throw new Error('sourceId is empty');
    }

    const fileAuthRes =
      type === DatasetSourceReadTypeEnum.fileLocal
        ? await authCollectionFile({
            req: request,
            authToken: true,
            authApiKey: true,
            fileId: sourceId,
            per: OwnerPermissionVal
          })
        : undefined;
    const { dataset, teamId, tmbId } = await this.authDataset(request, datasetId, WritePermissionVal);

    if (fileAuthRes && String(fileAuthRes.tmbId) !== String(tmbId) && !fileAuthRes.isRoot) {
      return Promise.reject(CommonErrEnum.unAuthFile);
    }

    const formatChunkSettings = trainingUtils.computedCollectionChunkSettings({
      ...chunkSettings,
      llmModel: aiModel.getLLMModel(dataset.agentModel),
      vectorModel: aiModel.getEmbeddingModel(dataset.vectorModel)
    });
    const { rawText } = await datasetRead.readDatasetSourceRawText({
      teamId,
      tmbId,
      type,
      sourceId,
      selector,
      externalFileId,
      customPdfParse,
      apiDatasetServer: dataset.apiDatasetServer,
      datasetId
    });
    const chunks = await datasetRead.rawText2Chunks({
      rawText,
      chunkTriggerType: formatChunkSettings.chunkTriggerType,
      chunkTriggerMinSize: formatChunkSettings.chunkTriggerMinSize,
      chunkSize: formatChunkSettings.chunkSize,
      paragraphChunkDeep: formatChunkSettings.paragraphChunkDeep,
      paragraphChunkMinSize: formatChunkSettings.paragraphChunkMinSize,
      maxSize: trainingUtils.getLLMMaxChunkSize(aiModel.getLLMModel(dataset.agentModel)),
      overlapRatio,
      customReg: formatChunkSettings.chunkSplitter ? [formatChunkSettings.chunkSplitter] : []
    });
    const chunksWithJWT = chunks.slice(0, 10).map((chunk: any) => ({
      q: replaceS3KeyToPreviewUrl(chunk.q, addDays(new Date(), 1)),
      a: replaceS3KeyToPreviewUrl(chunk.a, addDays(new Date(), 1))
    }));

    return GetPreviewChunksResponseSchema.parse({
      chunks: chunksWithJWT,
      total: chunks.length
    });
  }

  async getDatasetDetail(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      aiModel,
      { GetDatasetDetailQuerySchema },
      { ReadPermissionVal },
      { getDatasetSyncDatasetStatus },
      { filterApiDatasetServerPublicData }
    ] = await Promise.all([
      serviceVendorImport<any>('core/ai/model'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/datasetSync'),
      globalVendorImport<any>('core/dataset/apiDataset/utils')
    ]);
    const { id: datasetId } = GetDatasetDetailQuerySchema.parse(query);
    const { dataset, permission } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const { status, errorMsg } = await getDatasetSyncDatasetStatus(datasetId);

    return {
      ...dataset,
      status,
      errorMsg,
      permission,
      vectorModel: aiModel.getEmbeddingModel(dataset.vectorModel),
      agentModel: aiModel.getLLMModel(dataset.agentModel),
      vlmModel: aiModel.getVlmModel(dataset.vlmModel),
      apiDatasetServer: filterApiDatasetServerPublicData(dataset.apiDatasetServer)
    };
  }

  async getDatasetPaths(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [{ GetDatasetPathsQuerySchema, GetDatasetPathsResponseSchema }, { ReadPermissionVal }] =
      await Promise.all([
        globalVendorImport<any>('openapi/core/dataset/api'),
        globalVendorImport<any>('support/permission/constant')
      ]);
    const { sourceId: datasetId, type } = GetDatasetPathsQuerySchema.parse(query);

    if (!datasetId) {
      return [];
    }

    const { dataset } = await this.authDataset(request, datasetId, ReadPermissionVal, false);
    const paths = await this.getParents(type === 'current' ? dataset._id : dataset.parentId ?? undefined);

    return GetDatasetPathsResponseSchema.parse(paths);
  }

  async getParents(parentId?: string): Promise<Array<Record<string, unknown>>> {
    if (!parentId) {
      return [];
    }

    const { MongoDataset } = await serviceVendorImport<any>('core/dataset/schema');
    const parent = await MongoDataset.findById(parentId, 'name parentId');

    if (!parent) {
      return [];
    }

    const paths = await this.getParents(parent.parentId ?? undefined);
    paths.push({ parentId, parentName: parent.name });

    return paths;
  }

  async listDatasets(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { DatasetTypeEnum },
      { MongoDataset },
      { DatasetPermission },
      { PerResourceTypeEnum, ReadPermissionVal },
      { MongoResourcePermission },
      { parseParentIdInMongo },
      { getGroupsByTmbId },
      { getOrgIdSetWithParentByTmbId },
      { addSourceMember },
      { getEmbeddingModel },
      { sumPer },
      { GetDatasetListBodySchema }
    ] = await Promise.all([
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('core/dataset/schema'),
      globalVendorImport<any>('support/permission/dataset/controller'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/schema'),
      globalVendorImport<any>('common/parentFolder/utils'),
      serviceVendorImport<any>('support/permission/memberGroup/controllers'),
      serviceVendorImport<any>('support/permission/org/controllers'),
      serviceVendorImport<any>('support/user/utils'),
      serviceVendorImport<any>('core/ai/model'),
      globalVendorImport<any>('support/permission/utils'),
      globalVendorImport<any>('openapi/core/dataset/api')
    ]);
    const { parentId, type, searchKey } = GetDatasetListBodySchema.parse(body);
    const [{ tmbId, teamId, permission: teamPer }] = await Promise.all([
      this.authUserPer(request, ReadPermissionVal),
      ...(parentId ? [this.authDataset(request, parentId, ReadPermissionVal)] : [])
    ]);
    const [roleList, myGroupMap, myOrgSet] = await Promise.all([
      MongoResourcePermission.find({
        resourceType: PerResourceTypeEnum.dataset,
        teamId,
        resourceId: {
          $exists: true
        }
      }).lean(),
      getGroupsByTmbId({ tmbId, teamId }).then((items: any[]) => {
        const map = new Map<string, 1>();
        items.forEach((item) => map.set(String(item._id), 1));
        return map;
      }),
      getOrgIdSetWithParentByTmbId({ teamId, tmbId })
    ]);
    const myRoles = roleList.filter(
      (item: any) =>
        String(item.tmbId) === String(tmbId) ||
        myGroupMap.has(String(item.groupId)) ||
        myOrgSet.has(String(item.orgId))
    );
    const escapedSearch = searchKey ? await this.replaceRegChars(searchKey) : '';
    const findDatasetQuery = (() => {
      const idList = { _id: { $in: myRoles.map((item: any) => item.resourceId) } };
      const datasetPerQuery = teamPer.isOwner
        ? {}
        : parentId
          ? {
              $or: [idList, parseParentIdInMongo(parentId)]
            }
          : { $or: [idList, { parentId: null }] };
      const searchMatch = searchKey
        ? {
            $or: [
              { name: { $regex: new RegExp(`${escapedSearch}`, 'i') } },
              { intro: { $regex: new RegExp(`${escapedSearch}`, 'i') } }
            ]
          }
        : {};

      if (searchKey) {
        const data: Record<string, unknown> = {
          ...datasetPerQuery,
          teamId,
          deleteTime: null,
          ...searchMatch
        };
        delete data.parentId;
        return data;
      }

      return {
        ...datasetPerQuery,
        teamId,
        deleteTime: null,
        ...(type ? (Array.isArray(type) ? { type: { $in: type } } : { type }) : {}),
        ...parseParentIdInMongo(parentId)
      };
    })();
    const myDatasets = await MongoDataset.find(findDatasetQuery).sort({ updateTime: -1 }).lean();
    const formatDatasets = myDatasets
      .map((dataset: any) => {
        const getPer = (targetDatasetId: string) => {
          const tmbRole = myRoles.find(
            (item: any) => String(item.resourceId) === targetDatasetId && !!item.tmbId
          )?.permission;
          const groupAndOrgRole = sumPer(
            ...myRoles
              .filter(
                (item: any) =>
                  String(item.resourceId) === targetDatasetId && (!!item.groupId || !!item.orgId)
              )
              .map((item: any) => item.permission)
          );

          return new DatasetPermission({
            role: tmbRole ?? groupAndOrgRole,
            isOwner: String(dataset.tmbId) === String(tmbId) || teamPer.isOwner
          });
        };
        const getClbCount = (targetDatasetId: string) =>
          roleList.filter((item: any) => String(item.resourceId) === String(targetDatasetId))
            .length;
        const { Per, privateDataset } =
          dataset.inheritPermission && dataset.parentId && dataset.type !== DatasetTypeEnum.folder
            ? {
                Per: getPer(String(dataset.parentId)).addRole(getPer(String(dataset._id)).role),
                privateDataset: getClbCount(String(dataset.parentId)) <= 1
              }
            : {
                Per: getPer(String(dataset._id)),
                privateDataset: getClbCount(String(dataset._id)) <= 1
              };

        return {
          _id: dataset._id,
          avatar: dataset.avatar,
          name: dataset.name,
          intro: dataset.intro,
          type: dataset.type,
          vectorModel: getEmbeddingModel(dataset.vectorModel),
          inheritPermission: dataset.inheritPermission,
          tmbId: dataset.tmbId,
          updateTime: dataset.updateTime,
          permission: Per,
          private: privateDataset
        };
      })
      .filter((dataset: any) => dataset.permission.hasReadPer);

    return addSourceMember({ list: formatDatasets });
  }

  async resumeInheritPermission(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { ResumeDatasetInheritPermissionBodySchema },
      { ManagePermissionVal, PerResourceTypeEnum },
      { resumeInheritPermission },
      { MongoDataset },
      { DatasetTypeEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/inheritPermission'),
      serviceVendorImport<any>('core/dataset/schema'),
      globalVendorImport<any>('core/dataset/constants')
    ]);
    const { datasetId } = ResumeDatasetInheritPermissionBodySchema.parse(body);
    const { dataset } = await this.authDataset(request, datasetId, ManagePermissionVal, false);

    if (dataset.parentId) {
      await resumeInheritPermission({
        resource: dataset,
        folderTypeList: [DatasetTypeEnum.folder],
        resourceType: PerResourceTypeEnum.dataset,
        resourceModel: MongoDataset
      });
    } else {
      await MongoDataset.updateOne(
        {
          _id: datasetId
        },
        {
          inheritPermission: true
        }
      );
    }

    return {};
  }

  async listApiDatasetExistIds(
    request: Pick<FastifyRequest, 'headers'>,
    query: Record<string, any>
  ) {
    const [
      {
        GetApiDatasetFileListExistIdQuerySchema,
        GetApiDatasetFileListExistIdResponseSchema
      },
      { ReadPermissionVal },
      { MongoDatasetCollection }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/apiDataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/schema')
    ]);
    const { datasetId } = GetApiDatasetFileListExistIdQuerySchema.parse(query);
    const { dataset } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const collections = await MongoDatasetCollection.find(
      {
        teamId: dataset.teamId,
        datasetId: dataset._id
      },
      '_id apiFileId'
    ).lean();
    const existIds = collections.map((collection: any) => collection.apiFileId).filter(Boolean);

    return GetApiDatasetFileListExistIdResponseSchema.parse(existIds);
  }

  async getDatasetDataDetail(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { ReadPermissionVal },
      { authDatasetData },
      { GetDatasetDataDetailQuerySchema, GetDatasetDataDetailResponseSchema }
    ] = await Promise.all([
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      globalVendorImport<any>('openapi/core/dataset/data/api')
    ]);
    const { id: dataId } = GetDatasetDataDetailQuerySchema.parse(query);
    const { datasetData } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: ReadPermissionVal
    });

    return GetDatasetDataDetailResponseSchema.parse(datasetData);
  }

  async listDatasetData(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>,
    query: Record<string, unknown>
  ) {
    const [
      { MongoDatasetData },
      { ReadPermissionVal },
      { MongoDatasetImageSchema },
      { readFromSecondary },
      { getS3DatasetSource },
      { addHours },
      s3Utils,
      datasetUtils,
      { GetDatasetDataListBodySchema, GetDatasetDataListResponseSchema },
      { S3Buckets }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/data/schema'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/image/schema'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('core/dataset/utils'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      serviceVendorImport<any>('common/s3/config/constants')
    ]);
    const { searchText = '', collectionId } = GetDatasetDataListBodySchema.parse(body);
    const { offset, pageSize: rawPageSize } = await this.parsePaginationRequest(body, query);
    const pageSize = Math.min(rawPageSize, 30);
    const { teamId, collection } = await this.authDatasetCollection(
      request,
      collectionId,
      ReadPermissionVal
    );
    const queryReg = new RegExp(`${await this.replaceRegChars(searchText)}`, 'i');
    const match = {
      teamId,
      datasetId: collection.datasetId,
      collectionId,
      ...(searchText.trim()
        ? {
            $or: [{ q: queryReg }, { a: queryReg }]
          }
        : {})
    };
    const [list, total] = await Promise.all([
      MongoDatasetData.find(match, '_id datasetId collectionId q a chunkIndex imageId')
        .sort({ chunkIndex: 1, _id: -1 })
        .skip(offset)
        .limit(pageSize)
        .lean(),
      MongoDatasetData.countDocuments(match)
    ]);

    list.forEach((item: any) => {
      item.q = datasetUtils.replaceS3KeyToPreviewUrl(item.q, addHours(new Date(), 1));
      if (item.a) {
        item.a = datasetUtils.replaceS3KeyToPreviewUrl(item.a, addHours(new Date(), 1));
      }
    });

    const imageIds = list.map((item: any) => item.imageId).filter(Boolean);
    const imageSizeMap = new Map<string, number>();

    if (imageIds.length > 0) {
      const imageInfos = await MongoDatasetImageSchema.find(
        { _id: { $in: imageIds.filter((id: string) => !s3Utils.isS3ObjectKey(id, 'dataset')) } },
        '_id length',
        {
          ...readFromSecondary
        }
      ).lean();

      imageInfos.forEach((item: any) => {
        imageSizeMap.set(String(item._id), item.length);
      });

      const s3ImageIds = imageIds.filter((id: string) => s3Utils.isS3ObjectKey(id, 'dataset'));
      for (const id of s3ImageIds) {
        const metadata = await getS3DatasetSource().getFileMetadata(id);
        if (metadata?.contentLength) {
          imageSizeMap.set(id, metadata.contentLength);
        }
      }
    }

    const formatList = list.map((item: any) => {
      const imageSize = item.imageId ? imageSizeMap.get(String(item.imageId)) : undefined;
      const imagePreviewUrl =
        item.imageId && s3Utils.isS3ObjectKey(item.imageId, 'dataset')
          ? s3Utils.jwtSignS3DownloadToken({
              objectKey: item.imageId,
              bucketName: S3Buckets.private,
              expiredTime: addHours(new Date(), 1)
            })
          : undefined;

      return {
        ...item,
        imageSize,
        imagePreviewUrl
      };
    });

    return GetDatasetDataListResponseSchema.parse({
      total,
      list: formatList
    });
  }

  async pushDatasetData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { checkDatasetIndexLimit },
      { predictDataLimitLength },
      { pushDataListToTrainingQueue },
      { WritePermissionVal },
      { getTrainingModeByCollection },
      datasetUtils,
      { PushDataBodySchema },
      { UsageSourceEnum },
      aiModel,
      { createTrainingUsage },
      { mongoSessionRun }
    ] = await Promise.all([
      serviceVendorImport<any>('support/permission/teamLimit'),
      globalVendorImport<any>('core/dataset/utils'),
      serviceVendorImport<any>('core/dataset/training/controller'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      serviceVendorImport<any>('core/dataset/utils'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      globalVendorImport<any>('support/wallet/usage/constants'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('support/wallet/usage/controller'),
      serviceVendorImport<any>('common/mongo/sessionRun')
    ]);
    const parsed = PushDataBodySchema.parse(body);

    parsed.trainingType = parsed.trainingType || parsed.trainingMode;
    const { collectionId, billId, data } = parsed;
    const { teamId, tmbId, collection } = await this.authDatasetCollection(
      request,
      collectionId,
      WritePermissionVal
    );
    const mode = getTrainingModeByCollection({
      ...collection,
      supportImageIndex: datasetUtils.getDatasetImageIndexCapability({
        vectorModel: collection.dataset.vectorModel,
        vlmModel: collection.dataset.vlmModel
      }).supportImageIndex
    });

    await checkDatasetIndexLimit({
      teamId,
      insertLen: predictDataLimitLength(mode, data)
    });

    return mongoSessionRun(async (session: any) => {
      const trainingUsageId = await (async () => {
        if (billId) return billId;
        const { usageId } = await createTrainingUsage({
          teamId,
          tmbId,
          appName: collection.name,
          billSource: UsageSourceEnum.training,
          vectorModel: aiModel.getEmbeddingModel(collection.dataset.vectorModel)?.name,
          agentModel: aiModel.getLLMModel(collection.dataset.agentModel)?.name,
          vllmModel: aiModel.getVlmModel(collection.dataset.vlmModel)?.name,
          session
        });

        return usageId;
      })();

      return pushDataListToTrainingQueue({
        ...parsed,
        session,
        billId: trainingUsageId,
        mode,
        teamId,
        tmbId,
        datasetId: collection.datasetId,
        vectorModel: collection.dataset.vectorModel,
        agentModel: collection.dataset.agentModel,
        vlmModel: collection.dataset.vlmModel
      });
    });
  }

  async createDatasetWithFiles(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { parseParentIdInMongo },
      constants,
      { CreateDatasetWithFilesBodySchema, CreateDatasetWithFilesResponseSchema },
      { OwnerRoleVal, PerResourceTypeEnum, WritePermissionVal },
      { TeamDatasetCreatePermissionVal },
      { pushTrack },
      { mongoSessionRun },
      aiModel,
      { MongoDataset },
      { checkTeamDatasetLimit },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      { MongoResourcePermission },
      { getS3AvatarSource },
      { createCollectionAndInsertData },
      { S3PrivateBucket },
      { getFileS3Key }
    ] = await Promise.all([
      globalVendorImport<any>('common/parentFolder/utils'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('openapi/core/dataset/api'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('support/permission/user/constant'),
      serviceVendorImport<any>('common/middle/tracks/utils'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/schema'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('support/permission/schema'),
      serviceVendorImport<any>('common/s3/sources/avatar'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      serviceVendorImport<any>('common/s3/buckets/private'),
      serviceVendorImport<any>('common/s3/utils')
    ]);
    const { datasetParams, files } = CreateDatasetWithFilesBodySchema.parse(body);
    const {
      parentId,
      name,
      avatar,
      vectorModel = aiModel.getDefaultEmbeddingModel()?.model,
      agentModel = aiModel.getDefaultLLMModel()?.model,
      vlmModel = aiModel.getDefaultVLMModel()?.model
    } = datasetParams;
    const { teamId, tmbId, userId } = parentId
      ? await this.authDataset(request, parentId, WritePermissionVal)
      : await this.authUserPer(request, TeamDatasetCreatePermissionVal);

    await checkTeamDatasetLimit(teamId);

    const result = await mongoSessionRun(async (session: any) => {
      const [dataset] = await MongoDataset.create(
        [
          {
            ...parseParentIdInMongo(parentId),
            name,
            teamId,
            tmbId,
            vectorModel,
            agentModel,
            vlmModel,
            avatar,
            intro: '',
            type: constants.DatasetTypeEnum.dataset
          }
        ],
        { session, ordered: true }
      );

      await MongoResourcePermission.insertOne({
        teamId,
        tmbId,
        resourceId: dataset._id,
        permission: OwnerRoleVal,
        resourceType: PerResourceTypeEnum.dataset
      });
      await getS3AvatarSource().refreshAvatar(avatar, undefined, session);

      const bucket = new S3PrivateBucket();
      for (const file of files) {
        if (!file.fileId.startsWith('temp/')) {
          return Promise.reject('Only temp files are supported');
        }
        const { fileKey: newKey } = getFileS3Key.dataset({
          datasetId: String(dataset._id),
          filename: file.name
        });

        await bucket.move({ from: file.fileId, to: newKey });
        await createCollectionAndInsertData({
          dataset,
          createCollectionParams: {
            datasetId: dataset._id,
            teamId,
            tmbId,
            type: constants.DatasetCollectionTypeEnum.file,
            name: file.name,
            fileId: newKey,
            metadata: { relatedImgId: newKey },
            trainingType: constants.DatasetCollectionDataProcessModeEnum.chunk,
            chunkTriggerType: constants.ChunkTriggerConfigTypeEnum.minSize,
            chunkTriggerMinSize: 1000,
            chunkSettingMode: constants.ChunkSettingModeEnum.auto,
            chunkSplitMode: constants.DataChunkSplitModeEnum.paragraph,
            chunkSize: 1024,
            indexSize: 512,
            customPdfParse: false
          },
          session
        });
      }

      return {
        datasetId: dataset._id,
        name: dataset.name,
        avatar: dataset.avatar,
        vectorModel: aiModel.getEmbeddingModel(dataset.vectorModel)
      };
    });

    pushTrack.createDataset({
      type: constants.DatasetTypeEnum.dataset,
      teamId,
      tmbId,
      uid: userId
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_DATASET,
      params: {
        datasetName: name,
        datasetType: getI18nDatasetType(constants.DatasetTypeEnum.dataset)
      }
    });

    return CreateDatasetWithFilesResponseSchema.parse(result);
  }

  async readCollectionSource(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { DatasetCollectionTypeEnum },
      { ReadPermissionVal },
      { DatasetErrEnum },
      { getCollectionWithDataset },
      { getApiDatasetRequest },
      s3Utils,
      { getS3DatasetSource },
      { ReadCollectionSourceBodySchema, ReadCollectionSourceResponseSchema }
    ] = await Promise.all([
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/error/code/dataset'),
      serviceVendorImport<any>('core/dataset/controller'),
      serviceVendorImport<any>('core/dataset/apiDataset'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      globalVendorImport<any>('openapi/core/dataset/collection/api')
    ]);
    const parsed = ReadCollectionSourceBodySchema.parse(body);
    const { collectionId, appId, chatId, chatItemDataId, shareId, outLinkUid, teamId, teamToken } =
      parsed;
    const { collection } = await (async () => {
      if (!appId || !chatId || !chatItemDataId) {
        return this.authDatasetCollection(request, collectionId, ReadPermissionVal);
      }

      const { authChatCrud, authCollectionInChat } = await serviceVendorImport<any>('support/permission/chat/auth');
      const [authRes, collection] = await Promise.all([
        authChatCrud({
          req: request,
          authToken: true,
          appId,
          chatId,
          shareId,
          outLinkUid,
          teamId,
          teamToken
        }),
        getCollectionWithDataset(collectionId),
        authCollectionInChat({ appId, chatId, collectionIds: [collectionId] })
      ]);

      if (!authRes.canDownloadSource) {
        return Promise.reject(DatasetErrEnum.unAuthDatasetFile);
      }

      return { ...authRes, collection };
    })();
    const sourceUrl = await (async () => {
      if (
        collection.type === DatasetCollectionTypeEnum.file &&
        collection.fileId &&
        s3Utils.isS3ObjectKey(collection.fileId, 'dataset')
      ) {
        return (
          await getS3DatasetSource().createGetDatasetFileURL({
            key: collection.fileId,
            expiredHours: 1,
            external: true
          })
        ).url;
      }
      if (collection.type === DatasetCollectionTypeEnum.link && collection.rawLink) {
        return collection.rawLink;
      }
      if (collection.type === DatasetCollectionTypeEnum.apiFile && collection.apiFileId) {
        return (await getApiDatasetRequest(collection.dataset.apiDatasetServer)).getFilePreviewUrl({
          apiFileId: collection.apiFileId
        });
      }
      if (collection.type === DatasetCollectionTypeEnum.externalFile) {
        if (collection.externalFileId && collection.dataset.externalReadUrl) {
          return collection.dataset.externalReadUrl.replace('{{fileId}}', collection.externalFileId);
        }
        if (collection.externalFileUrl) {
          return collection.externalFileUrl;
        }
      }
      return '';
    })();

    return ReadCollectionSourceResponseSchema.parse({ type: 'url', value: sourceUrl });
  }

  async exportCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { DatasetErrEnum },
      { ReadPermissionVal },
      { readFromSecondary },
      { MongoDatasetData },
      { getCollectionWithDataset },
      { sanitizeCsvField },
      datasetUtils,
      { addDays },
      { ExportCollectionBodySchema }
    ] = await Promise.all([
      globalVendorImport<any>('common/error/code/dataset'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/controller'),
      serviceVendorImport<any>('common/file/csv'),
      serviceVendorImport<any>('core/dataset/utils'),
      dynamicImport<any>('date-fns'),
      globalVendorImport<any>('openapi/core/dataset/collection/api')
    ]);
    const parsed = ExportCollectionBodySchema.parse(body);
    const collectionId = parsed.collectionId;
    const { collection, teamId: userTeamId, chatTime } = await (async () => {
      if (!('chatItemDataId' in parsed)) {
        const result = await this.authDatasetCollection(request, collectionId, ReadPermissionVal);

        return {
          ...result,
          chatTime: undefined
        };
      }

      const { appId, chatId, shareId, outLinkUid, teamId, teamToken } = parsed;
      const { authChatCrud, authCollectionInChat } = await serviceVendorImport<any>('support/permission/chat/auth');
      const [authRes, collection] = await Promise.all([
        authChatCrud({
          req: request,
          authToken: true,
          appId,
          chatId,
          shareId,
          outLinkUid,
          teamId,
          teamToken
        }),
        getCollectionWithDataset(collectionId),
        authCollectionInChat({ appId, chatId, collectionIds: [collectionId] })
      ]);

      if (!authRes.canDownloadSource) {
        return Promise.reject(DatasetErrEnum.unAuthDatasetFile);
      }

      return {
        ...authRes,
        collection,
        chatTime: parsed.chatTime
      };
    })();
    const where = {
      teamId: userTeamId,
      datasetId: collection.datasetId,
      collectionId,
      ...(chatTime
        ? {
            $or: [
              { updateTime: { $lt: new Date(chatTime) } },
              { history: { $elemMatch: { updateTime: { $lt: new Date(chatTime) } } } }
            ]
          }
        : {})
    };
    const rows = await MongoDatasetData.find(
      where,
      'q a',
      { ...readFromSecondary }
    )
      .sort({ chunkIndex: 1 })
      .limit(50000)
      .lean();
    const csv = [
      '\uFEFFq,a',
      ...rows.map((doc: any) => {
        const q = datasetUtils.replaceS3KeyToPreviewUrl(
          sanitizeCsvField(doc.q || ''),
          addDays(new Date(), 90)
        );
        const a = datasetUtils.replaceS3KeyToPreviewUrl(
          sanitizeCsvField(doc.a || ''),
          addDays(new Date(), 90)
        );
        return `${q},${a}`;
      })
    ].join('\n');

    return { filename: 'data.csv', contentType: 'text/csv; charset=utf-8;', content: csv };
  }

  async exportAllDataset(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { MongoDatasetData },
      { findDatasetAndAllChildren },
      { checkExportDatasetLimit, updateExportDatasetLimit },
      { WritePermissionVal },
      { readFromSecondary },
      { sanitizeCsvField },
      { ExportDatasetQuerySchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/controller'),
      serviceVendorImport<any>('support/user/utils'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('common/file/csv'),
      globalVendorImport<any>('openapi/core/dataset/api')
    ]);
    const { datasetId } = ExportDatasetQuerySchema.parse(query);
    const { teamId, dataset } = await this.authDataset(request, datasetId, WritePermissionVal, false);

    await checkExportDatasetLimit({
      teamId,
      limitMinutes: (globalThis as any).feConfigs?.limit?.exportDatasetLimitMinutes
    });

    const datasets = await findDatasetAndAllChildren({ teamId, datasetId, fields: '_id' });
    const rows = await MongoDatasetData.find(
      {
        teamId,
        datasetId: { $in: datasets.map((item: any) => item._id) }
      },
      'q a indexes',
      { ...readFromSecondary }
    )
      .limit(50000)
      .lean();
    const csv = [
      '\uFEFFq,a,indexes',
      ...rows.map((doc: any) => {
        const indexes = (doc.indexes || [])
          .map((item: any) => sanitizeCsvField(item.text || ''))
          .join(',');
        return `${sanitizeCsvField(doc.q || '')},${sanitizeCsvField(doc.a || '')},${indexes}`;
      })
    ].join('\n');

    updateExportDatasetLimit(teamId);

    return {
      filename: `${encodeURIComponent(dataset.name)}-backup.csv`,
      contentType: 'text/csv; charset=utf-8;',
      content: csv
    };
  }

  async deleteDatasetData(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { WritePermissionVal },
      { authDatasetData },
      { DeleteDatasetDataQuerySchema, DeleteDatasetDataResponseSchema },
      { deleteDatasetData },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      serviceVendorImport<any>('core/dataset/data/data'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { id: dataId } = DeleteDatasetDataQuerySchema.parse(query);
    const { datasetData, tmbId, teamId, collection } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: WritePermissionVal
    });

    await deleteDatasetData(datasetData);
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.DELETE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return DeleteDatasetDataResponseSchema.parse('success');
  }

  async insertDatasetData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      aiModel,
      { getCollectionWithDataset },
      { simpleText },
      { checkDatasetIndexLimit },
      { WritePermissionVal },
      { hasSameValue },
      { createDatasetData },
      { InsertDataBodySchema, InsertDataResponseSchema },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/controller'),
      globalVendorImport<any>('common/string/tools'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/data/utils'),
      serviceVendorImport<any>('core/dataset/data/data'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { collectionId, q, a, indexes } = InsertDataBodySchema.parse(body);
    const { teamId, tmbId, collection } = await this.authDatasetCollection(
      request,
      collectionId,
      WritePermissionVal
    );

    await checkDatasetIndexLimit({ teamId, insertLen: 1 + (indexes?.length || 0) });

    const [
      {
        dataset: { _id: datasetId, vectorModel },
        indexPrefixTitle,
        imageIndex,
        indexSize,
        name
      }
    ] = await Promise.all([getCollectionWithDataset(collectionId)]);
    const formatQ = simpleText(q);
    const formatA = simpleText(a);

    await hasSameValue({
      teamId,
      datasetId,
      collectionId,
      q: formatQ,
      a: formatA || ''
    });

    const vectorModelData = aiModel.getEmbeddingModel(vectorModel);
    const formatIndexes = indexes?.map((item: any) => ({
      ...item,
      text: simpleText(item.text)
    }));
    const { insertId, tokens } = await createDatasetData({
      teamId,
      tmbId,
      datasetId,
      collectionId,
      q: formatQ,
      a: formatA,
      chunkIndex: 0,
      indexSize,
      indexPrefix: indexPrefixTitle ? `# ${name}` : undefined,
      embeddingModel: vectorModelData.model,
      imageIndex: !!imageIndex,
      indexes: formatIndexes
    });

    this.pushGenerateVectorUsage({
      teamId,
      tmbId,
      inputTokens: tokens,
      model: vectorModelData.model
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return InsertDataResponseSchema.parse(insertId);
  }

  async createDatasetDataIndex(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { CreateDatasetDataIndexBodySchema, DatasetDataIndexResponseSchema },
      { WritePermissionVal },
      { authDatasetData },
      { createDatasetDataIndex },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      serviceVendorImport<any>('core/dataset/data/dataIndex'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { dataId, type, text } = CreateDatasetDataIndexBodySchema.parse(body);
    const { datasetData, tmbId, teamId, collection } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: WritePermissionVal
    });
    const { index, tokens } = await createDatasetDataIndex({
      data: datasetData,
      type,
      text,
      model: collection.dataset.vectorModel
    });

    if (tokens > 0) {
      this.pushGenerateVectorUsage({
        teamId,
        tmbId,
        inputTokens: tokens,
        model: collection.dataset.vectorModel
      });
    }
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.UPDATE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return DatasetDataIndexResponseSchema.parse({ index });
  }

  async updateDatasetDataIndex(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { UpdateDatasetDataIndexBodySchema, DatasetDataIndexResponseSchema },
      { WritePermissionVal },
      { authDatasetData },
      { updateDatasetDataIndex },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      serviceVendorImport<any>('core/dataset/data/dataIndex'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { dataId, indexDataId, type, text } = UpdateDatasetDataIndexBodySchema.parse(body);
    const { datasetData, tmbId, teamId, collection } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: WritePermissionVal
    });
    const { index, tokens } = await updateDatasetDataIndex({
      data: datasetData,
      indexDataId,
      type,
      text,
      model: collection.dataset.vectorModel
    });

    if (tokens > 0) {
      this.pushGenerateVectorUsage({
        teamId,
        tmbId,
        inputTokens: tokens,
        model: collection.dataset.vectorModel
      });
    }
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.UPDATE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return DatasetDataIndexResponseSchema.parse({ index });
  }

  async deleteDatasetDataIndex(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { DeleteDatasetDataIndexBodySchema, DeleteDatasetDataIndexResponseSchema },
      { WritePermissionVal },
      { authDatasetData },
      { deleteDatasetDataIndex },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      serviceVendorImport<any>('core/dataset/data/dataIndex'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { dataId, indexDataId } = DeleteDatasetDataIndexBodySchema.parse(body);
    const { datasetData, tmbId, teamId, collection } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: WritePermissionVal
    });

    await deleteDatasetDataIndex({
      data: datasetData,
      indexDataId
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.UPDATE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return DeleteDatasetDataIndexResponseSchema.parse({});
  }

  async updateDatasetData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { WritePermissionVal },
      { authDatasetData },
      { UpdateDatasetDataBodySchema, UpdateDatasetDataResponseSchema },
      datasetUtils,
      { DatasetDataIndexTypeEnum },
      { addHours },
      { updateDatasetDataByIndexes, updateDatasetDataSystemIndexes },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      serviceVendorImport<any>('core/dataset/utils'),
      globalVendorImport<any>('core/dataset/data/constants'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('core/dataset/data/data'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { dataId, q, a, indexes } = UpdateDatasetDataBodySchema.parse(body);
    const hasIndexes = Object.hasOwn(body, 'indexes');
    const {
      collection: { name, indexPrefixTitle },
      teamId,
      tmbId,
      collection,
      datasetData
    } = await authDatasetData({
      req: request,
      authToken: true,
      authApiKey: true,
      dataId,
      per: WritePermissionVal
    });
    const dataset = collection.dataset;
    const vectorModel = dataset.vectorModel;
    const nextQ = q ?? datasetData.q ?? '';
    const nextA = a ?? datasetData.a ?? '';
    const indexPrefix = indexPrefixTitle ? `# ${name}` : undefined;

    const { tokens = 0 } = await (async () => {
      if (hasIndexes) {
        return updateDatasetDataByIndexes({
          dataId,
          q: nextQ,
          a: nextA,
          imageId: datasetData.imageId,
          imageIndex: !!collection.imageIndex,
          indexes: (indexes || []).filter(
            (item: any) => item.type !== DatasetDataIndexTypeEnum.imageEmbedding
          ),
          model: vectorModel,
          indexSize: collection.indexSize,
          indexPrefix
        });
      }

      if (nextQ || datasetData.imageId) {
        return updateDatasetDataSystemIndexes({
          dataId,
          q: nextQ,
          a: nextA,
          imageId: datasetData.imageId,
          imageIndex: !!collection.imageIndex,
          model: vectorModel,
          indexSize: collection.indexSize,
          indexPrefix
        });
      }

      return {};
    })();

    if (tokens > 0) {
      this.pushGenerateVectorUsage({ teamId, tmbId, inputTokens: tokens, model: vectorModel });
    }
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.UPDATE_DATA,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return UpdateDatasetDataResponseSchema.parse({
      q: datasetUtils.replaceS3KeyToPreviewUrl(nextQ, addHours(new Date(), 1)),
      a: nextA ? datasetUtils.replaceS3KeyToPreviewUrl(nextA, addHours(new Date(), 1)) : undefined
    });
  }

  async getQuoteData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { MongoDatasetData },
      { ReadPermissionVal },
      { authDatasetData },
      { MongoDatasetCollection },
      { ChatErrEnum },
      { i18nT },
      { formatDatasetDataValue },
      { UserError },
      { GetQuoteDataBodySchema, GetQuoteDataResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/data/schema'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/dataset/auth'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      globalVendorImport<any>('common/error/code/chat'),
      globalVendorImport<any>('common/i18n/utils'),
      serviceVendorImport<any>('core/dataset/data/controller'),
      globalVendorImport<any>('common/error/utils'),
      globalVendorImport<any>('openapi/core/dataset/data/api')
    ]);
    const parsed = GetQuoteDataBodySchema.parse(body);
    const { id: dataId } = parsed;
    const { collection, q, a } = await (async () => {
      if (parsed.chatId && parsed.appId && parsed.chatItemDataId) {
        const { appId, chatId, shareId, outLinkUid, teamId, teamToken } = parsed;
        const { authChatCrud, authCollectionInChat } = await serviceVendorImport<any>('support/permission/chat/auth');

        await authChatCrud({
          req: request,
          authToken: true,
          appId,
          chatId,
          shareId,
          outLinkUid,
          teamId,
          teamToken
        });

        const datasetData = await MongoDatasetData.findById(dataId).lean();
        if (!datasetData) {
          return Promise.reject(new UserError(i18nT('common:data_not_found')));
        }

        const [collection, { showCite }] = await Promise.all([
          MongoDatasetCollection.findById(datasetData.collectionId).lean(),
          authChatCrud({
            req: request,
            authToken: true,
            appId,
            chatId,
            shareId,
            outLinkUid,
            teamId,
            teamToken
          }),
          authCollectionInChat({
            appId,
            chatId,
            collectionIds: [datasetData.collectionId]
          })
        ]);
        if (!collection) {
          return Promise.reject(new UserError('Can not find the collection'));
        }
        if (!showCite) {
          return Promise.reject(new UserError(ChatErrEnum.unAuthChat));
        }

        return {
          collection,
          ...formatDatasetDataValue({
            q: datasetData.q,
            a: datasetData.a,
            imageId: datasetData.imageId
          })
        };
      }

      const { datasetData, collection } = await authDatasetData({
        req: request,
        authToken: true,
        authApiKey: true,
        dataId,
        per: ReadPermissionVal
      });
      return {
        collection,
        ...formatDatasetDataValue({
          q: datasetData.q,
          a: datasetData.a,
          imageId: datasetData.imageId
        })
      };
    })();

    return GetQuoteDataResponseSchema.parse({ collection, q, a });
  }

  async searchTest(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { deepRagSearch, defaultSearchDatasetData },
      { updateApiKeyUsage },
      { UsageSourceEnum },
      { checkTeamAIPoints },
      { ReadPermissionVal },
      aiModel,
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      s3Utils,
      { getS3DatasetSource },
      { pushDatasetTestUsage },
      { SearchDatasetTestBodySchema, SearchDatasetTestResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/search'),
      serviceVendorImport<any>('support/openapi/tools'),
      globalVendorImport<any>('support/wallet/usage/constants'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      serviceVendorImport<any>('support/wallet/usage/push'),
      globalVendorImport<any>('openapi/core/dataset/api')
    ]);
    const parsed = SearchDatasetTestBodySchema.parse(body);
    const start = Date.now();
    const { dataset, teamId, tmbId, apikey } = await this.authDataset(
      request,
      parsed.datasetId,
      ReadPermissionVal
    );

    await checkTeamAIPoints(teamId);

    const validQueryImageKeys = parsed.queryImageUrls.filter(
      (key: string) => s3Utils.isS3ObjectKey(key, 'temp') && key.startsWith(`temp/${teamId}/`)
    );
    if (validQueryImageKeys.length !== parsed.queryImageUrls.length) {
      return Promise.reject('Invalid query image key');
    }

    const validQueryImageUrls = await Promise.all(
      validQueryImageKeys.map(async (key: string) => {
        const { url } = await getS3DatasetSource().createExternalUrl({ key, expiredHours: 1 });
        return url;
      })
    );
    const rerankModelData = aiModel.getRerankModel(parsed.rerankModel);
    const searchData = {
      histories: [],
      teamId,
      reRankQuery: parsed.text,
      textQueries: parsed.text ? [parsed.text] : [],
      imageQueries: validQueryImageUrls,
      model: dataset.vectorModel,
      vlmModel: dataset.vlmModel,
      limit: Math.min(parsed.limit ?? 5000, 20000),
      similarity: parsed.similarity,
      datasetIds: [parsed.datasetId],
      searchMode: parsed.searchMode,
      embeddingWeight: parsed.embeddingWeight,
      usingReRank: parsed.usingReRank,
      rerankModel: rerankModelData,
      rerankWeight: parsed.rerankWeight
    };
    const {
      searchRes,
      embeddingTokens,
      reRankInputTokens,
      usingReRank: searchUsingReRank,
      queryExtensionResult,
      imageCaptionResult,
      ...result
    } =
      parsed.datasetDeepSearch && !!parsed.text.trim()
        ? await deepRagSearch({
            ...searchData,
            datasetDeepSearchModel: parsed.datasetDeepSearchModel,
            datasetDeepSearchMaxTimes: parsed.datasetDeepSearchMaxTimes,
            datasetDeepSearchBg: parsed.datasetDeepSearchBg
          })
        : await defaultSearchDatasetData({
            ...searchData,
            datasetSearchUsingExtensionQuery: parsed.datasetSearchUsingExtensionQuery ?? false,
            datasetSearchExtensionModel: parsed.datasetSearchExtensionModel,
            datasetSearchExtensionBg: parsed.datasetSearchExtensionBg
          });
    const source = apikey ? UsageSourceEnum.api : UsageSourceEnum.fastgpt;
    const { totalPoints } = pushDatasetTestUsage({
      teamId,
      tmbId,
      source,
      embUsage: {
        model: dataset.vectorModel,
        inputTokens: embeddingTokens
      },
      rerankUsage: searchUsingReRank
        ? {
            model: rerankModelData.model,
            inputTokens: reRankInputTokens
          }
        : undefined,
      extensionUsage: queryExtensionResult
        ? {
            model: queryExtensionResult.llmModel,
            inputTokens: queryExtensionResult.inputTokens,
            outputTokens: queryExtensionResult.outputTokens,
            embeddingTokens: queryExtensionResult.embeddingTokens,
            embeddingModel: dataset.vectorModel
          }
        : undefined,
      imageCaptionUsage: imageCaptionResult
        ? {
            model: imageCaptionResult.model,
            inputTokens: imageCaptionResult.inputTokens,
            outputTokens: imageCaptionResult.outputTokens
          }
        : undefined
    });

    if (apikey) {
      updateApiKeyUsage({ apikey, totalPoints });
    }
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.SEARCH_TEST,
      params: {
        datasetName: dataset.name,
        datasetType: getI18nDatasetType(dataset.type)
      }
    });

    return SearchDatasetTestResponseSchema.parse({
      list: searchRes,
      duration: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      queryExtensionModel: queryExtensionResult?.llmModel,
      usingReRank: searchUsingReRank,
      ...result
    });
  }

  async createLocalFileCollection(
    request: Pick<FastifyRequest, 'headers' | 'body'>,
    _body: Record<string, any>
  ) {
    const [
      { CreateCollectionByLocalFileBodySchema },
      { createCollectionAndInsertData },
      { DatasetCollectionTypeEnum },
      { WritePermissionVal },
      { getS3DatasetSource },
      { documentFileType },
      { parseAllowedExtensions },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      globalVendorImport<any>('common/file/constants'),
      serviceVendorImport<any>('common/s3/utils/uploadConstraints'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const form = parseMultipartBody(request, {
      maxFileSizeMb: (globalThis as any).feConfigs?.uploadFileMaxSize,
      allowedExtensions: parseAllowedExtensions(documentFileType)
    });
    const file = form.files[0];

    try {
      const { teamId, tmbId, dataset } = await this.authDataset(
        request,
        form.data.datasetId,
        WritePermissionVal
      );

      await checkDatasetIndexLimit({
        teamId,
        insertLen: 1
      });

      const collectionData = CreateCollectionByLocalFileBodySchema.parse(form.data);
      const collectionName = decodeURIComponent(file.originalname);
      const fileId = await getS3DatasetSource().upload({
        datasetId: dataset._id,
        stream: fs.createReadStream(file.path),
        size: file.size,
        filename: collectionName
      });

      return createCollectionAndInsertData({
        dataset,
        createCollectionParams: {
          ...collectionData,
          datasetId: dataset._id,
          name: collectionName,
          teamId,
          tmbId,
          type: DatasetCollectionTypeEnum.file,
          fileId,
          metadata: {
            ...collectionData.metadata,
            relatedImgId: fileId
          }
        }
      });
    } finally {
      clearMultipartTempFiles(form.files);
    }
  }

  async createBackupCollection(
    request: Pick<FastifyRequest, 'headers' | 'body'>,
    _body: Record<string, any>
  ) {
    const [
      { getLogger, LogCategories },
      { readRawTextByLocalFile },
      { WritePermissionVal },
      { createCollectionAndInsertData },
      { DatasetCollectionDataProcessModeEnum, DatasetCollectionTypeEnum },
      { i18nT },
      { isCSVFile },
      { getS3DatasetSource },
      { CreateBackupCollectionFormSchema },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      serviceVendorImport<any>('common/logger'),
      serviceVendorImport<any>('common/file/read/utils'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('common/i18n/utils'),
      globalVendorImport<any>('common/file/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const logger = getLogger(LogCategories.MODULE.DATASET.COLLECTION);
    const form = parseMultipartBody(request, {
      maxFileSizeMb: (globalThis as any).feConfigs?.uploadFileMaxSize
    });
    const file = form.files[0];

    try {
      const filename = decodeURIComponent(file.originalname);
      const { datasetId, parentId } = CreateBackupCollectionFormSchema.parse(form.data);

      if (!isCSVFile(filename)) {
        return Promise.reject('File must be a CSV file');
      }

      const { teamId, tmbId, dataset } = await this.authDataset(
        request,
        datasetId,
        WritePermissionVal
      );

      await checkDatasetIndexLimit({
        teamId,
        insertLen: 1
      });

      const { rawText } = await readRawTextByLocalFile({
        teamId,
        tmbId,
        path: file.path,
        encoding: file.encoding,
        getFormatText: false
      });

      if (!rawText.trim().startsWith('q,a,indexes')) {
        return Promise.reject(i18nT('dataset:backup_template_invalid'));
      }

      const fileId = await getS3DatasetSource().upload({
        datasetId: dataset._id,
        stream: fs.createReadStream(file.path),
        size: file.size,
        filename
      });

      await createCollectionAndInsertData({
        dataset,
        rawText,
        backupParse: true,
        createCollectionParams: {
          teamId,
          tmbId,
          datasetId: dataset._id,
          parentId,
          name: filename,
          type: DatasetCollectionTypeEnum.file,
          fileId,
          trainingType: DatasetCollectionDataProcessModeEnum.backup
        }
      });

      return {};
    } catch (error) {
      logger.error(`Backup dataset collection create error: ${error}`);
      return Promise.reject(error);
    } finally {
      clearMultipartTempFiles(form.files);
    }
  }

  async createTemplateCollection(
    request: Pick<FastifyRequest, 'headers' | 'body'>,
    _body: Record<string, any>
  ) {
    const [
      { getLogger, LogCategories },
      { readRawTextByLocalFile },
      { WritePermissionVal },
      { createCollectionAndInsertData },
      { DatasetCollectionDataProcessModeEnum, DatasetCollectionTypeEnum },
      { i18nT },
      { isCSVFile },
      { getS3DatasetSource },
      { CreateTemplateCollectionFormSchema },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      serviceVendorImport<any>('common/logger'),
      serviceVendorImport<any>('common/file/read/utils'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('common/i18n/utils'),
      globalVendorImport<any>('common/file/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const logger = getLogger(LogCategories.MODULE.DATASET.COLLECTION);
    const form = parseMultipartBody(request, {
      maxFileSizeMb: (globalThis as any).feConfigs?.uploadFileMaxSize
    });
    const file = form.files[0];

    try {
      const filename = decodeURIComponent(file.originalname);
      const { datasetId, parentId } = CreateTemplateCollectionFormSchema.parse(form.data);

      if (!isCSVFile(filename)) {
        return Promise.reject('File must be a CSV file');
      }

      const { teamId, tmbId, dataset } = await this.authDataset(
        request,
        datasetId,
        WritePermissionVal
      );

      await checkDatasetIndexLimit({
        teamId,
        insertLen: 1
      });

      const { rawText } = await readRawTextByLocalFile({
        teamId,
        tmbId,
        path: file.path,
        encoding: file.encoding,
        getFormatText: false
      });

      if (!rawText.trim().startsWith('q,a,indexes')) {
        return Promise.reject(i18nT('dataset:template_file_invalid'));
      }

      const fileId = await getS3DatasetSource().upload({
        datasetId: dataset._id,
        stream: fs.createReadStream(file.path),
        size: file.size,
        filename
      });

      await createCollectionAndInsertData({
        dataset,
        rawText,
        backupParse: true,
        createCollectionParams: {
          teamId,
          tmbId,
          datasetId: dataset._id,
          parentId,
          name: filename,
          type: DatasetCollectionTypeEnum.file,
          fileId,
          trainingType: DatasetCollectionDataProcessModeEnum.template
        }
      });

      return {};
    } catch (error) {
      logger.error(`Template dataset collection create error: ${error}`);
      return Promise.reject(error);
    } finally {
      clearMultipartTempFiles(form.files);
    }
  }

  async createImageCollection(
    request: Pick<FastifyRequest, 'headers' | 'body'>,
    _body: Record<string, any>
  ) {
    const [
      { CreateImageCollectionFormSchema },
      { createCollectionAndInsertData },
      { DatasetCollectionDataProcessModeEnum, DatasetCollectionTypeEnum },
      { WritePermissionVal },
      { i18nT },
      { authFrequencyLimit },
      { addDays, addSeconds },
      { getFileS3Key, uploadImage2S3Bucket },
      { getTeamPlanStatus },
      { datasetImageCollectionFileType },
      { parseAllowedExtensions },
      { checkDatasetIndexLimit },
      { getDatasetImageIndexCapability }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/i18n/utils'),
      serviceVendorImport<any>('common/system/frequencyLimit/utils'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('support/wallet/sub/utils'),
      globalVendorImport<any>('common/file/constants'),
      serviceVendorImport<any>('common/s3/utils/uploadConstraints'),
      serviceVendorImport<any>('support/permission/teamLimit'),
      serviceVendorImport<any>('core/dataset/utils')
    ]);
    const form = parseMultipartBody(request, {
      maxFileSizeMb: (globalThis as any).feConfigs?.uploadFileMaxSize,
      allowedExtensions: parseAllowedExtensions(datasetImageCollectionFileType)
    });

    try {
      const { parentId, datasetId, collectionName } = CreateImageCollectionFormSchema.parse(
        form.data
      );
      const { dataset, teamId, tmbId } = await this.authDataset(
        request,
        datasetId,
        WritePermissionVal
      );

      await checkDatasetIndexLimit({
        teamId,
        insertLen: 1
      });

      const planStatus = await getTeamPlanStatus({ teamId });
      await authFrequencyLimit({
        eventId: `${tmbId}-uploadfile`,
        maxAmount:
          planStatus.standard?.maxUploadFileCount ||
          (globalThis as any).feConfigs?.uploadFileMaxAmount,
        expiredTime: addSeconds(new Date(), 30),
        num: form.files.length
      });

      const { supportVlm, supportImageEmbedding } = getDatasetImageIndexCapability({
        vectorModel: dataset.vectorModel,
        vlmModel: dataset.vlmModel
      });

      if (!supportVlm && !supportImageEmbedding) {
        return Promise.reject(i18nT('file:Image_dataset_requires_VLM_model_to_be_configured'));
      }

      const imageIds = await Promise.all(
        form.files.map(async (file) => {
          const filename = path.basename(file.filename);
          const { fileKey } = getFileS3Key.dataset({ datasetId, filename });

          return uploadImage2S3Bucket('private', {
            base64Img: file.buffer.toString('base64'),
            uploadKey: fileKey,
            mimetype: file.mimetype,
            filename,
            expiredTime: addDays(new Date(), 7)
          });
        })
      );

      return createCollectionAndInsertData({
        dataset,
        imageIds,
        createCollectionParams: {
          parentId,
          teamId,
          tmbId,
          datasetId,
          type: DatasetCollectionTypeEnum.images,
          name: collectionName,
          trainingType: supportVlm
            ? DatasetCollectionDataProcessModeEnum.imageParse
            : DatasetCollectionDataProcessModeEnum.chunk
        }
      });
    } finally {
      clearMultipartTempFiles(form.files);
    }
  }

  async insertDatasetImages(
    request: Pick<FastifyRequest, 'headers' | 'body'>,
    _body: Record<string, any>
  ) {
    const [
      { authFrequencyLimit },
      { addDays, addSeconds },
      { WritePermissionVal },
      { mongoSessionRun },
      { createTrainingUsage },
      { UsageSourceEnum },
      aiModel,
      { pushDataListToTrainingQueue },
      { TrainingModeEnum },
      { getFileS3Key, uploadImage2S3Bucket },
      { getTeamPlanStatus },
      { InsertImagesBodySchema },
      { datasetImageCollectionFileType },
      { parseAllowedExtensions },
      { i18nT },
      { getDatasetImageIndexCapability }
    ] = await Promise.all([
      serviceVendorImport<any>('common/system/frequencyLimit/utils'),
      dynamicImport<any>('date-fns'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('support/wallet/usage/controller'),
      globalVendorImport<any>('support/wallet/usage/constants'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/training/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('support/wallet/sub/utils'),
      globalVendorImport<any>('openapi/core/dataset/data/api'),
      globalVendorImport<any>('common/file/constants'),
      serviceVendorImport<any>('common/s3/utils/uploadConstraints'),
      globalVendorImport<any>('common/i18n/utils'),
      serviceVendorImport<any>('core/dataset/utils')
    ]);
    const form = parseMultipartBody(request, {
      maxFileSizeMb: (globalThis as any).feConfigs?.uploadFileMaxSize,
      allowedExtensions: parseAllowedExtensions(datasetImageCollectionFileType)
    });

    try {
      const { collectionId } = InsertImagesBodySchema.parse(form.data);
      const { collection, teamId, tmbId } = await this.authDatasetCollection(
        request,
        collectionId,
        WritePermissionVal
      );
      const dataset = collection.dataset;
      const { availableVlmModel, supportVlm, supportImageEmbedding } =
        getDatasetImageIndexCapability({
          vectorModel: dataset.vectorModel,
          vlmModel: dataset.vlmModel
        });

      if (!supportVlm && !supportImageEmbedding) {
        return Promise.reject(i18nT('file:Image_dataset_requires_VLM_model_to_be_configured'));
      }

      const planStatus = await getTeamPlanStatus({ teamId });
      await authFrequencyLimit({
        eventId: `${tmbId}-uploadfile`,
        maxAmount:
          planStatus.standard?.maxUploadFileCount ||
          (globalThis as any).feConfigs?.uploadFileMaxAmount,
        expiredTime: addSeconds(new Date(), 30),
        num: form.files.length
      });

      const imageIds = await Promise.all(
        form.files.map((file) =>
          uploadImage2S3Bucket('private', {
            base64Img: file.buffer.toString('base64'),
            uploadKey: getFileS3Key.dataset({
              datasetId: dataset._id,
              filename: path.basename(file.filename)
            }).fileKey,
            mimetype: file.mimetype,
            filename: path.basename(file.filename),
            expiredTime: addDays(new Date(), 7)
          })
        )
      );

      await mongoSessionRun(async (session: any) => {
        const { usageId } = await createTrainingUsage({
          teamId,
          tmbId,
          appName: collection.name,
          billSource: UsageSourceEnum.training,
          vectorModel: aiModel.getEmbeddingModel(dataset.vectorModel)?.name,
          agentModel: aiModel.getLLMModel(dataset.agentModel)?.name,
          vllmModel: availableVlmModel?.name,
          session
        });

        await pushDataListToTrainingQueue({
          teamId,
          tmbId,
          datasetId: dataset._id,
          collectionId,
          agentModel: dataset.agentModel,
          vectorModel: dataset.vectorModel,
          vlmModel: dataset.vlmModel,
          mode: supportVlm ? TrainingModeEnum.imageParse : TrainingModeEnum.chunk,
          billId: usageId,
          data: imageIds.map((item: string) => ({
            imageId: item
          })),
          session
        });
      });

      return {};
    } finally {
      clearMultipartTempFiles(form.files);
    }
  }

  async getDatasetTrainingQueue(
    request: Pick<FastifyRequest, 'headers'>,
    query: Record<string, any>
  ) {
    const [
      { GetDatasetTrainingQueueQuerySchema, GetDatasetTrainingQueueResponseSchema },
      { ReadPermissionVal },
      { MongoDatasetData },
      { MongoDatasetTraining },
      { readFromSecondary }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/training/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/mongo/utils')
    ]);
    const { datasetId } = GetDatasetTrainingQueueQuerySchema.parse(query);
    const { teamId } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const [rebuildingCount, trainingCount] = await Promise.all([
      MongoDatasetData.countDocuments(
        { rebuilding: true, teamId, datasetId },
        { ...readFromSecondary }
      ),
      MongoDatasetTraining.countDocuments({ teamId, datasetId }, { ...readFromSecondary })
    ]);

    return GetDatasetTrainingQueueResponseSchema.parse({
      rebuildingCount,
      trainingCount
    });
  }

  async deleteTrainingData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { DeleteTrainingDataBodySchema, DeleteTrainingDataResponseSchema },
      { ManagePermissionVal },
      { MongoDatasetTraining }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/training/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/training/schema')
    ]);
    const { datasetId, collectionId, dataId } = DeleteTrainingDataBodySchema.parse(body);
    const { teamId } = await this.authDatasetCollection(request, collectionId, ManagePermissionVal);

    await MongoDatasetTraining.deleteOne({
      teamId,
      datasetId,
      _id: dataId
    });

    return DeleteTrainingDataResponseSchema.parse({});
  }

  async getTrainingDataDetail(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { GetTrainingDataDetailBodySchema, GetTrainingDataDetailResponseSchema },
      { ReadPermissionVal },
      { MongoDatasetTraining },
      s3Utils,
      { addMinutes },
      { S3Buckets }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/training/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/s3/utils'),
      dynamicImport<any>('date-fns'),
      serviceVendorImport<any>('common/s3/config/constants')
    ]);
    const { datasetId, collectionId, dataId } = GetTrainingDataDetailBodySchema.parse(body);
    const { teamId } = await this.authDatasetCollection(request, collectionId, ReadPermissionVal);
    const data = await MongoDatasetTraining.findOne({ teamId, datasetId, _id: dataId }).lean();

    if (!data) {
      return GetTrainingDataDetailResponseSchema.parse(null);
    }

    return GetTrainingDataDetailResponseSchema.parse({
      _id: data._id,
      datasetId: data.datasetId,
      mode: data.mode,
      imagePreviewUrl:
        data.imageId && s3Utils.isS3ObjectKey(data.imageId, 'dataset')
          ? s3Utils.jwtSignS3DownloadToken({
              objectKey: data.imageId,
              bucketName: S3Buckets.private,
              expiredTime: addMinutes(new Date(), 30)
            })
          : undefined,
      q: data.q,
      a: data.a
    });
  }

  async getTrainingError(
    request: FastifyRequest,
    body: Record<string, any>,
    query: Record<string, unknown>
  ) {
    const [
      { GetTrainingErrorBodySchema, GetTrainingErrorResponseSchema },
      { ReadPermissionVal },
      { MongoDatasetTraining },
      { readFromSecondary }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/training/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/mongo/utils')
    ]);
    const { collectionId } = GetTrainingErrorBodySchema.parse(body);
    const { offset, pageSize } = await this.parsePaginationRequest(body, query);
    const { collection } = await this.authDatasetCollection(request, collectionId, ReadPermissionVal);
    const match = {
      teamId: collection.teamId,
      datasetId: collection.datasetId,
      collectionId: collection._id,
      errorMsg: { $exists: true }
    };
    const [errorList, total] = await Promise.all([
      MongoDatasetTraining.find(match, undefined, { ...readFromSecondary })
        .skip(offset)
        .limit(pageSize)
        .lean(),
      MongoDatasetTraining.countDocuments(match, { ...readFromSecondary })
    ]);

    return GetTrainingErrorResponseSchema.parse({
      list: errorList,
      total
    });
  }

  async updateTrainingData(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { UpdateTrainingDataBodySchema, UpdateTrainingDataResponseSchema },
      { WritePermissionVal },
      { MongoDatasetTraining },
      { TrainingModeEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/training/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      globalVendorImport<any>('core/dataset/constants')
    ]);
    const { datasetId, collectionId, dataId, q, a, chunkIndex } =
      UpdateTrainingDataBodySchema.parse(body);
    const { teamId } = await this.authDatasetCollection(request, collectionId, WritePermissionVal);

    if (!dataId) {
      await MongoDatasetTraining.updateMany(
        {
          teamId,
          datasetId,
          collectionId,
          errorMsg: { $exists: true, $ne: null }
        },
        {
          $unset: { errorMsg: '' },
          retryCount: 3,
          lockTime: new Date('2000')
        }
      );
      return UpdateTrainingDataResponseSchema.parse({});
    }

    const data = await MongoDatasetTraining.findOne({ teamId, datasetId, _id: dataId });
    if (!data) {
      return Promise.reject('data not found');
    }

    await MongoDatasetTraining.updateOne(
      {
        teamId,
        datasetId,
        _id: dataId
      },
      {
        $unset: { errorMsg: '' },
        retryCount: 3,
        ...(data.imageId && q ? { mode: TrainingModeEnum.chunk } : {}),
        ...(q !== undefined && { q }),
        ...(a !== undefined && { a }),
        ...(chunkIndex !== undefined && { chunkIndex }),
        lockTime: new Date('2000')
      }
    );

    return UpdateTrainingDataResponseSchema.parse({});
  }

  async rebuildEmbedding(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { mongoSessionRun },
      { MongoDataset },
      { MongoDatasetData },
      { MongoDatasetCollection },
      { MongoDatasetTraining },
      { createTrainingUsage },
      { UsageSourceEnum },
      aiModel,
      datasetUtils,
      dataUtils,
      { TrainingModeEnum },
      { OwnerPermissionVal },
      { RebuildEmbeddingBodySchema, RebuildEmbeddingResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('core/dataset/schema'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('support/wallet/usage/controller'),
      globalVendorImport<any>('support/wallet/usage/constants'),
      serviceVendorImport<any>('core/ai/model'),
      serviceVendorImport<any>('core/dataset/utils'),
      serviceVendorImport<any>('core/dataset/data/utils'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('openapi/core/dataset/training/api')
    ]);
    const { datasetId, vectorModel } = RebuildEmbeddingBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      datasetId,
      OwnerPermissionVal
    );

    if (!vectorModel || dataset.vectorModel === vectorModel) {
      return Promise.reject('vectorModel 不合法');
    }

    const [rebuilding, training] = await Promise.all([
      MongoDatasetData.findOne({ teamId, datasetId, rebuilding: true }),
      MongoDatasetTraining.findOne({ teamId, datasetId })
    ]);

    if (rebuilding || training) {
      return Promise.reject('数据集正在训练或者重建中，请稍后再试');
    }

    const { availableVlmModel, supportVlm, supportImageIndex } =
      datasetUtils.getDatasetImageIndexCapability({
        vectorModel,
        vlmModel: dataset.vlmModel
      });
    const { usageId } = await createTrainingUsage({
      teamId,
      tmbId,
      appName: '切换索引模型',
      billSource: UsageSourceEnum.training,
      vectorModel: aiModel.getEmbeddingModel(vectorModel)?.name || vectorModel,
      agentModel: aiModel.getLLMModel(dataset.agentModel)?.name,
      vllmModel: availableVlmModel?.name
    });

    await mongoSessionRun(async (session: any) => {
      await MongoDataset.findByIdAndUpdate(
        datasetId,
        {
          $set: {
            vectorModel,
            ...(!supportImageIndex && { 'chunkSettings.imageIndex': false })
          }
        },
        { session }
      );
      if (!supportImageIndex) {
        await MongoDatasetCollection.updateMany(
          {
            teamId,
            datasetId
          },
          {
            $set: {
              imageIndex: false
            }
          },
          { session }
        );
      }
      await MongoDatasetData.updateMany(
        {
          teamId,
          datasetId
        },
        {
          $set: {
            rebuilding: true
          }
        },
        {
          session
        }
      );
    });

    const max = (globalThis as any).systemEnv?.vectorMaxProcess || 10;
    const queueSlots = new Array(max * 2).fill(0);

    for (let i = 0; i < queueSlots.length; i++) {
      try {
        const hasNext = await mongoSessionRun(async (session: any) => {
          const data = await MongoDatasetData.findOneAndUpdate(
            {
              rebuilding: true,
              teamId,
              datasetId
            },
            {
              $unset: {
                rebuilding: null
              },
              updateTime: new Date()
            },
            {
              session
            }
          ).select({
            _id: 1,
            collectionId: 1,
            imageId: 1,
            q: 1,
            indexes: 1
          });

          if (data) {
            const collection = await MongoDatasetCollection.findById(data.collectionId)
              .select('imageIndex')
              .session(session);
            const hasMarkdownImages =
              !!collection?.imageIndex &&
              dataUtils.uniqueDatasetDataMarkdownImageUrls([data.q]).length > 0;
            const mode = datasetUtils.getDatasetImageTrainingMode({
              supportVlm,
              supportImageIndex,
              imageId: data.imageId,
              hasMarkdownImages
            });

            await MongoDatasetTraining.create(
              [
                {
                  teamId,
                  tmbId,
                  datasetId,
                  collectionId: data.collectionId,
                  billId: usageId,
                  mode,
                  model:
                    (mode === TrainingModeEnum.imageParse || mode === TrainingModeEnum.image) &&
                    supportVlm &&
                    availableVlmModel
                      ? availableVlmModel.model
                      : vectorModel,
                  dataId: data._id,
                  ...(data.imageId && { imageId: data.imageId }),
                  ...(mode === TrainingModeEnum.image && {
                    q: data.q,
                    indexes: data.indexes
                  }),
                  retryCount: 50
                }
              ],
              {
                session,
                ordered: true
              }
            );
          }

          return !!data;
        });

        if (!hasNext) {
          break;
        }
      } catch {}
    }

    return RebuildEmbeddingResponseSchema.parse({});
  }

  async getCollectionDetail(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [
      { GetCollectionDetailQuerySchema, GetCollectionDetailResponseSchema },
      { ReadPermissionVal },
      { getCollectionSourceData },
      { collectionTagsToTagLabel },
      { getVectorCount },
      { MongoDatasetTraining },
      { readFromSecondary },
      { getS3DatasetSource },
      { isS3ObjectKey }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/api'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('core/dataset/collection/utils'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      serviceVendorImport<any>('common/vectorDB/controller'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      serviceVendorImport<any>('common/s3/utils')
    ]);
    const { id } = GetCollectionDetailQuerySchema.parse(query);
    const { collection, permission } = await this.authDatasetCollection(request, id, ReadPermissionVal);
    const fileId = collection?.fileId;

    if (fileId && !isS3ObjectKey(fileId, 'dataset')) {
      return Promise.reject('Invalid dataset file key');
    }

    const [file, indexAmount, errorCount] = await Promise.all([
      fileId ? getS3DatasetSource().getFileMetadata(fileId) : undefined,
      getVectorCount({
        teamId: collection.teamId,
        datasetId: collection.datasetId,
        collectionId: collection._id
      }),
      MongoDatasetTraining.countDocuments(
        {
          teamId: collection.teamId,
          datasetId: collection.datasetId,
          collectionId: id,
          errorMsg: { $exists: true },
          retryCount: { $lte: 0 }
        },
        readFromSecondary
      )
    ]);

    return GetCollectionDetailResponseSchema.parse({
      ...collection,
      indexAmount: indexAmount ?? 0,
      ...getCollectionSourceData(collection),
      tags: await collectionTagsToTagLabel({
        datasetId: collection.datasetId,
        tags: collection.tags
      }),
      permission,
      file,
      errorCount
    });
  }

  async deleteCollection(
    request: Pick<FastifyRequest, 'headers'>,
    query: Record<string, any>,
    body: Record<string, any>
  ) {
    const [
      { DeleteCollectionBodySchema, DeleteCollectionQuerySchema },
      { findCollectionAndChild },
      { delCollection },
      { mongoSessionRun },
      { WritePermissionVal },
      { CommonErrEnum },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/api'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/error/code/common'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const { id } = DeleteCollectionQuerySchema.parse(query);
    const { collectionIds } = DeleteCollectionBodySchema.parse(body);
    const deletedIds = id ? [id] : collectionIds;

    if (!Array.isArray(deletedIds)) {
      return Promise.reject(CommonErrEnum.missingParams);
    }

    const [{ teamId, collection, tmbId }] = await Promise.all(
      deletedIds.map((collectionId: string) =>
        this.authDatasetCollection(request, collectionId, WritePermissionVal)
      )
    );
    const collections = await Promise.all(
      deletedIds.map((collectionId: string) =>
        findCollectionAndChild({
          teamId,
          datasetId: collection.datasetId,
          collectionId,
          fields: '_id teamId type datasetId fileId metadata'
        })
      )
    ).then((result) => {
      const flattened = result.flat();
      return flattened.filter(
        (item: any, index: number, array: any[]) =>
          array.findIndex((target) => target._id.toString() === item._id.toString()) === index
      );
    });

    await mongoSessionRun((session: any) =>
      delCollection({
        collections,
        delImg: true,
        delFile: true,
        session
      })
    );
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.DELETE_COLLECTION,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return {};
  }

  async createCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { CreateCollectionBodySchema, CreateCollectionResponseSchema },
      { WritePermissionVal },
      { createOneCollection },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const parsed = CreateCollectionBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );
    const { _id } = await createOneCollection({
      ...parsed,
      teamId,
      tmbId
    });

    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.CREATE_COLLECTION,
      params: {
        collectionName: parsed.name,
        datasetName: dataset.name,
        datasetType: getI18nDatasetType(dataset.type)
      }
    });

    return CreateCollectionResponseSchema.parse(_id);
  }

  async createCollectionByFileId(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>
  ) {
    const [
      { CreateCollectionByFileIdBodySchema },
      { createCollectionAndInsertData },
      { DatasetCollectionTypeEnum },
      { WritePermissionVal },
      { CommonErrEnum },
      { getS3DatasetSource },
      { isS3ObjectKey },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/error/code/common'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const { fileId, customPdfParse, ...parsed } = CreateCollectionByFileIdBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );

    if (!isS3ObjectKey(fileId, 'dataset')) {
      return Promise.reject('Invalid dataset file key');
    }

    const metadata = await getS3DatasetSource().getFileMetadata(fileId);
    if (!metadata) {
      return Promise.reject(CommonErrEnum.fileNotFound);
    }

    await checkDatasetIndexLimit({
      teamId,
      insertLen: 1
    });

    return createCollectionAndInsertData({
      dataset,
      createCollectionParams: {
        ...parsed,
        teamId,
        tmbId,
        type: DatasetCollectionTypeEnum.file,
        name: metadata.filename,
        fileId,
        customPdfParse
      }
    });
  }

  async createLinkCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { CreateLinkCollectionBodySchema },
      { createCollectionAndInsertData },
      { DatasetCollectionTypeEnum },
      { WritePermissionVal },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const { link, ...parsed } = CreateLinkCollectionBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );

    await checkDatasetIndexLimit({
      teamId,
      insertLen: 1
    });

    return createCollectionAndInsertData({
      dataset,
      createCollectionParams: {
        ...parsed,
        name: link,
        teamId,
        tmbId,
        type: DatasetCollectionTypeEnum.link,
        metadata: {
          relatedImgId: link,
          webPageSelector: parsed?.metadata?.webPageSelector
        },
        rawLink: link
      }
    });
  }

  async createTextCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { CreateTextCollectionBodySchema },
      { createCollectionAndInsertData },
      { DatasetCollectionTypeEnum },
      { WritePermissionVal },
      { getS3DatasetSource },
      { removeS3TTL },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/s3/sources/dataset'),
      serviceVendorImport<any>('common/s3/utils'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const { name, text, ...parsed } = CreateTextCollectionBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );

    await checkDatasetIndexLimit({
      teamId,
      insertLen: 1
    });

    const filename = `${name}.txt`;
    const s3DatasetSource = getS3DatasetSource();
    const key = await s3DatasetSource.upload({
      datasetId: String(dataset._id),
      buffer: Buffer.from(text),
      filename,
      contentType: 'text/plain; charset=UTF-8'
    });
    const result = await createCollectionAndInsertData({
      dataset,
      createCollectionParams: {
        ...parsed,
        teamId,
        tmbId,
        type: DatasetCollectionTypeEnum.file,
        fileId: key,
        name: filename
      }
    });

    await removeS3TTL({ key, bucketName: 'private' });

    return result;
  }

  async createApiCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { CreateApiCollectionBodySchema },
      { WritePermissionVal },
      { getApiDatasetRequest }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/apiDataset')
    ]);
    const { apiFileId, ...parsed } = CreateApiCollectionBodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );
    const fileDetail = await (
      await getApiDatasetRequest(dataset.apiDatasetServer)
    ).getFileDetail({
      apiFileId
    });

    return this.createApiDatasetCollection({
      apiFiles: [fileDetail],
      teamId,
      tmbId,
      dataset,
      ...parsed
    });
  }

  async createApiCollectionV2(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { CreateApiCollectionV2BodySchema },
      { WritePermissionVal },
      { checkDatasetIndexLimit }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/createApi'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/permission/teamLimit')
    ]);
    const parsed = CreateApiCollectionV2BodySchema.parse(body);
    const { teamId, tmbId, dataset } = await this.authDataset(
      request,
      parsed.datasetId,
      WritePermissionVal
    );

    await checkDatasetIndexLimit({
      teamId,
      insertLen: 1
    });

    return this.createApiDatasetCollection({
      ...parsed,
      teamId,
      tmbId,
      dataset
    });
  }

  async createApiDatasetCollection({
    apiFiles,
    customPdfParse,
    teamId,
    tmbId,
    dataset,
    ...body
  }: Record<string, any>) {
    const [
      { createCollectionAndInsertData, createOneCollection },
      { DatasetCollectionTypeEnum },
      { MongoDatasetCollection },
      { getApiDatasetRequest },
      { mongoSessionRun },
      { RootCollectionId }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/collection/controller'),
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      serviceVendorImport<any>('core/dataset/apiDataset'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      globalVendorImport<any>('core/dataset/collection/constants')
    ]);
    const existCollections = await MongoDatasetCollection.find(
      {
        teamId: dataset.teamId,
        datasetId: dataset._id
      },
      'apiFileId'
    ).lean();
    const existApiFileIdSet = new Set(
      existCollections.map((item: any) => item.apiFileId).filter(Boolean)
    );
    const startId =
      dataset.apiDatasetServer?.apiServer?.basePath ||
      dataset.apiDatasetServer?.yuqueServer?.basePath ||
      dataset.apiDatasetServer?.feishuServer?.folderToken ||
      dataset.apiDatasetServer?.dingtalkServer?.rootNodeId;
    const isDirectorySelected = apiFiles.length === 1 && apiFiles[0].id === RootCollectionId;
    const rootDirectoryId = isDirectorySelected ? RootCollectionId : undefined;
    const getFilesRecursively = async (
      files: any[],
      topLevelParentId?: string
    ): Promise<any[]> => {
      const allFiles: any[] = [];

      for (const file of files) {
        const currentTopLevelParentId = (() => {
          if (topLevelParentId) return topLevelParentId;
          if (isDirectorySelected) return rootDirectoryId;
          if (file.hasChild) return file.id;
          return undefined;
        })();
        const fileWithParentId = {
          ...file,
          apiFileParentId: topLevelParentId
        };

        allFiles.push(fileWithParentId);

        if (file.hasChild) {
          const folderFiles = await (
            await getApiDatasetRequest(dataset.apiDatasetServer)
          ).listFiles({ parentId: file.id === RootCollectionId ? startId : file.id });
          const subFiles = await getFilesRecursively(folderFiles, currentTopLevelParentId);
          allFiles.push(...subFiles.filter((item) => item.type === 'file'));
        }
      }

      return allFiles;
    };
    const allFiles = await getFilesRecursively(apiFiles);
    const createFiles = allFiles.filter(
      (item, index, array) =>
        !existApiFileIdSet.has(item.id) && array.findIndex((file) => file.id === item.id) === index
    );

    return mongoSessionRun(async (session: any) => {
      for await (const file of createFiles) {
        if (file.hasChild && file.type === 'folder') {
          await createOneCollection({
            teamId,
            tmbId,
            session,
            name: file.name,
            type: DatasetCollectionTypeEnum.folder,
            datasetId: dataset._id,
            apiFileId: file.id
          });
        }

        if (file.type === 'file') {
          await createCollectionAndInsertData({
            dataset,
            createCollectionParams: {
              ...body,
              teamId,
              tmbId,
              type: DatasetCollectionTypeEnum.apiFile,
              name: file.name,
              apiFileId: file.id,
              apiFileParentId: file.apiFileParentId,
              metadata: {
                relatedImgId: file.id
              },
              customPdfParse
            },
            session
          });
        }
      }
    });
  }

  async reTrainingCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { createCollectionAndInsertData, delCollection },
      { mongoSessionRun },
      { WritePermissionVal },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum },
      { collectionTagsToTagLabel },
      { ReTrainingCollectionBodySchema, ReTrainingCollectionResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/collection/controller'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      globalVendorImport<any>('openapi/core/dataset/collection/createApi')
    ]);
    const { collectionId: inputCollectionId, ...data } =
      ReTrainingCollectionBodySchema.parse(body);
    const { collection, teamId, tmbId } = await this.authDatasetCollection(
      request,
      inputCollectionId,
      WritePermissionVal
    );

    return mongoSessionRun(async (session: any) => {
      await delCollection({
        collections: [collection],
        session,
        delImg: false,
        delFile: false
      });

      const { collectionId } = await createCollectionAndInsertData({
        dataset: collection.dataset,
        createCollectionParams: {
          ...collection,
          ...data,
          parentId: collection.parentId ?? undefined,
          updateTime: new Date(),
          tags: await collectionTagsToTagLabel({
            datasetId: collection.datasetId,
            tags: collection.tags
          })
        }
      });

      void addAuditLog({
        tmbId,
        teamId,
        event: AuditEventEnum.RETRAIN_COLLECTION,
        params: {
          collectionName: collection.name,
          datasetName: collection.dataset?.name || '',
          datasetType: getI18nDatasetType(collection.dataset?.type || '')
        }
      });

      return ReTrainingCollectionResponseSchema.parse({ collectionId });
    });
  }

  /**
   * 迁移旧版 collection/list 接口。该接口仍被部分前端调用，返回 pageNum/pageSize/data/total 结构。
   */
  async listCollections(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const zod = await dynamicImport<any>('zod');
    const z = zod.default ?? zod.z;
    const [
      { DatasetTrainingCollectionName },
      { Types },
      { MongoDatasetCollection },
      { DatasetCollectionTypeEnum },
      { DatasetDataCollectionName },
      { ReadPermissionVal },
      { readFromSecondary },
      { collectionTagsToTagLabel }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/mongo'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('core/dataset/collection/utils')
    ]);
    const {
      pageNum,
      pageSize,
      datasetId,
      parentId,
      searchText,
      selectFolder,
      filterTags,
      simple
    } = z
      .object({
        pageNum: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(10),
        datasetId: z.string(),
        parentId: z.string().nullable().optional().default(null),
        searchText: z.string().optional().default(''),
        selectFolder: z.boolean().optional().default(false),
        filterTags: z.array(z.string()).optional().default([]),
        simple: z.boolean().optional().default(false)
      })
      .parse(body);
    const regexText = searchText ? await this.replaceRegChars(searchText) : '';
    const { teamId, permission } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const match = {
      teamId: new Types.ObjectId(teamId),
      datasetId: new Types.ObjectId(datasetId),
      ...(selectFolder ? { type: DatasetCollectionTypeEnum.folder } : {}),
      ...(regexText
        ? {
            name: new RegExp(regexText, 'i')
          }
        : {
            parentId: parentId ? new Types.ObjectId(parentId) : null
          }),
      ...(filterTags.length ? { tags: { $in: filterTags } } : {})
    };
    const selectField = {
      _id: 1,
      parentId: 1,
      tmbId: 1,
      name: 1,
      type: 1,
      forbid: 1,
      createTime: 1,
      updateTime: 1,
      trainingType: 1,
      fileId: 1,
      rawLink: 1,
      tags: 1,
      externalFileId: 1
    };

    if (simple) {
      const collections = await MongoDatasetCollection.find(match, undefined, {
        ...readFromSecondary
      })
        .select(selectField)
        .sort({ updateTime: -1 })
        .lean();

      return {
        pageNum,
        pageSize,
        data: await Promise.all(
          collections.map(async (item: any) => ({
            ...item,
            tags: await collectionTagsToTagLabel({
              datasetId,
              tags: item.tags
            }),
            dataAmount: 0,
            trainingAmount: 0,
            permission
          }))
        ),
        total: await MongoDatasetCollection.countDocuments(match)
      };
    }

    const [collections, total] = await Promise.all([
      MongoDatasetCollection.aggregate([
        { $match: match },
        { $sort: { updateTime: -1 } },
        { $skip: (pageNum - 1) * pageSize },
        { $limit: pageSize },
        {
          $lookup: {
            from: DatasetTrainingCollectionName,
            let: { id: '$_id', team_id: match.teamId, dataset_id: match.datasetId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$teamId', '$$team_id'] }, { $eq: ['$collectionId', '$$id'] }]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'trainingCount'
          }
        },
        {
          $lookup: {
            from: DatasetDataCollectionName,
            let: { id: '$_id', team_id: match.teamId, dataset_id: match.datasetId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$teamId', '$$team_id'] },
                      { $eq: ['$datasetId', '$$dataset_id'] },
                      { $eq: ['$collectionId', '$$id'] }
                    ]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'dataCount'
          }
        },
        {
          $project: {
            ...selectField,
            dataAmount: {
              $ifNull: [{ $arrayElemAt: ['$dataCount.count', 0] }, 0]
            },
            trainingAmount: {
              $ifNull: [{ $arrayElemAt: ['$trainingCount.count', 0] }, 0]
            }
          }
        }
      ]),
      MongoDatasetCollection.countDocuments(match, { ...readFromSecondary })
    ]);
    const data = await Promise.all(
      collections.map(async (item: any) => ({
        ...item,
        tags: await collectionTagsToTagLabel({
          datasetId,
          tags: item.tags
        }),
        permission
      }))
    );

    return {
      pageNum,
      pageSize,
      data,
      total
    };
  }

  async listCollectionsV2(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { Types },
      { MongoDatasetCollection },
      { DatasetCollectionTypeEnum },
      { ReadPermissionVal },
      { readFromSecondary },
      { collectionTagsToTagLabel },
      { MongoDatasetData },
      { MongoDatasetTraining },
      { ListCollectionV2BodySchema, ListCollectionV2ResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('common/mongo'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('common/mongo/utils'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/training/schema'),
      globalVendorImport<any>('openapi/core/dataset/collection/api')
    ]);
    const {
      datasetId,
      parentId,
      searchText: rawSearchText,
      selectFolder,
      filterTags,
      simple,
      pageSize: rawPageSize,
      offset: rawOffset,
      pageNum: rawPageNum
    } = ListCollectionV2BodySchema.parse(body);
    const pageSize = Math.min(Number(rawPageSize ?? 10), 100);
    const offset =
      rawOffset !== undefined ? Number(rawOffset) : (Number(rawPageNum ?? 1) - 1) * pageSize;
    const searchText = rawSearchText?.replace(/'/g, '');
    const { teamId, permission } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const match = {
      teamId: new Types.ObjectId(teamId),
      datasetId: new Types.ObjectId(datasetId),
      ...(selectFolder ? { type: DatasetCollectionTypeEnum.folder } : {}),
      ...(searchText
        ? {
            name: new RegExp(`${await this.replaceRegChars(searchText)}`, 'i')
          }
        : {
            parentId: parentId ? new Types.ObjectId(parentId) : null
          }),
      ...(filterTags.length ? { tags: { $in: filterTags } } : {})
    };
    const selectField = {
      _id: 1,
      parentId: 1,
      tmbId: 1,
      name: 1,
      type: 1,
      forbid: 1,
      createTime: 1,
      updateTime: 1,
      trainingType: 1,
      fileId: 1,
      rawLink: 1,
      tags: 1,
      externalFileId: 1
    };

    if (simple) {
      const collections = await MongoDatasetCollection.find(match, undefined, {
        ...readFromSecondary
      })
        .select(selectField)
        .sort({ updateTime: -1 })
        .skip(offset)
        .limit(pageSize)
        .lean();

      return ListCollectionV2ResponseSchema.parse({
        list: await Promise.all(
          collections.map(async (item: any) => ({
            ...item,
            tags: await collectionTagsToTagLabel({
              datasetId,
              tags: item.tags
            }),
            dataAmount: 0,
            trainingAmount: 0,
            hasError: false,
            permission
          }))
        ),
        total: await MongoDatasetCollection.countDocuments(match)
      });
    }

    const [collections, total] = await Promise.all([
      MongoDatasetCollection.find(match, undefined, { ...readFromSecondary })
        .select(selectField)
        .sort({ updateTime: -1 })
        .skip(offset)
        .limit(pageSize)
        .lean(),
      MongoDatasetCollection.countDocuments(match, { ...readFromSecondary })
    ]);
    const collectionIds = collections.map((item: any) => new Types.ObjectId(item._id));
    const [trainingAmount, dataAmount] = await Promise.all([
      MongoDatasetTraining.aggregate(
        [
          {
            $match: {
              teamId: new Types.ObjectId(teamId),
              datasetId: new Types.ObjectId(datasetId),
              collectionId: { $in: collectionIds }
            }
          },
          {
            $group: {
              _id: '$collectionId',
              count: { $sum: 1 },
              hasError: { $max: { $cond: [{ $ifNull: ['$errorMsg', false] }, true, false] } }
            }
          }
        ],
        { ...readFromSecondary }
      ),
      MongoDatasetData.aggregate(
        [
          {
            $match: {
              teamId: new Types.ObjectId(teamId),
              datasetId: new Types.ObjectId(datasetId),
              collectionId: { $in: collectionIds }
            }
          },
          {
            $group: {
              _id: '$collectionId',
              count: { $sum: 1 }
            }
          }
        ],
        { ...readFromSecondary }
      )
    ]);
    const list = await Promise.all(
      collections.map(async (item: any) => ({
        ...item,
        tags: await collectionTagsToTagLabel({
          datasetId,
          tags: item.tags
        }),
        trainingAmount:
          trainingAmount.find((amount: any) => String(amount._id) === String(item._id))?.count || 0,
        dataAmount: dataAmount.find((amount: any) => String(amount._id) === String(item._id))?.count || 0,
        hasError: trainingAmount.find((amount: any) => String(amount._id) === String(item._id))
          ?.hasError,
        permission
      }))
    );

    return ListCollectionV2ResponseSchema.parse({ list, total });
  }

  async getCollectionPaths(request: Pick<FastifyRequest, 'headers'>, query: Record<string, any>) {
    const [{ GetCollectionPathsQuerySchema, GetCollectionPathsResponseSchema }, { ReadPermissionVal }] =
      await Promise.all([
        globalVendorImport<any>('openapi/core/dataset/collection/api'),
        globalVendorImport<any>('support/permission/constant')
      ]);
    const { sourceId } = GetCollectionPathsQuerySchema.parse(query);

    if (!sourceId) {
      return [];
    }

    await this.authDatasetCollection(request, sourceId, ReadPermissionVal, false);

    return GetCollectionPathsResponseSchema.parse(
      await this.getDatasetCollectionPaths({ parentId: sourceId })
    );
  }

  async getDatasetCollectionPaths({ parentId = '' }: { parentId?: string }) {
    const find = async (currentParentId?: string): Promise<Array<Record<string, unknown>>> => {
      if (!currentParentId) {
        return [];
      }

      const { MongoDatasetCollection } = await serviceVendorImport<any>('core/dataset/collection/schema');
      const parent = await MongoDatasetCollection.findOne(
        { _id: currentParentId },
        'name parentId'
      );

      if (!parent) return [];

      const paths = await find(parent.parentId ?? undefined);
      paths.push({ parentId: currentParentId, parentName: parent.name });

      return paths;
    };

    return find(parentId);
  }

  async getCollectionTrainingDetail(
    request: Pick<FastifyRequest, 'headers'>,
    query: Record<string, any>
  ) {
    const [
      { MongoDatasetTraining },
      { DatasetCollectionDataProcessModeEnum, TrainingModeEnum },
      { ReadPermissionVal },
      { MongoDatasetData },
      { Types },
      { GetCollectionTrainingDetailQuerySchema, GetCollectionTrainingDetailResponseSchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/training/schema'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('common/mongo'),
      globalVendorImport<any>('openapi/core/dataset/collection/api')
    ]);
    const { collectionId } = GetCollectionTrainingDetailQuerySchema.parse(query);
    const { collection } = await this.authDatasetCollection(request, collectionId, ReadPermissionVal);
    const match = {
      teamId: new Types.ObjectId(collection.teamId),
      datasetId: new Types.ObjectId(collection.datasetId),
      collectionId: new Types.ObjectId(collection._id)
    };
    const minId = (
      await MongoDatasetTraining.findOne(match, { sort: { _id: 1 }, select: '_id' }).lean()
    )?._id;
    const [queuedCountData, trainingCountData, errorCountData, trainedCount] = await Promise.all([
      minId
        ? MongoDatasetTraining.aggregate([
            {
              $match: {
                _id: { $lt: new Types.ObjectId(minId) },
                retryCount: { $gt: 0 },
                lockTime: { $lt: new Date('2050/1/1') }
              }
            },
            {
              $group: {
                _id: '$mode',
                count: { $sum: 1 }
              }
            }
          ])
        : Promise.resolve([]),
      MongoDatasetTraining.aggregate([
        {
          $match: {
            ...match,
            retryCount: { $gt: 0 },
            lockTime: { $lt: new Date('2050/1/1') }
          }
        },
        {
          $group: {
            _id: '$mode',
            count: { $sum: 1 }
          }
        }
      ]),
      MongoDatasetTraining.aggregate([
        {
          $match: {
            ...match,
            errorMsg: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$mode',
            count: { $sum: 1 }
          }
        }
      ]),
      MongoDatasetData.countDocuments(match)
    ]);
    const defaultCounts = Object.fromEntries(
      Object.values(TrainingModeEnum).map((mode) => [mode, 0])
    );
    const toCounts = (items: Array<{ _id: string; count: number }>) =>
      items.reduce<Record<string, number>>(
        (acc, item) => {
          acc[item._id] = item.count;
          return acc;
        },
        { ...defaultCounts }
      );

    return GetCollectionTrainingDetailResponseSchema.parse({
      trainingType: collection.trainingType ?? DatasetCollectionDataProcessModeEnum.chunk,
      advancedTraining: {
        customPdfParse: !!collection.customPdfParse,
        imageIndex: !!collection.imageIndex,
        autoIndexes: !!collection.autoIndexes
      },
      queuedCounts: toCounts(queuedCountData),
      trainingCounts: toCounts(trainingCountData),
      errorCounts: toCounts(errorCountData),
      trainedCount
    });
  }

  async scrollCollections(
    request: Pick<FastifyRequest, 'headers'>,
    body: Record<string, any>,
    query: Record<string, unknown>
  ) {
    const [
      { DatasetTrainingCollectionName },
      { Types },
      { DatasetDataCollectionName },
      { MongoDatasetCollection },
      { DatasetCollectionTypeEnum },
      { ReadPermissionVal },
      { ScrollCollectionsBodySchema }
    ] = await Promise.all([
      serviceVendorImport<any>('core/dataset/training/schema'),
      serviceVendorImport<any>('common/mongo'),
      serviceVendorImport<any>('core/dataset/data/schema'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      globalVendorImport<any>('core/dataset/constants'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('openapi/core/dataset/collection/api')
    ]);
    const { datasetId, parentId, searchText, selectFolder, filterTags, simple } =
      ScrollCollectionsBodySchema.parse(body);
    const { offset, pageSize: rawPageSize } = await this.parsePaginationRequest(body, query);
    const regexText = searchText ? await this.replaceRegChars(searchText) : '';
    const pageSize = Math.min(rawPageSize, 30);
    const { teamId, permission } = await this.authDataset(request, datasetId, ReadPermissionVal);
    const match = {
      teamId: new Types.ObjectId(teamId),
      datasetId: new Types.ObjectId(datasetId),
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      ...(selectFolder ? { type: DatasetCollectionTypeEnum.folder } : {}),
      ...(regexText
        ? {
            name: { $regex: regexText, $options: 'i' }
          }
        : {}),
      ...(filterTags.length ? { tags: { $all: filterTags } } : {})
    };
    const selectField = {
      _id: 1,
      parentId: 1,
      tmbId: 1,
      name: 1,
      type: 1,
      forbid: 1,
      createTime: 1,
      updateTime: 1,
      trainingType: 1,
      fileId: 1,
      rawLink: 1,
      tags: 1
    };

    if (simple) {
      const collections = await MongoDatasetCollection.find(match)
        .select(selectField)
        .sort({ updateTime: -1 })
        .skip(offset)
        .limit(pageSize)
        .lean();

      return {
        list: collections.map((item: any) => ({
          ...item,
          dataAmount: 0,
          trainingAmount: 0,
          indexAmount: 0,
          permission
        })),
        total: await MongoDatasetCollection.countDocuments(match)
      };
    }

    const [collections, total] = await Promise.all([
      MongoDatasetCollection.aggregate([
        { $match: match },
        { $sort: { updateTime: -1 } },
        { $skip: offset },
        { $limit: pageSize },
        {
          $lookup: {
            from: DatasetTrainingCollectionName,
            let: { id: '$_id', team_id: match.teamId, dataset_id: match.datasetId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$teamId', '$$team_id'] }, { $eq: ['$collectionId', '$$id'] }]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'trainingCount'
          }
        },
        {
          $lookup: {
            from: DatasetDataCollectionName,
            let: { id: '$_id', team_id: match.teamId, dataset_id: match.datasetId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$teamId', '$$team_id'] },
                      { $eq: ['$datasetId', '$$dataset_id'] },
                      { $eq: ['$collectionId', '$$id'] }
                    ]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'dataCount'
          }
        },
        {
          $project: {
            ...selectField,
            dataAmount: {
              $ifNull: [{ $arrayElemAt: ['$dataCount.count', 0] }, 0]
            },
            trainingAmount: {
              $ifNull: [{ $arrayElemAt: ['$trainingCount.count', 0] }, 0]
            }
          }
        }
      ]),
      MongoDatasetCollection.countDocuments(match)
    ]);

    return {
      list: collections.map((item: any) => ({
        ...item,
        permission
      })),
      total
    };
  }

  async syncCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { SyncCollectionBodySchema, SyncCollectionResponseSchema },
      { WritePermissionVal },
      { syncCollection }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/api'),
      globalVendorImport<any>('support/permission/constant'),
      serviceVendorImport<any>('core/dataset/collection/utils')
    ]);
    const { collectionId } = SyncCollectionBodySchema.parse(body);
    const { collection } = await this.authDatasetCollection(request, collectionId, WritePermissionVal);

    return SyncCollectionResponseSchema.parse(await syncCollection(collection));
  }

  async updateCollection(request: Pick<FastifyRequest, 'headers'>, body: Record<string, any>) {
    const [
      { UpdateDatasetCollectionBodySchema },
      { MongoDatasetCollection },
      collectionUtils,
      { WritePermissionVal },
      { CommonErrEnum },
      { DatasetCollectionTypeEnum },
      { mongoSessionRun },
      { addAuditLog, getI18nDatasetType },
      { AuditEventEnum }
    ] = await Promise.all([
      globalVendorImport<any>('openapi/core/dataset/collection/api'),
      serviceVendorImport<any>('core/dataset/collection/schema'),
      serviceVendorImport<any>('core/dataset/collection/utils'),
      globalVendorImport<any>('support/permission/constant'),
      globalVendorImport<any>('common/error/code/common'),
      globalVendorImport<any>('core/dataset/constants'),
      serviceVendorImport<any>('common/mongo/sessionRun'),
      serviceVendorImport<any>('support/user/audit/util'),
      globalVendorImport<any>('support/user/audit/constants')
    ]);
    const {
      datasetId,
      externalFileId,
      id: parsedCollectionId,
      parentId,
      name,
      tags,
      forbid,
      createTime
    } = UpdateDatasetCollectionBodySchema.parse(body);
    let id = parsedCollectionId;

    if (datasetId && externalFileId) {
      const { WritePermissionVal } = await this.getPermissionConstants();
      await this.authDataset(request, datasetId, WritePermissionVal);

      const collection = await MongoDatasetCollection.findOne({ datasetId, externalFileId }, '_id');
      if (!collection) {
        return Promise.reject(CommonErrEnum.fileNotFound);
      }
      id = collection._id;
    }

    if (!id) {
      return Promise.reject(CommonErrEnum.missingParams);
    }

    const { collection, teamId, tmbId } = await this.authDatasetCollection(
      request,
      id,
      WritePermissionVal
    );

    await mongoSessionRun(async (session: any) => {
      const collectionTags = await collectionUtils.createOrGetCollectionTags({
        tags,
        teamId,
        datasetId: collection.datasetId,
        session
      });

      await MongoDatasetCollection.updateOne(
        { _id: id },
        {
          $set: {
            ...(parentId !== undefined && { parentId: parentId || null }),
            ...(name && { name, updateTime: collectionUtils.getCollectionUpdateTime({ name }) }),
            ...(collectionTags !== undefined && { tags: collectionTags }),
            ...(forbid !== undefined && { forbid }),
            ...(createTime !== undefined && { createTime })
          }
        },
        { session }
      );

      if (collection.type === DatasetCollectionTypeEnum.folder && forbid !== undefined) {
        const find = async (collectionParentId: string): Promise<string[]> => {
          const children = await MongoDatasetCollection.find(
            {
              teamId: collection.teamId,
              datasetId: collection.datasetId,
              parentId: collectionParentId
            },
            '_id',
            { session }
          );
          const idList = children.map((item: any) => String(item._id));
          const childrenIds = (await Promise.all(idList.map(find))).flat();

          return [...idList, ...childrenIds];
        };
        const allChildrenIdList = await find(collection._id);

        await MongoDatasetCollection.updateMany(
          { _id: { $in: allChildrenIdList } },
          { $set: { forbid } },
          { session }
        );
      }
    });
    void addAuditLog({
      tmbId,
      teamId,
      event: AuditEventEnum.UPDATE_COLLECTION,
      params: {
        collectionName: collection.name,
        datasetName: collection.dataset?.name || '',
        datasetType: getI18nDatasetType(collection.dataset?.type || '')
      }
    });

    return {};
  }
}
