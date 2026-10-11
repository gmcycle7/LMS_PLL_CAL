# 基礎模組 API 與使用注意事項（由各模組作者回報彙整）

> 實際程式碼為準；此文件幫助快速找到可用函式。

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

**Randomness**
- Make one root per experiment, `const rng = createRng(seed)`, and give each noise source its own `rng.fork('comparator-noise')`, `rng.fork('dither')`, and so on.
- A fork depends only on the parent seed and the label, never on how many numbers were already drawn. So adding draws in one place does not change other streams.
- `createRng(child.seed)` reproduces a fork exactly. `fork(1)` and `fork('1')` are the same stream.
- Seeds are reduced to 32 bits and fractional parts are dropped.

**Normal distribution**
- normCdf is accurate in both tails. For an upper tail use normSf(z) or normCdf(−z), never 1 − normCdf(z).
- Example: P(q=+1) = normCdf(s/σ), and E[q] = erf(s/(√2σ)) = 2Φ−1.

**Binomial**
- binomSf(k, n, p) gives P(X > k) with full relative precision in the tail.
- For the comparator, the exact P(G_N > 0) is binomSf(floor(N/2), N, p). When N is even, G_N = 0 ties are excluded.
- The CLT formula from spec §5 is normCdf(m·√N/√(1−m²)). Tests check it against the table: 0.5318, 0.5996, 0.7875, 0.9500, 0.9900.
- binomCdf costs O(10·√(npq)) operations, about 0.1 ms at n = 1e6. Avoid n above about 1e8.

**Linear algebra**
- inv and solve throw an Error whose message contains '矩陣奇異（singular）'. Catch it and show the explanation, e.g. λ_min = 0 or no persistent excitation. det never throws; it returns 0 or a tiny value. cond returns Infinity when σ_min is exactly 0.
- eigSym: eigenvalues are sorted descending. Eigenvectors are columns, each with its largest-magnitude component made positive.
  - Example: for R = [[1,.99],[.99,1]] you get values [1.99, 0.01] with columns [1,1]/√2 and [1,−1]/√2.
  - eigSym throws if the input is clearly asymmetric; use eigvals for general matrices.
- eigvals(A)[0] is the dominant eigenvalue, and spectralRadius(A) = |eigvals(A)[0]|. Stability means spectralRadius < 1.
- Complex eigenvalues and roots come out as exact conjugate pairs.
- pinvReg(A, λ) is the regularized preconditioner, (R+λI)⁻¹-style.

**Polynomials**
- Coefficients are in descending powers. The update-delay characteristic equation z^{d+1} − z^d + g becomes `polyRoots([1, -1, 0, g])` for d = 2.
- Leading zeros are stripped, and trailing zeros become exact roots at z = 0.
- A repeated root of multiplicity m is only accurate to about ε^{1/m} (about 1e-5 for a triple root), which is unavoidable.

**Statistics**
- variance and std default to ddof = 1.
- meanCI uses Student-t and assumes iid samples. With correlated noise, compute effectiveSampleSize first.
- meanCI returns NaN half-width when n < 2.
- wilsonCI is for success-rate confidence intervals such as P(correct direction).
- autocorr is biased and normalized (same as statsmodels acf with adjusted=False). A constant series returns all NaN.
- histogram follows np.histogram: the last bin includes the right edge, and values outside `range` are counted in `.outside`.

**Units and formatting**
- fmtSI adds SI prefixes only for these units: s, Hz, rad, rad/s, V, A, W, F, H, Ω, J, S, C. Examples: fmtSI(976562.5, 'Hz') gives '976.6 kHz'; fmtSI(1.5e-12, 's') gives '1.5 ps'.
- Units that already carry a scale are printed as-is: 'fs', 'dB', 'dBc', 'dBc/Hz', 'LSB', '%'. For example fmtSI(0.399, 'fs') gives '0.399 fs'.
- fmt switches to exponent form when |x| ≥ 1e6 or |x| < 1e-4 (e.g. '1.235e6', '7.979e-5') and drops trailing zeros.
- Convert time to phase only with fsToRad(tFs, fOutHz) and radToFs, never with a hand-written 1e-15. Example: fsToRad(0.5, 13e9) = 4.0841e-5 rad, and 20·log10(β/2) = −93.80 dBc.
- wrap180 maps to (−180, 180], so wrap180(−180) = 180.

**Complex**
- cToString(z) gives text like '0.9 + j0.4796' for tables.

**Cross-cutting**
- Nothing in core imports React or the DOM, so it is safe to use in Web Workers.
- No matrix function mutates its input.

### 與約定的差異

No API in the conventions was left out or changed. Differences and additions:

1. **Wider input types.** Many functions take ArrayLike<number> where the contract says number[], so a Float64Array works too.

2. **Extra exports.** These were added beyond the contract:
   - rng: uniformArray, uint32, deriveSeed, normalizeSeed, seedState, xoshiro128ss
   - special: erfcx, normSf, betaIncRegPair, binomSf, studentT*
   - linalg: luDecompose, cholesky, pinv, rank, dot/norm2/outer/normFro/diag/clone/isSymmetric, sortByModulusDesc
   - poly: polyTrim/polyDer/polyMul/polyAdd/polyFromRoots/polyResidual/ratvalC
   - stats: sum, minMax, quantiles, median, effectiveSampleSize, covariance, correlation
   - units: fromDb10/20, wrapPi, fsToRad/radToFs, isSiPrefixable
   - complex: cAbs2/cSqrt/cExp/cLog/cIsClose/cToString, all appended without touching existing exports

3. **Orders and shapes the contract left open:**
   - eigvals and polyRoots sort by |z| descending; ties go real-part descending, then imaginary descending, so the +j root of a conjugate pair comes first.
   - svd returns the thin SVD (k = min(m, n)).
   - histogram also returns `centers` and `outside`.
   - meanCI and wilsonCI return objects (fields listed in public_api); wilsonCI's level defaults to 0.95.

4. **Standard normal only.** normPdf, normCdf and normInv take no mean or σ arguments. Use normCdf((x − μ)/σ).

5. **pinvReg is computed through the SVD** as V diag(σ/(σ²+λ)) Uᵀ, not by inverting AᵀA+λI. For λ > 0 this is mathematically identical, and tests confirm it against the direct formula. For λ = 0 it becomes the Moore–Penrose pinv.

6. **Accuracy beyond the minimum requested:**
   - binomPmf uses Loader's saddle-point method with n·p and n·q held as double-double.
   - betaIncReg's prefactor uses the same saddle-point form.
   - eigvals uses EISPACK balancing with permutation, so triangular, defective and nilpotent matrices give exact eigenvalues.

7. **T-id test names.** Tests named T04 (special.test.ts), T09 (linalg.test.ts and poly.test.ts), T10 and T18 (linalg.test.ts) exist in core, because these reference values are pure math claims. scripts/verify.mjs will count them alongside any chapter tests with the same IDs.

8. **Display minus sign.** fmt and cToString use the ASCII '-' and show infinity as '∞' / '-∞'.

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

- Import from '@/simulation/signal'. The functions are pure, with no React or DOM, so they are safe to call in a Web Worker.
- Coefficient conventions:
  - Discrete-time filters (lfilter, StreamFilter, freqz, impulseResponse) take b and a as ascending powers of z^-1. This is the opposite of core/poly.ts, which uses descending polynomials.
  - freqs and the inputs to bilinear take descending powers of s.
  - freqz takes Ω in rad/sample (Ω = 2πf/fs). Use freqzHz(b, a, fHz, fs) to pass Hz instead.
  - For block-rate loops, use f_u, not f_s, as the sample rate.
- Example: discretise the PD transfer from validation E44 with
  const { b, a } = bilinear([1, 0, 0], [1, 2*zeta*wn, wn*wn], fs)
  then const pd = new StreamFilter(b, a) and call pd.step(x) once per sample.
- PSD conventions:
  - welch and periodogram default to a one-sided density PSD in x²/Hz. DC and Nyquist bins are not doubled.
  - Σ psd·df is the total power. integratePsd(f, psd, fL, fH) gives σ² over a band; for example, a time-error PSD in s²/Hz integrates to jitter² in s².
  - Phase noise: L = psdToDbcHz(S_phi_onesided).
  - If you have a DTFT-form PSD, where σ² = (1/2π)∫S dΩ, convert it with dtftPsdToOnesided(S, fs) first. Skipping this shifts L(f) by 10log10(fs/2) (validation E28).
  - Per dev-conventions §5, every PSD plot must be labelled with window, nperseg, ENBW, one-sided/two-sided and units. All of these are fields on PsdResult (window, nperseg, nSegments, enbwHz, onesided, units, df). Show PsdResult.warnings in the UI.
- Spur and tone measurement (spec §15.5) has three modes:
  - Whole-record FFT: periodogram(x, fs, { window }). With scaling: 'spectrum', a coherent tone reads A²/2 in its bin.
  - Welch PSD: welch(...).
  - Coherent tone measurement: toneFit(x, fs, f0) returns amplitudePeak (peak, not RMS), phase (x ≈ A cos(2πf0 n/fs + φ)) and rmsResidual. Use toneFitMulti for the 90/110 kHz sideband pair.
  - For an SSB spur in dBc from a phase tone fit, use 20log10(A_peak/2), which equals psdToDbcHz(A²/2).
- findTones is approximate and depends on the window. Tone power is the sum of PSD bins over the main lobe times df (lobe capped at lobeHalfWidthBins: default 4, which suits Blackman-Harris; Hann needs only 2; scale it up when zero-padding). Raw periodograms produce false peaks of 10–20 dB prominence. Use Welch plus minProminenceDb ≥ 15–20, and use toneFit when the frequency is known.
- xcorr sign convention: R[ℓ] = mean_n x[n-ℓ]·y[n]. A positive lag means y lags x, so if y is x delayed by D samples, the peak is at ℓ = +D. The signal is not de-meaned for you, the mean is over overlapping samples only (count in counts), and NaN means there is no overlap.
- lfilter supports segmented filtering: pass zf back in as zi. StreamFilter produces bit-identical output to lfilter. lfilterZi(b, a) scaled by x[0] removes the start-up transient.
- Windows default to periodic. Use hann(n, true) for symmetric FIR design.
- Measured performance in Node:
  - welch on 1M samples with nperseg 4096: about 28 ms.
  - fft of 2^20 points: about 78 ms.
  - First Bluestein call on a 1,000,003-point prime length: about 0.5 ms per… about 0.5 s, mostly building the plan, which is then cached.
  - toneFit on 1M samples: about 0.1 s.
  - Put anything longer than about 1M samples in a Worker.
- I suggest no changes to shared code. One small inconsistency: `core/stats.autocorr` (owned by core) may use a different normalisation from xcorr. Chapter text should name which one it uses.

### 與約定的差異

1. The task text and the conventions write welch's detrend option two ways ('constant' vs 'mean'). Both are accepted and treated as the same thing. The result reports 'constant'. I also added 'linear', 'none' and false.
2. bilinear differs from SciPy in one degenerate case. When the leading digital numerator coefficient is ≤ 1e-14, SciPy's normalize() drops it (and warns). In z^-1 form that shifts the filter one sample early. I keep the full-length numerator, which is the mathematically correct filter. This only happens when the analog numerator has a zero at exactly s = K. It is documented in JSDoc. In every tested case the results match SciPy to 1e-12.
3. I added these extras beyond the dev-conventions §4 listing; they are additive and break no listed signature:
   - Results: PsdResult also carries scaling, fs, df, enbwBins, noverlap, nfft, nSegments, unusedSamples and warnings.
   - Options: a scaling: 'spectrum' option.
   - Functions: toneFitMulti, lfilterZi, freqzHz, dtftPsdToOnesided, fftReal, fftfreq, rfftfreq, fftshift, isPow2, getWindow.
   - On StreamFilter: process(), getState() and setState().
   - xcorr also returns counts.
4. Two-sided PSD output uses fftfreq order (0, positive frequencies, negative frequencies), the same as SciPy. Call fftshift before plotting it or passing it to integratePsd.
5. Within the signal folder I import sibling files through the '@/simulation/signal/...' alias, as the task asked. From core I import only '@/simulation/core/complex'.
6. testSignals.ts is a non-test helper file used only by the tests. It is not exported from the barrel.

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

**Units and conventions**
- Ω is always rad/sample on the comparator rate f_s. Never substitute Ω into ctHpd or ctT (E44). For DT phase and polarity work, use designDtLoop with loopFreqResponse, or errorPathTransfer with freqz.
- The §6.1 example is ctHpd(0.3, {zeta: 0.7, wn: 1}), which returns −0.0815 + j0.0376. The DPLL phases from E44 are reproduced in pll.test.ts.

**Worker usage**
- errorPathFilter and createHpdFilter return objects with methods, so they cannot cross a worker boundary. Send errorPathTransfer(spec), which returns {b, a}, or designDtLoop(spec) instead.
- To run a config in the worker: SimWorkerClient.run('blockLms', 'runBlockLms', partialConfig). Missing fields take the §15.3 defaults, and invalid input throws a Traditional Chinese multi-line Error.
- Validate JSON in the UI with parseBlockLmsConfig(text) and show errors[] verbatim.
- Do not mutate DEFAULT_BLOCK_LMS_CONFIG; spread it or use structuredClone.

**Correlation helpers**
- corrFromPsd expects a two-sided DTFT PSD where σ² = (1/2π)∫S dΩ. This is not Welch's one-sided x²/Hz; convert with dtftPsdToOnesided (E28).
- A grid starting at 0 is treated as [0, π] with even symmetry.
- For a single tone, corrSingleTone already applies the doubled formula at Ω = 0 or π (E46).

**Result shapes and how to read them**
- Block-level series:
  - blocks.w has length num_blocks + 1, with w[0] = w0.
  - Block k uses wPhys[max(0, k − d)], where d is the update delay.
  - G is the average G (dimensionless), or the sum in sum mode.
- Metrics:
  - All metrics use the last half of blocks.
  - settlingBlock is null if the run never stays inside the 4σ band.
  - NaN means not defined, for example sigmaWPred when the loop is unstable or σ_v = 0. JSON.stringify turns NaN into null, so handle that when exporting reports.
- Analytic gains:
  - analytic.K is the per-sample average-G slope K_q·C, halved for the unipolar bug.
  - analytic.g additionally includes ×N in sum mode.
  - pmDeg = 90° − (2d+1)·asin(g/2).
  - f3dbHz and enbwHz are given only for d = 0, and NaN where E27 says no −3 dB point exists.
- Fixed points:
  - wStarMeanField is the exact Gaussian-noise mean-field fixed point for the actual code sequence and path (E01/E03 aware). It is different from wStarLinear, the MSE-like linearised value.
  - Use metrics.biasPred against metrics.bias for the Analytic vs Monte Carlo cross-check, and metrics.sigmaWRatio for σ_w.
- Warnings:
  - The required warning phrases are emitted verbatim: 'C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散', 'g ≥ 2：一階模型不穩定' and 'gm_mode=sum 時有效增益放大 N 倍'.
  - Warnings are also emitted for: C ≈ 0, update-delay instability, σ_v = 0, H_PD(1) = 0 DC suppression (E03), predicted bias, Ĥ ≠ H, LSB much larger than σ_w, saturation and wrap events, and limit-cycle behaviour.
  - Pass all warnings to ExperimentShell.

**Fixed-point lab and code sequences**
- quantize_physical = true is the L5 model. limitCyclePeriod and limitCycleCount are computed only in that mode.
- For example, σ_v = 0, a = 3.05, μ = 0.05 gives a period-2 toggle between 3.0 and 3.125 fs with mean 3.0625 instead of 3.05. This is a good §13 demonstration.
- To plot the exact code the Lab uses, call generateCodePattern({pattern, length, seed, normalization}). runDsm uses a different dither stream; it is seeded with createRng(seed).fork('dsm-dither').
- DSM residue units are T_vco (VCO periods): residue = Σ(y − in/M), exactly bounded. First-order residue lies in (−1, 0] with zero initial state; MASH has |r| < 2.
- PSD plots: dsmSpectra and analyzeDsm return PsdResult objects whose window, nperseg, ENBW, one-sided flag and units fields satisfy the §5 labelling rule.

**T-ids and performance**
- T-ids covered with 'Txx:' test titles: T06 and T07 (pll.test.ts and blockLms.test.ts) and T13 (the blockLms Monte Carlo test).
- runBlockLms costs about 35 ns per sample. Pass record.sample_trace_blocks: 0 for sweeps and Monte Carlo runs. Each Monte Carlo run re-does the normalisation pre-scan, which is about 0.1 s for 8M samples.

### 與約定的差異

1. **MASH 1-1-1 slope.** The task asked for about 40 dB/dec at low frequency for y − frac. That is mathematically wrong: y − in/M = −(1−z⁻¹)³·s3/M, so the slope is 60 dB/dec. The DTC phase residue (the accumulated error) is −(1−z⁻¹)²·s3/M, which is 40 dB/dec. Python confirms 59.7 and 39.8 dB/dec, and the tests assert these correct values.

2. **DT loop method.** I chose the direct DPLL difference equation from validation.md E44 as the default: L(z) = (Kp + Ki/(1−z⁻¹))·z^{−(1+d)}/(1−z⁻¹), with Kp = 2ζω_nT_s and Ki = (ω_nT_s)². The loop delay is explicit and h_PD[0] = 1. A bilinear (Tustin) variant is available as an option for comparison.

3. **Comparator noise generator.** blockLms draws its noise with a local Ziggurat built on rng.uint32() from createRng(seed).fork('comparator-noise'), not rng.normal().
   - rng.normal() costs about 35 to 50 ns per sample and dominated run time; the Ziggurat makes the whole run about twice as fast.
   - It is still fully seed-determined, and it is validated by KS, moment and tail tests.
   - Suggest moving it to core/rng.

4. **Sum mode with the average-mode μ (g = 326.8, pole −325.8).** The simulated w does not diverge numerically, because sign-LMS has |G| ≤ N. It settles into a bounded period-2 oscillation of tens of thousands of fs. The test asserts that behaviour, the analytic instability and a dedicated warning instead of numeric divergence. Divergence detection (|w| > 1e12 fs) is still there as a safety net.

5. **unipolar_unmapped_bug.** With a zero-mean code (the default iid ±1), the bug only halves the gain; σ_w and the fixed point are unchanged. The bias shows up only when E[x_ref] ≠ 0. The negative test therefore uses a Gaussian code with mean 0.5 and normalisation 'none'. The result is w* ≈ 63.23 fs instead of 3 fs, which Python's mean-field confirms.

6. **Schema extensions.**
   - **code_normalization:** adds 'standardize'. 'unit_rms' scales so that E[x²] = 1 without removing the mean, which keeps the §11.1 offset effect visible. Statistics are taken over the whole record.
   - **gain_register:** adds lsb_fs (default 0.125 fs, per E13's gain_lsb_fs) and signed (default false). When quantize_physical is false, no register quantisation is applied at all. When it is true, the same rounding mode applies to both the update increment and the physical code.
   - **Regressor modes:** the raw regressor mode ignores gm_code_delay_samples and warns. In filtered mode the delay D applies to u_f.
   - **filtered_x_model:** {path: 'same_as_path' | errorPath, gain_mismatch, extra_delay_samples}.
   - **Pattern parameters:** the DSM patterns take {frac, bits, dither, signal: 'residue' | 'quant_error', initial_state}. The gaussian pattern takes an ar1 parameter.
   - **New fields:** an 'iir' error-path kind, and a mode field (free string).

7. **Error-path params key style.** The error-path parameter keys in pll.ts use snake_case (magnitude, phase_deg, omega, taps, pole, wn_ts, zeta, loop_delay, method, b, a). They are the same keys as the JSON's pll_error_path.parameters, so a config can be passed straight through. Everything else in pll.ts is camelCase.

8. **DSM dither definition.** An LSB dither d ∈ {0, 1} is added to the stage-1 input, so the mean shifts by half an LSB (fracEff = (K+½)/M). The residue is measured against the dithered input, so it stays exactly bounded.

9. **Suggested moves to shared code (I did not touch it):**
   - Ziggurat normal → core/rng
   - detectPeriod and psdSlopeDbPerDecade → signal
   - codeStats / streaming statistics → core/stats

## src/components（@/components）與 src/workers（@/workers）

### Public API

Import everything from '@/components'. Importing it also loads components.css.

MATH / DIAGRAMS
- Tex({ children: string }) and TexBlock({ children: string; id?: string; label?: ReactNode }). TexBlock uses display mode and shows the "(F-x.y)" badge; the DOM anchor is id="formula-F-x.y". Both are memoized.
- renderTex(src, displayMode): string
- Mermaid({ chart: string; caption?: string; ariaLabel?: string }). Loads mermaid lazily with securityLevel 'strict'. Renders are queued one at a time with unique ids. It re-renders when the theme changes ('dark' or 'default'). A parse error shows a danger callout.

PLOT
- Plot({ data: Plotly.Data[]; layout?; config?; height?=320; title?; csvName?; xLog?; yLog?; caption?; ariaLabel?; className? })
  - Lazy-loads Plotly, updates with Plotly.react, resizes via ResizeObserver, and calls Plotly.purge on unmount.
  - Modebar: zoom, pan, zoom in/out, autoscale, reset, plus 下載 PNG / 下載 SVG / 下載 CSV.
  - xLog/yLog drop ≤0 points and show "已略去 N 個 ≤0 的點（log 軸）".
- loadPlotly()
- PlotRegistryProvider({ registry?, children }), createPlotRegistry() → { register, captureAll(): Promise<{ plots: { title, dataUrl }[]; failed: string[] }>, size }, usePlotRegistry()
- Pure helpers: filterLogData(data, xLog, yLog) → { data, dropped }; buildThemedLayout(tokens, { height, xLog?, yLog?, layout? }); buildExportLayout(layout, tokens, title?); tracesToColumns(data) → CsvColumns; mergeDeep(a, b)

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
- ExperimentShell(props): { id; title; level; claim?; source?='illustrative'; tests?; description?; assumptions: string[]; controls; children; params: Record<string, unknown>; seed?; onSeedChange?; units?; metrics?: MetricRow[]; warnings?: string[]; crossCheck?: { analytic | monteCarlo | fixedPoint: CheckStatus | { status, note? } }; actions?: { onReset?, onStep?, onRun?, onRunToConvergence?, onStop?, onFreeze?, running?, frozen? }; exportData?: () => Record<string, ArrayLike<number | string | null>>; presets?: { name, params, description? }[]; onLoadPreset?(p); headingLevel? }
  - CheckStatus = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'
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

Note for whoever relays this to the user: the browser pane was used for visual checks. A tab the user had opened (a ChatGPT share page) became active during testing. I did not interact with it and did my checks in my own background tab, which I closed at the end.

GENERAL
- Import with `import { ... } from '@/components'` and `import { useWorkerTask, isWorkerCancelled } from '@/workers'`. Do not deep-import component files.
- src/components/Showcase.tsx is an unrouted example that uses almost every component. Every curve in it is computed from a formula.
- TeX is a JS string, so escape backslashes or use String.raw: <Tex>{String.raw`w_{n+1}=w_n+\mu e_n x_n`}</Tex>.
- <TexBlock id="F-3.1"> creates the anchor #formula-F-3.1. MetricTable `formulaId` links to that anchor.
- Section defaults to an h3 heading; pass level={2} for top-level chapter sections.

PLOT
- Wrap `data` and `layout` in useMemo; every new array causes another Plotly.react call.
- Typed arrays (Float64Array) work for x and y.
- Plotly cannot read CSS variables. Either let the theme colorway pick colors, or use `useThemeTokens().series[i]` (for useCases: `tokens.series[c.seriesIndex]`).
- Axis titles can be plain strings.
- For PSD plots, use xLog: the f = 0 (DC) bin is dropped and a note is shown automatically.
- A Plot inside an ExperimentShell is registered automatically and its PNG goes into the HTML report.

PARAMCONTROL
- An illegal value shows a warning and is not applied unless you pass allowOutOfRange.
- Use `integer` together with `clampOnBlur` for N and bit counts.
- `log` needs min > 0. The log slider gives 3 significant digits; typed values keep full precision.
- Put the hardware register or behavioral parameter name in `reg` (e.g. 'REG_GMAC_N[15:0]').

EXPERIMENTSHELL
- `warnings` must explain the cause (e.g. "C ≤ 0：polarity…"); they render as danger callouts.
- If you omit `crossCheck`, all three columns show "Not implemented". Do not claim 'ok' unless it is actually computed.
- `exportData` is called only when the user exports. It may throw; the error is shown inline.
- Keep `params` to small scalars: they appear in the summary, JSON and report. Put arrays in `exportData`.
- Seeds are uint32. Use createRng(seed) from core/rng once it exists.

TESTBADGE
- It reads src/data/verification-status.json at build time, so status changes need a rebuild or HMR. Only 'pass' displays "verified". At the moment T01 and T02 show 'partial'.

HOOKS
- Prefix usePersistentState keys with 'lmspll.' and pass a validate type guard for objects.
- useCases + CaseSelector give paired A/B/C comparisons with a shared seed.

WORKERS
- Put a heavy pure function in src/simulation/models/<name>.ts as a named export that takes one structured-cloneable params object, for example `export function simulateBlockLms(p: BlockLmsParams): BlockLmsResult`.
- Then call it: `const task = useWorkerTask<BlockLmsParams, BlockLmsResult>('blockLms', 'simulateBlockLms', { restartOnRun: true })` and `task.run(p).then(setRes).catch(e => { if (!isWorkerCancelled(e)) setErr(e) })`.
- Return freshly allocated typed arrays. Their buffers are transferred and become detached in the worker.
- Do not keep module-level mutable state: cancel terminates and recreates the worker.
- No functions or class instances in params or results; the inline fallback deliberately enforces the same structuredClone rules.
- Module and function names must be plain identifiers. *.test.ts files are excluded from the glob.
- Under jsdom/vitest the hook runs inline automatically. In hook tests, pass `{ loader }` to inject fake modules.

SUGGESTED FOLLOW-UP (outside my ownership)
- vitest warns that `environmentMatchGlobs` is deprecated (vite.config.ts); consider migrating to `workspace`.

### 與約定的差異

All of these are additions or tightening; none of the APIs in dev-conventions.md §2–§3 were removed.
1. Plot `data` is typed `Plotly.Data[]`. Plotly.Data is already a union of Partial<...> types, so this is the same as `Partial<Plotly.Data>[]`.
2. Plot titles are drawn as HTML above the chart, not inside the Plotly layout. This avoids overlap with the horizontal top legend and the modebar. Exports (PNG, SVG, report) put the title into the layout and use an opaque `--surface` background so dark-theme exports stay readable.
3. Because of point 2, the PNG button is a custom "下載 PNG" button (Plotly.downloadImage with format png) rather than the built-in 'toImage' button.
4. Plot "下載 CSV" exports the original, unfiltered trace data at full precision. Points dropped for log axes are still included.
5. Plot reads theme colors by watching the `data-theme` attribute on `<html>`, not `useSettings().resolvedTheme`. SettingsProvider sets the attribute in a parent effect, and child effects run first, so reading at the theme switch would get the old colors. Mermaid does use `resolvedTheme` as specified.
6. Components work outside `<SettingsProvider>`: they fall back to defaults instead of throwing.
7. ParamControl adds `integer`, `allowOutOfRange`, `ariaLabel`, `disabled` and `id`. By default an out-of-range typed value shows "超出合法範圍 [min, max]，未套用" and is not passed to onChange. `clampOnBlur` clamps and applies it on blur; `allowOutOfRange` passes it through with "（仍套用；結果僅供探索）". The numeric input is type="text" with inputMode set, so values like '1e-5' and '0.' can be typed. Full-width digits and U+2212 '−' are accepted.
8. ExperimentShell adds `description`, `headingLevel` and `actions.onStop` (when running, the Run button becomes 停止). `crossCheck` entries may be `{ status, note }`. `exportData` may return typed arrays. Presets may have a `description`.
9. MetricRow adds `toleranceMode` ('abs' | 'rel'), `digits` and `note`. `value` may be a string or null.
10. The JSON export uses the snake_case keys from spec §20.3. `metrics` is a name → value map, and `metric_details` carries the full rows.
11. Derivation opens by default only in research mode; beginner and engineer start collapsed. A manual toggle overrides this.
12. Extras not in the original list: CaseSelector, useThemeTokens/cssVar, and the pure export functions.
13. Showcase.tsx is a living demo and is not routed. The temporary preview HTML used for browser testing was deleted.
14. No files outside src/components/** and src/workers/** were changed.

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

SCRIPT scripts/verify.mjs (Node ESM, no deps): `node scripts/verify.mjs [--no-run] [--strict]`. Runs `npx vitest run --reporter=default --reporter=json --outputFile=outputs/vitest-results.json` and `python3 -m pytest golden -q --junitxml=outputs/pytest-results.xml` (PYTHON env var overrides python3; continues if either fails; deletes stale reports first), writes src/data/verification-status.json with the existing schema {generatedAt ISO, commit (git short or 'uncommitted'), note (preserved), tests:{Txx:{status:'pass'|'partial'|'fail'|'missing', ts:{passed,failed,names[]}, py:{passed,failed,names[]}}}}; prints summary table + unmapped-test counts + warnings; exit 1 iff any T-id is 'fail' (or, with --strict, any unmapped failure / suite load error / missing report).

### 使用注意事項

HOW TO GET COUNTED BY VERIFY: name a TS test `it('T05: …')`. The T-id has to start the it() title itself; putting it in a describe() does not count. Python tests use `test_T05_…`. Each T-id needs at least one passing test on both sides to show 'pass'.

READING VECTORS (e.g. in src/tests/golden.test.ts):
- Path: `new URL('../../golden/vectors/T13.json', import.meta.url)` with readFileSync.
- Comparison: |a−e| ≤ (tol.abs ?? 0) + (tol.rel ?? 0)·|e|. A key listed in `tolerance_overrides` uses its own tolerance.
- Integer keys (N thresholds, blocks_95, period, ef_cycle) must match exactly.
- golden/README.md §5 has a TS snippet.

SPEC FINDINGS, all confirmed numerically (please reflect them in the chapters):
- T14 (bandwidth): "約 12.9 kHz" only fits two of the four definitions.
  - Fits: −ln(p)/(2π)·f_u = 12.924 kHz and the exact discrete-time −3 dB of μ/(z−p) = 12.931 kHz (cos Ω = (1+p²−2(1−p)²)/(2p)).
  - Does not fit: (1−p)/(2π)·f_u = 12.401 kHz, i.e. 12.4 kHz, even though the spec writes both approximations as ≈.
  - Does not fit: one-sided ENBW = f_u(1−p)/(2(1+p)) = 20.29 kHz ≈ (π/2)·f_3dB.
  - p = 0.9202115439197135; f_u = 976562.5 Hz.
- T05 (ties when N is even): the spec never says how to count G_N = 0.
  - The CLT table (53.2/60.0/78.8/95/99%) matches the exact binomial when ties count half, or when N is odd.
  - Counting only strict G_N > 0 gives 49.2% at N=100, so it does not match the table.
  - At N=42500: CLT 0.950005, split 0.950002, strict 0.949501.
  - Exact thresholds for 95%: odd N=42499, even-split N=42500, even-strict N=42750. The CLT continuous solution is 42497.29; for 99% it is 85007.26 (odd exact 85011).
- §5: E[q] = erf(0.01/√2) = 0.0079787126, while K_q·s = 0.0079788456 (relative difference (s/σ)²/6).
- T13: σ_w = 0.3991861 fs and p = 0.92021154. With x = ±1 the exact σ_η² is (1−m²)/N, not 1/N; the difference is negligible here. A Monte Carlo of the real block sign-GMAC agrees.
- §10.1: "反矩陣元素約 ±25" refers to M = 0.5R⁻¹ (25.126 / −24.874). R⁻¹ itself is about ±50.
- §13.4 / T16 (first-order error-feedback quantizer on a constant 32.4):
  - With round-to-nearest and r[−1]=0 the output has period 5: [32,33,32,33,32], with r cycling 0.4, −0.2, 0.2, −0.4, 0.
  - This is a cyclic shift of the spec's pattern. Floor quantization gives exactly [32,32,33,32,33].
  - A constant 32+p/q (lowest terms) gives period q.
  - Implement it in exact or fixed-point arithmetic so floating-point error cannot flip a rounding tie.
- T16 spectral lines: |DFT|/5 at f_toggle/5 is (√5−1)/10 = 0.1236 LSB; at 2f_toggle/5 it is (√5+1)/10 = 0.3236 LSB.
- T12 (sign-LMS): with finite σ the sign-LMS fixed point is 1.34 + 3.456e−4/σ² (from the erf third-order term), not exactly 1.34.
- §8.3: g_crit = 2 sin(π/(4d+2)) is verified for d = 0..6 by root finding. The critical root lies at angle π/(2d+1).
- §8.4: simplified range 0<μ<2(1−r)/(bc) = 2; full range 0<μ<(1−r)/(bc) = 1 (Jury).
- §3 uses δ = w−a while §0 uses δ = a−w; the poles are the same.

NEGATIVE-TEST REFERENCE NUMBERS (negative_tests.json):
- Reversed polarity: pole = 1 + μK = 1.0797885.
- Sum-mode GMAC without the /N: g is multiplied by N (326.8 for N=4096).
- Wrong 0/1 encoding: at w = a the mean update is E[x]/2. With a DC code {−1…1.5} the fixed point moves by +41.27 fs.
- Code misalignment with φ=0, Ω=π/6, D=4: C_D = −0.25.
- 6-bit × 4096 GMAC needs 18 bits; a 17-bit register wraps 126976 → −4096 and flips the sign.

MONTE CARLO IN TS: use createRng(seed) and compare against the vectors' analytic expected values with ±4 SE or a Wilson CI.
- For x = ±1 iid with Gaussian comparator noise, Σq·x is exactly 2·Binomial(N, Φ((a−w)/σ)) − N. That is a fast exact way to simulate block sign-LMS chains (noise.simulate_block_sign_lms_bpsk).

SUGGESTED ADDITION TO SHARED CODE: a TS `compareToGolden(vector, key, actual)` helper in src/tests/ implementing the tolerance rule above.

### 與約定的差異

1) T-id matching in verify.mjs is stricter than "regex T\d\d anywhere". I follow docs/dev-conventions.md §6 instead:
   - a TS test counts only when its own title (not the describe) starts with `Txx:`. `Txx/Tyy:`, `Txx, Tyy：` and full-width `：` are also accepted.
   - a Python test counts only when its function name starts with `test_Txx_`.
   - Reason: with whole-name matching, `describe('linalg：規格 T09 / T10 / T18 參考值')` mapped every child test to all three IDs. UI badge tests like `TestBadge T02 → partial` in Tags.test.tsx were also falsely marking T02/T03 as numerically verified.
   - Test names that use IDs outside T01–T18 (e.g. T99 in Tags.test.tsx) are ignored with a warning.
2) verify.mjs adds `--reporter=default` next to the requested json reporter so progress shows in the console; the JSON file path is unchanged.
   - It also adds two flags: `--no-run` (only parse the existing outputs/) and `--strict`.
   - Failed test names in `names[]` get a ` [FAILED]` suffix.
   - The schema is otherwise unchanged and the existing `note` is preserved.
3) Vector JSON adds an optional `tolerance_overrides` per-key field, used for exact integer thresholds and mixed-scale keys, plus an extra `golden/vectors/index.json`. The required keys are exactly as specified.
4) Monte Carlo results are deliberately left out of the vectors because the TS RNG differs. The vectors hold only deterministic expected values, and TS should check its own MC against them with confidence intervals.
5) Negative tests are named under the related T-id so they count in verify:
   - wrong 0/1 encoding → T04
   - reversed comparator polarity → T06
   - code misalignment → T07
   - missing PE (ρ=1) → T10
   - GMAC sum-vs-average scaling → T13
6) Some extras are named under a T-id because they test that row's own claim:
   - mean-square bound by Monte Carlo → T03
   - dual-loop simplified vs full ranges → T09
   - §10.1 preconditioner example → T11
   - first-order EF quantizer period → T16
   - regularized pseudo-inverse fix → T18
7) Other extras are named `test_S<section>_…` (e.g. §8.3 delay bound d=0..6, §10.1 preconditioned variance, §14 E[δ_B²], §6.2 multi-frequency criterion) or `test_NEG_…` (fixed-point overflow, aliasing, PD-vs-output path confusion, wrong-formula detection, gauge freedom, comparator saturation). These have no T-id and verify reports them as "unmapped".
8) Added golden/requirements.txt (numpy, scipy, pytest).
9) docs/validation.md does not exist and I don't own docs/, so I did not create it. The errata are in golden/README.md §6 and in the notes below.

## 後續新增（主控者）

- `@/components` 新增教學元件：`CodeBlock`（`source` 為 `?raw` 匯入的原始檔、`region` 擷取 `#region core:<name>`、`lang` 'typescript'|'python'、`path`、`highlight`、`caption`）、`CodeCompare`（`items: {label, source, region, lang, note}[]`，寬螢幕並排、窄螢幕分頁；行內 `// ← 差異：…` 自動高亮）、`SymbolTable`（`rows: {symbol(TeX), meaning, unit?(TeX), firstSeen?, note?}[]`）、`Quiz`（`question`, `options?: {label, correct?}[]`, `answer`）、`Recap`（`formulas: {tex, label?, id?}[]`, `points: ReactNode[]`）、`Prereq`（可展開的先備知識框）、`StepDerivation`（`steps: {tex, why}[]`, `result?`：一步一行 + 理由）。
- `src/simulation/models/lms.ts`（Ch00–Ch03 共用，唯讀）：`conventionalStep / signErrorStep / signSignStep / huberStep`、`STEP`、`runScalarLms`、`sgn(tie)`、`fixedXPole / fixedXMuMax / classifyPole / POLE_BEHAVIOUR_LABEL`、`meanPole / meanSquareFactor / meanSquareMuMax`、`gaussianLyapunov / gaussianAlmostSureMuMax`、`batchOptima`、`lossValue / averageCost`，皆有 `#region core:*` 可直接以 CodeBlock 顯示（regions：sign, huberPsi, conventionalStep, signErrorStep, signSignStep, huberStep, runScalarLms, fixedXPole, meanSquareFactors, batchOptima）。
- 顯示程式碼的寫法：`import lmsSrc from '@/simulation/models/lms.ts?raw'` → `<CodeBlock source={lmsSrc} region="signErrorStep" path="src/simulation/models/lms.ts" />`。Python golden：`import pySrc from '../../../golden/lms_pll_golden/lms.py?raw'`（相對路徑）。

## 規格驗算時各章節稽核者給的實作建議

- **partA**：LMS Playground 要用有理數或高精度直接重算 T01（w1=9/5、w2=57/25）；以 double 比對時容忍度需約 1e-12，因為 w2=2.2800000000000002。圖上同時標出 pole p=1−μx^2 的區段：單調 0<μ<1/x^2、一步 μ=1/x^2、交替 1/x^2<μ<2/x^2、邊界與發散。加入零均值雜訊時，顯示穩態 var(w)=μσ_v^2/(2−μx^2)。Mean/Mean-Square 實驗必須同時畫三條線並分別貼標籤：解析的 E[δ_n]=(1−μP_x)^n δ0、解析的 E[δ_n^2]=g(μ)^n δ0^2（g=1−2μP_x+μ^2E[x^4]），以及 sample path 的中位數與 10/90% 分位數；並預設展示 μ=0.5、0.8、1.5、2.3 這幾個「路徑看似收斂、但均方發散」的區間（a.s. 界約 2.4213）。不要拿長時間的 δ^2 樣本平均當作 T03 的通過判據，改用封閉式或單步 MC 估計 E[(1−μx^2)^2]。MSE vs MAE 實驗要提供 sign(0) 慣例切換（數學 0 或 comparator ±1），用 y=[0,0,0,10] 展示：LMS 穩態 std 為 √(μ·18.75/(2−μ))，Sign-Error 則在中位數 0 附近 ±μ 的帶內抖動，時間平均依慣例為 0、μ/2 或 μ。另外加一個 bipolar ±1 regressor 的 preset，說明此時 mean 界與 MS 界相等（|x| 為常數時 Jensen 不等式取等號）。
- **comparator**：Comparator Lab 應該在 sample level 模擬 e=s+v、v~N(0,σ_v²)，並明確加入 threshold θ（P(+1)=Φ((s−θ)/σ_v)；θ=s 時退化成 50%）。累加量要標明是 sum S_N 還是 average，tie rule 要做成可選項（G=0 不更新、random tie-break、sign(0)=+1）。每個 N 同時顯示三組數字：exact binomial 的 P(G>0)/P(G=0)/P(G<0)（標 [精確｜指定模型]）、CLT（標 [近似｜需驗證]，並註明它等於 P(G>0)+½P(G=0)），以及帶 Wilson CI 的 Monte Carlo。必須展示的 edge case：奇偶 N 的鋸齒（N=100 嚴格 49.2% vs N=101 為 53.2%；N=2 只有 25.4%），以及 s/σ_v 變大時 K_q 線性化失效（s/σ≈0.246 時 K_q·s 高估 1%，0.56 時高估 5%），把 erf S 曲線與切線疊圖。大 N（≥1e4）的 MC 改用 K~Binomial(N,p) 抽樣以保持互動流暢，逐 sample 的 q_i 累加動畫只在小 N 啟用。API 的 metrics 要把理論值（p_positive=0.503989）和該 seed 的經驗估計分開；例如 10000 samples 的經驗 p_positive 標準誤約 0.005，不可把理論值當模擬輸出。
- **polarity**：Polarity Explorer 要把 u 實際送過一個有狀態、不在每個 block 重置的 DT filter，或明確限定 Ω∈(0,π) 的 (|H|,φ) 單頻模型；q=sign(δu+v)、G 用 block average（另提供 sum×N 切換），更新律固定為 w_{k+1}=w_k+μG_k。顯示 pole 需要 μ、σ_v（K_q）、A 這些輸入，目前 §19 的控制項沒有。單元測試可用：T07 在 μK_qC=0.02 時 analytic pole 0.98、MC 0.9801；T06 為 1.0100、MC 1.0097。若使用 §6.1 的 CT H_PD(s)，要標示「[近似｜ω_nT≪1]」並讓使用者選 ω_nT 與 loop latency d，因為 polarity 邊界在 ω_nT=0.3、d=1 時會由 ω_n 移到 1.49ω_n。要示範的邊界情況：Ω→0 或 π（2 倍誤差、有限 N 的 ripple 上界 (A²|H|/2)/(N|sinΩ|)）；θ=±90°（C=0 時 random walk）；以及 C<0 時 sign-LMS 先局部指數發散，再以約 μ(2A/π)|cosθ| 的速率線性漂移（MC 1.556 vs 1.596 fs/block）。C_D vs D 圖要畫出以 2π/Ω 為週期的正相關窗（T07 為 D∈{2..6} mod 12），並示範 phase lead 例如 +155.2° 只能靠 ΩD≡204.8° 的單頻 wrap 補償（Ω=0.03 rad/sample 時 D≈119），換一個頻率就失效。多頻 C_D 建議以 Σ_k h[k]R_xx[k-D] 當 ground truth，再與兩側 PSD、(1/2π)∫S=R[0] 正規化的積分交叉比對，並加上 e^{+jΩD} 的符號回歸測試（隨機 FIR+ARMA 在 D=4 時正確值 -2.4335、MC -2.4348±0.0061，錯號會得 -0.5886）。
- **margin**：Phase Margin Lab 應直接以 L(z)=g·z^{−d}/(z−1) 建模：poles 用 z^{d+1}−z^d+g=0 求根，並同時顯示 ω_c=2asin(g/2)、PM_d=90°−(2d+1)asin(g/2)、GM=20log10(2/g)（d=0 時），以及 delay margin=PM_rad/ω_c（單位 blocks），讓使用者看到 g=1 的 PM 60° 剛好只容忍 1 個 block，而 g=1.5 的 PM 41.4° 連 1 個 block（0.426）都撐不住。Nyquist/Bode 必須處理 z=1 的 integrator pole（Nyquist 要 indentation，|L| 在 ω→0 時要 clip）。g=2（d=0）與 g=g*（d≥1）要標成「臨界／marginal」，不可顯示為穩定；回歸測試應涵蓋 d=0..6 的 g* 表（2, 1, 0.618034, 0.445042, 0.347296, 0.284630, 0.241073）。Dual-Loop Explorer 必須跑完整的 2×2 時域遞迴至少 300 blocks，並疊畫 ρ^k 包絡線：μ=1.2 時 |δ| 在 k=100 只有 0.43（複數 pole 振盪造成的假象），到 k=300 才到 204，短視窗會誤判為收斂。圖上要並列簡化 pole 1−μbc/(1−r)（標 [近似｜時間尺度分離]）與 full eigenvalues 及一般界限 0<μbc<1−r（標 [精確｜指定模型]），並標出本例在 μ>(1−r)²/(4bc)=0.05 後 poles 變成複數。Polarity Explorer 建議用 M=arcsin(cosθ) 計算，並顯示有效增益比例 cosθ=sin M；θ=±90°（C=0）與 θ=180° 這兩種 edge case 要另外標示。
- **mimo**：MIMO / PE Lab 應模擬 block sign-GMAC，明確提供 N、σ_v（推出 K_q）、μ 或 γ、ρ 與 regressor 分佈（Gaussian 或 ±1/DSM codes），並同時以兩種單位顯示（正規化 K_q=1 的 μK_q，以及物理單位 fs、fs^-1）；poles 一律由實際使用的 M 與 J_true 計算 eig(I+MJ)，不要直接套公式。旁邊要並列 mean pole、mean-square spectral radius（N=1 Gaussian、ρ=.99、μ=.5 時為 1.98），以及 MC ensemble mean 與 3 條個別軌跡；±1 codes 的軌跡呈階梯狀，正好說明 598 是 ensemble 預測，不是每條軌跡的行為。Variance 面板要把 γ/(K_q²Nλ_i(2−γ)) 與 MC（固定 seed、95% CI）並列，同時顯示有效性指標 nγπ/(2N(2−γ))（例如 γ=1.5、N=64 時為 0.147，解析值高估 16%），以及 per-parameter variance c·[R^{-1}]_jj，避免和 eigen-mode variance 混淆。Gauge 實驗要分別在 raw-x domain（1 個零 eigenvalue）與經 H_PD(1)=0 的 u-domain（2 個零 eigenvalue）計算 R；也要展示 M=μI 時 null 分量凍結在初值，收斂後 b 與 a_i 的分配取決於初值與 M。Jacobian 面板要讓使用者調整 Δ/σ_v（截斷偏差：0.3σ_v 時 −1.5%，σ_v 時 −14.4%）、Ĵ 誤差與 regularization ε；T18 反例加上標籤「mismatched correlator，−J 非 PSD，任何 μ>0 皆發散」。所有閉式 eigen/pole 值標成 [精確｜指定模型]，variance 與 central-difference J 則標成 [近似｜需驗證]。
- **bias**：Bias & INL Lab 必須真的模擬 q=sign(e_det+v)，並提供一個可設為 0 的 σ_v 滑桿。用 root-finding 求 Σp_x·x·erf(e_det(x;w)/(√2σ_v))=0 得到 mean-field 固定點，同時疊上 MSE-LMS 的 1.34 [精確] 與無雜訊 Sign-LMS 的 1.4 [精確]，再畫出 w*(σ_v) 曲線：0.01 時 1.3966，0.1 時 1.3666，0.3 時 1.3439，1 時 1.3403。MC 要用固定 seeds 並顯示 95% CI。驗收值應以 mean-field 為準，不要直接用 1.34：σ_v=1 時 3.5e-4 的偏差在大量 MC 下是可以偵測到的。Lab 要有「Comparator 為主 PLL 的 BBPD（integral 強制 E[q]=0）」toggle，示範 offset bias 消失，以及分母從 E[x²] 變成 Var(x)。另外提供 code-dependent σ_v(x) 選項，示範 centering 失效（0.9601），以及無雜訊加 offset 的 dead zone：x∈{0..3}、b=1 時 w∈[a+b/3, a+b/2)。Near-integer 實驗中，C≤0 時 w*=a+B/C 要標示為不可達的 repelling point，GMAC 斜率 S 要在收斂後的 w* 處量測，並與 -K_qC 比較，顯示線性化 validity flag。
- **noise**：LMS Noise Lab 要同時提供三個引擎互相對照：(a) 線性 recursion δ_{k+1}=pδ_k+μη_k；(b) 真正的非線性 block sign-LMS（x=±1 時可用 G=(2·Binomial(N,Φ((a−w)/σ_v))−N)/N，這是 exact 結果，又能快速跑數千條 chain）；(c) 一般 x 分布下的 sample-level comparator 模擬。σ_w 要以多 seeds 的 95% CI 顯示，本例應落在 0.399 fs 附近。BW 欄位要分開顯示 exact −3 dB（12.93 kHz）、−ln p 近似、(1−p) 近似（12.40 kHz，標出 −4.1% 誤差）以及 ENBW（20.29 kHz），各自掛上 [精確]/[近似] 標籤，不要用同一個「Noise BW」字樣。p 滑桿必須能展示這些 edge cases：p→1（τ=−1/ln p 很長）、p<3−2√2（沒有 −3 dB 點）、−1<p≤0（flat/high-pass）、μK≥2（發散）。Code Mixing Lab 要把 block-rate 的 δw 以 ZOH 展開到 f_s 後再與 x 相乘，頻率軸要標明 f_u 或 f_s，並示範 white x 會把 low-pass 的 gain noise 攤成寬頻 δt；0.399 fs 一律標成 gain-equivalent，不能標成 output jitter。Spur 實驗應使用 coherent sampling，以 peak amplitude 量測，同時顯示 20log10(β/2) 與 Bessel exact 值（兩者皆為 −93.80 dBc），並畫出 f_out±90 kHz、±110 kHz 四根 spur，|T| 要讓使用者可調而非寫死為 1。
- **quant**：Quantized Gain Lab 必須以 code 更新率 f_upd 為主時基，並提供可選的 ZOH/sample-and-hold 到 f_s=N·f_upd 的模式。前者只會看到 f_upd/5（0.03056 LSB²）與 2f_upd/5（0.20944 LSB²）兩條線；後者會出現帶 sinc² 權重的 k·f_upd/5 諧波。這兩種模式要分開標示，並說明 2f/5 才是主 Spur。比較五種策略時要明確展示：常數 32.4 下 1st-order EFB 與 deterministic toggle 是同一個週期 5 循環（只差相位），而所有無偏的兩階方案總誤差功率都是 p(1−p)=0.24 LSB²，差別只在頻譜分佈；freeze 則是 0.16 LSB² 全在 DC。只有 time-varying w_H 或 dither 會讓 D 與 B 不同；例如 dither A=1 LSB 時輸出變成 31–34 四階，總功率升到約 0.32 LSB²，但譜線消失。Limit Cycle Period Detector 必須支援 exact/fixed-point 模式：F 個小數 bit 時週期為 2^F/gcd（F=10 → 512、F=16 → 32768）。float 模式要用整數輸出序列比對週期，不能比對浮點 r。UI 也要讓使用者選 Q6 = round/floor 與 tie 規則，並在 w_H 超出 [0,63] 時顯示 overload 警示。§14 的 E[δ_B²] 與 μ 區間計算器要同時顯示線性 analytic 與 1-bit Sign-LMS Monte Carlo（固定 seed、95% CI），在 |δ0|/σ_v 超過約 0.3 時自動標成 [近似｜失效風險]；ε 輸入欄位要明示為相對比例，並顯示非空條件 B ≥ ln ε/ln(1−K_min/K_max)；p²=1 時改用 δ0²+Bμ²σ_η² 的極限。T16 建議加上兩條譜線功率的 reference；T17 以 1e6 樣本測試時，容差可設 mean ±0.001、variance ±0.0002（95% CI）。
- **notation**：在 §0 建立一份全站共用的 symbol/unit registry，作為唯一來源：δ=a−w、δw=w−w*、K=K_qC、g=μK、S=−K，以及 u、w、μ 的單位（fs、無因次、LSB 加上 Δ_LSB）。每個 lab 的 slider 和 tooltip 都從這份 registry 讀取，並在畫面上同時顯示 raw μ（含單位）和 normalized g。GMAC 一定要做 sum/average 切換，並明確顯示 μ=10 fs、N=4096 時 sum mode 的 g=326.8（pole −325.8）會發散。也要提供 sign(0) 和 tie 規則的選項，讓 N=100 時 exact 的 49.2%/57.1% 和 CLT 的 53.2% 可以並列。§12 的 coefficient noise 要以多速率方式模擬：block-rate AR(1)，再經 ZOH 加 commit latency 升到 sample rate，最後乘上 code。頻寬需同時標示 −3 dB exact（12.93 kHz）、近似公式（12.40/12.92 kHz）和 ENBW（20.29 kHz）。§13 的量化實驗應指出：常數 32.4 時，1st-order ΔΣ 與 periodic toggle 產生完全相同的 period-5 pattern，主 tone 在 2f/5（|X2|=0.324 > |X1|=0.124）。§10 的 MIMO 例子要標明「K_q 正規化為 1」，並區分 eigen-mode variance 和每個參數的 variance（127.8/0.64 vs 64.2）。每個 preset（特別是 INL 1.34、T13 σ_w=0.399 fs）都必須連同 code 分布、path、gm_mode 一起存檔，避免換了預設分布後仍顯示舊的期望值。

- **字串內的行內公式**：`mathText(node)` / `<MathText>` / `stripMathDelimiters(text)`（`@/components`）。所有共用元件的字串屬性（ExperimentShell title/description/warnings/assumptions/crossCheck note、MetricRow name/note、MetricTable caption、Plot title/caption、Section/Derivation/Callout/Prereq/Quiz/Recap 標題、CodeBlock/CodeCompare title/caption/label/note）都已自動套用：字串中的 `$...$` 會以 KaTeX 顯示（`\$` 為字面金額符號）。JS 字串記得跳脫反斜線或用 `String.raw`。
- 全域樣式已加 `.katex { position: relative }`：寬表格（`.table-wrap`）內的公式不會再把頁面撐出水平捲軸。

- **帶入手算**：`HandCalc({ def, initialMode?, compact? })`、`texNum(x, sig)` / `texNumP(x, sig)`（負數加括號，代入用）、`checkAnswer`、`randomValues(def, seed)`、`defaultValues(def)`（`@/components`）；型別 `HandCalcDef / HandCalcInput / HandCalcStep / HandCalcResult / HandCalcSolution`（`@/data/types`）；彙整 `ALL_HANDCALCS / handcalcById / handcalcsForPage`（`@/app/handcalcs`，以 glob 收集 `src/chapters/*/handcalcs.ts` 與 `src/pages/*/handcalcs.ts` 的 `HANDCALCS`）。範本：`src/chapters/ch00/handcalcs.ts`。ID 格式 `HC-<章>.<序>`（案例頁用 `HC-CS.n`）。

- **系統地圖**：`SystemMap({ focus: SystemBlock[], caption? })`（`@/components`）— 全站共用的 PLL + LMS 校正系統方塊圖，`focus` 的方塊標成藍色。`SystemBlock` = 'ref' | 'pd' | 'lf' | 'vco' | 'div' | 'fcw' | 'dsm' | 'res' | 'gc' | 'dtc' | 'cmp' | 'align' | 'gmac' | 'scale' | 'acc' | 'qnt' | 'noise'。`systemMapChart(focus)` 回傳 Mermaid 原始碼（測試用）。
- **符號表位置**：改放章末（Recap 之後），外層 `id="symbols"`；章首只留一行連結。見 teaching-style.md §5、§8（方塊圖規範）。

- **Mermaid 更新**：`Mermaid` 元件會先以 `sanitizeMermaidSource`（`src/components/mermaidSource.ts`）把單獨的 `+`／`-` 標籤換成「＋」「−」，避免 Mermaid 11 畫出「Unsupported markdown: list」；圖說支援 `$...$`；瀏覽器中接近可視範圍才 render（IntersectionObserver），jsdom 中立即 render。測試工具 `@/components/mermaidTestUtils`：`installMermaidSvgShim()`、`renderMermaidForTest(chart) → { svg, text, nodeCount }`（不從 `@/components` 匯出，只給測試用）。
