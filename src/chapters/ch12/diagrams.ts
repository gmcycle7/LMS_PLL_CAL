import type { SystemBlock } from '@/components'
import { CODE_TABLE_PRM, EX, SPUR, codeTable } from './common'

/**
 * 第 12 章的方塊圖（docs/teaching-style.md §8）。
 *  - 每張圖是一個具名的 Mermaid 原始碼字串；diagrams.test.tsx 用真正的 mermaid 逐張「畫出來」
 *    （@/components/mermaidTestUtils），並核對「頁面上畫出來的圖」與這裡的清單完全相同。
 *  - Mermaid 不渲染 KaTeX，所以節點文字用 Unicode 數學符號（μ、δ、σ、z⁻¹…）；含括號、等號、冒號的文字一律用雙引號包住。
 *  - 加法點寫成圓形節點 (("＋"))，每一條進入加法點的線都標上正負號：全形「＋」或減號「−」（U+2212），
 *    後面可以接這一路的訊號（例如 "＋ μ·G_k"、"− K·δw_k"）。不寫半形的 + 或 -：Mermaid 11 把標籤當 Markdown，
 *    單獨的 +／- 或以「+ 」「- 」開頭的標籤會被畫成「Unsupported markdown: list」。
 *  - 圖上的訊號名稱、正負號、箭頭方向與取樣率（sample 索引 n／block 索引 k）必須和正文公式一致：
 *    極性 δw = w − w*（勘誤 E33）、G_k ≈ −K·δw_k + η_k（F-12.1）、δw_{k+1} = p·δw_k + μ·η_k（F-12.2）、
 *    δt[n] = x[n]·δw[n]（F-12.11）、e_PD = −(θ_out + φ_dtc)（§12.7）。
 *  - 圖內的範例數字（0.399 fs、12.93 kHz、−93.80 dBc、三種 code 的 output／PD RMS…）不手打：
 *    由本章的標準例 EX / SPUR / codeTable()（common.tsx → calNoise.ts）代入。
 */

/**
 * 章首系統地圖要標成藍色的方塊：雜訊 → comparator → GMAC → ÷N、×μ → accumulator → gain correction → DTC，
 * 再到本章 §12.7 的兩個出口：phase detector（PD residual，H_PD）與 VCO 輸出（T）。
 */
export const CH12_SYSTEM_FOCUS: SystemBlock[] = ['noise', 'cmp', 'gmac', 'scale', 'acc', 'gc', 'dtc', 'pd', 'vco']

/** 深淺主題都看得清楚的三種標色：focus（本圖主角）、warn（要小心的地方）、ok（可以放心用的結果） */
const CLASSES = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** Hz → 'xx.xx'（kHz，兩位小數） */
const kHz = (hz: number) => (hz / 1e3).toFixed(2)
/** ASCII 負號換成數學負號（U+2212），與正文一致 */
const neg = (s: string) => s.replace(/-/g, '−')

const SIGMA_W = EX.sigmaW.toFixed(3) // 0.399
const SIGMA_V = String(EX.input.sigmaV) // 100

/* ───────────────────────── §12.0 地圖 ───────────────────────── */

/**
 * 雜訊傳遞鏈（方塊層級；本章的第一張地圖）。
 * code x[n] 進兩個地方：GMAC 的相關（G_k = (1/N)·Σ q·x，虛線）與 DTC 的乘法（δt = x·δw，F-12.11）。
 */
export const NOISE_CHAIN_CHART = `flowchart LR
  V["v[n]：comparator 前雜訊<br/>σ_v = ${SIGMA_V} fs"] --> Q["1-bit comparator<br/>q = sign(e)"]
  Q --> G["GMAC 平均<br/>G_k = (1/N)·Σ q·x<br/>雜訊 η_k"]
  G --> U["LMS 更新<br/>w ← w + μ·G"]
  U --> W["係數雜訊 δw_k<br/>（gain-equivalent）"]
  X["DSM code x[n]"] --> M(("×"))
  X -. "GMAC 也用同一個 code 做相關" .-> G
  W --> M
  M --> DT["δt[n] = x·δw<br/>DTC 多出的延遲"]
  DT --> PD["H_PD = 1/(1+L)<br/>PD residual：high-pass"]
  DT --> T["T = L/(1+L)<br/>PLL output：low-pass"]
  T --> OUT["φ_out = −2π·f_out·T·δt<br/>jitter skirt 或 spur"]
${CLASSES}
  class M focus`

/** 同一條鏈的數學模型：每一級的轉移函數與取樣率（sample 索引 n／block 索引 k） */
export const CHART_TF_CHAIN = `flowchart TB
  subgraph FS1["① sample rate f_s（索引 n）"]
    V["v[n]：comparator 前雜訊<br/>σ_v = ${SIGMA_V} fs"]
    CQ["1-bit comparator，再乘上 code<br/>q[n]·x[n]"]
  end
  subgraph FU["② block rate f_u = f_s/N（索引 k）"]
    AVG["GMAC：平均 N 筆<br/>剩下的起伏是 η_k"]
    H["LMS 閉迴路：η → δw<br/>H(z) = μ/(z − p)"]
  end
  subgraph FS2["③ 回到 sample rate f_s（索引 n）"]
    ZOH["ZOH：每個 δw_k 保持 N 個 sample"]
    X["code x[n]"]
    M(("×"))
    T["PLL 到輸出：T(f) = L/(1+L)<br/>low-pass"]
    OUT["φ_out = −2π·f_out·T·δt<br/>skirt 或 spur"]
  end
  V --> CQ
  CQ --> AVG
  AVG -- "η_k，σ_η² ≈ 1/N" --> H
  H -- "δw_k，σ_w = ${SIGMA_W} fs" --> ZOH
  ZOH -- "δw[n]" --> M
  X --> M
  M -- "δt[n] = x[n]·δw[n]" --> T
  T --> OUT
${CLASSES}
  class H,M focus`

/* ───────────────────────── §12.1–12.4 係數雜訊 ───────────────────────── */

/** 線性化 GMAC：一個框是真實電路（每個 sample），另一個框是等效模型（每個 block）；G_k ≈ −K·δw_k + η_k（F-12.1） */
export const CHART_GMAC_LINEAR = `flowchart TB
  subgraph REAL["實際電路：每個 sample 做一次（索引 n）"]
    A["a − w_k = −δw_k<br/>（固定點 w* = a 時）"] --> X1(("×"))
    XC["C·x[n]<br/>code 經有效路徑 C"] --> X1
    X1 -- "＋" --> S1(("＋"))
    V["雜訊 v[n]"] -- "＋" --> S1
    S1 -- "e[n]" --> SGN["sign：1-bit comparator"]
    SGN -- "q[n]" --> X2(("×"))
    XR["code x[n]"] --> X2
    X2 --> AVG["GMAC：平均 N 筆"]
  end
  subgraph LIN["等效模型：每個 block 一個值（索引 k）"]
    DW["δw_k = w_k − w*"] --> KB["× K<br/>K = K_q·C"]
    KB -- "−" --> S2(("＋"))
    ETA["η_k：零均值雜訊<br/>σ_η² ≈ 1/N"] -- "＋" --> S2
  end
  AVG -- "G_k（真實）" --> SAME["近最佳點、小訊號時<br/>兩個 G_k 的平均與變異數近似相同<br/>（F-12.1 的 ≈）"]
  S2 -- "G_k（模型）" --> SAME
${CLASSES}
  class KB,ETA focus`

/** 係數更新迴圈：累加器 δw_{k+1} = δw_k + μ·G_k，加上 GMAC 的恢復力 G_k = η_k − K·δw_k */
export const CHART_UPDATE_LOOP = `flowchart LR
  ETA["η_k<br/>GMAC 雜訊"] -- "＋" --> S1(("＋"))
  S1 -- "G_k" --> MU["× μ"]
  MU -- "＋ μ·G_k" --> S2(("＋"))
  S2 -- "δw_{k+1}" --> D["z⁻¹<br/>延遲一個 block"]
  D -- "δw_k" --> OUT["係數偏差 δw_k"]
  D -- "＋ δw_k（累加器記住舊值）" --> S2
  D --> KB["× K"]
  KB -- "− K·δw_k（恢復力）" --> S1
${CLASSES}
  class KB focus`

/** 一階係數雜訊迴圈：δw_{k+1} = p·δw_k + μ·η_k（F-12.2），以及同一件事寫成 H(z) = μ/(z − p)（F-12.3） */
export const CHART_COEF_LOOP = `flowchart TB
  subgraph LOOP["時域：一階迴圈（每個 block 轉一圈）"]
    direction LR
    ETA["η_k"] --> MU["× μ"]
    MU -- "＋ μ·η_k" --> S(("＋"))
    S -- "δw_{k+1}" --> D["z⁻¹"]
    D -- "δw_k" --> OUT["δw_k"]
    D --> P["× p<br/>p = 1 − μK"]
    P -- "＋ p·δw_k" --> S
  end
  subgraph TF["z 域：整個迴圈包成一個方塊"]
    direction LR
    E2["η"] --> HZ["H(z) = μ/(z − p)<br/>= μ·z⁻¹/(1 − p·z⁻¹)"]
    HZ --> W2["δw"]
  end
  LOOP -- "取 Z-transform" --> TF
${CLASSES}
  class P,HZ focus`

/** 白色 GMAC 雜訊通過 |H|²：S_w = |H|²·S_η（F-12.4），面積就是 σ_w²（F-12.5） */
export const CHART_PSD_FILTER = `flowchart LR
  IN["S_η(e^jΩ) = σ_η²<br/>白色：每個頻率一樣高"] --> H2["× |H(e^jΩ)|²<br/>= μ² / (1 − 2p·cosΩ + p²)"]
  H2 --> OUT["S_w(e^jΩ)<br/>p 在 0 與 1 之間時：低頻高、高頻低（low-pass）"]
  OUT --> AREA["面積：(1/2π)·∫ S_w dΩ<br/>Ω 由 −π 積到 π"]
  AREA --> VAR["σ_w² = μ²·σ_η² / (1 − p²)"]
  H2 -.- DC["Ω = 0（DC）的增益：μ²/(1 − p)²"]
  H2 -.- NY["Ω = π（Nyquist）的增益：μ²/(1 + p)²"]
${CLASSES}
  class H2 focus
  class VAR ok`

/** 變異數自己的一階迴圈：V_{k+1} = p²·V_k + μ²·σ_η²（§12.4 推導 A） */
export const CHART_VAR_LOOP = `flowchart LR
  Q["μ²·σ_η²<br/>每個 block 新注入的變異"] -- "＋" --> S(("＋"))
  S -- "V_{k+1}" --> D["z⁻¹"]
  D -- "V_k = E[δw_k²]" --> P2["× p²<br/>舊變異留下的比例"]
  P2 -- "＋" --> S
  D --> SS["穩態：V 不再變<br/>V = p²·V + μ²·σ_η²"]
  SS --> R["σ_w² = μ²·σ_η² / (1 − p²)"]
${CLASSES}
  class P2 focus
  class R ok`

/** （Research）colored GMAC noise：AR(1) 產生器 η_k = r·η_{k−1} + √(1 − r²)·σ_η·ε_k 串接同一個 LMS 閉迴路 */
export const CHART_COLORED_ETA = `flowchart LR
  EPS["ε_k<br/>白色，變異數 1"] --> SC["× √(1 − r²)·σ_η"]
  SC -- "＋" --> S1(("＋"))
  S1 -- "η_k" --> H["LMS 閉迴路<br/>H(z) = μ/(z − p)"]
  S1 --> D1["z⁻¹"]
  D1 -- "η_{k−1}" --> R["× r<br/>相鄰 block 的相關"]
  R -- "＋ r·η_{k−1}" --> S1
  H --> OUT["δw_k<br/>σ_w² = μ²·σ_η²/(1 − p²) × (1 + p·r)/(1 − p·r)"]
${CLASSES}
  class R focus
  class OUT ok`

/* ───────────────────────── §12.5 頻寬 ───────────────────────── */

/** 同一個濾波器的四種讀法：三個 −3 dB（exact 與兩個近似）＋ ENBW（T14 的四個數字） */
export const CHART_BW_READOUTS = `flowchart TB
  F["同一個濾波器 H(z) = μ/(z − p)<br/>|H|² = μ² / (1 − 2p·cosΩ + p²)"]
  F --> QA["讀法 A：功率掉到 DC 一半的頻率<br/>（corner：迴路追得多快）"]
  F --> QB["讀法 B：白雜訊通過後的總功率<br/>等於多寬的理想矩形"]
  QA --> EX["exact −3 dB<br/>(f_u/π)·arcsin((1 − p)/(2√p))<br/>= ${kHz(EX.f3dbExact)} kHz"]
  QA --> LN["−ln p 近似<br/>(−ln p)/(2π)·f_u<br/>= ${kHz(EX.f3dbNegLnP)} kHz"]
  QA --> OMP["(1 − p) 近似<br/>(1 − p)/(2π)·f_u<br/>= ${kHz(EX.f3dbOneMinusP)} kHz"]
  QB --> EN["ENBW<br/>(f_u/2)·(1 − p)/(1 + p)<br/>= ${kHz(EX.enbw)} kHz"]
  EN --> SIG["積分雜訊只能用這一個<br/>σ_w² = S_w^(1)(0)·ENBW"]
${CLASSES}
  class EX focus
  class EN,SIG ok`

/** 由 pole 判斷 H 的型態，決定 −3 dB 頻寬存不存在（E27；與 calNoise.ts 的 bwRegime() 相同的判斷順序） */
export const CHART_BW_REGIME = `flowchart TB
  P["pole p = 1 − μK"] --> D1{"|p| ≥ 1？<br/>（μK ≤ 0 或 μK ≥ 2）"}
  D1 -- "是" --> U["不穩定：沒有穩態<br/>不顯示任何頻寬"]
  D1 -- "否" --> D2{"p ≥ 0？<br/>（μK ≤ 1）"}
  D2 -- "否" --> HP["high-pass：雜訊集中在 f_u/2 附近<br/>low-pass 的頻寬定義不適用"]
  D2 -- "是" --> D3{"p = 0？"}
  D3 -- "是" --> FL["flat：係數雜訊是白色<br/>沒有 −3 dB 點"]
  D3 -- "否" --> D4{"p ≥ 3 − 2√2 ≈ 0.1716？<br/>（μK ≤ 0.8284）"}
  D4 -- "否" --> N3["low-pass，但衰減不足 3 dB<br/>−3 dB 點不存在"]
  D4 -- "是" --> OK["low-pass：exact −3 dB 存在<br/>Ω_3dB = 2·arcsin((1 − p)/(2√p))"]
${CLASSES}
  class OK ok
  class U,HP,FL,N3 warn`

/** σ_w² = 位準 × 寬度：位準 S_w^(1)(0) = π·σ_v²/(C²·f_s)（F-12.19），寬度 ENBW（F-12.9） */
export const CHART_LEVEL_WIDTH = `flowchart LR
  SV["comparator 輸入雜訊的單邊 PSD<br/>2·σ_v² / f_s"] --> ONEBIT["× π/2<br/>1-bit comparator 的代價"]
  ONEBIT --> DIVC["÷ C²<br/>有效 code 相關"]
  DIVC --> LVL["位準 S_w^(1)(0) = π·σ_v² / (C²·f_s)<br/>與 μ、N 無關"]
  MUK["μK 與 f_u = f_s/N"] --> W["寬度 ENBW = (f_u/2)·(1 − p)/(1 + p)<br/>p = 1 − μK：μ 越大越寬"]
  LVL --> X(("×"))
  W --> X
  X --> VAR["面積 σ_w² = 位準 × 寬度"]
${CLASSES}
  class LVL,W focus
  class VAR ok`

/* ───────────────────────── §12.6 乘上 code ───────────────────────── */

/** 係數是 gain：DTC 延遲 = w[n]·x[n]，多出來的部分是 δt[n] = x[n]·δw[n]（F-12.11） */
export const CHART_GAIN_MULT = `flowchart LR
  WS["w*：固定點<br/>（LMS 平均停下來的 gain）"] -- "＋" --> S(("＋"))
  DW["δw[n]：係數的抖動<br/>每 N 個 sample 才換一次值"] -- "＋" --> S
  S -- "w[n] = w* + δw[n]" --> M(("×"))
  X["code x[n]"] --> M
  M --> DLY["DTC 延遲 = w[n]·x[n]"]
  DLY --> ID["w*·x[n]<br/>本來就要的延遲"]
  DLY --> DT["δt[n] = x[n]·δw[n]<br/>多出來的延遲"]
${CLASSES}
  class M focus
  class DT warn`

/** 單頻 × 單頻：進去 f_x 與 f_w，出來 f_x − f_w 與 f_x + f_w，各 A·B/2（F-12.12；規格 §12.4 的例子） */
export const CHART_TONE_MIXER = `flowchart LR
  X["code x(t) = A·cos(2π·f_x·t)<br/>A = 1，f_x = 100 kHz"] --> M(("×"))
  W["係數擾動 δw(t) = B·cos(2π·f_w·t)<br/>B = 1 fs，f_w = 10 kHz"] --> M
  M --> LO["差頻 f_x − f_w = 90 kHz<br/>peak A·B/2 = 0.5 fs"]
  M --> HI["和頻 f_x + f_w = 110 kHz<br/>peak A·B/2 = 0.5 fs"]
  M -.- NO["乘積裡沒有 100 kHz<br/>也沒有 10 kHz"]
${CLASSES}
  class M focus
  class NO warn`

/** 同一個乘法的三種看法：時域相乘 → 自相關相乘 → PSD 卷積（F-12.13） */
export const CHART_MIX_DOMAINS = `flowchart TB
  subgraph TIME["時域：每個 sample 相乘"]
    direction LR
    X["x[n]"] --> M1(("×"))
    W["δw[n]"] --> M1
    M1 --> DT["δt[n]"]
  end
  subgraph CORR["自相關：也是相乘"]
    direction LR
    RX["R_x[ℓ]"] --> M2(("×"))
    RW["R_w[ℓ]"] --> M2
    M2 --> RT["R_δt[ℓ]"]
  end
  subgraph FREQ["頻域：卷積（一個頻譜拖著另一個掃過去）"]
    direction LR
    SX["S_x"] --> CV(("∗"))
    SW["S_w（sample-rate 版）"] --> CV
    CV -- "÷ 2π" --> ST["S_δt"]
  end
  TIME -- "取期望值（x 與 δw 獨立）" --> CORR
  CORR -- "DTFT" --> FREQ
${CLASSES}
  class M1,M2,CV focus`

/** 同一份係數雜訊乘上三種 code：留在低頻／搬到 ±f_x／攤平（dtPsdOneSided 的 dcTerm、toneTerm、whiteTerm） */
export const CHART_THREE_CODES = `flowchart LR
  SW["係數雜訊的 PSD S_w<br/>集中在低頻（corner 約 ${(EX.f3dbExact / 1e3).toFixed(0)} kHz）"] --> M(("×<br/>code"))
  M --> C1["常數 code<br/>x = m"]
  M --> C2["單頻 code<br/>x = A·cos(2π·f_x·t)"]
  M --> C3["白色 code<br/>x = ±1 隨機"]
  C1 --> R1["留在低頻<br/>S_δt = m²·S_w(f)"]
  C2 --> R2["搬到 f_x 兩側<br/>S_δt = (A²/4)·[S_w(f − f_x) + S_w(f + f_x)]"]
  C3 --> R3["攤平到 0 … f_s/2<br/>S_δt = σ_x²·σ_w²·(2/f_s)"]
${CLASSES}
  class M focus`

/**
 * code 有 DC 就有直通項：x = m + x̃ ⇒ δt = m·δw + x̃·δw（§12.6 的 callout、思考題 3）。
 * m·δw 留在低頻、落在 PLL 的 low-pass T 通帶內；x̃·δw 被搬到 x̃ 的頻率。code centering（m = 0）讓直通那一路消失。
 */
export const CHART_DC_FEEDTHROUGH = `flowchart LR
  X["code x[n] = m + x̃[n]"] --> DC["DC 成分 m<br/>code 的平均值"]
  X --> AC["零均值成分 x̃[n]<br/>例：DSM 的高頻抖動"]
  DW["係數雜訊 δw[n]<br/>功率集中在低頻"] --> M1(("×"))
  DC --> M1
  DW --> M2(("×"))
  AC --> M2
  M1 -- "＋ m·δw：頻譜留在低頻" --> S(("＋"))
  M2 -- "＋ x̃·δw：搬到 x̃ 的頻率" --> S
  S -- "δt[n]" --> T["PLL 到輸出<br/>|T|² low-pass"]
  T --> OUT["output jitter<br/>m·δw 幾乎全部通過<br/>x̃·δw 只剩 PLL 頻寬內的部分"]
  DC -.- FIX["code centering：讓 m = 0<br/>直通這一路就消失"]
${CLASSES}
  class DC,M1 warn
  class FIX ok`

/** block 邊界的時序：GMAC 累加 N 個 sample → LMS 更新一次 → DTC 保持同一個係數 N 個 sample（F-12.11 第二式） */
export const CHART_BLOCK_TIMING = `sequenceDiagram
  participant C as Comparator 與 GMAC（每個 sample）
  participant L as LMS 累加器（每個 block）
  participant D as DTC 的 gain（每個 sample）
  Note over C: block k：累加 N 個 sample 的 q[n]·x[n]
  C->>L: G_k（一個 block 只有一個值）
  Note over L: 更新一次：w_{k+1} = w_k + μ·G_k
  L->>D: 新係數，延遲 n_c 個 sample 後套用
  Note over D: 接下來 N 個 sample 都用同一個係數（ZOH）
  Note over C: block k+1：再累加 N 個 sample
  C->>L: G_{k+1}
  L->>D: 再換一次係數`

/** ZOH 拆成兩步：插零上取樣 ↑N，再通過長度 N 的 boxcar；線上是每一步之後的 PSD（F-12.14） */
export const CHART_ZOH_TWO_STEP = `flowchart LR
  A["δw_k<br/>block rate f_u<br/>PSD：S_w(e^jΩ)"] --> UP["步驟 1：插零上取樣 ↑N<br/>n = kN 時放 δw_k，其餘放 0"]
  UP -- "PSD：(1/N)·S_w(e^jNθ)" --> BOX["步驟 2：boxcar 濾波器 B<br/>連續 N 個 1 相加"]
  BOX -- "再乘 (sin(Nθ/2)/sin(θ/2))²" --> OUT["δw[n]<br/>sample rate f_s<br/>每個值保持 N 個 sample"]
  OUT --> M(("×"))
  X["code x[n]<br/>sample rate f_s"] --> M
  M --> DT["δt[n]"]
${CLASSES}
  class UP,BOX focus`

/** PSD 的換算：DTFT 形式 → 單邊 per-Hz（F-12.10）→ 輸出相位 PSD（F-12.16）→ ℒ(f) */
export const CHART_PSD_UNITS = `flowchart LR
  A["DTFT 形式 S(e^jΩ)<br/>雙邊<br/>變異數 σ² = (1/2π)·∫ S dΩ"] -- "× 2/f_r" --> B["單邊 per-Hz：S^(1)(f)<br/>變異數 σ² = ∫ S^(1) df，由 0 積到 f_r/2<br/>單位：fs²/Hz"]
  B -- "δt 的 PSD 才做這一步：× (2π·f_out)²·|T|²（fs 換成秒）" --> C["輸出相位 PSD：S_φ^(1)(f)<br/>單位：rad²/Hz"]
  C -- "÷ 2，再取 10·log10" --> D["ℒ(f)：單邊帶 phase noise<br/>單位：dBc/Hz"]
  A -.- NOTE["f_r 是這個序列自己的取樣率<br/>block 量用 f_u，sample 量用 f_s"]
${CLASSES}
  class B focus`

/* ───────────────────────── §12.7 PLL 的兩個出口 ───────────────────────── */

/** 一個 DTC 誤差、兩個轉移函數：往 PD 是 H_PD（high-pass），往輸出是 T（low-pass）（F-12.15–17） */
export const CHART_TWO_EXITS = `flowchart LR
  DT["同一個 DTC 誤差 δt(f)"] --> PD["往 PD：H_PD = 1/(1+L)<br/>high-pass"]
  DT --> T["往輸出：T = L/(1+L)<br/>low-pass"]
  PD --> EPD["PD residual<br/>e_PD = −2π·f_out·H_PD·δt<br/>PLL 頻寬外的成分才看得到"]
  T --> PO["輸出相位<br/>φ_out = −2π·f_out·T·δt<br/>PLL 頻寬內的成分才跟著走"]
  T --> J["輸出 jitter<br/>σ_t,out² = ∫ |T|²·S_δt df"]
  DT -.- SUM["H_PD + T = 1<br/>一邊看得到的，另一邊就看不到"]
${CLASSES}
  class PD,T focus`

/**
 * 最簡化的平均線性 PLL：DTC 誤差在 feedback 比較路徑注入，e_PD = −(θ_out + φ_dtc)、θ_out = L·e_PD。
 * 兩個綠色方塊是解出來的結果（§12.7 推導第 3、4 行）：θ_out = −T·φ_dtc、e_PD = −H_PD·φ_dtc。
 */
export const CHART_PLL_LOOP = `flowchart LR
  REF["reference 相位 = 0"] -- "＋" --> S(("＋"))
  S -- "e_PD" --> L["開迴路增益 L(s)<br/>PD × loop filter × VCO ÷ 除數"]
  L -- "θ_out" --> OUT["output 出口：PLL 輸出相位<br/>解出來 θ_out = −T·φ_dtc"]
  L -- "＋ θ_out" --> A(("＋"))
  DTC["DTC 誤差 δt"] --> K["× 2π·f_out<br/>時間換相位"]
  K -- "＋ φ_dtc" --> A
  A -- "−（θ_out + φ_dtc）" --> S
  S -.- PDN["PD 出口：PD 看到的誤差<br/>解出來 e_PD = −H_PD·φ_dtc"]
${CLASSES}
  class DTC,K warn
  class L focus
  class OUT,PDN ok`

/** 三種 code 表（§12.7）的數字：codeTable() = codeSpectraAnalytic(CODE_TABLE_PRM)，和頁面上的表格是同一份（有快取） */
const CT = codeTable().rows
const ctRow = (kind: 'const' | 'tone' | 'white') => {
  const r = CT.find((x) => x.kind === kind)
  if (!r) throw new Error(`第 12 章：三種 code 表缺少 ${kind}`)
  return r
}
const fs3 = (x: number) => x.toFixed(3)
const CT_BAND = `${CODE_TABLE_PRM.fL / 1e3} kHz 到 ${CODE_TABLE_PRM.fH / 1e6} MHz`

/**
 * 三種 code 把 δt 的功率放在不同頻率，所以兩個出口看到的不同（§12.7 的三種 code 表）。
 * 每一列：code → output（|T|² 加權）與 PD residual（|H_PD|² 加權）的 RMS；數字就是表格最後兩欄，藍色是看到比較多的出口。
 */
export const CHART_CODE_EXITS = `flowchart LR
  C1["常數 code<br/>δt 的功率在低頻<br/>總 RMS ${fs3(ctRow('const').totalRms)} fs"] --> O1["output：乘 |T|²<br/>${fs3(ctRow('const').outRms)} fs，幾乎全部通過"]
  C1 --> P1["PD residual：乘 |H_PD|²<br/>${fs3(ctRow('const').pdRms)} fs，剩下的多半是 ZOH step 的高頻能量"]
  C2["單頻 code，f_x = ${CODE_TABLE_PRM.fx / 1e3} kHz<br/>δt 的功率在 f_x 兩側<br/>總 RMS ${fs3(ctRow('tone').totalRms)} fs"] --> O2["output：乘 |T|²<br/>${fs3(ctRow('tone').outRms)} fs，全部通過<br/>還被 T 的 peaking 放大一點"]
  C2 --> P2["PD residual：乘 |H_PD|²<br/>${fs3(ctRow('tone').pdRms)} fs，同樣只剩高頻的一點"]
  C3["±1 白色 code<br/>δt 的功率攤平到 0 … f_s/2<br/>總 RMS ${fs3(ctRow('white').totalRms)} fs"] --> O3["output：乘 |T|²<br/>${fs3(ctRow('white').outRms)} fs，只剩 PLL 頻寬內的一小部分"]
  C3 --> P3["PD residual：乘 |H_PD|²<br/>${fs3(ctRow('white').pdRms)} fs，頻寬外的成分都通過"]
  O3 -.- NOTE["output 與 PD 的數字都只積分 ${CT_BAND}<br/>PLL 頻寬 ${CODE_TABLE_PRM.pll.f3dbT / 1e6} MHz"]
${CLASSES}
  class O1,O2,P3 focus`

/* ───────────────────────── §12.8 spur ───────────────────────── */

/** spur 的計算流程：A_t → |T|·A_t → β → β/2 → dBc（F-12.18；數字是 T15 的例子） */
export const CHART_SPUR_FLOW = `flowchart TB
  AB["係數 tone：B = 1 fs peak<br/>code tone：A = 1"] -- "相乘：A·B/2" --> AT["DTC 端的 timing tone<br/>A_t = ${SPUR.at} fs peak"]
  AT -- "× |T(f_m)| = 1" --> TO["輸出端的 timing tone<br/>|T|·A_t = ${SPUR.at} fs peak"]
  TO -- "× 2π·f_out，f_out = ${SPUR.fOut / 1e9} GHz（fs 換成秒）" --> BETA["調變指數 β = 2π·f_out·|T|·A_t<br/>= ${neg(SPUR.beta.toExponential(3))} rad"]
  BETA -- "÷ 2" --> HALF["sideband 對 carrier 的振幅比<br/>β/2 = ${neg((SPUR.beta / 2).toExponential(3))}"]
  HALF -- "20·log10" --> DBC["每一根 spur<br/>${neg(SPUR.dbc.toFixed(2))} dBc"]
  BETA --> SPEC["輸出頻譜：carrier 在 f_out<br/>兩根 spur 在 f_out ± f_m"]
${CLASSES}
  class BETA focus
  class DBC ok`

/** 隨機雜訊還是相干 spur：先判斷，再決定公式與單位（dBc/Hz 或 dBc） */
export const CHART_SKIRT_OR_SPUR = `flowchart TB
  START["FFT 上看到 δt 或輸出相位的頻譜"] --> Q1{"這個成分是相干（週期性）的嗎？<br/>把紀錄長度加倍，看每個 bin 的功率讀數"}
  Q1 -- "讀數不變 → 相干" --> TONE["離散的 tone<br/>例：週期性干擾、量化的 limit cycle（第 13 章）"]
  Q1 -- "每個 bin 掉約 3 dB → 隨機" --> RAND["連續頻譜<br/>例：LMS 的係數雜訊 δw"]
  TONE --> SP["輸出是 spur，單位 dBc<br/>20·log10(β/2)，F-12.18"]
  RAND --> SK["輸出是 noise skirt，單位 dBc/Hz<br/>ℒ(f) = 10·log10(S_φ^(1)/2)，F-12.10 與 F-12.16"]
  SK --> J["要一個數字：對頻率積分成 jitter<br/>F-12.17"]
${CLASSES}
  class SP warn
  class SK,J focus`

/* ───────────────────────── §12.9 比較與手算 ───────────────────────── */

/** 三個模擬引擎：只差在怎麼產生每個 block 的 G，之後的更新相同（linearStep／binomialStep／runBlockLms） */
export const CHART_ENGINES = `flowchart TB
  subgraph EA["(a) 線性遞迴"]
    A1["抽一個 η ~ N(0, 1/N)"] --> A2["G = −K·δw + η<br/>直線，不會飽和"]
  end
  subgraph EB["(b) Binomial Sign-LMS"]
    B1["抽一個 N₊ ~ Bin(N, Φ(−C·δw/σ_v))<br/>N 次判斷裡 q·x = +1 的次數"] --> B2["G = (2·N₊ − N)/N<br/>真的 1-bit 計數，|G| ≤ 1"]
  end
  subgraph EC["(c) 逐 sample"]
    C1["做 N 個 sample：<br/>產生 x、v，q = sign(e)"] --> C2["G = (1/N)·Σ q·x<br/>任何 code、路徑、延遲"]
  end
  A2 --> U["共同的更新：δw ← δw + μ·G"]
  B2 --> U
  C2 --> U
  U --> ST["跑很多個 block，統計 σ_w 與 95% CI"]
${CLASSES}
  class A2,B2,C2 focus`

const HAND_TONE = (EX.sigmaW / Math.SQRT2).toFixed(3) // A = 1
const HAND_WHITE = (EX.sigmaW * Math.sqrt((2 * CODE_TABLE_PRM.fBw) / EX.input.fs)).toFixed(4) // f_BW = 1 MHz

/** 綜合手算 HC-12.8 的計算順序（格內的數字是範例 μ = 10 fs、σ_v = 100 fs、N = 4096、f_s = 4 GHz、A = 1、f_BW = 1 MHz 的答案） */
export const CHART_HAND_FLOW = `flowchart TB
  IN["輸入：μ、σ_v、N、f_s、A、f_BW<br/>（identity path：C = 1）"] --> G["① g = μ·√(2/π)/σ_v<br/>= ${EX.g.toFixed(5)}"]
  G --> P["② p = 1 − g<br/>= ${EX.p.toFixed(5)}"]
  P --> V["③ 1 − p²，再乘上 N"]
  V --> SW["④ σ_w = μ / √(N·(1 − p²))<br/>= ${EX.sigmaW.toFixed(4)} fs"]
  SW --> C1["⑤ 常數 code<br/>δt_rms = σ_w = ${SIGMA_W} fs"]
  SW --> C2["⑥ 單頻 code<br/>δt_rms = (A/√2)·σ_w = ${HAND_TONE} fs"]
  SW --> C3["⑦ 白色 code，只算 0 … f_BW<br/>δt_rms = σ_w·√(2·f_BW/f_s) = ${HAND_WHITE} fs"]
${CLASSES}
  class SW focus`

/**
 * 連結到硬體：每個可以調的旋鈕動到雜訊鏈上的哪一格（§12.9「連結到硬體」的四個 callout）。
 * 實線是雜訊鏈（F-12.6 → F-12.5 → F-12.11 → F-12.17），虛線是旋鈕；藍色是硬體上可以調的東西。
 * 注意 σ_v 的兩個角色：1-bit 判斷之後 σ_η² ≈ 1/N 與 σ_v 無關（F-12.6），σ_v 是經由斜率 K = K_q·C = √(2/π)·C/σ_v
 * 進到 pole p = 1 − μK 才影響 σ_w（F-12.5 的第二種寫法 σ_w² = μ·σ_η²/(K·(2 − μK))）。
 */
export const CHART_HW_KNOBS = `flowchart LR
  V["comparator 前雜訊<br/>σ_v"] -- "1-bit 判斷，再平均 N 筆" --> ETA["GMAC 雜訊 η_k<br/>σ_η² ≈ 1/N（與 σ_v 無關）<br/>每 1/f_u 秒一個值"]
  ETA --> DW["係數雜訊 δw_k<br/>σ_w² = μ²·σ_η² / (1 − p²)"]
  DW --> DT["timing error<br/>δt[n] = x[n]·δw[n]"]
  DT --> OUT["output jitter 或 spur<br/>σ_t,out² = ∫ |T|²·S_δt df"]
  V -. "斜率 K = √(2/π)·C/σ_v，進到 p" .-> DW
  RN["REG_GMAC_N<br/>N"] -. "σ_η² 與 f_u = f_s/N" .-> ETA
  RMU["REG_GAIN_STEP<br/>μ"] -. "μ² 與 p = 1 − μK" .-> DW
  BITS["DTC gain register 位寬"] -. "LSB 遠大於 σ_w 時由量化主導（第 13 章）" .-> DW
  CODE["code 設計<br/>centering、白化"] -. "決定 δt 的頻譜落在哪裡" .-> DT
  BW["PLL 頻寬"] -. "決定 T 放過哪些頻率" .-> OUT
${CLASSES}
  class RN,RMU,BITS,CODE,BW focus`

/**
 * 本章全部的 Mermaid 圖（依頁面出現順序）；章首的系統地圖 <SystemMap> 另計。
 * mode = 'research' 的圖放在 ModeGate 內，只在 Research 模式顯示；其餘三種模式都看得到。
 */
export const CH12_CHARTS: { name: string; section: string; chart: string; mode?: 'research' }[] = [
  { name: 'NOISE_CHAIN_CHART', section: '§12.0', chart: NOISE_CHAIN_CHART },
  { name: 'CHART_TF_CHAIN', section: '§12.0', chart: CHART_TF_CHAIN },
  { name: 'CHART_GMAC_LINEAR', section: '§12.1', chart: CHART_GMAC_LINEAR },
  { name: 'CHART_UPDATE_LOOP', section: '§12.1', chart: CHART_UPDATE_LOOP },
  { name: 'CHART_COEF_LOOP', section: '§12.2', chart: CHART_COEF_LOOP },
  { name: 'CHART_PSD_FILTER', section: '§12.3', chart: CHART_PSD_FILTER },
  { name: 'CHART_VAR_LOOP', section: '§12.4', chart: CHART_VAR_LOOP },
  { name: 'CHART_COLORED_ETA', section: '§12.4', chart: CHART_COLORED_ETA, mode: 'research' },
  { name: 'CHART_BW_READOUTS', section: '§12.5', chart: CHART_BW_READOUTS },
  { name: 'CHART_BW_REGIME', section: '§12.5', chart: CHART_BW_REGIME },
  { name: 'CHART_LEVEL_WIDTH', section: '§12.5', chart: CHART_LEVEL_WIDTH },
  { name: 'CHART_GAIN_MULT', section: '§12.6', chart: CHART_GAIN_MULT },
  { name: 'CHART_TONE_MIXER', section: '§12.6', chart: CHART_TONE_MIXER },
  { name: 'CHART_MIX_DOMAINS', section: '§12.6', chart: CHART_MIX_DOMAINS },
  { name: 'CHART_THREE_CODES', section: '§12.6', chart: CHART_THREE_CODES },
  { name: 'CHART_DC_FEEDTHROUGH', section: '§12.6', chart: CHART_DC_FEEDTHROUGH },
  { name: 'CHART_BLOCK_TIMING', section: '§12.6', chart: CHART_BLOCK_TIMING },
  { name: 'CHART_ZOH_TWO_STEP', section: '§12.6', chart: CHART_ZOH_TWO_STEP },
  { name: 'CHART_PSD_UNITS', section: '§12.6', chart: CHART_PSD_UNITS },
  { name: 'CHART_TWO_EXITS', section: '§12.7', chart: CHART_TWO_EXITS },
  { name: 'CHART_PLL_LOOP', section: '§12.7', chart: CHART_PLL_LOOP },
  { name: 'CHART_CODE_EXITS', section: '§12.7', chart: CHART_CODE_EXITS },
  { name: 'CHART_SPUR_FLOW', section: '§12.8', chart: CHART_SPUR_FLOW },
  { name: 'CHART_SKIRT_OR_SPUR', section: '§12.8', chart: CHART_SKIRT_OR_SPUR },
  { name: 'CHART_ENGINES', section: '§12.9', chart: CHART_ENGINES },
  { name: 'CHART_HAND_FLOW', section: '§12.9', chart: CHART_HAND_FLOW },
  { name: 'CHART_HW_KNOBS', section: '§12.9', chart: CHART_HW_KNOBS },
]
