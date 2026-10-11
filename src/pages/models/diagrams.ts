/**
 * Models 頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、冒號、等號等特殊字元的文字一律用雙引號包住。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample n／block k）都和頁面上的公式、以及 blockLms.ts 實際執行的程式一致；
 *   diagrams.test.tsx 以真正的 mermaid parser 解析每一張，並逐條核對。
 * - 顏色（深淺主題都看得清楚）：藍 = 這一段的主角；綠 = 本站已完整實作；紅 = 未實作／容易出錯的地方。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const PASS = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * §2：模型層級 L0–L6 的階梯（規格 §15.1）。箭頭 = 「在前一層之上再加東西」。
 * 顏色對應 S2Levels 的實作程度：綠 = 已實作（L0、L1）、紅 = Not implemented（L6）、其餘是簡化版。
 */
export const LEVEL_CHART = `flowchart LR
  L0["L0 純量 LMS<br/>每 sample"] --> L1["L1 Block GMAC<br/>＋ Gaussian comparator"]
  L1 --> L2["L2 DTC residue<br/>＋ H_PD / T"]
  L2 --> L3["L3 多參數<br/>＋ Jacobian"]
  L2 --> L4["L4 Noise PSD<br/>→ output jitter / spur"]
  L2 --> L5["L5 定點 / RTL-like"]
  L3 --> L6["L6 進階 PLL / DSM / FCW"]
  L4 --> L6
  L5 --> L6
  ${PASS}
  ${WARN}
  class L0,L1 ok
  class L6 warn`

/**
 * §3：參考 Block Sign-LMS 的兩層迴圈（F-15.1、F-15.2；blockLms.ts 的 core:blockLmsInnerLoop / blockLmsGmacUpdate）。
 * 內層（索引 n）：dt = (a − w_app)·x + nl(x) → H_PD（有狀態）→ + b + v → sign → q·x_ref 累加。
 * 外層（索引 k）：G_k = (1/N)·Σ → w_(k+1) = w_k + μ·G_k → 晚 d 個 block、量化後才作用到 DTC。
 */
export const CHART_BLOCK_SIGN_LMS = `flowchart LR
  subgraph FS["內層迴圈：每個 comparator sample 做一次（索引 n）"]
    direction LR
    X(["code x[n]"]) --> DTC["DTC 誤差<br/>(a − w_app)·x + c₂·x² + c₃·x³ + o"]
    DTC --> HPD["PLL error path H_PD(z)<br/>狀態跨 block 持續"]
    HPD -- "＋" --> S(("＋"))
    BV(["offset b 與雜訊 v[n]<br/>v 的 RMS = σ_v"]) -- "＋" --> S
    S -- "e[n]" --> CMP["1-bit comparator<br/>e ≥ 0 時 q = +1，否則 q = −1"]
    CMP -- "q[n]" --> MUL(("×"))
    X -- "x_ref[n]：x、x[n−D] 或 filtered-x" --> MUL
  end
  subgraph FU["外層迴圈：每 N 個 sample 做一次（索引 k）"]
    direction LR
    AVG["GMAC<br/>G_k = (1/N)·Σ q[n]·x_ref[n]"] -- "G_k" --> UPD["更新<br/>w_(k+1) = w_k + μ·G_k"]
    UPD -- "w_k" --> REG["gain register<br/>w_app = phys(w_(k−d))"]
  end
  MUL -- "q[n]·x_ref[n]，共 N 個" --> AVG
  REG -. "w_app（整個 block 內不變）" .-> DTC
  ${FOCUS}
  class CMP,AVG focus`

/**
 * §9：GMAC 到 gain register 的 RTL datapath，以及 §16.1 前 8 項檢查各自落在哪一塊（F-16.1、F-16.3、F-16.4、F-16.5）。
 * S_k 是 N 筆的總和（整數）；Ĝ_k 是右移之後的值；ℓ = log₂N − F_G。
 */
export const CHART_GMAC_DATAPATH = `flowchart LR
  B(["comparator bit b[n]<br/>0 或 1"]) --> MAP["檢查 1：映射成 ±1<br/>q = 2b − 1"]
  X(["code x_int[n]<br/>B_x-bit 有號整數"]) --> DLY["檢查 2：對齊<br/>z^(−D)，用 x_int[n−D]"]
  MAP -- "q[n]" --> NEG["條件取負<br/>q = −1 時取 −x<br/>先符號延伸到 B_x+1 bits"]
  DLY -- "x_int[n−D]" --> NEG
  NEG -- "q·x_int" --> ACC["檢查 3、7：累加 N 筆，每個 block 清零<br/>S_k = Σ q·x_int<br/>B_acc = 1 + ⌈log₂(N·M_x + 1)⌉ bits"]
  ACC -- "S_k" --> SHIFT["檢查 4、5：右移 ℓ = log₂N − F_G bits<br/>Ĝ_k = Δ_G·⌊S_k / 2^ℓ⌋"]
  SHIFT -- "Ĝ_k" --> MU["× μ<br/>shift 型：μ = 2^(−m)"]
  MU -- "μ·Ĝ_k" --> REG["檢查 6、8：gain register<br/>w_(k+1) = w_k + μ·Ĝ_k<br/>內部小數 bit、saturate"]
  REG -- "高位的實體 code" --> DTC(["DTC"])
  ${FOCUS}
  ${WARN}
  class ACC focus
  class SHIFT warn`

/** 頁面上的圖（依出現順序）；diagrams.test.tsx 逐一解析，並核對頁面真的畫了這幾張。 */
export const MODEL_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'LEVEL_CHART', section: '§2', chart: LEVEL_CHART },
  { name: 'CHART_BLOCK_SIGN_LMS', section: '§3', chart: CHART_BLOCK_SIGN_LMS },
  { name: 'CHART_GMAC_DATAPATH', section: '§9', chart: CHART_GMAC_DATAPATH },
]
