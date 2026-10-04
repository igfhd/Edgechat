# EdgeChat Docker 部署指南

项目中提供了两套不同的 Docker 部署方案：

1. **方案 A：EdgeChat 聊天室本地开发/测试容器**（根目录配置，端口 `8788`）—— 在本地容器中模拟 Cloudflare Workers/D1 环境运行 EdgeChat 聊天室。
2. **方案 B：EdgeChat Web Deployer 网页部署平台**（`deploy/` 目录配置，端口 `8000`）—— 部署在 VPS 上的独立 Web 工具服务，供团队或用户通过浏览器图形化一键部署 EdgeChat 到 Cloudflare。

---

# 方案 A：EdgeChat 聊天室本地开发/测试容器

## 🚀 一键启动（推荐）

```bash
EDGECHAT_ADMIN_PASSWORD='请替换为强密码' ./docker-start.sh
```

这个脚本会自动：
- ✅ 构建并启动 Docker 容器
- ✅ 初始化数据库表
- ✅ 使用与 GitHub Actions 相同的 PBKDF2 规则创建管理员账户
- ✅ 显示访问信息

## 📱 访问应用

启动后访问：**http://localhost:8788**

## 🔐 管理员账户

- **用户名**：读取 `EDGECHAT_ADMIN_USERNAME`，未设置时使用 `admin`
- **密码**：必须通过 `EDGECHAT_ADMIN_PASSWORD` 显式传入
- **显示名称**：读取 `EDGECHAT_ADMIN_DISPLAY_NAME`，未设置时使用 `Administrator`

脚本不会把密码写入仓库或固定在启动文件中。重复运行会复用已有管理员，不会覆盖现有密码。

## 🛠️ 手动部署

### 1. 启动容器

```bash
docker compose up -d --build
```

### 2. 初始化数据库

```bash
docker compose exec edgechat wrangler d1 execute cfchat-db --local --file=./worker/schema.sql
```

`cfchat-db` is the retained legacy D1 database name. Keep using it unless you are doing a planned data migration.

### 3. 创建管理员账户

```bash
docker compose exec \
  -e EDGECHAT_ADMIN_USERNAME=admin \
  -e EDGECHAT_ADMIN_PASSWORD='请替换为强密码' \
  -e EDGECHAT_ADMIN_DISPLAY_NAME=Administrator \
  edgechat node .github/scripts/generate-admin-bootstrap-sql.mjs
docker compose exec edgechat wrangler d1 execute cfchat-db --local --file=.tmp/edgechat-admin-upsert.sql
```

## 📊 常用命令

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 完全清理（包括数据）
docker compose down -v
```

## 🔧 故障排查

### 问题：显示"服务器开小差了"

**原因**：数据库未初始化

**解决**：运行 `./docker-start.sh` 或手动执行步骤 2 和 3

### 问题：端口被占用

**解决**：修改 `docker-compose.yml` 中的端口映射

```yaml
ports:
  - "8788:8787"  # 改为其他端口，如 "9000:8787"
```

### 问题：容器一直重启

**解决**：查看日志找出原因

```bash
docker compose logs --tail=50
```

## 🌐 生产部署

Docker 仅用于本地开发和测试。

生产环境请部署到 Cloudflare Workers：

```bash
# 配置 wrangler.toml
# 然后部署
npm run deploy
```

## 📝 注意事项

- 本地开发使用 SQLite（D1 本地模式）
- 数据存储在 `.wrangler/state/` 目录
- 停止容器不会丢失数据
- 使用 `docker compose down -v` 会清除所有数据
 
 ---
 
 # 方案 B：EdgeChat Web Deployer 网页部署服务（VPS 部署）
 
 Web Deployer 是一个基于 FastAPI + Vue/HTML 的自动化部署平台。部署在 VPS 上并绑定域名后，可以公开分享给他人，用户只需在网页填写 Cloudflare API Token 和基础配置，即可一键将 EdgeChat 部署到其 Cloudflare 账号。
 
## 🚀 启动 Web Deployer 服务

### 方式 1：Docker 容器运行（推荐在 VPS 生产环境使用）

Web Deployer 的 Docker 配置位于 `deploy/` 目录下：

**进入 deploy 目录启动（推荐）**：
```bash
cd deploy
docker compose up -d --build
```

**或在项目根目录下指定配置文件启动**：
```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

服务默认会在 VPS 本地监听 `127.0.0.1:8000` 端口。

> 💡 **端口冲突处理**：如果 VPS 上已有其他应用（如 checkin-web-deployer）占用了 8000 端口，可修改 `deploy/docker-compose.yml` 中的端口映射（例如 `"127.0.0.1:8001:8000"`），再执行 `docker compose up -d`。

---

### 方式 2：直接脚本运行（免 Docker / 适用于本地或开发机）

项目提供了开箱即用的自动化启动脚本 `server/run.sh`，首次运行会自动创建 Python 虚拟环境（`.venv`）、自动安装 `fastapi/uvicorn` 依赖并按需构建前端产物：

```bash
bash server/run.sh
```

启动后在浏览器打开：**http://localhost:8000**
 
 ## 🌐 配置 Nginx 反向代理与域名访问
 
 部署到 VPS 公开分享时，**必须配置 Nginx 反向代理并强制启用 HTTPS (SSL)**，以保证用户填写的 Cloudflare API Token 在传输链路中的安全性。
 
 参考配置（详见 [deploy/nginx.conf.example](deploy/nginx.conf.example)）：
 
 ```nginx
 server {
     listen 80;
     server_name deploy.yourdomain.com;
     return 301 https://\$host\$request_uri;
 }
 
 server {
     listen 443 ssl http2;
     server_name deploy.yourdomain.com;
 
     ssl_certificate     /etc/letsencrypt/live/deploy.yourdomain.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/deploy.yourdomain.com/privkey.pem;
     ssl_protocols       TLSv1.2 TLSv1.3;
     ssl_ciphers         HIGH:!aNULL:!MD5;
 
     # 关键配置：SSE 实时部署日志必须关闭代理缓冲
     location /api/jobs/ {
         proxy_pass http://127.0.0.1:8000;
         proxy_http_version 1.1;
         proxy_set_header Connection '';
         proxy_set_header Host \$host;
         proxy_set_header X-Real-IP \$remote_addr;
         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto \$scheme;
         
         proxy_buffering off;
         proxy_cache off;
         proxy_read_timeout 600s;
     }
 
     location / {
         proxy_pass http://127.0.0.1:8000;
         proxy_http_version 1.1;
         proxy_set_header Host \$host;
         proxy_set_header X-Real-IP \$remote_addr;
         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto \$scheme;
         proxy_read_timeout 300s;
     }
 }
 ```
 
 ## ⚙️ Web Deployer 环境变量说明
 
 在 `deploy/docker-compose.yml` 中可调整以下环境变量：
 
 | 环境变量 | 默认值 | 说明 |
 |---|---|---|
 | `PORT` | `8000` | 服务监听端口 |
 | `EDGECHAT_CONCURRENCY` | `2` | 最大同时并发构建任务数（防止小型 VPS 内存溢出） |
 | `EDGECHAT_JOB_TTL` | `86400` | 任务保留时长（秒，默认 24 小时后自动物理销毁所有临时构建文件与日志） |
 | `EDGECHAT_DATA_DIR` | `/app/server/data` | 任务 SQLite 数据库持久化目录 |
 | `EDGECHAT_JOBS_DIR` | `/tmp/edgechat_deploy_jobs` | 部署临时工作区目录 |
 
## 🔒 安全与隐私保护

1. **全链路加密传输**：请务必配置 HTTPS，避免 API Token 明文在公网传输。
2. **敏感信息自动脱敏**：后端控制台输出和日志中会自动对 API Token、管理密码、Calls Secret 等凭据进行掩码处理。
3. **数据物理销毁**：任务页面提供「立即物理销毁」按钮；即使不手动销毁，后台也会在 24 小时 TTL 到期后彻底清理沙盒文件与记录。

## 🔑 Cloudflare API Token 权限要求

在 Web Deployer 或 CLI 脚本中使用的 Cloudflare API Token，推荐包含以下 **账户级 (Account)** 权限：

| 权限类别 (Category) | 权限名称 (Permission) | 访问级别 (Access) | 作用说明 |
|---|---|---|---|
| **账户 (Account)** | **Cloudflare Workers** | `编辑 (Edit)` | 发布 Worker 脚本与 Durable Objects |
| **账户 (Account)** | **D1** | `编辑 (Edit)` | 自动创建与迁移 D1 数据库 |
| **账户 (Account)** | **Workers KV 存储** | `编辑 (Edit)` | 自动创建与绑定会话 KV 空间 |
| **账户 (Account)** | **Workers R2 存储** | `编辑 (Edit)` | 自动创建与绑定文件存储桶（若选用 R2） |
| **账户 (Account)** | **Calls** | `编辑 (Edit)` | **自动创建并开通 WebRTC 音视频通话 SFU 应用** |
