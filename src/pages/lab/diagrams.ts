/**
 * 本頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、冒號、等號等特殊字元的文字一律用雙引號包住。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample n／block k）都和頁面上的公式一致；
 *   diagrams.test.ts 以真正的 mermaid parser 解析每一張，並逐條核對極性與節點數（≤ 14）。
 * - 顏色（深淺主題都看得清楚）：藍 = 校正迴路看到的那條路／這一段的主角；棕 = 與它對照的另一條路。
 * - 九級的編號對應 unifiedLab.ts 的 StageId 與 Lab 裡的 stage 卡片。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'

/** §2：FCW 到輸出端的九級訊號鏈。同一個 e_DTC 分兩條路：H_PD（藍，到 comparator）與 T（棕，到輸出）。 */
export const PIPELINE_CHART = `flowchart LR
  FCW["FCW = N_int + α"] --> DSM["1 DSM<br/>first-order / MASH 1-1-1"]
  DSM -->|"residue r[n]"| NORM["2 code 正規化<br/>x = (r − o)·s"]
  NORM -->|"x[n]"| DTC["3 DTC<br/>gain / offset / INL"]
  DTC -->|"e_DTC[n]"| HPD["4 PLL error path<br/>H_PD = 1/(1+L)"]
  DTC -->|"e_DTC[n]"| TOUT["9 輸出端<br/>T = L/(1+L)"]
  HPD -->|"u_pd[n]"| CMP["5 Comparator<br/>1-bit，雜訊 σ_v，offset b"]
  CMP -->|"q[n]"| GMAC["6 GMAC<br/>N 筆 q·x_ref 的平均（或總和）"]
  NORM -->|"x_ref：raw / delayed / filtered"| GMAC
  GMAC -->|"G_k"| UPD["8 更新<br/>w_(k+1) = w_k + μ·G_k"]
  UPD -->|"w_k"| REG["7 Gain register<br/>w_app = phys(w_(k−d))"]
  REG -->|"w_app"| DTC
  TOUT -->|"t_out[n]"| OUT["jitter / PSD / spur"]
  ${FOCUS}
  ${ALT}
  class HPD focus
  class TOUT alt`

/**
 * §4.4：主 PLL 的負回授。u_pd = e_DTC − θ_fb、θ_fb = L·u_pd ⇒ u_pd = e_DTC/(1+L)、t_out = θ_fb = L/(1+L)·e_DTC。
 * 加法點的輸出同時送到 comparator（H_PD）；回授量本身就是輸出端被移動的量（T）。
 */
export const CHART_TWO_PATHS = `flowchart LR
  E(["DTC 誤差<br/>e_DTC[n]"]) -- "＋" --> S(("＋"))
  S -- "u_pd = e_DTC − θ_fb" --> L["open loop L(z)<br/>loop filter + VCO"]
  L -- "−（回授 θ_fb = L·u_pd）" --> S
  S -- "u_pd[n]" --> CMP["到 comparator：校正迴路看到的<br/>u_pd = H_PD·e_DTC<br/>H_PD = 1/(1+L)，high-pass"]
  L -- "θ_fb[n]" --> OUT["到 PLL 輸出：使用者看到的<br/>t_out = θ_fb = T·e_DTC<br/>T = L/(1+L)，low-pass"]
  ${FOCUS}
  ${ALT}
  class CMP focus
  class OUT alt`

/**
 * §4.7：block rate（索引 k）的校正迴路，含更新延遲 d。
 * G_k = K·δ_(k−d) + η_k、w_(k+1) = w_k + μ·G_k、δ = a − w ⇒ δ_(k+1) = δ_k − g·δ_(k−d) − μ·η_k，g = μ·K。
 */
export const CHART_UPDATE_LOOP = `flowchart LR
  A(["a<br/>真實的 DTC gain"]) -- "＋" --> S1(("＋"))
  S1 -- "δ_(k−d) = a − w_(k−d)" --> KB["× K<br/>GMAC 斜率 K = K_q·C"]
  KB -- "＋" --> S2(("＋"))
  ETA(["η_k：GMAC 雜訊<br/>變異數 σ_η² ≈ E[x_ref²]/N"]) -- "＋" --> S2
  S2 -- "G_k = K·δ_(k−d) + η_k" --> MU["× μ<br/>learning rate"]
  MU -- "μ·G_k" --> ACC["累加器 1/(z−1)<br/>w_(k+1) = w_k + μ·G_k"]
  ACC -- "w_k" --> DLY["z^(−d)<br/>更新延遲 d 個 block"]
  DLY -- "−（w_app = w_(k−d)）" --> S1
  ${FOCUS}
  ${ALT}
  class KB,MU focus
  class DLY alt`

/**
 * §4.9：輸出端的兩個成分。e_DTC = (a − w̄)·x + d(x) − δw·x，t_out = T{e_DTC}。
 * 靜態殘差留下 fractional spur；gain 抖動「乘上」code 之後才是隨機 jitter。
 */
export const CHART_OUTPUT_SPLIT = `flowchart LR
  X(["code x[n]"]) --> M1["× (a − w̄)<br/>靜態的 gain 殘差"]
  X --> DX["d(x)<br/>offset 與 INL"]
  X --> M2["× δw_k<br/>gain 抖動，RMS = σ_w"]
  M1 -- "＋" --> S(("＋"))
  DX -- "＋" --> S
  M2 -- "−" --> S
  S -- "e_DTC[n]" --> T["T(z) = L/(1+L)<br/>output transfer，low-pass"]
  T -- "靜態殘差那一份" --> SPUR["fractional spur<br/>A_spur = |a − w̄|·s·A₁·|T(f₁)|"]
  T -- "gain noise 那一份" --> JIT["隨機 jitter<br/>Var ≈ σ_w²·(x̄² + Var(T{x̃}))"]
  ${FOCUS}
  ${ALT}
  class M1,SPUR focus
  class M2,JIT alt`

/** §7：五個分頁各自跑什麼。Pipeline／FCW sweep／Monte Carlo 共用基準參數；全部呼叫同一份模擬核心。 */
export const CHART_TAB_MAP = `flowchart TB
  BASE(["基準參數（三個分頁共用）<br/>FCW、DSM、PLL、σ_v、μ、N、d、定點"])
  BASE --> PIPE["Pipeline<br/>1 組參數 × 1 個 seed<br/>九級中間訊號、jitter / spur"]
  BASE --> SWEEP["FCW sweep<br/>只換 α，其他不動<br/>C、bias、spur 對 α 的曲線"]
  BASE --> MC["Monte Carlo<br/>1 組參數 × 很多 seed<br/>信賴區間、對照 mean-field"]
  OWN1(["Training 自己的設定<br/>code 來源、α、正規化"]) --> TRAIN["Training<br/>不跑迴路，只分析 code<br/>PSD、相關、Jacobian 的秩"]
  OWN2(["Compare 自己的設定<br/>最多三組完整參數"]) --> CMPR["Compare A / B / C<br/>同一個 seed 成對比較"]
  PIPE --> CORE["同一份模擬核心<br/>unifiedLab.ts（Web Worker）"]
  SWEEP --> CORE
  MC --> CORE
  TRAIN --> CORE
  CMPR --> CORE
  ${FOCUS}
  class CORE focus`

/** 頁面上的圖（依出現順序）；diagrams.test.ts 逐一解析，index.test.tsx 核對頁面真的畫了這幾張。 */
export const LAB_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'PIPELINE_CHART', section: '§2', chart: PIPELINE_CHART },
  { name: 'CHART_TWO_PATHS', section: '§4.4', chart: CHART_TWO_PATHS },
  { name: 'CHART_UPDATE_LOOP', section: '§4.7', chart: CHART_UPDATE_LOOP },
  { name: 'CHART_OUTPUT_SPLIT', section: '§4.9', chart: CHART_OUTPUT_SPLIT },
  { name: 'CHART_TAB_MAP', section: '§7', chart: CHART_TAB_MAP },
]
