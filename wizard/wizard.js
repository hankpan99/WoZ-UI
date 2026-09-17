// Wizard 控制台。所有操作都只是送一個 action 給 server，
// 規則與狀態都在 server/state.py，這一頁不自己算任何東西。
const slides = window.RECIPE_SLIDES || [];
const {
  actionKey, formatPoints, formatDelta, cleanLabel, pickedDetails, helpCost,
  proactiveDetails, proactiveLevel, proactiveCost, helpOverlayEntry, executedCost,
} = window.WozFormat;
const { dispatch } = window.WozStore;

const elements = {
  pageToggle: document.querySelector("#page-toggle"),
  conn: document.querySelector("#conn"),
  connLabel: document.querySelector("#conn-label"),
  stepList: document.querySelector("#step-list"),
  stepCount: document.querySelector("#step-count"),
  viewPrev: document.querySelector("#view-prev"),
  viewNext: document.querySelector("#view-next"),
  clientViewStatus: document.querySelector("#client-view-status"),
  clientViewStatusText: document.querySelector("#client-view-status-text"),
  clientViewClose: document.querySelector("#client-view-close"),
  markAll: document.querySelector("#mark-all"),
  clearAll: document.querySelector("#clear-all"),
  remainingPoints: document.querySelector("#remaining-points"),
  remainingProactive: document.querySelector("#remaining-proactive"),
  soundToggle: document.querySelector("#sound-toggle"),
  ledger: document.querySelector("#ledger"),
  ledgerCount: document.querySelector("#ledger-count"),
  exportButton: document.querySelector("#export-button"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  overlayStatus: document.querySelector("#overlay-status"),
  overlayStatusText: document.querySelector("#overlay-status-text"),
  overlayClose: document.querySelector("#overlay-close"),
  offlineBanner: document.querySelector("#offline-banner"),
  assistantCurrent: document.querySelector("#assistant-current"),
  assistantStop: document.querySelector("#assistant-stop"),
  assistantDone: document.querySelector("#assistant-done"),
  assistantStopEditor: document.querySelector("#assistant-stop-editor"),
  assistantQueueCount: document.querySelector("#assistant-queue-count"),
  assistantQueueList: document.querySelector("#assistant-queue-list"),
  assistantBusyHint: document.querySelector("#assistant-busy-hint"),
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
// 「修正執行動作」的草稿：recordId -> { details: Set, cost: string|null }；cost 為 null＝照規則自動算。
const executionDrafts = new Map();
// 展開中的修正編輯器：紀錄的 recordId，或喊停用的 "stop"。
const openEditors = new Set();
const intervention = window.WizardIntervention.create(dispatch, () => {
  if (window.WozStore.state) syncStepList(window.WozStore.state);
});

const pageLabel = (slide) => {
  const meal = cleanLabel(slide.meal);
  const stage = cleanLabel(slide.stage);
  return [meal, stage].filter(Boolean).join(" · ");
};

// 按鈕上顯示的名稱只簡化「餐點」這一段，方便一行放得下；
// 完整名稱還是留在 title/aria-label 裡。
const MEAL_SHORT_NAMES = {
  巴斯克蛋糕: "蛋糕",
  法式吐司: "吐司",
  水果優格: "優格",
};
const STAGE_SHORT_NAMES = {
  "拿用具、食材": "拿取",
};
const pageButtonLabel = (slide) => {
  const meal = cleanLabel(slide.meal);
  const stage = cleanLabel(slide.stage);
  const shortMeal = MEAL_SHORT_NAMES[meal] || meal;
  const shortStage = STAGE_SHORT_NAMES[stage] || stage;
  return [shortMeal, shortStage].filter(Boolean).join(" - ");
};

// 頁碼按鈕要排成 4 行；目前 20 個階段是照這個順序寫死分行點
// （第 4、8、15 頁之後另起一行）。之後食譜階段數變了要手動調整這裡。
const PAGE_ROW_BREAKS = [4, 8, 15];
// 第 1~8 頁放左半邊、其餘放右半邊（同樣是寫死，配合上面的分行點）。
const PAGE_COLUMN_SPLIT_AFTER_STEP = 8;

// Wizard 的主步驟與 Client 一致，使用 A, B, ... Z, AA ... 編號。
function stepLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

// ---- 頁面切換器 ----------------------------------------------------------

function buildPageToggle() {
  const columns = [];
  let col = document.createElement("div");
  col.className = "page-toggle-col";
  columns.push(col);
  let row = document.createElement("div");
  row.className = "page-toggle-row";
  col.append(row);

  slides.forEach((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-button";
    button.dataset.index = String(index);
    button.append(
      Object.assign(document.createElement("span"), {
        className: "page-button-index",
        textContent: slide.step,
      }),
      Object.assign(document.createElement("span"), {
        className: "page-button-label",
        textContent: pageButtonLabel(slide) || "—",
      }),
    );
    button.setAttribute("aria-label", `第 ${slide.step} 頁：${pageLabel(slide)}`);
    button.addEventListener("click", () => dispatch({ type: "setPage", index }));
    row.append(button);

    const stepNum = Number(slide.step);
    const isLast = index === slides.length - 1;
    if (!isLast && (PAGE_ROW_BREAKS.includes(stepNum) || stepNum === PAGE_COLUMN_SPLIT_AFTER_STEP)) {
      row = document.createElement("div");
      row.className = "page-toggle-row";
      if (stepNum === PAGE_COLUMN_SPLIT_AFTER_STEP) {
        col = document.createElement("div");
        col.className = "page-toggle-col";
        columns.push(col);
      }
      col.append(row);
    }
  });

  elements.pageToggle.replaceChildren(...columns);
}

function syncPageToggle(state) {
  const doneSet = new Set(state.done);
  const proactiveState = state.proactive || {};

  elements.pageToggle.querySelectorAll(".page-button").forEach((button) => {
    const index = Number(button.dataset.index);
    const slide = slides[index];
    const actions = slide?.actions || [];

    // 該頁的動作是否全部完成：全部完成就把文字淡出，讓還沒做完的頁面比較顯眼。
    const allDone = actions.length > 0
      && actions.every((_action, actionIndex) => doneSet.has(actionKey(index, actionIndex)));
    // 該頁是否還有主動幫助沒選「接受」或「拒絕」。
    const hasPendingProactive = actions.some((action, actionIndex) =>
      proactiveDetails(action).length > 0
      && !proactiveState[actionKey(index, actionIndex)]?.status);

    button.classList.toggle("current", index === currentIndex);
    button.classList.toggle("stage-complete", allDone);
    button.classList.toggle("proactive-pending", hasPendingProactive);
    button.setAttribute("aria-pressed", String(index === currentIndex));
    button.title = [
      pageLabel(slide) || `第 ${slide?.step ?? "?"} 頁`,
      allDone ? "已全部完成" : null,
      hasPendingProactive ? "有主動幫助待決定" : null,
    ].filter(Boolean).join(" · ");
  });
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
      if (proactiveDetails(action).length > 0) {
        row.dataset.proactiveLevel = proactiveLevel(action).startsWith("4.") ? "4" : "3";
      }

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
        Object.assign(document.createElement("span"), { className: "step-index", textContent: `${stepLabel(index)}.` }),
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

      const clientViewButton = document.createElement("button");
      clientViewButton.type = "button";
      clientViewButton.className = "client-view-button";
      clientViewButton.dataset.role = "client-view";
      clientViewButton.textContent = "預覽此步驟";
      clientViewButton.addEventListener("click", () => {
        dispatch({ type: "setClientView", key: window.WozStore.state?.clientViewKey === key ? null : key });
      });
      title.insertBefore(clientViewButton, title.querySelector(".step-list-price"));

      const helpRow = document.createElement("div");
      helpRow.className = "help-row";

      const costInput = document.createElement("input");
      costInput.className = "cost-input";
      costInput.type = "number";
      costInput.step = "any";
      costInput.dataset.role = "cost";
      costInput.value = String(action.cost);
      // 一旦 wizard 自己打了數字，就不要再被詳細步驟的自動計價蓋掉。
      costInput.min = "0";
      costInput.addEventListener("input", () => {
        manualCostKeys.add(key);
        if (window.WozStore.state) syncStepList(window.WozStore.state);
      });
      manualCostKeys.delete(key);

      const interventionModes = document.createElement("div");
      interventionModes.className = "intervention-mode-buttons";
      [
        ["physical", "1. 參與者指揮 - 實體"],
        ["voice", "1. 參與者指揮 - 語音"],
        ["voice_reminder", "2. 語音提醒建議"],
      ].forEach(([mode, text]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `intervention-mode-button ${mode}`;
        button.dataset.role = "help-mode";
        button.dataset.mode = mode;
        button.dataset.category = mode === "voice_reminder" ? "proactive" : "passive";
        button.textContent = text;
        if (mode === "voice_reminder") button.disabled = true;
        button.addEventListener("click", () => {
          expandedKeys.add(key);
          intervention.select(key, mode);
        });
        interventionModes.append(button);
      });

      const executeButton = document.createElement("button");
      executeButton.type = "button";
      executeButton.className = "execute-intervention-button";
      executeButton.dataset.role = "execute-intervention";
      executeButton.disabled = true;
      executeButton.textContent = "執行介入";
      executeButton.addEventListener("click", async () => {
        if (await intervention.execute(key, costInput.valueAsNumber)) {
          manualCostKeys.delete(key);
          if (window.WozStore.state) syncStepList(window.WozStore.state);
        }
      });

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
        interventionModes,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "花費" }),
        costInput,
        Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
        executeButton,
        overlayButton,
      );
      helpRow.append(Object.assign(document.createElement("span"), {
        className: "repeatable-hint",
        textContent: "先選模式與動作，再按執行介入才扣點並新增紀錄。",
      }));

      body.append(title);
      const proactiveRow = buildProactiveRow(key, action, slide, index);
      if (proactiveRow) body.append(proactiveRow);
      body.append(helpRow);
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

  // 與下方「被動等待」使用相同的 TODO checkbox 外觀。
  // 這個 checkbox 只負責顯示／收起提議卡，接受與扣點仍由右側按鈕決定。
  const overlayLabel = document.createElement("label");
  overlayLabel.className = "check proactive-check intervention-check";
  const overlayBox = document.createElement("input");
  overlayBox.type = "checkbox";
  overlayBox.dataset.role = "proactive-overlay";
  overlayBox.addEventListener("change", async () => {
    const requestedKey = overlayBox.checked ? key : null;
    const result = await dispatch({ type: "setProactiveOverlay", key: requestedKey });
    // Excel 轉換後若沒重啟 server，Wizard 可能看到新按鈕，server 卻仍用舊食譜。
    if (requestedKey && result?.changed === false
      && window.WozStore.state?.proactiveOverlay !== requestedKey) {
      overlayBox.checked = false;
      window.alert("server 仍在使用舊食譜資料。請重新啟動 server，再重新整理 Wizard 和 Client。");
    }
  });
  overlayLabel.append(
    overlayBox,
    Object.assign(document.createElement("span"), {
      textContent: `${proactiveLevel(action)}實體介入 ${marks.length}/${(action.details || []).length}`,
      title: `第${slide.step}頁 · 步驟${stepLabel(index)} 在 Excel「介入」欄標了 ${marks.length} 條`,
    }),
  );

  const cost = proactiveCost(action);
  const costInput = document.createElement("input");
  costInput.className = "cost-input";
  costInput.type = "number";
  costInput.step = "any";
  costInput.dataset.role = "proactive-cost";
  costInput.value = String(cost);

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

  const busyHint = Object.assign(document.createElement("span"), { className: "busy-hint", hidden: true });
  busyHint.dataset.role = "proactive-busy";

  row.append(
    overlayLabel,
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "花費" }),
    costInput,
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
    answerButton("accept", "接受", "accepted"),
    answerButton("decline", "不接受", "declined"),
    clearButton,
    busyHint,
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
      Object.assign(document.createElement("span"), {
        className: "detail-executed",
        textContent: "已執行",
        hidden: true,
      }),
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
  const helpModes = state.helpModes || {};
  const proactive = state.proactive || {};
  const overlayKey = state.helpOverlay || null;
  const proactiveOverlayKey = state.proactiveOverlay || null;
  // 主動類（模式 2、3、4）不取代正在執行的項目：送出仍可以，但要提醒 wizard。
  const busyText = state.assistantCurrent
    ? `⚠ Alex 正在執行「${itemLabel(state.assistantCurrent)}」；關閉字卡後會排在佇列最前面，需再開一次字卡。`
    : "";
  const executedByKey = new Map();
  (state.ledger || []).forEach((entry) => {
    if (entry.kind !== "help" || !entry.key) return;
    const [slideIndex, actionIndex] = entry.key.split(":").map(Number);
    const total = slides[slideIndex]?.actions[actionIndex]?.details?.length || 0;
    const selected = entry.selectedDetails || pickedDetails(state, entry.key, total);
    if (!executedByKey.has(entry.key)) executedByKey.set(entry.key, new Set());
    selected.forEach((index) => executedByKey.get(entry.key).add(index));
  });

  [...elements.stepList.children].forEach((row, index) => {
    const key = row.dataset.key;
    const action = slides[currentIndex]?.actions[index];
    const details = action?.details || [];
    const picked = new Set(pickedDetails(state, key, details.length));
    const isDone = done.has(key);
    const isHelped = Object.prototype.hasOwnProperty.call(helped, key);
    const isShowing = overlayKey === key;

    row.querySelector('[data-role="done"]').checked = isDone;
    row.querySelector(".done-check > span").textContent = isDone ? "✓ 已完成" : "完成";
    const helpMode = isHelped ? (helpModes[key] || "physical") : null;
    const selectedMode = intervention.mode(key);
    const executing = intervention.busy(key);
    row.querySelectorAll('[data-role="help-mode"]').forEach((button) => {
      button.classList.toggle("is-on", selectedMode === button.dataset.mode);
      button.setAttribute("aria-pressed", String(selectedMode === button.dataset.mode));
      button.disabled = executing;
      if (button.dataset.mode === "voice_reminder") {
        const supported = state.supportedHelpModes?.includes("voice_reminder");
        button.disabled = executing || !supported;
        button.title = supported ? "" : "請重啟 server 以啟用模式 2";
      }
    });

    // 剛勾成「接受幫助」的步驟自動展開，讓 wizard 可以馬上調要代勞哪幾條。
    if (isHelped && !lastHelpedKeys.has(key)) expandedKeys.add(key);

    row.querySelectorAll("[data-detail-index]").forEach((box) => {
      const detailIndex = Number(box.dataset.detailIndex);
      box.checked = picked.has(detailIndex);
      const executed = executedByKey.get(key)?.has(detailIndex) || false;
      box.closest(".detail-check").querySelector(".detail-executed").hidden = !executed;
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
      // 每個步驟都顯示下一次的預估花費。
      // wizard 手動打過的數字仍優先，直到再調整詳細動作或按下一次介入。
      if (!manualCostKeys.has(key)) costInput.value = String(helpCost(action, picked.size));
    }
    costInput.disabled = executing;
    const executeButton = row.querySelector('[data-role="execute-intervention"]');
    const validCost = Number.isFinite(costInput.valueAsNumber) && costInput.valueAsNumber >= 0;
    const supportedMode = selectedMode !== "voice_reminder" || state.supportedHelpModes?.includes("voice_reminder");
    executeButton.disabled = !selectedMode || executing || !validCost || !supportedMode;
    executeButton.textContent = executing ? "執行中…" : `執行介入（扣 ${validCost ? formatPoints(costInput.valueAsNumber) : "—"} 點）`;
    executeButton.dataset.mode = selectedMode || "";
    const hint = row.querySelector(".repeatable-hint");
    hint.setAttribute("role", "status");
    const reminderBusy = selectedMode === "voice_reminder" ? busyText : "";
    hint.textContent = intervention.message(key) || reminderBusy || "先選模式與動作，再按執行介入才扣點並新增紀錄；模式 1 會排進助手佇列。";
    hint.classList.toggle("is-warning", !intervention.message(key) && Boolean(reminderBusy));
    row.querySelectorAll("[data-detail-index], .mini-button").forEach((control) => { control.disabled = executing; });

    const overlayButton = row.querySelector('[data-role="overlay"]');
    overlayButton.disabled = !isHelped;
    overlayButton.classList.toggle("is-on", isShowing);
    overlayButton.textContent = isShowing ? "隱藏說明卡" : "顯示說明卡";

    row.classList.toggle("is-done", isDone);
    row.classList.toggle("is-helped", isHelped);
    row.classList.toggle("is-help-reminder", helpMode === "voice_reminder");
    row.classList.toggle("is-showing", isShowing);
    const isClientView = state.clientViewKey === key;
    row.classList.toggle("is-client-view", isClientView);
    const clientViewButton = row.querySelector('[data-role="client-view"]');
    clientViewButton.classList.toggle("is-on", isClientView);
    clientViewButton.setAttribute("aria-pressed", String(isClientView));
    clientViewButton.title = isClientView ? "取消預覽此步驟，回到當前步驟" : "預覽此步驟";

    syncProactiveRow(row, key, action, proactive[key], proactiveOverlayKey === key, busyText);
  });

  lastHelpedKeys = new Set(Object.keys(helped));

  const total = slides[currentIndex]?.actions.length || 0;
  const doneCount = [...elements.stepList.children]
    .filter((row) => done.has(row.dataset.key)).length;
  elements.stepCount.textContent = `${doneCount} / ${total}`;
}

// 沒有主動提議的步驟不會有這一列，直接跳過。
function syncProactiveRow(row, key, action, entry, isShowing, busyText) {
  const overlayBox = row.querySelector('[data-role="proactive-overlay"]');
  if (!overlayBox) return;

  const status = entry?.status || null;
  const busyHint = row.querySelector('[data-role="proactive-busy"]');
  // 已經回答過的提議就不用再提醒。
  busyHint.hidden = !busyText || Boolean(status);
  busyHint.textContent = busyText;
  const costInput = row.querySelector('[data-role="proactive-cost"]');
  // 已經有回答就顯示實際記在帳上的金額，並鎖住輸入框（比照「助手介入」）。
  if (document.activeElement !== costInput) {
    costInput.value = String(status ? entry.cost : proactiveCost(action));
  }
  costInput.disabled = Boolean(status);

  overlayBox.checked = isShowing;

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
  document.querySelectorAll("[data-actor-error]").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.actorError === button.dataset.actorError));
  });
  const actorStatus = document.querySelector("#actor-overlay-status");
  actorStatus.hidden = !state.actorError && !state.actorOverlay;
  const actorOverlay = state.actorOverlay;
  actorStatus.dataset.mode = state.actorError ? "error" : actorOverlay?.proactive ? "proactive" : "assist";
  if (state.actorError) {
    delete actorStatus.dataset.interventionLevel;
    document.querySelector("#actor-overlay-status-text").textContent =
      `Actor UI 顯示中（向參與者說明）：${window.ACTOR_SPEECH.explanation[state.actorError] || state.actorError}`;
  } else if (actorOverlay) {
    const [page, step] = actorOverlay.key.split(":").map(Number);
    document.querySelector("#actor-overlay-status-text").textContent =
      `Actor UI 顯示中（${actorOverlay.proactive ? "主動提議卡" : "說明卡"}）：第${slides[page]?.step}頁 · 步驟${stepLabel(step)}　${slides[page]?.actions[step]?.name || ""}`;
    actorStatus.dataset.interventionLevel = actorOverlay.proactive
      ? (proactiveLevel(slides[page]?.actions[step]).startsWith("4.") ? "4" : "3")
      : actorOverlay.mode === "voice_reminder" ? "2" : "1";
  }
  // 兩種卡共用這條提示；server 保證同時只有一張。
  const proactiveKey = state.proactiveOverlay || null;
  const key = proactiveKey || state.helpOverlay || null;
  elements.overlayStatus.hidden = !key;
  const [slideIndex, actionIndex] = key ? key.split(":").map(Number) : [];
  const action = slides[slideIndex]?.actions[actionIndex];
  const helpMode = helpOverlayEntry(state)?.helpMode || state.helpModes?.[key];
  elements.overlayStatus.dataset.interventionLevel = proactiveKey
    ? (proactiveLevel(action).startsWith("4.") ? "4" : "3")
    : (helpMode === "voice_reminder" ? "2" : "1");
  // 關閉鈕要送對應的 action，記在 dataset 上讓 click handler 讀。
  elements.overlayStatus.dataset.mode = proactiveKey ? "proactive" : "assist";
  elements.overlayStatus.dataset.category = proactiveKey || helpMode === "voice_reminder" ? "proactive" : "passive";
  // 這張卡屬於排隊中的項目時，關卡＝開始執行（助手在忙就排到最前面）。
  const startsOnClose = proactiveKey
    ? (state.assistantQueue || []).some((item) => item.source === "proactive" && item.key === proactiveKey)
    : Boolean(state.helpOverlayItem);
  elements.overlayClose.textContent = !startsOnClose ? "關閉 Client UI 顯示"
    : state.assistantCurrent ? "關閉 Client UI 顯示（排到佇列最前面）" : "關閉 Client UI 顯示（開始執行）";
  if (!key) return;

  const slide = slides[slideIndex];
  const name = slide?.actions[actionIndex]?.name || "";
  const kind = proactiveKey ? "主動提議卡" : "說明卡";
  elements.overlayStatusText.textContent =
    `Client UI 顯示中（${kind}）：第${slide?.step ?? "?"}頁 · 步驟${stepLabel(actionIndex)}　${name}`;
}

function syncClientViewStatus(state) {
  const key = state.clientViewKey || null;
  elements.clientViewStatus.hidden = !key;

  const actions = slides[currentIndex]?.actions || [];
  const [slideIndex, actionIndex] = key ? key.split(":").map(Number) : [];
  const action = slides[slideIndex]?.actions[actionIndex];
  if (key && action) {
    elements.clientViewStatusText.textContent =
      `Client 正在查看：步驟 ${stepLabel(actionIndex)}　${action.name}`;
  }

  const done = new Set(state.done || []);
  const firstUndone = actions.findIndex((_action, index) =>
    !done.has(actionKey(currentIndex, index)));
  const fallback = firstUndone === -1 ? Math.max(0, actions.length - 1) : firstUndone;
  const viewed = slideIndex === currentIndex ? actionIndex : fallback;
  elements.viewPrev.disabled = !actions.length || viewed <= 0;
  elements.viewNext.disabled = !actions.length || viewed >= actions.length - 1;
}

// ---- 助手佇列與執行修正 --------------------------------------------------

const MODE_TAGS = {
  physical: ["1. 實體", "1"],
  voice: ["1. 語音", "1"],
  voice_reminder: ["2. 語音提醒", "2"],
  inquiry: ["3. 詢問後介入", "3"],
  direct: ["4. 直接介入", "4"],
};
const EXECUTION_LABELS = {
  queued: "排隊中", running: "執行中", completed: "已完成", stopped: "中途停止", cancelled: "已取消",
};

function locate(key) {
  const [slideIndex, actionIndex] = key.split(":").map(Number);
  const slide = slides[slideIndex];
  return { slideIndex, actionIndex, slide, action: slide?.actions[actionIndex] };
}

function itemLabel(item) {
  const { slide, actionIndex, action } = locate(item.key);
  return action ? `第${slide.step}頁 · 步驟${stepLabel(actionIndex)}　${action.name}` : item.key;
}

function itemSummary(item) {
  const [text, level] = MODE_TAGS[item.mode] || MODE_TAGS.physical;
  const summary = document.createElement("span");
  summary.className = "queue-summary";
  summary.append(
    Object.assign(document.createElement("span"), { className: `queue-mode level-${level}`, textContent: text }),
    Object.assign(document.createElement("span"), { className: "queue-label", textContent: itemLabel(item) }),
  );
  return summary;
}

// 一筆紀錄可以修正的範圍：help 用該筆帳目當時的勾選快照；主動提議用 Excel 的標記。
function executionTarget(state, { entryId, proactiveKey }) {
  if (entryId) {
    const entry = (state.ledger || []).find((item) => item.kind === "help" && item.id === entryId);
    if (!entry) return null;
    const { action } = locate(entry.key);
    const base = entry.selectedDetails || [...Array(action?.details?.length || 0).keys()];
    const original = entry.originalCost ?? -entry.delta;
    return {
      recordId: `help:${entry.id}`, action, base, original,
      executed: entry.executedDetails || base,
      payload: { entryId },
    };
  }
  const result = state.proactive?.[proactiveKey];
  if (result?.status !== "accepted") return null;
  const { action } = locate(proactiveKey);
  const base = proactiveDetails(action);
  return {
    recordId: `proactive:${proactiveKey}`, action, base, original: result.cost,
    executed: result.executedDetails || base,
    payload: { proactiveKey },
  };
}

const itemTarget = (state, item) => executionTarget(
  state, item.source === "help" ? { entryId: item.entryId } : { proactiveKey: item.key },
);

// server/state.py 的 execution_status() 鏡像。
function executionStatus(state, target) {
  const { entryId, proactiveKey } = target.payload;
  const matches = (item) => (entryId
    ? item.entryId === entryId
    : item.source === "proactive" && item.key === proactiveKey);
  if ((state.assistantQueue || []).some(matches)) return "queued";
  if (state.assistantCurrent && matches(state.assistantCurrent)) return "running";
  const source = entryId
    ? (state.ledger || []).find((item) => item.id === entryId)
    : state.proactive?.[proactiveKey];
  return source?.executionStatus || "completed";
}

// 狀態每次進來都會重建佇列與紀錄；重建後把游標放回原本的欄位。
function withFocusKept(rebuild) {
  const focus = document.activeElement?.dataset?.focus;
  rebuild();
  if (focus) document.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus();
}

function refreshExecutionViews() {
  const state = window.WozStore.state;
  if (!state) return;
  withFocusKept(() => {
    syncAssistantQueue(state);
    syncLedger(state);
  });
}

// 勾選實際做過的動作 → 依規則自動算花費（可手改）→ 送出。喊停與紀錄修正共用。
function buildExecutionEditor(target, submitLabel, submit, close) {
  if (!executionDrafts.has(target.recordId)) {
    executionDrafts.set(target.recordId, { details: new Set(target.executed), cost: null });
  }
  const draft = executionDrafts.get(target.recordId);
  const details = target.action?.details || [];
  const autoCost = () => executedCost(target.action, draft.details.size, target.base.length, target.original);
  const costValue = () => (draft.cost === null ? autoCost() : Number(draft.cost));

  const editor = document.createElement("div");
  editor.className = "execution-editor";

  const head = document.createElement("div");
  head.className = "detail-head";
  head.append(Object.assign(document.createElement("span"), {
    className: "execution-editor-title",
    textContent: `實際做過的動作 ${draft.details.size} / ${target.base.length}`,
  }));
  [["全選", true], ["全不選", false]].forEach(([text, value]) => {
    const button = Object.assign(document.createElement("button"), {
      type: "button", className: "mini-button", textContent: text,
    });
    button.addEventListener("click", () => {
      draft.details = new Set(value ? target.base : []);
      draft.cost = null;
      refreshExecutionViews();
    });
    head.append(button);
  });

  const checks = document.createElement("div");
  checks.className = "detail-checks";
  if (!target.base.length) {
    checks.append(Object.assign(document.createElement("span"), {
      className: "execution-editor-empty", textContent: "這次沒有更細的動作，請直接填實際花費。",
    }));
  }
  target.base.forEach((detailIndex) => {
    const label = document.createElement("label");
    label.className = "detail-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = draft.details.has(detailIndex);
    box.dataset.focus = `${target.recordId}:detail:${detailIndex}`;
    box.addEventListener("change", () => {
      if (box.checked) draft.details.add(detailIndex);
      else draft.details.delete(detailIndex);
      draft.cost = null;
      refreshExecutionViews();
    });
    label.append(
      box,
      Object.assign(document.createElement("span"), {
        className: "detail-check-index", textContent: String(detailIndex + 1).padStart(2, "0"),
      }),
      Object.assign(document.createElement("span"), {
        className: "detail-check-text", textContent: details[detailIndex] || "",
      }),
    );
    checks.append(label);
  });

  const foot = document.createElement("div");
  foot.className = "execution-editor-foot";
  const costInput = document.createElement("input");
  costInput.className = "cost-input";
  costInput.type = "number";
  costInput.step = "any";
  costInput.min = "0";
  costInput.dataset.focus = `${target.recordId}:cost`;
  costInput.value = String(costValue());

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "execute-intervention-button";
  const syncSubmit = () => {
    const value = costValue();
    const valid = Number.isFinite(value) && value >= 0;
    submitButton.disabled = !valid;
    submitButton.textContent = `${submitLabel}（原本 ${formatPoints(target.original)} → ${valid ? formatPoints(value) : "—"} 點）`;
  };
  costInput.addEventListener("input", () => {
    draft.cost = costInput.value;
    syncSubmit();
  });
  submitButton.addEventListener("click", async () => {
    const cost = costValue();
    if (!Number.isFinite(cost) || cost < 0) return;
    submitButton.disabled = true;
    const result = await submit({ details: [...draft.details].sort((a, b) => a - b), cost });
    if (result?.changed) {
      executionDrafts.delete(target.recordId);
      close();
    } else {
      window.alert("修正沒有送出，請確認連線與 server 狀態（新功能需要重啟 server）。");
      syncSubmit();
    }
  });
  syncSubmit();

  const cancelButton = Object.assign(document.createElement("button"), {
    type: "button", className: "ghost-button", textContent: "取消",
  });
  cancelButton.addEventListener("click", () => {
    executionDrafts.delete(target.recordId);
    close();
  });

  foot.append(
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "實際花費" }),
    costInput,
    Object.assign(document.createElement("span"), { className: "cost-caption", textContent: "點" }),
    submitButton,
    cancelButton,
  );
  editor.append(head, checks, foot);
  return editor;
}

function syncAssistantQueue(state) {
  const current = state.assistantCurrent || null;
  const currentTarget = current ? itemTarget(state, current) : null;
  if (!currentTarget) openEditors.delete("stop");

  elements.assistantCurrent.replaceChildren(current
    ? itemSummary(current)
    : Object.assign(document.createElement("span"), { className: "queue-empty", textContent: "閒置中" }));
  elements.assistantStop.disabled = !currentTarget;
  elements.assistantDone.disabled = !current;
  const stopOpen = openEditors.has("stop");
  elements.assistantStop.classList.toggle("is-on", stopOpen);
  elements.assistantStop.setAttribute("aria-expanded", String(stopOpen));
  elements.assistantStopEditor.hidden = !stopOpen;
  elements.assistantStopEditor.replaceChildren(...(stopOpen ? [buildExecutionEditor(
    currentTarget, "確認喊停",
    (payload) => dispatch({ type: "stopCurrent", ...payload }),
    () => { openEditors.delete("stop"); refreshExecutionViews(); },
  )] : []));

  const queue = state.assistantQueue || [];
  elements.assistantQueueCount.textContent = `${queue.length} 項`;
  elements.assistantBusyHint.hidden = !current;
  const rows = queue.map((item, index) => {
    const row = document.createElement("li");
    row.className = "assistant-queue-item";
    const showing = item.source === "help"
      ? state.helpOverlayItem === item.id
      : state.proactiveOverlay === item.key;
    row.classList.toggle("is-showing", showing);

    const showButton = document.createElement("button");
    showButton.type = "button";
    showButton.className = `ghost-button queue-show-button${showing ? " is-showing" : ""}`;
    showButton.textContent = showing ? (current ? "關閉字卡" : "關閉字卡（開始執行）") : "顯示字卡";
    showButton.addEventListener("click", () => {
      if (item.source === "help") {
        dispatch({ type: "setHelpOverlay", key: showing ? null : item.key, itemId: item.id });
      } else {
        dispatch({ type: "setProactiveOverlay", key: showing ? null : item.key });
      }
    });

    const cancelButton = Object.assign(document.createElement("button"), {
      type: "button", className: "ghost-button", textContent: "取消",
    });
    cancelButton.addEventListener("click", () => {
      if (confirm(`確定取消「${itemLabel(item)}」嗎？紀錄會保留並改成已取消、0 點。`)) {
        dispatch({ type: "cancelQueued", itemId: item.id });
      }
    });

    row.append(
      Object.assign(document.createElement("span"), { className: "queue-order", textContent: `#${index + 1}` }),
      itemSummary(item),
      showButton,
      cancelButton,
    );
    return row;
  });
  if (!rows.length) {
    rows.push(Object.assign(document.createElement("li"), {
      className: "queue-empty", textContent: "目前沒有排隊的指令",
    }));
  }
  elements.assistantQueueList.replaceChildren(...rows);
}

// ---- 點數與帳本 ----------------------------------------------------------

function syncPoints(state) {
  elements.remainingPoints.textContent =
    `${formatPoints(state.remaining)} / ${formatPoints(state.totalPoints)}`;
  elements.remainingPoints.classList.toggle("negative", state.remaining < 0);
  // 主動幫助是另一個池，總額由 Excel 的「介入」欄算出來（見 server 的 PROACTIVE_TOTAL）。
  elements.remainingProactive.textContent =
    `${formatPoints(state.proactiveRemaining)} / ${formatPoints(state.proactiveTotal)}`;
  elements.remainingProactive.classList.toggle("negative", state.proactiveRemaining < 0);
}

function selectionSummary(action, pickedIndexes) {
  const details = action?.details || [];
  const picked = new Set(pickedIndexes);
  const items = details.map((text, index) => ({ index: index + 1, text }));
  return {
    partial: details.length > 0 && picked.size < details.length,
    selected: items.filter((item) => picked.has(item.index - 1)),
    unselected: items.filter((item) => !picked.has(item.index - 1)),
  };
}

function buildLedgerRecords(state) {
  const ledger = state.ledger || [];
  const timestampFor = (kind, key) =>
    ledger.find((entry) => entry.kind === kind && entry.key === key)?.ts ?? null;
  const records = [];

  ledger.filter((entry) => entry.kind === "help").forEach((entry) => {
    const key = entry.key;
    const [slideIndex, actionIndex] = key.split(":").map(Number);
    const slide = slides[slideIndex];
    const action = slide?.actions[actionIndex];
    if (!action) return;
    const helpMode = entry.helpMode || state.helpModes?.[key] || "physical";
    const selected = entry.selectedDetails
      || pickedDetails(state, key, (action.details || []).length);
    const changes = [{ pool: entry.pool || "assist", delta: entry.delta }];
    if (entry.assistRefund) changes.push({ pool: "assist", delta: entry.assistRefund });
    records.push({
      key, slideIndex, actionIndex, page: slide.step, step: stepLabel(actionIndex),
      mode: helpMode === "voice_reminder" ? "2. 語音提醒建議"
        : helpMode === "voice" ? "1. 被動 - 語音" : "1. 被動 - 實體",
      modeCode: helpMode === "voice_reminder" ? 2 : 1,
      status: entry.run ? `第 ${entry.run} 次執行` : "已介入",
      action: action.name, ts: entry.ts,
      changes,
      selection: selectionSummary(action, selected),
      target: executionTarget(state, { entryId: entry.id }),
    });
  });

  Object.entries(state.proactive || {}).forEach(([key, result]) => {
    const [slideIndex, actionIndex] = key.split(":").map(Number);
    const slide = slides[slideIndex];
    const action = slide?.actions[actionIndex];
    if (!action) return;
    const changes = [{ pool: "proactive", delta: -result.cost }];
    if (result.status === "declined") changes.push({ pool: "assist", delta: result.cost });
    const unexecuted = result.status === "accepted" ? result.cost - (result.executedCost ?? result.cost) : 0;
    if (unexecuted > 0) changes.push({ pool: "assist", delta: unexecuted });
    records.push({
      key, slideIndex, actionIndex, page: slide.step, step: stepLabel(actionIndex),
      mode: "3. 主動", modeCode: 3,
      status: result.status === "accepted" ? "接受" : "不接受", action: action.name,
      ts: timestampFor("proactive", key), changes,
      selection: selectionSummary(action, proactiveDetails(action)),
      target: executionTarget(state, { proactiveKey: key }),
    });
  });

  ledger.filter((entry) => entry.kind === "manual").forEach((entry) => {
    records.push({
      key: null, slideIndex: Number.MAX_SAFE_INTEGER, actionIndex: Number.MAX_SAFE_INTEGER,
      page: "—", step: "—", mode: "手動", modeCode: 99, status: "",
      action: entry.note, ts: entry.ts,
      changes: [{ pool: entry.pool || "assist", delta: entry.delta }],
      selection: { partial: false, selected: [], unselected: [] },
    });
  });

  return records.sort((a, b) =>
    a.slideIndex - b.slideIndex
    || a.actionIndex - b.actionIndex
    || a.modeCode - b.modeCode
    || (a.ts || 0) - (b.ts || 0));
}

function detailText(items) {
  return items.length
    ? items.map((item) => `${String(item.index).padStart(2, "0")} ${item.text}`).join("、")
    : "無";
}

function syncLedger(state) {
  const entries = state.ledger || [];
  const records = buildLedgerRecords(state);
  elements.ledgerCount.textContent = `${records.length} 筆`;
  elements.undoButton.disabled = entries.length === 0;

  const rows = records.map((record) => {
    const item = document.createElement("li");
    item.className = `ledger-row mode-${record.modeCode}`;

    const changes = document.createElement("span");
    changes.className = "ledger-changes";
    changes.append(...record.changes.map((change) => Object.assign(document.createElement("span"), {
      className: `ledger-delta ${change.delta < 0 ? "minus" : "plus"}`,
      textContent: `${change.pool === "proactive" ? "主動" : "可指揮"} ${formatDelta(change.delta)}`,
    })));

    item.append(
      Object.assign(document.createElement("span"), { className: "ledger-page", textContent: record.page === "—" ? "—" : `第${record.page}頁` }),
      Object.assign(document.createElement("span"), { className: "ledger-step", textContent: record.step === "—" ? "—" : `${record.step}.` }),
      Object.assign(document.createElement("span"), { className: "ledger-mode", textContent: record.mode }),
      Object.assign(document.createElement("span"), { className: "ledger-note", textContent: `${record.action}${record.status ? ` · ${record.status}` : ""}` }),
      changes,
    );

    if (record.selection.partial) {
      const banner = document.createElement("div");
      banner.className = "ledger-partial-banner";
      banner.append(
        Object.assign(document.createElement("strong"), { textContent: "部分動作" }),
        Object.assign(document.createElement("span"), { className: "picked", textContent: `有選：${detailText(record.selection.selected)}` }),
        Object.assign(document.createElement("span"), { className: "unpicked", textContent: `未選：${detailText(record.selection.unselected)}` }),
      );
      item.append(banner);
    }

    const target = record.target;
    if (target) {
      const status = executionStatus(state, target);
      const open = openEditors.has(target.recordId);
      const exec = document.createElement("div");
      exec.className = "ledger-exec";
      exec.append(Object.assign(document.createElement("span"), {
        className: `ledger-status status-${status}`, textContent: EXECUTION_LABELS[status],
      }));
      if (status === "stopped" || status === "cancelled") {
        exec.append(Object.assign(document.createElement("span"), {
          className: "ledger-executed",
          textContent: `實際做了 ${target.executed.length} / ${target.base.length} 動作：${detailText(
            target.executed.map((index) => ({ index: index + 1, text: target.action?.details?.[index] || "" })),
          )}`,
        }));
      }
      const toggle = Object.assign(document.createElement("button"), {
        type: "button", className: `mini-button${open ? " is-on" : ""}`,
        textContent: open ? "收起修正" : "修正執行動作",
      });
      toggle.addEventListener("click", () => {
        if (open) {
          openEditors.delete(target.recordId);
          executionDrafts.delete(target.recordId);
        } else {
          openEditors.add(target.recordId);
        }
        refreshExecutionViews();
      });
      exec.append(toggle);
      item.append(exec);
      if (open) {
        item.append(buildExecutionEditor(
          target, "儲存修正",
          (payload) => dispatch({ type: "amendExecution", ...target.payload, ...payload }),
          () => { openEditors.delete(target.recordId); refreshExecutionViews(); },
        ));
      }
    }
    return item;
  });

  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "ledger-empty";
    empty.textContent = "尚無點數變動";
    rows.push(empty);
  }

  elements.ledger.replaceChildren(...rows);
}

// ---- 狀態進來時 ----------------------------------------------------------

function applyState(state) {
  const nextIndex = Math.max(0, Math.min(slides.length - 1, state.currentIndex));
  if (nextIndex !== currentIndex) intervention.clear();
  currentIndex = nextIndex;

  const soundEnabled = state.soundEnabled !== false;
  elements.soundToggle.textContent = soundEnabled ? "🔔 主動提示音：開" : "🔕 主動提示音：關";
  elements.soundToggle.setAttribute("aria-pressed", String(soundEnabled));

  if (currentIndex !== renderedIndex) {
    buildStepList();
    renderedIndex = currentIndex;
  }

  syncPageToggle(state);
  syncStepList(state);
  syncClientViewStatus(state);
  syncOverlayStatus(state);
  syncPoints(state);
  withFocusKept(() => {
    syncAssistantQueue(state);
    syncLedger(state);
  });
}

// ---- 事件 ----------------------------------------------------------------

function moveClientView(direction) {
  const state = window.WozStore.state;
  const actions = slides[currentIndex]?.actions || [];
  if (!state || !actions.length) return;

  const done = new Set(state.done || []);
  const firstUndone = actions.findIndex((_action, index) =>
    !done.has(actionKey(currentIndex, index)));
  const fallback = firstUndone === -1 ? actions.length - 1 : firstUndone;
  const [viewSlide, viewAction] = state.clientViewKey
    ? state.clientViewKey.split(":").map(Number)
    : [];
  const base = viewSlide === currentIndex ? viewAction : fallback;
  const target = Math.max(0, Math.min(actions.length - 1, base + direction));
  dispatch({ type: "setClientView", key: actionKey(currentIndex, target) });
}

// 整頁一次送一個 action，避免同時發出一堆請求（瀏覽器對同源的連線數有上限）。
function setWholePage(value) {
  const slide = slides[currentIndex];
  if (!slide) return;
  const keys = slide.actions.map((_action, index) => actionKey(currentIndex, index));
  dispatch({ type: "setDoneBulk", keys, value });
}

elements.soundToggle.addEventListener("click", () => {
  dispatch({ type: "setSoundEnabled", enabled: window.WozStore.state?.soundEnabled === false });
});
elements.clientViewClose.addEventListener("click", () => {
  dispatch({ type: "setClientView", key: null });
});
elements.viewPrev.addEventListener("click", () => moveClientView(-1));
elements.viewNext.addEventListener("click", () => moveClientView(1));
elements.markAll.addEventListener("click", () => setWholePage(true));
elements.clearAll.addEventListener("click", () => setWholePage(false));

elements.overlayClose.addEventListener("click", () => {
  const proactive = elements.overlayStatus.dataset.mode === "proactive";
  dispatch({ type: proactive ? "setProactiveOverlay" : "setHelpOverlay", key: null });
});

elements.undoButton.addEventListener("click", () => dispatch({ type: "undoLedger" }));
// 結束正在執行並把該步驟勾完成；步驟早就勾過完成（又再介入一次）也收得掉。
elements.assistantDone.addEventListener("click", async () => {
  if (!window.WozStore.state?.assistantCurrent) return;
  const result = await dispatch({ type: "finishCurrent" });
  if (result && result.changed === false && window.WozStore.state?.assistantCurrent) {
    window.alert("server 沒有收掉正在執行的項目。請重新啟動 server（新功能需要重啟才會生效）。");
  }
});
elements.assistantStop.addEventListener("click", () => {
  if (openEditors.has("stop")) {
    openEditors.delete("stop");
    const current = window.WozStore.state?.assistantCurrent;
    const target = current && itemTarget(window.WozStore.state, current);
    if (target) executionDrafts.delete(target.recordId);
  } else {
    openEditors.add("stop");
  }
  refreshExecutionViews();
});
document.querySelectorAll("[data-actor-error]").forEach((button) => {
  button.textContent = window.ACTOR_SPEECH.explanation[button.dataset.actorError];
  button.addEventListener("click", () => {
    const message = window.WozStore.state?.actorError === button.dataset.actorError
      ? null : button.dataset.actorError;
    dispatch({ type: "setActorError", message });
  });
});
elements.exportButton.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = "/api/export";
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
});
elements.resetButton.addEventListener("click", () => {
  if (confirm("確定要重置全部狀態嗎？頁面、勾選與所有點數紀錄都會清空。")) {
    intervention.clear();
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

document.querySelector("#actor-custom-toggle").addEventListener("click", () => {
  const form = document.querySelector("#actor-custom-form");
  form.hidden = !form.hidden;
  document.querySelector("#actor-custom-toggle").setAttribute("aria-expanded", String(!form.hidden));
  document.querySelector("#actor-custom-toggle").textContent = form.hidden ? "顯示自訂文字" : "隱藏自訂文字";
  if (!form.hidden) document.querySelector("#actor-custom-message").focus();
});
document.querySelector("#actor-custom-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#actor-custom-message").value.trim();
  if (!message) return;
  const status = document.querySelector("#actor-custom-status");
  status.textContent = "傳送中…";
  const result = await dispatch({ type: "setActorError", message });
  status.textContent = result ? "已送出到 Actor" : "傳送失敗，請確認連線後重試。";
});

document.querySelector("#actor-overlay-close").addEventListener("click", () => dispatch({ type: "closeActorOverlay" }));
