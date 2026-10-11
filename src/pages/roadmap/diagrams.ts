/**
 * Research Backlog / Roadmap 頁的方塊圖原始碼（docs/teaching-style.md §8；diagrams.test.tsx 以真正的 mermaid parser 逐一解析）。
 *
 * 規則：
 * - 節點與連線標籤裡的數學一律寫 `$...$`（LaTeX），共用的 <Mermaid> 元件用 KaTeX 排版（和正文同一套樣式）；文字、方塊名稱照常寫。
 *   原始碼用 String.raw 樣板字串，TeX 的反斜線只寫一次；換行用 `<br/>`，標籤內不用雙反斜線；
 *   標籤的數學裡不用 ASCII 的 < >（Mermaid 會先把它們轉成 HTML 實體），不等式寫 `\lt` `\gt` `\le` `\ge`。
 *   含括號、等號的文字一律用雙引號包住。
 * - 加法點是圓形節點，文字寫全形「＋」；每條進來的邊以「＋」或「−」（U+2212）開頭，標籤裡還有公式時把正負號放進數學（`$+\,\rho\,\eta_k$`）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 版面（teaching-style §8「版面寬度」）：R1 迴路與研究依賴圖用 flowchart TB（LR 分別寬 1415／1222 px）；其餘 LR 的圖都很淺，放得下。
 * - 「六個條件」與「狀態怎麼決定」兩張圖由 data.ts 的資料產生（CONDITIONS、ITEMS、itemStatus 的規則），
 *   資料改了圖就跟著改；測試再核對一次。
 * - R1 的迴路圖與 model.ts 的 sigmaW2Lyapunov 是同一個狀態空間：δw_(k+1) = p·δw_k + μ·η_k、
 *   η_(k+1) = ρ·η_k + √(1 − ρ²)·σ_η·ξ_k（係數誤差在本頁記作 δw = w − w*，勘誤 E33）。
 */
import { CONDITIONS, ITEMS, ITEM_STATUS_LABEL, SUB_STATUS_LABEL, type Condition } from './data'

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/** 每個條件的判斷式（`$...$` LaTeX，放在圖的節點標籤裡；與 data.ts 的 CONDITIONS[].question 同義）。不等式不用 ASCII 的 > < ，寫 \gt \lt。 */
export const CONDITION_CHECK: Record<Condition, string> = {
  identifiability: String.raw`$\lambda_{\min} \gt 0$`,
  polarity: String.raw`$C \gt 0$`,
  stability: '所有 pole 在單位圓內',
  variance: String.raw`$\sigma_w$ 夠小`,
  bias: String.raw`$w^*$ 等於正確值`,
  system: 'jitter 與 spur 真的變好',
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥']

/** §0：成功的 calibration 要同時滿足的六件事，以及每一件還有哪些延伸研究（由 CONDITIONS 與 ITEMS 產生）。 */
export function conditionsChart(): string {
  const lines = ['flowchart LR']
  CONDITIONS.forEach((c, i) => {
    const items = ITEMS.filter((it) => it.conditions.includes(c.id))
      .map((it) => it.id)
      .join('、')
    lines.push(`  C${i + 1}["${CIRCLED[i]} ${c.label}<br/>${CONDITION_CHECK[c.id]}<br/>延伸研究：${items}"] --> OK`)
  })
  lines.push('  OK(["六件事同時成立<br/>calibration 才算成功"])', `  ${PASS}`, '  class OK pass')
  return lines.join('\n')
}

export const CHART_SIX_CONDITIONS = conditionsChart()

/**
 * §0「先算一次」：有色（AR(1)）GMAC 雜訊推動的係數誤差（R1；F-R1.1、F-R1.2）。
 * 上半部產生相鄰 block 相關的雜訊 η_k（block rate，索引 k），下半部是第 12 章的一階校正迴路。
 */
export const CHART_R1_LOOP = String.raw`flowchart TB
  XI(["$\xi_k$<br/>白雜訊：各 block 獨立<br/>變異數 1"]) --> DRV["$\times\,\sqrt{1 - \rho^2}\,\sigma_\eta$"]
  DRV -- "＋" --> S1(("＋"))
  S1 -- "$\eta_{k+1}$" --> Z1["$z^{-1}$"]
  Z1 -- "$\eta_k$" --> RHO["$\times\,\rho$<br/>相鄰 block 的相關"]
  RHO -- "$+\,\rho\,\eta_k$" --> S1
  Z1 -- "$\eta_k$" --> MU["$\times\,\mu$<br/>步長"]
  MU -- "$+\,\mu\,\eta_k$" --> S2(("＋"))
  S2 -- "$\delta w_{k+1}$" --> Z2["$z^{-1}$"]
  Z2 -- "$\delta w_k$" --> PP["$\times\,p$<br/>$p = 1 - \mu K$"]
  PP -- "$+\,p\,\delta w_k$" --> S2
  Z2 -- "$\delta w_k$" --> OUT(["係數雜訊<br/>$\sigma_w^2 = E[\delta w_k^2]$"])
  ${FOCUS}
  class RHO focus`

/** §0「怎麼讀狀態」：itemStatus() 的判定順序（明確指定 → 本站已有 → 預覽或待辦 → 未開始）；四種結果都不是 verified。 */
export function statusFlowChart(): string {
  const explicit = ITEMS.filter((it) => it.status !== undefined)
    .map((it) => it.id)
    .join('、')
  return `flowchart TD
  START(["一個研究項目<br/>和它的子目標清單"]) --> Q0{"資料檔直接指定了狀態？"}
  Q0 -- "是：目前只有 ${explicit}" --> INA["${ITEM_STATUS_LABEL['in-analysis']}"]
  Q0 -- "否" --> Q1{"有任何子目標是<br/>「${SUB_STATUS_LABEL['on-site']}」？"}
  Q1 -- "有" --> PART["${ITEM_STATUS_LABEL.partial}"]
  Q1 -- "沒有" --> Q2{"有子目標是<br/>「${SUB_STATUS_LABEL.preview}」<br/>或「${SUB_STATUS_LABEL.pending}」？"}
  Q2 -- "有" --> PEND["${ITEM_STATUS_LABEL.pending}"]
  Q2 -- "沒有" --> NS["${ITEM_STATUS_LABEL['not-started']}"]
  INA --> NOV["四種狀態都不是 verified<br/>研究項目沒有 T-id"]
  PART --> NOV
  PEND --> NOV
  NS --> NOV
  ${WARN}
  class NOV warn`
}

export const CHART_STATUS_FLOW = statusFlowChart()

/** §1：研究題目之間的依賴（R6 → R1 表示「R6 的結果是 R1 的輸入」；規劃用，非驗證結果）。 */
export const DEPENDENCY_CHART = `flowchart TB
  R6["R6<br/>Comparator 非理想"] --> R1["R1<br/>有色 GMAC 雜訊"]
  R1 --> R2["R2<br/>Cyclostationary"]
  R7["R7<br/>事件級 PLL"] --> R2
  R7 --> SS["SSPLL<br/>GOS / PHOS 極性"]
  R5["R5<br/>Training sequence"] --> SS
  R5 --> R4["R4<br/>MIMO 更新矩陣"]
  R4 --> R8["R8<br/>NLMS / RLS / Kalman"]
  R8 --> R3["R3<br/>量化 / limit cycle"]
  R2 --> R10["R10<br/>規格反推"]
  R1 --> R10
  SS --> R10
  R9["R9<br/>RTL bit-true / AMS"] --> R10
  R3 --> R10`

/** §4：實作階段 P0–P5 的依賴（docs/implementation_plan.md；只畫直接依賴，P0 → P2 這類由 P1 轉達的不重複畫）。 */
export const PHASE_CHART = `flowchart LR
  P0["P0 基礎"] --> P1["P1 數學"]
  P0 --> P3["P3 MIMO / Bias"]
  P1 --> P2["P2 PLL / Stability"]
  P2 --> P4["P4 Noise / Quantization"]
  P1 --> P5["P5 Integrated Lab"]
  P2 --> P5
  P3 --> P5
  P4 --> P5`

/** 本頁全部的圖（名稱、所在段落、原始碼），依頁面上出現的順序。 */
export const ROADMAP_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'CHART_SIX_CONDITIONS', section: '§0', chart: CHART_SIX_CONDITIONS },
  { name: 'CHART_R1_LOOP', section: '§0', chart: CHART_R1_LOOP },
  { name: 'CHART_STATUS_FLOW', section: '§0', chart: CHART_STATUS_FLOW },
  { name: 'DEPENDENCY_CHART', section: '§1', chart: DEPENDENCY_CHART },
  { name: 'PHASE_CHART', section: '§4', chart: PHASE_CHART },
]
