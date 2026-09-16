(function () {
  const find = (id) => document.getElementById(id);
  let currentView = null;
  function speechCard(line) {
    const card = document.createElement("dl");
    card.className = "speech-line flow-card";
    card.classList.toggle("is-inactive", !line.active);
    if (line.when) card.dataset.branch = line.when;
    const label = document.createElement("dt");
    label.textContent = line.label;
    const text = document.createElement("dd");
    text.textContent = line.text;
    card.append(label, text);
    return card;
  }
  function speechSequence(lines) {
    const sequence = document.createElement("div");
    sequence.className = "flow-sequence";
    lines.forEach((line, index) => {
      if (index) {
        const arrow = document.createElement("span");
        arrow.className = "flow-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "→";
        sequence.append(arrow);
      }
      sequence.append(speechCard(line));
    });
    return sequence;
  }
  function renderSpeech(view) {
    const container = find("speech-lines");
    container.replaceChildren();
    if (!view) return;
    if (view.kind === "error") {
      const message = document.createElement("p");
      message.className = "actor-error-message";
      message.textContent = `：${view.message}`;
      container.append(message);
      return;
    }
    const flow = document.createElement("div");
    flow.className = "speech-flow";
    if (view.kind === "voice_reminder" || view.kind === "voice") {
      flow.classList.add("reminder-flow");
      view.lines.forEach((line) => flow.append(speechCard(line)));
      if (!view.lines.length) {
        const empty = document.createElement("p");
        empty.textContent = "本次未勾選語音提醒動作。";
        flow.append(empty);
      }
    } else if (view.kind === "inquiry" || view.kind === "direct") {
      const root = view.kind === "inquiry" ? view.lines.filter((line) => line.when === "pending")
        : view.lines.filter((line) => !line.when).slice(0, 1);
      const branches = view.kind === "inquiry"
        ? [view.lines.filter((line) => line.when === "accepted"), view.lines.filter((line) => line.when === "declined")]
        : [view.lines.filter((line) => !line.when).slice(1), view.lines.filter((line) => line.when === "stop")];
      if (root.length) flow.append(speechSequence(root));
      const fork = document.createElement("div");
      fork.className = "flow-branches";
      branches.filter((lines) => lines.length).forEach((lines) => {
        const branch = speechSequence(lines);
        branch.classList.add("flow-branch");
        fork.append(branch);
      });
      flow.append(fork);
    } else {
      flow.append(speechSequence(view.lines));
    }
    container.append(flow);
  }
  function fitDetails() {
    const scroller = find("detail-scroll");
    const list = find("detail-list");
    for (let columns = 1; columns <= 3; columns += 1) {
      list.style.columnCount = String(columns);
      if (scroller.scrollHeight <= scroller.clientHeight) break;
    }
  }
  function showImage() {
    const image = find("step-image");
    const path = currentView ? window.WozImages.get(currentView.page, currentView.actionNumber) || currentView.image : "";
    image.hidden = !path;
    find("image-empty").hidden = Boolean(path);
    if (path) {
      if (image.getAttribute("src") !== path) image.src = path;
      image.alt = currentView.name;
    } else {
      image.removeAttribute("src");
      image.alt = "";
    }
  }
  function render(state) {
    const view = window.ActorModel.view(state, window.RECIPE_SLIDES || [], window.ACTOR_SPEECH);
    if (view?.key !== currentView?.key) find("detail-scroll").scrollTop = 0;
    currentView = view;
    document.querySelector(".actor-shell").classList.toggle("is-idle", !view);
    document.querySelector(".actor-shell").classList.toggle("is-error", view?.kind === "error");
    document.querySelector(".actor-shell").dataset.level = view?.level || "1";
    find("intervention-title").textContent = view?.title || "等待介入指令";
    find("step-label").textContent = view?.step || "";
    find("action-name").textContent = view?.name || "";
    find("action-name").hidden = !view || view.kind === "error";
    find("speech-empty").hidden = Boolean(view);
    find("answer").hidden = !view?.answer || view.answer === "pending";
    find("answer").textContent = { accepted: "參與者已接受", declined: "參與者已拒絕" }[view?.answer] || "";
    find("answer").dataset.answer = view?.answer || "";
    if (view?.kind === "direct" && view.answer === "declined") find("answer").textContent = "參與者要求停止";
    renderSpeech(view);
    find("detail-list").replaceChildren(...(view?.details || []).map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail.text;
      item.classList.toggle("is-off", !detail.selected);
      return item;
    }));
    find("details-empty").hidden = !view || view.kind === "error" || Boolean(view.details.length);
    showImage();
    fitDetails();
  }
  find("fullscreen-button").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { console.warn("無法切換全螢幕", error); }
  });
  document.addEventListener("fullscreenchange", () => {
    const label = document.fullscreenElement ? "離開全螢幕" : "全螢幕";
    find("fullscreen-button").title = label;
    find("fullscreen-button").setAttribute("aria-label", label);
    find("fullscreen-button").setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  });
  window.WozStore.onStatus((status) => { find("offline-banner").hidden = status !== "disconnected"; });
  window.WozStore.subscribe(render);
  find("step-image").addEventListener("error", () => {
    find("step-image").hidden = true;
    find("image-empty").hidden = false;
  });
  window.addEventListener("resize", fitDetails);
  window.WozImages.onLoad(showImage);
  window.WozImages.load();
})();
