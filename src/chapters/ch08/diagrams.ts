/**
 * Ch08 的 Mermaid 方塊圖原始碼（集中在這裡，diagrams.test.ts 用真正的 mermaid parser 驗證語法）。
 * 標籤內避免 ASCII '<' 與 ';'（改用全形 ＜、，），以免被 Mermaid 當成 HTML 或敘述分隔。
 */

/** 本章的三個模型：一階 → 加更新延遲 → 加觀測動態（雙迴路） */
export const ROADMAP_CHART = [
  'flowchart LR',
  '  A["§8.2 一階<br/>δ ← (1−g)·δ<br/>0 ＜ g ＜ 2"] --> B["§8.3 更新延遲 d<br/>δ ← δ − g·δ(k−d)<br/>g ＜ 2sin(π/(4d+2))"]',
  '  B --> C["§8.4 雙迴路<br/>s ← r·s + b·δ，δ ← δ − μ·c·s<br/>μbc ＜ 1 − r"]',
  '  C --> D["一般化<br/>ρ(A_comb) ＜ 1<br/>L = μF(z)/(z−1)"]',
].join('\n')

/** 一階 calibration loop（block rate；δ = a − w） */
export const FIRST_ORDER_CHART = [
  'flowchart LR',
  '  A(["目標 a"]) --> S(("Σ"))',
  '  S -- "δ_k = a − w_k" --> K["GMAC 平均斜率 K = K_q·C"]',
  '  K -- "G_k" --> I["暫存器（積分器）μ/(z − 1)"]',
  '  I -- "w_k" --> S',
].join('\n')

/** 二狀態模型：觀測狀態 s 有記憶（pole r_s），GMAC 只看得到 s */
export const DUAL_LOOP_CHART = [
  'flowchart LR',
  '  D(["δ_k"]) --> O["觀測動態<br/>s_{k+1} = r_s·s_k + b_s·δ_k"]',
  '  O -- "s_k" --> C["GMAC<br/>G_k = c_s·s_k"]',
  '  C -- "G_k" --> U["暫存器<br/>δ_{k+1} = δ_k − μ·G_k"]',
  '  U --> D',
].join('\n')
