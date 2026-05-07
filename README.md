# Home Utility Ledger

å®¶åº­çµãæ°´ãçè´¦åééä¸ç»è®¡åå°ç Docker å MVPã

å½åä»åºå·²ç»åå«ï¼

- Web ç®¡çåç»å½
- Session é´æ
- åè Lucky Bridge é£æ ¼çåå° UI
- GitHub Actions èªå¨æå»ºå¹¶åå¸ GHCR éå
- å¯ç´æ¥å¨æå¡å¨æ Portainer ä¸­ä½¿ç¨ç `image:` é¨ç½²ç `docker-compose.yml`

## ç´æ¥é¨ç½²

ä¸»é¨ç½²æä»¶å°±æ¯ä»åºæ ¹ç®å½ç `docker-compose.yml`ï¼å®ä¸ä¼å¨æå¡å¨æå»ºï¼èæ¯ç´æ¥æåéåï¼

```yaml
image: ghcr.io/saarjoye/home-utility-ledger:main
```

å¯å¨å½ä»¤ï¼

```bash
docker compose up -d
```

å¦ææ¯ Portainerï¼ç´æ¥ä½¿ç¨ä»åºéç `docker-compose.yml` å³å¯ï¼ä¸åéè¦æ¬å° `Dockerfile` æå»ºã

## è®¿é®å°å

- åå°ï¼`http://localhost:3000/`
- åå°ï¼`http://localhost:3000/admin`
- ç»å½é¡µï¼`http://localhost:3000/login`
- å¥åº·æ£æ¥ï¼`http://localhost:3000/api/health`

## æä¹åç®å½

å½åé¨ç½²æä»¶å·²ç»æä½ çæå¡å¨ç®å½åºå®ä¸ºï¼

```yaml
/home/docker/home-utility-ledger/data:/app/data
```

å®¹å¨å SQLite è·¯å¾ï¼

```text
/app/data/app.db
```

## æè½½æéè¯´æ

éåç°å¨ä¼å¨å®¹å¨å¯å¨æ¶èªå¨æ£æ¥å¹¶ä¿®æ­£ `/app/data` çæéï¼

- å¥å£èæ¬ä¼åç¡®ä¿ `/app/data` å­å¨
- å¦æå®¹å¨ä»¥ root å¯å¨ï¼ä¼èªå¨æ `/app/data` å½å±ä¿®æ­£ä¸º `node`
- ä¿®æ­£å®æåï¼åéæä¸º `node` ç¨æ·è¿è¡åºç¨

è¿æå³çæ­£å¸¸æåµä¸ä¸åéè¦ä½ æå¨ï¼

- `chmod 777 /home/docker/home-utility-ledger/data`
- æå¨ compose éé¢å¤å `user: "0:0"`

å¦æå®¿ä¸»æºæ¬èº«åäºæ´ä¸¥æ ¼ç ACL æ SELinux éå¶ï¼æéè¦é¢å¤å¤çå®¿ä¸»æºæéç­ç¥ã

## ç»å½éç½®

è¯·è³å°ä¿®æ¹è¿äºç¯å¢åéï¼

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | åå°ç®¡çåè´¦å· |
| `ADMIN_PASSWORD` | `change-me-admin` | åå°ç®¡çåå¯ç  |
| `SESSION_SECRET` | `change-me-session-secret` | Session ç­¾åå¯é¥ |
| `SESSION_TTL_HOURS` | `168` | ç»å½ææææ¶é¿ï¼åä½å°æ¶ |
| `COOKIE_SECURE` | `false` | å¦æåé¢æ HTTPS åä»£ï¼å»ºè®®æ¹ä¸º `true` |

å®æ´ç¤ºä¾è§ `.env.example`ã

## éååå¸

ä»åºå·²æ·»å  GitHub Actions å·¥ä½æµï¼

- `.github/workflows/docker-publish.yml`

è§¦åæ¡ä»¶ï¼

- push å° `main`
- æå¨ `workflow_dispatch`

åå¸ç®æ ï¼

- `ghcr.io/saarjoye/home-utility-ledger:main`
- `ghcr.io/saarjoye/home-utility-ledger:latest`
- `ghcr.io/saarjoye/home-utility-ledger:sha-...`

## GHCR å¯è§æ§è¯´æ

GitHub Container Registry å¨é¦æ¬¡åå¸åï¼éååæå¯è½ä»ç¶æ¯ç§æçã

å¦ææå¡å¨æåéåæ¶æ¥æééè¯¯ï¼éè¦å° GitHub åé¡µé¢æåæ¹æ `Public`ã

åå¥å£éå¸¸æ¯ï¼

```text
https://github.com/saarjoye?tab=packages
```

## æ¬å°æå»ºç

å¦æåç»­ä½ è¿æ³å¨æ¬å°æå¨æå»ºä»åºï¼ä¹ä¿çäºä¸ä»½åç¬æä»¶ï¼

- `docker-compose.build.yml`

å®ä½¿ç¨ï¼

```yaml
build:
  context: .
  dockerfile: Dockerfile
```

## å½åç»å½å®ç°

- ç»å½é¡µï¼`/login`
- ç»å½æ¥å£ï¼`POST /api/auth/login`
- ç»åºæ¥å£ï¼`POST /api/auth/logout`
- å½åç¨æ·æ¥å£ï¼`GET /api/auth/me`
- åä¿æ¤é¡µé¢ï¼`/admin`
- åä¿æ¤æ¥å£ï¼`/api/admin/*`

ææ¯æ¹æ¡ï¼

- åç®¡çåè´¦å·ï¼æ¥èªç¯å¢åé
- SQLite æä¹å Session
- `HttpOnly` Cookie
- æªç»å½è®¿é®åå°æ¶èªå¨éå®åå° `/login`

## é¡¹ç®ç»æ

- `src/server.mjs`ï¼HTTP æå¡ãç»å½é´æãéæè·¯ç±
- `src/db.mjs`ï¼SQLite æ°æ®ãè¿ç§»ãSession å­å¨ãåå°æè¦
- `public/login.html`ï¼ç»å½é¡µ
- `public/login.js`ï¼ç»å½é»è¾
- `public/admin.html`ï¼åå°é¡µ
- `public/admin.css`ï¼åå°ä¸ç»å½æ ·å¼
- `public/admin.js`ï¼åå°äº¤äº
- `docker-compose.yml`ï¼ç´æ¥æ GHCR éåçé¨ç½²ç
- `docker-compose.build.yml`ï¼æ¬å°æå»ºç
- `docker-entrypoint.sh`ï¼å¯å¨æ¶ä¿®å¤ `/app/data` æéå¹¶éæè¿è¡

## å·²ç¥è¾¹ç

- å½åæ¯åç®¡çåç»å½ï¼ä¸æ¯æå¤ç¨æ·å RBAC
- åå° `/dashboard` ä»æ¯ MVP ç¶æ
- ç´æ¥é¨ç½²ä¾èµ GHCR éåå·²æååå¸ï¼ä¸åå¯è§æ§ä¸º `Public`
