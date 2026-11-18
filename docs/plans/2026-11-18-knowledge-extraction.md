# Knowledge Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提取独立知识库服务，打包单容器并在指定测试服务器真实验证。

**Architecture:** 复用上游知识库和权限实现，通过可重复提取脚本生成独立依赖快照。新增独立启动、任务恢复与部署生命周期，不修改源项目。

**Tech Stack:** Node.js、Fastify、MongoDB replica set、PostgreSQL/pgvector、Redis、S3、Docker。

---

- [x] Task 1: 确认范围、源代码入口、服务器资源和验收边界。
- [x] Task 2: scripts/extract-upstream.mjs 提取路由及运行时依赖；生成哈希清单并保留 LICENSE。
  - 测试: tests/extraction.test.mjs 校验 60 路径无遗漏、源文件哈希、无 env/生产数据。
- [ ] Task 3: src 启动器与独立身份初始化已实现；跨团队与完整 CRUD 验收尚未完成。
  - 测试: 无凭据拒绝、跨团队拒绝、合法身份 CRUD。
- [ ] Task 4: 提取 parse/QA/vector 消费者并增加心跳、重启扫描和关闭处理。
  - 测试: 待处理任务启动恢复、失败记录、入库后搜索命中。
- [ ] Task 5: 单容器 Docker 及单卷持久化、数据库内网监听、备份与健康检查。
  - 测试: build、启动、重启保持数据、任一关键进程故障不报就绪。
- [ ] Task 6: 逐 HTTP 路径成功用例；外部源使用模拟测试并标明真实接入未验收。
- [x] Task 7: 通过 1Panel 部署到指定测试服务器的 18086 端口；隔离数据，完成基础 HTTP、鉴权、存储与解析实测。完整业务验收仍属于 Task 4/6，未完成。

## 已验证

- 本地 pnpm test：10 项通过（60 路径分发、CSV、身份比较、签名上传原始字节和外部数据源模拟测试等），不等同于 60 项真实业务成功。
- Linux amd64 单容器构建成功；全新独立数据目录完成数据库初始化，主要进程 RUNNING，健康检查 healthy。
- HTTP 真实冒烟：存活、依赖与消费者就绪、匿名拒绝、鉴权知识库列表、根路径；缺 Embedding 显式返回 503。
- 原生 PDF 与真正图片型 PDF，经上游解析入口 + 本地 OCR 提取出测试文本。
- 已有 DeepSeek 模型最小请求实测 HTTP 200。
- 单容器重启后健康检查与核心 HTTP 冒烟再次通过；真实 S3 签名文本上传、下载字节一致性通过。
- 真实独立跨团队夹具返回 unAuthDataset 拒绝（上游业务错误仍使用 HTTP 500）；60 条路径均拒绝匿名请求。没有宣称完整 CRUD 验收。
- 停止本地 OCR 后 readiness 返回 503，恢复 OCR 后再次检查就绪。
- 仍缺真实 Embedding/Rerank/VLM 配置，以及飞书/钉钉/语雀账号。未宣称真实向量入库、检索或外部账号验收成功。
- 测试服务器直连 Docker Hub 超时，已通过本地构建、离线导入并启动独立容器，未修改既有服务。
- 服务器重建前暴露出 56 核宿主机下 256 PID 上限不足；已持久设置 GOMAXPROCS=4、OMP_THREAD_LIMIT=2、pids_limit=512。
- 服务器真实验证通过：健康与核心 HTTP 冒烟、60 条路径匿名拒绝、跨团队夹具拒绝、S3 签名上传下载、原生 PDF 与图片型 PDF OCR、DeepSeek HTTP 200、重启恢复；局域网 Swagger 已可访问。

每完成一步更新状态，失败保留原因，不把未完成步骤提前标为完成。
