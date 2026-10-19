import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCases, usePersistentState, type CaseId, type UseCasesResult } from '@/components'
import { useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  fcwGrid,
  mcSeeds,
  type FcwPoint,
  type FcwSweepOptions,
  type LabParams,
  type McChunk,
  type PipelineResult,
  type TrainingParams,
  type TrainingPatternSpec,
  type TrainingResult,
  type analyzeLab,
} from '@/simulation/models/unifiedLab'
import { EXP, labInit, labKey, tabOfExperiment, type LabInit, type SweepGrid, type TabId, type TrainingShared } from './logic'

/**
 * Lab 頁的狀態與計算引擎（Context）。
 * 為什麼放在頁面層而不是各分頁元件內：分頁只掛載目前顯示的那一個（避免隱藏的 Plotly 圖），
 * 但參數、結果與「正在 worker 裡跑的計算」要跨分頁保留——切到別的分頁再回來，結果還在、計算沒有被中斷。
 * 所有重運算都經 useWorkerTask 呼叫 src/simulation/models/unifiedLab.ts 的純函式；sweep 與 Monte Carlo 分段呼叫以顯示進度、可取消。
 */

export type LabAnalysis = ReturnType<typeof analyzeLab>
type Keyed<T> = { key: string; res: T }

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/* ---------- useCases 一次載入多組（private；建議上移到 @/components） ---------- */

/**
 * useCases 沒有「一次設定多組」的 API：先 reset 成第一組，等下一次 render（只剩 Case A）再 addCase + update。
 * handled ref 讓同一批只處理一次（React StrictMode 會把 effect 連跑兩次）。
 */
function useCaseLoader<P>(cases: UseCasesResult<P>, initialRest: P[]): { load: (list: P[]) => void; loading: boolean } {
  // initialRest：頁面一開始（URL preset）就有第 2、3 組時，第一次 render 就處於 loading，分頁不會先拿只有 Case A 的狀態去算
  const [pending, setPending] = useState<P[] | null>(() => (initialRest.length > 0 ? initialRest.slice(0, 2) : null))
  const handled = useRef<P[] | null>(null)
  useEffect(() => {
    if (!pending || handled.current === pending) return
    if (cases.cases.length !== 1) return // 等 reset 生效
    handled.current = pending
    const ids = pending.map(() => cases.addCase())
    pending.forEach((p, i) => {
      const id = ids[i]
      if (id) cases.update(() => p, id)
    })
    cases.setActive('A')
    setPending(null)
  }, [pending, cases])
  const load = useCallback(
    (list: P[]) => {
      if (list.length === 0) return
      cases.reset(list[0])
      setPending(list.length > 1 ? list.slice(1, 3) : null)
    },
    [cases],
  )
  return { load, loading: pending !== null }
}

/* ---------- Pipeline ---------- */

function usePipelineEngine() {
  const { run: runTask, cancel, running, lastDurationMs, mode } = useWorkerTask<LabParams, PipelineResult>('unifiedLab', 'runPipeline', { restartOnRun: true })
  const { run: runPreview } = useWorkerTask<LabParams, LabAnalysis>('unifiedLab', 'analyzeLab', { restartOnRun: true })
  const [result, setResult] = useState<Keyed<PipelineResult> | null>(null)
  const [error, setError] = useState<Keyed<string> | null>(null)
  const [preview, setPreview] = useState<Keyed<LabAnalysis> | null>(null)
  const [previewError, setPreviewError] = useState<Keyed<string> | null>(null)
  const [autoRun, setAutoRun] = usePersistentState<boolean>('lmspll.lab.autorun', true, (v): v is boolean => typeof v === 'boolean')
  const [frozen, setFrozen] = useState(false)
  /** 正在跑的那組參數的 key：自動重跑的 effect 看到它就不會把同一組參數再送一次 */
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  /** 使用者按「停止」時正在跑的那組參數：自動重跑不會立刻把它再啟動（要改參數或按 Run） */
  const [stoppedKey, setStoppedKey] = useState<string | null>(null)

  const pendingRef = useRef<string | null>(null)
  const settle = useCallback((key: string) => {
    if (pendingRef.current !== key) return // 已被更新的 run 取代
    pendingRef.current = null
    setPendingKey(null)
  }, [])
  const run = useCallback(
    (p: LabParams) => {
      const key = labKey(p)
      setError(null)
      setStoppedKey(null)
      pendingRef.current = key
      setPendingKey(key)
      runTask(p).then(
        (res) => {
          setResult({ key, res })
          settle(key)
        },
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setError({ key, res: errText(e) })
          settle(key)
        },
      )
    },
    [runTask, settle],
  )
  const analyze = useCallback(
    (p: LabParams) => {
      const key = labKey(p)
      runPreview(p).then(
        (res) => {
          setPreview({ key, res })
          setPreviewError(null)
        },
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setPreviewError({ key, res: errText(e) })
        },
      )
    },
    [runPreview],
  )
  const stop = useCallback(() => {
    if (pendingRef.current !== null) setStoppedKey(pendingRef.current)
    pendingRef.current = null
    setPendingKey(null)
    cancel()
  }, [cancel])
  return { run, cancel: stop, running, lastDurationMs, mode, result, error, pendingKey, stoppedKey, preview, previewError, analyze, autoRun, setAutoRun, frozen, setFrozen }
}

/* ---------- FCW sweep（分段、可取消） ---------- */

export interface SweepState {
  key: string | null
  base: LabParams | null
  opts: FcwSweepOptions
  grid: SweepGrid
  points: FcwPoint[]
  /** 定點（quantize）且開閉迴路時：同一批 FCW、同 seed 的浮點對照（quantize = false，其餘相同），與 points 一一對應；跟在每一段後面算 */
  twinPoints: FcwPoint[]
  total: number
}

function useSweepEngine(init: LabInit) {
  const { run: runTask, cancel: cancelTask, mode } = useWorkerTask<{ base: LabParams; fracs: number[]; opts: FcwSweepOptions; offset: number }, { points: FcwPoint[] }>(
    'unifiedLab',
    'sweepFcwChunk',
  )
  const [grid, setGrid] = useState<SweepGrid>(init.grid)
  const [opts, setOpts] = useState<FcwSweepOptions>(init.opts)
  const [state, setState] = useState<SweepState>({ key: null, base: null, opts: init.opts, grid: init.grid, points: [], twinPoints: [], total: 0 })
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runId = useRef(0)

  const run = useCallback(
    async (base: LabParams, g: SweepGrid, o: FcwSweepOptions) => {
      const id = ++runId.current
      const fracs = fcwGrid(g.min, g.max, g.points, g.scale)
      const key = JSON.stringify({ base, g, o })
      setError(null)
      setRunning(true)
      setState({ key, base, opts: o, grid: g, points: [], twinPoints: [], total: fracs.length })
      const chunk = o.closedLoop ? 1 : 2 // 每段的點數：小一點才有進度可看、也才取消得快
      const twin = base.quantize && o.closedLoop // 定點：每一段再用 quantize = false 跑一次同 seed 的浮點對照（Fixed-Point 欄）
      try {
        for (let i = 0; i < fracs.length; i += chunk) {
          const slice = fracs.slice(i, i + chunk)
          const r = await runTask({ base, fracs: slice, opts: o, offset: i })
          if (runId.current !== id) return
          setState((s) => (s.key === key ? { ...s, points: [...s.points, ...r.points] } : s))
          if (twin) {
            const t = await runTask({ base: { ...base, quantize: false }, fracs: slice, opts: o, offset: i })
            if (runId.current !== id) return
            setState((s) => (s.key === key ? { ...s, twinPoints: [...s.twinPoints, ...t.points] } : s))
          }
        }
      } catch (e) {
        if (runId.current === id && !isWorkerCancelled(e)) setError(errText(e))
      } finally {
        if (runId.current === id) setRunning(false)
      }
    },
    [runTask],
  )
  const cancel = useCallback(() => {
    runId.current++
    cancelTask()
    setRunning(false)
  }, [cancelTask])
  return { grid, setGrid, opts, setOpts, state, running, error, run, cancel, mode }
}

/* ---------- Monte Carlo（分段、可取消） ---------- */

export interface McState {
  key: string | null
  base: LabParams | null
  chunks: McChunk[]
  /** 定點（quantize）時：同一段 seeds 的浮點對照（quantize = false，其餘相同），與 chunks 一一對應；跟在每一段後面算 */
  twinChunks: McChunk[]
  done: number
  total: number
}

function useMcEngine(init: LabInit) {
  const { run: runTask, cancel: cancelTask, mode } = useWorkerTask<{ base: LabParams; seeds: number[]; meanField?: boolean }, McChunk>('unifiedLab', 'runMcChunk')
  const [runs, setRuns] = useState(init.runs)
  const [state, setState] = useState<McState>({ key: null, base: null, chunks: [], twinChunks: [], done: 0, total: 0 })
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runId = useRef(0)

  const run = useCallback(
    async (base: LabParams, total: number) => {
      const id = ++runId.current
      const key = JSON.stringify({ base, total })
      setError(null)
      setRunning(true)
      setState({ key, base, chunks: [], twinChunks: [], done: 0, total })
      const chunk = base.N * base.blocks > 2 ** 22 ? 1 : 2
      try {
        for (let i = 0; i < total; i += chunk) {
          const n = Math.min(chunk, total - i)
          const seeds = mcSeeds(base.seed, i, n)
          const r = await runTask({ base, seeds, meanField: i === 0 }) // 第一段順便算 mean-field 平均軌跡
          if (runId.current !== id) return
          setState((s) => (s.key === key ? { ...s, chunks: [...s.chunks, r], done: s.done + n } : s))
          if (base.quantize) {
            // 定點：同一段 seeds 再用 quantize = false 跑一次（comparator 雜訊、code、dither 都相同），Fixed-Point 欄做成對比較
            const t = await runTask({ base: { ...base, quantize: false }, seeds })
            if (runId.current !== id) return
            setState((s) => (s.key === key ? { ...s, twinChunks: [...s.twinChunks, t] } : s))
          }
        }
      } catch (e) {
        if (runId.current === id && !isWorkerCancelled(e)) setError(errText(e))
      } finally {
        if (runId.current === id) setRunning(false)
      }
    },
    [runTask],
  )
  const cancel = useCallback(() => {
    runId.current++
    cancelTask()
    setRunning(false)
  }, [cancelTask])
  return { runs, setRuns, state, running, error, run, cancel, mode }
}

/* ---------- Training Sequence ---------- */

function useTrainingEngine(init: LabInit) {
  const { run: runTask, cancel, running, lastDurationMs, mode } = useWorkerTask<TrainingParams, TrainingResult>('unifiedLab', 'analyzeTraining', { restartOnRun: true })
  const [shared, setShared] = useState<TrainingShared>(init.shared)
  const cases = useCases<TrainingPatternSpec>(init.patterns[0], { seed: init.shared.seed })
  const { load: loadCases, loading } = useCaseLoader(cases, init.patterns.slice(1))
  const [result, setResult] = useState<Keyed<TrainingResult> | null>(null)
  const [error, setError] = useState<Keyed<string> | null>(null)
  const run = useCallback(
    (tp: TrainingParams) => {
      const key = JSON.stringify(tp)
      setError(null)
      runTask(tp).then(
        (res) => setResult({ key, res }),
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setError({ key, res: errText(e) })
        },
      )
    },
    [runTask],
  )
  return { shared, setShared, cases, loadCases, loading, result, error, run, cancel, running, lastDurationMs, mode }
}

/* ---------- Compare A / B / C ---------- */

export type CompareResults = Partial<Record<CaseId, Keyed<PipelineResult> | { key: string; error: string }>>

function useCompareEngine(init: LabInit) {
  const { run: runTask, cancel: cancelTask, mode } = useWorkerTask<LabParams, PipelineResult>('unifiedLab', 'runPipeline')
  const cases = useCases<LabParams>(init.cases[0], { seed: init.cases[0].seed })
  const { load: loadCases, loading } = useCaseLoader(cases, init.cases.slice(1))
  const [results, setResults] = useState<CompareResults>({})
  const [running, setRunning] = useState<CaseId | null>(null)
  const runId = useRef(0)

  const run = useCallback(
    async (list: { id: CaseId; params: LabParams }[]) => {
      const id = ++runId.current
      try {
        for (const c of list) {
          const key = labKey(c.params)
          setRunning(c.id)
          try {
            const res = await runTask(c.params)
            if (runId.current !== id) return
            setResults((r) => ({ ...r, [c.id]: { key, res } }))
          } catch (e) {
            if (runId.current !== id || isWorkerCancelled(e)) return
            setResults((r) => ({ ...r, [c.id]: { key, error: errText(e) } }))
          }
        }
      } finally {
        if (runId.current === id) setRunning(null)
      }
    },
    [runTask],
  )
  const cancel = useCallback(() => {
    runId.current++
    cancelTask()
    setRunning(null)
  }, [cancelTask])
  return { cases, loadCases, loading, results, running, run, cancel, mode }
}

/* ---------- Context ---------- */

export interface LabStore {
  tab: TabId
  setTab: (t: TabId) => void
  /** Pipeline / FCW sweep / Monte Carlo 共用的基準參數 */
  params: LabParams
  patch: (p: Partial<LabParams>) => void
  setParams: (p: LabParams) => void
  /** 最近載入的 preset（寫進報告）與載入時被忽略的欄位 */
  presetId: string | null
  presetIssues: string[]
  /** 依實驗 ID 套用 preset 參數（ExperimentShell 的下拉選單與 URL 共用） */
  applyPreset: (experiment: string, params: unknown, id?: string) => void
  pipe: ReturnType<typeof usePipelineEngine>
  sweep: ReturnType<typeof useSweepEngine>
  mc: ReturnType<typeof useMcEngine>
  training: ReturnType<typeof useTrainingEngine>
  compare: ReturnType<typeof useCompareEngine>
}

const LabContext = createContext<LabStore | null>(null)

export function useLab(): LabStore {
  const ctx = useContext(LabContext)
  if (!ctx) throw new Error('useLab 必須在 <LabProvider> 內使用')
  return ctx
}

export function LabProvider({ children }: { children: ReactNode }) {
  // URL：?preset=<id>（Gallery 與頁內連結）。第一次 render 就把 preset 算成初始狀態（不是先用預設值、再用 effect 蓋掉），
  // 這樣自動執行的模擬一開始跑的就是 preset 的參數。
  const u1 = useUrlPreset(EXP.pipeline)
  const u2 = useUrlPreset(EXP.fcw)
  const u3 = useUrlPreset(EXP.mc)
  const u4 = useUrlPreset(EXP.training)
  const u5 = useUrlPreset(EXP.compare)
  const url = u1 ?? u2 ?? u3 ?? u4 ?? u5
  const [init] = useState<LabInit>(() => labInit(url))

  const [tab, setTab] = useState<TabId>(init.tab)
  const [params, setParamsState] = useState<LabParams>(init.params)
  const [presetId, setPresetId] = useState<string | null>(init.presetId)
  const [presetIssues, setPresetIssues] = useState<string[]>(init.issues)
  const pipe = usePipelineEngine()
  const sweep = useSweepEngine(init)
  const mc = useMcEngine(init)
  const training = useTrainingEngine(init)
  const compare = useCompareEngine(init)

  const patch = useCallback((p: Partial<LabParams>) => {
    setParamsState((cur) => ({ ...cur, ...p }))
    setPresetId(null) // 手動改過就不再是原 preset
  }, [])
  const setParams = useCallback((p: LabParams) => {
    setParamsState(p)
    setPresetId(null)
  }, [])

  const { setGrid, setOpts } = sweep
  const { setRuns } = mc
  const { setShared, loadCases: loadTraining, cases: trainingCases } = training
  const { setSeed: setTrainingSeed } = trainingCases
  const { loadCases: loadCompare, cases: compareCases } = compare
  const { setSeed: setCompareSeed } = compareCases
  const applyPreset = useCallback(
    (experiment: string, raw: unknown, id?: string) => {
      const t = tabOfExperiment(experiment)
      if (!t) return
      const s = labInit({ id, experiment, params: raw })
      if (t === 'pipeline' || t === 'fcw' || t === 'mc') setParamsState(s.params)
      if (t === 'fcw') {
        setGrid(s.grid)
        setOpts(s.opts)
      } else if (t === 'mc') {
        setRuns(s.runs)
      } else if (t === 'training') {
        setShared(s.shared)
        setTrainingSeed(s.shared.seed)
        loadTraining(s.patterns)
      } else if (t === 'compare') {
        loadCompare(s.cases)
        setCompareSeed(s.cases[0].seed)
      }
      setPresetId(s.presetId)
      setPresetIssues(s.issues)
      setTab(t)
    },
    [setGrid, setOpts, setRuns, setShared, setTrainingSeed, loadTraining, loadCompare, setCompareSeed],
  )

  // 之後 URL 換成另一個 preset（頁內連結）才重新套用；同一個 id 只套用一次。
  const applied = useRef<string | null>(init.presetId)
  useEffect(() => {
    if (!url || applied.current === url.id) return
    applied.current = url.id
    applyPreset(url.experiment, url.params, url.id)
  }, [url, applyPreset])

  const value = useMemo<LabStore>(
    () => ({ tab, setTab, params, patch, setParams, presetId, presetIssues, applyPreset, pipe, sweep, mc, training, compare }),
    [tab, params, patch, setParams, presetId, presetIssues, applyPreset, pipe, sweep, mc, training, compare],
  )
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>
}
