/**
 * 手算練習簿頁的方塊圖原始碼（docs/teaching-style.md §8；diagrams.test.tsx 以真正的 mermaid 解析並「畫出來」逐一檢查）。
 *
 * 規則：
 * - 節點與連線標籤裡的數學一律寫 `$...$`（LaTeX），共用的 <Mermaid> 元件用 KaTeX 排版（和正文同一套樣式）；文字、按鈕名稱、程式碼名稱照常寫。
 *   原始碼用 String.raw 樣板字串，TeX 的反斜線只寫一次；換行用 `<br/>`，標籤內不用雙反斜線；
 *   標籤的數學裡不用 ASCII 的 < >（Mermaid 會先把它們轉成 HTML 實體），不等式寫 `\lt` `\gt` `\le` `\ge`；百分比寫 `\%`。
 *   含括號、等號、問號、斜線的文字一律用雙引號包住。
 * - 加法點是圓形節點，文字寫全形「＋」；每條進來的邊以「＋」或「−」（U+2212）開頭，標籤裡還有公式時把正負號放進數學（`$+\,\Delta w_n$`）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 顏色在深淺主題下都看得清楚：藍 = 本張圖的主角、綠 = 通過、棕 = 需要小心的分支。
 * - 三張圖各對應程式裡的一處，測試會逐一核對：
 *     CHART_HOWTO       ↔ src/components/HandCalc.tsx 的按鈕與 handcalcMath.ts 的 checkAnswer（相對 1%、絕對 1e-9）
 *     CHART_DEMO_ORDER  ↔ src/chapters/ch00/handcalcs.ts 的 HC-00.1（測試照著圖算兩步，等於 solve() 的 w₁、w₂）
 *     CHART_BANK        ↔ index.tsx 的篩選、題庫瀏覽、隨機練習、練習卷（logic.ts 的 filtersToParams 等）
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'

/**
 * §2：一題的練習流程。先改成自己的數字看代入，再切到「自己算算看」，答案落在容許誤差內就算對；
 * 不對（或卡住）就看詳解，對照每一步找出哪裡算錯，改正後重填。容許誤差見 handcalcMath.ts 的 checkAnswer。
 */
export const CHART_HOWTO = String.raw`flowchart TD
  PICK["① 挑一題<br/>題庫瀏覽或隨機練習"] --> SUB["② 改成你自己的數字<br/>看每一步怎麼代入"]
  SUB --> HAND["③ 切到「自己算算看」<br/>先用紙筆和計算機算"]
  HAND --> FILL["④ 填答案，按「對答案」"]
  FILL --> CHK{"相對誤差 $\le 1\%$<br/>（或絕對誤差 $\le 10^{-9}$）？"}
  CHK -- "是" --> OK["✓ 正確"]
  OK -- "換一題（隨機數字）" --> HAND
  CHK -- "否：顯示相對誤差" --> REV["⑤ 看詳解<br/>符號式 = 代入數字 = 結果"]
  HAND -. "卡住了" .-> REV
  REV --> FIND["對照每一步<br/>找出自己哪一步算錯"]
  FIND -- "改正後重填" --> FILL
  ${FOCUS}
  ${PASS}
  ${ALT}
  class CHK focus
  class OK pass
  class REV alt`

/**
 * §2「先試一題」：HC-00.1（LMS 更新）的計算順序。①預測 ②比較 ③修正量 ④更新，然後用新的 w 再做一次（同一組 x、y）。
 * e_n = y − ŷ_n（量測為正、預測為負）；w_(n+1) = w_n + μ·e_n·x。
 */
export const CHART_DEMO_ORDER = String.raw`flowchart LR
  X(["$x$<br/>輸入"]) --> PRED["① 預測<br/>$\hat y_n = w_n\,x$"]
  W(["$w_n$<br/>目前的猜測"]) --> PRED
  X --> FIX["③ 修正量<br/>$\Delta w_n = \mu\,e_n\,x$"]
  PRED -- "$-\,\hat y_n$" --> S1(("＋"))
  Y(["$y$<br/>量到的輸出"]) -- "$+\,y$" --> S1
  S1 -- "② $e_n$<br/>$= y - \hat y_n$" --> FIX
  FIX -- "$+\,\Delta w_n$" --> S2(("＋"))
  W -- "$+\,w_n$" --> S2
  S2 -- "④ $w_{n+1}$<br/>$= w_n + \Delta w_n$" --> NEXT(["$w_{n+1}$<br/>回到 ① 再做一次<br/>（同一組 $x$、$y$）"])
  ${FOCUS}
  class FIX focus`

/**
 * §4：題庫的三種用法。題目全部來自各章的 handcalcs.ts（本頁不新增公式）；題庫瀏覽與隨機練習吃同一組篩選，
 * 練習卷自己選章節、難度與題數（切到練習卷時沿用目前的篩選當起點）。三者的詳解都由 def.solve() 當場算出。
 * 節點文字用 <br/> 排成窄窄的幾行：圖才放得進桌機的正文欄（不用橫向捲動）。
 */
export const CHART_BANK = `flowchart LR
  SRC["各章與各頁的<br/>handcalcs.ts<br/>ALL_HANDCALCS"] --> FIL["篩選<br/>?ch 章節,<br/>?level 難度,<br/>?q 關鍵字"]
  FIL --> BR["題庫瀏覽<br/>依章節分組,<br/>點開是完整的 HandCalc"]
  FIL --> RP["隨機練習<br/>seed 可見,<br/>作答統計存在 localStorage"]
  SRC --> SH["練習卷<br/>自選章節, 難度, 題數"]
  FIL -. "切到練習卷<br/>時沿用" .-> SH
  SH --> PR["列印 / 存成 PDF<br/>空白作答區,<br/>後面附逐步解答"]
  BR --> SV["def.solve()<br/>詳解當場算出"]
  RP --> SV
  SH --> SV
  SIM["src/simulation<br/>的模型函式"] --> SV
  ${FOCUS}
  class SV focus`

/** 本頁全部的圖（名稱、所在段落、原始碼），依頁面上出現的順序。 */
export const WORKBOOK_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'CHART_HOWTO', section: '§2', chart: CHART_HOWTO },
  { name: 'CHART_DEMO_ORDER', section: '§2', chart: CHART_DEMO_ORDER },
  { name: 'CHART_BANK', section: '§4', chart: CHART_BANK },
]
