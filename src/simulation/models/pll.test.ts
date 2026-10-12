import { describe, expect, it } from 'vitest'
import { cAbs, cArg, createRng } from '@/simulation/core'
import { freqz, impulseResponse, lfilter } from '@/simulation/signal'
import {
  ar1Autocorr,
  ar1Psd,
  corrEmpirical,
  corrFromAutocorr,
  corrFromPsd,
  corrFromSequence,
  corrSingleTone,
  createHpdFilter,
  crossResponse,
  ctBandwidth3dB,
  ctHpd,
  ctLoopGain,
  ctT,
  designDtLoop,
  errorPathFilter,
  errorPathTransfer,
  loopFreqResponse,
  polarityMarginDeg,
  singleToneFir,
  wnFromBandwidth3dB,
} from '@/simulation/models/pll'

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
const deg = (rad: number): number => (rad * 180) / Math.PI

// 參考值皆由 python3（NumPy 2.x / SciPy 1.17）獨立計算後貼上。

describe('CT 二階 type-II 原型（§6.1）', () => {
  it('ζ=0.7、ω=0.3ω_n：H_PD ≈ −0.0815 + j0.0376，相位 155.22°', () => {
    const H = ctHpd(0.3, { zeta: 0.7, wn: 1 })
    expect(rel(H.re, -0.08153310104529615)).toBeLessThan(1e-12)
    expect(rel(H.im, 0.03763066202090591)).toBeLessThan(1e-12)
    expect(deg(cArg(H))).toBeCloseTo(155.22485943116808, 10)
    // 以 rad/s 給定時結果相同（只與 ω/ω_n 有關）
    const wn = 2 * Math.PI * 1e6
    const H2 = ctHpd(0.3 * wn, { zeta: 0.7, wn })
    expect(rel(H2.re, H.re)).toBeLessThan(1e-12)
    expect(rel(H2.im, H.im)).toBeLessThan(1e-12)
  })

  it('T = 1 − H_PD、L(jω)', () => {
    const T = ctT(0.3, { zeta: 0.7, wn: 1 })
    expect(rel(T.re, 1.081533101045296)).toBeLessThan(1e-12)
    expect(rel(T.im, -0.03763066202090591)).toBeLessThan(1e-12)
    const L = ctLoopGain(0.3, { zeta: 0.7, wn: 1 })
    expect(rel(L.re, -11.11111111111111)).toBeLessThan(1e-12)
    expect(rel(L.im, -4.666666666666667)).toBeLessThan(1e-12)
  })

  it('T(s) 的 −3 dB 頻寬：ζ=0.7 時 ω_3dB = 2.04895033 ω_n，且 |T|² = 1/2', () => {
    const w3 = ctBandwidth3dB({ zeta: 0.7, wn: 1 })
    expect(rel(w3, 2.0489503328320975)).toBeLessThan(1e-12)
    expect(cAbs(ctT(w3, { zeta: 0.7, wn: 1 })) ** 2).toBeCloseTo(0.5, 12)
    expect(rel(wnFromBandwidth3dB(w3 * 5, 0.7), 5)).toBeLessThan(1e-12)
  })
})

describe('DT DPLL 迴路（E44 參數化）', () => {
  it('Ω = 0.3ω_nT_s 處的 H_PD 相位與 SciPy freqz 一致（d = 0, 1）', () => {
    const cases: [number, number, number][] = [
      [0.01, 0, 155.23997765845286],
      [0.1, 0, 155.3783320693497],
      [0.3, 0, 155.70014684152164],
      [0.01, 1, 155.42588445360158],
      [0.1, 1, 157.23780843021143],
      [0.3, 1, 161.28057607566853],
    ]
    for (const [wnTs, d, ref] of cases) {
      const des = designDtLoop({ wnTs, zeta: 0.7, loopDelay: d })
      const H = loopFreqResponse(des, [0.3 * wnTs]).Hpd[0]
      expect(deg(cArg(H)), `wnTs=${wnTs}, d=${d}`).toBeCloseTo(ref, 9)
    }
  })

  it('係數、poles、穩定性（ω_nT_s = 0.1、ζ = 0.7、d = 1）', () => {
    const des = designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 })
    const ref = [1, -2, 1.15, -0.14]
    expect(des.Hpd.a.length).toBe(4)
    des.Hpd.a.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 14))
    expect(des.T.b).toEqual([0, 0, expect.closeTo(0.15, 14), expect.closeTo(-0.14, 14)])
    const mags = des.poles.map(cAbs).sort((a, b) => b - a)
    expect(mags[0]).toBeCloseTo(0.9201180888230515, 12)
    expect(mags[1]).toBeCloseTo(0.9201180888230515, 12)
    expect(mags[2]).toBeCloseTo(0.16536397311200188, 12)
    expect(des.stable).toBe(true)
    expect(des.spectralRadius).toBeCloseTo(0.9201180888230515, 12)
    // L 嚴格因果 ⇒ h_PD[0] = 1
    const h = impulseResponse(des.Hpd.b, des.Hpd.a, 6)
    const hRef = [1, 0, -0.15, -0.16, -0.1475, -0.132]
    hRef.forEach((v, i) => expect(h[i]).toBeCloseTo(v, 13))
  })

  it('頻率響應與 SciPy freqz 一致；H_PD + T = 1', () => {
    const des = designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 })
    const oms = [0.05, 0.3, 1.0, 2.5]
    const fr = loopFreqResponse(des, oms)
    const hRef: [number, number][] = [
      [-0.1886003022612088, 0.15252372484334176],
      [1.1007159923716756, 0.6207044594862077],
      [1.1785745612122946, 0.0016331840598952949],
      [0.954119153450355, -0.056813461028647344],
    ]
    hRef.forEach(([re, im], i) => {
      expect(fr.Hpd[i].re).toBeCloseTo(re, 12)
      expect(fr.Hpd[i].im).toBeCloseTo(im, 12)
      expect(fr.Hpd[i].re + fr.T[i].re).toBeCloseTo(1, 12)
      expect(fr.Hpd[i].im + fr.T[i].im).toBeCloseTo(0, 12)
    })
  })

  it('穩定邊界（ζ = 0.7）：d = 0 約 ω_nT_s ≈ 1.0414，d = 1 約 0.4731，d = 2 約 0.2895', () => {
    const at = (wnTs: number, d: number) => designDtLoop({ wnTs, zeta: 0.7, loopDelay: d })
    expect(at(1.035, 0).stable).toBe(true)
    expect(at(1.048, 0).stable).toBe(false)
    expect(at(0.47, 1).stable).toBe(true)
    expect(at(0.477, 1).stable).toBe(false)
    expect(at(0.287, 2).stable).toBe(true)
    const un = at(0.292, 2)
    expect(un.stable).toBe(false)
    expect(un.warnings.join('')).toMatch(/不穩定/)
  })

  it('以 fs + wn 或 fbw 指定，與 wnTs 等價；參數錯誤時丟出中文錯誤', () => {
    const fs = 4e9
    const wn = 2 * Math.PI * 2e6
    const a = designDtLoop({ fs, wn, zeta: 0.7 })
    const b = designDtLoop({ wnTs: wn / fs, zeta: 0.7 })
    expect(a.Hpd.a).toEqual(b.Hpd.a)
    const fbw = (ctBandwidth3dB({ zeta: 0.7, wn }) / (2 * Math.PI)) as number
    const c = designDtLoop({ fs, fbw, zeta: 0.7 })
    expect(rel(c.wnTs, wn / fs)).toBeLessThan(1e-12)
    expect(() => designDtLoop({ zeta: 0.7 })).toThrow(/恰好/)
    expect(() => designDtLoop({ wn, zeta: 0.7 })).toThrow(/fs/)
    expect(() => designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1.5 })).toThrow(/整數/)
  })

  it("method='bilinear' 與 scipy.signal.bilinear 一致", () => {
    const des = designDtLoop({ wnTs: 0.1, zeta: 0.7, method: 'bilinear' })
    const ref = [0.07249999999999998, 0.005, -0.06749999999999998]
    des.L.b.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 14))
    expect(des.L.a).toEqual([1, -2, 1])
    // 非嚴格因果：h_PD[0] = 1/(1 + 0.0725) ≠ 1
    expect(impulseResponse(des.Hpd.b, des.Hpd.a, 1)[0]).toBeCloseTo(1 / 1.0725, 14)
  })

  it('白色 x 下 C = h_PD[0]·σ² = σ²（頻域積分；E44）', () => {
    const des = designDtLoop({ wnTs: 0.3, zeta: 0.7, loopDelay: 1 })
    const n = 1 << 15
    const om = new Float64Array(n + 1).map((_, i) => (Math.PI * i) / n)
    const C = corrFromPsd({ omega: om, sxx: new Float64Array(n + 1).fill(1), h: des.Hpd })
    expect(C).toBeCloseTo(1, 9)
  })

  it('架構約定（docs/assumptions.md §2a 第 5 點）：誤差在 PD 的 reference 輸入端注入 ⇒ e_PD = +H_PD{φ}、θ_out = +T{φ}（逐 sample 的迴路差分方程）', () => {
    // 不用 H_PD、T 的係數，直接照方塊圖一拍一拍算：e_PD[n] = φ[n] − θ_fb[n]，θ_fb = L{e_PD}（L 嚴格因果，所以沒有代數迴圈）
    const closeLoop = (des: ReturnType<typeof designDtLoop>, phi: Float64Array, side: 'reference' | 'feedback') => {
      const { b, a } = des.L
      expect(b[0]).toBe(0) // L 嚴格因果：θ_fb[n] 只用到過去的 e_PD
      const e = new Float64Array(phi.length)
      const th = new Float64Array(phi.length)
      for (let n = 0; n < phi.length; n++) {
        let y = 0
        for (let k = 1; k < b.length && k <= n; k++) y += b[k] * e[n - k]
        for (let k = 1; k < a.length && k <= n; k++) y -= a[k] * th[n - k]
        th[n] = y / a[0]
        // reference 側（全站約定）：e_PD = φ − θ_fb；對照組把同一個 φ 改從 PD 的另一個輸入加進去（規格 §12.3 的舊寫法），PD 的輸出整個反號
        e[n] = side === 'reference' ? phi[n] - th[n] : -(th[n] + phi[n])
      }
      return { e, th }
    }
    for (const d of [0, 1, 2]) {
      const des = designDtLoop({ wnTs: 0.08, zeta: 0.7, loopDelay: d })
      expect(des.stable).toBe(true)
      const phi = createRng(11 + d).normalArray(4000)
      const h = lfilter(des.Hpd.b, des.Hpd.a, phi).y
      const t = lfilter(des.T.b, des.T.a, phi).y
      const ref = closeLoop(des, phi, 'reference')
      const fb = closeLoop(des, phi, 'feedback')
      let maxRef = 0
      let maxFb = 0
      let maxSum = 0
      for (let n = 0; n < phi.length; n++) {
        // reference 側：兩個都是正號，而且 PD 的輸出加上輸出相位剛好等於注入的誤差（H_PD + T = 1）
        maxRef = Math.max(maxRef, Math.abs(ref.e[n] - h[n]), Math.abs(ref.th[n] - t[n]))
        maxSum = Math.max(maxSum, Math.abs(ref.e[n] + ref.th[n] - phi[n]))
        // feedback 側：同樣的 H_PD、T，只是兩個都多一個負號（|H_PD|、|T|、jitter、spur dBc 因此不變）
        maxFb = Math.max(maxFb, Math.abs(fb.e[n] + h[n]), Math.abs(fb.th[n] + t[n]))
      }
      expect(maxRef).toBeLessThan(1e-9)
      expect(maxFb).toBeLessThan(1e-9)
      expect(maxSum).toBeLessThan(1e-12)
      // 第一拍：L 嚴格因果 ⇒ θ_fb[0] = 0，PD 的輸出就是注入的誤差本身（h_PD[0] = +1）
      expect(ref.e[0]).toBe(phi[0])
      expect(h[0]).toBe(phi[0])
    }
  })

  it('createHpdFilter 狀態跨 block 持續，分段處理 = 一次 lfilter', () => {
    const des = designDtLoop({ wnTs: 0.05, zeta: 0.7, loopDelay: 2 })
    const x = createRng(3).normalArray(3000)
    const ref = lfilter(des.Hpd.b, des.Hpd.a, x).y
    const f = createHpdFilter(des)
    const y = new Float64Array(3000)
    for (let blk = 0; blk < 3; blk++) for (let n = 0; n < 1000; n++) y[blk * 1000 + n] = f.step(x[blk * 1000 + n])
    expect(Array.from(y)).toEqual(Array.from(ref))
  })
})

describe('Error-path 種類', () => {
  it('single_tone：Ω = π/6、φ = 120° 的 2-tap FIR 與 golden 一致，freq(Ω) = |H|e^{jφ}', () => {
    const h = singleToneFir(1, (120 * Math.PI) / 180, Math.PI / 6)
    expect(h[0]).toBeCloseTo(1.0000000000000007, 14)
    expect(h[1]).toBeCloseTo(-1.7320508075688776, 14)
    const f = errorPathFilter('single_tone', { magnitude: 0.8, phase_deg: -120, omega: Math.PI / 6 })
    const H = f.freq(Math.PI / 6)
    expect(cAbs(H)).toBeCloseTo(0.8, 13)
    expect(deg(cArg(H))).toBeCloseTo(-120, 11)
    // 正弦輸入：第一個 sample 之後輸出恰為 A|H|cos(Ωn + θ + φ)
    const A = 1.7
    const th = 0.3
    for (let n = 0; n < 50; n++) {
      const y = f.step(A * Math.cos((Math.PI / 6) * n + th))
      if (n >= 1) expect(y).toBeCloseTo(A * 0.8 * Math.cos((Math.PI / 6) * n + th - (120 * Math.PI) / 180), 12)
    }
  })

  it('single_tone 在 Ω = 0、π：只允許 φ ∈ {0°, 180°}（E46）', () => {
    expect(errorPathTransfer({ kind: 'single_tone', parameters: { magnitude: 2, phase_deg: 180, omega: Math.PI } }).b).toEqual([-2])
    expect(errorPathTransfer({ kind: 'single_tone', parameters: { magnitude: 2, phase_deg: 0, omega: 0 } }).b).toEqual([2])
    expect(() => errorPathFilter('single_tone', { magnitude: 1, phase_deg: 120, omega: Math.PI })).toThrow(/E46/)
  })

  it('first_order_hp = type-I DPLL 的 1/(1+L)：h = [1, ρ−1, (ρ−1)ρ, …]', () => {
    const rho = 0.9
    const f = errorPathFilter('first_order_hp', { pole: rho })
    const y = [f.step(1), f.step(0), f.step(0), f.step(0)]
    ;[1, rho - 1, (rho - 1) * rho, (rho - 1) * rho * rho].forEach((v, i) => expect(y[i]).toBeCloseTo(v, 14))
    expect(cAbs(f.freq(0))).toBe(0)
    expect(cAbs(f.freq(Math.PI))).toBeCloseTo(2 / (1 + rho), 14)
    f.reset()
    expect(f.step(1)).toBe(1)
    expect(() => errorPathFilter('first_order_hp', { pole: 1 })).toThrow(/ρ/)
  })

  it('identity / fir / iir / type2_dt', () => {
    expect(errorPathFilter('identity', {}).step(3.5)).toBe(3.5)
    const fir = errorPathFilter('fir', { taps: [0.5, 0.25] })
    expect([fir.step(1), fir.step(0), fir.step(0)]).toEqual([0.5, 0.25, 0])
    const iir = errorPathFilter('iir', { b: [1], a: [1, -0.5] })
    expect([iir.step(1), iir.step(0), iir.step(0)]).toEqual([1, 0.5, 0.25])
    const t2 = errorPathTransfer({ kind: 'type2_dt', parameters: { wn_ts: 0.1, zeta: 0.7, loop_delay: 1 } })
    expect(t2.a).toEqual(designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 }).Hpd.a)
    // 狀態存取
    const f = errorPathFilter('type2_dt', { wn_ts: 0.1, zeta: 0.7 })
    f.step(1)
    const s = f.getState()
    const y1 = f.step(0.3)
    f.setState(s)
    expect(f.step(0.3)).toBe(y1)
  })
})

describe('相關性 C 的三種算法（§6.1、§6.2、§7）', () => {
  it('T06: 單頻 φ = 120° ⇒ C = (A²/2)|H|cos φ = −0.25 < 0；φ 掃描 0/60/90/120/180°', () => {
    const phis = [0, 60, 90, 120, 180]
    const ref = [0.5, 0.25000000000000006, 3.061616997868383e-17, -0.24999999999999992, -0.5]
    phis.forEach((p, i) => {
      const C = corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: (p * Math.PI) / 180, omega: Math.PI / 6 })
      expect(C).toBeCloseTo(ref[i], 14)
    })
    // 時域：真實 FIR + 整數週期平均，與解析值一致
    const N = 12 * 200 + 1
    const x = new Float64Array(N).map((_, n) => Math.cos((Math.PI / 6) * n))
    const tf = errorPathTransfer({ kind: 'single_tone', parameters: { magnitude: 1, phase_deg: 120, omega: Math.PI / 6 } })
    expect(corrFromSequence({ x, h: tf, skip: 1 })).toBeCloseTo(-0.25, 12)
  })

  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ θ = 0°，C_D = 0.5（最大），polarity margin 90°', () => {
    const ref = [
      -0.24999999999999992, 3.061616997868383e-17, 0.25000000000000006, 0.43301270189221935, 0.5, 0.43301270189221935,
      0.24999999999999994, 3.061616997868383e-17, -0.24999999999999992, -0.43301270189221935, -0.5, -0.4330127018922194,
    ]
    ref.forEach((v, D) => {
      const C = corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: (-120 * Math.PI) / 180, omega: Math.PI / 6, delay: D })
      expect(C).toBeCloseTo(v, 14)
    })
    expect(polarityMarginDeg(-120 + 30 * 4)).toBe(90)
    // 時域 delayed regressor
    const N = 12 * 200 + 8
    const x = new Float64Array(N).map((_, n) => Math.cos((Math.PI / 6) * n))
    const tf = errorPathTransfer({ kind: 'single_tone', parameters: { magnitude: 1, phase_deg: -120, omega: Math.PI / 6 } })
    const u = lfilter(tf.b, tf.a, x).y
    // 取 n = 8 … 8+2400−1（整數週期），x[n−4]·u[n]
    let s = 0
    for (let n = 8; n < 8 + 2400; n++) s += x[n - 4] * u[n]
    expect(s / 2400).toBeCloseTo(0.5, 12)
  })

  it('單頻邊界 Ω = π：C = A²|H|cosφ·cos(ΩD)，是一般公式的 2 倍（E46）', () => {
    expect(corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: 0, omega: Math.PI })).toBeCloseTo(1, 14)
    expect(corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: (120 * Math.PI) / 180, omega: Math.PI })).toBeCloseTo(-0.5, 14)
    expect(corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: 0, omega: Math.PI, delay: 1 })).toBeCloseTo(-1, 14)
  })

  it('隨機 FIR h × AR(1) code：封閉式 = 頻域積分 = 時域經驗值', () => {
    const h = [0.00123, 0.298746, -0.274138, -0.890592, -0.454671, -0.991647, 0.060144]
    const a1 = 0.7
    const sw2 = 1 - a1 * a1 // 單位變異數
    // python：Σ h[k] R_x[k−D] 與 scipy quad 的 (1/2π)∫S_xx Re{H e^{jΩD}} dΩ
    const ref: [number, number][] = [
      [0, -0.4982052129339999],
      [1, -0.7126178756199999],
      [2, -1.2363106365999998],
      [3, -1.719228508],
      [5, -1.7262996732999998],
    ]
    const n = 4096
    const om = new Float64Array(n + 1).map((_, i) => (Math.PI * i) / n)
    const sxx = om.map((w) => ar1Psd(a1, sw2, w))
    // AR(1) 序列（平穩起點）
    const rng = createRng(20261010).fork('ar1')
    const L = 1 << 20
    const x = new Float64Array(L)
    x[0] = rng.normal()
    const g = Math.sqrt(sw2)
    for (let i = 1; i < L; i++) x[i] = a1 * x[i - 1] + g * rng.normal()
    const u = lfilter(h, [1], x).y
    for (const [D, v] of ref) {
      const closed = corrFromAutocorr(h, (l) => ar1Autocorr(a1, sw2, l), D)
      expect(rel(closed, v), `closed D=${D}`).toBeLessThan(1e-12)
      const numeric = corrFromPsd({ omega: om, sxx, h: { b: h, a: [1] }, delay: D })
      expect(Math.abs(numeric - v), `numeric D=${D}`).toBeLessThan(1e-10)
      // 經驗值的標準誤（python 400 次 MC 估計）約 0.0041（L = 2^20）；容忍 6σ
      const emp = corrEmpirical(x, u, D)
      expect(Math.abs(emp - v), `empirical D=${D}: ${emp}`).toBeLessThan(0.025)
    }
  })

  it('Filtered-x 模型誤差（E45）：Ĥ = H·z⁻³ 時 E[u·u_f] = 1.91275，Ĥ = H 時 = E[u²] = 4.10433', () => {
    const h = [0.00123, 0.298746, -0.274138, -0.890592, -0.454671, -0.991647, 0.060144]
    const a1 = 0.7
    const sw2 = 1 - a1 * a1
    const n = 4096
    const om = new Float64Array(n + 1).map((_, i) => (Math.PI * i) / n)
    const sxx = om.map((w) => ar1Psd(a1, sw2, w))
    const hHat = { b: [0, 0, 0, ...h], a: [1] }
    const Cmis = corrFromPsd({ omega: om, sxx, h: crossResponse({ b: h, a: [1] }, hHat, om) })
    expect(Math.abs(Cmis - 1.9127503731315327)).toBeLessThan(1e-10)
    const Cmatch = corrFromPsd({ omega: om, sxx, h: crossResponse({ b: h, a: [1] }, { b: h, a: [1] }, om) })
    expect(Math.abs(Cmatch - 4.104328934352412)).toBeLessThan(1e-10)
  })

  it('雙邊格點 [−π, π] 與半邊格點結果相同；freqz 輸入也可直接傳 Complex[]', () => {
    const h = [0.4, -0.3, 0.2]
    const n = 2048
    const full = new Float64Array(2 * n + 1).map((_, i) => -Math.PI + (Math.PI * i) / n)
    const half = new Float64Array(n + 1).map((_, i) => (Math.PI * i) / n)
    const Sf = full.map((w) => ar1Psd(0.5, 1, w))
    const Sh = half.map((w) => ar1Psd(0.5, 1, w))
    const a = corrFromPsd({ omega: full, sxx: Sf, h: freqz(h, [1], full), delay: 1 })
    const b = corrFromPsd({ omega: half, sxx: Sh, h: { b: h, a: [1] }, delay: 1 })
    const closed = corrFromAutocorr(h, (l) => ar1Autocorr(0.5, 1, l), 1)
    expect(a).toBeCloseTo(closed, 10)
    expect(b).toBeCloseTo(closed, 10)
  })

  it('polarityMarginDeg = 90° − |wrap180(θ)|', () => {
    expect(polarityMarginDeg(0)).toBe(90)
    expect(polarityMarginDeg(120)).toBe(-30)
    expect(polarityMarginDeg(-120)).toBe(-30)
    expect(polarityMarginDeg(90)).toBe(0)
    expect(polarityMarginDeg(180)).toBe(-90)
    expect(polarityMarginDeg(-180)).toBe(-90)
    expect(polarityMarginDeg(390)).toBe(60)
  })
})
