import { texNum } from '@/components'
import type { HandCalcDef, HandCalcInput, HandCalcStep } from '@/data/types'
import {
  comparatorKq,
  corr2,
  eig2x2,
  eigenModes,
  gaugeNullVector,
  gaugeRegressorsRaw,
  lmsHandSteps,
  meanSquareDiagGaussian,
  meanSquareMap,
  meanSquareRadius,
  meanTrajectory,
  modalCoords,
  optimalScalarGain,
  pm1DegenerateProb,
  sampleCorrelation,
  sampleEigRelStd,
  slidingWindowPe,
  stepsToDecay,
  stepsToDecayReal,
} from '@/simulation/models/pe'
import { rdF, rdP, sigNear1, sigSub, snap, tx, txCeilArg, txF, txInt, txP, txVec } from './handcalcTex'

/**
 * Ch09 的「帶入手算」題（docs/teaching-style.md §7；範本：src/chapters/ch00/handcalcs.ts）。
 *  - solve() 的數值都來自 src/simulation/models/pe.ts 的實際函式（lmsHandSteps、eig2x2、eigenModes、meanTrajectory、
 *    meanSquareDiagGaussian、slidingWindowPe、gaugeRegressorsRaw…），handcalcs.test.tsx 另以獨立公式逐一比對；
 *  - 極性一律 δ = a − w；平均遞迴一律明寫 g = μK_q（勘誤 E05 / E08）；598 這類數字是 mean 的敘述（勘誤 E23）；
 *  - inputs 的 default 就是本章 worked example 的數字（T10 / T11 與文中表格）；
 *  - 每一步的 tex 都是「符號式 = 代入數字 =（中間結果 =）結果」：每個等號只做一種運算（一次加減、一次乘除、一次平方、
 *    一次開根號、一次 ln、一次 y^x），而且畫面上的數字自己就算得出下一個等號——handcalcs.test.tsx 會把每一步的 TeX
 *    重新求值檢查（預設值、20 組隨機數字、使用者自己打的數字）；
 *  - 顯示用 handcalcTex.ts：輸入值與「寫得完」的小數不四捨五入（tx）、剛好抵銷的地方顯示 0 而不是 double 的 1e-17 殘渣
 *    （snap）、相近的數相減時運算元多顯示幾位（sigSub）、很接近 1 的 pole 顯示到 ln 算得準為止（sigNear1），
 *    讓「照畫面上的數字用計算機算」取上整後得到同一個 k₉₅（例如 75,091 不會變成 75,090）。
 *
 * 題目在章內的位置：HC-09.1 → 開場「再算一次」的表之後；HC-09.2 → §9「δ₀ = (1,0) 走四步」的表之後；
 * HC-09.3 → 「為什麼是 598 個 blocks」（F-09.6）之後；HC-09.4 → 最佳 scalar gain（F-09.7）之後；
 * HC-09.5 → mean-square（F-09.8／F-09.18）之後；HC-09.6 → §9.1 singular value（F-09.10）之後；
 * HC-09.7 → §9.2 gauge（F-09.13）之後；HC-09.8（綜合）→ 章末「思考題」之前。
 */

const PAGE = '/ch/09'

/** 本章手算窗口的長度（§9.1「先算一次」的 N₀ = 4） */
export const HAND_WINDOW_N0 = 4
/** §9.1「先算一次」的窗口 B：(1,1), (1,−1), (−1,−1), (1,1) */
const HAND_WINDOW_DEFAULT: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [1, 1],
]

/**
 * 共模／差模基底 Q = [v₁ v₂]，v₁ = (1,1)/√2、v₂ = (1,−1)/√2（由 eig2x2 算出）。
 * 任何 ρ > 0 的 [[1,ρ],[ρ,1]] 都是這一組 eigenvectors；ρ = 0 時 R = I，任何正交基都是 eigenvectors，沿用這一組。
 */
const Q_CM_DM = eig2x2(1, 0.5, 1).vectors

const LN20 = Math.log(20)
/** √2 與 ln 0.05 的顯示（6／7 位：比答案的 5 位多留，除完、取上整後才對得起來） */
const SQRT2_TEX = texNum(Math.SQRT2, 6)
const LN005_TEX = texNum(Math.log(0.05), 7)

/**
 * p_i = 1 − gλ_i（與 pe.ts 的 eigenModes 同一個式子）。λ 取閉式 eig2x2 的結果，
 * 避免 Jacobi 迭代的 1e-16 捨入出現在手算步驟裡；1 − gλ 剛好抵銷時（例如 ρ = 1、g = 0.5 的 p₁）回傳精確的 0。
 * handcalcs.test.tsx 會把它和 eigenModes().poles 逐一比對。
 */
function polesOf(lambdas: readonly number[], g: number): number[] {
  return lambdas.map((l) => snap(1 - g * l, 1, g * l))
}

/** 把一串項寫成「代入後的加總」：1^2+(-1)^2+… */
function sumTex(terms: string[]): string {
  return terms.join('+')
}

/**
 * 1-bit（Sign-LMS）均方遞迴（F-09.18）在第 i 個 eigen 方向上的每步倍數 v_iᵀ·𝓜(v_i v_iᵀ)·v_i，
 * 𝓜 是網站實際使用的 meanSquareMap(detector = 'sign')。手算式：(1 − gλ_i)² − (gλ_i)²/N。
 */
export function signModeFactor(rho: number, g: number, N: number, i: 0 | 1): number {
  const v = [Q_CM_DM[0][i], Q_CM_DM[1][i]]
  const P = [
    [v[0] * v[0], v[0] * v[1]],
    [v[1] * v[0], v[1] * v[1]],
  ]
  const out = meanSquareMap('gaussian', rho, g, N, P, undefined, 'sign')
  return v[0] * (out[0][0] * v[0] + out[0][1] * v[1]) + v[1] * (out[1][0] * v[0] + out[1][1] * v[1])
}

/**
 * k₉₅ 的共用步驟：ln|p| → ln 比值 → 取上整 →（x = gλ_min < 0.5 時）泰勒近似；p = 0 時一步歸零。
 * |p| 顯示到「1 − |p| 還有 7 位」為止，所以照畫面上的數字按 ln，會得到畫面上的那個 ln（7 位）。
 */
function k95Steps(pSlow: number, x: number): HandCalcStep[] {
  if (pSlow === 0) {
    return [
      {
        tex: String.raw`p_{\text{slow}}=0\ \Rightarrow\ k_{95}=1`,
        why: '$p=0$：一步就把這個模式完全消掉（$\\ln 0$ 沒有定義，不必按計算機）。',
      },
    ]
  }
  const ap = Math.abs(pSlow)
  const lnP = Math.log(ap)
  const real = stepsToDecayReal(pSlow)
  const k95 = stepsToDecay(pSlow)
  const realTex = txCeilArg(real, k95)
  const nearOne = pSlow > 0 && x < 1e-3
  const steps: HandCalcStep[] = [
    {
      tex: String.raw`\ln|p_{\text{slow}}|=\ln ${tx(ap, sigNear1(ap))}=${texNum(lnP, 7)}`,
      why:
        '按計算機的 $\\ln$ 鍵（自然對數，不是 $\\log_{10}$）。$|p|<1$，所以結果是負的；$p$ 很接近 1 時這個數很小，請保留 6 位以上有效數字（少一位，下一步的商就可能差到 1 個 block）。' +
        (nearOne
          ? String.raw`計算機的位數不夠輸入這麼長的 $p$ 時，改用 $\ln(1-x)\approx-x-\tfrac{x^2}{2}=-${tx(x, 7)}-${texNum((x * x) / 2, 3)}=${texNum(-(x + (x * x) / 2), 7)}$（$x=g\lambda_{\min}\ll1$，誤差約 $x^3/3$）。`
          : ''),
    },
    {
      tex: String.raw`\frac{\ln 0.05}{\ln|p_{\text{slow}}|}=\frac{${LN005_TEX}}{${texNum(lnP, 7)}}=${realTex}`,
      why: '再按一次 $\\ln$：$\\ln0.05=-\\ln20\\approx-2.995732$，然後相除。分子分母都是負的，商是正的。',
    },
    {
      tex: String.raw`k_{95}=\left\lceil ${realTex}\right\rceil=${txInt(k95)}`,
      why: 'block 數必須是整數：無條件進位（ceil）。',
    },
  ]
  if (x > 0 && x < 0.5) {
    const first = LN20 / x
    const second = String.raw`再減掉 $\tfrac12\ln20\approx1.498$（二階修正）得 $${texNum(first - LN20 / 2, 7)}$，和上面的 $${realTex}$ 只差約 $0.25x$ 個 block。`
    steps.push({
      tex: String.raw`k_{95}\approx\frac{\ln 20}{g\lambda_{\min}}=\frac{${texNum(LN20, 7)}}{${tx(x, 7)}}=${texNum(first, 6)}`,
      why:
        x > 0.1
          ? String.raw`泰勒一階 $\ln(1-x)\approx-x$ 只在 $x=g\lambda_{\min}\ll1$ 時準；這裡 $x=${tx(x, 3)}$ 不夠小（相對誤差約 $x/2$），請以上一步的精確值為準。${second}`
          : String.raw`不想按 $\ln p$？泰勒一階 $\ln(1-x)\approx-x$（$x=g\lambda_{\min}\ll1$ 時成立，相對誤差約 $x/2$）。${second}`,
    })
  }
  return steps
}

const RHO_INPUT: HandCalcInput = {
  key: 'rho',
  symbol: String.raw`\rho`,
  label: '兩個 regressor 的相關係數（$0\\le\\rho<1$）',
  default: 0.99,
  min: 0,
  max: 1,
  practice: { choices: [0.5, 0.8, 0.9, 0.95, 0.99] },
}

const RHO_ONE_MESSAGE =
  '$\\rho=1$：$\\lambda_{\\min}=1-\\rho=0$，$\\mathbf R$ 奇異、$\\kappa=\\infty$；差模的 pole $=1$，永遠不衰減（$k_{95}=\\infty$）。這不是算不出來，而是資料裡根本沒有差模的資訊（不可辨識）。請取 $0\\le\\rho<1$。'

function gainMessage(g: number, lmax: number): string | null {
  if (!(g > 0)) return '$g=\\mu K_q$ 必須大於 0（$g=0$ 時係數完全不更新）。'
  if (g * lmax >= 2)
    return String.raw`$g\lambda_{\max}=${texNum(g * lmax)}\ge2$：快模式的 pole $p=1-g\lambda_{\max}\le-1$，平均遞迴發散，其餘數字沒有意義。請取 $0<g<2/\lambda_{\max}=${texNum(2 / lmax)}$。`
  return null
}

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────── HC-09.1：兩個旋鈕的 LMS 兩步 ─────────────────────────
  {
    id: 'HC-09.1',
    title: '兩個旋鈕的 LMS 手算兩步：誤差歸零不代表參數學對',
    page: PAGE,
    formulaId: 'F-09.1',
    formulaTex: String.raw`\begin{gathered}e_k=\mathbf u_k^T(\mathbf a-\mathbf w_k)=u_{1,k}(a_1-w_{1,k})+u_{2,k}(a_2-w_{2,k}),\qquad \mathbf w_{k+1}=\mathbf w_k+\mu\,e_k\,\mathbf u_k\\ \big(\mathbf w_0=(0,0),\ \mathbf u_0=(1,1),\ \mathbf u_1=(1,s)\big)\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a1', symbol: 'a_1', label: '第 1 個真實參數', default: 3, min: -20, max: 20, practice: { choices: [2, 3, 4, 5] } },
      { key: 'a2', symbol: 'a_2', label: '第 2 個真實參數', default: 1, min: -20, max: 20, practice: { choices: [-1, 0, 1, 2] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.25, min: 0, max: 5, practice: { choices: [0.1, 0.2, 0.25, 0.5] } },
      {
        key: 's',
        symbol: 's',
        label: '$\\mathbf u_1=(1,s)$ 的 $s$（$1$ 同向、$-1$ 反向）',
        default: 1,
        min: -3,
        max: 3,
        practice: { choices: [-1, 1] },
      },
    ],
    validate: ({ mu, s }) => {
      if (!(mu > 0)) return '$\\mu$ 必須大於 0（$\\mu=0$ 時係數完全不動）。'
      const power = Math.max(2, 1 + s * s)
      if (mu * power >= 2)
        return String.raw`$\mu\|\mathbf u\|^2=${texNum(mu * power)}\ge2$：誤差每一步乘上 $1-\mu\|\mathbf u\|^2\le-1$，每一步都修正過頭而且越跳越遠（第 0–2 章的 $\mu_{\max}=2/\|\mathbf u\|^2$）。請減小 $\mu$。`
      return null
    },
    solve: ({ a1, a2, mu, s }) => {
      const [r0, r1] = lmsHandSteps({
        a: [a1, a2],
        w0: [0, 0],
        mu,
        us: [
          [1, 1],
          [1, s],
        ],
      })
      const t = (x: number) => tx(x, 7)
      const tP = (x: number) => txP(x, 7)
      const tF = (x: number) => txF(x, 7)
      const vec = (v: ArrayLike<number>) => txVec(v, 7)
      // 畫面上的數字：模型（lmsHandSteps）的值；剛好抵銷的地方（例如 e₁ = 0）去掉 double 的 1e-17 殘渣
      const e0 = snap(r0.e, a1, a2)
      const dw0 = e0 === 0 ? [0, 0] : r0.dw
      const w1 = e0 === 0 ? [0, 0] : r0.wNext
      const d11 = snap(a1 - w1[0], a1, w1[0])
      const d12 = snap(a2 - w1[1], a2, w1[1])
      const sd12 = s * d12
      const e1 = snap(r1.e, d11, sd12)
      const dw1 = e1 === 0 ? [0, 0] : r1.dw
      const w2 = e1 === 0 ? w1 : r1.wNext
      const da = snap(a1 - w2[0], a1, w2[0])
      const db = snap(a2 - w2[1], a2, w2[1])
      const diff0 = a1 - a2
      const diff2 = snap(da - db, da, db)
      return {
        steps: [
          {
            tex: String.raw`e_0=\mathbf u_0^T(\mathbf a-\mathbf w_0)=1\times(${t(a1)}-0)+1\times(${t(a2)}-0)=${tP(a1)}+${tP(a2)}=${t(e0)}`,
            why: '①誤差：每個參數誤差乘上自己的 regressor 再相加（$\\mathbf u_0=(1,1)$、$\\mathbf w_0=(0,0)$）。先算括號裡的減法，再相加。',
          },
          {
            tex: String.raw`\Delta\mathbf w_0=\mu\,e_0\,\mathbf u_0=${tF(mu)}\times${tF(e0)}\times(1,\ 1)=${tF(dw0[0])}\times(1,\ 1)=${vec(dw0)}`,
            why: '②修正量：先乘出 $\\mu e_0$，再分別乘上兩個 regressor 分量。',
          },
          {
            tex: String.raw`\mathbf w_1=\mathbf w_0+\Delta\mathbf w_0=(0,\ 0)+${vec(dw0)}=${vec(w1)}`,
            why: '③更新：兩個分量各自相加。',
          },
          {
            tex: String.raw`e_1=\mathbf u_1^T(\mathbf a-\mathbf w_1)=1\times(${t(a1)}-${tP(w1[0])})+${tF(s)}\times(${t(a2)}-${tP(w1[1])})=1\times${tF(d11)}+${tF(s)}\times${tF(d12)}=${tP(d11)}+${tP(sd12)}=${t(e1)}`,
            why: '第 2 筆資料 $\\mathbf u_1=(1,s)$：用更新後的 $\\mathbf w_1$ 再算一次誤差（先算括號裡的減法，再各自乘上 regressor，最後相加）。',
          },
          {
            tex: String.raw`\Delta\mathbf w_1=\mu\,e_1\,\mathbf u_1=${tF(mu)}\times${tF(e1)}\times(1,\ ${t(s)})=${tF(dw1[0])}\times(1,\ ${t(s)})=${vec(dw1)}`,
            why: '第二個分量乘的是 $s$：$s<0$ 時兩個係數被推往相反方向。',
          },
          {
            tex: String.raw`\mathbf w_2=\mathbf w_1+\Delta\mathbf w_1=${vec(w1)}+${vec(dw1)}=${vec(w2)}`,
            why: '兩步之後的係數。',
          },
          {
            tex: String.raw`\delta_{1,2}-\delta_{2,2}=(a_1-w_{1,2})-(a_2-w_{2,2})=(${t(a1)}-${tP(w2[0])})-(${t(a2)}-${tP(w2[1])})=${t(da)}-${tP(db)}=${t(diff2)}`,
            why: String.raw`檢查「差」這個方向（$\boldsymbol\delta=\mathbf a-\mathbf w$）：初值是 $a_1-a_2=${t(diff0)}$。只有 $u_1\ne u_2$ 的資料才動得了它。`,
          },
        ],
        results: [
          { symbol: 'w_{1,2}', label: '兩步之後的第 1 個係數（$\\mathbf w_2$ 的第一個分量）', value: w2[0] },
          { symbol: 'w_{2,2}', label: '兩步之後的第 2 個係數', value: w2[1] },
          { symbol: String.raw`\delta_{1,2}-\delta_{2,2}`, label: '兩步之後的「差」$(a_1-w_1)-(a_2-w_2)$', value: diff2 },
        ],
        notes:
          s === 1
            ? [
                String.raw`兩筆資料都是 $(1,1)$：每次修正都把 $w_1$、$w_2$ 推一樣多，「差」永遠等於初值 $a_1-a_2=${t(diff0)}$。繼續做下去 $e\to0$，但係數停在 $w_1=w_2=(a_1+a_2)/2=${t((a1 + a2) / 2)}$——只要 $a_1\ne a_2$，兩個參數都是錯的。`,
                String.raw`驗算：$\mathbf u$ 不變時誤差每步乘上 $1-\mu\|\mathbf u\|^2=1-2\mu=${t(snap(1 - 2 * mu, 1))}$，所以 $e_1$ 應等於 $${tF(snap(1 - 2 * mu, 1))}\times e_0=${t(e1)}$。`,
              ]
            : e1 === 0
              ? [
                  '$e_1=0$：更新後的 $\\mathbf w_1$ 對第 2 筆資料剛好沒有誤差，所以這一步係數完全不動（「差」也沒變）。這只是這組數字的巧合——換一個 $\\mu$ 或 $\\mathbf a$ 再算一次。',
                ]
              : [
                  String.raw`第 2 筆資料的兩個分量不同（$s=${t(s)}$），「差」被改變了 $-\mu e_1(1-s)=${t(snap(diff2 - diff0, diff2, diff0))}$：這筆資料照到了差模方向，兩個參數才分得開。`,
                  '把 $s$ 改回 1 再算一次：「差」會一動也不動。',
                ],
      }
    },
    tips: [
      '$\\mathbf u^T(\\mathbf a-\\mathbf w)$ 就是「對應相乘再相加」（內積），每一步只有乘法與加減法；每個等號只做一種運算，照著畫面上的數字按就能得到下一個等號。',
      '單位：這一題的數字是無因次的教學例。套到硬體時（本章符號表）$\\mathbf u$ 是無因次的 code，$\\mathbf a$、$\\mathbf w$、$e$ 的單位相同（例如 $\\mathrm{fs}$），conventional LMS 的 $\\mu$ 無因次。',
      '範例數字（$\\mathbf a=(3,1)$、$\\mu=0.25$、$s=1$）就是上面第一張表的 $k=0,1$ 兩列：$\\mathbf w_2=(1.5,\\ 1.5)$；改成 $s=-1$ 就是第二張表：$\\mathbf w_2=(1.5,\\ 0.5)$。',
    ],
  },

  // ───────────────────────── HC-09.2：平均遞迴：直接乘 vs. 拆成模式 ─────────────────────────
  {
    id: 'HC-09.2',
    title: '平均遞迴走 $k$ 步：直接乘一步，再拆成快／慢模式',
    page: PAGE,
    formulaId: 'F-09.4',
    formulaTex: String.raw`\begin{gathered}E[\boldsymbol\delta_{k+1}]=(\mathbf I-g\mathbf R)\,E[\boldsymbol\delta_k],\quad \mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix},\ g=\mu K_q;\\ c_{1}=\frac{\delta_1+\delta_2}{\sqrt2},\ \ c_{2}=\frac{\delta_1-\delta_2}{\sqrt2},\quad c_{i,k}=p_i^{\,k}\,c_{i,0},\quad p_{1,2}=1-g(1\pm\rho)\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho`, label: '相關係數（$0\\le\\rho\\le1$）', default: 0.99, min: 0, max: 1, practice: { choices: [0.5, 0.6, 0.8, 0.9] } },
      { key: 'g', symbol: 'g', label: '正規化 loop gain $g=\\mu K_q$', default: 0.5, min: 0, max: 5, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'd1', symbol: String.raw`\delta_{1,0}`, label: '初始誤差的第 1 個分量 $a_1-w_{1,0}$', default: 1, min: -100, max: 100, practice: { choices: [-2, -1, 0, 1, 2] } },
      { key: 'd2', symbol: String.raw`\delta_{2,0}`, label: '初始誤差的第 2 個分量 $a_2-w_{2,0}$', default: 0, min: -100, max: 100, practice: { choices: [-2, -1, 0, 1, 2] } },
      { key: 'k', symbol: 'k', label: '更新幾個 blocks', default: 4, min: 1, max: 200, integer: true, practice: { choices: [1, 2, 3] } },
    ],
    validate: ({ g, d1, d2 }) => {
      if (!(g > 0)) return '$g=\\mu K_q$ 必須大於 0（$g=0$ 時係數完全不更新）。'
      if (d1 === 0 && d2 === 0) return '初始誤差 $\\boldsymbol\\delta_0=(0,0)$：已經在答案上，沒有東西可以衰減。請至少讓一個分量不為 0。'
      return null
    },
    solve: ({ rho, g, d1, d2, k }) => {
      const R = corr2(rho)
      const lam = eig2x2(1, rho, 1).values // [1 + ρ, 1 − ρ]
      const [p1, p2] = polesOf(lam, g)
      const traj = meanTrajectory(R, g, [d1, d2], k)
      const t = (x: number) => tx(x, 7)
      const tP = (x: number) => txP(x, 7)
      const tF = (x: number) => txF(x, 7)
      // 直接乘一步（第 2、3 步）
      const a11 = snap(1 - g, 1, g)
      const a12 = -g * rho
      const prod = [
        [a11 * d1, a12 * d2],
        [a12 * d1, a11 * d2],
      ]
      const one = [snap(traj[0][1], prod[0][0], prod[0][1]), snap(traj[1][1], prod[1][0], prod[1][1])]
      // 模態座標：和、差剛好是 0 時（δ₀ 落在單一模式上）顯示精確的 0，而不是 cos 45° − sin 45° 的 1e-16 殘渣
      const sum0 = snap(d1 + d2, d1, d2)
      const dif0 = snap(d1 - d2, d1, d2)
      const c0raw = modalCoords(Q_CM_DM, [d1, d2])
      const c0 = [sum0 === 0 ? 0 : c0raw[0], dif0 === 0 ? 0 : c0raw[1]]
      const pk = [Math.pow(p1, k), Math.pow(p2, k)]
      const ck = [pk[0] * c0[0] + 0, pk[1] * c0[1] + 0] // + 0：(−0.8)¹ × 0 在 double 裡是 −0，答案寫成 0
      const sumK = snap(ck[0] + ck[1], ck[0], ck[1])
      const difK = snap(ck[0] - ck[1], ck[0], ck[1])
      const dk = [sumK === 0 ? 0 : traj[0][k], difK === 0 ? 0 : traj[1][k]]
      // 相近的數相加減時，運算元多顯示抵銷掉的那幾位
      const kSum = sigSub(sumK, ck, 6)
      const kDif = sigSub(difK, ck, 6)
      const single = c0[0] === 0 || c0[1] === 0
      const notes: string[] = []
      if (k === 1) notes.push('$k=1$：最後兩步（拆成模式再合回來）與第 2、3 步（直接乘）是同一個答案——兩條路徑等價。')
      else notes.push(String.raw`把 $k$ 改成 1 再算一次：拆成模式的答案會等於第 2、3 步直接乘出來的 $${txVec(one)}$。`)
      if (rho >= 1) notes.push('$\\rho=1$：$p_2=1$，差模座標 $c_2$ 永遠停在初值——這個方向不可辨識，跑再久也沒用。')
      else if (Math.abs(p1) >= 1 || Math.abs(p2) >= 1)
        notes.push(String.raw`注意：$|p_1|=${t(Math.abs(p1))}$、$|p_2|=${t(Math.abs(p2))}$ 之中有 $\ge1$ 的：平均遞迴發散。平均收斂需要 $0<g<2/\lambda_{\max}=${tx(2 / (1 + rho))}$。`)
      else if (single)
        notes.push(
          c0[0] === 0
            ? String.raw`$\delta_{1,0}+\delta_{2,0}=0$：初始誤差剛好整個落在差模方向 $(1,-1)$ 上（$c_{1,0}=0$），所以只有一個模式：$E[\boldsymbol\delta_k]=p_2^{\,k}\,\boldsymbol\delta_0$，每個 block 乘上 $${t(p2)}$。`
            : String.raw`$\delta_{1,0}-\delta_{2,0}=0$：初始誤差剛好整個落在共模方向 $(1,1)$ 上（$c_{2,0}=0$），所以只有一個模式：$E[\boldsymbol\delta_k]=p_1^{\,k}\,\boldsymbol\delta_0$，每個 block 乘上 $${t(p1)}$。`,
        )
      else if (Math.abs(ck[0]) <= 0.01 * Math.abs(ck[1]))
        notes.push(String.raw`共模已經衰減到 $|c_{1,${k}}|=${tx(Math.abs(ck[0]), 3)}$，誤差幾乎完全落在差模方向 $(1,-1)$ 上：$E[\delta_1]\approx-E[\delta_2]$。之後每個 block 只再縮小 $${tx(100 * (1 - Math.abs(p2)), 3)}\%$。`)
      else if (Math.abs(p1) !== Math.abs(p2))
        notes.push(String.raw`兩個模式都還在：$|c_{1,${k}}|=${tx(Math.abs(ck[0]), 3)}$、$|c_{2,${k}}|=${tx(Math.abs(ck[1]), 3)}$。$|p|$ 較小的那個（這裡是${Math.abs(p1) < Math.abs(p2) ? '共模' : '差模'}）先消失，剩下的時間都在等另一個。`)
      if (p1 < 0 && Math.abs(p1) < 1 && c0[0] !== 0) notes.push('$p_1<0$：共模每一步跳到答案的另一側（正負交替地收斂）。')
      return {
        steps: [
          {
            tex: String.raw`\mathbf I-g\mathbf R=\begin{bmatrix}1-g&-g\rho\\-g\rho&1-g\end{bmatrix}=\begin{bmatrix}1-${t(g)}&-${tF(g)}\times${t(rho)}\\-${tF(g)}\times${t(rho)}&1-${t(g)}\end{bmatrix}=\begin{bmatrix}${t(a11)}&${t(a12)}\\${t(a12)}&${t(a11)}\end{bmatrix}`,
            why: '一步矩陣：對角 $1-g$（一次減法），非對角 $-g\\rho$（一次乘法）——非對角項就是兩個 loop 互相干擾的來源。',
          },
          {
            tex: String.raw`E[\delta_{1,1}]=(1-g)\,\delta_{1,0}+(-g\rho)\,\delta_{2,0}=${tF(a11)}\times${tF(d1)}+${tF(a12)}\times${tF(d2)}=${tP(prod[0][0])}+${tP(prod[0][1])}=${t(one[0])}`,
            why: '直接乘一步（第一列）：矩陣的一列和向量「對應相乘再相加」——先算兩個乘積，再相加。',
          },
          {
            tex: String.raw`E[\delta_{2,1}]=(-g\rho)\,\delta_{1,0}+(1-g)\,\delta_{2,0}=${tF(a12)}\times${tF(d1)}+${tF(a11)}\times${tF(d2)}=${tP(prod[1][0])}+${tP(prod[1][1])}=${t(one[1])}`,
            why: '直接乘一步（第二列）。要走 $k$ 步就得這樣乘 $k$ 次——所以接下來改用 eigenvector 座標。',
          },
          {
            tex: String.raw`p_1=1-g(1+\rho)=1-${tF(g)}\times(1+${t(rho)})=1-${tF(g)}\times${t(lam[0])}=1-${t(g * lam[0])}=${t(p1)}`,
            why: '共模 $(1,1)/\\sqrt2$ 的 pole（$\\lambda_1=1+\\rho$）：先算括號，再乘，最後用 1 去減。',
          },
          {
            tex: String.raw`p_2=1-g(1-\rho)=1-${tF(g)}\times(1-${t(rho)})=1-${tF(g)}\times${t(lam[1])}=1-${t(g * lam[1])}=${t(p2)}`,
            why: '差模 $(1,-1)/\\sqrt2$ 的 pole（$\\lambda_2=1-\\rho$）。',
          },
          {
            tex: String.raw`c_{1,0}=\frac{\delta_{1,0}+\delta_{2,0}}{\sqrt2}=\frac{${t(d1)}+${tP(d2)}}{${SQRT2_TEX}}=\frac{${t(sum0)}}{${SQRT2_TEX}}=${texNum(c0[0], 6)}`,
            why: '把初始誤差投影到共模方向：先求和，再除以 $\\sqrt2\\approx1.41421$（按 $\\sqrt{\\ }$ 鍵）。',
          },
          {
            tex: String.raw`c_{2,0}=\frac{\delta_{1,0}-\delta_{2,0}}{\sqrt2}=\frac{${t(d1)}-${tP(d2)}}{${SQRT2_TEX}}=\frac{${t(dif0)}}{${SQRT2_TEX}}=${texNum(c0[1], 6)}`,
            why: '投影到差模方向：先求差，再除以 $\\sqrt2$。',
          },
          {
            tex: String.raw`c_{1,${k}}=p_1^{${k}}\,c_{1,0}=${tF(p1)}^{${k}}\times${rdF(c0[0], 6)}=${txF(pk[0], 6)}\times${rdF(c0[0], 6)}=${texNum(ck[0], 6)}`,
            why: '每個模式各自是等比數列：先按 $y^x$ 鍵（或連乘 $k$ 次）算 $p_1^{\\,k}$，再乘上初值。',
          },
          {
            tex: String.raw`c_{2,${k}}=p_2^{${k}}\,c_{2,0}=${tF(p2)}^{${k}}\times${rdF(c0[1], 6)}=${txF(pk[1], 6)}\times${rdF(c0[1], 6)}=${texNum(ck[1], 6)}`,
            why: '差模用自己的 pole。',
          },
          {
            tex: String.raw`E[\delta_{1,${k}}]=\frac{c_{1,${k}}+c_{2,${k}}}{\sqrt2}=\frac{${texNum(ck[0], kSum)}+${rdP(ck[1], kSum)}}{${SQRT2_TEX}}=\frac{${texNum(sumK, 6)}}{${SQRT2_TEX}}=${texNum(dk[0], 5)}`,
            why: '換回原本的座標：$\\boldsymbol\\delta=c_1\\mathbf v_1+c_2\\mathbf v_2$ 的第一個分量（先相加，再除以 $\\sqrt2$）。',
          },
          {
            tex: String.raw`E[\delta_{2,${k}}]=\frac{c_{1,${k}}-c_{2,${k}}}{\sqrt2}=\frac{${texNum(ck[0], kDif)}-${rdP(ck[1], kDif)}}{${SQRT2_TEX}}=\frac{${texNum(difK, 6)}}{${SQRT2_TEX}}=${texNum(dk[1], 5)}`,
            why: '第二個分量（$\\mathbf v_2$ 的第二個分量是 $-1/\\sqrt2$，所以是減）。',
          },
        ],
        results: [
          { symbol: `c_{1,${k}}`, label: `共模座標（${k} 個 blocks 後）`, value: ck[0] },
          { symbol: `c_{2,${k}}`, label: `差模座標（${k} 個 blocks 後）`, value: ck[1] },
          { symbol: String.raw`E[\delta_{1,${k}}]`, label: '第 1 個參數的平均誤差', value: dk[0] },
          { symbol: String.raw`E[\delta_{2,${k}}]`, label: '第 2 個參數的平均誤差', value: dk[1] },
        ],
        notes,
      }
    },
    tips: [
      '$\\sqrt2$ 會在「投影」與「換回來」各出現一次而互相抵消：也可以直接用和 $\\delta_1+\\delta_2$（每步乘 $p_1$）與差 $\\delta_1-\\delta_2$（每步乘 $p_2$）來算，最後 $\\delta_1=(\\text{和}+\\text{差})/2$、$\\delta_2=(\\text{和}-\\text{差})/2$。',
      '範例（$\\rho=0.99$、$g=0.5$、$\\boldsymbol\\delta_0=(1,0)$）對應上面「走四步」的表：把 $k$ 改成 1、2、3、4 就是表的每一列；$k=1$ 時 $E[\\boldsymbol\\delta_1]=(0.5,\\,-0.495)$、$\\mathbf c_1=(0.0035,\\ 0.7036)$（測試 T11）。',
      '$\\rho=1$、$k=30$ 可以重現第 6 小節的反面例子：和歸零、差永遠是 1。',
      '$\\sqrt2\\approx1.41421$（按 $\\sqrt{\\ }$ 鍵）。模態座標 $c$ 是除不盡的數：中間多留一位（6 位），最後的答案才有 5 位準；$E[\\boldsymbol\\delta]$ 與 $\\mathbf c$ 的單位都和 $\\mathbf a$ 相同。',
    ],
  },

  // ───────────────────────── HC-09.3：λ = 1 ± ρ、κ、pole、k95 ─────────────────────────
  {
    id: 'HC-09.3',
    title: '$\\lambda=1\\pm\\rho$、$\\kappa$、兩個 pole 與 $k_{95}$：598 是怎麼來的',
    page: PAGE,
    formulaId: 'F-09.6',
    formulaTex: String.raw`\lambda_{\max,\min}=1\pm\rho,\qquad \kappa=\frac{\lambda_{\max}}{\lambda_{\min}},\qquad p_i=1-g\lambda_i\ \ (g=\mu K_q),\qquad k_{95}=\left\lceil\frac{\ln 0.05}{\ln|p_{\text{slow}}|}\right\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      RHO_INPUT,
      { key: 'g', symbol: 'g', label: '正規化 loop gain $g=\\mu K_q$（規格的「$\\mu$」）', default: 0.5, min: 0, max: 2.5, practice: { choices: [0.1, 0.2, 0.25, 0.5, 1] } },
    ],
    validate: ({ rho, g }) => (rho >= 1 ? RHO_ONE_MESSAGE : gainMessage(g, 1 + rho)),
    solve: ({ rho, g }) => {
      const [lmax, lmin] = eig2x2(1, rho, 1).values
      const modes = eigenModes(corr2(rho), g)
      const [pFast, pSlow] = polesOf([lmax, lmin], g)
      const k95 = stepsToDecay(pSlow)
      const k95Fast = stepsToDecay(pFast)
      const t = (x: number) => tx(x, 7)
      const notes = [
        Math.abs(pFast) > Math.abs(pSlow)
          ? String.raw`$g>g^\star=2/(\lambda_{\max}+\lambda_{\min})=1$：此時 $|p_{\text{fast}}|=${t(Math.abs(pFast))}>|p_{\text{slow}}|=${t(Math.abs(pSlow))}$，「快」「慢」的名字對調了——最慢的反而是共模（$\lambda_{\max}$）那個模式，它要 $k_{95}=${txInt(k95Fast)}$ 個 blocks。$g$ 超過 $g^\star$ 只會更慢。`
          : String.raw`快模式（共模）只要 $k_{95}=${txInt(k95Fast)}$ 個 block，慢模式（差模）要 $${txInt(k95)}$ 個：整體收斂時間由 $\lambda_{\min}$ 決定。`,
        '這是 mean（ensemble 平均）的敘述，不是每一條軌跡的行為（勘誤 E23）；1-bit comparator 時 $g=\\mu K_q$ 要用物理的 $K_q$ 換算（勘誤 E05，見章末的綜合題）。',
      ]
      return {
        steps: [
          { tex: String.raw`\lambda_{\max}=1+\rho=1+${t(rho)}=${t(lmax)}`, why: '共模 $(1,1)/\\sqrt2$：兩個 regressor 同向時互相加強。' },
          { tex: String.raw`\lambda_{\min}=1-\rho=1-${t(rho)}=${t(lmin)}`, why: '差模 $(1,-1)/\\sqrt2$：$\\rho$ 越接近 1，輸入越少照到這個方向。' },
          { tex: String.raw`\kappa=\frac{\lambda_{\max}}{\lambda_{\min}}=\frac{${t(lmax)}}{${t(lmin)}}=${texNum(modes.kappa, 5)}`, why: 'condition number（eigenvalue spread）：兩個方向的能量差幾倍。' },
          {
            tex: String.raw`p_{\text{fast}}=1-g\lambda_{\max}=1-${txF(g, 7)}\times${t(lmax)}=1-${t(g * lmax)}=${t(pFast)}`,
            why: '快模式的 pole：每個 block 誤差乘上的倍數（先乘、再減）。',
          },
          {
            tex: String.raw`p_{\text{slow}}=1-g\lambda_{\min}=1-${txF(g, 7)}\times${t(lmin)}=1-${t(g * lmin)}=${tx(pSlow, sigNear1(pSlow))}`,
            why: '慢模式的 pole：$\\lambda_{\\min}$ 很小時它很接近 1，所以每個 block 只修掉一點點。',
          },
          ...k95Steps(pSlow, g * lmin),
        ],
        results: [
          { symbol: String.raw`\lambda_{\max}`, label: '共模的 eigenvalue', value: lmax },
          { symbol: String.raw`\lambda_{\min}`, label: '差模的 eigenvalue', value: lmin },
          { symbol: String.raw`\kappa`, label: 'condition number', value: modes.kappa },
          { symbol: String.raw`p_{\text{slow}}`, label: '慢模式的 pole', value: pSlow, digits: 6 },
          { symbol: 'k_{95}', label: '慢模式衰減到 5% 所需的 blocks', value: k95, unit: String.raw`\text{blocks}`, digits: 9 },
        ],
        notes,
      }
    },
    tips: [
      '計算機：$\\ln$ 是自然對數鍵。$\\ln0.05=-2.9957$ 可以記成 $-\\ln20\\approx-3$（「三個時間常數」）。',
      '$\\lceil x\\rceil$ 是無條件進位到整數：$597.65\\to598$。',
      '$p$ 很接近 1 時不必按 $\\ln p$：$\\dfrac{\\ln0.05}{\\ln(1-x)}\\approx\\dfrac{\\ln20}{x}-\\dfrac{\\ln20}{2}=\\dfrac{2.995732}{x}-1.498$（$x=g\\lambda_{\\min}\\ll1$；誤差約 $0.25x$ 個 block）。範例：$599.146-1.498=597.648$，取上整一樣是 598。',
      '範例（$\\rho=0.99$、$g=0.5$）的答案：$\\lambda=1.99,\\ 0.01$、$\\kappa=199$（測試 T10）；$p_{\\text{slow}}=0.995$、$k_{95}=598$（測試 T11）。',
    ],
  },

  // ───────────────────────── HC-09.4：一般對稱 2×2 ─────────────────────────
  {
    id: 'HC-09.4',
    title: '任意對稱 $2\\times2$：用 trace 與 determinant 求 $\\lambda$、$\\kappa$ 與最佳的單一 $g$',
    page: PAGE,
    formulaId: 'F-09.7',
    formulaTex: String.raw`\begin{gathered}\mathbf R=\begin{bmatrix}a&b\\b&d\end{bmatrix}:\quad T=a+d,\ \ D=ad-b^2,\quad \lambda_{\max,\min}=\frac T2\pm\sqrt{\Big(\frac T2\Big)^2-D};\\ g^\star=\frac{2}{\lambda_{\max}+\lambda_{\min}},\quad \max_i|1-g^\star\lambda_i|=\frac{\kappa-1}{\kappa+1}\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '$E[u_1^2]$（第 1 個 regressor 的功率）', default: 2, min: 0, max: 100, practice: { choices: [1, 1.5, 2, 3, 4] } },
      { key: 'b', symbol: 'b', label: '$E[u_1u_2]$（兩個 regressor 的相關）', default: 0.6, min: -100, max: 100, practice: { choices: [-0.8, -0.6, -0.5, 0.3, 0.5, 0.6, 0.8] } },
      { key: 'd', symbol: 'd', label: '$E[u_2^2]$（第 2 個 regressor 的功率）', default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
    ],
    validate: ({ a, b, d }) => {
      if (!(a > 0) || !(d > 0)) return '對角元素 $a=E[u_1^2]$、$d=E[u_2^2]$ 是 regressor 的功率，必須大於 0。'
      const det = a * d - b * b
      const bound = texNum(Math.sqrt(a * d))
      if (det < -1e-12 * a * d)
        return String.raw`$b^2>ad$：$\det\mathbf R=${texNum(det)}<0$，會有一個負的 eigenvalue——這不可能是相關矩陣 $E[\mathbf u\mathbf u^T]$（Cauchy–Schwarz：$E[u_1u_2]^2\le E[u_1^2]\,E[u_2^2]$）。請讓 $|b|<\sqrt{ad}=${bound}$。`
      if (det <= 1e-12 * a * d)
        return String.raw`$b^2=ad$：$\det\mathbf R=0\Rightarrow\lambda_{\min}=0$、$\kappa=\infty$：兩個 regressor 完全相關，有一個方向不可辨識，任何 $g$ 都救不了。請讓 $|b|<\sqrt{ad}=${bound}$。`
      return null
    },
    solve: ({ a, b, d }) => {
      const eg = eig2x2(a, b, d)
      const [lmax, lmin] = eg.values
      const opt = optimalScalarGain(lmax, lmin)
      const kappa = eigenModes(
        [
          [a, b],
          [b, d],
        ],
        opt.g,
      ).kappa
      const t = (x: number) => tx(x, 7)
      const T = a + d
      const half = T / 2
      const ad = a * d
      const b2 = b * b
      const D = snap(ad - b2, ad, b2)
      const half2 = half * half
      const disc = Math.max(0, snap(half2 - D, half2, D))
      const root = (lmax - lmin) / 2 // = √((T/2)² − D)（eig2x2 的半徑）
      // 兩個相近的數相減（ad − b²、(T/2)² − D、T/2 − √）：運算元多顯示抵銷掉的那幾位，畫面上的減法才算得出答案
      const kD = sigSub(D, [ad, b2], 7)
      const kDisc = sigSub(disc, [half2, D], 7)
      const kK = sigSub(kappa - 1, [kappa, 1]) // κ 很接近 1 時，κ − 1 要算得準，κ 與兩個 λ 都要多留幾位
      const kLam = Math.max(5, kK)
      const kRoot = sigSub(lmin, [half, root], kLam)
      const deg = (eg.angle * 180) / Math.PI
      return {
        steps: [
          { tex: String.raw`T=a+d=${t(a)}+${t(d)}=${t(T)}`, why: 'trace（對角線的和）＝兩個 eigenvalue 的和。' },
          {
            tex: String.raw`D=ad-b^2=${txF(a, 7)}\times${txF(d, 7)}-${txF(b, 7)}^2=${tx(ad, kD)}-${tx(b2, kD)}=${t(D)}`,
            why: 'determinant（對角相乘 − 反對角相乘）＝兩個 eigenvalue 的積：先算一個乘積與一個平方，再相減。',
          },
          {
            tex: String.raw`\Big(\frac T2\Big)^2-D=${txF(half, 7)}^2-${txP(D, kDisc)}=${tx(half2, kDisc)}-${txP(D, kDisc)}=${tx(disc, Math.max(7, kRoot + 2))}`,
            why: '二次方程式 $\\lambda^2-T\\lambda+D=0$ 的判別式（除以 4）：$T$ 先除以 2、平方，再減掉 $D$。它等於 $((a-d)/2)^2+b^2\\ge0$，所以對稱矩陣的 eigenvalue 一定是實數。',
          },
          {
            tex: String.raw`\sqrt{\Big(\frac T2\Big)^2-D}=\sqrt{${tx(disc, Math.max(7, kRoot + 2))}}=${texNum(root, kRoot)}`,
            why:
              '按 $\\sqrt{\\ }$ 鍵。' +
              (kRoot > 6 ? `下面的 $\\lambda_{\\min}$ 是兩個很接近的數相減，所以這個根號要保留 ${kRoot} 位有效數字（少留幾位，$\\lambda_{\\min}$ 就不準了）。` : ''),
          },
          { tex: String.raw`\lambda_{\max}=\frac T2+\sqrt{\Big(\frac T2\Big)^2-D}=${t(half)}+${texNum(root, kRoot)}=${texNum(lmax, kLam)}`, why: '較大的根：能量最多的方向。' },
          { tex: String.raw`\lambda_{\min}=\frac T2-\sqrt{\Big(\frac T2\Big)^2-D}=${t(half)}-${texNum(root, kRoot)}=${texNum(lmin, kLam)}`, why: '較小的根：能量最少、學得最慢的方向。' },
          {
            tex: String.raw`\lambda_{\max}\lambda_{\min}=${rdF(lmax, kLam)}\times${rdF(lmin, kLam)}=${texNum(lmax * lmin, 5)}\ (=D)`,
            why: '驗算：兩根的積要等於 determinant。反過來用也很方便：$\\kappa$ 很大時 $\\lambda_{\\min}=D/\\lambda_{\\max}$ 比「兩個相近的數相減」準得多。',
          },
          { tex: String.raw`\kappa=\frac{\lambda_{\max}}{\lambda_{\min}}=\frac{${texNum(lmax, kLam)}}{${texNum(lmin, kLam)}}=${texNum(kappa, kK)}`, why: 'condition number。' },
          { tex: String.raw`g_{\max}=\frac{2}{\lambda_{\max}}=\frac{2}{${texNum(lmax, kLam)}}=${texNum(2 / lmax, 5)}`, why: '平均穩定的上限：$|1-g\\lambda_{\\max}|<1$。' },
          { tex: String.raw`g^\star=\frac{2}{\lambda_{\max}+\lambda_{\min}}=\frac{2}{T}=\frac{2}{${t(T)}}=${texNum(opt.g, 5)}`, why: '最佳的單一 $g$：讓兩個 pole 大小相等、符號相反。兩根的和就是 $T$，不必再加一次。' },
          {
            tex: String.raw`\max_i|1-g^\star\lambda_i|=\frac{\kappa-1}{\kappa+1}=\frac{${texNum(kappa, kK)}-1}{${texNum(kappa, kK)}+1}=\frac{${texNum(kappa - 1, 5)}}{${texNum(kappa + 1, kK)}}=${texNum(opt.p, 5)}`,
            why: '用 $g^\\star$ 時每個 block 的收斂率：只看 $\\kappa$，$\\kappa$ 越大越接近 1（越慢）。',
          },
        ],
        results: [
          { symbol: String.raw`\lambda_{\max}`, label: '較大的 eigenvalue', value: lmax },
          { symbol: String.raw`\lambda_{\min}`, label: '較小的 eigenvalue', value: lmin },
          { symbol: String.raw`\kappa`, label: 'condition number', value: kappa },
          { symbol: String.raw`g^\star`, label: '最佳的單一 loop gain', value: opt.g },
          { symbol: String.raw`\frac{\kappa-1}{\kappa+1}`, label: '用 $g^\\star$ 時最慢模式的 $|p|$', value: opt.p },
        ],
        notes: [
          String.raw`主軸角 $\theta=\tfrac12\,\mathrm{atan2}(2b,\ a-d)=${tx(deg, 4)}^\circ$：$\mathbf v_{\max}=${txVec([eg.vectors[0][0], eg.vectors[1][0]], 4)}$、$\mathbf v_{\min}=${txVec([eg.vectors[0][1], eg.vectors[1][1]], 4)}$（由 eig2x2 計算；兩者垂直）。`,
          opt.p === 0
            ? '$\\kappa=1$：兩個方向一樣快，用 $g^\\star$ 時兩個 pole 都是 0——一個 block 就到位（$k_{95}=1$）。'
            : String.raw`用 $g^\star$ 時兩個 pole 是 $\pm${texNum(opt.p, 5)}$，95% 衰減需要 $k_{95}=${txInt(stepsToDecay(opt.p))}$ 個 blocks。`,
        ],
      }
    },
    tips: [
      '這和先備知識框裡的 $\\lambda=\\frac{a+d}{2}\\pm\\sqrt{(\\frac{a-d}{2})^2+b^2}$ 是同一個公式：$(T/2)^2-D=((a-d)/2)^2+b^2$。',
      '$a=d=1$、$b=\\rho$ 時退化成 $\\lambda=1\\pm\\rho$、$g^\\star=1$、最佳收斂率 $=\\rho$。',
      '$\\kappa$ 很大時 $\\lambda_{\\min}=\\tfrac T2-\\sqrt{\\cdot}$ 是兩個幾乎相等的數相減，根號少留一位答案就差很多（畫面會自動多顯示幾位）；改用 $\\lambda_{\\min}=D/\\lambda_{\\max}$ 就沒有這個問題。',
      '範例（$a=2$、$b=0.6$、$d=1$）就是先備知識框的例子：$\\lambda=2.281,\\ 0.719$、$\\theta=25.1^\\circ$。',
    ],
  },

  // ───────────────────────── HC-09.5：mean vs. mean-square ─────────────────────────
  {
    id: 'HC-09.5',
    title: 'Mean 收斂，mean-square 呢？手算 $\\rho_{\\mathrm{MS}}$（linear 與 1-bit）',
    page: PAGE,
    formulaId: 'F-09.8',
    formulaTex: String.raw`\begin{gathered}x_i=g\lambda_i,\ \ p_i=1-x_i;\\ \text{linear：}\ A_{ii}=p_i^2+\frac{2x_i^2}{N},\ \ A_{12}=\frac{x_1x_2}{N},\ \ \rho_{\mathrm{MS}}=\frac{A_{11}+A_{22}}{2}+\sqrt{\Big(\frac{A_{11}-A_{22}}{2}\Big)^2+A_{12}^2};\\ \text{1-bit：}\ s_i=p_i^2-\frac{x_i^2}{N}\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { ...RHO_INPUT, label: '相關係數（$0\\le\\rho\\le1$）', practice: { choices: [0, 0.5, 0.8, 0.9, 0.99] } },
      { key: 'g', symbol: 'g', label: '正規化 loop gain $g=\\mu K_q$', default: 0.5, min: 0, max: 2.5, practice: { choices: [0.1, 0.2, 0.25, 0.5] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', default: 1, min: 1, max: 65536, integer: true, unit: String.raw`\text{samples}`, practice: { choices: [1, 2, 4, 8, 16] } },
    ],
    validate: ({ rho, g }) => {
      const msg = gainMessage(g, 1 + rho)
      return msg ? `${msg}（連 mean 都發散時，mean-square 一定發散。）` : null
    },
    solve: ({ rho, g, N }) => {
      const lam = eig2x2(1, rho, 1).values
      const x = [g * lam[0], g * lam[1]]
      const poles = polesOf(lam, g)
      const p2 = [poles[0] * poles[0], poles[1] * poles[1]]
      const x2 = [x[0] * x[0], x[1] * x[1]]
      const A = meanSquareDiagGaussian([lam[0], lam[1]], g, N)
      const eA = eig2x2(A[0][0], A[0][1], A[1][1]).values
      const rhoMs = eA[0]
      const sumA = A[0][0] + A[1][1]
      const difA = snap(A[0][0] - A[1][1], A[0][0], A[1][1]) // A₁₁ = A₂₂ 時（例如 ρ = .99、g = .5、N = 2）是精確的 0
      const m = sumA / 2
      const h = difA / 2
      const h2 = h * h
      const a12sq = A[0][1] * A[0][1]
      const r = (eA[0] - eA[1]) / 2 // = √(h² + A₁₂²)（eig2x2 的半徑）
      const s = [0, 1].map((i) => snap(signModeFactor(rho, g, N, i as 0 | 1), p2[i], x2[i] / N))
      const signMax = Math.max(Math.abs(s[0]), Math.abs(s[1]))
      const meanSq = Math.max(p2[0], p2[1])
      const model = meanSquareRadius('gaussian', rho, g, N)
      const t = (v: number) => tx(v, 7)
      const tP = (v: number) => txP(v, 7)
      const tF = (v: number) => txF(v, 7)
      const nTex = txInt(N)
      // 相近的數相減（1 − x、A₁₁ − A₂₂、p² − x²/N）：運算元多顯示抵銷掉的那幾位
      const kP = [0, 1].map((i) => sigSub(poles[i], [1, x[i]], 7))
      const kH = sigSub(difA, [A[0][0], A[1][1]], 7)
      const kS = [0, 1].map((i) => sigSub(s[i], [p2[i], x2[i] / N], 7))
      // λ_min = 0（ρ = 1）：差模 pole = 1，mean 本身就不衰減——此時「mean 收斂、均方發散」與 1-bit 的說明都不適用
      const notes: string[] = []
      if (meanSq >= 1) notes.push(String.raw`$\lambda_{\min}=1-\rho=0$：差模的 pole $p_2=1$，連 mean 都不衰減（不可辨識），所以 $\rho_{\mathrm{MS}}=${tx(rhoMs)}\ge1$ 是必然的——加大 $N$ 或改 $g$ 都救不了這個方向。`)
      else if (rhoMs >= 1) notes.push(String.raw`$\rho_{\mathrm{MS}}=${tx(rhoMs)}\ge1$：mean 收斂（$\max|p_i|=${tx(Math.sqrt(meanSq))}<1$）但 mean-square 發散——598 這類數字只是 ensemble 平均的預測（勘誤 E23）。把 $N$ 加倍再算一次，看它何時掉到 1 以下。`)
      else notes.push(String.raw`$\rho_{\mathrm{MS}}=${tx(rhoMs)}<1$：均方也收斂，而且 $\rho_{\mathrm{MS}}\ge\max p_i^2=${tx(meanSq)}$（均方不會比「平均的平方」收斂得快）。`)
      notes.push(String.raw`對照：網站的 $3\times3$ 均方算子（meanSquareRadius）給出 $\rho_{\mathrm{MS}}=${t(model)}$，與手算的 $2\times2$ 一致。`)
      if (meanSq < 1) notes.push(signMax < 1 ? String.raw`同樣的 $g$、$N$，1-bit 的倍數是 $${tx(signMax)}<1$：sign-LMS 每步增量有界，沒有乘法式的發散（代價是 $\mu^2\mathbf R/N$ 的雜訊地板與小訊號假設）。` : String.raw`1-bit 的小訊號倍數 $${tx(signMax)}\ge1$：$K_q$ 線性化在這個 $g$ 下不可信，請減小 $g$ 或加大 $N$。`)
      return {
        steps: [
          { tex: String.raw`x_1=g\lambda_1=g(1+\rho)=${tF(g)}\times(1+${t(rho)})=${tF(g)}\times${t(lam[0])}=${t(x[0])}`, why: '共模的「一步修正比例」（先加、再乘）。' },
          { tex: String.raw`x_2=g\lambda_2=g(1-\rho)=${tF(g)}\times(1-${t(rho)})=${tF(g)}\times${t(lam[1])}=${t(x[1])}`, why: '差模的「一步修正比例」。' },
          { tex: String.raw`p_1^2=(1-x_1)^2=(1-${tx(x[0], kP[0])})^2=${txF(poles[0], 7)}^2=${t(p2[0])}`, why: '平均 pole 的平方（先減、再平方）：如果沒有隨機性，均方每步就乘這個數。' },
          { tex: String.raw`p_2^2=(1-x_2)^2=(1-${tx(x[1], kP[1])})^2=${txF(poles[1], 7)}^2=${t(p2[1])}`, why: '差模同理。' },
          { tex: String.raw`x_1^2=${tF(x[0])}^2=${t(x2[0])},\qquad x_2^2=${tF(x[1])}^2=${t(x2[1])}`, why: '兩個「一步修正比例」的平方：下面的 $A_{ii}$ 與 1-bit 的 $s_i$ 都要用。' },
          {
            tex: String.raw`A_{11}=p_1^2+\frac{2x_1^2}{N}=${t(p2[0])}+\frac{2\times${tF(x2[0])}}{${nTex}}=${t(p2[0])}+${tP((2 * x2[0]) / N)}=${t(A[0][0])}`,
            why: '多出來的 $2x_1^2/N$ 來自 Gaussian 的四階動差（$E[z^4]=3$）：同一個 sample 的 $\\mathbf u$ 出現四次。',
          },
          { tex: String.raw`A_{22}=p_2^2+\frac{2x_2^2}{N}=${t(p2[1])}+\frac{2\times${tF(x2[1])}}{${nTex}}=${t(p2[1])}+${tP((2 * x2[1]) / N)}=${t(A[1][1])}`, why: '差模的對角項。' },
          { tex: String.raw`A_{12}=\frac{x_1x_2}{N}=\frac{${tF(x[0])}\times${tF(x[1])}}{${nTex}}=\frac{${t(x[0] * x[1])}}{${nTex}}=${t(A[0][1])}`, why: '兩個模式的均方互相餵能量（mean 的座標是解耦的，均方不是）。' },
          { tex: String.raw`m=\frac{A_{11}+A_{22}}{2}=\frac{${t(A[0][0])}+${t(A[1][1])}}{2}=\frac{${t(sumA)}}{2}=${t(m)}`, why: '$\\mathbf A$ 是對稱 $2\\times2$：兩個 eigenvalue 的平均。' },
          { tex: String.raw`h=\frac{A_{11}-A_{22}}{2}=\frac{${tx(A[0][0], kH)}-${tx(A[1][1], kH)}}{2}=\frac{${t(difA)}}{2}=${t(h)}`, why: '對角差的一半。' },
          { tex: String.raw`h^2+A_{12}^2=${tF(h)}^2+${tF(A[0][1])}^2=${t(h2)}+${t(a12sq)}=${tx(h2 + a12sq, 9)}`, why: '兩個平方相加（與 HC-09.4 的 $((a-d)/2)^2+b^2$ 是同一個公式）。' },
          { tex: String.raw`r=\sqrt{h^2+A_{12}^2}=\sqrt{${tx(h2 + a12sq, 9)}}=${texNum(r, 7)}`, why: '按 $\\sqrt{\\ }$ 鍵。' },
          { tex: String.raw`\rho_{\mathrm{MS}}=m+r=${t(m)}+${texNum(r, 7)}=${texNum(rhoMs, 7)}`, why: '最大的 eigenvalue：$E\\|\\boldsymbol\\delta_k\\|^2$ 長期每個 block 乘上的倍數。$\\ge1$ 就是均方發散。' },
          {
            tex: String.raw`s_1=p_1^2-\frac{x_1^2}{N}=${tx(p2[0], kS[0])}-\frac{${tx(x2[0], kS[0])}}{${nTex}}=${tx(p2[0], kS[0])}-${tx(x2[0] / N, kS[0])}=${t(s[0])}`,
            why: '1-bit（Sign-LMS，小訊號線性化）：$q^2\\equiv1$ 讓四階動差消失，$+2x^2/N$ 變成 $-x^2/N$（F-09.18）。',
          },
          { tex: String.raw`s_2=p_2^2-\frac{x_2^2}{N}=${tx(p2[1], kS[1])}-\frac{${tx(x2[1], kS[1])}}{${nTex}}=${tx(p2[1], kS[1])}-${tx(x2[1] / N, kS[1])}=${t(s[1])}`, why: '差模同理；$E[c_i^2]$ 每步乘上 $s_i$。' },
        ],
        results: [
          { symbol: String.raw`\rho_{\mathrm{MS}}`, label: 'linear detector、Gaussian regressor 的均方半徑', value: rhoMs, digits: 6 },
          { symbol: String.raw`\max_i p_i^2`, label: '「平均的平方」（$N\\to\\infty$ 的極限）', value: meanSq, digits: 6 },
          { symbol: String.raw`\max_i|s_i|`, label: '1-bit 的每步均方倍數（小訊號近似）', value: signMax, digits: 6 },
        ],
        notes,
      }
    },
    tips: [
      '$A_{ii}=1-2g\\lambda_i+g^2\\lambda_i^2(1+2/N)$ 與 $(1-g\\lambda_i)^2+2(g\\lambda_i)^2/N$ 是同一個式子（把平方展開即可驗證）。',
      '$N\\to\\infty$ 時 $A_{ii}\\to p_i^2$、$A_{12}\\to0$：block 越長，均方行為越接近「平均行為的平方」。',
      '範例（$\\rho=0.99$、$g=0.5$）：$N=1\\Rightarrow\\rho_{\\mathrm{MS}}=1.9801$（發散）、$N=2\\Rightarrow0.99254$、1-bit $N=1\\Rightarrow0.99$（測試 T11 的 mean-square 部分）。',
    ],
  },

  // ───────────────────────── HC-09.6：四筆資料的窗口 ─────────────────────────
  {
    id: 'HC-09.6',
    title: '四筆 regressor 的窗口：$\\mathbf S_k$、$\\lambda_{\\min}$、$\\kappa$ 與 singular value',
    page: PAGE,
    formulaId: 'F-09.10',
    formulaTex: String.raw`\begin{gathered}\mathbf S_k=\sum_{n=k}^{k+N_0-1}\mathbf u[n]\mathbf u^T[n]=\begin{bmatrix}S_{11}&S_{12}\\S_{12}&S_{22}\end{bmatrix},\\ \alpha\mathbf I\preceq\mathbf S_k\preceq\beta\mathbf I\iff\alpha\le\lambda_{\min}(\mathbf S_k),\ \lambda_{\max}(\mathbf S_k)\le\beta;\\ \mathbf R_k=\frac{\mathbf S_k}{N_0},\quad \sigma_i(\mathbf U_k)=\sqrt{N_0\,\lambda_i(\mathbf R_k)}\qquad(N_0=4)\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: HAND_WINDOW_DEFAULT.flatMap(([d1, d2], n): HandCalcInput[] => [
      { key: `u1_${n}`, symbol: `u_1[${n}]`, label: `第 ${n} 筆的 $u_1$`, default: d1, min: -10, max: 10, practice: { choices: [-1, 1] } },
      { key: `u2_${n}`, symbol: `u_2[${n}]`, label: `第 ${n} 筆的 $u_2$`, default: d2, min: -10, max: 10, practice: { choices: [-1, 1] } },
    ]),
    validate: (v) =>
      Object.values(v).every((x) => x === 0)
        ? '窗口內所有 regressor 都是 0：$\\mathbf S_k=\\mathbf 0$，沒有任何方向被激發（兩個 eigenvalue 都是 0，$\\kappa$ 沒有定義）。請至少輸入一筆非零的 $\\mathbf u$。'
        : null,
    solve: (v) => {
      const N0 = HAND_WINDOW_N0
      const idx = Array.from({ length: N0 }, (_, n) => n)
      const u1 = idx.map((n) => v[`u1_${n}`])
      const u2 = idx.map((n) => v[`u2_${n}`])
      const cols = [Float64Array.from(u1), Float64Array.from(u2)]
      const Rk = sampleCorrelation(cols, cols, 0, N0)
      const pe = slidingWindowPe(u1, u2, N0)
      const degenerate = !Number.isFinite(pe.kappa[0])
      const t = (x: number) => tx(x, 7)
      const tP = (x: number) => txP(x, 7)
      const tF = (x: number) => txF(x, 7)
      // 窗口能量矩陣的三個元素（N₀·R_k）；每一項的平方／乘積另外列出，手算時先乘、再加
      const sq1 = u1.map((x) => x * x)
      const pr = u1.map((x, n) => x * u2[n])
      const sq2 = u2.map((x) => x * x)
      const S11 = N0 * Rk[0][0]
      const S12 = snap(N0 * Rk[0][1], ...pr)
      const S22 = N0 * Rk[1][1]
      const lmaxR = pe.lmax[0]
      const lminR = pe.lmin[0]
      const beta = N0 * lmaxR
      const alpha = N0 * lminR
      const T = S11 + S22
      const half = T / 2
      const SS = S11 * S22
      const S12sq = S12 * S12
      const half2 = half * half
      // 退化窗口（行為模型判定 λ_min = 0）：D 與 λ_min 是精確的 0，不是 double 的殘渣
      const D = degenerate ? 0 : SS - S12sq
      const disc = degenerate ? half2 : Math.max(0, half2 - D)
      const root = (beta - alpha) / 2
      const ratio = lminR / lmaxR
      const contraction = snap(1 - ratio, 1)
      const kD = sigSub(D, [SS, S12sq], 7)
      const kDisc = sigSub(disc, [half2, D], 7)
      const kRoot = sigSub(alpha, [half, root])
      const kC = sigSub(contraction, [1, ratio])
      const discTex = tx(disc, Math.max(7, kRoot + 2))
      return {
        steps: [
          { tex: String.raw`S_{11}=\sum_n u_1[n]^2=${sumTex(u1.map((x) => `${tF(x)}^2`))}=${sumTex(sq1.map(t))}=${t(S11)}`, why: '第 1 個 regressor 在窗口內的能量：四個數各自平方，再相加。' },
          {
            tex: String.raw`S_{12}=\sum_n u_1[n]\,u_2[n]=${sumTex(u1.map((x, n) => String.raw`${tF(x)}\times${tF(u2[n])}`))}=${sumTex(pr.map(tP))}=${t(S12)}`,
            why: '兩個 regressor 的乘積和：同號的資料加分、反號的資料扣分（先算四個乘積，再相加）。',
          },
          { tex: String.raw`S_{22}=\sum_n u_2[n]^2=${sumTex(u2.map((x) => `${tF(x)}^2`))}=${sumTex(sq2.map(t))}=${t(S22)}`, why: '第 2 個 regressor 的能量。' },
          { tex: String.raw`T=S_{11}+S_{22}=${t(S11)}+${t(S22)}=${t(T)}`, why: 'trace＝兩個 eigenvalue 的和（窗口的總能量）。' },
          {
            tex: String.raw`D=S_{11}S_{22}-S_{12}^2=${tF(S11)}\times${tF(S22)}-${tF(S12)}^2=${tx(SS, kD)}-${tx(S12sq, kD)}=${t(D)}`,
            why: 'determinant＝兩個 eigenvalue 的積（一個乘積減一個平方）；$D=0$ 就是退化窗口。',
          },
          {
            tex: String.raw`\Big(\frac T2\Big)^2-D=${tF(half)}^2-${txP(D, kDisc)}=${tx(half2, kDisc)}-${txP(D, kDisc)}=${discTex}`,
            why: '對稱 $2\\times2$ 的 eigenvalue 公式（HC-09.4）裡根號內的數：先把 $T$ 除以 2 再平方，然後減掉 $D$。',
          },
          {
            tex: String.raw`\sqrt{\Big(\frac T2\Big)^2-D}=\sqrt{${discTex}}=${texNum(root, kRoot)}`,
            why: '按 $\\sqrt{\\ }$ 鍵。$S_{11}=S_{22}$ 時（例如 $\\pm1$ code）這個數剛好是 $|S_{12}|$，不必按計算機。',
          },
          { tex: String.raw`\lambda_{\max}(\mathbf S_k)=\frac T2+\sqrt{\Big(\frac T2\Big)^2-D}=${t(half)}+${texNum(root, kRoot)}=${texNum(beta, 5)}`, why: '較大的根：PE 上界 $\\beta$ 至少要這麼大。' },
          {
            tex: String.raw`\lambda_{\min}(\mathbf S_k)=\frac T2-\sqrt{\Big(\frac T2\Big)^2-D}=${t(half)}-${texNum(root, kRoot)}=${texNum(alpha, 5)}`,
            why: '較小的根：PE 下界 $\\alpha$ 最多只能取到這麼大；等於 0 表示這個窗口不滿足 PE。',
          },
          {
            tex: String.raw`\lambda_{\min}(\mathbf R_k)=\frac{\lambda_{\min}(\mathbf S_k)}{N_0}=\frac{${texNum(alpha, 5)}}{${N0}}=${texNum(lminR, 5)}`,
            why: '$\\mathbf R_k=\\mathbf S_k/N_0$：矩陣除以常數，eigenvalue 也除以同一個常數。',
          },
          degenerate
            ? { tex: String.raw`\kappa(\mathbf R_k)=\frac{\lambda_{\max}}{\lambda_{\min}}\to\infty\qquad(\lambda_{\min}=0)`, why: '退化窗口：condition number 無限大（矩陣奇異）。' }
            : { tex: String.raw`\kappa(\mathbf R_k)=\frac{\lambda_{\max}}{\lambda_{\min}}=\frac{${texNum(beta, 5)}}{${texNum(alpha, 5)}}=${texNum(pe.kappa[0], 5)}`, why: 'condition number：$\\mathbf S_k$ 與 $\\mathbf R_k$ 只差常數倍，$\\kappa$ 相同。' },
          {
            tex: String.raw`\sigma_{\min}(\mathbf U_k)=\sqrt{N_0\,\lambda_{\min}(\mathbf R_k)}=\sqrt{${N0}\times${rdF(lminR, 5)}}=\sqrt{${texNum(alpha, 5)}}=${texNum(pe.svMin[0], 5)}`,
            why: '資料矩陣 $\\mathbf U_k$（四列、兩欄）最小的 singular value：$\\sigma_i^2=\\lambda_i(\\mathbf U_k^T\\mathbf U_k)=\\lambda_i(\\mathbf S_k)$（先乘回 $N_0$，再按 $\\sqrt{\\ }$）。',
          },
          {
            tex: String.raw`1-\mu\lambda_{\min}(\mathbf R_k)\Big|_{\mu=1/\lambda_{\max}(\mathbf R_k)}=1-\frac{\lambda_{\min}}{\lambda_{\max}}=1-\frac{${texNum(alpha, 5)}}{${texNum(beta, 5)}}=1-${texNum(ratio, kC)}=${texNum(contraction, 5)}`,
            why: '收縮界（F-09.17）：若一個 block 就是這個窗口，取這個界適用範圍內最大的 $\\mu=1/\\lambda_{\\max}(\\mathbf R_k)$，$\\|\\boldsymbol\\delta\\|$ 每個 block 至少縮小到這個比例（先除、再用 1 去減）。',
          },
        ],
        results: [
          { symbol: String.raw`\lambda_{\max}(\mathbf S_k)`, label: 'PE 上界 $\\beta$ 的最小可能值', value: beta },
          { symbol: String.raw`\lambda_{\min}(\mathbf S_k)`, label: 'PE 下界 $\\alpha$ 的最大可能值', value: alpha },
          { symbol: String.raw`\lambda_{\min}(\mathbf R_k)`, label: '窗口相關矩陣的最小 eigenvalue', value: lminR },
          { symbol: String.raw`\sigma_{\min}(\mathbf U_k)`, label: '資料矩陣的最小 singular value', value: pe.svMin[0] },
          { symbol: String.raw`1-\frac{\lambda_{\min}}{\lambda_{\max}}`, label: '一個 block 的收縮界（$\\mu=1/\\lambda_{\\max}(\\mathbf R_k)$）', value: contraction },
        ],
        notes: [
          degenerate
            ? '退化窗口：有一個方向的能量是 0（$\\lambda_{\\min}=0$、$\\sigma_{\\min}=0$、收縮界 $=1$）。找不到任何 $\\alpha>0$，這個窗口對該方向完全沒有資訊——窗口再長、$\\mu$ 再大也一樣。'
            : String.raw`兩個方向都有能量：這個窗口單獨來看 $\alpha$ 可取到 $${texNum(alpha, 5)}$、$\beta$ 取 $${texNum(beta, 5)}$。但 PE 要求的是「每一個」窗口都成立，量過一個窗口不能證明未來的窗口。`,
          Number.isFinite(pe.r12[0])
            ? String.raw`窗口內的樣本相關係數 $r=S_{12}/\sqrt{S_{11}S_{22}}=${texNum(S12 === 0 ? 0 : pe.r12[0], 5)}$${S11 === S22 ? String.raw`；因為 $S_{11}=S_{22}$，$\lambda(\mathbf R_k)=\tfrac{S_{11}}{N_0}(1\pm|r|)$，就是 $1\pm\rho$ 的窗口版本` : ''}。`
            : '有一個 regressor 在整個窗口內都是 0：它的能量 $S_{ii}=0$，那個參數在這個窗口完全沒被推到。',
        ],
      }
    },
    tips: [
      '$\\pm1$ code 的 $S_{11}=S_{22}=4$，所以 $\\lambda(\\mathbf S_k)=4\\pm|S_{12}|$，連開根號都不用。把數字改成 $2$ 或 $0.5$ 就需要 $\\sqrt{\\ }$ 鍵。',
      '範例是 §9.1「先算一次」的窗口 B：$(1,1),(1,-1),(-1,-1),(1,1)\\Rightarrow\\mathbf S_k=\\begin{bmatrix}4&2\\\\2&4\\end{bmatrix}$、$\\lambda=6,\\ 2$。把第 1 筆改成 $(1,1)$、第 2 筆改成 $(-1,-1)$ 就是窗口 A（退化）。',
    ],
  },

  // ───────────────────────── HC-09.7：one-hot gauge ─────────────────────────
  {
    id: 'HC-09.7',
    title: 'One-hot gauge：$b$ 加 $c$、每個 $a_i$ 減 $c$，四相輸出一模一樣',
    page: PAGE,
    formulaId: 'F-09.13',
    formulaTex: String.raw`y_i=b+a_i\ \ (\text{選到第 }i\text{ 相}),\qquad \boldsymbol\theta'=\boldsymbol\theta+c\,\mathbf n,\ \ \mathbf n=(1,-1,-1,-1,-1)\ \Rightarrow\ y_i'=(b+c)+(a_i-c)=y_i`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'b', symbol: 'b', label: 'global offset（所有相位共用）', unit: String.raw`\mathrm{fs}`, default: 1, min: -1000, max: 1000, practice: { min: -3, max: 3, step: 1 } },
      ...[2, 3, 4, 5].map(
        (def, i): HandCalcInput => ({
          key: `a${i}`,
          symbol: `a_${i}`,
          label: `第 ${i} 相的 phase offset`,
          unit: String.raw`\mathrm{fs}`,
          default: def,
          min: -1000,
          max: 1000,
          practice: { min: -4, max: 6, step: 1 },
        }),
      ),
      { key: 'c', symbol: 'c', label: 'gauge 平移量', unit: String.raw`\mathrm{fs}`, default: -1, min: -1000, max: 1000, practice: { choices: [-3, -2, -1, 1, 2, 3] } },
    ],
    solve: ({ b, a0, a1, a2, a3, c }) => {
      const P = 4
      const n = gaugeNullVector(P)
      const theta = [b, a0, a1, a2, a3]
      const shifted = theta.map((th, i) => th + c * n[i]) // θ' = θ + c·n
      const X = gaugeRegressorsRaw([0, 1, 2, 3], P) // 四個 phase 各選一次：x̃ = (1, one-hot)
      const y = (th: number[], ph: number) => X.reduce((acc, col, i) => acc + col[ph] * th[i], 0)
      const phases = [0, 1, 2, 3]
      const t = (x: number) => tx(x, 7)
      const tP = (x: number) => txP(x, 7)
      const y0 = phases.map((ph) => y(theta, ph))
      const y1 = phases.map((ph) => y(shifted, ph))
      const onlyB = y([b + c, a0, a1, a2, a3], 0)
      // (b + c) + (a_i − c) 與 b + a_i 在紙筆上完全相等；double 留下的 1e-16 殘渣不算差異
      const maxDiff = Math.max(...phases.map((ph) => Math.abs(snap(y0[ph] - y1[ph], y0[ph], y1[ph], b, c, theta[1 + ph]))))
      const nProj = (th: number[]) => th.reduce((acc, v, i) => acc + v * n[i], 0)
      const dProj = snap(nProj(shifted) - nProj(theta), 5 * c)
      const steps: HandCalcStep[] = [
        { tex: String.raw`b'=b+c=${t(b)}+${tP(c)}=${t(shifted[0])}`, why: 'global offset 加上 $c$。' },
        {
          // 符號式的兩個向量用 \dots 省略中間（四個分量在後面的代入數字裡都寫出來了），預設數字下才放得進正文欄、不必橫向捲動
          tex: String.raw`(a_0',\dots,a_3')=(a_0-c,\dots,a_3-c)=(${theta
            .slice(1)
            .map((a) => `${t(a)}-${tP(c)}`)
            .join(String.raw`,\ `)})=${txVec(shifted.slice(1), 7)}`,
          why: '每一相的 phase offset 都減掉同一個 $c$（四次減法）。',
        },
        ...phases.map((ph) => ({
          tex: String.raw`y_${ph}=b+a_${ph}=${t(b)}+${tP(theta[1 + ph])}=${t(y0[ph])},\qquad y_${ph}'=b'+a_${ph}'=${t(shifted[0])}+${tP(shifted[1 + ph])}=${t(y1[ph])}`,
          why: `選到第 ${ph} 相：one-hot 只有 $x_${ph}=1$，輸出就是 $b$ 加上那一相的 offset。兩組參數給出同一個數字。`,
        })),
      ]
      if (c !== 0)
        steps.push({
          tex: String.raw`y_0''=(b+c)+a_0=${t(b + c)}+${tP(a0)}=${t(onlyB)}\ \ne\ y_0=${t(y0[0])}`,
          why: '對照：只動 $b$（沒有把 $a_i$ 減回來）輸出就差了 $c$——這不是 gauge，raw-x domain 看得出來。',
        })
      steps.push({
        tex: String.raw`\mathbf n^T\boldsymbol\theta'-\mathbf n^T\boldsymbol\theta=c\,\|\mathbf n\|^2=${txF(c, 7)}\times5=${t(dProj)}`,
        why: '真正被改變的只有 $\\mathbf n$ 方向的分量（$\\|\\mathbf n\\|^2=1+1+1+1+1=5$）；而每一個 one-hot 輸入都滿足 $\\tilde{\\mathbf x}^T\\mathbf n=1-\\sum_ix_i=0$，所以量測永遠看不到它。',
      })
      return {
        steps,
        results: [
          { symbol: "b'", label: '平移後的 global offset', value: shifted[0], unit: String.raw`\mathrm{fs}` },
          ...phases.map((ph) => ({ symbol: `y_${ph}'`, label: `第 ${ph} 相的輸出（平移後的參數）`, value: y1[ph], unit: String.raw`\mathrm{fs}` })),
        ],
        notes: [
          String.raw`四相全部試過：$\max_i|y_i-y_i'|=${t(maxDiff)}$。再量一百萬筆也還是這四種輸入，所以兩組參數永遠分不出來——缺的是資訊，不是資料量。`,
          c === 0 ? '$c=0$：沒有平移，兩組參數本來就相同。換一個非零的 $c$ 試試。' : '若誤差還要先經過 $H_{\\mathrm{PD}}(1)=0$ 的 PLL error path，連「只動 $b$」那一行也看不出來（null space 變成 2 維，勘誤 E04）。',
        ],
      }
    },
    tips: [
      '每一步只有加減法。重點是 $+c$ 與 $-c$ 在同一個輸出裡剛好抵消：$(b+c)+(a_i-c)=b+a_i$。',
      '範例（$\\boldsymbol\\theta=(1,2,3,4,5)$、$c=-1$）就是 §9.2「先算一次」的表：$\\boldsymbol\\theta\'=(0,3,4,5,6)$，四相輸出都是 $3,4,5,6$。',
    ],
  },

  // ───────────────────────── HC-09.8：綜合 ─────────────────────────
  {
    id: 'HC-09.8',
    title: '綜合：物理單位的 $\\mu$——穩定嗎？要等幾個 blocks？窗口夠長嗎？',
    page: PAGE,
    formulaId: 'F-09.6',
    formulaTex: String.raw`\begin{gathered}K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\quad g=\mu K_q,\quad p_{\text{slow}}=1-g(1-\rho),\quad k_{95}=\left\lceil\frac{\ln 0.05}{\ln|p_{\text{slow}}|}\right\rceil;\\ P_{\text{退化}}=\Big(\frac{1+\rho}{2}\Big)^{N_0}+\Big(\frac{1-\rho}{2}\Big)^{N_0},\quad \frac{\mathrm{std}[\lambda_i(\mathbf R_k)]}{\lambda_i}\approx\sqrt{\frac{2}{N_0}}\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊標準差', unit: String.raw`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '1-bit Sign-LMS 的 learning rate', unit: String.raw`\mathrm{fs}`, default: 0.5, min: 0, max: 10000, practice: { choices: [0.5, 1, 2, 5, 10, 20, 50] } },
      RHO_INPUT,
      { key: 'N0', symbol: 'N_0', label: 'PE 窗口長度', unit: String.raw`\text{samples}`, default: 100, min: 2, max: 100000, integer: true, practice: { choices: [10, 20, 50, 100, 200] } },
    ],
    validate: ({ sigmaV, mu, rho }) => {
      if (!(sigmaV > 0)) return '$\\sigma_v=0$：$K_q=\\sqrt{2/\\pi}/\\sigma_v\\to\\infty$，小訊號線性化失效（sign-LMS 變成每步 $\\pm\\mu$ 的 bang-bang 更新）。請設定 $\\sigma_v>0$。'
      if (!(mu > 0)) return '$\\mu$ 必須大於 0（$\\mu=0$ 時係數完全不更新）。'
      if (rho >= 1) return RHO_ONE_MESSAGE
      const Kq = comparatorKq(sigmaV)
      const g = mu * Kq
      if (g * (1 + rho) >= 2)
        return String.raw`$g\lambda_{\max}=\mu K_q(1+\rho)=${texNum(g * (1 + rho))}\ge2$：快模式發散（平均遞迴的 pole $\le-1$）。請讓 $\mu<\dfrac{2}{K_q\lambda_{\max}}=${texNum(2 / (Kq * (1 + rho)))}\ \mathrm{fs}$。`
      return null
    },
    solve: ({ sigmaV, mu, rho, N0 }) => {
      const Kq = comparatorKq(sigmaV)
      const g = mu * Kq
      const [lmax, lmin] = eig2x2(1, rho, 1).values
      const pSlow = polesOf([lmax, lmin], g)[1]
      const x = g * lmin
      const k95 = stepsToDecay(pSlow)
      const pPlus = (1 + rho) / 2
      const pMinus = (1 - rho) / 2
      const powPlus = Math.pow(pPlus, N0)
      const powMinus = Math.pow(pMinus, N0)
      const pDeg = pm1DegenerateProb(rho, N0)
      const rel = sampleEigRelStd(N0)
      const t = (v: number) => tx(v, 7)
      const nTex = txInt(N0)
      /** 一般工程計算機的指數下限是 10⁻⁹⁹：更小的數會直接顯示 0 */
      const underflow = (v: number) => v < 1e-99
      return {
        steps: [
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(Math.sqrt(2 / Math.PI), 7)}}{${t(sigmaV)}}=${texNum(Kq, 7)}\ \mathrm{fs}^{-1}`,
            why: '1-bit comparator 的統計小訊號增益（第 5 章）：$2\\div\\pi=0.6366198$，開根號得 $0.7978846$，再除以 $\\sigma_v$。後面的 $p_{\\text{slow}}$ 很接近 1，所以這裡就要保留 7 位。',
          },
          { tex: String.raw`g=\mu K_q=${txF(mu, 7)}\times${texNum(Kq, 7)}=${texNum(g, 7)}`, why: '無因次 loop gain（$\\mathrm{fs}\\times\\mathrm{fs}^{-1}$）：規格的「$\\mu=0.5$」其實是指這個 $g$（勘誤 E05）。' },
          {
            tex: String.raw`\lambda_{\max}=1+\rho=1+${t(rho)}=${t(lmax)},\qquad \lambda_{\min}=1-\rho=1-${t(rho)}=${t(lmin)}`,
            why: '$\\mathbf R=\\begin{bmatrix}1&\\rho\\\\\\rho&1\\end{bmatrix}$ 的 eigenvalues（F-09.5）。',
          },
          { tex: String.raw`g\lambda_{\max}=${texNum(g, 7)}\times${t(lmax)}=${texNum(g * lmax, 5)}<2`, why: '穩定性看 $\\lambda_{\\max}$：平均收斂需要 $0<g\\lambda_{\\max}<2$。' },
          { tex: String.raw`x=g\lambda_{\min}=${texNum(g, 7)}\times${t(lmin)}=${tx(x, 7)}`, why: '速度看 $\\lambda_{\\min}$：$x$ 是慢模式每個 block 修掉的比例。' },
          {
            tex: String.raw`p_{\text{slow}}=1-x=1-${tx(x, 7)}=${tx(pSlow, sigNear1(pSlow))}`,
            why: '慢模式的 pole。這個數很接近 1：小數點後的每一位都要留著（或讓計算機接著算，不要重新輸入四捨五入後的 $p$），下一步的 $\\ln$ 才準。',
          },
          ...k95Steps(pSlow, x),
          {
            tex: String.raw`\frac{1+\rho}{2}=\frac{1+${t(rho)}}{2}=\frac{${t(1 + rho)}}{2}=${tx(pPlus, 12)},\qquad \frac{1-\rho}{2}=\frac{1-${t(rho)}}{2}=\frac{${t(lmin)}}{2}=${tx(pMinus, 12)}`,
            why: '$\\pm1$ sparse-flip code（$u_2=s\\,u_1$）：每一筆「不 flip」（$s=+1$）的機率與「flip」（$s=-1$）的機率，兩者相加是 1。',
          },
          {
            tex: String.raw`\Big(\tfrac{1+\rho}{2}\Big)^{N_0}=${txF(pPlus, 12)}^{${nTex}}=${texNum(powPlus, 5)}`,
            why:
              '整個窗口 $N_0$ 筆都沒有 flip 的機率（各筆獨立，機率連乘）：按 $y^x$ 鍵。此時 $u_2\\equiv u_1$，差模完全沒被激發。' +
              (underflow(powPlus) ? '這個數小於 $10^{-99}$，一般工程計算機會直接顯示 0——當成 0 即可。' : ''),
          },
          {
            tex: String.raw`\Big(\tfrac{1-\rho}{2}\Big)^{N_0}=${txF(pMinus, 12)}^{${nTex}}=${texNum(powMinus, 5)}`,
            why:
              '整個窗口每一筆都 flip 的機率（$u_2\\equiv-u_1$，這次是共模沒被激發）。$\\rho$ 接近 1 時小到可以忽略。' +
              (underflow(powMinus) ? '它小於 $10^{-99}$，一般工程計算機會直接顯示 0——當成 0 即可，答案不受影響。' : ''),
          },
          {
            tex: String.raw`P_{\text{退化}}=\Big(\tfrac{1+\rho}{2}\Big)^{N_0}+\Big(\tfrac{1-\rho}{2}\Big)^{N_0}=${texNum(powPlus, 5)}+${texNum(powMinus, 5)}=${texNum(pDeg, 5)}`,
            why: '兩種退化情形互斥，機率相加（F-09.11）：這些窗口的 $\\lambda_{\\min}(\\mathbf R_k)=0$，對其中一個方向沒有任何資訊。',
          },
          {
            tex: String.raw`\sqrt{\frac{2}{N_0}}=\sqrt{\frac{2}{${nTex}}}=\sqrt{${tx(2 / N0)}}=${texNum(rel, 5)}`,
            why: 'Gaussian regressor 不會精確退化，但窗口 eigenvalue 的估計有這麼大的相對散佈（F-09.12，$N_0\\gg1$ 的漸近近似）：先除、再按 $\\sqrt{\\ }$。',
          },
        ],
        results: [
          { symbol: 'g', label: '無因次 loop gain $\\mu K_q$', value: g },
          { symbol: 'k_{95}', label: '慢模式衰減到 5% 所需的 blocks', value: k95, unit: String.raw`\text{blocks}`, digits: 9 },
          { symbol: String.raw`P_{\text{退化}}`, label: '$\\pm1$ code 的退化窗口機率', value: pDeg },
          { symbol: String.raw`\sqrt{2/N_0}`, label: 'Gaussian 窗口 eigenvalue 的相對散佈', value: rel },
        ],
        notes: [
          String.raw`要得到規格例子的 $g=0.5$（$\rho=0.99$ 時 598 blocks），需要 $\mu=0.5/K_q=${texNum(0.5 / Kq, 5)}\ \mathrm{fs}$；若把「0.5」直接當成 $\mu\,[\mathrm{fs}]$，$g$ 只有 $0.5K_q=${texNum(0.5 * Kq, 5)}$，慢了 $1/K_q\approx${texNum(1 / Kq, 3)}$ 倍（勘誤 E05）。`,
          String.raw`三件事各看不同的量：穩定看 $g\lambda_{\max}$、速度看 $g\lambda_{\min}$、PE 看每一個窗口的 $\lambda_{\min}(\mathbf R_k)$。$k_{95}$ 是 mean 的敘述（勘誤 E23），$K_q$ 是 $|\mathbf u^T\boldsymbol\delta|\ll\sigma_v$ 的小訊號近似。`,
          String.raw`要把 $\lambda_{\min}$ 量到 $\pm1\%$，Gaussian regressor 需要 $N_0\approx2/0.01^2=2\times10^4$ 筆。`,
        ],
      }
    },
    tips: [
      '$\\sqrt{2/\\pi}=0.79788$：先算 $2\\div\\pi=0.63662$，再按 $\\sqrt{\\ }$。',
      '$p_{\\text{slow}}$ 非常接近 1 時，$\\ln p$ 對捨入很敏感：$p$ 的每一位都要留著（畫面會顯示到 $1-p$ 還有 7 位為止），或改用 $\\ln(1-x)\\approx-x-x^2/2$。更省事的是 $\\dfrac{\\ln0.05}{\\ln(1-x)}\\approx\\dfrac{2.995732}{x}-1.498$（$x=g\\lambda_{\\min}\\ll1$，誤差約 $0.25x$ 個 block）：範例是 $75091.87-1.50=75090.37$，取上整得 $75{,}091$。',
      '$y^x$ 鍵：$0.995^{100}=0.6058$。沒有 $y^x$ 鍵時用 $(1-x)^{N_0}=e^{N_0\\ln(1-x)}\\approx e^{-N_0x}$（$x=(1-\\rho)/2\\ll1$；相對誤差約 $N_0x^2/2$，範例是 $e^{-0.5}=0.6065$，差 $0.13\\%$）。第二項 $((1-\\rho)/2)^{N_0}$ 通常小到可以忽略（小於 $10^{-99}$ 時計算機會直接顯示 0）。',
      '範例（$\\sigma_v=100\\ \\mathrm{fs}$、$\\mu=0.5\\ \\mathrm{fs}$、$\\rho=0.99$、$N_0=100$）：$K_q=0.0079788\\ \\mathrm{fs}^{-1}$、$k_{95}=75{,}091$、退化窗口 $60.6\\%$。',
    ],
  },
]

/** 依 ID 取出本章的手算題（章內 <HandCalc def={…} /> 使用；找不到時直接丟錯，避免靜默漏題） */
export function ch09HandCalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Ch09 手算題中找不到 ${id}`)
  return def
}
