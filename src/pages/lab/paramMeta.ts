import { LAB_PARAM_LABEL, LAB_RANGES, type LabParams, type StageId } from '@/simulation/models/unifiedLab'
import type { ModelLevelId } from '@/components'

/**
 * 每個 LabParams 欄位在 UI 上的呈現（單一事實來源：ParamPanel、Compare 差異表、報告都讀這裡）。
 * - 合法範圍與單位來自模型的 LAB_RANGES；顯示名稱來自 LAB_PARAM_LABEL（`$...$` 為 TeX）。
 * - `reg` 是對應的 hardware register 或 behavioral parameter 名稱。register 名稱是**示意**（本站不是特定晶片），
 *   'behavioral:' 開頭的是只存在於行為模型的量（真實電路的物理參數，不是可寫的暫存器）。
 */

export type NumKey = keyof typeof LAB_RANGES
export type EnumKey = 'codeSource' | 'normalization' | 'pll' | 'encoding' | 'gmMode' | 'regressor' | 'rounding' | 'overflow' | 'regressorSign' | 'architecture' | 'pmuxOrder'
export type BoolKey = 'dither' | 'quantize' | 'signedReg'

export interface NumMeta {
  kind: 'num'
  key: NumKey
  stage: StageId | 'sim'
  reg: string
  hint?: string
  log?: boolean
  step?: number
  digits?: number
  /** 只在條件成立時顯示（例如 ζ 只對 Type-II 有意義） */
  when?: (p: LabParams) => boolean
}

export interface EnumMeta {
  kind: 'enum'
  key: EnumKey
  stage: StageId | 'sim'
  label: string
  reg: string
  hint?: string
  options: { value: string; label: string }[]
  when?: (p: LabParams) => boolean
}

export interface BoolMeta {
  kind: 'bool'
  key: BoolKey
  stage: StageId | 'sim'
  label: string
  reg: string
  hint?: string
  when?: (p: LabParams) => boolean
}

export type ParamMeta = NumMeta | EnumMeta | BoolMeta

const isDsm = (p: LabParams) => p.codeSource !== 'iid_pm_one'
const isPmux = (p: LabParams) => p.architecture === 'pmux8_gos'

export const PARAM_META: ParamMeta[] = [
  // 校正架構（wave 5）：單一 gain 或 8 相 PMUX + GOS 的 9 個權重
  {
    kind: 'enum',
    key: 'architecture',
    stage: 'dsm',
    label: '校正架構',
    reg: 'REG_CAL_ARCH',
    hint: 'gos_only：一個 DTC gain；pmux8_gos：8 相 PMUX 的 8 個 PHOS 權重 + 1 個 GOS（9 個權重，案例頁的架構）。pmux8 時 DSM 跑在 $(8\\alpha\\bmod 1)$、DTC 只補一個相位步 $\\Delta=T_{\\mathrm{vco}}/8$',
    options: [
      { value: 'gos_only', label: 'gos_only（單一 DTC gain）' },
      { value: 'pmux8_gos', label: 'pmux8_gos（8 相 PMUX + GOS，9 個權重）' },
    ],
  },
  {
    kind: 'enum',
    key: 'pmuxOrder',
    stage: 'dsm',
    label: 'PMUX 相位序列',
    reg: 'REG_PMUX_ROT_EN',
    hint: 'fcw：相位由累加器的整數部分決定（mode-1 以 $\\alpha f_{\\mathrm{ref}}$ 旋轉）；random：再疊上已知的隨機旋轉 $m[n]\\in\\{0\\dots7\\}$，one-hot 被白化、但 DTC 範圍要多 $7\\Delta$（研究延伸）',
    options: [
      { value: 'fcw', label: 'fcw（由 FCW 決定）' },
      { value: 'random', label: 'random（已知的隨機旋轉）' },
    ],
    when: isPmux,
  },
  // ① FCW → DSM
  {
    kind: 'enum',
    key: 'codeSource',
    stage: 'dsm',
    label: 'code 來源',
    reg: 'REG_DSM_ORDER[1:0]',
    hint: '一階：週期鋸齒（譜線）；MASH 1-1-1：noise-shaped；iid $\\pm1$：T13 的參考 code（不是 DSM）',
    options: [
      { value: 'dsm_first_order', label: '一階 DSM residue' },
      { value: 'mash111', label: 'MASH 1-1-1 residue' },
      { value: 'iid_pm_one', label: 'iid ±1（參考）' },
    ],
  },
  { kind: 'num', key: 'fRefHz', stage: 'dsm', reg: 'behavioral: f_ref（= f_s）', log: true, hint: '一個 reference 週期對應一個 DSM sample、一個 comparator sample' },
  { kind: 'num', key: 'nInt', stage: 'dsm', reg: 'REG_FCW_INT[9:0]', hint: '$f_{\\mathrm{out}}=(N_{\\mathrm{int}}+\\alpha)f_{\\mathrm{ref}}$；只影響 phase 換算與 spur 的 dBc' },
  { kind: 'num', key: 'frac', stage: 'dsm', reg: 'REG_FCW_FRAC[B-1:0]', digits: 8, step: 0.001, hint: '可精確輸入，例如 0.00001（近整數）；實際值量化到 $K/2^B$', when: isDsm },
  { kind: 'num', key: 'dsmBits', stage: 'dsm', reg: 'RTL: DSM accumulator width', hint: '$M=2^B$；一階週期 $P=M/\\gcd(K,M)$', when: isDsm },
  { kind: 'bool', key: 'dither', stage: 'dsm', label: 'DSM LSB dither', reg: 'REG_DSM_DITHER_EN', hint: '第一級輸入加 0/1 的 LSB：打散 MASH 的 idle tone；對一階 DSM 幾乎沒有作用（鋸齒還在）。代價是平均頻率 $+\\tfrac12$ LSB', when: isDsm },
  // ② code
  {
    kind: 'enum',
    key: 'regressorSign',
    stage: 'code',
    label: 'regressor 正負號',
    reg: 'behavioral: regressor_sign',
    hint: 'spec：照 docs/assumptions.md §2a，$x=s/M\\ge0$（一階 DSM 時 $x\\in[0,1)$ 的鋸齒，code 越大 feedback edge 越早到）；legacy：本頁原本的 $r=-s/M\\le0$（既有 preset、golden vector 與 blockLms 用它）。兩者只差 $x\\to-x$：$w$、$G$ 的收斂與 $\\sigma_w$ 完全相同，只有畫出來的 $x$、$e_{\\mathrm{DTC}}$、$t_{\\mathrm{out}}$ 鏡像，以及 offset／$c_2$ 相對 $x$ 的方向',
    options: [
      { value: 'spec', label: 'spec（x = s/M ≥ 0，§2a）' },
      { value: 'legacy', label: 'legacy（r = −s/M ≤ 0，既有 preset）' },
    ],
  },
  {
    kind: 'enum',
    key: 'normalization',
    stage: 'code',
    label: 'code 正規化',
    reg: 'behavioral: code_normalization',
    hint: 'unit_rms 保留 DC（$E[x]\\ne0$）；standardize 去平均並令 $E[x^2]=1$',
    options: [
      { value: 'none', label: 'none（原始 T_vco）' },
      { value: 'zero_mean', label: 'zero_mean（只去平均）' },
      { value: 'unit_rms', label: 'unit_rms（只調 RMS）' },
      { value: 'standardize', label: 'standardize（去平均 + 單位變異）' },
    ],
  },
  // ③ DTC
  { kind: 'num', key: 'aFs', stage: 'dtc', reg: 'behavioral: gain_true', step: 0.05, hint: '要被校正掉的 DTC gain 誤差（fs per unit code）' },
  { kind: 'num', key: 'w0Fs', stage: 'dtc', reg: 'REG_DTC_GAIN_INIT', step: 0.05, hint: '校正起點；$\\delta_0=a-w_0$' },
  { kind: 'num', key: 'dtcOffsetFs', stage: 'dtc', reg: 'behavioral: dtc_nonlinearity.offset_fs', step: 0.1, hint: '與 code 無關的固定延遲誤差' },
  { kind: 'num', key: 'c2', stage: 'dtc', reg: 'behavioral: dtc_nonlinearity.c2', step: 0.01, hint: 'INL 二階：$c_2x^2$' },
  { kind: 'num', key: 'c3', stage: 'dtc', reg: 'behavioral: dtc_nonlinearity.c3', step: 0.01, hint: 'INL 三階：$c_3x^3$（會讓 $w^*\\ne a$，第 11 章）' },
  { kind: 'num', key: 'phosRmsFs', stage: 'dtc', reg: 'behavioral: pmux_phase_offset_rms', step: 1, hint: 'PMUX 8 個相位 offset $\\varepsilon_p$（feedback edge 早到為正）的去共模 RMS；圖樣固定（analysis/sspll/sim 的 seed-7：$[+0.17,+0.59,-0.23,-1.12,-0.49,-1.26,+0.25,+2.10]\\times$ RMS），illustrative', when: isPmux },
  // ④ PLL
  {
    kind: 'enum',
    key: 'pll',
    stage: 'pll',
    label: '主 PLL 誤差路徑',
    reg: 'behavioral: pll_error_path.kind',
    hint: 'none：$H_{\\mathrm{PD}}=T=1$；Type-I：一個積分器；Type-II：兩個積分器（$H_{\\mathrm{PD}}$ 在 DC 有二階零點）；CPPLL：charge pump + 二階濾波（$R\\|C_1$ 與 $C_2$）⇒ 三階閉迴路，impulse-invariant 取樣',
    options: [
      { value: 'none', label: 'none（忽略主 PLL）' },
      { value: 'type1', label: 'Type-I DPLL' },
      { value: 'type2', label: 'Type-II DPLL' },
      { value: 'cppll3', label: '三階 CPPLL（charge pump + 二階濾波）' },
    ],
  },
  { kind: 'num', key: 'pllBwHz', stage: 'pll', reg: 'behavioral: PLL bandwidth（K_p、K_i）', log: true, hint: '$T$ 的 $-3\\,\\mathrm{dB}$ 設計值；Type-II 指 CT 原型', when: (p) => p.pll !== 'none' },
  { kind: 'num', key: 'zeta', stage: 'pll', reg: 'behavioral: damping ζ', step: 0.05, hint: 'Type-II 阻尼；$K_p=2\\zeta\\omega_nT_s$', when: (p) => p.pll === 'type2' },
  { kind: 'num', key: 'pllPmDeg', stage: 'pll', reg: 'behavioral: CPPLL phase margin', step: 1, hint: '連續時間 crossover 處的 phase margin；零點 $\\omega_z=\\omega_c/\\tan\\theta_z$、$\\theta_z=\\mathrm{PM}+\\arctan(1/r_p)$（要小於 $90^\\circ$）', when: (p) => p.pll === 'cppll3' },
  { kind: 'num', key: 'pllP3Ratio', stage: 'pll', reg: 'behavioral: CPPLL third pole ratio', step: 0.1, hint: '第三極點 $\\omega_{p3}=r_p\\,\\omega_c$（$R\\|C_1$ 與 $C_2$ 的比：$r_p=\\sqrt{1+C_1/C_2}$ 時與案例頁 L3 的對稱放置相同）', when: (p) => p.pll === 'cppll3' },
  { kind: 'num', key: 'loopDelay', stage: 'pll', reg: 'behavioral: loop latency', hint: '主迴路額外延遲 $d_L$（samples）；太大會讓主 PLL 自己不穩定', when: (p) => p.pll !== 'none' },
  // ⑤ comparator
  { kind: 'num', key: 'sigmaV', stage: 'comparator', reg: 'behavioral: pd_noise_rms_fs', step: 1, hint: '$K_q=\\sqrt{2/\\pi}/\\sigma_v$；設成 0 會變成純 sign（limit cycle / dead zone）' },
  { kind: 'num', key: 'compOffsetFs', stage: 'comparator', reg: 'behavioral: comparator_offset_fs', step: 0.5, hint: '獨立觀測 comparator 的 offset $b$；與 $E[x_{\\mathrm{ref}}]$ 相乘變成假 gain bias' },
  {
    kind: 'enum',
    key: 'encoding',
    stage: 'comparator',
    label: 'comparator 編碼',
    reg: 'RTL: q = 2b − 1 mapping',
    hint: 'unmapped_bug 是反面測試：硬體 0/1 直接當 $q$ 用',
    options: [
      { value: 'bipolar_pm_one', label: 'bipolar ±1' },
      { value: 'unipolar_mapped', label: '0/1 → 2b − 1（正確）' },
      { value: 'unipolar_unmapped_bug', label: '0/1 未映射（bug）' },
    ],
  },
  // ⑥ GMAC
  { kind: 'num', key: 'N', stage: 'gmac', reg: 'REG_GMAC_N[16:0]', log: true, hint: '每個 block 累加的 comparator 樣本數；$f_u=f_s/N$' },
  {
    kind: 'enum',
    key: 'gmMode',
    stage: 'gmac',
    label: 'GMAC 模式',
    reg: 'REG_GMAC_AVG_EN',
    hint: 'sum 模式的有效增益是 average 的 $N$ 倍（忘了 scaling 是常見 bug）',
    options: [
      { value: 'average', label: 'average（÷N）' },
      { value: 'sum', label: 'sum（不除）' },
    ],
  },
  {
    kind: 'enum',
    key: 'regressor',
    stage: 'gmac',
    label: 'regressor',
    reg: 'REG_GMAC_XSEL[1:0]',
    hint: 'raw：$x$；delayed：$x[n-D]$；filtered：$\\hat H\\{x\\}[n-D]$',
    options: [
      { value: 'raw', label: 'raw x' },
      { value: 'delayed', label: 'delayed x[n−D]' },
      { value: 'filtered', label: 'filtered-x' },
    ],
  },
  { kind: 'num', key: 'codeDelay', stage: 'gmac', reg: 'REG_GMAC_CODE_DLY[11:0]', hint: 'GMAC 端的 code 延遲 $D$（samples）；錯位會讓 $C$ 變號', when: (p) => p.regressor !== 'raw' },
  { kind: 'num', key: 'fxGain', stage: 'gmac', reg: 'behavioral: filtered_x_model.gain_mismatch', step: 0.05, hint: '$\\hat H=g_mH_{\\mathrm{PD}}z^{-D_x}$；$g_m<0$ 等於極性接反', when: (p) => p.regressor === 'filtered' },
  { kind: 'num', key: 'fxExtraDelay', stage: 'gmac', reg: 'behavioral: filtered_x_model.extra_delay_samples', hint: '模型多算的延遲 $D_x$（samples）', when: (p) => p.regressor === 'filtered' },
  // ⑦ register
  { kind: 'bool', key: 'quantize', stage: 'register', label: '定點 gain register（L5）', reg: 'behavioral: gain_register.quantize_physical', hint: '關閉時 $w$ 是理想浮點，下面的位元數不生效' },
  { kind: 'num', key: 'internalBits', stage: 'register', reg: 'RTL: gain accumulator width', hint: '內部暫存器總位元數（含小數位元）', when: (p) => p.quantize },
  { kind: 'num', key: 'physicalBits', stage: 'register', reg: 'REG_DTC_GAIN width', hint: '實際送到 DTC 的 gain code 位元數', when: (p) => p.quantize },
  { kind: 'num', key: 'lsbFs', stage: 'register', reg: 'behavioral: gain_register.lsb_fs', log: true, hint: '實體 code 一個 LSB 對應的 gain（fs per unit code；E13）', when: (p) => p.quantize },
  {
    kind: 'enum',
    key: 'rounding',
    stage: 'register',
    label: 'rounding',
    reg: 'RTL: rounding mode',
    hint: 'truncate 有 $-\\tfrac12$ LSB 的系統性偏差；stochastic 用亂數無偏',
    options: [
      { value: 'nearest', label: 'nearest' },
      { value: 'truncate', label: 'truncate' },
      { value: 'stochastic', label: 'stochastic' },
    ],
    when: (p) => p.quantize,
  },
  {
    kind: 'enum',
    key: 'overflow',
    stage: 'register',
    label: 'overflow',
    reg: 'RTL: saturate / wrap',
    hint: 'wrap 是反面測試：超出範圍時跳到另一端',
    options: [
      { value: 'saturate', label: 'saturate' },
      { value: 'wrap', label: 'wrap（bug）' },
    ],
    when: (p) => p.quantize,
  },
  { kind: 'bool', key: 'signedReg', stage: 'register', label: 'signed register', reg: 'RTL: two’s complement', hint: 'unsigned 時 code 範圍 $[0,2^{B}-1]$：負的 $a$ 會直接飽和', when: (p) => p.quantize },
  // ⑧ update
  { kind: 'num', key: 'muFs', stage: 'update', reg: 'REG_LMS_MU（shift）', step: 0.1, digits: 6, hint: 'average 模式下單位 fs；$g=\\mu K_qC$。負值 = 更新極性接反（反面測試）' },
  { kind: 'num', key: 'muPhosFs', stage: 'update', reg: 'REG_LMS_MU_PHOS（shift）', step: 0.1, digits: 6, hint: 'PHOS 8 個權重的 learning rate（one-hot regressor 無因次，所以單位 fs）；單一模式的增益 $g_p\\approx\\mu_pK_q/8$', when: isPmux },
  { kind: 'num', key: 'updateDelay', stage: 'update', reg: 'RTL: commit latency', hint: '新 $w$ 晚 $d$ 個 block 才作用；臨界 $g=2\\sin\\frac{\\pi}{4d+2}$' },
  // 模擬 / 輸出分析
  { kind: 'num', key: 'blocks', stage: 'sim', reg: 'simulation: num_blocks', log: true, hint: '統計只用後半段；Run-to-Convergence 會自動算' },
  { kind: 'num', key: 'outBlocks', stage: 'sim', reg: 'simulation: output window', log: true, hint: '輸出端分析用最後 $W$ 個 block（PSD 解析度 $\\approx f_s/(WN)$）' },
  { kind: 'num', key: 'fLHz', stage: 'sim', reg: 'analysis: jitter band', log: true, hint: 'integrated jitter 的積分下限' },
  { kind: 'num', key: 'fHHz', stage: 'sim', reg: 'analysis: jitter band', log: true, hint: 'integrated jitter 的積分上限（超過 $f_s/2$ 會被夾住）' },
]

/** ParamPanel 的分組（順序 = 訊號流向） */
export const PANEL_GROUPS: { id: StageId | 'sim'; title: string; level: ModelLevelId | null }[] = [
  { id: 'dsm', title: '① FCW → DSM', level: 'L2' },
  { id: 'code', title: '② residue → code', level: 'L2' },
  { id: 'dtc', title: '③ DTC', level: 'L2' },
  { id: 'pll', title: '④ PLL error path', level: 'L2' },
  { id: 'comparator', title: '⑤ Comparator', level: 'L1' },
  { id: 'gmac', title: '⑥ GMAC', level: 'L2' },
  { id: 'register', title: '⑦ Gain register', level: 'L5' },
  { id: 'update', title: '⑧ 更新迴路', level: 'L1' },
  { id: 'sim', title: '模擬長度與輸出分析', level: null },
]

/** 單位的 TeX / 文字（ParamControl 的 unit 是純文字欄位） */
export function unitOf(key: NumKey): string {
  const u = LAB_RANGES[key].unit
  return u === '—' ? '' : u
}

/** 參數的 TeX 標籤（`$...$`） */
export function labelOf(key: keyof LabParams): string {
  if (key in LAB_PARAM_LABEL) return LAB_PARAM_LABEL[key as NumKey]
  const m = PARAM_META.find((x) => x.key === key)
  if (m && m.kind !== 'num') return `${m.label}（${String(key)}）`
  return String(key)
}

/** ExperimentShell 的 units 欄位（匯出 JSON / 報告用） */
export const LAB_UNITS: Record<string, string> = Object.fromEntries(
  (Object.keys(LAB_RANGES) as NumKey[]).map((k) => [k, LAB_RANGES[k].unit === '—' ? 'dimensionless' : k === 'aFs' || k === 'w0Fs' || k === 'lsbFs' ? 'fs per unit code' : LAB_RANGES[k].unit]),
)
