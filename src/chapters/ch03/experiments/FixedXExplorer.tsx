import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  Tex,
  useCases,
  useThemeTokens,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { fixedXMuMax, fixedXPole, runScalarLms } from '@/simulation/models/lms'
import { stepsToReach, timeConstant } from '@/simulation/models/scalarStability'
import { mergeParams, num, T, texText, tnum, tx } from '../common'
import { poleLabelTex } from '../poleLabel'

export const FIXED_X_EXPERIMENT = 'stability-fixed-x'

export interface FixedXParams {
  /** 真實參數 a */
  a: number
  /** 初始估計 w_0（δ_0 = a − w_0） */
  w0: number
  /** 固定輸入 x */
  x: number
  /** 學習率 μ */
  mu: number
  /** 迭代步數 */
  steps: number
}

// 圖內文字的數學一律寫 `$…$`（Plot 轉成斜體符號與上下標）
const DELTA_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: T`$\delta_n$` } } }
const ABS_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: T`$|\delta_n|$` } } }

export const DEFAULT_FIXED_X: FixedXParams = { a: 3, w0: 1, x: 2, mu: 0.1, steps: 20 }

export interface FixedXCaseResult {
  n: number[]
  /** runScalarLms 實際迭代的 δ_n = a − w_n */
  delta: number[]
  /** 封閉式 p^n δ_0 */
  closed: number[]
  p: number
  /** max_n |δ_sim − δ_closed| / max(1, |δ_closed|) */
  maxRelDev: number
  w: number[]
  /** runScalarLms 的 e_n = y − w_n·x（長度 steps；n = 0…steps−1） */
  e: number[]
}

/** 固定 x 的一個 case：同時算模擬（遞迴）與封閉式，供交叉比對。 */
export function computeFixedXCase(c: FixedXParams): FixedXCaseResult {
  const r = runScalarLms({ variant: 'conventional', a: c.a, w0: c.w0, mu: c.mu, steps: c.steps, x: { kind: 'fixed', value: c.x } })
  const p = fixedXPole(c.mu, c.x)
  const d0 = c.a - c.w0
  const n = Array.from({ length: c.steps + 1 }, (_, i) => i)
  const closed = n.map((k) => d0 * Math.pow(p, k))
  const delta = Array.from(r.delta)
  let maxRelDev = 0
  for (let k = 0; k <= c.steps; k++) {
    if (!Number.isFinite(delta[k])) continue // runScalarLms 在 |w| > 1e12 時停止並填 NaN
    maxRelDev = Math.max(maxRelDev, Math.abs(delta[k] - closed[k]) / Math.max(1, Math.abs(closed[k])))
  }
  return { n, delta, closed, p, maxRelDev, w: Array.from(r.w), e: Array.from(r.e) }
}

function warningsFor(id: string, c: FixedXParams, p: number): string[] {
  const out: string[] = []
  const tag = `Case ${id}：`
  // 警告字串中的數學以 `$…$` 標示（ExperimentShell 以 KaTeX 顯示；數字用 tnum → ASCII 負號）
  if (c.x === 0) {
    out.push(String.raw`${tag}$x = 0$：$e_n \equiv 0$，$w$ 永遠不動（$p = 1$）。這不是「穩定」，而是沒有激勵、$a$ 不可辨識（第 9 章 Persistent Excitation）。`)
    return out
  }
  if (c.mu < 0) {
    out.push(String.raw`${tag}$\mu = ${tnum(c.mu)} < 0$：更新方向反了（等同極性反轉），$p = 1-\mu x^2 = ${tnum(p)} > 1$，誤差單調發散。`)
  } else if (c.mu === 0) {
    out.push(String.raw`${tag}$\mu = 0$：不更新，$p = 1$，$\delta$ 永遠停在 $\delta_0$。`)
  } else if (Math.abs(Math.abs(p) - 1) < 1e-12) {
    out.push(String.raw`${tag}$|p| = 1$（$\mu = 2/x^2 = ${tnum(fixedXMuMax(c.x))}$）：邊界情況，$|\delta_n|$ 不變、正負交替，不會收斂到 0。`)
  } else if (Math.abs(p) > 1) {
    out.push(
      String.raw`${tag}$|p| = |1-\mu x^2| = ${tnum(Math.abs(p))} > 1$：$\mu = ${tnum(c.mu)}$ 超過固定 $x$ 的穩定上限 $2/x^2 = ${tnum(fixedXMuMax(c.x))}$，每步把誤差放大 $${tnum(Math.abs(p))}$ 倍並${p < 0 ? '變號（震盪發散）' : '同號（單調發散）'}。`,
    )
  }
  return out
}

/** 誤差降到 ε·|δ_0| 所需步數 n_ε = ⌈ln ε / ln|p|⌉（F-03.4）：實作在模型檔（core:timeConstant），「帶入手算」HC-03.2 用的是同一個函式。 */
export { stepsToReach }

const TABLE_ROWS = 12

/** 更新表：目前 case 的前幾步（w_n、e_n、δ_n 與封閉式），配合「單步 Step」一列一列出現 */
function UpdateTable({ r, visible, caseId }: { r: FixedXCaseResult; visible: number; caseId: string }) {
  const last = Math.min(visible, TABLE_ROWS)
  const rows = r.n.slice(0, last + 1)
  return (
    <div className="table-wrap">
      <table className="ch03-num" aria-label={`Case ${caseId} 的逐步更新表`}>
        <caption className="small muted">
          {tx`Case ${caseId} 更新表（顯示 $n=0\dots${last}$${visible > TABLE_ROWS ? `；只列前 ${TABLE_ROWS} 步，完整資料請匯出 CSV` : ''}）。每一列：先算 $e_n$，再更新 $w_{n+1}=w_n+\mu e_nx$。`}
        </caption>
        <thead>
          <tr>
            <th>
              <Tex>n</Tex>
            </th>
            <th>
              <Tex>{T`w_n`}</Tex>
            </th>
            <th>
              <Tex>{T`e_n=(a-w_n)x`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_n=a-w_n`}</Tex>（模擬）
            </th>
            <th>
              <Tex>{T`\delta_0\,p^n`}</Tex>（封閉式）
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n}>
              <td>{n}</td>
              <td>{num(r.w[n], 6)}</td>
              <td>{n < r.e.length ? num(r.e[n], 6) : '—'}</td>
              <td>{num(r.delta[n], 6)}</td>
              <td>{num(r.closed[n], 6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 規格 §3 固定 x 實驗（T02）：A/B/C 三組 μ / x 並排，模擬與封閉式交叉比對；可單步、執行至收斂。 */
export function FixedXExplorer() {
  const tokens = useThemeTokens()
  const cases = useCases<FixedXParams>(DEFAULT_FIXED_X)
  const presets = useMemo(() => presetsForExperiment(FIXED_X_EXPERIMENT), [])
  const urlPreset = useUrlPreset(FIXED_X_EXPERIMENT)
  const { reset } = cases
  useEffect(() => {
    if (urlPreset) reset(mergeParams(DEFAULT_FIXED_X, urlPreset.params))
  }, [urlPreset, reset])

  // 單步模式：shown = 目前顯示到第幾步（null = 全部顯示）
  const [shown, setShown] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const results = useMemo(() => cases.cases.map((c) => ({ c, r: computeFixedXCase(c.params) })), [cases.cases])
  const active = results.find((x) => x.c.id === cases.activeId) ?? results[0]
  const ap = active.c.params
  const p = active.r.p
  const absP = Math.abs(p)
  // p = 0（deadbeat）：τ = 0、一步到位；|p| ≥ 1：不收斂（NaN 顯示為 —）
  const tau = timeConstant(p)
  const n3 = stepsToReach(p, 1e-3)
  const maxSteps = Math.max(...results.map((x) => x.c.params.steps))
  const stepping = shown !== null && shown < maxSteps
  /** 某個 case 目前顯示的最後一步 */
  const visibleOf = (steps: number) => (shown === null ? steps : Math.min(shown, steps))
  const warnings = results.flatMap(({ c, r }) => warningsFor(c.id, c.params, r.p))
  const worstDev = Math.max(...results.map((x) => x.r.maxRelDev))

  const metrics: MetricRow[] = [
    { name: String.raw`pole $p = 1-\mu x^2$`, value: p, formulaId: 'F-03.2', claim: 'exact', note: poleLabelTex(p) },
    { name: String.raw`穩定上限 $2/x^2$`, value: fixedXMuMax(ap.x), formulaId: 'F-03.3', claim: 'exact' },
    { name: String.raw`一步到位 $\mu = 1/x^2$`, value: ap.x === 0 ? NaN : 1 / (ap.x * ap.x), formulaId: 'F-03.3', claim: 'exact' },
    { name: String.raw`時間常數 $\tau = -1/\ln|p|$`, value: tau, unit: 'samples', formulaId: 'F-03.4', claim: 'exact' },
    { name: String.raw`降到 $10^{-3}$ 所需步數`, value: n3, unit: 'samples', formulaId: 'F-03.4', claim: 'exact' },
    {
      name: '$w_1$（模擬）',
      value: active.r.w[1] ?? NaN,
      analytic: ap.a - (ap.a - ap.w0) * p,
      tolerance: 1e-12,
      toleranceMode: 'rel',
      formulaId: 'F-03.2',
      claim: 'exact',
    },
    {
      name: '$w_2$（模擬）',
      value: active.r.w[2] ?? NaN,
      analytic: ap.a - (ap.a - ap.w0) * p * p,
      tolerance: 1e-12,
      toleranceMode: 'rel',
      formulaId: 'F-03.2',
      claim: 'exact',
    },
    { name: '遞迴 vs 封閉式最大相對差', value: worstDev, analytic: 0, tolerance: 1e-9, note: String.raw`所有 case；runScalarLms 實際迭代 vs $\delta_0p^n$` },
  ]

  const deltaData = useMemo<Data[]>(
    () =>
      results.map(({ c, r }) => {
        const k = (shown === null ? c.params.steps : Math.min(shown, c.params.steps)) + 1 // 單步模式只畫到目前這一步
        return {
          x: r.n.slice(0, k),
          y: r.delta.slice(0, k).map((v) => (Number.isFinite(v) ? v : null)),
          name: T`Case ${c.id}：$\mu=${tnum(c.params.mu)}$, $x=${tnum(c.params.x)}$（$p=${tnum(r.p, 3)}$）`,
          mode: 'lines+markers',
          line: { color: tokens.series[c.seriesIndex], width: 2 },
          marker: { size: 6 },
        }
      }),
    [results, tokens, shown],
  )
  const absData = useMemo<Data[]>(
    () =>
      results.flatMap(({ c, r }) => {
        const k = (shown === null ? c.params.steps : Math.min(shown, c.params.steps)) + 1
        return [
          {
            x: r.n.slice(0, k),
            y: r.delta.slice(0, k).map((v) => (Number.isFinite(v) ? Math.abs(v) : null)),
            name: T`Case ${c.id} 模擬 $|\delta_n|$`,
            mode: 'markers',
            marker: { size: 7, color: tokens.series[c.seriesIndex] },
          } as Data,
          {
            x: r.n, // 封閉式是「預測」：單步模式下也畫完整條線，讓模擬的點一步一步落在線上
            y: r.closed.map((v) => Math.abs(v)),
            name: T`Case ${c.id} 封閉式 $|\delta_0| \cdot |p|^n$`,
            mode: 'lines',
            line: { color: tokens.series[c.seriesIndex], width: 1.5, dash: 'dot' },
          } as Data,
        ]
      }),
    [results, tokens, shown],
  )
  const zData = useMemo<Data[]>(() => {
    const th = Array.from({ length: 361 }, (_, i) => (i * Math.PI) / 180)
    return [
      { x: th.map(Math.cos), y: th.map(Math.sin), mode: 'lines', name: '$|z| = 1$', line: { color: tokens.textMuted, width: 1.5, dash: 'dot' }, hoverinfo: 'skip' },
      ...results.map(
        ({ c, r }) =>
          ({
            x: [r.p],
            y: [0],
            mode: 'markers',
            name: T`Case ${c.id}：$p = ${tnum(r.p, 4)}$`,
            marker: { size: 13, symbol: 'x', color: tokens.series[c.seriesIndex], line: { width: 2, color: tokens.series[c.seriesIndex] } },
          }) as Data,
      ),
    ]
  }, [results, tokens])
  const maxAbsP = Math.max(1.3, ...results.map((x) => Math.abs(x.r.p) + 0.2))
  const zLayout = useMemo<Partial<Layout>>(
    () => ({
      xaxis: { title: { text: T`$\mathrm{Re}\,z$` }, range: [-maxAbsP, maxAbsP], zeroline: true },
      yaxis: { title: { text: T`$\mathrm{Im}\,z$` }, range: [-1.25, 1.25], scaleanchor: 'x', zeroline: true },
    }),
    [maxAbsP],
  )

  const set = (patch: Partial<FixedXParams>) => {
    setNote(null)
    cases.update(patch)
  }
  // 單步：第一次按從 n = 1 開始，之後每按一次多走一步；走到底就回到「全部顯示」
  const onStep = () => {
    setNote(null)
    setShown((s) => {
      const next = s === null ? 1 : s + 1
      return next >= maxSteps ? null : next
    })
  }
  const onRun = () => {
    setNote(null)
    setShown(null)
  }
  // 執行至收斂：把步數設為 n_ε（ε = 10⁻³）；|p| ≥ 1 時解釋為什麼做不到
  const onRunToConvergence = () => {
    setShown(null)
    // note 以 `$…$` 標示數學，顯示時由 texText 轉成 KaTeX
    if (ap.x === 0) return setNote(String.raw`Case ${active.c.id}：$x=0$，沒有激勵（$p=1$），誤差永遠停在 $\delta_0$，無法收斂。`)
    if (!Number.isFinite(n3))
      return setNote(
        String.raw`Case ${active.c.id}：$|p|=${tnum(absP)}\ge1$，誤差不會收斂到 0，無法「執行至收斂」。請把 $\mu$ 調到 $0<\mu<2/x^2=${tnum(fixedXMuMax(ap.x))}$ 之內。`,
      )
    const steps = Math.min(200, Math.max(1, n3))
    setNote(
      String.raw`執行至收斂（Case ${active.c.id}）：$|\delta_n|\le10^{-3}|\delta_0|$ 需要 $\lceil\ln10^{-3}/\ln|p|\rceil=$ ${n3} 步${steps < n3 ? `，超過本實驗上限，步數設為 ${steps}` : `，已把步數設為 ${steps}`}。`,
    )
    cases.update({ steps })
  }

  return (
    <ExperimentShell
      id={FIXED_X_EXPERIMENT}
      title="Fixed-x Pole Explorer（固定輸入的 LMS pole）"
      level="L0"
      claim="exact"
      tests={['T02']}
      description={
        <>
          無雜訊、固定 <Tex>x</Tex>：<Tex>{T`\delta_{n+1}=(1-\mu x^2)\delta_n`}</Tex>。圖中的點是 LMS 程式實際迭代，虛線是封閉式 <Tex>{T`\delta_0p^n`}</Tex>。
        </>
      }
      assumptions={['$x$ 固定且已知（退化分布）', '無量測雜訊 $v = 0$', '$\\delta = a - w$（全站極性，勘誤 E39）', '浮點雙精度，無量化（L0）']}
      params={{ ...ap, case: cases.activeId, cases: cases.cases.length }}
      units={{ a: '—（正規化）', w0: '—', x: '—', mu: '1/[x]^2', steps: 'samples' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: worstDev < 1e-9 ? 'ok' : 'mismatch', note: `遞迴 vs 封閉式最大相對差 ${num(worstDev, 3)}` },
        monteCarlo: { status: 'n/a', note: '固定 $x$、無雜訊：沒有隨機性（隨機 $x$ 見 Stability Lab）' },
        fixedPoint: { status: 'not-implemented', note: '定點量化見第 13 章' },
      }}
      actions={{
        onReset: () => {
          setShown(null)
          setNote(null)
          cases.reset(DEFAULT_FIXED_X)
        },
        onStep,
        onRun,
        onRunToConvergence,
      }}
      exportData={() => {
        const cols: Record<string, number[]> = { n: results[0].r.n }
        for (const { c, r } of results) {
          cols[`delta_sim_${c.id}`] = r.delta
          cols[`delta_closed_${c.id}`] = r.closed
        }
        return cols
      }}
      presets={presets.map((pr) => ({ id: pr.id, name: pr.title, params: pr.params, description: pr.description }))}
      onLoadPreset={(pr) => {
        setShown(null)
        setNote(null)
        cases.update(mergeParams(ap, pr.params))
      }}
      controls={
        <>
          <CaseSelector cases={cases} />
          <ParamControl
            label={T`$\mu$（Case ${cases.activeId}）`}
            value={ap.mu}
            onChange={(mu) => set({ mu })}
            min={-0.2}
            max={1.2}
            step={0.001}
            unit={T`$1/[x]^2$`}
            reg="LMS_MU（behavioral）"
            hint={<Tex>{T`\text{穩定：}0<\mu<2/x^2=${tnum(fixedXMuMax(ap.x))}`}</Tex>}
          />
          <ParamControl label="$x$（固定輸入）" value={ap.x} onChange={(x) => set({ x })} min={-4} max={4} step={0.01} unit="$[x]$" reg="DTC code（正規化，固定）" />
          <ParamControl label="$a$（真實參數）" value={ap.a} onChange={(a) => set({ a })} min={-10} max={10} step={0.1} unit="—（正規化）" reg="真實 DTC gain（未知）" />
          <ParamControl label="$w_0$（初始估計）" value={ap.w0} onChange={(w0) => set({ w0 })} min={-10} max={10} step={0.1} unit="—（正規化）" reg="REG_GAIN 初值" hint={<Tex>{T`\delta_0=a-w_0=${tnum(ap.a - ap.w0)}`}</Tex>} />
          <ParamControl label="步數 $N$" value={ap.steps} onChange={(steps) => set({ steps })} min={1} max={200} integer clampOnBlur unit="samples" reg="模擬長度（behavioral）" />
        </>
      }
    >
      <p className="ch03-running" role="status">
        {stepping
          ? `單步模式：目前顯示到第 ${shown} 步（共 ${maxSteps} 步）。再按「單步 Step」前進一步；按「執行 Run」顯示全部。`
          : '顯示全部步數。按「單步 Step」可從第 1 步開始一步一步看更新；「執行至收斂」會把步數設成誤差降到千分之一所需的步數。'}
      </p>
      {note && (
        <p className="ch03-note" role="status">
          {texText(note)}
        </p>
      )}
      <UpdateTable r={active.r} visible={visibleOf(ap.steps)} caseId={active.c.id} />
      <div className="ch03-plots">
        <Plot title={String.raw`$\delta_n = a - w_n$（各 case）`} ariaLabel="各 case 的參數誤差（真實值減估計值）對步數" data={deltaData} height={300} csvName="ch03-fx-delta" layout={DELTA_LAYOUT} />
        <Plot title={String.raw`$|\delta_n|$：模擬（點）vs 封閉式（虛線）`} ariaLabel="參數誤差的大小：模擬（點）與封閉式（虛線）" data={absData} yLog height={300} csvName="ch03-fx-absdelta" layout={ABS_LAYOUT} />
      </div>
      <Plot title="$z$ 平面上的 pole" ariaLabel="z 平面上的 pole" data={zData} layout={zLayout} height={300} csvName="ch03-fx-poles" />
    </ExperimentShell>
  )
}
