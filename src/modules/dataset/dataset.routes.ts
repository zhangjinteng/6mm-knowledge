import type { FastifyPluginAsync, FastifySchema, HTTPMethods } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';

import { DatasetController } from '@/modules/dataset/dataset.controller.js';
import { datasetRouteDefinitions } from '@/modules/dataset/dataset.route-map.js';
import { DatasetNextSuccessResponseSchema } from '@/modules/dataset/dataset.schema.js';

const datasetMethods: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * dataset 导出类接口路径。
 *
 * 这些接口返回文件流，不能在 Swagger 中声明统一 JSON 响应，也不能在 Controller 中包装为
 * `{ code, statusText, message, data }`，否则前端下载行为会与原版不一致。
 */
const datasetDownloadPaths = new Set(['/collection/export', '/exportAll']);

type DatasetRouteResponseKind = 'json' | 'file';

/** 单个 dataset 接口在 Swagger 中展示的中文说明。 */
type DatasetRouteSwaggerDoc = {
  summary: string;
  description: string;
  responseKind?: DatasetRouteResponseKind;
};

/**
 * dataset 接口 Swagger 中文说明表。
 *
 * key 必须与 `datasetRouteDefinitions` 中的 `path` 完全一致。下方启动时校验会保证：
 * 只要路由表新增接口，就必须在这里补齐中文 summary 和 description。
 */
const datasetRouteSwaggerDocs: Record<string, DatasetRouteSwaggerDoc> = {
  '/apiDataset/getCatalog': {
    summary: '获取 API 知识库目录',
    description:
      '查询 API 类型知识库的目录结构，用于外部数据源同步、选择目录和构建 API 集合时展示可用路径。',
    responseKind: 'json'
  },
  '/apiDataset/getPathNames': {
    summary: '获取 API 知识库路径名称',
    description:
      '根据 API 知识库目录路径查询对应的名称链路，用于前端把目录 ID 或路径还原成可读的层级名称。',
    responseKind: 'json'
  },
  '/apiDataset/list': {
    summary: '获取 API 知识库集合列表',
    description:
      '分页查询 API 知识库下的集合数据，支持前端在 API 数据源管理页浏览、筛选和选择集合。',
    responseKind: 'json'
  },
  '/apiDataset/listExistId': {
    summary: '获取已存在的 API 集合 ID',
    description:
      '按传入的 API 数据标识检查知识库中已经存在的集合 ID，避免重复导入或重复创建 API 集合。',
    responseKind: 'json'
  },
  '/collection/create': {
    summary: '创建知识库集合',
    description:
      '在指定知识库中创建集合，并按原版规则初始化集合元数据、训练任务和权限校验结果。',
    responseKind: 'json'
  },
  '/collection/create/apiCollection': {
    summary: '创建 API 知识库集合',
    description:
      '把外部 API 数据源中的内容创建为知识库集合，适用于旧版 API 集合同步入口。',
    responseKind: 'json'
  },
  '/collection/create/apiCollectionV2': {
    summary: '创建 API 知识库集合 V2',
    description:
      '按新版 API 数据源协议创建知识库集合，支持目录、路径和增量同步等新版字段。',
    responseKind: 'json'
  },
  '/collection/create/backup': {
    summary: '从备份创建集合',
    description:
      '根据备份数据恢复或创建知识库集合，用于迁移、导入和备份恢复场景。',
    responseKind: 'json'
  },
  '/collection/create/fileId': {
    summary: '通过文件 ID 创建集合',
    description:
      '使用已经上传到文件存储的文件 ID 创建知识库集合，并触发后续解析与训练流程。',
    responseKind: 'json'
  },
  '/collection/create/images': {
    summary: '通过图片创建集合',
    description:
      '上传或引用图片内容创建知识库集合，按图片解析结果生成集合和训练数据。',
    responseKind: 'json'
  },
  '/collection/create/link': {
    summary: '通过网页链接创建集合',
    description:
      '根据网页链接抓取内容并创建知识库集合，适用于从网页资料导入知识库。',
    responseKind: 'json'
  },
  '/collection/create/localFile': {
    summary: '通过本地文件创建集合',
    description:
      '接收本地上传的文件内容并创建知识库集合，支持 multipart、二进制和文本类请求体。',
    responseKind: 'json'
  },
  '/collection/create/reTrainingCollection': {
    summary: '重新训练集合',
    description:
      '基于已有集合重新生成训练任务，用于数据解析参数变化或训练失败后的重建。',
    responseKind: 'json'
  },
  '/collection/create/template': {
    summary: '通过模板创建集合',
    description:
      '按模板内容创建知识库集合，适用于结构化模板数据导入和示例集合初始化。',
    responseKind: 'json'
  },
  '/collection/create/text': {
    summary: '通过纯文本创建集合',
    description:
      '根据前端提交的文本内容创建知识库集合，并按原版分块、索引和训练规则处理。',
    responseKind: 'json'
  },
  '/collection/delete': {
    summary: '删除知识库集合',
    description:
      '删除指定知识库集合及其相关训练数据、索引和文件引用，执行前会校验知识库写权限。',
    responseKind: 'json'
  },
  '/collection/detail': {
    summary: '获取集合详情',
    description:
      '查询单个知识库集合的基础信息、训练状态和展示字段，用于集合详情页或编辑页。',
    responseKind: 'json'
  },
  '/collection/export': {
    summary: '导出知识库集合',
    description:
      '导出指定集合的数据内容并直接返回文件下载响应。该接口不会使用统一 JSON 包装结构。',
    responseKind: 'file'
  },
  '/collection/list': {
    summary: '获取集合列表',
    description:
      '按知识库、父级目录、搜索条件和分页参数查询集合列表，返回前端管理页所需的集合数据。',
    responseKind: 'json'
  },
  '/collection/listV2': {
    summary: '获取集合列表 V2',
    description:
      '按新版列表协议查询知识库集合，支持更完整的筛选、分页和前端展示字段。',
    responseKind: 'json'
  },
  '/collection/paths': {
    summary: '获取集合路径',
    description:
      '查询集合所在的目录链路和路径名称，用于面包屑、移动集合和目录定位。',
    responseKind: 'json'
  },
  '/collection/read': {
    summary: '读取集合内容',
    description:
      '读取集合的文本、分块或解析结果，用于集合内容预览和编辑前的数据回显。',
    responseKind: 'json'
  },
  '/collection/scrollList': {
    summary: '滚动分页获取集合列表',
    description:
      '使用游标或滚动分页方式查询集合列表，适用于大知识库下的连续加载场景。',
    responseKind: 'json'
  },
  '/collection/sync': {
    summary: '同步知识库集合',
    description:
      '触发指定集合与外部数据源或原始文件的同步，保持集合内容和索引数据一致。',
    responseKind: 'json'
  },
  '/collection/trainingDetail': {
    summary: '获取集合训练详情',
    description:
      '查询集合关联训练任务的状态、错误信息和进度，用于训练详情页展示。',
    responseKind: 'json'
  },
  '/collection/update': {
    summary: '更新知识库集合',
    description:
      '更新集合名称、元数据、分块配置或目录位置等信息，并保持权限与原版接口一致。',
    responseKind: 'json'
  },
  '/create': {
    summary: '创建知识库',
    description:
      '创建新的知识库或知识库目录，初始化团队空间、权限、默认配置和索引相关信息。',
    responseKind: 'json'
  },
  '/createWithFiles': {
    summary: '通过文件创建知识库',
    description:
      '创建知识库并批量导入文件，适用于首次创建知识库时直接上传资料的场景。',
    responseKind: 'json'
  },
  '/data/delete': {
    summary: '删除知识库数据',
    description:
      '删除指定知识库数据分块及其向量索引，执行前会校验集合或知识库写权限。',
    responseKind: 'json'
  },
  '/data/detail': {
    summary: '获取知识库数据详情',
    description:
      '查询单条知识库数据分块的内容、索引、来源和元信息，用于数据详情或编辑弹窗。',
    responseKind: 'json'
  },
  '/data/getQuoteData': {
    summary: '获取引用数据',
    description:
      '根据聊天引用或数据标识查询对应的知识库数据内容，用于展示引用来源和命中片段。',
    responseKind: 'json'
  },
  '/data/index/create': {
    summary: '创建数据索引',
    description:
      '为指定知识库数据分块创建向量或全文索引，保证后续检索可以命中该数据。',
    responseKind: 'json'
  },
  '/data/index/delete': {
    summary: '删除数据索引',
    description:
      '删除指定知识库数据分块的索引记录，通常用于手动调整索引或清理异常索引。',
    responseKind: 'json'
  },
  '/data/index/update': {
    summary: '更新数据索引',
    description:
      '更新指定知识库数据分块的索引内容或索引元信息，并同步到向量检索系统。',
    responseKind: 'json'
  },
  '/data/insertData': {
    summary: '插入知识库数据',
    description:
      '向指定集合中插入文本数据分块，并按原版规则创建训练任务或索引记录。',
    responseKind: 'json'
  },
  '/data/insertImages': {
    summary: '插入图片数据',
    description:
      '向知识库集合中插入图片解析数据，并保存图片关联信息和可检索内容。',
    responseKind: 'json'
  },
  '/data/list': {
    summary: '获取知识库数据列表',
    description:
      '分页查询集合内的数据分块列表，支持按搜索、状态和集合条件筛选。',
    responseKind: 'json'
  },
  '/data/pushData': {
    summary: '推送知识库数据',
    description:
      '接收外部系统推送的数据并写入知识库，适用于 API 数据源或自动化同步入口。',
    responseKind: 'json'
  },
  '/data/update': {
    summary: '更新知识库数据',
    description:
      '更新单条知识库数据分块内容、索引或元信息，并按需要重建检索索引。',
    responseKind: 'json'
  },
  '/data/v2/list': {
    summary: '获取知识库数据列表 V2',
    description:
      '按新版列表协议分页查询知识库数据，返回更完整的数据状态、索引和展示字段。',
    responseKind: 'json'
  },
  '/delete': {
    summary: '删除知识库',
    description:
      '删除指定知识库及其集合、数据、索引和相关资源，执行前会校验团队空间写权限。',
    responseKind: 'json'
  },
  '/detail': {
    summary: '获取知识库详情',
    description:
      '查询知识库基础信息、配置、权限和统计字段，用于知识库详情页或编辑页。',
    responseKind: 'json'
  },
  '/exportAll': {
    summary: '导出整个知识库',
    description:
      '导出指定知识库下的全部集合和数据，并直接返回文件下载响应。该接口不会使用统一 JSON 包装结构。',
    responseKind: 'file'
  },
  '/file/getPreviewChunks': {
    summary: '获取文件预览分块',
    description:
      '读取已上传文件的预览分块内容，用于导入前确认解析结果或展示文件切分预览。',
    responseKind: 'json'
  },
  '/file/getSearchTestImagePreviewUrls': {
    summary: '获取搜索测试图片预览地址',
    description:
      '为搜索测试结果中的图片生成预览地址，方便前端展示图片命中内容。',
    responseKind: 'json'
  },
  '/file/presignDatasetFilePostUrl': {
    summary: '生成知识库文件上传地址',
    description:
      '生成知识库文件上传所需的预签名地址和表单信息，供前端直传到对象存储。',
    responseKind: 'json'
  },
  '/file/presignSearchTestImage': {
    summary: '生成搜索测试图片上传地址',
    description:
      '为知识库搜索测试中的图片输入生成预签名上传地址，用于以图搜图或图片检索测试。',
    responseKind: 'json'
  },
  '/folder/create': {
    summary: '创建知识库文件夹',
    description:
      '在知识库空间中创建文件夹节点，用于组织知识库和集合的层级结构。',
    responseKind: 'json'
  },
  '/getPermission': {
    summary: '获取知识库权限',
    description:
      '查询当前用户对指定知识库的读写、管理和继承权限，用于前端控制可见操作。',
    responseKind: 'json'
  },
  '/list': {
    summary: '获取知识库列表',
    description:
      '查询当前团队空间下可访问的知识库和文件夹列表，支持前端知识库首页展示。',
    responseKind: 'json'
  },
  '/paths': {
    summary: '获取知识库路径',
    description:
      '查询知识库或文件夹的父级路径信息，用于面包屑、移动和目录定位。',
    responseKind: 'json'
  },
  '/resumeInheritPermission': {
    summary: '恢复继承权限',
    description:
      '恢复指定知识库或目录的权限继承关系，使其重新继承父级权限配置。',
    responseKind: 'json'
  },
  '/searchTest': {
    summary: '执行知识库搜索测试',
    description:
      '按输入的问题、检索参数和知识库配置执行搜索测试，返回召回结果、引用数据和调试信息。该接口带有独立限流配置。',
    responseKind: 'json'
  },
  '/training/deleteTrainingData': {
    summary: '删除训练数据',
    description:
      '删除指定训练数据及其关联索引，适用于清理失败任务或手动移除训练样本。',
    responseKind: 'json'
  },
  '/training/getDatasetTrainingQueue': {
    summary: '获取知识库训练队列',
    description:
      '查询知识库训练任务队列和当前训练状态，用于展示训练进度、排队情况和任务数量。',
    responseKind: 'json'
  },
  '/training/getTrainingDataDetail': {
    summary: '获取训练数据详情',
    description:
      '查询单条训练数据的原文、分块、错误信息和索引状态，用于训练数据详情页。',
    responseKind: 'json'
  },
  '/training/getTrainingError': {
    summary: '获取训练错误信息',
    description:
      '查询指定知识库或集合的训练错误列表，帮助定位解析、索引或向量化失败原因。',
    responseKind: 'json'
  },
  '/training/rebuildEmbedding': {
    summary: '重建训练向量',
    description:
      '重新为指定训练数据或集合生成向量索引，用于模型配置变更或索引异常后的修复。',
    responseKind: 'json'
  },
  '/training/updateTrainingData': {
    summary: '更新训练数据',
    description:
      '更新训练数据内容、索引字段或训练状态，并按需要触发重新索引。',
    responseKind: 'json'
  },
  '/update': {
    summary: '更新知识库',
    description:
      '更新知识库名称、介绍、头像、权限配置或检索参数等基础信息。',
    responseKind: 'json'
  }
};

for (const item of datasetRouteDefinitions) {
  if (!datasetRouteSwaggerDocs[item.path]) {
    throw new Error(`缺少 dataset Swagger 中文说明: ${item.path}`);
  }
}

/**
 * 生成 dataset 接口的 Swagger Schema。
 *
 * 普通接口统一声明原版 NextJS 包装响应；文件下载接口只写 summary/description，
 * 避免 OpenAPI 把下载响应错误描述成 JSON。
 */
function buildDatasetRouteSchema(path: string, schema: FastifySchema = {}): FastifySchema {
  const doc = datasetRouteSwaggerDocs[path];
  const response =
    doc.responseKind === 'file'
      ? schema.response
      : {
          200: DatasetNextSuccessResponseSchema,
          ...(schema.response ?? {})
        };

  return {
    ...schema,
    summary: doc.summary,
    description: doc.description,
    tags: schema.tags ?? ['dataset'],
    ...(response ? { response } : {})
  };
}

/** 注册 dataset 模块全部原版接口，并为每个接口挂载中文 Swagger 文档。 */
const datasetRoutes: FastifyPluginAsync = async (app) => {
  const controller = new DatasetController();
  const route = app.withTypeProvider<ZodTypeProvider>();

  // dataset 文件导入接口会接收 multipart、二进制和纯文本内容，这里统一保留原始 Buffer 供 Service 复刻原版解析逻辑。
  app.addContentTypeParser(
    ['multipart/form-data', 'application/octet-stream', 'text/csv', 'text/plain'],
    {
      parseAs: 'buffer'
    },
    (_request, body, done) => {
      done(null, body);
    }
  );

  for (const item of datasetRouteDefinitions) {
    route.route({
      method: datasetMethods,
      url: item.path,
      config:
        item.path === '/searchTest'
          ? {
              rateLimit: {
                max: 15,
                timeWindow: 1000
              }
            }
          : undefined,
      schema: buildDatasetRouteSchema(item.path, datasetDownloadPaths.has(item.path) ? {} : undefined),
      handler: controller.handleNativeDatasetRoute.bind(controller)
    });
  }
};

export default datasetRoutes;
