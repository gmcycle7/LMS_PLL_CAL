import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, ExperimentShell, ParamControl, Plot, SelectControl, Tex, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { CODE_KIND_LABEL, type FoldingParams, type FoldingResult, type InlCodeKind } from '@/simulation/models/dtcInl'
import { m, num, texNum } from '../common'

export const FOLDING_ID = 'dtc-inl-folding'

export interface FoldingUiParams {
  codeKind: InlCodeKind
  frac: number
  d2: number
  d3: number
  sawAmp: number
  sawSegments: number
  sigmaV: number
  fsMHz: number
  fBMHz: number
  lengthLog2: number
  nperseg: number
}

export const DEFAULT_FOLDING: FoldingUiParams = { codeKind: 'mash111', frac: 0.618, d2: 20, d3: 0, sawAmp: 0, sawSegments: 8, sigmaV: 10, fsMHz: 100, fBMHz: 1, lengthLog2: 16, nperseg: 4096 }
const CODE_KINDS: InlCodeKind[] = ['mash111', 'uniform', 'first_order']
/** Analytic ↔ 量測的容許相對差（Welch 的統計誤差 + 自相關截斷） */
export const FOLDING_TOL = 0.12

export function toFoldingParams(p: FoldingUiParams, seed: number): FoldingParams {
  return {
    code: { kind: p.codeKind, frac: p.frac, length: 1 << p.lengthLog2 },
    shape: { d2: p.d2, d3: p.d3, sawAmp: p.sawAmp, sawSegments: p.sawSegments },
    sigmaV: p.sigmaV,
    fs: p.fsMHz * 1e6,
    fB: p.fBMHz * 1e6,
    nperseg: p.nperseg,
    seed,
  }
}

/** 從 preset 的扁平參數套用（缺的欄位用預設值） */
export function applyFoldingPreset(raw: Record<string, unknown>): FoldingUiParams {
  const out: FoldingUiParams = { ...DEFAULT_FOLDING }
  for (const k of Object.keys(DEFAULT_FOLDING) as (keyof FoldingUiParams)[]) if (raw[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = raw[k]
  return out
}

/** Analytic 欄的判定：有精確式就比精確式，否則比 Gaussian（標成近似），鋸齒只有量測。 */
export function foldingCheck(r: FoldingResult): CheckEntry {
  if (Number.isFinite(r.PinExactTheory)) {
    const rel = Math.abs(r.PinMeasured - r.PinExactTheory) / r.PinExactTheory
    return { status: rel <= FOLDING_TOL ? 'ok' : 'mismatch', note: String.raw`Welch 帶內功率 ${num(r.PinMeasured, 4)} vs 精確式 ${num(r.PinExactTheory, 4)}（相對差 ${num(100 * rel, 3)}%，容許 ${100 * FOLDING_TOL}%）` }
  }
  if (Number.isFinite(r.PinGaussianTheory) && r.PinGaussianTheory > 0) {
    const ratio = r.PinMeasured / r.PinGaussianTheory
    return { status: 'n/a', note: String.raw`只有 Gaussian 近似式（$d_3$ 或鋸齒沒有精確式）：量測／Gaussian $=${num(ratio, 3)}$；Gaussian 對 sub-Gaussian 的 code 會高估` }
  }
  return { status: 'n/a', note: '這種 INL 形狀沒有封閉式：以 Welch 量測為準' }
}

export function FoldingLab() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<FoldingUiParams>(DEFAULT_FOLDING)
  const [seed, setSeed] = useState(20261019)
  const set = <K extends keyof FoldingUiParams>(k: K) => (v: FoldingUiParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const params = useMemo(() => toFoldingParams(p, seed), [p, seed])
  const key = useDebouncedValue(JSON.stringify(params), 500)
  const [res, setRes] = useState<{ key: string; r: FoldingResult } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run, cancel, running } = useWorkerTask<FoldingParams, FoldingResult>('dtcInl', 'foldingAnalysis', { restartOnRun: true })
  const launch = useCallback(
    (k: string) => {
      setErr(null)
      run(JSON.parse(k) as FoldingParams).then(
        (r) => setRes({ key: k, r }),
        (e) => {
          if (!isWorkerCancelled(e)) setErr((e as Error).message)
        },
      )
    },
    [run],
  )
  useEffect(() => launch(key), [key, launch])
  const r = res?.r ?? null

  const presetList = useMemo(() => presetsForExperiment(FOLDING_ID), [])
  const urlPreset = useUrlPreset(FOLDING_ID)
  useEffect(() => {
    if (urlPreset) setP(applyFoldingPreset(urlPreset.params))
  }, [urlPreset])

  const psdData: Data[] = useMemo(() => {
    if (!r) return []
    const out: Data[] = [
      { x: r.f, y: r.psdX, mode: 'lines', name: 'code $x$ 的 PSD（無因次$^2$/Hz）', line: { color: tokens.series[0], width: 1.5 } },
      { x: r.f, y: r.psdXTheory, mode: 'lines', name: p.codeKind === 'uniform' ? '$x$ 的理論（白色）' : '$x$ 的理論 $|1-e^{-j\\Omega}|^4/48$（40 dB/dec）', line: { color: tokens.series[0], dash: 'dot', width: 1 } },
      { x: r.f, y: r.psdResidual, mode: 'lines', name: '殘餘 INL $d(x)$（gain 校正後）的 PSD', line: { color: tokens.series[1], width: 2 } },
      { x: r.f, y: r.psdTotal, mode: 'lines', name: '殘餘 INL + 雜訊 $v$', line: { color: tokens.textMuted, width: 1 } },
    ]
    if (Number.isFinite(r.inbandLevelTheory) && r.inbandLevelTheory > 0)
      out.push({ x: [r.f[0], r.f[r.f.length - 1]], y: [r.inbandLevelTheory, r.inbandLevelTheory], mode: 'lines', name: '折返位準 $2S(0)/f_s$（Gaussian，理論 $R$）', line: { color: tokens.series[1], dash: 'dash', width: 1.5 } })
    return out
  }, [r, p.codeKind, tokens])
  const psdLayout: Partial<Layout> = useMemo(
    () => ({
      xaxis: { title: { text: '$f$（Hz，log）' } },
      yaxis: { title: { text: 'PSD（one-sided，/Hz，log）' } },
      shapes: [{ type: 'rect', xref: 'x', yref: 'paper', x0: r ? r.f[0] : 1, x1: p.fBMHz * 1e6, y0: 0, y1: 1, fillcolor: tokens.accent, opacity: 0.08, line: { width: 0 } }],
    }),
    [r, p.fBMHz, tokens],
  )

  const barData: Data[] = useMemo(() => {
    if (!r) return []
    const labels = ['Welch 積分（量測）', '自相關加總', '精確式（理論自相關）', 'Gaussian（樣本自相關）', 'Gaussian（理論自相關）'] // bar 的 x 類別是純文字（plotMath 不處理 x 值）
    const vals = [r.PinMeasured, r.PinExactAutocov, r.PinExactTheory, r.PinGaussianEmpirical, r.PinGaussianTheory]
    const keep = vals.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0)
    return [{ type: 'bar', x: keep.map((i) => labels[i]), y: keep.map((i) => vals[i]), marker: { color: keep.map((i) => (i === 0 ? tokens.series[1] : i === 2 ? tokens.series[2] : tokens.series[3])) }, name: '帶內折返功率' }]
  }, [r, tokens])
  const barLayout: Partial<Layout> = useMemo(() => ({ yaxis: { title: { text: '$P_\\mathrm{in}$（t.u.$^2$）' } }, xaxis: { tickangle: -15 } }), [])

  const metrics: MetricRow[] = []
  const warnings: string[] = []
  if (err) warnings.push(`計算失敗：${err}`)
  let analytic: CheckEntry = { status: 'n/a', note: running ? '計算中…' : '尚未計算' }
  if (r) {
    analytic = foldingCheck(r)
    const ref = Number.isFinite(r.PinExactTheory) ? r.PinExactTheory : Number.isFinite(r.PinGaussianTheory) ? r.PinGaussianTheory : undefined
    metrics.push({ name: '帶內折返功率 $P_\\mathrm{in}$（Welch 積分到 $f_B$）', value: r.PinMeasured, unit: 't.u.$^2$', claim: 'exact', formulaId: 'F-11B.6', analytic: ref, tolerance: ref !== undefined ? FOLDING_TOL : undefined, toleranceMode: 'rel', note: String.raw`rms $=${texNum(Math.sqrt(r.PinMeasured), 4)}$ t.u.；$\nu_B=${texNum(r.nuB, 4)}$` })
    metrics.push({ name: '帶內功率：殘餘序列自相關加總 $\\sum_mR_y[m]\\cdot2\\nu_B$', value: Number.isFinite(r.PinExactAutocov) ? r.PinExactAutocov : null, unit: 't.u.$^2$', note: 'lag $\\le64$；與 Welch 的差是 PSD 估計的統計誤差' })
    metrics.push({ name: '帶內功率：精確式（線性過程 + $\\kappa_4$）', value: Number.isFinite(r.PinExactTheory) ? r.PinExactTheory : null, unit: 't.u.$^2$', claim: 'exact', formulaId: 'F-11B.5', note: Number.isFinite(r.PinExactTheory) ? '只有 $d_2$ 項有精確式' : '$d_3$ 或鋸齒：沒有精確式' })
    metrics.push({ name: '帶內功率：Gaussian–Isserlis（理論 $R$）', value: Number.isFinite(r.PinGaussianTheory) ? r.PinGaussianTheory : null, unit: 't.u.$^2$', claim: 'approx', formulaId: 'F-11B.3', note: Number.isFinite(r.PinGaussianTheory) && r.PinMeasured > 0 ? String.raw`高估 $${texNum(100 * (r.PinGaussianTheory / r.PinMeasured - 1), 3)}\%$（code 的峰度 $${texNum(r.kurtosis, 3)}<3$）` : '—' })
    metrics.push({ name: '帶內功率：Gaussian（樣本 $\\hat R$）', value: r.PinGaussianEmpirical, unit: 't.u.$^2$', claim: 'approx' })
    metrics.push({ name: '殘餘 INL 總功率（量測）', value: r.residualPowerMeasured, unit: 't.u.$^2$', note: String.raw`帶內占 $${texNum(100 * (r.PinMeasured / Math.max(r.residualPowerMeasured, 1e-300)), 3)}\%$；Gaussian 預測 $${texNum(r.residualPowerGaussian, 4)}$` })
    metrics.push({ name: 'gain 校正吸收的斜率 $w^*-a$（LS）', value: r.gainAbsorbedMeasured, unit: 't.u.', formulaId: 'F-11B.2', analytic: r.gainAbsorbedGaussian, tolerance: Math.max(0.02, 0.3 * Math.abs(r.gainAbsorbedGaussian)), note: 'Gaussian 預測 $3d_3\\sigma_x^2$；uniform／MASH 的 $E[x^4]/E[x^2]$ 不是 $3\\sigma^2$' })
    metrics.push({ name: '$\\sigma_x^2$', value: r.sigma2, note: p.codeKind === 'mash111' ? '理論 $1/8$' : p.codeKind === 'uniform' ? '理論 $1/3$' : '—' })
    metrics.push({ name: '$R_x[1]$、$R_x[2]$', value: `${num(r.Rx[1], 4)}, ${num(r.Rx[2], 4)}`, note: p.codeKind === 'mash111' ? '理論 $-1/12$、$1/48$' : '—' })
    metrics.push({ name: '峰度 $E[x^4]/\\sigma_x^4$', value: r.kurtosis, note: 'Gaussian 為 3；MASH 約 2.4、uniform 1.8' })
    metrics.push({ name: 'Welch', value: `${r.welch.window}, nperseg ${r.welch.nperseg}, ${r.welch.nSegments} segments`, note: String.raw`ENBW $${texNum(r.welch.enbwHz, 4)}$ Hz、$\Delta f=${texNum(r.welch.df, 4)}$ Hz、one-sided、密度` })
    if (r.period > 0) metrics.push({ name: 'code 週期', value: r.period, unit: 'samples' })
    warnings.push(...r.warnings)
  }

  const exportData = () => {
    const cols: Record<string, ArrayLike<number | string | null>> = {}
    if (r) {
      cols.f_hz = r.f
      cols.psd_x = r.psdX
      cols.psd_x_theory = r.psdXTheory
      cols.psd_residual = r.psdResidual
      cols.psd_total = r.psdTotal
      cols.Rx = r.Rx
    }
    return cols
  }

  return (
    <ExperimentShell
      id={FOLDING_ID}
      title="實驗 A：INL 形狀與折返頻譜"
      level="L4"
      claim="approx"
      source="simulation"
      description={
        <>
          選一種 code（MASH 1-1-1、uniform 白色、first-order）與 INL 形狀（<Tex>{'d_2x^2'}</Tex>、<Tex>{'d_3x^3'}</Tex>、鋸齒狀 segment error），看 gain 校正後的殘餘 INL{' '}
          <Tex>{'d(x[n])'}</Tex> 的 PSD：<Tex>{'x'}</Tex> 的高頻量化雜訊被非線性折回帶內（陰影區 <Tex>{'f\\le f_B'}</Tex>），帶內功率與 F-11B.5／F-11B.6 的預測比較。
        </>
      }
      assumptions={[
        '正規化 code $x\\in[-1,1]$：MASH $x=r/2$、first-order $x=2(r+\\tfrac12)$；INL 係數以 $x=\\pm1$ 處的 t.u. 計',
        '殘餘 INL = $d(x)$ 減掉平均（主迴路吸收的 DC）與 LS 直線（gain 校正吸收的 $(w^*-a)x$）；雜訊 $v$ 只加在「總和」那條曲線',
        'Gaussian–Isserlis 假設 $x$ 零均值 Gaussian；精確式假設 MASH 的 $s_3/M$ 是 iid uniform（frac 遠離有理數）；$P_\\mathrm{in}=S(0)\\cdot2\\nu_B$ 假設帶內平坦',
        'Welch：Hann、密度、one-sided；帶內功率是 PSD 從 0 到 $f_B$ 的梯形積分（DC bin 含在內）',
        '所有數字 illustrative：$f_s=100$ MHz、$f_B=1$ MHz、$d_2=20$ fs 只是示例',
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ d2: 't.u.', d3: 't.u.', sawAmp: 't.u.', sigmaV: 't.u.', fsMHz: 'MHz', fBMHz: 'MHz' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic, monteCarlo: { status: 'n/a', note: 'code 是確定性序列；雜訊 seed 只影響「殘餘 + 雜訊」那條曲線' }, fixedPoint: { status: 'not-implemented', note: '定點 DTC／LUT 的量化：見 Ch13' } }}
      actions={{ onRun: () => launch(key), onStop: cancel, running, onReset: () => setP(DEFAULT_FOLDING) }}
      exportData={exportData}
      presets={presetList.map((q) => ({ name: q.title, params: q.params, description: `${q.description} 預期：${q.expected}` }))}
      onLoadPreset={(q) => setP(applyFoldingPreset(q.params))}
      controls={
        <>
          <div className="ch11b-group-title">Code</div>
          <SelectControl label="code 序列" value={p.codeKind} onChange={set('codeKind')} options={CODE_KINDS.map((k) => ({ value: k, label: CODE_KIND_LABEL[k] }))} reg="DSM_ORDER / training pattern" />
          {p.codeKind !== 'uniform' && <ParamControl label="FCW 小數 $\mathrm{frac}$" value={p.frac} onChange={set('frac')} min={0.001} max={0.999} step={0.001} unit="—" reg="FCW[19:0]（20-bit 累加器）" hint={m('$0.618$ 的 code 分布密；$0.3$ 會落在 $1/10$ 格點上（短週期）')} />}
          <ParamControl label="序列長度 $2^n$" value={p.lengthLog2} onChange={set('lengthLog2')} min={12} max={18} integer clampOnBlur unit="—" reg="Behavioral：模擬長度" />
          <div className="ch11b-group-title">{m('INL 形狀 $d(x)$')}</div>
          <ParamControl label="$d_2$（二次）" value={p.d2} onChange={set('d2')} min={0} max={200} step={0.5} unit="t.u." reg="Behavioral：DTC INL 二次係數" />
          <ParamControl label="$d_3$（三次）" value={p.d3} onChange={set('d3')} min={0} max={200} step={0.5} unit="t.u." reg="Behavioral：DTC INL 三次係數" hint={m('線性部分 $3\\sigma^2x$ 被 gain 校正吸收，只有 $\\mathrm{He}_3$ 折返')} />
          <ParamControl label="$A_s$（鋸齒振幅）" value={p.sawAmp} onChange={set('sawAmp')} min={0} max={50} step={0.5} unit="t.u." reg="Behavioral：segmented DTC 的 fine/coarse 不匹配" />
          <ParamControl label="$K_s$（鋸齒段數）" value={p.sawSegments} onChange={set('sawSegments')} min={1} max={64} integer clampOnBlur unit="—" reg="DTC coarse 段數" />
          <div className="ch11b-group-title">雜訊、頻率與 PSD</div>
          <ParamControl label="$\sigma_v$（comparator 前雜訊）" value={p.sigmaV} onChange={set('sigmaV')} min={0} max={100} step={0.5} unit="t.u." reg="Behavioral：comparator input noise" />
          <ParamControl label="$f_s$（reference 頻率）" value={p.fsMHz} onChange={set('fsMHz')} min={1} max={4000} step={1} unit="MHz" reg="f_ref" />
          <ParamControl label="$f_B$（帶寬）" value={p.fBMHz} onChange={set('fBMHz')} min={0.01} max={200} step={0.01} unit="MHz" reg="PLL 閉迴路頻寬" hint={m('$\\nu_B=f_B/f_s$')} />
          <SelectControl label="Welch nperseg" value={p.nperseg} onChange={set('nperseg')} options={[1024, 2048, 4096, 8192]} reg="PSD 解析度 Δf = f_s/nperseg" />
        </>
      }
    >
      <div className="ch11b-kpis">
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">
            帶內折返 rms <Tex>{String.raw`\sigma_{t,\mathrm{in}}`}</Tex>（量測） <ClaimTag kind="exact" />
          </div>
          <div className="ch11b-kpi-value">{r ? `${num(Math.sqrt(r.PinMeasured), 4)} t.u.` : running ? '計算中…' : '—'}</div>
          <div className="ch11b-kpi-note">{r ? m(`$P_\\mathrm{in}=${texNum(r.PinMeasured, 4)}$ t.u.$^2$`) : ''}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">
            精確式 <ClaimTag kind="exact" />
          </div>
          <div className="ch11b-kpi-value">{r && Number.isFinite(r.PinExactTheory) ? `${num(Math.sqrt(r.PinExactTheory), 4)} t.u.` : '—'}</div>
          <div className="ch11b-kpi-note">{r && Number.isFinite(r.PinExactTheory) ? m('F-11B.5（只含 $d_2$）') : '沒有精確式'}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">
            Gaussian 預測 <ClaimTag kind="approx" />
          </div>
          <div className="ch11b-kpi-value">{r && Number.isFinite(r.PinGaussianTheory) ? `${num(Math.sqrt(r.PinGaussianTheory), 4)} t.u.` : '—'}</div>
          <div className="ch11b-kpi-note">{r && Number.isFinite(r.PinGaussianTheory) ? m(`峰度 $${texNum(r.kurtosis, 3)}$：bounded 的 code 折返得比 Gaussian 少`) : ''}</div>
        </div>
        <div className="ch11b-kpi">
          <div className="ch11b-kpi-label">帶內占殘餘 INL 的比例</div>
          <div className="ch11b-kpi-value">{r && r.residualPowerMeasured > 0 ? `${num(100 * (r.PinMeasured / r.residualPowerMeasured), 3)} %` : '—'}</div>
          <div className="ch11b-kpi-note">{r ? m(`其餘仍在高頻、被 $T$ 濾掉；$x$ 自己在帶內幾乎是 0`) : ''}</div>
        </div>
      </div>
      <Plot
        title="PSD：code $x$ 是高通的，殘餘 INL $d(x)$ 卻在帶內有平坦的底"
        data={psdData}
        layout={psdLayout}
        height={360}
        xLog
        yLog
        csvName="dtc-inl-folding-psd"
        caption={String.raw`陰影 = 帶內 $f\le f_B$。$x$ 的 PSD 往低頻以 40 dB/dec 下降（MASH），$d(x)$ 的 PSD 在低頻變平——這一塊就是折返；虛線是 Gaussian–Isserlis 的位準 $2S(0)/f_s$（one-sided）。`}
      />
      <Plot title="帶內折返功率：量測 vs 各種預測" data={barData} layout={barLayout} height={280} csvName="dtc-inl-folding-inband" caption="量測（Welch 積分）應與精確式一致；Gaussian 式對 MASH 高估約 45%（code 的峰度 2.4）、對 uniform 高估 2.5 倍。" />
    </ExperimentShell>
  )
}
