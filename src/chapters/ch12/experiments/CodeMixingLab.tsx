import { useEffect, useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  mathText,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CrossCheck,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { mixingCrossCheck, simulateMixing, texNum, type MixingSimParams, type MixingSimResult } from '@/simulation/models/calNoise'
import type { WindowName } from '@/simulation/signal'
import { md, sigText } from '../common'

export type MixParams = Omit<MixingSimParams, 'seed' | 'traceLen'>

export const MIX_DEFAULTS: MixParams = {
  fsim: 4.096e6,
  L: 4096,
  fx: 1e5,
  A: 1,
  m: 0,
  codeWhite: 0,
  fw: 1e4,
  B: 1,
  holdN: 1,
  dwNoiseSigma: 0,
  dwNoiseP: 0.92,
  fOut: 13e9,
  Tmag: 1,
  window: 'rectangular',
}

const EXP_ID = 'code-mixing-lab'
// layout 放在模組層（參考不變）：避免每次 render 都觸發 Plotly.react 而重設 zoom
const TIME_LAYOUT: Partial<Layout> = {
  margin: { r: 56 },
  xaxis: { title: { text: 't [μs]' } },
  yaxis: { title: { text: 'δw, δt [fs]' } },
  yaxis2: { title: { text: 'x [—]' }, overlaying: 'y', side: 'right' },
}
const SPEC_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'offset f [Hz]（取樣率 f_sim，one-sided）' } }, yaxis: { title: { text: '10log10(P_φ,bin/2) [dBc]' }, range: [-220, -60] } }

function runCase(p: MixParams, seed: number): { r: MixingSimResult | null; err: string | null } {
  try {
    const traceLen = Math.min(p.L, 4000, Math.max(200, Math.ceil((2 * p.fsim) / Math.max(p.fw, 1))))
    return { r: simulateMixing({ ...p, seed, traceLen }), err: null }
  } catch (e) {
    return { r: null, err: (e as Error).message }
  }
}

export function CodeMixingLab() {
  const cases = useCases<MixParams>(MIX_DEFAULTS, { seed: 20261010 })
  const { update, reset } = cases
  const prm = cases.active.params
  const tokens = useThemeTokens()

  const urlPreset = useUrlPreset(EXP_ID)
  useEffect(() => {
    if (urlPreset) reset({ ...MIX_DEFAULTS, ...(urlPreset.params as Partial<MixParams>) })
  }, [urlPreset, reset])
  const presets = useMemo(() => presetsForExperiment(EXP_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), [])

  // 每個 case 在主執行緒計算（L ≤ 2^16，數十 ms）；參數 debounce 後才重算
  const allKey = JSON.stringify({ c: cases.cases.map((c) => [c.id, c.params]), s: cases.seed })
  const deb = useDebouncedValue(allKey, 200)
  const results = useMemo(() => {
    const parsed = JSON.parse(deb) as { c: [string, MixParams][]; s: number }
    return parsed.c.map(([id, p]) => ({ id, p, ...runCase(p, parsed.s) }))
  }, [deb])
  const act = results.find((x) => x.id === cases.activeId) ?? results[0]
  const r = act?.r ?? null
  const stale = deb !== allKey

  const timeData: Data[] = useMemo(() => {
    if (!r) return []
    const t = Array.from(r.trace.tUs)
    return [
      { x: t, y: Array.from(r.trace.x), name: 'x[n]（code，右軸）', mode: 'lines', yaxis: 'y2', line: { color: tokens.textMuted, width: 1 } },
      { x: t, y: Array.from(r.trace.dw), name: 'δw[n] [fs]', mode: 'lines', line: { color: tokens.series[1] } },
      { x: t, y: Array.from(r.trace.dt), name: 'δt[n] = x·δw [fs]', mode: 'lines', line: { color: tokens.series[0] } },
    ]
  }, [r, tokens])

  const specData: Data[] = useMemo(() => {
    const out: Data[] = []
    for (const c of results) {
      if (!c.r) continue
      const idx = cases.cases.find((x) => x.id === c.id)?.seriesIndex ?? 0
      out.push({
        x: Array.from(c.r.spec.f).slice(1),
        y: Array.from(c.r.phaseDbc).slice(1),
        name: `Case ${c.id}`,
        mode: 'lines',
        line: { color: tokens.series[idx], width: c.id === cases.activeId ? 1.6 : 1 },
      })
    }
    if (r) {
      for (const t of r.tones) {
        if (!Number.isFinite(t.dbcSmall)) continue // 完全抵消的 tone（β = 0）沒有 marker
        out.push({
          x: [t.f, t.f],
          y: [t.dbcSmall - 25, t.dbcSmall + 6],
          name: `${t.label} = ${sigText(t.f / 1e3, 5)} kHz`,
          mode: 'lines',
          line: { dash: 'dot', color: tokens.textMuted },
          showlegend: false,
        })
      }
    }
    return out
  }, [results, r, tokens, cases.cases, cases.activeId])

  const metrics: MetricRow[] = useMemo(() => {
    if (!r) return []
    const rp = act?.p ?? prm
    const random = rp.dwNoiseSigma > 0 || rp.codeWhite > 0
    const rows: MetricRow[] = []
    for (const t of r.tones) {
      rows.push({
        name: String.raw`$A_t$ @ $${t.tex}$（toneFit）`,
        value: t.measFs,
        unit: 'fs peak',
        analytic: Number.isFinite(t.predFs) ? t.predFs : undefined,
        tolerance: random ? Math.max(0.05 * t.predFs, 1e-6) : 1e-9 * Math.max(t.predFs, 1),
        formulaId: 'F-12.12',
        claim: 'exact',
        digits: 8,
        note: t.coherent ? 'coherent（整數 bin）' : '非 coherent：FFT 有 leakage，toneFit 仍正確',
      })
      rows.push({ name: String.raw`$\beta$ @ $${t.tex}$`, value: t.beta, unit: 'rad', formulaId: 'F-12.18', claim: 'exact', digits: 6 })
      rows.push({ name: String.raw`spur @ $f_{\mathrm{out}}\pm${texNum(t.f / 1e3, 5)}$ kHz（小角 $20\log_{10}\tfrac{\beta}{2}$）`, value: t.dbcSmall, unit: 'dBc', formulaId: 'F-12.18', claim: 'approx', digits: 6 })
      rows.push({ name: String.raw`spur @ $f_{\mathrm{out}}\pm${texNum(t.f / 1e3, 5)}$ kHz（Bessel $20\log_{10}\tfrac{J_1(\beta)}{J_0(\beta)}$）`, value: t.dbcBessel, unit: 'dBc', analytic: t.dbcSmall, tolerance: 0.01, digits: 8 })
    }
    if (r.pmFftLabel !== null && Number.isFinite(r.pmFftDbc)) {
      const tgt = r.tones.find((t) => t.label === r.pmFftLabel)
      rows.push({
        name: tgt ? String.raw`$e^{j\phi}$ 的 FFT 直接量測（$${tgt.tex}$）` : String.raw`$e^{j\phi}$ 的 FFT 直接量測`,
        value: r.pmFftDbc,
        unit: 'dBc',
        // 只有 coherent（整數 bin）且沒有隨機成分時，單一 FFT bin 才等於該 tone 的 Bessel 值；否則只顯示讀數、不做 ✓/✗ 判定
        analytic: tgt && tgt.coherent && !random ? tgt.dbcBessel : undefined,
        tolerance: 0.05,
        digits: 6,
        note: tgt && !tgt.coherent ? '非 coherent：單一 bin 有 leakage，讀數偏低（僅供參考）' : '不做小角近似的數值核對',
      })
    }
    rows.push({ name: String.raw`$\delta t$ RMS`, value: r.dtRms, unit: 'fs', digits: 5 })
    rows.push({ name: String.raw`output phase RMS $=2\pi f_{\mathrm{out}}|T|\,\delta t_{\mathrm{rms}}$`, value: r.phaseRmsRad, unit: 'rad', digits: 5 })
    if (r.msCheck) {
      const c = r.msCheck
      rows.push({
        name: String.raw`$\delta t$ 均方值（Monte Carlo）`,
        value: c.meas,
        unit: 'fs²',
        analytic: c.pred,
        tolerance: Number.isFinite(c.se) && c.batches >= 8 ? c.zCrit * c.se : undefined,
        claim: 'exact',
        digits: 6,
        note: String.raw`期望值 $E[\delta t^2]=\overline{(x_{\mathrm{det}}^2+c_w^2)(\delta w_{\mathrm{det}}^2+\sigma^2)}$（對 $n$ 取時間平均）；batch-means $z=${Number.isFinite(c.z) ? c.z.toFixed(2) : String.raw`\text{—}`}$（${c.batches} batches）`,
      })
    }
    return rows
  }, [r, act, prm])

  const crossCheck: CrossCheck = useMemo(() => {
    if (!r) return { analytic: 'n/a', monteCarlo: 'n/a', fixedPoint: 'not-implemented' }
    // 以 act.p（實際算出 r 的參數）判定，避免 debounce 期間參數與結果不一致
    const cc = mixingCrossCheck(act?.p ?? prm, r)
    return { analytic: cc.analytic, monteCarlo: cc.monteCarlo, fixedPoint: { status: 'not-implemented', note: '本實驗不含暫存器量化（見第 13 章）' } }
  }, [r, act, prm])

  const warnings = useMemo(() => {
    const w: string[] = []
    if (act?.err) w.push(`參數無效：${act.err}`)
    if (r) w.push(...r.warnings)
    if (prm.Tmag > 1.5) w.push(String.raw`$|T|>1.5$：PLL 的 jitter peaking 很大，請確認迴路阻尼；此實驗把 $|T|$ 視為 tone 頻率處的常數。`)
    for (const t of r?.tones ?? []) if (t.beta > 0.3) w.push(String.raw`$\beta=${t.beta.toFixed(3)}$ rad 已不是小角：$20\log_{10}(\beta/2)$ 與 Bessel 精確值開始分歧，以 Bessel 為準。`)
    return w
  }, [act, r, prm.Tmag])

  const set = (patch: Partial<MixParams>) => update(patch)

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`Code Mixing Lab：code $\times$ 係數擾動的時域乘積、頻譜與 spur`}
      level="L4"
      claim="exact"
      source="simulation"
      tests={['T15']}
      description={
        <>
          <Tex>{String.raw`x[n]=m+A\cos(2\pi f_xn/f_{\mathrm{sim}})+c_w s[n]`}</Tex>（<Tex>{'s[n]=\\pm1'}</Tex> iid 白色），<Tex>{String.raw`\delta w[n]=B\cos(2\pi f_wn/f_{\mathrm{sim}})+\epsilon[n]`}</Tex>
          （可 ZOH 每 <Tex>{'H'}</Tex> 個 sample 更新；<Tex>{String.raw`\epsilon`}</Tex> 為 block-rate AR(1) 係數雜訊），
          <Tex>{String.raw`\delta t=x\cdot\delta w`}</Tex>。頻譜以 output 相位的 spur 讀數顯示：<Tex>{String.raw`10\log_{10}\big((2\pi f_{\mathrm{out}}|T|)^2P_{\delta t,\mathrm{bin}}/2\big)`}</Tex>——tone bin 的讀數就是 spur dBc（E28 的一致性）。
        </>
      }
      assumptions={[
        String.raw`$|T|$ 視為 tone 頻率處的常數（$|T|\approx1$ 表示在 PLL 頻寬內）；$\phi_{\mathrm{out}}=-2\pi f_{\mathrm{out}}T\,\delta t$，極性不影響 dBc`,
        String.raw`模擬取樣率 $f_{\mathrm{sim}}$ 只需大於 $2(f_x+f_w)$；乘積關係與取樣率無關（真實 $f_s=4$ GHz 時 tone 位置相同）`,
        String.raw`coherent sampling：$fL/f_{\mathrm{sim}}$ 為整數時 FFT bin 讀數精確；toneFit（最小平方）不需 coherent`,
        String.raw`隨機係數雜訊為 block-rate AR(1)（RMS $\sigma$、pole $p$），每 $H$ 個 sample 更新一次（ZOH）`,
      ]}
      params={{ ...prm, seed: cases.seed }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ fsim: 'Hz', L: 'samples', fx: 'Hz', fw: 'Hz', B: 'fs', fOut: 'Hz', dwNoiseSigma: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{ onReset: () => reset(MIX_DEFAULTS) }}
      exportData={() => {
        if (!r) throw new Error('沒有結果')
        const out: Record<string, ArrayLike<number>> = { t_us: r.trace.tUs, x: r.trace.x, dw_fs: r.trace.dw, dt_fs: r.trace.dt }
        // 每個 Case 的頻譜（A/B/C 對照）
        for (const c of results) {
          if (!c.r) continue
          out[`${c.id}_f_hz`] = c.r.spec.f
          out[`${c.id}_dt_power_fs2`] = c.r.spec.p
          out[`${c.id}_phase_dbc`] = c.r.phaseDbc
        }
        return out
      }}
      presets={presets}
      onLoadPreset={(p) => update({ ...MIX_DEFAULTS, ...(p.params as Partial<MixParams>) })}
      controls={
        <>
          <CaseSelector cases={cases} label="比較組（例如 tone / DC / 隨機）" />
          <div className="ch12-controls-title">Code {md('$x[n]$')}</div>
          <ParamControl label={<Tex>{'f_x'}</Tex>} ariaLabel="f_x" value={prm.fx} onChange={(fx) => set({ fx })} min={0} max={2e6} step={1000} unit="Hz" reg="DSM code tone（behavioral）" />
          <ParamControl label={<>{md('$A$（tone 振幅）')}</>} ariaLabel="A（tone 振幅）" value={prm.A} onChange={(A) => set({ A })} min={0} max={4} step={0.01} reg="code amplitude" />
          <ParamControl label={<>{md('$m$（code DC）')}</>} ariaLabel="m（code DC）" value={prm.m} onChange={(m) => set({ m })} min={-2} max={2} step={0.01} reg="code_normalization（mean）" hint={md(String.raw`$m\ne0$ ⇒ 低頻直通項 $m\,\delta w$`)} />
          <ParamControl label={<>{md('白色 $\\pm1$ 成分 $c_w$')}</>} ariaLabel="白色 ±1 成分 c_w" value={prm.codeWhite} onChange={(codeWhite) => set({ codeWhite })} min={0} max={2} step={0.01} reg="DSM / dither（behavioral）" />
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">係數擾動 {md(String.raw`$\delta w$`)}</div>
            <ParamControl label={<>{md('$f_w$（週期性擾動頻率）')}</>} ariaLabel="f_w（週期性擾動頻率）" value={prm.fw} onChange={(fw) => set({ fw })} min={0} max={1e6} step={100} unit="Hz" reg="dw_tone_freq_hz（behavioral：週期性係數擾動）" />
            <ParamControl label={<>{md(String.raw`$B$（$\delta w$ peak）`)}</>} ariaLabel="B（δw peak）" value={prm.B} onChange={(B) => set({ B })} min={0} max={100} step={0.01} unit="fs" reg="dw_tone_peak_fs（behavioral：gain register 擾動）" />
            <ParamControl label={<>{md(String.raw`隨機係數雜訊 $\sigma$`)}</>} ariaLabel="隨機係數雜訊 σ" value={prm.dwNoiseSigma} onChange={(dwNoiseSigma) => set({ dwNoiseSigma })} min={0} max={10} step={0.001} unit="fs" reg="dw_noise_rms_fs（behavioral：LMS 係數雜訊，F-12.5）" hint={md(String.raw`$0.399$ fs $=$ T13 例的 $\sigma_w$`)} />
            <ParamControl label={<>{md('雜訊 pole $p$')}</>} ariaLabel="雜訊 pole p" value={prm.dwNoiseP} onChange={(dwNoiseP) => set({ dwNoiseP })} min={-0.99} max={0.9999} step={0.0001} reg="dw_noise_pole（behavioral：校正迴路 pole）" hint={md(String.raw`$p=1-\mu K$（F-12.2）`)} />
            <ParamControl label={<>{md('ZOH hold $H$（每幾個 sample 更新）')}</>} ariaLabel="ZOH hold（每幾個 sample 更新）" value={prm.holdN} onChange={(holdN) => set({ holdN })} min={1} max={1024} integer clampOnBlur log reg="gm_accum_samples（顯示用的 hold 長度）" hint={md(String.raw`$f_u=f_{\mathrm{sim}}/H$（E09）`)} />
          </div>
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">PLL 與量測</div>
            <ParamControl label={<Tex>{String.raw`f_{\mathrm{out}}`}</Tex>} ariaLabel="f_out" value={prm.fOut} onChange={(fOut) => set({ fOut })} min={1e8} max={1e11} log unit="Hz" reg="output_frequency_hz" />
            <ParamControl label={<>{md('$|T|$（tone 處）')}</>} ariaLabel="|T|（tone 處）" value={prm.Tmag} onChange={(Tmag) => set({ Tmag })} min={0} max={2} step={0.001} reg="PLL closed-loop |T(f)|" />
            <ParamControl label={<>{md(String.raw`$f_{\mathrm{sim}}$（模擬取樣率）`)}</>} ariaLabel="f_sim（模擬取樣率）" value={prm.fsim} onChange={(fsim) => set({ fsim })} min={1e4} max={1e8} log unit="Hz" reg="display sample rate" hint={md(String.raw`需 $>2(f_x+f_w)$，否則 aliasing`)} />
            <ParamControl label={<>{md('$L$（紀錄長度）')}</>} ariaLabel="L（紀錄長度）" value={prm.L} onChange={(L) => set({ L })} min={64} max={65536} log integer clampOnBlur unit="samples" reg="FFT length" hint={md(String.raw`bin 寬 $=f_{\mathrm{sim}}/L$`)} />
            <SelectControl
              label="FFT window"
              value={prm.window}
              onChange={(window) => set({ window: window as WindowName })}
              options={[
                { value: 'rectangular', label: 'rectangular（coherent 時精確）' },
                { value: 'hann', label: 'Hann' },
                { value: 'blackmanHarris', label: 'Blackman–Harris' },
              ]}
              reg="analysis window"
            />
          </div>
          <p className="ch12-status">
            bin = {sigText(prm.fsim / prm.L, 5)} Hz{stale ? '；更新中…' : ''}
          </p>
        </>
      }
    >
      <Plot
        title="時域乘積（目前 Case）"
        csvName="ch12-mixing-time"
        height={280}
        data={timeData}
        layout={TIME_LAYOUT}
        caption={md(
          String.raw`$\delta t$ 的包絡就是 $\delta w$：code 的 $f_x$ 被 $f_w$ 的 gain 擾動「調幅」，頻譜上是 $f_x\pm f_w$ 兩根線（不是 $f_w$ 與 $f_x$ 本身）。`,
        )}
      />
      <Plot
        title="output 相位頻譜（spur 讀數，Case A/B/C 疊圖）"
        csvName="ch12-mixing-spectrum"
        height={320}
        xLog
        data={specData}
        layout={SPEC_LAYOUT}
        caption={
          r
            ? md(
                `periodogram：${r.spec.window}、取樣率 $f_{\\mathrm{sim}}$ = ${sigText((act?.p.fsim ?? prm.fsim) / 1e3, 7)} kHz、$L$ = ${act?.p.L ?? prm.L}、$\\Delta f$ = ${sigText(r.spec.df, 5)} Hz、window ENBW = ${sigText(r.spec.enbwHz, 5)} Hz、one-sided、spectrum scaling（tone bin 讀數 $=A^2/2$），縱軸 $10\\log_{10}\\big((2\\pi f_{\\mathrm{out}}|T|)^2P_{\\mathrm{bin}}/2\\big)$ dBc。隨機成分的讀數 $=\\mathcal L(f)+10\\log_{10}\\mathrm{ENBW}$，會隨 $L$ 改變；spur 讀數不會。`,
              )
            : '—'
        }
      />
      <div className="table-wrap">
        <table className="ch12-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>產物</th>
              <th className="num">offset [kHz]</th>
              <th className="num">
                預測 <Tex>{'A_t'}</Tex> [fs]
              </th>
              <th className="num">
                量測 <Tex>{'A_t'}</Tex> [fs]
              </th>
              <th className="num">
                <Tex>{String.raw`\beta`}</Tex> [rad]
              </th>
              <th className="num">
                <Tex>{String.raw`20\log_{10}\tfrac{\beta}{2}`}</Tex> [dBc]
              </th>
              <th className="num">
                Bessel <Tex>{String.raw`\tfrac{J_1}{J_0}`}</Tex> [dBc]
              </th>
            </tr>
          </thead>
          <tbody>
            {results.flatMap((c) =>
              c.r && c.r.tones.length > 0
                ? c.r.tones.map((t) => (
                    <tr key={`${c.id}-${t.label}`} className={c.id === cases.activeId ? 'ch12-hl' : undefined}>
                      <td>{c.id}</td>
                      <td>
                        <Tex>{t.tex}</Tex>
                      </td>
                      <td className="num">{sigText(t.f / 1e3, 6)}</td>
                      <td className="num">{sigText(t.predFs, 6)}</td>
                      <td className="num">{sigText(t.measFs, 6)}</td>
                      <td className="num">{t.beta.toExponential(4)}</td>
                      <td className="num">{Number.isFinite(t.dbcSmall) ? t.dbcSmall.toFixed(3) : '−∞'}</td>
                      <td className="num">{Number.isFinite(t.dbcBessel) ? t.dbcBessel.toFixed(3) : '−∞'}</td>
                    </tr>
                  ))
                : [
                    <tr key={`${c.id}-none`}>
                      <td>{c.id}</td>
                      <td colSpan={7}>{mathText(c.err ?? '沒有離散 tone（只有隨機成分 → noise skirt）')}</td>
                    </tr>,
                  ],
            )}
          </tbody>
        </table>
      </div>
      <div className="ch12-try">
        {md(
          String.raw`Case A 保持 T15（−93.8 dBc）。按「＋ Case」做 Case B：把 $m$ 設 0.5，會在 $f_w=10$ kHz 多一根 $mB=0.5$ fs 的低頻 spur（落在 PLL 頻寬內，最危險）。Case C：$B=0$、隨機係數雜訊 $\sigma=0.399$ fs——只剩裙擺，沒有任何離散線，Monte Carlo 欄改為核對 $\delta t$ 的均方值。再把 Case C 的 $A$ 設 0、白色成分 $c_w$ 設 1（preset「±1 白色 code × 隨機係數雜訊」）：同一條 $\delta w$，裙擺變成平的寬頻 floor。`,
        )}
      </div>
      <ModeGate min="engineer">
        <p className="small muted">
          {md(
            String.raw`ZOH（$H>1$）讓 tone 乘上 $\big|\tfrac{\sin(\pi f_wH/f_{\mathrm{sim}})}{H\sin(\pi f_w/f_{\mathrm{sim}})}\big|$，並在 $k f_u\pm f_w$（$f_u=f_{\mathrm{sim}}/H$）產生 image（E09）；把 $f_{\mathrm{sim}}$ 降到 200 kHz（$<2(f_x+f_w)$）會看到 aliasing 警告（反面測試）。`,
          )}
        </p>
      </ModeGate>
    </ExperimentShell>
  )
}
