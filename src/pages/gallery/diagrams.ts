/**
 * Gallery 頁的 Mermaid 圖（diagrams.test.ts 以真正的 mermaid parser 驗證語法、節點數與加法點的正負號）。
 *
 * 規則（docs/teaching-style.md §8）：
 * - 流程圖（PRESET_FLOW、THREE_QUESTIONS）的節點只放文字；數學模型圖（CHART_*）的節點用 Unicode 數學符號，
 *   因為 Mermaid 不渲染 KaTeX——公式本體仍在圖說下方的導讀與內文以 KaTeX 顯示。
 * - 加法點是圓形節點，文字寫全形「＋」；每條進來的邊以「＋」或「−」（U+2212）開頭。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 延遲寫 z⁻¹、累加器寫 1/(z−1)；含括號、等號、絕對值符號的文字一律用雙引號包住。
 * - 顏色在深淺主題下都看得清楚：藍 = 主角、棕 = 第二個重點、紫 = 第三個重點、綠 = 通過、紅 = 不通過。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const THIRD = 'classDef third fill:#6b3fa0,stroke:#44286b,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/** 一個 preset 的兩條路：左邊到原頁面「載入並執行」，右邊在 Gallery 內用同一組模型函式重算並與預期文字比對 */
export const PRESET_FLOW = `flowchart TD
  J["src/data/presets/id.json<br/>page, experiment, params, expected, tests"] --> A["ALL_PRESETS<br/>import.meta.glob 自動收集"]
  A --> C["Gallery 卡片<br/>標題, 說明, 預期結果, T-id"]
  C -->|"載入並執行"| U["原頁面網址帶 ?preset=id"]
  U --> H["useUrlPreset(experiment)"]
  H --> E["ExperimentShell<br/>完整互動實驗, Monte Carlo 在 Worker"]
  C -->|"即時預覽"| P["previewPreset(preset)"]
  P --> M["src/simulation/models 的同一組函式"]
  E --> M
  M --> N["重算的數值"]
  N --> K{"checkExpected<br/>與預期文字逐項比對"}
  K -->|"每個必備數值都相符"| OK["ok"]
  K -->|"有必備數值找不到"| BAD["mismatch, 顯示哪一個"]
`

/** 三個問題的學習路線（規格 §19.1 的三條路線對應到 12 個 preset） */
export const THREE_QUESTIONS = `flowchart LR
  Q1["問題一 走不走得回來<br/>pole 在單位圓內嗎"] --> S1["preset 1, 3, 4, 5, 6, 12"]
  Q2["問題二 停在哪裡<br/>固定點等於真值嗎"] --> S2["preset 7, 10, 11"]
  Q3["問題三 停下來後抖多大<br/>雜訊與 spur"] --> S3["preset 2, 8, 9"]
  S1 --> R["sign-off<br/>三個問題都要回答"]
  S2 --> R
  S3 --> R
`

/**
 * §2.1：preset #1 的 LMS 迴路（預測 → 比較 → 修正 → 等下一步）。
 * e_n = y_n − w_n·x（量測為正、預測為負），w_(n+1) = w_n + μ·e_n·x。
 */
export const CHART_LMS_LOOP = `flowchart LR
  X(["輸入 x"]) --> BOX["黑盒子<br/>× a（a 未知）"]
  X --> PRED["你的預測<br/>× w_n"]
  BOX -- "＋ y_n = a·x" --> S1(("＋"))
  PRED -- "− w_n·x" --> S1
  S1 -- "e_n = y_n − w_n·x" --> GAIN["修正量<br/>× μ·x"]
  GAIN -- "＋ μ·e_n·x" --> S2(("＋"))
  S2 -- "w_(n+1) = w_n + μ·e_n·x" --> Z["z⁻¹<br/>留到下一步"]
  Z -- "＋ w_n" --> S2
  Z -. "w_n（下一步拿去預測）" .-> PRED
  ${FOCUS}
  class GAIN focus`

/**
 * §2.3：F-GA.1 的判定流程（format.ts 的 acceptHalfWidth／findExpectedMatch、consistency.ts 的 checkExpected）。
 * 夠精確：W = k_tol·Δ_t；短數字：必備數值只接受相等（W = 10⁻⁹·max(1, |y_t|)），非必備不拿來當證據。
 */
export const CHART_MATCH_DECISION = `flowchart TD
  T(["預期文字裡的一個數字 y_t<br/>例：寫成 2.28 時 n_d = 2、e = 0"]) --> H["捨入半寬<br/>Δ_t = ½·10^(e − n_d)"]
  H --> Q1{"夠精確嗎？<br/>Δ_t ≤ 0.01·|y_t|"}
  Q1 -- "是：約 3 位有效數字以上" --> W1["接受半寬<br/>W = k_tol·Δ_t"]
  Q1 -- "否：短數字，例如 1.8、0.6" --> Q2{"這個量是必備數值嗎？"}
  Q2 -- "是" --> W2["只接受相等<br/>W = 10⁻⁹·max(1, |y_t|)"]
  Q2 -- "否" --> SKIP["不拿這個數字當證據"]
  Y(["重算值 ŷ<br/>真實模型函式當場算出"]) --> CMP{"|ŷ − y_t| ≤ W ？"}
  W1 --> CMP
  W2 --> CMP
  CMP -- "是" --> OK["相符 match"]
  CMP -- "否，文字裡其他數字也都對不上" --> BAD["必備數值：mismatch<br/>非必備：只標成未列出"]
  ${PASS}
  ${WARN}
  class OK pass
  class BAD warn`

/**
 * §4：統一觀點（F-GA.4）的純量迴路。δ_k = a − w_k，G_k = K·δ_k + B + η_k，w_(k+1) = w_k + μ·G_k。
 * 三個有顏色的方塊各管一個問題：K（pole p = 1 − μK）、B（固定點 w* = a + B/K）、η_k（穩態抖動 σ_w）。
 */
export const CHART_UNIFIED_LOOP = `flowchart LR
  A(["a<br/>真值"]) -- "＋" --> S1(("＋"))
  S1 -- "δ_k = a − w_k" --> KB["× K<br/>恢復力的斜率<br/>例：K = K_q·C"]
  KB -- "＋ K·δ_k" --> S2(("＋"))
  B(["B<br/>與 δ 無關的固定項<br/>offset、INL 造成"]) -- "＋" --> S2
  ETA(["η_k<br/>零均值雜訊<br/>每個 block 獨立"]) -- "＋" --> S2
  S2 -- "G_k = K·δ_k + B + η_k" --> MU["× μ<br/>步長"]
  MU -- "μ·G_k" --> ACC["累加器 1/(z−1)<br/>w_(k+1) = w_k + μ·G_k"]
  ACC -- "−（回授 w_k）" --> S1
  ${FOCUS}
  ${ALT}
  ${THIRD}
  class KB focus
  class B alt
  class ETA third`

/** 本頁全部的圖（名稱、所在段落、原始碼）：測試逐一解析，頁面測試核對出現的順序。 */
export const GALLERY_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'PRESET_FLOW', section: '§1', chart: PRESET_FLOW },
  { name: 'CHART_LMS_LOOP', section: '§2.1', chart: CHART_LMS_LOOP },
  { name: 'CHART_MATCH_DECISION', section: '§2.3', chart: CHART_MATCH_DECISION },
  { name: 'CHART_UNIFIED_LOOP', section: '§4', chart: CHART_UNIFIED_LOOP },
  { name: 'THREE_QUESTIONS', section: '§4', chart: THREE_QUESTIONS },
]
