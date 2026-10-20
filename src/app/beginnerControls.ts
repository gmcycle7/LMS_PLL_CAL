/**
 * Beginner 模式的精簡參數面板（wave 4，pedagogy／ux 審查：三種模式的實驗控制項數量幾乎一樣）。
 *
 * experimentId → Beginner 模式先露出的控制項 key 清單（3–5 個，挑 preset 會改到、而且是這個實驗要教的那幾個）。
 * 其餘控制項由 ExperimentShell 收進「更多參數（N 個）」的 <details>（預設收合）；Engineer／Research 全部展開、不受這張表影響；
 * 表裡沒有的 experimentId 全部顯示（和以前一樣）。
 *
 * key 怎麼對上控制項：ExperimentShell 會拿每個 ParamControl／SelectControl／ToggleControl 的
 *   `id`、`ariaLabel`（經 accessibleText）、`label`（經 nodeToAccessibleText）與 `reg`
 * 四個字串和這裡的 key 比對，比對前都經過 normalizeControlKey（NFKC：全形括號變半形、下標字變普通字；拿掉空白與底線；小寫），
 * 所以表裡可以寫 ariaLabel（'μ（學習率）'）、reg（'REG_GMAC_N'）或 label 的可念文字（'sigma v（量測雜訊 RMS）'）。
 * 標籤隨 Case 變動的控制項（ComparatorLab 的「— Case A」）用 reg。
 * beginnerControls.test.ts 會檢查：每個 experimentId 都在原始碼裡、每張清單 3–5 個 key、key 不重複。
 */
export const BEGINNER_CONTROLS: Readonly<Record<string, readonly string[]>> = {
  // Ch00 §0.5 動手玩：μ 太小、剛好、太大（presets 改 a、w0、x、steps、sigmaV、mus）
  // 每個 Case 的 μ 標籤隨 Case 變動（'Case A 的 mu（學習率）'），用 reg
  'intro-playground': ['REG_LMS_MU（學習率；硬體常為 2^-k 右移）', 'x（固定輸入）', 'a（黑盒子的真實參數）', 'sigma_v（量測雜訊 RMS）', '步數（模擬長度）'],
  // Ch00 §0.7 雜訊會被平均掉（presets 改 a、w、sigmaV、xKind、trials、nMax）
  'intro-noise-average': ['sigma_v（量測雜訊 RMS）', 'a（真實參數）', 'w（目前的猜測，固定）', '最長平均長度 N_max'],
  // Ch01 §1.5 LMS Playground（presets 改 a、w0、x、mu、steps、noiseSigma）
  'lms-playground': ['μ（學習率）', 'x（固定輸入）', 'a（真實係數）', 'σᵥ（量測雜訊 RMS）', '步數 N'],
  // Ch01 §2.5 MSE vs MAE（presets 改 model、mu、outlierProb、outlierSize…）
  'mse-vs-mae': ['loss type（突顯）', 'ε（outlier 比例）', 's（outlier 大小）', 'μ（學習率）', 'N（樣本數）'],
  // Ch02 §1 從切線斜率到 GD（presets 改 a、x、w0、mu、steps）
  'gd-tangent': ['μ（步長）', 'x（固定輸入）', 'a（真實係數）', 'w₀（初值）'],
  // Ch02 §3 Sign-Error 的 limit-cycle band（presets 改 mu、x、steps、tie、schedule、n0）
  'sign-lms-band': ['μ₀（初始步長）', 'x（固定輸入）', '步數 N', '步長排程', 'n₀（排程時間常數）'],
  // Ch04 §2 Fractional residue（presets 改 kind、frac、bits、gainErrPct）
  'gmac-residue': ['DSM 架構', 'frac（FCW 小數）', 'DTC gain 相對誤差 ε', 'B_dsm（累加器位元）'],
  // Ch04 §3 GMAC 訊號流（presets 改 N、sigmaV、aTrue、w0、pattern、path…）
  'gmac-signal-flow': ['N（每 block sample 數）', 'σ_v（comparator 前雜訊）', 'μ（gain_step）', 'a（真實 gain）', 'code pattern'],
  // Ch04 §3 位元編碼（presets 改 codeMean、codeSigma、mu、sigmaV、N）
  'gmac-bit-encoding': ['E[x]（code 平均）', 'σ_x（code 標準差）', 'μ', 'σ_v', 'N'],
  // Ch05 §6 Comparator Lab（presets 改 s、sigma、theta、h、N、tieRule）；前四個標籤隨 Case 變動，用 reg
  'comparator-lab': ['Behavioral: s = DTC residual (a − w)', 'Behavioral: σ_v（BBPD 輸入參考雜訊）', 'Behavioral: θ（comparator offset）', 'N（累加樣本數，所有 Case 共用）', String.raw`Behavioral: $h$（comparator hysteresis，門檻 $\theta\mp h$）`],
  // Ch06 §5 連續／離散的 H_PD（presets 改 type、zeta、wLTs、loopDelay）
  'polarity-ct-dt': ['迴路型式', 'ζ（阻尼比，Type-II）', 'ω_L T_s（迴路頻率 × 取樣週期）'],
  // Ch14 §14.7／§14.6b 校正狀態機與 FLL acquisition（presets 改 sigmaV、N、FLL 增益、lock 門檻、phase-lock 門檻…）
  'cal-state-machine': ['σ_v', 'N', 'FLL 增益 K_f', 'lock 門檻 f_tol', 'phase-lock 門檻 θ_max'],
  // 案例頁 §10b 實驗 D：code source × dither × PMUX 旋轉（presets 改 loop、α f_ref、兩個 case 的 code source）
  'sspll-code-source': ['PLL 架構（PM）', 'α·f_ref', 'Case A 的 code source', 'Case B 的 code source'],
  // Ch14 §14.4 設計計算器（presets 改 sigmaV、N、T、delta0、objective…）
  'lr-optimizer': ['σ_v（comparator 雜訊）', 'N（每 block 樣本數）', 'T（總比較次數）', 'δ0（初始誤差）', '最佳化目標'],
}

/** 這個實驗在 Beginner 模式先露出的控制項 key；表裡沒有就是 null（全部顯示） */
export function beginnerControlKeys(experimentId: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(BEGINNER_CONTROLS, experimentId) ? BEGINNER_CONTROLS[experimentId] : null
}

/**
 * 比對用的正規化：NFKC（全形括號／逗號、下標字、全形空白都變成基本字元）、小寫、拿掉空白與底線。
 * 'σᵥ（量測雜訊 RMS）' 與 'σ_v（量測雜訊 RMS）' 都變成 'σv(量測雜訊rms)'。
 */
export function normalizeControlKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '')
}

/** 某個控制項（它的幾個候選名稱）是否在清單裡 */
export function controlInList(keys: readonly string[], candidates: readonly (string | undefined | null)[]): boolean {
  const norm = candidates.filter((c): c is string => typeof c === 'string' && c.length > 0).map(normalizeControlKey)
  if (norm.length === 0) return false
  return keys.some((k) => norm.includes(normalizeControlKey(k)))
}
