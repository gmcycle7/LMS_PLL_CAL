/**
 * Research Backlog / Roadmap 頁的方塊圖原始碼（docs/teaching-style.md §8；diagrams.test.tsx 以真正的 mermaid parser 逐一解析）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、等號的文字一律用雙引號包住。
 * - 加法點是圓形節點，文字寫全形「＋」；每條進來的邊以「＋」或「−」（U+2212）開頭。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 「六個條件」與「狀態怎麼決定」兩張圖由 data.ts 的資料產生（CONDITIONS、ITEMS、itemStatus 的規則），
 *   資料改了圖就跟著改；測試再核對一次。
 * - R1 的迴路圖與 model.ts 的 sigmaW2Lyapunov 是同一個狀態空間：δw_(k+1) = p·δw_k + μ·η_k、
 *   η_(k+1) = ρ·η_k + √(1 − ρ²)·σ_η·ξ_k（係數誤差在本頁記作 δw = w − w*，勘誤 E33）。
 */
import { CONDITIONS, ITEMS, ITEM_STATUS_LABEL, SUB_STATUS_LABEL, type Condition } from './data'

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/** 每個條件的判斷式（Unicode；與 data.ts 的 CONDITIONS[].question 同義，那邊是 KaTeX 版） */
export const CONDITION_CHECK: Record<Condition, string> = {
  identifiability: 'λ_min > 0',
  polarity: 'C > 0',
  stability: '所有 pole 在單位圓內',
  variance: 'σ_w 夠小',
  bias: 'w* 等於正確值',
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
export const CHART_R1_LOOP = `flowchart LR
  XI(["ξ_k<br/>白雜訊：各 block 獨立<br/>變異數 1"]) --> DRV["× √(1 − ρ²)·σ_η"]
  DRV -- "＋" --> S1(("＋"))
  S1 -- "η_(k+1)" --> Z1["z⁻¹"]
  Z1 -- "η_k" --> RHO["× ρ<br/>相鄰 block 的相關"]
  RHO -- "＋ ρ·η_k" --> S1
  Z1 -- "η_k" --> MU["× μ<br/>步長"]
  MU -- "＋ μ·η_k" --> S2(("＋"))
  S2 -- "δw_(k+1)" --> Z2["z⁻¹"]
  Z2 -- "δw_k" --> PP["× p<br/>p = 1 − μK"]
  PP -- "＋ p·δw_k" --> S2
  Z2 -- "δw_k" --> OUT(["係數雜訊<br/>σ_w² = E[δw_k²]"])
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
  Q1 -- "沒有" --> Q2{"有子目標是「${SUB_STATUS_LABEL.preview}」<br/>或「${SUB_STATUS_LABEL.pending}」？"}
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
export const DEPENDENCY_CHART = `flowchart LR
  R6["R6 Comparator 非理想"] --> R1["R1 有色 GMAC 雜訊"]
  R1 --> R2["R2 Cyclostationary"]
  R2 --> R10["R10 規格反推"]
  R3["R3 量化 / limit cycle"] --> R10
  R5["R5 Training sequence"] --> R4["R4 MIMO 更新矩陣"]
  R4 --> R8["R8 NLMS / RLS / Kalman"]
  R8 --> R3
  R7["R7 事件級 PLL"] --> SS["SSPLL GOS / PHOS 極性"]
  R7 --> R2
  R5 --> SS
  R9["R9 RTL bit-true / AMS"] --> R10
  R1 --> R10
  SS --> R10`

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
