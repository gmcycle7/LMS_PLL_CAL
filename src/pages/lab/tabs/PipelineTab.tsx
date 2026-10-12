import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  APP_VERSION,
  Callout,
  ClaimTag,
  downloadText,
  ExperimentShell,
  fileTimestamp,
  GIT_COMMIT,
  MetricTable,
  ModeGate,
  ModelLevel,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  useDebouncedValue,
  type CrossCheck,
  type MetricRow,
} from '@/components'
import { DEFAULT_LAB_PARAMS, convergenceBlocks, labParamErrors, type LabParams, type PipelineResult, type ToneReport } from '@/simulation/models/unifiedLab'
import { fmtHz, md, sig, StatusPill, texHz, texNum } from '../common'
import { AUTO_RUN_MAX_SAMPLES, buildLabReport, collectWarnings, EXP, isInformational, labKey, pipelineCrossCheck, pipelineExport, pipelineMetrics } from '../logic'
import { ParamPanel } from '../ParamPanel'
import { LAB_UNITS } from '../paramMeta'
import { useLab, type LabAnalysis } from '../store'
import { figCode, figError, figG, figPsd, figTransfer, figW, type PsdUnit, type SampleView } from './plots'
import { PresetNote, tw, usePalette, useShellPresets } from './shared'
import { CheckTable, QuantWhatIf, StageCards } from './StageCards'

const BASE_ASSUMPTIONS = [
  '時間單位 fs；code 正規化後無因次；$a$、$w$ 的單位為 fs per unit code；極性 $\\delta=a-w$',
  '$f_s=f_{\\mathrm{ref}}$：每個 DSM sample 對應一個 DTC code、一個 comparator sample（多速率未建模）',
  'DTC 在 reference 輸入端，回授路徑只有 divider；comparator 取 PD 的輸出 $u_{\\mathrm{pd}}=H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}$（送進 loop filter 的同一個訊號）',
  '主 PLL 為線性、時不變的離散時間模型；$T=1-H_{\\mathrm{PD}}$',
  'comparator 前雜訊 $v[n]$ 為 iid Gaussian，與 code 獨立',
  '輸出端只含 DTC 殘差這一個雜訊來源（VCO / reference / PD 自身雜訊未計）',
  '（按 Run 之後這裡會換成該次模擬實際採用的完整假設清單）',
]

const NOT_RUN: CrossCheck = {
  analytic: { status: 'n/a', note: '尚未執行模擬' },
  monteCarlo: { status: 'n/a', note: '尚未執行模擬' },
  fixedPoint: { status: 'n/a', note: '尚未執行模擬' },
}

/** 即時解析（analyzeLab，不跑迴路）的指標 */
function previewRows(a: LabAnalysis): MetricRow[] {
  const an = a.analytic
  return [
    { name: '$f_{\\mathrm{out}}$', value: a.fOutHz, unit: 'Hz', claim: 'exact', formulaId: 'F-LAB.1' },
    { name: '$C=E[x_{\\mathrm{ref}}u_x]$', value: an.Cest, claim: 'approx', formulaId: 'F-LAB.6' },
    { name: '$K_q=\\sqrt{2/\\pi}/\\sigma_v$', value: an.Kq, unit: '$\\mathrm{fs}^{-1}$', claim: 'approx', formulaId: 'F-LAB.5' },
    { name: '$g=\\mu K$', value: an.g, claim: 'approx', formulaId: 'F-LAB.7', note: `臨界值 $g_{\\mathrm{crit}}=${texNum(an.gCritical)}$` },
    { name: '$\\rho$（含更新延遲）', value: an.rhoMean, claim: 'exact', formulaId: 'F-LAB.7' },
    { name: '$\\tau$', value: an.tauBlocks, unit: 'block', claim: 'exact' },
    { name: '$\\mathrm{PM}_{\\mathrm{cal}}$', value: an.pmDeg, unit: 'deg', claim: 'exact' },
    { name: '$\\sigma_{w,\\mathrm{pred}}$', value: an.sigmaWPred, unit: 'fs', claim: 'approx', formulaId: 'F-LAB.8' },
    { name: '$w^*$（mean-field 固定點）', value: an.wStarMeanField, unit: 'fs', claim: 'approx', note: `線性化固定點 $w^*_{\\mathrm{lin}}=${texNum(an.wStarLinear, 6)}\\,\\mathrm{fs}$；兩者差很多表示 comparator 已離開小訊號區` },
    { name: 'cal $-3\\,\\mathrm{dB}$（exact）', value: a.bandwidths.exact, unit: 'Hz', claim: 'exact', note: 'E27：不存在時為 NaN' },
    { name: 'cal ENBW（one-sided）', value: a.bandwidths.enbw, unit: 'Hz', claim: 'exact', note: 'E06' },
    { name: 'PLL $T$ 的 $-3\\,\\mathrm{dB}$（實際 DT）', value: a.pll.f3dbTHz, unit: 'Hz', claim: 'exact', formulaId: 'F-LAB.4' },
  ]
}

function ToneTable({ r }: { r: PipelineResult }) {
  const o = r.output
  if (!o) return null
  const rows: ToneReport[] = [...(o.toneClosedForm ? [o.toneClosedForm] : []), ...(o.toneFitSim ? [o.toneFitSim] : []), ...o.tones]
  if (rows.length === 0)
    return (
      <p className="small muted">
        沒有偵測到譜線（Blackman–Harris Welch、{o.toneDetect.nSegments} 段平均：prominence 至少 15 dB，而且峰值要比鄰近 bin 的中位數高 {o.toneDetect.significanceDb} dB 以上——後者用來排除「雜訊 PSD 的最高點」這種假譜線）。一階 DSM（無 dither）才有封閉式的
        fractional spur；MASH 的 code 是 noise-like。
      </p>
    )
  const label = { 'closed-form': '封閉式（一階 DSM 基頻）', toneFit: 'toneFit（已知頻率的最小平方擬合）', findTones: 'findTones（Welch 峰值偵測）' } as const
  return (
    <div className="table-wrap">
      <table className="lab-table">
        <caption>
          輸出端的 tone / spur（peak 振幅；dBc 以 <Tex>{`f_{\\mathrm{out}}=${texHz(r.fOutHz, 6)}`}</Tex> 換算；findTones 的列要求峰值比鄰近 bin 的中位數高 {o.toneDetect.significanceDb} dB 以上；不是量測值）
        </caption>
        <thead>
          <tr>
            <th>來源</th>
            <th className="lab-num">頻率</th>
            <th className="lab-num">
              peak 振幅 <Tex>{'[\\mathrm{fs}]'}</Tex>
            </th>
            <th className="lab-num">
              <Tex>{'20\\log_{10}(\\beta/2)'}</Tex> [dBc]
            </th>
            <th className="lab-num">
              Bessel 精確 <Tex>{'J_1/J_0'}</Tex> [dBc]
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={`${t.source}-${i}`}>
              <th scope="row">{label[t.source]}</th>
              <td className="mono lab-num">{fmtHz(t.fHz, 6)}</td>
              <td className="mono lab-num">{sig(t.ampFs, 5)}</td>
              <td className="mono lab-num">{sig(t.dbc, 5)}</td>
              <td className="mono lab-num">{sig(t.dbcBessel, 5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 單步檢視：游標所在 block 的更新算式（數字全部來自模擬的 trace）。 */
function StepView({ r, cursor }: { r: PipelineResult; cursor: number }) {
  const b = r.blocks
  const p = r.params
  const k = b.k[cursor]
  const w = b.w[cursor]
  const G = b.G[cursor]
  const next = b.w[cursor + 1]
  const d = p.updateDelay
  const appIdx = Math.max(0, cursor - d)
  return (
    <div className="lab-step">
      <div className="table-wrap">
        <table className="lab-table">
          <thead>
            <tr>
              <th className="lab-num">
                <Tex>k</Tex>
              </th>
              <th className="lab-num">
                <Tex>{'w_k\\,[\\mathrm{fs}]'}</Tex>
              </th>
              <th className="lab-num">
                作用中的 <Tex>{`w_{\\mathrm{app}}=\\mathrm{phys}(w_{k-${d}})`}</Tex>
              </th>
              <th className="lab-num">
                <Tex>{'G_k'}</Tex>
              </th>
              <th className="lab-num">
                <Tex>{'\\mu G_k\\,[\\mathrm{fs}]'}</Tex>
              </th>
              <th className="lab-num">
                <Tex>{'w_{k+1}\\,[\\mathrm{fs}]'}</Tex>
              </th>
              <th className="lab-num">
                平均模型 <Tex>{'\\hat w_{k+1}'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono lab-num">{k}</td>
              <td className="mono lab-num">{sig(w, 8)}</td>
              <td className="mono lab-num">{sig(b.wPhys[appIdx], 8)}</td>
              <td className="mono lab-num">{sig(G, 6)}</td>
              <td className="mono lab-num">{sig(p.muFs * G, 6)}</td>
              <td className="mono lab-num">{sig(next, 8)}</td>
              <td className="mono lab-num">{sig(b.wMeanModel[cursor + 1], 8)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {Number.isFinite(G) && Number.isFinite(next) && (
        <p className="small">
          <Tex>{`w_{${k + 1}}=w_{${k}}+\\mu G_{${k}}=${texNum(w, 8)}+${texNum(p.muFs, 6)}\\times(${texNum(G, 6)})=${texNum(w + p.muFs * G, 8)}`}</Tex>
          {p.quantize && <>（定點模式下再經內部暫存器的 rounding / 飽和，所以表中的 <Tex>{'w_{k+1}'}</Tex> 可能與這個浮點算式差不到 1 個內部 LSB）</>}
        </p>
      )}
    </div>
  )
}

/** 實驗 'unified-lab'：整條 pipeline（runPipeline，Web Worker）的完整 trace、九級報告、交叉比對與報告匯出。 */
export function PipelineTab() {
  const lab = useLab()
  const { params, patch, setParams, pipe, presetId } = lab
  const { analyze, run, cancel, result, error, pendingKey, stoppedKey, preview, previewError, autoRun, setAutoRun, frozen, setFrozen, running, lastDurationMs, mode } = pipe
  const pal = usePalette()
  const { presets, onLoadPreset } = useShellPresets(EXP.pipeline)

  const key = labKey(params)
  const errors = useMemo(() => labParamErrors(params), [params])
  const dKey = useDebouncedValue(key, 350)
  const dParams = useMemo(() => JSON.parse(dKey) as LabParams, [dKey])
  const dOk = useMemo(() => labParamErrors(dParams).length === 0, [dParams])
  const tooBig = dParams.N * dParams.blocks > AUTO_RUN_MAX_SAMPLES

  // 即時解析（不跑迴路）
  const previewKey = preview?.key
  const previewErrKey = previewError?.key
  useEffect(() => {
    if (!dOk || previewKey === dKey || previewErrKey === dKey) return
    analyze(dParams)
  }, [dOk, dKey, dParams, previewKey, previewErrKey, analyze])

  // 自動重跑：只在「解析後的參數」真的改變時（debounce 後）
  const resultKey = result?.key
  const errorKey = error?.key
  useEffect(() => {
    if (!autoRun || frozen || !dOk || tooBig) return
    if (resultKey === dKey || errorKey === dKey || pendingKey === dKey || stoppedKey === dKey) return // 已有結果、已失敗、正在跑、或剛被手動停止
    run(dParams)
  }, [autoRun, frozen, dOk, tooBig, dKey, dParams, resultKey, errorKey, pendingKey, stoppedKey, run])

  const shown = result?.res ?? null
  const isCurrent = resultKey === key
  const stale = shown !== null && !isCurrent
  const previewCur = preview && preview.key === key ? preview.res : null

  const [cursor, setCursor] = useState<number | null>(null)
  const [view, setView] = useState<SampleView>('snippet')
  const [unit, setUnit] = useState<PsdUnit>('dbc')
  const [msg, setMsg] = useState<string | null>(null)

  const K = shown ? shown.config.num_blocks : 0
  const stepOk = shown !== null && shown.blocks.k.length === K + 1
  const cur = cursor !== null && stepOk ? Math.min(cursor, K - 1) : null

  const onStep = useCallback(() => {
    if (!shown) {
      setMsg('還沒有模擬結果：先按「執行 Run」。')
      return
    }
    if (!stepOk) {
      setMsg(`block 數 ${K} 超過 3999：block 級 trace 已抽樣顯示，單步檢視停用（請減少 block 數）。`)
      return
    }
    setMsg(null)
    setCursor((c) => (c === null ? 0 : Math.min(c + 1, K - 1)))
  }, [shown, stepOk, K])

  const onRunToConvergence = useCallback(() => {
    const an = previewCur ? previewCur.analytic : isCurrent && shown ? shown.analytic : null
    if (errors.length > 0 || !an) {
      setMsg(errors.length > 0 ? '參數不合法：先修正上方的錯誤。' : '即時解析尚未完成：請稍候再按一次。')
      return
    }
    const c = convergenceBlocks(an, params)
    if (c.blocks === null) {
      setMsg(`無法「執行至收斂」：${c.reason}`)
      return
    }
    const next: LabParams = { ...params, blocks: c.blocks, outBlocks: Math.min(params.outBlocks, c.blocks) }
    setMsg(`已把 block 數設為 ${c.blocks}。${c.reason}`)
    patch({ blocks: next.blocks, outBlocks: next.outBlocks })
    run(next)
  }, [previewCur, isCurrent, shown, errors, params, patch, run])

  const onReset = useCallback(() => {
    setParams(DEFAULT_LAB_PARAMS)
    setCursor(null)
    setMsg(null)
  }, [setParams])

  const warnings = useMemo(() => {
    const w: string[] = errors.map((e) => `參數不合法：${e}`)
    if (error && error.key === key) w.push(`模擬失敗：${error.res}`)
    if (previewError && previewError.key === key && errors.length === 0) w.push(`即時解析失敗：${previewError.res}`)
    if (isCurrent && shown) {
      for (const x of collectWarnings(shown)) if (!isInformational(x.text)) w.push(`【${x.stage}】${tw(x.text)}`)
      const names: Record<string, string> = { replay: '跨級一致性', code: 'code 統計', meanW: 'mean $w$', sigmaW: '$\\sigma_w$', noiseMix: 'gain noise × code', spur: 'fractional spur', fixedPoint: '定點 vs 浮點' }
      for (const [k, c] of Object.entries(shown.checks)) if (c.status === 'mismatch') w.push(`交叉比對不一致（${names[k] ?? k}）：${c.note}`)
    } else if (previewCur) {
      for (const x of previewCur.warnings) w.push(`【即時解析】${tw(x)}`)
    }
    return w
  }, [errors, error, previewError, key, isCurrent, shown, previewCur])

  const metrics = useMemo(() => (shown ? pipelineMetrics(shown) : []), [shown])
  const crossCheck = useMemo(() => (shown ? pipelineCrossCheck(shown) : NOT_RUN), [shown])
  const pRows = useMemo(() => (previewCur ? previewRows(previewCur) : []), [previewCur])

  const fW = useMemo(() => (shown ? figW(shown, pal, cur) : null), [shown, pal, cur])
  const fG = useMemo(() => (shown ? figG(shown, pal) : null), [shown, pal])
  const fCode = useMemo(() => (shown ? figCode(shown, pal, view) : null), [shown, pal, view])
  const fErr = useMemo(() => (shown ? figError(shown, pal, view) : null), [shown, pal, view])
  const fTf = useMemo(() => (shown ? figTransfer(shown, pal) : null), [shown, pal])
  const fPsd = useMemo(() => (shown ? figPsd(shown, pal, unit) : null), [shown, pal, unit])

  const onReport = () => {
    if (!shown) return
    const rep = buildLabReport(shown, { appVersion: APP_VERSION, gitCommit: GIT_COMMIT, generatedAt: new Date().toISOString(), presetId })
    downloadText(`unified-lab-report-${fileTimestamp()}.json`, 'application/json', JSON.stringify(rep, null, 2))
  }

  const o = shown?.output ?? null
  return (
    <ExperimentShell
      id={EXP.pipeline}
      title="Unified Lab：整條 pipeline 的完整 trace 與報告"
      level={shown ? shown.modelLevel : params.quantize ? 'L5' : 'L4'}
      claim="approx"
      source="simulation"
      tests={['T13', 'T14', 'T15']}
      headingLevel={3}
      description={
        <>
          FCW → DSM → code → DTC（在 reference 輸入端）→ <Tex>{'H_{\\mathrm{PD}}'}</Tex>（到 PD 的輸出）→ comparator → GMAC → gain register → 更新，再把 DTC 殘差經 <Tex>{'T'}</Tex> 送到輸出端算 jitter 與
          spur。迴路由 <code>runBlockLms</code>{' '}
          執行；本頁另外用獨立重寫的逐 sample 迴圈重播一次，逐位元比對每個 <Tex>{'G_k'}</Tex>（跨級一致性）。
        </>
      }
      assumptions={isCurrent && shown ? shown.assumptions : BASE_ASSUMPTIONS}
      params={params as unknown as Record<string, unknown>}
      seed={params.seed}
      onSeedChange={(s) => patch({ seed: s })}
      units={LAB_UNITS}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset,
        onStep,
        onRun: () => {
          if (errors.length === 0) run(params)
        },
        onStop: cancel,
        onRunToConvergence,
        onFreeze: () => setFrozen(!frozen),
        running,
        frozen,
      }}
      exportData={() => {
        if (!shown) throw new Error('還沒有模擬結果（先按 Run）')
        return pipelineExport(shown)
      }}
      presets={presets}
      onLoadPreset={onLoadPreset}
      controls={
        <>
          <ToggleControl label="參數改變後自動重跑" value={autoRun} onChange={setAutoRun} hint={md(`停手 0.35 秒後才跑；$N\\times K_B>${texNum(AUTO_RUN_MAX_SAMPLES)}$ 或「凍結」時不自動跑`)} reg="UI: auto-run" />
          <ParamPanel value={params} onChange={patch} open={['dsm', 'pll', 'gmac', 'update']} idPrefix="pipeline：" />
        </>
      }
    >
      <PresetNote experiment={EXP.pipeline} />

      <div className="lab-status small" role="status" data-testid="pipeline-status">
        {running ? (
          <span className="lab-status-run">模擬執行中…（{mode === 'worker' ? 'Web Worker' : '主執行緒 fallback'}）</span>
        ) : shown ? (
          <span>
            {stale ? (
              <strong className="lab-stale-flag">下方是舊參數的結果{frozen ? '（已凍結）' : stoppedKey === key ? '（已停止，請按 Run）' : errors.length > 0 ? '（目前參數不合法）' : tooBig ? '（樣本數超過自動重跑上限，請按 Run）' : autoRun ? '（即將重跑）' : '（請按 Run）'}</strong>
            ) : (
              <>結果對應目前參數</>
            )}
            {lastDurationMs !== null && <>；上次模擬 {Math.round(lastDurationMs)} ms</>}；{shown.config.num_blocks} 個 block、每個 {shown.config.gm_accum_samples} samples；版本 <span className="mono">{shown.version}</span>
          </span>
        ) : (
          <span>{stoppedKey === key ? '已停止' : '尚未執行'}{tooBig ? '：樣本數超過自動重跑上限，請按「執行 Run」' : stoppedKey !== key && autoRun && !frozen && errors.length === 0 ? '（即將自動執行）' : '：請按「執行 Run」'}</span>
        )}
        {shown && (
          <span className="lab-replay-badge" data-status={shown.checks.replay.status}>
            跨級一致性 <StatusPill status={shown.checks.replay.status} />
          </span>
        )}
      </div>
      {msg && (
        <Callout kind="info" title="操作訊息">
          <p>{md(msg)}</p>
        </Callout>
      )}

      {pRows.length > 0 && (
        <details className="lab-fold" open>
          <summary>
            即時解析（不必執行模擬；拖動滑桿立即更新） <ClaimTag kind="approx" />
          </summary>
          <MetricTable rows={pRows} caption="由 analyzeLab 計算：$C$ 用前 $2^{17}$ 個 code 樣本估計" />
        </details>
      )}

      {shown && (
        <div className={stale ? 'lab-results lab-stale' : 'lab-results'}>
          {fW && (
            <Plot
              title="校正係數 $w_k$：模擬軌跡 vs 平均模型（mean-field 軌跡）"
              csvName="unified-lab-w"
              data={fW.data}
              layout={fW.layout}
              height={320}
              caption={`統計只用後半段（$k\\ge${Math.ceil((K + 1) / 2)}$）。${
                shown.meanModel === 'mean-field'
                  ? '虛線是 mean-field 平均軌跡（F-LAB.18）：同一串 code、同一個 $H_{\\mathrm{PD}}$ 與更新式，只把 comparator 的 $\\pm1$ 換成對雜訊的期望值 $\\operatorname{erf}\\bigl(e_{\\det}/(\\sqrt2\\sigma_v)\\bigr)$；點線是線性時不變模型 $\\hat w_k=w^*-\\delta_k$、$\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}$（常數 $w^*$ 與 $g$；兩者幾乎重合時預設隱藏，點圖例可顯示）。'
                  : '虛線是線性時不變模型 $\\hat w_k=w^*-\\delta_k$、$\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}$。'
              }平均模型預測的是「許多 seeds 的平均」，單一 seed 會在它周圍以 $\\sigma_w$ 抖動。`}
            />
          )}
          <div className="lab-inline-controls">
            <ParamControl
              label="單步游標（block $k$）"
              value={cur ?? 0}
              onChange={(v) => setCursor(Math.round(v))}
              min={0}
              max={Math.max(0, K - 1)}
              step={1}
              integer
              clampOnBlur
              unit="block"
              reg="UI: block cursor"
              disabled={!stepOk}
              hint={stepOk ? '按「單步 Step」前進一個 block；下表顯示該 block 的更新算式' : 'block 數超過 3999 時 trace 已抽樣，單步檢視停用'}
            />
          </div>
          {cur !== null && <StepView r={shown} cursor={cur} />}

          <ModeGate min="engineer">
            {fG && <Plot title="每個 block 的 GMAC 輸出 $G_k$" csvName="unified-lab-G" data={fG.data} layout={fG.layout} height={220} caption="收斂後 $E[G_k]\to0$；剩下的是 comparator 雜訊造成的 $\eta_k$（變異數約 $E[x_{\mathrm{ref}}^2]/N$）。" />}
          </ModeGate>

          <h4 className="lab-subhead">
            穩態的逐 sample trace <ModelLevel level="L2" />
          </h4>
          <SelectControl<SampleView>
            label="顯示範圍"
            value={view}
            onChange={setView}
            reg="UI: trace view"
            options={[
              { value: 'snippet', label: `最後一個 block 的連續 ${shown.snippet ? shown.snippet.n.length : 0} 個 samples` },
              { value: 'window', label: `整個輸出視窗（${shown.window ? shown.window.blocks : 0} blocks，抽樣到 3000 點）` },
            ]}
            hint="連續片段看得到 DSM 鋸齒與每一筆 comparator 判斷；整個視窗適合看慢速結構（抽樣後高頻會混疊，只供觀察包絡）"
          />
          {fCode && <Plot title="code $x[n]$、regressor 與 comparator 輸出 $q[n]$" csvName="unified-lab-code" data={fCode.data} layout={fCode.layout} height={260} />}
          {fErr && (
            <Plot
              title="同一段時間的時間誤差：$e_{\mathrm{DTC}}$、$u_{\mathrm{pd}}=H_{\mathrm{PD}}\{e_{\mathrm{DTC}}\}$、$t_{\mathrm{out}}=T\{e_{\mathrm{DTC}}\}$"
              csvName="unified-lab-error"
              data={fErr.data}
              layout={fErr.layout}
              height={280}
              caption="PD 的輸出（comparator 取的就是它）是 high-pass 後的誤差，輸出端看到的是 low-pass 後的誤差——兩者不能混用（第 12 章）。comparator 的實際輸入還要加上 $b+v[n]$（圖例點一下可顯示；通常被 $\sigma_v$ 淹沒）。"
            />
          )}

          <h4 className="lab-subhead">
            輸出端：transfer、PSD、spur <ModelLevel level="L4" /> <ClaimTag kind="approx" />
          </h4>
          {o ? (
            <>
              {fTf && (
                <Plot
                  title="$|H_{\mathrm{PD}}|^2$ 與 $|T|^2$（同一個 DTC 誤差，兩條不同的路）"
                  csvName="unified-lab-transfer"
                  data={fTf.data}
                  layout={fTf.layout}
                  xLog
                  height={280}
                  caption="頻率軸是 sample-rate 軸（$f_s=f_{\mathrm{ref}}$）。三角形標出 $f_u=f_s/N$、cal 迴路的 $-3\,\mathrm{dB}$、PLL 的 $-3\,\mathrm{dB}$ 與 fractional tone $f_1$（存在時）。"
                />
              )}
              <SelectControl<PsdUnit>
                label="PSD 的單位"
                value={unit}
                onChange={setUnit}
                reg="UI: PSD unit"
                options={[
                  { value: 'dbc', label: 'ℒ(f) [dBc/Hz]' },
                  { value: 'fs2', label: 'S_t [fs²/Hz]（one-sided）' },
                ]}
                hint={md('$\\mathcal L(f)=10\\log_{10}\\bigl((2\\pi f_{\\mathrm{out}})^2S_t^{(1)}(f)/2\\bigr)$（E28）')}
              />
              {fPsd && (
                <Plot
                  title="輸出 timing error 的 PSD：模擬 vs gain-noise 解析曲線"
                  csvName="unified-lab-psd"
                  data={fPsd.data}
                  layout={fPsd.layout}
                  xLog
                  yLog={unit === 'fs2'}
                  height={340}
                  caption={`模擬：Welch、${o.psdSim.window} window、nperseg $=${o.psdSim.nperseg}$、${o.psdSim.nSegments} 段、ENBW $=${texHz(o.psdSim.enbwHz)}$、one-sided、取樣率 $f_s=${texHz(shown.params.fRefHz)}$；對數頻率格點上每格取最大值（保留譜線，所以雜訊底看起來偏高）。解析曲線只含 gain noise：$|T|^2\\bigl[\\bar x^2S_w^{\\mathrm{ZOH}}+\\sigma_w^2S_{\\tilde x}\\bigr]$；模擬另外還有靜態殘差 $(a-\\bar w)x+d(x)$ 經 $T$ 的部分。譜線的高度取決於 ENBW，要讀 spur 請看下表的 peak 振幅。`}
                />
              )}
              <ToneTable r={shown} />
            </>
          ) : (
            <Callout kind="warn" title="沒有輸出端分析">
              <p>
                {md('$w$ 在模擬中數值發散，穩態視窗不存在，所以不計算輸出端的 jitter / spur。先看上方的警告修正極性或增益。')}
              </p>
            </Callout>
          )}

          <h4 className="lab-subhead">九級的報告：每一級的模型層級、指標與假設</h4>
          <StageCards stages={shown.stages} />
          {shown.params.quantize && <QuantWhatIf result={shown} />}

          <h4 className="lab-subhead">交叉比對明細</h4>
          <CheckTable checks={shown.checks} />

          <div className="lab-report">
            <button type="button" className="btn btn-primary" onClick={onReport}>
              下載完整報告 JSON（全部參數、seed、版本、九級、警告）
            </button>
            <span className="small muted">HTML 報告（含圖）與 CSV（trace）用實驗框最下方的按鈕。</span>
          </div>
        </div>
      )}
    </ExperimentShell>
  )
}
