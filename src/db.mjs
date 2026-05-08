import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "app.db");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toJson(value) {
  return JSON.stringify(value);
}

function fromJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function iso(dateString) {
  return new Date(dateString).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function accountSecretKey(secret = process.env.ACCOUNT_CREDENTIALS_SECRET || process.env.SESSION_SECRET || "change-me-account-credentials-secret") {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest();
}

function encryptSecretPayload(value) {
  const payload = JSON.stringify(value ?? {});
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", accountSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  });
}

function decryptSecretPayload(value) {
  if (!value) {
    return {};
  }
  const payload = fromJson(value, null);
  if (!payload?.iv || !payload?.tag || !payload?.data) {
    return {};
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      accountSecretKey(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]).toString("utf8");
    return fromJson(decrypted, {});
  } catch {
    return {};
  }
}

function sanitizeCredentialPayload(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = {};
  for (const [key, item] of Object.entries(source)) {
    if (item === undefined || item === null) {
      continue;
    }
    const trimmed = typeof item === "string" ? item.trim() : item;
    if (trimmed === "") {
      continue;
    }
    next[key] = trimmed;
  }
  return next;
}

function looksLikeMojibake(value) {
  return /[À-ÿ�]/.test(value);
}

function textQualityScore(value) {
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinSupplementCount = (value.match(/[À-ÿ]/g) || []).length;
  const replacementCount = (value.match(/�/g) || []).length;
  const commonPunctuationCount = (value.match(/[，。！？：“”‘’、】【（）《》、]/g) || []).length;
  return (cjkCount * 3) + commonPunctuationCount - (latinSupplementCount * 2) - (replacementCount * 4);
}

function repairPossibleMojibake(value) {
  if (typeof value !== "string" || !value || !looksLikeMojibake(value)) {
    return value;
  }

  const repaired = Buffer.from(value, "latin1").toString("utf8");
  if (!repaired || repaired === value) {
    return value;
  }

  return textQualityScore(repaired) > textQualityScore(value) ? repaired : value;
}

function repairNestedText(value) {
  if (typeof value === "string") {
    return repairPossibleMojibake(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairNestedText(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairNestedText(item)])
    );
  }

  return value;
}

function repairSerializedJson(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    const repaired = repairNestedText(parsed);
    return JSON.stringify(repaired);
  } catch {
    return repairPossibleMojibake(value);
  }
}

export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  ensureDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      utility_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_no TEXT NOT NULL,
      login_name TEXT,
      login_method TEXT NOT NULL,
      status TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      utility_type TEXT NOT NULL,
      schedule_time TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_status TEXT,
      next_run_at TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      retry_interval_minutes INTEGER NOT NULL DEFAULT 10,
      status_hint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      utility_type TEXT NOT NULL,
      statement_date TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      usage_value REAL,
      usage_unit TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      source_channel TEXT NOT NULL,
      record_type TEXT NOT NULL,
      is_estimated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS daily_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      utility_type TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      usage_value REAL,
      usage_unit TEXT,
      amount REAL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      source_channel TEXT NOT NULL,
      is_estimated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS push_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      push_type TEXT NOT NULL,
      target TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT,
      pushed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      module_name TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_secrets (
      account_id INTEGER PRIMARY KEY,
      credentials_ciphertext TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collector_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utility_type TEXT NOT NULL,
      account_id INTEGER,
      provider TEXT,
      status TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      summary TEXT,
      details TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
  `);
}

export function seed(db) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM accounts").get();
  if (existing.count > 0) {
    return;
  }

  const now = iso("2026-05-07T08:30:00+08:00");
  const insertAccount = db.prepare(`
    INSERT INTO accounts (
      name, utility_type, provider, account_no, login_name, login_method,
      status, is_primary, notes, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAccount.run(
    "家里主电表",
    "electricity",
    "网上国网",
    "330100009845",
    "138****0001",
    "密码 + 短信",
    "active",
    1,
    "浙江居民户",
    iso("2026-05-07T07:36:00+08:00"),
    now,
    now
  );
  insertAccount.run(
    "家里水务账户",
    "water",
    "杭水网上厅",
    "HZW2208411",
    "139****1002",
    "账号密码",
    "active",
    1,
    "账单周期型数据",
    iso("2026-05-07T07:02:00+08:00"),
    now,
    now
  );
  insertAccount.run(
    "家里燃气账户",
    "gas",
    "19服务厅 / 杭燃码",
    "GAS8841220",
    "公众号辅助登录",
    "公众号辅助",
    "attention",
    1,
    "夜间补抓失败 1 次",
    iso("2026-05-07T07:12:00+08:00"),
    now,
    now
  );

  const accounts = db.prepare("SELECT id, utility_type FROM accounts ORDER BY id").all();
  const accountMap = Object.fromEntries(accounts.map((row) => [row.utility_type, row.id]));

  const insertJob = db.prepare(`
    INSERT INTO sync_jobs (
      name, utility_type, schedule_time, enabled, last_run_at, last_status,
      next_run_at, retries, retry_interval_minutes, status_hint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertJob.run(
    "电力日采集",
    "electricity",
    "06:30",
    1,
    iso("2026-05-07T06:38:00+08:00"),
    "success",
    iso("2026-05-08T06:30:00+08:00"),
    0,
    10,
    "昨日电量已生成",
    now,
    now
  );
  insertJob.run(
    "水务账单采集",
    "water",
    "07:00",
    1,
    iso("2026-05-07T07:02:00+08:00"),
    "success",
    iso("2026-05-08T07:00:00+08:00"),
    0,
    10,
    "本轮无新增账单",
    now,
    now
  );
  insertJob.run(
    "燃气清单采集",
    "gas",
    "07:30",
    1,
    iso("2026-05-07T07:12:00+08:00"),
    "warning",
    iso("2026-05-07T22:00:00+08:00"),
    1,
    15,
    "补抓详细页失败，待夜间重试",
    now,
    now
  );

  const insertBill = db.prepare(`
    INSERT INTO bill_records (
      account_id, utility_type, statement_date, period_start, period_end, usage_value,
      usage_unit, amount, currency, source_channel, record_type, is_estimated, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDaily = db.prepare(`
    INSERT INTO daily_records (
      account_id, utility_type, usage_date, usage_value, usage_unit, amount, currency,
      source_channel, is_estimated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const electricityMonth = [
    ["2026-01-31", "2026-01-01", "2026-01-31", 118.5, "kWh", 148.8],
    ["2026-02-28", "2026-02-01", "2026-02-28", 120.9, "kWh", 153.2],
    ["2026-03-31", "2026-03-01", "2026-03-31", 146.7, "kWh", 168.9],
    ["2026-04-30", "2026-04-01", "2026-04-30", 132.4, "kWh", 168.2]
  ];
  for (const item of electricityMonth) {
    insertBill.run(
      accountMap.electricity,
      "electricity",
      item[0],
      item[1],
      item[2],
      item[3],
      item[4],
      item[5],
      "CNY",
      "网上国网",
      "bill",
      0,
      "confirmed",
      now
    );
  }

  const waterMonth = [
    ["2026-01-31", "2026-01-01", "2026-01-31", 7, "m³", 18.6],
    ["2026-02-28", "2026-02-01", "2026-02-28", 7.2, "m³", 19.4],
    ["2026-03-31", "2026-03-01", "2026-03-31", 7.8, "m³", 20.8],
    ["2026-04-30", "2026-04-01", "2026-04-30", 8, "m³", 22.1]
  ];
  for (const item of waterMonth) {
    insertBill.run(
      accountMap.water,
      "water",
      item[0],
      item[1],
      item[2],
      item[3],
      item[4],
      item[5],
      "CNY",
      "杭水网上厅",
      "bill",
      0,
      "confirmed",
      now
    );
  }

  const gasMonth = [
    ["2026-01-31", "2026-01-01", "2026-01-31", null, null, 92.5],
    ["2026-02-28", "2026-02-01", "2026-02-28", null, null, 96.2],
    ["2026-03-31", "2026-03-01", "2026-03-31", null, null, 103.4],
    ["2026-05-07", "2026-04-08", "2026-05-07", null, null, 34.2]
  ];
  for (const item of gasMonth) {
    insertBill.run(
      accountMap.gas,
      "gas",
      item[0],
      item[1],
      item[2],
      item[3],
      item[4],
      item[5],
      "CNY",
      "19服务厅",
      item[0] === "2026-05-07" ? "statement" : "bill",
      0,
      item[0] === "2026-05-07" ? "pending" : "confirmed",
      now
    );
  }

  const recentDaily = [
    ["2026-05-01", 11.2, 5.16],
    ["2026-05-02", 11.6, 5.21],
    ["2026-05-03", 15.7, 6.28],
    ["2026-05-04", 16.8, 6.74],
    ["2026-05-05", 15.9, 6.32],
    ["2026-05-06", 12.8, 5.63]
  ];
  for (const item of recentDaily) {
    insertDaily.run(
      accountMap.electricity,
      "electricity",
      item[0],
      item[1],
      "kWh",
      item[2],
      "CNY",
      "网上国网",
      0,
      now
    );
  }

  const insertPush = db.prepare(`
    INSERT INTO push_logs (push_type, target, title, status, details, pushed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertPush.run("daily", "家庭通知应用", "05-07 日报", "success", "电力日报与燃气提醒已推送", iso("2026-05-07T08:00:00+08:00"));
  insertPush.run("alert", "家庭通知应用", "燃气补抓告警", "success", "已通知夜间补抓失败", iso("2026-05-07T08:16:00+08:00"));

  const insertLog = db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertLog.run("error", "gas-collector", "19 服务厅补抓失败，页面二次跳转超时", toJson({ retryPlannedAt: "2026-05-07T22:00:00+08:00" }), iso("2026-05-07T08:16:00+08:00"));
  insertLog.run("info", "notifier", "日报推送至家庭通知应用成功", toJson({ pushType: "daily" }), iso("2026-05-07T08:00:00+08:00"));
  insertLog.run("info", "electricity-collector", "昨日电量和日电费已写入 daily_records", toJson({ usageDate: "2026-05-06" }), iso("2026-05-07T07:36:00+08:00"));

  const settings = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  settings.run("site", toJson({ title: "家用能耗账本", timezone: "Asia/Shanghai" }), now);
  settings.run("wecom", toJson({
    corpId: "ww9c8f2a******",
    agentId: "1000012",
    enabled: true,
    dailyPushTime: "08:00",
    monthlyPushTime: "01 09:00",
    recipients: ["家庭通知应用"]
  }), now);
  settings.run("statistics", toJson({
    defaultGranularity: "month",
    waterGasStrategy: "billing-period-only",
    estimationEnabled: false,
    includeEstimatedInTotal: false
  }), now);
}

export function repairStoredText(db) {
  const accountRows = db.prepare(`
    SELECT id, name, provider, login_name, login_method, notes
    FROM accounts
  `).all();
  const updateAccount = db.prepare(`
    UPDATE accounts
    SET name = ?, provider = ?, login_name = ?, login_method = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `);
  for (const row of accountRows) {
    const next = {
      name: repairPossibleMojibake(row.name),
      provider: repairPossibleMojibake(row.provider),
      loginName: repairPossibleMojibake(row.login_name),
      loginMethod: repairPossibleMojibake(row.login_method),
      notes: repairPossibleMojibake(row.notes)
    };
    if (
      next.name !== row.name ||
      next.provider !== row.provider ||
      next.loginName !== row.login_name ||
      next.loginMethod !== row.login_method ||
      next.notes !== row.notes
    ) {
      updateAccount.run(
        next.name,
        next.provider,
        next.loginName,
        next.loginMethod,
        next.notes,
        new Date().toISOString(),
        row.id
      );
    }
  }

  const jobRows = db.prepare(`
    SELECT id, name, status_hint
    FROM sync_jobs
  `).all();
  const updateJob = db.prepare(`
    UPDATE sync_jobs
    SET name = ?, status_hint = ?, updated_at = ?
    WHERE id = ?
  `);
  for (const row of jobRows) {
    const nextName = repairPossibleMojibake(row.name);
    const nextStatusHint = repairPossibleMojibake(row.status_hint);
    if (nextName !== row.name || nextStatusHint !== row.status_hint) {
      updateJob.run(nextName, nextStatusHint, new Date().toISOString(), row.id);
    }
  }

  const billRows = db.prepare(`
    SELECT id, source_channel
    FROM bill_records
  `).all();
  const updateBill = db.prepare(`
    UPDATE bill_records
    SET source_channel = ?
    WHERE id = ?
  `);
  for (const row of billRows) {
    const nextSourceChannel = repairPossibleMojibake(row.source_channel);
    if (nextSourceChannel !== row.source_channel) {
      updateBill.run(nextSourceChannel, row.id);
    }
  }

  const dailyRows = db.prepare(`
    SELECT id, source_channel
    FROM daily_records
  `).all();
  const updateDaily = db.prepare(`
    UPDATE daily_records
    SET source_channel = ?
    WHERE id = ?
  `);
  for (const row of dailyRows) {
    const nextSourceChannel = repairPossibleMojibake(row.source_channel);
    if (nextSourceChannel !== row.source_channel) {
      updateDaily.run(nextSourceChannel, row.id);
    }
  }

  const pushRows = db.prepare(`
    SELECT id, target, title, details
    FROM push_logs
  `).all();
  const updatePush = db.prepare(`
    UPDATE push_logs
    SET target = ?, title = ?, details = ?
    WHERE id = ?
  `);
  for (const row of pushRows) {
    const next = {
      target: repairPossibleMojibake(row.target),
      title: repairPossibleMojibake(row.title),
      details: repairPossibleMojibake(row.details)
    };
    if (next.target !== row.target || next.title !== row.title || next.details !== row.details) {
      updatePush.run(next.target, next.title, next.details, row.id);
    }
  }

  const logRows = db.prepare(`
    SELECT id, message, details
    FROM system_logs
  `).all();
  const updateLog = db.prepare(`
    UPDATE system_logs
    SET message = ?, details = ?
    WHERE id = ?
  `);
  for (const row of logRows) {
    const nextMessage = repairPossibleMojibake(row.message);
    const nextDetails = repairSerializedJson(row.details);
    if (nextMessage !== row.message || nextDetails !== row.details) {
      updateLog.run(nextMessage, nextDetails, row.id);
    }
  }

  const settingRows = db.prepare(`
    SELECT key, value
    FROM settings
  `).all();
  const updateSetting = db.prepare(`
    UPDATE settings
    SET value = ?, updated_at = ?
    WHERE key = ?
  `);
  for (const row of settingRows) {
    const nextValue = repairSerializedJson(row.value);
    if (nextValue !== row.value) {
      updateSetting.run(nextValue, new Date().toISOString(), row.key);
    }
  }
}

export function getSiteSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("site");
  return fromJson(row?.value, {});
}

export function deleteExpiredSessions(db, now = new Date().toISOString()) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}

export function createSession(db, session) {
  db.prepare(`
    INSERT INTO sessions (username, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    session.username,
    session.tokenHash,
    session.createdAt,
    session.expiresAt,
    session.lastSeenAt
  );
}

export function getSessionByTokenHash(db, tokenHash, now = new Date().toISOString()) {
  deleteExpiredSessions(db, now);
  return db.prepare(`
    SELECT id, username, token_hash, created_at, expires_at, last_seen_at
    FROM sessions
    WHERE token_hash = ? AND expires_at > ?
    LIMIT 1
  `).get(tokenHash, now);
}

export function touchSession(db, sessionId, lastSeenAt = new Date().toISOString()) {
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, sessionId);
}

export function deleteSessionByTokenHash(db, tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function mapAccount(row) {
  return {
    id: row.id,
    name: row.name,
    utilityType: row.utility_type,
    provider: row.provider,
    accountNo: row.account_no,
    loginName: row.login_name,
    loginMethod: row.login_method,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
    notes: row.notes,
    lastSyncedAt: row.last_synced_at,
    credentialConfigured: Boolean(row.has_credentials)
  };
}

export function listAccounts(db) {
  return db.prepare(`
    SELECT
      a.*,
      EXISTS (
        SELECT 1
        FROM account_secrets s
        WHERE s.account_id = a.id
      ) AS has_credentials
    FROM accounts a
    ORDER BY
      CASE utility_type
        WHEN 'electricity' THEN 1
        WHEN 'water' THEN 2
        ELSE 3
      END
  `).all().map(mapAccount);
}

export function getAccountById(db, accountId) {
  const row = db.prepare(`
    SELECT
      a.*,
      EXISTS (
        SELECT 1
        FROM account_secrets s
        WHERE s.account_id = a.id
      ) AS has_credentials
    FROM accounts a
    WHERE a.id = ?
    LIMIT 1
  `).get(accountId);
  return row ? mapAccount(row) : null;
}

export function createAccount(db, payload) {
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO accounts (
      name, utility_type, provider, account_no, login_name, login_method,
      status, is_primary, notes, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.name,
    payload.utilityType,
    payload.provider,
    payload.accountNo,
    payload.loginName || null,
    payload.loginMethod,
    payload.status || "active",
    payload.isPrimary ? 1 : 0,
    payload.notes || null,
    payload.lastSyncedAt || null,
    now,
    now
  );

  if (payload.credentials && Object.keys(payload.credentials).length) {
    upsertAccountSecrets(db, result.lastInsertRowid, payload.credentials);
  }

  return getAccountById(db, result.lastInsertRowid);
}

export function updateAccount(db, accountId, payload) {
  const existing = getAccountById(db, accountId);
  if (!existing) {
    return null;
  }

  db.prepare(`
    UPDATE accounts
    SET
      name = ?,
      utility_type = ?,
      provider = ?,
      account_no = ?,
      login_name = ?,
      login_method = ?,
      status = ?,
      is_primary = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    payload.name,
    payload.utilityType,
    payload.provider,
    payload.accountNo,
    payload.loginName || null,
    payload.loginMethod,
    payload.status || existing.status || "active",
    payload.isPrimary ? 1 : 0,
    payload.notes || null,
    nowIso(),
    accountId
  );

  if (payload.credentials) {
    if (Object.keys(payload.credentials).length) {
      upsertAccountSecrets(db, accountId, payload.credentials);
    } else if (payload.clearCredentials) {
      deleteAccountSecrets(db, accountId);
    }
  }

  return getAccountById(db, accountId);
}

export function deleteAccount(db, accountId) {
  const existing = getAccountById(db, accountId);
  if (!existing) {
    return null;
  }
  const refs = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bill_records WHERE account_id = ?) AS bill_count,
      (SELECT COUNT(*) FROM daily_records WHERE account_id = ?) AS daily_count
  `).get(accountId, accountId);

  if ((refs.bill_count || 0) > 0 || (refs.daily_count || 0) > 0) {
    const archivedNotes = [existing.notes, "已归档：保留历史账单，禁止硬删"].filter(Boolean).join(" | ");
    db.prepare(`
      UPDATE accounts
      SET status = 'disabled', notes = ?, updated_at = ?
      WHERE id = ?
    `).run(archivedNotes, nowIso(), accountId);
    return getAccountById(db, accountId);
  }

  deleteAccountSecrets(db, accountId);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  return existing;
}

export function upsertAccountSecrets(db, accountId, credentials) {
  const sanitized = sanitizeCredentialPayload(credentials);
  if (!Object.keys(sanitized).length) {
    return false;
  }

  db.prepare(`
    INSERT INTO account_secrets (account_id, credentials_ciphertext, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      credentials_ciphertext = excluded.credentials_ciphertext,
      updated_at = excluded.updated_at
  `).run(
    accountId,
    encryptSecretPayload(sanitized),
    nowIso()
  );

  return true;
}

export function deleteAccountSecrets(db, accountId) {
  db.prepare("DELETE FROM account_secrets WHERE account_id = ?").run(accountId);
}

export function getAccountCredentials(db, accountId) {
  const row = db.prepare(`
    SELECT credentials_ciphertext
    FROM account_secrets
    WHERE account_id = ?
    LIMIT 1
  `).get(accountId);
  return decryptSecretPayload(row?.credentials_ciphertext);
}

export function listAccountsByUtilityType(db, utilityType) {
  return listAccounts(db).filter((item) => item.utilityType === utilityType && item.status !== "disabled");
}

export function getJobByUtilityType(db, utilityType) {
  return db.prepare(`
    SELECT id, name, utility_type, schedule_time, enabled, last_run_at, last_status,
           next_run_at, retries, retry_interval_minutes, status_hint
    FROM sync_jobs
    WHERE utility_type = ?
    LIMIT 1
  `).get(utilityType);
}

export function updateJobRunState(db, utilityType, payload) {
  const current = getJobByUtilityType(db, utilityType);
  if (!current) {
    return null;
  }

  const hasRealExecution = payload.lastRunAt !== undefined;
  const retries = !hasRealExecution
    ? Number(current.retries || 0)
    : payload.status === "success"
      ? 0
      : Number(current.retries || 0) + 1;
  const nextRunAt = payload.nextRunAt || null;
  const lastRunAt = payload.lastRunAt === undefined ? current.last_run_at : payload.lastRunAt;
  const status = payload.status || current.last_status || "idle";
  const statusHint = payload.statusHint || current.status_hint;
  db.prepare(`
    UPDATE sync_jobs
    SET
      last_run_at = ?,
      last_status = ?,
      next_run_at = ?,
      retries = ?,
      status_hint = ?,
      updated_at = ?
    WHERE utility_type = ?
  `).run(
    lastRunAt,
    status,
    nextRunAt,
    retries,
    statusHint,
    nowIso(),
    utilityType
  );

  return getJobByUtilityType(db, utilityType);
}

export function recordCollectorRun(db, payload) {
  const startedAt = payload.startedAt || nowIso();
  const result = db.prepare(`
    INSERT INTO collector_runs (
      utility_type, account_id, provider, status, trigger_source, summary, details, started_at, finished_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.utilityType,
    payload.accountId || null,
    payload.provider || null,
    payload.status,
    payload.triggerSource || "manual",
    payload.summary || null,
    payload.details ? toJson(payload.details) : null,
    startedAt,
    payload.finishedAt || null,
    startedAt
  );

  return db.prepare("SELECT * FROM collector_runs WHERE id = ?").get(result.lastInsertRowid);
}

export function addSystemLog(db, payload) {
  db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    payload.level,
    payload.moduleName,
    payload.message,
    payload.details ? toJson(payload.details) : null,
    payload.createdAt || nowIso()
  );
}

export function updateAccountLastSyncedAt(db, accountId, lastSyncedAt = nowIso()) {
  db.prepare(`
    UPDATE accounts
    SET last_synced_at = ?, updated_at = ?
    WHERE id = ?
  `).run(lastSyncedAt, nowIso(), accountId);
}

export function listJobs(db) {
  return db.prepare(`
    SELECT id, name, utility_type, schedule_time, enabled, last_run_at, last_status,
           next_run_at, retries, retry_interval_minutes, status_hint
    FROM sync_jobs
    ORDER BY id
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    utilityType: row.utility_type,
    scheduleTime: row.schedule_time,
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    nextRunAt: row.next_run_at,
    retries: row.retries,
    retryIntervalMinutes: row.retry_interval_minutes,
    statusHint: row.status_hint
  }));
}

export function listPushLogs(db) {
  return db.prepare(`
    SELECT id, push_type, target, title, status, details, pushed_at
    FROM push_logs
    ORDER BY pushed_at DESC
  `).all().map((row) => ({
    id: row.id,
    pushType: row.push_type,
    target: row.target,
    title: row.title,
    status: row.status,
    details: row.details,
    pushedAt: row.pushed_at
  }));
}

export function listSystemLogs(db, limit = 20) {
  return db.prepare(`
    SELECT id, level, module_name, message, details, created_at
    FROM system_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    level: row.level,
    module: row.module_name,
    message: row.message,
    details: fromJson(row.details, row.details),
    createdAt: row.created_at
  }));
}

export function listBills(db, filters = {}) {
  let sql = `
    SELECT b.*, a.name AS account_name, a.provider
    FROM bill_records b
    JOIN accounts a ON a.id = b.account_id
    WHERE 1 = 1
  `;
  const params = [];
  if (filters.utilityType && filters.utilityType !== "all") {
    sql += " AND b.utility_type = ?";
    params.push(filters.utilityType);
  }
  if (filters.accountId) {
    sql += " AND b.account_id = ?";
    params.push(Number(filters.accountId));
  }
  if (filters.from) {
    sql += " AND date(b.statement_date) >= date(?)";
    params.push(filters.from);
  }
  if (filters.to) {
    sql += " AND date(b.statement_date) <= date(?)";
    params.push(filters.to);
  }
  sql += " ORDER BY date(b.statement_date) DESC, b.id DESC";

  return db.prepare(sql).all(...params).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    utilityType: row.utility_type,
    provider: row.provider,
    statementDate: row.statement_date,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    usageValue: row.usage_value,
    usageUnit: row.usage_unit,
    amount: row.amount,
    currency: row.currency,
    sourceChannel: row.source_channel,
    recordType: row.record_type,
    isEstimated: Boolean(row.is_estimated),
    status: row.status
  }));
}

function sumAmount(db, utilityType, from, to, source = "bill_records", dateColumn = "statement_date") {
  let sql = `SELECT COALESCE(SUM(amount), 0) AS amount FROM ${source} WHERE utility_type = ?`;
  const params = [utilityType];
  if (from) {
    sql += ` AND date(${dateColumn}) >= date(?)`;
    params.push(from);
  }
  if (to) {
    sql += ` AND date(${dateColumn}) <= date(?)`;
    params.push(to);
  }
  const row = db.prepare(sql).get(...params);
  return Number(row.amount || 0);
}

export function getOverview(db) {
  const now = new Date();
  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const electricityCurrent = sumAmount(db, "electricity", monthFrom, monthTo, "daily_records", "usage_date");
  const waterCurrent = sumAmount(db, "water", monthFrom, monthTo);
  const gasCurrent = sumAmount(db, "gas", monthFrom, monthTo);
  const total = electricityCurrent + waterCurrent + gasCurrent;

  const latestSync = db.prepare(`
    SELECT MAX(last_synced_at) AS last_synced_at
    FROM accounts
    WHERE last_synced_at IS NOT NULL
  `).get();

  const yesterday = db.prepare(`
    SELECT usage_date, usage_value, usage_unit, amount
    FROM daily_records
    WHERE utility_type = 'electricity'
    ORDER BY usage_date DESC
    LIMIT 1
  `).get();

  const latestWaterBill = db.prepare(`
    SELECT statement_date, amount, usage_value, usage_unit
    FROM bill_records
    WHERE utility_type = 'water'
    ORDER BY statement_date DESC
    LIMIT 1
  `).get();

  const latestGasBill = db.prepare(`
    SELECT statement_date, amount, status, record_type
    FROM bill_records
    WHERE utility_type = 'gas'
    ORDER BY statement_date DESC
    LIMIT 1
  `).get();

  const recentActivity = [
    {
      title: "燃气清单已更新",
      summary: "05-07 07:12 检测到新清单，金额 ¥34.20，等待补抓详细账单页。",
      type: "gas"
    },
    {
      title: "昨日电量生成成功",
      summary: "05-07 06:38 已写入日记录，昨日 12.8 kWh，日电费 ¥5.63。",
      type: "electricity"
    },
    {
      title: "企业微信日报已推送",
      summary: "05-07 08:00 推送到家庭通知应用，状态成功。",
      type: "push"
    }
  ];

  return {
    summary: {
      totalAmount: total,
      currency: "CNY",
      monthLabel: `${now.getUTCFullYear()}年${String(now.getUTCMonth() + 1)}月`,
      lastSyncedAt: latestSync?.last_synced_at || null
    },
    utilityCards: [
      {
        utilityType: "electricity",
        label: "电费",
        amount: electricityCurrent,
        usage: {
          value: 132.4,
          unit: "kWh"
        },
        detail: "昨日电量 12.8 kWh · 阶梯二档边缘"
      },
      {
        utilityType: "water",
        label: "水费",
        amount: waterCurrent,
        usage: {
          value: latestWaterBill?.usage_value ?? 8,
          unit: latestWaterBill?.usage_unit ?? "m³"
        },
        detail: "账单周期 04-01 至 04-30 · 暂无真实日曲线"
      },
      {
        utilityType: "gas",
        label: "燃气费",
        amount: gasCurrent,
        usage: {
          value: null,
          unit: null
        },
        detail: "最新清单已入库 · 账单型数据 · 支持周期统计"
      }
    ],
    highlights: {
      electricity: {
        amount: yesterday.amount,
        usageValue: yesterday.usage_value,
        usageUnit: yesterday.usage_unit,
        date: yesterday.usage_date
      },
      water: {
        message: latestWaterBill
          ? `最近账单 ¥${latestWaterBill.amount.toFixed(2)}，${latestWaterBill.usage_value}${latestWaterBill.usage_unit}`
          : "暂无新账单"
      },
      gas: {
        message: latestGasBill ? `发现新${latestGasBill.record_type === "statement" ? "清单" : "账单"} +¥${latestGasBill.amount.toFixed(2)}` : "暂无新账单"
      }
    },
    charts: {
      monthlyTrend: [
        { period: "1月", electricity: 148.8, water: 18.6, gas: 92.5 },
        { period: "2月", electricity: 153.2, water: 19.4, gas: 96.2 },
        { period: "3月", electricity: 168.9, water: 20.8, gas: 103.4 },
        { period: "4月", electricity: 168.2, water: 22.1, gas: 105.7 }
      ],
      composition: [
        { utilityType: "electricity", amount: electricityCurrent },
        { utilityType: "water", amount: waterCurrent },
        { utilityType: "gas", amount: gasCurrent }
      ]
    },
    recentActivity
  };
}

export function getAnalytics(db, filters = {}) {
  const utilityType = filters.utilityType && filters.utilityType !== "all" ? filters.utilityType : null;
  const rows = db.prepare(`
    SELECT utility_type, statement_date, amount, usage_value, usage_unit
    FROM bill_records
    ORDER BY statement_date
  `).all();

  const grouped = new Map();
  for (const row of rows) {
    if (utilityType && row.utility_type !== utilityType) {
      continue;
    }
    const period = row.statement_date.slice(0, 7);
    if (!grouped.has(period)) {
      grouped.set(period, {
        period,
        electricity: 0,
        water: 0,
        gas: 0,
        total: 0
      });
    }
    const item = grouped.get(period);
    item[row.utility_type] += Number(row.amount);
    item.total += Number(row.amount);
  }

  const data = [...grouped.values()];
  const latest = data[data.length - 1] || { total: 0 };
  const previous = data[data.length - 2] || { total: 0 };
  const changeAmount = latest.total - previous.total;
  const changeRate = previous.total ? (changeAmount / previous.total) * 100 : 0;

  return {
    utilityType: utilityType || "all",
    granularity: filters.granularity || "month",
    points: data,
    comparison: {
      latestTotal: Number(latest.total.toFixed(2)),
      previousTotal: Number(previous.total.toFixed(2)),
      changeAmount: Number(changeAmount.toFixed(2)),
      changeRate: Number(changeRate.toFixed(1))
    },
    notes: [
      "电力支持真实日数据，分析页可扩展到日视图。",
      "水和燃当前默认按账单周期汇总，不伪装为真实日账单。"
    ]
  };
}

export function getAdminSummary(db) {
  const accounts = listAccounts(db);
  const jobs = listJobs(db);
  const pushLogs = listPushLogs(db);
  const logs = listSystemLogs(db, 10);
  const wecom = fromJson(db.prepare("SELECT value FROM settings WHERE key = ?").get("wecom")?.value, {});
  const statistics = fromJson(db.prepare("SELECT value FROM settings WHERE key = ?").get("statistics")?.value, {});

  return {
    metrics: {
      jobRunsToday: 6,
      accountCount: accounts.length,
      pushCount: pushLogs.length ? 12 : 0,
      rawRecordCount: 428,
      healthScore: 98.2
    },
    accounts,
    jobs,
    health: [
      { name: "API 服务", status: "ok" },
      { name: "数据库连接", status: "ok" },
      { name: "Playwright 浏览器池", status: "ok" },
      { name: "企业微信 Token", status: "ok" },
      { name: "燃气补抓任务", status: "error" }
    ],
    wecom,
    statistics,
    logs
  };
}

export function toggleAccountStatus(db, accountId) {
  const row = db.prepare("SELECT status FROM accounts WHERE id = ?").get(accountId);
  if (!row) {
    return null;
  }
  const nextStatus = row.status === "disabled" ? "active" : "disabled";
  db.prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?").run(nextStatus, nowIso(), accountId);
  return getAccountById(db, accountId);
}

export function runJob(db, utilityType) {
  const now = nowIso();
  db.prepare(`
    UPDATE sync_jobs
    SET last_run_at = ?, last_status = ?, status_hint = ?, updated_at = ?
    WHERE utility_type = ?
  `).run(now, "manual", "尚未接入自动采集器，请先手工录入或实现对应 provider connector", now, utilityType);
  db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("warning", `${utilityType}-collector`, "收到手动触发任务请求，但当前尚未接入真实自动采集器", toJson({ source: "admin-action" }), now);
  return db.prepare("SELECT * FROM sync_jobs WHERE utility_type = ?").get(utilityType);
}

export function createBillRecord(db, payload) {
  const account = getAccountById(db, payload.accountId);
  if (!account) {
    return null;
  }

  const createdAt = nowIso();
  const recordType = payload.recordType || "bill";
  const status = payload.status || "confirmed";
  const sourceChannel = payload.sourceChannel || "manual";
  const result = db.prepare(`
    INSERT INTO bill_records (
      account_id, utility_type, statement_date, period_start, period_end, usage_value,
      usage_unit, amount, currency, source_channel, record_type, is_estimated, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.accountId,
    account.utilityType,
    payload.statementDate,
    payload.periodStart || null,
    payload.periodEnd || null,
    payload.usageValue ?? null,
    payload.usageUnit || null,
    payload.amount,
    payload.currency || "CNY",
    sourceChannel,
    recordType,
    payload.isEstimated ? 1 : 0,
    status,
    createdAt
  );

  db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "info",
    `${account.utilityType}-manual-import`,
    "管理员手工录入了一条账单记录",
    toJson({
      accountId: payload.accountId,
      statementDate: payload.statementDate,
      amount: payload.amount,
      sourceChannel
    }),
    createdAt
  );

  return db.prepare(`
    SELECT b.*, a.name AS account_name, a.provider
    FROM bill_records b
    JOIN accounts a ON a.id = b.account_id
    WHERE b.id = ?
    LIMIT 1
  `).get(result.lastInsertRowid);
}

export function upsertCollectedBillRecord(db, payload) {
  const account = getAccountById(db, payload.accountId);
  if (!account) {
    return null;
  }

  const statementDate = String(payload.statementDate || "").trim();
  if (!statementDate) {
    throw new Error("statementDate is required for collected bills");
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount)) {
    throw new Error("amount must be a finite number for collected bills");
  }

  const recordType = payload.recordType || "bill";
  const sourceChannel = payload.sourceChannel || account.provider || "collector";
  const existing = db.prepare(`
    SELECT b.*, a.name AS account_name, a.provider
    FROM bill_records b
    JOIN accounts a ON a.id = b.account_id
    WHERE b.account_id = ?
      AND b.statement_date = ?
      AND IFNULL(b.period_start, '') = IFNULL(?, '')
      AND IFNULL(b.period_end, '') = IFNULL(?, '')
      AND IFNULL(b.usage_unit, '') = IFNULL(?, '')
      AND IFNULL(b.record_type, '') = IFNULL(?, '')
      AND IFNULL(b.source_channel, '') = IFNULL(?, '')
      AND ABS(IFNULL(b.amount, 0) - ?) < 0.000001
    ORDER BY b.id DESC
    LIMIT 1
  `).get(
    payload.accountId,
    statementDate,
    payload.periodStart || null,
    payload.periodEnd || null,
    payload.usageUnit || null,
    recordType,
    sourceChannel,
    amount
  );

  if (existing) {
    return {
      inserted: false,
      item: existing
    };
  }

  const item = createBillRecord(db, {
    accountId: payload.accountId,
    statementDate,
    periodStart: payload.periodStart || null,
    periodEnd: payload.periodEnd || null,
    usageValue: payload.usageValue ?? null,
    usageUnit: payload.usageUnit || null,
    amount,
    currency: payload.currency || "CNY",
    sourceChannel,
    recordType,
    status: payload.status || "confirmed",
    isEstimated: Boolean(payload.isEstimated)
  });

  return {
    inserted: true,
    item
  };
}

export function upsertCollectedDailyRecord(db, payload) {
  const account = getAccountById(db, payload.accountId);
  if (!account) {
    return null;
  }

  const usageDate = String(payload.usageDate || "").trim();
  if (!usageDate) {
    throw new Error("usageDate is required for collected daily records");
  }

  const usageValue = payload.usageValue === null || payload.usageValue === undefined || payload.usageValue === ""
    ? null
    : Number(payload.usageValue);
  const amount = payload.amount === null || payload.amount === undefined || payload.amount === ""
    ? null
    : Number(payload.amount);

  if (usageValue !== null && !Number.isFinite(usageValue)) {
    throw new Error("usageValue must be a finite number for collected daily records");
  }
  if (amount !== null && !Number.isFinite(amount)) {
    throw new Error("amount must be a finite number for collected daily records");
  }

  const sourceChannel = payload.sourceChannel || account.provider || "collector";
  const usageUnit = payload.usageUnit || null;
  const existing = db.prepare(`
    SELECT *
    FROM daily_records
    WHERE account_id = ?
      AND usage_date = ?
      AND IFNULL(usage_unit, '') = IFNULL(?, '')
      AND IFNULL(source_channel, '') = IFNULL(?, '')
    ORDER BY id DESC
    LIMIT 1
  `).get(
    payload.accountId,
    usageDate,
    usageUnit,
    sourceChannel
  );

  const createdAt = nowIso();
  if (existing) {
    db.prepare(`
      UPDATE daily_records
      SET
        usage_value = ?,
        amount = ?,
        currency = ?,
        is_estimated = ?
      WHERE id = ?
    `).run(
      usageValue,
      amount,
      payload.currency || "CNY",
      payload.isEstimated ? 1 : 0,
      existing.id
    );

    return {
      inserted: false,
      item: db.prepare("SELECT * FROM daily_records WHERE id = ? LIMIT 1").get(existing.id)
    };
  }

  const result = db.prepare(`
    INSERT INTO daily_records (
      account_id, utility_type, usage_date, usage_value, usage_unit, amount, currency,
      source_channel, is_estimated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.accountId,
    account.utilityType,
    usageDate,
    usageValue,
    usageUnit,
    amount,
    payload.currency || "CNY",
    sourceChannel,
    payload.isEstimated ? 1 : 0,
    createdAt
  );

  return {
    inserted: true,
    item: db.prepare("SELECT * FROM daily_records WHERE id = ? LIMIT 1").get(result.lastInsertRowid)
  };
}
