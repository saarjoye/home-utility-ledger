# Home Utility Ledger

家庭水、电、燃账单采集与统计后台。

当前版本重点：
- 后台登录与 Session 鉴权
- 后台页面配置水、电、燃账号
- 水务与燃气真实采集器
- 国网浙江浏览器会话采集器
- 直接使用 GHCR 镜像部署

## 部署方式

默认部署文件是仓库根目录的 `docker-compose.yml`，它直接拉取镜像，不要求你在服务器本地构建：

```yaml
image: ghcr.io/saarjoye/home-utility-ledger:main
```

启动：

```bash
docker compose up -d
```

如果你要在本地自己构建镜像，使用：

```bash
docker compose -f docker-compose.build.yml up -d --build
```

## 访问地址

- 前台：`http://localhost:3000/`
- 后台：`http://localhost:3000/admin`
- 登录页：`http://localhost:3000/login`
- 健康检查：`http://localhost:3000/api/health`

## 持久化目录

容器内数据库默认路径：

```text
/app/data/app.db
```

当前 `docker-compose.yml` 已按你的服务器目录配置为：

```yaml
/home/docker/home-utility-ledger/data:/app/data
```

## 账号配置原则

水、电、燃的采集账号凭据不再通过环境变量配置。

请在后台页面中配置：
- 账号名
- 服务商
- 登录方式
- 账户号
- `cookieHeader`
- `sessionToken`
- `storageJson`
- `orgId`
- 其他服务商特定字段

这些内容会加密存入数据库。

## 系统级环境变量

这些变量仍然保留，用于系统运行而不是用户账号配置：

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | 后台管理员账号 |
| `ADMIN_PASSWORD` | `change-me-admin` | 后台管理员密码 |
| `SESSION_SECRET` | `change-me-session-secret` | Session 签名密钥 |
| `SESSION_TTL_HOURS` | `168` | 登录态有效时长，单位小时 |
| `COOKIE_SECURE` | `false` | 反代为 HTTPS 时建议改为 `true` |
| `ACCOUNT_CREDENTIALS_SECRET` | `change-me-account-credentials-secret` | 账号凭据加密密钥 |
| `AUTO_COLLECT_ENABLED` | `true` | 是否启用自动采集调度 |
| `COLLECTOR_TICK_MS` | `60000` | 调度轮询间隔 |
| `PLAYWRIGHT_HEADLESS` | `true` | Playwright 是否无头运行 |
| `PLAYWRIGHT_BROWSERS_PATH` | `/ms-playwright` | 容器内共享浏览器路径 |

## Docker 与 Playwright

国网浙江采集器依赖 Playwright 浏览器运行时。

这个浏览器不是要求你装在宿主机上，而是已经在镜像构建阶段装进容器：

- `Dockerfile` 会执行 `npx playwright install --with-deps chromium`
- 浏览器安装在共享路径 `/ms-playwright`
- 运行时即使容器降权到 `node` 用户，也能继续访问该浏览器

这意味着：
- 宿主机不需要安装 Playwright
- 服务器只需要能运行 Docker
- 真正的浏览器依赖随镜像一起发布

## 当前采集能力

### 杭水网上营业厅

支持后台配置：
- `sessionToken`
- `cookieHeader`
- `meterNumber`

### 杭州天然气服务号

支持后台配置：
- `cookieHeader`
- `address`
- `orgId`

### 网上国网（浙江）

支持两类方式：
- 会话导入：`cookieHeader + storageJson`
- 账号密码登录：后台配置登录页 URL 和选择器

优先推荐会话导入方式。

## 运行时权限

镜像启动时会自动：
- 确保 `/app/data` 存在
- 修正 `/app/data` 归属
- 再切换到 `node` 用户运行应用

通常不需要你手工：
- `chmod 777`
- 在 compose 里写 `user: "0:0"`

## 发布镜像

仓库包含 GitHub Actions：

- `.github/workflows/docker-publish.yml`

推送到 `main` 后可自动发布到：

- `ghcr.io/saarjoye/home-utility-ledger:main`
- `ghcr.io/saarjoye/home-utility-ledger:latest`

如果 GHCR 首次发布后仍是私有包，需要到 GitHub Packages 页面把它改成 `Public`。

## 项目结构

- `src/server.mjs`：HTTP 服务、登录鉴权、静态路由
- `src/db.mjs`：SQLite、迁移、Session、账号凭据加密
- `src/job-runner.mjs`：自动采集调度与连接测试
- `src/connectors/`：水、电、燃采集器
- `public/login.*`：登录页
- `public/admin.*`：后台页
- `docker-compose.yml`：直接拉 GHCR 镜像部署
- `docker-compose.build.yml`：本地构建部署
- `docker-entrypoint.sh`：启动时修正数据目录权限

## 已知边界

- 当前仍是单管理员模型，不支持多用户和 RBAC
- 前台 `/dashboard` 仍属于 MVP
- 国网若不用会话导入，则仍需后台配置登录选择器
