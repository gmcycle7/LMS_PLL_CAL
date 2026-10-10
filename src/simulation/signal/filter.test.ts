import { describe, expect, it } from 'vitest'
import { cAbs } from '@/simulation/core/complex'
import { bilinear, freqs, freqz, freqzHz, impulseResponse, lfilter, lfilterZi, StreamFilter } from '@/simulation/signal/filter'
import { relErr, testSignal } from '@/simulation/signal/testSignals'

// 參考值：scipy 1.17.1。輸入 x = testSignal(1000, 12345) 的前 50 點。
const X50 = testSignal(1000, 12345).subarray(0, 50)
const B = [0.5, -0.2, 0.1, 0.05]
const A = [2.0, -1.1, 0.4] // a[0] ≠ 1：測試正規化；len(b) > len(a)：測試補零

function expectArrayRel(a: ArrayLike<number>, b: readonly number[], rtol = 1e-12): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(relErr(a[i], b[i], 1e-30), `i=${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(rtol)
}

describe('lfilter vs scipy.signal.lfilter', () => {
  it('initial rest', () => {
    const { y } = lfilter(B, A, X50)
    const ref: [number, number][] = [
      [0, -0.16479865713045],
      [1, 0.0710400843265771],
      [2, 0.4722701944616354],
      [10, 0.2529185599793838],
      [49, 0.2442472633657419],
    ]
    for (const [i, v] of ref) expect(relErr(y[i], v)).toBeLessThan(1e-12)
  })

  it('給定 zi：y 與 zf', () => {
    const { y, zf } = lfilter(B, A, X50, [0.3, -0.2, 0.1])
    const ref: [number, number][] = [
      [0, 0.13520134286955],
      [1, 0.0360400843265771],
      [2, 0.49302019446163536],
      [10, 0.25298494969425683],
      [49, 0.2442472633657419],
    ]
    for (const [i, v] of ref) expect(relErr(y[i], v)).toBeLessThan(1e-12)
    expectArrayRel(zf, [0.009351917077889136, -0.0016822541701006055, 0.029607641690946474], 1e-11)
  })

  it('分段濾波（zf → zi）與一次濾波完全相同', () => {
    const whole = lfilter(B, A, X50)
    const p1 = lfilter(B, A, X50.subarray(0, 17))
    const p2 = lfilter(B, A, X50.subarray(17), p1.zf)
    for (let i = 0; i < 17; i++) expect(p1.y[i]).toBe(whole.y[i])
    for (let i = 17; i < 50; i++) expect(p2.y[i - 17]).toBe(whole.y[i])
    expect(Array.from(p2.zf)).toEqual(Array.from(whole.zf))
  })

  it('純增益與 FIR', () => {
    expect(Array.from(lfilter([3], [2], [1, 2, 3]).y)).toEqual([1.5, 3, 4.5])
    // 移動平均 FIR
    expect(Array.from(lfilter([0.5, 0.5], [1], [2, 4, 6, 8]).y)).toEqual([1, 3, 5, 7])
  })

  it('錯誤輸入', () => {
    expect(() => lfilter([1], [0, 1], [1])).toThrow()
    expect(() => lfilter(B, A, X50, [0, 0])).toThrow()
  })

  it('lfilterZi vs scipy.signal.lfilter_zi，且步階輸入無暫態', () => {
    const zi = lfilterZi(B, A)
    expectArrayRel(zi, [0.09615384615384617, 0.005769230769230768, 0.025], 1e-12)
    const { y } = lfilter(B, A, new Float64Array(20).fill(1), zi)
    const dc = (0.5 - 0.2 + 0.1 + 0.05) / (2 - 1.1 + 0.4)
    for (const v of y) expect(v).toBeCloseTo(dc, 13)
    expect(() => lfilterZi([1], [1, -1])).toThrow() // 積分器：z = 1 極點
  })
})

describe('StreamFilter', () => {
  it('逐點 step 與 lfilter 完全相同；狀態可存取', () => {
    const f = new StreamFilter(B, A)
    const ref = lfilter(B, A, X50)
    for (let i = 0; i < 30; i++) expect(f.step(X50[i])).toBe(ref.y[i])
    const saved = f.getState()
    const rest = f.process(X50.subarray(30))
    for (let i = 30; i < 50; i++) expect(rest[i - 30]).toBe(ref.y[i])
    expect(Array.from(f.getState())).toEqual(Array.from(ref.zf))
    // 還原狀態後重跑後半段，結果相同
    f.setState(saved)
    expect(f.step(X50[30])).toBe(ref.y[30])
    // reset → initial rest
    f.reset()
    expect(f.step(X50[0])).toBe(ref.y[0])
    expect(f.order).toBe(3)
  })

  it('建構時給 zi 等同 lfilter(…, zi)', () => {
    const zi = [0.3, -0.2, 0.1]
    const f = new StreamFilter(B, A, zi)
    const ref = lfilter(B, A, X50, zi)
    for (let i = 0; i < 50; i++) expect(f.step(X50[i])).toBe(ref.y[i])
  })

  it('order 0（純增益）', () => {
    const f = new StreamFilter([2])
    expect(f.order).toBe(0)
    expect(f.step(1.5)).toBe(3)
  })
})

describe('freqz / freqs', () => {
  it('freqz vs scipy.signal.freqz(b, a, worN=Ω)', () => {
    const om = [0.0, 0.1, 1.0, 2.5, Math.PI]
    const ref: [number, number][] = [
      [0.34615384615384626, 0.0],
      [0.34387490190283876, -0.0193542209417703],
      [0.22269549421305462, -0.04424109144273178],
      [0.22775324393894533, -0.022909217682741737],
      [0.21428571428571427, -5.498414200253425e-18],
    ]
    const H = freqz(B, A, om)
    for (let i = 0; i < om.length; i++) {
      expect(H[i].re).toBeCloseTo(ref[i][0], 13)
      expect(H[i].im).toBeCloseTo(ref[i][1], 13)
    }
    // DC 增益 = Σb/Σa
    expect(H[0].re).toBeCloseTo(0.45 / 1.3, 14)
    // freqzHz：f = Ω·fs/(2π)
    const fs = 48e3
    const Hz = freqzHz(B, A, om.map((o) => (o * fs) / (2 * Math.PI)), fs)
    for (let i = 0; i < om.length; i++) {
      expect(Hz[i].re).toBeCloseTo(H[i].re, 13)
      expect(Hz[i].im).toBeCloseTo(H[i].im, 13)
    }
  })

  it('freqs vs scipy.signal.freqs：s²/(s² + 2ζω_n s + ω_n²)', () => {
    const wn = 2 * Math.PI * 1e6
    const zeta = 0.7
    const H = freqs([1, 0, 0], [1, 2 * zeta * wn, wn * wn], [0, 1e5, wn, 3e7])
    const ref: [number, number][] = [
      [0.0, 0.0],
      [-0.0002532413463394787, 5.644075350112057e-6],
      [0.0, 0.7142857142857143], // ω = ω_n：H = −ω²/(j2ζω²) = j/(2ζ)
      [0.9559730217587792, 0.2931656128384635],
    ]
    for (let i = 0; i < 4; i++) {
      expect(H[i].re).toBeCloseTo(ref[i][0], 13)
      expect(H[i].im).toBeCloseTo(ref[i][1], 13)
    }
  })
})

describe('bilinear vs scipy.signal.bilinear', () => {
  const wn = 2 * Math.PI * 1e6
  const zeta = 0.7
  const bs = [1, 0, 0]
  const as = [1, 2 * zeta * wn, wn * wn]

  it('2 階 high-pass s²/(s² + 2·0.7·ω s + ω²)，ω = 2π·1 MHz，fs = 50 MHz', () => {
    const { b, a } = bilinear(bs, as, 50e6)
    expectArrayRel(b, [0.9158243527360839, -1.8316487054721677, 0.9158243527360839], 1e-12)
    expectArrayRel(a, [1.0, -1.8244176462222568, 0.8388797647220788], 1e-12)
  })

  it('3 階 Butterworth low-pass（scipy.signal.butter(3, 2π·2e6, analog=True)），fs = 50 MHz', () => {
    const bb = [1.9844017075391882e21]
    const ab = [1.0, 25132741.228718348, 315827340834859.5, 1.9844017075391882e21]
    const { b, a } = bilinear(bb, ab, 50e6)
    expectArrayRel(b, [0.001544408224400375, 0.004633224673201125, 0.004633224673201125, 0.001544408224400375], 1e-11)
    expectArrayRel(a, [1.0, -2.5012102961195413, 2.1192735721579257, -0.6057080102431813], 1e-12)
  })

  it('分子階數 < 分母：(s + 1e5)/(s² + 3e6 s + 2e12)，fs = 20 MHz', () => {
    const { b, a } = bilinear([1, 1e5], [1, 3e6, 2e12], 20e6)
    expectArrayRel(b, [2.328687572590011e-8, 1.1614401858304128e-10, -2.317073170731707e-8], 1e-10)
    expectArrayRel(a, [1.0, -1.8559814169570268, 0.8606271777003485], 1e-12)
  })

  it('prewarp：等同 scipy.bilinear(fs = K/2)，且在 f_p 處 |H_d| = |H_a|', () => {
    const fs = 50e6
    const fp = 5e6
    const { b, a } = bilinear(bs, as, fs, fp)
    // K/2 = π f_p / tan(π f_p/fs) = 48344139.952320136
    expectArrayRel(b, [0.9130748811526112, -1.8261497623052223, 0.9130748811526112], 1e-12)
    expectArrayRel(a, [1.0, -1.8184380919027663, 0.8338614327076781], 1e-12)
    const Hd = freqz(b, a, [(2 * Math.PI * fp) / fs])[0]
    const Ha = freqs(bs, as, [2 * Math.PI * fp])[0]
    expect(relErr(Hd.re, Ha.re)).toBeLessThan(1e-11)
    expect(relErr(Hd.im, Ha.im)).toBeLessThan(1e-11)
    expect(() => bilinear(bs, as, fs, fs / 2)).toThrow()
  })

  it('低頻時數位響應逼近類比響應（frequency warping 小）', () => {
    const fs = 50e6
    const { b, a } = bilinear(bs, as, fs)
    const f = 1e6
    const Hd = cAbs(freqz(b, a, [(2 * Math.PI * f) / fs])[0])
    const Ha = cAbs(freqs(bs, as, [2 * Math.PI * f])[0])
    expect(relErr(Hd, Ha)).toBeLessThan(5e-3)
  })
})

describe('impulseResponse', () => {
  it('vs scipy.signal.lfilter(b, a, δ)', () => {
    const h = impulseResponse(B, A, 10)
    expectArrayRel(
      h,
      [
        0.25, 0.037500000000000006, 0.020625000000000004, 0.02884375, 0.011739062500000001, 0.0006877343750000007,
        -0.0019695585937500003, -0.0012208041015625004, -0.00027753053710937516, 9.151902490234375e-5,
      ],
      1e-11,
    )
  })

  it('一階 IIR：h[n] = (1−α) αⁿ', () => {
    const alpha = 0.9
    const h = impulseResponse([1 - alpha], [1, -alpha], 50)
    for (let n = 0; n < 50; n++) expect(h[n]).toBeCloseTo((1 - alpha) * alpha ** n, 14)
  })
})
