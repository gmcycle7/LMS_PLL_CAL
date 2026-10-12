import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { normPdf } from '@/simulation/core'
import {
  averageCost,
  batchOptima,
  classifyPole,
  conventionalStep,
  fixedXMuMax,
  fixedXPole,
  huberStep,
  signErrorStep,
  type PoleBehaviour,
} from '@/simulation/models/lms'
import {
  batchL2,
  contaminatedMedianApprox,
  fixedXStability,
  lmsSteadyState,
  lossPsi,
  lossRho,
  mixtureRawMoments,
  mseParabola,
  noiseMixture,
  playgroundClosedForm,
  playgroundVarW,
  playgroundVarWStationary,
  populationOptima,
  signErrorDiffusionKappa,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  type LossDataParams,
} from '@/simulation/models/lossCompare'

/**
 * Ch01 的「帶入手算」題（docs/teaching-style.md §7）。
 *  - 每個 boxed 公式都有一題：w* 與 bias（HC-01.1，含逐筆的 normal equation 驗算）、拋物線、動差形式的 normal equation 與配方（.2）、½ 與步長（.3）、
 *    pole／封閉解／Var(w_n)（.4）、Δw = μψ(e)x（.5）、平均 vs 中位數（.6）、μ/(2K_q)（.7）、綜合（.8，放在思考題之前）。
 *  - solve() 的答案一律取自 src/simulation/models 的實際函式：lms.ts（conventionalStep / signErrorStep / huberStep、
 *    fixedXPole、batchOptima、averageCost）與 lossCompare.ts（batchL2、mseParabola、playgroundClosedForm、playgroundVarW、
 *    lossPsi / lossRho、lmsSteadyState、populationOptima、signErrorJitterApprox…）；步驟裡的中間量只做一種基本運算。
 *  - 預設數字＝本章的 worked example：§1.0／§1.2 的三筆資料（w* = 3.07619）、§1.3 的 x = 2、μ = 0.4（p = −0.6）、
 *    §1.4 的 T01（w₂ = 2.28）加上 §1.4.1 的 σ_v = 1（Var = 0.0625）、§2.2.1 的單步比較、§2.3 的 {0,0,0,10}、
 *    §2.3.2 的 σ_v = 1、μ = 0.05，以及 §2.4／preset「DC 估計 + 10% outlier」（5 與 3.1397）。
 *  - 極性一律是 δ = a − w（勘誤 E39）；成本含 ½（勘誤 E41）；sign(0) 採數學次梯度 0 並在註記中提醒（勘誤 E40）。
 *  - 步驟的寫法：「符號式 = 代入數字 = （中間值）= 結果」。複合分式先把分子、分母各算成一個數再相除；
 *    會被拿去做「接近的數相減」的量（w*、殘差、E[·]）顯示 7 位，讓讀者照著顯示的數字算也得到同一個答案
 *    （handcalcs.test.tsx 的 chainReport 會把每一條數字鏈重算一次）。
 *  - 輸入與答案都標單位（[x]／[y] 記號，見下方 U_X…）；無因次量與「同一個 μ 填進兩種演算法」的 μ 不標。
 */

const PAGE = '/ch/01'

/** 把浮點尾巴（例如 4.4e-16）當成 0，避免步驟裡出現 10^{-16} 這種「不是 0 的 0」 */
const snap = (v: number, scale = 1): number => (Math.abs(v) <= 1e-12 * Math.max(1, Math.abs(scale)) ? 0 : v)
const sum = (t: number[]): number => t.reduce((s, v) => s + v, 0)
/** 「a + b + c」的 TeX（負數加括號） */
const plus = (t: number[], sig = 5): string => t.map((v) => texNumP(v, sig)).join('+')
/** 「x₁×y₁ + x₂×y₂ + …」的 TeX */
const dot = (p: number[], q: number[], sig = 5): string => p.map((v, i) => `${texNumP(v, sig)}\\times${texNumP(q[i], sig)}`).join('+')
/** 「a² + b² + …」的 TeX（負數加括號） */
const squares = (t: number[], sig = 5): string => t.map((v) => `${texNumP(v, sig)}^2`).join('+')

/**
 * 單位（docs/teaching-style.md §3）：本章是抽象的 L0 模型，沿用符號表（symbols.tsx）的記號——
 * 輸入的單位記作 [x]、量測的單位記作 [y]；例如 DTC gain 校正時 [x] = code、[y] = fs，w 的單位就是 fs/code。
 * 範例數字本身都是純數字。x ≡ 1（只估一個常數，HC-01.6～HC-01.8）時 [x] 無因次，w 的單位就是 [y]。
 */
const U_X = '[x]'
const U_Y = '[y]'
const U_W = '[y]/[x]'
const U_MU = '1/[x]^2'

const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** pole 行為的 LaTeX 版說明（lms.ts 的 POLE_BEHAVIOUR_LABEL 是純文字） */
const BEHAVIOUR_TEXT: Record<PoleBehaviour, string> = {
  monotone: '不變號、單調收斂',
  oscillating: '正負交替、震盪收斂',
  deadbeat: '一步到答案',
  boundary: '停在穩定邊界、不收斂',
  divergent: '發散',
  frozen: '參數不動',
}

/** x ≡ 1 的資料模型（y = a + v + outlier）：lossCompare.ts 的 LossDataParams */
const dcModel = (over: Partial<LossDataParams>): LossDataParams => ({
  model: 'contaminated',
  a: 0,
  xDist: 'const',
  xScale: 1,
  sigma: 0,
  outlierProb: 0,
  outlierSize: 0,
  outlierSign: 'positive',
  n: 0,
  seed: 0,
  ...over,
})

const ONES4 = [1, 1, 1, 1]
/** HC-01.7／HC-01.8：擴散近似的有效性門檻 μx²f ≤ 0.1（「≪ 1」的具體化；§2.3.2 的表最大到 0.08） */
export const DIFFUSION_SMALLNESS_MAX = 0.1
/**
 * HC-01.8：擴散近似的二階指標 κ = (1 + z²)·Var_SE/σ_v² ≤ 0.2（lossCompare.ts 的 signErrorDiffusionKappa；std 的相對誤差 ≈ −κ/4，
 * 所以門檻內近似的 std 誤差 < 5%）。無 outlier（z = 0）時 κ = (π/2)·μf，μf ≤ 0.1 已保證 κ ≤ 0.157；
 * 有單邊 outlier 時中位數被推到 z > 0，μf 反而變小——只看 μf 會放行誤差 30% 以上的組合（例如 ε = 0.45、μ = 0.2）。
 */
export const DIFFUSION_KAPPA_MAX = 0.2
/**
 * HC-01.8：outlier 那一群（中心 a + s）至少要在「中位數」上方 8σ_v——也就是 s − m ≥ 8σ_v，不只是 s ≥ 8σ_v。
 * F-01.17 右式忽略的是 ε·Φ((m − s)/σ_v)；Φ(−8) ≈ 6×10⁻¹⁶，所以右式與數值求根的精確中位數一致到 10⁻¹²·σ_v 以內。
 * （只要求 s ≥ 8σ_v 的話，ε → 0.5 時中位數被推到主體右尾，ε = 0.499 會差到 2×10⁻⁵·σ_v，步驟顯示的 σ_v·z 就對不上答案了。）
 */
export const OUTLIER_MIN_SIGMAS = 8

/** 往下取到 sig 位有效數字：給「請把 μ 降到 … 以下」這種門檻用，避免四捨五入後的數字反而還超標 */
const floorSig = (v: number, sig = 3): number => {
  if (!(v > 0) || !Number.isFinite(v)) return v
  const q = 10 ** (Math.floor(Math.log10(v)) - (sig - 1))
  return Number((Math.floor(v / q + 1e-9) * q).toPrecision(sig))
}
/** 往上取到小數 2 位：給「請讓 s ≥ …」這種門檻用 */
const ceil2 = (v: number): number => Math.ceil(v * 100 - 1e-9) / 100

const X_CHOICES = [-2, -1, 1, 2, 3, 4]

export const HANDCALCS: HandCalcDef[] = [
  {
    id: 'HC-01.1',
    title: '從資料表算最小平方解 $w^*$、驗算 normal equation，並拆出雜訊造成的 bias',
    page: PAGE,
    formulaId: 'F-01.4',
    formulaTex: String.raw`\begin{gathered}w^*=\frac{E[xy]}{E[x^2]}=\frac{\sum_i x_iy_i}{\sum_i x_i^2}=a+\frac{\sum_i x_iv_i}{\sum_i x_i^2},\qquad v_i=y_i-a\,x_i\\[4pt] \sum_i e^*_i\,x_i=0,\qquad e^*_i=y_i-w^*x_i\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'x1', symbol: 'x_1', label: '第 1 筆輸入', unit: U_X, default: 1, min: -100, max: 100, practice: { choices: X_CHOICES } },
      { key: 'y1', symbol: 'y_1', label: '第 1 筆量測', unit: U_Y, default: 3.2, min: -1000, max: 1000, practice: { min: -4, max: 16, step: 0.5 } },
      { key: 'x2', symbol: 'x_2', label: '第 2 筆輸入', unit: U_X, default: 2, min: -100, max: 100, practice: { choices: X_CHOICES } },
      { key: 'y2', symbol: 'y_2', label: '第 2 筆量測', unit: U_Y, default: 5.7, min: -1000, max: 1000, practice: { min: -4, max: 16, step: 0.5 } },
      { key: 'x3', symbol: 'x_3', label: '第 3 筆輸入', unit: U_X, default: 4, min: -100, max: 100, practice: { choices: X_CHOICES } },
      { key: 'y3', symbol: 'y_3', label: '第 3 筆量測', unit: U_Y, default: 12.5, min: -1000, max: 1000, practice: { min: -4, max: 16, step: 0.5 } },
      { key: 'a', symbol: 'a', label: '真實係數（只用來算 bias）', unit: U_W, default: 3, min: -100, max: 100, practice: { choices: [2, 3, 4] } },
    ],
    validate: ({ x1, x2, x3 }) =>
      x1 === 0 && x2 === 0 && x3 === 0
        ? '三筆 $x$ 都是 0：$\\sum x_i^2=0$，資料完全不含 $a$ 的資訊（沒有 excitation），$w^*$ 無定義。請至少讓一筆 $x\\ne0$。'
        : null,
    solve: ({ x1, y1, x2, y2, x3, y3, a }) => {
      const x = [x1, x2, x3]
      const y = [y1, y2, y3]
      const xx = x.map((v) => v * v)
      const xy = x.map((v, i) => v * y[i])
      const sxx = sum(xx)
      const sxy = snap(sum(xy), sxx)
      const wStar = batchL2(x, y) // 模型：Σxy/Σx²
      // normal equation（F-01.5）：最佳解處的殘差 e*ᵢ = yᵢ − w*·xᵢ（lms.ts 的誤差定義，μ = 0 不更新）與輸入正交
      const eStar = x.map((xi, i) => snap(conventionalStep({ w: wStar, x: xi, y: y[i], mu: 0 }).e, y[i]))
      const ex = x.map((xi, i) => eStar[i] * xi)
      const sex = snap(sum(ex), sum(ex.map(Math.abs)))
      const v = y.map((yi, i) => snap(yi - a * x[i], yi))
      const xv = x.map((xi, i) => xi * v[i])
      const sxv = snap(sum(xv), sxx)
      const bias = snap(batchL2(x, v), wStar) // 同一個函式套在雜訊上：Σxv/Σx²
      const ratios = x.every((xi) => xi !== 0) ? x.map((xi, i) => y[i] / xi) : null
      const propC = ratios && x.every((xi, i) => Math.abs(v[i] / xi - v[0] / x[0]) <= 1e-9) ? v[0] / x[0] : null
      // w*、殘差與 bias 會被拿去做「接近的數相減」：步驟裡留 7 位，照著顯示的數字手算也對得起來（Σe*x 的尾數 < 10⁻⁵）
      const S = 7
      return {
        steps: [
          {
            tex: String.raw`\sum_i x_i^2=${squares(x)}=${plus(xx)}=${texNum(sxx)}`,
            why: '每個 $x$ 先平方再加起來（輸入的總能量）。',
          },
          {
            tex: String.raw`\sum_i x_iy_i=${dot(x, y)}=${plus(xy)}=${texNum(sxy)}`,
            why: '每一筆的 $x$ 乘上自己的 $y$，再加起來（輸入與輸出「一起動」的程度）。',
          },
          {
            // 一行寫完在手機的欄寬裡會多出 1px 的橫向捲軸：第二個等號前換行
            tex: String.raw`\begin{aligned}w^*&=\frac{\sum_i x_iy_i}{\sum_i x_i^2}\\&=\frac{${texNum(sxy)}}{${texNum(sxx)}}=${texNum(wStar, S)}\end{aligned}`,
            why: '最小平方解（F-01.4 左式）。分子分母都除以筆數 $N$ 就是 $E[xy]/E[x^2]$，所以直接用總和相除即可。除不盡時多留幾位（下一步要拿它做減法）。',
          },
          {
            tex: String.raw`\begin{aligned}${x
              .map((xi, i) => String.raw`e^*_${i + 1}&=y_${i + 1}-w^*x_${i + 1}=${texNum(y[i])}-${texNumP(wStar, S)}\times${texNumP(xi)}=${texNum(eStar[i], S)}`)
              .join(String.raw`\\`)}\end{aligned}`,
            why: '把 $w^*$ 代回去，算每一筆剩下的誤差（殘差）。這是兩個接近的數相減，$w^*$ 至少留 6 位有效數字。',
          },
          {
            // 三個乘積各帶 7 位有效數字，一行寫完會比欄寬（要橫向捲動）：第一個等號後換行，第二行從「=」接下去
            tex: String.raw`\begin{aligned}\sum_i e^*_ix_i&=${dot(eStar, x, S)}\\&=${plus(ex, S)}=${texNum(sex)}\end{aligned}`,
            why: 'Normal equation（F-01.5，§1.2.1 會推導）：在最佳解處，殘差與輸入「正交」——再也沒有任何跟著 $x$ 走的成分可以靠調 $w$ 消掉。手算時 $w^*$ 與殘差都四捨五入過，總和會剩下一點尾數（只留 5 位有效數字時大約 $10^{-4}$ 到 $10^{-3}$），不是算錯。',
          },
          {
            tex: String.raw`\begin{aligned}${x
              .map((xi, i) => String.raw`v_${i + 1}&=y_${i + 1}-a\,x_${i + 1}=${texNum(y[i])}-${texNumP(a)}\times${texNumP(xi)}=${texNum(v[i])}`)
              .join(String.raw`\\`)}\end{aligned}`,
            why: '如果知道真值 $a$，每筆量測扣掉 $a\\,x_i$ 剩下的就是雜訊 $v_i$。',
          },
          {
            tex: String.raw`\sum_i x_iv_i=${dot(x, v)}=${plus(xv)}=${texNum(sxv)}`,
            why: '雜訊有沒有「跟著 $x$ 走」？把 $x_i v_i$ 加起來：正負抵消成 0 才算不相關。',
          },
          {
            tex: String.raw`w^*-a=\frac{\sum_i x_iv_i}{\sum_i x_i^2}=\frac{${texNum(sxv)}}{${texNum(sxx)}}=${texNum(bias, S)}`,
            why: 'bias（F-01.4 右式的第二項）：只有 $\\sum x_iv_i=0$ 時最小平方解才等於真值。',
          },
          {
            tex: String.raw`a+\frac{\sum_i x_iv_i}{\sum_i x_i^2}=${texNum(a)}+${texNumP(bias, S)}=${texNum(snap(a + bias, wStar), S)}=w^*\ \checkmark`,
            why: '驗算：兩種算法（直接用 $y$、或用 $a$ 加 bias）必須得到同一個數。',
          },
        ],
        results: [
          { symbol: String.raw`\sum_i x_i^2`, label: '輸入平方和', value: sxx, unit: `${U_X}^2` },
          { symbol: String.raw`\sum_i x_iy_i`, label: '輸入乘量測的和', value: sxy, unit: `${U_X}${U_Y}` },
          { symbol: 'w^*', label: '最小平方解', value: wStar, unit: U_W, digits: 6 },
          { symbol: 'w^*-a', label: 'bias（雜訊造成的偏移）', value: bias, unit: U_W, tolerance: { rel: 0.02, abs: 1e-6 } },
        ],
        notes: [
          ...(ratios
            ? [
                String.raw`三筆各自的比值 $y_i/x_i=${ratios.map((r) => texNum(r, 4)).join(',\\ ')}$；$w^*$ 是它們以 $x_i^2$ 為權重的加權平均，所以 $|x|$ 最大的那一筆說話最大聲。`,
              ]
            : []),
          sxv === 0
            ? String.raw`$\sum x_iv_i=0$：這組雜訊剛好與 $x$ 不相關（正交），最小平方解就是真值 $a$。`
            : propC !== null
              ? String.raw`$v_i=${texNum(propC)}\,x_i$：雜訊完全跟著 $x$ 走，bias 正好是 $${texNum(propC)}$——LMS 會很穩定地學到 $a+${texNumP(propC)}$ 這個「錯的」答案（思考題 4、Ch11）。`
              : String.raw`bias $=${texNum(bias)}$：只有三筆資料時 $\sum x_iv_i$ 很難剛好是 0；雜訊與 $x$ 獨立、零均值時，筆數越多 bias 越小。`,
        ],
      }
    },
    tips: [
      '每一步只有平方、乘法、加減法或一次除法；先把 $x_i^2$、$x_iy_i$ 各寫成一欄再加總最不容易錯。',
      '範例數字（§1.0 的含雜訊資料）的答案是 $w^*=64.6/21\\approx3.07619$，雜訊是 $v=(0.2,\\,-0.3,\\,0.5)$。',
      '驗算 normal equation 時 $w^*$ 要多留幾位（$3.07619$）：殘差是 $(0.1238095,\\,-0.452381,\\,0.1952381)$，各乘上 $x$ 後 $0.1238095-0.9047619+0.7809524=0$。只取 $w^*\\approx3.08$ 的話總和會剩下約 $-0.08$，那是捨入、不是公式錯。',
      '單位：$[x]$、$[y]$ 是輸入與量測各自的單位（例如 code 與 $\\mathrm{fs}$），所以 $w^*$ 與 bias 的單位是 $[y]/[x]$；範例數字都是純數字。',
      '試試把量測改成 $y=(3.5,\\,7,\\,14)$（也就是 $v=0.5x$）：bias 變成剛好 $0.5$，$w^*=3.5$。再試 $y=(3.4,\\,6.2,\\,11.8)$：$\\sum x_iv_i=0$，$w^*$ 回到 $3$。',
    ],
  },
  {
    id: 'HC-01.2',
    title: '成本拋物線 $J(w)$：任選一點的成本與斜率、最低點與 normal equation、配方驗算',
    page: PAGE,
    formulaId: 'F-01.6',
    formulaTex: String.raw`\begin{gathered}J(w)=\tfrac12\big(E[y^2]-2w\,E[xy]+w^2E[x^2]\big)=J(w^*)+\tfrac12E[x^2]\,(w-w^*)^2\\[4pt] w^*=\frac{E[xy]}{E[x^2]}\iff E[e^*x]=E[xy]-w^*E[x^2]=0,\qquad J(w^*)=\tfrac12\Big(E[y^2]-\frac{E[xy]^2}{E[x^2]}\Big)\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'sxx', symbol: String.raw`\sum_i x_i^2`, label: '輸入平方和', unit: `${U_X}^2`, default: 21, min: -1e6, max: 1e6, practice: { choices: [4, 5, 8, 10, 20] } },
      { key: 'sxy', symbol: String.raw`\sum_i x_iy_i`, label: '輸入乘量測的和', unit: `${U_X}${U_Y}`, default: 64.6, min: -1e6, max: 1e6, practice: { choices: [4, 8, 10, 12, 20] } },
      { key: 'syy', symbol: String.raw`\sum_i y_i^2`, label: '量測平方和', unit: `${U_Y}^2`, default: 198.98, min: -1e6, max: 1e6, practice: { choices: [20, 25, 40, 50, 100] } },
      // 「換一題」不抽 N = 1：只有一筆資料時三個和不能任意給（見 validate）
      { key: 'N', symbol: 'N', label: '資料筆數', default: 3, min: 1, max: 100000, integer: true, practice: { choices: [2, 4, 5, 10] } },
      { key: 'w', symbol: 'w', label: '想檢查的係數', unit: U_W, default: 2.5, min: -1000, max: 1000, practice: { choices: [0, 1, 2, 3] } },
    ],
    validate: ({ sxx, sxy, syy, N }) => {
      if (sxx < 0 || syy < 0) return '平方和不可能是負的：請檢查 $\\sum x_i^2$ 與 $\\sum y_i^2$。'
      if (sxx === 0)
        return '$\\sum x_i^2=0$：每一筆 $x$ 都是 0，資料不含 $a$ 的資訊——$J(w)$ 與 $w$ 無關（一條水平線），沒有最低點可找（不可辨識）。'
      if (sxy * sxy > sxx * syy * (1 + 1e-12))
        return String.raw`這三個和不可能來自同一組實數資料：Cauchy–Schwarz 不等式要求 $\big(\sum x_iy_i\big)^2\le\sum x_i^2\cdot\sum y_i^2$，這裡卻是 $${texNum(sxy * sxy)}>${texNum(sxx * syy)}$（否則最低成本 $J(w^*)$ 會變成負的）。`
      if (N === 1 && Math.abs(sxy * sxy - sxx * syy) > 1e-9 * Math.max(1, sxx * syy))
        return String.raw`只有一筆資料（$N=1$）時三個和就是 $x_1^2$、$x_1y_1$、$y_1^2$，一定滿足 $\big(\sum x_iy_i\big)^2=\sum x_i^2\cdot\sum y_i^2$；這裡卻是 $${texNum(sxy * sxy)}\ne${texNum(sxx * syy)}$。一筆資料永遠可以被一條過原點的直線完全通過（$J(w^*)=0$），不可能留下雜訊底——請把 $N$ 改成 $2$ 以上，或讓三個和滿足等號（例如 $4,\ 12,\ 36$）。`
      return null
    },
    solve: ({ sxx, sxy, syy, N, w }) => {
      const Exx = sxx / N
      const Exy = sxy / N
      const Eyy = syy / N
      const m = mseParabola(Exx, Exy, Eyy, w) // 模型：J、斜率、w*、J(w*)、二次碗
      const S = 7 // 兩個很接近的數相減，步驟裡多留幾位
      const t2 = 2 * w * Exy
      const t3 = w * w * Exx
      const proj = (Exy * Exy) / Exx
      const J = snap(m.J, Eyy)
      const slope = snap(m.slope, Exy)
      const jMin = snap(m.jMin, Eyy)
      const bowl = snap(m.bowl, Eyy)
      // normal equation（F-01.5）：E[e*x] = E[xy] − w*·E[x²] = −(在 w* 的斜率)，用同一個模型函式在 w = w* 求值
      const neq = snap(-mseParabola(Exx, Exy, Eyy, m.wStar).slope, Exy)
      return {
        steps: [
          { tex: String.raw`E[x^2]=\frac{\sum_i x_i^2}{N}=\frac{${texNum(sxx, S)}}{${N}}=${texNum(Exx, S)}`, why: '期望值用樣本平均代替：總和除以筆數（拋物線的曲率）。' },
          { tex: String.raw`E[xy]=\frac{\sum_i x_iy_i}{N}=\frac{${texNum(sxy, S)}}{${N}}=${texNum(Exy, S)}`, why: '同樣除以筆數。' },
          { tex: String.raw`E[y^2]=\frac{\sum_i y_i^2}{N}=\frac{${texNum(syy, S)}}{${N}}=${texNum(Eyy, S)}`, why: '同樣除以筆數（$w=0$ 時的 $2J$）。' },
          { tex: String.raw`2w\,E[xy]=2\times${texNumP(w)}\times${texNumP(Exy, S)}=${texNum(t2, S)}`, why: '拋物線的一次項。' },
          { tex: String.raw`w^2E[x^2]=${texNumP(w)}^2\times${texNum(Exx, S)}=${texNum(t3, S)}`, why: '拋物線的二次項。' },
          {
            tex: String.raw`J(w)=\tfrac12\big(E[y^2]-2w\,E[xy]+w^2E[x^2]\big)=\tfrac12\big(${texNum(Eyy, S)}-${texNumP(t2, S)}+${texNum(t3, S)}\big)=${texNum(J, S)}`,
            why: '三項合起來再乘 $\\tfrac12$（本站的成本含 $\\tfrac12$，勘誤 E41）。',
          },
          {
            tex: String.raw`\frac{dJ}{dw}=w\,E[x^2]-E[xy]=${texNumP(w)}\times${texNum(Exx, S)}-${texNumP(Exy, S)}=${texNum(slope, S)}`,
            why: '切線斜率 $=-E[e\\,x]$。斜率為負代表往右（$w$ 變大）成本下降；LMS 的平均更新量就是 $-\\mu$ 乘上它。',
          },
          {
            tex: String.raw`w^*=\frac{E[xy]}{E[x^2]}=\frac{${texNum(Exy, S)}}{${texNum(Exx, S)}}=${texNum(m.wStar, S)}`,
            why: '斜率為 0 的地方：令上一步的 $w\\,E[x^2]-E[xy]=0$ 解出 $w$。',
          },
          {
            tex: String.raw`E[e^*x]=E[xy]-w^*E[x^2]=${texNum(Exy, S)}-${texNumP(m.wStar, S)}\times${texNum(Exx, S)}=${texNum(Exy, S)}-${texNumP(m.wStar * Exx, S)}=${texNum(neq)}`,
            why: 'Normal equation（F-01.5）：因為 $e^*x=(y-w^*x)\\,x=xy-w^*x^2$，取平均就是這一行。在最佳解處誤差與輸入不相關——再調 $w$ 也消不掉任何「跟著 $x$ 走」的成分。手算時 $w^*$ 四捨五入過，會剩下一點尾數，不是算錯。',
          },
          {
            tex: String.raw`\frac{E[xy]^2}{E[x^2]}=\frac{${texNumP(Exy, S)}^2}{${texNum(Exx, S)}}=\frac{${texNum(Exy * Exy, S)}}{${texNum(Exx, S)}}=${texNum(proj, S)}`,
            why: '$y$ 的能量中，能被「調 $w$」解釋掉的部分。',
          },
          {
            tex: String.raw`J(w^*)=\tfrac12\Big(E[y^2]-\frac{E[xy]^2}{E[x^2]}\Big)=\tfrac12\big(${texNum(Eyy, S)}-${texNum(proj, S)}\big)=${texNum(jMin, S)}`,
            why: '雜訊底：調 $w$ 消不掉的成本。這是兩個很接近的數相減，中間值至少保留 6–7 位有效數字。',
          },
          {
            tex: String.raw`\tfrac12E[x^2]\,(w-w^*)^2=\tfrac12\times${texNum(Exx, S)}\times\big(${texNum(w)}-${texNumP(m.wStar, S)}\big)^2=\tfrac12\times${texNum(Exx, S)}\times${texNumP(snap(w - m.wStar, w), S)}^2=${texNum(bowl, S)}`,
            why: '二次碗：偏離 $w^*$ 要多付的成本，曲率就是 $E[x^2]$。',
          },
          {
            tex: String.raw`J(w^*)+\tfrac12E[x^2]\,(w-w^*)^2=${texNum(jMin, S)}+${texNum(bowl, S)}=${texNum(snap(jMin + bowl, Eyy), S)}=J(w)\ \checkmark`,
            why: '配方驗算（F-01.6）：雜訊底 + 二次碗必須等於前面直接算的 $J(w)$。',
          },
        ],
        results: [
          { symbol: 'J(w)', label: '所選係數的成本', value: J, unit: `${U_Y}^2` },
          { symbol: String.raw`\dfrac{dJ}{dw}`, label: '所選係數處的切線斜率', value: slope, unit: `${U_X}${U_Y}`, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: 'w^*', label: '最低點的位置', value: m.wStar, unit: U_W, digits: 6 },
          { symbol: 'J(w^*)', label: '最低成本（雜訊底）', value: jMin, unit: `${U_Y}^2`, tolerance: { rel: 0.03, abs: 1e-6 }, digits: 6 },
        ],
        notes: [
          slope === 0
            ? '斜率為 0：你選的 $w$ 就是最低點 $w^*$。'
            : slope < 0
              ? String.raw`斜率 $${texNum(slope, 4)}<0$：$w$ 在最低點的左邊，往右走成本下降——LMS 會把 $w$ 調大。`
              : String.raw`斜率 $${texNum(slope, 4)}>0$：$w$ 在最低點的右邊，往左走成本下降——LMS 會把 $w$ 調小。`,
          jMin === 0
            ? '$J(w^*)=0$：資料完全落在一條過原點的直線上（沒有雜訊），誤差可以被調到 0。'
            : String.raw`$J(w^*)=${texNum(jMin, 4)}>0$：不管 $w$ 怎麼調都剩下這麼多成本；若雜訊與 $x$ 不相關，它就是 $\tfrac12E[v^2]$。`,
        ],
      }
    },
    tips: [
      '只有四則運算，但 $J(w^*)$ 是「大數減大數」：$E[y^2]$ 與 $E[xy]^2/E[x^2]$ 都要算到 6–7 位有效數字再相減。',
      '範例數字是 §1.2 的三筆資料：$\\sum x^2=21$、$\\sum xy=64.6$、$\\sum y^2=198.98$、$N=3$，在 $w=2.5$（圖上畫切線的那一點）斜率是 $-4.0333$，$J(w^*)\\approx0.0430$。',
      '想對照 §1.4 的手算例（固定 $x=2$、$y=6$、無雜訊）：填 $\\sum x^2=4$、$\\sum xy=12$、$\\sum y^2=36$、$N=1$，會得到 $w^*=3$、$J(w^*)=0$、斜率 $-(a-w)x^2$。',
      '三個和不能亂填：一定要 $\\big(\\sum xy\\big)^2\\le\\sum x^2\\cdot\\sum y^2$（Cauchy–Schwarz），$N=1$ 時還必須取等號；不符合時這題會說明原因。單位：$J$ 是 $[y]^2$、斜率是 $[x][y]$、$w^*$ 是 $[y]/[x]$。',
    ],
  },
  {
    id: 'HC-01.3',
    title: '$\\tfrac12$ 的陷阱：對 $J_2$ 做梯度下降，步長該用 $\\mu$ 還是 $\\mu/2$？',
    page: PAGE,
    formulaId: 'F-01.7',
    formulaTex: String.raw`\underbrace{w-\mu\,\frac{\partial}{\partial w}\tfrac12e^2}_{\text{LMS}}=w+\mu\,e\,x=\underbrace{w-\frac{\mu}{2}\,\frac{\partial}{\partial w}e^2}_{J_2,\ \text{步長 }\mu/2}\ \ne\ \underbrace{w-\mu\,\frac{\partial}{\partial w}e^2}_{J_2,\ \text{步長 }\mu}=w+2\mu\,e\,x`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的係數', unit: U_W, default: 1, min: -100, max: 100, practice: { choices: [-1, 0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', unit: U_X, default: 2, min: -20, max: 20, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', unit: U_Y, default: 6, min: -1000, max: 1000, practice: { min: -8, max: 8, step: 2 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: U_MU, default: 0.4, min: -10, max: 10, practice: { choices: [0.1, 0.2, 0.3, 0.4, 0.6] } },
    ],
    validate: ({ x, mu }) => {
      if (x === 0) return '$x=0$：誤差 $e=y$ 與 $w$ 無關，兩種梯度都是 0、$w$ 不會動，也沒有步長上限可談（不可辨識）。請換一個非零的 $x$。'
      if (mu < 0)
        return String.raw`$\mu<0$：更新方向顛倒——沿著梯度往上坡走，$p=1-\mu x^2=${texNum(fixedXPole(mu, x))}>1$，誤差每一步都被放大。這是極性錯誤，不是步長大小的問題（有沒有 $\tfrac12$ 都救不了）。請輸入 $\mu\ge0$。`
      return null
    },
    solve: ({ w, x, y, mu }) => {
      const lms = conventionalStep({ w, x, y, mu }) // 對 ½e² 用步長 μ（= 對 e² 用 μ/2）
      const dbl = conventionalStep({ w, x, y, mu: 2 * mu }) // 對 e² 用步長 μ：μ·2ex = (2μ)·ex
      const e = lms.e
      const gHalf = snap(-e * x, e)
      const gFull = snap(-2 * e * x, e)
      const p = fixedXPole(mu, x)
      const p2 = fixedXPole(2 * mu, x)
      const st = fixedXStability(mu, x)
      const muMax = fixedXMuMax(x)
      const wrongBound = st.muOneStep // 1/x²：把 J₂ 的曲率 2x² 當成 LMS 的曲率時算出來的「上限」
      const xx = x * x
      return {
        steps: [
          { tex: String.raw`e=y-w\,x=${texNum(y)}-${texNumP(w)}\times${texNumP(x)}=${texNum(e)}`, why: '預測誤差。' },
          {
            tex: String.raw`\frac{\partial}{\partial w}\,\tfrac12e^2=-e\,x=-${texNumP(e)}\times${texNumP(x)}=${texNum(gHalf)}`,
            why: '單筆成本 $j=\\tfrac12e^2$ 的梯度：$\\tfrac12$ 正好消掉平方帶下來的 2。',
          },
          {
            tex: String.raw`w_{\text{LMS}}=w-\mu\,(-e\,x)=${texNum(w)}-${texNum(mu)}\times${texNumP(gHalf)}=${texNum(lms.w)}`,
            why: 'LMS：往梯度的反方向走 $\\mu$ 倍，也就是 $w+\\mu e x$。',
          },
          {
            tex: String.raw`\frac{\partial}{\partial w}\,e^2=-2e\,x=-2\times${texNumP(e)}\times${texNumP(x)}=${texNum(gFull)}`,
            why: '沒有 $\\tfrac12$ 的 $J_2$：梯度大 2 倍。',
          },
          {
            tex: String.raw`w_{J_2,\,\mu/2}=w-\frac{\mu}{2}\,(-2e\,x)=${texNum(w)}-\frac{${texNum(mu)}}{2}\times${texNumP(gFull)}=${texNum(w)}-${texNum(mu / 2)}\times${texNumP(gFull)}=${texNum(lms.w)}`,
            why: '步長減半剛好抵消多出來的 2：和 LMS 完全一樣（等價寫法）。',
          },
          {
            tex: String.raw`w_{J_2,\,\mu}=w-\mu\,(-2e\,x)=${texNum(w)}-${texNum(mu)}\times${texNumP(gFull)}=${texNum(dbl.w)}`,
            why: '步長不減半：每一步比 LMS 大 2 倍——這不是 LMS。',
          },
          {
            tex: String.raw`x^2=${texNumP(x)}^2=${texNum(xx)}`,
            why: '輸入的平方（固定 $x$ 時的輸入功率 $P_x$，也就是 $J$ 的曲率）：下面四步都會用到。',
          },
          {
            tex: String.raw`p=1-\mu x^2=1-${texNum(mu)}\times${texNum(xx)}=${texNum(p)}`,
            why: 'LMS 的 pole：參數誤差 $\\delta=a-w$ 每一步乘上的倍數（F-01.8）。',
          },
          {
            tex: String.raw`p_{J_2,\,\mu}=1-2\mu x^2=1-2\times${texNum(mu)}\times${texNum(xx)}=${texNum(p2)}`,
            why: '「對 $J_2$ 用步長 $\\mu$」的 pole：曲率是 $2x^2$，所以多一個 2。',
          },
          {
            tex: String.raw`\mu_{\max}=\frac{2}{x^2}=\frac{2}{${texNum(xx)}}=${texNum(muMax)}`,
            why: 'LMS 真正的穩定上限（$|p|<1$）。',
          },
          {
            tex: String.raw`\frac{1}{x^2}=\frac{1}{${texNum(xx)}}=${texNum(wrongBound)}`,
            why: '把 $J_2$ 的曲率 $2x^2$ 誤當成 LMS 的曲率會得到的「上限」：只有真正上限的一半。',
          },
        ],
        results: [
          { symbol: String.raw`w_{\text{LMS}}`, label: 'LMS 更新後（也等於「步長減半」的寫法）', value: lms.w, unit: U_W },
          { symbol: String.raw`w_{J_2,\,\mu}`, label: '步長沒有減半的更新結果', value: dbl.w, unit: U_W },
          { symbol: 'p', label: 'LMS 的 pole', value: p, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`p_{J_2,\,\mu}`, label: '步長沒有減半時的 pole', value: p2, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`\mu_{\max}`, label: 'LMS 的穩定上限', value: muMax, unit: U_MU },
        ],
        notes: [
          String.raw`LMS：$p=${texNum(p)}$，${BEHAVIOUR_TEXT[classifyPole(p)]}；對 $J_2$ 用步長 $\mu$：$p=${texNum(p2)}$，${BEHAVIOUR_TEXT[classifyPole(p2)]}。`,
          mu <= 0
            ? '$\\mu=0$：兩種寫法都不更新。'
            : mu < wrongBound
              ? String.raw`$\mu=${texNum(mu)}<1/x^2=${texNum(wrongBound)}$：兩種寫法都收斂，只是「$J_2$ 配 $\mu$」每步走兩倍遠。`
              : mu < muMax
                ? String.raw`$1/x^2=${texNum(wrongBound)}\le\mu=${texNum(mu)}<2/x^2=${texNum(muMax)}$：LMS 仍收斂；但若用 $J_2$ 的曲率去推上限，會誤以為這個 $\mu$ 不能用——白白砍掉一半的範圍（勘誤 E41）。`
                : String.raw`$\mu=${texNum(mu)}\ge2/x^2=${texNum(muMax)}$：連 LMS 也不收斂了。`,
        ],
      }
    },
    tips: [
      '只有乘法與加減。兩個梯度只差一個 2，所以「$J_2$ 配 $\\mu/2$」和「$\\tfrac12J_2$ 配 $\\mu$」是同一件事。',
      '範例數字（$x=2$、$\\mu=0.4$）就是 §1.3 與思考題 2：$1/x^2=0.25<0.4<0.5=2/x^2$，LMS 的 $p=-0.6$（正負交替收斂），但「$J_2$ 配 $\\mu$」的 $p=-2.2$（發散）。',
      '把 $\\mu$ 改成 $0.1$（T01 的值）：$w_{\\text{LMS}}=1.8$，而「$J_2$ 配 $\\mu$」會走到 $2.6$。',
    ],
  },
  {
    id: 'HC-01.4',
    title: '固定 $x$ 加上雜訊：第 $n$ 步的平均在哪、抖多大？',
    page: PAGE,
    formulaId: 'F-01.9',
    formulaTex: String.raw`E[w_n]=a-p^{\,n}\delta_0,\quad p=1-\mu x^2,\quad \delta_0=a-w_0;\qquad \operatorname{Var}(w_n)=\mu^2x^2\sigma_v^2\,\frac{1-p^{2n}}{1-p^2}\ \xrightarrow{n\to\infty}\ \frac{\mu\,\sigma_v^2}{2-\mu x^2}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實係數', unit: U_W, default: 3, min: -100, max: 100, practice: { choices: [1, 2, 3, 5] } },
      { key: 'w0', symbol: 'w_0', label: '初始值', unit: U_W, default: 1, min: -100, max: 100, practice: { choices: [0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', unit: U_X, default: 2, min: -20, max: 20, practice: { choices: [-2, 0.5, 1, 2] } },
      // 0.4 配 x = ±2 會抽到 p = −0.6（正負交替收斂）；validate 會擋掉 μx² ≥ 2 的組合
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: U_MU, default: 0.1, min: -10, max: 10, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.4] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: '量測雜訊的標準差', unit: U_Y, default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
      { key: 'n', symbol: 'n', label: '更新幾次', default: 2, min: 1, max: 60, integer: true, practice: { choices: [1, 2, 3, 4] } },
    ],
    validate: ({ x, mu }) => {
      if (x === 0) return '$x=0$：每筆資料都不含 $a$ 的資訊，$w$ 永遠停在 $w_0$（$p=1$），沒有收斂也沒有穩態可算。請換一個非零的 $x$。'
      const p = fixedXPole(mu, x)
      if (mu <= 0)
        return String.raw`$\mu\le0$：$p=1-\mu x^2=${texNum(p)}\ge1$，不更新或沿著梯度上坡走；$\operatorname{Var}(w_n)$ 不會收斂到穩態。請選 $0<\mu<2/x^2=${texNum(fixedXMuMax(x))}$。`
      if (Math.abs(p) >= 1)
        return String.raw`$\mu x^2=${texNum(mu * x * x)}\ge2$：$|p|=${texNum(Math.abs(p))}\ge1$，每一筆雜訊都不會被「忘掉」，$\operatorname{Var}(w_n)$ 隨 $n$ 無界成長——穩態公式 $\mu\sigma_v^2/(2-\mu x^2)$ 不適用（分母 $\le0$）。請選 $\mu<2/x^2=${texNum(fixedXMuMax(x))}$。`
      return null
    },
    solve: ({ a, w0, x, mu, sigma, n }) => {
      const p = snap(fixedXPole(mu, x)) // μx² = 1 時把 10⁻¹⁷ 之類的浮點尾巴當成 p = 0（一步到位）
      const xx = x * x
      const g = mu * xx // μx²（無因次）：p = 1 − μx²，穩態公式的分母 2 − μx² 也用它
      const ss = sigma * sigma
      const d0 = a - w0 // δ = a − w（勘誤 E39）
      const pn = snap(p ** n)
      const pp = p * p
      const p2n = snap(p ** (2 * n))
      const num = 1 - p2n // 等比級數和的分子
      const den = 1 - pp // 分母（validate 已保證 |p| < 1 ⇒ den > 0）
      const wn = playgroundClosedForm(a, w0, x, mu, n) // F-01.8：w_n = a − (a − w₀)pⁿ
      const inject = mu * mu * xx * sigma * sigma
      const varN = playgroundVarW(mu, x, sigma, n) // F-01.9（精確）
      const varInf = playgroundVarWStationary(mu, x, sigma)
      const stdInf = Math.sqrt(varInf)
      const mse = xx * varInf + ss
      return {
        steps: [
          { tex: String.raw`\mu x^2=${texNum(mu)}\times${texNumP(x)}^2=${texNum(g)}`, why: '先算 $\\mu x^2$（無因次）：它決定 pole，最後的穩態公式也會再用到。' },
          { tex: String.raw`p=1-\mu x^2=1-${texNum(g)}=${texNum(p)}`, why: 'pole：平均誤差每一步乘上的倍數。$|p|<1$ 才收斂。' },
          { tex: String.raw`\delta_0=a-w_0=${texNum(a)}-${texNumP(w0)}=${texNum(d0)}`, why: '初始參數誤差。全站極性是 $\\delta=a-w$（勘誤 E39）。' },
          {
            tex: String.raw`p^{\,${n}}=${texNumP(p)}^{${n}}=${texNum(pn)}`,
            why:
              p < 0
                ? '把 $p$ 連乘 $n$ 次。$p<0$ 時有些計算機的 $[x^y]$ 不接受負的底數：先算 $|p|^n$，$n$ 是奇數再補上負號。'
                : '計算機按 $[x^y]$，或把 $p$ 連乘 $n$ 次。',
          },
          {
            tex: String.raw`E[w_{${n}}]=a-p^{\,${n}}\delta_0=${texNum(a)}-${texNumP(pn)}\times${texNumP(d0)}=${texNum(wn)}`,
            why: '雜訊零均值，所以平均值走的路和無雜訊時完全一樣（F-01.8）。',
          },
          {
            tex: String.raw`\mu^2x^2\sigma_v^2=${texNumP(mu)}^2\times${texNumP(x)}^2\times${texNum(sigma)}^2=${texNum(mu * mu)}\times${texNum(xx)}\times${texNum(ss)}=${texNum(inject)}`,
            why: '每一步新注入的變異數：更新量裡的雜訊項是 $\\mu x\\,v_n$，變異數是 $(\\mu x)^2\\sigma_v^2$。三個數各自平方再相乘。',
          },
          { tex: String.raw`p^2=${texNumP(p)}^2=${texNum(pp)}`, why: '舊雜訊的變異數每一步乘上 $p^2$（變異數是「平方」的量，所以倍數也要平方）。' },
          {
            tex: String.raw`p^{\,${2 * n}}=\big(p^{\,${n}}\big)^2=${texNumP(pn)}^2=${texNum(p2n)}`,
            why: '$n$ 步後舊雜訊只剩 $p^{2n}$：把前面算好的 $p^{n}$ 再平方一次就好，不必重按 $[x^y]$。',
          },
          {
            tex: String.raw`\begin{aligned}1-p^{\,${2 * n}}&=1-${texNumP(p2n)}=${texNum(num)}\\1-p^2&=1-${texNumP(pp)}=${texNum(den)}\end{aligned}`,
            why: '等比級數求和公式 $1+r+\\dots+r^{n-1}=\\dfrac{1-r^n}{1-r}$ 的分子與分母（公比 $r=p^2$），兩個減法分開算。',
          },
          {
            tex: String.raw`\operatorname{Var}(w_{${n}})=\mu^2x^2\sigma_v^2\,\frac{1-p^{${2 * n}}}{1-p^2}=${texNum(inject)}\times\frac{${texNum(num)}}{${texNum(den)}}=${texNum(varN)}`,
            why: '每步注入量乘上級數和（F-01.9，精確式）：先除、再乘。',
          },
          {
            tex: String.raw`\operatorname{Var}(w_\infty)=\frac{\mu\,\sigma_v^2}{2-\mu x^2}=\frac{${texNum(mu)}\times${texNum(sigma)}^2}{2-${texNum(g)}}=\frac{${texNum(mu * ss)}}{${texNum(2 - g)}}=${texNum(varInf)}`,
            why: '$n\\to\\infty$ 時 $p^{2n}\\to0$，再用 $1-p^2=\\mu x^2(2-\\mu x^2)$ 約分後的穩態變異數；$\\mu x^2$ 是第 1 步算好的。先算分子、分母，再相除。',
          },
          { tex: String.raw`\operatorname{std}(w_\infty)=\sqrt{${texNum(varInf)}}=${texNum(stdInf)}`, why: '開根號得到標準差：$w$ 大約在 $a\\pm$ 這麼多的範圍內抖動（單位與 $w$ 相同）。' },
          {
            tex: String.raw`E[e_\infty^2]=x^2\operatorname{Var}(w_\infty)+\sigma_v^2=${texNumP(x)}^2\times${texNum(varInf)}+${texNum(sigma)}^2=${texNum(xx * varInf)}+${texNum(ss)}=${texNum(mse)}`,
            why: '誤差的均方（MSE）$\\ne$ 係數的均方偏差（MSD，勘誤 E42）：$\\sigma_v^2$ 是調 $w$ 消不掉的雜訊底，前一項是 LMS 自己抖動多付的代價。',
          },
        ],
        results: [
          { symbol: 'p', label: 'pole', value: p, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: `E[w_{${n}}]`, label: `第 ${n} 步的平均`, value: wn, unit: U_W },
          { symbol: String.raw`\operatorname{Var}(w_{${n}})`, label: `第 ${n} 步的變異數`, value: varN, unit: `${U_Y}^2/${U_X}^2`, tolerance: { rel: 0.02, abs: 1e-12 } },
          { symbol: String.raw`\operatorname{Var}(w_\infty)`, label: '穩態變異數', value: varInf, unit: `${U_Y}^2/${U_X}^2`, tolerance: { rel: 0.01, abs: 1e-12 } },
          { symbol: String.raw`\operatorname{std}(w_\infty)`, label: '穩態標準差', value: stdInf, unit: U_W, tolerance: { rel: 0.01, abs: 1e-12 } },
        ],
        notes: [
          p > 0
            ? String.raw`$p=${texNum(p)}$：${BEHAVIOUR_TEXT[classifyPole(p)]}。$\mu$ 越小 $\operatorname{Var}(w_\infty)$ 越小，但 $p$ 越接近 1、收斂越慢——LMS 永遠的取捨。`
            : p === 0
              ? String.raw`$p=0$：${BEHAVIOUR_TEXT[classifyPole(p)]}（平均值一步就到 $a$）；但每一步也把整份雜訊 $\mu x\,v_n=v_n/x$ 直接寫進 $w$。想要更小的抖動就得降低 $\mu$、接受較慢的收斂。`
              : String.raw`$p=${texNum(p)}$：${BEHAVIOUR_TEXT[classifyPole(p)]}。這個 $\mu$ 已經超過「一步到位」的 $1/x^2=${texNum(1 / xx)}$：再加大 $\mu$，$|p|$ 變大（收斂變慢）、$\operatorname{Var}(w_\infty)$ 也變大——在 $1/x^2<\mu<2/x^2$ 這一段兩頭都吃虧。`,
          sigma === 0
            ? '$\\sigma_v=0$：沒有雜訊，$w_n$ 是確定的，變異數為 0（回到 §1.4 的無雜訊手算例）。'
            : String.raw`第 $${n}$ 步時，變異數已經長到穩態值的 $${texNum((100 * varN) / varInf, 3)}\%$（比例就是 $1-p^{${2 * n}}$）。`,
        ],
      }
    },
    tips: [
      '次方：工程計算機按 $[x^y]$（例如 $0.6\\;[x^y]\\;4=0.1296$），或直接連乘；$p<0$ 時先算 $|p|^n$，$n$ 為奇數再補負號。開根號按 $[\\sqrt{\\ }]$。',
      '範例數字是 T01 的手算例（$a=3,\\ w_0=1,\\ x=2,\\ \\mu=0.1$）加上 §1.4.1 的 $\\sigma_v=1$：$E[w_2]=2.28$（和無雜訊的 $w_2$ 相同）、$\\operatorname{Var}(w_\\infty)=0.0625$、std $=0.25$。',
      '先確認 $0<\\mu<2/x^2$ 再算；$\\mu x^2\\ge2$ 時分母 $2-\\mu x^2\\le0$，公式給出的負數沒有意義。',
      '單位：$\\mu$ 是 $1/[x]^2$，所以 $\\mu x^2$ 與 $p$ 無因次；$w$、$\\operatorname{std}(w)$ 是 $[y]/[x]$，$\\operatorname{Var}(w)$ 是它的平方；$E[e^2]$ 是 $[y]^2$。',
    ],
  },
  {
    id: 'HC-01.5',
    title: '同一個誤差、三種 $\\psi$：LMS、Sign-Error、Huber 各走一步',
    page: PAGE,
    formulaId: 'F-01.11',
    formulaTex: String.raw`\Delta w=\mu\,\psi(e)\,x,\qquad \psi_2(e)=e,\quad \psi_1(e)=\operatorname{sign}(e),\quad \psi_H(e)=\operatorname{clip}(e,-\delta_H,\delta_H)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的係數', unit: U_W, default: 1, min: -100, max: 100, practice: { choices: [-1, 0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '輸入', unit: U_X, default: 1, min: -20, max: 20, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', unit: U_Y, default: 3, min: -1000, max: 1000, practice: { min: -6, max: 8, step: 1 } },
      // μ 不標單位：同一個數值填進三種演算法，單位並不相同（見提示）
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（三種演算法共用同一個數值）', default: 0.2, min: -10, max: 10, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
      { key: 'dH', symbol: String.raw`\delta_H`, label: 'Huber 門檻', unit: U_Y, default: 1, min: -1000, max: 1000, practice: { choices: [0.5, 1, 2] } },
    ],
    validate: ({ mu, dH }) => {
      if (dH <= 0) return '$\\delta_H$ 必須是正數：它是「誤差多大以後改用線性懲罰」的門檻；$\\delta_H=0$ 時 $\\psi_H\\equiv0$，Huber 完全不更新。'
      if (mu < 0) return '$\\mu<0$：三種更新都會朝誤差變大的方向走（$\\Delta w$ 與 $\\psi(e)\\,x$ 反號）——這是極性錯誤，不是三種損失的差別。請輸入 $\\mu\\ge0$。'
      return null
    },
    solve: ({ w, x, y, mu, dH }) => {
      const lms = conventionalStep({ w, x, y, mu })
      const se = signErrorStep({ w, x, y, mu, tie: 'zero' }) // sign(0) = 0（數學次梯度，勘誤 E40）
      const hub = huberStep({ w, x, y, mu, huberDelta: dH })
      const e = lms.e
      const psi1 = lossPsi('mae', e, dH, 'zero')
      const psiH = lossPsi('huber', e, dH)
      const inside = Math.abs(e) <= dH
      const rho2 = lossRho('mse', e, dH)
      const rho1 = lossRho('mae', e, dH)
      const rhoH = lossRho('huber', e, dH)
      return {
        steps: [
          { tex: String.raw`e=y-w\,x=${texNum(y)}-${texNumP(w)}\times${texNumP(x)}=${texNum(e)}`, why: '三種演算法看到的是同一個誤差。' },
          {
            tex: String.raw`\Delta w_{\text{LMS}}=\mu\,e\,x=${texNum(mu)}\times${texNumP(e)}\times${texNumP(x)}=${texNum(lms.dw)}`,
            why: 'MSE：$\\psi_2(e)=e$，步伐和誤差大小成正比。',
          },
          {
            tex: String.raw`\Delta w_{\text{SE}}=\mu\,\operatorname{sign}(e)\,x=${texNum(mu)}\times${texNumP(psi1)}\times${texNumP(x)}=${texNum(se.dw)}`,
            why:
              e === 0
                ? 'MAE：$e=0$ 時 $\\operatorname{sign}(0)$ 要看慣例——這裡用數學次梯度 $0$；硬體 comparator 只會給 $\\pm1$（勘誤 E40）。'
                : 'MAE：$\\psi_1(e)=\\operatorname{sign}(e)$，只看誤差的正負，不管它多大。',
          },
          {
            tex: inside
              ? String.raw`|e|=${texNum(Math.abs(e))}\le\delta_H=${texNum(dH)}\ \Rightarrow\ \psi_H(e)=e=${texNum(psiH)}`
              : String.raw`|e|=${texNum(Math.abs(e))}>\delta_H=${texNum(dH)}\ \Rightarrow\ \psi_H(e)=\delta_H\operatorname{sign}(e)=${texNum(psiH)}`,
            why: 'Huber：先比較 $|e|$ 與門檻。沒超過就原樣通過（像 LMS），超過就截成 $\\pm\\delta_H$（像 Sign-Error）。',
          },
          {
            tex: String.raw`\Delta w_{H}=\mu\,\psi_H(e)\,x=${texNum(mu)}\times${texNumP(psiH)}\times${texNumP(x)}=${texNum(hub.dw)}`,
            why: '用截斷後的 $\\psi_H$ 代替 $e$。',
          },
          {
            tex: String.raw`\begin{aligned}w_{\text{LMS}}&=${texNum(w)}+${texNumP(lms.dw)}=${texNum(lms.w)}\\w_{\text{SE}}&=${texNum(w)}+${texNumP(se.dw)}=${texNum(se.w)}\\w_{H}&=${texNum(w)}+${texNumP(hub.dw)}=${texNum(hub.w)}\end{aligned}`,
            why: '各自加上自己的更新量。',
          },
          {
            tex: String.raw`\rho_2(e)=\tfrac12e^2=\tfrac12\times${texNumP(e)}^2=${texNum(rho2)}`,
            why: '這個誤差在 MSE 下被記多少成本（F-01.10）：平方成長。',
          },
          {
            tex: String.raw`\rho_1(e)=|e|=${texNum(rho1)}`,
            why: 'MAE 的成本：線性成長。',
          },
          {
            tex: inside
              ? String.raw`\rho_H(e)=\tfrac12e^2=\tfrac12\times${texNumP(e)}^2=${texNum(rhoH)}\qquad(|e|\le\delta_H)`
              : String.raw`\rho_H(e)=\delta_H\big(|e|-\tfrac12\delta_H\big)=${texNum(dH)}\times\big(${texNum(Math.abs(e))}-\tfrac12\times${texNum(dH)}\big)=${texNum(dH)}\times${texNumP(snap(Math.abs(e) - dH / 2, dH))}=${texNum(rhoH)}`,
            why: 'Huber 的成本：門檻內和 MSE 一樣，門檻外改成線性成長（在 $|e|=\\delta_H$ 處兩段的值與斜率都接得起來）。',
          },
        ],
        results: [
          { symbol: 'e', label: '誤差', value: e, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`w_{\text{LMS}}`, label: 'Conventional LMS 更新後', value: lms.w, unit: U_W },
          { symbol: String.raw`w_{\text{SE}}`, label: 'Sign-Error LMS 更新後', value: se.w, unit: U_W },
          { symbol: 'w_{H}', label: 'Huber LMS 更新後', value: hub.w, unit: U_W },
          { symbol: String.raw`\rho_H(e)`, label: 'Huber 損失', value: rhoH, unit: `${U_Y}^2`, tolerance: { rel: 0.01, abs: 1e-9 } },
        ],
        notes: [
          e === 0
            ? '$e=0$：LMS 與 Huber 都不動；Sign-Error 動不動完全由 $\\operatorname{sign}(0)$ 的慣例決定（數學次梯度 $0$：不動；comparator：走 $\\pm\\mu|x|$）。'
            : inside
              ? String.raw`$|e|\le\delta_H$：Huber 這一步和 LMS 完全相同；Sign-Error 不管誤差多小都走 $\mu|x|=${texNum(mu * Math.abs(x))}$。`
              : String.raw`$|e|>\delta_H$：Huber 這一步等於 $\delta_H$ 倍的 Sign-Error（$${texNum(dH)}\times${texNumP(se.dw)}=${texNum(hub.dw)}$）；誤差再大，它的影響力也不超過 $\delta_H$。`,
        ],
      }
    },
    tips: [
      '只有乘法、加減與一次「比大小」。順序固定：先算 $e$，再把 $e$ 換成各自的 $\\psi(e)$，最後乘 $\\mu$ 與 $x$。',
      '範例數字是 §2.2.1 的單步比較（$a=3,\\ x=1$ 所以 $y=3$；$w=1,\\ \\mu=0.2,\\ \\delta_H=1$）：$e=2$，三種演算法分別走到 $1.4$、$1.2$、$1.2$。',
      '把 $y$ 改成 $1.5$（$e=0.5\\le\\delta_H$）：Huber 就和 LMS 一樣了。把 $y$ 改成 $21$（outlier）：LMS 一步跳 $4$，另外兩個仍只走 $0.2$。',
      '單位提醒：同一個數值的 $\\mu$，在 LMS／Huber 是 $1/[x]^2$、在 Sign-Error 是 $[y]/[x]^2$（$\\operatorname{sign}(e)$ 無因次），所以這題的 $\\mu$ 不標單位。Sign-Error 每步固定走 $\\mu|x|$，要拿它和誤差的典型大小比才知道算大還是小。',
    ],
  },
  {
    id: 'HC-01.6',
    title: '四筆資料：平均（MSE 最佳）vs 中位數（MAE 最佳），與 MAE 的斜率',
    page: PAGE,
    formulaId: 'F-01.13',
    formulaTex: String.raw`w^*_{\text{MSE}}=\frac1N\sum_i y_i,\qquad w^*_{\text{MAE}}=\operatorname{median}\{y_i\},\qquad \frac{d}{dw}\,\frac1N\sum_i|y_i-w|=\frac{\#\{y_i<w\}-\#\{y_i>w\}}{N}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'y1', symbol: 'y_1', label: '第 1 筆', unit: U_Y, default: 0, min: -1000, max: 1000, practice: { choices: [0, 1, 2, 3] } },
      { key: 'y2', symbol: 'y_2', label: '第 2 筆', unit: U_Y, default: 0, min: -1000, max: 1000, practice: { choices: [0, 1, 2, 4] } },
      { key: 'y3', symbol: 'y_3', label: '第 3 筆', unit: U_Y, default: 0, min: -1000, max: 1000, practice: { choices: [0, 2, 3, 5] } },
      { key: 'y4', symbol: 'y_4', label: '第 4 筆（outlier）', unit: U_Y, default: 10, min: -1000, max: 1000, practice: { choices: [10, 20, 50, 100] } },
      { key: 'w', symbol: 'w', label: '想檢查斜率的位置', unit: U_Y, default: 5, min: -1000, max: 1000, practice: { choices: [0.5, 1.5, 2.5, 4.5, 7.5] } },
    ],
    validate: ({ y1, y2, y3, y4, w }) => {
      const y = [y1, y2, y3, y4]
      if (!y.includes(w)) return null
      const near = [0.5, 0.25, 0.1, 0.05, 0.01].map((d) => Number((w + d).toPrecision(10))).find((c) => !y.includes(c)) ?? w + 0.001
      return String.raw`$w=${texNum(w)}$ 剛好等於其中一筆資料：$|y_i-w|$ 在這裡是尖點，導數不存在（只有一整段次梯度，§2.2）。計數差公式要求 $w\ne y_i$——請把 $w$ 移開一點（例如 $${texNum(near)}$）。`
    },
    solve: ({ y1, y2, y3, y4, w }) => {
      const y = [y1, y2, y3, y4]
      const N = y.length
      const bo = batchOptima(y) // lms.ts：平均與中位數區間
      const sorted = [...y].sort((p, q) => p - q)
      const total = sum(y)
      const below = y.filter((v) => v < w).length
      const above = y.filter((v) => v > w).length
      const slope = snap(-sum(y.map((v) => lossPsi('mae', v - w, 1, 'zero'))) / N) // dJ_MAE/dw = −(1/N)Σψ₁(y_i − w)
      const absAt = (t: number) => y.map((v) => Math.abs(v - t))
      const absTerms = (t: number) => y.map((v) => `|${texNum(v)}-${texNumP(t)}|`).join('+')
      const sqAt = (t: number) => y.map((v) => (v - t) ** 2)
      const maeAtMean = averageCost('mae', bo.mse, ONES4, y)
      const maeAtMed = averageCost('mae', bo.maeLow, ONES4, y)
      const mseAtMean = averageCost('mse', bo.mse, ONES4, y)
      const mseAtMed = averageCost('mse', bo.maeLow, ONES4, y)
      const unique = bo.maeLow === bo.maeHigh
      return {
        steps: [
          { tex: String.raw`\sum_i y_i=${plus(y)}=${texNum(total)}`, why: '先加總。' },
          { tex: String.raw`w^*_{\text{MSE}}=\frac{\sum_i y_i}{N}=\frac{${texNum(total)}}{${N}}=${texNum(bo.mse)}`, why: '最小平方解是平均值：每一筆（包括 outlier）都按比例把它拉過去。' },
          {
            tex: String.raw`y_{(1)}\le y_{(2)}\le y_{(3)}\le y_{(4)}:\quad ${sorted.map((v) => texNum(v)).join(',\\ ')}`,
            why: '由小到大排序。',
          },
          {
            tex: String.raw`w^*_{\text{MAE}}\in\big[y_{(2)},\,y_{(3)}\big]=\big[${texNum(bo.maeLow)},\ ${texNum(bo.maeHigh)}\big]`,
            why: unique
              ? '$N=4$ 是偶數，中位數落在中間兩筆之間；這裡兩筆相同，所以中位數唯一。'
              : '$N=4$ 是偶數，中間兩筆不同：兩者之間（含端點）每一點都是 MAE 的最小值——一整段平坦的谷底。',
          },
          {
            tex: String.raw`J_{\text{MAE}}'(${texNum(w)})=\frac{\#\{y_i<${texNum(w)}\}-\#\{y_i>${texNum(w)}\}}{N}=\frac{${below}-${above}}{${N}}=${texNum(slope)}`,
            why: '數一數有幾筆在 $w$ 下面、幾筆在上面：下面的各貢獻 $+1$、上面的各貢獻 $-1$（F-01.13）。',
          },
          {
            tex: String.raw`J_{\text{MAE}}\big(${texNum(bo.mse)}\big)=\tfrac1${N}\big(${absTerms(bo.mse)}\big)=\tfrac1${N}\big(${plus(absAt(bo.mse))}\big)=${texNum(maeAtMean)}`,
            why: '把 $w$ 放在平均值時的絕對值成本：每筆離 $w$ 的距離 $|y_i-w|$ 加起來，再除以 $N$。',
          },
          {
            tex: String.raw`J_{\text{MAE}}\big(${texNum(bo.maeLow)}\big)=\tfrac1${N}\big(${absTerms(bo.maeLow)}\big)=\tfrac1${N}\big(${plus(absAt(bo.maeLow))}\big)=${texNum(maeAtMed)}`,
            why: '把 $w$ 放在中位數時的絕對值成本：一定不會比上一步大。',
          },
          {
            tex: String.raw`J_{\text{MSE}}\big(${texNum(bo.mse)}\big)=\tfrac1${N}\cdot\tfrac12\big(${squares(absAt(bo.mse))}\big)=\tfrac1${N}\cdot\tfrac12\big(${plus(sqAt(bo.mse))}\big)=${texNum(mseAtMean)}`,
            why: '換成平方成本，$w$ 放在平均值：把第 6 步算好的距離 $|y_i-w|$ 各自平方、加總，再乘 $\\tfrac12$ 與 $\\tfrac1N$。',
          },
          {
            tex: String.raw`J_{\text{MSE}}\big(${texNum(bo.maeLow)}\big)=\tfrac1${N}\cdot\tfrac12\big(${squares(absAt(bo.maeLow))}\big)=\tfrac1${N}\cdot\tfrac12\big(${plus(sqAt(bo.maeLow))}\big)=${texNum(mseAtMed)}`,
            why: '平方成本，$w$ 放在中位數（第 7 步的距離各自平方）：這次輪到平均值那一點比較小。「最佳」取決於你選的成本。',
          },
        ],
        results: [
          { symbol: String.raw`w^*_{\text{MSE}}`, label: '平均（MSE 最佳解）', value: bo.mse, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: 'y_{(2)}', label: '中位數區間下端', value: bo.maeLow, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: 'y_{(3)}', label: '中位數區間上端', value: bo.maeHigh, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`J_{\text{MAE}}'(${texNum(w)})`, label: 'MAE 成本在檢查點的斜率（無因次）', value: slope, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`J_{\text{MAE}}\big(w^*_{\text{MAE}}\big)`, label: '中位數處的 MAE 成本', value: maeAtMed, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
        ],
        notes: [
          slope === 0
            ? '斜率 $=0$：上下各兩筆，$w$ 落在中位數區間內（平坦的谷底）。'
            : slope > 0
              ? String.raw`斜率 $${texNum(slope)}>0$：下面的資料比上面多，MAE 成本往右上升——最小值在 $w$ 的左邊。Sign-Error 的平均更新量是 $-\mu$ 乘上這個斜率。`
              : String.raw`斜率 $${texNum(slope)}<0$：上面的資料比下面多，MAE 成本往右下降——最小值在 $w$ 的右邊。Sign-Error 的平均更新量是 $-\mu$ 乘上這個斜率。`,
          String.raw`平均 $${texNum(bo.mse)}$ 與中位數${unique ? ` $${texNum(bo.maeLow)}$` : `區間 $[${texNum(bo.maeLow)},\\ ${texNum(bo.maeHigh)}]$`} 的差距，就是 LMS（追平均）和 Sign-Error（追中位數）最後停的位置的差距。`,
        ],
      }
    },
    tips: [
      '只有加減、平方、除法、排序和數數。斜率那一步不需要知道 $|\\cdot|$ 怎麼微分——只要數上下各幾筆。這題 $x\\equiv1$（只估一個常數），所以 $w$ 的單位就是 $[y]$；$J_{\\text{MAE}}$ 是 $[y]$、$J_{\\text{MSE}}$ 是 $[y]^2$，兩者的數值不能直接比大小。',
      '範例數字是 §2.3 的 $\\{0,0,0,10\\}$：平均 $2.5$、中位數 $0$；在 $w=5$ 斜率 $=(3-1)/4=0.5$。對照 §2.3 的成本表：$J_{\\text{MAE}}(2.5)=3.75>J_{\\text{MAE}}(0)=2.5$，但 $J_{\\text{MSE}}(2.5)=9.375<J_{\\text{MSE}}(0)=12.5$。',
      '把第 4 筆改成 $100$、$1000$：平均跟著跑，中位數不動。再試 $\\{1,2,3,100\\}$（思考題 3）：中位數是整段 $[2,3]$。',
    ],
  },
  {
    id: 'HC-01.7',
    title: 'Gaussian 雜訊下 Sign-Error 的抖動：$K_q$、$\\mu/(2K_q)$ 與 1-bit 的代價',
    page: PAGE,
    formulaId: 'F-01.18',
    formulaTex: String.raw`K_q=2f(0)=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v},\qquad \operatorname{Var}(w_\infty)_{\text{SE}}\approx\frac{\mu}{2K_q},\qquad \operatorname{Var}(w_\infty)_{\text{LMS}}=\frac{\mu_L\sigma_v^2}{2-\mu_L}\ \ (\mu_L=\mu K_q)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      // x ≡ 1（無因次）：Sign-Error 的 μ 單位 [y]/[x]² 就是 [y]，也就是每步走的距離
      { key: 'mu', symbol: String.raw`\mu`, label: 'Sign-Error 的步長（每步走這麼多）', unit: U_Y, default: 0.05, min: -10, max: 1000, practice: { choices: [0.0125, 0.02, 0.05, 0.1] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'Gaussian 雜訊的標準差', unit: U_Y, default: 1, min: 0, max: 1e6, practice: { choices: [0.5, 1, 2, 4] } },
    ],
    validate: ({ mu, sigma }) => {
      if (sigma <= 0)
        return '$\\sigma_v=0$：沒有連續雜訊，誤差的分布沒有機率密度 $f$，F-01.18 不適用——這時 Sign-Error 每步在目標兩側來回跳，抖動是 $O(\\mu|x|)$，由格點鏈決定（§2.3.1）。請輸入 $\\sigma_v>0$。'
      if (mu <= 0) return '$\\mu\\le0$：不更新或更新極性錯誤，沒有穩態可算。請輸入 $\\mu>0$。'
      const j = signErrorJitterApprox(dcModel({ sigma }), mu)
      if (j.smallness > DIFFUSION_SMALLNESS_MAX)
        return String.raw`$\mu f(0)=${texNum(j.smallness, 3)}$ 不夠小：擴散近似要求每一步遠小於雜訊寬度（$\mu f(0)\ll1$，這裡取 $\le${DIFFUSION_SMALLNESS_MAX}$），才能把雜訊的 CDF 當成直線。請把 $\mu$ 降到 $${texNum(floorSig(DIFFUSION_SMALLNESS_MAX / j.density), 3)}$ 以下，或改用 MSE vs MAE Lab 的格點鏈精確值。`
      return null
    },
    solve: ({ mu, sigma }) => {
      const p = dcModel({ sigma })
      const jit = signErrorJitterApprox(p, mu) // F-01.18：Var ≈ μ/(4f)
      const f0 = jit.density
      const kq = 2 * f0
      const stdSe = Math.sqrt(jit.variance)
      const muL = mu * kq
      const lms = lmsSteadyState(p, muL) // 同樣收斂速度的 Conventional LMS（F-01.15）
      const ratio = jit.variance / lms.variance
      const lat = mu / sigma >= 1e-3 ? signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' }) : null
      return {
        steps: [
          { tex: String.raw`\sqrt{2\pi}\,\sigma_v=${texNum(SQRT_2PI)}\times${texNum(sigma)}=${texNum(SQRT_2PI * sigma)}`, why: '$\\sqrt{2\\pi}\\approx2.5066$（計算機：$2\\times\\pi$ 再開根號）。' },
          {
            tex: String.raw`f(0)=\frac{1}{\sqrt{2\pi}\,\sigma_v}=\frac{1}{${texNum(SQRT_2PI * sigma)}}=${texNum(f0)}`,
            why: 'Gaussian 鐘形曲線最高點的密度：雜訊越大，曲線越矮。',
          },
          { tex: String.raw`K_q=2f(0)=2\times${texNum(f0)}=${texNum(kq)}`, why: '等效 1-bit 增益：$\\operatorname{sign}(\\cdot)$ 的平均輸出對小偏移的斜率（$=\\sqrt{2/\\pi}/\\sigma_v\\approx0.798/\\sigma_v$）。' },
          {
            tex: String.raw`\operatorname{Var}(w_\infty)_{\text{SE}}\approx\frac{\mu}{2K_q}=\frac{${texNum(mu)}}{2\times${texNum(kq)}}=\frac{${texNum(mu)}}{${texNum(2 * kq)}}=${texNum(jit.variance)}`,
            why: '回授拉回的量與每步注入的 $\\mu^2$ 平衡（F-01.18）。先算分母 $2K_q$，再相除。',
          },
          { tex: String.raw`\operatorname{std}_{\text{SE}}=\sqrt{${texNum(jit.variance)}}=${texNum(stdSe)}`, why: '開根號。' },
          {
            tex: String.raw`\frac{\operatorname{std}_{\text{SE}}}{\mu}=\frac{${texNum(stdSe)}}{${texNum(mu)}}=${texNum(stdSe / mu)}`,
            why: '抖動是單步步長的幾倍？它 $\\propto1/\\sqrt\\mu$：$\\mu$ 越小倍數越大，所以抖動是 $O(\\sqrt\\mu)$，不是 $O(\\mu)$。',
          },
          { tex: String.raw`\mu_L=\mu K_q=${texNum(mu)}\times${texNum(kq)}=${texNum(muL)}`, why: '平均收斂得一樣快（pole 都是 $1-\\mu K_q$）的 Conventional LMS 步長。' },
          {
            tex: String.raw`\operatorname{Var}(w_\infty)_{\text{LMS}}=\frac{\mu_L\sigma_v^2}{2-\mu_L}=\frac{${texNum(muL)}\times${texNum(sigma)}^2}{2-${texNum(muL)}}=\frac{${texNum(muL * sigma * sigma)}}{${texNum(2 - muL)}}=${texNum(lms.variance)}`,
            why: '同速度 LMS 的穩態變異數（F-01.15，$x\\equiv1$、$\\operatorname{Var}(y)=\\sigma_v^2$）。先算分子、分母，再相除。',
          },
          {
            tex: String.raw`\frac{\operatorname{Var}_{\text{SE}}}{\operatorname{Var}_{\text{LMS}}}=\frac{${texNum(jit.variance)}}{${texNum(lms.variance)}}=${texNum(ratio)}`,
            why: '只用 1 bit 的代價：$\\mu\\to0$ 時趨近 $\\pi/2\\approx1.5708$；換成 dB 是 $10\\log_{10}1.5708\\approx1.96\\ \\mathrm{dB}$（計算機按 $[\\log]$ 再乘 10）。',
          },
        ],
        results: [
          { symbol: 'K_q', label: '等效 1-bit 增益', value: kq, unit: `1/${U_Y}` },
          { symbol: String.raw`\operatorname{Var}(w_\infty)_{\text{SE}}`, label: 'Sign-Error 穩態變異數（近似）', value: jit.variance, unit: `${U_Y}^2` },
          { symbol: String.raw`\operatorname{std}_{\text{SE}}`, label: 'Sign-Error 穩態標準差（近似）', value: stdSe, unit: U_Y },
          { symbol: String.raw`\operatorname{Var}(w_\infty)_{\text{LMS}}`, label: '同速度 LMS 的穩態變異數', value: lms.variance, unit: `${U_Y}^2` },
          { symbol: String.raw`\operatorname{Var}_{\text{SE}}/\operatorname{Var}_{\text{LMS}}`, label: '1-bit 的代價（倍數，無因次）', value: ratio },
        ],
        notes: [
          String.raw`有效性指標 $\mu f(0)=${texNum(jit.smallness, 3)}\ll1$：越小，擴散近似越準——近似的 std 比精確值小約 $\tfrac{\pi}{8}\,\mu f(0)\approx${texNum((100 * Math.PI * jit.smallness) / 8, 2)}\%$（下一階修正）。`,
          ...(lat && !lat.truncated
            ? [
                String.raw`對照格點鏈的精確解：$\operatorname{std}=${texNum(lat.std, 5)}$，近似值差 $${texNum(100 * (stdSe / lat.std - 1), 2)}\%$。`,
              ]
            : []),
        ],
      }
    },
    tips: [
      '需要 $\\pi$ 與開根號：$\\sqrt{2\\pi}\\approx2.5066$、$\\sqrt{2/\\pi}\\approx0.79788$。記成「$K_q\\approx0.8/\\sigma_v$」就能心算估計。',
      '範例數字是 §2.3.2 表格的中間那一列（$\\sigma_v=1$、$\\mu=0.05$）：近似 std $=0.1770$（格點鏈精確值 $0.1784$），同速度 LMS 的 std $=\\sqrt{0.020353}=0.1427$。',
      'PLL 的數字：$\\sigma_v=100\\ \\mathrm{fs}$ 時 $K_q=0.79788/100\\approx0.0079788\\ \\mathrm{fs}^{-1}$（T04、Ch05）。單位：$K_q$ 是 $1/[y]$，Sign-Error 的 $\\mu$ 是 $[y]/[x]^2$（這題 $x\\equiv1$ 無因次，所以就是 $[y]$）；$\\mu_L=\\mu K_q$ 無因次，正是 LMS 步長在 $x\\equiv1$ 時該有的單位。',
      '適用條件：雜訊是連續的（有密度），且 $\\mu f(0)\\ll1$。$\\sigma_v=0$ 或 $\\mu$ 太大時這題會告訴你為什麼不能算。',
    ],
  },
  {
    id: 'HC-01.8',
    title: '綜合：雜訊加上 outlier，LMS 與 Sign-Error 各偏多少、各抖多少？',
    page: PAGE,
    formulaTex: String.raw`\begin{gathered}E[w_\infty]_{\text{LMS}}=a+\varepsilon s,\qquad \operatorname{Var}(w_\infty)_{\text{LMS}}=\frac{\mu\,\big(\sigma_v^2+\varepsilon(1-\varepsilon)s^2\big)}{2-\mu}\\ \overline w_{\text{SE}}\approx a+\sigma_v\,\Phi^{-1}\!\Big(\frac{1}{2(1-\varepsilon)}\Big),\qquad \operatorname{Var}(w_\infty)_{\text{SE}}\approx\frac{\mu}{4f_{\tilde v}(t^*)}\end{gathered}`,
    level: 'research',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實值（只估一個常數）', unit: U_Y, default: 3, min: -1000, max: 1000, practice: { choices: [0, 1, 3] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'Gaussian 雜訊的標準差', unit: U_Y, default: 1, min: 0, max: 1e6, practice: { choices: [0.5, 1, 2] } },
      { key: 'eps', symbol: String.raw`\varepsilon`, label: 'outlier 出現的機率', default: 0.1, min: 0, max: 1, practice: { choices: [0.05, 0.1, 0.2] } },
      { key: 's', symbol: 's', label: 'outlier 的大小（單邊 +s）', unit: U_Y, default: 20, min: 0, max: 1e6, practice: { choices: [10, 20, 40] } },
      // μ 不標單位：同一個數值在 LMS（無因次）與 Sign-Error（[y]）單位不同，見註記
      { key: 'mu', symbol: String.raw`\mu`, label: '兩種演算法共用的步長數值', default: 0.05, min: -10, max: 10, practice: { choices: [0.01, 0.02, 0.05] } },
    ],
    validate: ({ sigma, eps, s, mu }) => {
      if (sigma <= 0)
        return '$\\sigma_v=0$：沒有連續雜訊，資料只剩兩個點質量（$a$ 與 $a+s$），中位數那一格沒有機率密度——F-01.17、F-01.18 都不適用，要改用格點鏈（§2.3.1）。請輸入 $\\sigma_v>0$。'
      if (eps >= 0.5)
        return String.raw`$\varepsilon=${texNum(eps)}\ge0.5$：outlier 已佔一半以上，$\frac{1}{2(1-\varepsilon)}\ge1$，$\Phi^{-1}$ 沒有定義——中位數也被拉到 outlier 那一群去了（中位數的 breakdown point 是 50%）。請選 $\varepsilon<0.5$。`
      if (eps > 0) {
        const mApprox = contaminatedMedianApprox(sigma, eps) // F-01.17 右式：σ_v·Φ⁻¹(1/(2(1 − ε)))
        if (s - mApprox < OUTLIER_MIN_SIGMAS * sigma)
          return String.raw`outlier 那一群（中心在 $a+s$）只比中位數高 $s-m\approx${texNum(s)}-${texNum(mApprox, 4)}=${texNum(s - mApprox, 4)}$，不到 $${OUTLIER_MIN_SIGMAS}\sigma_v=${texNum(OUTLIER_MIN_SIGMAS * sigma)}$：它與雜訊主體重疊，「outlier 全部在中位數上方」這個近似（F-01.17 的右式，$s\gg\sigma_v$）不成立，中位數要用數值求根解左式。請讓 $s\ge${texNum(ceil2(mApprox + OUTLIER_MIN_SIGMAS * sigma))}$，或降低 $\varepsilon$。`
      }
      if (mu <= 0 || mu >= 2)
        return '$x\\equiv1$ 時 Conventional LMS 需要 $0<\\mu<2$ 才有穩態（pole $1-\\mu$，F-01.15）。請調整 $\\mu$。'
      const model = dcModel({ sigma, outlierProb: eps, outlierSize: s })
      const j = signErrorJitterApprox(model, mu)
      if (j.smallness > DIFFUSION_SMALLNESS_MAX)
        return String.raw`$\mu f_{\tilde v}(t^*)=${texNum(j.smallness, 3)}$ 不夠小：Sign-Error 的擴散近似（F-01.18）要求每一步遠小於雜訊寬度（這裡取 $\le${DIFFUSION_SMALLNESS_MAX}$）。請把 $\mu$ 降到 $${texNum(floorSig(DIFFUSION_SMALLNESS_MAX / j.density), 3)}$ 以下。`
      const kappa = signErrorDiffusionKappa(model, mu) // 前面已確認 outlier 群離中位數 ≥ 8σ，這裡一定是有限值
      if (!(kappa <= DIFFUSION_KAPPA_MAX)) {
        const z = j.tStar / sigma
        return String.raw`擴散近似（F-01.18）在這組數字不夠準：它把雜訊的 CDF 在中位數附近當成直線，所以抖動的寬度 $\operatorname{std}_{\text{SE}}\approx${texNum(Math.sqrt(j.variance), 3)}$ 必須遠小於雜訊寬度 $\sigma_v=${texNum(sigma)}$；中位數離主體中心越遠（這裡 $z=${texNum(z, 3)}$，密度變化得快）要求越嚴。指標 $\kappa=(1+z^2)\operatorname{Var}_{\text{SE}}/\sigma_v^2=${texNum(kappa, 3)}>${DIFFUSION_KAPPA_MAX}$，近似的 std 會比格點鏈精確值小約 $\kappa/4\approx${texNum(25 * kappa, 2)}\%$ 以上。請把 $\mu$ 降到 $${texNum(floorSig((mu * DIFFUSION_KAPPA_MAX) / kappa), 3)}$ 以下，或降低 $\varepsilon$。`
      }
      return null
    },
    solve: ({ a, sigma, eps, s, mu }) => {
      const p = dcModel({ a, sigma, outlierProb: eps, outlierSize: s })
      const pop = populationOptima(p, 1) // 母體最佳解：平均（L2）與中位數（L1）
      const ss = lmsSteadyState(p, mu) // LMS 穩態（F-01.15）
      const jit = signErrorJitterApprox(p, mu) // Sign-Error 擴散近似（F-01.18）
      const mom = mixtureRawMoments(noiseMixture(p))
      const meanV = snap(mom.m1)
      const varV = mom.m2 - mom.m1 * mom.m1
      const varO = snap(varV - sigma * sigma, varV) // outlier 開關的變異數 ε(1 − ε)s²（步驟顯示用）
      const stdLms = Math.sqrt(ss.variance)
      const q = 1 / (2 * (1 - eps))
      const z = snap(contaminatedMedianApprox(1, eps)) // Φ⁻¹(q)：F-01.17 的右式（σ = 1）
      const m = snap(pop.l1.lo - a, sigma) // 精確中位數的偏移（左式，數值求根）
      const t = (q - 0.5) * SQRT_2PI
      const zSeries = t + t ** 3 / 6
      const seriesErr = z === 0 ? 0 : Math.abs(zSeries / z - 1)
      const phi = normPdf(z)
      const stdSe = Math.sqrt(jit.variance)
      const kappa = signErrorDiffusionKappa(p, mu) // 擴散近似的二階指標：std 的相對誤差 ≈ −κ/4
      const lat = mu / sigma >= 1e-3 ? signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' }) : null
      return {
        steps: [
          { tex: String.raw`E[\tilde v]=\varepsilon s=${texNum(eps)}\times${texNum(s)}=${texNum(meanV)}`, why: '總雜訊 $\\tilde v=v+o$ 的平均：Gaussian 雜訊平均為 0，outlier 以機率 $\\varepsilon$ 貢獻 $s$。' },
          {
            tex: String.raw`E[w_\infty]_{\text{LMS}}=a+\varepsilon s=${texNum(a)}+${texNum(meanV)}=${texNum(ss.mean)}`,
            why: 'LMS 追的是平均（MSE 最佳解）：outlier 多大，它就按比例被拉走多遠。',
          },
          {
            tex: String.raw`\varepsilon(1-\varepsilon)s^2=${texNum(eps)}\times(1-${texNum(eps)})\times${texNum(s)}^2=${texNum(eps)}\times${texNum(1 - eps)}\times${texNum(s * s)}=${texNum(varO)}`,
            why: '「有／沒有 outlier」這個開關的變異數：機率 $\\varepsilon$ 取 $s$、機率 $1-\\varepsilon$ 取 $0$，所以 $E[o^2]-E[o]^2=\\varepsilon s^2-\\varepsilon^2s^2$。',
          },
          {
            tex: String.raw`\operatorname{Var}(\tilde v)=\sigma_v^2+\varepsilon(1-\varepsilon)s^2=${texNum(sigma)}^2+${texNum(varO)}=${texNum(sigma * sigma)}+${texNum(varO)}=${texNum(varV)}`,
            why: '兩個獨立來源的變異數直接相加：Gaussian 的 $\\sigma_v^2$，加上前一步算出的 outlier 開關變異數。',
          },
          {
            tex: String.raw`\operatorname{Var}(w_\infty)_{\text{LMS}}=\frac{\mu\operatorname{Var}(\tilde v)}{2-\mu}=\frac{${texNum(mu)}\times${texNum(varV)}}{2-${texNum(mu)}}=\frac{${texNum(mu * varV)}}{${texNum(2 - mu)}}=${texNum(ss.variance)}`,
            why: 'LMS 的穩態變異數（F-01.15）：outlier 也算進去，所以抖得很大。先算分子、分母，再相除。',
          },
          { tex: String.raw`\operatorname{std}_{\text{LMS}}=\sqrt{${texNum(ss.variance)}}=${texNum(stdLms)}`, why: '開根號。' },
          {
            tex: String.raw`q=\frac{1}{2(1-\varepsilon)}=\frac{1}{2\times${texNum(1 - eps)}}=\frac{1}{${texNum(2 * (1 - eps))}}=${texNum(q)}`,
            why: '中位數的條件是「一半機率在下面」。outlier（機率 $\\varepsilon$）全在很上面，所以主體（機率 $1-\\varepsilon$）必須有 $q$ 的比例在中位數下面：$(1-\\varepsilon)\\,q=\\tfrac12$。',
          },
          {
            tex: String.raw`z=\Phi^{-1}(q)=\Phi^{-1}(${texNum(q)})=${texNum(z)}`,
            why:
              z === 0
                ? '$\\Phi(z)$ 是標準常態分布「不超過 $z$」的機率；$q=\\tfrac12$ 對應 $z=0$（沒有 outlier，中位數不偏）。'
                : String.raw`$\Phi(z)$ 是標準常態分布「不超過 $z$」的機率；查常態表（或計算機的 invNorm）找出 $\Phi(z)=q$ 的 $z$。沒有表時：$t=(q-\tfrac12)\sqrt{2\pi}=${texNum(t)}$，$z\approx t+\tfrac{t^3}{6}=${texNum(zSeries)}$（與查表值差 $${texNum(100 * seriesErr, 2)}\%$${seriesErr > 0.01 ? '——$\\varepsilon$ 太大，請查表' : ''}）。`,
          },
          {
            tex: String.raw`m=\sigma_v\,z=${texNum(sigma)}\times${texNum(z)}=${texNum(m)}`,
            why: '把標準化的 $z$ 換回雜訊的單位：中位數離真值的偏移（F-01.17）。它只有 $\\sigma_v$ 的一小部分，而且和 outlier 的大小 $s$ 無關。',
          },
          {
            tex: String.raw`\overline w_{\text{SE}}\approx a+m=${texNum(a)}+${texNumP(m)}=${texNum(pop.l1.lo)}`,
            why: 'Sign-Error 追的是中位數（MAE 最佳解）；固定步長下的時間平均還會再偏 $O(\\mu)$，依 $\\operatorname{sign}(0)$ 慣例與算術而定（勘誤 E40）。',
          },
          {
            tex: String.raw`\varphi(z)=\frac{e^{-z^2/2}}{\sqrt{2\pi}}=\frac{e^{-${texNum(z)}^2/2}}{${texNum(SQRT_2PI)}}=\frac{e^{-${texNum((z * z) / 2)}}}{${texNum(SQRT_2PI)}}=\frac{${texNum(Math.exp((-z * z) / 2))}}{${texNum(SQRT_2PI)}}=${texNum(phi)}`,
            why: '標準常態密度在 $z$ 的值，一次做一件事：先算 $z^2/2$，變號後按 $[e^x]$，再除以 $\\sqrt{2\\pi}\\approx2.5066$。',
          },
          {
            tex: String.raw`f_{\tilde v}(t^*)=\frac{(1-\varepsilon)\,\varphi(z)}{\sigma_v}=\frac{${texNum(1 - eps)}\times${texNum(phi)}}{${texNum(sigma)}}=\frac{${texNum((1 - eps) * phi)}}{${texNum(sigma)}}=${texNum(jit.density)}`,
            why: '總雜訊在中位數 $t^*=m$ 的密度：只有主體那一群有貢獻（outlier 那一群離得太遠），再換回 $\\tilde v$ 的單位（除以 $\\sigma_v$）。',
          },
          {
            tex: String.raw`\operatorname{Var}(w_\infty)_{\text{SE}}\approx\frac{\mu}{4f_{\tilde v}(t^*)}=\frac{${texNum(mu)}}{4\times${texNum(jit.density)}}=\frac{${texNum(mu)}}{${texNum(4 * jit.density)}}=${texNum(jit.variance)}`,
            why: 'Sign-Error 的擴散近似（F-01.18）：只和中位數附近的密度有關，outlier 的大小完全不出現。',
          },
          { tex: String.raw`\operatorname{std}_{\text{SE}}=\sqrt{${texNum(jit.variance)}}=${texNum(stdSe)}`, why: '開根號。' },
        ],
        results: [
          { symbol: String.raw`E[w_\infty]_{\text{LMS}}`, label: 'LMS 的穩態平均', value: ss.mean, unit: U_Y, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: String.raw`\operatorname{std}_{\text{LMS}}`, label: 'LMS 的穩態標準差', value: stdLms, unit: U_Y },
          { symbol: 'm', label: 'Sign-Error 目標（中位數）離真值多遠', value: m, unit: U_Y, tolerance: { rel: 0.02, abs: 1e-6 } },
          { symbol: String.raw`\operatorname{std}_{\text{SE}}`, label: 'Sign-Error 的穩態標準差（近似）', value: stdSe, unit: U_Y, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes: [
          eps === 0 || s === 0
            ? '沒有 outlier：平均與中位數都是 $a$，兩種演算法都不偏；差別只剩抖動。'
            : String.raw`偏移：LMS $${texNum(meanV)}$ vs Sign-Error $${texNum(m)}$（小 $${texNum(meanV / m, 3)}$ 倍）；抖動：LMS $${texNum(stdLms, 4)}$ vs Sign-Error $${texNum(stdSe, 4)}$。把 $s$ 加倍，LMS 的兩個數字都跟著變大，Sign-Error 的完全不變。`,
          String.raw`有效性指標：$\mu f_{\tilde v}(t^*)=${texNum(jit.smallness, 3)}\ll1$，且 $\kappa=(1+z^2)\operatorname{Var}_{\text{SE}}/\sigma_v^2=${texNum(kappa, 3)}$（抖動寬度相對於雜訊寬度；近似的 std 約偏小 $\kappa/4\approx${texNum(25 * kappa, 2)}\%$）。${
            lat && !lat.truncated ? String.raw`格點鏈的精確解：時間平均 $${texNum(lat.mean, 5)}$、$\operatorname{std}=${texNum(lat.std, 5)}$（近似差 $${texNum(100 * (stdSe / lat.std - 1), 2)}\%$）。` : ''
          }`,
          '注意單位：同一個數值的 $\\mu$，在 LMS 是 $1/[x]^2$、在 Sign-Error 是 $[y]/[x]^2$（$\\operatorname{sign}(e)$ 無因次）；這題 $x\\equiv1$ 無因次，所以分別是「無因次」與 $[y]$——只是把同一個數字填進兩個演算法，$\\mu$ 因此不標單位。',
        ],
      }
    },
    tips: [
      '$\\Phi^{-1}$ 怎麼算：(1) 查標準常態表，找表內最接近 $q$ 的機率，讀出列＋欄的 $z$；(2) 工程計算機的統計模式 invNorm / $\\Phi^{-1}$；(3) 手算近似：$t=(q-\\tfrac12)\\sqrt{2\\pi}$，$z\\approx t+t^3/6$——$\\varepsilon\\le0.3$ 時誤差 $<1\\%$；只取 $z\\approx t$ 的話要 $\\varepsilon\\le0.15$ 才有 $1\\%$。',
      '$e^{-z^2/2}$：先算 $z^2/2$、變號，再按 $[e^x]$。$z$ 很小時 $e^{-u}\\approx1-u$ 就夠準（$u\\le0.05$ 時誤差 $<0.13\\%$）。',
      '範例數字是 §2.4 與 preset「DC 估計 + 10% outlier」（$a=3,\\ \\sigma_v=1,\\ \\varepsilon=0.1,\\ s=20,\\ \\mu=0.05$）：LMS 被拉到 $5$、std $0.974$；Sign-Error 的目標是 $3.1397$、std $\\approx0.1875$（格點鏈精確值 $0.1892$）。算完後到 §2.5 的 MSE vs MAE Lab 載入這個 preset，對照指標表。',
      '適用條件：$\\sigma_v>0$、$\\varepsilon<0.5$、outlier 那一群至少比中位數高 $8\\sigma_v$（$s-m\\ge8\\sigma_v$）、$0<\\mu<2$、$\\mu f_{\\tilde v}(t^*)\\le0.1$，以及 $\\kappa=(1+z^2)\\operatorname{Var}_{\\text{SE}}/\\sigma_v^2\\le0.2$（抖動寬度要遠小於雜訊寬度；$\\varepsilon$ 越接近 $0.5$ 越嚴）。不符合時這題會說明是哪一個假設破了。',
    ],
  },
]

/** 依 id 取出本章的手算題（章節內 <ChapterHandCalc id="HC-01.x" /> 使用） */
export function handcalcOf(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到手算題 ${id}`)
  return def
}
