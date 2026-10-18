# 基礎模組 API 與使用注意事項

> 實際程式碼為準；此文件幫助快速找到可用函式，以及使用時要注意的行為。目錄結構與一般約定見 `docs/dev-conventions.md`。各節依模組分成「Public API」（簽名清單）、「使用注意事項」與「設計決定與補充」（和 dev-conventions 概要簽名不同或補充之處）。

## src/simulation/core（@/simulation/core）

### Public API

Import everything from '@/simulation/core' (index.ts re-exports all of the modules below).

rng.ts
- createRng(seed: number): Rng
- interface Rng { uniform(); normal(); normalArray(n, sigma=1): Float64Array; uniformArray(n): Float64Array; sign(): 1|-1; int(lo, hiInclusive); bernoulli(p); uint32(); fork(label: string|number): Rng; readonly seed }
- deriveSeed(seed, label): number
- normalizeSeed(seed): number
- seedState(seed32): [4 x uint32]
- xoshiro128ss(s0, s1, s2, s3): () => uint32

special.ts
- erf(x), erfc(x), erfcx(x)
- normPdf(z), normCdf(z), normSf(z), normInv(p) — standard normal only
- lgamma(x)
- betaIncReg(a, b, x)
- betaIncRegPair(a, b, x, y=1-x): [I, 1-I]
- binomPmf(k, n, p), binomCdf(k, n, p), binomSf(k, n, p) — binomSf = P(X>k)
- studentTPdf(t, nu), studentTCdf(t, nu), studentTInv(p, nu)

complex.ts (existing exports, plus these added)
- cAbs2, cSqrt (principal value), cExp, cLog, cIsClose(a, b, rtol=1e-12, atol=0), cToString(z, digits=4)

poly.ts (coefficients in descending powers)
- polyval(p, x), polyvalC(p, z): Complex
- polyRoots(p): Complex[]
- polyTrim, polyDer, polyMul, polyAdd
- polyFromRoots(roots): number[]
- polyResidual(p, z), ratvalC(b, a, z)

linalg.ts (Matrix = number[][], Vector = number[]; inputs are never mutated)
- identity(n), zeros(r, c=r), diag(v), clone, transpose
- matMul, matVec, matAdd, matSub, matScale, trace, dot, norm2, outer, normFro, isSymmetric(A, tol)
- luDecompose(A): { lu, perm, sign, singularAt }
- solve(A, b: Vector): Vector, and solve(A, B: Matrix): Matrix
- inv(A), det(A), cholesky(A)
- eigSym(A): { values (descending), vectors (columns) }
- eigvals(A): Complex[] (sorted by |λ| descending)
- sortByModulusDesc(zs)
- spectralRadius(A)
- svd(A): { U, S (descending), V } — thin SVD, A = U diag(S) Vᵀ
- cond(A), rank(A, tol?)
- pinvReg(A, lambda) = (AᵀA+λI)⁻¹Aᵀ, computed through the SVD
- pinv(A)

stats.ts (inputs are ArrayLike<number>)
- sum (Neumaier summation), mean, variance(x, ddof=1), std(x, ddof=1), rms, minMax
- quantile(x, q) (same as np.quantile 'linear'), quantiles(x, qs), median
- histogram(x, bins, range?): { edges, counts, centers, outside }
- meanCI(x, level=0.95): { mean, lo, hi, halfWidth, se, n, level } (Student-t)
- wilsonCI(k, n, level=0.95): { p, lo, hi, center, level }
- autocorr(x, maxLag): number[] (biased, rho[0] = 1)
- effectiveSampleSize(x, maxLag?)
- covariance(x, y, ddof=1), correlation(x, y)

units.ts
- fmt(x, digits=4)
- fmtSI(x, unit, digits=4)
- isSiPrefixable(unit)
- db10, db20, fromDb10, fromDb20
- wrap180(deg) → (-180, 180]; wrapPi(rad) → (-π, π]
- deg2rad, rad2deg, clamp(x, lo, hi)
- fsToRad(tFs, fHz) = 2π f t·1e-15; radToFs(phi, fHz)

### 使用注意事項

**隨機性**
- 每個實驗建立一個根亂數 `const rng = createRng(seed)`，每個雜訊來源各自 `rng.fork('comparator-noise')`、`rng.fork('dither')` 等。
- fork 出來的序列只取決於父 seed 與標籤，與父亂數已經抽了幾個數無關，所以在某處多抽幾個數不會改變其他序列。
- `createRng(child.seed)` 可以精確重現一個 fork；`fork(1)` 與 `fork('1')` 是同一條序列。
- seed 會被縮成 32 位元，小數部分捨去。

**常態分布**
- `normCdf` 在兩端尾巴都準。上尾請用 `normSf(z)` 或 `normCdf(−z)`，不要寫 `1 − normCdf(z)`。
- 例：`P(q=+1) = normCdf(s/σ)`，`E[q] = erf(s/(√2σ)) = 2Φ−1`。

**二項分布**
- `binomSf(k, n, p)` 回傳 `P(X > k)`，尾端也保有完整的相對精度。
- comparator 的精確 `P(G_N > 0)` 是 `binomSf(floor(N/2), N, p)`；N 為偶數時 `G_N = 0` 的平手不計入。
- 規格 §5 的 CLT 式是 `normCdf(m·√N/√(1−m²))`；測試以表格核對：0.5318、0.5996、0.7875、0.9500、0.9900。
- `binomCdf` 的成本約 `O(10·√(npq))`，n = 1e6 時約 0.1 ms；n 不要超過約 1e8。

**線性代數**
- `inv` 與 `solve` 遇到奇異矩陣會丟出訊息含「矩陣奇異（singular）」的 `Error`，要接住並顯示原因（例如 `λ_min = 0` 或缺乏 persistent excitation）。`det` 不會丟例外，奇異時回傳 0 或很小的值；`cond` 在 `σ_min` 恰為 0 時回傳 `Infinity`。
- `eigSym`：特徵值由大到小排序；特徵向量是各欄，每欄絕對值最大的分量取正號。
  - 例：`R = [[1,.99],[.99,1]]` 得到 values `[1.99, 0.01]`，欄向量 `[1,1]/√2` 與 `[1,−1]/√2`。
  - 輸入明顯不對稱時會丟例外；一般矩陣請用 `eigvals`。
- `eigvals(A)[0]` 是主特徵值，`spectralRadius(A) = |eigvals(A)[0]|`；穩定的條件是 `spectralRadius < 1`。
- 複數特徵值與根一定以精確的共軛對出現。
- `pinvReg(A, λ)` 是正則化的 preconditioner（`(R+λI)⁻¹` 型式）。

**多項式**
- 係數是降冪。更新延遲的特徵式 `z^{d+1} − z^d + g`，d = 2 時寫成 `polyRoots([1, -1, 0, g])`。
- 前導零會被去掉，尾端的零變成 `z = 0` 的精確根。
- 重數 m 的重根只能準到約 `ε^{1/m}`（三重根約 1e-5），這是數值上無法避免的。

**統計**
- `variance` 與 `std` 預設 `ddof = 1`。
- `meanCI` 用 Student-t 並假設樣本 iid；雜訊有相關時先用 `effectiveSampleSize` 估有效樣本數。n < 2 時半寬回傳 NaN。
- `wilsonCI` 用於成功率的信賴區間，例如 `P(方向正確)`。
- `autocorr` 是有偏、正規化的（等同 statsmodels 的 `acf(adjusted=False)`）；常數序列回傳全部 NaN。
- `histogram` 與 `np.histogram` 一致：最後一個 bin 包含右端點，`range` 之外的值計入 `.outside`。

**單位與格式**
- `fmtSI` 只對這些單位加 SI 前綴：s、Hz、rad、rad/s、V、A、W、F、H、Ω、J、S、C。例：`fmtSI(976562.5, 'Hz')` 得 `'976.6 kHz'`，`fmtSI(1.5e-12, 's')` 得 `'1.5 ps'`。
- 本身已帶尺度的單位原樣輸出：`'fs'`、`'dB'`、`'dBc'`、`'dBc/Hz'`、`'LSB'`、`'%'`。例：`fmtSI(0.399, 'fs')` 得 `'0.399 fs'`。
- `fmt` 在 `|x| ≥ 1e6` 或 `|x| < 1e-4` 時改用指數形式（例如 `'1.235e6'`、`'7.979e-5'`），並去掉尾端的零。
- 時間與相位的換算只用 `fsToRad(tFs, fOutHz)` 與 `radToFs`，不要手寫 `1e-15`。例：`fsToRad(0.5, 13e9) = 4.0841e-5 rad`，`20·log10(β/2) = −93.80 dBc`。
- `wrap180` 的範圍是 (−180, 180]，所以 `wrap180(−180) = 180`。

**複數**
- `cToString(z)` 產生表格用的文字，例如 `'0.9 + j0.4796'`。

**共通**
- core 不 import React 或 DOM，可以在 Web Worker 內使用。
- 沒有任何矩陣函式會修改輸入。

### 設計決定與補充

`docs/dev-conventions.md` §4 的簽名都有實作，沒有刪減或改名；下列是實作時決定的細節與額外的 export。

1. **較寬的輸入型別**：許多函式接受 `ArrayLike<number>` 而不只是 `number[]`，所以 `Float64Array` 也能直接傳。
2. **額外的 export**（概要簽名沒有列出）：
   - rng：`uniformArray`、`uint32`、`deriveSeed`、`normalizeSeed`、`seedState`、`xoshiro128ss`
   - special：`erfcx`、`normSf`、`betaIncRegPair`、`binomSf`、`studentT*`
   - linalg：`luDecompose`、`cholesky`、`pinv`、`rank`、`dot`／`norm2`／`outer`／`normFro`／`diag`／`clone`／`isSymmetric`、`sortByModulusDesc`
   - poly：`polyTrim`／`polyDer`／`polyMul`／`polyAdd`／`polyFromRoots`／`polyResidual`／`ratvalC`
   - stats：`sum`、`minMax`、`quantiles`、`median`、`effectiveSampleSize`、`covariance`、`correlation`
   - units：`fromDb10`／`fromDb20`、`wrapPi`、`fsToRad`／`radToFs`、`isSiPrefixable`
   - complex：`cAbs2`／`cSqrt`／`cExp`／`cLog`／`cIsClose`／`cToString`
3. **概要簽名沒有規定的順序與形狀**：
   - `eigvals` 與 `polyRoots` 依 `|z|` 由大到小排序；相同時實部大的在前，再依虛部大的在前，所以共軛對的 `+j` 根排在前面。
   - `svd` 回傳 thin SVD（`k = min(m, n)`）。
   - `histogram` 另外回傳 `centers` 與 `outside`。
   - `meanCI` 與 `wilsonCI` 回傳物件（欄位見上面的 API 清單）；`wilsonCI` 的 `level` 預設 0.95。
4. **只有標準常態**：`normPdf`、`normCdf`、`normInv` 沒有平均與 σ 參數，請用 `normCdf((x − μ)/σ)`。
5. **`pinvReg` 經由 SVD 計算**：`V diag(σ/(σ²+λ)) Uᵀ`，而不是去反轉 `AᵀA+λI`。λ > 0 時兩者數學上相同（測試以直接公式核對）；λ = 0 時就是 Moore–Penrose 偽逆。
6. **超過最低要求的精度**：
   - `binomPmf` 用 Loader 的 saddle-point 方法，`n·p` 與 `n·q` 以 double-double 保存。
   - `betaIncReg` 的前置因子用同一種 saddle-point 形式。
   - `eigvals` 使用 EISPACK 的 balancing（含排列），所以三角、defective 與 nilpotent 矩陣也能得到精確的特徵值。
7. **T-id 測試名稱**：core 內也有以 T-id 開頭命名的測試——T04（`special.test.ts`）、T09（`linalg.test.ts` 與 `poly.test.ts`）、T10 與 T18（`linalg.test.ts`），因為這些參考值是純數學的聲明；`scripts/verify.mjs` 會把它們和各章同 ID 的測試一起計入。
8. **負號**：`fmt` 與 `cToString` 使用 ASCII 的 `-`，無限大顯示為 `∞`／`-∞`。

## src/simulation/signal（@/simulation/signal）

### Public API

Everything is exported from '@/simulation/signal' (index.ts barrel).

fft.ts (same sign as NumPy: X[k]=Σx[n]e^{-j2πnk/N}; inverse includes 1/N):
- fft(re: Float64Array, im: Float64Array): void  (in place, any length: radix-2 for powers of two, Bluestein otherwise; twiddle and chirp tables cached per length)
- ifft(re, im): void  (in place, 1/N scaling)
- nextPow2(n): number; isPow2(n): boolean
- fftReal(x: ArrayLike<number>, nfft = x.length): { re, im }  (zero-pads or truncates)
- fftfreq(n, fs = 1), rfftfreq(n, fs = 1), fftshift(x): Float64Array  (same as NumPy)

window.ts:
- type WindowName = 'rectangular' | 'hann' | 'blackmanHarris'
- hann(n, sym = false), blackmanHarris(n, sym = false), rectangular(n), getWindow(name, n, sym = false): Float64Array
  The default is periodic (denominator N), which is what scipy get_window and welch use. sym = true gives the symmetric window (denominator N-1).
- BLACKMAN_HARRIS_4 = [0.35875, 0.48829, 0.14128, 0.01168]
- windowStats(w): { n, sumW, sumW2, coherentGain = Σw/N, enbwBins = NΣw²/(Σw)² }

psd.ts:
- welch(x, fs, opts?: WelchOptions): PsdResult
  Defaults: window 'hann' (periodic), nperseg 256 (clamped to N, with a warning), noverlap = floor(nperseg/2), nfft = nperseg, detrend 'constant', onesided true, scaling 'density'.
- periodogram(x, fs, opts?: PeriodogramOptions): PsdResult
  Defaults: window 'rectangular'. If nfft < N, only the first nfft samples are used, as in SciPy.
- Option types: PeriodogramOptions { window?: WindowName | ArrayLike<number>; nfft?; detrend?: 'constant' | 'mean' | 'linear' | 'none' | false; onesided?; scaling?: 'density' | 'spectrum' }. WelchOptions adds { nperseg?; noverlap? }.
- PsdResult { f, psd: Float64Array; onesided; scaling; units: 'x^2/Hz' | 'x^2'; fs; df = fs/nfft; enbwHz = fs·Σw²/(Σw)²; enbwBins; nperseg; noverlap; nfft; nSegments; window: WindowName | 'custom'; detrend: 'constant' | 'linear' | 'none'; unusedSamples; warnings: string[] }
- toneFit(x, fs, f0, { includeDc = true }?): { f, a, b, amplitudePeak, amplitudeRms, phase, dc, rmsResidual, n, droppedColumns }
  The model is x ≈ dc + a·cos(2πf0n/fs) + b·sin(2πf0n/fs) = dc + A·cos(2πf0n/fs + φ), with φ = atan2(-b, a) and time origin n = 0.
- toneFitMulti(x, fs, freqs: number[], { includeDc }?): { tones: ToneFitComponent[], dc, rmsResidual, n, droppedColumns }
- integratePsd(f, psd, fL, fH): number  (trapezoid rule with linear interpolation at the edges; limits are clamped to the f range; returns 0 for an empty interval; f must be increasing)
- findTones(f, psd, { minProminenceDb = 10, maxTones = 10, lobeHalfWidthBins = 4, fMin?, fMax? }?): DetectedTone[]
  Each DetectedTone is { f, fCentroid, index, peakPsd, prominenceDb, lobe: [lo, hi], power = Σ_lobe psd·Δf, powerDb }, sorted by power, largest first.
- psdToDbcHz(sPhi: number): number | (sPhi: ArrayLike<number>): Float64Array  computes ℒ = 10·log10(S_φ^(1)/2)
- dtftPsdToOnesided(S, fs): number | Float64Array  computes S^(1)(f) = 2·S(e^{jΩ})/fs (validation.md E28)

filter.ts (discrete-time b, a are ascending powers of z^-1; continuous-time b, a are descending powers of s; same as SciPy):
- lfilter(b, a, x, zi?): { y: Float64Array, zf: Float64Array }  (DF-II transposed, normalised by a[0], state length max(len a, len b) - 1, same zi definition as SciPy)
- lfilterZi(b, a): Float64Array  (same as scipy lfilter_zi; throws if Σa = 0)
- class StreamFilter(b, a = [1], zi?) { step(x): number; process(x): Float64Array; reset(); getState(): Float64Array; setState(z); readonly order }
- freqz(b, a, omegas [rad/sample]): Complex[]  computes H(e^{jΩ}) = B(e^{-jΩ})/A(e^{-jΩ})
- freqzHz(b, a, fHz, fs): Complex[]
- freqs(b, a, w [rad/s]): Complex[]  computes H(jω)
- bilinear(b, a, fs, prewarpHz?): { b: number[], a: number[] }  (s = K(1 - z^-1)/(1 + z^-1); K = 2fs by default, or K = 2πfp/tan(πfp/fs) with prewarping; a[0] = 1)
- impulseResponse(b, a, len): Float64Array

corr.ts:
- xcorrAtLag(x, y, lag: int, normalization: 'mean' | 'sum' = 'mean'): number
  R[ℓ] = mean over valid n of x[n-ℓ]·y[n]. Valid n means 0 ≤ n < len(y) and 0 ≤ n-ℓ < len(x). Returns NaN when there is no overlap.
- xcorr(x, y, maxLag, { normalization?, method?: 'auto' | 'direct' | 'fft' }?): { lags: Int32Array, values: Float64Array, counts: Int32Array }
  'auto' switches to the FFT path when work exceeds 4e6.

### 使用注意事項

- 從 `'@/simulation/signal'` 匯入。這些函式是純函式，不依賴 React 或 DOM，可以在 Web Worker 內呼叫。
- 係數約定：
  - 離散時間濾波器（`lfilter`、`StreamFilter`、`freqz`、`impulseResponse`）的 `b`、`a` 是 `z^-1` 的升冪，和 `core/poly.ts` 的降冪相反。
  - `freqs` 與 `bilinear` 的輸入是 `s` 的降冪。
  - `freqz` 的 Ω 單位是 rad/sample（Ω = 2πf/fs）；要直接給 Hz 用 `freqzHz(b, a, fHz, fs)`。
  - block 速率的迴圈，取樣率要用 `f_u` 而不是 `f_s`。
- 範例：把驗算 E44 的 PD 轉移函數離散化：`const { b, a } = bilinear([1, 0, 0], [1, 2*zeta*wn, wn*wn], fs)`，然後 `const pd = new StreamFilter(b, a)`，每個 sample 呼叫一次 `pd.step(x)`。
- PSD 約定：
  - `welch` 與 `periodogram` 預設回傳單邊密度 PSD，單位 x²/Hz；DC 與 Nyquist 不乘 2。
  - `Σ psd·df` 是總功率。`integratePsd(f, psd, fL, fH)` 給出頻帶內的 σ²；例如單位 s²/Hz 的時間誤差 PSD 積分後是 jitter²（s²）。
  - 相位雜訊：`L = psdToDbcHz(S_phi_onesided)`。
  - 若手上是 DTFT 形式的 PSD（`σ² = (1/2π)∫S dΩ`），先用 `dtftPsdToOnesided(S, fs)` 轉換；漏掉會讓 `L(f)` 差 `10log10(fs/2)`（驗算 E28）。
  - 依 dev-conventions §5，每張 PSD 圖都要標示 window、nperseg、ENBW、單邊／雙邊與單位；這些都是 `PsdResult` 的欄位（`window`、`nperseg`、`nSegments`、`enbwHz`、`onesided`、`units`、`df`）。`PsdResult.warnings` 要顯示在 UI。
- 突波與單音量測（規格 §15.5）有三種方式：
  - 整段紀錄的 FFT：`periodogram(x, fs, { window })`。`scaling: 'spectrum'` 時，相干單音在它的 bin 讀到 `A²/2`。
  - Welch PSD：`welch(...)`。
  - 相干單音量測：`toneFit(x, fs, f0)` 回傳 `amplitudePeak`（峰值，不是 RMS）、`phase`（`x ≈ A cos(2πf0 n/fs + φ)`）與 `rmsResidual`。90／110 kHz 邊帶對用 `toneFitMulti`。
  - 相位單音換算成單邊帶 spur 的 dBc：`20log10(A_peak/2)`，等於 `psdToDbcHz(A²/2)`。
- `findTones` 是近似的，結果依賴窗函數。單音功率是主瓣內 PSD bin 的和乘以 `df`（主瓣上限 `lobeHalfWidthBins`，預設 4，適合 Blackman-Harris；Hann 只要 2；補零時要等比例加大）。原始 periodogram 會產生 10–20 dB 突出量的假峰；請用 Welch 加 `minProminenceDb ≥ 15–20`，頻率已知時用 `toneFit`。
- `xcorr` 的正負號：`R[ℓ] = mean_n x[n-ℓ]·y[n]`。正的 lag 表示 y 落後 x；若 y 是 x 延遲 D 個 sample，峰值在 `ℓ = +D`。它不會替你去平均值；平均只在重疊的樣本上取（個數在 `counts`），沒有重疊時回傳 NaN。
- `lfilter` 支援分段濾波：把 `zf` 當下一段的 `zi`。`StreamFilter` 的輸出和 `lfilter` 逐位元相同。把 `lfilterZi(b, a)` 乘上 `x[0]` 可以消除啟動暫態。
- 窗函數預設是 periodic；設計對稱 FIR 時用 `hann(n, true)`。
- 實測效能（Node）：
  - 1M 點、`nperseg = 4096` 的 `welch`：約 28 ms。
  - 2^20 點的 `fft`：約 78 ms。
  - 長度為質數 1,000,003 的第一次 Bluestein 呼叫：約 0.5 s，主要花在建立 plan，之後會快取。
  - 1M 點的 `toneFit`：約 0.1 s。
  - 超過約 1M 點的工作放進 Worker。
- `core/stats.autocorr` 的正規化可能和 `xcorr` 不同；章節文字要寫明用的是哪一個。

### 設計決定與補充

1. `welch` 的 `detrend` 選項在規格與約定中有兩種寫法（`'constant'` 與 `'mean'`），兩者都接受並視為同一件事，結果回報 `'constant'`；另外支援 `'linear'`、`'none'` 與 `false`。
2. `bilinear` 在一個退化情形與 SciPy 不同：當數位分子的首項係數 ≤ 1e-14 時，SciPy 的 `normalize()` 會把它丟掉（並警告），在 `z^-1` 形式下等於把濾波器提前一個 sample；這裡保留完整長度的分子，數學上才是正確的濾波器。只有類比分子在 `s = K` 恰有零點時才會發生，JSDoc 裡有說明。所有測試過的情形都和 SciPy 吻合到 1e-12。
3. 超出 dev-conventions §4 清單的額外項目（都是附加的，不改動列出的簽名）：
   - 結果：`PsdResult` 另外帶有 `scaling`、`fs`、`df`、`enbwBins`、`noverlap`、`nfft`、`nSegments`、`unusedSamples`、`warnings`。
   - 選項：`scaling: 'spectrum'`。
   - 函式：`toneFitMulti`、`lfilterZi`、`freqzHz`、`dtftPsdToOnesided`、`fftReal`、`fftfreq`、`rfftfreq`、`fftshift`、`isPow2`、`getWindow`。
   - `StreamFilter` 另有 `process()`、`getState()`、`setState()`。
   - `xcorr` 另外回傳 `counts`。
4. 雙邊 PSD 的輸出順序和 SciPy 一樣是 `fftfreq` 順序（0、正頻率、負頻率）；畫圖或傳給 `integratePsd` 前先 `fftshift`。
5. signal 資料夾內的檔案互相以 `'@/simulation/signal/...'` 別名 import；從 core 只 import `'@/simulation/core/complex'`。
6. `testSignals.ts` 是只給測試用的輔助檔，不從 barrel 匯出。

## src/simulation/models：pll / dsm / dtc / blockLms

### Public API

pll.ts. Ω is always in rad/sample. Discrete-time b and a are ascending powers of z⁻¹; continuous-time coefficients are descending powers of s.
- Continuous-time prototype:
  - ctLoopCoeffs({zeta,wn}) → {L,Hpd,T}
  - ctLoopGain, ctHpd and ctT, each (omega, {zeta,wn}) → Complex. omega and wn are in rad/s, or both normalised with wn = 1.
  - ctBandwidth3dB({zeta,wn}) → ω_3dB of T(s). For ζ = 0.7 this is 2.04895·ω_n.
  - wnFromBandwidth3dB(w3, zeta).
- designDtLoop({ wnTs | wn+fs | fbw+fs, zeta, loopDelay?=0, method?='dpll'|'bilinear' }) → DtLoopDesign {method, fs, wnTs, zeta, loopDelay, Kp, Ki, L, Hpd, T: {b,a}, poles: Complex[], spectralRadius, stable, warnings}. The result is cloneable.
- loopFreqResponse(design, omegas) → {L, Hpd, T: Complex[]}.
- createHpdFilter(design) and createTFilter(design) → StreamFilter. Its state persists across blocks.
- Error-path kinds: ERROR_PATH_KINDS = ['identity', 'single_tone', 'fir', 'first_order_hp', 'type2_dt', 'iir'].
  - Types: ErrorPathParamsMap (snake_case keys, the same as the §15.3 JSON), ErrorPathSpec, ErrorPathKind.
  - singleToneFir(mag, phiRad, omega) → 2-tap FIR.
  - errorPathTransfer(spec) → {kind, b, a, description}. Cloneable.
  - errorPathFilter(kind, params) → {kind, b, a, step, reset, freq(Ω), getState, setState}. Not cloneable.
- Correlation C:
  - corrSingleTone({amplitude, magnitude, phaseRad, omega, delay?}). At Ω = 0 or π it uses the doubled formula (E46).
  - corrFromPsd({omega grid, sxx (two-sided DTFT PSD), h: Complex[] | {b,a}, delay?}). Uses the trapezoid rule; a grid starting at ≥ 0 is treated as half of a real-symmetric spectrum.
  - corrEmpirical(x, u, D), equal to xcorrAtLag.
  - corrFromSequence({x, h, delay?, skip?}).
  - corrFromAutocorr(h, rx(lag), D).
  - ar1Psd and ar1Autocorr.
  - crossResponse(h, hHat, omega), which gives H·conj(Ĥ) for filtered-x mismatch (E45).
  - correlationC = {singleTone, fromPsd, empirical, fromSequence, fromAutocorr} (aliases).
- polarityMarginDeg(thetaDeg) and magPhaseDeg(z).

dsm.ts
- Types: DsmKind = 'first_order' | 'mash111'; CodeNormalization = 'none' | 'zero_mean' | 'unit_rms' | 'standardize'.
- quantizeFcw(frac, bits=20, dither) → {M, K, fracEff, warnings}.
- class DsmStream(opts, rng?): step() returns y and updates .residue, .quantError and .input. Also has reset().
- runDsm({kind, frac, bits?, length, dither?, seed?, initialState?, normalization?}) → DsmResult {y, residue [T_vco], quantError (y − in/M), code (normalised residue), normalization, period, yRange, residueRange, K, M, fracEff, warnings}. Worker-callable.
- Statistics and normalisation:
  - codeStats(x) → {n, mean, meanSquare, rms, std}.
  - normalizationParams(stats, mode).
  - normalizeCode(x, mode).
- Periods:
  - detectPeriod(seq, {start?, maxPeriod?, tol?, minRepeats=2}): KMP in O(n) when tol = 0.
  - firstOrderPeriod(K, bits) = M/gcd(K, M).
- Spectra:
  - dsmNoiseTheory(kind, f, fs, 'quant_error' | 'residue').
  - dsmSpectra(res, fs, welchOpts) → {quantError, residue: PsdResult, theory…}. Default window is Hann, nperseg 4096.
  - psdSlopeDbPerDecade(f, psd, fLo, fHi).
  - analyzeDsm({options, fs, welch?, slopeBand?}). Worker-callable.

dtc.ts. Delays are in fs and codes in LSB.
- Types: DtcParams {gainFs, offsetFs?, c2?, c3?, inlLutFs?, inlLutCodeMin?, bits?, signed?, rounding?: 'nearest' | 'truncate'}; DtcNonlinearity.
- Codes: dtcCodeRange(bits, signed), roundCode, quantizeDtcCode(code, p) → {code, saturated}.
- Mapping: dtcMapping(code, p) (no quantisation), dtcDelayFs(code, p) (quantise, saturate, then map), dtcIdealCode(delay, p).
- Bulk: dtcTransfer(codes, p) → {delayFs, codes, saturationCount}; dtcTransferRun({codes, params}) is the worker version.
- dtcNonlinearityFs(x, {offset_fs, c2, c3}) gives the nonlinearity on the normalised code.
- dtcInlDnl(p) → endpoint-fit INL and DNL.

blockLms.ts
- BlockLmsConfigSchema (zod). Types: BlockLmsConfig (output), BlockLmsConfigInput (every field optional), SeededPattern, BlockLmsErrorPath.
- parseBlockLmsConfig(json | jsonString) → {ok, config | null, errors: string[]}. Messages are in Traditional Chinese as 'path：msg'.
- SPEC_15_3_EXAMPLE is the verbatim spec JSON. DEFAULT_BLOCK_LMS_CONFIG is that JSON with the extension defaults filled in.
- Constants: MAX_TOTAL_SAMPLES = 2^28, MAX_TRACE_POINTS = 2^21, ANALYTIC_SAMPLES = 2^17, MEAN_FIELD_SAMPLES = 2^14, DIVERGENCE_LIMIT_FS = 1e12.
- runBlockLms(configInput) → BlockLmsResult with these fields:
  - config
  - blocks {w, wPhys: length K+1; G: length K}
  - trace {n, x, u = H{x}, e, q, xRef}
  - metrics {meanW, stdW, meanWPhys, bias, mse, settlingBlock | null, saturationCount, wrapCount, limitCycleCount, limitCyclePeriod, sigmaWRatio, biasPred, diverged, divergenceBlock, meanG}
  - analytic {Kq, Cest, K, g, p, stableMean, rhoMean, gCritical, sigmaWPred, sigmaEta2, pmDeg, fuHz, f3dbHz, enbwHz, tauBlocks, wStarLinear, wStarMeanField, slopeMeanField, gMeanField, Ex, Ex2, ExRef, ExRef2, statsSamples, normalization}
  - warnings, assumptions, modelLevel ('L1' | 'L2' | 'L5'), units
- analyzeBlockLms(configInput) → {config, analytic, warnings, assumptions, modelLevel}. No Monte Carlo; meant for fast UI updates.
- runBlockLmsMonteCarlo({config, runs?=8, seeds?}) → {seeds, perRun {meanW, stdW, bias, settlingBlock, diverged}, meanW {mean, lo, hi}, pooledStdW, wMean, wStd, analytic, warnings}.
- generateCodePattern({pattern, length, seed, normalization?}) → {code, raw, normalization}. It reproduces the code the Lab simulation uses exactly.
- createCodeSource(pattern, rng) → {fill(buf, off, cnt)}.
- createZigguratNormal(rng) → () => N(0,1).

The worker-callable functions take one cloneable params object and return cloneable results: runBlockLms, analyzeBlockLms, runBlockLmsMonteCarlo, generateCodePattern, parseBlockLmsConfig, runDsm, analyzeDsm, dtcTransferRun, designDtLoop, errorPathTransfer, corrFromPsd, corrSingleTone and corrFromSequence.

### 使用注意事項

**單位與約定**
- Ω 一律是 comparator 速率 `f_s` 上的 rad/sample。不要把 Ω 代進 `ctHpd` 或 `ctT`（E44）。離散時間的相位與極性分析請用 `designDtLoop` 搭配 `loopFreqResponse`，或 `errorPathTransfer` 搭配 `freqz`。
- 規格 §6.1 的例子是 `ctHpd(0.3, {zeta: 0.7, wn: 1})`，回傳 `−0.0815 + j0.0376`；E44 的 DPLL 相位在 `pll.test.ts` 重現。

**Worker 用法**
- `errorPathFilter` 與 `createHpdFilter` 回傳帶方法的物件，不能跨 worker 邊界；改送 `errorPathTransfer(spec)`（回傳 `{b, a}`）或 `designDtLoop(spec)`。
- 在 worker 內跑一組設定：`SimWorkerClient.run('blockLms', 'runBlockLms', partialConfig)`。缺的欄位用規格 §15.3 的預設，輸入不合法時丟出多行的繁體中文 `Error`。
- UI 以 `parseBlockLmsConfig(text)` 驗證 JSON，並把 `errors[]` 原文顯示。
- 不要修改 `DEFAULT_BLOCK_LMS_CONFIG`；用 spread 或 `structuredClone`。

**相關係數 C 的輔助函式**
- `corrFromPsd` 要的是雙邊 DTFT PSD（`σ² = (1/2π)∫S dΩ`），不是 Welch 的單邊 x²/Hz；先用 `dtftPsdToOnesided` 對應轉換（E28）。
- 從 0 開始的頻率格點視為 [0, π]、偶對稱。
- 單音用 `corrSingleTone`，它在 Ω = 0 或 π 已經套用兩倍公式（E46）。

**結果的形狀與讀法**
- block 層級的序列：
  - `blocks.w` 的長度是 `num_blocks + 1`，`w[0] = w0`。
  - 第 k 個 block 用 `wPhys[max(0, k − d)]`，d 是更新延遲。
  - `G` 是平均 G（無因次），sum 模式下是總和。
- 指標：
  - 所有 metrics 都取後半段 block。
  - 若從未停在 4σ 帶內，`settlingBlock` 為 null。
  - NaN 表示未定義，例如迴路不穩或 σ_v = 0 時的 `sigmaWPred`。`JSON.stringify` 會把 NaN 變成 null，匯出報告時要處理。
- 解析增益：
  - `analytic.K` 是每個 sample 平均 G 的斜率 `K_q·C`，遇到 unipolar bug 時減半。
  - `analytic.g` 另外包含 sum 模式的 ×N。
  - `pmDeg = 90° − (2d+1)·asin(g/2)`。
  - `f3dbHz` 與 `enbwHz` 只在 d = 0 時給出；E27 說沒有 −3 dB 點的情形為 NaN。
- 固定點：
  - `wStarMeanField` 是對實際 code 序列與路徑、高斯雜訊下的精確 mean-field 固定點（考慮 E01／E03），和 MSE 類的線性化值 `wStarLinear` 不同。
  - Analytic 對 Monte Carlo 的交叉比對用 `metrics.biasPred` 對 `metrics.bias`；σ_w 用 `metrics.sigmaWRatio`。
- 警告：
  - 規定的警告字句逐字輸出：`'C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散'`、`'g ≥ 2：一階模型不穩定'`、`'gm_mode=sum 時有效增益放大 N 倍'`。
  - 另外還會對這些情形發警告：`C ≈ 0`、更新延遲造成的不穩、σ_v = 0、`H_PD(1) = 0` 的 DC 抑制（E03）、預測偏差、`Ĥ ≠ H`、LSB 遠大於 σ_w、飽和與 wrap 事件、limit-cycle。
  - 全部警告都傳給 `ExperimentShell`。

**定點實驗與 code 序列**
- `quantize_physical = true` 是 L5 模型；`limitCyclePeriod` 與 `limitCycleCount` 只在這個模式計算。
- 例：σ_v = 0、a = 3.05、μ = 0.05 時，w 在 3.0 與 3.125 fs 之間以週期 2 來回切換，平均 3.0625 而不是 3.05，是 §13 很好的示範。
- 要畫出 Lab 實際用的 code，呼叫 `generateCodePattern({pattern, length, seed, normalization})`。`runDsm` 用另一條 dither 序列，種子是 `createRng(seed).fork('dsm-dither')`。
- DSM 的餘數單位是 `T_vco`（VCO 週期）：`residue = Σ(y − in/M)`，嚴格有界。一階 DSM 初始狀態為 0 時餘數落在 (−1, 0]；MASH 的 `|r| < 2`。
- PSD 圖：`dsmSpectra` 與 `analyzeDsm` 回傳的 `PsdResult` 帶有 window、nperseg、ENBW、單邊旗標與單位欄位，符合 dev-conventions §5 的標示規則。

**T-id 與效能**
- 以 `'Txx:'` 開頭命名、涵蓋的 T-id：T06 與 T07（`pll.test.ts`、`blockLms.test.ts`）、T13（`blockLms` 的 Monte Carlo 測試）。
- `runBlockLms` 約 35 ns／sample。掃描與 Monte Carlo 時傳 `record.sample_trace_blocks: 0`。每次 Monte Carlo 都會重做正規化的預掃描，8M 個 sample 約 0.1 s。

### 設計決定與補充

1. **MASH 1-1-1 的斜率**：原本要求 `y − frac` 在低頻約 40 dB/dec，這在數學上不對：`y − in/M = −(1−z⁻¹)³·s3/M`，斜率是 60 dB/dec。DTC 的相位餘數（累積誤差）是 `−(1−z⁻¹)²·s3/M`，才是 40 dB/dec。Python 實測 59.7 與 39.8 dB/dec，測試斷言的是這兩個正確的值。
2. **DT 迴路方法**：預設採驗算 E44 的直接 DPLL 差分方程式：`L(z) = (Kp + Ki/(1−z⁻¹))·z^{−(1+d)}/(1−z⁻¹)`，`Kp = 2ζω_nT_s`、`Ki = (ω_nT_s)²`；迴路延遲明確，`h_PD[0] = 1`。另提供 bilinear（Tustin）變體做比較。
3. **Comparator 雜訊產生器**：`blockLms` 用區域的 Ziggurat（定義在 `blockLms.ts` 的 `createZigguratNormal`，建立在 `createRng(seed).fork('comparator-noise')` 的 `rng.uint32()` 上）產生雜訊，而不是 `rng.normal()`。
   - `rng.normal()` 每個 sample 約 35 到 50 ns，主導了執行時間；Ziggurat 讓整個模擬約快一倍。
   - 結果仍完全由 seed 決定，並通過 KS、動差與尾端測試。
4. **Sum 模式用平均模式的 μ（g = 326.8，極點 −325.8）**：模擬的 w 在數值上不會發散，因為 sign-LMS 的 `|G| ≤ N`；它會落在幾萬 fs 的有界週期 2 振盪。測試斷言的是這個行為、解析上的不穩，以及專屬的警告，而不是數值發散。發散偵測（`|w| > 1e12 fs`）仍保留作為安全網。
5. **`unipolar_unmapped_bug`**：code 零平均（預設 iid ±1）時，這個 bug 只會讓增益減半，σ_w 與固定點不變；只有 `E[x_ref] ≠ 0` 才出現偏差。所以負面測試用平均 0.5、`normalization: 'none'` 的高斯 code，結果 `w* ≈ 63.23 fs` 而不是 3 fs，Python 的 mean-field 也確認。
6. **Schema 的擴充**：
   - `code_normalization`：加入 `'standardize'`。`'unit_rms'` 讓 `E[x²] = 1` 但不去除平均，這樣 §11.1 的 offset 效應才看得到；統計取整段紀錄。
   - `gain_register`：加入 `lsb_fs`（預設 0.125 fs，對應 E13 的 `gain_lsb_fs`）與 `signed`（預設 false）。`quantize_physical` 為 false 時完全不做暫存器量化；為 true 時，更新量與物理 code 用同一種捨入模式。
   - Regressor 模式：raw 模式忽略 `gm_code_delay_samples` 並警告；filtered 模式下延遲 D 套用在 `u_f`。
   - `filtered_x_model`：`{path: 'same_as_path' | errorPath, gain_mismatch, extra_delay_samples}`。
   - Pattern 參數：DSM 類 pattern 取 `{frac, bits, dither, signal: 'residue' | 'quant_error', initial_state}`；gaussian pattern 取 `ar1`。
   - 新欄位：`'iir'` error-path 種類，以及 `mode` 欄位（自由字串）。
7. **Error-path 參數的 key 風格**：`pll.ts` 的 error-path 參數 key 用 snake_case（`magnitude`、`phase_deg`、`omega`、`taps`、`pole`、`wn_ts`、`zeta`、`loop_delay`、`method`、`b`、`a`），和 JSON 的 `pll_error_path.parameters` 完全相同，設定可以直接傳進去；`pll.ts` 的其餘部分是 camelCase。
8. **DSM dither 的定義**：LSB dither `d ∈ {0, 1}` 加在第一級輸入，平均因此偏移半個 LSB（`fracEff = (K+½)/M`）；餘數是對加了 dither 的輸入量的，所以仍嚴格有界。
9. **仍留在 models 的通用工具**：Ziggurat 常態（`blockLms.ts`）、`detectPeriod` 與 `psdSlopeDbPerDecade`（`dsm.ts`）、`codeStats`（`dsm.ts`）目前都定義在各自的模型檔內，沒有放進 `core`／`signal`；要在別的模型使用時從該檔 import。

## src/components（@/components）與 src/workers（@/workers）

### Public API

Import everything from '@/components'. Importing it also loads components.css.

MATH / DIAGRAMS
- Tex({ children: string }) and TexBlock({ children: string; id?: string; label?: ReactNode }). TexBlock uses display mode and shows the "(F-x.y)" badge; the DOM anchor is id="formula-F-x.y". Both are memoized.
- renderTex(src, displayMode): string
- Mermaid({ chart: string; caption?: string; ariaLabel?: string }). Loads mermaid lazily with securityLevel 'strict'. Renders are queued one at a time with unique ids. It re-renders when the theme changes (one 'base' theme whose colours come from the design tokens; see mermaidTheme.ts). A parse error shows a danger callout.

PLOT
- Plot({ data: Plotly.Data[]; layout?; config?; height?=360; title?; csvName?; xLog?; yLog?; caption?; ariaLabel?; className? })
  - Lazy-loads Plotly, updates with Plotly.react, resizes via ResizeObserver, and calls Plotly.purge on unmount.
  - Plot loads `plotly.js-cartesian-dist-min` (2D traces only: scatter / bar / histogram / heatmap; 1.39 MB raw / 0.47 MB gzip instead of the full bundle's 4.67 / 1.42 MB). Import types from `'plotly.js-cartesian-dist-min'` and mock it in tests with `vi.mock('plotly.js-cartesian-dist-min', …)`; `src/components/plotlyBundle.test.ts` pins what the bundle must contain (API functions, icons, every trace type used in src).
  - Modebar: zoom, pan, reset, plus 下載 PNG / 下載 SVG / 下載 CSV. It floats inside the plot at the top-right and appears on hover (always visible on touch devices, in a 28 px strip above the plot). When the legend is above the plot, Plot sets `--c-plot-top` on the `.c-plot-gd` element to the computed top margin (`_fullLayout._size.t`, legend included) so the modebar sits at the top of the data area instead of covering the clickable legend; with an inside legend it stays at the paper top (0).
  - xLog/yLog drop ≤0 points and show "已略去 N 個 ≤0 的點（log 軸）". Log axes label only the powers of ten (`dtick: 1`) and keep the 2…9 minor gridlines without labels.
  - Legend: ≤ LEGEND_INSIDE_MAX (3) legend entries → inside the plot area on a semi-transparent `--surface`, in the first top corner that holds no data (`pickLegendCorner`: top-right, else top-left; the corner box is LEGEND_CORNER_FRACTION = 30 % of the data range in each direction, log axes compared in log10, a caller `xaxis.range` / `yaxis.range` is used when given). When both top corners hold data (a curve converging to the top edge, a full-width reference line), when the estimated legend width exceeds 40 % of the plot width (phones), or when a trace uses a secondary axis / is a heatmap, the legend goes above the plot instead. More than 3 entries → horizontal above the plot. A caller `layout.legend` that sets orientation / x / y / xanchor / yanchor always starts from the "above" base (the yanchor:'top' fix for y ≤ 0 still applies). `legendPlacement(opts)` returns the resolved placement.
  - Log axes (xLog / yLog): minor gridlines at 2…9 without labels; the major tick spacing follows the span in decades (`logAxisDtick`): ≥ LOG_POWER_TICKS_MIN_DECADES (1.7) → powers of ten only (dtick 1), 1–1.7 → 1, 2, 5 ('D2'), < 1 → Plotly's automatic linear-style ticks. The initial span comes from the data (`logSpanDecades`, or the caller's axis `range`); on zoom (`plotly_relayout`) Plot re-evaluates the visible span and calls `Plotly.relayout` with the new dtick, so a zoomed-in decade still has tick numbers. Axes where the caller sets dtick / tickvals / tickmode / nticks are left alone.
  - Colour-vision redundancy: from the 4th trace on, scatter traces without `line.dash` get dash / dot / dashdot in turn (`applyDashCycle`); traces with an explicit dash, `line.width: 0` or markers-only mode are left alone.
  - Lazy rendering (wave 1, performance[1]): Plotly is loaded and `Plotly.react` is called only once the figure is within PLOT_NEAR_MARGIN (700 px) of the viewport (IntersectionObserver); the fixed-height "圖表載入中…" placeholder keeps the layout stable. Once a page contains a Plot that is not yet near, Plotly is prefetched in `requestIdleCallback` (fallback: 1.5 s timer) so the first scroll-to-chart draws immediately. `beforeprint` and the registry `capture` (HTML report) force rendering; `capture` awaits the first draw (15 s cap). jsdom has no IntersectionObserver, so tests render immediately. `scripts/screenshots.mjs` scrolls each `.c-plot-gd` into view and waits for `.main-svg` before a `plot:N` / `exp:N` shot.
- loadPlotly(); PLOT_NEAR_MARGIN
- PlotRegistryProvider({ registry?, children }), createPlotRegistry() → { register, captureAll(): Promise<{ plots: { title, dataUrl }[]; failed: string[] }>, size }, usePlotRegistry()
- Pure helpers: filterLogData(data, xLog, yLog) → { data, dropped }; buildThemedLayout(tokens, { height, xLog?, yLog?, layout?, legendEntries? }); buildExportLayout(layout, tokens, title?); tracesToColumns(data) → CsvColumns; mergeDeep(a, b); applyDashCycle(data); withAlpha(hex, alpha); DASH_CYCLE; LEGEND_INSIDE_MAX

CONTROLS
- ParamControl({ label; ariaLabel?; value; onChange; min; max; step?; unit?; log?; hint?; reg?; digits?=6; integer?; clampOnBlur?; allowOutOfRange?; disabled?; id? })
- SelectControl<T extends string | number>({ label; value: T; onChange(v: T); options: (T | { value: T; label: string; disabled? })[]; hint?; reg?; ariaLabel?; disabled? })
- ToggleControl({ label; value: boolean; onChange; hint?; reg?; ariaLabel?; disabled? }) — a checkbox with role="switch".
- CaseSelector({ cases: UseCasesResult<P>; label? })
- parseNumberInput(s): number | null; roundSig(x, sig); formatInput(x, digits)

TAGS / LAYOUT
- ClaimTag({ kind: 'exact' | 'approx' | 'research' }) shows 精確｜指定模型 / 近似｜需驗證 / 研究假說／延伸.
- ModelLevel({ level: 'L0'..'L6'; showName? }) with a tooltip from the spec §15.1 table.
- SourceTag({ kind?: 'illustrative' | 'simulation' | 'literature' | 'measured' }), default 'illustrative'.
- Callout({ kind?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode | null; children }). Danger uses role="alert".
- Section({ kind: 'intuition' | 'diagram' | 'formula' | 'example' | 'explore' | 'assumptions'; title?; level?: 2 | 3 | 4 (default 3); id?; children }). Each kind has an icon and the label 直覺 / 圖 / 公式 / 範例 / 探索 / 注意假設.
- Derivation({ title; derivation: ReactNode; symbols?: { symbol: TeX string; meaning; unit? }[] | ReactNode; units?: Record<string, string> | ReactNode; assumptions?: string[] | ReactNode; level?; claim?; formulaId?; defaultOpen? }). Tabs: Derivation / Symbols / Units / Assumptions / Model Level; only tabs with content are shown.
- MetricTable({ rows: MetricRow[]; caption? })
  - MetricRow = { name; value: number | string | null; unit?; formulaId?; claim?; analytic?; tolerance?; toleranceMode?: 'abs' | 'rel'; digits?; note? }
  - evaluateMetric(row) → { delta?, relDelta?, pass? }
- TestBadge({ id: 'T01'.. }) shows verified / partial / fail / pending, with test names in the tooltip. 'verified' appears only when status === 'pass'. Also getTestStatus(id).
- ModeGate is re-exported from '@/app/settings'.

EXPERIMENT SHELL
- ExperimentShell(props): { id; title; level; claim?; source?='illustrative'; tests?; description?; assumptions: string[]; controls; children; params: Record<string, unknown>; seed?; onSeedChange?; units?; metrics?: MetricRow[]; warnings?: string[]; crossCheck?: { analytic | monteCarlo | fixedPoint: CheckStatus | { status, note? } }; actions?: { onReset?, onStep?, onRun?, onRunToConvergence?, onStop?, onFreeze?, running?, frozen?, runKind?: 'compute' | 'animate', progress?: { done, total, unit? }, onSkipToEnd? }; exportData?: () => Record<string, ArrayLike<number | string | null>>; presets?: { name, params, description? }[]; onLoadPreset?(p); headingLevel? }
  - CheckStatus = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'
- Run actions (types.ts `ExperimentActions`; `ExperimentShellActions` is an alias):
  - `runKind`: `'compute'` (default; Worker or synchronous computation, the result arrives at the end) or `'animate'` (fixed-rate step-by-step playback, e.g. Ch01 LMS Playground at 350 ms/step, Ch04 Signal Flow at 300 ms/step ≈ 2 min). With `'animate'` the Run button always shows its progress, a "跳到結尾" button appears next to it when `onSkipToEnd` is given (disabled once `progress.done >= progress.total`), and on phones pressing Run scrolls to the results immediately because they change from the first step (compute waits for the result).
  - `progress: { done, total, unit? }`: draws a determinate bar (`role=progressbar`, `aria-valuenow`, `aria-valuetext` = `progressText(progress, runKind)`, e.g. 「112/408 步」) and appends 「（112/408 步）」 to the Run button; compute shows both only while `running`, animate also when stopped halfway (`done > 0`). Without `progress` a running compute shows an indeterminate bar. The unit defaults to 「步」 for animate and none for compute.
  - `onSkipToEnd`: stop the animation and put the cursor/state at the final step. It must reuse the same core as stepping (set the state the stepper would reach, do not write a second fast path), so the final numbers equal the ones reached step by step. Pick `total` so that `done === total` at the final state (steps = states − 1).
  - `ControlGroup({ title, children, defaultOpen?, className? })`: groups controls. With ≤ 12 controls (`CONTROL_COLLAPSE_THRESHOLD`) it is a plain titled block; with more, the whole controls column becomes one `<details>` per group (the first open, the rest collapsed; the user's toggles persist) so a 2–3 screen column gets shorter without an inner scrollbar. Without explicit groups the shell cuts automatically after the first 8 controls (`CONTROL_AUTO_OPEN`, `autoGroupCut`) into 「其餘參數」. Exports: `ControlGroup`, `progressText`, types `ControlGroupProps`, `ExperimentShellActions`, `RunProgress`, `RunKind`.
- Pure export functions:
  - buildExperimentPayload(input, now?) → JSON with keys experiment_id, title, model_level, claim, source, tests, status, seed, input_parameters, units, metrics (name → value), metric_details, warnings, assumptions, cross_check, app_version, git_commit, generated_at (ISO).
  - buildExperimentReportInput(input, { plots?, data?, notes?, now? }); normalizeCrossCheck(cc?)

HOOKS
- useDebouncedValue<T>(value, ms): T
- usePersistentState<T>(key, initial, validate?): [T, setT]. Every storage access is wrapped in try/catch.
- useCases<P>(initial, { seed?, max? }) → { cases: { id: 'A' | 'B' | 'C'; params; seriesIndex; colorVar }[], activeId, active, setActive, update(patch | fn, id?), addCase(): id | null, removeCase(id), reset(params?), seed, setSeed, canAdd }
- randomSeed(), CASE_IDS
- useThemeTokens() → { text, textMuted, border, surface, accent, series[6], ... }; useDocumentTheme(); cssVar(name, fallback); readThemeTokens()

EXPORT UTILITIES
- downloadText(filename, mime, text, { bom? }), downloadBlob
- toCsv(columns): string — header row; shorter columns padded with empty cells; '\n' line endings; RFC 4180 quoting; formula-injection guard.
- csvPreview(columns, maxRows), csvCell
- buildReportHtml(ReportInput): string — standalone HTML with inline CSS; all text escaped; only raster data:image URLs are embedded. Also escapeHtml, isSafeImageDataUrl.
- fmtNum(x, digits=6), fmtWithUnit, toJsonSafe (keeps NaN/Infinity as strings, converts typed arrays, marks circular refs), prettyJson, fileTimestamp, safeFileName
- APP_VERSION, GIT_COMMIT

WORKERS (import from '@/workers')
- useWorkerTask<P, R>(module, fn, opts?: { restartOnRun?; createWorker?; loader? }) → { run(params: P): Promise<R>; cancel(); running; error; lastDurationMs; mode: 'worker' | 'inline' }
- SimWorkerClient({ createWorker?, loader? }) with run<R>(module, fn, params) → { result, durationMs }, cancel(), dispose(), busy, mode
- WorkerCancelledError, isWorkerCancelled(e)
- dispatch(loader, { id, module, fn, params }) → { id, ok: true, result, durationMs } | { id, ok: false, error: { name, message, stack? } }
- collectTransferables(value), serializeError / deserializeError
- createGlobLoader(globMap, prefix?), loadModelModule, availableModelModules()
- sim.worker.ts is the worker entry point. Types: ModuleLoader, WorkerRequest, WorkerResponse, SerializedError.

### 使用注意事項

GENERAL
- 匯入：`import { ... } from '@/components'`、`import { useWorkerTask, isWorkerCancelled } from '@/workers'`；不要深層 import 元件檔。
- `src/components/Showcase.tsx` 是沒有掛路由的示範，用到幾乎所有元件，圖上的每條曲線都由公式算出。
- TeX 是 JS 字串，反斜線要跳脫或用 `String.raw`：`<Tex>{String.raw`w_{n+1}=w_n+\mu e_n x_n`}</Tex>`。
- `<TexBlock id="F-03.1">` 會建立錨點 `#formula-F-03.1`；`MetricTable` 的 `formulaId` 連到這個錨點。
- `Section` 預設是 h3 標題；章節最上層的段落傳 `level={2}`。

PLOT
- Wrap `data` and `layout` in useMemo; every new array causes another Plotly.react call.
- Typed arrays (Float64Array) work for x and y.
- Plotly cannot read CSS variables. Either let the theme colorway pick colors, or use `useThemeTokens().series[i]` (for useCases: `tokens.series[c.seriesIndex]`).
- Axis titles can be plain strings.
- For PSD plots, use xLog: the f = 0 (DC) bin is dropped and a note is shown automatically.
- A Plot inside an ExperimentShell is registered automatically and its PNG goes into the HTML report.

PARAMCONTROL
- 不合法的值會顯示警告而且不會套用，除非傳 `allowOutOfRange`。
- N 與位元數這類整數，`integer` 搭配 `clampOnBlur`。
- `log` 需要 `min > 0`。對數滑桿給 3 位有效數字；打字輸入的值保留完整精度。
- 暫存器或 behavioral 參數名稱放在 `reg`（例如 `'REG_GMAC_N[15:0]'`）。

EXPERIMENTSHELL
- `warnings` 必須說明原因（例如「C ≤ 0：polarity…」），會以 danger callout 顯示。
- 省略 `crossCheck` 時三欄都顯示「Not implemented」；沒有真的算過就不要標 `'ok'`。
- `exportData` 只在使用者匯出時呼叫，可以丟例外（錯誤會就地顯示）。
- `params` 只放小的純量：它們會出現在摘要、JSON 與報告；陣列放在 `exportData`。
- seed 是 uint32；隨機一律用 `createRng(seed)`（core/rng）。

TESTBADGE
- `TestBadge` 在建置時讀 `src/data/verification-status.json`（`npm run verify` 產生），狀態改變後要重新 build 或等 HMR。只有 `'pass'` 才顯示「verified」；`missing` 顯示「pending」。

HOOKS
- `usePersistentState` 的 key 以 `'lmspll.'` 開頭，物件型別要傳 `validate` 型別守衛。
- `useCases` + `CaseSelector` 提供 A/B/C 並排比較，共用同一個 seed。

WORKERS
- 重運算的純函式放在 `src/simulation/models/<name>.ts`，以具名 export 提供，只收一個可 structured clone 的 params 物件，例如 `export function simulateBlockLms(p: BlockLmsParams): BlockLmsResult`。
- 呼叫：`const task = useWorkerTask<BlockLmsParams, BlockLmsResult>('blockLms', 'simulateBlockLms', { restartOnRun: true })`，再 `task.run(p).then(setRes).catch(e => { if (!isWorkerCancelled(e)) setErr(e) })`。
- 回傳新配置的 typed array：它們的 buffer 會被 transfer，在 worker 內就失效了。
- 不要在模組層級保留可變狀態：cancel 會終止並重建 worker。
- params 與結果不可以有函式或 class 實例；inline 後備路徑刻意套用同一套 structuredClone 規則。
- 模組與函式名稱必須是單純的識別字；`*.test.ts` 不在 glob 內。
- 在 jsdom／vitest 下 hook 自動 inline 執行；hook 的測試可傳 `{ loader }` 注入假的模組。

### 設計決定與補充

以下都是補充或收緊；`docs/dev-conventions.md` §2–§3 列出的 API 沒有被刪除。

1. Plot `data` is typed `Plotly.Data[]`. Plotly.Data is already a union of Partial<...> types, so this is the same as `Partial<Plotly.Data>[]`.
2. Plot titles are drawn as HTML above the chart, not inside the Plotly layout. This avoids overlap with the horizontal top legend and the modebar. Exports (PNG, SVG, report) put the title into the layout and use an opaque `--surface` background so dark-theme exports stay readable.
3. Because of point 2, the PNG button is a custom "下載 PNG" button (Plotly.downloadImage with format png) rather than the built-in 'toImage' button.
4. Plot "下載 CSV" exports the original, unfiltered trace data at full precision. Points dropped for log axes are still included.
5. Plot reads theme colors by watching the `data-theme` attribute on `<html>`, not `useSettings().resolvedTheme`. SettingsProvider sets the attribute in a parent effect, and child effects run first, so reading at the theme switch would get the old colors. Mermaid does use `resolvedTheme` as specified.
6. 元件在 `<SettingsProvider>` 外也能運作：退回預設值而不是丟例外。
7. `ParamControl` 另有 `integer`、`allowOutOfRange`、`ariaLabel`、`disabled` 與 `id`。預設情況下，超出範圍的輸入會顯示「超出合法範圍 [min, max]，未套用」，不會傳給 `onChange`；`clampOnBlur` 會在失焦時夾住並套用；`allowOutOfRange` 則放行並顯示「（仍套用；結果僅供探索）」。數字輸入框是 `type="text"` 並設定 `inputMode`，所以能打 `'1e-5'`、`'0.'`；全形數字與 U+2212 的「−」也接受。
8. `ExperimentShell` 另有 `description`、`headingLevel`、`actions.onStop`（執行中時 Run 按鈕變成「停止」）與 `actions.runKind`／`progress`／`onSkipToEnd`（見上方 Run actions）；`crossCheck` 的項目可以是 `{ status, note }`；`exportData` 可以回傳 typed array；presets 可以有 `description`。
9. `MetricRow` 另有 `toleranceMode`（`'abs' | 'rel'`）、`digits` 與 `note`；`value` 可以是字串或 null。
10. JSON 匯出使用規格 §20.3 的 snake_case key；`metrics` 是「名稱 → 數值」的對照，`metric_details` 帶完整的列。
11. `Derivation` 預設只在 Research 模式展開，Beginner 與 Engineer 預設收合；使用者手動切換優先，`defaultOpen` 可覆寫。
12. 約定清單之外的額外項目：`CaseSelector`、`useThemeTokens`／`cssVar`，以及純函式的匯出工具。
13. `Showcase.tsx` 是活的示範，沒有掛路由。

## golden/（Python golden model 與 vectors）

### Public API

PYTHON PACKAGE golden/lms_pll_golden (pure functions; MC functions take np.random.Generator):
- lms: lms_trace(a,w0,x,mu,steps)->LmsTrace{w,e}; lms_closed_form; sign_error_lms_trace; l2_constant_fit/l1_constant_fit; fixed_x_pole(mu,x)=1-mu x^2; fixed_x_mu_bound(x)=2/x^2; classify_pole(p,tol); mean_mu_bound(Ex2); mean_square_mu_bound(Ex2,Ex4)=2Ex2/Ex4; mean_square_factor(mu,Ex2,Ex4); gaussian_moments; mc_moments; mc_mean_square_factor(rng,mu,n,sampler); draw_regressor(rng,n,'gaussian'|'bpsk'|'uniform'); REGRESSOR_MOMENTS.
- comparator: p_plus(s,sigma); mean_q(s,sigma)=erf(s/(√2σ)); kq(sigma)=√(2/π)/σ; bit_to_bipolar(b)=2b-1; direction_prob_clt(m,N); direction_prob_exact(p,N,rule='split'|'strict'); n_for_target_clt(m,target); n_for_target_exact(p,target,parity='odd'|'even',rule); mc_direction_raw(rng,s,sigma,N,trials)->(pos,ties); block_sum_samples(rng,N,p,size)=2·Bin−N; wilson_interval(k,n,z).
- polarity: wrap180; single_tone_corr(A,|H|,phi,Omega,D)=(A²/2)|H|cos(φ+ΩD); polarity_margin_deg; cal_pole(mu,Kq,C)=1−μK_qC; fir_with_response(|H|,phi,Omega)->2-tap FIR; freq_response(b,a,Omega); tone_corr_time_domain(A,h,Omega,D,periods,period_samples); simulate_block_sign_lms_tone(rng,a,w0,mu,sigma,A,h,Omega,n,blocks,delay,polarity)->δ=a−w per block; best_delay; hpd_second_order(w/wn,zeta); corr_from_psd(Sxx,Hfun,D); ar1_psd; ar1_autocorr; corr_fir_ar1_closed.
- stability: cal_pole(g); cal_pm_deg(g)=90−asin(g/2); loop_gain; cal_pm_numeric(g)->(ωc,PM) by root finding; delay_char_poly(g,d); delay_companion; delay_spectral_radius; delay_critical_gain_closed(d)=2sin(π/(4d+2)); delay_critical_gain_numeric(d); simulate_delay_recursion(g,d,steps); dual_loop_matrix(r,b,c,mu); dual_loop_char_poly; spectral_radius; dual_loop_simplified_mu_max=2(1−r)/(bc); dual_loop_full_mu_range_closed->(lo,hi)=(0,(1−r)/(bc)); stable_interval_numeric(rho_fn,lo,hi); combined_matrix(A,B,C,D,mu).
- mimo: corr2(rho); eig_sorted(R)->(desc values, vectors with first nonzero comp >0); cond_number; mean_lms_poles(R,mu); steps_to_decay(p,frac)=ceil(log frac/log|p|); steps_to_decay_real; simulate_mean_lms; windowed_pe(u,N0,k); onehot_with_global_regressors(P); null_space; preconditioner_ideal(R,Kq,γ); preconditioned_var_closed(γ,Kq,N,λ)=γ/(Kq²Nλ(2−γ)); simulate_preconditioned_lms(rng,R,Kq,N,γ,chains,blocks); jacobian_loop_matrix(J,M)=I+MJ; regularized_update_matrix(J,γ,λ)=−γ(JᵀJ+λI)⁻¹Jᵀ; regularized_poles_closed; finite_difference_jacobian(g_fn,w,deltas); simulate_jacobian_loop.
- bias: discrete_moment(values,probs,k); wstar_linearized(a,values,probs,b,d_fn,u_corr); wstar_cubic(a,c,values,probs); least_squares_gain; sign_lms_mean_gmac(w,a,values,probs,sigma,d_fn,b,encoding='bipolar'|'unipolar'); sign_lms_fixed_point(...) (brentq); offset_gain_bias(b,Ex,Ex2); simulate_block_sign_lms_discrete(rng,...,encoding).
- noise: cal_noise_example(mu,sigma_v,C,N,fs,sigma_eta2=1/N)->{k,g,p,sigma_w,f_u}; sigma_w2_closed(mu,σ_η²,p); coef_noise_tf; coef_noise_psd; bw_one_minus_p; bw_neg_ln_p; bw_exact_3db_closed/numeric; enbw_one_sided_closed/numeric; simulate_block_sign_lms_bpsk(rng,dw0,mu,sigma,N,blocks,chains,polarity=±1,record) [exact Binomial reduction for x=±1]; simulate_block_sign_lms_raw (sample level); var_ci_chi2(samples,z); spur_beta(f_out,At); spur_dbc_small_angle; spur_dbc_bessel(beta); coherent_tone_amplitudes; pm_sideband_dbc_fft.
- quantization: TOGGLE_PATTERN_5; nearest_freeze(target,bits)->(code,err); pattern_mean->Fraction; find_period(seq); quantize_nearest/quantize_floor; ef_quantizer_first_order(w_h:Fraction,steps,bits,r_init,rounding)->EfResult{y,r,v} (exact rational); ef_quantizer_float; line_spectrum(pattern); stochastic_rounding(rng,target,n); bernoulli_code_moments(lo,p); accumulator_bits_required(Bx,N); wrap_twos_complement(v,bits); gmac_accumulate(samples,bits,'wrap'|'saturate').
- optimizer: msd_after_blocks(δ0,p,μ,σ_η²,B); simulate_linear_msd(rng,...); mu_interval_corner(Kmin,Kmax,ε,B)->(lo,hi); optimal_mu_final_rms(δ0,K,σ_η²,B)->(μ*,MSD); optimal_budget_split(δ0,K,NB,N_list).

EXPORTER golden/export_vectors.py: build_vectors()->dict[name,vector]; build_index(); dumps(obj); write_all(out_dir); CLI `python3 golden/export_vectors.py [--check] [--out DIR]`.

VECTOR JSON schema: {id, description_zh, spec_section, inputs, expected, tolerance:{abs?,rel?}, tolerance_overrides?:{key:{abs?,rel?}}, notes}; pass iff |actual−expected| ≤ abs + rel·|expected| elementwise; expected values are numbers / (nested) number arrays / {re,im}; no NaN/Inf. Files: T01..T18.json, delay_bounds, comparator_table, quantizer_first_order, preconditioner_variance, msd_after_blocks, negative_tests, index.json (lists all files).

SCRIPT `scripts/verify.mjs`（Node ESM，無相依套件）：`node scripts/verify.mjs [--no-run] [--strict]`（等於 `npm run verify`）。執行 `npx vitest run --reporter=default --reporter=json --outputFile=outputs/vitest-results.json` 與 `python3 -m pytest golden -q --junitxml=outputs/pytest-results.xml`（環境變數 `PYTHON` 可取代 `python3`；兩邊任一邊失敗仍會繼續；先刪掉舊報告），然後寫入 `src/data/verification-status.json`，格式為 `{generatedAt (ISO), commit (git short 或 'uncommitted'), note (沿用舊值), tests: {Txx: {status: 'pass'|'partial'|'fail'|'missing', ts: {passed, failed, names[]}, py: {passed, failed, names[]}}}}`；印出摘要表、未對應 T-id 的測試數與警告；只有某個 T-id 是 `fail` 時結束碼才是 1（`--strict` 另外把未對應的失敗、測試檔載入錯誤、缺少報告也算失敗）。只有 `golden/` 的 pytest 會對應到 T-id；`analysis/sspll/golden` 另外用 `npm run golden:sspll` 跑。

### 使用注意事項

**怎麼被 verify 計入**
- TS 測試命名為 `it('T05: …')`：T-id 要在 `it()` 自己的標題開頭，寫在 `describe()` 不算。Python 測試命名為 `test_T05_…`。
- 每個 T-id 在兩邊各要有至少一個通過的測試，才會顯示 `pass`；只有一邊是 `partial`。

**讀取 vectors**
- 各章的測試以 `readFileSync(join(process.cwd(), 'golden/vectors', 'T13.json'), 'utf8')` 讀取（`process.cwd()` 是 repo 根目錄）；Verification 頁用 `src/pages/verification/golden.ts` 靜態匯入。
- 比對規則：`|a−e| ≤ (tol.abs ?? 0) + (tol.rel ?? 0)·|e|`；列在 `tolerance_overrides` 的 key 用自己的容忍度。
- 整數類的 key（N 門檻、`blocks_95`、`period`、`ef_cycle`）必須完全相同。
- `golden/README.md` §5 有 TypeScript 範例。

**規格歧義與勘誤**：由 golden 測試確認的規格歧義與勘誤（例如 T05 偶數 N 的平手算法、T14 頻寬的四種定義、§13.4 的量化器週期）寫在 `docs/validation.md` 與 `golden/README.md` §6；負面測試的參考數字在 `golden/vectors/negative_tests.json`。

**TS 端的 Monte Carlo**
- 用 `createRng(seed)`，以 ±4 SE 或 Wilson CI 對照 vectors 裡的解析期望值。
- `x = ±1` iid 且 comparator 雜訊為高斯時，`Σq·x` 恰好是 `2·Binomial(N, Φ((a−w)/σ)) − N`，所以 block sign-LMS 的多條鏈可以快速而精確地模擬（對應 `noise.simulate_block_sign_lms_bpsk`）。

### 設計決定與補充

1. **`verify.mjs` 的 T-id 對應比「T\d\d 出現在名稱任何位置」嚴格**，依 `docs/dev-conventions.md` §6：
   - TS 測試只在**它自己的標題**（不含 `describe`）以 `Txx:` 開頭時才計入；也接受 `Txx/Tyy:`、`Txx, Tyy：` 與全形的 `：`。
   - Python 測試只在函式名稱以 `test_Txx_` 開頭時才計入。
   - 原因：用整串名稱比對時，`describe('linalg：規格 T09 / T10 / T18 參考值')` 會把底下每個測試都對應到三個 ID；`Tags.test.tsx` 裡 `TestBadge T02 → partial` 這類 UI 徽章測試也會被誤算成 T02／T03 的數值驗證。
   - 名稱中的 ID 若在 T01–T18 以外（例如 `Tags.test.tsx` 裡的 T99）會被忽略並警告。
2. `verify.mjs` 在要求的 json reporter 旁邊加上 `--reporter=default`，讓主控台顯示進度；JSON 檔路徑不變。另外多了兩個旗標：`--no-run`（只解析 `outputs/` 內既有的報告）與 `--strict`；失敗測試在 `names[]` 裡加上 ` [FAILED]` 後綴；schema 其餘不變，既有的 `note` 會保留。
3. Vector JSON 多了選用的逐 key 欄位 `tolerance_overrides`（給精確整數門檻與混合尺度的 key 用），以及 `golden/vectors/index.json`；必要的 key 與規格一致。
4. Monte Carlo 結果刻意不放進 vectors（TS 與 Python 的 RNG 不同）。vectors 只放確定性的期望值，TS 端要用信賴區間檢查自己的 Monte Carlo。
5. 負面測試掛在相關的 T-id 下，才會被 verify 計入：
   - 錯誤的 0/1 編碼 → T04
   - comparator 極性反轉 → T06
   - code 沒對齊 → T07
   - 缺乏 PE（ρ=1）→ T10
   - GMAC 的 sum 與 average 縮放 → T13
6. 有些延伸檢查掛在 T-id 下，因為它們測的就是那一列自己的聲明：
   - 以 Monte Carlo 驗證 mean-square 上界 → T03
   - 雙迴路簡化範圍與完整範圍 → T09
   - §10.1 的 preconditioner 範例 → T11
   - 一階 EF 量化器的週期 → T16
   - 正則化偽逆的修正 → T18
7. 其他延伸檢查命名為 `test_S<節>_…`（例如 §8.3 delay 界限 d=0..6、§10.1 preconditioned 變異數、§14 E[δ_B²]、§6.2 multi-frequency 判準）或 `test_NEG_…`（定點 overflow、aliasing、PD 與輸出路徑混淆、錯誤公式偵測、gauge freedom、comparator 飽和）。它們沒有 T-id，verify 會報為「unmapped」。
8. `golden/requirements.txt` 列出 numpy、scipy、pytest。

## 後續新增的共用元件（教學用）

- `@/components` 的教學元件：`CodeBlock`（`source` 為 `?raw` 匯入的原始檔、`region` 擷取 `#region core:<name>`、`lang` 'typescript'|'python'、`title`、`path`、`highlight`、`caption`）、`CodeCompare`（`items: {label, source, region, lang, title?, path?, highlight?, note?}[]`、`layout` 'columns'（預設）|'tabs'、`caption`；寬螢幕並排、窄螢幕分頁；行內 `// ← 差異：…` 自動高亮）、`SymbolTable`（`rows: {symbol(TeX), meaning, unit?(TeX), firstSeen?, note?}[]`、`title?`、`caption?`）、`Quiz`（`title?`, `question`, `options?: {label, correct?}[]`, `answer`）、`Recap`（`title?`, `formulas?: {tex, label?, id?}[]`, `points?: ReactNode[]`）、`Prereq`（`title`, `children`, `defaultOpen?`：可展開的先備知識框）、`StepDerivation`（`steps: {tex, why}[]`, `title?`, `result?`：一步一行 + 理由）。
- `src/simulation/models/lms.ts`（Ch00–Ch03 共用）：`conventionalStep / signErrorStep / signSignStep / huberStep`、`STEP`、`runScalarLms`、`sgn(tie)`、`fixedXPole / fixedXMuMax / classifyPole / POLE_BEHAVIOUR_LABEL`、`meanPole / meanSquareFactor / meanSquareMuMax`、`gaussianLyapunov / gaussianAlmostSureMuMax`、`batchOptima`、`lossValue / averageCost`，皆有 `#region core:*` 可直接以 CodeBlock 顯示（regions：sign, huberPsi, conventionalStep, signErrorStep, signSignStep, huberStep, runScalarLms, fixedXPole, meanSquareFactors, batchOptima）。
- 顯示程式碼的寫法：`import lmsSrc from '@/simulation/models/lms.ts?raw'` → `<CodeBlock source={lmsSrc} region="signErrorStep" path="src/simulation/models/lms.ts" />`。Python golden：`import pySrc from '../../../golden/lms_pll_golden/lms.py?raw'`（相對路徑）。

- **字串內的行內公式**：`mathText(node)` / `<MathText>` / `stripMathDelimiters(text)`（`@/components`）。所有共用元件的字串屬性（ExperimentShell title/description/warnings/assumptions/crossCheck note、MetricRow name/note、MetricTable caption、Plot title/caption、Section/Derivation/Callout/Prereq/Quiz/Recap 標題、CodeBlock/CodeCompare title/caption/label/note）都已自動套用：字串中的 `$...$` 會以 KaTeX 顯示（`\$` 為字面金額符號）。JS 字串記得跳脫反斜線或用 `String.raw`。
  - 無障礙名稱（aria-label、title、aria-valuetext、`<option>`）一律用 `accessibleText(text)`（`@/components`；`speech.ts`）：把 `$…$` 轉成可念的文字（`\mu` → 「mu」、`u_2` → 「u 2」），不用 `stripMathDelimiters`（保留 TeX 原始碼，只用在 id、檔名、程式碼與報告）。含數學的 ReactNode 標籤用 `nodeToAccessibleText(node)`／`nodeHasMath(node)`；`ParamControl`／`SelectControl`／`ToggleControl` 的 `ariaLabel` 可直接傳含 `$…$` 的字串，元件自己套用 `accessibleText`。
- 全域樣式已加 `.katex { position: relative }`：寬表格（`.table-wrap`）內的公式不會再把頁面撐出水平捲軸。

- **帶入手算**：`HandCalc({ def, initialMode?, compact? })`、`texNum(x, sig)` / `texNumP(x, sig)`（負數加括號，代入用）、`checkAnswer`、`randomValues(def, seed)`、`defaultValues(def)`（`@/components`）；型別 `HandCalcDef / HandCalcInput / HandCalcStep / HandCalcResult / HandCalcSolution`（`@/data/types`）；彙整 `ALL_HANDCALCS / handcalcById / handcalcsForPage`（`@/app/handcalcs`，以 glob 收集 `src/chapters/*/handcalcs.ts` 與 `src/pages/*/handcalcs.ts` 的 `HANDCALCS`）。範本：`src/chapters/ch00/handcalcs.ts`。ID 格式 `HC-<章>.<序>`；工具頁與案例頁用兩個字母的代號（`HC-CS`、`HC-DB`、`HC-MD`、`HC-PR`、`HC-RM`、`HC-SO`）。

- **系統地圖**：`SystemMap({ focus: SystemBlock[], caption? })`（`@/components`）— 全站共用的 PLL + LMS 校正系統方塊圖，`focus` 的方塊標成藍色。`SystemBlock` = 'ref' | 'pd' | 'lf' | 'vco' | 'div' | 'fcw' | 'dsm' | 'res' | 'gc' | 'dtc' | 'cmp' | 'align' | 'gmac' | 'scale' | 'acc' | 'qnt' | 'noise'。手排的 SVG（三條泳道、連線只走水平／垂直、不交叉），不經過 Mermaid；架構依 `docs/assumptions.md` §2a：DTC 在 reference 輸入端（REF → DTC → PD）、回授只有 divider，LMS 的輸入 `e[n]` 從 PD 輸出分接、用成對的標籤（`SystemMapWire.tag`）接到 comparator；`systemMapModel(focus)` 回傳純資料 `{ blocks: [{ id, title, sub, lane, focused, x, y, w, h }], wires }`（測試檢查本章主角時用），另有 `SYSTEM_MAP_BLOCKS`、`SYSTEM_MAP_WIRES`、`SYSTEM_MAP_SIZE`。
- **方塊圖外框**：`DiagramFrame`（`Mermaid` 與 `SystemMap` 共用）— DOM 為 `figure.c-mermaid > .c-mermaid-frame > .c-mermaid-svg > svg`＋`button.c-mermaid-zoom`（放大檢視）＋`figcaption`；圖還沒畫好時沒有 `.c-mermaid-svg`。外觀由 `mermaidTheme.ts` 統一（配色來自 global.css 的 `--diagram-*`）。
- **符號表位置**：改放章末（Recap 之後），外層 `id="symbols"`；章首只留一行連結。見 teaching-style.md §5、§8（方塊圖規範）。

- **Mermaid 更新**：`Mermaid` 元件會先以 `sanitizeMermaidSource`（`src/components/mermaidSource.ts`）把單獨的 `+`／`-` 標籤換成「＋」「−」，避免 Mermaid 11 畫出「Unsupported markdown: list」；圖說支援 `$...$`；瀏覽器中接近可視範圍才 render（IntersectionObserver），jsdom 中立即 render。測試工具 `@/components/mermaidTestUtils`：`installMermaidSvgShim()`、`renderMermaidForTest(chart) → { svg, text, nodeCount }`（不從 `@/components` 匯出，只給測試用）。

- **圖內數學的 LaTeX（2026-10-11）**：
  - `Mermaid`：雙引號標籤內的 `$...$` 由 KaTeX 排版（`forceLegacyMathML`；前處理 `mermaidMathDelimiters` 會把每個含公式的標籤合併成單一 `$$...$$`，文字包成 `\text{}`、`<br/>` 多行用 `gathered`）。`renderMermaidForTest(chart)` 回傳 `{ svg, text, nodeCount, mathCount }`（`text` 已去掉 MathML 複本；TeX 語法錯誤會讓它丟出例外）。SVG 會加上 `min-width`（自然寬度的 70%，至少 480px，但不超過自然寬度；`withReadableMinWidth`），窄螢幕在容器內橫向捲動。
  - `Plot`：對 `data`／`layout` 自動套用 `applyPlotMath`（`src/components/plotMath.ts`）：`name`／`text`／`title`／`ticktext`／`hovertemplate`／`texttemplate`／`hovertext`／`label` 等欄位裡的 `$...$` 轉成 Plotly pseudo-HTML（`<i>`、`<sub>`、`<sup>`、Unicode 符號）。可用 `plotMath(str)`／`texToPlotly(tex)` 在測試中檢查轉換結果（不應殘留 `\`、`{`、`}`、`$`）。
  - `ParamControl`／`SelectControl`／`ToggleControl` 的 label／hint／unit 與 `MetricRow.unit` 也支援 `$...$`。

## 2026-10-16 新增的共用元件與 app 層（整站改善第一批）

- **ModePicker**（`src/components/ModePicker.tsx`，由 `PageFrame` 掛在每頁頂端）：localStorage 還沒有 `lmspll.mode` 時顯示一次三卡片選擇器；選了就寫入並消失，「先用 Beginner 看看」也會存成 beginner。**第一次造訪的預設模式是 Beginner**（`src/app/settings.tsx`）；測試若依 Engineer 模式斷言，先 `localStorage.setItem('lmspll.mode', 'engineer')`。`PageFrame` 另在章節頁顯示一行目前模式的提示（`MODE_HINT`）。
- **連結元件**（`src/components/links/`，從 `@/components` 匯出）：HashRouter 下 `href="#id"` 會被當成路由，所以站內**不得再寫 `href="#…"`**（`noRawAnchors.test.ts` 會擋）。`<FormulaLink id="F-05.1">` 本頁有該公式就捲過去並把 `?f=` 寫進網址，否則前往 `/formulas?f=`；`<AnchorLink id="handcalc-HC-14.5">` 是頁內錨點版（`?a=`）；`<ChRef ch="05" sec="§5.3">` 是章節交叉參照（`07b` → 案例頁；不存在的章只顯示文字）；`<AnchorDeepLink/>`（`PageFrame` 已掛）讓貼上的 `?f=`／`?a=` 網址在頁面載好後捲到目標。
- **Plot 延後載入**：見上方 Plot 一節（接近可視範圍才載入 Plotly；報告擷圖與列印會強制渲染）。
- **ScrollRegion**（`src/components/ScrollRegion.tsx`）：會橫向捲動的表格／程式碼用它包，內容真的放不下時才成為鍵盤可聚焦的區域（`MetricTable` 與 `CodeBlock` 已用）。
- **app 層**：`src/app/lazyRetry.ts` 在 lazy chunk 載入失敗（部署後舊 hash）時重試一次、再失敗就以 sessionStorage 守門做一次整頁重載；`index.html` 的行內腳本在第一次繪製前就套用 `data-theme`（深色不再閃白）；`Layout` 有 skip link（按鈕，聚焦 `<main id="main">`）、換頁時聚焦 h1 並以 role=status 播報、手機抽屜支援 Esc／scrim／inert；`src/app/navigation.tsx` 提供換頁資訊。
- **即時播報**：`ExperimentShell`（執行中／完成：N 個指標已更新；M 則警告）、`HandCalc`（對答案結果）、`Quiz`（作答結果：答對了／再想想看）各有 sr-only 的 `aria-live` 區。播報文字不放 LaTeX 也不用 Unicode 拼數學（各章的「KaTeX 以外的可見文字」測試會檢查）。
- **審查腳本**：`scripts/screenshots.mjs` 的 `--mode` 預設改為 beginner（和第一次造訪相同）；`scripts/check-bundle-size.mjs` 與 `scripts/verify-status-check.mjs` 在 CI（`.github/workflows/ci.yml`、`verify-status.yml`）使用。

- **PageOutline／BackToTop**（`src/components/PageOutline.tsx`、`BackToTop.tsx`、`PageOutline.css`；`PageFrame` 在頁首之後掛一個，各章不用做任何事）：
  - 目錄項目由頁面裡的 `h2` 自動產生：h2 自己有 id 就用它；沒有就用最近的祖先 `section[id]`（目標是那個 section）；再沒有就依標題文字產生 `h-<slug>`（`slugify`，NFKC、小寫、最長 48 字元，撞名加 `-2`）並寫到 h2 上。模式選擇器、目錄自己與放大檢視裡的 h2 不算；少於 `OUTLINE_MIN_ENTRIES`（3）節的頁面不顯示。
  - 最上面四個捷徑從 `.c-exp`／`.c-handcalc`／`.c-quiz`／`#symbols` 數出來（沒有 id 的元素會補 `exp-1`、`handcalc-1`…）：實驗（N）、手算（N）、思考題、符號表；按一下跳到「目前位置之後的第一個」，到底了回到第一個。
  - 版面由 `article.page[data-outline]` 表示：`'column'`（視窗 ≥ 1672 px，`OUTLINE_COLUMN_MIN_WIDTH` = 側欄 288 + 內容欄 padding 64 + 內容欄 1080 + 間距 24 + 右欄 200 + 捲軸 16）是右側 200 px 的 sticky 欄，含 scroll-spy 與「這一節讀了幾 %」；其餘寬度 `'dock'` 只有右下角的「目錄」鈕（打開底部抽屜，≥ 901 px 是右下角的面板）。內容欄不可低於 1080 px，所以寬度不夠就不擠內容欄。`BackToTop` 在同一個浮動列裡，捲過 1.5 個視窗才出現。
  - 點項目用 `links/anchor.ts` 的 `revealAnchor`（捲過去、展開祖先 `<details>`、聚焦、短暫標示），並用 `replaceState` 把 `?a=<id>` 寫進網址（`AnchorDeepLink` 載入時還原）；`href` 是真的路由網址，中鍵、複製連結都能用。
  - `main [id] { scroll-margin-top: calc(var(--topbar-h) + 16px) }` 現在由 `PageOutline.css` 提供，所有頁內跳轉目標（目錄、`?a=`、鍵盤聚焦）共用，章節與頁面的 CSS **不需要也不應該**再寫自己的 `scroll-margin-top`（第二批已全部刪掉）。
  - 要拍目錄欄的截圖：`scripts/screenshots.mjs --viewport xwide`（1720×950）；一般的 `desktop`（1280）與 `wide`（1600）看到的是 dock。
- **列印**（`src/styles/print.css`、`printPrep.ts`）：一章印出來是隱藏頁面外框（頂列、側欄、目錄、搜尋、浮動按鈕）、強制淺色主題、所有收合內容（`<details>`、推導框、思考題解析）都展開的版本。新增 `position: fixed` 的元素要加 `class="no-print"`（或把 class 加進 `print.css` 的隱藏清單）：`styles.test.ts` 會檢查，漏了測試會失敗。只在螢幕上有用的「↑ 回到章首」按鈕加 `no-print`（`printPrep` 另外用文字比對補標 `data-no-print`，是保險不是規範）。圖是接近可視範圍才畫的，所以 Ctrl／⌘+P 會先送一次 `beforeprint` 讓所有圖開始畫，等到沒有「載入中」的佔位框（最多 `PRINT_WAIT_MS`）才開列印對話框；從瀏覽器選單列印不等，沒畫好的圖印出補救說明。窄欄裡不換行的膠囊（`.ver-chip`、`.models-status`）在 `@media print` 改成可換行，直式紙張才放得下寬表格。
- **站內搜尋**（`src/components/search/`；`Layout` 的頂列放 `<SearchButton>`）：快捷鍵 `/`（正在輸入框、文字區、下拉選單裡時不攔；`/formulas` 自己有 `/` 快捷鍵，列在 `ROUTES_WITH_OWN_SLASH`，也不攔）與 ⌘K／Ctrl+K（面板開著再按一次就關）。面板以 `React.lazy(loadSearchPalette)` 延後載入，索引**沒有建置步驟**，第一次開面板時才由 `buildIndex.ts` 從站上既有的登錄彙整（所以 `search/` 不可 import plotly／mermaid 或任何章節的 `index.tsx`，只能有資料）。
  - `searchCore.ts`（純函式）：`SearchEntry`（`kind`、`id`、`title`、`tex?`、`detail?`、`to`、`haystack`、`el?`、`revealSelector?`）、`makeEntry`、`scoreEntry`（id 完全相同 100、id 開頭 80、id 包含 60、標題開頭 50、標題包含 40、其他 10；多個 token 相加且全部都要符合）、`search(entries, query, perGroup = 8)`（依 公式／章節／實驗 preset／勘誤／術語／手算題 分組；空查詢只列目前這一頁的段落）、`collectPageSections(routePath, root)`（開面板時從 DOM 讀目前這一頁的 h2：有 id 的目標是 `路徑?a=id`，沒有 id 的直接捲到 `el`）。字串正規化沿用公式速查頁的 `normalizeSearch`，所以 `σ_w`、`\sigma_w`、`sigma w` 找得到同一條公式。
  - `buildIndex.ts` 的來源與目標格式：公式 `ALL_FORMULAS` → 該章 `?f=<ID>`（章不在 registry 時 `/formulas?f=`）；章節 `PAGES`＋Dashboard 的 `CHAPTER_META` 一句話摘要與附錄 E 的 15 個問題 → 頁面路徑；preset `ALL_PRESETS` → `presetHref` ＋ `?a=exp-<experiment>`；勘誤 `src/data/errata.json` → `/verification?e=<eid>`；術語 `GLOSSARY` → `/formulas?q=<中文名>`（到了之後由 `revealSelector` 捲到那一列）；手算題 `ALL_HANDCALCS` → 該頁 `?a=handcalc-<ID>`。新增一種可搜尋的內容就在 `buildIndex.ts` 加一個 `…Entries()` 並在 `searchCore.ts` 的 `SearchKind`、`KIND_ORDER`、`KIND_LABEL` 登記。
  - 目標在本頁就直接捲過去（同 `<AnchorLink>`），否則 `navigate(to)`；≤ 600 px 面板是全螢幕的 sheet；≤ 900 px 頂列的搜尋鈕只剩圖示，≤ 359 px 品牌字只留「LMS」。
