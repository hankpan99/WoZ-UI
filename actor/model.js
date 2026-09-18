// Actor 與 Client 共用 server 狀態；只產生顯示資料，不送出實驗動作。
(function () {
  const { pickedDetails, proactiveDetails, proactiveLevel, proactiveCost } = window.WozFormat;
  function actionLetter(index) {
    let label = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      label = String.fromCharCode(65 + (value - 1) % 26) + label;
    }
    return label;
  }
  // 沒有介入指令時，Actor 上方要跟 Client 看同一個步驟：
  // Wizard 有指定預覽步驟就跟著它，否則是本頁第一個還沒完成的步驟（整頁完成就停在最後一步）。
  function idleKey(state, slides) {
    if (state.clientViewKey) return state.clientViewKey;
    const pageIndex = state.currentIndex || 0;
    const actions = slides[pageIndex]?.actions || [];
    if (!actions.length) return null;
    const done = new Set(state.done || []);
    const index = actions.findIndex((_action, position) => !done.has(`${pageIndex}:${position}`));
    return `${pageIndex}:${index === -1 ? actions.length - 1 : index}`;
  }
  // 只給上方區塊用的顯示資料：沒有語句、沒有花費，純粹讓 Actor 知道參與者正在做哪一步。
  function idle(state, slides) {
    const key = idleKey(state, slides);
    if (!key) return null;
    const [pageIndex, actionIndex] = key.split(":").map(Number);
    const slide = slides[pageIndex];
    const action = slide?.actions[actionIndex];
    if (!action) return null;
    return {
      key: `idle:${key}`, kind: "idle", answer: null, level: "1",
      page: slide.step, actionNumber: actionIndex + 1, image: slide.image || "",
      name: action.name,
      step: `階段 ${slide.step} - 步驟 ${actionLetter(actionIndex)}`,
      lines: [],
      details: (action.details || []).map((text) => ({ text, selected: true })),
    };
  }
  function view(state, slides, speech) {
    if (state.actorError) return {
      key: `error:${state.actorError}`, kind: "error", title: "向參與者說明", level: "error",
      name: "", step: "", answer: null, image: "", details: [], lines: [],
      message: speech.explanation?.[state.actorError] || state.actorError,
    };
    if (Object.prototype.hasOwnProperty.call(state, "actorOverlay")) {
      const overlay = state.actorOverlay;
      if (!overlay) return null;
      state = {
        ...state,
        proactiveOverlay: overlay.proactive ? overlay.key : null,
        helpOverlay: overlay.proactive ? null : overlay.key,
        helpModes: { ...state.helpModes, [overlay.key]: overlay.mode },
        helpDetails: { ...state.helpDetails, [overlay.key]: overlay.details },
      };
    }
    const proactive = Boolean(state.proactiveOverlay);
    const key = state.proactiveOverlay || state.helpOverlay;
    if (!key) return null;
    const [pageIndex, actionIndex] = key.split(":").map(Number);
    const slide = slides[pageIndex];
    const action = slide?.actions[actionIndex];
    if (!action) return null;
    const mode = state.helpModes?.[key] || "physical";
    const direct = proactive && proactiveLevel(action).startsWith("4.");
    const kind = proactive ? (direct ? "direct" : "inquiry")
      : (mode === "voice_reminder" ? "voice_reminder" : mode === "voice" ? "voice" : "physical");
    const titles = {
      physical: "實體介入（1. 參與者指揮Alex）",
      voice: "語音介入（1. 參與者指揮Alex）",
      voice_reminder: "語音介入（2. Alex語音提醒建議）",
    };
    const details = action.details || [];
    const picked = new Set(proactive ? proactiveDetails(action) : pickedDetails(state, key, details.length));
    const response = proactive ? state.proactive?.[key]?.status || "pending" : null;
    const answer = direct && response === "pending" ? null : response;
    const context = {
      step: actionLetter(actionIndex), action: actionLetter(actionIndex), name: action.name,
      details: details.filter((_, index) => picked.has(index)).join("；") || action.name,
    };
    const templates = kind === "voice_reminder" || kind === "voice"
      ? details.flatMap((detail, index) => picked.has(index)
        ? (speech[kind] || []).map((line) => ({
          ...line,
          label: line.label.replace(/\{number\}/g, String(index + 1).padStart(2, "0")),
          text: line.text.replace(/\{detail\}/g, () => detail),
        })) : [])
      : speech[kind] || [];
    return {
      key, kind, answer,
      cost: proactive ? state.proactive?.[key]?.cost ?? proactiveCost(action) : state.helped?.[key],
      costLabel: proactive && !state.proactive?.[key]?.status ? "接受將花費" : "本次花費",
      category: proactive || mode === "voice_reminder" ? "proactive" : "passive",
      page: slide.step, actionNumber: actionIndex + 1, image: slide.image || "",
      level: proactive ? (direct ? "4" : "3") : (mode === "voice_reminder" ? "2" : "1"),
      title: proactive ? `實體介入（${proactiveLevel(action)}）` : (titles[mode] || titles.physical),
      name: action.name,
      step: `階段 ${slide.step} - 步驟 ${actionLetter(actionIndex)}`,
      lines: templates.map((line) => ({
        label: line.label,
        when: line.when || null,
        text: line.text.replace(/\{(step|action|name|details)\}/g, (_, token) => context[token]),
        active: direct && answer === "declined" ? line.when === "stop"
          : (!line.when || line.when === answer),
      })),
      details: details.map((text, index) => ({ text, selected: picked.has(index) })),
    };
  }
  window.ActorModel = { view, idle };
})();
