/**
 * Ch07 的 Mermaid 方塊圖原始碼（docs/teaching-style.md §8）。集中在這裡，diagrams.test.tsx 用真正的 mermaid parser 與 renderer 逐張驗證。
 *
 * 約定（與本章公式逐一核對）：
 *   - 訊號名稱與公式相同：x[n]（code）、u = h * x（PD 端的有效 regressor）、e_PD = (a − w)·u + v、q = sign(e_PD)、
 *     x_ref（GMAC 實際相乘的 regressor）、u_f = ĥ * x、G_k = (1/N)Σ q·x_ref、w_{k+1} = w_k + μ·G_k；δ = a − w。
 *   - 架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端，回授路徑上只有 divider。PD 量的是「DTC 延遲後的 reference edge 減 feedback edge」，
 *     所以 DTC 留下的殘餘誤差 (a − w)·x 從 PD 的 reference 輸入（正端）進來、回授從負端進來，H_PD = 1/(1 + L) 取正號（CHART_TYPE2_LOOP 的圓圈就是 PD）。
 *     comparator 取的是 PD 的輸出 e_PD——送進 loop filter 的同一個節點：畫到 comparator 的四張圖（CHART_SIGNAL_MODEL、CHART_FX_LOOP、
 *     CHART_TYPE2_LOOP、CHART_RTL_REGRESSORS），comparator 的輸入線都從 PD 的輸出拉，並在線上或圓圈上標出「PD」。
 *     校正迴路算出的 w_k 送回 reference 端的 DTC（補償量 w_k·x[n]）；這是校正迴路的回授，不是 PLL 的回授路徑。
 *   - 延遲 code 的殘餘相位是 φ + ΩD，延遲 comparator 輸出是 φ − ΩD（F-07.2／F-07.3）。
 *   - n 是 comparator sample、k 是 GMAC block；累加器在 block rate。
 *   - 加法點（圓形 ＋）：e_PD = δ·u + v（CHART_SIGNAL_MODEL、CHART_GRADIENT）、δ_k = a − w_k（CHART_MEAN_LOOP）、二次差分 x[n] − 2x[n−1] + x[n−2]、
 *     Type-II 迴路的 (a − w)·x 減去回授（這個減法點就是 PD，圓圈裡寫「PD」而不是「＋」）；每條輸入線都標正負號。
 *   - 平均後的校正迴路（CHART_MEAN_LOOP）：E[G_k] ≈ K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ δ_{k+1} = (1 − μ·K_q·C)·δ_k；
 *     加法點是 δ_k = a − w_k（a 進正端、w_k 進負端），整圈都是 block rate。
 *   - 圖內數學一律 LaTeX（docs/teaching-style.md §3，使用者要求 2026-10-11）：雙引號標籤裡的公式寫 `$...$`，文字照常寫；
 *     `Mermaid` 元件會用 KaTeX 排版。原始碼用 String.raw（反斜線只寫一次）；標籤內不用兩個連續的反斜線（Mermaid 會收成一個），
 *     換行用 <br/>；比較符號寫 \lt、\gt、\le、\ge（標籤內不放 ASCII 的 < >）。暫存器名稱用 \mathtt{REG\_…}。
 *     含公式的標籤，KaTeX 不會自動換行：每一行都手動用 <br/> 斷在 20–26 個全形字寬以內（LR 的圖更短）。
 *   - 上文提到的 Unicode 拼法（z⁻ᴰ、σ_v、ΩD…）只出現在這段說明裡，標籤裡一律是 `$z^{-D}$`、`$\sigma_v$`、`$\Omega D$`。
 *   - 加法點與正號一律用全形「＋」，或寫在公式裡（`$+a$`）：Mermaid 11 會把每個標籤當 Markdown 解析，只有一個 ASCII「+」（或以「+ 」「- 」「1. 」開頭）的標籤
 *     會被當成清單，畫面上變成「Unsupported markdown: list」。diagrams.test.tsx 用真正的 render 檢查這件事。
 *   - 走圖的文字用顏色與方塊名稱指路（不用「上面／下面」）：方塊的實際位置由 Mermaid 的排版決定。
 *   - 排版：桌機（視窗 1280 px）的內文欄位約 900 px，圖會等比縮小放進欄位、最多縮到 0.7 倍，所以自然寬度要在約 1260 px 以內
 *     （`node scripts/diagram-audit.mjs --routes /ch/07` 的「超出」為 0），越接近 900 px 字越大。
 *     「兩路相乘」、流程類（6 個以上的方塊串在一起）、含回授迴圈與一個輸入分成很多支路的圖（平均迴路、梯度、RTL 位置圖）用 flowchart TB——
 *     左右排列會超過 1260 px，縮進欄位後字太小；結構簡單的硬體圖（delay line、二次差分、Type-II 迴路、成本階梯）維持左右排列。
 *     判斷節點用六角形 {{ }}，菱形太佔空間。diagrams.test.tsx 用 dagre 的層數估計形狀（TB 最寬一層 ≤ 5 個節點）。
 *   - 顏色：focus（藍）＝這張圖要看的方塊；ok（綠）＝極性正確的結果；warn（紅）＝會出錯的地方。三色在深淺主題都看得清楚。
 */

import type { SystemBlock } from '@/components'

const r = String.raw

const CLASS_DEFS = [
  '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px',
  '  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px',
  '  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px',
]

const chart = (lines: string[]): string => [...lines, ...CLASS_DEFS].join('\n')

/**
 * §7.1：問題出在哪裡——comparator 看到的是 u（經過 H），GMAC 乘的卻是 code；本章在 code 這一側加一個延遲。
 * comparator 的輸入線標「PD 的輸出」：e_PD 就是系統地圖上 PD → loop filter 那條線上的訊號（docs/assumptions.md §2a 第 3 點）。
 */
export const CHART_SIGNAL_MODEL = chart([
  'flowchart TB',
  r`  X(["code $x[n]$"]) --> H["PLL 誤差路徑 $H$<br/>增益 $|H|$、相位 $\phi$"]`,
  r`  X --> DLY["延遲 $D$ 個 sample<br/>$z^{-D}$"]`,
  r`  H -- "$u[n]$" --> GE["乘上剩餘 gain 誤差<br/>$\delta = a - w$"]`,
  r`  GE -- "$+\delta\cdot u[n]$" --> S(("＋"))`,
  r`  V(["comparator 前的雜訊<br/>$v[n]$，標準差 $\sigma_v$"]) -- "$+v[n]$" --> S`,
  r`  S -- "PD 的輸出<br/>$e_{\mathrm{PD}}[n] = \delta\cdot u[n] + v[n]$" --> CMP["1-bit comparator<br/>$q = \mathrm{sign}(e_{\mathrm{PD}})$"]`,
  r`  CMP -- "$q[n]$" --> M(("$\times$"))`,
  r`  DLY -- "$x[n-D]$" --> M`,
  r`  M --> AVG["一個 block 取平均<br/>$G_k = \tfrac{1}{N}\sum q[n]\cdot x[n-D]$"]`,
  '  class H warn',
  '  class DLY focus',
])

/** §7.1：單頻的相位記帳——誤差路徑加 φ、延遲 code 減 ΩD，GMAC 只留下兩路的相位差 θ = φ + ΩD。 */
export const CHART_PHASE_BOOKKEEPING = chart([
  'flowchart TB',
  r`  T(["單頻 code：相位 $\Omega n$"]) --> H["誤差路徑 $H$：相位加 $\phi$<br/>例：$\phi = -120^\circ$"]`,
  r`  T --> D["延遲 $D$ 個 sample：相位減 $\Omega D$<br/>例：$D = 4$，$\Omega D = 120^\circ$"]`,
  r`  H -- "$u$：$\Omega n + \phi$" --> M["相乘再平均，只留下兩路的相位差<br/>殘餘相位 $\theta = \phi + \Omega D$<br/>例：$-120^\circ + 120^\circ = 0^\circ$"]`,
  r`  D -- "$x[n-D]$：$\Omega n - \Omega D$" --> M`,
  r`  M --> Q{{"$|\theta| \lt 90^\circ$？"}}`,
  r`  Q -- "是" --> POS["$C_D \gt 0$<br/>往對的方向修"]`,
  r`  Q -- "否" --> NEG["$C_D \le 0$<br/>沒有恢復力，或反向更新"]`,
  '  class D focus',
  '  class POS ok',
  '  class NEG warn',
])

/**
 * §7.1：平均後的校正迴路（block rate k）——comparator、乘法器、平均器合起來平均而言是一個增益 K_q·C。
 * δ_k = a − w_k、E[G_k] ≈ K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ δ_{k+1} = (1 − μ·K_q·C)·δ_k：一圈的增益 g = μ·K_q·C，pole p = 1 − g。
 * 連線上的 E[G_k] 寫 \approx（小訊號線性化的平均值，和圖下方的走圖文字、F-07.11、Ch04／Ch06 的同一張圖一致），不寫等號。
 * 上下排列：左右排列時四段連線標籤把圖撐到約 1200 px 寬（桌機縮成 0.7 倍），改成直向之後回授線走右側，字級維持 15 px。
 */
export const CHART_MEAN_LOOP = chart([
  'flowchart TB',
  r`  A(["DTC 真正的<br/>gain $a$"]) -- "$+a$" --> S(("＋"))`,
  r`  S -- "$\delta_k = a - w_k$" --> KC["comparator、乘法器、<br/>平均器<br/>平均而言：乘上<br/>$K_q\cdot C$"]`,
  r`  KC -- "$E[G_k] \approx K_q\cdot C\cdot\delta_k$" --> MU["乘上 learning rate<br/>$\mu$"]`,
  r`  MU -- "$\mu\cdot G_k$" --> ACC["累加器 $\tfrac{1}{z-1}$<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]`,
  r`  ACC -- "$-w_k$" --> S`,
  '  class KC focus',
])

/** §7.2：推導 C_D 的關鍵——乘法器把兩個同頻 cos 變成「常數項 + 兩倍頻項」，平均器只留下常數項。 */
export const CHART_MIXER_AVERAGE = chart([
  'flowchart TB',
  r`  XD(["$x[n-D] = A\cdot\cos(\Omega n - \Omega D)$"]) --> M(("$\times$"))`,
  r`  U(["$u[n] = A\cdot|H|\cdot\cos(\Omega n + \phi)$"]) --> M`,
  r`  M -- "積化和差" --> DC["不隨 $n$ 變的項<br/>$\tfrac{A^2|H|}{2}\cdot\cos(\phi + \Omega D)$"]`,
  r`  M -- "積化和差" --> HF["兩倍頻的項<br/>$\tfrac{A^2|H|}{2}\cdot\cos(2\Omega n + \phi - \Omega D)$"]`,
  r`  DC -- "原封不動" --> AVG["長時間平均 $E[\cdot]$<br/>GMAC 的累加"]`,
  r`  HF -- "正負抵消成 $0$" --> AVG`,
  r`  AVG --> C(["$C_D = \tfrac{A^2}{2}\cdot|H|\cdot\cos(\phi + \Omega D)$"])`,
  '  class DC focus',
])

/** §7.2：同一個 z⁻ᴰ 放在 code 側或 comparator 側——ΩD 的符號相反。 */
export const CHART_DELAY_SIDE = chart([
  'flowchart LR',
  // 兩個互不相連的框：父圖用 LR、框內也明寫 direction LR，兩個框才會上下疊（各自由左到右）。
  // Mermaid 把同一層互不相連的框排成「後宣告的在前」，所以先宣告 B、再宣告 A，畫面上 A 在上面（diagrams.test.tsx 會檢查）。
  '  subgraph SIDE_ERR["做法 B：延遲 comparator 輸出"]',
  '    direction LR',
  r`    QB(["$q[n]$"]) --> DB["$z^{-D}$"]`,
  r`    DB -- "$q[n-D]$" --> MB(("$\times$"))`,
  r`    XB(["$x[n]$"]) --> MB`,
  r`    MB --> RB["殘餘相位 $\phi - \Omega D$<br/>適合超前的誤差路徑<br/>（$\phi \gt 0$）"]`,
  '  end',
  '  subgraph SIDE_CODE["做法 A：延遲 code（本站的 $D$）"]',
  '    direction LR',
  r`    XA(["$x[n]$"]) --> DA["$z^{-D}$"]`,
  r`    DA -- "$x[n-D]$" --> MA(("$\times$"))`,
  r`    QA(["$q[n]$"]) --> MA`,
  r`    MA --> RA["殘餘相位 $\phi + \Omega D$<br/>適合落後的誤差路徑<br/>（$\phi \lt 0$）"]`,
  '  end',
  '  class DA,DB focus',
])

/**
 * §7.2（邊界情況 2，F-07.6）：只平均一個 block 的 N 個 sample（n = n₀ … n₀+N−1）——和 CHART_MIXER_AVERAGE 只差兩倍頻那一路：
 * (1/N)Σ cos(2Ωn + ψ) = cos(2Ω·n_c + ψ)·sin(NΩ)/(N·sin Ω)，n_c = n₀ + (N−1)/2 是 block 的中點；長時間平均時這個比例趨近 0。
 */
export const CHART_BLOCK_AVERAGE = chart([
  'flowchart TB',
  r`  P(["乘法器輸出 $x[n-D]\cdot u[n]$<br/>第 $k$ 個 block：$n = n_0, \ldots, n_0 + N - 1$"]) --> DC["不隨 $n$ 變的項<br/>$\tfrac{A^2|H|}{2}\cdot\cos(\phi + \Omega D)$"]`,
  r`  P --> HF["兩倍頻的項<br/>$\tfrac{A^2|H|}{2}\cdot\cos(2\Omega n + \phi - \Omega D)$"]`,
  r`  DC -- "原封不動" --> AVG["只平均 $N$ 個 sample<br/>$\tfrac{1}{N}\sum$"]`,
  r`  HF -- "$n$ 換成 block 的中點 $n_0 + \tfrac{N-1}{2}$<br/>再乘上 $\tfrac{\sin(N\Omega)}{N\cdot\sin\Omega}$" --> AVG`,
  '  AVG --> G(["這一個 block 的相關<br/>常數項 + ripple"])',
  '  class DC focus',
  '  class HF warn',
])

/** §7.3：delay line + tap MUX——每多一級 register，相位多落後 Ω（線性相位）。圖上畫 4 級。 */
export const CHART_DELAY_LINE = chart([
  'flowchart LR',
  r`  X(["$x[n]$"]) --> R1["$z^{-1}$"]`,
  r`  R1 --> R2["$z^{-1}$"]`,
  r`  R2 --> R3["$z^{-1}$"]`,
  r`  R3 --> R4["$z^{-1}$"]`,
  r`  X -- "相位 $0$" --> MUX{{"tap MUX<br/>$\mathtt{REG\_GMAC\_DLY} = D$"}}`,
  r`  R1 -- "$-\Omega$" --> MUX`,
  r`  R2 -- "$-2\Omega$" --> MUX`,
  r`  R3 -- "$-3\Omega$" --> MUX`,
  r`  R4 -- "$-4\Omega$" --> MUX`,
  r`  MUX -- "$x[n-D]$" --> GMAC(["GMAC"])`,
  '  class R1,R2,R3,R4,MUX focus',
])

/** §7.3：同一個 D 對兩個頻率——對準 tone 1 之後，tone 2 的殘餘相位是 (Ω₂ − Ω₁)·D。 */
export const CHART_TWO_TONES = chart([
  'flowchart TB',
  r`  subgraph TONE1["tone 1：$\Omega_1 = 30^\circ$/sample（對準的頻率）"]`,
  r`    A1["誤差路徑：<br/>$\phi_1 = -120^\circ$"] --> B1["同一條 delay line，$D = 4$<br/>$\Omega_1 D = 120^\circ$"]`,
  r`    B1 --> C1["$\theta_1 = \phi_1 + \Omega_1 D = 0^\circ$<br/>$\cos\theta_1 = +1$"]`,
  '  end',
  r`  subgraph TONE2["tone 2：$\Omega_2 = 60^\circ$/sample"]`,
  r`    A2["誤差路徑：$\phi_2 = -120^\circ$<br/>（假設相同）"] --> B2["同一條 delay line，$D = 4$<br/>$\Omega_2 D = 240^\circ$"]`,
  r`    B2 --> C2["$\theta_2 = \phi_2 + \Omega_2 D = +120^\circ$<br/>$\cos\theta_2 = -0.5$"]`,
  '  end',
  r`  C1 -- "正票" --> SUM["$C_D = \sum_i \tfrac{A_i^2}{2}\cdot|H_i|\cdot\cos\theta_i$"]`,
  '  C2 -- "負票" --> SUM',
  '  class B1,B2 focus',
  '  class C1 ok',
  '  class C2 warn',
])

/** §7.3：多頻／寬頻 code 的 C_D——每個頻率依 S_xx·|H| 加權投票，票的正負由 cos(φ + ΩD) 決定。 */
export const CHART_VOTING = chart([
  'flowchart TB',
  r`  WGT["這一票有多重<br/>code 功率 $S_{xx}(\Omega)$<br/>乘上 $|H(\Omega)|$"] --> PROD(("$\times$"))`,
  r`  SGN["這一票是正是負<br/>$\cos(\phi(\Omega) + \Omega D)$"] --> PROD`,
  r`  PROD -- "一個頻率的票" --> SUM["所有頻率加總<br/>$C_D = \sum_i$ 或 $\tfrac{1}{2\pi}\int d\Omega$"]`,
  r`  SUM --> Q{{"$C_D \gt 0$？"}}`,
  r`  Q -- "是" --> P1["$p = 1 - \mu\cdot K_q\cdot C_D \lt 1$<br/>方向正確"]`,
  r`  Q -- "否" --> P2["$p \ge 1$<br/>漂移或發散"]`,
  '  class SGN focus',
  '  class P1 ok',
  '  class P2 warn',
])

/**
 * §7.4：同一個 e_PD 乘 u 還是乘 x——真正的梯度乘的是 u（E[u²] ≥ 0），raw-x 乘的是 x（C 可正可負）。
 * 上下排列：左右排列時 e_PD 到兩個乘法器的連線會交叉。宣告順序是排版的一部分：先宣告 H → MU（u 直接走到「乘 u」的乘法器），
 * dagre 才會把這條長線排在最左、(a − w) 與雜訊的那一串在中間、x 的長線在最右，e_PD 分出的兩條線不會與任何線交叉。
 */
export const CHART_GRADIENT = chart([
  'flowchart TB',
  r`  X(["$x[n]$"]) --> H["誤差路徑 $h$"]`,
  r`  H -- "$u[n]$" --> MU(("$\times$"))`,
  r`  H -- "$u[n]$" --> GE["乘上 $(a - w)$"]`,
  '  GE -- "＋" --> S(("＋"))',
  r`  V(["$v[n]$"]) -- "＋" --> S`,
  r`  S -- "$e_{\mathrm{PD}}[n]$" --> MU`,
  r`  MU -- "$-dJ/dw$：真正的梯度" --> RU["平均：<br/>$(a - w)\cdot E[u^2]$<br/>$E[u^2] \ge 0$，<br/>方向永遠正確"]`,
  r`  S -- "$e_{\mathrm{PD}}[n]$" --> MX(("$\times$"))`,
  r`  X -- "$x[n]$" --> MX`,
  r`  MX -- "乘的是 $x$：raw-x" --> RX["平均：<br/>$(a - w)\cdot C$，$C = E[x\cdot u]$<br/>$C$ 可正可負"]`,
  '  class RU ok',
  '  class RX warn',
])

/** §7.4：三種 regressor 並排——同一個乘法器與 q[n]，只差 x_ref 從哪裡來（藍色是多出來的方塊）。 */
export const CHART_THREE_REGRESSORS = chart([
  'flowchart LR',
  // 三個互不相連的框上下疊、各自由左到右（做法同 CHART_DELAY_SIDE）：先宣告 C、最後宣告 A，畫面上由上到下是 A、B、C。
  '  subgraph ARCH_FX["C：filtered-x（補一個模型）"]',
  '    direction LR',
  r`    XC(["$x[n]$"]) --> HC["模型 $\hat H$<br/>$u_f = \hat h * x$"]`,
  r`    HC -- "$x_{\mathrm{ref}} = u_f[n]$" --> MC(("$\times$"))`,
  r`    QC(["$q[n]$"]) --> MC`,
  r`    MC --> GC["相關 $E[u\cdot u_f]$<br/>每個頻率都補上<br/>$\angle\hat H$"]`,
  '  end',
  '  subgraph ARCH_DLY["B：delayed-x（補一個延遲）"]',
  '    direction LR',
  r`    XB(["$x[n]$"]) --> DB["$z^{-D}$<br/>$D$ 級 shift register"]`,
  r`    DB -- "$x_{\mathrm{ref}} = x[n-D]$" --> MB(("$\times$"))`,
  r`    QB(["$q[n]$"]) --> MB`,
  r`    MB --> GB["相關<br/>$C_D = E[x[n-D]\cdot u]$<br/>只補一條直線 $\Omega D$"]`,
  '  end',
  '  subgraph ARCH_RAW["A：raw-x（不補償）"]',
  '    direction LR',
  r`    XA(["$x[n]$"]) -- "$x_{\mathrm{ref}} = x[n]$" --> MA(("$\times$"))`,
  r`    QA(["$q[n]$"]) --> MA`,
  r`    MA --> GA["相關 $C = E[x\cdot u]$<br/>相位 $\phi$ 原封不動"]`,
  '  end',
  '  class DB,HC focus',
])

/**
 * §7.4：filtered-x 的閉迴路（F-07.10）——sample rate n 的相乘、block rate k 的平均與累加，w_k 送回 reference 端的 DTC（校正迴路的回授）。
 * 真實路徑 P 是「reference 端的 DTC → PD」：它的輸出就是 PD 的輸出 e_PD，comparator 的輸入線從這裡拉（docs/assumptions.md §2a 第 3 點）。
 * P 裡的式子寫「≈」（F-06.1）：這張圖是 w_k 每個 block 都在更新的閉迴路，真實電路先乘 (a − w_k) 再經過 h，只有 w 在 h 的記憶長度內近似不變時
 * 才能把 (a − w_k) 提到卷積外面。w 凍結的圖（CHART_SIGNAL_MODEL、CHART_GRADIENT、CHART_TYPE2_LOOP）維持等號；CHART_RTL_REGRESSORS 本來就照真實順序畫。
 * 宣告順序是排版的一部分：P 先單獨宣告，dagre 打斷迴圈時才會反轉回授線（ACC → P）而不是 q[n] 那條；
 * 再先連 X → HAT、後連 X → P，模型那一支排在左邊，w_k 回授線從最右側繞回 P，不會穿過模型那一支。
 */
export const CHART_FX_LOOP = chart([
  'flowchart TB',
  r`  P["真實路徑：reference 端的 DTC 到 PD<br/>PD 的輸出（含雜訊）<br/>$e_{\mathrm{PD}}[n] \approx (a - w_k)\cdot(h * x)[n] + v[n]$"]`,
  r`  X(["code $x[n]$"]) --> HAT["模型 $\hat H$<br/>$u_f = \hat h * x$"]`,
  '  X --> P',
  r`  P -- "PD 的輸出 $e_{\mathrm{PD}}[n]$" --> CMP["comparator<br/>$q = \mathrm{sign}(e_{\mathrm{PD}})$"]`,
  r`  HAT --> DL["$z^{-D}$"]`,
  r`  CMP -- "$q[n]$" --> M(("$\times$"))`,
  r`  DL -- "$u_f[n-D]$" --> M`,
  r`  M -- "每個 sample $n$" --> AVG["block 平均<br/>$G_k = \tfrac{1}{N}\sum q[n]\cdot u_f[n-D]$"]`,
  r`  AVG -- "每個 block $k$" --> ACC["乘上 $\mu$ 再累加，$\tfrac{1}{z-1}$<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]`,
  r`  ACC -- "$w_k$ 送回 DTC（負回授：$a - w_k$）" --> P`,
  '  class HAT focus',
])

/** §7.4：正規化相關 ρ 怎麼算、怎麼讀——符號是極性，大小是效率。 */
export const CHART_RHO_READING = chart([
  'flowchart LR',
  r`  N1["分子 $E[x_{\mathrm{ref}}\cdot u]$<br/>regressor 和 $u$<br/>有多同步"] --> R["$\rho_{\mathrm{ref}}$ = 分子 $\div$ 分母<br/>範圍 $-1$ 到 $+1$"]`,
  r`  N2["分母 $\sqrt{E[x_{\mathrm{ref}}^2]\cdot E[u^2]}$<br/>兩個訊號各自的大小"] --> R`,
  r`  R --> SG["看符號<br/>$\rho \gt 0$ 方向正確，<br/>$\rho \lt 0$ 反向更新"]`,
  r`  R --> MG["看大小<br/>$\sigma_w \propto \tfrac{1}{\sqrt{N}\cdot|\rho|}$<br/>$N$ 要補 $1/\rho^2$ 倍"]`,
  '  class R focus',
])

/** §7.5：模型誤差——GMAC 等效在算 E[u·u_f]；每個頻率的票是 S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)（F-07.12）。 */
export const CHART_MISMATCH = chart([
  'flowchart TB',
  r`  X(["code $x[n]$"]) --> H["真實誤差路徑 $H$<br/>在 PLL 裡，拿不到"]`,
  r`  X --> HAT["模型 $\hat H$<br/>設計者寫進 RTL"]`,
  r`  H -- "$u[n]$，藏在 $q[n]$ 裡" --> COR["GMAC 等效在算 $E[u\cdot u_f]$<br/>每個頻率一票：<br/>$S_{xx}\cdot|H|\cdot|\hat H|\cdot\cos(\angle H - \angle\hat H)$"]`,
  r`  HAT -- "$u_f[n]$" --> COR`,
  r`  COR --> Q{{"有 code 能量的頻率上<br/>$|\angle H - \angle\hat H| \lt 90^\circ$？"}}`,
  r`  Q -- "都成立" --> POS["$E[u\cdot u_f] \gt 0$<br/>$p_f \lt 1$"]`,
  '  Q -- "有些不成立" --> NEG["那些頻率投負票<br/>總和可能變號"]',
  '  class HAT focus',
  '  class POS ok',
  '  class NEG warn',
])

/** §7.5：失效例子 Ĥ = H·z^−Δ——模型多算的 latency 變成相位差 ΩΔ。 */
export const CHART_LATENCY_MISMATCH = chart([
  'flowchart TB',
  r`  X(["單頻 code：相位 $\Omega n$"]) --> H["真實路徑 $H$<br/>相位加 $\phi$"]`,
  r`  X --> HM["模型裡的 $H$<br/>相位加 $\phi$"]`,
  r`  HM --> DL["模型多算的 latency $z^{-\Delta}$<br/>相位減 $\Omega\Delta$"]`,
  r`  H -- "$u$：$\Omega n + \phi$" --> COR["相乘再平均，只留下相位差<br/>$\angle H - \angle\hat H = \Omega\Delta$"]`,
  r`  DL -- "$u_f$：$\Omega n + \phi - \Omega\Delta$" --> COR`,
  r`  COR --> R["$E[u\cdot u_f] = |H|^2\cdot\cos(\Omega\Delta)$（unit power）<br/>例：$\Omega = 30^\circ$、$\Delta = 4$<br/>$\cos 120^\circ = -0.5$，反向更新"]`,
  '  class DL,R warn',
])

/** §7.5：二次差分 regressor 的硬體——兩個暫存器、一個左移、一個三輸入加法（F-07.14）。 */
export const CHART_SECOND_DIFF = chart([
  'flowchart LR',
  r`  X(["$x[n]$"]) --> R1["$z^{-1}$"]`,
  r`  R1 -- "$x[n-1]$" --> R2["$z^{-1}$"]`,
  r`  X -- "$+x[n]$" --> S(("＋"))`,
  r`  R1 -- "$x[n-1]$" --> SH["乘 $2$<br/>左移 $1$ bit"]`,
  r`  SH -- "$-2x[n-1]$" --> S`,
  r`  R2 -- "$+x[n-2]$" --> S`,
  r`  S --> K["乘上 $K_2$<br/>可併入 $\mu$"]`,
  r`  K --> O(["$x_{\mathrm{ref}}[n] = K_2\cdot(x[n] - 2x[n-1] + x[n-2])$"])`,
  '  class R1,R2,SH,S focus',
])

/**
 * §7.5：E44 的 DT Type-II DPLL——開迴路 L(z) 是三個藍色方塊的乘積；PD 的輸出 (a − w)·u 除以輸入 (a − w)·x 就是 H_PD = 1/(1 + L)。
 * 圓圈就是 PD（線性化之後是一個減法點，docs/assumptions.md §2a 第 5 點）：DTC 在 reference 輸入端，它留下的 gain 誤差從 PD 的 reference 輸入（正端）進來，
 * 回授（DCO 經 divider 回到 PD；以時間為單位時 divider 的增益是 1，不另外畫方塊，回授線上標「divider 的回授」，和 Ch06 的線性化迴路圖說法相同）從負端進來。
 * PD 的輸出分成兩條線：送進 loop filter，以及給 comparator——同一個節點。
 */
export const CHART_TYPE2_LOOP = chart([
  'flowchart LR',
  r`  E(["reference 端：<br/>DTC 的 gain 誤差<br/>$(a - w)\cdot x[n]$"]) -- "＋" --> S(("PD"))`,
  r`  S -- "$(a - w)\cdot u[n]$" --> PI["PI loop filter<br/>$K_p + \tfrac{K_i}{1 - z^{-1}}$"]`,
  r`  PI --> DCO["DCO 積分器<br/>$\tfrac{1}{1 - z^{-1}}$"]`,
  r`  DCO --> DL["迴路延遲<br/>$z^{-(1+d)}$"]`,
  r`  DL -- "divider 的回授，$-$" --> S`,
  r`  S -- "$(a - w)\cdot u[n]$" --> OUT(["同一個 PD 輸出<br/>也給 comparator<br/>再加上雜訊 $v[n]$"])`,
  '  class PI,DCO,DL focus',
])

/**
 * §7.6：四種 regressor 在 RTL 中的位置（原有的圖；標籤改成與公式相同的寫法）。
 * 主路徑：reference 端的 DTC 留下 (a − w_k)·x[n]，經 H_PD 並加上 v[n] 成為 PD 的輸出 e_PD[n]（F-07.1）；comparator 的輸入線從 PD 的輸出拉
 * （docs/assumptions.md §2a 第 3 點）；GMAC 與更新式是 F-07.10，w_k 送回 DTC。
 * 上下排列：code 一次分出五條支路（DTC 一條、四種 regressor 四條）並排，再收進 REG_GMAC_XSEL 與 GMAC（左右排列的自然寬度 1776 px，桌機要橫向捲動）。
 */
export const CHART_RTL_REGRESSORS = chart([
  'flowchart TB',
  r`  X(["code $x[n]$<br/>DSM 或 training tone"]) --> DTC["reference 端的 DTC<br/>真正的 gain $a$<br/>校正係數 $w_k$"]`,
  r`  DTC -- "$(a - w_k)\cdot x[n]$" --> H["PLL 誤差路徑 $H_{\mathrm{PD}}$<br/>再加上雜訊 $v[n]$"]`,
  r`  H -- "PD 的輸出<br/>$e_{\mathrm{PD}}[n]$" --> CMP["1-bit comparator<br/>$q = \mathrm{sign}(e_{\mathrm{PD}})$"]`,
  '  X --> R0["raw：直接接線"]',
  r`  X --> SR["shift register<br/>$z^{-1}\times D_{\max}$"]`,
  r`  SR --> MUX{{"tap MUX<br/>$\mathtt{REG\_GMAC\_DLY} = D$"}}`,
  r`  X --> HF["模型 $\hat H$：FIR 或 IIR<br/>$u_f = \hat h * x$"]`,
  r`  HF --> SR2["$z^{-D}$"]`,
  r`  X --> SD["二次差分<br/>$K_2\cdot(x[n] - 2x[n-1] + x[n-2])$"]`,
  r`  R0 -- "$x[n]$" --> SEL{{"$\mathtt{REG\_GMAC\_XSEL}$<br/>四選一"}}`,
  r`  MUX -- "$x[n-D]$" --> SEL`,
  r`  SR2 -- "$u_f[n-D]$" --> SEL`,
  '  SD --> SEL',
  r`  SEL -- "$x_{\mathrm{ref}}[n]$" --> GMAC["GMAC<br/>$G_k = \tfrac{1}{N}\sum q[n]\cdot x_{\mathrm{ref}}[n]$"]`,
  r`  CMP -- "$q[n]$" --> GMAC`,
  r`  GMAC -- "每個 block $k$" --> UPD["累加器<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]`,
  r`  UPD -- "$w_k$" --> DTC`,
  '  class SEL focus',
])

/** §7.6：硬體成本階梯——每往後一階，額外硬體與需要事先知道的東西越來越多，能處理的 code 也越廣。 */
export const CHART_COST_LADDER = chart([
  'flowchart LR',
  r`  L0["第 0 階：raw-x<br/>額外硬體：無<br/>要知道：無<br/>有效：code 頻帶上<br/>$|\angle H| \lt 90^\circ$"]`,
  r`  L1["第 1 階：二次差分<br/>額外硬體：<br/>$2\times B$ 個 flip-flop、<br/>2 個加法器、1 個左移<br/>要知道：迴路是 Type-II<br/>有效：窄頻、低頻的 tone"]`,
  r`  L2["第 2 階：delayed-x<br/>額外硬體：<br/>$D_{\max}\times B$ 個 flip-flop、<br/>tap MUX<br/>要知道：$\phi(\Omega_0)$<br/>有效：窄頻 code，<br/>只對準一個頻率"]`,
  r`  L3["第 3 階：filtered-x<br/>額外硬體：<br/>$L_{\mathrm{FIR}}$ 個乘法器加 adder tree，<br/>或 2 階 IIR<br/>要知道：$\hat H$（$\omega_n$、<br/>$\zeta$、latency、$K_{\mathrm{DCO}}$）<br/>有效：任何 code，只要<br/>相位誤差 $\lt 90^\circ$"]`,
  '  L0 --> L1',
  '  L1 --> L2',
  '  L2 --> L3',
  '  class L3 focus',
])

/** §7.6：決策流程——我需要哪一種修法？先看 C 的符號，再看 code 是不是窄頻，最後才上 filtered-x。 */
export const CHART_DECISION = chart([
  'flowchart TB',
  r`  A(["先量或先算 raw-x 的相關 $C = E[x\cdot u]$<br/>bring-up：GMAC 斜率 $S \approx -K_q\cdot C$"]) --> Q1{{"$C \gt 0$，而且 $\rho$ 夠大？"}}`,
  '  Q1 -- "是" --> RAW["用 raw-x<br/>不需要補償"]',
  '  Q1 -- "否" --> Q2{{"code 是窄頻嗎？<br/>training tone、單一主譜線"}}',
  r`  Q2 -- "是" --> Q3{{"Type-II 迴路，而且<br/>$\Omega$ 低於 F-07.15 的邊界？"}}`,
  r`  Q3 -- "是" --> SD["二次差分<br/>$K_2\cdot(1 - z^{-1})^2$"]`,
  r`  Q3 -- "否" --> DX["delayed-x<br/>$D \approx \tfrac{(-\phi) \bmod 2\pi}{\Omega}$<br/>FCW、PVT 一變就要重找"]`,
  r`  Q2 -- "否：寬頻、DSM code" --> FX["filtered-x<br/>$u_f = \hat h * x$"]`,
  r`  FX --> Q4{{"$E[u\cdot u_f] \gt 0$？<br/>充分條件：激勵頻帶上<br/>$|\angle H - \angle\hat H| \lt 90^\circ$"}}`,
  r`  Q4 -- "是" --> DONE["完成<br/>$p_f = 1 - \mu\cdot K_q\cdot E[u\cdot u_f]$"]`,
  r`  Q4 -- "否" --> FIX["修模型 $\hat H$<br/>先查 latency（E45）"]`,
  '  FIX --> FX',
  '  class RAW,SD,DX,DONE ok',
  '  class FX focus',
  '  class FIX warn',
])

/**
 * §7.7：綜合手算 HC-07.8 的計算順序（①…⑨ 與手算題的步驟順序相同）。
 * `C1 ---> P3` 的長連線（三個 `-`）只是排版提示：把 ④ 留在上一層，⑥ → ⑨ 的連線就不會從 ④ 的角落穿過去。
 */
export const CHART_HANDCALC_FLOW = chart([
  'flowchart TB',
  r`  IN(["已知：$|H|$、$\phi$、$\Omega$、$D$、$\mu$、$\sigma_v$<br/>（unit power：$A^2/2 = 1$）"])`,
  r`  IN --> A1["① raw-x<br/>$C_{\mathrm{raw}} = |H|\cdot\cos\phi$"]`,
  r`  IN --> B1["② delayed-x 的殘餘相位<br/>$\theta = \mathrm{wrap}(\phi + \Omega D)$"]`,
  r`  B1 --> B2["③ $C_D = |H|\cdot\cos\theta$"]`,
  r`  IN --> C1["④ filtered-x（$\hat H = H$）<br/>$E[u^2] = |H|^2$"]`,
  r`  IN --> K1["⑤ $K_q = \tfrac{\sqrt{2/\pi}}{\sigma_v}$"]`,
  r`  K1 --> K2["⑥ $\mu\cdot K_q$"]`,
  r`  A1 --> P1["⑦ $p_{\mathrm{raw}} = 1 - \mu\cdot K_q\cdot C_{\mathrm{raw}}$"]`,
  r`  B2 --> P2["⑧ $p_D = 1 - \mu\cdot K_q\cdot C_D$"]`,
  r`  C1 ---> P3["⑨ $p_f = 1 - \mu\cdot K_q\cdot E[u^2]$"]`,
  '  K2 --> P1',
  '  K2 --> P2',
  '  K2 --> P3',
  r`  P1 --> J["判讀每個 pole<br/>$|p| \lt 1$ 收斂；$p \gt 1$ 反向更新"]`,
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
  r`  W1(["把 $w$ 固定在 $w_0 + \Delta w$"]) --> GP["讀 GMAC 的平均<br/>$G_+ = E[G_k]$"]`,
  r`  W2(["把 $w$ 固定在 $w_0 - \Delta w$"]) --> GM["讀 GMAC 的平均<br/>$G_- = E[G_k]$"]`,
  r`  GP --> SL["斜率 $S = \tfrac{G_+ - G_-}{2\Delta w}$<br/>$\approx -K_q\cdot C$"]`,
  '  GM --> SL',
  r`  SL --> Q{{"$S \lt 0$？"}}`,
  r`  Q -- "是" --> OK["$C \gt 0$：極性正確<br/>可以閉迴路"]`,
  r`  Q -- "否" --> BAD["$C \le 0$：極性錯誤<br/>改用 delayed-x、filtered-x<br/>（7.6 節的決策流程）"]`,
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
