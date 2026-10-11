import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  CaseSelector,
  Callout,
  ClaimTag,
  CodeBlock,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  Section,
  Tex,
  TexBlock,
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
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import { kq, signLoopLinearRms, signLoopStationary, type SignLoopBatchParams, type SignLoopBatchResult } from '@/simulation/models/comparator'
import { Fig, Steps, figNo, fx, hline, int, logspace, sig, sigOrZero, texInt, texNum, vline } from '../common'

const EXP_ID = 'comparator-dither'
const SRC_PATH = 'src/simulation/models/comparator.ts'

interface DitherCase {
  /** 雜訊 RMS σ_v（fs） */
  sigma: number
  /** 每 sample 的步長 μ（fs） */
  mu: number
}
interface DitherShared {
  a: number
  w0: number
  theta: number
  steps: number
}

const DEFAULT_SHARED: DitherShared = { a: 1.1, w0: 0, theta: 0, steps: 20000 }
/** 精確穩態偏差的顯示下限（fs）：log 空間累加再正規化後，雙精度的絕對誤差約 1e-12～1e-11 fs，低於此值不當成有效數字。 */
const BIAS_FLOOR = 1e-9
const DEFAULT_SIGMAS = [0, 1, 30]

/** 雜訊像 dither：逐 sample Sign-LMS（x ≡ 1）的 Case A/B/C 比較。 */
function DitherExperiment() {
  const tokens = useThemeTokens()
  const cases = useCases<DitherCase>({ sigma: DEFAULT_SIGMAS[0], mu: 0.5 }, { seed: 20261010 })
  const [sh, setSh] = useState<DitherShared>(DEFAULT_SHARED)
  const { addCase, update, setActive, reset, setSeed } = cases

  /**
   * 一次設定多個 case 的 σ_v（預設與 preset 共用）。useCases 一次只能新增一個 case，
   * 所以用一個小狀態機跨 render 逐步完成：reset → 逐一 addCase + update → 選回 A。
   */
  const [pending, setPending] = useState<{ sigmas: number[]; mu: number; stage: 'reset' | 'add' } | null>({
    sigmas: DEFAULT_SIGMAS,
    mu: 0.5,
    stage: 'reset',
  })
  useEffect(() => {
    if (!pending) return
    if (pending.stage === 'reset') {
      reset({ sigma: pending.sigmas[0] ?? 0, mu: pending.mu })
      setPending({ ...pending, stage: 'add' })
      return
    }
    const want = Math.min(3, Math.max(1, pending.sigmas.length))
    if (cases.cases.length < want) {
      const id = addCase()
      if (id) update({ sigma: pending.sigmas[cases.cases.length], mu: pending.mu }, id)
      return
    }
    setActive('A')
    setPending(null)
  }, [pending, cases.cases, reset, addCase, update, setActive])

  const applyPreset = useCallback((params: Record<string, unknown>) => {
    const n = (k: string, d: number) => (typeof params[k] === 'number' && Number.isFinite(params[k]) ? (params[k] as number) : d)
    setSh({ a: n('a', DEFAULT_SHARED.a), w0: n('w0', DEFAULT_SHARED.w0), theta: n('theta', 0), steps: Math.round(Math.min(200000, Math.max(100, n('steps', 20000)))) })
    const list = Array.isArray(params.sigmas) ? params.sigmas.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0) : []
    setPending({ sigmas: list.length ? list.slice(0, 3) : DEFAULT_SIGMAS, mu: Math.min(10, Math.max(0.001, n('mu', 0.5))), stage: 'reset' })
  }, [])
  const urlPreset = useUrlPreset(EXP_ID)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      applyPreset(urlPreset.params)
    }
  }, [urlPreset, applyPreset])
  const presets = useMemo<ExperimentPreset[]>(() => presetsForExperiment(EXP_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), [])

  // ---------------- Monte Carlo（worker）＋精確穩態（主執行緒，便宜） ----------------
  const simTask = useWorkerTask<SignLoopBatchParams, SignLoopBatchResult>('comparator', 'runSignLoopBatch', { restartOnRun: true })
  const runBatch = simTask.run
  const simKey = JSON.stringify({
    a: sh.a,
    w0: sh.w0,
    theta: sh.theta,
    steps: sh.steps,
    seed: cases.seed,
    cases: cases.cases.map((k) => ({ sigma: k.params.sigma, mu: k.params.mu })),
  })
  const dSimKey = useDebouncedValue(simKey, 250)
  const [sims, setSims] = useState<{ key: string; res: SignLoopBatchResult } | null>(null)
  const [simError, setSimError] = useState<string | null>(null)
  useEffect(() => {
    runBatch(JSON.parse(dSimKey) as SignLoopBatchParams)
      .then((res) => {
        setSims({ key: dSimKey, res })
        setSimError(null)
      })
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setSimError(e instanceof Error ? e.message : String(e))
      })
  }, [dSimKey, runBatch])
  const simFresh = sims !== null && sims.key === simKey

  const runs = useMemo(
    () =>
      cases.cases.map((k, i) => {
        const p = { a: sh.a, w0: sh.w0, mu: k.params.mu, sigma: k.params.sigma, theta: sh.theta }
        const st = signLoopStationary(p)
        const g = k.params.sigma > 0 ? k.params.mu * kq(k.params.sigma) : Infinity
        const sim = sims && sims.res.runs.length === cases.cases.length ? sims.res.runs[i] : null
        return { id: k.id, seriesIndex: k.seriesIndex, params: k.params, sim, st, g, lin: signLoopLinearRms(k.params.mu, k.params.sigma), tau: Number.isFinite(g) ? 1 / g : NaN }
      }),
    [cases.cases, sh, sims],
  )
  const active = runs.find((r) => r.id === cases.activeId) ?? runs[0]
  const activeMu = cases.active.params.mu
  const dSh = useDeferredValue(sh)
  const dMu = useDeferredValue(activeMu)

  const tradeoff = useMemo(() => {
    const ratios = logspace(0.01, 300, 50)
    const rows = ratios.map((ratio) => {
      const sigma = ratio * dMu
      const st = signLoopStationary({ a: dSh.a, w0: dSh.w0, mu: dMu, sigma, theta: dSh.theta })
      return { sigma, absBias: Math.abs(st.bias), rms: st.rms, sd: st.sd, lin: signLoopLinearRms(dMu, sigma), tau: 1 / (dMu * kq(sigma)) }
    })
    const zero = signLoopStationary({ a: dSh.a, w0: dSh.w0, mu: dMu, sigma: 0, theta: dSh.theta })
    return { rows, zero }
  }, [dSh, dMu])

  const showN = Math.min(sh.steps, 300)
  const trajData = useMemo<Data[]>(
    () =>
      runs.flatMap((r) =>
        r.sim
          ? [
              {
                x: Array.from({ length: Math.min(showN, r.sim.w.length - 1) + 1 }, (_, i) => i),
                y: Array.from(r.sim.w.subarray(0, showN + 1)),
                name: String.raw`${r.id}：$\sigma_v =$ ${r.params.sigma} fs、$\mu =$ ${r.params.mu} fs`,
                mode: 'lines' as const,
                line: { color: tokens.series[r.seriesIndex], width: 1.2, shape: 'hv' as const },
              },
            ]
          : [],
      ),
    [runs, showN, tokens],
  )
  const avgData = useMemo<Data[]>(
    () =>
      runs.flatMap((r) => {
        if (!r.sim) return []
        const w = r.sim.w
        const idx = Array.from(new Set(logspace(1, w.length, 400).map((v) => Math.min(w.length, Math.round(v))))).sort((x, y) => x - y)
        let acc = 0
        let j = 0
        const ys: number[] = []
        for (let n = 1; n <= w.length; n++) {
          acc += w[n - 1]
          if (idx[j] === n) {
            ys.push(acc / n)
            j++
          }
        }
        return [{ x: idx, y: ys, name: String.raw`${r.id} 時間平均 $\bar w_n$`, mode: 'lines' as const, line: { color: tokens.series[r.seriesIndex] } }]
      }),
    [runs, tokens],
  )
  const piData = useMemo<Data[]>(
    () =>
      runs
        .filter((r) => r.st.ok)
        .map((r) => ({
          x: r.st.support,
          y: r.st.prob,
          name: String.raw`${r.id} 精確穩態 $\pi(w)$`,
          mode: 'lines+markers',
          line: { color: tokens.series[r.seriesIndex], shape: 'hvh' },
          marker: { size: 4 },
        })),
    [runs, tokens],
  )
  const tradeData = useMemo<Data[]>(() => {
    const xs = tradeoff.rows.map((r) => r.sigma)
    const traces: Data[] = [
      { x: xs, y: tradeoff.rows.map((r) => Math.max(r.absBias, 1e-8)), name: String.raw`$|\text{時間平均偏差}|$（精確；$<10^{-8}$ 以 $10^{-8}$ 顯示）`, mode: 'lines', line: { color: tokens.series[1] } },
      { x: xs, y: tradeoff.rows.map((r) => r.rms), name: String.raw`$\mathrm{RMS}(w - a)$（精確）`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: xs, y: tradeoff.rows.map((r) => r.lin), name: String.raw`線性化 $\mathrm{RMS} = \sqrt{\mu/(K_q(2-\mu K_q))}$`, mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } },
    ]
    for (const r of runs) {
      if (r.params.sigma > 0 && r.params.mu === activeMu && r.st.ok) {
        traces.push({ x: [r.params.sigma], y: [r.st.rms], name: `Case ${r.id}`, mode: 'markers', marker: { size: 10, color: tokens.series[r.seriesIndex] }, showlegend: false })
      }
    }
    return traces
  }, [tradeoff, runs, activeMu, tokens])

  const metrics = useMemo<MetricRow[]>(() => {
    if (!active) return []
    const rows: MetricRow[] = [
      { name: String.raw`$\mu K_q$（Case ${active.id}）`, value: Number.isFinite(active.g) ? active.g : '∞（無雜訊）', claim: 'approx', digits: 5, note: String.raw`線性化每步的收縮量；$\ge2$ 時線性模型失效` },
      { name: String.raw`時間常數 $\tau\approx1/(\mu K_q)$`, value: Number.isFinite(active.tau) ? active.tau : null, unit: 'samples', claim: 'approx', digits: 5 },
      {
        name: String.raw`精確穩態 $E_\pi[w]-a$`,
        value: !active.st.ok ? null : Math.abs(active.st.bias) < BIAS_FLOOR ? `≈ 0（|偏差| < ${BIAS_FLOOR.toExponential(0)}）` : active.st.bias,
        unit: 'fs',
        claim: 'exact',
        digits: 5,
        note: String.raw`birth–death 細緻平衡；小於 $10^{-9}\,\mathrm{fs}$ 的值已低於雙精度加總的捨入誤差，不顯示數字`,
      },
      { name: String.raw`精確穩態 $\mathrm{RMS}(w-a)$`, value: active.st.ok ? active.st.rms : null, unit: 'fs', claim: 'exact', digits: 5 },
      { name: '線性化 RMS（F-05.15）', value: Number.isFinite(active.lin) ? active.lin : '不適用（迴路增益已達 2 以上，或沒有雜訊）', analytic: active.st.ok ? active.st.rms : undefined, unit: 'fs', claim: 'approx', formulaId: 'F-05.15', digits: 5 },
    ]
    if (simFresh && active.sim) {
      const half = Math.floor(sh.steps / 2)
      const tauC = Number.isFinite(active.tau) ? Math.max(1, active.tau) : 1
      const nEff = Math.max(1, half / (1 + 2 * tauC))
      const seMean = active.st.ok ? active.st.sd / Math.sqrt(nEff) : NaN
      const tol = active.params.sigma === 0 ? Math.max(1e-9, active.params.mu / half) : Math.max(5 * seMean, 0.02 * active.params.mu)
      rows.push(
        { name: String.raw`MC 後半段時間平均 $\bar w$`, value: active.sim.tailMean, analytic: active.st.ok ? active.st.mean : undefined, tolerance: active.st.ok ? tol : undefined, unit: 'fs', digits: 6, note: String.raw`容差考慮自相關：$n_{\mathrm{eff}}\approx(\text{steps}/2)/(1+2\tau)$` },
        { name: String.raw`MC 時間平均偏差 $\bar w-a$`, value: active.sim.tailBias, analytic: active.st.ok ? active.st.bias : undefined, unit: 'fs', digits: 5 },
        { name: String.raw`MC $\mathrm{RMS}(w-a)$`, value: active.sim.tailRms, analytic: active.st.ok ? active.st.rms : undefined, tolerance: active.st.ok ? 0.1 : undefined, toleranceMode: 'rel', unit: 'fs', digits: 5 },
      )
    }
    return rows
  }, [active, simFresh, sh.steps])

  const crossCheck = useMemo(() => {
    if (!active) return undefined
    const ev = metrics.find((m) => m.name.startsWith('MC 後半段'))
    const ok = ev && typeof ev.value === 'number' && ev.analytic !== undefined && ev.tolerance !== undefined ? Math.abs(ev.value - ev.analytic) <= ev.tolerance : null
    const analytic: CheckEntry = active.st.ok
      ? { status: 'ok', note: active.st.limitCycle ? String.raw`$\sigma_v=0$：period-2 limit cycle 的封閉解` : String.raw`birth–death 細緻平衡的精確穩態（格點 $w_0+k\mu$）` }
      : { status: 'n/a', note: String.raw`$\sigma_v/\mu$ 太大，格點超過 $2\times10^{6}$ 點，未計算精確穩態` }
    const monteCarlo: CheckEntry = !simFresh
      ? { status: 'n/a', note: simError ? `Monte Carlo 失敗：${simError}` : '計算中…' }
      : ok === null
        ? { status: 'n/a', note: '沒有可比的解析值' }
        : ok
          ? { status: 'ok', note: 'MC 時間平均落在解析值的容差內（考慮自相關的有效樣本數）' }
          : { status: 'mismatch', note: 'MC 時間平均超出容差：steps 可能太短（尚未進入穩態）' }
    return { analytic, monteCarlo, fixedPoint: { status: 'not-implemented' as const, note: '6-bit 定點係數的量化與 limit cycle 見 Ch13' } }
  }, [active, metrics, simFresh, simError])

  const warnings = useMemo(() => {
    const w: string[] = []
    for (const r of runs) {
      if (r.params.sigma === 0 && r.st.ok) {
        w.push(
          String.raw`Case ${r.id}：$\sigma_v=0$ → hard limiter，$w$ 在 $${texNum(r.st.support[0], 5)}$ 與 $${texNum(r.st.support[1], 5)}\,\mathrm{fs}$ 之間形成 period-2 limit cycle；時間平均偏差 $${texNum(r.st.bias, 4)}\,\mathrm{fs}$（最多 $\mu/2$，取決於 $w_0$ 的格點位置），增加步數也不會消失。`,
        )
      } else if (Number.isFinite(r.g) && r.g >= 2) {
        w.push(String.raw`Case ${r.id}：$\mu K_q=${fx(r.g, 3)}\ge2$，線性化模型（F-05.15）預測發散，但 1-bit 迴路其實有界——行為由 comparator 的非線性主導，請以精確穩態為準。`)
      }
      if (!r.st.ok) w.push(String.raw`Case ${r.id}：$\sigma_v/\mu=${fx(r.params.sigma / r.params.mu, 1)}$ 太大，精確穩態格點超過 $2\times10^{6}$ 點，未計算（MC 仍有效）。`)
    }
    if (sh.theta !== 0) w.push(String.raw`$\theta=${texNum(sh.theta, 4)}\,\mathrm{fs}$：dither 不能消除 comparator offset——所有 Case 的平衡點都移到 $a-\theta$（偏差 $-\theta$）。`)
    const slew = Math.abs(sh.a - sh.theta - sh.w0)
    for (const r of runs) {
      if (r.params.sigma > 0 && slew > 3 * r.params.sigma && slew / r.params.mu >= 5) {
        w.push(
          String.raw`Case ${r.id}：初始誤差 $|a-\theta-w_0|=${fx(slew, 3)}\,\mathrm{fs}>3\sigma_v$：前約 ${int(slew / r.params.mu)} 步是 slew-limited（每步固定 $\pm\mu$、與誤差大小無關），之後才進入 $K_q$ 小訊號區；用 $\tau\approx1/(\mu K_q)$ 估計收斂時間會低估。`,
        )
      }
    }
    for (const r of runs) {
      if (Number.isFinite(r.tau) && r.tau > 0 && sh.steps < 20 * r.tau) {
        w.push(
          String.raw`Case ${r.id}：步數 ${sh.steps} $<20\tau$（$\tau\approx1/(\mu K_q)\approx${texInt(r.tau)}$ samples）：後半段只涵蓋不到 10 個時間常數，Monte Carlo 的時間平均與 RMS 仍含暫態且統計樣本太少，會和精確穩態對不上——這是模擬太短，不是模型錯誤；請增加步數或加大 $\mu$。`,
        )
      }
    }
    if (simError) w.push(`Monte Carlo 無法執行：${simError}`)
    return w
  }, [runs, sh, simError])

  const c = cases.active.params
  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`Dither 實驗：$\sigma_v$ 對逐 sample Sign-LMS 的影響（Case A/B/C）`}
      level="L1"
      claim="exact"
      source="simulation"
      headingLevel={3}
      description={
        <>
          <Tex>{'w_{n+1}=w_n+\\mu\\,q_n'}</Tex>，<Tex>{'q_n=\\operatorname{sign}(a-w_n+v_n-\\theta)'}</Tex>（<Tex>{'x\\equiv1'}</Tex>，硬體慣例{' '}
          <Tex>{'\\operatorname{sign}(0)=+1'}</Tex>）。每個 Case 用同一個 seed（paired comparison），只改變 <Tex>{'\\sigma_v'}</Tex> 或 <Tex>{'\\mu'}</Tex>。
        </>
      }
      assumptions={[
        String.raw`$x\equiv1$，每個 comparator sample 都更新一次（不經 GMAC block 平均）`,
        '$v$ iid Gaussian',
        String.raw`解析值：$w$ 只落在格點 $w_0+k\mu$，以 birth–death Markov chain 的細緻平衡求穩態`,
        String.raw`後半段（$n\ge\text{steps}/2$）當作穩態做時間平均`,
      ]}
      params={{ a: sh.a, w0: sh.w0, theta: sh.theta, steps: sh.steps, sigma_v: c.sigma, mu: c.mu, active_case: cases.activeId }}
      seed={cases.seed}
      onSeedChange={setSeed}
      units={{ a: 'fs', w0: 'fs', theta: 'fs', sigma_v: 'fs', mu: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          setSh(DEFAULT_SHARED)
          setPending({ sigmas: DEFAULT_SIGMAS, mu: 0.5, stage: 'reset' })
        },
      }}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      exportData={() => {
        const out: Record<string, ArrayLike<number>> = {}
        for (const r of runs) if (r.sim) out[`w_case_${r.id}`] = r.sim.w
        out.tradeoff_sigma = tradeoff.rows.map((r) => r.sigma)
        out.tradeoff_abs_bias = tradeoff.rows.map((r) => r.absBias)
        out.tradeoff_rms = tradeoff.rows.map((r) => r.rms)
        out.tradeoff_rms_linear = tradeoff.rows.map((r) => r.lin)
        return out
      }}
      controls={
        <div className="ch05-controls">
          <CaseSelector cases={cases} label="比較組（各自的雜訊 RMS 與步長）" />
          <ParamControl label={mathText(String.raw`$\sigma_v$ — Case ${cases.activeId}`)} ariaLabel={`σ_v — Case ${cases.activeId}`} value={c.sigma} onChange={(sigma) => update({ sigma })} min={0} max={200} step={0.01} unit="fs" reg="Behavioral: σ_v（comparator 前雜訊）" hint="0 = hard limiter" />
          <ParamControl label={mathText(String.raw`$\mu$（步長）— Case ${cases.activeId}`)} ariaLabel={`μ（步長）— Case ${cases.activeId}`} value={c.mu} onChange={(mu) => update({ mu })} min={0.001} max={10} log unit="fs" reg="REG_LMS_STEP（每 sample）" />
          <ParamControl label={mathText('$a$（真值）')} ariaLabel="a（真值）" value={sh.a} onChange={(a) => setSh((s) => ({ ...s, a }))} min={-20} max={20} step={0.01} unit="fs" reg="Behavioral: 理想係數 a" />
          <ParamControl label={mathText('$w_0$（初值）')} ariaLabel="w₀（初值）" value={sh.w0} onChange={(w0) => setSh((s) => ({ ...s, w0 }))} min={-20} max={20} step={0.01} unit="fs" reg="REG_LMS_INIT" />
          <ParamControl label={mathText(String.raw`$\theta$（comparator offset）`)} ariaLabel="θ（comparator offset）" value={sh.theta} onChange={(theta) => setSh((s) => ({ ...s, theta }))} min={-5} max={5} step={0.01} unit="fs" reg="Behavioral: θ" />
          <ParamControl label="步數" value={sh.steps} onChange={(steps) => setSh((s) => ({ ...s, steps }))} min={100} max={200000} log integer clampOnBlur unit="samples" reg="Sim: steps" />
        </div>
      }
    >
      <p className="ch05-status" role="status">
        {simTask.running ? 'Monte Carlo 計算中…' : simFresh ? `Monte Carlo 完成（${sh.steps} 步 × ${runs.length} 個 Case，模式 ${simTask.mode}）` : '等待參數穩定…'}
      </p>
      <div className="ch05-plots">
        <Plot
          title={`$w_n$（前 ${showN} 步）`}
          data={trajData}
          layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '$w_n$（fs）' } }, shapes: [hline(sh.a, tokens.textMuted, 'dash')] }}
          height={280}
          csvName="ch05-dither-w"
          caption={
            <>
              虛線 = 真值 <Tex>{'a'}</Tex>。<Tex>{'\\sigma_v=0'}</Tex> 時 <Tex>{'w'}</Tex> 卡在 <Tex>{'a'}</Tex> 兩側的兩個格點之間來回。
            </>
          }
        />
        <Plot
          title={String.raw`時間平均 $\bar w_n=\tfrac1n\sum_{k<n}w_k$（橫軸為 $\log n$）`}
          data={avgData}
          layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: String.raw`$\bar w_n$（fs）` } }, shapes: [hline(sh.a, tokens.textMuted, 'dash')] }}
          xLog
          height={280}
          csvName="ch05-dither-avg"
          caption={
            <>
              有雜訊時 <Tex>{'\\bar w_n\\to E_\\pi[w]\\approx a'}</Tex>；沒有雜訊時停在 limit cycle 的中點。
            </>
          }
        />
      </div>
      <div className="ch05-plots">
        <Plot
          title={String.raw`精確穩態分布 $\pi(w)$（birth–death）`}
          data={piData}
          layout={{ xaxis: { title: { text: '$w$（fs）' } }, yaxis: { title: { text: String.raw`$\pi(w)$` } }, shapes: [vline(sh.a, tokens.textMuted)] }}
          height={280}
          csvName="ch05-dither-pi"
        />
        <Plot
          title={String.raw`取捨曲線：$\sigma_v$ 掃描（$\mu=${texNum(activeMu, 4)}\,\mathrm{fs}$）`}
          data={tradeData}
          layout={{
            xaxis: { title: { text: String.raw`$\sigma_v$（fs）` } },
            yaxis: { title: { text: 'fs' } },
            shapes: [hline(Math.max(1e-12, Math.abs(tradeoff.zero.bias)), tokens.series[3], 'dot')],
          }}
          xLog
          yLog
          height={280}
          csvName="ch05-dither-tradeoff"
          caption={
            <>
              點線 = <Tex>{'\\sigma_v=0'}</Tex> 的 limit-cycle 偏差 <Tex>{`${texNum(Math.abs(tradeoff.zero.bias), 3)}\\,\\mathrm{fs}`}</Tex>。<Tex>{'\\sigma_v\\gtrsim\\mu'}</Tex>{' '}
              後偏差急速（近乎指數地）消失；但 <Tex>{'\\mathrm{RMS}\\propto\\sqrt{\\mu\\sigma_v}'}</Tex> 持續上升。
            </>
          }
        />
      </div>
      <div className="table-wrap">
        <table className="ch05-table">
          <thead>
            <tr>
              <th>Case</th>
              <th className="num">
                <Tex>{'\\sigma_v'}</Tex>（fs）
              </th>
              <th className="num">
                <Tex>{'\\mu'}</Tex>（fs）
              </th>
              <th className="num">
                <Tex>{'\\mu K_q'}</Tex>
              </th>
              <th className="num">
                精確 <Tex>{'E_\\pi[w]-a'}</Tex>
              </th>
              <th className="num">
                MC <Tex>{'\\bar w-a'}</Tex>
              </th>
              <th className="num">精確 RMS</th>
              <th className="num">MC RMS</th>
              <th className="num">線性化 RMS</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className="num">{r.params.sigma}</td>
                <td className="num">{r.params.mu}</td>
                <td className="num">{Number.isFinite(r.g) ? fx(r.g, 4) : <Tex>{'\\infty'}</Tex>}</td>
                <td className="num">{r.st.ok ? sigOrZero(r.st.bias, 4, BIAS_FLOOR) : '—'}</td>
                <td className="num">{r.sim ? sig(r.sim.tailBias, 4) : '…'}</td>
                <td className="num">{r.st.ok ? fx(r.st.rms, 4) : '—'}</td>
                <td className="num">{r.sim ? fx(r.sim.tailRms, 4) : '…'}</td>
                <td className="num">{Number.isFinite(r.lin) ? fx(r.lin, 4) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ExperimentShell>
  )
}

/** §7：雜訊像 dither——沒有雜訊不行，太多雜訊也不行。 */
export function DitherSection() {
  // 表格中的數字由精確穩態（birth–death）即時計算：a = 1.1 fs、w₀ = 0、μ = 0.5 fs
  const ex = useMemo(() => {
    const base = { a: 1.1, w0: 0, mu: 0.5 }
    const zero = signLoopStationary({ ...base, sigma: 0 })
    const eq = signLoopStationary({ ...base, sigma: base.mu })
    const eq2 = signLoopStationary({ ...base, sigma: 2 * base.mu })
    const big = signLoopStationary({ ...base, sigma: 60 * base.mu })
    return { ...base, zero, eq, eq2, big, bigLin: signLoopLinearRms(base.mu, 60 * base.mu), bigTau: 1 / (base.mu * kq(60 * base.mu)) }
  }, [])
  return (
    <Section kind="explore" level={2} title="7. 雜訊像 dither：沒有雜訊不行，太多雜訊也不行">
      <p>
        §5 說 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>，好像雜訊越小、增益越大越好。但 <Tex>{'\\sigma_v\\to0'}</Tex> 時 S 曲線變成階梯：
        原點斜率無限大、其他地方為 0。把 comparator 放進最簡單的逐 sample Sign-LMS 迴路來看（<Tex>{'x\\equiv1'}</Tex>）：每來一個 sample，就把係數往 <Tex>{'q_n'}</Tex>{' '}
        的方向推一小步，<Tex>{'w_{n+1}=w_n+\\mu q_n'}</Tex>。這裡 <Tex>{'\\mu'}</Tex> 是學習率（每一步的步長，單位 <Tex>{'\\mathrm{fs}'}</Tex>），<Tex>{'a'}</Tex> 是真值，
        <Tex>{'w_n'}</Tex> 是第 <Tex>{'n'}</Tex> 個 sample 時的係數，<Tex>{'\\delta_n=a-w_n'}</Tex> 是剩餘誤差。
      </p>
      <Fig name="sampleLoop">
        從左邊的 <Tex>{'a'}</Tex> 出發，順著箭頭走一圈：先比較（<Tex>{'a-w_n'}</Tex> 得到 <Tex>{'\\delta_n'}</Tex>），加上雜訊 <Tex>{'v_n'}</Tex>、減掉 offset{' '}
        <Tex>{'\\theta'}</Tex>，取 sign 得到 <Tex>{'q_n=\\pm1'}</Tex>；乘 <Tex>{'\\mu'}</Tex> 後加到 <Tex>{'w_n'}</Tex> 上成為 <Tex>{'w_{n+1}'}</Tex>；經過一個 sample 的延遲（方塊{' '}
        <Tex>{'z^{-1}'}</Tex>：輸出是上一個 sample 的輸入），再以<strong>負號</strong>回到第一個加法點。回授是負的：<Tex>{'w'}</Tex> 太小（<Tex>{'\\delta>0'}</Tex>）時 <Tex>{'q'}</Tex> 偏向{' '}
        <Tex>{'+1'}</Tex>，<Tex>{'w'}</Tex> 就被往上推。圖上「<Tex>{'+\\mu q_n'}</Tex>」與「<Tex>{'+w_n'}</Tex>」兩條線進入的加法點，就是更新式{' '}
        <Tex>{'w_{n+1}=w_n+\\mu q_n'}</Tex>。
      </Fig>
      <p>同一個迴路，雜訊大小不同，行為完全不同：</p>
      <Fig name="ditherRegimes">
        先看最上面的菱形：比的是雜訊 <Tex>{'\\sigma_v'}</Tex> 和步長 <Tex>{'\\mu'}</Tex> 的相對大小。再看三個分支的結尾：沒有雜訊時，<Tex>{'w'}</Tex>{' '}
        永遠在兩個格點之間來回跳，時間平均卡在兩格的中點；適度的雜訊把階梯抹平，時間平均可以落在格點之間，幾乎無偏（綠色）；雜訊太大時仍然無偏，但 <Tex>{'K_q'}</Tex>{' '}
        太小，收斂的時間常數 <Tex>{'\\tau'}</Tex>（誤差縮小到 <Tex>{'1/e'}</Tex> 所需的步數）與穩態 RMS 都變大。圖上的三個分支，就是下表的三列。
      </Fig>
      <p>
        下表數字以 <Tex>{`a=${ex.a}\\,\\mathrm{fs},\\ w_0=${ex.w0},\\ \\mu=${ex.mu}\\,\\mathrm{fs}`}</Tex> 的精確穩態即時計算；<Tex>{'E_\\pi[\\cdot]'}</Tex>{' '}
        表示穩態下的時間平均（<Tex>{'\\pi'}</Tex> 是穩態分布，Engineer 模式有推導）：
      </p>
      <div className="table-wrap">
        <table className="ch05-table">
          <thead>
            <tr>
              <th>雜訊</th>
              <th>
                平均輸出 <Tex>{'E[q]'}</Tex>
              </th>
              <th>迴路行為</th>
              <th>時間平均偏差 <Tex>{'E_\\pi[w]-a'}</Tex></th>
              <th>代價（RMS 為 <Tex>{'\\sqrt{E_\\pi[(w-a)^2]}'}</Tex>）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{'\\sigma_v=0'}</Tex>
              </td>
              <td>
                階梯 <Tex>{'\\operatorname{sign}(s-\\theta)'}</Tex>
              </td>
              <td>
                <Tex>{'\\pm\\mu'}</Tex> 的 period-2 limit cycle（hard limiter）
              </td>
              <td>
                <Tex>{`${fx(ex.zero.bias, 4)}\\,\\mathrm{fs}`}</Tex>：最多 <Tex>{'\\mu/2'}</Tex>，取決於格點位置，跑多久都不會消失 <ClaimTag kind="exact" />
              </td>
              <td>
                解析度被步長 <Tex>{'\\mu'}</Tex> 鎖死；RMS <Tex>{`${fx(ex.zero.rms, 3)}\\,\\mathrm{fs}`}</Tex>
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'\\sigma_v\\approx\\mu'}</Tex> … 幾倍 <Tex>{'\\mu'}</Tex>
              </td>
              <td>
                平滑 S 曲線、斜率 <Tex>{'K_q'}</Tex>
              </td>
              <td>
                在 <Tex>{'a'}</Tex> 附近隨機遊走（像線性迴路）
              </td>
              <td>
                <Tex>{'\\sigma_v=\\mu'}</Tex> 時 <Tex>{`${texNum(ex.eq.bias, 2)}\\,\\mathrm{fs}`}</Tex>、<Tex>{'\\sigma_v=2\\mu'}</Tex> 時{' '}
                <Tex>{`${texNum(ex.eq2.bias, 2)}\\,\\mathrm{fs}`}</Tex>：幾乎無偏（dither 把階梯線性化），且隨{' '}
                <Tex>{'\\sigma_v/\\mu'}</Tex> 增加急速趨近 0 <ClaimTag kind="approx" />
              </td>
              <td>
                瞬時 RMS 變大：<Tex>{`${fx(ex.eq.rms, 3)}\\,\\mathrm{fs}`}</Tex>（<Tex>{'\\sigma_v=\\mu'}</Tex>）
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'\\sigma_v\\gg\\mu'}</Tex>
              </td>
              <td>
                很平的 S 曲線，<Tex>{'K_q'}</Tex> 很小
              </td>
              <td>
                收斂很慢（時間常數 <Tex>{'\\tau\\approx1/(\\mu K_q)\\propto\\sigma_v'}</Tex>；<Tex>{`\\sigma_v=${60 * ex.mu}\\,\\mathrm{fs}`}</Tex> 時約 {int(ex.bigTau)} 步）
              </td>
              <td>無偏（同上）</td>
              <td>
                <Tex>{'\\mathrm{RMS}\\propto\\sqrt{\\mu\\sigma_v}'}</Tex>：<Tex>{`\\sigma_v=${60 * ex.mu}\\,\\mathrm{fs}`}</Tex> 時精確 {fx(ex.big.rms, 2)} fs、線性化{' '}
                {fx(ex.bigLin, 2)} fs；所需樣本 <Tex>{'\\propto\\sigma_v^2'}</Tex> <ClaimTag kind="approx" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        要估計「又慢又吵」到底多慢、多吵，把迴路圖裡的 sign 換成 §5 的小訊號等效模型：<Tex>{'q_n\\approx K_q\\delta_n+\\eta_n'}</Tex>，其中{' '}
        <Tex>{'\\eta_n'}</Tex> 是 <Tex>{'q_n'}</Tex> 扣掉平均後的零均值「量化雜訊」。
      </p>
      <Fig name="linearizedLoop">
        先和{figNo('sampleLoop')}的迴路比：「加 <Tex>{'v_n'}</Tex>、取 sign」這一段換成藍色的 <Tex>{'\\times K_q'}</Tex>，後面多了一個雜訊注入點 <Tex>{'\\eta_n'}</Tex>；其餘（乘{' '}
        <Tex>{'\\mu'}</Tex>、累加、<Tex>{'z^{-1}'}</Tex>、負回授）一模一樣。原本的雜訊 <Tex>{'v_n'}</Tex> 沒有消失：它的效果已經算進 <Tex>{'K_q'}</Tex> 的大小與 <Tex>{'\\eta_n'}</Tex>{' '}
        裡了（這裡取 <Tex>{'\\theta=0'}</Tex>）。再順著迴路繞一圈：<Tex>{'\\delta_n'}</Tex> 先乘 <Tex>{'K_q'}</Tex>、再乘 <Tex>{'\\mu'}</Tex>，然後以負號回來，所以每一步誤差剩下{' '}
        <Tex>{'(1-\\mu K_q)'}</Tex> 倍——這就是迴路的 pole <Tex>{'p_{\\mathrm{cal}}=1-g'}</Tex>，<Tex>{'g\\equiv\\mu K_q'}</Tex> 是繞一圈的無因次增益（loop gain）。
        圖上第一個加法點是推導第一行的 <Tex>{'\\delta_n=a-w_n'}</Tex>，第二個是第二行的 <Tex>{'q_n\\approx K_q\\delta_n+\\eta_n'}</Tex>，第三個是更新式{' '}
        <Tex>{'w_{n+1}=w_n+\\mu q_n'}</Tex>；把它們代在一起就是第三行。
      </Fig>
      <Steps
        title={
          <>
            線性化的穩態 RMS（<Tex>{'\\sigma_v\\gg\\mu'}</Tex> 時）
          </>
        }
        steps={[
          { tex: String.raw`\delta_n\equiv a-w_n,\qquad \delta_{n+1}=\delta_n-\mu\,q_n`, why: <>代入 <Tex>{'w_{n+1}=w_n+\\mu q_n'}</Tex>（全站 <Tex>{'\\delta=a-w'}</Tex>）。</> },
          { tex: String.raw`q_n=E[q_n\,|\,\delta_n]+\eta_n\approx K_q\delta_n+\eta_n,\quad E[\eta_n]=0,\;\operatorname{Var}(\eta_n)=1-m^2\approx1`, why: <>把 <Tex>{'q'}</Tex> 拆成平均（§5 的小訊號增益）加上零均值的「量化雜訊」<Tex>{'\\eta_n'}</Tex>。</> },
          { tex: String.raw`\delta_{n+1}=(1-\mu K_q)\,\delta_n-\mu\,\eta_n`, why: <>代回：一個 pole 在 <Tex>{'1-\\mu K_q'}</Tex> 的一階遞迴。</> },
          { tex: String.raw`\operatorname{Var}(\delta)=(1-\mu K_q)^2\operatorname{Var}(\delta)+\mu^2`, why: <>穩態時兩邊變異數相等；<Tex>{'\\eta_n'}</Tex> 與 <Tex>{'\\delta_n'}</Tex> 不相關（<Tex>{'\\eta_n'}</Tex> 是這一步新的雜訊）。</> },
          { tex: String.raw`\operatorname{Var}(\delta)=\frac{\mu^2}{1-(1-\mu K_q)^2}=\frac{\mu}{K_q(2-\mu K_q)}`, why: <>移項；分母 <Tex>{'=\\mu K_q(2-\\mu K_q)'}</Tex>，需 <Tex>{'0<\\mu K_q<2'}</Tex>。</> },
          { tex: String.raw`\mu K_q\ll1:\;\operatorname{Var}(\delta)\approx\frac{\mu}{2K_q}=\frac{\mu\,\sigma_v}{2}\sqrt{\frac\pi2}`, why: <>代入 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>：RMS <Tex>{'\\propto\\sqrt{\\mu\\sigma_v}'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-05.15" label={<>逐 sample Sign-LMS 的線性化穩態 <ClaimTag kind="approx" /></>}>
        {String.raw`\operatorname{Var}(\delta)\approx\frac{\mu}{K_q(2-\mu K_q)}\;\approx\;\frac{\mu\,\sigma_v}{2}\sqrt{\frac{\pi}{2}}\quad(\mu K_q\ll1)`}
      </TexBlock>
      <ModeGate min="engineer">
        <p>
          更好的是：這個迴路可以<strong>精確</strong>解。<Tex>{'w'}</Tex> 只會落在格點 <Tex>{'w_k=w_0+k\\mu'}</Tex> 上（這裡 <Tex>{'k'}</Tex> 是格點編號，不是 block），
          每步往上的機率 <Tex>{'u_k=\\Phi((a-\\theta-w_k)/\\sigma_v)'}</Tex>、往下 <Tex>{'\\bar u_k=1-u_k'}</Tex>——這是 birth–death Markov chain。
        </p>
        <Fig name="birthDeath">
          先看藍色的格點 <Tex>{'w_k'}</Tex>：下一步只有兩種可能，往上一格（機率 <Tex>{'u_k'}</Tex>）或往下一格（機率 <Tex>{'\\bar u_k'}</Tex>）；越靠近平衡點{' '}
          <Tex>{'a-\\theta'}</Tex>，<Tex>{'u_k'}</Tex> 越接近 <Tex>{'\\tfrac12'}</Tex>。再看相鄰兩格之間的一對箭頭：走了很久之後，停在第 <Tex>{'k'}</Tex> 格的時間比例記作{' '}
          <Tex>{'\\pi_k'}</Tex>；穩態時「從 <Tex>{'w_k'}</Tex> 往上」與「從 <Tex>{'w_{k+1}'}</Tex> 往下」的流量相等，這就是圖上的細緻平衡式，也是下面推導的第一行。
        </Fig>
        <Prereq title="Markov chain 與穩態分布：「下一步只看現在」">
          <p>
            若下一步的機率只取決於現在的狀態（不需要記得更早的歷史），這串隨機狀態就是 <strong>Markov chain</strong>。本例的狀態是格點編號{' '}
            <Tex>{'k'}</Tex>，每步只能 <Tex>{'k\\to k\\pm1'}</Tex>（birth–death）。<strong>穩態分布</strong> <Tex>{'\\pi_k'}</Tex> 是「走很久以後，處在{' '}
            <Tex>{'k'}</Tex> 的時間比例」：它不再隨時間改變，所以流進每個狀態的機率等於流出的機率。
          </p>
          <p>
            一維鏈只有相鄰兩點之間有流量，所以「平衡」可以逐邊成立：從 <Tex>{'k'}</Tex> 走到 <Tex>{'k+1'}</Tex> 的流量 <Tex>{'\\pi_ku_k'}</Tex> 等於反方向的{' '}
            <Tex>{'\\pi_{k+1}\\bar u_{k+1}'}</Tex>（細緻平衡）。這個鏈每步一定換奇偶（週期 2），所以它描述的是<strong>時間平均</strong>，不是某一步的機率；本節的{' '}
            <Tex>{'E_\\pi[w]'}</Tex> 與 MC 的後半段時間平均比較，正是這個意思。
          </p>
        </Prereq>
        <Steps
          title="精確穩態（細緻平衡 detailed balance）"
          steps={[
            { tex: String.raw`\pi_k\,u_k=\pi_{k+1}\,\bar u_{k+1}`, why: <>穩態時 <Tex>{'k\\to k+1'}</Tex> 與 <Tex>{'k+1\\to k'}</Tex> 的機率流相等（一維鏈只能這樣平衡）。</> },
            { tex: String.raw`\frac{\pi_{k+1}}{\pi_k}=\frac{\Phi\big((a-\theta-w_k)/\sigma_v\big)}{\Phi\big(-(a-\theta-w_{k+1})/\sigma_v\big)}`, why: <>代入 <Tex>{'u_k'}</Tex> 與 <Tex>{'\\bar u_{k+1}=1-u_{k+1}=\\Phi(-(a-\\theta-w_{k+1})/\\sigma_v)'}</Tex>。</> },
            { tex: String.raw`E_\pi[w]=\sum_k\pi_kw_k,\qquad \mathrm{RMS}=\Big(\sum_k\pi_k(w_k-a)^2\Big)^{1/2}`, why: <>連乘後正規化（程式在 log 空間累加避免溢位）；時間平均收斂到 <Tex>{'E_\\pi[w]'}</Tex>（遍歷定理）。</> },
          ]}
        />
        <CodeBlock source={comparatorSrc} region="signLoop" path={SRC_PATH} title="core:signLoop（MC）" />
        <CodeBlock source={comparatorSrc} region="signLoopStationary" path={SRC_PATH} title="core:signLoopStationary（精確穩態）" />
      </ModeGate>
      <DitherExperiment />
      <Callout kind="ok" title="本節結論">
        <ul>
          <li>
            <strong>適度的連續雜訊讓 comparator 的平均輸出可微</strong>，時間平均可以解析到比步長 <Tex>{'\\mu'}</Tex> 細得多的精度（dither）——精確穩態解證實了這點。
            <ClaimTag kind="exact" />
          </li>
          <li>
            雜訊越大，<Tex>{'K_q'}</Tex> 越小：收斂時間 <Tex>{'\\propto\\sigma_v'}</Tex>、穩態 RMS <Tex>{'\\propto\\sqrt{\\mu\\sigma_v}'}</Tex>、辨識方向所需樣本{' '}
            <Tex>{'\\propto\\sigma_v^2'}</Tex>。<strong>不能因為 dither 有用就推論越多雜訊越好</strong>（規格 §5.1）。
            <ClaimTag kind="approx" />
          </li>
          <li>
            Dither 對 comparator offset <Tex>{'\\theta'}</Tex> 無能為力：平衡點永遠在 <Tex>{'w=a-\\theta'}</Tex>。
          </li>
        </ul>
      </Callout>
    </Section>
  )
}
