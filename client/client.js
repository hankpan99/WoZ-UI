// 參與者畫面。狀態全部來自 server（見 shared/store.js）：
// 這一頁只負責顯示，勾選與點數都由 wizard 控制台決定。
// 步驟圖片平常不用寫在這裡：把檔案命名成「頁-步驟」丟進 images/steps/ 即可
// （例如 images/steps/3-2.jpg ＝ 第 3 頁第 2 個步驟）。
// 這裡只用來寫例外，key 的寫法一樣，會蓋過 images/steps/ 掃到的檔案。
// 例如：{ "3-2": "/images/special/whisk.jpg", "5": "/images/clean.jpg" }
const STEP_IMAGES = {};
const MEAL_ICONS = [
  { keyword: "巴斯克蛋糕", src: "/images/icon/cake.png", alt: "巴斯克蛋糕" },
  { keyword: "吐司", src: "/images/icon/toast.png", alt: "法式吐司" },
  { keyword: "優格", src: "/images/icon/yogurt.png", alt: "水果優格" },
];
const slides = window.RECIPE_SLIDES || [];
// 自動捲動時，「現在該做的那一步」上方最多保留幾個已完成的步驟。
const MAX_DONE_ABOVE = 2;
// 詳細步驟先直向排成一欄，放不下才多開一欄，最多這麼多欄。
// 說明卡（整頁那張）與左下角的「詳細步驟」各有各的上限。
const MAX_HELP_COLUMNS = 3;
const MAX_DETAIL_COLUMNS = 2;
const {
  actionKey, formatPoints, cleanLabel, slideCost, pickedDetails,
} = window.WozFormat;

const elements = {
  remainingCost: document.querySelector("#remaining-cost"),
  remainingPoints: document.querySelector("#remaining-points"),
  currentStep: document.querySelector("#current-step"),
  stepTotal: document.querySelector("#step-total"),
  progressBar: document.querySelector("#progress-bar"),
  stageDone: document.querySelector("#stage-done"),
  stageTotal: document.querySelector("#stage-total"),
  mealName: document.querySelector("#top-meal"),
  stageName: document.querySelector("#top-stage"),
  mealIconWrap: document.querySelector("#meal-icon-wrap"),
  mealIcon: document.querySelector("#meal-icon"),
  actionColumn: document.querySelector("#action-column"),
  actionList: document.querySelector("#action-list"),
  scrollCue: document.querySelector("#scroll-cue"),
  detailScroll: document.querySelector("#detail-scroll"),
  detailList: document.querySelector("#detail-list"),
  stepImage: document.querySelector("#step-image"),
  imagePlaceholder: document.querySelector("#image-placeholder"),
  prevButton: document.querySelector("#prev-button"),
  nextButton: document.querySelector("#next-button"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  fullscreenLabel: document.querySelector("#fullscreen-label"),
  helpOverlay: document.querySelector("#help-overlay"),
  helpOverlayBody: document.querySelector("#help-overlay-body"),
  helpOverlayStep: document.querySelector("#help-overlay-step"),
  helpOverlayName: document.querySelector("#help-overlay-name"),
  helpOverlayList: document.querySelector("#help-overlay-list"),
  helpOverlayEmpty: document.querySelector("#help-overlay-empty"),
  helpOverlayLegend: document.querySelector("#help-overlay-legend"),
  helpOverlayCost: document.querySelector("#help-overlay-cost"),
  offlineBanner: document.querySelector("#offline-banner"),
};

let currentIndex = 0;
// 上一次真正重繪過的頁碼，用來判斷這次更新要不要整頁重畫。
let renderedIndex = -1;
// 上一次自動捲動時對準的步驟，避免只是點數變動也把畫面拉走。
let scrolledStepIndex = -1;
// 上一次看到的 scrollNonce；null 代表還沒收到第一份狀態。
let lastScrollNonce = null;
// 目前預覽中的步驟（滑鼠移入的那個，或現在該做的那一步）。
let previewIndex = 0;
let doneKeys = new Set();
let helpedKeys = new Set();
// 正在顯示說明卡的步驟（"slideIdx:actionIdx"），沒有就是 null。
let overlayKey = null;

function updateRemainingPoints() {
  const remaining = window.WozStore.state?.remaining;
  elements.remainingPoints.textContent = remaining == null ? "—" : formatPoints(remaining);
}

function updateStageProgress() {
  const total = slides[currentIndex]?.actions.length || 0;
  const done = slides[currentIndex]?.actions.reduce(
    (count, _action, index) => count + (doneKeys.has(actionKey(currentIndex, index)) ? 1 : 0),
    0,
  ) || 0;

  elements.stageDone.textContent = formatPoints(done);
  elements.stageTotal.textContent = ` / ${total}`;
}

function updateScrollCue() {
  const list = elements.actionList;
  const maxScroll = list.scrollHeight - list.clientHeight;
  const hasMoreBelow = maxScroll > 1 && maxScroll - list.scrollTop > 1;

  elements.actionColumn.classList.toggle("scroll-above", list.scrollTop > 1);
  elements.actionColumn.classList.toggle("scroll-below", hasMoreBelow);
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
function imageFor(actionIndex) {
  const slide = slides[currentIndex];
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
function scrollToCurrentStep() {
  const list = elements.actionList;
  const target = list.children[Math.max(0, currentStepIndex() - MAX_DONE_ABOVE)];
  if (!target) return;

  // 用 rect 相減，不必在意 offsetParent 是誰。
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

// 只有「接受幫助」的步驟才有這顆標記，放在卡片最右邊（點數標籤的後面）。
// 掛在 .action-tags 裡，而 .action-tags 是卡片的直接子元素，
// 所以同時已完成時，既有的 .action-card.done > * 規則會把它一起灰階。
function syncHelpBadge(button, helped) {
  const tags = button.querySelector(".action-tags");
  const existing = tags.querySelector(".help-badge");
  if (helped === Boolean(existing)) return;
  if (helped) {
    const badge = document.createElement("span");
    badge.className = "help-badge";
    badge.textContent = "🤖 介入";
    tags.append(badge);
  } else {
    existing.remove();
  }
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
    button.addEventListener("mouseenter", () => showStep(index));
    button.classList.toggle("done", doneKeys.has(key));
    button.classList.toggle("helped", helpedKeys.has(key));

    const number = document.createElement("span");
    number.className = "action-number";
    number.textContent = `${index + 1}.`;

    const name = document.createElement("span");
    name.className = "action-name";
    name.textContent = action.name;

    // 右側的標籤都放這裡，順序是「點數 → 已介入」，靠卡片最右邊排。
    const tags = document.createElement("span");
    tags.className = "action-tags";
    if (action.cost > 0) {
      const cost = document.createElement("span");
      cost.className = "cost-pill";
      cost.textContent = `${formatPoints(action.cost)} 點`;
      tags.append(cost);
    }

    button.append(number, name, tags);
    syncHelpBadge(button, helpedKeys.has(key));
    return button;
  });

  elements.actionList.replaceChildren(...buttons);
  elements.actionList.scrollTop = 0;
  requestAnimationFrame(updateScrollCue);
}

// 只有勾選狀態變動時走這裡：就地改 class，不動 DOM 結構，
// 這樣參與者的捲動位置與滑鼠停留的卡片都不會被彈掉。
function syncActionStates() {
  [...elements.actionList.children].forEach((button, index) => {
    const key = actionKey(currentIndex, index);
    button.classList.toggle("done", doneKeys.has(key));
    button.classList.toggle("helped", helpedKeys.has(key));
    syncHelpBadge(button, helpedKeys.has(key));
  });
  updateRemainingPoints();
  updateStageProgress();
  highlightCurrentStep();
  autoScroll(false);
}

function render() {
  if (!slides.length) return;
  const slide = slides[currentIndex];
  const futureCost = slides.slice(currentIndex).reduce((sum, item) => sum + slideCost(item), 0);

  elements.remainingCost.textContent = formatPoints(futureCost);
  updateRemainingPoints();
  updateStageProgress();
  elements.currentStep.textContent = slide.step;
  elements.stepTotal.textContent = ` / ${slides.length}`;
  elements.progressBar.style.width = `${((currentIndex + 1) / slides.length) * 100}%`;

  const mealName = cleanLabel(slide.meal);
  const stageName = cleanLabel(slide.stage);
  elements.mealName.textContent = mealName;
  elements.mealName.hidden = !mealName;
  elements.stageName.textContent = stageName;
  elements.stageName.hidden = !stageName;

  const icon = MEAL_ICONS.find(({ keyword }) => mealName.includes(keyword));
  if (icon) {
    elements.mealIcon.src = icon.src;
    elements.mealIcon.alt = icon.alt;
    elements.mealIconWrap.hidden = false;
  } else {
    elements.mealIcon.removeAttribute("src");
    elements.mealIcon.alt = "";
    elements.mealIconWrap.hidden = true;
  }

  renderActions(slide);
  highlightCurrentStep();
  autoScroll(true);

  elements.prevButton.disabled = currentIndex === 0;
  elements.nextButton.disabled = currentIndex === slides.length - 1;
  elements.nextButton.innerHTML = currentIndex === slides.length - 1
    ? '已完成 <span aria-hidden="true">✓</span>'
    : '下一步 <span aria-hidden="true">→</span>';

  renderedIndex = currentIndex;
}

const fitHelpColumns = () =>
  fitColumns(elements.helpOverlayBody, elements.helpOverlayList, MAX_HELP_COLUMNS);

// 整頁的說明卡：wizard 勾「接受幫助」時浮出來，寫清楚這次被代勞了哪些詳細步驟。
// 出現期間參與者不能換頁（見 moveSlide），要先看完。
function syncHelpOverlay(state) {
  const key = state.helpOverlay || null;
  // 說明卡指的不一定是目前這一頁，所以一律從 key 反查，不能用 currentIndex。
  const [slideIndex, actionIndex] = key ? key.split(":").map(Number) : [];
  const slide = slides[slideIndex];
  const action = slide?.actions[actionIndex];

  overlayKey = action ? key : null;
  elements.helpOverlay.hidden = !overlayKey;
  if (!overlayKey) return;

  const details = action.details || [];
  const picked = new Set(pickedDetails(state, key, details.length));

  // 「餐點 - 階段 - 步驟N」；Excel 沒填餐點的頁面就只有「階段 - 步驟N」。
  elements.helpOverlayStep.textContent = [
    cleanLabel(slide.meal),
    cleanLabel(slide.stage),
    `步驟${actionIndex + 1}`,
  ].filter(Boolean).join(" - ");
  elements.helpOverlayName.textContent = action.name;
  // 永遠列出全部的動作，編號才跟控制台一致；wizard 沒勾的那幾條淡成灰色，
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

  const cost = state.helped?.[key];
  elements.helpOverlayCost.textContent = cost == null ? "—" : formatPoints(cost);

  fitHelpColumns();
}

function applyState(state) {
  doneKeys = new Set(state.done);
  helpedKeys = new Set(Object.keys(state.helped || {}));

  // wizard 按「捲回目前步驟」時 server 會把這個號碼 +1。
  const nonce = state.scrollNonce ?? 0;
  const recenterRequested = lastScrollNonce !== null && nonce !== lastScrollNonce;
  lastScrollNonce = nonce;

  currentIndex = Math.max(0, Math.min(slides.length - 1, state.currentIndex));

  if (currentIndex !== renderedIndex) {
    render();
  } else {
    syncActionStates();
  }

  if (recenterRequested) autoScroll(true);

  syncHelpOverlay(state);
}

function moveSlide(direction) {
  // 說明卡蓋著的時候不能換頁（按鈕與方向鍵都走這裡），先看完再說。
  if (overlayKey) return;
  const nextIndex = Math.max(0, Math.min(slides.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;
  // 換頁一樣寫回 server，wizard 的頁面切換器才會跟著動。
  window.WozStore.dispatch({ type: "setPage", index: nextIndex });
}

// 滑鼠離開整個列表就切回現在該做的那一步。
elements.actionList.addEventListener("mouseleave", () => showStep(pinnedIndex()));
// 圖片壞掉（檔名對但檔案有問題）時退回預留版位，不要留一個破圖。
elements.stepImage.addEventListener("error", () => {
  elements.stepImage.hidden = true;
  elements.imagePlaceholder.hidden = false;
});
elements.actionList.addEventListener("scroll", updateScrollCue, { passive: true });
window.addEventListener("resize", () => {
  updateScrollCue();
  // 進出全螢幕會改變可用高度，欄數要重算。
  fitDetailColumns();
  if (overlayKey) fitHelpColumns();
});
elements.scrollCue.addEventListener("click", () => {
  elements.actionList.scrollBy({ top: elements.actionList.clientHeight * 0.8, behavior: "smooth" });
});

elements.prevButton.addEventListener("click", () => moveSlide(-1));
elements.nextButton.addEventListener("click", () => moveSlide(1));
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

// 還沒收到第一份狀態前先畫一次，避免畫面空白。
render();

// 圖片清單晚一點才回來，回來後把目前預覽中的那張補上。
window.WozImages.onLoad(() => showImage(previewIndex));
window.WozImages.load();
