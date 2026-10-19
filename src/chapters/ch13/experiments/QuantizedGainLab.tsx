import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaseSelector,
  Callout,
  ExperimentShell,
  ModeGate,
  ParamControl,
  SelectControl,
  Tex,
  ToggleControl,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CaseId,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  PRBS_TAPS,
  STRATEGY_LABEL,
  validateQuantParams,
  type Arithmetic,
  type CaseSpec,
  type DitherPdf,
  type OverflowMode,
  type QuantLabInput,
  type QuantLabParams,
  type QuantLabResult,
  type QuantStrategy,
  type RandomSource,
  type RoundingMode,
  type ToggleOrder,
} from '@/simulation/models/quantizer'
import type { DsmKind } from '@/simulation/models/dsm'
import { DEFAULT_LAB_PARAMS, STRATEGY_OPTIONS, ntex } from '../common'
import { ComparePanel, HistogramPanel, MixingPanel, PeriodPanel, PsdPanel, SpurTable, TimelinePanel, type CaseView } from './LabPanels'
import { crossChecks, metricRows, warnTex, type SharedParams } from './labChecks'

export const EXPERIMENT_ID = 'quantized-gain-lab'

/** 每個比較組（Case A/B/C）可獨立設定的參數。 */
export interface CaseParams {
  strategy: QuantStrategy
  lmsNoise: boolean
  nUpd: number
}

export const DEFAULT_CASES: CaseParams[] = [
  { strategy: 'toggle', lmsNoise: false, nUpd: 1 },
  { strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 },
  { strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 },
]

function splitPreset(raw: Record<string, unknown>): { shared: SharedParams; cases: CaseParams[] | null } {
  const { cases, lmsNoise: _ln, nUpd: _nu, ...rest } = raw as Record<string, unknown> & { cases?: CaseParams[] }
  const shared = { ...DEFAULT_LAB_PARAMS, ...(rest as Partial<SharedParams>) } as QuantLabParams
  const { lmsNoise: _a, nUpd: _b, ...sharedOnly } = shared
  return { shared: sharedOnly, cases: Array.isArray(cases) && cases.length ? cases.slice(0, 3) : null }
}

const DEFAULT_SHARED = splitPreset({}).shared

export function QuantizedGainLab() {
  const tokens = useThemeTokens()
  const [shared, setShared] = useState<SharedParams>(DEFAULT_SHARED)
  const cases = useCases<CaseParams>(DEFAULT_CASES[0], { seed: DEFAULT_SHARED.seed })
  const [result, setResult] = useState<QuantLabResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const { run, running, lastDurationMs, mode } = useWorkerTask<QuantLabInput, QuantLabResult>('quantizer', 'runQuantLab', { restartOnRun: true })

  const set = useCallback(<K extends keyof SharedParams>(k: K, v: SharedParams[K]) => setShared((s) => ({ ...s, [k]: v })), [])

  /** 把 case 清單套到 useCases（增減 case 後逐一更新）。 */
  const casesRef = useRef(cases)
  casesRef.current = cases
  const applyCaseList = useCallback((list: CaseParams[]) => {
    const c = casesRef.current
    const ids: CaseId[] = c.cases.map((x) => x.id)
    while (ids.length < list.length) {
      const id = c.addCase()
      if (!id) break
      ids.push(id)
    }
    ids.slice(list.length).forEach((id) => c.removeCase(id))
    list.forEach((p, i) => {
      if (ids[i]) c.update({ ...p }, ids[i])
    })
    if (ids[0]) c.setActive(ids[0])
  }, [])

  const applyPreset = useCallback(
    (raw: Record<string, unknown>) => {
      const { shared: s, cases: list } = splitPreset(raw)
      setShared(s)
      casesRef.current.setSeed(s.seed)
      applyCaseList(list ?? DEFAULT_CASES)
    },
    [applyCaseList],
  )

  // 首次掛載與網址 ?preset=<id>：有 preset 就套用 preset，否則套用預設的 A/B/C = Toggle / ΔΣ / ΔΣ+dither
  // （常數 32.4 時可直接看到 D ≡ B）。
  // 兩者必須在「同一個」effect 裡二選一：useCases 的 cases 快照在同一輪 effect 中不會更新，若先套預設、
  // 再套網址 preset，第二次 applyCaseList 會拿到過期的清單（只有 Case A 被更新，B / C 還是預設策略）。
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  useEffect(() => {
    applyPreset(urlPreset ? urlPreset.params : {})
  }, [urlPreset, applyPreset])

  const active = cases.active.params
  const seed = cases.seed
  const fullParams: QuantLabParams = useMemo(() => ({ ...shared, seed, lmsNoise: active.lmsNoise, nUpd: active.nUpd }), [shared, seed, active.lmsNoise, active.nUpd])
  const caseSpecs: CaseSpec[] = useMemo(() => cases.cases.map((c) => ({ id: c.id, strategy: c.params.strategy, lmsNoise: c.params.lmsNoise, nUpd: c.params.nUpd })), [cases.cases])
  const validation = useMemo(() => validateQuantParams(fullParams), [fullParams])
  const input = useMemo(
    () => ({ params: fullParams, cases: caseSpecs, compareAll: true, compareScenario: { lmsNoise: active.lmsNoise, nUpd: active.nUpd }, nonce }),
    [fullParams, caseSpecs, active.lmsNoise, active.nUpd, nonce],
  )
  const debounced = useDebouncedValue(input, 250)

  useEffect(() => {
    if (validateQuantParams(debounced.params).length) return
    const { nonce: _n, ...payload } = debounced
    run(payload)
      .then((r) => {
        setResult(r)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
      })
  }, [debounced, run])

  const views: CaseView[] = useMemo(() => {
    if (!result) return []
    const out: CaseView[] = []
    result.caseIds.forEach((id, i) => {
      const c = cases.cases.find((x) => x.id === id)
      if (c && result.runs[i]) out.push({ id, seriesIndex: c.seriesIndex, run: result.runs[i] })
    })
    return out
  }, [result, cases.cases])
  const activeView = views.find((v) => v.id === cases.activeId) ?? views[0]
  const activeRun = activeView?.run

  // 模型的訊息是純文字（σ_w、N_upd、⌊w*⌋ …）：顯示前用 warnTex 把數學換成 `$...$`，ExperimentShell 會以 KaTeX 顯示
  const warnings = useMemo(() => {
    const w: string[] = validation.map(warnTex)
    if (error) w.push(`模擬失敗：${warnTex(error)}`)
    if (result) w.push(...result.warnings.map(warnTex))
    for (const v of views) for (const msg of [...v.run.warnings, ...(v.run.mixing?.warnings ?? [])]) w.push(`Case ${v.id}：${warnTex(msg)}`)
    return [...new Set(w)]
  }, [validation, error, result, views])

  const presets = useMemo(() => presetsForExperiment(EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })), [])
  const fu = fullParams.fs / fullParams.nUpd
  const cc = crossChecks(activeRun, shared, shared.length)

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title="Quantized Gain Lab：6-bit code、limit cycle、dither、ΔΣ"
      level="L5"
      claim="exact"
      source="simulation"
      tests={['T16', 'T17']}
      headingLevel={3}
      description={
        <>
          內部高解析 <Tex>{'w_H'}</Tex> <Tex>{String.raw`\to`}</Tex> 量化策略 <Tex>{String.raw`\to`}</Tex> 6-bit code <Tex>{'y'}</Tex>；Case A/B/C 共用 seed 與所有共用參數（paired comparison），下方另有同一情境下的五策略總表。code 更新率 <Tex>{String.raw`f_u=f_s/N_\mathrm{upd}=${ntex(fu, 5)}\ \mathrm{Hz}`}</Tex>（目前 Case）。
        </>
      }
      assumptions={[
        String.raw`$w_H[n]=w^*[n]+\delta w[n]$；$\delta w$ 為 AR(1)（穩態 RMS $\sigma_w$、pole $p_\mathrm{cal}$），代表第 12 章的 LMS 更新雜訊；$w^*[n]$ 可含線性 PVT 漂移`,
        String.raw`$Q_B$：round-half-up 或 floor；超出 $[0,\,2^B-1]$ 時 saturate 或 wrap`,
        'rational / fixed 模式為整數精確運算（tie 不受浮點誤差影響）；float 模式為 IEEE double',
        String.raw`週期偵測比較整數 code 序列（從 $L/4$ 起、至少重複 2 次）`,
        String.raw`PSD：Welch、Hann、one-sided、$\mathrm{LSB}^2/\mathrm{Hz}$、每段去平均；DC 誤差另列`,
        String.raw`Mixing：$\delta t=\Delta_\mathrm{LSB}\,(y-w^*)\,x[n]$，$x$ 為標準化 DSM residue（frac、20-bit accumulator），code 以 ZOH 保持 $N_\mathrm{upd}$ 個 reference cycle`,
        String.raw`$\sigma_\mathrm{out}$ 以 CT 二階 type-II $T(f)$（$\zeta$、$-3\,\mathrm{dB}$ 頻寬）加權積分 [近似｜$f\ll f_s$]；不含 PD noise 與 cross-spectrum`,
        String.raw`$\sigma_\mathrm{out}$ 只含 $f\ge f_L$（Welch 解析度 $f_s/N_\mathrm{seg}$）的成分；更慢的成分另列為「慢變成分」與「靜態偏移」，混頻週期 $\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},\,P_\mathrm{DSM})$ 比紀錄長時會警告`,
        '所有數值為示例（illustrative），不是量測',
      ]}
      params={{ ...fullParams, cases: caseSpecs.map((c) => `${c.id}:${c.strategy}${c.lmsNoise ? '+noise' : ''}@${c.nUpd}`).join(' ') }}
      seed={seed}
      onSeedChange={cases.setSeed}
      units={{ target: 'LSB', sigmaW: 'LSB', driftPerK: 'LSB/1000 updates', ditherLsb: 'LSB p-p', lsbFs: 'fs/LSB', fs: 'Hz', pllBwHz: 'Hz', rInit: 'LSB' }}
      metrics={metricRows(activeRun, shared)}
      warnings={warnings}
      crossCheck={cc}
      actions={{
        onReset: () => applyPreset({}),
        onRun: () => setNonce((x) => x + 1),
        // Freeze/Track 切換（規格 §13.6）：凍結 = LMS 在 L/4 次更新後停止，w_H 之後保持不變（只影響有 LMS 雜訊或 PVT 漂移的情境）
        onFreeze: () => set('lmsFreezeAt', shared.lmsFreezeAt > 0 ? 0 : Math.max(1, Math.floor(shared.length / 4))),
        frozen: shared.lmsFreezeAt > 0,
        running,
      }}
      exportData={() => {
        if (!result || !activeRun) throw new Error('尚無模擬結果')
        const cols: Record<string, ArrayLike<number | string>> = {
          trace_n: activeRun.trace.n,
          trace_y: activeRun.trace.y,
          trace_wH: activeRun.trace.wH,
          trace_wStar: activeRun.trace.wStar,
          trace_v: activeRun.trace.v,
          trace_r: activeRun.trace.r,
          hist_code: activeRun.hist.codes,
          hist_count: activeRun.hist.counts,
        }
        for (const v of views) {
          cols[`psd_f_${v.id}`] = v.run.psd.f
          cols[`psd_${v.id}_${v.run.strategy}`] = v.run.psd.psd
        }
        // 目前 Case 的譜線表（精確 DFT 或 Welch 偵測）與 mixing 後的 δt PSD
        cols.spur_f_hz = activeRun.lines.map((l) => l.f)
        cols.spur_power_lsb2 = activeRun.lines.map((l) => l.power)
        cols.spur_k = activeRun.lines.map((l) => l.k ?? Number.NaN)
        if (activeRun.zohLines) {
          cols.zoh_spur_f_hz = activeRun.zohLines.map((l) => l.f)
          cols.zoh_spur_power_lsb2 = activeRun.zohLines.map((l) => l.power)
        }
        for (const v of views) {
          if (!v.run.mixing) continue
          cols[`mix_f_${v.id}`] = v.run.mixing.f
          cols[`mix_psd_fs2_per_hz_${v.id}`] = v.run.mixing.psd
        }
        if (result.compare.length) cols.compare_psd_f = result.compare[0].psd.f
        for (const r of result.compare) cols[`compare_psd_${r.strategy}`] = r.psd.psd
        // 五策略總表的數值（與畫面上的表相同；一列一個策略）
        const cmp = result.compare
        cols.compare_strategy = cmp.map((r) => r.strategy)
        cols.compare_dc_error_lsb = cmp.map((r) => r.metrics.dcError)
        cols.compare_err_power_lsb2 = cmp.map((r) => r.metrics.errPower)
        cols.compare_inband_lsb2 = cmp.map((r) => r.metrics.lfErrPower)
        cols.compare_inband_quant_lsb2 = cmp.map((r) => r.metrics.lfQuantPower)
        cols.compare_max_spur_lsb2 = cmp.map((r) => r.metrics.maxSpur?.power ?? Number.NaN)
        cols.compare_period = cmp.map((r) => r.metrics.period)
        cols.compare_sigma_out_fs = cmp.map((r) => r.mixing?.sigmaOutFs ?? Number.NaN)
        return cols
      }}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <div className="ch13-controls">
          <div className="ch13-ctl-group">
            <div className="ch13-ctl-title">目標與 gain register</div>
            <ParamControl label={<><Tex>{'w^*'}</Tex>（目標）</>} ariaLabel="w*（目標）" value={shared.target} onChange={(v) => set('target', v)} min={-8} max={4100} step={0.01} unit="LSB" reg="BEH_W_STAR（LMS 收斂值）" digits={8} hint="可精確輸入，例如 32.4、32.3、63.4" />
            <ParamControl label={<><Tex>{'B'}</Tex>（code 位元數）</>} ariaLabel="B（code 位元數）" value={shared.bits} onChange={(v) => set('bits', v)} min={1} max={12} integer clampOnBlur unit="bit" reg="REG_DTC_GAIN[B-1:0]" />
            <ParamControl label={<Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>} ariaLabel="Δ_LSB（1 個 gain LSB 的 DTC gain）" value={shared.lsbFs} onChange={(v) => set('lsbFs', v)} min={0.001} max={10} log unit="fs/LSB" reg="gain_lsb_fs（勘誤 E13）" />
            <SelectControl<RoundingMode>
              label={<><Tex>{'Q_B'}</Tex> 的 rounding</>}
              ariaLabel="Q_B 的 rounding 模式"
              value={shared.rounding}
              onChange={(v) => set('rounding', v)}
              options={[
                { value: 'nearest', label: 'round-half-up ⌊v+½⌋' },
                { value: 'floor', label: 'floor（truncation）⌊v⌋' },
              ]}
              reg="REG_GAIN_Q_RND"
            />
            <SelectControl<OverflowMode>
              label="超出範圍"
              value={shared.overflow}
              onChange={(v) => set('overflow', v)}
              options={[
                { value: 'saturate', label: 'saturate（建議）' },
                { value: 'wrap', label: 'wrap（無號數模 2^B 溢位：64 → 0）' },
              ]}
              reg="REG_GAIN_SAT_EN"
            />
            <ToggleControl label={<><Tex>{String.raw`\Delta\Sigma`}</Tex> anti-windup（<Tex>{'r'}</Tex> 夾回範圍）</>} ariaLabel="ΔΣ anti-windup（r 夾回範圍）" value={shared.antiWindup} onChange={(v) => set('antiWindup', v)} reg="REG_DS_ANTIWINDUP" />
            <SelectControl<Arithmetic>
              label="算術"
              value={shared.arithmetic}
              onChange={(v) => set('arithmetic', v)}
              options={[
                { value: 'rational', label: 'rational（精確有理數）' },
                { value: 'fixed', label: 'fixed（F 個小數 bit）' },
                { value: 'float', label: 'float（IEEE double）' },
              ]}
              reg="BEH_ARITH"
              hint="E15：tie 判斷必須用整數 / 定點"
            />
            {shared.arithmetic === 'fixed' && (
              <ParamControl label={<><Tex>{'F'}</Tex>（<Tex>{'w_H'}</Tex> 小數 bit）</>} ariaLabel="F（w_H 小數 bit）" value={shared.fracBits} onChange={(v) => set('fracBits', v)} min={0} max={30} integer clampOnBlur unit="bit" reg="REG_LMS_ACC[F-1:0]" hint={<>常數輸入的週期 <Tex>{String.raw`=2^F/\gcd(K\bmod2^F,2^F)`}</Tex></>} />
            )}
          </div>
          <div className="ch13-ctl-group">
            <div className="ch13-ctl-title">
              <Tex>{'w_H'}</Tex>：LMS 雜訊、PVT、Freeze/Track
            </div>
            <ParamControl label={<><Tex>{String.raw`\sigma_w`}</Tex>（LMS 雜訊 RMS）</>} ariaLabel="σ_w（LMS 雜訊 RMS）" value={shared.sigmaW} onChange={(v) => set('sigmaW', v)} min={0} max={5} step={0.01} unit="LSB" reg="BEH_LMS_SIGMA_W" hint={<>只在 Case 勾選「LMS 雜訊」時使用；等於第 12 章的 <Tex>{String.raw`\sigma_w\,[\mathrm{fs}]/\Delta_\mathrm{LSB}`}</Tex></>} />
            <ParamControl label={<><Tex>{String.raw`p_\mathrm{cal}`}</Tex>（AR(1) pole）</>} ariaLabel="p_cal（AR(1) pole）" value={shared.pole} onChange={(v) => set('pole', v)} min={0} max={0.9999} step={0.0001} unit="無因次" reg="BEH_P_CAL" digits={6} hint={<>第 12 章的係數 pole <Tex>{String.raw`p=1-\mu K`}</Tex></>} />
            <ParamControl label="PVT drift" value={shared.driftPerK} onChange={(v) => set('driftPerK', v)} min={-2} max={2} step={0.01} unit="LSB/1000 次更新" reg="BEH_PVT_DRIFT" />
            <ParamControl label="LMS 凍結於第幾次更新（0 = 持續追蹤）" value={shared.lmsFreezeAt} onChange={(v) => set('lmsFreezeAt', v)} min={0} max={shared.length - 1} integer clampOnBlur unit="次更新" reg="REG_LMS_FREEZE" hint={<>Freeze/Track：凍結後 <Tex>{'w_H'}</Tex> 為定點常數，<Tex>{String.raw`\Delta\Sigma`}</Tex> 重新進入 limit cycle；上方「凍結 Freeze」按鈕會設成 <Tex>{'L/4'}</Tex></>} />
          </div>
          <div className="ch13-ctl-group">
            <div className="ch13-ctl-title">策略參數</div>
            <ParamControl label={<>Toggle 週期 <Tex>{'L_t'}</Tex></>} ariaLabel="Toggle 週期 L_t" value={shared.togglePeriod} onChange={(v) => set('togglePeriod', v)} min={2} max={4096} integer clampOnBlur unit="次更新" reg="REG_TOGGLE_LEN" />
            <SelectControl<ToggleOrder>
              label="Toggle 排列"
              value={shared.toggleOrder}
              onChange={(v) => set('toggleOrder', v)}
              options={[
                { value: 'spread', label: 'spread（Bresenham）' },
                { value: 'clustered', label: 'clustered（PWM）' },
              ]}
              reg="REG_TOGGLE_MODE"
            />
            <SelectControl<RandomSource>
              label="亂數來源（C、E）"
              value={shared.randomSource}
              onChange={(v) => set('randomSource', v)}
              options={[
                { value: 'ideal', label: 'ideal（xoshiro128**）' },
                { value: 'prbs', label: 'PRBS（LFSR）' },
              ]}
              reg="REG_RNG_SEL"
            />
            {shared.randomSource === 'prbs' && (
              <SelectControl<number>
                label={<>PRBS 長度 <Tex>{'N'}</Tex></>}
                ariaLabel="PRBS 長度 N"
                value={shared.prbsBits}
                onChange={(v) => set('prbsBits', v)}
                options={Object.keys(PRBS_TAPS).map((k) => ({ value: Number(k), label: `PRBS-${k}（週期 ${2 ** Number(k) - 1}）` }))}
                reg="REG_PRBS_LEN"
              />
            )}
            <ParamControl label={<>Dither 寬度 <Tex>{'A'}</Tex>（方法 E）</>} ariaLabel="Dither 寬度 A（方法 E）" value={shared.ditherLsb} onChange={(v) => set('ditherLsb', v)} min={0} max={4} step={0.05} unit="LSB p-p" reg="REG_DITHER_AMP" />
            <SelectControl<DitherPdf>
              label="Dither PDF"
              value={shared.ditherPdf}
              onChange={(v) => set('ditherPdf', v)}
              options={[
                { value: 'uniform', label: 'RPDF（uniform，Var A²/12）' },
                { value: 'triangular', label: 'TPDF（triangular，Var A²/24）' },
              ]}
              reg="REG_DITHER_PDF"
            />
            <ModeGate min="research">
              <ParamControl label={<><Tex>{String.raw`\Delta\Sigma`}</Tex> 初始 <Tex>{'r[-1]'}</Tex></>} ariaLabel="ΔΣ 初始 r[−1]" value={shared.rInit} onChange={(v) => set('rInit', v)} min={-2} max={2} step={0.01} unit="LSB" reg="REG_DS_R_INIT" hint="E15：任何初始值都進入同一個 limit cycle" />
            </ModeGate>
          </div>
          <div className="ch13-ctl-group">
            <div className="ch13-ctl-title">時基、DSM mixing 與 PLL</div>
            <ParamControl label={<><Tex>{'f_s'}</Tex>（reference / DTC 取樣率）</>} ariaLabel="f_s（reference / DTC 取樣率）" value={shared.fs} onChange={(v) => set('fs', v)} min={1e3} max={1e10} log unit="Hz" reg="BEH_FS（f_ref）" />
            <ToggleControl label={<>DSM residue mixing + PLL <Tex>{'T(f)'}</Tex></>} ariaLabel="DSM residue mixing + PLL T(f)" value={shared.mixing} onChange={(v) => set('mixing', v)} reg="BEH_MIXING_EN" hint="§13.5 第 6 點；較耗時" />
            {shared.mixing && (
              <>
                <SelectControl<DsmKind>
                  label="DSM"
                  value={shared.dsmKind}
                  onChange={(v) => set('dsmKind', v)}
                  options={[
                    { value: 'first_order', label: '一階' },
                    { value: 'mash111', label: 'MASH 1-1-1' },
                  ]}
                  reg="REG_DSM_MODE"
                />
                <ParamControl
                  label="FCW frac"
                  value={shared.dsmFrac}
                  onChange={(v) => set('dsmFrac', v)}
                  min={0.0001}
                  max={0.9999}
                  step={0.0001}
                  unit="無因次"
                  reg="REG_FCW_FRAC[19:0]"
                  digits={9}
                  hint={
                    <>
                      20-bit：<Tex>{String.raw`K=\mathrm{round}(\mathrm{frac}\cdot2^{20})`}</Tex>，一階 DSM 的週期 <Tex>{String.raw`2^{20}/\gcd(K,2^{20})`}</Tex>。預設 <Tex>{'13/128'}</Tex>（週期 128）；改成 0.1
                      這類「漂亮」的數字，週期變成 <Tex>{'2^{19}'}</Tex>，混頻產物可能藏在 DC（會出現警告）
                    </>
                  }
                />
                <ParamControl label={<>PLL <Tex>{String.raw`-3\,\mathrm{dB}`}</Tex> 頻寬</>} ariaLabel="PLL −3 dB 頻寬" value={shared.pllBwHz} onChange={(v) => set('pllBwHz', v)} min={Math.min(1e3, shared.fs / 100)} max={shared.fs / 2.01} log unit="Hz" reg="BEH_PLL_BW" />
                <ParamControl label={<>PLL <Tex>{String.raw`\zeta`}</Tex></>} ariaLabel="PLL 阻尼比 ζ" value={shared.pllZeta} onChange={(v) => set('pllZeta', v)} min={0.3} max={2} step={0.01} unit="無因次" reg="BEH_PLL_ZETA" />
              </>
            )}
          </div>
          <div className="ch13-ctl-group">
            <div className="ch13-ctl-title">模擬長度與頻譜分析</div>
            <ParamControl label={<><Tex>{'L'}</Tex>（code 更新次數）</>} ariaLabel="L（code 更新次數）" value={shared.length} onChange={(v) => set('length', v)} min={256} max={262144} integer clampOnBlur unit="次更新" reg="BEH_SIM_LEN" hint={<>偵測從 <Tex>{'L/4'}</Tex> 起、至少要重複 2 次：週期 <Tex>{'P'}</Tex> 需 <Tex>{String.raw`P\le\lfloor 3L/8\rfloor`}</Tex>（即 <Tex>{String.raw`L\ge 8P/3`}</Tex>）才偵測得到</>} />
            <ParamControl label="Welch nperseg" value={shared.nperseg} onChange={(v) => set('nperseg', v)} min={64} max={65536} integer clampOnBlur unit="samples" reg="BEH_WELCH_NPERSEG" />
            <ModeGate min="engineer">
              <ParamControl label="mixing 樣本上限" value={shared.mixSamples} onChange={(v) => set('mixSamples', v)} min={4096} max={1 << 20} integer clampOnBlur unit="reference cycles" reg="BEH_MIX_SAMPLES" />
            </ModeGate>
          </div>
        </div>
      }
    >
      <div className="ch13-cases">
        <CaseSelector cases={cases} label="比較組（同 seed）" />
        <div className="ch13-case-controls">
          <SelectControl<QuantStrategy>
            label={`Case ${cases.activeId} 的策略`}
            value={active.strategy}
            onChange={(v) => cases.update({ strategy: v })}
            options={STRATEGY_OPTIONS}
            reg="REG_GAIN_Q_MODE"
          />
          <ToggleControl label={<>Case {cases.activeId}：<Tex>{'w_H'}</Tex> 含 LMS 雜訊</>} ariaLabel={`Case ${cases.activeId}：w_H 含 LMS 雜訊`} value={active.lmsNoise} onChange={(v) => cases.update({ lmsNoise: v })} reg="BEH_LMS_NOISE_EN" />
          <ParamControl
            label={<>Case {cases.activeId}：<Tex>{String.raw`N_\mathrm{upd}`}</Tex>（每幾個 reference cycle 更新 code）</>}
            ariaLabel={`Case ${cases.activeId}：N_upd（每幾個 reference cycle 更新 code）`}
            value={active.nUpd}
            onChange={(v) => cases.update({ nUpd: v })}
            min={1}
            max={65536}
            integer
            clampOnBlur
            unit="reference cycles"
            reg="REG_GAIN_UPD_DIV"
            hint={<Tex>{String.raw`f_u=f_s/N_\mathrm{upd}=${ntex(shared.fs / active.nUpd, 5)}\ \mathrm{Hz}`}</Tex>}
          />
        </div>
      </div>
      <p className="small muted">
        {running ? '計算中…' : lastDurationMs !== null ? `上次計算 ${lastDurationMs.toFixed(0)} ms（${mode === 'worker' ? 'Web Worker' : '主執行緒'}）` : ''}
        {result ? ` · ${result.durationHint}` : ''}
      </p>
      {!result && !error && <Callout kind="info">計算中…（Web Worker）</Callout>}
      {activeRun && (
        <>
          <TimelinePanel run={activeRun} tokens={tokens} />
          <PeriodPanel run={activeRun} />
          <HistogramPanel cases={views} tokens={tokens} />
          <PsdPanel cases={views} tokens={tokens} active={activeView} />
          <SpurTable run={activeRun} lsbFs={shared.lsbFs} />
          <MixingPanel cases={views} tokens={tokens} bwHz={shared.pllBwHz} zeta={shared.pllZeta} />
        </>
      )}
      {result && result.compare.length > 0 && (
        <details className="ch13-fold" open>
          <summary>五策略總表（同一情境、同 seed；跟隨 Case {cases.activeId} 的情境）</summary>
          <div className="ch13-fold-body">
            <ComparePanel result={result} tokens={tokens} lsbFs={shared.lsbFs} />
          </div>
        </details>
      )}
      <p className="small muted">
        試試看：① 預設（常數 <Tex>{'w^*=32.4'}</Tex>）時 Case A（Toggle）與 Case B（ΔΣ）的 PSD 完全重疊——勘誤 E15 的 D ≡ B；② 把 Case B 勾選「LMS 雜訊」，看它的週期消失、頻帶內誤差貼近 LMS
        地板；③ 算術改 fixed、<Tex>{'F=10'}</Tex>，看偵測週期變成 <Tex>{String.raw`2^{10}/\gcd(410,1024)=512`}</Tex>；④ 把 <Tex>{'w^*'}</Tex> 改成 63.4 並選 wrap；⑤ Case C 改 Stochastic、亂數來源改 PRBS-7，看週期 127；⑥ Freeze/Track：算術選 fixed、<Tex>{'F=8'}</Tex>，Case 勾選「LMS 雜訊」後按上方的「凍結 Freeze」——LMS 在第{' '}
        <Tex>{'L/4'}</Tex> 次更新後停止，<Tex>{'w_H'}</Tex> 變成定點常數，ΔΣ 的 limit cycle 重新出現（週期 <Tex>{String.raw`2^F/\gcd`}</Tex>）；再按一次回到持續追蹤（Track）。
        {STRATEGY_LABEL.freeze} 的誤差是常數，PSD 圖上不會出現。
      </p>
    </ExperimentShell>
  )
}
