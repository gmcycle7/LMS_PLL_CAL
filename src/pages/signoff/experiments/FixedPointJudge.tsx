import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type ExperimentPreset, type MetricRow } from '@/components'
import { useUrlPreset } from '@/app/presets'
import {
  accumulatorBitsRequired,
  dftMagnitudes,
  efbPeriod,
  efbSequence,
  errorPower,
  fixedPointPeriod,
  gcd,
  negateWorstCaseSum,
  saturateTwos,
  shiftScale,
  worstCaseSum,
  wrapTwos,
  type EfbRounding,
} from '../judges'
import { Verdict, nf, rich, tx, usePresetList } from '../shared'

export const FIXED_EXPERIMENT_ID = 'signoff-fixed-point'

export interface FixedParams {
  /** GMAC 輸入位元（含 sign） */
  Bx: number
  N: number
  /** 累加器位元 */
  Bacc: number
  overflow: 'wrap' | 'saturate'
  /** 以右移代替 /N 的位數 s */
  shift: number
  /** 目標（內部高解析度）gain code w_H [LSB] */
  target: number
  /** w_H 的小數位元 F（0 = 用精確十進位有理數） */
  F: number
  rounding: EfbRounding
}

export const FIXED_DEFAULT: FixedParams = { Bx: 6, N: 4096, Bacc: 17, overflow: 'wrap', shift: 12, target: 32.4, F: 0, rounding: 'round' }

const LOCAL_PRESETS: ExperimentPreset[] = [
  { name: '§17：6-bit × 4096、17-bit wrap（翻號）', params: { ...FIXED_DEFAULT } },
  { name: '同上改 saturate：不翻號但飽和', params: { ...FIXED_DEFAULT, overflow: 'saturate' } },
  { name: 'N = 3000 仍用 shift 12：μ 被縮放', params: { ...FIXED_DEFAULT, N: 3000, Bacc: 18 } },
  { name: 'w_H = 32.4、F = 10 bit：週期 512', params: { ...FIXED_DEFAULT, Bacc: 18, F: 10 } },
  { name: 'floor 量化：與 periodic toggle [32,32,33,32,33] 相同', params: { ...FIXED_DEFAULT, Bacc: 18, rounding: 'floor' } },
]

const SEQ_LAYOUT = { xaxis: { title: { text: '$k$（code 更新）' } }, yaxis: { title: { text: 'LSB' } } }
const SPEC_LAYOUT = { xaxis: { title: { text: '$f / f_u$' }, range: [0, 0.5] }, yaxis: { title: { text: '$|X_k|/T$ [LSB]' } } }

/** 把十進位目標轉成最簡分數 P/q（最多 6 位小數）。 */
export function decimalToFraction(x: number): { P: number; q: number } {
  let q = 1
  while (q < 1e6 && Math.abs(Math.round(x * q) - x * q) > 1e-9) q *= 10
  const P = Math.round(x * q)
  const g = gcd(P, q) || 1
  return { P: P / g, q: q / g }
}

export function FixedPointJudgeExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<FixedParams>(FIXED_DEFAULT)
  const presets = usePresetList(FIXED_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(FIXED_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setP({ ...FIXED_DEFAULT, ...(urlPreset.params as Partial<FixedParams>) })
  }, [urlPreset])
  const set = <K extends keyof FixedParams>(k: K, v: FixedParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDeferredValue(p)

  const Bx = Math.round(dp.Bx)
  const N = Math.round(dp.N)
  const Bacc = Math.round(dp.Bacc)
  const need = accumulatorBitsRequired(Bx, N)
  const wc = worstCaseSum(Bx, N)
  const regMax = wrapTwos(wc.max, Bacc)
  const regMin = wrapTwos(wc.min, Bacc)
  const satMax = saturateTwos(wc.max, Bacc)
  const flipMax = dp.overflow === 'wrap' && Math.sign(regMax) !== Math.sign(wc.max)
  const flipMin = dp.overflow === 'wrap' && Math.sign(regMin) !== Math.sign(wc.min)
  const scale = shiftScale(N, Math.round(dp.shift))
  // conditional negate 不飽和時的正端最壞情況：N 筆都是 q = −1、x = −2^{B_x−1}
  const negMax = negateWorstCaseSum(Bx, N)
  const negOverflow = negMax > 2 ** (Bacc - 1) - 1
  // Analytic 交叉比對（真的算）：封閉式位元數 B_x + ⌈log₂N⌉ 用 wrap 算術驗證——剛好這麼多 bit 時兩個最壞情況都不變，少 1 bit 時負端一定 wrap
  const bitsOk = wrapTwos(wc.max, need) === wc.max && wrapTwos(wc.min, need) === wc.min && (need < 2 || wrapTwos(wc.min, need - 1) !== wc.min)

  const efb = useMemo(() => {
    const frac = dp.F > 0 ? { P: Math.round(dp.target * 2 ** Math.round(dp.F)), q: 2 ** Math.round(dp.F) } : decimalToFraction(dp.target)
    const g = gcd(frac.P, frac.q) || 1
    const P = frac.P / g
    const q = frac.q / g
    const period = q <= 1 << 18 ? efbPeriod(P, q, dp.rounding) : NaN
    const show = Number.isFinite(period) ? Math.min(period, 1024) : 0
    const seq = Number.isFinite(period) ? efbSequence(P, q, Math.max(show, 1), dp.rounding).y : []
    const tgt = P / q
    const onePeriod = Number.isFinite(period) && period <= 1024 ? efbSequence(P, q, period, dp.rounding).y : []
    return {
      P,
      q,
      tgt,
      period,
      periodFormula: dp.F > 0 ? fixedPointPeriod(dp.target, Math.round(dp.F)) : q,
      seq,
      power: onePeriod.length ? errorPower(onePeriod, tgt) : NaN,
      spec: onePeriod.length ? dftMagnitudes(onePeriod.map((y) => y - tgt)) : [],
      levels: onePeriod.length ? Array.from(new Set(onePeriod)).sort((a, b) => a - b) : [],
    }
  }, [dp.target, dp.F, dp.rounding])

  const warnings: string[] = []
  if (Bacc < need)
    warnings.push(
      dp.overflow === 'wrap'
        ? `累加器 $B_\\text{acc}=${Bacc}$ bit 小於需要的 $B_x+\\lceil\\log_2N\\rceil=${need}$ bit：最壞情況總和 $${wc.max}$ 會 wrap 成 $${regMax}$${flipMax ? '（符號翻轉：正相關被讀成負，更新方向錯誤）' : ''}——§17「定點 overflow」反面測試。`
        : `累加器 $B_\\text{acc}=${Bacc}$ bit 小於需要的 $B_x+\\lceil\\log_2N\\rceil=${need}$ bit：saturate 讓最壞情況總和 $${wc.max}$ 被截在 $${satMax}$（不翻號，但 GMAC 失去比例性，大誤差時增益被壓縮）。`,
    )
  if (Bacc >= need && negOverflow)
    warnings.push(
      `邊界情況：$B_\\text{acc}=${Bacc}$ bit 對「有號 $B_x$-bit 的乘積」足夠，但若 conditional negate 不飽和，$q=-1$ 遇到 $x=-2^{B_x-1}$ 時每筆乘積是 $+2^{B_x-1}$，$N$ 筆全中的總和 $${negMax}$ 比可表示的最大值 $2^{B_\\text{acc}-1}-1=${2 ** (Bacc - 1) - 1}$ 多 ${negMax - (2 ** (Bacc - 1) - 1)} 個 count（wrap 後變成負的最大值）。請確認 RTL：code 範圍對稱、negate 有飽和，或再加 1 個 guard bit。`,
    )
  if (Math.abs(scale - 1) > 1e-12) warnings.push(`$N/2^s=${tx(scale, 6)}\\ne1$：用右移 $s=${Math.round(dp.shift)}$ 位代替 $/N$，有效 $\\mu$（以及迴路增益 $g$）被乘上 $${tx(scale, 6)}$（「$N$ 改變卻忘記 scaling」）。`)
  if (dp.target < 0 || dp.target > 63) warnings.push(`$w_H=${tx(dp.target, 8)}$ 超出 6-bit 範圍 $[0,63]$：quantizer overload，error-feedback 的殘差 $r[k]$ 會無界成長（勘誤 E15）。`)
  if (!Number.isFinite(efb.period)) warnings.push(`有理數分母 $q=${efb.q}$ 太大，不在此列舉週期（理論週期 $T_\\text{lc}=q$）。`)

  const seqPlot: Data[] = useMemo(
    () => [
      { x: efb.seq.map((_, i) => i), y: efb.seq, mode: 'lines+markers', line: { shape: 'hv', color: tokens.series[0] }, name: '6-bit 輸出 $y_Q[k]$' },
      { x: [0, Math.max(efb.seq.length - 1, 1)], y: [efb.tgt, efb.tgt], mode: 'lines', line: { dash: 'dash', color: tokens.series[1] }, name: `目標 ${nf(efb.tgt, 8)}` },
    ],
    [efb, tokens],
  )
  const specPlot: Data[] = useMemo(
    () => [{ x: efb.spec.map((_, k) => (efb.spec.length ? k / efb.spec.length : 0)), y: efb.spec, type: 'bar', name: '$|X_k|/T$（誤差 $y - c$ 的一個週期）', marker: { color: tokens.series[2] } }],
    [efb, tokens],
  )

  const metrics: MetricRow[] = [
    { name: String.raw`需要的累加器位元 $B_x+\lceil\log_2N\rceil$`, value: need, formulaId: 'F-SO.10', claim: 'exact' },
    { name: '最壞情況正總和（乘積為有號 $B_x$-bit）', value: wc.max, digits: 10 },
    { name: String.raw`negate 不飽和時的正端最壞情況 $N\,2^{B_x-1}$`, value: negMax, digits: 10, note: negOverflow ? String.raw`超過 $2^{B_\text{acc}-1}-1$：這個角落會溢位` : '仍可表示' },
    { name: `${Bacc}-bit ${dp.overflow === 'wrap' ? 'wrap' : 'saturate'} 後`, value: dp.overflow === 'wrap' ? regMax : satMax, digits: 10 },
    { name: 'shift scaling $N/2^s$', value: scale },
    { name: '量化目標的最簡分數 $c=P/q$', value: `${efb.P}/${efb.q}` },
    { name: 'EFB 週期（模擬偵測）', value: efb.period, analytic: efb.periodFormula, tolerance: 0, formulaId: 'F-SO.11', claim: 'exact', note: dp.F > 0 ? String.raw`公式 $T_\text{lc}=2^F/\gcd(K_F,2^F)$` : String.raw`公式 $T_\text{lc}=q$（最簡分母）` },
    { name: String.raw`一個週期的誤差功率 $\overline{(y-c)^2}$`, value: efb.power, unit: '$\\mathrm{LSB}^2$', claim: 'exact', note: `白雜訊一階 NTF 模型會預測 $2/12=${tx(2 / 12, 4)}\\,\\mathrm{LSB}^2$` },
  ]

  return (
    <ExperimentShell
      id={FIXED_EXPERIMENT_ID}
      title="Fixed-point 判斷器：累加器位元、shift scaling、EFB limit cycle"
      level="L5"
      claim="exact"
      source="illustrative"
      tests={['T16']}
      description={
        <>
          上半：GMAC 累加器在最壞情況輸入下會不會 wrap、右移代替 /N 的比例誤差。下半：常數目標 <Tex>{'w_H'}</Tex> 經一階 error-feedback quantizer（精確整數算術）的週期與譜線。
        </>
      }
      assumptions={[
        String.raw`被累加的每一筆 $q\,x$ 是有號 $B_x$-bit（含 sign）：最壞情況每筆都是 $+(2^{B_x-1}-1)$ 或 $-2^{B_x-1}$；conditional negate 不飽和時正端可到 $+2^{B_x-1}$（另列一項指標）`,
        String.raw`wrap：two’s complement 模 $2^{B_\text{acc}}$；saturate：截在 $[-2^{B_\text{acc}-1},\,2^{B_\text{acc}-1}-1]$`,
        String.raw`EFB：$v[k]=c+r[k-1]$，$y[k]=Q(v[k])$，$r[k]=v[k]-y[k]$；$Q$ 為 round-half-up 或 floor；$r[-1]=0$`,
        String.raw`$F=0$ 時把十進位目標視為精確有理數；$F>0$ 時先量化成 $F$ 個小數位元`,
      ]}
      params={{ ...p }}
      units={{ target: 'LSB' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: bitsOk ? 'ok' : 'mismatch', note: bitsOk ? String.raw`$B_x+\lceil\log_2N\rceil$ bit 時最壞情況不 wrap、少 1 bit 時負端 wrap（wrap 算術驗證）` : String.raw`封閉式位元數與 wrap 算術不一致` },
        monteCarlo: { status: 'n/a', note: '累加器位元、shift scaling 與 EFB 週期都是精確整數算術，沒有隨機量；dither 的統計見 Ch13' },
        fixedPoint: { status: Number.isFinite(efb.period) && efb.period === efb.periodFormula ? 'ok' : 'mismatch', note: '精確整數模擬的週期 vs 封閉式' },
      }}
      actions={{ onReset: () => setP(FIXED_DEFAULT) }}
      exportData={() => ({ k: efb.seq.map((_, i) => i), y_Q: efb.seq, dft_bin: efb.spec.map((_, k) => k), dft_mag_over_T: efb.spec })}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...FIXED_DEFAULT, ...(pr.params as Partial<FixedParams>) })}
      controls={
        <>
          <ParamControl label={rich('$B_x$（GMAC 輸入位元，含 sign）')} ariaLabel="B_x（GMAC 輸入位元，含 sign）" value={p.Bx} onChange={(v) => set('Bx', v)} min={1} max={16} integer clampOnBlur unit="bits" reg="RTL: code_width" />
          <ParamControl label={rich('$N$（累加長度）')} ariaLabel="N（累加長度）" value={p.N} onChange={(v) => set('N', v)} min={1} max={1_048_576} log integer reg="REG_GMAC_N" />
          <ParamControl label={rich(String.raw`$B_\text{acc}$（累加器位元）`)} ariaLabel="B_acc（累加器位元）" value={p.Bacc} onChange={(v) => set('Bacc', v)} min={2} max={48} integer clampOnBlur unit="bits" reg="RTL: gmac_acc_width" />
          <SelectControl
            label="overflow 行為"
            value={p.overflow}
            onChange={(v) => set('overflow', v)}
            options={[
              { value: 'wrap', label: 'wrap（two’s complement）' },
              { value: 'saturate', label: 'saturate' },
            ]}
            reg="RTL: acc_overflow_mode"
          />
          <ParamControl label={rich('$s$（右移位數，代替 $/N$）')} ariaLabel="s（右移位數，代替 /N）" value={p.shift} onChange={(v) => set('shift', v)} min={0} max={24} integer clampOnBlur unit="bits" reg="REG_GMAC_SHIFT" />
          <hr />
          <ParamControl label={rich('$w_H$（內部目標 code）')} ariaLabel="w_H（內部目標 code）" value={p.target} onChange={(v) => set('target', v)} min={-10} max={80} step={0.0001} unit="LSB" reg="behav: w_H" />
          <ParamControl label={rich('$F$（$w_H$ 的小數位元；0 代表精確十進位）')} ariaLabel="F（w_H 的小數位元；0 代表精確十進位）" value={p.F} onChange={(v) => set('F', v)} min={0} max={16} integer clampOnBlur unit="bits" reg="RTL: frac_bits" />
          <SelectControl
            label={rich('$Q_6$ 量化')}
            ariaLabel="Q₆ 量化"
            value={p.rounding}
            onChange={(v) => set('rounding', v)}
            options={[
              { value: 'round', label: 'round-half-up' },
              { value: 'floor', label: 'floor' },
            ]}
            reg="RTL: quantizer_mode"
          />
        </>
      }
    >
      <div className="so-kv">
        <div>
          <div className="k">累加器</div>
          <div className="v">
            {Bacc >= need ? (
              <Verdict kind="ok">
                足夠（<Tex>{`${Bacc}\\ge${need}`}</Tex>）
              </Verdict>
            ) : flipMax || flipMin ? (
              <Verdict kind="bad">wrap 翻號</Verdict>
            ) : (
              <Verdict kind="warn">不足</Verdict>
            )}
          </div>
        </div>
        <div>
          <div className="k">最壞總和範圍</div>
          <div className="v">
            <Tex>{`[${wc.min},\\ ${wc.max}]`}</Tex>
          </div>
        </div>
        <div>
          <div className="k">
            EFB 週期 <Tex>{'T_\\text{lc}'}</Tex>
          </div>
          <div className="v">{nf(efb.period, 8)}</div>
        </div>
        <div>
          <div className="k">輸出 code 階數</div>
          <div className="v">{efb.levels.join('、') || '—'}</div>
        </div>
      </div>
      <Plot title="EFB 輸出（前一個週期，最多 1024 點）" data={seqPlot} layout={SEQ_LAYOUT} height={260} csvName="signoff-efb-seq" />
      {efb.spec.length > 0 && efb.spec.length <= 1024 && (
        <Plot
          title={String.raw`一個週期的誤差頻譜 $|X_k|/T_\text{lc}$（橫軸 $k/T_\text{lc}$，單位 $f_u$）`}
          data={specPlot}
          layout={SPEC_LAYOUT}
          height={240}
          csvName="signoff-efb-spectrum"
        />
      )}
    </ExperimentShell>
  )
}
