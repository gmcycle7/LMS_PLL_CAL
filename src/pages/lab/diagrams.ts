/**
 * 本頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 圖內的數學一律寫 LaTeX（使用者要求，2026-10-11）：節點與連線的「雙引號標籤」裡把數學放在 `$...$`，文字照常寫，
 *   由共用的 <Mermaid> 用 KaTeX 排版。所以每張圖的原始碼都用 `String.raw`（TeX 的反斜線只寫一次）；
 *   標籤內不寫 `\\`（Mermaid 會收成一個反斜線），換行用 `<br/>`；也不直接寫 `<`、`>`（用 `\lt`、`\gt`）。
 *   單位與名稱（fs、FCW、GMAC、DTC…）照舊寫成文字。含括號、冒號、等號等特殊字元的標籤一律用雙引號包住。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）；
 *   正負號後面還有說明文字時，負號寫成 `$-$`（KaTeX 的文字模式不認得 U+2212，會在主控台警告）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample n／block k）都和頁面上的公式一致；
 *   diagrams.test.ts 以真正的 mermaid parser 解析每一張，並逐條核對極性與節點數（≤ 14）。
 * - 顏色（深淺主題都看得清楚）：藍 = 校正迴路看到的那條路／這一段的主角；棕 = 與它對照的另一條路。
 * - 九級的編號對應 unifiedLab.ts 的 StageId 與 Lab 裡的 stage 卡片。
 * - 版面（docs/teaching-style.md §8）：桌機上每張圖都要放進正文欄、不用橫向捲動（node scripts/diagram-audit.mjs --routes /lab 的「超出」為 0）。
 *   很長的鏈（九級訊號鏈、更新迴路）用 flowchart TB 由上往下流；較短的圖用 `<br/>` 把長公式與節點文字排成兩三行。
 *   公式為了窄一點被 `<br/>` 拆成兩行時寫成 `$A =$<br/>$B$`（每一行各自是完整的 `$...$`）。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'

/**
 * §2：FCW 到輸出端的九級訊號鏈（訊號流，不是電路接線）。架構照 docs/assumptions.md §2a：DTC 在 reference 輸入端，
 * 殘差 $e_{\mathrm{DTC}}$ 從 PD 的 reference 輸入進到主迴路，分兩條路：$H_{\mathrm{PD}}$（藍，到 PD 的輸出）與 $T$（棕，到輸出）。
 * comparator 的輸入是第 4 級的輸出 $u_{\mathrm{pd}}$——PD 的輸出，也就是送進 loop filter 的同一個訊號。
 */
export const PIPELINE_CHART = String.raw`flowchart TB
  FCW["FCW $= N_{\mathrm{int}} + \alpha$"] --> DSM["1 DSM<br/>first-order / MASH 1-1-1"]
  DSM -->|"residue $r[n]$"| NORM["2 code 正規化<br/>$x = (r - o)\cdot s$"]
  NORM -->|"$x[n]$"| DTC["3 DTC<br/>在 reference 輸入端<br/>gain / offset / INL"]
  DTC -->|"$e_{\mathrm{DTC}}[n]$"| HPD["4 PLL error path（到 PD 的輸出）<br/>$H_{\mathrm{PD}} = \frac{1}{1+L}$"]
  DTC -->|"$e_{\mathrm{DTC}}[n]$"| TOUT["9 輸出端<br/>$T = \frac{L}{1+L}$"]
  HPD -->|"PD 輸出 $u_{\mathrm{pd}}[n]$"| CMP["5 Comparator<br/>1-bit，雜訊 $\sigma_v$，offset $b$"]
  CMP -->|"$q[n]$"| GMAC["6 GMAC<br/>$N$ 筆 $q\cdot x_{\mathrm{ref}}$ 的平均（或總和）"]
  NORM -->|"$x_{\mathrm{ref}}$：raw / delayed / filtered"| GMAC
  GMAC -->|"$G_k$"| UPD["8 更新<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]
  UPD -->|"$w_k$"| REG["7 Gain register<br/>$w_{\mathrm{app}} = \mathrm{phys}(w_{k-d})$"]
  REG -->|"$w_{\mathrm{app}}$"| DTC
  TOUT -->|"$t_{\mathrm{out}}[n]$"| OUT["jitter / PSD / spur"]
  ${FOCUS}
  ${ALT}
  class HPD focus
  class TOUT alt`

/**
 * §4.4：主 PLL 的負回授，照電路的接法畫（docs/assumptions.md §2a）：Reference clock → DTC → phase detector → loop filter → VCO，
 * 回授是 VCO → divider → phase detector——回授路徑上只有 divider（DIV），DTC 不在裡面。
 * DTC 在 reference 輸入端，所以殘差 $e_{\mathrm{DTC}}$ 從 PD 的 reference 輸入（＋）進來；divider 的輸出接到 PD 的 feedback 輸入（−）。
 * 加法點就是 phase detector：$u_{\mathrm{pd}} = e_{\mathrm{DTC}} - \theta_{\mathrm{fb}}$、$\theta_{\mathrm{fb}} = L\,u_{\mathrm{pd}}$
 * ⇒ $u_{\mathrm{pd}} = +e_{\mathrm{DTC}}/(1+L)$、$t_{\mathrm{out}} = \theta_{\mathrm{fb}} = +\frac{L}{1+L}\,e_{\mathrm{DTC}}$（兩個都是正號）。
 * 本頁的訊號都以時間（fs）計：divider 不改變 edge 的時間誤差（增益 1），所以 divider 前後都是 $\theta_{\mathrm{fb}}$，它也就是輸出端的 $t_{\mathrm{out}}$。
 * PD 的輸出 $u_{\mathrm{pd}}$ 畫成一個節點（U）：loop filter 與 comparator 都從這個節點拉線——校正迴路的輸入就是 PD 的輸出，
 * 也就是送進 loop filter 的同一個訊號（$H_{\mathrm{PD}}$）；回授量本身就是輸出端被移動的量（$T$）。
 * 排版：邊的宣告順序決定哪一段被畫成回授。先宣告前向的 E → S → U → L，最後才宣告 L → DIV → S，
 * divider 才會排在前向路徑的下方、由右往左接回 PD（和一般 PLL 方塊圖的畫法相同）。
 */
export const CHART_TWO_PATHS = String.raw`flowchart LR
  E(["Reference clock → DTC<br/>殘差 $e_{\mathrm{DTC}}[n]$"]) -- "＋" --> S
  subgraph PD["Phase detector"]
    S(("＋"))
  end
  S --> U(["PD 的輸出 $u_{\mathrm{pd}}[n]$<br/>$= e_{\mathrm{DTC}} - \theta_{\mathrm{fb}}$"])
  U --> L["open loop $L(z)$<br/>loop filter + VCO"]
  U --> CMP["comparator 取 PD 的輸出<br/>$u_{\mathrm{pd}} = H_{\mathrm{PD}}\cdot e_{\mathrm{DTC}}$<br/>$H_{\mathrm{PD}} = \frac{1}{1+L}$，high-pass"]
  L -- "$\theta_{\mathrm{fb}}[n]$" --> OUT["到 PLL 輸出：使用者看到的<br/>$t_{\mathrm{out}} = \theta_{\mathrm{fb}} = T\cdot e_{\mathrm{DTC}}$<br/>$T = \frac{L}{1+L}$，low-pass"]
  L -- "$\theta_{\mathrm{fb}} = L\cdot u_{\mathrm{pd}}$" --> DIV["Divider<br/>回授路徑上只有它"]
  DIV -- "−" --> S
  ${FOCUS}
  ${ALT}
  class CMP focus
  class OUT alt`

/**
 * §4.7：block rate（索引 $k$）的校正迴路，含更新延遲 $d$。
 * $G_k = K\,\delta_{k-d} + \eta_k$、$w_{k+1} = w_k + \mu\,G_k$、$\delta = a - w$ ⇒ $\delta_{k+1} = \delta_k - g\,\delta_{k-d} - \mu\,\eta_k$，$g = \mu K$。
 */
export const CHART_UPDATE_LOOP = String.raw`flowchart TB
  A(["$a$<br/>真實的 DTC gain"]) -- "＋" --> S1(("＋"))
  S1 -- "$\delta_{k-d} = a - w_{k-d}$" --> KB["$\times K$<br/>GMAC 斜率 $K = K_q\cdot C$"]
  KB -- "＋" --> S2(("＋"))
  ETA(["$\eta_k$：GMAC 雜訊<br/>變異數 $\sigma_\eta^2 \approx E[x_{\mathrm{ref}}^2]/N$"]) -- "＋" --> S2
  S2 -- "$G_k = K\cdot\delta_{k-d} + \eta_k$" --> MU["$\times \mu$<br/>learning rate"]
  MU -- "$\mu\cdot G_k$" --> ACC["累加器 $\frac{1}{z-1}$<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]
  ACC -- "$w_k$" --> DLY["$z^{-d}$<br/>更新延遲 $d$ 個 block"]
  DLY -- "$-$（$w_{\mathrm{app}} = w_{k-d}$）" --> S1
  ${FOCUS}
  ${ALT}
  class KB,MU focus
  class DLY alt`

/**
 * §4.9：輸出端的兩個成分。$e_{\mathrm{DTC}} = (a - \bar w)\,x + d(x) - \delta w\,x$，$t_{\mathrm{out}} = T\{e_{\mathrm{DTC}}\}$。
 * 靜態殘差留下 fractional spur；gain 抖動「乘上」code 之後才是隨機 jitter。
 */
export const CHART_OUTPUT_SPLIT = String.raw`flowchart LR
  X(["code $x[n]$"]) --> M1["$\times (a - \bar w)$<br/>靜態的 gain 殘差"]
  X --> DX["$d(x)$<br/>offset 與 INL"]
  X --> M2["$\times \delta w_k$<br/>gain 抖動，RMS $= \sigma_w$"]
  M1 -- "＋" --> S(("＋"))
  DX -- "＋" --> S
  M2 -- "−" --> S
  S -- "$e_{\mathrm{DTC}}[n]$" --> T["$T(z) = \frac{L}{1+L}$<br/>output transfer，low-pass"]
  T -- "靜態殘差那一份" --> SPUR["fractional spur<br/>$A_{\mathrm{spur}} =$<br/>$\lvert a - \bar w\rvert\cdot s\cdot A_1\cdot\lvert T(f_1)\rvert$"]
  T -- "gain noise 那一份" --> JIT["隨機 jitter<br/>$\mathrm{Var} \approx$<br/>$\sigma_w^2\cdot(\bar x^2 + \mathrm{Var}(T\{\tilde x\}))$"]
  ${FOCUS}
  ${ALT}
  class M1,SPUR focus
  class M2,JIT alt`

/** §7：五個分頁各自跑什麼。Pipeline／FCW sweep／Monte Carlo 共用基準參數；全部呼叫同一份模擬核心。 */
export const CHART_TAB_MAP = String.raw`flowchart TB
  BASE(["基準參數（三個分頁共用）<br/>FCW、DSM、PLL、$\sigma_v$、$\mu$、$N$、$d$、定點"])
  BASE --> PIPE["Pipeline<br/>1 組參數 $\times$ 1 個 seed<br/>九級中間訊號、<br/>jitter / spur"]
  BASE --> SWEEP["FCW sweep<br/>只換 $\alpha$，其他不動<br/>$C$、bias、spur<br/>對 $\alpha$ 的曲線"]
  BASE --> MC["Monte Carlo<br/>1 組參數 $\times$ 很多 seed<br/>信賴區間、<br/>對照 mean-field"]
  OWN1(["Training 自己的設定<br/>code 來源、$\alpha$、<br/>正規化"]) --> TRAIN["Training<br/>不跑迴路，只分析 code<br/>PSD、相關、<br/>Jacobian 的秩"]
  OWN2(["Compare 自己的設定<br/>最多三組<br/>完整參數"]) --> CMPR["Compare A / B / C<br/>同一個 seed<br/>成對比較"]
  PIPE --> CORE["同一份模擬核心<br/>unifiedLab.ts（Web Worker）"]
  SWEEP --> CORE
  MC --> CORE
  TRAIN --> CORE
  CMPR --> CORE
  ${FOCUS}
  class CORE focus`

/** 頁面上的圖（依出現順序）；diagrams.test.ts 逐一解析，index.test.tsx 核對頁面真的畫了這幾張。 */
export const LAB_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'PIPELINE_CHART', section: '§2', chart: PIPELINE_CHART },
  { name: 'CHART_TWO_PATHS', section: '§4.4', chart: CHART_TWO_PATHS },
  { name: 'CHART_UPDATE_LOOP', section: '§4.7', chart: CHART_UPDATE_LOOP },
  { name: 'CHART_OUTPUT_SPLIT', section: '§4.9', chart: CHART_OUTPUT_SPLIT },
  { name: 'CHART_TAB_MAP', section: '§7', chart: CHART_TAB_MAP },
]
