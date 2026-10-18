import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ExperimentShell,
  mathText,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  texNum,
  useDebouncedValue,
  useThemeTokens,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import type { FcwSweepParams, FcwSweepResult, LoopType } from '@/simulation/models/polarity'
import { modelTextTex } from './explorerModel'
import { f } from '../shared'

export const FCW_SWEEP_EXPERIMENT_ID = 'polarity-fcw-sweep'

const DEFAULTS: FcwSweepParams = {
  loopType: 'typeII',
  zeta: 0.7,
  bwRatio: 0.01,
  loopDelay: 0,
  delay: 0,
  fracMin: 3e-4,
  fracMax: 0.45,
  points: 32,
}

function pick(v: Record<string, unknown>): Partial<FcwSweepParams> {
  const out: Partial<FcwSweepParams> = {}
  if (v.loopType === 'typeI' || v.loopType === 'typeII') out.loopType = v.loopType
  for (const k of ['zeta', 'bwRatio', 'loopDelay', 'delay', 'fracMin', 'fracMax', 'points'] as const) {
    const x = v[k]
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  }
  return out
}

/** 近整數放大圖裡「漸近線」那條線的圖例名稱（`$...$` 是 LaTeX，Plot 會轉成斜體符號與上下標；f = frac） */
export function fcwZoomAsymptoteName(delay: number, typeII: boolean): string {
  if (delay > 0) return '|動差展開|（F-06.18）'
  return typeII ? String.raw`動差展開 $= \frac{3}{\pi^2}\Delta^2$` : String.raw`動差展開 $m_0 - 6f\,m_1 + 6f^2m_2$`
}

function minOf(a: ArrayLike<number>): number {
  let m = Infinity
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) m = Math.min(m, a[i])
  return m
}

/** 近整數 FCW 掃描：一階 DSM residue（鋸齒）、MASH、三角波、正弦的 C/σ² vs frac（worker 計算）。 */
export function FcwSweepExperiment() {
  const [params, setParams] = useState<FcwSweepParams>(DEFAULTS)
  const urlPreset = useUrlPreset(FCW_SWEEP_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setParams((p) => ({ ...p, ...pick(urlPreset.params) }))
  }, [urlPreset])
  const presets = useMemo(
    () => presetsForExperiment(FCW_SWEEP_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )
  const q = useDebouncedValue(params, 300)
  const task = useWorkerTask<FcwSweepParams, FcwSweepResult>('polarity', 'sweepFcwPolarity', { restartOnRun: true })
  const [res, setRes] = useState<FcwSweepResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run } = task
  useEffect(() => {
    let alive = true
    run(q)
      .then((r) => {
        if (alive) {
          setRes(r)
          setErr(null)
        }
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [q, run])

  const tokens = useThemeTokens()
  // 圖與指標一律用「結果本身」記錄的設定（res.design、res.delay），不用還在編輯中的 params
  const isTypeII = res ? res.design.type === 'typeII' : params.loopType === 'typeII'
  const D = res?.delay ?? 0
  const plots = useMemo(() => {
    if (!res) return null
    const x = Array.from(res.frac)
    const main: Data[] = [
      { x, y: Array.from(res.dsm1), name: '一階 DSM residue（模擬）', mode: 'lines+markers', line: { color: tokens.series[0] } },
      { x, y: Array.from(res.sawTheory), name: '鋸齒：精確自相關和（F-06.17）', mode: 'lines', line: { color: tokens.series[0], dash: 'dash' } },
      { x, y: Array.from(res.mash), name: 'MASH 1-1-1 residue（模擬）', mode: 'lines+markers', line: { color: tokens.series[2] } },
      { x, y: Array.from(res.triangle), name: '三角波（平滑慢變 code，模擬）', mode: 'lines+markers', line: { color: tokens.series[1] } },
      { x, y: Array.from(res.triTheory), name: '三角波譜線和', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x, y: Array.from(res.sine), name: String.raw`正弦：$\operatorname{Re}\big(H(e^{j\Omega_0})\,e^{j\Omega_0D}\big)$`, mode: 'lines', line: { color: tokens.series[4], dash: 'dot' } },
    ]
    // log–log 放大圖：畫絕對值（D ≥ 1 時鋸齒的 C_D 會變號，|C_D| 在變號點有一個凹口）
    const zoomX: number[] = []
    const zoomSaw: number[] = []
    const zoomAsym: number[] = []
    const zoomTri: number[] = []
    const zoomTriAsym: number[] = []
    for (let i = 0; i < res.ratio.length; i++) {
      if (!Number.isFinite(res.sawAsymptote[i])) continue
      zoomX.push(res.ratio[i])
      zoomSaw.push(Math.abs(res.dsm1[i]))
      zoomAsym.push(Math.abs(res.sawAsymptote[i]))
      zoomTri.push(Math.abs(res.triangle[i]))
      zoomTriAsym.push(Math.abs(res.triAsymptote[i]))
    }
    const typeII = res.design.type === 'typeII'
    const zoom: Data[] = [
      { x: zoomX, y: zoomSaw, name: String.raw`DSM residue $|C_D|/\sigma_x^2$`, mode: 'markers', marker: { color: tokens.series[0] } },
      {
        x: zoomX,
        y: zoomAsym,
        name: fcwZoomAsymptoteName(res.delay, typeII),
        mode: 'lines',
        line: { color: tokens.series[0], dash: 'dash' },
      },
      { x: zoomX, y: zoomTri, name: String.raw`三角波 $|C_D|/\sigma_x^2$`, mode: 'markers', marker: { color: tokens.series[1], symbol: 'diamond' } },
      { x: zoomX, y: zoomTriAsym, name: String.raw`$|m_0 - 24f^2\sum h(k-D)^2|$`, mode: 'lines', line: { color: tokens.series[1], dash: 'dot' } },
    ]
    // basin：mean-field 變號點 δ_c/σ_v（只有部分 frac 有）
    const bx: number[] = []
    const by: number[] = []
    for (let i = 0; i < res.frac.length; i++) {
      if (Number.isFinite(res.basin[i]) && res.dsm1[i] > 0) {
        bx.push(res.frac[i])
        by.push(res.basin[i])
      }
    }
    const basin: Data[] = [{ x: bx, y: by, name: String.raw`一階 DSM：$\delta_c/\sigma_v$（$C_D > 0$ 的點）`, mode: 'lines+markers', line: { color: tokens.series[3] } }]
    return { main, zoom, basin, hasBasin: bx.length > 0 }
  }, [res, tokens])

  const warnings: string[] = []
  if (err) warnings.push(`計算失敗：${modelTextTex(err)}`)
  if (res) {
    warnings.push(...res.warnings.map(modelTextTex)) // 模型的純文字警告 → `$...$`
    const md = minOf(res.dsm1)
    const mt = minOf(res.triangle)
    if (md < 0) {
      warnings.push(
        String.raw`$C\le0$：一階 DSM residue 在部分 FCW 下 $C_D/\sigma_x^2$ 最低為 $${texNum(md, 3)}$，raw-$x$ LMS 在這些 FCW 的平均更新方向錯誤。` +
          (res.delay > 0
            ? String.raw`原因：GMAC regressor 落後 $D=${res.delay}$ 個 sample——鋸齒自相關的一次項不再被 Type-II 消掉（F-06.18；近整數端的變號門檻 $\mathrm{frac}^*\approx${texNum(res.fracFlip, 3)}$），高 frac 端則是 $x[n-D]$ 與 $x[n]$ 本身反相關。`
            : ''),
      )
    }
    const mm = minOf(res.mash)
    if (mm < 0) {
      warnings.push(
        String.raw`$C\le0$：MASH 1-1-1 residue 的 $C_D/\sigma_x^2$ 最低為 $${texNum(mm, 3)}$。它的能量被推到高頻，相鄰 sample 強烈反相關（$R_x[1]<0$），所以 regressor 只要錯開 $D=${res.delay}$ 個 sample 就可能變號——與 PLL 的相位無關，是 code 對齊問題。`,
      )
    }
    const nb = Array.from(res.basin).filter((v, i) => Number.isFinite(v) && res.dsm1[i] > 0)
    if (nb.length > 0) {
      warnings.push(
        String.raw`近整數端有 ${nb.length} 個掃描點「$C_D>0$ 但只有局部穩定」：mean-field 特性在 $|\delta|>\delta_c$ 變號，最小 $\delta_c\approx${texNum(Math.min(...nb), 3)}\,\sigma_v$（第三張圖）。起始誤差或穩態雜訊超過它，1-bit LMS 就會離開 basin。`,
      )
    }
    if (mt < 0) {
      warnings.push(
        String.raw`$C\le0$：平滑慢變 code（三角波）在近整數時 $C/\sigma_x^2$ 最低為 $${texNum(mt, 3)}$——它的能量集中在 $\omega<\omega_L$、$\operatorname{Re}\{H\}<0$ 的頻帶，正 $\mu$ 會使平均誤差發散。`,
      )
    }
  }

  const metrics: MetricRow[] = res
    ? [
        {
          name: String.raw`鋸齒一階係數 $\int_0^\infty\operatorname{Re}\{H_{\mathrm{CT}}(j\nu)\}\,\nu^{-2}\,d\nu$`,
          value: res.firstOrderIntegral,
          analytic: isTypeII ? 0 : Math.PI / 2,
          tolerance: 1e-5,
          claim: 'exact',
          note: String.raw`Type-II 恰為 0（$\nu\to1/\nu$ 反對稱）、Type-I 為 $\pi/2$：鋸齒 residue 的一階係數`,
        },
        { name: String.raw`$\mathrm{frac}_L=\omega_LT_s/(2\pi)$`, value: res.fracL, note: String.raw`基頻 $\Omega_0$ 等於迴路頻率時的 FCW 小數` },
        { name: String.raw`零階動差 $m_0=\sum_kh[k]$`, value: res.moments[0], analytic: 0, tolerance: 1e-9, claim: 'exact', note: String.raw`$H(e^{j0})=0$：PLL 追掉 DC` },
        {
          name: String.raw`一階動差 $m_1=\sum_kk\,h[k]$`,
          value: res.moments[1],
          analytic: isTypeII ? 0 : -1 / res.design.wLTs,
          tolerance: 1e-6 * Math.max(1, 1 / res.design.wLTs),
          claim: 'exact',
          note: isTypeII ? 'Type-II 對斜坡零穩態誤差，所以鋸齒的一階項消失（$D=0$）' : String.raw`Type-I：$m_1=-1/K\Rightarrow C/\sigma_x^2\approx6\,\mathrm{frac}/K$（一階）`,
        },
        {
          name: String.raw`二階動差 $m_2=\sum_kk^2h[k]$`,
          value: res.moments[2],
          analytic: isTypeII ? 2 / res.design.Ki : undefined,
          tolerance: isTypeII ? 1e-6 * (2 / res.design.Ki) : undefined,
          toleranceMode: 'abs',
          claim: 'exact',
          formulaId: 'F-06.14',
          note: isTypeII ? String.raw`$=2/K_i\Rightarrow C/\sigma_x^2\approx12\,\mathrm{frac}^2/K_i=\tfrac{3}{\pi^2}\Delta^2$（$D=0$）` : '二階係數（含 latency）',
        },
        ...(Number.isFinite(res.fracFlip)
          ? [
              {
                name: String.raw`近整數變號門檻 $\mathrm{frac}^*=K_i\sum_{k<D}h[k](D-k)$`,
                value: res.fracFlip,
                formulaId: 'F-06.18',
                claim: 'approx' as const,
                note: String.raw`$D=${D}$：$\mathrm{frac}<\mathrm{frac}^*$ 時一階 DSM 的 $C_D<0$（$1\le D\le d+1$ 時 $\mathrm{frac}^*=K_iD=${texNum(res.design.Ki * D, 3)}$）`,
              },
            ]
          : []),
        { name: String.raw`$\min C/\sigma_x^2$（一階 DSM）`, value: minOf(res.dsm1), claim: 'approx' },
        { name: String.raw`$\min C/\sigma_x^2$（MASH 1-1-1）`, value: minOf(res.mash), claim: 'approx' },
        { name: String.raw`$\min C/\sigma_x^2$（三角波）`, value: minOf(res.triangle), claim: 'approx' },
        {
          name: String.raw`DSM vs 精確鋸齒理論（最小 $\mathrm{frac}$）`,
          value: res.dsm1[0],
          analytic: res.sawTheory[0],
          tolerance: 0.1 * Math.abs(res.sawTheory[0]) + 3e-3,
          formulaId: 'F-06.17',
          claim: 'approx',
          note: '差異來自有限分析長度',
        },
        {
          name: String.raw`$\min\delta_c/\sigma_v$（一階 DSM、$C_D>0$ 的點）`,
          value: (() => {
            const v = Array.from(res.basin).filter((b, i) => Number.isFinite(b) && res.dsm1[i] > 0)
            return v.length > 0 ? Math.min(...v) : null
          })(),
          formulaId: 'F-06.19',
          claim: 'approx',
          note: 'mean-field 特性的變號點（basin 半徑）；— 表示掃描範圍內沒有 $C_D>0$ 卻變號的點',
        },
      ]
    : []

  const analyticCheck = useMemo(() => {
    if (!res) return { status: 'n/a' as const, note: '計算中' }
    // 每個掃描點：20-bit DSM 時域平均 vs 精確鋸齒自相關和（容許有限長度誤差 10% + 3e−3）
    let worst = 0
    let worstI = 0
    for (let i = 0; i < res.frac.length; i++) {
      const excess = Math.abs(res.dsm1[i] - res.sawTheory[i]) - (0.1 * Math.abs(res.sawTheory[i]) + 3e-3)
      if (i === 0 || excess > worst) {
        worst = excess
        worstI = i
      }
    }
    const note = String.raw`${res.frac.length} 點中最差：$\mathrm{frac}=${texNum(res.frac[worstI], 3)}$，模擬 ${f(res.dsm1[worstI], 4)} vs 理論 ${f(res.sawTheory[worstI], 4)}`
    return worst <= 0 ? { status: 'ok' as const, note } : { status: 'mismatch' as const, note }
  }, [res])

  const layouts = useMemo(() => {
    const zeroLine = { type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }
    const fracLine = res
      ? [
          { type: 'line' as const, yref: 'paper' as const, y0: 0, y1: 1, x0: res.fracL, x1: res.fracL, line: { color: tokens.danger, dash: 'dot' as const } },
          ...(Number.isFinite(res.fracFlip)
            ? [{ type: 'line' as const, yref: 'paper' as const, y0: 0, y1: 1, x0: res.fracFlip, x1: res.fracFlip, line: { color: tokens.series[0], dash: 'dashdot' as const, width: 1 } }]
            : []),
        ]
      : []
    const main: Partial<Layout> = { xaxis: { title: { text: String.raw`$\mathrm{frac}$` } }, yaxis: { title: { text: String.raw`$C_D/\sigma_x^2$` } }, shapes: [zeroLine, ...fracLine] }
    const zoom: Partial<Layout> = { xaxis: { title: { text: String.raw`$\Delta = \Omega_0/(\omega_L T_s)$` } }, yaxis: { title: { text: String.raw`$|C_D|/\sigma_x^2$` } } }
    const basin: Partial<Layout> = { xaxis: { title: { text: String.raw`$\mathrm{frac}$` } }, yaxis: { title: { text: String.raw`$\delta_c/\sigma_v$` } } }
    return { main, zoom, basin }
  }, [res, tokens])

  return (
    <ExperimentShell
      id={FCW_SWEEP_EXPERIMENT_ID}
      title="近整數 FCW 掃描：哪些 code 會讓 Type-II 變號？"
      level="L2"
      claim="approx"
      description={
        <>
          對每個 FCW 小數 frac 產生 code（standardize 後 <Tex>{'\\sigma_x^2=1'}</Tex>），通過 DT 迴路的 <Tex>{'H_{\\mathrm{PD}}'}</Tex>，算{' '}
          <Tex>{'C_D/\\sigma_x^2'}</Tex>（<Tex>{'D'}</Tex> = GMAC code delay）。紅色點線是 <Tex>{'\\Omega_0=2\\pi\\,\\mathrm{frac}=\\omega_LT_s'}</Tex>；
          <Tex>{'D\\ge1'}</Tex> 時另畫出 F-06.18 的變號門檻。
        </>
      }
      assumptions={[
        'code 與 PLL 同一取樣率；DSM 20-bit、無 dither、regressor 為 DTC phase residue',
        String.raw`三角波是「平滑慢變 code」的數學代表（週期 $1/\mathrm{frac}$），不是特定硬體`,
        String.raw`鋸齒理論 = $\sum_kh[k]\,\big(1-6t_k(1-t_k)\big)$（精確自相關，F-06.17）；三角波理論 = 譜線和（$1/k^4$ 收斂快，諧波在 $k\Omega_0\bmod2\pi$）`,
        '$C_D$ 為無雜訊的時域平均（跳過主迴路暫態；每點取約 64 個、整數個 code 週期）',
        String.raw`basin $\delta_c$：mean-field 特性 $E[x_{\mathrm{ref}}\,\mathrm{erf}(\delta u/\sqrt2\sigma_v)]$ 的第一個變號點（Gaussian comparator 雜訊、$w$ 慢變）`,
      ]}
      params={{ ...q }}
      units={{ bwRatio: 'BW/f_ref', fracMin: 'FCW frac', fracMax: 'FCW frac', loopDelay: 'samples', delay: 'samples' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: { status: 'n/a', note: '確定性 code，沒有隨機成分' },
        fixedPoint: { status: 'not-implemented', note: '定點 DSM / GMAC 見第 13 章與 Lab' },
      }}
      actions={{ onReset: () => setParams(DEFAULTS), onRun: () => setParams((p) => ({ ...p })), running: task.running }}
      exportData={(): Record<string, ArrayLike<number>> =>
        res
          ? {
              frac: res.frac,
              omega0_over_wL: res.ratio,
              dsm1: res.dsm1,
              mash111: res.mash,
              triangle: res.triangle,
              sine: res.sine,
              saw_theory: res.sawTheory,
              tri_theory: res.triTheory,
              saw_asymptote: res.sawAsymptote,
              tri_asymptote: res.triAsymptote,
              dsm1_basin_over_sigma_v: res.basin,
            }
          : {}
      }
      presets={presets}
      onLoadPreset={(p) => setParams((s) => ({ ...s, ...pick(p.params) }))}
      controls={
        <>
          <SelectControl
            label="迴路型式"
            value={params.loopType}
            onChange={(loopType: LoopType) => setParams((s) => ({ ...s, loopType }))}
            options={[
              { value: 'typeII', label: 'Type-II' },
              { value: 'typeI', label: 'Type-I' },
            ]}
            reg="Behavioral: pll_loop.type"
          />
          <ParamControl
            label={<Tex>{'\\zeta'}</Tex>}
            ariaLabel="ζ（阻尼比）"
            value={params.zeta}
            onChange={(zeta) => setParams((s) => ({ ...s, zeta }))}
            min={0.2}
            max={3}
            step={0.01}
            reg="REG_PLL_KP / REG_PLL_KI → ζ"
            disabled={params.loopType === 'typeI'}
          />
          <ParamControl
            label={<Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}'}</Tex>}
            ariaLabel="BW/f_ref"
            value={params.bwRatio}
            onChange={(bwRatio) => setParams((s) => ({ ...s, bwRatio }))}
            min={1e-4}
            max={0.05}
            log
            reg="REG_PLL_KP / REG_PLL_KI → −3 dB 頻寬"
            hint={mathText(String.raw`CT 原型 $T(s)$ 的 $-3\,\mathrm{dB}$ 頻寬除以 $f_{\mathrm{ref}}$`)}
          />
          <ParamControl
            label={mathText('loop latency $d$')}
            ariaLabel="loop latency d"
            value={params.loopDelay}
            onChange={(loopDelay) => setParams((s) => ({ ...s, loopDelay }))}
            min={0}
            max={8}
            integer
            clampOnBlur
            unit="samples"
            reg="REG_PLL_LATENCY"
          />
          <ParamControl
            label={mathText('GMAC code delay $D$')}
            ariaLabel="GMAC code delay D"
            value={params.delay ?? 0}
            onChange={(delay) => setParams((s) => ({ ...s, delay }))}
            min={0}
            max={16}
            integer
            clampOnBlur
            unit="samples"
            reg="REG_GMAC_CODE_DLY（gm_code_delay_samples）"
            hint={mathText(String.raw`$D=0$：regressor 與 PD 誤差對齊；$D\ge1$：regressor 落後（F-06.18）`)}
          />
          <ParamControl
            label={mathText(String.raw`$\mathrm{frac}$ 下限`)}
            ariaLabel="frac 下限"
            value={params.fracMin}
            onChange={(fracMin) => setParams((s) => ({ ...s, fracMin }))}
            min={1e-5}
            max={0.4}
            log
            reg="REG_FCW_FRAC[19:0]（掃描起點）"
          />
          <ParamControl
            label={mathText(String.raw`$\mathrm{frac}$ 上限`)}
            ariaLabel="frac 上限"
            value={params.fracMax}
            onChange={(fracMax) => setParams((s) => ({ ...s, fracMax }))}
            min={1e-4}
            max={0.5}
            log
            reg="REG_FCW_FRAC[19:0]（掃描終點）"
          />
          <ParamControl
            label="掃描點數"
            value={params.points}
            onChange={(points) => setParams((s) => ({ ...s, points }))}
            min={4}
            max={80}
            integer
            clampOnBlur
            reg="Behavioral: sweep points"
          />
        </>
      }
    >
      {plots ? (
        <>
          <Plot
            title={String.raw`$C_D/\sigma_x^2$ vs FCW 小數 $\mathrm{frac}$`}
            ariaLabel="C/σ_x² 對 FCW 小數 frac 的圖"
            data={plots.main}
            xLog
            height={340}
            csvName="ch06-fcw-sweep"
            layout={layouts.main}
            caption={
              D === 0
                ? String.raw`紅色點線：$\Omega_0=\omega_LT_s$。$D=0$：一階 DSM residue 在近整數時趨近 $0^+$（小訊號不變號、恢復力消失）；平滑的三角波與正弦則變負。把 $D$ 設成 1 再看一次。`
                : String.raw`紅色點線：$\Omega_0=\omega_LT_s$；藍色點劃線：F-06.18 的變號門檻 $\mathrm{frac}^*$。$D=${D}$：regressor 落後，一階 DSM residue 在 $\mathrm{frac}<\mathrm{frac}^*$ 變號；高頻成形的 MASH 與高 frac 的鋸齒也可能因 $x[n-D]$ 與 $x[n]$ 反相關而變號。`
            }
          />
          <Plot
            title={String.raw`近整數放大：$|C_D|/\sigma_x^2$ vs $\Delta=\Omega_0/(\omega_LT_s)$（log–log）`}
            ariaLabel="近整數放大：|C|/σ² 對 Δ 的 log–log 圖"
            data={plots.zoom}
            xLog
            yLog
            height={300}
            csvName="ch06-fcw-zoom"
            layout={layouts.zoom}
            caption={String.raw`畫的是絕對值。$D=0$：斜率 2（$\Delta^2$），鋸齒的一階項因 $m_1=\sum_kk\,h[k]=0$ 被抵消（DT 精確；CT 為 $\int\operatorname{Re}\{H\}\,\nu^{-2}d\nu=0$）。$D\ge1$：多出一次項 $-12\,\mathrm{frac}\sum_{k<D}h[k](D-k)$，$|C_D|$ 在變號點出現凹口，更小的 frac 斜率變成 1。`}
          />
          {plots.hasBasin && (
            <Plot
              title={String.raw`近整數的 basin：mean-field 變號點 $\delta_c/\sigma_v$ vs $\mathrm{frac}$`}
              ariaLabel="近整數的 basin：mean-field 變號點 δ_c/σ_v 對 frac 的圖"
              data={plots.basin}
              xLog
              yLog
              height={260}
              csvName="ch06-fcw-basin"
              layout={layouts.basin}
              caption={String.raw`只畫「$C_D>0$ 但 $E[G](\delta)$ 在 $\delta_c$ 變號」的點。$\delta_c$ 以 $\sigma_v$ 為單位（$E[G]$ 只與 $\delta/\sigma_v$ 有關）：$\sigma_v=100\,\mathrm{fs}$、$\delta_c/\sigma_v=0.77$ 就是 $77\,\mathrm{fs}$。越接近整數 basin 越小；$|\delta|$ 一旦超過它，1-bit LMS 的平均更新就往外推。`}
            />
          )}
        </>
      ) : (
        <p className="muted small">{task.running ? '計算中…' : err ?? '等待計算'}</p>
      )}
    </ExperimentShell>
  )
}
