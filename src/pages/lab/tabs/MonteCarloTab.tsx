import { useMemo } from 'react'
import { Callout, ExperimentShell, ModeGate, ParamControl, Plot, Tex, type MetricRow } from '@/components'
import { combineMc, DEFAULT_LAB_PARAMS, labParamErrors, mcChecks, tQuantile95 } from '@/simulation/models/unifiedLab'
import { md, Progress, sig, StatusPill, texNum } from '../common'
import { EXP, mcCrossCheck, mcFixedPointCheck, mcMetrics, MC_RUN_RANGE } from '../logic'
import { ParamPanel } from '../ParamPanel'
import { LAB_UNITS } from '../paramMeta'
import { useLab } from '../store'
import { figMcEnsemble, figMcHist } from './plots'
import { PresetNote, tw, usePalette, useShellPresets } from './shared'

const ASSUMPTIONS = [
  '每個 run 用不同的 seed：$\\mathrm{seed}_r=\\mathrm{deriveSeed}(\\mathrm{seed},r)$；comparator 雜訊、DSM dither、stochastic rounding 都跟著換，其他參數完全相同',
  '一階 DSM / MASH 的 code 序列本身是 deterministic（不隨 seed 變）：跨 seeds 的散布只來自 comparator 雜訊（與 dither / rounding 亂數）',
  '各 run 互相獨立 ⇒ mean $w$ 的 95% CI 用 Student-$t$（自由度 runs $-1$）；單一 run 內的樣本彼此相關，所以不拿 run 內的樣本數當自由度',
  '$\\sigma_w$：先算每個 run 後半段的樣本變異數 $s_r^2$，跨 runs 平均後開根號（pooled）；CI 來自 $s_r^2$ 的 $t$ 區間',
  '發散比例用 Wilson 區間（比例接近 0 或 1 時仍有意義）',
  '解析預測是 mean-field 平均軌跡（F-LAB.18：把 comparator 的 $\\pm1$ 換成對雜訊的期望值 $\\operatorname{erf}$，其餘逐 block 照算）在「同一段時間」的值，含未衰減完的 transient 與隨 code 擺動的固定點；不是直接拿 $w^*$ 比',
  '開啟定點暫存器時，每一段 seeds 再用 quantize = false 跑一次浮點對照（其餘參數、comparator 雜訊、code 與 dither 都相同）：Fixed-Point 欄比的是每個 seed「定點內部暫存器 $w$ − 浮點 $w$」後半段平均的成對差，跨 seeds 取 Student-$t$ 95% CI，判定 $|\\bar d|\\le1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}$（和 Pipeline 分頁的 floatTwin 同一個判準）；執行時間因此加倍',
]

/** 實驗 'unified-lab-mc'：多 seeds 的 Monte Carlo（runMcChunk，Web Worker 分段、有進度、可取消）與信賴區間。 */
export function MonteCarloTab() {
  const { params, patch, setParams, mc } = useLab()
  const { runs, setRuns, state, running, error, run, cancel } = mc
  const pal = usePalette()
  const { presets, onLoadPreset } = useShellPresets(EXP.mc)

  const errors = useMemo(() => {
    const e = labParamErrors(params)
    if (!(Number.isInteger(runs) && runs >= MC_RUN_RANGE.min && runs <= MC_RUN_RANGE.max)) e.push(`runs 必須是 ${MC_RUN_RANGE.min}–${MC_RUN_RANGE.max} 的整數（至少 2 個 seed 才有信賴區間）`)
    return e
  }, [params, runs])
  const key = JSON.stringify({ base: params, total: runs })
  const stale = state.key !== null && state.key !== key
  const base = state.base

  const summary = useMemo(() => (state.chunks.length > 0 ? combineMc(state.chunks) : null), [state.chunks])
  const an = state.chunks.length > 0 ? state.chunks[0].analytic : null
  // mean-field 平均軌跡由第一段（seed 0）順便算出；沒有時 mcChecks 退回線性時不變模型
  const meanField = useMemo(() => state.chunks.find((c) => c.meanField)?.meanField ?? null, [state.chunks])
  const checks = useMemo(() => (summary && an && base ? mcChecks(summary, an, base, meanField) : null), [summary, an, base, meanField])
  const qz = base ? base.quantize : params.quantize
  // 定點：同 seed 浮點對照的成對比較（store 在每一段後面跑 quantize = false）
  const fpCheck = useMemo(() => (base && base.quantize && state.chunks.length > 0 ? mcFixedPointCheck(state.chunks, state.twinChunks, base.lsbFs) : null), [base, state.chunks, state.twinChunks])

  const warnings = useMemo(() => {
    const w = errors.map((e) => `參數不合法：${e}`)
    if (error) w.push(`Monte Carlo 失敗：${tw(error)}`)
    if (!stale && state.chunks.length > 0) {
      for (const x of state.chunks[0].warnings) w.push(tw(x))
      if (summary && summary.diverged > 0) w.push(`${summary.diverged} / ${summary.runs} 個 runs 數值發散（$|w|>10^{12}\\,\\mathrm{fs}$）：發散的 run 不計入平均與 $\\sigma_w$，只計入發散比例。`)
      if (checks) {
        if (checks.meanW.status === 'mismatch') w.push(`mean $w$ 的信賴區間不含解析預測：${checks.meanW.note}。可能原因：$w$ 的抖動大到 $E[\\operatorname{erf}(\\cdot)]\\ne\\operatorname{erf}(E[\\cdot])$（mean-field 只代入平均值）、定點量化的 dead zone，或名目 95% 的區間本來就有 5% 的機率不含真值（換一個 seed 再看）。`)
        if (checks.sigmaW.status === 'mismatch') w.push(`$\\sigma_w$ 與預測不一致：${checks.sigmaW.note}。可能原因：GMAC 雜訊不是 iid（code 週期與 $N$ 的拍頻）、量化主導，或 transient 還沒結束。`)
      }
      if (fpCheck && fpCheck.status === 'mismatch') w.push(`定點 vs 浮點不一致：${fpCheck.note}`)
    }
    return w
  }, [errors, error, stale, state.chunks, summary, checks, fpCheck])

  const metrics = useMemo<MetricRow[]>(() => {
    const rows = summary && checks && base && an ? mcMetrics(summary, checks.lin, base.aFs, an.sigmaWPred) : []
    if (fpCheck && fpCheck.value !== undefined && fpCheck.tolerance !== undefined) {
      rows.push({ name: '定點 − 浮點：mean $w$ 的成對差（跨 seeds 平均）', value: fpCheck.value, unit: 'fs', analytic: 0, tolerance: fpCheck.tolerance, claim: 'approx', note: '同 seed 的浮點對照；容差 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}$' })
    }
    return rows
  }, [summary, checks, base, an, fpCheck])
  const crossCheck = useMemo(() => mcCrossCheck(stale ? null : checks, qz, stale ? null : fpCheck), [checks, stale, qz, fpCheck])

  const fEns = useMemo(() => (summary && checks && base && summary.valid >= 2 ? figMcEnsemble(summary, checks.lin, base.aFs, pal) : null), [summary, checks, base, pal])
  const fHist = useMemo(() => (summary && checks && summary.perRunMeanW.length >= 4 ? figMcHist(summary, pal, checks.lin.valid ? Math.sqrt(checks.lin.halfRms ** 2 + checks.lin.halfTrajVar) : NaN) : null), [summary, checks, pal])

  return (
    <ExperimentShell
      id={EXP.mc}
      title="Monte Carlo：多個 seeds、信賴區間與有效樣本數"
      level={params.quantize ? 'L5' : 'L2'}
      claim="approx"
      source="simulation"
      tests={['T13']}
      headingLevel={3}
      description={
        <>
          單一 seed 的 mean <Tex>w</Tex> 與 <Tex>{'\\sigma_w'}</Tex> 都帶有抽樣誤差（<Tex>{'w_k'}</Tex> 的相鄰樣本高度相關）。這個分頁用同一組參數跑很多個獨立的 seed，給出跨 seeds 的平均、95% 信賴區間，並與 mean-field 平均軌跡比較。
        </>
      }
      assumptions={ASSUMPTIONS}
      params={{ ...params, mc_runs: runs } as unknown as Record<string, unknown>}
      seed={params.seed}
      onSeedChange={(s) => patch({ seed: s })}
      units={{ ...LAB_UNITS, mc_runs: 'runs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          cancel()
          setParams(DEFAULT_LAB_PARAMS)
          setRuns(16)
        },
        onRun: () => {
          if (errors.length === 0) void run(params, runs)
        },
        onStop: cancel,
        running,
      }}
      exportData={() => {
        if (!summary) throw new Error('還沒有 Monte Carlo 結果（先按 Run）')
        return {
          block_k: Array.from(summary.wMean, (_, k) => k),
          w_mean_fs: summary.wMean,
          w_std_fs: summary.wStd,
          w_linear_model_fs: checks?.lin.traj ?? [],
          run_seed: state.chunks.flatMap((c) => c.seeds),
          run_mean_w_fs: summary.perRunMeanW,
          run_std_w_fs: summary.perRunStdW,
          ...(state.twinChunks.length > 0 ? { float_twin_seed: state.twinChunks.flatMap((c) => c.seeds), float_twin_mean_w_fs: state.twinChunks.flatMap((c) => Array.from(c.meanW)) } : {}),
        }
      }}
      presets={presets}
      onLoadPreset={onLoadPreset}
      controls={
        <>
          <ParamControl
            label="runs（seeds 數）"
            value={runs}
            onChange={(v) => setRuns(Math.round(v))}
            min={MC_RUN_RANGE.min}
            max={MC_RUN_RANGE.max}
            step={1}
            integer
            clampOnBlur
            unit="runs"
            reg="simulation: Monte Carlo runs"
            hint={md(`CI 半寬 $\\propto t_{0.975,R-1}/\\sqrt R$（$R=${runs}$ 時 $t=${texNum(tQuantile95(Math.max(2, runs)), 4)}$）`)}
          />
          <ParamPanel value={params} onChange={patch} open={['gmac', 'update', 'sim']} idPrefix="MC：" />
        </>
      }
    >
      <PresetNote experiment={EXP.mc} />
      {state.total > 0 ? (
        <Progress done={state.done} total={state.total} label={running ? 'Monte Carlo 進行中' : state.done < state.total ? 'Monte Carlo 已停止' : 'Monte Carlo 完成'} />
      ) : (
        <p className="small muted">
          尚未執行：按「執行 Run」。每個 run 的成本與 Pipeline 的迴路部分相同（預設約 0.4 秒），所以 {runs} 個 runs 約 {sig(runs * (params.quantize ? 0.9 : 0.45), 2)} 秒
          {params.quantize ? '（開了定點暫存器：每個 seed 再跑一次浮點對照，時間加倍）' : ''}；可隨時停止，已完成的 runs 會保留。
        </p>
      )}
      {stale && (
        <Callout kind="warn" title="下方是舊設定的結果">
          <p>參數已經改過；按「執行 Run」重新計算。</p>
        </Callout>
      )}
      {summary && checks && (
        <div className={stale ? 'lab-results lab-stale' : 'lab-results'}>
          {fEns && (
            <Plot
              title="跨 seeds 的平均軌跡 $\pm1\sigma$ 與 mean-field 平均軌跡"
              csvName="mc-ensemble"
              data={fEns.data}
              layout={fEns.layout}
              height={320}
              caption={`帶狀區是每個 block 上「跨 seeds」的標準差（不是單一 run 的時間標準差）。mean-field 平均軌跡（F-LAB.18）預測的是這條平均線；穩態後帶寬應接近 $\\sigma_{w,\\mathrm{pred}}$。`}
            />
          )}
          {fHist && <Plot title="每個 seed 的後半段統計：mean $w$（左）與 $\sigma_w$（右）" csvName="mc-hist" data={fHist.data} layout={fHist.layout} height={260} caption="左圖的寬度就是「只跑一個 seed」時 mean $w$ 的不確定度：$\tau$ 越長、後半段越短，它越寬。" />}
          <div className="table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>檢查</th>
                  <th>狀態</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">mean {md('$w$')}</th>
                  <td>
                    <StatusPill status={checks.meanW.status} />
                  </td>
                  <td className="small">{md(checks.meanW.note)}</td>
                </tr>
                <tr>
                  <th scope="row">{md('$\\sigma_w$')}</th>
                  <td>
                    <StatusPill status={checks.sigmaW.status} />
                  </td>
                  <td className="small">{md(checks.sigmaW.note)}</td>
                </tr>
                <tr>
                  <th scope="row">發散</th>
                  <td>
                    <StatusPill status={checks.divergence.status} />
                  </td>
                  <td className="small">{md(checks.divergence.note)}</td>
                </tr>
                {fpCheck && (
                  <tr data-check="fixedPoint" data-status={fpCheck.status}>
                    <th scope="row">定點 vs 浮點</th>
                    <td>
                      <StatusPill status={fpCheck.status} />
                    </td>
                    <td className="small">{md(fpCheck.note)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ModeGate min="research">
            <Callout kind="info" title="Research：這裡的統計在說什麼、沒說什麼">
              <ul className="small">
                <li>
                  {md(
                    `CI 的涵蓋率是名目 95%：跑 20 次不同的 root seed，平均約有 1 次「解析預測落在 CI 外」是正常的，不代表模型錯。所以 mismatch 的第一個動作是換 seed 或增加 runs，再懷疑模型。`,
                  )}
                </li>
                <li>{md('pooled $\\sigma_w$ 的比較另外放寬 $\\pm15\\%$：線性預測假設 GMAC 雜訊 iid、$\\sigma_\\eta^2\\approx E[x_{\\mathrm{ref}}^2]/N$，對週期性 code 只是近似。')}</li>
                <li>{md('deterministic 的 DSM code 不隨 seed 改變：這個 Monte Carlo 沒有涵蓋「不同 FCW 初始相位」或「不同晶片 mismatch」的散布（那是 FCW sweep 與 PVT corner 的工作）。')}</li>
              </ul>
            </Callout>
          </ModeGate>
        </div>
      )}
    </ExperimentShell>
  )
}
