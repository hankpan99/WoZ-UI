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

  // ---- 接受幫助的詳細步驟 ------------------------------------------------
  // 下面兩個是 server/state.py 的 selected_details() 與 help_cost() 的鏡像，
  // 只用來讓畫面先顯示；真正扣點一律以 server 算出來的為準。
  // 規則改的時候兩邊要一起改。

  // 目前勾選的詳細步驟索引。state 沒有紀錄過就是「全部勾選」。
  const pickedDetails = (state, key, total) => {
    const picked = state?.helpDetails?.[key];
    if (!Array.isArray(picked)) return [...Array(total).keys()];
    return picked
      .filter((index) => Number.isInteger(index) && index >= 0 && index < total)
      .sort((a, b) => a - b);
  };

  // 全部勾選＝原價；少勾幾個＝剩下勾選的個數。
  const helpCost = (action, pickedCount) => {
    const total = (action?.details || []).length;
    const price = action?.cost || 0;
    if (total === 0 || pickedCount === total) return price;
    return Math.min(pickedCount, price);
  };

  // ---- 助手主動提議 ------------------------------------------------------
  // 同樣是 server/state.py（action_proactive / proactive_cost）的鏡像。
  // 範圍寫死在 Excel 的「介入」欄，實驗中不可調整，所以不看 state。

  // 這個步驟裡屬於主動提議範圍的詳細動作索引。
  const proactiveDetails = (action) => action?.proactive || [];

  // 整個步驟都標記＝原價；只標幾條＝標到的條數。沒有標記就是 0。
  const proactiveCost = (action) => {
    const marks = proactiveDetails(action).length;
    if (marks === 0) return 0;
    const total = (action?.details || []).length;
    const price = action?.cost || 0;
    if (total && marks === total) return price;
    return Math.min(marks, price);
  };

  window.WozFormat = {
    actionKey, formatPoints, formatDelta, cleanLabel, formatTime, slideCost,
    pickedDetails, helpCost, proactiveDetails, proactiveCost,
  };
})();
