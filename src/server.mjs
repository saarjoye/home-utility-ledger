import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  openDatabase,
  migrate,
  seed,
  deleteExpiredSessions,
  createSession,
  getSessionByTokenHash,
  touchSession,
  deleteSessionByTokenHash,
  getOverview,
  getAnalytics,
  getAdminSummary,
  listAccounts,
  listBills,
  listJobs,
  listPushLogs,
  listSystemLogs,
  getSiteSettings,
  toggleAccountStatus,
  runJob
} from "./db.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dbPath = process.env.DB_PATH
  ? path.resolve(rootDir, process.env.DB_PATH)
  : path.resolve(rootDir, "data", "app.db");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "change-me-admin";
const sessionSecret = process.env.SESSION_SECRET || "change-me-session-secret";
const sessionCookieName = process.env.SESSION_COOKIE_NAME || "hul_session";
const sessionTtlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 168));
const cookieSecure = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";

const db = openDatabase(dbPath);
migrate(db);
seed(db);
deleteExpiredSessions(db);

if (process.argv.includes("--seed-only")) {
  console.log(`Database is ready at ${dbPath}`);
  process.exit(0);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function writeResponse(res, statusCode, headers = {}, body = "") {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data, null, 2);
  writeResponse(res, statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  }, body);
}

function sendText(res, statusCode, message, extraHeaders = {}) {
  writeResponse(res, statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  }, message);
}

function redirect(res, location, statusCode = 302, extraHeaders = {}) {
  writeResponse(res, statusCode, {
    Location: location,
    ...extraHeaders
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((cookies, item) => {
    const trimmed = item.trim();
    if (!trimmed) {
      return cookies;
    }
    const index = trimmed.indexOf("=");
    const name = index >= 0 ? trimmed.slice(0, index) : trimmed;
    const value = index >= 0 ? trimmed.slice(index + 1) : "";
    cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  const maxAge = sessionTtlHours * 60 * 60;
  res.setHeader("Set-Cookie", serializeCookie(sessionCookieName, token, {
    maxAge,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure
  }));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", serializeCookie(sessionCookieName, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure
  }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf-8");
  const b = Buffer.from(String(right ?? ""), "utf-8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHmac("sha256", sessionSecret).update(token).digest("hex");
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[sessionCookieName];
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = getSessionByTokenHash(db, tokenHash);
  if (!session) {
    return null;
  }

  touchSession(db, session.id);
  return {
    id: session.id,
    username: session.username,
    token,
    tokenHash,
    expiresAt: session.expires_at
  };
}

function requireAdminApi(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, {
      error: "Authentication required",
      redirectTo: "/login"
    }, { "Cache-Control": "no-store" });
    return null;
  }
  return session;
}

function serveStatic(reqPath, res, extraHeaders = {}) {
  const normalizedPath = reqPath === "/" ? "/index.html" : reqPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(filePath);
  const type = mimeTypes[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    ...extraHeaders
  });
  fs.createReadStream(filePath).pipe(res);
}

function buildAdminView(summary) {
  const metrics = [
    {
      label: "ä»æ¥ä»»å¡",
      value: String(summary.metrics.jobRunsToday ?? 0),
      hint: "å·²æ§è¡åæ­¥ä»»å¡"
    },
    {
      label: "è´¦æ·æ°é",
      value: String(summary.metrics.accountCount ?? 0),
      hint: "å·²æ¥å¥çµæ°´çè´¦æ·"
    },
    {
      label: "æ¨éæ¬¡æ°",
      value: String(summary.metrics.pushCount ?? 0),
      hint: "ä¼ä¸å¾®ä¿¡æ¶æ¯æ¨éç´¯è®¡"
    },
    {
      label: "å¥åº·è¯å",
      value: `${Number(summary.metrics.healthScore ?? 0).toFixed(1)}%`,
      hint: "åå°è¿è¡å¥åº·åº¦"
    }
  ];

  const pending = [];
  for (const item of summary.health || []) {
    if (String(item.status).toLowerCase() !== "ok") {
      pending.push({
        title: item.name,
        status: item.status
      });
    }
  }
  for (const job of summary.jobs || []) {
    if (["warning", "error", "failed"].includes(String(job.lastStatus || "").toLowerCase())) {
      pending.push({
        title: job.name,
        status: job.lastStatus
      });
    }
  }

  return {
    title: "å®¶åº­æ°´çµçè´¦æ¬",
    subtitle: "ééãç»è®¡ä¸éç¥åå°",
    metrics,
    pending,
    accounts: summary.accounts || [],
    jobs: summary.jobs || [],
    health: summary.health || [],
    settings: {
      wecom: summary.wecom || {},
      statistics: summary.statistics || {}
    },
    logs: summary.logs || []
  };
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      status: "ok",
      runtime: {
        node: process.version,
        database: dbPath,
        environment: process.env.NODE_ENV || "production"
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return sendJson(res, 400, { error: "username and password are required" }, { "Cache-Control": "no-store" });
    }
    if (!safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
      return sendJson(res, 401, { error: "invalid credentials" }, { "Cache-Control": "no-store" });
    }

    const token = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1000).toISOString();
    createSession(db, {
      username,
      tokenHash: hashSessionToken(token),
      createdAt: now.toISOString(),
      expiresAt,
      lastSeenAt: now.toISOString()
    });

    setSessionCookie(res, token);
    return sendJson(res, 200, {
      ok: true,
      user: {
        username
      }
    }, { "Cache-Control": "no-store" });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const session = getSession(req);
    if (session) {
      deleteSessionByTokenHash(db, session.tokenHash);
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true }, { "Cache-Control": "no-store" });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const session = getSession(req);
    if (!session) {
      return sendJson(res, 401, { authenticated: false }, { "Cache-Control": "no-store" });
    }
    return sendJson(res, 200, {
      authenticated: true,
      user: {
        username: session.username
      }
    }, { "Cache-Control": "no-store" });
  }

  if (req.method === "GET" && url.pathname === "/api/site") {
    return sendJson(res, 200, {
      site: getSiteSettings(db)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/overview") {
    return sendJson(res, 200, getOverview(db));
  }

  if (req.method === "GET" && url.pathname === "/api/bills") {
    const data = listBills(db, {
      utilityType: url.searchParams.get("utilityType"),
      accountId: url.searchParams.get("accountId"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to")
    });
    return sendJson(res, 200, { items: data });
  }

  if (req.method === "GET" && url.pathname === "/api/analytics") {
    return sendJson(res, 200, getAnalytics(db, {
      utilityType: url.searchParams.get("utilityType"),
      granularity: url.searchParams.get("granularity")
    }));
  }

  if (req.method === "GET" && url.pathname === "/api/push-logs") {
    return sendJson(res, 200, { items: listPushLogs(db) });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const session = requireAdminApi(req, res);
    if (!session) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/summary") {
      return sendJson(res, 200, buildAdminView(getAdminSummary(db)), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/accounts") {
      return sendJson(res, 200, { items: listAccounts(db) }, { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/jobs") {
      return sendJson(res, 200, { items: listJobs(db) }, { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/logs") {
      return sendJson(res, 200, { items: listSystemLogs(db, 50) }, { "Cache-Control": "no-store" });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/admin\/accounts\/\d+\/toggle$/)) {
      const accountId = Number(url.pathname.split("/")[4]);
      const updated = toggleAccountStatus(db, accountId);
      if (!updated) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      return sendJson(res, 200, { item: updated }, { "Cache-Control": "no-store" });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/run-job") {
      const body = await readBody(req);
      if (!body.utilityType) {
        return sendJson(res, 400, { error: "utilityType is required" }, { "Cache-Control": "no-store" });
      }
      const job = runJob(db, body.utilityType);
      return sendJson(res, 200, { item: job }, { "Cache-Control": "no-store" });
    }
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);

  if (url.pathname.startsWith("/api/")) {
    return routeApi(req, res, url);
  }

  if (url.pathname === "/logout") {
    const session = getSession(req);
    if (session) {
      deleteSessionByTokenHash(db, session.tokenHash);
    }
    clearSessionCookie(res);
    return redirect(res, "/login", 302, { "Cache-Control": "no-store" });
  }

  if (req.method !== "GET") {
    return sendText(res, 405, "Method Not Allowed");
  }

  if (url.pathname === "/login" || url.pathname === "/login.html") {
    if (getSession(req)) {
      return redirect(res, "/admin", 302, { "Cache-Control": "no-store" });
    }
    return serveStatic("/login.html", res, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/admin" || url.pathname === "/admin.html") {
    if (!getSession(req)) {
      return redirect(res, "/login", 302, { "Cache-Control": "no-store" });
    }
    return serveStatic("/admin.html", res, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/dashboard") {
    return serveStatic("/index.html", res);
  }

  return serveStatic(url.pathname, res);
});

server.listen(port, host, () => {
  console.log(`Home utility ledger is running on http://${host}:${port}`);
});
