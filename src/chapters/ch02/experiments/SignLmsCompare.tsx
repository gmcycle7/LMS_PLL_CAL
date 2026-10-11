import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  stripMathDelimiters,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import type { TieRule } from '@/simulation/models/lms'
import {
  ALGO_IDS,
  ALGO_LABEL,
  NOISE_KIND_LABEL,
  SCHEDULE_LABEL,
  X_KIND_LABEL,
  algoStepSizes,
  meanFieldAnalysis,
  meanFieldInputOf,
  predictSteadyState,
  runShared,
  stepsToTravel,
  travelDistance,
  xMoments,
  type AlgoId,
  type AlgoMeanField,
  type CaseConfig,
  type CompareMcParams,
  type CompareMcResult,
  type CompareRunResult,
  type NoiseKind,
  type ScheduleKind,
  type SteadyStatePrediction,
  type StepMatch,
  type XKind,
} from '@/simulation/models/sgd'
import { ALGO_SERIES, CASE_DASH, TIE_LABEL, decimate, f4, range, tm, tn, toShellPresets, lab } from '../common'
import { AlgoToggles } from './AlgoToggles'
import { fixedPointConsistency, summarizeConsistency } from './consistency'
import { useKeyedWorker } from './useKeyedWorker'

export const SIGN_LMS_COMPARE_ID = 'sign-lms-compare'
const ID = SIGN_LMS_COMPARE_ID

/** 每個 Case 自己的參數 */
export type CaseP = Omit<CaseConfig, 'a' | 'w0' | 'steps'>
/** 所有 Case 共用的參數 */
export interface SharedP {
  a: number
  w0: number
  steps: number
  runs: number
  algos: AlgoId[]
  deltaRef: 'a' | 'wstar'
}

export const DEFAULT_CASE: CaseP = {
  mu: 0.02,
  xKind: 'gauss',
  xAmp: 1,
  noiseKind: 'gaussian',
  sigma: 0.5,
  outlierProb: 0,
  outlierSize: 0,
  tie: 'plus',
  schedule: 'constant',
  n0: 500,
  stepMatch: 'same-mu',
  huberDelta: 0.5,
  nlmsEps: 0.1,
}
export const DEFAULT_SHARED: SharedP = { a: 3, w0: 0, steps: 3000, runs: 32, algos: ['lms', 'sign_error', 'sign_sign', 'nlms'], deltaRef: 'a' }

/** Monte Carlo 的總更新次數上限（runs × steps × 演算法 × case），超過就自動減少 runs */
const MC_BUDGET = 2.5e7

const X_KINDS: XKind[] = ['const', 'bpsk', 'gauss', 'uniformPos']
const NOISE_KINDS: NoiseKind[] = ['none', 'gaussian', 'laplacian', 'impulsive', 'skewed']
const SCHEDULES: ScheduleKind[] = ['constant', 'harmonic', 'gear']
const TIES: TieRule[] = ['zero', 'plus', 'minus']

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

export function sanitizeCase(p: Record<string, unknown>, base: CaseP = DEFAULT_CASE): CaseP {
  const pick = <T,>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
  return {
    mu: num(p.mu, base.mu),
    xKind: pick(p.xKind, X_KINDS, base.xKind),
    xAmp: num(p.xAmp, base.xAmp),
    noiseKind: pick(p.noiseKind, NOISE_KINDS, base.noiseKind),
    sigma: num(p.sigma, base.sigma),
    outlierProb: num(p.outlierProb, base.outlierProb),
    outlierSize: num(p.outlierSize, base.outlierSize),
    tie: pick(p.tie, TIES, base.tie),
    schedule: pick(p.schedule, SCHEDULES, base.schedule),
    n0: num(p.n0, base.n0),
    stepMatch: pick<StepMatch>(p.stepMatch, ['same-mu', 'same-speed'], base.stepMatch),
    huberDelta: num(p.huberDelta, base.huberDelta),
    nlmsEps: num(p.nlmsEps, base.nlmsEps),
  }
}

export function sanitizeShared(p: Record<string, unknown>): SharedP {
  const algos = Array.isArray(p.algos) ? ALGO_IDS.filter((a) => (p.algos as unknown[]).includes(a)) : DEFAULT_SHARED.algos
  return {
    a: num(p.a, DEFAULT_SHARED.a),
    w0: num(p.w0, DEFAULT_SHARED.w0),
    steps: Math.max(10, Math.min(20000, Math.round(num(p.steps, DEFAULT_SHARED.steps)))),
    runs: Math.max(4, Math.min(256, Math.round(num(p.runs, DEFAULT_SHARED.runs)))),
    algos: algos.length ? algos : DEFAULT_SHARED.algos,
    deltaRef: p.deltaRef === 'wstar' ? 'wstar' : 'a',
  }
}

interface AlgoAnalysis {
  algo: AlgoId
  mu: number
  mf: AlgoMeanField
  pred: SteadyStatePrediction
}

/** Freeze 用的參數快照 */
interface Snapshot {
  configs: CaseConfig[]
  shared: SharedP
  seed: number
  caseIds: string[]
}

/**
 * 「執行至收斂」需要的步數估計（固定步長）：2 ×（等速段 + 8τ）。
 * 等速段：sign 類離 w* 很遠時每步只走固定的 μ·E|x|（Sign-Sign 為 μ、Huber 為 μ·δₕ·E|x|），要 |a − w₀|/速度 步；
 * 之後才是時間常數 τ = −1/ln|1 − μK| 的指數收斂。乘 2 是因為統計只取後半段。遞減步長或線性化不穩定時回傳 0（不建議步數）。
 */
export function stepsToSettle(a: AlgoAnalysis, c: CaseConfig): number {
  if (c.schedule !== 'constant' || !a.mf.identifiable || !(a.mu > 0)) return 0
  const m = xMoments({ kind: c.xKind, amp: c.xAmp })
  const dist = Math.abs(c.w0 - (Number.isFinite(a.mf.wStar) ? a.mf.wStar : c.a))
  const speed = a.algo === 'sign_error' ? a.mu * m.mAbs : a.algo === 'sign_sign' ? a.mu : a.algo === 'huber' ? a.mu * c.huberDelta * m.mAbs : Infinity
  const slew = speed > 0 ? dist / speed : 0
  const det = a.mf.deterministic && (a.algo === 'sign_error' || a.algo === 'sign_sign')
  if (det) return 2 * slew + 20 // 無雜訊：走到之後就是 period-2 的 limit cycle
  if (!a.pred.stable || !Number.isFinite(a.pred.tau)) return 0
  return 2 * (slew + 8 * a.pred.tau)
}

/** 依參數解釋「為什麼會失敗」的警告（ExperimentShell 以 danger 顯示）。 */
export function caseWarnings(tag: string, c: CaseConfig, an: AlgoAnalysis[], run?: CompareRunResult): string[] {
  const w: string[] = []
  const m = xMoments({ kind: c.xKind, amp: c.xAmp })
  if (!(m.m2 > 0)) {
    w.push(String.raw`${tag}$x\equiv0$：$E[x^2]=\lambda_{\min}=0$，不可辨識——所有演算法的平均更新方向 $\psi(w)\equiv0$，$w$ 不會朝 $a$ 移動。`)
    return w
  }
  const fixedAmp = c.xKind === 'const' || c.xKind === 'bpsk'
  for (const a of an) {
    if (a.algo === 'lms' || a.algo === 'huber') {
      if (fixedAmp) {
        const p = 1 - a.mu * c.xAmp * c.xAmp
        const bound = String.raw`需 $0<\mu<2/x^2=${tn(2 / (c.xAmp * c.xAmp))}$`
        if (Math.abs(p) >= 1 && c.schedule === 'constant')
          w.push(
            a.algo === 'lms'
              ? String.raw`${tag}LMS：$|1-\mu x^2|=${tn(Math.abs(p))}\ge1$，固定幅度 $x$ 時 $\delta_{n+1}=(1-\mu x^2)\,\delta_n$ ` +
                  (Math.abs(p) > 1 ? '發散' : String.raw`在 $\pm\delta_0$ 之間永遠來回跳（臨界）`) +
                  `（${bound}）。`
              : String.raw`${tag}Huber：$|1-\mu x^2|=${tn(Math.abs(p))}\ge1$，線性區（$|e|\le\delta_{\rm H}$）內 $\delta_{n+1}=(1-\mu x^2)\,\delta_n$ 不收斂，誤差被推到 $|e|>\delta_{\rm H}$；` +
                  String.raw`但截斷後每步最多移動 $\mu\,\delta_{\rm H}|x|=${tn(a.mu * c.huberDelta * Math.abs(c.xAmp))}$，所以不會發散到無限大，而是在 $a$ 附近大幅來回跳（${bound} 才會收斂）。`,
          )
      } else if (a.algo === 'lms' && c.schedule === 'constant') {
        if (a.mu >= 2 / m.m2) w.push(String.raw`${tag}LMS：$\mu\ge2/E[x^2]=${tn(2 / m.m2)}$：連平均 $E[\delta_n]$ 都發散（mean 不穩定，Ch03）。`)
        else if (a.mu >= (2 * m.m2) / m.m4)
          w.push(
            String.raw`${tag}LMS：$\mu\ge2E[x^2]/E[x^4]=${tn((2 * m.m2) / m.m4)}$：均方（MSD）發散；單一路徑可能仍收斂（almost-sure 界較寬，勘誤 E14），但 $E[\delta^2]$ 被少數重尾路徑主導。`,
          )
      }
    }
    if (a.algo === 'nlms' && c.schedule === 'constant') {
      const gain = fixedAmp ? (a.mu * c.xAmp * c.xAmp) / (c.nlmsEps + c.xAmp * c.xAmp) : a.mu
      if (gain >= 2)
        w.push(
          fixedAmp
            ? String.raw`${tag}NLMS：$\tilde\mu\,x^2/(\varepsilon+x^2)=${tn(gain)}\ge2$，正規化後的 pole $1-\tilde\mu x^2/(\varepsilon+x^2)\le-1$ $\Rightarrow$ 不收斂（需 $0<\tilde\mu<2$）。`
            : String.raw`${tag}NLMS：$\tilde\mu=${tn(gain)}\ge2$：大 $|x|$ 的樣本使單步倍率 $1-\tilde\mu x^2/(\varepsilon+x^2)\le-1$（誤差被放大）；保證收斂的充分條件是 $0<\tilde\mu<2$。`,
        )
      if (c.nlmsEps === 0 && c.xKind === 'gauss')
        w.push(
          String.raw`${tag}NLMS：$\varepsilon=0$ 且 Gaussian $x$ 可任意接近 0：更新量 $\tilde\mu\,e\,x/x^2=\tilde\mu\,e/x$（雜訊被 $1/x$ 放大），$E[v^2/x^2]=\infty$——$w_n$ 是重尾分布，穩態變異數無限大，「MC 平均 $\pm$ CI」不可靠。請設 $\varepsilon>0$。`,
        )
      else if (c.nlmsEps === 0 && c.xKind === 'uniformPos')
        w.push(
          String.raw`${tag}NLMS：$\varepsilon=0$ 時小 $|x|$ 的樣本把雜訊放大 $1/|x|$ 倍（此分布 $|x|\ge0.5A$，放大有上限 $2/A=${tn(2 / Math.max(1e-12, Math.abs(c.xAmp)))}$，仍建議設 $\varepsilon>0$）。`,
        )
    }
    if ((a.algo === 'sign_error' || a.algo === 'sign_sign') && c.schedule !== 'constant') {
      const absX = a.algo === 'sign_sign' ? 1 : m.mAbs
      const dist = Math.abs(c.a - c.w0)
      const can = travelDistance(a.mu, absX, { kind: c.schedule, n0: c.n0 }, c.steps)
      if (can < dist) {
        const need = stepsToTravel(dist, a.mu, absX, { kind: c.schedule, n0: c.n0 }, 5_000_000)
        w.push(
          String.raw`${tag}${ALGO_LABEL[a.algo]}：步長衰減太快（stall）——前 ${c.steps} 步平均最多只能移動 $\sum_n\mu_n\,${a.algo === 'sign_sign' ? '' : 'E|x|'}\approx${tn(can)}<|a-w_0|=${tn(dist)}$` +
            (Number.isFinite(need) ? `，約需 ${need} 步。` : String.raw`，$5\times10^6$ 步內走不到。`) +
            String.raw`加大 $n_0$ 或 $\mu_0$（F-02.11）。`,
        )
      }
    }
    if (run?.diverged[a.algo]) {
      const wv = run.w[a.algo]!
      const k = wv.findIndex((v) => Number.isNaN(v))
      w.push(String.raw`${tag}${ALGO_LABEL[a.algo]} 在 $n\approx${k}$ 發散（$|w|>10^{12}$ 或非有限值）。`)
    }
  }
  return w
}

/** Sign 系列 vs LMS / NLMS / Huber 在同一組資料上的比較（同 seed、Case A/B/C）。 */
export function SignLmsCompare() {
  const tokens = useThemeTokens()
  const [shared, setShared] = useState<SharedP>(DEFAULT_SHARED)
  const cases = useCases<CaseP>(DEFAULT_CASE, { seed: 20261010 })
  const [pending, setPending] = useState<Record<string, unknown>[] | null>(null)
  const [frozen, setFrozen] = useState<Snapshot | null>(null)
  const urlPreset = useUrlPreset(ID)

  const applyPreset = (params: Record<string, unknown>) => {
    const { compare, ...rest } = params
    setFrozen(null)
    setShared(sanitizeShared(rest))
    cases.reset(sanitizeCase(rest))
    setPending(Array.isArray(compare) ? (compare as Record<string, unknown>[]).slice(0, 2) : null)
  }
  // 多 Case 的 preset：每次 render 加一個 Case（useCases 的 addCase 讀取上一個 render 的狀態）
  useEffect(() => {
    if (!pending) return
    if (pending.length === 0) {
      setPending(null)
      return
    }
    const [head, ...tail] = pending
    const id = cases.addCase()
    if (id) cases.update((prev) => sanitizeCase(head, prev), id)
    setPending(tail)
  }, [pending, cases])
  useEffect(() => {
    if (urlPreset) applyPreset(urlPreset.params)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPreset])

  const configs = useMemo<CaseConfig[]>(
    () => cases.cases.map((c) => ({ a: shared.a, w0: shared.w0, steps: shared.steps, ...c.params })),
    [cases.cases, shared.a, shared.w0, shared.steps],
  )
  // Freeze（規格 §19）：凍結時圖表與表格停在按下當時的參數快照，控制項仍可調整；解除後才重算
  const live = useMemo<Snapshot>(() => ({ configs, shared, seed: cases.seed, caseIds: cases.cases.map((c) => c.id) }), [configs, shared, cases.seed, cases.cases])
  const view = frozen ?? live
  const seed = view.seed
  const dConfigs = useDebouncedValue(view.configs, 150)
  const dShared = useDebouncedValue(view.shared, 150)
  const algos = dShared.algos
  const caseIds = view.caseIds
  const activeIdx = Math.max(0, caseIds.indexOf(cases.activeId))

  // 單一 seed 的軌跡（主執行緒：≤ 20000 步 × 5 演算法 × 3 case）
  const runs = useMemo(() => dConfigs.map((c) => runShared({ ...c, algos, seed })), [dConfigs, algos, seed])
  // Mean-field 解析（固定點、K、穩態預測）
  const analysis = useMemo<AlgoAnalysis[][]>(
    () =>
      dConfigs.map((c) => {
        const inp = meanFieldInputOf(c)
        const mus = algoStepSizes(c, algos)
        return algos.map((a) => {
          const mf = meanFieldAnalysis(a, inp)
          return { algo: a, mu: mus[a], mf, pred: predictSteadyState(mf, mus[a], inp) }
        })
      }),
    [dConfigs, algos],
  )

  // Monte Carlo（Worker）
  const effRuns = Math.max(4, Math.min(dShared.runs, Math.floor(MC_BUDGET / Math.max(1, dShared.steps * algos.length * dConfigs.length))))
  const mcParams = useMemo<{ cases: CompareMcParams[] }>(
    () => ({ cases: dConfigs.map((c) => ({ ...c, algos, seed, runs: effRuns, checkpoints: 100 })) }),
    [dConfigs, algos, seed, effRuns],
  )
  const mc = useKeyedWorker<{ cases: CompareMcParams[] }, CompareMcResult[]>('sgd', 'monteCarloCompareCases', mcParams)

  const active = cases.active.params
  const set = <K extends keyof CaseP>(k: K, v: CaseP[K]) => cases.update({ [k]: v } as Partial<CaseP>)
  const setS = <K extends keyof SharedP>(k: K, v: SharedP[K]) => setShared((s) => ({ ...s, [k]: v }))

  /* ---------- 圖 1：目前 Case 的 w_n ---------- */
  const wData = useMemo<Data[]>(() => {
    const run = runs[activeIdx]
    const an = analysis[activeIdx]
    if (!run || !an) return []
    const N = dShared.steps
    const idx = decimate(N + 1, 3000)
    const out: Data[] = [{ x: [0, N], y: [dShared.a, dShared.a], name: '$a$', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } }]
    for (const a of an) {
      const w = run.w[a.algo]
      if (!w) continue
      out.push({ x: idx, y: idx.map((i) => w[i]), name: ALGO_LABEL[a.algo], mode: 'lines', line: { color: tokens.series[ALGO_SERIES[a.algo]], width: 1.5 } })
      if (a.mf.identifiable && Math.abs(a.mf.wStar - dShared.a) > 1e-6 * (1 + Math.abs(dShared.a)))
        out.push({ x: [0, N], y: [a.mf.wStar, a.mf.wStar], name: String.raw`$w^*$（${ALGO_LABEL[a.algo]}）`, mode: 'lines', line: { color: tokens.series[ALGO_SERIES[a.algo]], dash: 'dot', width: 1 } })
    }
    return out
  }, [runs, analysis, activeIdx, dShared, tokens])

  /* ---------- 圖 2：所有 Case 的 |δ_n|（log） ---------- */
  const dData = useMemo<Data[]>(() => {
    const out: Data[] = []
    runs.forEach((run, ci) => {
      const an = analysis[ci]
      const N = run.x.length
      const idx = decimate(N + 1, 1500)
      for (const a of an ?? []) {
        const w = run.w[a.algo]
        if (!w) continue
        const ref = dShared.deltaRef === 'wstar' && a.mf.identifiable ? a.mf.wStar : dShared.a
        out.push({
          x: idx,
          y: idx.map((i) => Math.abs(ref - w[i])),
          name: `${caseIds[ci] ?? ''} · ${ALGO_LABEL[a.algo]}`,
          legendgroup: a.algo,
          mode: 'lines',
          line: { color: tokens.series[ALGO_SERIES[a.algo]], dash: CASE_DASH[ci] ?? 'solid', width: 1.2 },
        })
      }
    })
    return out
  }, [runs, analysis, dShared.deltaRef, dShared.a, caseIds, tokens])

  /* ---------- 圖 3：MC 的 |δ_n| 中位數 + 10–90% ---------- */
  const mcRes = mc.result ?? null
  const mcData = useMemo<Data[]>(() => {
    const r = mcRes?.[activeIdx]
    if (!r) return []
    const xs = Array.from(r.checkpoints, (v) => Math.max(v, 1))
    const out: Data[] = []
    for (const st of r.stats) {
      const color = tokens.series[ALGO_SERIES[st.algo]]
      out.push({ x: xs, y: Array.from(st.absDeltaQ10), mode: 'lines', line: { width: 0, color }, showlegend: false, hoverinfo: 'skip', legendgroup: st.algo, name: `${ALGO_LABEL[st.algo]} 10%` })
      out.push({ x: xs, y: Array.from(st.absDeltaQ90), mode: 'lines', line: { width: 0, color }, fill: 'tonexty', fillcolor: hexAlpha(color, 0.15), showlegend: false, hoverinfo: 'skip', legendgroup: st.algo, name: `${ALGO_LABEL[st.algo]} 90%` })
      out.push({ x: xs, y: Array.from(st.absDeltaMedian), mode: 'lines', line: { color, width: 2 }, legendgroup: st.algo, name: `${ALGO_LABEL[st.algo]} 中位數` })
    }
    return out
  }, [mcRes, activeIdx, tokens])

  /* ---------- 交叉比對與表格 ---------- */
  const rows = useMemo(
    () =>
      dConfigs.flatMap((c, ci) =>
        (analysis[ci] ?? []).map((a) => {
          const st = mcRes?.[ci]?.stats.find((s) => s.algo === a.algo)
          const { tol, expect, ok, reason } = fixedPointConsistency({ c, algo: a.algo, mu: a.mu, mf: a.mf, pred: a.pred, st })
          return { ci, c, a, st, tol, expect, ok, reason }
        }),
      ),
    [dConfigs, analysis, mcRes],
  )
  const analyticCheck = mcRes
    ? summarizeConsistency(rows.map((r) => ({ ok: r.ok, reason: r.reason, label: `${caseIds[r.ci] ?? '?'}·${ALGO_LABEL[r.a.algo]}` })))
    : { status: 'n/a' as const, note: mc.error ?? 'Monte Carlo 計算中…' }

  const warnings = useMemo(
    () => dConfigs.flatMap((c, ci) => caseWarnings(dConfigs.length > 1 ? `Case ${caseIds[ci] ?? '?'}：` : '', c, analysis[ci] ?? [], runs[ci])),
    [dConfigs, analysis, runs, caseIds],
  )

  const activeRows = rows.filter((r) => r.ci === activeIdx)
  const metrics: MetricRow[] = activeRows.flatMap(({ a, st, tol, expect, c }) => {
    const out: MetricRow[] = [
      {
        name: String.raw`${ALGO_LABEL[a.algo]}：MC 時間平均 vs $w^*$（$+O(\mu)$ 修正）`,
        value: st ? (st.n ? st.tavgMean : '全部發散') : mc.pending ? '計算中…' : null,
        analytic: a.mf.identifiable ? expect : undefined,
        tolerance: st && st.n ? tol : undefined,
        formulaId: 'F-02.8',
        claim: 'exact',
        note: st && st.n ? String.raw`95% CI $\pm${tn(st.tavgHalf, 3)}$（${effRuns} seeds）` : undefined,
      },
    ]
    if (c.schedule === 'constant' && !a.mf.deterministic && a.pred.stable && st && st.n)
      out.push({
        name: String.raw`${ALGO_LABEL[a.algo]}：穩態 $\operatorname{std}(w)$（MC vs ${a.pred.exact ? '精確式' : '線性化'}）`,
        value: st.tavgStd,
        analytic: a.pred.std,
        tolerance: a.pred.exact ? 0.1 : 0.15,
        toleranceMode: 'rel',
        formulaId: a.pred.exact ? 'F-02.16' : 'F-02.13',
        claim: a.pred.exact ? 'exact' : 'approx',
      })
    return out
  })

  const activeAn = analysis[activeIdx] ?? []
  const lmsStar = activeAn.find((x) => x.algo === 'lms')?.mf.wStar
  const differ = activeAn.filter((x) => x.mf.identifiable && x.algo !== 'lms' && lmsStar !== undefined && Math.abs(x.mf.wStar - lmsStar) > 1e-4 * (1 + Math.abs(lmsStar)))
  const detSign = activeAn.some((x) => x.mf.deterministic && (x.algo === 'sign_error' || x.algo === 'sign_sign'))

  return (
    <ExperimentShell
      id={ID}
      title="Sign-LMS 比較實驗：同一組資料、四種演算法"
      level="L0"
      claim="approx"
      source="simulation"
      description={
        <>
          所有演算法吃<strong>完全相同</strong>的 <Tex>{'(x_n,y_n)'}</Tex>（同一個 seed）；Case A/B/C 可以換雜訊形狀、步長排程或 tie 慣例做對照。
          表格的 bias/std 由 Worker 跑多個 seed 的 Monte Carlo。
        </>
      }
      assumptions={[
        String.raw`$y_n=a\,x_n+v_n$，$x$ 與 $v$ 獨立、iid；雜訊形狀不同但標準差都是 $\sigma_v$（單邊 outlier 另外疊加）`,
        String.raw`$\delta=a-w$（全站約定）；$\operatorname{sign}(0)$ 依所選 tie 慣例（勘誤 E40）`,
        String.raw`same-mu：所有演算法同一個 $\mu$（NLMS 用 $\tilde\mu=\mu\,E[x^2]$）；same-speed：$\mu_{\rm algo}=\mu\,E[x^2]/K_{\rm algo}$，讓線性化 pole $1-\mu K$ 相同（無雜訊的 sign 類 $K=\infty$，退回同一個 $\mu$）`,
        String.raw`mean-field 固定點 $w^*$：對 $x$ 數值積分、對 $v$ 用封閉式；穩態 std 預測為線性化近似（LMS + 零均值雜訊時為精確式 F-02.16）`,
        String.raw`MC：${effRuns} 個 seed（第 0 個 seed 即圖中路徑），時間平均取後半段 $n\ge N/2$`,
      ]}
      params={{
        ...dShared,
        algos: dShared.algos.join(','),
        // 每個 Case 自己的參數（凍結時是快照），鍵名加上 Case 編號
        ...Object.fromEntries(
          dConfigs.flatMap((c, ci) =>
            Object.entries(c)
              .filter(([k]) => k !== 'a' && k !== 'w0' && k !== 'steps')
              .map(([k, v]) => [`${caseIds[ci] ?? ci}.${k}`, v]),
          ),
        ),
        frozen: frozen !== null,
      }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ a: '同 y/x', w0: '同 a', mu: 'LMS: 1/[x]^2；Sign-Error: [w]/[x]；Sign-Sign: [w]', sigma: '同 y', xAmp: '無因次', n0: 'samples', steps: 'samples' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: mcRes ? { status: 'ok', note: String.raw`${effRuns} seeds $\times$ ${dShared.steps} 步 $\times$ ${algos.length} 演算法 $\times$ ${dConfigs.length} case（${mc.mode}${mc.durationMs ? `，${Math.round(mc.durationMs)} ms` : ''}）` } : { status: 'n/a', note: mc.error ?? '計算中…' },
        fixedPoint: { status: 'not-implemented', note: '位元精確（fixed-point）模型見 Ch13' },
      }}
      actions={{
        onReset: () => {
          setFrozen(null)
          setShared(DEFAULT_SHARED)
          cases.reset(DEFAULT_CASE)
        },
        onRunToConvergence: () => {
          const need = Math.max(0, ...dConfigs.flatMap((c, ci) => (analysis[ci] ?? []).map((a) => stepsToSettle(a, c))))
          if (need > 0) setS('steps', Math.max(10, Math.min(20000, Math.ceil(need))))
        },
        onFreeze: () => setFrozen((f) => (f ? null : live)),
        frozen: frozen !== null,
      }}
      exportData={() => {
        const run = runs[activeIdx]
        const cols: Record<string, ArrayLike<number>> = { n: range(dShared.steps + 1), x: run?.x ?? [], y: run?.y ?? [] }
        for (const a of algos) if (run?.w[a]) cols[`w_${a}`] = run.w[a]!
        const r = mcRes?.[activeIdx]
        if (r) {
          cols.mc_checkpoint = r.checkpoints
          for (const st of r.stats) {
            cols[`mc_absdelta_q10_${st.algo}`] = st.absDeltaQ10
            cols[`mc_absdelta_median_${st.algo}`] = st.absDeltaMedian
            cols[`mc_absdelta_q90_${st.algo}`] = st.absDeltaQ90
          }
        }
        return cols
      }}
      presets={toShellPresets(presetsForExperiment(ID))}
      onLoadPreset={(pr) => applyPreset(pr.params)}
      controls={
        <>
          <AlgoToggles value={shared.algos} onChange={(v) => setS('algos', v)} />
          <fieldset className="ch02-controls-group">
            <legend>共用參數</legend>
            <ParamControl {...lab(String.raw`$a$（真實係數）`, 'a（真實係數）')} unit="同 $y/x$" value={shared.a} onChange={(v) => setS('a', v)} min={-10} max={10} step={0.01} reg="behavioural: true gain a" />
            <ParamControl {...lab(String.raw`$w_0$（初值）`, 'w₀（初值）')} unit="同 $a$" value={shared.w0} onChange={(v) => setS('w0', v)} min={-10} max={10} step={0.01} reg="REG_W_INIT" />
            <ParamControl {...lab(String.raw`步數 $N$`, '步數 N')} unit="samples" value={shared.steps} onChange={(v) => setS('steps', v)} min={10} max={20000} integer clampOnBlur reg="sim length（samples）" />
            <ParamControl label="MC seeds 數" unit="seeds" value={shared.runs} onChange={(v) => setS('runs', v)} min={4} max={256} integer clampOnBlur reg="Monte Carlo runs" hint={effRuns < shared.runs ? `為控制計算量，實際使用 ${effRuns}` : undefined} />
            <SelectControl
              {...lab(String.raw`$|\delta|$ 的參考點`, '|δ| 的參考點')}
              value={shared.deltaRef}
              onChange={(v) => setS('deltaRef', v)}
              options={[
                { value: 'a', label: '|a − w_n|（真實係數）' },
                { value: 'wstar', label: '|w*_algo − w_n|（各自的固定點）' },
              ]}
            />
          </fieldset>
          <CaseSelector cases={cases} />
          <fieldset className="ch02-controls-group">
            <legend>Case {cases.activeId} 的參數</legend>
            <ParamControl {...lab(String.raw`$\mu$（步長）`, 'μ（步長）')} unit="依演算法" value={active.mu} onChange={(v) => set('mu', v)} min={1e-5} max={2} log reg="REG_LMS_MU（shift）" />
            <SelectControl
              label="步長對齊方式"
              value={active.stepMatch}
              onChange={(v) => set('stepMatch', v)}
              options={[
                { value: 'same-mu', label: 'same-mu：同一個 μ（規格 §2.3 的比較法）' },
                { value: 'same-speed', label: 'same-speed：同收斂速度（公平比較精度）' },
              ]}
              reg="behavioural: step normalisation"
            />
            <SelectControl {...lab(String.raw`$x$ 的分布`, 'x 的分布')} value={active.xKind} onChange={(v) => set('xKind', v)} options={X_KINDS.map((k) => ({ value: k, label: X_KIND_LABEL[k] }))} reg="behavioural: DSM/code distribution" />
            <ParamControl {...lab(String.raw`$x$ 的幅度 $A$`, 'x 幅度 A')} unit="無因次" value={active.xAmp} onChange={(v) => set('xAmp', v)} min={0} max={4} step={0.01} reg="behavioural: code scale" />
            <SelectControl label="雜訊形狀" value={active.noiseKind} onChange={(v) => set('noiseKind', v)} options={NOISE_KINDS.map((k) => ({ value: k, label: NOISE_KIND_LABEL[k] }))} reg="behavioural: comparator-input noise pdf" />
            <ParamControl {...lab(String.raw`$\sigma_v$（雜訊標準差）`, 'σ（雜訊標準差）')} unit="同 $y$" value={active.sigma} onChange={(v) => set('sigma', v)} min={0} max={5} step={0.01} reg="behavioural: sigma_v" />
            <ParamControl {...lab(String.raw`outlier 機率 $p_{\rm out}$`, 'outlier 機率 p_out')} unit="機率" value={active.outlierProb} onChange={(v) => set('outlierProb', v)} min={0} max={0.5} step={0.001} reg="behavioural: impulsive disturbance rate" />
            <ParamControl {...lab(String.raw`outlier 大小 $s$（單邊，加在 $v$ 上）`, 'outlier 大小 s（單邊，加在 v 上）')} unit="同 $y$" value={active.outlierSize} onChange={(v) => set('outlierSize', v)} min={-50} max={50} step={0.1} reg="behavioural: disturbance size" />
            <SelectControl {...lab(String.raw`$\operatorname{sign}(0)$ 慣例`, 'sign(0) 慣例')} value={active.tie} onChange={(v) => set('tie', v)} options={TIES.map((t) => ({ value: t, label: TIE_LABEL[t] }))} reg="CMP_TIE_POLICY（behavioural）" />
            <SelectControl label="步長排程" value={active.schedule} onChange={(v) => set('schedule', v)} options={SCHEDULES.map((s) => ({ value: s, label: SCHEDULE_LABEL[s] }))} reg="REG_MU_SCHED（gear-shift FSM）" />
            <ParamControl {...lab(String.raw`$n_0$（排程時間常數）`, 'n₀（排程時間常數）')} unit="samples" value={active.n0} onChange={(v) => set('n0', v)} min={1} max={100000} log integer clampOnBlur reg="REG_MU_GEAR_LEN" />
            <ParamControl {...lab(String.raw`$\delta_{\rm H}$（Huber 門檻）`, 'δₕ（Huber 門檻）')} unit="同 $y$" value={active.huberDelta} onChange={(v) => set('huberDelta', v)} min={0.01} max={10} log reg="REG_ERR_CLIP" />
            <ParamControl {...lab(String.raw`NLMS 的 $\varepsilon$`, 'NLMS ε')} unit="$[x]^2$" value={active.nlmsEps} onChange={(v) => set('nlmsEps', v)} min={0} max={10} step={0.001} reg="behavioural: nlms_eps" />
          </fieldset>
        </>
      }
    >
      {frozen && (
        <Callout kind="info" title="已凍結 Frozen">
          圖表與表格停在按下「凍結」當時的參數（seed {frozen.seed}、{frozen.caseIds.length} 個 Case）。現在調整控制項不會重算；再按一次「凍結」解除後才更新。
        </Callout>
      )}
      <Plot title={`$w_n$（Case ${cases.activeId}，seed ${seed}）`} data={wData} height={300} csvName="sign-lms-compare-w" layout={{ xaxis: { title: { text: '$n$（sample）' } }, yaxis: { title: { text: '$w_n$' } } }} />
      <Plot
        title={String.raw`$|\delta_n|$（單一 seed、所有 Case；log）`}
        data={dData}
        yLog
        height={300}
        csvName="sign-lms-compare-delta"
        caption="顏色 = 演算法；線型：Case A 實線、B 虛線、C 點線"
        layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: dShared.deltaRef === 'a' ? String.raw`$|a-w_n|$` : String.raw`$|w^*-w_n|$` } } }}
      />
      <Plot
        title={String.raw`Monte Carlo：$|a-w_n|$ 的中位數與 10–90% 帶（Case ${cases.activeId}）`}
        data={mcData}
        xLog
        yLog
        height={280}
        csvName="sign-lms-compare-mc"
        caption={mc.pending ? 'Worker 計算中…' : mcRes ? String.raw`${effRuns} seeds；勘誤 E14：畫中位數與分位數，而不是 $E[\delta^2]$ 的樣本平均（會被少數重尾路徑主導）` : mc.error ?? ''}
        layout={{ xaxis: { title: { text: '$n$（log）' } }, yaxis: { title: { text: String.raw`$|a-w_n|$` } } }}
      />
      <div className="table-wrap">
        <table className="ch02-table">
          <caption className="ch02-note">最終 bias / std（Monte Carlo，{effRuns} seeds；mean-field 欄為解析值）{mc.pending ? '——計算中…' : ''}</caption>
          <thead>
            <tr>
              <th>Case</th>
              <th>演算法</th>
              <th className="num">
                實際步長 <Tex>{'\\mu_{\\rm algo}'}</Tex>
              </th>
              <th className="num">
                <Tex>{'w^*'}</Tex>（mean-field）
              </th>
              <th className="num">
                <Tex>{'E[w_N]-a'}</Tex>（MC <Tex>{'\\pm'}</Tex> 95%）
              </th>
              <th className="num">
                <Tex>{'\\operatorname{std}(w_N)'}</Tex>（MC）
              </th>
              <th className="num">穩態 std（MC 後半段）</th>
              <th className="num">穩態 std（預測）</th>
              <th className="num">
                <Tex>{'\\tau'}</Tex>（步）
              </th>
              <th>
                <Tex>{'w^*'}</Tex> 與 MC 一致？
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ci, a, st, ok, c, reason }) => (
              <tr key={`${ci}-${a.algo}`} className={ci === activeIdx ? 'hl' : undefined}>
                <td>{caseIds[ci]}</td>
                <td>{ALGO_LABEL[a.algo]}</td>
                <td className="num">{f4(a.mu)}</td>
                <td className="num">{a.mf.identifiable ? f4(a.mf.wStar, 5) : '不可辨識'}</td>
                <td className="num">{st ? (st.n ? tm(String.raw`${f4(st.finalMean - c.a, 3)} $\pm$ ${f4(st.finalHalf, 2)}`) : '發散') : '…'}</td>
                <td className="num">{st && st.n ? f4(st.finalStd, 3) : '…'}</td>
                <td className="num">{st && st.n ? f4(st.tavgStd, 3) : '…'}</td>
                <td className="num">{c.schedule !== 'constant' ? '—（遞減步長）' : a.mf.deterministic && (a.algo === 'sign_error' || a.algo === 'sign_sign') ? tm(limitCycleLabel(a.algo, a.mu, c)) : a.pred.stable ? f4(a.pred.std, 3) : tm(unstableLabel(a.algo))}</td>
                <td className="num">{Number.isFinite(a.pred.tau) ? f4(a.pred.tau, 3) : '—'}</td>
                <td title={reason ? stripMathDelimiters(reason) : undefined}>{ok === null ? (reason && st ? '未比較（原因見上方交叉比對）' : '—') : ok ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {differ.length > 0 && (
        <Callout kind="warn" title={`Case ${cases.activeId}：固定點不同`}>
          {differ.map((x) => `${ALGO_LABEL[x.algo]}：${f4(x.mf.wStar, 5)}`).join('；')}；LMS：{f4(lmsStar ?? NaN, 5)}。
          判斷法（F-02.18）：在 <Tex>{'w=a'}</Tex> 處 <Tex>{'e=v'}</Tex> 與 <Tex>{'x'}</Tex> 獨立，所以
          <Tex>{String.raw`\psi_{\rm LMS}(a)=E[v]E[x],\ \psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x],\ \psi_{\rm SS}(a)=E[\operatorname{sign}v]\,E[\operatorname{sign}x]`}</Tex>。
          只看平均的 LMS 與看中位數的 sign 類演算法，在雜訊的平均與中位數不同（偏斜或單邊 outlier）且 <Tex>{'E[x]\\neq0'}</Tex> 時才會分開。
        </Callout>
      )}
      {detSign && (
        <Callout kind="info" title="無雜訊：sign 演算法是確定性的 limit cycle">
          沒有雜訊時 Sign-Error 每步移動 <Tex>{'\\mu|x_n|'}</Tex>、Sign-Sign 每步移動 <Tex>{'\\mu'}</Tex>，到達 <Tex>{'a'}</Tex> 附近後在 <Tex>{'\\pm'}</Tex> 一步的帶內來回跳，
          線性化的「穩態 std」公式不適用（表中改列帶寬）。tie 慣例與浮點捨入會改變跳動的位置（勘誤 E40）。
        </Callout>
      )}
      <ul className="ch02-try">
        <li>載入「同收斂速度：Gaussian / Laplacian / impulsive」preset：Gaussian 下 LMS 的穩態 std 最小；換成 Laplacian 或 impulsive，Sign-Error 反而更準（中位數 vs 平均）。</li>
        <li>
          載入「limit cycle」preset：LMS 以 <Tex>{'p=1-\\mu x^2=0.6'}</Tex> 指數收斂；Sign-Error 停在 <Tex>{'2.8\\leftrightarrow3.2'}</Tex> 跳動。
        </li>
        <li>
          載入「單邊 outlier」preset：<Tex>{'x\\equiv1'}</Tex> 時 LMS 被拉到 <Tex>{'a+p\\,s'}</Tex>，Sign-Error 幾乎不動，Huber 介於兩者。
        </li>
      </ul>
    </ExperimentShell>
  )
}

/** 無雜訊時 sign 演算法的跳動帶：Sign-Error 每步 μ|x_n|，Sign-Sign 每步 μ（與 x 的幅度無關）。回傳含 `$...$` 的字串（用 tm() 顯示）。 */
export function limitCycleLabel(algo: AlgoId, mu: number, c: CaseConfig): string {
  if (algo === 'sign_sign') return String.raw`limit cycle（每步 $\pm${tn(mu)}$）`
  const fixedAmp = c.xKind === 'const' || c.xKind === 'bpsk'
  return fixedAmp ? String.raw`limit cycle（每步 $\pm${tn(mu * Math.abs(c.xAmp))}$）` : 'limit cycle（每步大小隨 $|x|$ 變）'
}

/** 線性化 pole 不穩定（μK ≥ 2）時的說明：LMS / NLMS 真的發散；sign / Huber 類的單步更新有界，只是線性化失效。回傳含 `$...$` 的字串。 */
export function unstableLabel(algo: AlgoId): string {
  return algo === 'lms' || algo === 'nlms' ? String.raw`$\infty$（不穩定）` : String.raw`—（$\mu K\ge2$：線性化失效，有界的大幅跳動）`
}

/** '#rrggbb' → rgba（Plotly 填色用）；其他格式原樣回傳 */
function hexAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return c
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}
