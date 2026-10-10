/**
 * Dashboard 上「15 個問題」預覽與 Hero 手算所用的數字——全部由公式或模擬即時計算，不手打結果。
 * 每一個數字都對應規格 §17 的 T-id，並在 previews.test.ts 與 golden/vectors 交叉比對。
 */
import { batchOptima, fixedXMuMax, gaussianAlmostSureMuMax, meanSquareMuMax, runScalarLms } from '@/simulation/models/lms'
import { binomPmf, binomSf, cAbs, erf, fsToRad, normCdf, normInv, polyRoots } from '@/simulation/core'
import { blocksTo95, comparatorGain, criticalGain, phaseMarginDeg, polarityOf } from './thesisModel'

/** T01：手算 LMS（a = 3、w₀ = 1、x = 2、μ = 0.1），直接呼叫網站共用的 runScalarLms */
export function handExample() {
  const a = 3
  const x = 2
  const mu = 0.1
  const r = runScalarLms({ variant: 'conventional', a, w0: 1, mu, steps: 3, x: { kind: 'fixed', value: x } })
  return { a, x, mu, y: a * x, w: Array.from(r.w), e: Array.from(r.e), pole: 1 - mu * x * x }
}

/** 奇數 N 沒有 tie（勘誤 E02）：在奇數 N 中找最小的 N 使 P(G_N > 0) = P(K > (N−1)/2) ≥ target（K ~ Bin(N, p)） */
export function exactOddN(p: number, target: number, start: number): number {
  let n = Math.max(1, Math.floor(start) - 400)
  if (n % 2 === 0) n -= 1
  if (n < 1) n = 1
  for (let i = 0; i < 2000; i++, n += 2) {
    if (binomSf((n - 1) / 2, n, p) >= target) return n
  }
  return NaN
}

/** 勘誤 E02 的例子：偶數 N 時 G_N = 2K − N 可能為 0（tie）。回傳嚴格 P(G>0)、P(G=0) 與平分 tie 的值。 */
export function evenNTie(N = 100, sOverSigma = 0.01) {
  const p = normCdf(sOverSigma)
  const strict = binomSf(N / 2, N, p) // P(K > N/2)
  const tie = binomPmf(N / 2, N, p) // P(K = N/2)
  return { N, strict, tie, split: strict + tie / 2 }
}

/** |x| 加權中位數：無雜訊 Sign-LMS 的固定點 E[x·sign(e)] = 0（勘誤 E01 的 1.4） */
export function signLmsNoiseFreeGain(values: number[], probs: number[], a: number, c3: number): number {
  // e = (a − w)x + c3 x³ = x[(a + c3 x²) − w]；x·sign(e) = |x|·sign(s_x − w)，s_x = a + c3 x²
  const items = values
    .map((x, i) => ({ s: a + c3 * x * x, wgt: Math.abs(x) * probs[i] }))
    .filter((it) => it.wgt > 0)
    .sort((u, v) => u.s - v.s)
  const total = items.reduce((t, it) => t + it.wgt, 0)
  let acc = 0
  for (const it of items) {
    acc += it.wgt
    if (acc >= total / 2 - 1e-15) return it.s
  }
  return NaN
}

/** 所有預覽數字（純函式；同一組數字也被測試拿去對 golden vectors） */
export function computePreviews() {
  // Q1：y = [0, 0, 0, 10] 的 MSE 最佳解（平均）vs MAE 最佳解（中位數區間）
  const q1 = batchOptima([0, 0, 0, 10])

  // Q3（T04）：s = 1 fs、σ_v = 100 fs
  const s = 1
  const sigmaV = 100
  const pPlus = normCdf(s / sigmaV)
  const meanQ = erf(s / (Math.SQRT2 * sigmaV))
  const Kq = comparatorGain(sigmaV)

  // Q4（T05）：CLT N ≈ (z_{0.95}·√(1 − m²)/m)²；精確（奇數 N，無 tie）
  const z95 = normInv(0.95)
  const nClt95 = (z95 * z95 * (1 - meanQ * meanQ)) / (meanQ * meanQ)
  const nOdd95 = exactOddN(pPlus, 0.95, nClt95)

  // Q5（T02）：固定 x = 2
  const x = 2
  const muOneStep = 1 / (x * x)
  const muMax = fixedXMuMax(x)

  // Q6（T03）：Gaussian E[x²] = 1、E[x⁴] = 3
  const meanMuMax = 2 / 1
  const msMuMax = meanSquareMuMax(1, 3)
  const asMuMax = gaussianAlmostSureMuMax(1) // 勘誤 E14：樣本路徑幾乎必然收斂的上限 ≈ 2.4212

  // Q7（T06）：A = 1（P_x = 1/2）、φ = 120°、μ = 10 fs、σ_v = 100 fs
  const t06 = polarityOf({ Px: 0.5, Hmag: 1, phiDeg: 120, omega: Math.PI / 6, D: 0 })
  const t06Pole = 1 - 10 * Kq * t06.C

  // Q8（T07）：φ = −120°、Ω = π/6、D = 4
  const t07 = polarityOf({ Px: 0.5, Hmag: 1, phiDeg: -120, omega: Math.PI / 6, D: 4 })

  // Q9（T08）：g = 1、d = 0
  const pm1 = phaseMarginDeg(1, 0)

  // Q10（T09）：雙迴路 z² − (1 + r)z + r + μbc = 0（勘誤 E19）
  const r = 0.8
  const b = 0.2
  const c = 1
  const mu = 1.2
  const dualRoots = polyRoots([1, -(1 + r), r + mu * b * c])
  const dualAbs = Math.max(...dualRoots.map(cAbs))
  const muMaxSimplified = (2 * (1 - r)) / (b * c)
  const muMaxFull = (1 - r) / (b * c)

  // Q11（T12）：x ∈ {−2, …, 2} 等機率、a = 1、c3 = 0.1
  const xs = [-2, -1, 0, 1, 2]
  const ps = xs.map(() => 1 / xs.length)
  const Ex2 = xs.reduce((t, v, i) => t + ps[i] * v ** 2, 0)
  const Ex4 = xs.reduce((t, v, i) => t + ps[i] * v ** 4, 0)
  const wMse = 1 + (0.1 * Ex4) / Ex2
  const wSign0 = signLmsNoiseFreeGain(xs, ps, 1, 0.1)

  // Q12（T10 / T11）：R = [[1, ρ], [ρ, 1]]、ρ = 0.99、μK_q = 0.5（正規化，勘誤 E05）
  const rho = 0.99
  const lamMax = 1 + rho
  const lamMin = 1 - rho
  const kappa = lamMax / lamMin
  const slowPole = 1 - 0.5 * lamMin
  const slowBlocks = blocksTo95(slowPole)

  // Q13（T11）：M = 0.5R⁻¹ → 所有 pole 0.5；弱方向雜訊放大 √κ
  const precondPole = 1 - 0.5
  const precondBlocks = blocksTo95(precondPole)
  const noiseAmp = Math.sqrt(kappa)

  // Q14（T13 / T15）：σ_w 與 spur
  const g13 = 10 * Kq * 1
  const p13 = 1 - g13
  const sigmaW = Math.sqrt((100 * (1 / 4096)) / (1 - p13 * p13))
  const spur = 20 * Math.log10(fsToRad(0.5, 13e9) / 2) // β/2，β = 2π f_out A_t（fs → rad 一律用 fsToRad）

  // Q15（T16 / T17）：目標 32.4 LSB
  const target = 32.4
  const freezeErr = Math.round(target) - target // w − w* = −0.4 LSB（勘誤 E49）
  const freezePower = freezeErr * freezeErr
  const pHigh = target - Math.floor(target)
  const twoLevelPower = pHigh * (1 - pHigh)

  return {
    q1,
    comparator: { s, sigmaV, pPlus, meanQ, Kq },
    n95: { z95, nClt95, nOdd95 },
    fixedX: { x, muOneStep, muMax },
    meanSquare: { meanMuMax, msMuMax, asMuMax },
    t06: { C: t06.C, pole: t06Pole },
    t07: { thetaDeg: t07.thetaDeg, C: t07.C, marginDeg: t07.marginDeg },
    pm: { g: 1, pmDeg: pm1, gStar1: criticalGain(1) },
    dual: { r, b, c, mu, absZ: dualAbs, muMaxSimplified, muMaxFull },
    inl: { Ex2, Ex4, wMse, wSign0 },
    pe: { rho, lamMax, lamMin, kappa, slowPole, slowBlocks },
    precond: { pole: precondPole, blocks: precondBlocks, noiseAmp },
    noise: { g: g13, p: p13, sigmaW, spur },
    quant: { target, freezeErr, freezePower, pHigh, twoLevelPower },
  }
}

export type Previews = ReturnType<typeof computePreviews>
