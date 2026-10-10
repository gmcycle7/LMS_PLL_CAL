import type { CheckEntry, MetricRow } from '@/components'
import type { QuantLabParams, StrategyRun } from '@/simulation/models/quantizer'
import { n, ntex } from '../common'

/**
 * Quantized Gain Lab 的交叉比對與指標表（純函式，與 React 分開以便單元測試）。
 * 原則（dev-conventions §3、spec §19）：只有真的算過才標 'ok'；沒有參考值就標 'n/a' 並說明原因；沒做的標 'not-implemented'。
 * 指標名稱與說明裡的數學一律寫成 `$...$`（MetricTable / ExperimentShell 會以 KaTeX 顯示；docs/teaching-style.md §3）。
 */

export type SharedParams = Omit<QuantLabParams, 'lmsNoise' | 'nUpd'>

// ───────────────────────────────────────────────────────────────────────────
// 警告訊息的數學 → `$...$`
// ───────────────────────────────────────────────────────────────────────────

/** 數字字面值 → TeX：Unicode 減號改成 ASCII、指數記號 1.2e-3 改成 1.2\times10^{-3}。 */
const numTex = (s: string): string => {
  const t = s.replace('−', '-')
  const m = /^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(t)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : t
}

const REL: Record<string, string> = { '≥': '\\ge', '≤': '\\le', '<': '<', '>': '>' }

/**
 * 規則表：[樣式, 產生 TeX 的函式（參數是各個 capture group，沒有 group 時是整段比對）]。
 * 由特定到一般、依序套用；已經轉成數學的片段會先換成佔位字元，後面的規則碰不到它。
 */
const WARN_RULES: [RegExp, (...g: string[]) => string][] = [
  // 完整的式子（先處理，避免被後面的單一符號規則拆開）
  [/δt = Δ_LSB·e·x/g, () => String.raw`\delta t=\Delta_\mathrm{LSB}\,e\,x`],
  [/u = w_H \+ r \+ d/g, () => 'u=w_H+r+d'],
  [/A ≤ w\* < (\d+) − A/g, (hi) => String.raw`A\le w^*<${hi}-A`],
  [/½ \+ A/g, () => String.raw`\tfrac12+A`],
  [/P\(u < p\)/g, () => 'P(u<p)'],
  [/D = q·2\^(\d+)/g, (e) => String.raw`D=q\cdot2^{${e}}`],
  [/1\/\(2L_t\)/g, () => '1/(2L_t)'],
  [/h\/L_t/g, () => 'h/L_t'],
  [/⌊w\*⌋/g, () => String.raw`\lfloor w^*\rfloor`],
  [/\(−1, 0\]/g, () => '(-1,0]'],
  [/−½/g, () => String.raw`-\tfrac12`],
  [/([≥≤]) ?10⁶/g, (r) => `${REL[r]}10^6`],
  [/10⁶/g, () => '10^6'],
  // 區間 [0, 63]、(0, 1)、[0, 1)、(0, f_s/2)
  [/([[(])(\d+), (\d+|f_s\/2)([\])])/g, (open, a, b, close) => `${open}${a},${b}${close}`],
  // 範圍 1…12、0…L−1、64…2^20
  [/(\d+)…(L−1|2\^\d+|\d+)/g, (a, b) => String.raw`${a}\ldots ${b === 'L−1' ? 'L-1' : b.replace(/^2\^(\d+)$/, '2^{$1}')}`],
  // 符號
  [/w_H\[n\]/g, () => 'w_H[n]'],
  [/w_H/g, () => 'w_H'],
  [/w\*/g, () => 'w^*'],
  [/σ_out/g, () => String.raw`\sigma_\mathrm{out}`],
  [/σ_w/g, () => String.raw`\sigma_w`],
  [/Δ_LSB/g, () => String.raw`\Delta_\mathrm{LSB}`],
  [/×N_upd/g, () => String.raw`\times N_\mathrm{upd}`],
  [/N_upd/g, () => String.raw`N_\mathrm{upd}`],
  [/L_t/g, () => 'L_t'],
  [/Q_B/g, () => 'Q_B'],
  [/(f_[usL](?:\/\d+)?)/g, (f) => f],
  [/δt/g, () => String.raw`\delta t`],
  [/L\/4/g, () => 'L/4'],
  [/2\^(\d+)/g, (e) => `2^{${e}}`],
  [/ζ/g, () => String.raw`\zeta`],
  [/\blcm(?=\()/g, () => String.raw`\mathrm{lcm}`],
  // 關係與箭頭
  [/([≥≤<>]) ?(\d+(?:\.\d+)?)(?![\d.]*e[+-]?\d)/g, (r, x) => `${REL[r]}${x}`],
  [/([≥≤])/g, (r) => REL[r]],
  [/→/g, () => String.raw`\to`],
  [/⇒/g, () => String.raw`\Rightarrow`],
  // 數字：指數記號與 Unicode 減號
  [/([-−]?\d+(?:\.\d+)?e[+-]?\d+)/g, (x) => numTex(x)],
  [/(−\d+(?:\.\d+)?)/g, (x) => numTex(x)],
  // 單一字母的變數：前面是中文（或句首）、後面是空白／中文／標點，例如「初始 r 必須」「加長 L）」「寬度 A = 1」
  [/(?<=pole )(p)\b/g, (x) => x],
  [/(?<=(?:^|[一-鿿、，；：（「]) ?)([A-Za-z])(?=[ 一-鿿，。；：（）、]|$)/g, (x) => x],
]

/** 佔位字元：Unicode 私人使用區（不含數字或字母，後面的規則不會誤判）。 */
const HOLD_BASE = 0xe000

/**
 * 把量化模型（quantizer.ts 的 validateQuantParams / runQuantLab）回傳的警告訊息裡用 Unicode 拼的數學換成 `$...$`，
 * 讓 ExperimentShell 的 warnings 以 KaTeX 顯示（docs/teaching-style.md §3）。
 *
 * 模型的訊息是純文字（測試以字串比對、其他頁面也直接顯示，不能在模型裡放 `$`），所以在本章的顯示層轉換；
 * 沒對到任何規則的文字原樣保留。模型新增或改寫訊息時，handcalcs.test.tsx 的「warnTex」測試會抓出漏掉的 Unicode 數學。
 *
 * 例：'σ_w = 1.5 LSB ≥ 1 LSB：…' → '$\sigma_w$ = 1.5 LSB $\ge1$ LSB：…'
 */
export function warnTex(msg: string): string {
  if (msg.includes('$')) return msg // 已經是 `$...$` 格式（或含字面的 $）：不再處理
  const held: string[] = []
  let s = msg
  for (const [re, f] of WARN_RULES) {
    s = s.replace(re, (whole: string, ...rest: unknown[]) => {
      // String#replace 的回呼參數：capture groups…、offset、原字串（有具名群組時再多一個物件）；這裡只取字串型的 group
      const groups = rest.slice(0, rest.findIndex((x) => typeof x === 'number')).map((g) => String(g))
      held.push(groups.length ? f(...groups) : f(whole))
      return String.fromCharCode(HOLD_BASE + held.length - 1)
    })
  }
  return s.replace(/[-]/g, (c) => `$${held[c.charCodeAt(0) - HOLD_BASE]}$`)
}

const tolAbs = (x: number) => ({ tolerance: x, toleranceMode: 'abs' as const })

/** Bernoulli 樣本變異數的標準誤：√((μ₄ − σ⁴)/L)，μ₄ = v(1 − 3v)、σ⁴ = v²（v = p(1 − p)）。 */
export function bernoulliVarSe(v: number, L: number): number {
  return Math.sqrt(Math.max(0, v - 4 * v * v) / L)
}

export function crossChecks(
  run: StrategyRun | undefined,
  p: SharedParams,
  L: number,
): { analytic: CheckEntry; monteCarlo: CheckEntry; fixedPoint: CheckEntry } {
  if (!run) return { analytic: { status: 'not-implemented' }, monteCarlo: { status: 'not-implemented' }, fixedPoint: { status: 'not-implemented' } }
  const th = run.theory
  const m = run.metrics
  const prbs = p.randomSource === 'prbs'
  let analytic: CheckEntry
  const randomStrategy = (run.strategy === 'stochastic' && !prbs) || run.strategy === 'deltaSigmaDither'
  let monteCarlo: CheckEntry = randomStrategy
    ? { status: 'n/a', note: '此情境（時變 $w_H$ / overload）沒有可比的解析期望值；單一 seed 可重現' }
    : { status: 'n/a', note: '確定性策略（沒有亂數）：同一參數永遠得到同一序列' }

  if (!th) analytic = { status: 'n/a', note: '$w_H$ 時變或 PVT 漂移：沒有封閉解，只提供模擬' }
  else if (m.overflow > 0) analytic = { status: 'n/a', note: 'overload：解析式假設 code 沒有飽和 / wrap' }
  else if (run.strategy === 'stochastic' && !prbs) {
    // 解析：Var = p(1 − p)；以樣本變異數的 ±4 SE 比對（不是「解析式本身精確」就算 ok）
    const seV = bernoulliVarSe(th.variance, L)
    const okV = Math.abs(m.errVar - th.variance) <= 4 * seV + 1e-12
    analytic = {
      status: okV ? 'ok' : 'mismatch',
      note: String.raw`樣本變異 ${n(m.errVar, 6)} vs $p(1-p)=${ntex(th.variance, 6)}$（$\pm4\,\mathrm{SE}=\pm${ntex(4 * seV, 3)}$）`,
    }
    const se = Math.sqrt(th.variance / L)
    const okM = Math.abs(m.dcError - th.dcError) <= 4 * se + 1e-12
    monteCarlo = {
      status: okM ? 'ok' : 'mismatch',
      note: String.raw`Monte Carlo 平均誤差 ${n(m.dcError, 4)} LSB，期望 ${n(th.dcError, 4)}，$\pm4\,\mathrm{SE}=\pm${ntex(4 * se, 3)}$（$L=${L}$ 個獨立樣本）`,
    }
  } else if (th.claim === 'exact') {
    // freeze / toggle / ΔΣ / PRBS-stochastic：解析值對「整數個週期」精確，有限 L 的誤差 O(P/L)
    const P = Math.max(1, m.periodAnalytic ?? m.period ?? 1)
    const tol = (2 * P) / L + 1e-9
    const ok = Math.abs(m.errPower - th.errPower) <= 2 * tol && Math.abs(m.dcError - th.dcError) <= tol
    analytic = {
      status: ok ? 'ok' : 'mismatch',
      note: `總功率 ${n(m.errPower, 6)} vs 解析 ${n(th.errPower, 6)}；DC ${n(m.dcError, 5)} vs ${n(th.dcError, 5)}（容差 $O(P/L)$：$L$ 不一定是週期的整數倍）`,
    }
    if (run.strategy === 'stochastic') monteCarlo = { status: 'n/a', note: 'PRBS 是確定性的週期序列：以一整個週期的精確值比對（見 Analytic）' }
  } else {
    const rel = Math.abs(m.errPower - th.errPower) / th.errPower
    analytic = {
      status: rel < 0.1 ? 'ok' : 'mismatch',
      note: String.raw`白色近似 ${n(th.errPower, 4)} vs 模擬 ${n(m.errPower, 4)}（相對差 ${(100 * rel).toFixed(1)}%；容差 10%。$A<1\,\mathrm{LSB}$ 時近似本來就不成立）`,
    }
    monteCarlo = { status: 'not-implemented', note: '多 seed 的統計比對未實作；單一 seed 可重現（dither 為 createRng(seed).fork 的獨立亂數流）' }
  }

  let fixedPoint: CheckEntry
  const isDs = run.strategy === 'deltaSigma' || run.strategy === 'deltaSigmaDither'
  if (p.arithmetic === 'float') {
    fixedPoint = run.bitTrue
      ? run.bitTrue.mismatches === 0
        ? { status: 'ok', note: 'float 與精確 rational 模型逐點相同' }
        : { status: 'mismatch', note: `float 與精確模型有 ${run.bitTrue.mismatches} 點不同（第一個 $n=${run.bitTrue.firstIndex}$）：tie 被浮點誤差翻轉（E15）` }
      : { status: 'n/a', note: '$w_H$ 時變：沒有逐點的精確參考序列' }
  } else if (run.strategy === 'deltaSigma' && m.periodAnalytic !== null) {
    // 常數 w_H，或 Freeze/Track 凍結之後的定點常數 w_H：整數 code 序列的偵測週期 vs 解析週期 D/gcd（勘誤 E15）
    const what = !th
      ? String.raw`LMS 凍結後 $w_H$ 為定點常數（以 $1/${run.grid.D}\,\mathrm{LSB}$ 為單位）：解析 $D/\gcd$`
      : p.arithmetic === 'fixed'
        ? String.raw`$F=${p.fracBits}$：解析 $2^F/\gcd$`
        : String.raw`rational（$w^*=${run.grid.p}/${run.grid.q}$）：解析 $q$`
    if (m.periodAnalytic > m.periodLimit)
      fixedPoint = { status: 'n/a', note: `${what} = ${m.periodAnalytic} 超過紀錄可偵測的 ${m.periodLimit}（偵測到的 ${m.period || '—'} 只是局部近似週期）；請加長 $L$` }
    else fixedPoint = { status: m.period === m.periodAnalytic ? 'ok' : 'mismatch', note: `${what} = ${m.periodAnalytic}；整數 code 序列偵測週期 ${m.period || '—'}` }
  } else if (!th) {
    fixedPoint = { status: 'n/a', note: '$w_H$ 時變：沒有逐點的精確參考序列（整數運算本身仍是 bit-true）' }
  } else if (p.arithmetic === 'fixed' && run.bitTrue) {
    fixedPoint =
      run.bitTrue.mismatches === 0
        ? { status: 'ok', note: `定點 $w_H=${run.grid.represented}$ 與精確 rational 模型逐點相同` }
        : {
            status: 'n/a',
            note: `定點 $w_H=${run.grid.represented}$ 與精確 $${p.target}$ 的序列有 ${run.bitTrue.mismatches} 點不同（第一個 $n=${run.bitTrue.firstIndex}$；來自 $w_H$ 的表示誤差，不是 bug）`,
          }
  } else {
    fixedPoint = { status: 'n/a', note: isDs ? '有 dither：沒有確定性的週期可比' : '整數精確運算；本策略不受定點表示影響' }
  }
  return { analytic, monteCarlo, fixedPoint }
}

export function metricRows(run: StrategyRun | undefined, p: SharedParams): MetricRow[] {
  if (!run) return []
  const m = run.metrics
  const th = run.theory
  const L = p.length
  const P = Math.max(1, m.periodAnalytic ?? m.period ?? 1)
  const randomIid = run.strategy === 'stochastic' && p.randomSource === 'ideal'
  const meanTol = th ? (randomIid || th.claim === 'approx' ? 4 * Math.sqrt(th.variance / L) + 1e-9 : (2 * P) / L + 1e-9) : 0
  const powTol = th ? (th.claim === 'approx' ? 0.1 * th.errPower : randomIid ? 4 * bernoulliVarSe(th.variance, L) + 1e-9 : (4 * P) / L + 1e-9) : 0
  const rows: MetricRow[] = [
    { name: String.raw`平均 code $\overline y$`, value: m.meanCode, unit: 'LSB', analytic: th?.mean, ...(th ? tolAbs(meanTol) : {}), claim: th?.claim, digits: 7 },
    {
      name: String.raw`DC 誤差 $\delta w=\overline y-w^*$（§12 約定）`,
      value: m.dcError,
      unit: 'LSB',
      formulaId: run.strategy === 'freeze' ? 'F-13.2' : undefined,
      note: String.raw`$\delta=a-w$ 約定為 ${n(-m.dcError, 4)} LSB（勘誤 E49）`,
      digits: 6,
    },
    { name: String.raw`DC 誤差 $\times\,\Delta_\mathrm{LSB}$`, value: m.dcError * p.lsbFs, unit: 'fs', note: String.raw`勘誤 E13：$\Delta_\mathrm{LSB}$ 換算`, digits: 5 },
    {
      name: String.raw`總誤差功率 $E[(y-w^*)^2]$`,
      value: m.errPower,
      unit: 'LSB²',
      analytic: th?.errPower,
      ...(th ? tolAbs(powTol) : {}),
      claim: th?.claim,
      formulaId: run.strategy === 'deltaSigmaDither' ? 'F-13.10' : run.strategy === 'stochastic' ? 'F-13.6' : 'F-13.4',
      digits: 6,
    },
    { name: '變異數（去 DC）', value: m.errVar, unit: 'LSB²', digits: 6 },
    { name: String.raw`RMS 誤差 $\times\,\Delta_\mathrm{LSB}$`, value: Math.sqrt(m.errPower) * p.lsbFs, unit: 'fs', digits: 5 },
    { name: String.raw`量化誤差 $E[(y-w_H)^2]$`, value: m.quantErrPower, unit: 'LSB²', digits: 6 },
    {
      name: String.raw`頻帶內誤差（$\mathrm{DC}^2+\int_0^{f_u/64}S_e\,df$）`,
      value: m.lfErrPower,
      unit: 'LSB²',
      claim: m.lfExact ? 'exact' : 'approx',
      note: `${m.lfExact ? '一個週期的精確線譜加總' : 'Welch 估計'}${run.lmsNoise ? String.raw`；LMS 地板 $${ntex(m.lfLmsPower, 4)}\,\mathrm{LSB}^2$` : ''}`,
      digits: 4,
    },
    {
      name: String.raw`頻帶內量化誤差（$\epsilon=y-w_H$）`,
      value: m.lfQuantPower,
      unit: 'LSB²',
      claim: m.lfExact ? 'exact' : 'approx',
      note: run.strategy === 'freeze' && run.lmsNoise ? String.raw`Freeze 不追蹤 $w_H$：$\epsilon$ 含 $-\delta w$，請看上一列` : String.raw`不含 LMS 雜訊與 $\epsilon$–$\delta w$ 交叉項`,
      digits: 4,
    },
    {
      name: '偵測週期',
      value: m.period > 0 ? m.period : '無',
      analytic: m.periodAnalytic ?? undefined,
      ...(m.periodAnalytic !== null && m.period > 0 ? tolAbs(0) : {}),
      formulaId: run.strategy === 'deltaSigma' ? 'F-13.8' : undefined,
    },
    {
      name: '最大譜線',
      value: m.maxSpur ? m.maxSpur.power : null,
      unit: 'LSB²',
      claim: run.linesExact ? 'exact' : 'approx',
      note: m.maxSpur ? String.raw`@ ${n(m.maxSpur.f, 5)} Hz $=${ntex(m.maxSpur.f / run.fu, 4)}\,f_u$` : '沒有統計顯著的譜線',
      digits: 5,
    },
    { name: 'code 切換率', value: m.toggleRate, unit: '次/更新', digits: 4 },
    { name: 'code 範圍', value: `${m.codeMin} – ${m.codeMax}（${m.levels} 階）` },
    { name: 'overflow / anti-windup 次數', value: `${m.overflow} / ${m.windup}` },
  ]
  if (run.mixing) {
    rows.push(
      { name: String.raw`$\sigma_{\delta t}$（mixing 後、未經 PLL）`, value: run.mixing.sigmaRawFs, unit: 'fs', formulaId: 'F-13.11', claim: 'approx', digits: 5 },
      {
        name: String.raw`$\sigma_\mathrm{out}=\sqrt{\int|T|^2S_{\delta t}\,df}$（$f\ge f_L$）`,
        value: run.mixing.sigmaOutFs,
        unit: 'fs',
        formulaId: 'F-13.11',
        claim: 'approx',
        digits: 5,
        note: String.raw`積分下限 $f_L=${ntex(run.mixing.fLowHz, 4)}\,\mathrm{Hz}$（Welch 解析度）；${run.mixing.samples} 個 reference cycle、${run.mixing.nSegments} 段`,
      },
      {
        name: String.raw`$\delta t$ 慢變成分 RMS（$f<f_L$，未計入 $\sigma_\mathrm{out}$）`,
        value: run.mixing.slowRmsFs,
        unit: 'fs',
        claim: 'approx',
        digits: 4,
        note: run.mixing.slowRmsFs === null ? '紀錄少於 4 個 Welch 區塊：無法估計' : '不重疊區塊平均的 RMS；落在 PLL 通帶內',
      },
      { name: String.raw`$\delta t$ 靜態偏移 $\overline{\delta t}$`, value: run.mixing.meanFs, unit: 'fs', claim: 'approx', digits: 4, note: 'PLL 會吸收的靜態 timing 偏移（或紀錄內分辨不出的慢變成分）' },
    )
  }
  return rows
}
