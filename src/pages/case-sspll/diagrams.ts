import type { SystemBlock } from '@/components'

/**
 * 案例頁 /case/sspll 的方塊圖（docs/teaching-style.md §8）。
 *
 * - 每張圖的 Mermaid 原始碼都是具名匯出的字串；diagrams.test.tsx 以真正的 mermaid parser 逐一解析，並真的畫成 SVG。
 * - DIAGRAMS 的順序就是頁面上的順序；頁面用 common.tsx 的 <Diagram id="…" /> 以 id 查表，圖號「圖 CS-n」由順序自動產生。
 * - 圖上的訊號名稱、正負號與取樣率必須和正文公式一致：
 *     δ = 真值 − 估計（δ_g = a − w_g、δ_k = ε_k − w_k）；H_PD ≡ 1 時 w ← w + μ·q·r 為正確方向；
 *     e_PD = u − y、Y = L·E_PD ⇒ H_PD = 1/(1 + L)；[n] = 比較器 sample（每個 T_ref 一拍）、[k] = GMAC block（N 拍）；
 *     Γ_eff = H_PD·conj(G)；1/(z−1) = z⁻¹/(1 − z⁻¹)（積分器含 1 拍延遲）。
 * - 圖內的數學一律寫 LaTeX（使用者要求，2026-10-11）：節點與連線的「雙引號標籤」裡把數學放在 `$...$`，文字照常寫，
 *   由共用的 <Mermaid> 用 KaTeX 排版。所以每張圖的原始碼都用 `String.raw`（TeX 的反斜線只寫一次）；
 *   標籤內不寫 `\\`（Mermaid 會收成一個反斜線），換行用 `<br/>`；也不直接寫 `<`、`>`（用 `\lt`、`\gt`；
 *   Mermaid 的 strict 模式會把它們跳脫成 `&lt;`，KaTeX 就讀不懂）。大型運算子加 `\textstyle`，避免上下限被擠到符號的正上方與正下方。
 *   單位與名稱（fs、MHz、GMAC、Type-II…）照舊寫成文字。
 * - 注意 Mermaid 11 會把每個標籤當成 Markdown 解析：以 ASCII 的「+」「-」「*」或「1.」開頭的純文字標籤會被當成清單，畫面上變成
 *   「Unsupported markdown: list」。所以純符號的加法點與正負號一律用全形「＋」與 U+2212 的「−」，帶變數的連線標籤寫成 `$+\,x$`
 *   （diagrams.test.tsx 會真的把每張圖畫成 SVG 檢查）。
 */

/** 顏色（深淺主題都看得清楚）：focus＝本圖的主角、ok＝安全／推薦、warn＝反號／有害 */
const STYLE = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff`

/** 章首系統地圖要標成藍色的方塊：reference 輸入端的 DTC + 整個主 PLL 迴路（PD、loop filter、VCO、divider／PMUX）+ 小數累加器與 regressor + 比較器、對齊、GMAC */
export const MAP_FOCUS: SystemBlock[] = ['pd', 'lf', 'vco', 'div', 'dtc', 'dsm', 'res', 'cmp', 'align', 'gmac']

/** §0.1 一句話回答：誤差先被主迴路「吃過」才到比較器；regressor 的功率落在 Re H_PD < 0 的頻帶就反號 */
export const CHART_ANSWER = String.raw`flowchart TB
  U["注入的誤差 $u[n]$<br/>GOS + PHOS"] --> H["主 PLL 迴路<br/>$H_{PD} = 1/(1 + L)$"]
  H -->|"$e_{PD} = h_{PD} * u$"| CMP["1-bit 比較器<br/>$q = \mathrm{sign}(e_{PD} + v)$"]
  CMP -->|"$q[n] = \pm 1$"| X(("$\times$"))
  R["regressor $r_i[n]$<br/>DTC code、PMUX one-hot"] --> X
  X --> AVG["GMAC：一個 block 的平均<br/>即平均梯度"]
  AVG --> D{"regressor 的功率主要落在<br/>$\mathrm{Re}\,H_{PD} \lt 0$ 的頻帶？"}
  D -- "否" --> GOOD["梯度與誤差同向<br/>LMS 收斂"]
  D -- "是" --> BAD["梯度反向<br/>LMS 把權重推離真值"]
  class H focus
  class GOOD ok
  class BAD warn${STYLE}`

/** §1 本章路線圖：每一節回答哪一個問題 */
export const CHART_ROADMAP = String.raw`flowchart TB
  Q0["問題：GOS、PHOS 的 LMS 為什麼會反號？"] --> S2["§2 架構<br/>誤差從哪裡注入、regressor 長什麼樣"]
  S2 --> S3["§3 誤差 $\to$ PD<br/>$H_{PD} = 1/(1 + L)$"]
  S3 --> S4["§4 LMS 的平均更新<br/>$C$ = regressor 功率 $\times\,\mathrm{Re}\,\Gamma$ 的加權和"]
  S4 --> S5["§5、§6 $\mathrm{Re}\,H_{PD}$ 在哪裡是負的<br/>Type-I、Type-II、CPPLL 的反號帶"]
  S5 --> S7["§7 GOS<br/>鋸齒 regressor"]
  S5 --> S8["§8 PHOS<br/>8 相 circulant 的模態"]
  S7 --> S9["§9 兩者一起看<br/>$9 \times 9$ 與 PSD 定理"]
  S8 --> S9
  S9 --> S10["§10 模擬證據<br/>小訊號、大訊號、閉迴路"]
  S9 --> S11["§11 對策<br/>1diff、filtered-x、P-only…"]
  S11 --> S12["§12 有限步長、<br/>§13 比較器 offset<br/>線性特徵值看不到的兩件事"]
  S10 --> S15["§14 自己跑閉迴路 LMS<br/>§15 checklist 與 keep-out"]
  S12 --> S15
  class S3,S4,S5 focus${STYLE}`

/**
 * §2 使用者的 SSPLL：feedback 端 8 相 PMUX（粗調）+ reference 端 input DTC（細調）+ 1-bit 比較器 + GMAC／LMS。
 * 架構照 docs/assumptions.md §2a：
 *   - 訊號路徑 REF → DTC → PD（SSPD）→ loop filter → VCO；回授路徑上只有 PMUX（VCO → PMUX → PD），DTC 不在回授路徑上。
 *   - DTC 只能延遲，所以它的延遲是「基準延遲 T_0 減掉補償量」；補償量 = (1 − a)(1 + w_g)·ρΔ ＋ PHOS 修正（數學與模型不變）。
 *   - PMUX 第 k 相的偏差 ε_k 以「早到」為正：和 ρΔ 一樣是「DTC 該補的量」，所以沒有迴路時 t_ref′ − t_fb = T_0 + u、u = ρΔ + ε_p − 補償量。
 *   - 校正迴路的輸入是 PD 的輸出 e_PD：圖上先畫出「PD 輸出」這個節點（E，藍色），loop filter 與 1-bit 比較器都從它分出去。
 *   - regressor 用一個標籤節點（XR）接進 GMAC，不從累加器拉一條長線過去——那條線會和 REF → DTC、LMS → DTC 交叉；
 *     所以節點上寫明它來自累加器（ρ[n] 與 p[n] 的 one-hot）。
 */
export const SSPLL_CHART = String.raw`flowchart TB
  ACC["分數累加器<br/>FCW $= N_{int} + \alpha$<br/>$\varphi[n] = \mathrm{frac}(n\alpha)$"] -->|"$\rho[n]$（細部殘差）"| DTC
  ACC -->|"$p[n]$（相位索引）"| PMUX
  REF["4 GHz reference"] --> DTC["input DTC（reference 端）<br/>延遲 $= T_0 -$ 補償量<br/>補償量 $= (1 - a)(1 + w_g)\cdot\rho\Delta$<br/>＋ PHOS 修正"]
  DTC -->|"reference edge<br/>$t_{ref}'$"| PD["SSPD（phase detector）<br/>相位比較點：量 $t_{ref}' - t_{fb}$"]
  VCO["VCO（$f_{vco}$）"] --> PMUX["8 相 PMUX（feedback 端）<br/>第 $k$ 相的 edge 比 $\tfrac{k}{8}\,T_{vco}$<br/>早到 $\varepsilon_k$"]
  PMUX -->|"feedback edge<br/>$t_{fb}$"| PD
  PD --> E(["PD 輸出 $e_{PD} = h_{PD} * u$"])
  E --> LF["loop filter／SSCP<br/>（$L_1$：P；$L_2$：P+I；<br/>$L_3$：$R + C_1 \parallel C_2$）"]
  LF --> VCO
  E -->|"同一個 $e_{PD}$"| CMP["1-bit 比較器<br/>$q = \mathrm{sign}(e_{PD} + v)$"]
  CMP --> GMAC["GMAC：$\textstyle\sum q\cdot r_i$<br/>（$N = 512$ sample 一個 block）"]
  XR(["regressor $x_i[n]$<br/>累加器的 $\rho[n]$ 與<br/>$p[n]$ 的 one-hot"]) --> GMAC
  GMAC --> LMS["sign-error LMS<br/>$w_g,\ w_0,\ \ldots,\ w_7$"]
  LMS --> DTC
  class E focus${STYLE}`

/**
 * §2 小數相位的拆法：累加器 φ[n] → ×8 → 整數部分 p[n]（PMUX 把 feedback edge 往後挪 p·Δ）與小數部分 ρ[n]（reference 端 DTC 的補償量 ρ·Δ）。
 * 連線的宣告順序會影響自動排版：「×8 → 加法點」要寫在「floor → PMUX」之前，加法點才會排在 PMUX 左邊，兩條線不交叉。
 */
export const CHART_PHASE_SPLIT = String.raw`flowchart TB
  A["FCW 的小數 $\alpha$"] -- "＋" --> S(("＋"))
  S --> F["取小數<br/>$\mathrm{frac}(\cdot)$"]
  F -->|"$\varphi[n] = \mathrm{frac}(n\alpha)$"| X8["$\times 8$"]
  F --> Z["$z^{-1}$"]
  Z -- "$+\,\varphi[n-1]$" --> S
  X8 -- "＋" --> D(("＋"))
  X8 -->|"$8\varphi[n]$，範圍 0 到 8"| FL["floor：取整數部分<br/>（累加器的高 3 位）"]
  FL -- "−" --> D
  FL -->|"$p[n] = 0, 1, \ldots, 7$"| PM["8 相 PMUX<br/>粗調：$p[n]\cdot\Delta$"]
  D -->|"$\rho[n] = 8\varphi[n] - p[n]$，範圍 0 到 1"| DTC["input DTC<br/>細調：補償量 $\rho[n]\cdot\Delta$"]
  FL --> OH["PHOS 的 regressor<br/>$x_{1+k}[n] = \mathbf{1}\{p[n] = k\}$"]
  D --> X0["GOS 的 regressor<br/>$x_0[n] = \rho[n]$"]
  class PM,DTC focus${STYLE}`

/** §2 兩個誤差的注入點：GOS（reference 端 DTC）與 PHOS（feedback 端 PMUX）在 PD 的輸入端（比較點）相加成 u[n]，PD 的輸出是它經過 H_PD 之後的 e_PD */
export const CHART_INJECTION = String.raw`flowchart TB
  RHO["$x_0[n] = \rho[n]$<br/>DTC code"] --> MG(("$\times$"))
  DG["$\delta_g\cdot\Delta = (a - w_g)\cdot\Delta$<br/>DTC 增益誤差 $-$ 估計"] --> MG
  OH["$x_{1+k}[n] = \mathbf{1}\{p[n] = k\}$<br/>PMUX 選到第 $k$ 相"] --> MP(("$\times$"))
  DK["$\delta_k = \varepsilon_k - w_k$<br/>第 $k$ 相偏差 $-$ 估計"] --> MP
  MG -- "$+\,e_{GOS}[n]$<br/>reference 端：DTC" --> SU(("＋"))
  MP -- "$+\,e_{PHOS}[n]$<br/>feedback 端：PMUX<br/>（8 相加總）" --> SU
  SU -->|"$u[n]$：比較點<br/>（PD 輸入端）的時間誤差"| H["主 PLL 迴路<br/>$H_{PD}(z) = 1/(1 + L(z))$"]
  H -->|"$e_{PD}[n] = (h_{PD} * u)[n]$"| OUT["PD 輸出<br/>→ loop filter 與 1-bit 比較器"]
  class H focus${STYLE}`

/** §3 迴路的回授結構：藍色的圓就是 PD（一個做減法的加法點：進來的兩條線各標正負號），e_PD = u − y（u 在 reference 輸入端、y 從 feedback 輸入端回來）、y = L·e_PD ⇒ H_PD = 1/(1 + L)；比較器取 PD 的輸出 */
export const CHART_HPD_LOOP = String.raw`flowchart LR
  U["外加誤差 $u[n]$<br/>GOS + PHOS<br/>（折算到 PD 的<br/>reference 輸入）"] -- "＋" --> S(("PD"))
  subgraph LOOP["$L(z)$：開迴路增益（至少 1 拍延遲）"]
    direction LR
    LF["loop filter<br/>SSCP 或 CP + RC"] --> VCO["VCO：頻率 → 相位（積分）<br/>＋ 取樣到生效的 1 拍延遲"]
  end
  S -->|"$e_{PD}[n]$"| LF
  VCO -- "$-\,y[n]$（迴路的修正，<br/>回到 feedback 輸入）" --> S
  S -->|"$e_{PD}[n]$"| CMP["1-bit 比較器<br/>校正迴路取的是 PD 的輸出"]
  class S focus${STYLE}`

/** §4.1 玩具模型 e = g·(a − w)·x：只差在迴路把誤差乘上 g = +1 或 g = −0.2 */
export const CHART_TOY = String.raw`flowchart TB
  subgraph CASEA["情況 A：沒有迴路，$g = +1$"]
    direction LR
    A1["誤差 $\delta\cdot x$<br/>$\delta = a - w$"] --> A2["$\times\, g = +1$"] --> A3["$q = \mathrm{sign}(e)$<br/>$e = g\cdot\delta\cdot x$<br/>與 $\delta\cdot x$ 同號"] --> A4["$w \leftarrow w + \mu\cdot q\cdot x$<br/>往 $a$ 靠近"]
  end
  subgraph CASEB["情況 B：迴路把殘差反相縮小，$g = -0.2$"]
    direction LR
    B1["誤差 $\delta\cdot x$<br/>$\delta = a - w$"] --> B2["$\times\, g = -0.2$"] --> B3["$q = \mathrm{sign}(e)$<br/>$e = g\cdot\delta\cdot x$<br/>與 $\delta\cdot x$ 反號"] --> B4["$w \leftarrow w + \mu\cdot q\cdot x$<br/>離 $a$ 越來越遠"]
  end
  CASEA ~~~ CASEB
  class A4 ok
  class B2,B4 warn${STYLE}`

/** §4.2 真正的校正迴路：快的部分每個 sample n 做一次，慢的部分每個 block k 做一次 */
export const CHART_LMS_LOOP = String.raw`flowchart TB
  X["regressor $x_j[n]$<br/>$\rho[n]$ 與 8 個 one-hot"] --> M1(("$\times$"))
  V["雜訊 $v[n]$<br/>標準差 $\sigma_v$"] -- "＋" --> AD(("＋"))
  subgraph FAST["快：每個 sample $n$（每個 $T_{ref}$ 一拍）"]
    direction LR
    M1 -->|"$u[n] = \textstyle\sum_j \delta_j\cdot x_j[n]$"| H["$H_{PD}(z)$<br/>主 PLL 迴路"]
    H -- "$+\,e_{PD}[n]$" --> AD
    AD --> SG["$\mathrm{sign}(\cdot)$<br/>1-bit 比較器"]
    SG -->|"$q[n] = \pm 1$"| M2(("$\times$"))
    GZ["前置濾波 $G(z)$<br/>raw：$G = 1$"] -->|"$r_i[n]$"| M2
  end
  X --> GZ
  subgraph SLOW["慢：每個 block $k$（$N$ 個 sample）"]
    direction LR
    AVG["$(1/N)\cdot\textstyle\sum$<br/>一個 block 的平均"] -->|"$G_i[k]$"| MU["$\times\,\mu$"]
    MU --> ACC["累加<br/>$w_i[k+1] = w_i[k] + \mu\cdot G_i[k]$"]
  end
  M2 --> AVG
  ACC -->|"9 個權重 $w[k]$"| DEL["$\delta_j[k]$ = 真值 $- w_j[k]$<br/>9 個權重誤差"]
  DEL --> M1
  class H,GZ focus${STYLE}`

/** §4.2 取平均並線性化之後的等效迴路（block rate）：δ[k+1] = δ[k] − μ·K_q·C·δ[k] */
export const CHART_MEAN_LOOP = String.raw`flowchart TB
  S(("＋")) -->|"$\delta[k+1]$"| Z["$z^{-1}$<br/>延遲一個 block"]
  Z -- "$+\,\delta[k]$" --> S
  Z -->|"$\delta[k]$：<br/>9 個權重誤差"| C["$C$：$9 \times 9$ 矩陣<br/>$C_{ij} = \langle r_i\cdot(h_{PD} * x_j)\rangle$"]
  C --> KQ["$\times\, K_q$<br/>比較器的等效增益"]
  KQ -->|"$E[G[k]] \approx$<br/>$K_q\cdot C\cdot\delta[k]$"| MU["$\times\,\mu$"]
  MU -- "−" --> S
  C -.-> E["沿 $C$ 的每個特徵方向：<br/>$\delta$ 每個 block 乘上<br/>$1 - \mu\cdot K_q\cdot\lambda$<br/>$\mu$ 夠小時<br/>$\mathrm{Re}\,\lambda \gt 0$ 收斂；<br/>$\mathrm{Re}\,\lambda \lt 0$ 反號"]
  class C focus${STYLE}`

/** §4.3 頻域：C 是每條譜線的功率乘上 Γ_eff 再加總 */
export const CHART_SPECTRAL = String.raw`flowchart TB
  XJ["$x_j[n]$<br/>第 $\nu$ 條譜線：係數 $c_\nu^j$，頻率 $f_\nu$"] --> H["$\times\, H_{PD}(f_\nu)$<br/>誤差 $\to$ PD"]
  XI["$x_i[n]$<br/>第 $\nu$ 條譜線：係數 $c_\nu^i$，頻率 $f_\nu$"] --> G["$\times\, G(f_\nu)$<br/>regressor 前置濾波"]
  H --> P(["相關 $\langle\,\cdot\,\rangle$"])
  G -- "取共軛" --> P
  P -- "只有同頻率的線留下來，逐線相加" --> C["$C_{ij} = \textstyle\sum_\nu \overline{c_\nu^i}\cdot c_\nu^j\cdot\Gamma_{\rm eff}(f_\nu)$<br/>$\Gamma_{\rm eff} = H_{PD}\cdot\overline{G}$"]
  C --> DG["對角項 $C_{ii} = \textstyle\sum_\nu \lvert c_\nu^i\rvert^2\cdot\mathrm{Re}\,\Gamma_{\rm eff}(f_\nu)$<br/>即每條線的功率乘上該頻率的 $\mathrm{Re}\,\Gamma_{\rm eff}$"]
  class H,G focus${STYLE}`

/** §5.1 反號恆等式：Re L < −1 ⟺ Re H_PD < 0 ⟺ Re T > 1 ⇒ |T| > 1 */
export const CHART_IDENTITY = String.raw`flowchart TB
  L["開迴路 $L$ 在頻率 $f$ 的值<br/>（一個複數）"] --> Q{"$\mathrm{Re}\,L \lt -1$？<br/>落在直線 $\mathrm{Re} = -1$ 的左邊"}
  Q -- "是" --> N["$1 + \mathrm{Re}\,L \lt 0$<br/>$\Rightarrow \mathrm{Re}\,H_{PD} \lt 0$"]
  N --> T["$\mathrm{Re}\,T = 1 - \mathrm{Re}\,H_{PD} \gt 1$<br/>$\Rightarrow \lvert T\rvert \gt 1$：在 peaking 區"]
  T --> INV["這個頻率的譜線<br/>貢獻負的梯度"]
  Q -- "否" --> P["$\mathrm{Re}\,H_{PD} \ge 0$"]
  P --> POS["這個頻率的譜線<br/>貢獻正（或零）的梯度"]
  class INV warn
  class POS ok${STYLE}`

/**
 * §5.2 低頻的 H_PD ≈ 1/L：Type-II 把慢誤差做兩次差分（反向），Type-I 只做一次差分（差 90°）。
 * 1/L₂ ≈ (1 − z⁻¹)²/(K_i·z⁻¹)、1/L₁ = (1 − z⁻¹)/(K·z⁻¹)：分母的 z⁻¹ 是迴路的 1 拍延遲，除以它＝提前 1 拍（把差分對到中心）。
 */
export const CHART_LOWFREQ = String.raw`flowchart TB
  subgraph TYPE2["Type-II（兩個積分器）：低頻 $H_{PD} \approx 1/L$"]
    direction LR
    U2["慢誤差 $u[n]$"] --> A2["差分<br/>$1 - z^{-1}$"] --> B2["再差分一次<br/>$1 - z^{-1}$"] --> C2["$\div\,(K_i\cdot z^{-1})$<br/>除以 $z^{-1}$：<br/>提前 1 拍"] --> E2["$e_{PD} \approx u$ 的<br/>中心二次差分 $\div\, K_i$<br/>$\langle u\cdot u''\rangle \lt 0$：<br/>與 $u$ 反向"]
  end
  subgraph TYPE1["Type-I（一個積分器）：低頻 $H_{PD} \approx 1/L$"]
    direction LR
    U1["慢誤差 $u[n]$"] --> A1["差分<br/>$1 - z^{-1}$"] --> C1["$\div\,(K\cdot z^{-1})$<br/>除以 $z^{-1}$：<br/>提前 1 拍"] --> E1["$e_{PD} \approx u$ 的<br/>一次差分 $\div\, K$<br/>$\langle u\cdot u'\rangle = 0$：<br/>與 $u$ 差 90°"]
  end
  TYPE2 ~~~ TYPE1
  class B2,E2 warn${STYLE}`

/** §6 三個迴路並排：積分器的個數與 loop filter 的結構（藍色＝含一個積分器的方塊） */
export const CHART_THREE_LOOPS = String.raw`flowchart TB
  subgraph LOOP1["$L_1$：SSPLL Type-I（1 個積分器）"]
    direction LR
    I1(["$e_{PD}$"]) --> K1["比例增益 $K$"] --> V1["VCO 積分 + 1 拍延遲<br/>$\tfrac{1}{z-1}$"] --> O1(["$y$"])
  end
  subgraph LOOP2["$L_2$：SSPLL Type-II（2 個積分器）"]
    direction LR
    I2(["$e_{PD}$"]) --> F2["P + I loop filter<br/>$K_p + K_i/(1 - z^{-1})$"] --> V2["VCO 積分 + 1 拍延遲<br/>$\tfrac{1}{z-1}$"] --> O2(["$y$"])
  end
  subgraph LOOP3["$L_3$：傳統 CPPLL（2 個積分器 + 1 個極點）"]
    direction LR
    I3(["$e_{PD}$"]) --> F3["CP $\to$<br/>$R + C_1 \parallel C_2$<br/>$(1 + s/\omega_z) /$<br/>$(s\,(1 + s/\omega_p))$"] --> V3["VCO<br/>$K/s$"] --> SM["每個 $T_{ref}$ 取樣一次<br/>impulse-invariant<br/>$\to$ $L_3(z)$"] --> O3(["$y$"])
  end
  LOOP1 ~~~ LOOP2
  LOOP2 ~~~ LOOP3
  class V1,F2,V2,F3,V3 focus${STYLE}`

/** §6.1 Type-I 不是天生免疫：多出來的延遲或寄生極點（紅）會把 Re L 往下拉 */
export const CHART_TYPE1_VARIANTS = String.raw`flowchart TB
  subgraph T1NOM["標稱 $L_1$（$d = 1$）：$\mathrm{Re}\,L = -K/2$，不會低於 $-1$（$K \lt 2$）"]
    direction LR
    N1(["$e_{PD}$"]) --> N2["$K$"] --> N3["$\tfrac{1}{z-1}$"] --> N4(["$y$"])
  end
  subgraph T1LAT["迴路共延遲 $d$ 拍：$\mathrm{Re}\,L$ 最低到 $-K\cdot(d - 1/2)$"]
    direction LR
    A1(["$e_{PD}$"]) --> A2["$K$"] --> A3["$\tfrac{1}{z-1}$"] --> A4["多出來的延遲<br/>$z^{-(d-1)}$"] --> A5(["$y$"])
  end
  subgraph T1POLE["多一個寄生極點 $p$：$\mathrm{Re}\,L$ 最低到 $-K\cdot(1/2 + p/(1 - p))$"]
    direction LR
    B1(["$e_{PD}$"]) --> B2["$K$"] --> B3["$\tfrac{1}{z-1}$"] --> B4["寄生極點<br/>$(1 - p)/(1 - p\cdot z^{-1})$"] --> B5(["$y$"])
  end
  T1NOM ~~~ T1LAT
  T1LAT ~~~ T1POLE
  class A4,B4 warn${STYLE}`

/** §6.2 L2 的 Re L：比例路徑給固定的 −K_p/2，積分路徑越低頻越負；兩者相加小於 −1 的頻段就是反號帶 */
export const CHART_REL2 = String.raw`flowchart TB
  E["$L_2$ 的兩條路徑"] --> P["比例路徑<br/>$K_p\cdot z^{-1}/(1 - z^{-1})$"]
  E --> I["積分路徑<br/>$K_i\cdot z^{-1}/(1 - z^{-1})^2$"]
  P -- "實部 $-K_p/2$<br/>（每個頻率都一樣）" --> S(("＋"))
  I -- "實部 $-K_i/(4\sin^2(\Omega/2))$<br/>（越低頻越負）" --> S
  S -->|"$\mathrm{Re}\,L_2$"| Q{"$\mathrm{Re}\,L_2 \lt -1$？"}
  Q -- "是：$f \lt f_{inv}$" --> INV["反號帶：$\mathrm{Re}\,H_{PD} \lt 0$<br/>從 DC 一路到 $f_{inv}$"]
  Q -- "否：$f \ge f_{inv}$" --> POS["$\mathrm{Re}\,H_{PD} \ge 0$"]
  class I focus
  class INV warn
  class POS ok${STYLE}`

/**
 * §6.3 L3（CPPLL，impulse-invariant）的 Re L：電荷包之後的相位 l(t) = K·t + B·(1 − e^(−ω_p·t)) 每拍讀一次，
 * 斜坡、步階、指數各變成一條離散路徑；三條路徑的實部相加（取負號就是 F-CS.9 的 −Re L₃）。
 */
export const CHART_REL3 = String.raw`flowchart TB
  LT["CP 在 $t = 0$ 打進一個窄電荷包<br/>之後的相位 $l(t) = K\cdot t + B\cdot(1 - e^{-\omega_p t})$"] --> SM["每拍讀一次<br/>$L_3(z) = \textstyle\sum l(n)\cdot z^{-n}$，$n \ge 1$"]
  SM --> R["斜坡 $K\cdot t$ $\to$ 雙積分路徑<br/>$K\cdot z^{-1}/(1 - z^{-1})^2$"]
  SM --> ST["步階 $B$ $\to$ 單積分路徑<br/>$B\cdot z^{-1}/(1 - z^{-1})$"]
  SM --> EX["指數 $-B\cdot e^{-\omega_p t}$<br/>$\to$ 極點 $p = e^{-\omega_p}$<br/>$-B\cdot p\cdot z^{-1}/(1 - p\cdot z^{-1})$"]
  R -- "實部 $-K/(4\sin^2(\Omega/2))$<br/>（越低頻越負）" --> S(("＋"))
  ST -- "實部 $-B/2$<br/>（每個頻率都一樣）" --> S
  EX -- "實部<br/>$-B\cdot p\cdot(\cos\Omega - p)/(1 - 2p\cdot\cos\Omega + p^2)$" --> S
  S -->|"$\mathrm{Re}\,L_3$"| Q{"$\mathrm{Re}\,L_3 \lt -1$？"}
  Q -- "是：$f \lt f_{inv}$" --> INV["反號帶：$\mathrm{Re}\,H_{PD} \lt 0$<br/>從 DC 一路到 $f_{inv}$"]
  Q -- "否：$f \ge f_{inv}$" --> POS["$\mathrm{Re}\,H_{PD} \ge 0$"]
  class R focus
  class INV warn
  class POS ok${STYLE}`

/** §7.1 GOS：鋸齒 ρ[n] 的每條諧波乘上該頻率的 Re Γ_eff 再加總 */
export const CHART_GOS = String.raw`flowchart TB
  R["$\rho[n] = \mathrm{frac}(n\beta)$<br/>鋸齒，$\beta = \mathrm{frac}(8\alpha)$"] --> F["拆成譜線<br/>Fourier 級數"]
  F --> D0["DC：平均 $1/2$"]
  F --> M1["$m = 1$：頻率 $\beta$<br/>功率 $1/(2\pi^2)$"]
  F --> M2["$m = 2$：頻率 $\mathrm{frac}(2\beta)$<br/>功率 $1/(8\pi^2)$"]
  F --> MM["$m \ge 3$：頻率 $\mathrm{frac}(m\beta)$<br/>折回全頻帶<br/>功率 $1/(2\pi^2 m^2)$"]
  D0 -- "$\times\,\Gamma_{\rm eff}(0) = 0$" --> S(("$\textstyle\sum$"))
  M1 -- "$\times\,\mathrm{Re}\,\Gamma_{\rm eff}(\beta)$" --> S
  M2 -- "$\times\,\mathrm{Re}\,\Gamma_{\rm eff}(\mathrm{frac}(2\beta))$" --> S
  MM -- "$\times\,\mathrm{Re}\,\Gamma_{\rm eff}(\mathrm{frac}(m\beta))$" --> S
  S --> C["$C_{GOS}$<br/>$\kappa_{GOS} = 12\cdot C_{GOS}$"]
  class M1 focus${STYLE}`

/**
 * §7.2 相關器延遲 D：q[n] 必須和同一拍的 x[n] 相乘。
 * sequenceDiagram 的訊息與註解沒有引號可用（引號會原樣畫出來），共用元件的 `$...$` → `$$...$$` 前處理碰不到它，
 * 所以這張圖直接寫 Mermaid 原生的 `$$...$$`：每一行只能有「一段」公式，文字部分包成 `\text{…}`（renderMermaidForTest 驗證過會用 KaTeX 排版）。
 */
export const CHART_ALIGN = String.raw`sequenceDiagram
  participant ACC as 分數累加器
  participant AFE as DTC／PMUX 與 SSPD
  participant CMP as 1-bit 比較器
  participant REG as regressor 暫存器
  participant GM as GMAC
  Note over ACC,GM: $$\begin{gathered}\text{第 }n\text{ 拍}\cr\text{（一個 reference 週期）}\end{gathered}$$
  ACC->>AFE: $$\text{code }\rho[n]\text{、}p[n]$$
  ACC->>REG: $$x[n]$$
  AFE->>CMP: $$\begin{gathered}e_{PD}[n]\text{，含這一拍}\cr\text{剛注入的 }u[n]\cr\text{（}h_{PD}[0] = 1\text{）}\end{gathered}$$
  CMP->>GM: $$q[n] = \mathrm{sign}(e_{PD}[n] + v[n])$$
  REG->>GM: $$r[n] = x[n - D]$$
  Note over CMP,GM: $$\begin{gathered}D = 0\text{ 時 }q[n]\text{ 乘上同一拍的}\cr x[n]\text{（正確）}\end{gathered}$$
  Note over CMP,GM: $$\begin{gathered}D = +1\text{ 時 }q[n]\text{ 乘上前一拍的}\cr x[n - 1]\text{（有害）}\end{gathered}$$`

/**
 * §7.2 near-grid（β → 0）的慢鋸齒 = 慢斜坡（每拍 +β）+ 每 1/β 拍一次的 −1 跳變（wrap）：
 * 斜坡經 H_PD 的穩態響應 β·S∞ 乘上 ⟨ρ⟩ = 1/2；每次 wrap 的響應 −s[m] 乘上 wrap 附近的 regressor x[n − D]，wrap 的頻率是每拍 β 次。
 * 相加就是 F-CS.12：C_GOS ≈ (β/2)·(S∞ − 2·S_D) − β²·Σ m·s[m]（s = h_PD 的步階響應，S∞ = Σ s[n]，S_D = Σ_{n<D} s[n]）。
 */
export const CHART_NEARGRID = String.raw`flowchart TB
  RHO["near-grid 的 $\rho[n]$<br/>$\beta$ 很小：很慢的鋸齒"] --> RAMP["慢斜坡<br/>每拍 $+\beta$"]
  RHO --> WRAP["wrap：每 $1/\beta$ 拍<br/>跳一次 $-1$"]
  RAMP -->|"經 $H_{PD}$：穩態是常數<br/>$\beta\cdot S_\infty$"| T1["$\times$ $\rho$ 的平均 $1/2$"]
  WRAP -->|"經 $H_{PD}$：$-s[m]$，<br/>$m$ = wrap 之後第幾拍"| T2["$\times$ wrap 附近的 regressor $x[n - D]$<br/>前 $D$ 拍：乘到跳之前的 $\rho \approx 1$<br/>之後：乘到剛歸零的 $\rho \approx \beta\cdot m$"]
  T1 -- "$+\,\beta\cdot S_\infty/2$" --> S(("＋"))
  T2 -- "$+\,(-\beta\cdot S_D - \beta^2\cdot\textstyle\sum m\cdot s[m])$<br/>每拍有 $\beta$ 次 wrap" --> S
  S --> C["$C_{GOS} \approx (\beta/2)\cdot(S_\infty - 2\cdot S_D) - \beta^2\cdot\textstyle\sum m\cdot s[m]$"]
  C --> I1["Type-I：$S_\infty = 1/K$<br/>$\Rightarrow +\beta/(2K)$"]
  C --> I2["Type-II、$D = 0$：<br/>$S_\infty = 0$、$S_D = 0$<br/>$\Rightarrow +\beta^2/K_i$<br/>（很小：dead zone）"]
  C --> I3["Type-II、$D = 1$：<br/>$S_D = s[0] = 1$<br/>$\Rightarrow -\beta$（反號）"]
  class T2 focus
  class I1 ok
  class I3 warn${STYLE}`

/** §8.1 PHOS：8 個 one-hot → circulant → DFT 模態；每個模態的基波頻率與權重 */
export const CHART_PHOS_MODES = String.raw`flowchart TB
  P["$p[n]$：PMUX 相位索引<br/>以 $\alpha\cdot f_{ref}$ 繞圈"] --> OH["8 個 one-hot regressor<br/>$x_{1+k}[n] = \mathbf{1}\{p[n] = k\}$"]
  OH --> C["$8 \times 8$ 矩陣 $C$<br/>$C_{jk}$ 只依賴 $(j - k) \bmod 8$<br/>$\Rightarrow$ circulant"]
  C --> F["特徵向量 = DFT 向量<br/>$v_m[k] = e^{j2\pi mk/8}$"]
  F --> M0["$m = 0$：<br/>8 相一起偏<br/>（共模）<br/>$\lambda_0 = 0$"]
  F --> M1["$m = 1, 7$：<br/>繞一圈一個弦波<br/>基波 $\alpha\cdot f_{ref}$<br/>權重 $W_1 \approx 0.95$"]
  F --> M2["$m = 2, 6$<br/>基波 $2\alpha\cdot f_{ref}$<br/>權重 $\approx 0.81$"]
  F --> M3["$m = 3, 5$<br/>基波 $3\alpha\cdot f_{ref}$<br/>權重 $\approx 0.61$"]
  F --> M4["$m = 4$：<br/>奇偶相交替<br/>基波 $4\alpha\cdot f_{ref}$<br/>權重 $\approx 0.81$<br/>（$\pm 4$ 兩條線合計）"]
  class M1 focus${STYLE}`

/** §8.2 mode-1 的嚴格界限：一定反號／不可能反號／要算完整的諧波和 */
export const CHART_MODE1_BOUNDS = String.raw`flowchart TB
  A["$h = \mathrm{Re}\,H_{PD}(f_{rot})$，$f_{rot} = \min(\alpha, 1 - \alpha)\cdot f_{ref}$<br/>基波拿走權重 $W_1$，其餘 $1 - W_1$ 散在別的頻率"] --> U{{"其餘權重全放在最有利的頻率也救不回來？<br/>上界 $W_1\cdot h + (1 - W_1)\cdot\max\mathrm{Re}\,H_{PD} \lt 0$"}}
  U -- "是" --> SURE["mode-1 一定反號"]
  U -- "否" --> LO{{"其餘權重全放在最不利的頻率也不會變負？<br/>下界 $W_1\cdot h + (1 - W_1)\cdot\min\mathrm{Re}\,H_{PD} \ge 0$"}}
  LO -- "是" --> NEVER["mode-1 不可能反號"]
  LO -- "否" --> MID["界限跨過 0<br/>要算完整的諧波和（實驗 B）"]
  class SURE warn
  class NEVER ok${STYLE}`

/**
 * §8.4(c) alias 區：α 靠近 1/4 時 mode 4 的 regressor (−1)^p[n] 是頻率 4·|α − 1/4| 的慢方波（基波權重 8/π²）；
 * 基波落進反號帶也只會近乎抵消（0.81·min Re H_PD + 0.19·max Re H_PD > 0），是 dead zone。
 * 圖上不用正文那一小段的 δ（= α − 1/4），避免和權重誤差 δ 混淆；寫法與 CHART_KEEPOUT 的 ② 相同。
 */
export const CHART_ALIAS = String.raw`flowchart TB
  A["頻道 $\alpha$ 靠近 $1/4$<br/>偏移 $\alpha - 1/4$ 很小，可正可負"] --> P["$4\varphi[n]$ 每拍前進<br/>$4\alpha = 1 + 4\cdot(\alpha - 1/4)$<br/>整數的 1 看不到<br/>只剩 $4\cdot(\alpha - 1/4)$"]
  P --> M4["mode 4 的 regressor $(-1)^{p[n]}$<br/>$\mathrm{frac}(4\varphi[n]) \lt 1/2$ 時是 $+1$，否則 $-1$"]
  M4 --> SQ["頻率 $4\cdot\lvert\alpha - 1/4\rvert\cdot f_{ref}$ 的慢方波<br/>基波權重 $8/\pi^2 \approx 0.81$"]
  SQ --> Q{{"$4\cdot\lvert\alpha - 1/4\rvert\cdot f_{ref}$ 落在反號帶？<br/>也就是<br/>$\lvert\alpha - 1/4\rvert\cdot f_{ref} \lt f_{inv}/4$"}}
  Q -- "是" --> DZ["基波（81%）落在負區<br/>其餘 19% 散在 3、5、7… 倍頻<br/>$\kappa$ 的上界最低也有<br/>$0.81\cdot\min\mathrm{Re}\,H_{PD} + 0.19\cdot\max\mathrm{Re}\,H_{PD} \gt 0$：不保證反號<br/>實際近乎抵消 $\Rightarrow$ dead zone"]
  Q -- "否" --> POS["基波在正區<br/>mode 4 不受 alias 影響"]
  A -.-> HALF["$\alpha$ 靠近 $1/2$ 同理：<br/>mode 2 的基波在<br/>$2\cdot\lvert\alpha - 1/2\rvert\cdot f_{ref}$<br/>mode 4 的基波在<br/>$4\cdot\lvert\alpha - 1/2\rvert\cdot f_{ref}$"]
  class SQ focus
  class DZ warn
  class POS ok${STYLE}`

/** §9(a) GOS 與 PHOS 什麼時候可以分開看 */
export const CHART_JOINT = String.raw`flowchart TB
  A["頻道 $\alpha$<br/>最簡分數 $P/Q$，或無理數"] --> Q{"$8$ 整除 $Q$，<br/>或 $\alpha$ 是無理數？"}
  Q -- "是" --> BD["8 相佔用率均勻<br/>GOS–PHOS 耦合 $C_{0k} = C_{k0} = 0$<br/>$9 \times 9$ = GOS（$1 \times 1$）<br/>＋ PHOS（$8 \times 8$ circulant）"]
  Q -- "否" --> CP["8 相佔用率不均<br/>GOS–PHOS 有耦合<br/>$C$ 不是 normal 矩陣"]
  BD --> R1["分開看<br/>$\kappa_{GOS}$（§7）與 $\kappa_m$（§8）"]
  CP --> R2["直接算 $9 \times 9$ 的特徵值<br/>掃描結果：<br/>沒有只在 joint 出現的反號"]
  class BD ok${STYLE}`

/** §9(c) PSD 定理：頻道決定譜線落在哪裡（管不了），設計者決定 kernel 的實部（可以選） */
export const CHART_PSD = String.raw`flowchart TB
  AL["頻道 $\alpha$、$Q$<br/>會換，管不了"] --> LN["譜線位置 $f_\nu$<br/>權重 $\lvert a_\nu^{\top} v\rvert^2 \ge 0$"]
  HP["迴路 $H_{PD}(f)$<br/>Type-II 有負區"] --> GA["kernel<br/>$\Gamma_{\rm eff}(f) = H_{PD}(f)\cdot\overline{G(f)}$"]
  G["regressor 前置濾波 $G(f)$<br/>設計者可以選"] --> GA
  LN --> S(("$\textstyle\sum$"))
  GA -- "在每條線上取 $\mathrm{Re}\,\Gamma_{\rm eff}(f_\nu)$" --> S
  S --> LAM["$\mathrm{Re}\,\lambda = \textstyle\sum_\nu \mathrm{Re}\,\Gamma_{\rm eff}(f_\nu)\cdot\lvert a_\nu^{\top} v\rvert^2$"]
  LAM --> Q{"$\mathrm{Re}\,\Gamma_{\rm eff}(f) \ge 0$<br/>對所有 $f$ 成立？"}
  Q -- "是：1diff、filtered-x" --> SAFE["$\mathrm{Re}\,\lambda \ge 0$<br/>任何 $\alpha$、任何 $Q$ 都不反號"]
  Q -- "否：raw 配 Type-II" --> RISK["譜線落進負區<br/>就可能反號"]
  class G focus
  class SAFE ok
  class RISK warn${STYLE}`

/** §10.1 時域 sim 怎麼量 κ：凍結 LMS、擾動權重、量 GMAC 的斜率、用開迴路值正規化 */
export const CHART_SIM_MEASURE = String.raw`flowchart TB
  subgraph ROW1["① 擾動並記錄"]
    direction LR
    A["凍結 LMS<br/>權重停在校準點"] --> B["把第 $j$ 個權重<br/>擾動 $\pm 30$ fs"] --> C["跑 $2^{16}$ 個 sample<br/>記錄 GMAC 的平均 $G_i$"]
  end
  subgraph ROW2["② 正規化"]
    direction LR
    D["斜率矩陣<br/>GMAC 平均對<br/>權重擾動的斜率"] --> E["$\div$ 同一段紀錄在<br/>$H_{PD} \equiv 1$ 時的斜率<br/>（開迴路參考）"] --> F["$\kappa$：$1$ = 和沒有迴路時一樣<br/>正 = 往回拉，負 = 反號"]
  end
  ROW1 --> ROW2
  class E focus${STYLE}`

/** §10.4 大訊號：1-bit 比較器飽和後只剩正負號，相關看的是「同號的時間比例」而不是「面積」 */
export const CHART_LARGE_SIGNAL = String.raw`flowchart TB
  D["誤差方向 $d_v[n]$<br/>振幅 $A$"] --> H["$H_{PD}$"]
  H -->|"$y_v[n] = (h_{PD} * d_v)[n]$"| S{"$A$ 和雜訊 $\sigma_v$<br/>比起來"}
  S -- "$A \ll \sigma_v$：小訊號" --> LIN["比較器的平均輸出 $\propto y_v$<br/>大小還在"]
  S -- "$A \gg \sigma_v$：大訊號" --> SGN["比較器的平均輸出 $\to \mathrm{sgn}(y_v)$<br/>只剩正負號"]
  LIN --> C1["與 regressor $z_v$ 相關：$\langle y_v\cdot z_v\rangle$<br/>看的是面積 $\to$ $C_{vv}$"]
  SGN --> C2["$\langle \mathrm{sgn}(y_v)\cdot z_v\rangle$<br/>看的是同號的時間比例 $\to$ $\kappa_\infty$"]
  class SGN,C2 warn${STYLE}`

/** §11 對策並排：只換 GMAC 前的 regressor 前置濾波 G(z)（綠＝安全、紅＝有害） */
export const CHART_REMEDY_G = String.raw`flowchart LR
  X["$x_i[n]$<br/>$\rho[n]$ 或 one-hot"] --> RAW["raw：$G = 1$<br/>$r = x$"]
  X --> ZM["ac／zm：減掉平均<br/>GOS 減 $1/2$，<br/>zm 連 PHOS 的 $1/8$ 也減"]
  X --> D1["一階差分：$G = 1 - z^{-1}$<br/>$r[n] = x[n] - x[n-1]$"]
  X --> FX["filtered-x：$G = \hat H_{PD}(z)$<br/>$r = \hat h_{PD} * x$"]
  X --> DK["相關器晚 $D$ 拍：$G = z^{-D}$<br/>$r[n] = x[n - D]$"]
  X --> D2["二階差分：$G = (1 - z^{-1})^2$"]
  RAW --> R["$r_i[n]$<br/>擇一"]
  ZM --> R
  D1 --> R
  FX --> R
  DK --> R
  D2 --> R
  R --> M(("$\times$"))
  Q["$q[n]$<br/>比較器輸出"] ----> M
  M --> GM["GMAC<br/>$(1/N)\cdot\textstyle\sum q\cdot r_i$"]
  class ZM focus
  class D1,FX ok
  class DK,D2 warn${STYLE}`

/** §11.1 一階差分為什麼安全：regressor 的差分消掉迴路的一個積分器 */
export const CHART_ONEDIFF = String.raw`flowchart LR
  subgraph KRAW["raw：$\Gamma = H_{PD}$"]
    direction TB
    A1["$L_2$ 有兩個積分器"] --> A2["低頻 $H_{PD} \approx 1/L_2$<br/>即兩次差分 $\div\, K_i$"] --> A3["$\mathrm{Re}\,\Gamma \approx -\Omega^2/K_i \lt 0$<br/>低頻一定反號"]
  end
  subgraph KDIFF["一階差分：$\Gamma_{1d} = H_{PD}\cdot\overline{(1 - z^{-1})}$"]
    direction TB
    B1["regressor 的差分 $1 - z^{-1}$<br/>消掉一個積分器<br/>$(1 - z^{-1})\cdot L_2 = K_p\cdot z^{-1}$<br/>$+\,K_i\cdot z^{-1}/(1 - z^{-1})$"] --> B2["$\mathrm{Re}\,\Gamma_{1d}$ 的分子<br/>$g(\Omega) = 1 - K_i/2 - (1 - K_p)\cdot\cos\Omega$"] --> B3["$K_i \le 2K_p$ 且 $K_p + K_i/2 \le 2$<br/>$\Rightarrow$ 每個頻率 $\mathrm{Re}\,\Gamma_{1d} \ge 0$"]
  end
  KRAW ~~~ KDIFF
  class A3 warn
  class B1 focus
  class B3 ok${STYLE}`

/** §11.1 補充：Type-I、延遲 d 拍時一階差分的 g(Ω) = 1 − cos Ω + K·cos(d·Ω)——差分消掉積分器，但多出來的延遲還在 */
export const CHART_ONEDIFF_DELAY = String.raw`flowchart LR
  subgraph LAT1["Type-I、延遲 1 拍（標稱 $L_1$）"]
    direction TB
    P1["$(1 - z^{-1})\cdot L = K\cdot z^{-1}$<br/>差分消掉積分器"] --> G1["$g(\Omega) = 1 - \cos\Omega + K\cdot\cos\Omega$<br/>$= 1 - (1 - K)\cdot\cos\Omega$"] --> R1["最小值 $\min(K, 2 - K) \gt 0$<br/>一階差分安全（$0 \lt K \lt 2$）"]
  end
  subgraph LATD["Type-I、延遲 $d$ 拍（$d \ge 2$）"]
    direction TB
    P2["$(1 - z^{-1})\cdot L = K\cdot z^{-d}$<br/>積分器消掉了，<br/>多出來的延遲還在"] --> G2["$g(\Omega) = 1 - \cos\Omega + K\cdot\cos(d\cdot\Omega)$"] --> R2["$\Omega = \pi/d$ 時<br/>$g = 1 - \cos(\pi/d) - K$<br/>$K \gt 1 - \cos(\pi/d)$ 就有負值"]
  end
  LAT1 ~~~ LATD
  class R1 ok
  class P2,R2 warn${STYLE}`

/** §11.2 filtered-x：regressor 先通過迴路的數位模型，兩條路徑的相位就對齊 */
export const CHART_FX = String.raw`flowchart TB
  XJ["誤差 $\delta_j\cdot x_j[n]$<br/>造成誤差的那一條 regressor"] --> H["真正的迴路<br/>$H_{PD}(z)$"]
  H -->|"$e_{PD}[n]$"| CMP["1-bit 比較器"]
  CMP -->|"$q[n]$"| M(("$\times$"))
  XI["$x_i[n]$<br/>拿來相關的那一條"] --> HH["迴路的數位模型 $\hat H_{PD}(z)$<br/>9 條 IIR，以 $f_{ref}$ 全速運作"]
  HH -->|"$r_i[n] = (\hat h_{PD} * x_i)[n]$"| M
  M --> GM["GMAC 平均"]
  GM --> K["等效 kernel $\Gamma_{fx} = H_{PD}\cdot\overline{\hat H_{PD}}$<br/>兩者相位差 $\le 90^\circ$ $\Rightarrow$ $\mathrm{Re}\,\Gamma_{fx} \ge 0$<br/>模型精確時 $\Gamma_{fx} = \lvert H_{PD}\rvert^2$"]
  class HH focus
  class K ok${STYLE}`

/** §11.3 P-only（以 $L_2$ 為例）：校準時 hold 住積分路徑，迴路暫時變成 Type-I */
export const CHART_PONLY = String.raw`flowchart TB
  E["$e_{PD}[n]$"] --> KP["比例路徑<br/>$K_p$"]
  E --> SW["hold 開關<br/>校準時斷開"]
  SW --> KI["積分路徑 $K_i/(1 - z^{-1})$<br/>輸出凍結在 hold 前的值"]
  KP -- "＋" --> S(("＋"))
  KI -- "＋（校準時是常數）" --> S
  S --> V["VCO 積分 + 1 拍延遲<br/>$\tfrac{1}{z-1}$"]
  V -->|"$y[n]$"| O["回到 PD 的<br/>feedback 輸入（−）"]
  V -.-> N["校準期間 $L = K_p/(z-1)$：Type-I<br/>判據 $K_p\cdot(d - 1/2) \lt 1$ $\Rightarrow$ $\mathrm{Re}\,H_{PD} \ge 0$"]
  class SW,KI focus
  class N ok${STYLE}`

/** §12 有限步長：沿一個特徵方向的 block-rate 迴路，κ 是複數 */
export const CHART_FINITE_STEP = String.raw`flowchart TB
  S(("＋")) -->|"$\theta[k+1]$"| Z["$z^{-1}$<br/>延遲一個 block"]
  Z -- "$+\,\theta[k]$" --> S
  Z -->|"$\theta[k]$"| K["$\times\, \kappa/N_\tau$<br/>$\kappa$ 是複數"]
  K -- "−" --> S
  K -.-> Q{"$\lvert 1 - \kappa/N_\tau\rvert \lt 1$？<br/>也就是 $\mathrm{Re}\,\kappa \gt \lvert\kappa\rvert^2/(2\cdot N_\tau)$"}
  Q -- "是" --> GOOD["每個 block 都縮小<br/>收斂"]
  Q -- "否" --> BAD["不收斂：$\mathrm{Re}\,\kappa \le 0$（反號），<br/>或 $\mathrm{Re}\,\kappa \gt 0$ 但虛部太大，<br/>誤差繞著放大"]
  class GOOD ok
  class BAD warn${STYLE}`

/** §13 比較器 offset：DC 經過 sign 變成 E[q] ≠ 0，再乘上 regressor 的平均，成為與誤差無關的 forcing */
export const CHART_OFFSET = String.raw`flowchart TB
  E["$e_{PD}[n]$<br/>平均為 0"] -- "＋" --> A(("＋"))
  V["雜訊 $v[n]$"] -- "＋" --> A
  OS["DC offset $u_{os}$"] -- "＋" --> A
  A --> SG["$\mathrm{sign}(\cdot)$"]
  SG -->|"$q[n]$，平均<br/>$E[q] = \mathrm{erf}(u_{os}/(\sqrt{2}\cdot\sigma_v)) \ne 0$"| M(("$\times$"))
  R["regressor $r_i[n]$<br/>平均 $\langle r_i\rangle$"] --> M
  M --> AVG["block 平均<br/>$E[G_i]$"]
  AVG --> F["forcing 項：$E[q]\cdot\langle r_i\rangle$<br/>和誤差 $\delta$ 無關"]
  AVG --> RS["恢復項：$K_q(u_{os})\cdot(C\cdot\delta)_i$<br/>$\mathrm{eig}(C)$ 只描述這一項"]
  ZM["zero-mean regressor<br/>1diff、zm：$\langle r_i\rangle = 0$"] -. "切斷 forcing" .-> F
  class OS,F warn
  class ZM ok${STYLE}`

/**
 * §14 實驗 C 每一拍在做什麼（runSspllLms 的 sample() 與 block 更新）。
 * 連線的宣告順序會影響自動排版：累加器的三條輸出依「DTC 實際補上的量、regressor、該補的量」的順序寫，
 * 加法點的兩個輸入才會並排在它上方，權重回到 DTC 的那條線也不會和 regressor 的線交叉。
 */
export const CHART_SIM_LOOP = String.raw`flowchart TB
  SEQ["分數累加器（每拍 $n$）<br/>$\rho[n]$、$p[n]$"] --> DT["DTC 實際補上的量<br/>$(1 - a)(1 + w_g)\cdot(\rho\cdot\Delta + w_p)$"]
  SEQ --> REG["regressor 變體 $\to$ $r[n]$<br/>raw、1diff、filtered-x…"]
  SEQ --> ID["該補的量 + PMUX 偏差<br/>$\rho\cdot\Delta + \varepsilon_p$"]
  ID -- "＋" --> S(("＋"))
  DT -- "−" --> S
  S -->|"$u[n]$"| H["迴路 $h_{PD}$<br/>$L_1$、$L_2$、$L_3$ 或 P-only"]
  H -->|"$e_{PD}[n]$"| CMP["$q[n] = \mathrm{sign}(e_{PD} + v + u_{os})$"]
  CMP --> GM["GMAC 累加<br/>$G_i \mathrel{+}= q\cdot r_i$"]
  REG --> GM
  GM -- "每 $N$ 拍一次（block $k$）" --> UP["$w_g \mathrel{+}= \mu_g\cdot G_0/N$<br/>$w_k \mathrel{+}= \mu_p\cdot G_{1+k}/N$<br/>然後把 $G$ 清零"]
  UP -- "新的 $w_g$、$w_k$" --> DT
  class REG focus${STYLE}`

/** §15.2 一個頻道要不要列入 keep-out（給 raw／ac regressor 用） */
export const CHART_KEEPOUT = String.raw`flowchart TB
  A["頻道 $\alpha$<br/>$f_{rot} = \min(\alpha, 1 - \alpha)\cdot f_{ref}$，$\beta = \mathrm{frac}(8\alpha)$"] --> R{{"regressor 是 1diff（$D = 0$、$\min g \ge 0$）<br/>或 filtered-x（模型相位差 $\le 90^\circ$）？"}}
  R -- "是" --> FREE["不需要 keep-out<br/>線性與大訊號都沒有反號"]
  R -- "否：raw 或 ac" --> B{{"① $f_{rot}$ 在 mode-1 可能反號的帶內？<br/>$W_1\cdot h(f_{rot}) + (1 - W_1)\cdot\min h \lt 0$<br/>各 PVT 角落取聯集，下緣從 0 MHz 算起"}}
  B -- "是" --> KO["列入 keep-out"]
  B -- "否" --> C{{"② $\alpha$ 靠近 $1/4$ 或 $1/2$？<br/>$4\cdot\lvert\alpha - 1/4\rvert\cdot f_{ref}$ 或 $2\cdot\lvert\alpha - 1/2\rvert\cdot f_{ref}$<br/>落在反號帶"}}
  C -- "是" --> KO
  C -- "否" --> D{{"③ $\alpha$ 靠近 $k/8$（$\beta$ 接近 0 或 1），<br/>而且有 offset 或大訊號？"}}
  D -- "是" --> KO
  D -- "否" --> SAFE["可以用 raw／ac 校準<br/>仍要 zero-mean<br/>與 offset trim"]
  KO --> ACT["這個頻道不更新（freeze），<br/>或換成 1diff、<br/>filtered-x、P-only"]
  class FREE,SAFE ok
  class KO warn${STYLE}`

/** §15.3 綜合手算 HC-CS.8 的計算順序 */
export const CHART_HANDCALC = String.raw`flowchart LR
  IN["輸入<br/>$\alpha$、$f_{ref}$、$K_p$、$K_i$"] --> A["① $f_{rot} =$<br/>$\min(\alpha, 1 - \alpha)\cdot f_{ref}$<br/>PMUX 的旋轉頻率"]
  IN --> B["② $\beta = \mathrm{frac}(8\alpha)$<br/>$f_{saw} =$<br/>$\min(\beta, 1 - \beta)\cdot f_{ref}$"]
  IN --> C["③ $f_{inv} = (f_{ref}/\pi)\cdot$<br/>$\arcsin\sqrt{K_i/(2\cdot(2 - K_p))}$<br/>反號帶上緣"]
  IN --> E["⑤ $\min g = \min\{K_p - K_i/2,$<br/>$2 - K_p - K_i/2\}$"]
  A --> D["④ $f_{rot} - f_{inv}$"]
  C --> D
  D --> R1["負：PHOS mode-1<br/>在反號帶內<br/>正：在帶外"]
  B --> R2["$\min(\beta, 1 - \beta)$<br/>很小：<br/>GOS 是 near-grid"]
  E --> R3["$\min g \ge 0$：<br/>一階差分可以用"]
  class D focus${STYLE}`

/**
 * §15.4 殘餘誤差 → 輸出 spur／jitter：凍結後的 PHOS 殘差經 8 點 DFT 拆成模態，每個模態在 frac(ℓα)·f_ref 各放一條線（振幅 2|δ̂_m|√w_ℓ）；
 * GOS 殘差是鋸齒的諧波；全部乘上藍色的 |T(f)|（主迴路的低通，帶緣有 peaking）變成輸出相位，再換成 spur [dBc] 與積分 jitter。
 */
export const CHART_OUTPUT_SPUR = String.raw`flowchart TB
  D["凍結後的 PHOS 殘差<br/>$\delta_k = \varepsilon_k - w_k$，$k = 0..7$"] --> DFT["8 點 DFT<br/>$\hat\delta_m = \tfrac{1}{8}\textstyle\sum_k \delta_k e^{-j2\pi mk/8}$"]
  DFT --> M1["mode 1（與 mode 7 共軛）<br/>線 $\ell \equiv \pm 1$：頻率 $\mathrm{frac}(\ell\alpha)\,f_{ref}$<br/>peak $2\lvert\hat\delta_1\rvert\sqrt{w_\ell}$（基波 $\ell = 1$ 占 95%）"]
  DFT --> M2["mode 2、3、4<br/>線 $\ell \equiv \pm m$，同樣的 $\sqrt{w_\ell}$"]
  DFT --> M0["mode 0（共模）<br/>只有 DC：靜態相位，不是 spur"]
  G["GOS 殘差<br/>$(1 - \mathrm{gain})\,\Delta\,\rho[n]$"] --> GH["鋸齒諧波 $m$：頻率 $\mathrm{frac}(m\beta)\,f_{ref}$<br/>peak $\lvert\mathrm{GOS}\rvert/(\pi m)$"]
  M1 --> T["$\times\,\lvert T(f)\rvert$<br/>主迴路的閉迴路響應：320 MHz 低通，<br/>帶緣 peaking 2.1 dB、隨 PVT 移動"]
  M2 --> T
  GH --> T
  T --> PM["輸出相位的峰值<br/>$\Phi = 2\pi f_{vco} A_{out}$"]
  PM --> S["每條線一根 spur<br/>$20\log_{10}(\Phi/2)$ dBc"]
  PM --> J["積分 jitter<br/>$\sqrt{\textstyle\sum A_{out}^2/2}$"]
  class T focus${STYLE}`

/** §18 數學量對應的硬體：code 的 pipeline、差分、GMAC、權重暫存器 */
export const CHART_HARDWARE = String.raw`flowchart TB
  ACC["分數累加器（數位）"] -->|"高 3 位"| SEL["PMUX select $p[n]$<br/>解碼成 8 條 one-hot"]
  ACC -->|"低位"| CODE["DTC code<br/>$\rho[n]$"]
  SEL --> PIPE["pipeline 延遲對齊<br/>$D = 0$，兩條各自對齊"]
  CODE --> PIPE
  PIPE --> DIFF["每條 regressor：<br/>1 個暫存器 + 1 個減法器<br/>$G = 1 - z^{-1}$"]
  DIFF --> GM["GMAC<br/>9 個累加器，$N$ 拍清一次"]
  SSPD["SSPD 的 hold 節點<br/>PD 輸出 $e_{PD}$"] --> CMP["1-bit 比較器<br/>先做 offset trim"]
  CMP -->|"$q[n]$"| GM
  GM --> W["權重暫存器 $w_g,\ w_0,\ \ldots,\ w_7$<br/>clamp 在 DTC range 內"]
  W --> COR["修正 DTC 的補償量<br/>$w_g$ 調增益、$w_k$ 補偏移"]
  class PIPE,DIFF focus${STYLE}`

/** 圖的種類（docs/teaching-style.md §8 的分類） */
export type DiagramKind = 'architecture' | 'model' | 'loop' | 'path' | 'compare' | 'flow' | 'timing' | 'roadmap'

export const DIAGRAM_KIND_LABEL: Record<DiagramKind, string> = {
  architecture: '架構圖',
  model: '數學模型方塊圖',
  loop: '演算法迴圈圖',
  path: '路徑／轉移函數圖',
  compare: '比較圖',
  flow: '流程圖',
  timing: '時序圖',
  roadmap: '路線圖',
}

export interface DiagramDef {
  /** 查表用的 id（<Diagram id="…" />） */
  id: string
  /** 所在段落 */
  section: string
  kind: DiagramKind
  /** Mermaid 原始碼 */
  chart: string
  /** 圖說：一句話說明要看什麼；數學一律寫成 `$...$`（<Mermaid caption> 會用 KaTeX 渲染；反斜線多的用 String.raw）。圖內節點的數學同樣寫 `$...$` */
  caption: string
  /** 螢幕閱讀器用的文字替代說明；省略時用圖說 */
  alt?: string
}

/** 本章所有 Mermaid 圖，依頁面順序（章首的 <SystemMap> 是全站共用元件，不在這張表裡） */
export const DIAGRAMS: DiagramDef[] = [
  { id: 'answer', section: '§0.1', kind: 'path', chart: CHART_ANSWER, caption: '一句話回答：誤差先經過藍色的主迴路才到比較器；GMAC 算出的平均梯度是正是負，看 regressor 的功率落在哪個頻帶。' },
  { id: 'roadmap', section: '§1', kind: 'roadmap', chart: CHART_ROADMAP, caption: '本章路線圖：藍色三格（§3 到 §6）是主線，回答「為什麼會反號」；往下分成 GOS 與 PHOS 兩條支線，最後匯到對策與 checklist。' },
  {
    id: 'sspll',
    section: '§2',
    kind: 'architecture',
    chart: SSPLL_CHART,
    caption: String.raw`使用者的 SSPLL：分數除頻由 feedback 端的 8 相 PMUX（粗調，每格 $\Delta=T_{vco}/8$）加上 reference 端的 input DTC（細調，範圍一格 $\Delta$）實現；1-bit 比較器取的是 SSPD（PD）的輸出 $e_{PD}$（藍），和送進 loop filter 的是同一個訊號。`,
    alt: 'SSPLL 方塊圖：reference 先經過 input DTC 才進 SSPD（phase detector）；VCO 經過 8 相 PMUX 回到 SSPD，回授路徑上沒有 DTC。分數累加器送出 PMUX 的相位索引與 DTC 的細部殘差；DTC 的延遲是基準延遲 T_0 減掉補償量。PD 的輸出 e_PD 同時送進 loop filter 與 1-bit 比較器；比較器輸出與 regressor 進入 GMAC 與 sign-error LMS，更新 DTC 的 9 個權重。',
  },
  { id: 'phase-split', section: '§2', kind: 'model', chart: CHART_PHASE_SPLIT, caption: String.raw`小數相位的拆法：累加器的值乘 8 之後，整數部分 $p[n]$ 給 PMUX（藍，粗調），小數部分 $\rho[n]$ 給 DTC（藍，細調）；同樣這兩個數就是 PHOS 與 GOS 的 regressor。` },
  { id: 'injection', section: '§2', kind: 'path', chart: CHART_INJECTION, caption: '兩個誤差的注入點：GOS 從 reference 端的 DTC 進來、PHOS 從 feedback 端的 PMUX 進來，在比較點（PD 的輸入端）加成 $u[n]$；PD 的輸出是它通過藍色的 $H_{PD}$ 之後的 $e_{PD}[n]$，比較器取的就是這個輸出。這張圖畫的是理想模型（只留一階）。' },
  { id: 'hpd-loop', section: '§3', kind: 'loop', chart: CHART_HPD_LOOP, caption: '主迴路的回授：藍色的圓是 PD，做 $e_{PD}=u-y$，外框是開迴路增益 $L(z)$。比較器取的是 PD 的輸出 $e_{PD}$（和送進 loop filter 的是同一個訊號），不是 $u$ 本身。' },
  { id: 'toy', section: '§4.1', kind: 'compare', chart: CHART_TOY, caption: '玩具模型 $e=g\\,(a-w)\\,x$ 的兩種情況：唯一的差別是紅色那一格把誤差乘上負數，之後每一步的 $q$ 都指向錯的方向。' },
  { id: 'lms-loop', section: '§4.2', kind: 'loop', chart: CHART_LMS_LOOP, caption: String.raw`真正的校正迴路：標著「快」的框每個 sample 做一次（誤差 → $H_{PD}$ → 比較器 → 乘上 regressor），標著「慢」的框每個 block 做一次（平均、乘 $\mu$、累加）。藍色是決定符號的兩個方塊：$H_{PD}$ 與 $G$。` },
  { id: 'mean-loop', section: '§4.2', kind: 'loop', chart: CHART_MEAN_LOOP, caption: '取平均並線性化之後的等效迴路（block rate）：一個延遲、一個矩陣 $C$、兩個增益。收不收斂只看 $C$ 的特徵值的實部。' },
  { id: 'spectral', section: '§4.3', kind: 'model', chart: CHART_SPECTRAL, caption: String.raw`頻域的看法：誤差那一條乘上 $H_{PD}$、regressor 那一條乘上 $G$，相關之後每條譜線留下「功率 $\times\,\Gamma_{\rm eff}$」。` },
  { id: 'identity', section: '§5.1', kind: 'flow', chart: CHART_IDENTITY, caption: String.raw`反號恆等式的讀法：只要問一句「$\mathrm{Re}\,L$ 有沒有小於 $-1$」；答案是「是」的頻率一定在閉迴路的 peaking 區。` },
  { id: 'lowfreq', section: '§5.2', kind: 'compare', chart: CHART_LOWFREQ, caption: '低頻近似 $H_{PD}\\approx1/L$ 的訊號流（不是實際電路）：Type-II 多出的那一次差分（紅）把慢誤差翻面；Type-I 只有一次差分，與誤差差 90°，不決定符號。' },
  { id: 'three-loops', section: '§6', kind: 'compare', chart: CHART_THREE_LOOPS, caption: '三個迴路並排：藍色是含有一個積分器的方塊。$L_1$ 只有一個，$L_2$ 與 $L_3$ 各有兩個，這就是它們在低頻行為不同的原因。' },
  { id: 'type1-variants', section: '§6.1', kind: 'compare', chart: CHART_TYPE1_VARIANTS, caption: String.raw`Type-I 的三種情況：標稱的 $L_1$ 實部固定在 $-K/2$；多出來的延遲或寄生極點（紅）會把 $\mathrm{Re}\,L$ 在低頻再往下拉，低於 $-1$ 就出現反號帶。` },
  { id: 're-l2', section: '§6.2', kind: 'model', chart: CHART_REL2, caption: String.raw`$L_2$ 的 $\mathrm{Re}\,L$ 由兩條路徑相加：比例路徑給固定的 $-K_p/2$，積分路徑（藍）越低頻越負；總和低於 $-1$ 的頻段就是反號帶。` },
  { id: 're-l3', section: '§6.3', kind: 'model', chart: CHART_REL3, caption: String.raw`$L_3$（CPPLL）的 $\mathrm{Re}\,L$：電荷包之後的相位 $l(t)$ 每拍讀一次，斜坡、步階、指數各變成一條路徑；斜坡那一條（藍）是雙積分，和 $L_2$ 的積分路徑一樣越低頻越負。` },
  { id: 'gos', section: '§7.1', kind: 'model', chart: CHART_GOS, caption: String.raw`GOS：鋸齒拆成很多條諧波，各自乘上該頻率的 $\mathrm{Re}\,\Gamma_{\rm eff}$ 再加總。基波（藍）只占一部分功率，其餘折回全頻帶。最後一格的 $\kappa_{GOS}=12\cdot C_{GOS}$ 用的是均勻鋸齒的 $\mathrm{var}(\rho)=\tfrac{1}{12}$（$\beta$ 為無理數）。` },
  { id: 'align', section: '§7.2', kind: 'timing', chart: CHART_ALIGN, caption: '相關器延遲 $D$ 的時序：比較器在第 $n$ 拍的輸出 $q[n]$，必須乘上同一拍的 code $x[n]$（$D=0$）；晚一拍就乘到別的 code。' },
  { id: 'near-grid', section: '§7.2', kind: 'model', chart: CHART_NEARGRID, caption: String.raw`near-grid 的慢鋸齒拆成「慢斜坡」加「每 $1/\beta$ 拍一次的跳變」：斜坡那一條給 $+\beta S_\infty/2$；跳變那一條（藍）乘到的 regressor 取決於相關器延遲 $D$，晚一拍就多出 $-\beta$。` },
  { id: 'phos-modes', section: '§8.1', kind: 'model', chart: CHART_PHOS_MODES, caption: 'PHOS：8 個 one-hot 的矩陣是 circulant，可以拆成 DFT 模態各自分析；mode 1（藍）的基波就是 PMUX 的旋轉頻率，拿走約 95% 的權重。' },
  { id: 'mode1-bounds', section: '§8.2', kind: 'flow', chart: CHART_MODE1_BOUNDS, caption: String.raw`mode-1 的判斷流程：先算基波頻率上的 $\mathrm{Re}\,H_{PD}$，再用其餘權重的最好與最壞情況夾出上下界。` },
  { id: 'alias', section: '§8.4', kind: 'path', chart: CHART_ALIAS, caption: String.raw`alias 區：$\alpha$ 靠近 $\tfrac14$ 時，mode 4 的 regressor 變成很慢的方波（藍），基波被折回低頻；它落進反號帶時只會近乎抵消，不會穩定反號。` },
  { id: 'joint', section: '§9', kind: 'flow', chart: CHART_JOINT, caption: String.raw`GOS 與 PHOS 能不能分開看：只要 $8\mid Q$（或 $\alpha$ 是無理數），$9\times9$ 矩陣就拆成互不相干的兩塊。` },
  { id: 'psd', section: '§9', kind: 'model', chart: CHART_PSD, caption: 'PSD 定理：頻道決定譜線落在哪裡（管不了），但設計者可以選藍色的 $G$，把 kernel 的實部做成處處不為負。' },
  { id: 'sim-measure', section: '§10.1', kind: 'flow', chart: CHART_SIM_MEASURE, caption: String.raw`時域 sim 量 $\kappa$ 的步驟：重點在藍色那一步的正規化，用的是同一段紀錄的開迴路值。` },
  { id: 'large-signal', section: '§10.4', kind: 'compare', chart: CHART_LARGE_SIGNAL, caption: '小訊號與大訊號的差別：誤差一大，比較器的平均輸出就只剩正負號（紅），相關量從「面積」變成「同號的時間比例」。' },
  { id: 'remedy-g', section: '§11', kind: 'compare', chart: CHART_REMEDY_G, caption: '對策並排：全部只換 GMAC 前的那一格 $G$。綠色讓 kernel 的實部處處不為負；紅色有害；藍色（去平均）不改線性的 $C$，但擋得住 offset。' },
  { id: 'onediff', section: '§11.1', kind: 'compare', chart: CHART_ONEDIFF, caption: '一階差分為什麼安全：regressor 多做一次差分（藍），剛好消掉 Type-II 迴路的一個積分器，kernel 的實部就不再是負的。' },
  { id: 'onediff-delay', section: '§11.1', kind: 'compare', chart: CHART_ONEDIFF_DELAY, caption: String.raw`一階差分的保證也看迴路：Type-I 延遲 1 拍時 $g(\Omega)$ 恆正；延遲 $d\ge2$ 拍時，差分消不掉多出來的延遲（紅），$K>1-\cos(\pi/d)$ 就出現負值。` },
  { id: 'fx', section: '§11.2', kind: 'path', chart: CHART_FX, caption: String.raw`filtered-x：regressor 先通過迴路的數位模型（藍），和誤差那一條路徑的相位對齊；兩者相位差在 $90^\circ$ 以內就安全。` },
  { id: 'p-only', section: '§11.3', kind: 'architecture', chart: CHART_PONLY, caption: 'P-only（以 $L_2$ 為例）：校準時斷開藍色的 hold 開關，積分路徑的輸出不再變動，迴路暫時只剩比例路徑與 VCO，也就是 Type-I。' },
  { id: 'finite-step', section: '§12', kind: 'loop', chart: CHART_FINITE_STEP, caption: String.raw`有限步長：沿一個特徵方向，每個 block 把誤差乘上 $1-\kappa/N_\tau$；$\kappa$ 是複數，所以要看整個複數的大小，不能只看實部。` },
  { id: 'offset', section: '§13', kind: 'path', chart: CHART_OFFSET, caption: '比較器 offset 的路徑（紅）：DC 經過 sign 之後變成 $q$ 的平均值，再乘上 regressor 的平均值，成為和誤差無關的 forcing；zero-mean regressor（綠）把這條路切斷。' },
  { id: 'sim-loop', section: '§14', kind: 'loop', chart: CHART_SIM_LOOP, caption: '實驗 C 每一拍做的事：注入誤差 → 迴路 → 1-bit 比較器 → GMAC；每 $N$ 拍更新一次權重。不同對策只差在藍色那一格。' },
  { id: 'keepout', section: '§15.2', kind: 'flow', chart: CHART_KEEPOUT, caption: 'keep-out 的判斷流程（raw 或 ac 才需要）：①②③ 三個檢查任何一個成立就列入；改用 1diff 或 filtered-x，第一個判斷就直接走到「不需要 keep-out」。' },
  { id: 'handcalc', section: '§15.3', kind: 'flow', chart: CHART_HANDCALC, caption: '綜合手算的順序：①②③⑤ 各自獨立，④（藍）把 ① 和 ③ 相減，得到「在不在反號帶內」。' },
  { id: 'output-spur', section: '§15.4', kind: 'path', chart: CHART_OUTPUT_SPUR, caption: String.raw`殘餘誤差到輸出的路：PHOS 殘差先拆成 DFT 模態、每個模態再拆成譜線，GOS 殘差拆成鋸齒諧波；所有線都乘上藍色的 $\lvert T(f)\rvert$ 才到 VCO 輸出，變成一根根 fractional spur 與積分 jitter。` },
  { id: 'hardware', section: '§18', kind: 'architecture', chart: CHART_HARDWARE, caption: '數學量對應的硬體：藍色是 1diff 需要的兩件事，延遲對齊與「一個暫存器加一個減法器」。' },
]

const BY_ID = new Map(DIAGRAMS.map((d, i) => [d.id, { def: d, no: i + 1 }]))

/** 以 id 取得圖的定義與圖號（「圖 CS-n」，n 為頁面順序） */
export function diagramById(id: string): { def: DiagramDef; no: number; label: string } {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`未登錄的方塊圖 ${id}`)
  return { ...e, label: `圖 CS-${e.no}` }
}
