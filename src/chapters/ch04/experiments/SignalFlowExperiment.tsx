import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  TexBlock,
  useCases,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { deriveSeed } from '@/simulation/core'
import { runBlockLms, type BlockLmsConfigInput, type BlockLmsResult } from '@/simulation/models/blockLms'
import type { CodeNormalization } from '@/simulation/models/dsm'
import {
  gmacAverage,
  gmacConditionalMoments,
  gmacRunningSum,
  gmacSum,
  type ComparatorEncoding,
  type GmMode,
} from '@/simulation/models/gmac'
import { f, mt, tx, txp } from '../common'
import { texifyModelText } from '../modelText'
import { useCasePresets } from './presetHooks'

const R = String.raw
export const SIGNAL_FLOW_ID = 'gmac-signal-flow'

type PatternKind = 'iid_pm_one' | 'gaussian' | 'uniform' | 'sinusoid' | 'dsm_first_order' | 'mash111'

export interface FlowShared {
  N: number
  numBlocks: number
  sigmaV: number
  aTrue: number
  w0: number
  pattern: PatternKind
  normalization: CodeNormalization
  path: 'identity' | 'first_order_hp'
  hpPole: number
  encoding: ComparatorEncoding
}

export interface FlowCase {
  gmMode: GmMode
  mu: number
}

export const DEFAULT_FLOW_SHARED: FlowShared = {
  N: 16,
  numBlocks: 24,
  sigmaV: 20,
  aTrue: 30,
  w0: 0,
  pattern: 'iid_pm_one',
  normalization: 'unit_rms',
  path: 'identity',
  hpPole: 0.5,
  encoding: 'bipolar_pm_one',
}
export const DEFAULT_FLOW_CASE: FlowCase = { gmMode: 'average', mu: 10 }

const PATTERN_LABEL: Record<PatternKind, string> = {
  iid_pm_one: 'iid ±1',
  gaussian: 'Gaussian',
  uniform: 'Uniform',
  sinusoid: 'Sinusoid（Ω = π/6）',
  dsm_first_order: '一階 DSM residue（frac 0.3）',
  mash111: 'MASH 1-1-1 residue（frac 0.3）',
}

const ENCODING_LABEL: Record<ComparatorEncoding, string> = {
  bipolar_pm_one: 'bipolar ±1（q = sign(e)）',
  unipolar_mapped: '硬體 0/1，q = 2b − 1',
  unipolar_unmapped_bug: '硬體 0/1，忘了映射（bug）',
}

export function flowConfig(s: FlowShared, c: FlowCase, seed: number): BlockLmsConfigInput {
  return {
    seed,
    gm_accum_samples: s.N,
    num_blocks: s.numBlocks,
    gain_step: c.mu,
    gm_mode: c.gmMode,
    pd_noise_rms_fs: s.sigmaV,
    gain_true: s.aTrue,
    gain_initial: s.w0,
    code_normalization: s.normalization,
    comparator_encoding: s.encoding,
    pll_error_path: s.path === 'identity' ? { kind: 'identity', parameters: {} } : { kind: 'first_order_hp', parameters: { pole: s.hpPole } },
    seeded_pattern: { kind: s.pattern, parameters: {} } as BlockLmsConfigInput['seeded_pattern'],
    record: { sample_trace_blocks: s.numBlocks, decimate: 1 },
  }
}

type RunOut = { res: BlockLmsResult | null; error: string | null }

/**
 * 解析交叉比對（純函式）：給定 code 與 w_k 時，G_k 只剩 comparator 雜訊是隨機的 ⇒ 條件平均與標準差可精確計算（gmacConditionalMoments）。
 * identity path 檢查全部 block；非 identity 時濾波器狀態跨 block 延續，只有 block 0 的 e_det = δ_0·u 精確。
 * 回傳：aggZ = Σ(G_k − m_k)/√Σsd_k²（判定用）、maxAbsZ（單一 block，參考）、maxImpl（gmac.ts 由 trace 重算 vs blockLms 的最大差）。
 */
export function flowAnalyticCheck(
  res: BlockLmsResult,
  shared: FlowShared,
  gmMode: GmMode,
): { maxAbsZ: number; maxImpl: number; nBlocks: number; aggZ: number; sumDiff: number; sumVar: number } {
  const N = shared.N
  const nBlocks = shared.path === 'identity' ? shared.numBlocks : 1
  let maxAbsZ = 0
  let maxImpl = 0
  let sumDiff = 0
  let sumVar = 0
  for (let kk = 0; kk < nBlocks; kk++) {
    const i0 = kk * N
    const u = res.trace.u.subarray(i0, i0 + N)
    const xr = res.trace.xRef.subarray(i0, i0 + N)
    const q = res.trace.q.subarray(i0, i0 + N)
    const delta = shared.aTrue - res.blocks.wPhys[kk]
    const eDet = Array.from(u, (v) => delta * v)
    const mom = gmacConditionalMoments(eDet, xr, shared.sigmaV, shared.encoding, gmMode)
    const G = res.blocks.G[kk]
    if (Number.isFinite(G)) {
      const z = mom.sd > 0 ? (G - mom.mean) / mom.sd : Math.abs(G - mom.mean) < 1e-9 ? 0 : Infinity
      maxAbsZ = Math.max(maxAbsZ, Math.abs(z))
      sumDiff += G - mom.mean
      sumVar += mom.sd * mom.sd
      const Gm = gmMode === 'average' ? gmacAverage(q, xr) : gmacSum(q, xr)
      maxImpl = Math.max(maxImpl, Math.abs(Gm - G))
    }
  }
  // 各 block 的雜訊獨立 ⇒ Σ(G_k − E[G_k]) 的變異數 = Σ sd_k²；加總 N·blocks 個 sample 後近似 Gaussian（單一 block 在小 N 時是離散分布，max|z| 只當參考）
  const aggZ = sumVar > 0 ? sumDiff / Math.sqrt(sumVar) : Math.abs(sumDiff) < 1e-9 ? 0 : Infinity
  return { maxAbsZ, maxImpl, nBlocks, aggZ, sumDiff, sumVar }
}

/** Monte Carlo 的 seed 數（每個 seed 換一組 code 與雜訊） */
export const FLOW_MC_RUNS = 16

/**
 * Monte Carlo 交叉比對（純函式）：以 deriveSeed(seed, 'mc-i') 另跑 runs 次（每次的 code 與雜訊都不同），
 * 把所有 block 的 G_k − E[G_k | codes, w_k] 加總後除以 √Σsd_k²。若條件平均 / 變異數的解析式（erf 模型）正確，z ~ N(0, 1)。
 * 回傳 z、用到的 block 數與失敗的 run 數。σ_v = 0 時 G 為確定值（Σsd² = 0）：差值必須為 0。
 */
export function flowMonteCarlo(shared: FlowShared, c: FlowCase, seed: number, runs = FLOW_MC_RUNS): { z: number; blocks: number; runs: number; failed: number; sumDiff: number } {
  let sumDiff = 0
  let sumVar = 0
  let blocks = 0
  let failed = 0
  for (let i = 0; i < runs; i++) {
    const r = safeRun(flowConfig(shared, c, deriveSeed(seed, `mc-${i}`)))
    if (!r.res) {
      failed++
      continue
    }
    const chk = flowAnalyticCheck(r.res, shared, c.gmMode)
    sumDiff += chk.sumDiff
    sumVar += chk.sumVar
    blocks += chk.nBlocks
  }
  const z = sumVar > 0 ? sumDiff / Math.sqrt(sumVar) : Math.abs(sumDiff) < 1e-9 ? 0 : Infinity
  return { z, blocks, runs, failed, sumDiff }
}

function safeRun(cfg: BlockLmsConfigInput): RunOut {
  try {
    return { res: runBlockLms(cfg), error: null }
  } catch (e) {
    return { res: null, error: (e as Error).message }
  }
}

interface Cursor {
  k: number
  /** 已累加的 sample 數 0…N（N = block 完成，顯示更新） */
  c: number
  key: string
}

export function SignalFlowExperiment() {
  const [shared, setShared] = useState<FlowShared>(DEFAULT_FLOW_SHARED)
  const [seed, setSeed] = useState(20261010)
  const cases = useCases<FlowCase>(DEFAULT_FLOW_CASE, { seed })
  const tokens = useThemeTokens()
  const applyShared = useCallback((p: Record<string, unknown>) => setShared({ ...DEFAULT_FLOW_SHARED, ...(p as Partial<FlowShared>) }), [])
  const { presets, load } = useCasePresets<FlowCase>({ experiment: SIGNAL_FLOW_ID, cases, applyShared, setSeed })

  const runs = useMemo(() => cases.cases.map((c) => ({ id: c.id, color: tokens.series[c.seriesIndex], params: c.params, ...safeRun(flowConfig(shared, c.params, seed)) })), [cases.cases, shared, seed, tokens])
  const active = runs.find((r) => r.id === cases.activeId) ?? runs[0]
  const res = active.res
  const N = shared.N
  const K = shared.numBlocks

  // ── 游標（參數改變時回到 block 0 開頭）──
  const resetKey = JSON.stringify([shared, seed, cases.activeId, cases.cases.map((c) => c.params)])
  const [cur, setCur] = useState<Cursor>({ k: 0, c: 0, key: resetKey })
  if (cur.key !== resetKey) setCur({ k: 0, c: 0, key: resetKey })
  const k = Math.min(cur.k, K - 1)
  const c = Math.min(cur.c, N)
  const [running, setRunning] = useState(false)
  const step = useCallback(() => {
    setCur((p) => {
      if (p.c < N) return { ...p, c: p.c + 1 }
      if (p.k < K - 1) return { ...p, k: p.k + 1, c: 0 }
      return p
    })
  }, [N, K])
  const atEnd = k >= K - 1 && c >= N
  useEffect(() => {
    if (!running) return
    if (atEnd) {
      setRunning(false)
      return
    }
    const id = setInterval(step, 300)
    return () => clearInterval(id)
  }, [running, atEnd, step])

  // ── 目前 block 的資料 ──
  const blk = useMemo(() => {
    if (!res) return null
    const i0 = k * N
    const sl = (a: Float64Array) => a.subarray(i0, i0 + N)
    const x = sl(res.trace.x)
    const u = sl(res.trace.u)
    const e = sl(res.trace.e)
    const q = sl(res.trace.q)
    const xr = sl(res.trace.xRef)
    const S = gmacRunningSum(q, xr)
    const mode = active.params.gmMode
    const Gmine = mode === 'average' ? gmacAverage(q, xr) : gmacSum(q, xr)
    const wk = res.blocks.wPhys[k]
    const bits = Array.from(q, (v) => (shared.encoding === 'unipolar_unmapped_bug' ? v : (v + 1) / 2))
    return { i0, x, u, e, q, xr, S, Gmine, Gsim: res.blocks.G[k], wk, wNext: res.blocks.w[k + 1], bits }
  }, [res, k, N, active.params.gmMode, shared.encoding])

  // ── 解析交叉比對：給定 code 時 G_k 的條件平均 ± 標準差（只有雜訊是隨機的）──
  const check = useMemo(() => (res ? flowAnalyticCheck(res, shared, active.params.gmMode) : null), [res, shared, active.params.gmMode])

  // ── Monte Carlo 交叉比對：16 個衍生 seed（小 N、少 block，inline 計算約數 ms；用 deferred 值避免拖動滑桿時卡住）──
  const dShared = useDeferredValue(shared)
  const dCase = useDeferredValue(active.params)
  const dSeed = useDeferredValue(seed)
  const mc = useMemo(() => flowMonteCarlo(dShared, dCase, dSeed), [dShared, dCase, dSeed])

  const momNow = useMemo(() => {
    if (!res || !blk || (shared.path !== 'identity' && k > 0)) return null
    const delta = shared.aTrue - blk.wk
    return gmacConditionalMoments(Array.from(blk.u, (v) => delta * v), blk.xr, shared.sigmaV, shared.encoding, active.params.gmMode)
  }, [res, blk, shared, k, active.params.gmMode])

  const warnings: string[] = []
  for (const r of runs) {
    if (r.error) warnings.push(`Case ${r.id}：${r.error}`)
  }
  // 忘了映射 + 單邊 code（全部 ≥ 0 或全部 ≤ 0）：G_bug = (1/N)Σ b·x 的符號固定 ⇒ 沒有固定點。
  // 此時 blockLms 的 mean-field 求根只會找到 Φ 下溢造成的假根，改以正確的說明取代那條警告。
  let oneSided = false
  if (res && shared.encoding === 'unipolar_unmapped_bug') {
    let lo = Infinity
    let hi = -Infinity
    for (const v of res.trace.xRef) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    oneSided = lo >= 0 || hi <= 0
    if (oneSided)
      warnings.push(
        R`code 全部 $${hi <= 0 ? R`\le0` : R`\ge0`}$ 且 0/1 沒有映射：每個 sample 的 $b\,x${hi <= 0 ? R`\le0` : R`\ge0`}$，$G_\mathrm{bug}$ 的符號永遠固定，所以沒有固定點，$w$ 會單調${hi <= 0 ? '往下' : '往上'}漂到 DTC gain 的 rail（mean-field 固定點不存在）`,
      )
  }
  if (res)
    warnings.push(
      ...res.warnings
        .filter((w) => !(oneSided && w.startsWith('預測固定點偏差')))
        .map(texifyModelText) // blockLms 的警告是純文字：換成 $...$（顯示層）
        .map((w) => (cases.cases.length > 1 ? `Case ${cases.activeId}：${w}` : w)),
    )

  const an = res?.analytic
  const metrics: MetricRow[] = res && blk && an
    ? [
        { name: R`$G_{${k}}$（blockLms 模擬）`, value: blk.Gsim, digits: 6, formulaId: 'F-04.3' },
        { name: R`$G_{${k}}$（gmac.ts 由 trace 重算）`, value: blk.Gmine, analytic: blk.Gsim, tolerance: 1e-9, digits: 6, note: R`同一組 $q$、$x_\mathrm{ref}$，兩份獨立實作` },
        ...(momNow
          ? [{ name: R`$E[G_{${k}}\mid\text{codes},\,w_{${k}}]$`, value: momNow.mean, unit: '', digits: 5, claim: 'exact' as const, note: R`$\pm1\sigma=${tx(momNow.sd, 4)}$（只有雜訊是隨機的）`, formulaId: 'F-04.4' }]
          : []),
        { name: R`$K=K_qC$（忘了映射時再 $\times\tfrac12$）`, value: an.K, unit: R`$\mathrm{fs}^{-1}$`, digits: 5, claim: 'approx', formulaId: 'F-04.4' },
        { name: R`$g$（loop gain）`, value: an.g, digits: 5, claim: 'approx', formulaId: 'F-04.5', note: active.params.gmMode === 'sum' ? R`sum 模式：$g=N\mu K$` : R`average 模式：$g=\mu K$` },
        { name: R`pole $p=1-g$`, value: an.p, digits: 5, claim: 'approx' },
        { name: R`$w_{${k}}\to w_{${k + 1}}$`, value: `${f(blk.wk, 5)} → ${f(blk.wNext, 5)}`, unit: 'fs' },
      ]
    : []

  const analyticCheck: CheckEntry = check
    ? {
        status: Math.abs(check.aggZ) <= 4 && check.maxImpl <= 1e-9 ? 'ok' : 'mismatch',
        note: R`${check.nBlocks} 個 block：$\sum_k\bigl(G_k-E[G_k\mid\text{codes}]\bigr)$ 的標準化值 $z=${tx(check.aggZ, 3)}$（門檻 $|z|\le4$）；單一 block 最大 $|z|=${tx(check.maxAbsZ, 3)}$（小 $N$ 時 $G$ 為離散分布，僅供參考）；gmac.ts 重算 vs blockLms 最大差 $${tx(check.maxImpl, 2)}$`,
      }
    : { status: 'n/a', note: '模擬失敗' }

  // ── 圖 ──
  const wPlot = useMemo(() => {
    const d: Data[] = runs
      .filter((r) => r.res)
      .map((r) => ({
        x: Array.from({ length: K + 1 }, (_, i) => i),
        y: Array.from(r.res!.blocks.w),
        name: R`Case ${r.id}：${r.params.gmMode === 'sum' ? 'sum' : 'avg'}，$\mu=${r.params.mu}$`,
        mode: 'lines+markers' as const,
        marker: { size: 4 },
        line: { color: r.color },
      }))
    d.push({ x: [0, K], y: [shared.aTrue, shared.aTrue], name: R`$a$（真實 gain）`, mode: 'lines', line: { dash: 'dot', color: tokens.textMuted } })
    if (res) d.push({ x: [k], y: [res.blocks.w[k]], name: '目前 block', mode: 'markers', marker: { size: 12, symbol: 'circle-open', color: tokens.accent } })
    return d
  }, [runs, K, shared.aTrue, tokens, res, k])

  const localN = useMemo(() => Array.from({ length: N }, (_, i) => i), [N])
  const shown = Math.max(0, c)
  const blockPlotA = useMemo<Data[]>(
    () =>
      blk
        ? [
            { x: localN, y: Array.from(blk.x), name: R`$x[n]$（code）`, mode: 'lines+markers', line: { shape: 'hv', color: tokens.series[0] }, marker: { size: 4 } },
            ...(shared.path !== 'identity'
              ? [{ x: localN, y: Array.from(blk.u), name: R`$u[n]$（$H_\mathrm{PD}$ 濾波後的 $x$）`, mode: 'lines' as const, line: { dash: 'dash' as const, color: tokens.series[4] } }]
              : []),
            {
              x: localN.slice(0, shown),
              y: Array.from(blk.e.subarray(0, shown)),
              name: R`$e[n]$（fs，右軸）`,
              mode: 'markers',
              yaxis: 'y2',
              marker: { size: 8, color: Array.from(blk.q.subarray(0, shown), (v) => (v > 0 ? tokens.series[2] : tokens.series[1])) },
            },
          ]
        : [],
    [blk, localN, shown, shared.path, tokens],
  )
  const blockPlotB = useMemo<Data[]>(
    () =>
      blk
        ? [
            {
              x: localN.slice(0, shown),
              y: Array.from(blk.q.subarray(0, shown), (v, i) => v * blk.xr[i]),
              name: R`$q[n]\,x_\mathrm{ref}[n]$`,
              type: 'bar',
              marker: { color: tokens.series[3] },
            },
            { x: localN.slice(0, shown), y: Array.from(blk.S.subarray(0, shown)), name: R`累加 $S$（running sum）`, mode: 'lines+markers', line: { color: tokens.series[0] } },
          ]
        : [],
    [blk, localN, shown, tokens],
  )
  const i0Blk = blk?.i0 ?? 0
  const layoutW = useMemo(() => ({ xaxis: { title: { text: R`block $k$` } }, yaxis: { title: { text: R`$w_k$ [fs/code]` } } }), [])
  const layoutA = useMemo(
    () => ({
      xaxis: { title: { text: R`block 內 sample（$n-${i0Blk}$）` }, range: [-0.5, N - 0.5] },
      yaxis: { title: { text: R`$x$、$u$（無因次）` } },
      yaxis2: { title: { text: R`$e$ [fs]` }, overlaying: 'y' as const, side: 'right' as const },
    }),
    [i0Blk, N],
  )
  const layoutB = useMemo(() => ({ xaxis: { title: { text: 'block 內 sample' }, range: [-0.5, N - 0.5] }, yaxis: { title: { text: R`$q\,x_\mathrm{ref}$、$S$` } } }), [N])

  const mode = active.params.gmMode
  const mu = active.params.mu

  return (
    <ExperimentShell
      id={SIGNAL_FLOW_ID}
      source="simulation"
      title="GMAC 訊號流：一個 block 內逐 sample 追蹤"
      level={res?.modelLevel ?? 'L1'}
      claim="approx"
      tests={['T13']}
      description={
        <>
          以 <code>runBlockLms</code> 跑小 <Tex>N</Tex> 的 block sign-LMS，逐拍顯示 <Tex>{R`x[n]`}</Tex>、<Tex>{R`u[n]`}</Tex>、<Tex>{R`e[n]`}</Tex>、<Tex>{R`q[n]`}</Tex>、累加中的{' '}
          <Tex>{R`S`}</Tex>，以及 block 結束時的 <Tex>{R`w_{k+1}=w_k+\mu G_k`}</Tex>。A/B/C 共用 seed，可直接比較 sum / average。
        </>
      }
      assumptions={res?.assumptions.map(texifyModelText) ?? ['模擬失敗，見警告']}
      params={{ ...shared, seed, active_case: cases.activeId, gm_mode: mode, mu, block: k, cursor: c }}
      seed={seed}
      onSeedChange={(s) => {
        setSeed(s)
        cases.setSeed(s)
      }}
      units={{ sigmaV: 'fs', aTrue: 'fs per unit code', w0: 'fs per unit code', mu: 'fs（average）/ fs per unit S（sum）', N: 'samples' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo:
          mc.failed === mc.runs
            ? { status: 'n/a', note: '模擬失敗' }
            : {
                status: Math.abs(mc.z) <= 4 ? 'ok' : 'mismatch',
                note: R`Case ${cases.activeId}：另跑 ${mc.runs - mc.failed} 個 seed（deriveSeed(seed, 'mc-i')，每次換一組 code 與雜訊），共 ${mc.blocks} 個 block 的 $\sum_k\bigl(G_k-E[G_k\mid\text{codes},\,w_k]\bigr)$ 標準化值 $z=${tx(mc.z, 3)}$（門檻 $|z|\le4$；檢查的是條件平均／變異數的 $\mathrm{erf}$ 模型，不是收斂值）`,
              },
        fixedPoint: { status: 'n/a', note: '浮點模型；位元級 GMAC 見下方 gmac-fixed-point' },
      }}
      actions={{
        onReset: () => setCur({ k: 0, c: 0, key: resetKey }),
        onStep: step,
        onRun: () => setRunning(true),
        onStop: () => setRunning(false),
        running,
      }}
      exportData={() => {
        if (!res) return {}
        const cols: Record<string, ArrayLike<number>> = {
          n: res.trace.n,
          x: res.trace.x,
          u: res.trace.u,
          e_fs: res.trace.e,
          q: res.trace.q,
          x_ref: res.trace.xRef,
        }
        for (const r of runs) if (r.res) cols[`w_case_${r.id}`] = r.res.blocks.w
        return cols
      }}
      presets={presets}
      onLoadPreset={(p) => load(p.params)}
      controls={
        <>
          <div className="ch04-controls-title">共用參數（A/B/C 相同）</div>
          <ParamControl label={mt(R`$N$（每 block sample 數）`)} ariaLabel="N（每 block sample 數）" value={shared.N} onChange={(N) => setShared({ ...shared, N })} min={1} max={64} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="block 數" value={shared.numBlocks} onChange={(numBlocks) => setShared({ ...shared, numBlocks })} min={2} max={64} integer clampOnBlur unit="blocks" reg="num_blocks" />
          <ParamControl label={mt(R`$\sigma_v$（comparator 前雜訊）`)} ariaLabel="σ_v（comparator 前雜訊）" value={shared.sigmaV} onChange={(sigmaV) => setShared({ ...shared, sigmaV })} min={0} max={300} step={0.1} unit="fs" reg="pd_noise_rms_fs" />
          <ParamControl label={mt(R`$a$（真實 gain）`)} ariaLabel="a（真實 gain）" value={shared.aTrue} onChange={(aTrue) => setShared({ ...shared, aTrue })} min={-200} max={200} step={0.1} unit="fs/code" reg="gain_true" />
          <ParamControl label={mt(R`$w_0$（初始 gain）`)} ariaLabel="w₀（初始 gain）" value={shared.w0} onChange={(w0) => setShared({ ...shared, w0 })} min={-200} max={200} step={0.1} unit="fs/code" reg="REG_DTC_GAIN_INIT" />
          <SelectControl<PatternKind>
            label="code pattern"
            value={shared.pattern}
            onChange={(pattern) => setShared({ ...shared, pattern })}
            options={(Object.keys(PATTERN_LABEL) as PatternKind[]).map((v) => ({ value: v, label: PATTERN_LABEL[v] }))}
            reg="seeded_pattern.kind"
          />
          <SelectControl<CodeNormalization>
            label="code 正規化"
            value={shared.normalization}
            onChange={(normalization) => setShared({ ...shared, normalization })}
            options={[
              { value: 'none', label: 'none（原值）' },
              { value: 'zero_mean', label: 'zero_mean' },
              { value: 'unit_rms', label: 'unit_rms（保留 DC）' },
              { value: 'standardize', label: 'standardize（零均值、單位方差）' },
            ]}
            reg="code_normalization"
          />
          <SelectControl<FlowShared['path']>
            label={mt(R`PLL error path $H_\mathrm{PD}$`)}
            ariaLabel="PLL error path H_PD"
            value={shared.path}
            onChange={(path) => setShared({ ...shared, path })}
            options={[
              { value: 'identity', label: 'identity（u = x）' },
              { value: 'first_order_hp', label: '(1 − z⁻¹)/(1 − p_HP·z⁻¹)' },
            ]}
            reg="pll_error_path.kind"
          />
          {shared.path === 'first_order_hp' && (
            <ParamControl label={mt(R`$p_\mathrm{HP}$（$H_\mathrm{PD}$ 的 pole）`)} ariaLabel="p_HP（H_PD 的 pole）" value={shared.hpPole} onChange={(hpPole) => setShared({ ...shared, hpPole })} min={-0.99} max={0.99} step={0.01} reg="pll_error_path.parameters.pole" />
          )}
          <SelectControl<ComparatorEncoding>
            label="comparator 編碼"
            value={shared.encoding}
            onChange={(encoding) => setShared({ ...shared, encoding })}
            options={(Object.keys(ENCODING_LABEL) as ComparatorEncoding[]).map((v) => ({ value: v, label: ENCODING_LABEL[v] }))}
            reg="comparator_encoding"
          />
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">Case {cases.activeId} 的參數</div>
            <SelectControl<GmMode>
              label="gm_mode"
              value={mode}
              onChange={(gmMode) => cases.update({ gmMode })}
              options={[
                { value: 'average', label: 'average：G = S/N' },
                { value: 'sum', label: 'sum：直接用 S' },
              ]}
              reg="REG_GMAC_MODE / shift enable"
            />
            <ParamControl label={mt(R`$\mu$（gain_step）`)} ariaLabel="μ（gain_step）" value={mu} onChange={(v) => cases.update({ mu: v })} min={0} max={200} step={0.01} unit="fs" reg="REG_LMS_MU" hint={mt(R`average 模式 $g=\mu K$；sum 模式 $g=N\mu K$`)} />
          </div>
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">游標</div>
            <ParamControl label={mt(R`block $k$`)} ariaLabel="block k" value={k} onChange={(v) => setCur({ k: v, c: N, key: resetKey })} min={0} max={K - 1} integer clampOnBlur reg="UI: trace cursor（block）" />
            <ParamControl label="已累加 sample 數" value={c} onChange={(v) => setCur({ k, c: v, key: resetKey })} min={0} max={N} integer clampOnBlur hint={mt(R`$N$ = block 完成並更新`)} reg="UI: trace cursor（sample）" />
          </div>
        </>
      }
    >
      <CaseSelector cases={cases} />
      <Plot title={R`$w_k$（每個 block 一點；A/B/C 同 seed）`} data={wPlot} layout={layoutW} height={280} csvName="ch04-flow-w" />
      {blk && (
        <>
          <Plot
            title={R`Case ${cases.activeId}，block ${k}：code 與 PD 誤差（綠：$q=+1$、紅：$q=-1$）`}
            data={blockPlotA}
            layout={layoutA}
            height={260}
            csvName="ch04-flow-block-a"
          />
          <Plot
            title={R`block ${k}：$q\,x_\mathrm{ref}$ 與累加中的 $S$`}
            data={blockPlotB}
            layout={layoutB}
            height={240}
            csvName="ch04-flow-block-b"
          />
          <div className="ch04-scroll" role="region" aria-label="本 block 逐拍數值" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>
                    <Tex>n</Tex>
                  </th>
                  <th>
                    <Tex>{R`x[n]`}</Tex>
                  </th>
                  {shared.path !== 'identity' && (
                    <th>
                      <Tex>{R`u[n]`}</Tex>
                    </th>
                  )}
                  <th>
                    <Tex>{R`e[n]`}</Tex> [fs]
                  </th>
                  <th>
                    <Tex>{R`b[n]`}</Tex>
                  </th>
                  <th>
                    <Tex>{R`q[n]`}</Tex>
                  </th>
                  <th>
                    <Tex>{R`q\,x_\mathrm{ref}`}</Tex>
                  </th>
                  <th>
                    <Tex>{R`S`}</Tex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {localN.map((i) => {
                  const cls = i === c - 1 ? 'ch04-now' : i >= c ? 'ch04-future' : undefined
                  const done = i < c
                  return (
                    <tr key={i} className={cls}>
                      <td className="num">{blk.i0 + i}</td>
                      <td className="num">{f(blk.x[i], 4)}</td>
                      {shared.path !== 'identity' && <td className="num">{f(blk.u[i], 4)}</td>}
                      <td className="num">{done ? f(blk.e[i], 4) : '·'}</td>
                      <td className="num">{done ? blk.bits[i] : '·'}</td>
                      <td className={`num ${done ? (blk.q[i] > 0 ? 'ch04-pos' : blk.q[i] < 0 ? 'ch04-neg' : '') : ''}`}>{done ? blk.q[i] : '·'}</td>
                      <td className="num">{done ? f(blk.q[i] * blk.xr[i], 4) : '·'}</td>
                      <td className="num">{done ? f(blk.S[i], 4) : '·'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ch04-update" aria-live="polite">
            {c < N ? (
              <span className="small">
                block {k} 已累加 {c}/{N} 個 sample：<Tex>{R`S=${c > 0 ? tx(blk.S[c - 1], 5) : '0'}`}</Tex>。按「Step」逐拍前進，累加滿 <Tex>N</Tex> 個後顯示更新式。
              </span>
            ) : (
              <TexBlock>
                {mode === 'average'
                  ? R`G_{${k}}=\frac{S_{${k}}}{N}=\frac{${tx(blk.S[N - 1], 5)}}{${N}}=${tx(blk.Gsim, 5)},\quad w_{${k + 1}}=w_{${k}}+\mu G_{${k}}=${tx(blk.wk, 5)}+${tx(mu, 4)}\times${txp(blk.Gsim, 5)}=${tx(blk.wNext, 5)}\;\mathrm{fs}`
                  : R`S_{${k}}=${tx(blk.S[N - 1], 5)},\quad w_{${k + 1}}=w_{${k}}+\mu S_{${k}}=${tx(blk.wk, 5)}+${tx(mu, 4)}\times${txp(blk.Gsim, 5)}=${tx(blk.wNext, 5)}\;\mathrm{fs}\;(\text{沒有除以 }N)`}
              </TexBlock>
            )}
          </div>
        </>
      )}
      <p className="small muted">
        {mt(
          R`試試看：(1) 把 Case A 複製成 Case B，把 B 的 gm_mode 改成 sum、$\mu$ 不變——$w$ 會在 $a$ 兩側大幅來回跳（$g=N\mu K\ge2$）；再把 B 的 $\mu$ 改成 $\mu/N$，曲線與 A 完全重合。(2) comparator 編碼選「忘了映射」，code pattern 選一階 DSM、正規化選 none——code 有 DC（而且全部 $\le0$），$w$ 一路漂走。(3) $\sigma_v$ 拉到 0：$q$ 變成純 sign，$K_q$ 無定義。`,
        )}
      </p>
    </ExperimentShell>
  )
}
