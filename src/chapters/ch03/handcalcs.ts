import { texNum } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { normInv } from '@/simulation/core'
import { classifyPole, fixedXMuMax, fixedXPole, meanPole, meanSquareFactor, meanSquareMuMax, runScalarLms } from '@/simulation/models/lms'
import {
  blockMeanSquareBound,
  cltConvergedFraction,
  cltStepsBelowStart,
  cltZScore,
  msdAfterSteps,
  stabilityBounds,
  stabilityFactors,
  steadyStateMsd,
  stepsToReach,
  timeConstant,
  xMoments,
  type XDist,
} from '@/simulation/models/scalarStability'
import { agree, sigDigits, sigFor, sigForN, sigLn, sigPow, snap, tx, txCeilArg, txFixed, txInt, txLn, txP, txPow, txSq } from './handcalcTex'
import { poleLabelTex } from './poleLabel'

/**
 * 第 3 章的「帶入手算」題（HC-03.1 … HC-03.8）。
 *  - solve() 的答案一律來自 src/simulation 的實際函式（lms.ts、scalarStability.ts）；
 *    這裡另外算的只有「顯示用的中間量」（一次乘法、一次 ln…），測試逐一與模型及獨立重算比對。
 *  - 每一步的 tex 都是「符號式 = 代入數字 =（中間結果 =）結果」：每個等號只做一種運算，
 *    而且畫面上的數字自己就算得出下一個等號（handcalcs.test.tsx 會把每一步的 TeX 重新求值檢查，
 *    包含 $\mu=10^{-6}$、$\sigma=2\times10^{-5}$ 這類讀者自己會打的數字）。顯示一律用 handcalcTex.ts 的 tx()／txP()／txSq()…。
 *  - 極性一律 δ = a − w（勘誤 E39）。
 *  - inputs 的 default 是本章 worked example 的數字（T02、T03、思考題 4／5、勘誤 E14 的 83%）。
 */

const PAGE = '/ch/03'
const R = String.raw
/** 四捨五入到 sig 位有效數字（說明文字、次方的結果用） */
const tn = texNum

/** 逗號分隔的數列（TeX） */
const seq = (xs: string[]) => xs.join(R`,\ `)
/** 是否在 1e−12 的相對誤差內相等（判斷「恰在邊界」用） */
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b))
/** 判據的三種結論：小於門檻＝收斂、恰在門檻＝邊界、大於門檻＝發散 */
type Tri = 'ok' | 'edge' | 'bad'
const tri = (value: number, threshold: number): Tri => (near(value, threshold) ? 'edge' : value < threshold ? 'ok' : 'bad')
const TRI_TEXT: Record<Tri, string> = { ok: '收斂 ✓', edge: '邊界（不收斂）', bad: '發散 ✗' }
/** tx() 顯示出來的十進位數字用了幾位有效數字（科學記號等無法解析時回傳 1） */
const shownSig = (s: string) => sigDigits(Number(s))

const MSG_X_ZERO = R`$x = 0$ 時 $e_n=\delta_n x\equiv 0$，$w$ 永遠不動（$p=1$）：資料裡沒有 $a$ 的資訊（沒有激勵、不可辨識），$\mu_{\max}=2/x^2$ 也沒有定義。請換一個非零的 $x$。`
const MSG_RANGE = R`這組數字的中間結果超出計算機與 double 能表示的範圍（約 $10^{\pm308}$），無法逐步顯示。請把數字改小一點（例如減少步數 $n$，或把 $\mu$ 調回穩定範圍附近）。`

/** P_x、M_4 是否可能來自某個分布；不行時回傳說明 */
function momentError(Px: number, M4: number): string | null {
  if (!(Px > 0)) return R`$P_x=E[x^2]\le 0$：平方的平均不可能是負的；$P_x=0$ 代表 $x$ 恆為 0（沒有激勵、$a$ 不可辨識）。請輸入 $P_x>0$。`
  if (M4 < Px * Px * (1 - 1e-12))
    return R`$M_4=${tx(M4)}<P_x^2=${tx(Px * Px)}$：不存在這樣的分布。任何隨機變數都有 $\operatorname{Var}(x^2)=M_4-P_x^2\ge 0$（也就是 $\kappa=M_4/P_x^2\ge 1$）。$|x|$ 為常數時 $M_4=P_x^2$，Gaussian 是 $M_4=3P_x^2$。`
  return null
}

/** Φ(z) 的顯示：查表範圍內寫到小數 4 位（和常態表一樣），尾巴則保留 3 位有效數字 */
function phiTex(frac: number): string {
  if (frac >= 1e-3 && frac <= 0.999) return txFixed(frac, 4)
  if (frac < 1e-3) return tn(frac, 3)
  if (frac >= 1) return '1'
  return txFixed(frac, Math.min(15, Math.ceil(-Math.log10(1 - frac)) + 1))
}

/** HC-03.7 手算提示用：Gaussian N(0,1) 幾個 μ 的 λ 與 s（4 位有效數字；測試與 lyapunovExponent / logFactorVariance 比對） */
export const GAUSS_CLT_TABLE: { mu: number; lambda: number; s: number }[] = [
  { mu: 0.8, lambda: -0.4657, s: 0.9285 },
  { mu: 2, lambda: -0.1162, s: 1.206 },
  { mu: 2.3, lambda: -0.03243, s: 1.253 },
]

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── HC-03.1：固定 x 的 pole ───────────── */
  {
    id: 'HC-03.1',
    title: R`固定 $x$：pole、穩定上限與前兩步的誤差`,
    page: PAGE,
    formulaId: 'F-03.3',
    formulaTex: R`\delta_n\equiv a-w_n,\qquad \delta_{n+1}=p\,\delta_n,\qquad p=1-\mu x^2,\qquad |p|<1\iff 0<\mu<\mu_{\max}=\frac{2}{x^2}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實參數（未知的答案）', default: 3, min: -100, max: 100, practice: { choices: [3, 4, 5] } },
      { key: 'w0', symbol: 'w_0', label: '一開始的估計', default: 1, min: -100, max: 100, practice: { choices: [0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', default: 2, min: -10, max: 10, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.1, min: -5, max: 5, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6] } },
    ],
    validate: ({ x }) => (x === 0 ? MSG_X_ZERO : null),
    solve: ({ a, w0, x, mu }) => {
      // 網站的 LMS 程式實際迭代兩步（δ = a − w）
      const r = runScalarLms({ variant: 'conventional', a, w0, mu, steps: 2, x: { kind: 'fixed', value: x } })
      const x2 = x * x
      const mx2 = mu * x2
      const p = snap(fixedXPole(mu, x), 1, mx2)
      const muMax = fixedXMuMax(x)
      // 模擬的 δ_n = a − w_n 是兩個相近的數相減：與手算的 p·δ_{n−1} 只差 double 的捨入誤差時，顯示乾淨的那個值
      // （例如 0.3 − 0.30000000000000004 = −5.6e−17 其實是 0）；兩者是否相等由測試另外確認
      const d0 = snap(r.delta[0], a, w0)
      const d1 = agree(r.delta[1], p * d0, a, r.w[1])
      const d2 = agree(r.delta[2], p * d1, a, r.w[2])
      const w2 = agree(r.w[2], a - d2, a, d2)
      const k0 = sigFor(d0, a, w0)
      const kp = sigFor(p, 1, mx2)
      const k2 = sigFor(w2, a, d2)
      const notes = [poleLabelTex(p), R`一步到位的步長是 $\mu=1/x^2=${tn(1 / x2)}$（此時 $p=0$）；穩定上限正好是它的 2 倍。`]
      if (mu < 0) notes.push(R`$\mu<0$：更新方向反了（等同極性反轉），$p=1-\mu x^2>1$，誤差同號放大——第 6 章「極性」的最簡單版本。`)
      else if (classifyPole(p) === 'divergent') notes.push(R`$\mu=${tx(mu)}$ 超過上限 $\mu_{\max}=${tn(muMax)}$：每一步都修正過頭，而且過頭的量比原來的誤差還大。`)
      return {
        steps: [
          {
            tex: R`\delta_0=a-w_0=${tx(a, k0)}-${txP(w0, k0)}=${tx(d0)}`,
            why: R`全站極性 $\delta=a-w$（真實值減估計值，勘誤 E39）。$\delta_0>0$ 表示一開始猜得太小。`,
          },
          { tex: R`x^2=${txSq(x)}=${tx(x2)}`, why: '輸入的平方（輸入功率）；正負號在這裡消失。' },
          { tex: R`\mu_{\max}=\frac{2}{x^2}=\frac{2}{${tx(x2)}}=${tx(muMax)}`, why: R`穩定上限（F-03.3）：$\mu$ 超過它，$|p|>1$。` },
          {
            tex: R`p=1-\mu x^2=1-${txP(mu)}\times${tx(x2)}=1-${txP(mx2, kp)}=${tx(p)}`,
            why: R`pole：誤差每一步乘上的倍數。先乘出 $\mu x^2$，再用 1 去減。`,
          },
          { tex: R`\delta_1=p\,\delta_0=${txP(p)}\times${txP(d0)}=${tx(d1)}`, why: '第一步之後剩下的誤差。' },
          { tex: R`\delta_2=p\,\delta_1=${txP(p)}\times${txP(d1)}=${tx(d2, k2)}`, why: R`再乘一次 $p$：等比數列 $\delta_n=p^{\,n}\delta_0$。` },
          {
            tex: R`w_2=a-\delta_2=${tx(a, k2)}-${txP(d2, k2)}=${tx(w2)}`,
            why: R`把誤差換回估計值。它和直接用 $w_{n+1}=w_n+\mu e_nx$ 迭代兩步的結果相同（網站的數字就是 LMS 程式實際迭代出來的）。`,
          },
        ],
        results: [
          { symbol: R`\mu_{\max}`, label: '穩定上限', value: muMax },
          { symbol: 'p', label: 'pole', value: p },
          { symbol: R`\delta_2`, label: '兩步後的參數誤差', value: d2, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: 'w_2', label: '兩步後的估計', value: w2, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes,
      }
    },
    tips: [
      R`先算 $x^2$，再算 $\mu x^2$，最後用 1 去減：每個等號都只有一次四則運算。`,
      R`範例數字（$a=3,\ w_0=1,\ x=2,\ \mu=0.1$）：$p=0.6$，$\delta_0,\delta_1,\delta_2=2,\ 1.2,\ 0.72$，$w_2=2.28$（測試 T01／T02）。`,
      R`驗算：$\delta_1/\delta_0$ 與 $\delta_2/\delta_1$ 都應該等於 $p$；$p<0$ 時誤差每一步變號。`,
      R`單位：本題的數字都已正規化（無因次）。套到硬體時 $a$、$w$、$\delta$ 同單位（$[y]/[x]$），$\mu$ 的單位是 $1/[x]^2$，所以 $\mu x^2$ 與 $p$ 永遠無因次；$n$ 以 sample 計。`,
    ],
  },

  /* ───────────── HC-03.2：時間常數與收斂步數 ───────────── */
  {
    id: 'HC-03.2',
    title: R`要等幾步？時間常數 $\tau$ 與降到 $\varepsilon$ 所需的步數`,
    page: PAGE,
    formulaId: 'F-03.4',
    formulaTex: R`\frac{|\delta_n|}{|\delta_0|}=|p|^n=e^{-n/\tau},\qquad \tau=\frac{-1}{\ln|p|},\qquad n_\varepsilon=\left\lceil\frac{\ln\varepsilon}{\ln|p|}\right\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'x', symbol: 'x', label: '固定的輸入', default: 2, min: -10, max: 10, practice: { choices: [1, 2] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.1, min: -5, max: 5, practice: { choices: [0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4] } },
      { key: 'eps', symbol: R`\varepsilon`, label: '誤差要縮小到原來的幾分之幾', default: 0.001, min: 0, max: 1, practice: { choices: [0.1, 0.01, 0.001] } },
    ],
    validate: ({ x, mu, eps }) => {
      if (x === 0) return MSG_X_ZERO
      if (!(eps > 0 && eps < 1)) return R`$\varepsilon$ 是「誤差要縮小到原來的幾分之幾」，必須在 $0<\varepsilon<1$ 之間（例如 $10^{-3}$）；$\ln\varepsilon$ 才是有限的負數。`
      const p = fixedXPole(mu, x)
      if (classifyPole(p) === 'deadbeat')
        return R`$p=1-\mu x^2=0$：理想模型一步到位（$n_\varepsilon=1$），$\ln|p|=\ln 0$ 沒有定義、時間常數 $\tau\to0$，沒有東西可以算。請換一個 $\mu\ne 1/x^2=${tn(1 / (x * x))}$。`
      if (!Number.isFinite(timeConstant(p)) || !(Math.abs(p) < 1 - 1e-12))
        return R`$|p|=|1-\mu x^2|=${tn(Math.abs(p))}\ge 1$：誤差不會縮小（邊界或發散），$\ln|p|\ge0$，沒有時間常數，也永遠到不了 $\varepsilon$。請把 $\mu$ 調到 $0<\mu<2/x^2=${tn(fixedXMuMax(x))}$ 之內。`
      return null
    },
    solve: ({ x, mu, eps }) => {
      const p = fixedXPole(mu, x)
      const tau = timeConstant(p)
      const nEps = stepsToReach(p, eps)
      const x2 = x * x
      const mx2 = mu * x2
      const absP = Math.abs(p)
      const lnP = Math.log(absP)
      const lnEps = Math.log(eps)
      const ratio = lnEps / lnP
      // |p| 很接近 1 時（μx² 很小）要多顯示幾位，ln|p| 才算得出來；運算元也跟著多顯示
      const sP = sigLn(absP)
      const kp = sigForN(sP, p, 1, mx2)
      // ⌈·⌉ 裡的比值顯示到「取上整後等於答案」為止；這時兩個 ln 也多顯示一位
      const ratioTex = txCeilArg(ratio, nEps)
      const kq = shownSig(ratioTex) > 5 ? shownSig(ratioTex) + 1 : 5
      const exact = Math.abs(ratio - Math.round(ratio)) <= 1e-9 * Math.max(1, Math.round(ratio))
      const notes = [
        R`驗算：$|p|^{${nEps}}=${tn(absP ** nEps, 3)}\le\varepsilon=${tx(eps)}$${nEps > 1 ? R`，而少一步 $|p|^{${nEps - 1}}=${tn(absP ** (nEps - 1), 3)}>\varepsilon$` : ''}。`,
        R`同一件事的另一種寫法：$n_\varepsilon\approx\tau\ln(1/\varepsilon)=${tn(tau)}\times${tn(-lnEps)}=${tn(-tau * lnEps)}$。`,
      ]
      if (p < 0) notes.push(R`$p<0$：誤差每一步變號（震盪收斂），但縮小的速度只看 $|p|$，和 $p=+${tn(absP)}$ 一樣快。`)
      if (exact) notes.push(R`比值恰為整數：$|p|^{${nEps}}$ 剛好等於 $\varepsilon$，第 $${nEps}$ 步正好到達門檻，不必再多一步。`)
      else if (Math.abs(ratio - Math.round(ratio)) < 0.02) notes.push(R`比值 $${tn(ratio, 6)}$ 非常接近整數：手算時 $\ln$ 多保留幾位，否則進位可能差一步。`)
      return {
        steps: [
          { tex: R`x^2=${txSq(x)}=${tx(x2)}`, why: '輸入的平方。' },
          {
            tex: R`p=1-\mu x^2=1-${txP(mu)}\times${tx(x2)}=1-${txP(mx2, kp)}=${tx(p, sP)}`,
            why: R`pole：誤差每一步乘上的倍數（F-03.2）。先乘出 $\mu x^2$，再用 1 去減；$\mu x^2$ 很小時 $p$ 很接近 1，要多寫幾位。`,
          },
          { tex: R`|p|=|${tx(p, sP)}|=${tx(absP, sP)}`, why: R`縮小的速度只看大小；$0<|p|<1$ 才會收斂。` },
          { tex: R`\ln|p|=${txLn(absP, sP)}=${tx(lnP, kq)}`, why: R`計算機按 $\ln$（自然對數，不是 $\log_{10}$）。$|p|<1$ 所以一定是負數。` },
          {
            tex: R`\tau=\frac{-1}{\ln|p|}=\frac{-1}{${tx(lnP, kq)}}=${tx(tau)}\ \text{samples}`,
            why: R`時間常數：每過 $\tau$ 步，誤差乘上 $e^{-1}\approx0.368$。`,
          },
          { tex: R`\ln\varepsilon=${txLn(eps)}=${tx(lnEps, kq)}`, why: R`$\varepsilon=10^{-k}$ 時 $\ln\varepsilon=-k\ln10=-2.3026\,k$。` },
          {
            tex: R`\frac{\ln\varepsilon}{\ln|p|}=\frac{${tx(lnEps, kq)}}{${tx(lnP, kq)}}=${ratioTex}`,
            why: R`解 $|p|^n\le\varepsilon$：兩邊取 $\ln$ 後除以負數 $\ln|p|$，不等號反向，得 $n\ge$ 這個比值。`,
          },
          { tex: R`n_\varepsilon=\lceil ${ratioTex}\rceil=${txInt(nEps)}`, why: '步數是整數：無條件進位（上高斯）；比值本身就是整數時不用再加一步。' },
        ],
        results: [
          { symbol: 'p', label: 'pole', value: p },
          { symbol: R`\tau`, label: '時間常數', value: tau, unit: R`\text{samples}` },
          { symbol: R`n_\varepsilon`, label: '所需步數（整數）', value: nEps, unit: R`\text{步}`, tolerance: { abs: 1e-6, rel: 0 } },
        ],
        notes,
      }
    },
    tips: [
      R`$\ln$ 是計算機上的「ln」鍵；若只有 $\log_{10}$，用 $\ln y=2.3026\,\log_{10}y$ 換算（比值 $\ln\varepsilon/\ln|p|=\log_{10}\varepsilon/\log_{10}|p|$ 不受影響）。`,
      R`$|p|$ 接近 1（$\mu x^2$ 很小）時可用近似 $\ln|p|\approx-\mu x^2$，即 $\tau\approx1/(\mu x^2)$；相對誤差約 $\mu x^2/2$（$\mu x^2=0.1$ 時約 5%）。`,
      R`範例數字（$x=2,\ \mu=0.1$，$p=0.6$）：$\tau=1.958$ samples，降到 $10^{-3}$ 要 $\lceil13.52\rceil=14$ 步（Fixed-x Explorer 的「執行至收斂」會把步數設成同一個數，測試 T02）。`,
      R`單位：$\tau$ 與 $n_\varepsilon$ 以 sample（一次 LMS 更新）計；乘上更新週期就換成秒。$\mu x^2$、$p$、$\varepsilon$ 都無因次。`,
    ],
  },

  /* ───────────── HC-03.3：離散 code 的動差與 mean 界 ───────────── */
  {
    id: 'HC-03.3',
    title: R`你的 code 的 $P_x$、$M_4$、$\kappa$ 與 mean 界`,
    page: PAGE,
    formulaId: 'F-03.5',
    formulaTex: R`\begin{gathered}P_x=E[x^2]=\frac15\sum_{i=1}^{5}x_i^2,\qquad M_4=E[x^4]=\frac15\sum_{i=1}^{5}x_i^4,\qquad \kappa=\frac{M_4}{P_x^2}\\[4pt] E[\delta_{n+1}]=(1-\mu P_x)\,E[\delta_n]\ \Rightarrow\ 0<\mu<\mu_\text{mean}=\frac{2}{P_x}\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      ...[-2, -1, 0, 1, 2].map((d, i) => ({
        key: `x${i + 1}`,
        symbol: `x_${i + 1}`,
        label: `第 ${i + 1} 個取值（等機率）`,
        default: d,
        min: -100,
        max: 100,
        practice: { choices: [-3, -2, -1, 0, 1, 2, 3] },
      })),
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.25, min: -10, max: 100, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.5] } },
    ],
    validate: ({ x1, x2, x3, x4, x5 }) =>
      [x1, x2, x3, x4, x5].every((v) => v === 0)
        ? R`五個取值都是 0：$P_x=E[x^2]=0$，$x$ 恆為 0，$e_n\equiv0$、$w$ 永遠不更新（沒有激勵、$a$ 不可辨識），$\mu_\text{mean}=2/P_x$ 沒有定義。請至少填一個非零的值。`
        : null,
    solve: ({ x1, x2, x3, x4, x5, mu }) => {
      const xs = [x1, x2, x3, x4, x5]
      const dist: XDist = { kind: 'list', values: xs }
      const m = xMoments(dist) // P_x、M_4、κ
      const b = stabilityBounds(dist) // mean 界、MS 界
      const sq = xs.map((v) => v * v)
      const q4 = sq.map((v) => v * v)
      const s2 = sq.reduce((s, v) => s + v, 0)
      const s4 = q4.reduce((s, v) => s + v, 0)
      const Px2 = m.Px * m.Px
      const muPx = mu * m.Px
      const pole = snap(meanPole(mu, m.Px), 1, muPx)
      const kp = sigFor(pole, 1, muPx)
      const absPole = Math.abs(pole)
      return {
        steps: [
          {
            tex: R`x_i^2:\quad ${seq(xs.map((v) => txSq(v)))}\;=\;${seq(sq.map((v) => tx(v)))}`,
            why: '每個取值各自平方；負號消失。',
          },
          {
            tex: R`P_x=E[x^2]=\frac{${sq.map((v) => tx(v)).join('+')}}{5}=\frac{${tx(s2)}}{5}=${tx(m.Px)}`,
            why: R`等機率 $\Rightarrow$ 期望值就是直接平均：加起來除以 5。這是輸入功率。`,
          },
          {
            tex: R`x_i^4=(x_i^2)^2:\quad ${seq(sq.map((v) => txSq(v)))}\;=\;${seq(q4.map((v) => tx(v)))}`,
            why: R`四次方不用重算：把上一步的 $x_i^2$ 再平方一次。`,
          },
          { tex: R`M_4=E[x^4]=\frac{${q4.map((v) => tx(v)).join('+')}}{5}=\frac{${tx(s4)}}{5}=${tx(m.M4)}`, why: '四階動差：同樣加起來除以 5。' },
          { tex: R`P_x^2=${txSq(m.Px)}=${tx(Px2)}`, why: R`算 $\kappa$ 要用的分母。` },
          {
            tex: R`\kappa=\frac{M_4}{P_x^2}=\frac{${tx(m.M4)}}{${tx(Px2)}}=${tx(m.kurtosis)}`,
            why: R`kurtosis（對原點的動差比）：$x^2$ 的起伏有多劇烈；$|x|$ 為常數時恰為 1。`,
          },
          { tex: R`\mu_\text{mean}=\frac{2}{P_x}=\frac{2}{${tx(m.Px)}}=${tx(b.meanMax)}`, why: R`mean 界（F-03.5）：和固定 $x$ 的 $2/x^2$ 同一個形式，只是 $x^2$ 換成平均功率 $P_x$。` },
          {
            tex: R`1-\mu P_x=1-${txP(mu)}\times${tx(m.Px)}=1-${txP(muPx, kp)}=${tx(pole)}`,
            why: R`mean 因子：$E[\delta_n]$ 每一步乘上的倍數。先乘出 $\mu P_x$，再用 1 去減。`,
          },
        ],
        results: [
          { symbol: 'P_x', label: '輸入功率', value: m.Px },
          { symbol: 'M_4', label: '四階動差', value: m.M4 },
          { symbol: R`\kappa`, label: 'kurtosis', value: m.kurtosis },
          { symbol: R`\mu_\text{mean}`, label: 'mean 界', value: b.meanMax },
          { symbol: R`1-\mu P_x`, label: 'mean 因子', value: pole },
        ],
        notes: [
          mu === 0
            ? R`$\mu=0$：完全不更新，$E[\delta_n]$ 永遠等於 $\delta_0$。`
            : mu < 0
              ? R`$\mu<0$：更新方向反了，$1-\mu P_x=${tn(pole)}>1$，$E[\delta_n]$ 同號放大（mean 發散）。`
              : near(absPole, 1)
                ? R`$|1-\mu P_x|=1$：恰在 mean 邊界（$\mu=\mu_\text{mean}$），$E[\delta_n]$ 每步變號、大小不變。`
                : absPole < 1
                  ? R`$|1-\mu P_x|=${tn(absPole)}<1$：mean 收斂，$E[\delta_n]=(${tn(pole)})^n\delta_0\to0$${pole < 0 ? '（每步變號）' : ''}。但這只是「平均」：正負可以互相抵消，下一節還要看均方。`
                  : R`$|1-\mu P_x|=${tn(absPole)}>1$：mean 發散（$\mu>\mu_\text{mean}=${tn(b.meanMax)}$）。`,
          R`下一節會推出 mean-square 界 $\mu_\text{MS}=2P_x/M_4=\mu_\text{mean}/\kappa=${tn(b.msMax)}$：比 mean 界嚴格 $\kappa=${tn(m.kurtosis)}$ 倍。把這裡的 $P_x$、$M_4$ 抄到 HC-03.4 就能驗算。`,
        ],
      }
    },
    tips: [
      R`「等機率」所以期望值就是算術平均。若你的 code 某個值比較常出現，就把它重複填幾格（例如 $\{0,0,0,1,-1\}$）。`,
      R`範例數字是五階 code $\{-2,-1,0,1,2\}$：$P_x=10/5=2$、$M_4=34/5=6.8$、$\kappa=1.7$、$\mu_\text{mean}=1$。本章反覆用到的稀疏 code $\{0\times9,\ 3\}$（10 個取值）：$P_x=9/10=0.9$、$M_4=81/10=8.1$、$\kappa=10$；$\pm1$ code：$P_x=M_4=\kappa=1$。`,
      R`這裡的 $\kappa$ 不減平均（對原點的動差）：code 帶 DC 偏移時，它和統計課本的 kurtosis 不同。`,
      R`單位：$P_x$ 是 $[x]^2$、$M_4$ 是 $[x]^4$，$\kappa$ 無因次；$\mu$ 與 $\mu_\text{mean}$ 的單位是 $1/[x]^2$，所以 $\mu P_x$ 無因次。`,
    ],
  },

  /* ───────────── HC-03.4：g(μ)、MS 界、E[δ_n²] ───────────── */
  {
    id: 'HC-03.4',
    title: R`MSD 每步因子 $g(\mu)$、mean-square 界與 $n$ 步後的 $E[\delta_n^2]$`,
    page: PAGE,
    formulaId: 'F-03.6',
    formulaTex: R`g(\mu)=1-2\mu P_x+\mu^2M_4,\qquad E[\delta_n^2]=g^{\,n}\,\delta_0^2,\qquad g<1\iff 0<\mu<\mu_\text{MS}=\frac{2P_x}{M_4}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'Px', symbol: 'P_x', label: '輸入功率（二階動差）', default: 1, min: 0, max: 1e6, practice: { choices: [1, 2] } },
      { key: 'M4', symbol: 'M_4', label: '四階動差', default: 3, min: 0, max: 1e12, practice: { choices: [4, 5, 6, 8, 12] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.5, min: -10, max: 100, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.5] } },
      { key: 'd0', symbol: R`\delta_0`, label: '初始參數誤差（真實值減估計值）', default: 1, min: -1000, max: 1000, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'n', symbol: 'n', label: '更新幾步', unit: R`\text{步}`, default: 5, min: 1, max: 200, integer: true, practice: { choices: [2, 3, 4] } },
    ],
    validate: ({ Px, M4, mu, d0, n }) => {
      const e = momentError(Px, M4)
      if (e) return e
      const g = meanSquareFactor(mu, Px, M4)
      const msd = msdAfterSteps(mu, Px, M4, n, d0)
      // gⁿ 溢位（發散太快）或下溢成 0（g ≠ 0 卻算出 0）：計算機同樣算不出來
      if (!Number.isFinite(msd) || (msd === 0 && d0 !== 0 && snap(g, 1, 2 * mu * Px, mu * mu * M4) !== 0)) return MSG_RANGE
      return null
    },
    solve: ({ Px, M4, mu, d0, n }) => {
      const muMs = meanSquareMuMax(Px, M4)
      const lin = 2 * mu * Px
      const mu2 = mu * mu
      const quad = mu2 * M4
      // g = 1 − 2μP_x + μ²M_4 恰為 0（|x| 為常數、μ = 1/P_x）時，double 可能留下 1e−17 的殘渣：手算是 0
      const g = snap(meanSquareFactor(mu, Px, M4), 1, lin, quad)
      const pole = meanPole(mu, Px)
      const msd = g === 0 ? 0 : msdAfterSteps(mu, Px, M4, n, d0)
      const gn = Math.pow(g, n)
      const d02 = d0 * d0
      const muOpt = muMs / 2
      // g 要顯示幾位，gⁿ 才算得準（相對誤差放大 n 倍）；加減的運算元也跟著多顯示
      const sG = sigPow(n)
      const kg = sigForN(sG, g, 1, lin, quad)
      const notes: string[] = []
      if (near(g, 1)) notes.push(R`$g=1$：恰在 mean-square 邊界（$\mu=\mu_\text{MS}$ 或 $\mu=0$），$E[\delta_n^2]$ 不增不減。`)
      else if (g < 1) notes.push(R`$g=${tn(g)}<1$：mean-square 收斂（$0<\mu<\mu_\text{MS}=${tn(muMs)}$），MSD 每一步乘上 $g$。`)
      else
        notes.push(
          R`$g=${tn(g)}>1$：MSD 發散（$\mu$ 不在 $0<\mu<\mu_\text{MS}=${tn(muMs)}$ 內）。${Math.abs(pole) < 1 ? R`但 mean 因子 $1-\mu P_x=${tn(pole)}$ 仍在單位圓內——「平均收斂」不代表「均方穩定」。` : ''}`,
        )
      notes.push(R`均方收斂最快的步長是 $\mu^\ast=P_x/M_4=${tn(muOpt)}$（MS 界的一半），此時 $g^\ast=1-P_x^2/M_4=${tn(meanSquareFactor(muOpt, Px, M4))}$（F-03.13）。`)
      return {
        steps: [
          {
            tex: R`\mu_\text{MS}=\frac{2P_x}{M_4}=\frac{2\times${tx(Px)}}{${tx(M4)}}=\frac{${tx(2 * Px)}}{${tx(M4)}}=${tx(muMs)}`,
            why: R`mean-square 界（F-03.7）：等於 mean 界 $2/P_x$ 除以 $\kappa=M_4/P_x^2$。`,
          },
          { tex: R`2\mu P_x=2\times${txP(mu)}\times${tx(Px)}=${tx(lin)}`, why: R`$g$ 的一次項：讓誤差縮小的部分。` },
          {
            tex: R`\mu^2M_4=${txSq(mu)}\times${tx(M4)}=${tx(mu2)}\times${tx(M4)}=${tx(quad)}`,
            why: R`$g$ 的二次項：$x^2$ 的起伏（偶爾很大的 $x$）把誤差放大的部分。`,
          },
          {
            tex: R`g=1-2\mu P_x+\mu^2M_4=1-${txP(lin, kg)}+${txP(quad, kg)}=${tx(g, sG)}`,
            why: R`MSD 每步因子（F-03.6）。$x_n$ iid 時 $x_n$ 與 $\delta_n$ 自動獨立，所以這條遞迴是精確式，不是近似（勘誤 E38）。`,
          },
          { tex: R`g^{${n}}=${txPow(g, n, sG)}=${tn(gn)}`, why: R`連乘 $n$ 次（或用計算機的 $x^y$ 鍵）。` },
          { tex: R`\delta_0^2=${txSq(d0)}=${tx(d02)}`, why: '初始誤差的平方。' },
          {
            tex: R`E[\delta_{${n}}^2]=g^{${n}}\,\delta_0^2=${tn(gn)}\times${tx(d02)}=${tn(msd)}`,
            why: R`等比數列：$n$ 步後的係數均方偏差 MSD（量的是 $w$ 離 $a$ 多遠，不是 MSE 成本 $E[e^2]$，勘誤 E42）。`,
          },
        ],
        results: [
          { symbol: R`\mu_\text{MS}`, label: 'mean-square 界', value: muMs },
          { symbol: 'g', label: 'MSD 每步因子', value: g },
          { symbol: R`E[\delta_{${n}}^2]`, label: `${n} 步後的 MSD`, value: msd, tolerance: { rel: 0.02, abs: 1e-12 } },
        ],
        notes,
      }
    },
    tips: [
      R`$g$ 是 $\mu$ 的二次式：先分別算 $2\mu P_x$ 與 $\mu^2M_4$，最後才做一次加減，比較不會算錯。`,
      R`常見分布：Gaussian $\mathcal N(0,\sigma^2)$：$P_x=\sigma^2$、$M_4=3\sigma^4$；Uniform $U(-c,c)$：$P_x=c^2/3$、$M_4=c^4/5$；$\pm A$：$P_x=A^2$、$M_4=A^4$。你自己的 code 用 HC-03.3 算。`,
      R`範例數字（$P_x=1,\ M_4=3,\ \mu=0.5,\ n=5$）：$g=0.75$、$E[\delta_5^2]=0.75^5\approx0.2373$。T03 的清單 $\mu=0.3,\ 0.6,\ 2/3,\ 0.7,\ 1,\ 1.9$ 對應 $g=0.67,\ 0.88,\ 1,\ 1.07,\ 2,\ 8.03$——把 $\mu$ 換成這些值逐一驗算。`,
      R`單位：$g$ 無因次（$\mu$ 是 $1/[x]^2$、$P_x$ 是 $[x]^2$、$M_4$ 是 $[x]^4$）；$E[\delta_n^2]$ 的單位是 $[\delta_0]^2$，開根號才是和 $w$ 同單位的 RMS。`,
    ],
  },

  /* ───────────── HC-03.5：有雜訊的穩態 MSD／MSE ───────────── */
  {
    id: 'HC-03.5',
    title: R`有量測雜訊：穩態 $\text{MSD}_\infty$、係數 RMS 與 MSE`,
    page: PAGE,
    formulaId: 'F-03.11',
    formulaTex: R`\text{MSD}_\infty=\frac{\mu P_x\sigma_v^2}{2P_x-\mu M_4},\qquad \text{RMS}=\sqrt{\text{MSD}_\infty},\qquad E[e^2]=P_x\,\text{MSD}_\infty+\sigma_v^2`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'Px', symbol: 'P_x', label: '輸入功率（二階動差）', default: 4, min: 0, max: 1e6, practice: { choices: [1, 2, 4] } },
      { key: 'M4', symbol: 'M_4', label: '四階動差', default: 16, min: 0, max: 1e12, practice: { choices: [16, 20, 32] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.1, min: -10, max: 100, practice: { choices: [0.01, 0.02, 0.05, 0.1] } },
      { key: 'sv', symbol: R`\sigma_v`, label: '量測雜訊的標準差', default: 1, min: 0, max: 1e6, practice: { choices: [0.1, 0.5, 1, 2] } },
    ],
    validate: ({ Px, M4, mu, sv }) => {
      const e = momentError(Px, M4)
      if (e) return e
      if (!(mu > 0)) return R`$\mu\le0$：不更新（$\mu=0$）或更新方向反了（$\mu<0$），不會有穩態可言。請輸入 $\mu>0$。`
      const muMs = meanSquareMuMax(Px, M4)
      const den = snap(2 * Px - mu * M4, 2 * Px, mu * M4)
      if (!(den > 0) || !Number.isFinite(steadyStateMsd(mu, Px, M4, sv).msd))
        return R`分母 $2P_x-\mu M_4=${tn(den)}\le0$，也就是 $\mu\ge\mu_\text{MS}=2P_x/M_4=${tn(muMs)}$：$g\ge1$，有雜訊時穩態 MSD 是無限大，沒有有限的 RMS 可算（此時路徑仍可能收斂到一個 heavy-tail 的穩態分布，勘誤 E14）。請把 $\mu$ 降到 $${tn(muMs)}$ 以下。`
      return null
    },
    solve: ({ Px, M4, mu, sv }) => {
      const { msd, mse } = steadyStateMsd(mu, Px, M4, sv)
      const sv2 = sv * sv
      const numer = mu * Px * sv2
      const muM4 = mu * M4
      const twoPx = 2 * Px
      const den = twoPx - muM4
      const kd = sigFor(den, twoPx, muM4)
      const rms = Math.sqrt(msd)
      const pxMsd = Px * msd
      const small = (mu * sv2) / 2
      const notes =
        sv === 0
          ? [R`$\sigma_v=0$：沒有雜訊，穩態 MSD 為 0（誤差完全收斂）；$E[e^2]$ 也是 0。`]
          : [
              R`小 $\mu$ 近似：$\text{MSD}_\infty\approx\mu\sigma_v^2/2=${tn(small)}$（與分布無關）；精確值是它的 $${tn(msd / small, 4)}$ 倍，差別來自分母裡的 $\mu M_4$。`,
              R`雜訊地板是 $\sigma_v^2=${tn(sv2)}$；係數抖動讓 MSE 多出 $P_x\,\text{MSD}_\infty=${tn(pxMsd)}$（多 $${tn((100 * pxMsd) / sv2, 3)}\%$，稱為 misadjustment）。`,
            ]
      return {
        steps: [
          { tex: R`\sigma_v^2=${txSq(sv)}=${tx(sv2)}`, why: '雜訊功率（變異數）。' },
          { tex: R`\mu P_x\sigma_v^2=${tx(mu)}\times${tx(Px)}\times${tx(sv2)}=${tx(numer)}`, why: R`分子：每一步由雜訊注入的 MSD 是 $\mu^2P_x\sigma_v^2$，這裡已先約掉一個 $\mu$。` },
          { tex: R`\mu M_4=${tx(mu)}\times${tx(M4)}=${tx(muM4)}`, why: '分母的第二項。' },
          {
            tex: R`2P_x-\mu M_4=2\times${tx(Px)}-${tx(muM4, kd)}=${tx(twoPx, kd)}-${tx(muM4, kd)}=${tx(den)}`,
            why: R`分母 $=(1-g)/\mu$；它 $>0$ 才有有限的穩態（$\mu<\mu_\text{MS}$）。`,
          },
          {
            tex: R`\text{MSD}_\infty=\frac{\mu P_x\sigma_v^2}{2P_x-\mu M_4}=\frac{${tx(numer)}}{${tx(den)}}=${tx(msd)}`,
            why: R`不動點：每步注入量 $\div(1-g)$（F-03.11）。`,
          },
          { tex: R`\sqrt{\text{MSD}_\infty}=\sqrt{${tx(msd)}}=${tx(rms)}`, why: R`計算機按 $\sqrt{\ }$：係數 $w$ 在 $a$ 附近抖動的 RMS，單位和 $a$、$w$ 相同。` },
          {
            tex: R`E[e^2]=P_x\,\text{MSD}_\infty+\sigma_v^2=${tx(Px)}\times${tx(msd)}+${tx(sv2)}=${tx(pxMsd)}+${tx(sv2)}=${tx(mse)}`,
            why: R`MSE 與 MSD 的換算（勘誤 E42）：預測誤差 $e=\delta x+v$，兩項獨立所以功率相加。先乘、再加。`,
          },
        ],
        results: [
          { symbol: R`\text{MSD}_\infty`, label: '穩態係數均方偏差', value: msd },
          { symbol: R`\sqrt{\text{MSD}_\infty}`, label: '係數的 RMS 誤差', value: rms },
          { symbol: 'E[e^2]', label: '穩態 MSE', value: mse },
        ],
        notes,
      }
    },
    tips: [
      R`固定 $x$ 時 $P_x=x^2$、$M_4=x^4$，公式退化成 $\text{MSD}_\infty=\mu\sigma_v^2/(2-\mu x^2)$。範例數字就是固定 $x=2$（$P_x=4,\ M_4=16$）、$\mu=0.1$、$\sigma_v=1$：$0.4/6.4=0.0625$、RMS $0.25$、MSE $1.25$（思考題 5）。`,
      R`先算分子、再算分母、最後才相除；$\sqrt{\ }$ 是唯一需要計算機的一步。`,
      R`小 $\mu$ 時，$\mu$ 加倍則 $\text{MSD}_\infty$ 大約加倍（RMS 變 $\sqrt2$ 倍），但收斂的時間常數大約減半——這就是後面做 RMS 預算（第 12、14 章）時「速度 vs 雜訊」的取捨。`,
      R`單位：$\sigma_v$ 與 $y$ 同單位；$\text{MSD}_\infty$ 是 $[w]^2=([y]/[x])^2$，開根號後的 RMS 與 $w$ 同單位；$E[e^2]$ 是 $[y]^2$。本題的數字已正規化。`,
    ],
  },

  /* ───────────── HC-03.6：稀疏 code 的三種判據 ───────────── */
  {
    id: 'HC-03.6',
    title: R`稀疏 code：mean、mean-square、almost-sure 三種判據各算一次`,
    page: PAGE,
    formulaId: 'F-03.10',
    formulaTex: R`\begin{gathered}x=\begin{cases}A&\text{機率 }1/K\\0&\text{機率 }1-1/K\end{cases}\qquad P_x=\frac{A^2}{K},\quad M_4=\frac{A^4}{K}\\[4pt] \lambda=E\ln|1-\mu x^2|=\frac{1}{K}\ln|1-\mu A^2|\ \le\ \tfrac12\ln g,\qquad g=1-2\mu P_x+\mu^2M_4\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'A', symbol: 'A', label: '非零取值的大小', default: 3, min: -100, max: 100, practice: { choices: [1, 2, 3] } },
      { key: 'K', symbol: 'K', label: '平均每幾筆出現一次', unit: R`\text{筆}`, default: 10, min: 2, max: 1000, integer: true, practice: { choices: [2, 4, 5, 10] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', default: 0.5, min: -10, max: 100, practice: { choices: [0.1, 0.2, 0.25, 0.5, 1] } },
    ],
    validate: ({ A, mu }) => {
      if (A === 0) return R`$A=0$：$x$ 恆為 0，$P_x=0$，$w$ 永遠不更新（沒有激勵、$a$ 不可辨識）。請輸入非零的 $A$。`
      if (classifyPole(fixedXPole(mu, A)) === 'deadbeat')
        return R`$1-\mu A^2=0$：抽到 $A$ 的那一步誤差直接歸零，$\ln 0=-\infty$，所以 $\lambda=-\infty$（路徑在有限步內恰好收斂）。這是 deadbeat 的特例，沒有有限的 $\lambda$ 可算；請換一個 $\mu\ne1/A^2=${tn(1 / (A * A))}$。`
      return null
    },
    solve: ({ A, K, mu }) => {
      const dist: XDist = { kind: 'list', values: [...new Array<number>(K - 1).fill(0), A] }
      const m = xMoments(dist)
      const f = stabilityFactors(mu, dist) // meanPole、g、λ、e^λ
      const A2 = A * A
      const A4 = A2 * A2
      const muPx = mu * m.Px
      const lin = 2 * mu * m.Px
      const mu2 = mu * mu
      const quad = mu2 * m.M4
      const muA2 = mu * A2
      const fA = fixedXPole(mu, A)
      const absFA = Math.abs(fA)
      const lnFA = Math.log(absFA)
      const lnG = Math.log(f.g)
      const halfLnG = 0.5 * lnG
      const meanP = snap(f.meanPole, 1, muPx)
      const km = sigFor(meanP, 1, muPx)
      // g 與 f_A 之後要取 ln：很接近 1 時多顯示幾位，加減的運算元也跟著多顯示
      const sG = sigLn(f.g)
      const kg = sigForN(sG, f.g, 1, lin, quad)
      const sF = sigLn(absFA)
      const kf = sigForN(sF, fA, 1, muA2)
      const mean = tri(Math.abs(meanP), 1)
      const ms = tri(f.g, 1)
      const as = tri(f.lambda, 0)
      const notes = [
        R`mean：$|1-\mu P_x|=${tn(Math.abs(meanP))}\ \Rightarrow$ ${TRI_TEXT[mean]}；mean-square：$g=${tn(f.g)}\ \Rightarrow$ ${TRI_TEXT[ms]}；almost-sure：$\lambda=${tn(f.lambda)}\ \Rightarrow$ ${TRI_TEXT[as]}。`,
        R`Jensen 檢查：$\lambda=${tn(f.lambda)}\le\tfrac12\ln g=${tn(halfLnG)}$ ✓（對任何分布都成立，所以 mean-square 收斂一定保證路徑收斂）。`,
      ]
      if (mean === 'ok' && as === 'bad')
        notes.push(R`mean 收斂、路徑卻發散：$\delta_n=(${tn(fA)})^{k}\delta_0$（$k$ 是抽到 $A$ 的次數），$E[\delta_n]$ 變小是靠正負號互相抵消，$|\delta_n|$ 其實越來越大——mean 穩定不保證路徑收斂。`)
      if (ms === 'bad' && as === 'ok') notes.push(R`均方發散、路徑卻收斂：$E[\delta_n^2]$ 被機率極小、數值極大的少數路徑主導（勘誤 E14）；不能宣稱均方穩定。`)
      if (mean === 'bad' && as === 'ok') notes.push(R`連 $E[\delta_n]$ 都發散，但典型路徑仍收斂：almost-sure 與 mean 沒有一般的大小順序。`)
      if (as === 'edge') notes.push(R`$\lambda=0$：$|f_A|=1$，每一步都只改變正負號、不改變大小，$|\delta_n|$ 永遠等於 $|\delta_0|$。`)
      return {
        steps: [
          { tex: R`A^2=${txSq(A)}=${tx(A2)}`, why: R`抽到 $A$ 時的 $x^2$。` },
          { tex: R`P_x=\frac{A^2}{K}=\frac{${tx(A2)}}{${txInt(K)}}=${tx(m.Px)}`, why: R`$K$ 筆裡平均只有 1 筆是 $A$、其餘是 0：平均功率就是除以 $K$。` },
          {
            tex: R`M_4=\frac{A^4}{K}=\frac{${txSq(A2)}}{${txInt(K)}}=\frac{${tx(A4)}}{${txInt(K)}}=${tx(m.M4)}`,
            why: R`四階動差同理（$A^4$ 就是 $A^2$ 再平方）；$\kappa=M_4/P_x^2=K$，code 越稀疏 $\kappa$ 越大。`,
          },
          { tex: R`1-\mu P_x=1-${txP(mu)}\times${tx(m.Px)}=1-${txP(muPx, km)}=${tx(meanP)}`, why: R`① mean 判據：絕對值 $<1$ 才收斂。` },
          { tex: R`2\mu P_x=2\times${txP(mu)}\times${tx(m.Px)}=${tx(lin)}`, why: R`$g$ 的一次項。` },
          {
            tex: R`\mu^2M_4=${txSq(mu)}\times${tx(m.M4)}=${tx(mu2)}\times${tx(m.M4)}=${tx(quad)}`,
            why: R`$g$ 的二次項：稀疏 code 的 $M_4$ 很大，這一項很快就超過一次項。`,
          },
          { tex: R`g=1-2\mu P_x+\mu^2M_4=1-${txP(lin, kg)}+${txP(quad, kg)}=${tx(f.g, sG)}`, why: R`② mean-square 判據：$g<1$ 才收斂。` },
          {
            tex: R`f_A=1-\mu A^2=1-${txP(mu)}\times${tx(A2)}=1-${txP(muA2, kf)}=${tx(fA, sF)}`,
            why: R`抽到 $A$ 的那一步，誤差乘上的倍數；抽到 0 的那幾步乘 1（$\ln1=0$，對 $\lambda$ 沒有貢獻）。`,
          },
          { tex: R`\ln|f_A|=${txLn(absFA, sF)}=${tx(lnFA)}`, why: R`計算機按 $\ln$；先取絕對值。` },
          {
            tex: R`\lambda=\frac{1}{K}\ln|f_A|=\frac{${tx(lnFA)}}{${txInt(K)}}=${tx(f.lambda)}`,
            why: R`③ almost-sure 判據（Lyapunov 指數）：期望值 $=\tfrac1K\ln|f_A|+\tfrac{K-1}{K}\ln1$；$\lambda<0$ 才收斂。`,
          },
          {
            tex: R`\tfrac12\ln g=\tfrac12\times${txLn(f.g, sG)}=\tfrac12\times${txP(lnG)}=${tx(halfLnG)}`,
            why: R`Jensen 不等式的右邊：一定 $\ge\lambda$（F-03.10）。先按 $\ln$，再除以 2。`,
          },
          { tex: R`e^{\lambda}=e^{${tx(f.lambda)}}=${tx(f.geoMean)}`, why: R`計算機按 $e^x$：典型路徑每一步的幾何平均倍率；$>1$ 代表幾乎每條路徑都在變大。` },
        ],
        results: [
          { symbol: R`1-\mu P_x`, label: 'mean 因子', value: meanP },
          { symbol: 'g', label: 'MSD 每步因子', value: f.g },
          { symbol: R`\lambda`, label: 'Lyapunov 指數', value: f.lambda, unit: R`\text{nat/sample}`, tolerance: { rel: 0.02, abs: 1e-4 } },
          { symbol: R`e^{\lambda}`, label: '典型路徑的每步倍率', value: f.geoMean },
        ],
        notes,
      }
    },
    tips: [
      R`範例數字（$A=3,\ K=10,\ \mu=0.5$）就是本章的稀疏 code $\{0\times9,\ 3\}$：$1-\mu P_x=0.55$（mean 收斂）、$g=2.125$、$\lambda=\tfrac1{10}\ln3.5=0.1253>0$（路徑發散）——思考題 4。`,
      R`$\ln$ 與 $e^x$ 是計算機上的兩個鍵；$\ln|f|$ 要先取絕對值（$f_A$ 常常是負的）。`,
      R`心算檢查用的近似：$u=\mu A^2$ 很小時 $\ln(1-u)\approx-u-u^2/2$（$u=0.1$ 時誤差約 0.3%）；$|\lambda|\le0.1$ 時 $e^{\lambda}\approx1+\lambda$（誤差 $<0.6\%$）。$u$ 不小時這兩個近似都不能用，請按計算機。`,
      R`一般的有限 code（每個值等機率）：$\lambda$ 就是各個 $\ln|1-\mu x_i^2|$ 的算術平均——5 個取值就是 5 個 $\ln$ 加起來除以 5。$|x|$ 為常數（$\pm A$）時三個判據都只看 $|1-\mu A^2|$。`,
      R`單位：$\lambda$ 是「每一步的平均對數倍率」，用自然對數所以是 nat/sample；乘 $8.686$ 換成 dB/sample（$20\log_{10}e$），除以 $2.3026$ 換成 decade/sample。`,
    ],
  },

  /* ───────────── HC-03.7：CLT 預測 ───────────── */
  {
    id: 'HC-03.7',
    title: R`CLT 預測：跑 $n$ 步之後，多少比例的路徑已經收斂？`,
    page: PAGE,
    formulaId: 'F-03.18',
    formulaTex: R`\begin{gathered}\ln\frac{|\delta_n|}{|\delta_0|}\approx\mathcal N\big(n\lambda,\ ns^2\big)\ \Rightarrow\ z=\frac{\ln\varepsilon-n\lambda}{s\sqrt n},\qquad P\big(|\delta_n|<\varepsilon|\delta_0|\big)\approx\Phi(z)\\[4pt] n_{90}=\Big\lceil\Big(\frac{z_{0.9}\,s}{\lambda}\Big)^{2}\Big\rceil\quad(\lambda<0,\ z_{0.9}=1.2816)\end{gathered}`,
    level: 'research',
    claim: 'approx',
    inputs: [
      { key: 'lam', symbol: R`\lambda`, label: 'Lyapunov 指數（每步平均對數縮放率）', unit: R`\text{nat/sample}`, default: -0.1162, min: -100, max: 100, practice: { choices: [-0.2, -0.1, -0.05] } },
      { key: 's', symbol: 's', label: '每步對數增量的標準差', unit: R`\text{nat}`, default: 1.206, min: 0, max: 100, practice: { choices: [1, 1.5, 2] } },
      { key: 'n', symbol: 'n', label: '跑幾步', unit: R`\text{步}`, default: 200, min: 1, max: 1e6, integer: true, practice: { choices: [25, 100] } },
      { key: 'eps', symbol: R`\varepsilon`, label: '收斂門檻（相對於初始誤差）', default: 0.001, min: 0, max: 1, practice: { choices: [0.1, 0.01, 0.001] } },
    ],
    validate: ({ lam, s, eps }) => {
      if (!(eps > 0 && eps < 1)) return R`$\varepsilon$ 是「誤差縮小到原來的幾分之幾才算收斂」，必須在 $0<\varepsilon<1$ 之間（例如 $10^{-3}$）。`
      if (!(s > 0)) return R`$s=0$：$\ln|1-\mu x^2|$ 沒有起伏（$|x|$ 為常數），所有路徑完全相同，收斂比例只會是 0 或 1 的階梯，不需要 CLT。請輸入 $s>0$。`
      if (!(lam < 0)) return R`$\lambda\ge0$：典型路徑不會縮小（almost-sure 不收斂），收斂比例隨 $n$ 趨近 0，$n_{90}$ 不存在。本題只處理 $\lambda<0$。`
      return null
    },
    solve: ({ lam, s, n, eps }) => {
      const z = cltZScore(lam, s, n, eps) // (ln ε − nλ)/(s√n)
      const frac = cltConvergedFraction(lam, s, n, eps) // Φ(z)
      const n90raw = cltStepsBelowStart(lam, s, 0.9)
      const n90 = Math.ceil(n90raw)
      const z90 = normInv(0.9)
      const lnEps = Math.log(eps)
      const nLam = n * lam
      const numer = snap(lnEps - nLam, lnEps, nLam)
      const rootN = Math.sqrt(n)
      const sd = s * rootN
      const prod = z90 * s
      const ratio = prod / lam
      // 查表題：z 要寫到小數 4 位，所以前面的中間量多保留一位（6 位有效數字）
      const W = 6
      const kn = sigForN(W, numer, lnEps, nLam)
      const zShown = numer === 0 ? 0 : z
      const zTex = Math.abs(zShown) < 1e4 ? txFixed(zShown, 4) : tn(zShown, 8)
      // ⌈·⌉ 裡的數顯示到「取上整後等於答案」為止；平方前的比值多顯示一位
      const rawTex = txCeilArg(n90raw, n90)
      const kr = shownSig(rawTex) > 5 ? shownSig(rawTex) + 1 : W
      const z90Tex = kr > W ? tn(z90, kr) : tn(z90, 5)
      return {
        steps: [
          { tex: R`\ln\varepsilon=${txLn(eps)}=${tx(lnEps, kn)}`, why: R`門檻取對數；$\varepsilon=10^{-k}$ 時是 $-2.3026\,k$。查表題多保留幾位。` },
          { tex: R`n\lambda=${txInt(n)}\times${txP(lam)}=${tx(nLam)}`, why: R`典型（中位數）路徑的 $\ln|\delta_n/\delta_0|$；這一步是精確的。` },
          {
            tex: R`\ln\varepsilon-n\lambda=${tx(lnEps, kn)}-${txP(nLam, kn)}=${tx(numer, W)}`,
            why: R`門檻比中位數高多少（log 域）；正值表示中位數已經在門檻以下。`,
          },
          { tex: R`\sqrt n=\sqrt{${txInt(n)}}=${tx(rootN, W)}`, why: R`計算機按 $\sqrt{\ }$。` },
          { tex: R`s\sqrt n=${tx(s)}\times${tx(rootN, W)}=${tx(sd, W)}`, why: R`$\ln|\delta_n|$ 的標準差：中心以 $n$ 移動，寬度只以 $\sqrt n$ 變寬。` },
          {
            tex: R`z=\frac{\ln\varepsilon-n\lambda}{s\sqrt n}=\frac{${tx(numer, W)}}{${tx(sd, W)}}=${zTex}`,
            why: '標準化：門檻離中位數幾個標準差。寫到小數 4 位，查表時再四捨五入到 2 位。',
          },
          {
            tex: R`P\big(|\delta_n|<\varepsilon|\delta_0|\big)\approx\Phi(z)=\Phi(${zTex})=${phiTex(frac)}`,
            why: R`查標準常態表（$\Phi$ = 鐘形曲線在 $z$ 左邊的面積）；$z<0$ 時用 $\Phi(-z)=1-\Phi(z)$。沒有表時見下方「手算提示」的近似式。`,
          },
          {
            tex: R`\frac{z_{0.9}\,s}{\lambda}=\frac{${z90Tex}\times${tx(s)}}{${tx(lam)}}=\frac{${tx(prod, kr)}}{${tx(lam)}}=${tx(ratio, kr)}`,
            why: R`$z_{0.9}=\Phi^{-1}(0.9)=1.2816$（查表：左邊面積是 90% 的位置）。先乘、再除。`,
          },
          {
            tex: R`n_{90}=\Big\lceil\Big(\frac{z_{0.9}\,s}{\lambda}\Big)^{2}\Big\rceil=\lceil ${txSq(ratio, kr)}\rceil=\lceil ${rawTex}\rceil=${txInt(n90)}`,
            why: R`解 $n\lambda+z_{0.9}\,s\sqrt n<0$：從這一步起，九成的路徑才「開始」低於起點。先平方、再無條件進位。`,
          },
        ],
        results: [
          { symbol: 'z', label: '門檻離中位數幾個標準差', value: zShown, digits: 4, tolerance: { rel: 0.01, abs: 0.01 } },
          { symbol: R`P\big(|\delta_n|<\varepsilon|\delta_0|\big)`, label: '收斂比例（0–1，CLT 近似）', value: frac, digits: 4, tolerance: { rel: 0.01, abs: 0.01 } },
          { symbol: 'n_{90}', label: '九成路徑低於起點所需步數', value: n90, unit: R`\text{步}`, tolerance: { rel: 0.03, abs: 1 } },
        ],
        notes: [
          R`中位數路徑：$\log_{10}|\delta_n/\delta_0|=n\lambda/\ln10=${tn(nLam / Math.LN10)}$；門檻是 $\log_{10}\varepsilon=${tn(Math.log10(eps))}$。`,
          R`這是 CLT 近似：平均 $n\lambda$ 與變異數 $ns^2$ 是精確的，只有「形狀是常態」是近似；$n$ 只有十幾步、或 $|z|$ 很大（落在尾巴）時可差幾個百分點。`,
        ],
      }
    },
    tips: [
      R`$\lambda$ 與 $s$ 要先由 $x$ 的分布算出。Gaussian 沒有初等封閉式，請查第 5 節的 CLT 表或 Stability Lab 的指標表；$\mathcal N(0,1)$ 的幾個值：${GAUSS_CLT_TABLE.map((r) => R`$\mu=${tn(r.mu)}$：$\lambda=${tn(r.lambda)},\ s=${tn(r.s)}$`).join('；')}。有限個取值的 code 可以直接手算：$\lambda$ 是 $\ln|1-\mu x_i^2|$ 的平均，$s^2$ 是它的變異數。`,
      R`查 $\Phi(z)$：一般統計課本的標準常態表（例 $\Phi(0.96)=0.8315$、$\Phi(1)=0.8413$、$\Phi(2)=0.9772$）；負的 $z$ 用 $\Phi(-z)=1-\Phi(z)$。`,
      R`沒有表時用計算機：$\Phi(z)\approx\dfrac{1}{1+e^{-(1.5976\,z+0.07056\,z^3)}}$，對所有 $z$ 誤差 $<0.0002$；更粗略的 $\dfrac{1}{1+e^{-1.702\,z}}$ 誤差 $<0.01$。$|z|\le0.3$ 時還可以用 $\Phi(z)\approx0.5+0.3989\,z$（誤差 $<0.002$）。`,
      R`範例數字是 Gaussian、$\mu=2$（mean pole 恰為 $-1$）、$n=200$、$\varepsilon=10^{-3}$：$z\approx0.958$、$\Phi\approx83.1\%$——勘誤 E14 的那個 83%（Python Monte Carlo 量到 83.25%）。$n$ 選完全平方數（25、100、400…）時 $\sqrt n$ 可以心算；「換一題」抽出的數字會讓 $|z|$ 落在查表範圍（約 $\pm2$）內。`,
      R`單位：$\lambda$ 是 nat/sample、$s$ 是 nat（每一步的標準差），所以 $n\lambda$ 與 $s\sqrt n$ 都是 nat，$z$ 無因次；$\ln$ 一律是自然對數。`,
    ],
  },

  /* ───────────── HC-03.8：綜合題（Gaussian code 的 sign-off） ───────────── */
  {
    id: 'HC-03.8',
    title: R`綜合題：Gaussian code 的三個界限、你的 $\mu$ 落在哪一區、GMAC 平均 $N$ 筆之後`,
    page: PAGE,
    formulaId: 'F-03.8',
    formulaTex: R`\begin{gathered}x\sim\mathcal N(0,\sigma^2):\quad P_x=\sigma^2,\ \ M_4=3\sigma^4,\qquad \mu_\text{mean}=\frac{2}{\sigma^2},\quad \mu_\text{MS}=\frac{2}{3\sigma^2},\quad \mu_\text{as}\approx\frac{2.4212}{\sigma^2}\\[4pt] g=1-2\mu P_x+\mu^2M_4,\qquad \mu_{\text{MS},N}=\frac{2P_x}{P_x^2+(M_4-P_x^2)/N}\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'sigma', symbol: R`\sigma`, label: 'code 的標準差', default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
      { key: 'mu', symbol: R`\mu`, label: '你想用的學習率', default: 0.3, min: -10, max: 1000, practice: { choices: [0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 2] } },
      { key: 'N', symbol: 'N', label: 'GMAC 每個 block 平均幾筆', unit: R`\text{筆}`, default: 4096, min: 1, max: 1e7, integer: true, practice: { choices: [1, 4, 16, 64, 256] } },
    ],
    validate: ({ sigma, mu, N }) => {
      if (!(sigma > 0)) return R`$\sigma\le0$：$P_x=\sigma^2=0$ 時 $x$ 恆為 0（沒有激勵、$a$ 不可辨識），而標準差也不可能是負的。請輸入 $\sigma>0$。`
      if (!(mu > 0)) return R`$\mu\le0$：不更新（$\mu=0$）或更新方向反了（$\mu<0$，每一步 $1-\mu x^2\ge1$），三種意義下都不收斂，不必再和界限比較。請輸入 $\mu>0$。`
      const m = xMoments({ kind: 'gaussian', sigma })
      if (!(m.M4 > 0) || !Number.isFinite(blockMeanSquareBound(m, N)) || !Number.isFinite(meanSquareFactor(mu, m.Px, m.M4))) return MSG_RANGE
      return null
    },
    solve: ({ sigma, mu, N }) => {
      const dist: XDist = { kind: 'gaussian', sigma }
      const m = xMoments(dist) // P_x = σ²、M_4 = 3σ⁴
      const b = stabilityBounds(dist) // 三個界限（a.s. 界為數值求根）
      const f = stabilityFactors(mu, dist) // 1 − μP_x、g、λ
      const blk = blockMeanSquareBound(m, N)
      const cAs = b.asMax * m.Px // λ(c) = 0 的根 c ≈ 2.4212（與 σ 無關）
      const Px2 = m.Px * m.Px
      const muPx = mu * m.Px
      const lin = 2 * mu * m.Px
      const mu2 = mu * mu
      const quad = mu2 * m.M4
      const meanP = snap(f.meanPole, 1, muPx)
      const km = sigFor(meanP, 1, muPx)
      const kg = sigFor(f.g, 1, lin, quad)
      const diff = m.M4 - Px2
      const varOverN = diff / N
      const ES2 = Px2 + varOverN
      // N 很大時 E[S²] 只比 P_x² 大一點點：多顯示幾位，才看得出 block 界和 mean 界差多少
      const W = 7
      const mean = tri(Math.abs(meanP), 1)
      const ms = tri(f.g, 1)
      const as = tri(f.lambda, 0)
      const notes = [
        R`你的 $\mu=${tx(mu)}$：mean ${TRI_TEXT[mean]}（$|1-\mu P_x|=${tn(Math.abs(meanP))}$）、mean-square ${TRI_TEXT[ms]}（$g=${tn(f.g)}$）、almost-sure ${TRI_TEXT[as]}（$\lambda=${tn(f.lambda, 4)}$，網站以數值積分計算）。`,
      ]
      if (ms === 'ok') notes.push(R`Sign-off 寫法：「在 iid 純量模型、$P_x=${tn(m.Px)},\ M_4=${tn(m.M4)}$ 下，$\mu=${tx(mu)}$ 滿足 mean-square 穩定（$g=${tn(f.g)}<1$），[精確｜指定模型]。」`)
      else if (as === 'ok')
        notes.push(
          R`$\mu_\text{MS}\le\mu<\mu_\text{as}$：${ms === 'edge' ? 'MSD 不再縮小（恰在邊界）' : 'MSD 發散'}，但幾乎每條路徑仍收斂（勘誤 E14）。不能宣稱「均方穩定」，有雜訊時穩態 RMS 是無限大；少數幾個 seed 看到收斂也不能推翻 $\mu_\text{MS}$。${mean === 'ok' ? '' : R`這個 $\mu$ 連 $E[\delta_n]$ 都不收斂。`}`,
        )
      else notes.push(R`$\mu\ge\mu_\text{as}$：連典型路徑都不會收斂（三種意義下都不收斂）。`)
      notes.push(
        R`GMAC 每 $N=${txInt(N)}$ 筆平均後更新一次：mean-square 界由 $${tn(b.msMax)}$ 放寬到 $${tn(blk, 6)}$（$N\to\infty$ 時趨近 mean 界 $${tn(b.meanMax)}$）。若硬體輸出的是總和（sum）而不是平均，所有界限還要再除以 $N$：$\mu<${tn(blk / N, 4)}$。`,
      )
      return {
        steps: [
          { tex: R`P_x=\sigma^2=${txSq(sigma)}=${tx(m.Px)}`, why: 'Gaussian 的二階動差就是變異數。' },
          { tex: R`P_x^2=\sigma^4=${txSq(m.Px)}=${tx(Px2)}`, why: '後面會用到兩次。' },
          { tex: R`M_4=3\sigma^4=3\times${tx(Px2)}=${tx(m.M4)}`, why: R`Gaussian 的四階動差（分部積分得 $E[t^4]=3$），所以 $\kappa=3$。` },
          { tex: R`\mu_\text{mean}=\frac{2}{P_x}=\frac{2}{${tx(m.Px)}}=${tx(b.meanMax)}`, why: 'mean 界（F-03.5）。' },
          {
            tex: R`\mu_\text{MS}=\frac{2P_x}{M_4}=\frac{2\times${tx(m.Px)}}{${tx(m.M4)}}=\frac{${tx(2 * m.Px)}}{${tx(m.M4)}}=${tx(b.msMax)}`,
            why: R`mean-square 界（F-03.7）$=2/(3\sigma^2)$：比 mean 界嚴格 $\kappa=3$ 倍。`,
          },
          {
            tex: R`\mu_\text{as}\approx\frac{${tn(cAs)}}{\sigma^2}=\frac{${tn(cAs)}}{${tx(m.Px)}}=${tx(b.asMax)}`,
            why: R`almost-sure 界（F-03.9）。常數 $${tn(cAs)}$ 是 $E\ln|1-c\,t^2|=0$（$t\sim\mathcal N(0,1)$）的數值根，沒有初等封閉式：手算時直接記住這個數。`,
          },
          { tex: R`1-\mu P_x=1-${tx(mu)}\times${tx(m.Px)}=1-${tx(muPx, km)}=${tx(meanP)}`, why: R`你的 $\mu$ 的 mean 因子。先乘、再減。` },
          { tex: R`2\mu P_x=2\times${tx(mu)}\times${tx(m.Px)}=${tx(lin)}`, why: R`$g$ 的一次項。` },
          { tex: R`\mu^2M_4=${txSq(mu)}\times${tx(m.M4)}=${tx(mu2)}\times${tx(m.M4)}=${tx(quad)}`, why: R`$g$ 的二次項。` },
          { tex: R`g=1-2\mu P_x+\mu^2M_4=1-${tx(lin, kg)}+${tx(quad, kg)}=${tx(f.g)}`, why: R`你的 $\mu$ 的 MSD 每步因子（F-03.6）；$g<1$ 才是均方穩定。` },
          {
            tex: R`\frac{M_4-P_x^2}{N}=\frac{${tx(m.M4)}-${tx(Px2)}}{${txInt(N)}}=\frac{${tx(diff)}}{${txInt(N)}}=${tx(varOverN, W)}`,
            why: R`$\operatorname{Var}(x^2)/N$：block 內平均 $N$ 筆 $x^2$，起伏縮小 $N$ 倍。先減、再除。`,
          },
          { tex: R`E[S^2]=P_x^2+\frac{M_4-P_x^2}{N}=${tx(Px2)}+${tx(varOverN, W)}=${tx(ES2, W)}`, why: R`block 平均 $S=\tfrac1N\sum x_i^2$ 的二階動差：取代原本的 $M_4$。` },
          {
            tex: R`\mu_{\text{MS},N}=\frac{2P_x}{E[S^2]}=\frac{2\times${tx(m.Px)}}{${tx(ES2, W)}}=\frac{${tx(2 * m.Px)}}{${tx(ES2, W)}}=${tx(blk, 6)}`,
            why: R`block 版本的 mean-square 界（F-03.14，conventional block LMS、平均模式）。`,
          },
        ],
        results: [
          { symbol: R`\mu_\text{mean}`, label: 'mean 界', value: b.meanMax },
          { symbol: R`\mu_\text{MS}`, label: 'mean-square 界', value: b.msMax },
          { symbol: R`\mu_\text{as}`, label: 'almost-sure 界', value: b.asMax },
          { symbol: 'g', label: 'MSD 每步因子（你的學習率）', value: f.g },
          { symbol: R`\mu_{\text{MS},N}`, label: 'block 平均後的 mean-square 界', value: blk, digits: 6 },
        ],
        notes,
      }
    },
    tips: [
      R`只要記住三個數：Gaussian 的 $\kappa=3$、a.s. 常數 $2.4212$、以及界限都和 $1/\sigma^2$ 成正比——code 幅度加倍，$\mu$ 的上限變成四分之一。`,
      R`範例數字（$\sigma=1,\ \mu=0.3,\ N=4096$）：三個界限 $2$、$2/3$、$2.4212$；$1-\mu P_x=0.7$、$g=0.67$（T03）；$\mu_{\text{MS},4096}=1.99902$（第 8 節）。`,
      R`把 $\mu$ 改成 $0.8$、$1.5$、$2.3$、$2.6$ 各算一次，對照 Stability Lab：分別是「MSD 發散、路徑收斂」、同左、「連 mean 都發散但路徑仍收斂」、「全部發散」。`,
      R`$N$ 選 2 的冪次（硬體常用 shift 做平均）時，除以 $N$ 很好算：$2/4096=4.8828\times10^{-4}$。`,
      R`單位：$\sigma$ 與 $x$ 同單位，$\mu$ 與三個界限都是 $1/[x]^2$——code 若以 LSB 計，$\mu$ 就是每 $\text{LSB}^2$；$g$ 與 $\mu P_x$ 無因次。`,
    ],
  },
]

/** 依 ID 取出本章的手算題（找不到時丟錯，讓測試抓到打錯的 ID） */
export function handcalcById(id: string): HandCalcDef {
  const h = HANDCALCS.find((x) => x.id === id)
  if (!h) throw new Error(`ch03：找不到手算題 ${id}`)
  return h
}
