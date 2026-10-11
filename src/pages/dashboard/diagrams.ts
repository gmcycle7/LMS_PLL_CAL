/**
 * Dashboard 的 Mermaid 圖原始碼（diagrams.test.ts 以真正的 mermaid parser 驗證語法；docs/teaching-style.md §8）。
 * - 圖內的數學一律寫 LaTeX（使用者要求，2026-10-11）：節點與連線的「雙引號標籤」裡把數學放在 `$...$`，文字照常寫，
 *   由共用的 <Mermaid> 用 KaTeX 排版。所以每張圖的原始碼都用 `String.raw`（TeX 的反斜線只寫一次）；
 *   標籤內不寫 `\\`（Mermaid 會收成一個反斜線），換行用 <br/>。
 * - 標籤內避免 ASCII '<' 與 ';'（Mermaid 會當成 HTML 或敘述分隔）：大於／小於在 `$...$` 內寫 `\gt`、`\lt`，不用 `\;`（thin space 寫 `\,`）。
 *   單位與名稱（FCW、DSM、GMAC、jitter、spur…）照舊寫成文字。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）；
 *   正負號後面還有說明文字時，負號寫成 `$-$`（KaTeX 的文字模式不認得 U+2212，會在主控台警告）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 圖上的訊號名稱、正負號與箭頭方向都和「一條方程式」那一節的推導一致（$\delta = a - w$；$G_k = K_q\,(C\,\delta_k + B) + \eta_k$）。
 */
import { SYSTEM_BLOCK_LABEL, type SystemBlock } from '@/components'

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * 首頁的系統地圖（共用元件 SystemMap）要標成藍色的方塊：全部。
 * 每一章開頭都是同一張圖、只標那一章的主角；首頁談的是整個系統（六個條件分散在每一塊上），所以全部標示。
 */
export const DASH_SYSTEM_FOCUS: SystemBlock[] = Object.keys(SYSTEM_BLOCK_LABEL) as SystemBlock[]

/** 圖上六個條件的短名稱（各自是 SIX_CONDITIONS[i].zh 的子字串；diagrams.test.ts 會檢查） */
export const CONDITION_MAP_NAMES = ['資訊足夠', '更新方向正確', '動態穩定', '統計精度足夠', '正確的物理參數', '改善 PLL 輸出'] as const

const N = CONDITION_MAP_NAMES

/**
 * 圈圈數字 ①–⑥：KaTeX 的文字模式沒有 U+2460…（含公式的標籤整個交給 KaTeX，會警告而且量不到寬度），
 * 所以標籤裡的圈圈數字改用 `\textcircled`（文字放進 \text{} 才合法）。
 */
export const CIRC: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => String.raw`$\text{\textcircled{${n}}}$`)

/**
 * 校正迴路的訊號流（實線）與六個條件各自「住在哪裡」（虛線圓角框）。
 * 對應線性化方程式 $e[n] = (a - w)\,u[n] + \varepsilon_{\mathrm{det}}[n] + v[n]$：
 *   $(a - w)$ 來自 DTC / PMUX 的係數誤差、$u = h * x$ 來自 PLL error path、$\varepsilon_{\mathrm{det}}$ 來自 offset / INL、$v$ 是 comparator 前的雜訊。
 */
export const CONDITION_MAP_CHART = String.raw`flowchart LR
  DSM["DSM / FCW<br/>code $x[n]$"]
  DTC["DTC / PMUX<br/>延遲 $= w\cdot x$<br/>真值 $a$（GOS / PHOS）"]
  PLL["PLL error path<br/>$u = h * x$<br/>$\lvert H\rvert$、$\phi$"]
  CMP["1-bit comparator<br/>$q = \mathrm{sign}(e)$<br/>雜訊 $\sigma_v$"]
  GMAC["GMAC<br/>$G = \frac{1}{N}\sum q\cdot x[n-D]$"]
  UPD["係數更新<br/>$w \leftarrow w + \mu\cdot G$<br/>（晚 $d$ 個 block）"]
  OUT["PLL 輸出<br/>jitter / spur"]
  DSM --> DTC --> PLL --> CMP --> GMAC --> UPD
  UPD -- "$w$（6-bit 暫存器）" --> DTC
  DSM -. "$x[n-D]$" .-> GMAC
  DTC -- "$\delta t = x\cdot\delta w$，經 $T$" --> OUT
  C1(["${CIRC[0]} ${N[0]}<br/>$\lambda_{\min} \gt 0$"]) -.- DSM
  C2(["${CIRC[1]} ${N[1]}<br/>$C = E[x\,u] \gt 0$"]) -.- PLL
  C3(["${CIRC[2]} ${N[2]}<br/>$0 \lt g \lt g^*$"]) -.- UPD
  C4(["${CIRC[3]} ${N[3]}<br/>$\sigma_w$ 夠小"]) -.- CMP
  C5(["${CIRC[4]} ${N[4]}<br/>$w^* = a + B/C$"]) -.- DTC
  C6(["${CIRC[5]} ${N[5]}<br/>jitter、spur"]) -.- OUT`

/**
 * 六個條件的檢查流程（由上到下就是 thesisModel.ts 的 CONDITION_ORDER）。
 * 順序不是隨便排的：後面的判據要用到前面算出來的量——有了 $C$ 才能算 $g = \mu K_q C$；$\lvert z\rvert \lt 1$ 才有穩態的 $\sigma_w$ 與固定點；
 * $\sigma_w$ 與 $\Delta w = B/C$ 都有了才能換算成輸出端的 $\sigma_{\delta t}$ 與 spur。六個都要過；任何一個「否」就停下來修那一塊。
 */
export const CONDITION_FLOW_CHART = String.raw`flowchart TB
  Q1{"${CIRC[0]} ${N[0]}？<br/>$\lambda_{\min} \gt 0$"}
  Q2{"${CIRC[1]} ${N[1]}？<br/>$C = E[x\cdot u] \gt 0$"}
  Q3{"${CIRC[2]} ${N[2]}？<br/>$0 \lt g \lt g^*(d)$，<br/>$g = \mu\cdot K_q\cdot C$"}
  Q4{"${CIRC[3]} ${N[3]}？<br/>$\sigma_w$ 在預算內"}
  Q5{"${CIRC[4]} ${N[4]}？<br/>$w^* - a = B/C$ 在預算內"}
  Q6{"${CIRC[5]} ${N[5]}？<br/>$\sigma_{\delta t}$ 與 spur 在預算內"}
  OK(["六個都通過<br/>才是成功的 calibration"])
  Q1 -- "是" --> Q2
  Q2 -- "是：有了 $C$ 才能算 $g$" --> Q3
  Q3 -- "是：迴路會收斂" --> Q4
  Q4 -- "是" --> Q5
  Q5 -- "是：$\sigma_w$ 與 $B/C$ 都有了" --> Q6
  Q6 -- "是" --> OK
  Q1 -- "否" --> F1["看不見：某個方向學不到<br/>換 code／FCW，或少校正幾個參數"]
  Q2 -- "否" --> F2["$C \le 0$：越修越遠，或隨雜訊亂走<br/>調 code delay $D$，或改用 filtered-$x$"]
  Q3 -- "否" --> F3["$g$ 太大：震盪發散<br/>減小 $\mu$、縮短延遲 $d$、檢查 sum／average"]
  Q4 -- "否" --> F4["係數抖動太大<br/>減小 $\mu$ 或增加 $N$"]
  Q5 -- "否" --> F5["GMAC 歸零，但 $w \ne a$<br/>降低 $B$（offset、INL），或提高 $C$"]
  Q6 -- "否" --> F6["jitter／spur 超標<br/>bias 與雜訊合起來重新分配預算"]
  ${PASS}
  ${WARN}
  class OK ok
  class F1,F2,F3,F4,F5,F6 warn`

/**
 * 線性化 block 方程式（F-DB.1）畫成訊號流：
 *   $\delta_k = a - w_k$ → $\times C$ → $+B$ → $\times K_q$ → $+\eta_k = G_k$ → $\times \mu$ → 累加器 → $w_k$（負回授）
 * 也就是 $G_k = K_q\,(C\,\delta_k + B) + \eta_k$、$w_{k+1} = w_k + \mu\,G_k$ ⇒ $\delta_{k+1} = (1 - \mu K_q C)\,\delta_k - \mu K_q B - \mu\,\eta_k$。
 * 三個藍色方塊相乘 = loop gain $g = \mu K_q C$；棕色的 $B$ 決定固定點 $\delta^* = -B/C$。
 */
export const BLOCK_EQUATION_CHART = String.raw`flowchart LR
  A(["$a$<br/>真值"]) -- "＋" --> S1(("＋"))
  S1 -- "$\delta_k = a - w_k$" --> CC["$\times C$<br/>$C = E[x\cdot u]$<br/>條件 ${CIRC[1]}：看它的正負"]
  CC -- "＋" --> S2(("＋"))
  BB(["$B = E[x\cdot\varepsilon_{\mathrm{det}}]$<br/>條件 ${CIRC[4]}：bias 的來源"]) -- "＋" --> S2
  S2 -- "$C\cdot\delta_k + B$" --> KQ["$\times K_q$<br/>comparator 的統計增益<br/>$K_q = \sqrt{2/\pi}/\sigma_v$"]
  KQ -- "＋" --> S3(("＋"))
  ETA(["$\eta_k$：GMAC 雜訊<br/>變異數 $\sigma_\eta^2 \approx P_x/N$<br/>條件 ${CIRC[3]}"]) -- "＋" --> S3
  S3 -- "$G_k = K_q\cdot(C\cdot\delta_k + B) + \eta_k$" --> MU["$\times \mu$<br/>learning rate"]
  MU -- "$\mu\cdot G_k$" --> ACC["累加器 $\frac{1}{z-1}$<br/>$w_{k+1} = w_k + \mu\cdot G_k$<br/>條件 ${CIRC[2]}：$g = \mu\cdot K_q\cdot C$ 的大小"]
  ACC -- "$-$（回授 $w_k$）" --> S1
  ${FOCUS}
  ${ALT}
  class CC,KQ,MU focus
  class BB alt`

/** 本頁自己的圖（依出現順序；章首的系統地圖由共用元件 SystemMap 產生，不在這裡）；diagrams.test.ts 逐一解析。 */
export const DASH_CHARTS: { name: string; chart: string }[] = [
  { name: 'CONDITION_FLOW_CHART', chart: CONDITION_FLOW_CHART },
  { name: 'CONDITION_MAP_CHART', chart: CONDITION_MAP_CHART },
  { name: 'BLOCK_EQUATION_CHART', chart: BLOCK_EQUATION_CHART },
]

/** 圖下方的對照：每個條件主要取決於哪一塊、由哪些可調的量決定（$…$ 為 TeX） */
export const CONDITION_MAP_LEGEND: { n: number; block: string; knobs: string }[] = [
  { n: 1, block: 'DSM code（regressor）', knobs: 'FCW、code pattern、要同時校正幾個參數 → $\\mathbf R=E[\\mathbf u\\mathbf u^T]$ 的 $\\lambda_{\\min}$' },
  { n: 2, block: 'PLL error path ＋ GMAC 的 code delay', knobs: '$|H|$、$\\phi$、$D$ → $C=E[x\\,u]$ 的正負' },
  { n: 3, block: '係數更新（積分器）', knobs: '$\\mu$、GMAC 的 sum / average、commit 延遲 $d$ → $g=\\mu K_qC$ 與 $g^*(d)$' },
  { n: 4, block: 'Comparator 與 GMAC 累加', knobs: '$\\sigma_v$、$N$、$\\mu$ → $\\sigma_w$' },
  { n: 5, block: 'DTC / comparator 的非理想', knobs: 'offset、INL、code-correlated 干擾 → $B=E[x\\,\\varepsilon_{\\mathrm{det}}]$' },
  { n: 6, block: 'DTC 輸出到 PLL 輸出', knobs: 'code 頻譜、6-bit 量化、output transfer $T$ → jitter 與 spur' },
]
