import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { normCdf } from '@/simulation/core'
import {
  KQ_FACTOR,
  LIN_RATIO_LIMIT,
  autoMu,
  buildCodeDistribution,
  codeMoments,
  comparatorMean,
  eDet,
  expectation,
  gmacSlope,
  linearizedFixedPoint,
  meanGmacMse,
  meanGmacSign,
  mseFixedPoint,
  mseWeightedMean,
  nearIntegerSensitivity,
  perCodeGain,
  signFixedPoint,
  signSecondOrder,
  signWeightedMedian,
  type CodeDistribution,
  type DcNullMode,
  type ErrorModel,
} from '@/simulation/models/bias'

/**
 * Ch11（Calibration Bias & DTC INL）的「帶入手算」題（docs/teaching-style.md §7）。
 *  1. 每一題的答案都由 src/simulation/models/bias.ts 的實際函式計算（mseFixedPoint、linearizedFixedPoint、
 *     comparatorMean、signSecondOrder、signWeightedMedian、nearIntegerSensitivity…），不另寫一套公式；
 *     步驟裡的中間數字只是把這些量用四則運算串起來（handcalcs.test.tsx 逐題與獨立重算比對）。
 *  2. 符號依勘誤 E12（INL 係數 c_2、c_3；干擾 ε_cc = κx）與全站極性 δ = a − w（殘差的 gain 項是 (a − w)x）。
 *  3. 預設值 = 本章的 worked example：5-level code {−2,…,2}、a = 1、c_3 = 0.1（T12：1.34／1.3403456／1.4）、
 *     勘誤 E03 的 x ∈ {0,1,2,3}、b = 0.5（1.2143／1／1.6）、§11.4 的 B = 0.01。
 */

const PAGE = '/ch/11'
const TU = String.raw`\mathrm{t.u.}`
const PER_TU = String.raw`\mathrm{t.u.}^{-1}`

/**
 * F-11.9 二階修正的適用上限：max|e_0|/σ_v ≤ 1.2（本章例子相當於 σ_v ≥ 0.2；再小的話 erf 只取到三次項的低階截斷就不準了。
 * erf 的 Maclaurin 級數本身對任何有限引數都收斂，失準的是截斷）。
 */
export const SECOND_ORDER_MAX_RATIO = 1.2
/** 常見標準常態表的範圍 |z| ≤ 3.49。 */
export const PHI_TABLE_MAX = 3.49
/** Lab 判斷「一階線性化可信」的門檻 max|e_det|/σ_v ≤ 0.3（勘誤 E01）；與 bias.ts 的 LIN_RATIO_LIMIT 是同一個數字。 */
export const LINEAR_OK_RATIO = LIN_RATIO_LIMIT
/**
 * 中間量顯示的有效位數：比答案（5 位）多一位。K_q = 0.797885/σ_v 這類常數若只顯示 5 位，
 * 讀者照著畫面上的數字再乘一次，末位會和下一步顯示的結果差 1（例如 1.5958 × 0.24 = 0.38299 ≠ 0.38298）。
 */
const MID = 6
/** code 的冪次、加總與動差顯示的有效位數：整數 code 時都是精確值（尾零會被去掉），自訂小數 code 時也不會被捨入成 5 位。 */
const SUM = 9

/** 本章的 5-level code {−2,−1,0,1,2}（等機率）。 */
const FIVE = buildCodeDistribution({ kind: 'five_level' })

/** 誤差模型（未指定的項為 0）。 */
const mk = (o: Partial<ErrorModel>): ErrorModel => ({ a: 1, b: 0, c2: 0, c3: 0, kappa: 0, sigmaV: 0, ...o })

/**
 * 把使用者輸入的 code 集合包成 bias.ts 的 CodeDistribution（每個值等機率）。
 * kind 只是標籤（借用 'five_level'）；expectation／codeMoments／固定點函式只看 values 與 probs。
 */
function codeSet(values: number[]): CodeDistribution {
  return { kind: 'five_level', label: `自訂等機率 code（${values.length} 個值）`, shift: 0, values, probs: values.map(() => 1 / values.length), continuous: null, sequence: null, notes: [] }
}

/** 把浮點捨入造成的「應為 0」歸零（只影響顯示，例如 E[x e] = −1.1e−16 → 0）。 */
const chop = (x: number, scale = 1) => (Math.abs(x) <= 1e-12 * Math.max(1, Math.abs(scale)) ? 0 : x)
const total = (v: number[]) => v.reduce((s, x) => s + x, 0)
/** a,\ b,\ c */
const list = (v: number[], sig = 5) => v.map((x) => texNum(x, sig)).join(String.raw`,\ `)
/** a+(-b)+c */
const plus = (v: number[], sig = 5) => v.map((x) => texNumP(x, sig)).join('+')
/** 帶正負號的連加：-0.4+0.8 */
const signedSum = (v: number[]) => v.map((x, i) => (x < 0 ? `-${texNum(-x)}` : `${i ? '+' : ''}${texNum(x)}`)).join('')
/** 百分比文字（3 位有效數字） */
const pct = (x: number) => texNum(100 * x, 3)
/** 奇函數在 ±x 的值：v > 0 → \pm v；v < 0 → \mp|v| */
const pm = (v: number) => (v < 0 ? String.raw`\mp${texNum(-v)}` : String.raw`\pm${texNum(v)}`)

const DC_MODES: DcNullMode[] = ['none', 'shared_bbpd', 'linear_pd']

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── HC-11.1：殘差與平均 GMAC（§11 開場） ───────────── */
  {
    id: 'HC-11.1',
    title: '在你選的 $w$ 上：每個 code 的殘差與平均 GMAC',
    page: PAGE,
    formulaId: 'F-11.1',
    formulaTex: String.raw`e(x;w)=(a-w)\,x+c_3x^3,\qquad E[G](w)=E[x\,e]=\tfrac15\sum_{x=-2}^{2}x\,e(x;w),\qquad E[x\,e]=0\ \not\Rightarrow\ e=0`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.8, 0.9, 1, 1.1, 1.2] } },
      { key: 'c3', symbol: 'c_3', label: '三階 INL 係數', unit: TU, default: 0.1, min: -1, max: 1, practice: { choices: [-0.1, 0.05, 0.1, 0.2] } },
      { key: 'w', symbol: 'w', label: '校正 gain（你選的值）', unit: TU, default: 1.34, min: -5, max: 5, practice: { min: 0.8, max: 1.6, step: 0.05 } },
    ],
    solve: ({ a, c3, w }) => {
      const m = mk({ a, c3 })
      const xs = FIVE.values
      const d = chop(a - w)
      const es = xs.map((x) => chop(eDet(x, w, m)))
      const e1 = es[3]
      const e2 = es[4]
      const xe = xs.map((x, i) => chop(x * es[i]))
      const e2s = es.map((e) => e * e)
      const G = chop(meanGmacMse(w, m, FIVE))
      const mse = chop(expectation(FIVE, (x) => eDet(x, w, m) ** 2))
      const wStar = mseFixedPoint(m, FIVE)
      const allZero = es.every((e) => e === 0)
      return {
        steps: [
          {
            tex: String.raw`e(1;w)=(a-w)\cdot1+c_3\cdot1^3=(${texNum(a)}-${texNumP(w)})+${texNumP(c3)}=${texNum(d)}+${texNumP(c3)}=${texNum(e1)}`,
            why: String.raw`code $x=1$ 的殘差 = gain 誤差項 + INL 項。$a-w=${texNum(d)}$ 就是全站約定的 $\delta=a-w$（正值表示 $w$ 還太小）。`,
          },
          {
            tex: String.raw`e(2;w)=(a-w)\cdot2+c_3\cdot2^3=${texNumP(d)}\times2+${texNumP(c3)}\times8=${texNum(2 * d)}+${texNumP(8 * c3)}=${texNum(e2)}`,
            why: 'code $x=2$：gain 項變 2 倍，INL 項變 $2^3=8$ 倍 —— 一條直線無法同時抵消兩者。',
          },
          {
            tex: String.raw`e(-x;w)=-e(x;w)\ \Rightarrow\ \big(e(-2),\,e(-1),\,e(0),\,e(1),\,e(2)\big)=\big(${list(es)}\big)`,
            why: '只有 $x$ 與 $x^3$ 兩個奇次項，所以殘差是奇函數：負的 code 只要變號，$x=0$ 的殘差是 0。',
          },
          {
            tex: String.raw`x\,e(x;w):\; ${xs.map((x, i) => String.raw`${texNumP(x)}\times${texNumP(es[i])}`).join(String.raw`,\ `)}\;=\;${list(xe)}`,
            why: '逐項把 code 乘上它的殘差（這就是 MSE-LMS 的 GMAC 在每個 sample 累加的量）。',
          },
          {
            tex: String.raw`E[x\,e]=\tfrac15\big(${plus(xe)}\big)=\tfrac{${texNum(chop(total(xe)))}}{5}=${texNum(G)}`,
            why: '期望值 = 機率加權和；5 個 code 各 $1/5$。這就是平均 GMAC $E[G](w)$。',
          },
          {
            tex: String.raw`E[e^2]=\tfrac15\big(${es.map((e) => `${texNumP(e)}^2`).join('+')}\big)\\ \qquad=\tfrac15\big(${plus(e2s)}\big)=\tfrac{${texNum(chop(total(e2s)))}}{5}=${texNum(mse)}`,
            why: '殘差的均方值（MSE 成本）：先把每個殘差平方，加起來，再除以 5。它量的是「還剩多少 timing error」，和 GMAC 是否歸零是兩回事。',
          },
        ],
        results: [
          { symbol: 'e(1;w)', label: 'code $x=1$ 的殘差', value: e1, unit: TU },
          { symbol: 'e(2;w)', label: 'code $x=2$ 的殘差', value: e2, unit: TU },
          { symbol: String.raw`E[x\,e]`, label: 'MSE-LMS 的平均 GMAC', value: G, unit: TU },
          { symbol: 'E[e^2]', label: '殘差的均方值', value: mse, unit: String.raw`\mathrm{t.u.}^2` },
        ],
        notes: [
          G === 0
            ? allZero
              ? '$E[x\\,e]=0$ 而且每個殘差都是 0：沒有 INL（$c_3=0$）且 $w=a$ 時，直線可以完全貼合。'
              : String.raw`$E[x\,e]=0$：GMAC 已經歸零，這個 $w$ 就是 MSE-LMS 的固定點 $w^*=${texNum(wStar)}$；但殘差 $e(\pm1)=${pm(e1)}$、$e(\pm2)=${pm(e2)}$ 沒有一個是 0 —— GMAC 歸零不代表誤差歸零。`
            : String.raw`$E[x\,e]${G > 0 ? '>' : '<'}0$：更新式 $w_{k+1}=w_k+\mu G_k$ 會把 $w$ 往${G > 0 ? '上' : '下'}推，直到 GMAC 歸零的 $w^*=${texNum(wStar)}$（模型的 MSE-LMS 固定點）。`,
        ],
      }
    },
    tips: [
      '$w=1,\\ 1.2,\\ 1.34,\\ 1.4$ 依序得到 $E[x\\,e]=0.68,\\ 0.28,\\ 0,\\ -0.12$，就是本章開場「先算一次」的四個數字。',
      '只有奇次項時 $e(-x)=-e(x)$，所以只要算 $x=1$ 與 $x=2$ 兩個殘差；$x\\,e$ 則是偶函數，$\\pm x$ 兩項相同。',
      '$E[e^2]$ 在 $w=1.34$ 最小（0.0288）；試 $w=1.4$ 會得到 0.036、$w=1$ 得到 0.26。',
    ],
  },

  /* ───────────── HC-11.2：comparator 的 erf、K_q 與線性化（§11.A） ───────────── */
  {
    id: 'HC-11.2',
    title: 'Comparator 的平均輸出 $E[q\\mid x]$、$K_q$ 與線性化誤差',
    page: PAGE,
    formulaId: 'F-11.2',
    formulaTex: String.raw`E[q\mid x]=2\,\Phi\!\Big(\frac{e_\mathrm{det}}{\sigma_v}\Big)-1=\operatorname{erf}\!\Big(\frac{e_\mathrm{det}}{\sqrt2\,\sigma_v}\Big)\approx K_q\Big(e_\mathrm{det}-\frac{e_\mathrm{det}^3}{6\sigma_v^2}\Big),\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`,
    level: 'research',
    claim: 'approx',
    inputs: [
      // 隨機題：e/σ_v 一定是小數兩位以內（σ_v ∈ {0.5, 1, 2}），Φ 表可以直接查到，不必內插
      { key: 'e', symbol: String.raw`e_\mathrm{det}`, label: '這個 code 的確定性殘差', unit: TU, default: 0.24, min: -100, max: 100, practice: { choices: [-0.24, 0.1, 0.12, 0.2, 0.24, 0.3, 0.4, 0.5] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊的標準差', unit: TU, default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
    ],
    validate: ({ e, sigma }) => {
      if (!(sigma > 0))
        return '$\\sigma_v=0$（無雜訊）時 comparator 是理想的 sign：$E[q\\mid x]=\\operatorname{sign}(e_\\mathrm{det})$，$K_q=\\sqrt{2/\\pi}/\\sigma_v$ 沒有定義（趨近無限大）。無雜訊的固定點請看 HC-11.6 的加權中位數。'
      if (Math.abs(e) / sigma > PHI_TABLE_MAX)
        return String.raw`$|e_\mathrm{det}|/\sigma_v=${texNum(Math.abs(e) / sigma, 4)}>${PHI_TABLE_MAX}$：超出一般 $\Phi$ 表的範圍，comparator 已完全飽和（$E[q\mid x]\approx\pm1$），$K_q$ 線性化沒有意義。請縮小殘差或加大 $\sigma_v$。`
      return null
    },
    solve: ({ e, sigma }) => {
      const z = e / sigma
      const Phi = normCdf(z)
      const q = comparatorMean(e, sigma)
      const kq = KQ_FACTOR / sigma
      const lin = kq * e
      const cubic = e ** 3 / (6 * sigma * sigma)
      const third = kq * (e - cubic)
      const notes: string[] = []
      if (q !== 0) {
        notes.push(
          String.raw`一階線性化高估 $${pct((lin - q) / q)}\%$（小 $z$ 時約為 $z^2/6=${pct((z * z) / 6)}\%$）；加上三次項後只差 $${pct((third - q) / q)}\%$。`,
        )
      } else notes.push('$e_\\mathrm{det}=0$：$q=\\pm1$ 各半，$E[q\\mid x]=0$，這個 code 對 GMAC 的平均沒有貢獻。')
      notes.push(
        Math.abs(z) <= LINEAR_OK_RATIO
          ? String.raw`$|z|=${texNum(Math.abs(z), 4)}\le${LINEAR_OK_RATIO}$：落在 S 曲線的直線段，$K_q$ 線性化可信（Lab 的門檻，勘誤 E01）。`
          : String.raw`$|z|=${texNum(Math.abs(z), 4)}>${LINEAR_OK_RATIO}$：已進入 S 曲線的彎曲段，Lab 會發出「線性化失效風險」警告；Sign-LMS 的固定點要用 mean-field 根，不能直接套 F-11.4。`,
      )
      return {
        steps: [
          {
            tex: String.raw`z=\frac{e_\mathrm{det}}{\sigma_v}=\frac{${texNum(e)}}{${texNum(sigma)}}=${texNum(z, 6)}`,
            why: '把殘差換算成「幾個 $\\sigma_v$」。$|z|$ 就是 Lab 指標 $\\max|e_\\mathrm{det}|/\\sigma_v$。',
          },
          {
            tex: String.raw`\Phi(z)=\Phi(${texNum(z, 6)})\approx${texNum(Phi, 8)}`,
            why: '查標準常態累積表（例：$z=0.24$ 看列 0.2、行 0.04，表上寫 0.5948）；$z<0$ 用 $\\Phi(-z)=1-\\Phi(z)$。沒有表時的近似見「手算提示」。一般的表只有 4 位小數；這裡多列幾位，是為了讓下一步的減法對得上。',
          },
          {
            tex: String.raw`E[q\mid x]=2\,\Phi(z)-1=2\times${texNum(Phi, 8)}-1=${texNum(q)}`,
            why: '$q=+1$ 的機率是 $\\Phi(z)$、$q=-1$ 的機率是 $1-\\Phi(z)$，平均為 $\\Phi-(1-\\Phi)$。這一步是精確的（F-11.2）。',
          },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(KQ_FACTOR, MID)}}{${texNum(sigma)}}=${texNum(kq, MID)}`,
            why: '計算機：$2\\div\\pi=0.63662$，按開根號得 $0.797885$，再除以 $\\sigma_v$。$K_q$ 是 S 曲線在原點的斜率，單位是 $\\mathrm{t.u.}^{-1}$。',
          },
          {
            tex: String.raw`K_q\,e_\mathrm{det}=${texNum(kq, MID)}\times${texNumP(e)}=${texNum(lin, MID)}`,
            why: '一階線性化：用切線代替 S 曲線（F-11.3）。',
          },
          {
            tex: String.raw`\frac{e_\mathrm{det}^3}{6\,\sigma_v^2}=\frac{${texNumP(e)}^3}{6\times${texNum(sigma)}^2}=\frac{${texNum(e ** 3, 6)}}{${texNum(6 * sigma * sigma, 6)}}=${texNum(cubic, 6)}`,
            why: 'erf 泰勒展開的三次項：$\\operatorname{erf}(u)=\\tfrac{2}{\\sqrt\\pi}(u-\\tfrac{u^3}{3}+\\cdots)$ 代入 $u=e/(\\sqrt2\\sigma_v)$。計算機：$e$ 連乘三次；分母先平方再乘 6。',
          },
          {
            tex: String.raw`K_q\Big(e_\mathrm{det}-\frac{e_\mathrm{det}^3}{6\sigma_v^2}\Big)=${texNum(kq, MID)}\times\big(${texNum(e)}-${texNumP(cubic, 6)}\big)=${texNum(kq, MID)}\times${texNumP(e - cubic, 6)}=${texNum(third, MID)}`,
            why: '把三次項留下來：這就是 §11.2 情境 (2) 用來算 Sign-LMS 修正量的近似。',
          },
        ],
        results: [
          { symbol: String.raw`E[q\mid x]`, label: 'comparator 的平均輸出（精確）', value: q },
          { symbol: 'K_q', label: 'comparator 小訊號增益', value: kq, unit: PER_TU },
          { symbol: String.raw`K_q\,e_\mathrm{det}`, label: '一階線性化的估計', value: lin },
          { symbol: String.raw`K_q\big(e_\mathrm{det}-\tfrac{e_\mathrm{det}^3}{6\sigma_v^2}\big)`, label: '加上三次項的估計', value: third },
        ],
        notes,
      }
    },
    tips: [
      '預設值是 §11.2 例子在 $w=1.34$ 處的最大殘差 0.24 與 Gallery #7 的 $\\sigma_v=1$。換成 $e_\\mathrm{det}=1,\\ \\sigma_v=100$ 可重現 Ch05（測試 T04）的 $E[q]=0.0079787$ 與 $K_q=0.0079788$。',
      '$\\Phi$ 表怎麼查：$z=0.24$ 找列 0.2、行 0.04 得 0.5948；$z<0$ 先查 $|z|$ 再用 $\\Phi(-z)=1-\\Phi(z)$。4 位小數的表只能算到小數第 4 位（例：$2\\times0.5948-1=0.1896$，這裡顯示 0.18967），對答案時容許 1% 的誤差。',
      '沒有 $\\Phi$ 表時：$|z|\\le0.5$ 可用 $\\Phi(z)\\approx0.5+0.39894\\,z\\,\\big(1-\\tfrac{z^2}{6}\\big)$（$0.39894=1/\\sqrt{2\\pi}$），誤差小於 $3.2\\times10^{-4}$；$|z|\\le0.3$ 時小於 $2.5\\times10^{-5}$。',
      '有 erf 鍵的計算機：$\\Phi(z)=\\tfrac12\\big[1+\\operatorname{erf}(z/\\sqrt2)\\big]$，或直接 $E[q\\mid x]=\\operatorname{erf}(z/\\sqrt2)$。',
      '試 $\\sigma_v=0.3$（$z=0.8$）：一階線性化高估超過 10%，這就是「小誤差」要看整個殘差相對 $\\sigma_v$ 的原因。',
    ],
  },

  /* ───────────── HC-11.3：offset bias 與三種架構（§11.1） ───────────── */
  {
    id: 'HC-11.3',
    title: 'Offset 的假 gain bias：三種主迴路架構與 code 置中',
    page: PAGE,
    formulaId: 'F-11.5',
    formulaTex: String.raw`\begin{aligned}\text{(A) none：}&\ w^*=a+\frac{b\,E[x]+c_2E[x^3]}{E[x^2]}\\ \text{(B) shared BBPD：}&\ w^*\approx a+\frac{c_2\operatorname{Cov}(x,x^2)}{\operatorname{Var}(x)}\\ \text{(C) linear PD：}&\ w^*\approx a+\frac{b\,E[x]+c_2\operatorname{Cov}(x,x^2)}{\operatorname{Var}(x)}\end{aligned}`,
    level: 'beginner',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'b', symbol: 'b', label: 'comparator／PD 的靜態 offset', unit: TU, default: 0.5, min: -5, max: 5, practice: { choices: [-0.5, -0.2, 0.1, 0.2, 0.5, 1] } },
      { key: 'c2', symbol: 'c_2', label: '二階 INL 係數', unit: TU, default: 0, min: -1, max: 1, practice: { choices: [0, 0, 0.05, 0.1] } },
      { key: 'x1', symbol: 'x_1', label: '第 1 個 code', default: 0, min: -16, max: 16, practice: { min: -1, max: 1, step: 1 } },
      { key: 'x2', symbol: 'x_2', label: '第 2 個 code', default: 1, min: -16, max: 16, practice: { min: 0, max: 2, step: 1 } },
      { key: 'x3', symbol: 'x_3', label: '第 3 個 code', default: 2, min: -16, max: 16, practice: { min: 1, max: 3, step: 1 } },
      { key: 'x4', symbol: 'x_4', label: '第 4 個 code', default: 3, min: -16, max: 16, practice: { min: 2, max: 4, step: 1 } },
    ],
    validate: ({ x1, x2, x3, x4 }) =>
      codeMoments(codeSet([x1, x2, x3, x4])).varX > 1e-12
        ? null
        : '四個 code 都相同：$\\operatorname{Var}(x)=0$。主迴路把 code 的平均值移除後沒有任何激勵，(B)(C) 的分母為 0（不可辨識）；置中後 $x_c\\equiv0$ 也一樣。請至少讓兩個 code 不同。',
    solve: ({ a, b, c2, x1, x2, x3, x4 }) => {
      const xs = [x1, x2, x3, x4]
      const dist = codeSet(xs)
      const mo = codeMoments(dist)
      const m = mk({ a, b, c2, sigmaV: 1 })
      const [wA, wB, wC] = DC_MODES.map((mode) => linearizedFixedPoint(m, dist, mode, false).w)
      const Ex = chop(mo.Ex, mo.Ex2)
      const Ex3 = chop(mo.Ex3)
      // 中間量只用來顯示（答案 wA／wB／wC 來自模型的 linearizedFixedPoint）；chop 去掉 0.15 − 0.15 = 2.8e−17 之類的浮點殘渣
      const bEx = b * Ex
      const numA = chop(bEx + c2 * Ex3)
      const cov = chop(mo.Ex3 - Ex * mo.Ex2, mo.Ex3)
      const numB = c2 * cov
      const numC = chop(bEx + numB)
      const xc = xs.map((x) => chop(x - mo.Ex))
      const centred = codeSet(xc)
      const moC = codeMoments(centred)
      const wCentred = linearizedFixedPoint(mk({ a, b, sigmaV: 1 }), centred, 'none', false).w
      const notes: string[] = []
      if (b !== 0 && Ex !== 0)
        notes.push(
          String.raw`offset 項：(C) 是 (A) 的 $E[x^2]/\operatorname{Var}(x)=${texNum(mo.Ex2 / mo.varX, 4)}$ 倍，(B) 則完全消失 —— 同一顆 comparator offset，換一個主迴路架構影響就完全不同（勘誤 E03）。`,
        )
      notes.push(
        String.raw`置中後 (A) 的 offset bias 為 0（模型：$w^*=${texNum(chop(wCentred - a) + a)}$），但有效激勵從 $E[x^2]=${texNum(mo.Ex2)}$ 降到 $\operatorname{Var}(x)=${texNum(mo.varX)}$：GMAC 斜率與收斂速度一起變成 $${texNum(mo.varX / mo.Ex2, 3)}$ 倍。`,
      )
      try {
        const mf = DC_MODES.map((mode) => signFixedPoint(m, dist, mode))
        if (mf.every((r) => r.status === 'ok' && Number.isFinite(r.w)))
          notes.push(
            String.raw`Sign-LMS 的 mean-field 精確根（$\sigma_v=1$，Lab 以 root finding 計算，無法手算）：(A) $${texNum(mf[0].w)}$、(B) $${texNum(mf[1].w)}$、(C) $${texNum(mf[2].w)}$；與上面一階公式的差就是 comparator 線性化的誤差。`,
          )
      } catch {
        /* mean-field 根只是補充說明；求不出來就不顯示 */
      }
      return {
        steps: [
          {
            tex: String.raw`E[x]=\tfrac14\big(${plus(xs, SUM)}\big)=\tfrac{${texNum(chop(total(xs)), SUM)}}{4}=${texNum(Ex, SUM)}`,
            why: `4 個 code 等機率，各 $1/4$。${Ex === 0 ? '$E[x]=0$：這組 code 已經置中，常數 offset 與 code 正交（$E[x\\,b]=b\\,E[x]=0$）。' : '$E[x]\\neq0$：code 沒有置中，常數 offset 與 code 不正交（$E[x\\,b]=b\\,E[x]$，$b\\neq0$ 時不是 0；它與 code 的共變異數則永遠是 0）。'}`,
          },
          {
            tex: String.raw`E[x^2]=\tfrac14\big(${plus(xs.map((x) => x * x), SUM)}\big)=\tfrac{${texNum(total(xs.map((x) => x * x)), SUM)}}{4}=${texNum(mo.Ex2, SUM)}`,
            why: '每個 code 先平方再平均（code 的功率，也是 (A) 的分母）。',
          },
          {
            tex: String.raw`E[x^3]=\tfrac14\big(${plus(xs.map((x) => x ** 3), SUM)}\big)=\tfrac{${texNum(chop(total(xs.map((x) => x ** 3))), SUM)}}{4}=${texNum(Ex3, SUM)}`,
            why: '二階 INL 需要它：$E[x\\cdot c_2x^2]=c_2E[x^3]$。$c_2=0$ 時這一項會乘上 0。',
          },
          {
            tex: String.raw`b\,E[x]+c_2E[x^3]=${texNumP(b)}\times${texNumP(Ex, SUM)}+${texNumP(c2)}\times${texNumP(Ex3, SUM)}=${texNum(bEx, MID)}+${texNumP(c2 * Ex3, MID)}=${texNum(numA, MID)}`,
            why: '(A) 的分子：offset 與 code 的相關，加上 INL 與 code 的相關。兩個乘積分開算，再相加。',
          },
          {
            tex: String.raw`w^*_\mathrm{(A)}=a+\frac{b\,E[x]+c_2E[x^3]}{E[x^2]}=${texNum(a)}+\frac{${texNum(numA, MID)}}{${texNum(mo.Ex2, SUM)}}=${texNum(a)}+${texNumP(numA / mo.Ex2, MID)}=${texNum(wA)}`,
            why: '靜態式（F-11.5）：主迴路 frozen 或沒有積分路徑，PD 的 DC 原封不動到達 comparator。先除，再加上 $a$。',
          },
          {
            tex: String.raw`\operatorname{Var}(x)=E[x^2]-E[x]^2=${texNum(mo.Ex2, SUM)}-${texNumP(Ex, SUM)}^2=${texNum(mo.Ex2, SUM)}-${texNum(Ex * Ex, SUM)}=${texNum(mo.varX, SUM)}`,
            why: '主迴路把 DC 消掉之後，有效的激勵只剩 code 的「變動部分」。',
          },
          {
            tex: String.raw`\operatorname{Cov}(x,x^2)=E[x^3]-E[x]\,E[x^2]=${texNum(Ex3, SUM)}-${texNumP(Ex, SUM)}\times${texNum(mo.Ex2, SUM)}=${texNum(Ex3, SUM)}-${texNumP(Ex * mo.Ex2, SUM)}=${texNum(cov, SUM)}`,
            why: '共變異數 = 相關減去平均的乘積。常數 $b$ 與 $x$ 的共變異數是 0，所以 (B) 的分子沒有 $b$。',
          },
          {
            tex: String.raw`w^*_\mathrm{(B)}=a+\frac{c_2\operatorname{Cov}(x,x^2)}{\operatorname{Var}(x)}=${texNum(a)}+\frac{${texNumP(c2)}\times${texNumP(cov, SUM)}}{${texNum(mo.varX, SUM)}}=${texNum(a)}+\frac{${texNum(numB, MID)}}{${texNum(mo.varX, SUM)}}=${texNum(a)}+${texNumP(numB / mo.varX, MID)}=${texNum(wB)}`,
            why: '共用 BBPD（F-11.6）：type-II 主迴路強制 $E[q]=0$，offset 被吸收成 static phase offset $\\varphi$。',
          },
          {
            tex: String.raw`w^*_\mathrm{(C)}=a+\frac{b\,E[x]+c_2\operatorname{Cov}(x,x^2)}{\operatorname{Var}(x)}=${texNum(a)}+\frac{${texNum(bEx, MID)}+${texNumP(numB, MID)}}{${texNum(mo.varX, SUM)}}=${texNum(a)}+\frac{${texNum(numC, MID)}}{${texNum(mo.varX, SUM)}}=${texNum(a)}+${texNumP(numC / mo.varX, MID)}=${texNum(wC)}`,
            why: '線性 PD 鎖定 + 帶 offset 的獨立 comparator（F-11.7）：分子保留 $bE[x]$（第 4 步算過）與 $c_2\\operatorname{Cov}$（上一步算過），分母卻變成較小的 $\\operatorname{Var}(x)$。',
          },
          {
            tex: String.raw`x_c=x-E[x]=\big(${list(xc, SUM)}\big):\quad E[x_c]=${texNum(chop(moC.Ex))},\quad \frac{b\,E[x_c]}{E[x_c^2]}=\frac{${texNumP(b)}\times0}{${texNum(moC.Ex2, SUM)}}=0`,
            why: 'code 置中（centering）：每個 code 減掉平均。$E[x_c]=0$ 讓 (A) 的 offset 項消失，而 $E[x_c^2]$ 就是 $\\operatorname{Var}(x)$。',
          },
        ],
        results: [
          { symbol: String.raw`w^*_\mathrm{(A)}`, label: '(A) none：靜態式', value: wA, unit: TU },
          { symbol: String.raw`w^*_\mathrm{(B)}`, label: '(B) shared BBPD', value: wB, unit: TU },
          { symbol: String.raw`w^*_\mathrm{(C)}`, label: '(C) linear PD + 獨立 comparator', value: wC, unit: TU },
          { symbol: String.raw`\operatorname{Var}(x)`, label: '置中後的有效激勵 $E[x_c^2]$', value: mo.varX },
        ],
        notes,
      }
    },
    tips: [
      '預設值是勘誤 E03 的例子（$x\\in\\{0,1,2,3\\}$、$b=0.5$）：一階公式 1.2143／1／1.6。改成 $b=0$、$c_2=0.1$ 可重現第二個例子 1.2571／1.3／1.3。',
      '4 個 code 的平均都是除以 4：先把分子加起來，最後才除，可以避免中途四捨五入。',
      '想直接看「置中」的效果：把四個 code 改成 $-1.5,\\,-0.5,\\,0.5,\\,1.5$，三種架構的 offset bias 都是 0。',
      '非負的 residue 最吃虧：$x\\in[0,1)$ 均勻分布時 $E[x^2]=1/3$ 而 $\\operatorname{Var}(x)=1/12$，(C) 的 offset 項是 (A) 的 4 倍。',
    ],
  },

  /* ───────────── HC-11.4：動差與 MSE 最佳線性 gain（§11.2 情境 1） ───────────── */
  {
    id: 'HC-11.4',
    title: '自訂 5 個 code：動差與 MSE-LMS 的最佳線性 gain',
    page: PAGE,
    formulaId: 'F-11.8',
    formulaTex: String.raw`E[x^k]=\frac15\sum_{i=1}^{5}x_i^{\,k},\qquad e=(a-w)\,x+c_3x^3,\qquad E[x\,e]=0\ \Rightarrow\ w^*_\mathrm{MSE}=a+c_3\,\frac{E[x^4]}{E[x^2]}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'c3', symbol: 'c_3', label: '三階 INL 係數', unit: TU, default: 0.1, min: -1, max: 1, practice: { choices: [-0.1, 0.05, 0.1, 0.2] } },
      { key: 'x1', symbol: 'x_1', label: '第 1 個 code', default: -2, min: -16, max: 16, practice: { min: -3, max: 3, step: 1 } },
      { key: 'x2', symbol: 'x_2', label: '第 2 個 code', default: -1, min: -16, max: 16, practice: { min: -3, max: 3, step: 1 } },
      { key: 'x3', symbol: 'x_3', label: '第 3 個 code', default: 0, min: -16, max: 16, practice: { min: -3, max: 3, step: 1 } },
      { key: 'x4', symbol: 'x_4', label: '第 4 個 code', default: 1, min: -16, max: 16, practice: { min: -3, max: 3, step: 1 } },
      { key: 'x5', symbol: 'x_5', label: '第 5 個 code', default: 2, min: -16, max: 16, practice: { min: -3, max: 3, step: 1 } },
    ],
    validate: ({ x1, x2, x3, x4, x5 }) =>
      [x1, x2, x3, x4, x5].some((x) => x !== 0)
        ? null
        : '五個 code 都是 0：$E[x^2]=0$，GMAC 對 $w$ 沒有任何敏感度（沒有激勵，不可辨識），$w^*$ 沒有定義。請至少輸入一個非零的 code。',
    solve: ({ a, c3, x1, x2, x3, x4, x5 }) => {
      const xs = [x1, x2, x3, x4, x5]
      const dist = codeSet(xs)
      const mo = codeMoments(dist)
      const wStar = mseFixedPoint(mk({ a, c3 }), dist)
      const sq = xs.map((x) => x * x)
      const q4 = sq.map((s) => s * s)
      const exd = c3 * mo.Ex4
      const bias = chop(wStar - a)
      const mags = xs.filter((x) => x !== 0).map(Math.abs)
      const collinear = mags.length > 0 && Math.max(...mags) - Math.min(...mags) < 1e-12
      return {
        steps: [
          { tex: String.raw`x_i^2:\quad ${xs.map((x) => `${texNumP(x)}^2`).join(String.raw`,\ `)}\;=\;${list(sq, SUM)}`, why: '把每個 code 平方（負號消失）。' },
          { tex: String.raw`E[x^2]=\tfrac15\big(${plus(sq, SUM)}\big)=\tfrac{${texNum(total(sq), SUM)}}{5}=${texNum(mo.Ex2, SUM)}`, why: '期望值 = 機率加權和；5 個 code 各 $1/5$。$E[x^2]$ 是 code 的功率（激勵的大小）。' },
          { tex: String.raw`x_i^4=(x_i^2)^2:\quad ${sq.map((v) => `${texNumP(v, SUM)}^2`).join(String.raw`,\ `)}\;=\;${list(q4, SUM)}`, why: '四次方 = 平方再平方：把上一步的結果再平方一次，大的 code 被放大得更多。' },
          { tex: String.raw`E[x^4]=\tfrac15\big(${plus(q4, SUM)}\big)=\tfrac{${texNum(total(q4), SUM)}}{5}=${texNum(mo.Ex4, SUM)}`, why: '同樣的平均，對象換成四次方。' },
          { tex: String.raw`E[x\,d(x)]=c_3\,E[x^4]=${texNumP(c3)}\times${texNum(mo.Ex4, SUM)}=${texNum(exd, MID)}`, why: '$d(x)=c_3x^3$，所以 $x\\,d(x)=c_3x^4$；$c_3$ 是常數可以提到期望值外面。這是 F-11.4 分子的 INL 項。' },
          { tex: String.raw`w^*-a=\frac{E[x\,d(x)]}{E[x^2]}=\frac{${texNum(exd, MID)}}{${texNum(mo.Ex2, SUM)}}=${texNum(bias, MID)}`, why: '$E[x\\,e]=(a-w^*)E[x^2]+c_3E[x^4]=0$ 移項後除以 $E[x^2]$。$w^*-a$ 是全站 $\\delta=a-w$ 的負值：正的 $c_3$ 讓 $w^*$ 高於 $a$。' },
          { tex: String.raw`w^*_\mathrm{MSE}=a+(w^*-a)=${texNum(a)}+${texNumP(bias, MID)}=${texNum(wStar)}`, why: 'MSE-LMS 的固定點：一次方程的精確解（T12a）。' },
        ],
        results: [
          { symbol: 'E[x^2]', label: 'code 的二階動差', value: mo.Ex2 },
          { symbol: 'E[x^4]', label: 'code 的四階動差', value: mo.Ex4 },
          { symbol: String.raw`w^*_\mathrm{MSE}`, label: 'MSE-LMS 的最佳線性 gain', value: wStar, unit: TU },
        ],
        notes: [
          collinear
            ? String.raw`所有非零 code 的 $|x|$ 都等於 $${texNum(mags[0])}$：$x^3=${mags[0] === 1 ? '' : String.raw`${texNum(mags[0] ** 2)}\,`}x$ 與 gain 項共線，三階 INL 完全被當成 gain 誤差（$w^*=a+c_3x^2$，不可辨識；勘誤 E11 的 $\pm1$ code 例）。`
            : String.raw`$E[x^4]/E[x^2]=${texNum(mo.Ex4 / mo.Ex2)}$ 完全由 code 分布決定：同樣的 $a$、$c_3$，換一組 code 答案就變（勘誤 E11）。驗收值一定要連同 code 分布一起指定。`,
          '這個式子不需要 code 對稱：只有三階 INL 時 $E[x\\cdot c_3x^3]=c_3E[x^4]$ 對任何 code 集合都成立。',
        ],
      }
    },
    tips: [
      '預設的 $\\{-2,-1,0,1,2\\}$ 得到 $E[x^2]=2$、$E[x^4]=6.8$、$w^*=1.34$（測試 T12 的 golden vector）。',
      '把五個 code 都改成 $\\pm1$（例如 $-1,-1,1,1,1$）會得到 1.10：此時 $x^3=x$，INL 與 gain 分不開。',
      '重複同一個值等於提高它的機率，例如 $-2,-2,0,2,2$ 代表 $\\pm2$ 各 40%、0 佔 20%。',
    ],
  },

  /* ───────────── HC-11.5：Sign-LMS 的 σ_v 二階修正（§11.2 情境 2） ───────────── */
  {
    id: 'HC-11.5',
    title: 'Sign-LMS 的 $\\sigma_v$ 二階修正：離 MSE 解多遠？需要多少雜訊？',
    page: PAGE,
    formulaId: 'F-11.9',
    formulaTex: String.raw`w^*_\mathrm{sign}\approx w_1+\Delta,\qquad \Delta=-\frac{E[x\,e_0^3]}{6\,\sigma_v^2\,E[x^2]},\qquad e_0(x)=(a-w_1)\,x+c_3x^3,\\[0.4em] |\Delta|\le\varepsilon\iff\sigma_v\ge\sigma_{v,\min}=\sqrt{\frac{|\Delta|\,\sigma_v^2}{\varepsilon}}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'c3', symbol: 'c_3', label: '三階 INL 係數', unit: TU, default: 0.1, min: -1, max: 1, practice: { choices: [0.05, 0.1, 0.2] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊的標準差', unit: TU, default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
      { key: 'eps', symbol: String.raw`\varepsilon`, label: '可接受的固定點偏差', unit: TU, default: 0.001, min: 0, max: 1, practice: { choices: [0.0005, 0.001, 0.002, 0.005] } },
    ],
    validate: ({ a, c3, sigma, eps }) => {
      if (!(sigma > 0)) return '$\\sigma_v=0$：erf 退化成 sign，沒有泰勒展開可用。無雜訊的固定點是 $|x|$ 加權中位數（HC-11.6），不是 $w_1+\\Delta$。'
      if (!(eps > 0)) return '$\\varepsilon$ 必須大於 0：它是你願意接受的 $|w^*_\\mathrm{sign}-w_1|$。'
      const m = mk({ a, c3, sigmaV: sigma })
      const w1 = mseFixedPoint(m, FIVE)
      const ratio = Math.max(...FIVE.values.map((x) => Math.abs(eDet(x, w1, m)))) / sigma
      if (ratio > SECOND_ORDER_MAX_RATIO * (1 + 1e-9))
        return String.raw`$\max|e_0|/\sigma_v=${texNum(ratio, 4)}>${SECOND_ORDER_MAX_RATIO}$：殘差已經比雜訊大，erf 只取到三次項的低階截斷不再準確，二階修正不可靠（erf 的泰勒級數本身對任何有限引數都收斂，失準的是截斷；殘差再大就會給出荒謬的值，本章例子在 $\sigma_v=0.05$ 時算出大於 1.4）。請加大 $\sigma_v$，或改用 Lab 的 mean-field 根。`
      return null
    },
    solve: ({ a, c3, sigma, eps }) => {
      const m = mk({ a, c3, sigmaV: sigma })
      const mo = codeMoments(FIVE)
      const w1 = mseFixedPoint(m, FIVE)
      const d = chop(a - w1)
      const e1 = chop(eDet(1, w1, m))
      const e2 = chop(eDet(2, w1, m))
      // c_3 = 0 時所有殘差都是 0：把 (1e−16)³ 之類的浮點殘渣直接歸零
      const exe3 = c3 === 0 ? 0 : expectation(FIVE, (x) => x * eDet(x, w1, m) ** 3)
      const w2 = signSecondOrder(m, FIVE)
      // Δ = w2 − w1。直接相減在 Δ 很小（c_3 很小或 σ_v 很大）時會損失有效位數，所以顯示用與 signSecondOrder
      // 同一行算式 −E[x e_0³]/(6σ_v²E[x²])（E[·] 都來自模型的 expectation／codeMoments；測試確認它等於 w2 − w1）
      const den = 6 * sigma * sigma * mo.Ex2
      const delta = c3 === 0 ? 0 : -exe3 / den
      const c13 = e1 ** 3
      const c23 = e2 ** 3
      const inner = c13 + 2 * c23
      const dsq = Math.abs(delta) * sigma * sigma
      const sigMin = Math.sqrt(dsq / eps)
      const emax = Math.max(Math.abs(e1), Math.abs(e2))
      const ratio = emax / sigma
      const exact = signFixedPoint(m, FIVE)
      const notes: string[] = []
      if (exact.status === 'ok') {
        const gap = Math.abs(w2 - exact.w)
        // 差距小於 1e−12 時已經是求根容差與浮點捨入的量級，不當成有意義的數字顯示
        notes.push(
          gap < 1e-12
            ? String.raw`mean-field 精確根（Lab 的 Brent root finding，無法手算）：$${texNum(exact.w, 10)}$，在這 10 位有效數字內與二階近似相同。`
            : String.raw`mean-field 精確根（Lab 的 Brent root finding，無法手算）：$${texNum(exact.w, 10)}$；二階近似與它相差 $${texNum(gap, 2)}$。`,
        )
      }
      notes.push(
        delta === 0
          ? '$\\Delta=0$：沒有 INL 時每個 code 的殘差都是 0，Sign-LMS 與 MSE-LMS 停在同一點。'
          : String.raw`$\Delta\propto1/\sigma_v^2$：雜訊越小，Sign-LMS 的固定點離 $w_1$ 越遠（往無雜訊的加權中位數移動）。目前 $\max|e_0|/\sigma_v=${texNum(ratio, 4)}$；$\sigma_v${sigma >= sigMin ? String.raw`\ge` : '<'}\sigma_{v,\min}$，所以 $|\Delta|${sigma >= sigMin ? String.raw`\le` : '>'}\varepsilon$。`,
      )
      if (sigMin > 0 && emax / sigMin > SECOND_ORDER_MAX_RATIO) {
        // σ_v → 0 的極限是 |x| 加權中位數（模型的 signWeightedMedian）：固定點離 w_1 最遠也只到那裡
        const med = signWeightedMedian(mk({ a, c3 }), FIVE.values, FIVE.probs)
        const maxDev = Math.max(Math.abs(med.lo - w1), Math.abs(med.hi - w1))
        notes.push(
          eps >= maxDev
            ? String.raw`注意：就算完全沒有雜訊，固定點也只會移到 $|x|$ 加權中位數 $${texNum(med.lo)}$（HC-11.6），離 $w_1$ 只有 $${texNum(maxDev, 3)}\le\varepsilon$ —— 這個 $\varepsilon$ 下任何 $\sigma_v$ 都合格，上面算出的 $\sigma_{v,\min}$ 落在二階近似的適用範圍之外（$\max|e_0|/\sigma_{v,\min}=${texNum(emax / sigMin, 3)}>${SECOND_ORDER_MAX_RATIO}$），沒有實際意義。`
            : String.raw`注意：在 $\sigma_v=\sigma_{v,\min}$ 處 $\max|e_0|/\sigma_{v,\min}=${texNum(emax / sigMin, 3)}>${SECOND_ORDER_MAX_RATIO}$，已經超出二階近似的適用範圍 —— 這個 $\sigma_{v,\min}$ 只能當量級估計（$\varepsilon$ 訂得太寬了），實際門檻請用 Lab 的 mean-field 根確認。`,
        )
      }
      return {
        steps: [
          {
            tex: String.raw`w_1=a+c_3\frac{E[x^4]}{E[x^2]}=${texNum(a)}+${texNumP(c3)}\times\frac{${texNum(mo.Ex4)}}{${texNum(mo.Ex2)}}=${texNum(a)}+${texNumP(c3)}\times${texNum(mo.Ex4 / mo.Ex2)}=${texNum(a)}+${texNumP(chop(w1 - a), 10)}=${texNum(w1, 10)}`,
            why: '一階（$K_q$ 線性化）的解就是 MSE-LMS 的固定點（HC-11.4）；5-level code 的 $E[x^2]=2$、$E[x^4]=6.8$。先除、再乘、最後加。',
          },
          {
            tex: String.raw`e_0(1)=(a-w_1)\cdot1+c_3\cdot1^3=(${texNum(a)}-${texNumP(w1, 10)})+${texNumP(c3)}=${texNum(d, 10)}+${texNumP(c3)}=${texNum(e1, 10)}`,
            why: String.raw`$w_1$ 處 code $x=1$ 的殘差：先算 $a-w_1=${texNum(d, 10)}$（全站的 $\delta=a-w$），再加上 INL 項。`,
          },
          {
            tex: String.raw`e_0(2)=(a-w_1)\cdot2+c_3\cdot2^3=${texNumP(d, 10)}\times2+${texNumP(c3)}\times8=${texNum(2 * d, 10)}+${texNumP(8 * c3)}=${texNum(e2, 10)}`,
            why: '$w_1$ 處 code $x=2$ 的殘差：gain 項 2 倍、INL 項 8 倍。',
          },
          {
            tex: String.raw`e_0(1)^3=${texNumP(e1, 10)}^3=${texNum(c13, 6)},\qquad e_0(2)^3=${texNumP(e2, 10)}^3=${texNum(c23, 6)}`,
            why: '三次方：連乘三次（負數的三次方仍為負）。',
          },
          {
            tex: String.raw`E[x\,e_0^3]=\tfrac25\big[1\cdot e_0(1)^3+2\cdot e_0(2)^3\big]\\ \qquad=\tfrac25\big(${texNum(c13, 6)}+2\times${texNumP(c23, 6)}\big)=\tfrac25\big(${texNum(c13, 6)}+${texNumP(2 * c23, 6)}\big)=\tfrac25\times${texNumP(inner, 6)}=${texNum(exe3, 6)}`,
            why: '$x\\,e_0^3$ 是偶函數（奇函數乘奇函數），$\\pm x$ 兩項相同，所以 5 個 code 的平均 = $\\tfrac25\\times$（$x=1$ 與 $x=2$ 兩項之和）；$\\tfrac25$ 就是乘 0.4。',
          },
          {
            tex: String.raw`\Delta=-\frac{E[x\,e_0^3]}{6\,\sigma_v^2\,E[x^2]}=-\frac{${texNum(exe3, 6)}}{6\times${texNum(sigma)}^2\times${texNum(mo.Ex2)}}=-\frac{${texNum(exe3, 6)}}{${texNum(den, 6)}}=${texNum(delta, 7)}`,
            why: 'erf 的三次項造成的修正（F-11.9）：分母 $6\\sigma_v^2E[x^2]$ 先算好（$\\sigma_v$ 先平方），再做一次除法。別漏掉最前面的負號：$\\Delta$ 與 $E[x\\,e_0^3]$ 異號（$c_3>0$ 時 $\\Delta>0$）。',
          },
          {
            tex: String.raw`w^*_\mathrm{sign}\approx w_1+\Delta=${texNum(w1, 10)}+${texNumP(delta, 7)}=${texNum(w2, 10)}`,
            why: 'Sign-LMS + Gaussian 雜訊的固定點（二階近似）。$\\Delta=w^*_\\mathrm{sign}-w_1$ 是固定點的修正量，不是全站的 $\\delta=a-w$；它很小，答案要寫到小數第 7 位以後才看得出差別。',
          },
          {
            tex: String.raw`\sigma_{v,\min}=\sqrt{\frac{|\Delta|\,\sigma_v^2}{\varepsilon}}=\sqrt{\frac{${texNum(Math.abs(delta), 7)}\times${texNum(sigma)}^2}{${texNum(eps)}}}=\sqrt{\frac{${texNum(dsq, 7)}}{${texNum(eps)}}}=\sqrt{${texNum(dsq / eps, MID)}}=${texNum(sigMin)}`,
            why: '$|\\Delta|\\sigma_v^2$ 與 $\\sigma_v$ 無關（F-11.9 的係數），所以 $|\\Delta|\\le\\varepsilon$ 等價於 $\\sigma_v\\ge\\sigma_{v,\\min}$。計算機：先乘、再除，最後按開根號 $\\sqrt{\\ }$。',
          },
        ],
        results: [
          { symbol: 'w_1', label: '一階（= MSE-LMS）解', value: w1, unit: TU },
          { symbol: String.raw`\Delta`, label: 'erf 三次項的修正量', value: delta, unit: TU },
          { symbol: String.raw`w^*_\mathrm{sign}`, label: 'Sign-LMS 固定點（二階近似）', value: w2, unit: TU, digits: 10, tolerance: { abs: 0.02 * Math.abs(delta) + 1e-9, rel: 0 } },
          { symbol: String.raw`\sigma_{v,\min}`, label: '讓 $|\\Delta|\\le\\varepsilon$ 所需的最小雜訊', value: sigMin, unit: TU },
        ],
        notes,
      }
    },
    tips: [
      '預設值重現 F-11.9：$\\Delta=3.456\\times10^{-4}$、$w^*_\\mathrm{sign}\\approx1.3403456$（mean-field 精確根 1.3403458，T12b），以及內文的「$\\sigma_v>0.588$ 才能把 1.34 當驗收值」。',
      '$w^*_\\mathrm{sign}$ 要寫到小數第 6–7 位才看得出修正量；對答案時容許 $\\Delta$ 的 2% 誤差。',
      '把 $\\sigma_v$ 改成 10 或 100，可與 golden vector T12 的 1.3400034560、1.3400000346 對照（二階近似給 1.340003456、1.340000035）。',
      '$\\sigma_v$ 太小（$\\max|e_0|/\\sigma_v>1.2$）時本題會拒絕計算：那時要用 mean-field 根，或 HC-11.6 的中位數極限。',
    ],
  },

  /* ───────────── HC-11.6：無雜訊 Sign-LMS = |x| 加權中位數（§11.2 情境 3） ───────────── */
  {
    id: 'HC-11.6',
    title: '無雜訊 Sign-LMS：$|x|$ 加權中位數（對照 MSE 的 $x^2$ 加權平均）',
    page: PAGE,
    formulaId: 'F-11.10',
    formulaTex: String.raw`t(x)=a+\frac{b}{x}+c_3x^2,\qquad E[G](w)=\sum_{x\neq0}p\,|x|\operatorname{sign}\big(t(x)-w\big)\ \text{由正變負的位置}=w^*\ \ (\text{加權中位數}),\\[0.4em] w^*_\mathrm{MSE}=\frac{\sum p\,x^2\,t(x)}{\sum p\,x^2}\ \ (\text{加權平均})`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'b', symbol: 'b', label: 'comparator／PD 的靜態 offset', unit: TU, default: 0, min: -5, max: 5, practice: { choices: [0, 0, 0.05, 0.1, -0.1] } },
      { key: 'c3', symbol: 'c_3', label: '三階 INL 係數', unit: TU, default: 0.1, min: -1, max: 1, practice: { choices: [0, 0.05, 0.1, 0.2] } },
    ],
    solve: ({ a, b, c3 }) => {
      const m = mk({ a, b, c3 })
      const p = FIVE.probs[0]
      const codes = [-2, -1, 1, 2]
      const t = (x: number) => perCodeGain(x, m)
      const med = signWeightedMedian(m, FIVE.values, FIVE.probs)
      const mean = mseWeightedMean(m, FIVE.values, FIVE.probs)
      const dead = med.hi - med.lo > 1e-9
      // 投票表：依 t 由小到大排序、相同的 t 合併、累積票重（只用來顯示；答案以 signWeightedMedian 為準）
      const rows: { t: number; xs: number[]; wt: number; cum: number }[] = []
      for (const r of codes.map((x) => ({ x, t: t(x), wt: p * Math.abs(x) })).sort((u, v) => u.t - v.t || u.x - v.x)) {
        const last = rows[rows.length - 1]
        if (last && Math.abs(last.t - r.t) <= 1e-12 * (1 + Math.abs(r.t))) {
          last.xs.push(r.x)
          last.wt += r.wt
        } else rows.push({ t: r.t, xs: [r.x], wt: r.wt, cum: 0 })
      }
      let cum = 0
      for (const r of rows) {
        cum += r.wt
        r.cum = cum
      }
      const half = cum / 2
      const hit = rows.findIndex((r) => Math.abs(r.t - med.lo) <= 1e-9 * (1 + Math.abs(med.lo)))
      const table = [
        String.raw`\begin{array}{c|c|c|c}t(x)\ \text{（由小到大）}&\text{code }x&\text{票重 }p\,|x|&\text{累積票重}\\\hline`,
        rows.map((r, i) => String.raw`${texNum(r.t)}&${list(r.xs)}&${texNum(r.wt)}&${texNum(r.cum)}${i === hit ? String.raw`\ \leftarrow` : ''}`).join(String.raw`\\`),
        String.raw`\end{array}`,
      ].join('')
      // w* 兩側（或 dead zone 內）的平均 GMAC：由模型的 meanGmacSign 計算
      const gaps = rows.slice(1).map((r, i) => r.t - rows[i].t)
      const h = Math.min(1e-6 * (1 + Math.abs(med.lo)), ...gaps.map((g) => g / 4))
      const gBelow = chop(meanGmacSign(med.lo - h, m, FIVE))
      const gAbove = chop(meanGmacSign(med.hi + h, m, FIVE))
      const gInside = dead ? chop(meanGmacSign((med.lo + med.hi) / 2, m, FIVE)) : Number.NaN
      const votes = (w: number) => rows.map((r) => (r.t > w ? r.wt : -r.wt))
      /** 「-0.4+0.8=0.4」；只有一列時不重複寫成「1.2=1.2」 */
      const tally = (w: number, g: number) => (rows.length > 1 ? `${signedSum(votes(w))}=${texNum(g)}` : texNum(g))
      const wts = codes.map((x) => p * x * x)
      const prods = codes.map((x, i) => wts[i] * t(x))
      const numer = total(prods)
      const same = !dead && Math.abs(mean - med.lo) <= 1e-12 * (1 + Math.abs(mean))
      return {
        steps: [
          {
            tex: String.raw`\begin{aligned}t(1)&=a+\tfrac{b}{1}+c_3\cdot1^2=${texNum(a)}+${texNumP(b)}+${texNumP(c3)}=${texNum(t(1))}\\t(-1)&=a+\tfrac{b}{-1}+c_3\cdot(-1)^2=${texNum(a)}-${texNumP(b)}+${texNumP(c3)}=${texNum(t(-1))}\end{aligned}`,
            why: '每個 code 自己「想要」的 gain：令 $(a-t)x+b+c_3x^3=0$ 解 $t$。$w$ 等於 $t(x)$ 時，這個 code 的殘差剛好是 0。',
          },
          {
            tex: String.raw`\begin{aligned}t(2)&=a+\tfrac{b}{2}+c_3\cdot2^2=${texNum(a)}+${texNumP(b / 2)}+${texNumP(4 * c3)}=${texNum(t(2))}\\t(-2)&=a+\tfrac{b}{-2}+c_3\cdot(-2)^2=${texNum(a)}-${texNumP(b / 2)}+${texNumP(4 * c3)}=${texNum(t(-2))}\end{aligned}`,
            why: '$x=\\pm2$：offset 的影響減半（$b/x$），INL 的影響變 4 倍（$c_3x^2$）。$x=0$ 不投票（票重為 0）。',
          },
          {
            tex: String.raw`p\,|x|:\quad x=\pm1:\ \tfrac15\times1=${texNum(p)},\qquad x=\pm2:\ \tfrac15\times2=${texNum(2 * p)};\qquad \text{總票重}=${texNum(cum)},\quad \text{一半}=${texNum(half)}`,
            why: '無雜訊時 $x\\operatorname{sign}(e)=|x|\\operatorname{sign}(t(x)-w)$：每個 code 只投「往上／往下」一票，票的重量是機率乘 $|x|$。',
          },
          { tex: table, why: '把 $t$ 由小到大排好（相同的 $t$ 合併），一路累加票重，找「累積票重到達一半」的那一列（箭頭）。' },
          dead
            ? {
                tex: String.raw`\text{累積票重在 }t=${texNum(med.lo)}\text{ 剛好等於一半 }${texNum(half)}\ \Rightarrow\ E[G]=0\ \text{於整段}\ \big(${texNum(med.lo)},\ ${texNum(med.hi)}\big)`,
                why: '上下兩邊的票重剛好相等：$w$ 在這兩個 $t$ 之間的任何位置都讓平均 GMAC 為 0 —— 這是 dead zone，解不唯一。',
              }
            : {
                tex: String.raw`\text{累積票重在 }t=${texNum(med.lo)}\text{ 第一次超過一半 }${texNum(half)}\ \Rightarrow\ w^*=${texNum(med.lo)}`,
                why: '$w$ 低於它時「往上」的票較重，高於它時「往下」的票較重：零交越就在這個 $t$（加權中位數）。',
              },
          dead
            ? {
                tex: String.raw`E[G]\Big(\tfrac{${texNum(med.lo)}+${texNumP(med.hi)}}{2}\Big)=${tally((med.lo + med.hi) / 2, gInside)},\qquad E[G]\big(\text{稍低於 }${texNum(med.lo)}\big)=${tally(med.lo - h, gBelow)},\qquad E[G]\big(\text{稍高於 }${texNum(med.hi)}\big)=${tally(med.hi + h, gAbove)}`,
                why: '驗算：把每列的票重依 $\\operatorname{sign}(t-w)$ 加減（$t>w$ 的列投 $+$、$t<w$ 的列投 $-$，由上而下依表格的順序）。區間內為 0，區間外才有把 $w$ 推回來的力。',
              }
            : {
                tex: String.raw`E[G](w^*\text{ 稍低})=${tally(med.lo - h, gBelow)},\qquad E[G](w^*\text{ 稍高})=${tally(med.hi + h, gAbove)}`,
                why: '驗算：$t>w$ 的列投 $+$、$t<w$ 的列投 $-$（由上而下依表格的順序）。平均 GMAC 在 $w^*$ 由正跳到負，所以 $w$ 會被兩邊推回 $w^*$。',
              },
          {
            tex: String.raw`p\,x^2\,t(x):\quad ${codes.map((x, i) => String.raw`${texNum(wts[i])}\times${texNumP(t(x))}`).join(String.raw`,\ `)}\;=\;${list(prods)}`,
            why: '對照組 MSE-LMS：權重換成 $p\\,x^2$（依 $x=-2,-1,1,2$ 的順序是 $0.8,\\,0.2,\\,0.2,\\,0.8$），每個 $t(x)$ 先乘上自己的權重。',
          },
          {
            tex: String.raw`w^*_\mathrm{MSE}=\frac{\sum p\,x^2\,t(x)}{\sum p\,x^2}=\frac{${plus(prods)}}{${plus(wts)}}=\frac{${texNum(numer)}}{${texNum(total(wts))}}=${texNum(mean)}`,
            why: '加權「平均」= 上一步四個乘積的和，除以權重的和 $E[x^2]=2$。離得遠的意見拉得更用力，所以答案落在各個 $t$ 之間。',
          },
        ],
        results: [
          { symbol: String.raw`w^*_\mathrm{lo}`, label: '無雜訊 Sign-LMS 固定點（dead zone 時為下緣）', value: med.lo, unit: TU },
          { symbol: String.raw`w^*_\mathrm{hi}`, label: 'dead zone 上緣（解唯一時與上一格相同）', value: med.hi, unit: TU },
          { symbol: String.raw`w^*_\mathrm{MSE}`, label: 'MSE-LMS 固定點（$x^2$ 加權平均）', value: mean, unit: TU },
        ],
        notes: [
          dead
            ? String.raw`dead zone：$w$ 停在 $(${texNum(med.lo)},\,${texNum(med.hi)})$ 的哪裡由初值與 $\mu$ 決定（從下面進來停在下緣附近，從上面進來停在上緣附近）。加入一點雜訊（$\sigma_v>0$）才會有唯一的零交越。`
            : String.raw`實際的 $w$ 不會停在 $${texNum(med.lo)}$，而是在它附近以 $O(\mu)$ 的幅度來回跳（limit cycle）：下方每個 block 平均上升 $${texNum(Math.abs(gBelow))}\mu$，上方平均下降 $${texNum(Math.abs(gAbove))}\mu$。`,
          same
            ? String.raw`這一組的平均與中位數剛好相同（都是 $${texNum(mean)}$）${rows.length === 1 ? '：沒有 offset 也沒有 INL 時，每個 code 想要的 gain 都一樣，兩種演算法沒有差別' : ''}。把 $c_3$ 或 $b$ 改掉，兩個答案就會分開。`
            : String.raw`同一個誤差模型，MSE-LMS 停在 $${texNum(mean)}$（平均），無雜訊 Sign-LMS 停在${dead ? '一整段區間' : String.raw` $${texNum(med.lo)}$`}（中位數）：固定點由演算法的統計量決定，不由物理決定。`,
        ],
      }
    },
    tips: [
      '預設值（$b=0$、$c_3=0.1$）：$t(\\pm1)=1.1$（票重 0.4）、$t(\\pm2)=1.4$（票重 0.8），中位數 1.4、平均 1.34（T12c 與 T12a）。',
      '改成 $b=0.1$、$c_3=0$：累積票重剛好一半，得到 dead zone $(0.95,\\,1.05)$，也就是內文「置中的 code 也躲不過」的 $(a-b/2,\\,a+b/2)$。',
      '中位數只數票、不看差多少：把 $c_3$ 加倍，$t(\\pm2)$ 跟著移動，無雜訊 Sign-LMS 的答案就完全跟著最大的 code 走。',
    ],
  },

  /* ───────────── HC-11.7：κ 與 near-integer（§11.3、§11.4） ───────────── */
  {
    id: 'HC-11.7',
    title: '直接耦合的干擾 $\\kappa_d\\,x$：靜態是 $a+\\kappa_d$，near-integer 時被 $1/C$ 放大',
    page: PAGE,
    formulaId: 'F-11.14',
    formulaTex: String.raw`B=\kappa_d\,E[x^2],\qquad w^*=a+\frac{B}{C},\qquad \frac{\partial w^*}{\partial C}=-\frac{B}{C^2},\qquad S=K_q\,C,\quad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'kd', symbol: String.raw`\kappa_d`, label: '直接耦合到 PD 的干擾係數', unit: TU, default: 0.01, min: -1, max: 1, practice: { choices: [0.005, 0.01, 0.02, 0.05] } },
      { key: 'px', symbol: 'E[x^2]', label: 'code 的功率', default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'C', symbol: 'C', label: '有效相關 $E[x\\,(h*x)]$', default: 0.01, min: -100, max: 100, practice: { choices: [-0.02, 0.01, 0.02, 0.05, 0.1, 0.5, 1] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊的標準差', unit: TU, default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
    ],
    validate: ({ px, C, sigma }) => {
      if (!(px > 0)) return '$E[x^2]$ 必須大於 0：$x\\equiv0$ 時沒有任何激勵，也沒有 code-correlated 的干擾可言。'
      if (!(sigma > 0)) return '$\\sigma_v$ 必須大於 0：$K_q=\\sqrt{2/\\pi}/\\sigma_v$ 是有雜訊的 comparator 的小訊號增益（無雜訊時沒有線性化的斜率）。'
      if (C === 0) return '$C=0$：GMAC 對 $w$ 完全沒有敏感度（$S=K_qC=0$），$w^*=a+B/C$ 沒有定義 —— 這個 FCW 上 gain 不可辨識。請輸入非零的 $C$（負值代表極性錯誤，可以試）。'
      return null
    },
    solve: ({ a, kd, px, C, sigma }) => {
      const B = kd * px
      const st = nearIntegerSensitivity(B, px, sigma)
      const ni = nearIntegerSensitivity(B, C, sigma)
      const wStatic = a + st.bias
      const wNear = a + ni.bias
      const amp = px / C
      const notes: string[] = []
      if (!ni.attracting)
        notes.push(
          String.raw`$C<0$：$S=K_qC<0$，更新極性錯誤。$a+B/C=${texNum(wNear)}$ 是 repelling 的點 —— 正的 $\mu$ 會讓 $w$ 遠離它（發散），這個數字不是 LMS 會停下來的位置（Ch06）。`,
        )
      else if (C < px)
        notes.push(
          String.raw`$C$ 只有 $E[x^2]$ 的 $${texNum(C / px, 3)}$ 倍：同一個干擾造成的 bias 放大 $${texNum(amp, 4)}$ 倍，而恢復斜率 $S$ 縮小同樣的倍數，所以同一個 $\mu$ 下收斂也慢 $${texNum(amp, 4)}$ 倍。`,
        )
      else notes.push('$C\\ge E[x^2]$：主迴路沒有削弱 code 的相關（甚至因 peaking 而略為放大），bias 不比靜態式大。')
      if (ni.attracting && C < px) {
        // 線性化檢查（F-11.3）：near-integer 的 sawtooth 跳變高度 2√3·σ_x（零均值 code：σ_x = √E[x²]）原封不動通過 H_PD（h[0] = 1）
        const eMax = Math.abs(ni.bias) * 2 * Math.sqrt(3) * Math.sqrt(px)
        const rEst = eMax / sigma
        notes.push(
          rEst > LINEAR_OK_RATIO
            ? String.raw`線性化檢查（F-11.3）：near-integer 的 sawtooth（零均值的 code）每次跳變的高度是 $2\sqrt3\sqrt{E[x^2]}$，它會原封不動通過 $H_\mathrm{PD}$（$h[0]=1$），所以 $\max|e_\mathrm{det}|\approx|w^*-a|\cdot2\sqrt3\sqrt{E[x^2]}=${texNum(eMax, MID)}$，是 $\sigma_v$ 的 $${texNum(rEst, 4)}$ 倍，超過門檻 ${LINEAR_OK_RATIO}：這個 $a+B/C$ 只是線性外推，Sign-LMS 的平均 GMAC 在這一點並沒有歸零。超出不多時，真正的固定點在附近、離 $a$ 再遠一些；超出很多時，在實際的 gain 範圍內找不到吸引的固定點，$w$ 會一路往外漂（§11.4 的說明框、Ch06 F-06.19）。要回到線性範圍，至少需要 $\sigma_v\gtrsim${texNum((rEst * sigma) / LINEAR_OK_RATIO, 3)}$ 或 $|\kappa_d|\lesssim${texNum((Math.abs(kd) * LINEAR_OK_RATIO) / rEst, 3)}$；$C$ 很小時還要看下方實驗的殘餘比 $\gamma_\mathrm{lin}$。`
            : String.raw`線性化檢查（F-11.3）：以 near-integer 的 sawtooth 估計，$|w^*-a|\cdot2\sqrt3\sqrt{E[x^2]}/\sigma_v=${texNum(rEst, 4)}\le${LINEAR_OK_RATIO}$，第一個條件通過；$C$ 遠小於 $E[x^2]$ 時還要看下方實驗的殘餘比 $\gamma_\mathrm{lin}$（$|\gamma_\mathrm{lin}|\le0.05$ 才把 $a+B/C$ 當作 Sign-LMS 的固定點）。`,
        )
      }
      notes.push('靜態結果 $a+\\kappa_d$ 與 $E[x^2]$ 無關（分子分母約掉），而且只靠 $(x,q)$ 無法分辨 $(a,\\kappa_d)$ 與 $(a+\\kappa_d,0)$ 這兩個世界（F-11.13，不可辨識）。')
      return {
        steps: [
          { tex: String.raw`B=\kappa_d\,E[x^2]=${texNumP(kd)}\times${texNum(px)}=${texNum(B)}`, why: '干擾 $\\varepsilon_{cc}=\\kappa_d x$ 與 code 的相關：$E[x\\cdot\\kappa_dx]=\\kappa_dE[x^2]$（F-11.13）。它直接耦合到 PD，不經過主迴路的 $H_\\mathrm{PD}$。' },
          {
            tex: String.raw`w^*_{h=1}=a+\frac{B}{E[x^2]}=${texNum(a)}+\frac{${texNum(B)}}{${texNum(px)}}=${texNum(a)}+${texNumP(st.bias, MID)}=${texNum(wStatic)}`,
            why: '靜態（主迴路不濾 code，$h=1$）時 $C=E[x^2]$：$E[x^2]$ 約掉，bias 剛好是 $\\kappa_d$，與 code 分布無關。',
          },
          {
            tex: String.raw`w^*=a+\frac{B}{C}=${texNum(a)}+\frac{${texNum(B)}}{${texNum(C)}}=${texNum(a)}+${texNumP(ni.bias, MID)}=${texNum(wNear)}`,
            why: 'near-integer 時 gain 誤差從 PD 的 reference 輸入端進來，要先經過主迴路的誤差路徑才出現在 PD 的輸出，有效相關只剩 $C$；$B$ 卻沒有變小（F-11.14）。先除，再加上 $a$。',
          },
          { tex: String.raw`\frac{w^*-a}{\kappa_d}=\frac{E[x^2]}{C}=\frac{${texNum(px)}}{${texNum(C)}}=${texNum(amp)}`, why: 'bias 的放大倍數（相對於靜態的 $\\kappa_d$）：$C$ 越小放大越多；負值表示 bias 反向。' },
          {
            tex: String.raw`\frac{\partial w^*}{\partial C}=-\frac{B}{C^2}=-\frac{${texNum(B)}}{${texNumP(C)}^2}=-\frac{${texNum(B)}}{${texNum(C * C)}}=${texNum(ni.dBiasdC)}`,
            why: '對 $C$ 微分（F-11.15，$\\tfrac{d}{dC}\\tfrac1C=-\\tfrac1{C^2}$）：$C$ 隨 FCW、PVT 稍微變動，bias 就以 $1/C^2$ 的敏感度跟著變。先把 $C$ 平方，再除。',
          },
          { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(KQ_FACTOR, MID)}}{${texNum(sigma)}}=${texNum(ni.Kq, MID)}`, why: '計算機：$2\\div\\pi=0.63662$，按開根號得 $0.797885$，再除以 $\\sigma_v$。' },
          { tex: String.raw`S=K_q\,C=${texNum(ni.Kq, MID)}\times${texNumP(C)}=${texNum(ni.slope, MID)}`, why: 'GMAC 的恢復斜率 $S=-\\partial E[G]/\\partial w$（= 全站的 $K$，勘誤 E13）：$S>0$ 才收斂，時間常數約 $1/(\\mu S)$ 個 block。' },
        ],
        results: [
          { symbol: String.raw`w^*_{h=1}`, label: '靜態固定點 $a+\\kappa_d$', value: wStatic, unit: TU },
          { symbol: 'w^*', label: 'near-integer 的線性化固定點 $a+B/C$', value: wNear, unit: TU },
          { symbol: String.raw`\partial w^*/\partial C`, label: '對 $C$ 的敏感度', value: ni.dBiasdC, unit: TU },
          { symbol: 'S', label: 'GMAC 恢復斜率 $K_qC$', value: ni.slope, unit: PER_TU },
        ],
        notes,
      }
    },
    tips: [
      '預設值是 §11.4 表格的 $B=0.01$、$C=0.01$ 那一列：$w^*-a=1$、$\\partial w^*/\\partial C=-100$。把 $C$ 改成 1、0.1、$-0.01$ 可重現其餘三列。',
      '預設值的 $w^*-a=1$ 在 $\\sigma_v=1$ 下遠遠超出線性化範圍（補充觀察的「線性化檢查」：3.46，門檻 0.3）。算術沒有錯，但它描述的是線性模型；對 near-integer 的 sawtooth，Sign-LMS 不會停在 $w=2$。把 $\\sigma_v$ 改成 20 再算一次：指標變成 0.173，第一個條件通過。',
      '$E[x^2]=1$ 對應下方 Near-integer 實驗的標準化 code（$E[x]=0$、$E[x^2]=1$），此時 $B=\\kappa_d$。',
      '把 $C$ 設成和 $E[x^2]$ 一樣大，兩個固定點相同：這就是 §11.3 的 $w^*=a+\\kappa$。',
    ],
  },

  /* ───────────── HC-11.8：綜合 —— bias 預算、線性化檢查與 μ（章末） ───────────── */
  {
    id: 'HC-11.8',
    title: '綜合：gain-bias 預算（offset＋INL＋$\\kappa$）、線性化檢查與 $\\mu$',
    page: PAGE,
    formulaId: 'F-11.4',
    formulaTex: String.raw`w^*=a+\underbrace{\frac{b\,E[x]}{E[x^2]}}_{\text{offset}}+\underbrace{\frac{c_2E[x^3]+c_3E[x^4]}{E[x^2]}}_{\text{INL}}+\underbrace{\kappa}_{\text{correlated}},\\[0.4em] \frac{\max_x|e_\mathrm{det}(x;w^*)|}{\sigma_v}\le0.3\ ?\qquad \mu=\frac{g}{K_q\,E[x^2]},\ g=0.02`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實線性 gain', unit: TU, default: 1, min: -5, max: 5, practice: { choices: [0.9, 1, 1.1] } },
      { key: 'b', symbol: 'b', label: 'comparator／PD 的靜態 offset', unit: TU, default: 0, min: -5, max: 5, practice: { choices: [0, 0.1, 0.2] } },
      { key: 'c2', symbol: 'c_2', label: '二階 INL 係數', unit: TU, default: 0, min: -1, max: 1, practice: { choices: [0, 0, 0.05] } },
      { key: 'c3', symbol: 'c_3', label: '三階 INL 係數', unit: TU, default: 0.1, min: -1, max: 1, practice: { choices: [0, 0.05, 0.1] } },
      { key: 'kappa', symbol: String.raw`\kappa`, label: 'code-correlated 干擾係數', unit: TU, default: 0, min: -1, max: 1, practice: { choices: [0, 0.02, 0.05] } },
      { key: 'x0', symbol: 'x_0', label: 'code 平移（code = $x_0+\\{-2,\\dots,2\\}$）', default: 0, min: -8, max: 8, practice: { choices: [0, 0, 1, 2] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊的標準差', unit: TU, default: 1, min: 0, max: 1000, practice: { choices: [0.5, 1, 2] } },
    ],
    validate: ({ sigma }) =>
      sigma > 0
        ? null
        : '$\\sigma_v=0$：無雜訊的 Sign-LMS 沒有 $K_q$，固定點是 $|x|$ 加權中位數（HC-11.6），本題的一階公式、線性化指標與 $\\mu=g/(K_qE[x^2])$ 都不適用。請輸入 $\\sigma_v>0$。',
    solve: ({ a, b, c2, c3, kappa, x0, sigma }) => {
      const dist = buildCodeDistribution({ kind: 'five_level', shift: x0 })
      const xs = dist.values
      const mo = codeMoments(dist)
      const m = mk({ a, b, c2, c3, kappa, sigmaV: sigma })
      const lin = linearizedFixedPoint(m, dist, 'none', false)
      const wStar = lin.w
      const Ex = chop(mo.Ex, mo.Ex2)
      const Ex3 = chop(mo.Ex3, mo.Ex4)
      const off = chop(mseFixedPoint(mk({ a: 0, b }), dist))
      const inl = chop(mseFixedPoint(mk({ a: 0, c2, c3 }), dist))
      const inlNum = chop(c2 * Ex3 + c3 * mo.Ex4) // INL 項的分子（只用來顯示中間步驟）
      const k = chop(a + kappa - wStar)
      const es = xs.map((x) => chop(eDet(x, wStar, m)))
      const emax = Math.max(...es.map(Math.abs))
      const ratio = emax / sigma
      const kq = KQ_FACTOR / sigma
      const S = lin.slope
      const mu = autoMu(S)
      const pw = (n: number) => xs.map((x) => x ** n)
      const notes: string[] = []
      const mf = signFixedPoint(m, dist)
      if (mf.status === 'ok') {
        const sMf = gmacSlope('sign', mf.w, m, dist, 'none')
        const gap = Math.abs(mf.w - wStar)
        const sameRoot = gap <= 5e-10 * (1 + Math.abs(wStar)) // mean-field 根與一階解相同（只差求根的容差）
        if (ratio <= LINEAR_OK_RATIO)
          notes.push(
            sameRoot
              ? String.raw`$\max|e_\mathrm{det}|/\sigma_v=${texNum(ratio, 4)}\le${LINEAR_OK_RATIO}$：一階公式可信。這一組 Sign-LMS 的 mean-field 精確根也是 $${texNum(wStar)}$，和上面的 $w^*$ 相同。`
              : String.raw`$\max|e_\mathrm{det}|/\sigma_v=${texNum(ratio, 4)}\le${LINEAR_OK_RATIO}$：一階公式可信。Sign-LMS 的 mean-field 精確根是 $${texNum(mf.w, 7)}$，與上面的 $w^*$ 只差 $${texNum(gap, 2)}$。`,
          )
        else
          notes.push(
            sameRoot
              ? String.raw`$\max|e_\mathrm{det}|/\sigma_v=${texNum(ratio, 4)}>${LINEAR_OK_RATIO}$：指標超過門檻，但這一組的 mean-field 根剛好仍是 $${texNum(wStar)}$ —— 殘差對 $x$ 是偶函數（只剩 $b+c_2x^2$）時，$\pm x$ 兩個 code 對 $E[x\,q]$ 的貢獻互相抵消。這是對稱造成的特例：一般情況下指標超過 ${LINEAR_OK_RATIO} 就要用 mean-field 根或 Monte Carlo 驗收（勘誤 E01）。`
              : String.raw`$\max|e_\mathrm{det}|/\sigma_v=${texNum(ratio, 4)}>${LINEAR_OK_RATIO}$：線性化失效風險。Sign-LMS 實際停在 mean-field 根 $${texNum(mf.w, 7)}$，與一階的 $${texNum(wStar)}$ 相差 $${texNum(gap, 2)}$ —— 驗收值要用 mean-field 根或 Monte Carlo（勘誤 E01）；MSE-LMS 則精確停在 $${texNum(wStar)}$。`,
          )
        if (Number.isFinite(sMf) && sMf > 0)
          notes.push(
            Math.abs(sMf - S) <= 1e-6 * S
              ? String.raw`Lab 的自動 $\mu$ 用 $w^*$ 處實際的 mean-field 斜率；這一組每個 code 的殘差都是 0，斜率就等於手算的 $K_qE[x^2]$，所以 Lab 顯示同一個 $\mu=${texNum(mu)}$。`
              : String.raw`Lab 的自動 $\mu$ 用的是 $w^*$ 處實際的 mean-field 斜率 $S=${texNum(sMf)}$（erf 在殘差處比原點平一點），所以它顯示 $\mu=${texNum(autoMu(sMf))}$；手算的 $K_qE[x^2]$ 是它的一階近似。`,
          )
      }
      if (kappa !== 0) notes.push(String.raw`$\kappa\neq0$：這 $${texNum(kappa)}$ 的 bias 與真實 gain 共線，只靠 $(x,q)$ 分不出來（§11.3，不可辨識）。`)
      if (b !== 0 && Ex === 0) notes.push('code 已置中（$E[x]=0$）：offset 項為 0。把 $x_0$ 改成非零，offset 立刻變成 gain bias。')
      return {
        steps: [
          { tex: String.raw`x_i=x_0+(-2,-1,0,1,2)=\big(${list(xs, SUM)}\big)`, why: '5-level code 平移 $x_0$（Lab 的「code 平移」控制項）；每個 code 機率 $1/5$。' },
          { tex: String.raw`E[x]=\tfrac15\big(${plus(xs, SUM)}\big)=\tfrac{${texNum(chop(total(xs)), SUM)}}{5}=${texNum(Ex, SUM)}`, why: 'code 的平均：決定 offset 會不會變成 gain bias。' },
          { tex: String.raw`E[x^2]=\tfrac15\big(${plus(pw(2), SUM)}\big)=\tfrac{${texNum(total(pw(2)), SUM)}}{5}=${texNum(mo.Ex2, SUM)}`, why: 'code 的功率：F-11.4 的分母，也決定 GMAC 斜率。' },
          { tex: String.raw`E[x^3]=\tfrac15\big(${plus(pw(3), SUM)}\big)=\tfrac{${texNum(chop(total(pw(3))), SUM)}}{5}=${texNum(Ex3, SUM)}`, why: '二階 INL 需要：$E[x\\cdot c_2x^2]=c_2E[x^3]$（對稱 code 時為 0）。' },
          { tex: String.raw`E[x^4]=\tfrac15\big(${plus(pw(4), SUM)}\big)=\tfrac{${texNum(total(pw(4)), SUM)}}{5}=${texNum(mo.Ex4, SUM)}`, why: '三階 INL 需要：$E[x\\cdot c_3x^3]=c_3E[x^4]$。' },
          { tex: String.raw`\frac{b\,E[x]}{E[x^2]}=\frac{${texNumP(b)}\times${texNumP(Ex, SUM)}}{${texNum(mo.Ex2, SUM)}}=\frac{${texNum(chop(b * Ex), MID)}}{${texNum(mo.Ex2, SUM)}}=${texNum(off, MID)}`, why: 'offset 造成的假 gain bias（F-11.5，靜態式）：先乘，再除。' },
          {
            tex: String.raw`\frac{c_2E[x^3]+c_3E[x^4]}{E[x^2]}=\frac{${texNumP(c2)}\times${texNumP(Ex3, SUM)}+${texNumP(c3)}\times${texNum(mo.Ex4, SUM)}}{${texNum(mo.Ex2, SUM)}}=\frac{${texNum(chop(c2 * Ex3), MID)}+${texNumP(c3 * mo.Ex4, MID)}}{${texNum(mo.Ex2, SUM)}}=\frac{${texNum(inlNum, MID)}}{${texNum(mo.Ex2, SUM)}}=${texNum(inl, MID)}`,
            why: 'INL 造成的 bias：$E[x\\,d(x)]/E[x^2]$。分子的兩個乘積分開算、相加，最後才除。',
          },
          { tex: String.raw`w^*=a+\text{offset}+\text{INL}+\kappa=${texNum(a)}+${texNumP(off, MID)}+${texNumP(inl, MID)}+${texNumP(kappa)}=${texNum(wStar, MID)}`, why: '三個來源直接相加（F-11.4）；$\\kappa$ 那一項的 $E[x^2]$ 已經約掉（F-11.13）。' },
          { tex: String.raw`a+\kappa-w^*=${texNum(a)}+${texNumP(kappa)}-${texNumP(wStar, MID)}=${texNum(k, MID)}`, why: '殘差中 $x$ 的係數：$(a-w)x+\\kappa x$ 合併。$a-w^*$ 是全站的 $\\delta$（$\\delta=a-w$）。' },
          {
            tex: [
              String.raw`\begin{array}{r|l|c|l|l|r}x&(a+\kappa-w^*)\,x&b&c_2\,x^2&c_3\,x^3&e_\mathrm{det}\\\hline`,
              xs
                .map(
                  (x, i) =>
                    String.raw`${texNum(x, SUM)}&${texNumP(k, MID)}\times${texNumP(x, SUM)}=${texNum(k * x, MID)}&${texNum(b)}&${texNumP(c2)}\times${texNum(x * x, SUM)}=${texNum(c2 * x * x, MID)}&${texNumP(c3)}\times${texNumP(x ** 3, SUM)}=${texNum(c3 * x ** 3, MID)}&${texNum(es[i])}`,
                )
                .join(String.raw`\\`),
              String.raw`\end{array}`,
            ].join(''),
            why: '每個 code 的確定性殘差 $e_\\mathrm{det}(x;w^*)=(a+\\kappa-w^*)x+b+c_2x^2+c_3x^3$：每一列先算三個乘積，再把中間四欄相加得到最後一欄 —— 這是 GMAC 歸零後還留下的 timing error。',
          },
          { tex: String.raw`\frac{\max|e_\mathrm{det}|}{\sigma_v}=\frac{${texNum(emax, MID)}}{${texNum(sigma)}}=${texNum(ratio, MID)}`, why: '線性化指標：取上表最後一欄絕對值最大的那個，除以 $\\sigma_v$。要小的是「整個」殘差相對 $\\sigma_v$，不只是 $|a-w|$（勘誤 E01）；$\\le0.3$ 才能把上面的 $w^*$ 當成 Sign-LMS 的驗收值。' },
          { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(KQ_FACTOR, MID)}}{${texNum(sigma)}}=${texNum(kq, MID)}`, why: '計算機：$2\\div\\pi=0.63662$，按開根號得 $0.797885$，再除以 $\\sigma_v$。' },
          { tex: String.raw`S\approx K_q\,E[x^2]=${texNum(kq, MID)}\times${texNum(mo.Ex2, SUM)}=${texNum(S, MID)}`, why: 'Sign-LMS 的 GMAC 恢復斜率（靜態路徑 $C=E[x^2]$，F-11.15），單位 $\\mathrm{t.u.}^{-1}$。' },
          { tex: String.raw`\mu=\frac{g}{S}=\frac{0.02}{${texNum(S, MID)}}=${texNum(mu)}`, why: '讓平均 pole $p=1-\\mu S=0.98$（時間常數約 50 個 block）所需的學習率：Lab「$\\mu$ 自動」的設定方式。' },
        ],
        results: [
          { symbol: String.raw`\tfrac{b\,E[x]}{E[x^2]}`, label: 'offset 造成的 bias', value: off, unit: TU },
          { symbol: String.raw`\tfrac{c_2E[x^3]+c_3E[x^4]}{E[x^2]}`, label: 'INL 造成的 bias', value: inl, unit: TU },
          { symbol: 'w^*', label: '一階固定點（MSE-LMS 精確）', value: wStar, unit: TU },
          { symbol: String.raw`\max|e_\mathrm{det}|/\sigma_v`, label: '線性化指標', value: ratio },
          { symbol: String.raw`\mu`, label: '$g=0.02$ 所需的學習率（Sign-LMS）', value: mu, unit: TU },
        ],
        notes,
      }
    },
    tips: [
      '預設值是 Gallery #7（5-level、$a=1$、$c_3=0.1$、$\\sigma_v=1$）：$w^*=1.34$、殘差 $(-0.12,\\,0.24,\\,0,\\,-0.24,\\,0.12)$、指標 0.24、$\\mu\\approx0.0125$。',
      'Lab「試試看」第 4 點：$c_3=0$、$b=0.2$、$x_0=2$（code 變成 $\\{0,\\dots,4\\}$）⇒ offset 項 $0.2\\times2/6\\approx0.067$；$x_0$ 調回 0 就消失。',
      '平移後的動差不必重新展開：先列出 5 個 code，再逐個做平方、三次方、四次方，每一欄加總後除以 5。',
      '把 $\\sigma_v$ 改成 0.5：指標變成 0.48，超過 0.3 —— 同一個 $w^*=1.34$ 對 MSE-LMS 仍然精確，但對 Sign-LMS 已經不能當驗收值。',
    ],
  },
]
