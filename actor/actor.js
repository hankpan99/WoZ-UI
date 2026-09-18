(function () {
  // 沒有介入指令時，上方區塊要不要顯示參與者目前這一步的圖片與詳細動作（跟 Client 畫面同步）。
  // 設成 false 就回到只有「等待介入指令」一行字的樣子。
  const SHOW_IDLE_PREVIEW = true;
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
    text.replaceChildren(...speechText(line));
    card.append(label, text);
    return card;
  }
  // 「的部分動作」要單獨標成紅字，其餘照原本的顏色。
  function speechText(line) {
    const mark = window.ACTOR_SPEECH.partial;
    if (!line.partial || !mark || !line.text.includes(mark)) return [line.text];
    const [head, ...rest] = line.text.split(mark);
    const highlight = document.createElement("span");
    highlight.className = "speech-partial";
    highlight.textContent = mark;
    return [head, highlight, rest.join(mark)];
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
  // 一段主線，後面可以再分叉出幾條支線；支線本身也可以是另一個有分叉的節點。
  function flowNode(lines, branches) {
    const main = speechSequence(lines);
    const nodes = (branches || []).filter(Boolean);
    if (!nodes.length) return main;
    const fork = document.createElement("div");
    fork.className = "flow-branches";
    nodes.forEach((node) => {
      node.classList.add("flow-branch");
      fork.append(node);
    });
    const split = document.createElement("div");
    split.className = "flow-split";
    split.append(main, fork);
    return split;
  }
  const flowBranch = (lines, branches) => (lines.length ? flowNode(lines, branches) : null);
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
    } else if (view.kind === "physical" || view.kind === "inquiry" || view.kind === "direct") {
      const at = (when) => view.lines.filter((line) => (line.when || null) === when);
      // 三種實體介入的尾巴都一樣：正在執行 →（完成）／（參與者要求停止）。
      // 詢問後介入只是在前面多一段「先問，接受了才開始執行」。
      const run = view.kind === "inquiry" ? at("accepted") : at(null);
      const stop = at("stop");
      // 有獨立的「要求停止」才需要分叉；沒有就一路接下去，流程圖不會多長一行。
      const running = stop.length
        ? flowNode(run.slice(0, 1), [flowBranch(run.slice(1)), flowBranch(stop)])
        : speechSequence(run);
      flow.append(view.kind === "inquiry"
        ? flowNode(at("pending"), [running, flowBranch(at("declined"))])
        : running);
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
    // 上方區塊：有介入就顯示介入內容，沒有的話（且旗標開著）顯示參與者目前這一步。
    const preview = view || !SHOW_IDLE_PREVIEW
      ? null : window.ActorModel.idle(state, window.RECIPE_SLIDES || []);
    const top = view || preview;
    if (top?.key !== currentView?.key) find("detail-scroll").scrollTop = 0;
    currentView = top;
    document.querySelector(".actor-shell").classList.toggle("is-idle", !view);
    document.querySelector(".actor-shell").classList.toggle("has-idle-preview", Boolean(preview));
    document.querySelector(".actor-shell").classList.toggle("is-error", view?.kind === "error");
    document.querySelector(".actor-shell").dataset.level = view?.level || "1";
    find("intervention-title").textContent = view?.title || "等待介入指令";
    find("step-label").textContent = top?.step || "";
    find("action-name").textContent = top?.name || "";
    find("action-name").hidden = !top || top.kind === "error";
    find("speech-empty").hidden = Boolean(view);
    find("answer").hidden = !view?.answer || view.answer === "pending";
    find("answer").textContent = { accepted: "參與者已接受", declined: "參與者已拒絕" }[view?.answer] || "";
    find("answer").dataset.answer = view?.answer || "";
    if (view?.kind === "direct" && view.answer === "declined") find("answer").textContent = "參與者要求停止";
    renderSpeech(view);
    find("detail-list").replaceChildren(...(top?.details || []).map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail.text;
      item.classList.toggle("is-off", !detail.selected);
      return item;
    }));
    find("details-empty").hidden = !top || top.kind === "error" || Boolean(top.details.length);
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
