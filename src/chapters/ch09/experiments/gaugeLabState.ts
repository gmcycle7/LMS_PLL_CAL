import type { GaugeGmacReg, GaugeParams } from '@/simulation/models/pe'

/** 四相 one-hot ＋ global offset 實驗的狀態（presets 與 URL 參數都經過 sanitizeGaugeState）。 */
export interface GaugeLabState {
  b: number
  a0: number
  a1: number
  a2: number
  a3: number
  /** gauge 平移 c：θ' = θ + c·(1, −1, −1, −1, −1) */
  c: number
  /** 只動 b 的平移 d_b */
  dB: number
  /** PLL 是否抑制 DC（H_PD(1) = 0） */
  dcNull: boolean
  pathType: 'type2' | 'type1'
  pllMethod: 'dpll' | 'bilinear'
  wnTs: number
  zeta: number
  hpPole: number
  sequence: 'random' | 'cyclic'
  T: number
  skip: number
  mu: number
  N: number
  blocks: number
  sigmaV: number
  gmacReg: GaugeGmacReg
}

export const GAUGE_DEFAULT: GaugeLabState = {
  b: 0.3,
  a0: 1.0,
  a1: -0.5,
  a2: 0.2,
  a3: 0.7,
  c: 0.9,
  dB: 0.4,
  dcNull: false,
  pathType: 'type2',
  pllMethod: 'dpll',
  wnTs: 0.05,
  zeta: 0.7,
  hpPole: 0.95,
  sequence: 'random',
  T: 20000,
  skip: 2000,
  mu: 0.5,
  N: 64,
  blocks: 150,
  sigmaV: 0.02,
  gmacReg: 'raw',
}

/** LMS demo 的兩組初值（A：全 0；B：沿 null 方向與可辨識方向都有偏移） */
export const W0_A = [0, 0, 0, 0, 0]
export const W0_B = [0.8, -0.3, 0.1, 0.4, -0.2]

export const GAUGE_LIMITS = {
  theta: [-5, 5],
  wnTs: [0.001, 0.3],
  zeta: [0.3, 2],
  hpPole: [0, 0.999],
  T: [2000, 400000],
  skip: [0, 50000],
  mu: [1e-4, 1.5],
  N: [1, 1024],
  blocks: [10, 2000],
  sigmaV: [0, 5],
} as const

function num(v: unknown, lo: number, hi: number, fallback: number, integer = false): number {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  if (!Number.isFinite(x)) return fallback
  const c = Math.min(hi, Math.max(lo, x))
  return integer ? Math.round(c) : c
}

export function sanitizeGaugeState(p: Record<string, unknown>, base: GaugeLabState = GAUGE_DEFAULT): GaugeLabState {
  const L = GAUGE_LIMITS
  return {
    b: num(p.b, L.theta[0], L.theta[1], base.b),
    a0: num(p.a0, L.theta[0], L.theta[1], base.a0),
    a1: num(p.a1, L.theta[0], L.theta[1], base.a1),
    a2: num(p.a2, L.theta[0], L.theta[1], base.a2),
    a3: num(p.a3, L.theta[0], L.theta[1], base.a3),
    c: num(p.c, L.theta[0], L.theta[1], base.c),
    dB: num(p.dB, L.theta[0], L.theta[1], base.dB),
    dcNull: typeof p.dcNull === 'boolean' ? p.dcNull : base.dcNull,
    pathType: p.pathType === 'type1' || p.pathType === 'type2' ? p.pathType : base.pathType,
    pllMethod: p.pllMethod === 'bilinear' || p.pllMethod === 'dpll' ? p.pllMethod : base.pllMethod,
    wnTs: num(p.wnTs, L.wnTs[0], L.wnTs[1], base.wnTs),
    zeta: num(p.zeta, L.zeta[0], L.zeta[1], base.zeta),
    hpPole: num(p.hpPole, L.hpPole[0], L.hpPole[1], base.hpPole),
    sequence: p.sequence === 'cyclic' || p.sequence === 'random' ? p.sequence : base.sequence,
    T: num(p.T, L.T[0], L.T[1], base.T, true),
    skip: num(p.skip, L.skip[0], L.skip[1], base.skip, true),
    mu: num(p.mu, L.mu[0], L.mu[1], base.mu),
    N: num(p.N, L.N[0], L.N[1], base.N, true),
    blocks: num(p.blocks, L.blocks[0], L.blocks[1], base.blocks, true),
    sigmaV: num(p.sigmaV, L.sigmaV[0], L.sigmaV[1], base.sigmaV),
    gmacReg: p.gmacReg === 'filtered' || p.gmacReg === 'raw' ? p.gmacReg : base.gmacReg,
  }
}

/** 狀態 → worker 參數 */
export function toGaugeParams(s: GaugeLabState, seed: number): GaugeParams {
  return {
    b: s.b,
    a: [s.a0, s.a1, s.a2, s.a3],
    c: s.c,
    dB: s.dB,
    path: s.dcNull ? s.pathType : 'none',
    pllMethod: s.pllMethod,
    wnTs: s.wnTs,
    zeta: s.zeta,
    hpPole: s.hpPole,
    sequence: s.sequence,
    T: s.T,
    skip: s.skip,
    mu: s.mu,
    N: s.N,
    blocks: s.blocks,
    sigmaV: s.sigmaV,
    gmacReg: s.gmacReg,
    w0A: W0_A,
    w0B: W0_B,
    seed,
  }
}

/** toPrecision／toExponential 的 '1.23e-5' → TeX 的 1.23\times10^{-5}（放進 `$…$` 時 e 不會被當成變數） */
function sciTex(v: string): string {
  const m = /^(-?[\d.]+)e([+-]?\d+)$/i.exec(v)
  if (!m) return v
  return Number(m[2]) === 0 ? m[1] : String.raw`${m[1]}\times10^{${Number(m[2])}}`
}

/**
 * 模型（pe.ts 的 gaugeAnalysis、pll.ts 的 designDtLoop）回傳的警告是純文字（匯出／報告用，含 Unicode 數學符號）。
 * 顯示在 ExperimentShell 的 warnings 之前，把其中的數學片段換成 `$…$`（docs/teaching-style.md §3）；
 * 認不出來的句子原樣回傳（只是少了 KaTeX，不會出錯）。ch09.test.tsx 以模型實際產生的警告檢查這些樣式仍然對得上。
 */
export function gaugeWarningTex(w: string): string {
  return w
    .replace(/^H\(1\) = (\S+) ≠ 0：此 error path 沒有完全抑制 DC，b 仍部分可觀察。$/, (_, v: string) => String.raw`$H_{\mathrm{PD}}(1)=${sciTex(v)}\ne0$：此 error path 沒有完全抑制 DC，$b$ 仍部分可觀察。`)
    .replace(
      /^暖機不足：skip = (\d+) 時 H_PD 的 step response ũ_b 仍有 (\S+)（尚未 → 0），u-domain 的 R_u、null space 與「只動 b」的比較仍含暫態；請加大 skip（穩態下 b 完全不可觀察）。$/,
      (_, skip: string, tail: string) =>
        String.raw`暖機不足：skip $=${skip}$ 時 $H_{\mathrm{PD}}$ 的 step response $\tilde u_b$ 仍有 $${sciTex(tail)}$（尚未 $\to0$），u-domain 的 $\mathbf R_u$、null space 與「只動 $b$」的比較仍含暫態；請加大 skip（穩態下 $b$ 完全不可觀察）。`,
    )
    .replace(/^LMS demo 長度上限：blocks·N 不超過 (\d+) samples，blocks 自動降為 (\d+)。$/, (_, max: string, blocks: string) => String.raw`LMS demo 長度上限：$\text{blocks}\cdot N$ 不超過 $${max}$ samples，blocks 自動降為 $${blocks}$。`)
    .replace(
      /^主 PLL 線性化模型不穩定：closed-loop pole 半徑 (\S+) ≥ 1（ω_nT_s = (\S+)、d = (\d+)）。/,
      (_, rho: string, wn: string, d: string) => String.raw`主 PLL 線性化模型不穩定：closed-loop pole 半徑 $${sciTex(rho)}\ge1$（$\omega_nT_s=${sciTex(wn)}$、$d=${d}$）。`,
    )
    .replace(
      /^ω_nT_s = (\S+) 不夠小：DT 迴路與 CT 原型的對應（K_p = 2ζω_nT_s、K_i = \(ω_nT_s\)²）明顯失準/,
      (_, wn: string) => String.raw`$\omega_nT_s=${sciTex(wn)}$ 不夠小：DT 迴路與 CT 原型的對應（$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$）明顯失準`,
    )
}

/**
 * error path 的說明（GaugeResult.tf.description，純文字）→ 含 `$…$` 的版本，給狀態列用 mathText 顯示。
 * 三種：H = 1、type-I 的 (1 − z⁻¹)/(1 − r z⁻¹)、type-II DPLL（ω_nT_s、ζ、離散化方法）。
 */
export function gaugeTfTex(description: string): string {
  return description
    .replace(/^H = 1（/, String.raw`$H=1$（`)
    .replace(/^H\(z\) = \(1 − z⁻¹\)\/\(1 − (\S+?)z⁻¹\)（type-I DPLL 的 1\/\(1\+L\)）$/, (_, r: string) => String.raw`$H(z)=\dfrac{1-z^{-1}}{1-${r}\,z^{-1}}$（type-I DPLL 的 $1/(1+L)$）`)
    .replace(/^type-II DPLL H_PD（ω_nT_s = (\S+?)、ζ = (\S+?)、/, (_, wn: string, zeta: string) => String.raw`type-II DPLL $H_{\mathrm{PD}}$（$\omega_nT_s=${sciTex(wn)}$、$\zeta=${zeta}$、`)
}
