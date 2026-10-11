import { useEffect, useMemo } from 'react'
import { Callout, CaseSelector, ClaimTag, ExperimentShell, ModeGate, ParamControl, Plot, SelectControl, Tex, ToggleControl, useDebouncedValue, type MetricRow } from '@/components'
import { DEFAULT_TRAINING_PATTERN, LAB_RANGES, type TrainingParams, type TrainingPatternResult, type TrainingPatternSpec } from '@/simulation/models/unifiedLab'
import { fmtHz, md, sig, texNum } from '../common'
import { DEFAULT_TRAINING_SHARED, EXP, trainingCrossCheck, trainingErrors, trainingExport, TRAINING_RANGES, type TrainingShared } from '../logic'
import { useLab } from '../store'
import { figTrainAcf, figTrainCd, figTrainPsd, figTrainSv } from './plots'
import { PresetNote, tw, usePalette, useShellPresets } from './shared'

const ASSUMPTIONS = [
  '純序列分析：不跑校正迴路，只問「這串 code 能不能讓 GMAC 辨識出參數、又會在輸出留下什麼」',
  '參數經基底 $\\phi_j(x)\\in\\{x,\\,x^2,\\,x^3,\\,1\\}$ 進入 DTC 誤差；PD 看到 $\\phi_{u,j}=H_{\\mathrm{PD}}\\{\\phi_j\\}$；第 $i$ 個相關器用 regressor $\\psi_i$',
  '$J_{ij}=K_q\\,E[\\psi_i\\phi_{u,j}]$ 是 Gaussian comparator 小訊號下的線性化；秩由「每個基底先除以自己的 RMS」的 scaled $J$ 的奇異值判斷',
  'spur 分析的殘差是假設值：$e=\\Delta a\\,x+c_2x^2+c_3x^3$ 經 $T$；tone 由 Blackman–Harris Welch 偵測，dBc 用 $20\\log_{10}(\\beta/2)$',
  'code randomization 是行為模型（研究延伸）：假設 overlay 已知、被數位端完整補償，只增加 DTC 範圍。它是加法：residue 的鋸齒與它的 fractional 譜線還在，多的是一層與 residue 無關的白色激勵（改善 $C$、秩與 PE），以及輸出端多出的寬頻雜訊',
  '這些都是行為模型的計算結果，不是任何晶片的量測；不宣稱特定電路的 spur 數字',
]

const SRC_OPTS = [
  { value: 'dsm_first_order' as const, label: '一階 DSM residue' },
  { value: 'mash111' as const, label: 'MASH 1-1-1 residue' },
  { value: 'iid_pm_one' as const, label: 'iid ±1（參考）' },
]

function PatternControls({ value, onChange, id }: { value: TrainingPatternSpec; onChange: (p: Partial<TrainingPatternSpec>) => void; id: string }) {
  const dsm = value.source !== 'iid_pm_one'
  return (
    <>
      <SelectControl label={`Case ${id}：DSM pattern`} value={value.source} onChange={(v) => onChange({ source: v })} options={SRC_OPTS} reg="REG_DSM_ORDER[1:0]" />
      {dsm && (
        <>
          <ParamControl label={md(`Case ${id}：FCW 小數 $\\alpha$`)} ariaLabel={`Case ${id} frac`} value={value.frac} onChange={(v) => onChange({ frac: v })} min={LAB_RANGES.frac.min} max={LAB_RANGES.frac.max} step={0.001} digits={8} reg="REG_FCW_FRAC[B-1:0]" hint="可精確輸入 0.00001" />
          <ParamControl label={md(`Case ${id}：DSM 位元數 $B$`)} ariaLabel={`Case ${id} DSM bits`} value={value.dsmBits} onChange={(v) => onChange({ dsmBits: Math.round(v) })} min={LAB_RANGES.dsmBits.min} max={LAB_RANGES.dsmBits.max} step={1} integer clampOnBlur unit="bit" reg="RTL: DSM accumulator width" />
          <ToggleControl label={`Case ${id}：DSM LSB dither`} value={value.dither} onChange={(v) => onChange({ dither: v })} reg="REG_DSM_DITHER_EN" />
        </>
      )}
      <SelectControl
        label={`Case ${id}：code randomization`}
        value={value.randomization}
        onChange={(v) => onChange({ randomization: v })}
        options={[
          { value: 'none' as const, label: '無' },
          { value: 'pm1' as const, label: '±A 隨機（1 bit）' },
          { value: 'uniform' as const, label: 'U(−A, A) 隨機' },
        ]}
        reg="behavioral: known code overlay（研究延伸）"
        hint={
          <>
            {md('DTC code $=r[n]+A\\,\\xi[n]$，$\\xi$ 已知且由數位端補償')} <ClaimTag kind="research" />
          </>
        }
      />
      {value.randomization !== 'none' && (
        <ParamControl label={md(`Case ${id}：overlay 振幅 $A$`)} ariaLabel={`Case ${id} 隨機化振幅`} value={value.randAmp} onChange={(v) => onChange({ randAmp: v })} min={TRAINING_RANGES.randAmp.min} max={TRAINING_RANGES.randAmp.max} step={0.05} unit="T_vco" reg="behavioral: overlay amplitude" hint={md('DTC 範圍要多 $\\pm A\\,T_{\\mathrm{vco}}$')} />
      )}
      <SelectControl
        label={`Case ${id}：正規化`}
        value={value.normalization}
        onChange={(v) => onChange({ normalization: v })}
        options={[
          { value: 'none' as const, label: 'none' },
          { value: 'zero_mean' as const, label: 'zero_mean' },
          { value: 'unit_rms' as const, label: 'unit_rms' },
          { value: 'standardize' as const, label: 'standardize' },
        ]}
        reg="behavioral: code_normalization"
      />
    </>
  )
}

/** 模型回傳的訊息裡，屬於「提醒 / 前提」而不是「失敗」的：放在結果區的註記，不放進紅色警告 */
const isNote = (w: string): boolean => /只供參考|研究延伸/.test(w)

function matrixTex(J: number[][]): string {
  return `\\begin{bmatrix}${J.map((row) => row.map((v) => texNum(v, 3)).join('&')).join('\\\\')}\\end{bmatrix}`
}

function PatternSummary({ pats, n }: { pats: TrainingPatternResult[]; n: number }) {
  const row = (name: string, f: (p: TrainingPatternResult) => string, note?: string) => (
    <tr>
      <th scope="row">
        {md(name)}
        {note && <div className="small muted">{md(note)}</div>}
      </th>
      {pats.map((p, i) => (
        <td key={i} className="mono lab-num">
          {f(p)}
        </td>
      ))}
    </tr>
  )
  return (
    <div className="table-wrap">
      <table className="lab-table">
        <thead>
          <tr>
            <th>指標</th>
            {pats.map((p, i) => (
              <th key={i} className="lab-num">
                Case {'ABC'[i]}
                <div className="small muted">{p.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('raw code 平均 / 標準差', (p) => `${sig(p.rawMean, 4)} / ${sig(p.rawStd, 4)}`, '單位 $T_{\\mathrm{vco}}$')}
          {row('raw code 範圍', (p) => `[${sig(p.rawRange[0], 4)}, ${sig(p.rawRange[1], 4)}]`, 'DTC 必須涵蓋的範圍')}
          {row('偵測到的週期', (p) => (p.period > 0 ? String(p.period) : '無（noise-like 或超過序列長度）'), 'samples')}
          {row('scaled $J$ 的數值秩 / 參數個數', (p) => `${p.rank} / ${n}`, '秩不足 = 有方向不可辨識')}
          {row('scaled $J$ 的 condition number', (p) => sig(p.condScaled, 4), '$\\sigma_{\\max}/\\sigma_{\\min}$')}
          {row('$\\lambda_{\\min}(R_u)$（整段）', (p) => sig(p.ruLambdaMin, 3), 'u-domain 資訊矩陣（scaled）')}
          {row('$\\min_k\\lambda_{\\min}(R_{u,k})$（視窗 $N_0$）', (p) => sig(p.peWindowLambdaMin, 3), '§9.1：每個視窗都要夠')}
          {row('$\\min\\mathrm{Re}\\,\\lambda(J)$', (p) => sig(p.minReEig, 3), '$>0$ 才是負回授（$M=\\mu I$）')}
          {row('$C_D$ 最大的 $D$', (p) => String(p.bestD), '只看 gain 這一個參數')}
          {row('靜態殘差的輸出 RMS', (p) => sig(p.outRms, 4), 'fs（假設的 $\\Delta a$、$c_2$、$c_3$）')}
          {row('最大的 tone', (p) => (p.tones[0] ? `${sig(p.tones[0].dbc, 4)} dBc @ ${fmtHz(p.tones[0].fHz, 4)}` : '未偵測到'), 'Blackman–Harris Welch：prominence 至少 15 dB，且峰值比鄰近 bin 的中位數高 8 dB 以上；dBc 用該組 code 自己的 $f_{\\mathrm{out}}$')}
        </tbody>
      </table>
    </div>
  )
}

/** 實驗 'training-sequence-lab'：FCW / DSM pattern / code randomization ⇒ PSD、相關、Jacobian 秩、spur。 */
export function TrainingTab() {
  const { training, params: base } = useLab()
  const { shared, setShared, cases, loading, result, error, run, cancel, running, lastDurationMs } = training
  const pal = usePalette()
  const { presets, onLoadPreset } = useShellPresets(EXP.training)

  const patterns = useMemo(() => cases.cases.map((c) => c.params), [cases.cases])
  const tp = useMemo<TrainingParams>(() => ({ ...shared, seed: cases.seed, patterns }), [shared, cases.seed, patterns])
  const errors = useMemo(() => trainingErrors(shared, patterns), [shared, patterns])
  const key = JSON.stringify(tp)
  const dKey = useDebouncedValue(key, 400)
  const dOk = dKey === key && errors.length === 0 && !loading // loading：preset 的第 2、3 組 code 還沒載入完

  const resultKey = result?.key
  const errorKey = error?.key
  useEffect(() => {
    if (!dOk || resultKey === dKey || errorKey === dKey) return
    run(JSON.parse(dKey) as TrainingParams)
  }, [dOk, dKey, resultKey, errorKey, run])

  const res = result?.res ?? null
  const stale = res !== null && resultKey !== key
  const set = (p: Partial<TrainingShared>) => setShared({ ...shared, ...p })
  const nBasis = Object.values(shared.basis).filter(Boolean).length
  const active = res && !stale ? res.patterns[cases.cases.findIndex((c) => c.id === cases.activeId)] : null

  const warnings = useMemo(() => {
    const w = errors.map((e) => `參數不合法：${e}`)
    if (error && error.key === key) w.push(`分析失敗：${tw(error.res)}`)
    if (res && !stale) {
      for (const x of res.warnings) w.push(tw(x))
      res.patterns.forEach((p, i) => {
        for (const x of p.warnings) if (!isNote(x)) w.push(`Case ${'ABC'[i]}：${x}`)
        if (p.cd[0] <= 0 && shared.basis.gain) w.push(`Case ${'ABC'[i]}：$C_0=${texNum(p.cd[0])}\\le0$——raw regressor（$D=0$）的 gain 更新極性錯誤；$C_D$ 圖顯示 $D=${p.bestD}$ 時相關最大。`)
      })
    }
    return w
  }, [errors, error, key, res, stale, shared.basis.gain])

  const metrics = useMemo<MetricRow[]>(() => {
    if (!res) return []
    return res.patterns.flatMap((p, i) => {
      const id = 'ABC'[i]
      const rows: MetricRow[] = [
        { name: `Case ${id}：scaled $J$ 的秩`, value: p.rank, analytic: nBasis, tolerance: 0, claim: 'approx', formulaId: 'F-LAB.15', note: `解析值 = 參數個數 ${nBasis}（滿秩才全部可辨識）` },
        { name: `Case ${id}：$\\min_k\\lambda_{\\min}$（$N_0=${shared.N0}$）`, value: p.peWindowLambdaMin, claim: 'exact', formulaId: 'F-LAB.13' },
      ]
      if (p.closedForm) {
        rows.push(
          { name: `Case ${id}：$E[r]$`, value: p.closedForm.meanSim, unit: '$T_{\\mathrm{vco}}$', analytic: p.closedForm.mean, tolerance: 0.01, claim: 'exact', formulaId: 'F-LAB.2' },
          { name: `Case ${id}：$E[r^2]$`, value: p.closedForm.meanSquareSim, unit: '$T_{\\mathrm{vco}}^2$', analytic: p.closedForm.meanSquare, tolerance: 0.01, claim: 'exact', formulaId: 'F-LAB.2' },
          { name: `Case ${id}：基頻振幅 $A_1$`, value: p.closedForm.line1Sim, unit: '$T_{\\mathrm{vco}}$', analytic: p.closedForm.line1, tolerance: 0.05, toleranceMode: 'rel', claim: 'exact', formulaId: 'F-LAB.3' },
        )
      }
      return rows
    })
  }, [res, nBasis, shared.N0])

  const fPsd = useMemo(() => (res ? figTrainPsd(res, pal) : null), [res, pal])
  const fAcf = useMemo(() => (res ? figTrainAcf(res, pal) : null), [res, pal])
  const fCd = useMemo(() => (res ? figTrainCd(res, pal) : null), [res, pal])
  const fSv = useMemo(() => (res ? figTrainSv(res, pal) : null), [res, pal])
  const log2L = Math.round(Math.log2(shared.length))

  return (
    <ExperimentShell
      id={EXP.training}
      title="Training Sequence Lab：code 的 PSD、相關、Jacobian 秩與 spur"
      level="L3"
      claim="approx"
      source="simulation"
      headingLevel={3}
      description={
        <>
          校正學不學得到，不只看迴路穩不穩，還要看 code 序列有沒有「足夠多樣」的激勵（Persistent Excitation）。這裡比較最多三組 FCW / DSM pattern / code randomization：code 的 PSD、自相關、
          <Tex>{'C_D'}</Tex>、多參數 Jacobian 的秩，以及靜態殘差在輸出端留下的 tone。
        </>
      }
      assumptions={ASSUMPTIONS}
      params={{ ...shared, basis: JSON.stringify(shared.basis), patterns: JSON.stringify(patterns) } as unknown as Record<string, unknown>}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ fRefHz: 'Hz', pllBwHz: 'Hz', sigmaV: 'fs', length: 'sample', N0: 'sample', residualGainFs: 'fs per unit code', c2: 'fs', c3: 'fs', randAmp: 'T_vco' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={trainingCrossCheck(stale ? null : res)}
      actions={{
        onReset: () => {
          cancel()
          setShared(DEFAULT_TRAINING_SHARED)
          cases.reset(DEFAULT_TRAINING_PATTERN)
        },
        onRun: () => {
          if (errors.length === 0) run(tp)
        },
        onStop: cancel,
        running,
      }}
      exportData={() => {
        if (!res) throw new Error('還沒有分析結果')
        return trainingExport(res)
      }}
      presets={presets}
      onLoadPreset={onLoadPreset}
      controls={
        <>
          <CaseSelector cases={cases} label="code 序列" />
          <details className="lab-group" open>
            <summary>
              <span className="lab-group-title">Case {cases.activeId} 的 code</span>
            </summary>
            <div className="lab-group-body">
              <PatternControls value={cases.active.params} onChange={(p) => cases.update(p)} id={cases.activeId} />
            </div>
          </details>
          <details className="lab-group" open>
            <summary>
              <span className="lab-group-title">要辨識的參數（基底）</span>
            </summary>
            <div className="lab-group-body">
              <ToggleControl label={md('gain：$\\phi=x$')} ariaLabel="基底 gain" value={shared.basis.gain} onChange={(v) => set({ basis: { ...shared.basis, gain: v } })} reg="w_gain" />
              <ToggleControl label={md('INL 二階：$\\phi=x^2$')} ariaLabel="基底 INL2" value={shared.basis.inl2} onChange={(v) => set({ basis: { ...shared.basis, inl2: v } })} reg="w_inl2（研究延伸）" />
              <ToggleControl label={md('INL 三階：$\\phi=x^3$')} ariaLabel="基底 INL3" value={shared.basis.inl3} onChange={(v) => set({ basis: { ...shared.basis, inl3: v } })} reg="w_inl3（研究延伸）" />
              <ToggleControl label={md('offset：$\\phi=1$')} ariaLabel="基底 offset" value={shared.basis.offset} onChange={(v) => set({ basis: { ...shared.basis, offset: v } })} reg="w_offset（GOS）" hint={md('$H_{\\mathrm{PD}}(1)=0$ 時結構性不可辨識（E04）')} />
            </div>
          </details>
          <details className="lab-group">
            <summary>
              <span className="lab-group-title">PLL、regressor 與分析設定</span>
            </summary>
            <div className="lab-group-body">
              <button type="button" className="btn" onClick={() => set({ fRefHz: base.fRefHz, nInt: base.nInt, pll: base.pll, pllBwHz: base.pllBwHz, zeta: base.zeta, loopDelay: base.loopDelay, sigmaV: base.sigmaV, regressor: base.regressor, codeDelay: base.codeDelay })}>
                套用 Pipeline 分頁的 PLL / comparator / regressor 設定
              </button>
              <SelectControl label="主 PLL 誤差路徑" value={shared.pll} onChange={(v) => set({ pll: v })} options={[{ value: 'none' as const, label: 'none' }, { value: 'type1' as const, label: 'Type-I DPLL' }, { value: 'type2' as const, label: 'Type-II DPLL' }]} reg="behavioral: pll_error_path.kind" />
              {shared.pll !== 'none' && <ParamControl label={md('PLL 頻寬 $f_{\\mathrm{BW}}$')} ariaLabel="training PLL 頻寬" value={shared.pllBwHz} onChange={(v) => set({ pllBwHz: v })} min={LAB_RANGES.pllBwHz.min} max={LAB_RANGES.pllBwHz.max} log unit="Hz" reg="behavioral: PLL bandwidth" />}
              {shared.pll === 'type2' && <ParamControl label={md('阻尼 $\\zeta$')} ariaLabel="training zeta" value={shared.zeta} onChange={(v) => set({ zeta: v })} min={LAB_RANGES.zeta.min} max={LAB_RANGES.zeta.max} step={0.05} reg="behavioral: damping ζ" />}
              {shared.pll !== 'none' && <ParamControl label={md('loop latency $d_L$')} ariaLabel="training loop latency" value={shared.loopDelay} onChange={(v) => set({ loopDelay: Math.round(v) })} min={0} max={16} step={1} integer clampOnBlur unit="sample" reg="behavioral: loop latency" />}
              <SelectControl label="regressor" value={shared.regressor} onChange={(v) => set({ regressor: v })} options={[{ value: 'raw' as const, label: 'raw x' }, { value: 'delayed' as const, label: 'delayed x[n−D]' }, { value: 'filtered' as const, label: 'filtered-x（Ĥ = H）' }]} reg="REG_GMAC_XSEL[1:0]" />
              {shared.regressor !== 'raw' && <ParamControl label={md('Jacobian 用的 code delay $D$')} ariaLabel="training code delay" value={shared.codeDelay} onChange={(v) => set({ codeDelay: Math.round(v) })} min={TRAINING_RANGES.codeDelay.min} max={TRAINING_RANGES.codeDelay.max} step={1} integer clampOnBlur unit="sample" reg="REG_GMAC_CODE_DLY[11:0]" />}
              <ParamControl label={md('comparator 雜訊 $\\sigma_v$')} ariaLabel="training sigma_v" value={shared.sigmaV} onChange={(v) => set({ sigmaV: v })} min={0} max={LAB_RANGES.sigmaV.max} step={1} unit="fs" reg="behavioral: pd_noise_rms_fs" hint={md('只影響 $J$ 的尺度 $K_q$，不影響秩')} />
              <ParamControl label={md('序列長度 $\\log_2L$')} ariaLabel="training 序列長度" value={log2L} onChange={(v) => set({ length: 2 ** Math.round(v) })} min={TRAINING_RANGES.log2Length.min} max={TRAINING_RANGES.log2Length.max} step={1} integer clampOnBlur unit="bit" reg="simulation: sequence length" hint={`${shared.length} samples`} />
              <ParamControl label={md('PE 視窗 $N_0$')} ariaLabel="training N0" value={shared.N0} onChange={(v) => set({ N0: Math.round(v) })} min={TRAINING_RANGES.N0.min} max={Math.min(TRAINING_RANGES.N0.max, shared.length)} log integer clampOnBlur unit="sample" reg="REG_GMAC_N[16:0]" hint="通常取 GMAC 的 N" />
              <ParamControl label="自相關最大 lag" value={shared.maxLag} onChange={(v) => set({ maxLag: Math.round(v) })} min={TRAINING_RANGES.maxLag.min} max={TRAINING_RANGES.maxLag.max} log integer clampOnBlur unit="sample" reg="analysis: max lag" />
              <ParamControl label={md('$C_D$ 掃描的最大 $D$')} ariaLabel="training max delay" value={shared.maxDelay} onChange={(v) => set({ maxDelay: Math.round(v) })} min={1} max={TRAINING_RANGES.maxDelay.max} log integer clampOnBlur unit="sample" reg="analysis: max delay" />
              <ParamControl label={md('spur 用的殘餘 gain 誤差 $\\Delta a$')} ariaLabel="training 殘餘 gain" value={shared.residualGainFs} onChange={(v) => set({ residualGainFs: v })} min={TRAINING_RANGES.residualGainFs.min} max={TRAINING_RANGES.residualGainFs.max} step={0.01} unit="fs" reg="behavioral: residual gain error" />
              <ParamControl label={md('spur 用的 $c_2$')} ariaLabel="training c2" value={shared.c2} onChange={(v) => set({ c2: v })} min={LAB_RANGES.c2.min} max={LAB_RANGES.c2.max} step={0.01} unit="fs" reg="behavioral: dtc_nonlinearity.c2" />
              <ParamControl label={md('spur 用的 $c_3$')} ariaLabel="training c3" value={shared.c3} onChange={(v) => set({ c3: v })} min={LAB_RANGES.c3.min} max={LAB_RANGES.c3.max} step={0.01} unit="fs" reg="behavioral: dtc_nonlinearity.c3" />
            </div>
          </details>
        </>
      }
    >
      <PresetNote experiment={EXP.training} />
      <div className="lab-status small" role="status">
        {running ? '分析中…' : res ? (stale ? '下方是舊設定的結果（停手後自動重算）' : `分析完成${lastDurationMs !== null ? `（${Math.round(lastDurationMs)} ms）` : ''}：${res.patterns.length} 組 code、每組 ${shared.length} samples`) : '尚未分析（停手 0.4 秒後自動執行）'}
      </div>
      {res && (
        <div className={stale ? 'lab-results lab-stale' : 'lab-results'}>
          {fPsd && (
            <Plot
              title="正規化 code 的 PSD $S_x(f)$"
              csvName="training-code-psd"
              data={fPsd.data}
              layout={fPsd.layout}
              xLog
              yLog
              height={300}
              caption={`Welch、Hann window、nperseg $=${res.patterns[0].psd.nperseg}$、ENBW $=${texNum(res.patterns[0].psd.enbwHz, 4)}\\,\\mathrm{Hz}$、one-sided、取樣率 $f_s=f_{\\mathrm{ref}}$；對數頻率格點上每格取最大值（保留譜線）。一階 DSM 是一排譜線（$k\\alpha f_{\\mathrm{ref}}$），MASH 1-1-1 是 $+40\\,\\mathrm{dB/dec}$ 的 shaped noise；加上隨機化的 code 是「原本的譜線 + 一層白色底」——譜線並沒有消失，正規化後相對變矮只是因為總功率變大（$s$ 變小）。`}
            />
          )}
          {fAcf && <Plot title="自相關 $R_x[\ell]/R_x[0]$（去平均）" csvName="training-acf" data={fAcf.data} layout={fAcf.layout} height={260} caption="自相關衰減得慢 = code 變化慢 = 能量集中在低頻；而 $H_{\mathrm{PD}}$ 正好把低頻濾掉，所以 PD 看到的激勵很少。" />}
          {fCd && <Plot title="$C_D=E[x_{\mathrm{ref}}^{(D)}u_x]$ 對 GMAC code delay $D$" csvName="training-cd" data={fCd.data} layout={fCd.layout} height={280} caption="$C_D>0$ 的區間才是正確極性的 delay 範圍（第 7 章）。白色 code 只有 $D=0$ 附近有相關；週期 code 的 $C_D$ 以週期重複，換一個 FCW 可行的 $D$ 就不同。" />}
          {fSv && <Plot title="scaled Jacobian 的奇異值（每組一簇）" csvName="training-sv" data={fSv.data} layout={fSv.layout} height={260} caption="最小奇異值掉到數值零 $\Rightarrow$ $\lambda_{\min}=0$：有一個參數方向不可辨識。這不是「多收一點資料」能解決的（§9、§10）。" />}
          <h4 className="lab-subhead">
            逐組摘要 <ClaimTag kind="approx" />
          </h4>
          <PatternSummary pats={res.patterns} n={nBasis} />
          {active && (
            <ModeGate min="engineer">
              <h4 className="lab-subhead">
                Case {cases.activeId} 的 Jacobian <ClaimTag kind="approx" />
              </h4>
              <p className="small">
                列 = 相關器（regressor <Tex>{'\\psi_i'}</Tex>）、欄 = 參數（基底 <Tex>{`\\phi_j\\in\\{${active.basisTex.join(',\\,')}\\}`}</Tex>）；單位 <Tex>{'\\mathrm{fs}^{-1}'}</Tex>。
              </p>
              <div className="lab-tex-scroll">
                <Tex>{`J=K_q\\,E[\\psi\\,\\phi_u^{\\mathsf T}]=${matrixTex(active.J)}`}</Tex>
              </div>
              <p className="small">
                特徵值：
                {active.eigJ.map((z, i) => (
                  <span key={i} className="mono lab-eig">
                    {sig(z.re, 4)}
                    {Math.abs(z.im) > 1e-12 ? ` ${z.im > 0 ? '+' : '−'} j${sig(Math.abs(z.im), 4)}` : ''}
                  </span>
                ))}
                ；scaled 奇異值：
                {active.svScaled.map((v, i) => (
                  <span key={i} className="mono lab-eig">
                    {sig(v, 4)}
                  </span>
                ))}
              </p>
            </ModeGate>
          )}
          {res.patterns.some((p) => p.warnings.some(isNote)) && (
            <ul className="small muted lab-notes">
              {res.patterns.flatMap((p, i) =>
                p.warnings.filter(isNote).map((x, j) => (
                  <li key={`${i}-${j}`}>
                    Case {'ABC'[i]} 的註記：{md(x)}
                  </li>
                )),
              )}
            </ul>
          )}
          <Callout kind="info" title="怎麼讀這個分頁（沒有任何晶片量測）">
            <p className="small">
              {md(
                '這裡的每個數字都是「這串 code 經過這個線性 PLL 模型」的計算結果。它能回答 code 有沒有足夠激勵、哪個 $D$ 的極性正確、殘差會在哪個頻率留下 tone；它不能回答某顆晶片實際的 spur 是多少 dBc——那需要該電路的 DTC INL、mismatch 與量測。code randomization 的效果標為「研究假說／延伸」。比較不同正規化或不同 overlay 的 tone 時要小心：$\\Delta a$ 的單位是 fs per unit code，正規化的 scale $s$ 一變，同一個 $\\Delta a$ 對應的實體 gain 誤差（fs per $T_{\\mathrm{vco}}$，等於 $\\Delta a\\cdot s$）就不同。',
              )}
            </p>
          </Callout>
        </div>
      )}
    </ExperimentShell>
  )
}
