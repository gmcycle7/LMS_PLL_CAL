import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout, Shape } from 'plotly.js-cartesian-dist-min'
import {
  CaseSelector,
  ClaimTag,
  ExperimentShell,
  ParamControl,
  Plot,
  Tex,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CaseId,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  analyticCrossCheck,
  analyticTrajectory,
  boundCurves,
  cltConvergedFraction,
  cltLog10Quantile,
  hillEstimator,
  KESTEN_S_MAX,
  kestenTailExponent,
  logFactorVariance,
  MC_LIMITS,
  recordIndices,
  stabilityBounds,
  stabilityFactors,
  xMoments,
  type StabilityMcParams,
  type StabilityMcResult,
  type XDist,
} from '@/simulation/models/scalarStability'
import { finiteOrNull, logGrid, mergeParams, num, T, texText, tnum, tx, Verdict } from '../common'
import { DEFAULT_DIST_FIELDS, DistControls, distSummary, distSummaryTex, toXDist, type DistFields } from './DistControls'

export const LAB_EXPERIMENT = 'stability-lab'

export interface LabParams extends DistFields {
  /** 學習率 μ（單位 1/[x]²） */
  mu: number
  /** 初始誤差 δ_0 = a − w_0 */
  delta0: number
  /** Monte Carlo 路徑數 */
  paths: number
  /** 迭代步數 N */
  steps: number
  /** 量測雜訊 σ_v（0 = 關閉） */
  noiseSigma: number
}

// 圖內文字的數學一律寫 `$…$`（Plot 轉成斜體符號與上下標）
const FRAC_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '比例' }, range: [0, 1.02] } }
const CASES_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: T`$\log_{10}$` } } }
const MEAN_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: T`$E[\delta_n]$` }, zeroline: true } }

export const DEFAULT_LAB: LabParams = { ...DEFAULT_DIST_FIELDS, mu: 0.8, delta0: 1, paths: 2000, steps: 200, noiseSigma: 0 }

/** 將 #rrggbb / #rgb 轉成 rgba（Plotly 的半透明填色）；其他格式原樣回傳 */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const v = parseInt(h, 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}

/** ±4 SE，另加 1e−9 相對下限（SE = 0 的退化分布） */
function tol4(se: number, ref: number): number {
  return 4 * (Number.isFinite(se) ? se : 0) + 1e-9 * Math.max(1, Math.abs(ref))
}

function mcParams(p: LabParams, dist: XDist, seed: number): StabilityMcParams {
  return {
    mu: p.mu,
    dist,
    delta0: p.delta0,
    steps: p.steps,
    paths: p.paths,
    seed,
    noiseSigma: p.noiseSigma,
    keepPaths: 5,
    oneStepSamples: 200000,
    maxRecords: 401,
  }
}

interface CaseAnalytic {
  dist: XDist
  m: ReturnType<typeof xMoments>
  b: ReturnType<typeof stabilityBounds>
  f: ReturnType<typeof stabilityFactors>
  kt: number
  /** s = √Var(ln|1 − μx²|)：log 域每步增量的標準差（CLT 預測用；λ = −∞ 時為 NaN） */
  sd: number
}

function analyzeCase(p: LabParams): { a: CaseAnalytic | null; error: string | null } {
  const { dist, error } = toXDist(p)
  if (!dist) return { a: null, error }
  const m = xMoments(dist)
  const b = stabilityBounds(dist)
  const f = stabilityFactors(p.mu, dist)
  const kt = p.noiseSigma > 0 && m.Px > 0 ? kestenTailExponent(p.mu, dist) : NaN
  const sd = m.Px > 0 ? Math.sqrt(logFactorVariance(p.mu, dist)) : NaN
  return { a: { dist, m, b, f, kt, sd }, error: null }
}

/** 解釋失穩原因的警告（ExperimentShell 以 danger callout 顯示） */
function caseWarnings(id: CaseId, p: LabParams, a: CaseAnalytic | null, error: string | null, r: StabilityMcResult | undefined): string[] {
  const tag = `Case ${id}：`
  // 字串中的數學以 `$…$` 標示（ExperimentShell 以 KaTeX 顯示）；數字用 tnum（ASCII 負號、科學記號寫成 a×10^b）
  if (!a) return [String.raw`${tag}$x$ 分布參數錯誤：${error ?? '未知錯誤'}（此 case 不執行）`]
  const out: string[] = []
  if (!(a.m.Px > 0)) {
    out.push(String.raw`${tag}$P_x = E[x^2] = 0$：$x$ 恆為 0，$w$ 永遠不更新，$a$ 不可辨識（沒有 persistent excitation），任何 $\mu$ 都不會收斂。`)
    return out
  }
  if (p.paths * p.steps > MC_LIMITS.maxWork) out.push(String.raw`${tag}路徑數與步數的乘積 $${tnum(p.paths * p.steps, 6)}$ 超過上限 $${tnum(MC_LIMITS.maxWork)}$：為了瀏覽器反應速度不執行 Monte Carlo（解析曲線仍有效）。`)
  if (p.mu <= 0) out.push(String.raw`${tag}$\mu \le 0$：更新方向錯誤（極性反轉）或不更新；$1-\mu x^2 \ge 1$，三種意義下都不收斂。`)
  else {
    if (Math.abs(a.f.meanPole) >= 1)
      out.push(
        String.raw`${tag}$|1-\mu P_x| = ${tnum(Math.abs(a.f.meanPole))} \ge 1$：mean 發散（$\mu \ge 2/P_x = ${tnum(a.b.meanMax)}$），$E[\delta_n] = (1-\mu P_x)^n\delta_0$ ${a.f.meanPole < 0 ? '正負交替地' : ''}變大。`,
      )
    if (a.f.g >= 1)
      out.push(
        String.raw`${tag}$g(\mu) = ${tnum(a.f.g)} \ge 1$：係數均方偏差 $\text{MSD} = E[\delta^2]$ 發散（$\mu \ge 2P_x/M_4 = ${tnum(a.b.msMax)}$）。${a.f.lambda < 0 ? String.raw`但 $\lambda(\mu) < 0$，幾乎每條路徑仍收斂——$E[\delta^2]$ 被機率極小的巨大路徑主導（勘誤 E14），這不是程式錯誤。` : ''}${p.noiseSigma > 0 ? '有雜訊時穩態 MSD 為無限大。' : ''}`,
      )
    if (a.f.lambda >= 0)
      out.push(
        String.raw`${tag}$\lambda(\mu) = E\ln|1-\mu x^2| = ${tnum(a.f.lambda)} \ge 0$：almost-sure 發散，典型路徑以 $e^{n\lambda}$ 變大（$\mu \ge \mu_\text{as} \approx ${tnum(a.b.asMax)}$）。`,
      )
  }
  if (p.delta0 === 0 && p.noiseSigma === 0)
    out.push(String.raw`${tag}$\delta_0 = 0$ 且 $\sigma_v = 0$：$\delta_n \equiv 0$，看不到任何動態（請設定 $\delta_0 \ne 0$ 或開啟雜訊）。`)
  if (r && r.overflowPaths > 0)
    out.push(String.raw`${tag}${r.overflowPaths} 條路徑在線性域 overflow（$|\delta| > 1.8\times10^{308}$），已視為 $+\infty$ 計入分位數。`)
  return out
}

export function StabilityLab() {
  const tokens = useThemeTokens()
  const cases = useCases<LabParams>(DEFAULT_LAB, { seed: 20261010 })
  const presets = useMemo(() => presetsForExperiment(LAB_EXPERIMENT), [])
  const urlPreset = useUrlPreset(LAB_EXPERIMENT)
  const { reset } = cases
  useEffect(() => {
    if (urlPreset) reset(mergeParams(DEFAULT_LAB, urlPreset.params))
  }, [urlPreset, reset])

  const analyzed = useMemo(() => cases.cases.map((c) => ({ c, ...analyzeCase(c.params) })), [cases.cases])
  const request = useMemo(() => {
    const list = analyzed
      .filter((x) => x.a && x.a.m.Px > 0 && x.c.params.paths * x.c.params.steps <= MC_LIMITS.maxWork)
      .map((x) => ({ id: x.c.id, p: mcParams(x.c.params, x.a!.dist, cases.seed) }))
    return list.length ? list : null
  }, [analyzed, cases.seed])
  const debounced = useDebouncedValue(request, 300)
  const reqKey = JSON.stringify(request)
  const task = useWorkerTask<{ cases: StabilityMcParams[] }, { results: StabilityMcResult[] }>('scalarStability', 'runStabilityMcCases', { restartOnRun: true })
  const [out, setOut] = useState<{ key: string; byId: Partial<Record<CaseId, StabilityMcResult>>; keyById: Partial<Record<CaseId, string>> } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)
  // Freeze：undefined = 未凍結（參數一變就自動重跑）；否則為凍結時保留的請求（只有按「執行 Run」才以目前參數重跑一次）
  const [held, setHeld] = useState<typeof request | undefined>(undefined)
  const frozen = held !== undefined
  const target = frozen ? held : debounced
  const [note, setNote] = useState<string | null>(null)
  const doneRef = useRef<{ key: string; token: number } | null>(null)
  const { run } = task
  useEffect(() => {
    if (!target) return
    const key = JSON.stringify(target)
    // 同一組參數、同一次「執行」已經算過：不重跑（例如解除凍結時參數其實沒變）
    if (doneRef.current && doneRef.current.key === key && doneRef.current.token === runToken) return
    let alive = true
    run({ cases: target.map((d) => d.p) }).then(
      (res) => {
        if (!alive) return
        const byId: Partial<Record<CaseId, StabilityMcResult>> = {}
        const keyById: Partial<Record<CaseId, string>> = {}
        target.forEach((d, i) => {
          byId[d.id] = res.results[i]
          keyById[d.id] = JSON.stringify(d.p)
        })
        doneRef.current = { key, token: runToken }
        setOut({ key, byId, keyById })
        setRunError(null)
      },
      (e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setRunError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [target, run, runToken])
  const stale = out !== null && out.key !== reqKey

  const active = analyzed.find((x) => x.c.id === cases.activeId) ?? analyzed[0]
  const ap = active.c.params
  const A = active.a
  const res = out?.byId[active.c.id]
  // 結果是否對應「目前」的參數（否則顯示舊結果並標示更新中）
  const currentKey = request?.find((d) => d.id === active.c.id)
  const resMatches = !!res && !!currentKey && out?.keyById[active.c.id] === JSON.stringify(currentKey.p)

  // 解析軌跡（與 MC 同一組時間點）
  const nGrid = useMemo(() => (resMatches && res ? res.n : recordIndices(ap.steps)), [res, resMatches, ap.steps])
  const traj = useMemo(
    () => (A ? analyticTrajectory({ mu: ap.mu, dist: A.dist, delta0: ap.delta0, noiseSigma: ap.noiseSigma }, nGrid) : null),
    [A, ap.mu, ap.delta0, ap.noiseSigma, nGrid],
  )

  // μ 軸三條每步因子
  const muCurves = useMemo(() => {
    if (!A || !(A.m.Px > 0)) return null
    const P = A.m.Px
    const hiCandidates = [6 / P, 1.4 * Math.max(ap.mu, 0)]
    if (Number.isFinite(A.b.asMax) && A.b.asMax < 60 / P) hiCandidates.push(1.3 * A.b.asMax)
    const lo = Math.min(0.003 / P, ap.mu > 0 ? ap.mu / 2 : Infinity)
    const grid = logGrid(lo, Math.max(...hiCandidates), 240)
    return boundCurves(A.dist, grid)
  }, [A, ap.mu])

  // Analytic 交叉比對：封閉式 vs 獨立的數值積分（g、h）；λ 的兩種算法（Gaussian：Dawson vs lms.ts；Uniform：封閉式 vs 積分）
  const xc = useMemo(() => (A && A.m.Px > 0 ? analyticCrossCheck(ap.mu, A.dist) : null), [A, ap.mu])
  const analyticCheck = xc
    ? {
        status: xc.ok ? ('ok' as const) : ('mismatch' as const),
        // lambdaAltMethod 是模型給的純文字（唯一含數學的是「μ ≤ 0」那一句）
        note: String.raw`$g$、$h$：動差封閉式 vs 數值積分（相對差 $${tnum(Math.max(xc.gRelDev, xc.hRelDev), 2)}$）；$\lambda$：${xc.lambdaAltMethod.replace('μ ≤ 0', String.raw`$\mu \le 0$`)}${xc.lambdaAlt !== null ? String.raw`（$|\Delta| = ${tnum(xc.lambdaDev, 2)}$）` : ''}`,
      }
    : { status: 'n/a' as const, note: A ? '$P_x = 0$：沒有可比對的解析量' : '$x$ 分布參數錯誤' }

  const warnings = [
    ...analyzed.flatMap((x) => caseWarnings(x.c.id, x.c.params, x.a, x.error, out?.byId[x.c.id])),
    ...(runError ? [`Monte Carlo 錯誤：${runError}`] : []),
  ]

  // ── Monte Carlo 與解析的交叉比對（勘誤 E14：用單步 MC，不用長時間 δ² 平均）
  const os = resMatches ? res!.oneStep : null
  const mcCheck = (() => {
    if (!A || !os) return { status: 'n/a' as const, note: task.running ? '執行中…' : '尚未執行' }
    // 固定 x / ±A 時 SE = 0，另加 1e−9 的相對下限以容忍累加的浮點誤差
    const okMean = Math.abs(os.meanFactor - A.f.meanPole) <= tol4(os.meanFactorSe, A.f.meanPole)
    const okG = Math.abs(os.g - A.f.g) <= tol4(os.gSe, A.f.g)
    const okL = !Number.isFinite(A.f.lambda) || !Number.isFinite(os.lambda) || Math.abs(os.lambda - A.f.lambda) <= tol4(os.lambdaSe, A.f.lambda)
    return {
      status: okMean && okG && okL ? ('ok' as const) : ('mismatch' as const),
      note: String.raw`單步 MC（${os.samples} 樣本）：$E[f]$ ${okMean ? '✓' : '✗'}、$E[f^2]$ ${okG ? '✓' : '✗'}、$E\ln|f|$ ${okL ? '✓' : '✗'}（$\pm4$ SE）`,
    }
  })()

  const finalIdx = res ? res.n.length - 1 : -1
  // CLT 預測（F-03.18）：只在無雜訊、δ₀ ≠ 0、s 有定義時成立
  const cltOk = !!A && ap.noiseSigma === 0 && ap.delta0 !== 0 && Number.isFinite(A.sd) && Number.isFinite(A.f.lambda)
  const cltFrac = cltOk && A ? cltConvergedFraction(A.f.lambda, A.sd, ap.steps, 1e-3) : null
  const hill = res && resMatches && ap.noiseSigma > 0 ? hillEstimator(res.finalLog10, Math.max(20, Math.floor(res.finalLog10.length / 50))) : NaN
  const metrics: MetricRow[] = A
    ? [
        { name: '$P_x = E[x^2]$', value: A.m.Px, claim: 'exact', formulaId: 'F-03.5' },
        { name: '$M_4 = E[x^4]$', value: A.m.M4, claim: 'exact', formulaId: 'F-03.6' },
        { name: String.raw`kurtosis $\kappa = M_4/P_x^2$`, value: A.m.kurtosis, claim: 'exact', formulaId: 'F-03.7' },
        {
          name: String.raw`mean 因子 $1-\mu P_x$`,
          value: os ? os.meanFactor : null,
          analytic: A.f.meanPole,
          tolerance: os ? tol4(os.meanFactorSe, A.f.meanPole) : undefined,
          claim: 'exact',
          formulaId: 'F-03.5',
          note: '值 = 單步 MC；解析值見右欄',
        },
        {
          name: String.raw`MSD 因子 $g(\mu) = E[(1-\mu x^2)^2]$`,
          value: os ? os.g : null,
          analytic: A.f.g,
          tolerance: os ? tol4(os.gSe, A.f.g) : undefined,
          claim: 'exact',
          formulaId: 'F-03.6',
          note: '單步 MC（T03 建議的驗證法，勘誤 E14）',
        },
        {
          name: String.raw`Lyapunov $\lambda(\mu)$：單步 MC`,
          value: os ? os.lambda : null,
          analytic: A.f.lambda,
          tolerance: os && Number.isFinite(os.lambda) ? tol4(os.lambdaSe, A.f.lambda) : undefined,
          claim: 'exact',
          formulaId: 'F-03.9',
        },
        {
          name: String.raw`$s = \sqrt{\operatorname{Var}(\ln|1-\mu x^2|)}$：單步 MC 的樣本標準差`,
          value: os && Number.isFinite(os.lambdaSe) ? os.lambdaSe * Math.sqrt(os.samples) : null,
          analytic: Number.isFinite(A.sd) ? A.sd : undefined,
          tolerance: os && Number.isFinite(os.lambdaSe) && Number.isFinite(A.sd) ? 0.03 * A.sd + 1e-9 : undefined,
          claim: 'exact',
          formulaId: 'F-03.18',
          note: String.raw`解析值為數值積分；log 域每步增量的標準差（分位帶寬度 $\propto s\sqrt n$）。容許 3%（樣本標準差的抽樣誤差）`,
        },
        ...(ap.noiseSigma === 0 && res && resMatches
          ? [
              {
                name: String.raw`Lyapunov $\hat\lambda$：樣本路徑斜率 $\ln|\delta_N/\delta_0|/N$`,
                value: res.lyapunovHat,
                analytic: A.f.lambda,
                tolerance: Number.isFinite(res.lyapunovHat) ? tol4(res.lyapunovSe, A.f.lambda) : undefined,
                claim: 'exact' as const,
                formulaId: 'F-03.9',
                note: String.raw`大數法則：每條路徑的平均對數斜率 $\to\lambda$`,
              },
            ]
          : []),
        { name: 'mean 界 $2/P_x$', value: A.b.meanMax, claim: 'exact', formulaId: 'F-03.5' },
        { name: 'mean-square 界 $2P_x/M_4$', value: A.b.msMax, claim: 'exact', formulaId: 'F-03.7' },
        { name: String.raw`almost-sure 界 $\mu_\text{as}$（第一個 $\lambda = 0$）`, value: A.b.asMax, claim: 'exact', formulaId: 'F-03.9', note: A.b.asCrossings.length > 1 ? String.raw`$\lambda$ 共有 ${A.b.asCrossings.length} 個變號點：a.s. 穩定集合不是單一區間` : undefined },
        ...(res && resMatches
          ? [
              { name: String.raw`MC 中位數 $\log_{10}|\delta_N|$`, value: res.q50[finalIdx], note: `$N = ${ap.steps}$、${ap.paths} 條路徑` },
              {
                name: String.raw`$P(|\delta_N| < 10^{-3}|\delta_0|)$：MC 收斂比例`,
                value: res.fracConverged[finalIdx],
                ...(cltFrac !== null ? { analytic: cltFrac, tolerance: 0.05, claim: 'approx' as const, formulaId: 'F-03.18' } : {}),
                note:
                  cltFrac !== null
                    ? String.raw`解析欄 = CLT 預測 $\Phi\big((\ln10^{-3} - N\lambda)/(s\sqrt N)\big)$（近似；$N$ 小或路徑少時可差幾個 %）。參考：Gaussian、$\mu = 2$、$N = 200$ 約 83%（勘誤 E14）`
                    : String.raw`收斂比例（有雜訊，或 $\lambda = -\infty$ 時沒有 CLT 預測）`,
              },
            ]
          : []),
        ...(ap.noiseSigma > 0
          ? [
              { name: String.raw`穩態 $\text{MSD}_\infty$（解析）`, value: traj ? traj.msdInf : NaN, claim: 'exact' as const, formulaId: 'F-03.11', note: String.raw`$g \ge 1$ 時為 $\infty$` },
              { name: String.raw`穩態 $\text{MSE}_\infty = P_x\,\text{MSD}_\infty + \sigma_v^2$`, value: traj ? traj.mseInf : NaN, claim: 'exact' as const, formulaId: 'F-03.11' },
              {
                name: String.raw`Kesten 尾指數 $\kappa_t$`,
                value: A.kt,
                claim: 'research' as const,
                formulaId: 'F-03.17',
                note:
                  A.kt === Infinity
                    ? String.raw`$E|1-\mu x^2|^{s} = 1$ 在 $s \le ${KESTEN_S_MAX}$ 內沒有根：$|1-\mu x^2| \le 1$ 恆成立（沒有冪次尾），或 $\kappa_t > ${KESTEN_S_MAX}$（實務上看不到 heavy tail）`
                    : A.kt === 0
                      ? String.raw`$\lambda \ge 0$：路徑發散，沒有穩態分布`
                      : String.raw`$\kappa_t \le 2 \iff$ 穩態變異數無限大`,
              },
              { name: String.raw`Hill 估計 $\hat\kappa_t$（MC 最後一步）`, value: hill, claim: 'approx' as const, note: String.raw`取最大 2% 的 $|\delta|$；需路徑數多且已到穩態` },
            ]
          : []),
      ]
    : []

  // ── 圖 1：log10|δ_n|
  const mainData = useMemo<Data[]>(() => {
    const d: Data[] = []
    const c0 = tokens.series[0]
    if (res && resMatches) {
      const n = Array.from(res.n)
      d.push({ x: n, y: finiteOrNull(res.q90), mode: 'lines', line: { width: 0, color: c0 }, name: 'MC 90%', showlegend: false, hoverinfo: 'skip' })
      d.push({
        x: n,
        y: finiteOrNull(res.q10),
        mode: 'lines',
        line: { width: 0, color: c0 },
        fill: 'tonexty',
        fillcolor: withAlpha(c0, 0.18),
        name: T`MC $|\delta_n|$ 10–90% 分位帶`,
      })
      d.push({ x: n, y: finiteOrNull(res.q50), mode: 'lines', line: { width: 2.5, color: c0 }, name: T`MC 中位數 $\log_{10}|\delta_n|$` })
      const R = res.n.length
      for (let k = 0; k < res.keepPaths; k++) {
        d.push({
          x: n,
          y: finiteOrNull(res.sample.subarray(k * R, (k + 1) * R)),
          mode: 'lines',
          line: { width: 1, color: withAlpha(c0, 0.45) },
          name: '個別樣本路徑',
          legendgroup: 'paths',
          showlegend: k === 0,
        })
      }
      d.push({
        x: n,
        y: finiteOrNull(res.naiveLog10Rms),
        mode: 'lines',
        line: { width: 1.5, color: tokens.series[4], dash: 'dashdot' },
        name: T`天真 MC：$\frac{1}{2}\,\log_{10}$(樣本平均 $\delta^2$)（heavy tail，不可信）`,
      })
    }
    if (traj) {
      const n = Array.from(nGrid)
      d.push({ x: n, y: finiteOrNull(traj.log10Rms), mode: 'lines', line: { width: 2.5, color: tokens.series[1] }, name: T`解析 $\frac{1}{2}\,\log_{10}E[\delta_n^2]$（MSD 的 RMS）` })
      d.push({ x: n, y: finiteOrNull(traj.log10AbsMean), mode: 'lines', line: { width: 2, color: tokens.series[2], dash: 'dash' }, name: T`解析 $\log_{10}|E[\delta_n]|$（mean）` })
      if (ap.noiseSigma === 0) {
        d.push({ x: n, y: finiteOrNull(traj.log10Typical), mode: 'lines', line: { width: 2, color: tokens.series[3], dash: 'dot' }, name: T`典型路徑 $\log_{10}|\delta_0| + n\lambda/\ln 10$（a.s.）` })
        if (A && cltOk && A.sd > 0) {
          const l0 = Math.log10(Math.abs(ap.delta0))
          for (const [q, show] of [
            [0.1, true],
            [0.9, false],
          ] as const) {
            d.push({
              x: n,
              y: n.map((k) => l0 + cltLog10Quantile(A.f.lambda, A.sd, k, q)),
              mode: 'lines',
              line: { width: 1.2, color: tokens.textMuted, dash: 'dot' },
              name: 'CLT 預測的 10% / 90% 分位（近似）',
              legendgroup: 'clt',
              showlegend: show,
            })
          }
        }
      }
      else if (Number.isFinite(traj.msdInf))
        d.push({
          x: [0, ap.steps],
          y: [0.5 * Math.log10(traj.msdInf), 0.5 * Math.log10(traj.msdInf)],
          mode: 'lines',
          line: { width: 1.5, color: tokens.series[5], dash: 'longdash' },
          name: T`穩態 $\sqrt{\text{MSD}_\infty}$（解析）`,
        })
    }
    return d
  }, [res, resMatches, traj, nGrid, tokens, ap.noiseSigma, ap.steps, ap.delta0, A, cltOk])
  const mainLayout = useMemo<Partial<Layout>>(() => ({ xaxis: { title: { text: '$n$（sample）' } }, yaxis: { title: { text: T`$\log_{10}$ of $|\delta_n|$、$\sqrt{E[\delta_n^2]}$、$|E[\delta_n]|$` } } }), [])

  // ── 圖 2：μ 軸三種判據
  const muData = useMemo<Data[]>(() => {
    if (!muCurves || !A) return []
    const mu = Array.from(muCurves.mu)
    const pos = (a: Float64Array) => Array.from(a, (v) => (v > 0 && Number.isFinite(v) ? v : null))
    const marks = [
      { x: A.b.meanMax, t: `mean ${num(A.b.meanMax, 4)}` },
      { x: A.b.msMax, t: `MS ${num(A.b.msMax, 4)}` },
      { x: A.b.asMax, t: `a.s. ${num(A.b.asMax, 4)}` },
    ].filter((m) => Number.isFinite(m.x))
    return [
      { x: mu, y: pos(muCurves.meanAbs), mode: 'lines', line: { color: tokens.series[2], width: 2 }, name: T`mean：$|1 - \mu P_x|$` },
      { x: mu, y: pos(muCurves.g), mode: 'lines', line: { color: tokens.series[1], width: 2 }, name: T`mean-square：$g(\mu)$` },
      { x: mu, y: pos(muCurves.geo), mode: 'lines', line: { color: tokens.series[0], width: 2 }, name: T`almost-sure：$e^{\lambda(\mu)}$` },
      { x: [mu[0], mu[mu.length - 1]], y: [1, 1], mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1.5 }, name: '門檻 $= 1$' },
      ...(ap.mu > 0
        ? [{ x: [ap.mu, ap.mu], y: [10 ** -2.5, 10 ** 1.5], mode: 'lines', line: { color: tokens.text, width: 2, dash: 'dot' }, name: T`目前 $\mu = ${tnum(ap.mu, 4)}$` } as Data]
        : []),
      {
        x: marks.map((m) => m.x),
        y: marks.map(() => 1),
        text: marks.map((m) => m.t),
        mode: 'text+markers',
        textposition: 'top center',
        marker: { size: 9, color: tokens.text, symbol: 'diamond' },
        textfont: { color: tokens.text, size: 11 },
        name: '三個界限',
      } as Data,
    ]
  }, [muCurves, A, tokens, ap.mu])
  const muLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: T`$\mu$（log）` }, type: 'log' }, yaxis: { title: { text: '每步因子（log）' }, range: [-2.5, 1.5] } }),
    [],
  )

  // ── 圖 3：最後一步分布
  const histData = useMemo<Data[]>(() => {
    if (!res || !resMatches) return []
    const finite = Array.from(res.finalLog10).filter((v) => Number.isFinite(v))
    return [{ x: finite, type: 'histogram', nbinsx: 60, marker: { color: withAlpha(tokens.series[0], 0.75) }, name: T`$\log_{10}|\delta_N|$（${finite.length} 條路徑）` }]
  }, [res, resMatches, tokens])
  const histLayout = useMemo<Partial<Layout>>(() => {
    if (!res || !resMatches) return {}
    const med = res.q50[finalIdx]
    const shapes: Partial<Shape>[] = []
    const ann: Layout['annotations'] = []
    if (Number.isFinite(med)) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: med, x1: med, y0: 0, y1: 1, line: { color: tokens.series[0], width: 2 } })
      ann.push({ x: med, y: 1, yref: 'paper', text: '中位數', showarrow: false, yanchor: 'bottom', font: { color: tokens.text } })
    }
    const rms = traj ? traj.log10Rms[traj.log10Rms.length - 1] : NaN
    const lo = res.q10[finalIdx]
    const hi = res.q90[finalIdx]
    if (Number.isFinite(rms) && Number.isFinite(lo) && Number.isFinite(hi) && rms < hi + 3 * Math.max(1, hi - lo)) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: rms, x1: rms, y0: 0, y1: 1, line: { color: tokens.series[1], width: 2, dash: 'dash' } })
      ann.push({ x: rms, y: 0.9, yref: 'paper', text: T`解析 $\sqrt{E[\delta^2]}$`, showarrow: false, xanchor: 'left', font: { color: tokens.text } })
    } else if (Number.isFinite(rms)) {
      ann.push({ x: 1, xref: 'paper', y: 0.95, yref: 'paper', xanchor: 'right', showarrow: false, text: T`解析 $\sqrt{E[\delta_N^2]} = 10^{${tnum(rms, 4)}}$，遠在圖的右邊`, font: { color: tokens.text } })
    }
    return { xaxis: { title: { text: T`$\log_{10}|\delta_N|$` } }, yaxis: { title: { text: '路徑數' } }, shapes, annotations: ann, bargap: 0.05 }
  }, [res, resMatches, finalIdx, traj, tokens])

  // ── 圖 4：收斂比例（所有 case）＋ 圖 5：case 比較
  const fracData = useMemo<Data[]>(
    () =>
      analyzed.flatMap(({ c, a }) => {
        const r = out?.byId[c.id]
        const col = tokens.series[c.seriesIndex]
        const d: Data[] = []
        if (r) d.push({ x: Array.from(r.n), y: Array.from(r.fracConverged), mode: 'lines', line: { color: col, width: 2 }, name: T`Case ${c.id} MC（$\mu=${tnum(c.params.mu)}$，${distSummaryTex(c.params)}）` })
        // CLT 預測（F-03.18，近似）：無雜訊、δ₀ ≠ 0、s 有定義時
        if (a && c.params.noiseSigma === 0 && c.params.delta0 !== 0 && Number.isFinite(a.sd) && Number.isFinite(a.f.lambda)) {
          const ns = Array.from(r ? r.n : recordIndices(c.params.steps))
          d.push({
            x: ns,
            y: ns.map((k) => cltConvergedFraction(a.f.lambda, a.sd, k, 1e-3)),
            mode: 'lines',
            line: { color: col, width: 1.5, dash: 'dash' },
            name: `Case ${c.id} CLT 預測（近似）`,
          })
        }
        return d
      }),
    [analyzed, out, tokens],
  )
  const compareData = useMemo<Data[]>(() => {
    if (cases.cases.length < 2) return []
    return analyzed.flatMap(({ c, a }) => {
      const r = out?.byId[c.id]
      const col = tokens.series[c.seriesIndex]
      const d: Data[] = []
      if (r) d.push({ x: Array.from(r.n), y: finiteOrNull(r.q50), mode: 'lines', line: { color: col, width: 2.5 }, name: `Case ${c.id} MC 中位數` })
      if (a) {
        const ns = r ? r.n : recordIndices(c.params.steps)
        const tr = analyticTrajectory({ mu: c.params.mu, dist: a.dist, delta0: c.params.delta0, noiseSigma: c.params.noiseSigma }, ns)
        d.push({ x: Array.from(ns), y: finiteOrNull(tr.log10Rms), mode: 'lines', line: { color: col, width: 1.5, dash: 'dash' }, name: T`Case ${c.id} 解析 $\sqrt{\text{MSD}}$` })
      }
      return d
    })
  }, [analyzed, cases.cases.length, out, tokens])

  // ── 圖 6：解析 E[δ_n]（線性軸，保留正負號；log 圖只能畫 |E[δ_n]|）
  const meanData = useMemo<Data[]>(
    () =>
      analyzed.flatMap(({ c, a }) => {
        if (!a || !(a.m.Px > 0)) return []
        const K = Math.min(40, c.params.steps)
        const n = Array.from({ length: K + 1 }, (_, i) => i)
        const r = a.f.meanPole
        return [
          {
            x: n,
            y: n.map((k) => c.params.delta0 * Math.pow(r, k)),
            mode: 'lines+markers',
            marker: { size: 4, color: tokens.series[c.seriesIndex] },
            line: { color: tokens.series[c.seriesIndex], width: 1.5 },
            name: T`Case ${c.id}：$E[\delta_n]$（$1 - \mu P_x = ${tnum(r, 3)}$）`,
          } as Data,
        ]
      }),
    [analyzed, tokens],
  )

  // 執行 Run：以「目前」參數重跑一次（凍結時也會跑，並把凍結的請求換成目前參數）
  const onRun = () => {
    if (frozen) setHeld(request)
    setRunToken((t) => t + 1)
  }
  const onFreeze = () => setHeld((h) => (h === undefined ? debounced : undefined))
  // 執行至收斂：把 N 設成「典型路徑降到 10⁻³|δ₀|」所需步數的 2 倍（λ < 0 才有意義）
  const onRunToConvergence = () => {
    // note 以 `$…$` 標示數學，顯示時由 texText 轉成 KaTeX
    if (!A || !(A.m.Px > 0)) return setNote(String.raw`目前的 $x$ 分布無法計算 $\lambda$（見上方警告），無法估計收斂步數。`)
    const lam = A.f.lambda
    if (!(lam < 0))
      return setNote(
        String.raw`$\lambda(\mu)=${tnum(lam)}\ge0$：典型路徑不會收斂，無法「執行至收斂」。請把 $\mu$ 降到 $\mu_\text{as}\approx${tnum(A.b.asMax)}$ 以下。`,
      )
    const typical = lam === -Infinity ? 1 : Math.ceil(Math.log(1e-3) / lam)
    const cap = Math.max(10, Math.min(5000, Math.floor(MC_LIMITS.maxWork / ap.paths)))
    const want = 2 * typical
    const steps = Math.max(10, Math.min(cap, want))
    setNote(
      String.raw`執行至收斂（Case ${active.c.id}）：典型路徑降到 $10^{-3}|\delta_0|$ 需要 $\lceil\ln10^{-3}/\lambda\rceil=$ ${typical} 步；已把步數設為 ${steps}（2 倍典型步數為 ${want}${steps !== want ? `，再限制在合法範圍 ${10}–${cap} 內` : ''}）。這是 almost-sure（樣本路徑）意義的收斂${A.f.g >= 1 ? String.raw`；$g\ge1$，所以 MSD 仍然發散` : ''}${ap.noiseSigma > 0 ? '；有雜訊時路徑只會降到雜訊決定的穩態分布，不會到 0' : ''}。`,
    )
    if (frozen) setHeld(undefined)
    cases.update({ steps })
  }
  const onReset = useCallback(() => {
    setHeld(undefined)
    setNote(null)
    reset(DEFAULT_LAB)
  }, [reset])
  const set = (patch: Partial<LabParams>) => {
    setNote(null) // 手動改參數後，舊的「執行至收斂」說明不再適用
    cases.update(patch)
  }

  return (
    <ExperimentShell
      id={LAB_EXPERIMENT}
      title="Stability Lab：Mean、Mean-Square 與 Almost-Sure 同一張圖"
      level="L0"
      claim="exact"
      tests={['T02', 'T03']}
      description={
        <>
          純量 LMS <Tex>{T`\delta_{n+1}=(1-\mu x_n^2)\delta_n-\mu x_nv_n`}</Tex>，<Tex>{T`x_n`}</Tex> iid。解析：<Tex>{T`E[\delta_n]`}</Tex>、<Tex>{T`E[\delta_n^2]`}</Tex>（MSD）；Monte Carlo（Web Worker）：<Tex>{T`|\delta_n|`}</Tex> 的中位數與 10/90% 分位數。
        </>
      }
      assumptions={[
        String.raw`$x_n$ iid（依所選分布）；fixed 為退化分布`,
        String.raw`量測雜訊 $v_n \sim \mathcal N(0, \sigma_v^2)$，與 $x$ 獨立（$\sigma_v = 0$ 時關閉）`,
        String.raw`$\delta = a - w$（勘誤 E39）；iid 純量 $x$ 時 mean / MSD 遞迴為精確式（勘誤 E38）`,
        String.raw`圖中 $E[\delta^2]$ 是係數均方偏差 MSD，不是 MSE 成本（勘誤 E42）`,
        String.raw`MC 驗證採單步估計 $E[f]$、$E[f^2]$、$E\ln|f|$，不以長時間 $\delta^2$ 平均判定（勘誤 E14）`,
        String.raw`分位帶與收斂比例的 CLT 預測（F-03.18）是近似：平均 $n\lambda$ 與變異數 $n s^2$ 精確，常態形狀為近似（無雜訊時才適用）`,
        '浮點雙精度、無量化（L0）；無雜訊時在 log 域累加，不會 overflow',
      ]}
      params={{ ...ap, case: cases.activeId, distSummary: distSummary(ap) }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ mu: '1/[x]^2', delta0: '—（正規化）', paths: 'paths', steps: 'samples', noiseSigma: '—（與 y 同單位）' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: mcCheck,
        fixedPoint: { status: 'not-implemented', note: '定點量化見第 13 章' },
      }}
      actions={{ onRun, onStop: task.cancel, running: task.running, onReset, onRunToConvergence, onFreeze, frozen }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number | null>> = { n: nGrid }
        if (traj) {
          cols.analytic_mean_signed = Array.from(nGrid, (k) => (A ? ap.delta0 * Math.pow(A.f.meanPole, k) : NaN))
          cols.analytic_log10_abs_mean = traj.log10AbsMean
          cols.analytic_log10_rms = traj.log10Rms
          cols.analytic_log10_typical = traj.log10Typical
        }
        if (A && cltOk) {
          const l0 = Math.log10(Math.abs(ap.delta0))
          cols.clt_q10_log10 = Array.from(nGrid, (k) => l0 + cltLog10Quantile(A.f.lambda, A.sd, k, 0.1))
          cols.clt_q90_log10 = Array.from(nGrid, (k) => l0 + cltLog10Quantile(A.f.lambda, A.sd, k, 0.9))
          cols.clt_frac_converged = Array.from(nGrid, (k) => cltConvergedFraction(A.f.lambda, A.sd, k, 1e-3))
        }
        if (res && resMatches) {
          cols.mc_q10_log10 = res.q10
          cols.mc_q50_log10 = res.q50
          cols.mc_q90_log10 = res.q90
          cols.mc_naive_log10_rms = res.naiveLog10Rms
          cols.mc_frac_converged = res.fracConverged
        }
        return cols
      }}
      presets={presets.map((pr) => ({ id: pr.id, name: pr.title, params: pr.params, description: pr.description }))}
      onLoadPreset={(pr) => {
        setNote(null)
        cases.update(mergeParams(ap, pr.params))
      }}
      controls={
        <>
          <CaseSelector cases={cases} />
          <ParamControl
            label={T`$\mu$（Case ${cases.activeId}）`}
            value={ap.mu}
            onChange={(mu) => set({ mu })}
            min={0.001}
            max={20}
            log
            unit={T`$1/[x]^2$`}
            reg="LMS_MU（behavioral）"
            hint={A && A.m.Px > 0 ? <Tex>{T`\mu_\text{mean}=${tnum(A.b.meanMax)},\ \mu_\text{MS}=${tnum(A.b.msMax)},\ \mu_\text{as}=${tnum(A.b.asMax)}`}</Tex> : undefined}
          />
          <DistControls value={ap} onChange={(patch) => set(patch)} />
          <ParamControl label={T`$\delta_0 = a - w_0$`} value={ap.delta0} onChange={(delta0) => set({ delta0 })} min={-10} max={10} step={0.1} unit="—（正規化）" reg="初始誤差（真值減 REG_GAIN 初值）" />
          <ParamControl
            label={T`$\sigma_v$（量測雜訊）`}
            value={ap.noiseSigma}
            onChange={(noiseSigma) => set({ noiseSigma })}
            min={0}
            max={2}
            step={0.001}
            unit="$[y]$"
            reg="comparator 前雜訊 RMS（正規化）"
            hint={tx`$0$ = 關閉；$\sigma_v>0$ 時看穩態分布與 $\text{MSD}_\infty$`}
          />
          <ParamControl label="路徑數" value={ap.paths} onChange={(paths) => set({ paths })} min={10} max={MC_LIMITS.maxPaths} log integer clampOnBlur unit="paths" reg="Monte Carlo 路徑數（behavioral）" />
          <ParamControl label="步數 $N$" value={ap.steps} onChange={(steps) => set({ steps })} min={10} max={5000} integer clampOnBlur unit="samples" reg="模擬長度（behavioral）" />
        </>
      }
    >
      {A && A.m.Px > 0 && (
        <div className="ch03-trio" aria-label="目前 μ 的三種判據">
          <div className="ch03-trio-card">
            <h4>Mean</h4>
            <div className="ch03-trio-num">{num(A.f.meanPole, 5)}</div>
            <div className="small">
              <Tex>{T`1-\mu P_x`}</Tex> <Verdict value={Math.abs(A.f.meanPole)} /> <ClaimTag kind="exact" />
            </div>
          </div>
          <div className="ch03-trio-card">
            <h4>Mean-square（MSD）</h4>
            <div className="ch03-trio-num">{num(A.f.g, 5)}</div>
            <div className="small">
              <Tex>{T`g(\mu)`}</Tex> <Verdict value={A.f.g} /> <ClaimTag kind="exact" />
            </div>
          </div>
          <div className="ch03-trio-card">
            <h4>Almost-sure</h4>
            <div className="ch03-trio-num">{num(A.f.lambda, 5)}</div>
            <div className="small">
              <Tex>{T`\lambda(\mu)`}</Tex> <Verdict value={A.f.lambda} threshold={0} /> <ClaimTag kind="exact" />
            </div>
          </div>
        </div>
      )}
      {task.running && <p className="ch03-running">Monte Carlo 執行中（Web Worker，{task.mode === 'worker' ? '背景執行' : '主執行緒'}）…</p>}
      {stale && !task.running && !frozen && <p className="ch03-running">參數已改變，結果更新中…</p>}
      {frozen && (
        <p className="ch03-running" role="status">
          已凍結：改參數時 Monte Carlo 不會自動重跑（解析曲線仍即時更新）。{stale ? '目前參數與凍結時不同，MC 曲線已隱藏；' : ''}按「執行 Run」以目前參數重跑一次，或再按一次「凍結」解除。
        </p>
      )}
      {note && (
        <p className="ch03-note" role="status">
          {texText(note)}
        </p>
      )}
      <Plot
        title={String.raw`Case ${active.c.id}：$\log_{10}|\delta_n|$ — 解析 mean / MSD vs Monte Carlo 分位數`}
        ariaLabel={`Case ${active.c.id}：參數誤差大小的對數——解析 mean / MSD 與 Monte Carlo 分位數`}
        data={mainData}
        layout={mainLayout}
        height={380}
        csvName="ch03-stability-main"
        caption={tx`紅線（解析 $\tfrac12\log_{10}E[\delta_n^2]$）與藍色分位帶分開時，就是「均方發散、路徑收斂」的 heavy-tail 區間；紫色點虛線是直接平均樣本 $\delta_n^2$ 的天真估計：有限條路徑幾乎抽不到主導期望值的稀有大值，所以嚴重低估。綠色虛線是解析 $\log_{10}|E[\delta_n]|$，橘色點線是典型路徑 $\log_{10}|\delta_0|+n\lambda/\ln10$（無雜訊時）；兩條灰色細點線是 CLT 預測的 10% / 90% 分位 $n\lambda\pm1.2816\,s\sqrt n$（F-03.18，近似），應該貼著藍色分位帶的上下緣。`}
      />
      <div className="ch03-plots">
        <Plot
          title={String.raw`$\mu$ 軸：三種每步因子（門檻都是 1）`}
          ariaLabel="學習率軸上的三種每步因子（門檻都是 1）"
          data={muData}
          layout={muLayout}
          yLog
          height={320}
          csvName="ch03-stability-mu-axis"
          caption={tx`mean 看 $|E[f]|$、MSD 看 $E[f^2]$、樣本路徑看幾何平均 $e^{E\ln|f|}$（$f=1-\mu x^2$）；點線直線是目前的 $\mu$，菱形是三個界限。`}
        />
        <Plot
          title={String.raw`最後一步 $\log_{10}|\delta_N|$ 的分布`}
          ariaLabel="最後一步參數誤差大小（對數）的分布"
          data={histData}
          layout={histLayout}
          height={320}
          csvName="ch03-stability-final-hist"
          caption={tx`無雜訊時 $\ln|\delta_N|$ 是 $N$ 個 iid 項的總和，近似常態（中央極限定理），所以 $|\delta_N|$ 近似 lognormal；$E[\delta_N^2]$ 由右尾決定。`}
        />
      </div>
      <div className="ch03-plots">
        <Plot
          title={String.raw`收斂比例 $P(|\delta_n| < 10^{-3}|\delta_0|)$`}
          ariaLabel="收斂比例：參數誤差小於初始誤差千分之一的路徑比例"
          data={fracData}
          height={280}
          csvName="ch03-stability-frac"
          layout={FRAC_LAYOUT}
          caption={tx`實線：Monte Carlo；虛線：CLT 預測 $\Phi\big((\ln10^{-3}-n\lambda)/(s\sqrt n)\big)$（F-03.18，近似；無雜訊時才畫）。$|x|$ 為常數時所有路徑相同，比例是 $0\to1$ 的階梯。`}
        />
        <Plot
          title={String.raw`解析 $E[\delta_n]$（線性軸、含正負號，前 40 步）`}
          ariaLabel="解析的平均參數誤差（線性軸、含正負號，前 40 步）"
          data={meanData}
          height={280}
          csvName="ch03-stability-mean-signed"
          layout={MEAN_LAYOUT}
          caption={tx`$E[\delta_n]=(1-\mu P_x)^n\delta_0$。mean pole $1-\mu P_x<0$（$\mu>1/P_x$）時每步變號：這是「平均」的震盪，不代表單一路徑也如此。`}
        />
        {compareData.length > 0 ? (
          <Plot title={String.raw`Case A / B / C：MC 中位數（實線）vs 解析 $\sqrt{\text{MSD}}$（虛線）`} ariaLabel="Case A / B / C：MC 中位數（實線）與解析的 MSD 平方根（虛線）" data={compareData} height={280} csvName="ch03-stability-cases" layout={CASES_LAYOUT} />
        ) : (
          <p className="small muted">在左側 Case 選擇器按「＋」新增 Case B / C（同一個 seed 的 paired simulation），這裡會並排比較。</p>
        )}
      </div>
    </ExperimentShell>
  )
}
