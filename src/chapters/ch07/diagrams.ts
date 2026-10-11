/**
 * Ch07 的 Mermaid 方塊圖原始碼（docs/teaching-style.md §8）。集中在這裡，diagrams.test.tsx 用真正的 mermaid parser 逐張驗證。
 *
 * 約定（與本章公式逐一核對）：
 *   - 訊號名稱與公式相同：x[n]（code）、u = h * x（PD 端的有效 regressor）、e_PD = (a − w)·u + v、q = sign(e_PD)、
 *     x_ref（GMAC 實際相乘的 regressor）、u_f = ĥ * x、G_k = (1/N)Σ q·x_ref、w_{k+1} = w_k + μ·G_k；δ = a − w。
 *   - 延遲 code 的殘餘相位是 φ + ΩD，延遲 comparator 輸出是 φ − ΩD（F-07.2／F-07.3）。
 *   - n 是 comparator sample、k 是 GMAC block；累加器在 block rate。
 *   - 加法點（圓形 ＋）：e_PD = δ·u + v（CHART_SIGNAL_MODEL、CHART_GRADIENT）、δ_k = a − w_k（CHART_MEAN_LOOP）、二次差分 x[n] − 2x[n−1] + x[n−2]、
 *     Type-II 迴路的 (a − w)·x 減去回授；每條輸入線都標正負號。
 *   - 平均後的校正迴路（CHART_MEAN_LOOP）：E[G_k] ≈ K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ δ_{k+1} = (1 − μ·K_q·C)·δ_k；
 *     加法點是 δ_k = a − w_k（a 進正端、w_k 進負端），整圈都是 block rate。
 *   - Mermaid 不渲染 KaTeX：節點文字用 Unicode 數學符號；標籤內不用 ASCII 的 < >（改全形 ＜ ＞），換行用 <br/>。
 *   - 加法點與正號一律用全形「＋」：Mermaid 11 會把每個標籤當 Markdown 解析，只有一個 ASCII「+」（或以「+ 」「- 」「1. 」開頭）的標籤
 *     會被當成清單，畫面上變成「Unsupported markdown: list」。diagrams.test.tsx 用真正的 render 檢查這件事。
 *   - 走圖的文字用顏色與方塊名稱指路（不用「上面／下面」）：方塊的實際位置由 Mermaid 的排版決定。
 *   - 排版：內文欄位約 1000 px。「兩路相乘」與流程類的圖（6 個以上的方塊串在一起）用 flowchart TB——左右排列會超過 1400 px，
 *     縮進欄位後字太小；硬體結構圖（delay line、二次差分、迴路）維持左右排列。判斷節點用六角形 {{ }}，菱形太佔空間。
 *   - 顏色：focus（藍）＝這張圖要看的方塊；ok（綠）＝極性正確的結果；warn（紅）＝會出錯的地方。三色在深淺主題都看得清楚。
 */

import type { SystemBlock } from '@/components'

const CLASS_DEFS = [
  '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px',
  '  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px',
  '  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px',
]

const chart = (lines: string[]): string => [...lines, ...CLASS_DEFS].join('\n')

/** §7.1：問題出在哪裡——comparator 看到的是 u（經過 H），GMAC 乘的卻是 code；本章在 code 這一側加一個延遲。 */
export const CHART_SIGNAL_MODEL = chart([
  'flowchart TB',
  '  X(["code x[n]"]) --> H["PLL 誤差路徑 H<br/>增益 |H|、相位 φ"]',
  '  X --> DLY["延遲 D 個 sample<br/>z⁻ᴰ"]',
  '  H -- "u[n]" --> GE["乘上剩餘 gain 誤差<br/>δ = a − w"]',
  '  GE -- "＋ δ·u[n]" --> S(("＋"))',
  '  V(["comparator 前的雜訊<br/>v[n]，標準差 σ_v"]) -- "＋ v[n]" --> S',
  '  S -- "e_PD[n] = δ·u[n] + v[n]" --> CMP["1-bit comparator<br/>q = sign(e_PD)"]',
  '  CMP -- "q[n]" --> M(("×"))',
  '  DLY -- "x[n−D]" --> M',
  '  M --> AVG["一個 block 取平均<br/>G_k = (1/N) Σ q[n]·x[n−D]"]',
  '  class H warn',
  '  class DLY focus',
])

/** §7.1：單頻的相位記帳——誤差路徑加 φ、延遲 code 減 ΩD，GMAC 只留下兩路的相位差 θ = φ + ΩD。 */
export const CHART_PHASE_BOOKKEEPING = chart([
  'flowchart TB',
  '  T(["單頻 code：相位 Ωn"]) --> H["誤差路徑 H：相位加 φ<br/>例：φ = −120°"]',
  '  T --> D["延遲 D 個 sample：相位減 ΩD<br/>例：D = 4，ΩD = 120°"]',
  '  H -- "u：Ωn + φ" --> M["相乘再平均，只留下兩路的相位差<br/>殘餘相位 θ = φ + ΩD<br/>例：−120° + 120° = 0°"]',
  '  D -- "x[n−D]：Ωn − ΩD" --> M',
  '  M --> Q{{"|θ| ＜ 90°？"}}',
  '  Q -- "是" --> POS["C_D ＞ 0<br/>往對的方向修"]',
  '  Q -- "否" --> NEG["C_D ≤ 0<br/>沒有恢復力，或反向更新"]',
  '  class D focus',
  '  class POS ok',
  '  class NEG warn',
])

/**
 * §7.1：平均後的校正迴路（block rate k）——comparator、乘法器、平均器合起來平均而言是一個增益 K_q·C。
 * δ_k = a − w_k、E[G_k] ≈ K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ δ_{k+1} = (1 − μ·K_q·C)·δ_k：一圈的增益 g = μ·K_q·C，pole p = 1 − g。
 */
export const CHART_MEAN_LOOP = chart([
  'flowchart LR',
  '  A(["DTC 真正的 gain a"]) -- "＋ a" --> S(("＋"))',
  '  S -- "δ_k = a − w_k" --> KC["comparator、乘法器、平均器<br/>平均而言：乘上 K_q·C"]',
  '  KC -- "E[G_k] = K_q·C·δ_k" --> MU["乘上 learning rate μ"]',
  '  MU -- "μ·G_k" --> ACC["累加器 1/(z−1)<br/>w_{k+1} = w_k + μ·G_k"]',
  '  ACC -- "− w_k" --> S',
  '  class KC focus',
])

/** §7.2：推導 C_D 的關鍵——乘法器把兩個同頻 cos 變成「常數項 + 兩倍頻項」，平均器只留下常數項。 */
export const CHART_MIXER_AVERAGE = chart([
  'flowchart TB',
  '  XD(["x[n−D] = A·cos(Ωn − ΩD)"]) --> M(("×"))',
  '  U(["u[n] = A·|H|·cos(Ωn + φ)"]) --> M',
  '  M -- "積化和差" --> DC["不隨 n 變的項<br/>(A²|H|/2)·cos(φ + ΩD)"]',
  '  M -- "積化和差" --> HF["兩倍頻的項<br/>(A²|H|/2)·cos(2Ωn + φ − ΩD)"]',
  '  DC -- "原封不動" --> AVG["長時間平均 E[·]<br/>GMAC 的累加"]',
  '  HF -- "正負抵消成 0" --> AVG',
  '  AVG --> C(["C_D = (A²/2)·|H|·cos(φ + ΩD)"])',
  '  class DC focus',
])

/** §7.2：同一個 z⁻ᴰ 放在 code 側或 comparator 側——ΩD 的符號相反。 */
export const CHART_DELAY_SIDE = chart([
  'flowchart LR',
  // 兩個互不相連的框：父圖用 LR、框內也明寫 direction LR，兩個框才會上下疊（各自由左到右）。
  // Mermaid 把同一層互不相連的框排成「後宣告的在前」，所以先宣告 B、再宣告 A，畫面上 A 在上面（diagrams.test.tsx 會檢查）。
  '  subgraph SIDE_ERR["做法 B：延遲 comparator 輸出"]',
  '    direction LR',
  '    QB(["q[n]"]) --> DB["z⁻ᴰ"]',
  '    DB -- "q[n−D]" --> MB(("×"))',
  '    XB(["x[n]"]) --> MB',
  '    MB --> RB["殘餘相位 φ − ΩD<br/>適合超前的誤差路徑（φ ＞ 0）"]',
  '  end',
  '  subgraph SIDE_CODE["做法 A：延遲 code（本站的 D）"]',
  '    direction LR',
  '    XA(["x[n]"]) --> DA["z⁻ᴰ"]',
  '    DA -- "x[n−D]" --> MA(("×"))',
  '    QA(["q[n]"]) --> MA',
  '    MA --> RA["殘餘相位 φ + ΩD<br/>適合落後的誤差路徑（φ ＜ 0）"]',
  '  end',
  '  class DA,DB focus',
])

/**
 * §7.2（邊界情況 2，F-07.6）：只平均一個 block 的 N 個 sample（n = n₀ … n₀+N−1）——和 CHART_MIXER_AVERAGE 只差兩倍頻那一路：
 * (1/N)Σ cos(2Ωn + ψ) = cos(2Ω·n_c + ψ)·sin(NΩ)/(N·sin Ω)，n_c = n₀ + (N−1)/2 是 block 的中點；長時間平均時這個比例趨近 0。
 */
export const CHART_BLOCK_AVERAGE = chart([
  'flowchart TB',
  '  P(["乘法器輸出 x[n−D]·u[n]<br/>第 k 個 block：n = n₀ … n₀+N−1"]) --> DC["不隨 n 變的項<br/>(A²|H|/2)·cos(φ + ΩD)"]',
  '  P --> HF["兩倍頻的項<br/>(A²|H|/2)·cos(2Ωn + φ − ΩD)"]',
  '  DC -- "原封不動" --> AVG["只平均 N 個 sample<br/>(1/N) Σ"]',
  '  HF -- "n 換成 block 的中點 n₀ + (N−1)/2<br/>再乘上 sin(NΩ) / (N·sin Ω)" --> AVG',
  '  AVG --> G(["這一個 block 的相關<br/>常數項 + ripple"])',
  '  class DC focus',
  '  class HF warn',
])

/** §7.3：delay line + tap MUX——每多一級 register，相位多落後 Ω（線性相位）。圖上畫 4 級。 */
export const CHART_DELAY_LINE = chart([
  'flowchart LR',
  '  X(["x[n]"]) --> R1["z⁻¹"]',
  '  R1 --> R2["z⁻¹"]',
  '  R2 --> R3["z⁻¹"]',
  '  R3 --> R4["z⁻¹"]',
  '  X -- "相位 0" --> MUX{{"tap MUX<br/>REG_GMAC_DLY = D"}}',
  '  R1 -- "−Ω" --> MUX',
  '  R2 -- "−2Ω" --> MUX',
  '  R3 -- "−3Ω" --> MUX',
  '  R4 -- "−4Ω" --> MUX',
  '  MUX -- "x[n−D]" --> GMAC(["GMAC"])',
  '  class R1,R2,R3,R4,MUX focus',
])

/** §7.3：同一個 D 對兩個頻率——對準 tone 1 之後，tone 2 的殘餘相位是 (Ω₂ − Ω₁)·D。 */
export const CHART_TWO_TONES = chart([
  'flowchart TB',
  '  subgraph TONE1["tone 1：Ω₁ = 30°/sample（對準的頻率）"]',
  '    A1["誤差路徑：φ₁ = −120°"] --> B1["同一條 delay line，D = 4<br/>Ω₁D = 120°"]',
  '    B1 --> C1["θ₁ = φ₁ + Ω₁D = 0°<br/>cos θ₁ = +1"]',
  '  end',
  '  subgraph TONE2["tone 2：Ω₂ = 60°/sample"]',
  '    A2["誤差路徑：φ₂ = −120°（假設相同）"] --> B2["同一條 delay line，D = 4<br/>Ω₂D = 240°"]',
  '    B2 --> C2["θ₂ = φ₂ + Ω₂D = +120°<br/>cos θ₂ = −0.5"]',
  '  end',
  '  C1 -- "正票" --> SUM["C_D = Σᵢ (Aᵢ²/2)·|Hᵢ|·cos θᵢ"]',
  '  C2 -- "負票" --> SUM',
  '  class B1,B2 focus',
  '  class C1 ok',
  '  class C2 warn',
])

/** §7.3：多頻／寬頻 code 的 C_D——每個頻率依 S_xx·|H| 加權投票，票的正負由 cos(φ + ΩD) 決定。 */
export const CHART_VOTING = chart([
  'flowchart TB',
  '  WGT["這一票有多重<br/>code 功率 S_xx(Ω) 乘上 |H(Ω)|"] --> PROD(("×"))',
  '  SGN["這一票是正是負<br/>cos(φ(Ω) + ΩD)"] --> PROD',
  '  PROD -- "一個頻率的票" --> SUM["所有頻率加總<br/>C_D = Σᵢ 或 (1/2π)∫ dΩ"]',
  '  SUM --> Q{{"C_D ＞ 0？"}}',
  '  Q -- "是" --> P1["p = 1 − μ·K_q·C_D ＜ 1<br/>方向正確"]',
  '  Q -- "否" --> P2["p ≥ 1<br/>漂移或發散"]',
  '  class SGN focus',
  '  class P1 ok',
  '  class P2 warn',
])

/** §7.4：同一個 e_PD 乘 u 還是乘 x——真正的梯度乘的是 u（E[u²] ≥ 0），raw-x 乘的是 x（C 可正可負）。 */
export const CHART_GRADIENT = chart([
  'flowchart LR',
  '  X(["x[n]"]) --> H["誤差路徑 h"]',
  '  H -- "u[n]" --> GE["乘上 (a − w)"]',
  '  GE -- "＋" --> S(("＋"))',
  '  V(["v[n]"]) -- "＋" --> S',
  '  S -- "e_PD[n]" --> MU(("×"))',
  '  H -- "u[n]" --> MU',
  '  MU -- "−dJ/dw：真正的梯度" --> RU["平均：(a − w)·E[u²]<br/>E[u²] ≥ 0，方向永遠正確"]',
  '  S -- "e_PD[n]" --> MX(("×"))',
  '  X -- "x[n]" --> MX',
  '  MX -- "乘的是 x：raw-x" --> RX["平均：(a − w)·C，C = E[x·u]<br/>C 可正可負"]',
  '  class RU ok',
  '  class RX warn',
])

/** §7.4：三種 regressor 並排——同一個乘法器與 q[n]，只差 x_ref 從哪裡來（藍色是多出來的方塊）。 */
export const CHART_THREE_REGRESSORS = chart([
  'flowchart LR',
  // 三個互不相連的框上下疊、各自由左到右（做法同 CHART_DELAY_SIDE）：先宣告 C、最後宣告 A，畫面上由上到下是 A、B、C。
  '  subgraph ARCH_FX["C：filtered-x（補一個模型）"]',
  '    direction LR',
  '    XC(["x[n]"]) --> HC["模型 Ĥ<br/>u_f = ĥ * x"]',
  '    HC -- "x_ref = u_f[n]" --> MC(("×"))',
  '    QC(["q[n]"]) --> MC',
  '    MC --> GC["相關 E[u·u_f]<br/>每個頻率都補上 ∠Ĥ"]',
  '  end',
  '  subgraph ARCH_DLY["B：delayed-x（補一個延遲）"]',
  '    direction LR',
  '    XB(["x[n]"]) --> DB["z⁻ᴰ<br/>D 級 shift register"]',
  '    DB -- "x_ref = x[n−D]" --> MB(("×"))',
  '    QB(["q[n]"]) --> MB',
  '    MB --> GB["相關 C_D = E[x[n−D]·u]<br/>只補一條直線 ΩD"]',
  '  end',
  '  subgraph ARCH_RAW["A：raw-x（不補償）"]',
  '    direction LR',
  '    XA(["x[n]"]) -- "x_ref = x[n]" --> MA(("×"))',
  '    QA(["q[n]"]) --> MA',
  '    MA --> GA["相關 C = E[x·u]<br/>相位 φ 原封不動"]',
  '  end',
  '  class DB,HC focus',
])

/** §7.4：filtered-x 的閉迴路（F-07.10）——sample rate n 的相乘、block rate k 的平均與累加，w_k 回授到 DTC。 */
export const CHART_FX_LOOP = chart([
  'flowchart TB',
  '  X(["code x[n]"]) --> P["真實路徑加雜訊<br/>e_PD[n] = (a − w_k)·(h * x)[n] + v[n]"]',
  '  X --> HAT["模型 Ĥ<br/>u_f = ĥ * x"]',
  '  P -- "e_PD[n]" --> CMP["comparator<br/>q = sign(e_PD)"]',
  '  HAT --> DL["z⁻ᴰ"]',
  '  CMP -- "q[n]" --> M(("×"))',
  '  DL -- "u_f[n−D]" --> M',
  '  M -- "每個 sample n" --> AVG["block 平均<br/>G_k = (1/N) Σ q[n]·u_f[n−D]"]',
  '  AVG -- "每個 block k" --> ACC["乘上 μ 再累加，1/(z−1)<br/>w_{k+1} = w_k + μ·G_k"]',
  '  ACC -- "w_k 回授（負回授：a − w_k）" --> P',
  '  class HAT focus',
])

/** §7.4：正規化相關 ρ 怎麼算、怎麼讀——符號是極性，大小是效率。 */
export const CHART_RHO_READING = chart([
  'flowchart LR',
  '  N1["分子 E[x_ref·u]<br/>regressor 和 u 有多同步"] --> R["ρ_ref = 分子 ÷ 分母<br/>範圍 −1 到 +1"]',
  '  N2["分母 √(E[x_ref²]·E[u²])<br/>兩個訊號各自的大小"] --> R',
  '  R --> SG["看符號<br/>ρ ＞ 0 方向正確，ρ ＜ 0 反向更新"]',
  '  R --> MG["看大小<br/>σ_w ∝ 1/(√N·|ρ|)<br/>N 要補 1/ρ² 倍"]',
  '  class R focus',
])

/** §7.5：模型誤差——GMAC 等效在算 E[u·u_f]；每個頻率的票是 S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)（F-07.12）。 */
export const CHART_MISMATCH = chart([
  'flowchart TB',
  '  X(["code x[n]"]) --> H["真實誤差路徑 H<br/>在 PLL 裡，拿不到"]',
  '  X --> HAT["模型 Ĥ<br/>設計者寫進 RTL"]',
  '  H -- "u[n]，藏在 q[n] 裡" --> COR["GMAC 等效在算 E[u·u_f]<br/>每個頻率一票：<br/>S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)"]',
  '  HAT -- "u_f[n]" --> COR',
  '  COR --> Q{{"有 code 能量的頻率上<br/>|∠H − ∠Ĥ| ＜ 90°？"}}',
  '  Q -- "都成立" --> POS["E[u·u_f] ＞ 0<br/>p_f ＜ 1"]',
  '  Q -- "有些不成立" --> NEG["那些頻率投負票<br/>總和可能變號"]',
  '  class HAT focus',
  '  class POS ok',
  '  class NEG warn',
])

/** §7.5：失效例子 Ĥ = H·z^−Δ——模型多算的 latency 變成相位差 ΩΔ。 */
export const CHART_LATENCY_MISMATCH = chart([
  'flowchart TB',
  '  X(["單頻 code：相位 Ωn"]) --> H["真實路徑 H<br/>相位加 φ"]',
  '  X --> HM["模型裡的 H<br/>相位加 φ"]',
  '  HM --> DL["模型多算的 latency z^−Δ<br/>相位減 ΩΔ"]',
  '  H -- "u：Ωn + φ" --> COR["相乘再平均，只留下相位差<br/>∠H − ∠Ĥ = ΩΔ"]',
  '  DL -- "u_f：Ωn + φ − ΩΔ" --> COR',
  '  COR --> R["E[u·u_f] = |H|²·cos(ΩΔ)（unit power）<br/>例：Ω = 30°、Δ = 4<br/>cos 120° = −0.5，反向更新"]',
  '  class DL,R warn',
])

/** §7.5：二次差分 regressor 的硬體——兩個暫存器、一個左移、一個三輸入加法（F-07.14）。 */
export const CHART_SECOND_DIFF = chart([
  'flowchart LR',
  '  X(["x[n]"]) --> R1["z⁻¹"]',
  '  R1 -- "x[n−1]" --> R2["z⁻¹"]',
  '  X -- "＋ x[n]" --> S(("＋"))',
  '  R1 -- "x[n−1]" --> SH["乘 2<br/>左移 1 bit"]',
  '  SH -- "− 2x[n−1]" --> S',
  '  R2 -- "＋ x[n−2]" --> S',
  '  S --> K["乘上 K₂<br/>可併入 μ"]',
  '  K --> O(["x_ref[n] = K₂·(x[n] − 2x[n−1] + x[n−2])"])',
  '  class R1,R2,SH,S focus',
])

/** §7.5：E44 的 DT Type-II DPLL——開迴路 L(z) 是三個藍色方塊的乘積；加法點的輸出 (a − w)·u 除以輸入 (a − w)·x 就是 H_PD = 1/(1 + L)。 */
export const CHART_TYPE2_LOOP = chart([
  'flowchart LR',
  '  E(["DTC 的 gain 誤差<br/>(a − w)·x[n]"]) -- "＋" --> S(("＋"))',
  '  S -- "(a − w)·u[n]" --> PI["PI loop filter<br/>K_p + K_i/(1 − z⁻¹)"]',
  '  PI --> DCO["DCO 積分器<br/>1/(1 − z⁻¹)"]',
  '  DCO --> DL["迴路延遲<br/>z^−(1+d)"]',
  '  DL -- "回授，−" --> S',
  '  S -- "(a − w)·u[n]" --> OUT(["到 comparator<br/>再加上雜訊 v[n]"])',
  '  class PI,DCO,DL focus',
])

/**
 * §7.6：四種 regressor 在 RTL 中的位置（原有的圖；標籤改成與公式相同的寫法）。
 * 主路徑：DTC 留下 (a − w_k)·x[n]，經 H_PD 並加上 v[n] 成為 e_PD[n]（F-07.1）；GMAC 與更新式是 F-07.10。
 */
export const CHART_RTL_REGRESSORS = chart([
  'flowchart LR',
  '  X(["code x[n]<br/>DSM 或 training tone"]) --> DTC["DTC：真正的 gain a<br/>校正係數 w_k"]',
  '  DTC -- "(a − w_k)·x[n]" --> H["PLL 誤差路徑 H_PD<br/>再加上雜訊 v[n]"]',
  '  H -- "e_PD[n]" --> CMP["1-bit comparator<br/>q = sign(e_PD)"]',
  '  X --> R0["raw：直接接線"]',
  '  X --> SR["shift register<br/>z⁻¹ × D_max"]',
  '  SR --> MUX{{"tap MUX<br/>REG_GMAC_DLY = D"}}',
  '  X --> HF["模型 Ĥ：FIR 或 IIR<br/>u_f = ĥ * x"]',
  '  HF --> SR2["z⁻ᴰ"]',
  '  X --> SD["二次差分<br/>K₂·(x[n] − 2x[n−1] + x[n−2])"]',
  '  R0 -- "x[n]" --> SEL{{"REG_GMAC_XSEL<br/>四選一"}}',
  '  MUX -- "x[n−D]" --> SEL',
  '  SR2 -- "u_f[n−D]" --> SEL',
  '  SD --> SEL',
  '  SEL -- "x_ref[n]" --> GMAC["GMAC<br/>G_k = (1/N) Σ q[n]·x_ref[n]"]',
  '  CMP -- "q[n]" --> GMAC',
  '  GMAC -- "每個 block k" --> UPD["累加器<br/>w_{k+1} = w_k + μ·G_k"]',
  '  UPD -- "w_k" --> DTC',
  '  class SEL focus',
])

/** §7.6：硬體成本階梯——每往後一階，額外硬體與需要事先知道的東西越來越多，能處理的 code 也越廣。 */
export const CHART_COST_LADDER = chart([
  'flowchart LR',
  '  L0["第 0 階：raw-x<br/>額外硬體：無<br/>要知道：無<br/>有效：code 頻帶上 |∠H| ＜ 90°"]',
  '  L1["第 1 階：二次差分<br/>額外硬體：2×B 個 flip-flop、2 個加法器、1 個左移<br/>要知道：迴路是 Type-II<br/>有效：窄頻、低頻的 tone"]',
  '  L2["第 2 階：delayed-x<br/>額外硬體：D_max×B 個 flip-flop、tap MUX<br/>要知道：φ(Ω₀)<br/>有效：窄頻 code，只對準一個頻率"]',
  '  L3["第 3 階：filtered-x<br/>額外硬體：L_FIR 個乘法器加 adder tree，或 2 階 IIR<br/>要知道：Ĥ（ω_n、ζ、latency、K_DCO）<br/>有效：任何 code，只要相位誤差 ＜ 90°"]',
  '  L0 --> L1',
  '  L1 --> L2',
  '  L2 --> L3',
  '  class L3 focus',
])

/** §7.6：決策流程——我需要哪一種修法？先看 C 的符號，再看 code 是不是窄頻，最後才上 filtered-x。 */
export const CHART_DECISION = chart([
  'flowchart TB',
  '  A(["先量或先算 raw-x 的相關 C = E[x·u]<br/>bring-up：GMAC 斜率 S ≈ −K_q·C"]) --> Q1{{"C ＞ 0，而且 ρ 夠大？"}}',
  '  Q1 -- "是" --> RAW["用 raw-x<br/>不需要補償"]',
  '  Q1 -- "否" --> Q2{{"code 是窄頻嗎？<br/>training tone、單一主譜線"}}',
  '  Q2 -- "是" --> Q3{{"Type-II 迴路，而且<br/>Ω 低於 F-07.15 的邊界？"}}',
  '  Q3 -- "是" --> SD["二次差分<br/>K₂·(1 − z⁻¹)²"]',
  '  Q3 -- "否" --> DX["delayed-x<br/>D ≈ ((−φ) mod 2π) / Ω<br/>FCW、PVT 一變就要重找"]',
  '  Q2 -- "否：寬頻、DSM code" --> FX["filtered-x<br/>u_f = ĥ * x"]',
  '  FX --> Q4{{"E[u·u_f] ＞ 0？<br/>充分條件：激勵頻帶上 |∠H − ∠Ĥ| ＜ 90°"}}',
  '  Q4 -- "是" --> DONE["完成<br/>p_f = 1 − μ·K_q·E[u·u_f]"]',
  '  Q4 -- "否" --> FIX["修模型 Ĥ<br/>先查 latency（E45）"]',
  '  FIX --> FX',
  '  class RAW,SD,DX,DONE ok',
  '  class FX focus',
  '  class FIX warn',
])

/** §7.7：綜合手算 HC-07.8 的計算順序（①…⑨ 與手算題的步驟順序相同）。 */
export const CHART_HANDCALC_FLOW = chart([
  'flowchart TB',
  '  IN(["已知：|H|、φ、Ω、D、μ、σ_v（unit power：A²/2 = 1）"])',
  '  IN --> A1["① raw-x<br/>C_raw = |H|·cos φ"]',
  '  IN --> B1["② delayed-x 的殘餘相位<br/>θ = wrap(φ + ΩD)"]',
  '  B1 --> B2["③ C_D = |H|·cos θ"]',
  '  IN --> C1["④ filtered-x（Ĥ = H）<br/>E[u²] = |H|²"]',
  '  IN --> K1["⑤ K_q = √(2/π) / σ_v"]',
  '  K1 --> K2["⑥ μ·K_q"]',
  '  A1 --> P1["⑦ p_raw = 1 − μ·K_q·C_raw"]',
  '  B2 --> P2["⑧ p_D = 1 − μ·K_q·C_D"]',
  '  C1 --> P3["⑨ p_f = 1 − μ·K_q·E[u²]"]',
  '  K2 --> P1',
  '  K2 --> P2',
  '  K2 --> P3',
  '  P1 --> J["判讀每個 pole<br/>|p| ＜ 1 收斂；p ＞ 1 反向更新"]',
  '  P2 --> J',
  '  P3 --> J',
  '  class K2 focus',
])

/**
 * §7.10：bring-up 時量極性——把 w 固定在 w₀ ± Δw，各讀一次 GMAC 的平均。
 * E[G] = K_q·C·(a − w) ⇒ G₊ = K_q·C·(a − w₀ − Δw)、G₋ = K_q·C·(a − w₀ + Δw) ⇒ S = (G₊ − G₋)/(2Δw) = −K_q·C；S ＜ 0 ⇔ C ＞ 0。
 */
export const CHART_BRINGUP = chart([
  'flowchart TB',
  '  W1(["把 w 固定在 w₀ + Δw"]) --> GP["讀 GMAC 的平均<br/>G₊ = E[G_k]"]',
  '  W2(["把 w 固定在 w₀ − Δw"]) --> GM["讀 GMAC 的平均<br/>G₋ = E[G_k]"]',
  '  GP --> SL["斜率 S = (G₊ − G₋) / (2Δw)<br/>≈ −K_q·C"]',
  '  GM --> SL',
  '  SL --> Q{{"S ＜ 0？"}}',
  '  Q -- "是" --> OK["C ＞ 0：極性正確<br/>可以閉迴路"]',
  '  Q -- "否" --> BAD["C ≤ 0：極性錯誤<br/>改用 delayed-x、filtered-x（7.6 節的決策流程）"]',
  '  class SL focus',
  '  class OK ok',
  '  class BAD warn',
])

/** 本章全部的 Mermaid 圖（章首的 SystemMap 另計）；diagrams.test.tsx 逐張解析並核對頁面上的張數。 */
export const CH07_CHARTS = {
  CHART_SIGNAL_MODEL,
  CHART_PHASE_BOOKKEEPING,
  CHART_MEAN_LOOP,
  CHART_MIXER_AVERAGE,
  CHART_DELAY_SIDE,
  CHART_BLOCK_AVERAGE,
  CHART_DELAY_LINE,
  CHART_TWO_TONES,
  CHART_VOTING,
  CHART_GRADIENT,
  CHART_THREE_REGRESSORS,
  CHART_FX_LOOP,
  CHART_RHO_READING,
  CHART_MISMATCH,
  CHART_LATENCY_MISMATCH,
  CHART_SECOND_DIFF,
  CHART_TYPE2_LOOP,
  CHART_RTL_REGRESSORS,
  CHART_COST_LADDER,
  CHART_DECISION,
  CHART_HANDCALC_FLOW,
  CHART_BRINGUP,
} as const

export type Ch07ChartName = keyof typeof CH07_CHARTS

/** 章首系統地圖要標成藍色的方塊：小數殘量 x[n]（regressor 的來源）、code alignment（本章設計的方塊）、GMAC。 */
export const CH07_SYSTEM_FOCUS: SystemBlock[] = ['res', 'align', 'gmac']
