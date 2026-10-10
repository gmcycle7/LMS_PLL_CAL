/**
 * Comparator Lab 的純計算（不含 React）：解析摘要、曲線與 preset 解析。
 * 放在章節資料夾內是因為只有本實驗使用；所有數值仍來自 src/simulation/models/comparator.ts。
 */
import { normPdf } from '@/simulation/core'
import {
  TIE_RULES,
  applyTieRule,
  binomialAcceptance,
  directionCltPlain,
  directionCurve,
  directionExact,
  directionOutcomeClt,
  kq,
  kqLocal,
  linearizationRelError,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  samplesSmallSignal,
  sumMoments,
  tieRuleEquilibrium,
  type ComparatorMcResult,
  type DirectionCurve,
  type DirectionOutcome,
  type DirectionSplit,
  type McMethod,
  type SumMoments,
  type TieRule,
} from '@/simulation/models/comparator'
import { texNum } from '../common'

export const EXP_ID = 'comparator-lab'

/** 每個 Case（A/B/C）各自的參數 */
export interface LabCase {
  /** 固定誤差 s（fs） */
  s: number
  /** 雜訊 RMS σ_v（fs）；0 = hard limiter */
  sigma: number
  /** comparator threshold / offset θ（fs） */
  theta: number
  tieRule: TieRule
}

/** 所有 Case 共用的參數 */
export interface LabShared {
  N: number
  trials: number
  method: McMethod
  /** histogram / 路徑圖的軸：sum S_N 或 average G = S_N/N（勘誤 E18） */
  axis: 'sum' | 'average'
  level: number
  sweepTrials: number
}

export const DEFAULT_CASE: LabCase = { s: 1, sigma: 100, theta: 0, tieRule: 'half' }
export const DEFAULT_SHARED: LabShared = { N: 10001, trials: 4000, method: 'auto', axis: 'sum', level: 0.95, sweepTrials: 2000 }

/** 單一 Case 在給定 N 下的解析摘要 */
export interface CaseAnalysis {
  /** 正確方向（s = 0 時以 +1 為參考） */
  t: 1 | -1
  p: number
  m: number
  /** m 朝正確方向的分量 t·m（> 0 才可能越累加越準） */
  mEff: number
  r: number
  Kq: number
  kLocal: number
  linErr: number
  mo: SumMoments
  split: DirectionSplit
  outcome: DirectionOutcome
  cltPlain: number
  cltCorr: DirectionOutcome
  n95Clt: number
  n95Small: number
  n95Exact: number | null
  /** 偶數 N 的確定性 tie rule 造成的平衡點偏移（x ≡ 1 的 block 決策迴路；NaN = 不適用） */
  tieBias: number
}

export function analyzeCase(c: LabCase, N: number): CaseAnalysis {
  const t: 1 | -1 = c.s >= 0 ? 1 : -1
  const p = pPlus(c.s, c.sigma, c.theta)
  const m = meanQ(c.s, c.sigma, c.theta)
  const mEff = t * m
  const hasNoise = c.sigma > 0
  const r = hasNoise ? (c.s - c.theta) / c.sigma : NaN
  const split = directionExact(p, N)
  const n95Clt = mEff > 0 ? samplesForConfidence(mEff, 0.95) : Infinity
  const n95Small = hasNoise && mEff > 0 ? samplesSmallSignal(Math.abs(r), 0.95) : Infinity
  return {
    t,
    p,
    m,
    mEff,
    r,
    Kq: hasNoise ? kq(c.sigma) : Infinity,
    kLocal: hasNoise ? kqLocal(c.s, c.sigma, c.theta) : NaN,
    linErr: hasNoise ? linearizationRelError(r) : NaN,
    mo: sumMoments(N, m),
    split,
    outcome: applyTieRule(split, c.tieRule, t),
    cltPlain: directionCltPlain(mEff, N),
    cltCorr: directionOutcomeClt(m, N, c.tieRule, t),
    n95Clt,
    n95Small,
    n95Exact: mEff > 0 && n95Clt < 5e7 ? minNForTarget(p, 0.95, 'odd', 'strict', t, 5e7) : null,
    tieBias: hasNoise && N % 2 === 0 && N <= 1e6 ? tieRuleEquilibrium(N, c.sigma, c.tieRule) : NaN,
  }
}

/** P(判對) vs N 圖的 N 上限：涵蓋目前的 N 與 95% 門檻（夾在 [200, 2e7]）。 */
export function curveNmax(a: CaseAnalysis, N: number): number {
  const target = Number.isFinite(a.n95Clt) ? 3 * a.n95Clt : 0
  return Math.min(2e7, Math.max(200, 4 * N, target))
}

export function caseCurve(c: LabCase, Nmax: number): DirectionCurve {
  const t: 1 | -1 = c.s >= 0 ? 1 : -1
  return directionCurve(pPlus(c.s, c.sigma, c.theta), Nmax, c.tieRule, t, 120, 24)
}

/** Monte Carlo 掃描用的 N：對數格點，每點取一偶一奇（顯示鋸齒）。 */
export function sweepNs(Nmax: number, points = 9): number[] {
  const out = new Set<number>([1, 2])
  const a = Math.log10(4)
  const b = Math.log10(Math.max(8, Nmax))
  for (let i = 0; i < points; i++) {
    const base = Math.round(Math.pow(10, a + ((b - a) * i) / (points - 1)))
    const even = base % 2 === 0 ? base : base + 1
    out.add(even)
    out.add(even + 1)
  }
  return [...out].filter((n) => n <= Nmax + 1).sort((x, y) => x - y)
}

/** CLT 的 S_N 密度換算成「每個 bin 的期望個數」：T·w·φ((x − Nm)/σ_S)/σ_S。 */
export function cltCounts(xs: number[], mo: SumMoments, trials: number, width: number): number[] {
  if (!(mo.sdSum > 0)) return xs.map(() => 0)
  return xs.map((x) => (trials * width * normPdf((x - mo.meanSum) / mo.sdSum)) / mo.sdSum)
}

/** 一個 MC 計數與它的精確 Binomial 接受域。 */
export interface CountCheck {
  /** 觀察到的次數 */
  k: number
  /** 試驗次數 */
  n: number
  /** 模型的成功機率 */
  p: number
  kLo: number
  kHi: number
  ok: boolean
  /** 以機率為單位的容差：接受域離期望值較遠的那一側（MetricTable 的 tolerance） */
  tol: number
}

export interface McConsistency {
  ok: boolean
  /** 判對次數 ~ Binomial(T, P(判對)) */
  correct: CountCheck
  /** q = +1 的總次數 ~ Binomial(N·T, p) */
  plus: CountCheck
  /** tie（S_N = 0）次數 ~ Binomial(T, P(S_N = 0)) */
  tie: CountCheck
  detail: string
}

function countCheck(k: number, n: number, p: number): CountCheck {
  const { kLo, kHi } = binomialAcceptance(n, p)
  return { k, n, p, kLo, kHi, ok: k >= kLo && k <= kHi, tol: Math.max(n * p - kLo, kHi - n * p) / n + 1e-15 }
}

/**
 * Analytic ↔ Monte Carlo 交叉比對：三個計數（判對、q = +1、tie）都必須落在精確 Binomial 的「等效 4σ」接受域內
 * （每側機率 < Φ(−4) ≈ 3.2e-5）。不用 4·SE 的常態近似，因為判錯是稀有事件時（飽和、大 N）它會誤報。
 */
export function mcConsistency(
  a: CaseAnalysis,
  N: number,
  mc: Pick<ComparatorMcResult, 'outcome' | 'counts' | 'plusCount' | 'trialsUsed' | 'methodUsed'>,
): McConsistency {
  const T = mc.trialsUsed
  const correct = countCheck(mc.outcome.correct, T, a.outcome.correct)
  const plus = countCheck(mc.plusCount, N * T, a.p)
  const tie = countCheck(mc.counts.tie, T, a.split.tie)
  // 計數與接受域保留純文字（方便複製與搜尋）；只有數學符號用 `$...$`（ExperimentShell 的交叉比對附註與警告會以 KaTeX 顯示）
  const show = (name: string, c: CountCheck) => `${name} ${c.k}/${c.n}（接受域 [${c.kLo}, ${c.kHi}]${c.ok ? '' : '，超出'}）`
  const ok = correct.ok && plus.ok && tie.ok
  return {
    ok,
    correct,
    plus,
    tie,
    detail: String.raw`${show('判對', correct)}；${show('$q=+1$', plus)}；${show('tie', tie)}。接受域 = 精確 Binomial 每側機率 $<3.2\times10^{-5}$（等效 $4\sigma$）；${mc.methodUsed} 引擎，與解析同一條 tie rule`,
  }
}

const METHODS: McMethod[] = ['auto', 'sample', 'binomial']

/** 把 preset 的 params（JSON）安全地拆成 Case 與共用參數；無效欄位直接略過。 */
export function parsePresetParams(params: Record<string, unknown>): { c: Partial<LabCase>; sh: Partial<LabShared> } {
  const num = (k: string, lo: number, hi: number): number | undefined => {
    const v = params[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined
  }
  const c: Partial<LabCase> = {}
  const sh: Partial<LabShared> = {}
  const s = num('s', -1000, 1000)
  if (s !== undefined) c.s = s
  const sigma = num('sigma', 0, 10000)
  if (sigma !== undefined) c.sigma = sigma
  const theta = num('theta', -1000, 1000)
  if (theta !== undefined) c.theta = theta
  if (typeof params.tieRule === 'string' && (TIE_RULES as readonly string[]).includes(params.tieRule)) c.tieRule = params.tieRule as TieRule
  const N = num('N', 1, 1e7)
  if (N !== undefined) sh.N = Math.round(N)
  const trials = num('trials', 10, 200000)
  if (trials !== undefined) sh.trials = Math.round(trials)
  if (typeof params.method === 'string' && (METHODS as string[]).includes(params.method)) sh.method = params.method as McMethod
  if (params.axis === 'sum' || params.axis === 'average') sh.axis = params.axis
  const level = num('level', 0.5, 0.9999)
  if (level !== undefined) sh.level = level
  return { c, sh }
}

/** 依參數產生「解釋原因」的警告（ExperimentShell 以 danger callout 顯示；字串中的 `$...$` 會以 KaTeX 顯示）。 */
export function labWarnings(c: LabCase, a: CaseAnalysis, N: number): string[] {
  const w: string[] = []
  if (c.sigma === 0) {
    w.push(
      String.raw`$\sigma_v=0$：Comparator 退化成 hard limiter，$E[q]=\operatorname{sign}(s-\theta)$，$K_q$ 不存在（在 $s=\theta$ 處無限大、其他地方為 0）。單一樣本就「確定」了方向，但 LMS 迴路會在 $\pm\mu$ 之間形成 limit cycle、時間平均最多偏 $\mu/2$（見 §7 dither 實驗）。`,
    )
  }
  if (c.s === 0) {
    w.push(String.raw`$s=0$：沒有「正確方向」可言；以下的 $P(\text{判對})$ 以 $+1$ 為參考方向，只代表 $P(\text{判 }{+1})$。`)
  } else if (a.mEff < 0) {
    w.push(
      String.raw`Offset 蓋過誤差：$\theta=${texNum(c.theta)}\,\mathrm{fs}$ 使 $E[q]=${texNum(a.m)}$ 與 $s=${texNum(c.s)}\,\mathrm{fs}$ 反號。$N$ 越大越「確定地」判錯（$P(\text{判對})\to0$）；offset 造成的偏差不能靠增加 $N$ 消除，必須先校正 comparator offset（或讓 PLL integral path 吸收，見 Ch11）。`,
    )
  } else if (a.mEff === 0) {
    w.push(String.raw`$\theta=s$：comparator 門檻剛好落在誤差上，$E[q]=0$，任何 $N$ 都只能擲硬幣。`)
  }
  if (c.sigma > 0 && a.linErr > 0.01) {
    w.push(
      String.raw`$|s-\theta|/\sigma_v=${Math.abs(a.r).toFixed(3)}$：$K_q$ 線性化高估 ${(100 * a.linErr).toFixed(2)}%（$>1\%$，門檻約 $|r|=0.245$）。大誤差時 S 曲線飽和，平均輸出不再與 $s$ 成正比；用 $K_q$ 算的 loop gain 會偏大、收斂時間會被低估。`,
    )
  }
  if (N % 2 === 0 && Number.isFinite(a.tieBias) && Math.abs(a.tieBias) > 0.1 * Math.abs(c.s || 1)) {
    w.push(
      String.raw`偶數 $N=${N}$ 搭配確定性 tie rule（${c.tieRule === 'strict' ? String.raw`strict，硬體上即 $\operatorname{sign}(0)=-1$` : String.raw`$\operatorname{sign}(0)=+1$`}）：$P(S_N=0)=${(100 * a.split.tie).toFixed(2)}\%$。若迴路只取 $\operatorname{sign}(S_N)$ 更新（判號式 block 迴路），平衡點會偏移約 $${a.tieBias.toFixed(3)}\,\mathrm{fs}$（$\approx\mp1/(NK_q)$）；線性 GMAC 更新 $w\leftarrow w+\mu S_N/N$ 不受影響。改用奇數 $N$、random tie-break 或 tie 不更新可消除。`,
    )
  }
  return w
}
