/**
 * 規格 §15.5「一條 FFT 曲線不能證明有 Spur」的示範計算（本頁私有；純函式、無 React）。
 *
 * 訊號（示意，SourceTag 'illustrative'）：
 *   x[n] = A₁cos(2πf₁n/f_s) + A₂cos(2πf₂n/f_s + φ₂) + v[n]，v ~ N(0, σ²) iid
 *   f₁ = (k₁ + δ)·f_s/N（δ = 非相干偏移，單位 bin），f₂ = f₁ + Δ·f_s/N
 *   A₁ = 1（載波功率 P₁ = ½），A₂ = 10^{spur_dBc/20}，σ² = P₁·10^{noise_dBc/10}（雜訊總功率相對載波）
 *
 * 三種量測（§15.5 建議同時提供）：
 *   (A) Whole-record FFT：periodogram，scaling = 'spectrum'（one-sided）：bin 中心的 tone 讀到 A²/2
 *   (B) Welch PSD：scaling = 'density'（x²/Hz）；tone 功率 = Σ_lobe PSD·Δf；峰值 PSD = P/ENBW_Hz（依 RBW 而變）
 *   (C) Coherent tone fit：已知 f₁、f₂ 的最小平方擬合 → peak amplitude（不受 window leakage 影響）
 */
import { createRng } from '@/simulation/core'
import { getWindow, periodogram, toneFitMulti, welch, windowStats, type WindowName } from '@/simulation/signal'

/** 示意取樣率（例如 f_ref = 100 MHz 的 DTC 時間誤差序列） */
export const FFT_DEMO_FS = 100e6

export interface FftPitfallParams {
  /** 紀錄長度 N = 2^log2N（8…16） */
  log2N: number
  /** 非相干偏移 δ（bin，0 = coherent）；0 ≤ δ ≤ 0.5 */
  offsetBins: number
  /** spur 與載波的距離 Δ（整數 bin，≥ 3） */
  spurOffsetBins: number
  /** 真實 spur 位準 [dBc]（相對載波功率） */
  spurDbc: number
  /** 雜訊總功率相對載波 [dB] */
  noiseDbc: number
  window: WindowName
  /** Welch segment 長度 2^log2Seg（≤ N） */
  welchLog2Seg: number
  seed: number
}

export const DEFAULT_FFT_PARAMS: FftPitfallParams = {
  log2N: 12,
  offsetBins: 0.5,
  spurOffsetBins: 40,
  spurDbc: -80,
  noiseDbc: -60,
  window: 'rectangular',
  welchLog2Seg: 9,
  seed: 20261010,
}

export interface FftPitfallResult {
  N: number
  fs: number
  f1: number
  f2: number
  k1: number
  /** 理論 spur（dBc） */
  spurTrueDbc: number
  /** 頻率軸（bin 單位 f·N/f_s）與 periodogram（dBc per bin，相對理論載波功率 P₁） */
  binAxis: Float64Array
  specDbc: Float64Array
  /** 只有載波（無 spur、無雜訊）時的 periodogram（dBc per bin）：洩漏底 */
  leakDbc: Float64Array
  /** (A) whole-record：載波 bin 的量測（相對 P₁，dB）與解析 scalloping */
  carrierMeasDb: number
  scallopDb: number
  /** (A) spur 位置 ±1 bin 的最大值（dBc，相對量到的載波） */
  spurFftDbc: number
  /** 只有載波時，spur 位置 ±1 bin 的洩漏（dBc） */
  leakAtSpurDbc: number
  /** 每 bin 雜訊底的解析值 2σ²Σw²/(Σw)²（dBc per bin） */
  noiseFloorDbc: number
  /** periodogram 在遠離兩個 tone 處的中位數（dBc per bin，含 leakage） */
  floorMedianDbc: number
  /** 排除載波與 spur 主瓣後最高的峰（dBc 與 bin） */
  falsePeakDbc: number
  falsePeakBin: number
  /** (B) Welch：spur 主瓣積分功率（dBc）、spur 峰值 PSD（dBc/Hz）、RBW = ENBW_Hz */
  spurWelchDbc: number
  spurWelchPeakDbcHz: number
  welchEnbwHz: number
  welchSegments: number
  /** (B) 主瓣積分範圍內「只有白雜訊」的期望功率 2σ²·n_bins/nperseg（dBc） */
  welchLobeNoiseDbc: number
  /** (B) 同一個積分範圍內「只有載波」（無 spur、無雜訊）的 Welch 功率（dBc）：載波裙邊／洩漏 */
  welchLobeLeakDbc: number
  /** (C) coherent tone fit：A₂/A₁（dBc） */
  spurFitDbc: number
  carrierFitAmp: number
  /** coherent fit 的 A₂ 相對標準差 σ√(2/N)/A₂（最小平方估計，白雜訊） */
  fitRelStd: number
  enbwBins: number
  warnings: string[]
}

/** 視窗在分數 bin 偏移 δ 的增益 |W(δ)|²/(Σw)²（dB）：scalloping loss（精確） */
export function scallopLossDb(win: Float64Array, delta: number): number {
  const N = win.length
  let re = 0
  let im = 0
  let s = 0
  for (let n = 0; n < N; n++) {
    const ph = (-2 * Math.PI * delta * n) / N
    re += win[n] * Math.cos(ph)
    im += win[n] * Math.sin(ph)
    s += win[n]
  }
  return 10 * Math.log10((re * re + im * im) / (s * s))
}

function db10(v: number): number {
  return 10 * Math.log10(Math.max(v, 1e-300))
}

function lobeHalf(window: WindowName): number {
  return window === 'blackmanHarris' ? 4 : window === 'hann' ? 2 : 1
}

// #region core:fftHandFormulas
/** 每 bin 雜訊底（dBc per bin，one-sided、scaling = 'spectrum'）：P_noise − 10·log₁₀(N / (2·ENBW_bins))（F-15.11） */
export function noiseFloorPerBinDbc(noiseDbc: number, N: number, enbwBins: number): number {
  return noiseDbc - 10 * Math.log10(N / (2 * enbwBins))
}

/** 矩形窗在「離 tone ν 個 bin」處的洩漏 |W(ν)|/N（dB，等比級數的精確式）：|sin πν| / (N·|sin(πν/N)|) */
export function rectLeakageDb(nu: number, N: number): number {
  return 20 * Math.log10(Math.max(Math.abs(Math.sin(Math.PI * nu)) / (N * Math.abs(Math.sin((Math.PI * nu) / N))), 1e-300))
}

/** 同上，N ≫ ν 時的手算近似 |sin πν| / (π|ν|)（dB） */
export function rectLeakageApproxDb(nu: number): number {
  return 20 * Math.log10(Math.max(Math.abs(Math.sin(Math.PI * nu)) / (Math.PI * Math.abs(nu)), 1e-300))
}

/** (B) Welch 主瓣積分的 bin 數 2(L + 1) + 1（L = 視窗主瓣半寬：矩形 1、Hann 2、Blackman-Harris 4） */
export function welchLobeBins(window: WindowName): number {
  return 2 * (lobeHalf(window) + 1) + 1
}

/** 主瓣積分範圍內「只有白雜訊」的期望功率（dBc）：P_noise + 10·log₁₀(2·n_bins / n_seg) */
export function lobeNoiseDbc(noiseDbc: number, nBins: number, nseg: number): number {
  return noiseDbc + 10 * Math.log10((2 * nBins) / nseg)
}

/** 兩個不相關成分的功率和（輸入、輸出都是 dB）：10·log₁₀(10^{a/10} + 10^{b/10}) */
export function dbPowerSum(aDb: number, bDb: number): number {
  return 10 * Math.log10(10 ** (aDb / 10) + 10 ** (bDb / 10))
}

/** tone 落在 bin 中心時，density PSD 的峰值（dBc/Hz）= P_tone − 10·log₁₀(ENBW_Hz)：讀值隨 RBW 改變 */
export function tonePeakDensityDbcHz(toneDbc: number, enbwHz: number): number {
  return toneDbc - 10 * Math.log10(enbwHz)
}

/** one-sided 白雜訊密度（dBc/Hz）= P_noise + 10·log₁₀(2 / f_s) */
export function whiteNoiseDensityDbcHz(noiseDbc: number, fs: number): number {
  return noiseDbc + 10 * Math.log10(2 / fs)
}
// #endregion

export function runFftPitfalls(p: FftPitfallParams): FftPitfallResult {
  if (!Number.isInteger(p.log2N) || p.log2N < 8 || p.log2N > 16) throw new Error(`紀錄長度 $\\log_2N$ 必須為 $8\\ldots16$ 的整數，收到 ${p.log2N}`)
  if (!(p.offsetBins >= 0 && p.offsetBins <= 0.5)) throw new Error('非相干偏移 $\\delta$ 必須在 $[0,0.5]$ bin 之間')
  const N = 2 ** p.log2N
  const fs = FFT_DEMO_FS
  const k1 = Math.round(N / 8)
  const D = Math.round(p.spurOffsetBins)
  if (!(D >= 3) || k1 + D + 8 >= N / 2) throw new Error(`spur 距離 $\\Delta$ 必須 $\\ge3$ bin 且 $f_2<f_s/2$（目前 $N=${N}$ 時最大 ${Math.floor(N / 2 - k1 - 9)} bin）`)
  const f1 = ((k1 + p.offsetBins) * fs) / N
  const f2 = f1 + (D * fs) / N
  const A1 = 1
  const P1 = 0.5
  const A2 = 10 ** (p.spurDbc / 20)
  const sigma = Math.sqrt(P1 * 10 ** (p.noiseDbc / 10))
  const rng = createRng(p.seed).fork('fft-pitfalls-noise')
  const phi2 = 2 * Math.PI * createRng(p.seed).fork('fft-pitfalls-phase').uniform()
  const x = new Float64Array(N)
  const xc = new Float64Array(N)
  const w1 = (2 * Math.PI * f1) / fs
  const w2 = (2 * Math.PI * f2) / fs
  for (let n = 0; n < N; n++) {
    xc[n] = A1 * Math.cos(w1 * n)
    x[n] = xc[n] + A2 * Math.cos(w2 * n + phi2) + sigma * rng.normal()
  }
  const win = getWindow(p.window, N)
  const ws = windowStats(win)
  const per = periodogram(x, fs, { window: p.window, scaling: 'spectrum', detrend: 'none' })
  const perC = periodogram(xc, fs, { window: p.window, scaling: 'spectrum', detrend: 'none' })
  const nb = per.psd.length
  const binAxis = new Float64Array(nb)
  const specDbc = new Float64Array(nb)
  const leakDbc = new Float64Array(nb)
  for (let i = 0; i < nb; i++) {
    binAxis[i] = (per.f[i] * N) / fs
    specDbc[i] = db10(per.psd[i] / P1)
    leakDbc[i] = db10(perC.psd[i] / P1)
  }
  const maxIn = (arr: Float64Array, lo: number, hi: number): { v: number; i: number } => {
    let v = -Infinity
    let idx = lo
    for (let i = Math.max(0, lo); i <= Math.min(arr.length - 1, hi); i++) {
      if (arr[i] > v) {
        v = arr[i]
        idx = i
      }
    }
    return { v, i: idx }
  }
  const carrier = maxIn(per.psd, k1 - 1, k1 + 1)
  const k2 = Math.round((f2 * N) / fs)
  const spur = maxIn(per.psd, k2 - 1, k2 + 1)
  const leakSpur = maxIn(perC.psd, k2 - 1, k2 + 1)
  const L = lobeHalf(p.window) + 1
  // 排除 DC、載波與 spur 主瓣後的最高峰
  let fpV = -Infinity
  let fpI = -1
  const floorVals: number[] = []
  for (let i = 3; i < nb - 1; i++) {
    const nearCarrier = Math.abs(i - k1) <= L + 1
    const nearSpur = Math.abs(i - k2) <= L + 1
    if (nearCarrier || nearSpur) continue
    if (per.psd[i] > fpV) {
      fpV = per.psd[i]
      fpI = i
    }
    if (Math.abs(i - k1) > 8 * L && Math.abs(i - k2) > 8 * L) floorVals.push(per.psd[i])
  }
  floorVals.sort((a, b) => a - b)
  const floorMedian = floorVals.length ? floorVals[Math.floor(floorVals.length / 2)] : NaN
  // (B) Welch
  const nseg = 2 ** Math.min(p.welchLog2Seg, p.log2N)
  const wel = welch(x, fs, { window: p.window, nperseg: nseg, detrend: 'none' })
  const kw2 = Math.round(f2 / wel.df)
  const Lw = lobeHalf(p.window) + 1
  let pw = 0
  let peakPsd = 0
  // 只有載波的 Welch（決定性）：同一個積分範圍內有多少是載波的裙邊／洩漏
  const welC = welch(xc, fs, { window: p.window, nperseg: nseg, detrend: 'none' })
  let pwLeak = 0
  for (let i = Math.max(0, kw2 - Lw); i <= Math.min(wel.psd.length - 1, kw2 + Lw); i++) {
    pw += wel.psd[i] * wel.df
    pwLeak += welC.psd[i] * welC.df
    peakPsd = Math.max(peakPsd, wel.psd[i])
  }
  // (C) coherent tone fit
  const fit = toneFitMulti(x, fs, [f1, f2])
  const A1f = fit.tones[0].amplitudePeak
  const A2f = fit.tones[1].amplitudePeak
  const res: FftPitfallResult = {
    N,
    fs,
    f1,
    f2,
    k1,
    spurTrueDbc: p.spurDbc,
    binAxis,
    specDbc,
    leakDbc,
    carrierMeasDb: db10(carrier.v / P1),
    scallopDb: scallopLossDb(win, p.offsetBins),
    spurFftDbc: db10(spur.v / carrier.v),
    leakAtSpurDbc: db10(leakSpur.v / P1),
    // 2σ²Σw²/(Σw)² 除以 P₁，寫成 dB：P_noise − 10·log₁₀(N/(2·ENBW_bins))，ENBW_bins = NΣw²/(Σw)²
    noiseFloorDbc: noiseFloorPerBinDbc(p.noiseDbc, N, ws.enbwBins),
    floorMedianDbc: db10(floorMedian / P1),
    falsePeakDbc: db10(fpV / P1),
    falsePeakBin: fpI,
    spurWelchDbc: db10(pw / P1),
    spurWelchPeakDbcHz: db10(peakPsd / P1),
    welchEnbwHz: wel.enbwHz,
    welchSegments: wel.nSegments,
    // one-sided 白雜訊密度 2σ²/f_s，每個 Welch bin 寬 f_s/nperseg，積分 2L_w + 1 個 bin
    welchLobeNoiseDbc: lobeNoiseDbc(p.noiseDbc, 2 * Lw + 1, nseg),
    welchLobeLeakDbc: db10(pwLeak / P1),
    spurFitDbc: 20 * Math.log10(Math.max(A2f, 1e-300) / A1f),
    carrierFitAmp: A1f,
    fitRelStd: (sigma * Math.sqrt(2 / N)) / A2,
    enbwBins: ws.enbwBins,
    warnings: [],
  }
  res.warnings = fftWarnings(res, p)
  return res
}

/** coherent tone fit 的 3σ 容忍度（dB）：20log₁₀(1 + 3·σ√(2/N)/A₂)；3σ 相對誤差 ≥ 1 時回傳 NaN（量不到） */
export function fitToleranceDb(r: Pick<FftPitfallResult, 'fitRelStd'>): number {
  const k = 3 * r.fitRelStd
  return k >= 1 ? NaN : 20 * Math.log10(1 + k)
}

/** 解釋「為什麼這條 FFT 會騙人」的警告（每條都說明原因） */
export function fftWarnings(r: FftPitfallResult, p: FftPitfallParams): string[] {
  const out: string[] = []
  if (r.leakAtSpurDbc > r.spurTrueDbc - 3) {
    out.push(
      `載波洩漏遮蔽 spur：只有載波時，spur 位置的 ${p.window} 窗洩漏就有 ${r.leakAtSpurDbc.toFixed(1)} dBc，高於（或接近）真實 spur ${r.spurTrueDbc.toFixed(1)} dBc。` +
        '這條 FFT 量到的是 leakage，不是 spur；請改用 coherent sampling（$\\delta=0$）、Blackman-Harris 窗，或 coherent tone fit。',
    )
  }
  if (r.noiseFloorDbc > r.spurTrueDbc - 3) {
    out.push(
      `Spur 埋在雜訊底下：每 bin 雜訊底 ${r.noiseFloorDbc.toFixed(1)} dBc（等於雜訊總功率減去 processing gain $10\\log_{10}\\frac{N}{2\\,\\mathrm{ENBW_{bins}}}$）不低於 spur 的 ${r.spurTrueDbc.toFixed(1)} dBc。` +
        '短資料窗會把 tone 看成 noise；加長 $N$（每加倍約降 3 dB）或用已知頻率的 coherent tone fit。',
    )
  }
  if (r.falsePeakDbc > r.spurTrueDbc && r.falsePeakDbc > r.noiseFloorDbc + 10) {
    out.push(
      `出現假 spur：在 bin ${r.falsePeakBin}（不是 $f_2$）有 ${r.falsePeakDbc.toFixed(1)} dBc 的峰，比真實 spur 還高。` +
        '只看一條 FFT 會把 leakage／雜訊尖峰誤判為 spur；必須核對頻率是否等於預期的 spur 頻率並換窗驗證。',
    )
  }
  const segBins = (p.spurOffsetBins * 2 ** Math.min(p.welchLog2Seg, p.log2N)) / r.N
  const lobeBins = welchLobeBins(p.window)
  if (segBins < 2 * (lobeHalf(p.window) + 1)) {
    out.push(
      `Welch segment 太短：spur 與載波只差 ${segBins.toFixed(2)} 個 Welch bin（RBW 即 ENBW，為 ${(r.welchEnbwHz / 1e3).toFixed(1)} kHz），兩者主瓣重疊；` +
        '(B) 的主瓣積分其實量到載波的裙邊。加長 nperseg 或改用 whole-record / coherent tone fit。',
    )
  } else {
    if (r.welchLobeLeakDbc > r.spurTrueDbc - 6) {
      out.push(
        `Welch 主瓣積分量到載波洩漏：只有載波時，(B) 積分的 ${lobeBins} 個 Welch bin 裡就有 ${r.welchLobeLeakDbc.toFixed(1)} dBc（${p.window} 窗，每個 segment 內載波不是整數週期），` +
          `不比真實 spur ${r.spurTrueDbc.toFixed(1)} dBc 低多少，所以 (B) 讀到的主要是洩漏。改用低旁瓣的窗（Blackman-Harris）並加長 nperseg，或 coherent 取樣。`,
      )
    }
    if (r.welchLobeNoiseDbc > r.spurTrueDbc - 6) {
      out.push(
        `Welch 主瓣積分被雜訊墊高：(B) 把 spur 主瓣的 ${lobeBins} 個 Welch bin 加起來，其中光是白雜訊的期望值就有 ${r.welchLobeNoiseDbc.toFixed(1)} dBc` +
          `（$2\\sigma^2n_\\mathrm{bins}/n_\\mathrm{seg}$），和真實 spur ${r.spurTrueDbc.toFixed(1)} dBc 同一個量級，所以 (B) 會高估。` +
          '加長 nperseg（每加倍降 3 dB）讓 RBW 變窄，或改用已知頻率的 coherent tone fit。',
      )
    }
  }
  if (p.offsetBins > 0 && Math.abs(r.scallopDb) > 0.5) {
    out.push(
      `非相干取樣的 scalloping：載波落在 bin 之間（$\\delta=${p.offsetBins}$），峰值 bin 少讀 ${(-r.scallopDb).toFixed(2)} dB（${p.window} 窗）。` +
        '以峰值 bin 讀 dBc 會有系統誤差；coherent tone fit 不受影響。',
    )
  }
  return out
}
