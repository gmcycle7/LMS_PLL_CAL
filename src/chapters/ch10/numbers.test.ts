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

  it('審查 R06a：1-bit 的平均增益 ÷ K_q = 1/√(1 + s_δ²)（Gaussian regressor）——s_δ = 0.1 / 0.3 / 1 ⇒ 0.99504 / 0.95783 / 0.70711', () => {
    const g = NUM.smallSignal
    expect(g.s).toEqual([0.1, 0.3, 1])
    // 獨立重算：1/√1.01、1/√1.09、1/√2
    expect(g.gain[0]).toBeCloseTo(0.9950371902, 9)
    expect(g.gain[1]).toBeCloseTo(0.9578262852, 9)
    expect(g.gain[2]).toBeCloseTo(0.7071067812, 9)
    g.s.forEach((sd, i) => expect(g.gain[i]).toBeCloseTo(1 / Math.sqrt(1 + sd * sd), 12))
    // 頁面上寫的「少 0.5% / 4.2% / 29%」
    expect(100 * (1 - g.gain[0])).toBeCloseTo(0.496, 3)
    expect(100 * (1 - g.gain[1])).toBeCloseTo(4.217, 3)
    expect(100 * (1 - g.gain[2])).toBeCloseTo(29.289, 3)
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

  it('審查 C01：步長超過 2/(λ_max+λ_min) 時最慢的是 λ_max 的模式（ρ = 0.5、μK_q = 1.2 ⇒ −0.8 / 0.4、14 vs 4 blocks）', () => {
    const b = NUM.fastLed
    expect(b.eig[0]).toBeCloseTo(1.5, 12)
    expect(b.eig[1]).toBeCloseTo(0.5, 12)
    expect(b.fast).toBeCloseTo(-0.8, 12)
    expect(b.slow).toBeCloseTo(0.4, 12)
    expect(b.dominant).toBeCloseTo(0.8, 12)
    expect(b.muMax).toBeCloseTo(1.3333333, 7)
    expect(b.muCross).toBeCloseTo(1, 12)
    // 例子的步長落在「換手點」與穩定上限之間
    expect(b.muKq).toBeGreaterThan(b.muCross)
    expect(b.muKq).toBeLessThan(b.muMax)
    expect(b.blocks).toBe(14)
    expect(b.blocksSlowAlone).toBe(4)
    // 對照：本章其餘例子都在 μK_q ≤ 1，數字不變
    expect(NUM.rho099.blocksScalar).toBe(598)
    expect(NUM.seq.scalarMu1Blocks).toBe(299)
    // (κ − 1)/(κ + 1) = 198/200，就是 μK_q = 1 時的主導 pole
    expect(NUM.rho099.bestMaxPole).toBeCloseTo(0.99, 9)
    expect(NUM.rho099.bestMaxPole).toBeCloseTo(NUM.seq.scalarMu1Pole, 9)
    // 「慢模式 pole > 1 − 2/κ」比它寬鬆
    expect(1 - 2 / NUM.rho099.cond).toBeLessThan(NUM.rho099.bestMaxPole)
  })

  it('審查 R02：非正規的 A = [[0.5, 1], [0, 0.5]]——ρ = 0.5、F-10.5 給 5，實際要 9；‖δ_k‖ = 0.314 / 0.0626 / 0.0352', () => {
    const q = NUM.nonNormal
    expect(q.A).toEqual([
      [0.5, 1],
      [0, 0.5],
    ])
    expect(q.rho).toBeCloseTo(0.5, 12)
    expect(q.asym).toBe(5)
    expect(q.blocks).toBe(9)
    expect(q.n5).toBeCloseTo(0.3140586, 6)
    expect(q.n8).toBeCloseTo(0.062622, 6)
    expect(q.n9).toBeCloseTo(0.0352105, 6)
    expect(q.n8).toBeGreaterThan(0.05)
    expect(q.n9).toBeLessThan(0.05)
    // 對照：本章印出來的 block 數全部來自對稱的 A，不受影響
    expect([NUM.rho099.blocksScalar, NUM.rho099.blocksFull, NUM.rho099.blocksReg]).toEqual([598, 5, 65])
    expect(NUM.rho099.regJBlocks).toBe(5996)
    expect(NUM.phys.blocks).toBe(75091)
    expect(NUM.compare.map((c) => c.blocks95)).toEqual([598, 598, 598, 5, 65, 334])
  })
})
