/**
 * Comparator Lab 的純計算（不含 React）：解析摘要、曲線與 preset 解析。
 * 放在章節資料夾內是因為只有本實驗使用；所有數值仍來自 src/simulation/models/comparator.ts。
 */
import { normCdf, normPdf } from '@/simulation/core'
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
  chainSlope,
  chainSumMoments,
  comparatorChain,
  directionCltChain,
  directionCurveChain,
  chainSumPmf,
  kqHysteresis,
  kqMetaDrop,
  nonidealSummary,
  samplesForConfidenceChain,
  type ComparatorChain,
  type NonidealSummary,
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
  /** §5b：hysteresis 半寬 h（fs；門檻 θ ∓ h 依上一個輸出而定）。0 = 無記憶 */
  h: number
  /** §5b：metastability 決策窗 ε（fs；|e − θ_a| < ε 的 sample 漏掉，drop）。0 = 關閉 */
  eps: number
}

/** 主執行緒上精確 DP（chainSumPmf）的工作量上限：N = 10001、σ_v 級的 h 約 0.1–0.2 s，再大就改用 CLT（Markov） */
export const LAB_DP_WORK_LIMIT = 6e7

/** §5b 的解析摘要（h 或 ε > 0 時才有） */
export interface NonidealAnalysis {
  /** 工作點 s 的 chain（平穩統計） */
  chain: ComparatorChain
  /** s = θ 的設計量（斜率比、ν、雜訊因子、K_eff、所需 N 的倍數） */
  summary: NonidealSummary
  /** split 是精確 DP（true）還是 CLT（Markov）近似（false） */
  exactSplit: boolean
  /** 純遲滯／純 drop 時的封閉式斜率（混合時 NaN） */
  closedSlope: number
  /** 等效獨立樣本數 N²·Var(y)/Var(S_N) */
  nEff: number
  /** 精確 DP 的 pmf 直接算出的 E[S_N]、Var(S_N)（工作量內才有）：與 F-05.23 的封閉式是兩個獨立的算法，Analytic 欄互相核對 */
  dpMoments: { mean: number; variance: number } | null
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

export const DEFAULT_CASE: LabCase = { s: 1, sigma: 100, theta: 0, tieRule: 'half', h: 0, eps: 0 }
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
  /** §5b：h 或 ε > 0 時的 chain 解析；理想 comparator 為 null */
  nonideal: NonidealAnalysis | null
}

/** 是否啟用 §5b 的非理想 comparator（h 或 ε > 0） */
export function isNonideal(c: Pick<LabCase, 'h' | 'eps'>): boolean {
  return c.h > 0 || c.eps > 0
}

export function analyzeCase(c: LabCase, N: number): CaseAnalysis {
  if (isNonideal(c)) return analyzeNonidealCase(c, N)
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
    nonideal: null,
  }
}

/**
 * §5b：非理想 comparator 的解析——latch 狀態的兩狀態 Markov chain（drop 政策）。
 * 單一樣本的 p、m 換成 chain 的平穩 P(y = +1) 與 E[y]；S_N 的分布用精確 DP（工作量內）或 CLT（Markov 變異數）；
 * exact binomial、小訊號的 N 與 tie rule 的平衡點偏移都不適用（NaN／null）。
 */
function analyzeNonidealCase(c: LabCase, N: number): CaseAnalysis {
  const t: 1 | -1 = c.s >= 0 ? 1 : -1
  const hasNoise = c.sigma > 0
  const chain = comparatorChain(c.s, c.sigma, c.h, c.eps, c.theta)
  const summary = nonidealSummary(c.sigma, c.h, c.eps, c.theta)
  const m = chain.meanOut
  const mEff = t * m
  const r = hasNoise ? (c.s - c.theta) / c.sigma : NaN
  const mo = chainSumMoments(N, chain)
  // 精確 DP 只算一次：同一個 pmf 給出 P(S_N > 0／= 0／< 0) 與 E[S_N]、Var(S_N)（後兩者和 F-05.23 的封閉式核對）
  const table = chainSumPmf(chain, N, LAB_DP_WORK_LIMIT)
  let exact: DirectionSplit | null = null
  let dpMoments: NonidealAnalysis['dpMoments'] = null
  if (table) {
    let pos = 0
    let neg = 0
    let m1 = 0
    let m2 = 0
    for (let i = 0; i < table.pmf.length; i++) {
      const pi = table.pmf[i]
      if (pi === 0) continue
      const S = i - table.offset
      if (S > 0) pos += pi
      else if (S < 0) neg += pi
      m1 += S * pi
      m2 += S * S * pi
    }
    exact = { pos, tie: table.pmf[table.offset], neg }
    dpMoments = { mean: m1, variance: m2 - m1 * m1 }
  }
  const clt = directionCltChain(chain, N)
  const split = exact ?? clt
  const cltPlain = mo.sdSum > 0 ? normCdf((t * mo.meanSum) / mo.sdSum) : mEff > 0 ? 1 : 0
  const closedSlope = !hasNoise ? NaN : c.eps === 0 ? kqHysteresis(c.sigma, c.h) : c.h === 0 ? kqMetaDrop(c.sigma, c.eps) : NaN
  return {
    t,
    p: chain.pPlusOut,
    m,
    mEff,
    r,
    Kq: hasNoise ? kq(c.sigma) : Infinity,
    kLocal: hasNoise ? chainSlope(c.sigma, c.h, c.eps, c.theta, c.s) : NaN,
    linErr: hasNoise && summary.slope > 0 && c.s !== c.theta ? (summary.slope * (c.s - c.theta)) / m - 1 : NaN,
    mo,
    split,
    outcome: applyTieRule(split, c.tieRule, t),
    cltPlain,
    cltCorr: applyTieRule(clt, c.tieRule, t),
    n95Clt: mEff > 0 ? samplesForConfidenceChain(chain, 0.95) : Infinity,
    n95Small: Infinity,
    n95Exact: null,
    tieBias: NaN,
    nonideal: { chain, summary, exactSplit: exact !== null, closedSlope, nEff: mo.nEff, dpMoments },
  }
}

/** P(判對) vs N 圖的 N 上限：涵蓋目前的 N 與 95% 門檻（夾在 [200, 2e7]）。 */
export function curveNmax(a: CaseAnalysis, N: number): number {
  const target = Number.isFinite(a.n95Clt) ? 3 * a.n95Clt : 0
  return Math.min(2e7, Math.max(200, 4 * N, target))
}

export function caseCurve(c: LabCase, Nmax: number): DirectionCurve {
  const t: 1 | -1 = c.s >= 0 ? 1 : -1
  if (isNonideal(c)) return directionCurveChain(comparatorChain(c.s, c.sigma, c.h, c.eps, c.theta), Nmax, c.tieRule, t, 120, 24)
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
  /** q = +1 的總次數 ~ Binomial(N·T, p)；§5b 的非理想 comparator 樣本相關，不做這一項（null） */
  plus: CountCheck | null
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
  const tie = countCheck(mc.counts.tie, T, a.split.tie)
  // 計數與接受域保留純文字（方便複製與搜尋）；只有數學符號用 `$...$`（ExperimentShell 的交叉比對附註與警告會以 KaTeX 顯示）
  const show = (name: string, c: CountCheck) => `${name} ${c.k}/${c.n}（接受域 [${c.kLo}, ${c.kHi}]${c.ok ? '' : '，超出'}）`
  if (a.nonideal) {
    // §5b：每個 trial 的 S_N 仍是獨立的（chain 跨 trial 連續但 N ≫ 記憶長度），所以判對與 tie 的計數照樣是 Binomial(T, P)；
    // 單一樣本的 +1 計數彼此相關，不做那一項。P 來自精確 DP 或 CLT（Markov）——後者另註明。
    const ok = correct.ok && tie.ok
    return {
      ok,
      correct,
      plus: null,
      tie,
      detail: String.raw`${show('判對', correct)}；${show('tie', tie)}。接受域 = 精確 Binomial 每側機率 $<3.2\times10^{-5}$（等效 $4\sigma$），$P$ 由 ${a.nonideal.exactSplit ? '兩狀態 chain 的精確 DP' : 'CLT（Markov 變異數）近似'}；非理想 comparator 的樣本彼此相關，不比 $q=+1$ 的總計數；sample-level 引擎（帶 latch 狀態），與解析同一條 tie rule`,
    }
  }
  const plus = countCheck(mc.plusCount, N * T, a.p)
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
  const h = num('h', 0, 10000)
  if (h !== undefined) c.h = h
  const eps = num('eps', 0, 10000)
  if (eps !== undefined) c.eps = eps
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
  if (a.nonideal) {
    const { chain, summary, exactSplit } = a.nonideal
    if (chain.stuck) {
      w.push(String.raw`latch 永遠不翻轉（$\sigma_v=0$ 且 $|s-\theta|$ 落在決策窗內或門檻之外）：輸出卡在初始狀態，沒有平穩分布，也沒有任何方向資訊。`)
    } else {
      if (c.h > 0) {
        w.push(
          String.raw`遲滯 $h=${texNum(c.h)}\,\mathrm{fs}$（$\eta=${texNum(c.h / c.sigma, 3)}$）：相鄰輸出相關 $\nu=${texNum(summary.nu, 4)}$。工作點的平穩斜率是 $K_q$ 的 $${texNum(summary.slopeRatio, 4)}$ 倍，但 block 平均的雜訊是 iid 的 $F=${texNum(summary.noiseFactor, 4)}$ 倍；資訊等效增益 $K_{\mathrm{eff}}/K_q=${texNum(summary.kqEffRatio, 4)}$，達到同樣正確率要 $${texNum(summary.nRatio, 4)}$ 倍的 $N$（F-05.22、F-05.26）。exact binomial 與小訊號的 $N$ 公式不適用，改用 chain 的 DP／CLT。`,
        )
      }
      if (c.eps > 0) {
        w.push(
          String.raw`決策窗 $\varepsilon=${texNum(c.eps)}\,\mathrm{fs}$：每個 sample 有 $P_{\mathrm{meta}}=${texNum(chain.pMeta, 4)}$ 的機率解不出來（drop：不累加、除數仍是 $N$），這個 $N$ 平均漏掉 $${texNum(N * chain.pMeta, 4)}$ 個；平均斜率只少 $${texNum(100 * (1 - Math.exp((-c.eps * c.eps) / (2 * c.sigma * c.sigma))), 3)}\%$（F-05.25）。$S_N$ 不再和 $N$ 同奇偶：任何 $N$ 都可能 tie。`,
        )
      }
      if (!exactSplit) {
        w.push(String.raw`$N=${N}$ 的精確 DP 超過主執行緒的工作量上限：$P(\text{判對})$ 與 histogram 的期望值改用 CLT（Markov 變異數）近似，誤差約 $1/\sqrt{N_{\mathrm{eff}}}$ 的量級；Monte Carlo 仍是精確的模擬。`)
      }
    }
  }
  if (N % 2 === 0 && Number.isFinite(a.tieBias) && Math.abs(a.tieBias) > 0.1 * Math.abs(c.s || 1)) {
    w.push(
      String.raw`偶數 $N=${N}$ 搭配確定性 tie rule（${c.tieRule === 'strict' ? String.raw`strict，硬體上即 $\operatorname{sign}(0)=-1$` : String.raw`$\operatorname{sign}(0)=+1$`}）：$P(S_N=0)=${(100 * a.split.tie).toFixed(2)}\%$。若迴路只取 $\operatorname{sign}(S_N)$ 更新（判號式 block 迴路），平衡點會偏移約 $${a.tieBias.toFixed(3)}\,\mathrm{fs}$（$\approx\mp1/(NK_q)$）；線性 GMAC 更新 $w\leftarrow w+\mu S_N/N$ 不受影響。改用奇數 $N$、random tie-break 或 tie 不更新可消除。`,
    )
  }
  return w
}
