import { describe, expect, it } from 'vitest'
import {
  betaIncReg,
  betaIncRegPair,
  binomCdf,
  binomPmf,
  binomSf,
  erf,
  erfc,
  erfcx,
  lgamma,
  normCdf,
  normInv,
  normPdf,
  normSf,
  studentTCdf,
  studentTInv,
} from '@/simulation/core/special'

/** 相對誤差；參考值為 0 時退回絕對誤差 */
const rel = (a: number, b: number): number => (b === 0 ? Math.abs(a) : Math.abs((a - b) / b))

// 以下參考值皆以 mpmath（60 位數）或 SciPy 1.17 獨立計算後貼上
const ERF: [number, number][] = [
  [-6, -1.0], [-3, -0.9999779095030014], [-1, -0.8427007929497149], [-0.5, -0.5204998778130465],
  [-0.1, -0.1124629160182849], [1e-8, 1.1283791670955126e-8], [0.3, 0.3286267594591274],
  [0.46875, 0.49261347321793797], [0.5, 0.5204998778130465], [1, 0.8427007929497149], [2, 0.9953222650189527],
  [3.5, 0.9999992569016276], [4, 0.9999999845827421], [5, 0.9999999999984626], [6, 1.0],
]
const ERFC: [number, number][] = [
  [-5, 1.9999999999984626], [-1, 1.8427007929497148], [-0.2, 1.2227025892104784], [0, 1.0],
  [0.1, 0.887537083981715], [0.4, 0.5716076449533315], [0.5, 0.4795001221869535], [1, 0.15729920705028513],
  [2, 0.004677734981047266], [4, 1.541725790028002e-8], [4.5, 1.9661604415428876e-10], [6, 2.1519736712498913e-17],
  [10, 2.088487583762545e-45], [15, 7.212994172451207e-100], [20, 5.395865611607901e-176], [26, 5.663192408856143e-296],
]
const ERFCX: [number, number][] = [
  [-2, 108.94090438997797], [0, 1.0], [0.3, 0.7345993345676551], [1, 0.427583576155807], [5, 0.11070463773306863],
  [50, 0.011281536265323773], [1e4, 5.641895807268084e-5],
]
const NCDF: [number, number][] = [
  [-37.5, 4.605353009581955e-308], [-37, 5.725571222524577e-300], [-20, 2.7536241186062337e-89],
  [-10, 7.619853024160525e-24], [-5, 2.866515718791939e-7], [-3, 0.0013498980316300946], [-1, 0.15865525393145705],
  [-0.01, 0.4960106436853684], [0, 0.5], [0.01, 0.5039893563146316], [0.5, 0.6914624612740131],
  [1, 0.8413447460685429], [3, 0.9986501019683699], [8, 0.9999999999999993],
]
const NINV: [number, number][] = [
  [1e-300, -37.0470962993612], [1e-200, -30.20559417957964], [1e-50, -14.933337534788489],
  [1e-20, -9.262340089798407], [1e-10, -6.361340902404057], [1e-5, -4.264890793922825], [0.001, -3.0902323061678136],
  [0.02425, -1.972961051311885], [0.025, -1.9599639845400543], [0.1, -1.2815515655446004],
  [0.3, -0.5244005127080408], [0.6, 0.2533471031357997], [0.9, 1.2815515655446006], [0.975, 1.9599639845400538],
  [0.999, 3.090232306167813], [1 - 1e-10, 6.361340889697422], [1 - 1e-16, 8.209536151601387],
]
const LGAMMA: [number, number][] = [
  [1e-10, 23.025850929882736], [0.1, 2.252712651734206], [0.5, 0.5723649429247001], [1.5, -0.12078223763524522],
  [2.5, 0.2846828704729192], [3, 0.6931471805599453], [7.3, 7.147892523022248], [10, 12.801827480081469],
  [100.5, 361.4355404677776], [1e6, 12815504.569147611], [1e10, 220258509288.81058], [-0.5, 1.2655121234846454],
  [-2.5, -0.056243716497674054], [-10.3, -14.457515440024208],
]

describe('special：erf / erfc / erfcx（Cody，相對誤差 < 1e-14）', () => {
  it.each(ERF)('erf(%f)', (x, ref) => expect(rel(erf(x), ref)).toBeLessThan(1e-14))
  it.each(ERFC)('erfc(%f)（含尾端 erfc(10)、erfc(26)）', (x, ref) => expect(rel(erfc(x), ref)).toBeLessThan(1e-14))
  it.each(ERFCX)('erfcx(%f)', (x, ref) => expect(rel(erfcx(x), ref)).toBeLessThan(1e-14))

  it('對稱性與邊界：erf(−x) = −erf(x)、erfc(−x) = 2 − erfc(x)、極值與 NaN', () => {
    for (const x of [0.01, 0.4, 0.47, 1.7, 3.9, 4.2, 7]) {
      expect(erf(-x)).toBe(-erf(x))
      expect(Math.abs(erfc(-x) - (2 - erfc(x)))).toBeLessThan(4e-16)
    }
    expect(erf(Infinity)).toBe(1)
    expect(erf(-Infinity)).toBe(-1)
    expect(erfc(Infinity)).toBe(0)
    expect(erfc(-Infinity)).toBe(2)
    expect(erfc(30)).toBe(0) // 真值 ≈ 2.6e-393，低於 double 範圍
    expect(Number.isNaN(erf(NaN))).toBe(true)
  })
})

describe('special：Normal 分布', () => {
  it.each(NCDF)('normCdf(%f)，兩側尾端相對誤差 < 1e-14', (z, ref) => expect(rel(normCdf(z), ref)).toBeLessThan(1e-14))

  it.each([
    [-30, 1.4736461348785476e-196], [-3, 0.0044318484119380075], [0, 0.3989422804014327],
    [0.7, 0.31225393336676127], [10, 7.694598626706419e-23],
  ])('normPdf(%f)', (z, ref) => expect(rel(normPdf(z), ref)).toBeLessThan(1e-14))

  it.each(NINV)('normInv(%s) 相對誤差 < 1e-13', (p, ref) => expect(rel(normInv(p), ref)).toBeLessThan(1e-13))

  it('normInv 邊界、對稱與往返（round trip）', () => {
    expect(normInv(0)).toBe(-Infinity)
    expect(normInv(1)).toBe(Infinity)
    expect(normInv(0.5)).toBe(0)
    expect(Number.isNaN(normInv(-0.1))).toBe(true)
    expect(Number.isNaN(normInv(1.1))).toBe(true)
    // 1e-300 ≤ p：normCdf(normInv(p)) = p（相對 1e-13）
    for (const p of [1e-300, 1e-150, 1e-30, 1e-7, 0.01, 0.2, 0.45, 0.5000001]) {
      expect(rel(normCdf(normInv(p)), p)).toBeLessThan(1e-13)
    }
    expect(normSf(5)).toBe(normCdf(-5))
  })

  it('T04: s = 1 fs、σ_v = 100 fs → P(q=+1) = Φ(0.01) ≈ 0.503989、K_q ≈ 0.00797885/fs', () => {
    const p = normCdf(1 / 100)
    expect(rel(p, 0.5039893563146316)).toBeLessThan(1e-15)
    expect(p).toBeCloseTo(0.503989, 6)
    // E[q] = 2Φ(s/σ) − 1 = erf(s/(√2 σ))（mpmath：0.007978712629263208）
    const eq = erf(1 / (100 * Math.SQRT2))
    expect(rel(eq, 0.007978712629263208)).toBeLessThan(1e-14)
    expect(Math.abs(2 * p - 1 - eq)).toBeLessThan(2e-16)
    // 小訊號增益 K_q = √(2/π)/σ_v（mpmath：0.007978845608028654）
    expect(rel(Math.sqrt(2 / Math.PI) / 100, 0.007978845608028654)).toBeLessThan(1e-15)
  })

  it('規格 §5 CLT 表：P(G_N > 0) ≈ Φ(m√N/√(1−m²))（mpmath 參考值）', () => {
    const m = erf(1 / (100 * Math.SQRT2))
    const clt = (N: number): number => normCdf((m * Math.sqrt(N)) / Math.sqrt(1 - m * m))
    expect(rel(clt(100), 0.5317977282845734)).toBeLessThan(1e-13)
    expect(rel(clt(1000), 0.5996020057800544)).toBeLessThan(1e-13)
    expect(rel(clt(10000), 0.7875347691993568)).toBeLessThan(1e-13)
    expect(rel(clt(42500), 0.9500054120638003)).toBeLessThan(1e-13)
    expect(rel(clt(85000), 0.9899973517413075)).toBeLessThan(1e-13)
  })
})

describe('special：lgamma / betaIncReg', () => {
  it.each(LGAMMA)('lgamma(%f)（|ref| ≥ 1 看相對誤差，否則看絕對誤差）', (x, ref) => {
    const err = Math.abs(ref) >= 1 ? rel(lgamma(x), ref) : Math.abs(lgamma(x) - ref)
    expect(err).toBeLessThan(5e-15)
  })

  it('lgamma 極點與整數', () => {
    expect(lgamma(0)).toBe(Infinity)
    expect(lgamma(-3)).toBe(Infinity)
    expect(lgamma(1)).toBe(0)
    expect(lgamma(2)).toBe(0)
    // ln(10!) = ln 3628800
    expect(rel(lgamma(11), Math.log(3628800))).toBeLessThan(1e-15)
  })

  it.each([
    [2.5, 3.5, 0.3, 0.2967529892956664], [0.5, 0.5, 0.01, 0.06376856085851985], [1, 1, 0.42, 0.42], [5, 5, 0.5, 0.5],
    [50, 0.5, 0.99, 0.3173043978741974], [0.1, 10, 0.001, 0.659666660220825], [3, 4, 0.999, 0.999999999985024],
  ])('betaIncReg(%f, %f, %f)', (a, b, x, ref) => expect(rel(betaIncReg(a, b, x), ref)).toBeLessThan(1e-13))

  it('betaIncRegPair 的互補值保留尾端相對精度', () => {
    // 1 − I_0.9(20, 30) = I_0.1(30, 20) ≈ 2.7315e-18（mpmath）
    expect(rel(betaIncRegPair(20, 30, 0.9)[1], 2.731499730547128e-18)).toBeLessThan(1e-12)
    // 1 − I_0.999(3, 4) = 1.497601e-11（mpmath）
    expect(rel(betaIncRegPair(3, 4, 0.999)[1], 1.4976010000000052e-11)).toBeLessThan(1e-10)
    // 大參數：I_0.33(1e5, 2e5) = P(Bin(299999, 0.33) ≥ 1e5)，mpmath 50 位數精確加總 = 5.24278181847812e-5
    expect(rel(betaIncReg(1e5, 2e5, 0.33), 5.24278181847812e-5)).toBeLessThan(1e-13)
    expect(betaIncReg(2, 3, 0)).toBe(0)
    expect(betaIncReg(2, 3, 1)).toBe(1)
    expect(() => betaIncReg(0, 1, 0.5)).toThrow()
  })
})

describe('special：Binomial（Loader saddle-point + double-double n·p，n = 1e6 仍 < 1e-14）', () => {
  it.each([
    [50, 100, 0.503989, 0.07933634524235691, 1e-14], [0, 10, 0.3, 0.028247524900000005, 1e-14],
    [10, 10, 0.3, 5.9048999999999975e-6, 1e-14], [3, 10, 0.3, 0.266827932, 1e-14],
    [500000, 1e6, 0.5, 0.0007978843613317501, 1e-14], [500000, 1e6, 0.503989, 1.2033927677223197e-17, 1e-14],
    [0, 1e6, 1e-6, 0.3678792572316451, 1e-14], [1, 1e6, 1e-6, 0.3678796251112702, 1e-14],
    [999999, 1e6, 0.999999, 0.3678796251112702, 1e-14], [5, 1e6, 1e-6, 0.0030656451486279906, 1e-14],
  ])('binomPmf(%i, %i, %f)', (k, n, p, ref, tol) => expect(rel(binomPmf(k, n, p), ref)).toBeLessThan(tol))

  it.each([
    [50, 100, 0.503989, 0.5079530007149337, 1e-14], [49, 100, 0.503989, 0.4286166554725767, 1e-14],
    [10, 100, 0.503989, 8.049379799318944e-18, 1e-14], [60, 100, 0.503989, 0.9786367483373679, 1e-14],
    [90, 100, 0.503989, 1.0, 1e-15], [500000, 1e6, 0.503989, 7.488816923889867e-16, 1e-14],
    [502000, 1e6, 0.503989, 3.488157843568144e-5, 1e-14], [505000, 1e6, 0.503989, 0.9784671958187577, 1e-14],
    [0, 10, 0.3, 0.028247524900000005, 1e-14], [3, 10, 0.3, 0.6496107184000001, 1e-14],
  ])('binomCdf(%i, %i, %f)', (k, n, p, ref, tol) => expect(rel(binomCdf(k, n, p), ref)).toBeLessThan(tol))

  it.each([
    [90, 100, 0.503989, 3.1904398359504546e-18, 1e-14], [50, 100, 0.503989, 0.49204699928506634, 1e-14],
    [505000, 1e6, 0.503989, 0.021532804181242284, 1e-14], [510000, 1e6, 0.503989, 1.3304077614216986e-33, 1e-14],
    [3, 10, 0.3, 0.3503892816, 1e-14],
  ])('binomSf(%i, %i, %f)（上尾相對精度）', (k, n, p, ref, tol) => expect(rel(binomSf(k, n, p), ref)).toBeLessThan(tol))

  it('pmf 總和 = 1、cdf + sf = 1、邊界與錯誤輸入', () => {
    let s = 0
    for (let k = 0; k <= 200; k++) s += binomPmf(k, 200, 0.37)
    expect(Math.abs(s - 1)).toBeLessThan(1e-14)
    for (const k of [0, 30, 74, 75, 120, 199]) {
      expect(Math.abs(binomCdf(k, 200, 0.37) + binomSf(k, 200, 0.37) - 1)).toBeLessThan(1e-15)
    }
    expect(binomCdf(-1, 10, 0.5)).toBe(0)
    expect(binomCdf(10, 10, 0.5)).toBe(1)
    expect(binomCdf(3.7, 10, 0.3)).toBe(binomCdf(3, 10, 0.3))
    expect(binomPmf(2.5, 10, 0.3)).toBe(0)
    expect(binomPmf(0, 5, 0)).toBe(1)
    expect(binomPmf(5, 5, 1)).toBe(1)
    expect(binomCdf(4, 5, 1)).toBe(0)
    expect(() => binomPmf(1, 10.5, 0.3)).toThrow()
    expect(() => binomCdf(1, 10, 1.3)).toThrow()
  })
})

describe('special：Student-t（SciPy 參考值）', () => {
  it.each([
    [-2, 3, 0.06966298427942152], [2.262157, 9, 0.9749999933477842], [-50, 5.5, 7.952076218228363e-9],
    [0.5, 1, 0.6475836176504333], [-1000, 2.5, 2.2747463948307453e-8], [1.5, 1e6, 0.9331926408816036],
    [0.3, 30, 0.6168769473578236],
  ])('studentTCdf(%f, ν=%f)', (t, nu, ref) => expect(rel(studentTCdf(t, nu), ref)).toBeLessThan(1e-12))

  it.each([
    [0.975, 3, 3.1824463052837078], [0.975, 9, 2.262157162798205], [1e-10, 3, -2225.769284683093],
    [0.3, 4.5, -0.5635058039393779], [0.975, 1, 12.706204736174694], [1e-8, 1, -31830988.61837906],
    [0.975, 2, 4.302652729749462], [0.995, 29, 2.756385903670605], [0.975, 1e6, 1.9599663568141068],
    [0.9, 7.7, 1.4017109346113588], [0.025, 49, -2.0095752371292397],
  ])('studentTInv(%f, ν=%f)', (p, nu, ref) => expect(rel(studentTInv(p, nu), ref)).toBeLessThan(1e-11))

  it('studentTInv 邊界', () => {
    expect(studentTInv(0.5, 5)).toBe(0)
    expect(studentTInv(0, 5)).toBe(-Infinity)
    expect(studentTInv(1, 5)).toBe(Infinity)
    expect(studentTInv(0.975, Infinity)).toBe(normInv(0.975))
    expect(Number.isNaN(studentTInv(0.5, -1))).toBe(true)
  })
})
