import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { normCdf } from '@/simulation/core'
import {
  asymptoticFinalOptimum,
  calPhaseMarginDeg,
  comparatorKq,
  convergenceMuMin,
  cornerContraction,
  cornerInterval,
  geomSum2,
  gmacMeanField,
  gmacModel,
  loopGainK,
  msdRecursion,
  msdSplit,
  optimalSchedule,
  optimizeMu,
  slewLimitedBlocks,
  timeConstantBlocks,
} from '@/simulation/models/optimizer'

/**
 * Ch14 的「帶入手算」題（docs/teaching-style.md §7）。
 *  - 每一題的答案都來自 src/simulation/models/optimizer.ts 的實際函式（msdRecursion／msdSplit／cornerInterval／optimalSchedule…），
 *    這裡只負責把數字排成「符號式 = 代入數字 = 結果」；handcalcs.test.tsx 再用測試內獨立寫的公式、golden vector 與文中 worked example 交叉比對。
 *  - 極性一律 δ = a − w；μ、w 的單位 fs，K 的單位 fs⁻¹（勘誤 E13）；ε 是相對縮減比（勘誤 E16）；
 *    線性公式只在 |δ0| ≲ 0.5σ_v 內使用（勘誤 E48），超出時 validate 會擋下並說明原因。
 */

const PAGE = '/ch/14'

/** √(2/π) = 0.797885：直接取模型的 K_q(σ_v = 1)，不另寫常數。 */
const ROOT_2_OVER_PI = comparatorKq(1)
/** 第 10 課／T13 的 K = √(2/π)/100，取 6 位有效數字（與 §14.0.1 內文顯示的 0.00797885 相同）。 */
const K_LESSON = Number(comparatorKq(100).toPrecision(6))
/** 線性化 E[G] ≈ Kδ 的適用上限：θ = 0 時 |δ0| ≤ 0.5σ_v ⇔ K|δ0| ≤ 0.5√(2/π) = 0.399，取整為 0.4（勘誤 E48）。 */
const LINEAR_LIMIT = 0.4

const SIG = 6
const n6 = (x: number) => texNum(x, SIG)
/**
 * 代入用（乘數、次方的底數、ln 的引數）：負數加括號（texNumP），科學記號 a×10^b 也加括號。
 * 不加的話 `10^{-5}^2` 是 KaTeX 的 double superscript 錯誤，`\ln 3\times10^{-5}`、`400\times1.2\times10^{-9}` 則有歧義。
 */
const paren = (s: string) => (s.startsWith('(') || !s.includes('^') ? s : `(${s})`)
const n6p = (x: number) => paren(texNumP(x, SIG))
/**
 * 「接下來要被 1 減掉、或要取 ln」的數（g、p、p²、p^{2B}、ε^{1/B}、r、Φ）：越接近 1 就多顯示幾位，
 * 讓讀者照畫面上的數字做 1 − x 時仍有 5 位以上的有效數字（否則 1 − 0.9998 = 0.0002，和下一格顯示的 0.00019999 對不起來）。
 * |1 − x| ≥ 0.01 時就是一般的 6 位。
 */
const sigNear1 = (x: number) => {
  const d = Math.abs(1 - x)
  return d > 0 && d < 0.01 ? Math.min(15, SIG - 2 + Math.ceil(-Math.log10(d))) : SIG
}
const n1 = (x: number) => texNum(x, sigNear1(x))
const n1p = (x: number) => paren(texNumP(x, sigNear1(x)))
/** 整數（T = 131072 這種 6 位數不能被有效位數截斷）。 */
const int = (x: number) => String(Math.round(x))
/** 百分比差（給 notes 用）：小於 0.01% 時已經低於數值求根（黃金分割）的解析度，不硬寫兩位有效數字。 */
const pct = (x: number) => (Math.abs(x) < 0.01 ? String.raw`<0.01\%` : String.raw`${texNum(x, 2)}\%`)

/** 每次更新注入的雜訊功率 μ²σ_η²：從 δ = 0 出發更新一次的均方誤差（模型 msdSplit）。 */
const noisePerUpdate = (p: number, mu: number, s2: number) => msdSplit(0, p, mu, s2, 1).variance
/** 穩態 σ_w² = μ²σ_η²/(1 − p²)：B → ∞ 時的 variance（模型 msdSplit；需 |p| < 1）。 */
const steadyVar = (p: number, mu: number, s2: number) => msdSplit(0, p, mu, s2, Infinity).variance
/** p^{2B}：δ0 = 1 時的 bias²（模型 msdSplit）。 */
const poleToThe2B = (p: number, B: number) => msdSplit(1, p, 0, 0, B).bias2

// ── 共用的適用範圍檢查（訊息要解釋原因；支援 $...$）──────────────────────────

const MSG_POLARITY = String.raw`$C\le0$：更新極性錯誤。$K=K_qC\le0$ 時 $p=1-\mu K\ge1$，正的 learning rate 不會讓平均誤差收斂（$K=0$ 是 random walk、$K<0$ 指數發散）。這不是調 $\mu$ 能解決的：請先修正極性（Ch06／Ch07），再輸入 $K>0$。`

function checkSigmaV(sv: number): string | null {
  return sv > 0 ? null : String.raw`$\sigma_v$ 必須大於 0：$K_q=\sqrt{2/\pi}/\sigma_v$ 在 $\sigma_v\to0$ 時發散（沒有雜訊的 1-bit comparator 沒有線性增益可言）。`
}

function checkMu(mu: number, sym = String.raw`\mu`): string | null {
  return mu > 0 ? null : String.raw`$${sym}$ 必須大於 0：$${sym}=0$ 時係數不更新；$${sym}<0$ 等於把更新極性反過來，$p=1-\mu K>1$ 會發散。`
}

function checkLoopGain(g: number, sym = 'g'): string | null {
  if (g < 2) return null
  return String.raw`$${sym}=\mu K=${texNum(g, 4)}\ge2$：$|p|=|1-${sym}|\ge1$，平均誤差不衰減（$${sym}=2$ 時正負翻轉、$PM=0^\circ$）或指數發散，沒有穩態，本題的公式不適用。請把 $\mu$ 調小到 $\mu K<2$（要 $PM\ge60^\circ$ 則需 $\mu K\le1$）。`
}

/** 勘誤 E48：|δ0| > 0.5σ_v 時 comparator 飽和（slew-limited），線性公式低估。 */
function checkLinear(d0: number, sv: number): string | null {
  const z = Math.abs(d0) / sv
  if (z <= 0.5) return null
  return String.raw`$|\delta_0|/\sigma_v=${texNum(z, 3)}>0.5$：1-bit comparator 已經飽和（slew-limited），線性化 $G\approx K\delta$ 不成立，F-14.3 這類線性公式會低估 $E[\delta_B^2]$（$\delta_0=\sigma_v$ 低估約 17%、$2\sigma_v$ 約 52%；勘誤 E48）。大初始誤差請改用 HC-14.4 的 slew-limited 估計（F-14.5），或把 $|\delta_0|$ 降到 $0.5\sigma_v$ 以內。`
}

/** 輸入直接給 K 的題目：用 K|δ0| 判斷線性化是否成立（θ = 0 時等價於 |δ0| ≤ 0.5σ_v）。 */
function checkLinearK(d0: number, K: number): string | null {
  const x = K * Math.abs(d0)
  if (x <= LINEAR_LIMIT) return null
  return String.raw`$K|\delta_0|=${texNum(x, 3)}>0.4$：線性化 $E[G]\approx K\delta$ 要求 $K|\delta|\ll1$（$|G|\le1$；$\theta=0$ 時 $K|\delta_0|\le0.4$ 相當於 $|\delta_0|\le0.5\sigma_v$）。這麼大的初始誤差下 comparator 已經飽和，線性公式會低估（勘誤 E48）；請改用 HC-14.4 的 slew-limited 估計，或把 $\delta_0$ 調小。`
}

function checkBudget(T: number, N: number): string | null {
  if (T < N) return String.raw`總預算 $T=${int(T)}$ 小於一個 block（$N=${int(N)}$）：一次更新都做不到（$B=0$）。請增加 $T$ 或縮小 $N$。`
  if (T % N !== 0) return String.raw`$T/N=${texNum(T / N, 6)}$ 不是整數：更新次數 $B=\lfloor T/N\rfloor$，剩下不足一個 block 的比較用不到，而且 F-14.17 的 $T=NB$ 就不成立。請讓 $T$ 是 $N$ 的整數倍。`
  return null
}

function checkEps(eps: number): string | null {
  if (eps > 0 && eps < 1) return null
  return String.raw`$\epsilon=${texNum(eps, 4)}$ 不合法：$\epsilon$ 是無因次的相對縮減比，要求 $|E[\delta_B]|\le\epsilon|\delta_0|$，必須 $0<\epsilon<1$（勘誤 E16）。若規格給的是絕對誤差 $e_\text{abs}$（例如 1 fs），請換算 $\epsilon=e_\text{abs}/|\delta_0|$；直接代 $\epsilon\ge1$ 會得到 $\mu_{\min}\le0$ 的假答案。`
}

// 範例數字的答案（給「手算提示」用；由模型算出，不手寫）
const EX1 = msdRecursion(3, 0.9, 0.1 / K_LESSON, 1 / 4096, 3)
const EX6 = cornerInterval([0.004, 0.012], 0.01, 12)
const EX6_ROOT = cornerContraction(EX6.muLo, 0.004, 1)
const PHI_TABLE = [0.25, 0.5, 1, 1.5, 2, 3].map((z) => String.raw`\Phi(${z})=${texNum(normCdf(z), 5)}`).join(String.raw`,\ `)

export const HANDCALCS: HandCalcDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.1：§14.0.1 先算一次：遞迴 m_{k+1} = p²m_k + μ²σ_η²
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.1',
    title: '先算一次：均方誤差的遞迴（前三個 block）',
    page: PAGE,
    formulaId: 'F-14.1',
    formulaTex: String.raw`\begin{aligned}
\delta_{k+1}&=p\,\delta_k-\mu\eta_k\ \Longrightarrow\ m_{k+1}=p^2\,m_k+\mu^2\sigma_\eta^2,\qquad m_k\equiv E[\delta_k^2],\quad m_0=\delta_0^2\\
\mu&=\frac{g}{K},\qquad p=1-g,\qquad \sigma_\eta^2=\frac1N
\end{aligned}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差 $a-w_0$', unit: String.raw`\mathrm{fs}`, default: 3, min: -1000, max: 1000, practice: { choices: [1, 2, 3, 4, 5] } },
      { key: 'g', symbol: 'g', label: String.raw`想要的迴路增益 $g=\mu K$`, default: 0.1, practice: { choices: [0.1, 0.2, 0.25, 0.5] } },
      {
        key: 'K',
        symbol: 'K',
        label: String.raw`GMAC 斜率 $K=K_qC$（$\sigma_v=100\,\mathrm{fs}$、$\theta=0$ 時為 $${n6(K_LESSON)}$）`,
        unit: String.raw`\mathrm{fs^{-1}}`,
        default: K_LESSON,
        practice: { choices: [0.004, 0.005, 0.008, 0.01, 0.02] },
      },
      { key: 'N', symbol: 'N', label: '每個 block 累加的 comparator 樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1000, 1024, 4096, 10000] } },
    ],
    validate: ({ d0, g, K }) => {
      if (!(K > 0)) return MSG_POLARITY
      if (!(g > 0)) return String.raw`$g=\mu K$ 必須大於 0：$g=0$ 代表 $\mu=0$，係數完全不更新；$g<0$ 是極性反了（$p>1$ 發散）。`
      return checkLoopGain(g) ?? checkLinearK(d0, K)
    },
    solve: ({ d0, g, K, N }) => {
      const mu = g / K
      const p = 1 - g
      const s2 = 1 / N
      const m = msdRecursion(d0, p, mu, s2, 3)
      const noise = noisePerUpdate(p, mu, s2)
      const end = msdSplit(d0, p, mu, s2, 3)
      const floor = steadyVar(p, mu, s2)
      const p2 = p * p
      const row = (k: number) =>
        String.raw`m_{${k + 1}}=p^2\,m_{${k}}+\mu^2\sigma_\eta^2=${n1p(p2)}\times${n6p(m[k])}+${n6(noise)}=${n6(p2 * m[k])}+${n6(noise)}=${n6(m[k + 1])}\ \mathrm{fs^2}`
      return {
        steps: [
          { tex: String.raw`\mu=\frac{g}{K}=\frac{${n6(g)}}{${n6(K)}}=${n6(mu)}\ \mathrm{fs}`, why: String.raw`由想要的迴路增益 $g=\mu K$ 反推 learning rate（一次除法）。` },
          { tex: String.raw`p=1-g=1-${n6(g)}=${n1(p)}`, why: 'pole：平均誤差每個 block 乘上的倍數。' },
          {
            tex: String.raw`p^2=${n1p(p)}^2=${n1(p2)}`,
            why: String.raw`把 F-14.1 兩邊平方再取期望值（交叉項 $E[\delta_k\eta_k]=0$）：均方誤差是「先平方再平均」，所以每個 block 乘的是 $p^2$。`,
          },
          {
            tex: String.raw`\mu^2\sigma_\eta^2=\frac{\mu^2}{N}=\frac{${n6p(mu)}^2}{${int(N)}}=\frac{${n6(mu * mu)}}{${int(N)}}=${n6(noise)}\ \mathrm{fs^2}`,
            why: String.raw`每次更新灌進係數的雜訊功率：$\sigma_\eta^2=1/N$（$N$ 個 $\pm1$ 的平均），所以先把 $\mu$ 平方、再除以 $N$。`,
          },
          { tex: String.raw`m_0=\delta_0^2=${n6p(d0)}^2=${n6(m[0])}\ \mathrm{fs^2}`, why: String.raw`起點：$\delta_0$ 是確定值，均方誤差就是它的平方。` },
          { tex: row(0), why: String.raw`第 1 個 block：舊的均方誤差乘 $p^2$，再加上新注入的雜訊。` },
          { tex: row(1), why: String.raw`第 2 個 block：把上一步的答案再代一次。` },
          { tex: row(2), why: String.raw`第 3 個 block：同樣的規則。` },
        ],
        results: [
          { symbol: String.raw`\mu`, label: 'learning rate', value: mu, unit: String.raw`\mathrm{fs}`, digits: 6 },
          { symbol: String.raw`\mu^2\sigma_\eta^2`, label: '每次更新注入的雜訊功率', value: noise, unit: String.raw`\mathrm{fs^2}`, digits: 6 },
          { symbol: String.raw`E[\delta_1^2]`, label: '1 個 block 後', value: m[1], unit: String.raw`\mathrm{fs^2}`, digits: 6 },
          { symbol: String.raw`E[\delta_2^2]`, label: '2 個 block 後', value: m[2], unit: String.raw`\mathrm{fs^2}`, digits: 6 },
          { symbol: String.raw`E[\delta_3^2]`, label: '3 個 block 後', value: m[3], unit: String.raw`\mathrm{fs^2}`, digits: 6 },
        ],
        notes: [
          String.raw`拆開來看 $m_3$：$\text{bias}^2=p^{6}\delta_0^2=${n6(end.bias2)}\,\mathrm{fs^2}$、variance $=m_3-\text{bias}^2=${n6(end.variance)}\,\mathrm{fs^2}$（下一節 F-14.3 的兩項）。`,
          String.raw`一直跑下去，$m_k$ 會停在雜訊底 $\mu^2\sigma_\eta^2/(1-p^2)=${n6(floor)}\,\mathrm{fs^2}$（F-14.6），不會到 0。`,
          ...(p < 0 ? [String.raw`$g>1$：$p<0$，平均誤差每個 block 正負交替（$PM<60^\circ$）；均方誤差仍照 $p^2$ 衰減。`] : []),
        ],
      }
    },
    tips: [
      String.raw`每一列只有一次乘法和一次加法：先算 $p^2m_k$，再加 $\mu^2\sigma_\eta^2$。把上一列的答案留在計算機裡繼續乘 $p^2$ 最快。`,
      String.raw`範例數字（$\delta_0=3$、$g=0.1$、$N=4096$）會得到 §14.0.1 表格的 $${n6(EX1[1])},\ ${n6(EX1[2])},\ ${n6(EX1[3])}\ \mathrm{fs^2}$。`,
      String.raw`$K$ 從哪裡來：$\theta=0$ 時 $K=\sqrt{2/\pi}/\sigma_v\approx${n6(ROOT_2_OVER_PI)}/\sigma_v$；也可以用 §14.5 的 $\pm\Delta$ 量測。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.2：F-14.3：E[δ_B²] = bias² + variance（預設值 = golden msd_after_blocks／T13 的 μ、σ_v、N）
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.2',
    title: String.raw`$B$ 次更新後的均方誤差：$\text{bias}^2+\text{variance}$，再開根號得 RMS`,
    page: PAGE,
    formulaId: 'F-14.3',
    formulaTex: String.raw`E[\delta_B^2]=\underbrace{\delta_0^2\,p^{2B}}_{\text{bias}^2}+\underbrace{\mu^2\sigma_\eta^2\,\frac{1-p^{2B}}{1-p^2}}_{\text{variance}},\qquad p=1-\mu K,\quad K=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v},\quad\sigma_\eta^2=\frac1N`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差 $a-w_0$', unit: String.raw`\mathrm{fs}`, default: 20, min: -1e6, max: 1e6, practice: { choices: [5, 10, 20] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate', unit: String.raw`\mathrm{fs}`, default: 10, practice: { choices: [5, 10, 20, 25] } },
      { key: 'sv', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 的樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1024, 4096] } },
      { key: 'B', symbol: 'B', label: '更新次數（block 數）', default: 20, min: 1, max: 1e6, integer: true, practice: { choices: [5, 10, 20, 40] } },
    ],
    validate: ({ d0, mu, sv }) => checkSigmaV(sv) ?? checkMu(mu) ?? checkLoopGain(mu * comparatorKq(sv)) ?? checkLinear(d0, sv),
    solve: ({ d0, mu, sv, N, B }) => {
      const K = comparatorKq(sv)
      const g = mu * K
      const p = 1 - g
      const s2 = 1 / N
      const sp = msdSplit(d0, p, mu, s2, B)
      const noise = noisePerUpdate(p, mu, s2)
      const S = geomSum2(p, B)
      const p2 = p * p
      const p2B = poleToThe2B(p, B)
      const rms = Math.sqrt(sp.total)
      const floor = steadyVar(p, mu, s2)
      const z = Math.abs(d0) / sv
      const share = sp.total > 0 ? (100 * sp.bias2) / sp.total : 0
      return {
        steps: [
          {
            tex: String.raw`K=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}=\frac{${n6(ROOT_2_OVER_PI)}}{${n6(sv)}}=${n6(K)}\ \mathrm{fs^{-1}}`,
            why: String.raw`1-bit comparator 的小訊號增益（$\theta=0$，$C=1$）。$\sqrt{2/\pi}=${n6(ROOT_2_OVER_PI)}$：計算機按 $2\div\pi$ 再按 $\sqrt{\ }$，之後只剩一次除法。`,
          },
          { tex: String.raw`g=\mu K=${n6p(mu)}\times${n6p(K)}=${n1(g)}`, why: '無因次迴路增益。' },
          { tex: String.raw`p=1-g=1-${n1(g)}=${n1(p)}`, why: String.raw`pole：平均誤差每個 block 乘上的倍數（$E[\delta_B]=p^B\delta_0$）。` },
          { tex: String.raw`p^2=${n1p(p)}^2=${n1(p2)}`, why: String.raw`後面兩項都用 $p^2$，先算好。` },
          {
            tex: String.raw`p^{2B}=(p^2)^{B}=${n1p(p2)}^{${int(B)}}=${n1(p2B)}`,
            why: String.raw`計算機：輸入 $p^2$，按 $y^x$（有些機型標 $x^y$）再輸入 $B$。沒有次方鍵時用 $p^{2B}=e^{B\ln p^2}$：先按 $\ln$、乘 $B$、再按 $e^x$。`,
          },
          {
            tex: String.raw`\text{bias}^2=\delta_0^2\,p^{2B}=${n6p(d0)}^2\times${n1p(p2B)}=${n6p(d0 * d0)}\times${n1p(p2B)}=${n6(sp.bias2)}\ \mathrm{fs^2}`,
            why: String.raw`初始誤差還沒收完的部分：$(E[\delta_B])^2=(p^B\delta_0)^2$。`,
          },
          {
            tex: String.raw`\mu^2\sigma_\eta^2=\frac{\mu^2}{N}=\frac{${n6p(mu)}^2}{${int(N)}}=\frac{${n6(mu * mu)}}{${int(N)}}=${n6(noise)}\ \mathrm{fs^2}`,
            why: String.raw`每次更新注入的雜訊功率（$\sigma_\eta^2=1/N$）。`,
          },
          {
            tex: String.raw`\frac{1-p^{2B}}{1-p^2}=\frac{1-${n1(p2B)}}{1-${n1(p2)}}=\frac{${n6(1 - p2B)}}{${n6(1 - p2)}}=${n6(S)}`,
            why: String.raw`等比數列 $1+p^2+p^4+\dots+p^{2(B-1)}$ 的和：「等效累積了幾次更新的雜訊」。兩次減法、一次除法。`,
          },
          { tex: String.raw`\text{variance}=\mu^2\sigma_\eta^2\times\frac{1-p^{2B}}{1-p^2}=${n6p(noise)}\times${n6p(S)}=${n6(sp.variance)}\ \mathrm{fs^2}`, why: '累積的更新雜訊。' },
          { tex: String.raw`E[\delta_B^2]=\text{bias}^2+\text{variance}=${n6(sp.bias2)}+${n6(sp.variance)}=${n6(sp.total)}\ \mathrm{fs^2}`, why: '兩項同單位，直接相加。' },
          { tex: String.raw`\text{RMS}=\sqrt{E[\delta_B^2]}=\sqrt{${n6(sp.total)}}=${n6(rms)}\ \mathrm{fs}`, why: String.raw`開根號回到 fs：這是 gain-equivalent 的殘差，還不是 output jitter。` },
        ],
        results: [
          { symbol: 'p', label: 'pole', value: p, digits: 6 },
          { symbol: String.raw`\text{bias}^2`, label: '還沒收完的初始誤差', value: sp.bias2, unit: String.raw`\mathrm{fs^2}`, digits: 6, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`\text{variance}`, label: '累積的更新雜訊', value: sp.variance, unit: String.raw`\mathrm{fs^2}`, digits: 6 },
          { symbol: String.raw`E[\delta_B^2]`, label: '均方誤差', value: sp.total, unit: String.raw`\mathrm{fs^2}`, digits: 6, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`\sqrt{E[\delta_B^2]}`, label: 'RMS 殘差', value: rms, unit: String.raw`\mathrm{fs}`, digits: 5 },
        ],
        notes: [
          share >= 50
            ? String.raw`$\text{bias}^2$ 占 $${texNum(share, 3)}\%$：初始誤差還沒收完，這個 $B$ 之下 $\mu$ 可以再大一點（或再多跑幾個 block）。`
            : String.raw`$\text{bias}^2$ 只占 $${texNum(share, 3)}\%$：已經是雜訊主導，再加大 $\mu$ 只會更吵。`,
          String.raw`$B\to\infty$ 的雜訊底：$\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)=${n6(floor)}\,\mathrm{fs^2}$，也就是 $\sigma_w=${texNum(Math.sqrt(floor), 5)}\,\mathrm{fs}$（F-14.6）。`,
          z <= 0.2
            ? String.raw`適用性（勘誤 E48）：$|\delta_0|/\sigma_v=${texNum(z, 3)}\le0.2$，對真正的 1-bit Sign-LMS 誤差約 $\le1\%$。`
            : String.raw`適用性（勘誤 E48）：$|\delta_0|/\sigma_v=${texNum(z, 3)}$ 介於 0.2 與 0.5 之間，線性公式對 1-bit Sign-LMS 會低估約 1–5%，請以 Monte Carlo 為準。`,
          ...(p < 0 ? [String.raw`$g>1$：$p<0$，平均誤差正負交替；公式照樣成立（只用到 $p^2$），但 $PM<60^\circ$。`] : []),
        ],
      }
    },
    tips: [
      String.raw`$\sqrt{2/\pi}=${n6(ROOT_2_OVER_PI)}$ 值得背起來：$K=${n6(ROOT_2_OVER_PI)}/\sigma_v$。`,
      String.raw`$p^{2B}$ 對 $p$ 的捨入很敏感（誤差會放大 $2B$ 倍）：$p$、$p^2$ 請保留 6 位有效數字再按次方。`,
      String.raw`$g$ 很小（$p$ 很接近 1）時，$1-p^2$ 與 $1-p^{2B}$ 是兩個幾乎相等的數相減，有效位數會掉：$p^2$、$p^{2B}$ 請留著計算機上全部的位數再減（這時畫面會自動多顯示幾位）。`,
      String.raw`小 $g$ 的心算檢查：$p^{2B}\approx e^{-2Bg}$（$g\le0.1$ 時指數只差 $Bg^2$），$1-p^2\approx2g$。`,
      String.raw`預設值是 golden vector 的條件（$\delta_0=20$、$\mu=10$、$\sigma_v=100$、$N=4096$、$B=20$）；$\mu$、$\sigma_v$、$N$ 也就是測試 T13 的條件，所以 $p=0.92021$。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.3：F-14.6＋F-14.10：速度–雜訊取捨（預設 μ_A = 10 fs 就是 T13：σ_w = 0.399 fs）
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.3',
    title: String.raw`速度–雜訊取捨：兩個候選 $\mu$ 的時間常數 $\tau$ 與穩態 $\sigma_w$`,
    page: PAGE,
    formulaId: 'F-14.6',
    formulaTex: String.raw`p=1-\mu K,\qquad \tau=-\frac{1}{\ln|p|}\ \text{blocks},\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu\,\sigma_\eta^2}{K(2-\mu K)},\qquad K=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v},\quad\sigma_\eta^2=\frac1N`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'sv', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 的樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1024, 4096] } },
      { key: 'muA', symbol: String.raw`\mu_A`, label: '候選 A（較快）', unit: String.raw`\mathrm{fs}`, default: 10, practice: { choices: [10, 20, 40] } },
      { key: 'muB', symbol: String.raw`\mu_B`, label: '候選 B（較安靜）', unit: String.raw`\mathrm{fs}`, default: 5, practice: { choices: [2, 2.5, 5] } },
    ],
    validate: ({ sv, muA, muB }) => {
      const bad = checkSigmaV(sv) ?? checkMu(muA, String.raw`\mu_A`) ?? checkMu(muB, String.raw`\mu_B`)
      if (bad) return bad
      const K = comparatorKq(sv)
      return checkLoopGain(muA * K, 'g_A') ?? checkLoopGain(muB * K, 'g_B')
    },
    solve: ({ sv, N, muA, muB }) => {
      const K = comparatorKq(sv)
      const s2 = 1 / N
      const one = (mu: number, tag: string) => {
        const g = mu * K
        const p = 1 - g
        const tau = timeConstantBlocks(p)
        const v = steadyVar(p, mu, s2)
        const sw = Math.sqrt(v)
        const steps = [
          { tex: String.raw`g_${tag}=\mu_${tag}K=${n6p(mu)}\times${n6p(K)}=${n1(g)}`, why: String.raw`候選 ${tag} 的無因次迴路增益。` },
          { tex: String.raw`p_${tag}=1-g_${tag}=1-${n1(g)}=${n1(p)}`, why: 'pole。' },
          p === 0
            ? { tex: String.raw`\tau_${tag}=0\ \text{blocks}\quad(p_${tag}=0)`, why: String.raw`$g=1$：deadbeat，平均誤差一步到位，$\ln0=-\infty$ 所以 $\tau=0$。` }
            : {
                tex: String.raw`\tau_${tag}=-\frac{1}{\ln|p_${tag}|}=-\frac{1}{\ln ${n1p(Math.abs(p))}}=-\frac{1}{${n6p(-1 / tau)}}=${n6(tau)}\ \text{blocks}`,
                why: String.raw`平均誤差縮到 $1/e\approx37\%$ 需要的 block 數：按 $\ln$、取倒數、變號。$g\le0.25$ 時可用 $\tau\approx1/g-\tfrac12$ 心算（誤差 $<1\%$）。`,
              },
          {
            tex: String.raw`\sigma_{w,${tag}}^2=\frac{\mu_${tag}\,\sigma_\eta^2}{K(2-g_${tag})}=\frac{${n6p(mu)}\times${n6p(s2)}}{${n6p(K)}\times(2-${n1(g)})}=\frac{${n6(mu * s2)}}{${n6p(K)}\times${n6p(2 - g)}}=\frac{${n6(mu * s2)}}{${n6(K * (2 - g))}}=${n6(v)}\ \mathrm{fs^2}`,
            why: String.raw`穩態係數雜訊功率（F-14.6）。照順序：分子一次乘法；分母先算 $2-g$、再乘 $K$；最後一次除法。`,
          },
          { tex: String.raw`\sigma_{w,${tag}}=\sqrt{${n6(v)}}=${n6(sw)}\ \mathrm{fs}`, why: '開根號得 RMS。' },
        ]
        return { g, p, tau, v, sw, steps }
      }
      const a = one(muA, 'A')
      const b = one(muB, 'B')
      const rMu = muB / muA
      const rSw = b.sw / a.sw
      const rTau = a.tau > 0 ? b.tau / a.tau : Number.NaN
      const compA = a.tau * N
      return {
        steps: [
          {
            tex: String.raw`K=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}=\frac{${n6(ROOT_2_OVER_PI)}}{${n6(sv)}}=${n6(K)}\ \mathrm{fs^{-1}}`,
            why: String.raw`comparator 增益（$\theta=0$）。$\sqrt{2/\pi}=${n6(ROOT_2_OVER_PI)}$：按 $2\div\pi$ 再開根號。`,
          },
          { tex: String.raw`\sigma_\eta^2=\frac{1}{N}=\frac{1}{${int(N)}}=${n6(s2)}`, why: String.raw`每個 block 的 GMAC 雜訊變異數（$N$ 個 $\pm1$ 的平均）。` },
          ...a.steps,
          ...b.steps,
          {
            tex: String.raw`\frac{\sigma_{w,B}}{\sigma_{w,A}}=\frac{${n6(b.sw)}}{${n6(a.sw)}}=${n6(rSw)}`,
            why: String.raw`雜訊 RMS 的比。小 $g$ 時 $\sigma_w\propto\sqrt{\mu}$，預期約 $\sqrt{\mu_B/\mu_A}=${texNum(Math.sqrt(rMu), 4)}$。`,
          },
          ...(a.tau > 0
            ? [
                {
                  tex: String.raw`\frac{\tau_B}{\tau_A}=\frac{${n6(b.tau)}}{${n6(a.tau)}}=${n6(rTau)}`,
                  why: String.raw`收斂時間的比。小 $g$ 時 $\tau\approx1/g\propto1/\mu$，預期約 $\mu_A/\mu_B=${texNum(1 / rMu, 4)}$。`,
                },
              ]
            : []),
        ],
        results: [
          { symbol: String.raw`\tau_A`, label: 'A 的時間常數', value: a.tau, unit: String.raw`\text{blocks}` },
          { symbol: String.raw`\sigma_{w,A}`, label: 'A 的穩態係數雜訊 RMS', value: a.sw, unit: String.raw`\mathrm{fs}`, digits: 6 },
          { symbol: String.raw`\tau_B`, label: 'B 的時間常數', value: b.tau, unit: String.raw`\text{blocks}` },
          { symbol: String.raw`\sigma_{w,B}`, label: 'B 的穩態係數雜訊 RMS', value: b.sw, unit: String.raw`\mathrm{fs}`, digits: 6 },
        ],
        notes: [
          String.raw`把 $\mu$ 變成 $${texNum(rMu, 3)}$ 倍：雜訊 RMS 變成 $${texNum(rSw, 3)}$ 倍${Number.isFinite(rTau) ? String.raw`，收斂時間變成 $${texNum(rTau, 3)}$ 倍` : ''}。RMS 只照 $\sqrt{\mu}$ 變、時間卻照 $1/\mu$ 變——這就是整章的取捨。`,
          String.raw`換成比較次數：候選 A 收到 $1/e$ 需要 $\tau_AN=${texNum(compA, 4)}$ 次比較；$f_s=4\,\mathrm{GHz}$ 時約 $${texNum((compA / 4e9) * 1e6, 3)}\,\mu\mathrm{s}$。`,
          String.raw`要縮到 $\epsilon$ 倍需要 $\ln(1/\epsilon)$ 個時間常數：1% 是 $4.6\tau$、0.1% 是 $6.9\tau$。`,
        ],
      }
    },
    tips: [
      String.raw`$\ln$ 是自然對數鍵（不是 $\log$）。只有 $\log_{10}$ 時：$\ln x=2.3026\log_{10}x$。`,
      String.raw`心算檢查：$g\ll1$ 時 $\tau\approx1/g$、$\sigma_w^2\approx\mu\sigma_\eta^2/(2K)$。`,
      String.raw`預設的候選 A（$\sigma_v=100$、$N=4096$、$\mu=10$）是測試 T13 的條件：應得 $p=0.92021$、$\sigma_w=0.399\,\mathrm{fs}$。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.4：F-14.5＋勘誤 E48：δ0 很大時查 Φ 表檢查線性化，再用 slew-limited 估計
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.4',
    title: String.raw`勘誤 E48：$\delta_0$ 很大時線性公式還能用嗎？查 $\Phi$ 表，再做 slew-limited 估計`,
    page: PAGE,
    formulaId: 'F-14.5',
    formulaTex: String.raw`E[G\,|\,\delta_0]=2\Phi\!\Big(\frac{\delta_0}{\sigma_v}\Big)-1\quad\text{vs.}\quad K\delta_0\ (\text{線性}),\qquad |w_{k+1}-w_k|\le\mu\max|x|\ \Rightarrow\ B\gtrsim\frac{|\delta_0|-\delta_\text{target}}{\mu\max|x|}\qquad(x=\pm1,\ \theta=0)`,
    level: 'research',
    claim: 'approx',
    inputs: [
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差（取正值；負值對稱）', unit: String.raw`\mathrm{fs}`, default: 100, max: 1e6, practice: { choices: [50, 100, 200, 300] } },
      { key: 'sv', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, practice: { choices: [100, 200] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'coarse 階段的 learning rate', unit: String.raw`\mathrm{fs}`, default: 60, practice: { choices: [20, 40, 50, 60] } },
      { key: 'tgt', symbol: String.raw`\delta_\text{target}`, label: 'coarse 要把誤差拉到多小', unit: String.raw`\mathrm{fs}`, default: 10, practice: { choices: [5, 10, 20] } },
    ],
    validate: ({ d0, sv, mu, tgt }) => {
      const bad = checkSigmaV(sv) ?? checkMu(mu)
      if (bad) return bad
      if (!(d0 > 0)) return String.raw`請輸入正的 $\delta_0$：$E[G\,|\,\delta]$ 是奇函數，負的初始誤差只是整題變號，結論相同。`
      if (!(tgt >= 0)) return String.raw`$\delta_\text{target}$ 是誤差的絕對值目標，不可為負。`
      if (tgt >= d0) return String.raw`$\delta_\text{target}\ge|\delta_0|$：初始誤差已經在目標之內，不需要 coarse 階段（F-14.5 給 0 個 block）。請輸入比 $\delta_0$ 小的目標。`
      return checkLoopGain(mu * comparatorKq(sv))
    },
    solve: ({ d0, sv, mu, tgt }) => {
      const K = comparatorKq(sv)
      const z = d0 / sv
      const phi = normCdf(z)
      const mean = gmacMeanField(d0, gmacModel(1, sv, 0))
      const lin = K * d0
      const ratio = mean / lin
      const d1 = d0 - mu * mean
      const g = mu * K
      const d1lin = (1 - g) * d0
      const bReal = slewLimitedBlocks(d0, tgt, mu, 1)
      const bInt = Math.ceil(bReal - 1e-9)
      // Φ 接近 1（大 z）或接近 ½（小 z）時多顯示幾位：下一步的 2Φ − 1 才不會因為相消而對不上
      const phiTex = texNum(phi, Math.max(sigNear1(phi), sigNear1(2 * phi)))
      return {
        steps: [
          { tex: String.raw`z=\frac{\delta_0}{\sigma_v}=\frac{${n6(d0)}}{${n6(sv)}}=${n6(z)}`, why: String.raw`把誤差換成「幾個 $\sigma_v$」：comparator 看到 $e=\delta_0x+v$，輸出 $q\,x=+1$ 的機率是 $\Phi(z)$。` },
          {
            tex: String.raw`\Phi(z)=\Phi(${n6(z)})=${phiTex}`,
            why: String.raw`查標準常態累積分布表（附錄或任何統計課本；一般的表只有 4 位小數，夠用）；計算機有 erf 時用 $\Phi(z)=\tfrac12\big[1+\mathrm{erf}(z/\sqrt2)\big]$。`,
          },
          {
            tex: String.raw`E[G\,|\,\delta_0]=2\Phi(z)-1=2\times${phiTex}-1=${n6(mean)}`,
            why: String.raw`block 平均的期望值 $=P(q\,x=+1)-P(q\,x=-1)$。它永遠不超過 1（$|G|\le\max|x|=1$）。`,
          },
          {
            tex: String.raw`K\delta_0=\frac{${n6(ROOT_2_OVER_PI)}}{${n6(sv)}}\times${n6p(d0)}=${n6p(K)}\times${n6p(d0)}=${n6(lin)}`,
            why: String.raw`線性模型以為的平均輸出：$K=\sqrt{2/\pi}/\sigma_v$，等於 $${n6(ROOT_2_OVER_PI)}\,z$。`,
          },
          {
            tex: String.raw`\frac{E[G\,|\,\delta_0]}{K\delta_0}=\frac{${n6(mean)}}{${n6(lin)}}=${n6(ratio)}`,
            why: String.raw`真實恢復力 ÷ 線性模型的恢復力。小於 1 代表線性模型高估了收斂速度（低估 $E[\delta_B^2]$）。`,
          },
          {
            tex: String.raw`E[\delta_1]=\delta_0-\mu\,E[G\,|\,\delta_0]=${n6(d0)}-${n6p(mu)}\times${n6p(mean)}=${n6(d0)}-${n6(mu * mean)}=${n6(d1)}\ \mathrm{fs}`,
            why: String.raw`真正的第一步（mean-field）：$\delta_1=\delta_0-\mu G_0$ 取期望值。`,
          },
          {
            tex: String.raw`p\,\delta_0=(1-\mu K)\,\delta_0=(1-${n6p(mu)}\times${n6p(K)})\times${n6p(d0)}=(1-${n1(g)})\times${n6p(d0)}=${n1p(1 - g)}\times${n6p(d0)}=${n6(d1lin)}\ \mathrm{fs}`,
            why: String.raw`線性模型（F-14.2）預測的第一步，拿來和上一列比較。`,
          },
          {
            tex: String.raw`B\gtrsim\frac{|\delta_0|-\delta_\text{target}}{\mu\max|x|}=\frac{${n6(d0)}-${n6(tgt)}}{${n6p(mu)}\times1}=\frac{${n6(d0 - tgt)}}{${n6(mu)}}=${n6(bReal)}`,
            why: String.raw`slew-limited 估計（F-14.5）：每個 block 最多走 $\mu\max|x|=${n6(mu)}\,\mathrm{fs}$，所以至少要走這麼多步。`,
          },
          { tex: String.raw`B_{\min}=\lceil${n6(bReal)}\rceil=${int(bInt)}\ \text{blocks}`, why: 'block 數是整數：無條件進位。' },
        ],
        results: [
          { symbol: String.raw`E[G\,|\,\delta_0]`, label: '第一個 block 的平均 GMAC 輸出（查表）', value: mean, tolerance: { abs: 0.005, rel: 0.01 } },
          { symbol: String.raw`E[\delta_1]`, label: '一個 block 後的平均誤差（真實 mean-field）', value: d1, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 0.1, rel: 0.01 } },
          { symbol: String.raw`p\,\delta_0`, label: '線性模型預測的一個 block 後', value: d1lin, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 0.05, rel: 0.01 } },
          { symbol: String.raw`B_{\min}`, label: 'coarse 至少幾個 block（整數）', value: bInt, unit: String.raw`\text{blocks}`, tolerance: { abs: 0.01, rel: 0 } },
        ],
        notes: [
          z <= 0.2
            ? String.raw`$z=${texNum(z, 3)}\le0.2$：$E[G]/(K\delta_0)=${texNum(ratio, 4)}$，線性化誤差不到 1%（$\approx z^2/6$），可以直接用 F-14.3。`
            : z <= 0.5
              ? String.raw`$z=${texNum(z, 3)}$：恢復力只有線性模型的 $${texNum(100 * ratio, 3)}\%$，F-14.3 開始低估（勘誤 E48：$z=0.5$ 約 5%）。`
              : String.raw`$z=${texNum(z, 3)}>0.5$：恢復力只有線性模型的 $${texNum(100 * ratio, 3)}\%$，comparator 明顯飽和——這一段要用 F-14.5 或 Monte Carlo，不能套 F-14.3（勘誤 E48）。`,
          ...(lin > 1 ? [String.raw`線性模型的 $K\delta_0=${texNum(lin, 4)}>1$，已經超過 $|G|\le1$ 的物理上限：光看這個數字就知道線性化不能用。`] : []),
          mean > 0.99
            ? String.raw`第一步幾乎完全飽和：平均步長 $\mu E[G]=${texNum(mu * mean, 4)}\,\mathrm{fs}\approx\mu$。但 F-14.5 仍只是下界——誤差縮到 $\sigma_v$ 附近後 $E[G]$ 會掉下來（$z=1$ 時只剩 0.68），最後幾個 block 走得比 $\mu$ 慢，實際還要多幾個 block（§14.7 狀態機的 COARSE 預設留了餘裕）。`
            : String.raw`F-14.5 是下界：erf 沒有完全飽和時平均步長 $\mu E[G]=${texNum(mu * mean, 4)}\,\mathrm{fs}$ 比 $\mu=${n6(mu)}\,\mathrm{fs}$ 小，實際還要多幾個 block（§14.7 狀態機的 COARSE 預設留了餘裕）。`,
        ],
      }
    },
    tips: [
      String.raw`常用的表值：$${PHI_TABLE}$。`,
      String.raw`手算近似：$|z|\le0.2$ 時 $2\Phi(z)-1\approx\sqrt{2/\pi}\,z=${n6(ROOT_2_OVER_PI)}\,z$（相對誤差 $\approx z^2/6<1\%$，這正是線性化 $K\delta$）；$z\ge2.5$ 時 $2\Phi(z)-1\approx1$（誤差 $<1.3\%$）。`,
      String.raw`表上查不到的 $z$ 用相鄰兩格線性內插即可（表距 0.01 時內插誤差遠小於 $10^{-4}$）。`,
      String.raw`範例（$\delta_0=100$、$\mu=60$、目標 10 fs）就是 §14.1「設計含意」的 $(100-10)/60=1.5\Rightarrow2$ 個 block。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.5：F-14.8＋F-14.17：大 B 封閉式（預設值 = 第 10 課條件：A ≈ 300、μ* ≈ 11.17 fs）
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.5',
    title: String.raw`大 $B$ 封閉式：最佳 $\mu^*$ 與做得到的 RMS（順便驗證「只看 $T$」）`,
    page: PAGE,
    formulaId: 'F-14.8',
    formulaTex: String.raw`A=\frac{4BK^2\delta_0^2}{\sigma_\eta^2}=4TK^2\delta_0^2,\qquad \mu^*\approx\frac{\ln A}{2BK},\qquad E[\delta_B^2]^*\approx\frac{\sigma_\eta^2(1+\ln A)}{4BK^2}=\frac{1+\ln A}{4TK^2}\qquad\Big(B=\frac TN,\ \sigma_\eta^2=\frac1N\Big)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sv', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 的樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1024, 2048, 4096] } },
      { key: 'T', symbol: 'T', label: '總比較次數（開機校正預算）', default: 131072, min: 1, max: 1e12, integer: true, practice: { choices: [131072, 262144, 524288] } },
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差 $a-w_0$', unit: String.raw`\mathrm{fs}`, default: 3, min: -1e6, max: 1e6, practice: { choices: [2, 3, 5, 10] } },
    ],
    validate: ({ sv, N, T, d0 }) => {
      const bad = checkSigmaV(sv) ?? checkBudget(T, N) ?? checkLinear(d0, sv)
      if (bad) return bad
      const B = T / N
      const a = asymptoticFinalOptimum({ K: comparatorKq(sv), delta0: d0, sigmaEta2: 1 / N, B })
      if (!(a.A > 1)) {
        return String.raw`$A=4TK^2\delta_0^2=${texNum(a.A, 4)}\le1$：初始誤差已經低於這個預算做得到的雜訊底，$\ln A\le0$ 會給出 $\mu^*\le0$（最好的策略是不更新）。請加大 $|\delta_0|$ 或 $T$。`
      }
      if (!a.valid) {
        return String.raw`漸近式不適用：需要 $A\ge20$（初始誤差遠大於雜訊底）且 $g^*=\ln A/(2B)\le0.25$（才能把 $p^{2B}$ 換成 $e^{-2Bg}$）；現在 $A=${texNum(a.A, 4)}$、$g^*=${texNum(Math.log(a.A) / (2 * B), 3)}$。這種情形請用 Learning-Rate Optimizer 實驗解 F-14.7 的精確根。`
      }
      return null
    },
    solve: ({ sv, N, T, d0 }) => {
      const K = comparatorKq(sv)
      const B = T / N
      const s2 = 1 / N
      const model = { K, delta0: d0, sigmaEta2: s2, B }
      const a = asymptoticFinalOptimum(model)
      const exact = optimizeMu('final', model)
      const K2 = K * K
      const fourTK2 = 4 * T * K2 // 4TK² = 4BK²/σ_η²：A 的係數，也是成本的分母
      const lnA = Math.log(a.A)
      const rms = Math.sqrt(a.cost)
      const gStar = a.mu * K
      const dMu = (100 * (a.mu - exact.mu)) / exact.mu
      const dRms = 100 * (rms / Math.sqrt(exact.cost) - 1)
      return {
        steps: [
          { tex: String.raw`B=\frac{T}{N}=\frac{${int(T)}}{${int(N)}}=${int(B)}`, why: '更新次數 = 總比較次數 ÷ 每個 block 的樣本數。' },
          {
            tex: String.raw`K=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}=\frac{${n6(ROOT_2_OVER_PI)}}{${n6(sv)}}=${n6(K)}\ \mathrm{fs^{-1}}`,
            why: String.raw`comparator 增益（$\theta=0$）。$\sqrt{2/\pi}=${n6(ROOT_2_OVER_PI)}$。`,
          },
          { tex: String.raw`K^2=${n6p(K)}^2=${n6(K2)}\ \mathrm{fs^{-2}}`, why: String.raw`$A$ 與成本都用 $K^2$。也可以直接算 $K^2=\tfrac{2}{\pi}/\sigma_v^2=0.63662/\sigma_v^2$。` },
          {
            tex: String.raw`4TK^2=4\times${int(T)}\times${n6p(K2)}=${n6(fourTK2)}\ \mathrm{fs^{-2}}`,
            why: String.raw`先把這個數算好、記下來：它是 $A$ 的係數，也是最後成本的分母。$\sigma_\eta^2=1/N$，除以它等於乘 $N$，而 $BN=T$，所以 $4BK^2/\sigma_\eta^2=4TK^2$ 只剩 $T$（F-14.17 的關鍵）。`,
          },
          {
            tex: String.raw`A=\frac{4BK^2\delta_0^2}{\sigma_\eta^2}=4TK^2\times\delta_0^2=${n6p(fourTK2)}\times${n6p(d0)}^2=${n6p(fourTK2)}\times${n6p(d0 * d0)}=${n6(a.A)}`,
            why: String.raw`「初始誤差功率 ÷ 雜訊底」：上一步的數乘上 $\delta_0^2$。`,
          },
          { tex: String.raw`\ln A=\ln ${n6p(a.A)}=${n6(lnA)}`, why: String.raw`按自然對數鍵 $\ln$。` },
          {
            tex: String.raw`\mu^*\approx\frac{\ln A}{2BK}=\frac{${n6(lnA)}}{2\times${int(B)}\times${n6p(K)}}=\frac{${n6(lnA)}}{${n6(2 * B * K)}}=${n6(a.mu)}\ \mathrm{fs}`,
            why: String.raw`最佳 learning rate：此時 $\text{bias}^2=\delta_0^2/A$；再加大 $\mu$，省下的 bias 抵不過多出來的 variance。`,
          },
          {
            tex: String.raw`g^*=\mu^*K=\frac{\ln A}{2B}=\frac{${n6(lnA)}}{2\times${int(B)}}=\frac{${n6(lnA)}}{${int(2 * B)}}=${n6(gStar)}`,
            why: String.raw`檢查近似的前提 $g^*\ll1$（這裡要求 $\le0.25$），同時確認 $g^*\le1$（$PM\ge60^\circ$）。`,
          },
          {
            tex: String.raw`E[\delta_B^2]^*\approx\frac{1+\ln A}{4TK^2}=\frac{1+${n6(lnA)}}{${n6(fourTK2)}}=\frac{${n6(1 + lnA)}}{${n6(fourTK2)}}=${n6(a.cost)}\ \mathrm{fs^2}`,
            why: String.raw`做得到的最小均方誤差。分母就是第 4 步記下來的 $4TK^2$。`,
          },
          { tex: String.raw`\text{RMS}^*=\sqrt{${n6(a.cost)}}=${n6(rms)}\ \mathrm{fs}`, why: '開根號。' },
        ],
        results: [
          { symbol: 'B', label: '更新次數', value: B, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: 'A', label: '初始誤差功率 ÷ 雜訊底', value: a.A, digits: 6 },
          { symbol: String.raw`\mu^*`, label: '最佳 learning rate（漸近式）', value: a.mu, unit: String.raw`\mathrm{fs}`, digits: 5 },
          { symbol: String.raw`E[\delta_B^2]^*`, label: '最小均方誤差（漸近式）', value: a.cost, unit: String.raw`\mathrm{fs^2}`, digits: 5 },
          { symbol: String.raw`\text{RMS}^*`, label: '對應的 RMS', value: rms, unit: String.raw`\mathrm{fs}`, digits: 5 },
        ],
        notes: [
          String.raw`和精確解比較（F-14.7 的數值根，網站用 log 格點加黃金分割求出）：$\mu^*=${texNum(exact.mu, 5)}\,\mathrm{fs}$、RMS $=${texNum(Math.sqrt(exact.cost), 4)}\,\mathrm{fs}$；漸近式的 $\mu^*$ 差 $${pct(dMu)}$，` +
            (Math.abs(dRms) < 2
              ? String.raw`RMS 只差 $${pct(dRms)}$（谷底很平）。`
              : String.raw`RMS 差 $${pct(dRms)}$（$A$ 不夠大或 $g^*$ 不夠小時漸近式開始失準，請以精確解為準）。`),
          String.raw`F-14.17：把 $N$ 加倍、$T$ 不變再算一次——$A$ 和 $\text{RMS}^*$ 完全不變，只有 $B$ 減半、$\mu^*$ 加倍。資訊量只有 $T$ 次 1-bit 比較。`,
          String.raw`$\mu^*$ 只隨 $\ln\delta_0$ 變：把 $\delta_0$ 加倍，$\ln A$ 只增加 $\ln4=1.386$。`,
        ],
      }
    },
    tips: [
      String.raw`$K^2=\tfrac{2}{\pi}\cdot\tfrac{1}{\sigma_v^2}=0.63662/\sigma_v^2$，可以跳過開根號。`,
      String.raw`只有 $\log_{10}$ 鍵時：$\ln A=2.3026\log_{10}A$。`,
      String.raw`範例（第 10 課：$\sigma_v=100$、$N=4096$、$T=131072$、$\delta_0=3$）應得 $A\approx300$、$\mu^*\approx11.17\,\mathrm{fs}$。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.6：F-14.15＋F-14.16：corner 區間（勘誤 E16；預設值 = §14.5「先算一次」）
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.6',
    title: String.raw`Corner 區間：至少要幾次更新？$\mu$ 可以放在哪裡？`,
    page: PAGE,
    formulaId: 'F-14.15',
    formulaTex: String.raw`\frac{1-\epsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}},\qquad \text{非空}\iff B\ge\frac{\ln\epsilon}{\ln(1-r)},\quad r=\frac{K_{\min}}{K_{\max}}\qquad\big(|E[\delta_B]|\le\epsilon|\delta_0|,\ PM\ge60^\circ\big)`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'kmin', symbol: String.raw`K_{\min}`, label: '最慢 corner 的斜率', unit: String.raw`\mathrm{fs^{-1}}`, default: 0.004, practice: { choices: [0.002, 0.004, 0.005] } },
      { key: 'kmax', symbol: String.raw`K_{\max}`, label: '最快 corner 的斜率', unit: String.raw`\mathrm{fs^{-1}}`, default: 0.012, practice: { choices: [0.008, 0.01, 0.012] } },
      { key: 'eps', symbol: String.raw`\epsilon`, label: String.raw`相對縮減比（$0<\epsilon<1$，不是 fs）`, default: 0.01, practice: { choices: [0.01, 0.02, 0.05, 0.1] } },
      { key: 'B', symbol: 'B', label: '打算用的更新次數', default: 12, min: 1, max: 1e6, integer: true, practice: { choices: [8, 10, 12, 16, 20, 32] } },
    ],
    validate: ({ kmin, kmax, eps, B }) => {
      if (!(kmin > 0) || !(kmax > 0)) return MSG_POLARITY
      if (kmin > kmax) return String.raw`$K_{\min}=${texNum(kmin, 4)}$ 比 $K_{\max}=${texNum(kmax, 4)}$ 大：請對調（$K_{\min}$ 是所有 corner 中最小的斜率，決定下限；$K_{\max}$ 決定上限）。`
      const bad = checkEps(eps)
      if (bad) return bad
      const r = cornerInterval([kmin, kmax], eps, B)
      return r.ok ? null : (r.reason ?? '輸入不合法')
    },
    solve: ({ kmin, kmax, eps, B }) => {
      const c = cornerInterval([kmin, kmax], eps, B)
      const r = c.ratio
      const root = cornerContraction(c.muLo, kmin, 1) // ε^{1/B} = 1 − μ_min·K_min
      const lnEps = Math.log(eps)
      const ln1r = Math.log(1 - r)
      const width = c.muHi - c.muLo
      const widthPct = (100 * width) / c.muHi
      const slowAtHi = cornerContraction(c.muHi, kmin, B)
      const intervalNote = !c.nonEmpty
        ? String.raw`區間為空：最慢的 corner 需要 $\mu\ge${texNum(c.muLo, 5)}\,\mathrm{fs}$，最快的 corner 只容許 $\mu\le${texNum(c.muHi, 5)}\,\mathrm{fs}$。再找一個 $\mu$ 沒有用——要把 $B$ 加到 $${int(c.bMin)}$ 以上、縮小 corner 散佈（per-corner 正規化）、放寬 $\epsilon$，或改用兩段式步長。`
        : widthPct < 20
          ? String.raw`區間非空，但寬度只有上限的 $${texNum(widthPct, 3)}\%$：$K$ 只要估錯差不多這個比例，原本選好的 $\mu$ 就會掉到區間外。`
          : String.raw`區間非空，寬度是上限的 $${texNum(widthPct, 3)}\%$：$\mu$ 還有選擇的空間，可以再用 RMS（F-14.3）或 PVT 追蹤的需求在區間內挑。`
      return {
        steps: [
          { tex: String.raw`r=\frac{K_{\min}}{K_{\max}}=\frac{${n6(kmin)}}{${n6(kmax)}}=${n1(r)}`, why: 'corner 散佈比：越小代表快慢 corner 差越多。' },
          { tex: String.raw`\ln\epsilon=\ln ${n6p(eps)}=${n6(lnEps)}`, why: String.raw`按 $\ln$。$\epsilon<1$ 所以是負數。` },
          r < 1
            ? {
                tex: String.raw`\ln(1-r)=\ln(1-${n1(r)})=\ln ${n6p(1 - r)}=${n6(ln1r)}`,
                why: String.raw`先算 $1-r$ 再按 $\ln$（也是負數）。$r\le0.1$ 時可用 $\ln(1-r)\approx-r$，得 $B_{\min}\approx\ln(1/\epsilon)/r$（高估不到 6%，偏保守）。`,
              }
            : { tex: String.raw`\ln(1-r)=\ln 0=-\infty`, why: String.raw`$r=1$：沒有 corner 散佈，下一步的比值是 0——任何 $B\ge1$ 都可以。` },
          {
            tex:
              String.raw`\frac{\ln\epsilon}{\ln(1-r)}=\frac{${n6(lnEps)}}{${n6(ln1r)}}=${n6(c.bMinExact)}\ \Rightarrow\ ` +
              (c.bMinExact > 0 ? String.raw`B_{\min}=\lceil${n6(c.bMinExact)}\rceil=${int(c.bMin)}` : String.raw`B_{\min}=${int(c.bMin)}`),
            why: String.raw`非空條件（F-14.16）：兩個負數相除是正的；更新次數是整數，無條件進位（至少 1）。`,
          },
          {
            tex: String.raw`\epsilon^{1/B}=${n6p(eps)}^{1/${int(B)}}=${n1(root)}`,
            why: String.raw`每個 block 平均誤差至少要縮到的倍數。計算機：輸入 $\epsilon$，按 $y^x$，指數輸入 $1/B=${texNum(1 / B, 5)}$；或用 $e^{(\ln\epsilon)/B}=e^{${texNum(lnEps / B, 5)}}$。`,
          },
          {
            tex: String.raw`\mu_{\min}=\frac{1-\epsilon^{1/B}}{K_{\min}}=\frac{1-${n1(root)}}{${n6(kmin)}}=\frac{${n6(1 - root)}}{${n6(kmin)}}=${n6(c.muLo)}\ \mathrm{fs}`,
            why: String.raw`下限由最慢的 corner 決定：它也要在 $B$ 次內縮到 $\epsilon$。`,
          },
          { tex: String.raw`\mu_{\max}=\frac{1}{K_{\max}}=\frac{1}{${n6(kmax)}}=${n6(c.muHi)}\ \mathrm{fs}`, why: String.raw`上限由最快的 corner 決定：$\mu K_{\max}\le1$ 才有 $PM\ge60^\circ$。` },
          {
            tex: String.raw`\mu_{\max}-\mu_{\min}=${n6(c.muHi)}-${n6(c.muLo)}=${n6(width)}\ \mathrm{fs}\quad(${c.nonEmpty ? String.raw`\ge0:\ \text{區間非空}` : String.raw`<0:\ \text{區間為空}`})`,
            why: String.raw`下限不超過上限才有解。結論應該和第 4 步一致：$B=${int(B)}${B >= c.bMin ? String.raw`\ge ` : '<'}B_{\min}=${int(c.bMin)}$。`,
          },
        ],
        results: [
          { symbol: String.raw`\frac{\ln\epsilon}{\ln(1-r)}`, label: '非空所需的最小 $B$（實數）', value: c.bMinExact, digits: 5 },
          { symbol: String.raw`B_{\min}`, label: '進位成整數', value: c.bMin, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: String.raw`\mu_{\min}`, label: '下限（最慢 corner）', value: c.muLo, unit: String.raw`\mathrm{fs}`, digits: 5 },
          { symbol: String.raw`\mu_{\max}`, label: '上限（最快 corner）', value: c.muHi, unit: String.raw`\mathrm{fs}`, digits: 5 },
        ],
        notes: [
          intervalNote,
          String.raw`驗算：取 $\mu=\mu_{\max}$ 時最慢的 corner 縮到 $(1-r)^{B}=${texNum(slowAtHi, 4)}$，${slowAtHi <= eps * (1 + 1e-12) ? String.raw`$\le\epsilon$，符合` : String.raw`$>\epsilon$，不符合`}；取 $\mu=\mu_{\min}$ 時恰好是 $\epsilon=${n6(eps)}$。`,
          String.raw`這個區間只管平均誤差。若 $\epsilon|\delta_0|$ 比雜訊底 $\sigma_w$ 還小，RMS 仍然達不到，要再用 F-14.3（HC-14.2）檢查每個 corner 的 variance。`,
        ],
      }
    },
    tips: [
      String.raw`$\epsilon$ 是比例不是 fs：規格「殘差不超過 1 fs」、$\delta_0=50\,\mathrm{fs}$ 時用 $\epsilon=1/50=0.02$（勘誤 E16）。`,
      String.raw`開 $B$ 次方根：$\epsilon^{1/B}=e^{(\ln\epsilon)/B}$。例如 $0.01^{1/12}$：$${n6(Math.log(0.01))}/12=${n6(Math.log(0.01) / 12)}$，$e^{${n6(Math.log(0.01) / 12)}}=${texNum(EX6_ROOT, 5)}$。`,
      String.raw`範例（$K_{\min}=0.004$、$K_{\max}=0.012$、$\epsilon=0.01$）：$B_{\min}=${texNum(EX6.bMinExact, 4)}\to${int(EX6.bMin)}$；$B=12$ 時區間 $[${texNum(EX6.muLo, 5)},\ ${texNum(EX6.muHi, 5)}]\,\mathrm{fs}$。把 $B$ 改成 11 會變成空集合。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.7：F-14.18：最佳遞減步長（scalar Kalman）——只需四則運算
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.7',
    title: String.raw`最佳遞減步長（Kalman 下界）：$P_B$ 與頭尾兩個 $\mu_k$`,
    page: PAGE,
    formulaId: 'F-14.18',
    formulaTex: String.raw`\frac{1}{P_B}=\frac{1}{\delta_0^2}+B\,\frac{K^2}{\sigma_\eta^2},\qquad k_0=\frac{\sigma_\eta^2}{K^2\delta_0^2},\qquad \mu_k=\frac{1}{K\,(k+1+k_0)},\qquad\sigma_\eta^2=\frac1N`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差 $a-w_0$', unit: String.raw`\mathrm{fs}`, default: 3, min: -1000, max: 1000, practice: { choices: [1, 2, 3, 5] } },
      {
        key: 'K',
        symbol: 'K',
        label: String.raw`GMAC 斜率 $K=K_qC$（$\sigma_v=100\,\mathrm{fs}$、$\theta=0$ 時為 $${n6(K_LESSON)}$）`,
        unit: String.raw`\mathrm{fs^{-1}}`,
        default: K_LESSON,
        practice: { choices: [0.004, 0.005, 0.008, 0.01] },
      },
      { key: 'N', symbol: 'N', label: '每個 block 的樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1000, 1024, 4096] } },
      { key: 'B', symbol: 'B', label: '更新次數', default: 32, min: 2, max: 100000, integer: true, practice: { choices: [8, 16, 32, 64] } },
    ],
    validate: ({ d0, K }) => {
      if (!(K > 0)) return MSG_POLARITY
      if (d0 === 0) return String.raw`$\delta_0=0$：已經在答案上，$k_0=\sigma_\eta^2/(K^2\delta_0^2)\to\infty$、最佳步長全部是 0（不要更新）。請輸入非零的初始誤差。`
      return checkLinearK(d0, K)
    },
    solve: ({ d0, K, N, B }) => {
      const s2 = 1 / N
      const sch = optimalSchedule(d0, K, s2, B)
      const K2 = K * K
      const info = K2 * N
      const inv0 = 1 / (d0 * d0)
      const invPB = inv0 + B * info
      const first = sch.mu[0]
      const last = sch.mu[B - 1]
      return {
        steps: [
          { tex: String.raw`K^2=${n6p(K)}^2=${n6(K2)}\ \mathrm{fs^{-2}}`, why: '先把斜率平方。' },
          {
            tex: String.raw`\frac{K^2}{\sigma_\eta^2}=K^2N=${n6p(K2)}\times${int(N)}=${n6(info)}\ \mathrm{fs^{-2}}`,
            why: String.raw`每個 block 帶來的「資訊量」。$\sigma_\eta^2=1/N$，除以它等於乘 $N$。`,
          },
          { tex: String.raw`\frac{1}{\delta_0^2}=\frac{1}{${n6p(d0)}^2}=\frac{1}{${n6(d0 * d0)}}=${n6(inv0)}\ \mathrm{fs^{-2}}`, why: String.raw`開始校正前對 $\delta$ 的了解（先驗資訊）：$P_0=\delta_0^2$。` },
          {
            tex: String.raw`\frac{1}{P_B}=\frac{1}{\delta_0^2}+B\,\frac{K^2}{\sigma_\eta^2}=${n6(inv0)}+${int(B)}\times${n6p(info)}=${n6(inv0)}+${n6(B * info)}=${n6(invPB)}\ \mathrm{fs^{-2}}`,
            why: String.raw`資訊量每個 block 加一份，$B$ 個 block 就加 $B$ 份。`,
          },
          { tex: String.raw`P_B=\frac{1}{${n6(invPB)}}=${n6(sch.PB)}\ \mathrm{fs^2}`, why: String.raw`取倒數：任何步長序列在 $B$ 次更新後都不可能比這個均方誤差更小。` },
          {
            tex: String.raw`k_0=\frac{\sigma_\eta^2}{K^2\delta_0^2}=\frac{1/\delta_0^2}{K^2/\sigma_\eta^2}=\frac{${n6(inv0)}}{${n6(info)}}=${n6(sch.k0)}`,
            why: String.raw`起點偏移：先驗資訊相當於幾個 block。用前面算好的兩個數相除。`,
          },
          {
            tex: String.raw`\mu_0=\frac{1}{K\,(0+1+k_0)}=\frac{1}{${n6p(K)}\times(1+${n6(sch.k0)})}=\frac{1}{${n6p(K)}\times${n6p(1 + sch.k0)}}=\frac{1}{${n6(K * (1 + sch.k0))}}=${n6(first)}\ \mathrm{fs}`,
            why: String.raw`第一步（$k=0$）最大：括號裡先加、再乘 $K$、最後取倒數。等效迴路增益 $\mu_0K=1/(1+k_0)=${texNum(first * K, 4)}$。`,
          },
          {
            tex: String.raw`\mu_{${int(B - 1)}}=\frac{1}{K\,(B+k_0)}=\frac{1}{${n6p(K)}\times(${int(B)}+${n6(sch.k0)})}=\frac{1}{${n6p(K)}\times${n6p(B + sch.k0)}}=\frac{1}{${n6(K * (B + sch.k0))}}=${n6(last)}\ \mathrm{fs}`,
            why: String.raw`最後一步（$k=B-1$，所以 $k+1=B$）最小：步長照 $1/k$ 遞減，等於把所有 block 的 $G$ 等權重平均。`,
          },
        ],
        results: [
          { symbol: 'P_B', label: '均方誤差的下界', value: sch.PB, unit: String.raw`\mathrm{fs^2}`, digits: 5 },
          { symbol: 'k_0', label: '起點偏移', value: sch.k0, digits: 5 },
          { symbol: String.raw`\mu_0`, label: '第一步的步長', value: first, unit: String.raw`\mathrm{fs}`, digits: 5 },
          { symbol: String.raw`\mu_{B-1}`, label: '最後一步的步長', value: last, unit: String.raw`\mathrm{fs}`, digits: 5 },
        ],
        notes: [
          String.raw`開根號（這一步才需要計算機）：下界的 RMS $=\sqrt{P_B}=${texNum(Math.sqrt(sch.PB), 4)}\,\mathrm{fs}$。拿去和 HC-14.5 的固定 $\mu$ 最佳值比較，差距約 $\sqrt{(1+\ln A)/4}$ 倍（F-14.19）。`,
          B * info >= 10 * inv0
            ? String.raw`這裡 $B\,K^2/\sigma_\eta^2\gg1/\delta_0^2$，所以 $P_B\approx\sigma_\eta^2/(BK^2)=${n6(1 / (B * info))}\,\mathrm{fs^2}$，幾乎與 $\delta_0$ 無關；而且 $B\,K^2/\sigma_\eta^2=TK^2$ 只看總比較次數 $T=NB$。`
            : String.raw`這組數字的量測資訊 $B\,K^2/\sigma_\eta^2=${n6(B * info)}$ 還沒有遠大於先驗資訊 $1/\delta_0^2=${n6(inv0)}\,\mathrm{fs^{-2}}$：$P_B$ 仍然和 $\delta_0^2=${n6(d0 * d0)}\,\mathrm{fs^2}$ 有關（校正能幫的忙有限）。要讓 $P_B\approx\sigma_\eta^2/(BK^2)$，得加大總比較次數 $T=NB$。`,
          String.raw`步長從 $${texNum(first, 4)}$ 降到 $${texNum(last, 4)}\,\mathrm{fs}$（$${texNum(first / last, 3)}$ 倍）：兩段式 coarse／fine 就是用兩個台階去逼近這條 $1/k$ 曲線。`,
        ],
      }
    },
    tips: [
      String.raw`全程只有加減乘除與倒數：先算 $K^2N$ 和 $1/\delta_0^2$ 兩個數，後面每一步都用它們。`,
      String.raw`$\mu_kK=1/(k+1+k_0)\le1$ 永遠成立，所以這個排程每一步都滿足 $PM\ge60^\circ$。`,
      String.raw`範例是第 10 課的條件（$\delta_0=3$、$N=4096$、$B=32$、$K=${n6(K_LESSON)}$）。`,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HC-14.8：綜合題：重現第 10 課設計計算器（α = 11.20 fs、pole 0.9106、PM 87.4°、RMS 0.449 fs）
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-14.8',
    title: String.raw`綜合題：從規格到 $\mu$、pole、PM、RMS——用紙筆重現第 10 課的設計計算器`,
    page: PAGE,
    formulaTex: String.raw`\begin{aligned}
B&=\frac{T}{N},\qquad K=\sqrt{\tfrac{2}{\pi}}\,\frac{\cos\theta}{\sigma_v},\qquad \mu=\frac{1-\epsilon^{1/B}}{K},\qquad p=1-\mu K,\qquad PM=90^\circ-\arcsin\frac{\mu K}{2},\\
\tau&=-\frac{1}{\ln p},\qquad E[\delta_B^2]=\delta_0^2\,p^{2B}+\mu^2\sigma_\eta^2\,\frac{1-p^{2B}}{1-p^2},\qquad \sigma_\eta^2=\frac1N
\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始誤差 $a-w_0$', unit: String.raw`\mathrm{fs}`, default: 3, min: -1e6, max: 1e6, practice: { choices: [2, 3, 5] } },
      { key: 'sv', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 的樣本數', default: 4096, min: 1, max: 1e9, integer: true, practice: { choices: [1024, 2048, 4096] } },
      { key: 'T', symbol: 'T', label: '總比較次數（開機校正預算）', default: 131072, min: 1, max: 1e12, integer: true, practice: { choices: [65536, 131072, 262144] } },
      { key: 'eps', symbol: String.raw`\epsilon`, label: String.raw`收斂要求：平均誤差縮到 $\epsilon$ 倍（$0<\epsilon<1$）`, default: 0.05, practice: { choices: [0.01, 0.02, 0.05, 0.1] } },
      { key: 'theta', symbol: String.raw`\theta`, label: '誤差路徑相位', unit: String.raw`^\circ`, default: 0, min: -180, max: 180, practice: { choices: [0, 30, 45, 60] } },
    ],
    validate: ({ d0, sv, N, T, eps, theta }) => {
      const bad = checkSigmaV(sv) ?? checkBudget(T, N) ?? checkEps(eps)
      if (bad) return bad
      if (Math.abs(theta) >= 90) {
        return String.raw`$C\le0$：更新極性錯誤。$|\theta|=${texNum(Math.abs(theta), 4)}^\circ\ge90^\circ$ 時 $C=\cos\theta\le0$，$K=K_qC\le0$，正的 learning rate 會讓平均誤差發散（$\theta=\pm90^\circ$ 是 random walk）。任何 $\mu$ 都救不了，請先修正極性或對齊延遲（Ch06／Ch07）。`
      }
      if (d0 === 0) return String.raw`$\delta_0=0$：沒有初始誤差要收斂，「縮到 $\epsilon$ 倍」沒有意義。請輸入非零的 $\delta_0$。`
      return checkLinear(d0, sv)
    },
    solve: ({ d0, sv, N, T, eps, theta }) => {
      const B = T / N
      const rootC = loopGainK(1, theta) // √(2/π)·cos θ（模型的 K 在 σ_v = 1 時的值）
      const C = rootC / ROOT_2_OVER_PI // cos θ（由模型的 K 反推，與 loopGainK 一致）
      const K = loopGainK(sv, theta)
      const mu = convergenceMuMin(K, eps, B)
      const g = mu * K
      const p = 1 - g
      const pm = calPhaseMarginDeg(g)
      const tau = timeConstantBlocks(p)
      const s2 = 1 / N
      const sp = msdSplit(d0, p, mu, s2, B)
      const noise = noisePerUpdate(p, mu, s2)
      const S = geomSum2(p, B)
      const p2 = p * p
      const p2B = poleToThe2B(p, B)
      const rms = Math.sqrt(sp.total)
      const asinDeg = 90 - pm
      const exact = optimizeMu('final', { K, delta0: d0, sigmaEta2: s2, B })
      const exactRms = Math.sqrt(exact.cost)
      const excess = 100 * (rms / exactRms - 1)
      const cosTex = theta < 0 ? String.raw`\cos(${n6(theta)}^\circ)` : String.raw`\cos ${n6(theta)}^\circ`
      return {
        steps: [
          { tex: String.raw`B=\frac{T}{N}=\frac{${int(T)}}{${int(N)}}=${int(B)}`, why: '更新次數 = 總比較次數 ÷ 每個 block 的樣本數。' },
          {
            tex: String.raw`C=\cos\theta=${cosTex}=${n6(C)}`,
            why: String.raw`有效相關。計算機切到 DEG（度）模式再按 $\cos$；$\theta=0$ 時 $C=1$。`,
          },
          {
            tex: String.raw`K=\sqrt{\tfrac{2}{\pi}}\,\frac{C}{\sigma_v}=\frac{${n6(ROOT_2_OVER_PI)}\times${n6p(C)}}{${n6(sv)}}=\frac{${n6(rootC)}}{${n6(sv)}}=${n6(K)}\ \mathrm{fs^{-1}}`,
            why: String.raw`GMAC 斜率 $K=K_qC$：先乘 $C$、再除以 $\sigma_v$。$\sqrt{2/\pi}=${n6(ROOT_2_OVER_PI)}$（按 $2\div\pi$ 再開根號）。`,
          },
          {
            tex: String.raw`\epsilon^{1/B}=${n6p(eps)}^{1/${int(B)}}=${n1(p)}`,
            why: String.raw`每個 block 平均誤差要縮到的倍數——它就是我們要的 pole。計算機：$y^x$ 的指數輸入 $1/B=${texNum(1 / B, 5)}$；或 $e^{(\ln\epsilon)/B}=e^{${texNum(Math.log(eps) / B, 5)}}$。`,
          },
          {
            tex: String.raw`\mu=\frac{1-\epsilon^{1/B}}{K}=\frac{1-${n1(p)}}{${n6(K)}}=\frac{${n6(g)}}{${n6(K)}}=${n6(mu)}\ \mathrm{fs}`,
            why: String.raw`剛好讓 $B$ 次更新把平均誤差縮到 $\epsilon$ 的最小 learning rate（F-14.15 的單一 corner 版）。分子就是 $g=\mu K$。`,
          },
          { tex: String.raw`p=1-\mu K=1-${n6(g)}=${n1(p)}`, why: String.raw`pole；依定義等於上面的 $\epsilon^{1/B}$，是一個現成的驗算。` },
          {
            tex: String.raw`PM=90^\circ-\arcsin\frac{g}{2}=90^\circ-\arcsin\frac{${n6(g)}}{2}=90^\circ-\arcsin ${n6p(g / 2)}=90^\circ-${n6(asinDeg)}^\circ=${n6(pm)}^\circ`,
            why: String.raw`一階校正迴路的 phase margin（F-14.14）。DEG 模式按 $\sin^{-1}$；$g/2\le0.2$ 時可用 $\arcsin x\approx57.296^\circ\times x$（誤差 $<0.7\%$）。`,
          },
          {
            tex: String.raw`\tau=-\frac{1}{\ln p}=-\frac{1}{\ln ${n1p(p)}}=-\frac{1}{${n6p(-1 / tau)}}=${n6(tau)}\ \text{blocks}`,
            why: String.raw`時間常數。驗算：$B/\tau=${texNum(B / tau, 4)}$ 應等於 $\ln(1/\epsilon)=${texNum(-Math.log(eps), 4)}$。`,
          },
          {
            tex: String.raw`p^{2B}=(p^{B})^2=\epsilon^2=${n6p(eps)}^2=${n1(p2B)}`,
            why: String.raw`不必按 $${int(2 * B)}$ 次方：這個 $\mu$ 正是讓 $p^B=\epsilon$ 的那一個。`,
          },
          {
            tex: String.raw`\text{bias}^2=\delta_0^2\,p^{2B}=${n6p(d0)}^2\times${n1p(p2B)}=${n6p(d0 * d0)}\times${n1p(p2B)}=${n6(sp.bias2)}\ \mathrm{fs^2}`,
            why: String.raw`還沒收完的初始誤差：$(\epsilon\delta_0)^2$。`,
          },
          {
            tex: String.raw`\mu^2\sigma_\eta^2=\frac{\mu^2}{N}=\frac{${n6p(mu)}^2}{${int(N)}}=\frac{${n6(mu * mu)}}{${int(N)}}=${n6(noise)}\ \mathrm{fs^2}`,
            why: String.raw`每次更新注入的雜訊功率（$\sigma_\eta^2=1/N$）。`,
          },
          { tex: String.raw`p^2=${n1p(p)}^2=${n1(p2)}`, why: String.raw`等比數列的公比。` },
          {
            tex: String.raw`\text{variance}=\mu^2\sigma_\eta^2\,\frac{1-p^{2B}}{1-p^2}=${n6p(noise)}\times\frac{1-${n1(p2B)}}{1-${n1(p2)}}=${n6p(noise)}\times\frac{${n6(1 - p2B)}}{${n6(1 - p2)}}=${n6p(noise)}\times${n6p(S)}=${n6(sp.variance)}\ \mathrm{fs^2}`,
            why: '累積的更新雜訊：兩次減法、一次除法、一次乘法。',
          },
          { tex: String.raw`E[\delta_B^2]=\text{bias}^2+\text{variance}=${n6(sp.bias2)}+${n6(sp.variance)}=${n6(sp.total)}\ \mathrm{fs^2}`, why: 'F-14.3：兩項相加。' },
          { tex: String.raw`\text{RMS}=\sqrt{${n6(sp.total)}}=${n6(rms)}\ \mathrm{fs}`, why: '開根號。' },
        ],
        results: [
          { symbol: String.raw`\mu`, label: '建議的 learning rate（課程的 $\\alpha$）', value: mu, unit: String.raw`\mathrm{fs}`, digits: 5 },
          { symbol: 'p', label: 'pole', value: p, digits: 5 },
          { symbol: 'PM', label: 'phase margin', value: pm, unit: String.raw`^\circ`, digits: 4 },
          { symbol: String.raw`\tau`, label: '時間常數', value: tau, unit: String.raw`\text{blocks}`, digits: 4 },
          { symbol: String.raw`\sqrt{E[\delta_B^2]}`, label: '$B$ 次更新後的 RMS', value: rms, unit: String.raw`\mathrm{fs}`, digits: 4 },
        ],
        notes: [
          String.raw`這個 $\mu$ 是「收斂要求的下限」，不是終點 RMS 的最小點。精確最佳值（F-14.7 的數值根）是 $\mu^*=${texNum(exact.mu, 5)}\,\mathrm{fs}$、RMS $${texNum(exactRms, 4)}\,\mathrm{fs}$；` +
            (excess < 2
              ? String.raw`本題的 RMS 只比它多 $${pct(excess)}$（谷底很平，§14.4）。`
              : mu > exact.mu
                ? String.raw`本題的 RMS 比它多 $${texNum(excess, 2)}\%$：這個 $\epsilon$ 比「RMS 最小」需要的還嚴，$\mu$ 被推到最佳值的 $${texNum(mu / exact.mu, 3)}$ 倍，多出來的都是 variance。`
                : String.raw`本題的 RMS 比它多 $${texNum(excess, 2)}\%$：這個 $\epsilon$ 太寬鬆，$\mu$ 只有最佳值的 $${texNum(mu / exact.mu, 3)}$ 倍，$\text{bias}^2$ 還沒收完。`),
          String.raw`$\text{bias}^2$ 占 $${texNum((100 * sp.bias2) / sp.total, 3)}\%$、variance 占 $${texNum((100 * sp.variance) / sp.total, 3)}\%$：$\epsilon$ 取得越小，$\mu$ 越大，variance 的比重越高。`,
          String.raw`$g=1-\epsilon^{1/B}$ 一定落在 $(0,1)$，所以這樣選的 $\mu$ 永遠有 $PM>60^\circ$；適用性（勘誤 E48）：$|\delta_0|/\sigma_v=${texNum(Math.abs(d0) / sv, 3)}\le0.5$。`,
        ],
      }
    },
    tips: [
      String.raw`範例（$\delta_0=3$、$\sigma_v=100$、$N=4096$、$T=131072$、$\epsilon=0.05$、$\theta=0$）應該重現第 10 課的四個數字：$\alpha=11.20\,\mathrm{fs}$、pole $0.9106$、$PM=87.4^\circ$、RMS $0.449\,\mathrm{fs}$。`,
      String.raw`按鍵順序建議：先算並記下 $K$、$p$、$\mu$ 三個數（存進記憶鍵），後面每一步都用得到。`,
      String.raw`把 $\theta$ 改成 $60^\circ$：$C=0.5$，$K$ 減半、$\mu$ 加倍，pole 與 PM 不變，但 variance 變成 4 倍（RMS 接近 2 倍）——相位沒對好的代價。`,
      String.raw`$\arcsin$ 的弧度／度換算：$1\,\mathrm{rad}=57.296^\circ$。`,
    ],
  },
]
