import { bw3dbExact, calLoop, P_MIN_3DB } from '@/simulation/models/calNoise'
import {
  adaptiveSimpson,
  cumulativePowerFraction,
  DEFAULT_UNITS_PARAMS,
  enbwNumeric,
  f3dbBisection,
  frequencyAtPowerFraction,
  linearMcStep,
  MC_BLOCK_BUDGET,
  MC_MIN_BLOCKS,
  mcBudget,
  normalizedH2,
  planMcBlocks,
  poleDistance2,
  runUnitsMc,
  runUnitsMcBatch,
  signMcStep,
  unitsCalc,
  unitsCurves,
  type UnitsMcParams,
} from './unitsModel'
import { createRng } from '@/simulation/core'
import { gmacModel } from '@/simulation/models/optimizer'
import { readGolden, richProblems, withinGolden } from './testUtils'

const T13 = { ...DEFAULT_UNITS_PARAMS }
const MC_BASE: UnitsMcParams = { mu: 10, sigmaV: 100, C: 1, N: 4096, gmMode: 'average', engine: 'linear', chains: 16, blocks: 4000, seed: 20261010 }

function golden(vec: string, key: string, actual: number) {
  const res = withinGolden(readGolden(vec), key, actual)
  expect(res.ok, res.detail).toBe(true)
}

describe('unitsModel：一階 H_{η→w} 的功率響應與累積功率', () => {
  const p = 0.9202115439197135
  const fu = 976562.5

  it('|H|²/|H(0)|²：DC 為 1、Nyquist 為 ((1−p)/(1+p))²、在 exact f_3dB 恰為 1/2', () => {
    expect(normalizedH2(0, p, fu)).toBe(1)
    expect(normalizedH2(fu / 2, p, fu)).toBeCloseTo(((1 - p) / (1 + p)) ** 2, 14)
    const f3 = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 }).f3dbExact
    expect(normalizedH2(f3, p, fu)).toBeCloseTo(0.5, 12)
    // 反面：把頻率除以 f_s 而不是 f_u（差 N 倍）就不會落在 −3 dB
    expect(normalizedH2(f3, p, 4e9)).toBeGreaterThan(0.999)
  })

  it('累積功率比例 F(f)：封閉式與數值積分一致；F(0) = 0、F(f_u/2) = 1、單調遞增', () => {
    for (const pp of [0.92, 0.5, 0.2, 0, -0.5]) {
      const total = adaptiveSimpson((f) => normalizedH2(f, pp, fu), 0, fu / 2, 1e-10)
      for (const frac of [0.001, 0.01, 0.1, 0.3, 0.5]) {
        const f = frac * fu
        const num = adaptiveSimpson((x) => normalizedH2(x, pp, fu), 0, f, 1e-10) / total
        expect(cumulativePowerFraction(f, pp, fu), `p=${pp}, f=${frac}fu`).toBeCloseTo(num, 8)
      }
      expect(cumulativePowerFraction(0, pp, fu)).toBe(0)
      expect(cumulativePowerFraction(fu / 2, pp, fu)).toBe(1)
      expect(cumulativePowerFraction(fu, pp, fu)).toBe(1) // 超過 Nyquist 時夾在 1
    }
    let prev = -1
    for (let i = 0; i <= 50; i++) {
      const F = cumulativePowerFraction((i / 100) * fu, p, fu)
      expect(F).toBeGreaterThanOrEqual(prev)
      prev = F
    }
  })

  it('E06：f_3dB 以下只有約一半的雜訊功率（不是全部）；ENBW 以下約 64%', () => {
    const lp = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
    const atF3 = cumulativePowerFraction(lp.f3dbExact, p, fu)
    expect(atF3).toBeGreaterThan(0.49)
    expect(atF3).toBeLessThan(0.51)
    // p → 1 的極限：F(f_3dB) → (2/π)·atan(1) = 1/2；F(ENBW) → (2/π)·atan(π/2)
    const atEnbw = cumulativePowerFraction(lp.enbw, p, fu)
    expect(atEnbw).toBeCloseTo((2 / Math.PI) * Math.atan(Math.PI / 2), 2)
    // 把 f_3dB 當矩形 noise BW：功率只有 f_3dB/ENBW ≈ 2/π ≈ 63.7%，RMS 低估 ≈ 20%
    expect(lp.f3dbExact / lp.enbw).toBeCloseTo(2 / Math.PI, 2)
  })

  it('frequencyAtPowerFraction 是 F(f) 的反函數；q = 1 給 Nyquist；不合法輸入回傳 NaN', () => {
    for (const q of [0.1, 0.5, 0.9, 0.99]) {
      const f = frequencyAtPowerFraction(q, p, fu)
      expect(cumulativePowerFraction(f, p, fu)).toBeCloseTo(q, 12)
    }
    expect(frequencyAtPowerFraction(1, p, fu)).toBe(fu / 2)
    expect(frequencyAtPowerFraction(0, p, fu)).toBe(0)
    expect(frequencyAtPowerFraction(0.5, 1.2, fu)).toBeNaN()
    expect(frequencyAtPowerFraction(1.5, p, fu)).toBeNaN()
    // 50% 功率頻率（median frequency）與 f_3dB 幾乎相同（p → 1 時相等）
    const lp = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
    expect(frequencyAtPowerFraction(0.5, p, fu) / lp.f3dbExact).toBeCloseTo(1, 1)
  })

  it('ENBW：數值積分（tan 代換 + 自適應 Simpson）與封閉式 (f_u/2)(1−p)/(1+p) 一致（含 p ≤ 0）', () => {
    for (const pp of [1 - 1e-9, 1 - 1e-7, 0.99992, 0.999, 0.92, 0.5, 0.1716, 0.05, 0, -0.3, -0.9, -0.999, -1 + 1e-7]) {
      const closed = (fu / 2) * ((1 - pp) / (1 + pp))
      expect(enbwNumeric(pp, fu) / closed, `p=${pp}`).toBeCloseTo(1, 9)
    }
    expect(enbwNumeric(1, fu)).toBeNaN()
    expect(enbwNumeric(-1.2, fu)).toBeNaN()
  })

  it('效能回歸：數值 ENBW 在整個 |p| < 1 範圍內都很快（曾因容差每層減半而遞迴爆炸）', () => {
    let calls = 0
    const counted = (x: number) => {
      calls++
      return 1 / (1 + 1e6 * x * x) // 尖峰寬度 1e−3
    }
    const val = adaptiveSimpson(counted, 0, 1, 1e-14)
    expect(val).toBeCloseTo(Math.atan(1e3) / 1e3, 12)
    expect(calls).toBeLessThan(200_000)
    const t0 = performance.now()
    for (const pp of [1 - 1e-9, 1 - 1e-7, 0.999, 0.92, 0.3, 0, -0.5, -0.999, -1 + 1e-7]) enbwNumeric(pp, fu)
    const ms = performance.now() - t0
    // 寬鬆上限（其他 agent 同時跑測試時 CPU 很忙）；修正前同一組 p 需要數十秒
    expect(ms).toBeLessThan(2000)
  })

  it('|e^{jΩ} − p|² 的穩定寫法：p → ±1 時與高精度參考值一致（直接寫 1 − 2p cosΩ + p² 會相消）', () => {
    // p = −0.999、Ω = π：(1 + p)² = 1e−6（精確）
    expect(poleDistance2(-0.999, 1, 0) / 1e-6).toBeCloseTo(1, 12)
    // p = 0.999999、Ω = 0：(1 − p)² = 1e−12
    expect(poleDistance2(0.999999, 0, 1) / 1e-12).toBeCloseTo(1, 9)
    // 兩種寫法在一般情況下相等
    for (const pp of [0.3, -0.3, 0.9, -0.9]) {
      for (const om of [0.1, 1, 2, 3]) {
        const direct = 1 - 2 * pp * Math.cos(om) + pp * pp
        expect(poleDistance2(pp, Math.sin(om / 2) ** 2, Math.cos(om / 2) ** 2)).toBeCloseTo(direct, 12)
      }
    }
    // high-pass（p < 0）在 Nyquist 的增益：((1 − p)/(1 + p))²
    expect(normalizedH2(fu / 2, -0.999, fu) / (1.999 / 0.001) ** 2).toBeCloseTo(1, 9)
  })

  it('adaptiveSimpson：多項式精確、尖峰函數收斂', () => {
    expect(adaptiveSimpson((x) => x * x * x - 2 * x, 0, 2)).toBeCloseTo(0, 12)
    expect(adaptiveSimpson(Math.sin, 0, Math.PI)).toBeCloseTo(2, 10)
    // Lorentzian 尖峰：∫_{-1}^{1} ε/(x²+ε²) dx = 2·atan(1/ε)
    const eps = 1e-3
    expect(adaptiveSimpson((x) => eps / (x * x + eps * eps), -1, 1, 1e-12)).toBeCloseTo(2 * Math.atan(1 / eps), 7)
  })

  it('unitsCurves：log 頻率格點、F 單調、矩形近似 f/ENBW；|p| ≥ 1 時回傳空陣列', () => {
    const lp = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
    const c = unitsCurves(lp.p, lp.fu, lp.enbw, 200)
    expect(c.f.length).toBe(200)
    expect(c.f[0]).toBeCloseTo(lp.fu * 1e-5, 6)
    expect(c.f[199]).toBeCloseTo(lp.fu / 2, 6)
    expect(c.h2[0]).toBeGreaterThan(0.999)
    expect(c.frac[199]).toBe(1)
    for (let i = 1; i < 200; i++) expect(c.frac[i]).toBeGreaterThanOrEqual(c.frac[i - 1])
    expect(c.rect[100]).toBeCloseTo(c.f[100] / lp.enbw, 12)
    // 低頻時 |H|² ≈ 1，所以 F(f) ≈ f/ENBW（矩形近似成立）
    expect(c.frac[20] / c.rect[20]).toBeCloseTo(1, 3)
    expect(unitsCurves(1.5, lp.fu, NaN).f.length).toBe(0)
    // 很慢的迴路（1 − p = 10⁻⁸）：頻率下限延伸到 corner 的 1/100，f_3dB 與 ENBW 都落在圖內，低頻端 |H|² ≈ 1
    const slow = calLoop({ N: 4096, fs: 4e9, mu: 1e-8 / lp.K, sigmaV: 100, C: 1 })
    const cs = unitsCurves(slow.p, slow.fu, slow.enbw, 200)
    expect(cs.f[0]).toBeLessThan(slow.f3dbExact / 50)
    expect(cs.f[0]).toBeLessThan(slow.enbw)
    expect(cs.f[199]).toBeCloseTo(slow.fu / 2, 6)
    expect(cs.h2[0]).toBeGreaterThan(0.999)
    expect(cs.frac[0]).toBeLessThan(0.02)
    expect(cs.h2.every((v) => Number.isFinite(v) && v > 0)).toBe(true)
  })
})

describe('unitsModel：換算器（解析）', () => {
  it('T13: 預設條件重現 K、g、p、σ_w，並以 √(S_w(0)·ENBW) 驗算 σ_w', () => {
    const u = unitsCalc(T13)
    golden('T13', 'K_per_fs', u.loop.K)
    golden('T13', 'g', u.loop.g)
    golden('T13', 'p', u.loop.p)
    golden('T13', 'sigma_w_fs', u.loop.sigmaW)
    expect(u.sigmaFromEnbw).toBeCloseTo(u.loop.sigmaW, 12)
    // 把 f_3dB 當 noise BW：低估約 20%
    expect(u.sigmaFromF3db / u.loop.sigmaW).toBeGreaterThan(0.79)
    expect(u.sigmaFromF3db / u.loop.sigmaW).toBeLessThan(0.81)
  })

  it('T14: 四個「頻寬」數字與 golden 一致；封閉式的 f_3dB、ENBW 與數值解（二分法、積分）一致', () => {
    const u = unitsCalc(T13)
    golden('T14', 'f_u_hz', u.loop.fu)
    golden('T14', 'bw_exact_3db_hz', u.loop.f3dbExact)
    golden('T14', 'bw_neg_ln_p_hz', u.loop.f3dbNegLnP)
    golden('T14', 'bw_one_minus_p_hz', u.loop.f3dbOneMinusP)
    golden('T14', 'enbw_one_sided_hz', u.loop.enbw)
    expect(u.f3dbNumeric / u.loop.f3dbExact).toBeCloseTo(1, 10)
    expect(u.enbwNumeric / u.loop.enbw).toBeCloseTo(1, 9)
    // 同一個頻率的三種寫法：Hz、rad/block、rad/sample
    expect(u.omega3dbBlock).toBeCloseTo((2 * Math.PI * u.loop.f3dbExact) / u.loop.fu, 14)
    expect(u.omega3dbBlock / u.theta3dbSample).toBeCloseTo(T13.N, 8)
    expect(u.fracBelowF3db).toBeGreaterThan(0.49)
    expect(u.fracBelowF3db).toBeLessThan(0.51)
  })

  it('T14: f3dbBisection（不用封閉式的二分法）在整個 3 − 2√2 ≤ p < 1 都與封閉式一致到 10⁻¹²，包含很慢的迴路（1 − p 到 10⁻¹²）', () => {
    const fu = 976562.5
    let worst = 0
    for (const eps of [0.8, 0.5, 0.0797884560802865, 1e-2, 1e-4, 1e-5, 1e-6, 1e-8, 1e-10, 1e-12]) {
      const p = 1 - eps
      const exact = bw3dbExact(p, fu)
      const num = f3dbBisection(p, fu)
      expect(Number.isFinite(exact) && Number.isFinite(num), `1 − p = ${eps}`).toBe(true)
      worst = Math.max(worst, Math.abs(num / exact - 1))
    }
    // 回歸：以 1 − 2p·cosΩ + p² 直接做二分時，1 − p = 10⁻⁵ 的誤差已達 4×10⁻⁸、10⁻⁷ 時達 5×10⁻³（相消），換算器因此誤報「不一致」
    expect(worst).toBeLessThan(1e-12)
    // 慢迴路的極限：Ω_3dB → 1 − p（rad/block）
    // （注意 1 − (1 − 10⁻⁹) 在雙精度不是剛好 10⁻⁹，所以與實際的 1 − p 比；這正是容差要考慮 ε/(1 − |p|) 的原因）
    const pSlow = 1 - 1e-9
    expect((2 * Math.PI * f3dbBisection(pSlow, fu)) / fu / (1 - pSlow)).toBeCloseTo(1, 8)
    expect(Math.abs((1 - pSlow) / 1e-9 - 1)).toBeGreaterThan(1e-9)
    // 存在性與封閉式相同（E27）：p < 3 − 2√2、p ≤ 0、p ≥ 1 都是 NaN；邊界上是 Nyquist
    for (const p of [0.1, 0.17, 0, -0.5, 1, 1.2, NaN]) expect(f3dbBisection(p, fu), `p = ${p}`).toBeNaN()
    expect(f3dbBisection(0.18, fu)).toBeGreaterThan(0.4 * fu)
    expect(f3dbBisection(P_MIN_3DB, fu)).toBeCloseTo(fu / 2, 0)
    expect(bw3dbExact(P_MIN_3DB, fu)).toBeCloseTo(fu / 2, 0)
  })

  it('T15: 1 fs 在 13 GHz 是 8.168e−5 rad；A_t = 0.5 fs 的 β 與 spur（小角 vs Bessel）', () => {
    const u = unitsCalc(T13)
    expect(u.radPerFs).toBeCloseTo(2 * Math.PI * 13e9 * 1e-15, 18)
    golden('T15', 'beta_rad', u.beta)
    golden('T15', 'spur_dbc', u.spurDbc)
    golden('T15', 'spur_dbc_bessel', u.spurDbcBessel)
  })

  it('E18：sum mode 沿用 average 的 μ ⇒ g 放大 N 倍；把 μ 除以 N 就回到同一個 g、p、σ_w', () => {
    const avg = unitsCalc(T13)
    const sumBug = unitsCalc({ ...T13, gmMode: 'sum' })
    expect(sumBug.loop.g / avg.loop.g).toBeCloseTo(T13.N, 9)
    expect(Math.abs(sumBug.loop.p)).toBeGreaterThan(1)
    expect(sumBug.loop.sigmaW).toBeNaN()
    expect(sumBug.loop.f3dbExact).toBeNaN()
    expect(sumBug.loop.warnings.join('\n')).toMatch(/gm_mode=sum 時有效增益放大 N 倍/)
    expect(avg.muForSumMode).toBeCloseTo(T13.mu / T13.N, 15)
    const sumFixed = unitsCalc({ ...T13, gmMode: 'sum', mu: avg.muForSumMode })
    expect(sumFixed.loop.g).toBeCloseTo(avg.loop.g, 14)
    expect(sumFixed.loop.p).toBeCloseTo(avg.loop.p, 14)
    expect(sumFixed.loop.sigmaW).toBeCloseTo(avg.loop.sigmaW, 12)
    expect(sumFixed.loop.enbw).toBeCloseTo(avg.loop.enbw, 6)
  })

  it('E27：p < 3 − 2√2 沒有 −3 dB 點（封閉式與二分法都回傳 NaN），但 ENBW 仍有定義', () => {
    // g = 0.9 ⇒ p = 0.1 < 0.1716
    const mu = 0.9 / calLoop({ N: 4096, fs: 4e9, mu: 1, sigmaV: 100, C: 1 }).K
    const u = unitsCalc({ ...T13, mu })
    expect(u.loop.p).toBeCloseTo(0.1, 12)
    expect(u.loop.regime).toBe('no3db')
    expect(u.loop.f3dbExact).toBeNaN()
    expect(u.f3dbNumeric).toBeNaN()
    expect(u.fracBelowF3db).toBeNaN()
    expect(u.loop.enbw).toBeCloseTo((u.loop.fu / 2) * (0.9 / 1.1), 6)
    expect(u.enbwNumeric / u.loop.enbw).toBeCloseTo(1, 9)
    // 近似公式仍然會吐出數字（所以 UI 要警告）
    expect(Number.isFinite(u.loop.f3dbOneMinusP)).toBe(true)
  })

  it('反面：C ≤ 0（極性錯誤）與 σ_v = 0（K_q 無定義）都有解釋原因的警告', () => {
    const neg = unitsCalc({ ...T13, C: -0.5 })
    expect(neg.loop.regime).toBe('polarity')
    expect(neg.loop.p).toBeGreaterThan(1)
    expect(neg.loop.warnings.join('\n')).toMatch(/C ≤ 0：更新極性錯誤/)
    const noNoise = unitsCalc({ ...T13, sigmaV: 0 })
    expect(noNoise.loop.regime).toBe('undefined')
    expect(noNoise.loop.warnings.join('\n')).toMatch(/K_q/)
  })
})

describe('unitsModel：Monte Carlo（固定 seed）', () => {
  it('兩個引擎的單步：線性步是 pδ + μη；1-bit 步有界 |Δδ| ≤ μ（slew-limited）', () => {
    const rng = createRng(1)
    // η 的平均為 0：很多次平均後 E[δ'] = pδ
    let acc = 0
    const n = 20000
    for (let i = 0; i < n; i++) acc += linearMcStep(2, 0.9, 10, 1 / 64, rng)
    expect(acc / n).toBeCloseTo(1.8, 1)
    const model = gmacModel(4096, 100, 0, 1)
    const r2 = createRng(2)
    for (const d of [-1e4, -50, 0, 50, 1e4]) {
      const next = signMcStep(d, 10, 1, model, r2)
      expect(Math.abs(next - d)).toBeLessThanOrEqual(10 + 1e-12)
    }
    // 大誤差時 comparator 飽和：每個 block 剛好走 μ，方向朝 0
    expect(signMcStep(1e4, 10, 1, model, r2)).toBeCloseTo(1e4 - 10, 9)
    expect(signMcStep(-1e4, 10, 1, model, r2)).toBeCloseTo(-1e4 + 10, 9)
  })

  it('T13: 線性引擎與精確 1-bit 引擎的穩態 σ_w 都落在 0.399 fs（|z| ≤ 4，AR(1) 有效樣本數修正）', () => {
    const lin = runUnitsMc({ ...MC_BASE, engine: 'linear' })
    expect(lin.valid).toBe(true)
    expect(Math.abs(lin.z)).toBeLessThanOrEqual(4)
    expect(lin.sigmaHat).toBeGreaterThan(0.38)
    expect(lin.sigmaHat).toBeLessThan(0.42)
    expect(lin.burnIn).toBe(0)
    const sign = runUnitsMc({ ...MC_BASE, engine: 'sign' })
    expect(sign.valid).toBe(true)
    expect(Math.abs(sign.z)).toBeLessThanOrEqual(4)
    expect(sign.sigmaHat).toBeGreaterThan(0.38)
    expect(sign.sigmaHat).toBeLessThan(0.42)
    expect(sign.burnIn).toBeGreaterThan(50) // 從 δ = 0 開始，丟掉 8τ
    golden('T13', 'sigma_w2_fs2', lin.varTheory)
    // ESS = n(1 − p²)/(1 + p²)
    const p = 0.9202115439197135
    expect(lin.ess).toBeCloseTo((lin.nTotal * (1 - p * p)) / (1 + p * p), 6)
    expect(lin.nTotal).toBe(16 * 4000)
  })

  it('可重現：同 seed 結果完全相同，不同 seed 不同；trace 長度 ≤ 1500', () => {
    const a = runUnitsMc({ ...MC_BASE, engine: 'sign', chains: 4, blocks: 1000 })
    const b = runUnitsMc({ ...MC_BASE, engine: 'sign', chains: 4, blocks: 1000 })
    const c = runUnitsMc({ ...MC_BASE, engine: 'sign', chains: 4, blocks: 1000, seed: 7 })
    expect(a.varHat).toBe(b.varHat)
    expect(Array.from(a.trace)).toEqual(Array.from(b.trace))
    expect(a.varHat).not.toBe(c.varHat)
    expect(a.trace.length).toBe(1000)
    expect(runUnitsMc({ ...MC_BASE, chains: 2, blocks: 5000 }).trace.length).toBe(1500)
  })

  it('多個 seed 的 z 分數沒有系統性偏差（線性引擎 12 個 seed：|z| 全部 ≤ 4、平均 |z̄| < 1.2）', () => {
    let sum = 0
    for (let s = 1; s <= 12; s++) {
      const res = runUnitsMc({ ...MC_BASE, engine: 'linear', chains: 8, blocks: 3000, seed: 1000 + s })
      expect(Math.abs(res.z), `seed ${1000 + s}`).toBeLessThanOrEqual(4)
      sum += res.z
    }
    expect(Math.abs(sum / 12)).toBeLessThan(1.2)
  })

  it('T13: 反面 —— sum mode 沿用 μ = 10 fs：線性理論不穩定，1-bit 迴路變成大幅 limit cycle，交叉比對標為不適用', () => {
    const res = runUnitsMc({ ...MC_BASE, engine: 'sign', gmMode: 'sum', chains: 2, blocks: 500 })
    expect(res.valid).toBe(false)
    expect(Number.isNaN(res.varTheory)).toBe(true)
    // |G_sum| ≤ N ⇒ 不會數值發散，但 RMS 是 μN 量級（數萬 fs），不是 0.4 fs
    expect(res.diverged).toBe(false)
    expect(res.sigmaHat).toBeGreaterThan(1000)
    expect(res.note).toMatch(/不穩定/)
    const lin = runUnitsMc({ ...MC_BASE, engine: 'linear', gmMode: 'sum', chains: 2, blocks: 500 })
    expect(lin.valid).toBe(false)
    expect(lin.diverged).toBe(true)
    expect(lin.note).toMatch(/發散/)
  })

  it('反面：p 太接近 1 且樣本太少 ⇒ ESS < 30，回報不判定；|C|σ_w/σ_v > 0.2 時 1-bit 比對標為僅供參考', () => {
    // μ = 0.01 fs：p = 0.99992，τ ≈ 12533 blocks
    const slow = runUnitsMc({ ...MC_BASE, mu: 0.01, chains: 2, blocks: 2000 })
    expect(slow.valid).toBe(false)
    expect(slow.ess).toBeLessThan(30)
    expect(slow.note).toMatch(/ESS/)
    // N = 1、μ = 60 fs（C = 1）：|C|σ_w ≈ 0.7·σ_v 量級 → 小訊號線性化不成立
    const big = runUnitsMc({ ...MC_BASE, engine: 'sign', N: 1, mu: 60, chains: 8, blocks: 4000 })
    expect((MC_BASE.C * Math.sqrt(big.varTheory)) / 100).toBeGreaterThan(0.2)
    expect(big.valid).toBe(false)
    expect(big.note).toMatch(/小訊號線性化不成立/)
  })

  it('技術審查 R06c：小訊號的判定看 comparator 前的殘差 |C|·σ_w（引擎是 u = C·x），不是 σ_w 本身', () => {
    const base = { gmMode: 'average', engine: 'sign', chains: 4, blocks: 40000, seed: 20261010 } as const
    // 反例 1：C = 2。σ_w/σ_v = 0.199（舊判定放行），但 comparator 看到的是 |C|σ_w/σ_v = 0.398：線性公式已經偏掉（z ≈ −9）
    const c2 = runUnitsMc({ ...base, mu: 3.6, sigmaV: 10, C: 2, N: 4 })
    expect(Math.sqrt(c2.varTheory) / 10).toBeCloseTo(0.1989, 3)
    expect(Math.sqrt(c2.varTheory) / 10).toBeLessThan(0.2)
    expect((2 * Math.sqrt(c2.varTheory)) / 10).toBeGreaterThan(0.2)
    expect(c2.z).toBeLessThan(-6) // 模型誤差，不是統計誤差（三個 seed：−9.1、−11.1、−10.1）
    expect(c2.valid).toBe(false)
    expect(c2.note).toMatch(/小訊號線性化不成立/)
    expect(c2.note).toContain(String.raw`|C|\,\sigma_w/\sigma_v=0.398>0.2`)
    // 反例 2（另一個方向）：C = 0.1。σ_w/σ_v = 0.578（舊判定擋掉），但 |C|σ_w/σ_v = 0.058：線性化其實成立
    const c01 = runUnitsMc({ ...base, mu: 30, sigmaV: 10, C: 0.1, N: 64 })
    expect(Math.sqrt(c01.varTheory)).toBeCloseTo(5.7765, 3)
    expect(Math.sqrt(c01.varTheory) / 10).toBeGreaterThan(0.2)
    expect((0.1 * Math.sqrt(c01.varTheory)) / 10).toBeLessThan(0.2)
    expect(c01.valid).toBe(true)
    expect(Math.abs(c01.z)).toBeLessThanOrEqual(4) // 0.58（三個 seed：0.58、−1.47、1.33）
    // 正常對照：C = 1 時新舊判定相同——T13 條件通過，N = 1、μ = 60 仍被擋下
    const t13 = runUnitsMc({ ...MC_BASE, engine: 'sign', chains: 4, blocks: 40000 })
    expect(t13.valid).toBe(true)
    expect(Math.abs(t13.z)).toBeLessThanOrEqual(4)
    const big = runUnitsMc({ ...MC_BASE, engine: 'sign', N: 1, mu: 60, chains: 8, blocks: 4000 })
    expect(big.valid).toBe(false)
    expect(big.note).toContain(String.raw`|C|\,\sigma_w/\sigma_v=0.703>0.2`)
    // 線性引擎不做這個判定（它沒有 comparator）
    expect(runUnitsMc({ ...base, engine: 'linear', mu: 3.6, sigmaV: 10, C: 2, N: 4 }).valid).toBe(true)
  })

  it('運算量上限：chains × (blocks + burn-in) 不超過預算；1-bit 引擎在 N 很大時預算依 √N 縮小', () => {
    const res = runUnitsMc({ ...MC_BASE, engine: 'sign', chains: 64, blocks: 1e7 })
    const budget = mcBudget('sign', MC_BASE.N)
    expect(budget).toBeLessThanOrEqual(MC_BLOCK_BUDGET)
    expect(res.nTotal + 64 * res.burnIn).toBeLessThanOrEqual(budget)
    expect(res.nTotal).toBeGreaterThan(budget / 2)
    expect(res.blocksUsed * 64).toBe(res.nTotal)
    expect(res.valid).toBe(true)
    expect(mcBudget('linear', 1 << 20)).toBe(MC_BLOCK_BUDGET)
    expect(mcBudget('sign', 1024)).toBe(MC_BLOCK_BUDGET)
    expect(mcBudget('sign', 1 << 20)).toBe(Math.floor(1.2e7 / 1024))
    expect(mcBudget('sign', 1e12)).toBe(4000)
    // 最大的 N（2²⁰）：仍在合理時間內完成，結果有效或明確說明原因
    const t0 = performance.now()
    const big = runUnitsMc({ ...MC_BASE, engine: 'sign', N: 1 << 20, chains: 16, blocks: 50_000 })
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(5000) // 寬鬆上限（機器忙碌時）；實測約 0.1–0.2 s
    expect(big.nTotal + 16 * big.burnIn).toBeLessThanOrEqual(mcBudget('sign', 1 << 20))
    expect(big.note.length).toBeGreaterThan(10)
  })

  it('planMcBlocks：burn-in 也算在每條 chain 的預算內；放不下時截短並回報 truncated', () => {
    // 預算充足：照要求
    expect(planMcBlocks(107, 4000, 16, 187_500)).toEqual({ burnIn: 107, blocks: 4000, truncated: false })
    // blocks 太多：縮到「預算 − burn-in」
    expect(planMcBlocks(107, 50_000, 64, 187_500)).toEqual({ burnIn: 107, blocks: Math.floor(187_500 / 64) - 107, truncated: false })
    // burn-in 比預算還長：截短到「預算 − 最少 blocks」，blocks 只剩下限
    const slow = planMcBlocks(1_000_000, 4000, 16, 187_500)
    const per = Math.floor(187_500 / 16)
    expect(slow).toEqual({ burnIn: per - MC_MIN_BLOCKS, blocks: MC_MIN_BLOCKS, truncated: true })
    expect(slow.burnIn + slow.blocks).toBe(per)
    // 不需要 burn-in（線性引擎）
    expect(planMcBlocks(0, 4000, 16, 200_000)).toEqual({ burnIn: 0, blocks: 4000, truncated: false })
    // 任何輸入：每條 chain 的總步數不超過 max(預算/chains, 2·最少 blocks)
    for (const [b, n, c, g] of [
      [1e9, 1e9, 64, 4000],
      [5, 10, 1, 200_000],
      [123_456, 7, 3, 50_000],
      [0, 0, 64, 4000],
    ] as const) {
      const pl = planMcBlocks(b, n, c, g)
      expect(pl.burnIn + pl.blocks).toBeLessThanOrEqual(Math.max(2 * MC_MIN_BLOCKS, Math.floor(g / c)))
      expect(pl.blocks).toBeGreaterThanOrEqual(MC_MIN_BLOCKS)
      expect(pl.burnIn).toBeGreaterThanOrEqual(0)
    }
  })

  it('反面（回歸）：很慢的迴路＋1-bit 引擎 —— burn-in 8τ 曾經不受預算限制（μ = 1e−6 fs 時約 10⁹ 個 block／chain，頁面當掉）；現在截短、很快結束、並解釋為什麼不判定', () => {
    for (const mu of [0.01, 1e-6]) {
      const t0 = performance.now()
      const res = runUnitsMc({ ...MC_BASE, engine: 'sign', mu, chains: 64, blocks: 50_000 })
      const ms = performance.now() - t0
      const budget = mcBudget('sign', MC_BASE.N)
      expect(ms, `μ = ${mu}`).toBeLessThan(5000) // 修正前：μ = 0.01 約 3 s、μ = 1e−6 永遠跑不完
      expect(res.burnInTruncated).toBe(true)
      expect(res.nTotal + 64 * res.burnIn).toBeLessThanOrEqual(budget)
      expect(res.valid).toBe(false)
      expect(res.note).toMatch(/burn-in/)
      expect(res.note).toMatch(/改用線性引擎/)
      // 線性引擎的初值直接取穩態分布、不需要 burn-in：不會被截短（但 ESS 不足時仍然不判定，並說明原因）
      const lin = runUnitsMc({ ...MC_BASE, engine: 'linear', mu, chains: 64, blocks: 50_000 })
      expect(lin.burnIn).toBe(0)
      expect(lin.burnInTruncated).toBe(false)
      expect(lin.valid).toBe(false)
      expect(lin.note).toMatch(/ESS/)
    }
    // 正常的 T13 條件不受影響：burn-in 完整、結果有效
    const ok = runUnitsMc({ ...MC_BASE, engine: 'sign' })
    expect(ok.burnInTruncated).toBe(false)
    expect(ok.burnIn).toBe(Math.ceil(8 * (-1 / Math.log(calLoop({ ...T13 }).p))) + 10)
    expect(ok.valid).toBe(true)
  })

  it('runUnitsMcBatch（worker 進入點）：逐一等於 runUnitsMc；參數與結果都可 structured clone', () => {
    const cases: UnitsMcParams[] = [
      { ...MC_BASE, engine: 'sign', chains: 4, blocks: 500 },
      { ...MC_BASE, engine: 'linear', gmMode: 'sum', chains: 2, blocks: 200 },
    ]
    const batch = runUnitsMcBatch(structuredClone({ cases }))
    expect(batch.length).toBe(2)
    cases.forEach((c, i) => {
      const one = runUnitsMc(c)
      expect(batch[i].varHat).toBe(one.varHat)
      expect(batch[i].valid).toBe(one.valid)
      expect(batch[i].note).toBe(one.note)
    })
    const cloned = structuredClone(batch)
    expect(cloned[0].trace).toBeInstanceOf(Float64Array)
    expect(cloned[0].trace.length).toBe(batch[0].trace.length)
    expect(cloned[1].diverged).toBe(true)
    expect(runUnitsMcBatch({ cases: [] })).toEqual([])
  })
})

describe('unitsModel：Monte Carlo 的說明文字', () => {
  it('反面：1-bit 引擎的步長本身就超過模擬上限（μN 極大）時，說明寫的是「步長太大」而不是線性模型的「每個 block 放大 |p| 倍」', () => {
    const res = runUnitsMc({ mu: 1e4, sigmaV: 0.01, C: 2, N: 1 << 20, gmMode: 'sum', engine: 'sign', chains: 4, blocks: 1000, seed: 1 })
    expect(res.diverged).toBe(true)
    expect(res.valid).toBe(false)
    expect(res.note).toMatch(/每個 block 可以走/)
    expect(res.note).not.toMatch(/誤差放大/)
    expect(res.trace.length).toBe(0)
    const lin = runUnitsMc({ mu: 1e4, sigmaV: 0.01, C: 2, N: 1 << 20, gmMode: 'sum', engine: 'linear', chains: 4, blocks: 1000, seed: 1 })
    expect(lin.diverged).toBe(true)
    expect(lin.note).toMatch(/誤差放大/)
    // 每一種結果的說明都是可解析的 LaTeX 夾雜文字（會顯示在警告與交叉比對）
    for (const r of [res, lin, runUnitsMc({ ...MC_BASE, engine: 'sign', mu: 1e-6, chains: 64 }), runUnitsMc({ ...MC_BASE, engine: 'sign', gmMode: 'sum' }), runUnitsMc(MC_BASE)]) {
      expect(richProblems(r.note), r.note).toEqual([])
      expect(r.note).not.toMatch(/NaN|undefined/)
    }
  })
})
