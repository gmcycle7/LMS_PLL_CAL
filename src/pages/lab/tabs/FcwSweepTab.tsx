import { useMemo } from 'react'
import { Callout, ClaimTag, ExperimentShell, ModeGate, ParamControl, Plot, SelectControl, Tex, ToggleControl, type MetricRow } from '@/components'
import { DEFAULT_LAB_PARAMS, DEFAULT_SWEEP_OPTIONS, type FcwPoint } from '@/simulation/models/unifiedLab'
import { fmtHz, md, Progress, sig, texNum } from '../common'
import { DEFAULT_SWEEP_GRID, EXP, summarizeSweep, sweepCrossCheck, sweepErrors, sweepExport, sweepWarnings, SWEEP_RANGES } from '../logic'
import { ParamPanel } from '../ParamPanel'
import { LAB_UNITS } from '../paramMeta'
import { useLab } from '../store'
import { figSweepBias, figSweepC, figSweepPe, figSweepPole, figSweepSlope, figSweepSpur } from './plots'
import { PresetNote, tw, usePalette, useShellPresets } from './shared'

const ASSUMPTIONS = [
  '每個 FCW 點獨立分析：其他參數與「共用參數」相同，只換 $\\alpha$（frac）',
  '$C=E[x_{\\mathrm{ref}}u_x]$ 用整段 code record 平均（一階 DSM 取整數個週期，至少 $2^{17}$ 個樣本、上限 $2^{19}$）；主 PLL 濾波器的暫態先略過',
  '$K=K_qC$、$g=\\mu K$、$\\rho$ 來自線性化平均模型；$\\lambda_{\\min}$ 是每個 GMAC block 的 $\\tfrac1N\\sum u_x^2$ 的最小值（§9.1 的有限窗口定義，單參數）',
  'bias 是線性化固定點 $w^*_{\\mathrm{lin}}-a=(E[x_{\\mathrm{ref}}H\\{d\\}]+bE[x_{\\mathrm{ref}}])/C$；$C\\le0$ 時 $w^*$ 是排斥點（到不了）。線性化只在把 $w^*_{\\mathrm{lin}}$ 代回去後、comparator 前的確定性殘差仍遠小於 $\\sigma_v$ 時可信：$C\\to0^+$ 時 bias 會大到超出這個範圍，$w^*_{\\mathrm{lin}}$ 就只是線性外推（Ch11 §11.4），這時以閉迴路的點為準',
  'fractional spur 用一階 DSM 的封閉式，並假設校正後還留有 $\\Delta a$ 的 gain 誤差（可調）；MASH 與開了 dither 的 code 沒有封閉式，該欄空白',
  'GMAC 斜率量測：凍結 $w=w^*\\pm\\Delta w$，兩邊用同一串 comparator 雜訊（common random numbers），95% CI 來自各 block 的差值',
  '開啟定點暫存器且「每點再跑閉迴路」時，每一段 FCW 再用 quantize = false 跑一次同 seed 的浮點對照：Fixed-Point 欄逐點比閉迴路後半段的 mean $w$（定點內部暫存器 vs 浮點），SE 用 AR(1) 公式、容差 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}$（和 Pipeline 分頁同一個判準）；執行時間因此加倍',
]

function fmtFrac(v: number): string {
  return v < 1e-3 ? v.toExponential(3) : sig(v, 4)
}

function SweepTable({ pts, loop }: { pts: FcwPoint[]; loop: boolean }) {
  return (
    <div className="table-wrap lab-scroll-y">
      <table className="lab-table lab-table-num">
        <thead>
          <tr>
            <th>
              <Tex>{'\\alpha'}</Tex>
            </th>
            <th>
              <Tex>{'K/M'}</Tex> 的 <Tex>K</Tex>
            </th>
            <th>
              週期 <Tex>P</Tex>
            </th>
            <th>
              <Tex>{'f_1'}</Tex>
            </th>
            <th>
              <Tex>C</Tex>
            </th>
            <th>
              <Tex>g</Tex>
            </th>
            <th>
              <Tex>{'\\rho'}</Tex>
            </th>
            <th>
              <Tex>{'\\tau'}</Tex> [blk]
            </th>
            <th>
              <Tex>{'\\lambda_{\\min}'}</Tex>
            </th>
            <th>bias [fs]</th>
            <th>spur [dBc]</th>
            {loop && <th>閉迴路 bias [fs]</th>}
            <th>判讀</th>
          </tr>
        </thead>
        <tbody>
          {pts.map((p, i) => {
            const verdict = p.signFlip ? '極性錯誤' : !p.stable ? '不穩定' : p.peLambdaMin < 1e-6 * Math.max(p.Ex2, 1e-300) ? 'PE 不足' : 'OK'
            return (
              <tr key={i} data-verdict={verdict} className={verdict === 'OK' ? undefined : 'lab-row-bad'}>
                <td className="mono">{fmtFrac(p.frac)}</td>
                <td className="mono">{p.K}</td>
                <td className="mono">{p.P > 0 ? p.P : '—'}</td>
                <td className="mono nowrap">{fmtHz(p.fracToneHz, 4)}</td>
                <td className="mono">{sig(p.C, 4)}</td>
                <td className="mono">{sig(p.g, 4)}</td>
                <td className="mono">{sig(p.rho, 6)}</td>
                <td className="mono">{Number.isFinite(p.tauBlocks) ? sig(p.tauBlocks, 4) : '—'}</td>
                <td className="mono">{sig(p.peLambdaMin, 3)}</td>
                <td className="mono">{sig(p.biasLin, 3)}</td>
                <td className="mono">{Number.isFinite(p.spurDbc) ? sig(p.spurDbc, 4) : '—'}</td>
                {loop && <td className="mono">{p.loop ? `${sig(p.loop.bias, 3)}${p.loop.converged ? '' : '（未收斂）'}` : '—'}</td>}
                <td className="nowrap">{verdict}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 實驗 'unified-lab-fcw'：FCW sweep（sweepFcwChunk，Web Worker 分段執行、有進度、可取消）。 */
export function FcwSweepTab() {
  const { params, patch, setParams, sweep } = useLab()
  const { grid, setGrid, opts, setOpts, state, running, error, run, cancel } = sweep
  const pal = usePalette()
  const { presets, onLoadPreset } = useShellPresets(EXP.fcw)

  const errors = useMemo(() => sweepErrors(grid, opts, params), [grid, opts, params])
  const key = JSON.stringify({ base: params, g: grid, o: opts })
  const pts = state.points
  const stale = state.key !== null && state.key !== key
  const done = pts.length
  const summary = useMemo(() => (pts.length > 0 ? summarizeSweep(pts, state.opts.loopBlocks) : null), [pts, state.opts.loopBlocks])

  const warnings = useMemo(() => {
    const w = errors.map((e) => `參數不合法：${e}`)
    if (error) w.push(`sweep 失敗：${tw(error)}`)
    if (summary && !stale) w.push(...sweepWarnings(summary, state.opts))
    return w
  }, [errors, error, summary, stale, state.opts])

  const metrics = useMemo<MetricRow[]>(() => {
    if (!summary) return []
    return [
      { name: '已完成的 FCW 點', value: `${summary.n} / ${state.total}` },
      { name: '$C\\le0$（極性錯誤）的點數', value: summary.flips.length, analytic: 0, tolerance: 0, claim: 'approx', formulaId: 'F-LAB.6', note: '解析值 0 = 期望所有 FCW 都有正確極性' },
      { name: '$\\min C$', value: summary.minC, claim: 'approx' },
      { name: '$\\max\\rho$', value: summary.maxRho, claim: 'exact', formulaId: 'F-LAB.7', note: '$<1$ 才（平均）收斂' },
      { name: '$\\min\\lambda_{\\min}$（PE）', value: summary.minPe, claim: 'exact', formulaId: 'F-LAB.13', note: '$\\approx0$ 表示某個 block 沒有激勵' },
      { name: '最差 fractional spur', value: Number.isFinite(summary.worstSpurDbc) ? summary.worstSpurDbc : '—', unit: 'dBc', claim: 'approx', formulaId: 'F-LAB.12', note: Number.isFinite(summary.worstSpurFrac) ? `發生在 $\\alpha=${texNum(summary.worstSpurFrac, 4)}$；假設殘餘 $\\Delta a=${texNum(state.opts.residualGainFs)}\\,\\mathrm{fs}$` : '只有一階 DSM（無 dither）有封閉式' },
    ]
  }, [summary, state.total, state.opts.residualGainFs])

  const base = state.base ?? params
  const crossCheck = useMemo(
    () => sweepCrossCheck(stale ? [] : pts, state.opts, base.quantize, base.quantize ? { points: state.twinPoints, lsbFs: base.lsbFs } : null),
    [pts, stale, state.opts, base.quantize, base.lsbFs, state.twinPoints],
  )

  const fC = useMemo(() => (pts.length > 1 ? figSweepC(pts, pal) : null), [pts, pal])
  const fPole = useMemo(() => (pts.length > 1 ? figSweepPole(pts, pal) : null), [pts, pal])
  const fPe = useMemo(() => (pts.length > 1 ? figSweepPe(pts, pal) : null), [pts, pal])
  const fBias = useMemo(() => (pts.length > 1 ? figSweepBias(pts, pal, true) : null), [pts, pal])
  const fSpur = useMemo(() => (pts.length > 1 && pts.some((p) => Number.isFinite(p.spurDbc)) ? figSweepSpur(pts, pal) : null), [pts, pal])
  const fSlope = useMemo(() => (pts.length > 1 ? figSweepSlope(pts, pal) : null), [pts, pal])
  const xLog = state.grid.scale === 'log'

  return (
    <ExperimentShell
      id={EXP.fcw}
      title="FCW sweep：每個 FCW 的 $C$、PE、bias、收斂與 sign flip"
      level="L2"
      claim="approx"
      source="simulation"
      headingLevel={3}
      description={
        <>
          同一組硬體設定、只換 FCW 的小數部分 <Tex>{'\\alpha'}</Tex>，逐點計算 <Tex>{'C=E[x_{\\mathrm{ref}}u_x]'}</Tex>、<Tex>{'g'}</Tex>、<Tex>{'\\rho'}</Tex>、PE、bias 與 spur（規格 §11.4、§16.2 的 FCW 列）。重點是找出「哪些 FCW 會讓更新極性反過來」。
        </>
      }
      assumptions={ASSUMPTIONS}
      params={{ ...params, sweep_min: grid.min, sweep_max: grid.max, sweep_points: grid.points, sweep_scale: grid.scale, ...opts } as unknown as Record<string, unknown>}
      seed={params.seed}
      onSeedChange={(s) => patch({ seed: s })}
      units={{ ...LAB_UNITS, sweep_min: 'dimensionless', sweep_max: 'dimensionless', deltaFs: 'fs', residualGainFs: 'fs per unit code' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          cancel()
          setParams({ ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order' })
          setGrid(DEFAULT_SWEEP_GRID)
          setOpts(DEFAULT_SWEEP_OPTIONS)
        },
        onRun: () => {
          if (errors.length === 0) void run(params, grid, opts)
        },
        onStop: cancel,
        running,
      }}
      exportData={() => {
        if (pts.length === 0) throw new Error('還沒有 sweep 結果（先按 Run）')
        return state.twinPoints.length > 0 ? { ...sweepExport(pts), loop_mean_w_float_twin_fs: pts.map((_, i) => state.twinPoints[i]?.loop?.meanW ?? null) } : sweepExport(pts)
      }}
      presets={presets}
      onLoadPreset={onLoadPreset}
      controls={
        <>
          <details className="lab-group" open>
            <summary>
              <span className="lab-group-title">FCW 格點與分析選項</span>
            </summary>
            <div className="lab-group-body">
              <ParamControl label={md('下限 $\\alpha_{\\min}$')} ariaLabel="sweep 下限" value={grid.min} onChange={(v) => setGrid({ ...grid, min: v })} min={SWEEP_RANGES.min.min} max={SWEEP_RANGES.min.max} log digits={8} reg="REG_FCW_FRAC（sweep 起點）" hint="可精確輸入，例如 0.00001" />
              <ParamControl label={md('上限 $\\alpha_{\\max}$')} ariaLabel="sweep 上限" value={grid.max} onChange={(v) => setGrid({ ...grid, max: v })} min={SWEEP_RANGES.max.min} max={SWEEP_RANGES.max.max} log digits={8} reg="REG_FCW_FRAC（sweep 終點）" />
              <ParamControl label="點數" value={grid.points} onChange={(v) => setGrid({ ...grid, points: Math.round(v) })} min={SWEEP_RANGES.points.min} max={SWEEP_RANGES.points.max} step={1} integer clampOnBlur unit="點" reg="simulation: sweep points" />
              <SelectControl<'log' | 'linear'> label="格點" value={grid.scale} onChange={(v) => setGrid({ ...grid, scale: v })} options={[{ value: 'log', label: '對數（強調近整數）' }, { value: 'linear', label: '線性' }]} reg="simulation: sweep scale" />
              <ToggleControl label={md('量測 GMAC 斜率（凍結 $w^*\\pm\\Delta w$）')} ariaLabel="量測 GMAC 斜率" value={opts.slopeMc} onChange={(v) => setOpts({ ...opts, slopeMc: v })} reg="test mode: freeze + perturb" hint="sign-off 的基本正確性檢查（§16.2）：斜率為正才是負回授" />
              {opts.slopeMc && (
                <>
                  <ParamControl label={md('擾動 $\\Delta w$')} ariaLabel="擾動 Δw" value={opts.deltaFs} onChange={(v) => setOpts({ ...opts, deltaFs: v })} min={SWEEP_RANGES.deltaFs.min} max={SWEEP_RANGES.deltaFs.max} log unit="fs" reg="test mode: gain perturbation" hint={md('太大會離開 comparator 的線性區（$\\Delta w\\cdot|u|\\ll\\sigma_v$ 才準）')} />
                  <ParamControl label="斜率量測的 block 數" value={opts.slopeBlocks} onChange={(v) => setOpts({ ...opts, slopeBlocks: Math.round(v) })} min={SWEEP_RANGES.slopeBlocks.min} max={SWEEP_RANGES.slopeBlocks.max} step={1} integer clampOnBlur unit="block" reg="simulation: slope blocks" />
                </>
              )}
              <ToggleControl label="每點再跑閉迴路" value={opts.closedLoop} onChange={(v) => setOpts({ ...opts, closedLoop: v })} reg="simulation: closed loop per point" hint="較慢：每點多跑一次 runBlockLms，比對實際 mean w 與線性化 bias" />
              {opts.closedLoop && (
                <ParamControl label="每點閉迴路的 block 數" value={opts.loopBlocks} onChange={(v) => setOpts({ ...opts, loopBlocks: Math.round(v) })} min={SWEEP_RANGES.loopBlocks.min} max={SWEEP_RANGES.loopBlocks.max} step={10} integer clampOnBlur unit="block" reg="simulation: num_blocks" />
              )}
              <ParamControl label={md('假設的殘餘 gain 誤差 $\\Delta a$')} ariaLabel="殘餘 gain 誤差" value={opts.residualGainFs} onChange={(v) => setOpts({ ...opts, residualGainFs: v })} min={SWEEP_RANGES.residualGainFs.min} max={SWEEP_RANGES.residualGainFs.max} step={0.01} unit="fs" reg="behavioral: residual gain error" hint="算 fractional spur 用（spur 振幅與它成正比）" />
            </div>
          </details>
          <ParamPanel value={params} onChange={patch} open={['pll', 'gmac']} hide={['frac', 'blocks', 'outBlocks', 'fLHz', 'fHHz']} idPrefix="sweep：" />
        </>
      }
    >
      <PresetNote experiment={EXP.fcw} />
      {state.total > 0 ? <Progress done={done} total={state.total} label={running ? 'FCW sweep 進行中' : done < state.total ? 'FCW sweep 已停止' : 'FCW sweep 完成'} /> : <p className="small muted">尚未執行：設定好格點後按「執行 Run」。每點約 30–60 ms（開閉迴路時每點約 0.2–0.5 秒），可隨時停止。</p>}
      {stale && (
        <Callout kind="warn" title="下方是舊設定的結果">
          <p>參數已經改過；圖表與指標仍是上一次 sweep 的結果。按「執行 Run」重新計算。</p>
        </Callout>
      )}
      {pts.length > 1 && (
        <div className={stale ? 'lab-results lab-stale' : 'lab-results'}>
          {fC && (
            <Plot
              title="相關 $C=E[x_{\mathrm{ref}}u_x]$ 對 FCW：$C\le0$ 就是 sign flip"
              csvName="fcw-sweep-C"
              data={fC.data}
              layout={fC.layout}
              xLog={xLog}
              height={320}
              caption="灰色帶是各 GMAC block 的 $C_k$ 範圍（單一 block 可能反向，平均由整體 $C$ 決定）。叉號是 blockLms 用前 $2^{17}$ 個樣本的估計（record 涵蓋夠多週期時兩者應重合）。"
            />
          )}
          {fPole && <Plot title="平均模型的 pole 半徑 $\rho$ 與時間常數 $\tau$" csvName="fcw-sweep-pole" data={fPole.data} layout={fPole.layout} xLog={xLog} height={280} caption="$\rho\ge1$：平均誤差不收斂（$C\le0$ 或 $g$ 太大）。$\tau=-1/\ln\rho$；$C\to0^+$ 時 $\tau\to\infty$（學得到，但慢到沒有意義）。" />}
          {fPe && (
            <Plot
              title="Persistent Excitation：$\lambda_{\min}=\min_k\tfrac1N\sum_{n\in k}u_x^2$"
              csvName="fcw-sweep-pe"
              data={fPe.data}
              layout={fPe.layout}
              xLog={xLog}
              height={280}
              caption="$\lambda_{\min}\approx0$：至少有一個 block 的 PD 完全看不到 code（不可辨識）。近整數時 $H_{\mathrm{PD}}$ 把慢速鋸齒濾掉，只有 reset 的瞬間有訊號。"
            />
          )}
          <ModeGate min="engineer">
            {fBias && <Plot title="線性化 bias $w^*_{\mathrm{lin}}-a$（虛線：$\pm\sigma_{w,\mathrm{pred}}$）" csvName="fcw-sweep-bias" data={fBias.data} layout={fBias.layout} xLog={xLog} height={280} caption="bias 來自 offset / INL / code 平均經 $H_{\mathrm{PD}}$ 後與 regressor 的相關，除以 $C$——所以 $C\to0$ 時 bias 被放大（§11.4）；放大到 comparator 飽和時這條線只是線性外推，以閉迴路的點為準。點是閉迴路的實際 mean $w-a$（有開的話）。" />}
            {fSpur && <Plot title="fractional spur（假設殘餘 $\Delta a$）與輸出靈敏度" csvName="fcw-sweep-spur" data={fSpur.data} layout={fSpur.layout} xLog={xLog} height={280} caption="spur 振幅 $=|\Delta a|\,s\,A_1|T(f_1)|$：$f_1=\alpha f_{\mathrm{ref}}$ 落在 PLL 頻寬內（近整數）時 $|T|\approx1$，spur 最大；頻寬外被 $T$ 壓低。dBc 用 $20\log_{10}(\beta/2)$。這是行為模型的估計，不是量測。" />}
            {fSlope && <Plot title="GMAC 斜率：$S=-(G_+-G_-)/(2\Delta w)$（MC，95% CI）vs $K=K_qC$" csvName="fcw-sweep-slope" data={fSlope.data} layout={fSlope.layout} xLog={xLog} height={300} caption="這是 sign-off 的「freeze $\pm\Delta w$」量測（§16.2）在模型裡的版本：斜率為正才是負回授。mean-field 斜率是同一段 code 樣本、對 comparator 雜訊取期望的值，MC 應落在它的 CI 內。" />}
          </ModeGate>
          <h4 className="lab-subhead">
            逐點結果 <ClaimTag kind="approx" />
          </h4>
          <SweepTable pts={pts} loop={pts.some((p) => p.loop)} />
          {pts.some((p) => p.warnings.length > 0) && (
            <details className="lab-fold">
              <summary>各點的註記（{pts.reduce((a, p) => a + p.warnings.length, 0)} 則）</summary>
              <ul className="small">
                {pts.flatMap((p, i) =>
                  p.warnings.map((w, j) => (
                    <li key={`${i}-${j}`}>
                      <Tex>{`\\alpha=${texNum(p.frac, 4)}`}</Tex>：{md(tw(w))}
                    </li>
                  )),
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </ExperimentShell>
  )
}
