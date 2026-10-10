import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/* useDebouncedValue                                                   */
/* ------------------------------------------------------------------ */

/**
 * 回傳延遲 ms 毫秒後才更新的值；拖動滑桿時避免每一步都重跑昂貴模擬（conventions §3-6）。
 * ms ≤ 0 時直接回傳最新值。
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (ms <= 0) return
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return ms <= 0 ? value : debounced
}

/* ------------------------------------------------------------------ */
/* usePersistentState                                                  */
/* ------------------------------------------------------------------ */

function readStorage<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (validate ? validate(parsed) : parsed !== null && parsed !== undefined) return parsed as T
  } catch {
    /* storage 不可用、或內容不是合法 JSON → 使用預設值 */
  }
  return fallback
}

/**
 * 與 useState 相同，但值會以 JSON 存進 localStorage（所有存取都包在 try/catch 中；
 * 私密瀏覽或停用儲存時只是不保存，不會出錯）。
 * 建議 key 加上 'lmspll.' 前綴；可傳 validate 型別守衛，避免讀到舊版不相容的資料。
 */
export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  validate?: (v: unknown) => v is T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const initialRef = useRef(initial)
  const resolveInitial = (): T =>
    typeof initialRef.current === 'function' ? (initialRef.current as () => T)() : initialRef.current
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readStorage(key, resolveInitial(), validate),
  }))
  // key 改變時重新讀取
  let current = state
  if (state.key !== key) {
    current = { key, value: readStorage(key, resolveInitial(), validate) }
    setState(current)
  }

  useEffect(() => {
    try {
      localStorage.setItem(current.key, JSON.stringify(current.value))
    } catch {
      /* quota 或 storage 停用 → 忽略 */
    }
  }, [current.key, current.value])

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setState((s) => ({ key: s.key, value: typeof v === 'function' ? (v as (prev: T) => T)(s.value) : v }))
  }, [])

  return [current.value, set]
}

/* ------------------------------------------------------------------ */
/* useCases：Case A / B / C 參數比較（同一 seed 的 paired simulation）   */
/* ------------------------------------------------------------------ */

export type CaseId = 'A' | 'B' | 'C'
export const CASE_IDS: readonly CaseId[] = ['A', 'B', 'C']

export interface ParamCase<P> {
  id: CaseId
  params: P
  /** 0 / 1 / 2：對應 --series-1..3 */
  seriesIndex: number
  /** CSS 變數名稱，例如 '--series-1'（Plotly 需先用 cssVar() 取得實際顏色） */
  colorVar: string
}

export interface UseCasesResult<P> {
  cases: ParamCase<P>[]
  activeId: CaseId
  active: ParamCase<P>
  setActive: (id: CaseId) => void
  /** 更新某個 case（預設為目前選取的 case） */
  update: (patch: Partial<P> | ((p: P) => P), id?: CaseId) => void
  /** 複製目前 case 的參數成為下一個 case；已滿 3 個時回傳 null */
  addCase: () => CaseId | null
  /** 移除 case（至少保留一個） */
  removeCase: (id: CaseId) => void
  /** 回到只有 Case A（可指定新參數） */
  reset: (params?: P) => void
  /** 所有 case 共用的 seed（paired comparison：差異只來自參數，不來自亂數） */
  seed: number
  setSeed: (s: number) => void
  canAdd: boolean
}

/** 產生新的 32-bit 無號整數 seed（優先使用 crypto.getRandomValues） */
export function randomSeed(): number {
  try {
    const a = new Uint32Array(1)
    crypto.getRandomValues(a)
    return a[0]
  } catch {
    return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
  }
}

function makeCase<P>(id: CaseId, params: P): ParamCase<P> {
  const i = CASE_IDS.indexOf(id)
  return { id, params, seriesIndex: i, colorVar: `--series-${i + 1}` }
}

/**
 * 管理最多 3 組參數（Case A / B / C），共用同一個 seed。
 * 典型用法：每個 case 用相同 seed 跑模擬並畫在同一張圖（顏色用 seriesIndex）。
 */
export function useCases<P>(initial: P, opts: { seed?: number; max?: 1 | 2 | 3 } = {}): UseCasesResult<P> {
  const max = opts.max ?? 3
  const [state, setState] = useState<{ cases: ParamCase<P>[]; activeId: CaseId }>(() => ({
    cases: [makeCase('A', initial)],
    activeId: 'A',
  }))
  const [seed, setSeedState] = useState<number>(() => opts.seed ?? 20261010)

  const setActive = useCallback((id: CaseId) => {
    setState((s) => (s.cases.some((c) => c.id === id) ? { ...s, activeId: id } : s))
  }, [])

  const update = useCallback((patch: Partial<P> | ((p: P) => P), id?: CaseId) => {
    setState((s) => {
      const target = id ?? s.activeId
      return {
        ...s,
        cases: s.cases.map((c) =>
          c.id === target
            ? {
                ...c,
                params: typeof patch === 'function' ? (patch as (p: P) => P)(c.params) : { ...c.params, ...patch },
              }
            : c,
        ),
      }
    })
  }, [])

  // addCase 需要同步回傳新 id，因此先由目前 state 計算
  const stateRef = useRef(state)
  stateRef.current = state
  const addCase = useCallback((): CaseId | null => {
    const s = stateRef.current
    if (s.cases.length >= max) return null
    const free = CASE_IDS.find((id) => !s.cases.some((c) => c.id === id))
    if (!free) return null
    const src = s.cases.find((c) => c.id === s.activeId) ?? s.cases[0]
    const next = {
      cases: [...s.cases, makeCase(free, structuredCloneSafe(src.params))].sort(
        (a, b) => CASE_IDS.indexOf(a.id) - CASE_IDS.indexOf(b.id),
      ),
      activeId: free,
    }
    stateRef.current = next
    setState(next)
    return free
  }, [max])

  const removeCase = useCallback((id: CaseId) => {
    setState((s) => {
      if (s.cases.length <= 1) return s
      const cases = s.cases.filter((c) => c.id !== id)
      return { cases, activeId: s.activeId === id ? cases[0].id : s.activeId }
    })
  }, [])

  const reset = useCallback((params?: P) => {
    setState((s) => ({ cases: [makeCase('A', params ?? s.cases[0].params)], activeId: 'A' }))
  }, [])

  const setSeed = useCallback((v: number) => setSeedState(v >>> 0), [])

  const active = state.cases.find((c) => c.id === state.activeId) ?? state.cases[0]
  return useMemo(
    () => ({
      cases: state.cases,
      activeId: active.id,
      active,
      setActive,
      update,
      addCase,
      removeCase,
      reset,
      seed,
      setSeed,
      canAdd: state.cases.length < max,
    }),
    [state.cases, active, setActive, update, addCase, removeCase, reset, seed, setSeed, max],
  )
}

/** 複製參數；含函式等無法 structuredClone 的值時退回淺拷貝 */
function structuredCloneSafe<P>(p: P): P {
  try {
    return structuredClone(p)
  } catch {
    return p && typeof p === 'object' ? ({ ...p } as P) : p
  }
}
