import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Callout,
  ClaimTag,
  downloadText,
  ExperimentShell,
  fileTimestamp,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  mathText,
  useDebouncedValue,
  useThemeTokens,
  type CrossCheck,
  type ExperimentPreset,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import type { BlockLmsConfig, BlockLmsConfigInput, BlockLmsMonteCarloResult, BlockLmsResult } from '@/simulation/models/blockLms'
import {
  AUTO_RUN_MAX_SAMPLES,
  EXPERIMENT_ID,
  FULL_DEFAULT_TEXT,
  MAX_UPLOAD_BYTES,
  PARAM_UNITS,
  SPEC_EXAMPLE_TEXT,
  analyticRows,
  buildMetricRows,
  crossCheckOf,
  decimate,
  exportColumns,
  fmtNum,
  labAssumptions,
  labWarnings,
  modelLevelOf,
  presetConfigText,
  setConfigPath,
  shortLabelTex,
  summarizeParams,
  tailHistogram,
  texNumber,
  toJsonText,
  validateConfigText,
} from './jsonLabModel'

/** 字串內的 `$...$` 以 KaTeX 顯示（ParamControl 的 label / hint 用） */
const md = (s: string) => mathText(s)

type Keyed<T> = { key: string; res: T }

// Plot 以 layout 的 identity 判斷是否重畫：放在模組層級，避免在文字框每打一個字就讓所有圖 Plotly.react 一次（也會重設使用者的縮放）
const LAYOUT_W = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '$w$ [fs/unit code]' } } }
const LAYOUT_G_AVG = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '$G$（average，無因次）' } } }
const LAYOUT_G_SUM = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '$S$（sum，無因次）' } } }
const LAYOUT_TRACE = { xaxis: { title: { text: 'sample $n$' } }, yaxis: { title: { text: '$e$ [fs]' } } }
const LAYOUT_HIST = { xaxis: { title: { text: '$w$ [fs/unit code]' } }, yaxis: { title: { text: '機率密度 [1/fs]' } }, barmode: 'overlay' as const }

const PATTERN_KINDS = ['iid_pm_one', 'gaussian', 'uniform', 'sinusoid', 'dsm_first_order', 'mash111'] as const
const PATH_KINDS = ['identity', 'single_tone', 'fir', 'first_order_hp', 'type2_dt', 'iir'] as const
const PATH_DEFAULT_PARAMS: Record<(typeof PATH_KINDS)[number], Record<string, number | number[]>> = {
  identity: {},
  single_tone: {},
  fir: { taps: [1, -0.5] },
  first_order_hp: {},
  type2_dt: {},
  iir: { b: [1], a: [1, -0.5] },
}

/** 實驗 'block-lms-json'：以規格 §15.3 JSON 驅動 runBlockLms（Web Worker） */
export function BlockLmsJsonLab() {
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const [text, setText] = useState<string>(() => (urlPreset ? (presetConfigText(urlPreset.params) ?? SPEC_EXAMPLE_TEXT) : SPEC_EXAMPLE_TEXT))
  const appliedPreset = useRef<string | null>(urlPreset?.id ?? null)
  useEffect(() => {
    if (urlPreset && appliedPreset.current !== urlPreset.id) {
      appliedPreset.current = urlPreset.id
      const t = presetConfigText(urlPreset.params)
      if (t) setText(t)
      // 頁內連結（§9 的「重現」）換 preset 時，捲到實驗框
      const el = typeof document !== 'undefined' ? document.getElementById(`exp-${EXPERIMENT_ID}`) : null
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [urlPreset])

  const debounced = useDebouncedValue(text, 350)
  const validation = useMemo(() => validateConfigText(debounced), [debounced])
  // 上一次合法的設定（JSON 暫時改壞時，快速控制項與圖表沿用它）。render 期間「由 props 推導 state」的標準寫法：
  // validation 以 debounced 文字 memo，config 的 identity 穩定，不會形成更新迴圈。
  const [lastValid, setLastValid] = useState<BlockLmsConfig | null>(null)
  if (validation.ok && validation.config && validation.config !== lastValid) setLastValid(validation.config)
  const cfg = validation.config ?? lastValid
  const cfgKey = validation.ok && validation.config ? JSON.stringify(validation.config) : null

  const { run: runSim, cancel: cancelSim, running: simRunning, lastDurationMs, mode: workerMode } = useWorkerTask<BlockLmsConfigInput, BlockLmsResult>(
    'blockLms',
    'runBlockLms',
    { restartOnRun: true },
  )
  const { run: runTwin } = useWorkerTask<BlockLmsConfigInput, BlockLmsResult>('blockLms', 'runBlockLms', { restartOnRun: true })
  const { run: runMc, cancel: cancelMc, running: mcRunning } = useWorkerTask<{ config: BlockLmsConfigInput; runs: number }, BlockLmsMonteCarloResult>(
    'blockLms',
    'runBlockLmsMonteCarlo',
    { restartOnRun: true },
  )

  const [result, setResult] = useState<Keyed<BlockLmsResult> | null>(null)
  const [twin, setTwin] = useState<Keyed<BlockLmsResult> | null>(null)
  const [mc, setMc] = useState<Keyed<BlockLmsMonteCarloResult> | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [autoRun, setAutoRun] = useState(true)
  const [pins, setPins] = useState<{ label: string; x: number[]; y: number[] }[]>([])
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  const startRun = useCallback(
    (c: BlockLmsConfig) => {
      const key = JSON.stringify(c)
      setRunError(null)
      runSim(c).then(
        (res) => setResult({ key, res }),
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setRunError(e instanceof Error ? e.message : String(e))
        },
      )
      if (c.gain_register.quantize_physical) {
        const floatCfg: BlockLmsConfig = { ...c, gain_register: { ...c.gain_register, quantize_physical: false }, record: { sample_trace_blocks: 0, decimate: 1 } }
        runTwin(floatCfg).then(
          (res) => setTwin({ key, res }),
          () => undefined,
        )
      }
    },
    [runSim, runTwin],
  )

  // 只在「解析後的設定」真的改變時重跑（空白、排版或欄位順序的修改不觸發）
  const autoCfg = useMemo(() => (cfgKey ? (JSON.parse(cfgKey) as BlockLmsConfig) : null), [cfgKey])
  useEffect(() => {
    if (!autoRun || !autoCfg) return
    if (autoCfg.gm_accum_samples * autoCfg.num_blocks > AUTO_RUN_MAX_SAMPLES) return
    startRun(autoCfg)
  }, [autoCfg, autoRun, startRun])

  const current = result && result.key === cfgKey ? result.res : null
  const shown = current ?? result?.res ?? null
  const stale = shown !== null && current === null
  const twinCur = twin && twin.key === cfgKey ? twin.res : null
  const mcCur = mc && mc.key === cfgKey ? mc.res : null

  const patch = (path: string[], value: Parameters<typeof setConfigPath>[2]) => {
    const t = setConfigPath(text, path, value)
    if (t) setText(t)
  }

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_UPLOAD_BYTES) {
      setUploadMsg(`檔案 ${f.name} 有 ${f.size} bytes，超過上限 ${MAX_UPLOAD_BYTES} bytes，未載入`)
      return
    }
    f.text().then(
      (t) => {
        setText(t)
        setUploadMsg(`已載入 ${f.name}（${f.size} bytes）`)
      },
      (err: unknown) => setUploadMsg(`讀取失敗：${err instanceof Error ? err.message : String(err)}`),
    )
  }

  const format = () => {
    try {
      setText(toJsonText(JSON.parse(text) as unknown))
    } catch {
      /* 無法解析時保留原文，錯誤訊息由驗證區顯示 */
    }
  }

  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )

  const tokens = useThemeTokens()
  const plotW = useMemo(() => {
    if (!shown) return null
    const res = shown
    const w = decimate(res.blocks.w)
    const traces: Plotly.Data[] = [{ x: w.x, y: w.y, name: '$w_k$（內部暫存器）', mode: 'lines', line: { color: tokens.series[0], width: 1.5 } }]
    if (res.config.gain_register.quantize_physical) {
      const wp = decimate(res.blocks.wPhys)
      traces.push({ x: wp.x, y: wp.y, name: '$w_{\\mathrm{phys}}$（實體 code $\\times$ LSB）', mode: 'lines', line: { color: tokens.series[3], width: 1, shape: 'hv' } })
    }
    if (mcCur && mc?.key === result?.key) {
      const m = decimate(mcCur.wMean)
      traces.push({ x: m.x, y: m.y, name: `MC 平均（${mcCur.seeds.length} seeds）`, mode: 'lines', line: { color: tokens.series[4], width: 1.5 } })
    }
    pins.forEach((p, i) => traces.push({ x: p.x, y: p.y, name: p.label, mode: 'lines', line: { color: tokens.series[(i + 1) % tokens.series.length], width: 1, dash: 'dot' } }))
    const K = res.blocks.G.length
    const a = res.config.gain_true
    const ws = res.analytic.wStarMeanField
    const sw = res.analytic.sigmaWPred
    traces.push({ x: [0, K], y: [a, a], name: '$a$（gain_true）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } })
    if (Number.isFinite(ws)) {
      traces.push({ x: [0, K], y: [ws, ws], name: '$w^*$（mean-field）', mode: 'lines', line: { color: tokens.series[2], dash: 'dot', width: 1.5 } })
      if (Number.isFinite(sw) && sw > 0) {
        traces.push({ x: [0, K, K, 0], y: [ws + 2 * sw, ws + 2 * sw, ws - 2 * sw, ws - 2 * sw], name: '$w^* \\pm 2\\sigma_w$（預測）', fill: 'toself', mode: 'lines', line: { width: 0 }, opacity: 0.15, fillcolor: tokens.series[2], hoverinfo: 'skip' })
      }
    }
    return traces
  }, [shown, tokens, pins, mcCur, mc?.key, result?.key])

  const plotG = useMemo(() => {
    if (!shown) return null
    const g = decimate(shown.blocks.G)
    return [{ x: g.x, y: g.y, name: '$G_k$', mode: 'lines' as const, line: { color: tokens.series[1], width: 1 } }]
  }, [shown, tokens])

  const plotTrace = useMemo(() => {
    if (!shown || shown.trace.n.length === 0) return null
    const t = shown.trace
    const a = shown.config.gain_true
    const w0 = shown.blocks.wPhys[0]
    const b = shown.config.comparator_offset_fs
    const N = shown.config.gm_accum_samples
    // block 0 的確定性部分（identity path 時精確；非 identity 時 u = H{x}）：(a − w0)·u + b
    const n0: number[] = []
    const eDet: number[] = []
    for (let i = 0; i < t.n.length && t.n[i] < N; i++) {
      n0.push(t.n[i])
      eDet.push((a - w0) * t.u[i] + b)
    }
    const e = decimate(t.e, 8000)
    return [
      { x: e.x.map((i) => t.n[i]), y: e.y, name: '$e[n]$（含雜訊）', mode: 'markers' as const, marker: { size: 3, color: tokens.series[0], opacity: 0.5 } },
      { x: n0, y: eDet, name: '$(a - w_0)\\cdot u[n] + b$（block 0 的確定性部分）', mode: 'lines' as const, line: { color: tokens.series[1], width: 2 } },
    ]
  }, [shown, tokens])

  const hist = useMemo(() => {
    if (!shown || shown.metrics.diverged) return null
    const h = tailHistogram(shown.blocks.w, shown.analytic.wStarMeanField, shown.analytic.sigmaWPred)
    if (!h) return null
    return [
      { x: h.centers, y: h.density, name: '模擬：後半段 $w$ 直方圖', type: 'bar' as const, marker: { color: tokens.series[0], opacity: 0.6 } },
      { x: h.centers, y: h.gauss, name: '$\\mathcal{N}(w^*, \\sigma_w^2)$ 預測', mode: 'lines' as const, line: { color: tokens.series[2], width: 2 } },
    ]
  }, [shown, tokens])

  // 指標與交叉比對要掃過整段 w（最多 10⁶ 個 block）：只在結果改變時重算，不在每次按鍵時重算
  const crossCheck: CrossCheck = useMemo(
    () =>
      current
        ? crossCheckOf(current, mcCur, twinCur)
        : {
            analytic: { status: 'not-implemented', note: '尚未有對應目前 JSON 的模擬結果' },
            monteCarlo: { status: 'not-implemented', note: '尚未執行' },
            fixedPoint: { status: 'not-implemented', note: '尚未執行' },
          },
    [current, mcCur, twinCur],
  )
  const metricRows = useMemo(() => (current ? buildMetricRows(current) : []), [current])

  const warnings = useMemo(() => labWarnings(current, runError), [current, runError])
  const assumptions = useMemo(() => labAssumptions(current), [current])
  const textareaId = useId()

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title="Block Sign-LMS JSON Lab：用 §15.3 參數直接跑參考模型"
      level={cfg ? modelLevelOf(cfg) : 'L1'}
      claim="approx"
      source="simulation"
      tests={['T13', 'T14', 'T06', 'T07']}
      description={
        <>
          編輯下方 JSON（或用左側快速控制項），zod 即時驗證並以繁體中文指出錯誤；合法且總樣本數 <Tex>{'N\\times\\text{num\\_blocks}'}</Tex> 不超過 {AUTO_RUN_MAX_SAMPLES.toLocaleString('en-US')} 時自動在 Web Worker 執行{' '}
          <code>runBlockLms</code>。結果同時給出模擬統計與解析預測（<Tex>{'K_q, C, g, p, \\sigma_w, f_\\mathrm{3dB}'}</Tex>、mean-field <Tex>{'w^*'}</Tex>），並可做 8-seed Monte Carlo
          與定點／浮點對照。
        </>
      }
      assumptions={assumptions}
      params={cfg ? summarizeParams(cfg) : { json_valid: false }}
      seed={cfg?.seed}
      onSeedChange={validation.ok ? (s) => patch(['seed'], s) : undefined}
      units={PARAM_UNITS}
      metrics={metricRows}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          setText(SPEC_EXAMPLE_TEXT)
          setPins([])
        },
        onRun: () => {
          if (validation.config) startRun(validation.config)
        },
        onStop: cancelSim,
        running: simRunning,
      }}
      exportData={() => {
        if (!shown) throw new Error('尚未有模擬結果')
        return exportColumns(shown)
      }}
      presets={presets}
      onLoadPreset={(p) => {
        const t = presetConfigText(p.params)
        if (t) setText(t)
      }}
      controls={<QuickControls cfg={cfg} disabled={!validation.ok} patch={patch} autoRun={autoRun} setAutoRun={setAutoRun} />}
    >
      <div className="models-json">
        <div className="models-json-toolbar" role="group" aria-label="JSON 工具">
          <button type="button" className="btn" onClick={() => setText(SPEC_EXAMPLE_TEXT)}>
            載入 §15.3 範例
          </button>
          <button type="button" className="btn" onClick={() => setText(FULL_DEFAULT_TEXT)}>
            載入完整預設（含擴充欄位）
          </button>
          <button type="button" className="btn" onClick={format}>
            格式化
          </button>
          <button type="button" className="btn" onClick={() => downloadText(`block-lms-config-${fileTimestamp()}.json`, 'application/json', text)}>
            下載 JSON（原文）
          </button>
          <button
            type="button"
            className="btn"
            disabled={!validation.ok}
            onClick={() => validation.config && downloadText(`block-lms-config-resolved-${fileTimestamp()}.json`, 'application/json', toJsonText(validation.config))}
          >
            下載補齊後設定
          </button>
          <label className="btn models-upload">
            上傳 JSON
            <input type="file" accept="application/json,.json" onChange={onUpload} aria-label="上傳 JSON 設定檔" />
          </label>
        </div>
        <label htmlFor={textareaId} className="small muted">
          §15.3 參數 JSON（可直接編輯）
        </label>
        <textarea
          id={textareaId}
          className="models-json-text mono"
          value={text}
          spellCheck={false}
          rows={18}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={validation.ok ? undefined : true}
        />
        {uploadMsg && <div className="small muted">{uploadMsg}</div>}
        <div className="models-json-status small" aria-live="polite">
          {text !== debounced ? (
            <span className="muted">驗證中…</span>
          ) : validation.ok ? (
            <span className="models-ok">
              ✓ 合法：總樣本數 <Tex>{'N\\times\\text{num\\_blocks}'}</Tex> 為 {validation.totalSamples.toLocaleString('en-US')} samples
              {validation.filled.length > 0 && <>；以預設值補上 {validation.filled.length} 個欄位</>}
            </span>
          ) : (
            <span className="models-bad">✗ 驗證失敗（{validation.errors.length} 項）</span>
          )}
        </div>
        {validation.ok && validation.filled.length > 0 && (
          <details className="models-filled">
            <summary className="small">由預設值補上的欄位（{validation.filled.length}）</summary>
            <code className="small">{validation.filled.join('、')}</code>
          </details>
        )}
        {!validation.ok && text === debounced && (
          <Callout kind="danger" title={`JSON 驗證失敗（${validation.errors.length} 項）`}>
            <ul className="models-tight">
              {validation.errors.map((e) => (
                <li key={e}>
                  <code>{e}</code>
                </li>
              ))}
            </ul>
            <p className="small">修正後會自動重新驗證；圖表暫時保留上一次合法設定的結果。</p>
          </Callout>
        )}
        {validation.ok && validation.totalSamples > AUTO_RUN_MAX_SAMPLES && (
          <Callout kind="info" title="總樣本數超過自動執行門檻">
            <Tex>{'N\\times\\text{num\\_blocks}'}</Tex> 為 {validation.totalSamples.toLocaleString('en-US')}，超過 {AUTO_RUN_MAX_SAMPLES.toLocaleString('en-US')}：為避免每次輸入都觸發長時間計算，請按上方「執行 Run」。
          </Callout>
        )}
      </div>

      <div className="models-run-status small muted">
        Worker 模式：{workerMode === 'worker' ? 'Web Worker' : 'inline（此環境不支援 Worker）'}
        {lastDurationMs !== null && <>；上次執行 {Math.round(lastDurationMs)} ms</>}
        {simRunning && <>；執行中…</>}
        {stale && <>；圖表為上一次設定的結果（目前 JSON 尚未執行）</>}
      </div>

      {shown && plotW && plotG && (
        <>
          <Plot
            title="$w_k$：每個 block 更新後的 gain [fs per unit code]"
            data={plotW}
            layout={LAYOUT_W}
            height={300}
            csvName="block-lms-w"
            caption={`${shortLabelTex(shown.config)}；虛線 $a=${texNumber(shown.config.gain_true, 6)}$ fs，點線 $w^*=${texNumber(shown.analytic.wStarMeanField, 6)}$ fs（mean-field 固定點），色帶為 $w^*\\pm2\\sigma_w$ 的線性化預測`}
          />
          <div className="models-pin-row">
            <button
              type="button"
              className="btn"
              disabled={pins.length >= 3}
              onClick={() => {
                const w = decimate(shown.blocks.w, 4000)
                setPins((p) => [...p, { label: `釘選 ${p.length + 1}：${shortLabelTex(shown.config)}`, x: w.x, y: w.y }].slice(-3))
              }}
            >
              釘選目前的 gain 曲線作比較
            </button>
            {pins.length > 0 && (
              <button type="button" className="btn" onClick={() => setPins([])}>
                清除釘選（{pins.length}）
              </button>
            )}
            <span className="small muted">最多 3 條；例如先跑 average，再切 sum 比較。</span>
          </div>
          <Plot
            title="$G_k$：每個 block 的 GMAC 輸出"
            data={plotG}
            layout={shown.config.gm_mode === 'average' ? LAYOUT_G_AVG : LAYOUT_G_SUM}
            height={240}
            csvName="block-lms-G"
          />
          <ModeGate min="engineer">
            {plotTrace && (
              <Plot
                title="前幾個 block 的 sample trace：$e[n]$ 與確定性部分"
                data={plotTrace}
                layout={LAYOUT_TRACE}
                height={260}
                csvName="block-lms-trace"
                caption="1 fs 量級的確定性誤差 $(a-w_0)\,u[n]+b$ 埋在 $\sigma_v$ 的雜訊裡；comparator 只看正負號，靠 GMAC 平均把方向取出來（Ch05）。"
              />
            )}
          </ModeGate>
          <ModeGate min="research">
            {hist && (
              <Plot
                title="後半段 $w$ 的分布 vs Gaussian 預測 $\mathcal N(w^*,\sigma_w^2)$"
                data={hist}
                layout={LAYOUT_HIST}
                height={240}
                csvName="block-lms-hist"
                caption="$w_k$ 之間高度相關（AR(1)，$\rho\approx p$），直方圖比 iid 樣本更「粗糙」；量化（L5）時分布是離散的。"
              />
            )}
          </ModeGate>
          <AnalyticTable res={shown} />
          <McPanel
            onRun={() => {
              if (!validation.config) return
              const key = JSON.stringify(validation.config)
              runMc({ config: validation.config, runs: 8 }).then(
                (res) => setMc({ key, res }),
                (e: unknown) => {
                  if (!isWorkerCancelled(e)) setRunError(e instanceof Error ? e.message : String(e))
                },
              )
            }}
            onCancel={cancelMc}
            running={mcRunning}
            disabled={!validation.ok}
            mc={mcCur}
            res={current}
          />
          {twinCur && current && (
            <p className="small">
              定點 vs 浮點（同 seed）：實體 code 平均 {fmtNum(current.metrics.meanWPhys, 6)} fs，理想浮點平均 {fmtNum(twinCur.metrics.meanW, 6)} fs，差{' '}
              {fmtNum(current.metrics.meanWPhys - twinCur.metrics.meanW, 4)} fs（1 LSB 為 {current.config.gain_register.lsb_fs} fs）。
            </p>
          )}
        </>
      )}
      {!shown && !simRunning && (
        <p className="small muted">{validation.ok ? '按「執行 Run」開始模擬。' : '請先修正 JSON。'}</p>
      )}
    </ExperimentShell>
  )
}

function QuickControls({
  cfg,
  disabled,
  patch,
  autoRun,
  setAutoRun,
}: {
  cfg: BlockLmsConfig | null
  disabled: boolean
  patch: (path: string[], v: Parameters<typeof setConfigPath>[2]) => void
  autoRun: boolean
  setAutoRun: (v: boolean) => void
}) {
  if (!cfg) return <p className="small muted">JSON 尚未合法，快速控制項停用。</p>
  return (
    <>
      <p className="small muted">快速控制項會直接改寫 JSON（{disabled ? 'JSON 目前不合法，已停用' : '與文字框同步'}）。</p>
      <ParamControl
        label={md('$\\mu$（gain_step）')}
        ariaLabel="mu（gain_step）"
        value={cfg.gain_step}
        onChange={(v) => patch(['gain_step'], v)}
        min={1e-4}
        max={1e4}
        log
        unit="fs"
        reg="REG_CAL_MU（gain_step）"
        hint={md('$g=\\mu K_qC$ 需在 $(0,g_\\mathrm{crit})$；sum 模式要改用 $\\mu/N$')}
        disabled={disabled}
      />
      <ParamControl
        label={md('$N$（gm_accum_samples）')}
        ariaLabel="N（gm_accum_samples）"
        value={cfg.gm_accum_samples}
        onChange={(v) => patch(['gm_accum_samples'], v)}
        min={1}
        max={1048576}
        log
        integer
        clampOnBlur
        unit="samples"
        reg="REG_GMAC_N[19:0]"
        hint={md('$1\\ldots2^{20}$；$N\\times\\text{num\\_blocks}\\le2^{28}$')}
        disabled={disabled}
      />
      <ParamControl label="num_blocks" value={cfg.num_blocks} onChange={(v) => patch(['num_blocks'], v)} min={1} max={1000000} log integer clampOnBlur unit="blocks" reg="Sim：num_blocks（擴充）" disabled={disabled} />
      <ParamControl
        label={md('$\\sigma_v$（pd_noise_rms_fs）')}
        ariaLabel="sigma_v（pd_noise_rms_fs）"
        value={cfg.pd_noise_rms_fs}
        onChange={(v) => patch(['pd_noise_rms_fs'], v)}
        min={0}
        max={1000}
        step={0.1}
        unit="fs"
        reg="Behavioral：pd_noise_rms_fs"
        hint={md('$0$ 時 $K_q$ 無定義（純 sign）')}
        disabled={disabled}
      />
      <ParamControl label={md('$a$（gain_true）')} ariaLabel="a（gain_true）" value={cfg.gain_true} onChange={(v) => patch(['gain_true'], v)} min={-100} max={100} step={0.01} unit="fs/unit code" reg="Behavioral：gain_true（DUT 真值）" disabled={disabled} />
      <ParamControl label={md('$w_0$（gain_initial）')} ariaLabel="w_0（gain_initial）" value={cfg.gain_initial} onChange={(v) => patch(['gain_initial'], v)} min={-100} max={100} step={0.01} unit="fs/unit code" reg="REG_CAL_GAIN_INIT（gain_initial）" disabled={disabled} />
      <ParamControl label={md('$b$（comparator_offset_fs）')} ariaLabel="b（comparator_offset_fs）" value={cfg.comparator_offset_fs} onChange={(v) => patch(['comparator_offset_fs'], v)} min={-500} max={500} step={0.1} unit="fs" reg="Behavioral：comparator_offset_fs" disabled={disabled} />
      <ParamControl
        label={md('$D$（gm_code_delay_samples）')}
        ariaLabel="D（gm_code_delay_samples）"
        value={cfg.gm_code_delay_samples}
        onChange={(v) => patch(['gm_code_delay_samples'], v)}
        min={0}
        max={65536}
        step={1}
        integer
        clampOnBlur
        unit="samples"
        reg="REG_GMAC_CODE_DLY[15:0]"
        hint="regressor_mode 為 raw 時忽略"
        disabled={disabled}
      />
      <ParamControl
        label={md('$d$（cal_update_delay_blocks）')}
        ariaLabel="d（cal_update_delay_blocks）"
        value={cfg.cal_update_delay_blocks}
        onChange={(v) => patch(['cal_update_delay_blocks'], v)}
        min={0}
        max={64}
        step={1}
        integer
        clampOnBlur
        unit="blocks"
        reg="REG_CAL_COMMIT_DLY[5:0]"
        hint={md('$g_\\mathrm{crit}=2\\sin\\frac{\\pi}{4d+2}$')}
        disabled={disabled}
      />
      <SelectControl label="gm_mode" value={cfg.gm_mode} onChange={(v) => patch(['gm_mode'], v)} options={['average', 'sum']} reg="REG_GMAC_AVG_EN" disabled={disabled} />
      <SelectControl
        label="comparator_encoding"
        value={cfg.comparator_encoding}
        onChange={(v) => patch(['comparator_encoding'], v)}
        options={[
          { value: 'bipolar_pm_one', label: 'bipolar（+1 / -1）' },
          { value: 'unipolar_mapped', label: '0/1，先映射成 +1 / -1' },
          { value: 'unipolar_unmapped_bug', label: '0/1 未映射（bug）' },
        ]}
        reg="RTL：comparator bit → q 映射"
        disabled={disabled}
      />
      <SelectControl label="regressor_mode" value={cfg.regressor_mode} onChange={(v) => patch(['regressor_mode'], v)} options={['raw', 'delayed', 'filtered']} reg="REG_GMAC_XREF_SEL" disabled={disabled} />
      <SelectControl label="code_normalization" value={cfg.code_normalization} onChange={(v) => patch(['code_normalization'], v)} options={['none', 'zero_mean', 'unit_rms', 'standardize']} reg="Sim：code_normalization" disabled={disabled} />
      <SelectControl
        label="seeded_pattern.kind"
        value={cfg.seeded_pattern.kind}
        onChange={(v) => patch(['seeded_pattern'], { kind: v, parameters: {} })}
        options={[...PATTERN_KINDS]}
        reg="Sim：seeded_pattern（參數重設為預設）"
        disabled={disabled}
      />
      <SelectControl
        label="pll_error_path.kind"
        value={cfg.pll_error_path.kind}
        onChange={(v) => patch(['pll_error_path'], { kind: v, parameters: PATH_DEFAULT_PARAMS[v] })}
        options={[...PATH_KINDS]}
        reg="Behavioral：pll_error_path（參數重設為預設）"
        disabled={disabled}
      />
      <ToggleControl
        label="quantize_physical（L5 定點）"
        value={cfg.gain_register.quantize_physical}
        onChange={(v) => patch(['gain_register', 'quantize_physical'], v)}
        reg="Sim：gain_register.quantize_physical"
        hint={`physical_bits = ${cfg.gain_register.physical_bits}、LSB = ${cfg.gain_register.lsb_fs} fs`}
        disabled={disabled}
      />
      <ToggleControl label="編輯後自動執行" value={autoRun} onChange={setAutoRun} hint={`總樣本數不超過 ${AUTO_RUN_MAX_SAMPLES.toLocaleString('en-US')} 時`} />
    </>
  )
}

function AnalyticTable({ res }: { res: BlockLmsResult }) {
  const rows = useMemo(() => analyticRows(res.analytic, res.config), [res])
  return (
    <details className="models-analytic" open>
      <summary>
        解析區塊（<code>analytic</code>，由 runBlockLms 的 prepare() 計算）
      </summary>
      <div className="table-wrap">
        <table className="models-table models-num">
          <thead>
            <tr>
              <th>量</th>
              <th>公式</th>
              <th>值</th>
              <th>單位</th>
              <th>標籤</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {md(r.label)}
                  {r.note && <div className="small muted">{md(r.note)}</div>}
                </td>
                <td className="models-formula-cell">
                  <Tex>{r.tex}</Tex>
                </td>
                <td className="mono">{typeof r.value === 'number' ? fmtNum(r.value, 6) : r.value}</td>
                <td className="nowrap">{md(r.unit)}</td>
                <td>
                  <ClaimTag kind={r.claim} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function McPanel({
  onRun,
  onCancel,
  running,
  disabled,
  mc,
  res,
}: {
  onRun: () => void
  onCancel: () => void
  running: boolean
  disabled: boolean
  mc: BlockLmsMonteCarloResult | null
  res: BlockLmsResult | null
}) {
  return (
    <div className="models-mc">
      <div className="models-pin-row">
        {running ? (
          <button type="button" className="btn" onClick={onCancel}>
            停止 Monte Carlo
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={disabled}>
            Monte Carlo（8 seeds）
          </button>
        )}
        <span className="small muted">seeds = deriveSeed(seed, 0…7)；每個 run 不記錄 trace。總樣本為單次的 8 倍。</span>
      </div>
      {mc && (
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>seed</th>
                <th>
                  平均 <Tex>{'w'}</Tex> [fs]
                </th>
                <th>
                  <Tex>{'w'}</Tex> 的標準差 [fs]
                </th>
                <th>bias [fs]</th>
                <th>settling [block]</th>
              </tr>
            </thead>
            <tbody>
              {mc.seeds.map((s, i) => (
                <tr key={s}>
                  <td className="mono">{s}</td>
                  <td>{fmtNum(mc.perRun.meanW[i], 6)}</td>
                  <td>{fmtNum(mc.perRun.stdW[i], 4)}</td>
                  <td>{fmtNum(mc.perRun.bias[i], 4)}</td>
                  <td>{Number.isFinite(mc.perRun.settlingBlock[i]) ? mc.perRun.settlingBlock[i] : '—'}</td>
                </tr>
              ))}
              <tr className="models-sumrow">
                <td>95% CI（Student-t）</td>
                <td colSpan={2}>
                  [{fmtNum(mc.meanW.lo, 6)}, {fmtNum(mc.meanW.hi, 6)}]
                </td>
                <td colSpan={2}>
                  pooled <Tex>{'\\sigma_w'}</Tex>：{fmtNum(mc.pooledStdW, 4)} fs{res && Number.isFinite(res.analytic.sigmaWPred) ? `（預測 ${fmtNum(res.analytic.sigmaWPred, 4)} fs）` : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
