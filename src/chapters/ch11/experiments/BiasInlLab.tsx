import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  CaseSelector,
  Callout,
  ClaimTag,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CaseId,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { useSettings } from '@/app/settings'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  ALGORITHM_LABEL,
  CODE_KIND_LABEL,
  DC_MODE_LABEL,
  analyzeBias,
  autoMu,
  mcAgreement,
  type BiasAlgorithm,
  type BiasAnalysis,
  type BiasMcParams,
  type BiasMcResult,
  type CodeDistKind,
  type CodeSpec,
  type DcNullMode,
  type ErrorModel,
  type SigmaSweepParams,
  type SigmaSweepResult,
} from '@/simulation/models/bias'
import type { DsmKind } from '@/simulation/models/dsm'
import { chop, m, num, signed, texNum } from '../common'

export const LAB_ID = 'bias-inl-lab'

/** 所有 Case 共用的誤差模型與 code（單位 t.u.；x 無因次） */
export interface SharedParams {
  a: number
  w0: number
  b: number
  c2: number
  c3: number
  kappa: number
  codeKind: CodeDistKind
  codeShift: number
  dsmKind: DsmKind
  dsmFrac: number
  jitterSlope: number
  jitterRef: number
}

/** 每個 Case（A/B/C）自己的演算法設定 */
export interface CaseParams {
  algorithm: BiasAlgorithm
  sigmaV: number
  dcMode: DcNullMode
}

interface McSettings {
  muAuto: boolean
  mu: number
  N: number
  blocks: number
  chains: number
  servoGain: number
  /** 凍結 gain 量 GMAC 斜率時的 ±Δ（規格 §11.4 的量測流程） */
  probeDelta: number
  autoRun: boolean
}

export const DEFAULT_SHARED: SharedParams = {
  a: 1,
  w0: 1,
  b: 0,
  c2: 0,
  c3: 0.1,
  kappa: 0,
  codeKind: 'five_level',
  codeShift: 0,
  dsmKind: 'first_order',
  dsmFrac: 0.3,
  jitterSlope: 0,
  jitterRef: -2,
}
export const DEFAULT_CASE: CaseParams = { algorithm: 'sign', sigmaV: 1, dcMode: 'none' }
const DEFAULT_MC: McSettings = { muAuto: true, mu: 0.0125, N: 64, blocks: 3000, chains: 16, servoGain: 0.01, probeDelta: 0.05, autoRun: true }
const G_TARGET = 0.02
/** MC 結果快取的最大筆數（以參數 JSON 為 key；A/B/C 三個 Case 加上最近幾次設定） */
const MC_CACHE_MAX = 8
const TRACE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block k' } }, yaxis: { title: { text: 'w_k（t.u.）' } } }

export function toModel(s: SharedParams, c: CaseParams): ErrorModel {
  return { a: s.a, b: s.b, c2: s.c2, c3: s.c3, kappa: s.kappa, sigmaV: c.sigmaV, jitterSlope: s.jitterSlope, jitterRef: s.jitterRef }
}

export function toCode(s: SharedParams): CodeSpec {
  return { kind: s.codeKind, shift: s.codeShift, dsmKind: s.dsmKind, dsmFrac: s.dsmFrac }
}

const CODE_KINDS: CodeDistKind[] = ['five_level', 'pm_one', 'unipolar4', 'gaussian', 'uniform_residue', 'dsm']
const CONTINUOUS: CodeDistKind[] = ['gaussian', 'uniform_residue']

function caseLabel(c: CaseParams): string {
  const alg = c.algorithm === 'mse' ? 'MSE' : 'Sign'
  const dc = c.dcMode === 'none' ? '' : c.dcMode === 'shared_bbpd' ? '，shared BBPD' : '，linear PD'
  return `${alg}，σ_v = ${num(c.sigmaV, 4)}${dc}`
}

/** caseLabel 的頁面版（比較表用）：σ_v 以 `$…$` 行內公式顯示；Plotly 圖例不渲染 KaTeX，仍用上面的純文字版。 */
function caseLabelTex(c: CaseParams): string {
  const alg = c.algorithm === 'mse' ? 'MSE' : 'Sign'
  const dc = c.dcMode === 'none' ? '' : c.dcMode === 'shared_bbpd' ? '，shared BBPD' : '，linear PD'
  return String.raw`${alg}，$\sigma_v=${texNum(c.sigmaV, 4)}$${dc}`
}

function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)))
}

/** 從 preset 的扁平參數套用（缺的欄位用預設值） */
export function splitPresetParams(p: Record<string, unknown>): { shared: SharedParams; kase: CaseParams } {
  const pick = <T,>(k: string, d: T): T => (p[k] !== undefined ? (p[k] as T) : d)
  const shared: SharedParams = {
    a: pick('a', DEFAULT_SHARED.a),
    w0: pick('w0', DEFAULT_SHARED.w0),
    b: pick('b', DEFAULT_SHARED.b),
    c2: pick('c2', DEFAULT_SHARED.c2),
    c3: pick('c3', DEFAULT_SHARED.c3),
    kappa: pick('kappa', DEFAULT_SHARED.kappa),
    codeKind: pick('codeKind', DEFAULT_SHARED.codeKind),
    codeShift: pick('codeShift', DEFAULT_SHARED.codeShift),
    dsmKind: pick('dsmKind', DEFAULT_SHARED.dsmKind),
    dsmFrac: pick('dsmFrac', DEFAULT_SHARED.dsmFrac),
    jitterSlope: pick('jitterSlope', DEFAULT_SHARED.jitterSlope),
    jitterRef: pick('jitterRef', DEFAULT_SHARED.jitterRef),
  }
  const kase: CaseParams = {
    algorithm: pick('algorithm', DEFAULT_CASE.algorithm),
    sigmaV: pick('sigmaV', DEFAULT_CASE.sigmaV),
    dcMode: pick('dcMode', DEFAULT_CASE.dcMode),
  }
  return { shared, kase }
}

interface CaseAnalysis {
  id: string
  an: BiasAnalysis | null
  error: string | null
}

/** 每個 Case 的 Monte Carlo 設定（params 為 null 表示 μ 設不出來，無法執行） */
interface CaseMc {
  id: CaseId
  mu: number
  g: number
  params: BiasMcParams | null
  key: string
}

function isDeadZone(an: BiasAnalysis | null): an is BiasAnalysis & { zeroSet: { lo: number; hi: number } } {
  return !!an?.zeroSet && an.zeroSet.hi - an.zeroSet.lo > 1e-9
}

export function BiasInlLab() {
  const tokens = useThemeTokens()
  const { atLeast } = useSettings()
  const [shared, setShared] = useState<SharedParams>(DEFAULT_SHARED)
  const [mc, setMc] = useState<McSettings>(DEFAULT_MC)
  const cases = useCases<CaseParams>(DEFAULT_CASE, { seed: 20261012 })
  const activeCase = cases.active
  const set = <K extends keyof SharedParams>(k: K) => (v: SharedParams[K]) => setShared((s) => ({ ...s, [k]: v }))
  const setM = <K extends keyof McSettings>(k: K) => (v: McSettings[K]) => setMc((s) => ({ ...s, [k]: v }))

  // ── 即時分析（mean-field 與一階公式；主執行緒，useDeferredValue 避免拖動卡頓）──
  const dShared = useDeferredValue(shared)
  const dCases = useDeferredValue(cases.cases)
  const dServo = useDeferredValue(mc.servoGain)
  const analyses: CaseAnalysis[] = useMemo(
    () =>
      dCases.map((c) => {
        try {
          const continuous = CONTINUOUS.includes(dShared.codeKind)
          const curvePoints = continuous && c.params.dcMode === 'shared_bbpd' ? 61 : c.params.sigmaV === 0 && c.params.algorithm === 'sign' ? 241 : 121
          const an = analyzeBias({
            model: toModel(dShared, c.params),
            code: toCode(dShared),
            algorithm: c.params.algorithm,
            dcMode: c.params.dcMode,
            w0: dShared.w0,
            curvePoints,
            servoGain: dServo,
          })
          return { id: c.id, an, error: null }
        } catch (e) {
          return { id: c.id, an: null, error: (e as Error).message }
        }
      }),
    [dShared, dCases, dServo],
  )
  const act = analyses.find((a) => a.id === cases.activeId) ?? analyses[0]
  const an = act?.an ?? null
  const isSign = activeCase.params.algorithm === 'sign'

  // ── μ（自動：g = μS = 0.02）與每個 Case 的 Monte Carlo 參數（同一個 seed ⇒ paired simulation）──
  const caseMc: CaseMc[] = useMemo(
    () =>
      cases.cases.map((c) => {
        const a = analyses.find((x) => x.id === c.id)?.an ?? null
        const slope = a?.slope ?? Number.NaN
        const mu = mc.muAuto ? autoMu(slope, G_TARGET) : mc.mu
        const g = mu * slope
        if (!a || !(mu > 0) || !Number.isFinite(mu)) return { id: c.id, mu, g, params: null, key: '' }
        const cw = a.curve.w
        const lo = cw[0]
        const hi = cw[cw.length - 1]
        const params: BiasMcParams = {
          model: toModel(shared, c.params),
          code: toCode(shared),
          algorithm: c.params.algorithm,
          dcMode: c.params.dcMode,
          mu,
          N: mc.N,
          blocks: mc.blocks,
          chains: mc.chains,
          servoGain: mc.servoGain,
          w0: shared.w0,
          seed: cases.seed,
          traceChains: 3,
          gmacPoints: Array.from({ length: 9 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 9),
          gmacSamples: 20000,
          slopeProbe: Number.isFinite(a.wStar) && !isDeadZone(a) ? { center: a.wStar, delta: mc.probeDelta } : undefined,
        }
        return { id: c.id, mu, g, params, key: JSON.stringify(params) }
      }),
    [analyses, cases.cases, shared, mc.muAuto, mc.mu, mc.N, mc.blocks, mc.chains, mc.servoGain, mc.probeDelta, cases.seed],
  )
  const activeMc = caseMc.find((c) => c.id === cases.activeId) ?? caseMc[0]
  const muUsed = activeMc?.mu ?? Number.NaN
  const gUsed = activeMc?.g ?? Number.NaN
  const mcKey = activeMc?.key ?? ''

  // ── Monte Carlo（worker）：結果以參數 key 快取，切換 Case 不必重跑；A/B/C 可並列比較 ──
  const [mcCache, setMcCache] = useState<Record<string, BiasMcResult>>({})
  const [mcErr, setMcErr] = useState<string | null>(null)
  const { run: runMcTask, cancel: cancelMc, running: mcRunning, mode: mcMode } = useWorkerTask<BiasMcParams, BiasMcResult>('bias', 'simulateBiasLms', {
    restartOnRun: true,
  })
  const mcCacheRef = useRef(mcCache)
  useEffect(() => {
    mcCacheRef.current = mcCache
  })
  /** 依序執行（worker 一次跑一個）；被新的執行取消時整串停止。force = 即使已有快取也重跑第一個。 */
  const runQueue = useCallback(
    async (list: CaseMc[], opts: { force?: boolean; untilSettled?: boolean } = {}) => {
      setMcErr(null)
      let first = true
      for (const item of list) {
        if (!item.params) continue
        if (!(first && opts.force) && mcCacheRef.current[item.key]) {
          first = false
          continue
        }
        first = false
        try {
          const res = await runMcTask(opts.untilSettled ? { ...item.params, untilSettled: true, loopGain: item.g } : item.params)
          setMcCache((prev) => {
            // 最近寫入的排最後；超過上限時丟掉最舊的
            const entries = Object.entries(prev).filter(([k]) => k !== item.key)
            entries.push([item.key, res])
            return Object.fromEntries(entries.slice(-MC_CACHE_MAX))
          })
        } catch (e) {
          if (!isWorkerCancelled(e)) setMcErr((e as Error).message)
          return
        }
      }
    },
    [runMcTask],
  )
  /** 目前 Case 排最前面，其餘 Case 接著跑 */
  const orderedCases = useCallback(() => [...caseMc].sort((p, q) => Number(q.id === cases.activeId) - Number(p.id === cases.activeId)), [caseMc, cases.activeId])
  const runMc = useCallback(() => void runQueue(orderedCases(), { force: true }), [runQueue, orderedCases])
  const runToConvergence = useCallback(() => void runQueue(orderedCases().slice(0, 1), { force: true, untilSettled: true }), [runQueue, orderedCases])
  const autoRunRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    autoRunRef.current = () => void runQueue(orderedCases())
  })
  const allMcKey = caseMc.map((c) => c.key).join('|')
  const debouncedMcKey = useDebouncedValue(allMcKey, 900)
  const autoRun = mc.autoRun && mcMode === 'worker'
  useEffect(() => {
    if (autoRun && debouncedMcKey.replace(/\|/g, '')) autoRunRef.current()
  }, [debouncedMcKey, autoRun])
  const mcValid = mcKey ? (mcCache[mcKey] ?? null) : null
  const agreement = useMemo(() => (mcValid && an && Number.isFinite(an.wStar) ? mcAgreement(mcValid, an.zeroSet) : null), [mcValid, an])

  // ── w*(σ_v) sweep（worker；與 σ_v、演算法無關）──
  const sweepParams: SigmaSweepParams = useMemo(
    () => ({ model: toModel(shared, { ...activeCase.params, sigmaV: 1 }), code: toCode(shared), dcMode: activeCase.params.dcMode, sigmas: logspace(0.01, 10, 37) }),
    [shared, activeCase.params],
  )
  const sweepKey = useDebouncedValue(JSON.stringify(sweepParams), 400)
  const [sweep, setSweep] = useState<{ key: string; res: SigmaSweepResult } | null>(null)
  const { run: runSweep } = useWorkerTask<SigmaSweepParams, SigmaSweepResult>('bias', 'biasSigmaSweep', { restartOnRun: true })
  useEffect(() => {
    const p = JSON.parse(sweepKey) as SigmaSweepParams
    runSweep(p).then(
      (res) => setSweep({ key: sweepKey, res }),
      () => undefined,
    )
  }, [sweepKey, runSweep])

  // ── Presets（Gallery #7 等）與 ?preset= ──
  const presetList = useMemo(() => presetsForExperiment(LAB_ID), [])
  const resetCases = cases.reset
  const applyPreset = useCallback(
    (params: Record<string, unknown>) => {
      const { shared: s, kase } = splitPresetParams(params)
      setShared(s)
      resetCases(kase)
    },
    [resetCases],
  )
  const urlPreset = useUrlPreset(LAB_ID)
  useEffect(() => {
    if (urlPreset) applyPreset(urlPreset.params)
  }, [urlPreset, applyPreset])

  // ── 圖：平均 GMAC vs w ──
  const gmacData: Data[] = useMemo(() => {
    const out: Data[] = []
    analyses.forEach((a) => {
      const c = cases.cases.find((cc) => cc.id === a.id)
      if (!a.an || !c) return
      const stepLike = c.params.algorithm === 'sign' && c.params.sigmaV === 0 && !a.an.continuous
      out.push({
        x: a.an.curve.w,
        y: a.an.curve.G,
        name: `Case ${c.id}：E[G](w)，${caseLabel(c.params)}`,
        mode: 'lines',
        line: { color: tokens.series[c.seriesIndex], width: 2, shape: stepLike ? 'hv' : 'linear' },
      })
    })
    const zeros = analyses.flatMap((a) => {
      const c = cases.cases.find((cc) => cc.id === a.id)
      return a.an && c && Number.isFinite(a.an.wStar) && !isDeadZone(a.an) ? [{ w: a.an.wStar, c }] : []
    })
    if (zeros.length)
      out.push({
        x: zeros.map((z) => z.w),
        y: zeros.map(() => 0),
        mode: 'markers',
        name: '零交越 w*（固定點）',
        marker: { color: zeros.map((z) => tokens.series[z.c.seriesIndex]), symbol: 'x', size: 11, line: { width: 2 } },
      })
    // dead zone：G = 0 的整段區間（解不唯一）畫成粗線段
    analyses.forEach((a) => {
      const c = cases.cases.find((cc) => cc.id === a.id)
      if (!c || !isDeadZone(a.an)) return
      out.push({
        x: [a.an.zeroSet.lo, a.an.zeroSet.hi],
        y: [0, 0],
        mode: 'lines+markers',
        name: `Case ${c.id}：dead zone（G = 0 的區間）`,
        line: { color: tokens.series[c.seriesIndex], width: 6 },
        marker: { color: tokens.series[c.seriesIndex], symbol: 'line-ns-open', size: 12 },
      })
    })
    // 每個已跑過 MC 的 Case：時間平均 w̄（水平誤差棒 = 95% CI）
    caseMc.forEach((cm) => {
      const c = cases.cases.find((cc) => cc.id === cm.id)
      const r = cm.key ? mcCache[cm.key] : undefined
      if (!c || !r) return
      out.push({
        x: [r.mean],
        y: [0],
        error_x: { type: 'data', array: [r.halfWidth], visible: true },
        mode: 'markers',
        name: `Case ${c.id}：MC w̄（95% CI）`,
        marker: { color: tokens.series[c.seriesIndex], symbol: 'diamond-open', size: 11, line: { width: 2 } },
      })
    })
    if (an && isSign && activeCase.params.sigmaV > 0)
      out.push({
        x: an.curve.w,
        y: an.curve.Glin,
        name: `Case ${cases.activeId}：一階線性化（K_q）`,
        mode: 'lines',
        line: { color: tokens.textMuted, dash: 'dash', width: 1.5 },
      })
    if (mcValid && mcValid.gmac.w.length)
      out.push({
        x: mcValid.gmac.w,
        y: mcValid.gmac.mean,
        error_y: { type: 'data', array: mcValid.gmac.halfWidth, visible: true },
        name: `Case ${cases.activeId}：MC 凍結 w 的平均 G（95% CI）`,
        mode: 'markers',
        marker: { color: tokens.series[activeCase.seriesIndex], symbol: 'circle-open', size: 9 },
      })
    return out
  }, [analyses, cases.cases, cases.activeId, an, isSign, activeCase, mcValid, caseMc, mcCache, tokens])

  const gmacLayout: Partial<Layout> = useMemo(() => {
    const shapes: Partial<Layout>['shapes'] = []
    analyses.forEach((a) => {
      const c = cases.cases.find((cc) => cc.id === a.id)
      if (!a.an || !c || !Number.isFinite(a.an.wStar) || isDeadZone(a.an)) return
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.an.wStar, x1: a.an.wStar, y0: 0, y1: 1, line: { color: tokens.series[c.seriesIndex], dash: 'dot', width: 1.5 } })
    })
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: shared.a, x1: shared.a, y0: 0, y1: 1, line: { color: tokens.textMuted, dash: 'longdash', width: 1 } })
    return {
      xaxis: { title: { text: 'w（t.u.）' } },
      yaxis: { title: { text: 'E[G]（平均 GMAC）' }, zeroline: true },
      shapes,
    }
  }, [analyses, cases.cases, shared.a, tokens])

  // ── 圖：殘差 vs code ──
  const residualData: Data[] = useMemo(() => {
    if (!an) return []
    const rc = an.residualCurve
    if (!an.continuous && rc.x.length <= 64) {
      return [
        { x: rc.x, y: rc.eAtA, type: 'bar', name: 'w = a（真實線性 gain）', marker: { color: tokens.textMuted } },
        { x: rc.x, y: rc.eStar, type: 'bar', name: `w = w*（${num(an.wStar)}）`, marker: { color: tokens.series[activeCase.seriesIndex] } },
      ]
    }
    const mode = an.continuous ? 'lines' : 'markers'
    return [
      { x: rc.x, y: rc.eAtA, mode, name: 'w = a', line: { color: tokens.textMuted, dash: 'dash' }, marker: { color: tokens.textMuted, size: 4 } },
      { x: rc.x, y: rc.eStar, mode, name: `w = w*（${num(an.wStar)}）`, line: { color: tokens.series[activeCase.seriesIndex] }, marker: { color: tokens.series[activeCase.seriesIndex], size: 4 } },
      { x: rc.x, y: rc.density, mode: 'lines', name: an.continuous ? 'code pdf（右軸）' : 'code 機率（右軸）', yaxis: 'y2', line: { color: tokens.series[4] ?? tokens.textMuted, width: 1 } },
    ]
  }, [an, activeCase.seriesIndex, tokens])

  const residualLayout: Partial<Layout> = useMemo(
    () => ({
      barmode: 'group',
      xaxis: { title: { text: 'code x' } },
      yaxis: { title: { text: '確定性殘差 e_det + φ（t.u.）' }, zeroline: true },
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: { text: '機率密度' }, rangemode: 'tozero' },
    }),
    [],
  )

  // ── 圖：w*(σ_v) ──
  const sweepValid = sweep?.res ?? null // 重算期間沿用上一次結果
  const sweepData: Data[] = useMemo(() => {
    if (!sweepValid) return []
    const s = sweepValid
    const xs = [s.sigma[0], s.sigma[s.sigma.length - 1]]
    const out: Data[] = [
      { x: s.sigma, y: s.wSign, mode: 'lines', name: 'Sign-LMS mean-field w*(σ_v)', line: { color: tokens.series[0], width: 2 } },
      { x: xs, y: [s.wMse, s.wMse], mode: 'lines', name: `MSE-LMS（${num(s.wMse)}）`, line: { color: tokens.series[1], dash: 'dash' } },
    ]
    if (Number.isFinite(s.wNoiseFree))
      out.push({ x: xs, y: [s.wNoiseFree, s.wNoiseFree], mode: 'lines', name: `σ_v = 0 的 Sign（${num(s.wNoiseFree)}）`, line: { color: tokens.series[2], dash: 'dot' } })
    if (s.wSecond.some(Number.isFinite)) {
      const lo = Math.min(s.wMse, s.wNoiseFree, ...s.wSign.filter(Number.isFinite))
      const hi = Math.max(s.wMse, s.wNoiseFree, ...s.wSign.filter(Number.isFinite))
      const pad = 0.5 * (hi - lo + 1e-3)
      out.push({
        x: s.sigma,
        y: s.wSecond.map((v) => (v > hi + pad || v < lo - pad ? null : v)),
        mode: 'lines',
        name: '二階近似 w₁ − E[xe₀³]/(6σ_v²E[x²])',
        line: { color: tokens.series[3], dash: 'dashdot' },
        connectgaps: false,
      } as Data)
    }
    if (mcValid && isSign && activeCase.params.sigmaV > 0)
      out.push({
        x: [activeCase.params.sigmaV],
        y: [mcValid.mean],
        error_y: { type: 'data', array: [mcValid.halfWidth], visible: true },
        mode: 'markers',
        name: 'MC（目前 σ_v，95% CI）',
        marker: { color: tokens.series[activeCase.seriesIndex], size: 9, symbol: 'diamond' },
      })
    return out
  }, [sweepValid, mcValid, isSign, activeCase, tokens])

  const sweepLayout: Partial<Layout> = useMemo(
    () => ({
      xaxis: { title: { text: 'σ_v（t.u.，log）' } },
      yaxis: { title: { text: 'w*（t.u.）' } },
      shapes:
        activeCase.params.sigmaV > 0
          ? [{ type: 'line', xref: 'x', yref: 'paper', x0: activeCase.params.sigmaV, x1: activeCase.params.sigmaV, y0: 0, y1: 1, line: { color: tokens.textMuted, dash: 'dot', width: 1 } }]
          : [],
    }),
    [activeCase.params.sigmaV, tokens],
  )

  // ── 圖：MC 軌跡 ──
  const traceData: Data[] = useMemo(() => {
    if (!mcValid) return []
    const out: Data[] = mcValid.traces.w.map((w, i) => ({
      x: mcValid.traces.k,
      y: w,
      mode: 'lines',
      name: `chain ${i}`,
      line: { width: 1, color: tokens.series[(activeCase.seriesIndex + i) % tokens.series.length] },
    }))
    const k = mcValid.traces.k
    const kx = [k[0], k[k.length - 1]]
    if (isDeadZone(an)) {
      out.push({ x: kx, y: [an.zeroSet.lo, an.zeroSet.lo], mode: 'lines', name: `dead zone 下緣（${num(an.zeroSet.lo)}）`, line: { color: tokens.text, dash: 'dash', width: 1.5 } })
      out.push({ x: kx, y: [an.zeroSet.hi, an.zeroSet.hi], mode: 'lines', name: `dead zone 上緣（${num(an.zeroSet.hi)}）`, line: { color: tokens.text, dash: 'dash', width: 1.5 } })
    } else if (an && Number.isFinite(an.wStar)) {
      out.push({ x: kx, y: [an.wStar, an.wStar], mode: 'lines', name: `mean-field w*（${num(an.wStar)}）`, line: { color: tokens.text, dash: 'dash', width: 1.5 } })
      const ws = mcValid.reference.wServoAware
      if (Number.isFinite(ws) && Math.abs(ws - an.wStar) > 1e-6)
        out.push({ x: kx, y: [ws, ws], mode: 'lines', name: `servo-aware w*（${num(ws)}）`, line: { color: tokens.textMuted, dash: 'dot', width: 1.5 } })
    }
    return out
  }, [mcValid, an, activeCase.seriesIndex, tokens])

  // ── 指標、警告、交叉比對 ──
  const metrics: MetricRow[] = []
  const warnings: string[] = []
  const dcOn = activeCase.params.dcMode !== 'none'
  const deadZone = isDeadZone(an)
  if (act?.error) warnings.push(`參數錯誤：${act.error}`)
  if (an) {
    const algTag = isSign ? 'Sign-LMS mean-field' : 'MSE-LMS 封閉解'
    if (deadZone)
      metrics.push({
        name: '$w^*$（無雜訊 Sign-LMS：dead zone）',
        value: `(${num(an.zeroSet.lo)}, ${num(an.zeroSet.hi)})`,
        unit: 't.u.',
        claim: 'exact',
        formulaId: 'F-11.10',
        note: String.raw`$E[G]=0$ 於整段區間：解不唯一，$w$ 停在哪裡取決於初值與 $\mu$`,
      })
    else
      metrics.push({
        name: `$w^*$（${algTag}）`,
        value: an.wStar,
        unit: 't.u.',
        claim: 'exact',
        formulaId: isSign ? 'F-11.2' : 'F-11.4',
        note: isSign ? String.raw`$E[x\operatorname{erf}(e/(\sqrt2\sigma_v))]=0$ 的根（指定模型的精確 mean-field）` : String.raw`$E[x\,e]=0$（一次方程）`,
      })
    if (isSign && activeCase.params.sigmaV > 0)
      metrics.push({ name: '$w^*$ 一階線性化（$K_q$）', value: an.wLinear, unit: 't.u.', claim: 'approx', formulaId: shared.jitterSlope > 0 ? 'F-11.12' : activeCase.params.dcMode === 'none' ? 'F-11.4' : activeCase.params.dcMode === 'shared_bbpd' ? 'F-11.6' : 'F-11.7', analytic: an.wStar, tolerance: 1e-3, note: '與 mean-field 的差 = 線性化誤差' })
    if (Number.isFinite(an.wSecondOrder)) metrics.push({ name: '$w^*$ 二階近似', value: an.wSecondOrder, unit: 't.u.', claim: 'approx', formulaId: 'F-11.9', analytic: an.wStar, tolerance: 1e-4 })
    metrics.push({ name: '$w^*$（MSE-LMS，同 DC 模式）', value: an.wMse, unit: 't.u.', claim: 'exact', formulaId: 'F-11.4' })
    if (an.zeroSet && !deadZone) metrics.push({ name: '無雜訊 Sign：$|x|$ 加權中位數', value: an.zeroSet.lo, unit: 't.u.', claim: 'exact', formulaId: 'F-11.10' })
    if (!deadZone) metrics.push({ name: 'gain bias $w^*-a$', value: an.wStar - shared.a, unit: 't.u.' })
    if (mcValid && agreement) {
      const ref = mcValid.reference
      const tolNote = String.raw`容許 = $4\,\mathrm{SE}$（${num(agreement.parts.stat, 2)}）+ 有限步長（${num(agreement.parts.step, 2)}）${agreement.parts.servo > 0 ? ` + servo 修正的 25%（${num(agreement.parts.servo, 2)}）` : ''}`
      if (agreement.kind === 'dead-zone')
        metrics.push({ name: String.raw`MC 時間平均 $\bar w$（chains 平均）`, value: mcValid.mean, unit: 't.u.', note: `95% CI [${num(mcValid.lo)}, ${num(mcValid.hi)}]；${agreement.pass ? '落在 dead zone 內（每條 chain 停的位置不同）' : `在 dead zone 外 ${num(agreement.delta, 2)}`}；${tolNote}` })
      else
        metrics.push({
          name: String.raw`MC 時間平均 $\bar w$（chains 平均）`,
          value: mcValid.mean,
          unit: 't.u.',
          analytic: agreement.reference,
          tolerance: agreement.tolerance,
          note: `95% CI [${num(mcValid.lo)}, ${num(mcValid.hi)}]；${tolNote}${dcOn && isSign ? '；參考值 = servo-aware $w^*$' : ''}`,
        })
      if (dcOn && isSign) {
        metrics.push({ name: String.raw`servo 的 $\varphi$ 抖動 std（MC，chain 0）`, value: mcValid.phiStd, unit: 't.u.', note: String.raw`$\varphi$ 不是常數：它的抖動對 comparator 而言是額外的 dither` })
        metrics.push({
          name: String.raw`$w^*$（servo-aware：$\sigma_\mathrm{eff}^2=\sigma_v^2+\operatorname{Var}(\varphi)$）`,
          value: ref.wServoAware,
          unit: 't.u.',
          claim: 'approx',
          analytic: an.wStar,
          note: String.raw`$\sigma_\mathrm{eff}=${texNum(Math.hypot(activeCase.params.sigmaV, mcValid.phiStd), 4)}$；與理想 DC null 的差 = servo 抖動造成的偏移（降低 $k_\varphi$ 可縮小）`,
        })
      }
      if (isSign && Number.isFinite(ref.step.bias))
        metrics.push({
          name: String.raw`有限步長偏移估計 $G''(w^*)\operatorname{Var}(w)/(2S)$`,
          value: ref.step.bias,
          unit: 't.u.',
          claim: 'approx',
          note: String.raw`$w$ 的穩態 std $\approx${texNum(ref.step.sdW, 3)}$；erf 的曲率把抖動「整流」成偏移`,
        })
      else if (isSign)
        metrics.push({
          name: String.raw`limit cycle 容許量 $\mu\,E|x|$ + 不對稱項`,
          value: ref.step.allowance,
          unit: 't.u.',
          claim: 'approx',
          note: String.raw`$\sigma_v=0$：$G(w)$ 是階梯，$w$ 在 $w^*$ 附近以 $O(\mu)$ 來回跳動`,
        })
    }
    metrics.push({ name: '$E[x]$', value: chop(an.moments.Ex, an.moments.Ex2) }, { name: '$E[x^2]$', value: an.moments.Ex2 }, { name: String.raw`$\operatorname{Var}(x)$`, value: an.moments.varX })
    if (isSign)
      metrics.push({ name: String.raw`$\max|e_\mathrm{det}+\varphi|/\sigma_v$（$w^*$ 處）`, value: an.validityRatio, note: String.raw`$\lesssim0.3$ 時一階線性化可信（勘誤 E01）`, formulaId: 'F-11.3' })
    metrics.push({
      name: String.raw`GMAC 斜率 $S=-dE[G]/dw$（$=K$，勘誤 E13）`,
      value: an.slope,
      unit: isSign ? 't.u.⁻¹' : '—',
      formulaId: 'F-11.15',
      note: deadZone
        ? String.raw`跨過整段 dead zone 的割線斜率（只用來設定 $\mu$）`
        : isSign && activeCase.params.sigmaV === 0
          ? String.raw`割線斜率（$\sigma_v=0$ 時 $G$ 為階梯）`
          : String.raw`規格 §11.4 的 $S_\mathrm{GMAC}=\partial E[G]/\partial w=-S$`,
    })
    const probe = mcValid?.slopeProbe
    if (probe)
      metrics.push({
        name: String.raw`$\hat S$（MC：凍結 gain、$w^*\pm${texNum(probe.delta, 3)}$ 的中央差分）`,
        value: probe.slope,
        unit: isSign ? 't.u.⁻¹' : '—',
        formulaId: 'F-11.15',
        analytic: probe.meanFieldSecant,
        tolerance: 4 * probe.se,
        note: String.raw`$G_-=${texNum(probe.gMinus, 4)}$、$G_+=${texNum(probe.gPlus, 4)}$；$\hat S_\mathrm{GMAC}=-\hat S=${texNum(-probe.slope, 4)}\pm${texNum(1.96 * probe.se, 2)}$（95%）；解析值 = 同一個 $\Delta$ 的 mean-field 割線斜率，切線斜率為 $${texNum(probe.meanFieldTangent, 4)}$（$\Delta$ 越大，erf 的非線性讓割線越小）`,
      })
    metrics.push({ name: String.raw`$\mu$（使用中）`, value: muUsed, unit: isSign ? 't.u.' : '—', note: mc.muAuto ? String.raw`自動：$g=\mu S=${G_TARGET}$` : '手動' })
    metrics.push({ name: String.raw`平均 pole $p=1-\mu S$`, value: 1 - gUsed })
    for (const c of an.costs) {
      const lbl = c.at === 'w0' ? '校正前（$w=w_0$）' : c.at === 'a' ? '$w=a$' : '校正後（$w=w^*$）'
      metrics.push({ name: String.raw`$E[e_\mathrm{det}^2]$ ${lbl}`, value: c.mse, unit: 't.u.²', note: String.raw`$E|e_\mathrm{det}|=${texNum(c.mae)}$；含雜訊總功率 $${texNum(c.total)}$` })
    }
    if (dcOn) metrics.push({ name: String.raw`$\varphi^*$（主迴路加的 DC 偏移）`, value: an.phiStar, unit: 't.u.' })
    if (mcValid && dcOn) {
      metrics.push({ name: String.raw`MC 量到的 $\varphi$ 平均（chain 0）`, value: mcValid.phiMean, unit: 't.u.', analytic: an.phiStar, note: String.raw`chain 0 的 $\bar w$ 與 $w^*$ 略有不同，$\bar\varphi$ 也會跟著偏一點` })
      metrics.push({
        name: isSign ? 'MC 量到的 $E[q]$（comparator）' : 'MC 量到的 $E[e]$',
        value: mcValid.qMean,
        note: activeCase.params.dcMode === 'shared_bbpd' ? String.raw`shared BBPD：應 $\approx0$` : String.raw`linear PD：$E[e_\mathrm{PD}]\approx0$，但 comparator 的 $E[q]$ 不必為 0`,
      })
    }
    warnings.push(...an.warnings)
  }
  if (!(muUsed > 0) || !Number.isFinite(muUsed)) warnings.push(String.raw`無法設定 $\mu$：GMAC 斜率 $S\le0$ 或不可辨識，Monte Carlo 不會收斂到固定點（請先解決上面的不可辨識／極性問題，或改用手動 $\mu$）。`)
  else if (gUsed >= 2) warnings.push(String.raw`$g=\mu S=${texNum(gUsed)}\ge2$：平均動態 $\delta w_{k+1}=(1-g)\,\delta w_k$（$\delta w=w-w^*$）發散（一階模型不穩定）。`)
  else if (gUsed * (mcValid?.blocksUsed ?? mc.blocks) * 0.5 < 10)
    warnings.push(
      String.raw`$g\cdot\text{blocks}/2=${texNum(gUsed * (mcValid?.blocksUsed ?? mc.blocks) * 0.5)}<10$：時間常數約 $1/g=${texNum(1 / gUsed)}$ blocks，burn-in 內尚未收斂，MC 平均會偏向 $w_0$。可按「執行至收斂 Run-to-Convergence」自動加長。`,
    )
  if (mcValid) warnings.push(...mcValid.warnings)
  if (mcValid && agreement && !agreement.pass && mcValid.driftCheck.settled && !mcValid.diverged)
    warnings.push(
      dcOn
        ? String.raw`Monte Carlo（${num(mcValid.mean)}）與 servo-aware 固定點（${num(agreement.reference)}）相差 ${num(agreement.delta, 3)}，超過容許量 ${num(agreement.tolerance, 2)}：主迴路 servo 與 LMS／code pattern 的時間尺度沒有分開（$k_\varphi$ 太大或 code 變化太慢），mean-field 的「理想 DC null」假設不成立。請降低 $k_\varphi$、加長 $N$，或以 MC 為準。`
        : String.raw`Monte Carlo（${num(mcValid.mean)}）與 mean-field 固定點（${num(agreement.reference)}）相差 ${num(agreement.delta, 3)}，超過容許量 ${num(agreement.tolerance, 2)}：請檢查 $\mu$ 是否太大（$g=${texNum(gUsed, 3)}$）、$N$ 是否太小，或增加 chains／blocks 再比一次。`,
    )
  if (mcValid?.slopeProbe && mcValid.slopeProbe.slope + 4 * mcValid.slopeProbe.se <= 0)
    warnings.push(String.raw`凍結 gain 量到的斜率 $\hat S=${texNum(mcValid.slopeProbe.slope, 3)}\le0$（$\hat S_\mathrm{GMAC}\ge0$）：更新極性錯誤，正 learning rate 會使平均誤差發散（見 Ch06）。`)
  if (mcErr) warnings.push(`Monte Carlo 失敗：${mcErr}`)

  let mcCheck: CheckEntry = { status: 'n/a', note: mcRunning ? '執行中…' : mcValid ? '沒有可比對的固定點（不可辨識或沒有吸引的固定點）' : '尚未執行（按「執行 Run」）' }
  if (mcValid && agreement) {
    const what = agreement.kind === 'dead-zone' ? `dead zone (${num(an?.zeroSet?.lo ?? Number.NaN)}, ${num(an?.zeroSet?.hi ?? Number.NaN)})` : dcOn && isSign ? `servo-aware $w^*$ ${num(agreement.reference)}` : `$w^*$ ${num(agreement.reference)}`
    mcCheck = {
      status: agreement.pass ? 'ok' : 'mismatch',
      note: String.raw`MC ${num(mcValid.mean)} $\pm$ ${num(mcValid.halfWidth, 3)} vs ${what}：$\Delta=${texNum(agreement.delta, 3)}$，容許 ${num(agreement.tolerance, 2)}（$4\,\mathrm{SE}$ + 有限步長${agreement.parts.servo > 0 ? ' + servo' : ''}）`,
    }
  }
  const analyticCheck: CheckEntry =
    an && Number.isFinite(an.wStar)
      ? { status: 'ok', note: deadZone ? `dead zone (${num(an.zeroSet.lo)}, ${num(an.zeroSet.hi)})：$|x|$ 加權中位數區間與 mean-field $G(w)=0$ 一致` : isSign ? `mean-field root ${num(an.wStar)}（一階 ${num(an.wLinear)}）` : `封閉解 ${num(an.wStar)}` }
      : { status: 'n/a', note: an?.status === 'unidentifiable' ? '不可辨識：沒有唯一固定點' : '沒有吸引的固定點' }

  // ── Case A/B/C 並列比較（mean-field vs Monte Carlo；同一個 seed）──
  const compareRows = cases.cases.map((c) => {
    const a = analyses.find((x) => x.id === c.id)?.an ?? null
    const cm = caseMc.find((x) => x.id === c.id)
    const r = cm?.key ? (mcCache[cm.key] ?? null) : null
    const ag = r && a && Number.isFinite(a.wStar) ? mcAgreement(r, a.zeroSet) : null
    return { c, a, r, ag }
  })

  const resetAll = () => {
    setShared(DEFAULT_SHARED)
    setMc(DEFAULT_MC)
    resetCases(DEFAULT_CASE)
    setMcCache({})
    setMcErr(null)
  }

  const exportData = () => {
    const cols: Record<string, ArrayLike<number | string | null>> = {}
    analyses.forEach((a) => {
      if (!a.an) return
      cols[`case${a.id}_w`] = a.an.curve.w
      cols[`case${a.id}_EG`] = a.an.curve.G
    })
    if (an) {
      cols.active_EG_linear = an.curve.Glin
      cols.residual_x = an.residualCurve.x
      cols.residual_e_wstar = an.residualCurve.eStar
      cols.residual_e_a = an.residualCurve.eAtA
    }
    if (sweepValid) {
      cols.sweep_sigma = sweepValid.sigma
      cols.sweep_wsign = sweepValid.wSign
      cols.sweep_wsecond = sweepValid.wSecond
    }
    cols.compare_case = compareRows.map((r) => r.c.id)
    cols.compare_wstar = compareRows.map((r) => r.a?.wStar ?? null)
    cols.compare_mc_reference = compareRows.map((r) => r.ag?.reference ?? null)
    cols.compare_mc_mean = compareRows.map((r) => r.r?.mean ?? null)
    cols.compare_mc_ci_half = compareRows.map((r) => r.r?.halfWidth ?? null)
    cols.compare_mc_tolerance = compareRows.map((r) => r.ag?.tolerance ?? null)
    if (mcValid) {
      cols.mc_chain_means = mcValid.chainMeans
      cols.mc_gmac_w = mcValid.gmac.w
      cols.mc_gmac_mean = mcValid.gmac.mean
      cols.mc_gmac_ci = mcValid.gmac.halfWidth
      cols.mc_trace_k = mcValid.traces.k
      mcValid.traces.w.forEach((w, i) => (cols[`mc_trace_chain${i}`] = w))
    }
    return cols
  }

  const continuous = CONTINUOUS.includes(shared.codeKind)
  const residualTable = an?.residual

  return (
    <ExperimentShell
      id={LAB_ID}
      title="Bias & INL Lab：GMAC 固定點 vs 真實 DTC 誤差"
      level={activeCase.params.dcMode === 'none' ? 'L1' : 'L2'}
      claim={isSign ? 'approx' : 'exact'}
      source="simulation"
      tests={['T12']}
      description={
        <>
          同一個誤差模型 <Tex>{String.raw`e=(a-w)x+b+c_2x^2+c_3x^3+\kappa x+v`}</Tex>，比較 MSE-LMS（GMAC 用 <Tex>{'e'}</Tex>）與 Sign-LMS（GMAC 用{' '}
          <Tex>{String.raw`q=\operatorname{sign}(e)`}</Tex>）的固定點，並以 block-LMS Monte Carlo（worker、多 seeds）驗證。Case A/B/C 共用誤差模型與 code，只改演算法、
          <Tex>{String.raw`\sigma_v`}</Tex> 與主迴路 DC null 模式。
        </>
      }
      assumptions={[
        '$x$ 與 $v$ 獨立；iid code（DSM 為確定性序列，MC 依時間順序循環、每條 chain 隨機相位）',
        String.raw`$v\sim\mathcal N(0,\sigma_v(x)^2)$，$\sigma_v(x)=\sigma_v\sqrt{1+\rho_j(x-x_j)^2}$；$\rho_j=0$ 時與 code 無關`,
        String.raw`靜態誤差路徑（identity path）：PLL 動態已吸收；主迴路 DC null 以逐 sample 的積分 servo 等效（$k_\varphi\gg$ LMS 速度）`,
        String.raw`mean-field：小 $\mu$ 平均動態 $E[G](w^*)=0$；MC：$w_{k+1}=w_k+\mu G_k$，$G_k=\tfrac1N\sum q\,x$（average mode）`,
        String.raw`Analytic ↔ MC 比對：參考值為 mean-field 根（DC null 模式用 servo-aware：$\sigma_\mathrm{eff}^2=\sigma_v^2+\operatorname{Var}(\varphi)$）；容許量 = $4\,\mathrm{SE}$ + 有限步長偏移估計 + servo 修正量的 25%`,
        String.raw`Comparator tie：MC 用硬體慣例 $\operatorname{sign}(0)=+1$；mean-field 的 $\operatorname{sign}(0)=0$（只影響測度為 0 的點）`,
        String.raw`全站極性 $\delta=a-w$；時間量用正規化單位 t.u.（例如 fs 或 DTC LSB），$x$ 無因次`,
      ]}
      params={{
        ...shared,
        case: cases.activeId,
        algorithm: activeCase.params.algorithm,
        sigmaV: activeCase.params.sigmaV,
        dcMode: activeCase.params.dcMode,
        mu: muUsed,
        muAuto: mc.muAuto,
        N: mc.N,
        blocks: mc.blocks,
        chains: mc.chains,
        servoGain: mc.servoGain,
        probeDelta: mc.probeDelta,
      }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ a: 't.u.', w0: 't.u.', b: 't.u.', c2: 't.u.', c3: 't.u.', kappa: 't.u.', sigmaV: 't.u.', mu: isSign ? 't.u.' : '—', N: 'samples/block', blocks: 'blocks', servoGain: '—', probeDelta: 't.u.' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: analyticCheck, monteCarlo: mcCheck, fixedPoint: { status: 'not-implemented', note: '定點（RTL bit-true）版本：見 Ch13 與 Unified Lab' } }}
      actions={{ onRun: runMc, onRunToConvergence: runToConvergence, onStop: cancelMc, running: mcRunning, onReset: resetAll }}
      exportData={exportData}
      presets={presetList.map((p) => ({ name: p.galleryIndex ? `Gallery #${p.galleryIndex}：${p.title}` : p.title, params: p.params, description: `${p.description} 預期：${p.expected}` }))}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <>
          <div className="ch11-group-title">Case 比較（A/B/C 共用誤差模型與 seed）</div>
          <CaseSelector cases={cases} label="Case" />
          <SelectControl
            label={`Case ${cases.activeId}：演算法`}
            value={activeCase.params.algorithm}
            onChange={(v) => cases.update({ algorithm: v })}
            options={(['sign', 'mse'] as const).map((v) => ({ value: v, label: ALGORITHM_LABEL[v] }))}
            reg="GMAC_MODE：1-bit q（Sign）／多位元 e（MSE）"
          />
          <ParamControl
            label={`Case ${cases.activeId}：σ_v（comparator 前雜訊）`}
            value={activeCase.params.sigmaV}
            onChange={(v) => cases.update({ sigmaV: v })}
            min={0}
            max={5}
            step={0.01}
            unit="t.u."
            reg="Behavioral：comparator input noise σ_v"
            hint={m('0 = 無雜訊；Sign-LMS 的固定點隨 $\\sigma_v$ 改變（勘誤 E01）')}
          />
          <SelectControl
            label={`Case ${cases.activeId}：主迴路 DC null`}
            value={activeCase.params.dcMode}
            onChange={(v) => cases.update({ dcMode: v })}
            options={(['none', 'shared_bbpd', 'linear_pd'] as const).map((v) => ({ value: v, label: DC_MODE_LABEL[v] }))}
            reg="架構：BBPD 是否與主 PLL 共用（勘誤 E03）"
          />

          <div className="ch11-group-title">誤差模型（所有 Case 共用）</div>
          <ParamControl label="a（真實線性 gain）" value={shared.a} onChange={set('a')} min={-5} max={5} step={0.01} unit="t.u." reg="Behavioral：DTC 真實 gain a" />
          <ParamControl label="w₀（初始 gain 暫存器）" value={shared.w0} onChange={set('w0')} min={-5} max={5} step={0.01} unit="t.u." reg="REG_DTC_GAIN_INIT" />
          <ParamControl label="b（comparator / PD offset）" value={shared.b} onChange={set('b')} min={-2} max={2} step={0.01} unit="t.u." reg="Behavioral：comparator offset b（REG_CMP_OS_TRIM 殘量）" />
          <ParamControl label="c₂（二階 INL）" value={shared.c2} onChange={set('c2')} min={-1} max={1} step={0.005} unit="t.u." reg="Behavioral：DTC INL d(x) 的 c₂" />
          <ParamControl label="c₃（三階 INL）" value={shared.c3} onChange={set('c3')} min={-1} max={1} step={0.005} unit="t.u." reg="Behavioral：DTC INL d(x) 的 c₃" />
          <ParamControl label="κ（ε_cc = κx）" value={shared.kappa} onChange={set('kappa')} min={-1} max={1} step={0.005} unit="t.u." reg="Behavioral：code-correlated deterministic error" hint={m('$\\kappa\\neq0\\Rightarrow w^*=a+\\kappa$（不可辨識）')} />

          <div className="ch11-group-title">Code 分布</div>
          <SelectControl
            label="code 分布"
            value={shared.codeKind}
            onChange={set('codeKind')}
            options={CODE_KINDS.map((k) => ({ value: k, label: CODE_KIND_LABEL[k] }))}
            reg="DSM / training pattern 選擇"
          />
          <ParamControl
            label="code 平移 x → x + x₀"
            value={shared.codeShift}
            onChange={set('codeShift')}
            min={-3}
            max={3}
            step={0.01}
            unit="code"
            reg="REG_CODE_OFFSET（code centering）"
            hint={m('改變 $E[x]$：示範 offset 與 gain 的交叉耦合')}
          />
          {shared.codeKind === 'dsm' && (
            <>
              <SelectControl
                label="DSM 架構"
                value={shared.dsmKind}
                onChange={set('dsmKind')}
                options={[
                  { value: 'first_order', label: 'first-order（x = residue ∈ [0, 1)）' },
                  { value: 'mash111', label: 'MASH 1-1-1（x ∈ (−2, 2)）' },
                ]}
                reg="DSM_ORDER"
              />
              <ParamControl label="FCW 小數 frac" value={shared.dsmFrac} onChange={set('dsmFrac')} min={0} max={0.996} step={1 / 256} unit="—" reg="FCW[7:0]（8-bit 累加器，量化到 1/256）" hint="frac = 0 時 code 恆為 0（不可辨識）" />
            </>
          )}
          {atLeast('research') ? (
            <>
              <div className="ch11-group-title">Research：code-dependent jitter（勘誤 E17）</div>
              <ParamControl label="ρ_j（σ_v(x) 斜率）" value={shared.jitterSlope} onChange={set('jitterSlope')} min={0} max={2} step={0.01} unit="code⁻²" reg="Behavioral：DTC random jitter 隨 delay 增加" hint={m('$\\sigma_v(x)=\\sigma_v\\sqrt{1+\\rho_j(x-x_j)^2}$')} />
              <ParamControl label="x_j（jitter 最小的 code）" value={shared.jitterRef} onChange={set('jitterRef')} min={-4} max={4} step={0.1} unit="code" reg="Behavioral：最短 delay 對應的 code" />
            </>
          ) : shared.jitterSlope > 0 ? (
            <p className="small muted">
              此設定使用 code-dependent jitter <Tex>{`\\rho_j=${shared.jitterSlope},\\ x_j=${shared.jitterRef}`}</Tex>（切到 Research 模式可調）。
            </p>
          ) : null}

          <div className="ch11-group-title">Monte Carlo（block LMS，worker）</div>
          <ToggleControl label="μ 自動（g = μS = 0.02）" value={mc.muAuto} onChange={setM('muAuto')} hint={m('$S$ 為 $w^*$ 處的 GMAC 斜率（dead zone 時用跨區間的割線）')} reg="Behavioral：μ = g/S（以正規化 loop gain 設定 REG_LMS_MU）" />
          <ParamControl
            label="μ（學習率）"
            value={mc.muAuto && Number.isFinite(muUsed) ? muUsed : mc.mu}
            onChange={setM('mu')}
            min={1e-5}
            max={1}
            log
            unit={isSign ? 't.u.' : '—'}
            reg="REG_LMS_MU"
            disabled={mc.muAuto}
          />
          <ParamControl label="N（每 block sample 數）" value={mc.N} onChange={setM('N')} min={1} max={4096} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="blocks（每條 chain）" value={mc.blocks} onChange={setM('blocks')} min={100} max={50000} integer clampOnBlur unit="blocks" reg="Behavioral：模擬長度" hint="前 50% 為 burn-in" />
          <ParamControl label="chains（獨立 seeds）" value={mc.chains} onChange={setM('chains')} min={2} max={64} integer clampOnBlur unit="chains" reg="Behavioral：MC 次數（給 95% CI）" />
          {activeCase.params.dcMode !== 'none' && (
            <ParamControl label="k_φ（主迴路 servo 增益 / sample）" value={mc.servoGain} onChange={setM('servoGain')} min={1e-4} max={0.2} log unit="—" reg="Behavioral：主 PLL 積分路徑等效增益" />
          )}
          <ParamControl
            label="Δ（凍結 gain 量斜率的 ±擾動）"
            value={mc.probeDelta}
            onChange={setM('probeDelta')}
            min={0.001}
            max={1}
            log
            unit="t.u."
            reg="Behavioral：Freeze + w ± Δ 的 GMAC 斜率量測（規格 §11.4）"
            hint="太大時割線斜率小於切線斜率"
          />
          <ToggleControl
            label="參數變更後自動重跑 MC"
            value={mc.autoRun}
            onChange={setM('autoRun')}
            disabled={mcMode !== 'worker'}
            reg="UI：參數停止變動 0.9 s 後在 Worker 重跑所有 Case"
            hint={mcMode === 'worker' ? 'debounce 0.9 s' : '此環境沒有 Web Worker：請手動按 Run'}
          />
        </>
      }
    >
      <div className="ch11-kpis">
        <div className="ch11-kpi">
          <div className="ch11-kpi-label">
            Case {cases.activeId} 的 <Tex>{'w^*'}</Tex>（{isSign ? 'Sign mean-field' : 'MSE 封閉解'}） <ClaimTag kind="exact" />
          </div>
          <div className="ch11-kpi-value">{an ? (deadZone ? `(${num(an.zeroSet.lo, 5)}, ${num(an.zeroSet.hi, 5)})` : num(an.wStar)) : '—'}</div>
          <div className="ch11-kpi-note">
            {deadZone ? (
              'dead zone：解不唯一'
            ) : (
              <>
                gain bias <Tex>{'w^*-a'}</Tex> = {an ? signed(an.wStar - shared.a) : '—'}
              </>
            )}
          </div>
        </div>
        <div className="ch11-kpi">
          <div className="ch11-kpi-label">
            一階公式 <ClaimTag kind="approx" />
          </div>
          <div className="ch11-kpi-value">{an ? num(an.wLinear) : '—'}</div>
          <div className="ch11-kpi-note">
            {isSign ? m(`$\\max|e_\\mathrm{det}|/\\sigma_v=${an ? texNum(an.validityRatio, 3) : '?'}$`) : 'MSE：與上相同（精確）'}
          </div>
        </div>
        <div className="ch11-kpi">
          <div className="ch11-kpi-label">
            Monte Carlo <Tex>{'\\bar w'}</Tex>（95% CI）
          </div>
          <div className="ch11-kpi-value">{mcValid ? num(mcValid.mean) : mcRunning ? '執行中…' : '—'}</div>
          <div className="ch11-kpi-note">
            {mcValid
              ? `± ${num(mcValid.halfWidth, 3)}（${mcValid.chainMeans.length} chains × ${mcValid.blocksUsed} blocks）${agreement ? (agreement.pass ? ' ✓ 與解析值一致' : ' ✗ 超出容許量') : ''}`
              : '按「執行 Run」'}
          </div>
        </div>
        <div className="ch11-kpi">
          <div className="ch11-kpi-label">
            <Tex>{String.raw`E[e_\mathrm{det}^2]`}</Tex>：校正前 → 後
          </div>
          <div className="ch11-kpi-value">{an && an.costs.length > 2 ? `${num(an.costs[0].mse, 4)} → ${num(an.costs[2].mse, 4)}` : '—'}</div>
          <div className="ch11-kpi-note">{m('$E[G]=0$ 但殘差功率 $\\neq0$')}</div>
        </div>
      </div>

      <Plot
        title="平均 GMAC $E[G]$ vs $w$（零交越 = 固定點 $w^*$）"
        data={gmacData}
        layout={gmacLayout}
        height={340}
        csvName="bias-gmac-vs-w"
        caption={String.raw`實線：mean-field $E[G](w)$（Sign 用 erf、MSE 為直線）；虛線：一階 $K_q$ 線性化；圓點：MC 在凍結 $w$ 下量到的平均 $G$（batch-means 95% CI，對 DSM 等相關序列仍有效）；菱形：各 Case 的 MC 時間平均 $\bar w$（水平誤差棒 = 95% CI）；點線：各 Case 的 $w^*$；長虛線：真實 $a$。`}
      />
      <div className="ch11-plot-grid">
        <Plot
          title="殘差 vs code：GMAC 歸零，殘差不歸零"
          data={residualData}
          layout={residualLayout}
          height={300}
          csvName="bias-residual-vs-code"
          caption={continuous ? '連續 code：殘差曲線與 code 機率密度（右軸）。' : String.raw`每個 code 的確定性殘差 $e_\mathrm{det}(x)+\varphi$（不含隨機雜訊 $v$）。`}
        />
        <Plot
          title={String.raw`$w^*(\sigma_v)$：雜訊把 Sign-LMS 從中位數推向平均`}
          data={sweepData}
          layout={sweepLayout}
          height={300}
          xLog
          csvName="bias-wstar-vs-sigma"
          caption={String.raw`Sign-LMS mean-field 隨 $\sigma_v$ 的變化（與目前 Case 的演算法無關）；點線為目前 $\sigma_v$。`}
        />
      </div>
      <div className="table-wrap">
        <table className="ch11-table">
          <caption className="small muted">
            Case 並列比較（共用誤差模型、code 與 seed）。「MC 參考值」在 DC null 模式是 servo-aware 固定點；容許量 = <Tex>{String.raw`4\,\mathrm{SE}`}</Tex> + 有限步長 + servo 修正的 25%。尚未執行的 Case 按「執行 Run」會依序補跑。
          </caption>
          <thead>
            <tr>
              <th>Case</th>
              <th>設定</th>
              <th>
                mean-field <Tex>{'w^*'}</Tex>
              </th>
              <th>MC 參考值</th>
              <th>
                MC <Tex>{'\\bar w'}</Tex>（95% CI）
              </th>
              <th>
                <Tex>{'\\Delta'}</Tex>
              </th>
              <th>容許量</th>
              <th>一致？</th>
            </tr>
          </thead>
          <tbody>
            {compareRows.map(({ c, a, r, ag }) => (
              <tr key={c.id} className={c.id === cases.activeId ? 'ch11-hl' : undefined}>
                <td>{c.id}</td>
                <td>{m(caseLabelTex(c.params))}</td>
                <td className="num">{a ? (isDeadZone(a) ? `(${num(a.zeroSet.lo, 5)}, ${num(a.zeroSet.hi, 5)})` : num(a.wStar)) : '—'}</td>
                <td className="num">{ag ? (ag.kind === 'dead-zone' ? '區間內任一點' : num(ag.reference)) : '—'}</td>
                <td className="num">{r ? `${num(r.mean)} ± ${num(r.halfWidth, 2)}` : '—'}</td>
                <td className="num">{ag ? signed(ag.delta, 2) : '—'}</td>
                <td className="num">{ag ? num(ag.tolerance, 2) : '—'}</td>
                <td>{ag ? (ag.pass ? '✓' : '✗') : r ? '—' : '未執行'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mcValid && (
        <Plot
          title={`Monte Carlo 軌跡（Case ${cases.activeId}，前 ${mcValid.traces.w.length} 條 chain）`}
          data={traceData}
          layout={TRACE_LAYOUT}
          height={260}
          csvName="bias-mc-trace"
          caption={String.raw`$\mu=${texNum(muUsed, 4)}$、$N=${mc.N}$、${mcValid.blocksUsed} blocks（前 50% burn-in）；Sign-LMS 在 $\sigma_v=0$ 時呈 $O(\mu)$ limit cycle。`}
        />
      )}
      {residualTable && (
        <div className="table-wrap">
          <table className="ch11-table">
            <caption className="small muted">
              殘差表（Case {cases.activeId}；<Tex>{'t(x)'}</Tex> 為每個 code 的零誤差 gain）。
              {isSign
                ? m('Sign-LMS：機率加權平均為 0 的是最後一欄 $x\\,E[q|x]$（GMAC 歸零），$x\\,e$ 欄的平均並不為 0 —— 這正是 Sign 與 MSE 固定點不同的原因。')
                : m('MSE-LMS：$x\\,e$ 欄的機率加權平均為 0（GMAC 歸零），但 $e$ 本身不為 0。')}
            </caption>
            <thead>
              <tr>
                <th>
                  <Tex>{'x'}</Tex>
                </th>
                <th>
                  <Tex>{'p(x)'}</Tex>
                </th>
                <th>
                  <Tex>{'t(x)'}</Tex>
                </th>
                <th>
                  <Tex>{'e(x;\\,a)'}</Tex>
                </th>
                <th>
                  <Tex>{'e(x;\\,w^*)'}</Tex>
                </th>
                <th>
                  <Tex>{'x\\,e(x;\\,w^*)'}</Tex>
                </th>
                {isSign && (
                  <th>
                    <Tex>{String.raw`x\,E[q\mid x]`}</Tex>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {residualTable.map((r) => (
                <tr key={r.x}>
                  <td className="num">{num(r.x, 5)}</td>
                  <td className="num">{num(r.p, 4)}</td>
                  <td className="num">{Number.isFinite(r.t) ? num(r.t, 6) : '—'}</td>
                  <td className="num">{signed(r.eAtA, 5)}</td>
                  <td className="num">{signed(r.eStar, 5)}</td>
                  <td className="num">{signed(r.xe, 5)}</td>
                  {isSign && <td className="num">{signed(r.xg, 5)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {an && isSign && activeCase.params.sigmaV === 0 && (
        <Callout kind="warn" title="無雜訊 Sign-LMS">
          <Tex>{'\\sigma_v=0'}</Tex> 時 comparator 只看殘差的正負號；固定點是每個 code 的零誤差 gain <Tex>{'t(x)'}</Tex> 以 <Tex>{'|x|'}</Tex> 加權的中位數，與 MSE 的{' '}
          <Tex>{'x^2'}</Tex> 加權平均不同。把 <Tex>{'\\sigma_v'}</Tex> 調大，看 <Tex>{'w^*'}</Tex> 沿著 <Tex>{'w^*(\\sigma_v)'}</Tex> 圖的曲線滑向 MSE 解。
        </Callout>
      )}
    </ExperimentShell>
  )
}
