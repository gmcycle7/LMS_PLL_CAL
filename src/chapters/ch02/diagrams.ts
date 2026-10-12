/**
 * Ch02 的方塊圖（docs/teaching-style.md §8）。每張圖是一個具名匯出的 Mermaid 原始碼字串，
 * 由 `common.tsx` 的 `<Diagram id="…" />` 顯示，並由 `diagrams.test.tsx` 用真正的 mermaid parser 逐一解析、真的畫一次。
 *
 * 記號約定（和章首的 SystemMap 一致）：
 *  - 圖內的數學一律寫 `$...$`（LaTeX），由共用的 `Mermaid` 元件用 KaTeX 排版（`mermaidMathDelimiters` 會把每個含公式的
 *    雙引號標籤合併成單一 `$$...$$`）；文字照常寫。原始碼用 `String.raw`，TeX 的反斜線只寫一次；換行用 `<br/>`，標籤內不用雙反斜線。
 *  - 逐 sample 的訊號用方括號寫時間索引：圖上的 `$w[n]$`、`$e[n]$`、`$x[n]$` 就是公式裡的 w_n、e_n、x_n；
 *    每個 block 才更新一次的量寫成 `$G_k$`、`$w_k$`（k 是 block 索引）。
 *  - 加法點用圓形 `(("＋"))`，每條進入加法點的線都標上正負號：加號寫全形「＋」；減號在含公式的標籤裡寫成 `$-$`（KaTeX 的減號：
 *    U+2212 放進 `\text{}` 會觸發 KaTeX 的 strict 警告）；延遲寫 `$z^{-1}$`。
 *    不用單獨的半形 `+`／`-` 當標籤：Mermaid 11 會把它當成 Markdown 清單，畫出「Unsupported markdown: list」。
 *    PLL 校正迴圈（`pll-loop`）裡的 PD 也是一個減法器（reference 減 feedback），畫成寫著 `PD` 的圓形，進入它的線同樣標正負號
 *    （標的是那條線上的量對 e 的貢獻：feedback 早到的 y 是 ＋、DTC 補償量 ŷ 是 −；見該圖的註解）。
 *  - 參數誤差極性一律 δ = a − w（勘誤 E39）；誤差 e = y − ŷ（量測減預測）。
 *  - `stateDiagram-v2` 與 `sequenceDiagram` 的文字不會經過 `mermaidMathDelimiters`（它只處理雙引號標籤），所以那兩種圖直接寫成
 *    Mermaid 原生的單一 `$$\text{文字}數學\text{文字}$$`（一個標籤只能有一段 `$$`）。sequence 的 participant 名稱與 loop 標題放公式會畫壞
 *    （上下兩份只有一份排版成功），所以那兩處只寫文字。
 *    flowchart 的 subgraph 標題不要放公式：共用主題把標題縮成 0.86em，KaTeX 內層的 span 會一層層再縮，畫出來只剩 5–8px；
 *    標題只寫文字，式子放在群組裡的方塊上。
 *  - 比較用的圖（並排的方塊群）每個 subgraph 內用 `direction LR`，整體由上往下疊；subgraph 之間不連線（否則 Mermaid 會忽略內部的 direction）。
 *  - 版面（桌機 1280px 的正文欄約 880px 寬；自然寬度超過約 1260px 就要橫向捲動）：長鏈改成由上往下；含回授的迴圈圖（LMS 家族）先宣告
 *    `X --> PR`（乘 w 的那一格），Mermaid 才會把「w 回授」畫成靠邊的一條線、乘 w 的方塊和黑盒子並排，圖比較矮也沒有交叉。
 *  - 狀態圖不要用自己指向自己的轉移：Mermaid 會把它畫成一條又長又尖的怪迴圈；「停留在這個狀態時每步做什麼」寫進狀態的說明
 *    （多行數學用同一個 `$$\begin{gathered}…\cr …\end{gathered}$$`，因為一個狀態的多段 `$$` 說明會被併成同一行）。
 *
 * 顏色（深淺主題都看得清楚）：藍 focus = 這張圖要看的那一格；紅 warn = 貴／非線性／會出問題的那一格；綠 ok = 最省或沒問題的那一格。
 */

const CLASS_FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff'
const CLASS_WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff'
const CLASS_OK = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff'

/* ───────────── 章首 ───────────── */

/** 本章路線圖：每一個箭頭丟掉一種資訊（由上往下：橫排會寬到 1250px、字縮到 0.72 倍）。 */
export const CHART_ROADMAP = String.raw`flowchart TB
  GD["$\S 1$ Gradient Descent<br/>$\Delta w = -\mu J'(w)$<br/>要知道真正的平均坡度"]
  GD -- "平均換成一筆資料" --> LMS["$\S 2$ SGD = LMS<br/>$\Delta w = \mu\,e\,x$<br/>要量誤差的大小"]
  LMS -- "$e$ 換成 $\operatorname{sign}(e)$" --> SE["$\S 3$ Sign-Error<br/>$\Delta w = \mu\operatorname{sign}(e)\,x$<br/>只要 1-bit comparator"]
  SE -- "$x$ 換成 $\operatorname{sign}(x)$" --> SS["$\S 4$ Sign-Sign<br/>$\Delta w = \mu\operatorname{sign}(e)\operatorname{sign}(x)$<br/>只要 XOR 與計數器"]
  LMS -. "步長除以 $\varepsilon + x^2$" .-> NL["$\S 5$ NLMS<br/>$\Delta w = \tilde\mu\,e\,x / (\varepsilon + x^2)$"]
  SE == "硬體實作" ==> PLL["$\S 6$ PLL 的 DTC 校正<br/>comparator 與 GMAC"]
  ${CLASS_FOCUS}
  class SE focus`

/* ───────────── §1 Gradient Descent ───────────── */

/** F-02.1：w[n+1] = w[n] − μ·J'(w[n]) 畫成迴圈。 */
export const CHART_GD_LOOP = String.raw`flowchart LR
  W["目前的位置<br/>$w[n]$"] --> SL["量坡度<br/>$J'(w[n])$"]
  SL --> NEG["$\times (-\mu)$<br/>反方向、乘上步長"]
  NEG -- "＋ $\Delta w[n] = -\mu J'(w[n])$" --> S(("＋"))
  W -- "＋" --> S
  S -- "$w[n+1]$" --> D["$z^{-1}$<br/>等下一步"]
  D --> W
  ${CLASS_FOCUS}
  class SL,NEG focus`

/** 「量坡度」打開來看：固定 x、無雜訊時 −J'(w) = e·x（預測 → 比較 → 乘上 x）。 */
export const CHART_GD_MODEL = String.raw`flowchart TB
  X["輸入 $x[n]$"] --> PR["我們的預測<br/>$\times w[n]$"]
  X --> BB["黑盒子<br/>$\times a$（未知）"]
  BB -- "＋ $y[n] = a\,x[n]$" --> S1(("＋"))
  PR -- "$-$ $\hat y[n] = w[n]\,x[n]$" --> S1
  S1 -- "$e[n] = y[n] - \hat y[n]$" --> MX["$\times x[n]$"]
  X --> MX
  MX -- "$e[n]\,x[n] = -J'(w[n])$" --> MU["$\times \mu$"]
  MU -- "＋ $\Delta w[n] = \mu\,e[n]\,x[n]$" --> S2(("＋"))
  S2 -- "$w[n+1]$" --> D["$z^{-1}$"]
  D -- "＋ $w[n]$" --> S2
  D -- "$w[n]$" --> PR
  ${CLASS_FOCUS}
  class MX focus`

/** F-02.2 之後的 pole：δ[n+1] = (1 − μ·J'')·δ[n]。 */
export const CHART_GD_ERROR_LOOP = String.raw`flowchart LR
  D0["參數誤差<br/>$\delta[n] = a - w[n]$"] --> K["$\times J''$<br/>曲率（固定 $x$ 時是 $x^2$）"]
  K --> MU["$\times \mu$"]
  MU -- "$-$ $\mu\,J''\,\delta[n]$" --> S(("＋"))
  D0 -- "＋" --> S
  S -- "$\delta[n+1] = (1 - \mu J'')\,\delta[n]$" --> Z["$z^{-1}$"]
  Z --> D0
  ${CLASS_FOCUS}
  class K,MU focus`

/* ───────────── §2 Batch GD vs SGD ───────────── */

/** F-02.3：有雜訊時的平均坡度 −J'(w) = E[e·x]（w 在取平均的期間固定不動）。 */
export const CHART_COST_GRADIENT = String.raw`flowchart TB
  X["$x[n]$"] --> BB["$\times a$"]
  BB -- "＋" --> SY(("＋"))
  V(["雜訊 $v[n]$"]) -- "＋" --> SY
  X --> PR["$\times w$"]
  SY -- "＋ $y[n] = a\,x[n] + v[n]$" --> SE(("＋"))
  PR -- "$-$ $w\,x[n]$" --> SE
  SE -- "$e[n] = (a - w)\,x[n] + v[n]$" --> MX["$\times x[n]$"]
  X --> MX
  MX -- "$e[n]\,x[n]$" --> AVG["取平均 $E[\cdot]$<br/>要很多筆資料"]
  AVG --> OUT["$-J'(w) = E[e\,x]$<br/>$= (a - w)\,P_x + E[x\,v]$"]
  ${CLASS_FOCUS}
  class AVG focus`

/** Batch GD／Mini-batch／SGD：只差「累加幾筆、除以幾」。 */
export const CHART_BATCH_VS_SGD = String.raw`flowchart TB
  subgraph BG["Batch GD：全部看完才更新一次"]
    direction LR
    B1["$e[i]\,x[i]$<br/>$i = 1 \ldots N$"] --> B2["累加 $N$ 筆"] --> B3["$\div N$"] --> B4["$\times \mu$"] --> B5["$w$ 加上更新量<br/>每 $N$ 筆一次"]
  end
  subgraph MB["Mini-batch：每個 block 更新一次"]
    direction LR
    M1["$e[i]\,x[i]$"] --> M2["累加 $B$ 筆<br/>（GMAC）"] --> M3["$\div B$"] --> M4["$\times \mu$"] --> M5["$w$ 加上更新量<br/>每 $B$ 筆一次"]
  end
  subgraph SG["SGD = LMS：每一筆都更新"]
    direction LR
    G1["$e[n]\,x[n]$"] --> G4["$\times \mu$"] --> G5["$w$ 加上更新量<br/>每筆一次"]
  end
  BG ~~~ MB
  MB ~~~ SG
  ${CLASS_FOCUS}
  class B2,B3,M2,M3 focus`

/** F-02.4／F-02.5／F-02.16：單筆坡度 = 真正的坡度 + 平均為 0 的梯度雜訊。 */
export const CHART_SGD_NOISE = String.raw`flowchart LR
  TRUE["真正的坡度<br/>$J'(w[n])$"] -- "＋" --> S1(("＋"))
  GN(["梯度雜訊<br/>平均是 $0$（不偏）<br/>變異不是 $0$（會抖）"]) -- "＋" --> S1
  S1 -- "單筆坡度 $\hat g[n] = -e[n]\,x[n]$" --> NEG["$\times (-\mu)$"]
  NEG -- "＋ $\mu\,e[n]\,x[n]$" --> S2(("＋"))
  W["$w[n]$"] -- "＋" --> S2
  S2 --> W1["$w[n+1]$"]
  ${CLASS_WARN}
  class GN warn`

/** Mini-batch 的時間軸：sample（n）與 block（k）兩種速率。 */
export const CHART_BLOCK_TIMING = String.raw`sequenceDiagram
  participant C as comparator<br/>每個 sample 動一次
  participant G as GMAC 累加器
  participant W as 係數<br/>每個 block 才更新一次
  Note over C,W: $$\text{第 }k\text{ 個 block 開始，整個 block 都用同一個 }w_k$$
  loop 這個 block 裡的每一個 sample
    C->>G: $$q[n]\text{，乘上 }x[n]\text{ 後加進累加器}$$
  end
  G->>W: $$G_k = \frac{1}{N}\sum q[n]\,x[n]$$
  Note over W: $$\text{係數更新：}w_{k+1} = w_k + \mu\,G_k$$
  W-->>C: $$\text{下一個 block 改用新的 }w$$
  Note over G: 累加器歸零，開始下一個 block`

/** F-02.5：完整的 LMS（= SGD）迴圈，含雜訊；§3、§4 的 Sign 類都是在這張圖上動手術。 */
export const CHART_LMS_LOOP = String.raw`flowchart TB
  X["$x[n]$"] --> PR["$\times w[n]$"]
  X --> BB["$\times a$"]
  BB -- "＋" --> SY(("＋"))
  V(["雜訊 $v[n]$"]) -- "＋" --> SY
  SY -- "＋ $y[n]$" --> SUM(("＋"))
  PR -- "$-$ $\hat y[n]$" --> SUM
  SUM -- "$e[n]$" --> MX["$\times x[n]$<br/>相關器"]
  X --> MX
  MX -- "$e[n]\,x[n] = -\hat g[n]$" --> MU["$\times \mu$"]
  MU -- "＋ $\Delta w[n]$" --> ACC(("＋"))
  ACC -- "$w[n+1]$" --> D["$z^{-1}$"]
  D -- "＋ $w[n]$" --> ACC
  D -- "$w[n]$" --> PR
  ${CLASS_FOCUS}
  class MX focus`

/* ───────────── §3 Sign-Error ───────────── */

/** F-02.6：Sign-Error 的迴圈；和 LMS 只差 sign(·) 這一格。 */
export const CHART_SIGN_ERROR_LOOP = String.raw`flowchart TB
  X["$x[n]$"] --> PR["$\times w[n]$"]
  X --> BB["$\times a$"]
  BB -- "＋" --> SY(("＋"))
  V(["雜訊 $v[n]$"]) -- "＋" --> SY
  SY -- "＋ $y[n]$" --> SUM(("＋"))
  PR -- "$-$ $\hat y[n]$" --> SUM
  SUM -- "$e[n]$" --> SGN["$\operatorname{sign}(\cdot)$<br/>1-bit comparator"]
  SGN -- "$q[n] = \operatorname{sign}(e[n])$" --> MX["$\times x[n]$<br/>條件取負"]
  X --> MX
  MX -- "$\operatorname{sign}(e[n])\,x[n]$" --> MU["$\times \mu$"]
  MU -- "＋ $\Delta w[n]$" --> ACC(("＋"))
  ACC -- "$w[n+1]$" --> D["$z^{-1}$"]
  D -- "＋ $w[n]$" --> ACC
  D -- "$w[n]$" --> PR
  ${CLASS_FOCUS}
  class SGN focus`

/** F-02.10：固定步長、固定 x、無雜訊時的 period-2 limit cycle（0 < ρ < h）。 */
export const CHART_LIMIT_CYCLE = String.raw`stateDiagram-v2
  direction LR
  [*] --> FAR
  FAR: 等速接近
  FAR: $$\begin{gathered}\text{離 }a\text{ 還有一步以上}\cr \text{每步靠近 }h = \mu\,|x|\end{gathered}$$
  FAR --> P1: $$\text{走完 }n_c\text{ 步}$$
  P1: $$\text{還沒越過 }a$$
  P1: $$w = a - \operatorname{sgn}(\delta_0)\,\rho$$
  P2: $$\text{剛越過 }a$$
  P2: $$w = a + \operatorname{sgn}(\delta_0)\,(h - \rho)$$
  P1 --> P2: $$\text{再走一步 }h\text{，越過 }a$$
  P2 --> P1: $$\text{往回走一步 }h$$
  ${CLASS_WARN}
  class P1,P2 warn`

/** ρ = 0（剛好踩到 a）時由 sign(0) 的慣例決定（勘誤 E40）。 */
export const CHART_TIE_RULE = String.raw`flowchart TB
  L["剛好踩到 $a$（$\rho = 0$）<br/>$e = 0$"] --> Q{"$\operatorname{sign}(0)$ 規定成什麼？"}
  Q -- "$0$：數學次梯度" --> F["$\Delta w = 0$<br/>凍結在 $a$"]
  Q -- "$+1$：comparator 的 tie 輸出 $+1$" --> P["$\Delta w = +\mu\,x$<br/>在 $a$ 與 $a + \mu\,x$ 之間跳"]
  Q -- "$-1$：comparator 的 tie 輸出 $-1$" --> M["$\Delta w = -\mu\,x$<br/>在 $a$ 與 $a - \mu\,x$ 之間跳"]
  ${CLASS_OK}
  ${CLASS_WARN}
  class F ok
  class P,M warn`

/** F-02.12：硬的 sign 加上雜訊，平均起來等效成線性增益 K_SE = K_q·E[x²]。 */
export const CHART_MEAN_FIELD = String.raw`flowchart TB
  subgraph NL["真實的迴路：硬的 sign，加上雜訊"]
    direction LR
    D1["$d = a - w$"] --> X1["$\times x$"]
    XS(["輸入 $x$（同一筆）"]) --> X1
    XS --> X2
    X1 -- "＋ $d\,x$" --> S1(("＋"))
    V1(["雜訊 $v$"]) -- "＋" --> S1
    S1 -- "$e$" --> SG["$\operatorname{sign}(\cdot)$"]
    SG --> X2["$\times x$"]
    X2 --> AV["取平均 $E[\cdot]$<br/>得到 $\psi_{\mathrm{SE}}(w)$"]
  end
  subgraph LIN["誤差很小時的等效：一個線性增益"]
    direction LR
    D2["$d = a - w$"] --> KQ["$\times K_q$<br/>$= 2\,f_v(0)$"]
    KQ --> PX["$\times E[x^2]$"]
    PX --> P2["$\psi_{\mathrm{SE}}(w) \approx K_{\mathrm{SE}}\,d$"]
  end
  NL ~~~ LIN
  ${CLASS_WARN}
  ${CLASS_FOCUS}
  class SG warn
  class KQ focus`

/** F-02.11：遞減步長與 Robbins–Monro 的兩筆帳。 */
export const CHART_STEP_SCHEDULE = String.raw`flowchart LR
  N["步數計數器 $n$"] --> SCH["步長排程<br/>$\mu[n] = \mu_0 / (1 + n/n_0)$"]
  SCH --> MUL["$\times \mu[n]$"]
  Q["$\operatorname{sign}(e[n])\,x[n]$"] --> MUL
  MUL -- "＋ $\Delta w[n]$" --> ACC(("＋"))
  ACC -- "$w[n+1]$" --> D["$z^{-1}$"]
  D -- "＋ $w[n]$" --> ACC
  SCH --> B1["第一筆帳：能走多遠<br/>每步最多走 $\mu[n]\,|x|$<br/>加總必須是無限大"]
  SCH --> B2["第二筆帳：累積多少抖動<br/>每步加進 $\mu[n]^2\,\sigma_\eta^2$<br/>加總必須有限"]
  ${CLASS_FOCUS}
  ${CLASS_OK}
  ${CLASS_WARN}
  class SCH focus
  class B1 ok
  class B2 warn`

/** Gear-shift：硬體友善的遞減步長（sgd.ts 的 'gear' 排程）。 */
export const CHART_GEAR_SHIFT = String.raw`stateDiagram-v2
  direction LR
  [*] --> COARSE
  COARSE: 粗調
  COARSE: $$\text{步長 }\mu_0\text{，大步走得快}$$
  COARSE --> SHIFT: $$\text{過了 }n_0\text{ 步}$$
  SHIFT: 換檔
  SHIFT: $$\begin{gathered}\text{步長右移一位（減半）}\cr \text{每 }n_0\text{ 步再右移一位}\end{gathered}$$
  SHIFT --> TRACK: $$\text{降到下限 }\mu_{\min}$$
  TRACK: 追蹤
  TRACK: $$\text{步長停在 }\mu_{\min}\text{，不再變小}$$
  ${CLASS_FOCUS}
  ${CLASS_OK}
  class SHIFT focus
  class TRACK ok`

/* ───────────── §4 Sign-Sign ───────────── */

/** F-02.7：Sign-Sign 的迴圈；和 Sign-Error 只差 x 路徑上的 sign(·)。 */
export const CHART_SIGN_SIGN_LOOP = String.raw`flowchart TB
  X["$x[n]$"] --> PR["$\times w[n]$"]
  X --> BB["$\times a$"]
  BB -- "＋" --> SY(("＋"))
  V(["雜訊 $v[n]$"]) -- "＋" --> SY
  SY -- "＋ $y[n]$" --> SUM(("＋"))
  PR -- "$-$ $\hat y[n]$" --> SUM
  SUM -- "$e[n]$" --> SGE["$\operatorname{sign}(\cdot)$<br/>1-bit comparator"]
  X --> SGX["$\operatorname{sign}(\cdot)$<br/>只留 $x$ 的正負號"]
  SGE -- "$\operatorname{sign}(e[n])$" --> XOR["XOR<br/>兩個正負號相乘"]
  SGX -- "$\operatorname{sign}(x[n])$" --> XOR
  XOR -- "$+1$ 或 $-1$" --> CNT["up / down counter<br/>$w[n+1] = w[n] \pm \mu$"]
  CNT -- "$w[n]$" --> PR
  ${CLASS_FOCUS}
  class SGX focus`

/** F-02.9：比值觀點——四種演算法都在估計 r = y/x 的「中心」。 */
export const CHART_RATIO_VIEW = String.raw`flowchart LR
  DATA["每一筆資料<br/>$x[i]$、$y[i]$"] --> R["比值 $r[i] = y[i] / x[i]$<br/>$= a + v[i] / x[i]$"]
  R --> A1["LMS<br/>用 $x^2$ 加權的平均"]
  R --> A2["Sign-Error<br/>用 $|x|$ 加權的中位數"]
  R --> A3["Sign-Sign<br/>不加權的中位數"]
  R --> A4["NLMS（$\varepsilon = 0$）<br/>不加權的平均"]
  ${CLASS_FOCUS}
  ${CLASS_OK}
  class A1,A4 focus
  class A2,A3 ok`

/** F-02.8：三種固定點條件 = 三個相關器的輸出平均為 0。 */
export const CHART_FIXED_POINTS = String.raw`flowchart LR
  E["誤差 $e$"] --> M1(("$\times$"))
  X["輸入 $x$"] --> M1
  E --> SE["$\operatorname{sign}(\cdot)$"]
  SE --> M2(("$\times$"))
  X --> M2
  SE --> M3(("$\times$"))
  X --> SX["$\operatorname{sign}(\cdot)$"]
  SX --> M3
  M1 --> A1["取平均 $E[\cdot]$"]
  M2 --> A2["取平均 $E[\cdot]$"]
  M3 --> A3["取平均 $E[\cdot]$"]
  A1 --> Z1["LMS 停在<br/>$E[e\,x] = 0$"]
  A2 --> Z2["Sign-Error 停在<br/>$E[\operatorname{sign}(e)\,x] = 0$"]
  A3 --> Z3["Sign-Sign 停在<br/>$E[\operatorname{sign}(e)\operatorname{sign}(x)] = 0$"]
  ${CLASS_FOCUS}
  class SE,SX focus`

/** F-02.18：固定點會不會偏離 a 的判斷流程。 */
export const CHART_PSI_AT_A = String.raw`flowchart TB
  S["把 $w = a$ 代進去<br/>誤差只剩雜訊：$e = v$"] --> Q1{"code 對稱嗎？<br/>$E[x] = 0$ 而且 $E[\operatorname{sign} x] = 0$"}
  Q1 -- "是" --> OK1["三個固定點都是 $a$<br/>不論雜訊長什麼樣"]
  Q1 -- "否" --> Q2{"雜訊的平均與中位數都是 $0$ 嗎？<br/>$E[v] = 0$ 而且 $E[\operatorname{sign} v] = 0$"}
  Q2 -- "是" --> OK2["三個固定點都是 $a$<br/>不論 code 長什麼樣"]
  Q2 -- "否" --> CHK["逐一檢查 $\psi(a)$，不是 $0$ 的那個就偏離 $a$<br/>LMS：$E[v]\,E[x]$<br/>Sign-Error：$E[\operatorname{sign} v]\,E[x]$<br/>Sign-Sign：$E[\operatorname{sign} v]\,E[\operatorname{sign} x]$"]
  ${CLASS_OK}
  ${CLASS_WARN}
  class OK1,OK2 ok
  class CHK warn`

/* ───────────── §5 比較 ───────────── */

/** 資訊量 vs 硬體成本：error 與 regressor 各用幾個位元。 */
export const CHART_INFO_MAP = String.raw`flowchart TB
  A["LMS<br/>NLMS、Huber 也在這一格<br/>error 多位元、<br/>regressor 多位元<br/>TDC 或 ADC，加上乘法器"]
  A -- "丟掉 $e$ 的大小" --> C["Sign-Error<br/>error 1 bit、<br/>regressor 多位元<br/>comparator，加上條件取負"]
  A -. "丟掉 $x$ 的大小" .-> B["Signed-regressor LMS<br/>error 多位元、<br/>regressor 1 bit<br/>本章不討論"]
  C -- "再丟掉 $x$ 的大小" --> D["Sign-Sign<br/>error 1 bit、<br/>regressor 1 bit<br/>XOR，加上<br/>up / down counter"]
  B -. "再丟掉 $e$ 的大小" .-> D
  ${CLASS_WARN}
  ${CLASS_FOCUS}
  ${CLASS_OK}
  class A warn
  class C focus
  class D ok`

/** 三種 stepper 的硬體資料路徑（原有的圖；差異的那一格上色）。 */
export const CHART_DATAPATH = String.raw`flowchart TB
  subgraph L["LMS：多位元乘法"]
    direction LR
    E1["$e$：TDC / ADC（$B_e$ bits）"] --> M1["乘法器 $B_e \times B_x$"]
    X1["$x$（$B_x$ bits）"] --> M1
    M1 --> S1["$\times \mu$（shift）"] --> A1["累加器 $w$"]
  end
  subgraph SE["Sign-Error：條件取負"]
    direction LR
    Q2["$q = \operatorname{sign}(e)$：comparator 1 bit"] --> N2["MUX：$q\,?\,x : -x$"]
    X2["$x$（$B_x$ bits）"] --> N2
    N2 --> S2["$\times \mu$（shift）"] --> A2["累加器 $w$"]
  end
  subgraph SS["Sign-Sign：XOR + 計數器"]
    direction LR
    Q3["$q$：1 bit"] --> X3["XOR"]
    B3["$\operatorname{sign}(x)$：1 bit"] --> X3
    X3 --> C3["up / down counter（步長 $\mu$）"]
  end
  L ~~~ SE
  SE ~~~ SS
  ${CLASS_WARN}
  ${CLASS_FOCUS}
  ${CLASS_OK}
  class M1 warn
  class N2 focus
  class X3 ok`

/** F-02.13／F-02.14：線性化後的穩態抖動模型 δ[n+1] ≈ (1 − μK)·δ[n] + μ·η[n]。 */
export const CHART_NOISE_LOOP = String.raw`flowchart LR
  ETA(["梯度雜訊 $\eta[n]$<br/>變異 $\sigma_\eta^2$"]) --> MU["$\times \mu$"]
  MU -- "＋ $\mu\,\eta[n]$" --> S(("＋"))
  D0["$\delta[n]$"] --> P["$\times (1 - \mu K)$<br/>pole $p$"]
  P -- "＋ $(1 - \mu K)\,\delta[n]$" --> S
  S -- "$\delta[n+1]$" --> Z["$z^{-1}$"]
  Z --> D0
  ${CLASS_FOCUS}
  ${CLASS_WARN}
  class P focus
  class ETA warn`

/** F-02.15：NLMS 的資料路徑；和 LMS 只差「除以 ε + x²」。 */
export const CHART_NLMS_DATAPATH = String.raw`flowchart TB
  subgraph L["LMS：步長固定"]
    direction LR
    E1["$e[n]$"] --> M1["$\times x[n]$"] --> S1["$\times \mu$"] --> A1["累加器 $w$"]
  end
  subgraph NL["NLMS：步長跟著輸入功率走"]
    direction LR
    E2["$e[n]$"] --> M2["$\times x[n]$"] --> DV["$\div (\varepsilon + x[n]^2)$<br/>用輸入功率正規化"] --> S2["$\times \tilde\mu$"] --> A2["累加器 $w$"]
    X2["$x[n]$"] --> SQ["平方<br/>$x[n]^2$"] --> DV
  end
  L ~~~ NL
  ${CLASS_FOCUS}
  class DV,SQ focus`

/* ───────────── §6 連到 PLL ───────────── */

/**
 * Block Sign-Error LMS 在 DTC 校正裡的樣子：把 §3 的 Sign-Error 迴圈（e = y − ŷ，y = a·x + v，ŷ = w·x）對應到硬體，
 * 差別只有更新速率：x[n]、e[n]、q[n] 每個 sample 一筆（索引 n），G_k 與 w_k 每個 block（N 筆）一筆（索引 k）。
 *
 * 架構照全站約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端（Reference clock → DTC → PD），回授路徑上只有 divider；
 * divider 的 feedback edge 比理想時刻早到 y = a·x：t_fb = t_id − y。DTC 只能延遲，所以方塊上寫的是它的延遲 τ_DTC = T_0 − w_k·x
 * 與補償量 ŷ = w_k·x（從基準延遲 T_0 往回扣，reference edge 少延遲的時間）：t_ref′ = t_id − ŷ（T_0 併在 t_id 裡）。
 * PD 量 reference 減 feedback：e = t_ref′ − t_fb = y − ŷ（+ v）不變。所以進 PD 的兩條線標的是「早到的時間對 e 的貢獻」
 * （y 標 ＋、ŷ 標 −），不是 PD 兩個輸入端的極性。comparator 的輸入取自 PD 的輸出 e[n]，
 * 也就是送進 loop filter 的同一個訊號（圖上 PD 有兩條出線：e[n] → loop filter、e[n] → comparator）。
 * VCO → divider 那一段回授只在 loop filter 方塊上用文字註明：真的畫一條線（或多畫一個 VCO 節點）的話，不是 divider 被排到 PD 下面、
 * DTC 被排到最下面，就是那條線從 DTC 方塊後面穿過去，看起來像 VCO 接到 DTC（瀏覽器實測過）。完整的迴路在章首的 SystemMap。
 * 極性沿用本章約定 e = y − ŷ（校正迴路的極性接反會怎樣，是 Ch06 的主題）。
 */
export const CHART_PLL_LOOP = String.raw`flowchart TB
  REF(["Reference clock"]) --> DTC["reference 端的 DTC<br/>延遲 $\tau_{\mathrm{DTC}} = T_0 - w_k\,x[n]$<br/>補償量 $\hat y = w_k\,x[n]$"]
  X["DSM 殘差 code<br/>$x[n]$"] --> DTC
  X --> FB["divider 的 feedback edge<br/>比理想時刻早到<br/>$y = a\,x[n]$"]
  FB -- "＋ $y[n]$" --> S(("PD"))
  DTC -- "$-$ $\hat y[n]$" --> S
  V(["comparator 前雜訊<br/>$v[n]$"]) -- "＋" --> S
  S -- "$e[n]$" --> LF["loop filter → VCO<br/>（主迴路：VCO 再經<br/>divider 回到 PD）"]
  S -- "$e[n] = (a - w_k)\,x[n] + v[n]$" --> CMP["comparator<br/>$q[n] = \operatorname{sign}(e[n])$"]
  CMP --> GMAC["GMAC：每個 sample 累加 $q[n]\,x[n]$<br/>每 $N$ 個 sample 交出<br/>$G_k = \frac{1}{N}\sum q[n]\,x[n]$"]
  X --> GMAC
  GMAC -- "$G_k$" --> MU["$\times \mu$"]
  MU -- "＋ $\mu\,G_k$" --> ACC(("＋"))
  ACC -- "$w_{k+1}$" --> Z["$z^{-1}$<br/>每個 block 一次"]
  Z -- "＋ $w_k$" --> ACC
  Z -- "$w_k$" --> DTC
  ${CLASS_FOCUS}
  ${CLASS_WARN}
  class CMP,GMAC focus
  class V warn`

/** 綜合手算 HC-02.8 的計算順序。 */
export const CHART_DESIGN_FLOW = String.raw`flowchart TB
  IN(["已知：雜訊 $\sigma_v$、code 幅度 $A$、步長 $\mu$"]) --> KQ["$K_q = \sqrt{2/\pi}\,/\,\sigma_v$<br/>comparator 的增益"]
  IN --> PX["$E[x^2] = A^2$、$E[x^4] = A^4$<br/>code 的功率"]
  KQ --> KSE["$K_{\mathrm{SE}} = K_q\,E[x^2]$"]
  PX --> KSE
  KSE --> G["$g = \mu\,K_{\mathrm{SE}}$"]
  G --> P["pole $p = 1 - g$"]
  P --> TAU["時間常數 $\tau = -1 / \ln|p|$"]
  PX --> SN["梯度雜訊 $\sigma_\eta^2 = E[x^2]$"]
  G --> VAR["$\operatorname{Var}_{\mathrm{SE}} \approx \mu\,\sigma_\eta^2 / (K_{\mathrm{SE}}\,(2 - g))$"]
  SN --> VAR
  VAR --> SW["抖動 $\sigma_w = \sqrt{\operatorname{Var}_{\mathrm{SE}}}$"]
  G --> MUL["同速度的 LMS 步長<br/>$\mu_L = g / E[x^2]$"]
  MUL --> VL["$\operatorname{Var}_{\mathrm{LMS}} =$<br/>$\mu_L\,\sigma_v^2\,E[x^2] / (2\,E[x^2] - \mu_L\,E[x^4])$"]
  VAR --> R["$\operatorname{Var}_{\mathrm{SE}} / \operatorname{Var}_{\mathrm{LMS}} = \pi/2$"]
  VL --> R
  ${CLASS_FOCUS}
  ${CLASS_OK}
  class KSE,G focus
  class TAU,SW,R ok`

/* ───────────── 登錄表 ───────────── */

export type DiagramKind = 'flowchart' | 'state' | 'sequence'

export interface Ch02Diagram {
  /** `<Diagram id>` 用的識別碼（也是 DOM 上的 data-diagram） */
  id: string
  /** 圖的種類（對應 mermaid.parse 回傳的 diagramType） */
  kind: DiagramKind
  /** Mermaid 原始碼 */
  chart: string
  /** 圖說：一句話說明要看什麼。<Mermaid caption> 支援 `$...$` 行內 LaTeX，圖說裡的數學一律這樣寫（不用 Unicode 拼）；圖內標籤的數學同樣寫 `$...$`。 */
  caption: string
  /** 這張圖說明的公式（F-02.x）：圖一律放在這些公式之前——先看圖，再看數學。 */
  formulas?: readonly string[]
  /** 這張圖要放在哪一題手算（HC-02.x）之前（手算流程圖）。 */
  beforeHandCalc?: string
  /** 是否為這次新增的圖（原有的兩張 datapath、pll-loop 為 false；pll-loop 已改成含加法點的完整版） */
  added: boolean
}

/** 依章內出現順序排列。 */
export const DIAGRAMS = [
  {
    id: 'roadmap',
    kind: 'flowchart',
    chart: CHART_ROADMAP,
    caption: '本章路線圖：由上到下，每一個箭頭丟掉一種資訊、省掉一種硬體。藍色的 Sign-Error 就是 PLL 校正實際使用的更新式。',
    added: true,
  },
  {
    id: 'gd-loop',
    kind: 'flowchart',
    chart: CHART_GD_LOOP,
    caption: '梯度下降的迴圈：先看藍色的兩格（量坡度、乘上負的步長），再沿著箭頭繞一圈。每繞一圈就是走一步。',
    formulas: ['F-02.1'],
    added: true,
  },
  {
    id: 'gd-model',
    kind: 'flowchart',
    chart: CHART_GD_MODEL,
    caption: '把上一張圖的「量坡度」打開來看：先預測、和量測值相減、再乘上輸入（藍色），得到的就是負的坡度。',
    added: true,
  },
  {
    id: 'gd-error-loop',
    kind: 'flowchart',
    chart: CHART_GD_ERROR_LOOP,
    caption: '同一個迴圈改用參數誤差來畫：每繞一圈，誤差被減掉固定的比例（藍色兩格的乘積）。這個比例太大就會衝過頭。',
    formulas: ['F-02.2'],
    added: true,
  },
  {
    id: 'cost-gradient',
    kind: 'flowchart',
    chart: CHART_COST_GRADIENT,
    caption: '有雜訊時的平均坡度：誤差先乘上輸入，再取很多筆的平均（藍色）。藍色這一格就是接下來要想辦法省掉的東西。',
    formulas: ['F-02.3'],
    added: true,
  },
  {
    id: 'batch-vs-sgd',
    kind: 'flowchart',
    chart: CHART_BATCH_VS_SGD,
    caption: '三種做法只差藍色的兩格：累加幾筆、除以幾。SGD 那一排把這兩格整個拿掉，每來一筆就更新。',
    added: true,
  },
  {
    id: 'lms-loop',
    kind: 'flowchart',
    chart: CHART_LMS_LOOP,
    caption: '完整的 LMS 迴圈（含雜訊）：藍色的相關器把誤差乘上輸入，得到單筆的負坡度。後面兩節的 Sign 類演算法，都是在這張圖上改一兩個方塊。',
    formulas: ['F-02.5'],
    added: true,
  },
  {
    id: 'sgd-noise',
    kind: 'flowchart',
    chart: CHART_SGD_NOISE,
    caption: '單筆坡度等於真正的坡度加上一個平均為零的雜訊（紅色）：方向平均來說是對的，但每一步都會被雜訊推一下。',
    formulas: ['F-02.4', 'F-02.5', 'F-02.16'],
    added: true,
  },
  {
    id: 'block-timing',
    kind: 'sequence',
    chart: CHART_BLOCK_TIMING,
    caption: '時間軸：comparator 與 GMAC 每個 sample 動一次，係數每個 block 才更新一次。同一個 block 內用的是同一個係數。',
    added: true,
  },
  {
    id: 'sign-error-loop',
    kind: 'flowchart',
    chart: CHART_SIGN_ERROR_LOOP,
    caption: '和 LMS 的迴圈只差藍色這一格：誤差先通過 1-bit comparator 只留下正負號，後面的乘法因此變成「加或減」輸入。',
    formulas: ['F-02.6'],
    added: true,
  },
  {
    id: 'limit-cycle',
    kind: 'state',
    chart: CHART_LIMIT_CYCLE,
    caption: '固定步長的 Sign-Error：先等速走到目標附近，之後永遠在紅色的兩個狀態之間來回跳，不會停。',
    formulas: ['F-02.10'],
    added: true,
  },
  {
    id: 'tie-rule',
    kind: 'flowchart',
    chart: CHART_TIE_RULE,
    caption: '剛好踩到目標時誤差是零，下一步完全由「零的正負號」怎麼規定來決定：三條分支、三種結果。',
    added: true,
  },
  {
    id: 'mean-field',
    kind: 'flowchart',
    chart: CHART_MEAN_FIELD,
    caption: '兩個框的輸入與輸出相同：一個是真實的迴路（紅色的硬判決加上雜訊），另一個是誤差很小時的等效，整串換成一個線性增益（藍色）。',
    formulas: ['F-02.12'],
    added: true,
  },
  {
    id: 'step-schedule',
    kind: 'flowchart',
    chart: CHART_STEP_SCHEDULE,
    caption: '遞減步長：藍色的排程器讓步長隨步數變小。右邊兩格是它必須同時滿足的兩筆帳：總距離要無限、累積的抖動要有限。',
    formulas: ['F-02.11'],
    added: true,
  },
  {
    id: 'gear-shift',
    kind: 'state',
    chart: CHART_GEAR_SHIFT,
    caption: '硬體友善的做法：先用大步長粗調，再每隔固定步數把步長右移一位（藍色），最後停在下限以保留追蹤能力（綠色）。',
    added: true,
  },
  {
    id: 'sign-sign-loop',
    kind: 'flowchart',
    chart: CHART_SIGN_SIGN_LOOP,
    caption: '比 Sign-Error 的迴圈再多一格藍色：輸入也只留正負號。兩個正負號用 XOR 相乘，更新器只剩一個上下數的計數器。',
    formulas: ['F-02.7'],
    added: true,
  },
  {
    id: 'ratio-view',
    kind: 'flowchart',
    chart: CHART_RATIO_VIEW,
    caption: '每一筆資料都先變成一個比值，四種演算法只是用不同的方式取這些比值的「中心」：藍色是平均類，綠色是中位數類。',
    formulas: ['F-02.9'],
    added: true,
  },
  {
    id: 'fixed-points',
    kind: 'flowchart',
    chart: CHART_FIXED_POINTS,
    caption: '三個相關器並排：輸入相同，只差有沒有先取正負號（藍色）。每個演算法停在自己那個相關器的平均輸出為零的地方。',
    formulas: ['F-02.8'],
    added: true,
  },
  {
    id: 'psi-at-a',
    kind: 'flowchart',
    chart: CHART_PSI_AT_A,
    caption: '判斷固定點會不會偏離真值的流程：先看 code 是否對稱，再看雜訊的平均與中位數；兩關都沒過才需要逐一檢查。',
    formulas: ['F-02.18'],
    added: true,
  },
  {
    id: 'info-map',
    kind: 'flowchart',
    chart: CHART_INFO_MAP,
    caption: '資訊量對硬體成本：最上面用到最多位元，最下面只用兩個正負號。實線是本章走的路；虛線那一格本章不討論。',
    added: true,
  },
  {
    id: 'datapath',
    kind: 'flowchart',
    chart: CHART_DATAPATH,
    caption:
      '三條資料路徑只差上色的那一格：紅色是乘法器、藍色是條件取負、綠色是 XOR。示意：步長通常取 2 的冪（用右移實現），所以 Sign-Error 的每步更新只需要一個 MUX 選「加」或「減」regressor。',
    added: false,
  },
  {
    id: 'noise-loop',
    kind: 'flowchart',
    chart: CHART_NOISE_LOOP,
    caption: '穩態抖動的模型：梯度雜訊（紅色）乘上步長後注入一個一階迴路。藍色的 pole 越靠近一，雜訊被平均得越多，但收斂也越慢。',
    formulas: ['F-02.13', 'F-02.14'],
    added: true,
  },
  {
    id: 'nlms-datapath',
    kind: 'flowchart',
    chart: CHART_NLMS_DATAPATH,
    caption: '和 LMS 只差藍色的兩格：把輸入平方、再用它去除更新量。輸入變大十倍，更新量會自動縮回來。',
    formulas: ['F-02.15'],
    added: true,
  },
  {
    id: 'pll-loop',
    kind: 'flowchart',
    chart: CHART_PLL_LOOP,
    caption: 'Block Sign-Error LMS 在 DTC 校正裡的樣子：DTC 在 reference 端、回授路徑只有 divider，comparator 取的是 PD 的輸出（和送進 loop filter 的是同一個訊號）。更新迴圈和 Sign-Error 相同，只是一個 block（$N$ 個 sample）才更新一次。藍色是 comparator 與 GMAC，紅色是它前面的雜訊。',
    added: false,
  },
  {
    id: 'design-flow',
    kind: 'flowchart',
    chart: CHART_DESIGN_FLOW,
    caption: '綜合手算的計算順序：由上往下，每一格只用到它上面已經算好的數。藍色是迴路增益，綠色是三個要交出去的答案。',
    beforeHandCalc: 'HC-02.8',
    added: true,
  },
] as const satisfies readonly Ch02Diagram[]

export type DiagramId = (typeof DIAGRAMS)[number]['id']

export const DIAGRAM_BY_ID: Record<DiagramId, Ch02Diagram> = Object.fromEntries(DIAGRAMS.map((d) => [d.id, d])) as Record<DiagramId, Ch02Diagram>
