(function () {
  const summaryStats = document.getElementById("summaryStats");
  const generatedAtLabel = document.getElementById("generatedAtLabel");
  const fundGrid = document.getElementById("fundGrid");
  const moverList = document.getElementById("moverList");
  const topHoldingTable = document.getElementById("topHoldingTable");
  const installButton = document.getElementById("installButton");

  let deferredInstallPrompt = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    registerServiceWorker();
    bindInstallPrompt();

    try {
      const summary = await fetchJson("./data/summary.json");
      const latestFunds = await Promise.all(
        summary.cards.map((card) => fetchJson(`./data/latest/${card.fund.id}.json`))
      );

      renderSummary(summary);
      renderFundCards(latestFunds);
      renderTopMovers(summary.top_movers || []);
      renderTopHoldings(latestFunds);
    } catch (error) {
      console.error(error);
      generatedAtLabel.textContent = "資料讀取失敗";
      fundGrid.innerHTML = `<div class="empty-state">無法讀取站台資料，請確認 site/data 已生成。</div>`;
      moverList.innerHTML = `<div class="empty-state">目前無法載入異動資料。</div>`;
      topHoldingTable.innerHTML = `<div class="empty-state">目前無法載入持股資料。</div>`;
    }
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    return response.json();
  }

  function renderSummary(summary) {
    generatedAtLabel.textContent = formatDateTime(summary.generated_at);
    const stats = [
      { label: "ETF", value: summary.fund_count },
      { label: "異動 ETF", value: summary.alert_count },
      { label: "最近快照", value: summary.latest_snapshot_date || "-" },
      { label: "通知", value: "TG" },
    ];
    summaryStats.innerHTML = stats
      .map(
        (item) => `
          <div class="hero-stat">
            <div class="hero-stat__label">${escapeHtml(String(item.label))}</div>
            <div class="hero-stat__value">${escapeHtml(String(item.value))}</div>
          </div>
        `
      )
      .join("");
  }

  function renderFundCards(latestFunds) {
    fundGrid.innerHTML = latestFunds
      .map((payload) => {
        const summary = payload.summary || {};
        const isActive = [summary.added, summary.removed, summary.increased, summary.decreased].some(Boolean);
        return `
          <article class="fund-card">
            <div class="fund-card__head">
              <div>
                <div class="fund-card__code">${escapeHtml(payload.fund.id)} / ${escapeHtml(payload.fund.source || "STATIC")}</div>
                <div class="fund-card__name">${escapeHtml(payload.fund.name)}</div>
                <div class="fund-card__meta">更新 ${escapeHtml(payload.snapshot_date)} / 共 ${payload.holdings_count} 檔</div>
              </div>
              <div class="state-tag ${isActive ? "state-tag--active" : "state-tag--calm"}">
                ${isActive ? "有異動" : "基準快照"}
              </div>
            </div>
            <div class="metric-grid">
              ${renderMetricCell("新增", summary.added || 0)}
              ${renderMetricCell("加碼", summary.increased || 0)}
              ${renderMetricCell("減碼", summary.decreased || 0)}
              ${renderMetricCell("移除", summary.removed || 0)}
            </div>
            <div class="fund-mini-table">
              <div class="fund-mini-table__row fund-mini-table__row--head">
                <div>位</div>
                <div>個股</div>
                <div class="align-right">權重</div>
                <div class="align-right">張數</div>
              </div>
              ${(payload.top_holdings || []).slice(0, 3).map(renderMiniHoldingRow).join("")}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderMetricCell(label, value) {
    return `
      <div class="metric-cell">
        <div class="metric-cell__label">${escapeHtml(String(label))}</div>
        <div class="metric-cell__value">${escapeHtml(String(value))}</div>
      </div>
    `;
  }

  function renderMiniHoldingRow(holding) {
    return `
      <div class="fund-mini-table__row">
        <div class="align-right">${holding.rank}</div>
        <div>${escapeHtml(holding.code)} ${escapeHtml(holding.name)}</div>
        <div class="align-right">${escapeHtml(holding.weight)}</div>
        <div class="align-right">${formatLots(holding.shares)}</div>
      </div>
    `;
  }

  function renderTopMovers(movers) {
    if (!movers.length) {
      moverList.innerHTML = `<div class="empty-state">目前只有基準快照，尚未累積可比較的異動資料。</div>`;
      return;
    }

    moverList.innerHTML = movers
      .slice(0, 8)
      .map((mover) => {
        const isDown = mover.shares_diff < 0;
        const changeText = mover.change_type === "added"
          ? `新增 ${formatLots(mover.shares_diff)}`
          : mover.change_type === "removed"
            ? `移除 ${formatLots(Math.abs(mover.shares_diff))}`
            : `${mover.shares_diff > 0 ? "+" : ""}${formatLots(mover.shares_diff)}`;

        return `
          <div class="stack-list__row">
            <div class="stack-list__date">${escapeHtml(mover.snapshot_date || "最新")}</div>
            <div>
              <div class="stack-list__title">${escapeHtml(mover.stock_code)} ${escapeHtml(mover.stock_name)}</div>
              <div class="stack-list__meta">${escapeHtml(mover.fund_id)} / ${escapeHtml(mover.fund_name || "ETF")} / 權重 ${escapeHtml(mover.weight || "-")}</div>
            </div>
            <div class="delta-pill ${isDown ? "delta-pill--down" : "delta-pill--up"}">${escapeHtml(changeText)}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderTopHoldings(latestFunds) {
    const rows = latestFunds
      .flatMap((payload) =>
        (payload.top_holdings || []).map((holding) => ({
          fundId: payload.fund.id,
          fundName: payload.fund.name,
          ...holding,
        }))
      )
      .sort((left, right) => right.weight_value - left.weight_value)
      .slice(0, 12);

    topHoldingTable.innerHTML = rows
      .map(
        (row) => `
          <div class="dense-table">
            <div>${escapeHtml(row.fundId)}</div>
            <div>${escapeHtml(row.code)} ${escapeHtml(row.name)}</div>
            <div class="align-right">${escapeHtml(row.weight)}</div>
            <div class="align-right">${formatLots(row.shares)}</div>
            <div class="align-right">#${row.rank}</div>
          </div>
        `
      )
      .join("");
  }

  function bindInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.textContent = "安裝 ETF Watch";
      installButton.disabled = false;
    });

    installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        installButton.textContent = "請用 Safari 分享後加入主畫面";
        installButton.disabled = true;
        return;
      }

      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.textContent = "已觸發安裝提示";
      installButton.disabled = true;
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.error("Service worker registration failed", error);
      });
    });
  }

  function formatDateTime(isoString) {
    if (!isoString) {
      return "-";
    }
    const date = new Date(isoString);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatLots(shares) {
    const lots = Math.trunc(Number(shares || 0) / 1000);
    return `${lots.toLocaleString("zh-TW")} 張`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();