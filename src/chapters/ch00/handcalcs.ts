import { texNum } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { classifyPole, conventionalStep, fixedXMuMax, fixedXPole, sgn, signErrorStep } from '@/simulation/models/lms'
import { POLE_BEHAVIOUR_TEX } from './format'
import { Dec, FULL, ROUNDOFF, sigFor, sigKeep, tx, txBase as txF, txCeilArg, txInt, txP, txPow, txSq } from './handcalcTex'
import {
  NOISY_DATA,
  STEADY_STATE_EXAMPLE,
  analyticGradient,
  averagedStd,
  biasedFixedPoint,
  centralDifference,
  equivalentAveragingLength,
  handCalcRows,
  leastSquaresGain,
  productMomentsFromMoments,
  ratioTable,
  sampleCost,
  samplesForTargetStd,
  steadyStateVarW,
  stepsToFraction,
  timeAverageVarianceError,
  type Sample,
} from './model'

/**
 * Ch00 的「帶入手算」題。這個檔案也是全站 handcalcs.ts 的範本：
 *  1. solve() 的每一個「答案」（results）都呼叫 src/simulation 或本章 model.ts 的實際函式，不另寫一套公式
 *     （handcalcs.test.tsx 用獨立重算逐一比對，並檢查每個答案都是畫面上某一步的結果）；
 *  2. 每一步的 tex 都是「符號式 = 代入數字 =（中間結果 =）結果」：每個等號只做一種運算，
 *     而且畫面上的數字自己就算得出下一個等號（handcalcs.test.tsx 會把每一步的 TeX 重新求值檢查）；
 *     why 說明怎麼算、怎麼按計算機（支援 $...$）；
 *  3. inputs 的 default 與本章 worked example 相同；practice 範圍選手算友善的數字；
 *  4. validate 擋掉模型不適用的輸入，並解釋原因（不是只說「不合法」）；
 *  5. 使用者會打自己的數字：畫面上「加、減、乘」的數字用 handcalcTex.ts 的 Dec（精確十進位）再算一次，
 *     手算得到 0 的地方就是 0（double 會留下 1e-16 的殘渣，sign(殘渣) 更是錯的），輸入值與短的小數不四捨五入；
 *     顯示一律經過 tx()／txP()／txSq()（負數、科學記號當底數時加括號）。答案（results）仍是模擬函式的回傳值。
 *
 * 題目在章內的位置：HC-00.3 → §0.1、HC-00.1 → §0.4、HC-00.4／HC-00.2 → §0.6、HC-00.5／HC-00.6 → §0.7、
 * HC-00.7 → §0.9、HC-00.8（綜合）→ §0.10 最後、思考題之前。
 */

const [[LS_X1, LS_Y1], [LS_X2, LS_Y2], [LS_X3, LS_Y3]] = NOISY_DATA

/** 明確寫出正負號的 ±1（sign(e) 的結果） */
const signTex = (s: number): string => (s > 0 ? '+1' : s < 0 ? '-1' : '0')

/** 使用者輸入的數字 → 精確的十進位數（畫面上的加、減、乘都用它算；見 handcalcTex.ts） */
const D = Dec.of
const HALF = D(0.5)
const ONE = D(1)
const TWO = D(2)

/** 模擬／模型函式算出的值；精確的十進位運算確認它「其實是 0」時回傳 0（去掉 double 的 1e-16 殘渣）。 */
const sim = (value: number, exact: Dec): number => (exact.isZero ? 0 : value)

/** E[x⁴] − E[x²]²（= Var(x²) ≥ 0），精確計算：±A 碼剛好是 0（double 的 0.04100625 − 0.2025² 是 −6.9e-18） */
const varOfSquare = (ex2: number, ex4: number): Dec => D(ex4).sub(D(ex2).mul(D(ex2)))

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────── HC-00.1：LMS 更新（F-00.2，§0.4） ─────────────────────────
  {
    id: 'HC-00.1',
    title: 'LMS 更新兩步：預測 → 比較 → 修正',
    page: '/ch/00',
    formulaId: 'F-00.2',
    formulaTex: String.raw`\hat y_n = w_n x,\qquad e_n = y - \hat y_n,\qquad w_{n+1} = w_n + \mu\,e_n\,x`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w0', symbol: 'w_0', label: '一開始的猜測', default: 1, min: -20, max: 20, practice: { min: -2, max: 4, step: 0.5 } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -10, max: 10, practice: { choices: [-3, -2, -1, 1, 2, 3] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 6, min: -100, max: 100, practice: { min: -9, max: 9, step: 1.5 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.1, min: 0, max: 5, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
    ],
    solve: ({ w0, x, y, mu }) => {
      const s1 = conventionalStep({ w: w0, x, y, mu })
      const s2 = conventionalStep({ w: s1.w, x, y, mu })
      // 畫面上的數字：同一串加、減、乘用精確的十進位數再算一次（手算得到的就是它，沒有 double 的捨入殘渣）
      const [W0, X, Y, MU] = [D(w0), D(x), D(y), D(mu)]
      const yhat0 = W0.mul(X)
      const e0 = Y.sub(yhat0)
      const dw0 = MU.mul(e0).mul(X)
      const w1 = W0.add(dw0)
      const yhat1 = w1.mul(X)
      const e1 = Y.sub(yhat1)
      const dw1 = MU.mul(e1).mul(X)
      const w2 = w1.add(dw1)
      const p = ONE.sub(MU.mul(X).mul(X))
      const kE0 = sigFor(e0, Y, yhat0)
      const kW1 = sigFor(w1, W0, dw0)
      const kE1 = sigFor(e1, Y, yhat1)
      const kW2 = sigFor(w2, w1, dw1)
      const kNext = Math.max(kE1, kW2) // w₁ 之後還要用兩次：顯示到後面的減法需要的位數
      const kR = Math.min(10, Math.max(5, p.digits))
      return {
        steps: [
          {
            tex: String.raw`\hat y_0 = w_0\,x = ${txF(W0)}\times${txF(X)} = ${tx(yhat0, kE0)}`,
            why: '①預測：用目前的猜測 $w_0$ 乘上輸入。',
          },
          {
            tex: String.raw`e_0 = y - \hat y_0 = ${tx(Y)} - ${txP(yhat0, kE0)} = ${tx(e0)}`,
            why: '②比較：量到的輸出減掉預測。$e_0>0$ 表示預測太小。',
          },
          {
            tex: String.raw`\Delta w_0 = \mu\,e_0\,x = ${txF(MU)}\times${txF(e0, kW1)}\times${txF(X)} = ${tx(dw0, kW1)}`,
            why: '③修正量：學習率 × 誤差 × 輸入（連乘兩次）。乘上 $x$ 自動決定方向。',
          },
          {
            tex: String.raw`w_1 = w_0 + \Delta w_0 = ${tx(W0)} + ${txP(dw0, kW1)} = ${tx(w1, kNext)}`,
            why: '更新後的猜測。',
          },
          {
            tex: String.raw`e_1 = y - w_1 x = ${tx(Y)} - ${txF(w1, kNext)}\times${txF(X)} = ${tx(Y)} - ${txP(yhat1, kE1)} = ${tx(e1, kW2)}`,
            why: '第二筆資料（同一組 $x, y$）再做一次：先乘出新的預測 $w_1x$，再相減。',
          },
          {
            tex: String.raw`w_2 = w_1 + \mu\,e_1\,x = ${tx(w1, kNext)} + ${txF(MU)}\times${txF(e1, kW2)}\times${txF(X)} = ${tx(w1, kNext)} + ${txP(dw1, kW2)} = ${tx(w2)}`,
            why: '再修正一次：先乘出修正量 $\\mu\\,e_1x$，再加到 $w_1$ 上。',
          },
        ],
        results: [
          { symbol: 'w_1', label: '第一次更新後', value: sim(s1.w, w1) },
          { symbol: 'w_2', label: '第二次更新後', value: sim(s2.w, w2) },
        ],
        notes: [
          x === 0
            ? '$x = 0$：這筆資料不含 $a$ 的資訊，$w$ 完全不動。'
            : e0.isZero
              ? '$e_0 = 0$：預測已經完全正確，修正量是 0，$w$ 不會再移動。'
              : String.raw`驗算：誤差每步乘上 $p = 1-\mu x^2 = ${tx(p, kR)}$，所以 $e_1/e_0 = ${texNum(sim(s2.e, e1) / s1.e, kR)}$ 應等於 $p$。`,
        ],
      }
    },
    tips: [
      '先算 $\\hat y$、再算 $e$、最後算 $\\Delta w$；每個等號只做一種運算（一次乘法、或一次加減）。',
      '範例數字（$w_0=1, x=2, y=6, \\mu=0.1$）的答案是 $w_1=1.8$、$w_2=2.28$（測試 T01），也就是 §0.4 手算表的第 0、1 列。',
      '想和模擬對照：把 §0.5 Playground 某個 Case 的 $\\mu$ 設成同一個數字，看「更新表」的前兩列。',
      '單位：本章的數字例都是無因次。套到硬體時，$e$ 與 $y$ 同單位，$w$ 的單位是 $[y]/[x]$，$\\mu$ 的單位是 $[w]/([e][x])$（見章首的符號表）。',
    ],
  },

  // ───────────────────────── HC-00.2：pole 與穩定上限（F-00.4、F-00.5，§0.6） ─────────────────────────
  {
    id: 'HC-00.2',
    title: '學習率上限與 pole：這個 $\\mu$ 會收斂嗎？',
    page: '/ch/00',
    formulaId: 'F-00.5',
    formulaTex: String.raw`p = 1 - \mu x^2,\qquad |p| < 1 \iff 0 < \mu < \mu_{\max} = \frac{2}{x^2},\qquad \delta_n = p^{\,n}\,\delta_0\quad(\delta_n=a-w_n)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'x', symbol: 'x', label: '固定的輸入', default: 2, min: -10, max: 10, practice: { choices: [-4, -2, -1, 1, 2, 3, 4] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.1, min: -1, max: 10, practice: { choices: [0.02, 0.05, 0.1, 0.25, 0.4, 0.5, 0.65, 1] } },
      { key: 'd0', symbol: String.raw`\delta_0`, label: '一開始的參數誤差（真實值減猜測）', default: 2, min: -100, max: 100, practice: { choices: [-2, -1, 1, 2, 4] } },
      { key: 'n', symbol: 'n', label: '更新幾次', default: 3, min: 1, max: 50, integer: true, practice: { choices: [1, 2, 3, 4] } },
    ],
    validate: ({ x }) => (x === 0 ? '$x = 0$ 時每筆資料都不含 $a$ 的資訊（不可辨識），$\\mu_{\\max}$ 沒有定義。請換一個非零的 $x$。' : null),
    solve: ({ x, mu, d0, n }) => {
      const muMax = fixedXMuMax(x)
      // 畫面上的數字：精確的十進位運算（μx² 剛好是 1 時 p 就是 0，不會留下 1e-16 的殘渣）
      const [X, MU, D0] = [D(x), D(mu), D(d0)]
      const x2 = X.mul(X)
      const g = MU.mul(x2)
      const pE = ONE.sub(g)
      const pn = pE.pow(n)
      const dnE = pn.mul(D0)
      const p = sim(fixedXPole(mu, x), pE)
      // 真的把 LMS 跑 n 步：答案來自模擬，等比數列公式只是預測它。
      // 取 a = 0、w₀ = −δ₀（遞迴與 a 無關）⇒ δ_n = a − w_n = −w_n，不必用兩個很接近的數相減，δ_n 很小時仍然準確
      const rows = handCalcRows({ a: 0, w0: -d0, x, mu, steps: n })
      const dn = sim(rows[n - 1].deltaNext, dnE)
      const kPow = n >= 2 ? sigKeep(6 + Math.log10(n)) : 5 // 連乘 n 次：底數多留幾位，結果才有 5 位可信
      const kP = sigFor(pE, ONE, g) + (kPow - 5) // 1 − μx² 的運算元要顯示到「算得出 p 的那幾位」
      return {
        steps: [
          { tex: String.raw`x^2 = ${txSq(X)} = ${tx(x2, kP)}`, why: '先算輸入的平方（輸入功率）。' },
          { tex: String.raw`\mu_{\max} = \frac{2}{x^2} = \frac{2}{${tx(x2, kP)}} = ${tx(muMax)}`, why: '穩定上限：超過它，每一步都會修正過頭而且越跳越遠。' },
          {
            tex: String.raw`p = 1 - \mu x^2 = 1 - ${txF(MU)}\times${txF(x2, kP)} = 1 - ${txP(g, kP)} = ${tx(pE, kPow)}`,
            why: 'pole：參數誤差每一步乘上的倍數（先乘、再用 1 去減）。',
          },
          ...(n >= 2
            ? [
                {
                  tex: String.raw`p^{${n}} = ${txPow(pE, n, kPow)} = ${tx(pn)}`,
                  why: `把 $p$ 連乘 ${n} 次（或用計算機的 $x^y$ 鍵）。負數的奇數次方是負的、偶數次方是正的。`,
                },
                {
                  tex: String.raw`\delta_{${n}} = p^{${n}}\,\delta_0 = ${txF(pn)}\times${txF(D0)} = ${tx(dnE)}`,
                  why: '等比數列：更新 $n$ 次後還剩多少誤差。',
                },
              ]
            : [
                {
                  tex: String.raw`\delta_{1} = p\,\delta_0 = ${txF(pE)}\times${txF(D0)} = ${tx(dnE)}`,
                  why: '更新一次後還剩多少誤差（等比數列的第一項）。',
                },
              ]),
        ],
        results: [
          { symbol: String.raw`\mu_{\max}`, label: '穩定上限', value: muMax },
          { symbol: 'p', label: 'pole', value: p },
          { symbol: String.raw`\delta_{${n}}`, label: `更新 ${n} 次後的參數誤差`, value: dn, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes: [
          POLE_BEHAVIOUR_TEX[classifyPole(p)],
          ...(mu < 0 ? ['$\\mu<0$：更新方向反了（極性錯誤，等於往上坡走），所以 $p>1$、誤差每一步都被放大。'] : []),
          String.raw`這一題的 $\delta_{${n}}$ 是把 LMS 真的跑 ${n} 步（每步呼叫 conventionalStep）得到的；它和等比數列 $p^{${n}}\delta_0$ 相同，表示 pole 的公式準確地預測了模擬。`,
        ],
      }
    },
    tips: [
      '$|p|<1$ 才收斂；$p<0$ 代表每一步都跳到答案的另一側（震盪）。',
      '$p^n$ 可以連乘：例如 $0.6^3 = 0.6\\times0.6\\times0.6 = 0.216$。$n$ 大時用計算機的 $x^y$ 鍵；$\\delta_n$ 的答案容許 2% 的捨入誤差。',
      '範例數字（$x=2,\\ \\mu=0.1$）：$\\mu_{\\max}=0.5$、$p=0.6$（測試 T02），就是 §0.4 手算表最後一欄的常數。',
    ],
  },

  // ───────────────────────── HC-00.3：批次最小平方（F-00.10，§0.1） ─────────────────────────
  {
    id: 'HC-00.3',
    title: '批次最小平方：三筆資料一次解出 $\\hat a_{\\mathrm{LS}}$',
    page: '/ch/00',
    formulaId: 'F-00.10',
    formulaTex: String.raw`\hat a_{\mathrm{LS}}=\frac{\sum_i x_i\,y_i}{\sum_i x_i^2}=\frac{x_1y_1+x_2y_2+x_3y_3}{x_1^2+x_2^2+x_3^2}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'x1', symbol: 'x_1', label: '第 1 筆的輸入', default: LS_X1, min: -100, max: 100, practice: { choices: [-2, -1, 1, 2, 3] } },
      { key: 'y1', symbol: 'y_1', label: '第 1 筆的輸出', default: LS_Y1, min: -1000, max: 1000, practice: { min: -6, max: 12, step: 1.5 } },
      { key: 'x2', symbol: 'x_2', label: '第 2 筆的輸入', default: LS_X2, min: -100, max: 100, practice: { choices: [-3, -1, 1, 2, 4] } },
      { key: 'y2', symbol: 'y_2', label: '第 2 筆的輸出', default: LS_Y2, min: -1000, max: 1000, practice: { min: -6, max: 12, step: 1.5 } },
      { key: 'x3', symbol: 'x_3', label: '第 3 筆的輸入', default: LS_X3, min: -100, max: 100, practice: { choices: [-4, -2, 2, 3, 4] } },
      { key: 'y3', symbol: 'y_3', label: '第 3 筆的輸出', default: LS_Y3, min: -1000, max: 1000, practice: { min: -6, max: 12, step: 1.5 } },
    ],
    validate: ({ x1, x2, x3 }) =>
      x1 === 0 && x2 === 0 && x3 === 0
        ? '三筆的 $x$ 都是 0：$\\sum_i x_i^2=0$，每一筆都不含 $a$ 的資訊（不可辨識），最小平方解是 $0/0$、沒有定義。至少要有一筆 $x_i\\ne0$。'
        : null,
    solve: ({ x1, y1, x2, y2, x3, y3 }) => {
      const data: Sample[] = [
        [x1, y1],
        [x2, y2],
        [x3, y3],
      ]
      const ls = leastSquaresGain(data)
      // 畫面上的數字：精確的十進位運算（三個乘積剛好抵銷時總和就是 0，不會留下 1e-17 的殘渣）
      const X = [D(x1), D(x2), D(x3)]
      const Y = [D(y1), D(y2), D(y3)]
      const [p1, p2, p3] = X.map((xi, i) => xi.mul(Y[i]))
      const [q1, q2, q3] = X.map((xi) => xi.mul(xi))
      const sxy = p1.add(p2).add(p3)
      const sxx = q1.add(q2).add(q3)
      const aLs = sim(ls.w, sxy)
      const kS = sigFor(sxy, p1, p2, p3)
      const ratios = ratioTable(data)
        .filter((r) => Number.isFinite(r.ratio))
        .map((r) => tx(r.ratio))
      const hasZero = data.some(([x]) => x === 0)
      return {
        steps: [
          { tex: String.raw`x_1y_1 = ${txF(X[0])}\times${txF(Y[0])} = ${tx(p1, kS)}`, why: '第 1 筆：輸入乘輸出。' },
          { tex: String.raw`x_2y_2 = ${txF(X[1])}\times${txF(Y[1])} = ${tx(p2, kS)}`, why: '第 2 筆。' },
          { tex: String.raw`x_3y_3 = ${txF(X[2])}\times${txF(Y[2])} = ${tx(p3, kS)}`, why: '第 3 筆。' },
          {
            tex: String.raw`\sum_i x_iy_i = ${txP(p1, kS)} + ${txP(p2, kS)} + ${txP(p3, kS)} = ${tx(sxy)}`,
            why: '分子：三個乘積加起來（輸入與輸出的「相關」）。',
          },
          {
            tex: String.raw`\sum_i x_i^2 = ${txSq(X[0])} + ${txSq(X[1])} + ${txSq(X[2])} = ${tx(q1)} + ${tx(q2)} + ${tx(q3)} = ${tx(sxx)}`,
            why: '分母：三個輸入各自平方後加起來（輸入的總功率）；負的 $x$ 平方後是正的。',
          },
          {
            tex: String.raw`\hat a_{\mathrm{LS}} = \frac{\sum_i x_iy_i}{\sum_i x_i^2} = \frac{${tx(sxy)}}{${tx(sxx)}} = ${tx(aLs)}`,
            why: '相除。這是「一次看完全部資料」時讓總平方誤差最小的 $w$。',
          },
        ],
        results: [
          { symbol: String.raw`\textstyle\sum_i x_iy_i`, label: '分子', value: sim(ls.sxy, sxy) },
          { symbol: String.raw`\textstyle\sum_i x_i^2`, label: '分母', value: ls.sxx },
          { symbol: String.raw`\hat a_{\mathrm{LS}}`, label: '最小平方估計', value: aLs },
        ],
        notes: [
          String.raw`只看單筆的猜測 $y_i/x_i$ 分別是 $${ratios.join(String.raw`,\ `)}$${hasZero ? '（$x_i=0$ 的那一筆不含資訊，沒有單筆猜測）' : ''}。最小平方解 $${tx(aLs)}$ 是它們以 $x_i^2$ 為權重的加權平均，所以 $|x|$ 大的那一筆影響最大。`,
        ],
      }
    },
    tips: [
      '在紙上列一張表：每一筆一列，欄位是 $x$、$y$、$xy$、$x^2$；最後兩欄各自加總，再相除。',
      '範例數字是 §0.1 的含雜訊資料 $(1,\\,3.2)$、$(2,\\,5.7)$、$(4,\\,12.5)$：答案 $64.6/21\\approx3.0762$，和內文相同。',
      '把三個 $y$ 都改成剛好 $3x$（$3,\\ 6,\\ 12$）：答案變成整數 $3$，三個單筆猜測也都是 $3$。',
    ],
  },

  // ───────────────────────── HC-00.4：梯度 dj/dw = −e·x（F-00.3，§0.6） ─────────────────────────
  {
    id: 'HC-00.4',
    title: '斜率 $dj/dw=-e\\,x$：用差分親手驗證，再往下坡走一步',
    page: '/ch/00',
    formulaId: 'F-00.3',
    formulaTex: String.raw`j(w)=\tfrac12\,(y-wx)^2,\qquad \frac{dj}{dw}=-e\,x,\qquad D_h\equiv\frac{j(w+h)-j(w-h)}{2h},\qquad w_{\text{new}}=w-\mu\,\frac{dj}{dw}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的猜測', default: 1, min: -20, max: 20, practice: { choices: [-1, 0, 0.5, 1, 1.5, 2] } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -10, max: 10, practice: { choices: [-3, -2, -1, 1, 2, 3] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 6, min: -100, max: 100, practice: { min: -9, max: 9, step: 1.5 } },
      { key: 'h', symbol: 'h', label: '差分的間距', default: 0.5, min: -10, max: 10, practice: { choices: [0.1, 0.25, 0.5, 1] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.1, min: 0, max: 5, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
    ],
    validate: ({ w, x, y, h }) => {
      if (h === 0) return '$h=0$：差分變成 $0/0$，沒有定義。請取一個非零的間距（$j$ 是二次函數，任何 $h\\ne0$ 都會得到同一個答案）。'
      // h 太小：j(w+h) 與 j(w−h) 幾乎相同，double 相減後只剩捨入誤差（e = 0 或 x = 0 時兩者本來就相等，不算）
      const jPlus = sampleCost(w + h, x, y)
      const jMinus = sampleCost(w - h, x, y)
      const flat = x === 0 || D(y).sub(D(w).mul(D(x))).isZero
      if (!flat && Math.abs(jPlus - jMinus) < 1e-9 * Math.max(jPlus, jMinus))
        return String.raw`$h=${tx(D(h))}$ 太小：$j(w+h)$ 與 $j(w-h)$ 都約為 $${texNum(jPlus, 3)}$，前 9 位以上的有效數字完全一樣，相減之後幾乎只剩捨入誤差——電腦的 double 算不準，手算更得保留十幾位數。請把 $|h|$ 加大（例如 $0.1$ 或 $0.5$）；$j$ 是二次函數，中央差分的答案與 $h$ 無關。`
      return null
    },
    solve: ({ w, x, y, h, mu }) => {
      const step = conventionalStep({ w, x, y, mu })
      // 畫面上的數字：精確的十進位運算（e = 0 時就是 0；兩個很接近的 j 相減也不會只剩捨入殘渣）
      const [W, X, Y, H, MU] = [D(w), D(x), D(y), D(h), D(mu)]
      const wx = W.mul(X)
      const e = Y.sub(wx)
      const e2 = e.mul(e)
      const j0 = HALF.mul(e2)
      const gE = e.mul(X).neg()
      const wPlus = W.add(H)
      const wMinus = W.sub(H)
      const yhatPlus = wPlus.mul(X)
      const yhatMinus = wMinus.mul(X)
      const ePlus = Y.sub(yhatPlus)
      const eMinus = Y.sub(yhatMinus)
      const ePlus2 = ePlus.mul(ePlus)
      const eMinus2 = eMinus.mul(eMinus)
      const jPlus = HALF.mul(ePlus2)
      const jMinus = HALF.mul(eMinus2)
      const dj = jPlus.sub(jMinus)
      const twoH = TWO.mul(H)
      const muG = MU.mul(gE)
      const wNewE = W.sub(muG)
      // 答案：模擬函式的回傳值（精確運算說是 0 的，去掉 double 的殘渣）
      const g = sim(analyticGradient(w, x, y), gE)
      const fd = sim(centralDifference(w, x, y, h), dj)
      const wNew = sim(step.w, wNewE)
      const kE = sigFor(e, Y, wx)
      const kEp = sigFor(ePlus, Y, yhatPlus)
      const kEm = sigFor(eMinus, Y, yhatMinus)
      const kDj = sigFor(dj, jPlus, jMinus)
      const kW = sigFor(wNewE, W, muG)
      const roundoff = fd - g
      return {
        steps: [
          {
            tex: String.raw`e = y - w\,x = ${tx(Y)} - ${txF(W)}\times${txF(X)} = ${tx(Y)} - ${txP(wx, kE)} = ${tx(e, kW)}`,
            why: '目前的誤差（先乘、再減）。',
          },
          {
            tex: String.raw`j(w) = \tfrac12 e^2 = 0.5\times${txSq(e)} = 0.5\times${txF(e2)} = ${tx(j0)}`,
            why: '單筆成本：誤差平方的一半（先平方、再乘 $0.5$）。',
          },
          {
            tex: String.raw`\frac{dj}{dw} = -e\,x = -${txF(e, kW)}\times${txF(X)} = ${tx(gE, kW)}`,
            why: '解析斜率（chain rule 的結果）。接下來不用微分，改用「量」的方式再算一次。',
          },
          {
            tex: String.raw`e_+ = y-(w+h)\,x = ${tx(Y)} - (${tx(W)} + ${txP(H)})\times${txF(X)} = ${tx(Y)} - ${txF(wPlus, FULL)}\times${txF(X)} = ${tx(Y)} - ${txP(yhatPlus, kEp)} = ${tx(ePlus, kDj)}`,
            why: '把 $w$ 往右移 $h$，重新算誤差。',
          },
          {
            tex: String.raw`j(w+h) = \tfrac12 e_+^2 = 0.5\times${txSq(ePlus, kDj)} = 0.5\times${txF(ePlus2, kDj)} = ${tx(jPlus, kDj)}`,
            why: '右邊那一點的成本。',
          },
          {
            tex: String.raw`e_- = y-(w-h)\,x = ${tx(Y)} - (${tx(W)} - ${txP(H)})\times${txF(X)} = ${tx(Y)} - ${txF(wMinus, FULL)}\times${txF(X)} = ${tx(Y)} - ${txP(yhatMinus, kEm)} = ${tx(eMinus, kDj)}`,
            why: '把 $w$ 往左移 $h$，重新算誤差。',
          },
          {
            tex: String.raw`j(w-h) = \tfrac12 e_-^2 = 0.5\times${txSq(eMinus, kDj)} = 0.5\times${txF(eMinus2, kDj)} = ${tx(jMinus, kDj)}`,
            why: '左邊那一點的成本。',
          },
          {
            tex: String.raw`j(w+h)-j(w-h) = ${tx(jPlus, kDj)} - ${txP(jMinus, kDj)} = ${tx(dj)}`,
            why: '左右兩點的高度差。兩個數很接近時，相減會吃掉前面相同的位數，所以這兩個 $j$ 要多留幾位。',
          },
          {
            tex: String.raw`D_h = \frac{j(w+h)-j(w-h)}{2h} = \frac{${tx(dj)}}{2\times${txF(H)}} = \frac{${tx(dj)}}{${tx(twoH)}} = ${tx(fd)}`,
            why: '中央差分：高度差除以水平距離 $2h$，就是「量出來」的斜率。應該和第 3 步相同。',
          },
          {
            tex: String.raw`w_{\text{new}} = w - \mu\,\frac{dj}{dw} = ${tx(W)} - ${txF(MU)}\times${txF(gE, kW)} = ${tx(W)} - ${txP(muG, kW)} = ${tx(wNewE)}`,
            why: '沿斜率的反方向走一小步（gradient descent）。它和 LMS 的 $w+\\mu\\,e\\,x$ 是同一個數。',
          },
        ],
        results: [
          { symbol: String.raw`\frac{dj}{dw}`, label: '解析斜率', value: g },
          { symbol: 'D_h', label: '中央差分量到的斜率', value: fd },
          { symbol: String.raw`w_{\text{new}}`, label: '往下坡走一步之後', value: wNew },
        ],
        notes: [
          String.raw`$D_h$ 與 $-e\,x$ 相同：$j(w)$ 是二次函數，中央差分沒有截斷誤差（三次以上的泰勒項為 0）。換一個 $h$ 再算一次，答案不會變。` +
            (roundoff !== 0 ? String.raw`（網站用 double 計算，兩者只差 $${texNum(roundoff, 2)}$ 的浮點捨入。）` : ''),
          g < 0
            ? '斜率為負：往右（$w$ 變大）成本會下降，所以這一步 $w$ 增加。'
            : g > 0
              ? '斜率為正：往左（$w$ 變小）成本會下降，所以這一步 $w$ 減少。'
              : x === 0
                ? '$x=0$：$j$ 與 $w$ 無關（一條水平線），斜率是 0，$w$ 不動——這筆資料不含 $a$ 的資訊。'
                : '斜率為 0：已經在谷底（$e=0$），$w$ 不動。',
        ],
      }
    },
    tips: [
      '$\\tfrac12e^2$：先把 $e$ 平方，再乘 $0.5$。負的 $e$ 平方後是正的。',
      '頁面上的數值梯度檢查用 $h=10^{-3}$；手算用 $h=0.5$ 比較好按，而且二次函數的答案與 $h$ 無關。',
      '$h$ 不要取太小：$j(w+h)$ 與 $j(w-h)$ 會很接近，相減時前面相同的位數全部抵銷，兩個 $j$ 都得多留幾位才算得準（$h$ 小到連 double 都算不準時，網站會請你換一個）。',
      '範例數字（$w=1,\\ x=2,\\ y=6,\\ \\mu=0.1$）：$e=4$、$dj/dw=-8$、$w_{\\text{new}}=1.8$，就是 HC-00.1 的 $w_1$。',
    ],
  },

  // ───────────────────────── HC-00.5：1/√N 法則（F-00.7、F-00.8，§0.7） ─────────────────────────
  {
    id: 'HC-00.5',
    title: '平均 $N$ 筆：雜訊剩多少？要幾筆才夠？',
    page: '/ch/00',
    formulaId: 'F-00.8',
    formulaTex: String.raw`\begin{gathered}E[e\,x]=(a-w)\,E[x^2],\qquad s_1^2=(a-w)^2\big(E[x^4]-E[x^2]^2\big)+\sigma_v^2\,E[x^2]\\[4pt]\operatorname{std}\big(\bar G_N\big)=\frac{s_1}{\sqrt N},\qquad N_{\min}=\left\lceil\frac{s_1^2}{\sigma_{\mathrm{tgt}}^2}\right\rceil\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實參數', default: 3, min: -100, max: 100, practice: { choices: [1, 2, 3, 4] } },
      { key: 'w', symbol: 'w', label: '目前的猜測（平均期間固定）', default: 2, min: -100, max: 100, practice: { choices: [0, 1, 2, 2.5, 3.5] } },
      { key: 'sv', symbol: String.raw`\sigma_v`, label: '量測雜訊的標準差', default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2, 3] } },
      { key: 'ex2', symbol: 'E[x^2]', label: '輸入的平均功率', default: 1, min: 0, max: 1000, practice: { choices: [1] } },
      { key: 'ex4', symbol: 'E[x^4]', label: '輸入的四次矩（單位功率時：高斯填 3，正負一碼填 1）', default: 3, min: 0, max: 1e6, practice: { choices: [1, 1.8, 3] } },
      { key: 'N', symbol: 'N', label: '平均的筆數', default: 1024, min: 1, max: 1e9, integer: true, practice: { choices: [16, 64, 100, 256, 400, 1024, 2500, 10000] } },
      { key: 'target', symbol: String.raw`\sigma_{\mathrm{tgt}}`, label: '想把平均值的標準差壓到多小', default: 0.05, min: 0, max: 1000, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.5] } },
    ],
    validate: ({ ex2, ex4, target }) => {
      if (ex2 === 0) return '$E[x^2]=0$ 表示輸入永遠是 0：$e\\,x\\equiv0$，每一筆都不含 $a$ 的資訊（不可辨識）。請給一個大於 0 的 $E[x^2]$。'
      // 精確比較：±A 碼剛好相等（例如 E[x²] = 0.2025、E[x⁴] = 0.04100625），不受 double 的 0.2025² = 0.04100625000000001 影響
      if (varOfSquare(ex2, ex4).sign < 0)
        return String.raw`任何分布都滿足 $E[x^4]\ge E[x^2]^2$（因為 $\operatorname{Var}(x^2)=E[x^4]-E[x^2]^2\ge0$）；現在 $E[x^2]^2=${tx(D(ex2).mul(D(ex2)), 8)}$ 比 $E[x^4]=${tx(D(ex4))}$ 大，這組數字不對應任何真實的輸入。$\pm A$ 碼剛好相等（$A^4$），Gaussian 是 $3\sigma_x^4$。`
      if (target === 0) return '目標標準差是 0：有限筆的平均不可能把雜訊完全消掉（$s_1/\\sqrt N$ 只會趨近 0）。請給一個大於 0 的目標。'
      return null
    },
    solve: ({ a, w, sv, ex2, ex4, N, target }) => {
      // 畫面上的數字：加、減、乘的部分用精確的十進位數（到 s₁² 為止都寫得完）
      const [A, W, SV, EX2, EX4, T] = [D(a), D(w), D(sv), D(ex2), D(ex4), D(target)]
      const delta = A.sub(W)
      const meanE = delta.mul(EX2)
      const ex2sq = EX2.mul(EX2)
      const varX2 = varOfSquare(ex2, ex4)
      const delta2 = delta.mul(delta)
      const t1 = delta2.mul(varX2)
      const sv2 = SV.mul(SV)
      const t2 = sv2.mul(EX2)
      const s1sq = t1.add(t2)
      const target2 = T.mul(T)
      // 答案：模型函式。±A 碼（E[x⁴] = E[x²]²）時 double 的 0.04100625 − 0.2025² 是 −6.9e-18，直接丟進模型會得到負的變異數（√ → NaN）；
      // 精確運算確認兩者相等後，把「剛好相等」的 E[x⁴] 交給模型，讓它內部的 E[x⁴] − E[x²]² 也剛好是 0。
      const m = productMomentsFromMoments(a - w, sv, ex2, varX2.isZero ? ex2 * ex2 : ex4)
      const variance = s1sq.isZero ? 0 : m.variance > 0 ? m.variance : s1sq.toNumber()
      const mean = sim(m.mean, meanE)
      const s1 = Math.sqrt(variance)
      const rootN = Math.sqrt(N)
      const stdN = averagedStd(s1, N)
      const nMin = samplesForTargetStd(s1, target)
      const ratio = variance / (target * target)
      const kD = sigFor(delta, A, W)
      const kV = sigFor(varX2, EX4, ex2sq)
      const kQ = sigKeep(Math.log10(Math.max(ratio, 1)) + 2.5) // 商要取上整：整數部分的每一位都要對
      const notes: string[] = []
      if (s1 === 0) notes.push('$s_1=0$：每一筆 $e\\,x$ 都一樣（沒有雜訊、$x^2$ 也不起伏），一筆就夠，平均不會再改善任何東西。')
      else if (mean === 0) notes.push('$w=a$：平均更新量是 0，已經在答案上；每一筆 $e\\,x$ 只剩雜訊，平均後以 $1/\\sqrt N$ 縮向 0。')
      else
        notes.push(
          String.raw`訊號對雜訊：單筆時 $|E[e\,x]|/s_1=${texNum(Math.abs(mean) / s1, 4)}$；平均 $N=${txInt(N)}$ 筆後 $|E[e\,x]|/\operatorname{std}(\bar G_N)=${texNum(Math.abs(mean) / stdN, 4)}$，大了 $\sqrt N=${texNum(rootN, 4)}$ 倍——平均值的正負號（也就是更新方向）越來越不容易判錯。`,
        )
      if (s1 > 0)
        notes.push(
          N >= nMin
            ? String.raw`$N=${txInt(N)}$ 已經達標：$${tx(stdN)}\le${tx(T)}$（最少只要 $${txInt(nMin)}$ 筆）。`
            : String.raw`$N=${txInt(N)}$ 還不夠：$${tx(stdN)}>${tx(T)}$，至少要 $${txInt(nMin)}$ 筆。雜訊要再降 $k$ 倍，資料就要多 $k^2$ 倍。`,
        )
      return {
        steps: [
          { tex: String.raw`\delta = a - w = ${tx(A)} - ${txP(W, kD)} = ${tx(delta)}`, why: '參數誤差（全站極性 $\\delta=a-w$）。' },
          {
            tex: String.raw`E[e\,x] = \delta\,E[x^2] = ${txF(delta)}\times${txF(EX2)} = ${tx(meanE)}`,
            why: '平均更新方向（F-00.7）：雜訊項 $E[v\\,x]=0$ 被平均掉，只剩訊號。',
          },
          {
            tex: String.raw`E[x^4]-E[x^2]^2 = ${tx(EX4)} - ${txSq(EX2)} = ${tx(EX4)} - ${tx(ex2sq, kV)} = ${tx(varX2)}`,
            why: '$x^2$ 的變異數：輸入功率每一筆起伏多大（$\\pm1$ 碼時為 0，Gaussian 時為 2）。',
          },
          {
            tex: String.raw`\delta^2\big(E[x^4]-E[x^2]^2\big) = ${txSq(delta)}\times${txF(varX2)} = ${txF(delta2)}\times${txF(varX2)} = ${tx(t1, kQ)}`,
            why: '訊號項 $\\delta x^2$ 自己的起伏（離答案越遠越大）。',
          },
          {
            tex: String.raw`\sigma_v^2\,E[x^2] = ${txSq(SV)}\times${txF(EX2)} = ${txF(sv2)}\times${txF(EX2)} = ${tx(t2, kQ)}`,
            why: '雜訊項 $v\\,x$ 的變異數。',
          },
          {
            tex: String.raw`s_1^2 = \delta^2\big(E[x^4]-E[x^2]^2\big)+\sigma_v^2\,E[x^2] = ${tx(t1, kQ)} + ${tx(t2, kQ)} = ${tx(s1sq, kQ)}`,
            why: '兩項不相關，變異數直接相加（第 4、5 步的結果）。',
          },
          { tex: String.raw`s_1 = \sqrt{s_1^2} = \sqrt{${tx(s1sq, kQ)}} = ${tx(s1)}`, why: '開根號（計算機的 $\\sqrt{x}$ 鍵）：單筆 $e\\,x$ 的標準差。' },
          { tex: String.raw`\sqrt N = \sqrt{${txInt(N)}} = ${tx(rootN)}`, why: '再開一次根號。' },
          {
            tex: String.raw`\operatorname{std}\big(\bar G_N\big) = \frac{s_1}{\sqrt N} = \frac{${tx(s1)}}{${tx(rootN)}} = ${tx(stdN)}`,
            why: '$1/\\sqrt N$ 法則：平均 $N$ 筆後還剩多少抖動。',
          },
          {
            tex: String.raw`\sigma_{\mathrm{tgt}}^2 = ${txSq(T)} = ${tx(target2, kQ)}`,
            why: '反過來問要幾筆：由 $s_1/\\sqrt N\\le\\sigma_{\\mathrm{tgt}}$ 兩邊平方（都是正數，不等號方向不變）得 $N\\ge s_1^2/\\sigma_{\\mathrm{tgt}}^2$。先把目標平方。',
          },
          s1 === 0
            ? { tex: String.raw`s_1 = 0\;\Rightarrow\;N_{\min} = ${txInt(nMin)}`, why: '沒有雜訊可以平均：一筆就達標。' }
            : {
                tex: String.raw`N_{\min} = \left\lceil\frac{s_1^2}{\sigma_{\mathrm{tgt}}^2}\right\rceil = \left\lceil\frac{${tx(s1sq, kQ)}}{${tx(target2, kQ)}}\right\rceil = \left\lceil ${txCeilArg(ratio, nMin)}\right\rceil = ${txInt(nMin)}`,
                why: '直接用第 6 步的 $s_1^2$ 去除（不必先開根號再平方，少一次捨入）；筆數必須是整數，所以無條件進位。商很大時 $s_1^2$ 要多留幾位，整數部分才會每一位都對。',
              },
        ],
        results: [
          { symbol: 'E[e\\,x]', label: '平均更新方向', value: mean },
          { symbol: 's_1', label: '單筆的標準差', value: s1 },
          { symbol: String.raw`\operatorname{std}(\bar G_N)`, label: '平均之後的標準差', value: stdN },
          { symbol: String.raw`N_{\min}`, label: '達到目標至少要幾筆', value: nMin, digits: 12 },
        ],
        notes,
      }
    },
    tips: [
      '開根號用計算機的 $\\sqrt{x}$ 鍵；$N$ 選完全平方數（$100$、$400$、$1024=32^2$、$10^4$）時 $\\sqrt N$ 可以心算。',
      '沒有計算機時用 Babylonian method 求 $\\sqrt S$：猜一個 $g$，算 $(g+S/g)/2$。猜的相對誤差是 $\\varepsilon$ 時，算一次後只剩約 $\\varepsilon^2/2$（猜差 5%，算一次後剩 0.1%）。例：$\\sqrt3$ 猜 $1.7$，得 $(1.7+3/1.7)/2=1.7324$（正確值 $1.7321$）。',
      '中間值至少留 4–5 位有效數字，最後再四捨五入（答案容許 1% 的誤差）。',
      '$E[x^4]$ 怎麼填（單位功率 $E[x^2]=1$ 時）：Gaussian 是 $3$、$\\pm1$ 碼是 $1$、均勻分布是 $1.8$；$\\pm A$ 碼是 $A^4$（此時 $E[x^2]=A^2$）。',
      '範例數字和 §0.7「雜訊為什麼會被平均掉」實驗的預設相同：算完對照它的指標表——$s_1=1.73205$、$N=1024$ 的理論 std $0.0541266$。',
      '思考題 3 是同一條公式：令 $a=w$、$\\sigma_v=2$、$E[x^2]=1$（於是 $s_1=2$）、目標 $0.05$，會得到 $N_{\\min}=1600$。',
    ],
  },

  // ───────────────────────── HC-00.6：穩態變異數（F-00.9，§0.7） ─────────────────────────
  {
    id: 'HC-00.6',
    title: '穩態抖動：$w$ 收斂之後還會抖多大？',
    page: '/ch/00',
    formulaId: 'F-00.9',
    formulaTex: String.raw`\operatorname{Var}(w_\infty)=\frac{\mu\,\sigma_v^2}{2-\mu x^2}\quad\big(|p|<1,\ p=1-\mu x^2\big),\qquad \operatorname{std}(w_\infty)=\sqrt{\operatorname{Var}(w_\infty)},\qquad N_{\mathrm{eq}}=\frac{2-\mu x^2}{\mu x^2}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: STEADY_STATE_EXAMPLE.mus[1], min: -1, max: 100, practice: { choices: [0.01, 0.02, 0.05, 0.1, 0.2, 0.25] } },
      { key: 'x', symbol: 'x', label: '固定的輸入', default: STEADY_STATE_EXAMPLE.x, min: -100, max: 100, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'sv', symbol: String.raw`\sigma_v`, label: '量測雜訊的標準差', default: STEADY_STATE_EXAMPLE.sigmaV, min: 0, max: 1000, practice: { choices: [0.1, 0.2, 0.5, 1, 2] } },
    ],
    validate: ({ mu, x }) => {
      if (x === 0) return '$x=0$：$e\\,x\\equiv0$，$w$ 永遠停在初值——沒有收斂，也就沒有「穩態抖動」可言（不可辨識）。請換一個非零的 $x$。'
      if (mu === 0) return '$\\mu=0$：$w$ 完全不更新（$p=1$），永遠停在初值，談不上「收斂後的抖動」。請給一個大於 0 的 $\\mu$。'
      const pE = ONE.sub(D(mu).mul(D(x)).mul(D(x)))
      if (mu < 0)
        return String.raw`$\mu<0$：更新極性相反（往上坡走），$p=1-\mu x^2=${tx(pE, 6)}>1$，誤差與雜訊每一步都被放大，沒有穩態。需要 $0<\mu<2/x^2=${tx(fixedXMuMax(x))}$。`
      // |p| ≥ 1（含 μx² 剛好是 2、但 double 算成 1.9999999999999998 的情況；離邊界不到 1e-12 時 double 也分辨不出來）
      if (Math.abs(fixedXPole(mu, x)) >= 1 - ROUNDOFF)
        return String.raw`$\mu=${tx(D(mu))}$ 沒有落在穩定區 $0<\mu<2/x^2=${tx(fixedXMuMax(x))}$ 內：$p=1-\mu x^2=${tx(pE, 6)}$，$|p|\ge1$，變異數遞迴 $V_{n+1}=p^2V_n+\mu^2x^2\sigma_v^2$ 會一直變大，公式的分母 $2-\mu x^2\le0$ 也失去意義。`
      return null
    },
    solve: ({ mu, x, sv }) => {
      // 畫面上的數字：加、減、乘的部分用精確的十進位數（μx² 剛好是 1 時 p 就是 0）
      const [MU, X, SV] = [D(mu), D(x), D(sv)]
      const x2 = X.mul(X)
      const g = MU.mul(x2)
      const p = ONE.sub(g)
      const sv2 = SV.mul(SV)
      const noiseIn = MU.mul(sv2)
      const den = TWO.sub(g)
      // 答案：模型函式
      const varW = steadyStateVarW(mu, x, sv)
      const stdW = Math.sqrt(varW)
      const nEq = equivalentAveragingLength(mu, x)
      const approx = sv * Math.sqrt(mu / 2)
      const kG = Math.max(sigFor(p, ONE, g), sigFor(den, TWO, g)) // μx² 要用兩次（1 − μx²、2 − μx²）：顯示到兩個減法都對得起來
      const notes: string[] = []
      if (sv === 0) notes.push('$\\sigma_v=0$：沒有雜訊，$w$ 收斂後完全不抖。')
      else {
        notes.push(
          String.raw`驗算：直接把 $N_{\mathrm{eq}}=${tx(nEq)}$ 筆單筆猜測 $y_i/x$ 取平均，標準差是 $\sigma_v/(|x|\sqrt{N_{\mathrm{eq}}})=${tx(averagedStd(sv / Math.abs(x), nEq))}$，和 $\operatorname{std}(w_\infty)$ 一樣——LMS 的穩態抖動，相當於只平均了 $N_{\mathrm{eq}}$ 筆。`,
        )
        notes.push(
          String.raw`小步長近似 $\sigma_v\sqrt{\mu/2}=${tx(approx)}$ 比精確值小 $${texNum((1 - approx / stdW) * 100, 3)}\%$：它要 $\mu x^2\ll1$ 才準（那時誤差約 $\mu x^2/4$），這裡 $\mu x^2=${tx(g)}$。`,
        )
      }
      if (p.sign <= 0) notes.push(String.raw`$N_{\mathrm{eq}}\le1$（$\mu\ge1/x^2$，$p\le0$）：每一步都修到底甚至修過頭，比只看一筆資料還吵；想平均掉雜訊，$\mu$ 必須遠小於 $1/x^2=${tx(1 / (x * x))}$。`)
      return {
        steps: [
          { tex: String.raw`x^2 = ${txSq(X)} = ${tx(x2, kG)}`, why: '輸入的平方。' },
          { tex: String.raw`\mu x^2 = ${txF(MU)}\times${txF(x2, kG)} = ${tx(g, kG)}`, why: '這個乘積等於 $1-p$，會用到兩次；必須落在 $0<\\mu x^2<2$。' },
          { tex: String.raw`p = 1-\mu x^2 = 1 - ${txP(g, kG)} = ${tx(p, kG)}`, why: '先確認 $|p|<1$（有穩態）。' },
          {
            tex: String.raw`\mu\,\sigma_v^2 = ${txF(MU)}\times${txSq(SV)} = ${txF(MU)}\times${txF(sv2)} = ${tx(noiseIn)}`,
            why: '分子：每一步注入的雜訊（先平方、再乘）。',
          },
          { tex: String.raw`2-\mu x^2 = 2 - ${txP(g, kG)} = ${tx(den)}`, why: '分母（等於 $1+p$）。' },
          {
            tex: String.raw`\operatorname{Var}(w_\infty) = \frac{\mu\,\sigma_v^2}{2-\mu x^2} = \frac{${tx(noiseIn)}}{${tx(den)}} = ${tx(varW)}`,
            why: '相除，得到穩態變異數。',
          },
          {
            tex: String.raw`\operatorname{std}(w_\infty) = \sqrt{\operatorname{Var}(w_\infty)} = \sqrt{${tx(varW)}} = ${tx(stdW)}`,
            why: '開根號（計算機的 $\\sqrt{x}$ 鍵）：$w$ 在答案附近抖動的典型大小。',
          },
          {
            tex: String.raw`N_{\mathrm{eq}} = \frac{2-\mu x^2}{\mu x^2} = \frac{${tx(den)}}{${tx(g, kG)}} = ${tx(nEq)}`,
            why: '等效平均長度：這個抖動相當於把幾筆獨立量測直接平均（也等於 $(1+p)/(1-p)$）。',
          },
        ],
        results: [
          { symbol: String.raw`\operatorname{Var}(w_\infty)`, label: '穩態變異數', value: varW },
          { symbol: String.raw`\operatorname{std}(w_\infty)`, label: '穩態標準差', value: stdW },
          { symbol: String.raw`N_{\mathrm{eq}}`, label: '等效平均長度', value: nEq },
        ],
        notes,
      }
    },
    tips: [
      '開根號用計算機的 $\\sqrt{x}$ 鍵。沒有計算機時：猜一個 $g$，算 $(g+S/g)/2$（Babylonian method；猜差 5%，算一次後剩 0.1%）。例：$\\sqrt{0.0069444}$ 猜 $0.08$，得 $(0.08+0.0069444/0.08)/2\\approx0.0834$（正確值 $0.08333$）。',
      '近似：$\\mu x^2\\ll1$ 時 $\\operatorname{std}(w_\\infty)\\approx\\sigma_v\\sqrt{\\mu/2}$，比精確值小約 $\\mu x^2/4$（$\\mu x^2\\le0.1$ 時誤差不到 3%）。',
      '$\\mu$ 小 4 倍，抖動約小 2 倍；代價是收斂慢 4 倍（時間常數 $\\tau\\approx1/(\\mu x^2)$）。',
      '和模擬對照：在 §0.5 的 Playground 載入「有雜訊」的 preset（$x=2$、$\\sigma_v=0.5$、$\\mu=0.01/0.05/0.2$），指標表「理論穩態 std」依序是 $0.0357143$、$0.0833333$、$0.204124$。',
    ],
  },

  // ───────────────────────── HC-00.7：Sign-Error vs LMS（§0.9） ─────────────────────────
  {
    id: 'HC-00.7',
    title: '同一筆資料、兩種更新：LMS 與 Sign-Error 各走多遠？',
    page: '/ch/00',
    formulaTex: String.raw`e=y-w\,x,\qquad \text{LMS：}\ w\leftarrow w+\mu\,e\,x,\qquad \text{Sign-Error：}\ w\leftarrow w+\mu\,\mathrm{sign}(e)\,x`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的猜測', default: 1, min: -20, max: 20, practice: { choices: [-1, 0, 1, 2] } },
      { key: 'x', symbol: 'x', label: '輸入', default: 1, min: -10, max: 10, practice: { choices: [-2, -1, 1, 2] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 3, min: -100, max: 100, practice: { min: -6, max: 6, step: 1.5 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.2, min: 0, max: 5, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
    ],
    validate: ({ w, x, y }) =>
      // 精確比較：0.448 − 0.64×0.7 在 double 裡是 5.6e-17，它的正負號只是捨入誤差，不是資訊
      D(y).sub(D(w).mul(D(x))).isZero
        ? '$e=y-wx=0$：$\\mathrm{sign}(0)$ 是多少取決於慣例（數學上的次梯度取 0，硬體比較器卻只能輸出 $\\pm1$；勘誤 E40），所以 Sign-Error 這一步的答案不唯一。請換一組 $y\\ne wx$ 的數字。'
        : null,
    solve: ({ w, x, y, mu }) => {
      const lms = conventionalStep({ w, x, y, mu })
      const sign = signErrorStep({ w, x, y, mu })
      const s = sgn(lms.e) // validate 已排除 e = 0（含捨入殘渣）
      // 畫面上的數字：精確的十進位運算
      const [W, X, Y, MU] = [D(w), D(x), D(y), D(mu)]
      const wx = W.mul(X)
      const e = Y.sub(wx)
      const dwLms = MU.mul(e).mul(X)
      const wLms = W.add(dwLms)
      const dwSign = MU.mul(D(s)).mul(X)
      const wSign = W.add(dwSign)
      const kE = sigFor(e, Y, wx)
      const kL = sigFor(wLms, W, dwLms)
      const kS = sigFor(wSign, W, dwSign)
      const absE = Math.abs(lms.e)
      const notes: string[] = []
      if (x === 0) notes.push('$x=0$：兩種更新量都是 0。這筆資料不含 $a$ 的資訊。')
      else {
        notes.push('兩者的方向一定相同（都由 $e\\cdot x$ 的正負號決定），差別只在步伐大小。')
        notes.push(
          String.raw`步伐比 $|\Delta w_{\text{LMS}}|/|\Delta w_{\text{Sign}}|=|e|=${tx(e.sign < 0 ? e.neg() : e)}$：${absE > 1 ? '$|e|>1$，LMS 走得比較遠' : absE < 1 ? '$|e|<1$，反而是 Sign-Error 走得比較遠' : '剛好一樣遠'}。Sign-Error 的步伐永遠是 $\mu|x|=${tx(dwSign.sign < 0 ? dwSign.neg() : dwSign)}$，不會隨誤差變小而縮短，所以接近答案後會在附近來回跳。`,
        )
      }
      return {
        steps: [
          {
            tex: String.raw`e = y - w\,x = ${tx(Y)} - ${txF(W)}\times${txF(X)} = ${tx(Y)} - ${txP(wx, kE)} = ${tx(e, kL)}`,
            why: '兩種更新看到的誤差一樣（先乘、再減）。',
          },
          {
            tex: String.raw`\Delta w_{\text{LMS}} = \mu\,e\,x = ${txF(MU)}\times${txF(e, kL)}\times${txF(X)} = ${tx(dwLms, kL)}`,
            why: 'LMS：修正量和誤差的大小成正比。',
          },
          {
            tex: String.raw`w_{\text{LMS}} = w + \Delta w_{\text{LMS}} = ${tx(W)} + ${txP(dwLms, kL)} = ${tx(wLms)}`,
            why: 'LMS 更新後的猜測。',
          },
          {
            tex: String.raw`\mathrm{sign}(e) = \mathrm{sign}(${tx(e)}) = ${signTex(s)}`,
            why: '1-bit 比較器只回報誤差的正負號：$e>0$ 是 $+1$，$e<0$ 是 $-1$，大小被丟掉了。',
          },
          {
            tex: String.raw`\Delta w_{\text{Sign}} = \mu\,\mathrm{sign}(e)\,x = ${txF(MU)}\times(${signTex(s)})\times${txF(X)} = ${tx(dwSign)}`,
            why: 'Sign-Error：不管誤差多大，步伐固定是 $\\mu|x|$。',
          },
          {
            tex: String.raw`w_{\text{Sign}} = w + \Delta w_{\text{Sign}} = ${tx(W)} + ${txP(dwSign, kS)} = ${tx(wSign)}`,
            why: 'Sign-Error 更新後的猜測。',
          },
        ],
        results: [
          { symbol: String.raw`w_{\text{LMS}}`, label: 'LMS 更新後', value: sim(lms.w, wLms) },
          { symbol: String.raw`w_{\text{Sign}}`, label: 'Sign-Error 更新後', value: sim(sign.w, wSign) },
        ],
        notes,
      }
    },
    tips: [
      '$\\mathrm{sign}(e)$ 只看正負：不必算大小，所以硬體只要一顆比較器。',
      '範例數字（$w=1,\\ x=1,\\ y=3,\\ \\mu=0.2$，也就是 $a=3$）：LMS 走到 $1.4$，Sign-Error 走到 $1.2$，和 §0.9 的推導相同。',
      '試試把 $y$ 改成 $1.5$（$e=0.5$）：這次換成 Sign-Error 走得比較遠。',
    ],
  },

  // ───────────────────────── HC-00.8：綜合（F-00.11 + F-00.4 + F-00.9 + 1/√N，§0.10） ─────────────────────────
  {
    id: 'HC-00.8',
    title: '綜合：雜訊跟著 $x$ 走時，LMS 停在哪、多久到、抖多大、平均後多準？',
    page: '/ch/00',
    formulaId: 'F-00.11',
    formulaTex: String.raw`\begin{gathered}w^*=a+\frac{E[v\,x]}{E[x^2]},\qquad p=1-\mu x^2,\qquad n_{1\%}=\left\lceil\frac{\ln 0.01}{\ln|p|}\right\rceil\\[4pt]\operatorname{std}(w_\infty)=\sqrt{\frac{\mu\,\sigma_{v'}^2}{2-\mu x^2}},\qquad \operatorname{std}(\bar w)\approx\frac{\sigma_{v'}}{\sqrt n}\qquad\big(x=\pm1,\ v=\kappa x+v'\big)\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實參數', default: 3, min: -100, max: 100, practice: { choices: [1, 2, 3, 4] } },
      { key: 'kappa', symbol: String.raw`\kappa`, label: '跟著輸入走的干擾係數', default: 0.2, min: -100, max: 100, practice: { choices: [-0.5, -0.3, -0.2, 0.1, 0.2, 0.5] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', default: 0.02, min: -1, max: 10, practice: { choices: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5] } },
      { key: 'sv', symbol: String.raw`\sigma_{v'}`, label: '獨立雜訊的標準差', default: 0.5, min: 0, max: 1000, practice: { choices: [0.1, 0.2, 0.5, 1] } },
      { key: 'n', symbol: 'n', label: '收斂後取時間平均的筆數', default: 10001, min: 1, max: 1e9, integer: true, practice: { choices: [2500, 10000, 40000] } },
    ],
    validate: ({ mu, n }) => {
      if (mu <= 0) return '需要 $\\mu>0$：$\\mu=0$ 時 $w$ 不更新，$\\mu<0$ 時更新極性相反（$p>1$）而發散，都不會收斂到 $w^*$。'
      if (mu >= 2)
        return String.raw`$x=\pm1$ 時穩定區是 $0<\mu<2/x^2=2$；現在 $p=1-\mu=${tx(fixedXPole(mu, 1))}$，$|p|\ge1$，$w$ 不會收斂，後面的量都沒有意義。`
      const p = fixedXPole(mu, 1)
      const err = timeAverageVarianceError(p, n)
      if (Math.abs(err) > 0.05)
        return String.raw`$\operatorname{std}(\bar w)\approx\sigma_{v'}/\sqrt n$ 假設平均長度遠大於 $w$ 的相關長度。現在 $n=${txInt(n)}$、$p=1-\mu=${tx(p)}$：相鄰的 $w$ 還高度相關，$\operatorname{Var}(\bar w)$ 的近似會差 $${texNum(Math.abs(err) * 100, 3)}\%$（超過 5%）。大約需要 $n\ge40\,|p|/(1-p^2)=${texNum((40 * Math.abs(p)) / (1 - p * p), 4)}$；請加大 $n$。`
      return null
    },
    solve: ({ a, kappa, mu, sv, n }) => {
      const ex2 = 1 // ±1 碼：x² ≡ 1
      // 畫面上的數字：加、減、乘的部分用精確的十進位數
      const [A, K, MU, SV] = [D(a), D(kappa), D(mu), D(sv)]
      const evxE = K.mul(ONE)
      const wStarE = A.add(evxE)
      const pE = ONE.sub(MU.mul(ONE))
      const sv2 = SV.mul(SV)
      const noiseIn = MU.mul(sv2)
      const den = TWO.sub(MU.mul(ONE))
      // 答案：模型函式
      const wStar = sim(biasedFixedPoint(a, kappa * ex2, ex2), wStarE)
      const p = sim(fixedXPole(mu, 1), pE)
      const n1 = stepsToFraction(p)
      const lnP = Math.log(Math.abs(p))
      const ln001 = Math.log(0.01)
      const varW = steadyStateVarW(mu, 1, sv)
      const stdW = Math.sqrt(varW)
      const rootN = Math.sqrt(n)
      const se = averagedStd(sv, n)
      const kW = sigFor(wStarE, A, evxE)
      const kQ = sigKeep(Math.log10(Math.max(ln001 / lnP, 1)) + 2.5) // 商要取上整：整數部分的每一位都要對
      const notes: string[] = []
      if (kappa === 0) notes.push('$\\kappa=0$：干擾和輸入不相關，$w^*=a$，LMS 平均收斂到真正的答案。')
      else if (se > 0)
        notes.push(
          String.raw`偏移 $w^*-a=${tx(evxE)}$ 是 $\operatorname{std}(\bar w)=${tx(se)}$ 的 $${texNum(Math.abs(kappa) / se, 4)}$ 倍：平均得再久，$\bar w$ 也只會更確定地停在 $w^*=${tx(wStarE)}$，不會回到 $a=${tx(A)}$——抖動是 variance，偏移是 bias，$1/\sqrt n$ 只管前者。`,
        )
      else notes.push(String.raw`沒有獨立雜訊：$w$ 不抖，直接收斂到 $w^*=${tx(wStarE)}$，仍然不是 $a=${tx(A)}$。`)
      if (sv > 0)
        notes.push(
          String.raw`單一時刻的 $w$ 抖動 $${tx(stdW)}$；取 $n=${txInt(n)}$ 筆時間平均後剩 $${tx(se)}$。§0.10 表格用的容忍度是 $4\operatorname{std}(\bar w)=${tx(4 * se)}$。`,
        )
      return {
        steps: [
          {
            tex: String.raw`E[v\,x] = \kappa\,E[x^2] = ${txF(K)}\times${ex2} = ${tx(evxE)}`,
            why: String.raw`$v=\kappa x+v'$：和輸入成正比的那一部分留下來，獨立雜訊的 $E[v'x]=0$。$x=\pm1$，所以 $E[x^2]=1$。`,
          },
          {
            tex: String.raw`w^* = a+\frac{E[v\,x]}{E[x^2]} = ${tx(A)} + \frac{${tx(evxE, kW)}}{${ex2}} = ${tx(A)} + ${txP(evxE, kW)} = ${tx(wStarE)}`,
            why: '①停在哪：平均更新量歸零的位置（F-00.11）。它不是 $a$。',
          },
          {
            tex: String.raw`p = 1-\mu x^2 = 1 - ${txF(MU)}\times${ex2} = 1 - ${tx(MU)} = ${tx(pE)}`,
            why: '②多久到：先算 pole（F-00.4），$x^2=1$。',
          },
          ...(p === 0
            ? [{ tex: String.raw`p = 0\;\Rightarrow\;n_{1\%} = ${txInt(n1)}`, why: '$\\mu=1/x^2$：一步到位（不必取對數，$\\ln0$ 沒有定義）。' }]
            : [
                {
                  tex: String.raw`\ln|p| = \ln ${tx(pE.sign < 0 ? pE.neg() : pE)} = ${tx(lnP, kQ)}`,
                  why: '自然對數（計算機的 $\\ln$ 鍵；$|p|<1$ 所以結果是負的）。',
                },
                {
                  tex: String.raw`\frac{\ln 0.01}{\ln|p|} = \frac{${tx(ln001, kQ)}}{${tx(lnP, kQ)}} = ${txCeilArg(ln001 / lnP, n1)}\;\Rightarrow\;n_{1\%} = \left\lceil ${txCeilArg(ln001 / lnP, n1)}\right\rceil = ${txInt(n1)}`,
                  why: '由 $|p|^n\\le0.01$ 兩邊取 $\\ln$；除以負數時不等號反向，所以是 $n\\ge$ 這個比值，再無條件進位。',
                },
              ]),
          {
            tex: String.raw`\mu\,\sigma_{v'}^2 = ${txF(MU)}\times${txSq(SV)} = ${txF(MU)}\times${txF(sv2)} = ${tx(noiseIn)}`,
            why: '③抖多大：穩態變異數的分子（F-00.9；先平方、再乘）。',
          },
          { tex: String.raw`2-\mu x^2 = 2 - ${txF(MU)}\times${ex2} = 2 - ${tx(MU)} = ${tx(den)}`, why: '分母。' },
          {
            tex: String.raw`\operatorname{Var}(w_\infty) = \frac{\mu\,\sigma_{v'}^2}{2-\mu x^2} = \frac{${tx(noiseIn)}}{${tx(den)}} = ${tx(varW)}`,
            why: '相除。',
          },
          {
            tex: String.raw`\operatorname{std}(w_\infty) = \sqrt{\operatorname{Var}(w_\infty)} = \sqrt{${tx(varW)}} = ${tx(stdW)}`,
            why: '開根號（計算機的 $\\sqrt{x}$ 鍵）：$w$ 在 $w^*$ 附近抖動的典型大小。',
          },
          { tex: String.raw`\sqrt n = \sqrt{${txInt(n)}} = ${tx(rootN, 6)}`, why: '④平均後多準：先開根號。' },
          {
            tex: String.raw`\operatorname{std}(\bar w) \approx \frac{\sigma_{v'}}{\sqrt n} = \frac{${tx(SV)}}{${tx(rootN, 6)}} = ${tx(se)}`,
            why: '$1/\\sqrt N$ 法則：把 $w$ 再做時間平均，效果和直接平均 $n$ 筆獨立量測一樣（$\\mu$ 約掉了）。',
          },
        ],
        results: [
          { symbol: 'w^*', label: '平均收斂到的位置', value: wStar },
          { symbol: 'p', label: 'pole', value: p },
          { symbol: 'n_{1\\%}', label: '誤差降到百分之一所需的步數', value: n1, digits: 12 },
          { symbol: String.raw`\operatorname{std}(w_\infty)`, label: '單一時刻的抖動', value: stdW },
          { symbol: String.raw`\operatorname{std}(\bar w)`, label: '時間平均後的標準誤', value: se },
        ],
        notes,
      }
    },
    tips: [
      '$\\ln$ 用計算機的 $\\ln$ 鍵（不是 $\\log$，那是以 10 為底）。$\\ln0.01=-4.6052$（$=-2\\ln10$）是常數，可以直接抄。',
      '沒有 $\\ln$ 鍵時只能估算：令 $\\varepsilon=\\mu x^2$，$\\ln(1-\\varepsilon)\\approx-\\varepsilon$，得 $n_{1\\%}\\approx4.6/\\varepsilon$；它會高估約 $\\varepsilon/2$（$\\varepsilon\\le0.1$ 時最多 5%）。多留一項 $\\ln(1-\\varepsilon)\\approx-\\varepsilon-\\varepsilon^2/2$，則 $\\varepsilon\\le0.2$ 時誤差不到 1.5%。估算值只能用來檢查數量級，對答案要用 $\\ln$ 鍵。',
      '$\\sqrt{10001}\\approx100.005$：直接用 $\\sqrt{10^4}=100$ 心算，只差 0.005%。',
      '範例數字就是 §0.10 表格 $\\kappa=+0.2$ 那一列：$w^*=3.2$、容忍度 $4\\sigma_{v\'}/\\sqrt n=0.02$；推導最後一行的 $\\operatorname{std}(\\bar w)=0.005$。',
      '四個小題各用到本章的一條公式：F-00.11（停在哪）、F-00.4（pole）、F-00.9（穩態抖動）、F-00.8（$1/\\sqrt N$）。',
    ],
  },
]
