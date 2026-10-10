import { stepSize, type AlgoId, type AlgoMcStats, type AlgoMeanField, type CaseConfig, type SteadyStatePrediction } from '@/simulation/models/sgd'

/** 3 位有效數字、不用科學記號（放進 `$...$` 字串） */
const num3 = (v: number) => String(Number(v.toPrecision(3)))

/** sig 位有效數字 → TeX 片段（放進 `$...$` 字串）：很小／很大的數寫成 a\times10^{b}，不讓 "1.2e-7" 這種純文字指數出現在畫面上。 */
export function texSig(v: number, sig: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? String.raw`\text{—}` : v > 0 ? String.raw`\infty` : String.raw`-\infty`
  const s = String(Number(v.toPrecision(sig)))
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
}

export interface ConsistencyInput {
  c: CaseConfig
  algo: AlgoId
  /** 該演算法實際使用的 μ（排程的 μ₀） */
  mu: number
  mf: AlgoMeanField
  pred: SteadyStatePrediction
  st?: AlgoMcStats
}

export interface ConsistencyResult {
  /** 預期的 MC 時間平均：w* + O(μ) 曲率修正 */
  expect: number
  /** 容差（見下方規則） */
  tol: number
  /** null：無 MC 結果、不可辨識或尚未收斂；true/false：是否一致 */
  ok: boolean | null
  /** ok 為 null 時的原因（顯示在 cross-check 的說明） */
  reason?: string
}

/**
 * Analytic（mean-field）vs Monte Carlo 的一致性判準：
 *   |MC 後半段時間平均 − (w* + ψ″Var/(2K))| ≤ 4·SE + ½|曲率修正| + 量化項 + 1e-4(1 + |a|)
 * 量化項：無雜訊的 sign 演算法是確定性 limit cycle，時間平均可偏離 w* 達半個步長（取 1.5·μ·|x|_max）；
 * 有雜訊時加上 ½·μ_N·|x|（最後步長的 lattice 效應，遞減步長時很小）。
 *
 * 先檢查「後半段是否已到穩態」，否則時間平均不能拿來和 w* 比（會誤報 mismatch）：
 *   (1) MC 診斷：第 4 段與第 3 段（各四分之一）平均的差 > 4·SE + 量化項 ⇒ 還在漂移；
 *   (2) 固定步長、線性化穩定時：|w₀ − w*|·|1 − μK|^{N/2} > ½·容差 ⇒ 暫態還沒衰減完。
 * 兩者任一成立就回傳 ok = null 並說明原因（例如 μ 太小、步數太少、遞減步長 stall）。
 * 全部發散時：若解析也預測不穩定則視為一致（兩者都說「不穩定」）。
 * sign / Huber 類在 μK ≥ 2 時（單步更新有界，不會發散，但線性化失效）也不比較，並說明原因。
 * 梯度雜訊變異為 ∞（重尾）時不比較：4·SE 的判準假設變異數有限（勘誤 E14 的同一個陷阱）。
 */
export function fixedPointConsistency({ c, algo, mu, mf, pred, st }: ConsistencyInput): ConsistencyResult {
  const shift = Number.isFinite(pred.meanShift) ? pred.meanShift : 0
  const expect = mf.wStar + shift
  if (!mf.identifiable) return { expect, tol: NaN, ok: null, reason: '不可辨識' }
  if (!st) return { expect, tol: NaN, ok: null }
  // 梯度雜訊變異無限大（NLMS、ε = 0、x 的密度在 0 不為零）：w_n 是重尾分布，樣本平均的 SE 不可靠，不做 4·SE 比較
  if (!Number.isFinite(mf.gradVar) && !mf.deterministic)
    return { expect, tol: NaN, ok: null, reason: String.raw`更新量的變異數無限大（重尾）：樣本平均的標準誤不可靠，不比較；請設 $\varepsilon>0$` }
  const signAlgo = algo === 'sign_error' || algo === 'sign_sign'
  const det = mf.deterministic && signAlgo
  const xMax = algo === 'sign_sign' ? 1 : Math.abs(c.xAmp) * (c.xKind === 'gauss' ? 3 : 1.5)
  const muEnd = stepSize(mu, Math.max(0, c.steps - 1), { kind: c.schedule, n0: c.n0 })
  const quant = signAlgo ? (det ? 1.5 * mu * xMax : 0.5 * muEnd * xMax) : 0
  const floor = 1e-4 * (1 + Math.abs(c.a))
  const tol = 4 * (Number.isFinite(st.tavgSe) ? st.tavgSe : 0) + 0.5 * Math.abs(shift) + quant + floor
  if (st.n === 0) return { expect, tol, ok: !pred.stable && !det }
  // 小步長假設不成立（穩態的 μK ≥ 2）：sign / Huber 類的單步更新有界，不會發散，但 mean-field 固定點不再描述時間平均
  if (!det && (signAlgo || algo === 'huber') && Number.isFinite(mf.K) && muEnd * mf.K >= 2)
    return { expect, tol, ok: null, reason: String.raw`$\mu K=${num3(muEnd * mf.K)}\ge2$：小步長（線性化）假設不成立，時間平均不必等於 mean-field 固定點；請減小 $\mu$` }
  // (1) 後半段仍在漂移？
  const driftTol = 4 * (Number.isFinite(st.driftSe) ? st.driftSe : 0) + quant + floor
  if (Number.isFinite(st.driftMean) && Math.abs(st.driftMean) > driftTol)
    return { expect, tol, ok: null, reason: String.raw`後半段仍在漂移（第 3、4 段平均相差 $${texSig(st.driftMean, 3)}$）：尚未收斂，請加大步數或 $\mu$（或按「執行至收斂」）` }
  // (2) 固定步長的暫態估計
  if (c.schedule === 'constant' && pred.stable && Number.isFinite(pred.pole)) {
    // 後半段（L 個樣本）上暫態 R·qᵏ 的平均：R·(1 − q^L)/((1 − q)L)，R 為後半段起點的殘差
    const half = Math.floor(c.steps / 2)
    const L = c.steps - half + 1
    const q = Math.abs(pred.pole)
    const start = Math.abs(c.w0 - expect) * q ** half
    const avgResidual = q < 1 ? (start * (1 - q ** L)) / ((1 - q) * L) : start
    if (avgResidual > 0.5 * tol)
      return { expect, tol, ok: null, reason: String.raw`暫態尚未衰減（$\tau\approx${Math.round(pred.tau)}$ 步，後半段平均仍偏約 $${texSig(avgResidual, 2)}$）：請加大步數（或按「執行至收斂」）` }
  }
  return { expect, tol, ok: Math.abs(st.tavgMean - expect) <= tol }
}

/** 把多列一致性結果整理成 ExperimentShell 的 crossCheck.analytic（沒有任何可比較的列時誠實回報 n/a）。 */
export function summarizeConsistency(rows: { ok: boolean | null; reason?: string; label: string }[]): { status: 'ok' | 'mismatch' | 'n/a'; note: string } {
  const bad = rows.filter((r) => r.ok === false)
  const good = rows.filter((r) => r.ok === true)
  const skipped = rows.filter((r) => r.ok === null && r.reason)
  const skipNote = skipped.length ? `；未比較：${skipped.map((r) => `${r.label}（${r.reason}）`).join('、')}` : ''
  if (bad.length) return { status: 'mismatch', note: `不一致：${bad.map((r) => r.label).join('、')}${skipNote}` }
  if (good.length) return { status: 'ok', note: String.raw`mean-field $w^*$（$+O(\mu)$ 修正）落在 MC 的 $4\,\mathrm{SE}$ 容差內（${good.length} 列）${skipNote}` }
  return { status: 'n/a', note: skipped.length ? `沒有可比較的列${skipNote}` : 'Monte Carlo 計算中…' }
}
