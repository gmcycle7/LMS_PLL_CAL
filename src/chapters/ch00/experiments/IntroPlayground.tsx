import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { CaseSelector, ClaimTag, CodeBlock, ExperimentShell, ModeGate, ParamControl, Plot, Tex, TexBlock, useCases, useThemeTokens, type CaseId, type ExperimentPreset, type MetricRow, ChapterErratum } from '@/components'
import { presetsForExperiment } from '@/app/presets'
import { fixedXMuMax } from '@/simulation/models/lms'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import { closedFormW, expectedCost, poleTable } from '../model'
import { num, texNum, texRes } from '../format'
import { PageLink, TryIt, usePresetVisit, useScrollToExperiment } from '../common'
import {
  DEFAULT_BASE,
  DEFAULT_MUS,
  DIVERGE_LIMIT,
  EXP_ID,
  MIN_VARIANCE_ESS,
  SEED_DEFAULT,
  analyticDecayLine,
  analyticMaxError,
  baseWarnings,
  behaviourLabel,
  caseWarnings,
  deltaPlotScale,
  runCase,
  steadyStateCheck,
  ePlotRange,
  wPlotRange,
  type PlaygroundBase,
} from './playgroundModel'

interface CaseParams {
  mu: number
}

/** 「試試看」裡引用的數字：以預設參數（DEFAULT_BASE）即時計算，不手打。 */
const TRY = (() => {
  const { a, w0, x } = DEFAULT_BASE
  const deadbeatMu = 1 / (x * x)
  const boundaryMu = 2 / (x * x)
  const [osc] = poleTable(x, [0.4])
  return {
    mus: poleTable(x, DEFAULT_MUS),
    deadbeatMu,
    boundaryMu,
    osc,
    bounce: [closedFormW(a, w0, x, boundaryMu, 0), closedFormW(a, w0, x, boundaryMu, 1)],
  }
})()

const NUM_KEYS: (keyof PlaygroundBase)[] = ['a', 'w0', 'x', 'steps', 'sigmaV']

function baseFromPreset(params: Record<string, unknown> | undefined): PlaygroundBase {
  const b = { ...DEFAULT_BASE }
  if (!params) return b
  for (const k of NUM_KEYS) {
    const v = params[k]
    if (typeof v === 'number' && Number.isFinite(v)) b[k] = v
  }
  return b
}

function musFromPreset(params: Record<string, unknown> | undefined): number[] | null {
  if (!params) return null
  const mus = params.mus
  if (Array.isArray(mus) && mus.length > 0 && mus.every((m) => typeof m === 'number' && Number.isFinite(m))) return mus.slice(0, 3) as number[]
  if (typeof params.mu === 'number' && Number.isFinite(params.mu)) return [params.mu]
  return null
}

/** 互動實驗：μ explorer（Case A / B / C 同圖、同 seed），核心為 lms.ts 的 runScalarLms。 */
export function IntroPlayground() {
  const tokens = useThemeTokens()
  const { preset: urlPreset, visit } = usePresetVisit(EXP_ID)
  const appliedVisit = useRef<string | undefined>(visit)
  const [base, setBase] = useState<PlaygroundBase>(() => baseFromPreset(urlPreset?.params))
  const initialMus = musFromPreset(urlPreset?.params) ?? DEFAULT_MUS
  const urlSeed = urlPreset?.params.seed
  const cases = useCases<CaseParams>({ mu: initialMus[0] }, { seed: typeof urlSeed === 'number' ? urlSeed : SEED_DEFAULT })
  // 本章很長：網址帶 ?preset= 時把實驗捲進畫面，讀者才看得到 preset 已套用
  useScrollToExperiment(EXP_ID, visit)
  const [pendingMus, setPendingMus] = useState<number[] | null>(initialMus)
  const [cursor, setCursor] = useState<number | null>(null)
  const [freezeAt, setFreezeAt] = useState<number | null>(null)

  // useCases 只建立 Case A；其餘 case 在 reset 生效後再加入（addCase 需要最新的 state）
  useEffect(() => {
    if (!pendingMus || cases.cases.length !== 1) return
    const ids: CaseId[] = ['A']
    for (let i = 1; i < pendingMus.length; i++) {
      const id = cases.addCase()
      if (id) ids.push(id)
    }
    ids.forEach((id, i) => cases.update({ mu: pendingMus[i] }, id))
    cases.setActive('A')
    setPendingMus(null)
  }, [pendingMus, cases])

  const loadMus = (mus: number[]) => {
    cases.reset({ mu: mus[0] })
    setPendingMus(mus)
  }

  const applyPreset = (params: Record<string, unknown>) => {
    setBase(baseFromPreset(params))
    const mus = musFromPreset(params)
    if (mus) loadMus(mus)
    if (typeof params.seed === 'number') cases.setSeed(params.seed)
    setCursor(null)
    setFreezeAt(null)
  }

  // 網址 ?preset=… 在掛載後才變更時（從 Gallery 或內文連結點進來；同一個連結再點一次也算）也要套用
  useEffect(() => {
    if (urlPreset && appliedVisit.current !== visit) {
      appliedVisit.current = visit
      applyPreset(urlPreset.params)
    }
    // applyPreset 只依賴 setState 函式；以「這一次導覽」（preset id + location.key）為觸發條件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit])

  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(EXP_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )

  // ── 模擬（滑桿拖動時延後重算） ──
  const dBase = useDeferredValue(base)
  const dCases = useDeferredValue(cases.cases)
  const seed = cases.seed
  const runs = useMemo(
    () => dCases.map((c) => ({ id: c.id, seriesIndex: c.seriesIndex, run: runCase(dBase, c.params.mu, seed, freezeAt) })),
    [dBase, dCases, seed, freezeAt],
  )
  const steps = Math.max(1, Math.round(dBase.steps))
  const shown = cursor === null ? steps : Math.min(cursor, steps)
  const active = runs.find((r) => r.id === cases.activeId) ?? runs[0]
  const muMax = fixedXMuMax(dBase.x)

  // ── 警告、指標、交叉比對 ──
  const warnings = useMemo(() => [...baseWarnings(dBase), ...runs.flatMap((r) => caseWarnings(r.id, dBase, r.run))], [dBase, runs])
  const noiseFree = !(dBase.sigmaV > 0)
  const maxErr = useMemo(() => (noiseFree ? analyticMaxError(dBase, runs.map((r) => r.run), freezeAt) : Number.NaN), [noiseFree, dBase, runs, freezeAt])
  const ssChecks = useMemo(() => runs.map((r) => ({ id: r.id, p: r.run.p, check: steadyStateCheck(dBase, r.run, freezeAt) })), [dBase, runs, freezeAt])

  const metrics: MetricRow[] = useMemo(() => {
    const rows: MetricRow[] = [
      {
        name: String.raw`穩定上限 $\mu_{\max}=2/x^2$`,
        value: Number.isFinite(muMax) ? muMax : '不可辨識',
        formulaId: 'F-00.5',
        claim: 'exact',
        note: Number.isFinite(muMax) ? '固定 $x$、無雜訊的精確界限' : '$x=0$：更新量永遠是 0，任何 $\\mu$ 都學不到 $a$，沒有穩定上限可言',
      },
    ]
    for (const r of runs) {
      rows.push({
        name: String.raw`Case ${r.id}：pole $p=1-\mu x^2$（$\mu=${texRes(r.run.mu)}$）`,
        value: r.run.p,
        formulaId: 'F-00.4',
        claim: 'exact',
        note: behaviourLabel(r.run.behaviour),
      })
      rows.push({
        name: String.raw`Case ${r.id}：$|\delta|$ 降到 1% 所需步數`,
        value: Number.isFinite(r.run.n1pct) ? r.run.n1pct : '不收斂',
        claim: 'exact',
        note: noiseFree
          ? String.raw`$n=\lceil\ln0.01/\ln|p|\rceil$`
          : String.raw`$n=\lceil\ln0.01/\ln|p|\rceil$；有雜訊時指平均誤差 $E[\delta_n]=p^n\delta_0$ 降到 1%`,
      })
    }
    if (noiseFree && active) {
      for (const n of [1, 2]) {
        // Freeze 之後 w 不再更新，封閉解不適用
        if (n <= steps && (freezeAt === null || n <= freezeAt) && Number.isFinite(active.run.w[n])) {
          const ref = closedFormW(dBase.a, dBase.w0, dBase.x, active.run.mu, n)
          rows.push({
            name: `Case ${active.id}：$w_{${n}}$`,
            value: active.run.w[n],
            analytic: ref,
            tolerance: 1e-12 * Math.max(1, Math.abs(ref)),
            toleranceMode: 'abs',
            formulaId: 'F-00.6',
            claim: 'exact',
            digits: 10,
            note: String.raw`runScalarLms vs 封閉解 $a-(a-w_0)p^n$`,
          })
        }
      }
    }
    for (const s of ssChecks) {
      if (!s.check) continue
      rows.push({
        name: String.raw`Case ${s.id}：理論穩態 $\operatorname{std}(w_\infty)=\sqrt{\mu\sigma_v^2/(2-\mu x^2)}$`,
        value: s.check.stdTheory,
        formulaId: 'F-00.9',
        claim: 'exact',
      })
      rows.push({
        name: String.raw`Case ${s.id}：模擬的穩態 $\operatorname{std}(w)$（第 ${s.check.start}–${s.check.start + s.check.used - 1} 步）`,
        value: s.check.stdMc,
        analytic: s.check.stdExpected,
        tolerance: (4 * s.check.stdTheory) / Math.sqrt(2 * s.check.ess),
        toleranceMode: 'abs',
        formulaId: 'F-00.9',
        claim: 'approx',
        note: String.raw`單一路徑；相鄰樣本相關（AR(1)，$p=${texRes(s.p, 4)}$），變異數的有效樣本數 $n(1-p^2)/(1+p^2)\approx${texRes(s.check.ess, 4)}$；解析欄已含有限樣本偏差，容忍 4 個標準誤`,
      })
    }
    return rows
  }, [muMax, runs, noiseFree, active, steps, dBase, ssChecks, freezeAt])

  const crossCheck = useMemo(() => {
    const analytic = noiseFree
      ? { status: (maxErr <= 1e-9 ? 'ok' : 'mismatch') as 'ok' | 'mismatch', note: String.raw`runScalarLms 遞迴 vs 封閉解 $a-(a-w_0)p^n$：最大相對差 $${texRes(maxErr, 3)}$` }
      : { status: 'n/a' as const, note: '有雜訊時單一路徑沒有封閉解；改看 Monte Carlo 欄的穩態變異數比對' }
    const done = ssChecks.filter((s) => s.check)
    const monteCarlo =
      noiseFree
        ? { status: 'n/a' as const, note: String.raw`$\sigma_v=0$：沒有隨機性` }
        : done.length === 0
          ? { status: 'n/a' as const, note: String.raw`需要 $\sigma_v>0$、$0<\mu<2/x^2$、未 Freeze、步數 $\ge200$，且穩態段的有效樣本數 $n(1-p^2)/(1+p^2)\ge${MIN_VARIANCE_ESS}$（$|p|$ 接近 1 時——$\mu$ 很小或接近 $2/x^2$——相鄰的 $w$ 高度相關，請增加步數）` }
          : {
              status: (done.every((s) => Math.abs(s.check!.z) < 4) ? 'ok' : 'mismatch') as 'ok' | 'mismatch',
              note:
                done.map((s) => `Case ${s.id}: $z=${texRes(s.check!.z, 3)}$`).join('；') +
                String.raw`（樣本標準差 vs $\sqrt{\mu\sigma_v^2/(2-\mu x^2)}$，以 AR(1) 有效樣本數估計標準誤；$|z|<4$ 視為一致）`,
            }
    return { analytic, monteCarlo, fixedPoint: { status: 'not-implemented' as const, note: 'bit-true 定點版本見 Ch13 / Models 頁' } }
  }, [noiseFree, maxErr, ssChecks])

  // ── 圖 ──
  const nAxis = useMemo(() => Array.from({ length: shown + 1 }, (_, i) => i), [shown])
  const wRange = useMemo(() => wPlotRange(dBase, runs.map((r) => r.run)), [dBase, runs])
  const wData: Data[] = useMemo(() => {
    const traces: Data[] = runs.map((r) => ({
      x: nAxis,
      y: Array.from(r.run.w.subarray(0, shown + 1)),
      name: String.raw`Case ${r.id}（$\mu = ${texRes(r.run.mu)}$）`,
      mode: 'lines+markers',
      marker: { size: 5 },
      line: { color: tokens.series[r.seriesIndex] },
    }))
    traces.push({ x: [0, shown], y: [dBase.a, dBase.a], name: String.raw`真實 $a = ${texRes(dBase.a)}$`, mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } })
    if (freezeAt !== null && freezeAt < steps) {
      traces.push({ x: [freezeAt, freezeAt], y: wRange, name: String.raw`Freeze（$n = ${freezeAt}$）`, mode: 'lines', line: { dash: 'dot', color: tokens.textMuted } })
    }
    return traces
  }, [runs, nAxis, shown, tokens, dBase.a, freezeAt, steps, wRange])

  // |δ_n| 對數圖的縱軸範圍（log10）：下限是雜訊地板或倍精度極限，上限不超過發散門檻
  const deltaScale = useMemo(() => deltaPlotScale(dBase, runs.map((r) => r.run)), [dBase, runs])
  const deltaLayout: Partial<Layout> = useMemo(
    () => ({
      xaxis: { title: { text: '$n$' } },
      yaxis: { title: { text: String.raw`$|\delta_n|$` }, range: [Math.log10(deltaScale.floor), Math.log10(deltaScale.top) + 0.3] },
    }),
    [deltaScale],
  )
  const deltaData: Data[] = useMemo(() => {
    const traces: Data[] = []
    for (const r of runs) {
      const color = tokens.series[r.seriesIndex]
      traces.push({
        x: nAxis,
        y: Array.from(r.run.delta.subarray(0, shown + 1), Math.abs),
        name: String.raw`Case ${r.id} $|\delta_n|$（模擬）`,
        mode: 'lines+markers',
        marker: { size: 4 },
        line: { color },
      })
      // 解析 |δ0|·|p|ⁿ（無雜訊時與模擬完全重合）；只畫落在縱軸範圍內的那一段
      const d0 = Math.abs(dBase.a - dBase.w0)
      const lim = freezeAt !== null ? Math.min(freezeAt, shown) : shown
      const decay = analyticDecayLine(d0, r.run.p, lim, deltaScale)
      traces.push({
        x: decay.n,
        y: decay.y,
        name: String.raw`Case ${r.id} 解析 $|\delta_0|\,|p|^n$`,
        mode: 'lines',
        line: { color, dash: 'dash', width: 1 },
      })
      if (!noiseFree && Number.isFinite(r.run.varTheory) && r.run.varTheory > 0) {
        const sd = Math.sqrt(r.run.varTheory)
        traces.push({ x: [0, shown], y: [sd, sd], name: String.raw`Case ${r.id} 穩態 $\operatorname{std}(w)$`, mode: 'lines', line: { color, dash: 'dot', width: 1 } })
      }
    }
    return traces
  }, [runs, nAxis, shown, tokens, dBase, noiseFree, freezeAt, deltaScale])

  const costData: Data[] = useMemo(() => {
    if (!active) return []
    const [lo, hi] = wRange
    const ws = Array.from({ length: 161 }, (_, i) => lo + ((hi - lo) * i) / 160)
    const path = Array.from(active.run.w.subarray(0, Math.min(shown, 40) + 1)).filter((v) => Number.isFinite(v) && v >= lo && v <= hi)
    return [
      {
        x: ws,
        y: ws.map((w) => expectedCost(dBase.a, w, dBase.x, dBase.sigmaV)),
        name: String.raw`$J(w) = \tfrac12\,E[(y - w\,x)^2]$`,
        mode: 'lines',
        line: { color: tokens.textMuted },
      },
      {
        x: path,
        y: path.map((w) => expectedCost(dBase.a, w, dBase.x, dBase.sigmaV)),
        name: String.raw`Case ${active.id} 的 $w_n$ 路徑`,
        mode: 'lines+markers',
        marker: { size: 7 },
        line: { color: tokens.series[active.seriesIndex] },
      },
    ]
  }, [active, wRange, shown, dBase, tokens])

  // e_n 圖：模擬的 e_n 與解析平均 E[e_n] = x·(a − w0)·pⁿ（無雜訊時兩者重合）
  const eRange = useMemo(() => ePlotRange(dBase, runs.map((r) => r.run)), [dBase, runs])
  const eData: Data[] = useMemo(() => {
    const traces: Data[] = []
    const nE = Math.min(shown, steps)
    const idx = nAxis.slice(0, nE)
    for (const r of runs) {
      const color = tokens.series[r.seriesIndex]
      traces.push({
        x: idx,
        y: Array.from(r.run.e.subarray(0, nE)),
        name: String.raw`Case ${r.id} $e_n$（模擬）`,
        mode: 'lines+markers',
        marker: { size: 4 },
        line: { color },
      })
      const lim = freezeAt !== null ? Math.min(freezeAt, nE) : nE
      // 發散的 Case：解析線只畫到與模擬相同的發散門檻為止（不把 1e300 / Infinity 丟進圖與 CSV）
      const eMax = DIVERGE_LIMIT * Math.max(1, Math.abs(dBase.x))
      const eTheory = idx.slice(0, lim).map((n) => dBase.x * (dBase.a - dBase.w0) * Math.pow(r.run.p, n))
      const cut = eTheory.findIndex((v) => !(Math.abs(v) <= eMax))
      const nKeep = cut < 0 ? eTheory.length : cut
      traces.push({
        x: idx.slice(0, nKeep),
        y: eTheory.slice(0, nKeep),
        name: String.raw`Case ${r.id} 解析 $E[e_n] = x\,(a - w_0)\,p^n$`,
        mode: 'lines',
        line: { color, dash: 'dash', width: 1 },
      })
    }
    return traces
  }, [runs, nAxis, shown, steps, tokens, dBase, freezeAt])

  // 版面物件要 memo：只有縱軸／橫軸範圍真的改變時才換新參照（否則 Plot 每次 render 都會重畫並重設縮放）
  const wLayout: Partial<Layout> = useMemo(
    () => ({ xaxis: { title: { text: '$n$（第幾筆資料）' } }, yaxis: { title: { text: '$w_n$' }, range: wRange } }),
    [wRange],
  )
  const eLayout: Partial<Layout> = useMemo(
    () => ({ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '$e_n = y_n - w_n\\,x$' }, range: eRange } }),
    [eRange],
  )
  const costLayout: Partial<Layout> = useMemo(() => ({ xaxis: { title: { text: '$w$' }, range: wRange }, yaxis: { title: { text: '$J(w)$' } } }), [wRange])

  // 目前這一步的更新公式（代入數字）：完整模式顯示 n = 0，單步模式顯示剛剛執行的那一步
  const live = useMemo(() => {
    if (!active) return null
    const n = cursor === null ? 0 : Math.max(0, Math.min(shown, steps) - 1)
    const w = active.run.w[n]
    const wNext = active.run.w[n + 1]
    if (n >= active.run.e.length || !Number.isFinite(w) || !Number.isFinite(wNext)) return null
    const muEff = freezeAt !== null && n >= freezeAt ? 0 : active.run.mu
    return { n, w, wNext, e: active.run.e[n], y: active.run.y[n], muEff, id: active.id }
  }, [active, cursor, shown, steps, freezeAt])

  // ── 動作 ──
  const actions = {
    onReset: () => {
      setBase(DEFAULT_BASE)
      loadMus(DEFAULT_MUS)
      cases.setSeed(SEED_DEFAULT)
      setCursor(null)
      setFreezeAt(null)
    },
    onStep: () => setCursor((c) => (c === null || c >= steps ? 1 : c + 1)),
    onRunToConvergence: () => {
      const need = Math.max(10, ...runs.map((r) => (Number.isFinite(r.run.n1pct) && r.run.mu > 0 ? r.run.n1pct : 0)))
      setBase((b) => ({ ...b, steps: Math.min(2000, Math.max(b.steps, need + 5)) }))
      setCursor(null)
    },
    onFreeze: () => setFreezeAt((f) => (f === null ? (cursor ?? Math.floor(steps / 2)) : null)),
    frozen: freezeAt !== null,
  }

  const params = useMemo(
    () => ({
      a: base.a,
      w0: base.w0,
      x: base.x,
      steps: base.steps,
      sigma_v: base.sigmaV,
      ...Object.fromEntries(cases.cases.map((c) => [`mu_${c.id}`, c.params.mu])),
      freeze_at: freezeAt,
      step_cursor: cursor,
    }),
    [base, cases.cases, freezeAt, cursor],
  )

  const exportData = () => {
    const cols: Record<string, ArrayLike<number>> = { n: Array.from({ length: steps + 1 }, (_, i) => i) }
    for (const r of runs) {
      cols[`w_${r.id}`] = r.run.w
      cols[`delta_${r.id}`] = r.run.delta
      cols[`e_${r.id}`] = r.run.e
      cols[`y_${r.id}`] = r.run.y
    }
    return cols
  }

  const setB = (patch: Partial<PlaygroundBase>) => setBase((b) => ({ ...b, ...patch }))
  // 更新表：完整模式顯示前 8 列；單步模式顯示到目前步數為止的最後 8 列
  const tableEnd = cursor === null ? Math.min(8, steps) : shown
  const tableStart = Math.max(0, tableEnd - 8)
  const tableRows = active ? Array.from({ length: tableEnd - tableStart }, (_, i) => tableStart + i) : []

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`LMS Playground：$\mu$ 太小、剛好、太大會怎樣？`}
      level="L0"
      claim="exact"
      source="simulation"
      tests={['T01', 'T02']}
      description={
        <>
          固定 <Tex>{'x'}</Tex> 的純量 LMS（可加量測雜訊 <Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>），每個 Case 只差在{' '}
          <Tex>{'\\mu'}</Tex>，共用同一個 seed（paired comparison）。核心模擬是 <code>lms.ts</code> 的 <code>runScalarLms</code>。
        </>
      }
      assumptions={[
        String.raw`$y=a\,x+v$，$x$ 固定（每一步相同）`,
        String.raw`$v$ 為 iid 零均值 Gaussian（$\sigma_v=0$ 時無雜訊）`,
        String.raw`參數誤差 $\delta=a-w$（勘誤 E39）`,
        String.raw`Freeze：從指定步數起 $\mu=0$；之後的誤差用派生 seed 的雜訊（與前段不重複）`,
        String.raw`$|w|>10^{12}$ 視為發散並停止模擬`,
      ]}
      params={params}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ a: '無因次（教學例）', w0: '同 a', x: '無因次', mu: '無因次（[w]/([e][x])）', sigma_v: '同 y', steps: 'samples' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={actions}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <>
          <ParamControl
            label={
              <>
                <Tex>{'a'}</Tex>（黑盒子的真實參數）
              </>
            }
            ariaLabel="a（黑盒子的真實參數）"
            value={base.a}
            onChange={(a) => setB({ a })}
            min={-10}
            max={10}
            step={0.1}
            unit="—"
            reg="Behavioral: a_true（真實 DTC gain）"
          />
          <ParamControl
            label={
              <>
                <Tex>{'w_0'}</Tex>（初始猜測）
              </>
            }
            ariaLabel="w0（初始猜測）"
            value={base.w0}
            onChange={(w0) => setB({ w0 })}
            min={-10}
            max={10}
            step={0.1}
            unit="—"
            reg="REG_GAIN_INIT（w 初值）"
          />
          <ParamControl
            label={
              <>
                <Tex>{'x'}</Tex>（固定輸入）
              </>
            }
            ariaLabel="x（固定輸入）"
            value={base.x}
            onChange={(x) => setB({ x })}
            min={-4}
            max={4}
            step={0.01}
            unit="—"
            reg="Behavioral: x（regressor / DSM code）"
            hint={
              <>
                <Tex>{'x=0'}</Tex> 時學不到任何東西（不可辨識）
              </>
            }
          />
          <ParamControl
            label={
              <>
                <Tex>{'\\sigma_v'}</Tex>（量測雜訊 RMS）
              </>
            }
            ariaLabel="sigma_v（量測雜訊 RMS）"
            value={base.sigmaV}
            onChange={(sigmaV) => setB({ sigmaV })}
            min={0}
            max={2}
            step={0.01}
            unit="同 $y$"
            reg="Behavioral: sigma_v（PD / comparator 前雜訊）"
            hint={
              <>
                雜訊的典型大小（標準差，§0.7 會解釋）；第一次玩先保持 <Tex>{'0'}</Tex>
              </>
            }
          />
          <ParamControl
            label="步數（模擬長度）"
            value={base.steps}
            onChange={(s) => setB({ steps: s })}
            min={1}
            max={2000}
            integer
            clampOnBlur
            unit="samples"
            reg="Behavioral: sim_steps"
          />
          <CaseSelector cases={cases} label="學習率比較組" />
          <ParamControl
            label={
              <>
                Case {cases.activeId} 的 <Tex>{'\\mu'}</Tex>（學習率）
              </>
            }
            ariaLabel={`Case ${cases.activeId} 的 mu（學習率）`}
            value={cases.active.params.mu}
            onChange={(mu) => cases.update({ mu })}
            min={-0.2}
            max={1}
            step={0.001}
            digits={6}
            unit="—"
            reg="REG_LMS_MU（學習率；硬體常為 2^-k 右移）"
            hint={
              Number.isFinite(muMax) ? (
                <>
                  理論穩定區 <Tex>{`0<\\mu<2/x^2=${texNum(muMax)}`}</Tex>
                </>
              ) : (
                <>
                  <Tex>{'x=0'}</Tex>：沒有穩定區可言（不可辨識）
                </>
              )
            }
          />
        </>
      }
    >
      {cursor !== null && (
        <p className="small muted">
          單步模式：目前顯示到第 {shown} 步，也就是 <Tex>{`n=0,\\dots,${shown}`}</Tex>（按「單步 Step」前進；「重設」回到完整顯示）。
        </p>
      )}
      {freezeAt !== null && freezeAt < steps && (
        <p className="small muted">
          已在第 {freezeAt} 步 Freeze：之後 <Tex>{'\\mu=0'}</Tex>，<Tex>{'w'}</Tex> 停住（硬體上就是停止更新 gain register）。
        </p>
      )}
      <Plot
        title="$w_n$：每一步的猜測"
        ariaLabel="w_n：每一步的猜測"
        csvName="intro-playground-w"
        data={wData}
        layout={wLayout}
        height={300}
      />
      <p className="ch00-plot-note">
        縱軸固定在 <Tex>{'a'}</Tex> 附近；發散的 Case 會衝出畫面——看下面的對數圖就能看到它每一步放大 <Tex>{'|p|'}</Tex> 倍。
      </p>
      {live && (
        <div className="ch00-live">
          <div className="small muted">
            Case {live.id} 的第 <Tex>{`n=${live.n}`}</Tex> 步，代入數字（由模擬結果即時填入）：
          </div>
          <TexBlock>{String.raw`e_{${live.n}}=y_{${live.n}}-w_{${live.n}}x=${texNum(live.y)}-${texNum(live.w)}\times${texNum(dBase.x)}=${texRes(live.e)}`}</TexBlock>
          <TexBlock>
            {String.raw`w_{${live.n + 1}}=w_{${live.n}}+\mu\,e_{${live.n}}\,x=${texNum(live.w)}+${texNum(live.muEff)}\times${texNum(live.e)}\times${texNum(dBase.x)}=${texRes(live.wNext)}`}
          </TexBlock>
        </div>
      )}
      <Plot
        title="$e_n$：每一步的預測誤差"
        ariaLabel="e_n：每一步的預測誤差"
        csvName="intro-playground-e"
        data={eData}
        layout={eLayout}
        height={260}
        caption={
          <>
            實線：<code>runScalarLms</code> 回傳的 <Tex>{'e_n'}</Tex>；虛線：解析平均 <Tex>{'E[e_n]=x\\,E[\\delta_n]=x\\,(a-w_0)\\,p^n'}</Tex>
            （無雜訊時兩者重合）。誤差的正負號告訴 LMS 往哪修、大小決定修多少。
          </>
        }
      />
      <Plot
        title={String.raw`$|\delta_n|=|a-w_n|$（對數縱軸）`}
        ariaLabel="|δ_n| = |a − w_n|（對數縱軸）"
        csvName="intro-playground-delta"
        data={deltaData}
        layout={deltaLayout}
        yLog
        height={300}
        caption={
          <>
            實線：<code>runScalarLms</code> 模擬的 <Tex>{'|\\delta_n|=|a-w_n|'}</Tex>；虛線：解析 <Tex>{'|\\delta_0|\\,|p|^n'}</Tex>（無雜訊時兩者重合，在對數軸上是一條斜率{' '}
            <Tex>{'\\log_{10}|p|'}</Tex> 的直線）；點線：有雜訊時的理論穩態 <Tex>{'\\operatorname{std}(w_\\infty)=\\sqrt{\\mu\\sigma_v^2/(2-\\mu x^2)}'}</Tex>。縱軸下限取雜訊地板（最小理論 std 的 <Tex>{'1/30'}</Tex>）或倍精度極限（約 <Tex>{'10^{-17}'}</Tex>）；解析線只畫到離開這個範圍為止。
          </>
        }
      />
      <Plot
        title={`成本曲線 $J(w)$ 與 Case ${active?.id ?? 'A'} 的路徑`}
        ariaLabel={`成本曲線 J(w) 與 Case ${active?.id ?? 'A'} 的路徑`}
        csvName="intro-playground-cost"
        data={costData}
        layout={costLayout}
        height={280}
        caption={
          <>
            <Tex>{'J(w)=\\tfrac12E[(y-wx)^2]=\\tfrac12\\big[(a-w)^2x^2+\\sigma_v^2\\big]'}</Tex> 含 <Tex>{'\\tfrac12'}</Tex>（<ChapterErratum id="E41" />），所以斜率{' '}
            <Tex>{'dJ/dw=-(a-w)x^2=-E[e\\,x]'}</Tex> 與實際更新量 <Tex>{'\\mu\\,e\\,x'}</Tex> 用同一個 scaling。<Tex>{'\\mu'}</Tex> 太大時路徑會在谷底兩側來回跳。
          </>
        }
      />

      {active && tableRows.length > 0 && (
        <>
          <h4>
            更新表（Case {active.id}，<Tex>{`\\mu=${num(active.run.mu)}`}</Tex>）
          </h4>
          <div className="table-wrap">
            <table className="ch00-num-table">
              <thead>
                <tr>
                  <th className="num">
                    <Tex>{'n'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'y_n'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'w_n'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'e_n'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'\\Delta w_n'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'w_{n+1}'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'\\delta_{n+1}=a-w_{n+1}'}</Tex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((n) => (
                  <tr key={n} className={cursor !== null && n === shown - 1 ? 'is-current' : undefined}>
                    <td className="num">{n}</td>
                    <td className="num">{num(active.run.y[n], 5)}</td>
                    <td className="num">{num(active.run.w[n], 6)}</td>
                    <td className="num">{num(active.run.e[n], 5)}</td>
                    <td className="num">{num(active.run.w[n + 1] - active.run.w[n], 5)}</td>
                    <td className="num">{num(active.run.w[n + 1], 6)}</td>
                    <td className="num">{num(active.run.delta[n + 1], 5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <TryIt
        items={[
          <>
            載入三組預設（Case A/B/C 的 <Tex>{`\\mu=${TRY.mus.map((r) => texNum(r.mu)).join('/')}`}</Tex>）：pole 分別是{' '}
            <Tex>{TRY.mus.map((r) => texRes(r.p)).join(',\\ ')}</Tex>。A 慢慢爬、B 約 <Tex>{String(TRY.mus[1].n1pct)}</Tex> 步誤差就剩 1%、C 每一步跳到另一邊而且越跳越遠。
          </>,
          <>
            把某個 Case 的 <Tex>{'\\mu'}</Tex> 設成 <Tex>{`1/x^2=${texNum(TRY.deadbeatMu)}`}</Tex>：<Tex>{'p=0'}</Tex>，一步就到答案（deadbeat）。
          </>,
          <>
            <Tex>{`\\mu=${texNum(TRY.osc.mu)}`}</Tex>：<Tex>{`p=${texRes(TRY.osc.p)}`}</Tex>，<Tex>{'w'}</Tex> 在 <Tex>{'a'}</Tex> 的兩側來回跳但仍收斂——「穩定」不代表「不震盪」。
          </>,
          <>
            <Tex>{`\\mu=2/x^2=${texNum(TRY.boundaryMu)}`}</Tex>：<Tex>{'p=-1'}</Tex>，<Tex>{'w'}</Tex> 永遠在 <Tex>{`${texNum(TRY.bounce[0])}`}</Tex> 和{' '}
            <Tex>{`${texNum(TRY.bounce[1])}`}</Tex> 之間跳；<Tex>{'\\mu<0'}</Tex>：往錯的方向走（polarity 錯誤）。
          </>,
          <>
            把 <Tex>{'\\sigma_v'}</Tex> 調到 0.5、步數 2000：<Tex>{'w'}</Tex> 不再停在 <Tex>{'a'}</Tex>，而是在附近抖動；<Tex>{'\\mu'}</Tex> 越小抖得越少但越慢（點線是理論穩態 std；Monte Carlo 欄會比對）。
          </>,
          <>
            <Tex>{'x'}</Tex> 改成 0：任何 <Tex>{'\\mu'}</Tex> 都學不到（警告會說明原因）。
          </>,
        ]}
      />
      <p className="small">
        <ClaimTag kind="exact" /> 固定 <Tex>{'x'}</Tex>、無雜訊時，pole <Tex>{'p=1-\\mu x^2'}</Tex> 與 <Tex>{'0<\\mu<2/x^2'}</Tex> 是精確結論。若 <Tex>{'x'}</Tex> 每一步隨機變化，就要分成「平均收斂」「均方收斂」與「樣本路徑（almost-sure）收斂」三種不同的界限（見{' '}
        <PageLink id="ch03" />，<ChapterErratum id="E14" />），不能直接套用。
      </p>
      <ModeGate min="engineer">
        <CodeBlock
          source={lmsSrc}
          region="runScalarLms"
          path="src/simulation/models/lms.ts"
          caption="本實驗每個 Case 呼叫一次 runScalarLms（variant = 'conventional'、$x$ 固定）；所有 LMS 變體共用同一個迴圈，只換 STEP[variant]。"
        />
      </ModeGate>
    </ExperimentShell>
  )
}
