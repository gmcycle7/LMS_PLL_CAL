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
import { designDtLoop, errorPathTransfer } from '@/simulation/models/pll'
import { freqz } from '@/simulation/signal'
import { compareCtDt, type LoopType } from '@/simulation/models/polarity'
import { modelTextTex } from './explorerModel'

export const CT_DT_EXPERIMENT_ID = 'polarity-ct-dt'

interface CtDtParams {
  type: LoopType
  zeta: number
  wLTs: number
  loopDelay: number
}

const DEFAULTS: CtDtParams = { type: 'typeII', zeta: 0.7, wLTs: 0.1, loopDelay: 1 }

const clampNum = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** preset / URL 參數的型別與範圍檢查（不合法的值忽略；避免 designPolarityLoop 因非整數 d 或 ζ ≤ 0 而丟錯） */
function isParams(v: Record<string, unknown>): Partial<CtDtParams> {
  const out: Partial<CtDtParams> = {}
  if (v.type === 'typeI' || v.type === 'typeII') out.type = v.type
  if (typeof v.zeta === 'number' && Number.isFinite(v.zeta)) out.zeta = clampNum(v.zeta, 0.2, 3)
  if (typeof v.wLTs === 'number' && Number.isFinite(v.wLTs)) out.wLTs = clampNum(v.wLTs, 1e-3, 1.5)
  if (typeof v.loopDelay === 'number' && Number.isFinite(v.loopDelay)) out.loopDelay = clampNum(Math.round(v.loopDelay), 0, 8)
  return out
}

/** E44：CT 原型 H_PD(jω) 與 DT 模型 H_PD(e^{jΩ}) 的對照（Ω = ωT_s）。計算量小，主執行緒即時更新。 */
export function CtDtExperiment() {
  const [params, setParams] = useState<CtDtParams>(DEFAULTS)
  const urlPreset = useUrlPreset(CT_DT_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setParams((p) => ({ ...p, ...isParams(urlPreset.params) }))
  }, [urlPreset])
  const presets = useMemo(
    () => presetsForExperiment(CT_DT_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )
  const tokens = useThemeTokens()
  const dq = useDebouncedValue(params, 80)
  // 計算一律用檢查過的參數（滑桿輸入途中的非整數 d 也不會讓設計函式丟錯）
  const q = useMemo<CtDtParams>(() => ({ ...DEFAULTS, ...isParams({ ...dq }) }), [dq])
  const r = useMemo(() => compareCtDt({ type: q.type, zeta: q.zeta, wLTs: q.wLTs, loopDelay: q.loopDelay }), [q])

  // 交叉比對：自寫係數 vs pll.ts（Type-II：designDtLoop；Type-I d = 0：first_order_hp）
  const check = useMemo(() => {
    const om = [0.1 * q.wLTs, q.wLTs, 3 * q.wLTs, Math.PI / 2]
    let refTf: { b: number[]; a: number[] } | null = null
    if (q.type === 'typeII') refTf = designDtLoop({ wnTs: q.wLTs, zeta: q.zeta, loopDelay: q.loopDelay }).Hpd
    else if (q.loopDelay === 0 && q.wLTs < 2) refTf = errorPathTransfer({ kind: 'first_order_hp', parameters: { pole: 1 - q.wLTs } })
    if (!refTf) return { status: 'n/a' as const, note: 'Type-I 且 $d>0$：pll.ts 沒有對應的參考實作' }
    const a = freqz(r.design.b, r.design.a, om)
    const b = freqz(refTf.b, refTf.a, om)
    let maxd = 0
    a.forEach((v, i) => (maxd = Math.max(maxd, Math.hypot(v.re - b[i].re, v.im - b[i].im))))
    return maxd < 1e-10
      ? { status: 'ok' as const, note: String.raw`與 pll.ts 參考實作的 $H(e^{j\Omega})$ 最大差 $${texNum(maxd, 2)}$` }
      : { status: 'mismatch' as const, note: `與 pll.ts 參考實作不一致（最大差 $${texNum(maxd, 3)}$）` }
  }, [q, r])

  // Tustin（bilinear）版本：pll.ts designDtLoop(method = 'bilinear')，只對 Type-II 有定義；它不是嚴格因果（h[0] ≠ 1）
  const tustin = useMemo(() => {
    if (q.type !== 'typeII') return null
    const des = designDtLoop({ wnTs: q.wLTs, zeta: q.zeta, loopDelay: q.loopDelay, method: 'bilinear' })
    const om = Array.from(r.nu, (v) => v * q.wLTs)
    const H = freqz(des.Hpd.b, des.Hpd.a, om)
    return { re: H.map((z) => z.re), phase: H.map((z) => (Math.atan2(z.im, z.re) * 180) / Math.PI), h0: des.Hpd.b[0] / des.Hpd.a[0], stable: des.stable }
  }, [q, r])

  // 模型的警告是純文字（Unicode 數學）；顯示前換成 `$...$`
  const warnings = r.design.warnings.map(modelTextTex)
  if (q.type === 'typeI' && r.design.lowFreqCoef < 0 && r.design.stable) {
    warnings.push(
      String.raw`Type-I 但 $K(d+\tfrac12)=${texNum(q.wLTs * (q.loopDelay + 0.5), 4)}>1$：loop latency 讓低頻 $\operatorname{Re}\{H_{\mathrm{PD}}\}<0$（$\kappa=${texNum(r.design.lowFreqCoef, 4)}$），慢速 code 的極性也會反轉。`,
    )
  }

  // Plot 的 data / layout 都 useMemo：拖動滑桿時（計算結果 r 還沒變）不會每次 render 都觸發 Plotly.react
  const plots = useMemo(() => {
    const nu = Array.from(r.nu)
    const data: Data[] = [
      { x: nu, y: Array.from(r.ctRe), name: String.raw`CT 原型 $\operatorname{Re}\,H(j\omega)$`, mode: 'lines', line: { color: tokens.series[0], dash: 'dash' } },
      { x: nu, y: Array.from(r.dtRe), name: String.raw`DT 模型 $\operatorname{Re}\,H(e^{j\Omega})$（$d = ${r.design.loopDelay}$）`, mode: 'lines', line: { color: tokens.series[1] } },
      ...(tustin ? [{ x: nu, y: tustin.re, name: 'Tustin（bilinear）對照', mode: 'lines' as const, line: { color: tokens.series[4], dash: 'dot' as const } }] : []),
    ]
    const phaseData: Data[] = [
      { x: nu, y: Array.from(r.ctPhaseDeg), name: String.raw`CT $\angle H$`, mode: 'lines', line: { color: tokens.series[0], dash: 'dash' } },
      { x: nu, y: Array.from(r.dtPhaseDeg), name: String.raw`DT $\angle H$`, mode: 'lines', line: { color: tokens.series[1] } },
      ...(tustin ? [{ x: nu, y: tustin.phase, name: String.raw`Tustin $\angle H$`, mode: 'lines' as const, line: { color: tokens.series[4], dash: 'dot' as const } }] : []),
    ]
    const shapes = [
      { type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } },
      ...(r.dtBoundaryNu ? [{ type: 'line' as const, yref: 'paper' as const, y0: 0, y1: 1, x0: r.dtBoundaryNu, x1: r.dtBoundaryNu, line: { color: tokens.series[1], dash: 'dot' as const } }] : []),
    ]
    const reLayout: Partial<Layout> = { xaxis: { title: { text: String.raw`$\nu = \Omega/(\omega_L T_s)$` } }, yaxis: { title: { text: String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}$` } }, shapes }
    const phaseLayout: Partial<Layout> = {
      xaxis: { title: { text: String.raw`$\nu = \Omega/(\omega_L T_s)$` } },
      yaxis: { title: { text: '相位 [deg]' } },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 90, y1: 90, line: { color: tokens.danger, dash: 'dot', width: 1 } }],
    }
    return { data, phaseData, reLayout, phaseLayout }
  }, [r, tustin, tokens])

  const metrics: MetricRow[] = [
    { name: String.raw`$\omega_LT_s$`, value: q.wLTs, unit: 'rad/sample', note: String.raw`Type-II：$\omega_nT_s$；Type-I：$\omega_cT_s=K$` },
    {
      name: String.raw`DT polarity 邊界 $\Omega_b/(\omega_LT_s)$`,
      value: r.dtBoundaryNu,
      analytic: r.ctBoundaryNu ?? undefined,
      formulaId: 'F-06.8',
      claim: 'exact',
      note: String.raw`$\operatorname{Re}\{H(e^{j\Omega})\}$ 最低負頻帶的上緣；與 CT 原型（$\nu=1$）比較`,
    },
    { name: String.raw`$\angle H$ 在 $0.3\,\omega_L$（DT）`, value: r.dtPhaseAt03, unit: 'deg', analytic: r.ctPhaseAt03, claim: 'exact', note: String.raw`對照欄 = CT 原型在 $\nu=0.3$ 的相位（Type-II、$\zeta=0.7$ 時 $155.2249^\circ$）` },
    { name: String.raw`白色 code $C/\sigma_x^2$（DT，$h[0]$）`, value: r.whiteDt, formulaId: 'F-06.13', claim: 'exact' },
    { name: String.raw`白色 code $C/\sigma_x^2$（錯誤：代入 CT $H(j\Omega/T_s)$）`, value: r.whiteNaiveCt, analytic: r.whiteDt, claim: 'approx', note: String.raw`E44：不可把 $\Omega$ 代入 $H(j\omega)$` },
    { name: String.raw`低頻係數 $\kappa$（$\operatorname{Re}H\approx\kappa\,(\Omega/\omega_LT_s)^2$）`, value: r.design.lowFreqCoef, claim: 'exact' },
    ...(tustin
      ? [{ name: String.raw`Tustin 版本的 $h[0]$（白色 code 的 $C/\sigma_x^2$）`, value: tustin.h0, note: String.raw`bilinear 不是嚴格因果，所以 $h[0]\ne1$；網站預設用 dpll 差分方程（E44）` }]
      : []),
    { name: '主迴路 spectral radius', value: r.design.spectralRadius, note: r.design.stable ? '穩定' : '不穩定' },
  ]

  return (
    <ExperimentShell
      id={CT_DT_EXPERIMENT_ID}
      title="CT 原型 vs DT 迴路：polarity 邊界會移動（E44）"
      level="L2"
      claim="exact"
      description={
        <>
          橫軸 <Tex>{'\\nu=\\Omega/(\\omega_LT_s)'}</Tex>。虛線是把 <Tex>{'\\omega=\\Omega/T_s'}</Tex> 代入 CT 原型 <Tex>{'H(j\\omega)'}</Tex>；實線是 DT 迴路 <Tex>{'H(e^{j\\Omega})'}</Tex>（Type-II 與 pll.ts designDtLoop 相同）。Re &lt; 0 的頻帶就是「單頻 code 會讓 raw-x LMS 變號」的頻帶。
        </>
      }
      assumptions={[
        String.raw`PLL 迴路與 comparator 同一取樣率（$f_s=f_{\mathrm{ref}}$）`,
        'DT 迴路：DCO 含一個 sample 延遲（嚴格因果）＋ 額外 latency $d$',
        String.raw`CT 原型只在 $\omega_LT_s\ll1$ 且 $d=0$ 時與 DT 對應`,
      ]}
      params={{ ...q }}
      units={{ wLTs: 'rad/sample', loopDelay: 'samples', zeta: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: check,
        monteCarlo: { status: 'n/a', note: '確定性頻率響應，沒有隨機成分' },
        fixedPoint: { status: 'not-implemented', note: '定點 PLL 濾波器不在本章範圍' },
      }}
      actions={{ onReset: () => setParams(DEFAULTS) }}
      exportData={() => ({
        nu: r.nu,
        ct_re: r.ctRe,
        dt_re: r.dtRe,
        ct_phase_deg: r.ctPhaseDeg,
        dt_phase_deg: r.dtPhaseDeg,
      })}
      presets={presets}
      onLoadPreset={(p) => setParams((s) => ({ ...s, ...isParams(p.params) }))}
      controls={
        <>
          <SelectControl
            label="迴路型式"
            value={params.type}
            onChange={(type) => setParams((s) => ({ ...s, type }))}
            options={[
              { value: 'typeII', label: 'Type-II（PI + DCO，兩個積分器）' },
              { value: 'typeI', label: 'Type-I（比例 + DCO，一個積分器）' },
            ]}
            reg="Behavioral: pll_loop.type"
          />
          <ParamControl
            label={mathText(String.raw`$\zeta$（阻尼比，Type-II）`)}
            ariaLabel="ζ（阻尼比，Type-II）"
            value={params.zeta}
            onChange={(zeta) => setParams((s) => ({ ...s, zeta }))}
            min={0.2}
            max={3}
            step={0.01}
            reg="REG_PLL_KP / REG_PLL_KI → ζ"
            disabled={params.type === 'typeI'}
          />
          <ParamControl
            label={<Tex>{'\\omega_LT_s'}</Tex>}
            ariaLabel="ω_L T_s（迴路頻率 × 取樣週期）"
            value={params.wLTs}
            onChange={(wLTs) => setParams((s) => ({ ...s, wLTs }))}
            min={1e-3}
            max={1.5}
            log
            unit="rad/sample"
            reg="REG_PLL_KP / REG_PLL_KI"
            hint={mathText(String.raw`Type-II：$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$；Type-I：$K=\omega_cT_s$。E44 的數值例子：0.01、0.1、0.3`)}
          />
          <ParamControl
            label={mathText('額外 loop latency $d$')}
            ariaLabel="額外 loop latency d"
            value={params.loopDelay}
            onChange={(loopDelay) => setParams((s) => ({ ...s, loopDelay }))}
            min={0}
            max={8}
            integer
            clampOnBlur
            unit="samples"
            reg="REG_PLL_LATENCY（pipeline 級數）"
          />
        </>
      }
    >
      <Plot
        title={String.raw`$\operatorname{Re}\{H_{\mathrm{PD}}\}$：CT 原型 vs DT 迴路`}
        ariaLabel="Re{H_PD}：CT 原型 vs DT 迴路"
        data={plots.data}
        xLog
        height={300}
        csvName="ch06-ct-dt-re"
        layout={plots.reLayout}
        caption={String.raw`垂直點線：DT 迴路的 polarity 邊界（$\operatorname{Re}\{H\}$ 由負轉正）。Type-II 的 CT 邊界恰在 $\nu=1$。細點線：pll.ts 的 Tustin（bilinear）版本，僅供對照。`}
      />
      <Plot
        title={String.raw`$\angle H_{\mathrm{PD}}$ [deg]`}
        ariaLabel="H_PD 的相位 [deg]"
        data={plots.phaseData}
        xLog
        height={260}
        csvName="ch06-ct-dt-phase"
        layout={plots.phaseLayout}
        caption={String.raw`紅色點線 = $90^\circ$：相位超過它，該頻率的單頻 code 會讓 raw-$x$ LMS 變號。latency $d$ 讓 DT 的相位在高頻一路往下掉（每個 sample 的延遲貢獻 $-\Omega$）。`}
      />
    </ExperimentShell>
  )
}
