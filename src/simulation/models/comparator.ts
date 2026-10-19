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
 * §5b（非理想 comparator：hysteresis ±h、metastability 決策窗 ε）的模型在檔案最後：comparatorTransitions, comparatorChain,
 * kqHysteresis, metaProb, nonidealSummary, chainSumMoments, chainSumPmf, directionCltChain；runComparatorMC／runComparatorSweep
 * 在 h > 0 或 ε > 0 時自動改走帶 latch 狀態的 sample-level 路徑（h = ε = 0 時與原本完全相同）。
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
  /** §5b：hysteresis 半寬 h（fs；門檻 θ ∓ h 依上一個輸出而定）。預設 0 = 無記憶 */
  h?: number
  /** §5b：metastability 決策窗 ε（fs；|e − θ_a| < ε 的 sample 漏掉）。預設 0 = 關閉 */
  eps?: number
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
  /** §5b：h > 0 或 ε > 0 時才有（chain 的平穩統計、精確 DP、漏掉的 sample 數） */
  nonideal?: NonidealMcInfo
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
  if ((params.h ?? 0) > 0 || (params.eps ?? 0) > 0) return runComparatorMCNonideal(params, params.h ?? 0, params.eps ?? 0) // §5b：帶 latch 狀態
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
  /** §5b：hysteresis 半寬與 metastability 窗（fs；預設 0） */
  h?: number
  eps?: number
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
  if ((params.h ?? 0) > 0 || (params.eps ?? 0) > 0) return runComparatorSweepNonideal(params, params.h ?? 0, params.eps ?? 0) // §5b
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

/* ------------------------------------------------------------------ */
/* §5b：比較器不是理想的 sign()——hysteresis（門檻 ±h 帶記憶）與 metastability   */
/* （|e − θ_a| < ε 的決策窗）。頁面以 #region core:* 顯示；Ch05 §5b、Comparator Lab */
/* 與 blockLms.ts 的 comparator 選項共用這裡的機率模型。                          */
/*                                                                      */
/* 模型（sample index n；x ≡ 1）：                                           */
/*   有效門檻 θ_a[n] = θ − q[n−1]·h（上一個輸出 +1 時門檻降到 θ − h，要掉到它以下才翻成 −1； */
/*   上一個輸出 −1 時門檻升到 θ + h）。h = 0 回到無記憶的 sign。                         */
/*   決策窗：|e[n] − θ_a[n]| < ε 時 latch 在取樣週期內解不出來（metastable）。          */
/*   policy = drop：這個 sample 不進 GMAC（y = 0），latch 狀態不變；                  */
/*   hold：沿用上一個輸出；late：正確的正負號晚一拍才到（乘到下一個 regressor，Ch07）。  */
/*   解析（chain、pmf、CLT）一律是 drop；hold／late 只在 blockLms 模擬裡。             */
/*   latch 狀態 σ[n] ∈ {±1} 是兩狀態 Markov chain：t₊ = P(−1 → +1)、t₋ = P(+1 → −1)。  */
/* ------------------------------------------------------------------ */

/** metastable 的 sample 怎麼進 GMAC（blockLms 的 comparator.meta_policy）。 */
export type MetaPolicy = 'drop' | 'hold' | 'late'
export const META_POLICIES: readonly MetaPolicy[] = ['drop', 'hold', 'late']
export const META_POLICY_LABEL: Record<MetaPolicy, string> = {
  drop: 'drop：valid 旗標擋掉，這個 sample 不累加',
  hold: 'hold：沿用上一個輸出',
  late: 'late：正確的正負號晚一拍進 GMAC（乘到下一個 regressor）',
}

/** 給定上一個輸出，這一個 sample 的三種結果機率（相加為 1）。 */
export interface ComparatorStep {
  plus: number
  minus: number
  /** |e − θ_a| < ε：latch 沒解出來 */
  meta: number
}

// #region core:comparatorTransitions
/**
 * P(這一拍 = +1 / −1 / metastable | s, 上一個輸出 q_prev)，雜訊 v ~ N(0, σ_v²)：
 *   d = s − θ_a，θ_a = θ − q_prev·h                      （離有效門檻的距離）
 *   P(+1) = P(e − θ_a ≥ ε) = Φ((d − ε)/σ_v)
 *   P(−1) = P(e − θ_a ≤ −ε) = Φ((−d − ε)/σ_v)
 *   P(meta) = 1 − P(+1) − P(−1)                          （ε = 0 時恰為 0）
 * h = ε = 0 時 P(+1) = Φ((s − θ)/σ_v)，就是 pPlus。σ_v = 0 時退化成 hard limiter（e = s 固定）。
 */
export function comparatorTransitions(s: number, sigma: number, h: number, eps: number, qPrev: 1 | -1, theta = 0): ComparatorStep {
  const d = s - theta + qPrev * h // ← 差異：門檻依上一個輸出而定（θ − q_prev·h）
  if (sigma === 0) {
    if (Math.abs(d) < eps) return { plus: 0, minus: 0, meta: 1 } // 沒有雜訊：落在窗內就永遠解不出來
    return d >= 0 ? { plus: 1, minus: 0, meta: 0 } : { plus: 0, minus: 1, meta: 0 } // 硬體慣例 e ≥ θ_a → +1
  }
  const plus = normCdf((d - eps) / sigma)
  const minus = normCdf((-d - eps) / sigma)
  return { plus, minus, meta: eps > 0 ? Math.max(0, 1 - plus - minus) : 0 } // ← 差異：窗內的機率是 metastable
}
// #endregion

/** latch 狀態的兩狀態 Markov chain 與 GMAC 看到的輸出 y ∈ {+1, 0, −1}（drop 政策）的平穩統計。 */
export interface ComparatorChain {
  /** 由上一個輸出 +1／−1 出發的三種結果機率 */
  fromPlus: ComparatorStep
  fromMinus: ComparatorStep
  /** t₊ = P(−1 → +1) = fromMinus.plus；t₋ = P(+1 → −1) = fromPlus.minus */
  tUp: number
  tDown: number
  /** 記憶因子 ν = 1 − t₊ − t₋：latch 狀態的 lag-k 相關是 ν^k（h = ε = 0 時 ν = 0） */
  nu: number
  /** 平穩 P(σ = +1) = t₊/(t₊ + t₋) */
  piPlus: number
  /** E[σ] = 2π₊ − 1 */
  meanState: number
  /** E[y]：GMAC 看到的平均（metastable 的 sample 算 0） */
  meanOut: number
  /** 平穩的 P(y = +1)、P(y = −1)、P(metastable) */
  pPlusOut: number
  pMinusOut: number
  pMeta: number
  /** Var(y) = (1 − P_meta) − E[y]² */
  varOut: number
  /** E[y_n | σ_{n−1}] = α + β·σ_{n−1} 的 β（純遲滯時 β = ν） */
  beta: number
  /** Cov(y_n, σ_n) = (1 − P_meta) − E[y]E[σ] */
  cov1: number
  /** Cov(y_n, y_{n+k}) = β·ν^{k−1}·cov1（k ≥ 1）⇒ lim Var(S_N)/N = varOut + 2β·cov1/(1 − ν) */
  varInf: number
  /** t₊ = t₋ = 0：latch 永遠不翻轉（σ_v = 0 且 |d| 在窗內或門檻外），沒有平穩分布 */
  stuck: boolean
}

// #region core:comparatorChain
/**
 * 平穩分布：細緻平衡 π₊·t₋ = π₋·t₊ ⇒ π₊ = t₊/(t₊ + t₋)。
 * 輸出 y 的平均 E[y] = π₊·g₊ + π₋·g₋，g_σ = P(+1 | σ) − P(−1 | σ)（metastable 算 0）。
 * 自相關：σ 是 chain、y 只透過 σ_{n−1} 與新的雜訊決定，所以 Cov(y_n, y_{n+k}) = β·ν^{k−1}·Cov(y_n, σ_n)，
 * 其中 E[y_n σ_n] = P(有效決策) = 1 − P_meta（有效時 σ_n = y_n ⇒ 乘積為 1；metastable 時 y_n = 0）。
 */
export function comparatorChain(s: number, sigma: number, h: number, eps: number, theta = 0): ComparatorChain {
  const fromPlus = comparatorTransitions(s, sigma, h, eps, 1, theta)
  const fromMinus = comparatorTransitions(s, sigma, h, eps, -1, theta)
  const tDown = fromPlus.minus // +1 → −1：要掉到 θ − h 以下
  const tUp = fromMinus.plus // −1 → +1：要升到 θ + h 以上
  const sum = tUp + tDown
  const stuck = !(sum > 0)
  const piPlus = stuck ? NaN : tUp / sum // ← 差異：平穩分布，不是單一樣本的 Φ
  const piMinus = 1 - piPlus
  const nu = 1 - sum // 記憶因子：相鄰輸出的相關
  const gPlus = fromPlus.plus - fromPlus.minus
  const gMinus = fromMinus.plus - fromMinus.minus
  const meanState = 2 * piPlus - 1
  const meanOut = piPlus * gPlus + piMinus * gMinus
  const pMeta = piPlus * fromPlus.meta + piMinus * fromMinus.meta
  const pPlusOut = piPlus * fromPlus.plus + piMinus * fromMinus.plus
  const pMinusOut = piPlus * fromPlus.minus + piMinus * fromMinus.minus
  const varOut = 1 - pMeta - meanOut * meanOut
  const beta = (gPlus - gMinus) / 2
  const cov1 = 1 - pMeta - meanOut * meanState
  const varInf = stuck ? NaN : varOut + (2 * beta * cov1) / (1 - nu)
  return { fromPlus, fromMinus, tUp, tDown, nu, piPlus, meanState, meanOut, pPlusOut, pMinusOut, pMeta, varOut, beta, cov1, varInf, stuck }
}
// #endregion

// #region core:kqHysteresis
/**
 * 純遲滯（ε = 0）在 s = θ 的平穩小訊號斜率（F-05.22）：
 *   t₊ = Φ((d − h)/σ_v)、t₋ = Φ((−d − h)/σ_v)、E[q] = (t₊ − t₋)/(t₊ + t₋)；對 d 微分並代 d = 0（分子為 0）：
 *   K_q(h) = t₊′/t₊ = φ(η)/(σ_v Φ(−η))，η = h/σ_v。h = 0 時 φ(0)/(σ_v/2) = √(2/π)/σ_v。
 * 斜率隨 h 變大（inverse Mills ratio 遞增）：latch 一旦翻過去就會「黏住」，平均輸出對 s 更敏感；
 * 代價是相鄰輸出相關（ν = 1 − 2Φ(−η) > 0），block 平均的雜訊變成 iid 的 (1 + ν)/(1 − ν) 倍。
 */
export function kqHysteresis(sigma: number, h: number): number {
  if (!(sigma > 0)) return NaN
  const eta = h / sigma
  return normPdf(eta) / (sigma * normCdf(-eta)) // ← 差異：不再是 2φ(0)/σ_v
}

/** 純遲滯在 s = θ 的記憶因子 ν(h) = 1 − 2Φ(−h/σ_v)。 */
export function nuHysteresis(sigma: number, h: number): number {
  if (!(sigma > 0)) return h > 0 ? 1 : 0
  return 1 - 2 * normCdf(-h / sigma)
}
// #endregion

// #region core:metaProb
/**
 * metastable 的機率（F-05.24）：P_meta = P(|e − θ| < ε) = Φ((ε − d)/σ_v) − Φ((−ε − d)/σ_v)，d = s − θ。
 * d = 0 時 2Φ(ε/σ_v) − 1 ≈ 2φ(0)·ε/σ_v = K_q·ε（ε ≪ σ_v）。
 */
export function metaProb(s: number, sigma: number, eps: number, theta = 0): number {
  if (!(eps > 0)) return 0
  const d = s - theta
  if (sigma === 0) return Math.abs(d) < eps ? 1 : 0
  return normCdf((eps - d) / sigma) - normCdf((-eps - d) / sigma)
}

/** 決策時間 T 之後還沒解出來的窗：ε(T) = ε₀·e^{−T/τ_m}（τ_m = latch 的再生時間常數）。 */
export function metaWindowAfter(eps0: number, T: number, tauM: number): number {
  if (!(tauM > 0)) return 0
  return eps0 * Math.exp(-T / tauM)
}

/**
 * drop 政策（h = 0）在 s = θ 的斜率（F-05.25）：漏掉的樣本是 |e − θ| < ε 的那些，它們的 sign 對 s 的斜率是
 *   d/ds ∫_{−ε}^{ε} sign(e) f(e − d) de |_{d=0} = 2(φ(0) − φ(ε/σ_v))/σ_v
 * 所以剩下的斜率 K_q − 2(φ(0) − φ(ε/σ_v))/σ_v = 2φ(ε/σ_v)/σ_v = K_q·e^{−ε²/(2σ_v²)}。
 */
export function kqMetaDrop(sigma: number, eps: number): number {
  if (!(sigma > 0)) return NaN
  return kq(sigma) * Math.exp((-eps * eps) / (2 * sigma * sigma)) // ← 差異：只少掉二階小量
}
// #endregion

/**
 * 一般情形（h 與 ε 同時存在）的平穩斜率 dE[y]/ds：對 comparatorChain 的 meanOut 做 5 點中央差分
 * （步長 10⁻³·σ_v；截斷誤差 O(δ⁴)、捨入誤差約 10⁻¹³）。純遲滯時等於 kqHysteresis、純 drop 時等於 kqMetaDrop
 * （comparator.test.ts 以 10⁻⁹ 相對誤差核對）。
 */
export function chainSlope(sigma: number, h: number, eps: number, theta = 0, s = theta): number {
  if (!(sigma > 0)) return NaN
  const d = 1e-3 * sigma
  const f = (x: number) => comparatorChain(x, sigma, h, eps, theta).meanOut
  return (-f(s + 2 * d) + 8 * f(s + d) - 8 * f(s - d) + f(s - 2 * d)) / (12 * d)
}

/** 非理想 comparator 在工作點 s = θ 的摘要（§5b 的表格、圖與手算題共用）。 */
export interface NonidealSummary {
  chain: ComparatorChain
  /** 平穩斜率 dE[y]/ds（fs⁻¹）與它和理想 K_q 的比 */
  slope: number
  slopeRatio: number
  /** lim Var(S_N)/N：iid 時為 1（s = θ） */
  noiseFactor: number
  /** 資訊等效增益 K_eff = slope/√noiseFactor：同樣的 N 得到同樣 SNR 的理想 comparator 增益 */
  kqEff: number
  kqEffRatio: number
  /** 每個 sample 的資訊比 (K_eff/K_q)²；達到同樣正確率所需的 N 是它的倒數 */
  infoRatio: number
  nRatio: number
  nu: number
  pMeta: number
}

// #region core:nonidealSummary
/** 由 chain 的平穩統計得到 §5b 的幾個設計量（s = θ；小訊號）。 */
export function nonidealSummary(sigma: number, h: number, eps: number, theta = 0): NonidealSummary {
  const chain = comparatorChain(theta, sigma, h, eps, theta)
  const K0 = kq(sigma)
  const slope = chainSlope(sigma, h, eps, theta)
  const noiseFactor = chain.varInf // s = θ 時理想 comparator 的 Var(y) = 1
  const kqEff = slope / Math.sqrt(noiseFactor) // ← 差異：SNR_stat ≈ √N·K_eff·(s − θ)
  const infoRatio = (kqEff * kqEff) / (K0 * K0)
  return { chain, slope, slopeRatio: slope / K0, noiseFactor, kqEff, kqEffRatio: kqEff / K0, infoRatio, nRatio: 1 / infoRatio, nu: chain.nu, pMeta: chain.pMeta }
}
// #endregion

export interface ChainSumMoments extends SumMoments {
  /** 等效獨立樣本數 N²·Var(y)/Var(S_N)：同樣的 SNR 需要幾個 iid 樣本（相關為正時 < N） */
  nEff: number
}

// #region core:chainSumMoments
/**
 * 有限 N 的 S_N = Σ y_i 矩（F-05.23）：
 *   E[S_N] = N·E[y]
 *   Var(S_N) = N·Var(y) + 2Σ_{k=1}^{N−1}(N − k)·Cov(y_n, y_{n+k})
 *            = N·c₀ + 2β·c₁·[N/(1 − ν) − (1 − ν^N)/(1 − ν)²]
 * ν = 0（iid）時回到 sumMoments；ν → 1 時每個 block 幾乎只有一次獨立的決策。
 */
export function chainSumMoments(N: number, ch: ComparatorChain): ChainSumMoments {
  const m = ch.meanOut
  const geo = ch.nu === 0 ? N - 1 : N / (1 - ch.nu) - (1 - Math.pow(ch.nu, N)) / ((1 - ch.nu) * (1 - ch.nu)) // Σ_{k=1}^{N−1}(N − k)ν^{k−1}
  const varSum = N * ch.varOut + 2 * ch.beta * ch.cov1 * geo // ← 差異：相關項
  const meanSum = N * m
  const sdSum = Math.sqrt(Math.max(0, varSum))
  return {
    meanSum,
    varSum,
    sdSum,
    meanAvg: m,
    varAvg: varSum / (N * N),
    sdAvg: sdSum / N,
    snr: sdSum > 0 ? meanSum / sdSum : m === 0 ? 0 : Math.sign(m) * Infinity,
    nEff: varSum > 0 ? (N * N * ch.varOut) / varSum : NaN,
  }
}
// #endregion

/** S_N 的精確分布（兩狀態 chain、drop 政策）：pmf[i] = P(S_N = i − offset)。 */
export interface ChainSumPmf {
  pmf: Float64Array
  offset: number
  /** 被窗截掉的機率質量（< 10⁻²⁰） */
  truncated: number
}

/** chainSumPmf 的工作量上限（內層迴圈的格點數；超過就回傳 null，改用 CLT） */
export const CHAIN_PMF_WORK_LIMIT = 1.5e8

// #region core:chainSumPmf
/**
 * 精確（DP）：在（latch 狀態 σ, 部分和 S）上逐 sample 前進——每一步從 (σ, S) 走到 (+1, S+1)、(−1, S−1) 或 (σ, S)（metastable）。
 * 初始狀態取平穩分布。每一步只掃平均 ± 12 SD 的窗（窗外質量 < 10⁻³⁰）；工作量 ≈ 16√varInf·N^1.5，超過上限回傳 null。
 * 與 directionExact（iid 的 Binomial）的差別：相鄰樣本有記憶、而且 metastable 的 0 讓 S_N 不再和 N 同奇偶。
 */
export function chainSumPmf(ch: ComparatorChain, N: number, workLimit = CHAIN_PMF_WORK_LIMIT): ChainSumPmf | null {
  if (!Number.isInteger(N) || N < 1 || ch.stuck || !Number.isFinite(ch.varInf)) return null
  const spread = Math.sqrt(Math.max(ch.varInf, 1e-12))
  if (16 * spread * Math.pow(N, 1.5) + 20 * N > workLimit) return null
  const len = 2 * N + 1
  const offset = N
  let A = new Float64Array(len) // σ = +1
  let B = new Float64Array(len) // σ = −1
  let A2 = new Float64Array(len)
  let B2 = new Float64Array(len)
  A[offset] = ch.piPlus
  B[offset] = 1 - ch.piPlus
  let lo = offset
  let hi = offset
  const fp = ch.fromPlus
  const fm = ch.fromMinus
  let truncated = 0
  for (let n = 1; n <= N; n++) {
    // 這一步之後的窗：平均 ± 12 SD（用 chain 的矩）
    const mo = chainSumMoments(n, ch)
    const half = 12 * mo.sdSum + 8
    const nlo = Math.max(offset - n, Math.floor(offset + mo.meanSum - half))
    const nhi = Math.min(offset + n, Math.ceil(offset + mo.meanSum + half))
    A2.fill(0, nlo, nhi + 1)
    B2.fill(0, nlo, nhi + 1)
    for (let i = lo; i <= hi; i++) {
      const a = A[i]
      const b = B[i]
      if (a === 0 && b === 0) continue
      // ← 差異：三種結果、兩個狀態
      const up = a * fp.plus + b * fm.plus // 新狀態 +1、和 +1
      const down = a * fp.minus + b * fm.minus // 新狀態 −1、和 −1
      if (i + 1 <= nhi) A2[i + 1] += up
      else truncated += up
      if (i - 1 >= nlo) B2[i - 1] += down
      else truncated += down
      if (i >= nlo && i <= nhi) {
        A2[i] += a * fp.meta // metastable：狀態與和都不變
        B2[i] += b * fm.meta
      } else truncated += a * fp.meta + b * fm.meta
    }
    const tA = A
    const tB = B
    A = A2
    B = B2
    A2 = tA
    B2 = tB
    lo = nlo
    hi = nhi
  }
  const pmf = new Float64Array(len)
  let total = 0
  for (let i = lo; i <= hi; i++) {
    pmf[i] = A[i] + B[i]
    total += pmf[i]
  }
  if (total > 0) for (let i = lo; i <= hi; i++) pmf[i] /= total
  return { pmf, offset, truncated }
}
// #endregion

/** 由精確 pmf 得到 P(S_N > 0)、P(S_N = 0)、P(S_N < 0)；算不出來（工作量太大或 chain 卡住）回傳 null。 */
export function directionExactChain(ch: ComparatorChain, N: number, workLimit = CHAIN_PMF_WORK_LIMIT): DirectionSplit | null {
  const t = chainSumPmf(ch, N, workLimit)
  if (!t) return null
  let pos = 0
  let neg = 0
  for (let i = t.offset + 1; i < t.pmf.length; i++) pos += t.pmf[i]
  for (let i = 0; i < t.offset; i++) neg += t.pmf[i]
  return { pos, tie: t.pmf[t.offset], neg }
}

// #region core:directionCltChain
/**
 * CLT（近似）：S_N ≈ Gaussian(N·E[y], Var(S_N))，Var 用 chainSumMoments（含相關）。
 * 格點：有 metastable 的 0 時 S_N 可以是任何整數（間距 1，切在 ±½）；沒有時和 directionClt 一樣間距 2（偶數 N 切在 ±1）。
 */
export function directionCltChain(ch: ComparatorChain, N: number): DirectionSplit {
  const mo = chainSumMoments(N, ch)
  const sd = mo.sdSum
  if (!(sd > 0)) return mo.meanSum > 0 ? { pos: 1, tie: 0, neg: 0 } : mo.meanSum < 0 ? { pos: 0, tie: 0, neg: 1 } : { pos: 0, tie: 1, neg: 0 }
  const c = ch.pMeta > 0 ? 0.5 : N % 2 === 0 ? 1 : 0 // ← 差異：drop 的 0 讓格點間距變成 1
  const pos = normCdf((mo.meanSum - c) / sd)
  const neg = normCdf((-mo.meanSum - c) / sd)
  return { pos, neg, tie: Math.max(0, 1 - pos - neg) }
}
// #endregion

/** 所需樣本數（CLT、漸近 Var(S_N) ≈ N·varInf）：N = z²·varInf/E[y]²。E[y] = 0 時 Infinity。 */
export function samplesForConfidenceChain(ch: ComparatorChain, target: number): number {
  if (!(ch.meanOut !== 0) || !Number.isFinite(ch.varInf)) return Infinity
  const z = normInv(target)
  return (z * z * ch.varInf) / (ch.meanOut * ch.meanOut)
}

/**
 * P(判對) vs N 曲線（非理想 comparator）：N ≤ dense 用精確 DP（oddN／oddExact 放所有 N，不分奇偶——有 drop 時沒有奇偶之分），
 * 之後只有 CLT（allN／cltPlain）。evenN 與 evenCltCorrected 空著（圖例會標明）。
 */
export function directionCurveChain(ch: ComparatorChain, Nmax: number, rule: TieRule, trueSign: 1 | -1 = 1, dense = 120, perDecade = 24): DirectionCurve {
  const Ns = new Set<number>()
  const top = Math.max(2, Math.floor(Nmax))
  for (let N = 1; N <= Math.min(dense, top); N++) Ns.add(N)
  if (top > dense) {
    const decades = Math.log10(top / dense)
    const steps = Math.max(2, Math.ceil(decades * perDecade))
    for (let i = 0; i <= steps; i++) Ns.add(Math.round(dense * Math.pow(top / dense, i / steps)))
  }
  const sorted = [...Ns].filter((N) => N >= 1 && N <= top + 1).sort((a, b) => a - b)
  const out: DirectionCurve = { oddN: [], oddExact: [], evenN: [], evenExact: [], allN: [], cltPlain: [], evenCltCorrected: [] }
  for (const N of sorted) {
    if (N <= dense) {
      const ex = directionExactChain(ch, N)
      if (ex) {
        out.oddN.push(N)
        out.oddExact.push(applyTieRule(ex, rule, trueSign).correct)
      }
    }
    out.allN.push(N)
    out.cltPlain.push(applyTieRule(directionCltChain(ch, N), rule, trueSign).correct)
  }
  return out
}

/** 任意間距的格點 histogram 邊界（spacing = 1：所有整數；spacing = 2：與 N 同奇偶，即 latticeEdges）。 */
export function latticeEdgesSpaced(N: number, meanSum: number, sdSum: number, spacing: 1 | 2, maxBins = 61): Float64Array {
  if (spacing === 2) return latticeEdges(N, meanSum, sdSum, maxBins)
  const lo = Math.max(-N, Math.floor(meanSum - 4.5 * sdSum))
  const hi = Math.min(N, Math.ceil(meanSum + 4.5 * sdSum))
  const points = hi - lo + 1
  const perBin = Math.max(1, Math.ceil(points / maxBins))
  const nb = Math.ceil(points / perBin)
  const edges = new Float64Array(nb + 1)
  for (let i = 0; i <= nb; i++) edges[i] = lo - 0.5 + i * perBin
  return edges
}

/** 把任意 pmf（index − offset = S）依 histogram 的 bin 加總。 */
export function binnedPmf(pmf: ArrayLike<number>, offset: number, edges: ArrayLike<number>): Float64Array {
  const nb = edges.length - 1
  const out = new Float64Array(nb)
  if (nb <= 0) return out
  const w = edges[1] - edges[0]
  for (let i = 0; i < pmf.length; i++) {
    if (pmf[i] === 0) continue
    const b = Math.floor((i - offset - edges[0]) / w)
    if (b >= 0 && b < nb) out[b] += pmf[i]
  }
  return out
}

/** 非理想 comparator 的 Monte Carlo 結果附加資料（runComparatorMC 在 h > 0 或 ε > 0 時才有）。 */
export interface NonidealMcInfo {
  chain: ComparatorChain
  /** 精確 DP 的 S_N 分布（工作量內才有） */
  exact: DirectionSplit | null
  /** metastable（漏掉）的 sample 總數 */
  metaCount: number
  /** 格點間距：有 drop 時 1，否則 2 */
  lattice: 1 | 2
}

/**
 * 逐 sample 的非理想 comparator（有 latch 狀態）：回傳這一拍送進累加器的 y ∈ {+1, 0, −1}（drop 政策）。
 * 與 comparatorTransitions 是同一個模型，只是把「機率」換成「真的抽一次」。
 */
export function createNonidealStepper(s: number, sigma: number, h: number, eps: number, theta: number, rng: Rng, start: 1 | -1) {
  let q: 1 | -1 = start
  return {
    get state(): 1 | -1 {
      return q
    },
    step(): number {
      const e = s + sigma * rng.normal()
      const d = e - theta + q * h // 離有效門檻 θ − q·h 的距離
      if (Math.abs(d) < eps) return 0 // metastable：drop，狀態不變
      q = d >= 0 ? 1 : -1
      return q
    },
  }
}

/** Monte Carlo（非理想 comparator；只有 sample-level）。由 runComparatorMC 在 h > 0 或 ε > 0 時呼叫。 */
function runComparatorMCNonideal(params: ComparatorMcParams, h: number, eps: number): ComparatorMcResult {
  const { s, sigma, N, seed, tieRule } = params
  const theta = params.theta ?? 0
  const level = params.level ?? 0.95
  const notes: string[] = []
  if (!Number.isInteger(N) || N < 1) throw new Error(`N 必須是正整數，收到 ${N}`)
  if (!(sigma >= 0)) throw new Error(`σ_v 必須 ≥ 0，收到 ${sigma}`)
  let trials = Math.max(1, Math.floor(params.trials))
  if (N * trials > 5e7) {
    trials = Math.max(1, Math.floor(5e7 / N))
    notes.push(`sample-level 工作量上限 5e7：trials 自動降為 ${trials}`)
  }
  notes.push('非理想 comparator（h 或 ε > 0）：樣本不再獨立，只能用 sample-level（逐個 Gaussian、帶 latch 狀態）；binomial 引擎不適用')
  const ch = comparatorChain(s, sigma, h, eps, theta)
  const root = createRng(seed)
  const noise = root.fork('comparator-noise')
  const coin = root.fork('tie-break')
  const t = trueSignOf(s)
  const start: 1 | -1 = ch.stuck ? (s - theta >= 0 ? 1 : -1) : noise.uniform() < ch.piPlus ? 1 : -1
  const st = createNonidealStepper(s, sigma, h, eps, theta, noise, start)
  for (let i = 0; i < 256; i++) st.step() // burn-in：第一個 trial 也從平穩狀態開始
  const sums = new Int32Array(trials)
  const counts = { pos: 0, tie: 0, neg: 0 }
  const outcome = { correct: 0, wrong: 0, hold: 0 }
  let plusTotal = 0
  let metaTotal = 0
  let sumMean = 0
  let m2 = 0
  for (let j = 0; j < trials; j++) {
    let S = 0
    for (let n = 0; n < N; n++) {
      const y = st.step()
      S += y
      if (y > 0) plusTotal++
      else if (y === 0) metaTotal++
    }
    sums[j] = S
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
  // +1 的計數是相關樣本的和：標準誤乘上 √((1 + ν)/(1 − ν))（近似）
  const corr = ch.stuck ? 1 : Math.sqrt((1 + ch.nu) / (1 - ch.nu))
  const pHatSe = Math.sqrt((pHatPlus * (1 - pHatPlus)) / decisions) * corr
  const pw = wilsonCI(Math.round(plusTotal), Math.max(1, Math.round(decisions / (corr * corr))), level)

  const mo = chainSumMoments(N, ch)
  const lattice: 1 | 2 = eps > 0 ? 1 : 2
  const edges = latticeEdgesSpaced(N, mo.meanSum, mo.sdSum, lattice, params.maxBins ?? 61)
  const nb = edges.length - 1
  const hc = new Float64Array(nb)
  const width = edges[1] - edges[0]
  let outside = 0
  for (let j = 0; j < trials; j++) {
    const b = Math.floor((sums[j] - edges[0]) / width)
    if (b >= 0 && b < nb) hc[b]++
    else outside++
  }
  const table = chainSumPmf(ch, N)
  let expected: Float64Array
  if (table) expected = binnedPmf(table.pmf, table.offset, edges).map((v) => v * trials)
  else {
    // CLT 密度積分到每個 bin
    expected = new Float64Array(nb)
    if (mo.sdSum > 0) for (let b = 0; b < nb; b++) expected[b] = trials * (normCdf((edges[b + 1] - mo.meanSum) / mo.sdSum) - normCdf((edges[b] - mo.meanSum) / mo.sdSum))
    notes.push('精確 DP 超過工作量上限：histogram 的期望個數改用 CLT（Markov）近似')
  }
  const exact: DirectionSplit | null = table
    ? (() => {
        let pos = 0
        let neg = 0
        for (let i = table.offset + 1; i < table.pmf.length; i++) pos += table.pmf[i]
        for (let i = 0; i < table.offset; i++) neg += table.pmf[i]
        return { pos, tie: table.pmf[table.offset], neg }
      })()
    : null

  const L = Math.min(N, Math.max(1, Math.floor(params.pathLength ?? 4000)))
  const pathRng = root.fork('path')
  const ps = createNonidealStepper(s, sigma, h, eps, theta, pathRng, start)
  for (let i = 0; i < 256; i++) ps.step()
  const path = new Float64Array(L)
  let S = 0
  for (let i = 0; i < L; i++) {
    S += ps.step()
    path[i] = S
  }
  return {
    methodUsed: 'sample',
    trialsUsed: trials,
    notes,
    sums,
    counts,
    outcome,
    wilson: { p: w.p, lo: w.lo, hi: w.hi, level },
    plusCount: Math.round(plusTotal),
    pHatPlus,
    pHatSe,
    pHatWilson: { lo: pw.lo, hi: pw.hi },
    sumMean,
    sumVar,
    hist: { edges, counts: hc, expected, outside },
    path,
    nonideal: { chain: ch, exact, metaCount: metaTotal, lattice },
  }
}

/** 非理想 comparator 的 P(判對) vs N 掃描：每個 N 用 sample-level（工作量 N·trials 以 2e6 為上限、N > 4e6 略過）。 */
function runComparatorSweepNonideal(params: ComparatorSweepParams, h: number, eps: number): ComparatorSweepResult {
  const { s, sigma, Ns, seed, tieRule } = params
  const theta = params.theta ?? 0
  const level = params.level ?? 0.95
  const trials = Math.max(1, Math.floor(params.trials))
  const ch = comparatorChain(s, sigma, h, eps, theta)
  const t = trueSignOf(s)
  const root = createRng(seed)
  const keep = Ns.filter((N) => N <= 4e6)
  const n = keep.length
  const out: ComparatorSweepResult = { N: new Float64Array(n), correct: new Float64Array(n), lo: new Float64Array(n), hi: new Float64Array(n), exact: new Float64Array(n) }
  for (let i = 0; i < n; i++) {
    const N = keep[i]
    const T = Math.max(20, Math.min(trials, Math.floor(2e6 / N)))
    const rng = root.fork(`sweep-${N}`)
    const coin = root.fork(`sweep-tie-${N}`)
    const start: 1 | -1 = ch.stuck ? (s - theta >= 0 ? 1 : -1) : rng.uniform() < ch.piPlus ? 1 : -1
    const st = createNonidealStepper(s, sigma, h, eps, theta, rng, start)
    for (let k = 0; k < 256; k++) st.step()
    let c = 0
    for (let j = 0; j < T; j++) {
      let S = 0
      for (let k = 0; k < N; k++) S += st.step()
      if (classify(S, tieRule, t, coin) === 'correct') c++
    }
    const w = wilsonCI(c, T, level)
    out.N[i] = N
    out.correct[i] = c / T
    out.lo[i] = w.lo
    out.hi[i] = w.hi
    const ex = N <= 120 ? directionExactChain(ch, N) : null
    out.exact[i] = applyTieRule(ex ?? directionCltChain(ch, N), tieRule, t).correct
  }
  return out
}
