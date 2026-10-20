import type { SystemBlock } from '@/components'

/**
 * Ch14 的方塊圖原始碼（docs/teaching-style.md §8）。
 *
 * 規則：
 * - 節點與連線的雙引號標籤裡，數學一律寫 `$...$`（LaTeX），由共用的 `Mermaid` 元件用 KaTeX 排版；文字、單位與方塊名稱照常寫。
 *   原始碼用 `String.raw` 樣板字串，所以 TeX 的反斜線只寫一次；標籤內不要用 `\\`（Mermaid 會收成一個），換行用 `<br/>`。
 *   TeX 語法錯誤會讓圖畫不出來（diagrams.test.tsx 的真實渲染會丟出例外）。含括號、冒號、等號等特殊字元的標籤一律用雙引號包住。
 * - 加法點用圓形節點、邊上標正負號；延遲寫 `$z^{-1}$`、累加器寫 `$1/(z-1)$`。
 * - 純正負號的標籤照舊寫全形「＋」與減號「−」（U+2212），不含公式所以不經 KaTeX；和文字、公式混在同一個標籤時寫 `$+$`、`$-$`
 *   （KaTeX 的 \text 不認得 U+2212）。Mermaid 11 把標籤當 Markdown 解讀，單獨的 ASCII「+」「-」
 *   （或以「+ 」「- 」「1. 」「# 」開頭的標籤）會被當成清單／標題，畫面上顯示成「Unsupported markdown: list」。
 *   同理，標籤裡不寫緊接字母的「<」（會被當成 HTML 標籤吃掉），改用 `\lt`、`\le`、`\ll` 或文字。
 * - stateDiagram-v2：`state "…" as X` 的雙引號標籤支援 `$...$`；轉移（`A --> B : 文字`）的文字沒有引號，
 *   前處理不會處理，要寫公式時整段手寫成 `$$\text{文字 }n\text{ 文字}$$`（Mermaid 原生語法）。subgraph 標題支援 `$...$`。
 * - 每張圖的訊號名稱、正負號、箭頭方向、取樣率（sample n／block k）都要和頁面上的公式一致；
 *   diagrams.test.tsx 以真正的 mermaid parser 解析每一張、用共用的 renderMermaidForTest 真的畫一次
 *   （抓「Unsupported markdown」、殘留的 `$`、KaTeX 以外的 Unicode 數學），並檢查加法點的極性與節點數（≤ 14）。
 *   圖說（caption）另寫在各小節的 <Diagram>，同樣支援 `$...$` 行內公式。
 * - 顏色（深淺主題都看得清楚）：藍 = 這一段的主角、棕 = 與它互相拉扯的另一項、綠 = 通過／可用、紅 = 失敗／不適用。
 */

/** 圖上的步驟編號 ①–⑨：KaTeX 的文字模式沒有圓圈數字的字型，用 \textcircled 畫（和正文的 ①–⑨ 對得上）。 */
const step = (n: number): string => `$\\text{\\textcircled{${n}}}$`

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/** 章首系統地圖要標成藍色的方塊：GMAC（N）、normalize + learning rate（μ）、gain accumulator（w_k）。 */
export const CH14_SYSTEM_FOCUS: SystemBlock[] = ['gmac', 'scale', 'acc']

// ───────────────────────────── 先備知識（章首） ─────────────────────────────

/**
 * 先備知識「高斯、erf 與 comparator 增益」：e = δ + v → sign → 取平均 → E[q] = erf(δ/(√2σ_v)) = 2Φ(δ/σ_v) − 1，
 * 小訊號斜率 K_q = √(2/π)/σ_v（線性區），δ 大時 erf 飽和（勘誤 E48 的 slew-limited 區）。
 */
export const CHART_COMPARATOR_GAIN = String.raw`flowchart TB
  D(["$\delta$：要偵測的誤差"]) -- "＋" --> S(("＋"))
  V(["$v$：comparator 前的雜訊<br/>高斯，RMS $= \sigma_v$"]) -- "＋" --> S
  S -- "$e = \delta + v$" --> Q["1-bit comparator<br/>$q = \mathrm{sign}(e) = \pm 1$"]
  Q -- "同一個 $\delta$ 重複很多次，取平均" --> M["$E[q] = \mathrm{erf}(\delta/(\sqrt{2}\,\sigma_v)) = 2\Phi(\delta/\sigma_v) - 1$"]
  M -- "$|\delta| \ll \sigma_v$（$\lesssim 0.2\,\sigma_v$）" --> LIN["線性區：$E[q] \approx K_q\,\delta$<br/>$K_q = \sqrt{2/\pi}/\sigma_v$"]
  M -- "$|\delta|$ 大（$\gtrsim \sigma_v$）" --> SAT["erf 彎曲後頂到 $\pm 1$<br/>slew-limited（勘誤 E48）"]
  ${FOCUS}
  ${WARN}
  class LIN focus
  class SAT warn`

// ───────────────────────────── §14.0 ─────────────────────────────

/** §14.0：block-rate 校正迴路。δ_{k+1} = a − w_{k+1} = (1 − μK)δ_k − μη_k。 */
export const CHART_CAL_LOOP = String.raw`flowchart TB
  A(["$a$<br/>真正需要的 gain"]) -- "＋" --> S1(("＋"))
  S1 -- "$\delta_k = a - w_k$" --> KB["$\times K$<br/>GMAC 平均斜率<br/>$K = K_q C$"]
  KB -- "＋" --> S2(("＋"))
  ETA(["$\eta_k$：這個 block 的雜訊<br/>變異數 $\sigma_\eta^2 \approx 1/N$"]) -- "＋" --> S2
  S2 -- "$G_k = K\,\delta_k + \eta_k$" --> MU["$\times \mu$<br/>learning rate"]
  MU -- "$\mu\,G_k$" --> ACC["累加器 $1/(z-1)$<br/>$w_{k+1} = w_k + \mu\,G_k$"]
  ACC -- "$-$（回授 $w_k$）" --> S1
  ${FOCUS}
  class MU focus`

// ───────────────────────────── §14.1 ─────────────────────────────

/**
 * §14.1：sample rate（n）→ block rate（k）。
 * e[n] ≈ δ_k·u[n] + v[n]（u[n] = c·x[n] + s·x[n−1]），q[n] = sign(e[n])，G_k = (1/N)Σ q[n]x[n]，w_(k+1) = w_k + μ·G_k。
 * 寫 ≈ 的原因（技術審查 R06b）：真實電路先乘 δ 再過誤差路徑，每個 block 的第一個樣本裡 s·x[n−1] 那一項乘的還是 δ_(k−1)，
 * 和圖上的寫法差 s·(δ_(k−1) − δ_k)·x[n−1]；其餘 N − 1 個樣本是等式（§14.1 的導讀有說明，sampleToBlock.test.ts 用模擬核心驗證）。
 * 架構（docs/assumptions.md §2a）：e[n] 是 PD 的輸出，也就是送進 loop filter 的同一個節點（SUMV）；
 * comparator 與 loop filter 都從這個節點分接，不是從 DTC 或 divider 取。
 */
export const CHART_SAMPLE_TO_BLOCK = String.raw`flowchart TB
  subgraph FS["sample rate：每個 comparator 樣本做一次（索引 $n$，頻率 $f_s$）"]
    direction LR
    XC(["DTC code $x[n]$"]) --> PATH["PLL 誤差路徑<br/>（DTC 到 PD 輸出）<br/>$u[n] = c\,x[n] + s\,x[n-1]$"]
    PATH -- "$u[n]$" --> PROD["PD 輸出的訊號部分<br/>$\delta_k\,u[n]$（誤差 $\delta_k$ 乘上 $u[n]$）"]
    VN(["$v[n]$：雜訊，RMS $= \sigma_v$"]) -- "＋" --> SUMV(("＋"))
    PROD -- "＋" --> SUMV
    SUMV -- "PD 輸出 $e[n] \approx \delta_k\,u[n] + v[n]$" --> CMP["1-bit comparator<br/>$q[n] = \mathrm{sign}(e[n])$"]
    SUMV -. "同一個 $e[n]$" .-> LF["Loop filter<br/>（PLL 主迴路）"]
    CMP -- "$q[n] = \pm 1$" --> MUL(("$\times$"))
    XC -- "$x[n]$" --> MUL
  end
  subgraph FU["block rate：每 $N$ 個樣本做一次（索引 $k$，頻率 $f_u = f_s/N$）"]
    direction LR
    AVG["GMAC 平均<br/>$G_k = (1/N)\sum q[n]\,x[n]$"] -- "$G_k \approx K\,\delta_k + \eta_k$" --> UPD["乘 $\mu$ 後累加<br/>$w_{k+1} = w_k + \mu\,G_k$"]
  end
  MUL -- "$q[n]\,x[n]$，共 $N$ 個" --> AVG
  UPD -. "$\delta_k = a - w_k$<br/>整個 block 內不變，<br/>block 結束才更新 $w$" .-> PROD
  ${FOCUS}
  class AVG focus`

/** §14.1：把 δ_B = p^B·δ₀ − μ·Σ p^(B−1−k)·η_k 畫成兩條路；平方取期望後就是 bias² + variance（F-14.3）。 */
export const CHART_MSD_SPLIT = String.raw`flowchart TB
  D0(["$\delta_0$<br/>初始誤差（確定值）"]) --> PB["$\times\,p^B$<br/>每個 block 乘一次<br/>$p = 1 - \mu K$"]
  ETA(["$\eta_0, \ldots, \eta_{B-1}$<br/>各 block 獨立、平均 $0$<br/>變異數 $\sigma_\eta^2$"]) --> WGT["$\times\,\mu\,p^{B-1-k}$<br/>再全部相加<br/>越早進來的雜訊<br/>被 $p$ 乘越多次"]
  PB -- "＋" --> SUM(("＋"))
  WGT -- "−" --> SUM
  SUM -- "$\delta_B$" --> SQ["平方後取期望值<br/>交叉項平均為 $0$"]
  SQ --> BIAS["$\text{bias}^2 = \delta_0^2\,p^{2B}$<br/>初始誤差那條路的平方"]
  SQ --> VAR["$\text{variance} = \mu^2\sigma_\eta^2\,(1 - p^{2B})/(1 - p^2)$<br/>雜訊那條路的變異數"]
  ${FOCUS}
  ${ALT}
  class BIAS focus
  class VAR alt`

/**
 * §14.1 邊界情況：迴路增益 g = μK 從 0 往上加時，pole p = 1 − g 的走向（F-14.1、F-14.4、F-14.10、F-14.14）。
 * PM = 90° − arcsin(g/2)：g = 1 → 60°、g = 2 → 0°。
 */
export const CHART_POLE_REGIMES = String.raw`flowchart TB
  subgraph ROW1[" "]
    direction LR
    R0["$g = 0 \Rightarrow p = 1$<br/>$K = 0$（$C = 0$）：<br/>沒有恢復力<br/>係數做 random walk"] -- "$g$ 增加" --> R1["$g$ 在 $0$ 與 $1$ 之間<br/>$p$ 在 $0$ 與 $1$ 之間<br/>平均誤差單調衰減<br/>$PM$ 大於 $60^\circ$"]
    R1 -- "$g$ 增加" --> R2["$g = 1 \Rightarrow p = 0$<br/>deadbeat：一步到位<br/>$\mu = 1/K$，$PM = 60^\circ$"]
  end
  subgraph ROW2[" "]
    direction LR
    R3["$g$ 在 $1$ 與 $2$ 之間<br/>$p$ 在 $-1$ 與 $0$ 之間<br/>正負交替但仍衰減<br/>$PM$ 小於 $60^\circ$"] -- "$g$ 增加" --> R4["$g = 2 \Rightarrow p = -1$<br/>正負翻轉、幅度不衰減<br/>$PM = 0^\circ$"]
    R4 -- "$g$ 增加" --> R5["$g$ 大於 $2 \Rightarrow$ $p$ 小於 $-1$<br/>指數發散"]
  end
  ROW1 -- "$g$ 增加" --> ROW2
  ${FOCUS}
  ${ALT}
  ${PASS}
  ${WARN}
  class R0,R4,R5 warn
  class R1 pass
  class R2 focus
  class R3 alt`

/** §14.1（勘誤 E48）：線性公式 F-14.3 與 slew-limited 估計 F-14.5 各自的適用區。 */
export const CHART_E48_REGIMES = String.raw`flowchart TD
  Q{"誤差 $|\delta|$ 和 comparator 雜訊 $\sigma_v$<br/>比起來多大？"}
  Q -- "$|\delta| \lesssim 0.2\,\sigma_v$" --> LIN["線性區<br/>$G_k \approx K\,\delta_k + \eta_k$ 成立"]
  Q -- "介於兩者之間" --> MID["過渡區<br/>F-14.3 開始低估<br/>（$0.5\,\sigma_v$ 時約 $5\%$）"]
  Q -- "$|\delta| \gtrsim 0.5\,\sigma_v$" --> SLEW["slew-limited 區<br/>comparator 飽和<br/>$|G_k|$ 最大只有 $\max|x|$"]
  LIN --> F3["用 F-14.3<br/>$E[\delta_B^2] = \text{bias}^2 + \text{variance}$<br/>（Fine、Track 階段）"]
  MID --> MC["用 Monte Carlo 確認"]
  SLEW --> F5["用 F-14.5 或 Monte Carlo<br/>$B \gtrsim (|\delta_0| - \delta_\text{target})/(\mu\max|x|)$<br/>（Coarse 階段）"]
  F5 -. "誤差被拉到 $|\delta| \ll \sigma_v$ 之後" .-> LIN
  ${PASS}
  ${WARN}
  class LIN,F3 pass
  class SLEW,F5 warn`

// ───────────────────────────── §14.2 ─────────────────────────────

/** §14.2：目標不同 ⇒ 決定 μ 的方式不同（F-14.8、F-14.10、F-14.9、F-14.11、F-14.12、F-14.13、F-14.14）。 */
export const CHART_OBJECTIVE_FLOW = String.raw`flowchart LR
  Q{"你要最佳化什麼？"}
  Q --> FIN["(a) 終點 RMS<br/>解 $dJ/d\mu = 0$<br/>$\mu^* \approx \ln A/(2BK)$"]
  Q --> FAST["(b) 最快收斂<br/>讓 pole $p = 0$<br/>$\mu = 1/K$"]
  Q --> INTG["(c) 全程積分誤差<br/>數值解，$\mu$ 比 (a) 大"]
  Q --> SPUR["(d) 最小 spur<br/>成本隨 $\mu$ 單調遞增<br/>取收斂下限 $\mu = (1 - \epsilon^{1/B})/K$"]
  Q --> RAMP["(e) 追蹤 ramp 漂移<br/>$\mu^* \approx (4r^2/(K\sigma_\eta^2))^{1/3}$"]
  Q --> RWK["(e) 追蹤 random-walk 漂移<br/>$\mu^* \approx \sigma_\zeta/\sigma_\eta$"]
  FIN --> CAP["(f) 共同上限：$PM \ge PM_t$<br/>$\mu K \le 2\cos PM_t$<br/>（$PM_t = 60^\circ$ 時 $\mu \le 1/K$）"]
  FAST --> CAP
  INTG --> CAP
  SPUR --> CAP
  RAMP --> CAP
  RWK --> CAP
  ${FOCUS}
  ${WARN}
  class FIN focus
  class CAP warn`

/** §14.2 (a)：σ_v → K_q → K → g、p → bias² + variance → J(μ) → μ*（F-14.3、F-14.7、F-14.8）。 */
export const CHART_DESIGN_FLOW = String.raw`flowchart TD
  SV(["$\sigma_v$<br/>comparator 前的雜訊"]) --> KQ["$K_q = \sqrt{2/\pi}/\sigma_v$"]
  TH(["$|H|$、$\theta$<br/>誤差路徑的增益與相位"]) --> CC["$C = |H|\cos\theta$"]
  KQ --> KK["$K = K_q C$"]
  CC --> KK
  MU(["候選的 $\mu$"]) --> GP["$g = \mu K$<br/>$p = 1 - g$"]
  KK --> GP
  NB(["$\delta_0$、$B$、$N$（$\sigma_\eta^2 \approx 1/N$）"]) --> BIAS["$\text{bias}^2 = \delta_0^2\,p^{2B}$<br/>$\mu$ 越大越小"]
  NB --> VAR["$\text{variance} = \mu^2\sigma_\eta^2\,(1 - p^{2B})/(1 - p^2)$<br/>$\mu$ 越大越大"]
  GP --> BIAS
  GP --> VAR
  BIAS -- "＋" --> JS(("＋"))
  VAR -- "＋" --> JS
  JS -- "$J(\mu) = E[\delta_B^2]$" --> BEST["掃 $\mu$ 找最低點（$dJ/d\mu = 0$）<br/>大 $B$ 時 $\mu^* \approx \ln A/(2BK)$"]
  ${FOCUS}
  ${ALT}
  class BIAS focus
  class VAR alt`

/** §14.2 (d)：係數雜訊 w_k − a = p·(w_{k−1} − a) + μ·η_{k−1}，也就是 H(z) = μ·z⁻¹/(1 − p·z⁻¹) = μ/(z − p)。 */
export const CHART_NOISE_SHAPING = String.raw`flowchart LR
  ETA(["$\eta_k$：白雜訊<br/>每個頻率一樣大，PSD $= \sigma_\eta^2$"]) --> MU["$\times\,\mu$"]
  MU -- "＋" --> SUM(("＋"))
  SUM --> ZD["$z^{-1}$<br/>延遲一個 block"]
  ZD -- "係數雜訊 $w_k - a$" --> PSD(["$S_w = |H|^2\sigma_\eta^2$<br/>$H(z) = \mu/(z - p)$"])
  ZD --> PP["$\times\,p$<br/>$p = 1 - \mu K$"]
  PP -- "＋" --> SUM
  ${FOCUS}
  class MU,PP focus`

/** §14.2 (e)：追蹤漂移時 J = lag² + 雜訊；ramp：(r/(μK))² + μσ_η²/(2K)，random walk：σ_ζ²/(2μK) + μσ_η²/(2K)。 */
export const CHART_TRACKING_TRADEOFF = String.raw`flowchart LR
  DR(["$a$ 會漂移<br/>ramp：每個 block 增加 $r$<br/>random walk：每個 block 走一步 $\zeta_k$"]) --> LAG["追不上造成的誤差<br/>ramp：$(r/(\mu K))^2$<br/>random walk：$\sigma_\zeta^2/(2\mu K)$<br/>$\mu$ 越大越小"]
  NS(["GMAC 雜訊 $\eta_k$"]) --> JIT["雜訊造成的抖動<br/>$\mu\,\sigma_\eta^2/(2K)$<br/>$\mu$ 越大越大"]
  MU["TRACK 階段的 $\mu$"] --> LAG
  MU --> JIT
  LAG -- "＋" --> JS(("＋"))
  JIT -- "＋" --> JS
  JS -- "$J(\mu)$" --> BEST["最低點<br/>ramp：$\mu^* \approx (4r^2/(K\sigma_\eta^2))^{1/3}$<br/>random walk：$\mu^* \approx \sigma_\zeta/\sigma_\eta$"]
  ${FOCUS}
  ${ALT}
  class LAG focus
  class JIT alt`

/**
 * §14.2 (f)：把回授線剪開得到開迴路 L(z) = g/(z−1)；|L(e^(jω_c))| = 1 ⇒ sin(ω_c/2) = g/2；
 * PM = 180° + ∠L = 90° − arcsin(g/2) ≥ PM_t ⇔ g ≤ 2·cos PM_t（F-14.14）。
 */
export const CHART_PM_LOOP = String.raw`flowchart TB
  A(["$a$"]) -- "＋" --> S(("＋"))
  S -- "$\delta_k = a - w_k$" --> GK["$\times\,g$<br/>$g = \mu K$"]
  GK --> INT["累加器 $1/(z-1)$"]
  INT -- "$-$（回授 $w_k$）" --> S
  GK -. "剪開回授線" .-> LZ(["開迴路 $L(z) = g/(z-1)$"])
  INT -.-> LZ
  LZ --> WC["找出 $|L| = 1$ 的頻率 $\omega_c$<br/>$\Rightarrow \sin(\omega_c/2) = g/2$"]
  WC --> PMN["$PM = 180^\circ + \angle L = 90^\circ - \arcsin(g/2)$"]
  PMN --> LIM["要求 $PM \ge PM_t$<br/>$\Leftrightarrow g \le g_{\max} = 2\cos PM_t$"]
  LIM --> MAXMU["$PM_t = 60^\circ \Rightarrow g_{\max} = 1$<br/>$\Leftrightarrow \mu \le 1/K$"]
  PMN -. "$g$ 再大" .-> EDGE["$g = 2$：$PM = 0^\circ$<br/>$p = -1$，等幅振盪"]
  ${FOCUS}
  ${WARN}
  class PMN,LIM focus
  class EDGE warn`

// ───────────────────────────── §14.3 ─────────────────────────────

/** §14.3：固定 T = N·B 的兩條路線；σ_η²/B = 1/T、A = 4TK²δ₀² ⇒ 一階只依賴 T（F-14.17）。 */
export const CHART_BUDGET_SPLIT = String.raw`flowchart TD
  TT(["固定預算：$T = N \times B$ 次比較"]) --> BIG["路線一：$N$ 大（block 長）"]
  TT --> SML["路線二：$N$ 小（block 短）"]
  BIG --> B1["每次更新比較乾淨<br/>$\sigma_\eta^2 = 1/N$ 變小"]
  BIG --> B2["但更新次數少<br/>$B = T/N$ 變小"]
  SML --> S1["每次更新比較吵<br/>$\sigma_\eta^2 = 1/N$ 變大"]
  SML --> S2["但更新次數多<br/>$B = T/N$ 變大"]
  B1 --> EQ["兩條路線匯合<br/>$\sigma_\eta^2/B = 1/T$<br/>$A = 4TK^2\delta_0^2$"]
  B2 --> EQ
  S1 --> EQ
  S2 --> EQ
  EQ --> RES["重新最佳化 $\mu$ 之後<br/>最佳 RMS 一階只看 $T$（F-14.17）"]
  RES --> HW["所以 $N$ 由別的事決定<br/>$K$ 的不確定、更新延遲 $d$<br/>累加器位元數、追蹤頻寬"]
  ${FOCUS}
  class EQ,RES focus`

// ───────────────────────────── §14.4 ─────────────────────────────

/** §14.4：驗算第 10 課計算器的順序（F-14.3、F-14.14、F-14.7）。 */
export const CHART_CALC_VERIFY = String.raw`flowchart TD
  IN(["課程的輸入<br/>$\delta_0 = 3\,\mathrm{fs}$、$\sigma_v = 100\,\mathrm{fs}$、$N = 4096$<br/>$T = 131072$、$\theta = 0$"]) --> PRE["$K = \sqrt{2/\pi}/\sigma_v$<br/>$\sigma_\eta^2 = 1/N$<br/>$B = T/N = 32$"]
  ALPHA(["課程建議的步長<br/>$\alpha = 11.20\,\mathrm{fs}$"]) --> GP["$g = \mu K$<br/>$p = 1 - g$"]
  PRE --> GP
  GP --> RMS["F-14.3<br/>$E[\delta_B^2]$ 開根號得 RMS"]
  GP --> PMN["F-14.14<br/>$PM = 90^\circ - \arcsin(g/2)$"]
  RMS --> CHK{"和課程的<br/>$0.449\,\mathrm{fs}$、$0.9106$、$87.4^\circ$<br/>一樣嗎？"}
  PMN --> CHK
  CHK -- "一樣：三個數字算對了" --> DER["再問：$11.20$ 是最低點嗎？<br/>代入 F-14.7，$dJ/d\mu$ 是正的"]
  DER -- "正的：$\mu$ 再小一點成本更低" --> BEST["數值求根 $dJ/d\mu = 0$<br/>得到真正的 $\mu^*$（比 $11.20$ 略小）"]
  ${FOCUS}
  ${PASS}
  class DER focus
  class BEST pass`

// ───────────────────────────── §14.5 ─────────────────────────────

/** §14.5：corner-based 區間（F-14.15）與非空條件（F-14.16）。 */
export const CHART_CORNER_FLOW = String.raw`flowchart TD
  KI(["每個 corner 的斜率 $K_i$"]) --> POL{"所有 $K_i \gt 0$ ？"}
  POL -- "否" --> BAD["極性錯誤（$C \le 0$）<br/>任何正的 $\mu$ 都會發散<br/>區間沒有定義"]
  POL -- "是" --> KMIN["$K_{\min}$<br/>最慢的 corner"]
  POL -- "是" --> KMAX["$K_{\max}$<br/>最快的 corner"]
  KMIN --> LO["速度給下限<br/>$\mu_{\min} = (1 - \epsilon^{1/B})/K_{\min}$"]
  KMAX --> HI["PM 給上限<br/>$\mu_{\max} = 1/K_{\max}$（$PM \ge 60^\circ$）"]
  LO --> CMP{"$\mu_{\min} \le \mu_{\max}$ ？<br/>等價於 $B \ge \ln\epsilon / \ln(1 - K_{\min}/K_{\max})$"}
  HI --> CMP
  CMP -- "是：區間非空" --> PICK["在區間內選 $\mu$<br/>再用 F-14.3 檢查每個 corner 的 RMS"]
  CMP -- "否：區間是空的" --> FIX["不是再找一個 $\mu$<br/>加大 $B$、量 $\hat K_i$ 做正規化、提高 $K_{\min}$<br/>放寬 $\epsilon$ 或 PM、改用步長排程"]
  FIX -. "改完再算一次" .-> KI
  ${FOCUS}
  ${PASS}
  ${WARN}
  class LO,HI focus
  class PICK pass
  class BAD,FIX warn`

/** §14.5：量測 GMAC 斜率的 6 步流程（F-14.21）。w↑ ⇒ δ = a − w↓ ⇒ G↓，所以 K̂ = (Ḡ(−Δ) − Ḡ(+Δ))/(2Δ)。 */
export const CHART_SLOPE_MEASURE = String.raw`flowchart TD
  M1["${step(1)} 鎖定 PLL、固定 FCW 與 corner<br/>凍結 LMS（$\mu = 0$），$w$ 停在 $\bar w$"] --> M2["${step(2)} DTC 改用 $\bar w + \Delta$<br/>平均 $M$ 個 block，得到 $\bar G(+\Delta)$"]
  M2 --> M3["${step(3)} DTC 改用 $\bar w - \Delta$<br/>平均 $M$ 個 block，得到 $\bar G(-\Delta)$"]
  M3 --> M4["${step(4)} $\hat K = (\bar G(-\Delta) - \bar G(+\Delta))/(2\Delta)$<br/>$\mathrm{se} = \sigma_\eta/(\Delta\sqrt{2M})$"]
  M4 --> SIG{"${step(5)} $\hat K \gt z\,\mathrm{se}$ ？"}
  SIG -- "否" --> BAD["極性錯誤或看不到訊號<br/>這個 corner 不能校正"]
  SIG -- "是" --> M6["${step(6)} 每個 corner 都做一次<br/>$K_{\min} = \min(\hat K_i - z\,\mathrm{se}_i)$<br/>$K_{\max} = \max(\hat K_i + z\,\mathrm{se}_i)$"]
  M6 --> USE["代入 F-14.15<br/>得到 $\mu$ 的可行區間"]
  ${FOCUS}
  ${PASS}
  ${WARN}
  class M4 focus
  class USE pass
  class BAD warn`

// ───────────────────────────── §14.6 ─────────────────────────────

/** §14.6：三種步長排程並排（F-14.8、F-14.20、F-14.18）。 */
export const CHART_SCHEDULE_COMPARE = String.raw`flowchart LR
  GK(["$G_k$<br/>同一個 GMAC 輸出"]) --> FIX["固定步長<br/>$\times\,\mu^*$（整段同一個值）"]
  GK --> TWO["兩段式<br/>前 $B_1$ 個 block $\times\,\mu_1$<br/>之後 $\times\,\mu_2$"]
  GK --> INV["$1/k$ 排程<br/>$\times\,\mu_k = 1/(K(k + 1 + k_0))$"]
  FIX --> RF["終點均方誤差<br/>$\approx \sigma_\eta^2(1 + \ln A)/(4BK^2)$"]
  TWO --> RT["F-14.20<br/>介於兩者之間"]
  INV --> RK["下界<br/>$P_B \approx \sigma_\eta^2/(BK^2)$"]
  ${FOCUS}
  ${ALT}
  ${PASS}
  class FIX alt
  class TWO focus
  class INV pass`

/** §14.6：兩段式的時間軸（F-14.20）。m_{B₁+B₂} = m_{B₁}·p₂^(2B₂) + μ₂²σ_η²(1 − p₂^(2B₂))/(1 − p₂²)。 */
export const CHART_SCHEDULE_TIMELINE = String.raw`flowchart TB
  T0(["$k = 0$<br/>均方誤差 $= \delta_0^2$"]) --> CO["COARSE 段：$B_1$ 個 block<br/>步長 $\mu_1$ 大，$p_1 = 1 - \mu_1 K$ 小<br/>$\text{bias}^2$ 掉得快、雜訊底高"]
  CO -- "交棒：$m_{B_1} = E[\delta^2]$（$k = B_1$）" --> FI["FINE 段：$B_2$ 個 block<br/>步長 $\mu_2$ 小，$p_2 = 1 - \mu_2 K$ 接近 $1$<br/>把 $m_{B_1}$ 當成新的初始誤差平方"]
  FI -- "F-14.20" --> T2(["$k = B_1 + B_2$<br/>$m_{B_1}\,p_2^{2B_2} + \mu_2^2\sigma_\eta^2\,(1 - p_2^{2B_2})/(1 - p_2^2)$<br/>接近下界 $P_B$"])
  T2 -.-> TR["之後 TRACK<br/>$\mu_\text{track}$ 當地板，保留追蹤能力"]
  ${FOCUS}
  ${ALT}
  class CO alt
  class FI focus`

/** §14.6：最佳排程的資訊累加器。1/P_{k+1} = 1/P_k + K²/σ_η²，μ_k = K·P_k/(K²·P_k + σ_η²)（F-14.18）。 */
export const CHART_KALMAN_INFO = String.raw`flowchart LR
  INF(["每個 block 帶來的資訊<br/>$K^2/\sigma_\eta^2$"]) -- "＋" --> SUM(("＋"))
  SUM -- "$1/P_{k+1} = 1/P_k + K^2/\sigma_\eta^2$" --> ZD["$z^{-1}$<br/>存到下一個 block<br/>起點 $1/P_0 = 1/\delta_0^2$"]
  ZD -- "$+$（$1/P_k$）" --> SUM
  ZD -- "$1/P_k$" --> GAIN["這個 block 的最佳步長<br/>$\mu_k = K\,P_k/(K^2 P_k + \sigma_\eta^2)$<br/>$= 1/(K(k + 1 + k_0))$"]
  ZD --> FIN["跑完 $B$ 個 block<br/>$1/P_B = 1/\delta_0^2 + B\,K^2/\sigma_\eta^2$"]
  ${FOCUS}
  class GAIN focus`

// ───────────────────────────── §14.6b ─────────────────────────────

/**
 * §14.6b：acquisition 路徑——FLL（頻率偵測 → 累加器 → VCO）、SSPD 相位迴路、lock detector、校正 enable 的 AND。
 * 頻率偵測走 divider（數得出 M）；SSPD 直接取樣 VCO 波形，分不出 M f_ref 與 (M ± 1) f_ref（§14.6b.0 的倍頻模糊）。
 * 架構照 docs/assumptions.md §2a：Reference → DTC → PD → LF → VCO，回授只有 divider；DTC 的工作點檢查從 DTC 的 code 來。
 */
export const CHART_ACQ_PATH = String.raw`flowchart TB
  REF(["Reference $f_\text{ref}$"]) --> DTC["DTC：延遲 $T_0 - w\,x[n]$"]
  DTC --> PD["SSPD：$\theta$ = reference edge 對 VCO 波形的時間誤差<br/>輸出 $\propto \sin(2\pi\theta/T_\text{vco})$<br/>分不出 $M f_\text{ref}$ 與 $(M \pm 1) f_\text{ref}$"]
  PD --> LF["Loop filter"]
  LF --> VCO["VCO／DCO<br/>$f_\text{vco} = M f_\text{ref} + \Delta f$"]
  VCO --> DIV["Divider $\div M$"]
  DIV --> PD
  REF --> FD["頻率偵測（走 divider：數得出 $M$）<br/>$\hat{\Delta f} = \Delta f + e_f$"]
  DIV --> FD
  FD --> FLL["FLL 累加器：每週期 $-K_f\,\hat{\Delta f}$<br/>$K_f = K_\text{vco} g_f/(M f_\text{ref})$"]
  FLL --> VCO
  FD --> LD{{"$|\hat{\Delta f}| \lt f_\text{tol}$<br/>連續 $N_\text{ld}$ 個週期？<br/>倍頻捕獲 $|\hat{\Delta f}| \lt f_\text{ref}/2$？"}}
  PD --> PLD{{"$|\theta| \lt \theta_{\max}$ 連續 $N_\text{pl}$ 個週期？<br/>$W$ 個週期的 $\mathrm{rms} \lt \mathrm{rms}_{\max}$？"}}
  DTC --> DCHK{{"DTC code 在範圍內？<br/>（$T_0 - w\,x$ 沒有飽和）"}}
  LD -- "頻率鎖定 $\wedge$ 倍頻對" --> AND(("$\wedge$"))
  PLD -- "phase lock $\wedge$ 穩態" --> AND
  DCHK -- "工作點 OK" --> AND
  AND -- "CAL enable" --> CAL["校正 enable：§14.7 的狀態機離開 LOCK"]
  ${FOCUS}
  ${PASS}
  class FLL,LD,PLD,DCHK focus
  class CAL pass`

/**
 * §14.6b：acquisition 狀態機 ACQ → PLOCK → CAL → HOLD／RECAL（含失鎖回退）；每條邊都是 acquisition.ts 的 acqStep 真的會走的轉移。
 * 畫成 flowchart（不是 stateDiagram）：狀態框裡要放公式，而且 stateDiagram 的轉移文字不支援 `$...$`。
 */
export const CHART_ACQ_SM = String.raw`flowchart TD
  ACQ["ACQ：FLL 拉頻率<br/>$\Delta f[n+1] = (1 - K_f)\,\Delta f[n] - K_f\,e_f[n]$<br/>校正關閉"] -- "$|\hat{\Delta f}| \lt f_\text{tol}$ 連續 $N_\text{ld}$：頻率鎖定<br/>FLL 凍結、相位迴路閉合" --> PLOCK["PLOCK：等 phase lock 與穩態<br/>$|\theta| \lt \theta_{\max}$ 連續 $N_\text{pl}$、$W$ 個週期的 $\mathrm{rms} \lt \mathrm{rms}_{\max}$"]
  PLOCK -- "兩個條件 $\wedge$ 倍頻對 $\wedge$ DTC 工作點 OK：CAL enable<br/>（§14.7 的 LOCK 到此結束）" --> CAL["CAL：校正進行中<br/>（COARSE → VERIFY → FINE → TRACK）"]
  CAL -- "cycle slip 或 $|\theta| \ge \theta_{\max}$" --> HOLD["HOLD：係數保持、校正暫停"]
  HOLD -- "重新 phase lock 且 rms 視窗通過" --> RECAL["RECAL：先 VERIFY 再更新"]
  RECAL --> CAL
  CAL -. "$|\hat{\Delta f}| \gt f_\text{unlock}$ 連續 $N_\text{ul}$：失鎖" .-> ACQ
  HOLD -. "失鎖" .-> ACQ
  PLOCK -. "失鎖" .-> ACQ
  PLOCK -. "DTC 工作點超出範圍或倍頻不對" .-> NOEN["永遠不 enable<br/>先修 DTC 範圍（Ch04 §5b）<br/>或先用 FLL 拉到對的那一根"]
  ${FOCUS}
  ${PASS}
  ${WARN}
  class ACQ,PLOCK focus
  class CAL pass
  class HOLD,NOEN warn`

// ───────────────────────────── §14.7 ─────────────────────────────

/** 規格 §14.2 原圖：節點與連線逐字照抄；只有方向由規格的 LR 改成 TB（一排 8 個節點、含兩個迴圈，桌機放不下橫排）。 */
export const SPEC_CHART = `flowchart TB
  RESET[Reset / Initialize] --> LOCK[PLL Lock Check]
  LOCK --> COARSE[Coarse Calibration: larger step]
  COARSE --> VERIFY[Convergence + Bias Test]
  VERIFY --> FINE[Fine Calibration: smaller step]
  FINE --> TRACK[Low-BW Background Tracking]
  TRACK --> FREEZE[Optional Freeze on Low-Noise Mode]
  FREEZE --> TRACK
  TRACK --> RESTART[Recalibrate on large mode/PVT change]
  RESTART --> COARSE`

/**
 * 本站實作（含 guards 與失敗路徑）；每條邊對應 optimizer.ts 的 calStep。
 * 標籤一律用雙引號包住（含冒號、等號、公式等特殊字元）；數學寫 `$...$`。
 */
export const IMPL_CHART = String.raw`flowchart TD
  RESET["RESET: $w = w_0$"] --> LOCK["LOCK: 暫停更新"]
  LOCK -- "lock detect = 1" --> COARSE["COARSE: $\mu_\text{coarse} \times B_c$"]
  COARSE -- "$B_c$ blocks" --> VERIFY["VERIFY: $w \pm \Delta$ 量 $\hat K$ 與 $\hat\delta$"]
  VERIFY -- "$\hat K$ 顯著大於 $0$ 且 $\hat\delta$ 在容許內" --> FINE["FINE: $\mu_\text{fine} \times B_f$"]
  VERIFY -- "$\hat\delta$ 太大，重試" --> COARSE
  VERIFY -- "$\hat K$ 不顯著 / 重試用盡" --> FAULT["FAULT: 保持<br/>last-known-good"]
  FINE -- "$B_f$ blocks" --> TRACK["TRACK: $\mu_\text{track}$"]
  TRACK -- "低雜訊模式 / bad-FCW" --> FREEZE["FREEZE: 不更新"]
  FREEZE -- "請求結束：回到被打斷的狀態" --> TRACK
  TRACK -- "$G$ 移動平均警報（hysteresis）" --> RESTART["RESTART"]
  RESTART --> COARSE
  TRACK -. "失鎖" .-> LOCK
  LOCK -. "重新鎖定：先驗證" .-> VERIFY
  COARSE -. "clip：連續 $n$ 個 block 卡在邊界，退回 LKG" .-> RESTART
  COARSE -. "clip 且重試用盡" .-> FAULT`

/** §14.7：calStep 一個 block 內的先後順序（① guards → ② μ 與 w_applied → ③ 量 G → ④ 更新 → ⑤ 轉移）。 */
export const CHART_GUARD_ORDER = String.raw`flowchart TD
  IN(["這個 block 的旗標<br/>locked、bad-FCW、<br/>低雜訊模式"]) --> G1{"${step(1)} lock detect<br/>失鎖了嗎？"}
  G1 -- "是" --> LK["進 LOCK：不更新、保持 $w$<br/>重新鎖定後先 VERIFY<br/>（COARSE 中失鎖則<br/>重跑 COARSE）"]
  G1 -- "否" --> G2{"${step(1)} 有人要求暫停嗎？"}
  G2 -- "是：低雜訊模式，或<br/>bad-FCW 且 policy = freeze" --> FZ["進 FREEZE：不更新<br/>請求結束後回到被打斷的狀態"]
  G2 -- "否" --> ST["${step(2)} 依狀態決定 $\mu$ 與 DTC 實際使用的 $w$<br/>（VERIFY 用 $w \pm \Delta$，$\mu = 0$）"]
  ST --> ME["${step(3)} 量這個 block 的 $G_k$"]
  ME --> UP["${step(4)} 更新量 $\mu\,G_k$<br/>max-step 限幅 $\to$ LSB 量化 $\to$ 夾在 $w_{\min}$ 與 $w_{\max}$ 之間"]
  UP --> G3{"${step(5)} clip detect<br/>連續 $n$ 個 block<br/>卡在邊界？"}
  G3 -- "是" --> CL["退回 last-known-good<br/>RESTART（重試用盡則 FAULT）"]
  G3 -- "否" --> TR["${step(5)} 一般狀態轉移<br/>計數到了、VERIFY 判定、<br/>TRACK 警報"]
  ${FOCUS}
  ${WARN}
  class ST,ME,UP focus
  class LK,FZ,CL warn`

/** §14.7：VERIFY 的判定（F-14.21）。K̂ = (Ḡ(−Δ) − Ḡ(+Δ))/(2Δ)，δ̂ = ½(Ḡ(+Δ) + Ḡ(−Δ))/K̂。 */
export const CHART_VERIFY_DECISION = String.raw`flowchart TD
  VF["VERIFY：暫存器 $w$ 不動<br/>前半視窗 DTC 用 $w + \Delta$，後半用 $w - \Delta$"] --> EST["$\hat K = (\bar G(-\Delta) - \bar G(+\Delta))/(2\Delta)$<br/>$\hat\delta = \tfrac{1}{2}(\bar G(+\Delta) + \bar G(-\Delta))/\hat K$"]
  EST --> Q1{"$\hat K \gt z\,\mathrm{se}$ ？<br/>極性正確、看得到訊號"}
  Q1 -- "否：有 LKG 就先還原" --> FAULT["FAULT<br/>不再更新"]
  Q1 -- "是" --> Q2{"$|\hat\delta| \le$ 容許值 ？"}
  Q2 -- "是" --> FINE["把 $w$ 記成 last-known-good<br/>進 FINE"]
  Q2 -- "否" --> Q3{"重試次數用完了嗎？"}
  Q3 -- "還沒" --> COARSE["回 COARSE 再收一次"]
  Q3 -- "用完了" --> FAULT
  ${PASS}
  ${WARN}
  class FINE pass
  class FAULT warn`

/**
 * §14.7：TRACK 警報的 hysteresis（Schmitt trigger）。高門檻累計、低門檻歸零、兩者之間保持。
 * stateDiagram 的公式：`state "…" as X` 的雙引號標籤支援 `$...$`；轉移文字沒有引號、前處理不會處理，
 * 所以要放公式的轉移直接寫 Mermaid 原生的 `$$\text{…}n\text{…}$$`（其他轉移全是文字）。
 */
export const CHART_ALARM_HYSTERESIS = String.raw`stateDiagram-v2
  direction TB
  state "安靜（計數 $= 0$）" as QUIET
  state "累計中（計數 $\ge 1$）" as COUNTING
  state "RESTART，回 COARSE" as RESTART
  [*] --> QUIET
  QUIET --> COUNTING : 移動平均高於高門檻
  COUNTING --> COUNTING : 仍高於高門檻則計數加 1，夾在兩個門檻之間則不變
  COUNTING --> QUIET : 低於低門檻，計數歸零並記下 last-known-good
  COUNTING --> RESTART : $$\text{計數達到 }n\text{ 個 block}$$
  RESTART --> [*]`

// ───────────────────────────── 綜合手算 ─────────────────────────────

/** 綜合手算 HC-14.8 的計算順序（與該題的步驟一致）。 */
export const CHART_HAND_FLOW = String.raw`flowchart TD
  IN(["規格：$\sigma_v$、$N$、$T$、$\delta_0$、$\epsilon$、$\theta$"]) --> H1["${step(1)} $B = T/N$"]
  IN --> H2["${step(2)} $C = \cos\theta$<br/>$K = \sqrt{2/\pi}\,C/\sigma_v$"]
  H1 --> H3["${step(3)} $\epsilon^{1/B}$<br/>每個 block 平均誤差要縮到的倍數"]
  H3 --> H4["${step(4)} $\mu = (1 - \epsilon^{1/B})/K$"]
  H2 --> H4
  H4 --> H5["${step(5)} $p = 1 - \mu K$<br/>應該等於 ${step(3)}（現成的驗算）"]
  H5 --> H6["${step(6)} $PM = 90^\circ - \arcsin(\mu K/2)$"]
  H5 --> H7["${step(7)} $\tau = -1/\ln p$"]
  H5 --> H8["${step(8)} $\text{bias}^2 = \delta_0^2\,p^{2B}$<br/>$\text{variance} = \mu^2\sigma_\eta^2\,(1 - p^{2B})/(1 - p^2)$<br/>$\sigma_\eta^2 = 1/N$"]
  H8 --> H9["${step(9)} $\mathrm{RMS} = \sqrt{\text{bias}^2 + \text{variance}}$"]
  H6 --> ANS(["預設值的答案<br/>$\mu = 11.20\,\mathrm{fs}$、$p = 0.9106$、$PM = 87.4^\circ$<br/>$\tau = 10.68$ blocks、$\mathrm{RMS} = 0.449\,\mathrm{fs}$"])
  H7 --> ANS
  H9 --> ANS
  ${FOCUS}
  ${PASS}
  class H4 focus
  class ANS pass`

// ───────────────────────────── 清單 ─────────────────────────────

export interface Ch14Chart {
  /** 匯出名稱（測試訊息與回報用） */
  name: string
  /** 所在小節 */
  section: string
  /** teaching-style §8 的圖種類 */
  kind: '數學模型' | '演算法迴圈' | '路徑／取樣率' | '比較' | '流程' | '手算流程' | '狀態機'
  chart: string
}

/** 本章所有 Mermaid 原始碼（依頁面出現的順序；不含章首的 SystemMap）。 */
export const CH14_CHARTS: Ch14Chart[] = [
  { name: 'CHART_COMPARATOR_GAIN', section: '先備知識（章首）', kind: '數學模型', chart: CHART_COMPARATOR_GAIN },
  { name: 'CHART_CAL_LOOP', section: '§14.0', kind: '演算法迴圈', chart: CHART_CAL_LOOP },
  { name: 'CHART_SAMPLE_TO_BLOCK', section: '§14.1', kind: '路徑／取樣率', chart: CHART_SAMPLE_TO_BLOCK },
  { name: 'CHART_MSD_SPLIT', section: '§14.1', kind: '數學模型', chart: CHART_MSD_SPLIT },
  { name: 'CHART_POLE_REGIMES', section: '§14.1', kind: '比較', chart: CHART_POLE_REGIMES },
  { name: 'CHART_E48_REGIMES', section: '§14.1', kind: '比較', chart: CHART_E48_REGIMES },
  { name: 'CHART_OBJECTIVE_FLOW', section: '§14.2', kind: '流程', chart: CHART_OBJECTIVE_FLOW },
  { name: 'CHART_DESIGN_FLOW', section: '§14.2 (a)', kind: '流程', chart: CHART_DESIGN_FLOW },
  { name: 'CHART_NOISE_SHAPING', section: '§14.2 (d)', kind: '數學模型', chart: CHART_NOISE_SHAPING },
  { name: 'CHART_TRACKING_TRADEOFF', section: '§14.2 (e)', kind: '比較', chart: CHART_TRACKING_TRADEOFF },
  { name: 'CHART_PM_LOOP', section: '§14.2 (f)', kind: '數學模型', chart: CHART_PM_LOOP },
  { name: 'CHART_BUDGET_SPLIT', section: '§14.3', kind: '比較', chart: CHART_BUDGET_SPLIT },
  { name: 'CHART_CALC_VERIFY', section: '§14.4', kind: '手算流程', chart: CHART_CALC_VERIFY },
  { name: 'CHART_CORNER_FLOW', section: '§14.5', kind: '流程', chart: CHART_CORNER_FLOW },
  { name: 'CHART_SLOPE_MEASURE', section: '§14.5', kind: '流程', chart: CHART_SLOPE_MEASURE },
  { name: 'CHART_SCHEDULE_COMPARE', section: '§14.6', kind: '比較', chart: CHART_SCHEDULE_COMPARE },
  { name: 'CHART_SCHEDULE_TIMELINE', section: '§14.6', kind: '流程', chart: CHART_SCHEDULE_TIMELINE },
  { name: 'CHART_KALMAN_INFO', section: '§14.6', kind: '演算法迴圈', chart: CHART_KALMAN_INFO },
  { name: 'CHART_ACQ_PATH', section: '§14.6b', kind: '路徑／取樣率', chart: CHART_ACQ_PATH },
  { name: 'CHART_ACQ_SM', section: '§14.6b', kind: '狀態機', chart: CHART_ACQ_SM },
  { name: 'SPEC_CHART', section: '§14.7', kind: '狀態機', chart: SPEC_CHART },
  { name: 'IMPL_CHART', section: '§14.7', kind: '狀態機', chart: IMPL_CHART },
  { name: 'CHART_GUARD_ORDER', section: '§14.7', kind: '流程', chart: CHART_GUARD_ORDER },
  { name: 'CHART_VERIFY_DECISION', section: '§14.7', kind: '流程', chart: CHART_VERIFY_DECISION },
  { name: 'CHART_ALARM_HYSTERESIS', section: '§14.7', kind: '狀態機', chart: CHART_ALARM_HYSTERESIS },
  { name: 'CHART_HAND_FLOW', section: '綜合手算', kind: '手算流程', chart: CHART_HAND_FLOW },
]
