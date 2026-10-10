import { texNum } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { conventionalStep, fixedXMuMax, fixedXPole, signErrorStep, signSignStep } from '@/simulation/models/lms'
import {
  gradientDescent,
  harmonicReachSteps,
  harmonicTravelApprox,
  meanFieldAnalysis,
  meanFieldDrift,
  nlmsStep,
  noiseMedian,
  noiseOps,
  predictSteadyState,
  ratioFixedPoints,
  runSignErrorFixedX,
  signErrorLimitCycle,
  stepSize,
  stepsToTravel,
  travelDistance,
  xMoments,
  type MeanFieldInput,
  type NoiseDist,
  type Schedule,
} from '@/simulation/models/sgd'
import { decimalsFor, isShort, resultDigits, sigAt, sigFor, sigRoundArg, tx, txInt, txP, txRoundArg, txSq } from './handcalcTex'

/**
 * Ch02 的「帶入手算」題（docs/teaching-style.md §7）。
 *  - solve() 的數值一律來自 src/simulation/models 的實際函式（lms.ts 的三個 stepper、sgd.ts 的 GD／limit cycle／排程／
 *    比值觀點／mean-field）；中間的四則運算只是把同一個數字拆開給讀者看，handcalcs.test.tsx 逐題用獨立公式重算比對。
 *  - 每一步的 TeX 是「符號式 = 代入數字 = 中間結果 = 結果」，每個等號只做一種運算；畫面上的數字自己就算得出下一個等號
 *    （handcalcs.test.tsx 把每一步的 TeX 重新求值檢查）。數字一律經過 handcalcTex.ts：寫得完的小數整個寫出（T）、
 *    加數／乘數是負數或科學記號時加括號（P）、平方的底數加括號（Q）、相減會抵銷有效位數的地方多顯示幾位（sigFor）。
 *  - 預設值 = 內文 worked example 的數字（T01 的 a=3、x=2、w₀=1、μ=0.1；§3 的 a=3、x=1、μ=0.4、w₀=0；
 *    §4 的三筆資料 (1,3)、(2,7)、(4,10)；「單邊 outlier」preset 的 σ=0.3、p=0.05、s=20；主實驗預設的 σ=0.5、μ=0.02）。
 *  - 參數誤差極性一律 δ = a − w（勘誤 E39）；成本含 ½（E41）；sign(0) 用數學慣例 0 並在備註說明（E40）。
 *  - 適用範圍由 validate 擋下並說明原因。HC-02.8（Sign-Error 的線性化）用 g = μ·K_SE ≤ 0.5 當門檻：決定線性化準不準的是
 *    「走一步在 comparator 輸入端造成的跳動 μx² 相對於 σ_v 的大小」，不是帶寬 μ|x|（兩者量綱不同）；誤差數字由 Monte Carlo 測試背書。
 *  - 手算是精確算術、模型是 IEEE double：精確值為 0 的量（Newton 一步到位的 J(w₁)、NLMS μ̃ = 1 的 e⁺、
 *    0.9 − 0.3×3 這種誤差）用 snapZero／zsum／tieSafeY 顯示成 0，不把 10⁻¹⁶ 量級的捨入殘值當成答案（門檻：相對 10⁻¹²）。
 *    唯一刻意保留原始浮點數的是 HC-02.2 備註的「對照網站」那一則（rawNum），用來說明勘誤 E40。
 *
 * 題目在章內的位置：HC-02.1 → §1（F-02.2 之後）、HC-02.2／HC-02.3 → §3（F-02.10、F-02.11 之後）、
 * HC-02.4／HC-02.5／HC-02.6 → §4（F-02.7、三筆資料的例子、F-02.18 之後）、HC-02.7 → §5（F-02.15 之後）、
 * HC-02.8（綜合）→ §6 最後一題思考題之前。
 */

const PAGE = '/ch/02'
/** 備註／提示裡的數字：固定 5 位有效數字 */
const N = texNum
/** 步驟裡代入的數字（寫得完就整個寫出）、加數／乘數（必要時加括號）、平方 */
const T = tx
const P = txP
const Q = txSq
const CONST: Schedule = { kind: 'constant', n0: 1 }
/** 步數的單位（一步 = 一個 sample） */
const SAMPLES = String.raw`\text{samples}`

/**
 * 浮點捨入殘值 → 0：模型算出的量若相對於 scale 小於 10⁻¹²（例如 0.2 + 0.4 − 0.6 = 1.1×10⁻¹⁶），
 * 精確算術下它就是 0。手算題要顯示 0，而不是把 IEEE double 的捨入誤差當成答案。
 */
export const snapZero = (v: number, scale: number) => (Math.abs(v) <= 1e-12 * Math.abs(scale) ? 0 : v)

/**
 * 誤差 e = y − w·x 在精確算術下剛好是 0、IEEE double 卻留下 10⁻¹⁶ 量級殘值時（例如 0.9 − 0.3×3 = 1.1×10⁻¹⁶），
 * 回傳讓 e 剛好為 0 的 y（= w·x），其餘情況原樣回傳。手算的人會得到 e = 0；不這樣處理的話，
 * sign(殘值) = ±1 會讓 Sign-Error／Sign-Sign 多走一步，和紙筆答案對不上（浮點殘值形同另一種 tie 慣例，勘誤 E40）。
 */
export const tieSafeY = (w: number, x: number, y: number) => (snapZero(y - w * x, Math.max(Math.abs(y), Math.abs(w * x))) === 0 ? w * x : y)

/** 加減的結果：相對於運算元的大小只剩捨入殘值時，精確值就是 0（例如 −0.3 + 0.3、0.2 − 0.19999999999999973）。 */
export const zsum = (v: number, ...operands: number[]) => snapZero(v, Math.max(0, ...operands.map(Math.abs)))

/**
 * 相減的運算元比平常多寫了幾位時，在說明裡提醒一句（不然讀者會奇怪數字怎麼變長了）。
 * 只有「寫不完、而且真的被多寫了幾位」的運算元才算；寫得完的小數本來就完整顯示，不必提醒。
 */
const moreDigits = (k: number, ...operands: number[]) => (k > 5 && operands.some((o) => !isShort(o)) ? '兩個接近的數相減會吃掉有效位數，所以這一步的數字多寫了幾位。' : '')

/** sign 值 → TeX（+1／−1／0） */
const sgnTex = (s: number) => (s > 0 ? '+1' : s < 0 ? '-1' : '0')

/** IEEE double 的完整十進位表示 → TeX（保留浮點捨入的尾數；指數記號改成 ×10ⁿ） */
function rawNum(x: number): string {
  const s = String(x)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
}

/** HC-02.6 的模型：x ≡ A（常數 code）、Gaussian 雜訊 + 單邊 outlier（每筆以機率 p 加上 s）。 */
export function outlierModel(a: number, A: number, sigma: number, p: number, s: number): { noise: NoiseDist; inp: MeanFieldInput } {
  const noise: NoiseDist = { kind: 'gaussian', sigma, outlierProb: p, outlierSize: s }
  return { noise, inp: { a, x: { kind: 'const', amp: A }, noise, huberDelta: 1, nlmsEps: 0 } }
}

/** HC-02.8 的模型：x = ±A 等機率（DSM-like code）、Gaussian 雜訊；a 不影響線性化增益，取 0。 */
export function bpskModel(A: number, sigma: number): MeanFieldInput {
  return { a: 0, x: { kind: 'bpsk', amp: A }, noise: { kind: 'gaussian', sigma, outlierProb: 0, outlierSize: 0 }, huberDelta: 1, nlmsEps: 0 }
}

/** HC-02.6：單邊 outlier 離雜訊主體至少幾個 σ_v、機率上限（超過時「Φ((m−s)/σ_v) ≈ 0」的手算近似不夠準）。 */
export const OUTLIER_MIN_SIGMAS = 6
export const OUTLIER_MAX_PROB = 0.3

/**
 * HC-02.8：Sign-Error 線性化（F-02.12／F-02.13）適用的 g = μ·K_SE 上限。
 * 走一步讓 comparator 輸入端的誤差改變 μx²，它要遠小於 σ_v（⇔ g ≪ 1）雜訊才能把 sign 平滑成斜線。
 * Monte Carlo（handcalcs.test.tsx）：g = 0.1／0.2／0.5／1 時公式高估 σ_w 約 0.6%／1.5%／5%／18%，所以手算題只接受 g ≤ 0.5。
 * （注意不是和帶寬 μ|x| 比：μ|x| 的單位是 [w]，σ_v 的單位是 [y] = [w][x]，只有 |x| = 1 時兩者才是同一個數。）
 */
export const SE_LINEAR_MAX_G = 0.5

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── §1 Gradient Descent ───────────── */
  {
    id: 'HC-02.1',
    title: '一步 Gradient Descent：切線預測 vs 真實下降',
    page: PAGE,
    formulaId: 'F-02.2',
    formulaTex: String.raw`w_1=w_0-\mu J'(w_0),\qquad \underbrace{J(w_0)-\mu J'^2}_{\text{切線（一階泰勒）預測}}\quad\text{vs}\quad J(w_1)=J(w_0)-\mu J'^2\Big(1-\tfrac{\mu}{2}J''\Big)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實係數（黑盒子裡的數）', default: 3, min: -20, max: 20, practice: { choices: [-2, 2, 3, 4] } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -10, max: 10, practice: { choices: [-2, -1, 0.5, 1, 2] } },
      { key: 'w0', symbol: 'w_0', label: '一開始的猜測', default: 1, min: -20, max: 20, practice: { min: -1, max: 3, step: 0.5 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '步長', default: 0.1, min: 0, max: 10, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.5] } },
    ],
    validate: ({ x, mu }) => {
      if (x === 0) return String.raw`$x=0$：量到的 $y=a\cdot0=0$ 不含 $a$ 的資訊，成本 $J$ 是一條水平線（$J'=J''=0$），沒有「坡」可以下。請換一個非零的 $x$。`
      if (mu <= 0) return String.raw`步長 $\mu$ 必須大於 0（$\mu=0$ 時完全不更新）。`
      return null
    },
    solve: ({ a, x, w0, mu }) => {
      const t = gradientDescent({ a, x, w0, mu, steps: 1, cost: 'half' })
      const y = a * x
      const yhat = w0 * x
      const e0 = t.e[0]
      const e1 = snapZero(t.e[1], e0) // 一步到位（μJ″ = 1）時精確值是 0
      const J0 = t.J[0]
      const J1 = snapZero(t.J[1], J0)
      const dJ = t.dJ[0]
      const dw = t.dw[0]
      const w1 = zsum(t.w[1], w0, dw) // w₀ + Δw 剛好抵銷時精確值是 0
      const curv = x * x // J''
      const predDrop = -dJ * dw // μ·J'²
      const Jtan = snapZero(J0 + dJ * dw, J0) // 與 §1 內文、GdExplorer 的「切線預測」同一個算式
      const half = (mu / 2) * curv // (μ/2)·J''
      const factor = snapZero(1 - half, 1) // μJ″ = 2（穩定邊界）時精確值是 0
      const drop = predDrop * factor // 真實的下降量
      const muMax = fixedXMuMax(x)
      const pole = snapZero(fixedXPole(mu, x), 1) // μJ″ = 1（Newton 步長）時精確值是 0
      // 相減的運算元要顯示幾位（這一題只有加、減、乘，寫得完的數本來就完整顯示；只有超過 10 位的才會用到）
      const kE = sigFor(e0, y, yhat)
      const kW = sigFor(w1, w0, dw)
      const kT = sigFor(Jtan, J0, predDrop)
      const kF = sigFor(factor, 1, half)
      const kJ = sigFor(J1, J0, drop)
      const notes = [String.raw`切線少算的「彎曲」：$J(w_1)-J_{\rm tan}=\tfrac12J''\Delta w^2=\tfrac12\times${P(curv)}\times${Q(dw)}=${N(0.5 * curv * dw * dw)}$。`]
      notes.push(
        e0 === 0
          ? String.raw`$w_0=a$：一開始就在谷底，$J'=0$，不會移動。`
          : String.raw`驗算：$e_1=y-w_1x=${N(e1)}$，$\tfrac12e_1^2=${N(0.5 * e1 * e1)}$，和最後一步相同；$e_1/e_0=${N(e1 / e0)}$ 就是 pole $p=1-\mu J''=${N(pole)}$，所以 $J(w_1)/J(w_0)=p^2$。`,
      )
      notes.push(
        factor === 0
          ? String.raw`$\mu=2/J''=${N(muMax)}$ 剛好是穩定邊界：因子為 0，成本完全沒降——$w$ 跳到谷底另一側同樣高的地方，永遠來回跳。`
          : factor < 0
            ? String.raw`$\mu>\mu_{\max}=2/J''=${N(muMax)}$：因子是負的，成本反而上升（走過頭、越跳越高）。切線仍然預測「會下降」——這就是一階近似失效的樣子。`
            : pole === 0 && e0 !== 0
              ? String.raw`現在的 $\mu=1/J''=${N(1 / curv)}$ 剛好是 Newton 步長（上限 $\mu_{\max}=2/J''=${N(muMax)}$ 的一半）：因子是 $\tfrac12$，切線預測的下降量 $\mu J'^2$ 剛好是 $J(w_0)$ 的兩倍，實際只降一半——一步就到谷底，$J(w_1)=0$。`
              : String.raw`步長上限 $\mu_{\max}=2/J''=${N(muMax)}$，現在的 $\mu$ 是它的 $${N((100 * mu) / muMax, 3)}\%$` +
                (e0 === 0 ? '。' : '：成本下降。') +
                String.raw`$\mu=1/J''=${N(1 / curv)}$（Newton 步長）時因子是 $\tfrac12$，一步就到谷底。`,
      )
      return {
        steps: [
          { tex: String.raw`y=a\,x=${P(a)}\times${P(x)}=${T(y)}`, why: '黑盒子的輸出（這一題沒有雜訊）。' },
          {
            tex: String.raw`e_0=y-w_0\,x=${T(y, kE)}-${P(w0)}\times${P(x)}=${T(y, kE)}-${P(yhat, kE)}=${T(e0)}`,
            why: String.raw`先預測 $\hat y=w_0x$（一次乘法），再和量到的 $y$ 比較（一次減法）。`,
          },
          {
            tex: String.raw`J(w_0)=\tfrac12e_0^2=\tfrac12\times${Q(e0)}=\tfrac12\times${P(e0 * e0)}=${T(J0)}`,
            why: String.raw`現在站的高度：先平方、再除以 2（成本要含 $\tfrac12$，勘誤 E41）。`,
          },
          {
            tex: String.raw`J'(w_0)=-e_0\,x=-${P(e0)}\times${P(x)}=${T(dJ)}`,
            why: String.raw`腳下的坡度（連鎖律：外層 $\tfrac12u^2$ 的導數是 $u$，內層 $y-wx$ 的導數是 $-x$）。` + (dJ < 0 ? String.raw`負的：往右（增加 $w$）是下坡。` : dJ > 0 ? String.raw`正的：往右是上坡，所以要往左走。` : '坡度是 0：已經在谷底。'),
          },
          { tex: String.raw`\Delta w=-\mu\,J'(w_0)=-${P(mu)}\times${P(dJ)}=${T(dw)}`, why: String.raw`往坡度的反方向走；注意兩個負號相乘，結果就是 LMS 的 $+\mu\,e\,x$。` },
          { tex: String.raw`w_1=w_0+\Delta w=${T(w0, kW)}+${P(dw, kW)}=${T(w1)}`, why: '走一步。' + moreDigits(kW, w0, dw) },
          {
            tex: String.raw`\mu\,[J'(w_0)]^2=${P(mu)}\times${Q(dJ)}=${P(mu)}\times${P(dJ * dJ)}=${T(predDrop)}`,
            why: String.raw`切線（一階泰勒）預測會下降這麼多：$J(w_0)+J'\Delta w=J(w_0)-\mu J'^2$。先平方、再乘 $\mu$。`,
          },
          { tex: String.raw`J_{\rm tan}=J(w_0)-\mu J'^2=${T(J0, kT)}-${P(predDrop, kT)}=${T(Jtan)}`, why: '切線預測的新高度。' + moreDigits(kT, J0, predDrop) },
          { tex: String.raw`J''=x^2=${Q(x)}=${T(curv)}`, why: '曲率：二次成本的二階導數是常數。' },
          {
            tex: String.raw`\tfrac{\mu}{2}J''=\tfrac{${T(mu)}}{2}\times${P(curv)}=${P(mu / 2)}\times${P(curv)}=${T(half)}`,
            why: String.raw`彎曲項的係數：$\mu$ 先除以 2，再乘上曲率。它等於 1 就是 $\mu=\mu_{\max}=2/J''$。`,
          },
          {
            tex: String.raw`1-\tfrac{\mu}{2}J''=1-${P(half, kF)}=${T(factor)}`,
            why: String.raw`彎曲造成的修正因子（F-02.2）。小於 1 表示實際降得比切線預測少；等於 0 或變成負的，就是走過頭了。` + moreDigits(kF, half),
          },
          {
            tex: String.raw`J(w_1)=J(w_0)-\mu J'^2\Big(1-\tfrac{\mu}{2}J''\Big)=${T(J0, kJ)}-${P(predDrop, kJ)}\times${P(factor, kJ)}=${T(J0, kJ)}-${P(drop, kJ)}=${T(J1)}`,
            why: '真實的新高度（成本是二次函數，所以這是精確式，不是近似）：先乘出真實的下降量，再從原來的高度扣掉。' + moreDigits(kJ, J0, predDrop, factor, drop),
          },
        ],
        results: [
          { symbol: 'w_1', label: '走一步之後的係數', value: w1, digits: resultDigits(w1) },
          { symbol: String.raw`J_{\rm tan}`, label: '切線預測的成本', value: Jtan, digits: resultDigits(Jtan) },
          { symbol: 'J(w_1)', label: '真實的成本', value: J1, digits: resultDigits(J1) },
        ],
        notes,
      }
    },
    tips: [
      String.raw`全部只有加減乘除與平方，每個等號只做一種運算（先平方、再乘除、最後加減）。最容易錯的是正負號：$J'=-e\,x$，再乘上 $-\mu$ 才得到 $\Delta w=+\mu\,e\,x$。`,
      String.raw`範例數字（$a=3,\ x=2,\ w_0=1,\ \mu=0.1$）：$w_1=1.8$（測試 T01）、切線預測 $1.6$、真實 $2.88$，與上面內文相同。`,
      String.raw`試試 $\mu=0.25$（一步到位）、$\mu=0.5$（邊界）與 $\mu=0.6$（成本上升），看修正因子怎麼變號。`,
    ],
  },

  /* ───────────── §3 Sign-Error：limit cycle ───────────── */
  {
    id: 'HC-02.2',
    title: 'Sign-Error 固定步長：走幾步、最後在哪兩點之間跳',
    page: PAGE,
    formulaId: 'F-02.10',
    formulaTex: String.raw`\delta_0=a-w_0,\quad h=\mu|x|,\quad n_c=\Big\lfloor\frac{|\delta_0|}{h}\Big\rfloor,\quad \rho=|\delta_0|-n_c\,h,\quad w_n\in\big\{a-\operatorname{sgn}(\delta_0)\,\rho,\ \ a+\operatorname{sgn}(\delta_0)(h-\rho)\big\}\ \ (n\ge n_c)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實係數', default: 3, min: -50, max: 50, practice: { choices: [2, 3, 4] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', default: 1, min: -20, max: 20, practice: { choices: [-2, 0.5, 1, 2] } },
      { key: 'w0', symbol: 'w_0', label: '初值', default: 0, min: -50, max: 50, practice: { choices: [-1, 0, 0.5, 1, 5] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '步長', default: 0.4, min: 0, max: 20, practice: { choices: [0.15, 0.3, 0.4, 0.7, 0.8] } },
    ],
    validate: ({ a, x, w0, mu }) => {
      if (x === 0) return String.raw`$x=0$：$\operatorname{sign}(e)\,x\equiv0$，$w$ 永遠不動（這筆資料不含 $a$ 的資訊）。請換一個非零的 $x$。`
      if (mu <= 0) return String.raw`步長 $\mu$ 必須大於 0（$h=\mu|x|=0$ 時 $w$ 不會移動）。`
      const lc = signErrorLimitCycle(a, x, w0, mu)
      if (lc.exactLanding)
        return String.raw`$|\delta_0|/h=${N(Math.abs(a - w0) / lc.h)}$ 是整數（$\rho=0$）：精確算術下第 $${lc.entryStep}$ 步剛好踩到 $w=a$，下一步 $e=0$，結果由 $\operatorname{sign}(0)$ 的慣例決定（凍結在 $a$，或在 $a$ 與 $a\pm h$ 之間跳；勘誤 E40），公式 F-02.10 的條件 $0<\rho<h$ 不成立。請把 $w_0$ 或 $\mu$ 改一點（例如 $\mu$ 加 $0.01$），或看下面「剛好踩到」的討論與思考題 3。`
      return null
    },
    solve: ({ a, x, w0, mu }) => {
      const lc = signErrorLimitCycle(a, x, w0, mu)
      const d0 = a - w0
      const absD = Math.abs(d0)
      const dir = Math.sign(d0)
      const h = lc.h
      const nc = lc.entryStep
      const nh = nc * h // 已經走掉的距離
      const rho = absD - nh
      const gap = h - rho
      // 兩點與時間平均剛好是 0 時（例如 a = 0.2、ρ = 0.2），模型的 IEEE double 會留下 10⁻¹⁶ 的殘值
      const scale = Math.max(Math.abs(a), h)
      const lo = snapZero(lc.lo, scale)
      const hi = snapZero(lc.hi, scale)
      const mean = snapZero(lc.mean, scale)
      const before = dir > 0 ? lo : hi // a − sgn(δ₀)·ρ：最後一個還沒越過 a 的點
      const after = dir > 0 ? hi : lo // a + sgn(δ₀)·(h − ρ)：越過之後的點
      const sum = zsum(before + after, before, after)
      const kR = sigFor(rho, absD, nh)
      const kG = sigFor(gap, h, rho)
      const notes = [
        String.raw`之後永遠在這兩點之間來回（週期 2）：$|\delta_n|<h=${N(h)}$，停不下來。時間平均偏離 $a$ 的量是 $\bar w-a=\operatorname{sgn}(\delta_0)(\tfrac h2-\rho)=${N(snapZero(lc.mean - a, h))}$，由起點決定，最多 $\pm h/2$。`,
      ]
      if (nc <= 200_000) {
        const cross = stepsToTravel(absD, mu, Math.abs(x), CONST)
        const sim = runSignErrorFixedX(a, x, w0, nc + 1, mu, CONST, 'zero')
        notes.push(String.raw`走完距離 $|\delta_0|=${N(absD)}$ 需要 $\lceil|\delta_0|/h\rceil=n_c+1=${cross}$ 步：第 $${cross}$ 步第一次越過 $a$。`)
        notes.push(
          String.raw`對照網站：用 IEEE double 逐步執行 Sign-Error，$w_{${nc}}=${rawNum(sim[nc])}$、$w_{${nc + 1}}=${rawNum(sim[nc + 1])}$（與手算最多只差浮點捨入的最後幾位，勘誤 E40）。`,
        )
      }
      return {
        steps: [
          { tex: String.raw`\delta_0=a-w_0=${T(a)}-${P(w0)}=${T(d0)}`, why: String.raw`一開始離目標多遠（全站極性 $\delta=a-w$；正的表示 $w$ 太小、要往上走）。` },
          { tex: String.raw`h=\mu\,|x|=${P(mu)}\times${P(Math.abs(x))}=${T(h)}`, why: String.raw`Sign-Error 每一步固定移動這麼多，和誤差大小無關。` },
          {
            tex: String.raw`n_c=\Big\lfloor\frac{|\delta_0|}{h}\Big\rfloor=\Big\lfloor\frac{${T(absD)}}{${T(h)}}\Big\rfloor=\lfloor${txRoundArg(absD / h, nc, 'floor')}\rfloor=${txInt(nc)}`,
            why: String.raw`還沒越過 $a$ 之前能走幾個整步：先除，再無條件捨去小數（$\lfloor\cdot\rfloor$）。`,
          },
          {
            tex: String.raw`\rho=|\delta_0|-n_c\,h=${T(absD, kR)}-${txInt(nc)}\times${P(h, kR)}=${T(absD, kR)}-${P(nh, kR)}=${T(rho)}`,
            why: String.raw`走完 $n_c$ 步後剩下「不到一步」的距離。` + moreDigits(kR, absD, nh),
          },
          {
            tex: String.raw`w_{n_c}=a-\operatorname{sgn}(\delta_0)\,\rho=${T(a)}-(${sgnTex(dir)})\times${P(rho)}=${T(a)}-${P(dir * rho)}=${T(before)}`,
            why: String.raw`第 $n_c$ 步的位置：還在出發的那一側，離 $a$ 只剩 $\rho$。乘 $\operatorname{sgn}(\delta_0)=\pm1$ 只是決定正負號。`,
          },
          {
            tex: String.raw`w_{n_c+1}=a+\operatorname{sgn}(\delta_0)\,(h-\rho)=${T(a)}+(${sgnTex(dir)})\times(${T(h, kG)}-${P(rho, kG)})=${T(a)}+(${sgnTex(dir)})\times${P(gap)}=${T(a)}+${P(dir * gap)}=${T(after)}`,
            why: String.raw`再走一步就衝過頭，落在另一側、離 $a$ 的距離是 $h-\rho$；下一步又被拉回 $w_{n_c}$。` + moreDigits(kG, h, rho),
          },
          {
            tex: String.raw`w_{\rm lo}=\min(${T(before)},\ ${T(after)})=${T(lo)},\qquad w_{\rm hi}=\max(${T(before)},\ ${T(after)})=${T(hi)}`,
            why: String.raw`來回跳動的就是這兩點；依大小排好（$\delta_0>0$ 時 $w_{n_c}$ 在下面，$\delta_0<0$ 時在上面）。`,
          },
          {
            tex: String.raw`\bar w=\tfrac12\big(w_{n_c}+w_{n_c+1}\big)=\tfrac12\times\big(${T(before)}+${P(after)}\big)=\tfrac12\times${P(sum)}=${T(mean)}`,
            why: '兩點各佔一半時間，時間平均就是中點：先相加、再除以 2。',
          },
        ],
        results: [
          { symbol: 'n_c', label: String.raw`越過 $a$ 之前走的整步數`, value: nc, unit: SAMPLES, digits: 9, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: String.raw`w_{\rm lo}`, label: '跳動的兩點中較小的', value: lo, digits: resultDigits(lo), tolerance: { abs: 0.005 * h, rel: 0.005 } },
          { symbol: String.raw`w_{\rm hi}`, label: '跳動的兩點中較大的', value: hi, digits: resultDigits(hi), tolerance: { abs: 0.005 * h, rel: 0.005 } },
          { symbol: String.raw`\bar w`, label: '時間平均', value: mean, digits: resultDigits(mean), tolerance: { abs: 0.005 * h, rel: 0.005 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`只有一次除法、一次「捨去小數」、幾次加減乘。先算 $h$，再看 $|\delta_0|$ 裡有幾個 $h$。$\lfloor\cdot\rfloor$ 是無條件捨去：$\lfloor7.5\rfloor=7$、$\lfloor7.99\rfloor=7$（不是四捨五入）。`,
      String.raw`範例數字（$a=3,\ x=1,\ w_0=0,\ \mu=0.4$）：$h=0.4$、$n_c=7$、$\rho=0.2$，在 $2.8$ 與 $3.2$ 之間跳——與內文和下方實驗的預設相同。`,
      String.raw`把 $w_0$ 改成 $0.1$：兩點變成 $2.9$ 與 $3.3$，時間平均 $3.1$，不再等於 $a$（偏差由起點決定）。`,
    ],
  },

  /* ───────────── §3 遞減步長 ───────────── */
  {
    id: 'HC-02.3',
    title: String.raw`遞減步長 $\mu_n=\mu_0/(1+n/n_0)$：第 $n$ 步的帶寬與走到目標要幾步`,
    page: PAGE,
    formulaId: 'F-02.11',
    formulaTex: String.raw`\mu_n=\frac{\mu_0}{1+n/n_0},\qquad \sum_{k<n}\mu_k|x|\approx c\,\ln\!\Big(1+\frac{n}{n_0}\Big),\qquad N_{\rm reach}\approx n_0\big(\mathrm{e}^{D/c}-1\big),\qquad c=\mu_0\,n_0\,|x|`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mu0', symbol: String.raw`\mu_0`, label: '初始步長', default: 0.4, min: 0, max: 10, practice: { choices: [0.2, 0.4, 0.5] } },
      { key: 'n0', symbol: 'n_0', label: '排程的時間常數', unit: SAMPLES, default: 20, min: 1, max: 100000, integer: true, practice: { choices: [10, 20, 50] } },
      { key: 'n', symbol: 'n', label: '想知道第幾步的步長', unit: SAMPLES, default: 60, min: 0, max: 100000, integer: true, practice: { choices: [10, 20, 30, 60, 100, 150] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', default: 1, min: -100, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'D', symbol: 'D', label: String.raw`要走的距離 $|a-w_0|$`, default: 3, min: 0, max: 1000, practice: { choices: [1, 2, 3, 4] } },
    ],
    validate: ({ mu0, n0, x, D }) => {
      if (mu0 <= 0) return String.raw`初始步長 $\mu_0$ 必須大於 0。`
      if (x === 0) return String.raw`$x=0$：每步移動量 $\mu_n|x|=0$，永遠走不到（也沒有 $a$ 的資訊）。請換一個非零的 $x$。`
      if (D <= 0) return String.raw`要走的距離 $D$ 必須大於 0（$D=0$ 表示一開始就在目標上，不需要走）。`
      const t = D / (mu0 * n0 * Math.abs(x))
      if (t > 50)
        return String.raw`$D/(\mu_0n_0|x|)=${N(t, 4)}>50$：需要的步數超過 $n_0\,\mathrm{e}^{50}\approx5\times10^{21}\,n_0$，實務上就是走不到（stall）。請加大 $\mu_0$ 或 $n_0$——或像工程上做的：先用固定步長粗調到附近，再開始衰減。`
      return null
    },
    solve: ({ mu0, n0, n, x, D }) => {
      const sched: Schedule = { kind: 'harmonic', n0 }
      const absX = Math.abs(x)
      const frac = n / n0
      const shrink = 1 + frac // 步長被縮小的倍數
      const mun = stepSize(mu0, n, sched)
      const band = mun * absX
      const c = mu0 * n0 * absX
      const lnS = Math.log1p(frac)
      const dApprox = harmonicTravelApprox(mu0, absX, n0, n)
      const dExact = travelDistance(mu0, absX, sched, n)
      const t = D / c
      const eT = Math.exp(t)
      const em1 = Math.expm1(t)
      const nEst = harmonicReachSteps(D, mu0, absX, n0)
      const nExact = stepsToTravel(D, mu0, absX, sched, 200_000)
      // N_reach 要寫到看得出 ⌈N_reach⌉ 是多少（9.00004 不能寫成 9）；eᵗ − 1 跟著寫一樣多位，eᵗ 則要寫到「減 1 之後還有這麼多位」
      const kN = Number.isFinite(nExact) ? sigRoundArg(nEst, Math.ceil(nEst), 'ceil') : 5
      const kE = Math.max(sigFor(em1, eT, 1), sigAt(eT, decimalsFor(em1, kN)))
      const nEst2 = harmonicReachSteps(2 * D, mu0, absX, n0)
      const notes = [
        String.raw`距離加倍（$2D=${N(2 * D)}$）：$N\approx n_0(\mathrm{e}^{2D/c}-1)=${N(nEst2, 4)}$ 步，是原來的 $${N(nEst2 / nEst, 3)}$ 倍而不是 2 倍——遞減步長「走遠路」的代價是指數的。`,
      ]
      if (D / (mu0 * absX) <= 1e6)
        notes.push(
          String.raw`固定步長 $\mu_0$ 只要 $\lceil D/(\mu_0|x|)\rceil=${stepsToTravel(D, mu0, absX, CONST)}$ 步就到，但之後永遠在 $\pm\mu_0|x|=\pm${N(mu0 * absX)}$ 的帶內跳（HC-02.2）；遞減步長是用「走得慢」換「停得下來」。`,
        )
      return {
        steps: [
          { tex: String.raw`1+\frac{n}{n_0}=1+\frac{${txInt(n)}}{${txInt(n0)}}=1+${T(frac)}=${T(shrink)}`, why: String.raw`步長被縮小的倍數：先除、再加 1。$n=n_0$ 時剛好是 2（步長減半）。` },
          { tex: String.raw`\mu_n=\frac{\mu_0}{1+n/n_0}=\frac{${T(mu0)}}{${T(shrink)}}=${T(mun)}`, why: String.raw`第 $n$ 步實際使用的步長（網站的 stepSize()）。` },
          { tex: String.raw`\mu_n\,|x|=${P(mun)}\times${P(absX)}=${T(band)}`, why: String.raw`這時 Sign-Error 每步的移動量，也就是跳動帶的半寬：隨 $n$ 縮小，所以「停得下來」。` },
          {
            tex: String.raw`c=\mu_0\,n_0\,|x|=${P(mu0)}\times${txInt(n0)}\times${P(absX)}=${P(mu0 * n0)}\times${P(absX)}=${T(c)}`,
            why: String.raw`距離的尺度（連乘兩次）：步數每變成 $\mathrm{e}\approx2.718$ 倍，才多走一個 $c$。`,
          },
          { tex: String.raw`\ln\!\Big(1+\frac{n}{n_0}\Big)=\ln(${T(shrink)})=${T(lnS)}`, why: String.raw`計算機按 $\ln$（自然對數，不是 $\log_{10}$）；括號裡就是第 1 步算好的數。` },
          {
            tex: String.raw`\sum_{k<n}\mu_k|x|\approx c\,\ln\!\Big(1+\frac{n}{n_0}\Big)=${P(c)}\times${P(lnS)}=${T(dApprox)}`,
            why: String.raw`前 $n$ 步總共能移動的距離（把和換成積分）。網站逐步累加（travelDistance()）的精確值是 $${N(dExact)}$：積分近似略為低估，因為每一項 $\mu_k$ 都不小於它右邊那一小段積分。`,
          },
          { tex: String.raw`\frac{D}{c}=\frac{${T(D)}}{${T(c)}}=${T(t)}`, why: String.raw`要走的距離是 $c$ 的幾倍——這個數會跑到指數上。` },
          {
            tex: String.raw`\mathrm{e}^{D/c}=\mathrm{e}^{${T(t)}}=${T(eT, kE)}`,
            why: String.raw`計算機按 $\mathrm{e}^x$（多半是 SHIFT 加 $\ln$ 鍵）。下一步要減 1，所以這裡要多留幾位：$D/c$ 越小，$\mathrm{e}^{D/c}$ 越接近 1，要留的位數越多。`,
          },
          {
            tex: String.raw`N_{\rm reach}\approx n_0\big(\mathrm{e}^{D/c}-1\big)=${txInt(n0)}\times(${T(eT, kE)}-1)=${txInt(n0)}\times${P(em1, kN)}=${T(nEst, kN)}`,
            why: Number.isFinite(nExact)
              ? String.raw`走完距離 $D$ 大約需要的步數（F-02.11）：先減 1、再乘 $n_0$。網站逐步累加（stepsToTravel()）：實際第 $${nExact}$ 步走到。步數是整數，要拿無條件進位的 $\lceil N_{\rm reach}\rceil=${txInt(Math.ceil(nEst))}$ 來比：因為「和 $\ge$ 積分」，實際步數一定不超過它。`
              : String.raw`走完距離 $D$ 大約需要的步數（F-02.11）：先減 1、再乘 $n_0$。超過 $2\times10^5$ 步，網站不再逐步累加驗證。`,
          },
        ],
        results: [
          { symbol: String.raw`\mu_n`, label: String.raw`第 $n$ 步的步長`, value: mun },
          { symbol: String.raw`\mu_n|x|`, label: String.raw`第 $n$ 步的跳動帶半寬`, value: band },
          { symbol: String.raw`\textstyle\sum_{k<n}\mu_k|x|`, label: String.raw`前 $n$ 步可移動的距離（積分近似）`, value: dApprox, tolerance: { rel: 0.02 } },
          { symbol: String.raw`N_{\rm reach}`, label: String.raw`走完 $D$ 約需的步數（近似式）`, value: nEst, unit: SAMPLES, tolerance: { rel: 0.02 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`需要計算機的只有 $\ln$ 與 $\mathrm{e}^x$ 各一次。注意是自然對數：$\ln u=2.3026\,\log_{10}u$。`,
      String.raw`$\mathrm{e}^{D/c}$ 算出來先不要四捨五入：下一步要減 1，$D/c$ 小的時候前面幾位會被減掉（例如 $1.0833-1$ 只剩三位有效數字）。計算機有 $\mathrm{e}^x-1$ 鍵就直接用它。`,
      String.raw`沒有計算機時：$t\le0.2$ 可用 $\mathrm{e}^{t}-1\approx t\,(1+t/2)$（誤差 $<0.7\%$）；$u\le0.1$ 可用 $\ln(1+u)\approx u-u^2/2$（誤差 $<0.4\%$）。超出範圍就老實按計算機。`,
      String.raw`範例數字（$\mu_0=0.4,\ n_0=20,\ D=3,\ x=1$）：$D/c=0.375$、$N_{\rm reach}\approx9.1$，網站逐步累加是 9 步——與內文相同。`,
      String.raw`試試內文的 stall 例子 $\mu_0=0.01,\ n_0=10$：$D/c=30$，$N\approx10\,\mathrm{e}^{30}\approx10^{14}$ 步。`,
    ],
  },

  /* ───────────── §4 三種更新並排 ───────────── */
  {
    id: 'HC-02.4',
    title: '同一組數字，三種更新各走一步：LMS／Sign-Error／Sign-Sign',
    page: PAGE,
    formulaId: 'F-02.7',
    formulaTex: String.raw`e=y-w\,x,\qquad \Delta w_{\rm LMS}=\mu\,e\,x,\qquad \Delta w_{\rm SE}=\mu\operatorname{sign}(e)\,x,\qquad \Delta w_{\rm SS}=\mu\operatorname{sign}(e)\operatorname{sign}(x)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的係數', default: 1, min: -20, max: 20, practice: { min: -2, max: 4, step: 0.5 } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -10, max: 10, practice: { choices: [-3, -2, -1, 0.5, 1, 2, 3] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 6, min: -100, max: 100, practice: { min: -9, max: 9, step: 1.5 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '步長', default: 0.1, min: 0, max: 5, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
    ],
    validate: ({ mu }) => (mu <= 0 ? String.raw`步長 $\mu$ 必須大於 0（$\mu=0$ 時三種更新都不動）。` : null),
    solve: ({ w, x, y: yIn, mu }) => {
      const y = tieSafeY(w, x, yIn) // 精確算術下 e = 0 的輸入不被浮點殘值誤判成 e ≠ 0
      const l = conventionalStep({ w, x, y, mu })
      const se = signErrorStep({ w, x, y, mu, tie: 'zero' })
      const ss = signSignStep({ w, x, y, mu, tie: 'zero' })
      const e = l.e
      const wx = w * x
      const qe = Math.sign(e)
      const qx = Math.sign(x)
      // w + Δw 剛好抵銷時（例如 0.3 + (−0.3)）精確值是 0
      const wL = zsum(l.w, w, l.dw)
      const wSe = zsum(se.w, w, se.dw)
      const wSs = zsum(ss.w, w, ss.dw)
      const kE = sigFor(e, y, wx)
      const notes: string[] = []
      if (x === 0) notes.push(String.raw`$x=0$：這筆資料不含 $a$ 的資訊，三種更新都是 0。`)
      else if (e === 0)
        notes.push(
          String.raw`$e=0$：這裡用數學慣例 $\operatorname{sign}(0)=0$，三者都不動。硬體 comparator 只會輸出 $\pm1$，Sign-Error／Sign-Sign 仍會被推開一步——所以 $\operatorname{sign}(0)$ 的慣例一定要明定（勘誤 E40）。`,
        )
      else {
        notes.push(
          String.raw`三者方向相同（都朝這筆資料的比值 $y/x=${N(y / x)}$ 走），只有步伐不同：LMS $\mu|e||x|=${N(Math.abs(l.dw))}$、Sign-Error $\mu|x|=${N(Math.abs(se.dw))}$、Sign-Sign $\mu=${N(Math.abs(ss.dw))}$。`,
        )
        notes.push(
          Math.abs(x) === 1
            ? String.raw`$|x|=1$ 時 Sign-Error 與 Sign-Sign 完全相同；把 $x$ 改成 $2$ 或 $0.5$ 才看得出差別。`
            : String.raw`離目標遠（$|e|$ 大）時 LMS 走得最快；靠近目標時 LMS 的步伐自動變小，兩個 sign 演算法卻還是同樣大小——所以它們會衝過頭（HC-02.2）。`,
        )
      }
      return {
        steps: [
          {
            tex: String.raw`e=y-w\,x=${T(y, kE)}-${P(w)}\times${P(x)}=${T(y, kE)}-${P(wx, kE)}=${T(e)}`,
            why: '三種演算法的第一步都一樣：先預測（一次乘法），再和量測比較（一次減法）。' + moreDigits(kE, y, wx),
          },
          { tex: String.raw`\operatorname{sign}(e)=${sgnTex(qe)},\qquad \operatorname{sign}(x)=${sgnTex(qx)}`, why: '只留正負號——這就是 1-bit comparator 給的全部資訊。' },
          {
            tex: String.raw`\Delta w_{\rm LMS}=\mu\,e\,x=${P(mu)}\times${P(e)}\times${P(x)}=${P(mu * e)}\times${P(x)}=${T(l.dw)}`,
            why: String.raw`LMS：步伐正比於誤差大小（需要多位元的 $e$ 與乘法器）。連乘兩次。`,
          },
          { tex: String.raw`w_{\rm LMS}=w+\Delta w_{\rm LMS}=${T(w)}+${P(l.dw)}=${T(wL)}`, why: 'LMS 走一步之後。' },
          {
            tex: String.raw`\Delta w_{\rm SE}=\mu\operatorname{sign}(e)\,x=${P(mu)}\times(${sgnTex(qe)})\times${P(x)}=${T(se.dw)}`,
            why: String.raw`Sign-Error：只看誤差的正負號，步伐固定是 $\mu|x|$（硬體是「加或減 $x$」）。乘 $\pm1$ 只是決定正負號。`,
          },
          { tex: String.raw`w_{\rm SE}=w+\Delta w_{\rm SE}=${T(w)}+${P(se.dw)}=${T(wSe)}`, why: 'Sign-Error 走一步之後。' },
          {
            tex: String.raw`\Delta w_{\rm SS}=\mu\operatorname{sign}(e)\operatorname{sign}(x)=${P(mu)}\times(${sgnTex(qe)})\times(${sgnTex(qx)})=${T(ss.dw)}`,
            why: String.raw`Sign-Sign：連 $x$ 的大小也丟掉，步伐固定是 $\mu$（硬體是 XOR 加上一個上下數計數器）。`,
          },
          { tex: String.raw`w_{\rm SS}=w+\Delta w_{\rm SS}=${T(w)}+${P(ss.dw)}=${T(wSs)}`, why: 'Sign-Sign 走一步之後。' },
        ],
        results: [
          { symbol: String.raw`w_{\rm LMS}`, label: 'LMS', value: wL, digits: resultDigits(wL) },
          { symbol: String.raw`w_{\rm SE}`, label: 'Sign-Error', value: wSe, digits: resultDigits(wSe) },
          { symbol: String.raw`w_{\rm SS}`, label: 'Sign-Sign', value: wSs, digits: resultDigits(wSs) },
        ],
        notes,
      }
    },
    tips: [
      String.raw`先算一次共用的 $e$，再把「$e$」「$\operatorname{sign}(e)$」「$\operatorname{sign}(e)\operatorname{sign}(x)$」分別乘上去。`,
      String.raw`範例數字就是 T01（$w=1,\ x=2,\ y=6,\ \mu=0.1$）：LMS 得 $1.8$、Sign-Error $1.2$、Sign-Sign $1.1$。`,
      String.raw`負的 $x$ 最容易錯：$\operatorname{sign}(e)\,x$ 要帶著 $x$ 的負號，$\operatorname{sign}(x)=-1$ 也要乘進去。`,
      String.raw`單位：這裡的數字都當成無因次。套到硬體時，同一個符號 $\mu$ 在三種更新裡單位不同——LMS 是 $1/[x]^2$、Sign-Error 是 $[w]/[x]$、Sign-Sign 是 $[w]$（$[w]=[y]/[x]$）；所以「同一個 $\mu=0.1$」只是數字相同，三者的步伐本來就不能直接比大小。`,
    ],
  },

  /* ───────────── §4 比值觀點 ───────────── */
  {
    id: 'HC-02.5',
    title: String.raw`比值觀點：三筆資料、四個固定點（平均 vs 中位數）`,
    page: PAGE,
    formulaId: 'F-02.9',
    formulaTex: String.raw`r_i=\frac{y_i}{x_i},\qquad w^*_{\rm LMS}=\frac{\sum x_iy_i}{\sum x_i^2},\qquad w^*_{\rm SE}=\operatorname{wmed}_{|x_i|}(r_i),\qquad w^*_{\rm SS}=\operatorname{med}(r_i),\qquad w^*_{\rm NLMS}=\frac1N\sum r_i`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'x1', symbol: 'x_1', label: '第 1 筆的輸入', default: 1, min: -20, max: 20, practice: { choices: [-2, -1, 1, 2, 4, 5] } },
      { key: 'y1', symbol: 'y_1', label: '第 1 筆的輸出', default: 3, min: -100, max: 100, practice: { min: -4, max: 12, step: 1 } },
      { key: 'x2', symbol: 'x_2', label: '第 2 筆的輸入', default: 2, min: -20, max: 20, practice: { choices: [-2, -1, 1, 2, 4, 5] } },
      { key: 'y2', symbol: 'y_2', label: '第 2 筆的輸出', default: 7, min: -100, max: 100, practice: { min: -4, max: 12, step: 1 } },
      { key: 'x3', symbol: 'x_3', label: '第 3 筆的輸入', default: 4, min: -20, max: 20, practice: { choices: [-2, -1, 1, 2, 4, 5] } },
      { key: 'y3', symbol: 'y_3', label: '第 3 筆的輸出', default: 10, min: -100, max: 100, practice: { min: -4, max: 12, step: 1 } },
    ],
    validate: (v) => {
      const xs = [v.x1, v.x2, v.x3]
      const ys = [v.y1, v.y2, v.y3]
      const zero = xs.findIndex((x) => x === 0)
      if (zero >= 0) return String.raw`$x_${zero + 1}=0$：這筆資料的比值 $y/x$ 沒有定義，也不含 $a$ 的資訊（模型會直接略過它）。請換一個非零的 $x$。`
      const se = ratioFixedPoints(xs, ys).signError
      if (se[0] !== se[1])
        return String.raw`累積票數剛好等於總票數的一半：$|x|$ 加權中位數不是單一點，而是整段區間 $[${N(se[0])},\ ${N(se[1])}]$（成本 $\sum|x_i||r_i-w|$ 的谷底是平的，區間內每一點都一樣好）。這一題要單一答案，請把其中一個 $x$ 改掉。`
      return null
    },
    solve: (v) => {
      const xs = [v.x1, v.x2, v.x3]
      const ys = [v.y1, v.y2, v.y3]
      const rf = ratioFixedPoints(xs, ys)
      const r = xs.map((x, i) => ys[i] / x)
      const rScale = Math.max(...r.map(Math.abs))
      const rSum = snapZero(r[0] + r[1] + r[2], rScale)
      const wNlms = snapZero(rf.nlms, rScale) // 例如 0.2 + 0.4 − 0.6：精確值是 0
      const order = [0, 1, 2].sort((i, j) => r[i] - r[j] || i - j) // 比值由小到大（同值時依原順序）
      const prods = xs.map((x, i) => x * ys[i])
      const sxy = zsum(prods[0] + prods[1] + prods[2], ...prods) // 例如 0.1×3 − 0.3×1：精確值是 0
      const sxx = xs.reduce((acc, x) => acc + x * x, 0)
      const wLms = sxy === 0 ? 0 : rf.lms
      const W = xs.reduce((acc, x) => acc + Math.abs(x), 0)
      const cum: number[] = []
      order.reduce((acc, i) => {
        cum.push(acc + Math.abs(xs[i]))
        return acc + Math.abs(xs[i])
      }, 0)
      // 「第一次超過一半」：容許度與模型的 weightedMedian() 相同（0.1 + 0.2 這種 double 尾巴不算超過）
      const kSe = cum.findIndex((cw) => cw - W / 2 > 1e-12 * W)
      // 比值寫不完（例如 10/3）而且相加會互相抵銷時，多顯示幾位
      const kR = sigFor(rSum, ...r)
      const sorted = order.map((i, k) => String.raw`r_{(${k + 1})}=${T(r[i], kR)}\ (|x|=${T(Math.abs(xs[i]))})`).join(String.raw`\ \le\ `)
      return {
        steps: [
          {
            tex: String.raw`\begin{aligned}${xs.map((x, i) => String.raw`r_${i + 1}&=\frac{y_${i + 1}}{x_${i + 1}}=\frac{${T(ys[i])}}{${T(x)}}=${T(r[i], kR)}`).join(String.raw`\\ `)}\end{aligned}`,
            why: String.raw`每一筆資料自己對 $a$ 的估計（比值）。四種演算法只是用不同的方式找這三個數的「中心」。` + moreDigits(kR, ...r),
          },
          {
            tex: String.raw`\sum x_iy_i=${xs.map((x, i) => String.raw`${P(x)}\times${P(ys[i])}`).join('+')}=${prods.map((q) => P(q)).join('+')}=${T(sxy)}`,
            why: 'LMS 的分子：三個乘積先各自算好，再相加。',
          },
          { tex: String.raw`\sum x_i^2=${xs.map((x) => Q(x)).join('+')}=${xs.map((x) => T(x * x)).join('+')}=${T(sxx)}`, why: 'LMS 的分母（總輸入功率）：三個平方相加。' },
          {
            tex: String.raw`w^*_{\rm LMS}=\frac{\sum x_iy_i}{\sum x_i^2}=\frac{${T(sxy)}}{${T(sxx)}}=${T(wLms)}`,
            why: String.raw`也就是 $r_i$ 的 $x_i^2$ 加權平均：$|x|$ 大的那一筆份量重很多。`,
          },
          {
            tex: String.raw`w^*_{\rm NLMS}=\frac{r_1+r_2+r_3}{3}=\frac{${r.map((q) => P(q, kR)).join('+')}}{3}=\frac{${T(rSum)}}{3}=${T(wNlms)}`,
            why: String.raw`NLMS（$\varepsilon=0$）：不加權的平均，每筆份量相同。先加起來、再除以 3。`,
          },
          { tex: sorted, why: String.raw`把比值由小到大排好，旁邊記下各自的 $|x|$（等一下當票數）。` },
          {
            tex: String.raw`w^*_{\rm SS}=\operatorname{med}(r_i)=r_{(2)}=${T(rf.signSign[0], kR)}`,
            why: 'Sign-Sign：不加權中位數——每筆一票，三個數排序後中間那個。',
          },
          {
            tex: String.raw`W=\sum|x_i|=${order.map((i) => T(Math.abs(xs[i]))).join('+')}=${T(W)},\qquad \tfrac{W}{2}=\tfrac{${T(W)}}{2}=${T(W / 2)}`,
            why: String.raw`Sign-Error：每筆的票數是 $|x_i|$；過半的門檻是總票數的一半。`,
          },
          {
            tex: String.raw`\text{累積票數：}${cum.map((cw) => T(cw)).join(String.raw`,\ `)}\;\Rightarrow\;\text{第一次超過 }${T(W / 2)}\text{ 的是 }r_{(${kSe + 1})}\;\Rightarrow\;w^*_{\rm SE}=${T(rf.signError[0], kR)}`,
            why: String.raw`$|x|$ 加權中位數：照排序由小到大累加票數，第一次超過一半的那個比值。`,
          },
        ],
        results: [
          { symbol: String.raw`w^*_{\rm LMS}`, label: String.raw`LMS（$x^2$ 加權平均）`, value: wLms },
          { symbol: String.raw`w^*_{\rm SE}`, label: String.raw`Sign-Error（$|x|$ 加權中位數）`, value: rf.signError[0] },
          { symbol: String.raw`w^*_{\rm SS}`, label: 'Sign-Sign（中位數）', value: rf.signSign[0] },
          { symbol: String.raw`w^*_{\rm NLMS}`, label: 'NLMS（平均）', value: wNlms },
        ],
        notes: [
          String.raw`同一組資料、四個演算法、四個「中心」。把其中一筆的 $y$ 改成很離譜的數（outlier）再算一次：兩個平均會被拉走，兩個中位數通常不動。`,
          String.raw`這是「批次固定點」：把這三筆反覆循環餵給演算法、$\mu$ 夠小時的收斂點（思考題 4）；sign 類演算法實際上會在它附近以 $\pm\mu|x|$ 跳動。`,
        ],
      }
    },
    tips: [
      String.raw`全部是加減乘除與排序。加權中位數的做法：排序 $\to$ 由小到大累加票數 $\to$ 第一次超過總票數一半就停。`,
      String.raw`範例（$(1,3),\ (2,7),\ (4,10)$）：LMS $57/21=2.7143$、Sign-Error $2.5$、Sign-Sign $3$、NLMS $3$——與內文的表格相同。`,
      String.raw`想確認 LMS 的答案：$\sum x_i\,(y_i-w^*x_i)$ 應該等於 0（固定點條件 $\sum e_ix_i=0$）。`,
    ],
  },

  /* ───────────── §4 固定點偏移：平均 vs 中位數 ───────────── */
  {
    id: 'HC-02.6',
    title: String.raw`單邊突波（outlier）：LMS 被拉走多少、Sign-Error 被拉走多少`,
    page: PAGE,
    formulaId: 'F-02.18',
    formulaTex: String.raw`\psi_{\rm LMS}(a)=E[v]\,E[x],\quad \psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x];\qquad x\equiv A:\ \ w^*_{\rm LMS}=a+\frac{E[v]}{A},\quad w^*_{\rm SE}=a+\frac{\operatorname{med}(v)}{A},\quad \operatorname{med}(v)\approx\sigma_v\,\Phi^{-1}\!\Big(\frac{1}{2(1-p_{\rm out})}\Big)`,
    level: 'research',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實係數', default: 3, min: -50, max: 50, practice: { choices: [2, 3, 4] } },
      { key: 'A', symbol: 'A', label: String.raw`code 的值（常數 $x\equiv A$，所以 $E[x]=A\neq0$）`, default: 1, min: -20, max: 20, practice: { choices: [0.5, 1, 2] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'Gaussian 雜訊的標準差', default: 0.3, min: 0, max: 100, practice: { choices: [0.2, 0.3, 0.5, 1] } },
      { key: 'p', symbol: String.raw`p_{\rm out}`, label: '每筆出現突波的機率', default: 0.05, min: 0, max: 1, practice: { choices: [0.02, 0.05, 0.1, 0.2] } },
      { key: 's', symbol: 's', label: '突波的大小（只往正的方向）', default: 20, min: 0, max: 1000, practice: { choices: [10, 20, 40] } },
    ],
    validate: ({ A, sigma, p, s }) => {
      if (A === 0) return String.raw`$A=0$：$x\equiv0$ 不含 $a$ 的資訊（不可辨識），沒有固定點。`
      if (sigma <= 0) return String.raw`$\sigma_v$ 必須大於 0：沒有 Gaussian 雜訊時 $\operatorname{sign}$ 不會被平滑，Sign-Error 是確定性的 limit cycle（HC-02.2），沒有連續的中位數可談。`
      if (p >= 0.5) return String.raw`$p_{\rm out}\ge\tfrac12$：超過一半的樣本都是突波，中位數會跳到突波那一群（$s$ 附近），$\frac{1}{2(1-p_{\rm out})}\ge1$ 也沒有 $\Phi^{-1}$。這一題只討論少數突波。`
      if (p > OUTLIER_MAX_PROB)
        return String.raw`$p_{\rm out}>${OUTLIER_MAX_PROB}$：中位數已經被推到 Gaussian 的尾巴，手算用的近似「突波全在中位數右邊」誤差變大。這一題限制 $p_{\rm out}\le${OUTLIER_MAX_PROB}$。`
      if (s < OUTLIER_MIN_SIGMAS * sigma)
        return String.raw`突波離雜訊主體不夠遠（$s<${OUTLIER_MIN_SIGMAS}\,\sigma_v=${N(OUTLIER_MIN_SIGMAS * sigma)}$）：被忽略的 $p_{\rm out}\Phi\big((m-s)/\sigma_v\big)$ 不再是 0，中位數要用數值解。請加大 $s$ 或減小 $\sigma_v$。`
      return null
    },
    solve: ({ a, A, sigma, p, s }) => {
      const { noise, inp } = outlierModel(a, A, sigma, p, s)
      const ops = noiseOps(noise)
      const Ev = ops.mean // E[v] = p·s
      // p_out = 0 時下列各量的精確值是 0；模型用數值積分／二分法求得，會留下 10⁻¹⁷ 量級的殘值 ⇒ snapZero
      const signV = snapZero(ops.signMean(0), 1) // E[sign v] = 1 − 2F_v(0)
      const psiL = snapZero(meanFieldDrift('lms', a, inp), A) // ψ_LMS(a)
      const psiS = snapZero(meanFieldDrift('sign_error', a, inp), A) // ψ_SE(a)
      const pullL = Ev / A // LMS 固定點被拉走的量 E[v]/A
      const wL = zsum(meanFieldAnalysis('lms', inp).wStar, a, pullL)
      const med = snapZero(noiseMedian(noise), sigma)
      const wS = zsum(meanFieldAnalysis('sign_error', inp).wStar, a, med / A)
      const shiftS = snapZero(wS - a, sigma / A) // Sign-Error 固定點被拉走的量（= med(v)/A，兩者由模型各自求得）
      const keep = 1 - p
      const q = 1 / (2 * keep)
      const dq = snapZero(q - 0.5, 1)
      const z = med / sigma // = Φ⁻¹(q)（s ≥ 6σ_v 時差異 < 10⁻⁶）
      const t = Math.sqrt(2 * Math.PI) * (q - 0.5)
      const zApprox = t + t ** 3 / 6
      const kQ = sigFor(dq, q, 0.5) // q 很接近 ½：要寫到「減 ½ 之後還有 5 位有效數字」
      const kL = sigFor(wL, a, pullL)
      // w*_SE = a + 偏移：寫到和偏移同一個小數位，才看得出這個很小的偏移
      const kS = shiftS === 0 ? 5 : Math.max(5, Math.min(10, sigAt(wS, decimalsFor(shiftS, 5))))
      // 沒有常態表時的近似 z ≈ t + t³/6：依這一題的 |z| 說明它有多準（適用範圍由 handcalcs.test.tsx 逐點驗算）
      const approxHint =
        Math.abs(z) < 1e-12
          ? String.raw`這裡 $q=\tfrac12$，所以 $z=0$，不必查表。`
          : Math.abs(z) <= 0.3
            ? String.raw`沒有表時用 $z\approx t+t^3/6=${N(zApprox)}$（$|z|\le0.3$ 時誤差 $<0.05\%$；只用 $z\approx t$ 則要 $|z|\le0.1$ 才有 $<0.2\%$）。`
            : Math.abs(z) <= 0.5
              ? String.raw`沒有表時用 $z\approx t+t^3/6=${N(zApprox)}$（這裡 $|z|>0.3$：誤差放寬到 $<0.4\%$，適用到 $|z|\le0.5$；只用 $z\approx t$ 會差到 $${N((100 * Math.abs(t - z)) / Math.abs(z), 2)}\%$）。`
              : String.raw`沒有表時用 $z\approx t+t^3/6=${N(zApprox)}$（這裡 $|z|>0.5$，誤差約 $${N((100 * Math.abs(zApprox - z)) / Math.abs(z), 2)}\%$——仍在這一題對答案的容許範圍內；想更準請查表）。`
      const shiftL = snapZero(wL - a, sigma / A)
      const notes = [
        p === 0
          ? String.raw`$p_{\rm out}=0$：沒有突波，平均和中位數都是 0，兩個固定點都在 $a$。`
          : String.raw`LMS 的偏移 $${N(shiftL)}$ 是 Sign-Error 偏移 $${N(shiftS)}$ 的 $${N(shiftL / shiftS, 3)}$ 倍。把 $s$ 加倍：LMS 的偏移跟著加倍；Sign-Error 完全不變——中位數只數「有幾筆在右邊」，不管它們跑多遠。`,
        String.raw`對照網站：mean-field 直接用二分法解 $\psi(w^*)=0$，得到 LMS $${N(wL, 6)}$、Sign-Error $${N(wS, 6)}$；在 $w=a$ 處 $\psi_{\rm SE}(a)=${N(psiS)}$（精確值，含被忽略的極小項）。`,
        String.raw`如果 code 是對稱的（$E[x]=0$，例如 $x=\pm A$），$\psi_{\rm LMS}(a)$ 與 $\psi_{\rm SE}(a)$ 都是 0，兩個固定點都回到 $a$：零均值的 code 讓校正對不對稱的雜訊免疫（F-02.18）。`,
      ]
      return {
        steps: [
          { tex: String.raw`E[v]=p_{\rm out}\,s=${P(p)}\times${P(s)}=${T(Ev)}`, why: String.raw`雜訊的平均：Gaussian 部分平均是 0，只剩突波的貢獻（機率 $\times$ 大小）。` },
          { tex: String.raw`\psi_{\rm LMS}(a)=E[v]\,E[x]=${P(Ev)}\times${P(A)}=${T(psiL)}`, why: String.raw`站在真值 $w=a$ 上，LMS 的平均更新方向（F-02.18；常數 code 的 $E[x]=A$）。` + (psiL === 0 ? String.raw`這一題是 0：$a$ 就是 LMS 的固定點。` : String.raw`不是 0，所以 $a$ 不是 LMS 的固定點。`) },
          {
            tex: String.raw`w^*_{\rm LMS}=a+\frac{E[v]\,E[x]}{E[x^2]}=a+\frac{E[v]\,A}{A^2}=a+\frac{E[v]}{A}=${T(a, kL)}+\frac{${T(Ev)}}{${T(A)}}=${T(a, kL)}+${P(pullL, kL)}=${T(wL)}`,
            why: String.raw`令 $\psi_{\rm LMS}(w)=(a-w)A^2+E[v]A=0$：LMS 的固定點被「雜訊的平均」拉走 $E[v]/A=p_{\rm out}s/A$（先除、再加）。`,
          },
          {
            tex: String.raw`E[\operatorname{sign}v]\approx\Big(\frac{1-p_{\rm out}}{2}+p_{\rm out}\Big)-\frac{1-p_{\rm out}}{2}=p_{\rm out}=${T(signV)}`,
            why: String.raw`「正的機率」減「負的機率」：Gaussian 部分一半一半，突波（$s\gg\sigma_v$）幾乎一定是正的。`,
          },
          {
            tex: String.raw`\psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x]=${P(signV)}\times${P(A)}=${T(psiS)}`,
            why:
              p === 0
                ? String.raw`沒有突波時也是 0：Sign-Error 的固定點同樣在 $a$。下面幾步照樣算一次，會得到中位數 0。`
                : String.raw`也不是 0，所以 Sign-Error 的固定點也不在 $a$——但它看的是「中位數」，只要挪一點點就能讓左右機率重新平衡：`,
          },
          {
            tex: String.raw`q=\frac{1}{2\,(1-p_{\rm out})}=\frac{1}{2\times(1-${T(p)})}=\frac{1}{2\times${T(keep)}}=\frac{1}{${T(2 * keep)}}=${T(q, kQ)}`,
            why: String.raw`中位數 $m$ 的左邊要剛好有一半的機率：突波全在右邊，所以 $(1-p_{\rm out})\,\Phi(m/\sigma_v)=\tfrac12$，也就是 $\Phi(m/\sigma_v)=q$。$q$ 很接近 $\tfrac12$，下一步要減 $\tfrac12$，所以多留幾位。`,
          },
          {
            tex: String.raw`t=\sqrt{2\pi}\,\big(q-\tfrac12\big)=2.50663\times(${T(q, kQ)}-0.5)=2.50663\times${P(dq)}=${T(t)}`,
            why: String.raw`$\Phi^{-1}$ 的一階估計：$z$ 很小時 $\Phi(z)\approx\tfrac12+z/\sqrt{2\pi}$（計算機：$2\times\pi$ 再開根號，$\sqrt{2\pi}=2.50663$）。`,
          },
          {
            tex: String.raw`z=\Phi^{-1}(q)=\Phi^{-1}(${T(q, kQ)})=${T(z)}`,
            why: String.raw`查標準常態表（在表身找到機率 $q$，讀回對應的 $z$），或用計算機的 invNorm。` + approxHint,
          },
          { tex: String.raw`\operatorname{med}(v)=\sigma_v\,z=${P(sigma)}\times${P(z)}=${T(med)}`, why: p === 0 ? '雜訊的中位數：沒有突波，對稱的 Gaussian 中位數就是 0。' : '雜訊的中位數：被少數突波往右推了一點點。' },
          {
            tex: String.raw`w^*_{\rm SE}-a=\frac{\operatorname{med}(v)}{A}=\frac{${T(med)}}{${T(A)}}=${T(shiftS)}`,
            why: String.raw`令 $\psi_{\rm SE}(w)=A\,E_v[\operatorname{sign}((a-w)A+v)]=0$：Sign-Error 的固定點被「雜訊的中位數」拉走，而不是平均。`,
          },
          {
            tex: String.raw`w^*_{\rm SE}=a+\frac{\operatorname{med}(v)}{A}=${T(a, kS)}+${P(shiftS)}=${T(wS, kS)}`,
            why: String.raw`加回 $a$。偏移很小，所以答案要寫到和偏移同一個小數位才看得出來。`,
          },
        ],
        results: [
          { symbol: String.raw`w^*_{\rm LMS}`, label: 'LMS 的固定點', value: wL, digits: resultDigits(wL) },
          { symbol: String.raw`w^*_{\rm SE}-a`, label: 'Sign-Error 固定點的偏移', value: shiftS, tolerance: { rel: 0.03 } },
          { symbol: String.raw`w^*_{\rm SE}`, label: 'Sign-Error 的固定點', value: wS, digits: kS, tolerance: { abs: Math.max(0.03 * Math.abs(shiftS), 1e-9), rel: 0 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`查表的方向是反的：平常是「給 $z$ 查 $\Phi(z)$」，這裡是「給機率 $q$ 找 $z$」。$q$ 很接近 $\tfrac12$ 時表不夠細，用 $z\approx\sqrt{2\pi}\,(q-\tfrac12)$ 反而更準。`,
      String.raw`查表示範（範例的 $q=0.5263$）：表上 $\Phi(0.06)=0.5239$、$\Phi(0.07)=0.5279$，$q$ 落在兩者之間，線性內插 $z\approx0.06+0.01\times\dfrac{0.5263-0.5239}{0.5279-0.5239}=0.066$。四位數的表只給得出兩位有效數字，所以 $|z|$ 小的時候用下一則的 $t+t^3/6$ 比較準。`,
      String.raw`近似的適用範圍：$z\approx t$（$t=\sqrt{2\pi}(q-\tfrac12)$）在 $|z|\le0.1$ 誤差 $<0.2\%$；$z\approx t+t^3/6$ 在 $|z|\le0.3$ 誤差 $<0.05\%$、$|z|\le0.5$ 誤差 $<0.4\%$。`,
      String.raw`範例數字（$a=3,\ A=1,\ \sigma_v=0.3,\ p_{\rm out}=0.05,\ s=20$）就是主實驗的「單邊 outlier」preset：LMS $4.000$、Sign-Error $3.020$。`,
      String.raw`小 $p_{\rm out}$ 的速算：$w^*_{\rm SE}-a\approx\sqrt{2\pi}\,\sigma_v\,\dfrac{p_{\rm out}}{2(1-p_{\rm out})A}$——偏移正比於 $\sigma_v$ 和 $p_{\rm out}$，與 $s$ 無關。`,
    ],
  },

  /* ───────────── §5 NLMS ───────────── */
  {
    id: 'HC-02.7',
    title: String.raw`NLMS 一步：把步長除以 $\varepsilon+x^2$`,
    page: PAGE,
    formulaId: 'F-02.15',
    formulaTex: String.raw`w_1=w+\frac{\tilde\mu}{\varepsilon+x^2}\,e\,x,\qquad e=y-w\,x,\qquad e^+=y-w_1x=\Big(1-\frac{\tilde\mu\,x^2}{\varepsilon+x^2}\Big)\,e`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的係數', default: 1, min: -20, max: 20, practice: { choices: [-1, 0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -100, max: 100, practice: { choices: [-2, 0.5, 1, 2, 4] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 6, min: -1000, max: 1000, practice: { min: -8, max: 12, step: 1 } },
      { key: 'mut', symbol: String.raw`\tilde\mu`, label: '無因次步長', default: 0.4, min: 0, max: 4, practice: { choices: [0.25, 0.4, 0.5, 1, 1.5] } },
      { key: 'eps', symbol: String.raw`\varepsilon`, label: '正規化常數', default: 0, min: 0, max: 100, practice: { choices: [0, 0, 0.5, 1] } },
    ],
    validate: ({ x, mut, eps }) => {
      if (x === 0 && eps === 0) return String.raw`$x=0$ 且 $\varepsilon=0$：分母 $\varepsilon+x^2=0$，更新量是 $0/0$。這正是 NLMS 要加 $\varepsilon>0$ 的原因——請給一個正的 $\varepsilon$ 或非零的 $x$。`
      if (mut <= 0) return String.raw`步長 $\tilde\mu$ 必須大於 0（$\tilde\mu=0$ 時完全不更新）。`
      return null
    },
    solve: ({ w, x, y: yIn, mut, eps }) => {
      const y = tieSafeY(w, x, yIn) // 精確算術下 e = 0 的輸入不顯示成 10⁻¹⁶
      const s = nlmsStep({ w, x, y, mu: mut, eps })
      const w1 = zsum(s.w, w, s.dw) // w + Δw 剛好抵銷時精確值是 0
      const post = snapZero(nlmsStep({ w: s.w, x, y, mu: mut, eps }).e, s.e) // 同一筆資料、更新後的誤差（a posteriori error）；μ̃ = 1、ε = 0 時精確值是 0
      const wx = w * x
      const x2 = x * x
      const den = eps + x2
      const muEff = mut / den
      const w1x = w1 * x
      const shrink = snapZero(1 - (mut * x2) / den, 1) // μ̃ = 1、ε = 0 時精確值是 0
      const shrink10 = snapZero(1 - (mut * 100 * x2) / (eps + 100 * x2), 1) // 把 x、y 同乘 10 之後
      const poleLms = snapZero(fixedXPole(muEff, x), 1) // 固定步長 μ_eff 的 LMS：1 − μ_eff·x²
      const poleLms10 = fixedXPole(muEff, 10 * x)
      // μ_eff 是除出來的（常常寫不完）；它一路傳到 Δw、w₁，最後 y − w₁x 又是兩個接近的數相減，所以整條鏈要一起多留幾位
      const kE = sigFor(s.e, y, wx)
      const K = Math.max(sigFor(w1, w, s.dw), post === 0 ? 5 : sigFor(post, y, w1x))
      const notes: string[] = []
      if (s.e !== 0)
        notes.push(
          String.raw`驗算：$e^+/e=${N(post / s.e)}$，應等於 $1-\dfrac{\tilde\mu\,x^2}{\varepsilon+x^2}=${N(shrink)}$` +
            (eps === 0 ? String.raw`；$\varepsilon=0$ 時它就是 $1-\tilde\mu$，和 $x$ 的大小完全無關。` : String.raw`；$\varepsilon>0$ 讓它比 $1-\tilde\mu=${N(snapZero(1 - mut, 1))}$ 保守一點（$|x|$ 越小越保守）。`),
        )
      else notes.push(String.raw`$e=0$：預測已經完全正確，$w$ 不動。`)
      if (x !== 0)
        notes.push(
          String.raw`尺度不變：把 $x$、$y$ 同乘 10，NLMS 的收縮比例 $e^+/e$ ` +
            (eps === 0
              ? String.raw`完全不變（仍是 $${N(shrink)}$）`
              : String.raw`變成 $${N(shrink10)}$（原本 $${N(shrink)}$；$\varepsilon$ 相對變小，更接近 $1-\tilde\mu$）`) +
            String.raw`；但若沿用同一個固定步長 $\mu=${N(muEff)}$ 的 LMS，pole 會從 $1-\mu x^2=${N(poleLms)}$ 變成 $1-\mu(10x)^2=${N(poleLms10)}$` +
            (Math.abs(poleLms10) >= 1 ? '——發散。' : '。'),
        )
      notes.push(
        Math.abs(shrink) < 1
          ? String.raw`$\big|1-\tilde\mu x^2/(\varepsilon+x^2)\big|=${N(Math.abs(shrink))}<1$：這筆資料的誤差變小了。$\varepsilon=0$ 時穩定條件就是 $0<\tilde\mu<2$，不必知道 $x$ 有多大。`
          : String.raw`$\big|1-\tilde\mu x^2/(\varepsilon+x^2)\big|=${N(Math.abs(shrink))}\ge1$：$\tilde\mu$ 太大，誤差沒有變小（$\varepsilon=0$ 時需要 $0<\tilde\mu<2$）。`,
      )
      return {
        steps: [
          {
            tex: String.raw`e=y-w\,x=${T(y, kE)}-${P(w)}\times${P(x)}=${T(y, kE)}-${P(wx, kE)}=${T(s.e)}`,
            why: '和 LMS 一樣先算預測誤差：一次乘法、一次減法。' + moreDigits(kE, y, wx),
          },
          { tex: String.raw`x^2=${Q(x)}=${T(x2)}`, why: '這筆輸入的功率。' },
          { tex: String.raw`\varepsilon+x^2=${T(eps)}+${T(x2)}=${T(den)}`, why: String.raw`正規化的分母；$\varepsilon$ 避免 $x\approx0$ 時除以零。` },
          {
            tex: String.raw`\mu_{\rm eff}=\frac{\tilde\mu}{\varepsilon+x^2}=\frac{${T(mut)}}{${T(den)}}=${T(muEff, K)}`,
            why: String.raw`等效的 LMS 步長：輸入越大、步長自動越小。` + (K > 5 ? String.raw`最後一步 $y-w_1x$ 是兩個接近的數相減，會吃掉有效位數，所以從這裡開始每個數都多留幾位。` : ''),
          },
          {
            tex: String.raw`\Delta w=\mu_{\rm eff}\,e\,x=${P(muEff, K)}\times${P(s.e)}\times${P(x)}=${P(muEff * s.e, K)}\times${P(x)}=${T(s.dw, K)}`,
            why: '之後就是一般的 LMS 更新量（連乘兩次）。',
          },
          { tex: String.raw`w_1=w+\Delta w=${T(w)}+${P(s.dw, K)}=${T(w1, K)}`, why: '更新後的係數。' },
          {
            tex: String.raw`e^+=y-w_1\,x=${T(y)}-${P(w1, K)}\times${P(x)}=${T(y)}-${P(w1x, K)}=${T(post)}`,
            why:
              String.raw`用更新後的 $w_1$ 重算同一筆資料的誤差（a posteriori error），看這一步把誤差縮小了多少。` +
              (post === 0 && s.e !== 0 ? String.raw`這裡 $w_1$ 剛好等於 $y/x$，誤差一步歸零；$w_1$ 若是除不盡的小數，用四捨五入後的數字相乘會剩下一點點，那只是捨入，精確值是 0。` : ''),
          },
        ],
        results: [
          { symbol: String.raw`\mu_{\rm eff}`, label: '等效 LMS 步長', value: muEff, digits: resultDigits(muEff) },
          { symbol: 'w_1', label: '更新後的係數', value: w1, digits: resultDigits(w1) },
          { symbol: 'e^+', label: '更新後同一筆資料的誤差', value: post, digits: resultDigits(post) },
        ],
        notes,
      }
    },
    tips: [
      String.raw`只比 LMS 多一次除法：先把 $\tilde\mu$ 除以 $\varepsilon+x^2$，其餘照舊。$\mu_{\rm eff}$ 除不盡時多留兩三位再往下算——最後的 $y-w_1x$ 是兩個接近的數相減。`,
      String.raw`範例數字是 T01 的資料（$w=1,\ x=2,\ y=6$）配 $\tilde\mu=\mu x^2=0.1\times4=0.4$、$\varepsilon=0$：NLMS 和 $\mu=0.1$ 的 LMS 完全相同，$w_1=1.8$、$e^+=2.4$。`,
      String.raw`把 $x$ 改成 $20$、$y$ 改成 $60$ 再算一次：$e^+/e$ 還是 $0.6$。`,
    ],
  },

  /* ───────────── §6 綜合 ───────────── */
  {
    id: 'HC-02.8',
    title: String.raw`綜合：1-bit 校正迴路的增益、pole、時間常數與穩態抖動`,
    page: PAGE,
    formulaId: 'F-02.13',
    formulaTex: String.raw`K_q=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v},\quad K_{\rm SE}=K_q\,E[x^2],\quad p=1-\mu K_{\rm SE},\quad \tau=\frac{-1}{\ln|p|},\quad \operatorname{Var}(w)\approx\frac{\mu\,\sigma_\eta^2}{K\,(2-\mu K)},\quad \frac{\operatorname{Var}_{\rm SE}}{\operatorname{Var}_{\rm LMS}}\bigg|_{\text{同 }\mu K}=\frac{\pi}{2}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 輸入端的雜訊標準差（Gaussian）', default: 0.5, min: 0, max: 1000, practice: { choices: [0.5, 1, 2, 4] } },
      { key: 'A', symbol: 'A', label: String.raw`code 的幅度（$x=\pm A$ 等機率）`, default: 1, min: -100, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'Sign-Error 的步長', default: 0.02, min: 0, max: 100, practice: { choices: [0.01, 0.02, 0.04, 0.05, 0.1] } },
    ],
    validate: ({ sigma, A, mu }) => {
      if (sigma <= 0) return String.raw`$\sigma_v$ 必須大於 0：沒有雜訊時 $\operatorname{sign}$ 不會被平滑（$K_q\to\infty$），Sign-Error 是確定性的 limit cycle（HC-02.2），線性化公式不適用。`
      if (A === 0) return String.raw`$A=0$：code 沒有幅度，$E[x^2]=0$，不可辨識。`
      if (mu <= 0) return String.raw`步長 $\mu$ 必須大於 0。`
      const g = mu * meanFieldAnalysis('sign_error', bpskModel(A, sigma)).K
      if (g > SE_LINEAR_MAX_G)
        return String.raw`$g=\mu K_{\rm SE}=${N(g, 4)}>${SE_LINEAR_MAX_G}$：走一步會讓 comparator 輸入端的誤差改變 $\mu x^2=${N(mu * A * A)}$，和雜訊 $\sigma_v=${N(sigma)}$ 相比已經不小，雜訊來不及把 $\operatorname{sign}$ 平滑成一條斜線。F-02.13 的小步長假設（$\mu x^2\ll\sigma_v$，也就是 $g\ll1$）不成立：線性化會高估 $\sigma_w$ 超過 $5\%$（$g=1$ 時約 $18\%$），pole 也不再是 $1-g$。請減小 $\mu$ 或加大 $\sigma_v$，讓 $g\le${SE_LINEAR_MAX_G}$。`
      return null
    },
    solve: ({ sigma, A, mu }) => {
      const inp = bpskModel(A, sigma)
      const m = xMoments(inp.x)
      const mfS = meanFieldAnalysis('sign_error', inp)
      const mfL = meanFieldAnalysis('lms', inp)
      const pS = predictSteadyState(mfS, mu, inp)
      const Kq = mfS.K / m.m2 // K_SE = K_q·E[x²]
      const g = mu * mfS.K
      const muL = g / mfL.K // 同收斂速度：μ_L·P_x = μ·K_SE
      const pL = predictSteadyState(mfL, muL, inp) // LMS 的精確穩態 MSD（F-02.16）
      const ratio = pS.variance / pL.variance
      const c0 = Math.sqrt(2 / Math.PI)
      const pole = pS.pole
      const absP = Math.abs(pole)
      const lnP = Math.log(absP)
      const twoMg = 2 - g
      const denS = mfS.K * twoMg
      const numS = mu * mfS.gradVar
      const twoM2 = 2 * m.m2
      const muLm4 = muL * m.m4
      const denL = twoM2 - muLm4
      const sig2 = sigma * sigma
      const numL = muL * sig2 * m.m2
      // p = 1 − g 接著要取 ln：p 很接近 1 時 ln 對 p 的最後幾位很敏感。
      // 把 g 與 p 寫到同一個小數位，位數取「g 有 5 位有效數字」與「ln|p| 有 5 位有效數字」兩者中較多的。
      const dP = Math.max(decimalsFor(g, 5), absP > 0 && lnP !== 0 ? decimalsFor(absP * Math.abs(lnP), 5) : 0)
      const kP = Math.max(5, sigAt(pole, dP))
      // g 一路從 √(2/π) 乘下來：p 要多寫一位時（g 剛超過 0.1、0.01… 的地方，例如 g = 0.1004），g 與上游每個數都要一起多留一位，
      // 畫面上的數字才能一路乘到 p。其餘情況這個數就是 5，畫面不變。（validate 已保證 g ≤ 0.5，所以 2 − g 不會抵銷。）
      const K = Math.max(5, sigAt(g, dP))
      const kL = Math.max(K, sigFor(denL, twoM2, muLm4))
      return {
        steps: [
          {
            tex: String.raw`\sqrt{\tfrac{2}{\pi}}=\sqrt{${T(2 / Math.PI, K)}}=${T(c0, K)}`,
            why: String.raw`計算機：$2\div\pi$ 再開根號。這個常數到處出現，值得背起來（大約 $0.8$）。` + (K > 5 ? String.raw`這一組數字的 $p=1-g$ 之後要取 $\ln$，需要比平常多寫一位，所以從這裡開始每個數都多留一位。` : ''),
          },
          { tex: String.raw`K_q=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}=\frac{${T(c0, K)}}{${T(sigma)}}=${T(Kq, K)}`, why: String.raw`1-bit comparator 的統計小訊號增益（Gaussian 雜訊，$2f_v(0)$；Ch05）：雜訊越大，$\operatorname{sign}$ 被平滑得越平，增益越小。` },
          {
            tex: String.raw`E[x^2]=A^2=${Q(A)}=${T(m.m2)},\qquad E[x^4]=(A^2)^2=${Q(m.m2)}=${T(m.m4)}`,
            why: String.raw`code 的功率與四階動差（$x=\pm A$：$x^2$ 永遠是 $A^2$）。$E[x^4]$ 在第 13 步才會用到。`,
          },
          { tex: String.raw`K_{\rm SE}=K_q\,E[x^2]=${P(Kq, K)}\times${P(m.m2)}=${T(mfS.K, K)}`, why: 'Sign-Error 靠近固定點時的線性化 loop gain（每單位步長；F-02.12）。' },
          { tex: String.raw`g=\mu\,K_{\rm SE}=${P(mu)}\times${P(mfS.K, K)}=${T(g, K)}`, why: String.raw`正規化 loop gain：每個 sample 修掉的誤差比例。` },
          {
            tex: String.raw`p=1-g=1-${P(g, K)}=${T(pole, kP)}`,
            why:
              String.raw`校正迴路的 pole：每個 sample 之後殘留的誤差比例（平均而言）。` +
              (kP > 5 ? String.raw`下一步要取 $\ln$，而 $\ln$ 在 1 附近對最後幾位很敏感，所以 $p$ 寫到和 $g$ 同一個小數位、不提前四捨五入。` : ''),
          },
          {
            tex: String.raw`\tau=\frac{-1}{\ln|p|}=\frac{-1}{\ln(${T(absP, kP)})}=\frac{-1}{${T(lnP)}}=${T(pS.tau)}`,
            why:
              String.raw`時間常數（samples）。計算機按 $\ln$，再取倒數、變號；` +
              (g <= 0.2
                ? String.raw`$g\le0.2$ 時可用 $\tau\approx1/g-\tfrac12=${N(1 / g - 0.5)}$（誤差 $<0.5\%$）。`
                : String.raw`速算式 $\tau\approx1/g-\tfrac12$ 只適用 $g\le0.2$；這裡 $g=${N(g)}$ 太大（它會給 $${N(1 / g - 0.5)}$，差 $${N((100 * Math.abs(1 / g - 0.5 - pS.tau)) / pS.tau, 2)}\%$），請直接按 $\ln$。`),
          },
          { tex: String.raw`\sigma_\eta^2=E[\operatorname{sign}^2(e)\,x^2]=E[x^2]=${T(mfS.gradVar)}`, why: String.raw`梯度雜訊的變異：$\operatorname{sign}^2=1$，所以它只看 code 功率，和 $\sigma_v$ 無關。` },
          {
            tex: String.raw`K_{\rm SE}\,(2-g)=${P(mfS.K, K)}\times(2-${P(g, K)})=${P(mfS.K, K)}\times${P(twoMg)}=${T(denS)}`,
            why: '穩態變異公式（F-02.13）的分母：先減、再乘。',
          },
          {
            tex: String.raw`\operatorname{Var}_{\rm SE}\approx\frac{\mu\,\sigma_\eta^2}{K_{\rm SE}\,(2-g)}=\frac{${P(mu)}\times${P(mfS.gradVar)}}{${T(denS)}}=\frac{${T(numS)}}{${T(denS)}}=${T(pS.variance)}`,
            why: String.raw`係數 $w$ 在固定點附近抖動的變異數（線性化近似）：分子先乘好，再除。`,
          },
          { tex: String.raw`\sigma_{w}=\sqrt{\operatorname{Var}_{\rm SE}}=\sqrt{${T(pS.variance)}}=${T(pS.std)}`, why: String.raw`開根號得到抖動的標準差——單位和 $w$ 相同。` },
          { tex: String.raw`\mu_{\rm L}=\frac{g}{E[x^2]}=\frac{${T(g, K)}}{${T(m.m2)}}=${T(muL, kL)}`, why: String.raw`公平比較：讓多位元 LMS 有同一個 pole（LMS 的 $K=E[x^2]$，所以 $\mu_{\rm L}E[x^2]=g$）。` },
          {
            tex: String.raw`2E[x^2]-\mu_{\rm L}E[x^4]=2\times${P(m.m2)}-${P(muL, kL)}\times${P(m.m4)}=${T(twoM2, kL)}-${P(muLm4, kL)}=${T(denL)}`,
            why: String.raw`LMS 穩態 MSD 公式（F-02.16）的分母；$E[x^4]$ 是第 3 步算好的。` + moreDigits(kL, twoM2, muLm4),
          },
          {
            tex: String.raw`\operatorname{Var}_{\rm LMS}=\frac{\mu_{\rm L}\,\sigma_v^2\,E[x^2]}{2E[x^2]-\mu_{\rm L}E[x^4]}=\frac{${P(muL, kL)}\times${Q(sigma)}\times${P(m.m2)}}{${T(denL)}}=\frac{${P(muL, kL)}\times${P(sig2)}\times${P(m.m2)}}{${T(denL)}}=\frac{${T(numL)}}{${T(denL)}}=${T(pL.variance)}`,
            why: '同樣收斂速度下，多位元 LMS 的穩態變異（精確式）：先平方、把分子乘好，最後除。',
          },
          {
            tex: String.raw`\frac{\operatorname{Var}_{\rm SE}}{\operatorname{Var}_{\rm LMS}}=\frac{${T(pS.variance)}}{${T(pL.variance)}}=${T(ratio)}`,
            why: String.raw`不管怎麼換數字都是 $\pi/2\approx1.571$（F-02.14）：只用 1 bit 的代價是變異多 57%、標準差多 25%。`,
          },
        ],
        results: [
          { symbol: String.raw`K_{\rm SE}`, label: 'Sign-Error 的線性化增益', value: mfS.K },
          { symbol: 'p', label: '校正迴路的 pole', value: pole, digits: Math.min(10, kP), tolerance: { abs: 0.02 * g, rel: 0 } },
          { symbol: String.raw`\tau`, label: '時間常數', value: pS.tau, unit: SAMPLES, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\sigma_w`, label: 'Sign-Error 的穩態標準差', value: pS.std, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\operatorname{Var}_{\rm SE}/\operatorname{Var}_{\rm LMS}`, label: '同收斂速度下的變異比', value: ratio },
        ],
        notes: [
          String.raw`線性化的前提：走一步讓 comparator 輸入端的誤差改變 $\mu x^2=${N(mu * m.m2)}$，要遠小於雜訊 $\sigma_v=${N(sigma)}$（等價於 $g\ll1$；這裡 $g=${N(g, 3)}$），雜訊才來得及把 $\operatorname{sign}$ 平滑成斜線。Monte Carlo 對照：$g\le0.1$ 時上面的 $\sigma_w$ 高估不到 $1\%$、$g\le0.2$ 不到 $2\%$、$g\le0.5$ 約 $5\%$；實際殘留的比例也會比 $p=1-g$ 略靠近 1（抖動讓平均斜率變小）。`,
          String.raw`對應到 DTC gain 校正：$\sigma_v$ 是 comparator／BBPD 輸入端的 jitter、$x$ 是 DSM 殘差 code、$\mu$ 是累加器的右移量；pole $1-\mu K$ 決定校正頻寬，$\sigma_w$ 就是 gain 係數的殘餘抖動（Ch05、Ch08、Ch12）。`,
          String.raw`想要抖動減半：$\sigma_w\propto\sqrt{\mu}$，所以 $\mu$ 要變成四分之一，代價是 $\tau$ 變成四倍——精度和速度的交換。`,
        ],
      }
    },
    tips: [
      String.raw`需要計算機的只有三處：$\sqrt{2/\pi}=0.79788$、一次 $\ln$、一次開根號。其餘都是加減乘除。`,
      String.raw`這一題有 15 步，畫面上每個數字都四捨五入到 5 位有效數字；照著畫面上的數字按計算機，最後一位可能差 1～2，這是正常的捨入。自己算時中間值多留一兩位，最後再四捨五入。`,
      String.raw`$\ln(1-g)$ 的近似：$g\le0.2$ 時 $\ln(1-g)\approx-g-g^2/2$，所以 $\tau\approx1/g-\tfrac12$（誤差 $<0.5\%$）。`,
      String.raw`範例數字（$\sigma_v=0.5,\ A=1,\ \mu=0.02$）是主實驗預設的雜訊與步長：$K_{\rm SE}=1.5958$、$\tau\approx30.8$、$\sigma_w\approx0.0798$。`,
      String.raw`最後的比值如果不是 $1.5708$，回頭檢查 $K_q$——它被平方後出現在 $\operatorname{Var}_{\rm SE}$ 的分母。`,
      String.raw`單位：範例把所有量當成無因次。套到硬體時 $\sigma_v$ 與 $y$ 同單位（例如 $\mathrm{fs}$），$K_q$ 是 $1/[y]$，$K_{\rm SE}=K_qE[x^2]$ 是 $[x]^2/[y]$，Sign-Error 的 $\mu$ 是 $[w]/[x]=[y]/[x]^2$，所以 $g=\mu K_{\rm SE}$ 與 $p$ 無因次；$\tau$ 的單位是 samples，$\sigma_w$ 與 $w$ 同單位（$[y]/[x]$）。`,
    ],
  },
]
