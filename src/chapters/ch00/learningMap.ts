/**
 * 學習地圖：規格附錄 E「網站最後應能回答的 15 個問題」→ 負責回答的頁面 id（registry 中的 id）。
 * 第一個 id 是主要答案，其餘是補充。'ch00' 表示本章已先給出入門版答案。
 */
export interface MapEntry {
  q: number
  /** 問題文字；`$…$` 之間是 TeX（頁面以 InlineMath 排版，數學不以純文字呈現） */
  question: string
  pages: string[]
  /** 本章有入門版答案的段落錨點 */
  here?: string
  /** 錨點的顯示名稱，例如 '§0.6' */
  hereLabel?: string
}

export const LEARNING_MAP: MapEntry[] = [
  { q: 1, question: '為什麼叫 LMS？為何使用平方而不是絕對值？', pages: ['ch01', 'ch02', 'ch00'], here: '#ch00-why-ex', hereLabel: '§0.6' },
  { q: 2, question: String.raw`為什麼 GMAC 的 $e\,x$ 就是最小化方向？`, pages: ['ch00', 'ch01', 'ch04'], here: '#ch00-why-ex', hereLabel: '§0.6–§0.7' },
  { q: 3, question: String.raw`為什麼 $1\,\mathrm{fs}$ Error 埋在 $100\,\mathrm{fs}$ Noise 裡，1-bit Comparator 仍可保留資訊？`, pages: ['ch05', 'ch00'], here: '#ch00-sign', hereLabel: '§0.9' },
  { q: 4, question: '要累加幾筆才能以指定機率判斷 Error 正負？', pages: ['ch05'] },
  { q: 5, question: '為何 LMS 可能震盪收斂、臨界震盪、或發散？', pages: ['ch03', 'ch00', 'ch08'], here: '#ch00-why-ex', hereLabel: '§0.6' },
  { q: 6, question: 'Mean Stability 與 Mean-Square Stability 為何不一樣？', pages: ['ch03'] },
  { q: 7, question: '為何 PLL 主迴路穩定，LMS 卻可能因 Phase Shift 發散？', pages: ['ch06', 'case-sspll'] },
  { q: 8, question: '只加 Delay Register 能否改善？何時必須用 Filtered-x？', pages: ['ch07', 'case-sspll'] },
  { q: 9, question: 'Polarity Margin 與真正 LMS Phase Margin 是哪兩個不同概念？', pages: ['ch08'] },
  { q: 10, question: '什麼時候快速 PLL 和慢速 LMS 不能分開分析？', pages: ['ch08'] },
  { q: 11, question: '為何 GMAC 歸零不代表 DTC Gain 正確、Spur 為零？', pages: ['ch11', 'ch00'], here: '#ch00-assumptions', hereLabel: '§0.10' },
  { q: 12, question: '何謂 Persistent Excitation？多參數 LMS 為何有非常慢的模式？', pages: ['ch09'] },
  { q: 13, question: '為什麼 Preconditioning 可以加快收斂，卻會把弱資訊方向的 Noise 放大？', pages: ['ch10'] },
  { q: 14, question: 'Comparator Noise 經 GMAC 與 DSM Code 相乘後，如何變成 PLL Output PN/Spur？', pages: ['ch12'] },
  { q: 15, question: '6-bit Gain 要 Freeze、periodic toggle、dither 還是 noise shape，應該怎麼做定量選擇？', pages: ['ch13', 'ch14'] },
]

/** 規格 §19.1 的三條學習路線（頁面 id 依序）。 */
export const ROUTES: { name: string; pages: string[] }[] = [
  { name: '數學路線：MSE → Gradient → Scalar Stability → Sign-LMS → PE → MIMO', pages: ['ch00', 'ch01', 'ch02', 'ch03', 'ch09', 'ch10'] },
  { name: 'PLL 架構路線：DSM Code → DTC → PD → GMAC → H(z) → Polarity → Dual Loop', pages: ['ch04', 'ch05', 'ch06', 'ch07', 'ch08'] },
  { name: '晶片驗證路線：Noise → Bias → Quantization → Spur/Jitter → Fixed Point → Sign-off', pages: ['ch11', 'ch12', 'ch13', 'ch14', 'models', 'signoff'] },
]
