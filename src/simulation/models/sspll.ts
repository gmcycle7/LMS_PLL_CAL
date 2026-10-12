/**
 * SSPLL / CPPLL 的 GOS–PHOS 極性模型。
 *
 * 這個檔案是 `analysis/sspll/golden/sspll_golden/*.py`（Python golden model）的 TypeScript port，
 * 給案例頁 `/case/sspll` 即時計算使用；`sspll.test.ts` 逐項與 `src/data/sspll/*.json`、
 * `analysis/sspll/golden/results/doc_numbers.json` 比對。
 *
 * 約定（與 golden 完全相同）：
 *   - 時間以 T_ref 為單位（f_ref = 4 GHz、T_ref = 250 ps）；頻率 f 對 f_ref 正規化（cycles/sample），
 *     Ω = 2πf，z⁻¹ = e^{−jΩ}。
 *   - L(z) = bL(z⁻¹)/aL(z⁻¹) 為開迴路增益，嚴格 proper（至少 1 拍延遲），所以 h_PD[0] = 1。
 *   - 架構（docs/assumptions.md §2a 第 6 點）：input DTC 在 reference 端（Reference → DTC → SSPD），8 相 PMUX 在回授路徑
 *     （VCO → PMUX → SSPD）；1-bit 比較器取的是 PD 的輸出 e_PD，也就是送進 loop filter 的同一個節點。
 *   - H_PD = 1/(1+L)：比較點注入的誤差 → PD 殘差；T = L/(1+L)：|T| 的 −3 dB 是 320 MHz 的設計目標。
 *     「比較點」= PD 的輸入端：外加誤差 u（該補的量減掉 DTC 實際的補償量）折算到 PD 的 reference 輸入端，
 *     迴路的修正 y = L·e_PD 從 feedback 輸入端回來，e_PD = u − y ⇒ e_PD = +H_PD·u（正號）。
 *   - regressor：index 0 = GOS 的 ρ[n]，index 1+k = PHOS 的 one-hot 1{p[n] = k}。
 *   - C_ij = ⟨r_i (h_PD * x_j)⟩ = Σ_ν conj(c^i_ν) c^j_ν Γ_eff(f_ν)，Γ_eff = H_PD · conj(G)。
 *   - 極性：H_PD ≡ 1 時 w ← w + μ q r 為正確方向；δ = 真值 − 估計。
 *
 * 不 import React / DOM；worker 可呼叫的函式（runSspllLms、runSspllLmsCompare）只收可 structured clone 的參數。
 */
import { cAbs, cConj, cMul, type Complex } from '@/simulation/core/complex'
import { eigSym, eigvals, type Matrix } from '@/simulation/core/linalg'
import { polyRoots } from '@/simulation/core/poly'
import { createRng } from '@/simulation/core/rng'
import { erf } from '@/simulation/core/special'
import { fft, ifft } from '@/simulation/signal/fft'

/** reference 頻率 [Hz] */
export const F_REF = 4e9
/** 閉迴路 |T| 的 −3 dB 目標 [Hz] */
export const BW = 320e6
/** PMUX 相位數 */
export const NPH = 8
/** regressor 個數：1（GOS）+ 8（PHOS） */
export const NREG = 1 + NPH
const TWO_PI = 2 * Math.PI

// ─────────────────────────────────────────────────────────────────────────────
// 多項式小工具：係數 c[k] 乘上 z^-k（升冪）
// ─────────────────────────────────────────────────────────────────────────────

function padd(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length)
  const out = new Array<number>(n).fill(0)
  for (let i = 0; i < a.length; i++) out[i] += a[i]
  for (let i = 0; i < b.length; i++) out[i] += b[i]
  return out
}

function pconv(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  return out
}

function pscale(a: number[], s: number): number[] {
  return a.map((v) => v * s)
}

/** 在單位圓上（z⁻¹ = e^{−j2πf}）求 b(z⁻¹)/a(z⁻¹)，Horner 法 */
function ratioAt(b: number[], a: number[], f: number): Complex {
  const w = TWO_PI * f
  const zr = Math.cos(w)
  const zi = -Math.sin(w)
  let br = 0
  let bi = 0
  for (let k = b.length - 1; k >= 0; k--) {
    const t = br * zr - bi * zi + b[k]
    bi = br * zi + bi * zr
    br = t
  }
  let ar = 0
  let ai = 0
  for (let k = a.length - 1; k >= 0; k--) {
    const t = ar * zr - ai * zi + a[k]
    ai = ar * zi + ai * zr
    ar = t
  }
  const d = ar * ar + ai * ai
  return { re: (br * ar + bi * ai) / d, im: (bi * ar - br * ai) / d }
}

const frac = (x: number): number => x - Math.floor(x)

function linspace(lo: number, hi: number, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1)
  return out
}

/** 等比格點（不含終點），與 np.geomspace(lo, hi, n, endpoint=False) 相同 */
function geomspaceOpen(lo: number, hi: number, n: number): Float64Array {
  const out = new Float64Array(n)
  const l0 = Math.log(lo)
  const l1 = Math.log(hi)
  for (let i = 0; i < n; i++) out[i] = Math.exp(l0 + ((l1 - l0) * i) / n)
  return out
}

function concat(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** 二分法求根（端點需異號）；收斂到浮點解析度 */
function bisect(fn: (x: number) => number, lo: number, hi: number): number {
  let flo = fn(lo)
  const fhi = fn(hi)
  if (flo === 0) return lo
  if (fhi === 0) return hi
  if (!(flo * fhi < 0)) throw new Error(`bisect：端點同號（f(${lo}) = ${flo}，f(${hi}) = ${fhi}）`)
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi) return mid
    const fm = fn(mid)
    if (fm === 0) return mid
    if (fm * flo < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return 0.5 * (lo + hi)
}

/** 黃金分割搜尋單峰函數在 [a, b] 的最小值位置 */
function goldenMin(fn: (x: number) => number, a: number, b: number): { x: number; f: number } {
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = fn(c)
  let fd = fn(d)
  for (let it = 0; it < 120 && b - a > 1e-13; it++) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = fn(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = fn(d)
    }
  }
  return fc < fd ? { x: c, f: fc } : { x: d, f: fd }
}

// ─────────────────────────────────────────────────────────────────────────────
// 迴路模型
// ─────────────────────────────────────────────────────────────────────────────

export type LoopParams = Record<string, number | string | boolean | null>

/** 取樣資料迴路：L(z) = bL/aL（z⁻¹ 升冪）；H_PD = aL/(aL+bL)；T = bL/(aL+bL)。純資料，可 structured clone。 */
export interface SspllLoop {
  name: string
  /** 迴路型態：積分器個數（1 或 2） */
  type: 1 | 2
  bL: number[]
  aL: number[]
  /** H_PD 的分子（= aL） */
  bH: number[]
  /** H_PD 的分母（= aL + bL） */
  aH: number[]
  params: LoopParams
}

export function makeLoop(name: string, bL: number[], aL: number[], type: 1 | 2, params: LoopParams = {}): SspllLoop {
  const mx = Math.max(1, ...bL.map((v) => Math.abs(v)))
  if (Math.abs(bL[0]) > 1e-14 * mx) throw new Error('L(z) 必須嚴格 proper（至少 1 拍延遲）：bL[0] 必須為 0，否則 h_PD[0] ≠ 1')
  return { name, type, bL: [...bL], aL: [...aL], bH: [...aL], aH: padd(aL, bL), params: { ...params } }
}

// #region core:hpd
/** 開迴路增益 L(e^{j2πf})；f 對 f_ref 正規化（cycles/sample）。f = 0 時為 ∞（積分器）。 */
export function loopL(loop: SspllLoop, f: number): Complex {
  return ratioAt(loop.bL, loop.aL, f)
}

/** 誤差轉移 H_PD = 1/(1 + L) = aL/(aL + bL)：DTC／PMUX 誤差（相位比較點）→ PD 殘差 */
export function loopH(loop: SspllLoop, f: number): Complex {
  return ratioAt(loop.bH, loop.aH, f)
}

/** 閉迴路 T = L/(1 + L) = bL/(aL + bL)；它的 −3 dB 就是「320 MHz」那一個頻寬 */
export function loopT(loop: SspllLoop, f: number): Complex {
  return ratioAt(loop.bL, loop.aH, f)
}
// #endregion core:hpd

/** H_PD 的脈衝響應 h_PD[0..n−1]（h_PD[0] = 1） */
export function loopImpulse(loop: SspllLoop, n: number): Float64Array {
  const x = new Float64Array(n)
  if (n > 0) x[0] = 1
  return iirFilter(loop.bH, loop.aH, x)
}

/** H_PD 的步階響應 s[n] = Σ_{m≤n} h_PD[m] */
export function loopStep(loop: SspllLoop, n: number): Float64Array {
  const h = loopImpulse(loop, n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += h[i]
    h[i] = acc
  }
  return h
}

/** 閉迴路極點（z 平面） */
export function loopPoles(loop: SspllLoop): Complex[] {
  return polyRoots(loop.aH)
}

export function loopStable(loop: SspllLoop): boolean {
  return loopPoles(loop).every((p) => cAbs(p) < 1 - 1e-12)
}

/** direct-form II transposed IIR：y = (b/a) * x，初始狀態 0 */
function iirFilter(b: number[], a: number[], x: Float64Array): Float64Array {
  const st = new IirState(b, a)
  const y = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = st.step(x[i])
  return y
}

class IirState {
  private readonly b: Float64Array
  private readonly a: Float64Array
  private readonly z: Float64Array
  private readonly n: number
  constructor(b: number[], a: number[]) {
    const n = Math.max(b.length, a.length)
    this.n = n
    this.b = new Float64Array(n)
    this.a = new Float64Array(n)
    for (let i = 0; i < b.length; i++) this.b[i] = b[i] / a[0]
    for (let i = 0; i < a.length; i++) this.a[i] = a[i] / a[0]
    this.z = new Float64Array(n)
  }
  step(x: number): number {
    const { b, a, z, n } = this
    const y = b[0] * x + z[0]
    for (let i = 1; i < n; i++) z[i - 1] = b[i] * x + z[i] - a[i] * y
    return y
  }
}

/** |T| 第一次降到 1/√2 的頻率（正規化）；找不到時回傳 0.5 */
export function loopF3dB(loop: SspllLoop, nGrid = 20001): number {
  const target = Math.SQRT1_2
  const f0 = 1e-7
  const g = (x: number) => cAbs(loopT(loop, x)) - target
  if (g(f0) < 0) return f0
  let prev = f0
  for (let i = 1; i < nGrid; i++) {
    const f = f0 + ((0.5 - f0) * i) / (nGrid - 1)
    if (g(f) < 0) return bisect(g, prev, f)
    prev = f
  }
  return 0.5
}

const wrapPi = (x: number): number => x - TWO_PI * Math.round(x / TWO_PI)

/** unity-gain 交越頻率 fc（正規化）與 phase margin [deg]（相位由 DC 連續展開） */
export function loopMargins(loop: SspllLoop, nLin = 4001): { fc: number; pmDeg: number } {
  const grid = concat(geomspaceOpen(1e-8, 1e-3, 400), linspace(1e-3, 0.5, nLin))
  let ph = 0
  let ph0 = 0
  let prevArg = 0
  for (let i = 0; i < grid.length; i++) {
    const L = loopL(loop, grid[i])
    const arg = Math.atan2(L.im, L.re)
    if (i === 0) {
      if (cAbs(L) < 1) return { fc: NaN, pmDeg: NaN }
      ph = arg
      ph0 = arg
    } else {
      ph += wrapPi(arg - prevArg)
    }
    prevArg = arg
    if (i > 0 && cAbs(L) < 1) {
      const fc = bisect((x) => cAbs(loopL(loop, x)) - 1, grid[i - 1], grid[i])
      const phAdj = ph + TWO_PI * Math.round(((-loop.type * Math.PI) / 2 - ph0) / TWO_PI)
      const Lc = loopL(loop, fc)
      const phc = phAdj + wrapPi(Math.atan2(Lc.im, Lc.re) - phAdj)
      return { fc, pmDeg: 180 + (phc * 180) / Math.PI }
    }
  }
  return { fc: NaN, pmDeg: NaN }
}

export interface InversionBand {
  /** 帶下緣（正規化 f；0 = 從 DC 開始） */
  fLo: number
  /** 帶上緣（正規化 f） */
  fHi: number
  /** 帶內最負的 Re H_PD */
  minReH: number
  /** 最負處的頻率（正規化） */
  fMin: number
}

// #region core:inversionBands
/**
 * Re H_PD < 0 的頻帶。利用恆等式 Re H_PD = (1 + Re L)/|1 + L|²：只要找 g(f) = Re L(f) + 1 的負區，
 * 帶緣用二分法求到浮點解析度。
 */
export function inversionBands(loop: SspllLoop, nLin = 20001): InversionBand[] {
  const f = concat(geomspaceOpen(1e-8, 1e-3, 400), linspace(1e-3, 0.5, nLin))
  const g = (x: number) => loopL(loop, x).re + 1 // ← 符號只看 1 + Re L
  const neg = Array.from(f, (x) => g(x) < 0)
  const out: InversionBand[] = []
  const N = f.length
  let i = 0
  while (i < N) {
    if (!neg[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < N && neg[j + 1]) j++
    const fLo = i === 0 ? 0 : bisect(g, f[i - 1], f[i])
    const fHi = j === N - 1 ? 0.5 : bisect(g, f[j], f[j + 1])
    let k = i
    let hk = Infinity
    for (let m = i; m <= j; m++) {
      const h = loopH(loop, f[m]).re
      if (h < hk) {
        hk = h
        k = m
      }
    }
    const fine = goldenMin((x) => loopH(loop, x).re, f[Math.max(i, k - 1)], f[Math.min(j, k + 1)])
    const minReH = Math.min(hk, fine.f)
    const fMin = fine.f <= hk ? fine.x : f[k]
    if (minReH < -1e-9 && fHi - fLo > 1e-9) out.push({ fLo, fHi, minReH, fMin }) // 捨去 DC 附近的 round-off 假象
    i = j + 1
  }
  return out
}
// #endregion core:inversionBands

export interface LoopSummary {
  name: string
  type: 1 | 2
  f3dBMHz: number
  fcMHz: number
  pmDeg: number
  tPeakDb: number
  stable: boolean
  maxPoleMag: number
  maxReH: number
  /** [f_lo, f_hi, min Re H, f_min]（頻率為 MHz） */
  bandsMHz: [number, number, number, number][]
}

export function loopSummary(loop: SspllLoop, fRefHz = F_REF): LoopSummary {
  const m = loopMargins(loop)
  const n = 20001
  let tMax = 0
  let hMax = -Infinity
  for (let i = 0; i < n; i++) {
    const f = 1e-7 + ((0.5 - 1e-7) * i) / (n - 1)
    tMax = Math.max(tMax, cAbs(loopT(loop, f)))
    hMax = Math.max(hMax, loopH(loop, f).re)
  }
  const poles = loopPoles(loop)
  const s = fRefHz / 1e6
  return {
    name: loop.name,
    type: loop.type,
    f3dBMHz: loopF3dB(loop) * s,
    fcMHz: m.fc * s,
    pmDeg: m.pmDeg,
    tPeakDb: 20 * Math.log10(tMax),
    stable: poles.every((p) => cAbs(p) < 1 - 1e-12),
    maxPoleMag: Math.max(...poles.map((p) => cAbs(p))),
    maxReH: hMax,
    bandsMHz: inversionBands(loop).map((b) => [b.fLo * s, b.fHi * s, b.minReH, b.fMin * s]),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 設計：L1（Type-I SSPLL）、L2（Type-II SSPLL）、L3（CPPLL）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 找增益 g 使 |T| 的 −3 dB = bwNorm（log 格點上第一個括住的區間）。
 * golden 的 _solve_gain 對每個候選都掃一次 f3dB；這裡先用等價但便宜的判據 |T(bwNorm)| = 1/√2，
 * 最後由呼叫端用 loopF3dB 驗證（不符時改用 solveGainExact）。
 */
function solveGain(build: (g: number) => SspllLoop, bwNorm: number, lo: number, hi: number, n = 60): number {
  const val = (x: number): number => {
    const lp = build(Math.exp(x))
    return loopStable(lp) ? cAbs(loopT(lp, bwNorm)) - Math.SQRT1_2 : -1
  }
  let prevX = NaN
  let prevV = NaN
  for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1)
    const v = val(x)
    if (i > 0 && prevV < 0 && v >= 0) return Math.exp(bisect(val, prevX, x))
    prevX = x
    prevV = v
  }
  throw new Error('設計失敗：在增益搜尋範圍內無法讓 |T| 的 −3 dB 等於目標頻寬（迴路在到達該頻寬前已不穩定，或頻寬超出範圍）')
}

/** 與 golden 相同的（較慢的）作法：直接對 f3dB(g) − bw 找根 */
function solveGainExact(build: (g: number) => SspllLoop, bwNorm: number, lo: number, hi: number, n = 60): number {
  const val = (x: number): number => {
    const lp = build(Math.exp(x))
    return (loopStable(lp) ? loopF3dB(lp, 4001) : 0) - bwNorm
  }
  let prevX = NaN
  let prevV = NaN
  for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1)
    const v = val(x)
    if (i > 0 && prevV < 0 && v >= 0) return Math.exp(bisect(val, prevX, x))
    prevX = x
    prevV = v
  }
  throw new Error('設計失敗：頻寬無法括住（bandwidth not bracketed）')
}

function solveGainChecked(build: (g: number) => SspllLoop, bwNorm: number, lo: number, hi: number): number {
  const g = solveGain(build, bwNorm, lo, hi)
  if (Math.abs(loopF3dB(build(g)) - bwNorm) <= 1e-7 * bwNorm) return g
  return solveGainExact(build, bwNorm, lo, hi)
}

/**
 * z^-lat（lat ≥ 1）：整數部分是純延遲；小數部分 f 以「控制量保持」的分割 (1−f)z^-i + f z^-(i+1) 表示。
 * （分數延遲依模型而定，分析文件只引用整數延遲的數字。）
 */
export function latencyPoly(lat: number): number[] {
  const i = Math.floor(lat + 1e-12)
  const fr = lat - i
  const c = new Array<number>(i + 2).fill(0)
  c[i] += 1 - fr
  c[i + 1] += fr
  while (c.length > 1 && c[c.length - 1] === 0) c.pop()
  return c
}

// #region core:typeIK
/** L1（1 拍延遲）：|T|² = 1/2 在 Ω₃ ⇒ 1 − K = c − √(c² − 1)，c = 2 − cos Ω₃ */
export function typeIKClosedForm(bwHz = BW, fRefHz = F_REF): number {
  const W3 = (TWO_PI * bwHz) / fRefHz
  const c = 2 - Math.cos(W3)
  return 1 - (c - Math.sqrt(c * c - 1))
}
// #endregion core:typeIK

export interface L1Options {
  /** 給定時不做頻寬設計 */
  K?: number
  /** 迴路延遲（拍），預設 1 */
  lat?: number
  /** 寄生極點頻率 [Hz]；null = 無 */
  fPoleHz?: number | null
  bwHz?: number
  fRefHz?: number
  name?: string
}

/** SSPLL Type-I：L = K z^-lat/(1 − z⁻¹) [× (1−p)/(1 − p z⁻¹)，p = exp(−2π f_pole/f_ref)] */
export function makeL1(o: L1Options = {}): SspllLoop {
  const { lat = 1, fPoleHz = null, bwHz = BW, fRefHz = F_REF } = o
  const nl = latencyPoly(lat)
  const p = fPoleHz === null ? 0 : Math.exp((-TWO_PI * fPoleHz) / fRefHz)
  const bp = fPoleHz === null ? [1] : [1 - p]
  const ap = fPoleHz === null ? [1] : [1, -p]
  const name = o.name ?? `L1${lat === 1 ? '' : `_lat${lat}`}${fPoleHz === null ? '' : `_pole${fPoleHz / 1e6}M`}`
  const build = (k: number): SspllLoop => makeLoop(name, pscale(pconv(nl, bp), k), pconv([1, -1], ap), 1, { K: k, lat, fPoleHz, p })
  let K = o.K
  if (K === undefined) K = lat === 1 && fPoleHz === null ? typeIKClosedForm(bwHz, fRefHz) : solveGainChecked(build, bwHz / fRefHz, -8, 0.5)
  return build(K)
}

export interface L2Options {
  /** sampled-data phase margin 目標 [deg]，預設 60 */
  pm?: number
  lat?: number
  bwHz?: number
  fRefHz?: number
  /** 同時給 Kp、Ki 時不做設計 */
  Kp?: number
  Ki?: number
  /** 設計完成後才乘上去的 loop-gain 倍率（PVT 變化，不重新設計） */
  gainScale?: number
  name?: string
}

/**
 * SSPLL Type-II：L = (Kp + Ki/(1 − z⁻¹)) z^-lat/(1 − z⁻¹)。
 * 設計：Ki = ω_n²、Kp = 2ζω_n；ζ 由 sampled-data PM 解出，ω_n 由 |T| 的 −3 dB = bw 解出。
 */
export function makeL2(o: L2Options = {}): SspllLoop {
  const { pm = 60, lat = 1, bwHz = BW, fRefHz = F_REF, gainScale = 1 } = o
  const nl = latencyPoly(lat)
  const name = o.name ?? `L2_pm${pm}${lat === 1 ? '' : `_lat${lat}`}${gainScale === 1 ? '' : `_g${gainScale}`}`
  const build2 = (kp: number, ki: number, extra: LoopParams = {}): SspllLoop =>
    makeLoop(name, pconv([kp + ki, -kp], nl), [1, -2, 1], 2, { Kp: kp, Ki: ki, lat, pmTarget: pm, ...extra })
  if (o.Kp !== undefined && o.Ki !== undefined) return build2(o.Kp * gainScale, o.Ki * gainScale)
  const bwn = bwHz / fRefHz
  const wnFor = (z: number): number => solveGain((w) => build2(2 * z * w, w * w), bwn, -8, 0)
  const pmErr = (z: number): number => {
    const w = wnFor(z)
    return loopMargins(build2(2 * z * w, w * w)).pmDeg - pm
  }
  const zs = linspace(0.2, 3.0, 15)
  const vals = Array.from(zs, (z) => {
    try {
      return pmErr(z)
    } catch {
      return NaN
    }
  })
  let k = -1
  for (let i = 1; i < zs.length; i++) {
    if (vals[i - 1] < 0 && vals[i] >= 0) {
      k = i
      break
    }
  }
  if (k < 0) throw new Error(`設計失敗：在 ζ ∈ [0.2, 3] 內找不到 PM = ${pm}° 的 Type-II 設計（延遲 ${lat} 拍、頻寬 ${bwHz / 1e6} MHz 時 PM 的可達範圍不含此值）`)
  const z = bisect(pmErr, zs[k - 1], zs[k])
  let w = wnFor(z)
  if (Math.abs(loopF3dB(build2(2 * z * w, w * w)) - bwn) > 1e-7 * bwn) w = solveGainExact((x) => build2(2 * z * x, x * x), bwn, -8, 0)
  return build2(2 * z * w * gainScale, w * w * gainScale, { zeta: z, wn: w })
}

export type CppllMapping = 'impulse' | 'halfT' | 'zoh'

export interface L3Options {
  /** 連續時間 PM 的放置 [deg]（決定 b），預設 60 */
  pmCt?: number
  mapping?: CppllMapping
  bwHz?: number
  fRefHz?: number
  /** b = 1 + C1/C2；給定時忽略 pmCt */
  b?: number
  /** ω_c T_ref；給定時不做頻寬設計 */
  wc?: number
  gainScale?: number
  name?: string
}

/**
 * 傳統 CPPLL：L(s) = K(1 + s/ω_z)/(s²(1 + s/ω_p))，ω_z = ω_c/√b、ω_p = ω_c√b、K = ω_c²/√b、
 * b = ((1 + sin PM)/cos PM)² = 1 + C1/C2。以 T_ref = 1 取樣：
 *   'impulse'：CP 電荷包在 nT 注入、(n+1)T 比較 ⇒ L(z) = Σ_{n≥1} l(n) z^-n
 *   'halfT'  ：電荷包中心延後 T/2 ⇒ Σ_{n≥1} l(n − ½) z^-n
 *   'zoh'    ：PD 輸出保持一整拍（step-invariant）
 * 其中 l(t) = K t + B(1 − e^{−ω_p t})，B = K(ω_p/ω_z − 1)/ω_p。
 */
export function makeL3(o: L3Options = {}): SspllLoop {
  const { pmCt = 60, mapping = 'impulse', bwHz = BW, fRefHz = F_REF, gainScale = 1 } = o
  let b = o.b
  if (b === undefined) {
    const ph = (pmCt * Math.PI) / 180
    b = ((1 + Math.sin(ph)) / Math.cos(ph)) ** 2
  }
  const bb = b
  const name = o.name ?? `L3_${mapping}_pm${pmCt}${gainScale === 1 ? '' : `_g${gainScale}`}`
  const build = (w: number, gs = 1): SspllLoop => {
    const sb = Math.sqrt(bb)
    const wz = w / sb
    const wp = w * sb
    const K = ((w * w) / sb) * gs
    const B = (K * (wp / wz - 1)) / wp
    const p = Math.exp(-wp)
    const d1 = [1, -1]
    const d2 = [1, -2, 1]
    const dp = [1, -p]
    let num: number[]
    if (mapping === 'impulse' || mapping === 'halfT') {
      const tau = mapping === 'impulse' ? 0 : 0.5
      const n1 = pconv([0, K], dp) // K z⁻¹/(1 − z⁻¹)²
      const n2 = pconv(pconv([0, B - K * tau], d1), dp) // (B − Kτ) z⁻¹/(1 − z⁻¹)
      const n3 = pconv([0, -B * p * Math.exp(wp * tau)], d2) // −B e^{ω_p τ} p z⁻¹/(1 − p z⁻¹)
      num = padd(padd(n1, n2), n3)
    } else if (mapping === 'zoh') {
      // step-invariant：G(z) = (1 − z⁻¹)·Z{∫l}；∫l = K t²/2 + B t − (B/ω_p)(1 − e^{−ω_p t})
      const n1 = pscale(pconv([0, 1, 1], dp), K / 2) // K z⁻¹(1 + z⁻¹)/(2(1 − z⁻¹)²)
      const n2 = pscale(pconv(pconv([0, 1], d1), dp), B) // B z⁻¹/(1 − z⁻¹)
      const n3 = pscale(pconv([0, 1], d2), (-B * (1 - p)) / wp) // −(B/ω_p)(1 − p) z⁻¹/(1 − p z⁻¹)
      num = padd(padd(n1, n2), n3)
    } else {
      throw new Error(`未知的取樣映射：${String(mapping)}`)
    }
    const den = pconv(d2, dp)
    return makeLoop(name, num, den, 2, {
      mapping,
      pmCt,
      b: bb,
      wc: w,
      K,
      wz,
      wp,
      B,
      p,
      fzMHz: (wz * fRefHz) / TWO_PI / 1e6,
      fpMHz: (wp * fRefHz) / TWO_PI / 1e6,
      fcCtMHz: (w * fRefHz) / TWO_PI / 1e6,
    })
  }
  const wc = o.wc ?? solveGainChecked((w) => build(w), bwHz / fRefHz, -6, 0.5)
  return build(wc, gainScale)
}

/** 對策：校準時 hold 住 Type-II SSPLL 的積分路徑 ⇒ Type-I，L = Kp z^-lat/(1 − z⁻¹) */
export function makePOnlyL2(loop2: SspllLoop, name?: string): SspllLoop {
  return makeL1({ K: Number(loop2.params.Kp), lat: Number(loop2.params.lat ?? 1), name: name ?? `${loop2.name}_Ponly` })
}

/**
 * 對策：CPPLL 校準時 hold 住積分電容 C1。
 * exactHold = false：剩下 (K/ω_z)/(s(1 + s/ω_p))（C1 ≫ C2 近似）；
 * exactHold = true ：精確的 R ∥ C2：增益 × b/(b−1)、極點 × (b−1)/b。
 * impulse-invariant：L = A [z⁻¹/(1 − z⁻¹) − p z⁻¹/(1 − p z⁻¹)]。
 */
export function makePOnlyL3(loop3: SspllLoop, exactHold = false, name?: string): SspllLoop {
  const pr = loop3.params
  let A = Number(pr.K) / Number(pr.wz)
  let wp = Number(pr.wp)
  const b = Number(pr.b)
  if (exactHold) {
    A *= b / (b - 1)
    wp *= (b - 1) / b
  }
  const p = Math.exp(-wp)
  return makeLoop(name ?? `${loop3.name}${exactHold ? '_Ponly_exactRC2' : '_Ponly'}`, [0, A * (1 - p)], pconv([1, -1], [1, -p]), 1, { A, wp, p, exactHold, src: loop3.name })
}

let nominalCache: { bw: number; loops: Record<'L1' | 'L2' | 'L3', SspllLoop> } | null = null

/** 三個標稱迴路：L1（Type-I SSPLL）、L2（Type-II SSPLL，PM 60°）、L3（CPPLL，impulse-invariant，CT PM 60° 放置） */
export function nominalLoops(bwHz = BW): Record<'L1' | 'L2' | 'L3', SspllLoop> {
  if (nominalCache && nominalCache.bw === bwHz) return nominalCache.loops
  const loops = { L1: makeL1({ bwHz }), L2: makeL2({ pm: 60, bwHz }), L3: makeL3({ pmCt: 60, mapping: 'impulse', bwHz }) }
  nominalCache = { bw: bwHz, loops }
  return loops
}

// ─────────────────────────────────────────────────────────────────────────────
// closed form（在所述模型內精確）
// ─────────────────────────────────────────────────────────────────────────────

/** L = K z⁻¹/(1 − z⁻¹) 的 Re H_PD = (2 − K)(1 − cos Ω)/|1 − (1 − K)e^{−jΩ}|²（0 < K < 2 時 ≥ 0） */
export function typeIReH(K: number, f: number): number {
  const W = TWO_PI * f
  const re = 1 - (1 - K) * Math.cos(W)
  const im = (1 - K) * Math.sin(W)
  return ((2 - K) * (1 - Math.cos(W))) / (re * re + im * im)
}

/** 1 拍延遲的 Type-II SSPLL：Re L = −Kp/2 − Ki/(4 sin²(Ω/2)) */
export function typeIIReL(Kp: number, Ki: number, f: number): number {
  const s = Math.sin(Math.PI * f)
  return -Kp / 2 - Ki / (4 * s * s)
}

// #region core:bandEdge
/** L2 反號帶（Re H_PD < 0）的上緣（正規化 f）：(1/π)·asin √(Ki/(2(2 − Kp))) */
export function typeIIFinv(Kp: number, Ki: number): number {
  return Math.asin(Math.sqrt(Ki / (2 * (2 - Kp)))) / Math.PI
}
// #endregion core:bandEdge

/** impulse-invariant CPPLL：−Re L = K/(4 sin²(Ω/2)) + B(1 − p²)/(2|1 − p e^{−jΩ}|²) */
export function cppllMinusReL(params: LoopParams, f: number): number {
  const K = Number(params.K)
  const wp = Number(params.wp)
  const wz = Number(params.wz)
  const W = TWO_PI * f
  const p = Math.exp(-wp)
  const B = (K * (wp / wz - 1)) / wp
  const s = Math.sin(W / 2)
  const den = 1 - 2 * p * Math.cos(W) + p * p
  return K / (4 * s * s) + (B * (1 - p * p)) / (2 * den)
}

/** impulse-invariant CPPLL 的帶緣（正規化 f）：closed form −Re L(f) = 1 的根（−Re L 對 f 單調遞減） */
export function cppllFinv(params: LoopParams): number {
  const g = (f: number) => cppllMinusReL(params, f) - 1
  if (g(0.5) >= 0) return 0.5
  return bisect(g, 1e-9, 0.5)
}

/** L = K z^-d/(1 − z⁻¹)：Re L ≥ −K(d − ½)；整數 d 時「存在反號帶 ⟺ K(d − ½) > 1」 */
export function typeILatencyCriterion(K: number, d: number): number {
  return K * (d - 0.5)
}

/** L = K(1 − p) z⁻¹/((1 − z⁻¹)(1 − p z⁻¹))：Re L ≥ −K(½ + p/(1 − p))；> 1 時存在反號帶（P-only CPPLL 以 A 取代 K） */
export function typeIPoleCriterion(K: number, p: number): number {
  return K * (0.5 + p / (1 - p))
}

/** Type-II 迴路在 DC 附近 Re H_PD ≈ −k Ω² 的係數 k（L2：1/Ki；impulse CPPLL：1/K） */
export function lowFreqReHCoeff(loop: SspllLoop): number {
  if (loop.type !== 2) throw new Error('lowFreqReHCoeff 只適用 Type-II 迴路')
  return 1 / Number(loop.params.Ki ?? loop.params.K)
}

// ─────────────────────────────────────────────────────────────────────────────
// 「帶入手算」題（src/pages/case-sspll/handcalcs.ts）用的小工具：純函式、closed form
// ─────────────────────────────────────────────────────────────────────────────

// #region core:oneDiffClosed
/**
 * 1 拍延遲的 Type-II（P + I）迴路：一階差分 kernel 的分子 g(Ω) = 1 − cos Ω + Re{(1 − e^{−jΩ})L} = 1 − Ki/2 − (1 − Kp)cos Ω。
 * g(0) = Kp − Ki/2、g(π) = 2 − Kp − Ki/2；g ≥ 0 ∀Ω ⟺ Ki ≤ 2Kp 且 Kp + Ki/2 ≤ 2（oneDiffMargin 是同一個量的數值掃描）。
 */
export function typeIIOneDiffG(Kp: number, Ki: number, f: number): number {
  return 1 - Ki / 2 - (1 - Kp) * Math.cos(TWO_PI * f)
}
// #endregion core:oneDiffClosed

// #region core:channelFreqs
/**
 * 取樣後的頻譜以 f_ref 為週期，而且 Re H(f) = Re H(−f)：把正規化頻率折到 [0, ½]。
 * PMUX 的旋轉頻率 α·f_ref 折回後是 min(frac α, 1 − frac α)·f_ref。
 */
export function foldFreq(f: number): number {
  const x = frac(f)
  return Math.min(x, 1 - x)
}

/** GOS 鋸齒 ρ[n] = frac(nβ) 的基波頻率（正規化）β = frac(8α)；β = 0（α = k/8）時 ρ ≡ 0，GOS 不可觀測 */
export function gosBeta(alpha: number): number {
  return frac(NPH * alpha)
}
// #endregion core:channelFreqs

// #region core:toySignLms
/**
 * §4.1 的單 tap 玩具模型（一步）：PD 看到 e = g·(a − w)·x，比較器 q = sign(e)（e = 0 時取 +1），更新 w ← w + μ q x。
 * g 代表迴路在 regressor 頻率上的 Re H_PD：g > 0 時往真值 a 走；g < 0 時每一步都往反方向走，而且與 |g| 無關。
 */
export function toySignLmsStep(w: number, a: number, x: number, mu: number, g: number): { e: number; q: 1 | -1; w: number } {
  const e = g * (a - w) * x // PD 殘差：誤差 (a − w)x 被迴路乘上 g
  const q = e >= 0 ? 1 : -1 // 1-bit 比較器
  return { e, q, w: w + mu * q * x } // sign-error LMS 更新
}
// #endregion core:toySignLms

// ─────────────────────────────────────────────────────────────────────────────
// regressor 的 Fourier 權重
// ─────────────────────────────────────────────────────────────────────────────

/** mode-1 的基波權重 64 sin²(π/8)/π² = 0.94964… */
export const W1 = (64 * Math.sin(Math.PI / 8) ** 2) / Math.PI ** 2
/** α ≈ 1/4 附近 mode-4（方波）的基波權重 8/π² = 0.81057… */
export const W_SQUARE = 8 / Math.PI ** 2

/** 鋸齒 ρ 的第 m 次諧波（±mβ 兩條線合計）的功率 1/(2π²m²)；Σ_m = 1/12 = var(ρ) */
export function sawtoothLinePower(m: number): number {
  return 1 / (2 * Math.PI ** 2 * m * m)
}

/** one-hot 1{p = k} 在線 ℓα 的功率 |c_ℓ|² = sin²(πℓ/8)/(πℓ)²；mode 權重 w_ℓ = 64|c_ℓ|² */
export function indicatorLineWeight(ell: number): number {
  return Math.sin((Math.PI * ell) / NPH) ** 2 / (Math.PI ** 2 * ell * ell)
}

/** Hurwitz zeta ζ(2, x) = Σ_{k≥0} 1/(x + k)²（= trigamma），x > 0；用於諧波和的尾項 */
export function hurwitzZeta2(x: number): number {
  let s = 0
  while (x < 30) {
    s += 1 / (x * x)
    x += 1
  }
  const x2 = x * x
  return s + 1 / x + 1 / (2 * x2) + 1 / (6 * x2 * x) - 1 / (30 * x2 * x2 * x) + 1 / (42 * x2 * x2 * x2 * x) - 1 / (30 * x2 * x2 * x2 * x2 * x)
}

// ─────────────────────────────────────────────────────────────────────────────
// GMAC 前置濾波（regressor 變體）與有效 kernel
// ─────────────────────────────────────────────────────────────────────────────

export type LoopModels = Record<string, SspllLoop>
/** 頻域 kernel：f（正規化）→ 複數 */
export type Kernel = (f: number) => Complex

function fxModel(variant: string, models?: LoopModels): SspllLoop {
  const m = models?.[variant.slice(3)]
  if (!m) throw new Error(`filtered-x 變體「${variant}」找不到模型 ${variant.slice(3)}（請在 models 中提供）`)
  return m
}

// #region core:variantG
/**
 * GMAC regressor 前置濾波 r = g * x 的頻率響應 G(e^{j2πf})（golden：regressors.py 的 variant_G）。
 * 變體名稱與 golden 相同：'raw' | 'ac' | 'zm' | 'D:k' | '1diff' | '2diff' | '1diffD:k' | 'fx:<模型名>'。
 */
export function variantG(variant: string, f: number, models?: LoopModels): Complex {
  const W = TWO_PI * f
  const d1: Complex = { re: 1 - Math.cos(W), im: Math.sin(W) } // 1 − z⁻¹，z⁻¹ = e^{−jΩ}
  const zPow = (k: number): Complex => ({ re: Math.cos(W * k), im: -Math.sin(W * k) }) // z^-k
  if (variant === 'raw' || variant === 'ac' || variant === 'zm') return { re: 1, im: 0 } // G = 1（平均那條線 ℓ = 0 反正乘上 H(1) = 0）
  if (variant.startsWith('D:')) return zPow(Number(variant.slice(2))) // ← 差異：G = z^-D（相關器晚 D 拍）
  if (variant === '1diff') return d1 // ← 差異：G = 1 − z⁻¹
  if (variant === '2diff') return cMul(d1, d1) // ← 差異：G = (1 − z⁻¹)²
  if (variant.startsWith('1diffD:')) return cMul(d1, zPow(Number(variant.slice(7)))) // 一階差分但錯位 k 拍
  if (variant.startsWith('fx:')) return loopH(fxModel(variant, models), f) // ← 差異：G = Ĥ_PD（模型）
  throw new Error(`未知的 regressor 變體：${variant}`)
}
// #endregion core:variantG

// #region core:gammaEff
/** 有效 kernel Γ_eff(f) = H_PD(f)·conj(G(f))；openLoop = true（或 loop = null）時 H_PD ≡ 1 */
export function gammaEff(loop: SspllLoop | null, variant = 'raw', models?: LoopModels, openLoop = false): Kernel {
  return (f: number): Complex => {
    const g = cConj(variantG(variant, f, models))
    return openLoop || loop === null ? g : cMul(loopH(loop, f), g) // LMS 的符號由 Re Γ_eff 決定，不是 |H_PD|
  }
}
// #endregion core:gammaEff

/** Γ 在 [0, 1) 上 n 個中點的平均（等分佈極限；諧波和的尾項使用） */
export function kernelMean(Geff: Kernel, n = 4096): Complex {
  let re = 0
  let im = 0
  for (let i = 0; i < n; i++) {
    const g = Geff((i + 0.5) / n)
    re += g.re
    im += g.im
  }
  return { re: re / n, im: im / n }
}

// ─────────────────────────────────────────────────────────────────────────────
// ergodic（無理數 α）諧波和
// ─────────────────────────────────────────────────────────────────────────────

// #region core:gosHarmonic
/**
 * GOS 的自我斜率：C_GOS = Σ_{m≥1} Re Γ_eff(frac(mβ))/(2π²m²)，β = frac(8α)。
 * κ_GOS = 12·C_GOS（H ≡ 1 時為 1）。M 以外的尾項用 Re Γ 的等分佈平均。
 */
export function gosHarmonic(alpha: number, Geff: Kernel, M = 8192, mean?: Complex): number {
  const beta = frac(NPH * alpha) // 8·frac(nα) 與 8nα 只差 8 的整數倍 ⇒ GOS 只依賴 β
  if (beta === 0) return 0 // α = k/8：ρ ≡ 0，GOS 不可觀測
  let val = 0
  for (let m = 1; m <= M; m++) val += Geff(frac(m * beta)).re / (2 * Math.PI ** 2 * m * m) // 每條線的功率 × Re Γ
  const mg = mean ?? kernelMean(Geff)
  return val + (mg.re * hurwitzZeta2(M + 1)) / (2 * Math.PI ** 2)
}
// #endregion core:gosHarmonic

// #region core:phosLambda
/**
 * PHOS 8×8 circulant 的 DFT 模態特徵值：
 *   λ_m = 8 Σ_{ℓ ≡ m (mod 8)} |c_ℓ|² Γ_eff(frac(ℓα))，|c_ℓ|² = sin²(πℓ/8)/(πℓ)²，ℓ 取正負整數；λ_0 = 0（共模）。
 * κ_m = 8 λ_m（H ≡ 1 時為 1）；Re λ_m < 0 ⇒ 模態 m 反號。
 */
export function phosLambdaHarmonic(alpha: number, Geff: Kernel, M = 8192, mean?: Complex): Complex[] {
  const lam: Complex[] = Array.from({ length: NPH }, () => ({ re: 0, im: 0 }))
  const kmax = Math.floor(M / NPH) + 1
  const mg = mean ?? kernelMean(Geff)
  for (let m = 1; m < NPH; m++) {
    const s2 = Math.sin((Math.PI * m) / NPH) ** 2 / Math.PI ** 2 // sin²(πℓ/8) 只依賴 ℓ mod 8
    let sr = 0
    let si = 0
    for (let k = -kmax; k < kmax; k++) {
      const ell = m + NPH * k // ℓ = m, m ± 8, m ± 16, …（含負的線）
      const w = s2 / (ell * ell) // |c_ℓ|²
      const g = Geff(frac(ell * alpha)) // 該線折回 [0, 1) 後的 Γ_eff
      sr += w * g.re
      si += w * g.im
    }
    const tail = (hurwitzZeta2(kmax + m / NPH) + hurwitzZeta2(kmax + 1 - m / NPH)) / NPH ** 2
    lam[m] = { re: NPH * (sr + s2 * tail * mg.re), im: NPH * si }
  }
  return lam
}
// #endregion core:phosLambda

// #region core:gosRational
/**
 * 有理數 β = a/b（最簡分數）的精確 GOS 斜率：ρ[n] = frac(n·a/b) 以 b 為週期，
 * 基本鋸齒的第 k 條 DFT 線功率是 1/(4b² sin²(πk/b))，落在頻率 frac(k·a/b)：
 *   C_GOS = Σ_{k=1}^{b−1} Re Γ_eff(frac(k·a/b)) / (4b² sin²(πk/b))。
 * 用來掃描「GOS 在 D = 0 不反號」這個猜想（不是證明）。
 */
export function gosRationalBeta(Geff: Kernel, a: number, b: number): number {
  let val = 0
  for (let k = 1; k < b; k++) {
    const s = Math.sin((Math.PI * k) / b)
    val += Geff(((k * a) % b) / b).re / (4 * b * b * s * s)
  }
  return val
}
// #endregion core:gosRational

/** 掃描所有最簡分數 β = a/b（2 ≤ b ≤ bMax）的 12·C_GOS：回傳個數、負值個數與最小值 */
export function gosConjectureScan(Geff: Kernel, bMax: number): { nBeta: number; nNegative: number; min12C: number; at: [number, number] } {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y))
  let nBeta = 0
  let nNegative = 0
  let min12C = Infinity
  let at: [number, number] = [0, 1]
  for (let b = 2; b <= bMax; b++) {
    // Re Γ(k/b) 只需算一次；不同的 a 只是重新排列
    const g = new Float64Array(b)
    const w = new Float64Array(b)
    for (let k = 1; k < b; k++) {
      g[k] = Geff(k / b).re
      const s = Math.sin((Math.PI * k) / b)
      w[k] = 1 / (4 * b * b * s * s)
    }
    for (let a = 1; a < b; a++) {
      if (gcd(a, b) !== 1) continue
      let val = 0
      for (let k = 1; k < b; k++) val += g[(k * a) % b] * w[k]
      nBeta++
      if (val < 0) nNegative++
      // C(β) = C(1 − β)：並列時保留先找到的（較小的 a）
      if (min12C === Infinity || 12 * val < min12C - 1e-12 * Math.abs(min12C)) {
        min12C = 12 * val
        at = [a, b]
      }
    }
  }
  return { nBeta, nNegative, min12C, at }
}

/** 單線近似：8 Re λ₁ ≈ W₁·Re Γ_eff(α)，W₁ = 0.94964 */
export function singleLinePhos(alpha: number, Geff: Kernel): number {
  return W1 * Geff(frac(alpha)).re
}

/** Re Γ_eff 在 (0, ½] 上的最小／最大值（格點 + 黃金分割細化） */
function kernelReRange(Geff: Kernel, nGrid = 20001, lo = 1e-7): { min: number; fMin: number; max: number; fMax: number } {
  const re = (x: number) => Geff(x).re
  const f = linspace(lo, 0.5, nGrid)
  let iMin = 0
  let iMax = 0
  let vMin = Infinity
  let vMax = -Infinity
  for (let i = 0; i < nGrid; i++) {
    const v = re(f[i])
    if (v < vMin) {
      vMin = v
      iMin = i
    }
    if (v > vMax) {
      vMax = v
      iMax = i
    }
  }
  let fMin = f[iMin]
  let fMax = f[iMax]
  if (iMin > 0 && iMin < nGrid - 1) {
    const r = goldenMin(re, f[iMin - 1], f[iMin + 1])
    if (r.f < vMin) {
      vMin = r.f
      fMin = r.x
    }
  }
  if (iMax > 0 && iMax < nGrid - 1) {
    const r = goldenMin((x) => -re(x), f[iMax - 1], f[iMax + 1])
    if (-r.f > vMax) {
      vMax = -r.f
      fMax = r.x
    }
  }
  return { min: vMin, fMin, max: vMax, fMax }
}

/** 嚴格界限（ergodic 或 8 | Q）：W₁ReΓ(α) + (1−W₁)min ReΓ ≤ 8Re λ₁ ≤ W₁ReΓ(α) + (1−W₁)max ReΓ */
export function phosM1Bounds(loop: SspllLoop, alpha: number, variant = 'raw', models?: LoopModels): { lower: number; upper: number } {
  const G = gammaEff(loop, variant, models)
  const r = kernelReRange(G)
  const ga = G(frac(alpha)).re
  return { lower: W1 * ga + (1 - W1) * r.min, upper: W1 * ga + (1 - W1) * r.max }
}

export interface Mode1SureBand {
  /** 門檻 −(1−W₁)·max Re H / W₁ */
  thresholdReH: number
  maxReH: number
  minReH: number
  /** 「一定反號」的 α·f_ref 區間（正規化 f）；null = 不存在 */
  sure: [number, number] | null
  /** 超過此頻率（正規化）mode-1 不可能反號；0 = 任何頻率都不可能 */
  impossibleAbove: number
}

/** mode-1「一定反號」（Re H < −(1−W₁)max Re H/W₁）與「不可能反號」（W₁Re H + (1−W₁)min Re H ≥ 0）的頻率 */
export function mode1SureBand(loop: SspllLoop, nGrid = 20001): Mode1SureBand {
  const h = (x: number) => loopH(loop, x).re
  const r = kernelReRange((x) => loopH(loop, x), nGrid, 1e-6)
  const thr = (-(1 - W1) * r.max) / W1
  const f = linspace(1e-6, 0.5, nGrid)
  const edges = (pred: (v: number) => boolean, g: (x: number) => number): [number, number] | null => {
    let first = -1
    let last = -1
    for (let i = 0; i < nGrid; i++) {
      if (pred(h(f[i]))) {
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) return null
    const lo = first === 0 ? f[0] : bisect(g, f[first - 1], f[first])
    const hi = last === nGrid - 1 ? 0.5 : bisect(g, f[last], f[last + 1])
    return [lo, hi]
  }
  const sure = edges(
    (v) => v < thr,
    (x) => h(x) - thr,
  )
  const poss = edges(
    (v) => W1 * v + (1 - W1) * r.min < 0,
    (x) => W1 * h(x) + (1 - W1) * r.min,
  )
  return { thresholdReH: thr, maxReH: r.max, minReH: r.min, sure, impossibleAbove: poss ? poss[1] : 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// 對策的 kernel、PSD 定理、disc constant
// ─────────────────────────────────────────────────────────────────────────────

export interface KernelMin {
  min: number
  /** 最小值所在頻率（正規化） */
  fAtMin: number
  anyNegative: boolean
  /** Re Γ < 0 的最高頻率（正規化）；沒有負值時為 null */
  negFMax: number | null
}

/**
 * min_f Re Γ_eff(f)。定理：Re Γ_eff ≥ 0 對所有 f 成立 ⇒ joint 9×9 的 Re eig(C) ≥ 0，對任何 α 都成立
 * （單位特徵向量 v：λ = Σ_ν |a_νᵀv|² Γ_ν）。
 */
export function kernelMin(loop: SspllLoop, variant = 'raw', models?: LoopModels, nLin = 20001): KernelMin {
  const G = gammaEff(loop, variant, models)
  const re = (x: number) => G(x).re
  const f = concat(geomspaceOpen(1e-8, 1e-3, 2000), linspace(1e-3, 0.5, nLin))
  const N = f.length
  let iMin = 0
  let vMin = Infinity
  let lastNeg = -1
  for (let i = 0; i < N; i++) {
    const v = re(f[i])
    if (v < vMin) {
      vMin = v
      iMin = i
    }
    if (v < -1e-15) lastNeg = i
  }
  let fAtMin = f[iMin]
  if (iMin > 0 && iMin < N - 1) {
    const r = goldenMin(re, f[iMin - 1], f[iMin + 1])
    if (r.f < vMin) {
      vMin = r.f
      fAtMin = r.x
    }
  }
  let negFMax: number | null = null
  if (lastNeg >= 0) negFMax = lastNeg === N - 1 || re(f[lastNeg + 1]) <= 0 ? f[lastNeg] : bisect(re, f[lastNeg], f[lastNeg + 1])
  return { min: vMin, fAtMin, anyNegative: lastNeg >= 0, negFMax }
}

// #region core:oneDiffMargin
/**
 * 一階差分 regressor 的安全 margin：Re{H(1 − e^{jΩ})} ≥ 0 ⟺ g(Ω) = 1 − cos Ω + Re{(1 − e^{−jΩ})L} ≥ 0。
 * Type-II 的 closed form：g = 1 − Ki/2 − (1 − Kp)cos Ω，最小值 Kp − Ki/2（Kp ≤ 1）。
 */
export function oneDiffMargin(loop: SspllLoop, nLin = 20001): { min: number; fAtMin: number } {
  const f = concat(geomspaceOpen(1e-5, 1e-3, 2000), linspace(1e-3, 0.5, nLin))
  let min = Infinity
  let fAtMin = 0
  for (let i = 0; i < f.length; i++) {
    const W = TWO_PI * f[i]
    const L = loopL(loop, f[i])
    const g = 1 - Math.cos(W) + ((1 - Math.cos(W)) * L.re - Math.sin(W) * L.im) // Re{(1 − e^{−jΩ})L}
    if (g < min) {
      min = g
      fAtMin = f[i]
    }
  }
  return { min, fAtMin }
}
// #endregion core:oneDiffMargin

/**
 * disc constant c = min_f Re Γ/|Γ|²。c > 0 時 Re λ ≥ c|λ|²/(vᴴRv)（Cauchy–Schwarz），
 * 所以 μK_qλ_max(R) < 2c 時 block 更新平均穩定，與 α 無關。
 */
export function discConstant(loop: SspllLoop, variant = '1diff', models?: LoopModels, nLin = 20001): number {
  const G = gammaEff(loop, variant, models)
  const f = concat(geomspaceOpen(1e-7, 1e-3, 4000), linspace(1e-3, 0.5, nLin))
  let c = Infinity
  for (let i = 0; i < f.length; i++) {
    const g = G(f[i])
    c = Math.min(c, g.re / (g.re * g.re + g.im * g.im))
  }
  return c
}

// #region core:blockMeanStable
/**
 * 有限步長的 block LMS（N_τ = 開迴路時間常數 [blocks]，κ = 8λ）：
 * θ_{k+1} = (1 − κ/N_τ)θ_k 穩定 ⟺ |1 − κ/N_τ| < 1 ⟺ Re κ > |κ|²/(2N_τ)。
 */
export function blockMeanStable(kappas: Complex[], tau: number): boolean {
  return kappas.every((k) => Math.hypot(1 - k.re / tau, k.im / tau) < 1)
}
// #endregion core:blockMeanStable

/** 慢鋸齒的漸近式：Type-II、D = 0 ⇒ β²/Ki；其餘 ⇒ (β/2)(S_∞ − 2S_D)（Type-I：β/(2K)；Type-II、D = 1：−β） */
export function gosSmallBeta(loop: SspllLoop, beta: number, D = 0, nStep = 80000): number {
  if (loop.type === 2 && D === 0) return (beta * beta) / Number(loop.params.Ki ?? loop.params.K)
  const s = loopStep(loop, nStep)
  let sInf = 0
  let sD = 0
  for (let i = 0; i < s.length; i++) {
    sInf += s[i]
    if (i < D) sD += s[i]
  }
  return 0.5 * beta * (sInf - 2 * sD)
}

// ─────────────────────────────────────────────────────────────────────────────
// 比較器 DC offset（forcing 項；不在 eig(C) 裡）
// ─────────────────────────────────────────────────────────────────────────────

/** e = 0 時 q = sign(e + v + u_os) 的平均 E[q] = erf(u_os/(√2σ)) */
export function eqOffset(uOs: number, sigma: number): number {
  return erf(uOs / (Math.SQRT2 * sigma))
}

/** 在 offset 工作點的 Bussgang 增益 K_q(u) = √(2/π)/σ · exp(−u²/(2σ²)) */
export function kqOffset(uOs: number, sigma: number): number {
  return (Math.sqrt(2 / Math.PI) / sigma) * Math.exp((-uOs * uOs) / (2 * sigma * sigma))
}

/** raw（非 zero-mean）regressor 的 GOS 穩態偏差（單位同 u_os）：−E[q]⟨ρ⟩/(K_q(u)·C_GOS) */
export function gosOffsetBias(cGos: number, rhoMean: number, uOs: number, sigma: number): number {
  return (-eqOffset(uOs, sigma) * rhoMean) / (kqOffset(uOs, sigma) * cGos)
}

/** Bussgang 增益 K_q = √(2/π)/σ_v */
export function kqGain(sigma: number): number {
  return Math.sqrt(2 / Math.PI) / sigma
}

// ─────────────────────────────────────────────────────────────────────────────
// 分數相位序列與 regressor
// ─────────────────────────────────────────────────────────────────────────────

/** 最接近 x 且分母 ≤ maxQ 的有理數（連分數；等同 Python 的 Fraction(x).limit_denominator(maxQ)） */
export function limitDenominator(x: number, maxQ: number): [number, number] {
  if (!Number.isFinite(x)) throw new Error('limitDenominator：x 必須是有限數')
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  let p0 = 0
  let q0 = 1
  let p1 = 1
  let q1 = 0
  let v = ax
  for (let it = 0; it < 64; it++) {
    const a = Math.floor(v)
    const q2 = q0 + a * q1
    if (q2 > maxQ) break
    const p2 = p0 + a * p1
    p0 = p1
    q0 = q1
    p1 = p2
    q1 = q2
    const fr = v - a
    if (fr < 1e-13) return [sign * p1, q1]
    v = 1 / fr
  }
  // 以半收斂分數補到分母上限，取較接近者
  const k = Math.floor((maxQ - q0) / q1)
  const pb = p0 + k * p1
  const qb = q0 + k * q1
  return Math.abs(pb / qb - ax) < Math.abs(p1 / q1 - ax) ? [sign * pb, qb] : [sign * p1, q1]
}

export type SeqSide = 'right' | 'left'
export type SeqKind = 'acc32' | SeqSide

export interface PhaseSample {
  /** DTC 細部殘差 ρ ∈ [0, 1)（以 Δ 為單位） */
  c: number
  /** PMUX 相位索引 0..7 */
  p: number
}

// #region core:sequence
/**
 * 分數相位序列（一階累加器，無 DSM 隨機化）：φ[n] = frac(nα)，p[n] = ⌊8φ[n]⌋，ρ[n] = 8φ[n] − p[n]。
 * α = P/Q 的精確序列；side = 'left' 是 α 由下方趨近 P/Q 的極限（ρ → 1、前一相）。
 */
export function seqRationalAt(P: number, Q: number, n: number, side: SeqSide, out: PhaseSample): void {
  const nm = ((n % Q) + Q) % Q
  const s = (nm * (((P % Q) + Q) % Q)) % Q // n·P mod Q（Q ≤ 2²⁶ 時精確）
  const t = NPH * s
  let p = Math.floor(t / Q) // PMUX 相位索引
  const r = t % Q
  let c = r / Q // DTC 細部殘差
  if (side === 'left' && r === 0) {
    p = (p + NPH - 1) % NPH
    c = 1
  }
  out.c = c
  out.p = p
}

/** 時域 sim 的 32-bit 一階累加器：acc = n·round(α·2³²) mod 2³²，p = 最高 3 bit，ρ = 其餘 29 bit */
export function seqAccAt(ai: number, n: number, out: PhaseSample): void {
  const acc = Math.imul(n | 0, ai | 0) >>> 0 // 乘積的低 32 bit = (n·ai) mod 2³²
  out.p = acc >>> 29
  out.c = (acc & 0x1fffffff) / 0x20000000
}
// #endregion core:sequence

/** 32-bit 累加器的頻率控制字 round(α·2³²) mod 2³² */
export function accWord(alpha: number): number {
  return ((Math.round(alpha * 4294967296) % 4294967296) + 4294967296) % 4294967296
}

/** 量化後的累加器在遠短於 2³² 的紀錄內實現的是有理序列的哪一側極限 */
export function accSide(alpha: number): SeqSide {
  const [P, Q] = limitDenominator(alpha, 1 << 20)
  return accWord(alpha) / 4294967296 < P / Q ? 'left' : 'right'
}

/** 回傳 n ↦ (ρ[n], p[n]) 的函式（任意整數 n，含負值） */
export function makeSequence(alpha: number, seq: SeqKind = 'acc32'): (n: number, out: PhaseSample) => void {
  if (seq === 'acc32') {
    const ai = accWord(alpha)
    return (n, out) => seqAccAt(ai, n, out)
  }
  const [P, Q] = limitDenominator(alpha, 1 << 16)
  return (n, out) => seqRationalAt(P, Q, n, seq, out)
}

/** α = P/Q 一個週期的 9 條 regressor：X[0] = ρ，X[1+k] = 1{p = k}（每條長度 Q） */
export function xRational(P: number, Q: number, side: SeqSide = 'right'): Float64Array[] {
  const X = Array.from({ length: NREG }, () => new Float64Array(Q))
  const s: PhaseSample = { c: 0, p: 0 }
  for (let n = 0; n < Q; n++) {
    seqRationalAt(P, Q, n, side, s)
    X[0][n] = s.c
    X[1 + s.p][n] = 1
  }
  return X
}

// ─────────────────────────────────────────────────────────────────────────────
// 精確週期穩態（有理數 α）
// ─────────────────────────────────────────────────────────────────────────────

export interface CPeriodicResult {
  /** 9×9 平均 GMAC 矩陣 C_ij = ⟨r_i (h_PD * x_j)⟩ */
  C: Matrix
  /** raw regressor 的 covariance（判斷可觀測子空間用） */
  cov: Matrix
  mean: number[]
}

// #region core:cPeriodic
/**
 * α = P/Q 的 Q-週期 regressor 的精確長期 C（包含所有譜線；ℓ = 0 那條乘上 Γ_eff(0)，Type ≥ I 時為 0）。
 * 這就是 Parseval：C_ij = Σ_k conj(F_i[k])·Γ_eff(k/Q)·F_j[k]，F = DFT(x)/Q。
 */
export function cPeriodic(P: number, Q: number, Geff: Kernel, side: SeqSide = 'right'): CPeriodicResult {
  const X = xRational(P, Q, side)
  const Fre: Float64Array[] = []
  const Fim: Float64Array[] = []
  for (let i = 0; i < NREG; i++) {
    const re = Float64Array.from(X[i])
    const im = new Float64Array(Q)
    fft(re, im)
    for (let k = 0; k < Q; k++) {
      re[k] /= Q
      im[k] /= Q
    }
    Fre.push(re)
    Fim.push(im)
  }
  const Gre = new Float64Array(Q)
  const Gim = new Float64Array(Q)
  for (let k = 0; k < Q; k++) {
    const g = Geff(k / Q)
    Gre[k] = g.re
    Gim[k] = g.im
  }
  const C: Matrix = Array.from({ length: NREG }, () => new Array<number>(NREG).fill(0))
  for (let i = 0; i < NREG; i++) {
    for (let j = 0; j < NREG; j++) {
      let acc = 0
      for (let k = 0; k < Q; k++) {
        // Re{conj(F_i)·Γ·F_j}
        const tr = Fre[i][k] * Gre[k] + Fim[i][k] * Gim[k]
        const ti = Fre[i][k] * Gim[k] - Fim[i][k] * Gre[k]
        acc += tr * Fre[j][k] - ti * Fim[j][k]
      }
      C[i][j] = acc
    }
  }
  const mean = X.map((x) => x.reduce((a, b) => a + b, 0) / Q)
  const cov: Matrix = Array.from({ length: NREG }, (_, i) =>
    Array.from({ length: NREG }, (_, j) => {
      let acc = 0
      for (let n = 0; n < Q; n++) acc += X[i][n] * X[j][n]
      return acc / Q - mean[i] * mean[j]
    }),
  )
  return { C, cov, mean }
}
// #endregion core:cPeriodic

function subMatrix(A: Matrix, idx: number[]): Matrix {
  return idx.map((i) => idx.map((j) => A[i][j]))
}

/** covariance 子區塊中非零（可觀測）方向的正交基底（欄向量） */
function obsBasis(cov: Matrix, idx: number[], tol = 1e-7): number[][] {
  const Cs = subMatrix(cov, idx)
  let tr = 0
  for (let i = 0; i < idx.length; i++) tr += Cs[i][i]
  const { values, vectors } = eigSym(Cs)
  const cols: number[][] = []
  for (let k = 0; k < values.length; k++) {
    if (values[k] > tol * Math.max(tr, 1e-30)) cols.push(vectors.map((row) => row[k]))
  }
  return cols
}

function projected(Cs: Matrix, basis: number[][]): Matrix {
  const n = basis.length
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let acc = 0
      for (let i = 0; i < Cs.length; i++) for (let j = 0; j < Cs.length; j++) acc += basis[a][i] * Cs[i][j] * basis[b][j]
      out[a][b] = acc
    }
  }
  return out
}

/** λ_m = v_mᴴ C v_m/8，v_m[k] = e^{j2πmk/8}（C 為 circulant 時是精確特徵值；否則是 Rayleigh quotient） */
export function dftModeEigs(Cpp: Matrix): Complex[] {
  const out: Complex[] = []
  for (let m = 0; m < NPH; m++) {
    let re = 0
    let im = 0
    for (let j = 0; j < NPH; j++) {
      for (let k = 0; k < NPH; k++) {
        const th = (TWO_PI * m * (k - j)) / NPH
        re += Cpp[j][k] * Math.cos(th)
        im += Cpp[j][k] * Math.sin(th)
      }
    }
    out.push({ re: re / NPH, im: im / NPH })
  }
  return out
}

export interface CAnalysis {
  gosObservable: boolean
  /** C[0][0]（GOS 的自我斜率）；不可觀測時為 NaN */
  gos: number
  /** C 限制在可觀測 PHOS 子空間（共模自動剔除）後的 min Re eig */
  phosMinRe: number
  phosEigs: Complex[]
  phosNObs: number
  /** joint 9×9（可觀測子空間）的 min Re eig */
  jointMinRe: number
  jointNObs: number
  dftLambda: Complex[]
}

export function analyseC(C: Matrix, cov: Matrix): CAnalysis {
  const gosObservable = cov[0][0] > 1e-9
  const pIdx = Array.from({ length: NPH }, (_, i) => 1 + i)
  const Vp = obsBasis(cov, pIdx)
  let phosEigs: Complex[] = []
  if (Vp.length) phosEigs = eigvals(projected(subMatrix(C, pIdx), Vp)).sort((a, b) => a.re - b.re)
  const jIdx = Array.from({ length: NREG }, (_, i) => i)
  const Vj = obsBasis(cov, jIdx)
  const jointEigs = Vj.length ? eigvals(projected(C, Vj)) : []
  return {
    gosObservable,
    gos: gosObservable ? C[0][0] : NaN,
    phosMinRe: phosEigs.length ? Math.min(...phosEigs.map((e) => e.re)) : NaN,
    phosEigs,
    phosNObs: Vp.length,
    jointMinRe: jointEigs.length ? Math.min(...jointEigs.map((e) => e.re)) : NaN,
    jointNObs: Vj.length,
    dftLambda: dftModeEigs(subMatrix(C, pIdx)),
  }
}

export interface KappaRational {
  P: number
  Q: number
  side: SeqSide
  /** PHOS：min Re eig / 開迴路 min eig（8 | Q 時 = 8 min_m Re λ_m） */
  kP: number
  /** PHOS 可觀測子空間的 min Re eig（未正規化；×8 即文件的「8λ_min」） */
  phosMinRe: number
  /** 開迴路（H ≡ 1、raw）的 PHOS min eig：正規化參考（occupancy 均勻時為 1/8） */
  refP: number
  /** GOS：C_GOS/var(ρ)（長週期時 = 12 C_GOS） */
  kG: number
  /** joint 9×9 的 min Re eig / PHOS 開迴路參考 */
  kJ: number
  /** κ_m = 8λ_m，m = 1..7 */
  km: Complex[]
  phosNObs: number
  varRho: number
  meanRho: number
  occupancy: number[]
  /** max |C_{0,k}|（GOS–PHOS 耦合；8 | Q 時為 0） */
  coupling: number
}

/** α = P/Q 的精確週期 κ（理想注入模型），正規化同 golden 的 kappa_rational */
export function kappaRational(loop: SspllLoop, P: number, Q: number, variant = 'raw', models?: LoopModels, side: SeqSide = 'right'): KappaRational {
  const { C, cov, mean } = cPeriodic(P, Q, gammaEff(loop, variant, models), side)
  const C0 = cPeriodic(P, Q, gammaEff(null, 'raw', undefined, true), side).C
  const a = analyseC(C, cov)
  const a0 = analyseC(C0, cov)
  const refP = a0.phosMinRe
  const ok = Number.isFinite(refP) && refP > 0
  let coupling = 0
  for (let k = 1; k < NREG; k++) coupling = Math.max(coupling, Math.abs(C[0][k]), Math.abs(C[k][0]))
  return {
    P,
    Q,
    side,
    kP: ok ? a.phosMinRe / refP : NaN,
    phosMinRe: a.phosMinRe,
    refP,
    kG: a.gosObservable ? a.gos / cov[0][0] : NaN,
    kJ: ok ? a.jointMinRe / refP : NaN,
    km: a.dftLambda.slice(1).map((l) => ({ re: NPH * l.re, im: NPH * l.im })),
    phosNObs: a.phosNObs,
    varRho: cov[0][0],
    meanRho: mean[0],
    occupancy: mean.slice(1),
    coupling,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 大訊號（1-bit 比較器，A ≫ σ_v）
// ─────────────────────────────────────────────────────────────────────────────

/** 時域 sim 的物理設定（單位 ps）：比較器雜訊 σ_v、Δ = T_vco/8、DTC 增益誤差 a、PMUX 偏差 ε_k */
export interface SspllSimCfg {
  sigmaPs: number
  deltaPs: number
  a: number
  epsPs: number[]
}

/** sim 注入模型在校準點的欄混合：∂u/∂θ_g = −(1−a)(ρ + ε_p/Δ)，∂u/∂θ_k = −1{p = k}；C_phys = C_ideal·Mx */
export function physicalMix(cfg: SspllSimCfg | null): Matrix {
  const Mx: Matrix = Array.from({ length: NREG }, (_, i) => Array.from({ length: NREG }, (_, j) => (i === j ? 1 : 0)))
  if (!cfg) return Mx
  Mx[0][0] = 1 - cfg.a
  for (let k = 0; k < NPH; k++) Mx[1 + k][0] = ((1 - cfg.a) * cfg.epsPs[k]) / cfg.deltaPs
  return Mx
}

/** 大訊號分析的 6 個方向（θ = [w_gΔ, w_0..w_7]）：GOS 與 PHOS 的實數 DFT 模態 */
export function largeSignalDirs(): Record<string, number[]> {
  const mk = (fn: (k: number) => number): number[] => {
    const v = Array.from({ length: NPH }, (_, k) => fn(k))
    const nrm = Math.hypot(...v)
    return [0, ...v.map((x) => x / nrm)]
  }
  return {
    gos: [1, ...new Array<number>(NPH).fill(0)],
    phos_m1c: mk((k) => Math.cos((TWO_PI * k) / 8)),
    phos_m1s: mk((k) => Math.sin((TWO_PI * k) / 8)),
    phos_m2c: mk((k) => Math.cos((TWO_PI * 2 * k) / 8)),
    phos_m3c: mk((k) => Math.cos((TWO_PI * 3 * k) / 8)),
    phos_m4: mk((k) => Math.cos(Math.PI * k)),
  }
}

export interface LargeSignalDir {
  /** 線性相關 ⟨y z⟩（「面積」） */
  lin: number
  /** 1-bit 相關 ⟨sgn(y) z⟩（「同號的時間比例」） */
  signCorr: number
  signCorrOpenLoop: number
  /** κ_∞ = ⟨sgn(y) z⟩/|⟨sgn(d) x⟩| */
  kappaInf: number
}

// #region core:largeSignal
/**
 * A → ∞ 的割線斜率（精確週期）：沿方向 v，y_v = h_PD * d_v 是 PD 的響應，z_v 是對應的 GMAC regressor。
 * 線性相關看 y·z 的「面積」；1-bit 相關只看 sgn(y) 與 z 同號的「持續時間」。
 */
export function largeSignalPeriodic(
  loop: SspllLoop,
  P: number,
  Q: number,
  cfg: SspllSimCfg,
  variant = 'raw',
  models?: LoopModels,
  side: SeqSide = 'right',
): Record<string, LargeSignalDir> {
  const X = xRational(P, Q, side)
  const Mx = physicalMix(cfg)
  const base = variant === 'ac' || variant === 'zm' ? 'raw' : variant
  // GMAC regressor R = g * x（頻域相乘再轉回時域）
  const R = X.map((x, i) => {
    const re = Float64Array.from(x)
    const im = new Float64Array(Q)
    fft(re, im)
    for (let k = 0; k < Q; k++) {
      const g = variantG(base, k / Q, models)
      const tr = re[k] * g.re - im[k] * g.im
      im[k] = re[k] * g.im + im[k] * g.re
      re[k] = tr
    }
    ifft(re, im)
    if (variant === 'ac' || variant === 'zm') {
      const sub = i === 0 ? 0.5 : variant === 'zm' ? 1 / NPH : 0 // regressor 的 DC 會影響 1-bit 相關
      for (let n = 0; n < Q; n++) re[n] -= sub
    }
    return re
  })
  const Hre = new Float64Array(Q)
  const Him = new Float64Array(Q)
  for (let k = 0; k < Q; k++) {
    const h = loopH(loop, k / Q)
    Hre[k] = h.re
    Him[k] = h.im
  }
  const out: Record<string, LargeSignalDir> = {}
  for (const [name, v] of Object.entries(largeSignalDirs())) {
    const mv = Mx.map((row) => row.reduce((acc, m, j) => acc + m * v[j], 0))
    const d = new Float64Array(Q)
    const z = new Float64Array(Q)
    const zr = new Float64Array(Q)
    for (let i = 0; i < NREG; i++) {
      for (let n = 0; n < Q; n++) {
        d[n] += X[i][n] * mv[i] // 誤差方向 v 在比較點的注入
        z[n] += R[i][n] * v[i] // GMAC 實際使用的 regressor
        zr[n] += X[i][n] * v[i] // raw regressor（開迴路參考）
      }
    }
    const yr = Float64Array.from(d)
    const yi = new Float64Array(Q)
    fft(yr, yi)
    for (let k = 0; k < Q; k++) {
      const tr = yr[k] * Hre[k] - yi[k] * Him[k]
      yi[k] = yr[k] * Him[k] + yi[k] * Hre[k]
      yr[k] = tr
    }
    ifft(yr, yi) // y = h_PD * d
    let lin = 0
    let sCl = 0
    let sOl = 0
    for (let n = 0; n < Q; n++) {
      lin += yr[n] * z[n]
      sCl += Math.sign(yr[n]) * z[n] // ← 1-bit：只看符號
      sOl += Math.sign(d[n]) * zr[n]
    }
    lin /= Q
    sCl /= Q
    sOl /= Q
    out[name] = { lin, signCorr: sCl, signCorrOpenLoop: sOl, kappaInf: Math.abs(sOl) > 1e-12 ? sCl / Math.abs(sOl) : NaN }
  }
  return out
}
// #endregion core:largeSignal

export function kappaInfWorst(ls: Record<string, LargeSignalDir>): number {
  let worst = Infinity
  for (const v of Object.values(ls)) if (Number.isFinite(v.kappaInf)) worst = Math.min(worst, v.kappaInf)
  return worst
}

// ─────────────────────────────────────────────────────────────────────────────
// 時域：GMAC regressor 的變體（閉迴路 LMS 使用的就是這幾個函式）
// ─────────────────────────────────────────────────────────────────────────────

/** 取得 raw regressor 列 x[n]（長度 9）：x[0] = ρ[n]，x[1+p[n]] = 1 */
type RowFn = (n: number, out: Float64Array) => void

// #region core:regRaw
/** raw：r[n] = x[n]（G = 1） */
function regRaw(x: RowFn, n: number, r: Float64Array): void {
  x(n, r) // r[n] = x[n]
}
// #endregion core:regRaw

// #region core:regZeroMean
/** ac／zm：去掉標稱平均（GOS 的 1/2；zm 再去掉 PHOS 的 1/8） */
function regZeroMean(x: RowFn, n: number, r: Float64Array, phosToo: boolean): void {
  x(n, r)
  r[0] -= 0.5 // ← 差異：GOS 去掉標稱平均 1/2（ac）
  if (phosToo) for (let k = 1; k < NREG; k++) r[k] -= 1 / NPH // ← 差異：PHOS 也去平均 1/8（zm：zero-mean）
}
// #endregion core:regZeroMean

// #region core:regDelay
/** D:k：相關器延遲，r[n] = x[n − D]（G = z^-D）——有害 */
function regDelay(x: RowFn, n: number, r: Float64Array, D: number): void {
  x(n - D, r) // ← 差異：r[n] = x[n − D]（相關器晚 D 拍）
}
// #endregion core:regDelay

// #region core:regDiff1
/** 1diff：一階差分，r[n] = x[n] − x[n−1]（G = 1 − z⁻¹）——推薦 */
function regDiff1(x: RowFn, n: number, r: Float64Array, tmp: Float64Array): void {
  x(n, r)
  x(n - 1, tmp)
  for (let i = 0; i < NREG; i++) r[i] -= tmp[i] // ← 差異：r[n] = x[n] − x[n−1]
}
// #endregion core:regDiff1

// #region core:regDiff2
/** 2diff：二階差分，r[n] = x[n] − 2x[n−1] + x[n−2]（G = (1 − z⁻¹)²）——有害 */
function regDiff2(x: RowFn, n: number, r: Float64Array, tmp: Float64Array): void {
  x(n, r)
  x(n - 1, tmp)
  for (let i = 0; i < NREG; i++) r[i] -= 2 * tmp[i] // ← 差異：−2x[n−1]
  x(n - 2, tmp)
  for (let i = 0; i < NREG; i++) r[i] += tmp[i] // ← 差異：+x[n−2]（二階差分）
}
// #endregion core:regDiff2

// #region core:regFx
/** fx：filtered-x，r = ĥ_PD * x（G = Ĥ_PD）；9 條 IIR 以 f_ref 全速更新 state */
function regFx(x: RowFn, n: number, r: Float64Array, filters: IirState[]): void {
  x(n, r)
  for (let i = 0; i < NREG; i++) r[i] = filters[i].step(r[i]) // ← 差異：r = Ĥ_PD·x（每條 regressor 一個 IIR）
}
// #endregion core:regFx

/** 建立「第 n 拍的 GMAC regressor 列」產生器（fx 有狀態：必須從 n = 0 起依序呼叫） */
function makeRegressor(variant: string, x: RowFn, models?: LoopModels): (n: number, r: Float64Array) => void {
  const tmp = new Float64Array(NREG)
  if (variant === 'raw') return (n, r) => regRaw(x, n, r)
  if (variant === 'ac') return (n, r) => regZeroMean(x, n, r, false)
  if (variant === 'zm') return (n, r) => regZeroMean(x, n, r, true)
  if (variant.startsWith('D:')) {
    const D = Number(variant.slice(2))
    return (n, r) => regDelay(x, n, r, D)
  }
  if (variant === '1diff') return (n, r) => regDiff1(x, n, r, tmp)
  if (variant === '2diff') return (n, r) => regDiff2(x, n, r, tmp)
  if (variant.startsWith('1diffD:')) {
    const k = Number(variant.slice(7))
    return (n, r) => regDiff1(x, n - k, r, tmp)
  }
  if (variant.startsWith('fx:')) {
    const m = fxModel(variant, models)
    const filters = Array.from({ length: NREG }, () => new IirState(m.bH, m.aH))
    return (n, r) => regFx(x, n, r, filters)
  }
  throw new Error(`未知的 regressor 變體：${variant}`)
}

/** raw regressor 列的產生器 */
function makeRowFn(alpha: number, seq: SeqKind): RowFn {
  const at = makeSequence(alpha, seq)
  const s: PhaseSample = { c: 0, p: 0 }
  return (n, out) => {
    at(n, s)
    out.fill(0)
    out[0] = s.c
    out[1 + s.p] = 1
  }
}

/** 產生 n = 0..len−1 的 GMAC regressor（len × 9，row-major）；給測試與手算表使用 */
export function regressorRows(alpha: number, variant: string, len: number, seq: SeqKind = 'acc32', models?: LoopModels): Float64Array {
  const reg = makeRegressor(variant, makeRowFn(alpha, seq), models)
  const out = new Float64Array(len * NREG)
  const r = new Float64Array(NREG)
  for (let n = 0; n < len; n++) {
    reg(n, r)
    out.set(r, n * NREG)
  }
  return out
}

/** 前 len 拍的 (ρ[n], p[n])（手算表用） */
export function phaseSequence(alpha: number, len: number, seq: SeqKind = 'right'): { rho: number[]; p: number[] } {
  const at = makeSequence(alpha, seq)
  const s: PhaseSample = { c: 0, p: 0 }
  const rho: number[] = []
  const p: number[] = []
  for (let n = 0; n < len; n++) {
    at(n, s)
    rho.push(s.c)
    p.push(s.p)
  }
  return { rho, p }
}

// ─────────────────────────────────────────────────────────────────────────────
// 閉迴路 sign-error block LMS（真 1-bit 比較器）
// ─────────────────────────────────────────────────────────────────────────────

export interface SspllLmsParams {
  loop: SspllLoop
  alpha: number
  /** GMAC regressor 變體：'raw' | 'ac' | 'zm' | '1diff' | '2diff' | 'D:k' | '1diffD:k' | 'fx:<模型名>' */
  variant: string
  /** filtered-x 的模型（variant = 'fx:<名稱>' 時需要） */
  models?: LoopModels
  cfg: SspllSimCfg
  /** block 數（預設 4000） */
  nBlocks?: number
  /** 每個 GMAC block 的比較器 sample 數 N（預設 512） */
  nBlk?: number
  /** 開迴路（H ≡ 1）時的時間常數 N_τ [blocks]（預設 25） */
  tauBlocks?: number
  seed?: number
  /** 每幾個 block 記錄一次（預設 20） */
  recEvery?: number
  /** LMS 凍結、先讓 PLL settle 的 sample 數（預設 4096） */
  nSettle?: number
  /** 獨立雜訊 lane 數（預設 1） */
  lanes?: number
  /** 比較器輸入端的靜態 offset [ps]（預設 0） */
  uOsPs?: number
  seq?: SeqKind
}

export interface SspllLmsResult {
  variant: string
  alpha: number
  /** 記錄點的 block 編號 */
  block: Float64Array
  /** PHOS 誤差 rms [fs]（去掉共模；各 lane 的中位數） */
  phosRmsFs: Float64Array
  /** |PHOS 共模| [fs]（各 lane 的中位數） */
  phosCmAbsFs: Float64Array
  /** |GOS 誤差| [fs]（code = 1 時；各 lane 的中位數） */
  gosAbsFs: Float64Array
  muG: number
  muP: number
  initPhosRmsFs: number
  finalPhosRmsFs: number
  maxPhosRmsFs: number
  finalGosFs: number
  finalPhosCmFs: number
  /** 權重超過 10⁶ ps 而提前停止（線性模型下的數值發散） */
  aborted: boolean
  samples: number
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])
}

// #region core:signLmsBlock
/**
 * Sign-error block LMS（一個 GMAC block = nBlk 個比較器 sample；golden：simulator.py 的 run_sign_lms）：
 *   u[n]   = ρΔ + ε_p − (1−a)(1+w_g)(ρΔ + w_p)      物理注入模型 [ps]
 *   e_PD   = h_PD * u
 *   q[n]   = sign(e_PD[n] + v[n] + u_os)             1-bit 比較器
 *   w_g   += μ_g·mean(q·r_0)，w_k += μ_p·mean(q·r_{1+k})
 * 步長：開迴路時間常數 N_τ，並對變體的 regressor 功率做 NLMS 式正規化。不同對策只差在 r 怎麼來。
 */
export function runSspllLms(params: SspllLmsParams): SspllLmsResult {
  const { loop, alpha, variant, models, cfg } = params
  const nBlocks = params.nBlocks ?? 4000
  const nBlk = params.nBlk ?? 512
  const tau = params.tauBlocks ?? 25
  const recEvery = params.recEvery ?? 20
  const nSettle = params.nSettle ?? 4096
  const lanes = params.lanes ?? 1
  const uOs = params.uOsPs ?? 0
  const seq = params.seq ?? 'acc32'
  const { sigmaPs: sig, deltaPs: Dl, a } = cfg
  const eps = cfg.epsPs
  const rowFn = makeRowFn(alpha, seq)

  // 步長：開迴路時間常數 τ + regressor 功率正規化（前 2¹⁵ 拍，去掉前 2¹² 拍）
  const ccmp = Math.sqrt(2 / Math.PI) / sig
  let muP = 8 / (tau * ccmp)
  let muG = 12 / (tau * ccmp * Dl)
  {
    const pre = makeRegressor(variant, rowFn, models)
    const r = new Float64Array(NREG)
    let s0 = 0
    let s00 = 0
    let sp = 0
    let cnt = 0
    for (let n = 0; n < 1 << 15; n++) {
      pre(n, r)
      if (n < 1 << 12) continue
      s0 += r[0]
      s00 += r[0] * r[0]
      for (let k = 1; k < NREG; k++) sp += r[k] * r[k]
      cnt++
    }
    const var0 = s00 / cnt - (s0 / cnt) ** 2
    muG *= 1 / 12 / Math.max(var0, 1e-12)
    muP *= 1 / 8 / Math.max(sp / (cnt * NPH), 1e-12)
  }

  const rng = createRng(params.seed ?? 3)
  const noise = Array.from({ length: lanes }, (_, l) => rng.fork(`comparator-noise-${l}`))
  const wg = new Float64Array(lanes)
  const W = Array.from({ length: lanes }, () => new Float64Array(NPH))
  const filt = Array.from({ length: lanes }, () => new IirState(loop.bH, loop.aH))
  const reg = makeRegressor(variant, rowFn, models)
  const at = makeSequence(alpha, seq)
  const ph: PhaseSample = { c: 0, p: 0 }
  const r = new Float64Array(NREG)
  const G = Array.from({ length: lanes }, () => new Float64Array(NREG))
  const recBlock: number[] = []
  const recRms: number[] = []
  const recCm: number[] = []
  const recGos: number[] = []

  const record = (b: number): void => {
    const rms: number[] = []
    const cm: number[] = []
    const gos: number[] = []
    for (let l = 0; l < lanes; l++) {
      const gain = (1 - a) * (1 + wg[l])
      let mean = 0
      for (let k = 0; k < NPH; k++) mean += gain * W[l][k] - eps[k]
      mean /= NPH
      let ss = 0
      for (let k = 0; k < NPH; k++) ss += (gain * W[l][k] - eps[k] - mean) ** 2
      rms.push(Math.sqrt(ss / NPH) * 1000)
      cm.push(Math.abs(mean) * 1000)
      gos.push(Math.abs((gain - 1) * Dl) * 1000)
    }
    recBlock.push(b)
    recRms.push(median(rms))
    recCm.push(median(cm))
    recGos.push(median(gos))
  }

  // 一拍：注入誤差 → 迴路 → （可選）比較器與 GMAC 累加
  const sample = (n: number, adapt: boolean): void => {
    at(n, ph) // ρ[n]、p[n]
    reg(n, r) // r[n]：GMAC regressor（對策只差在這一行）
    const c = ph.c
    const p = ph.p
    for (let l = 0; l < lanes; l++) {
      const gain = (1 - a) * (1 + wg[l])
      const u = c * Dl + eps[p] - gain * (c * Dl + W[l][p]) // 注入的時間誤差 u[n]
      const e = filt[l].step(u) // e_PD = h_PD * u
      if (!adapt) continue
      const q = Math.sign(e + sig * noise[l].normal() + uOs) // 1-bit 比較器
      const Gl = G[l]
      for (let i = 0; i < NREG; i++) Gl[i] += q * r[i] // GMAC：Σ q·r_i
    }
  }

  let n0 = 0
  while (n0 < nSettle) {
    for (let n = n0; n < n0 + nBlk; n++) sample(n, false) // LMS 凍結，先讓 PLL settle
    n0 += nBlk
  }
  let aborted = false
  let done = 0
  for (let b = 0; b < nBlocks; b++) {
    if (b % recEvery === 0) record(b)
    for (let l = 0; l < lanes; l++) G[l].fill(0)
    for (let n = n0; n < n0 + nBlk; n++) sample(n, true)
    n0 += nBlk
    done = b + 1
    let big = 0
    for (let l = 0; l < lanes; l++) {
      wg[l] += (muG * G[l][0]) / nBlk // GOS 更新
      for (let k = 0; k < NPH; k++) {
        W[l][k] += (muP * G[l][1 + k]) / nBlk // PHOS 更新
        big = Math.max(big, Math.abs(W[l][k]))
      }
      big = Math.max(big, Math.abs(wg[l] * Dl))
    }
    if (!(big < 1e6)) {
      aborted = true
      break
    }
  }
  record(done)
  return {
    variant,
    alpha,
    block: Float64Array.from(recBlock),
    phosRmsFs: Float64Array.from(recRms),
    phosCmAbsFs: Float64Array.from(recCm),
    gosAbsFs: Float64Array.from(recGos),
    muG,
    muP,
    initPhosRmsFs: recRms[0],
    finalPhosRmsFs: recRms[recRms.length - 1],
    maxPhosRmsFs: Math.max(...recRms),
    finalGosFs: recGos[recGos.length - 1],
    finalPhosCmFs: recCm[recCm.length - 1],
    aborted,
    samples: n0 * lanes,
  }
}
// #endregion core:signLmsBlock

export interface SspllLmsCase {
  id: string
  loop: SspllLoop
  variant: string
  models?: LoopModels
}

export interface SspllLmsCompareParams {
  common: Omit<SspllLmsParams, 'loop' | 'variant' | 'models'>
  cases: SspllLmsCase[]
}

export interface SspllLmsCompareResult {
  cases: { id: string; result: SspllLmsResult }[]
}

/** 同一組 α、seed、雜訊設定下比較多個 regressor／迴路（給 Web Worker 呼叫） */
export function runSspllLmsCompare(p: SspllLmsCompareParams): SspllLmsCompareResult {
  return { cases: p.cases.map((c) => ({ id: c.id, result: runSspllLms({ ...p.common, loop: c.loop, variant: c.variant, models: c.models }) })) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 給頁面用的彙整函式
// ─────────────────────────────────────────────────────────────────────────────

export interface HpdSweep {
  fMHz: Float64Array
  reH: Float64Array
  imH: Float64Array
  absH: Float64Array
  phaseDeg: Float64Array
  absT: Float64Array
  reL: Float64Array
  /** 各變體的 Re Γ_eff */
  reGamma: Record<string, Float64Array>
}

/** 在指定頻率格點（MHz）上計算 H_PD、T、Re L 與各 regressor 變體的 Re Γ_eff */
export function hpdSweep(loop: SspllLoop, fMHz: ArrayLike<number>, fRefHz = F_REF, variants: string[] = [], models?: LoopModels): HpdSweep {
  const n = fMHz.length
  const out: HpdSweep = {
    fMHz: Float64Array.from(fMHz),
    reH: new Float64Array(n),
    imH: new Float64Array(n),
    absH: new Float64Array(n),
    phaseDeg: new Float64Array(n),
    absT: new Float64Array(n),
    reL: new Float64Array(n),
    reGamma: Object.fromEntries(variants.map((v) => [v, new Float64Array(n)])),
  }
  const kernels = variants.map((v) => gammaEff(loop, v, models))
  for (let i = 0; i < n; i++) {
    const f = (fMHz[i] * 1e6) / fRefHz
    const H = loopH(loop, f)
    out.reH[i] = H.re
    out.imH[i] = H.im
    out.absH[i] = cAbs(H)
    out.phaseDeg[i] = (Math.atan2(H.im, H.re) * 180) / Math.PI
    out.absT[i] = cAbs(loopT(loop, f))
    out.reL[i] = loopL(loop, f).re
    for (let k = 0; k < variants.length; k++) out.reGamma[variants[k]][i] = kernels[k](f).re
  }
  return out
}

export interface AlphaAnalysis {
  alpha: number
  /** 折到 [0, ½] 的 PMUX 旋轉頻率 min(α, 1−α)（正規化） */
  fRot: number
  beta: number
  /** κ_m = 8λ_m，m = 1..7（ergodic 諧波和） */
  kappaM: Complex[]
  /** κ_PHOS = 8 min_m Re λ_m 與對應的模態 */
  kappaPhos: number
  worstMode: number
  /** κ_GOS = 12 C_GOS */
  kappaGos: number
  /** 單線近似 W₁ Re Γ_eff(α) */
  singleLine: number
  /** mode-1 的嚴格界限 */
  m1Lower: number
  m1Upper: number
  /** Re Γ_eff 在 α·f_ref 的值 */
  reGammaAtAlpha: number
}

/** 某個 α 的 ergodic 分析（PHOS 各模態、GOS、單線近似與 mode-1 界限） */
export function analyseAlpha(loop: SspllLoop, alpha: number, variant = 'raw', models?: LoopModels, M = 8192): AlphaAnalysis {
  const G = gammaEff(loop, variant, models)
  const mean = kernelMean(G)
  const lam = phosLambdaHarmonic(alpha, G, M, mean)
  const kappaM = lam.slice(1).map((l) => ({ re: NPH * l.re, im: NPH * l.im }))
  let worstMode = 1
  // λ_{8−m} = conj(λ_m)：實部並列時回報較小的 m
  for (let m = 2; m <= 7; m++) if (kappaM[m - 1].re < kappaM[worstMode - 1].re - 1e-12) worstMode = m
  const range = kernelReRange(G, 4001)
  const ga = G(frac(alpha)).re
  const a = frac(alpha)
  return {
    alpha,
    fRot: Math.min(a, 1 - a),
    beta: frac(NPH * alpha),
    kappaM,
    kappaPhos: kappaM[worstMode - 1].re,
    worstMode,
    kappaGos: 12 * gosHarmonic(alpha, G, M, mean),
    singleLine: W1 * ga,
    m1Lower: W1 * ga + (1 - W1) * range.min,
    m1Upper: W1 * ga + (1 - W1) * range.max,
    reGammaAtAlpha: ga,
  }
}
