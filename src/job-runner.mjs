import {
  listAccountsByUtilityType,
  getAccountCredentials,
  getJobByUtilityType,
  updateJobRunState,
  recordCollectorRun,
  addSystemLog,
  updateAccountLastSyncedAt,
  upsertCollectedBillRecord,
  upsertCollectedDailyRecord
} from "./db.mjs";
import { collectAccountBills, testAccountConnection } from "./collectors.mjs";

function now() {
  return new Date();
}

function nowIso() {
  return now().toISOString();
}

function computeNextRunAt(scheduleTime, reference = now()) {
  const [hourText, minuteText] = String(scheduleTime || "00:00").split(":");
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  const next = new Date(reference);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next <= reference) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

async function executeForAccount(db, account, triggerSource) {
  const startedAt = nowIso();
  const credentials = getAccountCredentials(db, account.id);
  const details = await collectAccountBills(account, credentials);
  const stored = {
    inserted: 0,
    skipped: 0,
    dailyInserted: 0,
    dailyUpdated: 0
  };

  if (Array.isArray(details?.bills)) {
    for (const bill of details.bills) {
      const result = upsertCollectedBillRecord(db, {
        ...bill,
        accountId: account.id
      });
      if (result?.inserted) {
        stored.inserted += 1;
      } else if (result) {
        stored.skipped += 1;
      }
    }
  }

  if (Array.isArray(details?.details?.recentDailyUsage)) {
    for (const dailyItem of details.details.recentDailyUsage) {
      const result = upsertCollectedDailyRecord(db, {
        ...dailyItem,
        accountId: account.id
      });
      if (result?.inserted) {
        stored.dailyInserted += 1;
      } else if (result) {
        stored.dailyUpdated += 1;
      }
    }
  }

  const hasStoredChanges = stored.inserted || stored.skipped || stored.dailyInserted || stored.dailyUpdated;
  const runSummary = hasStoredChanges
    ? `${details.summary}; inserted ${stored.inserted}, skipped ${stored.skipped}, daily inserted ${stored.dailyInserted}, daily updated ${stored.dailyUpdated}`
    : details.summary;
  const runDetails = {
    ...(details.details || {}),
    stored
  };

  recordCollectorRun(db, {
    utilityType: account.utilityType,
    accountId: account.id,
    provider: account.provider,
    status: details.ok ? "success" : "warning",
    triggerSource,
    summary: runSummary,
    details: runDetails,
    startedAt,
    finishedAt: nowIso()
  });
  updateAccountLastSyncedAt(db, account.id);
  addSystemLog(db, {
    level: details.ok ? "info" : "warning",
    moduleName: `${account.utilityType}-collector`,
    message: runSummary,
    details: runDetails
  });
}

export async function runCollectionJob(db, utilityType, triggerSource = "manual") {
  const job = getJobByUtilityType(db, utilityType);
  if (!job) {
    throw new Error(`No sync job found for ${utilityType}`);
  }
  if (!job.enabled) {
    throw new Error(`Sync job for ${utilityType} is disabled`);
  }

  const accounts = listAccountsByUtilityType(db, utilityType);
  if (!accounts.length) {
    const statusHint = "没有可执行的启用账户";
    updateJobRunState(db, utilityType, {
      status: "warning",
      statusHint,
      lastRunAt: nowIso(),
      nextRunAt: computeNextRunAt(job.schedule_time)
    });
    addSystemLog(db, {
      level: "warning",
      moduleName: `${utilityType}-collector`,
      message: statusHint,
      details: { triggerSource }
    });
    return { ok: false, status: "warning", summary: statusHint };
  }

  try {
    for (const account of accounts) {
      await executeForAccount(db, account, triggerSource);
    }

    const statusHint = `${utilityType} 自动采集执行完成`;
    updateJobRunState(db, utilityType, {
      status: "success",
      statusHint,
      lastRunAt: nowIso(),
      nextRunAt: computeNextRunAt(job.schedule_time)
    });

    return { ok: true, status: "success", summary: statusHint };
  } catch (error) {
    const statusHint = error.message || `${utilityType} 自动采集失败`;
    recordCollectorRun(db, {
      utilityType,
      status: "error",
      triggerSource,
      summary: statusHint,
      details: { utilityType },
      startedAt: nowIso(),
      finishedAt: nowIso()
    });
    updateJobRunState(db, utilityType, {
      status: "error",
      statusHint,
      lastRunAt: nowIso(),
      nextRunAt: computeNextRunAt(job.schedule_time)
    });
    addSystemLog(db, {
      level: "error",
      moduleName: `${utilityType}-collector`,
      message: statusHint,
      details: { triggerSource }
    });
    return { ok: false, status: "error", summary: statusHint };
  }
}

export async function testCollectionConnection(db, account) {
  const credentials = getAccountCredentials(db, account.id);
  return testAccountConnection(account, credentials);
}

export function startCollectionScheduler(db) {
  const enabled = String(process.env.AUTO_COLLECT_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    return { stop() {} };
  }

  const tickMs = Math.max(15000, Number(process.env.COLLECTOR_TICK_MS || 60000));
  const timer = setInterval(async () => {
    const jobs = ["electricity", "water", "gas"];
    for (const utilityType of jobs) {
      const job = getJobByUtilityType(db, utilityType);
      if (!job || !job.enabled) {
        continue;
      }
      if (!job.next_run_at) {
        updateJobRunState(db, utilityType, {
          status: job.last_status || "idle",
          statusHint: job.status_hint || "已初始化下次执行时间",
          lastRunAt: job.last_run_at || null,
          nextRunAt: computeNextRunAt(job.schedule_time)
        });
        continue;
      }
      if (new Date(job.next_run_at) <= now()) {
        await runCollectionJob(db, utilityType, "scheduler");
      }
    }
  }, tickMs);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}
