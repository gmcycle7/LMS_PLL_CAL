import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ClaimTag,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  mathText,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { normInv, normPdf } from '@/simulation/core'
import {
  TIE_RULE_LABEL,
  TIE_RULES,
  accumulatorBits,
  berryEsseenBound,
  meanQ,
  sumMoments,
  sumVarianceSe,
  type ComparatorMcParams,
  type ComparatorMcResult,
  type ComparatorSweepParams,
  type ComparatorSweepResult,
  type McMethod,
  type TieRule,
} from '@/simulation/models/comparator'
import { Erratum, fx, hline, int, linspace, pct, sig, texInt, texNum, texPct, vline } from '../common'
import {
  DEFAULT_CASE,
  DEFAULT_SHARED,
  EXP_ID,
  analyzeCase,
  caseCurve,
  cltCounts,
  curveNmax,
  labWarnings,
  mcConsistency,
  parsePresetParams,
  sweepNs,
  type LabCase,
  type LabShared,
} from './labModel'

const LEVELS = [0.9, 0.95, 0.99]

/** 合併多組格點並排序、去重（畫圖用）。 */
function mergeGrid(...grids: number[][]): number[] {
  return [...new Set(grids.flat().filter((x) => Number.isFinite(x)))].sort((x, y) => x - y)
}

/** MC 結果連同產生它的參數一起存：參數剛改、新結果還沒回來時，圖上的理論疊線仍以「這份結果自己的參數」計算。 */
type McState = { key: string; params: ComparatorMcParams; res: ComparatorMcResult } | null
type SweepState = { key: string; res: ComparatorSweepResult } | null

/**
 * Comparator Lab（規格 §19：Gaussian PDF、P(+1)、accum histogram；T04 / T05；模型 L1）。
 * 解析值（exact binomial、CLT）在主執行緒即時計算；Monte Carlo 與 P(判對) vs N 掃描在 Web Worker。
 */
export function ComparatorLab() {
  const tokens = useThemeTokens()
  const cases = useCases<LabCase>(DEFAULT_CASE, { seed: 20261010 })
  const [shared, setShared] = useState<LabShared>(DEFAULT_SHARED)
  const c = cases.active.params
  const { update: updateCase, reset: resetCases, setSeed } = cases
  const setCase = useCallback((patch: Partial<LabCase>) => updateCase(patch), [updateCase])
  const setSh = useCallback((patch: Partial<LabShared>) => setShared((s) => ({ ...s, ...patch })), [])

  // ---------------- presets（URL ?preset= 與下拉） ----------------
  const applyPreset = useCallback(
    (params: Record<string, unknown>) => {
      const { c: pc, sh } = parsePresetParams(params)
      updateCase(pc)
      setShared((s) => ({ ...s, ...sh }))
    },
    [updateCase],
  )
  const urlPreset = useUrlPreset(EXP_ID)
  const appliedPreset = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && appliedPreset.current !== urlPreset.id) {
      appliedPreset.current = urlPreset.id
      applyPreset(urlPreset.params)
    }
  }, [urlPreset, applyPreset])
  const presets = useMemo<ExperimentPreset[]>(
    () => presetsForExperiment(EXP_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )

  // ---------------- 解析（即時） ----------------
  const N = shared.N
  const a = useMemo(() => analyzeCase(c, N), [c, N])
  const warnings = useMemo(() => labWarnings(c, a, N), [c, a, N])
  const Nmax = useMemo(() => curveNmax(a, N), [a, N])
  const deferredCases = useDeferredValue(cases.cases)
  const deferredNmax = useDeferredValue(Nmax)
  const curves = useMemo(
    () => deferredCases.map((k) => ({ id: k.id, seriesIndex: k.seriesIndex, params: k.params, curve: caseCurve(k.params, deferredNmax) })),
    [deferredCases, deferredNmax],
  )

  // ---------------- Monte Carlo（worker） ----------------
  const mcTask = useWorkerTask<ComparatorMcParams, ComparatorMcResult>('comparator', 'runComparatorMC', { restartOnRun: true })
  const sweepTask = useWorkerTask<ComparatorSweepParams, ComparatorSweepResult>('comparator', 'runComparatorSweep', { restartOnRun: true })
  const runMc = mcTask.run
  const runSweep = sweepTask.run
  const mcParams = useMemo<ComparatorMcParams>(
    () => ({ s: c.s, sigma: c.sigma, theta: c.theta, N, trials: shared.trials, seed: cases.seed, tieRule: c.tieRule, method: shared.method, level: shared.level }),
    [c, N, shared.trials, shared.method, shared.level, cases.seed],
  )
  const mcKey = JSON.stringify(mcParams)
  const sweepParams = useMemo<ComparatorSweepParams>(
    () => ({ s: c.s, sigma: c.sigma, theta: c.theta, Ns: sweepNs(Nmax), trials: shared.sweepTrials, seed: cases.seed, tieRule: c.tieRule, level: shared.level }),
    [c, Nmax, shared.sweepTrials, shared.level, cases.seed],
  )
  const sweepKey = JSON.stringify(sweepParams)
  const dMcKey = useDebouncedValue(mcKey, 350)
  const dSweepKey = useDebouncedValue(sweepKey, 450)
  const [mc, setMc] = useState<McState>(null)
  const [sweep, setSweep] = useState<SweepState>(null)
  const [mcError, setMcError] = useState<string | null>(null)
  const [sweepError, setSweepError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  /** 使用者按了「停止」：在參數改變或再按 Run 之前不會自動重跑 */
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    const p = JSON.parse(dMcKey) as ComparatorMcParams
    setStopped(false)
    runMc(p)
      .then((res) => {
        setMc({ key: dMcKey, params: p, res })
        setMcError(null)
      })
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setMcError(e instanceof Error ? e.message : String(e))
      })
  }, [dMcKey, nonce, runMc])
  useEffect(() => {
    const p = JSON.parse(dSweepKey) as ComparatorSweepParams
    runSweep(p)
      .then((res) => {
        setSweep({ key: dSweepKey, res })
        setSweepError(null)
      })
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setSweepError(e instanceof Error ? e.message : String(e))
      })
  }, [dSweepKey, nonce, runSweep])

  const mcFresh = mc !== null && mc.key === mcKey
  const sweepFresh = sweep !== null && sweep.key === sweepKey
  const mcRes = mc?.res ?? null
  // 這份 MC 結果自己的 N 與理論矩（結果可能比目前的滑桿舊一拍；疊圖必須用它自己的參數）
  const mcN = mc?.params.N ?? N
  const mcMo = useMemo(() => (mc ? sumMoments(mc.params.N, meanQ(mc.params.s, mc.params.sigma, mc.params.theta ?? 0)) : null), [mc])

  // ---------------- 圖：PDF ----------------
  const pdfData = useMemo<Data[] | null>(() => {
    if (!(c.sigma > 0)) return null
    const lo = Math.min(c.s, c.theta) - 4 * c.sigma
    const hi = Math.max(c.s, c.theta) + 4 * c.sigma
    // 均勻格點 + 在 PDF 中心 s 附近加密（|s − θ| ≫ σ_v 時窄峰才不會被取樣漏掉）
    const xs = mergeGrid(linspace(lo, hi, 401), linspace(c.s - 4 * c.sigma, c.s + 4 * c.sigma, 241), [c.theta])
    const f = (x: number) => normPdf((x - c.s) / c.sigma) / c.sigma
    const shade = xs.filter((x) => x >= c.theta)
    const a0 = Math.min(c.theta, c.s)
    const a1 = Math.max(c.theta, c.s)
    const sliver = linspace(a0, a1, 60)
    const traces: Data[] = [
      { x: xs, y: xs.map(f), name: '$e = s + v$ 的 PDF', mode: 'lines', line: { color: tokens.series[0] } },
      {
        x: [c.theta, ...shade],
        y: [0, ...shade.map(f)],
        name: String.raw`$e \ge \theta$ 的面積 $= P(q=+1) =$ ${fx(a.p, 6)}`,
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: tokens.series[2], width: 0 },
      },
    ]
    if (a1 > a0) {
      traces.push({
        x: sliver,
        y: sliver.map(f),
        name: String.raw`$\theta$ 與 $s$ 之間：$|P(+1) - \tfrac{1}{2}| =$ ${sig(Math.abs(a.p - 0.5), 4)}`,
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: tokens.series[3], width: 0 },
      })
    }
    return traces
  }, [c, a.p, tokens])

  // ---------------- 圖：S 曲線 ----------------
  const sCurve = useMemo<Data[]>(() => {
    const span = c.sigma > 0 ? 4 * c.sigma : Math.max(5, 2 * Math.abs(c.s - c.theta) + 1)
    const lo = Math.min(c.theta - span, c.s - 0.5 * span)
    const hi = Math.max(c.theta + span, c.s + 0.5 * span)
    // 在門檻 θ 附近加密：S 曲線的轉折寬度只有 ~σ_v；σ_v = 0 時在 θ 兩側各放一點，讓階梯是垂直的
    const near = c.sigma > 0 ? linspace(c.theta - 3 * c.sigma, c.theta + 3 * c.sigma, 181) : [c.theta - 1e-9 * Math.max(1, Math.abs(c.theta)), c.theta]
    const xs = mergeGrid(linspace(lo, hi, 401), near, [c.s])
    const traces: Data[] = [
      { x: xs, y: xs.map((x) => meanQ(x, c.sigma, c.theta)), name: String.raw`$E[q]$ vs $s$（精確 $\operatorname{erf}$）`, mode: 'lines', line: { color: tokens.series[0], width: 2.5 } },
    ]
    if (c.sigma > 0) {
      const tx = xs.filter((x) => Math.abs(x - c.theta) <= 1.9 * c.sigma)
      traces.push({ x: tx, y: tx.map((x) => a.Kq * (x - c.theta)), name: String.raw`$K_q$ 切線（$K_q =$ ${sig(a.Kq, 5)} $\mathrm{fs}^{-1}$）`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } })
      const lx = xs.filter((x) => Math.abs(x - c.s) <= 1.2 * c.sigma)
      traces.push({ x: lx, y: lx.map((x) => a.m + a.kLocal * (x - c.s)), name: '操作點的局部切線', mode: 'lines', line: { color: tokens.series[3], dash: 'dot' } })
    }
    traces.push({ x: [c.s], y: [a.m], name: String.raw`操作點 $(s,\,E[q]) =$ (${c.s}, ${sig(a.m, 5)})`, mode: 'markers', marker: { size: 10, color: tokens.series[2] } })
    return traces
  }, [c, a, tokens])

  // ---------------- 圖：histogram ----------------
  const scale = shared.axis === 'average' ? 1 / mcN : 1
  const histData = useMemo<Data[] | null>(() => {
    if (!mcRes || !mcMo) return null
    const { edges, counts, expected } = mcRes.hist
    const width = edges[1] - edges[0]
    const centers = Array.from({ length: counts.length }, (_, i) => (edges[i] + edges[i + 1]) / 2)
    const fine = linspace(edges[0], edges[edges.length - 1], 300)
    const mo = mcMo
    return [
      { x: centers.map((x) => x * scale), y: Array.from(counts), type: 'bar', name: `Monte Carlo（${mcRes.trialsUsed} trials）`, marker: { color: tokens.series[0] }, opacity: 0.6 },
      { x: centers.map((x) => x * scale), y: Array.from(expected), mode: 'markers', name: '精確 Binomial（同一組 bin 的期望個數）', marker: { color: tokens.series[1], size: 7, symbol: 'diamond' } },
      { x: fine.map((x) => x * scale), y: cltCounts(fine, mo, mcRes.trialsUsed, width), mode: 'lines', name: 'CLT Gaussian 近似', line: { color: tokens.series[2], dash: 'dash' } },
    ]
  }, [mcRes, mcMo, scale, tokens])

  // ---------------- 圖：P(判對) vs N ----------------
  const pnData = useMemo<Data[]>(() => {
    const traces: Data[] = []
    for (const k of curves) {
      const col = tokens.series[k.seriesIndex]
      const tag = `${k.id}`
      traces.push({ x: k.curve.oddN, y: k.curve.oddExact, name: `${tag} 精確（奇數 $N$）`, mode: 'lines', line: { color: col, width: 2 } })
      traces.push({ x: k.curve.evenN, y: k.curve.evenExact, name: `${tag} 精確（偶數 $N$，${k.params.tieRule}）`, mode: 'lines', line: { color: col, width: 1, dash: 'dot' } })
      traces.push({ x: k.curve.allN, y: k.curve.cltPlain, name: String.raw`${tag} CLT $\Phi(m\sqrt{N}/\sqrt{1-m^2})$`, mode: 'lines', line: { color: col, width: 1, dash: 'dash' }, opacity: 0.8 })
    }
    if (sweep) {
      const r = sweep.res
      traces.push({
        x: Array.from(r.N),
        y: Array.from(r.correct),
        name: `Monte Carlo ${cases.activeId}（Wilson ${Math.round(shared.level * 100)}%）${sweepFresh ? '' : '：更新中，暫示上一組參數'}`,
        mode: 'markers',
        opacity: sweepFresh ? 1 : 0.35,
        marker: { color: tokens.text, size: 6, symbol: 'circle-open' },
        error_y: { type: 'data', symmetric: false, array: Array.from(r.hi).map((h, i) => h - r.correct[i]), arrayminus: Array.from(r.lo).map((l, i) => r.correct[i] - l), visible: true },
      })
    }
    return traces
  }, [curves, sweep, sweepFresh, tokens, cases.activeId, shared.level])

  const pnCorrected = useMemo<Data[]>(() => {
    const k = curves.find((x) => x.id === cases.activeId)
    if (!k) return []
    return [
      { x: k.curve.evenN, y: k.curve.evenExact, name: '精確（偶數 $N$）', mode: 'lines', line: { color: tokens.series[k.seriesIndex] } },
      { x: k.curve.evenN, y: k.curve.evenCltCorrected, name: 'CLT + 連續性修正（同一 tie rule）', mode: 'lines', line: { color: tokens.series[4], dash: 'dash' } },
      { x: k.curve.allN.filter((n) => n % 2 === 0), y: k.curve.cltPlain.filter((_, i) => k.curve.allN[i] % 2 === 0), name: '規格式（無修正）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
    ]
  }, [curves, cases.activeId, tokens])

  // ---------------- 圖：累加路徑 + 信賴帶（含播放） ----------------
  const path = mcRes?.path ?? null
  const L = path?.length ?? 0
  const [revealed, setRevealed] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    setRevealed(null)
    setPlaying(false)
  }, [mc])
  useEffect(() => {
    if (!playing) return
    if (L === 0 || (revealed ?? L) >= L) {
      setPlaying(false)
      return
    }
    const step = Math.max(1, Math.ceil(L / 150))
    const id = setTimeout(() => setRevealed((r) => Math.min(L, (r ?? 0) + step)), 30)
    return () => clearTimeout(id)
  }, [playing, revealed, L])
  const z = normInv(0.5 + shared.level / 2)
  const mcM = mcMo?.meanAvg ?? a.m // 產生這條路徑的參數所對應的 m = E[q]
  const pathData = useMemo<Data[] | null>(() => {
    if (!path) return null
    const shown = revealed ?? L
    const n = Array.from({ length: L }, (_, i) => i + 1)
    const avg = shared.axis === 'average'
    const v = 1 - mcM * mcM
    const y = Array.from(path.subarray(0, shown), (S, i) => (avg ? S / (i + 1) : S))
    const mean = n.map((k) => (avg ? mcM : k * mcM))
    const half = n.map((k) => (avg ? z * Math.sqrt(v / k) : z * Math.sqrt(k * v)))
    return [
      { x: n, y: mean.map((mu, i) => mu - half[i]), name: String.raw`$-${fx(z, 3)}\cdot\mathrm{SD}$`, mode: 'lines', line: { color: tokens.series[2], width: 0 }, showlegend: false },
      { x: n, y: mean.map((mu, i) => mu + half[i]), name: String.raw`${Math.round(shared.level * 100)}% 帶：$E \pm z\cdot\mathrm{SD}$`, mode: 'lines', fill: 'tonexty', line: { color: tokens.series[2], width: 0 }, opacity: 0.3 },
      { x: n, y: mean, name: avg ? '$E[G] = m$' : String.raw`$E[S_n] = n\cdot m$`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: n.slice(0, shown), y, name: avg ? '第 1 個 trial 的 $G_n = S_n/n$' : '第 1 個 trial 的 $S_n$', mode: 'lines', line: { color: tokens.series[0] } },
    ]
  }, [path, revealed, L, mcM, z, shared.axis, shared.level, tokens])

  // ---------------- 指標與交叉比對 ----------------
  // MC 計數 vs 精確 Binomial 的接受域（只在 MC 結果與目前參數一致時才比）
  const mcCheck = useMemo(() => (mcRes && mcFresh ? mcConsistency(a, N, mcRes) : null), [a, N, mcRes, mcFresh])
  const metrics = useMemo<MetricRow[]>(() => {
    const rows: MetricRow[] = [
      { name: '$P(q=+1)$（理論）', value: a.p, formulaId: 'F-05.1', claim: 'exact', digits: 8 },
      { name: '$E[q]=m$（理論）', value: a.m, formulaId: 'F-05.2', claim: 'exact', digits: 8 },
      { name: String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$`, value: c.sigma > 0 ? a.Kq : '不存在（無雜訊）', unit: String.raw`$\mathrm{fs}^{-1}$`, formulaId: 'F-05.10', claim: 'approx', digits: 6 },
      { name: String.raw`線性化高估 $K_q(s-\theta)/E[q]-1$`, value: c.sigma > 0 && c.s !== c.theta ? a.linErr : null, formulaId: 'F-05.11', claim: 'approx', digits: 4 },
      { name: `$E[S_N]$（$N=${texInt(N)}$）`, value: a.mo.meanSum, formulaId: 'F-05.4', claim: 'exact' },
      { name: String.raw`$\mathrm{SD}(S_N)$`, value: a.mo.sdSum, formulaId: 'F-05.4', claim: 'exact' },
      { name: String.raw`$\mathrm{SNR}_{\mathrm{stat}}=m\sqrt N/\sqrt{1-m^2}$`, value: a.mo.snr, formulaId: 'F-05.5', claim: 'exact' },
      { name: '$P(S_N>0)$（精確）', value: a.split.pos, formulaId: 'F-05.6', claim: 'exact', digits: 6 },
      { name: '$P(S_N=0)$（精確，tie）', value: a.split.tie, formulaId: 'F-05.6', claim: 'exact', digits: 6 },
      { name: '$P(S_N<0)$（精確）', value: a.split.neg, formulaId: 'F-05.6', claim: 'exact', digits: 6 },
      { name: String.raw`$P(\text{判對})$（精確，${c.tieRule}）`, value: a.outcome.correct, formulaId: 'F-05.6', claim: 'exact', digits: 6 },
      {
        name: String.raw`$P(\text{判對})$：CLT 規格式`,
        value: a.cltPlain,
        analytic: a.outcome.correct,
        formulaId: 'F-05.7',
        claim: 'approx',
        digits: 6,
        note: String.raw`$\Delta=\text{CLT}-\text{精確}$；偶數 $N$ 只和 half rule 一致（勘誤 E02）`,
      },
      { name: String.raw`$P(\text{判對})$：CLT + 連續性修正`, value: a.cltCorr.correct, analytic: a.outcome.correct, formulaId: 'F-05.8', claim: 'approx', digits: 6 },
      { name: '95% 所需 $N$：CLT 連續解', value: Number.isFinite(a.n95Clt) ? a.n95Clt : '到不了（E[q] 朝錯誤方向或為 0）', formulaId: 'F-05.9', claim: 'approx', digits: 7 },
      { name: String.raw`95% 所需 $N$：小訊號 $(z\sigma_v/s)^2\pi/2$`, value: Number.isFinite(a.n95Small) ? a.n95Small : null, formulaId: 'F-05.9', claim: 'approx', digits: 7 },
      {
        name: '95% 所需 $N$：精確最小奇數 $N$',
        value: a.n95Exact ?? (Number.isFinite(a.n95Clt) ? '> 5e7（未逐項計算）' : '不存在'),
        formulaId: 'F-05.6',
        claim: 'exact',
      },
    ]
    if (Number.isFinite(a.tieBias)) {
      rows.push({
        name: `tie rule 平衡點偏移 $s^*$（偶數 $N$，${c.tieRule}）`,
        value: a.tieBias,
        unit: 'fs',
        formulaId: 'F-05.19',
        claim: 'exact',
        digits: 5,
        note: String.raw`只對「取 $\operatorname{sign}(S_N)$ 更新」的判號迴路；strict 以硬體 $\operatorname{sign}(0)=-1$ 計算；線性 GMAC 更新無此偏移`,
      })
    }
    if (mcRes && mcCheck) {
      const T = mcRes.trialsUsed
      const seVar = sumVarianceSe(N, a.p, T)
      const band = String.raw`容差 = 精確 Binomial 的等效 $4\sigma$ 接受域（每側機率 $<3.2\times10^{-5}$）`
      rows.push(
        { name: String.raw`MC：$\hat p(q=+1)$`, value: mcRes.pHatPlus, analytic: a.p, tolerance: mcCheck.plus.tol, digits: 7, note: String.raw`$N\cdot T=${texInt(N * T)}$ 個 comparator 決策；${band}` },
        {
          name: String.raw`MC：$\hat P(\text{判對})$`,
          value: mcRes.wilson.p,
          analytic: a.outcome.correct,
          tolerance: mcCheck.correct.tol,
          digits: 5,
          note: `Wilson ${Math.round(shared.level * 100)}% [${fx(mcRes.wilson.lo, 4)}, ${fx(mcRes.wilson.hi, 4)}]；${band}`,
        },
        // 平均 S_N = N(2p̂ − 1)：與 p̂(q = +1) 是同一個統計量，容差也由同一個接受域換算（×2N）
        { name: 'MC：平均 $S_N$', value: mcRes.sumMean, analytic: a.mo.meanSum, tolerance: 2 * N * mcCheck.plus.tol, digits: 6, note: String.raw`$=N(2\hat p-1)$，與上一列同一個統計量` },
        {
          name: String.raw`MC：$\operatorname{Var}(S_N)$`,
          value: mcRes.sumVar,
          analytic: a.mo.varSum,
          tolerance: Number.isFinite(seVar) && seVar > 0 ? 6 * seVar : 1e-9,
          digits: 6,
          note: String.raw`容差 $6\cdot\mathrm{SE}(s^2)$，SE 以 Binomial 的四階矩計算（$N$ 大時 $\to\operatorname{Var}\cdot\sqrt{2/T}$）`,
        },
        { name: 'MC：tie 比例', value: mcRes.counts.tie / T, analytic: a.split.tie, tolerance: mcCheck.tie.tol, digits: 5, note: band },
      )
    }
    return rows
  }, [a, c, N, mcRes, mcCheck, shared.level])

  const crossCheck = useMemo(() => {
    // Analytic：兩個獨立的解析結果互相檢查——exact binomial 三種結果相加 = 1，且規格 CLT 與精確值的差不超過 Berry–Esseen 上界（F-05.18）
    const sum = a.split.pos + a.split.tie + a.split.neg
    const exactStrict = a.t > 0 ? a.split.pos : a.split.neg
    const cltErr = Math.abs(a.cltPlain - exactStrict)
    const be = berryEsseenBound(a.m, N)
    const analytic: CheckEntry =
      Math.abs(sum - 1) < 1e-9 && cltErr <= be + 1e-12
        ? {
            status: 'ok',
            note: String.raw`exact binomial 三種結果相加 = 1（$|\Delta|=${texNum(Math.abs(sum - 1), 2)}$）；CLT 與精確的 $P(S_N\text{ 與 }s\text{ 同號})$ 相差 $${texNum(cltErr, 3)}\le${texNum(be, 3)}$（Berry–Esseen 上界）`,
          }
        : { status: 'mismatch', note: String.raw`exact binomial 三種結果相加 = $${texNum(sum, 12)}$；CLT 與精確值相差 $${texNum(cltErr, 3)}$，Berry–Esseen 上界 $${texNum(be, 3)}$` }
    let monteCarlo: CheckEntry = { status: 'n/a', note: stopped ? '已停止（按 Run 重新計算）' : '計算中…' }
    if (mcCheck) {
      monteCarlo = { status: mcCheck.ok ? 'ok' : 'mismatch', note: `MC 計數 vs 精確 Binomial：${mcCheck.detail}` }
    } else if (mcError) {
      monteCarlo = { status: 'n/a', note: `Monte Carlo 失敗：${mcError}` }
    }
    return {
      analytic,
      monteCarlo,
      fixedPoint: {
        status: 'n/a' as const,
        note: String.raw`$q=\pm1$ 與整數累加 $S_N$ 本身就是 bit-exact（MC 以 Int32 累加）；$N=${texInt(N)}$ 時 two's-complement 累加器需 ${accumulatorBits(N)} bits 才不溢位。位寬不足造成的 wrap 見 Ch13。`,
      },
    }
  }, [a, N, mcCheck, mcError, stopped])

  const allWarnings = useMemo(() => {
    const w = [...warnings]
    if (mcCheck && !mcCheck.ok) {
      w.push(
        String.raw`Monte Carlo 與精確值不一致：${mcCheck.detail}。若模型正確，這種偏離在每次模擬中發生的機率不到 $2\times10^{-4}$；請先換一個 seed 重跑——若仍然不一致，代表 MC 與解析用了不同的 tie rule 或亂數引擎有誤。`,
      )
    }
    if (mcError) w.push(`Monte Carlo 無法執行：${mcError}`)
    if (sweepError) w.push(String.raw`$P(\text{判對})$ vs $N$ 的 Monte Carlo 掃描無法執行：${sweepError}`)
    return w
  }, [warnings, mcCheck, mcError, sweepError])

  const exportData = useCallback(() => {
    const out: Record<string, ArrayLike<number | string | null>> = {}
    const active = curves.find((k) => k.id === cases.activeId)
    if (active) {
      out.curve_N_odd = active.curve.oddN
      out.curve_exact_odd = active.curve.oddExact
      out.curve_N_even = active.curve.evenN
      out.curve_exact_even = active.curve.evenExact
      out.curve_N_all = active.curve.allN
      out.curve_clt_plain = active.curve.cltPlain
    }
    if (mcRes) {
      const { edges, counts, expected } = mcRes.hist
      out.hist_center_sum = Array.from({ length: counts.length }, (_, i) => (edges[i] + edges[i + 1]) / 2)
      out.hist_count = counts
      out.hist_expected_exact = expected
      out.path_S_n = mcRes.path
    }
    if (sweep) {
      out.sweep_N = sweep.res.N
      out.sweep_p_hat = sweep.res.correct
      out.sweep_wilson_lo = sweep.res.lo
      out.sweep_wilson_hi = sweep.res.hi
      out.sweep_exact = sweep.res.exact
    }
    return out
  }, [curves, cases.activeId, mcRes, sweep])

  const running = mcTask.running || sweepTask.running
  const statusText = running
    ? 'Monte Carlo 計算中…'
    : mcFresh
      ? `Monte Carlo 完成（${mcRes?.methodUsed} 引擎${mcTask.lastDurationMs !== null ? `，${Math.round(mcTask.lastDurationMs)} ms` : ''}，執行模式 ${mcTask.mode}）`
      : stopped
        ? '已停止：圖上的 Monte Carlo 是上一組參數的結果；按 Run 重新計算。'
        : '等待參數穩定…'

  return (
    <ExperimentShell
      id={EXP_ID}
      title="Comparator Lab：1-bit 決策、累加 $S_N$ 與方向正確率"
      level="L1"
      claim="exact"
      source="simulation"
      tests={['T04', 'T05']}
      headingLevel={3}
      description={
        <>
          <Tex>{'e=s+v'}</Tex>、<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>、<Tex>{'q=+1\\iff e\\ge\\theta'}</Tex>；累加 <Tex>{'S_N=\\sum q_i'}</Tex>。
          解析曲線（exact binomial / CLT）與 Monte Carlo 使用<strong>同一條 tie rule</strong> <Erratum id="E02" />；histogram 與信賴帶可切換 sum／average 尺度{' '}
          <Erratum id="E18" />。Case A/B/C 會疊在「<Tex>{'P(\\text{判對})'}</Tex> vs <Tex>{'N'}</Tex>」圖上做比較。
        </>
      }
      assumptions={[
        '$s$ 在 $N$ 個樣本內固定（不考慮 LMS 迴路在累加期間更新）',
        '$v$ iid Gaussian、與 $s$ 獨立（時間相關雜訊見章末的 Research 延伸）',
        String.raw`$x\equiv1$：$S_N$ 是 $x\equiv1$ 時的 GMAC 總和；§0 的平均 $G_k=S_N/N$（勘誤 E07 / E18）`,
        String.raw`硬體慣例 $e\ge\theta\Rightarrow q=+1$；連續雜訊下單一樣本 tie 機率為 0，$S_N=0$ 依選定的 tie rule`,
        String.raw`「判對」= $\operatorname{sign}(S_N)$ 與 $\operatorname{sign}(s)$ 相同；$s=0$ 時以 $+1$ 為參考方向`,
      ]}
      params={{ s: c.s, sigma_v: c.sigma, theta: c.theta, N, tie_rule: c.tieRule, trials: shared.trials, mc_method: shared.method, axis: shared.axis, ci_level: shared.level, sweep_trials: shared.sweepTrials, active_case: cases.activeId }}
      seed={cases.seed}
      onSeedChange={setSeed}
      units={{ s: 'fs', sigma_v: 'fs', theta: 'fs', N: 'samples', trials: '—', K_q: 'fs⁻¹' }}
      metrics={metrics}
      warnings={allWarnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          resetCases(DEFAULT_CASE)
          setShared(DEFAULT_SHARED)
        },
        onRun: () => setNonce((k) => k + 1),
        onStop: () => {
          mcTask.cancel()
          sweepTask.cancel()
          setStopped(true)
        },
        // Single Step：把第 1 個 trial 的累加過程往前推一個 comparator sample（圖 ⑥）
        onStep: () => {
          setPlaying(false)
          setRevealed((r) => (r === null || r >= L ? Math.min(1, L) : r + 1))
        },
        running,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <div className="ch05-controls">
          <CaseSelector cases={cases} label="比較組（各自的固定誤差、雜訊 RMS、門檻與 tie rule）" />
          <ParamControl label={mathText(`$s$（固定誤差）— Case ${cases.activeId}`)} ariaLabel={`s（固定誤差）— Case ${cases.activeId}`} value={c.s} onChange={(s) => setCase({ s })} min={-100} max={100} step={0.01} unit="fs" reg="Behavioral: s = DTC residual (a − w)" hint="要辨識正負號的誤差" />
          <ParamControl
            label={mathText(String.raw`$\sigma_v$（雜訊 RMS）— Case ${cases.activeId}`)}
            ariaLabel={`σ_v（雜訊 RMS）— Case ${cases.activeId}`}
            value={c.sigma}
            onChange={(sigma) => setCase({ sigma })}
            min={0}
            max={500}
            step={0.5}
            unit="fs"
            reg="Behavioral: σ_v（BBPD 輸入參考雜訊）"
            hint="0 = hard limiter（無雜訊）"
          />
          <ParamControl
            label={mathText(String.raw`$\theta$（threshold / offset）— Case ${cases.activeId}`)}
            ariaLabel={`θ（threshold / offset）— Case ${cases.activeId}`}
            value={c.theta}
            onChange={(theta) => setCase({ theta })}
            min={-100}
            max={100}
            step={0.01}
            unit="fs"
            reg="Behavioral: θ（comparator offset）"
            hint={
              <>
                理想 0；<Tex>{'|\\theta|>|s|'}</Tex> 且同號時會判錯方向
              </>
            }
          />
          <SelectControl<TieRule>
            label={mathText(`tie rule（$S_N=0$）— Case ${cases.activeId}`)}
            ariaLabel={`tie rule（S_N = 0）— Case ${cases.activeId}`}
            value={c.tieRule}
            onChange={(tieRule) => setCase({ tieRule })}
            options={TIE_RULES.map((r) => ({ value: r, label: TIE_RULE_LABEL[r] }))}
            reg="REG_GMAC_TIE_MODE[1:0]"
            hint={mathText('只影響偶數 $N$')}
          />
          <ParamControl label={mathText('$N$（累加樣本數，所有 Case 共用）')} ariaLabel="N（累加樣本數，所有 Case 共用）" value={N} onChange={(v) => setSh({ N: v })} min={1} max={1e7} log integer clampOnBlur unit="samples" reg="REG_GMAC_N[23:0]" hint={mathText('試試 $N=100$ 與 $N=101$')} />
          <ParamControl label={mathText('Monte Carlo trials $T$')} ariaLabel="Monte Carlo trials T" value={shared.trials} onChange={(v) => setSh({ trials: v })} min={10} max={200000} log integer clampOnBlur reg="Sim: MC trials" />
          <SelectControl<McMethod>
            label="MC 引擎"
            value={shared.method}
            onChange={(method) => setSh({ method })}
            options={[
              { value: 'auto', label: 'auto（N·T ≤ 4e6 用 sample-level）' },
              { value: 'sample', label: 'sample-level（逐個 Gaussian）' },
              { value: 'binomial', label: 'binomial（K ~ Bin(N, p) 精確抽樣）' },
            ]}
            reg="Sim: MC engine"
          />
          <SelectControl<'sum' | 'average'>
            label="累加量的尺度（勘誤 E18）"
            value={shared.axis}
            onChange={(axis) => setSh({ axis })}
            options={[
              { value: 'sum', label: 'sum：S_N = Σ q_i' },
              { value: 'average', label: 'average：G = S_N / N' },
            ]}
            reg="GMAC output scaling（sum / average）"
          />
          <SelectControl<number>
            label="信賴水準"
            value={shared.level}
            onChange={(level) => setSh({ level })}
            options={LEVELS.map((l) => ({ value: l, label: `${Math.round(l * 100)}%` }))}
            reg="Sim: CI level"
          />
          <ParamControl label={mathText(String.raw`$P(\text{判對})$ vs $N$ 掃描：每點 trials`)} ariaLabel="P(判對) vs N 掃描：每點 trials" value={shared.sweepTrials} onChange={(v) => setSh({ sweepTrials: v })} min={100} max={20000} log integer clampOnBlur reg="Sim: sweep trials" />
        </div>
      }
    >
      <div className="ch05-kpis" aria-live="polite">
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            <Tex>{'P(q=+1)=\\Phi\\big(\\tfrac{s-\\theta}{\\sigma_v}\\big)'}</Tex>
          </div>
          <div className="ch05-kpi-value">{fx(a.p, 6)}</div>
        </div>
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            <Tex>{'m=E[q]'}</Tex>
          </div>
          <div className="ch05-kpi-value">{sig(a.m, 6)}</div>
        </div>
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            <Tex>{'K_q\\;(\\mathrm{fs}^{-1})'}</Tex>
          </div>
          <div className="ch05-kpi-value">
            {c.sigma > 0 ? (
              sig(a.Kq, 6)
            ) : (
              <>
                <Tex>{'\\infty'}</Tex>（不存在）
              </>
            )}
          </div>
        </div>
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            <Tex>{'P(\\text{判對})'}</Tex> 精確（{c.tieRule}）
          </div>
          <div className="ch05-kpi-value">{pct(a.outcome.correct, 3)}</div>
        </div>
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            CLT <Tex>{'\\Phi(m\\sqrt N/\\sqrt{1-m^2})'}</Tex>
          </div>
          <div className="ch05-kpi-value">{pct(a.cltPlain, 3)}</div>
        </div>
        <div className="ch05-kpi">
          <div className="ch05-kpi-label">
            MC <Tex>{'\\hat P(\\text{判對})'}</Tex> [{Math.round(shared.level * 100)}% Wilson]
          </div>
          <div className="ch05-kpi-value">
            {mcRes && mcFresh ? (
              <>
                {pct(mcRes.wilson.p, 2)}
                <span className="ch05-note">
                  {' '}
                  [{pct(mcRes.wilson.lo, 2)}, {pct(mcRes.wilson.hi, 2)}]
                </span>
              </>
            ) : (
              '…'
            )}
          </div>
        </div>
      </div>
      <p className="ch05-status" role="status">
        {statusText}
        {mcRes?.notes.length ? `；${mcRes.notes.join('；')}` : ''}
      </p>
      {N % 2 === 0 && (
        <p className="ch05-note">
          <Tex>{`N=${N}`}</Tex> 是偶數：<Tex>{`P(S_N=0)=${texPct(a.split.tie, 3)}`}</Tex>。依 {TIE_RULE_LABEL[c.tieRule]}：判對 {pct(a.outcome.correct, 3)}、判錯{' '}
          {pct(a.outcome.wrong, 3)}
          {a.outcome.hold > 0 ? `、不動 ${pct(a.outcome.hold, 3)}` : ''}。改成 <Tex>{`N=${N + 1}`}</Tex> 就沒有 tie。
        </p>
      )}

      <div className="ch05-plots">
        {pdfData ? (
          <Plot
            title="① $e=s+v$ 的 PDF；陰影 = $P(q=+1)$"
            data={pdfData}
            layout={{
              xaxis: { title: { text: '$e$（fs）' } },
              yaxis: { title: { text: 'PDF（1/fs）' } },
              shapes: [vline(c.theta, tokens.series[1]), vline(c.s, tokens.textMuted, 'dot')],
              // θ 與 s 常常只差幾 fs（圖上幾乎同一條線）：兩個標籤放在圖框中間的高度，分別靠在各自那條線的左右兩側，不疊在一起，也不碰到上方的圖例
              annotations: [
                { x: c.theta, y: 0.5, yref: 'paper', text: String.raw`$\theta$`, showarrow: false, yanchor: 'middle', xanchor: c.s >= c.theta ? 'right' : 'left', xshift: c.s >= c.theta ? -3 : 3 },
                { x: c.s, y: 0.5, yref: 'paper', text: '$s$', showarrow: false, yanchor: 'middle', xanchor: c.s >= c.theta ? 'left' : 'right', xshift: c.s >= c.theta ? 3 : -3 },
              ],
            }}
            height={280}
            csvName="ch05-lab-pdf"
            caption={
              <>
                <Tex>{'e\\ge\\theta'}</Tex> 的陰影面積 <Tex>{`\\Phi\\big((s-\\theta)/\\sigma_v\\big)=${fx(a.p, 6)}`}</Tex>；<Tex>{'\\theta'}</Tex> 與 <Tex>{'s'}</Tex> 之間那一條就是{' '}
                <Tex>{'|P(+1)-\\tfrac12|'}</Tex>。<Tex>{'|s|\\ll\\sigma_v'}</Tex> 時這塊多出來的面積非常窄——這正是「<Tex>{String.raw`1\,\mathrm{fs}`}</Tex> 埋在 <Tex>{String.raw`100\,\mathrm{fs}`}</Tex> 裡」的樣子。
              </>
            }
          />
        ) : (
          <div className="card">
            <strong>① PDF</strong>
            <p className="ch05-note">
              <Tex>{'\\sigma_v=0'}</Tex>：<Tex>{'e'}</Tex> 的 PDF 退化成 <Tex>{'e=s'}</Tex> 處的 Dirac 脈衝，<Tex>{'q'}</Tex> 每次都是 <Tex>{a.p === 1 ? '+1' : '-1'}</Tex>。
            </p>
          </div>
        )}
        <Plot
          title="② S 曲線 $E[q]$ vs $s$、$K_q$ 切線與操作點"
          data={sCurve}
          layout={{ xaxis: { title: { text: '$s$（fs）' } }, yaxis: { title: { text: '$E[q]$' }, range: [-1.15, 1.15] }, shapes: [vline(c.theta, tokens.series[1])] }}
          height={280}
          csvName="ch05-lab-scurve"
          caption={
            c.sigma > 0 ? (
              <>
                操作點的局部斜率 <Tex>{`dE[q]/ds=${fx(a.kLocal / a.Kq, 4)}\\,K_q`}</Tex>；線性化 <Tex>{'K_q(s-\\theta)'}</Tex> 高估 {pct(a.linErr, 3)}。
              </>
            ) : (
              <>
                <Tex>{'\\sigma_v=0'}</Tex>：階梯函數，沒有有限的斜率。
              </>
            )
          }
        />
      </div>

      {histData ? (
        <Plot
          title={`③ ${shared.axis === 'sum' ? '$S_N$' : '$G=S_N/N$'} 的 histogram：Monte Carlo vs 精確 Binomial vs CLT（$N=${texInt(mcN)}$${mcFresh ? '' : '，更新中'}）`}
          data={histData}
          layout={{
            xaxis: { title: { text: shared.axis === 'sum' ? String.raw`$S_N = \sum q_i$` : '$G = S_N / N$' } },
            yaxis: { title: { text: '個數（每個 bin）' } },
            bargap: 0.05,
            shapes: [vline(0, tokens.series[1]), vline((mcMo?.meanSum ?? 0) * scale, tokens.series[2], 'dot')],
          }}
          height={300}
          csvName="ch05-lab-hist"
          caption={
            <>
              bin 邊界放在 <Tex>{'S_N'}</Tex> 的格點中點（<Tex>{'S_N'}</Tex> 與 <Tex>{'N'}</Tex> 同奇偶、間距 2），所以每個 bin 包含整數個格點，精確 Binomial 的期望個數可以逐 bin 加總。
              虛線 = 決策門檻 0；點線 = <Tex>{`E[${shared.axis === 'sum' ? 'S_N' : 'G'}]=${texNum((mcMo?.meanSum ?? 0) * scale, 5)}`}</Tex>。
              {mcRes && mcRes.hist.outside > 0 ? (
                <>
                  <Tex>{'E\\pm4.5\\,\\mathrm{SD}'}</Tex> 範圍外 {mcRes.hist.outside} 筆未畫出。
                </>
              ) : null}
            </>
          }
        />
      ) : (
        <p className="ch05-note">Monte Carlo 計算中…</p>
      )}

      <Plot
        title={String.raw`④ $P(\text{判對})$ vs $N$：精確（奇／偶）、CLT 與 Monte Carlo（Wilson 區間）`}
        data={pnData}
        layout={{
          xaxis: { title: { text: '$N$（樣本數）' } },
          yaxis: { title: { text: String.raw`$P(\text{判對})$` } },
          shapes: [vline(N, tokens.textMuted, 'dot'), hline(0.95, tokens.series[1]), hline(0.99, tokens.series[1])],
        }}
        xLog
        height={340}
        csvName="ch05-lab-pcorrect"
        caption={
          <>
            <Tex>{'N\\le120'}</Tex> 逐一列出（看得到奇偶鋸齒），之後對數取樣。Monte Carlo 點使用 binomial 引擎、每點 {shared.sweepTrials} trials
            {sweepFresh ? '' : '（更新中）'}。水平線 = 95% 與 99%。
          </>
        }
      />
      <ModeGate min="engineer">
        <Plot
          title={String.raw`⑤ 偶數 $N$：連續性修正 $\Phi((Nm\mp1)/\sigma_S)$ 對上精確值（Case ${cases.activeId}，${c.tieRule}）`}
          data={pnCorrected}
          layout={{ xaxis: { title: { text: '$N$（偶數）' } }, yaxis: { title: { text: String.raw`$P(\text{判對})$` } } }}
          xLog
          height={280}
          csvName="ch05-lab-continuity"
          caption={
            <>
              strict / skip 用 <Tex>{'\\Phi((Nm-1)/\\sigma_S)'}</Tex>，<Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 用 <Tex>{'\\Phi((Nm+1)/\\sigma_S)'}</Tex>，half 取兩者平均（
              <Tex>{'\\approx\\Phi(Nm/\\sigma_S)'}</Tex>）。無修正的規格式只對 half 正確。
            </>
          }
        />
      </ModeGate>

      {pathData && (
        <>
          <div className="ch05-row">
            <button type="button" className="btn" onClick={() => {
              setRevealed(0)
              setPlaying(true)
            }} disabled={playing}>
              ▶ 播放累加過程
            </button>
            {playing && (
              <button type="button" className="btn" onClick={() => setPlaying(false)}>
                暫停
              </button>
            )}
            <span className="ch05-note">
              顯示第 1 個 trial 的前 {int(L)} 個樣本（另一個 rng fork，不影響統計）
            </span>
          </div>
          <Plot
            title={`⑥ 逐樣本累加${shared.axis === 'sum' ? ' $S_n$' : '平均 $G_n=S_n/n$'} 與 ${Math.round(shared.level * 100)}% 信賴帶`}
            data={pathData}
            layout={{
              xaxis: { title: { text: '$n$（comparator sample）' } },
              yaxis: { title: { text: shared.axis === 'sum' ? '$S_n$' : '$G_n$' } },
              shapes: [{ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 0, y1: 0, line: { color: tokens.series[1], width: 1 } }],
            }}
            height={300}
            csvName="ch05-lab-path"
            caption={
              shared.axis === 'sum' ? (
                <>
                  帶寬 <Tex>{'\\propto\\sqrt n'}</Tex>、平均線 <Tex>{'\\propto n'}</Tex>：路徑要等平均線「爬出」信賴帶，方向才確定（帶的下緣跨過 0 時{' '}
                  <Tex>{'n\\approx z^2(1-m^2)/m^2'}</Tex>）。
                </>
              ) : (
                <>
                  平均的帶寬 <Tex>{'\\propto1/\\sqrt n'}</Tex> 收窄，中心是 <Tex>{'m'}</Tex>（勘誤 E18：同一個隨機過程，換 average 尺度後誤差帶差 <Tex>{'n'}</Tex> 倍）。
                </>
              )
            }
          />
        </>
      )}
      <p className="ch05-note">
        <ClaimTag kind="exact" /> 精確曲線：<Tex>{'q_i'}</Tex> iid 下的 Binomial；<ClaimTag kind="approx" /> CLT 曲線；Monte Carlo 為 seed {cases.seed}{' '}
        的模擬結果（L1，非實測）。
      </p>
    </ExperimentShell>
  )
}
