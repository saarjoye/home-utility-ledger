import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  openDatabase,
  migrate,
  seed,
  repairStoredText,
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
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  toggleAccountStatus,
  runJob,
  createBillRecord
} from "./db.mjs";
import { runCollectionJob, startCollectionScheduler, testCollectionConnection } from "./job-runner.mjs";

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
repairStoredText(db);
deleteExpiredSessions(db);
const scheduler = startCollectionScheduler(db);

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

const providerDefinitions = [
  {
    key: "sgcc_zhejiang",
    utilityType: "electricity",
    provider: "网上国网（浙江）",
    loginMethods: ["账号密码", "密码 + 短信"],
    credentialFields: [
      { key: "username", label: "登录账号", type: "text", required: true },
      { key: "password", label: "登录密码", type: "password", required: true },
      { key: "mobile", label: "手机号", type: "text", required: false },
      { key: "customerNo", label: "客户编号", type: "text", required: false }
    ]
  },
  {
    key: "hzwater_online",
    utilityType: "water",
    provider: "杭水网上厅",
    loginMethods: ["账号密码"],
    credentialFields: [
      { key: "username", label: "登录账号", type: "text", required: true },
      { key: "password", label: "登录密码", type: "password", required: true },
      { key: "mobile", label: "手机号", type: "text", required: false }
    ]
  },
  {
    key: "hzgas_servicehall",
    utilityType: "gas",
    provider: "19服务厅 / 杭燃码",
    loginMethods: ["公众号辅助", "账号密码"],
    credentialFields: [
      { key: "username", label: "登录账号", type: "text", required: false },
      { key: "password", label: "登录密码", type: "password", required: false },
      { key: "mobile", label: "手机号", type: "text", required: true },
      { key: "notes", label: "登录说明", type: "text", required: false }
    ]
  }
];

Object.assign(providerDefinitions[0], {
  provider: "网上国网（浙江）",
  loginMethods: ["账号密码", "密码 + 短信", "登录态 Cookie"],
  credentialFields: [
    { key: "username", label: "登录账号", type: "text", required: false },
    { key: "password", label: "登录密码", type: "password", required: false },
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "customerNo", label: "客户编号", type: "text", required: false },
    { key: "cookieHeader", label: "Cookie Header", type: "password", required: false }
  ]
});

Object.assign(providerDefinitions[1], {
  provider: "杭水网上营业厅",
  loginMethods: ["登录态 Token", "登录态 Cookie", "手机号 + 验证码 + 密码"],
  credentialFields: [
    { key: "sessionToken", label: "waterUserToken", type: "password", required: false },
    { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
    { key: "meterNumber", label: "水表号", type: "text", required: false },
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "password", label: "登录密码", type: "password", required: false }
  ]
});

Object.assign(providerDefinitions[2], {
  provider: "杭州燃气 19 服务厅",
  loginMethods: ["微信公众号", "支付宝生活号", "待接入"],
  credentialFields: [
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "notes", label: "登录说明", type: "text", required: false }
  ]
});

Object.assign(providerDefinitions[0], {
  provider: "网上国网（浙江）",
  loginMethods: ["账号密码", "密码 + 短信", "会话导入 Cookie + Storage"],
  credentialFields: [
    { key: "username", label: "登录账号", type: "text", required: false },
    { key: "password", label: "登录密码", type: "password", required: false },
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "customerNo", label: "客户编号", type: "text", required: false },
    { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
    { key: "storageJson", label: "Storage JSON", type: "password", required: false }
  ]
});

Object.assign(providerDefinitions[1], {
  provider: "杭水网上营业厅",
  loginMethods: ["会话导入 Token", "会话导入 Cookie", "手机号 + 验证码 + 密码"],
  credentialFields: [
    { key: "sessionToken", label: "waterUserToken", type: "password", required: false },
    { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
    { key: "meterNumber", label: "水表号", type: "text", required: false },
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "password", label: "登录密码", type: "password", required: false }
  ]
});

Object.assign(providerDefinitions[2], {
  provider: "杭州燃气 19 服务厅",
  loginMethods: ["微信公众号", "支付宝生活号", "待接入"],
  credentialFields: [
    { key: "mobile", label: "手机号", type: "text", required: false },
    { key: "notes", label: "登录说明", type: "text", required: false }
  ]
});

const providerDefinitionsForApi = [
  {
    key: "sgcc_zhejiang",
    utilityType: "electricity",
    provider: "网上国网（浙江）",
    loginMethods: [
      "账号密码",
      "密码 + 短信",
      "会话导入 Cookie + Storage"
    ],
    credentialFields: [
      { key: "username", label: "登录账号", type: "text", required: false },
      { key: "password", label: "登录密码", type: "password", required: false },
      { key: "mobile", label: "手机号", type: "text", required: false },
      { key: "customerNo", label: "客户编号", type: "text", required: false },
      { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
      { key: "storageJson", label: "Storage JSON", type: "password", required: false },
      { key: "loginUrl", label: "登录页面 URL", type: "text", required: false },
      { key: "homeUrl", label: "首页 URL", type: "text", required: false },
      { key: "summaryUrl", label: "电费概览 URL", type: "text", required: false },
      { key: "chargeUrl", label: "电量分析 URL", type: "text", required: false },
      { key: "usernameSelector", label: "账号输入框选择器", type: "text", required: false },
      { key: "passwordSelector", label: "密码输入框选择器", type: "text", required: false },
      { key: "submitSelector", label: "登录按钮选择器", type: "text", required: false },
      { key: "successWaitFor", label: "登录成功等待选择器", type: "text", required: false }
    ]
  },
  {
    key: "hzwater_online",
    utilityType: "water",
    provider: "杭水网上营业厅",
    loginMethods: [
      "会话导入 Token",
      "会话导入 Cookie",
      "手机号 + 验证码 + 密码"
    ],
    credentialFields: [
      { key: "sessionToken", label: "waterUserToken", type: "password", required: false },
      { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
      { key: "meterNumber", label: "水表号", type: "text", required: false },
      { key: "mobile", label: "手机号", type: "text", required: false },
      { key: "password", label: "登录密码", type: "password", required: false }
    ]
  },
  {
    key: "hzgas_servicehall",
    utilityType: "gas",
    provider: "杭州天然气服务号",
    loginMethods: [
      "微信公众号会话",
      "支付宝生活号",
      "待接入"
    ],
    credentialFields: [
      { key: "cookieHeader", label: "Cookie Header", type: "password", required: false },
      { key: "address", label: "户号地址", type: "text", required: false },
      { key: "orgId", label: "Org ID", type: "text", required: false },
      { key: "mobile", label: "手机号", type: "text", required: false },
      { key: "notes", label: "登录说明", type: "text", required: false }
    ]
  }
];

const providerDefinitionsForAdminUi = [
  {
    key: "sgcc_zhejiang",
    utilityType: "electricity",
    provider: "网上国网（浙江）",
    loginMethods: [
      "CK 会话导入"
    ],
    credentialFields: [
      { key: "cookieHeader", label: "登录 Cookie（CK）", type: "password", required: true },
      { key: "storageJson", label: "浏览器存储快照（storageJson）", type: "password", required: true }
    ]
  },
  {
    key: "hzwater_online",
    utilityType: "water",
    provider: "杭水网上营业厅",
    loginMethods: [
      "Token 导入",
      "CK 导入"
    ],
    credentialFields: [
      { key: "sessionToken", label: "waterUserToken", type: "password", required: false },
      { key: "unid", label: "UNID（可留空）", type: "text", required: false },
      { key: "cookieHeader", label: "登录 Cookie（CK）", type: "password", required: false },
      { key: "meterNumber", label: "水表号", type: "text", required: false }
    ]
  },
  {
    key: "hzgas_servicehall",
    utilityType: "gas",
    provider: "杭州天然气服务号",
    loginMethods: [
      "CK 导入"
    ],
    credentialFields: [
      { key: "cookieHeader", label: "登录 Cookie（CK）", type: "password", required: true },
      { key: "address", label: "开户地址", type: "text", required: false },
      { key: "orgId", label: "机构 ID（orgId）", type: "text", required: false }
    ]
  }
];

const providerDefinitionsClean = [
  {
    key: "sgcc_zhejiang",
    utilityType: "electricity",
    provider: "网上国网（浙江）",
    loginMethods: ["浏览器会话导入"],
    form: {
      accountNoLabel: "用电户号（可留空）",
      accountNoPlaceholder: "如果同一账号下绑定多个用电户号，建议填写；单户号可留空",
      accountNoRequired: false,
      loginNameVisible: false,
      notesPlaceholder: "可记录住址、户名或抓取来源，非必填",
      credentialIntro: "推荐方式：先在浏览器登录 95598 / 网上国网，再把会话导入到后台。",
      sessionGuide: "短信验证码登录通常伴随滑块和风控校验，不适合在服务器 Docker 中做长期稳定的纯自动登录。"
    },
    credentialFields: [
      {
        key: "cookieHeader",
        label: "登录 Cookie（CK）",
        type: "password",
        required: true,
        helpText: "从已登录的 95598 / 网上国网页面复制整段 Cookie。"
      },
      {
        key: "storageJson",
        label: "浏览器存储快照（storageJson，可选增强）",
        type: "password",
        required: false,
        helpText: "只有 CK 单独无法进入账单页时，再补充 localStorage / sessionStorage 快照。"
      }
    ]
  },
  {
    key: "hzwater_online",
    utilityType: "water",
    provider: "杭州市水务集团网上营业厅",
    loginMethods: ["Token 导入"],
    form: {
      accountNoLabel: "水表号 / 户号（可留空）",
      accountNoPlaceholder: "通常可留空；测试成功后系统会自动识别水表号",
      accountNoRequired: false,
      loginNameVisible: false,
      notesPlaceholder: "可记录开户地址、户名或补充说明，非必填",
      credentialIntro: "当前最稳的接入方式是填写 waterUserToken；如已知道水表号，可一并填写以加快匹配。",
      sessionGuide: "杭水网页虽然支持短信验证码登录，但真正采集依赖登录后的 waterUserToken。纯服务器容器无法直接读取你浏览器里的 localStorage，所以不适合做无人工参与的短信自动登录。"
    },
    credentialFields: [
      {
        key: "sessionToken",
        label: "waterUserToken",
        type: "password",
        required: true,
        helpText: "从已登录杭水网页的 localStorage 中提取 waterUserToken。"
      },
      {
        key: "meterNumber",
        label: "水表号（可留空）",
        type: "text",
        required: false,
        helpText: "留空时会先请求当前账号的水表列表并自动选取。"
      }
    ]
  },
  {
    key: "hzgas_servicehall",
    utilityType: "gas",
    provider: "杭州天然气公众号服务",
    loginMethods: ["CK 会话导入"],
    form: {
      accountNoLabel: "燃气户号 / userNo",
      accountNoPlaceholder: "例如 0099162500",
      accountNoRequired: true,
      loginNameVisible: false,
      notesPlaceholder: "可记录开户地址或站点信息，非必填",
      credentialIntro: "当前最稳的接入方式是填写公众号会话 CK + 燃气户号 / userNo。",
      sessionGuide: "燃气查询页面依赖微信公众号环境，服务器容器无法直接完成公众号内登录。"
    },
    credentialFields: [
      {
        key: "cookieHeader",
        label: "登录 Cookie（CK）",
        type: "password",
        required: true,
        helpText: "从已登录的公众号 H5 请求里复制 `logged_in_user=...` 这一段会话 Cookie。"
      }
    ]
  }
];

function findProviderDefinition(utilityType, provider) {
  return providerDefinitionsClean.find((item) => {
    return item.utilityType === utilityType && item.provider === provider;
  }) || providerDefinitionsClean.find((item) => {
    return item.utilityType === utilityType;
  }) || null;
}

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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeAccountPayload(body = {}) {
  const status = normalizeText(body.status) || "active";
  return {
    name: normalizeText(body.name),
    utilityType: normalizeText(body.utilityType),
    provider: normalizeText(body.provider),
    accountNo: normalizeOptionalText(body.accountNo) || "",
    loginName: normalizeOptionalText(body.loginName),
    loginMethod: normalizeText(body.loginMethod),
    status,
    isPrimary: Boolean(body.isPrimary),
    notes: normalizeOptionalText(body.notes),
    credentials: body.credentials && typeof body.credentials === "object" ? body.credentials : {},
    clearCredentials: Boolean(body.clearCredentials)
  };
}

function validateAccountPayload(payload) {
  const errors = [];
  const providerDefinition = findProviderDefinition(payload.utilityType, payload.provider);
  const accountNoRequired = providerDefinition?.form?.accountNoRequired ?? true;

  if (!payload.name) errors.push("name is required");
  if (!payload.utilityType) errors.push("utilityType is required");
  if (!payload.provider) errors.push("provider is required");
  if (accountNoRequired && !payload.accountNo) errors.push("accountNo is required");
  if (!payload.loginMethod) errors.push("loginMethod is required");
  if (!["electricity", "water", "gas"].includes(payload.utilityType)) {
    errors.push("utilityType must be electricity, water, or gas");
  }
  return errors;
}

function normalizeBillPayload(body = {}) {
  return {
    accountId: Number(body.accountId),
    statementDate: normalizeText(body.statementDate),
    periodStart: normalizeOptionalText(body.periodStart),
    periodEnd: normalizeOptionalText(body.periodEnd),
    usageValue: body.usageValue === "" || body.usageValue === undefined || body.usageValue === null ? null : Number(body.usageValue),
    usageUnit: normalizeOptionalText(body.usageUnit),
    amount: Number(body.amount),
    currency: normalizeText(body.currency) || "CNY",
    sourceChannel: normalizeText(body.sourceChannel) || "manual",
    recordType: normalizeText(body.recordType) || "bill",
    status: normalizeText(body.status) || "confirmed",
    isEstimated: Boolean(body.isEstimated)
  };
}

function validateBillPayload(payload) {
  const errors = [];
  if (!Number.isInteger(payload.accountId) || payload.accountId <= 0) errors.push("accountId is required");
  if (!payload.statementDate) errors.push("statementDate is required");
  if (!Number.isFinite(payload.amount)) errors.push("amount must be a number");
  if (payload.usageValue !== null && !Number.isFinite(payload.usageValue)) errors.push("usageValue must be a number when provided");
  return errors;
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

function requireSessionJson(req, res) {
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
      label: "今日任务",
      value: String(summary.metrics.jobRunsToday ?? 0),
      hint: "已执行同步任务"
    },
    {
      label: "账户数量",
      value: String(summary.metrics.accountCount ?? 0),
      hint: "已接入电水燃账户"
    },
    {
      label: "推送次数",
      value: String(summary.metrics.pushCount ?? 0),
      hint: "企业微信消息推送累计"
    },
    {
      label: "健康评分",
      value: `${Number(summary.metrics.healthScore ?? 0).toFixed(1)}%`,
      hint: "后台运行健康度"
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
    title: "家庭水电燃账本",
    subtitle: "采集、统计与通知后台",
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

  const protectedSession = requireSessionJson(req, res);
  if (!protectedSession) {
    return;
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
    if (req.method === "GET" && url.pathname === "/api/admin/summary") {
      return sendJson(res, 200, buildAdminView(getAdminSummary(db)), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/providers") {
      return sendJson(res, 200, { items: providerDefinitionsClean }, { "Cache-Control": "no-store" });

      const items = providerDefinitionsForAdminUi.map((item) => {
        if (item.key !== "sgcc_zhejiang") {
          return item;
        }

        return {
          ...item,
          credentialFields: item.credentialFields.map((field) => {
            if (field.key !== "storageJson") {
              return field;
            }
            return {
              ...field,
              label: "浏览器存储快照（storageJson，可选增强项）",
              required: false
            };
          })
        };
      });

      return sendJson(res, 200, { items }, { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/accounts") {
      return sendJson(res, 200, { items: listAccounts(db) }, { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/admin\/accounts\/\d+$/)) {
      const accountId = Number(url.pathname.split("/")[4]);
      const account = getAccountById(db, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      return sendJson(res, 200, { item: account }, { "Cache-Control": "no-store" });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/accounts") {
      const body = await readBody(req);
      const payload = normalizeAccountPayload(body);
      const errors = validateAccountPayload(payload);
      if (errors.length) {
        return sendJson(res, 400, { errors }, { "Cache-Control": "no-store" });
      }
      const item = createAccount(db, payload);
      return sendJson(res, 201, { item }, { "Cache-Control": "no-store" });
    }

    if (req.method === "PUT" && url.pathname.match(/^\/api\/admin\/accounts\/\d+$/)) {
      const accountId = Number(url.pathname.split("/")[4]);
      const body = await readBody(req);
      const payload = normalizeAccountPayload(body);
      const errors = validateAccountPayload(payload);
      if (errors.length) {
        return sendJson(res, 400, { errors }, { "Cache-Control": "no-store" });
      }
      const item = updateAccount(db, accountId, payload);
      if (!item) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      return sendJson(res, 200, { item }, { "Cache-Control": "no-store" });
    }

    if (req.method === "DELETE" && url.pathname.match(/^\/api\/admin\/accounts\/\d+$/)) {
      const accountId = Number(url.pathname.split("/")[4]);
      const item = deleteAccount(db, accountId);
      if (!item) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      return sendJson(res, 200, { item }, { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/jobs") {
      return sendJson(res, 200, { items: listJobs(db) }, { "Cache-Control": "no-store" });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/bills") {
      const body = await readBody(req);
      const payload = normalizeBillPayload(body);
      const errors = validateBillPayload(payload);
      if (errors.length) {
        return sendJson(res, 400, { errors }, { "Cache-Control": "no-store" });
      }
      const item = createBillRecord(db, payload);
      if (!item) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      return sendJson(res, 201, { item }, { "Cache-Control": "no-store" });
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

    if (req.method === "POST" && url.pathname.match(/^\/api\/admin\/accounts\/\d+\/test$/)) {
      const accountId = Number(url.pathname.split("/")[4]);
      const account = getAccountById(db, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" }, { "Cache-Control": "no-store" });
      }
      try {
        const result = await testCollectionConnection(db, account);
        return sendJson(res, 200, { item: result }, { "Cache-Control": "no-store" });
      } catch (error) {
        return sendJson(res, 400, { error: error.message || "Connection test failed" }, { "Cache-Control": "no-store" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/admin/run-job") {
      const body = await readBody(req);
      if (!body.utilityType) {
        return sendJson(res, 400, { error: "utilityType is required" }, { "Cache-Control": "no-store" });
      }
      const result = await runCollectionJob(db, body.utilityType, "admin-action");
      return sendJson(res, 200, { item: result }, { "Cache-Control": "no-store" });
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

  if (url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/index.html") {
    if (!getSession(req)) {
      return redirect(res, "/login", 302, { "Cache-Control": "no-store" });
    }
    return serveStatic("/index.html", res, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/admin" || url.pathname === "/admin.html") {
    if (!getSession(req)) {
      return redirect(res, "/login", 302, { "Cache-Control": "no-store" });
    }
    return serveStatic("/admin.html", res, { "Cache-Control": "no-store" });
  }

  return serveStatic(url.pathname, res);
});

server.listen(port, host, () => {
  console.log(`Home utility ledger is running on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    scheduler.stop();
    process.exit(0);
  });
}
