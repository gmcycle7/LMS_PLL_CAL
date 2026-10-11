import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, Tex, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  ALGORITHM_LABEL,
  CODE_KIND_LABEL,
  buildCodeDistribution,
  codeMoments,
  fixedPoint,
  linearizedFixedPoint,
  mseFixedPoint,
  type BiasAlgorithm,
  type CodeDistKind,
  type DcNullComparisonParams,
  type DcNullComparisonRow,
  type DcNullMode,
  type ErrorModel,
} from '@/simulation/models/bias'
import { DC_MODE_TEX, chop, m, num, texNum } from '../common'

export const DCNULL_ID = 'bias-dcnull-compare'

export interface P {
  b: number
  c2: number
  c3: number
  codeKind: CodeDistKind
  codeShift: number
  sigmaV: number
  algorithm: BiasAlgorithm
  N: number
  blocks: number
  chains: number
}

export const DEFAULT: P = { b: 0.5, c2: 0, c3: 0, codeKind: 'unipolar4', codeShift: 0, sigmaV: 1, algorithm: 'sign', N: 32, blocks: 2000, chains: 16 }
const MODES: DcNullMode[] = ['none', 'shared_bbpd', 'linear_pd']

/** 本地 presets；expected = 三種模式（none / shared BBPD / linear PD）的 Sign mean-field（presets.test.ts 驗證） */
export const DCNULL_PRESETS: { name: string; params: P; expected: [number, number, number] | null }[] = [
  { name: 'E03 例：x ∈ {0,1,2,3}、b = 0.5', params: { ...DEFAULT }, expected: [1.2141, 1, 1.5897] },
  { name: 'Uniform [0,1) residue、b = 0.1', params: { ...DEFAULT, codeKind: 'uniform_residue', b: 0.1 }, expected: null },
  { name: 'E03 例（INL only）：b = 0、c₂ = 0.1', params: { ...DEFAULT, b: 0, c2: 0.1 }, expected: [1.2571, 1.3, 1.3] },
  { name: '置中的 5-level code：三種模式都不受 b 影響', params: { ...DEFAULT, codeKind: 'five_level' }, expected: [1, 1, 1] },
  // servo 抖動 = dither 的示範：小 σ_v 的陡峭區，MC 會偏離「理想 DC null」的 mean-field、貼近 servo-aware 欄
  { name: 'servo 抖動也是 dither：5-level、c₃ = 0.1、b = 0.3、σ_v = 0.1', params: { ...DEFAULT, codeKind: 'five_level', b: 0.3, c3: 0.1, sigmaV: 0.1, blocks: 3000 }, expected: [1.31458, 1.36658, 1.31458] },
]
const MODE_SHORT: Record<DcNullMode, string> = { none: '(A) none（靜態）', shared_bbpd: '(B) shared BBPD', linear_pd: '(C) linear PD + comparator' }

/** 勘誤 E03：三種主迴路 DC null 架構的固定點公式並列，各以 Monte Carlo 驗證。 */
export function DcNullExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<P>(DEFAULT)
  const [seed, setSeed] = useState(20261013)
  const set = <K extends keyof P>(k: K) => (v: P[K]) => setP((s) => ({ ...s, [k]: v }))

  const model: ErrorModel = useMemo(() => ({ a: 1, b: p.b, c2: p.c2, c3: p.c3, kappa: 0, sigmaV: p.sigmaV }), [p.b, p.c2, p.c3, p.sigmaV])
  const code = useMemo(() => ({ kind: p.codeKind, shift: p.codeShift, dsmFrac: 0.3 }), [p.codeKind, p.codeShift])
  const analytic = useMemo(() => {
    try {
      const dist = buildCodeDistribution(code)
      const mo = codeMoments(dist)
      const rows = MODES.map((mode) => ({
        mode,
        linear: p.algorithm === 'sign' && p.sigmaV > 0 ? linearizedFixedPoint(model, dist, mode, false).w : mseFixedPoint(model, dist, mode),
        meanField: fixedPoint(p.algorithm, model, dist, mode).w,
      }))
      return { mo, rows, error: null as string | null }
    } catch (e) {
      return { mo: null, rows: [], error: (e as Error).message }
    }
  }, [model, code, p.algorithm, p.sigmaV])

  const params: DcNullComparisonParams = useMemo(
    () => ({ model, code, algorithm: p.algorithm, N: p.N, blocks: p.blocks, chains: p.chains, w0: 1, seed }),
    [model, code, p.algorithm, p.N, p.blocks, p.chains, seed],
  )
  const key = JSON.stringify(params)
  const [res, setRes] = useState<{ key: string; rows: DcNullComparisonRow[]; warnings: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run, cancel, running, mode } = useWorkerTask<DcNullComparisonParams, { rows: DcNullComparisonRow[]; warnings: string[] }>('bias', 'runDcNullComparison', {
    restartOnRun: true,
  })
  const doRun = useCallback(() => {
    const k = JSON.stringify(params)
    setErr(null)
    run(params).then(
      (r) => setRes({ key: k, ...r }),
      (e: unknown) => {
        if (!isWorkerCancelled(e)) setErr((e as Error).message)
      },
    )
  }, [params, run])
  const runRef = useRef(doRun)
  useEffect(() => {
    runRef.current = doRun
  })
  const dKey = useDebouncedValue(key, 900)
  useEffect(() => {
    if (mode === 'worker') runRef.current()
  }, [dKey, mode])
  const valid = res && res.key === key ? res : null

  const chart: Data[] = useMemo(() => {
    const labels = MODES.map((mode) => MODE_SHORT[mode])
    const out: Data[] = [
      { x: labels, y: analytic.rows.map((r) => r.linear), type: 'bar', name: '一階公式', marker: { color: tokens.series[1] } },
      { x: labels, y: analytic.rows.map((r) => r.meanField), type: 'bar', name: 'mean-field', marker: { color: tokens.series[0] } },
    ]
    if (valid && p.algorithm === 'sign')
      out.push({ x: labels, y: valid.rows.map((r) => r.servoAware), type: 'bar', name: String.raw`servo-aware（$\sigma_\mathrm{eff}$）`, marker: { color: tokens.series[3] } })
    if (valid)
      out.push({
        x: labels,
        y: valid.rows.map((r) => r.mc.mean),
        error_y: { type: 'data', array: valid.rows.map((r) => r.mc.halfWidth), visible: true },
        type: 'bar',
        name: 'Monte Carlo（95% CI）',
        marker: { color: tokens.series[2] },
      })
    return out
  }, [analytic.rows, valid, p.algorithm, tokens])

  const layout: Partial<Layout> = useMemo(
    () => ({
      barmode: 'group',
      yaxis: { title: { text: String.raw`$w^*$（t.u.）` } },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: tokens.textMuted, dash: 'dash', width: 1 } }],
    }),
    [tokens],
  )

  const metrics: MetricRow[] = []
  if (analytic.mo)
    metrics.push({ name: '$E[x]$', value: chop(analytic.mo.Ex, analytic.mo.Ex2) }, { name: '$E[x^2]$', value: analytic.mo.Ex2 }, { name: String.raw`$\operatorname{Var}(x)$`, value: analytic.mo.varX })
  analytic.rows.forEach((r, i) => {
    const mc = valid?.rows[i]
    const fid = r.mode === 'none' ? 'F-11.5' : r.mode === 'shared_bbpd' ? 'F-11.6' : 'F-11.7'
    // 一階公式（approx）以 mean-field 為參考；MC 以 servo-aware 固定點為參考（bias.ts 的 mcAgreement：4·SE + 有限步長 + servo 修正的 25%）
    metrics.push({ name: `$w^*$ mean-field ${MODE_SHORT[r.mode]}`, value: r.meanField, unit: 't.u.', claim: 'exact', formulaId: fid })
    metrics.push({ name: `$w^*$ 一階公式 ${MODE_SHORT[r.mode]}`, value: r.linear, unit: 't.u.', claim: 'approx', formulaId: fid, analytic: r.meanField, tolerance: 2e-2, note: '與 mean-field 的差 = 線性化誤差' })
    if (mc && mc.agreement) {
      if (r.mode !== 'none' && p.algorithm === 'sign')
        metrics.push({
          name: `$w^*$ servo-aware ${MODE_SHORT[r.mode]}`,
          value: mc.servoAware,
          unit: 't.u.',
          claim: 'approx',
          analytic: r.meanField,
          note: String.raw`MC 量到 $\varphi$ 的抖動 std $=${texNum(mc.phiStd, 3)}\Rightarrow\sigma_\mathrm{eff}=${texNum(Math.hypot(p.sigmaV, mc.phiStd), 4)}$；與理想 DC null 的差 = servo 抖動（額外 dither）的影響`,
        })
      metrics.push({
        name: `$w^*$ Monte Carlo ${MODE_SHORT[r.mode]}`,
        value: mc.mc.mean,
        unit: 't.u.',
        analytic: mc.agreement.reference,
        tolerance: mc.agreement.tolerance,
        note: String.raw`95% CI $\pm${texNum(mc.mc.halfWidth, 3)}$；$\mu=${texNum(mc.mu, 4)}$；容許 = $4\,\mathrm{SE}$ + 有限步長${mc.agreement.parts.servo > 0 ? ' + servo 修正的 25%' : ''}${mc.settled ? '' : '；尚未收斂'}`,
      })
    }
  })
  const warnings: string[] = []
  if (analytic.error) warnings.push(`參數錯誤：${analytic.error}`)
  if (analytic.mo && analytic.mo.varX < 1e-12) warnings.push(String.raw`$\operatorname{Var}(x)=0$：模式 (B)(C) 移除 code 平均後沒有激勵（$\lambda_\mathrm{min}=0$：不可辨識）。`)
  if (valid) warnings.push(...valid.warnings)
  if (err) warnings.push(`Monte Carlo 失敗：${err}`)

  let mcCheck: CheckEntry = { status: 'n/a', note: running ? '執行中…' : '按「執行 Run」' }
  if (valid) {
    const ran = valid.rows.filter((r) => r.agreement)
    const bad = ran.filter((r) => !r.agreement?.pass)
    mcCheck =
      ran.length === 0
        ? { status: 'n/a', note: '三種模式都無法執行 MC（見警告）' }
        : {
            status: bad.length === 0 ? 'ok' : 'mismatch',
            note: bad.length
              ? `不一致：${bad.map((r) => String.raw`${r.mode}（$\Delta=${texNum(r.agreement?.delta ?? Number.NaN, 2)}$，容許 $${texNum(r.agreement?.tolerance ?? Number.NaN, 2)}$）`).join('、')}`
              : String.raw`${ran.length} 種模式的 MC 皆與 servo-aware 固定點一致（$4\,\mathrm{SE}$ + 有限步長 + servo 修正的 25%）`,
          }
  }

  return (
    <ExperimentShell
      id={DCNULL_ID}
      title="主迴路 DC null 對 offset bias 的影響（勘誤 E03）"
      level="L2"
      claim="approx"
      source="simulation"
      description={
        <>
          同一個 comparator offset <Tex>{'b'}</Tex>、同一組 code，在三種架構下 LMS 停在不同地方。每種模式的一階公式、mean-field 根與 block-LMS Monte Carlo（含主迴路
          servo）並列。
        </>
      }
      assumptions={[
        String.raw`$a=1$、$\kappa=0$；code 為 iid（DSM 依時間順序循環）`,
        String.raw`(B) 共用 BBPD：type-II 積分路徑 $\varphi\leftarrow\varphi-k_\varphi\,q$（$k_\varphi=0.01$/sample），強制 $E[q]=0$`,
        String.raw`(C) 線性 PD：$\varphi\leftarrow\varphi-k_\varphi\,e_\mathrm{PD}$ 強制 $E[e_\mathrm{PD}]=0$；comparator 另加 offset $b$`,
        String.raw`主迴路 servo 遠快於 LMS（時間尺度分離）；$\mu$ 自動設定為 $g=\mu S=0.02$`,
        String.raw`servo 的 $\varphi$ 會抖動（MC 量測其 std）：對 comparator 而言是額外的 dither，MC 以 $\sigma_\mathrm{eff}^2=\sigma_v^2+\operatorname{Var}(\varphi)$ 的 servo-aware 固定點為參考`,
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ b: 't.u.', c2: 't.u.', c3: 't.u.', sigmaV: 't.u.', codeShift: 'code', N: 'samples/block', blocks: 'blocks', chains: 'chains' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: analytic.rows.length ? { status: 'ok', note: '一階公式與 mean-field 皆由 bias.ts 計算' } : 'n/a',
        monteCarlo: mcCheck,
        fixedPoint: { status: 'not-implemented', note: '定點 RTL 版本不在本章範圍' },
      }}
      actions={{ onRun: doRun, onStop: cancel, running, onReset: () => setP(DEFAULT) }}
      exportData={() => ({
        mode: MODES,
        linear: analytic.rows.map((r) => r.linear),
        mean_field: analytic.rows.map((r) => r.meanField),
        servo_aware: valid ? valid.rows.map((r) => r.servoAware) : [],
        phi_std: valid ? valid.rows.map((r) => r.phiStd) : [],
        mc_mean: valid ? valid.rows.map((r) => r.mc.mean) : [],
        mc_ci: valid ? valid.rows.map((r) => r.mc.halfWidth) : [],
        mc_tolerance: valid ? valid.rows.map((r) => r.agreement?.tolerance ?? null) : [],
      })}
      presets={DCNULL_PRESETS.map((pr) => ({
        name: pr.expected ? `${pr.name}（mean-field ${pr.expected.join(' / ')}）` : pr.name,
        params: { ...pr.params } as Record<string, unknown>,
      }))}
      onLoadPreset={(pr) => setP({ ...DEFAULT, ...(pr.params as Partial<P>) })}
      controls={
        <>
          <ParamControl label="$b$（comparator offset）" value={p.b} onChange={set('b')} min={-2} max={2} step={0.01} unit="t.u." reg="Behavioral：comparator offset b" />
          <ParamControl label="$c_2$（二階 INL）" value={p.c2} onChange={set('c2')} min={-0.5} max={0.5} step={0.005} unit="t.u." reg="Behavioral：DTC INL c2" />
          <ParamControl label="$c_3$（三階 INL）" value={p.c3} onChange={set('c3')} min={-0.5} max={0.5} step={0.005} unit="t.u." reg="Behavioral：DTC INL c3" />
          <SelectControl
            label="code 分布"
            value={p.codeKind}
            onChange={set('codeKind')}
            options={(['unipolar4', 'uniform_residue', 'dsm', 'five_level', 'gaussian'] as const).map((k) => ({ value: k, label: CODE_KIND_LABEL[k] }))}
            reg="DSM / training pattern"
          />
          <ParamControl label="code 平移 $x_0$" value={p.codeShift} onChange={set('codeShift')} min={-3} max={3} step={0.01} unit="code" reg="REG_CODE_OFFSET" />
          <ParamControl label="$\sigma_v$" value={p.sigmaV} onChange={set('sigmaV')} min={0} max={5} step={0.01} unit="t.u." reg="Behavioral：comparator noise sigma_v" />
          <SelectControl
            label="演算法"
            value={p.algorithm}
            onChange={set('algorithm')}
            options={(['sign', 'mse'] as const).map((v) => ({ value: v, label: ALGORITHM_LABEL[v] }))}
            reg="GMAC_MODE"
          />
          <ParamControl label="$N$" value={p.N} onChange={set('N')} min={1} max={1024} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="blocks" value={p.blocks} onChange={set('blocks')} min={200} max={20000} integer clampOnBlur unit="blocks" reg="Behavioral：模擬長度" />
          <ParamControl label="chains" value={p.chains} onChange={set('chains')} min={2} max={32} integer clampOnBlur unit="chains" reg="Behavioral：MC 次數" />
        </>
      }
    >
      <Plot
        title="三種架構的 $w^*$：公式 vs mean-field vs Monte Carlo"
        data={chart}
        layout={layout}
        height={300}
        csvName="bias-dcnull-compare"
        caption={String.raw`虛線為真實 $a=1$。servo-aware：把 MC 量到的 $\varphi$ 抖動當成額外 dither（$\sigma_\mathrm{eff}$）後的 mean-field 根 —— DC null 模式下 MC 應該貼近這一欄。`}
      />
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>模式</th>
              <th>一階公式</th>
              <th>mean-field（理想 DC null）</th>
              <th>
                servo-aware（<Tex>{String.raw`\sigma_\mathrm{eff}`}</Tex>）
              </th>
              <th>Monte Carlo（95% CI）</th>
              <th>一致？</th>
            </tr>
          </thead>
          <tbody>
            {analytic.rows.map((r, i) => (
              <tr key={r.mode}>
                <td>{m(DC_MODE_TEX[r.mode])}</td>
                <td className="num">{num(r.linear)}</td>
                <td className="num">{num(r.meanField)}</td>
                <td className="num">{valid ? num(valid.rows[i].servoAware) : '—'}</td>
                <td className="num">{valid ? `${num(valid.rows[i].mc.mean)} ± ${num(valid.rows[i].mc.halfWidth, 3)}` : running ? '執行中…' : '—'}</td>
                <td>{valid?.rows[i].agreement ? (valid.rows[i].agreement?.pass ? '✓' : '✗') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ExperimentShell>
  )
}
