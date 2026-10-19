import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, ExperimentShell, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { CODE_KIND_LABEL, type BasisComparisonParams, type BasisComparisonRow, type InlCodeKind, type PolyBasis, type Preconditioner } from '@/simulation/models/dtcInl'
import { m, num, texNum } from '../common'

export const BASIS_ID = 'dtc-inl-basis'

export interface BasisUiParams {
  codeKind: InlCodeKind
  frac: number
  M: number
  d2: number
  d3: number
  gMax: number
  sigmaV: number
  N: number
  blocks: number
  precond: Preconditioner
  gamma: number
}

export const DEFAULT_BASIS: BasisUiParams = { codeKind: 'uniform', frac: 0.618, M: 3, d2: 20, d3: 10, gMax: 0.1, sigmaV: 10, N: 64, blocks: 3000, precond: 'none', gamma: 0.1 }
const BASES: PolyBasis[] = ['monomial', 'legendre', 'legendre_norm', 'chebyshev']
const CODE_KINDS: InlCodeKind[] = ['uniform', 'mash111', 'first_order']
/** 每種基底 MC 的 k95 與 mean-field 的比值要落在 [1/K95_FACTOR, K95_FACTOR] */
export const K95_FACTOR = 2
/** 圖例、指標與 KPI 用的基底名稱（`$…$` 版；<option> 用 dtcInl.ts 的 BASIS_LABEL 純文字） */
export const BASIS_TEX: Record<PolyBasis, string> = {
  monomial: 'monomial $1,x,x^2,x^3$',
  legendre: 'Legendre $P_m(x)$',
  legendre_norm: 'normalized Legendre $\\sqrt{2m+1}\\,P_m(x)$',
  chebyshev: 'Chebyshev $T_m(x)$',
}

export function toBasisParams(p: BasisUiParams, seed: number): BasisComparisonParams {
  return { code: { kind: p.codeKind, frac: p.frac }, shape: { d2: p.d2, d3: p.d3, sawAmp: 0, sawSegments: 8 }, M: p.M, bases: BASES, gMax: p.gMax, sigmaV: p.sigmaV, N: p.N, blocks: p.blocks, a: 1, b: 0, precond: p.precond, gamma: p.gamma, seed, monteCarlo: true }
}

export function applyBasisPreset(raw: Record<string, unknown>): BasisUiParams {
  const out: BasisUiParams = { ...DEFAULT_BASIS }
  for (const k of Object.keys(DEFAULT_BASIS) as (keyof BasisUiParams)[]) if (raw[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = raw[k]
  return out
}

export function basisAgreement(rows: BasisComparisonRow[]): { pass: boolean; note: string } {
  const parts: string[] = []
  let pass = true
  for (const r of rows) {
    const ok = r.k95Measured !== null && Number.isFinite(r.k95Analytic) && r.k95Measured / r.k95Analytic >= 1 / K95_FACTOR && r.k95Measured / r.k95Analytic <= K95_FACTOR
    if (!ok) pass = false
    parts.push(`${r.basis}：${r.k95Measured ?? '—'}/${Number.isFinite(r.k95Analytic) ? r.k95Analytic : '∞'}`)
  }
  return { pass, note: `MC／mean-field 的 $k_{95}$（容許比值 ${1 / K95_FACTOR}–${K95_FACTOR}）：${parts.join('、')}` }
}

export function BasisLab() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<BasisUiParams>(DEFAULT_BASIS)
  const [seed, setSeed] = useState(20261019)
  const set = <K extends keyof BasisUiParams>(k: K) => (v: BasisUiParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const params = useMemo(() => toBasisParams(p, seed), [p, seed])
  const key = JSON.stringify(params)
  const [res, setRes] = useState<{ key: string; rows: BasisComparisonRow[]; Kq: number; warnings: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run, cancel, running } = useWorkerTask<BasisComparisonParams, { rows: BasisComparisonRow[]; Kq: number; warnings: string[] }>('dtcInl', 'basisComparison', { restartOnRun: true })
  const launch = useCallback(
    (k: string) => {
      setErr(null)
      run(JSON.parse(k) as BasisComparisonParams).then(
        (r) => setRes({ key: k, ...r }),
        (e) => {
          if (!isWorkerCancelled(e)) setErr((e as Error).message)
        },
      )
    },
    [run],
  )
  const presetList = useMemo(() => presetsForExperiment(BASIS_ID), [])
  const urlPreset = useUrlPreset(BASIS_ID)
  useEffect(() => {
    if (urlPreset) setP(applyBasisPreset(urlPreset.params))
  }, [urlPreset])
  const rows = res && res.key === key ? res.rows : null
  const stale = res !== null && res.key !== key

  const convData: Data[] = useMemo(() => {
    if (!rows) return []
    const out: Data[] = []
    rows.forEach((r, i) => {
      const c = tokens.series[i % tokens.series.length]
      if (r.mc) out.push({ x: r.mc.k, y: r.mc.residualRms, mode: 'lines', name: `${BASIS_TEX[r.basis]}：MC`, line: { color: c, width: 2 } })
      out.push({ x: r.meanField.k, y: r.meanField.residualRms, mode: 'lines', name: `${BASIS_TEX[r.basis]}：mean-field`, line: { color: c, dash: 'dash', width: 1.2 } })
    })
    return out
  }, [rows, tokens])
  const convLayout: Partial<Layout> = useMemo(() => ({ xaxis: { title: { text: 'block $b$' } }, yaxis: { title: { text: '殘餘 INL rms（t.u.，log）' } } }), [])
  const condData: Data[] = useMemo(() => {
    if (!rows) return []
    return [{ type: 'bar', x: rows.map((r) => BASIS_TEX[r.basis]), y: rows.map((r) => r.cond), marker: { color: rows.map((_, i) => tokens.series[i % tokens.series.length]) }, name: '條件數 $\\kappa$' }]
  }, [rows, tokens])
  const condLayout: Partial<Layout> = useMemo(() => ({ yaxis: { title: { text: '$\\kappa=\\lambda_{\\max}/\\lambda_{\\min}$（log）' } }, xaxis: { tickangle: -10 } }), [])

  const metrics: MetricRow[] = []
  const warnings: string[] = []
  if (err) warnings.push(`計算失敗：${err}`)
  const agreement = rows ? basisAgreement(rows) : null
  if (rows) {
    for (const r of rows) {
      metrics.push({ name: `${BASIS_TEX[r.basis]}：條件數 $\\kappa$`, value: r.cond, formulaId: 'F-11B.11', note: String.raw`$\lambda=[${r.lambdas.map((l) => texNum(l, 3)).join(',\\ ')}]$；$\mu=${texNum(r.mu, 4)}$` })
      metrics.push({ name: `${BASIS_TEX[r.basis]}：$k_{95}$ MC vs mean-field`, value: r.k95Measured, unit: 'blocks', analytic: Number.isFinite(r.k95Analytic) ? r.k95Analytic : undefined, tolerance: Number.isFinite(r.k95Analytic) ? (K95_FACTOR - 1) * r.k95Analytic : undefined, note: r.residualRmsFinal !== null ? String.raw`終值 $${texNum(r.residualRmsFinal, 3)}$（floor $${texNum(r.residualRmsFloor, 3)}$）` : '' })
    }
    metrics.push({ name: '$K_q$', value: res?.Kq ?? NaN, unit: 't.u.$^{-1}$' })
    for (const r of rows) warnings.push(...r.warnings.filter((w) => !warnings.includes(w)))
    warnings.push(...(res?.warnings ?? []).filter((w) => !warnings.includes(w)))
  }
  if (stale && !running) warnings.push('參數已變更：按「執行 Run」重新計算。')
  const analyticCheck: CheckEntry = rows ? { status: 'ok', note: `mean-field：$\\kappa$ = ${rows.map((r) => `${r.basis} ${num(r.cond, 3)}`).join('、')}` } : { status: 'n/a', note: '尚未計算' }
  const mcCheck: CheckEntry = rows && agreement ? { status: agreement.pass ? 'ok' : 'mismatch', note: agreement.note } : { status: 'n/a', note: running ? '執行中…' : '尚未執行（按「執行 Run」）' }

  const exportData = () => {
    const cols: Record<string, ArrayLike<number | string | null>> = {}
    rows?.forEach((r) => {
      cols[`${r.basis}_mf_block`] = r.meanField.k
      cols[`${r.basis}_mf_rms`] = r.meanField.residualRms
      if (r.mc) {
        cols[`${r.basis}_mc_block`] = r.mc.k
        cols[`${r.basis}_mc_rms`] = r.mc.residualRms
      }
      cols[`${r.basis}_lambdas`] = r.lambdas
    })
    return cols
  }

  return (
    <ExperimentShell
      id={BASIS_ID}
      title="實驗 C：條件數與 preconditioning——同一個 INL，換基底就快十倍"
      level="L3"
      claim="approx"
      source="simulation"
      description={
        <>
          同一個 <Tex>{'d(x)=d_2x^2+d_3x^3'}</Tex>、同一段 code、同樣的 <Tex>{'\\mu K_q\\lambda_{\\max}=g_{\\max}'}</Tex>，用 monomial、Legendre、normalized Legendre、Chebyshev 四種基底做 LMS：四條曲線最後都到同一個 floor（同一個函數空間），差的只是最慢模式的速度 <Tex>{'\\propto\\kappa'}</Tex>。切到 diag／full preconditioner 看所有 pole 變成 <Tex>{'1-\\gamma'}</Tex>。
        </>
      }
      assumptions={[
        '誤差 $e=d(x)-c(x)+v$（gain 已校正、無 offset）；block Sign-LMS、$\\sigma_v$ 固定；$\\mathbf R$ 由前 $2^{16}$ 個樣本估計',
        '每種基底的 $\\mu$ 設成 $\\mu K_q\\lambda_{\\max}=g_{\\max}$（最快模式相同），所以比較的是 $\\lambda_{\\min}$ 的模式；preconditioner 時所有基底用同一個 $\\gamma$',
        'mean-field：$\\boldsymbol\\delta_0=-\\boldsymbol\\vartheta^*$（係數從 0 開始），$\\boldsymbol\\delta_{b+1}=(\\mathbf I-\\mu K_q\\mathbf M\\mathbf R)\\boldsymbol\\delta_b$；需 $|e|\\ll\\sigma_v$',
        '$M$ 階多項式包含 $d$ 本身時 floor $=0$；MASH 的 $x$ 不是 uniform，Legendre 只是接近對角',
        '所有數字 illustrative',
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ d2: 't.u.', d3: 't.u.', sigmaV: 't.u.', N: 'samples/block', blocks: 'blocks' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: analyticCheck, monteCarlo: mcCheck, fixedPoint: { status: 'not-implemented', note: '係數暫存器的量化：見 Ch13' } }}
      actions={{ onRun: () => launch(key), onStop: cancel, running, onReset: () => setP(DEFAULT_BASIS) }}
      exportData={exportData}
      presets={presetList.map((q) => ({ name: q.title, params: q.params, description: `${q.description} 預期：${q.expected}` }))}
      onLoadPreset={(q) => setP(applyBasisPreset(q.params))}
      controls={
        <>
          <SelectControl label="code 序列" value={p.codeKind} onChange={set('codeKind')} options={CODE_KINDS.map((k) => ({ value: k, label: CODE_KIND_LABEL[k] }))} reg="DSM_ORDER / training pattern" />
          {p.codeKind !== 'uniform' && <ParamControl label="FCW 小數 $\mathrm{frac}$" value={p.frac} onChange={set('frac')} min={0.001} max={0.999} step={0.001} unit="—" reg="FCW[19:0]" />}
          <ParamControl label="$M$（多項式階數）" value={p.M} onChange={set('M')} min={1} max={6} integer clampOnBlur unit="—" reg="INL_POLY_ORDER" hint={m('$\\kappa$ 隨 $M$ 指數成長（Hilbert 矩陣）')} />
          <ParamControl label="$d_2$" value={p.d2} onChange={set('d2')} min={-100} max={100} step={0.5} unit="t.u." reg="Behavioral：INL 二次係數" />
          <ParamControl label="$d_3$" value={p.d3} onChange={set('d3')} min={-100} max={100} step={0.5} unit="t.u." reg="Behavioral：INL 三次係數" />
          <ParamControl label="$g_{\max}=\mu K_q\lambda_{\max}$" value={p.gMax} onChange={set('gMax')} min={0.005} max={1.5} step={0.005} unit="—" reg="REG_LMS_MU（以最快模式正規化）" />
          <ParamControl label="$\sigma_v$" value={p.sigmaV} onChange={set('sigmaV')} min={0.1} max={100} step={0.5} unit="t.u." reg="Behavioral：comparator input noise" />
          <ParamControl label="$N$" value={p.N} onChange={set('N')} min={1} max={4096} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="blocks" value={p.blocks} onChange={set('blocks')} min={100} max={20000} integer clampOnBlur unit="blocks" reg="Behavioral：模擬長度" />
          <SelectControl label="preconditioner" value={p.precond} onChange={set('precond')} options={[{ value: 'none' as Preconditioner, label: 'none：scalar μ' }, { value: 'diag' as Preconditioner, label: 'diagonal：γ/(K_q R_ii)' }, { value: 'full' as Preconditioner, label: 'full：(γ/K_q) R⁻¹' }]} reg="INL_PRECOND" />
          {p.precond !== 'none' && <ParamControl label="$\gamma$" value={p.gamma} onChange={set('gamma')} min={0.005} max={1.9} step={0.005} unit="—" reg="INL_GAMMA" />}
        </>
      }
    >
      <div className="ch11b-kpis">
        {(rows ?? []).map((r) => (
          <div className="ch11b-kpi" key={r.basis}>
            <div className="ch11b-kpi-label">
              {m(BASIS_TEX[r.basis])} <ClaimTag kind="approx" />
            </div>
            <div className="ch11b-kpi-value">{m(`$\\kappa=${texNum(r.cond, 4)}$`)}</div>
            <div className="ch11b-kpi-note">{m(`$k_{95}$：MC ${r.k95Measured ?? '—'} / mean-field ${Number.isFinite(r.k95Analytic) ? r.k95Analytic : '\\infty'}`)}</div>
          </div>
        ))}
        {!rows && <div className="ch11b-kpi"><div className="ch11b-kpi-label">按「執行 Run」</div><div className="ch11b-kpi-value">{running ? '執行中…' : '—'}</div></div>}
      </div>
      <Plot title="殘餘 INL rms vs block：四種基底（實線 MC、虛線 mean-field）" data={convData} layout={convLayout} height={340} yLog csvName="dtc-inl-basis-convergence" caption="同樣的最快模式、同樣的終點：monomial 要等最慢的 $x^3$ 方向，normalized Legendre 所有方向一起到。" />
      <Plot title={'條件數 $\\kappa$：monomial ≫ Chebyshev ≈ Legendre > normalized'} data={condData} layout={condLayout} height={260} yLog csvName="dtc-inl-basis-cond" caption="uniform code：67.6、5.9、7、1；MASH 的 code 不是 uniform，Legendre 只是接近對角。" />
    </ExperimentShell>
  )
}
