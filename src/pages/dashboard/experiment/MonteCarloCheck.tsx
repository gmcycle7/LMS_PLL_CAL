import { useCallback, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, CodeBlock, ModeGate, ModelLevel, Plot, SourceTag, Tex, useThemeTokens, type CaseId, type CheckEntry } from '@/components'
import { useWorkerTask } from '@/workers'
import type { BlockLmsConfigInput, BlockLmsMonteCarloResult } from '@/simulation/models/blockLms'
import bridgeSrc from '../mcBridge.ts?raw'
import {
  MC_CI_LEVEL,
  MC_GAIN_TRUE_FS,
  MC_MODEL_TOL,
  MC_PARAM_MAP,
  analyticOverlay,
  compareMonteCarlo,
  planMonteCarlo,
  productTex,
  type McComparison,
  type McPlan,
} from '../mcBridge'
import type { ThesisResult } from '../thesisModel'
import { Rich, StateIcon, withAlpha } from '../ui'

const BRIDGE_PATH = 'src/pages/dashboard/mcBridge.ts'
const f = (x: number, d = 4) => (Number.isFinite(x) ? Number(x.toPrecision(d)).toString() : Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞')

export interface McOutcome {
  comparison: McComparison
  /** 跨 seeds 的 w_k 平均與標準差（長度 numBlocks + 1）[fs] */
  wMean: Float64Array
  wStd: Float64Array
  /** 共用模型自己發出的警告（例如 'C ≤ 0：更新極性錯誤…'） */
  warnings: string[]
  numBlocks: number
  runs: number
  durationMs: number | null
}

export interface MonteCarloCheck {
  plan: McPlan
  /** 目前參數 + seed 的結果；參數改變後為 undefined（不會把舊結果當成新的） */
  outcome: McOutcome | undefined
  /** 曾經跑過、但目前參數沒有對應結果 */
  stale: boolean
  run: () => void
  cancel: () => void
  running: boolean
  error: Error | null
  mode: 'worker' | 'inline'
  /** 給 ExperimentShell 的交叉比對欄位 */
  check: CheckEntry
}

interface McParams {
  config: BlockLmsConfigInput
  runs: number
}

/**
 * 以全站共用的 block Sign-LMS 模型（Web Worker）對目前 case 做 Monte Carlo，並與解析值比較。
 * 結果以「設定指紋」為 key 保存：切換 Case A/B/C 可以看回各自的結果，改了參數就必須重跑。
 */
export function useMonteCarloCheck(r: ThesisResult, seed: number): MonteCarloCheck {
  const task = useWorkerTask<McParams, BlockLmsMonteCarloResult>('blockLms', 'runBlockLmsMonteCarlo', { restartOnRun: true })
  const plan = useMemo(() => planMonteCarlo(r, seed), [r, seed])
  const [store, setStore] = useState<Record<string, McOutcome>>({})
  const { run: runTask, cancel, running, error, mode } = task

  const run = useCallback(() => {
    if (!plan.ok) return
    const started = typeof performance !== 'undefined' ? performance.now() : 0
    runTask({ config: plan.config, runs: plan.runs })
      .then((mc) => {
        const outcome: McOutcome = {
          comparison: compareMonteCarlo(r, plan, mc),
          wMean: mc.wMean,
          wStd: mc.wStd,
          warnings: mc.warnings,
          numBlocks: plan.numBlocks,
          runs: plan.runs,
          durationMs: typeof performance !== 'undefined' ? performance.now() - started : null,
        }
        // 只保留最近幾組（Case A/B/C 各一組綽綽有餘）
        setStore((s) => Object.fromEntries([...Object.entries(s).filter(([k]) => k !== plan.key).slice(-5), [plan.key, outcome]]))
      })
      .catch(() => {
        // 取消（WorkerCancelledError）不是錯誤；其他錯誤（例如設定驗證失敗）已由 useWorkerTask 記在 task.error、顯示於面板。
        // 這裡只需接住 rejection，避免 unhandled rejection。
      })
  }, [plan, r, runTask])

  const outcome = plan.ok ? store[plan.key] : undefined
  const stale = !outcome && Object.keys(store).length > 0
  const check: CheckEntry = !plan.ok
    ? { status: 'n/a', note: plan.reason }
    : outcome
      ? { status: outcome.comparison.status, note: outcome.comparison.note }
      : { status: 'n/a', note: running ? 'Monte Carlo 執行中…' : stale ? '參數或 seed 已變更：請重新按「執行 Run」' : '尚未執行：按「執行 Run」以 sample-level Sign-LMS 模擬比對' }
  return { plan, outcome, stale, run, cancel, running, error, mode, check }
}

/** Monte Carlo 交叉比對面板：說明、執行按鈕、解析 vs MC 表格、疊圖、參數對照與核心程式碼。 */
export function MonteCarloPanel({ mc, r, caseId, seriesIndex, seed }: { mc: MonteCarloCheck; r: ThesisResult; caseId: CaseId; seriesIndex: number; seed: number }) {
  const tokens = useThemeTokens()
  const { plan, outcome } = mc

  const plotData = useMemo<Data[]>(() => {
    if (!outcome) return []
    const K = outcome.numBlocks
    const an = analyticOverlay(r, K)
    const step = Math.max(1, Math.ceil(K / 1200))
    const xs: number[] = []
    const aMean: number[] = []
    const aUp: number[] = []
    const aLo: number[] = []
    const mMean: number[] = []
    const mUp: number[] = []
    const mLo: number[] = []
    for (let k = 0; k <= K; k += step) {
      xs.push(k)
      aMean.push(an.mean[k])
      aUp.push(an.mean[k] + an.sd[k])
      aLo.push(an.mean[k] - an.sd[k])
      const m = outcome.wMean[k] - MC_GAIN_TRUE_FS
      mMean.push(m)
      mUp.push(m + outcome.wStd[k])
      mLo.push(m - outcome.wStd[k])
    }
    const cA = tokens.series[seriesIndex] ?? tokens.accent
    const cM = tokens.series[(seriesIndex + 3) % tokens.series.length] ?? tokens.textMuted
    return [
      { x: xs, y: aUp, type: 'scatter', mode: 'lines', line: { width: 0, color: cA }, hoverinfo: 'skip', showlegend: false },
      { x: xs, y: aLo, type: 'scatter', mode: 'lines', line: { width: 0, color: cA }, fill: 'tonexty', fillcolor: withAlpha(cA, 0.16), hoverinfo: 'skip', showlegend: false },
      { x: xs, y: aMean, type: 'scatter', mode: 'lines', line: { width: 2, color: cA }, name: '解析：$E[w_k - a]$（陰影 $\\pm1\\sigma$）' },
      { x: xs, y: mMean, type: 'scatter', mode: 'lines', line: { width: 1.5, color: cM }, name: `Monte Carlo：${outcome.runs} seeds 平均` },
      { x: xs, y: mUp, type: 'scatter', mode: 'lines', line: { width: 1, dash: 'dot', color: cM }, name: 'Monte Carlo：平均 $\\pm$ 跨 seed 標準差' },
      { x: xs, y: mLo, type: 'scatter', mode: 'lines', line: { width: 1, dash: 'dot', color: cM }, showlegend: false },
    ]
  }, [outcome, r, tokens, seriesIndex])
  const layout = useMemo(() => ({ xaxis: { title: { text: 'GMAC block $k$' } }, yaxis: { title: { text: '$w_k - a$ [fs]' } } }), [])

  return (
    <section className="dash-mc" aria-labelledby="dash-mc-h">
      <h4 id="dash-mc-h" style={{ marginBottom: 4 }}>
        Monte Carlo 交叉比對：真正的 sample-level Sign-LMS（Case {caseId}） <ModelLevel level="L2" />
      </h4>
      <p className="small">
        上面的燈號來自<strong>線性化的解析模型</strong>。這裡把同一組參數交給全站共用的 block Sign-LMS 模擬器（Calibration Lab 用的同一份程式），逐 sample 產生
        <Tex>{'q[n]=\\mathrm{sign}(e[n])'}</Tex>、累加 GMAC、更新係數，重複多個 seed，再看兩邊是否一致。計算在 Web Worker 進行，不會卡住頁面。
      </p>

      {!plan.ok ? (
        <Callout kind="warn" title="這組參數無法在這裡做 Monte Carlo">
          <Rich text={plan.reason} />
        </Callout>
      ) : (
        <>
          <div className="dash-mc-bar">
            {mc.running ? (
              <button type="button" className="btn" onClick={mc.cancel}>
                停止
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={mc.run}>
                {outcome ? '重新執行 Monte Carlo' : '執行 Monte Carlo'}
              </button>
            )}
            <span className="small muted">
              {plan.runs} 個 seed、每個 seed {plan.numBlocks} 個 block、<Tex>{`N=${r.params.N}`}</Tex>：共{' '}
              <Rich text={productTex([plan.runs, plan.numBlocks, r.params.N])} /> 個 sample；seed 為 {seed}
              {plan.expectStable ? (
                <>
                  ；時間常數 <Tex>{`\\tau=-1/\\ln\\max|z|=${f(plan.tauBlocks, 3)}`}</Tex> blocks
                  {r.params.d >= 1 ? '（有 commit 延遲時是漸近值）' : ''}，後半段 {plan.lateBlocks} blocks 用來做統計
                </>
              ) : (
                '；解析模型預測不收斂，改為檢查 Monte Carlo 是否也沒有收斂'
              )}
            </span>
          </div>
          {plan.notes.map((n) => (
            <p key={n} className="small muted" style={{ margin: '4px 0' }}>
              ※ <Rich text={n} />
            </p>
          ))}
          {mc.running && (
            <p className="small" role="status">
              <span className="c-spinner" aria-hidden="true" /> Monte Carlo 執行中（{mc.mode === 'worker' ? 'Web Worker' : '主執行緒'}）…
            </p>
          )}
          {mc.error && (
            <Callout kind="danger" title="Monte Carlo 執行失敗">
              {mc.error.message}
            </Callout>
          )}
          {!outcome && !mc.running && mc.stale && (
            <Callout kind="info" title={null}>
              參數或 seed 已變更：先前的 Monte Carlo 結果不適用於目前的設定，請重新執行。
            </Callout>
          )}
        </>
      )}

      {outcome && (
        <>
          <div className="dash-mc-verdict" data-status={outcome.comparison.status}>
            <StateIcon state={outcome.comparison.status === 'ok' ? 'ok' : 'fail'} label={outcome.comparison.status === 'ok' ? '一致' : '不一致'} />
            <span>
              <strong>{outcome.comparison.status === 'ok' ? '解析模型與 Monte Carlo 一致' : '解析模型與 Monte Carlo 不一致'}</strong>：
              <Rich text={outcome.comparison.note} />。{' '}
              <SourceTag kind="simulation" />
              {outcome.durationMs !== null && <span className="small muted">（{f(outcome.durationMs / 1000, 3)} s）</span>}
            </span>
          </div>
          <div className="table-wrap">
            <table className="dash-mc-table">
              <thead>
                <tr>
                  <th>指標</th>
                  <th className="num">解析（線性化）</th>
                  <th className="num">Monte Carlo</th>
                  <th className="num">{Math.round(MC_CI_LEVEL * 100)}% CI</th>
                  <th>判定規則</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {outcome.comparison.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Rich text={row.name} />
                    </td>
                    <td className="num">{row.analyticText ?? `${f(row.analytic)} ${row.unit}`}</td>
                    <td className="num">
                      {f(row.mc)} {row.unit}
                    </td>
                    <td className="num nowrap">
                      [{f(row.lo)}, {f(row.hi)}]
                    </td>
                    <td className="small">
                      <Rich text={row.criterion} />
                    </td>
                    <td>
                      <StateIcon state={row.pass ? 'ok' : 'fail'} label={row.pass ? '一致' : '不一致'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            信賴區間是跨 {outcome.runs} 個獨立 seed 的 Student-t 區間；解析值本身是近似（線性化、<Tex>{'q'}</Tex> 近似 iid），所以另外容許{' '}
            {Math.round(MC_MODEL_TOL * 100)}% 的模型誤差。
            {outcome.comparison.kind === 'not-converged' && (
              <>
                {' '}
                線性模型說「指數發散」，但 Sign-LMS 每個 block 的 <Tex>{'|G_k|'}</Tex> 有上限，真實行為是等速漂移或被 comparator
                飽和限制住的大振幅振盪——兩者都代表校正失敗。
              </>
            )}
            {outcome.comparison.divergedRuns > 0 && ` 其中 ${outcome.comparison.divergedRuns} 個 seed 數值發散。`}
          </p>
          {outcome.warnings.length > 0 && (
            <details className="dash-details">
              <summary>模擬器自己發出的警告（{outcome.warnings.length}）</summary>
              <ul className="dash-details-body small">
                {outcome.warnings.map((w) => (
                  <li key={w}>
                    <Rich text={w} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Plot
            title={`Case ${caseId}：解析模型 vs Monte Carlo（$B=0$）`}
            ariaLabel={`Case ${caseId}：解析模型與 Monte Carlo 的平均 gain 誤差與正負一個標準差帶（B 設為 0）`}
            csvName="dashboard-thesis-montecarlo"
            data={plotData}
            layout={layout}
            height={300}
            caption={String.raw`實線與陰影：解析的平均與 $\pm1\sigma$（從 0 開始累積的 variance）。細線與點線：Monte Carlo 跨 seed 的平均與 $\pm1$ 標準差。兩組帶寬一致，代表 $\sigma_w$ 的公式抓到了真實的係數雜訊。`}
          />
        </>
      )}

      <ModeGate min="engineer" summary="參數怎麼對應到模擬器（規格 §15.3 的 JSON）與核心程式碼">
        <details className="dash-details">
          <summary>參數怎麼對應到模擬器（規格 §15.3 的 JSON）與核心程式碼</summary>
          <div className="dash-details-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>本頁符號</th>
                    <th>模擬器欄位</th>
                    <th>說明</th>
                  </tr>
                </thead>
                <tbody>
                  {MC_PARAM_MAP.map((m) => (
                    <tr key={m.json}>
                      <td>
                        <Tex>{m.tex}</Tex>
                      </td>
                      <td>
                        <code>{m.json}</code>
                      </td>
                      <td className="small">
                        <Rich text={m.note} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock source={bridgeSrc} region="toBlockLmsConfig" path={BRIDGE_PATH} title="toBlockLmsConfig：體檢參數 → block Sign-LMS 設定" />
            <ModeGate min="research" summary="compareMonteCarlo 的核心程式碼（信賴區間加模型容許誤差的判定）">
              <CodeBlock
                source={bridgeSrc}
                region="compareMonteCarlo"
                path={BRIDGE_PATH}
                title="compareMonteCarlo：統計信賴區間 + 模型容許誤差的判定"
                caption={String.raw`$\sigma_w$ 用繞著已知固定點 $a$ 的均方誤差估計（不是樣本標準差），避免相關樣本造成的低估。`}
              />
            </ModeGate>
          </div>
        </details>
      </ModeGate>
    </section>
  )
}
