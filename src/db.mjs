import fs from "node:fs";
import path from "node:path";
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
    "å®¶éä¸»çµè¡¨",
    "electricity",
    "ç½ä¸å½ç½",
    "330100009845",
    "138****0001",
    "å¯ç  + ç­ä¿¡",
    "active",
    1,
    "æµæ±å±æ°æ·",
    iso("2026-05-07T07:36:00+08:00"),
    now,
    now
  );
  insertAccount.run(
    "å®¶éæ°´å¡è´¦æ·",
    "water",
    "æ­æ°´ç½ä¸å",
    "HZW2208411",
    "139****1002",
    "è´¦å·å¯ç ",
    "active",
    1,
    "è´¦åå¨æåæ°æ®",
    iso("2026-05-07T07:02:00+08:00"),
    now,
    now
  );
  insertAccount.run(
    "å®¶éçæ°è´¦æ·",
    "gas",
    "19æå¡å / æ­çç ",
    "GAS8841220",
    "å¬ä¼å·è¾å©ç»å½",
    "å¬ä¼å·è¾å©",
    "attention",
    1,
    "å¤é´è¡¥æå¤±è´¥ 1 æ¬¡",
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
    "çµåæ¥éé",
    "electricity",
    "06:30",
    1,
    iso("2026-05-07T06:38:00+08:00"),
    "success",
    iso("2026-05-08T06:30:00+08:00"),
    0,
    10,
    "æ¨æ¥çµéå·²çæ",
    now,
    now
  );
  insertJob.run(
    "æ°´å¡è´¦åéé",
    "water",
    "07:00",
    1,
    iso("2026-05-07T07:02:00+08:00"),
    "success",
    iso("2026-05-08T07:00:00+08:00"),
    0,
    10,
    "æ¬è½®æ æ°å¢è´¦å",
    now,
    now
  );
  insertJob.run(
    "çæ°æ¸åéé",
    "gas",
    "07:30",
    1,
    iso("2026-05-07T07:12:00+08:00"),
    "warning",
    iso("2026-05-07T22:00:00+08:00"),
    1,
    15,
    "è¡¥æè¯¦ç»é¡µå¤±è´¥ï¼å¾å¤é´éè¯",
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
      "ç½ä¸å½ç½",
      "bill",
      0,
      "confirmed",
      now
    );
  }

  const waterMonth = [
    ["2026-01-31", "2026-01-01", "2026-01-31", 7, "mÂ³", 18.6],
    ["2026-02-28", "2026-02-01", "2026-02-28", 7.2, "mÂ³", 19.4],
    ["2026-03-31", "2026-03-01", "2026-03-31", 7.8, "mÂ³", 20.8],
    ["2026-04-30", "2026-04-01", "2026-04-30", 8, "mÂ³", 22.1]
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
      "æ­æ°´ç½ä¸å",
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
      "19æå¡å",
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
      "ç½ä¸å½ç½",
      0,
      now
    );
  }

  const insertPush = db.prepare(`
    INSERT INTO push_logs (push_type, target, title, status, details, pushed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertPush.run("daily", "å®¶åº­éç¥åºç¨", "05-07 æ¥æ¥", "success", "çµåæ¥æ¥ä¸çæ°æéå·²æ¨é", iso("2026-05-07T08:00:00+08:00"));
  insertPush.run("alert", "å®¶åº­éç¥åºç¨", "çæ°è¡¥æåè­¦", "success", "å·²éç¥å¤é´è¡¥æå¤±è´¥", iso("2026-05-07T08:16:00+08:00"));

  const insertLog = db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertLog.run("error", "gas-collector", "19 æå¡åè¡¥æå¤±è´¥ï¼é¡µé¢äºæ¬¡è·³è½¬è¶æ¶", toJson({ retryPlannedAt: "2026-05-07T22:00:00+08:00" }), iso("2026-05-07T08:16:00+08:00"));
  insertLog.run("info", "notifier", "æ¥æ¥æ¨éè³å®¶åº­éç¥åºç¨æå", toJson({ pushType: "daily" }), iso("2026-05-07T08:00:00+08:00"));
  insertLog.run("info", "electricity-collector", "æ¨æ¥çµéåæ¥çµè´¹å·²åå¥ daily_records", toJson({ usageDate: "2026-05-06" }), iso("2026-05-07T07:36:00+08:00"));

  const settings = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  settings.run("site", toJson({ title: "å®¶ç¨è½èè´¦æ¬", timezone: "Asia/Shanghai" }), now);
  settings.run("wecom", toJson({
    corpId: "ww9c8f2a******",
    agentId: "1000012",
    enabled: true,
    dailyPushTime: "08:00",
    monthlyPushTime: "01 09:00",
    recipients: ["å®¶åº­éç¥åºç¨"]
  }), now);
  settings.run("statistics", toJson({
    defaultGranularity: "month",
    waterGasStrategy: "billing-period-only",
    estimationEnabled: false,
    includeEstimatedInTotal: false
  }), now);
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
    lastSyncedAt: row.last_synced_at
  };
}

export function listAccounts(db) {
  return db.prepare(`
    SELECT *
    FROM accounts
    ORDER BY
      CASE utility_type
        WHEN 'electricity' THEN 1
        WHEN 'water' THEN 2
        ELSE 3
      END
  `).all().map(mapAccount);
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
  const thisMonthFrom = "2026-05-01";
  const thisMonthTo = "2026-05-31";

  const electricityCurrent = sumAmount(db, "electricity", thisMonthFrom, thisMonthTo);
  const waterCurrent = sumAmount(db, "water", "2026-04-01", "2026-04-30");
  const gasCurrent = sumAmount(db, "gas", "2026-04-08", "2026-05-07");
  const total = electricityCurrent + waterCurrent + gasCurrent;

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
      title: "çæ°æ¸åå·²æ´æ°",
      summary: "05-07 07:12 æ£æµå°æ°æ¸åï¼éé¢ Â¥34.20ï¼ç­å¾è¡¥æè¯¦ç»è´¦åé¡µã",
      type: "gas"
    },
    {
      title: "æ¨æ¥çµéçææå",
      summary: "05-07 06:38 å·²åå¥æ¥è®°å½ï¼æ¨æ¥ 12.8 kWhï¼æ¥çµè´¹ Â¥5.63ã",
      type: "electricity"
    },
    {
      title: "ä¼ä¸å¾®ä¿¡æ¥æ¥å·²æ¨é",
      summary: "05-07 08:00 æ¨éå°å®¶åº­éç¥åºç¨ï¼ç¶ææåã",
      type: "push"
    }
  ];

  return {
    summary: {
      totalAmount: total,
      currency: "CNY",
      monthLabel: "2026å¹´5æ",
      lastSyncedAt: "2026-05-07T07:36:00+08:00"
    },
    utilityCards: [
      {
        utilityType: "electricity",
        label: "çµè´¹",
        amount: electricityCurrent,
        usage: {
          value: 132.4,
          unit: "kWh"
        },
        detail: "æ¨æ¥çµé 12.8 kWh Â· é¶æ¢¯äºæ¡£è¾¹ç¼"
      },
      {
        utilityType: "water",
        label: "æ°´è´¹",
        amount: waterCurrent,
        usage: {
          value: latestWaterBill?.usage_value ?? 8,
          unit: latestWaterBill?.usage_unit ?? "mÂ³"
        },
        detail: "è´¦åå¨æ 04-01 è³ 04-30 Â· ææ çå®æ¥æ²çº¿"
      },
      {
        utilityType: "gas",
        label: "çæ°è´¹",
        amount: gasCurrent,
        usage: {
          value: null,
          unit: null
        },
        detail: "ææ°æ¸åå·²å¥åº Â· è´¦ååæ°æ® Â· æ¯æå¨æç»è®¡"
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
          ? `æè¿è´¦å Â¥${latestWaterBill.amount.toFixed(2)}ï¼${latestWaterBill.usage_value}${latestWaterBill.usage_unit}`
          : "ææ æ°è´¦å"
      },
      gas: {
        message: latestGasBill ? `åç°æ°${latestGasBill.record_type === "statement" ? "æ¸å" : "è´¦å"} +Â¥${latestGasBill.amount.toFixed(2)}` : "ææ æ°è´¦å"
      }
    },
    charts: {
      monthlyTrend: [
        { period: "1æ", electricity: 148.8, water: 18.6, gas: 92.5 },
        { period: "2æ", electricity: 153.2, water: 19.4, gas: 96.2 },
        { period: "3æ", electricity: 168.9, water: 20.8, gas: 103.4 },
        { period: "4æ", electricity: 168.2, water: 22.1, gas: 105.7 }
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
      "çµåæ¯æçå®æ¥æ°æ®ï¼åæé¡µå¯æ©å±å°æ¥è§å¾ã",
      "æ°´åçå½åé»è®¤æè´¦åå¨ææ±æ»ï¼ä¸ä¼ªè£ä¸ºçå®æ¥è´¦åã"
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
      { name: "API æå¡", status: "ok" },
      { name: "æ°æ®åºè¿æ¥", status: "ok" },
      { name: "Playwright æµè§å¨æ± ", status: "ok" },
      { name: "ä¼ä¸å¾®ä¿¡ Token", status: "ok" },
      { name: "çæ°è¡¥æä»»å¡", status: "error" }
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
  db.prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?").run(nextStatus, new Date().toISOString(), accountId);
  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
}

export function runJob(db, utilityType) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sync_jobs
    SET last_run_at = ?, last_status = ?, status_hint = ?, updated_at = ?
    WHERE utility_type = ?
  `).run(now, "success", "å·²æå¨è§¦åå¹¶æ¨¡ææå", now, utilityType);
  db.prepare(`
    INSERT INTO system_logs (level, module_name, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("info", `${utilityType}-collector`, "æ¶å°æå¨è§¦åä»»å¡è¯·æ±", toJson({ source: "admin-action" }), now);
  return db.prepare("SELECT * FROM sync_jobs WHERE utility_type = ?").get(utilityType);
}
