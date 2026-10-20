import { estimateReadingMinutes, type ReadingCounts } from './chapterMeta'
import { pageById } from './registry'

/**
 * Beginner 骨幹路線（wave 4，pedagogy／ux 審查：Beginner 只是「收合」不是「精簡」，每章仍要 2–3 小時，也沒有一條最短路徑）。
 *
 * 一條從 Ch00 走到 Sign-off 的最短路徑：每一步是某一章的一段（anchor 起、until 止），而不是整章。
 * Dashboard 在 Beginner 模式的首屏畫這條路線（步驟、分鐘數、完成勾選、思考題進度、「從上次離開的地方繼續」）。
 *
 * - `page`：registry 的頁面 id；`anchor`：這一步從該章哪個元素 id 開始（沒給 = 章首）；`until`：到哪個 id 為止（不含；沒給 = 章末）。
 *   anchor／until 都必須是該章原始碼裡真的有的 id（backbone.test.ts 會到原始碼裡找 `id="…"` 或 `'…'`）。
 *   ch05 的各節現在都有穩定的 id（`ch05-intuition`、`ch05-accumulate`…；maint-dedup），那一步也用 `until`。
 * - `reading`：這一段在 Beginner 模式看得到的內容量（中文字、獨立公式、圖、實驗），2026-10-19 以 scratch 腳本 measure-segments.mjs 對
 *   http://localhost:5180 量（和 scripts/reading-time.mjs 同一套計法，只是依 h2 的位置切段：章首到第一個 h2 算一段，之後每個 h2 一段）。
 *   `minutes` = estimateReadingMinutes(reading)（chapterMeta.ts 的 READING_RATE：350 字／分、每條公式 0.2 分、每張圖 0.5 分、每個實驗 3 分，5 的倍數）。
 * - `experiments`：這一段裡的互動實驗 id；beginnerControls.ts 替它們列出 Beginner 模式先露出的控制項。
 * - 完成狀態沿用 Dashboard 的 `lmspll.dashboard.done`（字串陣列）：整章的步驟用頁面 id（和章節卡片的「已讀」同一格），
 *   段落級的步驟用 `page#anchor`（backboneStepId）。
 */
export interface BackboneStep {
  /** registry 的頁面 id（'ch00'、'signoff'） */
  page: string
  /** 起點：該章原始碼裡的元素 id；沒給就是章首（連結不帶 ?a=） */
  anchor?: string
  /** 終點（不含）：該章原始碼裡的元素 id；沒給就是章末 */
  until?: string
  /** 一句話：這一步學什麼 */
  title: string
  /** 範圍標示，例如 '§0.1–§0.5' */
  sections: string
  /** 這一段在 Beginner 模式的內容量（量測值） */
  reading: ReadingCounts
  /** = estimateReadingMinutes(reading) */
  minutes: number
  /** 這一段裡的互動實驗 id */
  experiments: string[]
}

type StepInput = Omit<BackboneStep, 'minutes'>

const RAW: StepInput[] = [
  {
    page: 'ch00',
    until: 'ch00-why-ex',
    title: '黑盒子、三個動作與 LMS 更新式：先手算兩步，再把 $\\mu$ 拉大拉小',
    sections: '§0.1–§0.5',
    reading: { han: 6064, formulas: 91, figures: 11, experiments: 1 },
    experiments: ['intro-playground'],
  },
  {
    page: 'ch01',
    until: 'ch01-s12',
    title: 'Least／Mean／Squares 逐字拆解：為什麼是平方？',
    sections: '§1.0–§1.1',
    reading: { han: 3010, formulas: 43, figures: 5, experiments: 0 },
    experiments: [],
  },
  {
    page: 'ch01',
    anchor: 'ch01-s14',
    until: 'ch01-s21',
    title: '規格 §1.2 的手算例子，然後在 LMS Playground 看 $w_n\\to a$',
    sections: '§1.4–§1.5',
    reading: { han: 2811, formulas: 52, figures: 7, experiments: 1 },
    experiments: ['lms-playground'],
  },
  {
    page: 'ch02',
    until: 'ch02-s2',
    title: '從切線斜率到 Gradient Descent：$-e\\,x$ 就是斜率',
    sections: '§1',
    reading: { han: 3833, formulas: 73, figures: 7, experiments: 1 },
    experiments: ['gd-tangent'],
  },
  {
    page: 'ch02',
    anchor: 'ch02-s3',
    until: 'ch02-s4',
    title: 'MAE ⇒ Sign-Error LMS：只用誤差的正負號也能學',
    sections: '§3',
    reading: { han: 5180, formulas: 119, figures: 8, experiments: 1 },
    experiments: ['sign-lms-band'],
  },
  {
    page: 'ch04',
    until: 'ch04-gmac',
    title: 'DSM → DTC → PD → GMAC 的訊號流，以及 DTC 到底要補償什麼',
    sections: 'Part 1 §1–§2',
    reading: { han: 5356, formulas: 85, figures: 7, experiments: 1 },
    experiments: ['gmac-residue'],
  },
  {
    page: 'ch05',
    until: 'ch05-accumulate',
    title: '1-bit comparator：一枚只偏一點點的硬幣，$P(q=+1)$、$E[q]$ 與 $\\operatorname{Var}(q)$',
    sections: '直覺–§2',
    reading: { han: 3794, formulas: 98, figures: 8, experiments: 0 },
    experiments: [],
  },
  {
    page: 'ch06',
    until: 'ch06-s4',
    title: 'PD 看到的是 $u=h*x$：$G\\approx K_q(a-w)C$ 與 pole $p=1-\\mu K_qC$',
    sections: '§1–§3',
    reading: { han: 7170, formulas: 119, figures: 8, experiments: 0 },
    experiments: [],
  },
  {
    page: 'ch11',
    until: 'ch11-fixed-point',
    title: 'GMAC 歸零不代表 DTC 誤差為零：總誤差模型 $e=(a-w)x+b+d(x)+v$',
    sections: '直覺–§11.0',
    reading: { han: 3702, formulas: 60, figures: 4, experiments: 0 },
    experiments: [],
  },
  {
    page: 'ch14',
    until: 'ch14-msd',
    title: '$\\mu$ 大一點好還是小一點好？先算 $g=0.1$ 的前三個 block',
    sections: '§14.0–§14.0.1',
    reading: { han: 2989, formulas: 32, figures: 3, experiments: 0 },
    experiments: [],
  },
  {
    page: 'ch14',
    anchor: 'ch14-budget',
    until: 'ch14-corner',
    title: '固定總預算：$N$ 大更新少、還是 $N$ 小更新多？用設計計算器驗算',
    sections: '§14.3–§14.4',
    reading: { han: 2639, formulas: 29, figures: 7, experiments: 1 },
    experiments: ['lr-optimizer'],
  },
  {
    page: 'signoff',
    until: 'so-matrix',
    title: 'Sign-off 要回答什麼：證據、措辭與限制',
    sections: '§0',
    reading: { han: 2021, formulas: 10, figures: 1, experiments: 0 },
    experiments: [],
  },
]

/** Beginner 骨幹路線（順序即閱讀順序） */
export const BACKBONE: readonly BackboneStep[] = RAW.map((s) => ({ ...s, minutes: estimateReadingMinutes(s.reading) }))

/** 總時間目標（分鐘）：≤ 6 小時（backbone.test.ts 檢查） */
export const BACKBONE_MAX_MINUTES = 360

export function backboneTotalMinutes(): number {
  return BACKBONE.reduce((a, s) => a + s.minutes, 0)
}

/** 完成紀錄的 key：整章的步驟 = 頁面 id（和章節卡片的「已讀」同一格）；段落級 = `page#anchor` */
export function backboneStepId(step: Pick<BackboneStep, 'page' | 'anchor'>): string {
  return step.anchor ? `${step.page}#${step.anchor}` : step.page
}

/** 這一步的路由（HashRouter 的路徑，不含 #）：有 anchor 就帶 ?a=，載入後 AnchorDeepLink 會捲過去 */
export function backboneHref(step: Pick<BackboneStep, 'page' | 'anchor'>): string {
  const p = pageById(step.page)
  const path = p?.path ?? '/'
  return step.anchor ? `${path}?a=${encodeURIComponent(step.anchor)}` : path
}

/** 路線上第 k 步（0 起算）在 BACKBONE 裡的位置；找不到是 -1 */
export function backboneIndexOf(stepId: string): number {
  return BACKBONE.findIndex((s) => backboneStepId(s) === stepId)
}

export interface BackboneProgress {
  done: number
  total: number
  minutesDone: number
  minutesLeft: number
  /** 第一個還沒完成的步驟；全部完成是 null */
  next: BackboneStep | null
}

/** 依 Dashboard 的已讀紀錄（lmspll.dashboard.done 的集合）算路線進度 */
export function backboneProgress(done: ReadonlySet<string>): BackboneProgress {
  let n = 0
  let minutesDone = 0
  let next: BackboneStep | null = null
  for (const s of BACKBONE) {
    if (done.has(backboneStepId(s))) {
      n++
      minutesDone += s.minutes
    } else if (!next) next = s
  }
  const total = backboneTotalMinutes()
  return { done: n, total: BACKBONE.length, minutesDone, minutesLeft: total - minutesDone, next }
}

/* ───────────── 從上次離開的地方繼續 ───────────── */

/** localStorage 的 key：最後造訪的頁面 { page, anchor?, at }（Dashboard 的步驟連結按下時記；PageFrame 換頁時也可以記） */
export const LAST_VISIT_KEY = 'lmspll.lastVisited'
/** 可選：各頁最後捲到的錨點 `lmspll.scroll.<pageId>` = 元素 id 字串（目前沒有人寫，Dashboard 只是防禦式地讀） */
export const SCROLL_KEY_PREFIX = 'lmspll.scroll.'

export interface LastVisit {
  page: string
  anchor?: string
  /** epoch ms */
  at: number
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 讀最後造訪的頁面；沒有、壞掉或 storage 不可用都是 null */
export function readLastVisit(): LastVisit | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(LAST_VISIT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LastVisit> | null
    if (!v || typeof v !== 'object' || typeof v.page !== 'string' || !pageById(v.page)) return null
    const anchor = typeof v.anchor === 'string' && v.anchor ? v.anchor : readScrollAnchor(v.page)
    return { page: v.page, anchor, at: typeof v.at === 'number' ? v.at : 0 }
  } catch {
    return null
  }
}

/** `lmspll.scroll.<pageId>`（若有人寫）：該頁最後捲到的元素 id */
export function readScrollAnchor(pageId: string): string | undefined {
  const s = storage()
  if (!s) return undefined
  try {
    const raw = s.getItem(`${SCROLL_KEY_PREFIX}${pageId}`)
    if (!raw) return undefined
    // 允許兩種寫法：純字串的 id，或 JSON { anchor }
    if (raw.startsWith('{')) {
      const v = JSON.parse(raw) as { anchor?: unknown } | null
      return v && typeof v.anchor === 'string' && v.anchor ? v.anchor : undefined
    }
    const id = raw.replace(/^"|"$/g, '')
    // 純數字（例如別人記的 scrollY）不是元素 id
    return /^[\w.:-]+$/.test(id) && !/^\d+$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

/** 記下最後造訪的頁面（storage 不可用時安靜略過）；回傳是否真的寫進去了 */
export function recordLastVisit(page: string, anchor?: string, at = Date.now()): boolean {
  const s = storage()
  if (!s || !pageById(page)) return false
  try {
    s.setItem(LAST_VISIT_KEY, JSON.stringify({ page, ...(anchor ? { anchor } : {}), at } satisfies LastVisit))
    return true
  } catch {
    return false
  }
}

/**
 * 換頁時呼叫（PageFrame）：把「最後造訪」更新成這一頁，但只限於路線上的頁面（否則走到路線外的頁面會把路線的位置蓋掉），
 * 而且同一頁已經有錨點（從 Dashboard 的步驟連結進來時記的）就保留。
 */
export function touchLastVisit(page: string, at = Date.now()): boolean {
  if (!BACKBONE.some((s) => s.page === page)) return false
  const prev = readLastVisit()
  return recordLastVisit(page, prev && prev.page === page ? prev.anchor : undefined, at)
}

export interface ResumeTarget {
  /** 要去的步驟（全部完成且沒有上次位置時是第一步） */
  step: BackboneStep
  /** 連結（有上次的錨點就帶 ?a=） */
  href: string
  kind: 'last-visit' | 'next' | 'start' | 'all-done'
  /** 這一步是路線的第幾步（1 起算） */
  index: number
}

/**
 * 「從上次離開的地方繼續」要去哪：
 * 1. 有上次造訪的紀錄、而且那一頁在路線上、那一步還沒完成 → 回到那一頁（有錨點就帶 ?a=）；
 * 2. 否則第一個還沒完成的步驟（一步都沒做過就是「開始第 1 步」）；
 * 3. 全部完成 → 回到第 1 步複習。
 */
export function resumeTarget(done: ReadonlySet<string>, last: LastVisit | null): ResumeTarget {
  if (last) {
    // 同一頁可能有兩步（ch01、ch02、ch14）：優先挑錨點對得上的那一步，否則該頁第一個還沒完成的步驟
    const onPage = BACKBONE.map((s, i) => ({ s, i })).filter(({ s }) => s.page === last.page)
    const byAnchor = last.anchor ? onPage.find(({ s }) => s.anchor === last.anchor) : undefined
    const pick = byAnchor ?? onPage.find(({ s }) => !done.has(backboneStepId(s)))
    if (pick && !done.has(backboneStepId(pick.s))) {
      const path = pageById(last.page)?.path ?? '/'
      const anchor = last.anchor ?? pick.s.anchor
      return { step: pick.s, href: anchor ? `${path}?a=${encodeURIComponent(anchor)}` : path, kind: 'last-visit', index: pick.i + 1 }
    }
  }
  const progress = backboneProgress(done)
  if (progress.next) {
    const i = backboneIndexOf(backboneStepId(progress.next))
    return { step: progress.next, href: backboneHref(progress.next), kind: progress.done === 0 ? 'start' : 'next', index: i + 1 }
  }
  return { step: BACKBONE[0], href: backboneHref(BACKBONE[0]), kind: 'all-done', index: 1 }
}

/** 「約 6 小時」「約 1.5 小時」「25 分」這樣的文字（Dashboard 的卡片與 aria-label 用） */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} 分`
  const h = min / 60
  const rounded = Math.round(h * 2) / 2
  return Number.isInteger(rounded) ? `約 ${rounded} 小時` : `約 ${rounded.toFixed(1)} 小時`
}
