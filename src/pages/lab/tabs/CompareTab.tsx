import { useMemo, useState } from 'react'
import { Callout, CaseSelector, ExperimentShell, Plot, SelectControl, Tex, type CaseId, type CrossCheck, type MetricRow } from '@/components'
import { DEFAULT_LAB_PARAMS, labParamErrors, type LabParams, type PipelineResult } from '@/simulation/models/unifiedLab'
import { md, sig, StatusPill } from '../common'
import { collectWarnings, compareCrossCheck, diffKeys, EXP, isInformational, labKey, pipelineCrossCheck } from '../logic'
import { ParamPanel } from '../ParamPanel'
import { labelOf, LAB_UNITS } from '../paramMeta'
import { useLab } from '../store'
import { figComparePsd, figCompareW, type CompareItem, type PsdUnit } from './plots'
import { PresetNote, tw, usePalette, useShellPresets } from './shared'

const ASSUMPTIONS = [
  '各 case 是完整、獨立的一組 pipeline 參數；差異只來自你改的欄位（下方「差異表」列出）',
  '所有 case 共用同一個 seed（paired comparison）：comparator 雜訊的亂數流相同，所以差異不是亂數造成的',
  '每個 case 各跑一次 runPipeline（與 Pipeline 分頁完全相同的函式），包含 replay 的跨級一致性檢查',
  '單一 seed 的比較仍有抽樣誤差：差距小於 $\\sigma_w$ 時請用 Monte Carlo 分頁確認',
]

interface Row {
  name: string
  unit?: string
  get: (r: PipelineResult) => number | string | null
}

const ROWS: Row[] = [
  { name: '$C=E[x_{\\mathrm{ref}}u_x]$', get: (r) => r.analytic.Cest },
  { name: '$g=\\mu K$', get: (r) => r.analytic.g },
  { name: '$\\rho$', get: (r) => r.analytic.rhoMean },
  { name: '$\\tau$', unit: 'block', get: (r) => r.analytic.tauBlocks },
  { name: '$w^*$（mean-field）', unit: 'fs', get: (r) => r.analytic.wStarMeanField },
  { name: 'mean $w$（後半段）', unit: 'fs', get: (r) => r.metrics.meanW },
  { name: 'bias $=\\bar w-a$', unit: 'fs', get: (r) => r.metrics.bias },
  { name: '$\\sigma_w$ 模擬', unit: 'fs', get: (r) => r.metrics.stdW },
  { name: '$\\sigma_{w,\\mathrm{pred}}$', unit: 'fs', get: (r) => r.analytic.sigmaWPred },
  { name: 'settling block', unit: 'block', get: (r) => r.metrics.settlingBlock ?? '未收斂' },
  { name: '$\\mathrm{RMS}(t_{\\mathrm{out}})$', unit: 'fs', get: (r) => r.output?.rmsOut ?? null },
  { name: '　靜態殘差部分', unit: 'fs', get: (r) => r.output?.rmsStatic ?? null },
  { name: '　gain-noise 部分', unit: 'fs', get: (r) => r.output?.rmsNoise ?? null },
  { name: '$[f_L,f_H]$ jitter（模擬）', unit: 'fs', get: (r) => r.output?.jitterBandSim ?? null },
  { name: 'fractional spur（toneFit）', unit: 'dBc', get: (r) => r.output?.toneFitSim?.dbc ?? null },
  { name: '最大偵測 tone', unit: 'dBc', get: (r) => r.output?.tones[0]?.dbc ?? null },
  { name: '飽和 / wrap 次數', get: (r) => `${r.metrics.saturationCount} / ${r.metrics.wrapCount}` },
  { name: '警告數', get: (r) => collectWarnings(r).filter((w) => !isInformational(w.text)).length },
]

function cell(v: number | string | null): string {
  if (v === null || (typeof v === 'number' && Number.isNaN(v))) return '—' // NaN：不適用（例如不穩定時沒有 τ、沒有 σ_w 預測）
  return typeof v === 'string' ? v : sig(v, 5)
}

function fmtParam(v: LabParams[keyof LabParams]): string {
  return typeof v === 'number' ? sig(v, 8) : String(v)
}

/** 實驗 'unified-lab-compare'：Case A / B / C 的成對比較（同一個 seed）。 */
export function CompareTab() {
  const { compare, params: base } = useLab()
  const { cases, results, running, run, cancel } = compare
  const pal = usePalette()
  const { presets, onLoadPreset } = useShellPresets(EXP.compare)
  const [unit, setUnit] = useState<PsdUnit>('dbc')

  const list = useMemo(() => cases.cases.map((c) => ({ id: c.id, seriesIndex: c.seriesIndex, params: { ...c.params, seed: cases.seed } })), [cases.cases, cases.seed])
  const errs = useMemo(() => list.map((c) => ({ id: c.id, errors: labParamErrors(c.params) })), [list])
  const anyErr = errs.some((e) => e.errors.length > 0)
  const diffs = useMemo(() => diffKeys(list.map((c) => c.params)), [list])

  const { items, failed } = useMemo(() => {
    const its: (CompareItem & { stale: boolean })[] = []
    const bad: { id: CaseId; error: string }[] = []
    for (const c of list) {
      const r = results[c.id]
      if (!r) continue
      if ('error' in r) {
        if (r.key === labKey(c.params)) bad.push({ id: c.id, error: r.error })
        continue
      }
      its.push({ id: c.id, seriesIndex: c.seriesIndex, res: r.res, stale: r.key !== labKey(c.params) })
    }
    return { items: its, failed: bad }
  }, [list, results])
  const anyStale = items.some((i) => i.stale) || items.length < list.length
  const fW = useMemo(() => (items.length > 0 ? figCompareW(items, pal) : null), [items, pal])
  const fPsd = useMemo(() => (items.length > 0 ? figComparePsd(items, pal, unit) : null), [items, pal, unit])

  const warnings: string[] = []
  for (const e of errs) for (const x of e.errors) warnings.push(`Case ${e.id} 參數不合法：${x}`)
  for (const f of failed) warnings.push(`Case ${f.id} 模擬失敗：${tw(f.error)}`)
  for (const it of items) {
    if (it.stale) continue
    for (const w of collectWarnings(it.res)) if (!isInformational(w.text)) warnings.push(`Case ${it.id}【${w.stage}】${tw(w.text)}`)
  }

  const metrics: MetricRow[] = items
    .filter((i) => !i.stale)
    .flatMap((it) => {
      const c = it.res.checks
      return [
        {
          name: `Case ${it.id}：mean $w$（後半段）`,
          value: it.res.metrics.meanW,
          unit: 'fs',
          claim: 'approx' as const,
          formulaId: 'F-LAB.9',
          ...(c.meanW.analytic !== undefined && c.meanW.tolerance !== undefined ? { analytic: c.meanW.analytic, tolerance: c.meanW.tolerance } : {}),
        },
        { name: `Case ${it.id}：$\\mathrm{RMS}(t_{\\mathrm{out}})$`, value: it.res.output ? it.res.output.rmsOut : null, unit: 'fs', claim: 'exact' as const, formulaId: 'F-LAB.10' },
      ]
    })

  const fresh = useMemo(() => items.filter((i) => !i.stale), [items])
  const crossCheck = useMemo<CrossCheck>(() => compareCrossCheck(fresh.map((i) => ({ id: i.id, cc: pipelineCrossCheck(i.res) }))), [fresh])

  return (
    <ExperimentShell
      id={EXP.compare}
      title="Compare A / B / C：同一個 seed 的成對比較"
      level={list.some((c) => c.params.quantize) ? 'L5' : 'L4'}
      claim="approx"
      source="simulation"
      headingLevel={3}
      description={
        <>
          最多三組完整的 pipeline 設定，用<strong>同一個 seed</strong> 各跑一次，疊在同一張圖上。適合回答「只改這一個參數（regressor、DSM 階數、PLL 型式、位元數…）會差多少」。
        </>
      }
      assumptions={ASSUMPTIONS}
      params={Object.fromEntries(list.map((c) => [`case_${c.id}`, JSON.stringify(c.params)])) as Record<string, unknown>}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={LAB_UNITS}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          cancel()
          cases.reset(DEFAULT_LAB_PARAMS)
        },
        onRun: () => {
          if (!anyErr) void run(list)
        },
        onStop: cancel,
        running: running !== null,
      }}
      exportData={() => {
        if (items.length === 0) throw new Error('還沒有比較結果（先按 Run）')
        const cols: Record<string, ArrayLike<number>> = {}
        for (const it of items) {
          cols[`${it.id}_block_k`] = it.res.blocks.k
          cols[`${it.id}_w_fs`] = it.res.blocks.w
          cols[`${it.id}_w_model_fs`] = it.res.blocks.wMeanModel
          if (it.res.output) {
            cols[`${it.id}_psd_f_hz`] = it.res.output.psdSim.f
            cols[`${it.id}_psd_fs2_per_hz`] = it.res.output.psdSim.psd
          }
        }
        return cols
      }}
      presets={presets}
      onLoadPreset={onLoadPreset}
      controls={
        <>
          <CaseSelector cases={cases} />
          <button type="button" className="btn" onClick={() => cases.update(() => ({ ...base }))}>
            把 Pipeline 分頁目前的參數複製到 Case {cases.activeId}
          </button>
          <p className="small muted">下面的面板編輯的是 Case {cases.activeId}。「＋ Case」會複製目前這一組，再改你想比較的欄位。</p>
          <ParamPanel value={cases.active.params} onChange={(p) => cases.update(p)} open={['dsm', 'gmac', 'update']} idPrefix={`Case ${cases.activeId}：`} />
        </>
      }
    >
      <PresetNote experiment={EXP.compare} />
      <div className="lab-status small" role="status">
        {running !== null ? `正在執行 Case ${running}…` : items.length === 0 ? '尚未執行：按「執行 Run」會依序跑每個 case（預設每個約 1 秒）。' : anyStale ? '有 case 的參數已改過或尚未執行：按「執行 Run」更新。' : `${items.length} 個 case 的結果都對應目前參數（seed ${cases.seed}）。`}
      </div>

      <h4 className="lab-subhead">差異表：各 case 之間不同的參數</h4>
      {list.length < 2 ? (
        <p className="small muted">目前只有 Case A。按左側的「＋ Case B」複製一組，再修改要比較的參數。</p>
      ) : diffs.length === 0 ? (
        <Callout kind="warn" title="各 case 的參數完全相同">
          <p>同一個 seed、同一組參數會得到逐位元相同的結果。請至少改一個欄位。</p>
        </Callout>
      ) : (
        <div className="table-wrap">
          <table className="lab-table">
            <thead>
              <tr>
                <th>參數</th>
                {list.map((c) => (
                  <th key={c.id} className="lab-num">
                    <span className="lab-dot" style={{ background: `var(--series-${c.seriesIndex + 1})` }} aria-hidden="true" /> Case {c.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diffs.map((k) => (
                <tr key={k}>
                  <th scope="row">{md(labelOf(k))}</th>
                  {list.map((c) => (
                    <td key={c.id} className="mono lab-num">
                      {fmtParam(c.params[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div className={anyStale ? 'lab-results lab-stale' : 'lab-results'}>
          {fW && <Plot title="各 case 的 $w_k$ 軌跡（實線）與 mean-field 平均軌跡（虛線）" csvName="compare-w" data={fW.data} layout={fW.layout} height={330} caption="同一個 seed：如果兩個 case 的 $x_{\mathrm{ref}}$ 與 $u$ 完全相同，連雜訊造成的小抖動都會重合。" />}
          <SelectControl<PsdUnit>
            label="PSD 的單位"
            value={unit}
            onChange={setUnit}
            reg="UI: PSD unit"
            options={[
              { value: 'dbc', label: 'ℒ(f) [dBc/Hz]' },
              { value: 'fs2', label: 'S_t [fs²/Hz]（one-sided）' },
            ]}
          />
          {fPsd && <Plot title="各 case 的輸出 timing-error PSD" csvName="compare-psd" data={fPsd.data} layout={fPsd.layout} xLog yLog={unit === 'fs2'} height={330} caption="Welch、Hann、one-sided、sample-rate 頻率軸；對數格點每格取最大值。各 case 的視窗長度（outBlocks $\times N$）不同時，頻率解析度與譜線高度不可直接比，請看下表的 RMS 與 peak-based dBc。" />}
          <h4 className="lab-subhead">並排指標</h4>
          <div className="table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>指標</th>
                  {items.map((it) => (
                    <th key={it.id} className="lab-num">
                      <span className="lab-dot" style={{ background: `var(--series-${it.seriesIndex + 1})` }} aria-hidden="true" /> Case {it.id}
                      {it.stale && <div className="small lab-stale-flag">舊結果</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.name}>
                    <th scope="row">
                      {md(r.name)}
                      {r.unit && <span className="small muted">（{r.unit}）</span>}
                    </th>
                    {items.map((it) => (
                      <td key={it.id} className="mono lab-num">
                        {cell(r.get(it.res))}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">跨級一致性（replay）</th>
                  {items.map((it) => (
                    <td key={it.id} className="lab-num">
                      <StatusPill status={it.res.checks.replay.status} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">
                    mean <Tex>w</Tex> vs 平均模型
                  </th>
                  {items.map((it) => (
                    <td key={it.id} className="lab-num">
                      <StatusPill status={it.res.checks.meanW.status} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ExperimentShell>
  )
}
