import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ExperimentShell, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type MetricRow, ChapterErratum } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { STEP, type TieRule } from '@/simulation/models/lms'
import {
  SCHEDULE_LABEL,
  cycleTail,
  runSignErrorFixedX,
  signErrorLimitCycle,
  stepSize,
  stepsToTravel,
  travelDistance,
  type ScheduleKind,
} from '@/simulation/models/sgd'
import { TIE_LABEL, TIE_MATH, f4, range, tn, toShellPresets, lab } from '../common'

const ID = 'sign-lms-band'

interface P {
  a: number
  x: number
  w0: number
  mu: number
  steps: number
  tie: TieRule
  schedule: ScheduleKind
  n0: number
}

const DEFAULT: P = { a: 3, x: 1, w0: 0, mu: 0.4, steps: 40, tie: 'plus', schedule: 'constant', n0: 20 }
const MAX_STEPS = 5000

function sanitize(p: Record<string, unknown>): P {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    a: num(p.a, DEFAULT.a),
    x: num(p.x, DEFAULT.x),
    w0: num(p.w0, DEFAULT.w0),
    mu: num(p.mu, DEFAULT.mu),
    steps: Math.max(2, Math.min(MAX_STEPS, Math.round(num(p.steps, DEFAULT.steps)))),
    tie: (['zero', 'plus', 'minus'] as const).includes(p.tie as TieRule) ? (p.tie as TieRule) : 'plus',
    schedule: (['constant', 'harmonic', 'gear'] as const).includes(p.schedule as ScheduleKind) ? (p.schedule as ScheduleKind) : 'constant',
    n0: Math.max(1, Math.round(num(p.n0, DEFAULT.n0))),
  }
}

/** 固定步長 Sign-Error 的跳動帶（limit cycle）與遞減步長的修正。 */
export function LimitCycleBand() {
  const [p, setP] = useState<P>(DEFAULT)
  const urlPreset = useUrlPreset(ID)
  useEffect(() => {
    if (urlPreset) setP(sanitize(urlPreset.params))
  }, [urlPreset])
  const tokens = useThemeTokens()
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((s) => ({ ...s, [k]: v }))
  const sched = useMemo(() => ({ kind: p.schedule, n0: p.n0 }), [p.schedule, p.n0])

  const se = useMemo(() => runSignErrorFixedX(p.a, p.x, p.w0, p.steps, p.mu, sched, p.tie), [p, sched])
  // 同一個 x、同一個排程的 LMS（lms.ts 的 conventionalStep）
  const lms = useMemo(() => {
    const w = new Float64Array(p.steps + 1)
    w[0] = p.w0
    for (let n = 0; n < p.steps; n++) w[n + 1] = STEP.conventional({ w: w[n], x: p.x, y: p.a * p.x, mu: stepSize(p.mu, n, sched) }).w
    return w
  }, [p, sched])
  const lc = useMemo(() => signErrorLimitCycle(p.a, p.x, p.w0, p.mu, p.tie), [p.a, p.x, p.w0, p.mu, p.tie])
  const n = useMemo(() => range(p.steps + 1), [p.steps])
  // 第 k 步之後的帶寬 μ_{k−1}|x|（|δ_k| < μ_{k−1}|x| 一旦進入就成立）
  const band = useMemo(() => n.map((k) => stepSize(p.mu, Math.max(0, k - 1), sched) * Math.abs(p.x)), [n, p.mu, p.x, sched])
  const dist = Math.abs(p.a - p.w0)
  const reach = useMemo(() => stepsToTravel(dist, p.mu, Math.abs(p.x), sched, 5_000_000), [dist, p.mu, p.x, sched])
  const canTravel = useMemo(() => travelDistance(p.mu, Math.abs(p.x), sched, p.steps), [p.mu, p.x, sched, p.steps])
  // 週期兩點與時間平均：只取進入週期後、偶數個樣本（period-2 才等權重）
  const tail = useMemo(() => cycleTail(se, lc.entryStep), [se, lc.entryStep])
  const entered = tail.count >= 2

  const wData = useMemo<Data[]>(
    () => [
      { x: n, y: n.map((k) => p.a + band[k]), name: String.raw`$a\pm\mu_n|x|$（跳動帶）`, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 }, legendgroup: 'band' },
      { x: n, y: n.map((k) => p.a - band[k]), name: String.raw`$a-\mu_n|x|$`, showlegend: false, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 }, legendgroup: 'band' },
      { x: [0, p.steps], y: [p.a, p.a], name: '$a$', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } },
      { x: n, y: Array.from(lms), name: String.raw`LMS（$\mu\,e\,x$）`, mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[0] } },
      { x: n, y: Array.from(se), name: String.raw`Sign-Error（$\mu\,\operatorname{sign}(e)\,x$）`, mode: 'lines+markers', marker: { size: 5 }, line: { color: tokens.series[1], shape: 'linear' } },
    ],
    [n, band, p, lms, se, tokens],
  )
  const dData = useMemo<Data[]>(
    () => [
      { x: n, y: n.map((k) => Math.abs(p.a - lms[k])), name: String.raw`$|\delta_n|$ LMS`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: n, y: n.map((k) => Math.abs(p.a - se[k])), name: String.raw`$|\delta_n|$ Sign-Error`, mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[1] } },
      { x: n, y: band, name: String.raw`$\mu_n|x|$`, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot' } },
    ],
    [n, p.a, lms, se, band, tokens],
  )

  const warnings: string[] = []
  if (p.x === 0) warnings.push(String.raw`$x=0$：$\operatorname{sign}(e)\,x\equiv0$，$w$ 永遠不動——沒有任何關於 $a$ 的資訊（不可辨識，$\lambda_{\min}=x^2=0$）。`)
  if (p.x !== 0 && Math.abs(1 - p.mu * p.x * p.x) >= 1 && p.schedule === 'constant')
    warnings.push(
      String.raw`LMS：$|1-\mu x^2|=${tn(Math.abs(1 - p.mu * p.x * p.x))}\ge1$，LMS 在這個 $\mu$ 不收斂（$>1$ 發散、$=1$ 永遠來回跳；需 $0<\mu<2/x^2=${tn(2 / (p.x * p.x))}$）。Sign-Error 的步長 $\mu|x|$ 固定、與誤差大小無關，不會指數發散，只會在 $\pm\mu|x|$ 帶內跳。`,
    )
  if (p.x !== 0 && p.schedule !== 'constant' && reach > p.steps)
    warnings.push(
      String.raw`步長衰減太快（stall）：前 ${p.steps} 步最多只能移動 $\sum_n\mu_n|x|=${tn(canTravel)}$，小於 $|a-w_0|=${tn(dist)}$；` +
        (Number.isFinite(reach) ? `至少需要 ${reach} 步。` : String.raw`在 $5\times10^6$ 步內都走不到。`) +
        String.raw`加大 $n_0$ 或 $\mu_0$（harmonic 排程可移動的距離只隨 $\ln N$ 成長，F-02.11）。`,
    )

  const isConst = p.schedule === 'constant'
  const landed = isConst && lc.exactLanding
  const metrics: MetricRow[] = [
    { name: String.raw`每步移動量 $h=\mu_0|x|$`, value: p.mu * Math.abs(p.x), formulaId: 'F-02.10' },
    ...(isConst && p.x !== 0
      ? ([
          { name: String.raw`進入週期的步數 $n_c=\lfloor|a-w_0|/h\rfloor$`, value: lc.entryStep, formulaId: 'F-02.10' },
          ...(entered
            ? ([
                { name: String.raw`週期下緣 $\min(w_{N-1},w_N)$`, value: tail.lo, analytic: landed ? undefined : lc.lo, tolerance: landed ? undefined : 1e-9, claim: 'exact', formulaId: 'F-02.10' },
                { name: String.raw`週期上緣 $\max(w_{N-1},w_N)$`, value: tail.hi, analytic: landed ? undefined : lc.hi, tolerance: landed ? undefined : 1e-9, claim: 'exact', formulaId: 'F-02.10' },
                {
                  name: '週期的時間平均（進入週期後、偶數個樣本）',
                  value: tail.mean,
                  analytic: landed ? undefined : lc.mean,
                  tolerance: landed ? undefined : 1e-9,
                  claim: 'exact',
                  note:
                    String.raw`${tail.count} 個樣本；解析值 $a+\operatorname{sgn}(\delta_0)(\tfrac h2-\rho)$，偏離 $a$ 的量在 $(-\tfrac h2,\tfrac h2)$ 內` +
                    (landed ? String.raw`；剛好踩到 $a$：解析值依 $\operatorname{sign}(0)$ 與算術而定，見下方說明` : ''),
                },
              ] satisfies MetricRow[])
            : []),
        ] satisfies MetricRow[])
      : []),
    ...(!isConst ? [{ name: String.raw`最終 $|\delta_N|=|a-w_N|$`, value: Math.abs(p.a - se[p.steps]), note: String.raw`最後一步的步長 $\mu_{N-1}|x|=${tn(band[p.steps])}$` }] : []),
    { name: String.raw`走完 $|a-w_0|$ 需要的步數`, value: Number.isFinite(reach) ? reach : '∞（走不到）', formulaId: 'F-02.11' },
  ]
  const seMatches = Math.abs(tail.lo - lc.lo) < 1e-9 && Math.abs(tail.hi - lc.hi) < 1e-9 && Math.abs(tail.mean - lc.mean) < 1e-9
  const analyticCheck: { status: 'ok' | 'mismatch' | 'n/a'; note: string } = !isConst
    ? { status: 'n/a', note: '遞減步長沒有週期解' }
    : p.x === 0
      ? { status: 'n/a', note: '$x=0$：不可辨識' }
      : landed
        ? { status: 'n/a', note: String.raw`剛好踩到 $a$：結果取決於 $\operatorname{sign}(0)$ 與浮點捨入（見下方說明）` }
        : !entered
          ? { status: 'n/a', note: String.raw`尚未進入週期：解析解在第 $n_c=${lc.entryStep}$ 步進入，請把步數設為 $\ge${lc.entryStep + 1}$（或按「執行至收斂」）` }
          : { status: seMatches ? 'ok' : 'mismatch', note: '解析週期（精確算術）vs IEEE 模擬：兩點與時間平均' }

  return (
    <ExperimentShell
      id={ID}
      title="Sign-Error 的跳動帶（limit cycle）與遞減步長"
      level="L0"
      claim="exact"
      description={
        <>
          固定 <Tex>{'x'}</Tex>、無雜訊。Sign-Error 每步移動固定的 <Tex>{'h=\\mu|x|'}</Tex>，進入 <Tex>{'(a-h,a+h)'}</Tex> 之後在兩點間來回跳；遞減步長讓帶寬趨近 0。
        </>
      }
      assumptions={['固定 $x$、無雜訊（$v=0$）', 'IEEE double 模擬（解析解為精確算術）', `tie 慣例：${TIE_MATH[p.tie]}（勘誤 E40）`, String.raw`$\delta=a-w$（全站約定）；帶寬以該步的步長 $\mu_{n-1}|x|$ 計`]}
      params={{ ...p }}
      units={{ a: '同 y/x', x: '無因次', mu: '[w]/[x]（Sign-Error）', n0: 'samples' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: { status: 'n/a', note: '確定性（無雜訊）' },
        fixedPoint: { status: 'not-implemented', note: 'sign-error LMS 的定點 gain register（limit cycle 與 dead zone）尚未在本實驗建模；見 Ch13 與 roadmap R3' },
      }}
      actions={{
        onReset: () => setP(DEFAULT),
        onStep: () => setP((s) => ({ ...s, steps: Math.min(MAX_STEPS, s.steps + 1) })),
        onRunToConvergence: () => {
          // 固定步長：走到進入週期後再多看 12 步；遞減步長：走完 |a − w₀| 所需步數的 4 倍（走不到時設上限，警告會解釋）
          if (p.x === 0) return
          const need = isConst ? lc.entryStep + 12 : Number.isFinite(reach) ? Math.max(50, 4 * reach) : MAX_STEPS
          set('steps', Math.max(2, Math.min(MAX_STEPS, Math.ceil(need))))
        },
      }}
      exportData={() => ({ n, w_sign_error: se, w_lms: lms, band })}
      presets={toShellPresets(presetsForExperiment(ID))}
      onLoadPreset={(pr) => setP(sanitize(pr.params))}
      controls={
        <>
          <ParamControl {...lab(String.raw`$\mu_0$（初始步長）`, 'μ₀（初始步長）')} unit="$[w]/[x]$" value={p.mu} onChange={(v) => set('mu', v)} min={1e-4} max={2} log reg="REG_LMS_MU" />
          <ParamControl {...lab(String.raw`$x$（固定輸入）`, 'x（固定輸入）')} unit="無因次" value={p.x} onChange={(v) => set('x', v)} min={-4} max={4} step={0.01} reg="behavioural: regressor x" />
          <ParamControl {...lab(String.raw`$a$（真實係數）`, 'a（真實係數）')} unit="同 $y/x$" value={p.a} onChange={(v) => set('a', v)} min={-10} max={10} step={0.01} reg="behavioural: true gain a" />
          <ParamControl {...lab(String.raw`$w_0$（初值）`, 'w₀（初值）')} unit="同 $a$" value={p.w0} onChange={(v) => set('w0', v)} min={-10} max={10} step={0.01} reg="REG_W_INIT" />
          <ParamControl {...lab(String.raw`步數 $N$`, '步數 N')} unit="samples" value={p.steps} onChange={(v) => set('steps', v)} min={2} max={MAX_STEPS} integer clampOnBlur reg="sim length" />
          <SelectControl
            {...lab(String.raw`$\operatorname{sign}(0)$ 慣例`, 'sign(0) 慣例')}
            value={p.tie}
            onChange={(v) => set('tie', v)}
            options={(['zero', 'plus', 'minus'] as const).map((t) => ({ value: t, label: TIE_LABEL[t] }))}
            reg="CMP_TIE_POLICY（behavioural）"
          />
          <SelectControl
            label="步長排程"
            value={p.schedule}
            onChange={(v) => set('schedule', v)}
            options={(['constant', 'harmonic', 'gear'] as const).map((s) => ({ value: s, label: SCHEDULE_LABEL[s] }))}
            reg="REG_MU_SCHED（gear-shift FSM）"
          />
          <ParamControl {...lab(String.raw`$n_0$（排程時間常數）`, 'n₀（排程時間常數）')} unit="samples" value={p.n0} onChange={(v) => set('n0', v)} min={1} max={100000} log integer clampOnBlur reg="REG_MU_GEAR_LEN" />
        </>
      }
    >
      <Plot title="$w_n$：LMS vs Sign-Error" data={wData} height={300} csvName="sign-lms-band-w" layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '$w_n$' } } }} />
      <Plot title={String.raw`$|\delta_n|=|a-w_n|$（log）`} data={dData} yLog height={240} csvName="sign-lms-band-delta" layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: String.raw`$|\delta_n|$` } } }} />
      {landed && (
        <Callout kind="warn" title={<>剛好踩到 <Tex>{'w=a'}</Tex>：<Tex>{'\\operatorname{sign}(0)'}</Tex> 的慣例決定結果</>}>
          <Tex>{String.raw`|a-w_0|/h=${f4(Math.abs(p.a - p.w0) / (p.mu * Math.abs(p.x)))}`}</Tex> 是整數：精確算術下第 {lc.entryStep} 步剛好 <Tex>{'e=0'}</Tex>。解析（精確算術）：
          {lc.frozen ? (
            <Tex>{String.raw`\operatorname{sign}(0)=0\Rightarrow w_n=a=${f4(p.a)}\ \text{（凍結）}`}</Tex>
          ) : (
            <Tex>{String.raw`w_n\in\{${f4(lc.lo)},\ ${f4(lc.hi)}\}`}</Tex>
          )}
          。但 IEEE double 的累加誤差可能讓 <Tex>{'e'}</Tex> 變成 <Tex>{'\\pm10^{-16}'}</Tex> 量級而不是 0（模擬最後兩點：{entered ? `${f4(tail.lo, 17)}、${f4(tail.hi, 17)}` : '尚未進入'}）。
          <ChapterErratum id="E40" />
        </Callout>
      )}
      <ul className="ch02-try">
        <li>
          試試看：把 <Tex>{'w_0'}</Tex> 從 0 改成 0.1。<Tex>{'\\rho'}</Tex> 由 0.2 變成 0.1，週期變成 <Tex>{String.raw`\{2.9,\ 3.3\}`}</Tex>，時間平均 <Tex>{'3.1\\neq a'}</Tex>
          ——固定步長的 Sign-Error 連「平均」都不保證對，偏差 <Tex>{String.raw`\tfrac h2-\rho`}</Tex> 由起點決定。
        </li>
        <li>
          把步長排程改成 <Tex>{String.raw`\mu_0/(1+n/n_0)`}</Tex>、步數 400：<Tex>{'|\\delta_n|'}</Tex> 沿著 <Tex>{'\\mu_n|x|'}</Tex> 的虛線一路往下。再把 <Tex>{'\\mu_0'}</Tex> 改成 0.01、<Tex>{'n_0=10'}</Tex>：走不到（stall），警告會算出需要幾步。
        </li>
        <li>
          把 <Tex>{'\\mu_0'}</Tex> 拉到 2（<Tex>{'x=1'}</Tex>）：LMS 的 pole 是 <Tex>{'-1'}</Tex>，永遠在 <Tex>{'\\pm\\delta_0'}</Tex> 之間跳；Sign-Error 只是帶寬變成 2，不會發散。
        </li>
      </ul>
    </ExperimentShell>
  )
}
