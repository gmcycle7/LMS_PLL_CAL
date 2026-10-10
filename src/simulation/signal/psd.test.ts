import { describe, expect, it } from 'vitest'
import {
  dtftPsdToOnesided,
  findTones,
  integratePsd,
  periodogram,
  psdToDbcHz,
  toneFit,
  toneFitMulti,
  welch,
  type PsdResult,
} from '@/simulation/signal/psd'
import { lcg, relErr, testSignal } from '@/simulation/signal/testSignals'

/**
 * 參考值由 scipy 1.17.1 / numpy 2.4.4 計算（輸入 x = testSignal(1000, 12345)，與 Python 逐位元相同）：
 *   x = 1.5 sin(2π·0.1234 k) + 2(u − 0.5) + 0.3，fs = 1000 Hz
 * 每筆為 [index, f, psd]。
 */
type Ref = [number, number, number][]

const FS = 1000
const X = testSignal(1000, 12345)

function expectMatches(r: PsdResult, ref: Ref, len: number, rtol = 1e-10, atol = 1e-25): void {
  expect(r.f.length).toBe(len)
  expect(r.psd.length).toBe(len)
  for (const [i, f, p] of ref) {
    expect(r.f[i]).toBeCloseTo(f, 9)
    const err = Math.abs(r.psd[i] - p)
    expect(err <= atol || err / Math.abs(p) <= rtol, `bin ${i}: ${r.psd[i]} vs ${p}`).toBe(true)
  }
}

describe('測試訊號與 Python 一致', () => {
  it('x[0…2]', () => {
    expect(X[0]).toBeCloseTo(-0.6591946285218, 14)
    expect(X[1]).toBeCloseTo(0.38303953158457843, 14)
    expect(X[2]).toBeCloseTo(1.8860084049619033, 14)
  })
})

describe('periodogram vs scipy.signal.periodogram', () => {
  it('預設：boxcar、detrend=constant、one-sided、density', () => {
    const r = periodogram(X, FS)
    expectMatches(
      r,
      [
        [0, 0.0, 6.367605878630299e-33], // DC：減平均後 ≈ 0（只比較絕對誤差）
        [1, 1.0, 0.0007036858273661245],
        [123, 123.0, 0.593241611137303],
        [124, 124.0, 0.3056937910180092],
        [250, 250.0, 0.0010844920477308256],
        [499, 499.0, 0.004113333326474966],
        [500, 500.0, 0.0009995973271726309], // Nyquist：不加倍
      ],
      501,
      1e-10,
      1e-25,
    )
    expect(r.units).toBe('x^2/Hz')
    expect(r.onesided).toBe(true)
    expect(r.window).toBe('rectangular')
    expect(r.nSegments).toBe(1)
    expect(r.enbwHz).toBeCloseTo(1, 12) // 矩形窗 ENBW = fs/N = 1 Hz
    expect(r.df).toBe(1)
  })

  it("window='hann'、nfft=1024（補零）", () => {
    const r = periodogram(X, FS, { window: 'hann', nfft: 1024 })
    expectMatches(
      r,
      [
        [0, 0.0, 0.00021768080541706634],
        [1, 0.9765625, 0.0008983676092601629],
        [126, 123.046875, 0.6010937116099534],
        [127, 124.0234375, 0.4371222123699811],
        [300, 292.96875, 0.00023456808304271013],
        [511, 499.0234375, 0.005293371180750316],
        [512, 500.0, 0.0013601797149445669],
      ],
      513,
    )
    expect(r.nperseg).toBe(1000)
    expect(r.nfft).toBe(1024)
    expect(r.enbwHz).toBeCloseTo(1.5, 12) // periodic Hann：1.5 bins × fs/N
  })

  it('nfft=999 < N：只用前 999 點（奇數 nfft，無 Nyquist bin）', () => {
    const r = periodogram(X, FS, { nfft: 999 })
    expectMatches(
      r,
      [
        [0, 0.0, 2.7083389842945504e-35],
        [1, 1.001001001001001, 0.000752458096462203],
        [123, 123.12312312312314, 0.819102224155636],
        [499, 499.49949949949956, 0.002669465924223643],
      ],
      500,
    )
  })
})

describe('welch vs scipy.signal.welch', () => {
  it('預設：hann(periodic)、nperseg=256、noverlap=128、detrend=constant', () => {
    const r = welch(X, FS)
    expectMatches(
      r,
      [
        [0, 0.0, 7.733457187664019e-5],
        [1, 3.90625, 0.0005046785877285475],
        [31, 121.09375, 0.12218070947960641],
        [32, 125.0, 0.15620408121998938],
        [64, 250.0, 0.0005529394275768113],
        [127, 496.09375, 0.0017858440657636972],
        [128, 500.0, 0.0012882343108423352],
      ],
      129,
    )
    expect(r.nperseg).toBe(256)
    expect(r.noverlap).toBe(128)
    expect(r.nSegments).toBe(6) // ⌊(1000 − 128)/128⌋
    expect(r.unusedSamples).toBe(1000 - (5 * 128 + 256))
    expect(r.warnings).toEqual([])
    expect(r.window).toBe('hann')
    expect(r.enbwHz).toBeCloseTo((1.5 * FS) / 256, 12)
    expect(r.enbwBins).toBeCloseTo(1.5, 12)
  })

  it("window='blackmanHarris'、nperseg=200、noverlap=50、nfft=256、detrend='linear'", () => {
    const r = welch(X, FS, { window: 'blackmanHarris', nperseg: 200, noverlap: 50, nfft: 256, detrend: 'linear' })
    expectMatches(
      r,
      [
        [0, 0.0, 0.000264525914336959],
        [1, 3.90625, 0.0006788533202097077],
        [31, 121.09375, 0.09040464940195808],
        [32, 125.0, 0.09880157245333676],
        [100, 390.625, 0.0009172452024571944],
        [128, 500.0, 0.0013754260730342532],
      ],
      129,
      1e-9,
    )
    expect(r.nSegments).toBe(6) // ⌊(1000 − 50)/150⌋
  })

  it('奇數 nperseg=101：two-sided（fftfreq 順序）與 one-sided', () => {
    const r2 = welch(X, FS, { nperseg: 101, onesided: false })
    expectMatches(
      r2,
      [
        [0, 0.0, 8.9474133001815e-5],
        [1, 9.900990099009901, 0.0003782605231851618],
        [12, 118.8118811881188, 0.02818695827035574],
        [50, 495.049504950495, 0.0006484235884431736],
        [51, -495.049504950495, 0.0006484235884431736],
        [100, -9.900990099009901, 0.0003782605231851618],
      ],
      101,
    )
    const r1 = welch(X, FS, { nperseg: 101 })
    expectMatches(
      r1,
      [
        [0, 0.0, 8.9474133001815e-5],
        [1, 9.900990099009901, 0.0007565210463703236],
        [12, 118.8118811881188, 0.05637391654071148],
        [50, 495.049504950495, 0.0012968471768863472], // 奇數 nfft：最後一 bin 不是 Nyquist，要加倍
      ],
      51,
    )
  })

  it('奇數個 segment（5 段：成對 FFT + 單段 FFT 混用）、detrend=false', () => {
    const r = welch(X, FS, { nperseg: 300, noverlap: 150, detrend: false })
    expect(r.nSegments).toBe(5)
    expect(r.detrend).toBe('none')
    expectMatches(
      r,
      [
        [0, 0.0, 0.021630344948814956], // 未去平均：DC bin 含 0.3 的 DC
        [1, 3.3333333333333335, 0.010253741474247166],
        [37, 123.33333333333334, 0.22486328609228562],
        [100, 333.33333333333337, 0.0007757021770836064],
        [150, 500.0, 0.0014398546772588325],
      ],
      151,
    )
  })

  it("scaling='spectrum'（x²）", () => {
    const r = welch(X, FS, { nperseg: 128, scaling: 'spectrum' })
    expect(r.units).toBe('x^2')
    expectMatches(
      r,
      [
        [0, 0.0, 0.0016554873722470092],
        [16, 125.0, 1.0523930231561043],
        [64, 500.0, 0.00945906130262209],
      ],
      65,
    )
  })

  it('訊號比 nperseg 短：同 SciPy 改用 nperseg = N', () => {
    const r = welch(X.subarray(0, 100), FS)
    expect(r.nperseg).toBe(100)
    expect(r.noverlap).toBe(50)
    expect(r.warnings.length).toBe(1)
    expectMatches(
      r,
      [
        [0, 0, 4.085320252676833e-6],
        [5, 50, 0.0006817569354590232],
        [50, 500, 6.602402222594937e-5],
      ],
      51,
    )
  })

  it('參數檢查', () => {
    expect(() => welch(X, FS, { nperseg: 64, noverlap: 64 })).toThrow()
    expect(() => welch(X, FS, { nperseg: 64, nfft: 32 })).toThrow()
    expect(() => welch(X, 0)).toThrow()
    expect(() => welch([], FS)).toThrow()
    expect(() => welch(X, FS, { window: [1, 1, 1], nperseg: 4 })).toThrow()
  })

  it('自訂 window 陣列等同同名 window', () => {
    const a = welch(X, FS, { nperseg: 128 })
    const w = new Float64Array(128)
    for (let i = 0; i < 128; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 128)
    const b = welch(X, FS, { window: w })
    expect(b.window).toBe('custom')
    for (let k = 0; k < a.psd.length; k++) expect(relErr(b.psd[k], a.psd[k], 1e-20)).toBeLessThan(1e-12)
  })
})

describe('功率守恆（Parseval）', () => {
  // 零均值白雜訊（均勻分佈，先手動去平均）
  const N = 1 << 14
  const u = lcg(N, 2024)
  let m = 0
  for (let i = 0; i < N; i++) m += u[i]
  m /= N
  const w = new Float64Array(N)
  let variance = 0
  for (let i = 0; i < N; i++) {
    w[i] = u[i] - m
    variance += w[i] * w[i]
  }
  variance /= N // ddof = 0
  const fs = 2e6

  it('periodogram（矩形窗）：Σ P[k]·Δf = 變異數（精確恆等式）', () => {
    const r = periodogram(w, fs)
    let s = 0
    for (let k = 0; k < r.psd.length; k++) s += r.psd[k] * r.df
    expect(relErr(s, variance)).toBeLessThan(1e-12)
  })

  it('periodogram：integratePsd(0, fs/2) ≈ 變異數（梯形法只差兩端半個 bin）', () => {
    const r = periodogram(w, fs)
    const p = integratePsd(r.f, r.psd, 0, fs / 2)
    expect(relErr(p, variance)).toBeLessThan(2e-3)
  })

  it('two-sided 總功率 = one-sided 總功率', () => {
    const r1 = periodogram(w, fs, { window: 'hann' })
    const r2 = periodogram(w, fs, { window: 'hann', onesided: false })
    let s1 = 0
    let s2 = 0
    for (let k = 0; k < r1.psd.length; k++) s1 += r1.psd[k]
    for (let k = 0; k < r2.psd.length; k++) s2 += r2.psd[k]
    expect(relErr(s1, s2)).toBeLessThan(1e-12)
  })

  it('Welch（Hann、nperseg=1024）：∫ PSD df ≈ 變異數（統計誤差 < 3%）', () => {
    const r = welch(w, fs, { nperseg: 1024 })
    const p = integratePsd(r.f, r.psd, 0, fs / 2)
    expect(relErr(p, variance)).toBeLessThan(0.03)
    // 均勻分佈 U(−0.5, 0.5) 的理論變異數 1/12，白雜訊 one-sided 密度 = 2σ²/fs
    expect(relErr(variance, 1 / 12)).toBeLessThan(0.03)
  })

  it('Welch 對 tone：在主瓣附近積分 ≈ A²/2', () => {
    const fsT = 1e6
    const A = 0.7
    const f0 = 123456.7
    const n = 1 << 15
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = A * Math.cos((2 * Math.PI * f0 * i) / fsT + 0.4)
    const r = welch(x, fsT, { nperseg: 4096, window: 'blackmanHarris' })
    const p = integratePsd(r.f, r.psd, f0 - 10 * r.df, f0 + 10 * r.df)
    expect(relErr(p, (A * A) / 2)).toBeLessThan(1e-3)
  })
})

describe('integratePsd', () => {
  const f = Float64Array.from({ length: 11 }, (_, i) => i)
  const p = Float64Array.from(f, (v) => 2 * v + 1)

  it('線性 PSD：梯形法 + 邊界內插為精確值', () => {
    // ∫_{2.5}^{7.25} (2f + 1) df = [f² + f] = 59.8125 − 8.75 = 51.0625
    expect(integratePsd(f, p, 2.5, 7.25)).toBeCloseTo(51.0625, 12)
    // 端點恰在格點
    expect(integratePsd(f, p, 0, 10)).toBeCloseTo(110, 12)
    // 同一個區間內
    expect(integratePsd(f, p, 3.2, 3.7)).toBeCloseTo(3.7 ** 2 + 3.7 - (3.2 ** 2 + 3.2), 12)
  })

  it('超出範圍時夾到 [f0, fN]；空區間回傳 0', () => {
    expect(integratePsd(f, p, -5, 100)).toBeCloseTo(110, 12)
    expect(integratePsd(f, p, 5, 5)).toBe(0)
    expect(integratePsd(f, p, 7, 3)).toBe(0)
    expect(integratePsd(f, p, 20, 30)).toBe(0)
  })
})

describe('toneFit（coherent least-squares tone 量測）', () => {
  it('無雜訊、non-coherent 頻率：精確還原振幅、相位、DC', () => {
    const fs = 1e6
    const f0 = 12345.678
    const A = 0.37
    const phi = -2.1
    const n = 3000
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = 0.05 + A * Math.cos((2 * Math.PI * f0 * i) / fs + phi)
    const r = toneFit(x, fs, f0)
    expect(r.amplitudePeak).toBeCloseTo(A, 12)
    expect(r.amplitudeRms).toBeCloseTo(A / Math.SQRT2, 12)
    expect(r.phase).toBeCloseTo(phi, 11)
    expect(r.dc).toBeCloseTo(0.05, 12)
    expect(r.rmsResidual).toBeLessThan(1e-12)
    expect(r.droppedColumns).toBe(0)
  })

  it('vs numpy.linalg.lstsq（testSignal，f0 = 123.4 Hz）', () => {
    const r = toneFit(X, FS, 123.4)
    expect(r.dc).toBeCloseTo(0.31444783683912275, 11)
    expect(r.a).toBeCloseTo(0.05938805844412846, 11)
    expect(r.b).toBeCloseTo(1.4868485114423444, 11)
    expect(r.amplitudePeak).toBeCloseTo(1.4880340847790008, 11)
    expect(r.phase).toBeCloseTo(-1.5308753086398224, 11)
    expect(r.rmsResidual).toBeCloseTo(0.5701780970809701, 11)
  })

  it('toneFitMulti vs numpy.linalg.lstsq（123.4 Hz 與 250 Hz）', () => {
    const r = toneFitMulti(X, FS, [123.4, 250])
    const ref = [0.3144477972454826, 0.059511294020777476, 1.4867649337388347, -0.022178472535282955, -0.03782252405429137]
    expect(r.dc).toBeCloseTo(ref[0], 11)
    expect(r.tones[0].a).toBeCloseTo(ref[1], 11)
    expect(r.tones[0].b).toBeCloseTo(ref[2], 11)
    expect(r.tones[1].a).toBeCloseTo(ref[3], 11)
    expect(r.tones[1].b).toBeCloseTo(ref[4], 11)
    expect(r.rmsResidual).toBeCloseTo(0.5693345760473145, 11)
  })

  it('f0 = fs/2：sin 欄全為 0，被捨棄而不是產生 NaN', () => {
    const n = 64
    const x = Float64Array.from({ length: n }, (_, i) => 0.2 + 0.5 * (i % 2 === 0 ? 1 : -1))
    const r = toneFit(x, 1, 0.5)
    expect(r.droppedColumns).toBe(1)
    expect(r.amplitudePeak).toBeCloseTo(0.5, 12)
    expect(r.dc).toBeCloseTo(0.2, 12)
    expect(Number.isFinite(r.phase)).toBe(true)
  })

  it('includeDc = false', () => {
    const n = 500
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 0.01 * i))
    const r = toneFit(x, 1, 0.01, { includeDc: false })
    expect(r.dc).toBe(0)
    expect(r.amplitudePeak).toBeCloseTo(1, 12)
    expect(r.phase).toBeCloseTo(-Math.PI / 2, 12) // sin(θ) = cos(θ − π/2)
  })
})

describe('findTones（近似 spur 偵測）', () => {
  it('兩個 tone（0 dB 與 −40 dB）在白雜訊中：頻率與功率', () => {
    const fs = 1e6
    const n = 1 << 16
    const u = lcg(n, 31)
    const A1 = 1
    const A2 = 0.01
    const f1 = 123456.7
    const f2 = 200000.3
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] =
        A1 * Math.cos((2 * Math.PI * f1 * i) / fs) + A2 * Math.cos((2 * Math.PI * f2 * i) / fs + 0.3) + 0.02 * (u[i] - 0.5)
    }
    const r = welch(x, fs, { nperseg: 4096, window: 'blackmanHarris' })
    const tones = findTones(r.f, r.psd, { minProminenceDb: 20, maxTones: 5 })
    expect(tones.length).toBe(2)
    const [t1, t2] = tones
    expect(Math.abs(t1.fCentroid - f1)).toBeLessThan(r.df / 2)
    expect(Math.abs(t2.fCentroid - f2)).toBeLessThan(r.df / 2)
    expect(Math.abs(t1.f - f1)).toBeLessThanOrEqual(r.df)
    expect(relErr(t1.power, (A1 * A1) / 2)).toBeLessThan(0.01)
    expect(relErr(t2.power, (A2 * A2) / 2)).toBeLessThan(0.02)
    // 相對 dBc：20 log10(A2/A1) = −40 dB
    expect(t2.powerDb - t1.powerDb).toBeCloseTo(-40, 1)
    expect(t1.lobe[1] - t1.lobe[0]).toBeLessThanOrEqual(8)
  })

  it('maxTones 與 fMin/fMax 篩選', () => {
    const f = Float64Array.from({ length: 20 }, (_, i) => i)
    const p = new Float64Array(20).fill(1e-6)
    p[5] = 1
    p[12] = 0.1
    const all = findTones(f, p, { minProminenceDb: 10 })
    expect(all.map((t) => t.index)).toEqual([5, 12])
    expect(findTones(f, p, { maxTones: 1 }).map((t) => t.index)).toEqual([5])
    expect(findTones(f, p, { fMin: 8 }).map((t) => t.index)).toEqual([12])
    expect(all[0].prominenceDb).toBeCloseTo(60, 10)
    // 主瓣 = bin 4…6（兩側 1e-6 之後不再下降），Δf = 1
    expect(all[0].lobe).toEqual([4, 6])
    expect(all[0].power).toBeCloseTo(1.000002, 12)
  })
})

describe('psdToDbcHz：ℒ(f) = 10 log10(S_φ^(1)/2)', () => {
  it('純量與陣列', () => {
    expect(psdToDbcHz(2e-10)).toBeCloseTo(-100, 12)
    const out = psdToDbcHz([2e-12, 2, 0])
    expect(out[0]).toBeCloseTo(-120, 12)
    expect(out[1]).toBeCloseTo(0, 12)
    expect(out[2]).toBe(-Infinity)
  })

  it('規格 §12.4 例：0.5 fs peak timing tone @ 13 GHz → 單邊 spur 20log10(β/2) ≈ −93.8 dBc', () => {
    // β = 2π·13 GHz·0.5 fs = 4.084070449666732e-5 rad；numpy：20 log10(β/2) = −93.7987354132602
    const beta = 2 * Math.PI * 13e9 * 0.5e-15
    const fs = 1.024e6
    const n = 1024
    const phi = Float64Array.from({ length: n }, (_, i) => beta * Math.cos((2 * Math.PI * 100e3 * i) / fs))
    const r = periodogram(phi, fs) // coherent：100 kHz 恰為 bin 100
    const tonePower = r.psd[100] * r.df // one-sided 相位功率 = β²/2 [rad²]
    expect(relErr(tonePower, (beta * beta) / 2)).toBeLessThan(1e-10)
    // 同樣的 /2（one-sided → 單邊 SSB）換算套用到積分後的 tone 功率即得 dBc
    expect(psdToDbcHz(tonePower)).toBeCloseTo(-93.7987354132602, 8)
  })
})

describe('dtftPsdToOnesided（validation.md E28）', () => {
  it('白雜訊：DTFT PSD = σ² → one-sided 2σ²/fs，與 Welch 平均位準一致', () => {
    const fs = 4e9
    expect(dtftPsdToOnesided(3, fs)).toBe(6 / fs)
    expect(Array.from(dtftPsdToOnesided([1, 2], 2))).toEqual([1, 2])
    // U(−0.5, 0.5)：σ² = 1/12
    const n = 1 << 16
    const u = lcg(n, 77)
    const r = welch(u, fs, { nperseg: 512 })
    let mean = 0
    for (let k = 1; k < r.psd.length - 1; k++) mean += r.psd[k]
    mean /= r.psd.length - 2
    expect(relErr(mean, dtftPsdToOnesided(1 / 12, fs))).toBeLessThan(0.02)
  })
})
