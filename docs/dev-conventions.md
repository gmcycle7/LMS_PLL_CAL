# 開發約定（Dev Conventions）

本文件是改這個專案時要遵守的約定：目錄結構、共用元件、單位與極性、測試、審查腳本。主規格是 `docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md`；規格中的勘誤以 `docs/validation.md` 為準；全站的架構約定（DTC 在 reference 輸入端）見 `docs/assumptions.md` §2a；寫作與圖表風格見 `docs/teaching-style.md`；共用模組的完整 API 與使用注意事項見 `docs/dev/infra-api.md`。

## 0. 架構總覽

- **純前端**：React 18 + TypeScript + Vite 6，`HashRouter`（可直接部署成靜態網站，路由長得像 `#/ch/05`）。所有模擬都在瀏覽器執行；重運算（Monte Carlo、長序列 PSD、sweep）放進 Web Worker。
- **Python 只做 golden model**：`golden/` 內的 pytest 以 NumPy/SciPy 獨立計算 T01–T18 等參考值，並輸出 `golden/vectors/*.json`；Vitest 讀這些 JSON 與 TypeScript 實作交叉比對。
- **數值核心與 UI 分離**：`src/simulation/**` 不得 import React 或 DOM；UI 只呼叫 simulation 函式。任何曲線都必須由公式或 simulation 產生，禁止手寫假資料。
- 路徑別名：`@/` → `src/`。

```
src/
├── app/                 # 路由註冊表 registry.ts、Layout、設定（主題／學習模式）、presets 與 handcalcs 的彙整
├── components/          # 共用 UI 元件（見 §2）
├── chapters/chNN/       # ch00–ch14 與 ch11b，每章一個資料夾，index.tsx default export（見 §1）
├── pages/<name>/        # dashboard, models, verification, lab, workbook, gallery, signoff, formulas, papers, roadmap, case-sspll
├── simulation/
│   ├── core/            # rng, special, complex, poly, linalg, stats, units
│   ├── signal/          # fft, window, psd, filter, corr
│   └── models/          # lms, comparator, pll, dsm, dtc, blockLms, stability, calNoise, mimo, bias, quantizer, optimizer, unifiedLab …
├── workers/             # Web Worker 進入點與任務註冊
├── data/                # presets/*.json、errata.json、sspll/、types.ts、verification-status.json
└── styles/              # global.css（design token、全站樣式）
golden/                  # Python golden model + pytest + vectors/
analysis/sspll/          # SSPLL GOS/PHOS 極性分析（理論、時域模擬、golden）
scripts/                 # verify.mjs、reading-time.mjs 與四支審查腳本（見 §8）
docs/                    # 規格、勘誤、假設、風格規範、本文件
```

## 1. 新增或修改頁面的流程

### 1.1 一個章節資料夾裡有什麼

`src/chapters/chNN/`（ch00–ch14、ch11b）的結構都一樣：

| 檔案 | 內容 |
|---|---|
| `index.tsx` | default export 的頁面元件；多數章節把內容拆在 `sections/`、互動實驗拆在 `experiments/` |
| `formulas.ts` | `export const FORMULAS: FormulaEntry[]`，章內每條有 ID 的公式（見 §5.1） |
| `handcalcs.ts` | `export const HANDCALCS: HandCalcDef[]`，本章的「帶入手算」題（見 `docs/teaching-style.md` §7） |
| `diagrams.ts` | 本章 Mermaid 方塊圖的原始碼（見 `docs/teaching-style.md` §8） |
| `chapter.css` | 章節專屬樣式；class 名稱加 `chNN-` 前綴 |
| `diagrams.test.tsx` | 每張圖用真正的 Mermaid 畫一次（`@/components/mermaidTestUtils`） |
| `handcalcs.test.tsx` | 每題手算的數值與 `src/simulation` 的函式逐一比對，並對照 `golden/vectors` |
| `chNN.test.tsx` 或 `index.test.tsx` | 整頁的 smoke test（符號表位置、字串屬性的 LaTeX、模式分層…） |

`src/pages/<name>/` 同樣有 `index.tsx`，另外視需要放 `formulas.ts`、`handcalcs.ts`、`diagrams.ts`、`<name>.css`（class 前綴用頁面自己的縮寫，例如 `lab-`、`so-`、`fr-`）。

### 1.2 新增一頁的步驟

1. 建資料夾與 `index.tsx`（default export 一個 React 元件）。
2. 在 `src/app/registry.ts` 的 `PAGES` 加一筆（欄位見同檔的 `PageEntry`）：`id`、`path`、`nav`（側欄文字）、`title`、`group`、`specSections`、`tests`，以及 `component`——章節用 `ch('NN')`，其他頁面用 `lazyWithRetry(() => import('../pages/<name>/index.tsx'))`（部署後舊 hash 404 時會重試一次再 reload，不會留下白畫面）。**導覽、路由、Dashboard、Formula 頁都從這個陣列讀取，不要在別處再寫一份章節清單。**
3. 公式、手算題、preset 不需要登記到中央清單，放到對應位置就會被收集：
   - `src/chapters/*/formulas.ts` 與 `src/pages/*/formulas.ts` 的 `FORMULAS`（`src/pages/formulas/registry.ts` 以 `import.meta.glob` 收集）。
   - `src/chapters/*/handcalcs.ts` 與 `src/pages/*/handcalcs.ts` 的 `HANDCALCS`（`src/app/handcalcs.ts` 收集）。
   - `src/data/presets/<preset-id>.json`（`src/app/presets.ts` 收集）。
   - `src/simulation/models/*.ts` 裡以具名 export 提供、可丟進 Worker 的函式（`src/workers/modelLoader.ts` 收集，`*.test.ts` 排除）。
4. 內容規範（逐項見 `docs/teaching-style.md`）：系統地圖 → 手算 → 方塊圖 → 逐步推導 → 實驗 → 帶入手算 → 思考題 → 本課必記 → 符號表（放在最後）；所有數學用 LaTeX；程式碼用 `CodeBlock` 顯示實際執行的原始碼。
5. 上表的三種測試都要有；畫面改動要跑 §8 的審查腳本並看截圖。

### 1.3 動到共用層時

`src/components/**`、`src/simulation/core/**`、`src/simulation/signal/**`、`src/styles/global.css` 會影響每一頁。改這些地方時：

- 先看 `docs/dev/infra-api.md` 有沒有寫到該 API 的使用注意事項，改了行為就同步更新那份文件。
- 跑完整的 `npm test`（不要只跑自己改的檔案），畫面有變的用 §8 的腳本挑代表性的頁面（例如 `/ch/05`、`/ch/12`、`/lab`）前後對照。
- 新的共用功能優先放到共用層，不要在章節內各自複製一份 private helper。

### 1.4 章首／章末骨架的資料：`src/app/chapterMeta.ts`

每個章節頁（group A／B／C：ch00–ch14、ch11b 與 case-sspll）在 `CHAPTER_FRAME_META` 裡一筆，`PageFrame` 用它畫章首的本章資訊 strip、先備自檢與章末交棒（版面規則見 `docs/teaching-style.md` §9，元件見 `docs/dev/infra-api.md`）。`src/app/chapterMeta.test.ts` 會檢查每一欄：

| 欄位 | 內容 | 測試檢查 |
|---|---|---|
| `reading` | 三種模式各一組實測的內容量 `{ han, formulas, figures, experiments }`：畫面上看得到的中文字數（`innerText` 的漢字）、獨立公式（`.katex-display`）、圖（`figure.c-mermaid`、`figure.c-plot`）、互動實驗（`.c-exp`）；收合的 `<details>` 與 `ModeGate` 之外的內容不算 | 中文字數 > 1000、Research ≥ Beginner |
| `readingMinutes` | 由 `reading` 依 `READING_RATE` 算出：中文 350 字／分 + 每條獨立公式 0.2 分 + 每張圖 0.5 分 + 每個實驗 3 分，四捨五入到 5 分鐘（`estimateReadingMinutes`） | 等於公式算出的值、5 的倍數、三種模式遞增 |
| `errata` | 本章負責的勘誤 id（依 Exx 排序） | 等於 `src/data/errata.json` 裡 `chapters` 含本章的條目（`"all"` 不算） |
| `prereqs` | 2–4 條 `{ label, ch?, sec?, anchor? }`：一句自檢（可含 `$…$`）、該去複習的章（`'03'`、`'11b'`、`'07b'`）、小節標示、該章裡的錨點 id | ch 是存在的章節頁且不是自己；anchor 必須在該章原始碼裡以 `id="…"` 或 `'…'` 出現；只有 ch00 可以沒有 ch |
| `next` | `{ page, hook }`：下一頁的 registry id 與一句「下一章要解決什麼」 | 從 ch00 沿著 next 走出 ch00 → … → ch07 → case-sspll → ch08 → … → ch11 → ch11b → ch12 → … → ch14，ch14 指向 `signoff` |

重量閱讀時間：`node scripts/reading-time.mjs --routes /ch/04,/ch/11b`（需要開發伺服器；旗標見 §8）。它用 puppeteer 把每一章在三種模式各開一次（`localStorage.setItem('lmspll.mode', …)`），整頁慢慢捲一遍讓延後載入的區塊長出來，再在 `article.page` 裡數上面四個量（只數有版面的元素，`getClientRects().length > 0`），印出可以直接貼回 `reading` 的物件；`readingMinutes` 不用手填。係數（`READING_RATE`）改了只要改 `chapterMeta.ts`，不必重量：`reading` 存的是原始內容量。

### 1.5 章節太重時：拆成兩個 Part（Ch04 的做法）

審查（pedagogy）發現 Beginner 路徑上第一個 PLL 章如果把訊號流的數學和 RTL 細節混在同一頁，會變成全站最重的一章。這種章節可以拆成兩個 Part，內容與 id 都不動，只改順序與預設的展開狀態：

- **Part 1 = 訊號流／數學（所有模式必讀）**：章首 → Part 1 橫幅 → 各節 → 這一個 Part 自己的思考題。只需要微積分與機率；位元數、右移、暫存器留到 Part 2。
- **Part 2 = 硬體實作（定點、RTL）**：整段放在一個 `<details>`。Beginner 預設收合，只留標題、一句摘要與「切到 Engineer 會自動展開」的提示；Engineer／Research 預設展開。`<details>` 的 key 綁定學習模式（切換模式時重設預設狀態；使用者手動展開／收合優先）。
- 內容**永遠留在 DOM 裡**：公式錨點、`?a=`／`?f=` 深連結、站內搜尋與頁內目錄才找得到；共用的 `revealAnchor`／`scrollToElement` 會展開祖先 `<details>`，所以章內的 `jumpTo` 也要用 `scrollToElement`，不要自己呼叫 `scrollIntoView`。
- 摺疊框**不要加左右 padding 或邊框**，否則 Part 2 的方塊圖會比 Part 1 窄一截。
- 「本課必記」（Recap）與符號表放在摺疊框外面，所有模式都看得到；綜合手算放在 Part 2 思考題之前；每個 Part 自己有思考題。
- 範例：`src/chapters/ch04/index.tsx`；`PartHead`／`PartFold` 目前是 `src/chapters/ch04/common.tsx` 的章內元件（第二個章節要用時再搬到 `src/components/` 並寫進 `docs/dev/infra-api.md`）。

## 2. 共用 UI 元件（`src/components/`，由 `@/components` 匯出）

| 元件 | 用途 | 主要 props |
|---|---|---|
| `Tex` | 行內 KaTeX | `children: string`（TeX 原始碼） |
| `TexBlock` | 獨立公式（display mode），可帶 `id`（formula ID，例如 `F-03.1`） | `children: string; id?: string; label?: ReactNode` |
| `Mermaid` | Mermaid 方塊圖，跟隨深淺主題；節點與圖說裡的 `$...$` 由 KaTeX 排版 | `chart: string; caption?: string; ariaLabel?: string` |
| `Plot` | Plotly 圖表封裝：hover、zoom、reset、下載 PNG/SVG/CSV；跟隨主題；lazy-load plotly（載入的是 `plotly.js-cartesian-dist-min`，只含 2D trace：scatter／bar／histogram／heatmap，1.39 MB raw／0.47 MB gzip，完整版是 4.67／1.42 MB；`src/components/plotlyBundle.test.ts` 釘住這個 bundle 必須包含什麼） | `data: Plotly.Data[]; layout?: Partial<Plotly.Layout>; height?: number; csvName?: string; title?: string; xLog?/yLog?` |
| `ParamControl` | 滑桿 + 數字輸入（可精確輸入 0.00001）+ 單位 + 合法範圍 + 對應 Hardware Reg / Behavioral Parameter；可 log 刻度 | `label; value; onChange; min; max; step; unit?; log?; hint?; reg?; digits?` |
| `SelectControl` / `ToggleControl` | 下拉、開關 | `label; value; onChange; options` |
| `ClaimTag` | 規格 §0.1 三層結論標籤 | `kind: 'exact' \| 'approx' \| 'research'`，顯示「精確｜指定模型」「近似｜需驗證」「研究假說／延伸」 |
| `ModelLevel` | L0–L6 模型層級徽章 | `level: 'L0'…'L6'` |
| `SourceTag` | illustrative / simulation / literature / measured | `kind` |
| `Callout` | 提示框 | `kind?: 'info' \| 'warn' \| 'danger' \| 'ok'; title?` |
| `Derivation` | 可展開的推導面板，含 Derivation / Symbols / Units / Assumptions / Model Level 分頁 | `title; derivation: ReactNode; symbols?; units?; assumptions?; level?; defaultOpen?` |
| `Section` | 章節段落，提供規格 §18.4 的「直覺 → 圖 → 公式 → 範例 → 探索 → 注意假設」標記 | `kind: 'intuition' \| 'diagram' \| 'formula' \| 'example' \| 'explore' \| 'assumptions'; title?` |
| `MetricTable` | 指標表：名稱、數值、單位、公式 ID、標籤、與解析值的差距 | `rows: MetricRow[]` |
| `ExperimentShell` | 互動實驗外框（見 §3） | 見下 |
| `TestBadge` | 顯示某 T-id 的驗證狀態（來自 `src/data/verification-status.json`） | `id: 'T01'…` |
| `SearchButton`／`loadSearchPalette` | 全站搜尋（`src/components/search/`）：頂列的 🔍 鈕與延後載入的命令面板；快捷鍵 `/` 與 ⌘K／Ctrl+K；索引沒有建置步驟，第一次開面板時才由 `buildIndex.ts` 從公式登錄、presets、勘誤、術語、手算題與 `PAGES` 彙整，目前這一頁的 h2 由 `searchCore.collectPageSections` 從 DOM 讀。純函式在 `searchCore`（`search`、`scoreEntry`、`makeEntry`） | `<SearchButton open onClick />`；`lazy(loadSearchPalette)`（Layout 已接好，章節不用做任何事） |
| `ModeGate` | 依學習模式顯示（實作在 `@/app/settings`，`@/components` 轉出） | `min: 'beginner' \| 'engineer' \| 'research'`：目前模式低於 `min` 就不渲染 |

教學用元件（`CodeBlock`、`CodeCompare`、`SymbolTable`、`Quiz`、`Recap`、`Prereq`、`StepDerivation`、`HandCalc`、`SystemMap`、`DiagramFrame`）與字串屬性裡的 `$...$` 行內公式（`mathText`）的用法在 `docs/dev/infra-api.md` 的「後續新增的共用元件」一節。

學習模式：`useSettings().mode` / `atLeast('engineer')`。三種模式**共用同一計算核心**，只改變呈現：低於 `ModeGate min` 的內容不渲染；共用的 `Derivation` 預設只在 Research 模式展開（可用 `defaultOpen` 覆寫，使用者手動切換優先）。

### 2.1 視覺：徽章語意、表格層、設計 token（design-system，2026-10-19）

- **設計 token 只有兩個檔**：顏色在 `src/styles/global.css` 的 `:root`（對比度測試直接解析它），字級階 `--fs-2xs…--fs-2xl`、間距階 `--space-1…--space-8`、左色條 `--bar-w`／`--bar-w-lg`、`--radius-pill`／`--radius-xs`／`--shadow-sm`、表格 `--table-*`、徽章 `--badge-*`／`--verified` 在 `src/styles/tokens.css`（global.css 第一行 `@import`）。`global.css` 與 `components.css` 裡的字級與 gap／padding 一律引用 token（`styles.test.ts` 會抓殘留的字面值）；不在階上的值（0.9rem、0.8rem…）暫時保留。新頁面的 CSS 請直接用 token，不要再長出新的字面值。
- **徽章只有一個基底**：`c-badge` + `c-badge--<variant>`（`Badge`／`TipBadge`／`BadgeRow`，`src/components/Tags.tsx`）。variant 只改三個顏色變數（`--b-fg`／`--b-bg`／`--b-bd`）與框線樣式；尺寸全站同一組。**一種顏色只代表一件事**：

  | 語意 | variant | 外觀 |
  |---|---|---|
  | 結論強度（`ClaimTag`） | `exact`／`approx`／`research` | 綠實心／琥珀實心／紫實心（字用 `--badge-on-solid`） |
  | 模型層級（`ModelLevel`） | `level` | 藍描邊、等寬字；L0–L6 同一種顏色 |
  | T-id 測試狀態（`TestBadge`） | `verified`／`partial`／`fail`／`pending` | 青綠帶 ✓（`--verified`，和「精確」的綠分開）／琥珀描邊／紅／灰虛線 |
  | 規格勘誤（各頁的 `ErratumTag`） | `erratum` | 琥珀描邊，**不是實心**（和「近似」分開） |
  | 範例來源（`SourceTag`） | `source`（illustrative 加 `is-dashed`） | 灰描邊；illustrative 虛線 |
  | 交叉比對與判決（`c-check`、各頁的狀態 pill） | `ok`／`mismatch`／`na`／`not-implemented` | 綠／紅／灰軟底／琥珀虛線 |
  | 沒有語意（計數、ID） | `neutral` | 灰 |

  舊的類別名（`c-claim-exact`、`c-level-L3`、`c-source-measured`、`c-test-pass`…）仍在 DOM 上當測試與資料的 hook，但**不再有樣式**。各頁自己的 pill（`ch07-erratum-tag`、`lab-pill-*`、`fr-badge`、`ver-chip-*`、`dash-chip`…）應改成 `badgeClass('<variant>', '<自己的 hook>')`，自己的 CSS 只留版面（margin、連結的 hover），不再定義顏色與尺寸。
- **徽章數量**：同一行連續 ≥ 4 個徽章用 `BadgeRow`（顯示前 3 個 + 「+N」按鈕，點開展開、再點收起；摺起來的項目不在 DOM 裡）。外層沿用 `.c-tag-row`，既有版面規則不變。章節標題下那排 `ClaimTag`／`ModelLevel`／`SourceTag`／`TestBadge` 應改用它。
- **表格**：`global.css` 的 `table`／`th, td` 只引用 `--table-fs`／`--table-pad-y`／`--table-pad-x`／`--table-border`／`--table-head-bg`；三個層級（default／sm／xs）的值在 `tokens.css`，手機（≤ 480px）由 `tokens.css` 的 `@media` 把三個層級各縮一級——**章節不要再寫自己的手機表格規則**。`.c-table`（以及 `.c-metric-table`、`.c-symbols table`、`.c-derivation-table`、sign-off 的表，由 `components.css` 的選擇器清單自動套上）：橫線＋斑馬紋（`--table-stripe`）、不畫直向格線、數字欄 `.num` 靠右、公式欄 `.formula` 不換行且只占內容寬、`.c-table--sticky` 讓表頭黏在頂列下（外框不是捲動容器時才有效）。斑馬紋與格線用 `:where()` 寫成零特異度，頁面自己的卡片排版壓得過。各頁表格 class 的字級／內距由 `components.css`「Table」一節的 `.page :is(…)` 清單對映到層級（挑層級的原則：**寬度不增加**，否則會冒出只能捲幾 px 的橫向捲軸）；章節 CSS 裡對應的 `font-size`／`padding` 規則可以刪掉。
- **數字 −0**：`fmtNum`（`src/components/format.ts`）與 `texNum`（`handcalcMath.ts`）對 −0 已回 `0`；用 `toFixed` 自己格式化的地方（`case-sspll/common.tsx` 的 `fx`／`tx` 已處理）要把 `/^-0\.?0*$/` 正規化成 `0`，不要顯示 −0.000。

## 3. 互動實驗規範（規格 §19）

`ExperimentShell` props（概要；完整型別見 `src/components/ExperimentShell.tsx` 的 `ExperimentShellProps` 與 `src/components/types.ts`）：

```ts
interface ExperimentShellProps {
  id: string                       // 例如 'lms-playground'（匯出檔名與報告使用）
  title: string
  level: ModelLevelId              // 'L0'…'L6'
  claim?: ClaimKind                // 主要結論標籤
  source?: SourceKind              // 預設 'illustrative'
  tests?: string[]                 // 對應 T-id
  description?: ReactNode          // 標題下方的簡短說明
  assumptions: string[]            // 顯示並寫入報告
  controls: ReactNode              // 參數面板
  children: ReactNode              // 圖表與結果
  params: Record<string, unknown>  // 目前參數（匯出 JSON / 報告用）
  seed?: number; onSeedChange?(s: number): void
  units?: Record<string, string>
  metrics?: MetricRow[]
  warnings?: string[]              // 例如 C<=0 的 polarity 警告，必須顯示並解釋原因
  crossCheck?: { analytic; monteCarlo; fixedPoint }   // 各項為 'ok' | 'mismatch' | 'not-implemented' | 'n/a'，或 { status, note }
  actions?: { onReset?(); onStep?(); onRun?(); onRunToConvergence?(); onStop?(); onFreeze?(); running?: boolean; frozen?: boolean;
              runKind?: 'compute' | 'animate'; progress?: { done: number; total: number; unit?: string }; onSkipToEnd?() }
  exportData?: () => CsvColumns    // CSV 欄位（長度可不同，短欄以空白補齊）
  presets?: ExperimentPreset[]; onLoadPreset?(p): void
  headingLevel?: 2 | 3 | 4
}
```

必做：
1. 每個滑桿都能數字精確輸入，顯示單位與合法範圍。
2. 隨機一律用 `createRng(seed)`，同 seed 可重現；顯示「模擬條件摘要」。
3. 無解或失穩時**解釋原因**（例如 `C ≤ 0` → polarity 問題；`λ_min = 0` → 不可辨識），不要只寫「無法計算」。
4. Analytic / Monte Carlo / Fixed-Point 交叉比對：只有真的算過才標 `ok`；未實作者明確顯示 `Not implemented`。
5. 可下載 JSON（參數 + 指標 + seed + 版本 + 假設）、CSV（資料）、HTML 報告。
6. 不要每次拖動滑桿就重跑數百萬點：用 `useDeferredValue`、debounce 或 Worker。
7. 「執行 Run」要說清楚是哪一種（`actions.runKind`）：
   - `'compute'`（預設）：背景計算（Worker／同步算完），按下去等結果。有 Worker 進度就給 `actions.progress = { done, total, unit? }`（例如已完成 3/9 seeds）；只在 `running` 時顯示步數與進度條，手機上等結果到了才捲到結果區。
   - `'animate'`：固定速度逐步播放（Ch01 LMS Playground 350 ms／步、Ch04 Signal Flow 300 ms／步，後者約 2 分鐘）。要同時給 `progress`（Run 鈕顯示「（112/408 步）」與進度條，停在半路也看得到）與 `onSkipToEnd`（多一顆「跳到結尾」，到了終點就停用）；手機上按執行就捲到結果區，因為結果從第一步就在變。
   - 「跳到結尾」必須和逐步執行共用同一個計算核心（把游標／狀態直接放到終點，不要另寫一份「快速版」），否則跳到結尾看到的結果和一步一步看到的會不一樣。
8. 參數控制項超過 12 個（`CONTROL_COLLAPSE_THRESHOLD`）就要分組：用 `ControlGroup`（`@/components`，`title`、`defaultOpen?`）把相關的控制項包起來；超過門檻時整欄自動變成每組一個 `<details>`（第一組展開、其餘收合），12 個以內只是帶小標題的區塊。沒有明確分組時，ExperimentShell 會在前 8 個控制項之後自動切一刀，把其餘收進「其餘參數」。控制欄不准出現內部捲軸——太長就分組，不要加 `overflow: auto`。

9. **分享網址**（wave 4）：實驗外框要呼叫 `useExperimentUrlSync`（`src/components/experimentUrl.ts`），讓 preset／seed 寫進 `?a=exp-<id>&p=<presetId>&seed=<n>`（`replaceState`），工具列放 `CopyLinkButton`；preset 要有穩定的 `id`（`ExperimentPreset.id`，沒有就用名稱的 slug）。細節與 ExperimentShell 的接法見 `docs/dev/infra-api.md`「分享與回連」。實驗自己不必處理網址；只有像 ch01 那樣另外讀 `?preset=` 的做法要保持相容（hook 兩者都讀，寫入時把 `preset=` 換掉）。

10. **Beginner 的精簡參數面板**（wave 4，beginner-backbone）：`src/app/beginnerControls.ts` 的 `BEGINNER_CONTROLS[experimentId]` 列出 Beginner 模式先露出的 3–5 個控制項 key（控制項的 `ariaLabel`、`reg`、`id` 或 label 的可念文字都可以；比對前經 `normalizeControlKey`：NFKC、小寫、去空白與底線，所以 `σᵥ（…）` 與 `σ_v(…)` 相同）。`ExperimentShell` 在 Beginner 模式沿著 `controls` 的 React 元素樹（`partitionBeginnerControls`）把 `ParamControl`／`SelectControl`／`ToggleControl` 分成「留在面板」與「更多參數（N 個）」（`details.c-exp-more`，預設收合，`.c-exp-controls[data-trimmed="true"]`）；Fragment、原生元素與 `ControlGroup` 會被拆成兩份，章節自訂的包裝元件看不進去、一律保留在面板上。表裡沒有的實驗、或清單一個都對不上（標籤改了），就全部顯示。精簡狀態下不再分組收合、也不自動切「其餘參數」；工具列（執行、跳到結尾…）不受影響。新增實驗（尤其 Beginner 骨幹路線上的）請補清單：挑 preset 會改到、而且是這個實驗要教的那幾個；標籤隨 Case 變動的控制項（「— Case A」）用 `reg`。`src/app/beginnerControls.test.ts` 檢查 experimentId 存在於原始碼、每張清單 3–5 個、key 不重複；`src/components/ExperimentShell.test.tsx` 以 Ch01 LMS Playground 為例。骨幹路線本身（`src/app/backbone.ts`）見 `docs/dev/infra-api.md`「Beginner 骨幹路線與精簡參數面板」。

## 4. 模擬核心 API 概要（`src/simulation/core`、`src/simulation/signal`）

這裡只列最常用的簽名；完整、以程式碼為準的清單與使用注意事項在 `docs/dev/infra-api.md`。

```ts
// core/rng.ts —— xoshiro128** + splitmix32 seeding；Box–Muller Gaussian
createRng(seed: number): Rng
interface Rng { uniform(): number; normal(): number; normalArray(n: number, sigma?: number): Float64Array;
  sign(): 1 | -1; int(lo: number, hiInclusive: number): number; bernoulli(p: number): boolean; fork(label: string | number): Rng; readonly seed: number }

// core/special.ts —— 雙精度等級（相對誤差 < 1e-13）
erf, erfc, normPdf, normCdf /*Φ*/, normInv /*Φ^-1*/, lgamma, betaIncReg(a,b,x), binomPmf(k,n,p), binomCdf(k,n,p)

// core/complex.ts
type Complex = { re: number; im: number }; c(re, im?), cAdd, cSub, cMul, cDiv, cAbs, cArg, cConj, cScale, cExpj(theta), cPolar(r, theta)

// core/poly.ts —— 係數為降冪
polyval(p: number[], x: number): number; polyvalC(p: number[], z: Complex): Complex; polyRoots(p: number[]): Complex[]

// core/linalg.ts —— Matrix = number[][]
identity, zeros, transpose, matMul, matVec, matAdd, matSub, matScale, inv, solve, det, trace,
eigSym(A): { values: number[] /* 由大到小 */; vectors: Matrix /* 第 i 欄對應 values[i] */ },
eigvals(A): Complex[] /* 一般實矩陣：Hessenberg + shifted QR */,
svd(A): { U: Matrix; S: number[]; V: Matrix }, cond(A), spectralRadius(A), pinvReg(A, lambda)

// core/stats.ts
mean, variance(x, ddof=1), std, rms, quantile, histogram(x, bins, range?), meanCI(x, level=0.95), wilsonCI(k, n, level), autocorr(x, maxLag)

// core/units.ts
fmt(x, digits=4), fmtSI(x, unit), db10, db20, wrap180(deg), deg2rad, rad2deg, clamp

// signal/fft.ts
fft(re, im) /*原地，任意長度：2 的冪用 radix-2，否則 Bluestein*/, ifft, nextPow2
// signal/window.ts
hann(n), rectangular(n), blackmanHarris(n), windowStats(w): { coherentGain, enbwBins }
// signal/psd.ts —— 一律回傳 { f: Float64Array, psd: Float64Array, onesided, units, enbwHz, ... }
periodogram(x, fs, opts), welch(x, fs, { nperseg, noverlap, window, onesided=true, detrend='constant' }),
toneFit(x, fs, f0): { amplitudePeak, phase, rmsResidual }  /*已知頻率的 coherent 最小平方擬合*/,
integratePsd(f, psd, fL, fH), findTones(f, psd, opts)
// signal/filter.ts
lfilter(b, a, x, zi?): { y, zf }, class StreamFilter { constructor(b, a); step(x: number): number; reset() },
freqz(b, a, omegas: ArrayLike<number>): Complex[], freqs(b, a, w): Complex[], bilinear(b, a, fs, prewarpHz?),
impulseResponse(b, a, n)
// signal/corr.ts
xcorrAtLag(x, y, lag), xcorr(x, y, maxLag)
```

## 5. 單位與極性約定（規格 §0 + `docs/validation.md`）

- 時間誤差預設 **fs**；相位用 **rad**；兩者不可混用，換算處要寫明 `2π f_out`。
- `q = sign(e) ∈ {+1, −1}`；硬體 0/1 先映射 `q = 2b − 1`。
- `δ` 的極性：每段公式旁註明 `δ = a − w` 或 `δ = w − a`（規格前後不一致，見 validation.md）。
- 時間索引：`n` = comparator sample，`k` = GMAC block，`m` = PVT tracking。
- PSD：預設 one-sided，`ℒ(f) = 10 log10(S_φ^(1)(f)/2)`；PSD 圖要標示 window、segment、ENBW、one/two-sided。
- 所有例子預設 `SourceTag kind="illustrative"`。

## 5.1 公式登錄與 Presets（彙整頁自動收集，不需中央清單）

- 每章 `src/chapters/chNN/formulas.ts`、每個工具頁 `src/pages/<name>/formulas.ts`：`export const FORMULAS: FormulaEntry[]`（型別在 `@/data/types`）。ID 格式 `F-<章>.<序>`，例如 `F-03.2`；非章節頁用字母前綴（例如 `F-SO.3`、`F-R1.1`）。章內 `TexBlock id` 使用同一 ID。Formula & Unit Reference 頁（`src/pages/formulas/registry.ts`）以 `import.meta.glob` 收集 `chapters/*/formulas.ts` 與 `pages/*/formulas.ts`；ID 不可重複（測試會檢查）。
- 每個 preset 一個檔：`src/data/presets/<preset-id>.json`（`PresetEntry`）。規格 §19.2 的 12 個 Gallery presets 填 `galleryIndex` 1–12。
- 實驗元件以 `useUrlPreset(experimentId)`（`@/app/presets`）讀取 `?preset=<id>` 並套用參數；`presetsForExperiment(id)` 可餵給 `ExperimentShell` 的 presets 下拉。

- **「在哪個模型內精確」（2026-10-19，depth 審查）**：`FormulaEntry` 多一個可選欄位 `assumes?: string`——一句話說這條公式的 `claim` 是在哪個模型內成立（線性小訊號、frozen weight、單頻、mean-field、L5 的均勻餘數…；`approx` 時寫近似從哪個模型外推；支援 `$…$`）。`/formulas` 的登錄表在每條公式的使用條件下面多一行「在哪個模型內精確」：公式有自己的 `assumes` 就用它，沒有就顯示該章 `src/app/chapterMeta.ts` 的 `models`（章的預設，標「（本章預設）」）；工具頁沒有章節骨架時不顯示。每章的 `models: ChapterModel[]`（1–4 個，從 `CHAPTER_MODEL_CATALOG` 的 L0–L5 與三個常見假設 `frozen-weight`／`single-tone`／`mean-field` 用 `chapterModel(id)` 取，可覆寫 `assumes`）由 `ChapterInfoStrip` 顯示成「本章的『精確』是在：…」一行（tooltip 列每個模型的假設）；`chapterMeta.test.ts` 檢查每章至少一個 L 層級、id 都在清單裡。Ch04、案例頁、Sign-off 的 `formulas.ts` 已逐條填 `assumes`，其餘章節先用章的預設（新寫的公式請直接填）。**整合（wave 4）**：其餘章與工具頁的 `formulas.ts` 也逐條填了 `assumes: modelAssumes('L1')`（`src/app/chapterMeta.ts`；用公式自己的 `level` 取 `CHAPTER_MODEL_CATALOG` 的「標籤：假設」，章裡有 `frozen-weight`／`single-tone`／`mean-field` 且公式的標題或條件提到時再接上）——文字只有目錄一份，改假設時一起變；這條公式的條件比模型更特別時直接寫一句自己的話。`chapterMeta.test.ts` 檢查登錄表的每一條都有 `assumes`、`$` 成對。

## 6. 測試

- Vitest：`src/**/*.test.ts(x)`。`.test.ts` 在 node 環境執行，`.test.tsx` 在 jsdom（`vite.config.ts` 的 `test.workspace` 定義 `node`、`jsdom` 兩個 project，見下方 §6.1）。純數值的 `.test.ts` 若需要 DOM，在檔案第一行寫 `// @vitest-environment jsdom`。整頁 smoke test 很重，`vite.config.ts` 把 `testTimeout` 放寬到 60 s。同時有多個程序在跑時，只跑需要的檔案並限制 worker：`npx vitest run src/chapters/ch05 --maxWorkers=3`。
- 數值測試用 `toBeCloseTo` 或相對誤差斷言；Monte Carlo 用固定 seed + 信賴區間。
- 每個 T-id 至少一個以 `T01:` 開頭命名的測試（`it('T01: ...')`，T-id 要在 `it` 的標題開頭，放在 `describe` 不算），Python 端是 `test_T01_…`；`scripts/verify.mjs` 依此彙整 `src/data/verification-status.json`。
- Golden 交叉比對：TypeScript 端各章的測試（例如 `src/chapters/ch00/model.test.ts`）以 `readFileSync` 讀 `golden/vectors/Txx.json`；Verification 頁用 `src/pages/verification/golden.ts` 靜態匯入同一批檔案。向量格式與判定規則（`|actual − expected| ≤ abs + rel·|expected|`）見 `golden/README.md`。
- 反面測試（規格 §17 末段）：極性反轉、缺乏 PE、Code misalignment、N 改變卻忘記 scaling、定點 overflow、錯誤位元符號、路徑混淆、aliasing。
- **內容規範測試**：有幾個測試會讀原始碼與文件的字串，改文字時要一起改。`src/data/architectureConvention.test.tsx` 檢查全站架構約定（README、`docs/*.md`、`src/simulation` 檔頭、preset 與勘誤裡的敘述）；`src/data/docsFacts.test.ts` 核對 README 的數量（公式、preset、手算題、勘誤、T-id 狀態）、文件中寫到的檔案路徑是否存在，以及 §8 的腳本旗標是否都有寫在文件裡。
- **版面無法在 jsdom 測**：捲軸、圖寬、字會不會被切掉要用 §8 的腳本在真正的瀏覽器裡量。

### 6.1 測試怎麼寫（用 `src/test/` 的工具；2026-10-19）

**兩個 project**（`vite.config.ts` 的 `test.workspace`；Vitest 3.2 起這個鍵改名 `projects`，升級時只改鍵名）：

| project | 檔案 | 環境 | 單獨執行 |
|---|---|---|---|
| `node` | `src/**/*.test.ts` | node | `npx vitest run --project node` |
| `jsdom` | `src/**/*.test.tsx` | jsdom | `npx vitest run --project jsdom [--shard=i/N]` |

不加 `--project` 兩個都跑（`npm test`、`npm run verify` 照舊，`scripts/verify.mjs` 讀到的 JSON 報告含全部檔案）。純函式、資料、文件字串的測試寫 `.test.ts`；要 render React 的寫 `.test.tsx`。`.test.ts` 第一行的 `// @vitest-environment jsdom` 仍然有效（檔案留在 `node` project，CI 的 unit job 跑得到）。每個 project 有自己的 setup 檔：`src/test/setup.node.ts`、`src/test/setup.jsdom.ts`。

**jsdom 測試的樣板**（API 見 `docs/dev/infra-api.md`「測試工具 `src/test/`」）：

```tsx
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import Chapter05 from './index'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

it('整章可渲染', () => {
  const { container } = renderPage(<Chapter05 />, { url: '/ch/05', mode: 'engineer' })
  expectNoTexErrors(container)
})
```

- **不要自己再寫** Plotly／Mermaid 的 `vi.hoisted` 假物件、`SettingsProvider` + `MemoryRouter` 的 `render` 包裝、`querySelector('.katex-error')` 的斷言。Plotly 的 `mock.calls` 會抓住 DOM 節點，`setup.jsdom.ts` 已在每個測試前後清掉；jsdom selector 引擎的快取也是（`src/test/releaseDom.ts`）。
- **學習模式**：預設是 Beginner（很多區塊被藏起來）。要數圖、數段落、找 Engineer／Research 才有的內容，`renderPage` 一律給 `mode: 'engineer'`（或 `'research'`）；沒給 `mode` 就不動 `localStorage`。
- **KaTeX**：`expectNoTexErrors(root)` 抓 `.katex-error`／`.c-tex-error`；「未定義的控制序列」（例如把 `\mu` 和 `e` 黏成 `\mue`）只是紅字，要用 `expectNoStrictTexErrors(root)`（每個公式用 `throwOnError: true` 重新解析）；單一字串用 `expectTexParses(tex, label, { displayMode, strict })`。
- **不要在整章上用 `getByRole`**（jsdom 要為上千個 KaTeX 節點算 accessibility tree，數秒且吃數百 MB），用 `container.querySelector` 加明確的 selector。
- **逾時**：`testTimeout` 預設 60 s。需要更久的（整章 + inline worker 的 Monte Carlo）在該 `it` 的第三個參數放寬，或檔案開頭 `vi.setConfig({ testTimeout })`；只放寬等待時間，不放寬任何數值判準。
- **哪些 mock 不共用**：要記錄 `applyPlotMath` 的 data／layout、替換 `<Mermaid>` 元件、或「真的畫出 mermaid SVG」（`renderMermaidForTest`）的測試，保留自己的 `vi.mock`（理由與清單在 infra-api 該節最後一條）。

**巨型測試要拆**：單一 `it` 超過 60 秒（`npx vitest run <檔案> --reporter=verbose` 看每個 `it` 的耗時；整批用 `--reporter=json --outputFile=<檔>` 再依 `assertionResults[].duration` 排序）或超過 300 行，就拆成 `describe` + `mountPageOnce`：`beforeAll` 渲染一次、`afterAll` 卸載，每個 `it` 只檢查一件事、標題寫出意圖。順序：只讀的斷言在前 → 等 worker 算完的 `waitFor` → 會改動 DOM 的操作與整章的收尾檢查（`it` 依宣告順序執行）。範例：`src/chapters/ch06/ch06.test.tsx` 的「Research 模式整章（共用一次渲染）」。拆的時候留意：（1）RTL 的自動 cleanup 追蹤不到 `mountPageOnce` 的樹，一定要在 `afterAll` 呼叫它回傳的 `unmount()`；（2）`plotlyMock`／`mermaidMock` 的呼叫紀錄在每個 `it` 之後被清空，要比對就在 `beforeAll` 先複製出來；（3）`T07:` 這類 T-id 前綴只放在一個 `it`（`scripts/verify.mjs` 以前綴彙整，名稱與數量變動要重跑 `npm run verify` 更新 `src/data/verification-status.json`）。

## 7. 語言與文字

- 介面與說明以繁體中文為主，保留精確英文術語（GMAC、Sign-Error LMS、Persistent Excitation…）。
- 不得寫「LMS 一定穩定」；必須說明是平均收斂、均方穩定、機率性有界、局部線性穩定或全域非線性。
- 不得把未完成功能標成已驗證；未實作 = 明確顯示 `Not implemented` / `pending`。
- 無障礙名稱（aria-label、title、aria-valuetext、`<option>`）一律用 `accessibleText`（`@/components`，會把 `$…$` 轉成可念的文字），不用 `stripMathDelimiters`（它保留 TeX 原始碼，只用在 id、檔名、程式碼與報告）；`CodeCompare` 的分頁標籤可以含 `$…$`。
- ARIA 模式（細節與 API 見 `docs/dev/infra-api.md`「ARIA 模式、表格標題、觸控目標、404 與頁面標題」）：分頁一律 `role=tablist/tab/tabpanel` 並用 `useRovingTabs`（roving tabindex、←→／Home／End）；每張 `<table>` 要有 `<caption>`（可 `c-sr-only`）與 `<th scope>`；純顯示的徽章不可聚焦（沒有 `tabIndex`）、tooltip 以 `aria-describedby` 連結並可用 Esc 關閉；≤ 600 px 的互動元素至少 24×24 px、輸入框字級 16 px；頁面藏在 `ModeGate` 後的內容要給 `summary`。
- 圖的文字替代：每張方塊圖（`Mermaid`、`SystemMap`）下方有收合的「文字版」（節點、連線、群組），每張 `Plot` 下方有「看數據」（每條曲線的點數、x 範圍、y 的最小／最大／首值／末值）；`<figure aria-describedby>` 指到它，內容惰性渲染。新的圖元件要走 `DiagramFrame` 的 `chart`／`textModel`，不要自己再包一層；Plot 的 modebar 鍵盤聚焦不到，等價的按鈕在 `.c-plot-kbar`。細節與限制見 `docs/dev/infra-api.md`「圖的文字替代」。

## 8. 審查腳本（改了畫面就要跑）

jsdom 量不到版面，所以畫面相關的檢查（捲軸、方塊圖寬度、字有沒有被切掉、淺深色主題、手機版）用 `scripts/` 的四支腳本（加上量閱讀時間的 `reading-time.mjs`）在真正的 Chrome 裡做。它們用 `puppeteer-core`（devDependency）開本機安裝的 Google Chrome（預設 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，其他位置用 `--chrome <路徑>`；`dom-eval.mjs` 沒有這個旗標），每個路由開一個新分頁，需要先有開發伺服器：

```bash
npm run dev          # 另一個終端機；預設 http://localhost:5173（腳本的 --base 預設就是這個）
```

四支腳本都用 `--旗標 值` 的寫法，路由是 HashRouter 的路徑（`/ch/05`、`/lab`、`/case/sspll`；根頁是 `/`），多個路由用逗號分隔；開發伺服器在別人改檔時會整頁重新載入，前三支腳本量到一半遇到這種情形會自動重試。

| 腳本 | 用途 | 旗標（括號內是預設值） |
|---|---|---|
| `screenshots.mjs` | 截圖，PNG 用來**親眼看**：文字有沒有被切掉或重疊、連線有沒有不必要的交叉、淺深色主題、手機版 | `--base`（`http://localhost:5173`）、`--out`（`outputs/shots`）、`--routes`（`/`）、`--theme light,dark`（`light`）、`--viewport desktop,mobile,wide,xwide`（`desktop`；`xwide` = 1720×950，頁內目錄才會變成右側欄）、`--mode beginner\|engineer\|research`（`engineer`）、`--shots`（`top`）、`--only 3,7`（序號從 1 起算，與 diagram-audit 相同）、`--chrome` |
| `diagram-audit.mjs` | 量每張方塊圖的自然寬×高、縮放倍率、超出版面的寬度；標出畫不出來（ERROR）與 `Unsupported markdown` | `--base`、`--routes`、`--viewport desktop\|mobile`（`desktop`）、`--mode`（`research`）、`--json <檔>`、`--chrome` |
| `scroll-audit.mjs` | 找出所有真的會出現捲軸的區塊並分類（見下） | `--base`、`--routes`、`--viewport desktop\|mobile`（`desktop`）、`--mode`（`research`）、`--formulas`（另外列出比欄位寬的獨立公式）、`--json <檔>`、`--chrome` |
| `reading-time.mjs` | 量每章在三種學習模式下看得到的內容量（中文字數、獨立公式、圖、實驗），算閱讀時間並印出可貼回 `chapterMeta.ts` 的 `reading` 物件（§1.4） | `--base`（`http://localhost:5173`）、`--routes`（全部 17 個章節頁）、`--modes beginner,engineer,research`（三種）、`--out`（`outputs/reading-time.json`）、`--chrome` |
| `dom-eval.mjs` | 開一頁、等方塊圖畫完，在頁面裡執行一段 JS 並印出回傳值（量元素數量、文字、尺寸） | `node scripts/dom-eval.mjs <網址> '<JS 函式主體>' [mobile]`；網址要含 hash（`http://localhost:5173/#/ch/05`），**要 `return` 結果**（內容會包在 `async` 函式裡），不設定學習模式 |

`screenshots.mjs` 的 `--shots` 可以列多個（逗號分隔）：`top`（頁面頂端一個視窗）、`all-mermaid`（該頁全部方塊圖）、`<種類>:<n>`（該種元素的前 n 個）。種類有 `mermaid`、`exp`（互動實驗）、`plot`、`handcalc`、`quiz`、`recap`、`symbols`、`code`、`table`、`callout`、`steps`、`prereq`、`derivation`。元素截圖前會展開所有 `<details>`、藏起固定的上方工具列；檔名是 `<路由>__<viewport>-<主題>__<shot>-<序號>.png`。`diagram-audit` 與 `scroll-audit` 預設用 Research 模式（內容最多）並展開所有 `<details>`，才量得到藏在裡面的東西；同一頁在不同模式下的方塊圖數量不同。

`scroll-audit` 的分類：

| 類別 | 意思 | 要求 |
|---|---|---|
| `DIAGRAM` | 在方塊圖（`figure.c-mermaid`）裡面出現的捲軸 | 必須是 0 |
| `TINY` | 只超出 6px 以內（四捨五入或 padding 造成），捲軸沒有用途 | 必須是 0 |
| `VERT` | 直向只超出 7–60px，為了兩三行放一條直向捲軸 | 必須是 0（放寬或拿掉高度上限） |
| `ok` | 內容真的放不下：寬表格、程式碼、很長的 JSON、比欄位還寬的公式 | 可以有，預設不印 |

使用者的要求是「沒有用途的捲軸一律拿掉」。窄欄位裡的公式優先改版面，不要留捲軸：兩欄卡片改讓 KaTeX 在最外層的等號／運算子後換行（`white-space: normal`，例：`signoff.css` 的 `.so-stmts`／`.so-limits`、`formulas.css` 的 `.fr-prereq-row`），或把並排的格子改成上下排（`verification.css` 的 `.ver-em-grid`）。這條換行規則不要套到表格的儲存格（整張表會被重排），也還沒有放進共用層：整欄寬的長等式鏈在桌機上、以及多數章節的公式在手機上，仍然是橫向捲動（`--formulas` 會列出這些）。

**約定：改了畫面的 PR 要附上這些檢查的結果。**

1. 改到的路由跑 `scroll-audit.mjs`（桌機與 `--viewport mobile`）：`DIAGRAM`、`TINY`、`VERT` 都是 0。
2. 改到方塊圖或圖所在的章節跑 `diagram-audit.mjs`：桌機的「超出」是 0、沒有 `ERROR`、沒有 `UNSUPPORTED-MARKDOWN`（手機上圖在自己的外框內橫向捲動，是預期行為）。
3. 用 `screenshots.mjs` 把改到的東西截下來**看過**：顏色有變就淺色與深色都看；版面有變就加 `--viewport mobile`；內容隨學習模式分層的，三種 `--mode` 各看一次。
4. 要量 DOM（元素數量、某段文字有沒有出現、元素寬度）時用 `dom-eval.mjs`，不要為了一次性的量測在 repo 裡留下暫存檔；輸出放 `outputs/`（已被 git 忽略）。
5. 升級 `mermaid`、`katex`、`plotly.js-cartesian-dist-min` 這類會改變渲染結果的套件前後，對同一組路由各跑一次 `diagram-audit.mjs`、`scroll-audit.mjs` 與 `screenshots.mjs --shots all-mermaid`，比較差異。

典型指令：

```bash
# 某一章的方塊圖：寬度、再逐張截圖（淺色＋深色）
node scripts/diagram-audit.mjs --routes /ch/05
node scripts/screenshots.mjs --routes /ch/05 --theme light,dark --shots all-mermaid --out outputs/shots/ch05

# 捲軸：桌機、手機，順便列出比欄位寬的公式
node scripts/scroll-audit.mjs --routes /ch/05,/ch/06
node scripts/scroll-audit.mjs --routes /ch/05 --viewport mobile --formulas

# 第一個互動實驗、第一題手算，Beginner 模式、手機尺寸
node scripts/screenshots.mjs --routes /ch/05 --mode beginner --viewport mobile --shots top,exp:1,handcalc:1

# 任意 DOM 量測：這一頁有幾張方塊圖
node scripts/dom-eval.mjs 'http://localhost:5173/#/ch/05' 'return document.querySelectorAll("figure.c-mermaid").length'
```

驗證管線是另一件事：`node scripts/verify.mjs [--no-run] [--strict]`（等於 `npm run verify`）跑 Vitest 與 pytest，依測試名稱中的 T-id 更新 `src/data/verification-status.json`（`--no-run` 只解析 `outputs/` 內既有的報告；`--strict` 把未對應 T-id 的失敗與無法載入的測試檔也視為失敗）。只有 TypeScript 與 Python 兩邊都通過的 T-id 才會標成 verified。

**建置大小（`scripts/check-bundle-size.mjs`）**：`npx vite build && node scripts/check-bundle-size.mjs dist` 檢查 plotly／最大非 plotly chunk／所有 JS 總和的位元組預算（超過就失敗），並和 git 裡的 `scripts/bundle-baseline.json` 比較，成長超過 10% 只警告。合併了大量內容、或刻意升級套件之後，重建並執行 `node scripts/check-bundle-size.mjs dist --update-baseline` 更新基準檔，再把更新後的檔案一起 commit。`--self-test` 只驗證判定邏輯。路由 chunk 的檔名是 `chapter-chNN-*`／`page-<名稱>-*`（`vite.config.ts` 的 `chunkFileName`），表格裡看得出是哪一章或哪一頁變大。

### CI 怎麼跑測試（`.github/workflows/`；2026-10-19）

| workflow | 觸發 | 跑什麼 | 擋 PR？ |
|---|---|---|---|
| `ci.yml` 的 `unit` job | PR、push 到 main | `npx vitest run --project node`（`src/**/*.test.ts`，約 129 檔、2,800 項） | 是（`ci-ok` 彙整） |
| `jsdom-tests.yml` | push 到 main、每週一 03:00 UTC、`workflow_dispatch` | `npx vitest run --project jsdom --shard=i/4 --maxWorkers=2`（`src/**/*.test.tsx`，約 150 檔、3,677 項，4 個 shard 平行，每個 `timeout-minutes: 30`） | 否（不擋 PR，也不擋部署：`deploy.yml` 只等 `ci.yml`） |
| `verify-status.yml` | 每週一 02:00 UTC | `npm run verify`（兩個 project 全跑 + pytest），比對 `src/data/verification-status.json` | 否 |

- **為什麼 jsdom 不擋 PR**：整章 smoke test 一次渲染上千個 KaTeX、Mermaid、手算題與 inline worker，單一測試的逾時設在 120–600 s，GitHub runner 只有 2–4 vCPU；擋 PR 會讓每個 PR 等很久，還會因逾時偶發失敗。改成 push 到 main 之後與每週各跑一次，壞掉時下一輪就看得到。穩定幾週之後可以改成 PR 上只跑「有改到的檔案」（`vitest run --changed origin/main --project jsdom`），目前還沒有做。
- **改了章節或共用元件的 PR**：本機跑 `npx vitest run <相關檔案> --maxWorkers=2`，或到 Actions 頁面手動觸發「jsdom tests」並選你的分支（`workflow_dispatch`）。
- **本機重現某個 shard**：`npx vitest run --project jsdom --shard=3/4 --maxWorkers=2`。`--shard` 依檔案切（不是依耗時），所以各 shard 的時間不平均。
- **shard 數的決定依據**（2026-10-19，Apple silicon 開發機、同時有其他程序在跑、`--maxWorkers=2`）：4 個 shard 的牆鐘時間是 109 s、206 s、214 s、243 s（40／40／40／37 檔；1,000／774／953／950 項），總和約 13.5 分鐘。GitHub runner（4 vCPU）估計比開發機慢 2–3 倍，最慢的 shard 預期 10–12 分鐘，遠低於 30 分鐘的 timeout；規則：**單一 shard 在本機超過 20 分鐘就改成 6 個 shard**（同時改 `jsdom-tests.yml` 的 `matrix.shard` 與 `env.SHARDS`）。每個 shard 會上傳 JSON 報告（`outputs/vitest-jsdom-<i>.json`，保留 14 天），每個 `it` 的耗時都在 `assertionResults[].duration`。
- **Vitest 升到 3.2 以上**：`vite.config.ts` 的 `test.workspace` 改名 `test.projects`（內容不變），`--project`／`--shard` 的用法不變。

## 9. 交叉比對欄位語意（`crossCheck`：Analytic／Monte Carlo／Fixed-Point；2026-10-19）

`ExperimentShell` 的 `crossCheck` 三欄（型別 `CheckStatus`／`CheckEntry`，`src/components/types.ts`）只能用下面四種值，而且**每一格都要能回答「比了什麼、結果如何、或為什麼沒比」**：

| 狀態 | 意思 | `note` |
|---|---|---|
| `'ok'` | 兩種**獨立**的方法在寫明的 tolerance 內一致（例如封閉式 vs 數值求根、線性模型 vs 多 seeds 的 MC、定點 vs 同 seed 浮點） | 必附：比了什麼、差多少、容許多少（`$…$` 行內公式可用） |
| `'mismatch'` | 超出 tolerance | 必附：差多少、容許多少、可能原因 |
| `'not-implemented'` | 這個實驗**應該有**這種比對（方法對它有意義）、但還沒做；要列在 roadmap（`src/pages/roadmap/data.ts`） | 必附：缺什麼、對應的 roadmap 項目 |
| `'n/a'` | 這種方法對這個實驗**沒有意義**（例如確定性的矩陣計算沒有 Monte Carlo、L0 浮點教學模型沒有定點），或此刻沒有可比的量（還沒執行、模型發散、工作點不在適用範圍） | **必附**一句原因 |

規則：

1. 不要寫裸的 `'n/a'`／`'not-implemented'`（沒有 `note` 的字串）；用 `{ status, note }`。`ExperimentShell` 會把 `note` 顯示在狀態旁，並用 `accessibleText` 放進 `title`。
2. 「還沒執行／計算中」是 `'n/a'`（附「尚未執行」或「計算中」），不是 `'not-implemented'`：後者只用在**功能缺口**。
3. 只有真的算過才標 `'ok'`；`'ok'` 的 tolerance 要寫在 `note` 或假設裡（例如 `4·se`、`1 LSB + 4 SE`、相對 `10⁻⁹`）。
4. 有 seed 與隨機性的實驗，Monte Carlo 欄要做多 seed（≥ 8，`deriveSeed(seed, r)`）的統計（平均、CI）與判定；確定性的實驗標 `'n/a'` 並說明是確定性的。有定點模型的實驗，Fixed-Point 欄做「定點 vs 同 seed 浮點」的成對比較（`/lab` 的 Pipeline、Monte Carlo、FCW sweep 分頁與 Models 頁的 BlockLms JSON Lab 都是這個做法）。
5. 這一節的掃描：`grep -rn "crossCheck" src --include='*.tsx' --include='*.ts' | grep -v '\.test\.'`；裸狀態用 `grep -rn "'n/a'\|'not-implemented'" src | grep -v "status:"` 找。
