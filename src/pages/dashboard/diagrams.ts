/**
 * Dashboard 的 Mermaid 圖原始碼（diagrams.test.ts 以真正的 mermaid parser 驗證語法）。
 * 標籤內避免 ASCII '<' 與 ';'（Mermaid 會當成 HTML 或敘述分隔）；換行用 <br/>。
 */

/** 圖上六個條件的短名稱（各自是 SIX_CONDITIONS[i].zh 的子字串；diagrams.test.ts 會檢查） */
export const CONDITION_MAP_NAMES = ['資訊足夠', '更新方向正確', '動態穩定', '統計精度足夠', '正確的物理參數', '改善 PLL 輸出'] as const

const N = CONDITION_MAP_NAMES

/**
 * 校正迴路的訊號流（實線）與六個條件各自「住在哪裡」（虛線圓角框）。
 * 對應線性化方程式 e[n] = (a − w)·u[n] + ε_det[n] + v[n]：
 *   (a − w) 來自 DTC / PMUX 的係數誤差、u = h*x 來自 PLL error path、ε_det 來自 offset / INL、v 是 comparator 前的雜訊。
 */
export const CONDITION_MAP_CHART = [
  'flowchart LR',
  '  DSM["DSM / FCW<br/>code x[n]"]',
  '  DTC["DTC / PMUX<br/>延遲 = w · x<br/>真值 a（GOS / PHOS）"]',
  '  PLL["PLL error path<br/>u = h * x<br/>|H|、φ"]',
  '  CMP["1-bit comparator<br/>q = sign(e)<br/>雜訊 σ_v"]',
  '  GMAC["GMAC<br/>G = (1/N) Σ q · x[n − D]"]',
  '  UPD["係數更新<br/>w ← w + μ · G<br/>（晚 d 個 block）"]',
  '  OUT["PLL 輸出<br/>jitter / spur"]',
  '  DSM --> DTC --> PLL --> CMP --> GMAC --> UPD',
  '  UPD -- "w（6-bit 暫存器）" --> DTC',
  '  DSM -. "x[n − D]" .-> GMAC',
  '  DTC -- "δt = x · δw，經 T" --> OUT',
  `  C1(["① ${N[0]}<br/>λ_min ＞ 0"]) -.- DSM`,
  `  C2(["② ${N[1]}<br/>C = E[x u] ＞ 0"]) -.- PLL`,
  `  C3(["③ ${N[2]}<br/>0 ＜ g ＜ g*"]) -.- UPD`,
  `  C4(["④ ${N[3]}<br/>σ_w 夠小"]) -.- CMP`,
  `  C5(["⑤ ${N[4]}<br/>w* = a + B/C"]) -.- DTC`,
  `  C6(["⑥ ${N[5]}<br/>jitter、spur"]) -.- OUT`,
].join('\n')

/** 圖下方的對照：每個條件主要取決於哪一塊、由哪些可調的量決定（$…$ 為 TeX） */
export const CONDITION_MAP_LEGEND: { n: number; block: string; knobs: string }[] = [
  { n: 1, block: 'DSM code（regressor）', knobs: 'FCW、code pattern、要同時校正幾個參數 → $\\mathbf R=E[\\mathbf u\\mathbf u^T]$ 的 $\\lambda_{\\min}$' },
  { n: 2, block: 'PLL error path ＋ GMAC 的 code delay', knobs: '$|H|$、$\\phi$、$D$ → $C=E[x\\,u]$ 的正負' },
  { n: 3, block: '係數更新（積分器）', knobs: '$\\mu$、GMAC 的 sum / average、commit 延遲 $d$ → $g=\\mu K_qC$ 與 $g^*(d)$' },
  { n: 4, block: 'Comparator 與 GMAC 累加', knobs: '$\\sigma_v$、$N$、$\\mu$ → $\\sigma_w$' },
  { n: 5, block: 'DTC / comparator 的非理想', knobs: 'offset、INL、code-correlated 干擾 → $B=E[x\\,\\varepsilon_{\\mathrm{det}}]$' },
  { n: 6, block: 'DTC 輸出到 PLL 輸出', knobs: 'code 頻譜、6-bit 量化、output transfer $T$ → jitter 與 spur' },
]
