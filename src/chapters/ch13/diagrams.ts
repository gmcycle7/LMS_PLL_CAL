/**
 * 第 13 章的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * - 每張圖是一個具名匯出的字串；`DIAGRAMS` 是全章的清單（diagrams.test.tsx 逐一用真正的 mermaid parser 解析、
 *   在 jsdom 裡實際 render 一次，並把圖上的數字和 `src/simulation/models/quantizer.ts` 的結果比對）。
 * - 圖裡的數學一律寫 `$...$` LaTeX（共用的 `Mermaid` 元件用 KaTeX 排版）；文字、單位與方塊名稱照常寫。
 *   原始碼用 `String.raw` 樣板字串，TeX 的反斜線只要寫一次；標籤內不用 `\\`，換行用 `<br/>`。
 *   圖上的訊號名稱、正負號、箭頭方向與正文公式一致：
 *   `e = δw = y − w*`（本章顯示用的約定）、`δ = a − w = −δw`（§0 約定，勘誤 E49）、
 *   `v[n] = w_H[n] + r[n−1]`、`y[n] = Q_B(v[n])`、`r[n] = v[n] − y[n]`。
 * - 加法點與正號一律用全形的「＋」（U+FF0B）：Mermaid 11 會把每個標籤當成 Markdown，
 *   半形 `+`、`-`、`1.` 開頭的標籤會被判成清單而顯示「Unsupported markdown: list」。單獨當標籤的負號用「−」（U+2212）；
 *   標籤裡還有公式時，負號寫成 `$-$`（KaTeX 的 \text 不認得 U+2212），例如 `-- "$-$ $y[n]$" -->`。乘法點寫 `(("$\times$"))`。
 * - 狀態圖（stateDiagram-v2）的轉移文字沒有雙引號，不會被前處理轉換：公式要直接寫成單一段 `$$...$$`
 *   （文字用 `\text{}` 包起來）；狀態方塊的標籤有雙引號，照一般寫 `$...$`。
 * - 顏色：藍（focus）= 這張圖要看的方塊；紅（warn）= 會出問題的地方；綠（ok）= 安全 / 對策。深淺主題都看得清楚。
 * - 版面（桌機 1280px 不橫向捲動，docs/teaching-style.md §8）：長鏈與迴圈用 `flowchart TB`（由上往下讀）；
 *   不要用 subgraph 的 `direction LR` 折列——只要群組內有節點連到群組外，Mermaid 就忽略它（diagrams.test.tsx 會檢查）；
 *   決策用六角形 `{{...}}`（菱形的邊長 = 文字寬 + 文字高，長問句會長成很大的正方形），標籤用 `<br/>` 手動換行（約 14 個中文字一行）。
 *   圖說與圖旁說明裡的方位詞（上面／下面／左邊／右邊）要和這裡的排版一致。
 * - 群組（subgraph）的標題不放 `$...$`：全站主題的 `.cluster-label span { font-size: .86em }` 會疊在 KaTeX 的每一層 span 上，
 *   標題裡的公式只剩 6–7px（diagrams.test.tsx 會檢查）；公式寫在群組裡的方塊。
 * - 兩個來源各以正負號連到兩個加法點時，連線會交叉（正負號標籤疊在交叉點，分不出哪個是哪個）：
 *   加一條隱形連線 `A ~~~ B`，讓 B 排在 A 的下一層，兩個來源就不會交叉（見 CHART_ERROR_PATH）。
 */
import type { SystemBlock } from '@/components'

const STYLE = String.raw`
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/* ───────────────────────── §13.0 開場 ───────────────────────── */

/**
 * （原有）6-bit gain code 的訊號流：高解析 accumulator → 量化策略 → 6-bit register → gain correction → reference 端的 DTC。
 * 架構照 docs/assumptions.md §2a：REF → DTC → PD → loop filter → VCO；回授是 VCO → divider → PD（LF → DIV → PD，
 * 回授路徑上只有 divider，主迴路在圖上是閉合的一圈）；
 * LMS 校正迴路的輸入是 PD 的輸出（PD 有兩條 e_PD 出線：一條去 loop filter、一條去 comparator）。
 * DTC 的延遲是 T_0 − 補償量（補償量 = Δ_LSB·y·x[n]）。本章的 e = y − w*（code 誤差）已經有別的意思，所以 PD 輸出記成 e_PD。
 * 虛線是「δt 經 T(f) 到輸出」的簡寫，不是實體的線：δt = Δ_LSB·(y − w*)·x 是多補償的時間（reference edge 早到 δt），
 * 在 PD 的 reference 輸入是 −δt = (a − w)·x，繞主迴路一圈才到 VCO 輸出（θ_out = T·φ_dtc，φ_dtc 是 −δt 換成相位）。
 * 敘述的順序會決定排版：PD → CMP 寫在 PD → LF 之前、虛線寫在回授之後，comparator 才會排在左邊、
 * 主迴路排在 PD 的正下方，三條回頭的線（校正迴路、回授、虛線）互不交叉；改順序前先截圖確認。
 */
export const CHART_SIGNAL_FLOW = String.raw`flowchart TB
  G["GMAC 平均 $G_k$"] --> ACC["LMS accumulator<br/>$w_H$（高解析）"]
  ACC --> Q["量化策略<br/>A Freeze / B Toggle / C Stochastic<br/>D $\Delta\Sigma$ / E $\Delta\Sigma$+dither"]
  Q --> REG["6-bit gain register<br/>$y \in \{0, \ldots, 63\}$"]
  REG --> GC["Gain correction<br/>補償量 $= \Delta_{\mathrm{LSB}} \cdot y \cdot x[n]$"]
  DSM["DSM residue $x[n]$"] --> GC
  GC --> DTC["DTC（reference 端）<br/>延遲 $= T_0 - \Delta_{\mathrm{LSB}} \cdot y \cdot x[n]$"]
  REF["Reference clock"] --> DTC
  DTC --> PD["Phase detector"]
  PD -- "$e_{\mathrm{PD}}[n]$：PD 的輸出" --> CMP["1-bit comparator<br/>$q = \mathrm{sign}(e_{\mathrm{PD}})$"]
  PD -- "$e_{\mathrm{PD}}[n]$" --> LF["Loop filter → VCO"]
  LF -- "VCO 輸出" --> DIV["Divider / PMUX<br/>（回授路徑上只有它）"]
  DIV --> PD
  DTC -. "$\delta t = \Delta_{\mathrm{LSB}} \cdot (y - w^*) \cdot x$" .-> OUT["PLL output（經 $T(f)$）"]
  CMP --> G${STYLE}
  class Q focus`

/** 誤差的定義、單位換算與兩種正負號約定（F-13.1、勘誤 E13 / E49）。 */
export const CHART_ERROR_PATH = String.raw`flowchart TB
  Y["$y[n]$<br/>6-bit code（LSB）"] -- "＋" --> S1(("＋"))
  WS["$w^*$<br/>理想係數 32.4（LSB）"] -- "−" --> S1
  S1 -- "$e = \delta w = y - w^*$（LSB）" --> K["$\times\, \Delta_{\mathrm{LSB}}$<br/>fs/LSB，示例 0.125"]
  K -- "gain 誤差（fs）" --> M(("$\times$"))
  X["$x[n]$<br/>DSM residue"] --> M
  M -- "$\delta t[n] = \Delta_{\mathrm{LSB}} \cdot e[n] \cdot x[n]$（fs）" --> T["$T(f)$<br/>PLL low-pass"]
  T --> OUT["PLL 輸出的 jitter / spur"]
  WS -- "＋" --> S2(("＋"))
  Y -- "−" --> S2
  Y ~~~ WS
  S2 -- "$\delta = a - w = w^* - y = -\delta w$" --> N0["§0 的約定<br/>同一個誤差，正負號相反"]${STYLE}
  class S1,K focus`

/* ───────────────────────── §13.1 方法 A ───────────────────────── */

/** 方法 A：只在凍結瞬間量化一次，之後完全不看 w_H。 */
export const CHART_FREEZE = String.raw`flowchart TB
  WH["$w_H[n]$<br/>LMS accumulator（高解析）"] -- "凍結瞬間取樣一次" --> LAT["latch：$w_{\mathrm{freeze}} = w^* = 32.4$<br/>之後不再更新"]
  WH -. "之後的變化被忽略" .-> LAT
  LAT --> Q["$Q_B$：$\lfloor 32.4 + \tfrac12 \rfloor$"]
  Q --> Y["$y[n] = 32$<br/>每個 $n$ 都一樣"]
  Y -- "＋" --> S(("＋"))
  WS["$w^* = 32.4$"] -- "−" --> S
  S -- "$e[n] = y - w^* = -0.4$ LSB（常數）" --> DC["全部功率在 DC<br/>平方平均 $0.16\,\mathrm{LSB}^2$，變異數 0"]${STYLE}
  class LAT focus`

/* ───────────────────────── §13.2 方法 B ───────────────────────── */

/** 方法 B：計數器 + Bresenham pattern（開迴路，沒有回授線）。F-13.3。 */
export const CHART_TOGGLE = String.raw`flowchart TB
  WH["$w_H = 32.4$"] --> SP["拆開：$\lfloor w_H \rfloor = 32$<br/>小數 $p = 0.4$"]
  SP -- "$p$" --> H["$h = \mathrm{round}(p \cdot L_t) = 2$<br/>$L_t = 5$ 次裡進位 2 次"]
  CNT["計數器 $n' = n \bmod L_t$<br/>$0, 1, 2, 3, 4, 0, \ldots$"] --> PAT["Bresenham pattern<br/>$s = \lfloor (n'+1)h/L_t \rfloor - \lfloor n'h/L_t \rfloor$"]
  H --> PAT
  SP -- "＋ $\lfloor w_H \rfloor = 32$" --> ADD(("＋"))
  PAT -- "＋ $s[n] = 0, 0, 1, 0, 1$" --> ADD
  ADD --> Y["$y[n] = 32, 32, 33, 32, 33$<br/>平均 32.4"]${STYLE}
  class CNT,PAT focus`

/** 週期 5 的誤差怎麼變成兩條譜線（F-13.4、勘誤 E47）。 */
export const CHART_TOGGLE_SPECTRUM = String.raw`flowchart TB
  E["$e[n] = y[n] - 32.4$<br/>$-0.4, -0.4, 0.6, -0.4, 0.6$（週期 5）"] --> DFT["離散傅立葉係數 $c_k$<br/>$k = 0, 1, 2, 3, 4$"]
  DFT --> C0["$k = 0$：$c_0$ = 平均 $= 0$<br/>沒有 DC 誤差"]
  DFT --> C1["$k = 1$ 與 $4$（共軛對）<br/>$|c_1| = (\sqrt5 - 1)/10 = 0.1236$"]
  DFT --> C2["$k = 2$ 與 $3$（共軛對）<br/>$|c_2| = (\sqrt5 + 1)/10 = 0.3236$"]
  C1 -- "正負頻率合併：$\times 2$" --> P1["$f_u/5$<br/>$P_1 = 2|c_1|^2 = 0.03056\,\mathrm{LSB}^2$"]
  C2 -- "$\times 2$" --> P2["$2f_u/5$（主 spur）<br/>$P_2 = 2|c_2|^2 = 0.20944\,\mathrm{LSB}^2$"]
  P1 -- "＋" --> SUM(("＋"))
  P2 -- "＋" --> SUM
  SUM --> TOT["Parseval：總和 $0.24\,\mathrm{LSB}^2$<br/>$= p(1 - p)$"]${STYLE}
  class P2 warn`

/** code 以 ZOH 保持到更快的取樣率：譜線複製到所有 k·f_u/5，並乘上離散 sinc² 權重（F-13.5）。 */
export const CHART_ZOH = String.raw`flowchart TB
  E["$e[n]$：每次 code 更新一個值<br/>取樣率 $f_u$，週期 5"] --> ZOH["ZOH：每個 code 保持 $N_h$ 個 cycle<br/>$z[m] = e[\lfloor m/N_h \rfloor]$"]
  ZOH --> Z["$z[m]$：每個 reference cycle 一個值<br/>取樣率 $f_s = N_h \cdot f_u$，週期 $5 \cdot N_h$"]
  Z --> L["譜線出現在所有 $k \cdot f_u/5$<br/>$k = 1, 2, 3, \ldots$（不只 $k = 1, 2$）"]
  ZOH -. "保持的頻率響應" .-> G["$G_k = \sin(\pi k/5) \,/\, \big(N_h \cdot \sin(\pi k/(5N_h))\big)$<br/>離散 sinc，包絡隨 $k$ 變小"]
  G --> P["$P_k = 2 \cdot |c_{k \bmod 5}|^2 \cdot G_k^2$"]
  L --> P
  G --> ZERO["$k = 5, 10, \ldots$：$G_k = 0$<br/>ZOH 的零點，沒有譜線"]${STYLE}
  class ZOH focus`

/* ───────────────────────── §13.3 方法 C ───────────────────────── */

/** 方法 C：亂數 + 比較器決定要不要進位（F-13.6）。 */
export const CHART_STOCHASTIC = String.raw`flowchart TB
  WH["$w_H = 32.4$"] --> SP["拆開：$\lfloor w_H \rfloor = 32$<br/>小數 $p = 0.4$"]
  RNG["亂數產生器（或 PRBS）<br/>$\mathrm{rand}[n]$ 均勻落在 0 到 1，每次獨立"] --> CMP{"$\mathrm{rand}[n] \lt p$ ?"}
  SP -- "$p$" --> CMP
  CMP -- "是，機率 $p$：$X = 1$" --> ADD(("＋"))
  CMP -- "否，機率 $1 - p$：$X = 0$" --> ADD
  SP -- "＋ $\lfloor w_H \rfloor = 32$" --> ADD
  ADD --> Y["$y[n] = 32 + X[n]$<br/>$E[y] = 32.4$，$\mathrm{Var}(y) = p(1 - p) = 0.24$"]${STYLE}
  class RNG,CMP focus`

/* ───────────────────────── §13.4 方法 D ───────────────────────── */

/** 一階 error-feedback ΔΣ 迴圈：加法器、Q、相減、z⁻¹（訊號 v、y、r）。 */
export const CHART_EFB_LOOP = String.raw`flowchart TB
  WH["$w_H[n]$<br/>高解析係數"] -- "＋" --> A1(("＋"))
  A1 -- "$v[n] = w_H[n] + r[n-1]$" --> Q["$Q_6$：$\lfloor v + \tfrac12 \rfloor$<br/>6-bit 量化器"]
  Q -- "$y[n]$" --> OUT["$y[n]$<br/>6-bit code，送到 DTC"]
  A1 -- "＋ $v[n]$" --> A2(("＋"))
  Q -- "$-$ $y[n]$" --> A2
  A2 -- "$r[n] = v[n] - y[n]$" --> Z["$z^{-1}$<br/>$r$ 暫存器 s.r"]
  Z -- "＋ $r[n-1]$" --> A1${STYLE}
  class A2,Z focus`

/** 常數 32.4（round-half-up、r[−1] = 0）的週期 5 limit cycle：r 的狀態圖。 */
export const CHART_LIMIT_CYCLE = String.raw`stateDiagram-v2
  direction LR
  state "$r = 0$" as R0
  state "$r = 0.4$" as R1
  state "$r = -0.2$" as R2
  state "$r = 0.2$" as R3
  state "$r = -0.4$" as R4
  [*] --> R0 : $$\text{起點 } r[-1] = 0$$
  R0 --> R1 : $$v = 32.4 \to y = 32$$
  R1 --> R2 : $$v = 32.8 \to y = 33$$
  R2 --> R3 : $$v = 32.2 \to y = 32$$
  R3 --> R4 : $$v = 32.6 \to y = 33$$
  R4 --> R0 : $$v = 32.0 \to y = 32$$`

/** 訊號路徑（增益 1）與誤差路徑（NTF = 1 − z⁻¹）：F-13.7、F-13.9。 */
export const CHART_NTF_PATHS = String.raw`flowchart TB
  WH["$W_H(z)$<br/>訊號：高解析係數"] -- "＋，訊號路徑增益 1" --> S(("＋"))
  R["$R(z)$<br/>量化誤差 $r$"] --> NTF["$\mathrm{NTF}(z) = 1 - z^{-1}$<br/>現在的 $r$ 減掉上一次的 $r$"]
  NTF -- "−" --> S
  S --> Y["$Y(z) = W_H(z) - (1 - z^{-1}) \cdot R(z)$"]
  NTF -. "低頻 $f \ll f_u$" .-> LO["$|\mathrm{NTF}|^2 \approx (2\pi f/f_u)^2$<br/>誤差被壓得很小，每 decade $+20\,\mathrm{dB}$"]
  NTF -. "Nyquist $f = f_u/2$" .-> HI["$|\mathrm{NTF}|^2 = 4$，也就是 $+6\,\mathrm{dB}$<br/>誤差被推到高頻"]${STYLE}
  class NTF focus`

/**
 * 同一個迴圈換個畫法：r 是 (w_H − y) 的累加器，有界 ⇒ 平均追得上（F-13.12）。
 * 圖上的常數 1/N 是方法 D 的結果：沒有 dither、沒有 overload，而且起點 r[−1] 也在 |r| ≤ ½ 內；
 * 方法 E 加了峰對峰 A 的 dither 之後是 (1 + A)/N（等式不變，見 §13.4 的說明與公式登錄）。
 */
export const CHART_TELESCOPING = String.raw`flowchart TB
  WH["$w_H[n]$"] -- "＋" --> D0(("＋"))
  Y["$y[n]$"] -- "−" --> D0
  D0 -- "$w_H[n] - y[n]$" --> ACC["累加器 $1/(1 - z^{-1})$<br/>$r[n] = r[n-1] + (w_H[n] - y[n])$"]
  ACC -- "$r[n]$，方法 D 沒有 overload 時 $|r| \le \tfrac12$" --> B["$N$ 次加總只剩頭尾<br/>$\sum (y - w_H) = r[-1] - r[N-1]$"]
  B --> AVG["除以 $N$<br/>$r[-1]$ 也在這個範圍內時<br/>平均誤差的大小 $\le 1/N$"]${STYLE}
  class ACC focus`

/** limit cycle 週期怎麼算（F-13.8、勘誤 E15）。 */
export const CHART_PERIOD_FLOW = String.raw`flowchart TB
  W["常數 $w_H$"] --> T{"$w_H$ 怎麼表示？"}
  T -- "精確有理數" --> R1["約分成最簡分數 $m/q$<br/>$32.4 = 162/5$"]
  R1 --> P1["週期 $= q = 5$"]
  T -- "定點，$F$ 個小數 bit" --> F1["$K = \mathrm{round}(w_H \cdot 2^F)$<br/>$F = 10$：$K = 33178$"]
  F1 --> F2["取小數部分：$K \bmod 2^F = 410$"]
  F2 --> F3["$g = \gcd(410, 1024) = 2$"]
  F3 --> P2["週期 $= 2^F / g = 512$"]${STYLE}
  class P1,P2 focus`

/* ───────────────────────── §13.4E 方法 E ───────────────────────── */

/** 方法 E：dither 只加在量化器輸入；回授的 r 以未加 dither 的 v 為基準（F-13.10）。 */
export const CHART_DITHER_LOOP = String.raw`flowchart TB
  WH["$w_H[n]$"] -- "＋" --> A1(("＋"))
  A1 -- "＋ $v[n] = w_H[n] + r[n-1]$" --> A3(("＋"))
  DI["dither $d[n]$<br/>零平均亂數，峰對峰寬度 $A$"] -- "＋" --> A3
  A3 -- "$u[n] = v[n] + d[n]$" --> Q["$Q_6$：$\lfloor u + \tfrac12 \rfloor$"]
  Q -- "$y[n]$" --> OUT["$y[n]$<br/>6-bit code，送到 DTC"]
  A1 -- "＋ $v[n]$，不含 $d$" --> A2(("＋"))
  Q -- "$-$ $y[n]$" --> A2
  A2 -- "$r[n] = v[n] - y[n]$" --> Z["$z^{-1}$<br/>$r$ 暫存器"]
  Z -- "＋ $r[n-1]$" --> A1${STYLE}
  class DI,A3 focus`

/* ───────────────────────── 五策略比較 ───────────────────────── */

/** 五種策略並排：送進共用量化器的東西不同；藍色 = 有誤差回授（閉迴路）。 */
export const CHART_FIVE_STRATEGIES = String.raw`flowchart TB
  WH["$w_H[n]$<br/>高解析係數"] --> SA["A Freeze<br/>$v$ = 凍結時的 $w^*$<br/>不再看 $w_H$"]
  WH --> SB["B Toggle<br/>$v = \lfloor w_H \rfloor$<br/>$+\,\mathrm{pattern}(n \bmod L_t)$"]
  WH --> SC["C Stochastic<br/>$v = \lfloor w_H \rfloor$<br/>$+\,(\mathrm{rand} \lt p)$"]
  WH --> SD["D $\Delta\Sigma$<br/>$v = w_H + r[n-1]$"]
  WH --> SE["E $\Delta\Sigma$ + dither<br/>量化 $v + d$<br/>$v = w_H + r[n-1]$"]
  CNT["計數器 $n$"] -.-> SB
  RNG["亂數 / PRBS"] -.-> SC
  RNG -.-> SE
  SA --> Q["共用的 $Q_B$<br/>四捨五入 + saturate"]
  SB --> Q
  SC --> Q
  SD --> Q
  SE --> Q
  Q -. "$r[n] = v - y$<br/>經 $z^{-1}$ 回授" .-> SD
  Q -. "$r[n] = v - y$<br/>經 $z^{-1}$ 回授" .-> SE
  Q --> Y["$y[n]$<br/>6-bit code"]${STYLE}
  class SD,SE focus`

/** 同樣的功率、不同的頻率分布：「平均正確 ≠ 頻譜理想」。 */
export const CHART_POWER_SPLIT = String.raw`flowchart LR
  T["只用 32 與 33、平均 32.4<br/>總誤差功率一定是 $p(1 - p) = 0.24\,\mathrm{LSB}^2$"] --> BD["B Toggle、D $\Delta\Sigma$（常數輸入）<br/>兩條譜線：0.03056 在 $f_u/5$、0.20944 在 $2f_u/5$"]
  T --> SC["C Stochastic<br/>白色：0 到 $f_u/2$ 一樣高，PSD $= 2p(1 - p)/f_u$"]
  SA["A Freeze：只用 32<br/>$0.16\,\mathrm{LSB}^2$"] --> ADC["全部在 DC<br/>static error $-0.4$ LSB"]
  SE["E $\Delta\Sigma$ + dither（寬度 1 LSB）<br/>用到 31 到 34，總功率變大（白色近似 $1/3\,\mathrm{LSB}^2$）"] --> EHF["沒有譜線<br/>被 $1 - z^{-1}$ 推到高頻，低頻很小"]${STYLE}
  class BD warn`

/** Quantized Gain Lab 算了什麼：從參數到 σ_out 的資料流。 */
export const CHART_LAB_PIPELINE = String.raw`flowchart TB
  PRM["參數：$w^*$、位元數、rounding、seed"] --> WH["lmsTarget：產生 $w_H[n]$<br/>常數，或加 LMS 雜訊 / PVT 漂移"]
  WH --> ST["量化策略 A 到 E<br/>每個 Case 選一種"]
  ST --> Y["$y[n]$<br/>6-bit code"]
  Y --> PER["週期偵測<br/>limit-cycle period"]
  Y --> ERR["$e = y - w^*$"]
  ERR --> SPEC["譜線表與 Welch PSD<br/>DC 誤差、總功率、<br/>頻帶內功率"]
  ERR --> MIX["ZOH 保持 $N_{\mathrm{upd}}$ 個 cycle<br/>再 $\times\, x[n] \times \Delta_{\mathrm{LSB}}$"]
  MIX --> TF["乘上 $|T(f)|^2$ 再積分"]
  TF --> SIG["$\sigma_{\mathrm{out}}$（fs）"]${STYLE}
  class ST focus`

/* ───────────────────────── §13.5a 時變 w_H ───────────────────────── */

/** w_H[n] = w* + δw[n]（AR(1) 的 LMS 雜訊）；code 誤差拆成 e = ε + δw。 */
export const CHART_TIME_VARYING = String.raw`flowchart TB
  XI["白雜訊 $\xi[n]$<br/>獨立、零平均、變異數 1"] --> AR["AR(1)：$\delta w[n+1] = p_{\mathrm{cal}} \cdot \delta w[n] + g \cdot \xi[n]$<br/>一階 low-pass，$g = \sqrt{1 - p_{\mathrm{cal}}^2} \cdot \sigma_w$"]
  AR -- "＋ $\delta w[n]$，RMS $= \sigma_w$" --> S1(("＋"))
  WS["$w^* = 32.4$"] -- "＋" --> S1
  S1 -- "$w_H[n] = w^* + \delta w[n]$" --> QS["量化策略 B / C / D / E"]
  QS -- "＋ $y[n]$" --> S2(("＋"))
  S1 -- "$-$ $w_H[n]$" --> S2
  S2 -- "＋ $\epsilon[n] = y[n] - w_H[n]$，量化誤差" --> S3(("＋"))
  AR -- "＋ $\delta w[n]$，LMS 地板" --> S3
  S3 --> OUT["$e[n] = y[n] - w^* = \epsilon[n] + \delta w[n]$<br/>code 誤差"]${STYLE}
  class QS focus`

/**
 * 頻帶內量化誤差：白色（一次方）vs 一階塑形（三次方）。F-13.13。
 * 兩個群組都有連到外面的 CMP：Mermaid 會忽略群組自己的 direction，所以不寫；兩欄各自由上往下讀。
 */
export const CHART_INBAND = String.raw`flowchart TB
  subgraph CW["C Stochastic：白色誤差"]
    C1["每次的變異數 $p(1 - p)$<br/>平均 $E[p(1 - p)] \approx p_0(1 - p_0) - \sigma_w^2$"] --> C2["PSD 是平的<br/>高度 $2 \cdot E[p(1 - p)]/f_u$"]
    C2 --> C3["頻帶內 $=$ 高度 $\times$ 寬度 $f_B$<br/>$P_{\mathrm{in}} = 2 \cdot E[p(1 - p)] \cdot (f_B/f_u)$"]
  end
  subgraph DS["D 誤差回授：被 NTF 塑形"]
    D1["$r$ 的變異數 $\sigma_r^2$<br/>白色近似取 $1/12$<br/>塑形的 NTF $= 1 - z^{-1}$"] --> D2["PSD $\approx (2\pi f/f_u)^2 \cdot 2\sigma_r^2/f_u$<br/>低頻時隨 $f^2$ 變小"]
    D2 --> D3["積分到 $f_B$：$f^2$ 的積分是 $f_B^3/3$<br/>$P_{\mathrm{in}} \approx (8\pi^2/3) \cdot \sigma_r^2 \cdot (f_B/f_u)^3$"]
  end
  C3 --> CMP["$f_B/f_u = 1/64$：一次方對三次方<br/>約 $6\times10^{-3}$ 對 $8\times10^{-6}\,\mathrm{LSB}^2$"]
  D3 --> CMP${STYLE}
  class C3,D3 focus`

/* ───────────────────────── §13.5b 六個準則 ───────────────────────── */

/** code 誤差到 output jitter 的路徑：ZOH → 乘上 DSM residue → Δ_LSB → |T(f)|²（F-13.11）。 */
export const CHART_MIXING_PATH = String.raw`flowchart TB
  Y["$y[k]$<br/>6-bit code，每 $N_{\mathrm{upd}}$ 個 cycle 更新（$f_u$）"] -- "＋" --> S(("＋"))
  WS["$w^*$"] -- "−" --> S
  S -- "$e[k] = y[k] - w^*$" --> ZOH["ZOH：保持 $N_{\mathrm{upd}}$ 個 cycle<br/>$e_s[n] = e[\lfloor n/N_{\mathrm{upd}} \rfloor]$"]
  ZOH -- "$e_s[n]$，每個 reference cycle（$f_s$）" --> M(("$\times$"))
  X["$x[n]$<br/>DSM residue（$f_s$）"] --> M
  M --> K["$\times\, \Delta_{\mathrm{LSB}}$"]
  K -- "$\delta t[n] = \Delta_{\mathrm{LSB}} \cdot e_s[n] \cdot x[n]$（fs）" --> T["$|T(f)|^2$<br/>PLL closed-loop low-pass"]
  T --> OUT["$\sigma_{\mathrm{out}}^2 = \int |T|^2 \cdot S_{\delta t}\, df$<br/>output jitter"]${STYLE}
  class M focus`

/** 一個具體的差頻：2f_s/5 的 code tone 乘上 DSM residue 的第 51 次諧波，落在 f_s/640 = 156 kHz。 */
export const CHART_TONE_MIXING = String.raw`flowchart LR
  E["code 誤差的 tone<br/>$f_e = 2f_s/5 = 40\,\mathrm{MHz}$，遠在通帶外"] --> M(("$\times$"))
  X["DSM residue 的第 51 次諧波<br/>$f_x = 51 \cdot f_s/128 = 39.84\,\mathrm{MHz}$"] --> M
  M -- "差頻" --> DF["$|f_x - f_e| = f_s/640 = 156\,\mathrm{kHz}$"]
  M -- "和頻" --> SF["$f_x + f_e = 79.84\,\mathrm{MHz}$<br/>取樣後摺到 $20.16\,\mathrm{MHz}$"]
  DF -- "低於 $f_{\mathrm{BW}} = 1\,\mathrm{MHz}$" --> IN["通過 $T(f)$<br/>變成 output jitter / spur"]
  SF -- "高於 $f_{\mathrm{BW}} = 1\,\mathrm{MHz}$" --> NO["被 $T(f)$ 濾掉"]${STYLE}
  class DF,IN warn
  class NO ok`

/** Sign-off 前的檢查：紀錄長度有沒有涵蓋一整個混頻週期（FCW 陷阱）。 */
export const CHART_RECORD_CHECK = String.raw`flowchart TB
  PC["$P_{\mathrm{code}}$：code 的 limit-cycle 週期<br/>本例 5 次更新"] --> L["混頻週期 $P_{\mathrm{mix}} = \mathrm{lcm}(P_{\mathrm{code}} \cdot N_{\mathrm{upd}},\, P_{\mathrm{DSM}})$<br/>單位：reference cycle"]
  PD["$P_{\mathrm{DSM}}$：DSM residue 的週期<br/>$2^{20} / \gcd(K,\, 2^{20})$ 個 cycle"] --> L
  L --> C{"紀錄長度 $\ge P_{\mathrm{mix}}$ ？"}
  C -- "是。$\mathrm{frac} = 13/128$：$P_{\mathrm{mix}} = 640$" --> OKN["混頻產物都在 $f_s/640$ 的倍數上，高於 $f_L$<br/>$\sigma_{\mathrm{out}}$ 可信"]
  C -- "否。$\mathrm{frac} = 0.1$：$P_{\mathrm{mix}} = 2621440$" --> BAD["最大的產物比紀錄還慢<br/>看起來像靜態偏移，$\sigma_{\mathrm{out}}$ 被低估"]
  BAD --> FIX["模擬一整個混頻週期<br/>看區塊平均的慢階梯 $\sigma_{\mathrm{slow}}$"]${STYLE}
  class OKN ok
  class BAD warn`

/** 沿著 §13.5 六個準則的選擇流程（教學用的思考順序，不是 sign-off 規則）。 */
export const CHART_DECISION = String.raw`flowchart TB
  ST["要把 $w_H$ 放進 6-bit code"] --> Q1{{"準則 1、4<br/>能接受最多 $\tfrac12$ LSB 的<br/>static error，而且<br/>不必追 PVT 漂移？"}}
  Q1 -- "能" --> SA["A Freeze<br/>沒有 code tone、<br/>不切換"]
  Q1 -- "不能" --> Q2{{"$w_H$ 會一直變嗎？<br/>背景 LMS 持續更新"}}
  Q2 -- "會，LMS 雜訊<br/>本身就像 dither" --> SD["D $\Delta\Sigma$<br/>平均追上 $w_H$，<br/>頻帶內量化誤差很小"]
  Q2 -- "不會，<br/>常數或已凍結" --> Q3{{"準則 2、6<br/>limit cycle 的 tone 乘上<br/>DSM residue，差頻會<br/>落進 $T(f)$ 通帶？"}}
  Q3 -- "不會" --> SBD["B Toggle 或 D $\Delta\Sigma$<br/>常數時是同一個循環"]
  Q3 -- "會，或不確定" --> Q4{{"準則 3<br/>能接受 code 擺到<br/>31 到 34 與較大的<br/>總功率？"}}
  Q4 -- "能" --> SE["E $\Delta\Sigma$ + dither<br/>打散 tone，<br/>低頻仍被塑形"]
  Q4 -- "不能" --> SC["C Stochastic<br/>只用兩階、白色，<br/>頻帶內地板較高"]
  SA --> V["準則 5：用實際的 FCW、$N_{\mathrm{upd}}$、$T(f)$<br/>模擬確認，紀錄要長於混頻週期"]
  SD --> V
  SBD --> V
  SE --> V
  SC --> V${STYLE}
  class V focus`

/* ───────────────────────── §13.6 非理想 ───────────────────────── */

/** 超出 6-bit 範圍時：saturate（夾住，但 r 會 windup）對 wrap（進位被丟掉，code 掉到 0）。 */
export const CHART_SAT_WRAP = String.raw`flowchart TB
  V["$v[n] = 63.4 + r[n-1]$<br/>有些拍四捨五入得到 64，超出 0 到 63"] --> OV{"overflow 怎麼處理？"}
  OV -- "saturate" --> SAT["$y = 63$<br/>夾在最大 code"]
  OV -- "wrap：丟掉進位" --> WR["$y = 64 \bmod 64 = 0$<br/>gain 瞬間崩到 0"]
  SAT --> RS["$r[n] = v - 63$，每次多 0.4<br/>一直累積：windup"]
  RS --> AW["對策：anti-windup<br/>把 $r$ 夾回 $-\tfrac12$ 到 $\tfrac12$"]
  WR --> RW["40% 的更新輸出 0<br/>平均 code $\approx 0.6 \times 63 = 37.8$"]${STYLE}
  class WR,RW warn
  class SAT,AW ok`

/** anti-windup 夾在哪裡：r 存回暫存器之前（對應程式碼的 residual()）。 */
export const CHART_ANTIWINDUP = String.raw`flowchart TB
  WH["$w_H[n]$<br/>例：63.3，超出範圍"] -- "＋" --> A1(("＋"))
  A1 -- "$v[n]$" --> Q["$Q_6$ + saturate<br/>$y$ 最大只能 63"]
  Q -- "$y[n]$" --> OUT["$y[n] = 63$"]
  A1 -- "＋ $v[n]$" --> A2(("＋"))
  Q -- "$-$ $y[n]$" --> A2
  A2 -- "$r = v - y$，overload 時每次多 0.3" --> CL["anti-windup clamp<br/>$r$ 夾在 $-\tfrac12$ 到 $\tfrac12$"]
  CL --> Z["$z^{-1}$<br/>$r$ 暫存器"]
  Z -- "＋ $r[n-1]$" --> A1${STYLE}
  class CL focus`

/**
 * 跨 clock domain：31 → 32 時二進位 6 個 bit 同時翻轉；gray 碼只有相鄰的 code 才只翻 1 個 bit，31 → 34 仍翻 3 個 bit。
 * 版面（flowchart LR）由上到下三列：二進位 31 → 32、gray 碼 31 → 32、gray 碼 31 → 34；圖說用「最上面／中間／最下面」。
 */
export const CHART_CDC = String.raw`flowchart LR
  A["code domain（$f_u$）<br/>$y$：31 $\to$ 32"] -- "二進位 011111 → 100000<br/>6 個 bit 同時翻" --> S{"DTC domain 剛好在<br/>轉換瞬間取樣？"}
  S -- "是" --> BAD["可能讀到 0 到 63 的任何值<br/>gain 瞬間錯很多"]
  S -- "否" --> GOOD["讀到正確的 32"]
  A -- "改用 gray 碼 010000 → 110000<br/>相鄰 code：只翻 1 個 bit" --> SAFE["只會讀到 31 或 32<br/>最壞差 1 LSB"]
  M["一次跳 3 LSB<br/>$y$：31 $\to$ 34"] -- "gray 碼 010000 → 110011<br/>翻 3 個 bit" --> MIX["可能讀到 28 到 35<br/>要改用 handshake"]${STYLE}
  class BAD,MIX warn
  class SAFE ok`

/* ───────────────────────── 章末 ───────────────────────── */

/** 綜合手算 HC-13.8 的計算順序（預設數字）。 */
export const CHART_SYNTHESIS_FLOW = String.raw`flowchart TB
  IN["已知：$w^* = 32.4$、$\Delta_{\mathrm{LSB}} = 0.125\,\mathrm{fs/LSB}$、<br/>$x_{\mathrm{rms}} = 1$、$\sigma_w = 0.2\,\mathrm{LSB}$、$f_u/f_B = 64$"] --> A1["A Freeze：<br/>$y = \lfloor 32.4 + \tfrac12 \rfloor = 32$<br/>$\delta w = -0.4\,\mathrm{LSB}$"]
  A1 --> A2["$\Delta_{\mathrm{LSB}} \cdot |\delta w| \cdot x_{\mathrm{rms}}$<br/>$= 0.05\,\mathrm{fs}$<br/>全在 DC，所以也全在頻帶內"]
  IN --> S1["兩階切換 B / C / D：<br/>$p_0 = 0.4$<br/>$e_{\mathrm{rms}} = \sqrt{0.4 \times 0.6} = 0.490\,\mathrm{LSB}$"]
  S1 --> S2["總 RMS：<br/>$0.125 \times 0.490$<br/>$= 0.0612\,\mathrm{fs}$<br/>比 Freeze 大"]
  S1 --> C1["C：$E[p(1 - p)]$<br/>$\approx 0.24 - 0.2^2 = 0.20$<br/>$P_{\mathrm{in}} = 2 \times 0.20 / 64$<br/>$= 6.25\times10^{-3}\,\mathrm{LSB}^2$"]
  C1 --> C2["頻帶內：<br/>$0.125 \times \sqrt{P_{\mathrm{in}}}$<br/>$= 0.00988\,\mathrm{fs}$"]
  S1 --> D1["D：$P_{\mathrm{in}}$<br/>$\approx 2.193 \times (1/64)^3$<br/>$= 8.37\times10^{-6}\,\mathrm{LSB}^2$"]
  D1 --> D2["頻帶內：<br/>$0.125 \times \sqrt{P_{\mathrm{in}}}$<br/>$= 3.62\times10^{-4}\,\mathrm{fs}$"]${STYLE}
  class A2,S2 focus
  class C2,D2 ok`

/**
 * （原有）校正邏輯到 reference 端的 DTC 與 PLL 輸出的硬體路徑。
 * 架構照 docs/assumptions.md §2a：REF → DTC → PD → loop filter → VCO，回授是 VCO → divider → PD（LF → DIV → PD，
 * 回授路徑上只有 divider）；校正迴路的輸入是 PD 的輸出 e_PD（comparator 取它的正負號，再經 GMAC 回到 LMS accumulator）。
 * 虛線與敘述順序的說明同 CHART_SIGNAL_FLOW。
 */
export const CHART_HARDWARE_MAP = String.raw`flowchart TB
  subgraph CAL["校正邏輯（code 更新率）"]
    LMS["LMS accumulator $w_H$<br/>（$B+F$ bit，$f_u$ domain）"] --> QS["量化策略<br/>$Q_B$ / toggle / PRBS / $\Delta\Sigma$ / dither"]
  end
  QS -- "6-bit code（CDC：同步 / handshake）" --> REG["DTC gain register<br/>（$f_s$ domain，ZOH $N_{\mathrm{upd}}$）"]
  REG --> DTC["DTC（reference 端）<br/>延遲 $= T_0 - \Delta_{\mathrm{LSB}} \cdot y \cdot x[n]$"]
  DSM["DSM residue $x[n]$"] --> DTC
  REF["Reference clock"] --> DTC
  DTC --> PD["Phase detector"]
  PD -- "$e_{\mathrm{PD}}[n]$：PD 的輸出" --> CMP["1-bit comparator → GMAC"]
  PD -- "$e_{\mathrm{PD}}[n]$" --> LF["Loop filter → VCO"]
  LF -- "VCO 輸出" --> DIV["Divider / PMUX<br/>（回授路徑上只有它）"]
  DIV --> PD
  DTC -. "$T(f)$：low-pass" .-> OUT["Output phase noise / spur"]
  CMP -- "$G_k$" --> LMS${STYLE}
  class QS focus`

export type DiagramKind = 'flowchart' | 'state'

export interface DiagramDef {
  /** 匯出的常數名稱（也用來在測試訊息裡指出是哪一張） */
  name: string
  chart: string
  kind: DiagramKind
  /** 所在的原始檔（相對於 src/chapters/ch13/） */
  file: string
  /** 是否為這次新增（false = 原本就有、只是搬到這個檔案） */
  added: boolean
}

/** 全章的 Mermaid 圖（依頁面上的出現順序）；章首另有一張全站共用的 <SystemMap>。 */
export const DIAGRAMS: DiagramDef[] = [
  { name: 'CHART_SIGNAL_FLOW', chart: CHART_SIGNAL_FLOW, kind: 'flowchart', file: 'sections/Intro.tsx', added: false },
  { name: 'CHART_ERROR_PATH', chart: CHART_ERROR_PATH, kind: 'flowchart', file: 'sections/Intro.tsx', added: true },
  { name: 'CHART_FREEZE', chart: CHART_FREEZE, kind: 'flowchart', file: 'sections/Freeze.tsx', added: true },
  { name: 'CHART_TOGGLE', chart: CHART_TOGGLE, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_TOGGLE_SPECTRUM', chart: CHART_TOGGLE_SPECTRUM, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_ZOH', chart: CHART_ZOH, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_STOCHASTIC', chart: CHART_STOCHASTIC, kind: 'flowchart', file: 'sections/Stochastic.tsx', added: true },
  { name: 'CHART_EFB_LOOP', chart: CHART_EFB_LOOP, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_LIMIT_CYCLE', chart: CHART_LIMIT_CYCLE, kind: 'state', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_NTF_PATHS', chart: CHART_NTF_PATHS, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_TELESCOPING', chart: CHART_TELESCOPING, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_PERIOD_FLOW', chart: CHART_PERIOD_FLOW, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_DITHER_LOOP', chart: CHART_DITHER_LOOP, kind: 'flowchart', file: 'sections/Dither.tsx', added: true },
  { name: 'CHART_FIVE_STRATEGIES', chart: CHART_FIVE_STRATEGIES, kind: 'flowchart', file: 'sections/CodeComparison.tsx', added: true },
  { name: 'CHART_POWER_SPLIT', chart: CHART_POWER_SPLIT, kind: 'flowchart', file: 'sections/CodeComparison.tsx', added: true },
  { name: 'CHART_LAB_PIPELINE', chart: CHART_LAB_PIPELINE, kind: 'flowchart', file: 'index.tsx', added: true },
  { name: 'CHART_TIME_VARYING', chart: CHART_TIME_VARYING, kind: 'flowchart', file: 'sections/TimeVarying.tsx', added: true },
  { name: 'CHART_INBAND', chart: CHART_INBAND, kind: 'flowchart', file: 'sections/TimeVarying.tsx', added: true },
  { name: 'CHART_MIXING_PATH', chart: CHART_MIXING_PATH, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_TONE_MIXING', chart: CHART_TONE_MIXING, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_RECORD_CHECK', chart: CHART_RECORD_CHECK, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_DECISION', chart: CHART_DECISION, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_SAT_WRAP', chart: CHART_SAT_WRAP, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_ANTIWINDUP', chart: CHART_ANTIWINDUP, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_CDC', chart: CHART_CDC, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_SYNTHESIS_FLOW', chart: CHART_SYNTHESIS_FLOW, kind: 'flowchart', file: 'sections/WrapUp.tsx', added: true },
  { name: 'CHART_HARDWARE_MAP', chart: CHART_HARDWARE_MAP, kind: 'flowchart', file: 'sections/WrapUp.tsx', added: false },
]

/** 章首系統地圖要標成藍色的方塊：gain accumulator → 有限位元量化 → gain correction（code × w）。 */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['acc', 'qnt', 'gc']
