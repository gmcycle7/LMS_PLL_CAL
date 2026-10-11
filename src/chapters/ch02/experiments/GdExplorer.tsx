import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { gradientDescent } from '@/simulation/models/sgd'
import { f4, range, tm, tn, toShellPresets, lab } from '../common'

const ID = 'gd-tangent'

interface P {
  a: number
  x: number
  w0: number
  mu: number
  steps: number
  cost: 'half' | 'full'
}

const DEFAULT: P = { a: 3, x: 2, w0: 1, mu: 0.1, steps: 8, cost: 'half' }
/** 步數上限（「執行至收斂」與單步都不超過） */
const MAX_STEPS = 400

const INLINE_PRESETS = [
  { name: 'T01 手算例子（½ 成本 = LMS）', params: { ...DEFAULT }, description: 'w₁ = 1.8、w₂ = 2.28' },
  { name: 'Newton 步長 μ = 1/J″ = 0.25：一步到位', params: { ...DEFAULT, mu: 0.25, steps: 4 }, description: 'pole = 0' },
  { name: 'μ = 0.4：正負交替收斂', params: { ...DEFAULT, mu: 0.4, steps: 12 }, description: 'pole = −0.6' },
  { name: '同 μ = 0.3，但用沒有 ½ 的 J₂（勘誤 E41）', params: { ...DEFAULT, mu: 0.3, cost: 'full' as const, steps: 10 }, description: 'pole = 1 − 2μx² = −1.4：發散' },
]

function sanitize(p: Record<string, unknown>): P {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    a: num(p.a, DEFAULT.a),
    x: num(p.x, DEFAULT.x),
    w0: num(p.w0, DEFAULT.w0),
    mu: num(p.mu, DEFAULT.mu),
    steps: Math.max(1, Math.min(MAX_STEPS, Math.round(num(p.steps, DEFAULT.steps)))),
    cost: p.cost === 'full' ? 'full' : 'half',
  }
}

/** 切線 → Gradient Descent：在 J(w) 圖上畫出每一步的切線與「切線預測 vs 真實」的落差。 */
export function GdExplorer() {
  const [p, setP] = useState<P>(DEFAULT)
  const urlPreset = useUrlPreset(ID)
  useEffect(() => {
    if (urlPreset) setP(sanitize(urlPreset.params))
  }, [urlPreset])
  const tokens = useThemeTokens()
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((s) => ({ ...s, [k]: v }))

  const c = p.cost === 'half' ? 0.5 : 1
  const curv = 2 * c * p.x * p.x // J″ = 2c·x²
  const pole = 1 - p.mu * curv // δ_{n+1} = (1 − μJ″)δ_n
  const tr = useMemo(() => gradientDescent(p), [p])
  const closed = useMemo(() => range(p.steps + 1).map((n) => p.a - (p.a - p.w0) * pole ** n), [p, pole])
  const maxErr = closed.reduce((m, v, n) => Math.max(m, Math.abs(v - tr.w[n])), 0)
  const finiteAll = tr.w.every((v) => Number.isFinite(v))

  // J(w) 曲線的範圍：涵蓋 a、w0 與前幾步（發散時不追到無限遠）
  const shown = Math.min(p.steps, 6)
  const span = useMemo(() => {
    const pts = [p.a, p.w0, ...Array.from(tr.w.slice(0, shown + 1)).filter((v) => Number.isFinite(v) && Math.abs(v - p.a) < 20 * (Math.abs(p.a - p.w0) + 1))]
    const lo = Math.min(...pts)
    const hi = Math.max(...pts)
    const m = 0.15 * (hi - lo || 1)
    return [lo - m, hi + m] as const
  }, [p, tr, shown])

  const data = useMemo<Data[]>(() => {
    const ws = range(201).map((i) => span[0] + ((span[1] - span[0]) * i) / 200)
    const J = (w: number) => c * (p.a * p.x - w * p.x) ** 2
    const traces: Data[] = [
      { x: ws, y: ws.map(J), name: p.cost === 'half' ? String.raw`$J(w)=\tfrac{1}{2}\,(y-wx)^2$` : String.raw`$J_2(w)=(y-wx)^2$`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
    ]
    for (let n = 0; n < shown && Number.isFinite(tr.w[n + 1]); n++) {
      const w0 = tr.w[n]
      const w1 = tr.w[n + 1]
      const pred = tr.J[n] + tr.dJ[n] * (w1 - w0) // 切線（一階泰勒）的預測
      traces.push({
        x: [w0, w1],
        y: [tr.J[n], pred],
        name: n === 0 ? '切線上走一步（一階預測）' : undefined,
        showlegend: n === 0,
        legendgroup: 'tan',
        mode: 'lines',
        line: { color: tokens.series[1], dash: 'dash' },
      })
      traces.push({
        x: [w1, w1],
        y: [pred, J(w1)],
        name: n === 0 ? String.raw`二次項 $\tfrac{1}{2}\,J''\,\Delta^2$（預測 vs 真實）` : undefined,
        showlegend: n === 0,
        legendgroup: 'curv',
        mode: 'lines',
        line: { color: tokens.series[3], dash: 'dot' },
      })
    }
    traces.push({
      x: Array.from(tr.w.slice(0, shown + 1)),
      y: Array.from(tr.J.slice(0, shown + 1)),
      name: '$w_n$',
      mode: 'text+markers',
      // 越往後點越擠在谷底（w₄ w₅ w₆ 的標籤會疊在一起，放到下面又會被 x 軸切掉）：第 4 步之後只標偶數步，其餘的點在下方的逐步數值表裡
      text: range(shown + 1).map((n) => (n >= 4 && n % 2 === 1 ? '' : `$w_{${n}}$`)),
      textposition: 'top right',
      marker: { size: 8, color: tokens.series[1] },
    })
    return traces
  }, [span, c, p, tr, shown, tokens])

  const wPlot = useMemo<Data[]>(
    () => [
      { x: range(p.steps + 1), y: Array.from(tr.w), name: '$w_n$（遞迴）', mode: 'lines+markers', line: { color: tokens.series[0] } },
      { x: range(p.steps + 1), y: closed, name: String.raw`封閉解 $a-(a-w_0)\,p^n$`, mode: 'markers', marker: { symbol: 'circle-open', size: 10, color: tokens.series[2] } },
      { x: [0, p.steps], y: [p.a, p.a], name: '$a$', mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
    ],
    [p, tr, closed, tokens],
  )

  const warnings: string[] = []
  if (p.x === 0) warnings.push(String.raw`$x=0$：$J(w)$ 與 $w$ 無關（$J''=0$），沒有任何關於 $a$ 的資訊——不可辨識（$\lambda_{\min}=x^2=0$）。`)
  else if (Math.abs(pole) >= 1)
    warnings.push(
      String.raw`$|1-\mu J''|=|1-${tn(p.mu)}\times${tn(curv)}|=${tn(Math.abs(pole))}\ge1$：二次成本下 $\delta_{n+1}=(1-\mu J'')\,\delta_n$ ` +
        (Math.abs(pole) > 1 ? '發散' : String.raw`永遠在 $\pm\delta_0$ 之間來回跳（臨界）`) +
        String.raw`（需 $0<\mu<2/J''=${tn(2 / curv)}$）。` +
        (p.cost === 'full' ? String.raw` 注意：用 $J_2=(y-wx)^2$（沒有 $\tfrac12$）時 $J''=2x^2$，同一個 $\mu$ 的步長加倍（勘誤 E41）。` : ''),
    )

  const metrics: MetricRow[] = [
    { name: '$w_1$', value: tr.w[1] ?? NaN, analytic: closed[1], tolerance: 1e-12, toleranceMode: 'abs', formulaId: 'F-02.1', claim: 'exact' },
    ...(p.steps >= 2 ? [{ name: '$w_2$', value: tr.w[2], analytic: closed[2], tolerance: 1e-12, toleranceMode: 'abs' as const, formulaId: 'F-02.1', claim: 'exact' as const }] : []),
    { name: String.raw`曲率 $J''=2c\,x^2$`, value: curv, formulaId: 'F-02.2', note: p.cost === 'half' ? String.raw`$c=\tfrac12$（本站採用，E41）` : String.raw`$c=1$（$J_2$，無 $\tfrac12$）` },
    { name: String.raw`pole $p=1-\mu J''$`, value: pole, formulaId: 'F-02.2', claim: 'exact' },
    { name: String.raw`最佳（Newton）步長 $1/J''$`, value: curv > 0 ? 1 / curv : NaN, formulaId: 'F-02.2' },
    { name: '第一步：切線預測的 $J(w_1)$', value: tr.J[0] + tr.dJ[0] * tr.dw[0], note: String.raw`一階泰勒 $J(w_0)+J'(w_0)\,\Delta$` },
    { name: '第一步：真實 $J(w_1)$', value: tr.J[1] ?? NaN, analytic: tr.J[0] + tr.dJ[0] * tr.dw[0] + 0.5 * curv * tr.dw[0] ** 2, tolerance: 1e-9, toleranceMode: 'rel', note: String.raw`= 切線預測 + $\tfrac12J''\Delta^2$（二次函數三項精確）`, claim: 'exact' },
  ]

  return (
    <ExperimentShell
      id={ID}
      title="切線 → Gradient Descent（固定 $x$、無雜訊）"
      level="L0"
      claim="exact"
      tests={['T01']}
      description={
        <>
          每一步沿切線往下走 <Tex>{String.raw`\Delta=-\mu J'(w_n)`}</Tex>。成本取 <Tex>{String.raw`J=\tfrac12(y-wx)^2`}</Tex> 時這就是 LMS 的 <Tex>{String.raw`w+\mu e x`}</Tex>（與 lms.ts 的 conventionalStep 逐位元相同，並與 T01 golden vector 一致）。
        </>
      }
      assumptions={['固定 $x$、無量測雜訊（$v=0$），所以單筆成本 = 平均成本', String.raw`$\delta=a-w$（全站約定）`, String.raw`成本 $J=\tfrac12(y-wx)^2$（勘誤 E41）；可切到 $J_2=(y-wx)^2$ 觀察步長加倍`]}
      params={{ ...p }}
      units={{ a: '同 y/x', x: '無因次（教學例）', w0: '同 a', mu: '1/[x]^2', steps: 'samples' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: { status: !finiteAll ? 'n/a' : maxErr <= 1e-9 * (1 + Math.abs(p.a)) ? 'ok' : 'mismatch', note: String.raw`遞迴 vs 封閉解 $a-(a-w_0)\,p^n$，最大差 $${tn(maxErr)}$` },
        monteCarlo: { status: 'n/a', note: '確定性（無雜訊）' },
        fixedPoint: 'not-implemented',
      }}
      actions={{
        onReset: () => setP(DEFAULT),
        onStep: () => setP((s) => ({ ...s, steps: Math.min(MAX_STEPS, s.steps + 1) })),
        onRunToConvergence: () => {
          // |δ_n| = |p|ⁿ·|δ₀| ≤ 10⁻⁶·|δ₀| ⇒ n ≥ ln(10⁻⁶)/ln|p|；不收斂（|p| ≥ 1 或 x = 0）時不動，原因見警告
          if (p.x === 0 || Math.abs(pole) >= 1) return
          const need = pole === 0 ? 1 : Math.ceil(Math.log(1e-6) / Math.log(Math.abs(pole)))
          set('steps', Math.max(1, Math.min(MAX_STEPS, need)))
        },
      }}
      exportData={() => ({ n: range(p.steps + 1), w: tr.w, e: tr.e, J: tr.J, dJ: tr.dJ, dw: tr.dw })}
      presets={[...INLINE_PRESETS, ...toShellPresets(presetsForExperiment(ID))]}
      onLoadPreset={(pr) => setP(sanitize(pr.params))}
      controls={
        <>
          <ParamControl {...lab(String.raw`$a$（真實係數）`, 'a（真實係數）')} unit="同 $y/x$" value={p.a} onChange={(v) => set('a', v)} min={-10} max={10} step={0.1} reg="behavioural: true gain a" />
          <ParamControl {...lab(String.raw`$x$（固定輸入）`, 'x（固定輸入）')} unit="無因次" value={p.x} onChange={(v) => set('x', v)} min={-4} max={4} step={0.01} reg="behavioural: regressor x" />
          <ParamControl {...lab(String.raw`$w_0$（初值）`, 'w₀（初值）')} unit="同 $a$" value={p.w0} onChange={(v) => set('w0', v)} min={-10} max={10} step={0.1} reg="REG_W_INIT" />
          <ParamControl {...lab(String.raw`$\mu$（步長）`, 'μ（步長）')} unit="$1/[x]^2$" value={p.mu} onChange={(v) => set('mu', v)} min={1e-4} max={2} log reg="REG_LMS_MU" hint={tm(String.raw`穩定：$0<\mu<2/J''=${tn(curv > 0 ? 2 / curv : Infinity)}$`)} />
          <ParamControl label="步數" unit="samples" value={p.steps} onChange={(v) => set('steps', v)} min={1} max={MAX_STEPS} integer clampOnBlur reg="sim length" hint={tm(String.raw`「單步」每按一次多走一步；「執行至收斂」設成 $|\delta_n|\le10^{-6}|\delta_0|$ 所需的步數`)} />
          <SelectControl
            label="成本的 scaling"
            value={p.cost}
            onChange={(v) => set('cost', v)}
            options={[
              { value: 'half', label: 'J = ½(y − wx)²（本站；梯度 = −ex）' },
              { value: 'full', label: 'J₂ = (y − wx)²（梯度 = −2ex，E41）' },
            ]}
            reg="behavioural: cost scaling"
          />
        </>
      }
    >
      <Plot title="$J(w)$ 與每一步的切線" data={data} height={320} csvName="gd-tangent" layout={{ xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: '$J(w)$' } } }} />
      <Plot title="$w_n$：遞迴 vs 封閉解" data={wPlot} height={260} csvName="gd-w" layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '$w_n$' } } }} />
      <div className="table-wrap">
        <table className="ch02-table">
          <caption className="ch02-note">逐步數值（由上方同一個 gradientDescent() 計算）</caption>
          <thead>
            <tr>
              <th>n</th>
              <th>
                <Tex>{'w_n'}</Tex>
              </th>
              <th>
                <Tex>{'e_n=(a-w_n)x'}</Tex>
              </th>
              <th>
                <Tex>{'J(w_n)'}</Tex>
              </th>
              <th>
                <Tex>{"J'(w_n)"}</Tex>
              </th>
              <th>
                <Tex>{"\\Delta w_n=-\\mu J'"}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {range(Math.min(p.steps, 8) + 1).map((n) => (
              <tr key={n}>
                <td>{n}</td>
                <td className="num">{f4(tr.w[n], 6)}</td>
                <td className="num">{f4(tr.e[n], 6)}</td>
                <td className="num">{f4(tr.J[n], 6)}</td>
                <td className="num">{f4(tr.dJ[n], 6)}</td>
                <td className="num">{f4(tr.dw[n], 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="ch02-try">
        <li>
          試試看：把 <Tex>{'\\mu'}</Tex> 拉到 0.25 —— <Tex>{"\\mu=1/J''"}</Tex>，一步就到 <Tex>{'a'}</Tex>（Newton 步長）。
        </li>
        <li>
          把成本切到 <Tex>{'J_2'}</Tex>：同一個 <Tex>{'\\mu'}</Tex> 的步長變成兩倍，<Tex>{'\\mu=0.3'}</Tex> 就發散（勘誤 E41）。
        </li>
      </ul>
    </ExperimentShell>
  )
}
