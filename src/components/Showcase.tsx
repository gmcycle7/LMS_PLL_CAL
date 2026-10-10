import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  CaseSelector,
  ClaimTag,
  Derivation,
  ExperimentShell,
  Mermaid,
  MetricTable,
  ModelLevel,
  ParamControl,
  Plot,
  Section,
  SelectControl,
  SourceTag,
  Tex,
  TexBlock,
  TestBadge,
  ToggleControl,
  useCases,
  useThemeTokens,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'

/**
 * 元件展示頁（未掛在路由上）：給章節作者參考用法，也用來目視檢查深淺主題與手機版面。
 * 所有曲線都由公式即時計算，沒有手寫資料。
 */

/** 固定 x 的 scalar LMS：w_{n+1} = w_n + μ (a − w_n) x²（規格 §1.2；無雜訊） */
function scalarLms(a: number, w0: number, x: number, mu: number, steps: number): Float64Array {
  const w = new Float64Array(steps + 1)
  w[0] = w0
  for (let n = 0; n < steps; n++) w[n + 1] = w[n] + mu * (a - w[n]) * x * x
  return w
}

/** 一階差分 1 − z⁻¹ 的振幅響應 |H(e^{jω})| = 2|sin(πf/fs)|（f = 0 時為 0 → log 軸需略去） */
function diffMagnitude(fs: number, n: number): { f: number[]; mag: number[] } {
  const f = Array.from({ length: n }, (_, i) => (i / (n - 1)) * (fs / 2))
  return { f, mag: f.map((fi) => 2 * Math.abs(Math.sin((Math.PI * fi) / fs))) }
}

function LmsExperiment() {
  const [params, setParams] = useState({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 20 })
  const [seed, setSeed] = useState(20261010)
  const [frozen, setFrozen] = useState(false)
  const cases = useCases({ mu: 0.1 }, { seed })
  const tokens = useThemeTokens()

  const w = useMemo(() => scalarLms(params.a, params.w0, params.x, params.mu, params.steps), [params])
  const r = 1 - params.mu * params.x * params.x // 誤差收縮因子 δ_{n+1} = r δ_n
  const warnings: string[] = []
  if (Math.abs(r) >= 1) {
    warnings.push(
      `|1 − μx²| = ${Math.abs(r).toFixed(4)} ≥ 1：固定 x 時誤差 δ_{n+1} = (1 − μx²) δ_n 不會收斂（需 0 < μ < 2/x² = ${(2 / (params.x * params.x)).toFixed(4)}）。`,
    )
  }
  const caseTraces: Data[] = cases.cases.map((c) => ({
    x: Array.from({ length: params.steps + 1 }, (_, i) => i),
    y: Array.from(scalarLms(params.a, params.w0, params.x, c.params.mu, params.steps)),
    name: `Case ${c.id}（μ=${c.params.mu}）`,
    line: { color: tokens.series[c.seriesIndex] },
  }))

  return (
    <ExperimentShell
      id="showcase-lms"
      title="LMS Playground（元件展示）"
      level="L0"
      claim="exact"
      tests={['T01', 'T02']}
      description={<>固定 x、無雜訊的 scalar LMS，誤差每步乘上 <Tex>{'1-\\mu x^2'}</Tex>。</>}
      assumptions={['x 固定且已知', '無量測雜訊 v = 0', 'δ = a − w']}
      params={params}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '—', w0: '—', x: '—', mu: '—' }}
      warnings={warnings}
      crossCheck={{ analytic: 'ok', monteCarlo: 'not-implemented', fixedPoint: 'n/a' }}
      metrics={[
        // 解析解：δ_n = (1 − μx²)^n δ_0 → w_n = a − (a − w_0)(1 − μx²)^n（遞迴 vs. 封閉解交叉比對）
        { name: 'w_1', value: w[1], analytic: params.a - (params.a - params.w0) * r, tolerance: 1e-12, toleranceMode: 'rel', formulaId: 'F-1.1', claim: 'exact' },
        { name: 'w_2', value: w[2], analytic: params.a - (params.a - params.w0) * r * r, tolerance: 1e-12, toleranceMode: 'rel', formulaId: 'F-1.1', claim: 'exact' },
        { name: '收縮因子 1 − μx²', value: r },
      ]}
      actions={{ onReset: () => setParams({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 20 }), onFreeze: () => setFrozen((f) => !f), frozen }}
      exportData={() => ({ n: Array.from({ length: w.length }, (_, i) => i), w })}
      presets={[
        { name: '手算例子（規格 §19.2 #1）', params: { a: 3, w0: 1, x: 2, mu: 0.1, steps: 20 } },
        { name: 'μ = 0.6：振盪發散', params: { a: 3, w0: 1, x: 2, mu: 0.6, steps: 20 } },
      ]}
      onLoadPreset={(p) => setParams(p.params as typeof params)}
      controls={
        <>
          <ParamControl label="a（真實係數）" value={params.a} onChange={(a) => setParams({ ...params, a })} min={-10} max={10} step={0.1} />
          <ParamControl label="μ（學習率）" value={params.mu} onChange={(mu) => setParams({ ...params, mu })} min={1e-5} max={1} log reg="REG_LMS_MU[11:0]" hint="穩定條件 0 < μ < 2/x²" />
          <ParamControl label="x" value={params.x} onChange={(x) => setParams({ ...params, x })} min={-4} max={4} step={0.01} clampOnBlur />
          <ParamControl label="步數" value={params.steps} onChange={(steps) => setParams({ ...params, steps })} min={1} max={500} integer clampOnBlur />
        </>
      }
    >
      <Plot
        title="w_n 收斂曲線"
        csvName="lms-w"
        data={[{ x: Array.from({ length: w.length }, (_, i) => i), y: Array.from(w), name: 'w_n', mode: 'lines+markers' }]}
        layout={{ xaxis: { title: { text: 'n' } }, yaxis: { title: { text: 'w_n' } } }}
        height={280}
      />
      <CaseSelector cases={cases} />
      <ParamControl
        label={`Case ${cases.activeId} 的 μ`}
        value={cases.active.params.mu}
        onChange={(mu) => cases.update({ mu })}
        min={1e-4}
        max={0.6}
        log
      />
      <Plot title="Case A / B / C（同 seed）" data={caseTraces} height={260} csvName="lms-cases" />
    </ExperimentShell>
  )
}

function WorkerDemo() {
  const task = useWorkerTask<Record<string, never>, unknown>('notYetImplemented', 'run')
  const [msg, setMsg] = useState('')
  return (
    <div className="card">
      <p className="small">
        Worker 模式：<strong>{task.mode}</strong>（目前沒有任何 model 檔，呼叫不存在的模組應顯示明確錯誤）
      </p>
      <button
        type="button"
        className="btn"
        onClick={() =>
          task.run({}).then(
            (r) => setMsg(JSON.stringify(r)),
            (e: unknown) => setMsg(isWorkerCancelled(e) ? '已取消' : `錯誤：${(e as Error).message}`),
          )
        }
      >
        呼叫 worker
      </button>{' '}
      <span className="small" data-testid="worker-msg">
        {msg}
      </span>
    </div>
  )
}

export default function Showcase() {
  const [mode, setMode] = useState<'a' | 'b'>('a')
  const [on, setOn] = useState(true)
  const { f, mag } = useMemo(() => diffMagnitude(4e9, 257), [])
  return (
    <div>
      <h2>標籤</h2>
      <div className="c-tag-row">
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <ClaimTag kind="research" />
        <ModelLevel level="L1" />
        <ModelLevel level="L4" />
        <SourceTag />
        <SourceTag kind="simulation" />
        <TestBadge id="T01" />
      </div>

      <Section kind="intuition" title="直覺">
        <p>
          LMS 用單筆梯度 <Tex>{'-e_n x_n'}</Tex> 近似平均成本的梯度。
        </p>
      </Section>
      <Section kind="formula" title="公式">
        <TexBlock id="F-1.1" label="LMS 更新式">
          {'\\boxed{w_{n+1}=w_n+\\mu e_n x_n}\\qquad J_2(w)=E[(y-wx)^2]=\\sigma_y^2-2w\\,E[xy]+w^2E[x^2]'}
        </TexBlock>
        <Derivation
          title="由 j_n = ½e_n² 推導"
          formulaId="F-1.1"
          level="L0"
          claim="exact"
          derivation={<TexBlock>{'\\frac{\\partial j_n}{\\partial w}=-e_nx_n\\;\\Rightarrow\\;w_{n+1}=w_n-\\mu\\frac{\\partial j_n}{\\partial w}'}</TexBlock>}
          symbols={[
            { symbol: 'w_n', meaning: '第 n 次的係數估計' },
            { symbol: '\\mu', meaning: '學習率', unit: '依 scaling' },
          ]}
          assumptions={['單筆隨機梯度', 'x 與 v 獨立']}
        />
      </Section>
      <Section kind="diagram" title="圖">
        <Mermaid chart={'flowchart LR\n  DSM[DSM Code] --> DTC --> PD[BBPD / Comparator] --> GMAC --> U[Gain Update] --> DTC'} caption="簡化訊號流（示意）" />
      </Section>
      <Section kind="explore" title="探索">
        <SelectControl label="選項" value={mode} onChange={setMode} options={[{ value: 'a', label: 'A 模式' }, { value: 'b', label: 'B 模式' }]} reg="REG_MODE[0]" />
        <ToggleControl label="Dither" value={on} onChange={setOn} hint="開啟後加入 ±1 LSB dither" />
        <Plot
          title="|1 − z⁻¹| 振幅響應（log–log；f = 0 的 DC 點會被略去）"
          data={[{ x: f, y: mag, name: '|H|' }]}
          xLog
          yLog
          height={260}
          csvName="diff-mag"
          caption="由公式 2|sin(πf/fs)| 計算，fs = 4 GHz"
        />
      </Section>
      <Section kind="assumptions" title="注意假設">
        <Callout kind="info">info 提示</Callout>
        <Callout kind="warn">warn：此近似需 μ 很小</Callout>
        <Callout kind="danger">danger：C ≤ 0 → polarity 錯誤</Callout>
        <Callout kind="ok">ok：T01 通過</Callout>
        <MetricTable rows={[{ name: 'P(q=+1)', value: 0.503989, analytic: 0.5039893563146316, tolerance: 1e-6, formulaId: 'F-5.1', claim: 'approx' }]} />
      </Section>
      <LmsExperiment />
      <WorkerDemo />
    </div>
  )
}
