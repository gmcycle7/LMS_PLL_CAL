import { NUM } from './numbers'

/** 內文數字（numbers.ts，由模型計算）與 docs/validation.md 勘誤中的參考值一致 */
describe('Ch10 內文數字', () => {
  it('交叉耦合例：G₁ = 0.8·K_q·10 = 0.06383、w₁ 被推 0.638 fs；手算表 δ₁ = −4、δ₂ = 4.1', () => {
    expect(NUM.coupling.G1lin).toBeCloseTo(0.0638308, 6)
    expect(NUM.coupling.w1Shift).toBeCloseTo(0.638308, 5)
    expect(NUM.coupling.handRows[1].d1).toBeCloseTo(-4, 12)
    expect(NUM.coupling.handRows[2].d2).toBeCloseTo(4.1, 12)
  })

  it('T10/T11：λ = 1.99 / 0.01、κ = 199、598 / 5 / 65、M ≈ 25.13 / −24.87、R⁻¹ ≈ 50.25 / −49.75（E21）', () => {
    const r = NUM.rho099
    expect(r.eig[0]).toBeCloseTo(1.99, 12)
    expect(r.eig[1]).toBeCloseTo(0.01, 12)
    expect(r.cond).toBeCloseTo(199, 8)
    expect(r.blocksScalar).toBe(598)
    expect(r.blocksFull).toBe(5)
    expect(r.blocksReg).toBe(65)
    expect(r.Mn[0][0]).toBeCloseTo(25.1256, 4)
    expect(r.Mn[0][1]).toBeCloseTo(-24.8744, 4)
    expect(r.Rinv[0][0]).toBeCloseTo(50.2513, 4)
    expect(r.Rinv[0][1]).toBeCloseTo(-49.7487, 4)
    expect(r.eigMn[0]).toBeCloseTo(50, 9)
    expect(r.nlmsBlocks).toBe(598)
  })

  it('E05/E08：實體 K_q ⇒ 0.99996011、75,091 blocks；忘了 K_q ⇒ 0.99601、750 blocks', () => {
    expect(NUM.phys.slowPole).toBeCloseTo(0.99996011, 8)
    expect(NUM.phys.blocks).toBe(75091)
    expect(NUM.phys.forgotKqPole).toBeCloseTo(0.99601, 5)
    expect(NUM.phys.forgotKqBlocks).toBe(750)
    expect(NUM.phys.fullBlocks).toBe(5)
  })

  it('E37/E21：模式 127.83 / 0.642、每參數 64.24 fs²；√199；133× / 44.8×', () => {
    const z = NUM.noise
    expect(z.modeVar[1]).toBeCloseTo(127.8317, 3)
    expect(z.modeVar[0]).toBeCloseTo(0.64237, 4)
    expect(z.perParam[0]).toBeCloseTo(64.237, 2)
    expect(z.ratioStd).toBeCloseTo(14.107, 3)
    expect(z.perN.fullSlow / z.perN.scalarSlow).toBeCloseTo(133.0, 0)
    expect(z.perN.fullTrace / z.perN.scalarTrace).toBeCloseTo(44.78, 1)
    expect(z.validity).toBeCloseTo(z.validityFormula, 12)
  })

  it('T18 / E24：1.2 / 0.4、reg 0.5455 / 0.5055；ρ̂ = .996 ⇒ −1.5', () => {
    expect(NUM.t18.poles[0]).toBeCloseTo(1.2, 12)
    expect(NUM.t18.poles[1]).toBeCloseTo(0.4, 12)
    expect(NUM.t18.regPoles[0]).toBeCloseTo(0.545454545, 8)
    expect(NUM.t18.regPoles[1]).toBeCloseTo(0.505494505, 8)
    const r996 = NUM.e24.find((x) => x.rhoHat === 0.996 && x.lambdaReg === 0)!
    expect(r996.poles[1]).toBeCloseTo(-1.5, 9)
    const crit = NUM.e24.find((x) => x.rhoHat === 0.995)!
    expect(crit.rho).toBeCloseTo(1, 9)
  })

  it('Sequential 陷阱：w 終值 (4, 0)、δ₁ + δ₂ = 0；ρ = 0.99 Gauss–Seidel 每輪 ρ²', () => {
    const last = NUM.seq.rows[NUM.seq.rows.length - 1]
    expect(last.w1).toBeCloseTo(4, 9)
    expect(last.w2).toBeCloseTo(0, 9)
    expect(last.sum).toBeCloseTo(0, 9)
    expect(NUM.seq.gsSweep).toBeCloseTo(0.9801, 9)
    expect(NUM.seq.gsBlocks).toBeGreaterThan(250)
  })

  it('中央差分截斷：±1 碼 0.3σ ⇒ 0.9852（−1.5%）、1σ ⇒ 0.8556（−14.4%）', () => {
    const r03 = NUM.fd.rows.find((r) => r.r === 0.3)!
    const r1 = NUM.fd.rows.find((r) => r.r === 1)!
    expect(r03.pm1).toBeCloseTo(0.9852, 4)
    expect(r1.pm1).toBeCloseTo(0.8556, 4)
    expect(r03.stdNj4096).toBeCloseTo(0.0462, 4)
  })
})
