import { texNum } from '@/components'
import {
  calPole,
  classifyPolarity,
  DEFAULT_POLARITY_PARAMS,
  kqFromSigma,
  polarityMarginDeg,
  toneCorrelation,
  toneEmpirical,
  toneLargeErrorGain,
  tonePath,
  toneRippleBound,
  type PolarityClass,
  type PolarityParams,
} from '@/simulation/models/polarity'
import { lfilter } from '@/simulation/signal'

/**
 * Polarity Explorer 的 UI 端純函式（單頻模式的即時分析、參數驗證、判定文字）。
 * 數值全部來自 src/simulation/models/polarity.ts；這裡只負責組裝。
 * 判定與警告文字裡的數學一律寫成 `$...$`（ExperimentShell 的 warnings 與本章的判定欄以 mathText 顯示）。
 */

export const POLARITY_EXPERIMENT_ID = 'polarity-explorer'

const NUM_KEYS = ['mag', 'phiDeg', 'omega', 'A', 'D', 'zeta', 'bwRatio', 'loopDelay', 'toneRatio', 'frac', 'mu', 'sigmaV', 'N', 'blocks', 'a', 'w0'] as const

/** preset / URL 參數的型別檢查（不認得的 key 一律忽略） */
export function sanitizeParams(v: Record<string, unknown>): Partial<PolarityParams> {
  const out: Partial<PolarityParams> = {}
  if (v.mode === 'tone' || v.mode === 'pll') out.mode = v.mode
  if (v.loopType === 'typeI' || v.loopType === 'typeII') out.loopType = v.loopType
  if (v.code === 'tone' || v.code === 'dsm1' || v.code === 'mash' || v.code === 'iid') out.code = v.code
  if (v.regressor === 'x' || v.regressor === 'u') out.regressor = v.regressor
  for (const k of NUM_KEYS) {
    const x = v[k]
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  }
  return out
}

export function withDefaults(v: Record<string, unknown>): PolarityParams {
  return { ...DEFAULT_POLARITY_PARAMS, ...sanitizeParams(v) }
}

export interface ToneAnalysis {
  phiEffRad: number
  edge: boolean
  h: number[]
  /** 解析 C_D（raw / delayed x；D 為目前設定） */
  C: number
  /** filtered-x（Ĥ = H）時的有效相關 E[u[n−D]·u[n]] = (A²|H|²/2)cos(ΩD) */
  Cfx: number
  /** GMAC 實際使用的相關（依 regressor 選 C 或 Cfx） */
  Ceff: number
  /** 時域：實際 FIR 濾波後 L 點平均 */
  Cemp: number
  empLength: number
  empTol: number
  /** 有限 N block 的 ripple 上界 */
  rippleN: number
  Kq: number
  pole: number
  marginDeg: number
  largeErrorGain: number
  cls: PolarityClass
  CD: { D: number[]; analytic: number[]; empirical: number[] }
  wave: { n: number[]; x: number[]; u: number[]; xD: number[] }
}

/** 單頻模式的即時分析（主執行緒；計算量 < 1 ms 級） */
export function analyzeTone(p: PolarityParams): ToneAnalysis {
  const phi = (p.phiDeg * Math.PI) / 180
  const path = tonePath(p.mag, phi, p.omega)
  const phiEffRad = path.phiEffRad
  const D = Math.max(0, Math.round(p.D))
  const spec = { A: p.A, mag: p.mag, phiRad: phiEffRad, omega: p.omega }
  const C = toneCorrelation({ ...spec, delay: D })
  const empLength = 4096
  const emp = toneEmpirical({ ...spec, delay: D, length: empLength })
  const hMax = path.b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const empTol = emp.rippleBound + (4 * p.A * p.A * hMax) / empLength + 1e-9
  const Kq = kqFromSigma(p.sigmaV)
  // filtered-x：u 本身是振幅 A|H| 的單頻，E[u[n−D]u[n]] = toneCorrelation(A|H|, |H| = 1, φ = 0)
  const Cfx = toneCorrelation({ A: p.A * p.mag, mag: 1, phiRad: 0, omega: p.omega, delay: D })
  const fx = p.regressor === 'u'
  const Ceff = fx ? Cfx : C
  const period = path.edge ? 2 : (2 * Math.PI) / p.omega
  const dMax = Math.max(12, Math.min(64, Math.ceil(period) + 1))
  const CD = { D: [] as number[], analytic: [] as number[], empirical: [] as number[] }
  for (let d = 0; d <= dMax; d++) {
    CD.D.push(d)
    CD.analytic.push(toneCorrelation({ ...spec, delay: d }))
    CD.empirical.push(toneEmpirical({ ...spec, delay: d, length: 1024 }).C)
  }
  // 波形：約 3 個週期（至少 24、至多 120 點）
  const nShow = Math.max(24, Math.min(120, Math.ceil(3 * period)))
  const off = D + 1
  const xs = new Float64Array(nShow + off).map((_, i) => p.A * Math.cos(p.omega * (i - off)))
  const us = lfilter(path.b, path.a, xs).y
  const wave = { n: [] as number[], x: [] as number[], u: [] as number[], xD: [] as number[] }
  for (let i = off; i < xs.length; i++) {
    wave.n.push(i - off)
    wave.x.push(xs[i])
    wave.u.push(us[i])
    wave.xD.push(xs[i - D])
  }
  return {
    phiEffRad,
    edge: path.edge,
    h: path.b,
    C,
    Cfx,
    Ceff,
    Cemp: emp.C,
    empLength,
    empTol,
    rippleN: toneRippleBound({ A: p.A, mag: p.mag, omega: p.omega, N: p.N }),
    Kq,
    pole: calPole(p.mu, Kq, Ceff),
    marginDeg: polarityMarginDeg((((fx ? 0 : phiEffRad) + p.omega * D) * 180) / Math.PI),
    largeErrorGain: fx ? toneLargeErrorGain(p.A * p.mag, 0, p.omega, D) : toneLargeErrorGain(p.A, phiEffRad, p.omega, D),
    cls: classifyPolarity(Ceff, 0.5 * p.A * p.A * Math.max(fx ? p.mag * p.mag : p.mag, 1e-12)),
    CD,
    wave,
  }
}

/** 依 C 與 pole 給一句判定 */
export function verdict(cls: PolarityClass, pole: number): { text: string; tone: 'pos' | 'neg' | 'zero' } {
  if (cls === 'negative') return { text: String.raw`極性錯誤：任何 $\mu>0$ 都平均發散`, tone: 'neg' }
  if (cls === 'zero') return { text: String.raw`$C\approx0$：沒有恢復力（漂移）`, tone: 'zero' }
  if (Math.abs(pole) >= 1) return { text: String.raw`$g\ge2$：振盪發散（降低 $\mu$ 可修正）`, tone: 'neg' }
  return { text: '極性正確：平均收斂', tone: 'pos' }
}

/** 共用的警告文字（依規格 §19：必須解釋原因） */
export function polarityWarnings(prefix: string, C: number, cls: PolarityClass, Kq: number, mu: number): string[] {
  const w: string[] = []
  if (cls === 'negative') {
    w.push(
      String.raw`${prefix}$C\le0$：更新極性錯誤（$C_D=${texNum(C, 4)}$），正 learning rate 會使平均誤差發散；$p=1+\mu K_q|C|=${texNum(calPole(mu, Kq, C), 6)}>1$，只減小 $\mu$ 不會改變符號，需 delay alignment 或 filtered-x（第 07 章）。`,
    )
  } else if (cls === 'zero') {
    w.push(String.raw`${prefix}$C\approx0$：GMAC 沒有平均恢復力（$C_D=${texNum(C, 3)}$，例如 $\phi+\Omega D=\pm90^\circ$），$w$ 會隨 comparator 雜訊漂移（random walk）。`)
  } else {
    const g = mu * Kq * C
    if (g >= 2) w.push(String.raw`${prefix}$g=\mu K_qC=${texNum(g, 4)}\ge2\Rightarrow p\le-1$：極性正確但步長太大，平均誤差振盪發散（這種情況降低 $\mu$ 才有用）。`)
  }
  return w
}

// ───────────────────────── 模型的純文字 → `$...$` ─────────────────────────
//
// polarity.ts 的警告、交叉比對說明與封閉式標籤是純文字（模型層不依賴 KaTeX；單元測試與 gallery 也直接使用），
// 其中的數學以 Unicode 拼成（ω_LT_s、σ_v、δ₀ …）。顯示到 ExperimentShell 的 warnings／crossCheck note／MetricRow note
// 之前，在這裡把「已知的數學片段」逐一換成 `$...$`（docs/teaching-style.md §3）：
//  - 只改寫 `$...$` 以外的文字，所以對已經是 LaTeX 的字串重複呼叫是安全的（idempotent）；
//  - 不認得的片段原樣保留——最壞只是維持純文字，不會產生壞掉的 TeX；
//  - ch06.test.tsx 以模型的真實輸出逐條檢查：轉換後沒有漏網的 Unicode 數學、每段 `$...$` 都能被 KaTeX 解析。

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)`

/** 模型輸出的數字字串（toPrecision／toExponential，可能是 2.67e+3）→ TeX */
function numTex(s: string): string {
  const m = /^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
}

interface TextRule {
  re: RegExp
  /** 捕捉的數字個數 */
  n: number
  to: (...v: string[]) => string
}

/** 字面片段 → 規則：`#` 代表一個數字（捕捉後以 numTex 轉成 TeX），其餘字元照字面比對 */
function rule(literal: string, to: (...v: string[]) => string): TextRule {
  const parts = literal.split('#')
  return { re: new RegExp(parts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(NUM), 'g'), n: parts.length - 1, to }
}

const T = String.raw
const SAW_SUM = T`\sigma_x^2\sum_kh[k]\,\big(1-6`

/** 依序套用；片段較長、較特定的排在前面 */
const MODEL_TEXT_RULES: TextRule[] = [
  // designPolarityLoop：主 PLL 不穩定／ω_LT_s 不夠小（E44）
  rule('半徑 # ≥ 1', (r) => T`半徑 $${r}\ge1$`),
  rule('K = ω_cT_s < 2sin(π/(4d+2)) = #', (k) => T`$K=\omega_cT_s<2\sin\!\big(\pi/(4d+2)\big)=${k}$`),
  rule('ω_LT_s = #', (w) => T`$\omega_LT_s=${w}$`),
  rule('、d = #）', (d) => T`、$d=${d}$）`),
  rule('，C 與極性結論', () => T`，$C$ 與極性結論`),
  rule('K_p = 2ζω_nT_s', () => T`$K_p=2\zeta\omega_nT_s$`),
  rule('K_i = (ω_nT_s)²', () => T`$K_i=(\omega_nT_s)^2$`),
  // analyzePllPolarity：警告
  rule('tone 的 Ω 落在 π', () => T`tone 的 $\Omega$ 落在 $\pi$`),
  rule('此時 x 為 ±1 交替序列', () => T`此時 $x$ 為 $\pm1$ 交替序列`),
  rule('以 σ_x² 表示仍為 C = σ_x²·H(e^{jπ})', () => T`以 $\sigma_x^2$ 表示仍為 $C=\sigma_x^2\,H(e^{j\pi})$`),
  rule('frac = # 很接近 p/#：', (fr, q) => T`$\mathrm{frac}=${fr}$ 很接近 $p/${q}$：`),
  rule('真實週期 # > 分析長度 #，', (P, L) => T`真實週期 $${P}$ 大於分析長度 $${L}$，`),
  rule('：C 的時間平均', () => T`：$C$ 的時間平均`),
  // （Explorer 以 polarityWarnings 取代下面兩條；其他頁面若直接顯示模型的版本，也能得到 LaTeX）
  rule('C ≤ 0：更新極性錯誤（C_D = #，以 σ_x² = # 正規化）', (c, s2) => T`$C\le0$：更新極性錯誤（$C_D=${c}$，以 $\sigma_x^2=${s2}$ 正規化）`),
  rule('只減小 μ 不會改變符號', () => T`只減小 $\mu$ 不會改變符號`),
  // C ≈ 0 正是 a + B/C 超出線性範圍的情況（Ch11 §11.4）：顯示時寫成「線性化的 a + B/C」並指到代回檢查，不寫成無條件的「固定點 w* = a + B/C」。
  // 模型字串（polarity.ts）是「…；線性化的固定點 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4 的代回檢查：…）。」；regex 也接受舊的寫法
  // （「固定點 w* = a + B/C …（§11.4）」），兩種都轉成同一句。括號內不可再有「）」；模型那一句要改，必須和這條規則一起改。
  {
    re: new RegExp(T`C ≈ 0：GMAC 沒有平均恢復力（C_D = ${NUM}），w 會隨雜訊漂移；(?:線性化的 ?)?(?:固定點 )?w\* [=≈] a \+ B/C 對任何 bias B 都極度敏感（§11\.4[^）]*）`, 'g'),
    n: 1,
    to: (c) =>
      T`$C\approx0$：GMAC 沒有平均恢復力（$C_D=${c}$），$w$ 會隨雜訊漂移；線性化的 $a+B/C$ 對任何 bias $B$ 都極度敏感，$C\approx0$ 時 $B/C$ 通常已經超出線性範圍，$a+B/C$ 只是線性外推、不是固定點（Ch11 §11.4 的代回檢查）`,
  },
  // analyzePllPolarity：封閉式標籤（MetricRow note）
  rule('σ_x²·Re{H(e^{jΩ₀})e^{jΩ₀D}}', () => T`$\sigma_x^2\operatorname{Re}\{H(e^{j\Omega_0})e^{j\Omega_0D}\}$`),
  rule('h[D]·σ_x²（白色 code；D = 0 時 h[0] = 1 ⇒ C = σ_x²，', () => T`$h[D]\,\sigma_x^2$（白色 code；$D=0$ 時 $h[0]=1\Rightarrow C=\sigma_x^2$，`),
  rule('σ_x²·Σh[k](1 − 6c·t(1 − t))', () => T`$${SAW_SUM}c\,t(1-t)\big)$`),
  rule('σ_x²·Σh[k](1 − 6t(1 − t))', () => T`$${SAW_SUM}t(1-t)\big)$`),
  rule('，c = P²/(P² − 1)、P = #（', (P) => T`，$c=P^2/(P^2-1)$、$P=${P}$（`),
  rule('，c = #（frac ≈ p/#：', (c, q) => T`，$c=${c}$（$\mathrm{frac}\approx p/${q}$：`),
  rule('；t = frac(|k − D|·frac)）', () => T`；$t=\operatorname{frac}(|k-D|\cdot\mathrm{frac})$）`),
  // runPolarityClosedLoop：警告
  rule('（≈ 1/(1 − |pole|) = # samples）', (t) => T`（$\approx1/(1-|\mathrm{pole}|)=${t}$ samples）`),
  rule('（≈ # samples）', (p) => T`（$\approx${p}$ samples）`),
  { re: new RegExp(T`(?<![A-Za-z_])N = ${NUM}`, 'g'), n: 1, to: (n) => T`$N=${n}$` },
  rule('：w 在 ', () => T`：$w$ 在 `),
  rule('e ≈ δ·u', () => T`$e\approx\delta\,u$`),
  rule('請加大 N 或', () => T`請加大 $N$ 或`),
  rule('Ĉ_k', () => T`$\hat C_k$`),
  rule('有限 N ripple', () => T`有限 $N$ ripple`),
  rule('長時間平均的 C。', () => T`長時間平均的 $C$。`),
  rule('C > 0 只保證小訊號（|δ|·u_max ≪ σ_v）', () => T`$C>0$ 只保證小訊號（$|\delta|\,u_{\max}\ll\sigma_v$）`),
  rule('E[G](δ) 在 |δ| > δ_c = # fs 變號', (c) => T`$E[G](\delta)$ 在 $|\delta|>\delta_c=${c}\,\mathrm{fs}$ 變號`),
  rule('對 u 的尖峰', () => T`對 $u$ 的尖峰`),
  rule('δ = 0 只是', () => T`$\delta=0$ 只是`),
  rule('max(|δ₀|, 3σ_w) = # fs', (r) => T`$\max(|\delta_0|,\,3\sigma_w)=${r}\,\mathrm{fs}$`),
  rule('已超過 δ_c', () => T`已超過 $\delta_c$`),
  rule('已接近 δ_c', () => T`已接近 $\delta_c$`),
  rule('遠離 a（', () => T`遠離 $a$（`),
  rule('降低 μ 可縮小 σ_w', () => T`降低 $\mu$ 可縮小 $\sigma_w$`),
  rule('|δ₀| > δ_c 的起始誤差', () => T`$|\delta_0|>\delta_c$ 的起始誤差`),
  rule('|δ₀|·u_rms = # fs', (v) => T`$|\delta_0|\,u_{\mathrm{rms}}=${v}\,\mathrm{fs}$`),
  rule('已接近 σ_v：K_q 小訊號', () => T`已接近 $\sigma_v$：$K_q$ 小訊號`),
  // linearMomentCheck：交叉比對說明
  rule('（|δ₀| = # fs，線性區上限 0.3σ_v/u_max = # fs）：K_q 小訊號', (d, lim) => T`（$|\delta_0|=${d}\,\mathrm{fs}$，線性區上限 $0.3\sigma_v/u_{\max}=${lim}\,\mathrm{fs}$）：$K_q$ 小訊號`),
  rule('k* = #：', (k) => T`$k^*=${k}$：`),
  rule('MC 平均 δ = # fs vs 線性 δ₀∏p_k = # ± #', (m, p, s) => T`MC 平均 $\delta=${m}\,\mathrm{fs}$ vs 線性 $\delta_0\prod_kp_k=${p}\pm${s}$`),
  rule('MC 平均 δ = # fs vs 線性 δ₀p^k = # ± #', (m, p, s) => T`MC 平均 $\delta=${m}\,\mathrm{fs}$ vs 線性 $\delta_0p^k=${p}\pm${s}$`),
  rule('（4σ/√R，', () => T`（$4\sigma/\sqrt R$，`),
  rule('⟨δ²⟩/(m² + v) = #（容許 #–#）', (r, lo, hi) => T`$\langle\delta^2\rangle/(m^2+v)=${r}$（容許 $${lo}$–$${hi}$）`),
  // sweepFcwPolarity
  rule('（frac < #）', (fr) => T`（$\mathrm{frac}<${fr}$）`),
  // 共用：放最後，前面沒處理到的 H_PD
  rule('H_PD', () => T`$H_{\mathrm{PD}}$`),
]

/**
 * 把 polarity.ts 的純文字（警告、交叉比對說明、封閉式標籤）裡的 Unicode 數學換成 `$...$`。
 * 已經在 `$...$` 裡的部分不動；不認得的文字原樣回傳。
 */
export function modelTextTex(text: string): string {
  let out = text
  for (const r of MODEL_TEXT_RULES) {
    out = out
      .split(/(\$[^$]*\$)/)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(r.re, (_m: string, ...g: unknown[]) => r.to(...(g.slice(0, r.n) as string[]).map(numTex)))))
      .join('')
  }
  return out
}
