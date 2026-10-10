import { describe, expect, it } from 'vitest'
import { fft, fftfreq, fftReal, fftshift, ifft, isPow2, nextPow2, rfftfreq } from '@/simulation/signal/fft'
import { lcg } from '@/simulation/signal/testSignals'

/** 直接定義的 DFT（O(N²)），角度用 (n·k mod N) 精確化，作為獨立參考。 */
function naiveDft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const N = re.length
  const cosT = new Float64Array(N)
  const sinT = new Float64Array(N)
  for (let m = 0; m < N; m++) {
    cosT[m] = Math.cos((2 * Math.PI * m) / N)
    sinT[m] = Math.sin((2 * Math.PI * m) / N)
  }
  const Xr = new Float64Array(N)
  const Xi = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let sr = 0
    let si = 0
    for (let n = 0; n < N; n++) {
      const m = (n * k) % N
      // x · e^{-jθ} = (xr + j xi)(cos − j sin)
      sr += re[n] * cosT[m] + im[n] * sinT[m]
      si += im[n] * cosT[m] - re[n] * sinT[m]
    }
    Xr[k] = sr
    Xi[k] = si
  }
  return { re: Xr, im: Xi }
}

function randomComplex(N: number, seed: number): { re: Float64Array; im: Float64Array } {
  const u = lcg(2 * N, seed)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    re[i] = u[2 * i] - 0.5
    im[i] = u[2 * i + 1] - 0.5
  }
  return { re, im }
}

function maxRelErr(aRe: Float64Array, aIm: Float64Array, bRe: Float64Array, bIm: Float64Array): number {
  let err = 0
  let scale = 0
  for (let i = 0; i < aRe.length; i++) {
    err = Math.max(err, Math.hypot(aRe[i] - bRe[i], aIm[i] - bIm[i]))
    scale = Math.max(scale, Math.hypot(bRe[i], bIm[i]))
  }
  return err / Math.max(scale, 1e-300)
}

describe('nextPow2 / isPow2', () => {
  it('邊界值', () => {
    expect([0, 1, 2, 3, 5, 1000, 1024, 1025].map(nextPow2)).toEqual([1, 1, 2, 4, 8, 1024, 1024, 2048])
    expect([1, 2, 3, 64, 96, 4096].map(isPow2)).toEqual([true, true, false, true, false, true])
  })
})

describe('fft vs naive DFT', () => {
  it('N = 1 … 64（radix-2 與 Bluestein）', () => {
    for (let N = 1; N <= 64; N++) {
      const x = randomComplex(N, 1000 + N)
      const ref = naiveDft(x.re, x.im)
      const re = Float64Array.from(x.re)
      const im = Float64Array.from(x.im)
      fft(re, im)
      expect(maxRelErr(re, im, ref.re, ref.im), `N=${N}`).toBeLessThan(1e-13)
    }
  })

  it.each([1000, 4096, 997, 4095])('N = %i', (N) => {
    const x = randomComplex(N, 77)
    const ref = naiveDft(x.re, x.im)
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im)
    expect(maxRelErr(re, im, ref.re, ref.im)).toBeLessThan(1e-12)
  })

  it.each([100003, 1 << 17])('大 N = %i：抽查數個 bin 與直接求和比較', (N) => {
    const x = randomComplex(N, 4242)
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im)
    for (const k of [0, 1, 777, Math.floor(N / 2), N - 3]) {
      let sr = 0
      let si = 0
      for (let n = 0; n < N; n++) {
        const t = (2 * Math.PI * ((n * k) % N)) / N // n·k < 2^53，取餘數精確
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        sr += x.re[n] * cs + x.im[n] * sn
        si += x.im[n] * cs - x.re[n] * sn
      }
      // |X[k]| ~ √N·0.4；實測誤差約 6e-15·√N（含參考直接求和本身的誤差），上限 1e-12·√N
      expect(Math.hypot(re[k] - sr, im[k] - si), `k=${k}`).toBeLessThan(1e-12 * Math.sqrt(N))
    }
  })

  it('符號約定與 NumPy 相同（np.fft.fft 參考值）', () => {
    // np.fft.fft([1,2,3,4,5])
    const re = Float64Array.from([1, 2, 3, 4, 5])
    const im = new Float64Array(5)
    fft(re, im)
    const refRe = [15, -2.5, -2.5, -2.5, -2.5]
    const refIm = [0, 3.440954801177934, 0.8122992405822659, -0.8122992405822659, -3.440954801177934]
    for (let k = 0; k < 5; k++) {
      expect(re[k]).toBeCloseTo(refRe[k], 13)
      expect(im[k]).toBeCloseTo(refIm[k], 13)
    }
    // np.fft.fft([1,-2,0.5,3,0,1.25,-1])（奇數長度 → Bluestein）
    const X = fftReal([1, -2, 0.5, 3, 0, 1.25, -1])
    const r7 = [2.75, -3.962787643707008, 1.9613366886159103, 4.126450955091098, 4.126450955091098, 1.9613366886159103, -3.962787643707008]
    const i7 = [0, 0.21137619925172318, 2.9950095552477443, -3.0772736092789352, 3.0772736092789352, -2.9950095552477443, -0.21137619925172318]
    for (let k = 0; k < 7; k++) {
      expect(X.re[k]).toBeCloseTo(r7[k], 13)
      expect(X.im[k]).toBeCloseTo(i7[k], 13)
    }
  })

  it('cos tone 落在 bin k0：X[k0] = X[N−k0] = N/2', () => {
    for (const N of [64, 100]) {
      const k0 = 7
      const x = new Float64Array(N)
      for (let n = 0; n < N; n++) x[n] = Math.cos((2 * Math.PI * k0 * n) / N)
      const X = fftReal(x)
      expect(X.re[k0]).toBeCloseTo(N / 2, 10)
      expect(X.re[N - k0]).toBeCloseTo(N / 2, 10)
      expect(Math.abs(X.im[k0])).toBeLessThan(1e-10)
      expect(Math.hypot(X.re[3], X.im[3])).toBeLessThan(1e-10)
    }
  })
})

describe('ifft', () => {
  it.each([1, 2, 7, 16, 1000, 1024])('ifft(fft(x)) = x，N = %i', (N) => {
    const x = randomComplex(N, 5)
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im)
    ifft(re, im)
    expect(maxRelErr(re, im, x.re, x.im)).toBeLessThan(1e-13)
  })

  it('Parseval：Σ|x|² = (1/N) Σ|X|²', () => {
    const N = 1000
    const x = randomComplex(N, 9)
    let ex = 0
    for (let i = 0; i < N; i++) ex += x.re[i] ** 2 + x.im[i] ** 2
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im)
    let eX = 0
    for (let i = 0; i < N; i++) eX += re[i] ** 2 + im[i] ** 2
    expect(eX / N).toBeCloseTo(ex, 10)
  })

  it('長度不符時丟出錯誤', () => {
    expect(() => fft(new Float64Array(4), new Float64Array(3))).toThrow()
  })
})

describe('頻率軸', () => {
  it('fftfreq / rfftfreq / fftshift 與 NumPy 相同', () => {
    expect(Array.from(fftfreq(7, 14))).toEqual([0, 2, 4, 6, -6, -4, -2])
    expect(Array.from(fftfreq(8, 8))).toEqual([0, 1, 2, 3, -4, -3, -2, -1])
    expect(Array.from(rfftfreq(7, 14))).toEqual([0, 2, 4, 6])
    expect(Array.from(rfftfreq(8, 8))).toEqual([0, 1, 2, 3, 4])
    expect(Array.from(fftshift([0, 1, 2, 3, 4, 5, 6]))).toEqual([4, 5, 6, 0, 1, 2, 3])
    expect(Array.from(fftshift([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual([4, 5, 6, 7, 0, 1, 2, 3])
  })

  it('fftReal 補零與截斷', () => {
    // [1, 1, 0, 0] 的 DFT：X[k] = 1 + e^{-jπk/2}
    const X = fftReal([1, 1], 4)
    const refRe = [2, 1, 0, 1]
    const refIm = [0, -1, 0, 1]
    for (let k = 0; k < 4; k++) {
      expect(X.re[k]).toBeCloseTo(refRe[k], 14)
      expect(X.im[k]).toBeCloseTo(refIm[k], 14)
    }
    // 只取前 2 點 [1, 2]
    const Y = fftReal([1, 2, 3, 4], 2)
    expect(Y.re[0]).toBeCloseTo(3, 14)
    expect(Y.re[1]).toBeCloseTo(-1, 14)
  })
})
