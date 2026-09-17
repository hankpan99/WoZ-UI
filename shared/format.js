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

  // 舊版食譜沒有主動程度欄位時，維持原本的詢問後介入。
  const proactiveLevel = (action) =>
    action?.proactiveLevel === "4. 直接" ? "4. Alex直接介入" : "3. Alex詢問後介入";

  // 整個步驟都標記＝原價；只標幾條＝標到的條數。沒有標記就是 0。
  const proactiveCost = (action) => {
    const marks = proactiveDetails(action).length;
    if (marks === 0) return 0;
    const total = (action?.details || []).length;
    const price = action?.cost || 0;
    if (total && marks === total) return price;
    return Math.min(marks, price);
  };

  // ---- 助手佇列 ----------------------------------------------------------

  // 修正「實際做過的動作」後的花費。server/state.py 的 _executed_cost() 鏡像。
  // 全部做完＝原本的花費；否則＝min(做了幾條, Excel 原價, 原本的花費)。
  const executedCost = (action, executedCount, baseCount, original) => {
    if (!executedCount && baseCount) return 0;
    if (executedCount === baseCount) return original;
    return Math.min(executedCount, action?.cost || 0, original);
  };

  const assistantItems = (state) =>
    [state?.assistantCurrent, ...(state?.assistantQueue || [])].filter(Boolean);

  // 說明卡對應的那一筆帳目：卡片綁了佇列項目就用它的，否則用這個步驟最近一次。
  // 排隊期間 wizard 可能已經改了下一次的勾選，卡片要顯示「當時下指令」的內容。
  const helpOverlayEntry = (state) => {
    const key = state?.helpOverlay;
    if (!key) return null;
    const ledger = state.ledger || [];
    const item = assistantItems(state).find((other) => other.id === state.helpOverlayItem);
    return (item?.entryId && ledger.find((entry) => entry.id === item.entryId))
      || ledger.findLast((entry) => entry.kind === "help" && entry.key === key)
      || null;
  };

  window.WozFormat = {
    actionKey, formatPoints, formatDelta, cleanLabel, formatTime, slideCost,
    pickedDetails, helpCost, proactiveDetails, proactiveLevel, proactiveCost,
    assistantItems, helpOverlayEntry, executedCost,
  };
})();
