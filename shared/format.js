// client 與 wizard 共用的小工具。
(function () {
  // done / helped 的 key 一律是 0-based 陣列索引，不是 slide.step 字串。
  const actionKey = (slideIndex, actionIndex) => `${slideIndex}:${actionIndex}`;

  const formatPoints = (value) =>
    new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value);

  // 帳本用：正負號要看得出來。
  const formatDelta = (value) => `${value > 0 ? "+" : "−"}${formatPoints(Math.abs(value))}`;

  // Excel 沒有餐點時會填 "-"，畫面上直接留白。
  const cleanLabel = (value) => {
    const text = (value || "").trim();
    return text === "-" || text === "—" ? "" : text;
  };

  const formatTime = (ts) =>
    new Date(ts).toLocaleTimeString("zh-TW", { hour12: false });

  const slideCost = (slide) =>
    slide.actions.reduce((total, action) => total + action.cost, 0);

  window.WozFormat = { actionKey, formatPoints, formatDelta, cleanLabel, formatTime, slideCost };
})();
