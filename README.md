# 6MM Knowledge

从 workflow-zjt 提取的独立知识库 HTTP 服务。原项目保持不变；仅注册知识库和其依赖的签名文件传输接口，不注册聊天、工作流或账号登录接口。原版共享 vendor 基础设施保留在 vendor/，提取来源和哈希见 upstream/manifest.json。

## 测试部署与验收

- 部署目录示例：`/path/to/6mm-knowledge`；具体地址和目录在本地部署配置中维护，不提交到公开仓库。
- API 示例：`http://HOST:18086`；文档：`http://HOST:18086/docs`。默认绑定 `127.0.0.1`，局域网部署需自行配置绑定地址。
- 容器：`6mm-knowledge-test`；单卷数据：服务器部署目录下的 `data/`。
- API Key：`data/config/service-identity.json` 的 `apiKey`；模型配置：`data/config/models.json`。不要公开这两个文件。
- 当前只配置了聊天模型，没有 Embedding/VLM/Rerank。缺少 Embedding 时创建知识库及向量搜索显式拒绝，不能将基础服务健康理解为完整业务可用。
- 已验证服务器健康检查、鉴权列表、60 路径匿名拒绝、跨团队拒绝、签名文件上传下载、原生 PDF、图片型 PDF OCR、聊天模型 API 连通，以及容器重启后的基础恢复。
- 外部数据源仅通过模拟服务测试；真实向量入库、搜索命中、图片理解和外部账号接入尚未验收。不是“所有业务 API 验收通过”。

HTTP 测试入口不提供传输加密。正式部署应经 HTTPS 反向代理并限制网络访问。

## 单容器

```bash
docker compose build
docker compose up -d
docker compose ps
```

首次启动自动生成独立数据库凭据与服务身份。所有业务数据和配置都在 `data/`。MongoDB 副本集、PostgreSQL/pgvector、Redis、MinIO、训练消费者和 API 都在同一容器内；数据库端口不发布。默认只监听宿主机回环地址，不应直接开放公网。

模型通过 `data/config/models.json` 配置，格式参考 `config/models.example.json`。文件含密钥，必须为 0600；不要提交 Git、不要放入镜像。修改后重启容器。模型推理不在容器中运行。

Compose 将 Go 程序并发限制为 4、OCR OpenMP 线程限制为 2，进程/线程总上限为 512。仅设置 CPU 配额不能保证依赖不按宿主机核数创建线程；高核数服务器应同时观察 `docker stats` 的 PIDS，避免 Node 创建线程失败。

## HTTP

- `GET /health/live`：进程存活。
- `GET /health/ready`：数据库、存储和训练消费者心跳就绪；返回模型能力是否已配置。
- `/api/core/dataset/*`：60 条原知识库路径，见 `upstream/routes.json`。
- `/api/system/file/*`、`/api/common/file/read/*`：沿用原版签名上传下载。
- `GET /api/knowledge/capabilities`：接入能力状态。
- `GET /api/knowledge/openapi.json`：接口描述。
- `/docs`：Swagger UI。

知识库请求使用 `Authorization: Bearer <服务 API Key>`，密钥位于 `data/config/service-identity.json` 的 `apiKey`，不会打印到日志。身份仍受团队、成员和知识库权限检查。不是系统 root，也不会从原系统导入登录会话。

## 外部数据源与解析

保留原项目的飞书、钉钉、语雀和自定义 API 数据源适配器及请求字段。用户暂未提供这些平台账号，不能把模拟测试称为真实账号验收。

PDF 原生解析、Office/Markdown/HTML 等解析来自上游。容器默认附带 Poppler + Tesseract 本地 OCR，通过仅回环监听的内部服务接入原版增强 PDF 协议，限单文件 20MB、30 页、单并发。它不是商业版 AI 排版恢复或复杂表格识别的等价替代。

也可使用原版 customPdfParse 外部服务、Textin 或 Doc2X，配置位于 `data/config/runtime.json` 的 `systemEnv.customPdfParse`。切换提供商时删除默认本地 url 字段。

DeepRAG、商业版 AI 段落增强等需要另行授权的 Pro 服务不包含在这个开源提取包内，不绕过授权。已加入图片任务消费者，但图片描述仍需配置视觉模型；没有视觉模型不宣称已验证图片检索。

## 验证

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

路由分发测试使用模拟持久化，不能证明真实入库或检索成功。真实验收必须另行验证训练完成、搜索命中、更新、删除、重启恢复和外部账号接入。

## 离线部署与备份

服务器无法访问镜像仓库时，可导入本地构建的 amd64 镜像，再启动已有镜像：

```bash
docker load -i 6mm-knowledge-linux-amd64-v2.tar.gz
docker compose up -d --no-build
docker compose exec knowledge node scripts/smoke.mjs
docker compose exec knowledge node scripts/check-storage.mjs
```

`check-storage.mjs` 会创建短期测试对象并验证签名上传、下载与无效签名拒绝，不代表知识库训练成功。离线包如果携带模型配置，应按密钥文件管理，部署目录使用 0700，模型配置使用 0600。

单容器内包含多个数据库，不能直接复制运行中的数据目录充当一致性备份。测试环境可停机备份整个数据卷，备份包含密钥，应保存在受限目录：

```bash
docker compose stop
tar -czf knowledge-data-backup.tar.gz data
chmod 600 knowledge-data-backup.tar.gz
docker compose start
```

恢复时先停止容器，保留原数据目录，将备份恢复到空目录并挂载为 `./data`，使用相同版本镜像启动后重新执行健康检查与冒烟测试。不要覆盖运行中数据库。

## 许可

上游代码遵守根目录 `LICENSE`（FastGPT Open Source License，包含附加条款），不得移除上游版权说明。MinIO 的 AGPL 许可和固定版本对应源码随镜像保留在 `/opt/licenses/minio`；MongoDB 许可位于 `/opt/licenses/mongodb`。本包不改变各依赖原有许可。
