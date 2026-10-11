import type { SystemBlock } from '@/components'

/**
 * 案例頁 /case/sspll 的方塊圖（docs/teaching-style.md §8）。
 *
 * - 每張圖的 Mermaid 原始碼都是具名匯出的字串；diagrams.test.tsx 以真正的 mermaid parser 逐一解析。
 * - DIAGRAMS 的順序就是頁面上的順序；頁面用 common.tsx 的 <Diagram id="…" /> 以 id 查表，圖號「圖 CS-n」由順序自動產生。
 * - 圖上的訊號名稱、正負號與取樣率必須和正文公式一致：
 *     δ = 真值 − 估計（δ_g = a − w_g、δ_k = ε_k − w_k）；H_PD ≡ 1 時 w ← w + μ·q·r 為正確方向；
 *     e_PD = u − y、Y = L·E_PD ⇒ H_PD = 1/(1 + L)；[n] = 比較器 sample（每個 T_ref 一拍）、[k] = GMAC block（N 拍）；
 *     Γ_eff = H_PD·conj(G)；1/(z−1) = z⁻¹/(1 − z⁻¹)（積分器含 1 拍延遲）。
 * - Mermaid 不渲染 KaTeX，所以節點文字用 Unicode 數學符號；含括號、冒號、等號、不等號的文字一律用雙引號包住。
 * - 注意 Mermaid 11 會把每個標籤當成 Markdown 解析：以 ASCII 的「+」「-」「*」或「1.」開頭的標籤會被當成清單，畫面上變成
 *   「Unsupported markdown: list」。所以加法點與正負號一律用全形「＋」與 U+2212 的「−」，不用 ASCII 的 + 與 -
 *   （diagrams.test.tsx 會真的把每張圖畫成 SVG 檢查）。
 */

/** 顏色（深淺主題都看得清楚）：focus＝本圖的主角、ok＝安全／推薦、warn＝反號／有害 */
const STYLE = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff`

/** 章首系統地圖要標成藍色的方塊：整個主 PLL 迴路 + 小數累加器與 regressor + 比較器、對齊、GMAC */
export const MAP_FOCUS: SystemBlock[] = ['pd', 'lf', 'vco', 'div', 'dtc', 'dsm', 'res', 'cmp', 'align', 'gmac']

/** §0.1 一句話回答：誤差先被主迴路「吃過」才到比較器；regressor 的功率落在 Re H_PD < 0 的頻帶就反號 */
export const CHART_ANSWER = `flowchart LR
  U["注入的誤差 u[n]<br/>GOS + PHOS"] --> H["主 PLL 迴路<br/>H_PD = 1/(1 + L)"]
  H -->|"e_PD = h_PD * u"| CMP["1-bit 比較器<br/>q = sign(e_PD + v)"]
  CMP -->|"q[n] = ±1"| X(("×"))
  R["regressor r_i[n]<br/>DTC code、PMUX one-hot"] --> X
  X --> AVG["GMAC：一個 block 的平均<br/>= 平均梯度"]
  AVG --> D{"regressor 的功率主要落在<br/>Re H_PD < 0 的頻帶？"}
  D -- "否" --> GOOD["梯度與誤差同向<br/>LMS 收斂"]
  D -- "是" --> BAD["梯度反向<br/>LMS 把權重推離真值"]
  class H focus
  class GOOD ok
  class BAD warn${STYLE}`

/** §1 本章路線圖：每一節回答哪一個問題 */
export const CHART_ROADMAP = `flowchart TB
  Q0["問題：GOS、PHOS 的 LMS 為什麼會反號？"] --> S2["§2 架構<br/>誤差從哪裡注入、regressor 長什麼樣"]
  S2 --> S3["§3 誤差 → PD<br/>H_PD = 1/(1 + L)"]
  S3 --> S4["§4 LMS 的平均更新<br/>C = regressor 功率 × Re Γ 的加權和"]
  S4 --> S5["§5、§6 Re H_PD 在哪裡是負的<br/>Type-I、Type-II、CPPLL 的反號帶"]
  S5 --> S7["§7 GOS<br/>鋸齒 regressor"]
  S5 --> S8["§8 PHOS<br/>8 相 circulant 的模態"]
  S7 --> S9["§9 兩者一起看<br/>9×9 與 PSD 定理"]
  S8 --> S9
  S9 --> S10["§10 模擬證據<br/>小訊號、大訊號、閉迴路"]
  S9 --> S11["§11 對策<br/>1diff、filtered-x、P-only…"]
  S11 --> S12["§12 有限步長、§13 比較器 offset<br/>線性特徵值看不到的兩件事"]
  S10 --> S15["§14 自己跑閉迴路 LMS<br/>§15 checklist 與 keep-out"]
  S12 --> S15
  class S3,S4,S5 focus${STYLE}`

/** §2 使用者的 SSPLL：feedback 端 8 相 PMUX（粗調）+ reference 端 input DTC（細調）+ 1-bit 比較器 + GMAC／LMS（既有的圖，原樣保留） */
export const SSPLL_CHART = `flowchart LR
  ACC["分數累加器<br/>FCW = N_int + α<br/>φ[n] = frac(nα)"] -->|"ρ[n]（細部殘差）"| DTC
  ACC -->|"p[n]（相位索引）"| PMUX
  REF["4 GHz reference"] --> DTC["input DTC<br/>延遲 = (1−a)(1+w_g)·ρΔ + PHOS 修正"]
  DTC --> SUM(("相位比較點<br/>（SSPD 取樣）"))
  VCO["VCO（f_vco）"] --> PMUX["8 相 PMUX<br/>第 k 相實際延遲 k/8·T_vco + ε_k"]
  PMUX --> SUM
  SUM -->|"e_PD = h_PD * u"| LF["loop filter／SSCP<br/>（L1：P；L2：P+I；L3：R+C1∥C2）"]
  LF --> VCO
  SUM --> CMP["1-bit 比較器<br/>q = sign(e_PD + v)"]
  CMP --> GMAC["GMAC：Σ q·r_i<br/>（N = 512 sample 一個 block）"]
  ACC -->|"regressor x_i[n]"| GMAC
  GMAC --> LMS["sign-error LMS<br/>w_g, w_0 … w_7"]
  LMS --> DTC`

/** §2 小數相位的拆法：累加器 φ[n] → ×8 → 整數部分 p[n]（PMUX）與小數部分 ρ[n]（DTC） */
export const CHART_PHASE_SPLIT = `flowchart LR
  A["FCW 的小數 α"] -- "＋" --> S(("＋"))
  S --> F["取小數<br/>frac(·)"]
  F -->|"φ[n] = frac(nα)"| X8["× 8"]
  F --> Z["z⁻¹"]
  Z -- "＋ φ[n−1]" --> S
  X8 -->|"8φ[n]，範圍 0 到 8"| FL["floor：取整數部分<br/>（累加器的高 3 位）"]
  FL -->|"p[n] = 0, 1, …, 7"| PM["8 相 PMUX<br/>粗調：p[n]·Δ"]
  X8 -- "＋" --> D(("＋"))
  FL -- "−" --> D
  D -->|"ρ[n] = 8φ[n] − p[n]，範圍 0 到 1"| DTC["input DTC<br/>細調：ρ[n]·Δ"]
  FL --> OH["PHOS 的 regressor<br/>x₁₊ₖ[n] = 1{p[n] = k}"]
  D --> X0["GOS 的 regressor<br/>x₀[n] = ρ[n]"]
  class PM,DTC focus${STYLE}`

/** §2 兩個誤差的注入點：GOS（reference 端 DTC）與 PHOS（feedback 端 PMUX）相加成 u[n]，經 H_PD 才到 PD */
export const CHART_INJECTION = `flowchart LR
  RHO["x₀[n] = ρ[n]<br/>DTC code"] --> MG(("×"))
  DG["δ_g·Δ = (a − w_g)·Δ<br/>DTC 增益誤差 − 估計"] --> MG
  OH["x₁₊ₖ[n] = 1{p[n] = k}<br/>PMUX 選到第 k 相"] --> MP(("×"))
  DK["δ_k = ε_k − w_k<br/>第 k 相偏差 − 估計"] --> MP
  MG -- "＋ e_GOS[n]（reference 端：DTC）" --> SU(("＋"))
  MP -- "＋ e_PHOS[n]（feedback 端：PMUX，8 相加總）" --> SU
  SU -->|"u[n]：比較點的時間誤差"| H["主 PLL 迴路<br/>H_PD(z) = 1/(1 + L(z))"]
  H -->|"e_PD[n] = (h_PD * u)[n]"| OUT["PD 輸出<br/>→ 1-bit 比較器"]
  class H focus${STYLE}`

/** §3 迴路的回授結構：e_PD = u − y、y = L·e_PD ⇒ H_PD = 1/(1 + L) */
export const CHART_HPD_LOOP = `flowchart LR
  U["外加誤差 u[n]<br/>GOS + PHOS"] -- "＋" --> S(("＋"))
  subgraph LOOP["L(z)：開迴路增益（至少 1 拍延遲）"]
    direction LR
    LF["loop filter<br/>SSCP 或 CP + RC"] --> VCO["VCO：頻率 → 相位（積分）<br/>＋ 取樣到生效的 1 拍延遲"]
  end
  S -->|"e_PD[n]"| LF
  VCO -- "− y[n]（迴路的修正）" --> S
  S -->|"e_PD[n]"| CMP["1-bit 比較器<br/>校正迴路從這裡取訊號"]
  class S focus${STYLE}`

/** §4.1 玩具模型 e = g·(a − w)·x：只差在迴路把誤差乘上 g = +1 或 g = −0.2 */
export const CHART_TOY = `flowchart TB
  subgraph CASEA["情況 A：沒有迴路，g = +1"]
    direction LR
    A1["誤差 δ·x<br/>δ = a − w"] --> A2["× g = +1"] --> A3["q = sign(e)，e = g·δ·x<br/>與 δ·x 同號"] --> A4["w ← w + μ·q·x<br/>往 a 靠近"]
  end
  subgraph CASEB["情況 B：迴路把殘差反相縮小，g = −0.2"]
    direction LR
    B1["誤差 δ·x<br/>δ = a − w"] --> B2["× g = −0.2"] --> B3["q = sign(e)，e = g·δ·x<br/>與 δ·x 反號"] --> B4["w ← w + μ·q·x<br/>離 a 越來越遠"]
  end
  class A4 ok
  class B2,B4 warn${STYLE}`

/** §4.2 真正的校正迴路：快的部分每個 sample n 做一次，慢的部分每個 block k 做一次 */
export const CHART_LMS_LOOP = `flowchart LR
  X["regressor x_j[n]<br/>ρ[n] 與 8 個 one-hot"] --> M1(("×"))
  V["雜訊 v[n]<br/>標準差 σ_v"] -- "＋" --> AD(("＋"))
  subgraph FAST["快：每個 sample n（每個 T_ref 一拍）"]
    direction LR
    M1 -->|"u[n] = Σ_j δ_j·x_j[n]"| H["H_PD(z)<br/>主 PLL 迴路"]
    H -- "＋ e_PD[n]" --> AD
    AD --> SG["sign(·)<br/>1-bit 比較器"]
    SG -->|"q[n] = ±1"| M2(("×"))
    GZ["前置濾波 G(z)<br/>raw：G = 1"] -->|"r_i[n]"| M2
  end
  X --> GZ
  subgraph SLOW["慢：每個 block k（N 個 sample）"]
    direction LR
    AVG["(1/N)·Σ<br/>一個 block 的平均"] -->|"G_i[k]"| MU["× μ"]
    MU --> ACC["累加<br/>w_i[k+1] = w_i[k] + μ·G_i[k]"]
  end
  M2 --> AVG
  ACC -->|"9 個權重 w[k]"| DEL["δ_j[k] = 真值 − w_j[k]<br/>9 個權重誤差"]
  DEL --> M1
  class H,GZ focus${STYLE}`

/** §4.2 取平均並線性化之後的等效迴路（block rate）：δ[k+1] = δ[k] − μ·K_q·C·δ[k] */
export const CHART_MEAN_LOOP = `flowchart LR
  S(("＋")) -->|"δ[k+1]"| Z["z⁻¹<br/>延遲一個 block"]
  Z -- "＋ δ[k]" --> S
  Z -->|"δ[k]：9 個權重誤差"| C["C：9×9 矩陣<br/>C_ij = ⟨r_i·(h_PD * x_j)⟩"]
  C --> KQ["× K_q<br/>比較器的等效增益"]
  KQ -->|"E[G[k]] ≈ K_q·C·δ[k]"| MU["× μ"]
  MU -- "−" --> S
  C -.-> E["沿 C 的每個特徵方向：<br/>δ 每個 block 乘上 1 − μ·K_q·λ<br/>μ 夠小時 Re λ > 0 收斂；Re λ < 0 反號"]
  class C focus${STYLE}`

/** §4.3 頻域：C 是每條譜線的功率乘上 Γ_eff 再加總 */
export const CHART_SPECTRAL = `flowchart LR
  XJ["x_j[n]<br/>第 ν 條譜線：係數 c_ν^j，頻率 f_ν"] --> H["× H_PD(f_ν)<br/>誤差 → PD"]
  XI["x_i[n]<br/>第 ν 條譜線：係數 c_ν^i，頻率 f_ν"] --> G["× G(f_ν)<br/>regressor 前置濾波"]
  H --> P(("相關<br/>⟨ · ⟩"))
  G -- "取共軛" --> P
  P -- "只有同頻率的線留下來，逐線相加" --> C["C_ij = Σ_ν conj(c_ν^i)·c_ν^j·Γ_eff(f_ν)<br/>Γ_eff = H_PD·conj(G)"]
  C --> DG["對角項 C_ii = Σ_ν |c_ν^i|²·Re Γ_eff(f_ν)<br/>= 每條線的功率 × 該頻率的 Re Γ_eff"]
  class H,G focus${STYLE}`

/** §5.1 反號恆等式：Re L < −1 ⟺ Re H_PD < 0 ⟺ Re T > 1 ⇒ |T| > 1 */
export const CHART_IDENTITY = `flowchart LR
  L["開迴路 L 在頻率 f 的值<br/>（一個複數）"] --> Q{"Re L < −1？<br/>落在直線 Re = −1 的左邊"}
  Q -- "是" --> N["1 + Re L < 0<br/>⇒ Re H_PD < 0"]
  N --> T["Re T = 1 − Re H_PD > 1<br/>⇒ |T| > 1：在 peaking 區"]
  T --> INV["這個頻率的譜線<br/>貢獻負的梯度"]
  Q -- "否" --> P["Re H_PD ≥ 0"]
  P --> POS["這個頻率的譜線<br/>貢獻正（或零）的梯度"]
  class INV warn
  class POS ok${STYLE}`

/**
 * §5.2 低頻的 H_PD ≈ 1/L：Type-II 把慢誤差做兩次差分（反向），Type-I 只做一次差分（差 90°）。
 * 1/L₂ ≈ (1 − z⁻¹)²/(K_i·z⁻¹)、1/L₁ = (1 − z⁻¹)/(K·z⁻¹)：分母的 z⁻¹ 是迴路的 1 拍延遲，除以它＝提前 1 拍（把差分對到中心）。
 */
export const CHART_LOWFREQ = `flowchart TB
  subgraph TYPE2["Type-II（兩個積分器）：低頻 H_PD ≈ 1/L"]
    direction LR
    U2["慢誤差 u[n]"] --> A2["差分<br/>1 − z⁻¹"] --> B2["再差分一次<br/>1 − z⁻¹"] --> C2["÷ (K_i·z⁻¹)<br/>除以 z⁻¹：提前 1 拍"] --> E2["e_PD ≈ u 的中心二次差分 ÷ K_i<br/>⟨u·u''⟩ < 0：與 u 反向"]
  end
  subgraph TYPE1["Type-I（一個積分器）：低頻 H_PD ≈ 1/L"]
    direction LR
    U1["慢誤差 u[n]"] --> A1["差分<br/>1 − z⁻¹"] --> C1["÷ (K·z⁻¹)<br/>除以 z⁻¹：提前 1 拍"] --> E1["e_PD ≈ u 的一次差分 ÷ K<br/>⟨u·u'⟩ = 0：與 u 差 90°"]
  end
  class B2,E2 warn${STYLE}`

/** §6 三個迴路並排：積分器的個數與 loop filter 的結構（藍色＝含一個積分器的方塊） */
export const CHART_THREE_LOOPS = `flowchart TB
  subgraph LOOP1["L1：SSPLL Type-I（1 個積分器）"]
    direction LR
    I1(["e_PD"]) --> K1["比例增益 K"] --> V1["VCO 積分 + 1 拍延遲<br/>1/(z−1)"] --> O1(["y"])
  end
  subgraph LOOP2["L2：SSPLL Type-II（2 個積分器）"]
    direction LR
    I2(["e_PD"]) --> F2["P + I loop filter<br/>K_p + K_i/(1 − z⁻¹)"] --> V2["VCO 積分 + 1 拍延遲<br/>1/(z−1)"] --> O2(["y"])
  end
  subgraph LOOP3["L3：傳統 CPPLL（2 個積分器 + 1 個極點）"]
    direction LR
    I3(["e_PD"]) --> F3["CP → R + C1 ∥ C2<br/>(1 + s/ω_z) / (s·(1 + s/ω_p))"] --> V3["VCO<br/>K/s"] --> SM["每個 T_ref 取樣一次<br/>impulse-invariant → L₃(z)"] --> O3(["y"])
  end
  class V1,F2,V2,F3,V3 focus${STYLE}`

/** §6.1 Type-I 不是天生免疫：多出來的延遲或寄生極點（紅）會把 Re L 往下拉 */
export const CHART_TYPE1_VARIANTS = `flowchart TB
  subgraph T1NOM["標稱 L1（d = 1）：Re L = −K/2，不會低於 −1（K < 2）"]
    direction LR
    N1(["e_PD"]) --> N2["K"] --> N3["1/(z−1)"] --> N4(["y"])
  end
  subgraph T1LAT["迴路共延遲 d 拍：Re L 最低到 −K·(d − 1/2)"]
    direction LR
    A1(["e_PD"]) --> A2["K"] --> A3["1/(z−1)"] --> A4["多出來的延遲<br/>z^(−(d−1))"] --> A5(["y"])
  end
  subgraph T1POLE["多一個寄生極點 p：Re L 最低到 −K·(1/2 + p/(1 − p))"]
    direction LR
    B1(["e_PD"]) --> B2["K"] --> B3["1/(z−1)"] --> B4["寄生極點<br/>(1 − p)/(1 − p·z⁻¹)"] --> B5(["y"])
  end
  class A4,B4 warn${STYLE}`

/** §6.2 L2 的 Re L：比例路徑給固定的 −K_p/2，積分路徑越低頻越負；兩者相加小於 −1 的頻段就是反號帶 */
export const CHART_REL2 = `flowchart LR
  E["L₂ 的兩條路徑"] --> P["比例路徑<br/>K_p·z⁻¹/(1 − z⁻¹)"]
  E --> I["積分路徑<br/>K_i·z⁻¹/(1 − z⁻¹)²"]
  P -- "實部 −K_p/2（每個頻率都一樣）" --> S(("＋"))
  I -- "實部 −K_i/(4·sin²(Ω/2))（越低頻越負）" --> S
  S -->|"Re L₂"| Q{"Re L₂ < −1？"}
  Q -- "是：f < f_inv" --> INV["反號帶：Re H_PD < 0<br/>從 DC 一路到 f_inv"]
  Q -- "否：f ≥ f_inv" --> POS["Re H_PD ≥ 0"]
  class I focus
  class INV warn
  class POS ok${STYLE}`

/**
 * §6.3 L3（CPPLL，impulse-invariant）的 Re L：電荷包之後的相位 l(t) = K·t + B·(1 − e^(−ω_p·t)) 每拍讀一次，
 * 斜坡、步階、指數各變成一條離散路徑；三條路徑的實部相加（取負號就是 F-CS.9 的 −Re L₃）。
 */
export const CHART_REL3 = `flowchart LR
  LT["CP 在 t = 0 打進一個窄電荷包<br/>之後的相位 l(t) = K·t + B·(1 − e^(−ω_p·t))"] --> SM["每拍讀一次<br/>L₃(z) = Σ l(n)·z⁻ⁿ，n ≥ 1"]
  SM --> R["斜坡 K·t → 雙積分路徑<br/>K·z⁻¹/(1 − z⁻¹)²"]
  SM --> ST["步階 B → 單積分路徑<br/>B·z⁻¹/(1 − z⁻¹)"]
  SM --> EX["指數 −B·e^(−ω_p·t) → 極點 p = e^(−ω_p)<br/>−B·p·z⁻¹/(1 − p·z⁻¹)"]
  R -- "實部 −K/(4·sin²(Ω/2))（越低頻越負）" --> S(("＋"))
  ST -- "實部 −B/2（每個頻率都一樣）" --> S
  EX -- "實部 −B·p·(cos Ω − p)/(1 − 2p·cos Ω + p²)" --> S
  S -->|"Re L₃"| Q{"Re L₃ < −1？"}
  Q -- "是：f < f_inv" --> INV["反號帶：Re H_PD < 0<br/>從 DC 一路到 f_inv"]
  Q -- "否：f ≥ f_inv" --> POS["Re H_PD ≥ 0"]
  class R focus
  class INV warn
  class POS ok${STYLE}`

/** §7.1 GOS：鋸齒 ρ[n] 的每條諧波乘上該頻率的 Re Γ_eff 再加總 */
export const CHART_GOS = `flowchart LR
  R["ρ[n] = frac(nβ)<br/>鋸齒，β = frac(8α)"] --> F["拆成譜線<br/>Fourier 級數"]
  F --> D0["DC：平均 1/2"]
  F --> M1["m = 1：頻率 β<br/>功率 1/(2π²)"]
  F --> M2["m = 2：頻率 frac(2β)<br/>功率 1/(8π²)"]
  F --> MM["m ≥ 3：頻率 frac(mβ)，折回全頻帶<br/>功率 1/(2π²m²)"]
  D0 -- "× Γ_eff(0) = 0" --> S(("Σ"))
  M1 -- "× Re Γ_eff(β)" --> S
  M2 -- "× Re Γ_eff(frac(2β))" --> S
  MM -- "× Re Γ_eff(frac(mβ))" --> S
  S --> C["C_GOS<br/>κ_GOS = 12·C_GOS"]
  class M1 focus${STYLE}`

/** §7.2 相關器延遲 D：q[n] 必須和同一拍的 x[n] 相乘 */
export const CHART_ALIGN = `sequenceDiagram
  participant ACC as 分數累加器
  participant AFE as DTC／PMUX 與 SSPD
  participant CMP as 1-bit 比較器
  participant REG as regressor 暫存器
  participant GM as GMAC
  Note over ACC,GM: 第 n 拍（一個 reference 週期）
  ACC->>AFE: code ρ[n]、p[n]
  ACC->>REG: x[n]
  AFE->>CMP: e_PD[n]，含這一拍剛注入的 u[n]（h_PD[0] = 1）
  CMP->>GM: q[n] = sign(e_PD[n] + v[n])
  REG->>GM: r[n] = x[n − D]
  Note over GM: D = 0 時 q[n] 乘上同一拍的 x[n]（正確）
  Note over GM: D = +1 時 q[n] 乘上前一拍的 x[n − 1]（有害）`

/**
 * §7.2 near-grid（β → 0）的慢鋸齒 = 慢斜坡（每拍 +β）+ 每 1/β 拍一次的 −1 跳變（wrap）：
 * 斜坡經 H_PD 的穩態響應 β·S∞ 乘上 ⟨ρ⟩ = 1/2；每次 wrap 的響應 −s[m] 乘上 wrap 附近的 regressor x[n − D]，wrap 的頻率是每拍 β 次。
 * 相加就是 F-CS.12：C_GOS ≈ (β/2)·(S∞ − 2·S_D) − β²·Σ m·s[m]（s = h_PD 的步階響應，S∞ = Σ s[n]，S_D = Σ_{n<D} s[n]）。
 */
export const CHART_NEARGRID = `flowchart LR
  RHO["near-grid 的 ρ[n]<br/>β 很小：很慢的鋸齒"] --> RAMP["慢斜坡<br/>每拍 +β"]
  RHO --> WRAP["wrap：每 1/β 拍<br/>跳一次 −1"]
  RAMP -->|"經 H_PD：穩態是常數 β·S∞"| T1["× ρ 的平均 1/2"]
  WRAP -->|"經 H_PD：−s[m]，m = wrap 之後第幾拍"| T2["× wrap 附近的 regressor x[n − D]<br/>前 D 拍：乘到跳之前的 ρ ≈ 1<br/>之後：乘到剛歸零的 ρ ≈ β·m"]
  T1 -- "＋ β·S∞/2" --> S(("＋"))
  T2 -- "＋ (−β·S_D − β²·Σ m·s[m])，每拍有 β 次 wrap" --> S
  S --> C["C_GOS ≈ (β/2)·(S∞ − 2·S_D) − β²·Σ m·s[m]"]
  C --> I1["Type-I：S∞ = 1/K<br/>⇒ +β/(2K)"]
  C --> I2["Type-II、D = 0：S∞ = 0、S_D = 0<br/>⇒ +β²/K_i（很小：dead zone）"]
  C --> I3["Type-II、D = 1：S_D = s[0] = 1<br/>⇒ −β（反號）"]
  class T2 focus
  class I1 ok
  class I3 warn${STYLE}`

/** §8.1 PHOS：8 個 one-hot → circulant → DFT 模態；每個模態的基波頻率與權重 */
export const CHART_PHOS_MODES = `flowchart LR
  P["p[n]：PMUX 相位索引<br/>以 α·f_ref 繞圈"] --> OH["8 個 one-hot regressor<br/>x₁₊ₖ[n] = 1{p[n] = k}"]
  OH --> C["8×8 矩陣 C<br/>C_jk 只依賴 (j − k) mod 8<br/>⇒ circulant"]
  C --> F["特徵向量 = DFT 向量<br/>v_m[k] = e^(j2πmk/8)"]
  F --> M0["m = 0：8 相一起偏（共模）<br/>λ₀ = 0"]
  F --> M1["m = 1、7：繞一圈一個弦波<br/>基波 α·f_ref，權重 W₁ ≈ 0.95"]
  F --> M2["m = 2、6<br/>基波 2α·f_ref，權重 ≈ 0.81"]
  F --> M3["m = 3、5<br/>基波 3α·f_ref，權重 ≈ 0.61"]
  F --> M4["m = 4：奇偶相交替<br/>基波 4α·f_ref，權重 ≈ 0.81（±4 兩條線合計）"]
  class M1 focus${STYLE}`

/** §8.2 mode-1 的嚴格界限：一定反號／不可能反號／要算完整的諧波和 */
export const CHART_MODE1_BOUNDS = `flowchart TB
  A["h = Re H_PD(f_rot)，f_rot = min(α, 1 − α)·f_ref<br/>基波拿走權重 W₁，其餘 1 − W₁ 散在別的頻率"] --> U{"其餘權重全放在最有利的頻率也救不回來？<br/>上界 W₁·h + (1 − W₁)·max Re H_PD < 0"}
  U -- "是" --> SURE["mode-1 一定反號"]
  U -- "否" --> LO{"其餘權重全放在最不利的頻率也不會變負？<br/>下界 W₁·h + (1 − W₁)·min Re H_PD ≥ 0"}
  LO -- "是" --> NEVER["mode-1 不可能反號"]
  LO -- "否" --> MID["界限跨過 0<br/>要算完整的諧波和（實驗 B）"]
  class SURE warn
  class NEVER ok${STYLE}`

/**
 * §8.4(c) alias 區：α 靠近 1/4 時 mode 4 的 regressor (−1)^p[n] 是頻率 4·|α − 1/4| 的慢方波（基波權重 8/π²）；
 * 基波落進反號帶也只會近乎抵消（0.81·min Re H_PD + 0.19·max Re H_PD > 0），是 dead zone。
 * 圖上不用正文那一小段的 δ（= α − 1/4），避免和權重誤差 δ 混淆；寫法與 CHART_KEEPOUT 的 ② 相同。
 */
export const CHART_ALIAS = `flowchart LR
  A["頻道 α 靠近 1/4<br/>偏移 α − 1/4 很小，可正可負"] --> P["4φ[n] 每拍前進 4α = 1 + 4·(α − 1/4)<br/>整數的 1 看不到，只剩 4·(α − 1/4)"]
  P --> M4["mode 4 的 regressor (−1)^p[n]<br/>frac(4φ[n]) < 1/2 時是 +1，否則 −1"]
  M4 --> SQ["頻率 4·|α − 1/4|·f_ref 的慢方波<br/>基波權重 8/π² ≈ 0.81"]
  SQ --> Q{"4·|α − 1/4|·f_ref 落在反號帶？<br/>也就是 |α − 1/4|·f_ref < f_inv/4"}
  Q -- "是" --> DZ["基波（81%）落在負區，其餘 19% 散在 3、5、7… 倍頻<br/>κ 的上界最低也有 0.81·min Re H_PD + 0.19·max Re H_PD > 0：不保證反號<br/>實際近乎抵消 ⇒ dead zone"]
  Q -- "否" --> POS["基波在正區<br/>mode 4 不受 alias 影響"]
  A -.-> HALF["α 靠近 1/2 同理：<br/>mode 2 的基波在 2·|α − 1/2|·f_ref<br/>mode 4 的基波在 4·|α − 1/2|·f_ref"]
  class SQ focus
  class DZ warn
  class POS ok${STYLE}`

/** §9(a) GOS 與 PHOS 什麼時候可以分開看 */
export const CHART_JOINT = `flowchart LR
  A["頻道 α<br/>最簡分數 P/Q，或無理數"] --> Q{"8 整除 Q，<br/>或 α 是無理數？"}
  Q -- "是" --> BD["8 相佔用率均勻<br/>GOS–PHOS 耦合 C₀ₖ = Cₖ₀ = 0<br/>9×9 = GOS（1×1）＋ PHOS（8×8 circulant）"]
  Q -- "否" --> CP["8 相佔用率不均<br/>GOS–PHOS 有耦合，C 不是 normal 矩陣"]
  BD --> R1["分開看<br/>κ_GOS（§7）與 κ_m（§8）"]
  CP --> R2["直接算 9×9 的特徵值<br/>掃描結果：沒有只在 joint 出現的反號"]
  class BD ok${STYLE}`

/** §9(c) PSD 定理：頻道決定譜線落在哪裡（管不了），設計者決定 kernel 的實部（可以選） */
export const CHART_PSD = `flowchart LR
  AL["頻道 α、Q<br/>會換，管不了"] --> LN["譜線位置 f_ν<br/>權重 |a_νᵀv|² ≥ 0"]
  HP["迴路 H_PD(f)<br/>Type-II 有負區"] --> GA["kernel<br/>Γ_eff(f) = H_PD(f)·conj(G(f))"]
  G["regressor 前置濾波 G(f)<br/>設計者可以選"] --> GA
  LN --> S(("Σ"))
  GA -- "在每條線上取 Re Γ_eff(f_ν)" --> S
  S --> LAM["Re λ = Σ_ν Re Γ_eff(f_ν)·|a_νᵀv|²"]
  LAM --> Q{"Re Γ_eff(f) ≥ 0<br/>對所有 f 成立？"}
  Q -- "是：1diff、filtered-x" --> SAFE["Re λ ≥ 0<br/>任何 α、任何 Q 都不反號"]
  Q -- "否：raw 配 Type-II" --> RISK["譜線落進負區<br/>就可能反號"]
  class G focus
  class SAFE ok
  class RISK warn${STYLE}`

/** §10.1 時域 sim 怎麼量 κ：凍結 LMS、擾動權重、量 GMAC 的斜率、用開迴路值正規化 */
export const CHART_SIM_MEASURE = `flowchart LR
  A["凍結 LMS<br/>權重停在校準點"] --> B["把第 j 個權重<br/>擾動 ±30 fs"]
  B --> C["跑 2¹⁶ 個 sample<br/>記錄 GMAC 的平均 G_i"]
  C --> D["斜率矩陣<br/>GMAC 平均對權重擾動的斜率"]
  D --> E["÷ 同一段紀錄在 H_PD ≡ 1 時的斜率<br/>（開迴路參考）"]
  E --> F["κ：1 = 和沒有迴路時一樣<br/>正 = 往回拉，負 = 反號"]
  class E focus${STYLE}`

/** §10.4 大訊號：1-bit 比較器飽和後只剩正負號，相關看的是「同號的時間比例」而不是「面積」 */
export const CHART_LARGE_SIGNAL = `flowchart LR
  D["誤差方向 d_v[n]<br/>振幅 A"] --> H["H_PD"]
  H -->|"y_v[n] = (h_PD * d_v)[n]"| S{"A 和雜訊 σ_v<br/>比起來"}
  S -- "A ≪ σ_v：小訊號" --> LIN["比較器的平均輸出 ∝ y_v<br/>大小還在"]
  S -- "A ≫ σ_v：大訊號" --> SGN["比較器的平均輸出 → sgn(y_v)<br/>只剩正負號"]
  LIN --> C1["與 regressor z_v 相關：⟨y_v·z_v⟩<br/>看的是面積 → C_vv"]
  SGN --> C2["⟨sgn(y_v)·z_v⟩<br/>看的是同號的時間比例 → κ∞"]
  class SGN,C2 warn${STYLE}`

/** §11 對策並排：只換 GMAC 前的 regressor 前置濾波 G(z)（綠＝安全、紅＝有害） */
export const CHART_REMEDY_G = `flowchart LR
  X["x_i[n]<br/>ρ[n] 或 one-hot"] --> RAW["raw：G = 1<br/>r = x"]
  X --> ZM["ac／zm：減掉平均<br/>GOS 減 1/2，zm 連 PHOS 的 1/8 也減"]
  X --> D1["一階差分：G = 1 − z⁻¹<br/>r[n] = x[n] − x[n−1]"]
  X --> FX["filtered-x：G = Ĥ_PD(z)<br/>r = ĥ_PD * x"]
  X --> DK["相關器晚 D 拍：G = z^(−D)<br/>r[n] = x[n − D]"]
  X --> D2["二階差分：G = (1 − z⁻¹)²"]
  RAW --> R["r_i[n]<br/>擇一"]
  ZM --> R
  D1 --> R
  FX --> R
  DK --> R
  D2 --> R
  R --> M(("×"))
  Q["q[n]<br/>比較器輸出"] --> M
  M --> GM["GMAC<br/>(1/N)·Σ q·r_i"]
  class ZM focus
  class D1,FX ok
  class DK,D2 warn${STYLE}`

/** §11.1 一階差分為什麼安全：regressor 的差分消掉迴路的一個積分器 */
export const CHART_ONEDIFF = `flowchart TB
  subgraph KRAW["raw：Γ = H_PD"]
    direction LR
    A1["L₂ 有兩個積分器"] --> A2["低頻 H_PD ≈ 1/L₂<br/>= 兩次差分 ÷ K_i"] --> A3["Re Γ ≈ −Ω²/K_i < 0<br/>低頻一定反號"]
  end
  subgraph KDIFF["一階差分：Γ_1d = H_PD·conj(1 − z⁻¹)"]
    direction LR
    B1["regressor 的差分 1 − z⁻¹ 消掉一個積分器<br/>(1 − z⁻¹)·L₂ = K_p·z⁻¹ + K_i·z⁻¹/(1 − z⁻¹)"] --> B2["Re Γ_1d 的分子<br/>g(Ω) = 1 − K_i/2 − (1 − K_p)·cos Ω"] --> B3["K_i ≤ 2K_p 且 K_p + K_i/2 ≤ 2<br/>⇒ 每個頻率 Re Γ_1d ≥ 0"]
  end
  class A3 warn
  class B1 focus
  class B3 ok${STYLE}`

/** §11.1 補充：Type-I、延遲 d 拍時一階差分的 g(Ω) = 1 − cos Ω + K·cos(d·Ω)——差分消掉積分器，但多出來的延遲還在 */
export const CHART_ONEDIFF_DELAY = `flowchart TB
  subgraph LAT1["Type-I、延遲 1 拍（標稱 L1）"]
    direction LR
    P1["(1 − z⁻¹)·L = K·z⁻¹<br/>差分消掉積分器"] --> G1["g(Ω) = 1 − cos Ω + K·cos Ω<br/>= 1 − (1 − K)·cos Ω"] --> R1["最小值 min(K, 2 − K) > 0<br/>一階差分安全（0 < K < 2）"]
  end
  subgraph LATD["Type-I、延遲 d 拍（d ≥ 2）"]
    direction LR
    P2["(1 − z⁻¹)·L = K·z^(−d)<br/>積分器消掉了，多出來的延遲還在"] --> G2["g(Ω) = 1 − cos Ω + K·cos(d·Ω)"] --> R2["Ω = π/d 時 g = 1 − cos(π/d) − K<br/>K > 1 − cos(π/d) 就有負值"]
  end
  class R1 ok
  class P2,R2 warn${STYLE}`

/** §11.2 filtered-x：regressor 先通過迴路的數位模型，兩條路徑的相位就對齊 */
export const CHART_FX = `flowchart LR
  XJ["誤差 δ_j·x_j[n]<br/>造成誤差的那一條 regressor"] --> H["真正的迴路<br/>H_PD(z)"]
  H -->|"e_PD[n]"| CMP["1-bit 比較器"]
  CMP -->|"q[n]"| M(("×"))
  XI["x_i[n]<br/>拿來相關的那一條"] --> HH["迴路的數位模型 Ĥ_PD(z)<br/>9 條 IIR，以 f_ref 全速運作"]
  HH -->|"r_i[n] = (ĥ_PD * x_i)[n]"| M
  M --> GM["GMAC 平均"]
  GM --> K["等效 kernel Γ_fx = H_PD·conj(Ĥ_PD)<br/>兩者相位差 ≤ 90° ⇒ Re Γ_fx ≥ 0<br/>模型精確時 Γ_fx = |H_PD|²"]
  class HH focus
  class K ok${STYLE}`

/** §11.3 P-only（以 $L_2$ 為例）：校準時 hold 住積分路徑，迴路暫時變成 Type-I */
export const CHART_PONLY = `flowchart LR
  E["e_PD[n]"] --> KP["比例路徑<br/>K_p"]
  E --> SW["hold 開關<br/>校準時斷開"]
  SW --> KI["積分路徑 K_i/(1 − z⁻¹)<br/>輸出凍結在 hold 前的值"]
  KP -- "＋" --> S(("＋"))
  KI -- "＋（校準時是常數）" --> S
  S --> V["VCO 積分 + 1 拍延遲<br/>1/(z−1)"]
  V -->|"y[n]"| O["回到比較點（−）"]
  V -.-> N["校準期間 L = K_p/(z−1)：Type-I<br/>判據 K_p·(d − 1/2) < 1 ⇒ Re H_PD ≥ 0"]
  class SW,KI focus
  class N ok${STYLE}`

/** §12 有限步長：沿一個特徵方向的 block-rate 迴路，κ 是複數 */
export const CHART_FINITE_STEP = `flowchart LR
  S(("＋")) -->|"θ[k+1]"| Z["z⁻¹<br/>延遲一個 block"]
  Z -- "＋ θ[k]" --> S
  Z -->|"θ[k]"| K["× κ/N_τ<br/>κ 是複數"]
  K -- "−" --> S
  K -.-> Q{"|1 − κ/N_τ| < 1？<br/>也就是 Re κ > |κ|²/(2·N_τ)"}
  Q -- "是" --> GOOD["每個 block 都縮小<br/>收斂"]
  Q -- "否" --> BAD["不收斂：Re κ ≤ 0（反號），<br/>或 Re κ > 0 但虛部太大，誤差繞著放大"]
  class GOOD ok
  class BAD warn${STYLE}`

/** §13 比較器 offset：DC 經過 sign 變成 E[q] ≠ 0，再乘上 regressor 的平均，成為與誤差無關的 forcing */
export const CHART_OFFSET = `flowchart LR
  E["e_PD[n]<br/>平均為 0"] -- "＋" --> A(("＋"))
  V["雜訊 v[n]"] -- "＋" --> A
  OS["DC offset u_os"] -- "＋" --> A
  A --> SG["sign(·)"]
  SG -->|"q[n]，平均 E[q] = erf(u_os/(√2·σ_v)) ≠ 0"| M(("×"))
  R["regressor r_i[n]<br/>平均 ⟨r_i⟩"] --> M
  M --> AVG["block 平均<br/>E[G_i]"]
  AVG --> F["forcing 項：E[q]·⟨r_i⟩<br/>和誤差 δ 無關"]
  AVG --> RS["恢復項：K_q(u_os)·(C·δ)_i<br/>eig(C) 只描述這一項"]
  ZM["zero-mean regressor<br/>1diff、zm：⟨r_i⟩ = 0"] -. "切斷 forcing" .-> F
  class OS,F warn
  class ZM ok${STYLE}`

/** §14 實驗 C 每一拍在做什麼（runSspllLms 的 sample() 與 block 更新） */
export const CHART_SIM_LOOP = `flowchart TB
  SEQ["分數累加器（每拍 n）<br/>ρ[n]、p[n]"] --> ID["該補的量 + PMUX 偏差<br/>ρ·Δ + ε_p"]
  SEQ --> DT["DTC 實際補上的量<br/>(1 − a)(1 + w_g)·(ρ·Δ + w_p)"]
  ID -- "＋" --> S(("＋"))
  DT -- "−" --> S
  S -->|"u[n]"| H["迴路 h_PD<br/>L1、L2、L3 或 P-only"]
  H -->|"e_PD[n]"| CMP["q[n] = sign(e_PD + v + u_os)"]
  SEQ --> REG["regressor 變體 → r[n]<br/>raw、1diff、filtered-x…"]
  CMP --> GM["GMAC 累加<br/>G_i += q·r_i"]
  REG --> GM
  GM -- "每 N 拍一次（block k）" --> UP["w_g += μ_g·G₀/N<br/>w_k += μ_p·G₁₊ₖ/N<br/>然後把 G 清零"]
  UP -- "新的 w_g、w_k" --> DT
  class REG focus${STYLE}`

/** §15.2 一個頻道要不要列入 keep-out（給 raw／ac regressor 用） */
export const CHART_KEEPOUT = `flowchart TB
  A["頻道 α<br/>f_rot = min(α, 1 − α)·f_ref，β = frac(8α)"] --> R{"regressor 是 1diff（D = 0、min g ≥ 0）<br/>或 filtered-x（模型相位差 ≤ 90°）？"}
  R -- "是" --> FREE["不需要 keep-out<br/>線性與大訊號都沒有反號"]
  R -- "否：raw 或 ac" --> B{"① f_rot 在 mode-1 可能反號的帶內？<br/>W₁·h(f_rot) + (1 − W₁)·min h < 0<br/>各 PVT 角落取聯集，下緣從 0 MHz 算起"}
  B -- "是" --> KO["列入 keep-out"]
  B -- "否" --> C{"② α 靠近 1/4 或 1/2？<br/>4·|α − 1/4|·f_ref 或 2·|α − 1/2|·f_ref<br/>落在反號帶"}
  C -- "是" --> KO
  C -- "否" --> D{"③ α 靠近 k/8（β 接近 0 或 1），<br/>而且有 offset 或大訊號？"}
  D -- "是" --> KO
  D -- "否" --> SAFE["可以用 raw／ac 校準<br/>仍要 zero-mean 與 offset trim"]
  KO --> ACT["這個頻道不更新（freeze），<br/>或換成 1diff、filtered-x、P-only"]
  class FREE,SAFE ok
  class KO warn${STYLE}`

/** §15.3 綜合手算 HC-CS.8 的計算順序 */
export const CHART_HANDCALC = `flowchart LR
  IN["輸入<br/>α、f_ref、K_p、K_i"] --> A["① f_rot = min(α, 1 − α)·f_ref<br/>PMUX 的旋轉頻率"]
  IN --> B["② β = frac(8α)<br/>f_saw = min(β, 1 − β)·f_ref"]
  IN --> C["③ f_inv = (f_ref/π)·arcsin √(K_i/(2·(2 − K_p)))<br/>反號帶上緣"]
  IN --> E["⑤ min g = min{K_p − K_i/2, 2 − K_p − K_i/2}"]
  A --> D["④ f_rot − f_inv"]
  C --> D
  D --> R1["負：PHOS mode-1 在反號帶內<br/>正：在帶外"]
  B --> R2["min(β, 1 − β) 很小：GOS 是 near-grid"]
  E --> R3["min g ≥ 0：一階差分可以用"]
  class D focus${STYLE}`

/** §18 數學量對應的硬體：code 的 pipeline、差分、GMAC、權重暫存器 */
export const CHART_HARDWARE = `flowchart LR
  ACC["分數累加器（數位）"] -->|"高 3 位"| SEL["PMUX select p[n]<br/>解碼成 8 條 one-hot"]
  ACC -->|"低位"| CODE["DTC code<br/>ρ[n]"]
  SEL --> PIPE["pipeline 延遲對齊<br/>D = 0，兩條各自對齊"]
  CODE --> PIPE
  PIPE --> DIFF["每條 regressor：<br/>1 個暫存器 + 1 個減法器<br/>G = 1 − z⁻¹"]
  DIFF --> GM["GMAC<br/>9 個累加器，N 拍清一次"]
  SSPD["SSPD 的 hold 節點<br/>e_PD"] --> CMP["1-bit 比較器<br/>先做 offset trim"]
  CMP -->|"q[n]"| GM
  GM --> W["權重暫存器 w_g、w_0…w_7<br/>clamp 在 DTC range 內"]
  W --> COR["修正 DTC 的延遲<br/>w_g 調增益、w_k 補偏移"]
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
  /** 圖說：一句話說明要看什麼；數學一律寫成 `$...$`（<Mermaid caption> 會用 KaTeX 渲染；反斜線多的用 String.raw）。圖內節點文字才用 Unicode 數學符號 */
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
    caption: String.raw`使用者的 SSPLL：分數除頻由 feedback 端的 8 相 PMUX（粗調，每格 $\Delta=T_{vco}/8$）加上 reference 端的 input DTC（細調，範圍一格 $\Delta$）實現；1-bit 比較器接在 SSPD 的取樣節點。`,
    alt: 'SSPLL 方塊圖：分數累加器送出 PMUX 相位索引與 DTC 細部殘差；DTC 與 PMUX 的誤差在相位比較點注入，經 loop filter 與 VCO 形成迴路；比較器輸出與 regressor 進入 GMAC 與 sign-error LMS，更新 DTC 的校正係數。',
  },
  { id: 'phase-split', section: '§2', kind: 'model', chart: CHART_PHASE_SPLIT, caption: String.raw`小數相位的拆法：累加器的值乘 8 之後，整數部分 $p[n]$ 給 PMUX（藍，粗調），小數部分 $\rho[n]$ 給 DTC（藍，細調）；同樣這兩個數就是 PHOS 與 GOS 的 regressor。` },
  { id: 'injection', section: '§2', kind: 'path', chart: CHART_INJECTION, caption: '兩個誤差的注入點：GOS 從 reference 端的 DTC 進來、PHOS 從 feedback 端的 PMUX 進來，在比較點加成 $u[n]$；兩者都要先經過藍色的 $H_{PD}$ 才到 PD。' },
  { id: 'hpd-loop', section: '§3', kind: 'loop', chart: CHART_HPD_LOOP, caption: '主迴路的回授：藍色加法點做 $e_{PD}=u-y$，外框是開迴路增益 $L(z)$。比較器看到的是加法點的輸出，不是 $u$ 本身。' },
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
  { id: 'gos', section: '§7.1', kind: 'model', chart: CHART_GOS, caption: String.raw`GOS：鋸齒拆成很多條諧波，各自乘上該頻率的 $\mathrm{Re}\,\Gamma_{\rm eff}$ 再加總。基波（藍）只占一部分功率，其餘折回全頻帶。` },
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
  { id: 'hardware', section: '§18', kind: 'architecture', chart: CHART_HARDWARE, caption: '數學量對應的硬體：藍色是 1diff 需要的兩件事，延遲對齊與「一個暫存器加一個減法器」。' },
]

const BY_ID = new Map(DIAGRAMS.map((d, i) => [d.id, { def: d, no: i + 1 }]))

/** 以 id 取得圖的定義與圖號（「圖 CS-n」，n 為頁面順序） */
export function diagramById(id: string): { def: DiagramDef; no: number; label: string } {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`未登錄的方塊圖 ${id}`)
  return { ...e, label: `圖 CS-${e.no}` }
}
