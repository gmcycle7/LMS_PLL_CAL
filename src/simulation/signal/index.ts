/**
 * 訊號處理層（src/simulation/signal）：FFT、window、PSD、濾波器、互相關。
 * 純數值，不依賴 React/DOM，可在 Web Worker 執行。
 */
export { fft, ifft, nextPow2, isPow2, fftReal, fftfreq, rfftfreq, fftshift } from '@/simulation/signal/fft'
export { hann, rectangular, blackmanHarris, getWindow, windowStats, BLACKMAN_HARRIS_4 } from '@/simulation/signal/window'
export type { WindowName, WindowStats } from '@/simulation/signal/window'
export {
  periodogram,
  welch,
  toneFit,
  toneFitMulti,
  integratePsd,
  findTones,
  psdToDbcHz,
  dtftPsdToOnesided,
} from '@/simulation/signal/psd'
export type {
  Detrend,
  PsdScaling,
  PeriodogramOptions,
  WelchOptions,
  PsdResult,
  ToneFitComponent,
  ToneFitResult,
  ToneFitMultiResult,
  FindTonesOptions,
  DetectedTone,
} from '@/simulation/signal/psd'
export { lfilter, lfilterZi, StreamFilter, freqz, freqzHz, freqs, bilinear, impulseResponse } from '@/simulation/signal/filter'
export { xcorrAtLag, xcorr } from '@/simulation/signal/corr'
export type { XcorrNormalization, XcorrResult } from '@/simulation/signal/corr'
