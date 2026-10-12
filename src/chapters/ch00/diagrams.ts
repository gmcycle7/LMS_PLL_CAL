import type { SystemBlock } from '@/components'

/**
 * Ch00 的全部方塊圖（docs/teaching-style.md §8）。
 *
 * - 每張圖是一個具名的 Mermaid 原始碼字串（CHART_*），並登記在 DIAGRAMS；頁面用 common.tsx 的 <ChapterDiagram id="D-00.n"> 顯示。
 * - diagrams.test.tsx 會用真正的 mermaid parser 解析每一張，並逐一核對訊號名稱、相加點的正負號、δ = a − w 的極性、
 *   sample（n）／block（k）兩種速率，以及圖在頁面上的位置（必須在它要說明的公式／推導之前）。
 *
 * 圖上的寫法（標籤裡的數學一律寫 `$...$`，共用的 <Mermaid> 元件用 KaTeX 排版，和正文同一套樣式）：
 * - 圖的原始碼用 `String.raw` 樣板字串，TeX 的反斜線只寫一次；換行用 `<br/>`，標籤裡不要寫 `\\`（Mermaid 會把它收成一個反斜線）。
 * - 標籤的數學裡不用 ASCII 的 < >（Mermaid 會先把它們轉成 HTML 實體，KaTeX 就讀不懂）：不等式寫 `\lt` `\gt` `\le` `\ge`。
 * - 方括號是時間索引：$x[n]$ 就是公式裡的 $x_n$；$w[k]$ 就是 $w_k$（n = sample、k = block）。
 * - 圓圈 $+$ 是相加點，進入它的線以 $(+)$ 或 $(-)$ 開頭標出正負號；圓圈 $\times$ 是乘法器。
 * - $z^{-1}$ 是延遲一拍的暫存器。
 * - Mermaid 11 會把「沒有公式」的標籤當 Markdown 處理：只有一個 ASCII「+」或「-」的標籤、以「+ 」「- 」「* 」「1. 」「# 」開頭的標籤
 *   都會被畫成「Unsupported markdown: list」。含 `$...$` 的標籤整個交給 KaTeX，不會碰到這個問題；純文字的標籤仍要避開這些寫法。
 *   這些只有真的 render 才看得出來（parse 不會報錯），diagrams.test.tsx 會逐張 render 檢查。
 * - 顏色：藍 focus = 這張圖的主角；紅 warn = 雜訊或會出問題的地方；綠 ok = 結果；深灰 box = 打不開的黑盒子。
 */

/** 章首系統地圖要標成藍色的方塊：regressor、× w、比較器、GMAC、÷N × μ、gain accumulator——也就是 LMS 校正迴路本身。 */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['res', 'gc', 'cmp', 'gmac', 'scale', 'acc']

const CLASS_DEFS = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff
  classDef box fill:#3d4450,stroke:#1f242c,color:#ffffff`

/** §0.1（F-00.1）黑盒子模型：y = a·x + v、ŷ = w·x、e = y − ŷ。 */
export const CHART_BLACKBOX_MODEL = String.raw`flowchart LR
  X["輸入 $x$"] --> A["黑盒子<br/>$\times\,a$（未知）"]
  A -- "$(+)$ $a\,x$" --> SV(("$+$"))
  V(["量測雜訊 $v$"]) -- "$(+)$ $v$" --> SV
  SV -- "$(+)$ $y = a\,x + v$" --> SE(("$+$"))
  X --> W["我們的模型<br/>$\times\,w$（可調）"]
  W -- "$(-)$ $\hat y = w\,x$" --> SE
  SE -- "$e = y - \hat y$" --> E["誤差 $e$<br/>錯多少、往哪錯"]
${CLASS_DEFS}
  class A box
  class W focus
  class V warn`

/** §0.1（F-00.10）兩條路：批次最小平方 vs 線上 LMS。 */
export const CHART_BATCH_VS_ONLINE = String.raw`flowchart LR
  D(["資料一筆一筆進來<br/>$x[i]$、$y[i]$"])
  subgraph BATCH["批次 batch：最小平方法"]
    direction LR
    M["記憶體<br/>存下全部資料"] --> SXY["分子<br/>$\sum x[i]\,y[i]$"]
    M --> SXX["分母<br/>$\sum x[i]^2$"]
    SXY --> DIV["除法器 $\div$"]
    SXX --> DIV
    DIV --> LS["$\hat a_{\mathrm{LS}}$<br/>收齊才算一次"]
  end
  subgraph ONLINE["線上 online：LMS"]
    direction LR
    U["每來一筆就修正<br/>$w \leftarrow w + \mu\,e\,x$"] -- "新的 $w$" --> R["一個暫存器 $w$<br/>不存資料、不用除法"]
    R -- "下一筆再用" --> U
  end
  D --> BATCH
  D --> ONLINE
${CLASS_DEFS}
  class U,R focus`

/** §0.2 預測 → 比較 → 修正（每一條線都標出訊號名稱）。 */
export const CHART_LOOP = String.raw`flowchart LR
  X["輸入 $x[n]$"] -- "$x[n]$" --> U["③ 修正<br/>$w[n+1] =$<br/>$w[n] + \mu\,e[n]\,x[n]$"]
  X -- "$x[n]$" --> P["① 預測<br/>$\hat y[n] = w[n]\,x[n]$"]
  P -- "$\hat y[n]$" --> C["② 比較<br/>$e[n] = y[n] - \hat y[n]$"]
  Y["黑盒子輸出 $y[n]$"] -- "$y[n]$" --> C
  C -- "$e[n]$" --> U
  U -- "$w[n+1]$<br/>下一筆資料用" --> P
${CLASS_DEFS}
  class P,C,U focus`

/** §0.3（F-00.2）LMS 更新式畫成硬體：乘法器 e·x、增益 μ、帶 z⁻¹ 的累加器。 */
export const CHART_LMS_ACCUMULATOR = String.raw`flowchart LR
  E["誤差 $e[n]$"] --> M(("$\times$"))
  X["輸入 $x[n]$"] --> M
  M -- "$e[n]\,x[n]$" --> G["$\times\,\mu$"]
  G -- "$(+)$ $\mu\,e[n]\,x[n]$" --> S(("$+$"))
  R["$z^{-1}$ 暫存器<br/>輸出 $w[n]$ 給預測用"] -- "$(+)$ $w[n]$" --> S
  S -- "$w[n+1]$" --> R
${CLASS_DEFS}
  class R focus`

/** §0.4（HC-00.1、T01）手算一步的計算順序；數字是 a = 3、w0 = 1、x = 2、μ = 0.1 的手算例（測試會和 handCalcRows 比對）。 */
export const CHART_HANDCALC_STEP = String.raw`flowchart LR
  IN(["已知<br/>$w[0] = 1$、$x = 2$<br/>$y = 6$、$\mu = 0.1$"]) --> P["① 預測（乘）<br/>$\hat y[0] = w[0]\,x$<br/>$= 1 \times 2 = 2$"]
  P --> C["② 比較（減）<br/>$e[0] = y - \hat y[0]$<br/>$= 6 - 2 = 4$"]
  C --> D["③ 修正量（連乘）<br/>$\Delta w[0] = \mu\,e[0]\,x$<br/>$= 0.1 \times 4 \times 2 = 0.8$"]
  D --> U["④ 更新（加）<br/>$w[1] = w[0] + \Delta w[0]$<br/>$= 1 + 0.8 = 1.8$"]
  U -- "$w[1]$ 帶回 ①<br/>下一圈得<br/>$w[2] = 2.28$" --> P
${CLASS_DEFS}
  class U ok`

/** §0.5 / §0.6（F-00.5）學習率 μ 的大小 → pole p = 1 − μ·x² → 行為。 */
export const CHART_MU_REGIONS = String.raw`flowchart TB
  MU(["選一個學習率 $\mu$<br/>$x$ 固定、沒有雜訊"]) --> P["每步誤差乘上的倍數<br/>$p = 1 - \mu\,x^2$"]
  P --> Q{"$p$ 落在哪一段？"}
  Q -- "$\mu \le 0$<br/>$p \ge 1$" --> F["學不到<br/>$\mu = 0$ 不更新<br/>$\mu \lt 0$ 越修越遠"]
  Q -- "$0 \lt \mu \lt 1/x^2$<br/>$0 \lt p \lt 1$" --> A["單調收斂<br/>$\mu$ 越小越慢"]
  Q -- "$\mu = 1/x^2$<br/>$p = 0$" --> B["一步到位"]
  Q -- "$1/x^2 \lt \mu \lt 2/x^2$<br/>$-1 \lt p \lt 0$" --> C["修過頭、來回震盪<br/>但仍然收斂"]
  Q -- "$\mu \ge 2/x^2$<br/>$p \le -1$" --> DV["不收斂<br/>$\mu = 2/x^2$ 在邊界<br/>再大就發散"]
${CLASS_DEFS}
  class A,B,C ok
  class F,DV warn`

/** §0.6（F-00.3）gradient descent：量斜率 → 往反方向走一步 → 新的 w。 */
export const CHART_GRADIENT_DESCENT = String.raw`flowchart LR
  W["目前的 $w[n]$"] --> SL["量單筆成本的斜率<br/>$j = \tfrac12\,e^2$<br/>$dj/dw = -e\,x$"]
  DATA(["這一筆資料<br/>$x[n]$、$y[n]$<br/>（$e = y - w\,x$）"]) --> SL
  SL --> ST["往反方向走一步<br/>$\Delta w = -\mu\,(dj/dw)$<br/>$= \mu\,e\,x$"]
  ST -- "$(+)$ $\Delta w$" --> S(("$+$"))
  W -- "$(+)$ $w[n]$" --> S
  S --> WN["新的 $w[n+1]$"]
  WN -. "下一筆" .-> W
${CLASS_DEFS}
  class SL focus`

/** §0.6（F-00.4）參數誤差 δ = a − w 的一階迴圈：每繞一圈乘上 p = 1 − μ·x²。 */
export const CHART_ERROR_RECURSION = String.raw`flowchart LR
  R["$z^{-1}$<br/>記住 $\delta[n] = a - w[n]$"] -- "$\delta[n]$" --> MX["$\times\,x$<br/>無雜訊時 $e = \delta\,x$"]
  MX -- "$e[n] = \delta[n]\,x$" --> MG["$\times\,\mu\,x$<br/>修正量 $\mu\,e\,x$"]
  MG -- "$(-)$ $\mu\,x^2\,\delta[n]$" --> S(("$+$"))
  R -- "$(+)$ $\delta[n]$" --> S
  S -- "$\delta[n+1] =$<br/>$(1 - \mu\,x^2)\,\delta[n]$<br/>$= p\,\delta[n]$" --> R
${CLASS_DEFS}
  class S focus`

/** §0.7（F-00.7）e·x 拆成訊號與雜訊兩部分；取平均後只剩訊號。 */
export const CHART_SIGNAL_VS_NOISE = String.raw`flowchart LR
  E["有雜訊的誤差<br/>$e = (a - w)\,x + v$"] --> M(("$\times$"))
  X["輸入 $x$"] --> M
  M -- "$e\,x$ 的第一項" --> SIG["訊號部分 $(a - w)\,x^2$<br/>每筆都和 $(a - w)$ 同號"]
  M -- "$e\,x$ 的第二項" --> NOI["雜訊部分 $v\,x$<br/>時正時負"]
  SIG -- "平均 $(a - w)\,E[x^2]$" --> OUT["取平均 $E[\cdot]$<br/>$E[e\,x] =$<br/>$(a - w)\,E[x^2] + 0$"]
  NOI -- "平均 $0$<br/>$v$ 平均 $0$、和 $x$ 無關" --> OUT
${CLASS_DEFS}
  class SIG ok
  class NOI warn
  class OUT focus`

/** §0.7（F-00.8）平均 N 筆：中心不動，抖動變成 s₁/√N。 */
export const CHART_NOISE_AVERAGING = String.raw`flowchart LR
  Z["$N$ 筆 $e[i]\,x[i]$<br/>單筆平均 $(a - w)\,E[x^2]$<br/>單筆標準差 $s_1$"] --> SUM["$\sum$ 累加 $N$ 筆"]
  SUM -- "訊號 $\propto N$<br/>雜訊 $\propto \sqrt{N}$" --> DIV["$\div N$"]
  DIV --> G["$N$ 筆的平均"]
  G --> MEAN["中心不動<br/>平均 $= (a - w)\,E[x^2]$"]
  G --> STD["抖動變小<br/>標準差 $= s_1 / \sqrt{N}$"]
${CLASS_DEFS}
  class SUM,DIV focus
  class STD ok`

/** §0.7（F-00.9）有雜訊時的 δ 迴圈：雜訊從 μ·x 注入，被 p 的迴圈平均。 */
export const CHART_STEADY_STATE_NOISE = String.raw`flowchart LR
  V(["雜訊 $v[n]$<br/>標準差 $\sigma_v$"]) --> G["$\times\,\mu\,x$"]
  G -- "$(-)$ $\mu\,x\,v[n]$" --> S(("$+$"))
  R["$z^{-1}$<br/>記住 $\delta[n] = a - w[n]$"] -- "$\delta[n]$" --> P["$\times\,p$<br/>$p = 1 - \mu\,x^2$"]
  P -- "$(+)$ $p\,\delta[n]$" --> S
  S -- "$\delta[n+1]$" --> R
  R --> OUT["收斂後 $w$ 的抖動<br/>變異數 $=$<br/>$\mu\,\sigma_v^2 / (2 - \mu\,x^2)$"]
${CLASS_DEFS}
  class V warn
  class P focus
  class OUT ok`

/** §0.8 一般化的 LMS 自適應迴圈。 */
export const CHART_ADAPTIVE_LOOP = String.raw`flowchart LR
  X["參考輸入 $x$<br/>regressor"] --> F["可調係數 $w$<br/>濾波器或增益"]
  D["期望／量到的 $y$"] -- "$(+)$ $y$" --> S(("$+$"))
  F -- "$(-)$ 預測 $\hat y$" --> S
  X --> M(("$\times$"))
  S -- "誤差 $e = y - \hat y$" --> M
  M -- "相關 $e\,x$" --> A["$\times\,\mu$，再累加"]
  A -- "修正後的 $w$" --> F
${CLASS_DEFS}
  class F focus`

/**
 * §0.8 黑盒子的每個符號，在 PLL 的 DTC gain 校正裡是什麼。
 * 物理意義（docs/assumptions.md §2a）：a·x = feedback（divider）edge 比理想時刻早到的時間；w·x = reference 端的 DTC 的補償量
 * （從基準延遲 T_0 往回扣，reference edge 被提前）；PD 量 t_ref′ − t_fb，所以 e = (a − w)·x + v。
 */
export const CHART_BLACKBOX_TO_PLL = String.raw`flowchart LR
  X["DSM 量化殘差<br/>DTC code $x[n]$"] --> A["$\times\,a$<br/>正確的 DTC gain<br/>未知，單位 fs/code"]
  X --> W["$\times\,w$<br/>gain register 的值<br/>DTC 實際補償的量"]
  A -- "$(+)$ $a\,x[n]$" --> S(("$+$"))
  W -- "$(-)$ $w\,x[n]$" --> S
  V(["PD 與比較器前的<br/>雜訊 $v[n]$"]) -- "$(+)$ $v[n]$" --> S
  S --> E["PD 量到的殘留誤差<br/>$e[n] =$<br/>$t_{\mathrm{ref}}'[n] - t_{\mathrm{fb}}[n]$<br/>$= (a - w)\,x[n] + v[n]$"]
${CLASS_DEFS}
  class A box
  class W focus
  class V warn`

/**
 * §0.8 PLL 的 DTC gain 校正迴圈（簡化）：sample 速率的比較器、block 速率的更新。
 * 架構照 docs/assumptions.md §2a：
 *   - DTC 在 reference 輸入端（REF → DTC → PD → loop filter），回授路徑只有 divider（VCO → DIV → PD）；DTC 不在回授路徑上。
 *   - DSM 的 carry 控制 divider，餘數 x[n] 乘上 w（gain correction，併在 DTC 方塊裡）控制 DTC。
 *   - LMS 校正迴路的輸入是 PD 的輸出 e[n]：圖上 PD 有兩條 e[n] 出線，一條去 loop filter、一條去比較器。
 * 版面：dagre 對「迴圈 + 長線」很容易交叉，所以 carry 與 x[n]（給 GMAC）用成對的標籤節點（像電路圖的 net label）代替長線，
 * 其餘全是連線；w 繞回 DTC 的那一條是唯一的長回授線。實際畫出來沒有任何連線交叉，也沒有線從別的方塊後面穿過。
 * 宣告順序有意義：「x[n]（同一個 code）」標籤（XT）要比比較器（CMP）先宣告，dagre 才會把它排在比較器的上方；
 * 反過來的話，PD → 比較器的 e[n] 線會從 XT 後面穿過去，看起來像是「x[n] 接到比較器」（瀏覽器實測過，diagrams.test.tsx 有檢查）。
 * 用 LR 加 init 縮小間距，自然寬度約 1275 px（TB 排版會高到 1000 px 以上）。
 */
export const CHART_PLL_LOOP = String.raw`%%{init: {"flowchart": {"nodeSpacing": 26, "rankSpacing": 24}}}%%
flowchart LR
  REF["參考時脈"] --> DTC["DTC<br/>補償 $w\,x[n]$"]
  DSM["DSM 累加器<br/>餘數 $x[n]$"] --> DTC
  DTC --> PD["PD<br/>$e[n] =$<br/>$(a - w)\,x[n] + v[n]$"]
  PD -- "$e[n]$" --> LF["Loop filter、VCO"]
  LF --> DIV["Divider"]
  DIV --> PD
  XT(["$x[n]$<br/>（同一個 code）"]) --> G["GMAC：平均 $N$ 筆<br/>$G[k] =$<br/>$(1/N)\sum q[n]\,x[n]$"]
  PD -- "$e[n]$" --> CMP["1-bit 比較器<br/>$q[n] =$<br/>$\mathrm{sign}(e[n])$"]
  CMP -- "$q[n]$" --> G
  G -- "$G[k]$" --> U["更新 gain register<br/>$w[k+1] =$<br/>$w[k] + \mu\,G[k]$"]
  U -- "$w$ 給 DTC<br/>每 $N$ 筆才更新一次" --> DTC
  CT(["carry<br/>（來自 DSM）"]) --> DIV
  subgraph CAL["LMS 校正迴路（慢）"]
    XT
    CMP
    G
    U
  end
  subgraph MAIN["主 PLL 路徑（快）"]
    REF
    DSM
    CT
    DTC
    DIV
    PD
    LF
  end
${CLASS_DEFS}
  class CMP,G,U focus`

/** §0.9 Conventional LMS 與 Sign-Error LMS 的資料路徑並排：乘法器 vs 比較器 + 條件變號。 */
export const CHART_LMS_VS_SIGN = String.raw`flowchart LR
  subgraph SGN["Sign-Error LMS"]
    direction LR
    E2["誤差 $e[n]$<br/>只用到正負號"] --> C2["1-bit 比較器<br/>$q[n] = \mathrm{sign}(e[n])$"]
    C2 -- "$q[n]$" --> N2["條件變號<br/>$+1$ 送 $x[n]$<br/>$-1$ 送 $-x[n]$"]
    X2["$x[n]$"] --> N2
    N2 -- "$q[n]\,x[n]$" --> G2["$\times\,\mu$<br/>再累加到 $w$"]
  end
  subgraph LMS["Conventional LMS"]
    direction LR
    E1["誤差 $e[n]$<br/>多位元：要知道大小"] --> M1(("$\times$"))
    X1["$x[n]$"] --> M1
    M1 -- "$e[n]\,x[n]$" --> G1["$\times\,\mu$<br/>再累加到 $w$"]
  end
${CLASS_DEFS}
  class M1 warn
  class C2,N2 focus`

/** §0.9 1-bit 比較器在大雜訊下還留著方向資訊：累加 N 筆之後看總和的正負號。 */
export const CHART_COMPARATOR_AVERAGE = String.raw`flowchart TB
  subgraph ONE["單獨一筆：埋在雜訊裡"]
    direction LR
    S0["真正的誤差 $s$<br/>很小（設 $s \gt 0$）"] -- "$(+)$ $s$" --> ADD(("$+$"))
    V(["雜訊 $v$<br/>$\sigma_v$ 遠大於 $s$"]) -- "$(+)$ $v$" --> ADD
    ADD -- "$e = s + v$" --> CMP["1-bit 比較器<br/>$q = \mathrm{sign}(e)$<br/>$+1$ 的機率 $\Phi(s/\sigma_v)$"]
  end
  subgraph MANY["累加 $N$ 筆：<br/>方向浮出來"]
    direction LR
    SUM["$\sum$ 累加 $N$ 筆：總和 $S_N$<br/>平均 $N\,m_q$<br/>標準差 $\sqrt{N\,(1 - m_q^2)}$"] -- "$S_N$" --> OK["看 $S_N$ 的正負號<br/>判對的機率約<br/>$\Phi(m_q \sqrt{N} / \sqrt{1 - m_q^2})$"]
  end
  ONE -- "$q[i]$：平均 $m_q$<br/>比 $0$ 大一點點" --> MANY
${CLASS_DEFS}
  class V warn
  class CMP,SUM focus
  class OK ok`

/** §0.9 GMAC 與 block 更新：哪些訊號每個 sample（n）動一次，哪些每個 block（k）才動一次。 */
export const CHART_GMAC_BLOCK = String.raw`flowchart TB
  subgraph FAST["每個 sample<br/>（索引 $n$）"]
    direction LR
    E["誤差 $e[n]$"] --> CMP["1-bit 比較器<br/>$q[n] = \mathrm{sign}(e[n])$"]
    CMP -- "$q[n]$" --> M(("$\times$"))
    X["$x[n]$"] --> M
    M -- "$q[n]\,x[n]$" --> SUM["$\sum$ 累加 $N$ 筆<br/>block 結束後清零"]
  end
  subgraph SLOW["每個 block<br/>（索引 $k$）"]
    direction LR
    DIV["總和 $\div N$"] -- "$G[k]$" --> MU["$\times\,\mu$"]
    MU -- "$(+)$ $\mu\,G[k]$" --> S(("$+$"))
    R["$z^{-1}$：延遲一個 block<br/>gain register $w[k]$"] -- "$(+)$ $w[k]$" --> S
    S -- "$w[k+1]$" --> R
  end
  FAST -- "每 $N$ 筆（1 個 block）<br/>交出一次總和" --> SLOW
${CLASS_DEFS}
  class SUM,DIV focus`

/** §0.10（F-00.11）反例：干擾 κ·x 和黑盒子 a·x 走並聯的兩條路，LMS 分不出來。 */
export const CHART_CORRELATED_NOISE = String.raw`flowchart LR
  X["輸入 $x$"] --> A["黑盒子<br/>$\times\,a$"]
  X --> K["跟著 $x$ 走的干擾<br/>$\times\,\kappa$"]
  A -- "$(+)$ $a\,x$" --> S(("$+$"))
  K -- "$(+)$ $\kappa\,x$" --> S
  VP(["獨立雜訊 $v'$<br/>平均 $0$、和 $x$ 無關"]) -- "$(+)$ $v'$" --> S
  S -- "$y = (a + \kappa)\,x + v'$" --> L["LMS<br/>只看得到 $x$ 和 $y$"]
  X --> L
  L --> WS["平均停在<br/>$w^* = a + \kappa$<br/>不是 $a$"]
${CLASS_DEFS}
  class A box
  class K,WS warn`

/** §0.10（HC-00.8）綜合手算的計算順序：四個小題各用一條公式。 */
export const CHART_SYNTHESIS_ORDER = String.raw`flowchart TB
  IN(["已知 $a$、$\kappa$、$\mu$、$\sigma_{v'}$、$n$<br/>$x = \pm 1$，所以 $x^2 = 1$<br/>$E[x^2] = 1$"])
  IN --> A1["① 停在哪<br/>$E[v\,x] = \kappa\,E[x^2]$"]
  A1 --> A2["$w^* = a +$<br/>$E[v\,x] / E[x^2]$"]
  IN --> B1["② 多久到<br/>$p = 1 - \mu\,x^2$"]
  B1 --> B2["降到 $1\%$ 的步數<br/>$\lceil \ln 0.01 \div \ln |p| \rceil$"]
  IN --> C1["③ 抖多大<br/>$\operatorname{Var}(w_\infty) =$<br/>$\mu\,\sigma_{v'}^2 / (2 - \mu\,x^2)$"]
  C1 --> C2["$\operatorname{std}(w_\infty) =$<br/>$\sqrt{\operatorname{Var}(w_\infty)}$"]
  IN --> D1["④ 平均後多準<br/>時間平均的標準差<br/>$\approx \sigma_{v'} / \sqrt{n}$"]
  A2 --> END["比一比<br/>① 的偏移 $w^* - a$<br/>④ 的標準差"]
  D1 --> END
${CLASS_DEFS}
  class A2,B2,C2,D1 ok
  class END warn`

/** 圖的種類（docs/teaching-style.md §8 的分類）。 */
export type DiagramKind = 'model' | 'loop' | 'path' | 'compare' | 'handcalc'

export const DIAGRAM_KIND_LABEL: Record<DiagramKind, string> = {
  model: '數學模型方塊圖',
  loop: '演算法迴圈圖',
  path: '訊號路徑圖',
  compare: '比較圖',
  handcalc: '手算／判斷流程圖',
}

export interface DiagramEntry {
  /** 'D-00.n'；n 就是頁面上的圖號「圖 0.n」（由頁面順序自動編號） */
  id: string
  /** 匯出的常數名稱；章內用 <ChapterDiagram name="CHART_…"> 取圖（測試會確認每個 CHART_* 都有登記） */
  name: string
  kind: DiagramKind
  /** 所在段落的 DOM id */
  section: string
  /** 段落編號（顯示用） */
  sectionLabel: string
  /** 這張圖必須出現在哪個元素之前（DOM id，或另一張圖的 name）：它要說明的公式、推導或手算題 */
  before: string
  /** 圖在說什麼（一句話；數學寫 `$...$`） */
  shows: string
  chart: string
  /**
   * 圖說：告訴讀者要看什麼。數學一律寫成 `$...$`（<Mermaid caption> 會用 KaTeX 排版），不用 Unicode 拼公式；
   * `{CHART_…}` 會換成那張圖的圖號。
   */
  caption: string
  ariaLabel: string
  /** 這次新增（true）或原本就有、只是補上訊號名稱與正負號（false） */
  isNew: boolean
}

type Draft = Omit<DiagramEntry, 'id'>

const DRAFTS = [
  {
    name: 'CHART_BLACKBOX_MODEL',
    kind: 'model',
    section: 'ch00-blackbox',
    sectionLabel: '§0.1',
    before: 'formula-F-00.1',
    shows: String.raw`黑盒子模型：增益方塊 $a$、雜訊相加點、我們的模型 $w$、誤差相減點`,
    chart: CHART_BLACKBOX_MODEL,
    caption: String.raw`黑盒子模型。深灰色那條路是真實世界（未知的 $a$，再加上紅色的雜訊 $v$），藍色那條路是我們的模型（可調的 $w$）；兩者在最右邊相減，得到誤差 $e=y-\hat y$。`,
    ariaLabel: '輸入 x 經過未知增益 a 再加上雜訊 v 得到輸出 y；同一個 x 經過可調增益 w 得到預測；輸出減預測得到誤差 e',
    isNew: true,
  },
  {
    name: 'CHART_BATCH_VS_ONLINE',
    kind: 'compare',
    section: 'ch00-blackbox',
    sectionLabel: '§0.1',
    before: 'formula-F-00.10',
    shows: '批次最小平方（記憶體、兩個總和、除法器）與線上 LMS（一個暫存器）並排',
    chart: CHART_BATCH_VS_ONLINE,
    caption: '同一串資料的兩種用法。看硬體成本：批次要記憶體和除法器，而且全部收齊才有答案；線上（藍色）只要一個暫存器 $w$，每來一筆就更新。',
    ariaLabel: '批次最小平方法先存下全部資料，算兩個總和後相除；線上的 LMS 每來一筆資料就修正暫存器裡的 w',
    isNew: true,
  },
  {
    name: 'CHART_LOOP',
    kind: 'loop',
    section: 'ch00-loop',
    sectionLabel: '§0.2',
    before: 'ch00-direction-table',
    shows: '預測 → 比較 → 修正的迴圈，每一條線都標出訊號名稱',
    chart: CHART_LOOP,
    caption: String.raw`LMS 的迴圈：每一筆資料走一圈。注意 $x_n$ 用了兩次（預測一次、修正一次），而修正出來的 $w_{n+1}$ 要等下一筆資料才會用到。`,
    ariaLabel: '預測、比較、修正三個步驟組成的迴圈，線上標示 x、y、預測、誤差與更新後的 w',
    isNew: false,
  },
  {
    name: 'CHART_LMS_ACCUMULATOR',
    kind: 'loop',
    section: 'ch00-update',
    sectionLabel: '§0.3',
    before: 'formula-F-00.2',
    shows: String.raw`LMS 更新式畫成硬體：乘法器 $e\,x$、增益 $\mu$、帶 $z^{-1}$ 暫存器的累加器`,
    chart: CHART_LMS_ACCUMULATOR,
    caption: String.raw`更新式畫成硬體。藍色暫存器加上它前面的相加點就是一個累加器：每一拍把 $\mu\,e_n\,x_n$ 加進去。`,
    ariaLabel: '誤差與輸入相乘後乘上學習率，加到暫存器目前的值上，結果在下一拍寫回暫存器',
    isNew: true,
  },
  {
    name: 'CHART_HANDCALC_STEP',
    kind: 'handcalc',
    section: 'ch00-hand',
    sectionLabel: '§0.4',
    before: 'ch00-hand-first-step',
    shows: '手算一步的計算順序（乘 → 減 → 連乘 → 加），帶入手算例的數字',
    chart: CHART_HANDCALC_STEP,
    caption: '手算一步的順序：乘、減、連乘、加，然後帶著新的 $w$ 回到第一格。照著箭頭算，就會得到下面表格的每一列。',
    ariaLabel: '手算流程：先算預測，再算誤差，再算修正量，最後更新 w，然後用新的 w 重複',
    isNew: true,
  },
  {
    name: 'CHART_MU_REGIONS',
    kind: 'handcalc',
    section: 'ch00-playground',
    sectionLabel: '§0.5',
    before: 'exp-intro-playground',
    shows: String.raw`學習率 $\mu$ 的五個區段 → pole $p$ → 行為（單調、一步到位、震盪、不收斂）`,
    chart: CHART_MU_REGIONS,
    caption: String.raw`學習率的地圖：先由 $\mu$ 算出 $p=1-\mu x^2$，再看 $p$ 落在哪一段。綠色三格會收斂，紅色兩格不會。`,
    ariaLabel: '由學習率算出 pole，再依 pole 的範圍分成學不到、單調收斂、一步到位、震盪收斂、不收斂五種行為',
    isNew: true,
  },
  {
    name: 'CHART_GRADIENT_DESCENT',
    kind: 'loop',
    section: 'ch00-why-ex',
    sectionLabel: '§0.6',
    before: 'ch00-gradient-steps',
    shows: String.raw`gradient descent 的流程：量單筆成本的斜率 → 乘上 $-\mu$ → 加回 $w$ → 新的 $w$`,
    chart: CHART_GRADIENT_DESCENT,
    caption: String.raw`下坡法走一步。重點是藍色那格：斜率是 $dj/dw=-e\,x$，所以「往斜率的反方向走」正好就是加上 $\mu\,e\,x$。`,
    ariaLabel: '由目前的 w 量出單筆成本的斜率，乘上負的學習率得到步伐，加回 w 得到新的 w',
    isNew: true,
  },
  {
    name: 'CHART_ERROR_RECURSION',
    kind: 'loop',
    section: 'ch00-why-ex',
    sectionLabel: '§0.6',
    before: 'ch00-pole-derivation',
    shows: String.raw`參數誤差 $\delta = a - w$ 的一階迴圈：每繞一圈乘上 $p = 1 - \mu\,x^2$`,
    chart: CHART_ERROR_RECURSION,
    caption: String.raw`把迴圈改用「還差多少」$\delta=a-w$ 來畫。$\delta$ 繞一圈回來時被減掉 $\mu x^2$ 倍的自己，所以每一圈都乘上同一個數 $p=1-\mu x^2$。`,
    ariaLabel: '參數誤差乘上 x 得到誤差，再乘上學習率與 x 得到修正量，從參數誤差中減去，結果存回暫存器',
    isNew: true,
  },
  {
    name: 'CHART_SIGNAL_VS_NOISE',
    kind: 'model',
    section: 'ch00-noise',
    sectionLabel: '§0.7',
    before: 'ch00-mean-steps',
    shows: String.raw`$e\,x$ 拆成訊號部分 $(a - w)\,x^2$ 與雜訊部分 $v\,x$；取平均後訊號留下、雜訊變成 $0$`,
    chart: CHART_SIGNAL_VS_NOISE,
    caption: String.raw`有雜訊時的更新量 $e\,x$ 有兩個成分：綠色的訊號每一筆都同號，紅色的雜訊時正時負。取平均之後紅色的那一份趨近 0。`,
    ariaLabel: '有雜訊的誤差乘上 x 之後分成訊號部分與雜訊部分；取平均後訊號部分留下，雜訊部分的平均為零',
    isNew: true,
  },
  {
    name: 'CHART_NOISE_AVERAGING',
    kind: 'path',
    section: 'ch00-noise',
    sectionLabel: '§0.7',
    before: 'formula-F-00.8',
    shows: String.raw`平均器：$N$ 筆 $e\,x$ → $\sum$ → $\div N$；中心不動、標準差變成 $s_1/\sqrt N$`,
    chart: CHART_NOISE_AVERAGING,
    caption: String.raw`平均器（藍色：先累加、再除以 $N$）。輸出的中心和單筆一樣，抖動卻只剩單筆的 $1/\sqrt N$。`,
    ariaLabel: 'N 筆 e 乘 x 先累加再除以 N，平均值不變，標準差縮小為單筆標準差除以根號 N',
    isNew: true,
  },
  {
    name: 'CHART_STEADY_STATE_NOISE',
    kind: 'model',
    section: 'ch00-noise',
    sectionLabel: '§0.7',
    before: 'formula-F-00.9',
    shows: String.raw`有雜訊時的 $\delta$ 迴圈：雜訊由 $\mu\,x$ 注入，被 pole $p$ 的迴圈平均`,
    chart: CHART_STEADY_STATE_NOISE,
    caption: String.raw`和{CHART_ERROR_RECURSION}是同一個迴圈，只多了紅色的雜訊入口。$\mu$ 同時決定兩件事：雜訊灌進來多少（$\times\,\mu x$），以及舊的誤差記住多久（$\times\,p$）。`,
    ariaLabel: '雜訊乘上學習率與 x 後從參數誤差的迴圈中減去；迴圈每一步把參數誤差乘上 pole；輸出為穩態抖動',
    isNew: true,
  },
  {
    name: 'CHART_ADAPTIVE_LOOP',
    kind: 'loop',
    section: 'ch00-why-matters',
    sectionLabel: '§0.8',
    before: 'ch00-app-cards',
    shows: '一般化的 LMS 自適應迴圈（任何「邊用邊校正」的系統）',
    chart: CHART_ADAPTIVE_LOOP,
    caption: '一般化的 LMS 自適應迴圈（示意）。不管是耳機、SerDes 還是 PLL，都是這三樣東西：可調係數、相減得到誤差、誤差和輸入相乘後累加。',
    ariaLabel: '參考輸入經可調係數產生預測，與期望值相減得到誤差，誤差與輸入相乘後乘上學習率並累加，用來修正係數',
    isNew: false,
  },
  {
    name: 'CHART_BLACKBOX_TO_PLL',
    kind: 'model',
    section: 'ch00-why-matters',
    sectionLabel: '§0.8',
    before: 'CHART_PLL_LOOP',
    shows: String.raw`把黑盒子模型換上 PLL 的名字：$x$ = DSM 殘差 code、$a$ = 正確的 DTC gain、$w$ = gain register、$v$ = PD 前雜訊、$e$ = PD 量到的誤差（reference edge 減 feedback edge）`,
    chart: CHART_BLACKBOX_TO_PLL,
    caption: String.raw`和{CHART_BLACKBOX_MODEL}是同一個模型，每個方塊換上它在 PLL 裡的名字。注意這裡只剩一個相加點：在 PLL 裡看不到 $y$ 和 $\hat y$，PD 直接量到 reference edge 與 feedback edge 相減之後的 $e$。`,
    ariaLabel: 'DSM 量化殘差同時乘上正確的 DTC gain（feedback edge 早到的時間）與 gain register 的值（reference 端 DTC 的補償量），兩者相減再加上 PD 前的雜訊，就是 PD 量到的 reference edge 減 feedback edge 的殘留誤差',
    isNew: true,
  },
  {
    name: 'CHART_PLL_LOOP',
    kind: 'path',
    section: 'ch00-why-matters',
    sectionLabel: '§0.8',
    before: 'ch00-pll-walk',
    shows: 'DTC gain 校正迴圈分成兩個框：主 PLL 路徑（reference → DTC → PD → loop filter，回授路徑只有 divider）與 LMS 校正迴路（取 PD 輸出的比較器 → GMAC → 更新）',
    chart: CHART_PLL_LOOP,
    caption: 'DTC gain 校正迴圈（簡化示意；完整版還有 PLL 的 error transfer，見 Ch04、Ch06）。DTC 在 reference 輸入端，回授路徑只有 divider；比較器的輸入從 PD 的輸出分接（和送進 loop filter 的是同一個 $e[n]$）。兩個框就是系統地圖的「主 PLL 迴路（快）」與「LMS 校正迴路（慢）」；藍色三格是校正迴路的主角。',
    ariaLabel: '主路徑：參考時脈先經 DTC 再進 PD，PD 輸出送給 loop filter 與 VCO，VCO 經 divider 回到 PD，DSM 的 carry 控制 divider、餘數控制 DTC；校正迴路：比較器取 PD 的輸出並取正負號，GMAC 平均 N 筆，每個 block 更新一次 gain register，再把 w 送回 DTC',
    isNew: false,
  },
  {
    name: 'CHART_LMS_VS_SIGN',
    kind: 'compare',
    section: 'ch00-sign',
    sectionLabel: '§0.9',
    before: 'ch00-sign-formula',
    shows: 'Conventional LMS（乘法器）與 Sign-Error LMS（比較器 + 條件變號）的資料路徑並排',
    chart: CHART_LMS_VS_SIGN,
    caption: '兩種更新的資料路徑。差別只在最前面：Conventional 那一框要一個多位元乘法器（紅色），Sign-Error 那一框換成 1-bit 比較器和條件變號（藍色）。',
    ariaLabel: 'Conventional LMS 用乘法器算 e 乘 x；Sign-Error LMS 用 1-bit 比較器取正負號，再依正負號決定送出 x 或負 x',
    isNew: true,
  },
  {
    name: 'CHART_COMPARATOR_AVERAGE',
    kind: 'path',
    section: 'ch00-sign',
    sectionLabel: '§0.9',
    before: 'ch00-comparator-steps',
    shows: String.raw`小誤差 + 大雜訊 → 1-bit 比較器（單獨一筆）→ 累加 $N$ 筆 → 看總和的正負號`,
    chart: CHART_COMPARATOR_AVERAGE,
    caption: '1-bit 比較器的資訊流。「單獨一筆」那一框：$q$ 幾乎是丟銅板，只是 $+1$ 稍微多一點點；「累加 $N$ 筆」那一框：這一點點累積起來，總和的正負號就看得出方向。',
    ariaLabel: '很小的誤差加上很大的雜訊進入 1-bit 比較器，輸出累加 N 筆後由總和的正負號判斷誤差方向',
    isNew: true,
  },
  {
    name: 'CHART_GMAC_BLOCK',
    kind: 'path',
    section: 'ch00-sign',
    sectionLabel: '§0.9',
    before: 'ch00-gmac-formula',
    shows: String.raw`GMAC 與 block 更新：sample 速率（$n$）與 block 速率（$k$）分成兩個框`,
    chart: CHART_GMAC_BLOCK,
    caption: '兩種速率。「每個 sample」那一框每筆資料動一次，「每個 block」那一框每 $N$ 筆才動一次；兩框之間只靠一條線相接：累加器每 $N$ 筆（一個 block）交出一次總和。',
    ariaLabel: '每個 sample 比較器輸出乘上 x 並累加；每 N 筆把總和除以 N 得到 G，乘上學習率後加到 gain register',
    isNew: true,
  },
  {
    name: 'CHART_CORRELATED_NOISE',
    kind: 'model',
    section: 'ch00-assumptions',
    sectionLabel: '§0.10',
    before: 'ch00-bias-steps',
    shows: String.raw`反例的模型：干擾 $\kappa\,x$ 與黑盒子 $a\,x$ 並聯，LMS 只看得到兩者的和`,
    chart: CHART_CORRELATED_NOISE,
    caption: String.raw`反例的模型。紅色的干擾和黑盒子走並聯的兩條路，在相加點合在一起；從 $x$ 和 $y$ 看，它們就是同一個係數 $a+\kappa$。`,
    ariaLabel: '輸入 x 同時經過黑盒子的 a 與干擾路徑的 kappa，兩者與獨立雜訊相加成為 y；LMS 平均收斂到 a 加 kappa',
    isNew: true,
  },
  {
    name: 'CHART_SYNTHESIS_ORDER',
    kind: 'handcalc',
    section: 'ch00-assumptions',
    sectionLabel: '§0.10',
    before: 'handcalc-HC-00.8',
    shows: '綜合手算 HC-00.8 的計算順序：停在哪 → 多久到 → 抖多大 → 平均後多準',
    chart: CHART_SYNTHESIS_ORDER,
    caption: '綜合手算的路線圖：四條支線互不相依，可以照 ① 到 ④ 的順序算；最後把 ① 的偏移和 ④ 的標準差放在一起比——偏移是 bias、抖動是 variance，平均只壓得小後者。',
    ariaLabel: '綜合手算的四條支線：固定點、pole 與收斂步數、穩態變異數與標準差、時間平均的標準差；最後比較偏移與標準差',
    isNew: true,
  },
] as const satisfies readonly Draft[]

/** 章內引用方塊圖用的名稱（就是匯出的常數名稱）。 */
export type DiagramName = (typeof DRAFTS)[number]['name']

/** 'CHART_…' → 「圖 0.n」（n = 頁面順序）。 */
export function figureLabel(name: DiagramName): string {
  return `圖 0.${DRAFTS.findIndex((d) => d.name === name) + 1}`
}

/** 本章所有方塊圖（依頁面順序；圖號 = 陣列位置 + 1）。章首的系統地圖另由 <SystemMap> 顯示，不在這個清單裡。 */
export const DIAGRAMS: DiagramEntry[] = DRAFTS.map((d, i) => ({
  ...d,
  id: `D-00.${i + 1}`,
  caption: d.caption.replace(/\{(CHART_[A-Z_]+)\}/g, (_, n: string) => figureLabel(n as DiagramName)),
}))

export function diagramByName(name: DiagramName): DiagramEntry {
  const d = DIAGRAMS.find((e) => e.name === name)
  if (!d) throw new Error(`找不到方塊圖 ${name}`)
  return d
}
