import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, ExperimentShell, ParamControl, Plot, SelectControl, Tex, ToggleControl, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  BASIS_LABEL,
  CODE_KIND_LABEL,
  DEFAULT_STRUCTURE,
  STRUCTURE_LABEL,
  analyzeInlStructure,
  paramNames,
  type InlAlgorithm,
  type InlCodeKind,
  type InlLmsParams,
  type InlLmsResult,
  type InlStructure,
  type PolyBasis,
  type Preconditioner,
  type StructureAnalysis,
  type StructureConfig,
} from '@/simulation/models/dtcInl'
import { m, num, texNum } from '../common'

export const LMS_ID = 'dtc-inl-lms'

export interface LmsUiParams {
  structure: InlStructure
  K: number
  J: number
  M: number
  basis: PolyBasis
  gainAdapt: boolean
  codeKind: InlCodeKind
  frac: number
  d2: number
  d3: number
  sawAmp: number
  sawSegments: number
  a: number
  w0: number
  b: number
  sigmaV: number
  algorithm: InlAlgorithm
  mu: number
  N: number
  blocks: number
  precond: Preconditioner
  gamma: number
  autoRun: boolean
}

export const DEFAULT_LMS: LmsUiParams = {
  structure: 'piecewise',
  K: 8,
  J: 64,
  M: 3,
  basis: 'legendre',
  gainAdapt: false,
  codeKind: 'uniform',
  frac: 0.618,
  d2: 20,
  d3: 0,
  sawAmp: 0,
  sawSegments: 8,
  a: 1,
  w0: 1,
  b: 0,
  sigmaV: 10,
  algorithm: 'sign',
  mu: 2,
  N: 64,
  blocks: 3000,
  precond: 'none',
  gamma: 0.05,
  autoRun: true,
}
/** Analytic ↔ MC 的容許：k95 的比值在 [1/K95_FACTOR, K95_FACTOR] 內，且穩態殘餘 rms 相對差 ≤ RMS_TOL */
export const K95_FACTOR = 1.6
export const RMS_TOL = 0.3
const STRUCTURES: InlStructure[] = ['piecewise', 'lut', 'poly']
const BASES: PolyBasis[] = ['monomial', 'legendre', 'legendre_norm', 'chebyshev']
const CODE_KINDS: InlCodeKind[] = ['uniform', 'mash111', 'first_order']
const PRECONDS: { value: Preconditioner; label: string }[] = [
  { value: 'none', label: 'none：scalar μ（所有參數同一個 μ）' },
  { value: 'diag', label: 'diagonal：每個參數 γ/(K_q R_ii)' },
  { value: 'full', label: 'full：(γ/K_q) R⁻¹' },
]

export function toConfig(p: LmsUiParams): StructureConfig {
  return { ...DEFAULT_STRUCTURE, structure: p.structure, K: p.K, J: p.J, M: p.M, basis: p.basis, gainMode: p.gainAdapt ? 'adapt' : 'fixed' }
}

export function toLmsParams(p: LmsUiParams, seed: number): InlLmsParams {
  return {
    config: toConfig(p),
    shape: { d2: p.d2, d3: p.d3, sawAmp: p.sawAmp, sawSegments: p.sawSegments },
    code: { kind: p.codeKind, frac: p.frac },
    a: p.a,
    w0: p.w0,
    b: p.b,
    sigmaV: p.sigmaV,
    mu: p.mu,
    N: p.N,
    blocks: p.blocks,
    algorithm: p.algorithm,
    precond: p.precond,
    gamma: p.gamma,
    seed,
  }
}

export function applyLmsPreset(raw: Record<string, unknown>): LmsUiParams {
  const out: LmsUiParams = { ...DEFAULT_LMS }
  for (const k of Object.keys(DEFAULT_LMS) as (keyof LmsUiParams)[]) if (raw[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = raw[k]
  return out
}

/** Analytic（小訊號 mean-field + misadjustment）↔ Monte Carlo 的判定 */
export function lmsAgreement(r: InlLmsResult): { pass: boolean; k95Ratio: number | null; rmsRel: number; note: string } {
  const k95Ratio = r.k95Measured !== null && Number.isFinite(r.k95Analytic) && r.k95Analytic > 0 ? r.k95Measured / r.k95Analytic : null
  const rmsRel = Math.abs(r.residualRmsFinal - r.residualRmsPredicted) / Math.max(r.residualRmsPredicted, 1e-300)
  const k95ok = k95Ratio === null ? !Number.isFinite(r.k95Analytic) && r.k95Measured === null : k95Ratio >= 1 / K95_FACTOR && k95Ratio <= K95_FACTOR
  const pass = k95ok && rmsRel <= RMS_TOL
  const note = String.raw`$k_{95}$：MC ${r.k95Measured ?? '—'} vs mean-field ${Number.isFinite(r.k95Analytic) ? r.k95Analytic : '∞'}（容許比值 ${1 / K95_FACTOR}–${K95_FACTOR}）；穩態殘餘 rms：MC ${num(r.residualRmsFinal, 4)} vs 預測 ${num(r.residualRmsPredicted, 4)}（相對差 ${num(100 * rmsRel, 3)}%，容許 ${100 * RMS_TOL}%）`
  return { pass, k95Ratio, rmsRel, note }
}

export function InlLmsLab() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<LmsUiParams>(DEFAULT_LMS)
  const [seed, setSeed] = useState(20261019)
  const set = <K extends keyof LmsUiParams>(k: K) => (v: LmsUiParams[K]) => setP((s) => ({ ...s, [k]: v }))

  // ── 即時分析（主執行緒；useDeferredValue 避免拖動卡頓）──
  const dp = useDeferredValue(p)
  const analysis = useMemo<{ an: StructureAnalysis | null; error: string | null }>(() => {
    try {
      const an = analyzeInlStructure({ config: toConfig(dp), shape: { d2: dp.d2, d3: dp.d3, sawAmp: dp.sawAmp, sawSegments: dp.sawSegments }, code: { kind: dp.codeKind, frac: dp.frac }, a: dp.a, w0: dp.w0, b: dp.b, sigmaV: dp.sigmaV, mu: dp.mu, N: dp.N, precond: dp.precond, gamma: dp.gamma, algorithm: dp.algorithm, seed })
      return { an, error: null }
    } catch (e) {
      return { an: null, error: (e as Error).message }
    }
  }, [dp, seed])
  const an = analysis.an

  // ── Monte Carlo（worker）──
  const params = useMemo(() => toLmsParams(p, seed), [p, seed])
  const key = JSON.stringify(params)
  const [res, setRes] = useState<{ key: string; r: InlLmsResult } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run, cancel, running, mode } = useWorkerTask<InlLmsParams, InlLmsResult>('dtcInl', 'simulateInlLms', { restartOnRun: true })
  const launch = useCallback(
    (k: string) => {
      setErr(null)
      run(JSON.parse(k) as InlLmsParams).then(
        (r) => setRes({ key: k, r }),
        (e) => {
          if (!isWorkerCancelled(e)) setErr((e as Error).message)
        },
      )
    },
    [run],
  )
  const launchRef = useRef(launch)
  launchRef.current = launch
  const debouncedKey = useDebouncedValue(key, 800)
  const autoRun = p.autoRun && mode === 'worker'
  useEffect(() => {
    if (autoRun) launchRef.current(debouncedKey)
  }, [debouncedKey, autoRun])
  const r = res && res.key === key ? res.r : null
  const stale = res !== null && res.key !== key

  const presetList = useMemo(() => presetsForExperiment(LMS_ID), [])
  const urlPreset = useUrlPreset(LMS_ID)
  useEffect(() => {
    if (urlPreset) setP(applyLmsPreset(urlPreset.params))
  }, [urlPreset])

  const names = useMemo(() => paramNames(toConfig(p)), [p])

  // ── 圖：參數軌跡 ──
  const traceData: Data[] = useMemo(() => {
    if (!r) return []
    const P = r.trace.params.length
    const show = Math.min(P, 24)
    const out: Data[] = []
    for (let i = 0; i < show; i++) {
      out.push({ x: r.trace.k, y: r.trace.params[i], mode: 'lines', name: `$${names[i]}$`, line: { width: P > 8 ? 1 : 1.5, color: tokens.series[i % tokens.series.length] }, showlegend: P <= 8 })
    }
    const k = r.trace.k
    const kx = [k[0], k[k.length - 1]]
    for (let i = 0; i < show; i++) {
      if (!Number.isFinite(r.analytic.thetaStar[i])) continue
      out.push({ x: kx, y: [r.analytic.thetaStar[i], r.analytic.thetaStar[i]], mode: 'lines', name: i === 0 ? 'LS 最佳解 $\\theta^*$' : `$${names[i]}^*$`, line: { dash: 'dot', width: 1, color: tokens.series[i % tokens.series.length] }, showlegend: i === 0 })
    }
    return out
  }, [r, names, tokens])
  const traceLayout: Partial<Layout> = useMemo(() => ({ xaxis: { title: { text: 'block $b$' } }, yaxis: { title: { text: '參數（t.u.）' } } }), [])

  // ── 圖：殘餘 INL rms vs block ──
  const rmsData: Data[] = useMemo(() => {
    if (!r) return []
    const k = r.trace.k
    const kx = [k[0], k[k.length - 1]]
    return [
      { x: k, y: r.trace.residualRms, mode: 'lines', name: 'Monte Carlo：殘餘 INL rms', line: { color: tokens.series[0], width: 2 } },
      { x: r.meanField.k, y: r.meanField.residualRms, mode: 'lines', name: 'mean-field $\\sqrt{\\delta^T R\\delta+\\text{floor}^2}$', line: { color: tokens.series[1], dash: 'dash', width: 1.5 } },
      { x: kx, y: [r.residualRmsFloor, r.residualRmsFloor], mode: 'lines', name: `結構的 floor（${num(r.residualRmsFloor, 3)}）`, line: { color: tokens.textMuted, dash: 'dot', width: 1 } },
      { x: kx, y: [r.residualRmsPredicted, r.residualRmsPredicted], mode: 'lines', name: `floor + misadjustment（${num(r.residualRmsPredicted, 3)}）`, line: { color: tokens.series[2], dash: 'dashdot', width: 1 } },
    ]
  }, [r, tokens])
  const rmsLayout: Partial<Layout> = useMemo(() => ({ xaxis: { title: { text: 'block $b$' } }, yaxis: { title: { text: '殘餘 INL rms（t.u.，log）' } } }), [])

  // ── 圖：INL 曲線 ──
  const curveData: Data[] = useMemo(() => {
    if (!r) return []
    const out: Data[] = [
      { x: r.curve.x, y: r.curve.target, mode: 'lines', name: '要補的量 $(a-w_0)x+b+d(x)$', line: { color: tokens.textMuted, width: 1.5 } },
      { x: r.curve.x, y: r.curve.correction, mode: 'lines', name: '補償量 $c(x)$（最後的參數）', line: { color: tokens.series[0], width: 2 } },
      { x: r.curve.x, y: r.curve.residual, mode: 'lines', name: '殘餘 INL', line: { color: tokens.series[1], width: 2 } },
    ]
    if (r.analytic.visit.length) {
      const bins = r.analytic.visit.length
      const centers = r.analytic.visit.map((_, i) => -1 + (2 * (i + 0.5)) / bins)
      out.push({ x: centers, y: r.analytic.visit, type: 'bar', name: '造訪機率 $p_k$（右軸）', yaxis: 'y2', marker: { color: tokens.series[3], opacity: 0.35 } })
    }
    return out
  }, [r, tokens])
  const curveLayout: Partial<Layout> = useMemo(
    () => ({ xaxis: { title: { text: '正規化 code $x$' } }, yaxis: { title: { text: '延遲（t.u.）' }, zeroline: true }, yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: { text: '$p_k$' }, rangemode: 'tozero' }, barmode: 'overlay' }),
    [],
  )

  // ── 指標、警告、交叉比對 ──
  const metrics: MetricRow[] = []
  const warnings: string[] = []
  if (analysis.error) warnings.push(`參數錯誤：${analysis.error}`)
  if (err) warnings.push(`Monte Carlo 失敗：${err}`)
  const agreement = r ? lmsAgreement(r) : null
  if (an) {
    const P = an.R.length
    metrics.push({ name: '參數個數 $P$', value: P, note: p.gainAdapt ? '含同時校正的 gain $w$' : 'gain 固定（假設 Ch11 已校正）' })
    metrics.push({ name: '$\\lambda_{\\max}$、$\\lambda_{\\min}$（$\\mathbf R$ 的特徵值）', value: `${num(an.mode.lambdaMax, 4)}, ${num(an.mode.lambdaMin, 4)}`, formulaId: 'F-11B.7' })
    metrics.push({ name: '條件數 $\\kappa=\\lambda_{\\max}/\\lambda_{\\min}$', value: an.mode.cond, formulaId: 'F-11B.11', note: an.mode.singular ? '奇異：有方向沒被激發（gauge 或沒有樣本）' : p.structure === 'poly' ? '換 Legendre／normalized 基底可降' : '分段／LUT：外段／稀疏格造成' })
    metrics.push({ name: '最慢的有效模式 $k_{95}$（pole 法）', value: Number.isFinite(an.mode.k95Slowest) ? an.mode.k95Slowest : null, unit: 'blocks', formulaId: 'F-11B.8', note: String.raw`$\tau=${texNum(an.mode.tauSlowest, 4)}$ blocks；最快 $${an.mode.k95.length ? Math.min(...an.mode.k95.filter(Number.isFinite)) : '—'}$` })
    metrics.push({ name: '結構的 floor（LS 近似誤差 rms）', value: an.ls.residualRms, unit: 't.u.', formulaId: 'F-11B.13', note: an.ls.singular ? '最小範數解' : `校正前 ${num(an.residualRms0, 4)}` })
    metrics.push({ name: '穩態 $\\sigma_\\theta$ 預測（最大）', value: Math.max(...an.mode.paramStd.filter(Number.isFinite)), unit: 't.u.', claim: 'approx', formulaId: 'F-11B.10', note: String.raw`小 $g$ 時 $\sqrt{\mu/(2K_qN)}=${texNum(Math.sqrt(p.mu / (2 * an.Kq * p.N)), 4)}$` })
    metrics.push({ name: '$K_q$', value: an.Kq, unit: p.algorithm === 'sign' ? 't.u.$^{-1}$' : '—', note: p.algorithm === 'sign' ? '$\\sqrt{2/\\pi}/\\sigma_v$' : 'MSE：GMAC 直接用 $e$' })
    metrics.push({ name: '硬體：乘法器／加法器／記憶體字數', value: `${an.cost.multipliers} / ${an.cost.adders} / ${an.cost.memoryWords}`, note: an.cost.note })
    if (an.visit.length) {
      const minV = Math.min(...an.visit)
      metrics.push({ name: '造訪機率 $p_k$：最小／最大', value: `${num(minV, 3)} / ${num(Math.max(...an.visit), 3)}`, note: an.visit.filter((v) => v === 0).length ? `${an.visit.filter((v) => v === 0).length} 個段／格沒有樣本` : minV < 0.01 ? '有段／格低於 1%：時間常數比平均長數十倍' : '每段／格都有足夠樣本' })
    }
    warnings.push(...an.warnings)
  }
  if (r) {
    metrics.push({ name: 'MC：殘餘 INL rms（最後 10%）', value: r.residualRmsFinal, unit: 't.u.', analytic: r.residualRmsPredicted, tolerance: RMS_TOL, toleranceMode: 'rel', note: `校正前 ${num(r.residualRms0, 4)}；預測 = floor + misadjustment` })
    metrics.push({ name: 'MC：$k_{95}$（殘餘超出量降到 5%）', value: r.k95Measured, unit: 'blocks', analytic: Number.isFinite(r.k95Analytic) ? r.k95Analytic : undefined, tolerance: Number.isFinite(r.k95Analytic) ? (K95_FACTOR - 1) * r.k95Analytic : undefined, note: 'mean-field 的殘餘 rms 曲線給出的 $k_{95}$' })
    const best = r.analytic.visit.length ? r.analytic.visit.indexOf(Math.max(...r.analytic.visit)) + (p.gainAdapt ? 1 : 0) : r.thetaStd.length - 1
    if (Number.isFinite(r.analytic.paramStd[best]))
      metrics.push({ name: `MC：$${names[best]}$ 的穩態 std（後半段）`, value: r.thetaStd[best], unit: 't.u.', analytic: r.analytic.paramStd[best], tolerance: 0.5 * r.analytic.paramStd[best], claim: 'approx', formulaId: 'F-11B.10', note: '後半段的樣本 std；時間常數接近視窗長度時會偏低' })
    warnings.push(...r.warnings.filter((w) => !warnings.includes(w)))
  }
  if (stale && !running) warnings.push('參數已變更，下面的 Monte Carlo 結果是上一組參數的（按「執行 Run」或開啟自動重跑）。')

  const analyticCheck: CheckEntry = an
    ? an.mode.singular
      ? { status: 'n/a', note: '$\\mathbf R$ 奇異：沒有唯一的固定點（gauge 或缺乏 PE）' }
      : { status: 'ok', note: String.raw`小訊號 mean-field：$k_{95}=${Number.isFinite(an.mode.k95Slowest) ? an.mode.k95Slowest : '\\infty'}$、floor $=${texNum(an.ls.residualRms, 4)}$` }
    : { status: 'n/a', note: '參數錯誤' }
  const mcCheck: CheckEntry = r && agreement ? { status: agreement.pass ? 'ok' : 'mismatch', note: agreement.note } : { status: 'n/a', note: running ? '執行中…' : '尚未執行（按「執行 Run」）' }

  const exportData = () => {
    const cols: Record<string, ArrayLike<number | string | null>> = {}
    if (r) {
      cols.block = r.trace.k
      r.trace.params.forEach((a, i) => (cols[`param_${i + 1}`] = a))
      cols.residual_rms = r.trace.residualRms
      cols.mean_field_block = r.meanField.k
      cols.mean_field_residual_rms = r.meanField.residualRms
      cols.curve_x = r.curve.x
      cols.curve_target = r.curve.target
      cols.curve_correction = r.curve.correction
      cols.curve_residual = r.curve.residual
      cols.theta_star = r.analytic.thetaStar
      cols.lambdas = r.analytic.lambdas
      cols.visit = r.analytic.visit
    }
    return cols
  }

  return (
    <ExperimentShell
      id={LMS_ID}
      title="實驗 B：分段／LUT／多項式 LMS 的收斂"
      level="L3"
      claim="approx"
      source="simulation"
      description={
        <>
          同一個 INL <Tex>{'d(x)'}</Tex>、同一段 code，換三種校正結構做 block LMS：看每個參數的軌跡、殘餘 INL rms 隨 block 下降的曲線（與小訊號 mean-field 比）、以及最後的{' '}
          <Tex>{'c(x)'}</Tex> 貼得多近。分段與 LUT 的 <Tex>{'\\mathbf R'}</Tex> 對角：慢的是 <Tex>{'\\lambda_k'}</Tex> 小的段；多項式要看條件數。
        </>
      }
      assumptions={[
        '誤差 $e=(a-w)x+b+d(x)-c(x)+v$，$v\\sim\\mathcal N(0,\\sigma_v^2)$ 與 $x$ 獨立；靜態誤差路徑（主迴路動態已吸收，Ch11 的 identity path）',
        'gain 固定時 $w=w_0$（預設 $=a$：假設 Ch11 的 gain 校正已完成）；gain 同時校正時 $w$ 是第一個參數、regressor 是 $x$',
        'block LMS：$\\boldsymbol\\vartheta\\leftarrow\\boldsymbol\\vartheta+\\mu\\mathbf M\\mathbf G$，$\\mathbf G=\\frac1N\\sum q\\boldsymbol\\psi$；Sign：$q=\\operatorname{sign}(e)$（$\\operatorname{sign}(0)=+1$）；MSE：$q=e$',
        'mean-field：$\\boldsymbol\\delta_{b+1}=(\\mathbf I-\\mu K_q\\mathbf M\\mathbf R)\\boldsymbol\\delta_b$，需 $|e|\\ll\\sigma_v$（一開始飽和時只描述後段）；$\\mathbf R$、LS 最佳解與造訪機率用前 $2^{16}$ 個樣本估計',
        '殘餘 INL rms 以 code 序列的前 2048 個樣本加權（即 code 的分布）；$k_{95}$ 是殘餘「超出量」（相對終值，平方）降到 5% 的 block',
        '所有數字 illustrative；$x\\in[-1,1]$ 正規化、時間單位 t.u.',
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ d2: 't.u.', d3: 't.u.', sawAmp: 't.u.', a: 't.u.', w0: 't.u.', b: 't.u.', sigmaV: 't.u.', mu: p.algorithm === 'sign' ? 't.u.' : '—', N: 'samples/block', blocks: 'blocks' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: analyticCheck, monteCarlo: mcCheck, fixedPoint: { status: 'not-implemented', note: '定點 LUT／係數暫存器：見 Ch13 的量化策略' } }}
      actions={{ onRun: () => launch(key), onStop: cancel, running, onReset: () => setP(DEFAULT_LMS) }}
      exportData={exportData}
      presets={presetList.map((q) => ({ name: q.title, params: q.params, description: `${q.description} 預期：${q.expected}` }))}
      onLoadPreset={(q) => setP(applyLmsPreset(q.params))}
      controls={
        <>
          <div className="ch11b-group-title">校正結構</div>
          <SelectControl label="結構" value={p.structure} onChange={set('structure')} options={STRUCTURES.map((s) => ({ value: s, label: STRUCTURE_LABEL[s] }))} reg="INL_CAL_MODE" />
          {p.structure === 'piecewise' && <ParamControl label="$K$（段數）" value={p.K} onChange={set('K')} min={1} max={64} integer clampOnBlur unit="—" reg="INL_SEG_N" hint={m('$K=1$ 就是 Ch11 的 gain LMS')} />}
          {p.structure === 'lut' && <ParamControl label="$J$（LUT 格數）" value={p.J} onChange={set('J')} min={2} max={256} integer clampOnBlur unit="—" reg="INL_LUT_DEPTH" hint={m('$\\tau_j\\propto J$')} />}
          {p.structure === 'poly' && (
            <>
              <ParamControl label="$M$（多項式階數）" value={p.M} onChange={set('M')} min={1} max={6} integer clampOnBlur unit="—" reg="INL_POLY_ORDER" />
              <SelectControl label="基底" value={p.basis} onChange={set('basis')} options={BASES.map((b) => ({ value: b, label: BASIS_LABEL[b] }))} reg="INL_POLY_BASIS" />
            </>
          )}
          <ToggleControl label="gain $w$ 同時校正（regressor $x$）" value={p.gainAdapt} onChange={set('gainAdapt')} reg="GOS_CAL_EN" hint={m('分段／含 $x$ 的多項式會與 $w$ 共線（gauge，§11b.4）')} />
          <SelectControl label="preconditioner" value={p.precond} onChange={set('precond')} options={PRECONDS} reg="INL_PRECOND" hint={m('diag／full 時步長由 $\\gamma$ 決定，$\\mu$ 不用')} />
          {p.precond !== 'none' && <ParamControl label="$\gamma$（preconditioned loop gain）" value={p.gamma} onChange={set('gamma')} min={0.001} max={1.9} step={0.005} unit="—" reg="INL_GAMMA" hint={m('所有 pole $=1-\\gamma$（$\\mathbf R$ 對角或 full 時）')} />}
          <div className="ch11b-group-title">INL 與 code</div>
          <ParamControl label="$d_2$（二次 INL）" value={p.d2} onChange={set('d2')} min={-100} max={100} step={0.5} unit="t.u." reg="Behavioral：DTC INL 二次係數" />
          <ParamControl label="$d_3$（三次 INL）" value={p.d3} onChange={set('d3')} min={-100} max={100} step={0.5} unit="t.u." reg="Behavioral：DTC INL 三次係數" />
          <ParamControl label="$A_s$（鋸齒振幅）" value={p.sawAmp} onChange={set('sawAmp')} min={0} max={50} step={0.5} unit="t.u." reg="Behavioral：segment error" />
          <ParamControl label="$K_s$（鋸齒段數）" value={p.sawSegments} onChange={set('sawSegments')} min={1} max={64} integer clampOnBlur unit="—" reg="DTC coarse 段數" />
          <SelectControl label="code 序列" value={p.codeKind} onChange={set('codeKind')} options={CODE_KINDS.map((k) => ({ value: k, label: CODE_KIND_LABEL[k] }))} reg="DSM_ORDER / training pattern" />
          {p.codeKind !== 'uniform' && <ParamControl label="FCW 小數 $\mathrm{frac}$" value={p.frac} onChange={set('frac')} min={0.001} max={0.999} step={0.001} unit="—" reg="FCW[19:0]" hint={m('$0.3$：code 落在 $1/10$ 格點 ⇒ LUT 有空格')} />}
          <ParamControl label="$a$（真實 gain）" value={p.a} onChange={set('a')} min={-5} max={5} step={0.01} unit="t.u." reg="Behavioral：DTC gain" />
          <ParamControl label="$w_0$（gain 暫存器）" value={p.w0} onChange={set('w0')} min={-5} max={5} step={0.01} unit="t.u." reg="REG_DTC_GAIN" hint={m('固定時 $(a-w_0)x$ 也要由 INL 校正吸收')} />
          <ParamControl label="$b$（PD offset）" value={p.b} onChange={set('b')} min={-20} max={20} step={0.1} unit="t.u." reg="Behavioral：comparator offset" hint={m('LUT／多項式的常數項會吸收它（gauge）')} />
          <div className="ch11b-group-title">LMS</div>
          <SelectControl label="演算法" value={p.algorithm} onChange={set('algorithm')} options={[{ value: 'sign' as InlAlgorithm, label: 'Sign-LMS（1-bit q）' }, { value: 'mse' as InlAlgorithm, label: 'MSE-LMS（多位元 e）' }]} reg="GMAC_MODE" />
          <ParamControl label="$\sigma_v$（comparator 前雜訊）" value={p.sigmaV} onChange={set('sigmaV')} min={0.01} max={100} step={0.5} unit="t.u." reg="Behavioral：comparator input noise" />
          <ParamControl label="$\mu$（學習率）" value={p.mu} onChange={set('mu')} min={1e-3} max={100} log unit={p.algorithm === 'sign' ? 't.u.' : '—'} reg="REG_LMS_MU" disabled={p.precond !== 'none'} />
          <ParamControl label="$N$（每 block sample 數）" value={p.N} onChange={set('N')} min={1} max={4096} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="blocks" value={p.blocks} onChange={set('blocks')} min={50} max={20000} integer clampOnBlur unit="blocks" reg="Behavioral：模擬長度" />
          <ToggleControl label="參數變更後自動重跑 MC" value={p.autoRun} onChange={set('autoRun')} disabled={mode !== 'worker'} reg="UI：debounce 0.8 s" hint={mode === 'worker' ? '在 Web Worker 執行' : '此環境沒有 Web Worker：請手動按 Run'} />
        </>
      }
    >
      <div className="ch11b-kpis">
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">
            殘餘 INL rms：校正前 → 後（MC） <ClaimTag kind="exact" />
          </div>
          <div className="ch11b-kpi-value">{r ? `${num(r.residualRms0, 3)} → ${num(r.residualRmsFinal, 3)}` : an ? `${num(an.residualRms0, 3)} → ?` : '—'}</div>
          <div className="ch11b-kpi-note">{r ? m(`floor $${texNum(r.residualRmsFloor, 3)}$，預測終值 $${texNum(r.residualRmsPredicted, 3)}$${agreement ? (agreement.pass ? '　✓ 與解析值一致' : '　✗ 超出容許量') : ''}`) : '按「執行 Run」'}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">
            {m('$k_{95}$：MC vs mean-field')} <ClaimTag kind="approx" />
          </div>
          <div className="ch11b-kpi-value">{r ? `${r.k95Measured ?? '—'} / ${Number.isFinite(r.k95Analytic) ? r.k95Analytic : '∞'}` : '—'}</div>
          <div className="ch11b-kpi-note">{an ? m(`最慢有效模式（pole 法）$k_{95}=${Number.isFinite(an.mode.k95Slowest) ? an.mode.k95Slowest : '\\infty'}$`) : ''}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">{m('條件數 $\\kappa$')}</div>
          <div className="ch11b-kpi-value">{an ? num(an.mode.cond, 4) : '—'}</div>
          <div className="ch11b-kpi-note">{an ? m(`$\\lambda_{\\max}=${texNum(an.mode.lambdaMax, 3)}$、$\\lambda_{\\min}=${texNum(an.mode.lambdaMin, 3)}$`) : ''}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">硬體</div>
          <div className="ch11b-kpi-value">{an ? `${an.cost.multipliers} 乘 / ${an.cost.memoryWords} 字` : '—'}</div>
          <div className="ch11b-kpi-note">{an ? m(an.cost.note) : ''}</div>
        </div>
      </div>
      <Plot title="殘餘 INL rms vs block：Monte Carlo 與小訊號 mean-field" data={rmsData} layout={rmsLayout} height={320} yLog csvName="dtc-inl-lms-residual" caption={String.raw`MC 的曲線最後停在 floor 與 misadjustment 的平方和；mean-field 沒有雜訊，停在 floor。兩條曲線的斜率（時間常數）要一致——一開始 $|e|\gg\sigma_v$ 時 comparator 飽和，MC 會比 mean-field 慢。`} />
      <div className="ch11b-plot-grid">
        <Plot title={`參數軌跡（${names.length} 個參數${names.length > 24 ? '，只畫前 24 個' : ''}）`} data={traceData} layout={traceLayout} height={300} csvName="dtc-inl-lms-params" caption={'點線是 LS 最佳解 $\\theta^*$。分段／LUT：外段先到、內段慢慢爬；gain 同時校正時各參數沿著 gauge 方向漂移。'} />
        <Plot title="INL 曲線：要補的量、補償量 $c(x)$ 與殘餘" data={curveData} layout={curveLayout} height={300} csvName="dtc-inl-lms-curve" caption="右軸的長條是每段／每格的造訪機率：MASH 的 code 集中在中間，外側幾乎沒有樣本。" />
      </div>
      {r && (
        <div className="table-wrap">
          <table className="ch11b-table">
            <caption className="small muted">參數表（前 16 個）：LS 最佳解、MC 後半段的平均與 std、預測的穩態 std（F-11B.10）。</caption>
            <thead>
              <tr>
                <th>參數</th>
                <th>
                  <Tex>{'\\vartheta^*'}</Tex>
                </th>
                <th>MC 平均</th>
                <th>MC std</th>
                <th>預測 std</th>
                <th>
                  <Tex>{'\\lambda_i'}</Tex>／<Tex>{'p_k'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {names.slice(0, 16).map((n, i) => (
                <tr key={n}>
                  <td>
                    <Tex>{n}</Tex>
                  </td>
                  <td className="num">{num(r.analytic.thetaStar[i], 4)}</td>
                  <td className="num">{num(r.thetaMean[i], 4)}</td>
                  <td className="num">{num(r.thetaStd[i], 3)}</td>
                  <td className="num">{num(r.analytic.paramStd[i], 3)}</td>
                  <td className="num">{r.analytic.visit.length && !(p.gainAdapt && i === 0) ? num(r.analytic.visit[i - (p.gainAdapt ? 1 : 0)], 3) : num(r.analytic.Rdiag[i], 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExperimentShell>
  )
}
