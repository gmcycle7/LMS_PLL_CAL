import type { SystemBlock } from '@/components'

/**
 * Ch11 的方塊圖（docs/teaching-style.md §8）。每張圖的 Mermaid 原始碼都是具名匯出的字串，
 * diagrams.test.tsx 以真正的 mermaid parser 解析、再以真正的 renderer（jsdom）畫一次，並逐張核對
 * 圖上的數字與正負號是否和 bias.ts 的模型一致。
 *
 * 圖裡面的數學一律寫 LaTeX（teaching-style §3）：節點與連線的雙引號標籤裡寫 `$…$`，由共用 `Mermaid` 元件用 KaTeX 排版；
 * 圖的原始碼用 `String.raw` 樣板字串，所以 TeX 的反斜線只要寫一次（不可在標籤裡寫 `\\\\`，換行用 `<br/>`）。
 *
 * 寫 Mermaid 標籤時要注意（Mermaid 11 會把「所有」節點／連線／subgraph 標籤當成 Markdown 處理）：
 *  - 單獨的 ASCII「+」「-」，或以「+ 」「- 」「1. 」「#」「>」開頭的標籤會被當成 list／heading／blockquote，
 *    圖上會直接印出「Unsupported markdown: list」。所以純粹的正負號標籤一律用全形「＋」與減號「−」（U+2212）；
 *    在 `$…$` 裡的正負號則照 TeX 寫 `+`、`-`。
 *  - 含 `$…$` 的標籤整個交給 KaTeX（`mermaidMathDelimiters` 會合併成單一的 `$$…$$`），Markdown 的規則不再適用：
 *    `w^*`、`h * x`、`E[G](w^*)` 都可以直接寫。
 *  - 標籤裡的數學都在 `$…$` 內；公式外只放文字、全形標點與步驟記號（①–⑦），不用 Unicode 拼公式。
 * 訊號名稱、箭頭方向、加法點的正負號、取樣率（sample n／block k）都和正文公式一致；δ 的極性是 a − w（全站約定）。
 */

/** 章首系統地圖要標成藍色的方塊：誤差進來的地方（DTC、PD、雜訊）＋ 只看得到「相關」的 comparator／GMAC／gain accumulator。 */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['dtc', 'pd', 'noise', 'cmp', 'gmac', 'acc']

/** 共用的標色（深淺主題都看得清楚）：focus = 本圖的主角；warn = 會出問題的地方；ok = 沒問題／想要的結果。 */
const STYLE = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/* ───────────────────────── 開場 ───────────────────────── */

/** 手算流程 —— w = 1.34 時五個 code 的殘差、x·e 與平均（5-level、a = 1、c₃ = 0.1）。 */
export const CHART_GMAC_ZERO = String.raw`flowchart TB
  W["目前的校正 gain $w = 1.34$<br/>殘差 $e(x) = (a - w) \cdot x + c_3 \cdot x^3$<br/>$= -0.34 \cdot x + 0.1 \cdot x^3$"]
  W --> M2["$x = -2$：$e = -0.12$<br/>$x \cdot e = +0.24$"]
  W --> M1["$x = -1$：$e = +0.24$<br/>$x \cdot e = -0.24$"]
  W --> Z0["$x = 0$：$e = 0$<br/>$x \cdot e = 0$"]
  W --> P1["$x = +1$：$e = -0.24$<br/>$x \cdot e = -0.24$"]
  W --> P2["$x = +2$：$e = +0.12$<br/>$x \cdot e = +0.24$"]
  M2 --> AVG["GMAC：把 $x \cdot e$ 取平均<br/>$E[x \cdot e] = (0.24 - 0.24 + 0 - 0.24 + 0.24) / 5$"]
  M1 --> AVG
  Z0 --> AVG
  P1 --> AVG
  P2 --> AVG
  AVG --> ZERO["$E[x \cdot e] = 0$<br/>GMAC 歸零，LMS 停在這裡"]
  AVG -.-> LEFT["但是四個 code 的 $e$ 都不是 0<br/>$\pm 0.24$ 與 $\pm 0.12$ 還留在輸出"]
${STYLE}
  class AVG focus
  class ZERO ok
  class LEFT warn`

/**
 * 誤差從哪些硬體進來（硬體視角，含 LMS 迴圈與主迴路的 DC null）。
 * 加法點的正負號：DTC 的真實 delay 以「＋」進、校正電路的補償量 w·x 以「−」進（合起來是 (a − w)·x，即 e = y − ŷ、δ = a − w），
 * 其餘來源（b、ε_cc、v，以及主迴路加回來的 φ）都以「＋」進 —— 和 F-11.1、§11.1 的 q = sign(e_det + φ + v) 一致。
 * 由上往下排（TB）：左右展開的話連線標籤會讓圖寬到 1600px 以上，桌機放不下；W 要由第一行宣告，Mermaid 才會把
 * 「UPD → W」當成回授線（否則 COMP → SUM 會被反轉）。
 * 「DSM ~~~ W」是隱形連線（圖上看不到、不代表訊號）：把 W 排在 DSM 的下一排，W → COMP 才不會從 DSM 的方塊後面穿過去。
 */
export const CHART_ERROR_SOURCES = String.raw`flowchart TB
  W["gain 暫存器 $w$"] --> COMP["校正電路的<br/>補償量 $w \cdot x$"]
  DSM["DSM residue<br/>code $x[n]$"] --> COMP
  DSM --> DTC["DTC 的 delay<br/>$= a \cdot x + d(x)$"]
  DSM ~~~ W
  DTC -- "＋" --> SUM(("$\Sigma$"))
  COMP -- "−" --> SUM
  B["PD / comparator<br/>offset $b$"] -- "＋" --> SUM
  ECC["code-correlated<br/>干擾 $\varepsilon_{cc}$<br/>$= \kappa \cdot x$"] -- "＋" --> SUM
  V["隨機雜訊 $v$"] -- "＋" --> SUM
  SUM -- "$e[n]$" --> Q["1-bit comparator<br/>$q = \operatorname{sign}(e)$"]
  Q -. "$q$（若 comparator 就是主 PLL 的 BBPD）" .-> LF["主 PLL loop filter<br/>（積分路徑：DC null）"]
  LF -. "＋ $\varphi$（static phase offset）" .-> SUM
  Q -- "$q[n]$" --> GMAC["GMAC<br/>$G = (1/N) \cdot \sum q \cdot x$"]
  DSM -. "$x[n]$ 當 regressor" .-> GMAC
  GMAC -- "$G$" --> UPD["$w \leftarrow w + \mu \cdot G$<br/>每 $N$ 個 sample 更新一次"]
  UPD --> W
${STYLE}
  class GMAC focus`

/* ───────────────────────── §11.0 誤差模型 ───────────────────────── */

/** 誤差預算 e[n] = (a − w)x + b + d(x) + ε_cc + v（F-11.1）；五項都以「＋」進加法點。 */
export const CHART_ERROR_BUDGET = String.raw`flowchart LR
  X["code $x[n]$<br/>無因次"] --> GAIN["gain 誤差<br/>$(a - w) \cdot x[n]$"]
  X --> INL["DTC INL<br/>$d(x) = c_2 \cdot x^2 + c_3 \cdot x^3$"]
  X --> ECC["code-correlated 干擾<br/>$\varepsilon_{cc}[n] = \kappa \cdot x[n]$"]
  OFF["靜態 offset $b$<br/>與 $x$ 無關的常數"]
  V["隨機雜訊 $v[n]$<br/>零均值、標準差 $\sigma_v$"]
  GAIN -- "＋" --> SUM(("＋"))
  OFF -- "＋" --> SUM
  INL -- "＋" --> SUM
  ECC -- "＋" --> SUM
  V -- "＋" --> SUM
  SUM -- "$e[n]$" --> CMP["1-bit comparator<br/>$q[n] = \operatorname{sign}(e[n])$"]
  CMP -- "$q[n]$" --> GMAC["GMAC<br/>$G_k = (1/N) \cdot \sum q[n] \cdot x[n]$"]
  X -. "$x[n]$ 當 regressor" .-> GMAC
${STYLE}
  class GAIN focus
  class INL,ECC warn
  class V ok`

/* ───────────────────────── §11.A 固定點 ───────────────────────── */

/**
 * block Sign-LMS 迴圈 w_(k+1) = w_k + μ·G_k。上面一列每個 sample n 跑一次，下面一列每個 block k 才跑一次；
 * 兩列之間的連線接在 subgraph 上（不是接在節點上），subgraph 內的 direction LR 才不會被取消。
 * SLOW 寫在 FAST 前面是故意的：Mermaid 以相反的順序建立 subgraph，這樣排版時才會把 FAST（sample 那一列）放在上面
 * （diagrams.test.tsx 會檢查實際排出來的上下順序）。
 */
export const CHART_LMS_LOOP = String.raw`flowchart TB
  subgraph SLOW["每個 block $k$ 才跑一次（慢）"]
    direction LR
    AVG["GMAC：$N$ 個乘積取平均<br/>$G_k = (1/N) \cdot \sum q[n] \cdot x[n]$"] -- "$G_k$" --> MU["$\times \mu$"]
    MU -- "＋ $\mu \cdot G_k$" --> ADD(("＋"))
    ADD -- "$w_{k+1}$" --> DLY["$z^{-1}$<br/>延遲 1 個 block"]
    DLY -- "＋ $w_k$" --> ADD
  end
  subgraph FAST["每個 sample $n$ 跑一次（快）"]
    direction LR
    X["code $x[n]$"] --> ERR["誤差模型（圖 11-3）<br/>$e[n] = (a - w_k) \cdot x[n] + b + d(x) + \varepsilon_{cc} + v$"]
    ERR -- "$e[n]$" --> CMP["comparator<br/>$q[n] = \operatorname{sign}(e[n])$"]
    CMP -- "$q[n]$" --> MUL(("$\times$"))
    X -- "$x[n]$" --> MUL
  end
  FAST -- "乘積 $q[n] \cdot x[n]$，每 $N$ 個一組" --> SLOW
  SLOW -- "$w_k$ 回授：整個 block 內不變" --> FAST
  SLOW -.-> FP["固定點 $w^*$：平均 $E[G] = 0$<br/>$w$ 不再有淨移動"]
${STYLE}
  class AVG focus
  class FP ok`

/** 同一個誤差、兩種 GMAC（MSE：直線；Sign：erf 曲線）與三個出口。 */
export const CHART_MSE_VS_SIGN = String.raw`flowchart TB
  E["comparator 前的誤差<br/>$e = e_\mathrm{det}(x; w) + v$"]
  E --> MSE["MSE-LMS<br/>多位元的 $e$ 直接乘 $x$"]
  E --> SGN["Sign-LMS<br/>只留 1 bit：$q = \operatorname{sign}(e)$"]
  MSE --> GM["$E[G] = E[x \cdot e]$<br/>對 $w$ 是一條直線"]
  SGN --> ERF["先對雜訊平均<br/>$E[q \mid x] = \operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))$"]
  ERF --> GS["$E[G] = E[x \cdot \operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))]$<br/>對 $w$ 是一條曲線"]
  GM --> FM["一次方程的精確解<br/>$w^* = a + (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$"]
  GS -- "$\sigma_v$ 遠大於殘差：$\operatorname{erf} \approx K_q \cdot e_\mathrm{det}$" --> FM
  GS -- "$\sigma_v$ 與殘差同量級" --> FR["mean-field 根（數值求解）<br/>§11.2 的例子落在 1.34 與 1.4 之間"]
  GS -- "$\sigma_v = 0$：$\operatorname{erf}$ 變成 $\operatorname{sign}$" --> FMED["$|x|$ 加權中位數<br/>§11.2 的例子是 1.4"]
${STYLE}
  class SGN,ERF,GS focus
  class FM ok
  class FR,FMED warn`

/** GMAC = 五個平行的相關器；E[x·e] 逐項拆開（F-11.4 的推導）。 */
export const CHART_BIAS_CORRELATORS = String.raw`flowchart LR
  subgraph TERMS["$e[n]$ 的五項"]
    direction TB
    T1["$(a - w) \cdot x$"]
    T2["offset $b$"]
    T3["INL $d(x)$"]
    T4["$\varepsilon_{cc}$"]
    T5["雜訊 $v$"]
  end
  subgraph CORR["各自乘上 $x$ 再取平均"]
    direction TB
    C1["$(a - w) \cdot E[x^2]$"]
    C2["$b \cdot E[x]$"]
    C3["$E[x \cdot d(x)]$"]
    C4["$E[x \cdot \varepsilon_{cc}]$"]
    C5["$E[x \cdot v] = 0$"]
  end
  T1 --> C1
  T2 --> C2
  T3 --> C3
  T4 --> C4
  T5 --> C5
  C1 -- "＋" --> S(("＋"))
  C2 -- "＋" --> S
  C3 -- "＋" --> S
  C4 -- "＋" --> S
  C5 -- "＋" --> S
  S -- "$E[G] = E[x \cdot e]$" --> FP["令 $E[G] = 0$，解出 $w$<br/>$w^* = a + (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$"]
${STYLE}
  class T1,C1 focus
  class T3,T4,C3,C4 warn
  class T5,C5 ok`

/**
 * comparator 的三個模型（F-11.2、F-11.3）：同一個 e_det 進來，
 *  ① 實際電路：加上雜訊 v 之後只留正負號，每個 sample 輸出 ±1；
 *  ② 固定 x、對 v 取平均（精確）：E[q | x] = erf( e_det / (√2·σ_v) )；
 *  ③ 再線性化（近似，需 |e_det| ≪ σ_v）：E[q | x] ≈ K_q·e_det，K_q = √(2/π)/σ_v。
 * 三列只有 comparator 那一塊不同（藍色）；後面的「乘上 x 再平均」完全一樣。
 */
export const CHART_COMPARATOR_MODEL = String.raw`flowchart TB
  subgraph REAL["① 實際的 comparator：每個 sample 只輸出 $\pm 1$"]
    direction LR
    R0["確定性殘差<br/>$e_\mathrm{det}(x; w)$"] -- "＋" --> R1(("＋"))
    R2["雜訊 $v[n]$<br/>Gaussian，標準差 $\sigma_v$"] -- "＋" --> R1
    R1 -- "$e[n]$" --> R3["只留正負號<br/>$\operatorname{sign}(\cdot)$"]
    R3 -- "$q[n] = \pm 1$" --> R4["乘上 $x[n]$<br/>$N$ 個取平均：$G_k$"]
  end
  subgraph MEAN["② 固定 $x$、對雜訊取平均：S 形曲線（精確，F-11.2）"]
    direction LR
    M0["$e_\mathrm{det}(x; w)$"] --> M1["S 形曲線<br/>$\operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))$"]
    M1 -- "$E[q \mid x]$" --> M2["乘上 $x$<br/>對 code 取平均"]
    M2 --> M3["$E[G] = E[x \cdot \operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))]$"]
  end
  subgraph LIN["③ 再線性化：一個增益（近似，F-11.3）"]
    direction LR
    L0["$e_\mathrm{det}(x; w)$"] --> L1["$\times K_q$<br/>$K_q = \sqrt{2/\pi} / \sigma_v$"]
    L1 -- "$K_q \cdot e_\mathrm{det}$" --> L2["乘上 $x$<br/>對 code 取平均"]
    L2 --> L3["$E[G] \approx K_q \cdot E[x \cdot e]$"]
  end
  REAL -- "固定 $x$，對 $v$ 取平均" --> MEAN
  MEAN -- "每個 code 的 $|e_\mathrm{det}|$ 都遠小於 $\sigma_v$" --> LIN
${STYLE}
  class R3,M1,L1 focus`

/* ───────────────────────── §11.1 offset ───────────────────────── */

/** offset 怎麼變成假的 gain 誤差（uniform [0, 1) code、b = 0.1 ⇒ w* − a = 0.15）。 */
export const CHART_OFFSET_PATH = String.raw`flowchart LR
  OFF["offset $b = 0.1$<br/>永遠同一個正負號"] --> MUL(("$\times$"))
  X["code $x$ 在 0 與 1 之間均勻分布<br/>$E[x] = 1/2$，$E[x^2] = 1/3$"] --> MUL
  MUL --> AVG["GMAC 取平均<br/>$b \cdot E[x] = 0.05$，不是 0"]
  AVG --> BIAS["GMAC 分不出它和 gain 誤差<br/>LMS 把 $w$ 多調 $0.05 \div (1/3) = 0.15$<br/>$w^* - a = b \cdot E[x] / E[x^2]$"]
  AVG -. "若 code 置中" .-> ZERO["$E[x] = 0$，所以 $b \cdot E[x] = 0$<br/>offset 不再變成 gain bias"]
${STYLE}
  class OFF focus
  class BIAS warn
  class ZERO ok`

/** 三種主迴路架構並排（勘誤 E03）；差別只在積分路徑接在哪裡、強制哪個平均為 0。 */
export const CHART_DC_NULL = String.raw`flowchart TB
  subgraph ARCH_A["(A) none：主迴路不碰 comparator 的 DC，$\varphi = 0$"]
    direction LR
    A0["$e_\mathrm{det} + v$"] --> A1["comparator<br/>$q = \operatorname{sign}(e_\mathrm{det} + v)$"]
    A1 --> A2["GMAC 的固定點<br/>$w^* - a = (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$"]
  end
  subgraph ARCH_B["(B) shared BBPD：積分路徑強制 $E[q] = 0$"]
    direction LR
    B0["$e_\mathrm{det} + v$"] -- "＋" --> B1(("＋"))
    B1 --> B2["BBPD 就是 comparator<br/>$q = \operatorname{sign}(e_\mathrm{det} + \varphi + v)$"]
    B2 --> B3["GMAC 的固定點<br/>$w^* - a \approx \operatorname{Cov}(x, d + \varepsilon_{cc}) / \operatorname{Var}(x)$<br/>offset $b$ 消失"]
    B2 -- "$q$" --> B4["主迴路積分路徑<br/>$\varphi \leftarrow \varphi - k_\varphi \cdot q$"]
    B4 -- "＋ $\varphi$" --> B1
  end
  subgraph ARCH_C["(C) linear PD + 獨立 comparator：積分路徑強制 $E[e_\mathrm{PD}] = 0$"]
    direction LR
    C0["$e_\mathrm{det} - b$"] -- "＋" --> C1(("＋"))
    C1 -- "$e_\mathrm{PD}$" --> C2["獨立 comparator，自帶 offset $b$<br/>$q = \operatorname{sign}(e_\mathrm{PD} + b + v)$"]
    C2 --> C3["GMAC 的固定點<br/>$w^* - a \approx (b \cdot E[x] + \operatorname{Cov}(x, d + \varepsilon_{cc})) / \operatorname{Var}(x)$<br/>offset 項留下，分母變小"]
    C1 -- "$e_\mathrm{PD}$" --> C4["主迴路積分路徑<br/>$\varphi \leftarrow \varphi - k_\varphi \cdot e_\mathrm{PD}$"]
    C4 -- "＋ $\varphi$" --> C1
  end
  ARCH_A ~~~ ARCH_B
  ARCH_B ~~~ ARCH_C
${STYLE}
  class B4,C4 focus
  class B3 ok
  class C3 warn`

/** servo 的抖動等效於更大的 comparator 雜訊（F-11.17：σ_eff² = σ_v² + σ_φ²）。 */
export const CHART_SERVO_DITHER = String.raw`flowchart TB
  subgraph REAL["實際：comparator 輸入端有兩個獨立的隨機量"]
    direction LR
    R0["確定性部分<br/>$e_\mathrm{det}(x; w) + \bar\varphi$（$\varphi$ 的平均）"] -- "＋" --> R3(("＋"))
    R1["servo 的抖動 $\tilde\varphi[n]$<br/>變異數 $\sigma_\varphi^2$"] -- "＋" --> R3
    R2["雜訊 $v[n]$<br/>變異數 $\sigma_v^2$"] -- "＋" --> R3
    R3 --> R4["comparator<br/>$q = \operatorname{sign}(\cdot)$"]
  end
  subgraph EQUIV["等效：一個比較大的雜訊"]
    direction LR
    Q0["確定性部分<br/>$e_\mathrm{det}(x; w) + \bar\varphi$"] -- "＋" --> Q2(("＋"))
    Q1["等效雜訊<br/>$\sigma_\mathrm{eff}^2 = \sigma_v^2 + \sigma_\varphi^2$"] -- "＋" --> Q2
    Q2 --> Q3["comparator 的平均輸出<br/>$E[q \mid x] \approx \operatorname{erf}((e_\mathrm{det} + \bar\varphi) / (\sqrt{2} \cdot \sigma_\mathrm{eff}))$"]
  end
  REAL -- "兩個獨立的隨機量：變異數相加" --> EQUIV
${STYLE}
  class R1,Q1 focus`

/** code centering 什麼時候真的讓 offset 不造成 gain bias（判斷樹）。 */
export const CHART_CENTERING_TREE = String.raw`flowchart TB
  Q1{{"code 已置中？<br/>$E[x] = 0$"}}
  Q1 -- "否" --> N1["offset 變成假 gain bias<br/>$b \cdot E[x] / E[x^2]$（架構 A）"]
  Q1 -- "是" --> Q2{{"comparator 前有雜訊？<br/>$\sigma_v > 0$"}}
  Q2 -- "否，$\sigma_v = 0$" --> N2["dead zone：一整段 $w$ 都讓 $E[G] = 0$<br/>$w = a$ 是解，但不唯一"]
  Q2 -- "是" --> Q3{{"$\sigma_v$ 與 code 無關？"}}
  Q3 -- "否，$\sigma_v$ 隨 $x$ 改變" --> N3["Sign-LMS 變成 $1/\sigma_v(x)$ 加權<br/>offset 又造成 bias（勘誤 E17）"]
  Q3 -- "是" --> Q4{{"還有 INL 或 $\varepsilon_{cc}$？"}}
  Q4 -- "沒有" --> Y1["$w^* = a$<br/>精確，任意 $b$ 都成立"]
  Q4 -- "有" --> Y2["offset 本身不造成 bias<br/>但 $|b|$ 與 $\sigma_v$ 同量級時<br/>會經 $\operatorname{erf}$ 改變 INL 的 bias"]
${STYLE}
  class N1,N2,N3 warn
  class Y1 ok`

/**
 * code-dependent jitter 讓 centering 失效（F-11.12、勘誤 E17 的例子）：置中的 5-level code、b = 0.2、
 * σ_v(x) = √(1 + 0.25·(x + 2)²) = 1、1.118、1.414、1.803、2.236。兩條路只差「每個 code 的權重 1/σ_v(x)」那一塊（藍色）：
 *   常數 σ_v：b·E[x] = 0 ⇒ w* = a；
 *   σ_v(x)  ：b·E[x/σ_v(x)] = −0.0578、E[x²/σ_v(x)] = 1.4476 ⇒ w* ≈ 1 − 0.0578/1.4476 = 0.9601。
 * 圖上的數字由 diagrams.test.tsx 以 bias.ts 的 sigmaAt／linearizedFixedPoint 重算核對。
 */
export const CHART_JITTER_WEIGHT = String.raw`flowchart TB
  OFF["置中的 5-level code，offset $b = 0.2$<br/>五個 code 的 $x \cdot b$：$-0.4,\ -0.2,\ 0,\ +0.2,\ +0.4$"]
  OFF --> KC["$\sigma_v$ 是常數<br/>每個 code 的 $K_q$ 一樣大<br/>五個 code 的權重相同"]
  OFF --> KV["$\sigma_v(x)$ 隨 code 變大<br/>$K_q(x) = \sqrt{2/\pi} / \sigma_v(x)$<br/>權重 $1/\sigma_v(x)$：$1,\ 0.894,\ 0.707,\ 0.555,\ 0.447$"]
  KC --> SC["加權後取平均：$b \cdot E[x] = 0$<br/>正負兩邊剛好抵銷"]
  KV --> SV["加權後取平均：$b \cdot E[x / \sigma_v(x)] = -0.0578$<br/>雜訊小的負 code 比較重，抵銷不了"]
  SC --> WC["$w^* = a$<br/>offset 不造成 gain bias"]
  SV --> WV["$w^* \approx a + (-0.0578) / E[x^2 / \sigma_v(x)]$<br/>$= 1 - 0.0578 / 1.4476 = 0.9601$"]
${STYLE}
  class KV focus
  class WC ok
  class SV,WV warn`

/** 無雜訊 + offset 的 dead zone（x ∈ {0,1,2,3}、a = 1、b = 1、σ_v = 0）。 */
export const CHART_DEAD_ZONE = String.raw`flowchart LR
  LO["$w$ 太小：小於 1.3333<br/>$E[G] = +1.5$<br/>$w$ 被往上推"] --> DZ["$w$ 在 1.3333 與 1.5 之間<br/>$E[G] = 0$<br/>dead zone：沒有推力"]
  HI["$w$ 太大：大於 1.5<br/>$E[G] = -1$ 或 $-1.5$<br/>$w$ 被往下推"] --> DZ
  DZ --> STOP["$w$ 停在進來的那一側<br/>由初值 $w_0$ 與 $\mu$ 決定"]
  DZ -. "加入雜訊 $\sigma_v > 0$，等於 dither" .-> UNI["零交越變成唯一的一點"]
${STYLE}
  class DZ warn
  class UNI ok`

/* ───────────────────────── §11.2 INL ───────────────────────── */

/** 最佳直線（MSE 觀點）—— INL 對 x 投影：共線的 0.34·x 被 gain 吸收，正交的殘差留下。 */
export const CHART_BEST_FIT = String.raw`flowchart TB
  D["DTC 的 INL<br/>$d(x) = c_3 \cdot x^3 = 0.1 \cdot x^3$"] --> SPLIT{"對 $x$ 做投影<br/>拆成兩部分"}
  SPLIT -- "與 $x$ 共線的部分" --> PAR["$(E[x \cdot d] / E[x^2]) \cdot x$<br/>$= (0.68 / 2) \cdot x = 0.34 \cdot x$"]
  SPLIT -- "與 $x$ 正交的部分" --> ORT["$e_0(x) = 0.1 \cdot x^3 - 0.34 \cdot x$<br/>$E[x \cdot e_0] = 0$"]
  PAR --> ABS["被單一 gain 吸收<br/>$w^* = a + 0.34 = 1.34$"]
  ORT --> RES["GMAC 看不到，留在每個 code 上<br/>$x = \pm 1$：$\mp 0.24$；$x = \pm 2$：$\pm 0.12$"]
${STYLE}
  class PAR,ABS focus
  class ORT,RES warn`

/** 同樣的兩個意見（1.1 與 1.4），三種計票方式 ⇒ 1.34／介於兩者之間／1.4。 */
export const CHART_MEAN_VS_MEDIAN = String.raw`flowchart TB
  T["每個 code 想要的 gain：$t(x) = a + c_3 \cdot x^2$<br/>$t(\pm 1) = 1.1$；$t(\pm 2) = 1.4$"]
  T --> M1["MSE-LMS：拔河<br/>拉力 $=$ 權重 $\times$ 距離<br/>權重 $p \cdot x^2$：0.4 與 1.6"]
  T --> M2["Sign-LMS + Gaussian 雜訊<br/>$\operatorname{erf}$ 把票變回部分拉力"]
  T --> M3["無雜訊 Sign-LMS：投票<br/>只看往上或往下<br/>票重 $p \cdot |x|$：0.4 與 0.8"]
  M1 --> R1["加權平均<br/>$(0.4 \cdot 1.1 + 1.6 \cdot 1.4) / 2 = 1.34$"]
  M2 --> R2["介於 1.34 與 1.4 之間<br/>$\sigma_v$ 夠大時約 $1.34 + 3.456 \times 10^{-4} / \sigma_v^2$"]
  M3 --> R3["加權中位數<br/>1.4 的票重 0.8 超過總重 1.2 的一半<br/>答案 1.4"]
${STYLE}
  class M1,R1 focus
  class M3,R3 warn`

/* ───────────────────────── §11.3 identifiability ───────────────────────── */

/** gain 誤差 (a − w)·x 與耦合 κ·x 並聯相加 ⇒ comparator 只看得到 a + κ（F-11.13）。 */
export const CHART_IDENTIFIABILITY = String.raw`flowchart TB
  X["code $x[n]$"] --> GA["DTC gain 誤差<br/>$\times (a - w)$"]
  X --> GK["code-correlated 耦合<br/>$\times \kappa$"]
  GA -- "＋" --> S(("＋"))
  GK -- "＋" --> S
  V["雜訊 $v[n]$"] -- "＋" --> S
  S --> CMP["comparator 只看得到總和<br/>$e[n] = ((a + \kappa) - w) \cdot x[n] + v[n]$<br/>$q[n] = \operatorname{sign}(e[n])$"]
  CMP --> OBS["觀測資料 $x[n]$、$q[n]$ 只依賴 $a + \kappa$<br/>$w^* = a + \kappa = 1.1$"]
  WA["世界 A<br/>$a = 1$，$\kappa = 0.1$"] -.-> OBS
  WB["世界 B<br/>$a = 1.1$，$\kappa = 0$"] -.-> OBS
${STYLE}
  class GA focus
  class GK,OBS warn`

/** w* = a + κ 是好是壞，取決於耦合發生在哪個節點（研究假說）。 */
export const CHART_COUPLING_NODE = String.raw`flowchart TB
  Q{{"$\varepsilon_{cc} = \kappa \cdot x$ 出現在哪個節點？"}}
  Q -- "DTC／相位路徑：PLL 輸出也有" --> A1["$w = a + \kappa$ 把它一起抵消"]
  A1 --> A2["輸出的 timing error 變小"]
  Q -- "只在觀測路徑，例如 comparator threshold" --> B1["$w = a + \kappa$ 把不存在的誤差寫進 DTC"]
  B1 --> B2["輸出多出 $\kappa \cdot x$ 的 timing error"]
${STYLE}
  class A2 ok
  class B2 warn`

/* ───────────────────────── §11.4 near-integer ───────────────────────── */

/** e_PD = (a − w)·(h ∗ x) + β + v；gain 誤差經過 H_PD（決定 C），β 不經過（決定 B）。上列是誤差路徑，下列是 GMAC 的相關器。 */
export const CHART_NEAR_INTEGER_PATH = String.raw`flowchart TB
  subgraph PATH["誤差怎麼到達 PD"]
    direction LR
    X["code $x[n]$"] --> G["DTC gain 誤差<br/>$\times (a - w)$"]
    G --> H["主 PLL 誤差路徑 $H_\mathrm{PD}(z)$<br/>脈衝響應 $h$"]
    H -- "＋ $(a - w) \cdot (h * x)[n]$" --> S(("＋"))
    BETA["其他確定性誤差 $\beta[n]$<br/>直接到 PD，不經過 $H_\mathrm{PD}$"] -- "＋" --> S
    V["雜訊 $v[n]$"] -- "＋" --> S
  end
  subgraph CORR["GMAC 怎麼看它"]
    direction LR
    CMP["comparator<br/>$q[n] = \operatorname{sign}(e_\mathrm{PD}[n])$"] -- "$q[n]$" --> M(("$\times$"))
    XR["同一個 code $x[n]$<br/>當 regressor"] --> M
    M --> AVG["GMAC 的平均<br/>$E[G] \approx K_q \cdot ((a - w) \cdot C + B)$"]
    AVG --> FP["令 $E[G] = 0$<br/>$w^* = a + B / C$"]
  end
  PATH -- "$e_\mathrm{PD}[n]$" --> CORR
${STYLE}
  class H focus
  class BETA warn`

/** near-integer 的敏感度鏈 —— frac → 0 ⇒ C ∝ frac² ⇒ S 變小、B/C 放大、C ≤ 0 時極性錯誤。 */
export const CHART_NEAR_INTEGER_WHY = String.raw`flowchart TB
  F["FCW 的小數部分 $\mathrm{frac}$ 趨近 0"] --> SAW["DSM residue 變成很慢的 sawtooth<br/>基頻 $\Omega_1 = 2\pi \cdot \mathrm{frac}$，第 $k$ 條諧波功率 $\propto 1/k^2$"]
  SAW --> IN["落在迴路頻寬內的諧波：$\Omega_k$ 小於 $\Omega_n$<br/>$\mathrm{Re}\,H_\mathrm{PD}$ 為負，對 $C$ 的貢獻是負的"]
  SAW --> OUT["頻寬外的諧波：$\Omega_k$ 不小於 $\Omega_n$<br/>$\mathrm{Re}\,H_\mathrm{PD}$ 為正，對 $C$ 的貢獻是正的"]
  IN --> CS["$C = \sum |X_k|^2 \cdot \mathrm{Re}\,H_\mathrm{PD}(\Omega_k)$<br/>正負幾乎抵銷，$C \propto \mathrm{frac}^2$"]
  OUT --> CS
  CS --> SL["恢復斜率 $S = K_q \cdot C$ 變小<br/>收斂時間 $\propto 1 / (\mu \cdot S)$ 變長"]
  CS --> BI["直接耦合的 $B$ 不變<br/>bias $= B / C$ 被放大"]
  CS --> NG["$C \le 0$ 時極性錯誤<br/>$a + B / C$ 變成 repelling"]
${STYLE}
  class CS focus
  class SL,BI,NG warn`

/**
 * 下方 near-integer 實驗（nearIntegerC）怎麼算出同一個 C：從同一個標準化的 first-order DSM residue 出發，
 *   時域：x 通過 H_PD(z) 得 u = h ∗ x，略過暫態後取整數個週期，C = mean(x·u)；
 *   頻域：取一個週期做 DFT，C = Σ_k |X_k|²·Re H_PD(e^{jΩ_k})，Ω_k = 2πk/P（Parseval，只有實部進來）。
 * 兩條路互為交叉檢查：相對差小於 10⁻⁶ 才標「一致」（experiment 的 freqCheck）。
 */
export const CHART_NEAR_INTEGER_CHECK = String.raw`flowchart TB
  FRAC["FCW 的小數部分 $\mathrm{frac}$<br/>16-bit DSM：$K = \mathrm{frac} \cdot 2^{16}$"] --> DSM["first-order DSM 的 residue $x[n]$<br/>週期 $P = 2^{16} / \gcd(K, 2^{16})$"]
  DSM --> NORM["標準化<br/>$E[x] = 0$，$E[x^2] = 1$"]
  NORM --> T1["時域：$x[n]$ 通過 $H_\mathrm{PD}(z)$<br/>$u[n] = (h * x)[n]$"]
  T1 --> T2["略過暫態，取整數個週期<br/>$C = \text{平均}(x[n] \cdot u[n])$"]
  NORM --> F1["頻域：取一個週期做 DFT<br/>得到各條諧波 $X_k$"]
  F1 --> F2["$C = \sum_k |X_k|^2 \cdot \mathrm{Re}\,H_\mathrm{PD}(e^{j\Omega_k})$<br/>$\Omega_k = 2\pi k / P$"]
  T2 --> CHK{{"兩個 $C$ 的相對差<br/>小於 $10^{-6}$ ？"}}
  F2 --> CHK
  CHK -- "是" --> OUT["採用 $C(\mathrm{frac})$<br/>再算 bias：$w^* - a = B / C$"]
  CHK -- "否" --> BAD["標示 mismatch<br/>多半是暫態還沒衰減完"]
${STYLE}
  class T1,F2 focus
  class OUT ok
  class BAD warn`

/**
 * 規格 §11.4 建議的量測流程（校正流程圖）：每個 FCW 凍結 gain，在 w ± Δ 各量一次平均 GMAC，
 * 本章的斜率估計 Ŝ = (G₋ − G₊)/(2Δ)（= −Ŝ_GMAC，勘誤 E13；bias.ts 的 SlopeProbeResult.slope 就是這個式子）。
 * Ŝ ≤ 0 ⇒ 極性錯誤；Ŝ 為正但遠小於靜態值 K_q·E[x²] ⇒ C 很小，bias B/C 被放大、收斂變慢。
 */
export const CHART_SLOPE_MEASURE = String.raw`flowchart TB
  F0["選一個 FCW<br/>等 LMS 收斂，記下 $w$"] --> F1["凍結 gain 在 $w + \Delta$<br/>量平均 GMAC：$G_+$"]
  F0 --> F2["凍結 gain 在 $w - \Delta$<br/>量平均 GMAC：$G_-$"]
  F1 --> F3["恢復斜率的估計<br/>$\hat S = (G_- - G_+) / (2 \cdot \Delta)$<br/>附信賴區間"]
  F2 --> F3
  F3 --> Q1{{"$\hat S$ 大於 0？"}}
  Q1 -- "否" --> BAD["極性錯誤：$C \le 0$<br/>正的 $\mu$ 會讓 $w$ 遠離 $a + B / C$"]
  Q1 -- "是" --> Q2{{"$\hat S$ 遠小於靜態值 $K_q \cdot E[x^2]$？"}}
  Q2 -- "是" --> SMALL["$C$ 很小：bias $= B / C$ 被放大<br/>收斂時間 $\propto 1 / (\mu \cdot \hat S)$ 變長"]
  Q2 -- "否" --> GOOD["斜率正常<br/>$C$ 接近 $E[x^2]$，bias 約 $B / E[x^2]$"]
  BAD --> NEXT["換下一個 FCW<br/>最後用真實閉迴路確認"]
  SMALL --> NEXT
  GOOD --> NEXT
${STYLE}
  class F3 focus
  class BAD,SMALL warn
  class GOOD ok`

/* ───────────────────────── §11.B Lab ───────────────────────── */

/** Monte Carlo 與 mean-field 之間的三個可預期差距，以及 Lab 的判定式。 */
export const CHART_MC_GAPS = String.raw`flowchart TB
  MF["mean-field 固定點 $w^*$<br/>$\mu \to 0$、$\varphi$ 為常數的極限"] -- "＋" --> S(("＋"))
  G1["① 有限步長：曲率把抖動<br/>整流成偏移<br/>$G''(w^*) \cdot \operatorname{Var}(w) / (2 \cdot S)$"] -- "＋" --> S
  G2["② servo 抖動是額外的 dither<br/>把 $\sigma_v$ 換成 $\sigma_\mathrm{eff}$<br/>後固定點的移動"] -- "＋" --> S
  G3["③ servo 落後<br/>$N$ 遠大於 $\tau$ 時可忽略"] -- "＋" --> S
  S --> MC["Monte Carlo 量到的時間平均"]
  MC --> CHK{{"與 servo-aware 固定點的差<br/>$\le 4 \cdot \mathrm{SE} + \text{①③ 的估計} + 0.25 \cdot \text{②}$？"}}
  CHK -- "是" --> OKN["✓ Analytic 與 MC 一致"]
  CHK -- "否" --> BAD["✗ mismatch，並說明最可能的原因"]
${STYLE}
  class MF focus
  class OKN ok
  class BAD warn`

/**
 * 固定點附近的 block LMS 迴圈（F-11.16 的推導；全部都是 block rate，索引 k）。δw = w − w*（不是全站的 δ = a − w）。
 *   G_k = η_k − S·δw_k + ½·G''(w*)·δw_k²      ← 加法點 SG 的三個輸入（＋、−、＋）
 *   δw_(k+1) = δw_k + μ·G_k                    ← 累加器（× μ、加法點 ADD、z⁻¹）
 * 只留「− S」那條負回授：δw_(k+1) = (1 − g)·δw_k + μ·η_k，g = μ·S（pole 1 − g），Var(w) = μ²·Var(η)/(1 − (1 − g)²)；
 * 再加上曲率那條：穩態 E[G] = 0 ⇒ E[δw] = G''·Var(w)/(2·S)。
 */
export const CHART_FINITE_STEP_LOOP = String.raw`flowchart TB
  ETA["GMAC 的抽樣雜訊 $\eta_k$<br/>零均值，變異數約 $E[x^2] / N$"] -- "＋" --> SG(("＋"))
  SG -- "$G_k$" --> MU["$\times \mu$"]
  MU -- "＋ $\mu \cdot G_k$" --> ADD(("＋"))
  ADD -- "$\delta w_{k+1}$" --> DLY["$z^{-1}$<br/>延遲 1 個 block"]
  DLY -- "＋ $\delta w_k$" --> ADD
  DLY -- "$\delta w_k$" --> REST["恢復力<br/>$\times S$"]
  REST -- "−" --> SG
  DLY -- "$\delta w_k$" --> CURV["$\operatorname{erf}$ 的曲率<br/>$\tfrac{1}{2} \cdot G''(w^*) \cdot \delta w_k^2$"]
  CURV -- "＋" --> SG
  REST -.-> POLE["只看這條負回授<br/>$\delta w_{k+1} = (1 - g) \cdot \delta w_k + \mu \cdot \eta_k$<br/>$g = \mu \cdot S$，pole $= 1 - g$"]
  CURV -.-> SHIFT["$\delta w_k^2$ 不會是負的，平均不是 0<br/>抖動被整流成偏移<br/>$E[\delta w] \approx G''(w^*) \cdot \operatorname{Var}(w) / (2 \cdot S)$"]
${STYLE}
  class REST,POLE focus
  class CURV,SHIFT warn`

/* ───────────────────────── 收尾 ───────────────────────── */

/** 「GMAC 歸零了——DTC error 是零嗎？」判斷樹（整章的總結）。 */
export const CHART_VERDICT_TREE = String.raw`flowchart TB
  R["GMAC 的平均 $= 0$<br/>LMS 看起來收斂了"] --> Q1{{"恢復斜率為正？<br/>$S = K_q \cdot C > 0$"}}
  Q1 -- "否" --> N1["極性錯誤：$a + B / C$ 是 repelling 的點<br/>不是真的收斂（§11.4、Ch06）"]
  Q1 -- "是" --> Q2{{"comparator 前除了 $(a - w) \cdot x$<br/>只剩與 $x$ 無關的零均值雜訊？"}}
  Q2 -- "否" --> Q3{{"多出來的是哪一項？"}}
  Q2 -- "是" --> OKN["$w^* = a$<br/>每個 code 的 $e_\mathrm{det}$ 都是 0"]
  Q3 -- "offset $b$" --> B1["$E[x] \ne 0$ 且 DC 未被主迴路消除時<br/>bias $= b \cdot E[x] / E[x^2]$（§11.1）"]
  Q3 -- "INL $d(x)$" --> B2["bias $= E[x \cdot d] / E[x^2]$<br/>每個 code 仍留下殘差（§11.2）"]
  Q3 -- "$\varepsilon_{cc} = \kappa \cdot x$" --> B3["$w^* = a + \kappa$<br/>與 gain 不可辨識（§11.3）"]
  B1 --> Q4{{"Sign-LMS 的線性化檢查<br/>$\max|e_\mathrm{det}(x; w^*)| / \sigma_v \le 0.3$？"}}
  B2 --> Q4
  B3 --> Q4
  Q4 -- "是" --> L1["一階公式 F-11.4 可以當驗收值"]
  Q4 -- "否" --> L2["改用 mean-field 根或 Monte Carlo<br/>例：$\sigma_v = 0$ 時 1.34 變成 1.4"]
${STYLE}
  class OKN ok
  class N1,B1,B2,B3 warn
  class Q4 focus`

/**
 * 綜合手算 HC-11.8 的計算順序（①→⑦）。兩條線都從 ① 的動差出發：
 * ①→②→③→④→⑤ 算「停在哪裡、可不可信」；⑥⑦ 只需要 ① 的 E[x²] 與 σ_v（S ≈ K_q·E[x²] 不需要 w*），算「走多快」。
 */
export const CHART_HANDCALC_FLOW = String.raw`flowchart TB
  S1["① code 的動差<br/>$E[x]$、$E[x^2]$、$E[x^3]$、$E[x^4]$"] --> S2["② 三個 bias 項<br/>offset：$b \cdot E[x] / E[x^2]$<br/>INL：$(c_2 \cdot E[x^3] + c_3 \cdot E[x^4]) / E[x^2]$<br/>correlated：$\kappa$"]
  S2 --> S3["③ 固定點<br/>$w^* = a + \text{offset} + \text{INL} + \kappa$"]
  S3 --> S4["④ 每個 code 的殘差<br/>$e_\mathrm{det}(x; w^*)$"]
  S4 --> S5{{"⑤ 線性化指標<br/>$\max|e_\mathrm{det}| / \sigma_v \le 0.3$？"}}
  S5 -- "是" --> S6["$w^*$ 可當 Sign-LMS 的驗收值"]
  S5 -- "否" --> S7["改用 mean-field 根或 MC"]
  S1 -- "只用 $E[x^2]$" --> S8["⑥ $K_q = \sqrt{2/\pi} / \sigma_v$<br/>$S \approx K_q \cdot E[x^2]$"]
  S8 --> S9["⑦ $\mu = g / S$<br/>$g = 0.02$ 時平均 pole $= 0.98$"]
${STYLE}
  class S3 focus
  class S6 ok
  class S7 warn`

/* ───────────────────────── 登錄表（頁面與測試共用） ───────────────────────── */

export interface Ch11Diagram {
  /** 頁面上的錨點為 `ch11-fig-<id>` */
  id: string
  /** 匯出的常數名稱（測試報告用） */
  name: string
  /** 圖名（`$…$` 以 KaTeX 顯示） */
  title: string
  /** 這張圖所在的 Section（DOM id） */
  section: string
  chart: string
  /** 圖說：一句話說明要看什麼（`$…$` 以 KaTeX 顯示） */
  caption: string
}

/** 依頁面上出現的順序排列；圖號 = 索引 + 1（圖 11-1、圖 11-2 …；新增或搬動圖時圖號自動跟著改，所以上面的註解都不寫死圖號）。 */
export const CH11_DIAGRAMS = [
  {
    id: 'gmac-zero',
    name: 'CHART_GMAC_ZERO',
    title: '手算流程：GMAC 歸零 ≠ 每個 code 的誤差歸零',
    section: 'ch11-hand',
    chart: CHART_GMAC_ZERO,
    caption: String.raw`由上到下：五個 code 各自的殘差 $e$ → 乘上自己的 $x$ → 取平均。先看綠色方塊：平均是 0；再看紅色方塊：四個非零 code 的 $e$ 都還在。`,
  },
  {
    id: 'error-sources',
    name: 'CHART_ERROR_SOURCES',
    title: '誤差從哪些硬體進來（硬體視角）',
    section: 'ch11-diagram',
    chart: CHART_ERROR_SOURCES,
    caption: String.raw`Comparator 前的誤差 $e[n]$ 是多個來源的總和；GMAC 只看到 $q$ 與 $x$ 的相關，看不到來源。虛線：若 comparator 就是主 PLL 的 BBPD，主迴路的積分路徑會把 DC 消掉（勘誤 E03，§11.1）。`,
  },
  {
    id: 'error-budget',
    name: 'CHART_ERROR_BUDGET',
    title: '誤差預算：五項相加（數學模型視角）',
    section: 'ch11-model',
    chart: CHART_ERROR_BUDGET,
    caption: String.raw`藍色是真正想校正的 gain 誤差；紅色兩項是 $x$ 的確定函數，會被 GMAC 誤認成 gain 誤差；綠色的雜訊與 $x$ 獨立，不造成 bias；offset $b$ 沒有上色，因為它要看 $E[x]$ 與主迴路架構（§11.1）。`,
  },
  {
    id: 'lms-loop',
    name: 'CHART_LMS_LOOP',
    title: String.raw`Block Sign-LMS 迴圈：快的 sample（$n$）與慢的 block（$k$）`,
    section: 'ch11-fixed-point',
    chart: CHART_LMS_LOOP,
    caption: String.raw`上面一列每個 sample 跑一次：誤差 → comparator → 乘上 $x$；下面一列每個 block 才跑一次：$N$ 個乘積平均（藍色）→ 乘 $\mu$ → 累加 → 延遲。$w_k$ 沿著回授線回到上面一列。MSE-LMS 只是把 comparator 換成直通（$q\to e$）。`,
  },
  {
    id: 'mse-vs-sign',
    name: 'CHART_MSE_VS_SIGN',
    title: '同一個誤差、兩種 GMAC：直線與曲線',
    section: 'ch11-fixed-point',
    chart: CHART_MSE_VS_SIGN,
    caption: String.raw`沒有上色的 MSE 那一支一路都是線性的，所以固定點有封閉解；藍色三塊是 Sign-LMS 多出來的 1-bit 與 erf。看最下面三個出口：$\sigma_v$ 相對於殘差的大小，決定 Sign-LMS 走哪一個。`,
  },
  {
    id: 'bias-correlators',
    name: 'CHART_BIAS_CORRELATORS',
    title: 'GMAC 是五個平行的相關器',
    section: 'ch11-fixed-point',
    chart: CHART_BIAS_CORRELATORS,
    caption: String.raw`每一項各自乘上 $x$ 取平均，再全部相加。藍色是把 $w$ 拉向 $a$ 的恢復力；offset 與紅色的兩項不隨 $w$ 改變，就是把固定點推離 $a$ 的三個 bias；綠色的雜訊項是 0。`,
  },
  {
    id: 'comparator-model',
    name: 'CHART_COMPARATOR_MODEL',
    title: 'Comparator 的三個模型：實際電路、對雜訊取平均、線性化',
    section: 'ch11-fixed-point',
    chart: CHART_COMPARATOR_MODEL,
    caption: String.raw`三排只有藍色的 comparator 那一塊不同。第一排是實際電路，每個 sample 只輸出 $\pm1$；第二排把雜訊 $v$ 平均掉，得到 S 形曲線 $\operatorname{erf}$（精確，F-11.2）；第三排再用斜率 $K_q$ 的直線取代 S 形曲線（近似，F-11.3），條件是每個 code 的 $|e_\mathrm{det}|$ 都遠小於 $\sigma_v$。`,
  },
  {
    id: 'offset-path',
    name: 'CHART_OFFSET_PATH',
    title: 'Offset 怎麼變成假的 gain 誤差',
    section: 'ch11-offset',
    chart: CHART_OFFSET_PATH,
    caption: String.raw`由左到右跟著藍色的 $b$ 走：乘上平均不為 0 的 code，就留下 $b\,E[x]$；LMS 只能靠改 $w$ 把它抵消（紅色）。虛線：code 置中後這條路的輸出是 0（綠色）。`,
  },
  {
    id: 'dc-null',
    name: 'CHART_DC_NULL',
    title: String.raw`三種主迴路架構：$\varphi$ 由誰決定`,
    section: 'ch11-offset',
    chart: CHART_DC_NULL,
    caption: String.raw`三個框的 comparator 與 GMAC 都一樣，差別只在藍色的積分路徑：(A) 沒有；(B) 積分 $q$，把 $E[q]$ 逼成 0；(C) 積分線性 PD 的 $e_\mathrm{PD}$，comparator 自己的 $b$ 落在迴路之外。每個框裡「GMAC 的固定點」那一塊是它的一階公式。`,
  },
  {
    id: 'servo-dither',
    name: 'CHART_SERVO_DITHER',
    title: 'Servo 的抖動等效於更大的 comparator 雜訊',
    section: 'ch11-offset',
    chart: CHART_SERVO_DITHER,
    caption: String.raw`「實際」那個框：兩個獨立的隨機量（藍色的 servo 抖動與雜訊 $v$）加在 comparator 輸入；「等效」那個框：把它們合併成一個「變異數相加」的等效雜訊，erf 的寬度由 $\sigma_v$ 變成 $\sigma_\mathrm{eff}$。`,
  },
  {
    id: 'centering-tree',
    name: 'CHART_CENTERING_TREE',
    title: 'Code centering 什麼時候真的有效（判斷樹）',
    section: 'ch11-offset',
    chart: CHART_CENTERING_TREE,
    caption: String.raw`由上往下回答四個問題（六角形）；全部走「是／沒有」才到綠色的 $w^*=a$。三個紅色出口分別是靜態 offset bias、dead zone 與勘誤 E17。`,
  },
  {
    id: 'jitter-weight',
    name: 'CHART_JITTER_WEIGHT',
    title: String.raw`Code-dependent $\sigma_v(x)$ 讓 centering 失效（勘誤 E17 的數字）`,
    section: 'ch11-offset',
    chart: CHART_JITTER_WEIGHT,
    caption: String.raw`兩條路只差藍色那一塊：每個 code 的權重 $1/\sigma_v(x)$。$\sigma_v$ 為常數時五個權重相同，$b\,E[x]=0$；$\sigma_v(x)$ 隨 code 變大時，$x<0$ 的權重較大，正負抵銷不了，固定點掉到 $0.9601$。`,
  },
  {
    id: 'dead-zone',
    name: 'CHART_DEAD_ZONE',
    title: String.raw`無雜訊 + offset 的 dead zone（$x\in\{0,1,2,3\}$、$a=1$、$b=1$）`,
    section: 'ch11-offset',
    chart: CHART_DEAD_ZONE,
    caption: String.raw`左邊兩個方塊是 dead zone 外側的兩個區域（$w$ 太小／太大），都把 $w$ 推進紅色的 dead zone；dead zone 整段的平均 GMAC 是 0，所以 $w$ 一進來就停住。虛線：只要有一點雜訊，平坦的一段就變成唯一的零交越。`,
  },
  {
    id: 'best-fit',
    name: 'CHART_BEST_FIT',
    title: String.raw`一條直線只能吸收 INL 裡「與 $x$ 共線」的部分（MSE 觀點）`,
    section: 'ch11-inl',
    chart: CHART_BEST_FIT,
    caption: String.raw`先看藍色的分支：INL 中和 $x$ 成正比的 $0.34x$ 被 gain 吃掉；再看紅色的分支：剩下的殘差與 $x$ 正交，GMAC 的平均看不到它，但它留在每個 code 上。`,
  },
  {
    id: 'mean-vs-median',
    name: 'CHART_MEAN_VS_MEDIAN',
    title: '同樣的兩個意見、三種計票方式',
    section: 'ch11-inl',
    chart: CHART_MEAN_VS_MEDIAN,
    caption: String.raw`最上面是兩組 code 想要的 gain；中間是三種演算法怎麼加權；最下面是答案。注意同一個 1.4：在 MSE 的權重是 1.6（佔八成），在無雜訊 Sign 的票重只有 0.8，卻已經過半。`,
  },
  {
    id: 'identifiability',
    name: 'CHART_IDENTIFIABILITY',
    title: String.raw`Gain 誤差與 $\kappa x$ 走的是同一條路`,
    section: 'ch11-correlated',
    chart: CHART_IDENTIFIABILITY,
    caption: String.raw`藍色與紅色兩個乘法器並聯後直接相加，comparator 只看得到它們的和。以虛線接進來的兩個世界（$a$、$\kappa$ 不同，$a+\kappa$ 相同）產生完全相同的觀測資料。`,
  },
  {
    id: 'coupling-node',
    name: 'CHART_COUPLING_NODE',
    title: String.raw`$w^*=a+\kappa$ 是好是壞：看耦合發生在哪個節點`,
    section: 'ch11-correlated',
    chart: CHART_COUPLING_NODE,
    caption: '綠色出口：干擾本來就在相位路徑上，被一起抵消；紅色出口：干擾只騙到觀測者，校正反而把它寫進輸出。這是研究假說，需以閉迴路模擬或量測確認耦合的節點。',
  },
  {
    id: 'near-integer-path',
    name: 'CHART_NEAR_INTEGER_PATH',
    title: String.raw`加上主 PLL 的誤差路徑：$C$ 與 $B$ 各走哪條路`,
    section: 'ch11-near-integer',
    chart: CHART_NEAR_INTEGER_PATH,
    caption: String.raw`上面的框是誤差路徑：gain 誤差要先經過藍色的 $H_\mathrm{PD}$ 才到 PD（決定 $C$），直接耦合的干擾 $\beta$ 不經過 $H_\mathrm{PD}$（紅色，決定 $B$）；下面的框是 GMAC：把 $q$ 與同一個 $x$ 做相關。`,
  },
  {
    id: 'near-integer-why',
    name: 'CHART_NEAR_INTEGER_WHY',
    title: String.raw`Near-integer 的敏感度鏈：frac 變小 → $C$ 變小 → 三個後果`,
    section: 'ch11-near-integer',
    chart: CHART_NEAR_INTEGER_WHY,
    caption: String.raw`由上往下：sawtooth 的諧波分成頻寬內（負貢獻）與頻寬外（正貢獻）兩群，相加後幾乎抵銷（藍色）；最下面一列是 $C$ 變小的三個後果。`,
  },
  {
    id: 'near-integer-check',
    name: 'CHART_NEAR_INTEGER_CHECK',
    title: String.raw`同一個 $C$ 的兩條獨立算法：時域與頻域`,
    section: 'ch11-near-integer',
    chart: CHART_NEAR_INTEGER_CHECK,
    caption: String.raw`從同一個標準化的 DSM residue 出發，分成兩支。時域那一支：序列真的通過 $H_\mathrm{PD}$（藍色），再取整數個週期平均；頻域那一支：取一個週期做 DFT，把每條諧波的功率乘上 $\mathrm{Re}\,H_\mathrm{PD}$（藍色）再相加。兩個 $C$ 的相對差夠小才採用，這是下面實驗的交叉檢查。`,
  },
  {
    id: 'slope-measure',
    name: 'CHART_SLOPE_MEASURE',
    title: String.raw`量測流程：凍結 gain，在 $w\pm\Delta$ 各量一次斜率 $\hat S$`,
    section: 'ch11-near-integer',
    chart: CHART_SLOPE_MEASURE,
    caption: String.raw`先看藍色的 $\hat S$ 怎麼算：兩次凍結 gain 的平均 GMAC 相減，再除以 $2\Delta$；再看兩個六角形怎麼判讀：$\hat S\le0$ 是極性錯誤，$\hat S$ 為正但遠小於 $K_qE[x^2]$ 代表 $C$ 很小、bias 被放大。`,
  },
  {
    id: 'mc-gaps',
    name: 'CHART_MC_GAPS',
    title: 'Monte Carlo 與 mean-field 之間的三個差距',
    section: 'ch11-lab',
    chart: CHART_MC_GAPS,
    caption: String.raw`上面四個方塊相加才是 Monte Carlo 量到的平均；下面的六角形是 Lab 的判定式（$\mathrm{SE}$ = 平均值的標準誤）。`,
  },
  {
    id: 'finite-step-loop',
    name: 'CHART_FINITE_STEP_LOOP',
    title: String.raw`固定點附近的 block LMS 迴圈：恢復力與曲率`,
    section: 'ch11-lab',
    chart: CHART_FINITE_STEP_LOOP,
    caption: String.raw`全部都是 block rate（索引 $k$）。加法點的三個輸入合成 $G_k$：抽樣雜訊 $\eta_k$（$+$）、恢復力 $S\,\delta w_k$（$-$，藍色）、erf 的曲率項 $\tfrac12G''\delta w_k^2$（$+$，紅色）。只看藍色那條負回授得到 pole $1-g$ 與 $\operatorname{Var}(w)$；紅色那條把抖動整流成偏移。`,
  },
  {
    id: 'verdict-tree',
    name: 'CHART_VERDICT_TREE',
    title: 'GMAC 歸零了——DTC error 是零嗎？（判斷樹）',
    section: 'ch11-levels',
    chart: CHART_VERDICT_TREE,
    caption: '由上往下問四個問題（六角形）。只有一條路走到綠色的出口；其餘紅色出口各對應本章的一節，最後的藍色六角形是 Sign-LMS 專屬的線性化檢查。',
  },
  {
    id: 'handcalc-flow',
    name: 'CHART_HANDCALC_FLOW',
    title: '綜合手算 HC-11.8 的計算順序',
    section: 'ch11-synthesis',
    chart: CHART_HANDCALC_FLOW,
    caption: String.raw`照 ①→⑦ 的順序算；③ 之後分成兩條：一條檢查這個 $w^*$ 對 Sign-LMS 可不可信（④⑤），另一條算收斂速度需要的 $\mu$（⑥⑦）。`,
  },
] as const satisfies readonly Ch11Diagram[]

export type Ch11DiagramId = (typeof CH11_DIAGRAMS)[number]['id']
