/**
 * Formula & Unit Reference 頁的 Mermaid 方塊圖原始碼（teaching-style §8）。
 * 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；圖說寫在使用處，數學一律用 `$...$`。
 * 每張圖都在 diagrams.test.tsx 以真正的 Mermaid 畫過一次，並和 refValues()／registry 的內容核對。
 */

/** §4 公式登錄：一個公式 ID 從章節的 formulas.ts 走到本頁、錨點與勘誤的路徑 */
export const CHART_FORMULA_LINKS = `flowchart LR
  CH["章節 formulas.ts<br/>export const FORMULAS：<br/>id、title、tex、conditions、<br/>claim、level、page、erratumId"]
  GLOB["registry.ts<br/>import.meta.glob（eager）"]
  ALL["ALL_FORMULAS<br/>依側欄順序＋ID 自然排序"]
  ROW["本頁 §4 的一列<br/>搜尋、篩選、「前往」"]
  JMP["jumpToFormula(id)<br/>navigate(page)，等錨點出現再捲過去"]
  ANC["章節頁的 #formula-ID 錨點"]
  ERR["errata.json<br/>勘誤 Exx"]
  VER["驗證頁<br/>#/verification?e=Exx"]
  CH -- "章節自己登錄" --> GLOB
  GLOB --> ALL
  ALL -- "每條公式一列" --> ROW
  ROW -- "按「前往」" --> JMP
  JMP -- "page = 公式所在頁" --> ANC
  CH -. "同一個 ID 標出公式" .-> ANC
  ERR -- "tooltip 摘要" --> ROW
  ROW -- "勘誤 Exx 標籤" --> VER
  ERR --> VER
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  class ALL focus
  class ERR warn
`

/** §2.3 單位鏈：σ_v [fs] → K_q → K → g（無因次）→ p → 頻寬 [Hz]；sum mode 多一個 N */
export const CHART_UNIT_CHAIN = `flowchart LR
  SV["σ_v<br/>[fs]"]
  KQ["K_q = √(2/π)/σ_v<br/>[fs⁻¹]"]
  CC["C = E[x·u]<br/>[1]"]
  K["K = K_q·C<br/>[fs⁻¹]"]
  MU["μ<br/>[fs]"]
  NN["sum mode 才有：× N"]
  G["g = μ·K<br/>[1]（無因次）"]
  P["p = 1 − g<br/>[1]"]
  FU["f_u = f_s/N<br/>[Hz]"]
  F3["f_3dB = (f_u/π)·arcsin((1−p)/(2√p))<br/>[Hz]，只在 p ≥ 3 − 2√2 時存在"]
  EN["ENBW = (f_u/2)·(1−p)/(1+p)<br/>[Hz]"]
  SV --> KQ
  KQ --> K
  CC --> K
  K --> G
  MU --> G
  NN -. "g = μ·K·N" .-> G
  G --> P
  P --> F3
  P --> EN
  FU --> F3
  FU --> EN
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  class G focus
  class NN warn
`

/** §2.1 兩條時間軸：sample rate（n）與 block rate（k）之間的三個轉換點 */
export const CHART_RATE_DOMAINS = `flowchart LR
  subgraph FS["sample rate：索引 n，速率 f_s"]
    X["x[n]：原始 code"]
    U["u[n]：經 PD 路徑的 code"]
    E["e[n] = δ_k·u[n] + v[n]"]
    Q["q[n] = sign(e[n])"]
    P["q[n]·x[n]"]
  end
  subgraph FU["block rate：索引 k，速率 f_u = f_s/N"]
    G["G_k = (1/N)·Σ q[n]·x[n]<br/>n 屬於 block k"]
    W["w_(k+1) = w_k + μ·G_k"]
    D["δ_k = a − w_k"]
  end
  Z["ZOH：w[n] = w_⌊n/N⌋<br/>每個 w_k 重複 N 次"]
  U --> E
  E --> Q
  Q --> P
  X --> P
  P -- "累加 N 筆" --> G
  G --> W
  W --> D
  D -. "block k 內保持不變" .-> E
  W -- "w_k" --> Z
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff
  class G focus
  class Z ok
`

export interface FrChart {
  name: string
  chart: string
  /** 圖在本頁的位置（段落編號） */
  section: string
  kind: string
}

/** 頁面上出現的順序（§2.1 → §2.3 → §4） */
export const FR_CHARTS: readonly FrChart[] = [
  { name: 'CHART_RATE_DOMAINS', chart: CHART_RATE_DOMAINS, section: '§2.1', kind: '取樣率／路徑' },
  { name: 'CHART_UNIT_CHAIN', chart: CHART_UNIT_CHAIN, section: '§2.3', kind: '數學模型（單位鏈）' },
  { name: 'CHART_FORMULA_LINKS', chart: CHART_FORMULA_LINKS, section: '§4', kind: '流程' },
]
