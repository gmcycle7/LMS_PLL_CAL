/**
 * 1-bit Comparator 在 Gaussian 雜訊下的統計（規格 §5、§5.1；模型層級 L1；Ch05 專用）。
 * 頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼。
 *
 * 模型（sample index n）：
 *   e[n] = s + v[n]，v[n] ~ N(0, σ_v²) iid，
 *   q[n] = +1 若 e[n] ≥ θ，否則 −1（硬體慣例 e ≥ θ → +1，規格 §15.2；θ = comparator threshold / offset）。
 *   s 是要辨識方向的固定誤差（例如 DTC residual a − w），單位 fs；σ_v、θ 同單位。
 *
 * 累加（勘誤 E07 / E18）：本章的總和寫成 S_N = Σ_{i=1}^{N} q_i（sum），
 *   K = #{q_i = +1} ~ Binomial(N, p)，S_N = 2K − N。
 *   §0 的 G_k = (1/N)Σ q x 是 block 平均；x ≡ 1 時 G = S_N / N。
 *
 * 平手（勘誤 E02）：N 為偶數時 P(S_N = 0) > 0，必須指定 tie rule（見 TieRule）。
 * 解析曲線與 Monte Carlo 一律使用同一條 rule。
 *
 * 所有匯出的 worker 函式（runComparatorMC、runComparatorSweep、runSignLoopBatch）都是純函式，參數與回傳值可 structured clone。
 * 頁面顯示的 region：pPlus, meanQ, kq, sumMoments, directionExact, directionClt, applyTieRule, samplesForConfidence,
 * tieEquilibrium, binomialSampler, mcSampleLevel, mcBinomial, classify, mcAcceptance, runComparatorMC, signLoop,
 * signLoopStationary, bitEncoding。
 * 「帶入手算」（src/chapters/ch05/handcalcs.ts）另外用到三個小的純函式 region：tieProbStirling, tieEquilibriumApprox,
 * blockLoopLinear——章內表格與手算題共用同一份公式。
 */

import {
  binomCdf,
  binomPmf,
  binomSf,
  createRng,
  erf,
  erfcx,
  lgamma,
  normCdf,
  normInv,
  normPdf,
  wilsonCI,
  type Rng,
} from '@/simulation/core'

/* ------------------------------------------------------------------ */
/* 型別                                                                 */
/* ------------------------------------------------------------------ */

/**
 * S_N = 0（只會在偶數 N 發生）時的決策規則：
 * - strict：只有 S_N 與 s 嚴格同號才算判對；tie 一律算錯（規格原文「P(G_N > 0)」的字面意思）。
 *           注意：這是「評分慣例」（最壞情況），不是可實作的硬體規則——硬體不知道 s 的正負。
 *           s > 0 時它和硬體 sign(0) = −1 給出相同的判對率；s < 0 時則和 sign(0) = +1 相同。
 * - half  ：tie 時公平擲硬幣（random tie-break）；CLT 無修正式在偶數 N 近似的就是這個。
 * - plus  ：硬體 sign(0) = +1（tie 一律判 +1，例如直接取累加器 MSB）。
 * - skip  ：tie 時不更新（hold）；結果分成 判對 / 判錯 / 不動 三類。
 */
export type TieRule = 'strict' | 'half' | 'plus' | 'skip'

export const TIE_RULES: readonly TieRule[] = ['strict', 'half', 'plus', 'skip']

export const TIE_RULE_LABEL: Record<TieRule, string> = {
  strict: 'strict：只算 S_N 與 s 嚴格同號（tie 算錯）',
  half: 'half：tie 擲硬幣（random tie-break）',
  plus: 'sign(0) = +1：tie 判 +1',
  skip: 'skip：S_N = 0 不更新',
}

/** S_N 的三種結果機率：P(S_N > 0)、P(S_N = 0)、P(S_N < 0)。 */
export interface DirectionSplit {
  pos: number
  tie: number
  neg: number
}

/** 套用 tie rule 後的決策結果（三者相加為 1）。correct = 判對方向的機率。 */
export interface DirectionOutcome {
  correct: number
  wrong: number
  /** 只有 skip rule 會 > 0：S_N = 0 時不更新 */
  hold: number
}

/* ------------------------------------------------------------------ */
/* 單一樣本：P(q=+1)、E[q]、Var(q)、K_q                                   */
/* ------------------------------------------------------------------ */

// #region core:pPlus
/**
 * P(q = +1) = P(s + v ≥ θ) = Φ((s − θ)/σ_v)。
 * σ_v = 0 時退化成 hard limiter：e = s ≥ θ → +1（機率 1），否則 −1。
 */
export function pPlus(s: number, sigma: number, theta = 0): number {
  if (sigma === 0) return s - theta >= 0 ? 1 : 0 // hard limiter（硬體 e ≥ θ → +1）
  return normCdf((s - theta) / sigma) // 標準化 z = (s − θ)/σ_v 後查 Φ
}
// #endregion

// #region core:meanQ
/**
 * E[q] = (+1)·P(+1) + (−1)·P(−1) = 2Φ(z) − 1 = erf(z/√2)，z = (s − θ)/σ_v。
 * 用 erf 直接計算（比 2Φ − 1 在 z ≈ 0 時少一次相減，保有相對精度）。
 */
export function meanQ(s: number, sigma: number, theta = 0): number {
  if (sigma === 0) return s - theta >= 0 ? 1 : -1
  return erf((s - theta) / (Math.SQRT2 * sigma))
}

/** Var(q) = E[q²] − E[q]² = 1 − m²（因為 q² ≡ 1）。 */
export function varQ(m: number): number {
  return 1 - m * m
}
// #endregion

// #region core:kq
/** 小訊號統計增益 K_q = dE[q]/ds |_{s=θ} = 2φ(0)/σ_v = √(2/π)/σ_v（單位：σ_v 單位的倒數，例如 fs⁻¹）。 */
export function kq(sigma: number): number {
  return Math.sqrt(2 / Math.PI) / sigma
}

/** 任一操作點的局部斜率 dE[q]/ds = (2/σ_v)·φ((s − θ)/σ_v)；|s − θ| ≫ σ_v 時趨近 0（飽和）。 */
export function kqLocal(s: number, sigma: number, theta = 0): number {
  return (2 / sigma) * normPdf((s - theta) / sigma)
}

/**
 * 線性化 E[q] ≈ K_q·(s − θ) 的相對誤差（高估量）：√(2/π)·r / erf(r/√2) − 1，r = (s − θ)/σ_v。
 * 小 r 時 ≈ r²/6（erf 泰勒展開的三次項）。
 */
export function linearizationRelError(r: number): number {
  if (r === 0) return 0
  return (Math.sqrt(2 / Math.PI) * r) / erf(r / Math.SQRT2) - 1
}
// #endregion

/** 硬體 0/1 位元轉成雙極性 q = 2b − 1（規格 §0）。 */
export function bitToBipolar(b: number): number {
  return 2 * b - 1
}

/* ------------------------------------------------------------------ */
/* N 個樣本的總和 S_N                                                    */
/* ------------------------------------------------------------------ */

export interface SumMoments {
  /** E[S_N] = N m */
  meanSum: number
  /** Var(S_N) = N (1 − m²) */
  varSum: number
  sdSum: number
  /** 平均 G = S_N / N：E[G] = m */
  meanAvg: number
  /** Var(G) = (1 − m²)/N */
  varAvg: number
  sdAvg: number
  /** 統計 SNR = E[S_N]/SD(S_N) = m√N/√(1 − m²)（與 sum / average 尺度無關） */
  snr: number
}

// #region core:sumMoments
/** S_N = Σ q_i（iid）：期望值相加、變異數相加（獨立）。 */
export function sumMoments(N: number, m: number): SumMoments {
  const varSum = N * (1 - m * m) // 每個 q_i 的 Var = 1 − m²，獨立 ⇒ 直接相加
  const meanSum = N * m // 訊號 ∝ N
  const sdSum = Math.sqrt(varSum) // 雜訊 ∝ √N
  return {
    meanSum,
    varSum,
    sdSum,
    meanAvg: m,
    varAvg: varSum / (N * N),
    sdAvg: sdSum / N,
    snr: sdSum > 0 ? meanSum / sdSum : m === 0 ? 0 : Math.sign(m) * Infinity,
  }
}
// #endregion

// #region core:directionExact
/**
 * 精確（exact binomial）：K = #{q_i = +1} ~ Binomial(N, p)，S_N = 2K − N。
 *   P(S_N > 0) = P(K > N/2)，P(S_N = 0) = P(K = N/2)（只有偶數 N），P(S_N < 0) = P(K < N/2)。
 */
export function directionExact(p: number, N: number): DirectionSplit {
  const pos = binomSf(Math.floor(N / 2), N, p) // ← 差異：逐項加總 Binomial 上尾 Σ_{k>N/2} C(N,k)p^k(1−p)^{N−k}
  const tie = N % 2 === 0 ? binomPmf(N / 2, N, p) : 0 // ← 差異：偶數 N 的 tie 機率是一個精確的 pmf 值
  const neg = binomCdf(Math.ceil(N / 2) - 1, N, p) // P(K ≤ ⌈N/2⌉ − 1) = P(K < N/2)
  return { pos, tie, neg }
}
// #endregion

// #region core:directionClt
/**
 * 近似（CLT）：S_N ≈ Gaussian(N m, N(1 − m²))，並做 S_N 每次跳 2 的連續性修正：
 *   奇數 N：格點 …, −1, +1, …，切在中點 0；偶數 N：格點 …, −2, 0, +2, …，P(S_N > 0) = P(S_N ≥ 2) 切在 1。
 */
export function directionClt(m: number, N: number): DirectionSplit {
  const sd = Math.sqrt(N * (1 - m * m))
  if (sd === 0) return m > 0 ? { pos: 1, tie: 0, neg: 0 } : { pos: 0, tie: 0, neg: 1 } // σ_v = 0：沒有隨機性
  const c = N % 2 === 0 ? 1 : 0 // 連續性修正：偶數 N 的 tie 佔據 (−1, +1)
  const pos = normCdf((N * m - c) / sd) // ← 差異：用 Φ 一次算完，不逐項加總（誤差 O(1/√N)）
  const neg = normCdf((-N * m - c) / sd)
  const tie = Math.max(0, 1 - pos - neg) // ← 差異：tie 機率只是 Gaussian 在 (−1, 1) 的面積近似
  return { pos, tie, neg }
}

/** 規格 §5 原式（無連續性修正）：Φ(m√N/√(1 − m²))。奇數 N 近似 P(S_N > 0)；偶數 N 近似 P(S_N > 0) + ½P(S_N = 0)（勘誤 E02）。 */
export function directionCltPlain(m: number, N: number): number {
  const v = 1 - m * m
  if (v <= 0) return m > 0 ? 1 : 0
  return normCdf((m * Math.sqrt(N)) / Math.sqrt(v))
}
// #endregion

// #region core:tieProbStirling
/**
 * 偶數 N 的 tie 機率的 Stirling 近似（手算用；精確值是 directionExact().tie）：
 *   C(N, N/2) ≈ 2^N·√(2/(πN))、p(1 − p) = (1 − m²)/4、(1 − m²)^{N/2} ≈ e^{−Nm²/2}
 *   ⇒ P(S_N = 0) ≈ √(2/(πN))·e^{−Nm²/2}。
 * 相對誤差約 1/(4N)（N ≥ 10 時 < 3%），另需 m² ≪ 1；奇數 N 沒有 tie，回傳 0。
 */
export function tieProbStirling(m: number, N: number): number {
  if (N % 2 !== 0) return 0 // S_N 與 N 同奇偶：奇數 N 不可能等於 0
  return Math.sqrt(2 / (Math.PI * N)) * Math.exp((-N * m * m) / 2)
}
// #endregion

// #region core:applyTieRule
/**
 * 把 S_N 的三種結果依 tie rule 轉成「判對 / 判錯 / 不動」。
 * trueSign = sign(s)：正確方向（s = 0 時沒有正確方向，呼叫端以 +1 當參考並另外警告）。
 */
export function applyTieRule(d: DirectionSplit, rule: TieRule, trueSign: 1 | -1 = 1): DirectionOutcome {
  const right = trueSign > 0 ? d.pos : d.neg // S_N 與 s 嚴格同號
  const wrong = trueSign > 0 ? d.neg : d.pos // S_N 與 s 嚴格反號
  switch (rule) {
    case 'strict':
      return { correct: right, wrong: wrong + d.tie, hold: 0 } // tie 算錯
    case 'half':
      return { correct: right + d.tie / 2, wrong: wrong + d.tie / 2, hold: 0 } // ← 差異：解析式把 tie 機率直接對半分（MC 則真的擲硬幣）
    case 'plus': // sign(0) = +1：tie 判 +1，對不對取決於 s 的正負
      return trueSign > 0 ? { correct: right + d.tie, wrong, hold: 0 } : { correct: right, wrong: wrong + d.tie, hold: 0 }
    case 'skip':
      return { correct: right, wrong, hold: d.tie } // ← 差異：tie 機率整份放進 hold（MC 則記一次「不動」）
  }
}
// #endregion

/** 精確方向機率（含 tie rule）。 */
export function directionOutcomeExact(p: number, N: number, rule: TieRule, trueSign: 1 | -1 = 1): DirectionOutcome {
  return applyTieRule(directionExact(p, N), rule, trueSign)
}

/** CLT（含連續性修正）方向機率（含 tie rule）。 */
export function directionOutcomeClt(m: number, N: number, rule: TieRule, trueSign: 1 | -1 = 1): DirectionOutcome {
  return applyTieRule(directionClt(m, N), rule, trueSign)
}

/* ------------------------------------------------------------------ */
/* 需要多少樣本                                                          */
/* ------------------------------------------------------------------ */

// #region core:samplesForConfidence
/**
 * CLT 反解：令 m√N/√(1 − m²) = z = Φ⁻¹(target) ⇒ N = z²(1 − m²)/m²（連續值）。
 * m = 0 時永遠到不了（回傳 Infinity）。
 */
export function samplesForConfidence(m: number, target: number): number {
  if (m === 0) return Infinity
  const z = normInv(target)
  return (z * z * (1 - m * m)) / (m * m)
}

/** 小訊號近似：m ≈ √(2/π)·(s/σ_v)、1 − m² ≈ 1 ⇒ N ≈ (z σ_v / s)²·(π/2)。 */
export function samplesSmallSignal(sOverSigma: number, target: number): number {
  if (sOverSigma === 0) return Infinity
  const z = normInv(target)
  return ((z / sOverSigma) * (z / sOverSigma) * Math.PI) / 2
}
// #endregion

/**
 * 精確門檻：最小的 N（指定奇偶）使 P(判對) ≥ target。
 * 以 CLT 解為起點、指數擴張找上界，再二分搜尋（假設 P(判對) 在同一奇偶序列內隨 N 單調遞增）。
 * 單調性：奇數 N（多數決，p > ½）與偶數 N 的 strict / half 成立；偶數 N 的 plus（sign(0) = +1）在小 N 時
 * 並不單調（N = 2 時 1 − (1 − p)² ≈ 0.75，N = 4 時反而較低），所以 plus 偶數序列的結果只在 target 高於
 * 小 N 的 tie 加成時有意義。網站只以 odd / strict 與 half 呼叫；單元測試另驗證門檻兩側。到不了時回傳 null。
 */
export function minNForTarget(
  p: number,
  target: number,
  parity: 'odd' | 'even',
  rule: TieRule = 'half',
  trueSign: 1 | -1 = 1,
  maxN = 2e9,
): number | null {
  const mEff = trueSign * (2 * p - 1)
  if (!(mEff > 0) || !(target > 0 && target < 1)) return null
  const toN = (k: number) => (parity === 'odd' ? 2 * k + 1 : 2 * k + 2)
  const ok = (k: number) => directionOutcomeExact(p, toN(k), rule, trueSign).correct >= target
  const guess = samplesForConfidence(mEff, target)
  if (!Number.isFinite(guess) || guess > 4 * maxN) return null // 連 CLT 都估計遠超上限：不必逐項計算
  let hi = Math.max(0, Math.floor(Math.min(guess, maxN) / 2))
  if (toN(hi) > maxN) return null
  while (!ok(hi)) {
    hi = 2 * hi + 1
    if (toN(hi) > maxN) return null
  }
  let lo = -1 // 哨兵：視為未達標
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (mid >= 0 && ok(mid)) hi = mid
    else lo = mid
  }
  return toN(hi)
}

/**
 * Berry–Esseen 上界：|P(S_N ≤ x) − Φ((x − Nm)/σ_S)| ≤ C·ρ/(σ_q³√N)，對所有 x 成立。
 * ρ = E|q − m|³ = p(1 − m)³ + (1 − p)(1 + m)³，σ_q² = 1 − m²；C = 0.4748（Shevtsova 2011 的 iid 常數）。
 * 這是「CLT 最多差多少」的嚴格保證（通常很保守）。
 */
export function berryEsseenBound(m: number, N: number, C = 0.4748): number {
  const p = (1 + m) / 2
  const rho = p * (1 - m) ** 3 + (1 - p) * (1 + m) ** 3
  const s3 = (1 - m * m) ** 1.5
  if (s3 === 0) return 0
  return (C * rho) / (s3 * Math.sqrt(N))
}

/**
 * 硬體決策 d ∈ {+1, −1, 0} 的平均 E[d] = P(d = +1) − P(d = −1)。硬體不知道 s 的正負，所以 tie 必須映射到固定的值：
 * strict → sign(0) = −1（s > 0 時與 strict 評分相同）、plus → sign(0) = +1、half → 擲硬幣、skip → d = 0。
 */
export function meanDecision(d: DirectionSplit, rule: TieRule): number {
  switch (rule) {
    case 'strict':
      return d.pos - (d.neg + d.tie) // 硬體 sign(0) = −1：只有 S_N > 0 判 +1，tie 判 −1
    case 'plus':
      return d.pos + d.tie - d.neg // sign(0) = +1
    case 'half':
    case 'skip':
      return d.pos - d.neg // tie 對平均沒有貢獻
  }
}

// #region core:tieEquilibrium
/**
 * Block「判號」迴路（w ← w + μ·d_k，d_k = 依 tie rule 的 sign(S_N)，x ≡ 1）的平衡點：解 E[d](s*) = 0。
 * 偶數 N 時，確定性的 tie rule 會讓平衡點偏離 s = 0：
 *   sign(0) = +1 ⇒ s* ≈ −1/(N K_q)；strict（硬體 sign(0) = −1）⇒ s* ≈ +1/(N K_q)；half / skip ⇒ s* = 0。
 * （S_N 的格點間距是 2，決策門檻偏了 1 = 半格 ⇒ N m* ≈ ∓1 ⇒ s* ≈ ∓1/(N K_q)。）
 * 線性 GMAC 更新 w ← w + μ·S_N/N 不受 tie rule 影響（S_N = 0 本來就貢獻 0）。
 */
export function tieRuleEquilibrium(N: number, sigma: number, rule: TieRule): number {
  const f = (s: number) => meanDecision(directionExact(pPlus(s, sigma), N), rule)
  let lo = -8 * sigma // E[d] 在 s 上單調遞增：二分法
  let hi = 8 * sigma
  if (f(lo) > 0 || f(hi) < 0) return NaN
  for (let it = 0; it < 200 && hi - lo > 1e-12 * sigma; it++) {
    const mid = (lo + hi) / 2
    if (f(mid) < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
// #endregion

// #region core:tieEquilibriumApprox
/**
 * tieRuleEquilibrium 的小訊號近似（F-05.19，手算用）：決策門檻偏了半格（S_N 的 1）⇒ N m* = ∓1，再除以 K_q 得 s*。
 *   sign(0) = +1 ⇒ −1/(N K_q)；strict（硬體 sign(0) = −1）⇒ +1/(N K_q)；half / skip 或奇數 N ⇒ 0。
 */
export function tieRuleEquilibriumApprox(N: number, sigma: number, rule: TieRule): number {
  if (N % 2 !== 0 || rule === 'half' || rule === 'skip') return 0
  const shift = 1 / (N * kq(sigma)) // = (σ_v/N)·√(π/2)
  return rule === 'plus' ? -shift : shift
}
// #endregion

/* ------------------------------------------------------------------ */
/* S_N 的精確分布（給 histogram 疊圖）                                     */
/* ------------------------------------------------------------------ */

export interface BinomialTable {
  n: number
  p: number
  /** 表格涵蓋 K = kLo … kHi（兩側各 ≥ 12σ_K，被截掉的質量 < 1e-30） */
  kLo: number
  kHi: number
  /** pmf[i] = P(K = kLo + i) */
  pmf: Float64Array
  /** 累積 cdf[i] = Σ_{j ≤ i} pmf[j]（只在表格內） */
  cdf: Float64Array
}

/** 建立 Binomial(n, p) 在眾數附近的 pmf 表（n ≤ ~1e8 都只需數萬個元素）。 */
export function binomialTable(n: number, p: number): BinomialTable {
  if (p <= 0 || p >= 1) {
    const k = p >= 1 ? n : 0
    return { n, p, kLo: k, kHi: k, pmf: Float64Array.of(1), cdf: Float64Array.of(1) }
  }
  const sd = Math.sqrt(n * p * (1 - p))
  const mode = Math.floor((n + 1) * p)
  const kLo = Math.max(0, Math.floor(mode - 12 * sd - 10))
  const kHi = Math.min(n, Math.ceil(mode + 12 * sd + 10))
  const len = kHi - kLo + 1
  const pmf = new Float64Array(len)
  const cdf = new Float64Array(len)
  let acc = 0
  for (let i = 0; i < len; i++) {
    pmf[i] = binomPmf(kLo + i, n, p)
    acc += pmf[i]
    cdf[i] = acc
  }
  return { n, p, kLo, kHi, pmf, cdf }
}

// #region core:binomialSampler
/** 以 inversion（u ~ U[0,1) 在累積表上二分搜尋）精確抽樣 K ~ Binomial(n, p)。每次 O(log(表長))。 */
export function sampleFromTable(t: BinomialTable, u: number): number {
  const target = u * t.cdf[t.cdf.length - 1] // 以表內總質量正規化（截尾質量 < 1e-30）
  let lo = 0
  let hi = t.cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t.cdf[mid] > target) hi = mid
    else lo = mid + 1
  }
  return t.kLo + lo
}
// #endregion

/**
 * 把 S_N 的精確 pmf 依 histogram 的 bin 加總（bin 邊界放在格點中點，所以每個 bin 包含整數個格點）。
 * 回傳每個 bin 的機率（乘上 trials 就是期望個數）。
 */
export function binnedSumPmf(t: BinomialTable, edges: ArrayLike<number>): Float64Array {
  const nb = edges.length - 1
  const out = new Float64Array(nb)
  if (nb <= 0) return out
  const w = edges[1] - edges[0]
  for (let i = 0; i < t.pmf.length; i++) {
    const S = 2 * (t.kLo + i) - t.n
    const b = Math.floor((S - edges[0]) / w)
    if (b >= 0 && b < nb) out[b] += t.pmf[i]
  }
  return out
}

/**
 * S_N 格點對齊的 histogram 邊界：範圍取 mean ± 4.5 SD（夾在 [−N, N]），bin 寬為 2 的整數倍、邊界落在格點中點。
 */
export function latticeEdges(N: number, meanSum: number, sdSum: number, maxBins = 61): Float64Array {
  const parity = N % 2 // S_N 與 N 同奇偶
  const snap = (x: number, dir: 'down' | 'up') => {
    const v = dir === 'down' ? Math.floor(x) : Math.ceil(x)
    return ((v % 2) + 2) % 2 === parity ? v : dir === 'down' ? v - 1 : v + 1
  }
  const lo = Math.max(-N, snap(meanSum - 4.5 * sdSum, 'down'))
  const hi = Math.min(N, snap(meanSum + 4.5 * sdSum, 'up'))
  const points = Math.floor((hi - lo) / 2) + 1 // 格點個數
  const perBin = Math.max(1, Math.ceil(points / maxBins))
  const nb = Math.ceil(points / perBin)
  const width = 2 * perBin
  const edges = new Float64Array(nb + 1)
  for (let i = 0; i <= nb; i++) edges[i] = lo - 1 + i * width
  return edges
}

/* ------------------------------------------------------------------ */
/* Monte Carlo                                                          */
/* ------------------------------------------------------------------ */

// #region core:mcSampleLevel
/** Sample-level：真的產生 N 個 Gaussian 雜訊、逐個比較、逐個累加。成本 O(N)。 */
export function sumSampleLevel(rng: Rng, N: number, s: number, sigma: number, theta: number): number {
  let S = 0
  for (let i = 0; i < N; i++) {
    const e = s + sigma * rng.normal() // comparator 輸入 = 固定誤差 + 雜訊
    S += e >= theta ? 1 : -1 // ← 差異：逐個產生 q_i = ±1 再累加
  }
  return S
}
// #endregion

// #region core:mcBinomial
/** Binomial：iid ±1 的總和只取決於 +1 的個數 K ~ Binomial(N, p)，一次抽出即可。成本 O(log N)。 */
export function sumBinomial(rng: Rng, table: BinomialTable): number {
  const K = sampleFromTable(table, rng.uniform()) // K = #{q_i = +1}
  return 2 * K - table.n // ← 差異：直接得到 S_N = 2K − N，分布與 sample-level 完全相同
}
// #endregion

export type McMethod = 'auto' | 'sample' | 'binomial'

export interface ComparatorMcParams {
  s: number
  sigma: number
  theta?: number
  N: number
  trials: number
  seed: number
  tieRule: TieRule
  method?: McMethod
  /** auto 模式下 sample-level 的工作量上限 N·trials（預設 4e6） */
  sampleWorkLimit?: number
  /** histogram 最多 bin 數（預設 61） */
  maxBins?: number
  /** 隨機遊走路徑（第 1 個 trial 的前 pathLength 個累加值，sample-level 產生）長度上限（預設 4000） */
  pathLength?: number
  /** 信賴水準（預設 0.95） */
  level?: number
}

export interface ComparatorMcResult {
  methodUsed: 'sample' | 'binomial'
  trialsUsed: number
  notes: string[]
  /** 每個 trial 的 S_N */
  sums: Int32Array
  counts: { pos: number; tie: number; neg: number }
  /** 套用 tie rule 後的計數（half rule 的 tie 以獨立的 rng.fork('tie-break') 擲硬幣） */
  outcome: { correct: number; wrong: number; hold: number }
  /** P(判對) 的 Wilson 信賴區間 */
  wilson: { p: number; lo: number; hi: number; level: number }
  /** 所有 trial 中 q = +1 的總次數 ΣK（N·trials 個 comparator 決策中的精確整數計數） */
  plusCount: number
  /** 由 ΣK/(N·trials) 估計的 P(q = +1)，與其標準誤 √(p̂(1−p̂)/(N·trials)) */
  pHatPlus: number
  pHatSe: number
  /** P(q=+1) 的 Wilson 區間（N·trials 個 comparator 決策） */
  pHatWilson: { lo: number; hi: number }
  sumMean: number
  sumVar: number
  hist: { edges: Float64Array; counts: Float64Array; expected: Float64Array; outside: number }
  /** 第 1 個 trial 的累加路徑 S_1 … S_L（sample-level） */
  path: Float64Array
}

function trueSignOf(s: number): 1 | -1 {
  return s >= 0 ? 1 : -1
}

// #region core:classify
/** Monte Carlo 的逐 trial 判定：與解析的 applyTieRule 是同一條 rule，只是把「機率分配」換成「真的抽一次」。 */
function classify(S: number, rule: TieRule, t: 1 | -1, coin: Rng): 'correct' | 'wrong' | 'hold' {
  if (S * t > 0) return 'correct' // S_N 與 s 嚴格同號
  if (S * t < 0) return 'wrong' // S_N 與 s 嚴格反號
  switch (rule) {
    case 'strict':
      return 'wrong' // tie 算錯
    case 'half':
      return coin.uniform() < 0.5 ? 'correct' : 'wrong' // ← 差異：MC 真的擲一枚公平硬幣（解析式直接把 tie 機率對半分）
    case 'plus':
      return t > 0 ? 'correct' : 'wrong' // sign(0) = +1
    case 'skip':
      return 'hold' // ← 差異：MC 記一次「不動」（解析式把 tie 機率放進 hold）
  }
}
// #endregion

/* ------------------------------------------------------------------ */
/* Monte Carlo 計數的接受域（Analytic ↔ Monte Carlo 交叉比對用）            */
/* ------------------------------------------------------------------ */

/** 單尾 4σ 的機率 Φ(−4)：MC 計數落在接受域某一側之外的機率上限（雙尾合計 ≈ 6.3e-5）。 */
export const MC_TAIL_ALPHA = 3.167124183311986e-5

/** 逐項精確加總 Binomial 的 n 上限（binomCdf 每次 O(10·√(npq))；再大就改用極限分布）。 */
const EXACT_BINOM_N_MAX = 5e7

/** P(Y ≤ k)，Y ~ Poisson(λ)：在 log 空間逐項加總（λ 到數百也不會下溢）。 */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0
  if (!(lambda > 0)) return 1
  const kk = Math.floor(k)
  if (kk > lambda + 40 * Math.sqrt(lambda) + 40) return 1
  const logL = Math.log(lambda)
  let sum = 0
  for (let j = 0; j <= kk; j++) sum += Math.exp(-lambda + j * logL - lgamma(j + 1))
  return Math.min(1, sum)
}

/**
 * P(X ≤ k)，X ~ Binomial(n, p)，n 可以大到 N·T ~ 1e12：
 * n ≤ 5e7 逐項精確加總；更大時，變異數 ≥ 400 用常態 + 連續性修正，否則（p 極接近 0 或 1 的稀有事件）用 Poisson 極限。
 */
export function binomCdfLarge(k: number, n: number, p: number): number {
  const kk = Math.floor(k)
  if (kk < 0) return 0
  if (kk >= n) return 1
  if (p <= 0) return 1
  if (p >= 1) return 0
  if (n <= EXACT_BINOM_N_MAX) return binomCdf(kk, n, p)
  const v = n * p * (1 - p)
  if (v >= 400) return normCdf((kk + 0.5 - n * p) / Math.sqrt(v))
  if (p <= 0.5) return poissonCdf(kk, n * p) // X 本身就是稀有事件的次數
  return 1 - poissonCdf(n - kk - 1, n * (1 - p)) // n − X 才是稀有事件：P(X ≤ k) = P(n − X ≥ n − k)
}

// #region core:mcAcceptance
/**
 * Monte Carlo 計數的接受域：若模型正確，觀察到的次數 X ~ Binomial(n, p)。
 * 回傳 [kLo, kHi]，使 P(X < kLo) < α 且 P(X > kHi) < α（預設 α = Φ(−4)，「等效 4σ」）。
 * 為什麼不用 |p̂ − p| ≤ 4·SE？稀有事件時（例如 P(判錯) = 1e-6、T = 4000，平均 0.004 次）常態近似完全失效：
 * 只要剛好出現 1 次判錯，z 分數就超過 15，會把正確的模擬誤判成 mismatch。精確的 Binomial 尾機率沒有這個問題。
 */
export function binomialAcceptance(n: number, p: number, alpha = MC_TAIL_ALPHA): { kLo: number; kHi: number } {
  if (!(n >= 0) || !(p >= 0 && p <= 1)) throw new Error(`binomialAcceptance：需要 n ≥ 0、0 ≤ p ≤ 1，收到 n = ${n}、p = ${p}`)
  if (p === 0) return { kLo: 0, kHi: 0 }
  if (p === 1) return { kLo: n, kHi: n }
  const upper = (k: number) => (n <= EXACT_BINOM_N_MAX ? binomSf(k - 1, n, p) : 1 - binomCdfLarge(k - 1, n, p)) // P(X ≥ k)
  // kLo = 最小的 k 使 P(X ≤ k) ≥ α（P(X ≤ k) 對 k 單調遞增 ⇒ 二分搜尋）
  let lo = -1
  let hi = n
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (binomCdfLarge(mid, n, p) >= alpha) hi = mid
    else lo = mid
  }
  const kLo = hi
  // kHi = 最大的 k 使 P(X ≥ k) ≥ α
  lo = 0
  hi = n + 1
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (upper(mid) >= alpha) lo = mid
    else hi = mid
  }
  return { kLo, kHi: lo }
}
// #endregion

/**
 * T 個 trial 的樣本變異數 s²（估計 Var(S_N)）的標準誤：Var(s²) = (μ₄ − σ⁴(T − 3)/(T − 1))/T。
 * S_N = 2K − N，K ~ Binomial(N, p)：σ² = 4Npq，μ₄ = 16·Npq·(1 + 3(N − 2)pq)（Binomial 的四階中心矩）。
 * N 大時 μ₄ → 3σ⁴，退化成 Gaussian 的 σ²·√(2/T)；p 接近 0 或 1 時尾巴重得多，Gaussian 式會嚴重低估。
 */
export function sumVarianceSe(N: number, p: number, T: number): number {
  if (!(T > 1)) return NaN
  const pq = p * (1 - p)
  const var2 = (4 * N * pq) ** 2
  const mu4 = 16 * N * pq * (1 + 3 * (N - 2) * pq)
  return Math.sqrt(Math.max(0, mu4 - (var2 * (T - 3)) / (T - 1)) / T)
}

/** S_N ∈ [−N, N] 的 two's-complement 累加器所需位元數 ⌈log₂(N + 1)⌉ + 1（N = 4096 ⇒ 14）。 */
export function accumulatorBits(N: number): number {
  if (!(N >= 1)) throw new Error(`N 必須 ≥ 1，收到 ${N}`)
  return Math.ceil(Math.log2(N + 1)) + 1
}

// #region core:runComparatorMC
/** Monte Carlo：trials 次獨立的「累加 N 個 q_i」，統計 S_N 分布與判對率（含 Wilson CI）。 */
export function runComparatorMC(params: ComparatorMcParams): ComparatorMcResult {
  const { s, sigma, N, seed, tieRule } = params
  const theta = params.theta ?? 0
  const level = params.level ?? 0.95
  const notes: string[] = []
  if (!Number.isInteger(N) || N < 1) throw new Error(`N 必須是正整數，收到 ${N}`)
  if (!(sigma >= 0)) throw new Error(`σ_v 必須 ≥ 0，收到 ${sigma}`)
  const limit = params.sampleWorkLimit ?? 4e6
  let trials = Math.max(1, Math.floor(params.trials))
  const method: 'sample' | 'binomial' =
    params.method === 'sample' ? 'sample' : params.method === 'binomial' ? 'binomial' : N * trials <= limit ? 'sample' : 'binomial'
  if (method === 'sample' && N * trials > 5e7) {
    trials = Math.max(1, Math.floor(5e7 / N))
    notes.push(`sample-level 工作量上限 5e7：trials 自動降為 ${trials}（改用 binomial 引擎可跑更多 trials）`)
  }
  if (params.method === 'auto' || params.method === undefined) {
    notes.push(method === 'sample' ? 'auto：N·trials 小，使用 sample-level（逐個 Gaussian）' : 'auto：N·trials 大，改用精確的 Binomial 抽樣（分布完全相同）')
  }

  const root = createRng(seed)
  const noise = root.fork('comparator-noise') // 每個雜訊源獨立 fork，可重現
  const coin = root.fork('tie-break')
  const p = pPlus(s, sigma, theta)
  const table = binomialTable(N, p)
  const t = trueSignOf(s)

  const sums = new Int32Array(trials)
  const counts = { pos: 0, tie: 0, neg: 0 }
  const outcome = { correct: 0, wrong: 0, hold: 0 }
  let plusTotal = 0
  let sumMean = 0 // Welford 線上平均／變異數（避免 E[S²] − E[S]² 的相減誤差）
  let m2 = 0
  for (let j = 0; j < trials; j++) {
    const S = method === 'sample' ? sumSampleLevel(noise, N, s, sigma, theta) : sumBinomial(noise, table)
    sums[j] = S
    plusTotal += (S + N) / 2 // K = (S + N)/2
    const d = S - sumMean
    sumMean += d / (j + 1)
    m2 += d * (S - sumMean)
    if (S > 0) counts.pos++
    else if (S < 0) counts.neg++
    else counts.tie++
    outcome[classify(S, tieRule, t, coin)]++
  }
  const sumVar = trials > 1 ? m2 / (trials - 1) : NaN

  const w = wilsonCI(outcome.correct, trials, level)
  const decisions = N * trials
  const pHatPlus = plusTotal / decisions
  const pw = wilsonCI(Math.round(plusTotal), decisions, level)

  // histogram（格點對齊）與同一組 bin 的精確期望個數
  const mom = sumMoments(N, meanQ(s, sigma, theta))
  const edges = latticeEdges(N, mom.meanSum, mom.sdSum, params.maxBins ?? 61)
  const nb = edges.length - 1
  const hc = new Float64Array(nb)
  const width = edges[1] - edges[0]
  let outside = 0
  for (let j = 0; j < trials; j++) {
    const b = Math.floor((sums[j] - edges[0]) / width)
    if (b >= 0 && b < nb) hc[b]++
    else outside++
  }
  const expected = binnedSumPmf(table, edges).map((v) => v * trials)

  // 第 1 個 trial 的逐樣本累加路徑（另一個 fork，不影響上面的統計）
  const L = Math.min(N, Math.max(1, Math.floor(params.pathLength ?? 4000)))
  const pathRng = root.fork('path')
  const path = new Float64Array(L)
  let S = 0
  for (let i = 0; i < L; i++) {
    S += s + sigma * pathRng.normal() >= theta ? 1 : -1
    path[i] = S
  }

  return {
    methodUsed: method,
    trialsUsed: trials,
    notes,
    sums,
    counts,
    outcome,
    wilson: { p: w.p, lo: w.lo, hi: w.hi, level },
    plusCount: Math.round(plusTotal),
    pHatPlus,
    pHatSe: Math.sqrt((pHatPlus * (1 - pHatPlus)) / decisions),
    pHatWilson: { lo: pw.lo, hi: pw.hi },
    sumMean,
    sumVar,
    hist: { edges, counts: hc, expected, outside },
    path,
  }
}
// #endregion

export interface ComparatorSweepParams {
  s: number
  sigma: number
  theta?: number
  Ns: number[]
  trials: number
  seed: number
  tieRule: TieRule
  level?: number
}

export interface ComparatorSweepResult {
  N: Float64Array
  correct: Float64Array
  lo: Float64Array
  hi: Float64Array
  /** 同一 N 的精確值（方便直接比對） */
  exact: Float64Array
}

/** P(判對) vs N 的 Monte Carlo 掃描（Binomial 引擎；每個 N 用自己的 fork，彼此獨立）。 */
export function runComparatorSweep(params: ComparatorSweepParams): ComparatorSweepResult {
  const { s, sigma, Ns, seed, tieRule } = params
  const theta = params.theta ?? 0
  const level = params.level ?? 0.95
  const trials = Math.max(1, Math.floor(params.trials))
  const p = pPlus(s, sigma, theta)
  const t = trueSignOf(s)
  const root = createRng(seed)
  const n = Ns.length
  const out: ComparatorSweepResult = {
    N: new Float64Array(n),
    correct: new Float64Array(n),
    lo: new Float64Array(n),
    hi: new Float64Array(n),
    exact: new Float64Array(n),
  }
  for (let i = 0; i < n; i++) {
    const N = Ns[i]
    const table = binomialTable(N, p)
    const rng = root.fork(`sweep-${N}`)
    const coin = root.fork(`sweep-tie-${N}`)
    let c = 0
    for (let j = 0; j < trials; j++) if (classify(sumBinomial(rng, table), tieRule, t, coin) === 'correct') c++
    const w = wilsonCI(c, trials, level)
    out.N[i] = N
    out.correct[i] = c / trials
    out.lo[i] = w.lo
    out.hi[i] = w.hi
    out.exact[i] = directionOutcomeExact(p, N, tieRule, t).correct
  }
  return out
}

/* ------------------------------------------------------------------ */
/* P(判對) vs N 曲線（解析）                                               */
/* ------------------------------------------------------------------ */

export interface DirectionCurve {
  /** 奇數 N 與其精確 P(判對)（奇數 N 沒有 tie，四種 rule 相同） */
  oddN: number[]
  oddExact: number[]
  /** 偶數 N 與其精確 P(判對)（依 tie rule） */
  evenN: number[]
  evenExact: number[]
  /** 規格原式 Φ(m√N/√(1−m²))，在所有 N 上 */
  allN: number[]
  cltPlain: number[]
  /** 偶數 N 的 CLT + 連續性修正（依 tie rule） */
  evenCltCorrected: number[]
}

/** 小 N（≤ dense）逐一列出；之後以對數格點取樣，奇偶各一條。 */
export function directionCurve(p: number, Nmax: number, rule: TieRule, trueSign: 1 | -1 = 1, dense = 120, perDecade = 40): DirectionCurve {
  const m = 2 * p - 1
  const Ns = new Set<number>()
  const top = Math.max(2, Math.floor(Nmax))
  for (let N = 1; N <= Math.min(dense, top); N++) Ns.add(N)
  if (top > dense) {
    const decades = Math.log10(top / dense)
    const steps = Math.max(2, Math.ceil(decades * perDecade))
    for (let i = 0; i <= steps; i++) {
      const base = Math.round(dense * Math.pow(top / dense, i / steps))
      Ns.add(base)
      Ns.add(base + 1)
    }
  }
  const sorted = [...Ns].filter((N) => N >= 1 && N <= top + 1).sort((a, b) => a - b)
  const out: DirectionCurve = { oddN: [], oddExact: [], evenN: [], evenExact: [], allN: [], cltPlain: [], evenCltCorrected: [] }
  const mEff = trueSign * m
  for (const N of sorted) {
    const ex = directionOutcomeExact(p, N, rule, trueSign).correct
    if (N % 2 === 1) {
      out.oddN.push(N)
      out.oddExact.push(ex)
    } else {
      out.evenN.push(N)
      out.evenExact.push(ex)
      out.evenCltCorrected.push(directionOutcomeClt(m, N, rule, trueSign).correct)
    }
    out.allN.push(N)
    out.cltPlain.push(directionCltPlain(mEff, N))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 雜訊當 dither：逐 sample 的 Sign-LMS 迴路（x ≡ 1）                        */
/* ------------------------------------------------------------------ */

export interface SignLoopParams {
  /** 真實值 a（fs） */
  a: number
  /** 初值 w_0（fs） */
  w0: number
  /** 每次更新的步長 μ（fs / sample） */
  mu: number
  sigma: number
  theta?: number
  steps: number
  seed: number
}

export interface SignLoopResult {
  /** w_0 … w_steps */
  w: Float64Array
  /** 後半段的時間平均、時間平均誤差（bias = mean − a）與 RMS √mean((w − a)²) */
  tailMean: number
  tailBias: number
  tailRms: number
}

// #region core:signLoop
/** 逐 sample 的 Sign-LMS：w_{n+1} = w_n + μ·q_n，q_n = sign(a − w_n + v_n − θ)（x ≡ 1，δ = a − w）。 */
export function simulateSignLoop(p: SignLoopParams): SignLoopResult {
  const theta = p.theta ?? 0
  const rng = createRng(p.seed).fork('comparator-noise')
  const steps = Math.max(1, Math.floor(p.steps))
  const w = new Float64Array(steps + 1)
  w[0] = p.w0
  for (let n = 0; n < steps; n++) {
    const e = p.a - w[n] + p.sigma * rng.normal() // comparator 輸入：殘差 + 雜訊
    const q = e >= theta ? 1 : -1 // 1-bit 決策
    w[n + 1] = w[n] + p.mu * q // 固定步長 ±μ
  }
  const start = Math.floor(steps / 2)
  let s1 = 0
  let s2 = 0
  for (let n = start; n <= steps; n++) {
    s1 += w[n]
    s2 += (w[n] - p.a) * (w[n] - p.a)
  }
  const cnt = steps - start + 1
  const tailMean = s1 / cnt
  return { w, tailMean, tailBias: tailMean - p.a, tailRms: Math.sqrt(s2 / cnt) }
}
// #endregion

export interface SignLoopBatchParams {
  a: number
  w0: number
  theta?: number
  steps: number
  seed: number
  /** 每個 Case 的 σ_v 與 μ（同一個 seed ⇒ 同一串雜訊，paired comparison） */
  cases: { sigma: number; mu: number }[]
}

export interface SignLoopBatchResult {
  runs: SignLoopResult[]
}

/** Worker 用：一次跑多個 Case 的逐 sample Sign-LMS（每個 Case 用同一個 seed）。 */
export function runSignLoopBatch(p: SignLoopBatchParams): SignLoopBatchResult {
  if (!(p.steps >= 1 && p.steps <= 1e6)) throw new Error(`steps 必須在 [1, 1e6]，收到 ${p.steps}`)
  return {
    runs: p.cases.map((c) => simulateSignLoop({ a: p.a, w0: p.w0, theta: p.theta, steps: p.steps, seed: p.seed, mu: c.mu, sigma: c.sigma })),
  }
}

export interface SignLoopStationary {
  /** 是否算得出（格點過多時為 false） */
  ok: boolean
  /** 穩態（時間平均）E_π[w] */
  mean: number
  /** mean − a */
  bias: number
  /** √E_π[(w − a)²] */
  rms: number
  /** 穩態標準差 √Var_π(w) */
  sd: number
  /** 支撐點與機率（只回傳機率 > 1e-12 的點） */
  support: number[]
  prob: number[]
  /** σ_v = 0 時為 limit cycle */
  limitCycle: boolean
}

/** log Φ(z)，在左尾（z ≪ 0）用 erfcx 避免 Φ 下溢成 0：Φ(z) = ½·erfcx(−z/√2)·e^{−z²/2}。 */
export function logNormCdf(z: number): number {
  if (z > -5) return Math.log(normCdf(z))
  return Math.log(0.5 * erfcx(-z / Math.SQRT2)) - (z * z) / 2
}

// #region core:signLoopStationary
/**
 * 精確穩態（birth–death Markov chain）：w 只能落在格點 w_k = w_0 + kμ，
 * 往上機率 u_k = Φ((a − θ − w_k)/σ_v)，往下 ū_k = 1 − u_k。
 * 細緻平衡 π_k u_k = π_{k+1} ū_{k+1} ⇒ 時間平均 E_π[w] 與 RMS 可精確計算。
 */
export function signLoopStationary(p: Omit<SignLoopParams, 'steps' | 'seed'>, maxPoints = 2_000_000): SignLoopStationary {
  const theta = p.theta ?? 0
  const target = p.a - theta // 迴路平衡點：E[q] = 0 處
  if (p.sigma === 0) {
    // hard limiter：在 w_lo ≤ a − θ < w_lo + μ 兩點之間來回（period-2 limit cycle）
    const wLo = p.w0 + Math.floor((target - p.w0) / p.mu) * p.mu
    const support = [wLo, wLo + p.mu]
    const mean = wLo + p.mu / 2
    const ms = ((wLo - p.a) ** 2 + (wLo + p.mu - p.a) ** 2) / 2
    return { ok: true, mean, bias: mean - p.a, rms: Math.sqrt(ms), sd: p.mu / 2, support, prob: [0.5, 0.5], limitCycle: true }
  }
  const kc = Math.round((target - p.w0) / p.mu)
  const half = Math.ceil((12 * p.sigma + 4 * p.mu) / p.mu)
  if (2 * half + 1 > maxPoints) {
    return { ok: false, mean: NaN, bias: NaN, rms: NaN, sd: NaN, support: [], prob: [], limitCycle: false }
  }
  const len = 2 * half + 1
  const logPi = new Float64Array(len)
  const wk = (i: number) => p.w0 + (kc - half + i) * p.mu
  for (let i = 0; i + 1 < len; i++) {
    const logUp = logNormCdf((target - wk(i)) / p.sigma) // log u_i
    const logDown = logNormCdf(-(target - wk(i + 1)) / p.sigma) // log ū_{i+1} = log Φ(−(a − θ − w_{i+1})/σ_v)
    logPi[i + 1] = logPi[i] + logUp - logDown // ← 細緻平衡（log 空間，σ_v ≪ μ 時也不會 0/0）
  }
  let maxLog = -Infinity
  for (let i = 0; i < len; i++) maxLog = Math.max(maxLog, logPi[i])
  let z = 0
  const pi = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    pi[i] = Math.exp(logPi[i] - maxLog)
    z += pi[i]
  }
  let mean = 0
  let ms = 0
  for (let i = 0; i < len; i++) {
    pi[i] /= z
    mean += pi[i] * wk(i)
    ms += pi[i] * (wk(i) - p.a) ** 2
  }
  let varW = 0
  const support: number[] = []
  const prob: number[] = []
  for (let i = 0; i < len; i++) {
    varW += pi[i] * (wk(i) - mean) ** 2
    if (pi[i] > 1e-12) {
      support.push(wk(i))
      prob.push(pi[i])
    }
  }
  return { ok: true, mean, bias: mean - p.a, rms: Math.sqrt(ms), sd: Math.sqrt(varW), support, prob, limitCycle: false }
}
// #endregion

/** 線性化（小訊號）穩態 RMS：δ_{n+1} = (1 − μK_q)δ_n − μη_n，Var(η) ≈ 1 ⇒ Var(δ) ≈ μ/(K_q(2 − μK_q))。μK_q ≥ 2 時回傳 NaN。 */
export function signLoopLinearRms(mu: number, sigma: number): number {
  if (sigma <= 0) return NaN
  const g = mu * kq(sigma)
  if (!(g > 0 && g < 2)) return NaN
  return Math.sqrt((mu * mu) / (1 - (1 - g) * (1 - g)))
}

export interface BlockLoopLinear {
  /** comparator 小訊號增益 K_q（fs⁻¹） */
  kq: number
  /** 穩定上限 μ_max = 2/K_q（fs）：0 < μ < μ_max ⇔ |p_cal| < 1 */
  muMax: number
  /** 無因次 loop gain g = μK_q（x ≡ 1 ⇒ C = 1） */
  g: number
  /** 線性化 pole p_cal = 1 − g */
  pole: number
  /** 時間常數 τ = −1/ln|p_cal|（blocks；p_cal = 0 時為 0，|p_cal| ≥ 1 時 NaN） */
  tau: number
  /** 係數的穩態 RMS σ_w = μ/√(N(1 − p_cal²))（fs；|p_cal| ≥ 1 時 NaN） */
  sigmaW: number
  /** 一個 block 的時間 N/f_s（s；未給 f_s 時 NaN） */
  blockSeconds: number
  /** τ 換成時間 τ·N/f_s（s；未給 f_s 時 NaN） */
  tauSeconds: number
}

// #region core:blockLoopLinear
/**
 * x ≡ 1 的 average-mode block Sign-LMS（w_{k+1} = w_k + μG_k，G_k = S_N/N ≈ K_qδ_k + η_k，Var(η_k) ≈ 1/N，δ = a − w）
 * 的線性化摘要：δ_{k+1} = (1 − μK_q)δ_k − μη_k。
 * N = 1 就是 §7 逐 sample 的 Sign-LMS（F-05.15）：σ_w 與 signLoopLinearRms 相同。
 */
export function blockLoopLinear(mu: number, sigma: number, N: number, fs?: number): BlockLoopLinear {
  const K = kq(sigma) // √(2/π)/σ_v
  const g = mu * K // loop gain
  const pole = 1 - g // 參數誤差每個 block 乘上的倍數
  const stable = Math.abs(pole) < 1 // ⇔ 0 < μ < 2/K_q
  const tau = stable ? (pole === 0 ? 0 : -1 / Math.log(Math.abs(pole))) : NaN
  const blockSeconds = fs !== undefined && fs > 0 ? N / fs : NaN
  return {
    kq: K,
    muMax: 2 / K,
    g,
    pole,
    tau,
    sigmaW: stable ? mu / Math.sqrt(N * (1 - pole * pole)) : NaN, // σ_w² = μ²·Var(η)/(1 − p_cal²)，Var(η) ≈ 1/N
    blockSeconds,
    tauSeconds: tau * blockSeconds,
  }
}
// #endregion

/* ------------------------------------------------------------------ */
/* 反面測試：0/1 位元沒有映射成 ±1                                         */
/* ------------------------------------------------------------------ */

// #region core:bitEncoding
/**
 * 平均 GMAC E[q·x]，e = (a − w)x，v ~ N(0, σ_v²)：
 *   bipolar（正確，q = 2b − 1）：E[q|x] = erf(e/(√2σ_v))
 *   unipolar（錯誤，把 b ∈ {0,1} 直接當 q）：E[b|x] = Φ(e/σ_v)  ← 在 e = 0 時是 ½ 而不是 0
 */
export function meanGmacEncoding(
  w: number,
  a: number,
  values: number[],
  probs: number[],
  sigma: number,
  encoding: 'bipolar' | 'unipolar',
): number {
  let g = 0
  for (let i = 0; i < values.length; i++) {
    const e = (a - w) * values[i]
    const eq = encoding === 'bipolar' ? erf(e / (Math.SQRT2 * sigma)) : normCdf(e / sigma) // ← 差異：0/1 編碼的平均值偏 ½
    g += probs[i] * values[i] * eq
  }
  return g
}
// #endregion

/** 解 E[q·x] = 0 的平均固定點（二分法；E[q·x] 對 w 單調遞減）。 */
export function signLmsFixedPointEncoding(
  a: number,
  values: number[],
  probs: number[],
  sigma: number,
  encoding: 'bipolar' | 'unipolar',
  bracket: [number, number] = [-1e3, 1e3],
): number {
  let [lo, hi] = bracket
  let flo = meanGmacEncoding(lo, a, values, probs, sigma, encoding)
  const fhi = meanGmacEncoding(hi, a, values, probs, sigma, encoding)
  if (flo * fhi > 0) throw new Error('signLmsFixedPointEncoding：bracket 兩端同號，沒有夾住固定點')
  for (let it = 0; it < 200 && hi - lo > 1e-12 * Math.max(1, Math.abs(lo)); it++) {
    const mid = (lo + hi) / 2
    const fm = meanGmacEncoding(mid, a, values, probs, sigma, encoding)
    if (fm === 0) return mid
    if (fm * flo > 0) {
      lo = mid
      flo = fm
    } else hi = mid
  }
  return (lo + hi) / 2
}

/* ------------------------------------------------------------------ */
/* 延伸：時間相關雜訊（s = 0 的 arcsine law）                               */
/* ------------------------------------------------------------------ */

/**
 * s = θ（m = 0）時，若 v 是 AR(1) Gaussian、相鄰相關係數 ρ，則 E[q_i q_j] = (2/π)·arcsin(ρ^{|i−j|})（arcsine law）。
 * Var(S_N) = N + 2Σ_{k=1}^{N−1}(N − k)(2/π)arcsin(ρ^k)。回傳 Var(S_N) 與等效獨立樣本數 N_eff = N²/Var(S_N)
 * （讓獨立樣本的 SNR m√N_eff 等於相關樣本的 N m/√Var(S_N)）。
 */
export function sumVarianceAr1(N: number, rho: number): { varSum: number; nEff: number } {
  let v = N
  let rk = 1
  for (let k = 1; k < N; k++) {
    rk *= rho
    const c = (2 / Math.PI) * Math.asin(rk)
    if (Math.abs(c) < 1e-16) break
    v += 2 * (N - k) * c
  }
  return { varSum: v, nEff: (N * N) / v }
}
