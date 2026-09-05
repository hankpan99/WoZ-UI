// Wizard 控制台。所有操作都只是送一個 action 給 server，
// 規則與狀態都在 server/state.py，這一頁不自己算任何東西。
const slides = window.RECIPE_SLIDES || [];
const { actionKey, formatPoints, formatDelta, cleanLabel, formatTime } = window.WozFormat;
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
  adjustForm: document.querySelector("#adjust-form"),
  adjustInput: document.querySelector("#adjust-input"),
  adjustAdd: document.querySelector("#adjust-add"),
  ledger: document.querySelector("#ledger"),
  ledgerCount: document.querySelector("#ledger-count"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  offlineBanner: document.querySelector("#offline-banner"),
};

let currentIndex = 0;
// 上一次真正重建過步驟清單的頁碼；同一頁的更新只做同步，
// 才不會把 wizard 正在輸入的花費欄位洗掉。
let renderedIndex = -1;

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
        Object.assign(document.createElement("span"), {
          className: "step-list-price",
          textContent: `原價 ${formatPoints(action.cost)} 點`,
        }),
      );

      const helpRow = document.createElement("div");
      helpRow.className = "help-row";

      const costInput = document.createElement("input");
      costInput.className = "cost-input";
      costInput.type = "number";
      costInput.step = "any";
      costInput.dataset.role = "cost";
      costInput.value = String(action.cost);

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
      helpLabel.append(helpBox, Object.assign(document.createElement("span"), { textContent: "接受幫助" }));

      helpRow.append(
        helpLabel,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "花費" }),
        costInput,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
      );

      body.append(title, helpRow);
      row.append(doneLabel, body);
      return row;
    }),
  );
}

function syncStepList(state) {
  const done = new Set(state.done);
  const helped = state.helped || {};

  [...elements.stepList.children].forEach((row) => {
    const key = row.dataset.key;
    const isDone = done.has(key);
    const isHelped = Object.prototype.hasOwnProperty.call(helped, key);

    row.querySelector('[data-role="done"]').checked = isDone;
    const helpBox = row.querySelector('[data-role="helped"]');
    helpBox.checked = isHelped;

    const costInput = row.querySelector('[data-role="cost"]');
    // 已勾選的一定顯示帳本裡的金額；未勾選就保留 wizard 打好的值。
    // 正在輸入的欄位不動，避免打到一半被覆蓋。
    if (isHelped && document.activeElement !== costInput) {
      costInput.value = String(helped[key]);
    }
    costInput.disabled = isHelped;

    row.classList.toggle("is-done", isDone);
    row.classList.toggle("is-helped", isHelped);
  });

  const total = slides[currentIndex]?.actions.length || 0;
  const doneCount = [...elements.stepList.children]
    .filter((row) => done.has(row.dataset.key)).length;
  elements.stepCount.textContent = `${doneCount} / ${total}`;
}

// ---- 點數與帳本 ----------------------------------------------------------

function syncPoints(state) {
  elements.totalPoints.textContent = formatPoints(state.totalPoints);
  elements.remainingPoints.textContent = formatPoints(state.remaining);
  elements.remainingPoints.classList.toggle("negative", state.remaining < 0);
}

function syncLedger(state) {
  const entries = state.ledger || [];
  elements.ledgerCount.textContent = `${entries.length} 筆`;
  elements.undoButton.disabled = entries.length === 0;

  // 每一列都要顯示「當下餘額」，所以由頭往後累加一次。
  let running = state.totalPoints;
  const rows = entries.map((entry) => {
    running += entry.delta;
    const item = document.createElement("li");
    item.className = `ledger-row ${entry.delta < 0 ? "minus" : "plus"}`;
    item.append(
      Object.assign(document.createElement("span"), { className: "ledger-time", textContent: formatTime(entry.ts) }),
      Object.assign(document.createElement("span"), { className: "ledger-note", textContent: entry.note }),
      Object.assign(document.createElement("span"), { className: "ledger-delta", textContent: formatDelta(entry.delta) }),
      Object.assign(document.createElement("span"), { className: "ledger-balance", textContent: `→ ${formatPoints(running)}` }),
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
