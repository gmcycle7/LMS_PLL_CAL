import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { createRng } from '@/simulation/core'
import { dtcBitsFor, dtcCompensationStats, dtcEffectiveSigmaV, dtcKqRatio, dtcLsbFs, dtcQuantizationJitterRms, dtcRangeBudget } from '@/simulation/models/dtc'
import { tx } from '../common'

const R = String.raw
export const DTC_RANGE_ID = 'gmac-dtc-range'
/** Monte Carlo 的 code 數（uniform x；量化誤差 RMS 的標準誤 ≈ σ_q/√(2n)） */
export const DTC_RANGE_MC_N = 50_000

export interface DtcRangeParams {
  /** VCO 週期 [ps] */
  tVcoPs: number
  /** gain 校正範圍 [%] */
  epsPct: number
  inlPeakFs: number
  headroomPct: number
  bits: number
  sigmaV: number
  /** 目前的 gain 相對真值 a = T_vco 的倍率（> 1 + ε 會開始飽和） */
  wRatio: number
}

export const DEFAULT_DTC_RANGE: DtcRangeParams = { tVcoPs: 62.5, epsPct: 20, inlPeakFs: 500, headroomPct: 5, bits: 10, sigmaV: 100, wRatio: 1 }

/** 解析部分（純函式；測試用）：預算、LSB、量化抖動、折損倍率 */
export function dtcRangeAnalytic(p: DtcRangeParams) {
  const tFs = p.tVcoPs * 1000
  const budget = dtcRangeBudget({ tVcoFs: tFs, calRangeFrac: p.epsPct / 100, inlPeakFs: p.inlPeakFs, headroomFrac: p.headroomPct / 100, bits: p.bits })
  const lsb = dtcLsbFs(budget.rangeFs, p.bits)
  return { tFs, budget, lsb, sigmaQ: dtcQuantizationJitterRms(lsb), sigmaEff: dtcEffectiveSigmaV(p.sigmaV, lsb), kqRatio: dtcKqRatio(p.sigmaV, lsb), bitsForSigmaV: dtcBitsFor(budget.rangeFs, p.sigmaV) }
}

/** Monte Carlo（純函式；測試用）：uniform x 的量化誤差 RMS、飽和比例 */
export function dtcRangeMonteCarlo(p: DtcRangeParams, seed: number, n = DTC_RANGE_MC_N) {
  const a = dtcRangeAnalytic(p)
  const xs = createRng(seed).fork('dtc-code').uniformArray(n)
  return dtcCompensationStats(xs, { w: p.wRatio * a.tFs, t0Fs: a.budget.t0Fs, lsbFs: a.lsb, bits: p.bits })
}

/** 飽和比例的解析值：uniform x ∈ [0,1)，想要的延遲 T_0 − w x < −Δ/2 時夾在 0 ⇒ x > (T_0 + Δ/2)/w */
export function dtcSaturationFractionAnalytic(p: DtcRangeParams): number {
  const a = dtcRangeAnalytic(p)
  const w = p.wRatio * a.tFs
  if (w <= 0) return 0
  const xSat = (a.budget.t0Fs + a.lsb / 2) / w
  return Math.max(0, Math.min(1, 1 - xSat))
}

export function DtcRangeExperiment() {
  const [p, setP] = useState<DtcRangeParams>(DEFAULT_DTC_RANGE)
  const [seed, setSeed] = useState(20261019)
  const tokens = useThemeTokens()
  const d = useDebouncedValue({ ...p, seed }, 200)
  const an = useMemo(() => dtcRangeAnalytic(d), [d])
  const mc = useMemo(() => dtcRangeMonteCarlo(d, d.seed), [d])
  const satAn = useMemo(() => dtcSaturationFractionAnalytic(d), [d])
  // σ_q 的 MC 估計的標準誤（Gaussian 近似：RMS 的 SE ≈ σ/√(2n)）；飽和比例是二項分布
  const seRms = an.sigmaQ / Math.sqrt(2 * DTC_RANGE_MC_N)
  const seSat = Math.sqrt((satAn * (1 - satAn)) / DTC_RANGE_MC_N)
  const rmsOk = mc.saturatedFraction === 0 ? Math.abs(mc.errorRmsFs - an.sigmaQ) <= 4 * seRms + 1e-9 : null
  const satOk = Math.abs(mc.saturatedFraction - satAn) <= 4 * seSat + 1 / DTC_RANGE_MC_N
  const analytic: CheckEntry =
    rmsOk === null
      ? { status: 'n/a', note: R`有飽和（${tx(100 * mc.saturatedFraction, 3)}\%）：量化誤差不再只是 $\pm\Delta/2$ 的均勻誤差，$\Delta/\sqrt{12}$ 不適用；飽和比例另與解析值比對（Monte Carlo 欄）` }
      : { status: rmsOk ? 'ok' : 'mismatch', note: R`Monte Carlo 的量化誤差 RMS $${tx(mc.errorRmsFs, 5)}$ fs vs $\Delta/\sqrt{12}=${tx(an.sigmaQ, 5)}$ fs（${DTC_RANGE_MC_N.toLocaleString()} 個 uniform code，容許 $4\,\mathrm{SE}=${tx(4 * seRms, 3)}$ fs）` }
  const monteCarlo: CheckEntry = { status: satOk ? 'ok' : 'mismatch', note: R`飽和比例：MC $${tx(100 * mc.saturatedFraction, 4)}\%$ vs 解析 $1-(T_0+\Delta/2)/w=${tx(100 * satAn, 4)}\%$（二項分布，容許 $4\,\mathrm{SE}=${tx(400 * seSat, 3)}\%$）` }
  const fixedPoint: CheckEntry = { status: 'n/a', note: '這個實驗量的就是量化本身（整數 code），沒有另一套「浮點 DTC」可以對照' }

  const metrics: MetricRow[] = [
    { name: R`延遲範圍 $R$`, value: an.budget.rangeFs, unit: 'fs', formulaId: 'F-04.20', claim: 'exact', digits: 6, note: R`$T_\mathrm{vco}(1+\varepsilon)+\mathrm{INL}_\mathrm{pk}+2h$` },
    { name: R`基準延遲 $T_0$（從最小延遲算）`, value: an.budget.t0Fs, unit: 'fs', formulaId: 'F-04.20', claim: 'exact', digits: 6 },
    { name: R`$\Delta=R/(2^B-1)$`, value: an.lsb, unit: 'fs', formulaId: 'F-04.19', claim: 'exact', digits: 5 },
    { name: R`量化抖動 $\sigma_q=\Delta/\sqrt{12}$`, value: an.sigmaQ, unit: 'fs', formulaId: 'F-04.19', claim: 'exact', digits: 5, analytic: mc.saturatedFraction === 0 ? mc.errorRmsFs : undefined, tolerance: 4 * seRms, note: mc.saturatedFraction === 0 ? R`analytic 欄是 Monte Carlo 量到的 RMS（$4\,\mathrm{SE}=${tx(4 * seRms, 3)}$ fs）` : '有飽和時 MC 的 RMS 含夾住的部分' },
    { name: R`$\sigma_{v,\mathrm{eff}}=\sqrt{\sigma_v^2+\Delta^2/12}$`, value: an.sigmaEff, unit: 'fs', formulaId: 'F-04.19', claim: 'exact', digits: 5 },
    { name: R`$K_{q,\mathrm{eff}}/K_q$`, value: an.kqRatio, formulaId: 'F-04.19', claim: 'exact', digits: 5, note: R`要讓折損 $<4\%$（$\Delta\le\sigma_v$）需要 $B_\mathrm{dtc}\ge${an.bitsForSigmaV}$ bits` },
    { name: R`飽和比例（$w=${tx(d.wRatio, 3)}\,a$）`, value: 100 * mc.saturatedFraction, unit: '%', formulaId: 'F-04.20', claim: 'exact', digits: 4, analytic: 100 * satAn, tolerance: 400 * seSat + 100 / DTC_RANGE_MC_N, note: R`uniform $x$：$x>(T_0+\Delta/2)/w$ 的那些拍夾在 code 0；飽和時 $\partial e/\partial w=0$，更新要 freeze` },
  ]

  // 圖：σ_q 與 K_q 折損倍率對位元數（封閉式曲線），目前的 B 用點標出
  const data = useMemo<Data[]>(() => {
    const bits = Array.from({ length: 13 }, (_, i) => i + 4)
    const lsbs = bits.map((b) => dtcLsbFs(an.budget.rangeFs, b))
    return [
      { x: bits, y: lsbs.map((l) => dtcQuantizationJitterRms(l)), type: 'scatter', mode: 'lines+markers', name: R`$\sigma_q=\Delta/\sqrt{12}$ (fs)`, line: { color: tokens.series[0] } },
      { x: bits, y: lsbs.map((l) => dtcKqRatio(d.sigmaV, l)), type: 'scatter', mode: 'lines+markers', name: R`$K_{q,\mathrm{eff}}/K_q$`, yaxis: 'y2', line: { color: tokens.series[1] } },
      { x: [d.bits], y: [an.sigmaQ], type: 'scatter', mode: 'markers', name: R`目前的 $B_\mathrm{dtc}$`, marker: { size: 12, color: tokens.series[2], symbol: 'diamond' } },
    ]
  }, [an.budget.rangeFs, an.sigmaQ, d.bits, d.sigmaV, tokens])

  return (
    <ExperimentShell
      id={DTC_RANGE_ID}
      title={R`DTC 位元數：LSB、量化抖動、$K_q$ 折損與飽和`}
      level="L5"
      claim="exact"
      description={R`把 §5b 的三條式子接成一個小實驗：由 $T_0$ 預算算出範圍 $R$，位元數決定 $\Delta$ 與 $\sigma_q$，再看 comparator 增益折損多少；把 $w$ 推到 $a(1+\varepsilon)$ 以上，看有多少拍的 code 會夾住。`}
      assumptions={[
        R`reference 端 DTC：$\tau=T_0-w\,x$，只能延遲、從 $T_0$ 往回扣（docs/assumptions.md §2a）`,
        R`量化誤差在一個 LSB 內均勻（code 由 uniform $x\in[0,1)$ 產生，$a=T_\mathrm{vco}$）；nearest 取整`,
        R`量化抖動與 comparator 雜訊獨立：$\sigma_{v,\mathrm{eff}}^2=\sigma_v^2+\Delta^2/12$`,
        '數字都是 illustrative（16 GHz 的 VCO 週期、300 ppm 級的範圍），不是任何晶片的量測',
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ tVcoPs: 'ps', epsPct: '%', inlPeakFs: 'fs', headroomPct: '%', bits: 'bits', sigmaV: 'fs', wRatio: '× a' }}
      metrics={metrics}
      warnings={mc.saturatedFraction > 0 ? [R`有 ${tx(100 * mc.saturatedFraction, 3)}\% 的拍 code 夾在 0：$w\,x$ 超過 $T_0$，這些拍 $\partial e/\partial w=0$，sign-LMS 的 $q\,x$ 更新沒有梯度可跟——RTL 要在飽和旗標為 1 時 freeze 更新（§5.5 的 anti-windup 同一件事）`] : []}
      crossCheck={{ analytic, monteCarlo, fixedPoint }}
      actions={{ onReset: () => setP(DEFAULT_DTC_RANGE) }}
      exportData={() => {
        const bits = Array.from({ length: 13 }, (_, i) => i + 4)
        const lsbs = bits.map((b) => dtcLsbFs(an.budget.rangeFs, b))
        return { bits, lsb_fs: lsbs, sigma_q_fs: lsbs.map((l) => dtcQuantizationJitterRms(l)), kq_ratio: lsbs.map((l) => dtcKqRatio(d.sigmaV, l)) }
      }}
      controls={
        <>
          <ParamControl label={R`$B_\mathrm{dtc}$（DTC code 位元數）`} ariaLabel="DTC code 位元數" value={p.bits} onChange={(bits) => setP({ ...p, bits })} min={4} max={16} integer clampOnBlur unit="bits" reg="DTC_CODE_WIDTH" />
          <ParamControl label={R`$T_\mathrm{vco}$`} ariaLabel="VCO 週期" value={p.tVcoPs} onChange={(tVcoPs) => setP({ ...p, tVcoPs })} min={10} max={500} step={0.5} unit="ps" hint="補償量最多一個 VCO 週期" />
          <ParamControl label={R`$\varepsilon$（gain 校正範圍）`} ariaLabel="gain 校正範圍" value={p.epsPct} onChange={(epsPct) => setP({ ...p, epsPct })} min={0} max={50} step={1} unit="%" />
          <ParamControl label={R`$\mathrm{INL}_\mathrm{pk}$`} ariaLabel="INL 最壞偏離" value={p.inlPeakFs} onChange={(inlPeakFs) => setP({ ...p, inlPeakFs })} min={0} max={5000} step={50} unit="fs" />
          <ParamControl label="headroom（兩端各留）" ariaLabel="headroom" value={p.headroomPct} onChange={(headroomPct) => setP({ ...p, headroomPct })} min={0} max={30} step={1} unit="%" />
          <ParamControl label={R`$\sigma_v$（不含量化）`} ariaLabel="comparator 雜訊" value={p.sigmaV} onChange={(sigmaV) => setP({ ...p, sigmaV })} min={1} max={1000} step={1} unit="fs" />
          <ParamControl label={R`$w/a$（目前 gain 相對真值）`} ariaLabel="目前 gain 相對真值的倍率" value={p.wRatio} onChange={(wRatio) => setP({ ...p, wRatio })} min={0} max={2} step={0.05} hint={R`超過 $1+\varepsilon$ 就開始有拍飽和`} />
        </>
      }
    >
      <Plot
        data={data}
        height={320}
        title={R`位元數 $B_\mathrm{dtc}$ 對 $\sigma_q$ 與 $K_q$ 折損（$R=${tx(an.budget.rangeFs, 5)}$ fs、$\sigma_v=${tx(d.sigmaV, 4)}$ fs）`}
        caption={R`每多 1 bit，$\Delta$ 與 $\sigma_q$ 減半；折損倍率 $\sigma_v/\sqrt{\sigma_v^2+\Delta^2/12}$ 在 $\Delta\approx\sigma_v$ 附近轉彎（再多的位元幾乎沒有幫助）。菱形是目前的位元數。`}
        layout={{
          xaxis: { title: { text: R`$B_\mathrm{dtc}$ (bits)` }, dtick: 1 },
          yaxis: { title: { text: R`$\sigma_q$ (fs)` }, rangemode: 'tozero' },
          yaxis2: { title: { text: R`$K_{q,\mathrm{eff}}/K_q$` }, overlaying: 'y', side: 'right', range: [0, 1.05] },
        }}
        csvName="ch04-dtc-range"
      />
    </ExperimentShell>
  )
}
