/**
 * Ch04 的 Mermaid 方塊圖（docs/teaching-style.md §8）。diagrams.test.tsx 以真正的 mermaid 解析並實際渲染每一張，
 * 並逐一核對圖上的訊號名稱、正負號、延遲位置與本章公式（F-04.x）一致；圖上寫死的數字則與 gmac.ts / latency.ts 比對。
 *
 * 寫法約定：
 *  - 節點與連線標籤裡的數學一律寫 `$...$`（LaTeX，docs/teaching-style.md §3），由共用 Mermaid 元件以 KaTeX 排版，和正文同一套樣式；
 *    文字、單位（fs、bits、sample）照常寫。下標寫成 `w_k`、`w_{k+1}`，多字母下標用 `\mathrm{}`（`B_\mathrm{acc}`、`x_\mathrm{ref}`）。
 *  - 圖的原始碼用 String.raw 樣板字串，TeX 的反斜線只寫一次。樣板字串裡 `${` 是插值，所以公式不要以 `{` 開頭（`$\overline{x}$` 可以、`${\sim}x$` 不行）；
 *    標籤內不要用 `\\`（Mermaid 會收成一個反斜線），換行用 <br/>；含括號、冒號、等號、斜線的文字一律用雙引號包住；標籤內不放裸的「小於／大於」符號（範圍寫成區間，或用 `\ge`、`\le`）。
 *  - KaTeX 的文字模式沒有「①」「§」這些字元（會警告、量不到寬度），所以截斷點的圈圈數字用 TP1／TP2（`\textcircled`），章節符號寫 `$\S 5.4$`。
 *  - 加法點是圓形節點 (("＋"))，每條進入的線標 ＋ 或 −；乘法點是 (("$\times$"))；延遲寫 `$z^{-1}$`；積分器寫 `$1/(z-1)$`。
 *    負號寫在公式裡（`"$-w_k$"`）：KaTeX 的文字模式沒有 U+2212；整個標籤只有一個負號時才寫全形減號 `"−"`。
 *  - 注意：加號一律用全形「＋」（U+FF0B）當標籤的第一個字：Mermaid 11 會把每個標籤當 Markdown 解析，
 *    以 ASCII「+ 」「- 」「1. 」開頭的標籤會被當成清單，畫面上變成「Unsupported markdown: list」
 *    （parser 不會報錯，只有實際渲染才看得到——diagrams.test.tsx 有這項檢查）。含公式的標籤會被整個交給 KaTeX，不受這個限制。
 *    共用的 Mermaid 元件會先用 sanitizeMermaidSource 把這類標籤換掉當作保險，但本章的原始碼直接寫對，不依賴它。
 *    同理，一個純文字標籤裡不要出現成對的 * 或 _（會被當成斜體而吃掉符號）。
 *  - 版面：圖要完整放進正文欄（桌機約 890 px，不橫向捲動；寬於欄寬時整張圖會被縮小，字就變小），所以超過 4–5 級的串接一律畫成由上往下（TB），
 *    或拆成左右兩欄的 subgraph（subgraph 內 direction TB、圖本身 LR）；每個節點的文字超過約 200 px 會自動換行（含公式的標籤不會自動換行，要用 <br/> 自己斷，
 *    並盡量把每個節點斷成 3 行以內，圖才會窄）。單張不超過 14 個節點（subgraph 標題不算），放不下就拆成兩張。
 *    Mermaid 的限制：subgraph 內的節點只要連到 subgraph 外面，它自己的 direction 就失效，所以兩欄之間的連線畫在 subgraph 與 subgraph 之間。
 *  - subgraph 標題只寫文字、只有一行：共用主題把 cluster 標題縮成節點文字的 0.86 倍，含公式的標題（KaTeX 的每一層 span 又各縮一次）會小到看不見；
 *    需要的符號與範圍寫在框內的節點上（例如 LATENCY_TIMELINE 的 block k 涵蓋的 sample）。
 *  - 時序圖：Mermaid 的 sequenceDiagram 不支援標籤裡的公式（`$` 會原樣畫出來），所以 LATENCY_TIMELINE 改畫成 flowchart：
 *    箭頭依時間順序編號 (1)–(5)，左欄 (1)(2)、右欄 (4)(5)，(3) 在兩欄之間。
 *  - 取樣率：x[n]、e[n]、q[n] 是 sample rate（索引 n）；S_k、G_k、w_k、δ_k 是 block rate（索引 k，每 N 個 sample 一拍）。
 *  - 極性一律 δ = a − w（全站約定）；總和寫 S_k、平均寫 G_k = S_k / N（勘誤 E07 / E18）；q = 2b − 1（E07）；
 *    x、u 無因次，時間單位由 a、w、μ 承載（E13）；code 對齊延遲用 D、更新延遲用 d（E34）。
 *  - 顏色（深淺主題都看得清楚）：focus = 這張圖的主角、ok = 正確做法、warn = 會出錯的地方。
 */

const CLASSES = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** 圈圈數字「截斷點 ①②」：KaTeX 文字模式沒有 U+2460，改用 \textcircled（文字放進 \text{} 才合法）。 */
export const TP1 = String.raw`$\text{\textcircled{1}}$`
export const TP2 = String.raw`$\text{\textcircled{2}}$`

// ───────────────────────────────────────────────────────────────────────────
// §1 完整概念系統
// ───────────────────────────────────────────────────────────────────────────

/**
 * 規格 §4 的完整概念系統有 17 個方塊（和章首的系統地圖一樣多），一張圖放不下還要寫式子，所以依 §8「單張不超過約 14 個節點」拆成兩張：
 * 這一張是「快」的部分——主 PLL 迴路 + 小數除頻與 DTC 補償，每個 reference cycle 動一次；LMS 校正迴路收成一個藍色方塊，
 * 只留下它和快迴路之間的三條線（進去：PD 輸出、code x[n]；出來：gain w_k）。
 */
export const CONCEPT_FAST_LOOP = String.raw`flowchart TB
  FCW["FCW $= N_\mathrm{int} + \mathrm{frac}$"] --> DSM["Delta-Sigma modulator<br/>累加器 $s[n]$"]
  subgraph PLLLOOP["主 PLL 迴路（每拍）"]
    REF["Reference clock $f_\mathrm{ref}$"] --> PD["Phase detector / BBPD"]
    PD --> PLLF["PLL loop filter"]
    PLLF --> VCO["VCO / DCO"]
    VCO --> DIV["Multi-modulus divider"]
    DIVCTL["Divider control<br/>$N_\mathrm{int} + y[n]$"] --> DIV
    DIV --> DTC["DTC 的 delay =<br/>$w_k\,x[n] + \mathrm{INL}\,d(x)$"]
    DTC --> PD
  end
  DSM -- "carry $y[n]$" --> DIVCTL
  DSM -- "residue $s[n] / M$" --> RES["Fractional residue<br/>code $x[n]$（無因次）"]
  RES --> GC["Gain code correction<br/>$w_k\,x[n]$"]
  GC --> DTC
  PD -. "PD 輸出（fs）" .-> LMS["LMS 校正迴路<br/>每 $N$ 拍更新一次 $w_k$<br/>（下一張圖展開）"]
  RES -- "code $x[n]$" --> LMS
  LMS -- "gain $w_k$" --> GC
${CLASSES}
  class LMS focus`

/**
 * 規格 §4 概念系統的「慢」的部分：LMS 校正迴路（把上一張圖的藍色方塊展開；修正標籤、含 noise 注入與 DTC 非線性）。
 * comparator 的輸入 e[n] = PD 輸出 + 雜訊 v[n]（§3 的定義：e 已經含雜訊），所以雜訊畫成 comparator 前的加法點。
 */
export const CONCEPT_LMS_LOOP = String.raw`flowchart TB
  PD["Phase detector / BBPD<br/>（和上一張圖同一個）"]
  RES["Fractional residue<br/>code $x[n]$（無因次）"]
  subgraph LMSLOOP["LMS 校正迴路（每個 block 更新一次）"]
    NOISE["comparator 前雜訊 $v[n]$<br/>RMS $\sigma_v$"] -- "＋ $v[n]$" --> SUM(("＋"))
    SUM -- "$e[n]$（fs）" --> CMP["1-bit comparator<br/>$b[n] = 1$ 若 $e[n] \ge 0$<br/>$q[n] = 2b[n] - 1$"]
    ALIGN["Code alignment<br/>$x[n-D]$ 或 filtered-x<br/>$u_f[n-D]$"] -- "$x_\mathrm{ref}[n]$" --> GMAC["GMAC<br/>$S_k = \sum q[n]\,x_\mathrm{ref}[n]$"]
    CMP -- "$q[n]$" --> GMAC
    GMAC -- "$S_k$" --> SCALE["Normalize $G_k = S_k / N$<br/>step $\mu$"]
    SCALE -- "$\mu\,G_k$" --> ACC["Gain accumulator<br/>$w_{k+1} = w_k + \mu\,G_k$"]
  end
  PD -. "＋ PD 輸出（fs）" .-> SUM
  RES --> ALIGN
  RES --> GC["Gain code correction<br/>$w_k\,x[n]$"]
  ACC -- "$w_k$" --> GC
  GC --> DTC["DTC 的 delay =<br/>$w_k\,x[n] + \mathrm{INL}\,d(x)$"]
  DTC -. "edge 送回 PD<br/>迴路閉合" .-> PD
${CLASSES}
  class GMAC,SCALE,ACC focus`

// ───────────────────────────────────────────────────────────────────────────
// §2 Fractional residue
// ───────────────────────────────────────────────────────────────────────────

/** 一階累加器 residue generator：加法器 + 暫存器；carry → divider、餘數 → DTC code（F-04.1）。 */
export const RESIDUE_ACCUMULATOR = String.raw`flowchart TB
  KF["FCW 小數字 $K_\mathrm{F}$<br/>$\mathrm{frac} = K_\mathrm{F} / M$"] -- "＋" --> ADD(("＋"))
  REG["$z^{-1}$ 暫存器<br/>$B_\mathrm{dsm}$ bits<br/>$M = 2^{B_\mathrm{dsm}}$"] -- "＋ $s[n-1]$" --> ADD
  ADD -- "$t[n] = s[n-1] + K_\mathrm{F}$" --> WRAP["溢位判斷（mod $M$）<br/>$t[n] \ge M$ 時 $y[n] = 1$<br/>否則 $y[n] = 0$<br/>$s[n] = t[n] - M\,y[n]$"]
  WRAP -- "餘數 $s[n]$<br/>存回暫存器" --> REG
  WRAP -- "carry $y[n]$" --> DIV["Divider<br/>這一拍除 $N_\mathrm{int} + y[n]$"]
  WRAP -- "餘數 $s[n]$" --> NORM["$\div M$<br/>$x[n] = s[n] / M$"]
  DIV -- "edge 早到<br/>$s[n]/M$ 個 $T_\mathrm{vco}$<br/>$r[n] = -s[n]/M$" --> DTC["DTC：插入延遲<br/>$\tau_\mathrm{DTC}[n] = x[n]\,T_\mathrm{vco}$"]
  NORM -- "code $x[n] \in [0, 1)$" --> DTC
  DTC -- "補償後的 edge" --> PD["PD"]
${CLASSES}
  class ADD,WRAP,REG focus`

/** DTC gain 誤差的數學模型：需要 a·x、實際補 w·x，PD 只看到 (a − w)·x（F-04.2）。 */
export const GAIN_ERROR_MODEL = String.raw`flowchart TB
  X["code $x[n] = s[n] / M$<br/>已知，無因次"] --> A["$\times a$<br/>真正需要的 gain<br/>類比、未知"]
  X --> W["$\times w$<br/>DTC 目前用的 gain<br/>數位、可調"]
  A -- "＋ $a\,x[n]$<br/>edge 早到的時間" --> SUB(("＋"))
  W -- "$-w\,x[n]$<br/>DTC 補回的延遲" --> SUB
  SUB -- "$e_\mathrm{det}[n] = (a - w)\,x[n]$<br/>$= \delta\,x[n]$" --> PD["PD / comparator<br/>只看得到這個殘差"]
${CLASSES}
  class W focus`

// ───────────────────────────────────────────────────────────────────────────
// §3 硬體對應、RTL 資料流與時序
// ───────────────────────────────────────────────────────────────────────────

/**
 * 規格 §4.2 的 RTL 級資料流（補上 clear、位元數、commit）；左欄每個 sample 動一次，右欄每個 block 動一次。
 * `X ~~~ Q` 是看不見的連線：把兩個輸入上下錯開，左欄才不會是兩個方塊並排的寬度（圖自然寬度約 880 px，剛好放進正文欄、不必縮小）。
 */
export const RTL_DATAFLOW = String.raw`flowchart LR
  subgraph FAST["sample rate（每個 sample 一次）"]
    direction TB
    X["對齊後的<br/>有號 code<br/>$x_\mathrm{ref}[n]$，$B_x$ bits"] --> NEG["條件取負<br/>$b = 1$：$x$ 原樣<br/>$b = 0$：$\overline{x} + 1$"]
    Q["comparator<br/>bit $b[n]$<br/>$q = 2b - 1$"] --> NEG
    X ~~~ Q
    NEG --> SUM["GMAC 累加器 $S$<br/>$B_\mathrm{acc}$ bits，$B_\mathrm{acc} =$<br/>$1 + \lceil \log_2 (N M_x + 1) \rceil$"]
    CLR["block 邊界：<br/>每 $N$ 個 sample<br/>清除 $S$"] -.-> SUM
  end
  subgraph SLOW["block rate（每個 block 一次）"]
    direction TB
    AVG["normalize：算術右移<br/>$\log_2 N - F_G$ bits<br/>並做 rounding"] --> STEP["step size $\mu$<br/>shift 或乘法"]
    STEP --> ADD["加進高解析累加器 $W$"]
    ADD --> SAT["saturation /<br/>anti-windup"]
    SAT --> W["校正 gain register $w_k$"]
    W --> APPLY["實體 DTC code 映射<br/>commit（$P_c$ 個 sample）後<br/>block $k+1+d$ 才套用"]
  end
  FAST -- "總和 $S_k$<br/>每 $N$ 個<br/>sample 一次" --> SLOW`

/** 系統圖 C：雜訊／回授等效模型（含 H_PD）。上半段是 sample rate，「(1/N)·Σ」以下是 block rate。 */
export const NOISE_FEEDBACK = String.raw`flowchart TB
  A["真實 gain $a$"] -- "＋" --> SUB(("＋"))
  SUB -- "$\delta_k = a - w_k$" --> MUL(("$\times$"))
  XC["code $x[n]$"] --> MUL
  MUL -- "$\delta_k\,x[n]$（fs）" --> HPD["$H_\mathrm{PD}(z)$<br/>PLL 誤差路徑"]
  HPD -- "＋ $\delta_k\,u[n]$" --> ADDN(("＋"))
  VN["雜訊 $v[n]$"] -- "＋" --> ADDN
  BOFF["comparator offset<br/>$b_\mathrm{off}$"] -- "＋" --> ADDN
  ADDN -- "$e[n]$" --> SGN["sign<br/>$q[n] = \pm 1$"]
  SGN -- "$q[n]$" --> CORR(("$\times$"))
  XREF["$x_\mathrm{ref}[n]$（對齊後）"] --> CORR
  CORR --> AVGB["$(1/N)\sum$<br/>block $k$ 的平均"]
  AVGB -- "$G_k$" --> MUN["$\times \mu$"]
  MUN --> INTG["$1/(z-1)$<br/>gain accumulator<br/>$w_{k+1} = w_k + \mu\,G_k$"]
  INTG -- "$-w_k$<br/>再晚 $d$ 個 block 生效" --> SUB`

/**
 * Clock domain / latency 時序（sample n、block k、commit、apply）。
 * 原本是 sequenceDiagram，但 Mermaid 的時序圖不支援標籤裡的公式，所以改畫成 flowchart：
 * 六個參與者是六個方塊，五個箭頭依時間順序編號 (1)–(5)。
 * 由左往右分成兩欄、每欄由上往下（時間先走完左欄，再經過中間的 (3) 到右欄）：左欄是「一個 block 內、每個 sample 一次」的 (1)(2)，
 * 右欄是「block 結束之後、每個 block 一次」的 (4)(5)；(3) 是兩欄之間的箭頭。
 * （Mermaid 的限制：subgraph 內的節點只要連到 subgraph 外面，它自己的 direction 就失效，所以兩欄之間的箭頭畫在 subgraph 與 subgraph 之間。）
 * subgraph 標題只寫文字（含公式的標題會被縮得看不見）；block k 涵蓋的 sample 範圍寫在 GMAC 方塊上。
 */
export const LATENCY_TIMELINE = String.raw`flowchart LR
  subgraph BLK["一個 block 之內：每個 sample 一次"]
    direction TB
    S["Sample clock $f_s$"] -- "(1) sample $n$<br/>code $x[n-D]$ 已對齊" --> C["Comparator"]
    C -- "(2) $b[n]$<br/>累加 $S \leftarrow S + q\,x_\mathrm{ref}$" --> G["GMAC（block $k$）<br/>sample $n = kN \ldots kN+N-1$"]
  end
  subgraph NEXT["block 結束之後：每個 block 一次"]
    direction TB
    U["Update logic"] -- "(4) commit<br/>$w_{k+1} = w_k + \mu\,G_k$<br/>（pipeline $P_c$ 個 sample）" --> R["Gain register"]
    R -- "(5) 在 block $k+1+d$<br/>的開頭 apply" --> D["DTC control"]
    D -.-> NOTE["PD 要到 block $k+1+d$<br/>才看到新的 gain"]
  end
  BLK -- "(3) sample $kN+N-1$ 之後，<br/>總和 $S_k$ 完成<br/>交出 $S_k$，然後清除 $S$<br/>（給 block $k+1$）" --> NEXT`

/** 一階平均模型的迴路（block rate）：δ → ×K → ×μ → z^(−d) → 1/(z−1) → w（F-04.14）。 */
export const AVERAGE_LOOP = String.raw`flowchart TB
  A["真實 gain $a$"] -- "＋" --> SUB(("＋"))
  SUB -- "$\delta_k = a - w_k$" --> K["$\times K = K_q C$<br/>comparator 與相關<br/>的平均斜率，$\mathrm{fs}^{-1}$"]
  K -- "$E[G_k] \approx K\,\delta_k$" --> MU["$\times \mu$<br/>學習率，fs"]
  MU -- "$\mu\,G_k$" --> DLY["$z^{-d}$<br/>更新延遲 $d$ 個 block"]
  DLY --> INT["$1/(z-1)$<br/>gain accumulator"]
  INT -- "$-w_k$" --> SUB
${CLASSES}
  class DLY focus`

/** 新 gain 何時生效的三種做法：等 block 邊界（整數延遲）／立即生效（分數延遲，F-04.17）／丟掉前 P_c 個 sample。 */
export const APPLY_MODES = String.raw`flowchart TB
  FIN["block $k$ 結束：$S_k$ 完成<br/>新 gain 還要 $P_c$ 個<br/>sample 才寫進 register<br/>（$P_c$ 小於 $N$）"]
  FIN --> A1["做法 A：等 block 邊界<br/>block $k+1$ 仍用舊 gain<br/>block $k+2$ 才用新 gain"]
  FIN --> B1["做法 B：ready 就生效<br/>block $k+1$ 的前 $P_c$ 個<br/>sample 用舊 gain<br/>其餘的用新 gain"]
  FIN --> C1["做法 C：每個 block<br/>丟掉開頭 $P_c$ 個 sample<br/>等新 gain 生效才累加"]
  A1 --> A2["整數延遲<br/>$d = \lceil P_c / N \rceil = 1$<br/>$\delta_{k+1} = \delta_k - g\,\delta_{k-1}$<br/>$g_\mathrm{crit} = 2\sin(\pi/6) = 1$"]
  B1 --> B2["分數延遲 $d_f = P_c / N$<br/>$G_{k+1} \approx K\,[d_f\,\delta_k +$<br/>$(1 - d_f)\,\delta_{k+1}]$<br/>$g_\mathrm{crit}$ 見 F-04.17"]
  C1 --> C2["延遲 $d = 0$<br/>$\delta_{k+1} = (1 - g)\,\delta_k$<br/>$g_\mathrm{crit} = 2$<br/>雜訊 $\times \sqrt{N/(N - P_c)}$"]
${CLASSES}
  class A1,A2 focus
  class B1,B2 warn`

// ───────────────────────────────────────────────────────────────────────────
// §4 GMAC 的數學
// ───────────────────────────────────────────────────────────────────────────

/** GMAC 在估計什麼：左欄是實際訊號（sample rate），右欄是取期望值後的小訊號等效（F-04.4）。 */
export const GMAC_MEAN_MODEL = String.raw`flowchart LR
  subgraph REAL["實際訊號（sample rate）"]
    direction TB
    D1["$\delta_k = a - w_k$<br/>block $k$ 內固定"] --> M1["$\times u[n]$<br/>有效 regressor"]
    M1 -- "＋ $\delta_k\,u[n]$" --> S1(("＋"))
    V1["雜訊 $v[n]$<br/>RMS $\sigma_v$"] -- "＋" --> S1
    S1 -- "$e[n]$" --> SG["sign<br/>$q[n] = \pm 1$"]
    SG -- "$q[n]$" --> M2["$\times x_\mathrm{ref}[n]$<br/>對齊後的 code"]
    M2 --> AV["$(1/N)\sum$<br/>一個 block 的平均"]
    AV --> G1["$G_k$"]
  end
  subgraph MEAN["平均後的等效（小訊號）"]
    direction TB
    D2["$\delta_k$"] --> KQ["$\times K_q = \sqrt{2/\pi}/\sigma_v$<br/>sign 與雜訊的<br/>平均斜率，$\mathrm{fs}^{-1}$"]
    KQ --> CC["$\times C = E[x_\mathrm{ref}\,u]$<br/>兩個乘法與平均<br/>無因次"]
    CC --> G2["$E[G_k] \approx K_q C\,\delta_k$<br/>$= K\,\delta_k$"]
  end
  REAL -- "$E[\cdot]$<br/>對雜訊取平均" --> MEAN
${CLASSES}
  class KQ,CC focus`

/** Sum vs average 的 scaling 路徑：少了「÷N」的右移，同一個 μ 的 loop gain 放大 N 倍（F-04.5）。 */
export const SUM_VS_AVERAGE = String.raw`flowchart TB
  S["GMAC 累加器<br/>$S_k = \sum q[n]\,x_\mathrm{ref}[n]$<br/>大小隨 $N$ 成長"]
  S -- "$S_k$" --> SH["$\div N$<br/>右移 $\log_2 N$ bits"]
  SH -- "$G_k = S_k / N$" --> MA["$\times \mu$"]
  MA -- "$\Delta w = \mu\,G_k$" --> RA["average<br/>$g = \mu K$<br/>穩定：$\mu \in (0, 2/K)$"]
  S -- "$S_k$（少了右移）" --> MS["$\times \mu$"]
  MS -- "$\Delta w = \mu\,S_k = N \mu\,G_k$" --> RS["sum<br/>$g = N \mu K$<br/>穩定：$\mu \in (0, 2/(N K))$"]
  S -- "$S_k$" --> MC["$\times \mu/N$<br/>把 $\div N$ 併進 $\mu$"]
  MC -- "$\Delta w = (\mu/N)\,S_k = \mu\,G_k$" --> RC["和 average 逐位元相同<br/>$g = \mu K$"]
${CLASSES}
  class SH,RA ok
  class MS,RS warn`

/** 條件取負的 GMAC datapath（XOR + carry-in，一個加法器）與各級位元寬度（F-04.8）。 */
export const NEGATE_DATAPATH = String.raw`flowchart LR
  subgraph FAST["sample rate（每個 sample 一次）"]
    direction TB
    X["對齊後的 code<br/>$x_\mathrm{int}[n]$<br/>二補數 $B_x$ bits"] --> SE["符號延伸<br/>$B_x \to B_\mathrm{acc}$ bits"]
    B["comparator<br/>bit $b[n]$<br/>1 bit，$q = 2b - 1$"] --> CTL["$\mathrm{neg} = \mathrm{NOT}\,b$<br/>$b = 1$ 時 $\mathrm{neg} = 0$<br/>$b = 0$ 時 $\mathrm{neg} = 1$<br/>（$\mathrm{neg} = 1$ 即 $q = -1$）"]
    SE --> XOR["逐位元 XOR<br/>$\mathrm{neg} = 0$：$x$ 原樣<br/>$\mathrm{neg} = 1$：反相<br/>$\overline{x} = -x - 1$"]
    CTL -- "mask：$B_\mathrm{acc}$ 個 $\mathrm{neg}$" --> XOR
    XOR -- "＋ $x$ 或 $\overline{x}$" --> ADD(("＋"))
    CTL -- "＋ carry-in<br/>$c_\mathrm{in} = \mathrm{neg}$" --> ADD
    REG["GMAC 累加器 $S$<br/>$B_\mathrm{acc}$ bits 暫存器"] -- "＋ $S$<br/>（目前的累加值）" --> ADD
    ADD -- "$S + q\,x_\mathrm{int}$" --> REG
    CLR["block 邊界<br/>清除 $S$"] -.-> REG
  end
  subgraph SLOW["block rate（每個 block 一次）"]
    direction TB
    SH["右移 $\ell$ bits 並 rounding<br/>$\ell = \log_2 N - F_G$"] -- "$G_k$<br/>保留 $F_G$ 個小數位元" --> STEP["$\times \mu$<br/>shift 或乘法"]
    STEP -- "$\mu\,G_k$" --> W["gain register $W$<br/>$w_{k+1} = w_k + \mu\,G_k$"]
  end
  FAST -- "總和 $S_k$<br/>block 結束時" --> SLOW
${CLASSES}
  class SE,XOR,CTL focus`

/** 硬體 0/1 → ±1 的映射方塊，以及忘了映射的 bug 路徑（F-04.7）。 */
export const BIT_MAPPING = String.raw`flowchart TB
  E["PD 誤差 $e[n]$"] --> CMP["1-bit comparator<br/>$e[n] \ge 0$ 時 $b[n] = 1$<br/>否則 $b[n] = 0$"]
  CMP -- "$b[n] \in \{0, 1\}$" --> MAP["映射 $q = 2b - 1$<br/>$0 \to -1$，$1 \to +1$"]
  MAP -- "$q[n] \in \{-1, +1\}$" --> G1["GMAC<br/>$G = (1/N)\sum q[n]\,x_\mathrm{ref}[n]$"]
  G1 --> R1["$E[G] \approx K\,\delta$<br/>固定點 $w^* = a$"]
  CMP -- "$b[n]$ 直接當成 $q$<br/>（忘了映射）" --> G2["GMAC（bug）<br/>$G_\mathrm{bug} =$<br/>$(1/N)\sum b[n]\,x_\mathrm{ref}[n]$"]
  G2 --> R2["$G_\mathrm{bug} = \tfrac12 G + \tfrac12 \bar x_\mathrm{ref}$<br/>增益減半<br/>再加上 code 的平均"]
  R2 --> R3["固定點 $w^* \approx$<br/>$a + E[x_\mathrm{ref}] / (K_q C)$"]
${CLASSES}
  class MAP,G1,R1 ok
  class G2,R2,R3 warn`

// ───────────────────────────────────────────────────────────────────────────
// §5 定點 GMAC
// ───────────────────────────────────────────────────────────────────────────

/** §5 的地圖：定點 datapath 上每一級的位元寬度、兩個截斷點，以及 §5.1–§5.6 各在講哪一格。 */
export const FIXED_DATAPATH = String.raw`flowchart LR
  subgraph GM["GMAC：一個 block 的平均"]
    direction TB
    P["條件取負 $q\,x_\mathrm{int}$<br/>$B_x + 1$ bits（$\S 5.4$）"] --> ACC["GMAC 累加器 $S$<br/>$B_\mathrm{acc}$ bits（$\S 5.1$）"]
    ACC -- "$S_k$，整數" --> SH["截斷點 ${TP1}：右移<br/>$\ell = \log_2 N - F_G$ bits<br/>平均誤差 $\bar\varepsilon$<br/>（$\S 5.2$、$\S 5.3$）"]
  end
  subgraph UP["更新 gain accumulator"]
    direction TB
    MU["$\times \mu$"] -- "$\mu\,Q(G_k)$<br/>格點間距 $\mu\,\Delta_G$" --> QW["截斷點 ${TP2}：對齊<br/>$W$ 的 LSB $\Delta_W$<br/>平均誤差 $\bar\varepsilon_W$<br/>（$\S 5.6$）"]
    QW -- "＋ $\Delta W$" --> ADD(("＋"))
    W["高解析 gain<br/>accumulator $W$<br/>LSB $= \Delta_W$"] -- "＋ $W_k$" --> ADD
    ADD --> SAT["飽和 / anti-windup<br/>$[w_\mathrm{min}, w_\mathrm{max}]$<br/>（$\S 5.5$）"]
    SAT -- "$W_{k+1}$" --> W
    W -- "$w_k$" --> DTC["DTC gain<br/>實體 code"]
  end
  GM -- "$Q(G_k)$<br/>LSB $= \Delta_G$" --> UP
${CLASSES}
  class SH,QW warn`

/** 累加器位元數（F-04.9）的最壞情況，以及少 1 bit 時 wrap 與 saturate 的差別（6-bit code、N = 4096 的數字）。 */
export const ACCUMULATOR_SIZING = String.raw`flowchart TB
  A["單筆乘積 $|q\,x_\mathrm{int}| \le M_x$<br/>6-bit 對稱 code<br/>$M_x = 31$"] --> B["開機時 $N$ 筆同號相加<br/>$|S_k| \le N M_x$<br/>$= 4096 \times 31 = 126976$"]
  B --> C["需要<br/>$2^{B_\mathrm{acc}-1} - 1 \ge N M_x$<br/>$B_\mathrm{acc} = 1 +$<br/>$\lceil \log_2 (N M_x + 1) \rceil$<br/>$= 18$ bits"]
  B --> D{"只給 17 bits<br/>上限 $2^{16} - 1$<br/>$= 65535$"}
  D -- "wrap" --> E["$126976 - 2^{17} = -4096$<br/>變號：更新方向相反"]
  D -- "saturate" --> F["停在 $+65535$<br/>方向正確，只是變慢"]
${CLASSES}
  class C ok
  class E warn`

/**
 * 「÷N 就是右移」的位元切法（§5.2）：累加器 S_k 的低 ℓ bits 被丟掉（餘數 ρ），高 B_x + F_G bits 留下成為 Q(G_k)，
 * 它的 LSB 就是 Δ_G。例子的數字（B_x = 6、N = 1024、F_G = 4）與 §5.3 的偏差表、gmac.ts 的 accumulatorSizing 相同。
 */
export const SHIFT_BITS = String.raw`flowchart TB
  S["GMAC 累加器 $S_k$<br/>$B_\mathrm{acc} = B_x + \log_2 N$ bits<br/>（對稱 code、$N = 2^m$）<br/>例：$6 + 10 = 16$ bits"]
  S --> HI["高位元：留下<br/>$B_\mathrm{acc} - \ell$<br/>$= B_x + F_G$ bits<br/>例：10 bits"]
  S --> LO["低位元：丟掉<br/>$\ell = \log_2 N - F_G$ bits<br/>就是餘數 $\rho$<br/>例：$\ell = 6$"]
  LO --> RND["rounding 模式<br/>決定 $\rho$ 要不要<br/>向上進 1"]
  HI --> Q["$Q(G_k)$<br/>整數 $B_x$ bits<br/>$+$ 小數 $F_G$ bits"]
  RND -- "進位 0 或 1" --> Q
  Q --> DG["最小刻度 LSB<br/>$\Delta_G = 2^{-F_G}$<br/>$\div 2^{B_x-1}$<br/>例：$1/512$"]
${CLASSES}
  class LO,RND warn
  class HI,Q ok`

/**
 * 右移 ℓ bits 時四種取整模式的比較（F-04.10）：S 拆成留下的 j 與丟掉的餘數 ρ，差別只在餘數怎麼處理。
 * 例子的數字（S = −300、ℓ = 8）與 HC-04.7 的引言相同；diagrams.test.tsx 以 gmac.ts 的 shiftRound / roundingMeanError 驗算。
 */
export const ROUNDING_MODES = String.raw`flowchart TB
  S["GMAC 總和 $S_k$（整數）<br/>例：$S = -300$，$\ell = 8$<br/>$S / 2^\ell = -1.17$"] --> SPLIT["右移 $\ell$ bits：拆成兩段<br/>$S = 2^\ell\,j + \rho$<br/>$j$：留下的高位元<br/>$\rho$：丟掉的低 $\ell$ bits<br/>例：$j = -2$，$\rho = 212$"]
  SPLIT --> FL["floor（直接右移）<br/>$Q = j$<br/>例：$-2$"]
  SPLIT --> HU["half-up<br/>$\rho \ge 2^{\ell-1}$ 時<br/>$Q = j + 1$<br/>否則 $Q = j$<br/>例：$212 \ge 128$，得 $-1$"]
  SPLIT --> HE["half-even<br/>同 half-up；$\rho$ 恰好<br/>一半時取偶數<br/>例：$-1$"]
  SPLIT --> TZ["toward-0<br/>$S$ 為負且 $\rho \ne 0$ 時<br/>$Q = j + 1$<br/>否則 $Q = j$<br/>例：$-1$"]
  FL --> EF["平均誤差 $\bar\varepsilon =$<br/>$-(1 - 2^{-\ell}) / 2$<br/>約 $-\tfrac12$ 個 LSB"]
  HU --> EH["$\bar\varepsilon = 2^{-\ell-1}$<br/>很小的正偏差"]
  HE --> EE["$\bar\varepsilon = 0$"]
  TZ --> ET["$S$ 為正：$\bar\varepsilon$ 同 floor<br/>$S$ 為負：正負號相反<br/>0 附近是 dead zone"]
${CLASSES}
  class FL,EF warn
  class HE,EE ok`

/** 兩個截斷點的平均誤差像兩個 DC offset 注入平均迴路：固定點在「積分器輸入平均為 0」（F-04.11、F-04.18）。 */
export const BIAS_LOOP = String.raw`flowchart TB
  A["真實 gain $a$"] -- "＋" --> SUB(("＋"))
  SUB -- "$\delta = a - w$" --> K["$\times K$<br/>GMAC 的平均斜率<br/>$\mathrm{fs}^{-1}$"]
  K -- "＋ $K\,\delta$" --> S1(("＋"))
  E1["截斷點 ${TP1}<br/>$\div N$ 的右移<br/>平均誤差 $\bar\varepsilon\,\Delta_G$"] -- "＋" --> S1
  S1 -- "$E[Q(G)]$" --> MU["$\times \mu$"]
  MU -- "＋" --> S2(("＋"))
  E2["截斷點 ${TP2}<br/>對齊 $\Delta_W$<br/>平均誤差 $\bar\varepsilon_W\,\Delta_W$"] -- "＋" --> S2
  S2 -- "$E[\Delta W]$<br/>固定點時為 0" --> INT["$1/(z-1)$<br/>gain accumulator $W$"]
  INT -- "$-w$" --> SUB
${CLASSES}
  class E1,E2 warn`

/**
 * 最負 code 的取負 bug（F-04.15）：x_int = −2^(B_x−1) 且 b = 0（q = −1）時應加 +2^(B_x−1)，在 B_x bits 內取負會 wrap 回 −2^(B_x−1)，
 * 每次差 2^(B_x) LSB（正規化後 −2）；發生的機率 p_min·Φ(δ/σ_v)，平均起來是注入截斷點 ① 加法點的一個負 DC offset。
 * 例子是 6-bit：−32 取負應為 +32；diagrams.test.tsx 以 gmac.ts 的 negateExtended / negateInplace 驗算。
 */
export const NEGATE_BUG = String.raw`flowchart TB
  X["最負 code<br/>$x_\mathrm{int} = -2^{B_x-1}$<br/>例：6-bit 的 $-32$<br/>出現機率 $p_\mathrm{min} = 1/64$"] --> Q["comparator $b = 0$（$q = -1$）<br/>機率 $\Phi(\delta/\sigma_v)$<br/>此時要加的是 $-x_\mathrm{int} = +32$"]
  Q --> OK["先延伸到 $B_x + 1$ bits<br/>再取負：$+32$ 放得下"]
  Q --> BUG["在 $B_x$ bits 內取負<br/>結果 $+32$ 超出 6-bit 範圍<br/>wrap 回 $-32$"]
  OK --> OKR["加進累加器的是 $+32$<br/>（正確）"]
  BUG --> ERR["加進累加器的是 $-32$<br/>每次差 $-64$ LSB<br/>$=$ 正規化 $-2$"]
  ERR --> INJ["平均誤差 $-2\,p_\mathrm{min}\,\Phi(\delta/\sigma_v)$<br/>像一個負的 DC offset<br/>注入截斷點 ${TP1} 的加法點"]
  INJ --> FIX["固定點：<br/>$K\,\delta^* + \bar\varepsilon\,\Delta_G$<br/>$- 2\,p_\mathrm{min}\,\Phi(\delta^*/\sigma_v) = 0$<br/>$w^* - a \approx -p_\mathrm{min} / K$"]
${CLASSES}
  class OK,OKR ok
  class BUG,ERR,INJ warn
  class FIX focus`

/** Gain accumulator 超出範圍時的三種處理：anti-windup／只 clamp 輸出（windup）／wrap（F-04.12）。 */
export const ANTI_WINDUP = String.raw`flowchart TB
  DW["更新量 $\Delta W \approx \mu\,G_k$"] -- "＋" --> ADD(("＋"))
  W["gain accumulator $W$<br/>$z^{-1}$，每個 block 一拍"] -- "＋ $W_k$" --> ADD
  ADD -- "$W_k + \Delta W$" --> MODE{"超出範圍時<br/>怎麼處理？"}
  MODE -- "anti-windup" --> AW["把 $W$ 本身夾在<br/>$[w_\mathrm{min}, w_\mathrm{max}]$<br/>$W_\mathrm{peak} = w_\mathrm{max}$<br/>$T_\mathrm{unwind} = 0$"]
  MODE -- "只 clamp 輸出" --> WU["$W$ 繼續往外積分<br/>（windup）<br/>$W_\mathrm{peak}$ 遠大於 $w_\mathrm{max}$"]
  MODE -- "wrap" --> WR["$W$ 跳到暫存器<br/>的另一端，gain 由<br/>$w_\mathrm{max}$ 跳到 $w_\mathrm{min}$"]
  AW -- "$W_{k+1}$" --> W
  WU -- "$W_{k+1}$" --> W
  WR -- "$W_{k+1}$" --> W
  W -- "$W_k$" --> CL["輸出 clamp<br/>$w_\mathrm{applied} = \min(w_\mathrm{max},$<br/>$\max(w_\mathrm{min}, W_k))$"]
  CL --> DTC["DTC gain trim"]
${CLASSES}
  class AW ok
  class WU,WR warn`

// ───────────────────────────────────────────────────────────────────────────
// §6 RTL 檢查清單
// ───────────────────────────────────────────────────────────────────────────

/** 忘了在 block 邊界清除 S：迴路多一個積分器，一階變二階、pole 落在單位圓上（F-04.13）。 */
export const CLEAR_BUG = String.raw`flowchart LR
  subgraph GOOD["正確：每個 block 清除累加器"]
    direction TB
    D1["$\delta_k$"] --> K1["$\times K$<br/>GMAC：$E[S_k] / N$<br/>$= K\,\delta_k$"]
    K1 --> MU1["$\times \mu$"]
    MU1 --> I1["$1/(z-1)$<br/>gain accumulator"]
    I1 --> W1["$w_k$<br/>$\delta_{k+1} = (1 - g)\,\delta_k$"]
  end
  subgraph BAD["忘了清除：多一個積分器"]
    direction TB
    D2["$\delta_k$"] --> K2["$\times K$"]
    K2 --> I0["$1/(1 - z^{-1})$<br/>沒清除的 $S$<br/>$S_0 + S_1 + \dots + S_k$"]
    I0 --> MU2["$\times \mu$"]
    MU2 --> I2["$1/(z-1)$<br/>gain accumulator"]
    I2 --> W2["$w_k$<br/>$\delta_{k+1} - (2 - g)\,\delta_k +$<br/>$\delta_{k-1} = 0$"]
  end
  GOOD -. "少了 clear" .-> BAD
${CLASSES}
  class I0,W2 warn
  class W1 ok`

// ───────────────────────────────────────────────────────────────────────────
// §7 綜合手算
// ───────────────────────────────────────────────────────────────────────────

/** 綜合手算 HC-04.8 的計算順序：增益 → 穩定 → 位元數 → 兩個截斷點 → 合計偏差。 */
export const HANDCALC_FLOW = String.raw`flowchart TB
  IN["七個輸入<br/>$\sigma_v$、$\mu$、$B_x$、$\log_2 N$<br/>$F_G$、$\ell_W$、$d$"]
  IN --> KQ["$K_q = \sqrt{2/\pi}/\sigma_v$"]
  IN --> EX["$M_x = 2^{B_x-1} - 1$<br/>$E[x^2] = M_x (M_x + 1)$<br/>$\div (3 \cdot 4^{B_x-1})$"]
  KQ --> K["$K = K_q\,E[x^2]$"]
  EX --> K
  K --> G["$g = \mu K$，$p = 1 - g$"]
  G --> GC["穩定檢查：$g$ 小於<br/>$g_\mathrm{crit} = 2\sin(\pi/(4d + 2))$"]
  IN --> BA["$B_\mathrm{acc} = B_x + \log_2 N$<br/>對稱 code、$N = 2^m$"]
  IN --> L["$\ell = \log_2 N - F_G$<br/>$\Delta_G = 2^{-F_G}$<br/>$\div 2^{B_x-1}$"]
  L --> B1["$\bar\varepsilon = -(1 - 2^{-\ell}) / 2$<br/>偏差 ${TP1} $= \bar\varepsilon\,\Delta_G / K$"]
  K --> B1
  L --> DW["$R = 2^{\ell_W}$<br/>$\Delta_W = R\,\mu\,\Delta_G$"]
  DW --> B2["$\bar\varepsilon_W = -(1 - 1/R) / 2$<br/>偏差 ${TP2} $= \bar\varepsilon_W\,\Delta_W / g$"]
  G --> B2
  B1 --> T["$w^* - a =$<br/>偏差 ${TP1} $+$ 偏差 ${TP2}"]
  B2 --> T
  IN -. "$\mu$" .-> G
  IN -. "$d$" .-> GC
  IN -. "$\mu$、$\ell_W$" .-> DW
${CLASSES}
  class K,G focus
  class T ok`

// ───────────────────────────────────────────────────────────────────────────
// 登錄表（頁面出現順序 = 圖號順序；diagrams.test.tsx 逐一解析）
// ───────────────────────────────────────────────────────────────────────────

export type Ch04DiagramType = 'flowchart-v2'

export interface Ch04Diagram {
  /** 匯出的常數名稱 */
  name: string
  chart: string
  /** mermaid.parse() 回傳的 diagramType */
  type: Ch04DiagramType
  /** 所在段落 */
  section: '§1' | '§2' | '§3' | '§4' | '§5' | '§6' | '§7'
  /** 這張圖對應的公式（沒有就省略） */
  formula?: string
}

/** 本章全部的 Mermaid 圖，依頁面出現的順序（章首的 SystemMap 另計，不在這個表內）。 */
export const CH04_DIAGRAMS: Ch04Diagram[] = [
  { name: 'CONCEPT_FAST_LOOP', chart: CONCEPT_FAST_LOOP, type: 'flowchart-v2', section: '§1' },
  { name: 'CONCEPT_LMS_LOOP', chart: CONCEPT_LMS_LOOP, type: 'flowchart-v2', section: '§1', formula: 'F-04.3' },
  { name: 'RESIDUE_ACCUMULATOR', chart: RESIDUE_ACCUMULATOR, type: 'flowchart-v2', section: '§2', formula: 'F-04.1' },
  { name: 'GAIN_ERROR_MODEL', chart: GAIN_ERROR_MODEL, type: 'flowchart-v2', section: '§2', formula: 'F-04.2' },
  { name: 'RTL_DATAFLOW', chart: RTL_DATAFLOW, type: 'flowchart-v2', section: '§3' },
  { name: 'NOISE_FEEDBACK', chart: NOISE_FEEDBACK, type: 'flowchart-v2', section: '§3' },
  { name: 'LATENCY_TIMELINE', chart: LATENCY_TIMELINE, type: 'flowchart-v2', section: '§3' },
  { name: 'AVERAGE_LOOP', chart: AVERAGE_LOOP, type: 'flowchart-v2', section: '§3', formula: 'F-04.14' },
  { name: 'APPLY_MODES', chart: APPLY_MODES, type: 'flowchart-v2', section: '§3', formula: 'F-04.17' },
  { name: 'GMAC_MEAN_MODEL', chart: GMAC_MEAN_MODEL, type: 'flowchart-v2', section: '§4', formula: 'F-04.4' },
  { name: 'SUM_VS_AVERAGE', chart: SUM_VS_AVERAGE, type: 'flowchart-v2', section: '§4', formula: 'F-04.5' },
  { name: 'NEGATE_DATAPATH', chart: NEGATE_DATAPATH, type: 'flowchart-v2', section: '§4', formula: 'F-04.8' },
  { name: 'BIT_MAPPING', chart: BIT_MAPPING, type: 'flowchart-v2', section: '§4', formula: 'F-04.7' },
  { name: 'FIXED_DATAPATH', chart: FIXED_DATAPATH, type: 'flowchart-v2', section: '§5' },
  { name: 'ACCUMULATOR_SIZING', chart: ACCUMULATOR_SIZING, type: 'flowchart-v2', section: '§5', formula: 'F-04.9' },
  { name: 'SHIFT_BITS', chart: SHIFT_BITS, type: 'flowchart-v2', section: '§5' },
  { name: 'ROUNDING_MODES', chart: ROUNDING_MODES, type: 'flowchart-v2', section: '§5', formula: 'F-04.10' },
  { name: 'BIAS_LOOP', chart: BIAS_LOOP, type: 'flowchart-v2', section: '§5', formula: 'F-04.11' },
  { name: 'NEGATE_BUG', chart: NEGATE_BUG, type: 'flowchart-v2', section: '§5', formula: 'F-04.15' },
  { name: 'ANTI_WINDUP', chart: ANTI_WINDUP, type: 'flowchart-v2', section: '§5', formula: 'F-04.12' },
  { name: 'CLEAR_BUG', chart: CLEAR_BUG, type: 'flowchart-v2', section: '§6', formula: 'F-04.13' },
  { name: 'HANDCALC_FLOW', chart: HANDCALC_FLOW, type: 'flowchart-v2', section: '§7', formula: 'F-04.18' },
]

/** 圖號（1 起算，依頁面順序）；不在登錄表內時丟錯，避免頁面上出現沒有經過 parser 測試的圖。 */
export function diagramNumber(chart: string): number {
  const i = CH04_DIAGRAMS.findIndex((d) => d.chart === chart)
  if (i < 0) throw new Error('Ch04：這張 Mermaid 圖沒有登錄在 CH04_DIAGRAMS')
  return i + 1
}
