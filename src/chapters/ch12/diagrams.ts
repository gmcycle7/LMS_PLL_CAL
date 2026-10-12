import type { SystemBlock } from '@/components'
import { CODE_TABLE_PRM, EX, SPUR, codeTable } from './common'

/**
 * 第 12 章的方塊圖（docs/teaching-style.md §8）。
 *  - 每張圖是一個具名的 Mermaid 原始碼字串；diagrams.test.tsx 用真正的 mermaid 逐張「畫出來」
 *    （@/components/mermaidTestUtils），並核對「頁面上畫出來的圖」與這裡的清單完全相同。
 *  - 圖內的數學一律寫 LaTeX（`$...$`，由共用的 Mermaid 元件以 KaTeX 排版，和正文同一套樣式）：變數 `$w_k$`、希臘字母 `$\mu$`、
 *    運算 `$\times$`、`$z^{-1}$`、`$\hat y$`…；文字、單位的名稱與方塊名稱照常寫。原始碼用 String.raw，TeX 的反斜線只寫一次
 *    （不要在標籤裡寫雙反斜線：Mermaid 會把它收成一個；換行用 <br/>）。含括號、等號、冒號的文字一律用雙引號包住。
 *  - 加法點寫成圓形節點 (("$+$"))，每一條進入加法點的線都標上正負號：`"$+$"` 或 `"$-$"`，
 *    後面可以接這一路的訊號（例如 `"$+\mu G_k$"`、`"$-K\,\delta w_k$"`）。不寫半形的單獨 + 或 -（沒有 `$`）：Mermaid 11 把標籤當 Markdown，
 *    單獨的 +／- 或以「+ 」「- 」開頭的標籤會被畫成「Unsupported markdown: list」。
 *  - sequenceDiagram 的文字不支援 KaTeX，所以 CHART_BLOCK_TIMING 改畫成 flowchart（三條泳道：每個 sample／每個 block／每個 sample）。
 *  - 圖上的訊號名稱、正負號、箭頭方向與取樣率（sample 索引 n／block 索引 k）必須和正文公式一致：
 *    極性 δw = w − w*（勘誤 E33）、G_k ≈ −K·δw_k + η_k（F-12.1）、δw_{k+1} = p·δw_k + μ·η_k（F-12.2）、
 *    δt[n] = x[n]·δw[n]（F-12.11）、e_PD = φ_dtc − θ_out 與 φ_dtc = −2π·f_out·δt（§12.7）。
 *  - 架構照全站約定（docs/assumptions.md §2a）：Reference clock → DTC → PD；回授路徑上只有 divider。
 *    w·x 是 reference 端 DTC 的「補償量」（實際延遲 T_0 − w·x），δt = x·δw 是多補償的時間：reference edge 早到 δt，
 *    PD 量的是 reference edge 減 feedback edge，所以它在 PD 的 reference 輸入是 −δt（F-12.16 的負號）。
 *    校正迴路（1-bit comparator）的輸入是 PD 的輸出 e[n]，也就是送進 loop filter 的同一個節點。
 *  - 圖內的範例數字（0.399 fs、12.93 kHz、−93.80 dBc、三種 code 的 output／PD RMS…）不手打：
 *    由本章的標準例 EX / SPUR / codeTable()（common.tsx → calNoise.ts）代入。
 */

/**
 * 章首系統地圖要標成藍色的方塊：雜訊 → comparator → GMAC → ÷N、×μ → accumulator → gain correction → DTC（reference 輸入端），
 * 再到本章 §12.7 的兩個出口：phase detector（PD residual，H_PD；它的輸出 e[n] 就是 comparator 的輸入）與 VCO 輸出（T）。
 */
export const CH12_SYSTEM_FOCUS: SystemBlock[] = ['noise', 'cmp', 'gmac', 'scale', 'acc', 'gc', 'dtc', 'pd', 'vco']

/** 深淺主題都看得清楚的三種標色：focus（本圖主角）、warn（要小心的地方）、ok（可以放心用的結果） */
const CLASSES = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** Hz → 'xx.xx'（kHz，兩位小數） */
const kHz = (hz: number) => (hz / 1e3).toFixed(2)
/** 數字加單位的行內公式（不含 `$`）：numUnit('12.93', 'kHz') → '12.93\ \mathrm{kHz}' */
const numUnit = (value: string, unit: string) => `${value}\\ \\mathrm{${unit}}`
/** 科學記號的 TeX（不含 `$`）：texSci(4.084e-5, 3) → '4.084\times10^{-5}' */
function texSci(x: number, digits: number): string {
  const [m, e] = x.toExponential(digits).split('e')
  return `${m}\\times10^{${Number(e)}}`
}

const SIGMA_W = EX.sigmaW.toFixed(3) // 0.399
const SIGMA_V = String(EX.input.sigmaV) // 100

/* ───────────────────────── §12.0 地圖 ───────────────────────── */

/**
 * 雜訊傳遞鏈（方塊層級；本章的第一張地圖）。
 * code x[n] 進兩個地方：GMAC 的相關（G_k = (1/N)·Σ q·x，虛線）與 DTC 的乘法（δt = x·δw，F-12.11）。
 * 由 PD residual 拉回 comparator 的虛線：comparator 取的是 PD 的輸出 e[n]（送進 loop filter 的同一個訊號），
 * δt 留在 PD 上的 residual 和雜訊 v[n] 一起進 comparator——這條回授就是 §12.1 的恢復力。
 */
export const NOISE_CHAIN_CHART = String.raw`flowchart TB
  V["$v[n]$：comparator 前雜訊<br/>$\sigma_v = ${numUnit(SIGMA_V, 'fs')}$"] --> Q["1-bit comparator<br/>$q = \mathrm{sign}(e)$"]
  Q --> G["GMAC 平均<br/>$G_k = \frac{1}{N}\sum q\,x$<br/>雜訊 $\eta_k$"]
  G --> U["LMS 更新<br/>$w \leftarrow w + \mu G$"]
  U --> W["係數雜訊 $\delta w_k$<br/>（gain-equivalent）"]
  W --> M(("$\times$"))
  X["DSM code $x[n]$"] --> M
  X -. "GMAC 也用同一個 code<br/>做相關" .-> G
  M --> DT["$\delta t[n] = x\,\delta w$<br/>reference 端的 DTC<br/>多補償的時間"]
  DT --> T["$T = L/(1+L)$<br/>PLL output：low-pass"]
  DT --> PD["$H_{\mathrm{PD}} = 1/(1+L)$<br/>PD residual：high-pass"]
  T --> OUT["$\phi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\,T\,\delta t$<br/>jitter skirt 或 spur"]
  PD -. "PD 的輸出 $e[n]$：<br/>comparator 取它的正負號" .-> Q
${CLASSES}
  class M focus`

/** 同一條鏈的數學模型：每一級的轉移函數與取樣率（sample 索引 n／block 索引 k） */
export const CHART_TF_CHAIN = String.raw`flowchart TB
  subgraph FS1["(1) sample rate $f_s$（索引 $n$）"]
    V["$v[n]$：comparator 前雜訊<br/>$\sigma_v = ${numUnit(SIGMA_V, 'fs')}$"]
    CQ["1-bit comparator，再乘上 code<br/>$q[n]\,x[n]$"]
  end
  subgraph FU["(2) block rate $f_u = f_s/N$（索引 $k$）"]
    AVG["GMAC：平均 $N$ 筆<br/>剩下的起伏是 $\eta_k$"]
    H["LMS 閉迴路：$\eta \to \delta w$<br/>$H(z) = \mu/(z - p)$"]
  end
  subgraph FS2["(3) 回到 sample rate $f_s$（索引 $n$）"]
    ZOH["ZOH：每個 $\delta w_k$ 保持 $N$ 個 sample"]
    X["code $x[n]$"]
    M(("$\times$"))
    T["PLL 到輸出：$T(f) = L/(1+L)$<br/>low-pass"]
    OUT["$\phi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\,T\,\delta t$<br/>skirt 或 spur"]
  end
  V --> CQ
  CQ --> AVG
  AVG -- "$\eta_k$，$\sigma_\eta^2 \approx 1/N$" --> H
  H -- "$\delta w_k$，$\sigma_w = ${numUnit(SIGMA_W, 'fs')}$" --> ZOH
  ZOH -- "$\delta w[n]$" --> M
  X --> M
  M -- "$\delta t[n] = x[n]\,\delta w[n]$" --> T
  T --> OUT
${CLASSES}
  class H,M focus`

/* ───────────────────────── §12.1–12.4 係數雜訊 ───────────────────────── */

/**
 * 線性化 GMAC：一個框是真實電路（每個 sample），另一個框是等效模型（每個 block）；G_k ≈ −K·δw_k + η_k（F-12.1）。
 * comparator 的輸入 e[n] 就是 PD 的輸出（送進 loop filter 的同一個節點）：e[n] = t_ref′ − t_fb = C·(a − w_k)·x[n] + v[n]。
 */
export const CHART_GMAC_LINEAR = String.raw`flowchart TB
  subgraph REAL["實際電路：每個 sample 做一次（索引 $n$）"]
    A["$a - w_k = -\delta w_k$<br/>（固定點 $w^* = a$ 時）"] --> X1(("$\times$"))
    XC["$C\,x[n]$<br/>code 經有效路徑 $C$"] --> X1
    X1 -- "$+$" --> S1(("$+$"))
    V["雜訊 $v[n]$"] -- "$+$" --> S1
    S1 -- "$e[n]$：PD 的輸出" --> SGN["$\mathrm{sign}$：1-bit comparator"]
    SGN -- "$q[n]$" --> X2(("$\times$"))
    XR["code $x[n]$"] --> X2
    X2 --> AVG["GMAC：平均 $N$ 筆"]
  end
  subgraph LIN["等效模型：每個 block 一個值（索引 $k$）"]
    DW["$\delta w_k = w_k - w^*$"] --> KB["$\times K$<br/>$K = K_q C$"]
    KB -- "$-$" --> S2(("$+$"))
    ETA["$\eta_k$：零均值雜訊<br/>$\sigma_\eta^2 \approx 1/N$"] -- "$+$" --> S2
  end
  AVG -- "$G_k$（真實）" --> SAME["近最佳點、小訊號時<br/>兩個 $G_k$ 的平均與變異數近似相同<br/>（F-12.1 的 $\approx$）"]
  S2 -- "$G_k$（模型）" --> SAME
${CLASSES}
  class KB,ETA focus`

/** 係數更新迴圈：累加器 δw_{k+1} = δw_k + μ·G_k，加上 GMAC 的恢復力 G_k = η_k − K·δw_k */
export const CHART_UPDATE_LOOP = String.raw`flowchart LR
  ETA["$\eta_k$<br/>GMAC 雜訊"] -- "$+$" --> S1(("$+$"))
  S1 -- "$G_k$" --> MU["$\times\,\mu$"]
  MU -- "$+\mu G_k$" --> S2(("$+$"))
  S2 -- "$\delta w_{k+1}$" --> D["$z^{-1}$<br/>延遲一個 block"]
  D -- "$\delta w_k$" --> OUT["係數偏差 $\delta w_k$"]
  D -- "$+\delta w_k$<br/>（累加器記住舊值）" --> S2
  D --> KB["$\times K$"]
  KB -- "$-K\,\delta w_k$<br/>（恢復力）" --> S1
${CLASSES}
  class KB focus`

/** 一階係數雜訊迴圈：δw_{k+1} = p·δw_k + μ·η_k（F-12.2），以及同一件事寫成 H(z) = μ/(z − p)（F-12.3） */
export const CHART_COEF_LOOP = String.raw`flowchart TB
  subgraph LOOP["時域：一階迴圈（每個 block 轉一圈）"]
    direction LR
    ETA["$\eta_k$"] --> MU["$\times\,\mu$"]
    MU -- "$+\mu\eta_k$" --> S(("$+$"))
    S -- "$\delta w_{k+1}$" --> D["$z^{-1}$"]
    D -- "$\delta w_k$" --> OUT["$\delta w_k$"]
    D --> P["$\times\,p$<br/>$p = 1 - \mu K$"]
    P -- "$+p\,\delta w_k$" --> S
  end
  subgraph TF["$z$ 域：整個迴圈包成一個方塊"]
    direction LR
    E2["$\eta$"] --> HZ["$H(z) = \mu/(z - p)$<br/>$= \mu z^{-1}/(1 - p z^{-1})$"]
    HZ --> W2["$\delta w$"]
  end
  LOOP -- "取 Z-transform" --> TF
${CLASSES}
  class P,HZ focus`

/** 白色 GMAC 雜訊通過 |H|²：S_w = |H|²·S_η（F-12.4），面積就是 σ_w²（F-12.5） */
export const CHART_PSD_FILTER = String.raw`flowchart TB
  IN["$S_\eta(e^{j\Omega}) = \sigma_\eta^2$<br/>白色：每個頻率一樣高"] --> H2["$\times\,|H(e^{j\Omega})|^2$<br/>$= \mu^2 / (1 - 2p\cos\Omega + p^2)$"]
  H2 --> OUT["$S_w(e^{j\Omega})$<br/>$0 \lt p \lt 1$ 時：<br/>低頻高、高頻低（low-pass）"]
  OUT --> AREA["面積：$\frac{1}{2\pi}\int S_w\,d\Omega$<br/>$\Omega$ 由 $-\pi$ 積到 $\pi$"]
  AREA --> VAR["$\sigma_w^2 = \mu^2\sigma_\eta^2 / (1 - p^2)$"]
  H2 -.- DC["$\Omega = 0$（DC）的增益：<br/>$\mu^2/(1 - p)^2$"]
  H2 -.- NY["$\Omega = \pi$（Nyquist）的增益：<br/>$\mu^2/(1 + p)^2$"]
${CLASSES}
  class H2 focus
  class VAR ok`

/** 變異數自己的一階迴圈：V_{k+1} = p²·V_k + μ²·σ_η²（§12.4 推導 A） */
export const CHART_VAR_LOOP = String.raw`flowchart LR
  Q["$\mu^2\sigma_\eta^2$<br/>每個 block 新注入的變異"] -- "$+$" --> S(("$+$"))
  S -- "$V_{k+1}$" --> D["$z^{-1}$"]
  D -- "$V_k = E[\delta w_k^2]$" --> P2["$\times\,p^2$<br/>舊變異留下的比例"]
  P2 -- "$+$" --> S
  D --> SS["穩態：$V$ 不再變<br/>$V = p^2 V + \mu^2\sigma_\eta^2$"]
  SS --> R["$\sigma_w^2 = \mu^2\sigma_\eta^2 / (1 - p^2)$"]
${CLASSES}
  class P2 focus
  class R ok`

/** （Research）colored GMAC noise：AR(1) 產生器 η_k = r·η_{k−1} + √(1 − r²)·σ_η·ε_k 串接同一個 LMS 閉迴路 */
export const CHART_COLORED_ETA = String.raw`flowchart LR
  EPS["$\varepsilon_k$<br/>白色，變異數 $1$"] --> SC["$\times\,\sqrt{1 - r^2}\,\sigma_\eta$"]
  SC -- "$+$" --> S1(("$+$"))
  S1 -- "$\eta_k$" --> H["LMS 閉迴路<br/>$H(z) = \mu/(z - p)$"]
  S1 --> D1["$z^{-1}$"]
  D1 -- "$\eta_{k-1}$" --> R["$\times\,r$<br/>相鄰 block 的相關"]
  R -- "$+r\,\eta_{k-1}$" --> S1
  H --> OUT["$\delta w_k$<br/>$\sigma_w^2 = \frac{\mu^2\sigma_\eta^2}{1 - p^2}\times\frac{1 + p\,r}{1 - p\,r}$"]
${CLASSES}
  class R focus
  class OUT ok`

/* ───────────────────────── §12.5 頻寬 ───────────────────────── */

/** 同一個濾波器的四種讀法：三個 −3 dB（exact 與兩個近似）＋ ENBW（T14 的四個數字） */
export const CHART_BW_READOUTS = String.raw`flowchart TB
  F["同一個濾波器 $H(z) = \mu/(z - p)$<br/>$|H|^2 = \mu^2 / (1 - 2p\cos\Omega + p^2)$"]
  F --> QA["讀法 A：<br/>功率掉到 DC 一半的頻率<br/>（corner：迴路追得多快）"]
  F --> QB["讀法 B：<br/>白雜訊通過後的總功率<br/>等於多寬的理想矩形"]
  QA --> EX["exact $\mathord{-}3\ \mathrm{dB}$<br/>$\frac{f_u}{\pi}\arcsin\frac{1 - p}{2\sqrt{p}}$<br/>$= ${numUnit(kHz(EX.f3dbExact), 'kHz')}$"]
  QA --> LN["$-\ln p$ 近似<br/>$\frac{-\ln p}{2\pi}f_u$<br/>$= ${numUnit(kHz(EX.f3dbNegLnP), 'kHz')}$"]
  QA --> OMP["$(1 - p)$ 近似<br/>$\frac{1 - p}{2\pi}f_u$<br/>$= ${numUnit(kHz(EX.f3dbOneMinusP), 'kHz')}$"]
  QB --> EN["ENBW<br/>$\frac{f_u}{2}\cdot\frac{1 - p}{1 + p}$<br/>$= ${numUnit(kHz(EX.enbw), 'kHz')}$"]
  EN --> SIG["積分雜訊只能用這一個<br/>$\sigma_w^2 = S_w^{(1)}(0)\cdot\mathrm{ENBW}$"]
${CLASSES}
  class EX focus
  class EN,SIG ok`

/** 由 pole 判斷 H 的型態，決定 −3 dB 頻寬存不存在（E27；與 calNoise.ts 的 bwRegime() 相同的判斷順序） */
export const CHART_BW_REGIME = String.raw`flowchart TB
  P["pole $p = 1 - \mu K$"] --> D1{"$|p| \ge 1$？<br/>（$\mu K \le 0$ 或 $\mu K \ge 2$）"}
  D1 -- "是" --> U["不穩定：沒有穩態<br/>不顯示任何頻寬"]
  D1 -- "否" --> D2{"$p \ge 0$？<br/>（$\mu K \le 1$）"}
  D2 -- "否" --> HP["high-pass：雜訊集中在 $f_u/2$ 附近<br/>low-pass 的頻寬定義不適用"]
  D2 -- "是" --> D3{"$p = 0$？"}
  D3 -- "是" --> FL["flat：係數雜訊是白色<br/>沒有 $\mathord{-}3\ \mathrm{dB}$ 點"]
  D3 -- "否" --> D4{"$p \ge 3 - 2\sqrt{2} \approx ${(3 - 2 * Math.SQRT2).toFixed(4)}$？<br/>（$\mu K \le ${(2 * Math.SQRT2 - 2).toFixed(4)}$）"}
  D4 -- "否" --> N3["low-pass，但衰減不足 $3\ \mathrm{dB}$<br/>$-3\ \mathrm{dB}$ 點不存在"]
  D4 -- "是" --> OK["low-pass：exact $\mathord{-}3\ \mathrm{dB}$ 存在<br/>$\Omega_{3\mathrm{dB}} = 2\arcsin\frac{1 - p}{2\sqrt{p}}$"]
${CLASSES}
  class OK ok
  class U,HP,FL,N3 warn`

/** σ_w² = 位準 × 寬度：位準 S_w^(1)(0) = π·σ_v²/(C²·f_s)（F-12.19），寬度 ENBW（F-12.9） */
export const CHART_LEVEL_WIDTH = String.raw`flowchart TB
  SV["comparator 輸入雜訊<br/>的單邊 PSD<br/>$2\sigma_v^2 / f_s$"] --> ONEBIT["$\times\,\pi/2$<br/>1-bit comparator 的代價"]
  ONEBIT --> DIVC["$\div\,C^2$<br/>有效 code 相關"]
  DIVC --> LVL["位準 $S_w^{(1)}(0)$<br/>$= \pi\sigma_v^2 / (C^2 f_s)$<br/>與 $\mu$、$N$ 無關"]
  MUK["$\mu K$ 與 $f_u = f_s/N$"] --> W["寬度 $\mathrm{ENBW}$<br/>$= \frac{f_u}{2}\cdot\frac{1 - p}{1 + p}$<br/>$p = 1 - \mu K$：$\mu$ 越大越寬"]
  LVL --> X(("$\times$"))
  W --> X
  X --> VAR["面積 $\sigma_w^2$ = 位準 $\times$ 寬度"]
${CLASSES}
  class LVL,W focus
  class VAR ok`

/* ───────────────────────── §12.6 乘上 code ───────────────────────── */

/**
 * 係數是 gain：reference 端 DTC 的補償量 = w[n]·x[n]（實際延遲 τ = T_0 − w[n]·x[n]，從基準延遲 T_0 往回扣），
 * 多補償的部分是 δt[n] = x[n]·δw[n]（F-12.11）。
 */
export const CHART_GAIN_MULT = String.raw`flowchart LR
  WS["$w^*$：固定點<br/>（LMS 平均停下來的 gain）"] -- "$+$" --> S(("$+$"))
  DW["$\delta w[n]$：係數的抖動<br/>每 $N$ 個 sample 才換一次值"] -- "$+$" --> S
  S -- "$w[n] = w^* + \delta w[n]$" --> M(("$\times$"))
  X["code $x[n]$"] --> M
  M --> DLY["DTC 的補償量 $w[n]\,x[n]$<br/>延遲 $\tau = T_0 - w[n]\,x[n]$"]
  DLY --> ID["$w^* x[n]$<br/>本來就要補的量"]
  DLY --> DT["$\delta t[n] = x[n]\,\delta w[n]$<br/>多補的量"]
${CLASSES}
  class M focus
  class DT warn`

/** 單頻 × 單頻：進去 f_x 與 f_w，出來 f_x − f_w 與 f_x + f_w，各 A·B/2（F-12.12；規格 §12.4 的例子） */
export const CHART_TONE_MIXER = String.raw`flowchart LR
  X["code $x(t) = A\cos(2\pi f_x t)$<br/>$A = 1$，$f_x = ${numUnit('100', 'kHz')}$"] --> M(("$\times$"))
  W["係數擾動 $\delta w(t) = B\cos(2\pi f_w t)$<br/>$B = ${numUnit('1', 'fs')}$，$f_w = ${numUnit('10', 'kHz')}$"] --> M
  M --> LO["差頻 $f_x - f_w = ${numUnit('90', 'kHz')}$<br/>peak $AB/2 = ${numUnit('0.5', 'fs')}$"]
  M --> HI["和頻 $f_x + f_w = ${numUnit('110', 'kHz')}$<br/>peak $AB/2 = ${numUnit('0.5', 'fs')}$"]
  M -.- NO["乘積裡沒有 $${numUnit('100', 'kHz')}$<br/>也沒有 $${numUnit('10', 'kHz')}$"]
${CLASSES}
  class M focus
  class NO warn`

/** 同一個乘法的三種看法：時域相乘 → 自相關相乘 → PSD 卷積（F-12.13） */
export const CHART_MIX_DOMAINS = String.raw`flowchart TB
  subgraph TIME["時域：每個 sample 相乘"]
    direction LR
    X["$x[n]$"] --> M1(("$\times$"))
    W["$\delta w[n]$"] --> M1
    M1 --> DT["$\delta t[n]$"]
  end
  subgraph CORR["自相關：也是相乘"]
    direction LR
    RX["$R_x[\ell]$"] --> M2(("$\times$"))
    RW["$R_w[\ell]$"] --> M2
    M2 --> RT["$R_{\delta t}[\ell]$"]
  end
  subgraph FREQ["頻域：卷積<br/>（一個頻譜拖著另一個掃過去）"]
    direction LR
    SX["$S_x$"] --> CV(("$\ast$"))
    SW["$S_w$（sample-rate 版）"] --> CV
    CV -- "$\div\,2\pi$" --> ST["$S_{\delta t}$"]
  end
  TIME -- "取期望值（$x$ 與 $\delta w$ 獨立）" --> CORR
  CORR -- "DTFT" --> FREQ
${CLASSES}
  class M1,M2,CV focus`

/** 同一份係數雜訊乘上三種 code：留在低頻／搬到 ±f_x／攤平（dtPsdOneSided 的 dcTerm、toneTerm、whiteTerm） */
export const CHART_THREE_CODES = String.raw`flowchart LR
  SW["係數雜訊的 PSD $S_w$<br/>集中在低頻（corner 約 $${numUnit((EX.f3dbExact / 1e3).toFixed(0), 'kHz')}$）"] --> M(("$\times$<br/>code"))
  M --> C1["常數 code<br/>$x = m$"]
  M --> C2["單頻 code<br/>$x = A\cos(2\pi f_x t)$"]
  M --> C3["白色 code<br/>$x = \pm 1$ 隨機"]
  C1 --> R1["留在低頻<br/>$S_{\delta t} = m^2 S_w(f)$"]
  C2 --> R2["搬到 $f_x$ 兩側<br/>$S_{\delta t} = \frac{A^2}{4}\left[S_w(f - f_x) + S_w(f + f_x)\right]$"]
  C3 --> R3["攤平到 $0 \ldots f_s/2$<br/>$S_{\delta t} = \sigma_x^2\,\sigma_w^2\,\frac{2}{f_s}$"]
${CLASSES}
  class M focus`

/**
 * code 有 DC 就有直通項：x = m + x̃ ⇒ δt = m·δw + x̃·δw（§12.6 的 callout、思考題 3）。
 * m·δw 留在低頻、落在 PLL 的 low-pass T 通帶內；x̃·δw 被搬到 x̃ 的頻率。code centering（m = 0）讓直通那一路消失。
 */
export const CHART_DC_FEEDTHROUGH = String.raw`flowchart TB
  X["code $x[n] = m + \tilde x[n]$"] --> DC["DC 成分 $m$<br/>code 的平均值"]
  X --> AC["零均值成分 $\tilde x[n]$<br/>例：DSM 的高頻抖動"]
  DC --> M1(("$\times$"))
  DW["係數雜訊 $\delta w[n]$<br/>功率集中在低頻"] --> M1
  DW --> M2(("$\times$"))
  AC --> M2
  M1 -- "$+m\,\delta w$：<br/>頻譜留在低頻" --> S(("$+$"))
  M2 -- "$+\tilde x\,\delta w$：<br/>搬到 $\tilde x$ 的頻率" --> S
  S -- "$\delta t[n]$" --> T["PLL 到輸出<br/>$|T|^2$ low-pass"]
  T --> OUT["output jitter<br/>$m\,\delta w$ 幾乎全部通過<br/>$\tilde x\,\delta w$ 只剩 PLL 頻寬內的部分"]
  DC -.- FIX["code centering：讓 $m = 0$<br/>直通這一路就消失"]
${CLASSES}
  class DC,M1 warn
  class FIX ok`

/**
 * block 邊界的時序：GMAC 累加 N 個 sample → LMS 更新一次 → DTC 保持同一個係數 N 個 sample（F-12.11 第二式）。
 * 三條泳道由上到下是 GMAC、LMS、DTC，每條泳道由左往右是時間（block k、block k+1）。
 * 原本是 sequenceDiagram，但它的文字不支援 KaTeX（`$...$` 會原樣顯示），所以改畫成 flowchart；
 * 泳道之間有連線，所以各 subgraph 自己的方向被忽略，沿用整張圖的 TB：每條泳道是一個橫條，兩個時間點並排。
 */
export const CHART_BLOCK_TIMING = String.raw`flowchart TB
  subgraph CG["Comparator 與 GMAC（每個 sample）"]
    A1["block $k$：累加 $N$ 個 sample<br/>的 $q[n]\,x[n]$"]
    A2["block $k+1$：<br/>再累加 $N$ 個 sample"]
  end
  subgraph LA["LMS 累加器（每個 block）"]
    B1["更新一次：<br/>$w_{k+1} = w_k + \mu G_k$"]
    B2["下一個 block<br/>再更新一次"]
  end
  subgraph DG["DTC 的 gain（每個 sample）"]
    D1["接下來 $N$ 個 sample<br/>都用同一個係數（ZOH）"]
    D2["換成新的係數，<br/>再保持 $N$ 個 sample"]
  end
  A1 -- "$G_k$<br/>（一個 block 只有一個值）" --> B1
  B1 -- "新係數，延遲 $n_c$ 個 sample<br/>後套用" --> D1
  A2 -- "$G_{k+1}$" --> B2
  B2 -- "再換一次係數" --> D2
${CLASSES}
  class B1,B2 focus`

/** ZOH 拆成兩步：插零上取樣 ↑N，再通過長度 N 的 boxcar；線上是每一步之後的 PSD（F-12.14） */
export const CHART_ZOH_TWO_STEP = String.raw`flowchart TB
  A["$\delta w_k$<br/>block rate $f_u$<br/>PSD：$S_w(e^{j\Omega})$"] --> UP["步驟 1：插零上取樣 $\uparrow N$<br/>$n = kN$ 時放 $\delta w_k$，其餘放 $0$"]
  UP -- "PSD：$(1/N)\,S_w(e^{jN\theta})$" --> BOX["步驟 2：boxcar 濾波器 $B$<br/>連續 $N$ 個 $1$ 相加"]
  BOX -- "再乘 $\left(\frac{\sin(N\theta/2)}{\sin(\theta/2)}\right)^2$" --> OUT["$\delta w[n]$<br/>sample rate $f_s$<br/>每個值保持 $N$ 個 sample"]
  OUT --> M(("$\times$"))
  X["code $x[n]$<br/>sample rate $f_s$"] --> M
  M --> DT["$\delta t[n]$"]
${CLASSES}
  class UP,BOX focus`

/** PSD 的換算：DTFT 形式 → 單邊 per-Hz（F-12.10）→ 輸出相位 PSD（F-12.16）→ ℒ(f) */
export const CHART_PSD_UNITS = String.raw`flowchart TB
  A["DTFT 形式 $S(e^{j\Omega})$<br/>雙邊<br/>變異數 $\sigma^2 = \frac{1}{2\pi}\int S\,d\Omega$"] -- "$\times\,2/f_r$" --> B["單邊 per-Hz：$S^{(1)}(f)$<br/>變異數 $\sigma^2 = \int S^{(1)}\,df$，<br/>由 $0$ 積到 $f_r/2$<br/>單位：$\mathrm{fs}^2/\mathrm{Hz}$"]
  B -- "$\delta t$ 的 PSD 才做這一步：<br/>$\times\,(2\pi f_{\mathrm{out}})^2|T|^2$（fs 換成秒）" --> C["輸出相位 PSD：$S_\phi^{(1)}(f)$<br/>單位：$\mathrm{rad}^2/\mathrm{Hz}$"]
  C -- "$\div\,2$，再取 $10\log_{10}$" --> D["$\mathcal L(f)$：單邊帶 phase noise<br/>單位：dBc/Hz"]
  A -.- NOTE["$f_r$ 是這個序列自己的取樣率<br/>block 量用 $f_u$，sample 量用 $f_s$"]
${CLASSES}
  class B focus`

/* ───────────────────────── §12.7 PLL 的兩個出口 ───────────────────────── */

/** 一個 DTC 誤差、兩個轉移函數：往 PD 是 H_PD（high-pass），往輸出是 T（low-pass）（F-12.15–17） */
export const CHART_TWO_EXITS = String.raw`flowchart LR
  DT["同一個 DTC 誤差 $\delta t(f)$<br/>reference edge 早到 $\delta t$"] --> PD["往 PD：$H_{\mathrm{PD}} = 1/(1+L)$<br/>high-pass"]
  DT --> T["往輸出：$T = L/(1+L)$<br/>low-pass"]
  PD --> EPD["PD residual<br/>$e_{\mathrm{PD}} = -2\pi f_{\mathrm{out}}\,H_{\mathrm{PD}}\,\delta t$<br/>PLL 頻寬外的成分才看得到"]
  T --> PO["輸出相位<br/>$\phi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\,T\,\delta t$<br/>PLL 頻寬內的成分才跟著走"]
  T --> J["輸出 jitter<br/>$\sigma_{t,\mathrm{out}}^2 = \int |T|^2\,S_{\delta t}\,df$"]
  DT -.- SUM["$H_{\mathrm{PD}} + T = 1$<br/>一邊看得到的，另一邊就看不到"]
${CLASSES}
  class PD,T focus`

/**
 * 最簡化的平均線性 PLL（docs/assumptions.md §2a 第 5 點）：Reference clock → DTC → PD，回授路徑上只有 divider。
 * DTC 的殘餘誤差在 PD 的 reference 輸入端注入：e_PD = φ_dtc − θ_out、θ_out = L·e_PD。
 * δt = x·δw 是多補償的時間（reference edge 早到 δt），所以 reference 輸入的時間誤差是 −δt、φ_dtc = −2π·f_out·δt
 * （相位一律是「時間誤差 × 2π·f_out」，晚到為正，和 e[n] = t_ref′ − t_fb 同一個方向）。
 * 兩個綠色方塊是解出來的結果（§12.7 推導第 3、4 行）：θ_out = T·φ_dtc、e_PD = H_PD·φ_dtc（都是正號）。
 * 回授路徑畫成一個 divider 方塊（output → divider → PD，路上沒有 DTC）：相位以 output 為參考（同一個 edge 時間誤差 × 2π·f_out），
 * 所以 divider 把 θ_out 原樣送回 PD，它的除數算在開迴路增益 L(s) 裡——L 那一格的「÷ 除數」和這個方塊是同一個 divider，不是兩個。
 * PD 出口的 e_PD 就是送進 loop filter 的節點，校正迴路的 comparator 取的也是它。
 */
export const CHART_PLL_LOOP = String.raw`flowchart TB
  REF["reference clock<br/>相位取 $0$"] --> DTC["DTC（reference 輸入端）<br/>多補償 $\delta t$：edge 早到 $\delta t$"]
  DTC -- "時間誤差 $-\delta t$" --> K["$\times\,2\pi f_{\mathrm{out}}$<br/>時間換相位"]
  K -- "$+\phi_{\mathrm{dtc}}$" --> S(("$+$"))
  S -- "$e_{\mathrm{PD}}$" --> L["開迴路增益 $L(s)$<br/>PD 增益 $\times$ loop filter $\times$ VCO $\div$ 除數"]
  L -- "$\theta_{\mathrm{out}}$" --> OUT["output 出口：PLL 輸出相位<br/>解出來 $\theta_{\mathrm{out}} = T\,\phi_{\mathrm{dtc}}$"]
  OUT --> DIV["divider：回授路徑上只有它<br/>除數已算進 $L(s)$"]
  DIV -- "$-\theta_{\mathrm{out}}$" --> S
  S -.- PDN["PD 出口：加法點就是 PD<br/>解出來 $e_{\mathrm{PD}} = H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}$<br/>comparator 取的也是 $e_{\mathrm{PD}}$"]
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
/** 三位小數的 fs 值，例如 '0.399\ \mathrm{fs}'（不含 `$`） */
const fs3 = (x: number) => numUnit(x.toFixed(3), 'fs')
const CT_BAND = `$${numUnit(String(CODE_TABLE_PRM.fL / 1e3), 'kHz')}$ 到 $${numUnit(String(CODE_TABLE_PRM.fH / 1e6), 'MHz')}$`

/**
 * 三種 code 把 δt 的功率放在不同頻率，所以兩個出口看到的不同（§12.7 的三種 code 表）。
 * 每一列：code → output（|T|² 加權）與 PD residual（|H_PD|² 加權）的 RMS；數字就是表格最後兩欄，藍色是看到比較多的出口。
 */
export const CHART_CODE_EXITS = String.raw`flowchart LR
  C1["常數 code<br/>$\delta t$ 的功率在低頻<br/>總 RMS $${fs3(ctRow('const').totalRms)}$"] --> O1["output：乘 $|T|^2$<br/>$${fs3(ctRow('const').outRms)}$，幾乎全部通過"]
  C1 --> P1["PD residual：乘 $|H_{\mathrm{PD}}|^2$<br/>$${fs3(ctRow('const').pdRms)}$，剩下的多半是 ZOH step 的高頻能量"]
  C2["單頻 code，$f_x = ${numUnit(String(CODE_TABLE_PRM.fx / 1e3), 'kHz')}$<br/>$\delta t$ 的功率在 $f_x$ 兩側<br/>總 RMS $${fs3(ctRow('tone').totalRms)}$"] --> O2["output：乘 $|T|^2$<br/>$${fs3(ctRow('tone').outRms)}$，全部通過<br/>還被 $T$ 的 peaking 放大一點"]
  C2 --> P2["PD residual：乘 $|H_{\mathrm{PD}}|^2$<br/>$${fs3(ctRow('tone').pdRms)}$，同樣只剩高頻的一點"]
  C3["$\pm 1$ 白色 code<br/>$\delta t$ 的功率攤平到 $0 \ldots f_s/2$<br/>總 RMS $${fs3(ctRow('white').totalRms)}$"] --> O3["output：乘 $|T|^2$<br/>$${fs3(ctRow('white').outRms)}$，只剩 PLL 頻寬內的一小部分"]
  C3 --> P3["PD residual：乘 $|H_{\mathrm{PD}}|^2$<br/>$${fs3(ctRow('white').pdRms)}$，頻寬外的成分都通過"]
  O3 -.- NOTE["output 與 PD 的數字都只積分 ${CT_BAND}<br/>PLL 頻寬 $${numUnit(String(CODE_TABLE_PRM.pll.f3dbT / 1e6), 'MHz')}$"]
${CLASSES}
  class O1,O2,P3 focus`

/* ───────────────────────── §12.8 spur ───────────────────────── */

/** spur 的計算流程：A_t → |T|·A_t → β → β/2 → dBc（F-12.18；數字是 T15 的例子） */
export const CHART_SPUR_FLOW = String.raw`flowchart TB
  AB["係數 tone：$B = ${numUnit('1', 'fs')}$ peak<br/>code tone：$A = 1$"] -- "相乘：$AB/2$" --> AT["DTC 端的 timing tone<br/>$A_t = ${numUnit(String(SPUR.at), 'fs')}$ peak"]
  AT -- "$\times\,|T(f_m)| = 1$" --> TO["輸出端的 timing tone<br/>$|T|\,A_t = ${numUnit(String(SPUR.at), 'fs')}$ peak"]
  TO -- "$\times\,2\pi f_{\mathrm{out}}$，$f_{\mathrm{out}} = ${numUnit(String(SPUR.fOut / 1e9), 'GHz')}$（fs 換成秒）" --> BETA["調變指數 $\beta = 2\pi f_{\mathrm{out}}|T|A_t$<br/>$= ${numUnit(texSci(SPUR.beta, 3), 'rad')}$"]
  BETA -- "$\div\,2$" --> HALF["sideband 對 carrier 的振幅比<br/>$\beta/2 = ${texSci(SPUR.beta / 2, 3)}$"]
  HALF -- "$20\log_{10}$" --> DBC["每一根 spur<br/>$${numUnit(SPUR.dbc.toFixed(2), 'dBc')}$"]
  BETA --> SPEC["輸出頻譜：carrier 在 $f_{\mathrm{out}}$<br/>兩根 spur 在 $f_{\mathrm{out}} \pm f_m$"]
${CLASSES}
  class BETA focus
  class DBC ok`

/** 隨機雜訊還是相干 spur：先判斷，再決定公式與單位（dBc/Hz 或 dBc） */
export const CHART_SKIRT_OR_SPUR = String.raw`flowchart TB
  START["FFT 上看到 $\delta t$ 或輸出相位的頻譜"] --> Q1{"這個成分是相干<br/>（週期性）的嗎？<br/>把紀錄長度加倍，<br/>看每個 bin 的功率讀數"}
  Q1 -- "讀數不變 → 相干" --> TONE["離散的 tone<br/>例：週期性干擾、量化的 limit cycle（第 13 章）"]
  Q1 -- "每個 bin 掉約 3 dB → 隨機" --> RAND["連續頻譜<br/>例：LMS 的係數雜訊 $\delta w$"]
  TONE --> SP["輸出是 spur，單位 dBc<br/>$20\log_{10}(\beta/2)$，F-12.18"]
  RAND --> SK["輸出是 noise skirt，單位 dBc/Hz<br/>$\mathcal L(f) = 10\log_{10}(S_\phi^{(1)}/2)$，F-12.10 與 F-12.16"]
  SK --> J["要一個數字：<br/>對頻率積分成 jitter<br/>F-12.17"]
${CLASSES}
  class SP warn
  class SK,J focus`

/* ───────────────────────── §12.9 比較與手算 ───────────────────────── */

/** 三個模擬引擎：只差在怎麼產生每個 block 的 G，之後的更新相同（linearStep／binomialStep／runBlockLms） */
export const CHART_ENGINES = String.raw`flowchart TB
  subgraph EA["(a) 線性遞迴"]
    A1["抽一個 $\eta \sim \mathcal{N}(0, 1/N)$"] --> A2["$G = -K\,\delta w + \eta$<br/>直線，不會飽和"]
  end
  subgraph EB["(b) Binomial Sign-LMS"]
    B1["抽一個 $N_+ \sim \mathrm{Bin}\big(N, \Phi(-C\,\delta w/\sigma_v)\big)$<br/>$N$ 次判斷裡 $q\,x = +1$ 的次數"] --> B2["$G = (2N_+ - N)/N$<br/>真的 1-bit 計數，$|G| \le 1$"]
  end
  subgraph EC["(c) 逐 sample"]
    C1["做 $N$ 個 sample：<br/>產生 $x$、$v$，$q = \mathrm{sign}(e)$"] --> C2["$G = \frac{1}{N}\sum q\,x$<br/>任何 code、路徑、延遲"]
  end
  A2 --> U["共同的更新：$\delta w \leftarrow \delta w + \mu G$"]
  B2 --> U
  C2 --> U
  U --> ST["跑很多個 block，統計 $\sigma_w$ 與 95% CI"]
${CLASSES}
  class A2,B2,C2 focus`

const HAND_TONE = (EX.sigmaW / Math.SQRT2).toFixed(3) // A = 1
const HAND_WHITE = (EX.sigmaW * Math.sqrt((2 * CODE_TABLE_PRM.fBw) / EX.input.fs)).toFixed(4) // f_BW = 1 MHz

/** 綜合手算 HC-12.8 的計算順序（格內的數字是範例 μ = 10 fs、σ_v = 100 fs、N = 4096、f_s = 4 GHz、A = 1、f_BW = 1 MHz 的答案） */
export const CHART_HAND_FLOW = String.raw`flowchart TB
  IN["輸入：$\mu$、$\sigma_v$、$N$、$f_s$、$A$、$f_{\mathrm{BW}}$<br/>（identity path：$C = 1$）"] --> G["(1) $g = \mu\sqrt{2/\pi}/\sigma_v$<br/>$= ${EX.g.toFixed(5)}$"]
  G --> P["(2) $p = 1 - g$<br/>$= ${EX.p.toFixed(5)}$"]
  P --> V["(3) $1 - p^2$，再乘上 $N$"]
  V --> SW["(4) $\sigma_w = \mu / \sqrt{N(1 - p^2)}$<br/>$= ${numUnit(EX.sigmaW.toFixed(4), 'fs')}$"]
  SW --> C1["(5) 常數 code<br/>$\delta t_{\mathrm{rms}} = \sigma_w = ${numUnit(SIGMA_W, 'fs')}$"]
  SW --> C2["(6) 單頻 code<br/>$\delta t_{\mathrm{rms}} = (A/\sqrt{2})\,\sigma_w = ${numUnit(HAND_TONE, 'fs')}$"]
  SW --> C3["(7) 白色 code，只算 $0 \ldots f_{\mathrm{BW}}$<br/>$\delta t_{\mathrm{rms}} = \sigma_w\sqrt{2 f_{\mathrm{BW}}/f_s} = ${numUnit(HAND_WHITE, 'fs')}$"]
${CLASSES}
  class SW focus`

/**
 * 連結到硬體：每個可以調的旋鈕動到雜訊鏈上的哪一格（§12.9「連結到硬體」的四個 callout）。
 * 實線是雜訊鏈（F-12.6 → F-12.5 → F-12.11 → F-12.17），虛線是旋鈕；藍色是硬體上可以調的東西。
 * 注意 σ_v 的兩個角色：1-bit 判斷之後 σ_η² ≈ 1/N 與 σ_v 無關（F-12.6），σ_v 是經由斜率 K = K_q·C = √(2/π)·C/σ_v
 * 進到 pole p = 1 − μK 才影響 σ_w（F-12.5 的第二種寫法 σ_w² = μ·σ_η²/(K·(2 − μK))）。
 */
export const CHART_HW_KNOBS = String.raw`flowchart TB
  V["comparator 前雜訊<br/>$\sigma_v$"] -- "1-bit 判斷，<br/>再平均 $N$ 筆" --> ETA["GMAC 雜訊 $\eta_k$<br/>$\sigma_\eta^2 \approx 1/N$（與 $\sigma_v$ 無關）<br/>每 $1/f_u$ 秒一個值"]
  ETA --> DW["係數雜訊 $\delta w_k$<br/>$\sigma_w^2 = \mu^2\sigma_\eta^2 / (1 - p^2)$"]
  DW --> DT["timing error<br/>$\delta t[n] = x[n]\,\delta w[n]$"]
  DT --> OUT["output jitter 或 spur<br/>$\sigma_{t,\mathrm{out}}^2 = \int |T|^2\,S_{\delta t}\,df$"]
  V -. "斜率 $K = \sqrt{2/\pi}\,C/\sigma_v$，<br/>進到 $p$" .-> DW
  RN["$\mathtt{REG\_GMAC\_N}$<br/>$N$"] -. "$\sigma_\eta^2$ 與<br/>$f_u = f_s/N$" .-> ETA
  RMU["$\mathtt{REG\_GAIN\_STEP}$<br/>$\mu$"] -. "$\mu^2$ 與<br/>$p = 1 - \mu K$" .-> DW
  BITS["DTC gain register 位寬"] -. "LSB 遠大於 $\sigma_w$ 時<br/>由量化主導（第 13 章）" .-> DW
  CODE["code 設計<br/>centering、白化"] -. "決定 $\delta t$ 的<br/>頻譜落在哪裡" .-> DT
  BW["PLL 頻寬"] -. "決定 $T$ 放過<br/>哪些頻率" .-> OUT
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
