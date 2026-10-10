import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * 全站頁面註冊表（規格 §18.3 資訊架構）。
 * 每個章節 / 頁面擁有自己的資料夾，default export 一個 React component。
 * 導覽、路由、Dashboard、Formula Reference 都從這裡讀取，不要在別處硬寫章節清單。
 */
export type PageGroup = 'start' | 'A' | 'B' | 'C' | 'D' | 'tools'

export interface PageEntry {
  id: string
  path: string
  /** 側欄顯示（含章節編號） */
  nav: string
  /** 頁面標題 */
  title: string
  group: PageGroup
  /** 對應規格書章節 */
  specSections?: string[]
  /** 本頁負責的 Acceptance tests */
  tests?: string[]
  component: LazyExoticComponent<ComponentType>
}

export const GROUP_LABEL: Record<PageGroup, string> = {
  start: '開始',
  A: 'Part A｜LMS 數學基礎',
  B: 'Part B｜PLL 校正實作',
  C: 'Part C｜誤差與晶片限制',
  D: 'Part D｜驗證與實作',
  tools: '實驗室與參考',
}

const ch = (n: string) => lazy(() => import(`../chapters/ch${n}/index.tsx`))

export const PAGES: PageEntry[] = [
  { id: 'dashboard', path: '/', nav: 'Dashboard / 學習路線', title: 'LMS × Fractional-N PLL Calibration Lab', group: 'start', component: lazy(() => import('../pages/dashboard/index.tsx')) },

  { id: 'ch00', path: '/ch/00', nav: '00 入門：LMS 是什麼、為什麼重要', title: '入門：把我當高中畢業生，什麼是 LMS？', group: 'A', specSections: ['1'], tests: ['T01'], component: ch('00') },
  { id: 'ch01', path: '/ch/01', nav: '01 LMS 起源與 MSE / MAE', title: 'LMS 為什麼叫 Least Mean Squares？', group: 'A', specSections: ['1', '2'], tests: ['T01'], component: ch('01') },
  { id: 'ch02', path: '/ch/02', nav: '02 Gradient Descent & Sign-LMS', title: 'Gradient Descent、Sign-Error LMS 與 Sign-Sign LMS', group: 'A', specSections: ['1.1', '2.1', '2.2', '2.3'], tests: ['T01'], component: ch('02') },
  { id: 'ch03', path: '/ch/03', nav: '03 Mean / Mean-Square Stability', title: 'LMS 穩定性：Mean 與 Mean-Square', group: 'A', specSections: ['3', '3.1'], tests: ['T02', 'T03'], component: ch('03') },

  { id: 'ch04', path: '/ch/04', nav: '04 DTC / DSM / PLL + GMAC', title: 'DSM → DTC → PD → GMAC → Gain Update 系統訊號流', group: 'B', specSections: ['4', '4.1', '4.2'], component: ch('04') },
  { id: 'ch05', path: '/ch/05', nav: '05 1-bit Comparator 統計', title: '1-bit Comparator：雜訊下仍保留的資訊', group: 'B', specSections: ['5', '5.1'], tests: ['T04', 'T05'], component: ch('05') },
  { id: 'ch06', path: '/ch/06', nav: '06 PLL Error Transfer & Polarity', title: 'PLL Error Transfer 的相位會讓 LMS 發散嗎？', group: 'B', specSections: ['6', '6.1', '6.2'], tests: ['T06'], component: ch('06') },
  { id: 'ch07', path: '/ch/07', nav: '07 Delay Alignment / Filtered-x', title: 'Delay Alignment vs. Filtered-x LMS', group: 'B', specSections: ['7'], tests: ['T07'], component: ch('07') },
  { id: 'case-sspll', path: '/case/sspll', nav: '07b 案例：SSPLL 的 GOS / PHOS 極性', title: '案例：Subsampling PLL 中 GOS（DTC Gain）與 PHOS（8 相 PMUX）LMS 為何變號', group: 'B', specSections: ['6', '7', '9.2', '11.4'], component: lazy(() => import('../pages/case-sspll/index.tsx')) },
  { id: 'ch08', path: '/ch/08', nav: '08 LMS Phase Margin & Dual Loops', title: 'Calibration Phase Margin 與雙迴路耦合', group: 'B', specSections: ['8', '8.1', '8.2', '8.3', '8.4'], tests: ['T08', 'T09'], component: ch('08') },
  { id: 'ch09', path: '/ch/09', nav: '09 Persistent Excitation & Eigenvalues', title: 'Persistent Excitation：穩定不代表學得到', group: 'B', specSections: ['9', '9.1', '9.2'], tests: ['T10', 'T11'], component: ch('09') },
  { id: 'ch10', path: '/ch/10', nav: '10 Multi-Parameter Preconditioning', title: '多參數 Sign-LMS、Jacobian 與 Preconditioner', group: 'B', specSections: ['10', '10.1', '10.2', '10.3'], tests: ['T18'], component: ch('10') },

  { id: 'ch11', path: '/ch/11', nav: '11 Calibration Bias & DTC INL', title: 'GMAC 歸零不代表 DTC Error 為零', group: 'C', specSections: ['11'], tests: ['T12'], component: ch('11') },
  { id: 'ch12', path: '/ch/12', nav: '12 Coefficient Noise → PLL Output', title: 'Comparator Noise 如何經 LMS 變成 PLL Jitter / Spurs', group: 'C', specSections: ['12'], tests: ['T13', 'T14', 'T15'], component: ch('12') },
  { id: 'ch13', path: '/ch/13', nav: '13 Quantization / Limit Cycles / ΔΣ', title: '6-bit 校正係數：Quantization、Limit Cycle、Dither、Noise Shaping', group: 'C', specSections: ['13'], tests: ['T16', 'T17'], component: ch('13') },
  { id: 'ch14', path: '/ch/14', nav: '14 Learning Rate & N Optimizer', title: 'Learning Rate、Accumulation Length 與 Tracking Schedule', group: 'C', specSections: ['14'], component: ch('14') },

  { id: 'models', path: '/models', nav: 'Behavioral Models & RTL', title: 'Behavioral Models、RTL 與 Sign-off（Part D）', group: 'D', specSections: ['15', '16'], component: lazy(() => import('../pages/models/index.tsx')) },
  { id: 'verification', path: '/verification', nav: 'T01–T18 驗證狀態', title: '數值回歸測試與勘誤（Acceptance Reference Values）', group: 'D', specSections: ['17'], component: lazy(() => import('../pages/verification/index.tsx')) },

  { id: 'lab', path: '/lab', nav: 'Calibration Lab（整合模擬）', title: 'Unified Calibration Lab', group: 'tools', component: lazy(() => import('../pages/lab/index.tsx')) },
  { id: 'workbook', path: '/workbook', nav: '手算練習簿', title: '手算練習簿：把數字代進公式自己算', group: 'tools', component: lazy(() => import('../pages/workbook/index.tsx')) },
  { id: 'gallery', path: '/gallery', nav: 'Experiment Gallery', title: 'Experiment Gallery（預設實驗集）', group: 'tools', component: lazy(() => import('../pages/gallery/index.tsx')) },
  { id: 'signoff', path: '/signoff', nav: 'Sign-off Checklist', title: 'Sign-off Checklist / Design Review', group: 'tools', specSections: ['16.2', '16.3'], component: lazy(() => import('../pages/signoff/index.tsx')) },
  { id: 'formulas', path: '/formulas', nav: 'Formula & Unit Reference', title: '公式速查與單位約定', group: 'tools', specSections: ['0', 'A'], component: lazy(() => import('../pages/formulas/index.tsx')) },
  { id: 'papers', path: '/papers', nav: 'Papers / Reading', title: '建議閱讀', group: 'tools', specSections: ['D'], component: lazy(() => import('../pages/papers/index.tsx')) },
  { id: 'roadmap', path: '/roadmap', nav: 'Research Backlog', title: 'Research Backlog / Roadmap', group: 'tools', specSections: ['C'], component: lazy(() => import('../pages/roadmap/index.tsx')) },
]

export function pageById(id: string): PageEntry | undefined {
  return PAGES.find((p) => p.id === id)
}

export function neighbours(id: string): { prev?: PageEntry; next?: PageEntry } {
  const i = PAGES.findIndex((p) => p.id === id)
  return { prev: i > 0 ? PAGES[i - 1] : undefined, next: i >= 0 && i < PAGES.length - 1 ? PAGES[i + 1] : undefined }
}
