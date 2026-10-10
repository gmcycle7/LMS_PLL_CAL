/**
 * Monte Carlo 交叉比對的橋接（純函式，可單元測試；React 端在 experiment/MonteCarloCheck.tsx）。
 *
 * 「六條件體檢」是線性化的解析模型。這裡把同一組參數轉成全站共用的 block Sign-LMS 模型
 * （src/simulation/models/blockLms.ts，規格 §15.3 的 JSON 介面；Calibration Lab 用的也是它）的設定，
 * 由 Web Worker 呼叫 runBlockLmsMonteCarlo 逐 sample 模擬 q[n] = sign(e[n])，再和解析值比較：
 *   收斂的情況：σ_w（條件 4）、固定點（條件 2）、一個時間常數後的暫態（條件 3 的 pole）；
 *   不收斂的情況：確認 Monte Carlo 也沒有收斂。
 * 限制：共用模型只有一個係數，也沒有可獨立設定的 B = E[x·ε_det]，所以只支援單參數，且以 B = 0 模擬
 *      （bias 請見 Ch11 的 Bias & INL Lab）。
 */
import type { BlockLmsConfigInput, BlockLmsMonteCarloResult } from '@/simulation/models/blockLms'
import { meanCI, studentTInv } from '@/simulation/core'
import { evaluateThesis, trajectory, type ThesisParams, type ThesisResult } from './thesisModel'

/** 模擬用的真實 gain a [fs]（任意值：線性化模型只依賴 δ = a − w） */
export const MC_GAIN_TRUE_FS = 3
/** 獨立 seeds 數（每個 seed 一條完整的收斂軌跡） */
export const MC_RUNS = 8
/** 瀏覽器內一次 Monte Carlo 的樣本預算（約 35 ns / sample ⇒ 數秒內完成） */
export const MC_SAMPLE_BUDGET = 5e7
/** 解析值本身是近似（線性化、q 近似 iid）：比較時在統計信賴區間之外再容許的相對模型誤差 */
export const MC_MODEL_TOL = 0.05
/** 信賴區間水準（跨 seeds 的 Student-t） */
export const MC_CI_LEVEL = 0.99

export interface McPlanOk {
  ok: true
  config: BlockLmsConfigInput
  runs: number
  numBlocks: number
  /** 統計用的後半段 block 數（blockLms 的 metrics 取 block ⌈(K+1)/2⌉…K） */
  lateBlocks: number
  totalSamples: number
  /** 解析模型的時間常數 −1/ln ρ [blocks]（不收斂時為 NaN） */
  tauBlocks: number
  /** 解析模型是否預測收斂 */
  expectStable: boolean
  notes: string[]
  /** 設定的指紋：參數或 seed 改變後，舊結果就不再適用 */
  key: string
}

export type McPlan = McPlanOk | { ok: false; reason: string }

// #region core:toBlockLmsConfig
/** 體檢參數 → 規格 §15.3 的 block Sign-LMS 設定（每一行右邊是對應的數學符號）。 */
export function toBlockLmsConfig(p: ThesisParams, numBlocks: number, seed: number): BlockLmsConfigInput {
  return {
    seed,
    sample_rate_hz: p.fsGHz * 1e9, // f_s
    output_frequency_hz: p.foutGHz * 1e9, // f_out
    gm_accum_samples: p.N, // N
    gm_mode: p.gmacMode, // average：G = (1/N)Σq·x；sum：G = Σq·x（μ 不變 ⇒ g 放大 N 倍）
    gain_true: MC_GAIN_TRUE_FS, // a
    gain_initial: MC_GAIN_TRUE_FS + p.w0MinusA, // w_0 = a + (w_0 − a)
    gain_step: p.mu, // μ [fs]
    pd_noise_rms_fs: p.sigmaV, // σ_v
    code_normalization: 'none', // 不重新正規化：P_x = A²/2 完全由振幅決定
    seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: Math.sqrt(2 * p.Px), omega: p.omega, phase_deg: 0, random_phase: false } }, // x[n] = A cos Ωn
    pll_error_path: { kind: 'single_tone', parameters: { magnitude: p.Hmag, phase_deg: p.phiDeg, omega: p.omega } }, // 2-tap FIR：H(e^{jΩ}) = |H|e^{jφ}
    regressor_mode: 'delayed', // GMAC 用 x[n − D] 相關
    gm_code_delay_samples: p.D, // D
    cal_update_delay_blocks: p.d, // d
    num_blocks: numBlocks,
    record: { sample_trace_blocks: 0, decimate: 1 }, // 不保存逐 sample 波形
  }
}
// #endregion

/** blockLms 的後半段統計窗：block h0 = ⌈(K+1)/2⌉ … K（含兩端） */
export function lateWindow(numBlocks: number): { start: number; count: number } {
  const start = Math.ceil((numBlocks + 1) / 2)
  return { start, count: numBlocks - start + 1 }
}

/**
 * 樣本數的 TeX（不含 `$`）：小於 10⁶ 時寫出整數（exact = true），否則取 3 位有效數字 5e7 → 5\times10^{7}。
 * 說明文字裡的數學一律在 `$…$` 內（docs/teaching-style.md §3）。
 */
export function countTex(x: number): { tex: string; exact: boolean } {
  if (x < 1e6) return { tex: String(Math.round(x)), exact: Number.isInteger(x) }
  let e = Math.floor(Math.log10(x))
  let m = Number((x / 10 ** e).toPrecision(3))
  if (m >= 10) {
    m /= 10
    e += 1
  }
  return { tex: m === 1 ? `10^{${e}}` : `${m}\\times10^{${e}}`, exact: m * 10 ** e === x }
}
/** 連乘式的行內 TeX：$8\times984\times4096\approx3.22\times10^{7}$（四捨五入過就用 ≈，否則用 =） */
export function productTex(factors: number[]): string {
  const c = countTex(factors.reduce((a, b) => a * b, 1))
  return `$${factors.join('\\times')}${c.exact ? '=' : '\\approx'}${c.tex}$`
}
/** 3 位有效數字的 TeX（時間常數等） */
const t3 = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(3)).toString() : '\\infty')

/**
 * 決定要不要跑、跑多長：收斂時取 40 個時間常數（後半段 20τ 用來估 σ_w），不收斂時取 400 blocks；
 * 總樣本數 runs × blocks × N 不得超過 MC_SAMPLE_BUDGET。無法模擬時回傳原因（不是只說「無法計算」）。
 */
export function planMonteCarlo(r: ThesisResult, seed: number, runs = MC_RUNS, budget = MC_SAMPLE_BUDGET): McPlan {
  const p = r.params
  if (p.twoParam)
    return { ok: false, reason: String.raw`共用的 block Sign-LMS 模型只有一個校正係數；兩參數（$\rho$、preconditioner）的 Monte Carlo 請到 Ch09 / Ch10 的 MIMO 實驗。` }
  if (!(p.Px > 0)) return { ok: false, reason: String.raw`$P_x=0$：沒有 code 可以模擬（單頻 code 的振幅必須為正）。` }
  if (Math.abs(Math.sin(p.omega)) < 1e-6)
    return { ok: false, reason: String.raw`$\Omega=0$ 或 $\pi$：實係數的 2-tap error path 在這個頻率無法給出任意相位（勘誤 E46），請改用 $0<\Omega<\pi$。` }
  const expectStable = r.stable
  const tau = expectStable ? (r.maxRadius > 1e-12 ? -1 / Math.log(r.maxRadius) : 0) : NaN
  const want = expectStable ? Math.max(240, Math.ceil(40 * tau) + p.d + 1) : 400
  const need = expectStable ? Math.max(60, Math.ceil(12 * tau) + p.d + 1) : 100
  const notes: string[] = []
  const requested = runs
  let kMax = Math.floor(budget / (runs * p.N))
  if (kMax < need && runs > 4) {
    // 時間常數很長時，寧可少幾個 seed、也要讓每條軌跡跑完（CI 會變寬，但不會把暫態當成穩態）
    runs = 4
    kMax = Math.floor(budget / (runs * p.N))
  }
  if (kMax < need)
    return {
      ok: false,
      reason:
        String.raw`至少需要 $${need}$ 個 block、每個 block $N=${p.N}$ 個 sample、${runs} 個 seed，共 ${productTex([need, p.N, runs])} 個 sample，超過瀏覽器內 Monte Carlo 的預算 $${countTex(budget).tex}$。` +
        (expectStable ? String.raw`時間常數 $\tau=${t3(tau)}$ 個 block 太長：` : '') +
        String.raw`請減小 $N$ 或加大 $\mu$，或到 Calibration Lab 跑長模擬。`,
    }
  if (runs < requested) notes.push(String.raw`時間常數很長（$\tau=${t3(tau)}$ 個 block）：seeds 由 ${requested} 減為 ${runs}，Student-t 信賴區間會明顯變寬。`)
  const numBlocks = Math.min(want, kMax)
  const late = lateWindow(numBlocks)
  if (numBlocks < want)
    notes.push(
      String.raw`受樣本預算限制，blocks 由 ${want} 縮為 ${numBlocks}：後半段只有 $${t3(late.count / Math.max(tau, 1e-9))}\,\tau$（時間常數），信賴區間會比較寬。`,
    )
  if (p.B !== 0)
    notes.push(String.raw`Monte Carlo 以 $B=0$ 模擬（共用模型沒有可獨立設定的 $E[x\,\varepsilon_{\mathrm{det}}]$）：比對的是極性、穩定與 variance；bias $\Delta w=B/C$ 請見 Ch11。`)
  if (r.linearityInit > 0.3)
    notes.push(String.raw`初始誤差相對 $\sigma_v$ 太大：comparator 飽和使真實收斂比線性模型慢，暫態比對可能不一致（這是線性化的適用範圍，不是程式錯誤）。`)
  const config = toBlockLmsConfig(p, numBlocks, seed)
  return {
    ok: true,
    config,
    runs,
    numBlocks,
    lateBlocks: late.count,
    totalSamples: runs * numBlocks * p.N,
    tauBlocks: tau,
    expectStable,
    notes,
    key: JSON.stringify([config, runs]),
  }
}

export interface McRow {
  id: 'sigma' | 'mean' | 'transient' | 'rms'
  /** 指標名稱（$…$ 為 TeX） */
  name: string
  /** 解析值；NaN 時顯示 analyticText */
  analytic: number
  analyticText?: string
  /** Monte Carlo 估計值與信賴區間 */
  mc: number
  lo: number
  hi: number
  unit: string
  pass: boolean
  /** 判定規則（文字；`$…$` 內為 TeX） */
  criterion: string
}

export interface McComparison {
  kind: 'converged' | 'not-converged'
  status: 'ok' | 'mismatch'
  /** 一句話摘要（顯示在交叉比對列） */
  note: string
  rows: McRow[]
  /** Monte Carlo 的後半段 RMS 誤差 √mean((w − a)²) [fs]（收斂時即 σ_w 的估計） */
  rmsMc: number
  /** 有幾個 seed 數值發散（|w| 超過 blockLms 的上限） */
  divergedRuns: number
}

type McStats = Pick<BlockLmsMonteCarloResult, 'perRun' | 'wMean' | 'wStd'>

/** 4 位有效數字的 TeX（用在 `$…$` 內） */
const f4 = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(4)).toString() : Number.isNaN(x) ? '\\text{—}' : x > 0 ? '\\infty' : '-\\infty')
/** 「數值 fs」的行內 TeX */
const fsTex = (x: number) => `$${f4(x)}\\,\\mathrm{fs}$`

// #region core:compareMonteCarlo
/**
 * 每個 seed 的後半段均方誤差：mean((w − a)²) = (n−1)/n·s² + (w̄ − a)²。
 * 用它（而不是樣本標準差 s）估計 σ_w，是因為 w_k 在 block 之間高度相關：只有 n ≈ 20τ 個 block 時，
 * 繞著樣本平均算的 s² 會低估約 2τ/n；繞著已知的固定點 a 算就沒有這個偏差。
 */
export function perRunMse(mc: McStats, lateCount: number): number[] {
  const n = lateCount
  return Array.from(mc.perRun.stdW, (s, i) => {
    const b = mc.perRun.bias[i]
    const v = ((n - 1) / n) * s * s + b * b
    return Number.isFinite(v) ? v : Infinity // 發散的 run：誤差視為無界
  })
}

/** 解析值 vs Monte Carlo：每一列都有「統計信賴區間 + 模型容許誤差」的明確判定規則。 */
export function compareMonteCarlo(r: ThesisResult, plan: McPlanOk, mc: McStats): McComparison {
  const p = r.params
  const R = plan.runs
  const t = studentTInv(0.5 + MC_CI_LEVEL / 2, R - 1) // 99% 雙尾 Student-t（R − 1 個自由度）
  const mse = perRunMse(mc, plan.lateBlocks)
  const finite = mse.every(Number.isFinite)
  const ciV = finite ? meanCI(mse, MC_CI_LEVEL) : { mean: Infinity, lo: Infinity, hi: Infinity }
  const rmsMc = Math.sqrt(ciV.mean)
  const delta0 = Math.abs(p.w0MinusA)
  const rows: McRow[] = []

  if (!plan.expectStable) {
    // 線性模型預測不收斂 ⇒ Monte Carlo 的誤差也不應該縮小到「健康迴路」的水準。
    // 用 CI 上限判定：只有在「整個信賴區間都低於門檻」（有顯著證據顯示它其實收斂了）時才算不一致，
    // 否則 C = 0 的 random walk（誤差只是不縮小，並不暴衝）會因為抽樣起伏被誤判。
    const floor = p.mu * r.scale * Math.sqrt(p.Px / p.N) // 每個 block 的雜訊步長 μ·s·√(P_x/N)
    const threshold = Math.max(delta0, 5 * floor)
    const hi = Math.sqrt(ciV.hi)
    rows.push({
      id: 'rms',
      name: '後半段 RMS 誤差 $\\sqrt{E[(w_k-a)^2]}$',
      analytic: NaN,
      analyticText: '不收斂（線性模型：無界）',
      mc: rmsMc,
      lo: Math.sqrt(Math.max(0, ciV.lo)),
      hi,
      unit: 'fs',
      pass: hi >= threshold,
      criterion: String.raw`CI 上限 $\ge\max\big(|\delta_0|,\ 5\,\mu s\sqrt{P_x/N}\big)=${f4(threshold)}\,\mathrm{fs}$（誤差沒有縮小）`,
    })
  } else {
    // (1) σ_w：解析值要落在「CI × (1 ± 模型容許誤差)」內
    const sLo = Math.sqrt(Math.max(0, ciV.lo))
    const sHi = Math.sqrt(ciV.hi)
    rows.push({
      id: 'sigma',
      name: '穩態係數雜訊 $\\sigma_w$',
      analytic: r.sigmaW,
      mc: rmsMc,
      lo: sLo,
      hi: sHi,
      unit: 'fs',
      pass: finite && r.sigmaW >= sLo * (1 - MC_MODEL_TOL) && r.sigmaW <= sHi * (1 + MC_MODEL_TOL),
      criterion: String.raw`解析值落在 [CI 下限 $\times\,${1 - MC_MODEL_TOL}$，CI 上限 $\times\,${1 + MC_MODEL_TOL}$] 內`,
    })
    // (2) 固定點：B = 0 時應該是 a（極性正確 ⇒ 平均誤差歸零）
    const bias = Array.from(mc.perRun.bias)
    const ciB = bias.every(Number.isFinite) ? meanCI(bias, MC_CI_LEVEL) : { mean: NaN, lo: -Infinity, hi: Infinity }
    const residual = delta0 * Math.pow(r.maxRadius, lateWindow(plan.numBlocks).start) // 後半段開頭還沒衰減完的暫態
    const allowB = MC_MODEL_TOL * r.sigmaW + residual
    rows.push({
      id: 'mean',
      name: '固定點 $E[w_k]-a$（$B=0$）',
      analytic: 0,
      mc: ciB.mean,
      lo: ciB.lo,
      hi: ciB.hi,
      unit: 'fs',
      pass: Number.isFinite(ciB.mean) && ciB.lo - allowB <= 0 && ciB.hi + allowB >= 0,
      criterion: String.raw`0 落在 CI $\pm\,${f4(allowB)}\,\mathrm{fs}$ 內`,
    })
    // (3) 暫態：一個時間常數後的平均誤差（檢查 pole）
    const k1 = Math.min(plan.numBlocks, Math.max(1, Math.round(plan.tauBlocks)) + p.d)
    if (delta0 > 0 && k1 < mc.wMean.length) {
      const r0 = p.B === 0 ? r : evaluateThesis({ ...p, B: 0 })
      const analytic = trajectory(r0, k1).mean[k1]
      const mcv = mc.wMean[k1] - MC_GAIN_TRUE_FS
      const half = (t * mc.wStd[k1]) / Math.sqrt(R)
      const allow = half + MC_MODEL_TOL * delta0
      rows.push({
        id: 'transient',
        name: `暫態 $E[w_k]-a$，$k=${k1}$`,
        analytic,
        mc: mcv,
        lo: mcv - half,
        hi: mcv + half,
        unit: 'fs',
        pass: Number.isFinite(mcv) && Math.abs(mcv - analytic) <= allow,
        criterion: String.raw`Monte Carlo 與解析值的差（絕對值）不超過 CI 半寬 $+\,${MC_MODEL_TOL}\,|\delta_0|=${f4(allow)}\,\mathrm{fs}$`,
      })
    }
  }

  const failed = rows.filter((x) => !x.pass)
  const status = failed.length === 0 ? 'ok' : 'mismatch'
  let note: string
  if (!plan.expectStable) {
    note =
      status === 'ok'
        ? String.raw`Monte Carlo 也沒有收斂：後半段 RMS 誤差 ${fsTex(rmsMc)}（初值 $|\delta_0|=${f4(delta0)}\,\mathrm{fs}$）`
        : `線性模型預測不收斂，但 Monte Carlo 的 RMS 誤差只有 ${fsTex(rmsMc)}（comparator 飽和可能把振盪限制在小振幅）`
  } else {
    const s = rows[0]
    note =
      status === 'ok'
        ? String.raw`${R} seeds：$\sigma_w=${f4(s.mc)}\,\mathrm{fs}$（99% CI $[${f4(s.lo)},\,${f4(s.hi)}]$）vs 解析 ${fsTex(s.analytic)}；固定點與暫態一致`
        : `不一致：${failed.map((x) => `${x.id === 'sigma' ? '$\\sigma_w$' : x.id === 'mean' ? '固定點' : '暫態'} MC ${fsTex(x.mc)} vs 解析 ${fsTex(x.analytic)}`).join('；')}`
  }
  return { kind: plan.expectStable ? 'converged' : 'not-converged', status, note, rows, rmsMc, divergedRuns: mc.perRun.diverged }
}
// #endregion

/** 解析的平均與 ±1σ（B = 0），給 Monte Carlo 疊圖用 */
export function analyticOverlay(r: ThesisResult, numBlocks: number) {
  const r0 = r.params.B === 0 ? r : evaluateThesis({ ...r.params, B: 0 })
  return trajectory(r0, numBlocks)
}

/** ThesisParams 欄位 ↔ §15.3 JSON 欄位的對照（頁面上以表格顯示） */
export const MC_PARAM_MAP: { tex: string; json: string; note: string }[] = [
  { tex: 'N', json: 'gm_accum_samples', note: '每個 GMAC block 的樣本數' },
  { tex: '\\mu', json: 'gain_step', note: 'average-mode 的學習率（單位 fs）' },
  { tex: '\\sigma_v', json: 'pd_noise_rms_fs', note: 'comparator 前的高斯雜訊 RMS' },
  { tex: 'x[n]=\\sqrt{2P_x}\\cos\\Omega n', json: "seeded_pattern = { kind: 'sinusoid' }", note: "code_normalization = 'none'，$P_x$ 完全由振幅決定" },
  { tex: '|H|e^{j\\phi}', json: "pll_error_path = { kind: 'single_tone' }", note: '在頻率 $\\Omega$ 精確給出這個響應的 2-tap FIR' },
  { tex: 'D', json: "gm_code_delay_samples（regressor_mode = 'delayed'）", note: 'GMAC 用 $x[n-D]$ 相關' },
  { tex: 'd', json: 'cal_update_delay_blocks', note: '係數 commit 延遲' },
  { tex: 's', json: 'gm_mode', note: 'average（$s=1$）或 sum（$s=N$）' },
  { tex: 'w_0-a', json: 'gain_initial − gain_true', note: `$a$ 固定為 $${MC_GAIN_TRUE_FS}\\,\\mathrm{fs}$（只影響座標原點）` },
]
