import { comparatorKq, eig2x2, modalCoords, type Detector, type PeLabParams, type PeLabResult, type RegressorDist } from '@/simulation/models/pe'

/**
 * PE / Eigen Lab 的參數狀態（presets 與 URL ?preset= 都經過 sanitizePeState）。
 * K_q 正規化（勘誤 E05 / E08）：
 *   linear detector：K_q ≡ 1，μ 無因次，g = μ；
 *   sign detector + 'normalized'：滑桿直接是 g = μK_q（無因次），μ = g/K_q [fs]；
 *   sign detector + 'physical'  ：滑桿是 μ [fs]，g = μK_q。
 */
export type KqMode = 'normalized' | 'physical'

export interface PeLabState {
  rho: number
  dist: RegressorDist
  detector: Detector
  /** linear：加性雜訊 std（與 δ 同單位）；sign：comparator 前雜訊 [fs] */
  sigmaV: number
  kqMode: KqMode
  /** normalized：g；physical：μ（linear 時永遠是無因次 μ = g） */
  muInput: number
  N: number
  N0: number
  d10: number
  d20: number
  blocks: number
  chains: number
}

export const PE_DEFAULT: PeLabState = {
  rho: 0.99,
  dist: 'gaussian',
  detector: 'linear',
  sigmaV: 0,
  kqMode: 'normalized',
  muInput: 0.5,
  N: 16,
  N0: 100,
  d10: 1,
  d20: 0,
  blocks: 800,
  chains: 64,
}

export const PE_LIMITS = {
  rho: [-1, 1],
  sigmaV: [0, 1000],
  g: [1e-5, 2.5],
  muPhys: [1e-4, 1e4],
  N: [1, 4096],
  N0: [2, 20000],
  d0: [-1000, 1000],
  blocks: [10, 3000],
  chains: [2, 400],
} as const

function clampNum(v: unknown, lo: number, hi: number, fallback: number, integer = false): number {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  if (!Number.isFinite(x)) return fallback
  const c = Math.min(hi, Math.max(lo, x))
  return integer ? Math.round(c) : c
}

/** 把任意（preset / URL）參數轉成合法狀態；未知欄位忽略、缺漏欄位用 base。 */
export function sanitizePeState(p: Record<string, unknown>, base: PeLabState = PE_DEFAULT): PeLabState {
  const dist: RegressorDist = p.dist === 'pm1' || p.dist === 'gaussian' ? p.dist : base.dist
  const detector: Detector = p.detector === 'sign' || p.detector === 'linear' ? p.detector : base.detector
  const kqMode: KqMode = p.kqMode === 'physical' || p.kqMode === 'normalized' ? p.kqMode : base.kqMode
  const muRange = detector === 'sign' && kqMode === 'physical' ? PE_LIMITS.muPhys : PE_LIMITS.g
  return {
    rho: clampNum(p.rho, PE_LIMITS.rho[0], PE_LIMITS.rho[1], base.rho),
    dist,
    detector,
    sigmaV: clampNum(p.sigmaV, PE_LIMITS.sigmaV[0], PE_LIMITS.sigmaV[1], base.sigmaV),
    kqMode,
    muInput: clampNum(p.muInput, muRange[0], muRange[1], Math.min(muRange[1], Math.max(muRange[0], base.muInput))),
    N: clampNum(p.N, PE_LIMITS.N[0], PE_LIMITS.N[1], base.N, true),
    N0: clampNum(p.N0, PE_LIMITS.N0[0], PE_LIMITS.N0[1], base.N0, true),
    d10: clampNum(p.d10, PE_LIMITS.d0[0], PE_LIMITS.d0[1], base.d10),
    d20: clampNum(p.d20, PE_LIMITS.d0[0], PE_LIMITS.d0[1], base.d20),
    blocks: clampNum(p.blocks, PE_LIMITS.blocks[0], PE_LIMITS.blocks[1], base.blocks, true),
    chains: clampNum(p.chains, PE_LIMITS.chains[0], PE_LIMITS.chains[1], base.chains, true),
  }
}

export interface DerivedGain {
  /** K_q（linear ≡ 1；sign = √(2/π)/σ_v，σ_v = 0 時 ∞） */
  Kq: number
  /** 實際 μ（linear 無因次；sign 為 fs） */
  mu: number
  /** g = μK_q */
  g: number
  muUnit: string
  /** K_q 的單位（純文字，給匯出的 units 欄位用） */
  kqUnit: string
  /** K_q 的單位（含 `$…$`，給畫面上的 MetricRow.unit 用；docs/teaching-style.md §3） */
  kqUnitTex: string
}

const KQ_UNIT_TEX = String.raw`$\mathrm{fs}^{-1}$`

/** 由狀態推出 K_q、μ、g（見檔頭）。 */
export function derivedGain(s: PeLabState): DerivedGain {
  if (s.detector === 'linear') return { Kq: 1, mu: s.muInput, g: s.muInput, muUnit: '—', kqUnit: '—', kqUnitTex: '—' }
  const Kq = comparatorKq(s.sigmaV)
  if (s.kqMode === 'normalized') {
    const g = s.muInput
    return { Kq, mu: Number.isFinite(Kq) ? g / Kq : 0, g, muUnit: 'fs', kqUnit: 'fs⁻¹', kqUnitTex: KQ_UNIT_TEX }
  }
  const mu = s.muInput
  return { Kq, mu, g: Number.isFinite(Kq) ? mu * Kq : Infinity, muUnit: 'fs', kqUnit: 'fs⁻¹', kqUnitTex: KQ_UNIT_TEX }
}

/** 切換 K_q 模式時保持 g 不變（換算 muInput）。 */
export function switchKqMode(s: PeLabState, next: KqMode): PeLabState {
  if (s.kqMode === next || s.detector === 'linear') return { ...s, kqMode: next }
  const { Kq, g, mu } = derivedGain(s)
  if (!Number.isFinite(Kq)) return { ...s, kqMode: next }
  const muInput = next === 'physical' ? mu : g
  const range = next === 'physical' ? PE_LIMITS.muPhys : PE_LIMITS.g
  return { ...s, kqMode: next, muInput: Math.min(range[1], Math.max(range[0], muInput)) }
}

/** 切換偵測器：改成 sign 時若 σ_v = 0 自動設為 100 fs（否則 K_q = ∞），並保持 g。 */
export function switchDetector(s: PeLabState, next: Detector): PeLabState {
  if (s.detector === next) return s
  if (next === 'sign') {
    const g = derivedGain(s).g
    const sigmaV = s.sigmaV > 0 ? s.sigmaV : 100
    const Kq = comparatorKq(sigmaV)
    const muInput = s.kqMode === 'physical' ? Math.min(PE_LIMITS.muPhys[1], Math.max(PE_LIMITS.muPhys[0], g / Kq)) : g
    return { ...s, detector: next, sigmaV, muInput }
  }
  // 回到 linear：σ_v 的意義改成「與 δ 同單位的加性雜訊」，重設為 0 以免把 100 fs 誤當成無因次雜訊
  const g = derivedGain(s).g
  return {
    ...s,
    detector: next,
    sigmaV: 0,
    muInput: Number.isFinite(g) ? Math.min(PE_LIMITS.g[1], Math.max(PE_LIMITS.g[0], g)) : PE_DEFAULT.muInput,
  }
}

/**
 * 「執行至收斂」要用的 blocks 數：涵蓋慢模式 95% 衰減再多 25%（⌈1.25·k₉₅⌉），並夾在合法範圍內。
 * k₉₅ = ∞（λ_min = 0 或 |p| ≥ 1）時永遠到不了 ⇒ 回傳上限，reachable = false（頁面的警告會解釋原因）。
 */
export function blocksForConvergence(k95: number): { blocks: number; reachable: boolean } {
  const [lo, hi] = PE_LIMITS.blocks
  if (!Number.isFinite(k95)) return { blocks: hi, reachable: false }
  const want = Math.ceil(1.25 * k95)
  return { blocks: Math.min(hi, Math.max(lo, want)), reachable: k95 <= hi }
}

export interface McModalCheck {
  /** 比較的 block index（min(blocks, 50)） */
  kc: number
  /** 參考值的模態座標（linear：精確平均遞迴；sign：Bussgang mean-field） */
  ref: number[]
  /** |MC − ref|/SE（快、慢模式）；差值低於浮點地板時記為 0 */
  z: number[]
  ok: boolean
}

/**
 * MC 交叉比對（純函數，頁面與測試共用）：k_c = min(blocks, 50) 處 ensemble 模態平均 vs 參考軌跡。
 * 低於 1e-10·‖δ₀‖ 的差視為浮點捨入（例：±1 code、g = .5 時快模式被精確投影成 0，MC 只剩 1e-17 的捨入，
 * 除以同樣是捨入量級的 SE 會得到假的 z = 7）。
 */
export function mcModalCheck(r: PeLabResult, p: PeLabParams): McModalCheck {
  const kc = Math.min(r.blocksUsed, 50)
  const Q = eig2x2(1, p.rho, 1).vectors
  const ref = modalCoords(Q, [r.refD1[kc], r.refD2[kc]])
  const floor = 1e-10 * Math.max(Math.hypot(p.delta0[0], p.delta0[1]), 1e-300)
  const z = [0, 1].map((i) => {
    const diff = Math.abs(r.cMean[i][kc] - ref[i])
    const se = r.cSe[i][kc]
    if (!Number.isFinite(diff)) return Infinity
    if (diff <= floor) return 0
    if (!(se > 0)) return Infinity
    return diff / se
  })
  return { kc, ref, z, ok: z.every((v) => v <= 4) && r.divergedChains === 0 }
}
