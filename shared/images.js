// 圖片清單。server 掃描之後回傳兩份：
//   images/steps/ → key 是畫面上看得到的編號："3-2" ＝ 第 3 頁第 2 個步驟、"3" ＝ 第 3 頁的預設圖
//   images/icon/  → key 就是檔名（去掉副檔名），要用哪一個由 client.js 的 stageIcon 決定
(function () {
  const listeners = new Set();
  let manifest = {};
  let icons = {};

  async function load() {
    try {
      const response = await fetch("/api/images");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      manifest = payload.images || {};
      icons = payload.icons || {};
    } catch (error) {
      console.warn("無法讀取圖片清單", error);
      manifest = {};
      icons = {};
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
    // 依序試好幾個檔名，第一個存在的就用。
    icon: (...names) => names.map((name) => icons[String(name)]).find(Boolean) || "",
    has: (pageStep, stepNumber) => Boolean(get(pageStep, stepNumber)),
    // 只看該步驟有沒有專屬圖，不算整頁的預設圖。
    hasOwn: (pageStep, stepNumber) => Boolean(manifest[`${pageStep}-${stepNumber}`]),
    onLoad(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
