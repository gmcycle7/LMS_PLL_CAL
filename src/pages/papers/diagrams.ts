/**
 * Papers / Reading 頁的方塊圖原始碼（docs/teaching-style.md §8；diagrams.test.tsx 以真正的 mermaid parser 逐一解析）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、等號、絕對值符號的文字一律用雙引號包住。
 * - 不寫單獨的 ASCII「+」「-」「*」標籤，也不寫緊接字母的「<」：Mermaid 11 把標籤當 Markdown／HTML 解讀。
 * - 圖上的訊號名稱、更新式的正負號與取樣率（sample n／block k）與本頁公式一致：δ = a − w、
 *   G_k = (1/N)·Σ q[n]·x[n]、w_(k+1) = w_k + μ·G_k、g_i = s·λ_i、p_i = 1 − g_i。
 * - 閱讀路線圖 READING_PATH_CHART 與文獻資料放在一起（references.ts），這裡只彙整進清單。
 */
import { READING_PATH_CHART, type PaperId } from './references'

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * §1：一個數字的三種來源，各自怎麼標示、能不能放在一起比。
 * 例子與 S1Policy 的開場問題相同：D4 題名的 74 fs 是作者量測的 jitter，本站的 σ_w 是係數雜訊（推導）。
 */
export const CHART_NUMBER_SOURCES = `flowchart TD
  N(["這一頁上的一個數字或結論"]) --> Q{"它從哪裡來？"}
  Q -- "作者的晶片與量測" --> LIT["已發表主張 published claim<br/>只寫到題名層級，不轉述內文數字<br/>例：D4 題名的 74 fs jitter"]
  Q -- "規格書附錄 D 的一句話" --> SPEC["規格書的描述<br/>原樣列出，標「未經本站核對」<br/>不當作數值證據"]
  Q -- "本站的模型與程式" --> DER["本站推導 derived on this site<br/>網站程式即時計算，golden 與測試交叉驗算<br/>例：係數雜訊 σ_w（Ch12）"]
  LIT --> X{"想把兩個數字放在一起比？"}
  DER --> X
  X -- "物理量、模型、條件都相同" --> OKC["可以：逐條對照假設後再比"]
  X -- "有任何一項不同" --> NO["不行：PLL 輸出的 jitter 不是係數雜訊<br/>單位都是 fs 也不能直接比"]
  ${FOCUS}
  ${ALT}
  ${PASS}
  ${WARN}
  class DER focus
  class LIT alt
  class OKC pass
  class NO warn`

/**
 * §3 的文獻對照：校正迴路的每一塊 ↔ 哪一份文獻 ↔ 本站哪幾章。
 * node 是 CHART_PAPER_MAP 的節點 id；pages 必須是該文獻 pages_（references.ts）的子集（測試會檢查）。
 */
export const PAPER_MAP: { node: string; papers: PaperId[]; pages: string[] }[] = [
  { node: 'X', papers: ['D4'], pages: ['ch09', 'ch11'] },
  { node: 'HPD', papers: ['D2'], pages: ['ch06', 'ch07'] },
  { node: 'GMAC', papers: ['D1'], pages: ['ch12'] },
  { node: 'UPD', papers: ['D7'], pages: ['ch03', 'ch09'] },
  { node: 'DLY', papers: ['D3'], pages: ['ch08'] },
  { node: 'QNT', papers: ['D5', 'D6'], pages: ['ch13'] },
]

/**
 * §3：七份文獻各自在講校正迴路的哪一塊。
 * 訊號：殘差 (a − w)·x[n] 經 PLL 誤差路徑到 comparator（sample rate，索引 n）；
 * GMAC 每 N 個 sample 輸出一次 G_k，累加器更新 w_(k+1) = w_k + μ·G_k（block rate，索引 k）。
 */
export const CHART_PAPER_MAP = `flowchart LR
  X(["code x[n]<br/>激勵夠不夠<br/>D4｜Ch09、Ch11"]) --> RES["DTC 補償後的殘差<br/>(a − w)·x[n]"]
  RES --> HPD["PLL 誤差路徑 H_PD<br/>極性與 filtered-x<br/>D2｜Ch06、Ch07"]
  HPD -- "e[n]" --> CMP["1-bit comparator<br/>q[n] = sign(e[n])"]
  CMP -- "q[n]" --> GMAC["GMAC：G_k = (1/N)·Σ q[n]·x[n]<br/>雜訊與校正頻寬<br/>D1｜Ch12"]
  X -. "regressor x[n]" .-> GMAC
  GMAC -- "G_k" --> UPD["× μ 後累加<br/>w_(k+1) = w_k + μ·G_k<br/>eigen-mode 與步長<br/>D7｜Ch03、Ch09"]
  UPD --> DLY["更新延遲 d 個 block<br/>極性對了仍可能發散<br/>D3｜Ch08"]
  DLY --> QNT["有限位元量化與 dither<br/>limit cycle 與 spur<br/>D5、D6｜Ch13"]
  QNT -- "w" --> RES`

/**
 * §4：四種寫法先換成同一個量 s（每單位 eigenvalue 的平均 loop gain），再看 pole（bridge.ts 的 gainScale）。
 * ½e² 型 s = μ；Widrow 型 s = 2·μ_W；NLMS s ≈ μ̃/(ε_reg + tr R)；block sign-GMAC s = μ·K_q（誤用 sum 模式再 ×N）。
 */
export const CHART_CONVENTION_BRIDGE = `flowchart LR
  H["本站 Part A：成本 ½e²<br/>w ← w + μ·e·x"] -- "s = μ" --> S(["每單位 eigenvalue 的<br/>平均 loop gain s"])
  W["Widrow 型：成本 ε²<br/>w ← w + 2·μ_W·ε·x"] -- "s = 2·μ_W" --> S
  N["NLMS<br/>w ← w + μ̃·e·x/(ε_reg + ‖x‖²)"] -- "s ≈ μ̃/(ε_reg + tr R)" --> S
  G["本站 Part B：block sign-GMAC<br/>w ← w + μ·(1/N)·Σ q·x"] -- "s = μ·K_q（誤用 sum 模式再 ×N）" --> S
  S --> GI["g_i = s·λ_i<br/>第 i 個 eigen-mode 的 loop gain"]
  GI --> P["p_i = 1 − g_i<br/>無延遲時的 pole"]
  P --> Q{"每個 mode 的 |p_i|<br/>都小於 1 嗎？"}
  Q -- "是" --> OK["平均（mean）收斂<br/>最慢的是 λ_min 那個 mode"]
  Q -- "否" --> BAD["平均不收斂<br/>先檢查 s·λ_max 是否超過 2"]
  ${FOCUS}
  ${PASS}
  ${WARN}
  class S focus
  class OK pass
  class BAD warn`

/** 本頁全部的圖（名稱、所在段落、原始碼），依頁面上出現的順序。 */
export const PAPERS_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'CHART_NUMBER_SOURCES', section: '§1', chart: CHART_NUMBER_SOURCES },
  { name: 'READING_PATH_CHART', section: '§2', chart: READING_PATH_CHART },
  { name: 'CHART_PAPER_MAP', section: '§3', chart: CHART_PAPER_MAP },
  { name: 'CHART_CONVENTION_BRIDGE', section: '§4', chart: CHART_CONVENTION_BRIDGE },
]
