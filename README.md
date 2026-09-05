# 食譜教學投影片

直接用瀏覽器開啟 `index.html` 即可使用。也可以在這個資料夾執行：

```sh
python3 -m http.server 8000
```

再前往 `http://localhost:8000`。

點擊上方資訊區右側的「全螢幕」即可進入全螢幕模式；按 `Esc` 離開。版面固定在一個電腦螢幕內，內容過長時會在任務列表或詳細步驟區內捲動。

## 畫面上的三個進度資訊

- **右上角資訊卡**：顯示目前的「餐點 階段」（同一行、顏色不同；Excel 中餐點為 `-` 時只顯示階段），下方數字是「本階段已完成步驟 / 本階段步驟總數」。參與者每點擊一個步驟卡就 +1，重複點同一個不會重複計算。
- **最下方進度條右側**：顯示「目前頁數 / 總頁數」。
- **右側步驟列表**：可捲動時，上下會出現漸層遮罩，下方還有步驟時會出現 `▼` 按鈕，點它可往下捲一頁。

## 更新 Excel 資料

Excel 有修改時執行：

```sh
python3 scripts/extract_recipe.py
```

程式會從 `data/User Study v3.xlsx` 的「食譜excel v2」讀取資料，並重新產生 `data/recipe-data.js`，不會修改 Excel。每當「餐點」或「階段」欄出現值時會建立新的一頁；「種類」欄不會匯入。

執行完成後也會以表格列出各個「餐點－階段」的總花費。若環境有安裝 `prettytable` 會自動使用；未安裝時會使用腳本內建的等寬表格，不影響資料產生。

## 調整點數與圖片

- 初始點數：修改 `app.js` 開頭的 `STARTING_POINTS`。
- 「剩餘點數」只會在參與者點擊選項時扣除；換頁、滑鼠移入與重複點擊同一選項都不會重複扣點。0 點的選項點擊後會計入「本階段已完成步驟」，但不扣點。
- 上方區塊高度：修改 `styles.css` 開頭的 `--top-panel-height`；螢幕高度不超過 760px 時使用 `--top-panel-height-compact`。
- 全螢幕按鈕區寬度：修改 `--fullscreen-width`。
- 上方「剩餘步驟花費」寬度：修改 `--cost-panel-width`。
- 上方「剩餘點數」寬度：修改 `--points-panel-width`。
- 上方「階段進度＋圖片」寬度：修改 `--step-panel-width`。
- 上方區塊左側標題：修改 `--stat-label-size`。
- 上方區塊右側數字：修改 `--stat-value-size`。
- 上方數字旁的「點」與階段步驟總數：修改 `--stat-unit-size`。
- 上方步驟卡的餐點名稱：修改 `--meal-label-size`。
- 上方步驟卡的階段名稱：修改 `--stage-name-size`（與餐點名稱同一行，建議設成一樣大）。
- 上方步驟卡的「本階段已完成步驟」小字：修改 `--stage-hint-size`。
- 最下方進度條旁的頁數：修改 `--progress-count-size`。
- 右側步驟名稱：修改 `--step-name-size`。
- 步驟卡最左側編號：修改 `--step-index-size`。
- 點數標籤：修改 `--cost-size`。
- 步驟卡之間的距離：修改 `--action-gap`。
- 詳細步驟標題：修改 `--detail-title-size`。
- 詳細步驟內文：修改 `--detail-text-size`。
- 詳細步驟欄數：修改 `--detail-columns`，設為 `1` 是單欄、`2` 是雙欄。
- 詳細步驟上下／左右間距：修改 `--detail-row-gap` 與 `--detail-column-gap`。
- 步驟圖片：將圖片放入 `images` 資料夾，再在 `app.js` 開頭的 `STEP_IMAGES` 指定路徑，例如：

```js
const STEP_IMAGES = {
  "1": "images/step-01.jpg",
  "X": "images/check-cake.jpg",
};
```

最上方「步驟」資訊卡右側的餐點圖示依 `app.js` 中的 `MEAL_ICONS` 自動判斷，目前使用：

- 巴斯克蛋糕：`images/icon/cake.png`
- 吐司：`images/icon/toast.png`
- 優格：`images/icon/yogurt.png`

圖示寬度與高度可修改 `styles.css` 開頭的 `--meal-icon-width` 和 `--meal-icon-height`；螢幕高度不超過 760px 時使用 `--meal-icon-height-compact`。

建議圖片使用 16:9 或 3:2 橫式比例；沒有圖片時會自動顯示簡潔的預留版位。

## 調整全部顏色

所有頁面顏色都集中在 `styles.css` 最上方的「全站色彩」區。修改該區的變數即可更換背景、文字、邊框、重點色、點數標籤、選取狀態與陰影，不需要搜尋下方的 CSS 規則。

### 正在進行中的步驟

- `--active-bg`：底色（想更明顯就調深）。
- `--active-border`：外框顏色。
- `--active-bar`：左側直條色。
- `--active-ink`：步驟名稱文字色。
- `--active-shadow`：外陰影。
- 只有滑鼠經過、還沒選取的卡片用 `--card-hover-bg` 與 `--card-hover-border`，與上面的 `--active-*` 是分開的。

### 已完成的步驟

點擊過的步驟整張卡（含點數標籤）會轉成灰階，不會另外加勾勾：

- `--done-grayscale`：灰階強度，`1` 是全灰、`0` 是不變灰。
- `--done-opacity`：淡化程度，數字越小越淡。
