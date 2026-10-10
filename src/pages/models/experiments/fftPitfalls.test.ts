import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { getWindow } from '@/simulation/signal'
import {
  DEFAULT_FFT_PARAMS,
  FFT_DEMO_FS,
  dbPowerSum,
  fitToleranceDb,
  lobeNoiseDbc,
  noiseFloorPerBinDbc,
  rectLeakageApproxDb,
  rectLeakageDb,
  runFftPitfalls,
  scallopLossDb,
  tonePeakDensityDbcHz,
  welchLobeBins,
  whiteNoiseDensityDbcHz,
  type FftPitfallParams,
} from './fftPitfalls'

const dir = resolve(process.cwd(), 'src/data/presets')
const PRESETS: PresetEntry[] = readdirSync(dir)
  .filter((f) => f.startsWith('fft-spur-pitfalls') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PresetEntry)
const run = (id: string) => {
  const pr = PRESETS.find((x) => x.id === id)!
  const p = { ...DEFAULT_FFT_PARAMS, ...(pr.params as Partial<FftPitfallParams>) }
  return { p, r: runFftPitfalls(p) }
}

describe('§15.5 FFT 量測陷阱（fftPitfalls）', () => {
  it('scalloping：δ = ½ bin 時矩形窗 −3.92 dB（= 20log₁₀(2/π)）、Hann −1.42 dB；δ = 0 時為 0', () => {
    const N = 4096
    expect(scallopLossDb(getWindow('rectangular', N), 0.5)).toBeCloseTo(20 * Math.log10(2 / Math.PI), 3)
    expect(scallopLossDb(getWindow('hann', N), 0.5)).toBeCloseTo(-1.4236, 3)
    expect(scallopLossDb(getWindow('blackmanHarris', N), 0)).toBeCloseTo(0, 12)
  })

  it('預設（矩形窗、非相干）：載波讀值 = 解析 scalloping；載波洩漏高於真實 spur，發出解釋性警告', () => {
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    expect(Math.abs(r.carrierMeasDb - r.scallopDb)).toBeLessThan(0.05)
    expect(r.leakAtSpurDbc).toBeGreaterThan(DEFAULT_FFT_PARAMS.spurDbc + 20)
    expect(Math.abs(r.spurFftDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeGreaterThan(20) // FFT 讀值完全錯
    expect(r.warnings.some((w) => w.startsWith('載波洩漏遮蔽 spur'))).toBe(true)
    expect(r.warnings.some((w) => w.startsWith('非相干取樣的 scalloping'))).toBe(true)
    // coherent tone fit 不受洩漏影響
    expect(Math.abs(r.spurFitDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeLessThan(fitToleranceDb(r))
  })

  it('§8.1 的手算：矩形窗洩漏 |W(ν)|/N ≈ |sin πδ|/(π|ν|)，預設設定（δ = ½、最近 bin 在 39.5）與實際計算差 < 0.5 dB', () => {
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    const nu = DEFAULT_FFT_PARAMS.spurOffsetBins - 0.5
    const approx = 20 * Math.log10(1 / (Math.PI * nu))
    expect(Math.abs(r.leakAtSpurDbc - approx)).toBeLessThan(0.5)
    // 等比級數的精確式：|W(ν)| = |sin πν| / |sin(πν/N)|
    const N = r.N
    const exact = 20 * Math.log10(Math.abs(Math.sin(Math.PI * nu)) / (N * Math.abs(Math.sin((Math.PI * nu) / N))))
    expect(Math.abs(exact - approx)).toBeLessThan(0.01)
    expect(Math.abs(scallopLossDb(getWindow('rectangular', N), nu) - exact)).toBeLessThan(1e-6)
  })

  it('coherent sampling（δ = 0）矩形窗：沒有洩漏，(A)(C) 在 1 dB 內；雜訊底中位數 = 平均 × ln2；(B) 被主瓣內的雜訊墊高並有警告說明', () => {
    const r = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0 })
    expect(r.leakAtSpurDbc).toBeLessThan(-200)
    expect(r.welchLobeLeakDbc).toBeLessThan(-200)
    expect(Math.abs(r.spurFftDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeLessThan(1)
    expect(Math.abs(r.spurFitDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeLessThan(fitToleranceDb(r))
    expect(Math.abs(r.floorMedianDbc + 10 * Math.log10(1 / Math.LN2) - r.noiseFloorDbc)).toBeLessThan(0.6)
    // (B)：矩形窗積分 5 個 Welch bin，白雜訊的期望值 −60 + 10log₁₀(2·5/512) = −77.09 dBc，比 spur 還高
    expect(r.welchLobeNoiseDbc).toBeCloseTo(DEFAULT_FFT_PARAMS.noiseDbc + 10 * Math.log10((2 * 5) / 512), 9)
    const predicted = 10 * Math.log10(10 ** (DEFAULT_FFT_PARAMS.spurDbc / 10) + 10 ** (r.welchLobeNoiseDbc / 10))
    expect(Math.abs(r.spurWelchDbc - predicted)).toBeLessThan(1.5) // spur + 雜訊的功率和（7 個 segment 平均的統計誤差內）
    expect(r.spurWelchDbc - DEFAULT_FFT_PARAMS.spurDbc).toBeGreaterThan(3)
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0].startsWith('Welch 主瓣積分被雜訊墊高')).toBe(true)
    // 把雜訊降 30 dB：(B) 回到 1 dB 內，警告消失
    const quiet = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0, noiseDbc: -90 })
    expect(Math.abs(quiet.spurWelchDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeLessThan(1)
    expect(quiet.warnings).toEqual([])
  })

  it('反面：非相干 + 矩形窗時，Welch 的主瓣積分量到的是載波洩漏（只有載波就有約 −30 dBc），有警告說明', () => {
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    expect(r.welchLobeLeakDbc).toBeGreaterThan(DEFAULT_FFT_PARAMS.spurDbc + 30)
    expect(Math.abs(r.spurWelchDbc - r.welchLobeLeakDbc)).toBeLessThan(1) // (B) 的讀值幾乎全是洩漏
    expect(r.warnings.some((w) => w.startsWith('Welch 主瓣積分量到載波洩漏'))).toBe(true)
  })

  it('Blackman-Harris 非相干：洩漏遠低於 spur，FFT 讀值在 3 dB 內', () => {
    const r = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, window: 'blackmanHarris' })
    expect(r.leakAtSpurDbc).toBeLessThan(DEFAULT_FFT_PARAMS.spurDbc - 20)
    expect(Math.abs(r.spurFftDbc - DEFAULT_FFT_PARAMS.spurDbc)).toBeLessThan(3)
    expect(r.warnings.some((w) => w.startsWith('載波洩漏'))).toBe(false)
  })

  it('反面：短紀錄 spur 埋進雜訊底、Welch segment 太短，都有解釋原因的警告', () => {
    const short = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, log2N: 8, spurOffsetBins: 10, window: 'blackmanHarris', welchLog2Seg: 8, noiseDbc: -50 })
    expect(short.noiseFloorDbc).toBeGreaterThan(DEFAULT_FFT_PARAMS.spurDbc)
    expect(short.warnings.some((w) => w.startsWith('Spur 埋在雜訊底下'))).toBe(true)
    const welch = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, window: 'blackmanHarris', welchLog2Seg: 6 })
    expect(welch.warnings.some((w) => w.startsWith('Welch segment 太短'))).toBe(true)
    expect(welch.spurWelchDbc).toBeGreaterThan(DEFAULT_FFT_PARAMS.spurDbc + 20)
  })

  it('同一個 tone 換 Welch segment，峰值 PSD（dBc/Hz）隨 RBW 改變約 10log₁₀(RBW 比)', () => {
    const a = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0, window: 'hann', welchLog2Seg: 10, noiseDbc: -140 })
    const b = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0, window: 'hann', welchLog2Seg: 11, noiseDbc: -140 })
    const expected = 10 * Math.log10(a.welchEnbwHz / b.welchEnbwHz)
    expect(Math.abs(b.spurWelchPeakDbcHz - a.spurWelchPeakDbcHz - expected)).toBeLessThan(0.5)
  })

  it('core:fftHandFormulas（手算題與實驗共用）：每一個函式都和「直接由視窗／訊號算」的結果一致', () => {
    // 每 bin 雜訊底 = 2σ²Σw²/(Σw)² ÷ P₁（三種視窗，直接用視窗係數求和）
    for (const name of ['rectangular', 'hann', 'blackmanHarris'] as const) {
      const N = 1024
      const w = getWindow(name, N)
      let s1 = 0
      let s2 = 0
      for (let i = 0; i < N; i++) {
        s1 += w[i]
        s2 += w[i] * w[i]
      }
      const sigma2 = 0.5 * 10 ** (-60 / 10) // P₁ = ½
      const direct = 10 * Math.log10((2 * sigma2 * s2) / (s1 * s1) / 0.5)
      expect(noiseFloorPerBinDbc(-60, N, (N * s2) / (s1 * s1))).toBeCloseTo(direct, 9)
    }
    // 矩形窗洩漏：精確式 = 視窗 DTFT 的直接求和；近似式在 ν ≪ N 時相同，ν = N/8 時差 0.22 dB
    for (const [nu, N] of [[39.5, 4096], [0.5, 256], [19.25, 1024], [32, 256.0]] as const) {
      const exact = scallopLossDb(getWindow('rectangular', N), nu)
      if (Number.isFinite(exact) && exact > -200) expect(rectLeakageDb(nu, N)).toBeCloseTo(exact, 6)
    }
    expect(rectLeakageApproxDb(39.5)).toBeCloseTo(20 * Math.log10(1 / (Math.PI * 39.5)), 12)
    expect(Math.abs(rectLeakageApproxDb(39.5) - rectLeakageDb(39.5, 4096))).toBeLessThan(0.01)
    expect(Math.abs(rectLeakageApproxDb(32.5) - rectLeakageDb(32.5, 256))).toBeGreaterThan(0.2)
    expect(Math.abs(rectLeakageApproxDb(32.5) - rectLeakageDb(32.5, 256))).toBeLessThan(0.25)
    expect(rectLeakageDb(7, 256)).toBeLessThan(-250) // coherent：整數 bin 是零點
    // Welch 主瓣：bin 數、白雜訊期望功率、功率和、tone 的峰值密度、白雜訊密度
    expect([welchLobeBins('rectangular'), welchLobeBins('hann'), welchLobeBins('blackmanHarris')]).toEqual([5, 7, 11])
    expect(lobeNoiseDbc(-60, 5, 512)).toBeCloseTo(-60 + 10 * Math.log10(10 / 512), 12)
    expect(dbPowerSum(-80, -80)).toBeCloseTo(-80 + 10 * Math.log10(2), 12)
    expect(dbPowerSum(-80, -200)).toBeCloseTo(-80, 9)
    expect(dbPowerSum(-80, lobeNoiseDbc(-60, 5, 512)).toFixed(2)).toBe('-75.30')
    expect(tonePeakDensityDbcHz(-80, 195312.5)).toBeCloseTo(-80 - 10 * Math.log10(195312.5), 12)
    expect(whiteNoiseDensityDbcHz(-60, FFT_DEMO_FS)).toBeCloseTo(-60 + 10 * Math.log10(2 / 1e8), 12)
    // 白雜訊密度 × f_s/2 = 總功率（積分回去）
    expect(whiteNoiseDensityDbcHz(-60, FFT_DEMO_FS) + 10 * Math.log10(FFT_DEMO_FS / 2)).toBeCloseTo(-60, 9)
    // 實驗的解析欄位就是用同一組函式
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    expect(r.noiseFloorDbc).toBe(noiseFloorPerBinDbc(DEFAULT_FFT_PARAMS.noiseDbc, r.N, r.enbwBins))
    expect(r.welchLobeNoiseDbc).toBe(lobeNoiseDbc(DEFAULT_FFT_PARAMS.noiseDbc, welchLobeBins('rectangular'), 2 ** DEFAULT_FFT_PARAMS.welchLog2Seg))
  })

  it('參數不合法時丟出中文錯誤', () => {
    expect(() => runFftPitfalls({ ...DEFAULT_FFT_PARAMS, log2N: 7 })).toThrow(/log_2N/)
    expect(() => runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0.7 })).toThrow(/delta/)
    expect(() => runFftPitfalls({ ...DEFAULT_FFT_PARAMS, spurOffsetBins: 2 })).toThrow(/spur 距離/)
  })

  it('preset 檔的預期敘述與計算結果一致', () => {
    expect(PRESETS.length).toBe(5)
    for (const pr of PRESETS) {
      expect(pr.experiment).toBe('fft-spur-pitfalls')
      expect(pr.page).toBe('/models')
    }
    const a = run('fft-spur-pitfalls-noncoherent-rect').r
    expect(a.warnings.some((w) => w.startsWith('載波洩漏遮蔽 spur'))).toBe(true)
    expect(a.leakAtSpurDbc).toBeCloseTo(-41.6, 0)
    const b = run('fft-spur-pitfalls-coherent-rect').r
    expect(b.warnings.length).toBe(1)
    expect(b.warnings[0].startsWith('Welch 主瓣積分被雜訊墊高')).toBe(true)
    expect(b.leakAtSpurDbc).toBeLessThan(-200)
    const c = run('fft-spur-pitfalls-noncoherent-bh').r
    expect(c.leakAtSpurDbc).toBeLessThan(-115)
    expect(c.scallopDb).toBeCloseTo(-0.83, 1)
    const d = run('fft-spur-pitfalls-short-record').r
    expect(d.warnings.some((w) => w.startsWith('Spur 埋在雜訊底下'))).toBe(true)
    expect(Number.isNaN(fitToleranceDb(d))).toBe(true)
    const e = run('fft-spur-pitfalls-short-welch').r
    expect(e.warnings.some((w) => w.startsWith('Welch segment 太短'))).toBe(true)
    expect(Math.abs(e.spurWelchDbc)).toBeLessThan(1)
  })
})
