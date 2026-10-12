import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import {
  bernoulliMoments,
  ditherVariance,
  efbInbandWhite,
  efbPeriod,
  efbResidualVar,
  efbWhitePower,
  gcd,
  isRotation,
  lcm,
  lineSpectrum,
  makeCtx,
  makeGrid,
  mixWithResidue,
  mod,
  ntfGain2,
  quantize,
  rationalApprox,
  simulateStrategy,
  stochasticQuantVar,
  stochasticQuantVarApprox,
  togglePeriodOf,
  zohGain2,
  type Grid,
  type QState,
  type QuantizerSetup,
  type RoundingMode,
} from '@/simulation/models/quantizer'

/**
 * 第 13 章的「帶入手算」題（HC-13.1 … HC-13.8）。
 *
 * 原則（docs/teaching-style.md §7）：
 *  1. 數值一律來自 src/simulation/models/quantizer.ts 的實際函式：quantize()、simulateStrategy()（toggle / ΔΣ 的
 *     bit-true 整數運算）、lineSpectrum()、zohGain2()、bernoulliMoments()、efbPeriod()、mixWithResidue()，以及
 *     core:whiteApprox 的閉式（ntfGain2 / ditherVariance / efbWhitePower / efbInbandWhite / stochasticQuantVarApprox）；
 *     這裡只做「把中間量排成一步一步」的四則運算。
 *  2. 預設值 = 本章 worked example（w* = 32.4、Δ_LSB = 0.125 fs/LSB、L_t = 5、F = 10、f_B = f_u/64、σ_w = 0.2 LSB），
 *     答案對得上內文表格與 T16 / T17。
 *  3. 誤差的正負號同時標出兩種約定：本章顯示 δw = w − w*（§12），全站 §0 為 δ = a − w = −δw（勘誤 E49）。
 */

/** gain register 的位元數（本章固定 6 bit：code 0 … 63）。 */
const B_BITS = 6
const MAX_CODE = 2 ** B_BITS - 1

/** 手算題使用的量化器設定：6 bit、saturate、沒有 anti-windup（與章內範例相同）。 */
const SETUP: QuantizerSetup = {
  bits: B_BITS,
  rounding: 'nearest',
  overflow: 'saturate',
  antiWindup: false,
  togglePeriod: 5,
  toggleOrder: 'spread',
  randomSource: 'ideal',
  prbsBits: 7,
  ditherLsb: 0,
  ditherPdf: 'uniform',
}

/** 一階 ΔΣ 手算表的列數。 */
const EFB_STEPS = 6
/** ΔΣ 手算題接受的最大分母（輸入必須是「手算友善」的有理數）。 */
const MAX_DEN = 1000
/** 一階 EFB 白色近似中「沒有 dither」的 σ_r²。 */
const SIGMA_R2_PLAIN = efbResidualVar(0)

const newState = (): QState => ({ n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 })

/** 去掉相減後的浮點尾巴（0.3999999999999986 → 0.4、3e-17 → 0）；只用在顯示與回傳。 */
const tidy = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(12)))

/** 不用科學記號的數字（整數或有限小數；用在 K、2^F 這類要「照抄」的值）。 */
const plain = (x: number): string => String(Number(x.toFixed(12)))

const INT_TOL = { abs: 1e-9, rel: 0 }

/**
 * 中間量用 6 位有效數字顯示（最後框起來的答案仍是 5 位）：讀者把畫面上的數字照抄進計算機，
 * 算出來的結果四捨五入到 5 位後會和下一步顯示的數字一致，不會在第 5 位對不上。
 */
const t6 = (x: number): string => texNum(x, 6)
const t6P = (x: number): string => texNumP(x, 6)
/**
 * 「底數的 n 次方」：底數是負數或科學記號（a\times10^{b}）時加括號，
 * 否則會變成 -0.4^2（意思不對）或 10^{-5}^2（KaTeX 的 double superscript 錯誤）。
 */
const powTex = (base: string, n: number): string => (base.startsWith('-') || base.includes('^') ? `(${base})^${n}` : `${base}^${n}`)
/** 使用者輸入的數字照原樣顯示（最多 10 位），不要被 5 位有效數字四捨五入掉。 */
const tin = (x: number): string => texNum(x, 10)
const tinP = (x: number): string => texNumP(x, 10)

/** 「換一題」用的格點：lo … hi 之間 step 的倍數，只留下小數部分在 [fracLo, fracHi] 內的值（避開整數這類沒有東西可算的題目）。 */
function practiceGrid(lo: number, hi: number, step: number, fracLo: number, fracHi: number): number[] {
  const out: number[] = []
  const n = Math.round((hi - lo) / step)
  for (let i = 0; i <= n; i++) {
    const x = Number((lo + i * step).toFixed(6))
    const f = Number((x - Math.floor(x)).toFixed(6))
    if (f >= fracLo - 1e-9 && f <= fracHi + 1e-9) out.push(x)
  }
  return out
}

/** 百分比的顯示：小到只是浮點誤差時不印 3.7e-13 這種數字。 */
const pctTex = (x: number): string => (Math.abs(x) < 0.005 ? String.raw`\text{不到 }0.01` : texNum(x, 2))

/** w 的整數部分與小數部分：用模型的精確有理數格點計算（不會出現 32.4 − 32 = 0.3999…）。 */
function splitFrac(w: number): { lo: number; p: number; grid: Grid } {
  const grid = makeGrid(w, 'rational', 0)
  const lo = Math.floor(grid.W0 / grid.D)
  return { lo, p: (grid.W0 - lo * grid.D) / grid.D, grid }
}

/** (A) Freeze：y = Q_B(w*)，呼叫模型的 quantize()；saturated = 量化器飽和（超出 0 … 63）。 */
function freezeCode(w: number): { y: number; saturated: boolean } {
  const grid = makeGrid(w, 'rational', 0)
  const s = newState()
  const y = quantize(grid.W0, s, makeCtx(SETUP, grid, 'freeze', 1))
  return { y, saturated: s.overflow > 0 }
}

/** (B) Toggle：用模型的 toggleStep（整數運算，tie 不受浮點誤差影響）跑一個週期 L_t。 */
function togglePattern(w: number, L: number): { y: number[]; lo: number; p: number; h: number; saturated: boolean; grid: Grid } {
  const { lo, p, grid } = splitFrac(w)
  const ctx = makeCtx({ ...SETUP, togglePeriod: L }, grid, 'toggle', 1)
  const sim = simulateStrategy('toggle', new Float64Array(L).fill(grid.W0), ctx, { freezeW: grid.W0, integer: true })
  const y = Array.from(sim.y)
  return { y, lo, p, h: y.reduce((a, c) => a + (c - lo), 0), saturated: sim.overflow > 0, grid }
}

/** 分母不超過 MAX_DEN 的最簡分數；不是這種數就回傳 null。 */
function asFraction(x: number): { p: number; q: number } | null {
  if (!Number.isFinite(x)) return null
  const f = rationalApprox(x, MAX_DEN)
  return Math.abs(f.err) <= 1e-12 * Math.max(1, Math.abs(x)) ? { p: f.p, q: f.q } : null
}

/**
 * (D) 一階 EFB ΔΣ：用模型的 deltaSigmaStep（simulateStrategy）跑 steps 次。
 * 格點分母取 w_H 與 r[−1] 兩個分母的最小公倍數，所以兩者都精確（efbConstant() 只保證 w_H 精確）。
 */
function efbRun(wH: number, r0: number, rounding: RoundingMode, steps: number): { y: number[]; v: number[]; r: number[]; m: number; q: number; D: number; overflow: number } | null {
  const fw = asFraction(wH)
  const fr = asFraction(r0)
  if (!fw || !fr) return null
  const D = lcm(fw.q, fr.q)
  const W0 = fw.p * (D / fw.q)
  const grid: Grid = { arithmetic: 'rational', D, p: fw.p, q: fw.q, represented: fw.p / fw.q, W0, integer: true, notes: [] }
  const ctx = makeCtx({ ...SETUP, rounding }, grid, 'deltaSigma', 1)
  const sim = simulateStrategy('deltaSigma', new Float64Array(steps).fill(W0), ctx, { freezeW: W0, rInit: r0, integer: true })
  return { y: Array.from(sim.y), v: Array.from(sim.v), r: Array.from(sim.r), m: fw.p, q: fw.q, D, overflow: sim.overflow }
}

/** HC-13.7 的對照模擬：與章內 Lab／§13.4E 掃描表相同的 seed、長度與常數目標（測試會比對兩者逐位相同）。 */
export const DITHER_SIM = { seed: 20261010, length: 1 << 14, target: 32.4 } as const

/**
 * (E) 常數 w_H = 32.4 的 ΔΣ + RPDF dither（峰對峰 A LSB）：用模型的 deltaSigmaDitherStep 實際跑 2^14 次更新，
 * 回傳總誤差功率 mean((y − w_H)²) 與用到的 code 範圍。A = 0 時就是方法 D（limit cycle）。
 */
const ditherSimCache = new Map<number, { power: number; min: number; max: number }>()
function ditherSim(A: number): { power: number; min: number; max: number } {
  const hit = ditherSimCache.get(A)
  if (hit) return hit
  const grid = makeGrid(DITHER_SIM.target, 'rational', 0)
  const ctx = makeCtx({ ...SETUP, ditherLsb: A }, grid, 'deltaSigmaDither', DITHER_SIM.seed)
  const sim = simulateStrategy('deltaSigmaDither', new Float64Array(DITHER_SIM.length).fill(grid.W0), ctx, { freezeW: grid.W0, rInit: 0, integer: true })
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const yn of sim.y) {
    sum += (yn - DITHER_SIM.target) ** 2
    if (yn < min) min = yn
    if (yn > max) max = yn
  }
  const out = { power: sum / DITHER_SIM.length, min, max }
  if (ditherSimCache.size > 64) ditherSimCache.clear() // 使用者逐字輸入 A 時不讓快取無限長大
  ditherSimCache.set(A, out)
  return out
}

/** 小數位數（0 … max）；超過 max 位或不是有限小數回傳 −1。 */
function decimalsOf(x: number, max = 4): number {
  for (let d = 0; d <= max; d++) {
    const s = x * 10 ** d
    if (Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, Math.abs(s))) return d
  }
  return -1
}

/** 輾轉相除法的每一行（顯示用）：a = q·b + r。最大公因數本身仍由模型的 gcd() 給。 */
function euclidLines(a: number, b: number): string[] {
  const lines: string[] = []
  let x = Math.max(a, b)
  let y = Math.min(a, b)
  while (y !== 0) {
    const qd = Math.floor(x / y)
    const rem = x - qd * y
    lines.push(String.raw`${x}&=${qd}\times${y}+${rem}`)
    x = y
    y = rem
  }
  return lines
}

const listTex = (a: ArrayLike<number>): string => `[${Array.from(a).join(',')}]`

const TWO_LEVEL_MSG = String.raw`$w^*$ 必須在 $0\le w^*<63$：要在 $\lfloor w^*\rfloor$ 與 $\lfloor w^*\rfloor+1$ 兩個 code 之間切換，兩者都得落在 6-bit 的 $0\ldots63$ 內；超出時 code 會 saturate，平均就不再是 $w^*$（§13.6 的 overload）。`

/** 頻帶比 R = f_u/f_B 的適用範圍（低頻近似 sin θ ≈ θ 的誤差約 (π/R)²/5）。 */
const R_MIN = 16
const R_MSG = String.raw`$f_u/f_B$ 至少要 ${R_MIN}：頻帶內公式用了低頻近似 $\sin\theta\approx\theta$（$\theta=\pi f_B/f_u$），相對誤差約 $\theta^2/5$——$f_u/f_B=${R_MIN}$ 時是 $0.8\%$，降到 14 以下就超過 $1\%$；而且比 ${R_MIN} 小時「頻帶內」已經佔掉 Nyquist 頻寬的八分之一以上，不再是 $f_B\ll f_u$。`

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.1',
    title: 'Freeze：最近的 code、static error，再換成 fs',
    page: '/ch/13',
    formulaId: 'F-13.2',
    formulaTex: String.raw`\begin{gathered}y=Q_B(w^*)=\Big\lfloor w^*+\tfrac12\Big\rfloor,\qquad \delta w=y-w^*\;\;(\delta=a-w=-\delta w),\qquad E[\delta w^2]=(\delta w)^2\\[4pt]\delta w\,[\mathrm{fs}]=\Delta_\mathrm{LSB}\cdot\delta w\,[\mathrm{LSB}]\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w^*', label: 'LMS 收斂到的理想係數', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: practiceGrid(8, 56, 0.1, 0.1, 0.9) } },
      { key: 'lsb', symbol: String.raw`\Delta_\mathrm{LSB}`, label: '1 個 gain LSB 的 DTC gain', unit: String.raw`\mathrm{fs/LSB}`, default: 0.125, min: 0.001, max: 100, practice: { choices: [0.05, 0.1, 0.125, 0.2, 0.25, 0.5] } },
    ],
    validate: ({ w }) =>
      freezeCode(w).saturated
        ? String.raw`$w^*$ 超出 6-bit 量化器不飽和的範圍 $-\tfrac12\le w^*<63.5$：$Q_B$ 會卡在 0 或 63，誤差不再是 $|\delta w|\le\tfrac12$ 的 rounding 誤差（那是 §13.6 的 overload 問題）。請輸入範圍內的 $w^*$。`
        : null,
    solve: ({ w, lsb }) => {
      const { y } = freezeCode(w)
      const v = w + 0.5
      const dw = tidy(y - w)
      const pow = dw * dw
      const fs = mixWithResidue([dw], 1, [1], lsb)[0]
      const tie = Number.isInteger(v)
      return {
        steps: [
          { tex: String.raw`w^*+\tfrac12=${tin(w)}+0.5=${tin(v)}`, why: 'round-half-up 的第一步：先加半個 LSB。' },
          { tex: String.raw`y=\Big\lfloor w^*+\tfrac12\Big\rfloor=\lfloor ${tin(v)}\rfloor=${y}`, why: String.raw`取 floor（不大於它的最大整數）。這就是凍結在 6-bit register 裡的 code。${tie ? '這一題剛好是 tie（$x.5$）：round-half-up 往上進位。' : ''}` },
          { tex: String.raw`\delta w=y-w^*=${y}-${tinP(w)}=${texNum(dw)}\ \mathrm{LSB}`, why: String.raw`本章顯示用的約定 $\delta w=w-w^*$（規格 §12）：code 比理想值小就是負的。` },
          { tex: String.raw`\delta=a-w=w^*-y=${tin(w)}-${texNumP(y)}=${texNum(-dw)}\ \mathrm{LSB}`, why: String.raw`全站 §0 的約定 $\delta=a-w$（$a=w^*$、$w=y$）：同一個誤差，正負號相反（勘誤 E49）。` },
          { tex: String.raw`E[\delta w^2]=(\delta w)^2=${powTex(texNum(dw), 2)}=${texNum(pow)}\ \mathrm{LSB}^2`, why: '誤差是常數，平方平均就是它的平方；變異數為 0，全部功率都在 DC。' },
          { tex: String.raw`\delta w\cdot\Delta_\mathrm{LSB}=${texNumP(dw)}\times${tin(lsb)}=${texNum(fs)}\ \mathrm{fs}`, why: String.raw`乘上 $\Delta_\mathrm{LSB}$ 換成時間單位（勘誤 E13）：這是每單位 normalized code 的 DTC gain 誤差。` },
        ],
        results: [
          { symbol: 'y', label: '凍結的 6-bit code', value: y, tolerance: INT_TOL },
          { symbol: String.raw`\delta w`, label: String.raw`static error（$\delta w=w-w^*$ 約定）`, value: dw, unit: String.raw`\mathrm{LSB}` },
          { symbol: String.raw`E[\delta w^2]`, label: '誤差功率（全在 DC）', value: pow, unit: String.raw`\mathrm{LSB}^2` },
          { symbol: String.raw`\delta w\,\Delta_\mathrm{LSB}`, label: '換成時間', value: fs, unit: String.raw`\mathrm{fs}` },
        ],
        notes: [
          String.raw`$|\delta w|\le\tfrac12\,\mathrm{LSB}$ 一定成立，但它是常數：$\delta t[n]=\Delta_\mathrm{LSB}\,\delta w\,x[n]$ 就是 DSM residue $x[n]$ 的縮小版，residue 有什麼 spur，輸出就有同頻的 spur（§13.1）。`,
          String.raw`依 §0 的 $\delta=a-w$，這一題的答案是 $${texNum(-dw)}\ \mathrm{LSB}$；兩種約定平方後相同。`,
        ],
      }
    },
    tips: [
      String.raw`$\lfloor x\rfloor$ 是「不大於 $x$ 的最大整數」；round-half-up 就是「加 $0.5$ 再取 floor」，所以 $32.5\to33$。`,
      String.raw`範例數字（$w^*=32.4$、$\Delta_\mathrm{LSB}=0.125$）的答案：code 32、$\delta w=-0.4\,\mathrm{LSB}$、$0.16\,\mathrm{LSB}^2$、$-0.05\,\mathrm{fs}$（測試 T16）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.2',
    title: 'Toggle pattern：進位次數 $h$、停在上一階的時間比例與平均',
    page: '/ch/13',
    formulaId: 'F-13.3',
    formulaTex: String.raw`\begin{gathered}p=w^*-\lfloor w^*\rfloor,\quad h=\mathrm{round}(pL_t),\quad y[n']=\lfloor w^*\rfloor+\Big\lfloor\tfrac{(n'+1)h}{L_t}\Big\rfloor-\Big\lfloor\tfrac{n'h}{L_t}\Big\rfloor\\[4pt]\overline y=\lfloor w^*\rfloor+\frac{h}{L_t},\quad \overline{e^2}=\frac{h}{L_t}\Big(1-\frac{h}{L_t}\Big)+\big(\overline y-w^*\big)^2\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w^*', label: '理想係數', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: practiceGrid(10, 50, 0.05, 0.15, 0.85) } },
      { key: 'L', symbol: 'L_t', label: 'pattern 的週期（幾次更新重複一次）', default: 5, min: 2, max: 12, integer: true, practice: { choices: [4, 5, 8, 10] } },
    ],
    validate: ({ w, L }) => (w < 0 || togglePattern(w, L).saturated ? TWO_LEVEL_MSG : null),
    solve: ({ w, L }) => {
      const { y, lo, p, h, grid } = togglePattern(w, L)
      const frac = h / L
      const mean = lo + frac
      // DC 誤差用整數算：((lo·L + h)·D − W0·L)/(L·D)，剛好為 0 時就是 0
      const dc = ((lo * L + h) * grid.D - grid.W0 * L) / (L * grid.D)
      const ac = frac * (1 - frac)
      const pow = y.reduce((a, c) => a + (c - w) ** 2, 0) / L
      const pL = tidy(p * L)
      const tie = Number.isInteger(2 * pL) && !Number.isInteger(pL)
      const rows = y.map((_, m) => {
        const a = Math.floor(((m + 1) * h) / L)
        const b = Math.floor((m * h) / L)
        return String.raw`n'=${m}:&\quad\Big\lfloor\tfrac{${(m + 1) * h}}{${L}}\Big\rfloor-\Big\lfloor\tfrac{${m * h}}{${L}}\Big\rfloor=${a}-${b}=${a - b}&&\Rightarrow\;y=${lo + (a - b)}`
      })
      const period = togglePeriodOf(h, L)
      return {
        steps: [
          { tex: String.raw`p=w^*-\lfloor w^*\rfloor=${tin(w)}-${lo}=${tin(p)}`, why: String.raw`小數部分：平均要比 $\lfloor w^*\rfloor$ 多出多少。` },
          { tex: String.raw`p\,L_t=${tin(p)}\times${L}=${texNum(pL)}`, why: String.raw`一個週期 $L_t$ 次更新裡，「理想上」要進位幾次。` },
          { tex: String.raw`h=\mathrm{round}(pL_t)=\mathrm{round}(${texNum(pL)})=${h}`, why: String.raw`進位次數只能是整數，所以 pattern 的解析度是 $1/L_t$。${tie ? '這一題剛好是 tie（$x.5$）：round-half-up 往上取。' : ''}` },
          { tex: String.raw`\begin{aligned}${rows.join(String.raw`\\`)}\end{aligned}`, why: String.raw`Bresenham：把 $h$ 個「進位」盡量平均地撒在 $L_t$ 個位置；每一行是兩個 floor 相減（只會是 0 或 1）。` },
          { tex: String.raw`\frac{h}{L_t}=\frac{${h}}{${L}}=${texNum(frac, 8)}`, why: String.raw`code 停在上一階 $${lo + 1}$ 的時間比例（其餘 $${t6(tidy(1 - frac))}$ 的時間停在 $${lo}$）。${Number.isInteger(tidy(frac * 1000)) ? '' : '除不盡時多留幾位小數，下面相減才不會把有效位數減光。'}` },
          { tex: String.raw`\overline y=\lfloor w^*\rfloor+\frac{h}{L_t}=${lo}+${texNum(frac, 8)}=${texNum(mean, 10)}`, why: String.raw`一個週期的平均；也可以直接算 $\big(${L - h}\times${lo}+${h}\times${lo + 1}\big)/${L}$。` },
          { tex: String.raw`\overline y-w^*=${texNum(mean, 10)}-${tinP(w)}=${texNum(dc)}\ \mathrm{LSB}`, why: String.raw`DC 誤差（$\delta w=w-w^*$ 約定；$\delta=a-w$ 則反號）。只有 $pL_t$ 是整數時才剛好為 0，最壞是 $\tfrac1{2L_t}$。` },
          { tex: String.raw`\frac{h}{L_t}\Big(1-\frac{h}{L_t}\Big)=${texNum(frac, 8)}\times${texNum(tidy(1 - frac), 8)}=${t6(ac)}\ \mathrm{LSB}^2`, why: String.raw`只有兩階、相差 1 LSB 的序列，變異數（交流功率）就是「比例 $\times$（$1-{}$比例）」。` },
          { tex: String.raw`\overline{e^2}=${t6(ac)}+${powTex(texNum(dc), 2)}=${texNum(pow)}\ \mathrm{LSB}^2`, why: String.raw`總誤差功率 = 交流功率 + $\mathrm{DC}^2$。` },
        ],
        results: [
          { symbol: 'h', label: '一個週期的進位次數', value: h, tolerance: INT_TOL },
          { symbol: 'h/L_t', label: '停在上一階的時間比例', value: frac },
          { symbol: String.raw`\overline y`, label: '一個週期的平均 code', value: mean, unit: String.raw`\mathrm{LSB}`, digits: 6, tolerance: { abs: 1e-3, rel: 0 } },
          { symbol: String.raw`\overline y-w^*`, label: 'DC 誤差', value: dc, unit: String.raw`\mathrm{LSB}`, tolerance: { abs: 1e-4, rel: 0.01 } },
          { symbol: String.raw`\overline{e^2}`, label: '總誤差功率', value: pow, unit: String.raw`\mathrm{LSB}^2` },
        ],
        notes: [
          h === 0 || h === L
            ? String.raw`模型（$\texttt{toggleStep}$，整數運算）跑出的一個週期：$y=${listTex(y)}$——每一格都相同，code 根本不切換。`
            : String.raw`模型（$\texttt{toggleStep}$，整數運算）跑出的一個週期：$y=${listTex(y)}$，實際重複週期 $L_t/\gcd(h,L_t)=${period}$。`,
          h === 0 || h === L
            ? p === 0
              ? String.raw`$w^*$ 本身就是整數（$p=0$、$h=0$）：不需要切換，一直輸出 $${y[0]}$ 就完全正確。換一個有小數的 $w^*$ 才看得到 pattern。`
              : String.raw`$h=${h}$：$p$ 離整數不超過 $\tfrac1{2L_t}=${texNum(1 / (2 * L))}$，四捨五入後 pattern 退化成一直輸出 $${y[0]}$，等於方法 A 的 Freeze（static error $${texNum(dc)}\,\mathrm{LSB}$、沒有交流功率）。要表示這麼小的小數就得加長 $L_t$，或改用有誤差回授的 ΔΣ。`
            : dc === 0
            ? String.raw`$pL_t$ 是整數 $\Rightarrow$ 平均完全正確；但「平均正確 $\ne$ 頻譜理想」：這 $${texNum(ac)}\,\mathrm{LSB}^2$ 全部集中在 $k f_u/${period}$ 的譜線上（下一題）。`
            : String.raw`$pL_t$ 不是整數 $\Rightarrow$ 留下 $${texNum(dc)}\,\mathrm{LSB}$ 的 static error（上限 $\tfrac1{2L_t}=${texNum(1 / (2 * L))}$）；要更細就得加長 $L_t$，或改用有誤差回授的 ΔΣ。`,
        ],
      }
    },
    tips: [
      String.raw`floor 只看整數部分：$\lfloor 4/5\rfloor=0$、$\lfloor 6/5\rfloor=1$、$\lfloor 10/5\rfloor=2$。`,
      String.raw`檢查：表中 1 的個數一定等於 $h$（相鄰項伸縮相消）。`,
      String.raw`範例（$w^*=32.4$、$L_t=5$）：$h=2$、pattern $[32,32,33,32,33]$、平均 $32.4$、總功率 $0.24\,\mathrm{LSB}^2$（測試 T16）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.3',
    title: '週期 5 pattern 的譜線：複數 DFT 分實部／虛部算，再乘 ZOH 的 $\\mathrm{sinc}^2$ 權重',
    page: '/ch/13',
    formulaId: 'F-13.4',
    formulaTex: String.raw`\begin{gathered}c_k=\frac15\sum_{n=0}^{4}e[n]\,e^{-j2\pi kn/5}=\frac15\big(e^{-j\theta_a}+e^{-j\theta_b}\big),\qquad\theta_{a,b}=\frac{360^\circ\,k\,n_{a,b}}{5},\qquad P_k=2|c_k|^2\\[4pt] P_k^{\mathrm{ZOH}}=P_k\,G_k^2,\qquad G_k=\frac{\sin(\pi k/5)}{N_h\sin\big(\pi k/(5N_h)\big)}\end{gathered}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'na', symbol: 'n_a', label: String.raw`其中一個 33 的位置（一個週期內 $0\ldots4$）`, default: 2, min: 0, max: 4, integer: true, practice: { choices: [0, 1, 2, 3] } },
      { key: 'nb', symbol: 'n_b', label: String.raw`另一個 33 的位置（$0\ldots4$，不能和 $n_a$ 相同）`, default: 4, min: 0, max: 4, integer: true, practice: { choices: [1, 2, 3, 4] } },
      { key: 'k', symbol: 'k', label: '第幾條譜線（頻率 $k f_u/5$）', default: 2, min: 1, max: 12, integer: true, practice: { choices: [1, 2, 3, 4] } },
      { key: 'Nh', symbol: 'N_h', label: '每個 code 保持幾個 reference cycle（1 = 不保持）', default: 64, min: 1, max: 4096, integer: true, practice: { choices: [2, 4, 8, 16, 64] } },
    ],
    validate: ({ na, nb, k, Nh }) => {
      if (na === nb) return String.raw`$n_a$ 與 $n_b$ 不能相同：一個週期 5 個位置裡要有兩個不同的位置輸出 33，平均才是 $32.4$（$p=\tfrac25$）。`
      if (k % 5 === 0) return String.raw`$k$ 是 5 的倍數時沒有東西可算：$c_0$ 是平均誤差（這個 pattern 為 0），而 $k=5,10,\dots$ 剛好是 ZOH 的零點 $\sin(\pi k/5)=0$。請選不是 5 的倍數的 $k$。`
      if (2 * k >= 5 * Nh) return String.raw`one-sided 頻譜只到 $f_s/2$，也就是 $k<5N_h/2=${texNum((5 * Nh) / 2)}$；更高的 $k$ 是鏡像（$k\to5N_h-k$）。$N_h=1$（不保持）時只有 $k=1,2$ 兩條獨立譜線。`
      return null
    },
    solve: ({ na, nb, k, Nh }) => {
      // 誤差序列 e[n] = y[n] − w*：兩個位置是 +0.6，其餘 −0.4（平均 0）
      const e = Array.from({ length: 5 }, (_, n) => (n === na || n === nb ? 1 : 0) - 0.4)
      const ls = lineSpectrum(e)
      const km = mod(k, 5)
      const line = ls[km <= 2 ? km : 5 - km]
      const mag = line.mag
      const Pk = line.power
      const g2 = zohGain2(k, 5, Nh)
      const Pz = Pk * g2
      const ang = (n: number) => 72 * mod(k * n, 5)
      const cosd = (d: number) => Math.cos((d * Math.PI) / 180)
      const sind = (d: number) => Math.sin((d * Math.PI) / 180)
      const [ta, tb] = [ang(na), ang(nb)]
      const [ca, cb, sa, sb] = [tidy(cosd(ta)), tidy(cosd(tb)), tidy(sind(ta)), tidy(sind(tb))]
      const sumC = tidy(ca + cb)
      const sumS = tidy(sa + sb)
      const re = tidy(sumC / 5)
      const im = tidy(-sumS / 5)
      const mag2 = mag * mag
      const numDeg = 36 * k
      const denDeg = (36 * k) / Nh
      const num = tidy(sind(numDeg))
      const den = Nh * sind(denDeg)
      const G = num / den
      const angTex = (s: string, n: number) => {
        const full = 72 * k * n
        const red = ang(n)
        return String.raw`\theta_${s}=\frac{360^\circ\,k\,n_${s}}{5}=72^\circ\times${k}\times${n}=${full}^\circ${full !== red ? String.raw`\equiv${red}^\circ\pmod{360^\circ}` : ''}`
      }
      /** 72° 的倍數怎麼從 72°、144° 兩個角度查出來。 */
      const lookupHint = (d: number): string =>
        d === 0
          ? String.raw`$0^\circ$：$\cos=1$、$\sin=0$`
          : d === 216
            ? String.raw`$216^\circ=360^\circ-144^\circ$：$\cos$ 和 $144^\circ$ 相同、$\sin$ 變號`
            : d === 288
              ? String.raw`$288^\circ=360^\circ-72^\circ$：$\cos$ 和 $72^\circ$ 相同、$\sin$ 變號`
              : String.raw`$${d}^\circ$ 直接查「手算提示」的表`
      const trigTex = (s: string, d: number, c: number, sn: number) => String.raw`\cos\theta_${s}=\cos${d}^\circ=${t6(c)},\qquad\sin\theta_${s}=\sin${d}^\circ=${t6(sn)}`
      const main = ls[2].power >= ls[1].power ? 2 : 1
      const ratioDb = 10 * Math.log10(ls[main].power / ls[3 - main].power)
      return {
        steps: [
          { tex: angTex('a', na), why: String.raw`其中一個 33（$n=n_a$）在第 $k$ 條線上的相位角；$\cos$、$\sin$ 以 $360^\circ$ 為週期，可以先減掉整圈。` },
          { tex: angTex('b', nb), why: String.raw`另一個 33 的相位角。常數 $-0.4$ 那一部分對不是 5 的倍數的 $k$ 沒有貢獻（等比級數和為 0），所以只剩這兩項。` },
          { tex: trigTex('a', ta, ca, sa), why: String.raw`查表或按計算機（DEG 模式）。${lookupHint(ta)}。` },
          { tex: trigTex('b', tb, cb, sb), why: String.raw`${lookupHint(tb)}。` },
          {
            tex: String.raw`\mathrm{Re}\,c_k=\frac{\cos\theta_a+\cos\theta_b}{5}=\frac{${t6(ca)}+${t6P(cb)}}{5}=\frac{${t6(sumC)}}{5}=${t6(re)}`,
            why: String.raw`實部：$e^{-j\theta}=\cos\theta-j\sin\theta$ 的 $\cos$ 部分相加，再除以 5。`,
          },
          {
            tex: String.raw`\mathrm{Im}\,c_k=-\frac{\sin\theta_a+\sin\theta_b}{5}=-\frac{${t6(sa)}+${t6P(sb)}}{5}=-\frac{${t6(sumS)}}{5}=${t6(im)}`,
            why: String.raw`虛部：$\sin$ 部分相加、除以 5，再變號。實部、虛部分開算就不需要複數計算機。`,
          },
          { tex: String.raw`|c_k|^2=(\mathrm{Re}\,c_k)^2+(\mathrm{Im}\,c_k)^2=${powTex(t6(re), 2)}+${powTex(t6(im), 2)}=${t6(mag2)}`, why: '複數大小的平方等於實部平方加虛部平方。' },
          { tex: String.raw`|c_k|=\sqrt{${t6(mag2)}}=${t6(mag)}\ \mathrm{LSB}`, why: String.raw`開根號（$\sqrt{x}$ 鍵）。這條線在時域是振幅（peak）$2|c_k|=${texNum(2 * mag)}\,\mathrm{LSB}$ 的弦波。` },
          { tex: String.raw`P_k=2|c_k|^2=2\times${t6(mag2)}=${t6(Pk)}\ \mathrm{LSB}^2`, why: String.raw`實數序列的 $c_{5-k}=\overline{c_k}$：正負頻率合成一條 one-sided 譜線，功率乘 2。` },
          { tex: String.raw`\sin\frac{\pi k}{5}=\sin(36^\circ\times${k})=\sin${numDeg}^\circ=${t6(num)}`, why: String.raw`ZOH 權重的分子（$\pi/5=36^\circ$）。` },
          {
            tex: String.raw`N_h\sin\frac{\pi k}{5N_h}=${Nh}\times\sin\!\Big(\frac{${numDeg}^\circ}{${Nh}}\Big)=${Nh}\times\sin${t6(denDeg)}^\circ=${Nh}\times${texNum(sind(denDeg), 7)}=${t6(den)}`,
            why: String.raw`分母：先把角度除以 $N_h$、取 $\sin$、再乘回 $N_h$。$N_h$ 夠大時它趨近 $\pi k/5=${t6((Math.PI * k) / 5)}\ \mathrm{rad}$（小角度 $\sin x\approx x$，$x$ 以 rad 計）。`,
          },
          { tex: String.raw`G_k=\frac{\sin(\pi k/5)}{N_h\sin\big(\pi k/(5N_h)\big)}=\frac{${t6(num)}}{${t6(den)}}=${t6(G)}`, why: String.raw`相除：這是離散 $\mathrm{sinc}$（振幅權重）${Nh === 1 ? '；$N_h=1$ 沒有保持，權重恰為 1' : ''}。` },
          { tex: String.raw`G_k^2=${powTex(t6(G), 2)}=${t6(g2)}`, why: String.raw`線功率看的是振幅的平方，所以權重也要平方（$\mathrm{sinc}^2$）。` },
          { tex: String.raw`P_k^{\mathrm{ZOH}}=P_k\,G_k^2=${t6(Pk)}\times${t6(g2)}=${texNum(Pz)}\ \mathrm{LSB}^2`, why: String.raw`code 以 ZOH 保持到 $f_s=N_hf_u$ 之後，這條線（$f=${k}f_u/5=${k}f_s/${5 * Nh}$）剩下的功率。` },
        ],
        results: [
          { symbol: '|c_k|', label: '傅立葉係數的大小', value: mag, unit: String.raw`\mathrm{LSB}` },
          { symbol: 'P_k', label: '以 $f_u$ 取樣時的線功率', value: Pk, unit: String.raw`\mathrm{LSB}^2` },
          { symbol: 'G_k^2', label: String.raw`ZOH 的 $\mathrm{sinc}^2$ 權重`, value: g2 },
          { symbol: String.raw`P_k^{\mathrm{ZOH}}`, label: '保持後的線功率', value: Pz, unit: String.raw`\mathrm{LSB}^2` },
        ],
        notes: [
          String.raw`這個排列的兩條基頻線（模型的精確 DFT）：$P_1=${texNum(ls[1].power)}$、$P_2=${texNum(ls[2].power)}\ \mathrm{LSB}^2$，$P_1+P_2=${texNum(ls[1].power + ls[2].power)}=p(1-p)$（Parseval，$p=\tfrac25$）。主線在 $${main === 2 ? '2f_u/5' : 'f_u/5'}$，比另一條高 $${texNum(ratioDb, 3)}\ \mathrm{dB}$。`,
          km > 2
            ? String.raw`$k=${k}$ 在以 $f_u$ 取樣時是 $k=${5 - km}$ 的鏡像（$|c_{${k}}|=|c_{${5 - km}}|$）；保持到 $f_s$ 之後它才變成一條獨立的譜線。`
            : String.raw`把 $k$ 換成另一條（1 或 2）再算一次，兩條的 $P_k$ 加起來一定是 $0.24\,\mathrm{LSB}^2$。`,
          String.raw`循環移位（$n_a,n_b$ 同加一個數）只改變相位、不改變 $|c_k|$；兩個 33 相鄰（例如 $n_a=3,n_b=4$）才會把功率搬到 $f_u/5$（勘誤 E47）。`,
        ],
      }
    },
    tips: [
      String.raw`$72^\circ$ 的倍數只有五個角度，可以直接查：$\cos72^\circ=\tfrac{\sqrt5-1}{4}=0.309017$、$\cos144^\circ=-\tfrac{\sqrt5+1}{4}=-0.809017$、$\sin72^\circ=0.951057$、$\sin144^\circ=0.587785$；$216^\circ=360^\circ-144^\circ$、$288^\circ=360^\circ-72^\circ$（$\cos$ 相同、$\sin$ 變號）。`,
      String.raw`複數不用一次算：先算實部、再算虛部，最後 $|c|^2=\mathrm{Re}^2+\mathrm{Im}^2$。`,
      String.raw`小角度的 $\sin$ 要用計算機（DEG 模式直接輸入角度）。$N_h$ 很大時 $N_h\sin\tfrac{\pi k}{5N_h}\approx\tfrac{\pi k}{5}$，所以 $G_k\approx\dfrac{\sin(\pi k/5)}{\pi k/5}$，也就是連續時間的 $\mathrm{sinc}(k/5)$；$G_k^2$ 的相對誤差約 $\big(\tfrac{\pi k}{5N_h}\big)^2/3$：$k=2$、$N_h=64$ 時只有 $0.013\%$，$k=4$、$N_h=8$ 時已有 $3\%$，那時就要照式子算。`,
      String.raw`答案顯示 5 位有效數字，步驟裡的中間量多留一位（6 位）：手算時中間量也多留一兩位，最後再四捨五入。`,
      String.raw`範例（$[32,32,33,32,33]$、$k=2$、$N_h=64$）：$|c_2|=\tfrac{\sqrt5+1}{10}=0.32361$、$P_2=0.20944$、$P_2^{\mathrm{ZOH}}=0.11998\,\mathrm{LSB}^2$（測試 T16）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.4',
    title: 'Stochastic rounding：平均、變異數、RMS、白色 PSD 高度與平均的收斂',
    page: '/ch/13',
    formulaId: 'F-13.6',
    formulaTex: String.raw`\begin{gathered}p=w^*-\lfloor w^*\rfloor,\qquad E[y]=\lfloor w^*\rfloor+p,\qquad \mathrm{Var}(y)=p(1-p),\qquad \sigma_y=\sqrt{p(1-p)}\\[4pt]S_e^{(1)}(f)=\frac{2p(1-p)}{f_u},\qquad \sigma_{\bar y}=\frac{\sigma_y}{\sqrt N}\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w^*', label: '理想係數', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: practiceGrid(10, 50, 0.05, 0.05, 0.95) } },
      { key: 'fu', symbol: 'f_u', label: 'code 更新率', unit: String.raw`\mathrm{Hz}`, default: 1e6, min: 1, max: 1e11, practice: { choices: [1e5, 1e6, 2e6, 1e7, 1e8] } },
      { key: 'N', symbol: 'N', label: '拿來平均的獨立樣本數', default: 1024, min: 1, max: 1e9, integer: true, practice: { choices: [16, 64, 100, 256, 1024, 4096] } },
    ],
    validate: ({ w }) => (w < 0 || w >= MAX_CODE ? TWO_LEVEL_MSG : null),
    solve: ({ w, fu, N }) => {
      const { lo, p } = splitFrac(w)
      const m = bernoulliMoments(lo, p)
      const psd = (2 * m.variance) / fu
      const sqrtN = Math.sqrt(N)
      const meanRms = Math.sqrt(m.variance / N)
      return {
        steps: [
          { tex: String.raw`p=w^*-\lfloor w^*\rfloor=${tin(w)}-${lo}=${tin(p)}`, why: String.raw`輸出上一階 $${lo + 1}$ 的機率（每次獨立擲一枚偏心硬幣）。` },
          { tex: String.raw`E[y]=\lfloor w^*\rfloor+p=${lo}+${tin(p)}=${texNum(m.mean)}`, why: String.raw`期望值 $=(1-p)\times${lo}+p\times${lo + 1}$，展開就是 $\lfloor w^*\rfloor+p$：平均一定對。` },
          { tex: String.raw`1-p=1-${tin(p)}=${texNum(1 - p)}`, why: String.raw`輸出下一階 $${lo}$ 的機率。` },
          { tex: String.raw`\mathrm{Var}(y)=p(1-p)=${tin(p)}\times${texNum(1 - p)}=${t6(m.variance)}\ \mathrm{LSB}^2`, why: String.raw`Bernoulli 的變異數（$E[X^2]-E[X]^2=p-p^2$）；加上常數 $\lfloor w^*\rfloor$ 不改變變異數。` },
          { tex: String.raw`\sigma_y=\sqrt{${t6(m.variance)}}=${t6(m.rms)}\ \mathrm{LSB}`, why: String.raw`RMS code noise：按計算機的 $\sqrt{x}$ 鍵。` },
          { tex: String.raw`S_e^{(1)}=\frac{2\,\mathrm{Var}(y)}{f_u}=\frac{2\times${t6(m.variance)}}{${tin(fu)}}=${texNum(psd)}\ \mathrm{LSB^2/Hz}`, why: String.raw`每次獨立 $\Rightarrow$ 白雜訊：總功率平均攤在 $0\ldots f_u/2$，one-sided 高度 $=\mathrm{Var}\div(f_u/2)$。` },
          { tex: String.raw`\sqrt N=\sqrt{${plain(N)}}=${t6(sqrtN)}`, why: String.raw`$N$ 個獨立樣本平均的變異數是 $\mathrm{Var}/N$，標準差就要除以 $\sqrt N$。` },
          { tex: String.raw`\sigma_{\bar y}=\frac{\sigma_y}{\sqrt N}=\frac{${t6(m.rms)}}{${t6(sqrtN)}}=${texNum(meanRms)}\ \mathrm{LSB}`, why: String.raw`平均值的 RMS 誤差：只以 $1/\sqrt N$ 變小（toggle 與 ΔΣ 是確定性的 $1/N$）。` },
        ],
        results: [
          { symbol: 'E[y]', label: '平均 code', value: m.mean, unit: String.raw`\mathrm{LSB}`, digits: 6, tolerance: { abs: 1e-3, rel: 0 } },
          { symbol: String.raw`\mathrm{Var}(y)`, label: '變異數（總誤差功率）', value: m.variance, unit: String.raw`\mathrm{LSB}^2` },
          { symbol: String.raw`\sigma_y`, label: 'RMS code noise', value: m.rms, unit: String.raw`\mathrm{LSB}` },
          { symbol: String.raw`S_e^{(1)}`, label: 'one-sided PSD 高度', value: psd, unit: String.raw`\mathrm{LSB^2/Hz}` },
          { symbol: String.raw`\sigma_{\bar y}`, label: '$N$ 個樣本平均的 RMS 誤差', value: meanRms, unit: String.raw`\mathrm{LSB}` },
        ],
        notes: [
          String.raw`$p(1-p)$ 與 toggle 的總功率完全相同（任何只用兩階、平均正確的方案都是它）；差別只在頻譜：這裡是平的，toggle 是兩條譜線。`,
          String.raw`驗算：$S_e^{(1)}\times\tfrac{f_u}{2}=${texNum(psd * (fu / 2))}=\mathrm{Var}(y)$。`,
          p > 0
            ? String.raw`前提是每次「獨立」。硬體用 $N_p$-bit PRBS 時 $P(y=${lo + 1})=\dfrac{\lceil p\,2^{N_p}\rceil-1}{2^{N_p}-1}$，不剛好是 $p$，而且每 $2^{N_p}-1$ 次重複（§13.3 的警告）。`
            : String.raw`這一題 $w^*$ 是整數：$p=0$，每次都輸出 $${lo}$，沒有任何 code noise。換一個有小數的 $w^*$ 才看得到 $p(1-p)$。`,
        ],
      }
    },
    tips: [
      String.raw`$p(1-p)$ 最大是 $p=0.5$ 時的 $0.25$；不用計算機也能估根號：$0.49^2=0.2401$，所以 $\sqrt{0.24}\approx0.49$。`,
      String.raw`$\sqrt N$ 選完全平方數最好算：$\sqrt{1024}=32$、$\sqrt{4096}=64$。`,
      String.raw`範例（$w^*=32.4$）：$E[y]=32.4$、$\mathrm{Var}=0.24\,\mathrm{LSB}^2$、$\sigma_y=0.490\,\mathrm{LSB}$（測試 T17）；$f_u=1\,\mathrm{MHz}$ 時 $S_e^{(1)}=4.8\times10^{-7}\,\mathrm{LSB^2/Hz}$。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.5',
    title: `一階 ΔΣ（Error Feedback）手算 ${EFB_STEPS} 列：$v$、$y$、$r$ 的表`,
    page: '/ch/13',
    formulaId: 'F-13.7',
    formulaTex: String.raw`\begin{gathered}v[n]=w_H+r[n-1],\qquad y[n]=Q_B\big(v[n]\big),\qquad r[n]=v[n]-y[n]\\[4pt]\Rightarrow\;\;y[n]=w_H+r[n-1]-r[n],\qquad\sum_{n=0}^{N-1}\big(y[n]-w_H\big)=r[-1]-r[N-1]\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'wH', symbol: 'w_H', label: '內部高解析係數（常數）', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: [32.4, 32.25, 32.6, 32.2, 32.75, 32.5, 20.4, 40.8, 12.375, 31.3] } },
      { key: 'r0', symbol: 'r[-1]', label: '誤差暫存器的初始值', unit: String.raw`\mathrm{LSB}`, default: 0, min: -100, max: 100, practice: { choices: [0, 0, 0.25, -0.25, 0.5, 0.1, -0.3] } },
      { key: 'mode', symbol: String.raw`\mathrm{mode}`, label: String.raw`量化方式：0 = round-half-up $\lfloor v+\tfrac12\rfloor$，1 = floor $\lfloor v\rfloor$`, default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 0, 1] } },
    ],
    validate: ({ wH, r0 }) => {
      if (wH < 1 || wH > MAX_CODE - 1) return String.raw`請輸入 $1\le w_H\le62$：$v=w_H+r$ 會比 $w_H$ 多或少最多 1 LSB，超出時 code 會 saturate 在 0 或 63，$r$ 就不再有界（例如 $w_H=63.3$ 跑 1000 次後 $|r|=300$，勘誤 E15 的 overload），手算表的結論全部不成立。`
      if (Math.abs(r0) > 1) return String.raw`請輸入 $|r[-1]|\le1$：正常運作時 $r$ 只會落在 $[-\tfrac12,\tfrac12)$（round-half-up）或 $[0,1)$（floor）；更大的初始值代表暫存器已經 windup，第一列就可能飽和。`
      if (!asFraction(wH) || !asFraction(r0)) return String.raw`$w_H$ 與 $r[-1]$ 請輸入分母不超過 ${MAX_DEN} 的有理數（例如 $32.4$、$32.25$、$0.125$）：一階 ΔΣ 的手算要用精確的分數，$v$ 剛好落在 $x.5$（tie）時才不會被捨入誤差騙到（勘誤 E15）。`
      return null
    },
    solve: ({ wH, r0, mode }) => {
      const rounding: RoundingMode = mode === 1 ? 'floor' : 'nearest'
      const run = efbRun(wH, r0, rounding, EFB_STEPS)
      if (!run) throw new Error(String.raw`$w_H$ 或 $r[-1]$ 不是分母 $\le${MAX_DEN}$ 的有理數`)
      const { y, v, r, m, q } = run
      const lo = Math.floor(m / q)
      const steps: HandCalcStep[] = y.map((yn, n) => {
        const rPrev = n === 0 ? r0 : r[n - 1]
        const tie = rounding === 'nearest' && Number.isInteger(tidy(v[n] + 0.5))
        const qLine =
          rounding === 'nearest'
            ? String.raw`y[${n}]&=\big\lfloor v[${n}]+\tfrac12\big\rfloor=\lfloor ${tin(tidy(v[n] + 0.5))}\rfloor=${yn}`
            : String.raw`y[${n}]&=\lfloor v[${n}]\rfloor=\lfloor ${tin(tidy(v[n]))}\rfloor=${yn}`
        return {
          tex: String.raw`\begin{aligned}v[${n}]&=w_H+r[${n - 1}]=${tin(wH)}+${tinP(tidy(rPrev))}=${tin(tidy(v[n]))}\\ ${qLine}\\ r[${n}]&=v[${n}]-y[${n}]=${tin(tidy(v[n]))}-${yn}=${tin(tidy(r[n]))}\end{aligned}`,
          why:
            (n === 0 ? String.raw`第 0 列：把上一次欠下的 $r[-1]$ 加回來 $\to$ 量化成整數 code $\to$ 記下這次的誤差 $r[0]$。` : String.raw`第 ${n} 列：同樣三步，用上一列的 $r[${n - 1}]$。`) +
            (tie
              ? String.raw`這一列是 tie（$v$ 剛好是 $x.5$）：round-half-up 進位到 $${yn}$。`
              : yn > lo
                ? String.raw`累積的小數夠了 $\to$ 進位，輸出 $${yn}$。`
                : yn === lo
                  ? String.raw`還沒累積到門檻 $\to$ 輸出 $${yn}$。`
                  : String.raw`$r[${n - 1}]$ 是負的而且夠大（之前多給了）$\to$ 這次少給一階，輸出 $${yn}$。`),
        }
      })
      const sum = y.reduce((a, c) => a + c, 0)
      const sumErr = tidy(sum - EFB_STEPS * wH)
      const rLast = tidy(r[EFB_STEPS - 1])
      const tele = tidy(r0 - rLast)
      const meanErr = tidy(tele / EFB_STEPS)
      steps.push(
        { tex: String.raw`\sum_{n=0}^{${EFB_STEPS - 1}}y[n]=${y.join('+')}=${sum}`, why: '把表中的六個 code 加起來。' },
        { tex: String.raw`\sum_{n=0}^{${EFB_STEPS - 1}}\big(y[n]-w_H\big)=${sum}-${EFB_STEPS}\times${tin(wH)}=${tin(sumErr)}`, why: String.raw`六列的累積誤差：減掉 $${EFB_STEPS}\,w_H$。` },
        { tex: String.raw`r[-1]-r[${EFB_STEPS - 1}]=${tin(r0)}-${tinP(rLast)}=${tin(tele)}\,\checkmark`, why: String.raw`Telescoping：$y[n]-w_H=r[n-1]-r[n]$ 相加後相鄰項抵消，只剩頭尾——和上一步的數字一樣。` },
        { tex: String.raw`\frac1{${EFB_STEPS}}\sum\big(y[n]-w_H\big)=\frac{${tin(tele)}}{${EFB_STEPS}}=${texNum(meanErr)}\ \mathrm{LSB}`, why: String.raw`平均誤差 $=(r[-1]-r[N-1])/N$：$r$ 有界，所以以 $1/N$ 變小——ΔΣ 的平均一定追得上 $w_H$。` },
      )
      // 第 0 列是不是暫態：直接比對模型多跑幾列的結果（第 q 列與第 0 列），不靠公式。
      // r[−1] 在穩態範圍外（round-half-up：[−½, ½)；floor：[0, 1)）時，第 0 列是暫態，從第 1 列起才以 q 為週期。
      const chk = efbRun(wH, r0, rounding, q + 2)
      const transient = !chk || chk.y[q] !== chk.y[0] || tidy(chk.r[q] - chk.r[0]) !== 0
      const repeatNote = transient
        ? String.raw`。這一題的 $r[-1]=${tin(r0)}$ 不在穩態範圍 $${rounding === 'nearest' ? String.raw`[-\tfrac12,\tfrac12)` : '[0,1)'}$ 內，第 0 列是暫態（最多 1 個 sample）；從第 1 列起才以 ${q} 為週期${q + 1 < EFB_STEPS ? `（表中第 ${q + 1} 列和第 1 列相同）` : `（要算到第 ${q + 1} 列才會和第 1 列相同）`}。`
        : q === 1
          ? String.raw`：$w_H$ 是整數，$r$ 不再改變，每一列都相同。`
          : q < EFB_STEPS
            ? String.raw`：表中第 ${q} 列（$n=${q}$）和第 0 列完全相同，之後照樣重複。`
            : String.raw`：這張表只有 ${EFB_STEPS} 列，要算到第 ${q} 列才會回到第 0 列的數字。`
      const notes = [
        String.raw`輸出序列 $y=${listTex(y)}$，$r=[${r.map((x) => tin(tidy(x))).join(',\\,')}]$。`,
        String.raw`$w_H=\tfrac{${m}}{${q}}$（最簡分數）$\Rightarrow$ limit cycle 的週期必為 $q=${q}$（任何初始 $r$ 皆然，勘誤 E15）${repeatNote}`,
      ]
      if (q >= 2 && q <= 12) {
        // 穩態的一個週期（跳過最多 1 個 sample 的暫態）與方法 B 的 pattern 比較：兩者都由模型的整數運算產生
        const long = efbRun(wH, r0, rounding, 3 * q)
        const patt = togglePattern(wH, q).y
        const shift = long ? isRotation(long.y.slice(q, 2 * q), patt) : -1
        notes.push(
          shift === 0
            ? String.raw`穩態的一個週期（$n=${q}\ldots${2 * q - 1}$）$${listTex(long!.y.slice(q, 2 * q))}$ 和方法 B（$L_t=${q}$）的 pattern 逐點相同：對常數輸入，ΔΣ 與 toggle 是同一個循環，頻譜也一樣。`
            : shift > 0
              ? String.raw`穩態的一個週期（$n=${q}\ldots${2 * q - 1}$）$${listTex(long!.y.slice(q, 2 * q))}$ 是方法 B（$L_t=${q}$）的 pattern $${listTex(patt)}$ 的循環移位（移 ${shift} 格）：對常數輸入，ΔΣ 與 toggle 是同一個循環，頻譜也一樣。`
            : String.raw`穩態的一個週期 $${long ? listTex(long.y.slice(q, 2 * q)) : ''}$ 與方法 B 的 pattern $${listTex(patt)}$ 不是循環移位。`,
        )
      }
      return {
        steps,
        results: [
          { symbol: String.raw`\sum_{n=0}^{${EFB_STEPS - 1}}y[n]`, label: '六個 code 的和（整張表對了，它才會對）', value: sum, tolerance: INT_TOL },
          { symbol: String.raw`r[${EFB_STEPS - 1}]`, label: '最後一列的誤差', value: rLast, unit: String.raw`\mathrm{LSB}`, tolerance: { abs: 1e-3, rel: 0.01 } },
          { symbol: String.raw`\tfrac1{${EFB_STEPS}}\textstyle\sum(y[n]-w_H)`, label: '六列的平均誤差', value: meanErr, unit: String.raw`\mathrm{LSB}`, tolerance: { abs: 1e-3, rel: 0.01 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`畫一張四欄的表（$n$、$v$、$y$、$r$），每一列只有一次加法、一次取整、一次減法。`,
      String.raw`用分數算最保險：$32.4=\tfrac{162}{5}$，$r$ 永遠是 $\tfrac15$ 的倍數；$v$ 剛好是 $x.5$ 時 round-half-up 一律進位。`,
      String.raw`範例（$w_H=32.4$、$r[-1]=0$、round-half-up）：$y=[32,33,32,33,32,32]$、$r=[0.4,-0.2,0.2,-0.4,0,0.4]$；改成 floor（mode = 1）得到 $[32,32,33,32,33,32]$，和方法 B 逐點相同（測試 T16、勘誤 E15）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.6',
    title: 'Limit cycle 的週期：精確分數 $m/q$ 與 $F$ 個小數 bit 的定點',
    page: '/ch/13',
    formulaId: 'F-13.8',
    formulaTex: String.raw`w_H=\frac mq\;(\gcd(m,q)=1)\Rightarrow\text{period}=q;\qquad K=\mathrm{round}\big(w_H\,2^F\big),\quad\text{period}_F=\frac{2^F}{\gcd\big(K\bmod2^F,\;2^F\big)}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'wH', symbol: 'w_H', label: '想要的常數係數（十進位小數）', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: [32.4, 32.3, 32.25, 32.375, 32.6, 20.2, 40.7, 12.75, 33.3, 45.5] } },
      { key: 'F', symbol: 'F', label: 'accumulator 的小數位元數', unit: String.raw`\mathrm{bit}`, default: 10, min: 1, max: 16, integer: true, practice: { choices: [3, 4, 5, 6, 8, 10] } },
    ],
    validate: ({ wH }) => {
      if (wH < 0 || wH > MAX_CODE) return String.raw`請輸入 $0\le w_H\le63$：超出 6-bit 範圍時 ΔΣ 會 overload，$r$ 不再有界，也就沒有「limit cycle 週期」可言（§13.6）。`
      if (decimalsOf(wH) < 0) return String.raw`請輸入最多 4 位小數的 $w_H$（例如 $32.4$、$32.375$）：這一題要先把小數寫成分數 $\tfrac{\text{整數}}{10^d}$ 再約分。`
      return null
    },
    solve: ({ wH, F }) => {
      // (A) 精確分數：小數 → 分數 → 約分
      const d = decimalsOf(wH)
      const den = 10 ** d
      const num = Math.round(wH * den)
      const g10 = gcd(num, den)
      const m = num / g10
      const q = den / g10
      const periodExact = efbPeriod(m, q)
      // (B) 定點：K = round(w_H·2^F)（模型的 makeGrid），週期 2^F/gcd
      const grid = makeGrid(wH, 'fixed', F)
      const D = grid.D
      const K = grid.W0
      const f = mod(K, D)
      const g = f === 0 ? D : gcd(f, D)
      const periodF = efbPeriod(K, D)
      let twos = 0
      let odd = f
      while (odd > 0 && odd % 2 === 0) {
        odd /= 2
        twos++
      }
      const steps: HandCalcStep[] = []
      if (d === 0) {
        steps.push({ tex: String.raw`w_H=${plain(wH)}=\frac{${num}}{1}\;\Rightarrow\;q=1`, why: String.raw`$w_H$ 本身就是整數：不需要切換，每次都輸出同一個 code（週期 1）。` })
      } else {
        const lines = euclidLines(num, den)
        steps.push(
          { tex: String.raw`w_H=${plain(wH)}=\frac{${num}}{${den}}`, why: String.raw`小數點後有 ${d} 位 $\Rightarrow$ 分子分母同乘 $10^{${d}}$，先寫成整數的比。` },
          { tex: String.raw`\begin{aligned}${lines.join(String.raw`\\`)}\end{aligned}\qquad\Rightarrow\;\gcd(${num},${den})=${g10}`, why: '輾轉相除法：大數除以小數取餘數，再拿除數除以餘數…直到餘數為 0，最後一個非零的除數就是最大公因數。' },
          { tex: String.raw`\frac{${num}}{${den}}=\frac{${num}\div${g10}}{${den}\div${g10}}=\frac{${m}}{${q}}\;\Rightarrow\;\text{period}=q=${periodExact}`, why: String.raw`約成最簡分數 $m/q$。$r[n]\equiv r[-1]+(n+1)\tfrac mq\pmod1$，$m$ 與 $q$ 互質，所以要走完 $q$ 步才回到原點。` },
        )
      }
      steps.push(
        { tex: String.raw`2^F=2^{${F}}=${D}`, why: String.raw`$F$ 個小數 bit：最小刻度是 $1/2^F$ LSB。` },
        { tex: String.raw`w_H\,2^F=${plain(wH)}\times${D}=${plain(wH * D)}`, why: '把想要的值換成「幾個最小刻度」。' },
        { tex: String.raw`K=\mathrm{round}(${plain(wH * D)})=${K}`, why: String.raw`暫存器只能存整數 $K$（四捨五入，$x.5$ 進位）。` },
        { tex: String.raw`\frac{K}{2^F}=\frac{${K}}{${D}}=${plain(grid.represented)}`, why: String.raw`硬體實際拿到的 $w_H$${grid.represented === wH ? '：剛好可以精確表示。' : String.raw`：和想要的值差 $${texNum(grid.represented - wH, 3)}\,\mathrm{LSB}$（$${F}$ 個小數 bit 的格點上沒有分母 $${q}$ 的這個分數，只能取最近的一格）。`}` },
        { tex: String.raw`K\bmod2^F=${K}-${Math.floor(K / D)}\times${D}=${f}`, why: String.raw`只看小數部分（減掉整數部分 $\lfloor K/2^F\rfloor=${Math.floor(K / D)}$ 個 $2^F$）。` },
      )
      if (f === 0) {
        steps.push({ tex: String.raw`K\bmod2^F=0\;\Rightarrow\;\text{period}_F=1`, why: String.raw`小數部分是 0：定點值是整數，$r$ 恆為 0，code 不切換。` })
      } else {
        steps.push(
          {
            tex: twos === 0 ? String.raw`${f}\ \text{是奇數}\;\Rightarrow\;\gcd(${f},${D})=1` : String.raw`${f}=2^{${twos}}\times${odd}\;\Rightarrow\;\gcd(${f},${D})=2^{${twos}}=${g}`,
            why: String.raw`$2^F$ 的因數只有 2，所以最大公因數就是「$K\bmod2^F$ 可以連續被 2 整除幾次」（一直除以 2 到變成奇數為止）。`,
          },
          { tex: String.raw`\text{period}_F=\frac{2^F}{\gcd}=\frac{${D}}{${g}}=${periodF}`, why: String.raw`$K/2^F$ 約分後的分母，就是定點 ΔΣ 的 limit-cycle 週期。` },
        )
      }
      return {
        steps,
        results: [
          { symbol: 'q', label: '精確分數時的週期', value: periodExact, tolerance: INT_TOL },
          { symbol: 'K', label: String.raw`定點整數 $\mathrm{round}(w_H2^F)$`, value: K, digits: 9, tolerance: INT_TOL },
          { symbol: String.raw`K\bmod2^F`, label: '小數部分（以最小刻度計）', value: f, digits: 9, tolerance: INT_TOL },
          { symbol: String.raw`\text{period}_F`, label: '定點時的週期', value: periodF, digits: 9, tolerance: INT_TOL },
        ],
        notes: [
          periodF === periodExact
            ? String.raw`這個 $w_H$ 在 $F=${F}$ 時可以精確表示，兩個週期相同（都是 $${periodExact}$）。`
            : periodF === 1
              ? String.raw`同一個「$${plain(wH)}$」，精確算術的週期是 $${periodExact}$，但 $F=${F}$ 的定點把它捨入成整數 $${plain(grid.represented)}$：code 不再切換（沒有 limit cycle），代價是留下 $${texNum(grid.represented - wH, 3)}\,\mathrm{LSB}$ 的 static error——等於退化成方法 A 的 Freeze。`
            : periodF > periodExact
              ? String.raw`同一個「$${plain(wH)}$」，精確算術的週期是 $${periodExact}$，$F=${F}$ 的定點卻是 $${periodF}$：limit cycle 還在，只是週期變長、譜線間距變成 $f_u/${periodF}$（變密）。`
              : String.raw`同一個「$${plain(wH)}$」，精確算術的週期是 $${periodExact}$，$F=${F}$ 的定點卻只有 $${periodF}$：小數 bit 太少，$w_H$ 被捨入到比較粗的格點（平均值也跟著偏了 $${texNum(grid.represented - wH, 3)}\,\mathrm{LSB}$），週期反而變短、譜線間距變成 $f_u/${periodF}$（變疏）。`,
          String.raw`這兩個週期都和初始 $r[-1]$ 無關；只要 $w_H$ 是常數（包含 LMS 凍結之後），ΔΣ 就一定落入這個循環（勘誤 E15）。`,
        ],
      }
    },
    tips: [
      String.raw`$\gcd(a,2^F)$ 不必輾轉相除：把 $a$ 一直除以 2，能除 $s$ 次就是 $2^s$。例如 $410\to205$（奇數），所以 $\gcd(410,1024)=2$。`,
      String.raw`$K\bmod2^F$ 也可以用小數部分直接算：$\mathrm{round}(0.4\times1024)=\mathrm{round}(409.6)=410$。`,
      String.raw`範例（$32.4$）：精確分數 $\tfrac{162}{5}\Rightarrow5$；$F=8/10/12/16$ 的定點分別是 $128/512/2048/32768$（測試 T16、勘誤 E15）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.7',
    title: 'Noise shaping 的數字感：NTF 增益、dither 的代價與頻帶內功率（白色近似）',
    page: '/ch/13',
    formulaId: 'F-13.10',
    formulaTex: String.raw`\begin{gathered}|\mathrm{NTF}(f)|^2=4\sin^2\!\Big(\frac{\pi f}{f_u}\Big),\qquad\sigma_d^2=\frac{A^2}{12}\ (\mathrm{RPDF}),\qquad\sigma_r^2\approx\frac1{12}+\sigma_d^2,\qquad E[e^2]\approx2\sigma_r^2\\[4pt] P_\mathrm{in}\approx\frac{8\pi^2}{3}\,\sigma_r^2\Big(\frac{f_B}{f_u}\Big)^3\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'R', symbol: 'f_u/f_B', label: 'code 更新率與頻帶上緣的比值', default: 64, min: 2, max: 1e6, practice: { choices: [16, 32, 64, 128, 256] } },
      { key: 'A', symbol: 'A', label: 'dither 的峰對峰寬度（RPDF；0 = 沒有 dither）', unit: String.raw`\mathrm{LSB}`, default: 1, min: 0, max: 100, practice: { choices: [0, 0.5, 1, 2] } },
    ],
    validate: ({ R, A }) => {
      if (R < R_MIN) return R_MSG
      if (A > 4) return String.raw`請輸入 $A\le4\,\mathrm{LSB}$：量化器輸入會偏離 $w_H$ 最多 $\tfrac12+A$，dither 太大時 code 擺幅超過十幾階，6-bit 的範圍內幾乎一定會 overload（需要 $A\le w_H<63-A$），白色近似也不再描述實際電路。`
      return null
    },
    solve: ({ R, A }) => {
      const x = 1 / R
      const theta = Math.PI * x
      const sinT = Math.sin(theta)
      const sin2 = sinT * sinT
      const ntf = ntfGain2(x)
      const ntfDb = 10 * Math.log10(ntf)
      const sd2 = ditherVariance(A, 'uniform')
      const sr2 = efbResidualVar(sd2)
      const total = efbWhitePower(sr2)
      const x3 = x ** 3
      const coef = (8 * Math.PI ** 2) / 3
      const inD = efbInbandWhite(SIGMA_R2_PLAIN, x)
      const inE = efbInbandWhite(sr2, x)
      const sim = ditherSim(A)
      return {
        steps: [
          { tex: String.raw`\frac{f_B}{f_u}=\frac1{${tin(R)}}=${t6(x)}`, why: String.raw`頻帶上緣相對於 code 更新率的位置（本章取 $f_B=f_u/64$，相當於 OSR 32）。` },
          { tex: String.raw`\theta=\pi\,\frac{f_B}{f_u}=3.141593\times${t6(x)}=${t6(theta)}\ \mathrm{rad}\;(=${t6(180 * x)}^\circ)`, why: String.raw`NTF 裡的半角 $\Omega/2=\pi f/f_u$。計算機用 RAD 模式；用 DEG 模式就輸入括號裡的角度。` },
          { tex: String.raw`\sin\theta=\sin(${t6(theta)})=${t6(sinT)}`, why: String.raw`小角度時 $\sin\theta\approx\theta$：這裡兩者只差 $${texNum((100 * (theta - sinT)) / sinT, 2)}\%$。` },
          { tex: String.raw`\sin^2\theta=${powTex(t6(sinT), 2)}=${t6(sin2)}`, why: String.raw`先把 $\sin\theta$ 平方（$x^2$ 鍵）。` },
          { tex: String.raw`|\mathrm{NTF}(f_B)|^2=4\sin^2\theta=4\times${t6(sin2)}=${t6(ntf)}`, why: String.raw`$|1-e^{-j\Omega}|^2=4\sin^2(\Omega/2)$：量化誤差 $r$ 在 $f_B$ 被壓低的倍數（功率）。` },
          { tex: String.raw`10\log_{10}(${t6(ntf)})=${texNum(ntfDb, 4)}\ \mathrm{dB}`, why: String.raw`換成 dB（功率用 $10\log_{10}$：按 log 鍵再乘 10）。頻率每降 10 倍再少 20 dB；在 $f_u/2$ 則是 $4=+6.02\,\mathrm{dB}$。` },
          { tex: String.raw`\sigma_d^2=\frac{A^2}{12}=\frac{${powTex(tin(A), 2)}}{12}=${t6(sd2)}\ \mathrm{LSB}^2`, why: String.raw`寬度 $A$ 的均勻分布（RPDF）的變異數。` },
          { tex: String.raw`\sigma_r^2\approx\frac1{12}+\sigma_d^2=${t6(1 / 12)}+${t6(sd2)}=${t6(sr2)}\ \mathrm{LSB}^2`, why: String.raw`白色近似：$r=-(e_q+d)$，量化誤差 $e_q$ 當成均勻的 $\tfrac1{12}$，與 dither 不相關，變異數相加。` },
          { tex: String.raw`E[e^2]\approx2\sigma_r^2=2\times${t6(sr2)}=${texNum(total)}\ \mathrm{LSB}^2`, why: String.raw`$e=r[n-1]-r[n]$，前後不相關時變異數相加：總誤差功率是 $\sigma_r^2$ 的兩倍——dither 的代價。` },
          { tex: String.raw`\Big(\frac{f_B}{f_u}\Big)^3=${powTex(t6(x), 3)}=${t6(x3)}`, why: String.raw`頻帶內功率與頻寬的「三次方」成正比（$\int_0^{f_B}f^2\,df=f_B^3/3$）。` },
          {
            tex: String.raw`P_\mathrm{in}^{(D)}\approx\frac{8\pi^2}{3}\cdot\frac1{12}\Big(\frac{f_B}{f_u}\Big)^3=${t6(coef)}\times${t6(1 / 12)}\times${t6(x3)}=${texNum(inD.lowFreq)}\ \mathrm{LSB}^2`,
            why: String.raw`沒有 dither 的方法 D（$\sigma_r^2=\tfrac1{12}$）：$\tfrac{8\pi^2}{3}=\tfrac{8\times9.869604}{3}=${t6(coef)}$。`,
          },
          {
            tex: String.raw`P_\mathrm{in}^{(E)}\approx\frac{8\pi^2}{3}\,\sigma_r^2\Big(\frac{f_B}{f_u}\Big)^3=${t6(coef)}\times${t6(sr2)}\times${t6(x3)}=${texNum(inE.lowFreq)}\ \mathrm{LSB}^2`,
            why: String.raw`加了 dither 的方法 E：dither 也被 $1-z^{-1}$ 塑形，所以頻帶內只是多乘 $1+A^2=${texNum(1 + A * A)}$ 倍。`,
          },
        ],
        results: [
          { symbol: String.raw`|\mathrm{NTF}(f_B)|^2`, label: '頻帶上緣的 NTF 增益', value: ntfDb, unit: String.raw`\mathrm{dB}`, digits: 4, tolerance: { abs: 0.1, rel: 0 } },
          { symbol: 'E[e^2]', label: '總誤差功率（白色近似）', value: total, unit: String.raw`\mathrm{LSB}^2` },
          { symbol: String.raw`P_\mathrm{in}^{(D)}`, label: '頻帶內：沒有 dither', value: inD.lowFreq, unit: String.raw`\mathrm{LSB}^2`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`P_\mathrm{in}^{(E)}`, label: '頻帶內：有 dither', value: inE.lowFreq, unit: String.raw`\mathrm{LSB}^2`, tolerance: { rel: 0.02 } },
        ],
        notes: [
          String.raw`不用低頻近似、把 $4\sin^2$ 直接積分的值是 $P_\mathrm{in}^{(E)}=\sigma_r^2\big(4x-\tfrac{2}{\pi}\sin2\pi x\big)=${texNum(inE.exact)}$（$x=f_B/f_u$），手算的近似只多 $${pctTex((100 * (inE.lowFreq - inE.exact)) / inE.exact)}\%$。`,
          A < 1
            ? String.raw`注意 $A<1\,\mathrm{LSB}$ 時白色近似不可靠：把常數 $w_H=32.4$ 實際丟進模型跑 $2^{14}$ 次更新（和本章 Lab 同一個 seed），總誤差功率是 $${texNum(sim.power, 4)}\,\mathrm{LSB}^2$，白色近似卻給 $${texNum(total, 4)}$。${sim.max - sim.min === 1 ? String.raw`code 仍只在 $${sim.min}$、$${sim.max}$ 兩階之間切換，總功率被平均值鎖在 $p(1-p)=0.24$；` : ''}$r$ 前後負相關、不是白色（勘誤 E15）。這一題的頻帶內數字只在 $w_H$ 會動（LMS 雜訊）或 dither 夠大時才有意義。`
            : String.raw`$A\ge1\,\mathrm{LSB}$ 時白色近似才大致成立：把常數 $w_H=32.4$ 實際丟進模型跑 $2^{14}$ 次更新（和本章 Lab 同一個 seed），總誤差功率是 $${texNum(sim.power, 4)}\,\mathrm{LSB}^2$（白色近似 $${texNum(total, 4)}$），limit cycle 被打散；代價是 code 用到 $${sim.min}\ldots${sim.max}$（量化器輸入的擺幅 $|u-w_H|\le\tfrac12+A=${tin(0.5 + A)}\,\mathrm{LSB}$）。`,
        ],
      }
    },
    tips: [
      String.raw`RAD 模式：直接 $\sin(0.0490874)$；DEG 模式：$\sin(180^\circ\div(f_u/f_B))$。沒有 $\sin$ 鍵時，$\theta\le0.2$ 可以用 $\sin\theta\approx\theta$（誤差小於 $0.7\%$），也就是 $|\mathrm{NTF}|^2\approx(2\pi f_B/f_u)^2$，換成 dB 只差不到 $0.06\,\mathrm{dB}$。`,
      String.raw`$10\log_{10}$：先按 log 再乘 10；$10\log_{10}4=6.02$、$10\log_{10}(1/64^2)=-36.1$。`,
      String.raw`答案顯示 5 位有效數字，步驟裡的中間量多留一位（6 位），照抄進計算機就能對到最後一位。`,
      String.raw`TPDF（兩個均勻相減）的 $\sigma_d^2=A^2/24$，是 RPDF 的一半。`,
      String.raw`範例（$f_B=f_u/64$、$A=1$）：$|\mathrm{NTF}|^2=-20.16\,\mathrm{dB}$、$E[e^2]\approx\tfrac13$、$P_\mathrm{in}^{(D)}=8.37\times10^{-6}$、$P_\mathrm{in}^{(E)}=1.67\times10^{-5}\,\mathrm{LSB}^2$。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-13.8',
    title: '綜合題：32.4 放進 6-bit——Freeze、兩階切換、ΔΣ 各留下多少 fs？',
    page: '/ch/13',
    formulaId: 'F-13.11',
    formulaTex: String.raw`\begin{gathered}\delta t[n]=\Delta_\mathrm{LSB}\,\big(y[n]-w^*\big)\,x[n]\;\Rightarrow\;\sigma_{\delta t}=\Delta_\mathrm{LSB}\,e_\mathrm{rms}\,x_\mathrm{rms},\qquad e_\mathrm{rms}^{(A)}=|Q_B(w^*)-w^*|,\quad e_\mathrm{rms}^{(\mathrm{sw})}=\sqrt{p_0(1-p_0)}\\[4pt] P_\mathrm{in}^{(C)}=2\big(p_0(1-p_0)-\sigma_w^2\big)\frac{f_B}{f_u},\qquad P_\mathrm{in}^{(D)}\approx\frac{8\pi^2}{3}\cdot\frac1{12}\Big(\frac{f_B}{f_u}\Big)^3,\qquad \sigma_{\delta t,\mathrm{in}}=\Delta_\mathrm{LSB}\sqrt{P_\mathrm{in}}\;x_\mathrm{rms}\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'w', symbol: 'w^*', label: '理想係數', unit: String.raw`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: [32.4, 32.5, 32.6, 20.4, 40.5, 12.3, 45.7, 27.25] } },
      { key: 'lsb', symbol: String.raw`\Delta_\mathrm{LSB}`, label: '1 個 gain LSB 的 DTC gain', unit: String.raw`\mathrm{fs/LSB}`, default: 0.125, min: 0.001, max: 100, practice: { choices: [0.05, 0.1, 0.125, 0.25, 0.5] } },
      { key: 'xr', symbol: String.raw`x_\mathrm{rms}`, label: 'DSM residue（正規化 code）的 RMS', default: 1, min: 0.001, max: 1000, practice: { choices: [0.5, 1, 2] } },
      { key: 'sw', symbol: String.raw`\sigma_w`, label: 'LMS 更新雜訊的 RMS', unit: String.raw`\mathrm{LSB}`, default: 0.2, min: 0, max: 10, practice: { choices: [0, 0.05, 0.1, 0.125, 0.2] } },
      { key: 'R', symbol: 'f_u/f_B', label: 'code 更新率與頻帶上緣的比值', default: 64, min: 2, max: 1e6, practice: { choices: [16, 32, 64, 128] } },
    ],
    validate: ({ w, sw, R }) => {
      if (w < 0 || w >= MAX_CODE) return TWO_LEVEL_MSG
      const { p } = splitFrac(w)
      if (p === 0) return String.raw`$w^*$ 是整數時三種做法都輸出同一個 code，誤差全是 0，沒有東西可比。請輸入有小數的 $w^*$。`
      if (sw > Math.min(p, 1 - p) / 2 + 1e-9) return String.raw`$\sigma_w$ 太大：近似 $E[p(1-p)]\approx p_0(1-p_0)-\sigma_w^2$ 假設 $w_H$ 幾乎不越過整數，需要 $\sigma_w\le\tfrac12\min(p_0,1-p_0)=${texNum(Math.min(p, 1 - p) / 2)}$（最近的整數至少在 $2\sigma_w$ 之外；剛好在這個上限時誤差已有 $2\%$ 到 $5\%$）。更大的 $\sigma_w$ 要用數值積分（模型的 $\texttt{stochasticQuantVar}$）。`
      if (R < R_MIN) return R_MSG
      return null
    },
    solve: ({ w, lsb, xr, sw, R }) => {
      const { y } = freezeCode(w)
      const dw = tidy(y - w)
      const { lo, p } = splitFrac(w)
      const m = bernoulliMoments(lo, p)
      const dtA = Math.abs(mixWithResidue([dw], 1, [xr], lsb)[0])
      const dtSw = mixWithResidue([m.rms], 1, [xr], lsb)[0]
      const sw2 = sw * sw
      const epq = stochasticQuantVarApprox(p, sw)
      const epqExact = stochasticQuantVar(w, sw)
      const x = 1 / R
      const pinC = 2 * epq * x
      const rmsC = Math.sqrt(pinC)
      // 慢變（頻帶內）的 code 誤差就像一個慢慢飄的 gain error：同樣乘上 residue（core:mixing 的 Δ_LSB·e·x）
      const fsC = mixWithResidue([rmsC], 1, [xr], lsb)[0]
      const x3 = x ** 3
      const coef = ((8 * Math.PI ** 2) / 3) * SIGMA_R2_PLAIN
      const pinD = efbInbandWhite(SIGMA_R2_PLAIN, x).lowFreq
      const rmsD = Math.sqrt(pinD)
      const fsD = mixWithResidue([rmsD], 1, [xr], lsb)[0]
      const approxErrPct = (100 * (epq - epqExact)) / epqExact
      const notes = [
        dtSw - dtA > 1e-12 * dtSw
          ? String.raw`總 RMS：Freeze（$${texNum(dtA)}$ fs）反而比兩階切換（$${texNum(dtSw)}$ fs）小——切換並沒有讓誤差「變少」，只是把 DC 換成交流。因為 $\min(p_0,1-p_0)^2\le p_0(1-p_0)$ 恆成立，四捨五入的 Freeze 在總 RMS 上永遠不會輸；「平均正確 $\ne$ 誤差比較小」。`
          : String.raw`總 RMS：這一題 $w^*$ 剛好在 $x.5$，Freeze 的 static error 是最壞的 $\tfrac12\,\mathrm{LSB}$，而 $\sqrt{p_0(1-p_0)}=\sqrt{0.25}$ 也是 $\tfrac12$，所以兩者相等（都是 $${texNum(dtA)}$ fs）。其他的 $w^*$ 都是 Freeze 比較小：$\min(p_0,1-p_0)^2\le p_0(1-p_0)$。`,
        String.raw`頻帶內（慢變、會被當成 gain error 的部分）：Freeze 的 $${texNum(dtA)}$ fs 全部都在（它是 DC）；Stochastic 的量化誤差剩 $${texNum(fsC)}$ fs；ΔΣ 只剩 $${texNum(fsD)}$ fs（Stochastic 的 $1/${texNum(fsC / fsD, 3)}$）。這才是選 ΔΣ 的理由——但要記得它在常數輸入時會掉進 limit cycle（HC-13.6）。`,
        sw > 0
          ? String.raw`$E[p(1-p)]$ 的數值積分（模型，含越過整數的尾巴）是 $${texNum(epqExact)}$，${Math.abs(approxErrPct) < 0.005 ? String.raw`手算的近似和它幾乎沒有差別（不到 $0.01\%$）` : String.raw`手算的近似差 $${texNum(approxErrPct, 2)}\%$`}。會追 $w_H$ 的做法（B–E）還要另外加上 LMS 雜訊本身：$\Delta_\mathrm{LSB}\,\sigma_w\,x_\mathrm{rms}=${texNum(sw * lsb * xr)}$ fs（Freeze 沒有這一項）。`
          : String.raw`這一題 $\sigma_w=0$：$w_H$ 是常數，$E[p(1-p)]=p_0(1-p_0)$ 沒有近似；但常數輸入的 ΔΣ 其實是 limit cycle（譜線），不是 shaped noise，$P_\mathrm{in}^{(D)}$ 的白色近似此時只能當對照用的數量級——真正的頻帶內功率要看有沒有譜線落在 $f_B$ 以內（勘誤 E15）。`,
        String.raw`這裡只算了 code 誤差乘上 residue 的大小；它還要經過 PLL 的 $T(f)$ 才到輸出，limit cycle 的 tone 可能被混回通帶（§13.5b），那一步只能靠模擬。`,
      ]
      return {
        steps: [
          { tex: String.raw`y_A=\Big\lfloor w^*+\tfrac12\Big\rfloor=\lfloor ${tin(tidy(w + 0.5))}\rfloor=${y}`, why: '方法 A（Freeze）：四捨五入到最近的 code 後不再改變。' },
          { tex: String.raw`\delta w=y_A-w^*=${y}-${tinP(w)}=${texNum(dw)}\ \mathrm{LSB}`, why: String.raw`static error（$\delta w=w-w^*$ 約定；$\delta=a-w=${texNum(-dw)}\,\mathrm{LSB}$，勘誤 E49）。` },
          { tex: String.raw`\sigma_{\delta t}^{(A)}=\Delta_\mathrm{LSB}\,|\delta w|\,x_\mathrm{rms}=${tin(lsb)}\times${texNum(Math.abs(dw))}\times${tin(xr)}=${texNum(dtA)}\ \mathrm{fs}`, why: String.raw`$\delta t[n]=\Delta_\mathrm{LSB}\,\delta w\,x[n]$：$\delta w$ 是常數，timing error 就是 residue 的縮小版，RMS 直接相乘（精確）。` },
          { tex: String.raw`p_0=w^*-\lfloor w^*\rfloor=${tin(w)}-${lo}=${tin(p)}`, why: String.raw`改成在 $${lo}$ 與 $${lo + 1}$ 之間切換（方法 B、C，或常數輸入的 D）：上一階出現的比例。` },
          { tex: String.raw`p_0(1-p_0)=${tin(p)}\times${texNum(1 - p)}=${t6(m.variance)}\ \mathrm{LSB}^2`, why: 'DC 誤差變成 0，但多了這麼多交流功率（兩階切換都一樣）。' },
          { tex: String.raw`e_\mathrm{rms}^{(\mathrm{sw})}=\sqrt{${t6(m.variance)}}=${t6(m.rms)}\ \mathrm{LSB}`, why: String.raw`開根號（$\sqrt{x}$ 鍵）得到 RMS code 誤差。` },
          { tex: String.raw`\sigma_{\delta t}^{(\mathrm{sw})}\approx\Delta_\mathrm{LSB}\,e_\mathrm{rms}^{(\mathrm{sw})}\,x_\mathrm{rms}=${tin(lsb)}\times${t6(m.rms)}\times${tin(xr)}=${texNum(dtSw)}\ \mathrm{fs}`, why: String.raw`$e$ 與 $x$ 獨立時 $E[e^2x^2]=E[e^2]E[x^2]$（對隨機的 C 成立；B、D 是確定性序列，只是近似）。` },
          { tex: String.raw`\sigma_w^2=${powTex(tin(sw), 2)}=${t6(sw2)}\ \mathrm{LSB}^2`, why: String.raw`接著看「頻帶內」：$w_H$ 帶著 LMS 雜訊在 $w^*$ 附近擺動。` },
          { tex: String.raw`E[p(1-p)]\approx p_0(1-p_0)-\sigma_w^2=${t6(m.variance)}-${t6(sw2)}=${t6(epq)}\ \mathrm{LSB}^2`, why: String.raw`$p=p_0+\delta w$：$E[p]=p_0$、$E[p^2]=p_0^2+\sigma_w^2$，所以 $E[p-p^2]=p_0(1-p_0)-\sigma_w^2$。` },
          { tex: String.raw`\frac{f_B}{f_u}=\frac1{${tin(R)}}=${t6(x)}`, why: String.raw`頻帶內佔 Nyquist 頻寬 $f_u/2$ 的比例是它的兩倍。` },
          { tex: String.raw`P_\mathrm{in}^{(C)}=2\,E[p(1-p)]\,\frac{f_B}{f_u}=2\times${t6(epq)}\times${t6(x)}=${t6(pinC)}\ \mathrm{LSB}^2`, why: String.raw`Stochastic 的量化誤差是白色的：one-sided 高度 $2E[p(1-p)]/f_u$ 乘上頻寬 $f_B$。` },
          { tex: String.raw`\sqrt{P_\mathrm{in}^{(C)}}=\sqrt{${t6(pinC)}}=${t6(rmsC)}\ \mathrm{LSB}`, why: '開根號：頻帶內（慢變）的 RMS code 誤差。' },
          { tex: String.raw`\sigma_{\delta t,\mathrm{in}}^{(C)}=\Delta_\mathrm{LSB}\sqrt{P_\mathrm{in}^{(C)}}\;x_\mathrm{rms}=${tin(lsb)}\times${t6(rmsC)}\times${tin(xr)}=${texNum(fsC)}\ \mathrm{fs}`, why: String.raw`慢變的 code 誤差就像一個慢慢飄的 gain error，同樣乘上 residue（和第 3 步同一個算法）：方法 C 的量化誤差留在頻帶內的部分。` },
          { tex: String.raw`\Big(\frac{f_B}{f_u}\Big)^3=${powTex(t6(x), 3)}=${t6(x3)}`, why: 'ΔΣ 把誤差推到高頻，頻帶內只剩頻寬的三次方。' },
          { tex: String.raw`P_\mathrm{in}^{(D)}\approx\frac{8\pi^2}{3}\cdot\frac1{12}\Big(\frac{f_B}{f_u}\Big)^3=${t6(coef)}\times${t6(x3)}=${t6(pinD)}\ \mathrm{LSB}^2`, why: String.raw`白色近似（$\sigma_r^2=\tfrac1{12}$）加上低頻近似；$\tfrac{8\pi^2}{36}=\tfrac{2\times9.869604}{9}=${t6(coef)}$。只有數量級可信。` },
          { tex: String.raw`\sqrt{P_\mathrm{in}^{(D)}}=\sqrt{${t6(pinD)}}=${t6(rmsD)}\ \mathrm{LSB}`, why: String.raw`開根號：ΔΣ 留在頻帶內的 RMS code 誤差（很小的數先寫成 $a\times10^{-6}$ 再開根號比較好按）。` },
          { tex: String.raw`\sigma_{\delta t,\mathrm{in}}^{(D)}=\Delta_\mathrm{LSB}\sqrt{P_\mathrm{in}^{(D)}}\;x_\mathrm{rms}=${tin(lsb)}\times${t6(rmsD)}\times${tin(xr)}=${texNum(fsD)}\ \mathrm{fs}`, why: '方法 D 的量化誤差留在頻帶內的部分（RMS）。' },
        ],
        results: [
          { symbol: String.raw`\sigma_{\delta t}^{(A)}`, label: 'Freeze 的 static timing error（RMS）', value: dtA, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_{\delta t}^{(\mathrm{sw})}`, label: '兩階切換的 timing error（RMS）', value: dtSw, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_{\delta t,\mathrm{in}}^{(C)}`, label: 'Stochastic：頻帶內量化誤差造成的 timing error', value: fsC, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\sigma_{\delta t,\mathrm{in}}^{(D)}`, label: 'ΔΣ：頻帶內量化誤差造成的 timing error', value: fsD, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.02 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`先分清楚兩種比法：「總 RMS」（步驟 1–7）和「頻帶內」（步驟 8–17）。前者 Freeze 不會輸，後者 ΔΣ 小很多。`,
      String.raw`$\tfrac{8\pi^2}{3}\cdot\tfrac1{12}=\tfrac{2\pi^2}{9}=2.19325$ 可以先記起來；$64^{-3}=3.8147\times10^{-6}$。`,
      String.raw`開根號時把很小的數寫成偶數次方比較好按：$\sqrt{8.36657\times10^{-6}}=\sqrt{8.36657}\times10^{-3}=2.8925\times10^{-3}$。`,
      String.raw`範例（$32.4$、$0.125\,\mathrm{fs/LSB}$、$x_\mathrm{rms}=1$、$\sigma_w=0.2$、$f_B=f_u/64$）：$0.05$、$0.0612$、$0.00988$、$3.62\times10^{-4}$ fs。`,
    ],
  },
]
