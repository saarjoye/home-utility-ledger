import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  openDatabase,
  migrate,
  seed,
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

const db = openDatabase(dbPath);
migrate(db);
seed(db);

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

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

function serveStatic(reqPath, res) {
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
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      status: "ok",
      runtime: {
        node: process.version,
        database: dbPath
      }
    });
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

  if (req.method === "GET" && url.pathname === "/api/admin/summary") {
    return sendJson(res, 200, getAdminSummary(db));
  }

  if (req.method === "GET" && url.pathname === "/api/admin/accounts") {
    return sendJson(res, 200, { items: listAccounts(db) });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/jobs") {
    return sendJson(res, 200, { items: listJobs(db) });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/logs") {
    return sendJson(res, 200, { items: listSystemLogs(db, 50) });
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/admin\/accounts\/\d+\/toggle$/)) {
    const accountId = Number(url.pathname.split("/")[4]);
    const updated = toggleAccountStatus(db, accountId);
    if (!updated) {
      return sendJson(res, 404, { error: "Account not found" });
    }
    return sendJson(res, 200, { item: updated });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/run-job") {
    return readBody(req).then((body) => {
      if (!body.utilityType) {
        return sendJson(res, 400, { error: "utilityType is required" });
      }
      const job = runJob(db, body.utilityType);
      return sendJson(res, 200, { item: job });
    });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    return routeApi(req, res, url);
  }

  if (req.method !== "GET") {
    return sendText(res, 405, "Method Not Allowed");
  }

  if (url.pathname === "/admin") {
    return serveStatic("/admin.html", res);
  }

  if (url.pathname === "/dashboard") {
    return serveStatic("/index.html", res);
  }

  serveStatic(url.pathname, res);
});

server.listen(port, host, () => {
  console.log(`Home utility ledger is running on http://${host}:${port}`);
});
