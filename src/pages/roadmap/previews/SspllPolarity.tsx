import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  SelectControl,
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
  ChRef,
} from '@/components'
import modelSrc from '../model.ts?raw'
import {
  cAr1,
  cAr1BySum,
  closedLoopSummary,
  cTone,
  cWhite,
  cWhiteByIntegral,
  firstDiffKernelMin,
  firstDiffMarginTypeII,
  hpdReGrid,
  loopTransfer,
  pmuxKappa,
  pmuxSureBand,
  PMUX_W1,
  polarityScan,
  zetaWnFromKpKi,
  type LoopKind,
} from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-sspll-polarity'
const PATH = 'src/pages/roadmap/model.ts'

/** 分數累加器的解析度：α 取最近的 j/Q（與案例頁的 j/4096 sign map 同一個格點）。 */
export const ALPHA_Q = 4096

/**
 * 使用者的設計點（docs/analysis/sspll-gos-phos-polarity.md §0.4）：f_ref = 4 GHz、閉迴路 −3 dB = 320 MHz、延遲 1 個 reference cycle。
 * 這裡只借用「迴路參數」；頻寬、PM、反號帶、κ 都由本頁的 model.ts（共用 pll.ts）重新計算，不讀離線結果。
 */
export const USER_L1 = { KL: 0.388836 }
export const USER_L2 = { Kp: 0.287717, Ki: 0.0382535 }
const L2ZW = zetaWnFromKpKi(USER_L2.Kp, USER_L2.Ki)

interface SsParams {
  kind: LoopKind
  KL: number
  zeta: number
  wnTs: number
  d: number
  fRef: number
  alpha: number
  beta: number
}

const DEFAULTS: SsParams = { kind: 'type2', KL: USER_L1.KL, zeta: L2ZW.zeta, wnTs: L2ZW.wnTs, d: 0, fRef: 4e9, alpha: 0.021, beta: 0.9 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '使用者的設計 L2：Type-II SSPLL（BW 320 MHz、PM 60°），α = 0.021（PMUX 旋轉 84 MHz）', params: { ...DEFAULTS }, description: 'PHOS mode-1 反號最深的地方' },
  { name: '使用者的設計 L1：Type-I SSPLL（K_L = 0.388836、BW 320 MHz），α = 0.021', params: { ...DEFAULTS, kind: 'type1' }, description: '沒有 peaking ⇒ 沒有反號帶' },
  { name: 'L2，α = 0.137（PMUX 旋轉 548 MHz：帶外）', params: { ...DEFAULTS, alpha: 0.137 }, description: '兩組 LMS 都是正的' },
  { name: 'L2，near-grid α = 514/4096（β ≈ 0.004）', params: { ...DEFAULTS, alpha: 514 / ALPHA_Q }, description: 'GOS 的 dead zone：12C ≈ 12β²/K_i' },
  { name: 'Type-I，K_L = 0.4、額外延遲 d = 3：延遲讓低頻反號', params: { ...DEFAULTS, kind: 'type1', KL: 0.4, d: 3, alpha: 0.0025 } },
  { name: '一般 Type-II（ζ = 0.7、ω_nT_s = 0.1）加額外延遲 d = 2', params: { ...DEFAULTS, zeta: 0.7, wnTs: 0.1, d: 2, alpha: 0.0075 } },
]

/** sign map 的 α 格點：j 在 1…Q/2 − 1 之間對數分布（去掉重複）。 */
const J_GRID = Array.from(new Set(Array.from({ length: 96 }, (_, i) => Math.max(1, Math.round((ALPHA_Q / 2 - 1) ** (i / 95))))))

const mhz = (hz: number) => n4(hz / 1e6)

function SspllExperiment() {
  const [P, setP] = useState<SsParams>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const d = Math.max(0, Math.round(dP.d))
  const spec = useMemo(() => ({ kind: dP.kind, KL: dP.KL, zeta: dP.zeta, wnTs: dP.wnTs, d }), [dP.kind, dP.KL, dP.zeta, dP.wnTs, d])
  const lt = useMemo(() => loopTransfer(spec), [spec])
  const scan = useMemo(() => polarityScan(spec, dP.fRef, 1200), [spec, dP.fRef])
  const cls = useMemo(() => closedLoopSummary(lt, dP.fRef), [lt, dP.fRef])
  const H = lt.Hpd

  // FCW 小數 α → 分數累加器 j/Q；PMUX 每個 reference cycle 前進 8α 個相位，旋轉頻率 αf_ref
  const j = Math.min(ALPHA_Q / 2, Math.max(1, Math.round(dP.alpha * ALPHA_Q)))
  const alpha = j / ALPHA_Q
  const fRot = alpha * dP.fRef
  const beta8 = ((8 * j) % ALPHA_Q) / ALPHA_Q // GOS 鋸齒的基頻 β = frac(8α)
  const reGrid = useMemo(() => hpdReGrid(H, ALPHA_Q), [H])
  const pm = useMemo(() => pmuxKappa(H, j, ALPHA_Q, reGrid), [H, j, reGrid])
  const sure = useMemo(() => pmuxSureBand(H, dP.fRef), [H, dP.fRef])
  const sweep = useMemo(() => J_GRID.map((jj) => ({ f: (jj / ALPHA_Q) * dP.fRef, r: pmuxKappa(H, jj, ALPHA_Q, reGrid), re: reGrid[jj] })), [H, reGrid, dP.fRef])
  const reRot = 2 * cTone(H, 2 * Math.PI * alpha)
  const upper = PMUX_W1 * reRot + (1 - PMUX_W1) * sure.maxRe
  const lower = PMUX_W1 * reRot + (1 - PMUX_W1) * scan.minRe

  const c0 = cWhite(H)
  const c0i = useMemo(() => cWhiteByIntegral(H, 4096), [H])
  const cA = cAr1(H, dP.beta)
  const cAs = useMemo(() => (lt.stable ? cAr1BySum(H, dP.beta, 20000) : NaN), [H, dP.beta, lt.stable])
  const fd = useMemo(() => firstDiffKernelMin(H), [H])
  const fdMargin = firstDiffMarginTypeII(lt.Kp, lt.Ki)
  const edgeScan = scan.bands.length ? scan.bands[0][1] : NaN
  const gosConst = pm.twelveCGos === 0 && beta8 === 0
  const gosAsym = beta8 > 0 && beta8 <= 0.02 && d === 0 ? (dP.kind === 'type2' ? (12 * beta8 * beta8) / lt.Ki : (6 * beta8) / dP.KL) : undefined

  const warnings: string[] = []
  if (!lt.stable)
    warnings.push(
      String.raw`主迴路不穩定（closed-loop pole 半徑 ${n4(lt.spectralRadius)} $\ge1$）：先修 PLL 本身，LMS 的極性沒有意義。` +
        (dP.kind === 'type1' ? String.raw`Type-I 加延遲 $d$ 時需 $K_L<2\sin\frac{\pi}{4d+2}=${n4(2 * Math.sin(Math.PI / (4 * d + 2)))}$。` : ''),
    )
  warnings.push(...lt.warnings)
  if (lt.stable && pm.kappaPhos1 < 0)
    warnings.push(
      String.raw`PMUX 旋轉頻率 $\alpha f_{\mathrm{ref}}=${mhz(fRot)}$ MHz 落在反號帶內：PHOS mode-1 的 $\kappa_1=${n4(pm.kappaPhos1)}<0$，raw-x GMAC 以正 $\mu$ 更新會把 8 個相位 offset 推離真值（發散）。修法：改用一階差分 regressor、filtered-x、校準時改變迴路型態，或避開這個 $\alpha$（第 7 章與案例頁）。`,
    )
  if (lt.stable && !pm.circulant)
    warnings.push(String.raw`$\alpha=${j}/${ALPHA_Q}$ 化簡後的分母 $Q=${pm.Qred}$ 不是 8 的倍數：PMUX 只會走過一部分相位，PHOS 的平均更新矩陣不是 circulant，這裡的 $\kappa_1$ 只是 Rayleigh quotient，不保證是 eigenvalue 的實部（$8\mid Q$ 時它才是案例頁複數 $\kappa_1=8\lambda_1$ 的實部）。`)
  if (lt.stable && gosConst) warnings.push(String.raw`$\alpha=k/8$：DTC 細部殘差 $\rho[n]$ 是常數，GOS 沒有任何激發（$\lambda_{\min}=0$，gain 不可辨識）；GMAC 只會看到 offset。`)
  else if (lt.stable && pm.twelveCGos > 0 && pm.twelveCGos < 0.05)
    warnings.push(String.raw`near-grid（$\beta=\mathrm{frac}(8\alpha)=${n4(beta8)}$）：GOS 的 $12C=${n4(pm.twelveCGos)}$ 很小（dead zone）——方向仍然正確，但收斂極慢，線性化的 bias $B/C$ 也被放大（大到 comparator 飽和時 $a+B/C$ 不再是固定點，第 11 章 §11.4）。`)
  if (lt.stable && pm.twelveCGos < 0) warnings.push(String.raw`GOS 的 $12C=${n4(pm.twelveCGos)}<0$：這個迴路與 $\alpha$ 下 DTC gain 的 LMS 反號。離線掃描在 L1 / L2 / L3 沒有發現這種情況（研究假說，沒有證明），請保留參數並回報。`)
  if (dP.kind === 'type1' && lt.stable && dP.KL * (d + 0.5) > 1)
    warnings.push(String.raw`$K_L(d+\tfrac12)=${n4(dP.KL * (d + 0.5))}>1$：延遲讓 Type-I 迴路也在低頻反號（穩定且反號的窗口：$\frac{1}{d+1/2}<K_L<2\sin\frac{\pi}{4d+2}$）。`)

  const bandText = scan.bands.length ? scan.bands.map(([lo, hi]) => `${lo === 0 ? 'DC' : `${mhz(lo)} MHz`} – ${mhz(hi)} MHz`).join('；') : '無（整個頻帶都是正的）'
  const sureText = sure.band ? `${mhz(sure.band[0])} – ${mhz(sure.band[1])} MHz` : '無'
  const metrics: MetricRow[] = [
    { name: '主迴路 closed-loop pole 半徑', value: lt.spectralRadius, unit: '—', note: lt.stable ? '穩定' : '不穩定' },
    { name: dP.kind === 'type2' ? String.raw`$K_p$、$K_i$（每 sample）` : '$K_L$', value: dP.kind === 'type2' ? `${n4(lt.Kp)}、${n4(lt.Ki)}` : n4(dP.KL) },
    { name: String.raw`閉迴路 $-3$ dB 頻寬（$T=L/(1+L)$）`, value: cls.f3dB, unit: 'Hz', claim: 'exact' },
    { name: String.raw`phase margin（$|L|=1$ 處）`, value: cls.pmDeg, unit: 'deg' },
    { name: String.raw`$|T|$ peaking`, value: cls.peakDb, unit: 'dB', note: cls.peakDb < 1e-6 ? String.raw`沒有 peaking $\Rightarrow$ 不可能反號` : String.raw`在 ${mhz(cls.fPeak)} MHz` },
    { name: String.raw`反號帶 $\mathrm{Re}\{H_{\mathrm{PD}}\}<0$`, value: bandText, formulaId: 'F-SS.1', claim: 'exact' },
    ...(scan.closedFormEdge !== null
      ? [{ name: '反號帶上緣：掃描 + 二分法', value: edgeScan, unit: 'Hz', analytic: scan.closedFormEdge, tolerance: 1e-6, toleranceMode: 'rel' as const, formulaId: 'F-SS.3', claim: 'exact' as const, note: String.raw`封閉式 $\frac{f_{\mathrm{ref}}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}}$` }]
      : []),
    { name: String.raw`最負的 $\mathrm{Re}\{H_{\mathrm{PD}}\}$`, value: scan.minRe, unit: '—', note: `在 ${mhz(scan.fAtMin)} MHz` },
    { name: String.raw`恆等式 $\frac{1+\mathrm{Re}L}{|1+L|^2}$ vs 直接算 $\mathrm{Re}H_{\mathrm{PD}}$：最大差`, value: scan.identityMaxErr, analytic: 0, tolerance: 1e-12 },
    { name: String.raw`白色 code：$C=h_{\mathrm{PD}}[0]$`, value: c0, unit: '—', formulaId: 'F-SS.4', claim: 'exact' },
    { name: String.raw`白色 code：$\frac1\pi\int_0^\pi\mathrm{Re}H_{\mathrm{PD}}\,d\Omega$`, value: c0i, unit: '—', analytic: c0, tolerance: 1e-6 },
    { name: String.raw`AR(1) code（$\beta_x=${dP.beta}$）：$C=H_{\mathrm{PD}}(z)\big|_{z^{-1}=\beta_x}$`, value: cA, unit: '—', formulaId: 'F-SS.4', claim: 'exact' },
    { name: String.raw`AR(1)：$\sum_kh_{\mathrm{PD}}[k]\beta_x^k$（impulse response 累加）`, value: cAs, unit: '—', analytic: cA, tolerance: 1e-8, toleranceMode: 'rel' },
    { name: String.raw`PMUX 旋轉頻率 $\alpha f_{\mathrm{ref}}$（$\alpha=${j}/${ALPHA_Q}$）`, value: fRot, unit: 'Hz' },
    { name: String.raw`$\mathrm{Re}\{H_{\mathrm{PD}}\}$ 在旋轉頻率`, value: reRot, unit: '—' },
    { name: String.raw`PHOS mode-1：$\kappa_1$（一個週期的 DFT）`, value: pm.kappaPhos1, unit: '—', formulaId: 'F-SS.5', claim: 'exact', note: pm.kappaPhos1 < 0 ? String.raw`$<0\Rightarrow$ 正 $\mu$ 發散` : '極性正確' },
    { name: String.raw`基波近似 $W_1\mathrm{Re}\{H_{\mathrm{PD}}(\alpha f_{\mathrm{ref}})\}$，$W_1=${n4(PMUX_W1)}$`, value: PMUX_W1 * reRot, unit: '—', claim: 'approx', note: String.raw`其餘 $1-W_1\approx5\%$ 的功率散在 $(1+8k)\alpha f_{\mathrm{ref}}$` },
    { name: String.raw`mode-1「一定反號」帶（上界 $<0$）`, value: sureText, formulaId: 'F-SS.5', claim: 'exact', note: String.raw`門檻 $\mathrm{Re}H_{\mathrm{PD}}<${n4(sure.threshold)}$（$\max\mathrm{Re}H_{\mathrm{PD}}=${n4(sure.maxRe)}$）` },
    { name: String.raw`GOS：$12\,C_{\mathrm{GOS}}$（$H_{\mathrm{PD}}\equiv1$、不計 DC 時 $\approx1$），$\beta=${n4(beta8)}$`, value: pm.twelveCGos, unit: '—', claim: 'research', note: '離線掃描未發現負值，但沒有證明' },
    ...(gosAsym !== undefined
      ? [{ name: dP.kind === 'type2' ? String.raw`near-grid 漸近式 $12\beta^2/K_i$` : String.raw`near-grid 漸近式 $6\beta/K_L$`, value: gosAsym, unit: '—', claim: 'approx' as const, note: String.raw`案例頁的結果；$\beta\to0$ 時與上一列吻合` }]
      : []),
    { name: String.raw`一階差分 regressor：$\min_\Omega\mathrm{Re}\{H_{\mathrm{PD}}\overline{(1-e^{-j\Omega})}\}$`, value: fd.minRe, unit: '—', claim: 'exact', note: fd.minRe >= -1e-9 ? String.raw`$\ge0\Rightarrow$ 任何 $\alpha$ 都不反號（需 $D=0$ 對齊）` : String.raw`$<0$：這個迴路下一階差分也會反號` },
    ...(dP.kind === 'type2' && d === 0
      ? [{ name: String.raw`封閉式條件 $K_p-\tfrac{K_i}{2}$、$2-K_p-\tfrac{K_i}{2}$`, value: `${n4(fdMargin.atDc)}、${n4(fdMargin.atNyquist)}`, formulaId: 'F-SS.6', claim: 'exact' as const, note: fdMargin.nonInverting ? String.raw`兩者皆 $\ge0$：不反號` : '有一個為負：會反號' }]
      : []),
  ]

  // 上下界用的 max / min 來自有限格點，留一點數值餘裕
  const boundOk = !lt.stable || !pm.circulant || (pm.kappaPhos1 <= upper + 1e-6 && pm.kappaPhos1 >= lower - 1e-3)
  const fdOk = !(dP.kind === 'type2' && d === 0 && lt.stable) || fdMargin.nonInverting === fd.minRe >= -1e-9

  const yLo = Math.min(-0.3, scan.minRe * 1.2)
  const reData: Data[] = useMemo(
    () => [
      ...scan.bands.map(
        ([lo, hi], i) =>
          ({
            x: [Math.max(lo, scan.f[0]), hi, hi, Math.max(lo, scan.f[0]), Math.max(lo, scan.f[0])],
            y: [yLo, yLo, 2.2, 2.2, yLo],
            name: '反號帶 $\\mathrm{Re}\\,H_{\\mathrm{PD}} \\lt 0$',
            mode: 'lines',
            fill: 'toself',
            fillcolor: 'rgba(200, 60, 40, 0.14)',
            line: { width: 0 },
            hoverinfo: 'skip',
            showlegend: i === 0,
          }) as Data,
      ),
      { x: scan.f, y: scan.reH, name: '$\\mathrm{Re}\\,H_{\\mathrm{PD}}$（freqz）', mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: scan.f, y: scan.reHIdentity, name: '$(1 + \\mathrm{Re}\\,L)/|1 + L|^2$', mode: 'lines', line: { color: tokens.series[1], dash: 'dot' } },
      { x: scan.f, y: Array.from(scan.asym).map((v) => (Math.abs(v) <= 2.2 ? v : null)), name: '低頻漸近式', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } },
      { x: [scan.f[0], scan.f[scan.f.length - 1]], y: [sure.threshold, sure.threshold], name: 'mode-1「一定反號」門檻', mode: 'lines', line: { color: tokens.series[4], dash: 'dashdot', width: 1 } },
      { x: [fRot], y: [reRot], name: 'PMUX 旋轉頻率 $\\alpha f_{\\mathrm{ref}}$', mode: 'markers', marker: { size: 11, symbol: 'diamond', color: tokens.series[3] } },
    ],
    [scan, sure.threshold, fRot, reRot, tokens, yLo],
  )
  const bandShapes: Partial<Layout> = useMemo(
    () => ({
      shapes: [{ type: 'line' as const, xref: 'paper' as const, yref: 'y' as const, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }],
      xaxis: { title: { text: '$f$ [Hz]（PD 取樣率 $f_{\\mathrm{ref}}$）' } },
      yaxis: { title: { text: '$\\mathrm{Re}\\,H_{\\mathrm{PD}}$' }, range: [yLo, 2.2] },
    }),
    [tokens, yLo],
  )
  const mapData: Data[] = useMemo(
    () => [
      { x: sweep.map((s) => s.f), y: sweep.map((s) => s.r.kappaPhos1), name: 'PHOS mode-1：$\\kappa_1$（DFT，exact）', mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[0] } },
      { x: sweep.map((s) => s.f), y: sweep.map((s) => PMUX_W1 * s.re), name: '$W_1\\,\\mathrm{Re}\\,H_{\\mathrm{PD}}(\\alpha f_{\\mathrm{ref}})$（基波近似）', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: sweep.map((s) => s.f), y: sweep.map((s) => s.r.twelveCGos), name: 'GOS：$12C$', mode: 'lines+markers', marker: { size: 4, symbol: 'square' }, line: { color: tokens.series[2] } },
      { x: [fRot], y: [pm.kappaPhos1], name: '目前 $\\alpha$', mode: 'markers', marker: { size: 11, symbol: 'diamond', color: tokens.series[3] } },
    ],
    [sweep, fRot, pm.kappaPhos1, tokens],
  )
  const mapLayout: Partial<Layout> = useMemo(
    () => ({
      shapes: [{ type: 'line' as const, xref: 'paper' as const, yref: 'y' as const, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }],
      xaxis: { title: { text: '$\\alpha f_{\\mathrm{ref}}$ [Hz]（PMUX 旋轉頻率）' } },
      yaxis: { title: { text: '正規化斜率（$\\gt 0$：極性正確）' } },
    }),
    [tokens],
  )
  const rest = 1 - pm.lines.reduce((a, l) => a + l.weight, 0)
  const restContribution = pm.kappaPhos1 - pm.lines.reduce((a, l) => a + l.contribution, 0)

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`SSPLL 預覽：$\mathrm{Re}\{H_{\mathrm{PD}}\}$ 的反號帶與 8 相 PMUX / DTC regressor 的平均斜率`}
      level="L2"
      claim="exact"
      description={
        <>
          Type-II 用共用的 <code>designDtLoop</code>（pll.ts）：<Tex>{String.raw`L=\big(K_p+\tfrac{K_i}{1-z^{-1}}\big)\tfrac{z^{-(1+d)}}{1-z^{-1}}`}</Tex>；Type-I：<Tex>{String.raw`L=\frac{K_Lz^{-(1+d)}}{1-z^{-1}}`}</Tex>（<Tex>{'d=0'}</Tex> 即「延遲 1 個 reference cycle」）。
          FCW 小數 <Tex>{'\\alpha'}</Tex> 取最近的 <Tex>{`j/${ALPHA_Q}`}</Tex>。CPPLL（L3）不在本預覽內，見案例頁。
        </>
      }
      assumptions={[
        String.raw`線性化 DT 主迴路；PD 量的是（被 DTC 延遲後的）reference edge 減 feedback edge。DTC 在 reference 輸入端，它的殘差直接在 PD 的 reference 輸入注入；PMUX 在 feedback 路徑上，它的相位 offset 也折算到 PD 的 reference 輸入（兩側折算的符號差已併入校正係數的定義）。把折算後的外加誤差記作 $\phi_{\mathrm{in}}$、回授回來的相位記作 $\theta_{\mathrm{fb}}=L\,e_{\mathrm{PD}}$：$e_{\mathrm{PD}}=\phi_{\mathrm{in}}-\theta_{\mathrm{fb}}$，所以 $e_{\mathrm{PD}}=+H_{\mathrm{PD}}\,\phi_{\mathrm{in}}$，$H_{\mathrm{PD}}=1/(1+L)$（正號）`,
        String.raw`raw-x GMAC、相關器延遲 $D=0$：平均斜率 $=\sum(\text{線功率})\cdot\mathrm{Re}\{H_{\mathrm{PD}}\}$；小訊號（$|e_{\mathrm{PD}}|\ll\sigma_v$）、靜態 $w$、長時間平均`,
        String.raw`一階分數累加器：$\varphi[n]=\mathrm{frac}(n\alpha)$、$p[n]=\lfloor8\varphi[n]\rfloor$、$\rho[n]=8\varphi[n]-p[n]$；$\alpha=j/${ALPHA_Q}$ 時以一個週期的 DFT 精確計算`,
        '未含：CPPLL、大訊號（1-bit 飽和）、comparator offset、PMUX 相位間的振幅失配、時域 Monte Carlo——這些在案例頁與離線分析中，狀態為分析中',
      ]}
      params={{ ...P, d, alpha_grid: alpha }}
      units={{ fRef: 'Hz', wnTs: 'rad/sample', KL: '—', alpha: '—（FCW 小數）', beta: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: {
          status:
            scan.identityMaxErr < 1e-12 && Math.abs(c0i - c0) < 1e-6 && (scan.closedFormEdge === null || Math.abs(edgeScan / scan.closedFormEdge - 1) < 1e-6) && boundOk && fdOk ? 'ok' : 'mismatch',
          note: String.raw`恆等式、白色 code 的兩種算法、封閉式邊界、$\kappa_1$ 落在上下界內、一階差分的封閉式條件 vs 數值掃描`,
        },
        monteCarlo: { status: 'not-implemented', note: '時域 replica 與閉迴路 Sign-LMS 模擬只在離線分析（案例頁）' },
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({
        f_Hz: scan.f,
        re_Hpd: scan.reH,
        re_Hpd_identity: scan.reHIdentity,
        phase_deg: scan.phaseDeg,
        map_alpha_f_Hz: sweep.map((s) => s.f),
        map_kappa1_phos: sweep.map((s) => s.r.kappaPhos1),
        map_12C_gos: sweep.map((s) => s.r.twelveCGos),
      })}
      controls={
        <>
          <SelectControl
            label="迴路型態"
            value={P.kind}
            onChange={(kind) => setP({ ...P, kind })}
            options={[
              { value: 'type2', label: 'Type-II（P + I，SSPLL / DPLL）' },
              { value: 'type1', label: 'Type-I（單積分，SSPLL）' },
            ]}
            reg="PLL loop type"
          />
          {P.kind === 'type1' ? (
            <ParamControl {...pl('$K_L$（Type-I 迴路增益）', 'K_L（Type-I 迴路增益）')} value={P.KL} onChange={(v) => setP({ ...P, KL: v })} min={0.001} max={1.99} step={0.001} unit="—" reg="Loop gain（SSPD × KVCO / f_ref）" />
          ) : (
            <>
              <ParamControl {...pl(String.raw`$\zeta$`, 'zeta')} value={P.zeta} onChange={(v) => setP({ ...P, zeta: v })} min={0.2} max={3} step={0.0001} unit="—" reg="Loop filter：damping" hint={mt(String.raw`$K_p=2\zeta\omega_nT_s$`)} />
              <ParamControl {...pl(String.raw`$\omega_nT_s$`, 'omega_n T_s')} value={P.wnTs} onChange={(v) => setP({ ...P, wnTs: v })} min={0.001} max={0.6} log unit="rad/sample" reg="Loop bandwidth" hint={mt(String.raw`$K_i=(\omega_nT_s)^2$`)} />
            </>
          )}
          <ParamControl {...pl('$d$（額外 loop latency）', 'd（額外 loop latency）')} value={P.d} onChange={(v) => setP({ ...P, d: v })} min={0} max={8} integer clampOnBlur unit="samples" reg="Loop latency（PD → VCO，已含 1 拍）" />
          <ParamControl {...pl(String.raw`$f_{\mathrm{ref}}$（PD 取樣率）`, 'f_ref（PD 取樣率）')} value={P.fRef} onChange={(v) => setP({ ...P, fRef: v })} min={1e7} max={2e10} log unit="Hz" reg="f_ref" />
          <ParamControl
            {...pl(String.raw`$\alpha$（FCW 小數）`, 'alpha（FCW 小數）')}
            value={P.alpha}
            onChange={(v) => setP({ ...P, alpha: v })}
            min={1 / ALPHA_Q}
            max={0.5}
            log
            unit="—"
            reg="FCW 小數部分（分數累加器）"
            hint={mt(String.raw`PMUX 旋轉頻率 $=\alpha f_{\mathrm{ref}}$；DTC 鋸齒基頻 $\beta=\mathrm{frac}(8\alpha)$`)}
          />
          <ParamControl {...pl(String.raw`$\beta_x$（AR(1) code 係數）`, 'beta_x（AR(1) code 係數）')} value={P.beta} onChange={(v) => setP({ ...P, beta: v })} min={0} max={0.9999} step={0.0001} unit="—" reg="對照用：低通 code 的相關" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title={String.raw`$\mathrm{Re}\{H_{\mathrm{PD}}\}(f)$：紅底為反號帶，菱形為 PMUX 旋轉頻率`} data={reData} layout={bandShapes} xLog height={320} csvName="sspll-re-hpd" />
        <Plot
          title={String.raw`sign map：PHOS 的 $\kappa_1$ 與 GOS 的 $12C$ 隨 $\alpha f_{\mathrm{ref}}$ 變化`}
          data={mapData}
          layout={mapLayout}
          xLog
          height={320}
          csvName="sspll-sign-map"
          caption={String.raw`每個點是一個 $\alpha=j/${ALPHA_Q}$，用一個週期的 DFT 精確計算；虛線是只看基波的近似`}
        />
      </div>
      <div className="table-wrap">
        <table className="rm-ss-lines">
          <caption>{mt(String.raw`先算一次：mode-1 regressor 的譜線（$\alpha=${j}/${ALPHA_Q}$）各自貢獻多少 $\kappa_1$`)}</caption>
          <thead>
            <tr>
              <th>折到的頻率 [MHz]</th>
              <th>{mt('權重 $w_\\ell$')}</th>
              <th>{mt(String.raw`$\mathrm{Re}\{H_{\mathrm{PD}}\}$`)}</th>
              <th>貢獻</th>
            </tr>
          </thead>
          <tbody>
            {pm.lines.map((l, i) => (
              <tr key={i}>
                <td>{mhz(l.fNorm * dP.fRef)}</td>
                <td>{n4(l.weight)}</td>
                <td>{n4(l.reH)}</td>
                <td>{n4(l.contribution)}</td>
              </tr>
            ))}
            <tr>
              <td>其他</td>
              <td>{n4(rest)}</td>
              <td>—</td>
              <td>{n4(restContribution)}</td>
            </tr>
            <tr>
              <th scope="row">{mt('合計 $\\kappa_1$')}</th>
              <td>1</td>
              <td>—</td>
              <td>
                <strong>{n4(pm.kappaPhos1)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </ExperimentShell>
  )
}

export default function SspllPreview() {
  return (
    <div className="rm-preview">
      <Callout kind="warn" title="分析中（in analysis）——不是結論">
        8 相 PMUX 的 PHOS 與 input DTC 的 GOS 在 Type-I / Type-II SSPLL 與 CPPLL 下的完整極性分析（sign map、大訊號、comparator offset、對策比較）在
        {' '}<a href="#/case/sspll">案例頁：SSPLL 的 GOS / PHOS 極性</a>，資料來自 <code>analysis/sspll/</code> 的離線 Python golden 與時域模擬，尚未納入 T-id 驗收。
        這裡只放<strong>對任何迴路都成立</strong>的數學，以及用共用 <code>pll.ts</code> 能獨立重算的部分（L1 / L2、線性小訊號、{mt('$D=0$')}）。
      </Callout>
      <Prereq title="複數、共軛與頻率響應">
        <p>
          <Tex>{'z=a+jb'}</Tex> 的共軛 <Tex>{'\\bar z=a-jb'}</Tex>，<Tex>{'z\\bar z=|z|^2'}</Tex>，<Tex>{'\\mathrm{Re}\\,z=(z+\\bar z)/2'}</Tex>。
          離散系統的頻率響應是把 <Tex>{'z=e^{j\\Omega}'}</Tex> 代入轉移函數，<Tex>{'\\Omega=2\\pi f/f_{\\mathrm{ref}}'}</Tex>。<Tex>{'1/(e^{j\\Omega}-1)'}</Tex> 可以化簡成 <Tex>{'-\\tfrac12-\\tfrac j2\\cot\\tfrac\\Omega2'}</Tex>（分子分母同乘 <Tex>{'e^{-j\\Omega/2}'}</Tex>）。
          另一個常用的事實：<Tex>{'|e^{j\\theta}-1|=2\\sin(\\theta/2)'}</Tex>（單位圓上兩點的弦長）。
        </p>
      </Prereq>
      <Prereq title="Fourier 級數：把週期函數拆成等速旋轉的和">
        <p>
          週期為 1 的函數 <Tex>{'g(\\varphi)'}</Tex> 可以寫成 <Tex>{String.raw`g(\varphi)=\sum_\ell c_\ell\,e^{-j2\pi\ell\varphi}`}</Tex>，係數是 <Tex>{String.raw`c_\ell=\int_0^1g(\varphi)\,e^{+j2\pi\ell\varphi}\,d\varphi`}</Tex>
          （兩邊乘 <Tex>{'e^{+j2\\pi m\\varphi}'}</Tex> 再積分，只有 <Tex>{'\\ell=m'}</Tex> 那一項留下來）。Parseval 定理：<Tex>{String.raw`\int_0^1|g|^2d\varphi=\sum_\ell|c_\ell|^2`}</Tex>——
          總功率等於每條譜線功率的和。把 <Tex>{'\\varphi=n\\alpha'}</Tex> 代入，第 <Tex>{'\\ell'}</Tex> 條線就是頻率 <Tex>{'\\ell\\alpha f_{\\mathrm{ref}}'}</Tex> 的旋轉。
        </p>
      </Prereq>

      <StepDerivation
        title={mt(String.raw`一步一步推導（一）：什麼時候 $\mathrm{Re}\{H_{\mathrm{PD}}\}<0$`)}
        steps={[
          { tex: String.raw`H_{\mathrm{PD}}=\frac{1}{1+L}=\frac{\overline{1+L}}{(1+L)\overline{(1+L)}}=\frac{1+\bar L}{|1+L|^2}`, why: '分子分母同乘共軛，分母變成實數。' },
          { tex: String.raw`\mathrm{Re}\{H_{\mathrm{PD}}\}=\frac{1+\mathrm{Re}\{L\}}{|1+L|^2}`, why: <>取實部；分母恆正，所以符號只看 <Tex>{'1+\\mathrm{Re}\\{L\\}'}</Tex>。</> },
          { tex: String.raw`T=1-H_{\mathrm{PD}}\ \Rightarrow\ \mathrm{Re}\{H_{\mathrm{PD}}\}<0\iff\mathrm{Re}\{T\}>1\ \Rightarrow\ |T|>1`, why: <>反號帶一定在 jitter peaking（<Tex>{'|T|>1'}</Tex>）的頻帶內；沒有 peaking 的迴路不可能反號。</> },
          { tex: String.raw`\text{Type-I},\ d=0:\ L=\frac{K_L}{e^{j\Omega}-1}\Rightarrow\mathrm{Re}\{L\}=-\frac{K_L}{2}>-1`, why: <>用先備知識的化簡；穩定要求 <Tex>{'0<K_L<2'}</Tex>，所以永不反號。</> },
          { tex: String.raw`\text{Type-II},\ d=0:\ L=-\frac{K_i}{4\sin^2(\Omega/2)}-\frac{K_p}{2}-j\frac{K_p}{2}\cot\frac\Omega2`, why: <><Tex>{'z^{-1}/(1-z^{-1})^2=-1/(4\\sin^2(\\Omega/2))'}</Tex> 是負實數（雙積分器）。</> },
          { tex: String.raw`\mathrm{Re}\{L\}<-1\iff\sin^2\frac\Omega2<\frac{K_i}{2(2-K_p)}`, why: '移項整理。' },
        ]}
        result={String.raw`f_{\mathrm{inv}}=\frac{f_{\mathrm{ref}}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}}\qquad(\text{F-SS.1、F-SS.3})`}
      />
      <p>
        <ClaimTag kind="exact" /> Type-II 的反號帶從 DC 開始：{mt(String.raw`低頻時 $\mathrm{Re}\{H_{\mathrm{PD}}\}\approx-\Omega^2/K_i$，PD 看到的是誤差的「二次差分」，而任何訊號與自己的二次差分的相關都是負的。所以這個帶子只能變窄（降低 $K_i$），不能消除。`)}
      </p>

      <StepDerivation
        title={mt(String.raw`一步一步推導（二）：哪些 code 會真的反號（raw-x GMAC 的 $C$）`)}
        steps={[
          { tex: String.raw`C=E\Big[x[n]\sum_{k\ge0}h[k]\,x[n-k]\Big]=\sum_{k\ge0}h[k]\,R_x[k]`, why: <><ChRef ch="06">第 6 章</ChRef>：<Tex>{'u=h_{\\mathrm{PD}}*x'}</Tex>，期望值與加總交換。</> },
          { tex: String.raw`\text{白色 code }R_x[k]=\delta[k]:\quad C=h[0]=1`, why: <><Tex>{'L'}</Tex> 嚴格因果（至少延遲一拍），所以 <Tex>{'h_{\\mathrm{PD}}[0]=1'}</Tex>。</> },
          { tex: String.raw`\text{AR(1) code }R_x[k]=\beta_x^{|k|}:\quad C=\sum_{k\ge0}h[k]\beta_x^k=H_{\mathrm{PD}}(z)\big|_{z^{-1}=\beta_x}`, why: <>Z transform 的定義，只是把 <Tex>{'z^{-1}'}</Tex> 換成實數 <Tex>{'\\beta_x'}</Tex>。</> },
          { tex: String.raw`H_{\mathrm{PD}}=\frac{(1-z^{-1})^n}{\prod_i(1-p_iz^{-1})}\ \Rightarrow\ C=\frac{(1-\beta_x)^n}{\prod_i(1-p_i\beta_x)}>0`, why: <>分子 <Tex>{'(1-\\beta_x)^n>0'}</Tex>；分母中共軛 pole 成對給 <Tex>{'|1-p\\beta_x|^2>0'}</Tex>、實 pole <Tex>{'|p_i|<1'}</Tex> 給 <Tex>{'1-p_i\\beta_x>0'}</Tex>。</> },
          { tex: String.raw`\text{單頻 }x=A\cos\Omega_0n:\quad C=\frac{A^2}{2}\mathrm{Re}\{H_{\mathrm{PD}}(e^{j\Omega_0})\}`, why: <>只有這一個頻率的 <Tex>{'\\mathrm{Re}\\,H'}</Tex> 有作用（<ErratumNote eid="E46">{String.raw`$\Omega_0=0$、$\pi$ 時係數加倍`}</ErratumNote>）。</> },
        ]}
        result={String.raw`C_{\mathrm{white}}=1,\quad C_{\mathrm{AR(1)}}>0,\quad C_{\mathrm{tone}}<0\iff f_0\in\text{反號帶}\qquad(\text{F-SS.4})`}
      />
      <p>
        <ClaimTag kind="exact" /> 寬頻或低通（AR(1)）的 code 在 raw-x GMAC 下<strong>不會</strong>反號；要反號，code 的能量必須集中在反號帶內（窄頻、週期性）。8 相 PMUX 的 one-hot regressor 正好就是這種訊號。
        <ErratumNote eid="E44">CT 原型的相位不能直接套到 DT 迴路；本預覽全部在 DT 計算。</ErratumNote>
      </p>

      <StepDerivation
        title={mt(String.raw`一步一步推導（三）：8 相 PMUX 的 regressor 為什麼像單頻——$W_1$ 與「一定反號」帶`)}
        steps={[
          { tex: String.raw`\varphi[n]=\mathrm{frac}(n\alpha),\qquad p[n]=\lfloor8\varphi[n]\rfloor\in\{0,\dots,7\},\qquad s_1[n]=e^{-j2\pi p[n]/8}`, why: <>分數累加器每拍加 <Tex>{'\\alpha'}</Tex>；PMUX 選第 <Tex>{'p[n]'}</Tex> 相。8 個 one-hot 的平均更新矩陣是 circulant，特徵向量是 DFT mode；mode-1 就是「PMUX 轉一圈」（推導見案例頁）。</> },
          { tex: String.raw`g(\varphi)=e^{-j2\pi\lfloor8\varphi\rfloor/8}=\sum_\ell c_\ell\,e^{-j2\pi\ell\varphi}`, why: <><Tex>{'s_1[n]=g(\\varphi[n])'}</Tex>：<Tex>{'g'}</Tex> 是把等速旋轉 <Tex>{'e^{-j2\\pi\\varphi}'}</Tex> 切成 8 階的階梯版，展開成 Fourier 級數。</> },
          { tex: String.raw`c_1=\sum_{k=0}^{7}e^{-j2\pi k/8}\int_{k/8}^{(k+1)/8}e^{j2\pi\varphi}\,d\varphi=\sum_{k=0}^{7}\frac{e^{j\pi/4}-1}{j2\pi}=\frac{8\,(e^{j\pi/4}-1)}{j2\pi}`, why: <>每一階內 <Tex>{'g'}</Tex> 是常數；積分 <Tex>{String.raw`\int e^{j2\pi\varphi}d\varphi=e^{j2\pi\varphi}/(j2\pi)`}</Tex>，上下限相減後 <Tex>{'e^{j2\\pi k/8}'}</Tex> 與前面的 <Tex>{'e^{-j2\\pi k/8}'}</Tex> 相消，8 階都一樣。</> },
          { tex: String.raw`|c_1|^2=\frac{64\cdot4\sin^2(\pi/8)}{4\pi^2}=\frac{64\sin^2(\pi/8)}{\pi^2}=W_1\approx0.9496`, why: <>弦長 <Tex>{'|e^{j\\pi/4}-1|=2\\sin(\\pi/8)'}</Tex>。</> },
          { tex: String.raw`\sum_\ell|c_\ell|^2=\int_0^1|g|^2d\varphi=1,\qquad c_\ell\ne0\ \text{只在}\ \ell=1+8k`, why: <>Parseval（<Tex>{'|g|=1'}</Tex>）；又 <Tex>{'g(\\varphi+\\tfrac18)=e^{-j\\pi/4}g(\\varphi)'}</Tex>，所以只有 <Tex>{'\\ell\\equiv1\\pmod 8'}</Tex> 的線。其餘 <Tex>{'1-W_1\\approx5\\%'}</Tex> 散在 <Tex>{'-7,9,-15,17,\\dots'}</Tex> 倍頻。</> },
          { tex: String.raw`\kappa_1=\sum_{\ell}|c_\ell|^2\,\mathrm{Re}\{H_{\mathrm{PD}}(e^{j2\pi\ell\alpha})\}=W_1\,\mathrm{Re}\{H_{\mathrm{PD}}(e^{j2\pi\alpha})\}+\sum_{\ell\ne1}|c_\ell|^2\,\mathrm{Re}\{H_{\mathrm{PD}}(e^{j2\pi\ell\alpha})\}`, why: <>推導（二）對每條線各用一次：不同頻率的線平均後互不相關，所以功率加權相加。<Tex>{'\\kappa_1'}</Tex> 是正規化的平均斜率（<Tex>{'H_{\\mathrm{PD}}\\equiv1'}</Tex> 時為 1）；它是實數，也就是案例頁複數 <Tex>{'\\kappa_1=8\\lambda_1'}</Tex> 的實部 <Tex>{'\\mathrm{Re}\\,\\kappa_1'}</Tex>。</> },
          { tex: String.raw`\kappa_1\le W_1\,\mathrm{Re}\{H_{\mathrm{PD}}(\alpha f_{\mathrm{ref}})\}+(1-W_1)\max_f\mathrm{Re}\{H_{\mathrm{PD}}\}`, why: '其餘的線加起來只有 5% 的權重，每一項最多是全頻帶的最大值。' },
        ]}
        result={String.raw`\mathrm{Re}\{H_{\mathrm{PD}}(\alpha f_{\mathrm{ref}})\}<-\frac{1-W_1}{W_1}\max_f\mathrm{Re}\{H_{\mathrm{PD}}\}\ \Rightarrow\ \kappa_1<0\ (\text{PHOS mode-1 一定反號})\qquad(\text{F-SS.5})`}
      />
      <p>
        <ClaimTag kind="exact" /> {mt(String.raw`對無理數 $\alpha$，或 $\alpha=j/Q$ 且 $8\mid Q$ 成立；$8\nmid Q$ 時矩陣不是 circulant，只有數值證據。`)}
        <ClaimTag kind="research" /> {mt(String.raw`GOS 的 regressor 是鋸齒 $\rho[n]$，功率以 $1/m^2$ 分散在 $m\beta$ 的諧波上、折回後散布到全頻帶；離線掃描（L1 / L2 / L3、各 15 萬個有理 $\beta$）沒有發現 $C_{\mathrm{GOS}}<0$，但沒有證明。near-grid（$\beta\to0$）時 Type-II 只剩 $C\approx\beta^2/K_i$，是 dead zone。`)}
      </p>

      <SspllExperiment />
      <TryIt
        items={[
          String.raw`預設是使用者的 L2（BW 320 MHz、PM 60°）、$\alpha=0.021$：PMUX 以 84 MHz 旋轉，正好在反號最深的地方，$\kappa_1\approx-0.14$。把 $\alpha$ 拉到 0.137（548 MHz），$\kappa_1$ 變成正的。`,
          String.raw`載入「L1：Type-I」：同樣的頻寬，$|T|$ 沒有 peaking，整條 $\mathrm{Re}\{H_{\mathrm{PD}}\}>0$，sign map 上兩條曲線都在 0 以上。`,
          String.raw`載入「near-grid」：PHOS 沒事，但 GOS 的 $12C$ 掉到 $12\beta^2/K_i$ 的量級（dead zone）——方向對，卻幾乎學不動。`,
          String.raw`切到 Type-I、$d=3$：延遲讓 Type-I 也出現低頻反號帶；再把 $K_L$ 提高到 0.45 以上，主迴路本身就不穩定。`,
          String.raw`不管哪種迴路，把 $\beta_x$ 從 0 拉到 0.9999：AR(1) code 的 $C$ 一直是正的，只是越來越小（DC null）。`,
        ]}
      />
      <Observe>
        極性反轉需要兩個條件同時成立：迴路有 peaking（<Tex>{'\\mathrm{Re}\\,T>1'}</Tex> 的頻帶）＋ regressor 的能量集中在那個頻帶。PMUX 的旋轉頻率 <Tex>{'\\alpha f_{\\mathrm{ref}}'}</Tex> 由 FCW 決定，所以「哪些頻道會壞」可以事先算出來。
        修法要嘛改迴路（降低 peaking、校準時改成 Type-I），要嘛改 regressor（一階差分、filtered-x），見 <PageRef id="ch07">第 7 章</PageRef>與案例頁。
      </Observe>

      <StepDerivation
        title={mt(String.raw`一步一步推導（四）：一階差分 regressor $r[n]=x[n]-x[n-1]$ 為什麼不會反號`)}
        steps={[
          { tex: String.raw`\kappa=\sum(\text{線功率})\cdot\mathrm{Re}\{\Gamma\},\qquad \Gamma=H_{\mathrm{PD}}\,\overline{G},\quad G=1-z^{-1}`, why: <>GMAC 用 <Tex>{'r=g*x'}</Tex> 取代 <Tex>{'x'}</Tex> 時，每條線的 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 多乘上 <Tex>{'\\overline G'}</Tex>（相關運算的另一邊被濾過）。</> },
          { tex: String.raw`\text{Type-II},\ d=0:\ H_{\mathrm{PD}}=\frac{1}{1+L}\ \Rightarrow\ \Gamma=\frac{\overline{(1-z^{-1})}}{1+L}=\frac{|1-z^{-1}|^2}{(1-z^{-1})(1+L)}`, why: <>分子分母同乘 <Tex>{'(1-z^{-1})'}</Tex>；<Tex>{'|1-z^{-1}|^2=4\\sin^2(\\Omega/2)\\ge0'}</Tex>。</> },
          { tex: String.raw`\mathrm{sign}\,\mathrm{Re}\{\Gamma\}=\mathrm{sign}\,\mathrm{Re}\{(1-z^{-1})(1+L)\}`, why: <><Tex>{'\\mathrm{Re}(1/w)=\\mathrm{Re}(w)/|w|^2'}</Tex>：倒數不改變實部的符號。</> },
          { tex: String.raw`(1-z^{-1})(1+L)=(1-z^{-1})+K_pz^{-1}+\frac{K_iz^{-1}}{1-z^{-1}}`, why: <>代入 <Tex>{String.raw`L=(K_p+\tfrac{K_i}{1-z^{-1}})\tfrac{z^{-1}}{1-z^{-1}}`}</Tex> 展開。</> },
          { tex: String.raw`\mathrm{Re}\{\cdot\}=2\sin^2\tfrac\Omega2+K_p\cos\Omega-\tfrac{K_i}{2}=\Big(K_p-\frac{K_i}{2}\Big)+2\sin^2\tfrac\Omega2\,(1-K_p)`, why: <>三項的實部分別是 <Tex>{'1-\\cos\\Omega'}</Tex>、<Tex>{'K_p\\cos\\Omega'}</Tex>、<Tex>{'-K_i/2'}</Tex>（先備知識的化簡）；再用 <Tex>{'\\cos\\Omega=1-2\\sin^2(\\Omega/2)'}</Tex>。</> },
          { tex: String.raw`\sin^2\tfrac\Omega2\in[0,1]\ \text{的一次函數}\ \Rightarrow\ \text{只要檢查兩端}`, why: '一次函數的最小值在端點。' },
        ]}
        result={String.raw`K_i\le2K_p\ \ \text{且}\ \ K_p+\frac{K_i}{2}\le2\ \Longrightarrow\ \mathrm{Re}\{\Gamma(\Omega)\}\ge0\ \ \forall\,\Omega\qquad(\text{F-SS.6})`}
      />
      <p>
        <ClaimTag kind="exact" /> {mt(String.raw`kernel 處處非負，所以不管 regressor 的能量落在哪裡（任何 $\alpha$、PHOS 或 GOS）都不會反號；差分後的 regressor 沒有 DC，對 comparator offset 也免疫。硬性前提是 code 到 comparator 的延遲對齊（$D=0$）：差一拍這個結論就不成立。`)}
        <ClaimTag kind="research" /> 定點、PMUX 振幅失配與大訊號下的表現仍在分析中。
        <ErratumNote eid="E45">{String.raw`一般的 filtered-x 條件是 $\mathrm{Re}\{H\overline{\hat H}\}>0$；一階差分相當於用 $\hat H=1-z^{-1}$。`}</ErratumNote>
      </p>

      <h4>核心程式碼</h4>
      <CodeCompare
        items={[
          { label: '反號恆等式', source: modelSrc, region: 'reHpdIdentity', path: PATH, note: String.raw`符號只看 $1+\mathrm{Re}\,L$。` },
          { label: '三種 code 的相關', source: modelSrc, region: 'polarityC', path: PATH, note: '白色 / AR(1) / 單頻。' },
          { label: 'PMUX / DTC regressor', source: modelSrc, region: 'pmuxKappa', path: PATH, note: '標示的兩行：PHOS 用階梯化的旋轉、GOS 用鋸齒。' },
          { label: '「一定反號」帶', source: modelSrc, region: 'pmuxSureBand', path: PATH, note: String.raw`門檻 $-(1-W_1)\max\mathrm{Re}H/W_1$。` },
          { label: '一階差分 kernel', source: modelSrc, region: 'firstDiffKernel', path: PATH, note: '數值掃描與封閉式條件。' },
        ]}
        layout="tabs"
      />
      <ModeGate min="research">
        <h4>Research：還在分析的部分</h4>
        <ul>
          <li>
            {mt(String.raw`PHOS 的其他 mode（$m=2,3,4$）用 $\ell\equiv m\pmod 8$ 的線；$\alpha\approx\tfrac14$、$\tfrac12$ 附近有 alias 造成的 dead zone。共模（$m=0$）只有 DC 線，乘上 $H_{\mathrm{PD}}(1)=0$ 後完全不可見。`)}
            <ErratumNote eid="E04">gauge 由 1 維變 2 維。</ErratumNote>
          </li>
          <li>{mt(String.raw`大訊號（1-bit comparator 飽和）時平均斜率不再是 $\sum w\,\mathrm{Re}H$：near-grid 的 GOS 可能由正變負，comparator offset 也會把工作點推進大訊號區。`)}</li>
          <li>CPPLL（三階、impulse-invariant 映射）、P-only hold、PMUX 隨機旋轉與 keep-out 清單：見案例頁；本頁的 model.ts 沒有實作。</li>
        </ul>
      </ModeGate>
    </div>
  )
}
