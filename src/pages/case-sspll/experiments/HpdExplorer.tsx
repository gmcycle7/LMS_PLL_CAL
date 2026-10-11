import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, ToggleControl, mathText, useThemeTokens, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import {
  cppllFinv,
  hpdSweep,
  inversionBands,
  loopStable,
  loopSummary,
  lowFreqReHCoeff,
  makeL1,
  makeL2,
  makeL3,
  mode1SureBand,
  oneDiffMargin,
  typeIIFinv,
  typeILatencyCriterion,
  typeIPoleCriterion,
  type CppllMapping,
  type SspllLoop,
} from '@/simulation/models/sspll'
import { FREF_MHZ, HPD, HPD_GRID_MHZ, LOOPS, LOOP_LABEL, type LoopKey } from '../data'
import { fp, fx, loopTex, r } from '../common'

export const HPD_EXPERIMENT_ID = 'sspll-hpd'

export interface HpdParams {
  loop: LoopKey
  /** 閉迴路 |T| −3 dB 的設計目標 [MHz] */
  bwMHz: number
  /** 迴路延遲（拍）；L3 的延遲由取樣映射決定 */
  lat: number
  /** L1：寄生極點 [MHz]；0 = 無 */
  fPoleMHz: number
  /** L2：sampled-data PM 目標 [deg] */
  pm: number
  /** L2：直接指定 Kp、Ki（不做設計） */
  manual: boolean
  Kp: number
  Ki: number
  /** L3：連續時間 PM 的放置 [deg] */
  pmCt: number
  mapping: CppllMapping
  /** 設計後才乘上的 loop-gain 倍率（PVT） */
  gainScale: number
  showRemedy: boolean
}

export const HPD_DEFAULTS: HpdParams = {
  loop: 'L2',
  bwMHz: 320,
  lat: 1,
  fPoleMHz: 0,
  pm: 60,
  manual: false,
  Kp: Number(LOOPS.L2.params.Kp),
  Ki: Number(LOOPS.L2.params.Ki),
  pmCt: 60,
  mapping: 'impulse',
  gainScale: 1,
  showRemedy: true,
}

/** TS port 與 golden JSON（6 位有效數字）比對 Re H_PD 的容許誤差 */
const GOLDEN_TOL = 6e-6

const LOOP_KEYS_SET = new Set<string>(['L1', 'L2', 'L3'])
const MAPPINGS = new Set<string>(['impulse', 'halfT', 'zoh'])

/** 把 preset／URL 參數（unknown）合併成合法的 HpdParams；不合法的欄位維持原值 */
export function mergeHpdParams(prev: HpdParams, raw: unknown): HpdParams {
  if (!raw || typeof raw !== 'object') return prev
  const o = raw as Record<string, unknown>
  const next = { ...prev }
  const num = (k: keyof HpdParams, lo: number, hi: number) => {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) (next[k] as number) = v
  }
  if (typeof o.loop === 'string' && LOOP_KEYS_SET.has(o.loop)) next.loop = o.loop as LoopKey
  num('bwMHz', 50, 800)
  num('lat', 1, 6)
  next.lat = Math.round(next.lat)
  num('fPoleMHz', 0, 2000)
  num('pm', 30, 80)
  num('Kp', 1e-3, 1.9)
  num('Ki', 1e-5, 1)
  num('pmCt', 30, 75)
  num('gainScale', 0.3, 3)
  if (typeof o.manual === 'boolean') next.manual = o.manual
  if (typeof o.showRemedy === 'boolean') next.showRemedy = o.showRemedy
  if (typeof o.mapping === 'string' && MAPPINGS.has(o.mapping)) next.mapping = o.mapping as CppllMapping
  return next
}

/** 依參數建立迴路（設計失敗時丟出帶原因的 Error） */
export function buildHpdLoop(p: HpdParams): SspllLoop {
  const bwHz = p.bwMHz * 1e6
  if (p.loop === 'L1') {
    const fPoleHz = p.fPoleMHz > 0 ? p.fPoleMHz * 1e6 : null
    const base = makeL1({ lat: p.lat, fPoleHz, bwHz })
    return p.gainScale === 1 ? base : makeL1({ K: Number(base.params.K) * p.gainScale, lat: p.lat, fPoleHz })
  }
  if (p.loop === 'L2') {
    if (p.manual) return makeL2({ Kp: p.Kp, Ki: p.Ki, lat: p.lat, gainScale: p.gainScale })
    return makeL2({ pm: p.pm, lat: p.lat, bwHz, gainScale: p.gainScale })
  }
  return makeL3({ pmCt: p.pmCt, mapping: p.mapping, bwHz, gainScale: p.gainScale })
}

function isNominal(p: HpdParams): boolean {
  if (p.bwMHz !== 320 || p.gainScale !== 1) return false
  if (p.loop === 'L1') return p.lat === 1 && p.fPoleMHz === 0
  if (p.loop === 'L2') return p.lat === 1 && !p.manual && p.pm === 60
  return p.pmCt === 60 && p.mapping === 'impulse'
}

/** closed form 的帶緣 [MHz]；沒有 closed form 時回傳 null */
export function closedFormEdgeMHz(p: HpdParams, loop: SspllLoop): number | null {
  if (p.loop === 'L2' && p.lat === 1) {
    const Kp = Number(loop.params.Kp)
    const Ki = Number(loop.params.Ki)
    const x = Ki / (2 * (2 - Kp))
    return Kp < 2 && x > 0 && x < 1 ? typeIIFinv(Kp, Ki) * FREF_MHZ : null
  }
  if (p.loop === 'L3' && p.mapping === 'impulse') return cppllFinv(loop.params) * FREF_MHZ
  return null
}

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'L2 標稱（PM 60°、320 MHz）', params: { ...HPD_DEFAULTS } },
  { name: 'L3 CPPLL 標稱（impulse-invariant）', params: { ...HPD_DEFAULTS, loop: 'L3' } },
  { name: 'L2 PM 45°：反號帶更寬更深', params: { ...HPD_DEFAULTS, pm: 45 } },
  { name: 'L2 PM 75°：帶變窄，但仍從 DC 開始', params: { ...HPD_DEFAULTS, pm: 75 } },
  { name: 'L2 loop gain ×1.5（PVT，不重新設計）', params: { ...HPD_DEFAULTS, gainScale: 1.5 } },
  { name: 'L1 延遲 5 拍：Type-I 也出現反號帶', params: { ...HPD_DEFAULTS, loop: 'L1', lat: 5 } },
  { name: 'L1 + 200 MHz 寄生極點', params: { ...HPD_DEFAULTS, loop: 'L1', fPoleMHz: 200 } },
  { name: 'L3 ZOH 映射', params: { ...HPD_DEFAULTS, loop: 'L3', mapping: 'zoh' } },
]

/**
 * 實驗 'sspll-hpd'（L2）：H_PD = 1/(1 + L) 的 Re／|·|／∠ 對頻率，反號帶（Re H_PD < 0）與 closed form 帶緣。
 * 實線由 TS port（sspll.ts）即時計算；虛線是 golden 產生的 hpd_L*.json（標稱設計）。
 */
export function HpdExplorer() {
  const tokens = useThemeTokens()
  const [P, setP] = useState<HpdParams>(HPD_DEFAULTS)
  const set = (patch: Partial<HpdParams>) => setP((prev) => ({ ...prev, ...patch }))
  const dP = useDeferredValue(P)

  const urlPreset = useUrlPreset(HPD_EXPERIMENT_ID)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      setP((prev) => mergeHpdParams(prev, urlPreset.params))
    }
  }, [urlPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => [...presetsForExperiment(HPD_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), ...INLINE_PRESETS],
    [],
  )

  const built = useMemo((): { ok: true; loop: SspllLoop } | { ok: false; error: string } => {
    try {
      return { ok: true, loop: buildHpdLoop(dP) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [dP])
  const loop = built.ok ? built.loop : LOOPS[dP.loop]
  const golden = HPD[dP.loop]
  // JSON 的 f_MHz 只存 6 位有效數字；TS port 與 golden 的比較用未捨入的精確格點
  const grid = HPD_GRID_MHZ

  const an = useMemo(() => {
    const stable = loopStable(loop)
    const sw = hpdSweep(loop, grid, FREF_MHZ * 1e6, ['1diff'])
    const bands = inversionBands(loop)
    const sum = loopSummary(loop)
    const sure = mode1SureBand(loop)
    const margin = oneDiffMargin(loop)
    return { stable, sw, bands, sum, sure, margin }
  }, [loop, grid])

  const nominal = isNominal(dP) && built.ok
  const edgeScan = an.bands.length ? an.bands[0].fHi * FREF_MHZ : null
  const edgeClosed = built.ok ? closedFormEdgeMHz(dP, loop) : null
  const goldenMaxDiff = useMemo(() => {
    if (!nominal) return null
    let m = 0
    for (let i = 0; i < grid.length; i++) m = Math.max(m, Math.abs(an.sw.reH[i] - golden.ReH[i]))
    return m
  }, [nominal, an, golden, grid])

  // ── 警告（都要說明原因） ──
  const warnings: string[] = []
  if (!built.ok) warnings.push(`${built.error}。圖上暫時顯示標稱的 ${dP.loop}。`)
  if (built.ok && !an.stable)
    warnings.push(`主迴路不穩定（closed-loop pole 最大半徑 $${an.sum.maxPoleMag.toFixed(4)}\\ge1$）：先修 PLL 本身；此時談 LMS 的極性沒有意義。`)
  if (built.ok && an.stable && an.bands.length) {
    const b = an.bands[0]
    const sureTxt = an.sure.sure ? `；mode-1「一定反號」的 $\\alpha f_{ref}$：${fx(an.sure.sure[0] * FREF_MHZ, 1)}–${fx(an.sure.sure[1] * FREF_MHZ, 1)} MHz` : '（帶太淺，mode-1 沒有「一定反號」的區間）'
    warnings.push(
      `$\\mathrm{Re}\\,H_{PD}<0$ 於 ${b.fLo === 0 ? '0' : fx(b.fLo * FREF_MHZ, 2)}–${fx(b.fHi * FREF_MHZ, 2)} MHz（最低 ${fx(b.minReH, 4)} @ ${fx(b.fMin * FREF_MHZ, 1)} MHz）：raw regressor 的功率若集中在此帶（例如 PMUX 旋轉頻率 $\\alpha f_{ref}$ 落在帶內），sign-error LMS 的平均梯度反號${sureTxt}。`,
    )
  }

  if (built.ok && an.stable && an.margin.min < -1e-9)
    warnings.push(
      `一階差分的 margin $\\min_\\Omega g(\\Omega)=${an.margin.min.toFixed(4)}<0$（@ ${fx(an.margin.fAtMin * FREF_MHZ, 1)} MHz）：$\\mathrm{Re}\\,\\Gamma_{1d}=g(\\Omega)/\\lvert1+L\\rvert^2$ 在那附近為負，PSD 定理的保證不成立——這個迴路連 1diff regressor 也可能反號。原因是迴路延遲太長（Type-I 延遲 $d$ 拍時 $g=1-\\cos\\Omega+K\\cos(d\\Omega)$，$d\\ge2$ 就可能變負）或相位裕度太小；先把 PM 修好，或改用 filtered-x。`,
    )

  // ── 指標 ──
  const designName = dP.loop === 'L1' ? '設計參數 $K$' : dP.loop === 'L2' ? '設計參數 $(K_p,\\ K_i)$' : '設計參數 $(b,\\ \\omega_cT_{ref},\\ K)$'
  const designText =
    dP.loop === 'L1'
      ? fp(Number(loop.params.K), 6)
      : dP.loop === 'L2'
        ? `(${fp(Number(loop.params.Kp), 6)}, ${fp(Number(loop.params.Ki), 6)})`
        : `(${fp(Number(loop.params.b), 5)}, ${fp(Number(loop.params.wc), 6)}, ${fp(Number(loop.params.K), 5)})`
  const metrics: MetricRow[] = [
    { name: designName, value: designText },
    { name: '$\\lvert T\\rvert$ 的 $-3$ dB', value: an.sum.f3dBMHz, unit: 'MHz', digits: 7, ...(dP.gainScale === 1 && !dP.manual && built.ok ? { analytic: dP.bwMHz, tolerance: 1e-5, toleranceMode: 'abs' as const } : {}), note: dP.gainScale !== 1 || dP.manual ? '已不是設計目標（gain 被改動）' : '設計目標' },
    { name: 'phase margin（sampled-data）', value: Number.isFinite(an.sum.pmDeg) ? an.sum.pmDeg : null, unit: 'deg', digits: 5, note: Number.isFinite(an.sum.pmDeg) ? undefined : '找不到 $\\lvert L\\rvert=1$ 的交越（迴路增益太小或不穩定）' },
    { name: '$\\lvert T\\rvert$ peaking', value: Number.isFinite(an.sum.tPeakDb) ? an.sum.tPeakDb : null, unit: 'dB', digits: 4, note: '反號帶一定落在 $\\lvert T\\rvert>1$ 的 peaking 區內' },
    {
      name: '反號帶 $\\mathrm{Re}\\,H_{PD}<0$',
      value: an.bands.length ? an.bands.map((b) => `${b.fLo === 0 ? '0' : fx(b.fLo * FREF_MHZ, 2)}–${fx(b.fHi * FREF_MHZ, 3)} MHz`).join('；') : '無（整個頻帶的實部都不是負的）',
      formulaId: 'F-CS.4',
      claim: 'exact',
    },
  ]
  if (edgeScan !== null && edgeClosed !== null)
    metrics.push({
      name: '帶上緣：掃描 + 二分法',
      value: edgeScan,
      unit: 'MHz',
      digits: 8,
      analytic: edgeClosed,
      tolerance: 1e-6,
      toleranceMode: 'abs',
      formulaId: dP.loop === 'L2' ? 'F-CS.8' : 'F-CS.9',
      claim: 'exact',
      note: dP.loop === 'L2' ? 'closed form：$\\tfrac{f_{ref}}{\\pi}\\arcsin\\sqrt{K_i/(2(2-K_p))}$' : 'closed form：$-\\mathrm{Re}\\,L_3=1$ 的根',
    })
  else if (edgeScan !== null) metrics.push({ name: '帶上緣（掃描 + 二分法）', value: edgeScan, unit: 'MHz', digits: 8, note: '這個迴路沒有簡單的 closed form（延遲 $\\ne1$ 拍、寄生極點或非 impulse 映射）' })
  if (an.bands.length) metrics.push({ name: '最低的 $\\mathrm{Re}\\,H_{PD}$', value: an.bands[0].minReH, digits: 5, note: `在 ${fx(an.bands[0].fMin * FREF_MHZ, 1)} MHz` })
  if (dP.loop === 'L1') {
    const K = Number(loop.params.K)
    if (dP.fPoleMHz > 0 && dP.lat === 1)
      metrics.push({ name: 'Type-I 寄生極點判據 $K(\\tfrac12+\\tfrac{p}{1-p})$', value: typeIPoleCriterion(K, Number(loop.params.p)), digits: 4, formulaId: 'F-CS.10', claim: 'exact', note: '$>1\\iff$ 存在反號帶' })
    else if (dP.fPoleMHz === 0)
      metrics.push({ name: 'Type-I 延遲判據 $K(d-\\tfrac12)$', value: typeILatencyCriterion(K, dP.lat), digits: 4, formulaId: 'F-CS.10', claim: 'exact', note: '$>1\\iff$ 存在反號帶' })
  }
  metrics.push(
    {
      name: 'PHOS mode-1「一定反號」的 $\\alpha f_{ref}$',
      value: an.sure.sure ? `${fx(an.sure.sure[0] * FREF_MHZ, 1)}–${fx(an.sure.sure[1] * FREF_MHZ, 1)} MHz` : '無',
      formulaId: 'F-CS.14',
      claim: 'exact',
      note: an.sure.impossibleAbove > 0 ? `超過 ${fx(an.sure.impossibleAbove * FREF_MHZ, 1)} MHz 後 mode-1 不可能反號（TS port 以二分法求根；§8.2 的表列出 golden 的值）` : 'mode-1 在任何頻率都不可能反號',
    },
    { name: '一階差分的 margin $\\min_\\Omega g(\\Omega)$', value: an.margin.min, digits: 4, formulaId: 'F-CS.16', claim: 'exact', note: an.margin.min >= -1e-9 ? '$\\ge0$：1diff 對任何 $\\alpha$ 都安全（$g(\\Omega)=1-\\cos\\Omega+\\mathrm{Re}\\{(1-e^{-j\\Omega})L\\}$）' : '$<0$：1diff 不保證安全（見上方警告）' },
  )
  if (goldenMaxDiff !== null)
    metrics.push({ name: 'TS port 與 golden JSON 的 $\\max\\lvert\\Delta\\mathrm{Re}\\,H\\rvert$（1500 點）', value: goldenMaxDiff, analytic: 0, tolerance: GOLDEN_TOL, toleranceMode: 'abs', note: 'JSON 只存 6 位有效數字（$\\ge1$ 的值捨入誤差可達 $5\\times10^{-6}$）' })

  // ── 圖 ──
  const fLo = grid[0]
  const minRe = an.bands.length ? an.bands[0].minReH : 0
  const yLo = Math.min(-0.3, 1.25 * minRe)
  const reData: Data[] = useMemo(() => {
    const traces: Data[] = an.bands.map(
      (b, i) =>
        ({
          x: [Math.max(b.fLo * FREF_MHZ, fLo), b.fHi * FREF_MHZ, b.fHi * FREF_MHZ, Math.max(b.fLo * FREF_MHZ, fLo), Math.max(b.fLo * FREF_MHZ, fLo)],
          y: [yLo, yLo, 1.4, 1.4, yLo],
          name: '反號帶 $\\mathrm{Re}\\,H_{\\mathrm{PD}}<0$',
          mode: 'lines',
          fill: 'toself',
          fillcolor: 'rgba(200, 60, 40, 0.14)',
          line: { width: 0 },
          hoverinfo: 'skip',
          showlegend: i === 0,
        }) as Data,
    )
    traces.push({ x: grid, y: an.sw.reH, name: '$\\mathrm{Re}\\,H_{\\mathrm{PD}}$（TS port，即時）', mode: 'lines', line: { color: tokens.series[0], width: 2.2 } })
    traces.push({ x: grid, y: golden.ReH, name: `$\\mathrm{Re}\\,H_{\\mathrm{PD}}$（golden JSON，標稱 ${loopTex(dP.loop)}）`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dot', width: 1.6 } })
    // 低頻漸近式
    const asym: (number | null)[] = []
    let hasAsym = false
    for (let i = 0; i < grid.length; i++) {
      const W = (2 * Math.PI * grid[i]) / FREF_MHZ
      let v: number | null = null
      if (loop.type === 2) v = -W * W * lowFreqReHCoeff(loop)
      else if (dP.loop === 'L1' && dP.fPoleMHz === 0) {
        const K = Number(loop.params.K)
        v = ((W * W) / (K * K)) * (1 - K * (dP.lat - 0.5))
      }
      if (v !== null && Math.abs(v) <= 0.4) {
        asym.push(v)
        hasAsym = true
      } else asym.push(null)
    }
    if (hasAsym) traces.push({ x: grid, y: asym, name: loop.type === 2 ? (dP.loop === 'L3' ? '低頻漸近式 $-\\Omega^2/K_d$' : '低頻漸近式 $-\\Omega^2/K_i$') : '低頻漸近式 $(\\Omega^2/K^2)[1-K(d-\\tfrac12)]$', mode: 'lines', line: { color: tokens.series[3], dash: 'dash', width: 1.4 } })
    if (dP.showRemedy) traces.push({ x: grid, y: an.sw.reGamma['1diff'], name: '$\\mathrm{Re}\\,\\Gamma_{\\mathrm{eff}}$（一階差分 regressor）', mode: 'lines', line: { color: tokens.series[2], dash: 'dashdot', width: 1.6 } })
    // closed form 的帶緣：用 trace 畫垂直線（log 軸上 shape／annotation 的座標約定不同，trace 最不容易出錯）
    if (edgeClosed !== null)
      traces.push({ x: [edgeClosed, edgeClosed], y: [yLo, 1.4], name: `closed form 帶緣 ${edgeClosed.toFixed(2)} MHz`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash', width: 1.5 } })
    return traces
  }, [an, grid, golden, tokens, dP.loop, dP.fPoleMHz, dP.lat, dP.showRemedy, loop, fLo, yLo, edgeClosed])

  const reLayout: Partial<Layout> = useMemo(
    () => ({
      shapes: [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }],
      xaxis: { title: { text: '$f$ [MHz]（取樣率 $f_{\\mathrm{ref}}=4$ GHz；右端 $=f_{\\mathrm{ref}}/2$）' } },
      yaxis: { title: { text: '$\\mathrm{Re}\\,H_{\\mathrm{PD}}$、$\\mathrm{Re}\\,\\Gamma_{\\mathrm{eff}}$' }, range: [yLo, 1.4] },
    }),
    [tokens, yLo],
  )

  const magData: Data[] = useMemo(
    () => [
      { x: grid, y: an.sw.absH, name: '$|H_{\\mathrm{PD}}|$', mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: grid, y: an.sw.absT, name: '$|T|$（$-3$ dB = 設計頻寬）', mode: 'lines', line: { color: tokens.series[1], width: 2 } },
      { x: grid, y: golden.absH, name: `$|H_{\\mathrm{PD}}|$（golden JSON，標稱 ${loopTex(dP.loop)}）`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
      { x: [grid[0], grid[grid.length - 1]], y: [1, 1], name: '1（$|T|>1$ = peaking）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } },
      { x: [grid[0], grid[grid.length - 1]], y: [Math.SQRT1_2, Math.SQRT1_2], name: '$1/\\sqrt{2}$（$-3$ dB）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dashdot', width: 1 } },
    ],
    [an, grid, golden, tokens, dP.loop],
  )
  const phData: Data[] = useMemo(
    () => [
      { x: grid, y: an.sw.phaseDeg, name: '$\\angle H_{\\mathrm{PD}}$ [deg]（TS port，即時）', mode: 'lines', line: { color: tokens.series[4] ?? tokens.series[0], width: 2 } },
      { x: grid, y: golden.ReH.map((re, i) => (Math.atan2(golden.ImH[i], re) * 180) / Math.PI), name: `$\\angle H_{\\mathrm{PD}}$（golden JSON，標稱 ${loopTex(dP.loop)}）`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
      { x: [grid[0], grid[grid.length - 1]], y: [90, 90], name: '$\\pm90^\\circ$（$\\mathrm{Re}\\,H_{\\mathrm{PD}}=0$）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } },
      { x: [grid[0], grid[grid.length - 1]], y: [-90, -90], showlegend: false, mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } },
    ],
    [an, grid, tokens, golden, dP.loop],
  )

  const edgeOk = edgeScan !== null && edgeClosed !== null ? Math.abs(edgeScan - edgeClosed) < 1e-6 : null
  const goldenOk = goldenMaxDiff !== null ? goldenMaxDiff < GOLDEN_TOL : null
  const analyticStatus = edgeOk === false || goldenOk === false ? 'mismatch' : edgeOk === null && goldenOk === null ? 'n/a' : 'ok'

  return (
    <ExperimentShell
      id={HPD_EXPERIMENT_ID}
      title="實驗 A：$H_{PD}=1/(1+L)$ 的實部、大小與相位——反號帶在哪裡"
      level="L2"
      claim="exact"
      source="illustrative"
      description={
        <>
          實線由網站的 TS port（<code>sspll.ts</code>）依左側參數即時設計迴路並計算；點線是 golden（Python）輸出的 <code>hpd_{dP.loop}.json</code>（標稱設計）。紅底是{' '}
          {mathText('$\\mathrm{Re}\\,H_{PD}<0$')} 的頻帶，垂直虛線是 closed form 的帶緣。
        </>
      }
      assumptions={[
        '線性化的取樣資料迴路（每個 $T_{ref}$ 一拍）；$L(z)$ 嚴格 proper，所以 $h_{PD}[0]=1$',
        '誤差在相位比較點注入：$H_{PD}=1/(1+L)$；$\\lvert T\\rvert$ 的 −3 dB 為設計頻寬',
        'L2 的設計：$K_i=\\omega_n^2$、$K_p=2\\zeta\\omega_n$，$\\zeta$ 由 sampled-data PM、$\\omega_n$ 由頻寬解出；L3 的 $b=((1+\\sin PM)/\\cos PM)^2$',
        'loop-gain 倍率在設計之後才乘上（模擬 PVT，不重新設計）；分數延遲依模型而定，這裡只開放整數拍',
        '$f_{ref}=4$ GHz；所有例子為 illustrative，非晶片量測',
      ]}
      params={{ ...P }}
      units={{ bwMHz: 'MHz', fPoleMHz: 'MHz', pm: 'deg', pmCt: 'deg', lat: 'samples', gainScale: '×' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analyticStatus, note: 'closed form 帶緣 vs 掃描；標稱設計時另比對 golden JSON' },
        monteCarlo: 'n/a',
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setP(HPD_DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeHpdParams(prev, pr.params))}
      exportData={() => ({
        f_MHz: grid,
        re_Hpd: an.sw.reH,
        im_Hpd: an.sw.imH,
        abs_Hpd: an.sw.absH,
        phase_deg: an.sw.phaseDeg,
        abs_T: an.sw.absT,
        re_L: an.sw.reL,
        re_Gamma_1diff: an.sw.reGamma['1diff'],
        golden_re_Hpd: golden.ReH,
      })}
      controls={
        <>
          <SelectControl
            label="迴路"
            value={P.loop}
            onChange={(loop) => set({ loop })}
            options={(['L1', 'L2', 'L3'] as LoopKey[]).map((k) => ({ value: k, label: LOOP_LABEL[k] }))}
            reg="PLL 架構（SSPLL Type-I／Type-II／CPPLL）"
          />
          <ParamControl
            label={mathText('閉迴路 $\\lvert T\\rvert$ 的 −3 dB 頻寬')}
            ariaLabel="閉迴路 −3 dB 頻寬"
            value={P.bwMHz}
            onChange={(bwMHz) => set({ bwMHz })}
            min={50}
            max={800}
            step={1}
            unit="MHz"
            disabled={P.loop === 'L2' && P.manual}
            reg="Loop bandwidth（設計目標）"
            hint="使用者的晶片：320 MHz"
          />
          {P.loop !== 'L3' && (
            <ParamControl
              label={mathText('迴路延遲 $d$')}
              ariaLabel="迴路延遲 d"
              value={P.lat}
              onChange={(lat) => set({ lat })}
              min={1}
              max={6}
              integer
              clampOnBlur
              unit="samples"
              reg="SSPD 取樣 → VCO 控制生效的延遲"
              hint={mathText('$L\\propto z^{-d}$；本文的標稱是 1 拍')}
            />
          )}
          {P.loop === 'L1' && (
            <ParamControl label="寄生極點（0 = 無）" value={P.fPoleMHz} onChange={(fPoleMHz) => set({ fPoleMHz })} min={0} max={2000} step={10} unit="MHz" reg="Loop filter 寄生極點" hint={mathText('$p=e^{-2\\pi f_{pole}/f_{ref}}$')} />
          )}
          {P.loop === 'L2' && (
            <>
              <ToggleControl label={mathText('直接指定 $K_p$、$K_i$（不做設計）')} ariaLabel="直接指定 Kp、Ki" value={P.manual} onChange={(manual) => set({ manual })} />
              {P.manual ? (
                <>
                  <ParamControl label={mathText('$K_p$（比例增益／sample）')} ariaLabel="Kp" value={P.Kp} onChange={(Kp) => set({ Kp })} min={1e-3} max={1.9} log reg="SSCP gm·R × K_vco × SSPD 斜率" />
                  <ParamControl label={mathText('$K_i$（積分增益／sample）')} ariaLabel="Ki" value={P.Ki} onChange={(Ki) => set({ Ki })} min={1e-5} max={1} log reg="積分電容路徑" />
                </>
              ) : (
                <ParamControl label="phase margin 目標（sampled-data）" value={P.pm} onChange={(pm) => set({ pm })} min={30} max={80} step={0.5} unit="deg" reg="Loop filter：ζ" />
              )}
            </>
          )}
          {P.loop === 'L3' && (
            <>
              <ParamControl label={mathText('連續時間 PM 的放置（決定 $b=1+C_1/C_2$）')} ariaLabel="連續時間 PM 的放置" value={P.pmCt} onChange={(pmCt) => set({ pmCt })} min={30} max={75} step={0.5} unit="deg" reg="Loop filter：C1/C2" />
              <SelectControl
                label="取樣映射"
                value={P.mapping}
                onChange={(mapping) => set({ mapping })}
                options={[
                  { value: 'impulse', label: 'impulse：窄電荷包，下一拍比較（本文 L3）' },
                  { value: 'halfT', label: 'halfT：電荷包中心延後 T/2' },
                  { value: 'zoh', label: 'zoh：PD 輸出保持一整拍' },
                ]}
                reg="CP／SSPD 的取樣模型"
              />
            </>
          )}
          <ParamControl label="loop gain 倍率（PVT，不重新設計）" value={P.gainScale} onChange={(gainScale) => set({ gainScale })} min={0.3} max={3} step={0.05} unit={'$\\times$'} reg="K_vco × SSPD 斜率的 PVT 變化" />
          <ToggleControl label={mathText('疊上一階差分的 $\\mathrm{Re}\\,\\Gamma_{\\rm eff}$')} ariaLabel="疊上一階差分的 Re Γ_eff" value={P.showRemedy} onChange={(showRemedy) => set({ showRemedy })} />
        </>
      }
    >
      <Plot
        title="$\mathrm{Re}\,H_{PD}(f)$：紅底為反號帶"
        data={reData}
        layout={reLayout}
        xLog
        height={360}
        csvName="sspll-re-hpd"
        caption={r`負值代表 PD 看到的殘差與誤差「反相」；sign-error LMS 的符號由 regressor 功率對這條曲線的加權平均決定（不是 $\lvert H_{PD}\rvert$）。`}
      />
      <div className="cs-plots cs-plots-2">
        <Plot title="$\lvert H_{PD}\rvert$ 與 $\lvert T\rvert$" data={magData} xLog height={300} csvName="sspll-abs-hpd" layout={{ xaxis: { title: { text: '$f$ [MHz]' } }, yaxis: { title: { text: '大小（線性）' }, range: [0, 1.5] } }} />
        <Plot
          title="$\angle H_{PD}(f)$：$\lvert\angle\rvert>90^\circ\iff\mathrm{Re}\,H_{PD}<0$"
          data={phData}
          xLog
          height={300}
          csvName="sspll-phase-hpd"
          layout={{ xaxis: { title: { text: '$f$ [MHz]' } }, yaxis: { title: { text: 'deg' }, range: [-100, 190] } }}
        />
      </div>
    </ExperimentShell>
  )
}
