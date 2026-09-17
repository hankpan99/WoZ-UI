// 模式選取只留在 Wizard；明確執行後才送出扣點動作。
(function () {
  function create(dispatch, onChange) {
    const selected = new Map();
    const pending = new Set();
    const messages = new Map();
    return {
      mode: (key) => selected.get(key),
      busy: (key) => pending.has(key),
      message: (key) => messages.get(key) || "",
      clear() {
        selected.clear();
        messages.clear();
        onChange();
      },
      select(key, mode) {
        if (pending.has(key)) return;
        if (selected.get(key) === mode) selected.delete(key);
        else selected.set(key, mode);
        messages.delete(key);
        onChange();
      },
      async execute(key, cost) {
        const mode = selected.get(key);
        if (!mode || pending.has(key) || !Number.isFinite(cost) || cost < 0) return false;
        pending.add(key);
        messages.delete(key);
        onChange();
        let success = false;
        try {
          const result = await dispatch({ type: "repeatHelped", key, mode, cost });
          success = result?.changed === true;
          if (success) {
            selected.delete(key);
            messages.set(key, mode === "voice_reminder"
              ? "已執行，字卡已顯示；關閉字卡後開始執行。再次執行請重新選擇模式。"
              : "已加入佇列；在上方佇列按「顯示字卡」開始執行。再次執行請重新選擇模式。");
          } else {
            messages.set(key, result ? "未執行，請確認模式與 server 狀態。" : "未收到執行結果，請先確認紀錄再重試。");
          }
        } catch (error) {
          messages.set(key, "未收到執行結果，請先確認紀錄再重試。");
        } finally {
          pending.delete(key);
          onChange();
        }
        return success;
      },
    };
  }
  window.WizardIntervention = { create };
})();
