// 前端連線層：訂閱 server 推來的狀態，並把使用者操作以 action 送回去。
//
// 狀態的真相在 server，這裡不做樂觀更新 —— localhost 往返只有幾毫秒，
// 換來的是「畫面永遠等於 server 狀態」，不需要任何回滾邏輯。
(function () {
  const listeners = new Set();
  const statusListeners = new Set();

  let state = null;
  let status = "connecting"; // connecting | connected | disconnected

  function setStatus(next) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((fn) => fn(status));
  }

  function connect() {
    const source = new EventSource("/api/events");

    source.addEventListener("open", () => setStatus("connected"));

    source.addEventListener("message", (event) => {
      let next;
      try {
        next = JSON.parse(event.data);
      } catch (error) {
        console.warn("收到無法解析的狀態", error);
        return;
      }
      const previous = state;
      state = next;
      setStatus("connected");
      listeners.forEach((fn) => fn(state, previous));
    });

    // EventSource 會自己重連，server 每次連上都先推一次完整狀態，
    // 所以斷線復原是自動的，這裡只要更新提示。
    source.addEventListener("error", () => setStatus("disconnected"));
  }

  async function dispatch(action) {
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus("connected");
      return await response.json();
    } catch (error) {
      setStatus("disconnected");
      console.warn("送出動作失敗", action, error);
      return null;
    }
  }

  window.WozStore = {
    get state() {
      return state;
    },
    get status() {
      return status;
    },
    subscribe(fn) {
      listeners.add(fn);
      if (state) fn(state, null);
      return () => listeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      fn(status);
      return () => statusListeners.delete(fn);
    },
    dispatch,
  };

  connect();
})();
