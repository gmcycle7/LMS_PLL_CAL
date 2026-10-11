import type { SystemBlock } from '@/components'

/**
 * Ch05 的方塊圖（docs/teaching-style.md §8）。
 *
 * - 每張圖是一個具名匯出的 Mermaid 原始碼字串；`diagrams.test.tsx` 用真正的 mermaid 逐一解析並「真的畫一次」
 *   （`@/components/mermaidTestUtils`），並核對節點數、加法點的正負號標示，以及圖上寫死的數字（由 `src/simulation` 的函式重算）。
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；下標寫成 `w_k`、`w_(k+1)`，與章首的系統地圖一致。
 *   圖說（caption）由 <Mermaid> 以 KaTeX 渲染 `$...$`，所以圖說裡的數學一律寫成 `$...$`，不用 Unicode 拼。
 * - 圖上的訊號名稱、箭頭方向、加法點的 ＋／−、取樣率（sample n／block k）都對應正文的公式；
 *   全站極性 δ = a − w（不是 w − a）。
 * - 標籤裡不寫裸的「小於」符號（strict 模式下可能被當成 HTML tag），改用文字或 ≤、≥、>。
 * - Mermaid 11 把每個標籤當成 markdown：單獨的半形「+」「-」或以「+ 」「- 」「* 」「1. 」「# 」「> 」開頭的標籤（含 <br/> 之後的每一行）
 *   會被畫成「Unsupported markdown: list」，而 parser 不會報錯。所以加法點與邊上的正號一律直接寫全形「＋」、負號寫「−」（U+2212）；
 *   共用的 <Mermaid> 另有 sanitizeMermaidSource 當第二道保險，測試會把每張圖真的渲染一次來檢查。
 * - 兩個不相連的 subgraph 之間加一條看不見的連線（`A ~~~ B`）讓它們上下排；否則 TB 圖會把它們左右並排，整張圖太寬。
 *   圖說與導讀裡的「上框／下框」「上面那條路／下面那條路」由測試用實際排版結果核對。
 * - 版面最寬約 1,080 px，Mermaid 會把太寬的圖等比例縮小（字就變小）：單張橫排（LR）的階段數控制在 7 格左右、
 *   長的說明放進節點（用 <br/> 換行）而不是邊的標籤；階段更多的流程（硬體路徑、AR(1) 產生器）改成直式（TB）。
 */

/** 本章主角：藍色方塊（comparator 前的雜訊、1-bit comparator、GMAC 累加）。 */
export const CH05_SYSTEM_FOCUS: SystemBlock[] = ['noise', 'cmp', 'gmac']

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'
const OK = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'

/** §0（原有的圖）：本章的 L1 模型——固定誤差 + 雜訊 → comparator → 累加 → 方向判斷。 */
export const CHART_L1_MODEL = `flowchart LR
  S["固定誤差 s（fs）"] -- "＋ s" --> ADD(("＋"))
  VN(["雜訊 v ~ N(0, σ_v²)"]) -- "＋ v" --> ADD
  ADD -- "e = s + v" --> CMP["Comparator<br/>threshold θ"]
  CMP -- "q = ±1" --> ACC["累加器<br/>S_N = Σ q_i"]
  ACC -- "sign(S_N)，S_N = 0 時依 tie rule" --> DEC["方向判斷"]
  ${FOCUS}
  class CMP,ACC focus`

/** 直覺段：本章路線圖（每一節回答哪個問題、結果往哪裡用）。 */
export const CHART_ROADMAP = `flowchart LR
  Q0["問題<br/>s = 1 fs 藏在<br/>σ_v = 100 fs 的雜訊裡"] --> P2["§2 單次比較<br/>p = P(q = +1)、m = E[q]"]
  P2 --> P3["§3 累加 N 次<br/>訊號 ∝ N、雜訊 ∝ √N"]
  P3 --> P4["§4 要累加幾次<br/>N ≈ (z·σ_v/s)²·π/2"]
  P2 --> P5["§5 小訊號增益<br/>K_q = √(2/π)/σ_v"]
  P4 --> P6["§6、§8 實驗與方法比較<br/>精確、CLT、Monte Carlo"]
  P5 --> P7["§7 雜訊像 dither<br/>逐 sample 迴路"]
  P3 --> P9["§9 block 校正迴路<br/>p_cal = 1 − μ·K_q、σ_w"]
  P5 --> P9
  P7 --> P9
  ${FOCUS}
  class P2,P3,P5 focus`

/** §1：「先算一次」的手算順序（數字是 s = 1 fs、σ_v = 100 fs；測試以模擬核心重算）。 */
export const CHART_FIRST_CALC = `flowchart LR
  IN["已知<br/>s = 1 fs<br/>σ_v = 100 fs"] --> R["① 標準化<br/>r = s/σ_v = 0.01"]
  R --> P["② p = Φ(r)<br/>≈ ½ + r·φ(0)<br/>≈ 0.50399"]
  P --> PM["③ 1 − p ≈ 0.49601"]
  P --> M["④ m = 2p − 1<br/>≈ 0.00798"]
  M --> VQ["⑤ Var(q) = 1 − m²<br/>≈ 0.99994"]
  NN["再給樣本數 N"] --> SIG["訊號<br/>E[S_N] = N·m"]
  M --> SIG
  NN --> NOI["雜訊<br/>SD(S_N) = √(N·(1 − m²))"]
  VQ --> NOI
  SIG --> SNR["SNR_stat<br/>= 訊號 ÷ 雜訊"]
  NOI --> SNR
  ${FOCUS}
  class M,SNR focus`

/** §2：單一次比較——e = s + v 與門檻 θ 比較，輸出 q = ±1。 */
export const CHART_SINGLE_COMPARE = `flowchart LR
  S["固定誤差 s"] -- "＋ s" --> ADD(("＋"))
  VN(["雜訊 v ~ N(0, σ_v²)"]) -- "＋ v" --> ADD
  ADD -- "＋ (e = s + v)" --> SUB(("＋"))
  TH["threshold θ"] -- "− θ" --> SUB
  SUB -- "e − θ" --> SGN{"e − θ ≥ 0 ？"}
  SGN -- "是：機率 p = Φ((s − θ)/σ_v)" --> QP["q = +1"]
  SGN -- "否：機率 1 − p" --> QM["q = −1"]
  ${FOCUS}
  class SGN focus`

/** §2：由 p 得到平均 m = E[q] 與 Var(q)（q 只有 ±1 兩個值）。 */
export const CHART_Q_STATS = `flowchart LR
  Q["q 只有兩個值"] -- "機率 p" --> QP["q = +1"]
  Q -- "機率 1 − p" --> QM["q = −1"]
  QP -- "＋ p" --> E(("＋"))
  QM -- "− (1 − p)" --> E
  E --> M["平均（訊號）<br/>m = E[q] = 2p − 1<br/>= erf((s − θ)/(√2·σ_v))"]
  QP -- "q² = 1" --> SQ["E[q²] = 1"]
  QM -- "q² = 1" --> SQ
  SQ --> VAR["雜訊功率<br/>Var(q) = E[q²] − m² = 1 − m²"]
  M --> VAR
  ${FOCUS}
  class M,VAR focus`

/** §2：硬體 0/1 位元一定要先映射成 q = 2b − 1（正確路徑 vs 忘了映射）。 */
export const CHART_BIT_MAPPING = `flowchart LR
  CMP["Comparator<br/>輸出位元 b ∈ {0, 1}"] --> MAP["映射 q = 2b − 1"]
  MAP -- "q ∈ {−1, +1}" --> G1["GMAC：Σ q·x"]
  G1 --> GOOD["w = a 時 E[q·x] = 0<br/>固定點就在真值 a"]
  CMP -- "忘了映射，直接送 b" --> G2["GMAC：Σ b·x"]
  G2 --> BAD["w = a 時 E[b·x] = ½·E[x]<br/>E[x] ≠ 0 就把固定點推離 a"]
  ${OK}
  ${WARN}
  class MAP,GOOD ok
  class G2,BAD warn`

/** §3：把每個 q 拆成平均 + 零均值雜訊——訊號 ∝ N、雜訊 ∝ √N 的兩條平行累加路徑。 */
export const CHART_SIGNAL_VS_NOISE = `flowchart LR
  Q["每個樣本<br/>q_i = m + η_i"] --> MEAN["平均部分 m<br/>每次都一樣"]
  Q --> NOISE["零均值部分 η_i<br/>SD = √(1 − m²)、彼此獨立"]
  MEAN --> SUMM["Σ N 次<br/>同號，直接相加"]
  NOISE --> SUMN["Σ N 次<br/>有正有負，變異數相加"]
  SUMM -- "N·m（∝ N）" --> DIV["訊號 ÷ 雜訊"]
  SUMN -- "√(N·(1 − m²))（∝ √N）" --> DIV
  DIV --> SNR["SNR_stat = m·√N / √(1 − m²)<br/>∝ √N"]
  ${FOCUS}
  class SUMM,SUMN,SNR focus`

/** §3：sum（S_N）與 average（G）只差一個 ÷ N，SNR 相同（勘誤 E18）。 */
export const CHART_SUM_VS_AVG = `flowchart LR
  QS["N 個樣本<br/>q_1 … q_N"] --> SUM["總和 S_N = Σ q_i<br/>E = N·m<br/>SD = √(N·(1 − m²))"]
  SUM -- "÷ N" --> AVG["平均 G = S_N / N<br/>E = m<br/>SD = √((1 − m²)/N)"]
  SUM --> SNR["E ÷ SD 兩者相同<br/>m·√N / √(1 − m²)"]
  AVG --> SNR
  SUM -. "硬體累加器多半輸出 sum" .-> UPS["更新用 w + (μ/N)·S_N"]
  AVG -. "演算法多半寫 average" .-> UPA["更新用 w + μ·G"]
  ${FOCUS}
  class SUM,AVG focus`

/** §3.1：從 N 次比較到一個方向判斷（含 tie 分支）。 */
export const CHART_DECISION = `flowchart LR
  QS["N 次比較<br/>q_1 … q_N"] --> CNT["數 +1 的個數 K<br/>K ~ Bin(N, p)"]
  CNT --> SN["S_N = K − (N − K)<br/>= 2K − N"]
  SN --> DEC{"S_N 的正負號？"}
  DEC -- "S_N > 0（K > N/2）" --> POS["判 +1"]
  DEC -- "S_N 為負（K 不到 N/2）" --> NEG["判 −1"]
  DEC -- "S_N = 0（K = N/2，只有偶數 N）" --> TIE["tie：依 tie rule 處理"]
  ${FOCUS}
  ${WARN}
  class SN focus
  class TIE warn`

/** §3.2：同一個機率的兩種算法——精確 Binomial 加總 vs CLT（偶數 N 要連續性修正）。 */
export const CHART_EXACT_VS_CLT = `flowchart TB
  subgraph EX["精確：Binomial 逐項加總（F-05.6）"]
    direction LR
    E1["p、N"] --> E2["K ~ Bin(N, p)"]
    E2 --> E3["把 K > N/2 的機率逐項相加<br/>得到 P(S_N > 0)"]
    E2 --> E4["K = N/2 那一項<br/>就是 P(S_N = 0)（偶數 N）"]
  end
  subgraph CL["近似：CLT（F-05.7、F-05.8）"]
    direction LR
    C1["m、N"] --> C2["S_N ≈ Gaussian<br/>平均 N·m<br/>標準差 σ_S = √(N·(1 − m²))"]
    C2 --> C3{"N 奇數或偶數？"}
    C3 -- "奇數，或偶數但 tie 平分" --> C4["Φ(N·m/σ_S)"]
    C3 -- "偶數，嚴格的 S_N > 0" --> C5["Φ((N·m − 1)/σ_S)<br/>連續性修正"]
  end
  EX ~~~ CL
  ${FOCUS}
  ${WARN}
  class E3,C4 focus
  class C5 warn`

/** §3.3 之後：四種 tie rule 的決策樹（strict／half／sign(0) = +1／skip）。 */
export const CHART_TIE_RULES = `flowchart TB
  T0{"block 結束時 S_N = 0 ？<br/>（只有偶數 N 會發生）"}
  T0 -- "否" --> N0["照 sign(S_N) 判 +1 或 −1"]
  T0 -- "是" --> R0{"用哪一條 tie rule？"}
  R0 -- "strict" --> R1["一律算判錯<br/>評分用的最壞情況"]
  R0 -- "half" --> R2["擲一個隨機位元（LFSR）<br/>+1、−1 各一半"]
  R0 -- "sign(0) = +1" --> R3["一律判 +1<br/>累加器 MSB 當正負號"]
  R0 -- "skip" --> R4["這個 block 不更新<br/>d_k = 0"]
  R1 --> B1["s > 0 時等同硬體 sign(0) = −1<br/>判號式迴路偏移 s* ≈ +1/(N·K_q)"]
  R2 --> U0["對稱：平衡點無偏"]
  R4 --> U0
  R3 --> B3["判號式迴路偏移<br/>s* ≈ −1/(N·K_q)"]
  ${OK}
  ${WARN}
  class R2,R4,U0 ok
  class B1,B3 warn`

/** §3.4（Engineer）：只取 S_N 正負號的 block 迴路——tie rule 進入迴路的位置。 */
export const CHART_SIGN_BLOCK_LOOP = `flowchart LR
  A["理想係數 a"] -- "＋ a" --> S1(("＋"))
  S1 -- "＋ (s = a − w_k)" --> S2(("＋"))
  VN(["雜訊 v[n]"]) -- "＋ v[n]" --> S2
  S2 -- "e[n]" --> CMP["每個 sample n：<br/>sign<br/>q[n] = ±1"]
  CMP --> ACC["Σ N 次<br/>S_N"]
  ACC --> SGN["每個 block k：<br/>再取一次正負號<br/>d_k = sign(S_N)<br/>S_N = 0 時依 tie rule"]
  SGN -- "d_k ∈ {+1, −1, 0}" --> INT["累加器 μ/(z−1)<br/>w_(k+1) = w_k + μ·d_k"]
  INT -- "− w_k" --> S1
  ${WARN}
  class SGN warn`

/**
 * §3.5（Research）：恆等式 F-05.13 的圖解——偶數 N 的最後一個樣本 q_N 把 S_(N−1)（奇數）送到哪裡。
 * 進 tie 的兩條流量相等：(1 − p)·P(S_(N−1) = +1) = p·P(S_(N−1) = −1)（Binomial 相鄰兩項的比值是 p/(1 − p)），
 * 所以 tie 平分後 P(判 +1) = P(S_(N−1) ≥ 3) + P(S_(N−1) = +1) = P(S_(N−1) > 0)。
 */
export const CHART_LAST_SAMPLE = `flowchart LR
  A3["S_(N−1) ≥ 3"] -- "q_N 是 +1 或 −1 都一樣" --> P2["S_N ≥ 2"]
  A1["S_(N−1) = +1"] -- "q_N = +1：機率 p" --> P2
  A1 -- "q_N = −1：機率 1 − p" --> TIE{"S_N = 0<br/>tie"}
  M1["S_(N−1) = −1"] -- "q_N = +1：機率 p" --> TIE
  M1 -- "q_N = −1：機率 1 − p" --> N2["S_N ≤ −2"]
  M3["S_(N−1) ≤ −3"] -- "q_N 是 +1 或 −1 都一樣" --> N2
  P2 --> DP["判 +1"]
  TIE -- "擲硬幣：機率 ½" --> DP
  TIE -- "擲硬幣：機率 ½" --> DN["判 −1"]
  N2 --> DN
  TIE -.- BAL["進 tie 的兩條流量相等<br/>(1 − p)·P(S_(N−1) = +1) = p·P(S_(N−1) = −1)"]
  ${FOCUS}
  ${WARN}
  class BAL focus
  class TIE warn`

/** §4：設計流程「目標信心 → z → m → N」（數字是 95%、s = 1 fs、σ_v = 100 fs）。 */
export const CHART_DESIGN_FLOW = `flowchart LR
  PT["目標正確率 P_target<br/>例：95%"] --> Z["反查常態表<br/>z = Φ⁻¹(P_target) ≈ 1.645"]
  SS["誤差 s 與雜訊 σ_v<br/>例：1 fs、100 fs"] --> RR["r = s/σ_v = 0.01"]
  RR --> MM["m = erf(r/√2)<br/>≈ √(2/π)·r ≈ 0.00798"]
  Z --> NN["N = z²·(1 − m²)/m²<br/>≈ (z·σ_v/s)²·π/2 ≈ 42,500"]
  MM --> NN
  NN --> ODD["取奇數 N（沒有 tie）<br/>精確最小奇數 N = 42,499"]
  ODD --> TT["換成時間<br/>N / f_s"]
  ${FOCUS}
  class Z,MM,NN focus`

/** §4：π/2 的來源——直接平均類比誤差 vs 先過 1-bit comparator 再平均。 */
export const CHART_ANALOG_VS_1BIT = `flowchart TB
  subgraph AN["直接平均類比的 e（理想，硬體拿不到）"]
    direction LR
    A1["e_i = s + v_i"] --> A2["平均 N 次<br/>s +（v 的平均）"]
    A2 --> A3["SNR = s·√N / σ_v"]
    A3 --> A4["N = (z·σ_v/s)²"]
  end
  subgraph OB["先過 1-bit comparator 再平均（實際硬體）"]
    direction LR
    B1["e_i = s + v_i"] --> B2["sign<br/>q_i = ±1"]
    B2 --> B3["平均 N 次<br/>G = S_N / N"]
    B3 --> B4["SNR ≈ √(2/π)·s·√N / σ_v"]
    B4 --> B5["N ≈ (z·σ_v/s)²·π/2"]
  end
  AN ~~~ OB
  ${FOCUS}
  ${WARN}
  class B2 focus
  class B5 warn`

/** §5：小訊號等效模型——hard limiter 換成增益 K_q 加上零均值雜訊 η。 */
export const CHART_SMALL_SIGNAL = `flowchart TB
  subgraph NL["真實的 comparator（非線性，逐 sample）"]
    direction LR
    S1["誤差 s"] -- "＋ s" --> AD1(("＋"))
    V1(["雜訊 v"]) -- "＋ v" --> AD1
    AD1 -- "e = s + v" --> SG["sign（hard limiter）"]
    SG --> O1["輸出 q = ±1"]
  end
  subgraph LIN["小訊號等效模型（|s| ≪ σ_v 才成立）"]
    direction LR
    S2["誤差 s"] --> KQ["增益 × K_q<br/>K_q = √(2/π)/σ_v"]
    KQ -- "＋ K_q·s ≈ E[q]" --> AD2(("＋"))
    ETA(["零均值雜訊 η<br/>Var(η) = 1 − m² ≈ 1"]) -- "＋ η" --> AD2
    AD2 --> O2["輸出 q ≈ K_q·s + η"]
  end
  NL ~~~ LIN
  ${FOCUS}
  class SG,KQ focus`

/** §5：S 曲線的三個工作區（線性／壓縮／飽和）與各自能用的模型。 */
export const CHART_S_CURVE_REGIONS = `flowchart TB
  R0["先算標準化誤差<br/>r = |s − θ| / σ_v"] --> D1{"r ≤ 0.25 ？"}
  D1 -- "是" --> LIN["線性區<br/>E[q] ≈ K_q·(s − θ)，高估最多約 1%<br/>可以用 pole = 1 − μ·K_q 的線性分析"]
  D1 -- "否" --> D2{"r ≤ 1.5 ？"}
  D2 -- "是" --> CMPR["壓縮區<br/>局部斜率 = K_q·exp(−r²/2)<br/>線性式 K_q·(s − θ) 高估：r ≈ 0.55 時約 5%"]
  D2 -- "否" --> SAT["飽和區<br/>E[q] 貼近 ±1，斜率不到 0.33·K_q<br/>slew-limited：每次更新平均只走 μ"]
  ${OK}
  ${WARN}
  class LIN ok
  class SAT warn`

/** §6：Monte Carlo 與解析值怎麼交叉比對（Wilson 區間與精確 Binomial 接受域）。 */
export const CHART_MC_CHECK = `flowchart LR
  M1["Monte Carlo<br/>T 次獨立 trial<br/>每次累加 N 個 q"] --> M2["數判對的次數 k"]
  M2 --> M3["估計 P̂ = k / T<br/>誤差棒：Wilson 95% 區間"]
  A1["解析<br/>精確 Binomial 的判對機率 P"] --> A2["若 P 是對的<br/>k ~ Bin(T, P)"]
  A2 --> A3["接受域 [k_lo, k_hi]<br/>每側尾機率低於 Φ(−4)"]
  M2 --> CHK{"k 落在接受域內？"}
  A3 --> CHK
  CHK -- "是" --> PASS["ok：兩邊一致"]
  CHK -- "否" --> FAIL["mismatch：模型或程式有錯"]
  ${OK}
  ${WARN}
  class PASS ok
  class FAIL warn`

/** §7：逐 sample Sign-LMS 迴路（實際硬體做的事；x ≡ 1）。 */
export const CHART_SAMPLE_LOOP = `flowchart LR
  A["真值 a"] -- "＋ a" --> S1(("＋"))
  S1 -- "＋ (δ_n = a − w_n)" --> S2(("＋"))
  VN(["雜訊 v_n"]) -- "＋ v_n" --> S2
  TH["offset θ"] -- "− θ" --> S2
  S2 -- "δ_n + v_n − θ" --> SGN["sign<br/>1-bit comparator"]
  SGN -- "q_n = ±1" --> MU["× μ"]
  MU -- "＋ μ·q_n" --> S3(("＋"))
  S3 -- "w_(n+1)" --> D["z⁻¹"]
  D -- "＋ w_n" --> S3
  D -- "− w_n" --> S1
  ${FOCUS}
  class SGN focus`

/** §7：雜訊大小決定迴路的三種行為（沒有雜訊／適度／太多）。 */
export const CHART_DITHER_REGIMES = `flowchart TB
  Q0{"雜訊 σ_v 相對於步長 μ ？<br/>（取 offset θ = 0）"}
  Q0 -- "σ_v = 0" --> Z1["hard limiter<br/>E[q] 是階梯"]
  Z1 --> Z2["w 在 a 兩側來回跳<br/>period-2 limit cycle<br/>時間平均偏差最多 μ/2"]
  Q0 -- "σ_v ≈ μ 到幾倍 μ" --> M1["平滑的 S 曲線<br/>斜率 K_q"]
  M1 --> M2["在 a 附近隨機遊走<br/>時間平均幾乎無偏（dither）"]
  Q0 -- "σ_v ≫ μ" --> B1["S 曲線很平<br/>K_q = √(2/π)/σ_v 很小"]
  B1 --> B2["無偏，但又慢又吵<br/>τ ≈ 1/(μ·K_q) ∝ σ_v<br/>RMS ∝ √(μ·σ_v)"]
  ${OK}
  ${WARN}
  class M2 ok
  class Z2,B2 warn`

/** §7：線性化後的迴路——sign 換成 K_q 與量化雜訊 η_n（θ = 0）。 */
export const CHART_LINEARIZED_LOOP = `flowchart LR
  A["真值 a"] -- "＋ a" --> S1(("＋"))
  S1 -- "δ_n = a − w_n" --> KQ["× K_q<br/>（取代 sign）"]
  KQ -- "＋ K_q·δ_n" --> S2(("＋"))
  ETA(["量化雜訊 η_n<br/>零均值、Var ≈ 1"]) -- "＋ η_n" --> S2
  S2 -- "q_n ≈ K_q·δ_n + η_n" --> MU["× μ"]
  MU -- "＋ μ·q_n" --> S3(("＋"))
  S3 -- "w_(n+1)" --> D["z⁻¹"]
  D -- "＋ w_n" --> S3
  D -- "− w_n" --> S1
  ${FOCUS}
  class KQ focus`

/** §7（Engineer）：w 只落在格點上——birth–death Markov chain 與細緻平衡。 */
export const CHART_BIRTH_DEATH = `flowchart LR
  WM["格點 w_(k−1)<br/>= w_k − μ"] -- "往上：機率 u_(k−1)" --> W0["格點 w_k<br/>= w_0 + k·μ"]
  W0 -- "往下：機率 ū_k = 1 − u_k" --> WM
  W0 -- "往上：機率 u_k = Φ((a − θ − w_k)/σ_v)" --> WP["格點 w_(k+1)<br/>= w_k + μ"]
  WP -- "往下：機率 ū_(k+1)" --> W0
  W0 -.- BAL["細緻平衡（穩態）<br/>π_k·u_k = π_(k+1)·ū_(k+1)"]
  ${FOCUS}
  class W0 focus`

/** §8.1：該用哪一種方法算「判對機率」。 */
export const CHART_METHOD_CHOICE = `flowchart TB
  Q1{"雜訊樣本彼此獨立（iid）嗎？"}
  Q1 -- "否，有時間相關" --> MCS["Monte Carlo：sample-level<br/>逐個產生 v、比較、累加<br/>成本 O(N·T)"]
  Q1 -- "是" --> Q2{"要的是什麼？"}
  Q2 -- "驗收數字、門檻 N、偶數 N" --> EX["Exact binomial<br/>逐項加總，tie 單獨算"]
  Q2 -- "設計方程、手算" --> Q3{"N 奇數或偶數？"}
  Q3 -- "奇數，或 tie 平分" --> CLT["CLT<br/>Φ(m·√N / √(1 − m²))"]
  Q3 -- "偶數，確定性的 tie rule" --> CC["CLT + 連續性修正<br/>Φ((N·m ∓ 1)/σ_S)"]
  Q2 -- "用模擬交叉檢查、大 N 掃描" --> MCB["Monte Carlo：binomial<br/>直接抽 K ~ Bin(N, p)<br/>成本 O(T·log N)"]
  ${FOCUS}
  ${OK}
  class EX ok
  class CLT,CC focus`

/** §9：本章符號對應的硬體路徑（sample n 的 comparator 與 block k 的更新）。 */
export const CHART_HW_MAP = `flowchart TB
  DTC["DTC gain 誤差在 PD 處<br/>造成的時間誤差<br/>s = (a − w_k)·x[n]"] -- "＋ s" --> ADD(("＋"))
  JIT(["jitter、量化殘差<br/>v[n]，RMS σ_v"]) -- "＋ v[n]" --> ADD
  ADD -- "e[n] = s + v[n]" --> BB["BBPD（1-bit TDC）<br/>offset θ"]
  BB -- "位元 b[n] ∈ {0, 1}" --> MAP["映射 q = 2b − 1"]
  MAP -- "q[n] = ±1，每個 sample n" --> GM["GMAC 累加器<br/>S_N = Σ q[n]·x[n]<br/>N 個 sample"]
  GM -- "每個 block k" --> SCL["÷ N、× μ<br/>G_k = S_N / N"]
  SCL -- "μ·G_k" --> ACC["Gain accumulator<br/>w_(k+1) = w_k + μ·G_k"]
  ACC -- "w_k 回到 DTC" --> DTC
  X(["regressor x[n]<br/>本章固定 x ≡ 1"]) -. "乘在誤差上" .-> DTC
  X -. "乘在 q[n] 上" .-> GM
  ${FOCUS}
  class BB,MAP,GM focus`

/** §9：線性化的 block 校正迴路——K_q 在迴路裡的位置（block 速率 k；累加器寫成 1/(z−1)）。 */
export const CHART_BLOCK_LOOP = `flowchart LR
  A["理想係數 a"] -- "＋ a" --> S1(("＋"))
  S1 -- "δ_k = a − w_k" --> KQ["Comparator + 平均 N 次<br/>等效增益 × K_q"]
  KQ -- "＋ K_q·δ_k" --> S2(("＋"))
  ETA(["GMAC 雜訊 η_k<br/>零均值、Var ≈ 1/N"]) -- "＋ η_k" --> S2
  S2 -- "G_k ≈ K_q·δ_k + η_k" --> MU["× μ"]
  MU -- "μ·G_k" --> INT["累加器 1/(z−1)<br/>w_(k+1) = w_k + μ·G_k"]
  INT -- "− w_k" --> S1
  ${FOCUS}
  class KQ focus`

/** 綜合手算 HC-05.8 的計算順序。 */
export const CHART_HANDCALC_FLOW = `flowchart TB
  SV["量到的 σ_v"] --> KQ["① K_q = √(2/π)/σ_v"]
  KQ --> MMAX["② 穩定上限 μ_max = 2/K_q"]
  MUIN["選定的 μ"] --> G["③ loop gain g = μ·K_q"]
  KQ --> G
  G --> P["④ pole p_cal = 1 − g"]
  P --> TAU["⑤ τ = −1/ln|p_cal|（blocks）"]
  NF["N 與 f_s"] --> TBLK["⑥ 一個 block 的時間<br/>T_blk = N/f_s"]
  TAU --> TT["⑦ 收斂時間常數<br/>t_τ = τ·T_blk"]
  TBLK --> TT
  P --> SW["⑧ 係數雜訊<br/>σ_w = μ/√(N·(1 − p_cal²))"]
  NF --> SW
  MUIN --> SW
  ${FOCUS}
  class KQ,P,SW focus`

/** 延伸（Research）：AR(1) 相關雜訊的產生器，以及它讓 Var(S_N) 變大、等效樣本數變少。 */
export const CHART_AR1 = `flowchart TB
  ZI(["白雜訊 z_i ~ N(0, 1)"]) --> G1["× √(1 − ρ²)"]
  G1 -- "＋ √(1 − ρ²)·z_i" --> SUM(("＋"))
  SUM -- "v_(i+1)" --> D["延遲一個 sample<br/>z⁻¹"]
  D -- "v_i" --> RHO["× ρ"]
  RHO -- "＋ ρ·v_i" --> SUM
  D -- "v_i（s = θ 時就是 e_i − θ）" --> SG["sign"]
  SG -- "q_i = ±1，相鄰相關 (2/π)·arcsin(ρ)" --> AC["Σ N 次<br/>S_N"]
  AC --> VAR["ρ > 0 時 Var(S_N) 比 N 大<br/>N_eff = N² / Var(S_N) 比 N 小"]
  ${FOCUS}
  ${WARN}
  class RHO focus
  class VAR warn`

/* ------------------------------------------------------------------ */
/* 圖的登錄表：頁面順序 = 圖號                                            */
/* ------------------------------------------------------------------ */

export type DiagramKey =
  | 'l1Model'
  | 'roadmap'
  | 'firstCalc'
  | 'singleCompare'
  | 'qStats'
  | 'bitMapping'
  | 'signalVsNoise'
  | 'sumVsAvg'
  | 'decision'
  | 'exactVsClt'
  | 'tieRules'
  | 'signBlockLoop'
  | 'lastSample'
  | 'designFlow'
  | 'analogVs1bit'
  | 'smallSignal'
  | 'sCurveRegions'
  | 'mcCheck'
  | 'sampleLoop'
  | 'ditherRegimes'
  | 'linearizedLoop'
  | 'birthDeath'
  | 'methodChoice'
  | 'hwMap'
  | 'blockLoop'
  | 'handcalcFlow'
  | 'ar1'

export interface DiagramDef {
  key: DiagramKey
  /** 圖號（頁面上由上到下的順序），顯示成「圖 5-n」 */
  no: number
  /** 所在段落 */
  section: string
  /** Mermaid 原始碼 */
  chart: string
  /** 圖說：一句話說明要看什麼；數學寫成 `$...$`（<Mermaid caption> 用 KaTeX 渲染），不用 Unicode 拼 */
  caption: string
  /** 螢幕閱讀器用的文字替代說明（純文字，不含 `$`） */
  alt: string
  /** 這張圖是不是這次新增的（原有的圖只有 §0 的 L1 模型） */
  isNew: boolean
  /** 只在這個學習模式以上顯示（跟著所在段落的 ModeGate） */
  minMode?: 'engineer' | 'research'
}

const DEFS: Omit<DiagramDef, 'no'>[] = [
  {
    key: 'roadmap',
    section: '直覺',
    chart: CHART_ROADMAP,
    caption: '本章路線圖：藍色三格是三個核心結果（$p$ 與 $m$、訊號對雜訊、$K_q$），右邊是它們被用到的地方。',
    alt: '本章路線圖：從問題出發，經過單次比較、累加、所需樣本數、小訊號增益，到實驗、dither 與 block 校正迴路',
    isNew: true,
  },
  {
    key: 'l1Model',
    section: '§0',
    chart: CHART_L1_MODEL,
    caption: String.raw`本章的 L1 模型：$s$ 固定、$v$ 是 iid Gaussian、$x\equiv1$（regressor 的效果留到 Ch06–Ch11）。藍色是本章要分析的兩個方塊。`,
    alt: '固定誤差加雜訊經過 comparator 輸出正負一，累加後判斷方向',
    isNew: false,
  },
  {
    key: 'firstCalc',
    section: '§1',
    chart: CHART_FIRST_CALC,
    caption: String.raw`「先算一次」的順序：編號 ①–⑤ 是單一樣本；「訊號」「雜訊」兩格加入樣本數 $N$，相除得到 $\mathrm{SNR}_{\mathrm{stat}}$。`,
    alt: '手算流程：由 s 與 σ_v 算出 r、p、m、Var(q)，再配合 N 算出訊號、雜訊與統計 SNR',
    isNew: true,
  },
  {
    key: 'singleCompare',
    section: '§2',
    chart: CHART_SINGLE_COMPARE,
    caption: String.raw`單一次比較：注意第二個加法點是「減 $\theta$」，以及菱形兩個出口各自的機率。`,
    alt: '誤差 s 加雜訊 v 得到 e，減去門檻 θ 後判斷是否大於等於零，輸出 q 等於正一或負一',
    isNew: true,
  },
  {
    key: 'qStats',
    section: '§2',
    chart: CHART_Q_STATS,
    caption: String.raw`由 $p$ 到 $m$ 與 $\operatorname{Var}(q)$：「$+p$」與「$-(1-p)$」進加法點得到平均；兩條「$q^2=1$」的線合成 $E[q^2]=1$，再得到變異數。`,
    alt: 'q 以機率 p 取正一、機率一減 p 取負一；加權相加得到平均 m 等於 2p 減 1，平方的平均是 1，所以變異數是 1 減 m 平方',
    isNew: true,
  },
  {
    key: 'bitMapping',
    section: '§2',
    chart: CHART_BIT_MAPPING,
    caption: '綠色是正確路徑：先映射再進 GMAC；紅色是忘了映射，真值處的平均更新不是 0。',
    alt: 'comparator 的 0/1 位元 b 經 q 等於 2b 減 1 映射後進 GMAC，固定點正確；直接送 b 則在真值處有二分之一 E[x] 的偏移',
    isNew: true,
  },
  {
    key: 'signalVsNoise',
    section: '§3',
    chart: CHART_SIGNAL_VS_NOISE,
    caption: String.raw`兩條平行的累加路徑：「平均」那一路同號相加（$\propto N$），「零均值」那一路只累積到 $\sqrt N$。`,
    alt: '每個 q 拆成平均 m 與零均值雜訊；平均累加 N 次得到 N 乘 m，雜訊累加 N 次標準差只有根號 N，比值就是統計 SNR',
    isNew: true,
  },
  {
    key: 'sumVsAvg',
    section: '§3',
    chart: CHART_SUM_VS_AVG,
    caption: String.raw`sum 與 average 只差一個 $\div N$：平均與標準差一起縮小，SNR 不變，但 learning rate 要跟著換。`,
    alt: '總和 S_N 除以 N 得到平均 G；兩者的平均除以標準差相同；硬體用 sum 時更新量要除以 N',
    isNew: true,
  },
  {
    key: 'decision',
    section: '§3.1',
    chart: CHART_DECISION,
    caption: '從 $N$ 次比較到一個決策：看菱形的三個出口，紅色的 tie 分支只有偶數 $N$ 才會走到。',
    alt: 'N 次比較數出正一的個數 K，S_N 等於 2K 減 N；S_N 大於零判正一、小於零判負一、等於零是 tie',
    isNew: true,
  },
  {
    key: 'exactVsClt',
    section: '§3.2',
    chart: CHART_EXACT_VS_CLT,
    caption: '同一個機率的兩種算法：上框逐項加總（精確），下框用 Gaussian 近似；偶數 $N$ 而且要嚴格的 $S_N>0$ 時，走紅色的連續性修正。',
    alt: '精確做法把 Binomial 中 K 大於 N/2 的機率加總；CLT 做法把 S_N 當成 Gaussian，奇數 N 用 Φ(Nm/σ_S)，偶數 N 嚴格大於零用 Φ((Nm−1)/σ_S)',
    isNew: true,
  },
  {
    key: 'tieRules',
    section: '§3.3',
    chart: CHART_TIE_RULES,
    caption: '四種 tie rule 的決策樹：綠色兩條（half、skip）對稱無偏，紅色兩條在判號式迴路造成平衡點偏移。',
    alt: 'S_N 等於零時的四種處理：strict 算判錯、half 擲硬幣、sign(0)=+1 一律判正、skip 不更新；half 與 skip 無偏，另外兩種有平衡點偏移',
    isNew: true,
  },
  {
    key: 'signBlockLoop',
    section: '§3.4',
    chart: CHART_SIGN_BLOCK_LOOP,
    caption: '只取 $S_N$ 正負號的 block 迴路：紅色方塊是 tie rule 進入迴路的地方；回授到第一個加法點是負號（$s=a-w_k$）。',
    alt: '理想係數 a 減去 w_k 得到 s，加雜訊後經 sign、累加 N 次、再取一次正負號得到 d_k，乘 μ 後進累加器成為 w_(k+1)，下一個 block 以負號回授',
    isNew: true,
    minMode: 'engineer',
  },
  {
    key: 'lastSample',
    section: '§3.5',
    chart: CHART_LAST_SAMPLE,
    caption: String.raw`偶數 $N$ 的最後一個樣本 $q_N$：只有 $S_{N-1}=\pm1$ 兩格會被它推進 tie；進 tie 的兩條流量相等（藍色），所以把 tie 平分之後，結果和沒有這個樣本一樣。`,
    alt: '最後一個樣本把 S_(N−1) 的四種情況送到 S_N ≥ 2、S_N = 0 或 S_N ≤ −2；從 +1 掉進 tie 與從 −1 升進 tie 的機率相等，tie 平分後判 +1 的機率等於 S_(N−1) 大於零的機率',
    isNew: true,
    minMode: 'research',
  },
  {
    key: 'designFlow',
    section: '§4',
    chart: CHART_DESIGN_FLOW,
    caption: String.raw`設計流程：一條線由目標信心得到 $z$，另一條由 $s$、$\sigma_v$ 得到 $m$，兩者合成 $N$，最後取奇數並換成時間。`,
    alt: '設計流程：目標正確率查表得到 z；s 與 σ_v 得到 r 與 m；N 等於 z 平方乘 (1−m²) 除以 m 平方；取奇數 N 再換成時間',
    isNew: true,
  },
  {
    key: 'analogVs1bit',
    section: '§4',
    chart: CHART_ANALOG_VS_1BIT,
    caption: String.raw`兩條路只差藍色的 sign：它讓 SNR 乘上 $\sqrt{2/\pi}$，所以 $N$ 多出 $\pi/2$ 倍（紅色）。`,
    alt: '直接平均類比誤差需要 (zσ_v/s)² 個樣本；先經 1-bit comparator 再平均需要多 π/2 倍',
    isNew: true,
  },
  {
    key: 'smallSignal',
    section: '§5',
    chart: CHART_SMALL_SIGNAL,
    caption: String.raw`上框是真實的 comparator，下框是它的小訊號等效：sign 換成增益 $K_q$，再加一個零均值雜訊 $\eta$。`,
    alt: '真實模型：s 加 v 後取 sign 得到 q；等效模型：s 乘 K_q 再加零均值雜訊 η 得到 q',
    isNew: true,
  },
  {
    key: 'sCurveRegions',
    section: '§5',
    chart: CHART_S_CURVE_REGIONS,
    caption: 'S 曲線的三個工作區：先算 $r$，再照兩個菱形往下走；只有綠色的線性區可以直接用 $K_q$。',
    alt: '依標準化誤差 r 分成線性區（r 不超過 0.25）、壓縮區（r 不超過 1.5）與飽和區，各自適用的模型不同',
    isNew: true,
  },
  {
    key: 'mcCheck',
    section: '§6',
    chart: CHART_MC_CHECK,
    caption: '實驗的交叉比對：一路是 Monte Carlo 數出來的 $k$，另一路是解析值預測 $k$ 該落在哪裡，菱形判定兩者是否一致。',
    alt: 'Monte Carlo 得到判對次數 k 與 Wilson 區間；解析值給出 k 的接受域；k 在接受域內為 ok，否則 mismatch',
    isNew: true,
  },
  {
    key: 'sampleLoop',
    section: '§7',
    chart: CHART_SAMPLE_LOOP,
    caption: String.raw`逐 sample Sign-LMS 迴路：順著箭頭走一圈——比較（$a-w_n$）、加雜訊、取 sign、乘 $\mu$、累加、延遲回授。`,
    alt: '真值 a 減 w_n 得到 δ_n，加雜訊、減 offset 後取 sign 得到 q_n，乘 μ 累加成 w_(n+1)，經 z⁻¹ 回授',
    isNew: true,
  },
  {
    key: 'ditherRegimes',
    section: '§7',
    chart: CHART_DITHER_REGIMES,
    caption: '雜訊大小決定三種行為：只有適度的雜訊（綠色）又無偏又夠快；沒有雜訊與雜訊太多（紅色）各有代價。',
    alt: '沒有雜訊時 limit cycle 且有偏；適度雜訊時無偏；雜訊太大時收斂慢且 RMS 大',
    isNew: true,
  },
  {
    key: 'linearizedLoop',
    section: '§7',
    chart: CHART_LINEARIZED_LOOP,
    caption: String.raw`線性化的迴路：和前面的逐 sample 迴路圖比，「加 $v_n$、減 $\theta$、取 sign」這一段換成藍色的 $\times K_q$ 與雜訊注入點 $\eta_n$（取 $\theta=0$），其餘完全相同。`,
    alt: '線性化迴路：δ_n 乘 K_q 加量化雜訊 η_n 得到 q_n，乘 μ 累加，延遲回授，pole 為 1 減 μK_q',
    isNew: true,
  },
  {
    key: 'birthDeath',
    section: '§7',
    chart: CHART_BIRTH_DEATH,
    caption: '$w$ 只會在格點之間一步一步走：看相鄰兩格之間往上、往下兩條箭頭的機率，穩態時兩個方向的流量相等。',
    alt: '三個相鄰格點 w_(k−1)、w_k、w_(k+1)，往上機率 u、往下機率 ū，細緻平衡 π_k u_k 等於 π_(k+1) ū_(k+1)',
    isNew: true,
    minMode: 'engineer',
  },
  {
    key: 'methodChoice',
    section: '§8.1',
    chart: CHART_METHOD_CHOICE,
    caption: '該用哪種方法：從上往下回答三個問題（iid？要什麼？$N$ 奇偶？），葉子就是下表的每一列。',
    alt: '方法選擇：雜訊不獨立用 sample-level Monte Carlo；驗收用 exact binomial；手算用 CLT 或 CLT 加連續性修正；大 N 掃描用 binomial Monte Carlo',
    isNew: true,
  },
  {
    key: 'hwMap',
    section: '§9',
    chart: CHART_HW_MAP,
    caption: '本章符號在硬體上的位置：藍色三格是本章分析的部分；注意哪些線每個 sample $n$ 動一次、哪些每個 block $k$ 才動一次；虛線是 regressor $x[n]$。',
    alt: 'DTC gain 誤差加上 jitter 進入 BBPD，位元映射成 q，GMAC 累加 N 個樣本，除以 N、乘 μ、進入 gain accumulator，再回到 DTC；regressor x[n] 以虛線同時進入誤差與 GMAC',
    isNew: true,
  },
  {
    key: 'blockLoop',
    section: '§9',
    chart: CHART_BLOCK_LOOP,
    caption: String.raw`線性化的 block 校正迴路：$K_q$（藍色）就在迴路裡；繞一圈的增益是 $\mu K_q$，所以 pole 是 $1-\mu K_q$。`,
    alt: 'block 迴路：δ_k 乘 K_q 加雜訊 η_k 得到 G_k，乘 μ 進累加器得到 w_(k+1)，以負號回授到第一個加法點',
    isNew: true,
  },
  {
    key: 'handcalcFlow',
    section: '綜合手算',
    chart: CHART_HANDCALC_FLOW,
    caption: String.raw`綜合手算的順序 ①–⑧：藍色是三個關鍵中間量（$K_q$、pole、$\sigma_w$），照箭頭一格一格算。`,
    alt: '手算流程：σ_v 得 K_q，再得 μ_max 與 g，pole，時間常數，block 時間，收斂時間，最後是係數雜訊 σ_w',
    isNew: true,
  },
  {
    key: 'ar1',
    section: '延伸',
    chart: CHART_AR1,
    caption: String.raw`相關雜訊：上面的回授迴圈（$\times\rho$）讓相鄰的 $v$ 相似，於是相鄰的 $q$ 也相似，累加時雜訊不再只長 $\sqrt N$（紅色）。`,
    alt: 'AR(1) 產生器：白雜訊乘根號 1 減 ρ 平方，加上前一個樣本乘 ρ；經 sign 後累加，變異數大於 N，等效樣本數小於 N',
    isNew: true,
    minMode: 'research',
  },
]

/** 本章所有 Mermaid 圖（不含章首共用的系統地圖），依頁面順序編號。 */
export const CH05_DIAGRAMS: readonly DiagramDef[] = DEFS.map((d, i) => ({ ...d, no: i + 1 }))

export function diagramOf(key: DiagramKey): DiagramDef {
  const d = CH05_DIAGRAMS.find((x) => x.key === key)
  if (!d) throw new Error(`Ch05：找不到方塊圖 ${key}`)
  return d
}
