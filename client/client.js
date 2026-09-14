// 參與者畫面。狀態全部來自 server（見 shared/store.js）：
// 這一頁只負責顯示，勾選與點數都由 wizard 控制台決定。
// 步驟圖片平常不用寫在這裡：把檔案命名成「頁-步驟」丟進 images/steps/ 即可
// （例如 images/steps/3-2.jpg ＝ 第 3 頁第 2 個步驟）。
// 這裡只用來寫例外，key 的寫法一樣，會蓋過 images/steps/ 掃到的檔案。
// 例如：{ "3-2": "/images/special/whisk.jpg", "5": "/images/clean.jpg" }
const STEP_IMAGES = {};
// 每個階段的圖示平常不用寫在這裡：把檔案命名成「頁碼」「餐點-階段」或「階段」
// 丟進 images/icon/ 即可（例如 images/icon/巴斯克蛋糕-製作.jpeg）。
// 這張表是最後的退路，用餐點名稱的關鍵字比對，空的就代表不用退路。
// 例如：[{ keyword: "巴斯克蛋糕", src: "/images/icon/cake.jpeg", alt: "巴斯克蛋糕" }]
const MEAL_ICONS = [];
const slides = window.RECIPE_SLIDES || [];
// 上方花費卡要不要顯示「此步驟剩餘動作所需花費點數」那一行。
// false ＝ 整行（標題與數字）都不出現，只留「實驗剩餘動作所需花費點數」。
const SHOW_STEP_COST = false;
// 上方點數卡要不要顯示「剩餘主動幫助點數」那一行。
// false ＝ 整行（標題與數字）都不出現，參與者只看得到「剩餘可指揮助手點數」。
// 只影響參與者畫面；控制台永遠看得到這個數字。
const SHOW_PROACTIVE_POINTS = true;
// 自動捲動時，「現在該做的那一步」上方最多保留幾個已完成的步驟。
const MAX_DONE_ABOVE = 2;
// 「預覽全部步驟」每個步驟停留的毫秒數；2000 ＝ 2 秒。
const PREVIEW_STEP_MS = 2000;
// 右側主步驟：單欄放不下時最多改成兩欄。每欄至少保留這個寬度，
// 避免在較窄的視窗裡硬切兩欄，反而讓文字大量換行。
const MAX_ACTION_COLUMNS = 2;
const MIN_ACTION_COLUMN_WIDTH = 420;
// 詳細步驟先直向排成一欄，放不下才多開一欄，最多這麼多欄。
// 說明卡（整頁那張）與左下角的「詳細步驟」各有各的上限。
const MAX_HELP_COLUMNS = 3;
const MAX_DETAIL_COLUMNS = 2;
const {
  actionKey, formatPoints, cleanLabel, pickedDetails, proactiveDetails, proactiveCost,
} = window.WozFormat;

// Client 右側主步驟使用英文字母編號：A, B, ... Z, AA, AB ...。
function actionLetter(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

const elements = {
  stepCost: document.querySelector("#step-cost"),
  stepCostLabel: document.querySelector("#step-cost-label"),
  stepCostValue: document.querySelector("#step-cost-value"),
  remainingCost: document.querySelector("#remaining-cost"),
  remainingPoints: document.querySelector("#remaining-points"),
  remainingProactive: document.querySelector("#remaining-proactive"),
  remainingProactiveLabel: document.querySelector("#remaining-proactive-label"),
  remainingProactiveValue: document.querySelector("#remaining-proactive-value"),
  currentStep: document.querySelector("#current-step"),
  mealName: document.querySelector("#top-meal"),
  mealIconWrap: document.querySelector("#meal-icon-wrap"),
  mealIcon: document.querySelector("#meal-icon"),
  actionColumn: document.querySelector("#action-column"),
  actionList: document.querySelector("#action-list"),
  scrollCue: document.querySelector("#scroll-cue"),
  detailScroll: document.querySelector("#detail-scroll"),
  detailList: document.querySelector("#detail-list"),
  stepImage: document.querySelector("#step-image"),
  imagePlaceholder: document.querySelector("#image-placeholder"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  fullscreenLabel: document.querySelector("#fullscreen-label"),
  previewStatus: document.querySelector("#preview-status"),
  helpOverlay: document.querySelector("#help-overlay"),
  helpCard: document.querySelector("#help-overlay .help-card"),
  helpOverlayBody: document.querySelector("#help-overlay-body"),
  helpOverlayStep: document.querySelector("#help-overlay-step"),
  helpOverlayAnswer: document.querySelector("#help-overlay-answer"),
  helpOverlayName: document.querySelector("#help-overlay-name"),
  helpOverlayAction: document.querySelector("#help-overlay-action"),
  helpOverlayImage: document.querySelector("#help-overlay-image"),
  helpOverlayImageEmpty: document.querySelector("#help-overlay-image-empty"),
  helpOverlayList: document.querySelector("#help-overlay-list"),
  helpOverlayEmpty: document.querySelector("#help-overlay-empty"),
  helpOverlayLegend: document.querySelector("#help-overlay-legend"),
  helpOverlayLegendText: document.querySelector("#help-overlay-legend-text"),
  helpOverlayCostLabel: document.querySelector("#help-overlay-cost-label"),
  helpOverlayCost: document.querySelector("#help-overlay-cost"),
  offlineBanner: document.querySelector("#offline-banner"),
};

let currentIndex = 0;
// 上一次真正重繪過的頁碼，用來判斷這次更新要不要整頁重畫。
let renderedIndex = -1;
// 上一次自動捲動時對準的步驟，避免只是點數變動也把畫面拉走。
let scrolledStepIndex = -1;
// 上一次看到的 previewNonce；變動時從本頁第一個動作開始預覽。
let lastPreviewNonce = null;
let previewRunId = 0;
let isPreviewing = false;
let previewSeenCount = 0;
// Wizard 指定暫時查看的步驟；null 時跟隨最小的未完成步驟。
let clientViewKey = null;
// 目前預覽中的步驟（滑鼠移入的那個，或現在該做的那一步）。
let previewIndex = 0;
let doneKeys = new Set();
let helpedKeys = new Set();
// 主動提議「已接受」的步驟；不接受的不算被代勞，所以不進這一組。
let proactiveAcceptedKeys = new Set();
// 正在顯示說明卡的步驟（"slideIdx:actionIdx"），沒有就是 null。
let overlayKey = null;

// 兩個點數池各自獨立：可指揮助手＝參與者自己要求的幫助，
// 主動幫助＝助手主動提議的額度（不接受時會退進可指揮那一池）。
function updateRemainingPoints() {
  const state = window.WozStore.state;
  const show = (element, value) => {
    element.textContent = value == null ? "—" : formatPoints(value);
  };
  show(elements.remainingPoints, state?.remaining);
  if (SHOW_PROACTIVE_POINTS) show(elements.remainingProactive, state?.proactiveRemaining);
}

// 一頁裡「還沒完成」的動作要花多少點。
function pendingCost(slideIndex) {
  return (slides[slideIndex]?.actions || []).reduce(
    (sum, action, index) =>
      sum + (doneKeys.has(actionKey(slideIndex, index)) ? 0 : action.cost),
    0,
  );
}

// 兩個花費都只算「還沒完成」的動作，所以控制台每勾一個完成就會跟著往下掉。
// 「實驗剩餘」算全部頁面，不看目前在第幾頁 —— 這樣翻頁不會讓數字忽上忽下。
function updateCosts() {
  if (SHOW_STEP_COST) elements.stepCost.textContent = formatPoints(pendingCost(currentIndex));
  elements.remainingCost.textContent = formatPoints(
    slides.reduce((sum, _slide, index) => sum + pendingCost(index), 0),
  );
}

function updateScrollCue() {
  const list = elements.actionList;
  const maxScroll = list.scrollHeight - list.clientHeight;
  const hasMoreBelow = maxScroll > 1 && maxScroll - list.scrollTop > 1;

  elements.actionColumn.classList.toggle("scroll-above", list.scrollTop > 1);
  elements.actionColumn.classList.toggle("scroll-below", hasMoreBelow);
}

// 主步驟預設維持單欄；只有單欄實際超出可用高度、且右側能容納兩個
// 最小欄寬時才切成兩欄。兩欄仍太高時沿用原本的垂直捲動作為 fallback。
function fitActionColumns() {
  const list = elements.actionList;
  list.classList.remove("two-columns");
  list.style.removeProperty("--action-column-rows");

  const styles = getComputedStyle(list);
  const columnGap = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--action-column-gap"),
  ) || 0;
  const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0)
    + (Number.parseFloat(styles.paddingRight) || 0);
  const availableWidth = list.clientWidth - horizontalPadding;
  const singleColumnOverflows = list.scrollHeight - list.clientHeight > 1;
  const hasRoomForTwoColumns = availableWidth
    >= (MIN_ACTION_COLUMN_WIDTH * MAX_ACTION_COLUMNS) + columnGap;

  if (singleColumnOverflows && hasRoomForTwoColumns && list.children.length > 1) {
    list.style.setProperty(
      "--action-column-rows",
      String(Math.ceil(list.children.length / MAX_ACTION_COLUMNS)),
    );
    list.classList.add("two-columns");
  }

  updateScrollCue();
}

// 這一頁「還沒完成、編號最小」的步驟＝現在該做的那一步。
// 全部完成時回傳 actions.length。
function currentStepIndex() {
  const actions = slides[currentIndex]?.actions || [];
  const index = actions.findIndex(
    (_action, position) => !doneKeys.has(actionKey(currentIndex, position)),
  );
  return index === -1 ? actions.length : index;
}

// 找某個步驟要用的圖：先看 STEP_IMAGES 的例外設定（步驟優先於整頁），
// 再看 images/steps/ 掃到的檔案，最後才是 Excel 帶進來的 slide.image。
function imageFor(actionIndex, slideIndex = currentIndex) {
  const slide = slides[slideIndex];
  if (!slide) return "";
  const stepNumber = actionIndex + 1;
  return STEP_IMAGES[`${slide.step}-${stepNumber}`]
    || STEP_IMAGES[slide.step]
    || window.WozImages.get(slide.step, stepNumber)
    || slide.image
    || "";
}

function showImage(actionIndex) {
  const slide = slides[currentIndex];
  const path = imageFor(actionIndex);
  if (path) {
    const label = cleanLabel(slide?.meal) || cleanLabel(slide?.stage) || "";
    elements.stepImage.src = path;
    elements.stepImage.alt = `${label}步驟示意圖`;
    elements.stepImage.hidden = false;
    elements.imagePlaceholder.hidden = true;
  } else {
    elements.stepImage.removeAttribute("src");
    elements.stepImage.hidden = true;
    elements.imagePlaceholder.hidden = false;
  }
}

function showHelpImage(slideIndex, actionIndex) {
  const slide = slides[slideIndex];
  const path = imageFor(actionIndex, slideIndex);
  const showPlaceholder = () => {
    elements.helpOverlayImage.removeAttribute("src");
    elements.helpOverlayImage.hidden = true;
    elements.helpOverlayImageEmpty.hidden = false;
  };

  if (!path) {
    showPlaceholder();
    return;
  }

  elements.helpOverlayImage.onerror = showPlaceholder;
  elements.helpOverlayImage.src = path;
  elements.helpOverlayImage.alt = `${cleanLabel(slide?.meal) || cleanLabel(slide?.stage) || actionIndex + 1}步驟示意圖`;
  elements.helpOverlayImage.hidden = false;
  elements.helpOverlayImageEmpty.hidden = true;
}

// 詳細步驟先直向排成一欄；放不下（會需要捲動）才多開一欄，最多 max 欄。
// 多開之後 CSS 的多欄排版會把內容平均分配，而且仍是看完左欄再看右欄。
function fitColumns(scroller, list, max) {
  for (let columns = 1; columns <= max; columns += 1) {
    list.style.columnCount = String(columns);
    // 讀 scrollHeight 會強制重新排版，所以量到的是這個欄數的實際結果。
    if (scroller.scrollHeight <= scroller.clientHeight) break;
  }
}

const fitDetailColumns = () =>
  fitColumns(elements.detailScroll, elements.detailList, MAX_DETAIL_COLUMNS);

// 顯示某個步驟的詳細步驟與圖片。
function showStep(actionIndex) {
  previewIndex = actionIndex;
  const action = slides[currentIndex]?.actions[actionIndex];
  elements.detailList.replaceChildren(
    ...(action?.details || []).map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );
  fitDetailColumns();
  showImage(actionIndex);
}

// 滑鼠沒有停在任何步驟上時要顯示的那一個。整頁都完成時停在最後一步，不留白。
function pinnedIndex() {
  const actions = slides[currentIndex]?.actions || [];
  return Math.max(0, Math.min(currentStepIndex(), actions.length - 1));
}

// 顏色高亮（底色＋左側直條）固定在現在該做的那一步，不會被滑鼠影響；
// 移入其他步驟只會預覽它的詳細步驟與圖片。
function highlightCurrentStep() {
  const actions = slides[currentIndex]?.actions || [];
  const stepIndex = currentStepIndex();
  // 整頁都完成時就不再高亮。
  const highlightIndex = stepIndex < actions.length ? stepIndex : -1;

  showStep(pinnedIndex());
  [...elements.actionList.children].forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === highlightIndex);
  });
}

// 讓現在該做的那一步上方最多只留 MAX_DONE_ABOVE 個已完成的步驟。
function scrollAnchorIndex(actionIndex) {
  const count = elements.actionList.children.length;
  if (!count) return -1;
  const index = Math.max(0, Math.min(actionIndex, count - 1));
  if (!elements.actionList.classList.contains("two-columns")) {
    return Math.max(0, index - MAX_DONE_ABOVE);
  }

  const rows = Number.parseInt(
    elements.actionList.style.getPropertyValue("--action-column-rows"),
    10,
  ) || count;
  const columnStart = Math.floor(index / rows) * rows;
  return Math.max(columnStart, index - MAX_DONE_ABOVE);
}

function scrollToCurrentStep() {
  const list = elements.actionList;
  const target = list.children[scrollAnchorIndex(currentStepIndex())];
  if (!target) return;

  // 用 rect 相減，不必在意 offsetParent 是誰。
  const delta = target.getBoundingClientRect().top - list.getBoundingClientRect().top;
  if (Math.abs(delta) < 1) return;
  list.scrollTo({ top: list.scrollTop + delta, behavior: "smooth" });
}

// 預覽時也沿用正式進度的定位方式：目前動作上方最多留兩個看過的動作。
function scrollToPreviewStep(actionIndex) {
  const list = elements.actionList;
  const target = list.children[scrollAnchorIndex(actionIndex)];
  if (!target) return;
  const delta = target.getBoundingClientRect().top - list.getBoundingClientRect().top;
  if (Math.abs(delta) < 1) return;
  list.scrollTo({ top: list.scrollTop + delta, behavior: "smooth" });
}

// 只有「該做的那一步」真的換人時才捲動，單純的點數變動不會把畫面拉走。
function autoScroll(force) {
  const stepIndex = currentStepIndex();
  if (!force && stepIndex === scrolledStepIndex) return;
  scrolledStepIndex = stepIndex;
  requestAnimationFrame(scrollToCurrentStep);
}

// 被助手代勞過的步驟才有這些標記，放在卡片最右邊（點數標籤的後面）。
// 掛在 .action-tags 裡，而 .action-tags 是卡片的直接子元素，
// 所以同時已完成時，既有的 .action-card.done > * 規則會把它一起灰階。
// 兩種幫助各自獨立，所以同一個步驟可能同時掛兩顆。
function syncBadge(button, className, text, on) {
  const tags = button.querySelector(".action-tags");
  const existing = tags.querySelector(`.${className}`);
  if (on === Boolean(existing)) return;
  if (on) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = text;
    tags.append(badge);
  } else {
    existing.remove();
  }
}

function syncHelpBadges(button, key) {
  syncBadge(button, "help-badge", "🤖 介入", helpedKeys.has(key));
  syncBadge(button, "proactive-badge", "🤖 主動", proactiveAcceptedKeys.has(key));
}

function renderActions(slide) {
  const buttons = slide.actions.map((action, index) => {
    const key = actionKey(currentIndex, index);
    const button = document.createElement("button");
    button.type = "button";
    // 不能點、不吃鍵盤焦點，但仍要收得到 mouseenter 才能預覽詳細步驟，
    // 所以不能用 disabled（disabled 的按鈕不會觸發滑鼠事件）。
    button.tabIndex = -1;
    button.className = "action-card";
    button.addEventListener("mouseenter", () => {
      if (!isPreviewing && !clientViewKey) showStep(index);
    });
    button.classList.toggle("done", doneKeys.has(key));
    button.classList.toggle("helped", helpedKeys.has(key) || proactiveAcceptedKeys.has(key));

    const number = document.createElement("span");
    number.className = "action-number";
    number.textContent = `${actionLetter(index)}.`;

    const name = document.createElement("span");
    name.className = "action-name";
    name.textContent = action.name;

    // 右側的標籤都放這裡，順序是「點數 → 已介入」，靠卡片最右邊排。
    const tags = document.createElement("span");
    tags.className = "action-tags";
    if (action.cost > 0) {
      const cost = document.createElement("span");
      cost.className = "cost-pill";
      cost.textContent = `${formatPoints(action.cost)} $`;
      tags.append(cost);
    }

    button.append(number, name, tags);
    syncHelpBadges(button, key);
    return button;
  });

  elements.actionList.replaceChildren(...buttons);
  elements.actionList.scrollTop = 0;
  requestAnimationFrame(fitActionColumns);
}

// 只有勾選狀態變動時走這裡：就地改 class，不動 DOM 結構，
// 這樣參與者的捲動位置與滑鼠停留的卡片都不會被彈掉。
function syncActionStates() {
  [...elements.actionList.children].forEach((button, index) => {
    const key = actionKey(currentIndex, index);
    button.classList.toggle("done", doneKeys.has(key));
    button.classList.toggle("helped", helpedKeys.has(key) || proactiveAcceptedKeys.has(key));
    syncHelpBadges(button, key);
  });
  fitActionColumns();
  updateRemainingPoints();
  updateCosts();
  highlightCurrentStep();
  autoScroll(false);
  if (isPreviewing) applyPreviewStep(previewSeenCount);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function applyPreviewStep(actionIndex) {
  [...elements.actionList.children].forEach((button, index) => {
    button.classList.remove("client-view");
    button.classList.toggle("preview-seen", index < actionIndex);
    button.classList.toggle("active", index === actionIndex);
  });
  showStep(actionIndex);
  requestAnimationFrame(() => scrollToPreviewStep(actionIndex));
}

function applyClientView() {
  const [slideIndex, actionIndex] = clientViewKey
    ? clientViewKey.split(":").map(Number)
    : [];
  const valid = slideIndex === currentIndex
    && Number.isInteger(actionIndex)
    && actionIndex >= 0
    && actionIndex < (slides[currentIndex]?.actions.length || 0);

  [...elements.actionList.children].forEach((button, index) => {
    button.classList.toggle("client-view", valid && index === actionIndex);
    if (valid) button.classList.remove("active");
  });
  if (!valid || isPreviewing) return;

  showStep(actionIndex);
  requestAnimationFrame(() => scrollToPreviewStep(actionIndex));
}

function restoreAfterPreview() {
  isPreviewing = false;
  previewSeenCount = 0;
  elements.previewStatus.hidden = true;
  [...elements.actionList.children].forEach((button) => button.classList.remove("preview-seen"));
  highlightCurrentStep();
  autoScroll(true);
  applyClientView();
}

function stopPreview() {
  previewRunId += 1;
  if (isPreviewing) restoreAfterPreview();
}

async function previewAllSteps(nonce) {
  const actions = slides[currentIndex]?.actions || [];
  if (!actions.length) return;

  // 新指令會使上一輪自然失效，因此重按按鈕可以直接從頭開始。
  const runId = ++previewRunId;
  isPreviewing = true;
  previewSeenCount = 0;
  elements.previewStatus.hidden = false;

  for (let index = 0; index < actions.length; index += 1) {
    if (runId !== previewRunId) return;
    previewSeenCount = index;
    applyPreviewStep(index);
    await wait(PREVIEW_STEP_MS);
  }

  if (runId !== previewRunId) return;
  // 最後一步停滿設定時間後結束，畫面回到正式的完成狀態與目前步驟。
  restoreAfterPreview();
  window.WozStore.dispatch({ type: "finishPreview", nonce });
}

// 這一頁的階段圖示。檔名依序試「頁碼」→「餐點-階段」→「階段」，
// 都沒有才退回 MEAL_ICONS 的餐點關鍵字比對。
function showStageIcon(slide) {
  const mealName = cleanLabel(slide.meal);
  const stageName = cleanLabel(slide.stage);
  const scanned = window.WozImages.icon(
    slide.step,
    [mealName, stageName].filter(Boolean).join("-"),
    stageName,
  );
  const fallback = MEAL_ICONS.find(({ keyword }) => mealName.includes(keyword));

  if (scanned || fallback) {
    elements.mealIcon.src = scanned || fallback.src;
    elements.mealIcon.alt = [mealName, stageName].filter(Boolean).join(" ");
    elements.mealIconWrap.hidden = false;
  } else {
    elements.mealIcon.removeAttribute("src");
    elements.mealIcon.alt = "";
    elements.mealIconWrap.hidden = true;
  }
}

function render() {
  if (!slides.length) return;
  const slide = slides[currentIndex];

  updateCosts();
  updateRemainingPoints();
  elements.currentStep.textContent = `步驟 ${slide.step}/${slides.length}`;

  const mealName = cleanLabel(slide.meal);
  const stageName = cleanLabel(slide.stage);
  const stageTitle = [mealName, stageName].filter(Boolean).join(" - ");
  elements.mealName.textContent = stageTitle;
  elements.mealName.hidden = !stageTitle;

  showStageIcon(slide);

  renderActions(slide);
  highlightCurrentStep();
  autoScroll(true);

  renderedIndex = currentIndex;
}

const fitHelpColumns = () =>
  fitColumns(elements.helpOverlayBody, elements.helpOverlayList, MAX_HELP_COLUMNS);

function updateHelpCardWidth(detailCount) {
  const styles = getComputedStyle(document.documentElement);
  const pixels = (name, fallback) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const minWidth = pixels("--help-card-min-width", 1000);
  const widthPerRow = pixels("--help-card-width-per-row", 50);
  const maxWidth = pixels("--help-card-max-width", 1600);
  const width = Math.min(maxWidth, minWidth + Math.max(0, detailCount - 1) * widthPerRow);
  elements.helpCard.style.setProperty("--help-card-auto-width", `${width}px`);
}

// 整頁的卡片有兩種，共用同一塊 DOM（畫面上同時只會有一張，server 保證互斥）：
//   assist    ＝ wizard 勾「接受幫助」時浮出來的說明卡，代勞範圍由控制台的勾選決定。
//   proactive ＝ 助手主動提議卡，代勞範圍寫死在 Excel 的「介入」欄，參與者可以不接受。
// 兩種出現期間參與者都不能換頁（見 moveSlide），要先看完。
function syncHelpOverlay(state) {
  // 主動提議卡優先：server 只會設其中一個，這裡的順序只是防呆。
  const proactiveKey = state.proactiveOverlay || null;
  const key = proactiveKey || state.helpOverlay || null;
  const mode = proactiveKey ? "proactive" : "assist";
  // 卡片指的不一定是目前這一頁，所以一律從 key 反查，不能用 currentIndex。
  const [slideIndex, actionIndex] = key ? key.split(":").map(Number) : [];
  const slide = slides[slideIndex];
  const action = slide?.actions[actionIndex];

  overlayKey = action ? key : null;
  elements.helpOverlay.hidden = !overlayKey;
  if (!overlayKey) return;

  const isProactive = mode === "proactive";
  elements.helpOverlay.dataset.mode = mode;

  const details = action.details || [];
  updateHelpCardWidth(details.length);
  // 主動提議的範圍來自 Excel，不看 helpDetails；兩種幫助各自獨立。
  const picked = new Set(
    isProactive ? proactiveDetails(action) : pickedDetails(state, key, details.length),
  );

  // 「餐點 - 階段 - 步驟N」；Excel 沒填餐點的頁面就只有「階段 - 步驟N」。
  elements.helpOverlayStep.textContent = [
    cleanLabel(slide.meal),
    cleanLabel(slide.stage),
    `步驟${actionIndex + 1}`,
  ].filter(Boolean).join(" - ");
  const passiveMode = state.helpModes?.[key] || "physical";
  const overlayTitle = isProactive
    ? "實體介入（3. 詢問後）"
    : (passiveMode === "voice"
      ? "語音介入（1. 被動等待）"
      : "實體介入（1. 被動等待）");
  // 介入種類與觸發方式合併成單一標題；動作名稱獨立放在下一行。
  elements.helpOverlayName.textContent = overlayTitle;
  elements.helpOverlayAction.textContent = action.name;
  showHelpImage(slideIndex, actionIndex);

  // 提議被回答之後就把結果標在卡片上，wizard 收卡前參與者都看得到。
  const answer = isProactive ? state.proactive?.[key]?.status : null;
  elements.helpOverlayAnswer.hidden = !answer;
  if (answer) {
    elements.helpOverlayAnswer.textContent = answer === "accepted" ? "已接受" : "未接受";
    elements.helpOverlayAnswer.dataset.answer = answer;
  }

  // 永遠列出全部的動作，編號才跟控制台一致；不在代勞範圍內的那幾條淡成灰色，
  // 代表那些要參與者自己做（對照最下方的圖例）。
  elements.helpOverlayList.replaceChildren(
    ...details.map((text, index) => {
      const item = document.createElement("li");
      item.textContent = text;
      item.classList.toggle("is-off", !picked.has(index));
      return item;
    }),
  );
  elements.helpOverlayEmpty.hidden = details.length > 0;
  // 圖例只在真的有灰字時才出現；整步驟都由助手做的話沒什麼好對照的。
  elements.helpOverlayLegend.hidden = picked.size === details.length;
  elements.helpOverlayLegendText.textContent = isProactive
    ? "動作助手可以幫您完成"
    : "動作將由助手介入";

  // 還沒回答的提議寫「接受將花費」，其他情況都是已經確定的金額。
  elements.helpOverlayCostLabel.textContent = isProactive && !answer ? "接受將花費" : "本次花費";
  const cost = isProactive
    ? (state.proactive?.[key]?.cost ?? proactiveCost(action))
    : state.helped?.[key];
  elements.helpOverlayCost.textContent = cost == null ? "—" : formatPoints(cost);

  fitHelpColumns();
}

function applyState(state) {
  const previousClientViewKey = clientViewKey;
  doneKeys = new Set(state.done);
  helpedKeys = new Set(Object.keys(state.helped || {}));
  proactiveAcceptedKeys = new Set(
    Object.entries(state.proactive || {})
      .filter(([, entry]) => entry?.status === "accepted")
      .map(([key]) => key),
  );
  clientViewKey = state.clientViewKey || null;
  const clientViewEnded = Boolean(previousClientViewKey) && !clientViewKey;

  const previewNonce = state.previewNonce ?? 0;
  const previewChanged = lastPreviewNonce !== null && previewNonce !== lastPreviewNonce;
  const previewRequested = Boolean(state.previewActive)
    && (lastPreviewNonce === null || previewChanged);
  const previewStopped = !state.previewActive && previewChanged;
  lastPreviewNonce = previewNonce;

  const nextIndex = Math.max(0, Math.min(slides.length - 1, state.currentIndex));
  // wizard 若在播放途中切頁，就結束舊頁預覽，避免舊計時器操作新頁的 DOM。
  if (isPreviewing && nextIndex !== currentIndex) {
    previewRunId += 1;
    restoreAfterPreview();
  }
  currentIndex = nextIndex;

  if (currentIndex !== renderedIndex) {
    render();
  } else {
    syncActionStates();
  }

  syncHelpOverlay(state);
  if (previewStopped) stopPreview();
  if (previewRequested) previewAllSteps(previewNonce);
  if (!previewRequested) applyClientView();
  // 「回到目前步驟」即使目標沒變，也要把參與者手動捲走的列表重新定位。
  if (clientViewEnded && !state.previewActive) autoScroll(true);
}

function moveSlide(direction) {
  // 說明卡蓋著的時候不能用方向鍵換頁，要先看完再說。
  if (overlayKey || isPreviewing) return;
  const nextIndex = Math.max(0, Math.min(slides.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;
  // 換頁一樣寫回 server，wizard 的頁面切換器才會跟著動。
  window.WozStore.dispatch({ type: "setPage", index: nextIndex });
}

// 滑鼠離開整個列表就切回現在該做的那一步。
elements.actionList.addEventListener("mouseleave", () => {
  if (!isPreviewing && !clientViewKey) showStep(pinnedIndex());
});
// 圖片壞掉（檔名對但檔案有問題）時退回預留版位，不要留一個破圖。
elements.stepImage.addEventListener("error", () => {
  elements.stepImage.hidden = true;
  elements.imagePlaceholder.hidden = false;
});
// 階段圖示同理：載不到就整個藏起來，只留階段名稱。
elements.mealIcon.addEventListener("error", () => {
  elements.mealIconWrap.hidden = true;
});
elements.actionList.addEventListener("scroll", updateScrollCue, { passive: true });
window.addEventListener("resize", () => {
  fitActionColumns();
  // 進出全螢幕會改變可用高度，欄數要重算。
  fitDetailColumns();
  if (overlayKey) fitHelpColumns();
});
elements.scrollCue.addEventListener("click", () => {
  elements.actionList.scrollBy({ top: elements.actionList.clientHeight * 0.8, behavior: "smooth" });
});

elements.fullscreenButton.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn("無法切換全螢幕模式", error);
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = Boolean(document.fullscreenElement);
  elements.fullscreenLabel.textContent = isFullscreen ? "離開全螢幕" : "全螢幕";
  elements.fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") moveSlide(-1);
  if (event.key === "ArrowRight") moveSlide(1);
});

window.WozStore.onStatus((status) => {
  elements.offlineBanner.hidden = status !== "disconnected";
});
window.WozStore.subscribe(applyState);

// 這幾行的開關只在載入時決定一次，不會中途變。
elements.stepCostLabel.hidden = !SHOW_STEP_COST;
elements.stepCostValue.hidden = !SHOW_STEP_COST;
elements.remainingProactiveLabel.hidden = !SHOW_PROACTIVE_POINTS;
elements.remainingProactiveValue.hidden = !SHOW_PROACTIVE_POINTS;

// 還沒收到第一份狀態前先畫一次，避免畫面空白。
render();

// 圖片清單晚一點才回來，回來後把步驟圖與階段圖示都補上。
window.WozImages.onLoad(() => {
  showImage(previewIndex);
  if (slides[currentIndex]) showStageIcon(slides[currentIndex]);
  if (overlayKey) {
    const [slideIndex, actionIndex] = overlayKey.split(":").map(Number);
    showHelpImage(slideIndex, actionIndex);
  }
});
window.WozImages.load();
