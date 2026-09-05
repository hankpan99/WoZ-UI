const STARTING_POINTS = 100;
// 將圖片放進 images 資料夾後，在此依 Excel 的步驟編號指定路徑。
// 例如："1": "images/step-01.jpg", "X": "images/check-cake.jpg"
const STEP_IMAGES = {};
const MEAL_ICONS = [
  { keyword: "巴斯克蛋糕", src: "images/icon/cake.png", alt: "巴斯克蛋糕" },
  { keyword: "吐司", src: "images/icon/toast.png", alt: "法式吐司" },
  { keyword: "優格", src: "images/icon/yogurt.png", alt: "水果優格" },
];
const slides = window.RECIPE_SLIDES || [];

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
  detailList: document.querySelector("#detail-list"),
  stepImage: document.querySelector("#step-image"),
  imagePlaceholder: document.querySelector("#image-placeholder"),
  prevButton: document.querySelector("#prev-button"),
  nextButton: document.querySelector("#next-button"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  fullscreenLabel: document.querySelector("#fullscreen-label"),
};

let currentIndex = 0;
let activeActionIndex = 0;
// 參與者點過的步驟（含 0 點的步驟），用來計算「本階段已完成步驟」與扣點。
const doneActions = new Set();

const slideCost = (slide) =>
  slide.actions.reduce((total, action) => total + action.cost, 0);

const formatPoints = (value) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value);

const actionKey = (slideIndex, actionIndex) => `${slideIndex}:${actionIndex}`;

// Excel 沒有餐點時會填 "-"，畫面上直接留白。
const cleanLabel = (value) => {
  const text = (value || "").trim();
  return text === "-" || text === "—" ? "" : text;
};

function chargedCost() {
  return [...doneActions].reduce((total, key) => {
    const [slideIndex, actionIndex] = key.split(":").map(Number);
    return total + (slides[slideIndex]?.actions[actionIndex]?.cost || 0);
  }, 0);
}

function updateRemainingPoints() {
  elements.remainingPoints.textContent = formatPoints(STARTING_POINTS - chargedCost());
}

function updateStageProgress() {
  const total = slides[currentIndex]?.actions.length || 0;
  const done = slides[currentIndex]?.actions.reduce(
    (count, _action, index) => count + (doneActions.has(actionKey(currentIndex, index)) ? 1 : 0),
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

function showAction(index) {
  const action = slides[currentIndex].actions[index];
  if (!action) return;

  activeActionIndex = index;
  elements.detailList.replaceChildren(
    ...action.details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );

  [...elements.actionList.children].forEach((button, buttonIndex) => {
    const selected = buttonIndex === index;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderActions(slide) {
  const buttons = slide.actions.map((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-card";
    button.setAttribute("aria-pressed", "false");
    button.classList.toggle("done", doneActions.has(actionKey(currentIndex, index)));

    const number = document.createElement("span");
    number.className = "action-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "action-name";
    name.textContent = action.name;

    button.append(number, name);
    if (action.cost > 0) {
      const cost = document.createElement("span");
      cost.className = "cost-pill";
      cost.textContent = `${formatPoints(action.cost)} 點`;
      button.append(cost);
    }

    button.addEventListener("mouseenter", () => showAction(index));
    button.addEventListener("focus", () => showAction(index));
    button.addEventListener("click", () => {
      showAction(index);
      doneActions.add(actionKey(currentIndex, index));
      button.classList.add("done");
      updateRemainingPoints();
      updateStageProgress();
    });
    return button;
  });

  elements.actionList.replaceChildren(...buttons);
  elements.actionList.scrollTop = 0;
  requestAnimationFrame(updateScrollCue);
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
  showAction(Math.min(activeActionIndex, slide.actions.length - 1));

  const imagePath = STEP_IMAGES[slide.step] || slide.image;
  if (imagePath) {
    elements.stepImage.src = imagePath;
    elements.stepImage.alt = `${mealName || stageName}步驟示意圖`;
    elements.stepImage.hidden = false;
    elements.imagePlaceholder.hidden = true;
  } else {
    elements.stepImage.hidden = true;
    elements.imagePlaceholder.hidden = false;
  }

  elements.prevButton.disabled = currentIndex === 0;
  elements.nextButton.disabled = currentIndex === slides.length - 1;
  elements.nextButton.innerHTML = currentIndex === slides.length - 1
    ? '已完成 <span aria-hidden="true">✓</span>'
    : '下一步 <span aria-hidden="true">→</span>';
}

function moveSlide(direction) {
  const nextIndex = Math.max(0, Math.min(slides.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;
  currentIndex = nextIndex;
  activeActionIndex = 0;
  render();
}

elements.actionList.addEventListener("scroll", updateScrollCue, { passive: true });
window.addEventListener("resize", updateScrollCue);
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

render();
