import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, ExperimentShell, ModeGate, ParamControl, Plot, SelectControl, StepDerivation, Tex, useThemeTokens, type CrossCheck, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { normInv, normPdf } from '@/simulation/core'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import { calLoop } from '@/simulation/models/calNoise'
import {
  ACCEPTANCE_INPUTS,
  ar1Lag1Expectation,
  ar1SampleVarianceFactor,
  clampMcScale,
  KS_CRIT_001,
  MC_PLAN,
  MC_SCALE_MAX,
  MC_SCALE_MIN,
  SWEEP_SCORE_CRIT,
  type McSweepParams,
  type McSweepResult,
} from '@/simulation/models/acceptance'
import { FBlock, M, PassMark, steps } from '../common'
import { fmtNum, texNum } from '../format'
import { idsOfSubset, isMcSubset, type McSubset } from '../mcSubsets'

export const SWEEP_EXPERIMENT_ID = 'acceptance-mc-sweep'

interface SweepUi {
  runs: number
  scale: number
  subset: McSubset
}

const DEFAULT_UI: SweepUi = { runs: 40, scale: 0.25, subset: 'fast' }
const DEFAULT_SEED = 20261010

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '預設：40 個 seed、×0.25、快速項目', params: { runs: 40, scale: 0.25, subset: 'fast', seed: DEFAULT_SEED }, description: '約 3–5 秒（Web Worker）' },
  { name: '更準的校準：150 個 seed', params: { runs: 150, scale: 0.25, subset: 'fast', seed: DEFAULT_SEED }, description: '平均分數的解析度 1/√150 ≈ 0.08；約 10–15 秒' },
  { name: '小樣本 ×0.05（看漸近 SE 何時開始失準）', params: { runs: 150, scale: 0.05, subset: 'fast', seed: DEFAULT_SEED }, description: 'T14 的 z 標準差會略大於 1（Bartlett 漸近式在短 chain 低估 SE）' },
  { name: '含閉迴路與 T12（較慢）', params: { runs: 12, scale: 0.5, subset: 'all', seed: DEFAULT_SEED }, description: 'T06 / T07 / T18 不是校準項目，只統計通過次數' },
]

const r = String.raw
const HIST_EDGES = Array.from({ length: 17 }, (_, i) => -4 + 0.5 * i)
// Plot 以 layout 的參考是否改變決定要不要重畫：放在模組層，父元件重新 render 時不會觸發 Plotly.react
const QQ_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '理論分位數 $\\Phi^{-1}((i + \\tfrac{1}{2})/n)$' } }, yaxis: { title: { text: '排序後的 $z$' } }, showlegend: true }
const HIST_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$z$' }, range: [-4.2, 4.2] }, yaxis: { title: { text: '機率密度' } }, showlegend: true, bargap: 0.05 }

/** §V.3（續）多 seed 校準：z 檢定本身準不準？ */
export function McSweepLab() {
  const tokens = useThemeTokens()
  const [ui, setUi] = useState<SweepUi>(DEFAULT_UI)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [result, setResult] = useState<McSweepResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const task = useWorkerTask<McSweepParams, McSweepResult>('acceptance', 'runAcceptanceMcSweep', { restartOnRun: true })
  const jsonPresets = useMemo(() => presetsForExperiment(SWEEP_EXPERIMENT_ID), [])
  const urlPreset = useUrlPreset(SWEEP_EXPERIMENT_ID)

  const applyParams = useCallback((p: Record<string, unknown>) => {
    setUi((u) => ({
      runs: typeof p.runs === 'number' && p.runs >= 2 && p.runs <= 200 ? Math.round(p.runs) : u.runs,
      scale: typeof p.scale === 'number' && p.scale > 0 ? clampMcScale(p.scale) : u.scale,
      subset: isMcSubset(p.subset) ? p.subset : u.subset,
    }))
    if (typeof p.seed === 'number' && Number.isInteger(p.seed) && p.seed >= 0) setSeed(p.seed)
    setResult(null)
  }, [])

  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  const run = useCallback(() => {
    setError(null)
    task.run({ seed, runs: ui.runs, scale: ui.scale, zCrit: 4, ids: idsOfSubset(ui.subset) }).then(setResult, (e: unknown) => {
      if (!isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
    })
  }, [task, seed, ui])

  const stale = result !== null && (result.seed !== seed || result.runs !== ui.runs || result.scale !== clampMcScale(ui.scale))
  const rows = useMemo(() => result?.rows ?? [], [result])
  const calRows = rows.filter((x) => x.calibrated !== null)
  const nCalOk = calRows.filter((x) => x.calibrated).length
  const pooled = result?.pooled
  const hasPooled = pooled !== undefined && pooled.n > 0
  const ksOk = pooled && hasPooled ? pooled.ksScaled <= KS_CRIT_001 : null
  const allOk = result && hasPooled ? nCalOk === calRows.length && ksOk === true : null
  const planned = MC_PLAN.filter((c) => idsOfSubset(ui.subset).includes(c.id))
  const nCalPlanned = planned.filter((c) => c.kind === 'z' && c.expect === 'agree').length
  // 粗估工作量（以「全部項目、×1、一個 seed ≈ 1 秒」為單位；快速項目約 0.3）
  const cost = ui.runs * ui.scale * (ui.subset === 'fast' ? 0.3 : ui.subset === 'all' || ui.subset === 'closed-loop' || ui.subset === 'T12' ? 1 : 0.2)

  const warnings: string[] = []
  if (nCalPlanned === 0) warnings.push('目前選的項目沒有「校準過的 $z$ 檢定」（T06 / T07 是與線性模型比對、T18 是行為檢查）：校準分數無法計算，只會統計通過次數。')
  if (cost > 60) warnings.push(`預估工作量很大（約 ${fmtNum(cost, 2)} 秒等級）：$K\\times$scale 太大或包含閉迴路 / T12；可以改選「快速」或降低 scale。`)
  if (ui.runs < 10) warnings.push(`$K=${ui.runs}$ 個 seed 太少：平均分數的解析度只有 $1/\\sqrt K=${fmtNum(1 / Math.sqrt(ui.runs), 2)}$，$s_z$ 的相對誤差約 $1/\\sqrt{2K}=${fmtNum(1 / Math.sqrt(2 * ui.runs), 2)}$，幾乎分辨不出校準問題。`)
  if (result) {
    for (const x of calRows.filter((c) => !c.calibrated)) {
      const why =
        Math.abs(x.meanScore) > SWEEP_SCORE_CRIT
          ? `平均分數 $Z_{\\rm mean}=${texNum(x.meanScore, 3)}$ 超出 $\\pm${SWEEP_SCORE_CRIT}$：估計量有系統性偏差（期望值或估計式有 $O(1/n)$ 的偏差沒修正），或模型與期望值真的不符。`
          : `離散分數 $Z_{\\rm sd}=${texNum(x.sdScore, 3)}$ 超出 $\\pm${SWEEP_SCORE_CRIT}$：SE 算錯了（$s_z=${texNum(x.sdZ, 3)}$；$>1$ 表示 SE 被低估，常見原因是把相關樣本當成獨立，或漸近式在小樣本失準）。`
      warnings.push(`${x.key}「${x.label}」校準未通過——${why}`)
    }
    if (ksOk === false && pooled && hasPooled) warnings.push(`合併後的 KS 檢定未通過：$\\sqrt n\\,D=${texNum(pooled.ksScaled, 3)}>${KS_CRIT_001}$（$\\alpha=0.001$）。$z$ 的整體分布偏離 $\\mathcal N(0,1)$。`)
    if (clampMcScale(ui.scale) < 0.1 && !stale) warnings.push('scale $<0.1$：每條 chain 只有約 200 個 block，T14 用的 Bartlett 漸近 SE 會低估一成多（T14 那一列的 $s_z$ 會明顯大於 1）。這是已知的小樣本效應，不是模型錯；把 scale 調回 $0.25$ 以上就消失。')
  }

  const metrics: MetricRow[] = pooled && hasPooled
    ? [
        { name: '合併 $z$ 的平均', value: pooled.mean, analytic: 0, tolerance: SWEEP_SCORE_CRIT / Math.sqrt(Math.max(1, pooled.n)), toleranceMode: 'abs', claim: 'approx', digits: 4, note: `$n=${pooled.n}$ 個 $z$；容許 $\\pm${SWEEP_SCORE_CRIT}/\\sqrt n$` },
        { name: '合併 $z$ 的標準差', value: pooled.sd, analytic: 1, tolerance: SWEEP_SCORE_CRIT / Math.sqrt(2 * Math.max(1, pooled.n)), toleranceMode: 'abs', claim: 'approx', digits: 4, note: '容許 $\\pm3.5/\\sqrt{2n}$（$s$ 的漸近 SE）' },
        { name: 'KS 統計量 $\\sqrt n\\,D$', value: pooled.ksScaled, claim: 'approx', digits: 4, note: `$D=${texNum(pooled.ksD, 3)}$；$\\le${KS_CRIT_001}$ 通過（Kolmogorov 分布 $\\alpha=0.001$）` },
        { name: '$|z|>2$ 的比例', value: pooled.fracBeyond2, analytic: 0.04550026389635842, tolerance: SWEEP_SCORE_CRIT * Math.sqrt((0.0455 * 0.9545) / Math.max(1, pooled.n)), toleranceMode: 'abs', claim: 'approx', digits: 4, note: '$\\mathcal N(0,1)$ 的理論值 $2[1-\\Phi(2)]=4.55\\%$' },
        { name: '校準通過的項目數', value: `${nCalOk} / ${calRows.length}`, claim: 'approx', note: `兩個分數都在 $\\pm${SWEEP_SCORE_CRIT}$ 內` },
      ]
    : []

  const crossCheck: CrossCheck = {
    analytic:
      pooled && hasPooled
        ? { status: ksOk ? 'ok' : 'mismatch', note: `$z$ 的經驗分布 vs $\\mathcal N(0,1)$：$\\sqrt n\\,D=${texNum(pooled.ksScaled, 3)}$（門檻 ${KS_CRIT_001}）` }
        : { status: 'n/a', note: result ? '選的項目沒有校準過的 $z$ 檢定' : '尚未執行' },
    monteCarlo: !result
      ? { status: 'n/a', note: '尚未執行：按「執行 Run」' }
      : allOk === null
        ? { status: 'n/a', note: '選的項目沒有校準過的 $z$ 檢定（只統計通過次數）' }
        : { status: allOk ? 'ok' : 'mismatch', note: `${nCalOk}/${calRows.length} 項的 $Z_{\\rm mean}$、$Z_{\\rm sd}$ 都在 $\\pm${SWEEP_SCORE_CRIT}$ 內${stale ? '；參數已改變，結果過期' : ''}` },
    fixedPoint: { status: 'n/a', note: '這個實驗檢查的是統計判定本身，與定點運算無關' },
  }

  const plots = useMemo(() => {
    if (!pooled || pooled.n < 2) return null
    const n = pooled.n
    const theo = pooled.sorted.map((_, i) => normInv((i + 0.5) / n)) // 理論分位數 Φ⁻¹((i + ½)/n)
    const qq: Data[] = [
      { type: 'scatter', mode: 'markers', x: theo, y: pooled.sorted, name: '排序後的 $z$', marker: { size: 4, color: tokens.series[0] } },
      { type: 'scatter', mode: 'lines', x: [-4, 4], y: [-4, 4], name: '$y = x$（完美校準）', line: { dash: 'dash', color: tokens.textMuted } },
    ]
    const counts = new Array<number>(HIST_EDGES.length - 1).fill(0)
    for (const z of pooled.sorted) {
      const k = Math.floor((z + 4) / 0.5)
      if (k >= 0 && k < counts.length) counts[k]++
    }
    const centers = counts.map((_, k) => HIST_EDGES[k] + 0.25)
    const xs = Array.from({ length: 161 }, (_, i) => -4 + 0.05 * i)
    const hist: Data[] = [
      { type: 'bar', x: centers, y: counts.map((c) => c / (n * 0.5)), name: '$z$ 的直方圖（密度）', marker: { color: tokens.series[0] }, width: 0.46 },
      { type: 'scatter', mode: 'lines', x: xs, y: xs.map((x) => normPdf(x)), name: '$\\mathcal N(0, 1)$ 的密度 $\\varphi(z)$', line: { color: tokens.series[1] } },
    ]
    return { qq, hist }
  }, [pooled, tokens])

  const presets: ExperimentPreset[] = useMemo(
    () => [...INLINE_PRESETS, ...jsonPresets.map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description }))],
    [jsonPresets],
  )

  // 「如果不做偏差修正」的 z 系統偏移（解析預測；與 runAcceptanceMonteCarlo 相同的 n、R）
  const uncorrected = useMemo(() => {
    const i = ACCEPTANCE_INPUTS.T13
    const p = calLoop({ N: i.N, fs: i.fs_hz, mu: i.mu_fs, sigmaV: i.sigma_v_fs, C: i.C }).p
    const n = Math.max(200, Math.round(4000 * clampMcScale(ui.scale))) // 每條 chain 的 block 數
    const R = 24
    const relSe = Math.sqrt((2 * (1 + p * p)) / ((1 - p * p) * n)) / Math.sqrt(R) // SE(s² 的 chain 平均)/σ_w²（Bartlett）
    const seP = Math.sqrt((1 - p * p) / (n * R))
    return { n, t13: (ar1SampleVarianceFactor(p, n) - 1) / relSe, t14: -(ar1Lag1Expectation(p, n, R) - p) / seP }
  }, [ui.scale])

  return (
    <>
      <h3 id="ver-mc-sweep">多 seed 校準：<Tex>{'z'}</Tex> 檢定本身準不準？</h3>
      <p>
        上面每一列都宣稱「模型正確時 <Tex>{r`z\sim\mathcal N(0,1)`}</Tex>」。這個宣稱本身也要驗證——如果 SE 算錯（例如把相關樣本當成獨立），或估計量有沒修正的偏差，
        <Tex>{'z'}</Tex> 就不是標準常態，門檻 <Tex>{r`z_{\rm crit}=4`}</Tex> 代表的誤報率也就不對。規格 §17 要求隨機統計「使用多 seeds 和信賴界限」：把同一組檢查換{' '}
        <Tex>{'K'}</Tex> 個 seed 重跑，得到每一項的 <Tex>{r`z_1,\ldots,z_K`}</Tex>，直接檢查它們的平均是不是 0、標準差是不是 1。
      </p>
      <p className="small">
        需要的兩個工具——卡方分布 <Tex>{r`\chi^2_\nu`}</Tex> 與 Student-<Tex>{'t'}</Tex>——在本節開頭的先備知識框已經介紹：<Tex>{'K'}</Tex> 個常態樣本的樣本變異數滿足{' '}
        <Tex>{r`(K-1)\,s^2/\sigma^2\sim\chi^2_{K-1}`}</Tex>，所以 <Tex>{'s'}</Tex> 本身的相對誤差約 <Tex>{r`1/\sqrt{2(K-1)}`}</Tex>（<Tex>{`K=${ui.runs}`}</Tex> 時約{' '}
        <Tex>{`${fmtNum(100 / Math.sqrt(2 * Math.max(1, ui.runs - 1)), 3)}\\%`}</Tex>）——這決定了「<Tex>{'s_z'}</Tex> 是不是 1」能分辨到多細。
      </p>
      <ModeGate min="engineer">
        <StepDerivation
          title="兩個校準分數"
          steps={steps([
            { tex: r`\bar z=\frac1K\sum_{j=1}^Kz_j,\qquad\operatorname{Var}(\bar z)=\frac1K`, why: r`若每個 $z_j\sim\mathcal N(0,1)$ 且互相獨立（不同 seed），平均值的變異數是 $1/K$。` },
            { tex: r`Z_{\rm mean}=\bar z\,\sqrt K\sim\mathcal N(0,1)`, why: r`把平均值標準化。$|Z_{\rm mean}|$ 太大 $\Rightarrow$ $z$ 有系統性偏移：估計量有偏差，或模型與期望值不符。` },
            { tex: r`s_z^2=\frac{1}{K-1}\sum_j(z_j-\bar z)^2,\qquad(K-1)\,s_z^2\sim\chi^2_{K-1}`, why: r`常態樣本的樣本變異數乘上自由度，服從卡方分布（$\nu=K-1$ 個獨立標準常態的平方和）。` },
            { tex: r`\Big(\frac{\chi^2_\nu}{\nu}\Big)^{1/3}\approx\mathcal N\Big(1-\frac{2}{9\nu},\ \frac{2}{9\nu}\Big)`, why: r`Wilson–Hilferty：卡方除以自由度後取立方根，分布非常接近常態（把右偏拉正）。` },
            { tex: r`Z_{\rm sd}=\frac{(s_z^2)^{1/3}-\big(1-\tfrac{2}{9\nu}\big)}{\sqrt{2/(9\nu)}}\approx\mathcal N(0,1)`, why: r`標準化。$Z_{\rm sd}$ 太大 $\Rightarrow$ $s_z>1$：SE 被低估；太小 $\Rightarrow$ SE 被高估（檢定太保守）。` },
          ])}
        />
        <FBlock id="F-VF.10" />
        <p className="small">
          合併所有獨立的校準項目後，再做一次 Kolmogorov–Smirnov 檢定：<Tex>{r`D=\sup_z|F_n(z)-\Phi(z)|`}</Tex>（經驗分布與 <Tex>{r`\Phi`}</Tex> 的最大垂直距離），
          <Tex>{r`\sqrt n\,D\le1.949`}</Tex> 通過（<Tex>{r`\alpha=0.001`}</Tex>）。 <ClaimTag kind="approx" />
        </p>
      </ModeGate>

      <ExperimentShell
        id={SWEEP_EXPERIMENT_ID}
        title={String.raw`$z$ 校準實驗（同一組檢查 $\times$ $K$ 個 seed）`}
        level="L1"
        claim="approx"
        source="simulation"
        tests={['T03', 'T04', 'T05', 'T13', 'T14', 'T17']}
        headingLevel={4}
        description={
          <>
            第 <Tex>{'j'}</Tex> 個 seed 是 <code>deriveSeed(seed, &apos;sweep-j&apos;)</code>；每個 seed 都完整跑一次上面的 Monte Carlo（門檻固定 <Tex>{r`z_{\rm crit}=4`}</Tex>）。目前選的項目中有{' '}
            {nCalPlanned} 項是校準過的 <Tex>{'z'}</Tex> 檢定。
          </>
        }
        assumptions={[
          '不同 seed 的結果互相獨立（deriveSeed 產生不相關的亂數流）。',
          '校準分數假設 $z$ 近似常態；$K$ 個 $z$ 的平均與變異數各自標準化（F-VF.10）。',
          '反面項目（T05-strict）、與線性模型比對（T06 / T07）與行為檢查（T18）不是校準項目：只統計通過次數。',
          'T17 的「變異」與「平均」完全相依：兩列都顯示，但合併檢定只計入獨立的項目。',
          'T13 與 T14 共用同一批樣本（$s^2$ 與 $r_1$ 的漸近相關很小，但不是嚴格獨立）：KS 檢定的 $n$ 因此略為高估有效樣本數。',
        ]}
        params={{ runs: ui.runs, scale: ui.scale, subset: ui.subset, zCrit: 4 }}
        seed={seed}
        onSeedChange={(s) => {
          setSeed(s)
          setResult(null)
        }}
        units={{ runs: 'seeds', scale: '×', zCrit: 'SE' }}
        metrics={metrics}
        warnings={warnings}
        crossCheck={crossCheck}
        actions={{ onRun: run, onStop: () => task.cancel(), onReset: () => applyParams({ ...DEFAULT_UI, seed: DEFAULT_SEED }), running: task.running }}
        exportData={() => {
          if (!result) throw new Error('尚未執行：先按「執行 Run」')
          const cols: Record<string, (number | string)[]> = { seed: result.seeds }
          for (const x of result.rows) cols[`z_${x.key}`] = x.z
          cols.pooled_sorted_z = result.pooled.sorted
          return cols
        }}
        presets={presets}
        onLoadPreset={(p) => applyParams(p.params)}
        controls={
          <>
            <ParamControl
              label={M('seed 個數 $K$')}
              ariaLabel="seed 個數 K"
              value={ui.runs}
              onChange={(runs) => {
                setUi((u) => ({ ...u, runs: Math.round(runs) }))
                setResult(null)
              }}
              min={2}
              max={200}
              step={1}
              integer
              clampOnBlur
              unit="seeds"
              reg="mc_sweep_runs（behavioral）"
              hint={M(`$Z_{\\rm mean}$ 的解析度 $1/\\sqrt K=${fmtNum(1 / Math.sqrt(ui.runs), 2)}$`)}
            />
            <ParamControl
              label="樣本數倍率 scale"
              ariaLabel="校準實驗的樣本數倍率"
              value={ui.scale}
              onChange={(scale) => {
                setUi((u) => ({ ...u, scale }))
                setResult(null)
              }}
              min={MC_SCALE_MIN}
              max={MC_SCALE_MAX}
              log
              unit={String.raw`$\times$`}
              reg="mc_scale（behavioral）"
              hint={M('每個 seed 的樣本數倍率。$z$ 已除以 SE，所以校準原則上與 scale 無關、小 scale 跑得快；例外是用漸近 SE 的 T14（scale $<0.1$ 時 $s_z$ 偏大）')}
            />
            <SelectControl
              label="校準的項目"
              value={ui.subset}
              onChange={(subset) => {
                setUi((u) => ({ ...u, subset }))
                setResult(null)
              }}
              reg="acceptance_subset（behavioral）"
              options={[
                { value: 'fast', label: '快速：T03 T04 T05 T13 T14 T17' },
                { value: 'all', label: '全部（含閉迴路與 T12，較慢）' },
                { value: 'T12', label: '只跑 T12（Sign-LMS block MC）' },
                { value: 'T13', label: '只跑 T13（σ_w²）' },
                { value: 'T14', label: '只跑 T14（ENBW）' },
                { value: 'T17', label: '只跑 T17（stochastic rounding）' },
              ]}
            />
          </>
        }
      >
        {error && (
          <Callout kind="danger" title="校準實驗執行失敗">
            {error}
          </Callout>
        )}
        {!result && !task.running && (
          <p className="muted" data-testid="sweep-idle">
            按上方「執行 Run」開始（{task.mode === 'worker' ? 'Web Worker' : '此環境不支援 Worker，將在主執行緒執行'}）。預設 40 個 seed 約需數秒。
          </p>
        )}
        {task.running && <p className="muted">執行中…（可按「停止」取消）</p>}
        {result && pooled && (
          <>
            {stale && (
              <Callout kind="warn" title="結果已過期">
                參數或 seed 已改變；下面是 seed {result.seed}、<Tex>{`K=${result.runs}`}</Tex>、×{result.scale} 的結果，按「執行 Run」重新計算。
              </Callout>
            )}
            <p>
              <PassMark pass={allOk} label={calRows.length ? `${nCalOk}/${calRows.length} 項校準通過${ksOk ? '，KS 檢定通過' : '，KS 檢定未通過'}` : '沒有校準項目'} />
              <span className="small muted">
                {' '}
                （worker 內總計 {fmtNum(result.totalMs, 4)} ms；{result.runs} 個 seed）
              </span>
            </p>
            <div className="table-wrap">
              <table className="ver-table" data-testid="sweep-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>
                      <Tex>{r`\bar z`}</Tex>
                    </th>
                    <th>
                      <Tex>{'s_z'}</Tex>
                    </th>
                    <th>
                      <Tex>{r`Z_{\rm mean}`}</Tex>
                    </th>
                    <th>
                      <Tex>{r`Z_{\rm sd}`}</Tex>
                    </th>
                    <th>
                      <Tex>{r`\max|z|`}</Tex>
                    </th>
                    <th>通過次數</th>
                    <th>校準</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => {
                    const fin = x.z.filter((v) => Number.isFinite(v))
                    return (
                      <tr key={x.key} data-key={x.key}>
                        <td className="ver-wide">
                          <strong>{x.id}</strong> {M(x.label)}
                          <div className="small muted">
                            {x.key}
                            {x.kind === 'model' ? '｜與線性模型比對（非校準項目）' : x.kind === 'behaviour' ? '｜行為檢查（沒有 z）' : x.expect === 'reject' ? '｜反面：每次都應被拒絕' : x.independent ? '' : '｜非獨立（不計入合併檢定）'}
                          </div>
                        </td>
                        <td className="num">{fmtNum(x.meanZ, 3)}</td>
                        <td className="num">{fmtNum(x.sdZ, 3)}</td>
                        <td className="num">{x.calibrated === null ? '—' : fmtNum(x.meanScore, 3)}</td>
                        <td className="num">{x.calibrated === null ? '—' : fmtNum(x.sdScore, 3)}</td>
                        <td className="num">{fin.length ? fmtNum(Math.max(...fin.map(Math.abs)), 3) : '—'}</td>
                        <td className="num">
                          {x.passCount} / {result.runs}
                        </td>
                        <td>{x.calibrated === null ? <span className="muted">不適用</span> : <PassMark pass={x.calibrated} label={x.calibrated ? '已校準' : '未校準'} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {plots && (
              <div className="ver-plot-grid">
                <Plot
                  title="Q–Q 圖：排序後的 $z$ 對 $\mathcal N(0,1)$ 的理論分位數"
                  data={plots.qq}
                  layout={QQ_LAYOUT}
                  height={320}
                  csvName="acceptance-mc-sweep-qq"
                  ariaLabel="z 分數的 Q–Q 圖"
                  caption="點落在虛線上 = 校準正確。整體往上或往下平移 = 有偏差；斜率大於 1 = SE 被低估（尾巴太肥）。"
                />
                <Plot
                  title="合併 $z$ 的直方圖與 $\varphi(z)$"
                  data={plots.hist}
                  layout={HIST_LAYOUT}
                  height={320}
                  csvName="acceptance-mc-sweep-hist"
                  ariaLabel="z 分數的直方圖與標準常態密度"
                  caption={`$n=${pooled.n}$ 個 $z$（獨立的校準項目 $\\times$ ${result.runs} 個 seed），bin 寬 $0.5$。`}
                />
              </div>
            )}
          </>
        )}
      </ExperimentShell>
      <Callout kind="info" title="你會發現…">
        <ul style={{ margin: 0 }}>
          <li>
            每一項的 <Tex>{r`\bar z`}</Tex> 都在 0 附近、<Tex>{'s_z'}</Tex> 在 1 附近——包含做過偏差修正的 T13、T14。如果<strong>不修正</strong>（§V.3 第 3、4 點），以目前的 scale（每條 chain{' '}
            <Tex>{`n=${uncorrected.n}`}</Tex> 個 block）解析預測 T13 的 <Tex>{`\\bar z\\approx${fmtNum(uncorrected.t13, 2)}`}</Tex>、T14 的{' '}
            <Tex>{`\\bar z\\approx${uncorrected.t14 >= 0 ? '+' : ''}${fmtNum(uncorrected.t14, 2)}`}</Tex>：單次執行看不出來（都在 <Tex>{r`\pm4`}</Tex> 內），多 seed 才抓得到。這正是「多 seeds」的價值。
          </li>
          <li>
            T17 的「平均」與「變異」兩列，<Tex>{r`\bar z`}</Tex> 與 <Tex>{'s_z'}</Tex> 幾乎一模一樣：它們是同一個 <Tex>{r`\hat p`}</Tex> 的兩種寫法（F-VF.9）。
          </li>
          <li>
            反面項目 T05-strict 的 <Tex>{r`\bar z`}</Tex> 遠離 0（負得很多）：它每次都被拒絕；scale 太小時通過次數會掉下來（檢定力不足）。
          </li>
        </ul>
      </Callout>
      <ModeGate min="research">
        <CodeBlock
          source={acceptanceSrc}
          region="sweepScores"
          path="src/simulation/models/acceptance.ts"
          title="core:sweepScores（F-VF.10 與 KS 統計量）"
          caption="acceptance.test.ts 以 $\mathcal N(0,1)$ 的精確分位數樣本驗證：原樣通過；平移 1 或放大 1.5 倍就被抓到。"
        />
      </ModeGate>
      <p className="small muted">
        「匯出」的 CSV 含每個 seed、每一項的 <Tex>{'z'}</Tex>（欄名 z_&lt;key&gt;）與合併後排序的 <Tex>{'z'}</Tex>。
      </p>
    </>
  )
}
