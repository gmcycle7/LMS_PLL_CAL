/**
 * 思考題進度：Quiz 作答時記一筆，Dashboard 之類的地方可以讀「這一章答了幾題、答對幾題」。
 *
 *   localStorage  lmspll.quiz.<pageId>.<quizId>  = { picked, correct, at }
 *   localStorage  lmspll.quizset.<pageId>        = [quizId, …]   該頁最後一次掛載時有哪些題（讓別頁也讀得到分母）
 *
 * - pageId：registry 的頁面 id（'ch04'、'case-sspll'）；路徑不在 registry 裡（單元測試、404）就用路徑的 slug。
 * - quizId：Quiz 的 `id` prop；沒有就由「標題 + 題目文字」雜湊出來（makeQuizId）。題目文字不變，id 就不變，
 *   所以學習模式切換（Beginner 少幾題）、題目順序調整都不會讓舊紀錄對不上。
 * - 計算題（沒有選項）按「看答案與解析」才算作答（picked: null、correct: null）；選擇題選了選項就算（correct 是 true／false）。
 *   只看解析不選的選擇題不算。
 * - 讀不到／寫不進 localStorage（無痕、被封鎖）時安靜地略過：這個進度只是便利功能，頁面照常運作。
 */
import { useEffect, useState } from 'react'
import { PAGES } from './registry'

export const QUIZ_KEY_PREFIX = 'lmspll.quiz.'
export const QUIZSET_KEY_PREFIX = 'lmspll.quizset.'
/** 進度改變時在 window 上發的事件（同一個分頁內的訂閱用；其他分頁走瀏覽器的 'storage' 事件） */
export const QUIZ_EVENT = 'lmspll:quiz'

export interface QuizRecord {
  /** 選了第幾個選項（0 起算）；計算題是 null */
  picked: number | null
  /** 選擇題：選對了嗎；計算題是 null */
  correct: boolean | null
  /** 作答時間（epoch ms） */
  at: number
}

export interface QuizStats {
  answered: number
  correct: number
  total: number
}

/* ───────────── id ───────────── */

/** 路徑（'/ch/04'、'/case/sspll'、'/'）→ pageId（'ch04'、'case-sspll'、'dashboard'）；registry 沒有的路徑用 slug */
export function pageIdForPath(path: string): string {
  const clean = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/'
  const hit = PAGES.find((p) => p.path === clean)
  if (hit) return hit.id
  return clean.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard'
}

/** 目前網址的 pageId（HashRouter：window.location.hash）。Quiz 掛載時呼叫；沒有 window 時是 'dashboard' */
export function currentPageId(): string {
  if (typeof window === 'undefined') return 'dashboard'
  const raw = window.location.hash.replace(/^#/, '')
  return pageIdForPath(raw.split('?')[0] || '/')
}

/** 小標題 + 題目文字 → 穩定的短 id，例如 '思考題-1-k3f9a2'（djb2 雜湊；只需要在同一頁內不撞） */
export function makeQuizId(title: string, questionText: string): string {
  let h = 5381
  const s = `${title}\u0001${questionText.replace(/\s+/g, ' ').trim()}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  const slug = title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'quiz'
  return `${slug}-${h.toString(36)}`
}

export function quizKey(pageId: string, quizId: string): string {
  return `${QUIZ_KEY_PREFIX}${pageId}.${quizId}`
}

/* ───────────── 儲存 ───────────── */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function notify() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUIZ_EVENT))
  } catch {
    /* 忽略 */
  }
}

function parseRecord(raw: string | null): QuizRecord | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<QuizRecord> | null
    if (!v || typeof v !== 'object' || typeof v.at !== 'number') return null
    const picked = typeof v.picked === 'number' && Number.isInteger(v.picked) && v.picked >= 0 ? v.picked : null
    const correct = typeof v.correct === 'boolean' ? v.correct : null
    return { picked, correct, at: v.at }
  } catch {
    return null
  }
}

export function readQuiz(pageId: string, quizId: string): QuizRecord | null {
  try {
    return parseRecord(storage()?.getItem(quizKey(pageId, quizId)) ?? null)
  } catch {
    return null
  }
}

/** 記一筆作答（同一題再答會覆蓋）。回傳是否真的寫進去了 */
export function recordQuiz(pageId: string, quizId: string, rec: Omit<QuizRecord, 'at'> & { at?: number }): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.setItem(quizKey(pageId, quizId), JSON.stringify({ picked: rec.picked, correct: rec.correct, at: rec.at ?? Date.now() } satisfies QuizRecord))
  } catch {
    return false
  }
  notify()
  return true
}

/** 清掉某一頁（不給就是全部）的作答紀錄，不動題目清單 */
export function clearQuizProgress(pageId?: string): void {
  const s = storage()
  if (!s) return
  try {
    const prefix = pageId ? `${QUIZ_KEY_PREFIX}${pageId}.` : QUIZ_KEY_PREFIX
    const drop: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && k.startsWith(prefix)) drop.push(k)
    }
    for (const k of drop) s.removeItem(k)
  } catch {
    return
  }
  notify()
}

/* ───────────── 題目登記（分母） ───────────── */

/** 現在掛在畫面上的題目：pageId → quizId 集合 */
const live = new Map<string, Set<string>>()
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 同一個 tick 內的登記合併成一次寫入；整頁都卸載了（換頁）就不寫，保留上次的清單 */
function scheduleFlush(pageId: string) {
  if (flushTimers.has(pageId)) return
  flushTimers.set(
    pageId,
    setTimeout(() => {
      flushTimers.delete(pageId)
      const ids = live.get(pageId)
      if (!ids || ids.size === 0) return
      try {
        const next = JSON.stringify([...ids].sort())
        const key = `${QUIZSET_KEY_PREFIX}${pageId}`
        const s = storage()
        if (s && s.getItem(key) !== next) {
          s.setItem(key, next)
          notify()
        }
      } catch {
        /* 忽略 */
      }
    }, 0),
  )
}

/** Quiz 掛載時登記自己；回傳卸載時要呼叫的函式 */
export function registerQuiz(pageId: string, quizId: string): () => void {
  let set = live.get(pageId)
  if (!set) live.set(pageId, (set = new Set()))
  set.add(quizId)
  scheduleFlush(pageId)
  return () => {
    const cur = live.get(pageId)
    if (!cur) return
    cur.delete(quizId)
    if (cur.size === 0) live.delete(pageId)
    else scheduleFlush(pageId)
  }
}

function persistedSet(pageId: string): string[] | null {
  try {
    const raw = storage()?.getItem(`${QUIZSET_KEY_PREFIX}${pageId}`)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

/** 某一頁已有紀錄的 quizId */
function answeredIds(pageId: string): string[] {
  const s = storage()
  if (!s) return []
  const prefix = `${QUIZ_KEY_PREFIX}${pageId}.`
  const out: string[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length))
    }
  } catch {
    return []
  }
  return out
}

/**
 * 某一頁的思考題進度。
 *   total    = 現在這一頁掛著的題數（頁面開著時，隨學習模式變動）；沒開著就是上次掛載時記下的題數；從來沒開過就是 0。
 *   answered = 這些題裡已有紀錄的數量（已知題目清單之外的舊紀錄不算，例如只在別的模式才出現的題）；
 *              題目清單未知時（total = 0）退回「該頁所有紀錄」的數量。
 *   correct  = 其中 correct === true 的數量（計算題的 correct 是 null，不算答對也不算答錯）。
 */
export function quizStats(pageId: string): QuizStats {
  const set = live.get(pageId)
  const known = set && set.size > 0 ? [...set] : persistedSet(pageId)
  const ids = known ?? answeredIds(pageId)
  let answered = 0
  let correct = 0
  for (const id of ids) {
    const rec = readQuiz(pageId, id)
    if (!rec) continue
    answered++
    if (rec.correct === true) correct++
  }
  return { answered, correct, total: known ? known.length : 0 }
}

/** 訂閱進度變化（同分頁的 QUIZ_EVENT 與其他分頁的 'storage'）；回傳取消訂閱 */
export function subscribeQuizProgress(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(QUIZ_KEY_PREFIX) || e.key.startsWith(QUIZSET_KEY_PREFIX)) listener()
  }
  window.addEventListener(QUIZ_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(QUIZ_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** React 用：某一頁的進度，作答後自動更新（Dashboard 的章節卡片用） */
export function useQuizStats(pageId: string): QuizStats {
  const [stats, setStats] = useState<QuizStats>(() => quizStats(pageId))
  useEffect(() => {
    const refresh = () =>
      setStats((prev) => {
        const next = quizStats(pageId)
        return prev.answered === next.answered && prev.correct === next.correct && prev.total === next.total ? prev : next
      })
    refresh()
    return subscribeQuizProgress(refresh)
  }, [pageId])
  return stats
}
