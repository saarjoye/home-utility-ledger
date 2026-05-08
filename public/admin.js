import { getImportPreset, parseImportPayload } from "./admin-import-helper.js";

const state = {
  user: null,
  runtime: {},
  summary: {},
  providers: [],
  accounts: [],
  editingAccount: null
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    renderFatal(error.message || "后台加载失败");
  });
});

async function init() {
  bindNavigation();
  bindPageActions();
  await loadPage();
  resetAccountForm();
  resetBillForm();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("未登录或登录已失效");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage = payload?.errors?.join("；") || payload?.error || `${url} returned ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

async function loadPage() {
  const [me, health, summary, providers, accounts] = await Promise.all([
    fetchJson("/api/auth/me"),
    fetchJson("/api/health"),
    fetchJson("/api/admin/summary"),
    fetchJson("/api/admin/providers"),
    fetchJson("/api/admin/accounts")
  ]);

  state.user = me.user || null;
  state.runtime = health.runtime || {};
  state.summary = summary || {};
  state.providers = safeArray(providers.items);
  state.accounts = safeArray(accounts.items);

  renderHeader();
  renderHero();
  renderMetrics();
  renderPending();
  renderHealth();
  renderAccounts();
  renderJobs();
  renderSettings();
  renderLogs();
  populateBillAccountOptions();

  if (state.editingAccount?.id) {
    const freshAccount = state.accounts.find((item) => String(item.id) === String(state.editingAccount.id));
    if (freshAccount) {
      fillAccountForm(freshAccount, { preserveFeedback: true });
    }
  } else {
    syncProviderOptions(undefined, undefined, readCredentialDraft());
  }
}

function renderFatal(message) {
  setText("heroTitle", "后台加载失败");
  setText("heroDescription", message);
  document.getElementById("metricGrid").innerHTML = `<div class="alert-box">${escapeHtml(message)}</div>`;
}

function renderHeader() {
  setText("currentUserChip", `当前用户：${state.user?.username || "--"}`);
  setText("runtimeChip", `运行环境：${state.runtime.environment || "production"} / ${state.runtime.node || "node"}`);
}

function renderHero() {
  const pendingCount = safeArray(state.summary.pending).length;
  setText("heroTitle", "家庭水电燃账单后台");
  setText("heroDescription", "在这里配置采集账号、测试连接、触发同步，并查看账单与运行日志。");
  setText("pendingCountValue", String(pendingCount));
  setText("pendingCountHint", pendingCount ? "存在需要人工关注的项目" : "当前没有待处理异常");
  setText("healthScoreValue", deriveHealthScore());
  setText("healthScoreHint", "采集链路与后台运行状态");
}

function renderMetrics() {
  const metrics = [
    {
      label: "已配置账号",
      value: String(state.accounts.length),
      hint: "水、电、燃账号总数"
    },
    {
      label: "已配置凭据",
      value: String(state.accounts.filter((item) => item.credentialConfigured).length),
      hint: "已加密保存 CK / Token / 会话信息"
    },
    {
      label: "活跃任务",
      value: String(safeArray(state.summary.jobs).filter((item) => String(item.lastStatus || "").toLowerCase() !== "disabled").length),
      hint: "可手动触发或自动执行"
    },
    {
      label: "待处理项",
      value: String(safeArray(state.summary.pending).length),
      hint: "需要复核或补充配置"
    }
  ];

  document.getElementById("metricGrid").innerHTML = metrics.map((item) => `
    <article class="metric-card">
      <span class="metric-label">${escapeHtml(item.label)}</span>
      <strong class="metric-value">${escapeHtml(item.value)}</strong>
      <p class="metric-hint">${escapeHtml(item.hint)}</p>
    </article>
  `).join("");
}

function renderPending() {
  const container = document.getElementById("pendingList");
  const items = safeArray(state.summary.pending);
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">当前没有待处理事项</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="stack-item">
      <div class="stack-item-main">
        <div class="stack-item-title">${escapeHtml(item.title || "--")}</div>
        <div class="stack-item-subtitle">建议检查最近一次采集结果、登录态或账号配置。</div>
      </div>
      <div class="stack-item-actions">
        <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || "--")}</span>
      </div>
    </div>
  `).join("");
}

function renderHealth() {
  const container = document.getElementById("healthList");
  const items = safeArray(state.summary.health);
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">暂无系统健康检查数据</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="stack-item">
      <div class="stack-item-main">
        <div class="stack-item-title">${escapeHtml(item.name || "--")}</div>
        <div class="stack-item-subtitle">后台健康检查结果</div>
      </div>
      <div class="stack-item-actions">
        <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || "--")}</span>
      </div>
    </div>
  `).join("");
}

function renderAccounts() {
  const container = document.getElementById("accountList");
  if (!state.accounts.length) {
    container.innerHTML = `<div class="empty-state">还没有配置任何账号</div>`;
    return;
  }

  container.innerHTML = state.accounts.map((item) => `
    <div class="stack-item">
      <div class="stack-item-main">
        <div class="stack-item-title">${escapeHtml(item.name || "--")} / ${escapeHtml(utilityLabel(item.utilityType))}</div>
        <div class="stack-item-subtitle">
          服务商：${escapeHtml(item.provider || "--")} / 标识：${escapeHtml(item.accountNo || "--")} / 接入方式：${escapeHtml(item.loginMethod || "--")}
        </div>
        <div class="stack-item-subtitle">
          凭据：${item.credentialConfigured ? "已配置" : "未配置"} / 最近同步：${escapeHtml(item.lastSyncedAt || "--")}
        </div>
      </div>
      <div class="stack-item-actions">
        <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || "--")}</span>
        <button class="btn btn-primary" data-test-account="${escapeHtml(String(item.id))}" type="button">测试</button>
        <button class="btn btn-secondary" data-edit-account="${escapeHtml(String(item.id))}" type="button">编辑</button>
        <button class="btn btn-ghost" data-toggle-account="${escapeHtml(String(item.id))}" type="button">
          ${item.status === "disabled" ? "启用" : "停用"}
        </button>
        <button class="btn btn-ghost" data-delete-account="${escapeHtml(String(item.id))}" type="button">归档 / 删除</button>
      </div>
    </div>
  `).join("");
}

function renderJobs() {
  const container = document.getElementById("jobList");
  const items = safeArray(state.summary.jobs);
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">暂无采集任务</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="stack-item">
      <div class="stack-item-main">
        <div class="stack-item-title">${escapeHtml(item.name || "--")}</div>
        <div class="stack-item-subtitle">
          类型：${escapeHtml(utilityLabel(item.utilityType))} / 定时：${escapeHtml(item.scheduleTime || "--")} / 上次运行：${escapeHtml(item.lastRunAt || "--")}
        </div>
        <div class="stack-item-subtitle">${escapeHtml(item.statusHint || "暂无任务说明")}</div>
      </div>
      <div class="stack-item-actions">
        <span class="status-badge ${statusClass(item.lastStatus)}">${escapeHtml(item.lastStatus || "--")}</span>
        <button class="btn btn-primary" data-run-job="${escapeHtml(item.utilityType || "")}" type="button">立即执行</button>
      </div>
    </div>
  `).join("");
}

function renderSettings() {
  const wecom = state.summary.settings?.wecom || {};
  const statistics = state.summary.settings?.statistics || {};
  const items = [
    { label: "企业微信 CorpID", value: wecom.corpId || "--" },
    { label: "企业微信 AgentID", value: wecom.agentId || "--" },
    { label: "每日推送时间", value: wecom.dailyPushTime || "--" },
    { label: "每月推送时间", value: wecom.monthlyPushTime || "--" },
    { label: "接收对象", value: safeArray(wecom.recipients).join(", ") || "--" },
    { label: "默认统计粒度", value: statistics.defaultGranularity || "--" },
    { label: "水燃统计策略", value: statistics.waterGasStrategy || "--" },
    { label: "估算开关", value: statistics.estimationEnabled ? "开启" : "关闭" }
  ];

  document.getElementById("settingsGrid").innerHTML = items.map((item) => `
    <article class="setting-card">
      <div class="setting-label">${escapeHtml(item.label)}</div>
      <div class="setting-value">${escapeHtml(String(item.value))}</div>
    </article>
  `).join("");
}

function renderLogs() {
  const tbody = document.getElementById("logTableBody");
  const items = safeArray(state.summary.logs);
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">暂无运行日志</div></td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.createdAt || "--")}</td>
      <td>${escapeHtml(item.module || "--")}</td>
      <td><span class="status-badge ${statusClass(item.level)}">${escapeHtml(item.level || "--")}</span></td>
      <td>${escapeHtml(item.message || "--")}</td>
    </tr>
  `).join("");
}

function bindPageActions() {
  document.getElementById("refreshPageButton")?.addEventListener("click", reloadPageData);
  document.getElementById("logoutButton")?.addEventListener("click", logout);
  document.getElementById("createAccountButton")?.addEventListener("click", () => {
    resetAccountForm();
    scrollToSection("accounts");
  });
  document.getElementById("resetAccountFormButton")?.addEventListener("click", resetAccountForm);
  document.getElementById("testAccountButton")?.addEventListener("click", testCurrentAccount);
  document.getElementById("cancelEditAccountButton")?.addEventListener("click", resetAccountForm);
  document.getElementById("resetBillFormButton")?.addEventListener("click", resetBillForm);
  document.getElementById("copyImportSnippetButton")?.addEventListener("click", copyImportSnippetForCurrentProvider);
  document.getElementById("applyImportPayloadButton")?.addEventListener("click", applyImportPayloadForCurrentProvider);
  document.getElementById("clearImportPayloadButton")?.addEventListener("click", clearImportPayload);

  document.getElementById("utilityTypeInput")?.addEventListener("change", () => {
    syncProviderOptions(undefined, undefined, readCredentialDraft());
  });

  document.getElementById("providerInput")?.addEventListener("change", () => {
    syncLoginMethods(undefined, readCredentialDraft());
  });

  document.getElementById("accountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAccountForm();
  });

  document.getElementById("billForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitBillForm();
  });

  document.addEventListener("click", async (event) => {
    const runButton = event.target.closest("[data-run-job]");
    if (runButton) {
      runButton.disabled = true;
      try {
        await fetchJson("/api/admin/run-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utilityType: runButton.getAttribute("data-run-job") })
        });
        await reloadPageData();
      } catch (error) {
        window.alert(error.message || "执行任务失败");
      } finally {
        runButton.disabled = false;
      }
    }

    const toggleButton = event.target.closest("[data-toggle-account]");
    if (toggleButton) {
      toggleButton.disabled = true;
      try {
        await fetchJson(`/api/admin/accounts/${toggleButton.getAttribute("data-toggle-account")}/toggle`, {
          method: "POST"
        });
        await reloadPageData();
      } catch (error) {
        window.alert(error.message || "切换状态失败");
      } finally {
        toggleButton.disabled = false;
      }
    }

    const editButton = event.target.closest("[data-edit-account]");
    if (editButton) {
      editButton.disabled = true;
      try {
        await loadAccountIntoForm(editButton.getAttribute("data-edit-account"));
        scrollToSection("accounts");
      } finally {
        editButton.disabled = false;
      }
    }

    const testButton = event.target.closest("[data-test-account]");
    if (testButton) {
      testButton.disabled = true;
      try {
        await loadAccountIntoForm(testButton.getAttribute("data-test-account"));
        scrollToSection("accounts");
        await testCurrentAccount();
      } finally {
        testButton.disabled = false;
      }
    }

    const deleteButton = event.target.closest("[data-delete-account]");
    if (deleteButton) {
      const accountId = deleteButton.getAttribute("data-delete-account");
      const account = state.accounts.find((item) => String(item.id) === String(accountId));
      const confirmed = window.confirm(`确认归档 / 删除账号“${account?.name || accountId}”吗？如果已经存在历史账单，会自动转为停用。`);
      if (!confirmed) {
        return;
      }

      deleteButton.disabled = true;
      try {
        await fetchJson(`/api/admin/accounts/${accountId}`, {
          method: "DELETE"
        });
        if (String(document.getElementById("accountIdInput").value || "") === String(accountId)) {
          resetAccountForm();
        }
        await reloadPageData();
      } catch (error) {
        window.alert(error.message || "删除账号失败");
      } finally {
        deleteButton.disabled = false;
      }
    }
  });
}

async function submitAccountForm() {
  const form = document.getElementById("accountForm");
  const feedback = document.getElementById("accountFormFeedback");
  const providerDef = getCurrentProviderDefinition();

  setFeedback(feedback, "", "");

  const payload = {
    name: document.getElementById("accountNameInput").value.trim(),
    utilityType: document.getElementById("utilityTypeInput").value,
    provider: document.getElementById("providerInput").value,
    accountNo: document.getElementById("accountNoInput").value.trim(),
    loginName: document.getElementById("loginNameInput").value.trim(),
    loginMethod: document.getElementById("loginMethodInput").value,
    notes: document.getElementById("accountNotesInput").value.trim(),
    isPrimary: document.getElementById("isPrimaryInput").checked,
    clearCredentials: document.getElementById("clearCredentialsInput").checked,
    credentials: collectCredentialInputs()
  };

  if (providerDef?.form?.accountNoRequired && !payload.accountNo) {
    setFeedback(feedback, "is-error", `${providerDef.form.accountNoLabel || "账户标识"}不能为空`);
    return;
  }

  disableForm(form, true);
  try {
    const accountId = document.getElementById("accountIdInput").value;
    const result = accountId
      ? await fetchJson(`/api/admin/accounts/${accountId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      : await fetchJson("/api/admin/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

    await reloadPageData();
    if (result.item?.id) {
      await loadAccountIntoForm(result.item.id, {
        preserveFeedback: false,
        feedbackClass: "is-success",
        feedbackMessage: "账号已保存。已保存的 CK / Token / storageJson 不会回显，留空也不会丢失；现在可以直接点“测试连接”。"
      });
    } else {
      setFeedback(feedback, "is-success", "账号已保存。");
    }
  } catch (error) {
    setFeedback(feedback, "is-error", error.message || "保存账号失败");
  } finally {
    disableForm(form, false);
  }
}

async function submitBillForm() {
  const form = document.getElementById("billForm");
  const feedback = document.getElementById("billFormFeedback");
  setFeedback(feedback, "", "");

  const payload = {
    accountId: Number(document.getElementById("billAccountIdInput").value),
    statementDate: document.getElementById("statementDateInput").value,
    periodStart: document.getElementById("periodStartInput").value,
    periodEnd: document.getElementById("periodEndInput").value,
    usageValue: document.getElementById("usageValueInput").value,
    usageUnit: document.getElementById("usageUnitInput").value.trim(),
    amount: document.getElementById("amountInput").value,
    currency: document.getElementById("currencyInput").value.trim() || "CNY",
    sourceChannel: document.getElementById("sourceChannelInput").value.trim() || "manual",
    recordType: document.getElementById("recordTypeInput").value,
    status: document.getElementById("billStatusInput").value,
    isEstimated: document.getElementById("isEstimatedBillInput").checked
  };

  disableForm(form, true);
  try {
    await fetchJson("/api/admin/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setFeedback(feedback, "is-success", "账单已写入数据库，并进入统计链路。");
    await reloadPageData();
    resetBillForm();
  } catch (error) {
    setFeedback(feedback, "is-error", error.message || "录入账单失败");
  } finally {
    disableForm(form, false);
  }
}

async function testCurrentAccount() {
  const feedback = document.getElementById("accountFormFeedback");
  const accountId = document.getElementById("accountIdInput").value;
  if (!accountId) {
    setFeedback(feedback, "is-error", "请先保存账号，或从左侧账号列表里点“编辑 / 测试”。");
    return;
  }

  setFeedback(feedback, "", "正在测试连接...");
  try {
    const result = await fetchJson(`/api/admin/accounts/${accountId}/test`, {
      method: "POST"
    });
    await reloadPageData();
    await loadAccountIntoForm(accountId, {
      preserveFeedback: false,
      feedbackClass: "is-success",
      feedbackMessage: result.item?.summary || "连接测试成功"
    });
  } catch (error) {
    setFeedback(feedback, "is-error", error.message || "连接测试失败");
  }
}

async function reloadPageData() {
  await loadPage();
}

async function loadAccountIntoForm(accountId, options = {}) {
  const result = await fetchJson(`/api/admin/accounts/${accountId}`);
  fillAccountForm(result.item, options);
  if (options.feedbackMessage) {
    setFeedback(
      document.getElementById("accountFormFeedback"),
      options.feedbackClass || "",
      options.feedbackMessage
    );
  }
  return result.item;
}

function fillAccountForm(account, options = {}) {
  state.editingAccount = account || null;
  document.getElementById("accountIdInput").value = account?.id || "";
  document.getElementById("accountNameInput").value = account?.name || "";
  document.getElementById("utilityTypeInput").value = account?.utilityType || "electricity";
  syncProviderOptions(account?.provider, account?.loginMethod, {});
  document.getElementById("accountNoInput").value = account?.accountNo || "";
  document.getElementById("loginNameInput").value = account?.loginName || "";
  document.getElementById("accountNotesInput").value = account?.notes || "";
  document.getElementById("isPrimaryInput").checked = Boolean(account?.isPrimary);
  document.getElementById("clearCredentialsInput").checked = false;
  setText("accountFormTitle", `编辑账号：${account?.name || "--"}`);
  setText("accountFormHint", "已保存的 CK、Token、storageJson 不会回显，这是正常的安全行为；留空不会覆盖原值，重新填写才会更新。");
  setText("credentialStateChip", `凭据状态：${account?.credentialConfigured ? "已配置" : "未配置"}`);
  clearImportPayload({ keepText: true, keepFeedback: false });
  if (!options.preserveFeedback) {
    setFeedback(document.getElementById("accountFormFeedback"), "", "");
  }
}

function resetAccountForm() {
  state.editingAccount = null;
  document.getElementById("accountForm").reset();
  document.getElementById("accountIdInput").value = "";
  setText("accountFormTitle", "新增账号");
  setText("accountFormHint", "先填写基础信息和最少必需字段后保存。保存成功后会自动进入该账号的编辑状态，你可以继续直接测试。");
  setText("credentialStateChip", "凭据状态：未配置");
  setFeedback(document.getElementById("accountFormFeedback"), "", "");
  clearImportPayload();
  syncProviderOptions(undefined, undefined, {});
}

function resetBillForm() {
  document.getElementById("billForm").reset();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("statementDateInput").value = today;
  document.getElementById("currencyInput").value = "CNY";
  document.getElementById("sourceChannelInput").value = "manual";
  document.getElementById("recordTypeInput").value = "bill";
  document.getElementById("billStatusInput").value = "confirmed";
  setFeedback(document.getElementById("billFormFeedback"), "", "");
  populateBillAccountOptions();
}

function populateBillAccountOptions() {
  const select = document.getElementById("billAccountIdInput");
  const current = select.value;
  const activeAccounts = state.accounts.filter((item) => item.status !== "disabled");
  select.innerHTML = activeAccounts.map((item) => `
    <option value="${escapeHtml(String(item.id))}">
      ${escapeHtml(item.name)} / ${escapeHtml(item.provider)}
    </option>
  `).join("");

  if (current && activeAccounts.some((item) => String(item.id) === current)) {
    select.value = current;
  }
}

function getCurrentProviderDefinition() {
  const utilityType = document.getElementById("utilityTypeInput").value;
  const provider = document.getElementById("providerInput").value;
  return state.providers.find((item) => item.utilityType === utilityType && item.provider === provider)
    || state.providers.find((item) => item.utilityType === utilityType)
    || null;
}

function readCredentialDraft() {
  const draft = {};
  const elements = document.querySelectorAll("[data-credential-key]");
  for (const element of elements) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      draft[element.dataset.credentialKey] = element.value;
    }
  }
  return draft;
}

function renderCredentialFields(providerDef, draft = {}) {
  const grid = document.getElementById("credentialFieldsGrid");
  const fields = safeArray(providerDef?.credentialFields);
  const isEditingSavedAccount = Boolean(state.editingAccount?.id && state.editingAccount?.credentialConfigured);

  if (!fields.length) {
    grid.innerHTML = `<div class="empty-state">当前服务商没有额外的凭据字段。</div>`;
    return;
  }

  grid.innerHTML = fields.map((field) => {
    const key = String(field.key || "");
    const label = escapeHtml(field.label || key || "--");
    const value = draft[key] || "";
    const multiline = /json|cookie|storage|notes|remark/i.test(key);
    const placeholder = isEditingSavedAccount
      ? "留空表示继续使用已保存值；重新填写才会更新"
      : (field.helpText || "留空则不保存该字段");
    const helpText = field.helpText ? `<div class="field-help">${escapeHtml(field.helpText)}</div>` : "";

    if (multiline) {
      return `
        <label class="form-field credential-field-wide">
          <span>${label}${field.required ? " *" : ""}</span>
          <textarea
            id="credential-${escapeHtml(key)}"
            data-credential-key="${escapeHtml(key)}"
            rows="${/notes|remark/i.test(key) ? "2" : "4"}"
            placeholder="${escapeHtml(placeholder)}"
          >${escapeHtml(value)}</textarea>
          ${helpText}
        </label>
      `;
    }

    return `
      <label class="form-field">
        <span>${label}${field.required ? " *" : ""}</span>
        <input
          id="credential-${escapeHtml(key)}"
          data-credential-key="${escapeHtml(key)}"
          type="${escapeHtml(field.type || "text")}"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
        >
        ${helpText}
      </label>
    `;
  }).join("");
}

function collectCredentialInputs() {
  const payload = {};
  const elements = document.querySelectorAll("[data-credential-key]");
  for (const element of elements) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      continue;
    }
    const key = String(element.dataset.credentialKey || "").trim();
    const value = element.value.trim();
    if (!key || !value) {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

async function copyImportSnippetForCurrentProvider() {
  const providerDef = getCurrentProviderDefinition();
  const preset = getImportPreset(providerDef);
  const feedback = document.getElementById("importPayloadFeedback");

  if (!preset.snippet) {
    setFeedback(feedback, "is-error", "当前服务商没有可复制的浏览器提取脚本。请直接粘贴 HAR、Cookie 或原始 JSON。");
    return;
  }

  try {
    await navigator.clipboard.writeText(preset.snippet);
    setFeedback(feedback, "is-success", "提取脚本已复制。到对应服务商的已登录页面打开控制台执行，然后把输出结果粘贴回来。");
  } catch {
    document.getElementById("importPayloadInput").value = preset.snippet;
    setFeedback(feedback, "is-success", "浏览器剪贴板不可用，已把提取脚本放进文本框。你可以手动复制后到对应页面执行。");
  }
}

function applyImportPayloadForCurrentProvider() {
  const providerDef = getCurrentProviderDefinition();
  const input = document.getElementById("importPayloadInput");
  const feedback = document.getElementById("importPayloadFeedback");
  const raw = String(input?.value || "").trim();

  if (!raw) {
    setFeedback(feedback, "is-error", "请先粘贴原始内容。");
    return;
  }

  try {
    const result = parseImportPayload(providerDef, raw);
    let filledCount = 0;

    if (Object.prototype.hasOwnProperty.call(result, "accountNo")) {
      document.getElementById("accountNoInput").value = result.accountNo || "";
      if (result.accountNo) {
        filledCount += 1;
      }
    }

    if (Object.prototype.hasOwnProperty.call(result, "loginName")) {
      document.getElementById("loginNameInput").value = result.loginName || "";
      if (result.loginName) {
        filledCount += 1;
      }
    }

    if (Object.prototype.hasOwnProperty.call(result, "notes")) {
      document.getElementById("accountNotesInput").value = result.notes || "";
    }

    for (const [key, value] of Object.entries(result.credentials || {})) {
      const field = document.getElementById(`credential-${key}`);
      if (field) {
        field.value = value;
        if (value) {
          filledCount += 1;
        }
      }
    }

    if (!filledCount) {
      throw new Error("已读取原始内容，但没有识别出当前服务商需要的字段。");
    }

    setFeedback(feedback, "is-success", result.summary || `已识别并填入 ${filledCount} 个字段。`);
  } catch (error) {
    setFeedback(feedback, "is-error", error.message || "识别原始内容失败");
  }
}

function clearImportPayload(options = {}) {
  const { keepText = false, keepFeedback = false } = options;
  const input = document.getElementById("importPayloadInput");
  const feedback = document.getElementById("importPayloadFeedback");
  if (input && !keepText) {
    input.value = "";
  }
  if (feedback && !keepFeedback) {
    setFeedback(feedback, "", "");
  }
}

function syncProviderOptions(preferredProvider, preferredLoginMethod, preferredCredentialDraft = null) {
  const utilityType = document.getElementById("utilityTypeInput").value;
  const providerSelect = document.getElementById("providerInput");
  const providers = state.providers.filter((item) => item.utilityType === utilityType);

  providerSelect.innerHTML = providers.map((item) => `
    <option value="${escapeHtml(item.provider)}">${escapeHtml(item.provider)}</option>
  `).join("");

  if (preferredProvider && providers.some((item) => item.provider === preferredProvider)) {
    providerSelect.value = preferredProvider;
  } else if (providers.length) {
    providerSelect.value = providers[0].provider;
  }

  syncLoginMethods(preferredLoginMethod, preferredCredentialDraft);
}

function syncLoginMethods(preferredLoginMethod, preferredCredentialDraft = null) {
  const providerDef = getCurrentProviderDefinition();
  const loginMethodSelect = document.getElementById("loginMethodInput");
  const methods = safeArray(providerDef?.loginMethods);

  loginMethodSelect.innerHTML = methods.map((item) => `
    <option value="${escapeHtml(item)}">${escapeHtml(item)}</option>
  `).join("");

  if (preferredLoginMethod && methods.includes(preferredLoginMethod)) {
    loginMethodSelect.value = preferredLoginMethod;
  } else if (methods.length) {
    loginMethodSelect.value = methods[0];
  }

  applyProviderPresentation(providerDef);
  renderCredentialFields(providerDef, preferredCredentialDraft ?? readCredentialDraft());
}

function applyProviderPresentation(providerDef) {
  const form = providerDef?.form || {};
  const preset = getImportPreset(providerDef);
  const accountNoField = document.getElementById("accountNoField");
  const loginNameField = document.getElementById("loginNameField");
  const notesInput = document.getElementById("accountNotesInput");
  const accountNoLabel = accountNoField?.querySelector("span");
  const loginNameLabel = loginNameField?.querySelector("span");
  const accountNoInput = document.getElementById("accountNoInput");
  const copyButton = document.getElementById("copyImportSnippetButton");
  const snippetPanel = document.getElementById("importSnippetPanel");

  if (accountNoLabel) {
    accountNoLabel.textContent = form.accountNoLabel || "账户标识";
  }
  if (accountNoInput) {
    accountNoInput.placeholder = form.accountNoPlaceholder || "按当前服务商要求填写";
    accountNoInput.required = Boolean(form.accountNoRequired);
  }
  if (loginNameLabel) {
    loginNameLabel.textContent = form.loginNameLabel || "登录名";
  }
  if (loginNameField) {
    loginNameField.style.display = form.loginNameVisible === false ? "none" : "";
  }
  if (notesInput) {
    notesInput.placeholder = form.notesPlaceholder || "记录补充说明";
  }

  setText("providerGuideTitle", "接入说明");
  setText("providerGuideText", form.credentialIntro || "请先选择服务商，系统会给出最小可用字段说明。");
  setText("providerGuideExtra", form.sessionGuide || "");

  setText("importHelperTitle", preset.title || "会话导入辅助");
  setText("importHelperHint", preset.hint || "请先选择服务商。");
  setText("importAcceptedFormats", preset.acceptedFormats || "");

  setText("importGuideTitle", `${preset.title || "会话导入"}分步说明`);
  setText("importSnippetLabel", preset.snippetLabel || "提取脚本");
  document.getElementById("importSnippetPreview").textContent = preset.snippet || "当前服务商没有浏览器提取脚本。请按上方说明直接粘贴 HAR、Cookie 或原始 JSON。";

  if (copyButton) {
    copyButton.disabled = !preset.snippet;
  }
  if (snippetPanel) {
    snippetPanel.classList.toggle("guide-code-panel-muted", !preset.snippet);
  }

  renderImportGuideSteps(preset.steps || []);
}

function renderImportGuideSteps(steps) {
  const container = document.getElementById("importGuideSteps");
  if (!steps.length) {
    container.innerHTML = `<div class="empty-state">请先选择服务商，系统会显示对应的操作步骤。</div>`;
    return;
  }

  container.innerHTML = steps.map((step, index) => `
    <article class="guide-step-card">
      <div class="guide-step-top">
        <span class="guide-step-index">${index + 1}</span>
        <span class="guide-step-visual">${escapeHtml(step.visual || "步骤")}</span>
      </div>
      <div class="guide-step-title">${escapeHtml(step.title || `步骤 ${index + 1}`)}</div>
      <p class="guide-step-body">${escapeHtml(step.body || "")}</p>
    </article>
  `).join("");
}

function bindNavigation() {
  const navItems = Array.from(document.querySelectorAll(".nav-group .nav-item[href^='#']"));
  if (!navItems.length) {
    return;
  }

  const sections = navItems.map((item) => {
    const targetId = item.getAttribute("href")?.slice(1);
    const section = targetId ? document.getElementById(targetId) : null;
    return targetId && section ? { item, targetId, section } : null;
  }).filter(Boolean);

  const setActive = (targetId) => {
    for (const section of sections) {
      section.item.classList.toggle("active", section.targetId === targetId);
    }
  };

  const syncFromLocation = () => {
    const hashTargetId = window.location.hash.slice(1);
    if (hashTargetId && sections.some((section) => section.targetId === hashTargetId)) {
      setActive(hashTargetId);
      return;
    }

    const current = sections
      .map((section) => ({
        targetId: section.targetId,
        top: section.section.getBoundingClientRect().top
      }))
      .filter((section) => section.top <= 180)
      .sort((left, right) => Math.abs(left.top) - Math.abs(right.top))[0];

    setActive(current?.targetId || sections[0].targetId);
  };

  for (const section of sections) {
    section.item.addEventListener("click", () => setActive(section.targetId));
  }

  window.addEventListener("hashchange", syncFromLocation);
  window.addEventListener("scroll", syncFromLocation, { passive: true });
  syncFromLocation();
}

async function logout() {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function disableForm(form, disabled) {
  for (const element of Array.from(form.elements)) {
    element.disabled = disabled;
  }
}

function setFeedback(element, className, message) {
  element.className = `form-feedback${className ? ` ${className}` : ""}`;
  element.textContent = message || "";
}

function deriveHealthScore() {
  const healthItems = safeArray(state.summary.health);
  if (!healthItems.length) {
    return "--";
  }
  const okCount = healthItems.filter((item) => String(item.status || "").toLowerCase() === "ok").length;
  return `${Math.round((okCount / healthItems.length) * 100)}%`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function utilityLabel(type) {
  if (type === "electricity") return "电";
  if (type === "water") return "水";
  if (type === "gas") return "燃气";
  return type || "--";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (["ok", "success", "active", "confirmed", "info"].includes(value)) return "status-ok";
  if (["warning", "warn", "pending", "attention", "manual"].includes(value)) return "status-warning";
  if (["error", "failed", "disabled"].includes(value)) return "status-error";
  return "status-info";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
