import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  useCases,
  useThemeTokens,
  type CsvColumns,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { useUrlPreset } from '@/app/presets'
import { SAMPLE_BUDGET, kq, meanFieldG, requiredBlocks, runPolarityPerturbation, secantRatio, type BitMapping, type CodeKind, type PolarityPerturbParams, type PolarityPerturbResult } from '../judges'
import { Verdict, rich, tx, usePresetList, withAlpha } from '../shared'

export const POLARITY_EXPERIMENT_ID = 'signoff-polarity-perturb'

export interface PolarityCase {
  code: CodeKind
  magH: number
  phiDeg: number
  omega: number
  D: number
  mapping: BitMapping
}

export interface PolarityShared {
  sigmaV: number
  a: number
  w0: number
  delta: number
  N: number
  M: number
  z: number
  sweepPoints: number
  sweepSpan: number
  sweepBlocks: number
}

/** A：對齊（φ = −120°、Ω = π/6、D = 4 ⇒ θ = 0°，T07）；B：沒有 delay（D = 0 ⇒ θ = −120°，C < 0，T06 類）；C：對齊但 comparator 接反 */
export const CASE_A: PolarityCase = { code: 'tone', magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 4, mapping: 'bipolar' }
export const CASE_B: PolarityCase = { ...CASE_A, D: 0 }
export const CASE_C: PolarityCase = { ...CASE_A, mapping: 'reversed' }

export const SHARED_DEFAULT: PolarityShared = { sigmaV: 100, a: 3, w0: 3, delta: 20, N: 2048, M: 8, z: 3, sweepPoints: 7, sweepSpan: 300, sweepBlocks: 2 }

const LOCAL_PRESETS: ExperimentPreset[] = [
  {
    name: 'A/B/C：對齊 vs 未對齊 vs comparator 接反（T06／T07）',
    description: 'A：θ = φ + ΩD = 0°（C = 1）；B：D = 0 ⇒ θ = −120°（C = −0.5）；C：位元映射 q = 1 − 2b',
    params: { shared: SHARED_DEFAULT, cases: [CASE_A, CASE_B, CASE_C] },
  },
  {
    name: '邊界：θ = 85° 與 95°（C ≈ ±0.087）——量測太短就判不出來',
    description: 'M = 2：兩組都可能「無法判定」；把 M 調到 metrics 建議的 block 數後再看',
    params: { shared: { ...SHARED_DEFAULT, M: 2, N: 1024 }, cases: [{ ...CASE_A, phiDeg: 85, D: 0 }, { ...CASE_A, phiDeg: 95, D: 0 }] },
  },
  {
    name: '±1 code、identity path：Δ 太大的截斷偏差',
    description: 'Δ = σ_v 時中央差分低估斜率（erf 三次項）',
    params: { shared: { ...SHARED_DEFAULT, delta: 100, sweepSpan: 400 }, cases: [{ code: 'bpsk', magH: 1, phiDeg: 0, omega: Math.PI / 6, D: 0, mapping: 'bipolar' }, { code: 'bpsk', magH: 1, phiDeg: 0, omega: Math.PI / 6, D: 0, mapping: 'unipolar' }] },
  },
]

/** Plot 的 layout 放在模組層：每次 render 都新建物件會讓 Plotly.react 重畫（infra-api：data／layout 要 memoize）。 */
const S_CURVE_LAYOUT = { xaxis: { title: { text: 'w [fs/unit code]' } }, yaxis: { title: { text: 'Ḡ(w)（無因次）' } } }
const K_PLOT_LAYOUT = { yaxis: { title: { text: 'K [fs⁻¹]' }, zeroline: true }, xaxis: { type: 'category' as const } }

function isCaseList(v: unknown): v is PolarityCase[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every((c) => typeof c === 'object' && c !== null && 'code' in c && 'mapping' in c)
}

const VERDICT_TEXT: Record<PolarityPerturbResult['verdict'], { kind: 'ok' | 'bad' | 'warn'; text: string }> = {
  pass: { kind: 'ok', text: String.raw`極性正確（$\hat K$ 顯著 $>0$）` },
  reversed: { kind: 'bad', text: String.raw`極性錯誤（$\hat K$ 顯著 $<0$）` },
  inconclusive: { kind: 'warn', text: String.raw`無法判定（$|\hat K|<z\,\mathrm{se}$）` },
}

export function PolarityPerturbExperiment() {
  const tokens = useThemeTokens()
  const cases = useCases<PolarityCase>(CASE_A, { seed: 20261010 })
  const [shared, setShared] = useState<PolarityShared>(SHARED_DEFAULT)
  /** 上一次已經套用過的「網址 preset」（undefined = 還沒做過掛載時的初始化）。ref 在 StrictMode 的重複 effect 之間會保留。 */
  const appliedUrlPreset = useRef<object | null | undefined>(undefined)
  const presets = usePresetList(POLARITY_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(POLARITY_EXPERIMENT_ID)

  /**
   * 把比較組設成 list（1–3 組）。
   * 注意順序：useCases.addCase() 是以「目前 state 的快照」整份寫回，同一個 tick 內排在它前面的 update() 會被蓋掉；
   * 所以必須先把 case 數補足，再套用各組參數，最後才移除多餘的 case。
   */
  const applyCases = (list: PolarityCase[]) => {
    const ids = cases.cases.map((c) => c.id)
    while (ids.length < list.length) {
      const n = cases.addCase()
      if (!n) break
      ids.push(n)
    }
    ids.sort()
    list.forEach((p, i) => {
      if (ids[i]) cases.update(p, ids[i])
    })
    ids.slice(list.length).forEach((id) => cases.removeCase(id))
    cases.setActive('A')
  }
  const applyPreset = (params: Record<string, unknown>) => {
    if (params.shared && typeof params.shared === 'object') setShared({ ...SHARED_DEFAULT, ...(params.shared as Partial<PolarityShared>) })
    if (isCaseList(params.cases)) applyCases(params.cases)
  }

  // 第一次掛載：建立 A／B／C 三組對照（同 seed 的 paired comparison）；網址帶 ?preset= 時改套用該 preset。
  // 兩件事放在同一個 effect：applyCases 讀的是這次 render 的 case 清單，同一個 tick 內不能呼叫兩次——
  // 因此用 ref 記住「這個 urlPreset 已經處理過」：React StrictMode（開發模式）會把掛載 effect 連跑兩次，第二次必須略過。
  useEffect(() => {
    const first = appliedUrlPreset.current === undefined
    if (!first && appliedUrlPreset.current === (urlPreset ?? null)) return
    appliedUrlPreset.current = urlPreset ?? null
    const fromUrl = urlPreset && isCaseList(urlPreset.params.cases) ? urlPreset.params.cases : null
    if (urlPreset?.params.shared && typeof urlPreset.params.shared === 'object') setShared({ ...SHARED_DEFAULT, ...(urlPreset.params.shared as Partial<PolarityShared>) })
    if (fromUrl) applyCases(fromUrl)
    else if (first) applyCases([CASE_A, CASE_B, CASE_C])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載與網址 preset 改變時執行
  }, [urlPreset])

  // useDeferredValue 的輸入必須是「內容不變就同一個物件」：每次 render 都新建物件會讓每一次重繪都排一次背景重算
  const simInput = useMemo(() => ({ shared, list: cases.cases, seed: cases.seed }), [shared, cases.cases, cases.seed])
  const deferred = useDeferredValue(simInput)
  const results = useMemo(
    () =>
      deferred.list.map((c) => {
        try {
          // 所有比較組合計 ≤ SAMPLE_BUDGET（主執行緒）：每組平分
          const p: PolarityPerturbParams = { ...deferred.shared, ...c.params, seed: deferred.seed, budget: Math.floor(SAMPLE_BUDGET / deferred.list.length) }
          return { id: c.id, seriesIndex: c.seriesIndex, params: c.params, res: runPolarityPerturbation(p), error: null as string | null }
        } catch (e) {
          return { id: c.id, seriesIndex: c.seriesIndex, params: c.params, res: null, error: (e as Error).message }
        }
      }),
    [deferred],
  )
  const active = results.find((r) => r.id === cases.activeId) ?? results[0]
  const res = active?.res ?? null
  const ap = cases.active.params
  const setCase = <K extends keyof PolarityCase>(k: K, v: PolarityCase[K]) => cases.update({ [k]: v } as Partial<PolarityCase>)
  const setS = <K extends keyof PolarityShared>(k: K, v: PolarityShared[K]) => setShared((s) => ({ ...s, [k]: v }))

  const warnings: string[] = []
  for (const r of results) {
    if (r.error) warnings.push(`Case ${r.id}：${r.error}`)
    else if (r.res) for (const w of r.res.warnings) warnings.push(`Case ${r.id}：${w}`)
  }

  const sCurve: Data[] = useMemo(() => {
    const out: Data[] = []
    for (const r of results) {
      if (!r.res) continue
      const color = tokens.series[r.seriesIndex]
      out.push({
        x: r.res.meanFieldCurve.w,
        y: r.res.meanFieldCurve.g,
        mode: 'lines',
        name: `Case ${r.id} mean-field（精確）`,
        line: { color, dash: 'dot', width: 1.5 },
      })
      if (r.res.sweep.w.length > 0) {
        out.push({
          x: r.res.sweep.w,
          y: r.res.sweep.gMean,
          mode: 'markers',
          name: `Case ${r.id} MC（±2se）`,
          marker: { color, size: 7 },
          error_y: { type: 'data', array: r.res.sweep.gSe.map((s) => (Number.isFinite(s) ? 2 * s : 0)), visible: true, color: withAlpha(color, 0.6) },
        })
      }
      const w0 = deferred.shared.w0
      const dl = deferred.shared.delta
      out.push({
        x: [w0 - dl, w0 + dl],
        y: [r.res.est.gMinusMean, r.res.est.gPlusMean],
        mode: 'lines+markers',
        name: `Case ${r.id} ±Δ 量測`,
        marker: { color, symbol: 'diamond', size: 10 },
        line: { color, width: 2.5 },
      })
    }
    return out
  }, [results, tokens, deferred.shared.w0, deferred.shared.delta])

  const kPlot: Data[] = useMemo(() => {
    const ok = results.filter((r) => r.res)
    return [
      {
        x: ok.map((r) => `Case ${r.id}`),
        y: ok.map((r) => (r.res as PolarityPerturbResult).est.K),
        error_y: { type: 'data', array: ok.map((r) => deferred.shared.z * (r.res as PolarityPerturbResult).est.se), visible: true },
        mode: 'markers',
        name: `K̂（±z·se，z = ${deferred.shared.z}）`,
        marker: { size: 12, color: ok.map((r) => tokens.series[r.seriesIndex]) },
      },
      {
        x: ok.map((r) => `Case ${r.id}`),
        y: ok.map((r) => (r.res as PolarityPerturbResult).KmeanField),
        mode: 'markers',
        name: 'mean-field 中央差分（精確）',
        marker: { size: 11, symbol: 'diamond-open', color: tokens.text },
      },
      {
        x: ok.map((r) => `Case ${r.id}`),
        y: ok.map((r) => (r.res as PolarityPerturbResult).Klin),
        mode: 'markers',
        name: '小訊號 K_qC',
        marker: { size: 12, symbol: 'x-thin', line: { width: 2, color: tokens.textMuted }, color: tokens.textMuted },
      },
    ]
  }, [results, tokens, deferred.shared.z])

  const metrics: MetricRow[] = res
    ? [
        { name: `Case ${active.id}：有效相關 $C_D$`, value: res.C, formulaId: 'F-SO.4', claim: 'exact', note: ap.code === 'tone' ? String.raw`$C_D=|H|\cos(\phi+\Omega D)$（$A=\sqrt2$ 單頻）` : String.raw`$C_D=\sum_kh[k]R_{xx}[k-D]=h[D]$（iid $\pm1$）` },
        { name: String.raw`小訊號 $K=K_q\,C_D\times$（映射係數）`, value: res.Klin, unit: 'fs⁻¹', formulaId: 'F-SO.4', claim: 'approx' },
        { name: 'mean-field 中央差分 $K$（含 erf 截斷）', value: res.KmeanField, unit: 'fs⁻¹', claim: 'exact' },
        {
          name: String.raw`量測 $\hat K=-\hat S$`,
          value: res.est.K,
          unit: 'fs⁻¹',
          analytic: res.KmeanField,
          tolerance: 4 * res.est.se,
          formulaId: 'F-SO.1',
          claim: 'approx',
          note: `容許 $\\pm4\\,\\mathrm{se}$（$\\mathrm{se}=${tx(res.est.se, 3)}$）`,
        },
        { name: String.raw`$z=\hat K/\mathrm{se}$`, value: res.est.z, formulaId: 'F-SO.3' },
        { name: `判定所需每側 block 數（$z=${shared.z}$）`, value: requiredBlocks(res.Klin, shared.delta, shared.N, shared.z), formulaId: 'F-SO.3', note: String.raw`以 $\sigma_\eta^2\approx1/N$、小訊號 $K$ 估計` },
        ...(ap.code === 'bpsk' && ap.D === 0 && Math.abs(ap.phiDeg) < 1e-9
          ? [{ name: String.raw`identity path 截斷比 $\hat S_\text{CD}/\bar G'(a)$`, value: secantRatio(shared.delta, shared.sigmaV), formulaId: 'F-SO.2', claim: 'exact' as const }]
          : []),
        { name: '本 case 使用的 sample 數', value: res.samplesUsed, digits: 8 },
      ]
    : []

  const mcOk = results.every((r) => !r.res || Math.abs(r.res.est.K - r.res.KmeanField) <= 4 * r.res.est.se)
  // Analytic 交叉比對（真的算，不是寫死 ok）：小訊號 K = K_q·C_D·(映射係數) 必須等於精確 mean-field 在 w = a 的導數
  // （用極小的 ε = 10⁻³σ_v 做中央差分，截斷誤差約 2×10⁻⁷）。兩條路徑獨立：一條是 corrSingleTone／h[D]，另一條是 erf 的列舉／積分。
  const analyticOk = useMemo(
    () =>
      results.every((r) => {
        if (!r.res) return true
        const p = { ...deferred.shared, ...r.params }
        const eps = 1e-3 * p.sigmaV
        const kMf = -(meanFieldG(p, p.a + eps) - meanFieldG(p, p.a - eps)) / (2 * eps)
        return Math.abs(kMf - r.res.Klin) <= 1e-5 * kq(p.sigmaV) * Math.max(p.magH, 1e-12)
      }),
    [results, deferred.shared],
  )

  return (
    <ExperimentShell
      id={POLARITY_EXPERIMENT_ID}
      title={String.raw`Polarity Perturbation Check：freeze + $\pm\Delta w$ 量 $S_\mathrm{GMAC}$`}
      level="L2"
      claim="approx"
      source="simulation"
      tests={['T06', 'T07']}
      description={
        <>
          凍結 <Tex>{'w'}</Tex>，在 <Tex>{'w_0\\pm\\Delta'}</Tex> 交錯量 <Tex>{'M'}</Tex> 個 GMAC block，以中央差分得到 <Tex>{'\\hat K=-\\hat S'}</Tex>，再做三分法判決。
          Case A／B／C 共用 seed（paired）：差異只來自參數。曲線同時畫出精確 mean-field（虛線）與 Monte Carlo（點 <Tex>{'\\pm2\\,\\mathrm{se}'}</Tex>）。
        </>
      }
      assumptions={[
        String.raw`$\delta=a-w$；$e[n]=(a-w)\,(h*x)[n]+v[n]$，$v\sim\mathcal N(0,\sigma_v^2)$ iid、與 code 獨立`,
        String.raw`誤差路徑為 2-tap FIR，精確實現 $H(e^{j\Omega})=|H|e^{j\phi}$；狀態跨 block 連續（不重置）`,
        String.raw`單頻 code $x[n]=\sqrt2\cos(\Omega n+\theta_0)$（unit RMS，$\theta_0$ 由 seed 決定）；$\pm1$ code 為 iid`,
        String.raw`comparator：$e\ge0\Rightarrow b=1$；$q$ 由位元映射決定（正確為 $q=2b-1$）`,
        String.raw`GMAC 為 average 模式 $G=\frac1N\sum_nq[n]\,x[n-D]$；$w$ 在量測期間凍結，不更新`,
        String.raw`$+\Delta$／$-\Delta$ 交錯量測；兩側 block 獨立 ⇒ $\mathrm{se}$ 由兩側變異數相加`,
      ]}
      params={{ ...shared, activeCase: cases.activeId, ...ap }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ sigmaV: 'fs', a: 'fs/unit code', w0: 'fs/unit code', delta: 'fs', phiDeg: 'deg', omega: 'rad/sample', D: 'samples', sweepSpan: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analyticOk ? 'ok' : 'mismatch', note: analyticOk ? String.raw`小訊號 $K_qC_D$ 與精確 mean-field 在 $w=a$ 的斜率相符（相對 $10^{-5}$）` : String.raw`小訊號 $K_qC_D$ 與精確 mean-field 在 $w=a$ 的斜率不符` },
        monteCarlo: { status: mcOk ? 'ok' : 'mismatch', note: mcOk ? String.raw`所有 case 的 $\hat K$ 與 mean-field 相差 $\le4\,\mathrm{se}$` : String.raw`至少一個 case 的 $\hat K$ 與 mean-field 相差 $>4\,\mathrm{se}$` },
        fixedPoint: { status: 'not-implemented', note: '未建模 GMAC 定點位寬；見本頁 Fixed-point 判斷器' },
      }}
      actions={{
        onReset: () => {
          setShared(SHARED_DEFAULT)
          applyCases([CASE_A, CASE_B, CASE_C])
        },
      }}
      exportData={(): CsvColumns => {
        if (!res) return {}
        return {
          sweep_w_fs: res.sweep.w,
          sweep_G_mean: res.sweep.gMean,
          sweep_G_se: res.sweep.gSe,
          meanfield_w_fs: res.meanFieldCurve.w,
          meanfield_G: res.meanFieldCurve.g,
          G_plus_blocks: res.gPlus,
          G_minus_blocks: res.gMinus,
        }
      }}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <>
          <CaseSelector cases={cases} label="比較組（目前編輯）" />
          <SelectControl
            label={`Case ${cases.activeId}：code`}
            value={ap.code}
            onChange={(v) => setCase('code', v)}
            options={[
              { value: 'tone', label: '單頻 √2cos(Ωn + θ₀)' },
              { value: 'bpsk', label: 'iid ±1（隨機化 code）' },
            ]}
            reg="behav: code_pattern"
          />
          <ParamControl label={rich(String.raw`$|H|$（誤差路徑在 $\Omega$ 的增益）`)} ariaLabel="|H|（誤差路徑在 Ω 的增益）" value={ap.magH} onChange={(v) => setCase('magH', v)} min={0} max={3} step={0.01} reg="behav: pll_error_path.magnitude" />
          <ParamControl label={rich(String.raw`$\phi$（誤差路徑相位）`)} ariaLabel="φ（誤差路徑相位）" value={ap.phiDeg} onChange={(v) => setCase('phiDeg', v)} min={-180} max={180} step={1} unit="deg" reg="behav: pll_error_path.phase_deg" />
          <ParamControl label={rich(String.raw`$\Omega$（code 頻率）`)} ariaLabel="Ω（code 頻率）" value={ap.omega} onChange={(v) => setCase('omega', v)} min={0.01} max={3.13} step={0.001} unit="rad/sample" hint={rich(String.raw`$0<\Omega<\pi$（端點見 E46）`)} reg="behav: pll_error_path.omega" />
          <ParamControl label={rich('$D$（GMAC code delay）')} ariaLabel="D（GMAC code delay）" value={ap.D} onChange={(v) => setCase('D', v)} min={0} max={48} integer clampOnBlur unit="samples" reg="REG_GMAC_CODE_DELAY[5:0]" />
          <SelectControl
            label={rich(String.raw`位元映射 $b\to q$`)}
            ariaLabel="位元映射 b → q"
            value={ap.mapping}
            onChange={(v) => setCase('mapping', v)}
            options={[
              { value: 'bipolar', label: '正確 q = 2b − 1' },
              { value: 'reversed', label: '接反 q = 1 − 2b' },
              { value: 'unipolar', label: '未映射 q = b' },
            ]}
            reg="REG_CMP_POLARITY / RTL bit mapping"
          />
          <hr />
          <ParamControl label={rich(String.raw`$\sigma_v$（comparator 前雜訊）`)} ariaLabel="σ_v（comparator 前雜訊）" value={shared.sigmaV} onChange={(v) => setS('sigmaV', v)} min={1} max={1000} log unit="fs" reg="behav: comparator.sigma_v_fs" />
          <ParamControl label={rich('$a$（真實係數）')} ariaLabel="a（真實係數）" value={shared.a} onChange={(v) => setS('a', v)} min={-500} max={500} step={0.1} unit="fs" reg="behav: a_true" />
          <ParamControl label={rich('$w_0$（凍結的工作點）')} ariaLabel="w₀（凍結的工作點）" value={shared.w0} onChange={(v) => setS('w0', v)} min={-500} max={500} step={0.1} unit="fs" reg="REG_CAL_GAIN（freeze 時讀值）" />
          <ParamControl label={rich(String.raw`$\Delta$（擾動）`)} ariaLabel="Δ（擾動）" value={shared.delta} onChange={(v) => setS('delta', v)} min={0.1} max={500} log unit="fs" hint={rich(String.raw`建議 $\Delta\le0.3\sigma_v$`)} reg="REG_CAL_PERTURB_DELTA" />
          <ParamControl label={rich('$N$（每 block 樣本數）')} ariaLabel="N（每 block 樣本數）" value={shared.N} onChange={(v) => setS('N', v)} min={64} max={8192} integer clampOnBlur reg="REG_GMAC_N[15:0]" />
          <ParamControl label={rich('$M$（每側 block 數）')} ariaLabel="M（每側 block 數）" value={shared.M} onChange={(v) => setS('M', v)} min={2} max={64} integer clampOnBlur reg="behav: perturb_blocks" />
          <ParamControl label={rich('$z$（判決信心倍數）')} ariaLabel="z（判決信心倍數）" value={shared.z} onChange={(v) => setS('z', v)} min={1} max={6} step={0.1} reg="behav: decision_z" />
          <ParamControl label={rich(String.raw`$\bar G(w)$ 曲線掃描點數`)} ariaLabel="S 曲線掃描點數" value={shared.sweepPoints} onChange={(v) => setS('sweepPoints', v)} min={0} max={21} integer clampOnBlur reg="behav: sweep_points" />
          <ParamControl label={rich('掃描半寬（以 $a$ 為中心）')} ariaLabel="掃描半寬（以 a 為中心）" value={shared.sweepSpan} onChange={(v) => setS('sweepSpan', v)} min={1} max={2000} log unit="fs" reg="behav: sweep_span" />
          <ParamControl label="每點 block 數" value={shared.sweepBlocks} onChange={(v) => setS('sweepBlocks', v)} min={1} max={8} integer clampOnBlur reg="behav: sweep_blocks" />
        </>
      }
    >
      <div className="so-kv">
        {results.map((r) => (
          <div key={r.id}>
            <div className="k">
              Case {r.id}：<Tex>{`K_q=${tx(kq(shared.sigmaV), 4)}\\,\\mathrm{fs}^{-1},\\ C_D=${r.res ? tx(r.res.C, 4) : '\\text{—}'}`}</Tex>
            </div>
            <div className="v">
              {r.res ? (
                <>
                  <Tex>{`\\hat K=${tx(r.res.est.K, 4)}\\pm${tx(shared.z * r.res.est.se, 2)}\\,\\mathrm{fs}^{-1}`}</Tex> <Verdict kind={VERDICT_TEXT[r.res.verdict].kind}>{rich(VERDICT_TEXT[r.res.verdict].text)}</Verdict>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        ))}
      </div>
      <Plot
        title={String.raw`凍結 $w$ 的 GMAC 平均 $\bar G(w)$：S 曲線（虛線：精確 mean-field；點：Monte Carlo）`}
        data={sCurve}
        layout={S_CURVE_LAYOUT}
        height={340}
        csvName="signoff-polarity-scurve"
      />
      <Plot
        title={String.raw`$\hat K=-\hat S$ 與 $z\,\mathrm{se}$，對照精確 mean-field 與小訊號 $K_qC_D$`}
        data={kPlot}
        layout={K_PLOT_LAYOUT}
        height={280}
        csvName="signoff-polarity-k"
      />
    </ExperimentShell>
  )
}
