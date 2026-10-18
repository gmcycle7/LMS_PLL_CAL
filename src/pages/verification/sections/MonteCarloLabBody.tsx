import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, CodeBlock, ExperimentShell, ModeGate, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type CrossCheck, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import {
  clampMcScale,
  falseAlarmRate,
  MC_IDS,
  MC_PLAN,
  MC_SCALE_MAX,
  MC_SCALE_MIN,
  tCritical,
  type AcceptanceMcParams,
  type AcceptanceMcResult,
  type McCheck,
} from '@/simulation/models/acceptance'
import { M, PassMark, useAcceptance } from '../common'
import { ACCEPTANCE_ROWS } from '../data'
import { fmtNum, texNum, texToPlain } from '../format'
import { idsOfSubset, isMcSubset, type McSubset } from '../mcSubsets'
import { McTheory } from './McTheory'
import { McSweepLab } from './McSweepLab'

export const MC_EXPERIMENT_ID = 'acceptance-mc'

interface McUiParams {
  scale: number
  zCrit: number
  subset: McSubset
}

const DEFAULT_UI: McUiParams = { scale: 1, zCrit: 4, subset: 'all' }
const DEFAULT_SEED = 20261010

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '預設：全部項目、×1、z_crit = 4', params: { scale: 1, zCrit: 4, subset: 'all', seed: DEFAULT_SEED }, description: '約 1–3 秒（Web Worker）' },
  { name: '快速 smoke：×0.25、只跑單步／Binomial 項目', params: { scale: 0.25, zCrit: 4, subset: 'fast', seed: DEFAULT_SEED } },
  { name: '大樣本 ×4（SE 減半，可偵測的偏差減半）', params: { scale: 4, zCrit: 4, subset: 'all', seed: DEFAULT_SEED } },
  { name: '換 seed（可重現性）', params: { scale: 1, zCrit: 4, subset: 'all', seed: 1 }, description: '同 seed 再跑一次結果逐位元相同；換 seed 則 z 隨機變動但應落在 ±4 內' },
  { name: '過嚴的門檻 z_crit = 2（示範誤報）', params: { scale: 1, zCrit: 2, subset: 'all', seed: DEFAULT_SEED }, description: '單項誤報率 4.6%：十幾項中常會有 1 項被冤枉' },
  { name: '太少樣本 ×0.05（示範檢定力不足）', params: { scale: 0.05, zCrit: 4, subset: 'fast', seed: DEFAULT_SEED }, description: 'E02 反面項目可能無法被拒絕（SE 太大）' },
]

function zCell(c: McCheck) {
  if (c.kind === 'behaviour' || !Number.isFinite(c.z)) return <span className="muted">—（行為檢查）</span>
  const w = Math.min(100, (Math.abs(c.z) / Math.max(c.zCrit, 1e-9)) * 60)
  const bad = c.kind === 'z' && c.expect === 'agree' && Math.abs(c.z) > c.zCrit
  return (
    <span className="ver-z-cell">
      <span className={`ver-z-bar${bad ? ' bad' : ''}`} style={{ width: `${w}px` }} aria-hidden="true" /> {fmtNum(c.z, 3)}
      {Number.isFinite(c.dof) && (
        <span className="small muted">
          {' '}
          （<Tex>{`t=${fmtNum(c.t, 3)},\\ \\nu=${c.dof}`}</Tex>）
        </span>
      )}
      {c.kind === 'model' && <span className="small muted">（僅供參考）</span>}
    </span>
  )
}

const r = String.raw

/** 有 MC 的 T-id 依模型層級分組（取自驗收表的 metadata，例如「L0：T03；L1：T04、T05…」） */
const MC_LEVELS = (() => {
  const by = new Map<string, string[]>()
  for (const row of ACCEPTANCE_ROWS) {
    if (!MC_IDS.includes(row.id)) continue
    by.set(row.level, [...(by.get(row.level) ?? []), row.id])
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([level, ids]) => `${level}：${ids.join('、')}`)
    .join('；')
})()

/** §V.3 Monte Carlo 驗收（worker） */
export function MonteCarloLabBody() {
  const st = useAcceptance()
  const tokens = useThemeTokens()
  const [ui, setUi] = useState<McUiParams>(DEFAULT_UI)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [result, setResult] = useState<AcceptanceMcResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const task = useWorkerTask<AcceptanceMcParams, AcceptanceMcResult>('acceptance', 'runAcceptanceMonteCarlo', { restartOnRun: true })
  const jsonPresets = useMemo(() => presetsForExperiment(MC_EXPERIMENT_ID), [])
  const urlPreset = useUrlPreset(MC_EXPERIMENT_ID)

  const applyParams = useCallback((p: Record<string, unknown>) => {
    setUi((u) => ({
      scale: typeof p.scale === 'number' && p.scale > 0 ? clampMcScale(p.scale) : u.scale,
      zCrit: typeof p.zCrit === 'number' && p.zCrit >= 1 && p.zCrit <= 8 ? p.zCrit : u.zCrit,
      subset: isMcSubset(p.subset) ? p.subset : u.subset,
    }))
    if (typeof p.seed === 'number' && Number.isInteger(p.seed) && p.seed >= 0) setSeed(p.seed)
    setResult(null)
  }, [])

  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  const params: AcceptanceMcParams = useMemo(() => ({ seed, scale: ui.scale, zCrit: ui.zCrit, ids: idsOfSubset(ui.subset) }), [seed, ui])

  const run = useCallback(() => {
    setError(null)
    task.run(params).then(setResult, (e: unknown) => {
      if (!isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
    })
  }, [task, params])

  // 結果與目前參數不同步時標示「過期」（z_crit 也是參數：改了要重跑才會重新判定）
  const stale = result !== null && (result.seed !== seed || result.scale !== clampMcScale(ui.scale) || result.zCrit !== ui.zCrit)
  const checks = useMemo(() => result?.checks ?? [], [result])
  const nPass = checks.filter((c) => c.pass).length
  const alpha = falseAlarmRate(ui.zCrit)
  const planned = MC_PLAN.filter((c) => idsOfSubset(ui.subset).includes(c.id))
  const nIndep = planned.filter((c) => c.kind === 'z' && c.independent && c.expect === 'agree').length

  const crossCheck: CrossCheck = {
    analytic: {
      status: st.rowsPassed === st.rows.length ? 'ok' : 'mismatch',
      note: `確定性 T01–T18：${st.rowsPassed}/${st.rows.length} 列、${st.keysPassed}/${st.keysTotal} 個 golden key 一致`,
    },
    monteCarlo: result
      ? { status: nPass === checks.length ? 'ok' : 'mismatch', note: `${nPass}/${checks.length} 項 MC 檢查通過（$z_{\\rm crit}=${result.zCrit}$${stale ? '；參數已改變，結果過期' : ''}）` }
      : { status: 'n/a', note: '尚未執行：按「執行 Run」在 Web Worker 中跑 Monte Carlo' },
    fixedPoint: { status: 'not-implemented', note: 'T01–T18 不含 bit-true RTL 比對；T16 的 EFB 以精確有理數運算，定點 RTL 見 Ch13 / Ch04（未接到本頁）' },
  }

  const warnings: string[] = []
  if (result && nPass < checks.length) {
    for (const c of checks.filter((x) => !x.pass)) {
      if (c.kind === 'z') {
        warnings.push(
          c.expect === 'agree'
            ? `${c.id}「${c.label}」：$z=${texNum(c.z, 3)}$，$|z|>z_{\\rm crit}=${c.zCrit}$。若只有這一項且 $|z|$ 接近門檻，可能是誤報（單項 $\\alpha=${texNum(falseAlarmRate(c.zCrit), 3)}$）：換 seed 或加大樣本再跑；持續失敗才代表模型與期望值不符。`
            : `${c.id}「${c.label}」：反面項目應被拒絕，但 $|z|=${texNum(Math.abs(c.z), 3)}\\le z_{\\rm crit}=${c.zCrit}$。原因是樣本太少（$\\mathrm{SE}=${texNum(c.se, 3)}$，要拒絕需 $|\\hat\\theta-\\theta|>z_{\\rm crit}\\mathrm{SE}=${texNum(c.zCrit * c.se, 3)}$）：加大 scale。`,
        )
      } else {
        warnings.push(`${c.id}「${c.label}」：${c.kind === 'model' ? '與線性模型的比對' : '行為檢查'}未通過——${c.note}`)
      }
    }
  }
  if (ui.zCrit < 3) warnings.push(`$z_{\\rm crit}=${ui.zCrit}$ 太嚴：單項誤報率 $\\alpha=${texNum(alpha, 3)}$，${nIndep} 項獨立檢查中至少一項被冤枉的機率約 $1-(1-\\alpha)^{${nIndep}}=${texNum(1 - Math.pow(1 - alpha, nIndep), 3)}$。`)
  if (ui.scale < 0.25)
    warnings.push(`樣本倍率 $\\times${ui.scale}$ 很小：$\\mathrm{SE}\\propto1/\\sqrt{\\text{scale}}$ 變大，檢定力下降，E02 反面項目可能無法被拒絕；T14 用的漸近 SE（Bartlett）在 chain 很短時也會低估（scale $<0.1$ 時每條只有約 200 個 block，低估一成多）。`)

  const metrics: MetricRow[] = checks.map((c) => ({
    name: `${c.id} ${c.quantity}`,
    value: c.estimate,
    analytic: c.kind === 'z' && c.expect === 'agree' ? c.target : undefined,
    // 門檻以「幾個 SE」表示：SE 是估計值時（ν 有限）要用 t_crit(z_crit, ν) > z_crit，才和判定（等效 z）一致
    tolerance: c.kind === 'z' && c.expect === 'agree' ? tCritical(c.zCrit, c.dof) * c.se : undefined,
    toleranceMode: 'abs',
    claim: 'approx',
    digits: 7,
    note:
      c.kind === 'behaviour'
        ? c.note
        : `$\\mathrm{SE}=${texNum(c.se, 3)}$，$z=${texNum(c.z, 3)}$${Number.isFinite(c.dof) ? `（$t=${texNum(c.t, 3)}$，$\\nu=${c.dof}$，容許 $|t|\\le${texNum(tCritical(c.zCrit, c.dof), 3)}$）` : ''}${c.expect === 'reject' ? '（反面：應 $|z|>z_{\\rm crit}$）' : ''}${c.kind === 'model' ? '（容忍度另含模型誤差項）' : ''}`,
  }))

  const zPlot = useMemo(() => {
    const zs = checks.filter((c) => c.kind !== 'behaviour' && Number.isFinite(c.z))
    const labels = zs.map((c) => c.key)
    const zc = result?.zCrit ?? ui.zCrit
    const data: Data[] = [
      {
        type: 'bar',
        x: labels,
        y: zs.map((c) => c.z),
        name: '$z = (\\text{估計} - \\text{期望})/\\mathrm{SE}$',
        marker: { color: zs.map((c) => (c.pass ? tokens.series[0] : tokens.series[1])) },
        hovertext: zs.map((c) => `${c.label}<br>$z = ${c.z.toFixed(3)}$${c.expect === 'reject' ? '（反面：應超出門檻）' : ''}`),
        hoverinfo: 'text',
      },
      { type: 'scatter', mode: 'lines', x: [labels[0], labels[labels.length - 1]], y: [zc, zc], name: '$+z_{\\mathrm{crit}}$', line: { dash: 'dash', color: tokens.textMuted } },
      { type: 'scatter', mode: 'lines', x: [labels[0], labels[labels.length - 1]], y: [-zc, -zc], name: '$-z_{\\mathrm{crit}}$', line: { dash: 'dash', color: tokens.textMuted } },
    ]
    return { data, layout: { yaxis: { title: { text: '$z$（標準誤）' }, zeroline: true }, xaxis: { title: { text: '檢查項目（MC_PLAN 的 key）' } }, showlegend: true } }
  }, [checks, ui.zCrit, result, tokens])

  const presets: ExperimentPreset[] = useMemo(
    () => [...INLINE_PRESETS, ...jsonPresets.map((p) => ({ name: p.title, params: p.params, description: p.description }))],
    [jsonPresets],
  )

  return (
    <>
      <p>
        golden vectors 只放確定性的值（封閉式、精確 Binomial、數值求根）——TypeScript 與 NumPy 的亂數產生器不同，MC 結果本來就不會逐位元相同。所以隨機項目改用
        <strong>統計判定</strong>：用自己的 seed 跑，算估計值 <Tex>{r`\hat\theta`}</Tex> 與標準誤 <Tex>{r`\mathrm{SE}`}</Tex>，看{' '}
        <Tex>{r`z=(\hat\theta-\theta)/\mathrm{SE}`}</Tex> 有沒有超過門檻。下面先補三個先備知識、手算一次，再推導判定規則，最後讓你自己跑。
      </p>
      <McTheory />

      <div>
        <ExperimentShell
          id={MC_EXPERIMENT_ID}
          title="Acceptance Monte Carlo（T03–T18 的隨機項目）"
          level="L1"
          claim="approx"
          source="simulation"
          tests={MC_IDS}
          headingLevel={3}
          description={
            <>
              每一項用 <code>deriveSeed(seed, key)</code> 的獨立亂數流，在 Web Worker 中呼叫各章的 MC 函式；判定 <Tex>{r`|z|\le z_{\rm crit}`}</Tex>。各項的模型層級與 §V.2 相同（{MC_LEVELS}
              ），上方的 ModelLevel 標示的是多數項目所在的 L1（Block GMAC + Gaussian comparator）。目前選的項目共 {planned.length} 項檢查，其中 {nIndep} 項是互相獨立、經過校準的 <Tex>{'z'}</Tex> 檢定。
            </>
          }
          assumptions={[
            '每項各自 fork seed：增減其他項目不改變某一項的亂數流（T13 與 T14 例外：它們共用同一批樣本）。',
            '$z$ 檢定假設估計量近似常態（CLT）；SE 由少數 chain 估計時（T12：$\\nu=15$、T13：$\\nu=23$）先把 Student-$t$ 換成等效 $z$。',
            '估計量有已知的有限樣本偏差時（T13 的 $s^2$、T14 的 $\\hat p$），期望值先做偏差修正（F-VF.6、F-VF.7）。',
            'T06 / T07 是「與線性模型比對」：沿用 polarity 模型的容忍度 $4\\,\\mathrm{SE}+10\\%|m_{k^*}|+2\\%|\\delta_0|$（含線性化誤差），不是純統計檢定；T18 是行為檢查，沒有 $z$。',
            'T13 / T14 用 $x=\\pm1$ 的精確 Binomial 化簡（$\\sum q\\,x=2\\,\\mathrm{Binomial}(N,\\Phi)-N$），與逐 sample 模擬的分布相同。',
            'Fixed-point（bit-true RTL）不在 T01–T18 的驗收範圍內。',
          ]}
          params={{ scale: ui.scale, zCrit: ui.zCrit, subset: ui.subset }}
          seed={seed}
          onSeedChange={(s) => {
            setSeed(s)
            setResult(null)
          }}
          units={{ scale: '×', zCrit: 'SE' }}
          metrics={metrics}
          warnings={warnings}
          crossCheck={crossCheck}
          actions={{ onRun: run, onStop: () => task.cancel(), onReset: () => applyParams({ ...DEFAULT_UI, seed: DEFAULT_SEED }), running: task.running }}
          exportData={() => {
            if (!result) throw new Error('尚未執行 Monte Carlo：先按「執行 Run」')
            return {
              id: checks.map((c) => c.id),
              key: checks.map((c) => c.key),
              label: checks.map((c) => texToPlain(c.label)),
              quantity: checks.map((c) => texToPlain(c.quantity)),
              kind: checks.map((c) => c.kind),
              expect: checks.map((c) => c.expect),
              independent: checks.map((c) => (c.independent ? 1 : 0)),
              estimate: checks.map((c) => c.estimate),
              se: checks.map((c) => c.se),
              target: checks.map((c) => c.target),
              t: checks.map((c) => c.t),
              dof: checks.map((c) => (Number.isFinite(c.dof) ? c.dof : 'inf')),
              z: checks.map((c) => c.z),
              z_crit: checks.map((c) => c.zCrit),
              pass: checks.map((c) => (c.pass ? 1 : 0)),
              samples: checks.map((c) => c.samples),
              seed: checks.map((c) => c.seed),
              ms: checks.map((c) => c.ms),
            }
          }}
          presets={presets}
          onLoadPreset={(p) => applyParams(p.params)}
          controls={
            <>
              <ParamControl
                label="樣本數倍率 scale"
                ariaLabel="Monte Carlo 樣本數倍率"
                value={ui.scale}
                onChange={(scale) => {
                  setUi((u) => ({ ...u, scale }))
                  setResult(null)
                }}
                min={MC_SCALE_MIN}
                max={MC_SCALE_MAX}
                log
                unit={String.raw`$\times$`}
                reg="mc_scale（behavioral）"
                hint={M('每項的樣本數 $\\times$ scale；$\\mathrm{SE}\\propto1/\\sqrt{\\text{scale}}$')}
              />
              <ParamControl
                label={M('判定門檻 $z_{\\rm crit}$')}
                ariaLabel="z 判定門檻"
                value={ui.zCrit}
                onChange={(zCrit) => setUi((u) => ({ ...u, zCrit }))}
                min={1}
                max={8}
                step={0.1}
                unit="SE"
                reg="z_crit（behavioral）"
                hint={M(`單項誤報率 $\\alpha=${texNum(alpha, 3)}$；改了要重跑才會重新判定`)}
              />
              <SelectControl
                label="項目"
                value={ui.subset}
                onChange={(subset) => {
                  setUi((u) => ({ ...u, subset }))
                  setResult(null)
                }}
                reg="acceptance_subset（behavioral）"
                options={[
                  { value: 'all', label: `全部（${MC_IDS.join('、')}）` },
                  { value: 'fast', label: '快速：T03 T04 T05 T13 T14 T17' },
                  { value: 'closed-loop', label: '閉迴路：T06 T07 T12 T18' },
                  ...MC_IDS.map((id) => ({ value: id, label: `只跑 ${id}` })),
                ]}
              />
            </>
          }
        >
          {error && (
            <Callout kind="danger" title="Monte Carlo 執行失敗">
              {error}
            </Callout>
          )}
          {!result && !task.running && (
            <>
              <p className="muted" data-testid="mc-idle">
                按上方「執行 Run」開始（{task.mode === 'worker' ? 'Web Worker' : '此環境不支援 Worker，將在主執行緒執行'}）。將執行的檢查：
              </p>
              <ul className="small ver-plan">
                {planned.map((c) => (
                  <li key={c.key}>
                    <strong>{c.id}</strong> {M(c.label)}
                    <span className="muted">
                      {c.kind === 'model' ? '（與線性模型比對）' : c.kind === 'behaviour' ? '（行為檢查）' : c.expect === 'reject' ? '（反面：應被拒絕）' : c.independent ? '' : '（非獨立）'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {task.running && <p className="muted">執行中…（可按「停止」取消）</p>}
          {result && (
            <>
              {stale && (
                <Callout kind="warn" title="結果已過期">
                  參數或 seed 已改變；下表是 seed {result.seed}、×{result.scale}、<Tex>{`z_{\\rm crit}=${result.zCrit}`}</Tex> 的結果，按「執行 Run」重新計算。
                </Callout>
              )}
              <p>
                <PassMark pass={nPass === checks.length} label={`${nPass}/${checks.length} 項通過`} />
                <span className="small muted">
                  {' '}
                  （worker 內總計 {fmtNum(result.totalMs, 4)} ms；單項 <Tex>{`\\alpha=${texNum(falseAlarmRate(result.zCrit), 3)}`}</Tex>）
                </span>
              </p>
              <div className="table-wrap">
                <table className="ver-table" data-testid="mc-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>檢查</th>
                      <th>
                        估計 <Tex>{r`\hat\theta\pm\mathrm{SE}`}</Tex>
                      </th>
                      <th>
                        期望 <Tex>{r`\theta`}</Tex>
                      </th>
                      <th>
                        <Tex>{'z'}</Tex>
                      </th>
                      <th>判定</th>
                      <th>樣本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((c) => (
                      <tr key={c.key} data-key={c.key}>
                        <td className="ver-tid">{c.id}</td>
                        <td className="ver-wide">
                          {M(c.label)}
                          <div className="small muted">
                            {M(c.quantity)}｜{M(c.method)}
                            {c.expect === 'reject' ? '｜反面：應被拒絕' : ''}
                            {c.kind === 'model' ? '｜與線性模型比對' : ''}
                            {!c.independent ? '｜非獨立' : ''}
                          </div>
                          <div className="small muted">{M(c.note)}</div>
                        </td>
                        <td className="num">
                          {fmtNum(c.estimate, 7)}
                          {Number.isFinite(c.se) && <div className="muted">± {fmtNum(c.se, 3)}</div>}
                        </td>
                        <td className="num">{c.kind === 'behaviour' ? <>&gt; {fmtNum(c.target, 5)}</> : fmtNum(c.target, 7)}</td>
                        <td>{zCell(c)}</td>
                        <td>
                          <PassMark pass={c.pass} label={c.pass && c.expect === 'reject' ? '已拒絕' : undefined} />
                        </td>
                        <td className="num">
                          <Tex>{texNum(c.samples, 3)}</Tex>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {zPlot.data.length > 0 && checks.some((c) => c.kind !== 'behaviour') && (
                <Plot
                  title="各項 $z$ 分數與 $\pm z_{\rm crit}$ 門檻"
                  data={zPlot.data}
                  layout={zPlot.layout}
                  height={300}
                  csvName="acceptance-mc-z"
                  ariaLabel="各項 Monte Carlo 檢查的 z 分數長條圖"
                  caption="反面項目（T05-strict）的長條應該遠遠超出門檻；T06 / T07 的 $z$ 只供參考（判定另含模型誤差項）。"
                />
              )}
            </>
          )}
        </ExperimentShell>
      </div>
      <Callout kind="info" title="試試看">
        <ol style={{ margin: 0 }}>
          <li>
            用預設值按「執行 Run」：每一列的 <Tex>{'|z|'}</Tex> 應該都小於 4，只有反面項目（E02）遠遠超出。
          </li>
          <li>
            把 seed 改成別的數字再跑：<Tex>{'z'}</Tex> 會變（這就是隨機性），但仍在門檻內。同一個 seed 再跑一次，數字逐位元相同。
          </li>
          <li>
            把 <Tex>{r`z_{\rm crit}`}</Tex> 調到 2 再跑幾個 seed：你會發現偶爾有一項被判失敗——那不是模型錯，是門檻太嚴（誤報）。
          </li>
          <li>
            把 scale 調到 0.05、選「快速」：E02 反面項目可能「無法被拒絕」——樣本太少，分不出 <Tex>{r`49.2\%`}</Tex> 和 <Tex>{r`53.2\%`}</Tex>。
          </li>
        </ol>
      </Callout>

      <McSweepLab />

      <ModeGate min="research">
        <CodeBlock
          source={acceptanceSrc}
          region="runAcceptanceMonteCarlo"
          path="src/simulation/models/acceptance.ts"
          caption="worker 實際執行的函式（useWorkerTask('acceptance', 'runAcceptanceMonteCarlo')）。每項都呼叫章節自己的 MC 函式，不另寫模擬。"
        />
      </ModeGate>
    </>
  )
}
