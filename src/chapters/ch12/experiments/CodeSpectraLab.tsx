import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  useDebouncedValue,
  useThemeTokens,
  type CrossCheck,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  CODE_LABEL,
  CODE_LABEL_TEX,
  calLoop,
  texNum,
  codeSpectraCurves,
  type CodeKind,
  type CodeSpectraParams,
  type CodeSpectraResult,
  type CodeSpectraSimParams,
  type CodeSpectraSimResult,
} from '@/simulation/models/calNoise'
import { codeLabel, md, sig, sigText } from '../common'

export interface CodeSpectraLabParams {
  N: number
  fs: number
  mu: number
  sigmaV: number
  C: number
  fx: number
  toneA: number
  fBw: number
  f3dbT: number
  zeta: number
  fL: number
  fH: number
  fOut: number
  blocks: number
  chains: number
  engine: 'linear' | 'binomial'
}

export const CODE_SPECTRA_DEFAULTS: CodeSpectraLabParams = {
  N: 4096,
  fs: 4e9,
  mu: 10,
  sigmaV: 100,
  C: 1,
  fx: 1e5,
  toneA: 1,
  fBw: 1e6,
  f3dbT: 1e6,
  zeta: 0.707,
  fL: 1e3,
  fH: 1e8,
  fOut: 13e9,
  blocks: 256,
  chains: 6,
  engine: 'linear',
}

const EXP_ID = 'code-spectra-lab'
// layout 放在模組層（參考不變）：worker 狀態改變造成的 re-render 不會重畫圖、也不會重設 zoom
const PSD_LAYOUT: Partial<Layout> = {
  margin: { r: 60 },
  xaxis: { title: { text: 'f [Hz]（sample rate f_s，one-sided）' } },
  yaxis: { title: { text: 'S_δt^(1) [fs²/Hz]' }, type: 'log', range: [-26, -3] },
  yaxis2: { title: { text: '|T|², |H_PD|²' }, type: 'log', overlaying: 'y', side: 'right', range: [-8, 1] },
}
const L_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'offset f [Hz]' } }, yaxis: { title: { text: 'ℒ(f) [dBc/Hz]' }, range: [-260, -110] } }
const KINDS: CodeKind[] = ['const', 'tone', 'white']

function toAnalytic(p: CodeSpectraLabParams): CodeSpectraParams {
  return { N: p.N, fs: p.fs, mu: p.mu, sigmaV: p.sigmaV, C: p.C, fx: p.fx, toneA: p.toneA, fBw: p.fBw, pll: { f3dbT: p.f3dbT, zeta: p.zeta }, fL: p.fL, fH: p.fH }
}

export function CodeSpectraLab() {
  const [prm, setPrm] = useState<CodeSpectraLabParams>(CODE_SPECTRA_DEFAULTS)
  const [seed, setSeed] = useState(20261010)
  const tokens = useThemeTokens()
  const an = useWorkerTask<CodeSpectraParams, CodeSpectraResult>('calNoise', 'codeSpectraAnalytic', { restartOnRun: true })
  const sim = useWorkerTask<CodeSpectraSimParams, CodeSpectraSimResult>('calNoise', 'simulateCodeSpectra', { restartOnRun: true })
  const runAn = an.run
  const [anRes, setAnRes] = useState<{ key: string; r: CodeSpectraResult } | null>(null)
  const [simRes, setSimRes] = useState<{ key: string; r: CodeSpectraSimResult } | null>(null)

  const urlPreset = useUrlPreset(EXP_ID)
  useEffect(() => {
    if (urlPreset) setPrm({ ...CODE_SPECTRA_DEFAULTS, ...(urlPreset.params as Partial<CodeSpectraLabParams>) })
  }, [urlPreset])
  const presets = useMemo(() => presetsForExperiment(EXP_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), [])

  const lp = useMemo(() => calLoop(prm), [prm])
  const aKey = JSON.stringify(toAnalytic(prm))
  const aKeyDeb = useDebouncedValue(aKey, 300)
  useEffect(() => {
    const p = JSON.parse(aKeyDeb) as CodeSpectraParams
    runAn(p)
      .then((r) => setAnRes({ key: aKeyDeb, r }))
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setAnRes(null)
      })
  }, [aKeyDeb, runAn])
  const analytic = anRes && anRes.key === aKey ? anRes.r : null

  const sKey = JSON.stringify({ ...prm, seed, fL: 0, fH: 0, f3dbT: 0, zeta: 0, fOut: 0 })
  const doSim = useCallback(() => {
    const k = sKey
    sim
      .run({ N: prm.N, fs: prm.fs, mu: prm.mu, sigmaV: prm.sigmaV, C: prm.C, fx: prm.fx, toneA: prm.toneA, fBw: prm.fBw, blocks: prm.blocks, chains: prm.chains, seed, engine: prm.engine })
      .then((r) => setSimRes({ key: k, r }))
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setSimRes(null)
      })
  }, [sKey, sim, prm, seed])
  const simCur = simRes && simRes.key === sKey ? simRes.r : null

  const curves = useMemo(() => codeSpectraCurves(toAnalytic(prm), 900), [prm])

  const psdData: Data[] = useMemo(() => {
    const f = Array.from(curves.f)
    const out: Data[] = KINDS.map((k, i) => ({
      x: f,
      y: Array.from(curves.dt[k]),
      name: `S_δt^(1)：${CODE_LABEL[k]}`,
      mode: 'lines',
      line: { color: tokens.series[i] },
    }))
    out.push(
      { x: f, y: Array.from(curves.t2), name: '|T(f)|²（右軸）', mode: 'lines', yaxis: 'y2', line: { dash: 'dash', color: tokens.textMuted } },
      { x: f, y: Array.from(curves.hpd2), name: '|H_PD(f)|²（右軸）', mode: 'lines', yaxis: 'y2', line: { dash: 'dot', color: tokens.textMuted } },
      { x: [Math.min(prm.fBw, prm.fs / 2), Math.min(prm.fBw, prm.fs / 2)], y: [1e-26, 1e-3], name: 'f_BW', mode: 'lines', line: { dash: 'dashdot', color: tokens.series[4] } },
    )
    return out
  }, [curves, tokens, prm.fBw, prm.fs])

  const lData: Data[] = useMemo(() => {
    const f = Array.from(curves.f)
    const k2 = (2 * Math.PI * prm.fOut * 1e-15) ** 2
    return KINDS.map((k, i) => ({
      x: f,
      y: f.map((_, j) => 10 * Math.log10(Math.max((k2 * curves.t2[j] * curves.dt[k][j]) / 2, 1e-300))),
      name: `ℒ(f)：${CODE_LABEL[k]}`,
      mode: 'lines',
      line: { color: tokens.series[i] },
    }))
  }, [curves, tokens, prm.fOut])

  const metrics: MetricRow[] = useMemo(() => {
    const rows: MetricRow[] = [
      { name: String.raw`$\sigma_w$（解析）`, value: lp.sigmaW, unit: 'fs', formulaId: 'F-12.5', claim: 'exact', digits: 6 },
      { name: String.raw`$f_u=f_s/N$`, value: lp.fu, unit: 'Hz', digits: 7 },
    ]
    if (analytic) {
      for (const r of analytic.rows) {
        const s = simCur?.rows.find((x) => x.kind === r.kind)
        rows.push({ name: String.raw`${CODE_LABEL_TEX[r.kind]}：$0\ldots f_{BW}$ RMS（解析）`, value: r.inbandRms, unit: 'fs', formulaId: 'F-12.13', claim: 'approx', digits: 5 })
        if (s) {
          const tol = r.inbandRms < s.inbandRms ? s.inbandRms - s.inbandLo : s.inbandHi - s.inbandRms
          rows.push({
            name: String.raw`${CODE_LABEL_TEX[r.kind]}：$0\ldots f_{BW}$ RMS（模擬）`,
            value: s.inbandRms,
            unit: 'fs',
            analytic: r.inbandRms,
            tolerance: Number.isFinite(tol) ? tol : undefined,
            digits: 5,
            note: String.raw`95% CI $[${texNum(s.inbandLo, 4)},\ ${texNum(s.inbandHi, 4)}]$ fs；in-band 功率比例 $${texNum(s.fractionMean, 5)}$（CI $[${texNum(s.fractionLo, 5)},\ ${texNum(s.fractionHi, 5)}]$，解析 $${texNum(r.inbandFraction, 5)}$）`,
          })
        }
        rows.push(
          { name: String.raw`${CODE_LABEL_TEX[r.kind]}：output jitter（$|T|^2$ 加權）`, value: r.outRms, unit: 'fs', formulaId: 'F-12.17', claim: 'approx', digits: 5 },
          { name: String.raw`${CODE_LABEL_TEX[r.kind]}：PD residual（$|H_{\mathrm{PD}}|^2$ 加權）`, value: r.pdRms, unit: 'fs', formulaId: 'F-12.15', claim: 'approx', digits: 5 },
        )
      }
    }
    return rows
  }, [lp, analytic, simCur])

  const crossCheck: CrossCheck = useMemo(() => {
    let mc: CrossCheck['monteCarlo'] = { status: 'n/a', note: '按「執行 Run」做逐 sample 驗證' }
    if (simCur && analytic) {
      const bad = analytic.rows.filter((r) => {
        const s = simCur.rows.find((x) => x.kind === r.kind)
        return !s || !(s.fractionLo <= r.inbandFraction && r.inbandFraction <= s.fractionHi && s.inbandLo <= r.inbandRms && r.inbandRms <= s.inbandHi)
      })
      mc = bad.length === 0 ? { status: 'ok', note: '三種 code 的 in-band RMS 與比例皆在 95% CI 內' } : { status: 'mismatch', note: `不在 CI 內：${bad.map((b) => CODE_LABEL[b.kind]).join('、')}` }
    }
    return {
      analytic: analytic ? { status: 'ok', note: String.raw`數值積分（adaptive Simpson，斷點在 $kf_u\pm f_x$）` } : { status: 'n/a', note: '計算中或迴路無穩態' },
      monteCarlo: mc,
      fixedPoint: 'not-implemented',
    }
  }, [analytic, simCur])

  const warnings = useMemo(() => {
    const w = analytic ? [...analytic.warnings] : [...lp.warnings]
    if (simCur) for (const x of simCur.warnings) if (!w.includes(x)) w.push(x)
    if (sim.error) w.push(`模擬失敗：${sim.error.message}`)
    if (an.error) w.push(`解析計算失敗：${an.error.message}`)
    if (prm.N * prm.blocks > 2 ** 21) w.push(String.raw`FFT 長度 $N\cdot$ blocks $=${prm.N * prm.blocks}>2^{21}$：模擬可能需要數秒。`)
    return w
  }, [analytic, lp, simCur, sim.error, an.error, prm.N, prm.blocks])

  const set = (patch: Partial<CodeSpectraLabParams>) => setPrm((p) => ({ ...p, ...patch }))

  return (
    <ExperimentShell
      id={EXP_ID}
      title="Code Spectra Lab：同一份係數雜訊，乘上三種 code 之後"
      level="L4"
      claim="approx"
      source="simulation"
      tests={['T13']}
      description={
        <>
          解析：<Tex>{String.raw`S^{(1)}_{\delta t}(f)=m^2S^{(1)}_{w,\mathrm{zoh}}(f)+\tfrac{A^2}{4}\big[S^{(1)}_{w,\mathrm{zoh}}(f-f_x)+S^{(1)}_{w,\mathrm{zoh}}(f+f_x)\big]+\sigma_x^2\sigma_w^2\tfrac{2}{f_s}`}</Tex>，其中{' '}
          <Tex>{String.raw`S^{(1)}_{w,\mathrm{zoh}}(f)=\tfrac{2}{f_s}S_w^{(f_s)}(e^{j2\pi|f|/f_s})`}</Tex> 是 ZOH 後的單邊 per-Hz 係數 PSD（F-12.13、F-12.14、F-12.10），
          再以 <Tex>{'|T|^2'}</Tex>、<Tex>{String.raw`|H_{\mathrm{PD}}|^2`}</Tex> 加權積分。模擬：逐 sample 產生 <Tex>{String.raw`x[n]\,\delta w_{\lfloor n/N\rfloor}`}</Tex>，整段 FFT 後加總{' '}
          <Tex>{String.raw`0\ldots f_{BW}`}</Tex> 的 bin（Parseval）。
        </>
      }
      assumptions={[
        String.raw`$x$ 與 $\delta w$ 獨立（真實 LMS 中兩者相關，見 R1/R2）；$\delta w$ 為 ZOH（commit latency $n_c=0$）`,
        String.raw`「in-band」= 理想 brick-wall $0\ldots f_{BW}$；output / PD 欄使用 CT type-II 原型 $T(s)$、$H_{\mathrm{PD}}(s)$（需 $f\ll f_s$）`,
        String.raw`單邊 PSD、取樣率 $f_s$；$\mathcal L(f)=10\log_{10}\big((2\pi f_{\mathrm{out}})^2|T|^2S^{(1)}_{\delta t}/2\big)$（E28）`,
        String.raw`模擬的 $\delta w$ 由線性遞迴（或精確 Binomial Sign-LMS）在 block rate 產生；in-band 比例以 ratio-of-sums + jackknife CI 估計`,
      ]}
      params={{ ...prm, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ fs: 'Hz', mu: 'fs', sigmaV: 'fs', fx: 'Hz', fBw: 'Hz', f3dbT: 'Hz', fL: 'Hz', fH: 'Hz', fOut: 'Hz' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{ onRun: doSim, onStop: sim.cancel, running: sim.running, onReset: () => setPrm(CODE_SPECTRA_DEFAULTS) }}
      exportData={() => {
        const out: Record<string, ArrayLike<number>> = { f_hz: curves.f, T2: curves.t2, Hpd2: curves.hpd2, Sw_zoh_fs2_per_hz: curves.sw1 }
        for (const k of KINDS) out[`S_dt_${k}_fs2_per_hz`] = curves.dt[k]
        return out
      }}
      presets={presets}
      onLoadPreset={(p) => setPrm({ ...CODE_SPECTRA_DEFAULTS, ...(p.params as Partial<CodeSpectraLabParams>) })}
      controls={
        <>
          <div className="ch12-controls-title">係數雜訊（同 LMS Noise Lab）</div>
          <ParamControl label={<Tex>{'N'}</Tex>} ariaLabel="N" value={prm.N} onChange={(N) => set({ N })} min={16} max={65536} log integer clampOnBlur reg="REG_GMAC_N[15:0]" />
          <ParamControl label={<Tex>{'f_s'}</Tex>} ariaLabel="f_s" value={prm.fs} onChange={(fs) => set({ fs })} min={1e6} max={2e10} log unit="Hz" reg="sample_rate_hz" />
          <ParamControl label={<Tex>{String.raw`\mu`}</Tex>} ariaLabel="μ" value={prm.mu} onChange={(mu) => set({ mu })} min={1e-3} max={200} log unit="fs" reg="REG_GAIN_STEP" />
          <ParamControl label={<Tex>{String.raw`\sigma_v`}</Tex>} ariaLabel="σ_v" value={prm.sigmaV} onChange={(sigmaV) => set({ sigmaV })} min={0.1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
          <ParamControl label={<Tex>{'C'}</Tex>} ariaLabel="C" value={prm.C} onChange={(C) => set({ C })} min={-2} max={4} step={0.01} reg="C = E[x·u]" />
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">Code 與頻帶</div>
            <ParamControl label={<>{md('$f_x$（tone code 頻率）')}</>} ariaLabel="f_x（tone code 頻率）" value={prm.fx} onChange={(fx) => set({ fx })} min={0} max={1e9} step={1000} unit="Hz" reg="DSM tone（behavioral）" />
            <ParamControl label={<>{md('$A$（tone code 振幅）')}</>} ariaLabel="A（tone code 振幅）" value={prm.toneA} onChange={(toneA) => set({ toneA })} min={0} max={4} step={0.01} reg="code amplitude" />
            <ParamControl
              label={<>{md('$f_{BW}$（brick-wall in-band 上限）')}</>}
              ariaLabel="f_BW（brick-wall in-band 上限）"
              value={prm.fBw}
              onChange={(fBw) => set({ fBw })}
              min={1e3}
              max={1e10}
              log
              unit="Hz"
              reg="integration band"
              hint={md('超過 $f_s/2$ 時截在 $f_s/2$')}
            />
          </div>
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">PLL（CT type-II 原型）</div>
            <ParamControl label={<>{md('$T$ 的 −3 dB 頻寬')}</>} ariaLabel="T 的 −3 dB 頻寬" value={prm.f3dbT} onChange={(f3dbT) => set({ f3dbT })} min={1e3} max={1e8} log unit="Hz" reg="PLL BW（loop filter）" />
            <ParamControl label={<Tex>{String.raw`\zeta`}</Tex>} ariaLabel="ζ" value={prm.zeta} onChange={(zeta) => set({ zeta })} min={0.2} max={3} step={0.01} reg="loop damping" />
            <ParamControl label={<>{md('$f_L$（jitter 積分下限）')}</>} ariaLabel="f_L（jitter 積分下限）" value={prm.fL} onChange={(fL) => set({ fL })} min={1} max={1e8} log unit="Hz" reg="jitter band" />
            <ParamControl label={<>{md('$f_H$（jitter 積分上限）')}</>} ariaLabel="f_H（jitter 積分上限）" value={prm.fH} onChange={(fH) => set({ fH })} min={1e3} max={1e10} log unit="Hz" reg="jitter band" hint={md(String.raw`$>10^9$ Hz 時積分較慢；超過 $f_s/2$ 時截在 $f_s/2$`)} />
            <ParamControl label={<Tex>{String.raw`f_{\mathrm{out}}`}</Tex>} ariaLabel="f_out" value={prm.fOut} onChange={(fOut) => set({ fOut })} min={1e8} max={1e11} log unit="Hz" reg="output_frequency_hz" />
          </div>
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">逐 sample 驗證（按 Run）</div>
            <ParamControl label="blocks / chain" value={prm.blocks} onChange={(blocks) => set({ blocks })} min={16} max={2048} log integer clampOnBlur unit="blocks" reg="record length" hint={md(String.raw`FFT 長度 $=N\cdot$ blocks`)} />
            <ParamControl label="chains" value={prm.chains} onChange={(chains) => set({ chains })} min={2} max={32} integer clampOnBlur reg="Monte Carlo runs" />
            <SelectControl
              label={<>{md(String.raw`$\delta w$ 引擎`)}</>}
              ariaLabel="δw 引擎"
              value={prm.engine}
              onChange={(engine) => set({ engine })}
              options={[
                { value: 'linear', label: '線性遞迴' },
                { value: 'binomial', label: '精確 Binomial Sign-LMS' },
              ]}
              reg="engine"
            />
          </div>
          <p className="ch12-status">
            {an.running ? '解析積分中…' : ''}
            {sim.running ? '逐 sample 模擬中…' : sim.lastDurationMs != null ? `上次模擬 ${sim.lastDurationMs.toFixed(0)} ms（${sim.mode}）` : ''}
          </p>
        </>
      }
    >
      <div className="table-wrap">
        <table className="ch12-table">
          <thead>
            <tr>
              <th>code</th>
              <th className="num">
                <Tex>{String.raw`\delta t`}</Tex> 總 RMS
              </th>
              <th className="num">
                <Tex>{String.raw`0\ldots f_{BW}`}</Tex>（解析）
              </th>
              <th className="num">
                <Tex>{String.raw`0\ldots f_{BW}`}</Tex>（模擬，95% CI）[fs]
              </th>
              <th className="num">
                output <Tex>{'|T|^2'}</Tex>
              </th>
              <th className="num">
                PD <Tex>{String.raw`|H_{\mathrm{PD}}|^2`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {analytic?.rows.map((r) => {
              const s = simCur?.rows.find((x) => x.kind === r.kind)
              return (
                <tr key={r.kind}>
                  <td>{codeLabel(r.kind)}</td>
                  <td className="num">{sigText(r.totalRms, 4)} fs</td>
                  <td className="num">{sigText(r.inbandRms, 4)} fs</td>
                  <td className="num">{s ? `${sigText(s.inbandRms, 4)} [${sigText(s.inbandLo, 3)}, ${sigText(s.inbandHi, 3)}]` : '—'}</td>
                  <td className="num">{sigText(r.outRms, 4)} fs</td>
                  <td className="num">{sigText(r.pdRms, 4)} fs</td>
                </tr>
              )
            }) ?? (
              <tr>
                <td colSpan={6}>{an.running ? '計算中…' : '迴路沒有穩態（請看警告）'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Plot
        title="timing error 的單邊 PSD 與 PLL 的兩個轉移函數"
        csvName="ch12-code-spectra"
        height={340}
        xLog
        data={psdData}
        layout={PSD_LAYOUT}
        caption={md(
          `常數 code 的頻譜留在 DC 附近（$\\mathrm{ENBW}\\approx${sigText(lp.enbw / 1e3, 4)}$ kHz）並帶有 ZOH 在 $k f_u$ 的 notch；tone code 搬到 $f_x$；±1 code 是平的 $\\tfrac{2}{f_s}\\sigma_w^2$。單位 $\\mathrm{fs}^2/\\mathrm{Hz}$、one-sided、取樣率 $f_s=${sig(prm.fs, 4)}$ Hz（解析曲線，非 FFT）。`,
        )}
      />
      <Plot
        title="輸出 phase noise（只含這一項 gain noise）"
        csvName="ch12-code-L"
        height={300}
        xLog
        data={lData}
        layout={L_LAYOUT}
        caption={md(
          String.raw`$\mathcal L(f)=10\log_{10}\big((2\pi f_{\mathrm{out}})^2|T(f)|^2S^{(1)}_{\delta t}(f)/2\big)$（單邊，dBc/Hz）；同一個 $\sigma_w$，常數 / 單頻 code 的 skirt 落在 PLL 頻寬內，±1 隨機 code 的雜訊被攤平且被 $|T|^2$ 濾掉。`,
        )}
      />
      <div className="ch12-try">
        {md(
          String.raw`把 $f_x$ 拉到 5 MHz（PLL 頻寬外）：tone code 的 output jitter 掉將近一個數量級，PD residual 反而升到接近 tone code 的總 RMS（$\sigma_w/\sqrt2$）——同一份擾動，換了出口就換了結論。把 $f_{BW}$ 拉到 $f_s/2$：三種 code 的 in-band RMS 都回到總 RMS（Parseval）。`,
        )}
      </div>
      <ModeGate min="research">
        <p className="small muted">
          Research：模擬的 in-band 比例使用 ratio-of-sums <Tex>{String.raw`\sum_rP_{\mathrm{in},r}/\sum_rP_{\mathrm{tot},r}`}</Tex>——逐 chain 相除的平均在短紀錄時會因總功率起伏產生 Jensen 偏差（約
          <Tex>{String.raw`\mathrm{CV}^2`}</Tex> 倍的 out-of-band 比例）。常數 code 的 out-of-band 部分正是 ZOH step 能量，所以比例檢驗的是 F-12.14 的形狀。
        </p>
      </ModeGate>
    </ExperimentShell>
  )
}
