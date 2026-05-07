# Water and Utility Docker Deployment

这个项目目前按 **Docker 优先部署** 方式整理，目标是你不需要在宿主机额外安装 `Node.js`、`npm` 或数据库。

当前容器假设已经和代码实现对齐：

- Runtime: `node:24-alpine`
- App entry: `src/server.mjs`
- Database: SQLite，默认文件 `data/app.db`
- Exposed port: `3000`
- Health endpoint: `/api/health`

## 最推荐用法

直接启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

停止：

```bash
docker compose down
```

启动后默认访问：

```text
http://localhost:3000
http://localhost:3000/admin
http://localhost:3000/api/health
```

## 持久化说明

`docker-compose.yml` 已经配置了命名卷：

- `utility_data:/app/data`

这意味着：

- 容器删除后，SQLite 数据仍然保留
- 重新 `docker compose up` 不会丢失已有账单和配置数据

如果你要彻底清空数据：

```bash
docker compose down -v
```

## 可选环境变量

默认情况下，不提供 `.env` 也能启动，因为 `docker-compose.yml` 已经带了默认值。

如果你要自定义，可以复制：

```bash
cp .env.example .env
```

支持变量如下：

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | 运行模式 |
| `HOST` | `0.0.0.0` | 容器监听地址 |
| `PORT` | `3000` | 容器服务端口 |
| `APP_ENTRY` | `src/server.mjs` | 启动入口 |
| `DB_PATH` | `data/app.db` | SQLite 文件路径 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 单独使用 Docker 命令

如果你不用 Compose，也可以：

构建镜像：

```bash
docker build -t water-mvp .
```

启动容器：

```bash
docker run -d \
  --name water-mvp \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e APP_ENTRY=src/server.mjs \
  -e DB_PATH=data/app.db \
  -v water_mvp_data:/app/data \
  water-mvp
```

## 当前 Docker 交付内容

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `.dockerignore`

## 当前已处理的容器化细节

- 启动入口已对齐到 `src/server.mjs`
- 不依赖宿主机安装 Node
- 默认不强依赖 `.env`
- 已加 SQLite 数据持久化卷
- 已加容器健康检查
- 已加 `.dockerignore`，避免把调研临时文件打进镜像

## 已知边界

- 当前本机环境没有安装 `Docker`，所以这轮只能完成 Docker 文件和部署路径校准，**没有在本机执行实际构建或容器启动验证**
- 如果你后续把项目入口改掉，只需要同步修改：
  - `.env.example`
  - `Dockerfile`
  - `docker-compose.yml`
