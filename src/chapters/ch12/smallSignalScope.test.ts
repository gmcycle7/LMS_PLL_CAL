import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { meanFieldGmac } from '@/simulation/models/polarity'
import { EX, TWO_TAP, TWO_TAP_SMALL, cubicRelError, twoTapMeanG } from './common'

/**
 * 技術審查 R06c：F-12.1 的小訊號判據 |C·δw| ≪ σ_v 只在「±1 code、無記憶 path u = C·x」成立。
 * path 有記憶時 C = E[x·u] 小不代表 comparator 前的波形小；一般條件要看整個波形 |δw|·u_max。
 *
 * 這裡的期望值都另外用 Python（NumPy／SciPy：窮舉 (x[n], x[n−1]) 四種組合 + erfc、以及直接對 Gaussian pdf 積分）
 * 獨立算過一次；極性：本章 δw = w − w*，第 6 章的 meanFieldGmac 用 δ = a − w = −δw。
 */

/** 週期 4 的 ±1 code：(x[n], x[n−1]) 的四種組合各出現一次，等於對 iid ±1 code 做窮舉平均 */
const X4 = [1, 1, -1, -1]
/** u[n] = c0·x[n] + c1·x[n−1]（週期延伸） */
const twoTapU = (c0: number, c1: number) => X4.map((_, n) => c0 * X4[n] + c1 * X4[(n + 3) % 4])
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length

const SMALL = 0.3 // 本站各處用的「小訊號」門檻：殘差 ≤ 0.3σ_v（calNoise.ts 的 Lab 警告、第 6 章的 linearLimit）

describe('R06c 反例：±1 iid code、u[n] = 0.001·x[n] + x[n−1]、δw = 10 fs、σ_v = 1 fs', () => {
  it('F-12.1 的線性預測 −K·δw = −0.00798，實際的 E[G] 只有它的 1.93×10⁻²² 倍', () => {
    expect(TWO_TAP.K).toBeCloseTo(7.978845608028654e-4, 12)
    expect(TWO_TAP.linear).toBeCloseTo(-0.007978845608028654, 12)
    expect(TWO_TAP.exact / -1.5414601490207667e-24 - 1).toBeLessThan(1e-9)
    expect(TWO_TAP.exact / -1.5414601490207667e-24 - 1).toBeGreaterThan(-1e-9)
    expect(TWO_TAP.ratio).toBeGreaterThan(1.93e-22)
    expect(TWO_TAP.ratio).toBeLessThan(1.94e-22)
    // 正文第二行的近似 −K·δw·exp(−δw²/(2σ_v²))：和精確值差 0.17%
    expect(TWO_TAP.gauss / (-0.007978845608028654 * Math.exp(-50))).toBeCloseTo(1, 12)
    expect(Math.abs(TWO_TAP.gauss / TWO_TAP.exact - 1)).toBeLessThan(2e-3)
  })

  it('只看 C 的判據會把它當成小訊號（0.01 ≤ 0.3）；看整個波形的判據不會（10.01 > 0.3）', () => {
    expect(TWO_TAP.C).toBe(TWO_TAP.c0)
    expect(TWO_TAP.uMax).toBeCloseTo(1.001, 12)
    const scalarCriterion = Math.abs(TWO_TAP.C * TWO_TAP.dw) / TWO_TAP.sigmaV
    const waveformCriterion = (Math.abs(TWO_TAP.dw) * TWO_TAP.uMax) / TWO_TAP.sigmaV
    expect(scalarCriterion).toBeCloseTo(0.01, 12)
    expect(scalarCriterion).toBeLessThan(SMALL)
    expect(waveformCriterion).toBeCloseTo(10.01, 12)
    expect(waveformCriterion).toBeGreaterThan(SMALL)
  })

  it('第 6 章的 mean-field 函式（完整 erf 平均）在窮舉的週期 4 code 上給出同樣的結論：C = 0.001，恢復力 ≈ 0', () => {
    const u = twoTapU(0.001, 1)
    expect(mean(X4.map((x, n) => x * u[n]))).toBeCloseTo(0.001, 12) // C = E[x·u]：x[n−1] 那一個 tap 完全不相關
    expect(Math.max(...u.map(Math.abs))).toBeCloseTo(1.001, 12)
    expect(Math.abs(meanFieldGmac(X4, u, -10, 1))).toBeLessThan(1e-12)
  })

  it('線性範圍其實只到 |δw| ≪ σ_v/u_max：δw = 1 fs 時恢復力已經只剩線性值的 0.607 倍（≈ e^{−1/2}），δw → 0 時斜率仍是 K', () => {
    expect(TWO_TAP.at1).toBeCloseTo(0.6065306597, 9)
    expect(Math.abs(TWO_TAP.at1 - Math.exp(-0.5))).toBeLessThan(1e-6)
    const ratioAt = (dw: number) => twoTapMeanG(TWO_TAP.c0, TWO_TAP.c1, dw, TWO_TAP.sigmaV) / (-TWO_TAP.K * dw)
    expect(ratioAt(0.01)).toBeCloseTo(1, 3) // 斜率本身沒有錯
    expect(ratioAt(0.3)).toBeCloseTo(0.956, 3)
    expect(ratioAt(2)).toBeCloseTo(0.1353, 3)
    expect(ratioAt(3)).toBeCloseTo(0.0111, 3)
  })
})

describe('R06c：twoTapMeanG 與第 6 章的 meanFieldGmac 一致（窮舉的週期 4 code）', () => {
  it.each([
    [0.05, 1, 2, -0.010852139253185],
    [0.3, -0.7, 1.3, -0.204731302961356],
    [1, 0.4, 0.8, -0.553029422441047],
  ])('taps (%f, %f)、δw = %f ⇒ E[G] = %f', (c0, c1, dw, want) => {
    const got = twoTapMeanG(c0, c1, dw, 1)
    expect(got).toBeCloseTo(want, 13)
    expect(Math.abs(got - meanFieldGmac(X4, twoTapU(c0, c1), -dw, 1))).toBeLessThan(1e-14)
  })

  it('taps (0.05, 1)、δw = 2：|C·δw| = 0.1σ_v 看似還算小，實際恢復力只有線性值的 0.136 倍', () => {
    const linear = -Math.sqrt(2 / Math.PI) * 0.05 * 2
    expect(linear).toBeCloseTo(-0.0797884560803, 12)
    expect(twoTapMeanG(0.05, 1, 2, 1) / linear).toBeCloseTo(0.13601139546, 9)
    expect((0.05 * 2) / 1).toBeLessThan(SMALL) // 只看 C 的判據：通過
    expect((2 * 1.05) / 1).toBeGreaterThan(SMALL) // 看波形的判據：不通過
  })
})

describe('R06c 對照組：無記憶 path（本章與 LMS Noise Lab 的模型）下，|C·δw| ≪ σ_v 的判據是對的', () => {
  it('u = 0.001·x、δw = 10 fs：實際 ÷ 線性 = 1 − (0.01)²/6', () => {
    const got = twoTapMeanG(0.001, 0, 10, 1)
    expect(got).toBeCloseTo(-0.007978712629263, 12)
    expect(got / TWO_TAP.linear).toBeCloseTo(0.99998333358, 9)
    expect(Math.abs(got / TWO_TAP.linear - (1 - 0.01 ** 2 / 6))).toBeLessThan(1e-8)
  })

  it('u = 0.05·x、δw = 2 fs：實際 ÷ 線性 = 0.99834（和兩個 tap 的 0.136 對照）', () => {
    const got = twoTapMeanG(0.05, 0, 2, 1)
    expect(got).toBeCloseTo(-0.079655674554058, 12)
    expect(got / (-Math.sqrt(2 / Math.PI) * 0.05 * 2)).toBeCloseTo(0.99833583036, 9)
  })

  it('本章的例子（C = 1、σ_v = 100 fs、δw = 3σ_w = 1.1976 fs）：實際 ÷ 線性 = 0.99998；T13 的 σ_w 不變', () => {
    expect(EX.sigmaW).toBeCloseTo(0.39918614299092886, 14) // T13 golden（規格 §12.1）
    const dw = 3 * EX.sigmaW
    expect(dw).toBeCloseTo(1.1975584289727865, 12)
    expect(twoTapMeanG(1, 0, dw, 100) / (-EX.K * dw)).toBeCloseTo(0.9999760981, 9)
    // 無記憶 path 的 u_max = |C|：兩個判據是同一個數
    expect((Math.abs(dw) * 1) / 100).toBeLessThan(SMALL)
  })
})

describe('R06c（Research 段落）：線性化的相對誤差首項 −δw²(h_0² + 3Σ_{m≥1}h_m²)/(6σ_v²)', () => {
  /** 完整 erf 平均的相對誤差（兩個 tap）：E[G]/(−K_q·c0·δw) − 1 */
  const relExact = (c0: number, c1: number, dw: number, sigmaV: number) => twoTapMeanG(c0, c1, dw, sigmaV) / (-(Math.sqrt(2 / Math.PI) / sigmaV) * c0 * dw) - 1

  it('正文的數字：反例的 path、δw = 0.3 fs ⇒ 首項 −0.0450、完整平均 −0.0440；無記憶 path 只有 −1.5×10⁻⁸；δw = 10 fs 時首項 −50（展開失效）', () => {
    expect(TWO_TAP_SMALL.dw).toBe(0.3)
    expect(TWO_TAP_SMALL.lead).toBeCloseTo(-0.045000015, 12) // −0.09 × (0.001² + 3)/6
    expect(TWO_TAP_SMALL.exact).toBeCloseTo(-0.0440025312, 9) // ≈ e^{−0.045} − 1
    expect(TWO_TAP_SMALL.exact).toBeCloseTo(relExact(0.001, 1, 0.3, 1), 14)
    expect(TWO_TAP_SMALL.scalarLead).toBeCloseTo(-1.5e-8, 20)
    expect(relExact(0.001, 0, 0.3, 1) / TWO_TAP_SMALL.scalarLead).toBeCloseTo(1, 4) // 無記憶 path：完整平均同樣是 −1.5×10⁻⁸
    expect(TWO_TAP_SMALL.leadAtCounterexample).toBeCloseTo(-50.0000166667, 9)
  })

  it.each([
    [0.001, 1, 0.1],
    [1, 0, 0.1], // 無記憶 path：−(C·δw)²/(6σ_v²)
    [0.3, -0.7, 0.1],
    [1, 0.4, 0.1],
    [0.05, 1, 0.1],
  ])('兩個 tap (%f, %f)、δw = %f、σ_v = 1：首項與完整 erf 平均的相對誤差只差下一階（< 3%）', (c0, c1, dw) => {
    const lead = cubicRelError([c0, c1], dw, 1)
    expect(lead).toBeLessThan(0)
    expect(Math.abs(relExact(c0, c1, dw, 1) / lead - 1)).toBeLessThan(0.03)
  })

  it('三個 tap（窮舉 (x[n], x[n−1], x[n−2]) 的 8 種組合，獨立於 twoTapMeanG）：係數真的是「h_0² 一倍、其餘 tap 三倍」', () => {
    const h = [0.2, 0.6, -0.5]
    const X8 = [1, 1, 1, -1, 1, -1, -1, -1] // 週期 8 的 de Bruijn 序列：連續三拍的 8 種組合各出現一次
    const u = X8.map((_, n) => h[0] * X8[n] + h[1] * X8[(n + 7) % 8] + h[2] * X8[(n + 6) % 8])
    expect(mean(X8.map((x, n) => x * u[n]))).toBeCloseTo(h[0], 12) // C = h_0
    const dw = 0.1
    const exact = meanFieldGmac(X8, u, -dw, 1) / (-Math.sqrt(2 / Math.PI) * h[0] * dw) - 1
    const lead = cubicRelError(h, dw, 1)
    expect(lead).toBeCloseTo(-(0.01 * (0.04 + 3 * (0.36 + 0.25))) / 6, 14) // −0.0031167
    expect(exact).toBeCloseTo(-0.0031069, 6)
    expect(Math.abs(exact / lead - 1)).toBeLessThan(0.01)
    // 反面對照：如果每個 tap 都只算一倍（h_0² + Σh_m² = E[u²]），就差了將近三倍
    expect(Math.abs(exact / (-(dw * dw * (0.04 + 0.36 + 0.25)) / 6) - 1)).toBeGreaterThan(1.5)
  })

  it('頁面（Research 模式的段落）寫的是同一條式子，數字由 TWO_TAP_SMALL 算出', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/chapters/ch12/sections/S2Recursion.tsx'), 'utf8')
    expect(src).toContain(String.raw`E[G\mid\delta w]\approx-K\,\delta w\,\Big[1-\frac{\delta w^2}{6\sigma_v^2}\Big(h_0^2+3\sum_{m\ge1}h_m^2\Big)\Big],\qquad K=K_q\,h_0`)
    expect(src).toContain(String.raw`$h_0^2+3\sum_{m\ge1}h_m^2=3E[u^2]-2C^2$`)
    expect(src).toContain('sig(TWO_TAP_SMALL.lead, 3)')
    expect(src).toContain('sig(TWO_TAP_SMALL.exact, 3)')
    // 恆等式 h_0² + 3Σ_{m≥1}h_m² = 3E[u²] − 2C²
    const h = [0.2, 0.6, -0.5]
    const pu = h.reduce((s, v) => s + v * v, 0)
    expect(h[0] ** 2 + 3 * (h[1] ** 2 + h[2] ** 2)).toBeCloseTo(3 * pu - 2 * h[0] ** 2, 14)
  })
})
