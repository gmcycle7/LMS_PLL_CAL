import { memo, useMemo } from 'react'
import type { Data, Layout, Shape } from 'plotly.js-cartesian-dist-min'
import { Plot, useThemeTokens } from '@/components'
import { isToneEdge, toneCorrelation, type ClosedLoopCaseResult } from '@/simulation/models/polarity'
import type { CaseSummary } from './PolarityExplorer'
import { f } from '../shared'

/** 半透明色（#rrggbb → rgba） */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

function zeroLine(color: string): Partial<Shape> {
  return { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color, width: 1 } }
}

interface ExplorerPlotsProps {
  summaries: CaseSummary[]
  activeId: string
  loopRes: Map<string, ClosedLoopCaseResult>
}

/**
 * Polarity Explorer 的圖表（波形、C_D vs D、C vs φ / Re{H}+PSD、Bode、pole vs μ、閉迴路 δ_k、mean-field 特性）。
 * 以 memo 包起來：拖動滑桿時（參數還在 debounce、summaries 沒變）不重畫；data 與 layout 也都 useMemo，
 * 避免每次 render 都觸發 Plotly.react。
 */
export const ExplorerPlots = memo(function ExplorerPlots({ summaries, activeId, loopRes }: ExplorerPlotsProps) {
  const tokens = useThemeTokens()
  const active = summaries.find((s) => s.id === activeId) ?? summaries[0]
  const pllFocus = active?.pll ? active : summaries.find((s) => s.pll)

  // ── 1. 波形 x vs u（目前編輯的 case）──
  const wave = useMemo(() => {
    if (!active) return null
    const w = active.tone ? active.tone.wave : active.pll ? active.pll.wave : null
    if (!w) return null
    const traces: Data[] = [
      { x: Array.from(w.n), y: Array.from(w.x), name: String.raw`$x[n]$（原始 code）`, mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[0] } },
      { x: Array.from(w.n), y: Array.from(w.u), name: String.raw`$u[n] = (h \ast x)[n]$（PD 看到的）`, mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[1] } },
    ]
    const D = Math.round(active.params.D)
    if (active.tone && D > 0) {
      traces.push({ x: w.n, y: active.tone.wave.xD, name: String.raw`$x[n-${D}]$（GMAC 用）`, mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } })
    } else if (active.pll && D > 0 && D < w.n.length) {
      // PLL 模式：x[n − D] 就是同一段 x 往右平移 D 個 sample
      const n = Array.from(w.n)
      const x = Array.from(w.x)
      traces.push({ x: n.slice(D), y: x.slice(0, x.length - D), name: String.raw`$x[n-${D}]$（GMAC 用）`, mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } })
    }
    return traces
  }, [active, tokens])

  // ── 2. C_D vs D（所有 case）──
  const cd = useMemo(() => {
    const traces: Data[] = []
    for (const s of summaries) {
      const curD = Math.round(s.params.D)
      if (s.tone) {
        traces.push({ x: s.tone.CD.D, y: s.tone.CD.analytic, name: `${s.id}：解析`, mode: 'lines', line: { color: s.color } })
        traces.push({ x: s.tone.CD.D, y: s.tone.CD.empirical, name: `${s.id}：時域`, mode: 'markers', marker: { color: s.color, size: 6, symbol: 'circle-open' } })
        if (curD < s.tone.CD.D.length) traces.push({ x: [curD], y: [s.tone.CD.analytic[curD]], name: String.raw`${s.id}：目前 $D$`, mode: 'markers', marker: { color: s.color, size: 13, symbol: 'star' } })
        if (s.params.regressor === 'u') {
          const A2 = s.params.A * s.params.mag
          traces.push({
            x: s.tone.CD.D,
            y: s.tone.CD.D.map((d) => toneCorrelation({ A: A2, mag: 1, phiRad: 0, omega: s.params.omega, delay: d })),
            name: String.raw`${s.id}：filtered-x $E[u_D\,u]$`,
            mode: 'lines',
            line: { color: s.color, dash: 'dashdot' },
          })
        }
      } else if (s.pll) {
        const D = Array.from(s.pll.CD.D)
        traces.push({ x: D, y: Array.from(s.pll.CD.empirical), name: `${s.id}：時域`, mode: 'lines+markers', marker: { size: 5 }, line: { color: s.color } })
        traces.push({ x: D, y: Array.from(s.pll.CD.periodogram), name: `${s.id}：譜線和`, mode: 'lines', line: { color: s.color, dash: 'dash' } })
        if (s.pll.CD.theory) traces.push({ x: D, y: Array.from(s.pll.CD.theory), name: `${s.id}：封閉式`, mode: 'lines', line: { color: s.color, dash: 'dot' } })
        if (s.params.regressor === 'u') traces.push({ x: D, y: Array.from(s.pll.CD.filtered), name: String.raw`${s.id}：filtered-x $E[u_D\,u]$`, mode: 'lines', line: { color: s.color, dash: 'dashdot' } })
        if (curD < D.length) traces.push({ x: [curD], y: [s.pll.CD.empirical[curD]], name: String.raw`${s.id}：目前 $D$`, mode: 'markers', marker: { color: s.color, size: 13, symbol: 'star' } })
      }
    }
    return traces
  }, [summaries])

  // ── 3a. 單頻：C vs φ ──
  const cphi = useMemo(() => {
    const tones = summaries.filter((s) => s.tone)
    if (tones.length === 0) return null
    const phis = Array.from({ length: 361 }, (_, i) => i - 180)
    const traces: Data[] = []
    for (const s of tones) {
      const D = Math.round(s.params.D)
      const edge = isToneEdge(s.params.omega)
      traces.push({
        x: phis,
        y: phis.map((p) => toneCorrelation({ A: s.params.A, mag: s.params.mag, phiRad: edge ? (Math.cos((p * Math.PI) / 180) >= 0 ? 0 : Math.PI) : (p * Math.PI) / 180, omega: s.params.omega, delay: D })),
        name: String.raw`${s.id}：$C_D(\phi)$`,
        mode: 'lines',
        line: { color: s.color },
      })
      traces.push({ x: [s.params.phiDeg], y: [s.tone!.C], name: String.raw`${s.id}：目前 $\phi$`, mode: 'markers', marker: { color: s.color, size: 12, symbol: 'star' } })
    }
    return traces
  }, [summaries])

  // ── 3b. PLL：Re{H} + code PSD（focus case）與 Bode ──
  const pllPlots = useMemo(() => {
    if (!pllFocus?.pll) return null
    const r = pllFocus.pll
    const wL = r.design.wLTs
    const nu = Array.from(r.grid.omega, (w) => w / wL)
    const shapes: Partial<Shape>[] = r.bands.negative.map(([a, b]) => ({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: a / wL,
      x1: b / wL,
      y0: 0,
      y1: 1,
      fillcolor: alpha(tokens.danger, 0.1),
      line: { width: 0 },
      layer: 'below',
    }))
    shapes.push(zeroLine(tokens.textMuted))
    if (r.omegaTone !== null) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: r.omegaTone / wL, x1: r.omegaTone / wL, y0: 0, y1: 1, line: { color: tokens.series[3], dash: 'dot' } })
    }
    // PSD（dB，峰值正規化為 0 dB；略過 Ω = 0）
    let pmax = 0
    for (let i = 1; i < r.psd.sxx.length; i++) pmax = Math.max(pmax, r.psd.sxx[i])
    const px: number[] = []
    const py: number[] = []
    for (let i = 1; i < r.psd.omega.length; i++) {
      px.push(r.psd.omega[i] / wL)
      py.push(10 * Math.log10(Math.max(r.psd.sxx[i] / pmax, 1e-16)))
    }
    const reData: Data[] = [
      { x: nu, y: Array.from(r.grid.re), name: String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}(e^{j\Omega})$（DT）`, mode: 'lines', line: { color: tokens.series[1], width: 2 } },
      { x: nu, y: Array.from(r.grid.ctRe), name: 'CT 原型（僅供對照，E44）', mode: 'lines', line: { color: tokens.series[1], dash: 'dash', width: 1 } },
      { x: px, y: py, name: 'code PSD [dB，峰值 = 0]', mode: 'lines', line: { color: tokens.series[0], width: 1 }, yaxis: 'y2', opacity: 0.8 },
    ]
    const reLayout: Partial<Layout> = {
      xaxis: { title: { text: String.raw`$\Omega/(\omega_L T_s)$` } },
      yaxis: { title: { text: String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}$` } },
      yaxis2: { title: { text: 'PSD [dB]' }, overlaying: 'y', side: 'right', showgrid: false, range: [-80, 5] },
      shapes,
    }
    const bode: Data[] = [
      { x: nu, y: Array.from(r.grid.magDb), name: String.raw`$|H_{\mathrm{PD}}|$ [dB]`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: nu, y: Array.from(r.grid.phaseDeg), name: String.raw`$\angle H_{\mathrm{PD}}$ [deg]`, mode: 'lines', line: { color: tokens.series[1] }, yaxis: 'y2' },
      { x: nu, y: Array.from(r.grid.ctPhaseDeg), name: String.raw`$\angle H$ CT 原型`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash', width: 1 }, yaxis: 'y2' },
    ]
    const bodeLayout: Partial<Layout> = {
      xaxis: { title: { text: String.raw`$\Omega/(\omega_L T_s)$` } },
      yaxis: { title: { text: String.raw`$|H|$ [dB]` } },
      yaxis2: { title: { text: '相位 [deg]' }, overlaying: 'y', side: 'right', showgrid: false },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y2', y0: 90, y1: 90, line: { color: tokens.danger, dash: 'dot', width: 1 } }],
    }
    const caption = String.raw`Welch：Hann window、nperseg = ${r.psd.nperseg}、${r.psd.nSegments} 段、ENBW = ${f(r.psd.enbwBins, 3)} bins；DTFT 形式雙邊 PSD（$f_s=1$ sample），以峰值正規化。紅底 = $\operatorname{Re}\{H\}<0$ 的頻帶。`
    return { reData, reLayout, bode, bodeLayout, caption, id: pllFocus.id }
  }, [pllFocus, tokens])

  // ── 4. pole vs μ（所有 case）──
  const pole = useMemo(() => {
    const valid = summaries.filter((s) => Number.isFinite(s.C) && Number.isFinite(s.Kq))
    if (valid.length === 0) return null
    const muMax = Math.max(...valid.map((s) => 3 * s.params.mu))
    const mus = Array.from({ length: 201 }, (_, i) => (muMax * i) / 200)
    const traces: Data[] = []
    let ymin = -1.2
    let ymax = 1.2
    for (const s of valid) {
      const ps = mus.map((m) => 1 - m * s.Kq * s.C)
      ymin = Math.min(ymin, ...ps)
      ymax = Math.max(ymax, ...ps)
      traces.push({ x: mus, y: ps, name: String.raw`${s.id}：$p(\mu)$`, mode: 'lines', line: { color: s.color } })
      traces.push({ x: [s.params.mu], y: [s.pole], name: String.raw`${s.id}：目前 $\mu$`, mode: 'markers', marker: { color: s.color, size: 11, symbol: 'star' } })
    }
    const shapes: Partial<Shape>[] = [
      { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: -1, y1: 1, fillcolor: alpha(tokens.series[2], 0.08), line: { width: 0 }, layer: 'below' },
      { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: tokens.textMuted, dash: 'dot', width: 1 } },
    ]
    return { traces, shapes, range: [Math.max(ymin, -3), Math.min(ymax, 3)] as [number, number] }
  }, [summaries, tokens])

  // ── 5. 閉迴路 δ_k ──
  const loop = useMemo(() => {
    const traces: Data[] = []
    for (const s of summaries) {
      const r = loopRes.get(s.id)
      if (!r) continue
      const k = Array.from({ length: r.deltaMean.length }, (_, i) => i)
      r.deltaChains.slice(0, 3).forEach((ch, i) => {
        traces.push({ x: k, y: Array.from(ch), name: `${s.id}：chain ${i}`, mode: 'lines', line: { color: alpha(s.color, 0.3), width: 1 }, showlegend: i === 0 })
      })
      traces.push({ x: k, y: Array.from(r.deltaMean), name: String.raw`${s.id}：MC 平均 $\delta_k$`, mode: 'lines', line: { color: s.color, width: 2.5 } })
      // 線性預測只畫到 |δ| ≤ 4·max|MC| 以免撐爆座標
      let lim = 0
      for (const v of r.deltaMean) lim = Math.max(lim, Math.abs(v))
      const pred = Array.from(r.predLinear, (v) => (Math.abs(v) <= 4 * lim + 1 ? v : Number.NaN))
      traces.push({ x: k, y: pred, name: String.raw`${s.id}：線性 $\delta_0p^k$`, mode: 'lines', line: { color: s.color, dash: 'dash', width: 1.5 } })
      if (r.reference) traces.push({ x: k, y: Array.from(r.reference.delta), name: `${s.id}：blockLms 參考（seed 同 chain 0）`, mode: 'lines', line: { color: s.color, dash: 'dot', width: 1 } })
    }
    return traces
  }, [summaries, loopRes])

  // ── 6. mean-field 特性 E[G](δ)（所有 case；δ > 0，E[G] 是 δ 的奇函數）──
  const sCurve = useMemo(() => {
    const traces: Data[] = []
    const shapes: Partial<Shape>[] = [zeroLine(tokens.textMuted)]
    for (const s of summaries) {
      const r = loopRes.get(s.id)
      if (!r || r.sCurve.delta.length === 0) continue
      const d = Array.from(r.sCurve.delta)
      traces.push({ x: d, y: Array.from(r.sCurve.G), name: String.raw`${s.id}：mean-field $E[G](\delta)$`, mode: 'lines+markers', marker: { size: 4 }, line: { color: s.color, width: 2 } })
      // 小訊號切線 K_q·C·δ 只畫到線性區的幾倍，之後它與真實特性無關
      const lim = r.uMax > 0 ? (3 * s.params.sigmaV) / r.uMax : Infinity
      traces.push({
        x: d,
        y: d.map((v) => (v <= lim ? r.Kq * r.C * v : Number.NaN)),
        name: String.raw`${s.id}：線性 $K_qC\,\delta$`,
        mode: 'lines',
        line: { color: s.color, dash: 'dash', width: 1 },
      })
      if (r.sCurve.cross !== null) {
        shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: r.sCurve.cross, x1: r.sCurve.cross, y0: 0, y1: 1, line: { color: s.color, dash: 'dot', width: 1.5 } })
      }
    }
    return { traces, shapes }
  }, [summaries, loopRes, tokens])

  // ── layout（固定內容；只隨主題或資料範圍改變）──
  const layouts = useMemo(() => {
    const zero = zeroLine(tokens.textMuted)
    const vline = (x: number): Partial<Shape> => ({ type: 'line', yref: 'paper', y0: 0, y1: 1, x0: x, x1: x, line: { color: tokens.danger, dash: 'dot', width: 1 } })
    return {
      wave: { xaxis: { title: { text: '$n$ [sample]' } }, yaxis: { title: { text: 'code（無因次）' } }, shapes: [zero] } as Partial<Layout>,
      cd: { xaxis: { title: { text: '$D$ [samples]' } }, yaxis: { title: { text: '$C_D$' } }, shapes: [zero] } as Partial<Layout>,
      cphi: { xaxis: { title: { text: String.raw`$\phi$ [deg]` }, dtick: 30 }, yaxis: { title: { text: '$C_D$' } }, shapes: [zero, vline(90), vline(-90)] } as Partial<Layout>,
      loop: { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$\delta_k$ [fs]` } }, shapes: [zero] } as Partial<Layout>,
    }
  }, [tokens])
  const poleLayout = useMemo<Partial<Layout> | null>(
    () => (pole ? { xaxis: { title: { text: String.raw`$\mu$ [fs]` } }, yaxis: { title: { text: '$p$' }, range: pole.range }, shapes: pole.shapes } : null),
    [pole],
  )
  const sCurveLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: String.raw`$|\delta|$ [fs]` } }, yaxis: { title: { text: '$E[G]$（無因次）' } }, shapes: sCurve.shapes }),
    [sCurve],
  )

  return (
    <>
      {wave && (
        <Plot
          title={`波形：$x$ 與 $u$（Case ${active?.id}）`}
          ariaLabel={`波形：x 與 u（Case ${active?.id}）`}
          data={wave}
          height={260}
          csvName="ch06-wave"
          layout={layouts.wave}
          caption={String.raw`相位差超過 $90^\circ$ 時，$x$ 與 $u$ 大多數時間反號——GMAC 的 $\sum q\,x$ 因此往錯的方向累積。`}
        />
      )}
      <div className="ch06-grid2">
        <Plot
          title="$C_D$ vs GMAC code delay $D$"
          ariaLabel="C_D 對 GMAC code delay D 的圖"
          data={cd}
          height={280}
          csvName="ch06-cd-vs-d"
          layout={layouts.cd}
          caption={String.raw`★ = 目前的 $D$。單頻：$C_D=\tfrac{A^2}{2}|H|\cos(\phi+\Omega D)$，以 $2\pi/\Omega$ 為週期；白色 code：$C_D=h[D]\,\sigma_x^2$；近整數一階 DSM：$D\ge1$ 就可能變號（F-06.18）。`}
        />
        {pole && poleLayout && (
          <Plot
            title={String.raw`平均 pole $p=1-\mu K_qC$ vs $\mu$`}
            ariaLabel="平均 pole 對 learning rate μ 的圖"
            data={pole.traces}
            height={280}
            csvName="ch06-pole-vs-mu"
            layout={poleLayout}
            caption={String.raw`綠底 = $|p|<1$（平均收斂）。$C<0$ 的直線斜率為正：$\mu$ 越大越不穩，$\mu\to0$ 也只趨近 $p=1^+$。`}
          />
        )}
      </div>
      {cphi && (
        <Plot
          title={String.raw`單頻：$C_D$ vs 路徑相位 $\phi$`}
          ariaLabel="單頻：C_D 對路徑相位 φ 的圖"
          data={cphi}
          height={260}
          csvName="ch06-c-vs-phi"
          layout={layouts.cphi}
          caption={String.raw`紅色點線 = $\pm90^\circ$（$D=0$ 時的單頻極性界線；$D>0$ 時整條曲線平移 $-\Omega D$）。`}
        />
      )}
      {pllPlots && (
        <>
          <Plot
            title={String.raw`$\operatorname{Re}\{H_{\mathrm{PD}}\}$ 與 code PSD（Case ${pllPlots.id}）`}
            ariaLabel={`Re{H_PD} 與 code PSD（Case ${pllPlots.id}）`}
            data={pllPlots.reData}
            xLog
            height={320}
            csvName="ch06-reh-psd"
            layout={pllPlots.reLayout}
            caption={pllPlots.caption}
          />
          <Plot
            title={String.raw`$H_{\mathrm{PD}}$ Bode（Case ${pllPlots.id}）`}
            ariaLabel={`H_PD Bode（Case ${pllPlots.id}）`}
            data={pllPlots.bode}
            xLog
            height={280}
            csvName="ch06-bode"
            layout={pllPlots.bodeLayout}
            caption={String.raw`DT 迴路（實線）與 CT 原型（虛線）。紅色點線 = $90^\circ$：相位超過它，該頻率的單頻 code 會讓 raw-$x$ LMS 變號。`}
          />
        </>
      )}
      {loop.length > 0 ? (
        <Plot
          title={String.raw`閉迴路 block sign-LMS：$\delta_k=a-w_k$`}
          ariaLabel="閉迴路 block sign-LMS 的參數誤差軌跡"
          data={loop}
          height={320}
          csvName="ch06-closed-loop"
          layout={layouts.loop}
          caption={String.raw`粗線 = MC 平均；細線 = 個別 chain；虛線 = 線性平均模型 $\delta_0p^k$（只在 $|\delta u|\ll\sigma_v$ 的區域可信）；點線 = 共用的 blockLms 參考模型。$C<0$ 時先指數遠離 $a$，誤差變大後 comparator 飽和，轉為線性漂移（F-06.15）。`}
        />
      ) : (
        <p className="small muted">閉迴路模擬計算中…</p>
      )}
      {sCurve.traces.length > 0 && (
        <Plot
          title={String.raw`mean-field 特性：$E[G](\delta)=E\big[x_{\mathrm{ref}}\,\mathrm{erf}\big(\delta u/(\sqrt2\sigma_v)\big)\big]$`}
          ariaLabel="mean-field 特性 E[G] 對 δ 的圖"
          data={sCurve.traces}
          xLog
          height={300}
          csvName="ch06-mean-field"
          layout={sCurveLayout}
          caption={String.raw`平均更新 $E[\delta_{k+1}-\delta_k]=-\mu\,E[G](\delta)$：$E[G]>0$ 把 $\delta$ 拉回 0，$E[G]<0$ 把它推走。虛線 = 小訊號切線 $K_qC\,\delta$（只在 $|\delta|\,u_{\max}\ll\sigma_v$ 可信）；垂直點線 = 變號點 $\delta_c$。單頻 code 不會變號；近整數鋸齒經 Type-II 會（尖峰先飽和、小尾巴仍線性）——$C>0$ 也只是局部穩定。`}
        />
      )}
    </>
  )
})
