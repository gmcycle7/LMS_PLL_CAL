import type { SystemBlock } from '@/components'

/**
 * Ch09 的方塊圖（docs/teaching-style.md §8）。
 *
 * - 每張圖是一個具名匯出的 Mermaid 原始碼字串；diagrams.test.tsx 以真正的 mermaid parser 逐一解析，
 *   並把圖上的數字（1.99、0.01、0.995、598、1.98…）與 pe.ts 的模型逐一比對。
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；圖說與正文的「圖上的 X 就是公式裡的 x」用 KaTeX。
 * - 符號約定與正文相同：δ = a − w（真值減係數）、n = sample、k = block、G_k 是 block「平均」、g = μK_q。
 * - 加法點是圓形節點 (("＋"))，每條進入的線都標上全形「＋」或減號「−」（U+2212）：不寫半形 + / -，Mermaid 11 會把它當成 Markdown 清單，
 *   畫出「Unsupported markdown: list」；延遲是 z⁻¹（本章的延遲都是「一個 block」）。
 * - 「<」後面一律留一個空白：HTML label 經 sanitize 時才不會被當成 tag（<br/> 除外）。
 * - 單張不超過 14 個節點；鏈比較長的圖用 TB（直向），手機上才不會被縮得太小。
 * - 版面的兩個陷阱（都用實際的 layout 驗過）：
 *   (1) 兩個互相交叉的回授迴圈會被 dagre 排成一條很長的鏈，所以耦合圖只畫「一個 block」（展開成 k → k+1，沒有迴圈）；
 *   (2) 兩個沒有連線的 subgraph 會被排成左右並列，上下並排要加一條看不見的連線（LIN ~~~ SGN）。
 */

/** 章首系統地圖要標成藍色的方塊：regressor x[n]、code alignment（filtered-x）、GMAC、gain accumulator w_k */
export const SYSTEM_FOCUS: SystemBlock[] = ['res', 'align', 'gmac', 'acc']

/** 深淺主題都讀得清楚的三種強調色：focus（本圖主角）、warn（出問題的地方）、ok（沒問題的地方） */
const CLASSES = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/**
 * 圖 9.1（數學模型）：開場的黑盒子。同一組 (u₁, u₂) 同時送進「真實系統 a」與「兩個旋鈕 w」，
 * 你只拿得到相減之後的一個數 e = y − ŷ = u₁(a₁ − w₁) + u₂(a₂ − w₂)（開場例子無雜訊）。
 */
export const CHART_TWO_KNOB = `flowchart LR
  U1(["u₁"])
  U2(["u₂"])
  subgraph BOX["黑盒子：真實系統（看不到裡面）"]
    A1["× a₁"] -- "＋" --> SY(("＋"))
    A2["× a₂"] -- "＋" --> SY
  end
  subgraph KNOB["你的兩個旋鈕（校正係數）"]
    W1["× w₁"] -- "＋" --> SH(("＋"))
    W2["× w₂"] -- "＋" --> SH
  end
  U1 --> A1
  U2 --> A2
  U1 --> W1
  U2 --> W2
  SY -- "＋ y" --> SE(("＋"))
  SH -- "− ŷ" --> SE
  SE --> E["e = y − ŷ<br/>= u₁(a₁ − w₁) + u₂(a₂ − w₂)<br/>你唯一看得到的量"]${CLASSES}
  class E focus`

/**
 * 圖 9.2（數學模型）：把 R 當成一台「向量進、向量出」的機器（ρ = 0.99）。
 * (1, 1) 與 (1, −1) 進去之後方向不變（eigenvector），只被縮放 1.99／0.01 倍；(1, 0) 的方向會改變。
 */
export const CHART_MATRIX_MACHINE = `flowchart LR
  I1(["輸入 (1, 1)<br/>兩個一起偏：共模"]) --> R1["× R<br/>ρ = 0.99"] --> O1["(1.99, 1.99) = 1.99 × (1, 1)<br/>方向不變：eigenvector，λ = 1.99"]
  I2(["輸入 (1, −1)<br/>一高一低：差模"]) --> R2["× R<br/>ρ = 0.99"] --> O2["(0.01, −0.01) = 0.01 × (1, −1)<br/>方向不變：eigenvector，λ = 0.01"]
  I3(["輸入 (1, 0)<br/>只有第 1 個偏"]) --> R3["× R<br/>ρ = 0.99"] --> O3["(1, 0.99)<br/>方向變了：不是 eigenvector"]${CLASSES}
  class O1 ok
  class O2 warn`

/**
 * 圖 9.3（數學模型，F-09.1）：多參數的觀測。M 個 regressor 各自乘上「自己的」參數誤差 δ_i = a_i − w_i，
 * 全部加在一起（再加雜訊）才是 comparator 看到的 e[n]——M 個參數共用這一個數。
 */
export const CHART_ERROR_MODEL = `flowchart LR
  U1(["u₁[n]"]) --> D1["× δ₁<br/>δ₁ = a₁ − w₁"]
  U2(["u₂[n]"]) --> D2["× δ₂<br/>δ₂ = a₂ − w₂"]
  UM(["u_M[n]"]) --> DM["× δ_M<br/>δ_M = a_M − w_M"]
  D1 -- "＋" --> S(("＋"))
  D2 -- "＋" --> S
  DM -- "＋" --> S
  V(["雜訊 v[n]"]) -- "＋" --> S
  S --> E["e[n] = u[n]ᵀδ_k + v[n]<br/>每個 sample n 只有一個數"]
  E --> CMP["comparator → GMAC<br/>M 個參數共用這一個 e[n]"]${CLASSES}
  class E focus`

/**
 * 圖 9.4（演算法迴圈，F-09.2／F-09.3）：多參數 block LMS。
 * sample rate（n）：e[n] → t[n] → t[n]·u[n] → 累加；block rate（k）：G_k → × μ → w_(k+1) = w_k + μG_k → δ_k = a − w_k。
 */
export const CHART_BLOCK_LOOP = `flowchart TB
  A(["真值 a（未知）"]) -- "＋" --> SD(("＋"))
  SD -- "δ_k = a − w_k" --> DOT["內積 u[n]ᵀδ_k"]
  U(["u[n]：M 個 regressor"]) --> DOT
  DOT -- "＋" --> SE(("＋"))
  V(["雜訊 v[n]"]) -- "＋" --> SE
  SE -- "e[n]（每個 sample）" --> DET["偵測器 t[n]<br/>linear：t = e ／ 1-bit：t = sign(e)"]
  DET --> COR["相關：t[n] × u[n]<br/>M 個參數各一個乘法器"]
  U --> COR
  COR --> AVG["GMAC：G_k = (1/N) Σ t[n]·u[n]<br/>N 個 sample 平均成一筆"]
  AVG -- "G_k（每個 block 一筆）" --> MU["× μ"]
  MU -- "＋" --> ACC(("＋"))
  ACC -- "w_(k+1)" --> Z["z⁻¹<br/>延遲一個 block"]
  Z -- "＋ w_k" --> ACC
  Z -- "− w_k" --> SD${CLASSES}
  class AVG focus`

/**
 * 圖 9.5（演算法迴圈）：兩個參數的平均遞迴 E[δ] ← (I − gR)E[δ]，R = [[1, ρ], [ρ, 1]]。
 * 紅色的兩條交叉線（係數 ρ）就是 R 的非對角元素：GMAC₁ 會讀到 ρ·δ₂，GMAC₂ 會讀到 ρ·δ₁。
 * 只畫一個 block（第 k 個 → 第 k+1 個）：輸出經 z⁻¹（一個 block）成為下一輪的輸入，圖上不畫成迴圈（版面陷阱 1）。
 * linkStyle 的編號依邊出現的順序：0 = δ₁→S1、1 = δ₂→S1（交叉）、2 = δ₁→S2（交叉）、3 = δ₂→S2。
 */
export const CHART_COUPLED_MEAN = `flowchart LR
  D1["E[δ₁]<br/>第 k 個 block"]
  D2["E[δ₂]<br/>第 k 個 block"]
  D1 -- "＋ 1·E[δ₁]" --> S1(("＋"))
  D2 -- "＋ ρ·E[δ₂]（交叉）" --> S1
  D1 -- "＋ ρ·E[δ₁]（交叉）" --> S2(("＋"))
  D2 -- "＋ 1·E[δ₂]" --> S2
  S1 -- "E[G₁] / K_q" --> M1["× g<br/>g = μK_q"]
  S2 -- "E[G₂] / K_q" --> M2["× g<br/>g = μK_q"]
  D1 -- "＋" --> A1(("＋"))
  M1 -- "−" --> A1
  D2 -- "＋" --> A2(("＋"))
  M2 -- "−" --> A2
  A1 --> N1["E[δ₁]<br/>第 k+1 個 block<br/>經 z⁻¹ 成為下一輪的輸入"]
  A2 --> N2["E[δ₂]<br/>第 k+1 個 block<br/>經 z⁻¹ 成為下一輪的輸入"]
  linkStyle 1,2 stroke:#d92d20,stroke-width:3px`

/**
 * 圖 9.6（數學模型，F-09.4）：eigen-mode 分解。旋轉 Qᵀ → 兩條互不相干的一階迴路（pole p_i = 1 − gλ_i）→ 轉回 Q。
 */
export const CHART_EIGEN_MODES = `flowchart LR
  D["E[δ_k]<br/>原座標 (δ₁, δ₂)"] --> QT["旋轉：c_k = Qᵀ·E[δ_k]<br/>投影到兩個 eigenvector"]
  QT -- "c₁：沿 v₁（共模）" --> P1["快模式：c₁ ← p₁·c₁<br/>p₁ = 1 − g·λ₁"]
  QT -- "c₂：沿 v₂（差模）" --> P2["慢模式：c₂ ← p₂·c₂<br/>p₂ = 1 − g·λ₂"]
  P1 --> Q["轉回：E[δ_(k+1)] = Q·c_(k+1)"]
  P2 --> Q
  Q -. "z⁻¹：下一個 block 再走一圈" .-> D${CLASSES}
  class P1 ok
  class P2 warn`

/**
 * 圖 9.7（手算流程，F-09.5／F-09.6）：ρ = 0.99、g = 0.5 的例子（T10／T11）：λ → pole → 穩定嗎 → k₉₅ = 598。
 */
export const CHART_K95_FLOW = `flowchart TB
  IN(["輸入：ρ = 0.99、g = μK_q = 0.5"]) --> LAM["① λ = 1 ± ρ<br/>λ_max = 1.99、λ_min = 0.01"]
  LAM --> KAP["κ = λ_max / λ_min = 199"]
  LAM --> PF["② 快 pole：p₁ = 1 − g·λ_max = 0.005"]
  LAM --> PS["② 慢 pole：p₂ = 1 − g·λ_min = 0.995"]
  PF --> STAB{"③ |p₁| 與 |p₂|<br/>都小於 1 嗎？"}
  PS --> STAB
  STAB -- "是：平均收斂" --> K95["④ k₉₅ = ⌈ln 0.05 ÷ ln 0.995⌉<br/>= ⌈597.65⌉ = 598 blocks"]
  STAB -- "否" --> BAD["g·λ_max ≥ 2：不收斂，把 g 調小<br/>λ_min = 0：p₂ = 1，永遠不動"]${CLASSES}
  class K95 focus
  class BAD warn`

/**
 * 圖 9.8（比較，F-09.7）：同一個 g 要同時服務快、慢兩個模式——快模式限制 g 的上限，慢模式決定速度。
 */
export const CHART_SCALAR_GAIN = `flowchart LR
  G(["同一個 g<br/>所有模式共用"]) --> F["快模式每個 block 的倍數 |1 − g·λ_max|<br/>g 到 2 / λ_max 就不再小於 1"]
  G --> S["慢模式每個 block 的倍數 |1 − g·λ_min|<br/>g 越大越小（越快），直到 g = 1 / λ_min"]
  F --> MAX["整體收斂率<br/>= 兩者之中較大的那個"]
  S --> MAX
  MAX --> OPT["兩者相等時最小<br/>g⋆ = 2 / (λ_max + λ_min)<br/>收斂率 = (κ − 1) / (κ + 1)"]${CLASSES}
  class F warn
  class OPT focus`

/**
 * 圖 9.9（比較，F-09.8，勘誤 E23）：同一個隨機更新，問「平均」與問「均方」得到不同的答案。
 */
export const CHART_MEAN_VS_MS = `flowchart LR
  UPD["同一個隨機更新（linear、無雜訊）<br/>δ_(k+1) = (I − g·R̂_k)·δ_k"] --> M["問法 1：平均 E[δ]<br/>只用到 E[R̂_k] = R"]
  UPD --> MS["問法 2：均方 P = E[δδᵀ]<br/>用到 E[R̂_k·P·R̂_k]（四階動差）"]
  M --> MR["mean：每個 block × p = 1 − g·λ<br/>慢 pole 0.995 → 598 blocks"]
  MS --> MSR["mean-square：每個 block × ρ_MS<br/>N = 1、Gaussian：1.98 > 1（發散）"]
  MS --> MSN["block 加長：ρ_MS → 最大的 p²<br/>N = 2 就回到 1 以下"]${CLASSES}
  class MR ok
  class MSR warn`

/**
 * 圖 9.10（狀態圖，F-09.8 的 ±1 code，勘誤 E23）：ρ = 0.99、g = 0.5、N = 1 的 sparse-flip code，
 * 差模座標 c₂ 的「個別軌跡」。u = (u₁, s·u₁)、u₁ = ±1 時 I − 0.5·uuᵀ 是投影：s = +1 消掉共模、完全不動差模；
 * s = −1 消掉差模。所以 c₂ 先停在初值（機率 (1+ρ)/2 = 0.995 每個 sample），第一個 flip（機率 (1−ρ)/2 = 0.005）之後精確為 0。
 * E[c₂,k] = 0.995^k·c₂,₀ 是 ensemble 平均，沒有任何一條軌跡長得像它。
 */
export const CHART_PM1_STAIRCASE = `stateDiagram-v2
  direction LR
  state "平台：差模 c₂ 還是初值 c₂,₀" as PLATEAU
  state "歸零：差模 c₂ = 0，之後不再變" as ZERO
  [*] --> PLATEAU
  PLATEAU --> PLATEAU : 沒有 flip（s = +1），機率 (1 + ρ)/2 = 0.995
  PLATEAU --> ZERO : 出現第一個 flip（s = −1），機率 (1 − ρ)/2 = 0.005
  ZERO --> ZERO : 之後每個 sample 都維持 0`

/**
 * 圖 9.11（比較，F-09.8 vs. F-09.18）：linear 的增量會被「目前的誤差」放大（四階動差項）；
 * 1-bit 的 q² = 1，增量有界，均方只多一個與 P 無關的常數注入 (μ²/N)·R。
 */
export const CHART_LINEAR_VS_SIGN = `flowchart TB
  subgraph LIN["linear（conventional LMS）：t = e"]
    direction LR
    L1["t·u = (uᵀδ + v)·u<br/>同一個 u 出現兩次"] --> L2["增量 ∝ 誤差大小 × u<br/>大樣本碰上大誤差會相乘"] --> L3["均方多出四階動差項<br/>(g²/N)·K(P)，隨 P 放大"]
  end
  subgraph SGN["1-bit（Sign-LMS）：t = q = sign(e)"]
    direction LR
    S1["t·u = q·u<br/>q² = 1"] --> S2["增量有界<br/>‖μ·G_k‖ ≤ μ·max‖u‖"] --> S3["均方只多一個常數注入<br/>(μ²/N)·R，與 P 無關"]
  end
  LIN ~~~ SGN${CLASSES}
  class L3 warn
  class S3 ok`

/**
 * 圖 9.12（路徑／流程，F-09.9／F-09.10）：PE 的滑動窗口檢查。
 * u[n] → 外積 → 窗口相加 S_k → ÷N₀ 得 R_k → eigenvalues → α、β 的不等式；每一個起點 k 都要合格。
 * 注意 λ(S_k) = N₀·λ(R_k)，所以判斷式寫成 N₀·λ_min(R_k) ≥ α。
 */
export const CHART_PE_WINDOW = `flowchart TB
  U(["u[n]：每個 sample 一筆"]) --> OP["外積 u[n]·u[n]ᵀ<br/>M × M 的表"]
  OP --> WIN["滑動窗口相加（N₀ 筆）<br/>S_k = Σ u[n]·u[n]ᵀ，n = k … k + N₀ − 1"]
  WIN --> NORM["÷ N₀<br/>R_k = S_k / N₀"]
  NORM --> EIG["eigenvalues<br/>λ_max(R_k)、λ_min(R_k)"]
  EIG --> KAP["κ(R_k) = λ_max / λ_min<br/>σ_i(U_k) = √(N₀·λ_i(R_k))"]
  EIG --> CHK{"N₀·λ_min(R_k) ≥ α 且<br/>N₀·λ_max(R_k) ≤ β ？"}
  CHK -- "是" --> NEXT["這個窗口合格<br/>k → k + 1，檢查下一個"]
  CHK -- "否" --> BAD["退化窗口：某個方向<br/>在這 N₀ 筆裡沒有能量"]
  NEXT -. "每一個 k 都要合格" .-> WIN${CLASSES}
  class CHK focus
  class BAD warn`

/**
 * 圖 9.13（數學模型，F-09.17）：一個 block = 一個 PE 窗口時，每個窗口至少把 ‖δ‖ 縮小同一個比例。
 */
export const CHART_PE_CONTRACTION = `flowchart LR
  D0["‖δ₀‖"] -- "窗口 0：× 至多 1 − μ·λ_min(R₀)" --> D1["‖δ₁‖"]
  D1 -- "窗口 1：× 至多 1 − μ·λ_min(R₁)" --> D2["‖δ₂‖"]
  D2 -- "… 每個窗口都一樣 …" --> DK["‖δ_K‖ ≤ (1 − μα/N₀)^K · ‖δ₀‖"]
  PE["PE 下界（每一個窗口）<br/>λ_min(R_k) ≥ α / N₀<br/>且 0 < μ ≤ 1 / λ_max(R_k)"] -.-> DK${CLASSES}
  class PE focus
  class DK ok`

/**
 * 圖 9.14（數學模型，F-09.11）：±1 sparse-flip code 的窗口為什麼會退化。u = (u₁, s·u₁)、u₁ = ±1 時每一筆 u·uᵀ = [[1, s], [s, 1]]，
 * 窗口內 s = +1 有 N₊ 個、s = −1 有 N₋ 個（N₊ + N₋ = N₀）⇒ S_k = [[N₀, N₊ − N₋], [N₊ − N₋, N₀]]，eigenvalues N₀ ± |N₊ − N₋|，
 * λ_min(S_k) = N₀ − |N₊ − N₋| = 2·min(N₊, N₋)。只有 N₊ = 0 或 N₋ = 0（s 全同號）才是 0，機率 ((1+ρ)/2)^N₀ + ((1−ρ)/2)^N₀。
 */
export const CHART_PM1_DEGENERATE = `flowchart TB
  CODE(["±1 sparse-flip code<br/>u₁[n] = ±1，u₂[n] = s[n]·u₁[n]<br/>P(s = +1) = (1 + ρ)/2，各 sample 獨立"])
  CODE --> WIN["取一個長度 N₀ 的窗口<br/>s = +1 有 N₊ 個、s = −1 有 N₋ 個（N₊ + N₋ = N₀）"]
  WIN --> SK["S_k = [[N₀, N₊ − N₋], [N₊ − N₋, N₀]]<br/>λ(S_k) = N₀ ± |N₊ − N₋|"]
  SK --> ALL{"N₊ = 0 或 N₋ = 0 ？<br/>（窗口內 s 全同號）"}
  ALL -- "是" --> BAD["退化窗口：λ_min(S_k) = 0<br/>機率 ((1 + ρ)/2)^N₀ + ((1 − ρ)/2)^N₀"]
  ALL -- "否" --> GOOD["λ_min(S_k) = 2·min(N₊, N₋) ≥ 2<br/>兩個方向都有能量"]
  BAD -. "代入 ρ = 0.99、N₀ = 100" .-> NUM["退化比例 ≈ 0.606<br/>長期平均卻是 λ_min(R) = 1 − ρ = 0.01 > 0"]${CLASSES}
  class BAD warn
  class GOOD ok`

/**
 * 圖 9.15（比較，F-09.13）：gauge freedom。同一筆 one-hot 輸入送進兩組參數（b 加 c、每個 a_i 減 c），
 * 輸出相減是 c·(Σx_i − 1) = 0。
 */
export const CHART_GAUGE_SHIFT = `flowchart LR
  X(["同一筆輸入 x̃[n] = (1, x₀, x₁, x₂, x₃)<br/>one-hot：x₀ + x₁ + x₂ + x₃ = 1"])
  subgraph T1["第一組參數：b、a₀ … a₃"]
    B1["b × 1"] -- "＋" --> S1(("＋"))
    A1["Σ a_i·x_i[n]<br/>= 被選到的那個 a_i"] -- "＋" --> S1
  end
  subgraph T2["第二組參數：b 加 c、每個 a_i 減 c"]
    B2["(b + c) × 1"] -- "＋" --> S2(("＋"))
    A2["Σ (a_i − c)·x_i[n]<br/>= 被選到的 a_i，再減 c"] -- "＋" --> S2
  end
  X --> B1
  X --> A1
  X --> B2
  X --> A2
  S1 -- "＋ y" --> D(("＋"))
  S2 -- "− y′" --> D
  D --> Z["y − y′ = c·(Σx_i − 1) = 0<br/>每一個 n 都是 0"]${CLASSES}
  class Z focus`

/**
 * 圖 9.16（路徑／轉移函數，F-09.15，勘誤 E04）：PLL 的 DC null。
 * b 的 regressor 是常數 1（純 DC），經 H_PD(1) = 0 之後 → 0；one-hot 的 DC 部分也被濾掉，所以 Σũ_i = ũ_b → 0。
 */
export const CHART_DC_NULL = `flowchart LR
  ONE(["b 的 regressor：常數 1<br/>純 DC"]) --> H1["H_PD(z) = 1 / (1 + L(z))<br/>H_PD(1) = 0"]
  XI(["one-hot x_i[n]<br/>= 平均 1/4（DC）+ 變動部分"]) --> H2["同一個 H_PD(z)<br/>H_PD(1) = 0"]
  H1 --> UB["ũ_b[n] → 0<br/>穩態完全消失"]
  H2 --> UI["ũ_i[n]：DC 被濾掉<br/>ũ₀ + ũ₁ + ũ₂ + ũ₃ = ũ_b → 0"]
  UB --> N1["null 方向 1：只動 b<br/>(1, 0, 0, 0, 0)"]
  UI --> N2["null 方向 2：a_i 一起動（共模）<br/>(0, 1, 1, 1, 1)"]
  UI --> OKN["仍看得到：相位之間的差<br/>a_i − a_j（3 個獨立組合）"]${CLASSES}
  class H1,H2 focus
  class N1,N2 warn
  class OKN ok`

/**
 * 圖 9.17（路徑／轉移函數，F-09.19）：u-domain 的 block LMS（與 pe.ts 的 runGaugeLms 相同的訊號流）。
 * d[n] = x̃ᵀ(θ − w_k) → H_PD → + v → e_PD → GMAC（regressor r 可選 raw x̃ 或 filtered ũ）→ w_(k+1) = w_k + μG_k。
 */
export const CHART_GAUGE_LMS_PATH = `flowchart TB
  X(["x̃[n] = (1, x₀, x₁, x₂, x₃)"]) --> DOT["DTC 端的誤差<br/>d[n] = x̃[n]ᵀ(θ − w_k)"]
  DOT --> H["主 PLL 的 error path：H_PD(z)<br/>H_PD(1) = 0，DC 被吃掉"]
  H -- "＋" --> S(("＋"))
  V(["雜訊 v[n]"]) -- "＋" --> S
  S -- "e_PD[n]" --> G["GMAC：G_k = (1/N) Σ e_PD[n]·r[n]"]
  X -- "raw：r = x̃（b 的 r 是常數 1）" --> G
  X --> HF["同一個 H_PD(z)<br/>filtered-x"]
  HF -- "filtered：r = ũ（b 的 r → 0）" --> G
  G -- "G_k（每個 block 一筆）" --> ACC["累加器<br/>w_(k+1) = w_k + μ·G_k"]
  ACC -. "w_k：register，每個 block 才更新一次" .-> DOT${CLASSES}
  class H focus
  class G warn`

/**
 * 圖 9.18（比較，F-09.19）：有恢復力（λ > 0：每個 block 乘上 1 − gλ）與沒有恢復力（λ = 0：純積分器）。
 * 同樣的雜訊注入，前者有界、後者 random walk（std ∝ √K）。
 */
export const CHART_RESTORING_FORCE = `flowchart TB
  subgraph IDF["可辨識的方向（λ > 0）：有恢復力"]
    direction LR
    N1(["每個 block 的雜訊注入"]) -- "＋" --> A1(("＋"))
    A1 --> Z1["z⁻¹<br/>誤差分量 c_k"]
    Z1 --> F1["× (1 − g·λ)<br/>絕對值小於 1"]
    F1 -- "＋" --> A1
    Z1 --> R1["有界：一直被拉回 0 附近"]
  end
  subgraph NUL["null 方向（λ = 0，例如 w_b）：沒有恢復力"]
    direction LR
    N2(["每個 block 的雜訊注入 μ·η_k"]) -- "＋" --> A2(("＋"))
    A2 --> Z2["z⁻¹<br/>w_b"]
    Z2 --> F2["× 1<br/>pole = 1"]
    F2 -- "＋" --> A2
    Z2 --> R2["random walk：std ∝ √K<br/>沒有上限"]
  end
  IDF ~~~ NUL${CLASSES}
  class F1,R1 ok
  class F2,R2 warn`

/**
 * 圖 9.19（決策樹）：「這個參數方向學得到嗎？」——依序檢查結構性 null（gauge）、每個窗口的 PE、κ。
 */
export const CHART_IDENTIFIABLE_TREE = `flowchart TD
  START(["挑一個參數方向 v<br/>單一參數，或共模、差模這類組合"]) --> Q1{"① PD 端的 regressor 在 v 上<br/>有投影嗎？（vᵀu[n] 不恆為 0）"}
  Q1 -- "沒有：λ = 0" --> NO["不可辨識：pole = 1<br/>加大 μ、加長 N、跑更久都沒用"]
  NO --> FIX1["改參數化：固定 a₀ 或 Σa_i = 0、<br/>不更新 b；或另找獨立觀測路徑"]
  Q1 -- "有" --> Q2{"② 每一個長度 N₀ 的窗口<br/>都有能量嗎？ λ_min(S_k) ≥ α > 0"}
  Q2 -- "有些窗口是 0" --> STEP["只有好窗口才學得到<br/>軌跡：平台 → 突然下降"]
  STEP --> FIX2["改善激發：code randomization、<br/>dither、training sequence"]
  Q2 -- "是：PE 成立" --> Q3{"③ κ = λ_max / λ_min<br/>很大嗎？"}
  Q3 -- "是" --> SLOW["學得到但很慢<br/>k₉₅ ≈ ln 20 / (g·λ_min)"]
  SLOW --> FIX3["改善激發，或第 10 章的<br/>preconditioner（代價是雜訊）"]
  Q3 -- "否" --> FAST["學得到而且快<br/>只要 0 < g < 2 / λ_max"]${CLASSES}
  class Q1,Q2,Q3 focus
  class NO warn
  class FAST ok`

/**
 * 圖 9.20（手算流程，HC-09.8）：綜合手算的計算順序——單位換算 → 穩定 → 速度 → 窗口。
 */
export const CHART_SYNTHESIS_FLOW = `flowchart TD
  IN(["輸入：σ_v（fs）、μ（fs）、ρ、N₀"]) --> KQ["① K_q = √(2/π) / σ_v<br/>單位 fs⁻¹"]
  KQ --> G["② g = μ·K_q<br/>無因次"]
  G --> LAM["③ λ_max = 1 + ρ、λ_min = 1 − ρ"]
  LAM --> STAB{"④ 穩定嗎？<br/>g·λ_max < 2"}
  STAB -- "否" --> DIV["快模式不收斂<br/>μ 要小於 2 / (K_q·λ_max)"]
  STAB -- "是" --> PS["⑤ 速度：p_slow = 1 − g·λ_min"]
  PS --> K95["⑥ k₉₅ = ⌈ln 0.05 ÷ ln |p_slow|⌉"]
  K95 --> DEG["⑦ 窗口：±1 code 的退化機率<br/>((1 + ρ)/2)^N₀ + ((1 − ρ)/2)^N₀"]
  DEG --> SPR["⑧ Gaussian 的 λ 量測散佈<br/>≈ √(2 / N₀)"]${CLASSES}
  class STAB focus
  class DIV warn`

/** 圖的種類（docs/teaching-style.md §8 的分類） */
export type Ch09DiagramKind = '數學模型' | '演算法迴圈' | '路徑／轉移函數' | '比較' | '手算流程' | '決策樹' | '狀態圖'

export interface Ch09Diagram {
  /** 圖的代號：<Diagram id="…">、data-diagram 屬性與測試都用它 */
  id: string
  chart: string
  kind: Ch09DiagramKind
  /** 圖放在哪一節（章內錨點 id） */
  section: string
  /** 圖要支撐的公式（沒有就省略） */
  formulaId?: string
  /**
   * 圖必須出現在哪一個錨點「之前」（DOM id）：對應的公式／推導、或馬上要做的手算題。
   * 規範是「先看圖知道訊號怎麼流，再看數學」；diagrams.test.tsx 會檢查頁面上的實際順序。
   */
  before: string
  /** 螢幕閱讀器用的文字替代說明（純文字） */
  alt: string
}

/**
 * 本章全部的方塊圖，依「在頁面上出現的順序」排列；圖號（圖 9.n）就是這個陣列的索引 + 1。
 * 章首的系統地圖（<SystemMap>）是全站共用的元件，不在這個清單裡。
 */
export const CH09_DIAGRAMS: Ch09Diagram[] = [
  { id: 'two-knob', chart: CHART_TWO_KNOB, kind: '數學模型', section: 'ch09-intro', before: 'handcalc-HC-09.1', alt: '兩個輸入同時送進未知的真實系統與兩個旋鈕，兩者的輸出相減成為唯一看得到的誤差 e' },
  { id: 'matrix-machine', chart: CHART_MATRIX_MACHINE, kind: '數學模型', section: 'ch09-prereq', before: 'ch09-mean', alt: '三個向量分別乘上相關矩陣 R：共模與差模方向不變只被縮放，第三個向量方向改變' },
  { id: 'error-model', chart: CHART_ERROR_MODEL, kind: '數學模型', section: 'ch09-mean', formulaId: 'F-09.1', before: 'formula-F-09.1', alt: 'M 個 regressor 各自乘上自己的參數誤差後相加，再加上雜訊，成為單一的誤差 e[n]' },
  { id: 'block-loop', chart: CHART_BLOCK_LOOP, kind: '演算法迴圈', section: 'ch09-mean', formulaId: 'F-09.3', before: 'formula-F-09.2', alt: '多參數 block LMS 迴圈：誤差經偵測器、與 regressor 相關、GMAC 平均、乘上 mu、累加器延遲一個 block 後回授' },
  { id: 'coupled-mean', chart: CHART_COUPLED_MEAN, kind: '演算法迴圈', section: 'ch09-mean', formulaId: 'F-09.3', before: 'formula-F-09.4', alt: '兩個參數的平均遞迴：每個迴路除了自己的誤差，還經由係數 rho 的交叉路徑讀到另一個參數的誤差' },
  { id: 'eigen-modes', chart: CHART_EIGEN_MODES, kind: '數學模型', section: 'ch09-mean', formulaId: 'F-09.4', before: 'formula-F-09.4', alt: '平均誤差先旋轉到 eigenvector 座標，分成快、慢兩條獨立的一階迴路，再旋轉回原座標' },
  { id: 'k95-flow', chart: CHART_K95_FLOW, kind: '手算流程', section: 'ch09-mean', formulaId: 'F-09.6', before: 'formula-F-09.5', alt: '由 rho 與 g 依序算出 eigenvalue、兩個 pole、檢查穩定，最後得到 598 個 block' },
  { id: 'scalar-gain', chart: CHART_SCALAR_GAIN, kind: '比較', section: 'ch09-mean', formulaId: 'F-09.7', before: 'formula-F-09.7', alt: '同一個 g 同時決定快模式與慢模式的收斂倍數，兩者相等時整體最快' },
  { id: 'mean-vs-ms', chart: CHART_MEAN_VS_MS, kind: '比較', section: 'ch09-ms', formulaId: 'F-09.8', before: 'formula-F-09.8', alt: '同一個隨機更新分別取平均與取均方：平均收斂，但 N 等於 1 的 Gaussian 均方發散' },
  { id: 'pm1-staircase', chart: CHART_PM1_STAIRCASE, kind: '狀態圖', section: 'ch09-ms', formulaId: 'F-09.8', before: 'ch09-pm1-derivation', alt: '差模座標先停在初值，第一個 flip 出現的那一刻整個被消成零，之後維持零：個別軌跡是階梯，只有平均才是指數衰減' },
  { id: 'linear-vs-sign', chart: CHART_LINEAR_VS_SIGN, kind: '比較', section: 'ch09-ms', formulaId: 'F-09.18', before: 'formula-F-09.18', alt: 'linear 偵測器的均方遞迴有四階動差項，1-bit 偵測器只有與誤差無關的常數注入' },
  { id: 'pe-window', chart: CHART_PE_WINDOW, kind: '路徑／轉移函數', section: 'ch09-pe', formulaId: 'F-09.9', before: 'formula-F-09.9', alt: 'regressor 取外積、在滑動窗口內相加、除以窗口長度、求 eigenvalue，再檢查是否介於 alpha 與 beta 之間' },
  { id: 'pe-contraction', chart: CHART_PE_CONTRACTION, kind: '數學模型', section: 'ch09-pe', formulaId: 'F-09.17', before: 'formula-F-09.17', alt: '每經過一個滿足 PE 的窗口，參數誤差的長度至少縮小固定的比例' },
  { id: 'pm1-degenerate', chart: CHART_PM1_DEGENERATE, kind: '數學模型', section: 'ch09-pe', formulaId: 'F-09.11', before: 'formula-F-09.11', alt: '正負一 code 的窗口能量矩陣只由 s 等於正一與負一的個數決定，只有 s 全同號的窗口才退化，機率為兩個冪次相加' },
  { id: 'gauge-shift', chart: CHART_GAUGE_SHIFT, kind: '比較', section: 'ch09-gauge', formulaId: 'F-09.13', before: 'formula-F-09.13', alt: '同一筆 one-hot 輸入送進兩組參數，第二組的 global offset 加 c、每個 phase offset 減 c，兩個輸出相減恆為零' },
  { id: 'dc-null', chart: CHART_DC_NULL, kind: '路徑／轉移函數', section: 'ch09-gauge', formulaId: 'F-09.15', before: 'formula-F-09.15', alt: '常數 regressor 與 one-hot regressor 經過 DC 增益為零的 PLL error path，產生兩個不可觀察的方向，只剩相位之間的差' },
  { id: 'gauge-lms-path', chart: CHART_GAUGE_LMS_PATH, kind: '路徑／轉移函數', section: 'ch09-gauge', formulaId: 'F-09.19', before: 'formula-F-09.19', alt: 'u-domain 的 LMS 訊號路徑：DTC 端誤差經 PLL error path 加上雜訊後進 GMAC，GMAC 的 regressor 可選原始或濾波後的版本' },
  { id: 'restoring-force', chart: CHART_RESTORING_FORCE, kind: '比較', section: 'ch09-gauge', formulaId: 'F-09.19', before: 'formula-F-09.19', alt: '可辨識方向的迴路每個 block 把誤差乘上小於一的倍數所以有界，null 方向是純積分器所以 random walk' },
  { id: 'identifiable-tree', chart: CHART_IDENTIFIABLE_TREE, kind: '決策樹', section: 'ch09-compare', before: 'ch09-synthesis', alt: '判斷一個參數方向是否學得到的決策樹：先看 regressor 有沒有投影，再看每個窗口，最後看 condition number' },
  { id: 'synthesis-flow', chart: CHART_SYNTHESIS_FLOW, kind: '手算流程', section: 'ch09-synthesis', formulaId: 'F-09.6', before: 'handcalc-HC-09.8', alt: '綜合手算的順序：換算 K_q 與 g、算 eigenvalue、檢查穩定、算慢 pole 與 k95、最後算窗口退化機率' },
]

/** 依代號取出一張圖與它的圖號（找不到時直接丟錯，避免頁面靜默少一張圖） */
export function ch09Diagram(id: string): { def: Ch09Diagram; number: number } {
  const i = CH09_DIAGRAMS.findIndex((d) => d.id === id)
  if (i < 0) throw new Error(`Ch09 方塊圖清單中找不到 ${id}`)
  return { def: CH09_DIAGRAMS[i], number: i + 1 }
}
