import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, useDebouncedValue, useThemeTokens, type CsvColumns, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  analyticCrossCheck,
  xMoments,
  type NaiveCiParams,
  type NaiveCiResult,
} from '@/simulation/models/scalarStability'
import { mergeParams, num, T, tnum } from '../common'
import { DEFAULT_DIST_FIELDS, DistControls, distSummary, toXDist, type DistFields } from './DistControls'

export const HEAVY_TAIL_EXPERIMENT = 'stability-heavytail'

export interface HeavyTailParams extends DistFields {
  mu: number
  /** 看第 n 步的 E[δ_n²] */
  n: number
  delta0: number
  pathsPerBatch: number
  batches: number
}

export const DEFAULT_HEAVY_TAIL: HeavyTailParams = {
  ...DEFAULT_DIST_FIELDS,
  mu: 0.8,
  n: 5,
  delta0: 1,
  pathsPerBatch: 4000,
  batches: 100,
}

const MAX_WORK = 2e7

/**
 * 勘誤 E14 的示範：重複 B 批「直接平均 δ_n²」並各自算 95% CI，統計實際覆蓋真值的比例；
 * 對照單步 Monte Carlo 估計 g 再取 g^n（變異數有限、可信）。
 */
export function HeavyTailDemo() {
  const tokens = useThemeTokens()
  const [params, setParams] = useState<HeavyTailParams>(DEFAULT_HEAVY_TAIL)
  const [seed, setSeed] = useState(20261010)
  const [result, setResult] = useState<{ key: string; r: NaiveCiResult } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)
  const presets = useMemo(() => presetsForExperiment(HEAVY_TAIL_EXPERIMENT), [])
  const urlPreset = useUrlPreset(HEAVY_TAIL_EXPERIMENT)
  useEffect(() => {
    if (urlPreset) setParams(mergeParams(DEFAULT_HEAVY_TAIL, urlPreset.params))
  }, [urlPreset])

  const task = useWorkerTask<NaiveCiParams, NaiveCiResult>('scalarStability', 'naiveCiCoverage', { restartOnRun: true })
  const { dist, error: distError } = useMemo(() => toXDist(params), [params])
  const work = params.n * params.pathsPerBatch * params.batches
  const request = useMemo<NaiveCiParams | null>(
    () =>
      dist && work <= MAX_WORK
        ? { mu: params.mu, dist, delta0: params.delta0, n: params.n, pathsPerBatch: params.pathsPerBatch, batches: params.batches, seed }
        : null,
    [dist, work, params.mu, params.delta0, params.n, params.pathsPerBatch, params.batches, seed],
  )
  const debounced = useDebouncedValue(request, 350)
  const key = JSON.stringify(debounced)
  const { run } = task
  useEffect(() => {
    if (!debounced) return
    let alive = true
    run(debounced).then(
      (r) => {
        if (!alive) return
        setResult({ key, r })
        setError(null)
      },
      (e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [debounced, key, run, runToken])

  const r = result?.r ?? null
  const stale = result !== null && result.key !== JSON.stringify(request)
  const m = useMemo(() => (dist ? xMoments(dist) : null), [dist])
  // g、h 的動差封閉式 vs 直接數值積分 E|1 − μx²|^s（s = 2、4）：獨立的兩種算法
  const xc = useMemo(() => (dist && m && m.Px > 0 ? analyticCrossCheck(params.mu, dist) : null), [dist, m, params.mu])

  const warnings: string[] = []
  // 字串中的數學以 `$…$` 標示（ExperimentShell 以 KaTeX 顯示）
  if (distError) warnings.push(`$x$ 分布參數錯誤：${distError}`)
  if (m && !(m.Px > 0)) warnings.push(String.raw`$P_x = 0$：$x$ 恆為 0，$\delta_n$ 永遠等於 $\delta_0$，沒有任何資訊（不可辨識）。`)
  if (work > MAX_WORK) warnings.push(String.raw`$n$、每批路徑數、批數三者的乘積 $${tnum(work, 6)}$ 超過上限 $${tnum(MAX_WORK)}$：為了瀏覽器反應速度不執行，請減少批數或路徑數。`)
  if (params.delta0 === 0) warnings.push(String.raw`$\delta_0 = 0$ 且無雜訊：$\delta_n \equiv 0$，$E[\delta_n^2] = 0$，CI 沒有意義。`)
  if (error) warnings.push(`計算錯誤：${error}`)

  const metrics: MetricRow[] = r
    ? [
        { name: String.raw`精確 $E[\delta_n^2] = g^n\delta_0^2$`, value: r.exact, formulaId: 'F-03.6', claim: 'exact' },
        { name: '天真 CI 的實際覆蓋率（宣稱 95%）', value: r.coverage, analytic: 0.95, tolerance: 0.05, note: String.raw`${params.batches} 批、每批 ${params.pathsPerBatch} 條；$|\Delta| > 0.05$ 代表 CI 不可信` },
        { name: '真實 SE / 樣本 SE（中位數）', value: r.medianSeRatio, note: '比值 $> 1$：樣本 SE 低估（看不到稀有大值）', claim: 'exact' },
        { name: '真實 SE（每批）', value: r.trueSe, formulaId: 'F-03.16', claim: 'exact' },
        {
          name: '合併樣本平均（全部路徑）',
          value: r.pooledMean,
          analytic: r.exact,
          tolerance: 4 * r.pooledSe,
          note: String.raw`用 $\pm4$ 倍樣本 SE 判定（樣本 SE $= ${tnum(r.pooledSe, 3)}$）`,
        },
        {
          name: String.raw`單步 MC：$\hat g^{\,n}\delta_0^2$`,
          value: r.oneStepEstimate,
          analytic: r.exact,
          tolerance: 4 * r.oneStepEstimateSe + 1e-9 * Math.abs(r.exact),
          note: String.raw`$\hat g = ${tnum(r.oneStepG, 6)} \pm ${tnum(r.oneStepGSe, 2)}$（delta method，$\pm4$ SE）`,
          claim: 'approx',
        },
      ]
    : []

  const plotData = useMemo<Data[]>(() => {
    if (!r) return []
    const nb = Math.min(100, r.batchMean.length)
    const idx = Array.from({ length: nb }, (_, i) => i)
    const mk = (cov: number, name: string, color: string): Data => {
      const sel = idx.filter((i) => r.covered[i] === cov)
      return {
        x: sel.map((i) => i + 1),
        y: sel.map((i) => r.batchMean[i]),
        error_y: { type: 'data', array: sel.map((i) => r.z * r.batchSe[i]), visible: true, color, thickness: 1.2, width: 0 },
        mode: 'markers',
        name,
        marker: { size: 6, color },
      }
    }
    return [
      mk(1, '覆蓋真值的 CI', tokens.series[2]),
      mk(0, '沒覆蓋真值的 CI', tokens.series[1]),
      { x: [0.5, nb + 0.5], y: [r.exact, r.exact], mode: 'lines', name: `真值 gⁿδ₀² = ${num(r.exact, 5)}`, line: { color: tokens.text, width: 2, dash: 'dash' } },
    ]
  }, [r, tokens])
  const layout = useMemo<Partial<Layout>>(() => ({ xaxis: { title: { text: '批次 b（最多畫 100 批）' } }, yaxis: { title: { text: '樣本平均 δ_n² ± z·樣本SE' } } }), [])

  const onRun = useCallback(() => setRunToken((t) => t + 1), [])

  return (
    <ExperimentShell
      id={HEAVY_TAIL_EXPERIMENT}
      title={String.raw`Heavy-tail 示範：$\delta_n^2$ 的天真 Monte Carlo CI 為什麼會騙人`}
      level="L0"
      claim="exact"
      tests={['T03']}
      description={
        <>
          每批 M 條路徑直接平均 <Tex>{T`\delta_n^2`}</Tex> 並用樣本 SE 做 95% CI，重複 B 批，看 CI 有幾成真的蓋住精確值 <Tex>{T`g^n\delta_0^2`}</Tex>。
        </>
      }
      assumptions={[
        String.raw`$x_n$ iid（分布見參數）`,
        '無量測雜訊',
        String.raw`$\delta = a - w$（勘誤 E39）`,
        String.raw`CI = 樣本平均 $\pm z\cdot$ 樣本 SE（$z = \Phi^{-1}(0.975)$）`,
        String.raw`真實 SE 由 $h(\mu) = E[(1-\mu x^2)^4]$ 封閉式計算（F-03.16）`,
        '勘誤 E14：heavy tail 下天真 CI 不可作為 T03 的驗證依據',
      ]}
      params={{ ...params, distSummary: distSummary(params) }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ mu: '1/[x]²', n: 'samples', delta0: '—', pathsPerBatch: 'paths', batches: 'batches' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: xc
          ? {
              status: xc.gRelDev <= 1e-6 && xc.hRelDev <= 1e-6 ? 'ok' : 'mismatch',
              note: String.raw`$g = ${tnum(xc.gClosed, 6)}$、$h = ${tnum(xc.hClosed, 6)}$：動差封閉式 vs 數值積分（相對差 $${tnum(Math.max(xc.gRelDev, xc.hRelDev), 2)}$）`,
            }
          : { status: 'n/a', note: '分布參數錯誤或 $P_x = 0$' },
        monteCarlo: r
          ? {
              status: Math.abs(r.oneStepEstimate - r.exact) <= 4 * r.oneStepEstimateSe + 1e-9 * Math.abs(r.exact) ? 'ok' : 'mismatch',
              note: `單步 MC vs 封閉式；天真 CI 覆蓋率 ${num(100 * r.coverage, 3)}%`,
            }
          : { status: 'n/a', note: task.running ? '執行中…' : '尚未執行' },
        fixedPoint: { status: 'not-implemented', note: '定點量化見第 13 章' },
      }}
      actions={{ onRun, running: task.running, onStop: task.cancel, onReset: () => setParams(DEFAULT_HEAVY_TAIL) }}
      exportData={(): CsvColumns =>
        r
          ? {
              batch: Array.from(r.batchMean, (_, i) => i + 1),
              sample_mean: r.batchMean,
              sample_se: r.batchSe,
              covered: Array.from(r.covered),
              exact: Array.from(r.batchMean, () => r.exact),
            }
          : { note: ['尚未執行'] }
      }
      presets={presets.map((pr) => ({ name: pr.title, params: pr.params, description: pr.description }))}
      onLoadPreset={(pr) => setParams((cur) => mergeParams(cur, pr.params))}
      controls={
        <>
          <ParamControl label="μ（學習率）" value={params.mu} onChange={(mu) => setParams((p) => ({ ...p, mu }))} min={0.001} max={3} log unit="1/[x]²" reg="LMS_MU（behavioral）" />
          <ParamControl label="n（看第 n 步）" value={params.n} onChange={(n) => setParams((p) => ({ ...p, n }))} min={1} max={50} integer clampOnBlur unit="samples" reg="觀察的步數（behavioral）" />
          <ParamControl label="δ₀ = a − w₀" value={params.delta0} onChange={(delta0) => setParams((p) => ({ ...p, delta0 }))} min={-10} max={10} step={0.1} unit="—（正規化）" reg="初始誤差 a − w₀" />
          <ParamControl
            label="每批路徑數 M"
            value={params.pathsPerBatch}
            onChange={(pathsPerBatch) => setParams((p) => ({ ...p, pathsPerBatch }))}
            min={10}
            max={200000}
            log
            integer
            clampOnBlur
            unit="paths"
            reg="每批 Monte Carlo 路徑數"
          />
          <ParamControl label="批數 B" value={params.batches} onChange={(batches) => setParams((p) => ({ ...p, batches }))} min={1} max={1000} integer clampOnBlur unit="batches" reg="重複批數（覆蓋率統計）" />
          <DistControls value={params} onChange={(patch) => setParams((p) => ({ ...p, ...patch }))} />
        </>
      }
    >
      {task.running && <p className="ch03-running">Monte Carlo 執行中（Web Worker）…</p>}
      {stale && !task.running && (
        <p className="ch03-running" role="status">
          {request ? '參數已改變，結果更新中…' : '目前的參數無法執行（原因見上方警告）；下面的圖與指標是上一次成功執行的結果，僅供參考。'}
        </p>
      )}
      {r && (
        <Plot
          title="每批的天真 95% CI（紅色 = 沒蓋住真值）"
          data={plotData}
          layout={layout}
          height={320}
          csvName="ch03-naive-ci"
          caption={
            <>
              覆蓋率 {num(100 * r.coverage, 3)}%（宣稱 95%）。真實 SE 是樣本 SE 的約 {num(r.medianSeRatio, 3)} 倍（中位數）：大多數批次沒抽到「稀有但巨大」的路徑，所以平均偏低、SE
              也偏小。精確值 <Tex>{T`g^n\delta_0^2`}</Tex> 是虛線。
            </>
          }
        />
      )}
    </ExperimentShell>
  )
}
