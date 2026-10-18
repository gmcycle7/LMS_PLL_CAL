import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, ToggleControl, mathText, plotMath, useThemeTokens, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import {
  analyseAlpha,
  blockMeanStable,
  kappaInfWorst,
  kappaRational,
  kernelMin,
  largeSignalPeriodic,
  limitDenominator,
  makeL1,
  type LoopModels,
  type SspllLoop,
} from '@/simulation/models/sspll'
import { FREF_MHZ, LOOPS, LOOP_LABEL, P_ONLY, PRED, REMEDY, SIM_CFG, mapIndex, type LoopKey, type SignMapJson } from '../data'
import { useSspllData } from '../lazyData'
import { DataPending, fp, fs, fx, tx, txs } from '../common'

export const SIGNMAP_EXPERIMENT_ID = 'sspll-signmap'

export type RegMode = 'raw' | 'ac' | '1diff' | 'fx' | 'fxTypeI' | 'D1' | '2diff' | 'ponly'

export const REG_MODE_LABEL: Record<RegMode, string> = {
  raw: 'raw：r[n] = x[n]',
  ac: 'ac：GOS 去掉平均 1/2（線性分析與 raw 相同）',
  '1diff': '一階差分：r[n] = x[n] − x[n−1]（推薦）',
  fx: 'filtered-x：Ĥ = H（exact 模型）',
  fxTypeI: 'filtered-x：Type-I 模型 K̂（可能失效）',
  D1: 'D = +1：相關器晚一拍（有害）',
  '2diff': '二階差分（有害）',
  ponly: 'P-only：校準時 hold 積分路徑（raw regressor）',
}

export interface SignParams {
  loop: LoopKey
  /** α·f_ref [MHz]（0 < f < f_ref） */
  fMHz: number
  mode: RegMode
  /** filtered-x 的 Type-I 模型增益 K̂ */
  kHat: number
  /** dead-zone 門檻 τ */
  tau: number
  /** 開迴路名義時間常數 N_τ [blocks]（H ≡ 1、κ = 1（8 相被選到的次數相同）時每個 block 誤差乘上 1 − 1/N_τ；有限步長判據） */
  nTau: number
  logX: boolean
}

export const SIGN_DEFAULTS: SignParams = { loop: 'L2', fMHz: 83.5, mode: 'raw', kHat: 0.1, tau: 1e-3, nTau: 25, logX: true }

const MODES = new Set<string>(Object.keys(REG_MODE_LABEL))

export function mergeSignParams(prev: SignParams, raw: unknown): SignParams {
  if (!raw || typeof raw !== 'object') return prev
  const o = raw as Record<string, unknown>
  const next = { ...prev }
  if (typeof o.loop === 'string' && ['L1', 'L2', 'L3'].includes(o.loop)) next.loop = o.loop as LoopKey
  if (typeof o.mode === 'string' && MODES.has(o.mode)) next.mode = o.mode as RegMode
  if (typeof o.fMHz === 'number' && o.fMHz > 0 && o.fMHz < FREF_MHZ) next.fMHz = o.fMHz
  else if (typeof o.alpha === 'number' && o.alpha > 0 && o.alpha < 1) next.fMHz = o.alpha * FREF_MHZ
  if (typeof o.kHat === 'number' && o.kHat >= 0.01 && o.kHat <= 1.5) next.kHat = o.kHat
  if (typeof o.tau === 'number' && (o.tau === 1e-3 || o.tau === 1e-2)) next.tau = o.tau
  if (typeof o.nTau === 'number' && o.nTau >= 1 && o.nTau <= 1000) next.nTau = o.nTau
  if (typeof o.logX === 'boolean') next.logX = o.logX
  return next
}

interface ModeSetup {
  loop: SspllLoop
  variant: string
  models?: LoopModels
  /** signmap JSON 的對應欄位（沒有預先計算時為 null） */
  colP: keyof SignMapJson | null
  colG: keyof SignMapJson | null
  colLS: keyof SignMapJson | null
  /** 大訊號計算用的變體 */
  lsVariant: string
}

/** regressor 模式 → 等效迴路、變體名稱與 signmap 欄位 */
export function modeSetup(loopKey: LoopKey, mode: RegMode, kHat: number): ModeSetup {
  const loop = LOOPS[loopKey]
  switch (mode) {
    case 'raw':
      return { loop, variant: 'raw', colP: 'kP', colG: 'kG', colLS: 'LSinf', lsVariant: 'raw' }
    case 'ac':
      return { loop, variant: 'ac', colP: 'kP', colG: 'kG', colLS: 'LSinf_ac', lsVariant: 'ac' }
    case '1diff':
      return { loop, variant: '1diff', colP: 'kP_1diff', colG: 'kG_1diff', colLS: null, lsVariant: '1diff' }
    case 'fx':
      return { loop, variant: 'fx:exact', models: { exact: loop }, colP: 'kP_fx', colG: 'kG_fx', colLS: null, lsVariant: 'fx:exact' }
    case 'fxTypeI':
      return { loop, variant: 'fx:typeI', models: { typeI: makeL1({ K: kHat }) }, colP: null, colG: null, colLS: null, lsVariant: 'fx:typeI' }
    case 'D1':
      return { loop, variant: 'D:1', colP: 'kP_D1', colG: 'kG_D1', colLS: null, lsVariant: 'D:1' }
    case '2diff':
      return { loop, variant: '2diff', colP: 'kP_2diff', colG: null, colLS: null, lsVariant: '2diff' }
    case 'ponly': {
      if (loopKey === 'L1') return { loop, variant: 'raw', colP: 'kP', colG: 'kG', colLS: 'LSinf_ac', lsVariant: 'ac' }
      return { loop: loopKey === 'L2' ? P_ONLY.L2 : P_ONLY.L3, variant: 'raw', colP: 'kP_Ponly', colG: 'kG_Ponly', colLS: 'LSinf_Ponly_ac', lsVariant: 'ac' }
    }
  }
}

/** 取出 signmap 的某一欄（該迴路沒有此欄時為 null，例如 L1 的 P-only 欄） */
function column(map: SignMapJson, key: keyof SignMapJson | null): number[] | null {
  if (!key) return null
  const v = map[key]
  return Array.isArray(v) ? (v as number[]) : null
}

export type SignClass = 'inverted' | 'dead' | 'restoring'

export function classify(kappa: number, tau: number): SignClass {
  return kappa < -tau ? 'inverted' : kappa > tau ? 'restoring' : 'dead'
}

/**
 * 「精確週期」GOS 列的註記：它和 ergodic 列是同一個 C_GOS，只差正規化——這一列除以這個週期實際的 var(ρ)（κ_GOS = C_GOS/var(ρ)），
 * ergodic 列乘固定的 12。β = a/b 時 var(ρ) = (b² − 1)/(12b²)，所以這一列是 ergodic 列的 b²/(b² − 1) 倍（正的倍數，符號相同）。
 */
export function gosExactNote(varRho: number, kG: number): string {
  return `$\\mathrm{var}(\\rho)=${tx(varRho, 6)}$（$\\beta$ 為無理數時是 $\\tfrac{1}{12}\\approx0.083333$）；同一個 $C_{GOS}$ 乘 12 是 $${tx(12 * kG * varRho, 5)}$，與 ergodic 那一列只差正的倍數 $\\tfrac{1}{12\\,\\mathrm{var}(\\rho)}=${tx(1 / (12 * varRho), 4)}$`
}

const CLASS_TEXT: Record<SignClass, string> = { inverted: '反號（不收斂）', dead: 'dead zone（幾乎沒有恢復力）', restoring: 'restoring（收斂）' }

export const HEAT_ROWS: { key: keyof SignMapJson; label: string }[] = [
  { key: 'LSinf_Ponly_ac', label: '大訊號 $\\kappa_\\infty$：P-only + ac' },
  { key: 'kP_Ponly', label: 'PHOS：P-only' },
  { key: 'kP_2diff', label: 'PHOS：2diff' },
  { key: 'kG_D1', label: 'GOS：$D=+1$' },
  { key: 'kP_D1', label: 'PHOS：$D=+1$' },
  { key: 'kP_fx', label: 'PHOS：filtered-x' },
  { key: 'kG_1diff', label: 'GOS：1diff' },
  { key: 'kP_1diff', label: 'PHOS：1diff' },
  { key: 'LSinf_ac', label: '大訊號 $\\kappa_\\infty$：ac' },
  { key: 'LSinf', label: '大訊號 $\\kappa_\\infty$：raw' },
  { key: 'km4_re', label: 'raw：mode 4' },
  { key: 'km3_re', label: 'raw：mode 3' },
  { key: 'km2_re', label: 'raw：mode 2' },
  { key: 'km1_re', label: 'raw：mode 1' },
  { key: 'kP', label: 'PHOS：raw（最差模態）' },
  { key: 'kG', label: 'GOS：raw' },
]

/** 熱圖有幾列（P-only 的兩欄只有 L2、L3 有）；資料還沒載入時用它預留圖的高度，載入完版面不跳動 */
export function heatRowCount(loop: LoopKey): number {
  return HEAT_ROWS.length - (loop === 'L1' ? 2 : 0)
}

const COL_NEG = '#c0392b'
const COL_DEAD = '#b9b9b9'
const COL_POS = '#2e86c1'

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'L2、α·f_ref = 83.5 MHz、raw：最差點', params: { loop: 'L2', fMHz: 83.5, mode: 'raw' } },
  { name: 'L2、α = 1/50（8 ∤ Q）：occupancy 不均、GOS–PHOS 有耦合', params: { loop: 'L2', fMHz: 80, mode: 'raw' } },
  { name: 'L2、α ≈ 1/4（988.5 MHz）：alias dead zone', params: { loop: 'L2', fMHz: 988.5, mode: 'raw' } },
  { name: 'L2、α ≈ 1/8 正下方（491.5 MHz）：GOS near-grid，大訊號反向', params: { loop: 'L2', fMHz: 491.5, mode: 'raw' } },
  { name: 'L2、帶外 548 MHz、D = +1：錯一拍就反號', params: { loop: 'L2', fMHz: 548, mode: 'D1' } },
  { name: 'L2、71.5 MHz、filtered-x 用 Type-I 模型 K̂ = 0.1：保證消失（Re Γ 有負值），但這個 α 仍為正', params: { loop: 'L2', fMHz: 71.5, mode: 'fxTypeI', kHat: 0.1 } },
  { name: 'L2、71.5 MHz、filtered-x 用 Type-I 模型 K̂ = 0.05：模型錯到 κ_PHOS < 0', params: { loop: 'L2', fMHz: 71.5, mode: 'fxTypeI', kHat: 0.05 } },
  { name: 'L2、帶緣 127 MHz：Re κ > 0 但有限步長不穩定', params: { loop: 'L2', fMHz: 127, mode: 'raw', nTau: 25 } },
]

/**
 * 實驗 'sspll-signmap'（L2／L3）：給定 α，PHOS 各 DFT 模態的 κ_m = 8λ_m 與 GOS 的 12·C_GOS（var(ρ) = 1/12 時等於 κ_GOS；TS port 的 ergodic 諧波和，
 * 有理數 α 另算精確週期解與大訊號 κ∞），並在 golden 預先算好的 sign map（signmap_L*.json）上標出目前的 α。
 */
export function SignMapExplorer() {
  const tokens = useThemeTokens()
  const [P, setP] = useState<SignParams>(SIGN_DEFAULTS)
  const set = (patch: Partial<SignParams>) => setP((prev) => ({ ...prev, ...patch }))
  const dP = useDeferredValue(P)

  const urlPreset = useUrlPreset(SIGNMAP_EXPERIMENT_ID)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      setP((prev) => mergeSignParams(prev, urlPreset.params))
    }
  }, [urlPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => [...presetsForExperiment(SIGNMAP_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), ...INLINE_PRESETS],
    [],
  )

  const alpha = dP.fMHz / FREF_MHZ
  const fFold = Math.min(dP.fMHz, FREF_MHZ - dP.fMHz)
  const setup = useMemo(() => modeSetup(dP.loop, dP.mode, dP.kHat), [dP.loop, dP.mode, dP.kHat])
  // golden 的 signmap_L*.json（約 300 KB）按需載入：還沒到時，TS port 的即時結果照常顯示，兩張 sign map 圖與「golden signmap」比對先留白
  const { data: map, status: mapStatus } = useSspllData('signmap', dP.loop, `exp-${SIGNMAP_EXPERIMENT_ID}`)

  // ergodic（無理數極限）諧波和：PHOS 各模態 + GOS
  const an = useMemo(() => analyseAlpha(setup.loop, alpha, setup.variant, setup.models), [setup, alpha])

  // 有理數 α：精確週期解（含 8 ∤ Q 的 occupancy 不均與 GOS–PHOS 耦合）與大訊號 κ∞
  const exact = useMemo(() => {
    const [Pn, Q] = limitDenominator(alpha, 8000)
    if (Q < 2 || Math.abs(Pn / Q - alpha) > 1e-12) return null
    const kr = kappaRational(setup.loop, Pn, Q, setup.variant, setup.models)
    const ls = largeSignalPeriodic(setup.loop, Pn, Q, SIM_CFG, setup.lsVariant, setup.models)
    return { P: Pn, Q, kr, ls, kInf: kappaInfWorst(ls) }
  }, [setup, alpha])

  // 這個 regressor 的 kernel 有沒有負的實部（PSD 定理的前提）：只在會失去保證的模式下需要
  const kern = useMemo(() => (dP.mode === 'fxTypeI' ? kernelMin(setup.loop, setup.variant, setup.models, 4001) : null), [dP.mode, setup])

  const iMap = mapIndex(dP.fMHz)
  const onGrid = map !== null && Math.abs(map.f_MHz[iMap] - fFold) < 1e-9
  const jsonP = map && onGrid ? (column(map, setup.colP)?.[iMap] ?? null) : null
  const jsonG = map && onGrid ? (column(map, setup.colG)?.[iMap] ?? null) : null
  const jsonLS = map && onGrid ? (column(map, setup.colLS)?.[iMap] ?? null) : null

  // 時域 sim（golden 存檔）：α 在 0.001 格點上、raw／1diff 才有
  const simRow = useMemo(() => {
    const a1000 = Math.min(alpha, 1 - alpha) * 1000
    const i = Math.round(a1000) - 1
    if (i < 0 || i >= PRED.fine.alpha.length || Math.abs(a1000 - Math.round(a1000)) > 1e-9) return null
    const f = PRED.fine[dP.loop]
    if (dP.mode === 'raw') return { sim: f.kP_sim[i], theory: f.kP_theory[i], lsSim5: f.LS_sim_A5ps[i] }
    if (dP.mode === '1diff') return { sim: f.kP_sim_1diff[i], theory: f.kP_theory_1diff[i], lsSim5: null }
    return null
  }, [alpha, dP.loop, dP.mode])

  const clsP = classify(an.kappaPhos, dP.tau)
  const clsG = an.beta === 0 ? 'dead' : classify(an.kappaGos, dP.tau)
  const worst = an.kappaM[an.worstMode - 1]
  const stepOk = blockMeanStable(an.kappaM, dP.nTau)

  // ── 警告 ──
  const warnings: string[] = []
  const fTxt = `$\\alpha f_{ref}=${fx(fFold, 2).replace('−', '-')}$ MHz`
  if (clsP === 'inverted')
    warnings.push(
      `PHOS 反號：mode ${an.worstMode}${an.worstMode !== 8 - an.worstMode ? `（與共軛的 mode ${8 - an.worstMode}）` : ' '}的 $\\mathrm{Re}\\,\\kappa=8\\,\\mathrm{Re}\\,\\lambda=${an.kappaPhos.toFixed(4)}<0$（${fTxt}）。這個模態的 regressor 功率主要落在 $\\mathrm{Re}\\,\\Gamma_{\\rm eff}<0$ 的頻率，平均梯度 $-\\mu K_qC\\delta$ 的方向相反，權重誤差沿該模態指數成長——減小 $\\mu$ 改不了符號。`,
    )
  else if (clsP === 'dead')
    warnings.push(`PHOS 落在 dead zone：$\\lvert\\kappa_{PHOS}\\rvert=${txs(Math.abs(an.kappaPhos), 3)}\\le\\tau$（${fTxt}）。恢復力幾乎為零，它的符號會隨 step response 的尾巴、$\\sigma_v$、探測幅度而變；實務上一律當作「不收斂、會漂移」。`)
  if (an.beta === 0) warnings.push('$\\beta=\\mathrm{frac}(8\\alpha)=0$（$\\alpha=k/8$）：$\\rho[n]\\equiv0$，DTC 細部 code 不動，GOS 不可觀測（persistent excitation 失效）。')
  else if (clsG === 'inverted')
    warnings.push(
      `GOS 反號：$\\kappa_{GOS}=12C=${an.kappaGos.toFixed(4)}<0$——鋸齒 $\\rho$ 各次諧波的功率 $1/(2\\pi^2m^2)$ 對 $\\mathrm{Re}\\,\\Gamma_{\\rm eff}(\\mathrm{frac}(m\\beta))$ 的加權和為負。${dP.mode === 'D1' ? '相關器晚一拍時，鋸齒 wrap 的那一拍被對到前一拍的 PD 響應（Type-II near-grid：$C\\approx-\\beta$）。' : '這個 regressor 的 kernel 在鋸齒功率集中的頻率為負。'}`,
    )
  else if (clsG === 'dead') warnings.push(`GOS 落在 dead zone：$\\kappa_{GOS}=${txs(an.kappaGos, 3)}$。near-grid（$\\beta\\to0$ 或 $1$）時 Type-II 的 $12C\\approx12\\beta^2/K_i$。`)
  if (exact && exact.kr.phosNObs < 7)
    warnings.push(`PE failure：$\\alpha=${exact.P}/${exact.Q}$ 只走訪部分 PMUX 相位，可觀測的 PHOS 方向只剩 ${exact.kr.phosNObs} 個（其餘權重收不到任何資訊）。`)
  if (exact && Number.isFinite(exact.kInf) && exact.kInf < -1e-3 && clsP !== 'inverted')
    warnings.push(
      `小訊號沒有反號，但大訊號（$A\\gg\\sigma_v$）的 1-bit 相關 $\\kappa_\\infty=${exact.kInf.toFixed(3)}<0$：線性相關看「面積」，1-bit 比較器只看「同號的持續時間」；$h_{PD}$ 的長負尾巴面積小、時間長。誤差一旦被推大（例如比較器 offset）就會反向。`,
    )
  if (!stepOk && clsP === 'restoring')
    warnings.push(
      `有限步長不穩定：最差模態 $\\kappa=${worst.re.toFixed(4)}${worst.im >= 0 ? '+' : '-'}${Math.abs(worst.im).toFixed(4)}j$，$\\mathrm{Re}\\,\\kappa\\le\\lvert\\kappa\\rvert^2/(2N_\\tau)$（$N_\\tau=${dP.nTau}$）。帶緣附近 $\\mathrm{Re}\\,\\kappa\\to0^+$ 而虛部不小，block 更新會振盪發散；請加大 $N_\\tau$（減小步長）。`,
    )
  if (dP.mode === 'D1')
    warnings.push(
      `相關器延遲 $D=+1$ 是有害的變形：$\\min_f\\mathrm{Re}\\,\\Gamma_{\\rm eff}=-H_{PD}(\\tfrac12)=${REMEDY[dP.loop].d1.toFixed(4)}$，幾乎所有 $\\alpha$ 都反號。這個模式只用來示範「延遲沒對齊」的後果。`,
    )
  if (kern && kern.anyNegative && kern.min < -1e-12)
    warnings.push(
      `filtered-x 的模型不對：Type-I 模型 $\\hat K=${dP.kHat}$ 配這個迴路時，$\\mathrm{Re}\\,\\Gamma_{\\rm eff}=\\mathrm{Re}\\{H_{PD}\\overline{\\hat H_{PD}}\\}$ 在 0–${fx((kern.negFMax ?? 0) * FREF_MHZ, 1)} MHz 為負（最低 $${txs(kern.min, 3)}$ @ ${fx(kern.fAtMin * FREF_MHZ, 1)} MHz）：低頻時 $\\angle H_{PD}\\to180^\\circ$ 而 $\\angle\\hat H\\to90^\\circ$，相位差超過 $90^\\circ$。PSD 定理的「對任何 $\\alpha$ 都安全」保證消失；這個 $\\alpha$ 是否反號，要看上面各模態的 $\\kappa$。`,
    )
  if (dP.mode === '2diff') warnings.push('二階差分是有害的變形：在 $f_{ref}/4$ 以下、$H\\approx1$ 的頻段相位接近 $\\pi$，會把原本安全的 $\\alpha$ 反向。')

  // ── 指標 ──
  const tol = (e: number) => 6e-4 * Math.abs(e) + 3e-6
  const metrics: MetricRow[] = [
    { name: '$\\alpha$', value: alpha, digits: 8, note: exact ? `$=${exact.P}/${exact.Q}$（${exact.Q % 8 === 0 ? '$8\\mid Q$：occupancy 均勻、PHOS 為 circulant' : '$8\\nmid Q$：occupancy 不均、GOS–PHOS 有耦合'}）` : '分母 $>8000$：只做 ergodic 分析' },
    { name: 'PMUX 旋轉頻率 $\\min(\\alpha,1-\\alpha)f_{ref}$', value: fFold, unit: 'MHz', digits: 7 },
    { name: '$\\beta=\\mathrm{frac}(8\\alpha)$（鋸齒基頻）', value: an.beta, digits: 6, note: `${fx(Math.min(an.beta, 1 - an.beta) * FREF_MHZ, 1)} MHz` },
    {
      name: `$\\kappa_{PHOS}=8\\min_m\\mathrm{Re}\\,\\lambda_m$（ergodic；最差 mode ${an.worstMode}）`,
      value: an.kappaPhos,
      digits: 5,
      formulaId: 'F-CS.13',
      claim: 'exact',
      ...(jsonP !== null && exact && exact.Q === 8000 ? { analytic: jsonP, tolerance: tol(jsonP), toleranceMode: 'abs' as const } : {}),
      note: `${CLASS_TEXT[clsP]}${jsonP !== null ? `；golden signmap：${fs(jsonP, 5)}` : ''}`,
    },
    { name: '$\\mathrm{Re}\\,\\kappa_1$（mode-1）', value: an.kappaM[0].re, digits: 5, note: `$\\mathrm{Im}\\,\\kappa_1=${an.kappaM[0].im.toFixed(4)}$（有限步長判據用）` },
    { name: '單線近似 $W_1\\mathrm{Re}\\,\\Gamma_{\\rm eff}(\\alpha)$', value: an.singleLine, digits: 5, note: `$\\mathrm{Re}\\,\\Gamma_{\\rm eff}(\\alpha f_{ref})=${an.reGammaAtAlpha.toFixed(5)}$；近整數時過度悲觀、alias 區看不到問題` },
    { name: 'mode-1 嚴格界限：$\\mathrm{Re}\\,\\kappa_1$ 的 [下, 上]', value: `[${fs(an.m1Lower, 4)}, ${fs(an.m1Upper, 4)}]`, formulaId: 'F-CS.14', claim: 'exact', note: an.m1Upper < 0 ? '上界 $<0$：一定反號' : an.m1Lower >= 0 ? '下界 $\\ge0$：mode-1 不可能反號' : '界限跨過 0：要看實際的和' },
    {
      name: '$\\kappa_{GOS}=12\\,C_{GOS}$（ergodic）',
      value: an.beta === 0 ? '不可觀測（鋸齒 regressor 恆為 0）' : an.kappaGos,
      digits: 5,
      formulaId: 'F-CS.11',
      claim: 'exact',
      ...(jsonG !== null && an.beta !== 0 && exact && exact.Q === 8000 ? { analytic: jsonG, tolerance: tol(jsonG), toleranceMode: 'abs' as const } : {}),
      note: `${an.beta === 0 ? '' : CLASS_TEXT[clsG]}${jsonG !== null ? `；golden signmap：${fs(jsonG, 5)}${exact && exact.Q !== 8000 ? '（golden 除以這個週期實際的 $\\mathrm{var}(\\rho)$，見「精確週期」列）' : ''}` : ''}`,
    },
  ]
  if (exact) {
    metrics.push(
      { name: `精確週期（$\\alpha=${exact.P}/${exact.Q}$）：$\\kappa_{PHOS}$`, value: Number.isFinite(exact.kr.kP) ? exact.kr.kP : null, digits: 5, claim: 'exact', note: `$\\min\\mathrm{Re}\\,\\mathrm{eig}$ $\\div$ 開迴路參考（${fp(exact.kr.refP, 4)}）；可觀測 PHOS 方向 ${exact.kr.phosNObs} 個` },
      {
        name: '精確週期：$\\kappa_{GOS}=C_{GOS}/\\mathrm{var}(\\rho)$',
        value: Number.isFinite(exact.kr.kG) ? exact.kr.kG : '不可觀測',
        digits: 5,
        claim: 'exact',
        ...(Number.isFinite(exact.kr.kG) ? { note: gosExactNote(exact.kr.varRho, exact.kr.kG) } : {}),
      },
      { name: '精確週期：joint $9\\times9$ 的 $\\min\\mathrm{Re}\\,\\mathrm{eig}$（同一正規化）', value: Number.isFinite(exact.kr.kJ) ? exact.kr.kJ : null, digits: 5, formulaId: 'F-CS.15', claim: 'exact', note: `GOS–PHOS 耦合 $\\max\\lvert C_{0k}\\rvert=${exact.kr.coupling < 1e-15 ? '0' : txs(exact.kr.coupling, 2)}$` },
      {
        name: '大訊號 $\\kappa_\\infty$（6 個方向的最差值）',
        value: Number.isFinite(exact.kInf) ? exact.kInf : null,
        digits: 4,
        formulaId: 'F-CS.20',
        claim: 'approx',
        ...(jsonLS !== null && Number.isFinite(exact.kInf) ? { analytic: jsonLS, tolerance: 2e-4 + 2e-4 * Math.abs(jsonLS), toleranceMode: 'abs' as const } : {}),
        note: `sim 物理模型（$a=${SIM_CFG.a}$、$\\varepsilon$ 取 seed 7、$\\Delta=${SIM_CFG.deltaPs}$ ps，插圖值）${dP.mode === 'ponly' ? '；P-only 以 ac（GOS 去平均）計算' : ''}`,
      },
    )
  }
  metrics.push({
    name: `有限步長（$N_\\tau=${dP.nTau}$ blocks）：$\\lvert1-\\kappa_m/N_\\tau\\rvert<1$ 對所有模態`,
    value: stepOk ? '穩定' : '不穩定',
    formulaId: 'F-CS.18',
    claim: 'exact',
    note: `最差模態：$\\mathrm{Re}\\,\\kappa=${worst.re.toFixed(4)}$、$\\lvert\\kappa\\rvert^2/(2N_\\tau)=${((worst.re ** 2 + worst.im ** 2) / (2 * dP.nTau)).toFixed(4)}$`,
  })
  if (simRow)
    metrics.push({
      name: '時域 sim（golden 存檔，erf estimator）的 $\\kappa_{PHOS}$',
      value: simRow.sim,
      digits: 5,
      analytic: simRow.theory,
      tolerance: 3.5e-3,
      toleranceMode: 'abs',
      note: 'sim 的正規化與物理注入模型；analytic 欄是同一約定下的精確週期理論',
    })

  // ── 圖 1：各模態的 κ ──
  const barData: Data[] = useMemo(() => {
    const names = ['m=1', 'm=2', 'm=3', 'm=4', 'm=5', 'm=6', 'm=7', 'GOS']
    const re = [...an.kappaM.map((k) => k.re), an.beta === 0 ? 0 : an.kappaGos]
    const colors = re.map((v) => (v < -dP.tau ? COL_NEG : v > dP.tau ? COL_POS : COL_DEAD))
    const traces: Data[] = [
      { type: 'bar', x: names, y: re, name: '$\\mathrm{Re}\\,\\kappa$（ergodic 諧波和）', marker: { color: colors } },
      { x: names.slice(0, 7), y: an.kappaM.map((k) => k.im), name: '$\\mathrm{Im}\\,\\kappa_m$', mode: 'markers', marker: { symbol: 'diamond-open', size: 9, color: tokens.textMuted } },
    ]
    if (exact)
      traces.push({
        x: names,
        y: [...exact.kr.km.map((k) => k.re), Number.isFinite(exact.kr.kG) ? exact.kr.kG : null],
        name: `精確週期（$\\alpha=${exact.P}/${exact.Q}$）`,
        mode: 'markers',
        marker: { symbol: 'x', size: 10, color: tokens.text },
      })
    return traces
  }, [an, exact, tokens, dP.tau])

  // ── 圖 2：sign map 曲線 ──
  const lineData: Data[] = useMemo(() => {
    if (!map) return []
    const f = map.f_MHz
    const t: Data[] = []
    const add = (key: keyof SignMapJson | null, name: string, color: string, dash?: 'dot' | 'dash' | 'dashdot') => {
      const y = column(map, key)
      if (y) t.push({ x: f, y, name, mode: 'lines', line: { color, dash, width: dash ? 1.3 : 2 } })
    }
    add(setup.colP, `PHOS $\\kappa_P$（${dP.mode}，golden signmap）`, tokens.series[0])
    add(setup.colG, `GOS $\\kappa_G$（${dP.mode}）`, tokens.series[1])
    if (dP.mode === 'raw' || dP.mode === 'ac') {
      add('km1_re', 'mode 1', tokens.series[2], 'dot')
      add('km2_re', 'mode 2', tokens.series[3], 'dot')
      add('km4_re', 'mode 4', tokens.series[4] ?? tokens.textMuted, 'dot')
    }
    add(setup.colLS, '大訊號 $\\kappa_\\infty$', tokens.textMuted, 'dashdot')
    // 目前 α 的垂直標線：用 trace 畫（log 軸上 shape 的座標約定容易出錯）
    let lo = 0
    let hi = 0
    for (const tr of t) {
      const ys = (tr as { y: ArrayLike<number | null> }).y
      for (let i = 0; i < ys.length; i++) {
        const v = ys[i]
        if (typeof v === 'number' && Number.isFinite(v)) {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    }
    t.push({ x: [fFold, fFold], y: [lo, hi], name: '目前的 $\\alpha$', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot', width: 1 }, hoverinfo: 'skip', showlegend: false })
    t.push({ x: [fFold], y: [an.kappaPhos], name: '目前的 $\\alpha$：$\\kappa_{\\mathrm{PHOS}}$（TS port）', mode: 'markers', marker: { size: 13, symbol: 'star', color: tokens.series[0], line: { color: tokens.text, width: 1 } } })
    if (an.beta !== 0) t.push({ x: [fFold], y: [an.kappaGos], name: '目前的 $\\alpha$：$\\kappa_{\\mathrm{GOS}}$（TS port）', mode: 'markers', marker: { size: 11, symbol: 'diamond', color: tokens.series[1], line: { color: tokens.text, width: 1 } } })
    return t
  }, [map, setup, dP.mode, tokens, fFold, an])

  const lineLayout: Partial<Layout> = useMemo(
    () => ({
      shapes: [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }],
      xaxis: { title: { text: '$\\min(\\alpha,\\,1-\\alpha)\\cdot f_{\\mathrm{ref}}$ [MHz]' } },
      yaxis: { title: { text: '$\\kappa$（$>0$ restoring；$<0$ 反號）' } },
    }),
    [tokens],
  )

  // ── 圖 3：sign map 熱圖 ──
  const heat = useMemo(() => {
    if (!map) return { data: [] as Data[], n: 0 }
    const rows = HEAT_ROWS.filter((row) => Array.isArray(map[row.key])).map((row) => ({ ...row, label: plotMath(row.label) })) // y 軸的類別名稱不經 applyPlotMath，這裡先轉
    const z = rows.map((row) => (map[row.key] as number[]).map((v) => (v < -dP.tau ? -1 : v > dP.tau ? 1 : 0)))
    const data: Data[] = [
      {
        type: 'heatmap',
        x: map.f_MHz,
        y: rows.map((row) => row.label),
        z,
        zmin: -1,
        zmax: 1,
        showscale: false,
        colorscale: [
          [0, COL_NEG],
          [0.3333, COL_NEG],
          [0.3333, COL_DEAD],
          [0.6667, COL_DEAD],
          [0.6667, COL_POS],
          [1, COL_POS],
        ],
        hovertemplate: '%{y}<br>%{x} MHz<extra></extra>',
      } as Data,
    ]
    if (rows.length > 1)
      data.push({ x: [fFold, fFold], y: [rows[0].label, rows[rows.length - 1].label], name: '目前的 $\\alpha$', mode: 'lines', line: { color: tokens.text, width: 2 }, hoverinfo: 'skip', showlegend: false })
    return { data, n: rows.length }
  }, [map, dP.tau, fFold, tokens])
  const heatLayout: Partial<Layout> = useMemo(
    () => ({
      // x 軸是否 log 由 Plot 的 xLog 決定（log 刻度的規則——整數次方——由 Plot 統一處理），這裡不設 type
      xaxis: { title: { text: '$\\min(\\alpha,\\,1-\\alpha)\\cdot f_{\\mathrm{ref}}$ [MHz]<br>（直線 = 目前的 $\\alpha$）' } },
      yaxis: { automargin: true },
      margin: { l: 170 },
    }),
    [],
  )

  const ergVsExact = exact && exact.Q % 8 === 0 && exact.Q >= 1000 ? Math.abs(exact.kr.kP - an.kappaPhos) : null
  const analyticOk = ergVsExact !== null ? ergVsExact < 2e-4 : jsonP !== null && exact?.Q === 8000 ? Math.abs(jsonP - an.kappaPhos) < tol(jsonP) : null

  return (
    <ExperimentShell
      id={SIGNMAP_EXPERIMENT_ID}
      title="實驗 B：$\alpha$ sign map——哪個 $\alpha$、哪個模態、哪種 regressor 會反號"
      level="L2"
      claim="exact"
      source="illustrative"
      description={
        <>
          選一個 {mathText('$\\alpha$')}（或 PMUX 旋轉頻率 {mathText('$\\alpha f_{ref}$')}）與 regressor 模式。長條圖是 TS port 即時算出的{' '}
          {mathText('$\\kappa_m=8\\lambda_m$')}（PHOS 的 7 個 DFT 模態）與 GOS 的 {mathText('$12\\,C_{GOS}$')}（{mathText('$\\mathrm{var}(\\rho)=\\tfrac{1}{12}$')} 時等於 {mathText('$\\kappa_{GOS}$')}；小 {mathText('$Q$')} 的差別見「假設」）；下方兩張圖是 golden 預先算好的 sign map（<code>signmap_{dP.loop}.json</code>，2000 個 {mathText('$\\alpha$')}）。
        </>
      }
      assumptions={[
        'Bussgang 小訊號線性化（$\\lvert e_{PD}\\rvert\\ll\\sigma_v$）與穩態平均；小步長極限：收斂 $\\iff$ 可觀測子空間上 $\\mathrm{Re}\\,\\mathrm{eig}(C)>0$',
        '一階累加器、無 DSM 隨機化：$\\varphi[n]=\\mathrm{frac}(n\\alpha)$、$p=\\lfloor8\\varphi\\rfloor$、$\\rho=8\\varphi-p$；相關器延遲 $D=0$（除非選 $D=+1$）',
        'ergodic 諧波和對無理數 $\\alpha$ 精確；有理數 $\\alpha$ 另列精確週期解（$8\\nmid Q$ 或小 $Q$ 時兩者會不同）；GOS 的兩列用同一個 $C_{GOS}$，差別只在正規化：ergodic 列乘固定的 12，精確週期列與 golden sign map 除以這個週期實際的 $\\mathrm{var}(\\rho)=\\frac{b^2-1}{12b^2}$（$b$ 是 $\\beta$ 的最簡分母），所以是 ergodic 列的 $\\frac{b^2}{b^2-1}$ 倍（$\\alpha=\\tfrac1{16}$ 時 $b=2$，是 $\\tfrac43$ 倍；$b\\ge32$ 時差不到 $0.1\\%$）；ergodic 列的級數截在 8192 項，小 $Q$ 時另有約 $3\\times10^{-5}$ 的尾項誤差',
        'sign map 的格點是 $\\alpha=(2j-1)/8000$（$\\alpha f_{ref}=j-0.5$ MHz），每一點都有 $8\\mid Q$；$1-\\alpha$ 的值相同（鏡像）',
        '大訊號 $\\kappa_\\infty$ 只沿 6 個方向（GOS、m1c、m1s、m2c、m3c、m4）計算，不是完整的非線性穩定域；$\\sigma_v=200$ fs、$f_{vco}=16$ GHz 為插圖值',
        '標稱迴路 L1／L2／L3（320 MHz）；P-only 模式把迴路換成 hold 住積分路徑後的 Type-I 迴路（L3 用 $C_1\\gg C_2$ 模型）',
      ]}
      params={{ ...P, alpha: P.fMHz / FREF_MHZ }}
      units={{ fMHz: 'MHz', nTau: 'blocks', kHat: '—', tau: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic:
          analyticOk === null
            ? { status: 'n/a', note: map ? '$\\alpha$ 不在可比對的格點上' : mapStatus === 'error' ? 'golden signmap 載入失敗' : 'golden signmap 載入中' }
            : { status: analyticOk ? 'ok' : 'mismatch', note: 'ergodic 諧波和 vs 精確週期／golden signmap' },
        monteCarlo: simRow ? { status: Math.abs(simRow.sim - simRow.theory) < 3.5e-3 ? 'ok' : 'mismatch', note: 'golden 存檔的時域 sim vs 理論（非本頁即時模擬）' } : { status: 'n/a', note: '只有 $\\alpha$ 在 0.001 格點且 raw／1diff 才有 sim 存檔' },
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setP(SIGN_DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeSignParams(prev, pr.params))}
      exportData={() => {
        const out: Record<string, ArrayLike<number | string | null>> = {}
        if (map) {
          out.f_MHz = map.f_MHz
          for (const row of HEAT_ROWS) {
            const v = map[row.key]
            if (Array.isArray(v)) out[String(row.key)] = v as number[]
          }
        }
        out.live_mode = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'GOS']
        out.live_re_kappa = [...an.kappaM.map((k) => k.re), an.kappaGos]
        out.live_im_kappa = [...an.kappaM.map((k) => k.im), 0]
        return out
      }}
      controls={
        <>
          <SelectControl label="迴路（標稱設計）" value={P.loop} onChange={(loop) => set({ loop })} options={(['L1', 'L2', 'L3'] as LoopKey[]).map((k) => ({ value: k, label: LOOP_LABEL[k] }))} reg="PLL 架構" />
          <ParamControl
            label={mathText('PMUX 旋轉頻率 $\\alpha f_{ref}$')}
            ariaLabel="α·f_ref"
            value={P.fMHz}
            onChange={(fMHz) => set({ fMHz })}
            min={0.5}
            max={3999.5}
            step={0.5}
            unit="MHz"
            digits={8}
            reg="FCW 的分數部分 × f_ref"
            hint={mathText('滑桿步長 0.5 MHz（$\\alpha=j/8000$，可算精確週期解）；可直接輸入任意值')}
          />
          <ParamControl
            label={mathText('$\\alpha$（FCW 的分數部分）')}
            ariaLabel="α"
            value={P.fMHz / FREF_MHZ}
            onChange={(a) => set({ fMHz: a * FREF_MHZ })}
            min={0.000125}
            max={0.999875}
            step={0.000125}
            digits={8}
            reg="FCW[frac]"
            hint={mathText('$\\mathrm{FCW}=N_{int}+\\alpha$')}
          />
          <SelectControl
            label="GMAC regressor 模式"
            value={P.mode}
            onChange={(mode) => set({ mode })}
            options={(Object.keys(REG_MODE_LABEL) as RegMode[]).map((m) => ({ value: m, label: REG_MODE_LABEL[m] }))}
            reg="GMAC 前置濾波 G(z)"
          />
          {P.mode === 'fxTypeI' && (
            <ParamControl label={mathText('Type-I 模型的 $\\hat K$')} ariaLabel="K-hat" value={P.kHat} onChange={(kHat) => set({ kHat })} min={0.01} max={1.5} log hint={mathText('配 L2 時需 $\\hat K>1/(K_p/K_i+\\tfrac12)$')} reg="filtered-x 的 IIR 係數" />
          )}
          <SelectControl
            label={mathText('dead-zone 門檻 $\\tau$')}
            ariaLabel="dead-zone 門檻 τ"
            value={P.tau}
            onChange={(tau) => set({ tau })}
            options={[
              { value: 1e-3, label: '10⁻³' },
              { value: 1e-2, label: '10⁻²' },
            ]}
            hint={mathText('$\\kappa<-\\tau$ 才算反號；$\\lvert\\kappa\\rvert\\le\\tau$ 是 dead zone')}
          />
          <ParamControl
            label={mathText('$N_\\tau$（開迴路名義時間常數）')}
            ariaLabel="N_tau"
            value={P.nTau}
            onChange={(nTau) => set({ nTau })}
            min={1}
            max={1000}
            log
            unit="blocks"
            reg="LMS 步長"
            hint={mathText('$H\\equiv1$、$\\kappa=1$（8 個相位被選到的次數一樣多）時，每個 block 修掉誤差的 $1/N_\\tau$（§12）')}
          />
          <ToggleControl label="熱圖的頻率軸用 log" value={P.logX} onChange={(logX) => set({ logX })} />
        </>
      }
    >
      <Plot
        title="目前 $\alpha$ 的 $\kappa_m=8\lambda_m$（PHOS 的 DFT 模態）與 $\kappa_{GOS}$"
        data={barData}
        height={300}
        csvName="sspll-kappa-modes"
        layout={{ yaxis: { title: { text: '$\\kappa$' } }, barmode: 'overlay' }}
        caption="長條是實部 $\mathrm{Re}\,\kappa_m$（最右邊是 GOS 的 $12\,C_{GOS}$），顏色看正負：藍＝restoring、紅＝反號、灰＝dead zone；菱形是虛部 $\mathrm{Im}\,\kappa_m$（有限步長判據用）；✕ 是有理數 $\alpha$ 的精確週期值（$8\nmid Q$ 時是 Rayleigh quotient，不是特徵值）。GOS 的 ✕ 除以這個週期實際的 $\mathrm{var}(\rho)$，小 $Q$ 時是長條（$12C$）的 $\frac{b^2}{b^2-1}$ 倍（$b$ 是 $\beta$ 的最簡分母）；$C_{GOS}$ 本身相同。"
      />
      {map ? (
        <Plot
          title="golden sign map：$\kappa$ 對 $\alpha f_{ref}$（星號／菱形 = 目前的 $\alpha$，TS port 即時值）"
          data={lineData}
          layout={lineLayout}
          xLog={P.logX}
          height={340}
          csvName="sspll-signmap-lines"
        />
      ) : (
        <DataPending status={mapStatus} what="golden sign map" height={340} />
      )}
      <div className="cs-legend" aria-label="熱圖圖例">
        <span>
          <span className="cs-swatch" style={{ background: COL_POS }} />
          restoring（{mathText('$\\kappa>\\tau$')}）
        </span>
        <span>
          <span className="cs-swatch" style={{ background: COL_DEAD }} />
          dead zone（{mathText('$\\lvert\\kappa\\rvert\\le\\tau$')}）
        </span>
        <span>
          <span className="cs-swatch" style={{ background: COL_NEG }} />
          反號（{mathText('$\\kappa<-\\tau$')}）
        </span>
      </div>
      {map ? (
        <Plot title={`sign map 熱圖（${dP.loop}，$\\tau=${dP.tau}$）：每一列是一種 regressor／模態`} data={heat.data} layout={heatLayout} xLog={dP.logX} height={90 + 24 * heat.n} csvName="sspll-signmap-heat" />
      ) : (
        <DataPending status={mapStatus} what="sign map 熱圖" height={90 + 24 * heatRowCount(dP.loop)} />
      )}
    </ExperimentShell>
  )
}
