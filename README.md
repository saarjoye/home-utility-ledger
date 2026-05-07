# Home Utility Ledger

å®¶åº­çµãæ°´ãçè´¦åééä¸ç»è®¡åå°ç Docker å MVPã

å½åä»åºå·²ç»è¡¥ä¸æå°å¯ç¨ç Web ç»å½é­ç¯ï¼å¹¶æåå° UI è°æ´ä¸ºæ¥è¿ä½ åèé¡¹ç® `MPæä»¶-lucky&wafè­¦åéç¥/new` çæ·±è²æ§å¶å°é£æ ¼ã

## è¿è¡æ¹å¼

ç´æ¥å¯å¨ï¼

```bash
docker compose up -d --build
```

æ¥çç¶æï¼

```bash
docker compose ps
docker compose logs -f app
```

åæ­¢ï¼

```bash
docker compose down
```

## è®¿é®å°å

- åå°ï¼`http://localhost:3000/`
- åå°ï¼`http://localhost:3000/admin`
- ç»å½é¡µï¼`http://localhost:3000/login`
- å¥åº·æ£æ¥ï¼`http://localhost:3000/api/health`

## ç»å½éç½®

è¯·è³å°ä¿®æ¹ä»¥ä¸ç¯å¢åéï¼ä¸è¦ç´æ¥ä½¿ç¨é»è®¤å¼ï¼

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | åå°ç®¡çåè´¦å· |
| `ADMIN_PASSWORD` | `change-me-admin` | åå°ç®¡çåå¯ç  |
| `SESSION_SECRET` | `change-me-session-secret` | Session ç­¾åå¯é¥ |
| `SESSION_TTL_HOURS` | `168` | ç»å½ææææ¶é¿ï¼åä½å°æ¶ |
| `COOKIE_SECURE` | `false` | çäº§ç¯å¢èµ° HTTPS æ¶å»ºè®®æ¹ä¸º `true` |

å®æ´ç¤ºä¾è§ `.env.example`ã

## æ°æ®æä¹å

å½å `docker-compose.yml` é»è®¤ä½¿ç¨å½åå·ï¼

- `utility_data:/app/data`

å®¹å¨å SQLite æ°æ®åºé»è®¤è·¯å¾ï¼

- `/app/data/app.db`

å¦æä½ è¦æ¹ä¸ºå®¿ä¸»æºç®å½æè½½ï¼å¯ä»¥æå·æ¹æç±»ä¼¼ï¼

```yaml
volumes:
  - /home/docker/home-utility-ledger/data:/app/data
```

## å½åç»å½å®ç°

- ç»å½å¥å£ï¼`/login`
- ç»å½æ¥å£ï¼`POST /api/auth/login`
- ç»åºæ¥å£ï¼`POST /api/auth/logout`
- å½åç»å½æï¼`GET /api/auth/me`
- åä¿æ¤é¡µé¢ï¼`/admin`
- åä¿æ¤æ¥å£ï¼`/api/admin/*`

ææ¯æ¹æ¡ï¼

- åç®¡çåè´¦å·ï¼æ¥èªç¯å¢åé
- æå¡ç«¯ Session Cookie
- Cookie ä¸º `HttpOnly`
- Session è®°å½ä¿å­å¨ SQLite ç `sessions` è¡¨ä¸­

## é¡¹ç®ç»æ

- `src/server.mjs`ï¼HTTP æå¡ãç»å½é´æãéæèµæºè·¯ç±
- `src/db.mjs`ï¼SQLite æ°æ®ãè¿ç§»ãåå°æè¦æ¥è¯¢
- `public/login.html`ï¼ç»å½é¡µ
- `public/admin.html`ï¼åå°ç®¡çé¡µ
- `public/admin.css`ï¼åå°ä¸ç»å½é¡µæ ·å¼
- `public/admin.js`ï¼åå°äº¤äº
- `public/login.js`ï¼ç»å½é¡µäº¤äº

## å·²ç¥è¾¹ç

- å½ååªå®ç°äºåç®¡çåç»å½ï¼ä¸æ¯æå¤ç¨æ·åè§è²æé
- åå° `/dashboard` ç¸å³æ§é¡µé¢ä»æ¯ MVP å½¢æï¼å½åéç¹æ¯åå°ç»å½åç®¡çå°
- å½åç¯å¢æ²¡æ Dockerï¼æ¬è½®æªåå®¹å¨åå®æºéªè¯ï¼åªåäºæ¬å° Node çº§å«çä»£ç åæ¥å£æ ¡éª
