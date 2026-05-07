(function () {
  const state = {
    user: null,
    runtime: null,
    summary: null
  };

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      renderFatal(error.message || "后台加载失败");
    });
  });

  async function init() {
    bindPageActions();
    await loadPage();
  }

  async function loadPage() {
    const [me, health, summary] = await Promise.all([
      fetchJson("/api/auth/me"),
      fetchJson("/api/health"),
      fetchJson("/api/admin/summary")
    ]);

    state.user = me.user || null;
    state.runtime = health.runtime || {};
    state.summary = summary;

    renderHeader();
    renderHero();
    renderMetrics();
    renderPending();
    renderHealth();
    renderAccounts();
    renderJobs();
    renderSettings();
    renderLogs();
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
      throw new Error(payload?.error || `${url} returned ${response.status}`);
    }

    return payload;
  }

  function renderFatal(message) {
    document.getElementById("heroTitle").textContent = "后台加载失败";
    document.getElementById("heroDescription").textContent = message;
    document.getElementById("metricGrid").innerHTML = `<div class="alert-box">${escapeHtml(message)}</div>`;
  }

  function renderHeader() {
    setText("currentUserChip", `当前用户: ${state.user?.username || "未知"}`);
    setText("runtimeChip", `运行环境: ${state.runtime.environment || "unknown"} / ${state.runtime.node || "node"}`);
  }

  function renderHero() {
    const pendingCount = safeArray(state.summary.pending).length;
    const healthMetric = safeMetric("健康评分");
    setText("heroTitle", `${state.summary.title || "家庭水电燃账本"} 后台已接入登录保护`);
    setText("heroDescription", state.summary.subtitle || "采集、统计与通知后台");
    setText("pendingCountValue", String(pendingCount));
    setText("pendingCountHint", pendingCount ? "存在需要人工关注的项" : "当前没有待处理异常");
    setText("healthScoreValue", healthMetric?.value || "--");
    setText("healthScoreHint", healthMetric?.hint || "后台健康度");
  }

  function renderMetrics() {
    const container = document.getElementById("metricGrid");
    const metrics = safeArray(state.summary.metrics);
    if (!metrics.length) {
      container.innerHTML = `<div class="empty-state">暂无指标数据</div>`;
      return;
    }

    container.innerHTML = metrics.map((item) => `
      <article class="metric-card">
        <span class="metric-label">${escapeHtml(item.label || "--")}</span>
        <strong class="metric-value">${escapeHtml(item.value || "--")}</strong>
        <p class="metric-hint">${escapeHtml(item.hint || "")}</p>
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
          <div class="stack-item-subtitle">需要人工关注或复查最近一次任务结果</div>
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
      container.innerHTML = `<div class="empty-state">暂无健康检查数据</div>`;
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
    const items = safeArray(state.summary.accounts);
    if (!items.length) {
      container.innerHTML = `<div class="empty-state">暂无账户配置</div>`;
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="stack-item">
        <div class="stack-item-main">
          <div class="stack-item-title">${escapeHtml(item.name || "--")} · ${escapeHtml(utilityLabel(item.utilityType))}</div>
          <div class="stack-item-subtitle">
            服务商: ${escapeHtml(item.provider || "--")} · 账号: ${escapeHtml(item.accountNo || "--")} · 登录方式: ${escapeHtml(item.loginMethod || "--")}
          </div>
        </div>
        <div class="stack-item-actions">
          <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status || "--")}</span>
          <button class="btn btn-ghost" data-toggle-account="${escapeHtml(String(item.id))}" type="button">
            ${item.status === "disabled" ? "启用" : "停用"}
          </button>
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
            类型: ${escapeHtml(utilityLabel(item.utilityType))} · 定时: ${escapeHtml(item.scheduleTime || "--")} · 上次运行: ${escapeHtml(item.lastRunAt || "--")}
          </div>
        </div>
        <div class="stack-item-actions">
          <span class="status-badge ${statusClass(item.lastStatus)}">${escapeHtml(item.lastStatus || "--")}</span>
          <button class="btn btn-primary" data-run-job="${escapeHtml(item.utilityType || "")}" type="button">立即执行</button>
        </div>
      </div>
    `).join("");
  }

  function renderSettings() {
    const container = document.getElementById("settingsGrid");
    const wecom = state.summary.settings?.wecom || {};
    const statistics = state.summary.settings?.statistics || {};
    const items = [
      { label: "企业微信 CorpID", value: wecom.corpId || "--" },
      { label: "企业微信 AgentID", value: wecom.agentId || "--" },
      { label: "日推送时间", value: wecom.dailyPushTime || "--" },
      { label: "月推送时间", value: wecom.monthlyPushTime || "--" },
      { label: "推送接收人", value: safeArray(wecom.recipients).join(", ") || "--" },
      { label: "默认统计粒度", value: statistics.defaultGranularity || "--" },
      { label: "水燃统计策略", value: statistics.waterGasStrategy || "--" },
      { label: "估算开关", value: statistics.estimationEnabled ? "开启" : "关闭" }
    ];

    container.innerHTML = items.map((item) => `
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
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">暂无日志</div></td></tr>`;
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
    document.getElementById("refreshPageButton")?.addEventListener("click", () => {
      window.location.reload();
    });

    document.getElementById("logoutButton")?.addEventListener("click", async () => {
      await logout();
    });

    document.addEventListener("click", async (event) => {
      const runButton = event.target.closest("[data-run-job]");
      if (runButton) {
        runButton.disabled = true;
        const utilityType = runButton.getAttribute("data-run-job");
        try {
          await fetchJson("/api/admin/run-job", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ utilityType })
          });
          await loadPage();
        } finally {
          runButton.disabled = false;
        }
      }

      const toggleButton = event.target.closest("[data-toggle-account]");
      if (toggleButton) {
        toggleButton.disabled = true;
        const accountId = toggleButton.getAttribute("data-toggle-account");
        try {
          await fetchJson(`/api/admin/accounts/${accountId}/toggle`, {
            method: "POST"
          });
          await loadPage();
        } finally {
          toggleButton.disabled = false;
        }
      }
    });
  }

  async function logout() {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  function safeMetric(label) {
    return safeArray(state.summary.metrics).find((item) => item.label === label) || null;
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
    if (["ok", "success", "active"].includes(value)) return "status-ok";
    if (["warning", "warn", "pending", "attention"].includes(value)) return "status-warning";
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
})();
