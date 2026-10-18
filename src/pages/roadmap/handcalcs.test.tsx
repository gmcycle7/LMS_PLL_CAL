import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { fireEvent, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HandCalc, defaultValues, inputError, randomValues } from '@/components'
import { SettingsProvider } from '@/app/settings'
import type { HandCalcDef, HandCalcInput } from '@/data/types'
import { FORMULAS } from './formulas'
import { HANDCALCS, HYST_ZMAX, PHI_SERIES_ZMAX, phiSeries, r7Rho, R7_EXAMPLE, roadmapHandCalc, TANH_SERIES_YMAX, TRACK_RATIO_MAX } from './handcalcs'
import {
  accumulatorBits,
  eig2,
  hysteresisStats,
  inverseDesign,
  kalmanSteady,
  liftedDualLoop,
  nearIntegerAsymptote,
  nearIntegerKeepOut,
  optimalTrackingGain,
  regularizedPreconditioner,
  sigmaW2Colored,
  simulateMultirate,
  trackingVariance,
  windowLambdaMin,
  worstCaseAccumulate,
  worstCaseSafeCount,
  zohAutocorr,
} from './model'
import RoadmapPage from './index'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
const M = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({ default: M }))

// 假的 Plotly.react 會記住每一次呼叫的引數（DOM 節點與整組資料）：不清掉的話，前面每個測試渲染過的整頁
// （含所有 KaTeX 節點）都被它抓著不放，整個檔案跑下來會把 worker 的記憶體用光。
afterEach(() => {
  vi.clearAllMocks()
})

// KaTeX 很多，其他 agent 同時跑測試時 jsdom 較慢
vi.setConfig({ testTimeout: 120_000 })

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}

function golden(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

const hc = (id: string): HandCalcDef => roadmapHandCalc(id)
const values = (def: HandCalcDef, v: Record<string, number>): number[] => def.solve(v).results.map((r) => r.value)

/** |actual − expected| ≤ abs + rel·|expected| */
function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, label = '') {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

/** 把 defaults 換成指定數字的同一題（HandCalc 以 defaults 當初始輸入，用來渲染任意數字） */
const withValues = (def: HandCalcDef, v: Record<string, number>): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

/** 元素的文字，去掉 KaTeX：字串裡的 `$…$` 若沒有成對（或沒被 mathText 處理），這裡會看到殘留的 `$` */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

const unpaired = (s: string): boolean => (s.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0
/** 公式裡不可以印出 NaN／∞／undefined（符號 K_∞ 的下標不算） */
const badNumber = (tex: string): boolean => /NaN|undefined|\\infty|Infinity/.test(tex.replace(/K_\\infty/g, 'K'))

// ───────────────────────── 獨立工具：Φ、步驟 TeX 的求值器 ─────────────────────────

const SQRT_2PI = Math.sqrt(2 * Math.PI)
const KQ1 = Math.sqrt(2 / Math.PI)
const pdf = (z: number): number => Math.exp((-z * z) / 2) / SQRT_2PI

/** 標準常態 CDF：Simpson 積分（刻意不用 core 的 normCdf） */
function phiIntegral(z: number): number {
  const n = 4000
  const h = z / n
  let s = pdf(0) + pdf(z)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * pdf(i * h)
  return 0.5 + (s * h) / 3
}

/**
 * 步驟 TeX 的「算式鏈」求值器（獨立於 handcalcs.ts）：只認得手算題用到的語法
 * （數字、+ − \times \bmod、\frac、\sqrt、^2／^{n}、e^{…}、\ln、⌊⌋、\tanh(…)、\Phi(…)、\min／\max(a, b)、括號、結尾的單位）。
 * 含符號的段落（K、\sigma_v、\mathrm{tr}…）回傳 null。
 */
class TexCalc {
  private i = 0
  private constructor(private readonly s: string) {}

  static evaluate(segment: string): number | null {
    const s = segment
      .replace(/\\ \\mathrm\{(?:[^{}]|\{[^{}]*\})*\}/g, '') // 結尾的單位：\ \mathrm{fs^{-1}}
      .replace(/\\(?:left|right|big|Big)(?![A-Za-z])/g, '')
      .replace(/\\[,;! ]/g, '')
      .replace(/\s+/g, '')
    if (s === '') return null
    try {
      const p = new TexCalc(s)
      const v = p.expr()
      return p.i === s.length ? v : null
    } catch {
      return null
    }
  }

  private peek(tok: string): boolean {
    return this.s.startsWith(tok, this.i)
  }

  private eat(tok: string): void {
    if (!this.peek(tok)) throw new Error(`expected ${tok} at ${this.i}`)
    this.i += tok.length
  }

  private expr(): number {
    let v = this.term()
    for (;;) {
      if (this.peek('+')) {
        this.i++
        v += this.term()
      } else if (this.peek('-')) {
        this.i++
        v -= this.term()
      } else return v
    }
  }

  private term(): number {
    let v = this.unary()
    for (;;) {
      if (this.peek('\\times')) {
        this.i += 6
        v *= this.unary()
      } else if (this.peek('\\bmod')) {
        this.i += 5
        const d = this.unary()
        v -= Math.floor(v / d) * d
      } else return v
    }
  }

  private unary(): number {
    if (this.peek('-')) {
      this.i++
      return -this.unary()
    }
    const base = this.primary()
    if (!this.peek('^')) return base
    this.i++
    if (this.peek('{')) return Math.pow(base, this.group())
    const ch = this.s[this.i]
    if (!/\d/.test(ch ?? '')) throw new Error('bad exponent')
    this.i++
    return Math.pow(base, Number(ch))
  }

  private group(): number {
    this.eat('{')
    const v = this.expr()
    this.eat('}')
    return v
  }

  private call(): number[] {
    this.eat('(')
    const args = [this.expr()]
    while (this.peek(',')) {
      this.i++
      args.push(this.expr())
    }
    this.eat(')')
    return args
  }

  private primary(): number {
    if (this.peek('(')) return this.call()[0]
    if (this.peek('\\frac')) {
      this.i += 5
      const a = this.group()
      return a / this.group()
    }
    if (this.peek('\\sqrt')) {
      this.i += 5
      return Math.sqrt(this.group())
    }
    if (this.peek('\\lfloor')) {
      this.i += 7
      const v = this.expr()
      this.eat('\\rfloor')
      return Math.floor(v)
    }
    if (this.peek('\\ln')) {
      this.i += 3
      return Math.log(this.primary())
    }
    if (this.peek('\\tanh(')) {
      this.i += 5
      return Math.tanh(this.call()[0])
    }
    if (this.peek('\\Phi(')) {
      this.i += 4
      return phiIntegral(this.call()[0])
    }
    if (this.peek('\\min(')) {
      this.i += 4
      return Math.min(...this.call())
    }
    if (this.peek('\\max(')) {
      this.i += 4
      return Math.max(...this.call())
    }
    if (this.peek('e^{')) {
      this.i += 2
      return Math.exp(this.group())
    }
    const m = /^\d+(?:\.\d+)?/.exec(this.s.slice(this.i))
    if (!m) throw new Error(`unexpected ${this.s.slice(this.i, this.i + 8)}`)
    this.i += m[0].length
    return Number(m[0])
  }
}

/**
 * 排成多行的步驟（\begin{aligned} … \\ … \end{aligned}，桌機上一行排不下時用）只是換行：
 * 拿掉最外層的環境、對齊記號 & 與換行之後，內容與單行的寫法相同，照樣逐段驗算。
 */
function unwrapAligned(tex: string): string {
  const m = /^\\begin\{aligned\}([\s\S]*)\\end\{aligned\}$/.exec(tex)
  return m ? m[1].replace(/\\\\(?:\[[^\]]*\])?/g, '').replace(/&/g, '') : tex
}

/** 以頂層的 `=`（或 ≈）把一步切成段 */
function splitTopLevel(texRaw: string): string[] {
  const tex = unwrapAligned(texRaw)
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex.replace(/\\approx/g, '=')) {
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

interface ChainCheck {
  segments: number
  numeric: number[]
}

/**
 * 一步裡所有「全是數字」的等號段都必須算出同一個數（容許顯示 5 位有效數字造成的捨入：結果的 5×10⁻⁴ 倍），
 * 而且最後一段一定是數字（這一步的結果）。
 */
function expectChainConsistent(tex: string, tag: string): ChainCheck {
  const segs = splitTopLevel(tex)
  const vals = segs.map((s) => TexCalc.evaluate(s))
  const final = vals[vals.length - 1]
  expect(final, `${tag}：最後一段不是數字（${tex}）`).not.toBeNull()
  const numeric: number[] = []
  segs.forEach((text, k) => {
    const v = vals[k]
    if (v === null) return
    expect(Number.isFinite(v), `${tag}：「${text}」`).toBe(true)
    const scale = Math.max(0, ...(text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
    const tol = 5e-4 * Math.abs(final!) + 1e-9 * scale
    expect(Math.abs(v - final!), `${tag}：「${text}」= ${v} 與結果 ${final} 對不上（${tex}）`).toBeLessThanOrEqual(tol)
    numeric.push(v)
  })
  return { segments: segs.length, numeric }
}

// ───────────────────────── 獨立重算（刻意不呼叫 model.ts） ─────────────────────────

/** 2×2 實矩陣的 spectral radius（特徵方程式直接解） */
function rho2(a11: number, a12: number, a21: number, a22: number): { det: number; rho: number } {
  const tr = a11 + a22
  const det = a11 * a22 - a12 * a21
  const disc = tr * tr - 4 * det
  if (disc < 0) return { det, rho: Math.sqrt(det) }
  const sq = Math.sqrt(disc)
  return { det, rho: Math.max(Math.abs((tr + sq) / 2), Math.abs((tr - sq) / 2)) }
}

/**
 * 順序與各題 results 相同。每一題都用「另一種寫法」：Lyapunov 的交叉項、逐點平均、逐 sample 模擬、Riccati 迭代、
 * BigInt 的 two's complement、二分法…
 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  // 狀態 [δw, η] 的 Lyapunov 方程逐項解：P₁₂ = μρσ²/(1 − pρ)，P₁₁ = (μ²σ² + 2pμP₁₂)/(1 − p²)
  'HC-RM.1': ({ sigmaV, N, mu, rho }) => {
    const p = 1 - (mu * KQ1) / sigmaV
    const s2 = 1 / N
    const p12 = (mu * rho * s2) / (1 - p * rho)
    const p11 = (mu * mu * s2 + 2 * p * mu * p12) / (1 - p * p)
    const white = (mu * mu * s2) / (1 - p * p)
    return [p, p11 / white, Math.sqrt(p11)]
  },
  // 不用封閉式：對一個 block 內的 N 個起點逐點平均 p^{跨過的邊界數}
  'HC-RM.2': ({ p, N, m }) => {
    let acc = 0
    for (let start = 0; start < N; start++) acc += Math.pow(p, Math.floor((start + m) / N))
    return [(m - (m % N)) / N, m % N, acc / N]
  },
  // Var_i 的另一個等價式：t = σ²/(σ² + ε)，Var = γt/(σ²N(2 − γt))
  'HC-RM.4': ({ s1, s2, gamma, eps, N }) => {
    const mode = (s: number) => {
      const t = (s * s) / (s * s + eps)
      return { p: 1 - gamma * t, v: (gamma * t) / (s * s * N * (2 - gamma * t)) }
    }
    const a = mode(s1)
    const b = mode(s2)
    return [a.p, b.p, b.v, a.v + b.v]
  },
  // 緩坡 x_i = iα 的樣本變異數直接逐點算；keep-out 用二分法反解
  'HC-RM.5': ({ alpha, N0, lt }) => {
    const lam = (a: number) => {
      let sx = 0
      let sxx = 0
      for (let i = 0; i < N0; i++) {
        sx += i * a
        sxx += i * a * i * a
      }
      return (sxx / N0 - (sx / N0) ** 2) / 1.25
    }
    let lo = 0
    let hi = 1
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi)
      if (lam(mid) < lt) lo = mid
      else hi = mid
    }
    return [lam(alpha), 0.5 * (lo + hi)]
  },
  // Markov 平穩分布 E[q](s) 對 s 做中央差分；Φ 用 Simpson 積分
  'HC-RM.6': ({ sigmaV, H }) => {
    const meanQ = (s: number) => {
      const up = 1 - phiIntegral((H / 2 - s) / sigmaV)
      const down = phiIntegral((-H / 2 - s) / sigmaV)
      return (up - down) / (up + down)
    }
    const h = 1e-4 * sigmaV
    const slope = (meanQ(h) - meanQ(-h)) / (2 * h)
    const c = 1 - phiIntegral(H / (2 * sigmaV))
    const nu = 1 - 2 * c
    const kq = KQ1 / sigmaV
    return [slope, nu, (slope * slope * (1 - nu)) / ((1 + nu) * kq * kq)]
  },
  // 不用 lifted 矩陣的封閉式：從兩個單位初值各跑一個 block 的逐 sample 遞迴，量出 A_N 的兩行
  'HC-RM.7': ({ r, b, c, mu, N }) => {
    const block = (s0: number, d0: number): [number, number] => {
      let s = s0
      let acc = 0
      for (let i = 0; i < N; i++) {
        acc += c * s
        s = r * s + b * d0
      }
      return [s, d0 - (mu * acc) / N]
    }
    const [a11, a21] = block(1, 0)
    const [a12, a22] = block(0, 1)
    let SN = 0
    for (let i = 0; i < N; i++) SN += Math.pow(r, i)
    const { det, rho } = rho2(a11, a12, a21, a22)
    return [SN, det, rho]
  },
  // 不解二次方程：把 Riccati 遞迴 P⁻ ← P⁻σ_y²/(P⁻ + σ_y²) + σ_ζ² 跑到收斂
  'HC-RM.8': ({ sigmaV, N, sz }) => {
    const K = KQ1 / sigmaV
    const sy2 = 1 / (N * K * K)
    const sz2 = sz * sz
    let Pp = sz2
    for (let it = 0; it < 5_000_000; it++) {
      const next = (Pp * sy2) / (Pp + sy2) + sz2
      const done = Math.abs(next - Pp) <= 1e-15 * next
      Pp = next
      if (done) break
    }
    const g = Pp / (Pp + sy2)
    return [g, g / K, Math.sqrt(Pp)]
  },
  // BigInt：整數除法與內建的 two's complement（asIntN）
  'HC-RM.9': ({ Wx, k, neg, Wacc }) => {
    const Mx = (1n << BigInt(Wx - 1)) - (neg >= 1 ? 0n : 1n)
    const U = (1n << BigInt(Wacc - 1)) - 1n
    const T = (1n << BigInt(k)) * Mx
    return [Number(U / Mx), Number(BigInt.asIntN(Wacc, T)), Number(T > U ? U : T)]
  },
  // g 用二分法解 (1 − g)^B = ε；σ_w 用 μ²σ_η²/(1 − p²)；tanh 律用推導第 5 步的 (1 − ε^u)/(1 + ε^u)
  'HC-RM.10': ({ sigmaV, fsG, tUs, eps, k }) => {
    const K = KQ1 / sigmaV
    const N = 2 ** k
    const total = fsG * 1e9 * tUs * 1e-6
    const B = Math.floor(total / N)
    let lo = 0
    let hi = 1
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi)
      if (Math.pow(1 - mid, B) > eps) lo = mid
      else hi = mid
    }
    const g = 0.5 * (lo + hi)
    const mu = g / K
    const p = 1 - g
    const eu = Math.pow(eps, N / total)
    return [B, g, mu, Math.sqrt((mu * mu) / N / (1 - p * p)), Math.sqrt((1 - eu) / (K * K * N * (1 + eu)))]
  },
}

/** 獨立重算的容許誤差（相對）：數值微分、Simpson 積分、迭代的題目放寬 */
const INDEPENDENT_REL: Record<string, number> = { 'HC-RM.6': 2e-6, 'HC-RM.8': 1e-8, 'HC-RM.10': 1e-8 }

/** validate 必須擋下的輸入，以及訊息中應該出現的解釋 */
/** 欄位叫 hc（不叫 id）：全站以「id: 'HC-…'」掃描重複題號時，測試檔不會被算進去 */
const INVALID: { hc: string; name: string; patch: Record<string, number>; expect: RegExp }[] = [
  { hc: 'HC-RM.1', name: 'ρ = 1（AR(1) 不平穩）', patch: { rho: 1 }, expect: /不平穩/ },
  { hc: 'HC-RM.1', name: 'ρ = −1', patch: { rho: -1 }, expect: /不平穩/ },
  { hc: 'HC-RM.1', name: 'μ = 0（不更新）', patch: { mu: 0 }, expect: /不更新/ },
  { hc: 'HC-RM.1', name: 'μ = 300 fs（g ≥ 2）', patch: { mu: 300 }, expect: /單位圓/ },
  { hc: 'HC-RM.2', name: 'p = 1', patch: { p: 1 }, expect: /不平穩/ },
  { hc: 'HC-RM.2', name: 'p = −1', patch: { p: -1 }, expect: /不平穩/ },
  { hc: 'HC-RM.4', name: 'σ₂ = 0（不可辨識）', patch: { s2: 0 }, expect: /不可辨識/ },
  { hc: 'HC-RM.4', name: 'σ₂ > σ₁', patch: { s1: 1, s2: 3 }, expect: /對調/ },
  { hc: 'HC-RM.4', name: 'γ = 2', patch: { gamma: 2 }, expect: /發散/ },
  { hc: 'HC-RM.4', name: 'γ = 0', patch: { gamma: 0 }, expect: /不更新/ },
  { hc: 'HC-RM.5', name: 'αN₀ > 0.5（窗口內有 wrap）', patch: { alpha: 0.01 }, expect: /wrap/ },
  { hc: 'HC-RM.5', name: 'λ_t 太大（α_keep·N₀ > 0.5）', patch: { lt: 0.05 }, expect: /太大/ },
  { hc: 'HC-RM.6', name: 'H/(2σ_v) > 3（幾乎卡死）', patch: { H: 700 }, expect: /卡死/ },
  { hc: 'HC-RM.7', name: 'r_s = 1', patch: { r: 1 }, expect: /不收斂/ },
  { hc: 'HC-RM.7', name: 'r_s = −1.2', patch: { r: -1.2 }, expect: /不收斂/ },
  { hc: 'HC-RM.7', name: 'b_s = 0（不可觀測）', patch: { b: 0 }, expect: /不可觀測/ },
  { hc: 'HC-RM.7', name: 'μ = 0', patch: { mu: 0 }, expect: /不更新/ },
  { hc: 'HC-RM.8', name: 'σ_ζ ≫ σ_y（相減抵銷）', patch: { sz: 100 }, expect: /相減/ },
  { hc: 'HC-RM.9', name: '累加器比 code 還窄', patch: { Wacc: 4 }, expect: /位寬接錯/ },
  { hc: 'HC-RM.9', name: '含最負 code 時 W_acc = W_x 不夠', patch: { neg: 1, Wacc: 6 }, expect: /位寬接錯/ },
  { hc: 'HC-RM.10', name: 'ε ≥ 1（不是相對比例，勘誤 E16）', patch: { eps: 1 }, expect: /E16/ },
  { hc: 'HC-RM.10', name: 'N > f_s·T_max', patch: { k: 20 }, expect: /跑不完/ },
]

/** 每個輸入的 practice 格點（choices，或 min…max 以 step 列舉） */
function practiceGrid(i: HandCalcInput): number[] {
  const p = i.practice
  if (!p) return [i.default]
  if (p.choices?.length) return p.choices
  const lo = p.min ?? i.min ?? i.default
  const hi = p.max ?? i.max ?? i.default
  const step = p.step ?? 1
  const out: number[] = []
  for (let k = 0; lo + k * step <= hi + 1e-9; k++) out.push(Number((lo + k * step).toPrecision(10)))
  return out
}

/** 所有 practice 組合（笛卡兒積） */
function allPracticeCombos(def: HandCalcDef): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}]
  for (const i of def.inputs) combos = combos.flatMap((c) => practiceGrid(i).map((v) => ({ ...c, [i.key]: v })))
  return combos
}

function withProviders(ui: ReactNode, mode: 'beginner' | 'engineer' | 'research' = 'research') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* storage 不可用時沿用預設 */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={['/roadmap']}>{ui}</MemoryRouter>
    </SettingsProvider>,
  )
}

// ═════════════════════════ 結構 ═════════════════════════

describe('roadmap 手算題：結構', () => {
  const EXPECTED_IDS = ['HC-RM.1', 'HC-RM.2', 'HC-RM.4', 'HC-RM.5', 'HC-RM.6', 'HC-RM.7', 'HC-RM.8', 'HC-RM.9', 'HC-RM.10']

  it('九題（HC-RM.n ↔ Rn；R3 與 SSPLL 的手算題在第 13 章與案例頁，不重複），page、formulaId、難度、practice 範圍都正確', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(EXPECTED_IDS)
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/roadmap')
      // 題號對應研究項目，標題也以「Rn：」開頭
      expect(h.title.startsWith(`R${h.id.split('.')[1]}：`), h.id).toBe(true)
      expect(h.formulaId && formulaIds.has(h.formulaId), `${h.id} → ${h.formulaId}`).toBe(true)
      expect(h.formulaId).toMatch(new RegExp(`^F-R${h.id.split('.')[1]}\\.`))
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key}`).toBeTruthy()
        expect(inputError(i, i.default), `${h.id}.${i.key} default`).toBeNull()
        // 輸入的白話說明不放 `$`（它也會被當成 aria-label）
        expect(i.label, `${h.id}.${i.key}`).not.toContain('$')
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const t of [h.title, ...(h.tips ?? [])]) expect(unpaired(t), `${h.id}: ${t}`).toBe(false)
    }
    expect(() => roadmapHandCalc('HC-RM.3')).toThrow(/找不到/)
  })

  it('難度誠實標示：只有四則運算與整數冪的是 beginner；用到 √、ln、eˣ、tanh 的是 engineer；要查 Φ 表的是 research', () => {
    expect(Object.fromEntries(HANDCALCS.map((h) => [h.id, h.level]))).toEqual({
      'HC-RM.1': 'engineer',
      'HC-RM.2': 'beginner',
      'HC-RM.4': 'beginner',
      'HC-RM.5': 'engineer',
      'HC-RM.6': 'research',
      'HC-RM.7': 'engineer',
      'HC-RM.8': 'engineer',
      'HC-RM.9': 'beginner',
      'HC-RM.10': 'engineer',
    })
    for (const h of HANDCALCS) {
      for (const v of [defaultValues(h), ...allPracticeCombos(h).slice(0, 40)]) {
        const tex = h
          .solve(v)
          .steps.map((s) => s.tex)
          .join(' ')
        const needsTable = /\\Phi\(/.test(tex)
        const needsCalculator = /\\sqrt|\\ln|e\^\{|\\tanh/.test(tex)
        if (h.level === 'beginner') expect(needsTable || needsCalculator, `${h.id} ${JSON.stringify(v)}`).toBe(false)
        if (h.level === 'engineer') expect(needsTable, h.id).toBe(false)
        if (h.level === 'research') expect(needsTable, h.id).toBe(true)
      }
      if (h.level === 'engineer') expect(/\\sqrt|\\ln|e\^\{|\\tanh/.test(h.solve(defaultValues(h)).steps.map((s) => s.tex).join(' ')), h.id).toBe(true)
    }
  })

  it('全站 id 唯一（以原始碼掃描所有 handcalcs.ts）；HC-RM.* 只出現在本頁', () => {
    const files: string[] = []
    for (const group of ['chapters', 'pages']) {
      const base = join(process.cwd(), 'src', group)
      for (const dir of readdirSync(base)) {
        const f = join(base, dir, 'handcalcs.ts')
        if (existsSync(f)) files.push(f)
      }
    }
    expect(files.length).toBeGreaterThan(10)
    const seen = new Map<string, string>()
    const dup: string[] = []
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/^\s*id: '(HC-[^']+)'/gm)) {
        if (seen.has(m[1])) dup.push(`${m[1]}（${seen.get(m[1])} 與 ${f}）`)
        seen.set(m[1], f)
      }
    }
    expect(dup).toEqual([])
    const mine = [...seen.entries()].filter(([id]) => id.startsWith('HC-RM.'))
    expect(mine.map(([id]) => id).sort()).toEqual([...EXPECTED_IDS].sort())
    for (const [, f] of mine) expect(f.replace(/\\/g, '/')).toMatch(/src\/pages\/roadmap\/handcalcs\.ts$/)
  })

  it('內文與提示引用的其他章節手算題確實存在（HC-13.3／13.5／13.6、HC-04.6、HC-08.7、HC-10.5）', () => {
    const has = (file: string, id: string) => new RegExp(`id: '${id.replace('.', '\\.')}'`).test(readFileSync(join(process.cwd(), file), 'utf8'))
    expect(has('src/chapters/ch13/handcalcs.ts', 'HC-13.3')).toBe(true)
    expect(has('src/chapters/ch13/handcalcs.ts', 'HC-13.5')).toBe(true)
    expect(has('src/chapters/ch13/handcalcs.ts', 'HC-13.6')).toBe(true)
    expect(has('src/chapters/ch04/handcalcs.ts', 'HC-04.6')).toBe(true)
    expect(has('src/chapters/ch08/handcalcs.ts', 'HC-08.7')).toBe(true)
    expect(has('src/chapters/ch10/handcalcs.ts', 'HC-10.5')).toBe(true)
    const tips = HANDCALCS.flatMap((h) => h.tips ?? []).join(' ')
    for (const id of ['HC-08.7', 'HC-10.5']) expect(tips).toContain(id)
  })
})

// ═════════════════════════ 預設值 = worked example，答案 = model.ts ═════════════════════════

describe('roadmap 手算題：預設值是各預覽的 worked example，答案來自 model.ts 的實際函式', () => {
  it('T13: HC-RM.1 的預設值是 T13 的設計點加上 ρ = 0.5；ρ = 0 時重現 golden 的 p 與 σ_w，ρ = 0.5 時等於 sigmaW2Colored', () => {
    const T13 = golden('T13')
    const inp = T13.inputs as { sigma_v_fs: number; N: number; mu_fs: number }
    const exp = T13.expected as { p: number; sigma_w_fs: number }
    const def = hc('HC-RM.1')
    expect(defaultValues(def)).toEqual({ sigmaV: inp.sigma_v_fs, N: inp.N, mu: inp.mu_fs, rho: 0.5 })
    const white = values(def, { ...defaultValues(def), rho: 0 })
    close(white[0], exp.p, 0, T13.tolerance.abs)
    expect(white[1]).toBe(1)
    close(white[2], exp.sigma_w_fs, 0, T13.tolerance.abs)
    const [p, F, sw] = values(def, defaultValues(def))
    expect(sw).toBe(Math.sqrt(sigmaW2Colored({ p, mu: inp.mu_fs, sigmaEta2: 1 / inp.N, rho: 0.5 })))
    close(F, (1 + 0.5 * p) / (1 - 0.5 * p))
    // 「0. 這一頁要回答的問題」的先算一次：σ_w(ρ = 0.5) = σ_w(0)·√F
    close(sw, exp.sigma_w_fs * Math.sqrt(F))
    // 反號相關縮小、同號相關放大
    expect(values(def, { ...defaultValues(def), rho: -0.5 })[2]).toBeLessThan(white[2])
    expect(sw).toBeGreaterThan(white[2])
    // 提示裡的數字
    const tips = def.tips!.join('')
    expect(tips).toContain(String(Number(exp.p.toPrecision(5))))
    expect(tips).toContain(String(Number(exp.sigma_w_fs.toPrecision(4))))
  })

  it('HC-RM.2 的預設值是 R2 預覽的預設（p = 0.6、N = 16）：m = 20 ⇒ q = 1、m′ = 4、R̄_w = 0.54 = zohAutocorr', () => {
    const def = hc('HC-RM.2')
    const d = defaultValues(def)
    expect(d).toEqual({ p: 0.6, N: 16, m: 20 })
    const [q, mp, R] = values(def, d)
    expect([q, mp]).toEqual([1, 4])
    expect(R).toBe(zohAutocorr(0.6, 16, 20))
    close(R, 0.54)
    // m = 0 ⇒ 1；m = N ⇒ p；m < N 時是直線 1 − (m/N)(1 − p)
    expect(values(def, { ...d, m: 0 })[2]).toBe(1)
    close(values(def, { ...d, m: 16 })[2], 0.6)
    close(values(def, { ...d, m: 4 })[2], 1 - (4 / 16) * 0.4)
    expect(def.tips!.join('')).toContain('0.54')
  })

  it('T18: HC-RM.4 的預設值是 T18 反例的 singular values（3、1）與 γ = 0.5、ε = 0.1：poles 等於 golden，變異數等於 regularizedPreconditioner', () => {
    const T18 = golden('T18')
    const inp = T18.inputs as { J: number[][]; reg_gamma: number; reg_lambda: number }
    const exp = T18.expected as { reg_poles_desc: number[] }
    const def = hc('HC-RM.4')
    const d = defaultValues(def)
    expect({ gamma: d.gamma, eps: d.eps }).toEqual({ gamma: inp.reg_gamma, eps: inp.reg_lambda })
    // 預設的 σ₁、σ₂ 就是 golden J 的 singular values；N = 64 是 R4 預覽的預設
    const ref = regularizedPreconditioner({ J: inp.J, gamma: d.gamma, eps: d.eps, sigmaEta2: 1 / d.N })
    close(ref.sv[0], d.s1)
    close(ref.sv[1], d.s2)
    expect(d.N).toBe(64)
    const [p1, p2, v2, total] = values(def, d)
    close(p1, exp.reg_poles_desc[1], 0, T18.tolerance.abs)
    close(p2, exp.reg_poles_desc[0], 0, T18.tolerance.abs)
    close(v2, ref.modeVar[1])
    close(total, ref.totalVar)
    // ε = 0：兩個 pole 都是 1 − γ，變異數比是 (σ₁/σ₂)²
    const sol0 = def.solve({ ...d, eps: 0 })
    close(sol0.results[0].value, 0.5)
    close(sol0.results[1].value, 0.5)
    const r0 = regularizedPreconditioner({ J: [[-3, 0], [0, -1]], gamma: 0.5, eps: 0, sigmaEta2: 1 / 64 })
    close(r0.modeVar[1] / r0.modeVar[0], 9)
    const tips = def.tips!.join('')
    expect(tips).toContain(String(Number(p1.toPrecision(5))))
    expect(tips).toContain(String(Number(p2.toPrecision(5))))
  })

  it('HC-RM.5 的預設值是 R5 預覽 B 的預設（N₀ = 256、λ_t = 10⁻³）：答案等於 nearIntegerAsymptote／nearIntegerKeepOut，兩者互為反函數', () => {
    const def = hc('HC-RM.5')
    const d = defaultValues(def)
    expect(d).toEqual({ alpha: 1e-4, N0: 256, lt: 1e-3 })
    const [lam, keep] = values(def, d)
    expect(lam).toBe(nearIntegerAsymptote(1e-4, 256))
    expect(keep).toBe(nearIntegerKeepOut(1e-3, 256))
    close(nearIntegerAsymptote(keep, 256), 1e-3)
    // 漸近式與數值掃描（最差窗口）在 αN₀ ≪ 1 時相差不到 5%
    const numeric = windowLambdaMin(1e-4, 256, 48).worst
    expect(Math.abs(lam / numeric - 1)).toBeLessThan(0.05)
    // λ ∝ α²、keep-out ∝ 1/N₀
    close(values(def, { ...d, alpha: 2e-4 })[0], 4 * lam)
    expect(values(def, { ...d, N0: 1024 })[1] / keep).toBeCloseTo(0.25, 3)
  })

  it('HC-RM.6 的預設值是 R6 的 preset「Gaussian + 遲滯 H = σ_v」：斜率、ν、ℐ/K_q² 等於 hysteresisStats；H = 0 回到一般 comparator', () => {
    const def = hc('HC-RM.6')
    const d = defaultValues(def)
    expect(d).toEqual({ sigmaV: 100, H: 100 })
    const st = hysteresisStats({ kind: 'gaussian', sigma: 100 }, 0, 100, 0)
    const kq = KQ1 / 100
    const [slope, nu, ratio] = values(def, d)
    expect(slope).toBe(st.slope)
    expect(nu).toBe(st.nu)
    expect(ratio).toBe(st.info / (kq * kq))
    expect(slope).toBeGreaterThan(kq) // 斜率變大
    expect(ratio).toBeLessThan(1) // 資訊變少
    const [slope0, nu0, ratio0] = values(def, { ...d, H: 0 })
    close(slope0, kq)
    expect(nu0).toBe(0)
    close(ratio0, 1)
  })

  it('T09: HC-RM.7 的數字是規格 §8.4（r_s = 0.8、b_s = 0.2、c_s = 1、μ = 1.2）：N = 1 重現 golden 的 |z| = √1.04，預設 N = 2 收斂；答案等於 liftedDualLoop + eig2', () => {
    const T09 = golden('T09')
    const inp = T09.inputs as { r: number; b: number; c: number; mu: number }
    const exp = T09.expected as { pole_abs: number; char_poly: number[]; simplified_pole_at_mu: number }
    const def = hc('HC-RM.7')
    const d = defaultValues(def)
    expect(d).toEqual({ ...inp, N: 2 })
    expect(R7_EXAMPLE).toEqual(inp)
    const one = def.solve({ ...d, N: 1 })
    expect(one.results[0].value).toBe(1) // S₁ = 1
    close(one.results[1].value, exp.char_poly[2], 0, 1e-12) // det = r_s + μ b_s c_s = 1.04
    close(one.results[2].value, exp.pole_abs, 0, 1e-12)
    expect(one.steps[one.steps.length - 1].tex).toContain(String(Number(exp.simplified_pole_at_mu.toPrecision(5)))) // quasi-static pole −0.2
    const [SN, det, rho] = values(def, d)
    const A = liftedDualLoop({ ...inp, N: 2 })
    close(SN, 1.8)
    close(det, A[0][0] * A[1][1] - A[0][1] * A[1][0])
    expect(rho).toBe(eig2(A).rho)
    expect(rho).toBeLessThan(1)
    close(rho, Math.sqrt(0.952))
    // 逐 sample 的直接模擬給出同樣的結論：N = 2 衰減、N = 1 發散（看最後 50 個 block 的最大值，避開振盪的過零點）
    const tail = (N: number) => Math.max(...Array.from(simulateMultirate({ ...inp, N }, 400, 0, 1).delta.subarray(350)).map(Math.abs))
    expect(tail(2)).toBeLessThan(1e-2)
    expect(tail(1)).toBeGreaterThan(10)
    // 「先算一次」表與提示：N = 1 發散、N = 2 與 16 收斂
    expect(r7Rho(1)).toBe(one.results[2].value)
    expect(r7Rho(2)).toBe(rho)
    expect(r7Rho(16)).toBeLessThan(rho)
    const tips = def.tips!.join('')
    for (const N of [1, 2, 16]) expect(tips).toContain(String(Number(r7Rho(N).toPrecision(5))))
  })

  it('HC-RM.8 的預設值是 R8 預覽的預設（T13 的 σ_v、N，σ_ζ = 0.01 fs）：g* = 穩態 Kalman 增益，而且真的是 V(g) 的最小值', () => {
    const def = hc('HC-RM.8')
    const d = defaultValues(def)
    expect(d).toEqual({ sigmaV: 100, N: 4096, sz: 0.01 })
    const K = KQ1 / 100
    const sy2 = 1 / (4096 * K * K)
    const [g, mu, rms] = values(def, d)
    expect(g).toBe(optimalTrackingGain(1e-4, sy2))
    close(g, kalmanSteady(1e-4, sy2).gain)
    close(mu, g / K)
    close(rms * rms, kalmanSteady(1e-4, sy2).Pprior)
    close(rms * rms, trackingVariance(g, 1e-4, sy2))
    for (const f of [0.5, 0.9, 1.1, 2]) expect(trackingVariance(g * f, 1e-4, sy2)).toBeGreaterThan(rms * rms)
    // 提示：μ* ≈ 0.64 fs，第 14 章的近似 σ_ζ√N = 0.64 fs
    expect(Number(mu.toPrecision(2))).toBe(0.64)
    expect(def.tips!.join('')).toContain('0.64')
  })

  it('HC-RM.9 的預設值是 golden negative test（6-bit × 4096、17-bit）：n_safe = 2114、wrap = −4096、saturate = 65535，與逐筆累加一致', () => {
    const neg = golden('negative_tests')
    const exp = neg.expected as { gmac_bits_required: number; gmac_17bit_wrapped_sum: number }
    const def = hc('HC-RM.9')
    const d = defaultValues(def)
    expect(d).toEqual({ Wx: 6, k: 12, neg: 0, Wacc: 17 })
    const [nSafe, wrap, sat] = values(def, d)
    expect(nSafe).toBe(worstCaseSafeCount(6, 17, false))
    expect(nSafe).toBe(2114)
    expect(wrap).toBe(exp.gmac_17bit_wrapped_sum)
    expect(sat).toBe(65535)
    const wc = worstCaseAccumulate(6, 4096, 17, false)
    expect(wc.firstOverflowAt).toBe(nSafe + 1)
    expect([wc.wrapped, wc.saturated]).toEqual([wrap, sat])
    expect(def.solve(d).notes!.join('')).toContain(`W_\\mathrm{acc}\\ge${exp.gmac_bits_required}`)
    expect(accumulatorBits(6, 4096, false).bitsRequired).toBe(exp.gmac_bits_required)
    // 位寬足夠（18 bits）：不溢位，wrap = saturate = 真實總和
    expect(values(def, { ...d, Wacc: 18 })).toEqual([Math.floor(131071 / 31), 126976, 126976])
    // 提示的第二個例子：含最負 code、18 bits ⇒ n_safe = 4095，最後一筆溢位，wrap 成 −131072
    expect(values(def, { ...d, neg: 1, Wacc: 18 })).toEqual([4095, -131072, 131071])
    expect(worstCaseAccumulate(6, 4096, 18, true).firstOverflowAt).toBe(4096)
  })

  it('n_safe + 1 = 逐筆累加找到的第一次溢位（所有 practice 組合；不溢位時兩邊都是「沒有」）', () => {
    for (const v of allPracticeCombos(hc('HC-RM.9'))) {
      const N = 2 ** v.k
      const safe = worstCaseSafeCount(v.Wx, v.Wacc, v.neg >= 1)
      expect(worstCaseAccumulate(v.Wx, N, v.Wacc, v.neg >= 1).firstOverflowAt, JSON.stringify(v)).toBe(safe < N ? safe + 1 : null)
    }
  })

  it('HC-RM.10 的預設值是 R10 預覽的預設：B = 195，g、σ_w 等於預覽表格 N = 4096 那一列；tanh 律 ≤ 整數 B 的結果 ≤ 多 block 極限附近', () => {
    const def = hc('HC-RM.10')
    const d = defaultValues(def)
    expect(d).toEqual({ sigmaV: 100, fsG: 4, tUs: 200, eps: 0.01, k: 12 })
    // R10 預覽的預設規格（σ_w,max = 0.5 fs、δ0 = 20 fs、PM 60°）：N = 4096 這一列的下界由「時間」決定
    const page = inverseDesign({ sigmaV: 100, C: 1, fs: 4e9, sigmaWMax: 0.5, tMax: 200e-6, eps: 0.01, delta0: 20, pmMinDeg: 60, log2Nmin: 4, log2Nmax: 18 })
    const row = page.rows.find((r) => r.N === 4096)!
    const [B, g, mu, sw, swMin] = values(def, d)
    expect(B).toBe(195)
    expect(B).toBe(row.Bmax)
    expect(row.gLo).toBe(row.gTime)
    expect(g).toBe(row.gLo)
    expect(mu).toBe(row.muLo)
    expect(sw).toBe(row.sigmaWAtLo)
    close(swMin, row.sigmaWContinuous, 1e-12) // 200 × 1e-6 與 200e-6 在 double 裡差 1 ulp，f_s·T_max 也跟著差 1 ulp
    expect(row.feasible).toBe(true)
    expect(swMin).toBeLessThanOrEqual(sw)
    expect(swMin).toBeLessThanOrEqual(page.floorMany)
    close((1 - g) ** B, 0.01, 1e-9)
    // f_s·T_max 剛好是 N 的整數倍時，整數 B 與 tanh 律完全相同
    const exact = def.solve({ ...d, fsG: 4.096, tUs: 200 }) // 819200 / 4096 = 200
    expect(exact.results[0].value).toBe(200)
    close(exact.results[3].value, exact.results[4].value, 1e-12)
    expect(exact.notes!.join('')).toContain('完全相同')
    expect(def.tips!.join('')).toContain('B=195')
  })
})

// ═════════════════════════ 隨機題與所有 practice 組合 ═════════════════════════

describe('roadmap 手算題：隨機 20 題與獨立重算一致', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues(seed 1…20) 都通過 validate、答案有限，且等於測試裡另寫的算法', (_id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, JSON.stringify(v)).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${i.key}=${v[i.key]}`).toBeNull())
      const sol = def.solve(v)
      const expected = INDEPENDENT[def.id](v)
      expect(sol.results).toHaveLength(expected.length)
      sol.results.forEach((r, k) => {
        expect(Number.isFinite(r.value), `${r.symbol} @ ${JSON.stringify(v)}`).toBe(true)
        close(r.value, expected[k], INDEPENDENT_REL[def.id] ?? 1e-9, 1e-12, `${def.id} ${r.symbol} @ ${JSON.stringify(v)}`)
      })
      for (const note of sol.notes ?? []) {
        expect(unpaired(note), note).toBe(false)
        expect(note).not.toMatch(/NaN|undefined|Infinity/)
      }
    }
    // 「換一題」真的會換數字（不是每次都因 validate 不過而退回預設值）
    expect(seen.size, def.id).toBeGreaterThanOrEqual(8)
  })

  it('預設值也等於獨立重算（每一題）', () => {
    for (const def of HANDCALCS) {
      const d = defaultValues(def)
      const expected = INDEPENDENT[def.id](d)
      def.solve(d).results.forEach((r, k) => close(r.value, expected[k], INDEPENDENT_REL[def.id] ?? 1e-9, 1e-12, `${def.id} ${r.symbol}`))
    }
  })
})

describe('roadmap 手算題：practice 範圍內的每一種組合都合法，而且每一步都能照畫面上的數字算出來', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：所有組合通過 validate、答案有限；每一步「符號式 = 代入 = 結果」的數字段互相一致', (_id, def) => {
    const combos = [defaultValues(def), ...allPracticeCombos(def)]
    expect(combos.length).toBeGreaterThan(10)
    for (const v of combos) {
      const tag = `${def.id} ${JSON.stringify(v)}`
      expect(def.validate?.(v) ?? null, tag).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${tag} ${i.key}`).toBeNull())
      const sol = def.solve(v)
      for (const r of sol.results) expect(Number.isFinite(r.value), `${tag} ${r.symbol}`).toBe(true)
      expect(sol.steps.length, tag).toBeGreaterThanOrEqual(5)
      let lastNumeric: number[] = []
      sol.steps.forEach((s, k) => {
        const where = `${tag} 第 ${k + 1} 步`
        expect(badNumber(s.tex), `${where}：${s.tex}`).toBe(false)
        expect(s.why.length, where).toBeGreaterThan(0)
        expect(unpaired(s.why), `${where}：${s.why}`).toBe(false)
        const chain = expectChainConsistent(s.tex, where)
        // 每一步至少是「符號式 = …  = 結果」（兩個等號以上），而且至少有一段是代入數字後的算式或結果
        expect(chain.segments, `${where}：${s.tex}`).toBeGreaterThanOrEqual(3)
        expect(chain.numeric.length, `${where}：${s.tex}`).toBeGreaterThanOrEqual(1)
        lastNumeric = chain.numeric
      })
      expect(lastNumeric.length).toBeGreaterThan(0)
      // 每個答案都出現在某一步的結尾（畫面上算得出來），容許顯示位數的捨入
      const finals = sol.steps.map((s) => TexCalc.evaluate(splitTopLevel(s.tex).pop()!)).filter((x): x is number => x !== null)
      for (const r of sol.results) {
        const hit = finals.some((f) => Math.abs(f - r.value) <= 5e-4 * Math.abs(r.value) + 1e-12)
        expect(hit, `${tag}：答案 ${r.symbol} = ${r.value} 沒有出現在任何一步的結尾`).toBe(true)
      }
    }
  })

  it('求值器本身：認得手算題的語法，含符號的段落回傳 null', () => {
    expect(TexCalc.evaluate(String.raw`\frac{0.79788}{100}`)).toBeCloseTo(0.0079788, 12)
    expect(TexCalc.evaluate(String.raw`1-0.920212^2`)).toBeCloseTo(1 - 0.920212 ** 2, 12)
    expect(TexCalc.evaluate(String.raw`4\times10^{9}\times200\times10^{-6}`)).toBeCloseTo(800000, 6)
    expect(TexCalc.evaluate(String.raw`(10^{-4})^2`)).toBeCloseTo(1e-8, 20)
    expect(TexCalc.evaluate(String.raw`\Big\lfloor\frac{65535}{31}\Big\rfloor`)).toBe(2114)
    expect(TexCalc.evaluate(String.raw`192512\bmod131072`)).toBe(61440)
    expect(TexCalc.evaluate(String.raw`\min(126976,\ 65535)`)).toBe(65535)
    expect(TexCalc.evaluate(String.raw`e^{-\frac{4.6052}{195}}`)).toBeCloseTo(Math.exp(-4.6052 / 195), 12)
    expect(TexCalc.evaluate(String.raw`\ln(100)`)).toBeCloseTo(Math.log(100), 12)
    expect(TexCalc.evaluate(String.raw`\sqrt{0.952}\ \mathrm{fs^{-1}}`)).toBeCloseTo(Math.sqrt(0.952), 12)
    expect(TexCalc.evaluate(String.raw`0.36\times(-1.08)`)).toBeCloseTo(-0.3888, 12)
    expect(TexCalc.evaluate(String.raw`-\frac{2.16}{2}`)).toBe(-1.08)
    expect(TexCalc.evaluate(String.raw`\Phi(0.5)`)).toBeCloseTo(0.691462461, 8)
    expect(TexCalc.evaluate(String.raw`\tanh(0.5)`)).toBeCloseTo(Math.tanh(0.5), 12)
    for (const symbolic of [String.raw`\mu K`, String.raw`\frac{\sqrt{2/\pi}}{\sigma_v}`, String.raw`\frac{e^{-z^2/2}}{\sqrt{2\pi}}`, String.raw`\max|q\,x|`, String.raw`\mathrm{wrap}_W(T)`, 'N', String.raw`126976\le U`])
      expect(TexCalc.evaluate(symbolic), symbolic).toBeNull()
    // 對不上的鏈會被抓到
    expect(() => expectChainConsistent(String.raw`p=1-g=1-0.079788=0.93`, 'neg')).toThrow()
  })
})

// ═════════════════════════ 提示與說明裡的近似：適用範圍是真的 ═════════════════════════

describe('roadmap 手算題：why／tips 裡的近似與常數經過驗證', () => {
  it(`Φ(z) ≈ ½ + φ(0)(z − z³/6)：|z| ≤ ${PHI_SERIES_ZMAX} 時絕對誤差 < 4×10⁻⁴（HC-RM.6 第 4 步的說明）`, () => {
    let worst = 0
    for (let k = -100; k <= 100; k++) {
      const z = (k / 100) * PHI_SERIES_ZMAX
      worst = Math.max(worst, Math.abs(phiSeries(z) - phiIntegral(z)))
    }
    expect(worst).toBeLessThan(4e-4)
    expect(worst).toBeGreaterThan(1e-4) // 界限不是隨便寫的：邊界上真的有 10⁻⁴ 等級的誤差
    expect(hc('HC-RM.6').solve(defaultValues(hc('HC-RM.6'))).steps[3].why).toContain(String(PHI_SERIES_ZMAX))
    // 常數 √(2π) ≈ 2.5066、1/√(2π) ≈ 0.39894、2/π ≈ 0.63662、√(2/π) ≈ 0.79788
    expect(Number(SQRT_2PI.toPrecision(5))).toBe(2.5066)
    expect(Number((1 / SQRT_2PI).toPrecision(5))).toBe(0.39894)
    expect(Number((2 / Math.PI).toPrecision(5))).toBe(0.63662)
    expect(Number(KQ1.toPrecision(5))).toBe(0.79788)
  })

  it('near-integer 漸近式的適用範圍（HC-RM.5 第 5 步的說明）：αN₀ ≤ 0.1 時與數值掃描相差 5% 以內；到 0.5 時低估不超過 16%，而且永遠偏保守', () => {
    for (const N0 of [64, 256, 1024, 4096]) {
      for (const aN of [0.003, 0.01, 0.03, 0.06, 0.1, 0.2, 0.35, 0.5]) {
        const alpha = aN / N0
        const ratio = nearIntegerAsymptote(alpha, N0) / windowLambdaMin(alpha, N0, 48).worst
        const tag = `N0=${N0}, αN0=${aN}: ratio ${ratio}`
        expect(ratio, tag).toBeLessThanOrEqual(1 + 1e-9) // 漸近式不會高估最差窗口的 λ_min
        expect(ratio, tag).toBeGreaterThan(aN <= 0.1 ? 0.95 : 0.84)
      }
    }
    const def = hc('HC-RM.5')
    expect(def.solve(defaultValues(def)).steps[4].why).toContain('5%')
    // 邊界：αN₀ = 0.5 還可以算，再大就擋下
    expect(def.validate?.({ alpha: 0.5 / 256, N0: 256, lt: 1e-3 }) ?? null).toBeNull()
    expect(def.validate?.({ alpha: 0.51 / 256, N0: 256, lt: 1e-3 })).toMatch(/wrap/)
  })

  it(`z > ${HYST_ZMAX} 才被擋下：c = 1 − Φ(3) = 1.35×10⁻³（訊息裡的 1.4×10⁻³ 是它的上界）；常用值表與積分一致`, () => {
    const c3 = 1 - phiIntegral(HYST_ZMAX)
    expect(c3).toBeLessThan(1.4e-3)
    expect(c3).toBeGreaterThan(1.3e-3)
    const def = hc('HC-RM.6')
    expect(def.validate?.({ sigmaV: 100, H: 600 }) ?? null).toBeNull() // z = 3：還可以算
    expect(def.validate?.({ sigmaV: 100, H: 601 })).toMatch(/卡死/)
    const tips = def.tips!.join('')
    for (const z of [0.25, 0.5, 1, 2]) expect(tips).toContain(String(Number(phiIntegral(z).toPrecision(5))))
  })

  it(`tanh(y)/y ≈ 1 − y²/3：y ≤ ${TANH_SERIES_YMAX} 時誤差 < 1.4×10⁻⁵（HC-RM.10 小 y 的步驟）；大 y 改按 tanh 鍵`, () => {
    let worst = 0
    for (let k = 1; k <= 200; k++) {
      const y = (k / 200) * TANH_SERIES_YMAX
      worst = Math.max(worst, Math.abs(Math.tanh(y) / y - (1 - (y * y) / 3)))
    }
    expect(worst).toBeLessThan(1.4e-5)
    const def = hc('HC-RM.10')
    const small = def.solve(defaultValues(def)) // y ≈ 0.012
    expect(small.steps.some((s) => /1-\\frac\{y\^2\}\{3\}/.test(s.tex))).toBe(true)
    expect(small.steps.some((s) => /\\tanh\(/.test(s.tex))).toBe(false)
    const big = def.solve({ sigmaV: 100, fsG: 4, tUs: 200, eps: 0.01, k: 18 }) // B = 3、y ≈ 0.75
    expect(big.results[0].value).toBe(3)
    expect(big.steps.some((s) => /\\tanh\(/.test(s.tex))).toBe(true)
    big.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-RM.10 大 y 第 ${k + 1} 步`))
  })

  it(`σ_ζ²/σ_y² > ${TRACK_RATIO_MAX} 才被擋下：邊界上 s − σ_ζ² 吃掉約 1.7 位有效數字，而訊息建議的 g* ≈ 1 − σ_y²/σ_ζ² 誤差 < 3×10⁻⁴`, () => {
    const ratio = TRACK_RATIO_MAX
    const s = Math.sqrt(1 + 4 / ratio) // 以 σ_ζ² 為單位
    const lost = Math.log10(s / (s - 1))
    expect(lost).toBeGreaterThan(1.5)
    expect(lost).toBeLessThan(2)
    const exact = optimalTrackingGain(ratio, 1)
    expect(Math.abs(exact - (1 - 1 / ratio))).toBeLessThan(3e-4)
    // 邊界內（比值 ≈ 26）仍可計算，而且每一步的數字段一致
    const def = hc('HC-RM.8')
    const v = { sigmaV: 100, N: 4096, sz: 10 }
    expect(def.validate?.(v) ?? null).toBeNull()
    def.solve(v).steps.forEach((st, k) => expectChainConsistent(st.tex, `HC-RM.8 大漂移 第 ${k + 1} 步`))
    expect(def.validate?.({ ...v, sz: 20 })).toMatch(/相減/)
  })

  it('使用者自己的數字（不在 practice 格點上、含負數與極端值）：每一步仍然一致，沒有 NaN', () => {
    const cases: [string, Record<string, number>][] = [
      ['HC-RM.1', { sigmaV: 73.5, N: 3000, mu: 150, rho: -0.83 }], // p < 0
      ['HC-RM.1', { sigmaV: 100, N: 4096, mu: 0.37, rho: 0.99 }], // p ≈ 1、pρ ≈ 1
      ['HC-RM.2', { p: -0.7, N: 7, m: 33 }],
      ['HC-RM.2', { p: 0, N: 5, m: 3 }],
      ['HC-RM.2', { p: 0.95, N: 1, m: 6 }],
      ['HC-RM.4', { s1: 2.5, s2: 0.013, gamma: 1.7, eps: 0, N: 1000 }], // p < 0、ε = 0
      ['HC-RM.4', { s1: 1, s2: 1, gamma: 0.3, eps: 50, N: 1 }],
      ['HC-RM.5', { alpha: 3.3e-6, N0: 4096, lt: 2.5e-5 }],
      ['HC-RM.6', { sigmaV: 37, H: 12.5 }],
      ['HC-RM.6', { sigmaV: 100, H: 600 }], // z = 3
      ['HC-RM.7', { r: -0.6, b: -0.3, c: 1.5, mu: 0.8, N: 3 }], // b·c < 0
      ['HC-RM.7', { r: 0.95, b: 0.05, c: 1, mu: 0.8, N: 8 }],
      ['HC-RM.7', { r: 0.8, b: 0.2, c: 1, mu: 1.2, N: 1 }], // T09
      ['HC-RM.7', { r: 0.5, b: 0.2, c: 1, mu: 0.5, N: 3 }], // 實根
      ['HC-RM.8', { sigmaV: 250, N: 100, sz: 1.5 }],
      ['HC-RM.9', { Wx: 12, k: 16, neg: 1, Wacc: 13 }],
      ['HC-RM.9', { Wx: 2, k: 0, neg: 0, Wacc: 2 }],
      ['HC-RM.9', { Wx: 6, k: 12, neg: 0, Wacc: 40 }],
      ['HC-RM.10', { sigmaV: 60, fsG: 2.5, tUs: 37, eps: 0.2, k: 9 }],
      ['HC-RM.10', { sigmaV: 100, fsG: 4, tUs: 200, eps: 1e-6, k: 19 }], // B = 1
    ]
    for (const [id, v] of cases) {
      const def = hc(id)
      const tag = `${id} ${JSON.stringify(v)}`
      expect(def.validate?.(v) ?? null, tag).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${tag} ${i.key}`).toBeNull())
      const sol = def.solve(v)
      const expected = INDEPENDENT[id](v)
      sol.results.forEach((r, k) => close(r.value, expected[k], Math.max(INDEPENDENT_REL[id] ?? 1e-9, 1e-7), 1e-10, `${tag} ${r.symbol}`))
      sol.steps.forEach((s, k) => {
        expect(badNumber(s.tex), `${tag}：${s.tex}`).toBe(false)
        expectChainConsistent(s.tex, `${tag} 第 ${k + 1} 步`)
      })
    }
    // b_s c_s < 0：polarity 錯誤會在說明裡講出來
    expect(hc('HC-RM.7').solve({ r: -0.6, b: -0.3, c: 1.5, mu: 0.8, N: 3 }).notes!.join('')).toContain('polarity')
  })
})

// ═════════════════════════ validate ═════════════════════════

describe('roadmap 手算題：validate 擋下模型不適用的輸入並解釋原因', () => {
  it.each(INVALID.map((c) => [`${c.hc} ${c.name}`, c] as const))('%s', (_name, c) => {
    const def = hc(c.hc)
    const v = { ...defaultValues(def), ...c.patch }
    // 這些值都在輸入欄的合法範圍內：擋下它們的是 validate（有解釋），不是「不可大於 …」
    def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${c.hc} ${i.key}=${v[i.key]}`).toBeNull())
    const msg = def.validate?.(v)
    expect(msg, c.name).toBeTruthy()
    expect(msg!).toMatch(c.expect)
    expect(msg!.length).toBeGreaterThan(30) // 是解釋，不是只有「不合法」
    expect(unpaired(msg!), msg!).toBe(false)
    expect(msg!).not.toMatch(/NaN|undefined/)
  })

  it('每一題至少有一個 validate 案例', () => {
    for (const h of HANDCALCS) expect(INVALID.some((c) => c.hc === h.id), h.id).toBe(true)
  })

  it('不合法的輸入在畫面上顯示原因（KaTeX 排版、沒有殘留的 $），不顯示任何步驟或答案', () => {
    for (const c of INVALID) {
      const def = hc(c.hc)
      const { container, unmount } = render(<HandCalc def={withValues(def, { ...defaultValues(def), ...c.patch })} />)
      const warn = container.querySelector('.callout-warn')
      expect(warn, `${c.hc} ${c.name}`).toBeTruthy()
      expect(warn!.querySelector('.katex'), `${c.hc} ${c.name}`).toBeTruthy()
      expect(proseText(warn!)).not.toContain('$')
      expect(container.querySelector('.katex-error'), `${c.hc} ${c.name}`).toBeNull()
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      expect(container.querySelector('.c-handcalc-results')).toBeNull()
      unmount()
    }
  })

  it('輸入欄的合法範圍：非整數的筆數／位寬、負的雜訊、超出範圍的旗標會被擋下', () => {
    const byKey = (id: string, key: string) => hc(id).inputs.find((i) => i.key === key)!
    expect(inputError(byKey('HC-RM.1', 'N'), 10.5)).toBeTruthy()
    expect(inputError(byKey('HC-RM.1', 'sigmaV'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-RM.1', 'rho'), 1.2)).toBeTruthy()
    expect(inputError(byKey('HC-RM.2', 'm'), -1)).toBeTruthy()
    expect(inputError(byKey('HC-RM.4', 'eps'), -0.1)).toBeTruthy()
    expect(inputError(byKey('HC-RM.6', 'H'), -5)).toBeTruthy()
    expect(inputError(byKey('HC-RM.7', 'N'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-RM.9', 'neg'), 2)).toBeTruthy()
    expect(inputError(byKey('HC-RM.9', 'Wacc'), 17.5)).toBeTruthy()
    expect(inputError(byKey('HC-RM.10', 'k'), 3.5)).toBeTruthy()
    expect(inputError(byKey('HC-RM.10', 'eps'), 0)).toBeTruthy()
  })
})

// ═════════════════════════ 渲染 ═════════════════════════

describe('roadmap 手算題：渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 6 組隨機數字都能渲染，沒有 .katex-error、沒有殘留的 $，步驟數與 solve() 相同', (_id, def) => {
    const cases = [defaultValues(def), ...[1, 2, 3, 4, 5, 6].map((seed) => randomValues(def, seed))]
    for (const v of cases) {
      const sol = def.solve(v)
      const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
      expect(container.querySelector('.katex-error'), JSON.stringify(v)).toBeNull()
      expect(container.querySelector('.c-tex-error')).toBeNull()
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(proseText(container), JSON.stringify(v)).not.toContain('$')
      unmount()
    }
  })

  it('自己算算看：把 solve() 的答案四捨五入到 4 位有效數字填回去，每一格都判定正確；第一格差 5% 則判定錯誤', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      const view = within(container)
      const inputs = view.getAllByPlaceholderText('你的答案') as HTMLInputElement[]
      expect(inputs).toHaveLength(sol.results.length)
      inputs.forEach((el, k) => {
        const v = sol.results[k].value
        fireEvent.change(el, { target: { value: Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))) } })
      })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length, def.id).toBe(sol.results.length)
      const first = sol.results[0].value
      fireEvent.change(inputs[0], { target: { value: String(first === 0 ? 0.5 : first * 1.05) } })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.bad').length, def.id).toBe(1)
      fireEvent.click(view.getByText('看詳解'))
      expect(container.querySelectorAll('.c-step').length, def.id).toBe(sol.steps.length)
      unmount()
    }
  })

  it('改輸入會即時重新帶入：HC-RM.9 把累加器改成 18 bits ⇒ 不再溢位；改成 4 bits ⇒ 顯示原因', () => {
    const def = hc('HC-RM.9')
    const { container } = render(<HandCalc def={def} />)
    const answers = () => container.querySelector('.c-handcalc-results')?.textContent ?? ''
    expect(answers()).toContain('-4096')
    const acc = within(container).getByLabelText(/累加器位寬/) as HTMLInputElement
    fireEvent.change(acc, { target: { value: '18' } })
    expect(answers()).not.toContain('-4096')
    expect(answers()).toContain('126976')
    expect(container.querySelector('.c-handcalc-notes')?.textContent).toContain('不溢位')
    fireEvent.change(acc, { target: { value: '4' } })
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('位寬接錯')
    fireEvent.change(acc, { target: { value: '17.5' } })
    expect(container.textContent).toContain('必須是整數')
  })
})

// ═════════════════════════ 頁面上的位置 ═════════════════════════

describe('roadmap 手算題：每一題都真的出現在頁面上，緊接在對應預覽的推導之後、實驗之前', () => {
  const WHERE: Record<string, { card: string; exp: string }> = {
    'HC-RM.1': { card: 'rm-item-R1', exp: 'exp-roadmap-r1-colored' },
    'HC-RM.2': { card: 'rm-item-R2', exp: 'exp-roadmap-r2-cyclo' },
    'HC-RM.4': { card: 'rm-item-R4', exp: 'exp-roadmap-r4-precond' },
    'HC-RM.5': { card: 'rm-item-R5', exp: 'exp-roadmap-r5-nearint' },
    'HC-RM.6': { card: 'rm-item-R6', exp: 'exp-roadmap-r6-comparator' },
    'HC-RM.7': { card: 'rm-item-R7', exp: 'exp-roadmap-r7-lifting' },
    'HC-RM.8': { card: 'rm-item-R8', exp: 'exp-roadmap-r8-tracking' },
    'HC-RM.9': { card: 'rm-item-R9', exp: 'exp-roadmap-r9-accumulator' },
    'HC-RM.10': { card: 'rm-item-R10', exp: 'exp-roadmap-r10-inverse' },
  }

  // 用最嚴格的 beginner 模式：手算題不在任何 ModeGate 裡，初學者也看得到
  it('beginner 模式：展開全部預覽後九題都在；R3 指向第 13 章、SSPLL 指向案例頁；整頁沒有 KaTeX 錯誤或殘留的 $', () => {
    const { container } = withProviders(<RoadmapPage />, 'beginner')
    expect(container.querySelectorAll('.c-handcalc')).toHaveLength(0) // 預覽收合時不計算、不渲染
    for (const card of Array.from(container.querySelectorAll('.rm-card'))) {
      fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /展開數學預覽/ }))
    }
    expect(Object.keys(WHERE)).toEqual(HANDCALCS.map((h) => h.id))
    const all = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(all.map((el) => el.id.replace('handcalc-', ''))).toEqual(HANDCALCS.map((h) => h.id))
    for (const el of all) {
      const id = el.id.replace('handcalc-', '')
      const card = el.closest('.rm-card') as HTMLElement
      expect(card.id, id).toBe(WHERE[id].card)
      // 推導（StepDerivation）在前、互動實驗在後
      const derivation = card.querySelector('.c-steps')!
      const exp = card.querySelector(`#${WHERE[id].exp}`)!
      expect(derivation, id).toBeTruthy()
      expect(exp, id).toBeTruthy()
      expect(derivation.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
      expect(el.compareDocumentPosition(exp) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
      expect(el.querySelectorAll('.c-step').length, id).toBe(roadmapHandCalc(id).solve(defaultValues(roadmapHandCalc(id))).steps.length)
    }
    // R3：不重複出題，明講手算題在第 13 章（連結存在）
    const r3 = container.querySelector('#rm-item-R3') as HTMLElement
    expect(r3.querySelector('.c-handcalc')).toBeNull()
    expect(r3.textContent).toMatch(/HC-13\.5/)
    expect(r3.textContent).toMatch(/HC-13\.6/)
    expect(r3.textContent).toMatch(/HC-13\.3/)
    expect(r3.querySelector('a[href="/ch/13"]')).toBeTruthy()
    // R9：指向第 4 章的 HC-04.6（需要幾個 bit），本頁算的是溢位位置與 wrap / saturate
    const r9 = container.querySelector('#rm-item-R9') as HTMLElement
    expect(r9.textContent).toMatch(/HC-04\.6/)
    expect(r9.querySelector('a[href="/ch/04"]')).toBeTruthy()
    expect(r9.textContent).toContain(String(worstCaseSafeCount(6, 17, false) + 1)) // 第 2115 筆
    // R7 的「先算一次」表：N = 1、2、16 的 ρ 由 model 計算
    const r7 = container.querySelector('#rm-item-R7') as HTMLElement
    for (const N of [1, 2, 16]) expect(r7.textContent).toContain(String(Number(r7Rho(N).toPrecision(4))))
    // SSPLL：手算題在案例頁
    const ss = container.querySelector('#rm-item-SSPLL') as HTMLElement
    expect(ss.querySelector('.c-handcalc')).toBeNull()
    expect(ss.querySelector('a[href="#/case/sspll"]')).toBeTruthy()
    // 整頁（含九題手算）沒有 KaTeX 錯誤；手算題區塊內沒有殘留的 $
    expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title'))).toEqual([])
    for (const el of all) expect(proseText(el), el.id).not.toContain('$')
  })
})
