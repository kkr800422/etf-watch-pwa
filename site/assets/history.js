(function () {
  const etfFilter = document.getElementById("etfFilter");
  const changeTypeFilter = document.getElementById("changeTypeFilter");
  const keywordFilter = document.getElementById("keywordFilter");
  const historyTable = document.getElementById("historyTable");
  const historyCount = document.getElementById("historyCount");
  const historyMeta = document.getElementById("historyMeta");

  let historyRows = [];

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      const [funds, rows] = await Promise.all([
        fetchJson("./data/etfs.json"),
        fetchJson("./data/history/search-index.json"),
      ]);
      historyRows = rows;
      populateFundFilter(funds);
      bindFilterEvents();
      render();
    } catch (error) {
      console.error(error);
      historyTable.innerHTML = `<div class="empty-state">無法讀取歷史資料，請確認 site/data/history 已存在。</div>`;
    }
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    return response.json();
  }

  function populateFundFilter(funds) {
    const options = funds
      .map((item) => `<option value="${escapeHtml(item.fund.id)}">${escapeHtml(item.fund.id)} ${escapeHtml(item.fund.name)}</option>`)
      .join("");
    etfFilter.insertAdjacentHTML("beforeend", options);
  }

  function bindFilterEvents() {
    etfFilter.addEventListener("change", render);
    changeTypeFilter.addEventListener("change", render);
    keywordFilter.addEventListener("input", render);
  }

  function render() {
    const etfValue = etfFilter.value;
    const changeTypeValue = changeTypeFilter.value;
    const keyword = keywordFilter.value.trim().toLowerCase();

    const filtered = historyRows
      .filter((row) => (etfValue === "all" ? true : row.fund_id === etfValue))
      .filter((row) => (changeTypeValue === "all" ? true : row.change_type === changeTypeValue))
      .filter((row) => {
        if (!keyword) {
          return true;
        }
        const haystack = `${row.stock_code} ${row.stock_name} ${row.fund_id} ${row.fund_name}`.toLowerCase();
        return haystack.includes(keyword);
      })
      .sort((left, right) => {
        if (left.snapshot_date === right.snapshot_date) {
          return left.rank - right.rank;
        }
        return left.snapshot_date < right.snapshot_date ? 1 : -1;
      })
      .slice(0, 200);

    historyCount.textContent = `${filtered.length} 筆`;
    historyMeta.textContent = filtered.length ? "依日期新到舊，最多顯示 200 筆" : "沒有符合條件的紀錄";

    if (!filtered.length) {
      historyTable.innerHTML = `<div class="empty-state">沒有符合條件的歷史資料。</div>`;
      return;
    }

    historyTable.innerHTML = filtered
      .map(
        (row) => `
          <div class="dense-table history-table__row">
            <div>${escapeHtml(row.snapshot_date)}</div>
            <div>${escapeHtml(row.fund_id)}</div>
            <div>${escapeHtml(row.stock_code)} ${escapeHtml(row.stock_name)}</div>
            <div class="align-right">${escapeHtml(row.weight)}</div>
            <div class="align-right">${formatDiffLots(row.diff_lots)}</div>
            <div class="align-right">${formatChangeType(row.change_type)}</div>
          </div>
        `
      )
      .join("");
  }

  function formatDiffLots(diffLots) {
    if (!diffLots) {
      return "-";
    }
    const sign = diffLots > 0 ? "+" : "";
    return `${sign}${Number(diffLots).toLocaleString("zh-TW")} 張`;
  }

  function formatChangeType(changeType) {
    const mapping = {
      snapshot: "快照",
      added: "新增",
      removed: "移除",
      increased: "加碼",
      decreased: "減碼",
    };
    return mapping[changeType] || changeType;
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