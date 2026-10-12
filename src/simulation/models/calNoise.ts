/**
 * Calibration coefficient noise → PLL jitter / spurs（規格 §12；模型層級 L1 / L4）。第 12 章專用。
 *
 * ── 極性與參考點（勘誤 E33）──
 *   δw_k = w_k − w*：相對 LMS 固定點 w* 的係數偏差。與 §0 的 δ = a − w **極性相反**，參考點也不同：
 *   a − w_k = (a − w*) − δw_k。δt[n] = x[n]·δw[n] 是 DTC 多補償的量（gain noise 讓補償量 w·x 多出來的部分）；
 *   殘餘 timing error e = (a − w)x 的對應項為 −x[n]·δw[n]。
 *   DTC 在 reference 輸入端（docs/assumptions.md §2a）：延遲是 τ_DTC = T_0 − w·x，所以多補償 δt 就是 reference edge 多提前（少延遲）δt；
 *   殘餘誤差在 PD 的 reference 輸入注入，輸出 θ_out = +T·φ_dtc，其中 gain-noise 的部分是 φ_dtc = −2π f_out·δt（|T|²、jitter、spur dBc 與極性無關）。
 *
 * ── 線性化 block 模型（§12.1）──
 *   G_k ≈ −K·δw_k + η_k，K = K_q·C [fs⁻¹]，η_k 為 GMAC 的零均值雜訊（average 模式 σ_η² ≈ 1/N）
 *   w_{k+1} = w_k + μ·G_k  ⇒  δw_{k+1} = p·δw_k + μ·η_k，p = 1 − μK（sum 模式 g 再乘 N）
 *   H_{η→w}(z) = μ/(z − p)；S_w(e^{jΩ}) = μ²S_η/|1 − p e^{−jΩ}|²（Ω：rad/block，取樣率 f_u = f_s/N）
 *   σ_w² = μ²σ_η²/(1 − p²)（|p| < 1）
 *
 * ── 頻寬的四個量（勘誤 E06 / E10 / E26 / E27）──
 *   exact −3 dB：Ω_3dB = 2·asin((1 − p)/(2√p))，只在 3 − 2√2 ≤ p < 1 存在
 *   (1 − p) 近似、−ln p 近似（皆為 −3 dB 的近似，不是 noise bandwidth）
 *   one-sided ENBW = (f_u/2)(1 − p)/(1 + p)，σ_w² = S_w^(1)(0)·ENBW（白雜訊積分用這個）
 *
 * ── PSD 正規化（勘誤 E28）──
 *   DTFT 形式 S(e^{jΩ})：σ² = (1/2π)∫_{−π}^{π} S dΩ；單邊 per-Hz：S^(1)(f) = (2/f_r)·S(e^{j2πf/f_r})，0 < f < f_r/2，
 *   f_r 為該序列的取樣率（block 量用 f_u，sample 量用 f_s）。ℒ(f) = 10log10(S_φ^(1)/2)。
 *
 * ── Multirate（勘誤 E09 / E29）──
 *   δw[n] = δw_{⌊(n − n_c)/N⌋}（ZOH），時間平均（block 相位隨機）的 sample-rate PSD：
 *   S_w^{(f_s)}(e^{jθ}) = (1/N)·[sin(Nθ/2)/sin(θ/2)]²·S_w^{(f_u)}(e^{jNθ})，θ：rad/sample。
 *
 * ── 單位 ── 時間 fs、頻率 Hz、相位 rad；μ 的單位為 fs（average 模式）；x 無因次。
 *
 * ── 研究延伸（R1 的最簡模型）── colored GMAC noise：η 為 AR(1)（lag-1 相關 r），σ_w² 乘 (1 + pr)/(1 − pr)（sigmaW2Colored）。
 *
 * 可由 Web Worker 呼叫：runNoiseLab、runNoiseLabBatch（A/B/C paired）、simulateCodeSpectra、simulateMixing、codeSpectraAnalytic
 * （參數為 plain object，回傳可 structured clone）。mixingCrossCheck 為誠實的交叉比對判定（純函式）。
 * 純數值、無 React / DOM。
 *
 * ── 字串慣例（docs/teaching-style.md §3）── 警告、錯誤訊息、交叉比對說明與 *_TEX 標籤中的數學一律寫成 `$...$` 行內 LaTeX
 * （由 UI 的 mathText 渲染；數字用 texNum 轉成 TeX）。不含 `$` 的 REGIME_LABEL / CODE_LABEL / ENGINE_LABEL 給 Plotly 圖例、
 * 下拉選單等不渲染 KaTeX 的地方使用。
 */

import { binomPmf, createRng, deriveSeed, fsToRad, meanCI, normCdf, studentTInv, type Rng } from '@/simulation/core'
import { fft, toneFitMulti, periodogram, welch, type WindowName } from '@/simulation/signal'
import { ctHpd, ctT, wnFromBandwidth3dB } from '@/simulation/models/pll'
import { runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'

// ───────────────────────────────────────────────────────────────────────────
// 常數
// ───────────────────────────────────────────────────────────────────────────

/** √(2/π)：Gaussian comparator 的小訊號增益係數，K_q = √(2/π)/σ_v */
export const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
/** exact −3 dB 點存在的最小 pole：p ≥ 3 − 2√2 ≈ 0.171573（對應 μK ≤ 2√2 − 2 ≈ 0.828427；E27） */
export const P_MIN_3DB = 3 - 2 * Math.SQRT2
/** |δw| 超過此值（fs）即判定發散 */
export const NOISE_DIVERGENCE_FS = 1e9
/** sample-level 引擎的總樣本數上限（N × blocks × chains） */
export const MAX_SAMPLE_LEVEL_SAMPLES = 2 ** 27

// ───────────────────────────────────────────────────────────────────────────
// 迴路參數與頻寬（§12、§12.1；T13 / T14）
// ───────────────────────────────────────────────────────────────────────────

export type GmMode = 'average' | 'sum'

/**
 * H_{η→w} 的型態：
 * - lowpass：3 − 2√2 ≤ p < 1，有 exact −3 dB 點
 * - no3db：0 < p < 3 − 2√2，low-pass 但 Nyquist 處衰減不足 3 dB
 * - flat：p = 0（δw_{k+1} = μη_k，白色）
 * - highpass：−1 < p < 0（相鄰 block 正負交替）
 * - unstable：|p| ≥ 1 且 C > 0（g ≥ 2）
 * - polarity：C ≤ 0（p ≥ 1，更新方向錯誤）
 * - undefined：σ_v ≤ 0（K_q 無定義）
 */
export type BwRegime = 'lowpass' | 'no3db' | 'flat' | 'highpass' | 'unstable' | 'polarity' | 'undefined'

/** 型態名稱（純文字、不含公式：用在下拉選單、指標「數值」欄等不渲染 KaTeX 的地方） */
export const REGIME_LABEL: Record<BwRegime, string> = {
  lowpass: 'Low-pass（有 −3 dB 點）',
  no3db: 'Low-pass，但 −3 dB 點不存在',
  flat: 'Flat（白色）',
  highpass: 'High-pass',
  unstable: '不穩定（pole 在單位圓外）',
  polarity: '極性錯誤',
  undefined: 'comparator 增益無定義（無雜訊）',
}

/** 型態名稱（含 `$...$` 行內 LaTeX；用在會經 mathText 渲染的字串屬性：警告、交叉比對說明…） */
export const REGIME_LABEL_TEX: Record<BwRegime, string> = {
  lowpass: String.raw`Low-pass（有 −3 dB 點，$3-2\sqrt2\le p<1$）`,
  no3db: String.raw`Low-pass，但 −3 dB 點不存在（$0<p<3-2\sqrt2$）`,
  flat: String.raw`Flat（$p=0$，白色）`,
  highpass: String.raw`High-pass（$-1<p<0$）`,
  unstable: String.raw`不穩定（$|p|\ge1$）`,
  polarity: String.raw`極性錯誤（$C\le0$）`,
  undefined: String.raw`$K_q$ 無定義（$\sigma_v=0$）`,
}

/** 數字 → TeX（指數記法改成 m×10^{e}），給警告字串內的 `$...$` 用 */
export function texNum(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? String.raw`\mathrm{NaN}` : x > 0 ? String.raw`\infty` : String.raw`-\infty`
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = x.toExponential(digits - 1).split('e')
    return String.raw`${Number(m)}\times10^{${Number(e)}}` // 尾端的 0 去掉：2.000e9 → 2×10^9
  }
  return String(Number(x.toPrecision(digits)))
}

export interface CalLoopInput {
  /** GMAC 每 block 累加的 comparator 樣本數 N（正整數） */
  N: number
  /** comparator / regressor 取樣率 f_s [Hz] */
  fs: number
  /** 學習率 μ [fs]（average 模式：w 的單位 / G 的單位） */
  mu: number
  /** comparator 前 Gaussian 雜訊 RMS σ_v [fs] */
  sigmaV: number
  /** 有效 code 相關 C = E[x·u]（unit-RMS code、identity path 時為 1；無因次） */
  C: number
  /** GMAC 輸出為平均（預設）或總和；sum 模式沿用同一個 μ 時 g 放大 N 倍 */
  gmMode?: GmMode
  /** 覆寫每 block 的 GMAC 雜訊變異數 σ_η²（預設 average：1/N；sum：N） */
  sigmaEta2?: number
  /**
   * GMAC 雜訊的 lag-1 相關 r（AR(1) colored S_η；預設 0 = 白色，即規格 §12.1 的 iid 假設）。
   * R_η[ℓ] = σ_η² r^{|ℓ|}，S_η(e^{jΩ}) = σ_η²(1 − r²)/(1 − 2r cosΩ + r²)。只有引擎 (a) 會模擬它。
   */
  etaR?: number
}

export interface CalLoop {
  input: Required<CalLoopInput>
  /** K_q = √(2/π)/σ_v [fs⁻¹] */
  Kq: number
  /** K = K_q·C [fs⁻¹]（per-sample average G 對 δw 的斜率） */
  K: number
  /** g = μK（sum 模式再乘 N），無因次 */
  g: number
  /** p = 1 − g */
  p: number
  /** Block update rate f_u = f_s/N [Hz] */
  fu: number
  /** σ_η²（G 的單位²） */
  sigmaEta2: number
  /** σ_w² [fs²]（|p| ≥ 1 時 NaN；colored η 時含 (1 + pr)/(1 − pr) 修正） */
  sigmaW2: number
  /** σ_w [fs] */
  sigmaW: number
  /** colored η 的變異數修正因子 (1 + pr)/(1 − pr)（白色 η 時 = 1） */
  colorFactor: number
  /** δw 的 lag-1 自相關係數 ρ₁ = p + r(1 − p²)/(1 + pr)（白色 η 時 = p） */
  rho1: number
  /** 收斂時間常數 τ = −1/ln|p| [blocks]（|p| ≥ 1 或 p = 0 時 NaN / 0） */
  tauBlocks: number
  /** τ / f_u [s] */
  tauSeconds: number
  regime: BwRegime
  /** exact −3 dB [Hz]（不存在時 NaN） */
  f3dbExact: number
  /** (1 − p)/(2π)·f_u [Hz] */
  f3dbOneMinusP: number
  /** −ln p/(2π)·f_u [Hz] */
  f3dbNegLnP: number
  /** (1 − p)/(2π√p)·f_u [Hz]（asin 小角近似） */
  f3dbSqrtP: number
  /** one-sided ENBW = (f_u/2)(1 − p)/(1 + p) [Hz]（H_{η→w} 的性質） */
  enbw: number
  /** S_w^(1)(0) = 2μ²S_η(1)/((1 − p)²f_u) [fs²/Hz]（白色 η 時 S_η(1) = σ_η²） */
  sw1Dc: number
  /** 實際 S_w 的等效雜訊頻寬 σ_w²/S_w^(1)(0) [Hz]（白色 η 時 = enbw；colored 時不同） */
  enbwEff: number
  warnings: string[]
}

// #region core:calLoop
/**
 * §12.1 的線性化 block 模型核心：K = K_q·C、g = μK、p = 1 − g、σ_w² = μ²σ_η²/(1 − p²)。
 * 封閉式在指定模型下 [精確｜指定模型]；模型本身（小訊號 K_q、iid η）是 [近似｜需驗證]。
 */
export function loopCore(N: number, fs: number, mu: number, sigmaV: number, C: number, gmMode: GmMode, sigmaEta2?: number) {
  const Kq = sigmaV > 0 ? SQRT_2_OVER_PI / sigmaV : NaN // 小訊號 comparator 增益 [fs⁻¹]
  const K = Kq * C // GMAC 斜率 [fs⁻¹]
  const g = mu * K * (gmMode === 'sum' ? N : 1) // 無因次迴路增益（sum 模式放大 N 倍）
  const p = 1 - g // 一階 pole：δw_{k+1} = p·δw_k + μη_k
  const fu = fs / N // block update rate [Hz]
  const s2 = sigmaEta2 ?? (gmMode === 'sum' ? N : 1 / N) // Var(G_k) ≈ E[x²]/N（average）
  const sigmaW2 = Math.abs(p) < 1 ? (mu * mu * s2) / (1 - p * p) : NaN // 穩態變異 [fs²]
  return { Kq, K, g, p, fu, sigmaEta2: s2, sigmaW2 }
}
// #endregion

// #region core:dwStep
/**
 * F-12.2 的一步（確定性）：δw_{k+1} = p·δw_k + μ·η_k，η_k 由呼叫端給定（章首手算表、「帶入手算」HC-12.1 用）。
 * 引擎 (a) 的 linearStep 是同一個式子把 p = 1 − μK 展開、η 改用亂數產生的版本。
 */
export function dwStep(dw: number, p: number, mu: number, eta: number): number {
  return p * dw + mu * eta // 舊偏差留下 p 倍（被 LMS 拉回），再被這個 block 的 GMAC 雜訊推 μη
}
// #endregion

// #region core:coloredEta
/**
 * Colored GMAC noise（AR(1)）：R_η[ℓ] = σ_η² r^{|ℓ|}。δw_k 由過去的 η 決定，而 η_k 與過去相關，
 * 所以 E[δw_k η_k] = μσ_η² r/(1 − pr) ≠ 0，變異數遞迴多一個交叉項：
 *   σ_w² = μ²σ_η²/(1 − p²) · (1 + pr)/(1 − pr)（r = 0 時退回白色結果）。
 */
export function sigmaW2Colored(mu: number, sigmaEta2: number, p: number, r: number): number {
  if (!(Math.abs(p) < 1) || !(Math.abs(r) < 1)) return NaN
  const white = (mu * mu * sigmaEta2) / (1 - p * p) // 白色 η 的 F-12.5
  return white * ((1 + p * r) / (1 - p * r)) // ← 差異：2pμE[δw_kη_k] 交叉項帶來的修正因子
}
// #endregion

/** §12.1 的完整迴路摘要（含四種頻寬、τ、型態與警告）。 */
export function calLoop(inp: CalLoopInput): CalLoop {
  const gmMode = inp.gmMode ?? 'average'
  const etaR = inp.etaR ?? 0
  const { N, fs, mu, sigmaV, C } = inp
  const core = loopCore(N, fs, mu, sigmaV, C, gmMode, inp.sigmaEta2)
  const { Kq, K, g, p, fu, sigmaEta2 } = core
  const colored = etaR !== 0
  const sigmaW2 = colored ? sigmaW2Colored(mu, sigmaEta2, p, etaR) : core.sigmaW2
  const colorFactor = Math.abs(etaR) < 1 ? (Math.abs(p) < 1 ? (1 + p * etaR) / (1 - p * etaR) : NaN) : NaN
  const regime = bwRegime(p, C, sigmaV)
  const tauBlocks = Math.abs(p) < 1 ? (p === 0 ? 0 : -1 / Math.log(Math.abs(p))) : NaN
  const warnings = calLoopWarnings({ N, mu, sigmaV, C, gmMode, K, g, p, regime, etaR })
  // S_η 在 DC 的值：σ_η²(1 + r)/(1 − r)（白色 η 時 = σ_η²）
  const sEtaDc = Math.abs(etaR) < 1 ? (sigmaEta2 * (1 + etaR)) / (1 - etaR) : NaN
  const sw1Dc = Math.abs(p) < 1 ? (2 * mu * mu * sEtaDc) / ((1 - p) * (1 - p) * fu) : NaN
  return {
    input: { N, fs, mu, sigmaV, C, gmMode, sigmaEta2, etaR },
    Kq,
    K,
    g,
    p,
    fu,
    sigmaEta2,
    sigmaW2,
    sigmaW: Math.sqrt(sigmaW2),
    colorFactor,
    rho1: Math.abs(p) < 1 && Math.abs(etaR) < 1 ? p + (etaR * (1 - p * p)) / (1 + p * etaR) : NaN,
    tauBlocks,
    tauSeconds: tauBlocks / fu,
    regime,
    f3dbExact: bw3dbExact(p, fu),
    f3dbOneMinusP: bw3dbOneMinusP(p, fu),
    f3dbNegLnP: bw3dbNegLnP(p, fu),
    f3dbSqrtP: p > 0 && p < 1 ? ((1 - p) / (2 * Math.PI * Math.sqrt(p))) * fu : NaN,
    enbw: enbwOneSided(p, fu),
    sw1Dc,
    enbwEff: sigmaW2 / sw1Dc,
    warnings,
  }
}

/** 依 p、C、σ_v 判斷 H_{η→w} 的型態（E27 的 UI 規則）。 */
export function bwRegime(p: number, C: number, sigmaV = 1): BwRegime {
  if (!(sigmaV > 0)) return 'undefined'
  if (!(C > 0)) return 'polarity'
  if (!(Math.abs(p) < 1)) return 'unstable'
  if (p < 0) return 'highpass'
  if (p === 0) return 'flat'
  if ((1 - p) / (2 * Math.sqrt(p)) > 1 + 1e-12) return 'no3db' // 等價於 p < 3 − 2√2
  return 'lowpass'
}

function calLoopWarnings(a: {
  N: number
  mu: number
  sigmaV: number
  C: number
  gmMode: GmMode
  K: number
  g: number
  p: number
  regime: BwRegime
  etaR: number
}): string[] {
  const w: string[] = []
  if (!(Math.abs(a.etaR) < 1)) {
    w.push(String.raw`$S_\eta$ 的 lag-1 相關 $r=${texNum(a.etaR, 4)}$ 不合法：AR(1) colored noise 需 $|r|<1$（$|r|\to1$ 時 $\eta$ 變成 random walk，沒有有限變異數）。`)
  }
  if (!(a.sigmaV > 0)) {
    w.push(
      String.raw`$\sigma_v=0$：$K_q=\sqrt{2/\pi}/\sigma_v$ 無定義。無雜訊的 comparator 是硬限幅 $\operatorname{sign}(\cdot)$，小訊號線性化不成立；Sign-LMS 會在 $w^*$ 附近以 $\pm\mu$ 的 limit cycle 跳動，$\sigma_w$ 不能用 $\mu^2\sigma_\eta^2/(1-p^2)$ 預測。`,
    )
    return w
  }
  if (!(a.C > 0)) {
    w.push(
      String.raw`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$p=1-\mu K_qC=${texNum(a.p)}\ge1$）。這不是雜訊問題：先修正 code 對齊 / PLL error path 的相位（第 6–7 章），否則不存在穩態 $\sigma_w$。`,
    )
  }
  if (a.gmMode === 'sum') {
    w.push(
      String.raw`gm_mode=sum 時有效增益放大 N 倍：$g=\mu KN=${texNum(a.g)}$，pole $p=${texNum(a.p)}$。若沿用 average 模式設計的 $\mu$ 而忘了除以 $N$，迴路會發散（勘誤 E18、T13 反面測試）。`,
    )
  }
  if (a.C > 0 && a.g >= 2) {
    w.push(
      String.raw`g ≥ 2：一階模型不穩定（$g=${a.gmMode === 'sum' ? String.raw`\mu KN` : String.raw`\mu K`}=${texNum(a.g)}$，$|p|=${texNum(Math.abs(a.p))}\ge1$），不存在穩態變異，也沒有頻寬可言。請減小 $\mu$（或 sum 模式下除以 $N$）。`,
    )
  } else if (a.C > 0 && !(a.g > 0)) {
    w.push(
      String.raw`$\mu\le0$：$g=${texNum(a.g)}\le0\Rightarrow p=${texNum(a.p)}\ge1$，更新方向與 GMAC 斜率同號（等同極性錯誤），誤差不會被拉回 $w^*$。learning rate 必須為正。`,
    )
  } else if (a.regime === 'highpass') {
    w.push(
      String.raw`$p=${texNum(a.p)}<0$（$\mu K>1$）：$H_{\eta\to w}$ 變成 high-pass，相鄰 block 的 $\delta w$ 正負交替，雜訊集中在 $f_u/2$ 附近；low-pass 的「頻寬」定義不適用（E27）。`,
    )
  } else if (a.regime === 'flat') {
    w.push(String.raw`$p=0$：$\delta w_{k+1}=\mu\eta_k$，係數雜訊是白色（flat），沒有 −3 dB 點。`)
  } else if (a.regime === 'no3db') {
    w.push(
      String.raw`−3 dB 點不存在：$0<p=${texNum(a.p)}<3-2\sqrt2\approx0.1716$（$\mu K>0.8284$）時，$|H|^2$ 在 Nyquist $f_u/2$ 仍高於 DC 的一半（DC/Nyquist 增益比 $\big(\tfrac{1+p}{1-p}\big)^2<2$，E27）。近似公式仍會輸出數字，但沒有意義。`,
    )
  }
  return w
}

// #region core:bwExact
/** Exact discrete-time −3 dB：|μ/(e^{jΩ} − p)|² = ½|H(1)|² ⇒ sin(Ω/2) = (1 − p)/(2√p)。 */
export function bw3dbExact(p: number, fu: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const s = (1 - p) / (2 * Math.sqrt(p)) // ← 差異：解 1 − 2p cosΩ + p² = 2(1 − p)²
  if (s > 1 + 1e-12) return NaN // ← 差異：s ≤ 1 ⇔ p ≥ 3 − 2√2，否則 −3 dB 點不存在（E27）
  const omega3 = 2 * Math.asin(Math.min(s, 1)) // rad/block（= acos(1 − (1−p)²/(2p))，但 p→1 時數值較穩）
  return (omega3 / (2 * Math.PI)) * fu
}
// #endregion

// #region core:bwOneMinusP
/** 一階近似 f_3dB ≈ (1 − p)/(2π)·f_u；相對誤差約 −(1 − p)/2（E26）。 */
export function bw3dbOneMinusP(p: number, fu: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const omega3 = 1 - p // ← 差異：只保留 −ln p 的泰勒一階項
  return (omega3 / (2 * Math.PI)) * fu
}
// #endregion

// #region core:bwNegLnP
/** 等效連續時間 pole 近似 f_3dB ≈ −ln(p)/(2π)·f_u（由 p = e^{−ω_c/f_u}）。 */
export function bw3dbNegLnP(p: number, fu: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const omega3 = -Math.log(p) // ← 差異：z = e^{sT_u} 映射，s = −ω_c
  return (omega3 / (2 * Math.PI)) * fu
}
// #endregion

// #region core:enbw
/** One-sided equivalent noise bandwidth：(1/|H(0)|²)∫_0^{f_u/2}|H|² df = (f_u/2)(1 − p)/(1 + p)。 */
export function enbwOneSided(p: number, fu: number): number {
  if (!(Math.abs(p) < 1)) return NaN
  return (fu / 2) * ((1 - p) / (1 + p)) // ← 差異：這是「積分用」的寬度，不是 −3 dB 點（E06）
}
// #endregion

/** 數值驗證用：以二分法解 |H(Ω)|²/|H(0)|² = ½（不用封閉式）。不存在時 NaN。 */
export function bw3dbNumeric(p: number, fu: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const ratio = (om: number) => (1 - p) ** 2 / (1 - 2 * p * Math.cos(om) + p * p) - 0.5
  if (ratio(Math.PI) > 0) return NaN
  let lo = 0
  let hi = Math.PI
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (ratio(mid) > 0) lo = mid
    else hi = mid
  }
  return (0.5 * (lo + hi) * fu) / (2 * Math.PI)
}

// ───────────────────────────────────────────────────────────────────────────
// PSD（§12、§12.2；E28 / E29）
// ───────────────────────────────────────────────────────────────────────────

// #region core:swPsd
/**
 * Block-rate 雙邊 DTFT PSD：S_w(e^{jΩ}) = μ²S_η(e^{jΩ})/|1 − p e^{−jΩ}|² [fs²/(rad/block)]。
 * sEta = σ_η²；r ≠ 0 時 S_η 為 AR(1) 形狀 σ_η²(1 − r²)/(1 − 2r cosΩ + r²)（白色：r = 0）。
 */
export function swDtft(omega: number, mu: number, p: number, sEta: number, r = 0): number {
  const den = 1 - 2 * p * Math.cos(omega) + p * p // |e^{jΩ} − p|² = (cosΩ − p)² + sin²Ω
  const shape = r === 0 ? 1 : (1 - r * r) / (1 - 2 * r * Math.cos(omega) + r * r) // S_η/σ_η²
  return (mu * mu * sEta * shape) / den
}

/** 單邊 per-Hz：S_w^(1)(f) = (2/f_u)·S_w(e^{j2πf/f_u})，0 ≤ f ≤ f_u/2 [fs²/Hz]（E28）。 */
export function swOneSided(f: number, mu: number, p: number, sEta: number, fu: number, r = 0): number {
  return (2 / fu) * swDtft((2 * Math.PI * f) / fu, mu, p, sEta, r)
}
// #endregion

// #region core:zohPsd
/**
 * ZOH 到 sample rate 後（時間平均）的雙邊 DTFT PSD（E09 / E29）：
 *   S_w^{(f_s)}(e^{jθ}) = (1/N)·[sin(Nθ/2)/sin(θ/2)]²·S_w^{(f_u)}(e^{jNθ})，θ 為 rad/sample。
 */
export function swZohDtft(theta: number, N: number, mu: number, p: number, sEta: number): number {
  const s = Math.sin(theta / 2)
  const dirichlet2 = Math.abs(s) < 1e-300 ? N * N : (Math.sin((N * theta) / 2) / s) ** 2 // |Σ_{r<N} e^{−jθr}|²
  return (dirichlet2 / N) * swDtft(N * theta, mu, p, sEta) // 上取樣把頻率壓縮 N 倍，boxcar 給 sinc² 權重
}
// #endregion

/** ZOH 後 sample-rate 單邊 per-Hz PSD：(2/f_s)·S_w^{(f_s)}(e^{j2πf/f_s}) [fs²/Hz]（對 f 偶對稱）。 */
export function swZohOneSided(f: number, fs: number, N: number, mu: number, p: number, sEta: number): number {
  return (2 / fs) * swZohDtft((2 * Math.PI * Math.abs(f)) / fs, N, mu, p, sEta)
}

/** δt = x·δw 的 code：x[n] = m + A·cos(2π f_x n/f_s + θ) + w[n]，w 為與 δw 獨立的白色成分（例如 ±1 隨機 code）。 */
export interface CodeSpec {
  /** DC 成分 m（無因次） */
  m: number
  /** tone 振幅 A（peak，無因次） */
  A: number
  /** tone 頻率 f_x [Hz] */
  fx: number
  /** 白色成分的變異數 σ_x²（±1 隨機 code 為 1） */
  whiteVar: number
}

export interface MixSystem {
  fs: number
  N: number
  mu: number
  p: number
  sEta: number
}

// #region core:mixPsd
/**
 * δt[n] = x[n]·δw[n] 的單邊 per-Hz PSD [fs²/Hz]（x 與 δw 獨立、零均值成分互不相關）：
 *   S_t = m²·S_w + (A²/4)·[S_w(f − f_x) + S_w(f + f_x)] + σ_x²·σ_w²·(2/f_s)
 * 由 R_t[ℓ] = R_x[ℓ]·R_w[ℓ] 與 S_t = (1/2π) S_x ⊛ S_w 得到；S_w 為 ZOH 後的 sample-rate PSD（E09）。
 */
export function dtPsdOneSided(f: number, code: CodeSpec, sys: MixSystem): number {
  const Sw = (ff: number) => swZohOneSided(ff, sys.fs, sys.N, sys.mu, sys.p, sys.sEta)
  const sigmaW2 = (sys.mu * sys.mu * sys.sEta) / (1 - sys.p * sys.p)
  const dcTerm = code.m * code.m * Sw(f) // ← 常數 code：δw 頻譜原封不動（低頻）
  const toneTerm = ((code.A * code.A) / 4) * (Sw(f - code.fx) + Sw(f + code.fx)) // ← tone code：搬到 ±f_x
  const whiteTerm = code.whiteVar * sigmaW2 * (2 / sys.fs) // ← 白色 code：攤平到 0…f_s/2
  return dcTerm + toneTerm + whiteTerm
}
// #endregion

/** δt 的總功率（時間平均）：E[x²]·σ_w² = (m² + A²/2 + σ_x²)·σ_w² [fs²]（Parseval，不需積分）。 */
export function dtTotalPower(code: CodeSpec, sys: MixSystem): number {
  const sigmaW2 = (sys.mu * sys.mu * sys.sEta) / (1 - sys.p * sys.p)
  return (code.m * code.m + (code.A * code.A) / 2 + code.whiteVar) * sigmaW2
}

// ───────────────────────────────────────────────────────────────────────────
// 數值積分（含已知 notch / peak 的斷點）
// ───────────────────────────────────────────────────────────────────────────

function simpsonAdaptive(fn: (x: number) => number, a: number, b: number, tolAbs: number): number {
  const rec = (lo: number, hi: number, flo: number, fmid: number, fhi: number, S: number, tol: number, depth: number): number => {
    const mid = 0.5 * (lo + hi)
    const flm = fn(0.5 * (lo + mid))
    const frm = fn(0.5 * (mid + hi))
    const left = ((mid - lo) / 6) * (flo + 4 * flm + fmid)
    const right = ((hi - mid) / 6) * (fmid + 4 * frm + fhi)
    const diff = left + right - S
    if (depth <= 0 || Math.abs(diff) <= 15 * tol) return left + right + diff / 15
    return rec(lo, mid, flo, flm, fmid, left, tol / 2, depth - 1) + rec(mid, hi, fmid, frm, fhi, right, tol / 2, depth - 1)
  }
  // 先強制切 8 段，避免初始 5 點剛好落在週期性 notch 上而誤判收斂
  const seg = 8
  let total = 0
  let fPrev = fn(a)
  for (let i = 0; i < seg; i++) {
    const lo = a + ((b - a) * i) / seg
    const hi = i === seg - 1 ? b : a + ((b - a) * (i + 1)) / seg
    const fhi = fn(hi)
    const fmid = fn(0.5 * (lo + hi))
    const S = ((hi - lo) / 6) * (fPrev + 4 * fmid + fhi)
    total += rec(lo, hi, fPrev, fmid, fhi, S, tolAbs / seg, 30)
    fPrev = fhi
  }
  return total
}

/**
 * ∫_{fL}^{fH} fn(f) df，在 breaks（notch、peak 位置）切段後逐段做 adaptive Simpson。
 * @param tolAbs 總絕對誤差目標
 * @param maxSegments 斷點過多時（例如 f_H/f_u 很大）合併遠端斷點；回傳 approx = true
 */
export function integrateWithBreaks(
  fn: (f: number) => number,
  fL: number,
  fH: number,
  breaks: number[],
  tolAbs: number,
  maxSegments = 6000,
): { value: number; segments: number; approx: boolean } {
  if (!(fH > fL)) return { value: 0, segments: 0, approx: false }
  let pts = breaks.filter((b) => b > fL && b < fH)
  pts.push(fL, fH)
  pts = Array.from(new Set(pts)).sort((x, y) => x - y)
  let approx = false
  if (pts.length - 1 > maxSegments) {
    // 保留前 maxSegments 個斷點，其後改用對數間隔（遠端 ripple 已被 sinc² 壓低）
    approx = true
    const keep = pts.slice(0, maxSegments)
    const start = keep[keep.length - 1]
    const n = 400
    for (let i = 1; i <= n; i++) keep.push(start * Math.pow(fH / start, i / n) * (i < n ? 1 + 0.37 / n : 1))
    pts = Array.from(new Set(keep.filter((x) => x <= fH))).sort((x, y) => x - y)
    if (pts[pts.length - 1] < fH) pts.push(fH)
  }
  const segs = pts.length - 1
  let value = 0
  for (let i = 0; i < segs; i++) value += simpsonAdaptive(fn, pts[i], pts[i + 1], tolAbs / segs)
  return { value, segments: segs, approx }
}

/** ZOH δw 頻譜的 notch / peak 斷點：k·f_u 與 |k·f_u ± f_x|（k·f_u ≤ fH，最多 kMax 個）。 */
export function mixBreakpoints(fu: number, fx: number, fH: number, kMax = 20000): number[] {
  const out: number[] = [0]
  const K = Math.min(kMax, Math.floor(fH / fu) + 1)
  for (let k = 0; k <= K; k++) {
    const c = k * fu
    out.push(c)
    if (fx > 0) out.push(Math.abs(c - fx), c + fx)
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// PLL 傳遞函數（§12.3）與三種 code 的 δt / output 頻譜（L4）
// ───────────────────────────────────────────────────────────────────────────

export interface PllShape {
  /** T(s) 的 −3 dB 頻率 [Hz] */
  f3dbT: number
  /** 阻尼 ζ */
  zeta: number
}

/** |T(j2πf)|²（type-II 二階 CT 原型；需 f ≪ f_s，[近似｜ω_nT ≪ 1]） */
export function tMag2(f: number, pll: PllShape): number {
  const wn = wnFromBandwidth3dB(2 * Math.PI * pll.f3dbT, pll.zeta)
  const h = ctT(2 * Math.PI * f, { zeta: pll.zeta, wn })
  return h.re * h.re + h.im * h.im
}

/** |H_PD(j2πf)|² = |1/(1 + L)|²（high-pass） */
export function hpdMag2(f: number, pll: PllShape): number {
  const wn = wnFromBandwidth3dB(2 * Math.PI * pll.f3dbT, pll.zeta)
  const h = ctHpd(2 * Math.PI * f, { zeta: pll.zeta, wn })
  return h.re * h.re + h.im * h.im
}

export type CodeKind = 'const' | 'tone' | 'white'

/** code 名稱（純文字：Plotly 圖例、CSV 欄名等不渲染 KaTeX 的地方） */
export const CODE_LABEL: Record<CodeKind, string> = {
  const: '常數 code',
  tone: '單頻 code',
  white: '±1 隨機 code',
}

/** code 名稱（含 `$...$` 行內 LaTeX：指標名稱等經 mathText 渲染的字串屬性） */
export const CODE_LABEL_TEX: Record<CodeKind, string> = {
  const: String.raw`常數 code（$x\equiv1$）`,
  tone: String.raw`單頻 code（$x=A\cos2\pi f_xt$）`,
  white: String.raw`$\pm1$ 隨機 code（白色）`,
}

export interface CodeSpectraParams extends CalLoopInput {
  /** tone code 的頻率 f_x [Hz] */
  fx: number
  /** tone code 的 peak 振幅 A（spec lesson 用 A = 1） */
  toneA: number
  /** in-band 積分上限 f_BW [Hz]（理想 brick-wall，0…f_BW） */
  fBw: number
  /** PLL 形狀（output T、PD H_PD） */
  pll: PllShape
  /** output / PD jitter 積分範圍 [Hz] */
  fL: number
  fH: number
}

export interface CodeSpectraRow {
  kind: CodeKind
  code: CodeSpec
  /** δt 總 RMS = √(E[x²])·σ_w [fs] */
  totalRms: number
  /** 0…f_BW 的 δt RMS（brick-wall）[fs] */
  inbandRms: number
  /** in-band 功率比例 */
  inbandFraction: number
  /** ∫_{fL}^{fH}|T|²S_δt df 的平方根：output timing jitter [fs] */
  outRms: number
  /** ∫_{fL}^{fH}|H_PD|²S_δt df 的平方根：PD residual [fs] */
  pdRms: number
  /** 積分是否用了遠端近似 */
  approx: boolean
}

export interface CodeSpectraResult {
  loop: CalLoop
  rows: CodeSpectraRow[]
  warnings: string[]
}

/** 三種 code（常數 / 單頻 / ±1 隨機）的 δt 頻譜指標（解析，數值積分）。worker 可呼叫。 */
export function codeSpectraAnalytic(prm: CodeSpectraParams): CodeSpectraResult {
  const loop = calLoop({ ...prm, etaR: 0 }) // 此處只處理白色 η（F-12.13/14 的 S_w 用白色 S_η）
  const warnings = [...loop.warnings]
  const codes: Record<CodeKind, CodeSpec> = {
    const: { m: 1, A: 0, fx: 0, whiteVar: 0 },
    tone: { m: 0, A: prm.toneA, fx: prm.fx, whiteVar: 0 },
    white: { m: 0, A: 0, fx: 0, whiteVar: 1 },
  }
  if (!(Math.abs(loop.p) < 1) || !(prm.C > 0) || !(prm.sigmaV > 0)) {
    return { loop, rows: [], warnings: [...warnings, String.raw`迴路不穩定或極性錯誤：不存在穩態 $\delta w$，$\delta t$ 頻譜無定義。`] }
  }
  const sys: MixSystem = { fs: prm.fs, N: prm.N, mu: prm.mu, p: loop.p, sEta: loop.sigmaEta2 }
  const rows: CodeSpectraRow[] = (['const', 'tone', 'white'] as CodeKind[]).map((kind) => {
    const code = codes[kind]
    const total = dtTotalPower(code, sys)
    const fn = (f: number) => dtPsdOneSided(f, code, sys)
    const tol = 1e-9 * total
    const brIn = mixBreakpoints(loop.fu, code.fx, prm.fBw)
    const inb = integrateWithBreaks(fn, 0, Math.min(prm.fBw, prm.fs / 2), brIn, tol)
    const brOut = mixBreakpoints(loop.fu, code.fx, prm.fH, 6000)
    const out = integrateWithBreaks((f) => tMag2(f, prm.pll) * fn(f), prm.fL, Math.min(prm.fH, prm.fs / 2), brOut, tol)
    const pd = integrateWithBreaks((f) => hpdMag2(f, prm.pll) * fn(f), prm.fL, Math.min(prm.fH, prm.fs / 2), brOut, tol)
    return {
      kind,
      code,
      totalRms: Math.sqrt(total),
      inbandRms: Math.sqrt(inb.value),
      inbandFraction: inb.value / total,
      outRms: Math.sqrt(out.value),
      pdRms: Math.sqrt(pd.value),
      approx: inb.approx || out.approx || pd.approx,
    }
  })
  if (prm.fx + 3 * loop.f3dbExact > prm.fBw && prm.fx < prm.fBw) {
    warnings.push(String.raw`tone code 的 $\delta w$ 邊帶（$f_x\pm$ 數個 $f_{3\mathrm{dB}}$）超出 in-band 上限 $f_{BW}=${texNum(prm.fBw)}$ Hz，in-band RMS 會小於 $A\sigma_w/\sqrt2$。`)
  }
  if (prm.fH > prm.fs / 2) warnings.push(String.raw`$f_H$ 超過 Nyquist $f_s/2$，已截在 $f_s/2$。`)
  if (rows.some((r) => r.approx)) warnings.push(String.raw`積分斷點過多（$f_H/f_u$ 很大），遠端以對數格點近似；數值為 [近似]。`)
  return { loop, rows, warnings }
}

/** 畫圖用：對數頻率格點上的三種 δt PSD 與 |T|²、|H_PD|²。 */
export function codeSpectraCurves(prm: CodeSpectraParams, nPts = 1200): {
  f: Float64Array
  dt: Record<CodeKind, Float64Array>
  t2: Float64Array
  hpd2: Float64Array
  sw1: Float64Array
} {
  const loop = calLoop({ ...prm, etaR: 0 })
  const sys: MixSystem = { fs: prm.fs, N: prm.N, mu: prm.mu, p: loop.p, sEta: loop.sigmaEta2 }
  const fLo = Math.max(1, Math.min(prm.fL, loop.fu / 1000))
  const fHi = prm.fs / 2
  const f = new Float64Array(nPts)
  for (let i = 0; i < nPts; i++) f[i] = fLo * Math.pow(fHi / fLo, i / (nPts - 1))
  const codes: Record<CodeKind, CodeSpec> = {
    const: { m: 1, A: 0, fx: 0, whiteVar: 0 },
    tone: { m: 0, A: prm.toneA, fx: prm.fx, whiteVar: 0 },
    white: { m: 0, A: 0, fx: 0, whiteVar: 1 },
  }
  const dt = {} as Record<CodeKind, Float64Array>
  const ok = Math.abs(loop.p) < 1 && prm.C > 0 && prm.sigmaV > 0
  for (const k of ['const', 'tone', 'white'] as CodeKind[]) {
    dt[k] = f.map((ff) => (ok ? dtPsdOneSided(ff, codes[k], sys) : NaN))
  }
  return {
    f,
    dt,
    t2: f.map((ff) => tMag2(ff, prm.pll)),
    hpd2: f.map((ff) => hpdMag2(ff, prm.pll)),
    sw1: f.map((ff) => (ok ? swZohOneSided(ff, prm.fs, prm.N, prm.mu, loop.p, loop.sigmaEta2) : NaN)),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Spur（§12.4；T15）
// ───────────────────────────────────────────────────────────────────────────

/** 整數階 Bessel 函數 J_n(x)（冪級數；|x| ≲ 20 時雙精度足夠）。 */
export function besselJ(n: number, x: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`besselJ：n 必須為非負整數，收到 ${n}`)
  const h = x / 2
  let term = 1
  for (let i = 1; i <= n; i++) term *= h / i // (x/2)^n / n!
  let sum = term
  const h2 = h * h
  for (let k = 1; k < 200; k++) {
    term *= -h2 / (k * (k + n))
    sum += term
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break
  }
  return sum
}

// #region core:spur
/**
 * 調變指數 β = 2π·f_out·|T|·A_t [rad]。
 * A_t：DTC 端 δt tone 的 peak [fs]；經 PLL 的 |T(f_m)| 之後，output timing tone 的 peak 是 |T|·A_t（|T| = 1 時兩者相同，T15）。
 */
export function spurBeta(fOutHz: number, atPeakFs: number, tMag = 1): number {
  return fsToRad(atPeakFs * tMag, fOutHz) // 2π f_out (|T| A_t)·1e−15
}

/** 小角 PM：每個單邊 spur ≈ 20·log10(β/2) [dBc]。 */
export function spurDbcSmallAngle(beta: number): number {
  return 20 * Math.log10(beta / 2) // ← cos(β sin) ≈ 1、sin(β sin) ≈ β sin
}

/** 單一正弦 PM 的精確 sideband/carrier：20·log10(J₁(β)/J₀(β)) [dBc]。 */
export function spurDbcBessel(beta: number): number {
  return 20 * Math.log10(besselJ(1, beta) / besselJ(0, beta)) // ← Jacobi–Anger 展開，不做小角近似
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 亂數輔助：精確 Binomial 抽樣
// ───────────────────────────────────────────────────────────────────────────

/**
 * 精確 Binomial(n, p) 抽樣（inversion；由 mode 往兩側交替累加 pmf，期望步數 O(√(np(1−p)))）。
 * 給定 u ~ U(0,1)，回傳 k。任何固定的列舉順序做 inversion 都得到正確分布。
 * （建議上移到 core/rng.ts。）
 */
export function binomialFromUniform(n: number, p: number, u: number): number {
  if (!(n >= 1) || p <= 0) return 0
  if (p >= 1) return n
  const q = 1 - p
  const mode = Math.min(n, Math.floor((n + 1) * p))
  const pm = binomPmf(mode, n, p)
  let acc = pm
  if (u <= acc) return mode
  let lo = mode
  let hi = mode
  let pLo = pm
  let pHi = pm
  const r = p / q
  const tiny = 1e-20 * pm
  while (lo > 0 || hi < n) {
    if (hi < n) {
      pHi *= ((n - hi) / (hi + 1)) * r
      hi++
      acc += pHi
      if (u <= acc) return hi
    }
    if (lo > 0) {
      pLo *= lo / ((n - lo + 1) * r)
      lo--
      acc += pLo
      if (u <= acc) return lo
    }
    if ((hi >= n || pHi < tiny) && (lo <= 0 || pLo < tiny)) break
  }
  return mode // u 落在捨入誤差區（機率 < 1e−15）
}

// ───────────────────────────────────────────────────────────────────────────
// LMS Noise Lab：三種模擬引擎（T13 / T14）
// ───────────────────────────────────────────────────────────────────────────

export type NoiseEngine = 'linear' | 'binomial' | 'sample'

export const ENGINE_LABEL: Record<NoiseEngine, string> = {
  linear: '(a) 線性化遞迴（F-12.2）',
  binomial: '(b) 精確 Block Sign-LMS（±1 code，Binomial 化簡）',
  sample: '(c) 逐 sample Block Sign-LMS（runBlockLms）',
}

/** 引擎的內部狀態：上一個 block 的 η（只有 colored η 的引擎 (a) 會用到） */
export interface EngineState {
  eta: number
}

// #region core:linearStep
/** 引擎 (a)：線性化遞迴，η_k ~ N(0, σ_η²)（r ≠ 0 時為 AR(1)：η_k = rη_{k−1} + √(1 − r²)σ_η ε_k）。 */
function linearStep(dw: number, lp: CalLoop, rng: Rng, st: EngineState): number {
  const r = lp.input.etaR // r = 0：白色（規格 §12.1 的 iid 假設）
  st.eta = r * st.eta + Math.sqrt((1 - r * r) * lp.sigmaEta2) * rng.normal() // Gaussian GMAC 雜訊
  const G = -lp.K * dw * gScale(lp) + st.eta // ← 差異：G 是 δw 的線性函數（小訊號 K_q）
  return dw + lp.input.mu * G
}
// #endregion

// #region core:binomialStep
/** 引擎 (b)：x = ±1 iid、Gaussian v 時 Σq·x = 2·Binomial(N, Φ(C(a−w)/σ_v)) − N（精確，非線性）。 */
function binomialStep(dw: number, lp: CalLoop, rng: Rng): number {
  const { N, C, sigmaV, mu, gmMode } = lp.input
  const pPlus = sigmaV > 0 ? normCdf((-C * dw) / sigmaV) : signProb(-C * dw) // P(q·x = +1)，a − w = −δw（E33）
  const k = binomialFromUniform(N, pPlus, rng.uniform()) // ← 差異：真的 1-bit 比較，G 有界 |G| ≤ 1
  const G = (2 * k - N) / (gmMode === 'sum' ? 1 : N) // average 或 sum
  return dw + mu * G
}
// #endregion

/**
 * σ_v = 0 的極限（無雜訊、硬限幅）：P(q·x = +1) = 1 / 0；e = 0 時採 comparator 慣例 e ≥ 0 ⇒ q = +1（規格 §15.2），
 * 於是 q·x = x，而 ±1 iid code 的 x = +1 機率為 ½。
 */
function signProb(e: number): number {
  return e > 0 ? 1 : e < 0 ? 0 : 0.5
}

function gScale(lp: CalLoop): number {
  return lp.input.gmMode === 'sum' ? lp.input.N : 1
}

export interface NoiseLabSimParams extends CalLoopInput {
  engine: NoiseEngine
  /** 每條 chain 的穩態 block 數（burn-in 之後） */
  blocks: number
  /** 獨立 chain 數（各用 deriveSeed(seed, r)） */
  chains: number
  /** burn-in block 數（預設 max(50, 10τ)） */
  burnIn?: number
  /** chain 0 的初始偏差 δw_0 = w_0 − w* [fs]（顯示收斂；其他 chain 由 w* 起跑） */
  dw0?: number
  seed: number
  /** Welch 的 segment 長度 [blocks]（預設 512） */
  nperseg?: number
  /** trace 最多點數（預設 3000） */
  traceMax?: number
}

export interface NoiseLabSimResult {
  engine: NoiseEngine
  loop: CalLoop
  /** 每條 chain 穩態段的 σ_w（ddof = 1）[fs] */
  sigmaWChains: Float64Array
  /** √(mean σ²) [fs] */
  sigmaW: number
  /** σ_w 的 95% 信賴區間 [fs] */
  sigmaWLo: number
  sigmaWHi: number
  /** 穩態段 δw 平均（應 ≈ 0；Sign-LMS 的 w* 偏移）[fs] */
  meanDw: number
  /** lag-1 自相關（AR(1) 模型下即 p 的估計） */
  pHat: number
  /** 由 p̂ 推得的 exact f_3dB 與 ENBW [Hz] */
  f3dbFromPHat: number
  enbwFromPHat: number
  /** chain 0 的 δw 軌跡（含 burn-in，可能抽點） */
  trace: { k: Float64Array; dw: Float64Array }
  /** 穩態 δw 的 Welch PSD（chain 平均；單邊 fs²/Hz；取樣率 f_u）與同格點的解析 S_w^(1) */
  psd: { f: Float64Array; sim: Float64Array; analytic: Float64Array; nperseg: number; enbwHz: number; nSegments: number; window: string; df: number }
  diverged: boolean
  divergenceBlock: number | null
  /** 實際模擬的 comparator 樣本數（sample 引擎）或 block 數 */
  workUnits: number
  warnings: string[]
}

/** 自動 burn-in：max(50, 10τ, 10τ_η)（τ 不存在時 200；τ_η = −1/ln|r| 為 colored η 的相關時間） */
export function autoBurnIn(lp: CalLoop): number {
  const r = Math.abs(lp.input.etaR)
  const tauEta = r > 0 && r < 1 ? -1 / Math.log(r) : 0
  return Number.isFinite(lp.tauBlocks) ? Math.max(50, Math.ceil(10 * lp.tauBlocks), Math.ceil(10 * tauEta)) : 200
}

/** 以 runBlockLms 做 sample-level 模擬時使用的設定（C ≠ 1 時用單 tap FIR path 讓 u = C·x）。 */
export function sampleLevelConfig(prm: NoiseLabSimParams, chain: number, totalBlocks: number): BlockLmsConfigInput {
  const a = 3
  return {
    seed: deriveSeed(prm.seed, `sample-chain-${chain}`),
    sample_rate_hz: prm.fs,
    gm_accum_samples: prm.N,
    gain_true: a,
    gain_initial: a + (chain === 0 ? (prm.dw0 ?? 0) : 0),
    gain_step: prm.mu,
    code_normalization: 'unit_rms',
    gm_mode: prm.gmMode ?? 'average',
    pd_noise_rms_fs: prm.sigmaV,
    pll_error_path: prm.C === 1 ? { kind: 'identity', parameters: {} } : { kind: 'fir', parameters: { taps: [prm.C] } },
    seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
    num_blocks: totalBlocks,
    record: { sample_trace_blocks: 0, decimate: 1 },
  }
}

/**
 * LMS Noise Lab 的 Monte Carlo（worker 可呼叫）：依 engine 跑 chains 條獨立 chain，
 * 回傳 σ_w（含 95% CI）、p̂、Welch PSD 與 chain 0 的收斂軌跡。
 */
export function runNoiseLab(prm: NoiseLabSimParams): NoiseLabSimResult {
  const lp = calLoop(prm)
  const warnings = [...lp.warnings]
  const chains = Math.max(1, Math.floor(prm.chains))
  const M = Math.max(16, Math.floor(prm.blocks))
  const burn = Math.max(0, Math.floor(prm.burnIn ?? autoBurnIn(lp)))
  const total = burn + M
  const rootSeed = prm.seed >>> 0
  const nperseg = Math.min(prm.nperseg ?? 512, M)
  const traceMax = prm.traceMax ?? 3000
  const sigmaChains = new Float64Array(chains)
  let diverged = false
  let divergenceBlock: number | null = null
  let workUnits = 0
  let traceDw = new Float64Array(0)
  let traceStride = 1
  let psdSum: Float64Array | null = null
  let psdF = new Float64Array(0)
  let psdMeta = { nperseg, enbwHz: NaN, nSegments: 0, window: 'hann', df: NaN }
  let num = 0
  let den = 0
  let meanAcc = 0
  let psdCount = 0

  if (prm.engine === 'sample') {
    const samples = prm.N * total * chains
    if (samples > MAX_SAMPLE_LEVEL_SAMPLES) {
      throw new Error(String.raw`sample-level 引擎總樣本數 $N\times$ blocks $\times$ chains $=${samples}$ 超過上限 $${MAX_SAMPLE_LEVEL_SAMPLES}$；請減少 blocks / chains 或改用引擎 (b)。`)
    }
  } else if (prm.engine === 'binomial' && !(prm.sigmaV > 0)) {
    warnings.push(String.raw`$\sigma_v=0$：Binomial 引擎退化為確定性 sign（$e=0$ 時 $q=+1$），$\delta w$ 在 $w^*$ 附近以 $\pm\mu$ 的 limit cycle 跳動，不是隨機雜訊。`)
  }
  if (prm.engine === 'linear' && !Number.isFinite(lp.K)) {
    throw new Error(String.raw`$\sigma_v=0$ 時線性化引擎沒有定義（$K_q=\infty$）；請改用引擎 (b) 或 (c)。`)
  }
  if (prm.engine === 'linear' && !(Math.abs(lp.input.etaR) < 1)) {
    throw new Error(String.raw`colored $\eta$ 的 $r=${texNum(lp.input.etaR, 4)}$ 不合法（需 $|r|<1$）。`)
  }
  if (prm.engine !== 'linear' && lp.input.etaR !== 0) {
    warnings.push(
      String.raw`$S_\eta$ 的 $r=${texNum(lp.input.etaR, 4)}$ 只作用於引擎 (a) 與解析值：引擎 (b)(c) 由真的 1-bit 比較自己產生 $\eta$（iid code 時為白色），所以 Monte Carlo 會對不上 colored 的解析 $\sigma_w$——這是模型差異，不是錯誤。`,
    )
  }

  for (let r = 0; r < chains; r++) {
    const dw = new Float64Array(total + 1)
    dw[0] = r === 0 ? (prm.dw0 ?? 0) : 0
    if (prm.engine === 'sample') {
      const res = runBlockLms(sampleLevelConfig(prm, r, total))
      for (let k = 0; k <= total; k++) dw[k] = res.blocks.w[k] - 3
      workUnits += prm.N * total
      if (res.metrics.diverged) {
        diverged = true
        divergenceBlock ??= res.metrics.divergenceBlock
      }
    } else {
      const rng = createRng(deriveSeed(rootSeed, `${prm.engine}-chain-${r}`))
      if (r > 0 && prm.engine === 'linear' && Number.isFinite(lp.sigmaW)) dw[0] = lp.sigmaW * rng.normal() // 由穩態分布起跑
      const st: EngineState = { eta: 0 }
      if (prm.engine === 'linear' && lp.input.etaR !== 0) st.eta = Math.sqrt(lp.sigmaEta2) * rng.normal() // η 由其穩態分布起跑
      const step = prm.engine === 'linear' ? linearStep : binomialStep
      for (let k = 0; k < total; k++) {
        const nx = step(dw[k], lp, rng, st)
        if (!Number.isFinite(nx) || Math.abs(nx) > NOISE_DIVERGENCE_FS) {
          diverged = true
          divergenceBlock ??= k + 1
          for (let j = k + 1; j <= total; j++) dw[j] = NaN
          break
        }
        dw[k + 1] = nx
      }
      workUnits += total
    }
    if (r === 0) {
      traceStride = Math.max(1, Math.ceil((total + 1) / traceMax))
      traceDw = new Float64Array(Math.ceil((total + 1) / traceStride))
      for (let i = 0, k = 0; k <= total; k += traceStride, i++) traceDw[i] = dw[k]
    }
    // 穩態段統計
    const ss = dw.subarray(burn + 1)
    let s = 0
    let finite = true
    for (let i = 0; i < ss.length; i++) {
      if (!Number.isFinite(ss[i])) {
        finite = false
        break
      }
      s += ss[i]
    }
    if (!finite) {
      sigmaChains[r] = NaN
      continue
    }
    const mu = s / ss.length
    meanAcc += mu
    let v = 0
    const c = new Float64Array(ss.length)
    for (let i = 0; i < ss.length; i++) {
      c[i] = ss[i] - mu
      v += c[i] * c[i]
    }
    for (let i = 0; i + 1 < c.length; i++) num += c[i] * c[i + 1]
    den += v
    sigmaChains[r] = Math.sqrt(v / (ss.length - 1))
    const w = welch(c, lp.fu, { nperseg, window: 'hann', detrend: 'none' })
    if (!psdSum) {
      psdSum = new Float64Array(w.psd.length)
      psdF = w.f
      psdMeta = { nperseg: w.nperseg, enbwHz: w.enbwHz, nSegments: w.nSegments, window: w.window, df: w.df }
    }
    for (let i = 0; i < psdSum.length; i++) psdSum[i] += w.psd[i]
    psdCount++
  }

  const finiteSig = Array.from(sigmaChains).filter((x) => Number.isFinite(x))
  const vars = finiteSig.map((s) => s * s)
  const meanVar = vars.length ? vars.reduce((a, b) => a + b, 0) / vars.length : NaN
  const pHat = den > 0 ? num / den : NaN
  let lo = NaN
  let hi = NaN
  if (vars.length >= 6) {
    // chain 夠多：直接用 chain 間的 Student-t CI（不依賴 AR(1) 假設）
    const ci = meanCI(vars)
    lo = Math.sqrt(Math.max(0, ci.lo))
    hi = Math.sqrt(Math.max(0, ci.hi))
  } else if (vars.length >= 1 && Number.isFinite(pHat) && Math.abs(pHat) < 1) {
    // chain 少：AR(1) 樣本變異數的標準誤 Var(s²) ≈ 2σ⁴(1 + p²)/((1 − p²)M)，再除以 √chains
    const se = meanVar * Math.sqrt((2 * (1 + pHat * pHat)) / ((1 - pHat * pHat) * M * vars.length))
    lo = Math.sqrt(Math.max(0, meanVar - 1.96 * se))
    hi = Math.sqrt(meanVar + 1.96 * se)
  }
  const psdSim = psdSum ? psdSum.map((x) => x / psdCount) : new Float64Array(0)
  psdMeta.nSegments *= psdCount // 只計入有限值（未發散）的 chain
  const okA = Math.abs(lp.p) < 1 && Number.isFinite(lp.K) && Math.abs(lp.input.etaR) < 1
  const psdAnalytic = psdF.map((f) => (okA ? swOneSided(f, prm.mu, lp.p, lp.sigmaEta2, lp.fu, lp.input.etaR) : NaN))
  if (diverged) warnings.push(String.raw`模擬在 block ${divergenceBlock} 發散（$|\delta w|>10^{${Math.round(Math.log10(NOISE_DIVERGENCE_FS))}}$ fs 或非有限值）；穩態統計不適用。`)
  if (!diverged && prm.engine !== 'linear' && prm.sigmaV > 0 && traceDw.length > 2) {
    // 非線性 Sign-LMS 的兩種「失敗」不會數值發散（|G| ≤ 1），必須另外解釋
    const first = traceDw[Math.min(traceDw.length - 1, Math.ceil((burn + 1) / traceStride))]
    const last = traceDw[traceDw.length - 1]
    const span = (traceDw.length - 1) * traceStride - Math.ceil((burn + 1) / traceStride) * traceStride
    if (lp.regime === 'polarity' && span > 0) {
      const rate = (last - first) / span
      warnings.push(
        String.raw`polarity 錯誤時 Sign-LMS 不會指數發散，而是以約 ${Math.abs(rate).toPrecision(3)} fs/block 的速率線性漂移遠離 $w^*$（$|G|\le1$ 限制了每步最多 $\mu=${texNum(prm.mu, 4)}$ fs）；「$\sigma_w$」在此沒有意義。`,
      )
    } else if (lp.regime === 'unstable' && prm.C > 0 && lp.g >= 2 && Number.isFinite(meanVar)) {
      warnings.push(
        String.raw`g ≥ 2 時線性理論沒有穩態，但非線性 Sign-LMS（$|G|\le1$）會在 $w^*$ 兩側做有界振盪：模擬 RMS $\approx${texNum(Math.sqrt(meanVar), 3)}$ fs、lag-1 自相關 $\approx${pHat.toFixed(2)}$——這是 limit-cycle 式的大幅抖動，不是 F-12.5 的雜訊。`,
      )
    }
  }
  if (prm.engine !== 'linear' && Number.isFinite(lp.sigmaW) && prm.C * 3 * lp.sigmaW > 0.3 * prm.sigmaV) {
    warnings.push(String.raw`$3\sigma_wC$ 已超過 $0.3\sigma_v$：comparator 的 $K_q$ 線性化可能失效（S 曲線飽和），解析 $\sigma_w$ 會偏差。`)
  }
  const traceK = new Float64Array(traceDw.length).map((_, i) => i * traceStride)
  return {
    engine: prm.engine,
    loop: lp,
    sigmaWChains: sigmaChains,
    sigmaW: Math.sqrt(meanVar),
    sigmaWLo: lo,
    sigmaWHi: hi,
    meanDw: psdCount ? meanAcc / psdCount : NaN,
    pHat,
    f3dbFromPHat: bw3dbExact(pHat, lp.fu),
    enbwFromPHat: enbwOneSided(pHat, lp.fu),
    trace: { k: traceK, dw: traceDw },
    psd: { f: new Float64Array(psdF), sim: psdSim, analytic: psdAnalytic, ...psdMeta },
    diverged,
    divergenceBlock,
    workUnits,
    warnings,
  }
}

export interface NoiseLabBatchParams {
  /** Case A / B / C 的參數（同一個 seed ⇒ paired simulation：各 case 的 chain r 使用相同的亂數流標籤） */
  cases: { id: string; params: NoiseLabSimParams }[]
}

export interface NoiseLabBatchResult {
  items: { id: string; result: NoiseLabSimResult | null; error: string | null }[]
}

/**
 * 依序跑多個 case（worker 可呼叫）。單一 case 失敗（例如 σ_v = 0 的線性引擎）只影響該 case，
 * 錯誤訊息以字串回傳，其餘 case 照常完成。
 */
export function runNoiseLabBatch(prm: NoiseLabBatchParams): NoiseLabBatchResult {
  return {
    items: prm.cases.map(({ id, params }) => {
      try {
        return { id, result: runNoiseLab(params), error: null }
      } catch (e) {
        return { id, result: null, error: e instanceof Error ? e.message : String(e) }
      }
    }),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 三種 code 頻譜的模擬驗證（0.399 / 0.282 / 0.009 fs）
// ───────────────────────────────────────────────────────────────────────────

export interface CodeSpectraSimParams extends CalLoopInput {
  fx: number
  toneA: number
  fBw: number
  /** 每條 chain 的 block 數（L = N·blocks 個 sample 做一次整段 FFT） */
  blocks: number
  chains: number
  seed: number
  /** δw 產生方式：線性遞迴或精確 Binomial Sign-LMS */
  engine: 'linear' | 'binomial'
}

export interface CodeSpectraSimRow {
  kind: CodeKind
  /** 每條 chain 的 in-band RMS [fs] */
  inbandChains: Float64Array
  inbandRms: number
  inbandLo: number
  inbandHi: number
  /** in-band 功率比例 = Σ_r P_in,r / Σ_r P_tot,r（ratio of sums；CI 用 jackknife） */
  fractionMean: number
  fractionLo: number
  fractionHi: number
  /** 該 chain δt 的時域總 RMS（Parseval 核對用）[fs] */
  totalRms: number
}

export interface CodeSpectraSimResult {
  rows: CodeSpectraSimRow[]
  /** 每條 chain 的 δw 樣本標準差 [fs] */
  sigmaWChains: Float64Array
  samplesPerChain: number
  fftLength: number
  binHz: number
  warnings: string[]
}

/** Σa/Σb 的 jackknife 95% CI（Student-t，R − 1 自由度） */
export function ratioJackknife(a: number[], b: number[]): { mean: number; lo: number; hi: number } {
  const R = a.length
  const A = a.reduce((x, y) => x + y, 0)
  const Bs = b.reduce((x, y) => x + y, 0)
  const mean = A / Bs
  if (R < 2) return { mean, lo: NaN, hi: NaN }
  const th = a.map((ai, i) => (A - ai) / (Bs - b[i]))
  const tb = th.reduce((x, y) => x + y, 0) / R
  const se = Math.sqrt(((R - 1) / R) * th.reduce((x, y) => x + (y - tb) ** 2, 0))
  const t = studentTInv(0.975, R - 1)
  return { mean, lo: mean - t * se, hi: mean + t * se }
}

/**
 * 逐 sample 產生 δt[n] = x[n]·δw_{⌊n/N⌋}（ZOH），整段 FFT 後把 0…f_BW 的 bin 能量加總（Parseval），
 * 驗證三種 code 的 in-band RMS。worker 可呼叫（L = N·blocks 建議 ≤ 2²¹）。
 */
export function simulateCodeSpectra(prm: CodeSpectraSimParams): CodeSpectraSimResult {
  const lp = calLoop({ ...prm, etaR: 0 }) // 與解析版一致：白色 η
  if (!(Math.abs(lp.p) < 1) || !(prm.C > 0) || !(prm.sigmaV > 0)) {
    throw new Error(String.raw`迴路不穩定、極性錯誤或 $\sigma_v=0$：沒有穩態 $\delta w$ 可供驗證。`)
  }
  const N = prm.N
  const B = Math.max(2, Math.floor(prm.blocks))
  const L = N * B
  if (L > 2 ** 23) throw new Error(String.raw`FFT 長度 $N\cdot$ blocks $=${L}$ 過大（上限 $2^{23}$）；請減少 blocks。`)
  const chains = Math.max(1, Math.floor(prm.chains))
  const binHz = prm.fs / L
  const kBw = Math.min(Math.floor(prm.fBw / binHz), Math.floor(L / 2))
  const kinds: CodeKind[] = ['const', 'tone', 'white']
  const inb: Record<CodeKind, number[]> = { const: [], tone: [], white: [] }
  const tot: Record<CodeKind, number[]> = { const: [], tone: [], white: [] }
  const sigmaWChains = new Float64Array(chains)
  const burn = autoBurnIn(lp)
  const re = new Float64Array(L)
  const im = new Float64Array(L)
  const warnings: string[] = [...lp.warnings]
  if (binHz > lp.f3dbExact / 2) warnings.push(String.raw`FFT bin ${binHz.toFixed(1)} Hz 比 $f_{3\mathrm{dB}}/2$ 粗：低頻峰值解析度不足，請加大 blocks。`)
  const thetaX = (2 * Math.PI * prm.fx) / prm.fs
  for (let r = 0; r < chains; r++) {
    const rng = createRng(deriveSeed(prm.seed >>> 0, `code-spectra-${r}`))
    // δw：由穩態起跑（線性）或 burn-in（Binomial）
    const dw = new Float64Array(B)
    let state = prm.engine === 'linear' ? lp.sigmaW * rng.normal() : 0
    const st: EngineState = { eta: 0 }
    const step = prm.engine === 'linear' ? linearStep : binomialStep
    if (prm.engine === 'binomial') for (let k = 0; k < burn; k++) state = step(state, lp, rng, st)
    for (let k = 0; k < B; k++) {
      dw[k] = state
      state = step(state, lp, rng, st)
    }
    let s = 0
    let s2 = 0
    for (let k = 0; k < B; k++) {
      s += dw[k]
      s2 += dw[k] * dw[k]
    }
    sigmaWChains[r] = Math.sqrt((s2 - (s * s) / B) / (B - 1))
    const phase = 2 * Math.PI * rng.uniform()
    const codeRng = rng.fork('white-code')
    for (const kind of kinds) {
      // #region core:codeMixSim
      for (let n = 0; n < L; n++) {
        const w = dw[Math.floor(n / N)] // ← ZOH：δw 每 N 個 sample 才更新一次（E09）
        const x = kind === 'const' ? 1 : kind === 'tone' ? prm.toneA * Math.cos(thetaX * n + phase) : codeRng.sign()
        re[n] = x * w // δt[n] = x[n]·δw[n]：乘法，不是加法
        im[n] = 0
      }
      // #endregion
      let pt = 0
      for (let n = 0; n < L; n++) pt += re[n] * re[n]
      pt /= L
      fft(re, im)
      // 實數訊號：in-band 功率 = (|X₀|² + 2Σ_{k=1}^{K}|X_k|²)/L²（Parseval）；Nyquist bin（k = L/2）沒有鏡像，權重為 1
      let pin = re[0] * re[0] + im[0] * im[0]
      for (let k = 1; k <= kBw; k++) pin += (2 * k === L ? 1 : 2) * (re[k] * re[k] + im[k] * im[k])
      pin /= L * L
      inb[kind].push(Math.sqrt(pin))
      tot[kind].push(Math.sqrt(pt))
    }
  }
  const rows: CodeSpectraSimRow[] = kinds.map((kind) => {
    const pw = inb[kind].map((x) => x * x)
    const ciP = pw.length >= 2 ? meanCI(pw) : { mean: pw[0], lo: NaN, hi: NaN }
    // in-band 比例：ratio of sums（每條 chain 各自相除會有 Jensen 偏差：短紀錄的總功率起伏大）
    const pin = pw
    const ptot = tot[kind].map((x) => x * x)
    const ciF = ratioJackknife(pin, ptot)
    const totP = ptot.reduce((a, b) => a + b, 0) / ptot.length
    return {
      kind,
      inbandChains: Float64Array.from(inb[kind]),
      inbandRms: Math.sqrt(ciP.mean),
      inbandLo: Math.sqrt(Math.max(0, ciP.lo)),
      inbandHi: Math.sqrt(Math.max(0, ciP.hi)),
      fractionMean: ciF.mean,
      fractionLo: ciF.lo,
      fractionHi: ciF.hi,
      totalRms: Math.sqrt(totP),
    }
  })
  return { rows, sigmaWChains, samplesPerChain: L, fftLength: L, binHz, warnings }
}

// ───────────────────────────────────────────────────────────────────────────
// Code Mixing Lab（§12.2、§12.4；T15）
// ───────────────────────────────────────────────────────────────────────────

export interface MixingSimParams {
  /** 模擬（顯示）取樣率 [Hz]：只需 > 2·(f_x + f_w)，乘積關係與取樣率無關 */
  fsim: number
  /** 紀錄長度 [samples] */
  L: number
  /** code：x[n] = m + A·cos(2π f_x n/f_sim) + ±σ_white 隨機 */
  fx: number
  A: number
  m: number
  codeWhite: number
  /** 係數擾動 tone：δw = B·cos(2π f_w t) [fs] */
  fw: number
  B: number
  /** δw 每 holdN 個 sample 更新一次（ZOH；1 = 連續） */
  holdN: number
  /** 另加隨機係數雜訊（block rate f_sim/holdN 的 AR(1)）：σ [fs] 與 pole p */
  dwNoiseSigma: number
  dwNoiseP: number
  /** PLL 輸出頻率 [Hz] 與 |T|（在 tone 頻率處，視為常數） */
  fOut: number
  Tmag: number
  window: WindowName
  seed: number
  /** 回傳的時域點數（預設 600） */
  traceLen?: number
}

export interface MixingTone {
  label: string
  /** 同一個標籤的 TeX 版本（頁面表格用） */
  tex: string
  /** δt tone 頻率 = spur offset [Hz] */
  f: number
  /** 解析預測 peak [fs] */
  predFs: number
  /** toneFit 量測 peak [fs] */
  measFs: number
  /** 量測 β = 2π f_out |T| A_t [rad] */
  beta: number
  dbcSmall: number
  dbcBessel: number
  coherent: boolean
}

export interface MixingSimResult {
  trace: { tUs: Float64Array; x: Float64Array; dw: Float64Array; dt: Float64Array }
  /** δt 的功率頻譜（spectrum scaling，fs² per bin，one-sided） */
  spec: { f: Float64Array; p: Float64Array; enbwHz: number; df: number; window: string }
  /** output phase 的 spur 讀數：10log10(P_φ,bin/2) [dBc]（tone bin 即 spur dBc） */
  phaseDbc: Float64Array
  tones: MixingTone[]
  /** e^{jφ} 的 FFT 直接量測某一根 tone 的 sideband（不做小角近似）[dBc]；沒有離散 tone 時為 NaN */
  pmFftDbc: number
  /** pmFftDbc 量的是哪一根 tone（優先 f_x + f_w，否則第一根）；沒有 tone 時為 null */
  pmFftLabel: string | null
  dtRms: number
  phaseRmsRad: number
  /**
   * 隨機成分的 Monte Carlo 核對（無隨機成分時為 null）：時間平均 δt² 與其期望值
   * E[δt²] = mean_n (x_det[n]² + c_w²)(δw_det[n]² + σ²)（x 與 δw 的隨機部分獨立）比較，標準誤用 batch means。
   */
  msCheck: MixingMsCheck | null
  warnings: string[]
}

export interface MixingMsCheck {
  /** 預測的時間平均 E[δt²] [fs²] */
  pred: number
  /** 量測的時間平均 δt² [fs²] */
  meas: number
  /** batch-means 標準誤 [fs²] */
  se: number
  /** (meas − pred)/se */
  z: number
  /** batch 數（0 = 紀錄太短，無法判定） */
  batches: number
  /** 判定門檻（Student-t 99.5% 分位數；batches − 1 自由度） */
  zCrit: number
}

/** 簡化的交叉比對狀態（與 @/components 的 CheckStatus 相同字串；simulation 層不 import UI） */
export type SimCheckStatus = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'

/**
 * Code Mixing Lab 的誠實交叉比對：
 * - analytic：可預測的 tone（積化和差 AB/2、DC 項 mB，含 ZOH 權重；同頻率的產物以相量和預測）與 toneFit 量測比較；
 *   純確定性時容差 1e-9（相對），有隨機成分時 5%（隨機雜訊會擾動最小平方擬合）。
 * - monteCarlo：有隨機成分時檢查 δt 均方值與期望值（batch-means z 檢定，99% 雙尾）；沒有隨機成分時 n/a。
 */
export function mixingCrossCheck(
  prm: Pick<MixingSimParams, 'dwNoiseSigma' | 'codeWhite'>,
  r: MixingSimResult,
): { analytic: { status: SimCheckStatus; note: string }; monteCarlo: { status: SimCheckStatus; note: string } } {
  const random = prm.dwNoiseSigma > 0 || prm.codeWhite > 0
  const det = r.tones.filter((t) => Number.isFinite(t.predFs))
  const tolOf = (pred: number) => (random ? 0.05 * Math.abs(pred) : 1e-9 * Math.max(1, Math.abs(pred)))
  const bad = det.filter((t) => !(Math.abs(t.measFs - t.predFs) <= tolOf(t.predFs)))
  const analytic: { status: SimCheckStatus; note: string } = det.length
    ? {
        status: bad.length ? 'mismatch' : 'ok',
        note: bad.length
          ? String.raw`toneFit 與積化和差預測（$AB/2$、$mB$，含 ZOH 權重）不符：${bad.map((t) => `$${t.tex}$`).join('、')}`
          : String.raw`${det.length} 根 tone：toneFit = 積化和差預測（容差${random ? ' 5%，因有隨機成分' : String.raw`：相對 $10^{-9}$`}）`,
      }
    : { status: 'n/a', note: '沒有可預測的離散 tone（例如只有隨機成分）' }
  let monteCarlo: { status: SimCheckStatus; note: string }
  const c = r.msCheck
  if (!random || !c) monteCarlo = { status: 'n/a', note: '純確定性訊號（沒有亂數，不需 Monte Carlo）' }
  else if (!(c.batches >= 8)) monteCarlo = { status: 'n/a', note: String.raw`紀錄長度相對 AR(1) 相關時間太短（batch 數 $<8$），無法判定；請加大 $L$` }
  else {
    const ok = Math.abs(c.z) <= c.zCrit
    monteCarlo = {
      status: ok ? 'ok' : 'mismatch',
      note: String.raw`$\delta t$ 均方 $${texNum(c.meas, 5)}$ vs 期望 $${texNum(c.pred, 5)}\ \mathrm{fs}^2$（$z=${c.z.toFixed(2)}$，門檻 $\pm${c.zCrit.toFixed(2)}$，${c.batches} batches）`,
    }
  }
  return { analytic, monteCarlo }
}

/** 是否落在整數 bin（coherent sampling） */
export function isCoherent(f: number, fsim: number, L: number): boolean {
  const k = (f * L) / fsim
  return Math.abs(k - Math.round(k)) < 1e-9 * Math.max(1, Math.abs(k))
}

/** ZOH 對 tone 的振幅權重 |sin(πf·holdN/f_sim)/(holdN·sin(πf/f_sim))| */
export function zohGain(f: number, fsim: number, holdN: number): number {
  if (holdN <= 1) return 1
  const a = Math.sin((Math.PI * f) / fsim)
  if (Math.abs(a) < 1e-300) return 1
  return Math.abs(Math.sin((Math.PI * f * holdN) / fsim) / (holdN * a))
}

/** Code × coefficient 的時域乘積、頻譜、spur 表（worker 可呼叫）。 */
export function simulateMixing(prm: MixingSimParams): MixingSimResult {
  const L = Math.floor(prm.L)
  if (!(L >= 64) || L > 2 ** 20) throw new Error(String.raw`紀錄長度 $L$ 必須在 $64\ldots2^{20}$，收到 ${prm.L}`)
  if (!(prm.fsim > 0)) throw new Error(String.raw`$f_{\mathrm{sim}}$ 必須為正`)
  const warnings: string[] = []
  const nyq = prm.fsim / 2
  if (prm.fx + prm.fw >= nyq) warnings.push(String.raw`$f_x+f_w=${texNum(prm.fx + prm.fw)}$ Hz $\ge f_{\mathrm{sim}}/2=${texNum(nyq)}$ Hz：混頻產物會 alias（反面測試：低取樣率的 aliasing）。`)
  const hold = Math.max(1, Math.floor(prm.holdN))
  const rng = createRng(prm.seed >>> 0)
  const codeRng = rng.fork('code-white')
  const noiseRng = rng.fork('dw-noise')
  const x = new Float64Array(L)
  const dw = new Float64Array(L)
  const dt = new Float64Array(L)
  const wx = (2 * Math.PI * prm.fx) / prm.fsim
  const ww = (2 * Math.PI * prm.fw) / prm.fsim
  const pN = Math.max(-0.999999, Math.min(0.999999, prm.dwNoiseP))
  let ar = prm.dwNoiseSigma > 0 ? prm.dwNoiseSigma * noiseRng.normal() : 0
  const arScale = prm.dwNoiseSigma * Math.sqrt(1 - pN * pN)
  let held = 0
  let heldDet = 0
  const random = prm.dwNoiseSigma > 0 || prm.codeWhite > 0
  const ms = random ? new Float64Array(L) : null // 每個 sample 的 E[δt[n]²]（給 Monte Carlo 核對用）
  const sig2 = prm.dwNoiseSigma > 0 ? prm.dwNoiseSigma * prm.dwNoiseSigma : 0
  const cw2 = prm.codeWhite > 0 ? prm.codeWhite * prm.codeWhite : 0
  for (let n = 0; n < L; n++) {
    if (n % hold === 0) {
      heldDet = prm.B * Math.cos(ww * n)
      held = heldDet + ar // block 起點取樣後保持（ZOH）
      if (prm.dwNoiseSigma > 0) ar = pN * ar + arScale * noiseRng.normal()
    }
    // #region core:mixingProduct
    x[n] = prm.m + prm.A * Math.cos(wx * n) + (prm.codeWhite > 0 ? prm.codeWhite * codeRng.sign() : 0)
    dw[n] = held
    dt[n] = x[n] * dw[n] // ← δt = x·δw：乘法把 f_w 搬到 f_x ± f_w（不是 f_x 與 f_w 兩根線）
    // #endregion
    if (ms) {
      const xd = prm.m + prm.A * Math.cos(wx * n)
      ms[n] = (xd * xd + cw2) * (heldDet * heldDet + sig2)
    }
  }
  let msCheck: MixingMsCheck | null = null
  if (ms) {
    // batch means：batch 長度至少 20 個相關時間（AR(1) 在 sample 軸的相關時間約 hold/(1 − |p|)）
    const tauS = prm.dwNoiseSigma > 0 ? hold / Math.max(1e-9, 1 - Math.abs(pN)) : 1
    const nb = Math.min(32, Math.floor(L / Math.max(1, 20 * tauS)))
    let pred = 0
    let meas = 0
    for (let n = 0; n < L; n++) {
      pred += ms[n]
      meas += dt[n] * dt[n]
    }
    pred /= L
    meas /= L
    let se = NaN
    let z = NaN
    let zCrit = NaN
    if (nb >= 2) {
      const len = Math.floor(L / nb)
      const bm: number[] = []
      for (let b = 0; b < nb; b++) {
        let acc = 0
        for (let n = b * len; n < (b + 1) * len; n++) acc += dt[n] * dt[n] - ms[n]
        bm.push(acc / len)
      }
      const mb = bm.reduce((a, v) => a + v, 0) / nb
      se = Math.sqrt(bm.reduce((a, v) => a + (v - mb) ** 2, 0) / (nb - 1) / nb)
      z = se > 0 ? mb / se : 0 // mb = batch 內 (δt² − E[δt²]) 的平均
      zCrit = studentTInv(0.995, nb - 1)
    }
    msCheck = { pred, meas, se, z, batches: nb >= 2 ? nb : 0, zCrit }
  }
  const zg = zohGain(prm.fw, prm.fsim, hold)
  // ZOH（長度 hold 的 boxcar）讓 δw 的基頻多一個線性相位延遲 (hold − 1)/2 個 sample：
  //   δw[n] 的基頻成分 = B·zg·cos(ω_w n + φ_z)，φ_z = −π f_w (hold − 1)/f_sim
  const phiZ = (-Math.PI * prm.fw * (hold - 1)) / prm.fsim
  // 每個產物以「相量」(re, im) 表示 amp·cos(2πf n + φ)，同頻率的產物才能正確地依相位相加
  interface Cand {
    label: string
    tex: string
    f: number
    re: number
    im: number
    parts: number
  }
  const cand: Cand[] = []
  const half = ((prm.A * prm.B) / 2) * zg // 積化和差：A cos(ω_x n)·B zg cos(ω_w n + φ_z) = (AB zg/2)[cos((ω_x+ω_w)n + φ_z) + cos((ω_x−ω_w)n − φ_z)]
  if (prm.A !== 0 && prm.B !== 0) {
    if (prm.fx > prm.fw) {
      cand.push({ label: 'f_x − f_w', tex: 'f_x-f_w', f: prm.fx - prm.fw, re: half * Math.cos(-phiZ), im: half * Math.sin(-phiZ), parts: 1 })
    } else if (prm.fx < prm.fw) {
      // cos((ω_x − ω_w)n − φ_z) = cos((ω_w − ω_x)n + φ_z)：差頻落在 f_w − f_x
      cand.push({ label: 'f_w − f_x', tex: 'f_w-f_x', f: prm.fw - prm.fx, re: half * Math.cos(phiZ), im: half * Math.sin(phiZ), parts: 1 })
    } // f_x = f_w：差頻是 DC（常數偏移），不是 tone
    cand.push({ label: 'f_x + f_w', tex: 'f_x+f_w', f: prm.fx + prm.fw, re: half * Math.cos(phiZ), im: half * Math.sin(phiZ), parts: 1 })
  }
  if (prm.m !== 0 && prm.B !== 0 && prm.fw > 0) {
    const a = prm.m * prm.B * zg // 直通項 m·δw
    cand.push({ label: 'f_w（DC 項 m·δw）', tex: String.raw`f_w\ (m\,\delta w)`, f: prm.fw, re: a * Math.cos(phiZ), im: a * Math.sin(phiZ), parts: 1 })
  }
  // 同頻率的產物：相量相加（依相位相加或抵消）
  const merged: Cand[] = []
  for (const c of cand.filter((c) => c.f > 0 && c.f < nyq)) {
    const hit = merged.find((u) => Math.abs(u.f - c.f) < 1e-9 * c.f)
    if (hit) {
      hit.label += ` ＋ ${c.label}`
      hit.tex += String.raw`\;\&\;${c.tex}`
      hit.re += c.re
      hit.im += c.im
      hit.parts += c.parts
    } else merged.push({ ...c })
  }
  for (const u of merged) {
    if (u.parts > 1) warnings.push(String.raw`$${u.tex}$ 落在同一頻率 $${texNum(u.f)}$ Hz：預測值是各產物的相量和（依相位相加或抵消）$${texNum(Math.hypot(u.re, u.im))}$ fs，不是單一的 $AB/2$。`)
  }
  const uniq = merged.map((u) => ({ label: u.label, tex: u.tex, f: u.f, pred: Math.hypot(u.re, u.im) }))
  const fitF = uniq.map((c) => c.f)
  const fit = fitF.length ? toneFitMulti(dt, prm.fsim, fitF) : null
  const tones: MixingTone[] = uniq
    .map((c, i) => {
      const meas = fit ? fit.tones[i].amplitudePeak : NaN
      const beta = spurBeta(prm.fOut, meas, prm.Tmag)
      return {
        label: c.label,
        tex: c.tex,
        f: c.f,
        predFs: c.pred,
        measFs: meas,
        beta,
        dbcSmall: spurDbcSmallAngle(beta),
        dbcBessel: spurDbcBessel(beta),
        coherent: isCoherent(c.f, prm.fsim, L),
      }
    })
  if (tones.some((t) => !t.coherent)) {
    warnings.push('部分 tone 不在整數 bin（非 coherent sampling）：FFT 讀數會因 leakage 偏低並散到鄰近 bin；toneFit（最小平方）仍能量到正確 peak。')
  }
  if (hold > 1) {
    const fuTxt = texNum(prm.fsim / hold)
    warnings.push(
      prm.B !== 0
        ? String.raw`$\delta w$ 以 ZOH 每 ${hold} 個 sample 更新（$f_u=${fuTxt}$ Hz）：tone 乘上 sinc 權重 $${zg.toPrecision(6)}$，並在 $kf_u\pm f_w$ 出現 image（E09）。`
        : String.raw`$\delta w$ 以 ZOH 每 ${hold} 個 sample 更新（$f_u=${fuTxt}$ Hz）：沒有週期性 tone（$B=0$），隨機係數雜訊的 sample-rate PSD 帶有 F-12.14 的 Dirichlet 核權重，並在 $kf_u$ 有 notch（E09）。`,
    )
  }
  const ps = periodogram(dt, prm.fsim, { window: prm.window, scaling: 'spectrum', detrend: 'none' })
  const k2 = (2 * Math.PI * prm.fOut * prm.Tmag * 1e-15) ** 2
  const phaseDbc = ps.psd.map((v) => 10 * Math.log10(Math.max((k2 * v) / 2, 1e-300)))
  // e^{jφ}：直接量測 PM sideband（取 f_x + f_w；不存在時取第一個 tone）
  const target = tones.find((t) => t.label === 'f_x + f_w') ?? tones[0]
  let pmFftDbc = NaN
  if (target) {
    const scale = 2 * Math.PI * prm.fOut * prm.Tmag * 1e-15
    const re = new Float64Array(L)
    const im = new Float64Array(L)
    let mean = 0
    for (let n = 0; n < L; n++) mean += dt[n]
    mean /= L
    for (let n = 0; n < L; n++) {
      const phi = -scale * (dt[n] - mean) // φ_out = +T·φ_dtc，φ_dtc = 2π f_out·(−δt)（δt 是多補償的量，殘餘誤差是 −δt）⇒ φ_out = −2π f_out |T| δt；極性不影響 dBc
      re[n] = Math.cos(phi)
      im[n] = Math.sin(phi)
    }
    fft(re, im)
    const kb = Math.round((target.f * L) / prm.fsim)
    pmFftDbc = 10 * Math.log10((re[kb] * re[kb] + im[kb] * im[kb]) / (re[0] * re[0] + im[0] * im[0]))
  }
  const tl = Math.min(L, prm.traceLen ?? 600)
  let s2 = 0
  for (let n = 0; n < L; n++) s2 += dt[n] * dt[n]
  const dtRms = Math.sqrt(s2 / L)
  return {
    trace: {
      tUs: Float64Array.from({ length: tl }, (_, n) => (n / prm.fsim) * 1e6),
      x: x.slice(0, tl),
      dw: dw.slice(0, tl),
      dt: dt.slice(0, tl),
    },
    spec: { f: ps.f, p: ps.psd, enbwHz: ps.enbwHz, df: ps.df, window: String(ps.window) },
    phaseDbc,
    tones,
    pmFftDbc,
    pmFftLabel: target ? target.label : null,
    dtRms,
    phaseRmsRad: 2 * Math.PI * prm.fOut * prm.Tmag * dtRms * 1e-15,
    msCheck,
    warnings,
  }
}
