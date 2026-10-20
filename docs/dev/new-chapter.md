# 新增一章：範本與檢查清單

新增 `ch15`（或延伸章 `ch11b` 這種）時，先用範本產生器長出標準資料夾，再照下面的清單把它接進全站。內容規範見 `docs/teaching-style.md`，目錄與測試約定見 `docs/dev-conventions.md` §1，共用元件的 API 見 `docs/dev/infra-api.md`「章節共用元件」。

## 1. 產生骨架

```
node scripts/new-chapter.mjs <NN> <slug>          # 例：node scripts/new-chapter.mjs 15 adaptive-step
node scripts/new-chapter.mjs 15 adaptive-step --dry-run   # 只列出會產生的檔案
```

- `NN` 是兩位數字，延伸章加一個小寫字母（`15`、`11b`）；`slug` 是英文短字，只用在檔頭註解。
- 資料夾已存在時拒絕（不覆蓋）；腳本不改任何既有檔案。
- 產生的檔案：

| 檔案 | 內容 |
|---|---|
| `index.tsx` | `export default function ChapterNN()`：Intro → （你的各節）→ Wrap → Symbols；符號表是整頁最後一個區塊 |
| `sections/Intro.tsx` | 章首：這一課要回答的問題、系統地圖（`SystemMap`）、標籤列；`<Section id="chNN-question">` |
| `sections/Wrap.tsx` | 思考題（`Quiz`）與本課必記（`Recap`）；`<Section id="chNN-wrap">` |
| `sections/Symbols.tsx` | 符號表（`SymbolTable`），外層 `id="symbols"`；符號用 TeX |
| `common.tsx` | `Hand`（= `bindHandCalc(HANDCALCS)`）、`texNum`（= `makeTexNum(4)`）、`Fig`／`FigRef`（`ChapterFig` 的查表）：全是共用元件的綁定 |
| `formulas.ts`／`handcalcs.ts`／`diagrams.ts` | 空的 `FORMULAS`、`HANDCALCS`、`CHNN_DIAGRAMS`（空清單合法）與註解裡的範例 |
| `chapter.css` | 只放章節專屬的版面（class 加 `chNN-` 前綴）；勘誤、手算引言、方塊圖導讀、跳轉按鈕的樣式在共用層 |
| `chNN.test.tsx` | 整頁 smoke（沒有 KaTeX 錯誤、符號表在最後）＋「每個 section 都有唯一的 id」 |
| `diagrams.test.tsx`／`handcalcs.test.tsx`／`formulas.test.ts`／`presets.test.ts` | 登錄格式、真的 Mermaid 渲染、手算預設值合法、公式 TeX 可解析、`page` 為 `/ch/NN` 的 preset 格式 |

產生後立刻跑 `npx vitest run src/chapters/chNN` 與 `npx tsc -b --noEmit`，應該全綠；之後每加一節、一條公式、一題手算就同步補測試。

## 2. 把這一章接進全站

照順序做；每一項後面是會抓到漏接的測試或腳本。

| # | 檔案 | 要做的事 | 檢查 |
|---|---|---|---|
| 1 | `src/app/registry.ts` | `PAGES` 加一筆：`id: 'chNN'`、`path: '/ch/NN'`、`nav`、`title`、`group`（A 基礎／B 系統／C 進階）、`specSections`、`tests`、`component: ch('NN')`。導覽、路由、Dashboard、Formula 頁都讀這個陣列，不要在別處再寫章節清單 | `src/app/navigation.test.tsx`、`src/data/docsFacts.test.ts` |
| 2 | `src/app/chapterMeta.ts` | `CHAPTER_FRAME_META` 加一筆：`reading`（三種模式的實測內容量，用 `node scripts/reading-time.mjs --routes /ch/NN --base http://localhost:5173` 量）、`errata`（本章負責的勘誤 id）、`prereqs`（2–4 條先備自檢，`anchor` 要是該章原始碼裡真的有的 id）、`models`、`next`；前一章的 `next` 改成指向這一章，這一章的 `next` 指向下一頁 | `src/app/chapterMeta.test.ts` |
| 3 | `src/app/backbone.ts` | Beginner 骨幹路線要不要走這一章；段落級的步驟用 `anchor: 'chNN-<slug>'`（用本章的段落 id，見 §3） | `src/app/backbone.test.ts` |
| 4 | `src/pages/dashboard/data.ts` | `CHAPTER_META`：章的模型層級與一句摘要；15 個問題（`QUESTIONS`）裡有哪些問題這一章回答了，就把 `pages` 補上 | `src/pages/dashboard/data.test.ts` |
| 5 | `src/chapters/ch00/learningMap.ts` | 學習地圖（附錄 E 的問題 → 去哪一章）有新的對應就補 | `src/chapters/ch00/index.test.tsx` |
| 6 | `src/pages/gallery` | 要放進 Experiment Gallery 的實驗：`src/data/presets/<id>.json`（`page: '/ch/NN'`、`experiment` 是 `ExperimentShell` 的 id、`source: 'illustrative'`），preset 以 glob 收集，不需要中央清單 | `src/pages/gallery/data.test.ts`、`chNN/presets.test.ts` |
| 7 | `src/pages/roadmap/data.ts` | 路線圖上這一章回答什麼、用到哪些結論 | `src/pages/roadmap/data.test.ts` |
| 8 | `src/data/errata.json` | 本章處理的勘誤，`chapters` 欄補上這一章（`chapterMeta.errata` 要等於這裡的記錄） | `src/app/chapterMeta.test.ts`、`src/data/validate.test.ts` |
| 9 | `src/data/verification-status.json` | 新的 T-id（`it('Txx: …')` 命名的測試）；由 `scripts/verify.mjs` 彙整，不要手改 | `npm run verify` |
| 10 | `scripts/reading-time.mjs` | `ALL_ROUTES` 加 `/ch/NN`（章節順序） | 手動 |
| 11 | `README.md`、`docs/implementation_plan.md` | 章節頁數、公式、手算題、preset、方塊圖的數量（只改數字，別改句子） | `src/data/docsFacts.test.ts` |
| 12 | `docs/dev-conventions.md`、`docs/teaching-style.md` | 章的範圍一覽、新規則；共用元件有新增就寫進 `docs/dev/infra-api.md` | `src/data/docsFacts.test.ts` |

公式 ID（`F-NN.序`）、手算題 ID（`HC-NN.序`）、方塊圖 id、preset id 都是全站唯一；延伸章（`11b`）的公式與手算題 ID 用大寫（`F-11B.1`、`HC-11B.1`），class 與段落 id 用小寫（`ch11b-…`）。

## 3. 寫內容時的規則（會被測試檢查的）

- **穩定的段落 id**：每個有 h2／h3 標題的 `<Section>`／`<section>` 都要有 `id="chNN-<英文短字>"`（小寫英數與連字號，章內唯一）。已經有 id 的不改——PageOutline、`?a=` 深連結、骨幹路線與讀者存下的連結都靠它。`src/data/chapterTemplate.test.ts` 掃原始碼檢查，`src/data/chapterTemplate.dom.test.tsx` 把每一章用 Research 模式渲染一次、用 `sectionIdReport`（`@/components`）檢查渲染後的 DOM（有標題的 section 都有 id、整頁沒有重複的 id）；章節自己的 smoke test 也可以呼叫它（範本已經附上）。
- **共用元件，不自寫**：勘誤用 `ChapterErratum`（短註記放 children，較長的說明放 `detail`；區塊版用 `ChapterErratumNote`）；帶入手算用 `common.tsx` 的 `Hand`；方塊圖用 `ChapterFig`（`common.tsx` 的 `Fig` 只負責查表）；頁內跳轉用 `JumpTo`／`jumpToId`／`AnchorLink`／`HandLink`（HashRouter 不能用 `href="#id"`）；數字進 TeX 用 `makeTexNum`。`chapterTemplate.test.ts` 會抓到章內再出現自己的 `Erratum`／`scrollToId`／`texNum` 實作、直接呼叫 `scrollIntoView` 與 `href="#/verification"`。
- **預設是 Beginner 模式**：測試裡要數圖、數段落，先 `renderPage(…, { mode: 'engineer' })`（或 `'research'`，ModeGate 內的內容才會出現）。
- **晶片數字一律是 illustrative**；帶入手算的數值由模型函式算出，並在 `handcalcs.test.tsx` 逐一核對（容許誤差寫清楚，數值上是 0 的量要給 `abs`）。
- **JSX 裡中文字之間不要靠換行**：`node scripts/check-cjk-spaces.mjs src/chapters/chNN`。
- **aria-label／title 等純文字名稱裡的數學**要經過 `accessibleText`。

## 4. 驗收

```
npx tsc -b --noEmit
npx eslint src/chapters/chNN
npx vitest run src/chapters/chNN src/data/chapterTemplate.test.ts src/app --maxWorkers=2
node scripts/check-cjk-spaces.mjs src/chapters/chNN
node scripts/diagram-audit.mjs --routes /ch/NN --base http://localhost:5173
node scripts/scroll-audit.mjs --routes /ch/NN --base http://localhost:5173
node scripts/screenshots.mjs --routes /ch/NN --shots top,mermaid:2,handcalc:1 --mode engineer --base http://localhost:5173
npm run verify
```

方塊圖審查（訊號名稱、箭頭方向、加法點正負號）與捲軸審查（沒有只捲幾個像素的捲軸）都應該是 0 筆問題；旗標與判讀見 `docs/dev-conventions.md` §8。
