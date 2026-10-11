import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data, Shape } from 'plotly.js-dist-min'
import {
  Callout,
  ExperimentShell,
  ParamControl,
  Plot,
  Tex,
  ToggleControl,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import {
  calPhaseMarginDeg,
  cornerContraction,
  cornerInterval,
  gMaxForPm,
  gmacModel,
  loopGainK,
  measureCornerSlopes,
  msdAfterBlocks,
  slopeTruncationBias,
  type CornerSlopeResult,
} from '@/simulation/models/optimizer'
import { hLine, linspace, logspace, md, nf, tx, vBand, vLine, withAlpha } from '../shared'

export interface CornerRow {
  name: string
  /** 該 corner 的 comparator 雜訊 [fs] */
  sigmaV: number
  /** 該 corner 的誤差路徑相位 [deg] */
  thetaDeg: number
  /** 直接輸入模式的 K_i [fs⁻¹]（directK = true 時使用） */
  k?: number
}

export interface CornerParams {
  corners: CornerRow[]
  /** true：直接輸入每個 corner 的 K_i；false：由 σ_v,i 與 θ_i 計算 */
  directK: boolean
  /** 相對縮減比 ε（0 < ε < 1；勘誤 E16） */
  eps: number
  /** 更新次數 B */
  B: number
  pmTargetDeg: number
  /** RMS 檢查用：初始誤差 [fs] 與 N（σ_η² = 1/N） */
  delta0: number
  N: number
  /** RMS 目標 [fs] */
  rmsTarget: number
  /** 以 ±Δ 量測的 K̂ 取代模型 K */
  measure: boolean
  Delta: number
  M: number
  /** 保守裕度：K̂ ∓ z·se */
  z: number
}

export const CORNER_DEFAULTS: CornerParams = {
  corners: [
    { name: 'TT 25°C', sigmaV: 100, thetaDeg: 0 },
    { name: 'SS −40°C', sigmaV: 140, thetaDeg: 25 },
    { name: 'FF 125°C', sigmaV: 70, thetaDeg: 10 },
    { name: 'near-grid FCW', sigmaV: 100, thetaDeg: 55 },
  ],
  directK: false,
  eps: 0.01,
  B: 12,
  pmTargetDeg: 60,
  delta0: 3,
  N: 4096,
  rmsTarget: 1,
  measure: false,
  Delta: 20,
  M: 64,
  z: 2,
}

const MAX_CORNERS = 6
const BMIN_LAYOUT = { xaxis: { title: { text: String.raw`$r = K_{\min}/K_{\max}$` } }, yaxis: { title: { text: String.raw`$B_{\min}$` } } }
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

/**
 * 每個 corner 的等效（σ_v, θ）：直接輸入 K 時取 θ = 0（K < 0 時 θ = 180°）、σ_v = √(2/π)/|K|，
 * 讓 exact-binomial 斜率量測也能用同一個 corner 定義。
 */
export function effectiveCorner(c: CornerRow, directK: boolean): { name: string; sigmaV: number; thetaDeg: number } {
  if (!directK) return { name: c.name, sigmaV: c.sigmaV, thetaDeg: c.thetaDeg }
  const k = c.k ?? loopGainK(c.sigmaV, c.thetaDeg)
  if (k === 0) return { name: c.name, sigmaV: 100, thetaDeg: 90 }
  return { name: c.name, sigmaV: SQRT_2_OVER_PI / Math.abs(k), thetaDeg: k > 0 ? 0 : 180 }
}

export function CornerIntervalExperiment() {
  const tokens = useThemeTokens()
  const [params, setParams] = useState<CornerParams>(CORNER_DEFAULTS)
  const [seed, setSeed] = useState(20261016)
  const urlPreset = useUrlPreset('corner-interval')
  useEffect(() => {
    if (urlPreset) setParams({ ...CORNER_DEFAULTS, ...(urlPreset.params as Partial<CornerParams>) })
  }, [urlPreset])
  const set = <K extends keyof CornerParams>(k: K, v: CornerParams[K]) => setParams((p) => ({ ...p, [k]: v }))
  const setCorner = (i: number, patch: Partial<CornerRow>) => setParams((p) => ({ ...p, corners: p.corners.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const dp = useDeferredValue(params)

  const eff = useMemo(() => dp.corners.map((c) => effectiveCorner(c, dp.directK)), [dp.corners, dp.directK])
  const kLin = useMemo(() => eff.map((c) => loopGainK(c.sigmaV, c.thetaDeg)), [eff])
  const meas = useMemo<CornerSlopeResult | null>(
    () => (dp.measure ? measureCornerSlopes({ seed, N: dp.N, Delta: dp.Delta, M: dp.M, corners: eff }) : null),
    [dp.measure, dp.N, dp.Delta, dp.M, eff, seed],
  )
  // 區間所用的 K：模型值，或量測值 ∓ z·se（保守）
  const { kForMin, kForMax } = useMemo(
    () =>
      meas
        ? { kForMin: meas.kHat.map((k, i) => k - dp.z * meas.se[i]), kForMax: meas.kHat.map((k, i) => k + dp.z * meas.se[i]) }
        : { kForMin: kLin, kForMax: kLin },
    [meas, kLin, dp.z],
  )
  const res = useMemo(
    () => (kForMin.length ? cornerInterval([Math.min(...kForMin), Math.max(...kForMax)], dp.eps, dp.B, dp.pmTargetDeg) : cornerInterval([], dp.eps, dp.B)),
    [kForMin, kForMax, dp.eps, dp.B, dp.pmTargetDeg],
  )
  const muMid = res.ok && res.nonEmpty ? Math.sqrt(res.muLo * res.muHi) : NaN
  const s2 = 1 / dp.N

  const warnings: string[] = []
  if (!res.ok && res.reason) warnings.push(res.reason)
  if (res.ok && !res.nonEmpty) {
    warnings.push(
      String.raw`區間為空：最慢的 corner（$K_{\min}=${tx(res.kMin, 4)}\,\mathrm{fs^{-1}}$）要在 $B=${dp.B}$ 次內把平均誤差縮到 $\epsilon=${tx(dp.eps, 6)}$，需要 $\mu\ge${tx(res.muLo, 4)}\,\mathrm{fs}$；但 $PM\ge${dp.pmTargetDeg}^\circ$ 要求最快的 corner（$K_{\max}=${tx(res.kMax, 4)}\,\mathrm{fs^{-1}}$）$\mu\le${tx(res.muHi, 4)}\,\mathrm{fs}$。` +
        String.raw`非空需要 $B\ge\ln\epsilon/\ln(1-g_{\max}r)=${tx(res.bMinExact, 4)}$，取整數 $B_{\min}=${res.bMin}$（$r=K_{\min}/K_{\max}=${tx(res.ratio, 3)}$）。這不是「找更好的 $\mu$」能解決的：要延長 $B$、降低 $K$ 的散佈（量測 $\hat K$ 後每個 corner 用 $\mu_i=g/\hat K_i$）、放寬 $\epsilon$ 或 PM，或改用 coarse/fine 變動步長。`,
    )
  }
  if (meas && meas.kHat.some((k, i) => k <= dp.z * meas.se[i])) {
    const bad = dp.corners.filter((_, i) => meas.kHat[i] <= dp.z * meas.se[i]).map((c) => c.name)
    warnings.push(String.raw`$\lambda\approx0$／極性不確定：${bad.join('、')} 的量測 $\hat K\le z\cdot\mathrm{se}$（$\hat K$ 不顯著大於 0）：不可辨識或極性錯誤，不能用來設計 $\mu$（增加 $M$、$\Delta$，或修正極性）。`)
  }
  const rmsRows = res.ok && res.nonEmpty ? kLin.map((K) => Math.sqrt(msdAfterBlocks(dp.delta0, 1 - muMid * K, muMid, s2, dp.B))) : []
  const rmsFail = rmsRows.map((r, i) => ({ r, i })).filter(({ r }) => r > dp.rmsTarget)
  const rmsFailList = rmsFail.map(({ r, i }) => dp.corners[i].name + ' 的 RMS 為 ' + nf(r, 3) + ' fs').join('、')
  if (rmsFail.length > 0) {
    warnings.push(
      String.raw`RMS 目標 ${dp.rmsTarget} fs 在 $\mu=${tx(muMid, 4)}\,\mathrm{fs}$ 時無法達成：${rmsFailList}。§14.1 的區間只約束平均誤差；噪聲項 $\mu^2\sigma_\eta^2(1-p^{2B})/(1-p^2)$ 要另外檢查（F-14.3；勘誤 E16 補充）。`,
    )
  }

  const plotRange = useMemo(() => {
    const kmx = Math.max(...kLin.filter((k) => k > 0), 1e-9)
    const kmn = Math.min(...kLin.filter((k) => k > 0), kmx)
    return logspace(0.02 / kmx, 2.2 / kmn, 300)
  }, [kLin])
  const contraction = useMemo<Data[]>(
    () =>
      kLin.map((K, i) => ({
        x: plotRange,
        y: plotRange.map((mu) => {
          const v = cornerContraction(mu, K, dp.B)
          return Number.isFinite(v) && v > 0 && v < 1e6 ? v : null
        }),
        name: `${dp.corners[i].name}（$K = ${tx(K, 3)}$）`,
        line: { color: tokens.series[i % tokens.series.length] },
      })),
    [kLin, plotRange, dp.B, dp.corners, tokens],
  )
  const shapes = useMemo(() => {
    const s: Partial<Shape>[] = [hLine(dp.eps, tokens.text, 'dot')]
    if (res.ok) {
      if (res.nonEmpty) s.push(vBand(res.muLo, res.muHi, withAlpha(tokens.series[2], 1), 0.2))
      s.push(vLine(res.muLo, tokens.series[1], 'dash'), vLine(res.muHi, tokens.series[0], 'dash'))
      s.push(vBand(res.muHi, plotRange[plotRange.length - 1], withAlpha(tokens.danger, 1), 0.08))
    }
    return s
  }, [res, dp.eps, tokens, plotRange])

  // y 軸範圍（log10）：曲線在 μ = 1/K_i 掉到 0（deadbeat），交給 Plotly 自動範圍會一路伸到 10^-30 以下，把 ε 線附近壓成一條線；
  // 這裡只看 ε 下面三個 decade 到 10^1.5，掉到 0 的尖角會從下緣衝出去（圖說已寫明）。
  const contractionLayout = useMemo(
    () => ({
      shapes,
      xaxis: { title: { text: String.raw`$\mu$（fs，log）` } },
      yaxis: { title: { text: String.raw`$|E[\delta_B]/\delta_0|$` }, range: [Math.log10(dp.eps) - 3, 1.5] },
    }),
    [shapes, dp.eps],
  )
  const bminData = useMemo<Data[]>(() => {
    const rs = linspace(0.02, 1, 200)
    const g = gMaxForPm(dp.pmTargetDeg)
    const curve = rs.map((r) => (g * r >= 1 ? 1 : Math.log(dp.eps) / Math.log(1 - g * r)))
    const d: Data[] = [{ x: rs, y: curve, name: String.raw`$B_{\min}(r)$，$\epsilon = ${tx(dp.eps, 3)}$、$PM \ge ${tx(dp.pmTargetDeg, 3)}^\circ$`, line: { color: tokens.series[0], width: 2.4 } }]
    if (res.ok) d.push({ x: [res.ratio], y: [dp.B], name: String.raw`目前設計（$r = ${tx(res.ratio, 3)}$、$B = ${dp.B}$）`, mode: 'markers', marker: { size: 12, color: res.nonEmpty ? tokens.series[2] : tokens.danger, symbol: res.nonEmpty ? 'circle' : 'x' } })
    return d
  }, [dp.eps, dp.pmTargetDeg, dp.B, res, tokens])

  const analytic: CheckEntry = (() => {
    if (!res.ok) return { status: 'n/a', note: res.reason }
    // 兩個獨立判據必須一致：端點比較 μ_lo ≤ μ_hi 與 F-14.16 的 B ≥ B_min
    const consistent = res.nonEmpty === (dp.B >= res.bMin)
    if (!res.nonEmpty) {
      return consistent
        ? { status: 'ok', note: String.raw`空區間，且 $B=${dp.B}<B_{\min}=${res.bMin}$（端點比較與 F-14.16 兩個判據一致）` }
        : { status: 'mismatch', note: String.raw`端點比較說空、但 $B=${dp.B}\ge B_{\min}=${res.bMin}$：兩個判據不一致` }
    }
    if (!consistent) return { status: 'mismatch', note: String.raw`端點比較說非空、但 $B=${dp.B}<B_{\min}=${res.bMin}$：兩個判據不一致` }
    // 以「真實」模型 K_i（不是保守量測值）代回端點：量測裕度不足時會誠實顯示 mismatch
    const okAll = [res.muLo, res.muHi].every((mu) => kLin.every((K) => cornerContraction(mu, K, dp.B) <= dp.eps * (1 + 1e-9) && mu * K <= res.gMax * (1 + 1e-12)))
    return {
      status: okAll ? 'ok' : 'mismatch',
      note: okAll
        ? String.raw`$B\ge B_{\min}=${res.bMin}$；區間端點逐 corner 代回 $|1-\mu K_i|^B\le\epsilon$ 與 $\mu K_i\le g_{\max}$ 皆成立`
        : '以真實 $K_i$ 代回時有 corner 不滿足（量測裕度 $z$ 不足？）',
    }
  })()
  const mcCheck: CheckEntry = (() => {
    if (!meas) return { status: 'n/a', note: String.raw`開啟「以 $\pm\Delta$ 量測 $\hat K$」才會執行 exact-binomial 量測` }
    const bad = meas.kHat.filter((k, i) => Math.abs(k - meas.kMeanField[i]) > 4 * meas.se[i]).length
    return { status: bad === 0 ? 'ok' : 'mismatch', note: bad === 0 ? String.raw`$\hat K$ 與 mean-field 中央差分一致（4 se 內）` : `${bad} 個 corner 偏離超過 4 se` }
  })()

  const metrics: MetricRow[] = [
    { name: String.raw`$K_{\min}$／$K_{\max}$`, value: res.ok ? `${nf(res.kMin, 4)} / ${nf(res.kMax, 4)}` : null, unit: String.raw`$\mathrm{fs}^{-1}$` },
    { name: String.raw`$r=K_{\min}/K_{\max}$`, value: res.ok ? res.ratio : null },
    { name: String.raw`$\mu$ 下限 $(1-\epsilon^{1/B})/K_{\min}$`, value: res.ok ? res.muLo : null, unit: 'fs', formulaId: 'F-14.15', claim: 'exact' },
    { name: String.raw`$\mu$ 上限 $g_{\max}/K_{\max}$`, value: res.ok ? res.muHi : null, unit: 'fs', formulaId: 'F-14.15', claim: 'exact' },
    { name: '區間非空？', value: res.ok ? (res.nonEmpty ? '是' : '否（空）') : '輸入不合法' },
    { name: String.raw`$B_{\min}=\lceil\ln\epsilon/\ln(1-g_{\max}r)\rceil$`, value: res.ok ? res.bMin : null, formulaId: 'F-14.16', claim: 'exact', note: res.ok ? `實數解 ${nf(res.bMinExact, 5)}` : undefined },
    { name: String.raw`$g_{\max}$（PM 限制）`, value: res.gMax, formulaId: 'F-14.14' },
    { name: String.raw`建議 $\mu$（幾何中點 $\sqrt{\mu_{\min}\mu_{\max}}$）`, value: Number.isFinite(muMid) ? muMid : null, unit: 'fs' },
  ]

  const presets = presetsForExperiment('corner-interval').map((p) => ({ name: p.title, params: p.params, description: p.description }))
  const flatParams: Record<string, unknown> = { directK: params.directK, eps: params.eps, B: params.B, pmTargetDeg: params.pmTargetDeg, delta0: params.delta0, N: params.N, rmsTarget: params.rmsTarget, measure: params.measure, Delta: params.Delta, M: params.M, z: params.z }
  params.corners.forEach((c, i) => {
    // 參數摘要／JSON 匯出用的純文字（ASCII 欄位名，方便機器讀取）
    flatParams[`corner${i + 1}`] = params.directK ? `${c.name}: K=${c.k ?? loopGainK(c.sigmaV, c.thetaDeg)} 1/fs` : `${c.name}: sigma_v=${c.sigmaV} fs, theta=${c.thetaDeg} deg`
  })

  return (
    <ExperimentShell
      id="corner-interval"
      title="Corner-Based learning-rate 可行區間（勘誤 E16）"
      level="L1"
      claim="exact"
      source={meas ? 'simulation' : 'illustrative'}
      description={
        <>
          每個 corner 的 <Tex>{'K_i=K_q(\\sigma_{v,i})\\cos\\theta_i'}</Tex>；要求 <Tex>{'|E[\\delta_B]|\\le\\epsilon|\\delta_0|'}</Tex>（<Tex>{'\\epsilon'}</Tex> 為相對比例）且 <Tex>{'PM\\ge PM_t'}</Tex>。可選擇以 <Tex>{'\\pm\\Delta'}</Tex> 擾動「量測」<Tex>{'\\hat K_i'}</Tex>（第 10 課的 6 步流程）。
        </>
      }
      assumptions={[
        '理想一階、無額外更新延遲（$d=0$）的線性模型',
        String.raw`$\epsilon$ 為相對縮減比（勘誤 E16）`,
        '只約束平均誤差；RMS 以 F-14.3 另行檢查',
        String.raw`$x=\pm1$、$C_i=\cos\theta_i$、$\sigma_\eta^2=1/N$`,
      ]}
      params={flatParams}
      seed={seed}
      onSeedChange={setSeed}
      units={{ eps: '—（相對）', delta0: 'fs', rmsTarget: 'fs', Delta: 'fs', pmTargetDeg: 'deg' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic, monteCarlo: mcCheck, fixedPoint: { status: 'not-implemented', note: String.raw`$\mu$ 的定點量化未納入` } }}
      actions={{ onReset: () => setParams(CORNER_DEFAULTS) }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number | string | null>> = {
          corner: dp.corners.map((c) => c.name),
          sigma_v_fs: eff.map((c) => c.sigmaV),
          theta_deg: eff.map((c) => c.thetaDeg),
          K_per_fs: kLin,
          mu_grid_fs: plotRange,
        }
        kLin.forEach((K, i) => {
          cols[`contraction_${i + 1}`] = plotRange.map((mu) => cornerContraction(mu, K, dp.B))
        })
        if (meas) {
          cols.K_hat = meas.kHat
          cols.K_hat_se = meas.se
        }
        return cols
      }}
      presets={presets}
      onLoadPreset={(p) => setParams({ ...CORNER_DEFAULTS, ...(p.params as Partial<CornerParams>) })}
      controls={
        <div className="ch14-controls">
          <div className="ch14-group-title">{md(String.raw`Corners（$K_i=\sqrt{2/\pi}\,\cos\theta_i/\sigma_{v,i}$）`)}</div>
          <ToggleControl
            label={md(String.raw`直接輸入 $K_i$`)} ariaLabel="直接輸入 K_i"
            value={params.directK}
            onChange={(v) =>
              setParams((p) => ({ ...p, directK: v, corners: p.corners.map((c) => ({ ...c, k: c.k ?? loopGainK(c.sigmaV, c.thetaDeg) })) }))
            }
            hint={md(String.raw`關閉：由 $\sigma_{v,i}$ 與 $\theta_i$ 計算（物理參數）`)}
          />
          {params.corners.map((c, i) => (
            <div className="ch14-corner" key={i}>
              <div className="ch14-corner-head">
                <input type="text" aria-label={`corner ${i + 1} 名稱`} value={c.name} onChange={(e) => setCorner(i, { name: e.target.value })} />
                <span className="small muted">
                  <Tex>{`K_{${i + 1}}=${tx(params.directK ? (c.k ?? loopGainK(c.sigmaV, c.thetaDeg)) : loopGainK(c.sigmaV, c.thetaDeg), 4)}\\,\\mathrm{fs^{-1}}`}</Tex>
                </span>
                {params.corners.length > 1 && (
                  <button type="button" className="btn btn-icon" aria-label={`移除 ${c.name}`} onClick={() => set('corners', params.corners.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
              {params.directK ? (
                <ParamControl
                  label={md(String.raw`$K_i$`)} ariaLabel="K_i"
                  value={c.k ?? loopGainK(c.sigmaV, c.thetaDeg)}
                  onChange={(v) => setCorner(i, { k: v })}
                  min={-0.1}
                  max={0.1}
                  step={0.0001}
                  unit={String.raw`$\mathrm{fs}^{-1}$`}
                  digits={5}
                  reg={`corner ${i + 1}: 量測到的 GMAC 斜率（Jacobian）`}
                  hint={md(String.raw`$K_i\le0$ 代表極性錯誤`)}
                />
              ) : (
                <>
                  <ParamControl label={md(String.raw`$\sigma_v$`)} ariaLabel="σ_v" value={c.sigmaV} onChange={(v) => setCorner(i, { sigmaV: v })} min={1} max={1000} log unit="fs" reg={`corner ${i + 1}: pd_noise_rms_fs`} />
                  <ParamControl label={md(String.raw`$\theta$`)} ariaLabel="θ" value={c.thetaDeg} onChange={(v) => setCorner(i, { thetaDeg: v })} min={-180} max={180} step={1} unit="°" reg={`corner ${i + 1}: pll_error_path phase`} />
                </>
              )}
            </div>
          ))}
          {params.corners.length < MAX_CORNERS && (
            <div className="ch14-row-buttons">
              <button type="button" className="btn" onClick={() => set('corners', [...params.corners, { name: `corner ${params.corners.length + 1}`, sigmaV: 100, thetaDeg: 0 }])}>
                ＋ 新增 corner
              </button>
            </div>
          )}
          <div className="ch14-group-title">要求</div>
          <ParamControl label={md(String.raw`$\epsilon$（相對縮減比，$0<\epsilon<1$）`)} ariaLabel="ε（相對縮減比，0 < ε < 1）" value={params.eps} onChange={(v) => set('eps', v)} min={1e-9} max={0.999999} log reg="CAL_CONV_EPS（相對）" hint={md(String.raw`勘誤 E16：絕對規格 $e_\text{abs}$ 請換算 $\epsilon=e_\text{abs}/|\delta_0|$；$\epsilon\ge1$ 不合法`)} />
          <ParamControl label={md(String.raw`$B$（更新次數）`)} ariaLabel="B（更新次數）" value={params.B} onChange={(v) => set('B', v)} min={1} max={100000} log integer clampOnBlur reg="CAL_COARSE_BLOCKS" />
          <ParamControl label="PM 下限" value={params.pmTargetDeg} onChange={(v) => set('pmTargetDeg', v)} min={60} max={89} step={0.5} unit="°" reg="CAL_PM_TARGET（behavioral：迴路增益上限）" />
          <div className="ch14-group-title">RMS 檢查（E16 補充）</div>
          <ParamControl label={md(String.raw`$\delta_0$`)} ariaLabel="δ0" value={params.delta0} onChange={(v) => set('delta0', v)} min={0.001} max={100} log unit="fs" reg="gain_true 與 gain_initial 的差" />
          <ParamControl label={md(String.raw`$N$`)} ariaLabel="N" value={params.N} onChange={(v) => set('N', v)} min={16} max={262144} log integer clampOnBlur reg="REG_GMAC_N" />
          <ParamControl label="RMS 目標" value={params.rmsTarget} onChange={(v) => set('rmsTarget', v)} min={0.001} max={100} log unit="fs" reg="spec: residual RMS" />
          <div className="ch14-group-title">{md(String.raw`量測 $\hat K$（6 步流程）`)}</div>
          <ToggleControl label={md(String.raw`以 $\pm\Delta$ 量測 $\hat K$ 取代模型 $K$`)} ariaLabel="以 ±Δ 量測 K̂ 取代模型 K" value={params.measure} onChange={(v) => set('measure', v)} hint="exact-binomial Sign-GMAC，seed 決定" />
          {params.measure && (
            <>
              <ParamControl label={md(String.raw`$\Delta$（擾動）`)} ariaLabel="Δ（擾動）" value={params.Delta} onChange={(v) => set('Delta', v)} min={0.1} max={500} log unit="fs" reg="CAL_PROBE_DELTA" hint={md(String.raw`截斷偏差 $\approx-\Delta^2(c^2+3s^2)/(6\sigma_v^2)$（F-14.21；$\theta=0$ 時 $-(\Delta c)^2/(6\sigma_v^2)$）`)} />
              <ParamControl label={md(String.raw`$M$（每側 block 數）`)} ariaLabel="M（每側 block 數）" value={params.M} onChange={(v) => set('M', v)} min={1} max={4096} log integer clampOnBlur reg="CAL_PROBE_BLOCKS" />
              <ParamControl label={md(String.raw`$z$（保守裕度）`)} ariaLabel="z（保守裕度）" value={params.z} onChange={(v) => set('z', v)} min={0} max={6} step={0.1} reg="design margin（behavioral）" />
            </>
          )}
        </div>
      }
    >
      {res.ok && res.nonEmpty && (
        <Callout kind="ok" title="區間非空">
          <Tex>{`${tx(res.muLo, 5)}\\ \\mathrm{fs}\\le\\mu\\le${tx(res.muHi, 5)}\\ \\mathrm{fs}`}</Tex>（<Tex>{`B=${dp.B}\\ge B_{\\min}=${res.bMin}`}</Tex>）。
        </Callout>
      )}
      <Plot
        title={String.raw`每個 corner 的平均誤差縮減 $|1-\mu K_i|^B$`}
        data={contraction}
        xLog
        yLog
        height={320}
        csvName="ch14-corner-contraction"
        layout={contractionLayout}
        caption={md(String.raw`點線：$\epsilon$；綠帶：可行區間；藍虛線 $\mu_{\max}=g_{\max}/K_{\max}$（右側紅區 PM 不足）；紅虛線 $\mu_{\min}$（最慢 corner 剛好達到 $\epsilon$）。每條曲線在 $\mu=1/K_i$ 掉到 0（deadbeat）。`)}
      />
      <Plot
        title={String.raw`非空所需的最少更新次數 $B_{\min}$ vs $r=K_{\min}/K_{\max}$`}
        data={bminData}
        yLog
        height={280}
        csvName="ch14-corner-bmin"
        layout={BMIN_LAYOUT}
        caption={md(String.raw`曲線上方（$B\ge B_{\min}$）區間非空。$r\to0$（corner 散佈很大）時 $B_{\min}\approx\ln(1/\epsilon)/r$ 急遽上升。`)}
      />
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>corner</th>
              <th>{md(String.raw`$C_i=\cos\theta_i$`)}</th>
              <th>{md(String.raw`$K_i$ ($\mathrm{fs^{-1}}$)`)}</th>
              {meas && <th>{md(String.raw`$\hat K_i\pm\mathrm{se}$`)}</th>}
              {meas && <th>預測截斷偏差（F-14.21）</th>}
              <th>{md(String.raw`$|E[\delta_B]/\delta_0|$ 在 $\mu_\text{lo}$ / $\mu_\text{mid}$ / $\mu_\text{hi}$`)}</th>
              <th>{md(String.raw`RMS 在 $\mu_\text{mid}$ (fs)`)}</th>
              <th>{md(String.raw`PM 在 $\mu_\text{hi}$`)}</th>
            </tr>
          </thead>
          <tbody>
            {eff.map((c, i) => {
              const K = kLin[i]
              const cs = res.ok && res.nonEmpty ? [res.muLo, muMid, res.muHi].map((mu) => nf(cornerContraction(mu, K, dp.B), 3)) : ['—', '—', '—']
              return (
                <tr key={i} className={K <= 0 ? 'is-bad' : ''}>
                  <td>{c.name}</td>
                  <td className="num">{dp.directK ? md('—（直接輸入 $K_i$）') : nf(Math.cos((c.thetaDeg * Math.PI) / 180), 4)}</td>
                  <td className="num">{nf(K, 4)}</td>
                  {meas && (
                    <td className="num">
                      <Tex>{`${tx(meas.kHat[i], 4)}\\pm${tx(meas.se[i], 2)}`}</Tex>
                    </td>
                  )}
                  {meas && <td className="num">{K > 0 ? `${nf(100 * slopeTruncationBias(gmacModel(dp.N, c.sigmaV, c.thetaDeg), dp.Delta), 3)}%` : '—'}</td>}
                  <td className="num">{cs.join(' / ')}</td>
                  <td className="num">{rmsRows.length ? nf(rmsRows[i], 3) : '—'}</td>
                  <td className="num">{res.ok && res.nonEmpty && K > 0 ? `${nf(calPhaseMarginDeg(res.muHi * K), 3)}°` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </ExperimentShell>
  )
}
