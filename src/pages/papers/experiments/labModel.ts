/**
 * 「文獻寫法換算器」實驗的純計算（無 React）：參數驗證、分析、警告文字、presets。
 * 計算核心都在 ../bridge.ts；這裡只把它們組合成實驗需要的結果。
 */
import {
  CONVENTIONS,
  corr2Eigs,
  countedStepsToDecay,
  criticalGain,
  criticalGainNumeric,
  delaySpectralRadius,
  delayedTrajectory,
  gainScale,
  muForScale,
  nlmsPosteriorFactor,
  pmWithDelayDeg,
  stepsToDecay,
  type Convention,
} from '../bridge'

export const EXPERIMENT_ID = 'papers-convention-bridge'

export interface LabParams {
  convention: Convention
  /** 書上（該寫法）的步長；signBlock 為 μ [fs] */
  mu: number
  /** regressor 功率 P_x（R = P_x[[1, ρ], [ρ, 1]]） */
  Px: number
  /** 兩個參數 regressor 的相關係數 */
  rho: number
  /** NLMS regularizer */
  epsReg: number
  /** signBlock：σ_v [fs] */
  sigmaV: number
  /** signBlock：GMAC 長度 */
  N: number
  /** signBlock：sum 模式（反面測試） */
  sumMode: boolean
  /** +1 正確、−1 極性接反 */
  polarity: 1 | -1
  /** 更新延遲 d [blocks] */
  d: number
  /** 軌跡長度 */
  steps: number
}

export const DEFAULT_PARAMS: LabParams = {
  convention: 'widrow',
  mu: 0.25,
  Px: 1,
  rho: 0.99,
  epsReg: 0,
  sigmaV: 100,
  N: 4096,
  sumMode: false,
  polarity: 1,
  d: 0,
  steps: 800,
}

/** 參數合法範圍（UI 與 parse 共用） */
export const RANGES = {
  mu: [1e-6, 1e4],
  Px: [1e-6, 1e3],
  rho: [-1, 1],
  epsReg: [0, 1e3],
  sigmaV: [1e-3, 1e4],
  N: [1, 1 << 20],
  d: [0, 6],
  steps: [10, 5000],
} as const

function inRange(v: unknown, [lo, hi]: readonly [number, number]): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
}

/** 從 preset / URL 讀參數：型別或範圍不對的欄位一律忽略（保留 base 的值）。 */
export function parseLabParams(raw: Record<string, unknown>, base: LabParams = DEFAULT_PARAMS): LabParams {
  const p: LabParams = { ...base }
  if (typeof raw.convention === 'string' && (CONVENTIONS as readonly string[]).includes(raw.convention)) p.convention = raw.convention as Convention
  if (inRange(raw.mu, RANGES.mu)) p.mu = raw.mu
  if (inRange(raw.Px, RANGES.Px)) p.Px = raw.Px
  if (inRange(raw.rho, RANGES.rho)) p.rho = raw.rho
  if (inRange(raw.epsReg, RANGES.epsReg)) p.epsReg = raw.epsReg
  if (inRange(raw.sigmaV, RANGES.sigmaV)) p.sigmaV = raw.sigmaV
  if (inRange(raw.N, RANGES.N) && Number.isInteger(raw.N)) p.N = raw.N
  if (typeof raw.sumMode === 'boolean') p.sumMode = raw.sumMode
  if (raw.polarity === 1 || raw.polarity === -1) p.polarity = raw.polarity
  if (inRange(raw.d, RANGES.d) && Number.isInteger(raw.d)) p.d = raw.d
  if (inRange(raw.steps, RANGES.steps) && Number.isInteger(raw.steps)) p.steps = raw.steps
  return p
}

export interface LocalPreset {
  name: string
  description: string
  params: Partial<LabParams>
}

/**
 * 本頁內建 presets（src/data/presets 不屬於本頁，見回報）。
 * name 顯示在 <option>、description 顯示在 title 屬性：兩者都不能放 KaTeX，所以保留純文字符號。
 */
export const LOCAL_PRESETS: LocalPreset[] = [
  {
    name: 'T11：Widrow 型 μ_W = 0.25、ρ = 0.99',
    description: '換成本站 ½e² 型是 μ = 0.5（K_q 正規化為 1）：慢模式 pole 0.995、約 598 步',
    params: { convention: 'widrow', mu: 0.25, Px: 1, rho: 0.99, d: 0, polarity: 1, steps: 800 },
  },
  {
    name: 'T13：block sign-GMAC μ = 10 fs、σ_v = 100 fs',
    description: 'average 模式、unit-RMS code、identity path（C = 1）：g ≈ 0.0798、p ≈ 0.92021',
    params: { convention: 'signBlock', mu: 10, sigmaV: 100, N: 4096, sumMode: false, Px: 1, rho: 0, d: 0, polarity: 1, steps: 200 },
  },
  {
    name: '反面：GMAC sum 模式忘記 /N',
    description: '同 T13 但 GMAC 輸出總和：g 乘上 N = 4096，pole 遠在單位圓外',
    params: { convention: 'signBlock', mu: 10, sigmaV: 100, N: 4096, sumMode: true, Px: 1, rho: 0, d: 0, polarity: 1, steps: 50 },
  },
  {
    name: '反面：comparator 極性接反',
    description: '同 T13 但極性接反：pole = 1 + μK_q > 1，減小 μ 也救不回來',
    params: { convention: 'signBlock', mu: 10, sigmaV: 100, N: 4096, sumMode: false, Px: 1, rho: 0, d: 0, polarity: -1, steps: 200 },
  },
  {
    name: '延遲 d = 2、g = 0.7：極性正確仍發散',
    description: '½e² 型 μ = 0.7、P_x = 1、ρ = 0：g = 0.7 > g*(2) ≈ 0.618',
    params: { convention: 'half', mu: 0.7, Px: 1, rho: 0, d: 2, polarity: 1, steps: 300 },
  },
  {
    name: 'NLMS μ̃ = 1、ρ = 0.5',
    description: 'ε_reg = 0、tr R = 2：等效 s ≈ 0.5（近似）',
    params: { convention: 'nlms', mu: 1, epsReg: 0, Px: 1, rho: 0.5, d: 0, polarity: 1, steps: 200 },
  },
  {
    name: '反面：ρ = 1（λ_min = 0）',
    description: '兩個 regressor 完全相關：一個方向不可辨識',
    params: { convention: 'half', mu: 0.5, Px: 1, rho: 1, d: 0, polarity: 1, steps: 300 },
  },
]

export const STEP_UNIT: Record<Convention, string> = { half: '—', widrow: '—', nlms: '—', signBlock: 'fs' }

export interface LabResult {
  s: number
  lmax: number
  lmin: number
  traceR: number
  gFast: number
  gSlow: number
  radiusFast: number
  radiusSlow: number
  gStar: number
  gStarNumeric: number
  /** 此寫法下的步長上限（快模式 g = g*(d)）；極性錯或 λ_max = 0 時為 NaN */
  muBookMax: number
  stepsSlow: number
  stepsFast: number
  /**
   * 逐 step 數出來的 95% 衰減步數（bridge.ts 的 countedStepsToDecay；d = 0 時與 stepsSlow／stepsFast 相同）。
   * 不衰減時為 ∞；極慢的 mode 沒有在步數上限內數完時為 NaN（畫面上就不列）。
   */
  countedSlow: number
  countedFast: number
  pmFast: number
  /** 與目前設定有相同 s 的四種寫法步長 */
  equivalents: Record<Convention, number>
  /** 四種寫法各自的步長上限（平均模型：快模式 g = g*(d)） */
  bounds: Record<Convention, number>
  /**
   * NLMS 的單筆（a posteriori）收縮界限 2(ε_reg + ‖x‖²)/‖x‖²（以 ‖x‖² = tr R 計）。
   * 平均模型把 ‖x‖² 換成 tr R 之後得到的界限 g*(d)(ε_reg + tr R)/λ_max 比它寬（tr R ≥ λ_max）：
   * 超過這個值時 E[δ] 在平均模型裡仍收斂，但每一筆的誤差都被修正過頭，‖δ‖ 不會收斂。
   */
  nlmsPostBound: number
  /** 畫面顯示的步長上限：NLMS 取 bounds.nlms 與 nlmsPostBound 較小者，其餘同 bounds */
  boundsShown: Record<Convention, number>
  /** NLMS 的顯示上限是否由 a posteriori 界限決定（比平均模型界限嚴） */
  nlmsCapped: boolean
  nlmsPostFactor: number
  warnings: string[]
  trajFast: Float64Array
  trajSlow: Float64Array
}

/** 數字 → TeX（放進警告字串的 `$…$` 內）：科學記號寫成 a\times10^{b}，無限大寫成 \infty。 */
export function tex(x: number, d = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{NaN}`
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : String.raw`-\infty`
  const s = String(Number(x.toPrecision(d)))
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
}

const R = String.raw

export function analyzeLab(p: LabParams): LabResult {
  const { lmax, lmin } = corr2Eigs(p.Px, p.rho)
  const traceR = 2 * p.Px
  const ctx = { traceR, epsReg: p.epsReg, sigmaV: p.sigmaV, N: p.N, sumMode: p.sumMode }
  const s = gainScale({ ...ctx, convention: p.convention, mu: p.mu, polarity: p.polarity })
  const gFast = s * lmax
  const gSlow = s * lmin
  const radiusFast = delaySpectralRadius(gFast, p.d)
  const radiusSlow = delaySpectralRadius(gSlow, p.d)
  const gStar = criticalGain(p.d)
  const gStarNumeric = criticalGainNumeric(p.d)
  const equivalents = {} as Record<Convention, number>
  const bounds = {} as Record<Convention, number>
  for (const c of CONVENTIONS) {
    equivalents[c] = muForScale(Math.abs(s), c, ctx)
    bounds[c] = lmax > 0 ? muForScale(gStar / lmax, c, ctx) : Number.NaN
  }
  // NLMS：|a posteriori 收縮因子| < 1 ⇔ μ̃ < 2(ε_reg + ‖x‖²)/‖x‖²（‖x‖² 以 tr R 計）；比平均模型的界限嚴
  const nlmsPostBound = (2 * (p.epsReg + traceR)) / traceR
  const nlmsCapped = bounds.nlms > nlmsPostBound
  const boundsShown = { ...bounds, nlms: Math.min(bounds.nlms, nlmsPostBound) }
  const muBookMax = p.polarity > 0 && lmax > 0 ? boundsShown[p.convention] : Number.NaN
  const nlmsPostFactor = nlmsPosteriorFactor(p.mu, p.epsReg, traceR)

  // 警告文字：字串中的 `$…$` 由 ExperimentShell 以 KaTeX 顯示（docs/teaching-style.md §3）
  const warnings: string[] = []
  if (p.polarity < 0) {
    warnings.push(
      R`$C\le 0$：更新極性錯誤（極性接反，$s=${tex(s)}<0$）。$g<0$ 的 mode 一定有一個大於 $1$ 的實根（$d=0$ 時 pole $=1+|g|$），任何正的步長都會使平均誤差發散；把 $\mu$ 調小只會發散得比較慢，不會改變符號。請檢查 comparator 的 $0/1\to\pm1$ 映射與 GMAC 的乘號（Ch06）。`,
    )
  }
  if (lmin === 0) {
    warnings.push(
      R`$\lambda_{\min}=0$（$|\rho|=1$）：不可辨識。兩個參數的 regressor 完全相關，有一個方向的誤差 GMAC 完全看不到；該 mode 的 pole $=1$，誤差永遠停在初值（缺乏 persistent excitation，Ch09）。`,
    )
  }
  if (p.polarity > 0 && radiusFast >= 1) {
    warnings.push(
      p.d === 0
        ? R`$g_{\max}=s\,\lambda_{\max}=${tex(gFast)}\ge 2$：超過一階更新的界限 $0<g<2$（快模式 pole $=${tex(1 - gFast)}$ 在單位圓外），即使極性正確也會震盪發散。`
        : R`$g_{\max}=s\,\lambda_{\max}=${tex(gFast)}\ge g^*(${p.d})=${tex(gStar)}$：更新延遲 $d=${p.d}$ 把穩定界限從 $2$ 縮到 $${tex(gStar)}$；即使極性正確（$C>0$）也會震盪發散（Ch08）。`,
    )
  }
  if (p.convention === 'signBlock' && p.sumMode) {
    warnings.push(
      R`GMAC 輸出總和（sum）卻沿用 average 模式的 $\mu$：loop gain 被乘上 $N=${p.N}$（勘誤 E13 的反面測試）；請把 $\mu$ 除以 $N$，或把 GMAC 改回 average。`,
    )
  }
  if (p.convention === 'nlms' && Math.abs(nlmsPostFactor) >= 1) {
    warnings.push(
      R`NLMS：$\tilde\mu=${tex(p.mu)}$ 使 a posteriori 收縮因子 $1-\tilde\mu\|\mathbf x\|^2/(\epsilon_{\mathrm{reg}}+\|\mathbf x\|^2)=${tex(nlmsPostFactor)}$（以 $\|\mathbf x\|^2=\mathrm{tr}\,\mathbf R$ 計），絕對值 $\ge 1$，單筆誤差不再收縮；需 $0<\tilde\mu<2(\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R)/\mathrm{tr}\,\mathbf R=${tex(nlmsPostBound)}$。${
        p.polarity > 0 && radiusFast < 1
          ? R`注意：下方「把 $\|\mathbf x\|^2$ 換成 $\mathrm{tr}\,\mathbf R$」的平均模型仍顯示收斂（$|z|_{\max}=${tex(radiusFast)}<1$），那只代表 $E[\boldsymbol\delta]$ 收斂；每一筆都修正過頭時 $\|\boldsymbol\delta\|$ 不會收斂（和 mean 與 mean-square 的差別同一類）。`
          : ''
      }`,
    )
  }

  return {
    s,
    lmax,
    lmin,
    traceR,
    gFast,
    gSlow,
    radiusFast,
    radiusSlow,
    gStar,
    gStarNumeric,
    muBookMax,
    stepsSlow: stepsToDecay(radiusSlow),
    stepsFast: stepsToDecay(radiusFast),
    countedSlow: countedStepsToDecay(gSlow, p.d),
    countedFast: countedStepsToDecay(gFast, p.d),
    pmFast: pmWithDelayDeg(gFast, p.d),
    equivalents,
    bounds,
    nlmsPostBound,
    boundsShown,
    nlmsCapped,
    nlmsPostFactor,
    warnings,
    trajFast: delayedTrajectory(gFast, p.d, p.steps),
    trajSlow: delayedTrajectory(gSlow, p.d, p.steps),
  }
}

/** spectral radius 對 g 的曲線（log 格點），給「穩定區」圖使用 */
export function radiusCurve(d: number, points = 240, gMin = 1e-3, gMax = 3): { g: Float64Array; rD: Float64Array; r0: Float64Array } {
  const g = new Float64Array(points)
  const rD = new Float64Array(points)
  const r0 = new Float64Array(points)
  const a = Math.log10(gMin)
  const b = Math.log10(gMax)
  for (let i = 0; i < points; i++) {
    g[i] = 10 ** (a + ((b - a) * i) / (points - 1))
    rD[i] = delaySpectralRadius(g[i], d)
    r0[i] = delaySpectralRadius(g[i], 0)
  }
  return { g, rD, r0 }
}

/**
 * 解析交叉比對：(1) g*(d) 封閉式 vs 不用封閉式的數值求根；(2) d = 0 時遞迴軌跡必須等於 (1 − g)^k。
 * 軌跡因超過 1e12 而提前停止（發散）時，只比較停止前的部分。
 */
export function crossCheckLab(p: LabParams, res: LabResult): { ok: boolean; note: string } {
  const gOk = Math.abs(res.gStar - res.gStarNumeric) < 1e-8
  if (!gOk) return { ok: false, note: R`$g^*(d)$ 封閉式 $${tex(res.gStar, 10)}$ 與數值求根 $${tex(res.gStarNumeric, 10)}$ 不一致` }
  if (p.d !== 0) return { ok: true, note: R`$g^*(d)$ 封閉式與數值求根一致（差 $<10^{-8}$）` }
  for (const [g, tr] of [
    [res.gFast, res.trajFast],
    [res.gSlow, res.trajSlow],
  ] as const) {
    for (let k = 0; k <= Math.min(10, p.steps); k++) {
      if (!Number.isFinite(tr[k])) break
      const expect = (1 - g) ** k
      if (Math.abs(tr[k] - expect) > 1e-9 * Math.max(1, Math.abs(expect))) {
        return { ok: false, note: R`$d=0$ 的遞迴軌跡在 $k=${k}$ 與 $(1-g)^k$ 不一致` }
      }
    }
  }
  return { ok: true, note: R`$g^*(d)$ 封閉式與數值求根一致；$d=0$ 時遞迴軌跡等於 $(1-g)^k$` }
}
