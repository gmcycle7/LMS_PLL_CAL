/**
 * Ch04 的 Mermaid 方塊圖（docs/teaching-style.md §8）。diagrams.test.tsx 以真正的 mermaid 解析並實際渲染每一張，
 * 並逐一核對圖上的訊號名稱、正負號、延遲位置與本章公式（F-04.x）一致；圖上寫死的數字則與 gmac.ts / latency.ts 比對。
 *
 * 寫法約定：
 *  - Mermaid 不渲染 KaTeX，節點文字用 Unicode 數學符號（μ、δ、Σ、z⁻¹、≥ …）；下標寫成 w_k、w_{k+1}（和正文的 LaTeX 一樣讀）。
 *  - 含括號、冒號、等號、斜線的文字一律用雙引號包住；換行用 <br/>；標籤內不放裸的「小於／大於」符號（範圍寫成區間）。
 *  - 加法點是圓形節點 (("＋"))，每條進入的線標 ＋ 或 −；乘法點是 (("×"))；延遲寫 z⁻¹；積分器寫 1/(z−1)。
 *  - 注意：加號一律用全形「＋」（U+FF0B）當標籤的第一個字：Mermaid 11 會把每個標籤當 Markdown 解析，
 *    以 ASCII「+ 」「- 」「1. 」開頭的標籤會被當成清單，畫面上變成「Unsupported markdown: list」
 *    （parser 不會報錯，只有實際渲染才看得到——diagrams.test.tsx 有這項檢查）。減號用「−」（U+2212），不受影響。
 *    共用的 Mermaid 元件會先用 sanitizeMermaidSource 把這類標籤換掉當作保險，但本章的原始碼直接寫對，不依賴它。
 *    同理，一個標籤裡不要出現成對的 * 或 _（會被當成斜體而吃掉符號）。
 *  - 版面：Mermaid 會把圖縮到容器寬度（正文欄約 1000 px），所以超過 4–5 級的串接一律畫成由上往下（TB），
 *    或拆成左右兩欄的 subgraph；每個節點的文字超過約 200 px 會自動換行。單張不超過 14 個節點（subgraph 標題不算），放不下就拆成兩張。
 *  - 取樣率：x[n]、e[n]、q[n] 是 sample rate（索引 n）；S_k、G_k、w_k、δ_k 是 block rate（索引 k，每 N 個 sample 一拍）。
 *  - 極性一律 δ = a − w（全站約定）；總和寫 S_k、平均寫 G_k = S_k / N（勘誤 E07 / E18）；q = 2b − 1（E07）；
 *    x、u 無因次，時間單位由 a、w、μ 承載（E13）；code 對齊延遲用 D、更新延遲用 d（E34）。
 *  - 顏色（深淺主題都看得清楚）：focus = 這張圖的主角、ok = 正確做法、warn = 會出錯的地方。
 */

const CLASSES = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

// ───────────────────────────────────────────────────────────────────────────
// §1 完整概念系統
// ───────────────────────────────────────────────────────────────────────────

/**
 * 規格 §4 的完整概念系統有 17 個方塊（和章首的系統地圖一樣多），一張圖放不下還要寫式子，所以依 §8「單張不超過約 14 個節點」拆成兩張：
 * 這一張是「快」的部分——主 PLL 迴路 + 小數除頻與 DTC 補償，每個 reference cycle 動一次；LMS 校正迴路收成一個藍色方塊，
 * 只留下它和快迴路之間的三條線（進去：PD 輸出、code x[n]；出來：gain w_k）。
 */
export const CONCEPT_FAST_LOOP = `flowchart TB
  FCW["FCW = N_int + frac"] --> DSM["Delta-Sigma modulator<br/>累加器 s[n]"]
  subgraph PLLLOOP["主 PLL 迴路（每拍）"]
    REF["Reference clock f_ref"] --> PD["Phase detector / BBPD"]
    PD --> PLLF["PLL loop filter"]
    PLLF --> VCO["VCO / DCO"]
    VCO --> DIV["Multi-modulus divider"]
    DIVCTL["Divider control<br/>N_int + y[n]"] --> DIV
    DIV --> DTC["DTC 的 delay =<br/>w_k·x[n] + INL d(x)"]
    DTC --> PD
  end
  DSM -->|"carry y[n]"| DIVCTL
  DSM -->|"residue s[n] / M"| RES["Fractional residue<br/>code x[n]（無因次）"]
  RES --> GC["Gain code correction<br/>w_k·x[n]"]
  GC --> DTC
  PD -. "PD 輸出（fs）" .-> LMS["LMS 校正迴路<br/>每 N 拍更新一次 w_k<br/>（下一張圖展開）"]
  RES -- "code x[n]" --> LMS
  LMS -- "gain w_k" --> GC
${CLASSES}
  class LMS focus`

/**
 * 規格 §4 概念系統的「慢」的部分：LMS 校正迴路（把上一張圖的藍色方塊展開；修正標籤、含 noise 注入與 DTC 非線性）。
 * comparator 的輸入 e[n] = PD 輸出 + 雜訊 v[n]（§3 的定義：e 已經含雜訊），所以雜訊畫成 comparator 前的加法點。
 */
export const CONCEPT_LMS_LOOP = `flowchart TB
  PD["Phase detector / BBPD<br/>（和上一張圖同一個）"]
  RES["Fractional residue<br/>code x[n]（無因次）"]
  subgraph LMSLOOP["LMS 校正迴路（每 N 拍）"]
    NOISE["comparator 前雜訊 v[n]<br/>RMS σ_v"] -- "＋ v[n]" --> SUM(("＋"))
    SUM -- "e[n]（fs）" --> CMP["1-bit comparator<br/>b[n] = 1 若 e[n] ≥ 0<br/>q[n] = 2b[n] − 1"]
    ALIGN["Code alignment<br/>x[n−D] 或 filtered-x<br/>u_f[n−D]"] -->|"x_ref[n]"| GMAC["GMAC<br/>S_k = Σ q[n]·x_ref[n]"]
    CMP -- "q[n]" --> GMAC
    GMAC -- "S_k" --> SCALE["Normalize G_k = S_k / N<br/>step μ"]
    SCALE -- "μ·G_k" --> ACC["Gain accumulator<br/>w_{k+1} = w_k + μ·G_k"]
  end
  PD -. "＋ PD 輸出（fs）" .-> SUM
  RES --> ALIGN
  RES --> GC["Gain code correction<br/>w_k·x[n]"]
  ACC -- "w_k" --> GC
  GC --> DTC["DTC 的 delay =<br/>w_k·x[n] + INL d(x)"]
  DTC -. "edge 送回 PD<br/>迴路閉合" .-> PD
${CLASSES}
  class GMAC,SCALE,ACC focus`

// ───────────────────────────────────────────────────────────────────────────
// §2 Fractional residue
// ───────────────────────────────────────────────────────────────────────────

/** 一階累加器 residue generator：加法器 + 暫存器；carry → divider、餘數 → DTC code（F-04.1）。 */
export const RESIDUE_ACCUMULATOR = `flowchart TB
  KF["FCW 小數字 K_F<br/>frac = K_F / M"] -- "＋" --> ADD(("＋"))
  REG["z⁻¹ 暫存器<br/>B_dsm bits<br/>M = 2^B_dsm"] -- "＋ s[n−1]" --> ADD
  ADD -- "t[n] = s[n−1] + K_F" --> WRAP["溢位判斷（mod M）<br/>t[n] ≥ M 時 y[n] = 1<br/>否則 y[n] = 0<br/>s[n] = t[n] − M·y[n]"]
  WRAP -- "餘數 s[n]<br/>存回暫存器" --> REG
  WRAP -- "carry y[n]" --> DIV["Divider<br/>這一拍除 N_int + y[n]"]
  WRAP -- "餘數 s[n]" --> NORM["÷ M<br/>x[n] = s[n] / M"]
  DIV -- "edge 早到<br/>s[n]/M 個 T_vco<br/>r[n] = −s[n]/M" --> DTC["DTC：插入延遲<br/>τ_DTC[n] = x[n]·T_vco"]
  NORM -- "code x[n] ∈ [0, 1)" --> DTC
  DTC -- "補償後的 edge" --> PD["PD"]
${CLASSES}
  class ADD,WRAP,REG focus`

/** DTC gain 誤差的數學模型：需要 a·x、實際補 w·x，PD 只看到 (a − w)·x（F-04.2）。 */
export const GAIN_ERROR_MODEL = `flowchart TB
  X["code x[n] = s[n] / M<br/>已知，無因次"] --> A["× a<br/>真正需要的 gain<br/>類比、未知"]
  X --> W["× w<br/>DTC 目前用的 gain<br/>數位、可調"]
  A -- "＋ a·x[n]<br/>edge 早到的時間" --> SUB(("＋"))
  W -- "− w·x[n]<br/>DTC 補回的延遲" --> SUB
  SUB -- "e_det[n] = (a − w)·x[n]<br/>= δ·x[n]" --> PD["PD / comparator<br/>只看得到這個殘差"]
${CLASSES}
  class W focus`

// ───────────────────────────────────────────────────────────────────────────
// §3 硬體對應、RTL 資料流與時序
// ───────────────────────────────────────────────────────────────────────────

/** 規格 §4.2 的 RTL 級資料流（補上 clear、位元數、commit）；左欄每個 sample 動一次，右欄每個 block 動一次。 */
export const RTL_DATAFLOW = `flowchart LR
  subgraph FAST["sample rate（索引 n）"]
    direction TB
    X["對齊後的有號 code<br/>x_ref[n]，B_x bits"] --> NEG["條件取負<br/>b = 1：x 原樣<br/>b = 0：~x + 1"]
    Q["comparator bit b[n]<br/>q = 2b − 1"] --> NEG
    NEG --> SUM["GMAC 累加器 S<br/>B_acc bits，B_acc =<br/>1 + ⌈log₂(N·M_x + 1)⌉"]
    CLR["block 邊界：每 N 個<br/>sample 清除 S"] -.-> SUM
  end
  subgraph SLOW["block rate（索引 k）"]
    direction TB
    AVG["normalize：算術右移<br/>log₂N − F_G bits<br/>並做 rounding"] --> STEP["step size μ<br/>shift 或乘法"]
    STEP --> ADD["加進高解析累加器 W"]
    ADD --> SAT["saturation /<br/>anti-windup"]
    SAT --> W["校正 gain register w_k"]
    W --> APPLY["實體 DTC code 映射<br/>commit（P_c 個 sample）後<br/>block k+1+d 才套用"]
  end
  FAST -- "總和 S_k<br/>每 N 個 sample 一次" --> SLOW`

/** 系統圖 C：雜訊／回授等效模型（含 H_PD）。上半段是 sample rate，「(1/N)·Σ」以下是 block rate。 */
export const NOISE_FEEDBACK = `flowchart TB
  A["真實 gain a"] -- "＋" --> SUB(("＋"))
  SUB -- "δ_k = a − w_k" --> MUL(("×"))
  XC["code x[n]"] --> MUL
  MUL -- "δ_k·x[n]（fs）" --> HPD["H_PD(z)<br/>PLL 誤差路徑"]
  HPD -- "＋ δ_k·u[n]" --> ADDN(("＋"))
  VN["雜訊 v[n]"] -- "＋" --> ADDN
  BOFF["comparator offset<br/>b_off"] -- "＋" --> ADDN
  ADDN -- "e[n]" --> SGN["sign<br/>q[n] = ±1"]
  SGN -- "q[n]" --> CORR(("×"))
  XREF["x_ref[n]（對齊後）"] --> CORR
  CORR --> AVGB["(1/N)·Σ<br/>block k 的平均"]
  AVGB -- "G_k" --> MUN["× μ"]
  MUN --> INTG["1/(z−1)<br/>gain accumulator<br/>w_{k+1} = w_k + μ·G_k"]
  INTG -- "− w_k<br/>再晚 d 個 block 生效" --> SUB`

/** Clock domain / latency 時序（sample n、block k、commit、apply）。 */
export const LATENCY_TIMELINE = `sequenceDiagram
  participant S as Sample clock f_s
  participant C as Comparator
  participant G as GMAC（block k）
  participant U as Update logic
  participant R as Gain register
  participant D as DTC control
  Note over S,G: block k = sample n = kN … kN+N−1
  S->>C: sample n<br/>code x[n−D] 已對齊
  C->>G: b[n]<br/>累加 S ← S + q·x_ref
  Note over G: sample kN+N−1 之後<br/>總和 S_k 完成
  G->>U: S_k，然後清除 S<br/>（給 block k+1）
  U->>R: commit<br/>w_{k+1} = w_k + μ·G_k<br/>（pipeline P_c 個 sample）
  R->>D: 在 block k+1+d<br/>的開頭 apply
  Note over D: PD 要到 block k+1+d<br/>才看到新的 gain`

/** 一階平均模型的迴路（block rate）：δ → ×K → ×μ → z^(−d) → 1/(z−1) → w（F-04.14）。 */
export const AVERAGE_LOOP = `flowchart TB
  A["真實 gain a"] -- "＋" --> SUB(("＋"))
  SUB -- "δ_k = a − w_k" --> K["× K = K_q·C<br/>comparator 與相關<br/>的平均斜率，fs⁻¹"]
  K -- "E[G_k] ≈ K·δ_k" --> MU["× μ<br/>學習率，fs"]
  MU -- "μ·G_k" --> DLY["z^(−d)<br/>更新延遲 d 個 block"]
  DLY --> INT["1/(z−1)<br/>gain accumulator"]
  INT -- "− w_k" --> SUB
${CLASSES}
  class DLY focus`

/** 新 gain 何時生效的三種做法：等 block 邊界（整數延遲）／立即生效（分數延遲，F-04.17）／丟掉前 P_c 個 sample。 */
export const APPLY_MODES = `flowchart TB
  FIN["block k 結束：S_k 完成<br/>新 gain 還要 P_c 個<br/>sample 才寫進 register<br/>（P_c 小於 N）"]
  FIN --> A1["做法 A：等 block 邊界<br/>block k+1 仍用舊 gain<br/>block k+2 才用新 gain"]
  FIN --> B1["做法 B：ready 就生效<br/>block k+1 的前 P_c 個<br/>sample 用舊 gain<br/>其餘的用新 gain"]
  FIN --> C1["做法 C：每個 block<br/>丟掉開頭 P_c 個 sample<br/>等新 gain 生效才累加"]
  A1 --> A2["整數延遲<br/>d = ⌈P_c / N⌉ = 1<br/>δ_{k+1} = δ_k − g·δ_{k−1}<br/>g_crit = 2·sin(π/6) = 1"]
  B1 --> B2["分數延遲 d_f = P_c / N<br/>G_{k+1} ≈ K·[d_f·δ_k +<br/>(1 − d_f)·δ_{k+1}]<br/>g_crit 見 F-04.17"]
  C1 --> C2["延遲 d = 0<br/>δ_{k+1} = (1 − g)·δ_k<br/>g_crit = 2<br/>雜訊 × √(N/(N − P_c))"]
${CLASSES}
  class A1,A2 focus
  class B1,B2 warn`

// ───────────────────────────────────────────────────────────────────────────
// §4 GMAC 的數學
// ───────────────────────────────────────────────────────────────────────────

/** GMAC 在估計什麼：左欄是實際訊號（sample rate），右欄是取期望值後的小訊號等效（F-04.4）。 */
export const GMAC_MEAN_MODEL = `flowchart LR
  subgraph REAL["實際訊號（sample rate）"]
    direction TB
    D1["δ_k = a − w_k<br/>block k 內固定"] --> M1["× u[n]<br/>有效 regressor"]
    M1 -- "＋ δ_k·u[n]" --> S1(("＋"))
    V1["雜訊 v[n]<br/>RMS σ_v"] -- "＋" --> S1
    S1 -- "e[n]" --> SG["sign<br/>q[n] = ±1"]
    SG -- "q[n]" --> M2["× x_ref[n]<br/>對齊後的 code"]
    M2 --> AV["(1/N)·Σ<br/>一個 block 的平均"]
    AV --> G1["G_k"]
  end
  subgraph MEAN["平均後的等效（小訊號）"]
    direction TB
    D2["δ_k"] --> KQ["× K_q = √(2/π) / σ_v<br/>sign 與雜訊的<br/>平均斜率，fs⁻¹"]
    KQ --> CC["× C = E[x_ref·u]<br/>兩個乘法與平均<br/>無因次"]
    CC --> G2["E[G_k] ≈ K_q·C·δ_k<br/>= K·δ_k"]
  end
  REAL -- "E[·]<br/>對雜訊取平均" --> MEAN
${CLASSES}
  class KQ,CC focus`

/** Sum vs average 的 scaling 路徑：少了「÷N」的右移，同一個 μ 的 loop gain 放大 N 倍（F-04.5）。 */
export const SUM_VS_AVERAGE = `flowchart TB
  S["GMAC 累加器<br/>S_k = Σ q[n]·x_ref[n]<br/>大小隨 N 成長"]
  S -- "S_k" --> SH["÷ N<br/>右移 log₂N bits"]
  SH -- "G_k = S_k / N" --> MA["× μ"]
  MA -- "Δw = μ·G_k" --> RA["average<br/>g = μ·K<br/>穩定：μ ∈ (0, 2/K)"]
  S -- "S_k（少了右移）" --> MS["× μ"]
  MS -- "Δw = μ·S_k = N·μ·G_k" --> RS["sum<br/>g = N·μ·K<br/>穩定：μ ∈ (0, 2/(N·K))"]
  S -- "S_k" --> MC["× μ/N<br/>把 ÷N 併進 μ"]
  MC -- "Δw = (μ/N)·S_k = μ·G_k" --> RC["和 average 逐位元相同<br/>g = μ·K"]
${CLASSES}
  class SH,RA ok
  class MS,RS warn`

/** 條件取負的 GMAC datapath（XOR + carry-in，一個加法器）與各級位元寬度（F-04.8）。 */
export const NEGATE_DATAPATH = `flowchart LR
  subgraph FAST["sample rate（索引 n）"]
    direction TB
    X["對齊後的 code x_int[n]<br/>二補數 B_x bits"] --> SE["符號延伸<br/>B_x → B_acc bits"]
    B["comparator bit b[n]<br/>1 bit，q = 2b − 1"] --> CTL["neg = NOT b<br/>b = 1 時 neg = 0<br/>b = 0 時 neg = 1<br/>（neg = 1 即 q = −1）"]
    SE --> XOR["逐位元 XOR<br/>neg = 0：x 原樣<br/>neg = 1：反相<br/>~x = −x − 1"]
    CTL -- "mask：B_acc 個 neg" --> XOR
    XOR -- "＋ x 或 ~x" --> ADD(("＋"))
    CTL -- "＋ carry-in c_in = neg" --> ADD
    REG["GMAC 累加器 S<br/>B_acc bits 暫存器"] -- "＋ S（目前的累加值）" --> ADD
    ADD -- "S + q·x_int" --> REG
    CLR["block 邊界<br/>清除 S"] -.-> REG
  end
  subgraph SLOW["block rate（索引 k）"]
    direction TB
    SH["右移 ℓ bits 並 rounding<br/>ℓ = log₂N − F_G"] -- "G_k<br/>保留 F_G 個小數位元" --> STEP["× μ<br/>shift 或乘法"]
    STEP -- "μ·G_k" --> W["gain register W<br/>w_{k+1} = w_k + μ·G_k"]
  end
  FAST -- "總和 S_k<br/>block 結束時" --> SLOW
${CLASSES}
  class SE,XOR,CTL focus`

/** 硬體 0/1 → ±1 的映射方塊，以及忘了映射的 bug 路徑（F-04.7）。 */
export const BIT_MAPPING = `flowchart TB
  E["PD 誤差 e[n]"] --> CMP["1-bit comparator<br/>e[n] ≥ 0 時 b[n] = 1<br/>否則 b[n] = 0"]
  CMP -- "b[n] ∈ {0, 1}" --> MAP["映射 q = 2b − 1<br/>0 → −1，1 → +1"]
  MAP -- "q[n] ∈ {−1, +1}" --> G1["GMAC<br/>G = (1/N)·Σ q[n]·x_ref[n]"]
  G1 --> R1["E[G] ≈ K·δ<br/>固定點 w* = a"]
  CMP -- "b[n] 直接當成 q<br/>（忘了映射）" --> G2["GMAC（bug）<br/>G_bug =<br/>(1/N)·Σ b[n]·x_ref[n]"]
  G2 --> R2["G_bug = ½·G + ½·x̄_ref<br/>增益減半<br/>再加上 code 的平均"]
  R2 --> R3["固定點 w* ≈<br/>a + E[x_ref] / (K_q·C)"]
${CLASSES}
  class MAP,G1,R1 ok
  class G2,R2,R3 warn`

// ───────────────────────────────────────────────────────────────────────────
// §5 定點 GMAC
// ───────────────────────────────────────────────────────────────────────────

/** §5 的地圖：定點 datapath 上每一級的位元寬度、兩個截斷點，以及 §5.1–§5.6 各在講哪一格。 */
export const FIXED_DATAPATH = `flowchart LR
  subgraph GM["GMAC：一個 block 的平均"]
    direction TB
    P["條件取負 q·x_int<br/>B_x + 1 bits（§5.4）"] --> ACC["GMAC 累加器 S<br/>B_acc bits（§5.1）"]
    ACC -- "S_k，整數" --> SH["截斷點 ①：右移<br/>ℓ = log₂N − F_G bits<br/>平均誤差 ε̄<br/>（§5.2、§5.3）"]
  end
  subgraph UP["更新 gain accumulator"]
    direction TB
    MU["× μ"] -- "μ·Q(G_k)<br/>格點間距 μ·Δ_G" --> QW["截斷點 ②：對齊<br/>W 的 LSB Δ_W<br/>平均誤差 ε̄_W<br/>（§5.6）"]
    QW -- "＋ ΔW" --> ADD(("＋"))
    W["高解析 gain<br/>accumulator W<br/>LSB = Δ_W"] -- "＋ W_k" --> ADD
    ADD --> SAT["飽和 / anti-windup<br/>[w_min, w_max]<br/>（§5.5）"]
    SAT -- "W_{k+1}" --> W
    W -- "w_k" --> DTC["DTC gain<br/>實體 code"]
  end
  GM -- "Q(G_k)<br/>LSB = Δ_G" --> UP
${CLASSES}
  class SH,QW warn`

/** 累加器位元數（F-04.9）的最壞情況，以及少 1 bit 時 wrap 與 saturate 的差別（6-bit code、N = 4096 的數字）。 */
export const ACCUMULATOR_SIZING = `flowchart TB
  A["單筆乘積 |q·x_int| ≤ M_x<br/>6-bit 對稱 code<br/>M_x = 31"] --> B["開機時 N 筆同號相加<br/>|S_k| ≤ N·M_x<br/>= 4096 × 31 = 126976"]
  B --> C["需要<br/>2^(B_acc−1) − 1 ≥ N·M_x<br/>B_acc = 1 +<br/>⌈log₂(N·M_x + 1)⌉<br/>= 18 bits"]
  B --> D{"只給 17 bits<br/>上限 2¹⁶ − 1<br/>= 65535"}
  D -- "wrap" --> E["126976 − 2¹⁷ = −4096<br/>變號：更新方向相反"]
  D -- "saturate" --> F["停在 +65535<br/>方向正確，只是變慢"]
${CLASSES}
  class C ok
  class E warn`

/**
 * 「÷N 就是右移」的位元切法（§5.2）：累加器 S_k 的低 ℓ bits 被丟掉（餘數 ρ），高 B_x + F_G bits 留下成為 Q(G_k)，
 * 它的 LSB 就是 Δ_G。例子的數字（B_x = 6、N = 1024、F_G = 4）與 §5.3 的偏差表、gmac.ts 的 accumulatorSizing 相同。
 */
export const SHIFT_BITS = `flowchart TB
  S["GMAC 累加器 S_k<br/>B_acc = B_x + log₂N bits<br/>（對稱 code、N = 2^m）<br/>例：6 + 10 = 16 bits"]
  S --> HI["高位元：留下<br/>B_acc − ℓ<br/>= B_x + F_G bits<br/>例：10 bits"]
  S --> LO["低位元：丟掉<br/>ℓ = log₂N − F_G bits<br/>就是餘數 ρ<br/>例：ℓ = 6"]
  LO --> RND["rounding 模式<br/>決定 ρ 要不要<br/>向上進 1"]
  HI --> Q["Q(G_k)<br/>整數 B_x bits<br/>＋ 小數 F_G bits"]
  RND -- "進位 0 或 1" --> Q
  Q --> DG["最小刻度 LSB<br/>Δ_G = 2^(−F_G)<br/>÷ 2^(B_x−1)<br/>例：1/512"]
${CLASSES}
  class LO,RND warn
  class HI,Q ok`

/**
 * 右移 ℓ bits 時四種取整模式的比較（F-04.10）：S 拆成留下的 j 與丟掉的餘數 ρ，差別只在餘數怎麼處理。
 * 例子的數字（S = −300、ℓ = 8）與 HC-04.7 的引言相同；diagrams.test.tsx 以 gmac.ts 的 shiftRound / roundingMeanError 驗算。
 */
export const ROUNDING_MODES = `flowchart TB
  S["GMAC 總和 S_k（整數）<br/>例：S = −300，ℓ = 8<br/>S / 2^ℓ = −1.17"] --> SPLIT["右移 ℓ bits：拆成兩段<br/>S = 2^ℓ·j + ρ<br/>j：留下的高位元<br/>ρ：丟掉的低 ℓ bits<br/>例：j = −2，ρ = 212"]
  SPLIT --> FL["floor（直接右移）<br/>Q = j<br/>例：−2"]
  SPLIT --> HU["half-up<br/>ρ ≥ 2^(ℓ−1) 時 Q = j + 1<br/>否則 Q = j<br/>例：212 ≥ 128，得 −1"]
  SPLIT --> HE["half-even<br/>同 half-up；ρ 恰好一半<br/>時取偶數<br/>例：−1"]
  SPLIT --> TZ["toward-0<br/>S 為負且 ρ ≠ 0 時<br/>Q = j + 1，否則 Q = j<br/>例：−1"]
  FL --> EF["平均誤差 ε̄ =<br/>−(1 − 2^(−ℓ)) / 2<br/>約 −½ 個 LSB"]
  HU --> EH["ε̄ = 2^(−ℓ−1)<br/>很小的正偏差"]
  HE --> EE["ε̄ = 0"]
  TZ --> ET["S 為正：ε̄ 同 floor<br/>S 為負：正負號相反<br/>0 附近是 dead zone"]
${CLASSES}
  class FL,EF warn
  class HE,EE ok`

/** 兩個截斷點的平均誤差像兩個 DC offset 注入平均迴路：固定點在「積分器輸入平均為 0」（F-04.11、F-04.18）。 */
export const BIAS_LOOP = `flowchart TB
  A["真實 gain a"] -- "＋" --> SUB(("＋"))
  SUB -- "δ = a − w" --> K["× K<br/>GMAC 的平均斜率<br/>fs⁻¹"]
  K -- "＋ K·δ" --> S1(("＋"))
  E1["截斷點 ①<br/>÷N 的右移<br/>平均誤差 ε̄·Δ_G"] -- "＋" --> S1
  S1 -- "E[Q(G)]" --> MU["× μ"]
  MU -- "＋" --> S2(("＋"))
  E2["截斷點 ②<br/>對齊 Δ_W<br/>平均誤差 ε̄_W·Δ_W"] -- "＋" --> S2
  S2 -- "E[ΔW]<br/>固定點時為 0" --> INT["1/(z−1)<br/>gain accumulator W"]
  INT -- "− w" --> SUB
${CLASSES}
  class E1,E2 warn`

/**
 * 最負 code 的取負 bug（F-04.15）：x_int = −2^(B_x−1) 且 b = 0（q = −1）時應加 +2^(B_x−1)，在 B_x bits 內取負會 wrap 回 −2^(B_x−1)，
 * 每次差 2^(B_x) LSB（正規化後 −2）；發生的機率 p_min·Φ(δ/σ_v)，平均起來是注入截斷點 ① 加法點的一個負 DC offset。
 * 例子是 6-bit：−32 取負應為 +32；diagrams.test.tsx 以 gmac.ts 的 negateExtended / negateInplace 驗算。
 */
export const NEGATE_BUG = `flowchart TB
  X["最負 code<br/>x_int = −2^(B_x−1)<br/>例：6-bit 的 −32<br/>出現機率 p_min = 1/64"] --> Q["comparator b = 0（q = −1）<br/>機率 Φ(δ/σ_v)<br/>此時要加的是 −x_int = +32"]
  Q --> OK["先延伸到 B_x + 1 bits<br/>再取負：+32 放得下"]
  Q --> BUG["在 B_x bits 內取負<br/>結果 +32 超出 6-bit 範圍<br/>wrap 回 −32"]
  OK --> OKR["加進累加器的是 +32<br/>（正確）"]
  BUG --> ERR["加進累加器的是 −32<br/>每次差 −64 LSB<br/>= 正規化 −2"]
  ERR --> INJ["平均誤差 −2·p_min·Φ(δ/σ_v)<br/>像一個負的 DC offset<br/>注入截斷點 ① 的加法點"]
  INJ --> FIX["固定點：<br/>K·δ∗ + ε̄·Δ_G<br/>− 2·p_min·Φ(δ∗/σ_v) = 0<br/>w∗ − a ≈ −p_min / K"]
${CLASSES}
  class OK,OKR ok
  class BUG,ERR,INJ warn
  class FIX focus`

/** Gain accumulator 超出範圍時的三種處理：anti-windup／只 clamp 輸出（windup）／wrap（F-04.12）。 */
export const ANTI_WINDUP = `flowchart TB
  DW["更新量 ΔW ≈ μ·G_k"] -- "＋" --> ADD(("＋"))
  W["gain accumulator W<br/>z⁻¹，每個 block 一拍"] -- "＋ W_k" --> ADD
  ADD -- "W_k + ΔW" --> MODE{"超出範圍時<br/>怎麼處理？"}
  MODE -- "anti-windup" --> AW["把 W 本身夾在<br/>[w_min, w_max]<br/>W_peak = w_max<br/>T_unwind = 0"]
  MODE -- "只 clamp 輸出" --> WU["W 繼續往外積分<br/>（windup）<br/>W_peak 遠大於 w_max"]
  MODE -- "wrap" --> WR["W 跳到暫存器<br/>的另一端，gain 由<br/>w_max 跳到 w_min"]
  AW -- "W_{k+1}" --> W
  WU -- "W_{k+1}" --> W
  WR -- "W_{k+1}" --> W
  W -- "W_k" --> CL["輸出 clamp<br/>w_applied = min(w_max,<br/>max(w_min, W_k))"]
  CL --> DTC["DTC gain trim"]
${CLASSES}
  class AW ok
  class WU,WR warn`

// ───────────────────────────────────────────────────────────────────────────
// §6 RTL 檢查清單
// ───────────────────────────────────────────────────────────────────────────

/** 忘了在 block 邊界清除 S：迴路多一個積分器，一階變二階、pole 落在單位圓上（F-04.13）。 */
export const CLEAR_BUG = `flowchart LR
  subgraph GOOD["正確：每個 block 清除 S"]
    direction TB
    D1["δ_k"] --> K1["× K<br/>GMAC：E[S_k] / N<br/>= K·δ_k"]
    K1 --> MU1["× μ"]
    MU1 --> I1["1/(z−1)<br/>gain accumulator"]
    I1 --> W1["w_k<br/>δ_{k+1} = (1 − g)·δ_k"]
  end
  subgraph BAD["忘了清除：多一個積分器"]
    direction TB
    D2["δ_k"] --> K2["× K"]
    K2 --> I0["1/(1 − z⁻¹)<br/>沒清除的 S<br/>S_0 + S_1 + … + S_k"]
    I0 --> MU2["× μ"]
    MU2 --> I2["1/(z−1)<br/>gain accumulator"]
    I2 --> W2["w_k<br/>δ_{k+1} − (2 − g)·δ_k +<br/>δ_{k−1} = 0"]
  end
  GOOD -. "少了 clear" .-> BAD
${CLASSES}
  class I0,W2 warn
  class W1 ok`

// ───────────────────────────────────────────────────────────────────────────
// §7 綜合手算
// ───────────────────────────────────────────────────────────────────────────

/** 綜合手算 HC-04.8 的計算順序：增益 → 穩定 → 位元數 → 兩個截斷點 → 合計偏差。 */
export const HANDCALC_FLOW = `flowchart TB
  IN["七個輸入<br/>σ_v、μ、B_x、log₂N<br/>F_G、ℓ_W、d"]
  IN --> KQ["K_q = √(2/π) / σ_v"]
  IN --> EX["M_x = 2^(B_x−1) − 1<br/>E[x²] = M_x·(M_x + 1)<br/>÷ (3·4^(B_x−1))"]
  KQ --> K["K = K_q·E[x²]"]
  EX --> K
  K --> G["g = μ·K，p = 1 − g"]
  G --> GC["穩定檢查：g 小於<br/>g_crit = 2·sin(π/(4d + 2))"]
  IN --> BA["B_acc = B_x + log₂N<br/>對稱 code、N = 2^m"]
  IN --> L["ℓ = log₂N − F_G<br/>Δ_G = 2^(−F_G)<br/>÷ 2^(B_x−1)"]
  L --> B1["ε̄ = −(1 − 2^(−ℓ)) / 2<br/>偏差 ① = ε̄·Δ_G / K"]
  K --> B1
  L --> DW["R = 2^ℓ_W<br/>Δ_W = R·μ·Δ_G"]
  DW --> B2["ε̄_W = −(1 − 1/R) / 2<br/>偏差 ② = ε̄_W·Δ_W / g"]
  G --> B2
  B1 --> T["w* − a =<br/>偏差 ① + 偏差 ②"]
  B2 --> T
  IN -. "μ" .-> G
  IN -. "d" .-> GC
  IN -. "μ、ℓ_W" .-> DW
${CLASSES}
  class K,G focus
  class T ok`

// ───────────────────────────────────────────────────────────────────────────
// 登錄表（頁面出現順序 = 圖號順序；diagrams.test.tsx 逐一解析）
// ───────────────────────────────────────────────────────────────────────────

export type Ch04DiagramType = 'flowchart-v2' | 'sequence'

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
  { name: 'LATENCY_TIMELINE', chart: LATENCY_TIMELINE, type: 'sequence', section: '§3' },
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
