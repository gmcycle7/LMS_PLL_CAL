/**
 * 第 3 章的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則（diagrams.test.tsx 以真正的 mermaid parser 與 jsdom 渲染逐張檢查）：
 *  - 訊號名稱、正負號、箭頭方向與本章公式一致：δ[n] = a − w[n]（勘誤 E39）、e[n] = y − w[n]·x、
 *    w[n+1] = w[n] + μ·e[n]·x、δ[n+1] = (1 − μ·x[n]²)·δ[n] − μ·x[n]·v[n]。
 *  - 圖上的 δ[n]、x[n]、w[n] 就是公式裡的 δ_n、x_n、w_n（Mermaid 不渲染 KaTeX，下標改寫成方括號）；
 *    sample 索引用 n（或 block 內的 i）、block 索引用 k。
 *  - 加法點是圓圈「＋」、乘法點是圓圈「×」，極性標在進入加法點的那條線上；延遲是 z⁻¹。
 *  - 加號一律用全形「＋」：mermaid 11 會把節點／線上的文字當 Markdown 處理，單獨一個半形「+」（或以「1. 」「- 」開頭的文字）
 *    會被當成清單而顯示成「Unsupported markdown: list」。「<」的兩側一律留空白（否則「<p」會被當成 HTML 標籤）。
 *  - 單張不超過 14 個節點。
 */

import type { SystemBlock } from '@/components'

/**
 * 章首系統地圖（SystemMap）要標成藍色的方塊：regressor x[n]（它的功率與分布形狀決定界限）、
 * 步長 μ（÷N、×μ）與存放校正值 w 的 gain accumulator。comparator、PLL 動態、量化都還沒進來（L0）。
 */
export const SYSTEM_FOCUS: SystemBlock[] = ['res', 'scale', 'acc']

/**
 * 每張圖第一行的版面設定：節點間距與層距略小於 mermaid 預設（50 / 50），圖才不會過高過寬。
 * 這是 mermaid 的 init directive（以 %% 開頭，不支援的版本會把它當成註解略過，圖仍然畫得出來）。
 */
const INIT = '%%{init: {"flowchart": {"nodeSpacing": 34, "rankSpacing": 38}}}%%'

const CLASSDEFS = [
  '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff',
  '  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff',
  '  classDef good fill:#1d7a46,stroke:#0f4d2b,color:#ffffff',
  '  classDef mid fill:#8a5a00,stroke:#5c3c00,color:#ffffff',
].join('\n')

/** 圖 3-1｜同一個隨機因子 f[n]，三種平均法 → 三種收斂、三個界限（本章地圖） */
export const CHART_THREE_PATHS = `${INIT}
flowchart TB
  F["每一步的隨機因子<br/>f[n] = 1 − μ·x[n]²"]
  F --> A1["直接平均<br/>E[f] = 1 − μP_x"]
  F --> A2["先平方再平均<br/>E[f²] = g(μ)"]
  F --> A3["先取 ln|·| 再平均<br/>E ln|f| = λ(μ)"]
  A1 --> B1["判據：|1 − μP_x| < 1"]
  A2 --> B2["判據：g < 1"]
  A3 --> B3["判據：λ < 0"]
  B1 --> C1["Mean：E[δ[n]] → 0<br/>0 < μ < 2/P_x<br/>N(0,1)：μ < 2"]
  B2 --> C2["Mean-square：E[δ[n]²] → 0<br/>0 < μ < 2P_x/M_4<br/>N(0,1)：μ < 2/3"]
  B3 --> C3["Almost-sure：|δ[n]| → 0（機率 1）<br/>λ(μ) < 0（數值求根）<br/>N(0,1)：μ < 2.4212"]
${CLASSDEFS}
  class A1,A2,A3 focus`

/** 圖 3-2｜LMS 迴圈（固定 x）：預測 → 比較 → 修正 → 延遲一步 */
export const CHART_LMS_LOOP = `${INIT}
flowchart TB
  X["輸入 x<br/>（本節固定，例 x = 2）"] --> SYS["未知系統<br/>× a"]
  X --> MOD["你的模型<br/>× w[n]"]
  SYS -- "＋ y = a·x" --> CMP(("＋"))
  MOD -- "− w[n]·x" --> CMP
  CMP -- "e[n] = y − w[n]·x" --> GAIN["× μ·x"]
  X -. "同一個 x" .-> GAIN
  GAIN -- "修正量 μ·e[n]·x" --> ACC["累加器<br/>w[n+1] = w[n] + 修正量"]
  ACC -- "延遲一步：w[n]" --> MOD
${CLASSDEFS}
  class GAIN,ACC focus`

/** 圖 3-3｜誤差遞迴 δ[n+1] = (1 − μx²)·δ[n]：一階回授迴圈（上：展開；下：合併成增益 p） */
export const CHART_ERROR_RECURSION = `${INIT}
flowchart LR
  subgraph EXPAND["展開來看：每一步修掉 μx²·δ[n]"]
    direction LR
    Z1["z⁻¹<br/>延遲一步"] -- "＋ δ[n]" --> S1(("＋"))
    Z1 -- "δ[n]" --> G1["× μx²"]
    G1 -- "− μx²·δ[n]" --> S1
    S1 -- "δ[n+1]" --> Z1
  end
  subgraph MERGE["合併之後：繞一圈就乘一次 p"]
    direction LR
    Z2["z⁻¹<br/>延遲一步"] -- "δ[n]" --> P2["× p<br/>p = 1 − μx²"]
    P2 -- "δ[n+1] = p·δ[n]" --> Z2
  end
${CLASSDEFS}
  class G1,P2 focus`

/** 圖 3-4｜由 p = 1 − μx² 判斷行為：單調／一步到位／震盪／邊界／發散 */
export const CHART_POLE_REGIME = `${INIT}
flowchart LR
  P["算 p = 1 − μx²<br/>（x ≠ 0）"] --> Q{"|p| 和 1 比"}
  Q -- "|p| < 1" --> SG{"p 的正負"}
  Q -- "|p| = 1" --> BD{"p 是 ＋1<br/>還是 −1"}
  Q -- "|p| > 1" --> DV{"p 的正負"}
  SG -- "0 < p < 1" --> MONO["單調收斂：不變號、越來越小<br/>0 < μ < 1/x²"]
  SG -- "p = 0" --> DEAD["一步到位（deadbeat）<br/>μ = 1/x²"]
  SG -- "−1 < p < 0" --> OSC["震盪收斂：每步變號、越來越小<br/>1/x² < μ < 2/x²"]
  BD -- "p = −1" --> EDGE["邊界：|δ| 不變、每步變號<br/>μ = 2/x²"]
  BD -- "p = ＋1" --> STUCK["不動：w 永遠不更新<br/>μ = 0"]
  DV -- "p < −1" --> DIV1["發散：每步變號並放大<br/>μ > 2/x²"]
  DV -- "p > 1" --> DIV2["發散：同號放大<br/>μ < 0（更新方向反了）"]
${CLASSDEFS}
  class MONO,DEAD,OSC good
  class EDGE,STUCK mid
  class DIV1,DIV2 warn`

/** 圖 3-5｜手算流程：時間常數 τ 與收斂到 ε 的步數 n_ε */
export const CHART_TAU_FLOW = `${INIT}
flowchart TB
  A["已知 x、μ"] --> B["x²"]
  B --> C["p = 1 − μ·x²"]
  C --> D["|p|<br/>（要 0 < |p| < 1）"]
  D --> E["ln|p|<br/>（負數）"]
  E --> F["τ = −1 ÷ ln|p|<br/>單位：sample"]
  G["門檻 ε"] --> H["ln ε<br/>（負數）"]
  H --> I["n_ε = ⌈ ln ε ÷ ln|p| ⌉<br/>無條件進位"]
  E --> I
${CLASSDEFS}
  class F,I focus`

/** 圖 3-6｜隨機輸入：迴圈增益 f[n] = 1 − μ·x[n]² 每一步都不同（time-varying gain） */
export const CHART_RANDOM_GAIN = `${INIT}
flowchart LR
  X["x[n]<br/>每一步重新抽（iid）"] --> F["算這一步的增益<br/>f[n] = 1 − μ·x[n]²"]
  F -- "f[n]" --> M(("×"))
  Z["z⁻¹<br/>延遲一步"] -- "δ[n]<br/>只含過去的 x" --> M
  M -- "δ[n+1] = f[n]·δ[n]" --> Z
${CLASSDEFS}
  class F,M focus`

/** 圖 3-7｜取期望值：隨機增益的迴圈 → 固定增益 (1 − μP_x) 的迴圈 */
export const CHART_MEAN_PATH = `${INIT}
flowchart LR
  subgraph PATH["一條路徑：增益是隨機的"]
    direction LR
    Z1["z⁻¹"] -- "δ[n]" --> M1(("×"))
    F1["f[n] = 1 − μ·x[n]²<br/>每步不同"] --> M1
    M1 -- "δ[n+1]" --> Z1
  end
  subgraph MEAN["兩邊取 E[·]（x[n] 與 δ[n] 獨立，可以拆開）：增益變成固定的"]
    direction LR
    Z2["z⁻¹"] -- "E[δ[n]]" --> G2["× (1 − μP_x)<br/>P_x = E[x²]"]
    G2 -- "E[δ[n+1]]" --> Z2
  end
${CLASSDEFS}
  class F1 mid
  class G2 focus`

/** 圖 3-8｜MSD 每步因子 g(μ) 由兩個輸入統計量 P_x、M_4 組成，再和 1 比 */
export const CHART_G_BUILD = `${INIT}
flowchart TB
  X["x[n]（iid）"] --> PX["平方後取平均<br/>P_x = E[x²]"]
  X --> M4["四次方後取平均<br/>M_4 = E[x⁴]"]
  PX --> T1["× 2μ"]
  M4 --> T2["× μ²"]
  ONE["常數 1"] -- "＋ 1" --> S(("＋"))
  T1 -- "− 2μP_x" --> S
  T2 -- "＋ μ²M_4" --> S
  S -- "g(μ) = 1 − 2μP_x + μ²M_4" --> CHK{"g 小於 1 嗎"}
  CHK -- "是：0 < μ < 2P_x/M_4" --> YES["MSD 每步縮小<br/>E[δ[n]²] = gⁿ·δ[0]² → 0"]
  CHK -- "否" --> NO["g = 1：MSD 不變<br/>g > 1：MSD 發散"]
${CLASSDEFS}
  class S,CHK focus
  class YES good
  class NO warn`

/** 圖 3-9｜三種分布（功率都是 P_x = 1，mean 界都是 2）：κ 越大，MS 界越嚴 */
export const CHART_KURTOSIS_COMPARE = `${INIT}
flowchart LR
  subgraph PM["±1 code"]
    direction LR
    P1["|x| 恆為 1<br/>x² 完全不起伏"] --> P2["κ = 1"] --> P3["MS 界 = 2 ÷ 1 = 2<br/>和 mean 界相同"]
  end
  subgraph UN["Uniform U(−√3, √3)"]
    direction LR
    U1["|x| ≤ √3<br/>x² 有上限"] --> U2["κ = 9/5"] --> U3["MS 界 = 2 ÷ 1.8 = 10/9"]
  end
  subgraph GA["Gaussian N(0, 1)"]
    direction LR
    G1["|x| 沒有上限<br/>偶爾出現很大的 x²"] --> G2["κ = 3"] --> G3["MS 界 = 2 ÷ 3 = 2/3"]
  end
${CLASSDEFS}
  class P3 good
  class U3 mid
  class G3 warn`

/** 圖 3-10｜量測雜訊 v[n] 從哪裡進來：加在誤差 e[n] 上，再被 × μ·x[n] 帶進 δ */
export const CHART_NOISE_INJECTION = `${INIT}
flowchart LR
  Z["z⁻¹<br/>延遲一步"] -- "δ[n]" --> M1(("×"))
  X["x[n]"] --> M1
  M1 -- "＋ δ[n]·x[n]" --> A(("＋"))
  V(["雜訊 v[n]<br/>標準差 σ_v"]) -- "＋ v[n]" --> A
  A -- "e[n] = δ[n]·x[n] + v[n]" --> G["× μ·x[n]"]
  X -. "同一個 x[n]" .-> G
  G -- "− μ·x[n]·e[n]" --> S(("＋"))
  Z -- "＋ δ[n]" --> S
  S -- "δ[n+1]" --> Z
${CLASSDEFS}
  class V,A warn`

/** 圖 3-11｜MSD 的迴圈：每步乘 g，再加上雜訊注入 μ²·P_x·σ_v²；g < 1 時停在不動點 */
export const CHART_MSD_LOOP = `${INIT}
flowchart TB
  Z["z⁻¹<br/>延遲一步"] -- "E[δ[n]²]" --> G["× g(μ)<br/>g = 1 − 2μP_x + μ²M_4"]
  G -- "＋ g·E[δ[n]²]" --> S(("＋"))
  N(["雜訊每步注入<br/>μ²·P_x·σ_v²"]) -- "＋ 注入" --> S
  S -- "E[δ[n+1]²]" --> Z
  S -. "g < 1：流入 = 流出" .-> INF["穩態 MSD∞ = 注入 ÷ (1 − g)<br/>= μ·P_x·σ_v² ÷ (2P_x − μM_4)"]
  INF --> MSE["預測誤差的均方（MSE）<br/>E[e²] = P_x·MSD∞ + σ_v²"]
  S -. "g ≥ 1：只進不出" .-> DIV["沒有有限的穩態 MSD"]
${CLASSDEFS}
  class N warn
  class INF,MSE good
  class DIV warn`

/** 圖 3-12｜log 域：乘積變成累加器；平均斜率 λ 的正負決定典型路徑 */
export const CHART_LOG_SUM = `${INIT}
flowchart TB
  F["第 k 步的因子（k = 0 … n−1）<br/>f[k] = 1 − μ·x[k]²，x[k] 為 iid"] --> LN["取 ln|·|"]
  LN -- "Y[k] = ln|f[k]|" --> ACC["累加器 Σ<br/>把 n 步的 Y[k] 加起來"]
  ACC -- "ln(|δ[n]| ÷ |δ[0]|)" --> AVG["÷ n，n → ∞（大數法則）<br/>得到 λ = E ln|f|"]
  AVG --> D{"λ 的正負"}
  D -- "λ < 0" --> OK["幾乎每條路徑 |δ[n]| → 0<br/>典型大小 |δ[0]|·e^(n·λ)"]
  D -- "λ > 0" --> BAD["幾乎每條路徑發散"]
  D -- "λ = 0" --> EDGE["在 0 與 ∞ 之間來回<br/>不收斂（ln|f| 非常數時）"]
${CLASSDEFS}
  class LN,ACC focus
  class OK good
  class BAD warn
  class EDGE mid`

/** 圖 3-13｜三種收斂的推論關係：實線 = 一定成立；虛線 = 不保證（附反例） */
export const CHART_IMPLICATIONS = `${INIT}
flowchart LR
  MS["Mean-square 收斂<br/>g < 1"]
  MEAN["Mean 收斂<br/>|1 − μP_x| < 1"]
  AS["Almost-sure 收斂<br/>λ < 0"]
  MS == "一定成立<br/>g ≥ (1 − μP_x)²" ==> MEAN
  MS == "一定成立（Jensen）<br/>λ ≤ ½·ln g" ==> AS
  MEAN -. "不保證<br/>反例：稀疏 code，2/9 < μ < 20/9" .-> AS
  AS -. "不保證<br/>反例：Gaussian，2 < μ < 2.4212" .-> MEAN
${CLASSDEFS}
  class MS focus`

/** 圖 3-14｜標準 Gaussian：μ 軸上的四個區間，各有哪幾種收斂 */
export const CHART_MU_REGIONS = `${INIT}
flowchart TB
  R1["0 < μ < 2/3<br/>mean ✓、MS ✓、a.s. ✓"]
  R2["2/3 ≤ μ < 2<br/>mean ✓、MS ✗、a.s. ✓"]
  R3["2 ≤ μ < 2.4212<br/>mean ✗、MS ✗、a.s. ✓"]
  R4["μ ≥ 2.4212<br/>mean ✗、MS ✗、a.s. ✗"]
  R1 -- "μ = 2/3：g 到 1" --> R2
  R2 -- "μ = 2：|1 − μ| 到 1" --> R3
  R3 -- "μ = 2.4212：λ 到 0" --> R4
${CLASSDEFS}
  class R1 good
  class R2,R3 mid
  class R4 warn`

/**
 * 圖 3-15｜Heavy tail 的機制：log 域是常態 → 線性域是 lognormal；中位數（典型路徑）與均方根差 e^(n·(½·ln g − λ)) 倍。
 * 均方根 |δ[0]|·g^(n/2) 是精確式（F-03.6）；「常態／lognormal／中位數 ≈ e^(n·λ)」是 CLT 近似（F-03.18）。
 * 兩者的比值 ≥ 1 來自 Jensen：λ ≤ ½·ln g（F-03.10）。
 */
export const CHART_HEAVY_TAIL = `${INIT}
flowchart TB
  SUM["log 域：L[n] = ln(|δ[n]| ÷ |δ[0]|)<br/>n 個 iid 增量的總和（第 4 節的累加器）"]
  SUM -- "中央極限定理" --> NORM["L[n] 近似常態<br/>中心 n·λ、標準差 s·√n"]
  NORM -- "取 exp 回到線性域" --> LOGN["|δ[n]| 近似 lognormal<br/>大多數路徑擠在中位數附近，右尾很長"]
  LOGN --> MED["中位數（典型路徑）<br/>≈ |δ[0]|·e^(n·λ)"]
  LOGN --> RMS["均方根 √E[δ[n]²]<br/>= |δ[0]|·g^(n/2)（精確），由右尾主導"]
  MED --> GAP["兩者相差 e^(n·(½·ln g − λ)) 倍<br/>½·ln g − λ ≥ 0，隨 n 指數拉開"]
  RMS --> GAP
  LOGN --> MC["一次 Monte Carlo 只有 M 條路徑<br/>幾乎抽不到右尾"]
  MC --> LOW["δ[n]² 的樣本平均偏低<br/>樣本 SE 也偏小"]
${CLASSDEFS}
  class LOGN focus
  class MED good
  class RMS,GAP mid
  class LOW warn`

/** 圖 3-16｜手算流程：CLT 預測的收斂比例、分位帶與「九成路徑低於起點」的步數 */
export const CHART_CLT_FLOW = `${INIT}
flowchart TB
  IN["已知 λ、s、n、ε"] --> C1["中心 n·λ<br/>（中位數路徑）"]
  IN --> C2["寬度 s·√n"]
  IN --> C3["門檻 ln ε"]
  C1 --> Z["z = (ln ε − n·λ) ÷ (s·√n)<br/>門檻離中心幾個標準差"]
  C2 --> Z
  C3 --> Z
  Z --> PHI["查表 Φ(z)<br/>≈ 已低於門檻的路徑比例"]
  C1 --> BAND["10% 與 90% 分位<br/>n·λ ∓ 1.2816·s·√n"]
  C2 --> BAND
  BAND -- "令 90% 分位 < 0（λ < 0）" --> N90["九成路徑低於起點<br/>n > (1.2816·s ÷ λ)²"]
${CLASSDEFS}
  class Z,PHI focus`

/** 圖 3-17｜比較：天真 Monte Carlo（跑 n 步再平均 δ²）vs 單步 Monte Carlo（只估 g） */
export const CHART_NAIVE_VS_ONESTEP = `${INIT}
flowchart TB
  subgraph NAIVE["天真做法：走完 n 步再平均"]
    direction TB
    N1["M 條路徑各走 n 步"] --> N2["每條取 δ[n]²"] --> N3["樣本平均<br/>想估 E[δ[n]²]"] --> N4["真實 SE = √((hⁿ − g²ⁿ)·δ[0]⁴ ÷ M)<br/>h 遠大於 g² 時比答案還大，樣本 SE 卻看不到"]
  end
  subgraph ONE["本站做法：只抽一步，再用封閉式"]
    direction TB
    O1["抽 M 個 x"] --> O2["每個算 f² = (1 − μx²)²"] --> O3["樣本平均 ≈ g"] --> O4["SE = √((h − g²) ÷ M)<br/>有限且小，±4 SE 可信"] --> O5["E[δ[n]²] = gⁿ·δ[0]²"]
  end
${CLASSDEFS}
  class N4 warn
  class O4,O5 good`

/** 圖 3-18｜Stability Lab 的 Monte Carlo 流程：seed → M 條路徑 → 每步在 log 域累加 → 分位數、收斂比例、天真平均 */
export const CHART_MC_FLOW = `${INIT}
flowchart TB
  SEED["seed（固定就能重現）"] --> FORK["M 條路徑<br/>各有自己的亂數串流"]
  FORK --> DRAW["抽 x[n]（iid）"]
  DRAW --> STEP["走一步（無雜訊時在 log 域）<br/>ln|δ[n+1]| = ln|δ[n]| + ln|1 − μ·x[n]²|"]
  STEP -- "重複 N 步" --> DRAW
  STEP --> REC["記錄每條路徑的 log₁₀|δ[n]|"]
  REC --> QNT["每個 n 取分位數<br/>10%、50%（中位數）、90%"]
  REC --> FRAC["收斂比例<br/>|δ[n]| < 10⁻³·|δ[0]| 的路徑占幾成"]
  REC --> NAIVE["天真 MC<br/>直接平均 δ[n]²"]
${CLASSDEFS}
  class STEP,REC focus
  class QNT,FRAC good
  class NAIVE warn`

/** 圖 3-19｜Stability Lab 的比對：Monte Carlo 量到的量（左）對上不靠這批路徑的預測（右） */
export const CHART_MC_COMPARE = `${INIT}
flowchart LR
  A1["MC 中位數<br/>（50% 分位）"] -- "應該重合" --> B1["典型路徑<br/>ln(|δ[n]| ÷ |δ[0]|) = n·λ"]
  A2["MC 10%、90% 分位帶"] -- "應該貼齊" --> B2["CLT 預測的分位<br/>n·λ ∓ 1.2816·s·√n"]
  A3["MC 收斂比例"] -- "相差 0.05 以內" --> B3["CLT 預測的比例<br/>Φ((ln ε − n·λ) ÷ (s·√n))"]
  A4["單步 MC<br/>f、f²、ln|f| 的樣本平均"] -- "±4 SE 以內" --> B4["封閉式／數值積分<br/>1 − μP_x、g、λ"]
  A5["天真 MC<br/>δ[n]² 的樣本平均"] -- "heavy tail 時對不上（偏低）" --> B5["解析 MSD<br/>E[δ[n]²] = gⁿ·δ[0]²"]
${CLASSDEFS}
  class A1,A2,A3,A4 focus
  class B1,B2,B3,B4,B5 good
  class A5 warn`

/** 圖 3-20｜設計者的決策流程：我需要哪一個界限？ */
export const CHART_WHICH_BOUND = `${INIT}
flowchart TD
  Q0{"你要保證什麼"}
  Q0 -- "偏差（bias）會消失" --> M["Mean：|1 − μP_x| < 1<br/>μ < 2/P_x<br/>最弱：不保證 RMS 有限，也不保證路徑收斂"]
  Q0 -- "RMS 預算；有雜訊時穩態有限" --> MS["Mean-square：g < 1<br/>μ < 2P_x/M_4 = (2/P_x) ÷ κ"]
  Q0 -- "一次模擬／一顆晶片的軌跡會收斂" --> AS["Almost-sure：λ < 0<br/>不保證 RMS 有限；界限附近可能等不到"]
  MS --> ALL["另外兩種自動成立<br/>sign-off 寫這一個"]
  MS -- "GMAC 每個 block 先平均 N 筆" --> BLK["MS 界放寬成 2P_x ÷ (P_x² + (M_4 − P_x²)/N)<br/>N 大時趨近 mean 界 2/P_x"]
  BLK -- "硬體輸出總和（sum mode）" --> SUM["所有界限再 ÷ N"]
${CLASSDEFS}
  class MS,ALL focus
  class M,AS mid
  class SUM warn`

/**
 * 圖 3-21｜本章的 L0 模型畫回 PLL 硬體：哪一條線是 x、e、w，哪些方塊被理想化掉。
 * 對應的式子：e[i] = a·x[i] − w[k]·x[i] + v[i] = δ[k]·x[i] + v[i]；w[k+1] = w[k] + μ·(1/N)·Σ e[i]·x[i]
 * （N = 1 時就是第 1–7 節的 w[n+1] = w[n] + μ·e[n]·x[n]）。sample 索引 i、block 索引 k。
 */
export const CHART_PLL_MAPPING = `${INIT}
flowchart LR
  X["DSM／DTC code<br/>x[i]（sample rate）"]
  X --> A["要被抵消的時間誤差<br/>× a（未知）"]
  X --> W["DTC 實際補掉的量<br/>× w[k]（gain correction）"]
  A -- "＋ a·x[i]" --> PD(("＋"))
  W -- "− w[k]·x[i]" --> PD
  V(["PD／reference 雜訊<br/>v[i]"]) -- "＋ v[i]" --> PD
  PD -- "e[i] = δ[k]·x[i] + v[i]" --> IDEAL["本章的理想化（L0）<br/>error path = 1、沒有延遲<br/>comparator 換成線性（多 bit）"]
  IDEAL -- "e[i]" --> MUL(("×"))
  X -. "同一個 x[i]" .-> MUL
  MUL -- "e[i]·x[i]" --> GMAC["GMAC<br/>累加 N 筆"]
  GMAC -- "每 N 筆一次（block rate）" --> SCALE["÷ N、× μ"]
  SCALE --> ACC["Gain accumulator<br/>w[k+1] = w[k] + μ·(1/N)·Σ e[i]·x[i]"]
  ACC -- "w[k]（block 內不變）" --> W
${CLASSDEFS}
  class X,SCALE,ACC focus
  class IDEAL mid
  class V warn`

/** 圖 3-22｜GMAC 先累加 N 筆再更新：sample rate（i）與 block rate（k）的分工；sum mode 少了 ÷N */
export const CHART_BLOCK_GMAC = `${INIT}
flowchart TB
  subgraph FAST["sample rate：block 內的每一筆，i = 1 … N"]
    PROD["每一筆 x[i] 做一次相乘<br/>e[i]·x[i] = δ[k]·x[i]²"] --> ACC["GMAC 累加 N 筆<br/>Σ"]
  end
  subgraph SLOW["block rate：每 N 筆更新一次，索引 k"]
    SCALE["÷ N（average mode）、× μ<br/>S[k] = (1/N)·Σ x[i]²"] -- "− μ·S[k]·δ[k]" --> SUM(("＋"))
    Z["z⁻¹<br/>延遲一個 block"] -- "＋ δ[k]" --> SUM
    SUM -- "δ[k+1] = (1 − μ·S[k])·δ[k]" --> Z
  end
  ACC -- "δ[k]·Σ x[i]²" --> SCALE
  Z -. "δ[k]：block 內 w 不變" .-> PROD
  SCALE -. "省掉 ÷N（sum mode）" .-> BAD["等效步長 N·μ<br/>所有界限 ÷ N"]
${CLASSDEFS}
  class ACC,SCALE focus
  class BAD warn`

/** 圖 3-23｜綜合手算（HC-03.8）的計算順序 */
export const CHART_SYNTHESIS_FLOW = `${INIT}
flowchart TD
  S1["① 動差（只看 code）<br/>P_x = σ²、M_4 = 3·P_x²（Gaussian）"]
  S1 --> S2["② 三個界限<br/>μ_mean = 2 ÷ P_x<br/>μ_MS = 2P_x ÷ M_4<br/>μ_as ≈ 2.4212 ÷ P_x"]
  S1 --> S3["③ 你的 μ 的兩個因子<br/>1 − μP_x<br/>g = 1 − 2μP_x + μ²M_4"]
  S1 --> S4["④ GMAC 平均 N 筆<br/>E[S²] = P_x² + (M_4 − P_x²) ÷ N<br/>μ_MS,N = 2P_x ÷ E[S²]"]
  S2 --> S5{"⑤ 結論：μ 落在哪一區"}
  S3 --> S5
  S4 --> NOTE["N 越大，界限越接近 μ_mean<br/>sum mode 要再 ÷ N"]
  S5 -- "μ < μ_MS" --> A["三種都收斂<br/>可以寫 mean-square 穩定"]
  S5 -- "μ_MS ≤ μ < μ_as" --> B["MSD 不收斂、路徑仍收斂<br/>不能宣稱均方穩定"]
  S5 -- "μ ≥ μ_as" --> C["連典型路徑都不收斂"]
${CLASSDEFS}
  class A good
  class B,NOTE mid
  class C warn`

export interface DiagramEntry {
  /** 匯出名稱（測試訊息用） */
  name: string
  chart: string
  /** 這張圖要讓讀者看懂的概念（一句話） */
  shows: string
}

/** 本章全部方塊圖，依頁面上出現的順序排列（圖號 = 索引 + 1；不含章首的 SystemMap）。 */
export const DIAGRAMS: readonly DiagramEntry[] = [
  { name: 'CHART_THREE_PATHS', chart: CHART_THREE_PATHS, shows: '同一個隨機因子的三種平均法 → 三種收斂與三個界限' },
  { name: 'CHART_LMS_LOOP', chart: CHART_LMS_LOOP, shows: 'LMS 的預測 → 比較 → 修正迴圈（固定 x）' },
  { name: 'CHART_ERROR_RECURSION', chart: CHART_ERROR_RECURSION, shows: '誤差遞迴是增益 p = 1 − μx² 的一階回授迴圈' },
  { name: 'CHART_POLE_REGIME', chart: CHART_POLE_REGIME, shows: '由 p 判斷單調／一步到位／震盪／邊界／發散' },
  { name: 'CHART_TAU_FLOW', chart: CHART_TAU_FLOW, shows: '時間常數與收斂步數的手算順序' },
  { name: 'CHART_RANDOM_GAIN', chart: CHART_RANDOM_GAIN, shows: '隨機輸入使迴圈增益每一步都不同' },
  { name: 'CHART_MEAN_PATH', chart: CHART_MEAN_PATH, shows: '取期望值後，隨機增益變成固定增益 1 − μP_x' },
  { name: 'CHART_G_BUILD', chart: CHART_G_BUILD, shows: 'MSD 每步因子 g 由 P_x、M_4 組成並和 1 比較' },
  { name: 'CHART_KURTOSIS_COMPARE', chart: CHART_KURTOSIS_COMPARE, shows: '三種分布的 kurtosis 與 MS 界' },
  { name: 'CHART_NOISE_INJECTION', chart: CHART_NOISE_INJECTION, shows: '量測雜訊加在誤差上，再進入遞迴' },
  { name: 'CHART_MSD_LOOP', chart: CHART_MSD_LOOP, shows: 'MSD 迴圈：每步乘 g 再加雜訊注入；穩態 MSD 與 MSE' },
  { name: 'CHART_LOG_SUM', chart: CHART_LOG_SUM, shows: '取對數後乘積變成累加器；λ 的正負決定典型路徑' },
  { name: 'CHART_IMPLICATIONS', chart: CHART_IMPLICATIONS, shows: '三種收斂之間誰保證誰（含反例）' },
  { name: 'CHART_MU_REGIONS', chart: CHART_MU_REGIONS, shows: '標準 Gaussian 的 μ 軸四個區間' },
  { name: 'CHART_HEAVY_TAIL', chart: CHART_HEAVY_TAIL, shows: 'Heavy tail 的機制：log 域常態 → lognormal；中位數與均方根隨 n 指數拉開' },
  { name: 'CHART_CLT_FLOW', chart: CHART_CLT_FLOW, shows: 'CLT 預測（收斂比例、分位帶）的手算順序' },
  { name: 'CHART_NAIVE_VS_ONESTEP', chart: CHART_NAIVE_VS_ONESTEP, shows: '天真 Monte Carlo 與單步 Monte Carlo 的差別' },
  { name: 'CHART_MC_FLOW', chart: CHART_MC_FLOW, shows: 'Stability Lab 的 Monte Carlo 流程：多條路徑 → 分位數、收斂比例' },
  { name: 'CHART_MC_COMPARE', chart: CHART_MC_COMPARE, shows: 'Monte Carlo 量到的量各自和哪個解析／CLT 預測比對' },
  { name: 'CHART_WHICH_BOUND', chart: CHART_WHICH_BOUND, shows: '設計者該用哪一個界限的決策流程' },
  { name: 'CHART_PLL_MAPPING', chart: CHART_PLL_MAPPING, shows: '本章的 L0 模型畫回 PLL 硬體：x、e、w 在哪裡，哪些方塊被理想化' },
  { name: 'CHART_BLOCK_GMAC', chart: CHART_BLOCK_GMAC, shows: 'GMAC block 平均：sample rate 與 block rate、sum 與 average' },
  { name: 'CHART_SYNTHESIS_FLOW', chart: CHART_SYNTHESIS_FLOW, shows: '綜合手算 HC-03.8 的計算順序' },
]

/** 圖號（1 起算）；找不到時丟錯，讓測試抓到沒有登錄的圖。 */
export function figNo(chart: string): number {
  const i = DIAGRAMS.findIndex((d) => d.chart === chart)
  if (i < 0) throw new Error('ch03：這張圖沒有登錄在 DIAGRAMS')
  return i + 1
}

/** 內文引用用的圖號文字，例如「圖 3-10」。 */
export function figRef(chart: string): string {
  return `圖 3-${figNo(chart)}`
}
