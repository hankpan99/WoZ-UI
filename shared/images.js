// 步驟圖片清單。server 掃描 images/steps/ 之後回傳，
// key 用的是畫面上看得到的編號："3-2" ＝ 第 3 頁第 2 個步驟、"3" ＝ 第 3 頁的預設圖。
(function () {
  const listeners = new Set();
  let manifest = {};

  async function load() {
    try {
      const response = await fetch("/api/images");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      manifest = (await response.json()).images || {};
    } catch (error) {
      console.warn("無法讀取步驟圖片清單", error);
      manifest = {};
    }
    listeners.forEach((fn) => fn(manifest));
    return manifest;
  }

  // 先找該步驟專屬的圖，沒有就退回該頁的預設圖。
  function get(pageStep, stepNumber) {
    if (stepNumber != null && manifest[`${pageStep}-${stepNumber}`]) {
      return manifest[`${pageStep}-${stepNumber}`];
    }
    return manifest[String(pageStep)] || "";
  }

  window.WozImages = {
    load,
    get,
    has: (pageStep, stepNumber) => Boolean(get(pageStep, stepNumber)),
    // 只看該步驟有沒有專屬圖，不算整頁的預設圖。
    hasOwn: (pageStep, stepNumber) => Boolean(manifest[`${pageStep}-${stepNumber}`]),
    onLoad(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
