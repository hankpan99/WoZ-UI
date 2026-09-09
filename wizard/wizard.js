// Wizard 控制台。所有操作都只是送一個 action 給 server，
// 規則與狀態都在 server/state.py，這一頁不自己算任何東西。
const slides = window.RECIPE_SLIDES || [];
const {
  actionKey, formatPoints, formatDelta, cleanLabel, formatTime, pickedDetails, helpCost,
  proactiveDetails, proactiveCost,
} = window.WozFormat;
const { dispatch } = window.WozStore;

const elements = {
  pageToggle: document.querySelector("#page-toggle"),
  pagePrev: document.querySelector("#page-prev"),
  pageNext: document.querySelector("#page-next"),
  pageMetaIndex: document.querySelector("#page-meta-index"),
  pageMetaName: document.querySelector("#page-meta-name"),
  conn: document.querySelector("#conn"),
  connLabel: document.querySelector("#conn-label"),
  stepList: document.querySelector("#step-list"),
  stepCount: document.querySelector("#step-count"),
  recenter: document.querySelector("#recenter"),
  markAll: document.querySelector("#mark-all"),
  clearAll: document.querySelector("#clear-all"),
  totalPoints: document.querySelector("#total-points"),
  remainingPoints: document.querySelector("#remaining-points"),
  remainingProactive: document.querySelector("#remaining-proactive"),
  adjustForm: document.querySelector("#adjust-form"),
  adjustInput: document.querySelector("#adjust-input"),
  adjustAdd: document.querySelector("#adjust-add"),
  ledger: document.querySelector("#ledger"),
  ledgerCount: document.querySelector("#ledger-count"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  overlayStatus: document.querySelector("#overlay-status"),
  overlayStatusText: document.querySelector("#overlay-status-text"),
  overlayClose: document.querySelector("#overlay-close"),
  offlineBanner: document.querySelector("#offline-banner"),
};

let currentIndex = 0;
// 上一次真正重建過步驟清單的頁碼；同一頁的更新只做同步，
// 才不會把 wizard 正在輸入的花費欄位洗掉。
let renderedIndex = -1;
// 下面三個都只是這一頁的顯示狀態，不會送到 server。
// 展開中的詳細步驟清單。
const expandedKeys = new Set();
// wizard 手動打過花費的步驟：在他再動詳細步驟之前，不要蓋掉他打的數字。
const manualCostKeys = new Set();
// 上一次的「接受幫助」集合，用來認出剛勾起來的步驟並自動展開它的詳細步驟。
let lastHelpedKeys = new Set();

const pageLabel = (slide) => {
  const meal = cleanLabel(slide.meal);
  const stage = cleanLabel(slide.stage);
  return [meal, stage].filter(Boolean).join(" · ");
};

const stepLabel = (index) => String(index + 1).padStart(2, "0");

// ---- 頁面切換器 ----------------------------------------------------------

function buildPageToggle() {
  elements.pageToggle.replaceChildren(
    ...slides.map((slide, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "page-button";
      button.dataset.index = String(index);
      button.textContent = slide.step;
      button.title = pageLabel(slide) || `第 ${slide.step} 頁`;
      button.addEventListener("click", () => dispatch({ type: "setPage", index }));
      return button;
    }),
  );
}

function syncPageToggle(state) {
  const touched = new Set(
    [...state.done, ...Object.keys(state.helped || {})].map((key) => key.split(":")[0]),
  );
  [...elements.pageToggle.children].forEach((button, index) => {
    button.classList.toggle("current", index === currentIndex);
    button.classList.toggle("touched", touched.has(String(index)));
    button.setAttribute("aria-pressed", String(index === currentIndex));
  });
  elements.pagePrev.disabled = currentIndex === 0;
  elements.pageNext.disabled = currentIndex === slides.length - 1;

  const slide = slides[currentIndex];
  elements.pageMetaIndex.textContent = `第 ${slide?.step ?? "?"} 頁`;
  elements.pageMetaName.textContent = slide ? pageLabel(slide) : "";
}

// ---- 步驟清單 ------------------------------------------------------------

function buildStepList() {
  const slide = slides[currentIndex];
  if (!slide) {
    elements.stepList.replaceChildren();
    return;
  }

  elements.stepList.replaceChildren(
    ...slide.actions.map((action, index) => {
      const key = actionKey(currentIndex, index);
      const row = document.createElement("div");
      row.className = "step-row";
      row.dataset.key = key;

      const doneLabel = document.createElement("label");
      doneLabel.className = "check done-check";
      const doneBox = document.createElement("input");
      doneBox.type = "checkbox";
      doneBox.dataset.role = "done";
      doneBox.addEventListener("change", () => {
        dispatch({ type: "setDone", key, value: doneBox.checked });
      });
      doneLabel.append(doneBox, Object.assign(document.createElement("span"), { textContent: "完成" }));

      const body = document.createElement("div");
      body.className = "step-body";
      const title = document.createElement("div");
      title.className = "step-title";
      title.append(
        Object.assign(document.createElement("span"), { className: "step-index", textContent: stepLabel(index) }),
        Object.assign(document.createElement("span"), { className: "step-name", textContent: action.name }),
      );
      // 讓實驗者一眼看出哪些步驟的圖片檔名有放對。
      const stepNumber = index + 1;
      if (window.WozImages.has(slide.step, stepNumber)) {
        const own = window.WozImages.hasOwn(slide.step, stepNumber);
        title.append(Object.assign(document.createElement("span"), {
          className: "step-image-mark",
          textContent: own ? "🖼" : "🖼·頁",
          title: own
            ? `有專屬圖片：${window.WozImages.get(slide.step, stepNumber)}`
            : `沒有專屬圖片，使用整頁的預設圖：${window.WozImages.get(slide.step)}`,
        }));
      }
      title.append(Object.assign(document.createElement("span"), {
        className: "step-list-price",
        textContent: `原價 ${formatPoints(action.cost)} $`,
      }));

      const helpRow = document.createElement("div");
      helpRow.className = "help-row";

      const costInput = document.createElement("input");
      costInput.className = "cost-input";
      costInput.type = "number";
      costInput.step = "any";
      costInput.dataset.role = "cost";
      costInput.value = String(action.cost);
      // 一旦 wizard 自己打了數字，就不要再被詳細步驟的自動計價蓋掉。
      costInput.addEventListener("input", () => manualCostKeys.add(key));
      manualCostKeys.delete(key);

      const helpLabel = document.createElement("label");
      helpLabel.className = "check help-check";
      const helpBox = document.createElement("input");
      helpBox.type = "checkbox";
      helpBox.dataset.role = "helped";
      helpBox.addEventListener("change", () => {
        const cost = Number(costInput.value);
        dispatch({
          type: "setHelped",
          key,
          value: helpBox.checked,
          cost: Number.isFinite(cost) ? cost : action.cost,
          note: `第${slide.step}頁 · 步驟${stepLabel(index)} 接受幫助`,
        });
      });
      helpLabel.append(helpBox, Object.assign(document.createElement("span"), { textContent: "助手介入" }));

      // 說明卡是參與者畫面上那張整頁的框；勾「接受幫助」時會自動叫出來，
      // 這顆是事後再開關用的。
      const overlayButton = document.createElement("button");
      overlayButton.type = "button";
      overlayButton.className = "overlay-button";
      overlayButton.dataset.role = "overlay";
      overlayButton.textContent = "顯示說明卡";
      overlayButton.addEventListener("click", () => {
        const showing = overlayButton.classList.contains("is-on");
        dispatch({ type: "setHelpOverlay", key: showing ? null : key });
      });

      helpRow.append(
        helpLabel,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "花費" }),
        costInput,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
        overlayButton,
      );

      body.append(title, helpRow);
      const proactiveRow = buildProactiveRow(key, action, slide, index);
      if (proactiveRow) body.append(proactiveRow);
      const detailBlock = buildDetailBlock(key, action.details || [], proactiveDetails(action));
      if (detailBlock) body.append(detailBlock);
      row.append(doneLabel, body);
      return row;
    }),
  );
}

// 助手主動提議。只有 Excel「介入」欄標過 O 的步驟才有這一列，其餘步驟完全不變。
// 代勞範圍固定是那幾條標記，不像「助手介入」可以逐條調整。
function buildProactiveRow(key, action, slide, index) {
  const marks = proactiveDetails(action);
  if (!marks.length) return null;

  const row = document.createElement("div");
  row.className = "proactive-row";

  const cost = proactiveCost(action);
  const costInput = document.createElement("input");
  costInput.className = "cost-input";
  costInput.type = "number";
  costInput.step = "any";
  costInput.dataset.role = "proactive-cost";
  costInput.value = String(cost);

  // 顯示提議卡 / 收起來。比照「助手介入」那一列的說明卡按鈕。
  const overlayButton = document.createElement("button");
  overlayButton.type = "button";
  overlayButton.className = "overlay-button";
  overlayButton.dataset.role = "proactive-overlay";
  overlayButton.textContent = "顯示提議卡";
  overlayButton.addEventListener("click", () => {
    const showing = overlayButton.classList.contains("is-on");
    dispatch({ type: "setProactiveOverlay", key: showing ? null : key });
  });

  // 參與者口頭回答，wizard 在這裡代按。
  // 接受＝主動池扣點；不接受＝主動池一樣扣，但等額退進可指揮池。
  const answerButton = (role, text, status) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `answer-button ${role}`;
    button.dataset.role = role;
    button.textContent = text;
    button.addEventListener("click", () => {
      const typed = Number(costInput.value);
      dispatch({
        type: "setProactive",
        key,
        status,
        cost: Number.isFinite(typed) ? typed : cost,
      });
    });
    return button;
  };

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "ghost-button";
  clearButton.dataset.role = "proactive-clear";
  clearButton.textContent = "取消";
  clearButton.addEventListener("click", () => {
    dispatch({ type: "setProactive", key, status: null });
  });

  row.append(
    Object.assign(document.createElement("span"), {
      className: "proactive-tag",
      textContent: `🤖 主動提議 ${marks.length}/${(action.details || []).length}`,
      title: `第${slide.step}頁 · 步驟${stepLabel(index)} 在 Excel「介入」欄標了 ${marks.length} 條`,
    }),
    overlayButton,
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "花費" }),
    costInput,
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
    answerButton("accept", "接受", "accepted"),
    answerButton("decline", "不接受", "declined"),
    clearButton,
  );
  return row;
}

// 詳細步驟：預設全部勾選（＝原價），取消幾個就少扣幾點，
// 參與者的說明卡上也只會列出還勾著的那幾條。
// marks 是主動提議範圍，只用來加一個記號，不影響這裡的勾選。
function buildDetailBlock(key, details, marks = []) {
  if (!details.length) return null;

  const caret = Object.assign(document.createElement("span"), { className: "detail-caret", textContent: "▸" });
  const count = document.createElement("span");
  count.className = "detail-count";
  count.dataset.role = "detail-count";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "detail-toggle";
  toggle.append(caret, Object.assign(document.createElement("span"), { textContent: "詳細動作" }), count);
  // 純展開／收合，不動任何實驗資料，所以直接用手上的狀態重畫就好。
  toggle.addEventListener("click", () => {
    if (expandedKeys.has(key)) expandedKeys.delete(key);
    else expandedKeys.add(key);
    if (window.WozStore.state) syncStepList(window.WozStore.state);
  });

  const head = document.createElement("div");
  head.className = "detail-head";
  head.append(toggle);
  [["全選", true], ["全不選", false]].forEach(([text, value]) => {
    const button = Object.assign(document.createElement("button"), {
      type: "button", className: "mini-button", textContent: text,
    });
    button.addEventListener("click", () => setStepDetails(key, null, value));
    head.append(button);
  });

  const markSet = new Set(marks);
  const checks = document.createElement("div");
  checks.className = "detail-checks";
  checks.dataset.role = "detail-checks";
  checks.append(...details.map((text, detailIndex) => {
    const label = document.createElement("label");
    label.className = "detail-check";
    // 主動提議會代勞的那幾條加個記號，實驗中一眼看得出範圍。
    if (markSet.has(detailIndex)) {
      label.classList.add("is-proactive");
      label.title = "在助手主動提議的範圍內";
    }
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.detailIndex = String(detailIndex);
    box.addEventListener("change", () => setStepDetails(key, detailIndex, box.checked));
    label.append(
      box,
      // 編號跟參與者說明卡上的一致，兩邊對得起來。
      Object.assign(document.createElement("span"), {
        className: "detail-check-index",
        textContent: String(detailIndex + 1).padStart(2, "0"),
      }),
      Object.assign(document.createElement("span"), { className: "detail-check-text", textContent: text }),
    );
    return label;
  }));

  const block = document.createElement("div");
  block.className = "detail-block";
  block.append(head, checks);
  return block;
}

// index 為 null＝整個步驟全選 / 全不選。
function setStepDetails(key, index, value) {
  // 動了詳細步驟＝把計價交還給自動規則。
  manualCostKeys.delete(key);
  dispatch({ type: "setHelpDetail", key, index, value });
}

function syncStepList(state) {
  const done = new Set(state.done);
  const helped = state.helped || {};
  const proactive = state.proactive || {};
  const overlayKey = state.helpOverlay || null;
  const proactiveOverlayKey = state.proactiveOverlay || null;

  [...elements.stepList.children].forEach((row, index) => {
    const key = row.dataset.key;
    const action = slides[currentIndex]?.actions[index];
    const details = action?.details || [];
    const picked = new Set(pickedDetails(state, key, details.length));
    const isDone = done.has(key);
    const isHelped = Object.prototype.hasOwnProperty.call(helped, key);
    const isShowing = overlayKey === key;

    row.querySelector('[data-role="done"]').checked = isDone;
    const helpBox = row.querySelector('[data-role="helped"]');
    helpBox.checked = isHelped;

    // 剛勾成「接受幫助」的步驟自動展開，讓 wizard 可以馬上調要代勞哪幾條。
    if (isHelped && !lastHelpedKeys.has(key)) expandedKeys.add(key);

    row.querySelectorAll("[data-detail-index]").forEach((box) => {
      box.checked = picked.has(Number(box.dataset.detailIndex));
    });
    const checks = row.querySelector('[data-role="detail-checks"]');
    if (checks) {
      const open = expandedKeys.has(key);
      checks.hidden = !open;
      row.querySelector(".detail-caret").textContent = open ? "▾" : "▸";
      row.querySelector('[data-role="detail-count"]').textContent =
        `${picked.size} / ${details.length}`;
    }

    const costInput = row.querySelector('[data-role="cost"]');
    // 正在輸入的欄位不動，避免打到一半被覆蓋。
    if (document.activeElement !== costInput) {
      // 已勾選的一定顯示帳本裡的金額；還沒勾的跟著詳細步驟自動算，
      // 但 wizard 手動打過的就以他打的為準。
      if (isHelped) costInput.value = String(helped[key]);
      else if (!manualCostKeys.has(key)) costInput.value = String(helpCost(action, picked.size));
    }
    costInput.disabled = isHelped;

    const overlayButton = row.querySelector('[data-role="overlay"]');
    overlayButton.disabled = !isHelped;
    overlayButton.classList.toggle("is-on", isShowing);
    overlayButton.textContent = isShowing ? "隱藏說明卡" : "顯示說明卡";

    row.classList.toggle("is-done", isDone);
    row.classList.toggle("is-helped", isHelped);
    row.classList.toggle("is-showing", isShowing);

    syncProactiveRow(row, key, action, proactive[key], proactiveOverlayKey === key);
  });

  lastHelpedKeys = new Set(Object.keys(helped));

  const total = slides[currentIndex]?.actions.length || 0;
  const doneCount = [...elements.stepList.children]
    .filter((row) => done.has(row.dataset.key)).length;
  elements.stepCount.textContent = `${doneCount} / ${total}`;
}

// 沒有主動提議的步驟不會有這一列，直接跳過。
function syncProactiveRow(row, key, action, entry, isShowing) {
  const overlayButton = row.querySelector('[data-role="proactive-overlay"]');
  if (!overlayButton) return;

  const status = entry?.status || null;
  const costInput = row.querySelector('[data-role="proactive-cost"]');
  // 已經有回答就顯示實際記在帳上的金額，並鎖住輸入框（比照「助手介入」）。
  if (document.activeElement !== costInput) {
    costInput.value = String(status ? entry.cost : proactiveCost(action));
  }
  costInput.disabled = Boolean(status);

  overlayButton.classList.toggle("is-on", isShowing);
  overlayButton.textContent = isShowing ? "隱藏提議卡" : "顯示提議卡";

  row.querySelector('[data-role="accept"]').classList.toggle("is-on", status === "accepted");
  row.querySelector('[data-role="decline"]').classList.toggle("is-on", status === "declined");
  row.querySelector('[data-role="proactive-clear"]').disabled = !status;

  row.classList.toggle("has-proactive", true);
  row.classList.toggle("is-proactive-accepted", status === "accepted");
  row.classList.toggle("is-proactive-declined", status === "declined");
  row.classList.toggle("is-proactive-showing", isShowing);
}

// 說明卡可能屬於別的頁面，所以在步驟清單之外再給一條全域的提示與關閉鈕。
function syncOverlayStatus(state) {
  // 兩種卡共用這條提示；server 保證同時只有一張。
  const proactiveKey = state.proactiveOverlay || null;
  const key = proactiveKey || state.helpOverlay || null;
  elements.overlayStatus.hidden = !key;
  // 關閉鈕要送對應的 action，記在 dataset 上讓 click handler 讀。
  elements.overlayStatus.dataset.mode = proactiveKey ? "proactive" : "assist";
  elements.overlayClose.textContent = proactiveKey ? "關閉提議卡" : "關閉說明卡";
  if (!key) return;

  const [slideIndex, actionIndex] = key.split(":").map(Number);
  const slide = slides[slideIndex];
  const name = slide?.actions[actionIndex]?.name || "";
  const kind = proactiveKey ? "主動提議卡" : "說明卡";
  elements.overlayStatusText.textContent =
    `參與者畫面顯示中（${kind}）：第${slide?.step ?? "?"}頁 · 步驟${stepLabel(actionIndex)}　${name}`;
}

// ---- 點數與帳本 ----------------------------------------------------------

function syncPoints(state) {
  elements.totalPoints.textContent = formatPoints(state.totalPoints);
  elements.remainingPoints.textContent = formatPoints(state.remaining);
  elements.remainingPoints.classList.toggle("negative", state.remaining < 0);
  // 主動幫助是另一個池，總額由 Excel 的「介入」欄算出來（見 server 的 PROACTIVE_TOTAL）。
  elements.remainingProactive.textContent =
    `${formatPoints(state.proactiveRemaining)} / ${formatPoints(state.proactiveTotal)}`;
  elements.remainingProactive.classList.toggle("negative", state.proactiveRemaining < 0);
}

function syncLedger(state) {
  const entries = state.ledger || [];
  elements.ledgerCount.textContent = `${entries.length} 筆`;
  elements.undoButton.disabled = entries.length === 0;

  // 每一列都要顯示「當下餘額」，所以由頭往後累加一次。
  // 兩個池各自累加，每一列只顯示自己那一池的餘額 ——
  // 「不接受」會產生兩列（主動 −N、可指揮 +N），規則就攤在紀錄上。
  const running = { assist: state.totalPoints, proactive: state.proactiveTotal };
  const rows = entries.map((entry) => {
    const pool = entry.pool === "proactive" ? "proactive" : "assist";
    running[pool] += entry.delta;
    const item = document.createElement("li");
    item.className = `ledger-row ${entry.delta < 0 ? "minus" : "plus"} pool-${pool}`;
    item.append(
      Object.assign(document.createElement("span"), { className: "ledger-time", textContent: formatTime(entry.ts) }),
      Object.assign(document.createElement("span"), { className: "ledger-pool", textContent: pool === "proactive" ? "主動" : "可指揮" }),
      Object.assign(document.createElement("span"), { className: "ledger-note", textContent: entry.note }),
      Object.assign(document.createElement("span"), { className: "ledger-delta", textContent: formatDelta(entry.delta) }),
      Object.assign(document.createElement("span"), { className: "ledger-balance", textContent: `→ ${formatPoints(running[pool])}` }),
    );
    return item;
  });

  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "ledger-empty";
    empty.textContent = "尚無點數變動";
    rows.push(empty);
  }

  elements.ledger.replaceChildren(...rows.reverse());
}

// ---- 狀態進來時 ----------------------------------------------------------

function applyState(state) {
  currentIndex = Math.max(0, Math.min(slides.length - 1, state.currentIndex));

  if (currentIndex !== renderedIndex) {
    buildStepList();
    renderedIndex = currentIndex;
  }

  syncPageToggle(state);
  syncStepList(state);
  syncOverlayStatus(state);
  syncPoints(state);
  syncLedger(state);
}

// ---- 事件 ----------------------------------------------------------------

elements.pagePrev.addEventListener("click", () => {
  dispatch({ type: "setPage", index: currentIndex - 1 });
});
elements.pageNext.addEventListener("click", () => {
  dispatch({ type: "setPage", index: currentIndex + 1 });
});

// 整頁一次送一個 action，避免同時發出一堆請求（瀏覽器對同源的連線數有上限）。
function setWholePage(value) {
  const slide = slides[currentIndex];
  if (!slide) return;
  const keys = slide.actions.map((_action, index) => actionKey(currentIndex, index));
  dispatch({ type: "setDoneBulk", keys, value });
}

// 參與者自己捲走之後，把他的步驟列表捲回定位。不動任何實驗資料。
elements.recenter.addEventListener("click", () => dispatch({ type: "recenter" }));
elements.markAll.addEventListener("click", () => setWholePage(true));
elements.clearAll.addEventListener("click", () => setWholePage(false));

function adjustPoints(sign) {
  const amount = Number(elements.adjustInput.value);
  if (!Number.isFinite(amount) || amount === 0) {
    elements.adjustInput.focus();
    return;
  }
  const delta = sign * Math.abs(amount);
  dispatch({
    type: "adjustPoints",
    delta,
    note: delta > 0 ? "手動加點" : "手動扣點",
  });
  elements.adjustInput.value = "";
  elements.adjustInput.focus();
}

elements.adjustAdd.addEventListener("click", () => adjustPoints(1));
// Enter 直接送出 = 扣點（實驗中扣點遠比加點常用）。
elements.adjustForm.addEventListener("submit", (event) => {
  event.preventDefault();
  adjustPoints(-1);
});

elements.overlayClose.addEventListener("click", () => {
  const proactive = elements.overlayStatus.dataset.mode === "proactive";
  dispatch({ type: proactive ? "setProactiveOverlay" : "setHelpOverlay", key: null });
});

elements.undoButton.addEventListener("click", () => dispatch({ type: "undoLedger" }));
elements.resetButton.addEventListener("click", () => {
  if (confirm("確定要重置全部狀態嗎？頁面、勾選與所有點數紀錄都會清空。")) {
    dispatch({ type: "reset" });
  }
});

window.WozStore.onStatus((status) => {
  elements.offlineBanner.hidden = status !== "disconnected";
  elements.conn.dataset.status = status;
  elements.connLabel.textContent = {
    connecting: "連線中…",
    connected: "已連線",
    disconnected: "未連線",
  }[status];
});

buildPageToggle();
window.WozStore.subscribe(applyState);

// 圖片清單回來後重建一次步驟清單，把 🖼 記號補上。
window.WozImages.onLoad(() => {
  renderedIndex = -1;
  if (window.WozStore.state) applyState(window.WozStore.state);
});
window.WozImages.load();
