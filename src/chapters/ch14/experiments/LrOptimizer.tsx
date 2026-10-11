import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data, Shape } from 'plotly.js-dist-min'
import {
  Callout,
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  mathText,
  useCases,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  OBJECTIVE_LABEL,
  OBJECTIVES,
  asymptoticFinalOptimum,
  calBandwidth3dB,
  comparatorKq,
  finalCostDerivative,
  gMaxForPm,
  loopGainK,
  msdAfterBlocks,
  msdSplit,
  objectiveCost,
  optimizeMu,
  traceBlockIndices,
  type DesignModel,
  type MsdMonteCarloParams,
  type MsdMonteCarloResult,
  type Objective,
} from '@/simulation/models/optimizer'
import { logspace, md, nf, tx, vBand, vLine, withAlpha } from '../shared'

export interface LrParams {
  /** comparator 雜訊 RMS [fs] */
  sigmaV: number
  /** GMAC block 長度 */
  N: number
  /** 總比較次數（時間預算） */
  T: number
  /** 初始誤差 δ0 [fs] */
  delta0: number
  /** 誤差路徑相位 θ [deg]（C = cos θ） */
  thetaDeg: number
  /** comparator 取樣率 [Hz]（只用來換算時間與 f_u） */
  fsHz: number
  objective: Objective
  pmTargetDeg: number
  allowOsc: boolean
  /** spur 目標的相對縮減比 ε（0 < ε < 1） */
  eps: number
  /** spur 觀察頻率 f_off/f_u（0–0.5） */
  spurFrac: number
  /** ramp 漂移 r [fs/block] */
  driftRate: number
  /** random-walk 漂移 σ_ζ [fs/block] */
  driftSigma: number
  /** Monte Carlo：每個 μ 的 exact-binomial chain 數 */
  chains: number
  /** Monte Carlo：blockLms sample-level 對照的 run 數 */
  blockLmsRuns: number
}

export const LR_DEFAULTS: LrParams = {
  sigmaV: 100,
  N: 4096,
  T: 131072,
  delta0: 3,
  thetaDeg: 0,
  fsHz: 4e9,
  objective: 'final',
  pmTargetDeg: 60,
  allowOsc: false,
  eps: 0.05,
  spurFrac: 0.05,
  driftRate: 0.002,
  driftSigma: 0.02,
  chains: 1000,
  blockLmsRuns: 48,
}

const MC_FACTORS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]
// Plot 的軸標題、圖例名稱裡的數學寫 `$...$`（Plot 元件會轉成斜體符號與上下標，見 src/components/plotMath.ts）
const TRACE_LAYOUT = { xaxis: { title: { text: String.raw`$k$（blocks）` } }, yaxis: { title: { text: String.raw`$\mathrm{fs}^2$` } } }
const CASE_LAYOUT = { xaxis: { title: { text: String.raw`$\mu$（fs，log）` } }, yaxis: { title: { text: 'RMS (fs)' } } }

/** 目標成本的單位（Plotly 軸標題用，字串裡的 `$...$` 由 Plot 轉成上標；KaTeX 版本見 OBJECTIVE_UNIT） */
const UNIT_TEXT: Record<Objective, string> = {
  final: String.raw`$\mathrm{fs}^2$`,
  fastest: 'blocks',
  integrated: String.raw`$\mathrm{fs}^2$`,
  spur: String.raw`$\mathrm{fs}^2$/(cycle/block)`,
  trackRamp: String.raw`$\mathrm{fs}^2$`,
  trackRw: String.raw`$\mathrm{fs}^2$`,
}

export function designModel(p: Pick<LrParams, 'sigmaV' | 'N' | 'T' | 'delta0' | 'thetaDeg' | 'eps' | 'spurFrac' | 'driftRate' | 'driftSigma'>): DesignModel {
  return {
    K: loopGainK(p.sigmaV, p.thetaDeg),
    delta0: p.delta0,
    sigmaEta2: 1 / p.N,
    B: Math.floor(p.T / p.N),
    eps: p.eps,
    spurOmega: 2 * Math.PI * p.spurFrac,
    driftRate: p.driftRate,
    driftSigma: p.driftSigma,
  }
}

/** 解釋型警告（ExperimentShell 以 danger 顯示）。 */
export function lrWarnings(p: LrParams, m: DesignModel, reason?: string): string[] {
  const w: string[] = []
  const C = Math.cos((p.thetaDeg * Math.PI) / 180)
  if (m.K <= 0) {
    w.push(
      String.raw`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$\theta=${p.thetaDeg}^\circ$，$C=\cos\theta=${C.toFixed(3)}$，$p=1-\mu K>1$）。修正方式：反轉更新極性、delay alignment 或 filtered-x（Ch06／Ch07），不是調 $\mu$。`,
    )
  } else if (C < 0.1) {
    w.push(
      String.raw`$C=${C.toFixed(3)}\approx0$：恢復力很弱，需要 $\mu=g/K$ 非常大；$E[\delta_B^2]$ 趨近 $\delta_0^2+B\mu^2\sigma_\eta^2$ 的 random walk（勘誤 E48 的 $|p|=1$ 極限），量測誤差就可能讓極性翻轉。`,
    )
  }
  if (m.B < 1) w.push(String.raw`總比較次數 $T=${p.T}<N=${p.N}$：一次更新都做不到（$B=0$）。請增加 $T$ 或縮小 $N$。`)
  if (m.K > 0 && Math.abs(p.delta0) >= 0.5 * p.sigmaV) {
    w.push(
      String.raw`$\delta_0/\sigma_v=${(Math.abs(p.delta0) / p.sigmaV).toFixed(2)}\ge0.5$：1-bit comparator 飽和（slew-limited），線性公式 F-14.3 會低估 $E[\delta_B^2]$（$\delta_0=\sigma_v$ 約 $-17\%$、$2\sigma_v$ 約 $-52\%$；勘誤 E48）。請以 Monte Carlo 為準，或先用 coarse 階段把 $\delta$ 拉進 $0.3\sigma_v$ 以內。`,
    )
  }
  if (reason && m.K > 0 && m.B >= 1) w.push(reason)
  return w
}

export function LrOptimizerExperiment() {
  const tokens = useThemeTokens()
  const [params, setParams] = useState<LrParams>(LR_DEFAULTS)
  const [seed, setSeed] = useState(20261014)
  const [mc, setMc] = useState<{ key: string; res: MsdMonteCarloResult } | null>(null)
  const [mcErr, setMcErr] = useState<string | null>(null)
  const task = useWorkerTask<MsdMonteCarloParams, MsdMonteCarloResult>('optimizer', 'runMsdMonteCarlo', { restartOnRun: true })
  const urlPreset = useUrlPreset('lr-optimizer')
  useEffect(() => {
    if (urlPreset) setParams({ ...LR_DEFAULTS, ...(urlPreset.params as Partial<LrParams>) })
  }, [urlPreset])
  const set = useCallback(<K extends keyof LrParams>(k: K, v: LrParams[K]) => setParams((p) => ({ ...p, [k]: v })), [])
  const cases = useCases({ N: LR_DEFAULTS.N, thetaDeg: LR_DEFAULTS.thetaDeg }, { seed })

  const dp = useDeferredValue(params)
  const m = useMemo(() => designModel(dp), [dp])
  const opts = useMemo(() => ({ pmTargetDeg: dp.pmTargetDeg, allowOscillatory: dp.allowOsc }), [dp.pmTargetDeg, dp.allowOsc])
  const opt = useMemo(() => optimizeMu(dp.objective, m, opts), [dp.objective, m, opts])
  const optFinal = useMemo(() => optimizeMu('final', m, opts), [m, opts])
  const all = useMemo(() => OBJECTIVES.map((o) => ({ o, r: optimizeMu(o, m, opts) })), [m, opts])
  const asym = useMemo(() => asymptoticFinalOptimum(m), [m])
  const Kplot = m.K > 0 ? m.K : comparatorKq(dp.sigmaV)
  const mcKey = JSON.stringify([dp.sigmaV, dp.N, dp.T, dp.delta0, dp.thetaDeg, dp.objective, dp.pmTargetDeg, dp.allowOsc, dp.eps, dp.spurFrac, dp.driftRate, dp.driftSigma, dp.chains, dp.blockLmsRuns, seed])
  const mcRes = mc && mc.key === mcKey ? mc.res : null
  const mcStale = mc !== null && mc.key !== mcKey

  // ── 曲線：E[δ_B²] 的 bias² / variance 分解與目前目標的成本 ──
  const curves = useMemo(() => {
    const mus = logspace(0.002 / Kplot, 2.3 / Kplot, 320)
    const split = mus.map((mu) => msdSplit(m.delta0, 1 - mu * m.K, mu, m.sigmaEta2, Math.max(m.B, 0)))
    const clip = (v: number) => (Number.isFinite(v) && v > 0 && v < 1e12 ? v : null)
    return {
      mus,
      total: split.map((s) => clip(s.total)),
      bias2: split.map((s) => clip(s.bias2)),
      variance: split.map((s) => clip(s.variance)),
      obj: mus.map((mu) => (m.K > 0 && mu * m.K < 2 ? clip(objectiveCost(dp.objective, mu, m)) : null)),
    }
  }, [m, Kplot, dp.objective])

  const shapes = useMemo(() => {
    const s: Partial<Shape>[] = []
    if (m.K > 0) {
      const muPm = gMaxForPm(dp.pmTargetDeg) / m.K
      if (dp.pmTargetDeg > 60 && !dp.allowOsc) s.push(vBand(muPm, 1 / m.K, withAlpha(tokens.series[3], 1), 0.1))
      s.push(vBand(1 / m.K, 2 / m.K, withAlpha(tokens.series[3], 1), dp.allowOsc ? 0.08 : 0.16))
      s.push(vBand(2 / m.K, curves.mus[curves.mus.length - 1], withAlpha(tokens.danger, 1), 0.18))
      if (dp.objective === 'spur' && Number.isFinite(opt.muLo)) s.push(vBand(curves.mus[0], opt.muLo, withAlpha(tokens.textMuted, 1), 0.12))
      if (opt.feasible) s.push(vLine(opt.mu, tokens.series[0], 'solid'))
      if (optFinal.feasible && dp.objective !== 'final') s.push(vLine(optFinal.mu, tokens.series[1], 'dash'))
    }
    return s
  }, [m.K, dp.pmTargetDeg, dp.allowOsc, dp.objective, opt, optFinal, curves.mus, tokens])

  const decompData = useMemo<Data[]>(() => {
    const d: Data[] = [
      { x: curves.mus, y: curves.total, name: String.raw`$E[\delta_B^2]$（線性 F-14.3）`, line: { color: tokens.series[0], width: 2.6 } },
      { x: curves.mus, y: curves.bias2, name: String.raw`$\text{bias}^2 = \delta_0^2\,p^{2B}$`, line: { color: tokens.series[1], dash: 'dash' } },
      { x: curves.mus, y: curves.variance, name: 'variance', line: { color: tokens.series[2], dash: 'dot' } },
    ]
    if (mcRes) {
      d.push({
        x: Array.from(mcRes.mus),
        y: Array.from(mcRes.msd),
        name: `MC exact-binomial（${mcRes.chains} chains/點，95% CI）`,
        mode: 'markers',
        marker: { color: tokens.series[4], size: 8 },
        error_y: { type: 'data', symmetric: false, array: Array.from(mcRes.hi).map((h, i) => h - mcRes.msd[i]), arrayminus: Array.from(mcRes.lo).map((l, i) => mcRes.msd[i] - l) },
      })
      if (mcRes.blockLms) {
        const b = mcRes.blockLms
        d.push({
          x: [b.mu],
          y: [b.msdB],
          name: `blockLms sample-level（${b.runs} runs）`,
          mode: 'markers',
          marker: { color: tokens.series[5], size: 11, symbol: 'diamond' },
          error_y: { type: 'data', symmetric: false, array: [b.hi - b.msdB], arrayminus: [b.msdB - Math.max(b.lo, 1e-12)] },
        })
      }
    }
    return d
  }, [curves, mcRes, tokens])

  const muStar = opt.feasible ? opt.mu : NaN
  const traceData = useMemo<Data[]>(() => {
    if (!Number.isFinite(muStar) || m.B < 1) return []
    // B 很大時只畫約 400 個 block（與 worker 記錄的索引相同），避免數十萬點的圖
    const ks = Array.from(traceBlockIndices(m.B))
    const d: Data[] = [{ x: ks, y: ks.map((k) => msdAfterBlocks(m.delta0, 1 - muStar * m.K, muStar, m.sigmaEta2, k)), name: String.raw`線性 F-14.3（$\mu = ${tx(muStar, 4)}\,\mathrm{fs}$）`, line: { color: tokens.series[0], width: 2.4 } }]
    if (mcRes) {
      const t = mcRes.trace
      const tk = Array.from(t.k)
      d.push({ x: tk, y: Array.from(t.msd), name: String.raw`MC exact-binomial（$\mu = ${tx(t.mu, 4)}$）`, mode: 'lines+markers', line: { color: tokens.series[4] }, marker: { size: 4 } })
      d.push({ x: tk.concat([...tk].reverse()), y: Array.from(t.hi).concat(Array.from(t.lo).reverse()), name: 'MC 95% CI', fill: 'toself', line: { width: 0 }, fillcolor: withAlpha(tokens.series[4], 0.18), hoverinfo: 'skip', showlegend: false })
      if (mcRes.blockLms) d.push({ x: tk, y: Array.from(mcRes.blockLms.curve), name: 'blockLms sample-level', line: { color: tokens.series[5], dash: 'dot' } })
    }
    return d
  }, [muStar, m, mcRes, tokens])

  const caseData = useMemo<Data[]>(
    () =>
      cases.cases.map((c) => {
        const mc2 = designModel({ ...dp, N: c.params.N, thetaDeg: c.params.thetaDeg })
        const Kc = mc2.K > 0 ? mc2.K : comparatorKq(dp.sigmaV)
        const mus = logspace(0.01 / Kc, 1.2 / Kc, 200)
        return {
          x: mus,
          y: mus.map((mu) => {
            const v = msdAfterBlocks(mc2.delta0, 1 - mu * mc2.K, mu, mc2.sigmaEta2, Math.max(0, mc2.B))
            return Number.isFinite(v) && v < 1e12 ? Math.sqrt(v) : null
          }),
          name: String.raw`Case ${c.id}：$N = ${c.params.N}$（$B = ${mc2.B}$）、$\theta = ${c.params.thetaDeg}^\circ$`,
          line: { color: tokens.series[c.seriesIndex] },
        }
      }),
    [cases.cases, dp, tokens],
  )

  // Plot 的 layout 也要 memo（每個新物件都會觸發一次 Plotly.react）
  const decompLayout = useMemo(() => ({ shapes, xaxis: { title: { text: String.raw`$\mu$（fs，log）` } }, yaxis: { title: { text: String.raw`$\mathrm{fs}^2$（log）` } } }), [shapes])
  const objLayout = useMemo(
    () => ({ shapes, xaxis: { title: { text: String.raw`$\mu$（fs，log）` } }, yaxis: { title: { text: String.raw`$J$（${UNIT_TEXT[dp.objective]}）` } } }),
    [shapes, dp.objective],
  )
  const objData = useMemo<Data[]>(() => [{ x: curves.mus, y: curves.obj, name: String.raw`$J(\mu)$`, line: { color: tokens.series[0], width: 2.4 } }], [curves, tokens])

  const warnings = lrWarnings(dp, m, opt.feasible ? undefined : opt.reason)
  const canRun = m.K > 0 && m.B >= 1 && opt.feasible

  const run = () => {
    if (!canRun) return
    setMcErr(null)
    const mus = MC_FACTORS.map((f) => f * muStar).filter((mu) => mu * m.K < 1.98)
    const key = mcKey
    task
      .run({
        seed,
        sigmaV: dp.sigmaV,
        N: dp.N,
        thetaDeg: dp.thetaDeg,
        delta0: dp.delta0,
        B: m.B,
        mus,
        chains: dp.chains,
        traceIndex: MC_FACTORS.indexOf(1),
        blockLmsRuns: dp.blockLmsRuns,
        blockLmsMu: muStar,
        blockLmsMaxSamples: 2 ** 23,
      })
      .then(
        (res) => setMc({ key, res }),
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setMcErr(e instanceof Error ? e.message : String(e))
        },
      )
  }

  // ── 交叉比對（誠實標示）──
  const analyticCheck = useMemo<CheckEntry>(() => {
    if (!opt.feasible) return { status: 'n/a', note: '無可行解' }
    if (dp.objective === 'final' && opt.atBoundary === null) {
      const d = finalCostDerivative(opt.mu, m)
      const scale = Math.abs(finalCostDerivative(opt.mu * 0.5, m)) || 1
      return { status: Math.abs(d) < 1e-5 * scale ? 'ok' : 'mismatch', note: String.raw`$dJ/d\mu(\mu^*)=${tx(d, 3)}\,\mathrm{fs}$（F-14.7）` }
    }
    // 其他目標（或邊界解）：與 4000 點密集格點的最小值比對
    let gmin = Infinity
    for (const mu of logspace(opt.muHi * 1e-7, opt.muHi, 4000)) {
      if (dp.objective === 'spur' && mu < opt.muLo) continue
      gmin = Math.min(gmin, objectiveCost(dp.objective, mu, m))
    }
    return { status: opt.cost <= gmin * (1 + 1e-6) + 1e-300 ? 'ok' : 'mismatch', note: '與 4000 點格點最小值比對' }
  }, [opt, dp.objective, m])
  const E48_HINT = String.raw`（$\delta_0$ 大：E48 預期的線性化失效）`
  const mcCheck: CheckEntry = (() => {
    if (!mcRes) return { status: 'n/a', note: mcStale ? '參數已改變，請重新執行 Run' : '尚未執行：按「執行 Run」啟動 worker Monte Carlo' }
    const i = MC_FACTORS.indexOf(1)
    const lin = mcRes.linear[i]
    const inside = lin >= mcRes.lo[i] && lin <= mcRes.hi[i]
    const extra = mcRes.blockLmsNote ? `；${mcRes.blockLmsNote}` : ''
    return {
      status: inside ? 'ok' : 'mismatch',
      note:
        (inside ? '線性解析值落在 MC 95% CI 內' : `線性 ${nf(lin, 4)} 不在 MC CI [${nf(mcRes.lo[i], 4)}, ${nf(mcRes.hi[i], 4)}] 內${Math.abs(dp.delta0) >= 0.3 * dp.sigmaV ? E48_HINT : ''}`) +
        extra,
    }
  })()

  const fu = dp.fsHz / dp.N
  const split = opt.feasible ? msdSplit(m.delta0, opt.p, opt.mu, m.sigmaEta2, m.B) : null
  // E48：δ0/σ_v ≳ 0.3 起 Sign-LMS 的線性化誤差開始可見，F-14.3 的數字改標 [近似｜失效風險]
  const linearRisk = Math.abs(dp.delta0) >= 0.3 * dp.sigmaV
  const bw = opt.feasible ? calBandwidth3dB(opt.p, fu) : null
  const BW_NOTE: Record<string, string> = {
    no3db: String.raw`$-3\,\mathrm{dB}$ 點不存在（$0<p<3-2\sqrt2$，E27）`,
    flat: String.raw`$p=0$：flat，沒有 $-3\,\mathrm{dB}$ 點（E27）`,
    highpass: String.raw`$p<0$：high-pass，low-pass 頻寬不適用（E27）`,
    unstable: String.raw`$|p|\ge1$：不穩定`,
  }
  const metrics: MetricRow[] = [
    { name: String.raw`$B=\lfloor T/N\rfloor$`, value: m.B, unit: 'blocks', digits: 6 },
    { name: String.raw`$K=K_q\cos\theta$`, value: m.K, unit: String.raw`$\mathrm{fs}^{-1}$`, formulaId: 'F-14.1', claim: 'approx' },
    { name: String.raw`$\mu^*$（${OBJECTIVE_LABEL[dp.objective]}）`, value: opt.feasible ? opt.mu : '無可行解', unit: 'fs', claim: dp.objective === 'final' ? 'exact' : 'approx', note: opt.atBoundary ? `落在${opt.atBoundary === 'hi' ? '上限（PM／穩定）' : '下限'}邊界` : undefined },
    {
      name: String.raw`RMS $\delta_B$（在 $\mu^*$）`,
      value: split ? Math.sqrt(split.total) : null,
      unit: 'fs',
      formulaId: 'F-14.3',
      claim: linearRisk ? 'approx' : 'exact',
      note: linearRisk ? String.raw`線性化失效風險：$\delta_0/\sigma_v\ge0.3$，以 Monte Carlo 為準（E48）` : '線性化 iid 模型的精確值',
    },
    { name: String.raw`$\text{bias}^2$／variance（在 $\mu^*$）`, value: split ? `${nf(split.bias2, 4)} / ${nf(split.variance, 4)}` : null, unit: String.raw`$\mathrm{fs}^2$` },
    { name: String.raw`pole $p=1-\mu^*K$`, value: opt.feasible ? opt.p : null, formulaId: 'F-14.1' },
    { name: 'PM（$d=0$）', value: opt.feasible ? opt.pmDeg : null, unit: '°', formulaId: 'F-14.14', claim: 'exact' },
    { name: String.raw`$\tau=-1/\ln|p|$`, value: opt.feasible ? opt.tauBlocks : null, unit: 'blocks' },
    {
      name: String.raw`$\mu^*$（終點 RMS，數值） vs 漸近 F-14.8`,
      value: optFinal.feasible ? optFinal.mu : null,
      unit: 'fs',
      analytic: asym.valid ? asym.mu : undefined,
      tolerance: asym.valid ? 0.06 : undefined,
      toleranceMode: 'rel',
      formulaId: 'F-14.8',
      claim: 'approx',
      note: asym.valid ? String.raw`$A=${tx(asym.A, 4)}$` : String.raw`$A=${tx(asym.A, 3)}$：漸近式不適用（需 $A\gg1$、$\ln A\ll2B$）`,
    },
    { name: String.raw`穩態 $\sigma_w$（在 $\mu^*$）`, value: opt.feasible && opt.g < 2 ? Math.sqrt((opt.mu * m.sigmaEta2) / (m.K * (2 - opt.g))) : null, unit: 'fs', formulaId: 'F-14.6' },
    { name: '校正時間 $T/f_s$', value: (dp.T / dp.fsHz) * 1e6, unit: String.raw`$\mu\mathrm{s}$` },
    { name: 'block rate $f_u=f_s/N$', value: fu / 1e3, unit: 'kHz' },
    {
      name: String.raw`校正頻寬 $f_{3\mathrm{dB}}$（精確 $-3\,\mathrm{dB}$ 點）`,
      value: bw && bw.regime === 'lowpass' ? bw.hz / 1e3 : null,
      unit: 'kHz',
      claim: 'exact',
      note: bw ? (bw.regime === 'lowpass' ? String.raw`$\sin(\Omega/2)=(1-p)/(2\sqrt p)$；近似 $g f_u/(2\pi)=${tx((opt.g * fu) / (2 * Math.PI) / 1e3, 4)}\,\mathrm{kHz}$（E26／E27）` : BW_NOTE[bw.regime]) : undefined,
    },
  ]
  if (mcRes) {
    const i = MC_FACTORS.indexOf(1)
    metrics.push({
      name: String.raw`MC exact-binomial $E[\delta_B^2]$（$\mu^*$）`,
      value: mcRes.msd[i],
      unit: String.raw`$\mathrm{fs}^2$`,
      analytic: mcRes.linear[i],
      tolerance: (mcRes.hi[i] - mcRes.lo[i]) / 2,
      claim: 'approx',
      note: `${mcRes.chains} chains${mcRes.chains < mcRes.chainsRequested ? `（要求 ${mcRes.chainsRequested}，因 $B=${m.B}$ 太大而自動減少）` : ''}、容差取 95% CI 半寬`,
    })
    if (mcRes.blockLms) {
      const b = mcRes.blockLms
      metrics.push({ name: String.raw`blockLms sample-level $E[\delta_B^2]$（$\mu^*$）`, value: b.msdB, unit: String.raw`$\mathrm{fs}^2$`, analytic: mcRes.linear[i], tolerance: (b.hi - b.lo) / 2, claim: 'approx', note: `${b.runs} runs、${b.samples} samples` })
    }
  }

  const presets = presetsForExperiment('lr-optimizer').map((p) => ({ name: p.title, params: p.params, description: p.description }))

  return (
    <ExperimentShell
      id="lr-optimizer"
      title="Learning-Rate Optimizer：均方誤差對 learning rate 的曲線、目標與限制"
      level="L1"
      claim="exact"
      tests={['T08', 'T13', 'T14']}
      source={mcRes ? 'simulation' : 'illustrative'}
      description={
        <>
          線性化 iid 模型的 <Tex>{'\\text{bias}^2+\\text{variance}'}</Tex>（F-14.3）、六種目標的最佳 <Tex>{'\\mu'}</Tex>、PM 限制，以及兩個 Monte Carlo 引擎（exact-binomial Sign-GMAC 與共用 sample-level <code>blockLms</code>）的交叉比對。
        </>
      }
      assumptions={[
        String.raw`單參數、$x=\pm1$ iid、$u[n]=\cos\theta\,x[n]+\sin\theta\,x[n-1]$（$C=\cos\theta$、$|H|=1$）`,
        String.raw`$\sigma_\eta^2=1/N$（近鎖定；精確值 $(1-m^2)/N$）`,
        '一階 calibration loop、無更新延遲（$d=0$）、無暫存器量化',
        String.raw`$\delta=a-w$；$\mu$ 單位 fs（average-mode GMAC）`,
        String.raw`1-bit Sign-LMS 下 F-14.3 只在 $|\delta_0|\ll\sigma_v$ 時成立（勘誤 E48）`,
      ]}
      params={{ ...params }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ sigmaV: 'fs', delta0: 'fs', thetaDeg: 'deg', fsHz: 'Hz', pmTargetDeg: 'deg', driftRate: 'fs/block', driftSigma: 'fs/block', T: 'comparisons' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: mcCheck,
        fixedPoint: { status: 'not-implemented', note: String.raw`$\mu$ 的定點／2 的冪次 shift 量化未納入本實驗（見 Ch13、Ch16）` },
      }}
      actions={{
        onRun: canRun ? run : undefined,
        onStop: task.cancel,
        running: task.running,
        onReset: () => {
          setParams(LR_DEFAULTS)
          setMc(null)
        },
      }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number | null>> = {
          mu_fs: curves.mus,
          msd_total_fs2: curves.total,
          bias2_fs2: curves.bias2,
          variance_fs2: curves.variance,
          objective_cost: curves.obj,
        }
        if (mcRes) {
          cols.mc_mu_fs = mcRes.mus
          cols.mc_msd_fs2 = mcRes.msd
          cols.mc_lo_fs2 = mcRes.lo
          cols.mc_hi_fs2 = mcRes.hi
          cols.mc_linear_fs2 = mcRes.linear
        }
        return cols
      }}
      presets={presets}
      onLoadPreset={(p) => {
        setParams({ ...LR_DEFAULTS, ...(p.params as Partial<LrParams>) })
        setMc(null)
      }}
      controls={
        <div className="ch14-controls">
          <div className="ch14-group-title">硬體／雜訊</div>
          <ParamControl label={md(String.raw`$\sigma_v$（comparator 雜訊）`)} ariaLabel="σ_v（comparator 雜訊）" value={params.sigmaV} onChange={(v) => set('sigmaV', v)} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
          <ParamControl label={md(String.raw`$N$（每 block 樣本數）`)} ariaLabel="N（每 block 樣本數）" value={params.N} onChange={(v) => set('N', v)} min={16} max={262144} log integer clampOnBlur reg="REG_GMAC_N / gm_accum_samples" />
          <ParamControl label={md(String.raw`$T$（總比較次數）`)} ariaLabel="T（總比較次數）" value={params.T} onChange={(v) => set('T', v)} min={64} max={2 ** 24} log integer clampOnBlur reg="CAL_TIMER（以 comparator 樣本計）" hint={md(String.raw`$B=\lfloor T/N\rfloor=${Math.floor(params.T / params.N)}$`)} />
          <ParamControl label={md(String.raw`$\delta_0$（初始誤差）`)} ariaLabel="δ0（初始誤差）" value={params.delta0} onChange={(v) => set('delta0', v)} min={0.001} max={1000} log unit="fs" reg="gain_true 與 gain_initial 的差" />
          <ParamControl label={md(String.raw`$\theta$（誤差路徑相位）`)} ariaLabel="θ（誤差路徑相位）" value={params.thetaDeg} onChange={(v) => set('thetaDeg', v)} min={-180} max={180} step={1} unit="°" reg="pll_error_path phase（behavioral，code 頻帶）" hint={md(String.raw`$C=\cos\theta$；$|\theta|\ge90^\circ$ 時極性錯誤`)} />
          <ParamControl label={md(String.raw`$f_s$（comparator rate）`)} ariaLabel="f_s（comparator rate）" value={params.fsHz} onChange={(v) => set('fsHz', v)} min={1e6} max={2e10} log unit="Hz" reg="sample_rate_hz" />
          <div className="ch14-group-title">目標與限制</div>
          <SelectControl
            label="最佳化目標"
            value={params.objective}
            onChange={(v) => set('objective', v)}
            options={OBJECTIVES.map((o) => ({ value: o, label: OBJECTIVE_LABEL[o] }))}
            reg="design objective"
          />
          <ParamControl label={md(String.raw`PM 下限 $PM_t$`)} ariaLabel="PM 下限 PM_t" value={params.pmTargetDeg} onChange={(v) => set('pmTargetDeg', v)} min={60} max={89} step={0.5} unit="°" reg="CAL_PM_TARGET（behavioral：迴路增益上限）" disabled={params.allowOsc} />
          <ToggleControl label={md(String.raw`允許 $g>1$（$p<0$，$PM<60^\circ$）`)} ariaLabel="允許 g > 1（p < 0，PM < 60°）" value={params.allowOsc} onChange={(v) => set('allowOsc', v)} hint={md(String.raw`只要求 $|p|<1$`)} />
          {params.objective === 'spur' && (
            <>
              <ParamControl label={md(String.raw`$\epsilon$（相對縮減比，$0<\epsilon<1$）`)} ariaLabel="ε（相對縮減比，0 < ε < 1）" value={params.eps} onChange={(v) => set('eps', v)} min={1e-6} max={0.999} log reg="CAL_CONV_EPS（相對）" hint={md(String.raw`勘誤 E16：$|E[\delta_B]|\le\epsilon|\delta_0|$，不是絕對 fs`)} />
              <ParamControl label={md(String.raw`spur 偏移 $f_\text{off}/f_u$`)} ariaLabel="spur 偏移 f_off/f_u" value={params.spurFrac} onChange={(v) => set('spurFrac', v)} min={0.001} max={0.5} log reg="spur offset（behavioral，以 block rate 正規化）" />
            </>
          )}
          {params.objective === 'trackRamp' && (
            <ParamControl label={md(String.raw`$r$（ramp 漂移）`)} ariaLabel="r（ramp 漂移）" value={params.driftRate} onChange={(v) => set('driftRate', v)} min={1e-6} max={1} log unit="fs/block" reg="PVT drift rate" />
          )}
          {params.objective === 'trackRw' && (
            <ParamControl label={md(String.raw`$\sigma_\zeta$（random-walk 漂移）`)} ariaLabel="σ_ζ（random-walk 漂移）" value={params.driftSigma} onChange={(v) => set('driftSigma', v)} min={1e-6} max={1} log unit="fs/block" reg="PVT random walk" />
          )}
          <div className="ch14-group-title">Monte Carlo（Run）</div>
          <ParamControl label={md(String.raw`chains／$\mu$ 點（exact binomial）`)} ariaLabel="chains／μ 點（exact binomial）" value={params.chains} onChange={(v) => set('chains', v)} min={100} max={20000} log integer clampOnBlur reg="MC chains" />
          <ParamControl label="blockLms runs（sample-level）" value={params.blockLmsRuns} onChange={(v) => set('blockLmsRuns', v)} min={0} max={400} step={1} integer clampOnBlur reg="MC runs (runBlockLms)" hint={md(String.raw`0：略過；總樣本數上限 $2^{23}$（約 8.4M），$B>10^5$ 時自動略過`)} />
        </div>
      }
    >
      {mcErr && <Callout kind="danger">Monte Carlo 失敗：{mcErr}</Callout>}
      {opt.feasible && opt.atBoundary === 'hi' && dp.objective !== 'fastest' && (
        <Callout kind="warn" title="最佳點被上限綁住">
          無限制的最佳點在 PM 限制之外；目前答案是 <Tex>{'\\mu=g_{\\max}/K'}</Tex>。放寬 PM 或增加 B 才會改變。
        </Callout>
      )}
      {opt.feasible && opt.atBoundary === 'lo' && dp.objective === 'final' && (
        <Callout kind="info" title={md(String.raw`$\delta_0$ 已經在雜訊底以下`)}>
          最佳是「幾乎不更新」：<Tex>{'\\delta_0^2'}</Tex> 比任何更新注入的雜訊還小（<Tex>{`A=${tx(asym.A, 3)}\\lesssim1`}</Tex>）。
        </Callout>
      )}
      <Plot
        title={String.raw`$E[\delta_B^2]$ vs $\mu$：$\text{bias}^2$ 下降、variance 上升`}
        data={decompData}
        xLog
        yLog
        height={340}
        csvName="ch14-lr-msd-vs-mu"
        layout={decompLayout}
        caption={md(String.raw`實線：目前目標的最佳 $\mu$；虛線：終點 RMS 的最佳 $\mu$。橘色區：$PM<PM_t$ 或 $p<0$（振盪）；紅色區：$g\ge2$ 發散；灰色區：spur 目標不滿足收斂要求。`)}
      />
      {dp.objective !== 'final' && m.K > 0 && (
        <Plot
          title={`目前目標的成本：${OBJECTIVE_LABEL[dp.objective]}`}
          data={objData}
          xLog
          yLog={dp.objective !== 'fastest'}
          height={260}
          csvName="ch14-lr-objective"
          layout={objLayout}
        />
      )}
      {traceData.length > 0 && (
        <Plot
          title={String.raw`$E[\delta_k^2]$ vs $k$（在 $\mu^*$）`}
          data={traceData}
          yLog
          height={280}
          csvName="ch14-lr-trace"
          layout={TRACE_LAYOUT}
          caption={mcRes ? undefined : '按「執行 Run」加入 Monte Carlo 曲線與 95% CI（Web Worker）。'}
        />
      )}
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>目標</th>
              <th>{md(String.raw`$\mu^*$ (fs)`)}</th>
              <th>{md('$g$')}</th>
              <th>PM</th>
              <th>{md(String.raw`RMS $\delta_B$ (fs)`)}</th>
            </tr>
          </thead>
          <tbody>
            {all.map(({ o, r }) => (
              <tr key={o} className={o === dp.objective ? 'is-best' : ''}>
                <td>{OBJECTIVE_LABEL[o]}</td>
                <td className="num">{r.feasible ? nf(r.mu, 4) : '—'}</td>
                <td className="num">{r.feasible ? nf(r.g, 3) : '—'}</td>
                <td className="num">{r.feasible ? `${nf(r.pmDeg, 3)}°` : '—'}</td>
                <td className="num">{r.feasible ? nf(Math.sqrt(msdAfterBlocks(m.delta0, r.p, r.mu, m.sigmaEta2, m.B)), 4) : m.K > 0 && m.B >= 1 ? mathText(r.reason ?? '—') : '—（原因見上方警告）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{md(String.raw`A/B/C：同一個總預算 $T$，不同 $N$ 或 $\theta$`)}</h4>
      <CaseSelector cases={cases} />
      <div className="grid-2">
        <ParamControl label={md(`Case ${cases.activeId} 的 $N$`)} ariaLabel={`Case ${cases.activeId} 的 N`} value={cases.active.params.N} onChange={(N) => cases.update({ N })} min={16} max={262144} log integer clampOnBlur reg="REG_GMAC_N" />
        <ParamControl label={md(String.raw`Case ${cases.activeId} 的 $\theta$`)} ariaLabel={`Case ${cases.activeId} 的 θ`} value={cases.active.params.thetaDeg} onChange={(thetaDeg) => cases.update({ thetaDeg })} min={-89} max={89} step={1} unit="°" reg="pll_error_path phase（behavioral）" />
      </div>
      <Plot
        title={String.raw`RMS $\delta_B$ vs $\mu$（各 Case 同一個 $T$、$\delta_0$、$\sigma_v$）`}
        data={caseData}
        xLog
        yLog
        height={300}
        csvName="ch14-lr-cases"
        layout={CASE_LAYOUT}
        caption={md(String.raw`$N$ 改變時曲線整體平移（$\mu^*\propto N$），但最低點幾乎一樣高（F-14.17）；$\theta$ 變大則 $K$ 變小，曲線往右移且變高。`)}
      />
    </ExperimentShell>
  )
}
