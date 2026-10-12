import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcResult, HandCalcStep } from '@/data/types'
import { erf, trace } from '@/simulation/core'
import {
  DECAY_95,
  DEFAULT_RULE,
  analyzeRule,
  blockUpdate,
  buildPlant,
  centralDiffJacobian,
  corrMatrix,
  fdTruncationFactor,
  gmacLinear,
  inspectMatrix,
  kqFromSigma,
  mScalar,
  modeVarianceClosed,
  preconditionedModeVar,
  resolveJhat,
  ruleModeGain,
  signGmacMean,
  stepsToDecay,
  stepsToDecayReal,
  type Mat,
  type RuleConfig,
} from '@/simulation/models/mimo'

/**
 * Ch10 的「帶入手算」題（docs/teaching-style.md §7；範本 src/chapters/ch00/handcalcs.ts）。
 *  1. 每題的數值都呼叫 src/simulation/models/mimo.ts 的實際函式（buildPlant / gmacLinear / blockUpdate / analyzeRule /
 *     inspectMatrix / preconditionedModeVar / modeVarianceClosed / ruleModeGain / centralDiffJacobian / fdTruncationFactor / resolveJhat…），
 *     步驟裡只做「把數字代進去」的顯示用四則運算；handcalcs.test.tsx 另以獨立公式逐題比對。
 *  2. 極性與勘誤：δ = a − w；K_q 一律明寫（E05 / E08）；模式變異與參數變異分開（E37）；regularizer 記為 λ_reg（E22）；
 *     poles 用 eig(I + MJ)（E24）。
 *  3. inputs 的 default 是本章 worked example 的數字（§10.1、§10.3.1、§10.4、§10.4.1、§10.5、§10.5.1），
 *     所以預設答案可以直接和文中表格、T10 / T11 / T18 的 golden vector 對上。
 *  4. 每個等號只做一種運算並把中間值寫出來（一次乘法、一次開根號、一次查表…）；需要 ln／√／erf 的步驟在 why 或 tips 說明怎麼按計算機、
 *     有手算近似時附上適用範圍（ln(1 − x) ≈ −x − x²/2、erf(x) ≈ (2/√π)(x − x³/3)、erf(x) = 2Φ(√2 x) − 1）。
 *  5. 畫面上的數字：加、減、乘得到的有限小數用 tx() 完整寫出（手算的人得到的就是它，也順便去掉 double 的 1e−16 殘渣），
 *     寫不完的數（商、√、ln、erf）四捨五入到 5 位；要拿去「用 1 去減」或互相抵銷的量（pole、近奇異矩陣的反矩陣）留 7 位。
 *     handcalcs.test.tsx 把每一步的 TeX 重新求值：相鄰兩個等號的數字必須相等、每個答案都是某一步的結果
 *     （預設值、20 組隨機數字、使用者自己打的極端數字）。兩項剛好抵銷時畫面與答案都是 0。
 *  6. practice 的每一種組合都是模型裡真的會出現的數字（例如 HC-10.6 兩個讀數的差不會比 2K_qΔ 大出量測雜訊）；
 *     validate 擋掉模型不適用的輸入並說明原因；仍可計算、但線性化已經不準的組合（|δ| 不夠小、N 太小）在「觀察」中明講。
 *
 * 題目在章內的位置（各節用 common.tsx 的 <Hand id="…"> 放在對應推導／worked example 的正後方）：
 *  HC-10.1 → §10.2（F-10.1 之後）、HC-10.2／HC-10.3 → §10.3.1（598 表格／反矩陣大小之後）、HC-10.4 → §10.4（F-10.6 與數字之後）、
 *  HC-10.5 → §10.4.1（F-10.8 與 E22 說明之後）、HC-10.6 → §10.5（中央差分截斷／雜訊表之後）、HC-10.7 → §10.5.1（F-10.11 之後）、
 *  HC-10.8（綜合）→ 「綜合手算」一節，思考題之前。
 */

const PAGE = '/ch/10'
const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })
/** √(2/π) = K_q·σ_v（由模型函式取得，不另寫常數）≈ 0.79788 */
const C_KQ = kqFromSigma(1)
/** 讓 K_q = 1 fs⁻¹ 的 σ_v（「K_q 正規化為 1」；勘誤 E05 / E08） */
const SIGMA_KQ1 = C_KQ
/** ln 0.05（95% 衰減門檻，與模型的 DECAY_95 相同） */
const LN_DECAY = Math.log(DECAY_95)
/** gmacLinear 的雜訊產生器設為 0 ⇒ 回傳的就是平均 K_q C δ */
const noNoise = () => 0
/** 中央差分示範量測用的固定 seed（可重現） */
const FD_SEED = 20261010

/** 浮點殘餘（例如 4.4e−16）顯示成 0 */
const snap = (x: number, scale = 1): number => (Math.abs(x) < 1e-12 * Math.max(1, Math.abs(scale)) ? 0 : x)
/**
 * 代入用的數字（TeX）。加、減、乘得到的「有限小數」（去掉 double 的 1e−15 殘渣後不超過 9 位有效數字）完整寫出——
 * 人在紙上算 1.625² 得到的就是 2.640625，不是 2.6406；寫不完的數（商、√、ln、erf）才四捨五入到 sig 位。
 * 例：0.30000000000000004 → 0.3、0.0050000000000000044 → 0.005、1/3 → 0.33333。
 */
function tx(x: number, sig = 5): string {
  if (!Number.isFinite(x) || x === 0) return texNum(x, sig)
  const clean = Number(x.toPrecision(14))
  const digits = clean.toExponential().split('e')[0].replace(/[-.]/g, '').length
  return digits <= 9 ? texNum(clean, Math.max(sig, digits)) : texNum(x, sig)
}
/** tx 的代入版：負數加括號 */
const txP = (x: number, sig = 5): string => {
  const s = tx(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}
/** 乘式裡的因數：負數與科學記號（9.999×10⁻⁵）加括號，避免讀成連乘三個數 */
const par = (s: string): string => (s.startsWith('-') || s.includes('\\times') ? `(${s})` : s)
const txMul = (x: number, sig = 5): string => par(tx(x, sig))
/** 接在另一個數字後面的「± |x|」：1 + (−0.2) 直接寫成 1 − 0.2 */
const txSigned = (x: number, sig = 5): string => (x < 0 ? `-${tx(-x, sig)}` : `+${tx(x, sig)}`)
/** 2×2 矩陣 → TeX bmatrix */
const bm = (A: number[][], sig = 5): string => `\\begin{bmatrix}${A.map((r) => r.map((v) => tx(snap(v), sig)).join('&')).join('\\\\')}\\end{bmatrix}`
/** sample 數這類整數：不做 5 位有效數字的四捨五入（262144 不可顯示成 262140） */
const texInt = (k: number): string => texNum(k, 12)
/** (x)²：一律加括號，避免科學記號或負數的平方排版錯誤 */
const sq = (x: number, sig = 5): string => `\\left(${tx(x, sig)}\\right)^2`
/** pole 類答案的容許誤差：以「離 0 或離 1 的距離」的 2% 計（0.9995 不可以被 0.99 矇混過關） */
const poleTol = (p: number): HandCalcResult['tolerance'] => ({ abs: Math.max(1e-9, 0.02 * Math.min(Math.abs(p), Math.abs(1 - p))), rel: 0 })
/** 反矩陣元素的容許誤差 0.2%：近奇異時對角與非對角只差 1%（25.126 對 24.874），預設的 1% 會把兩者混為一談 */
const M_TOL: HandCalcResult['tolerance'] = { rel: 0.002 }
/** block 數（整數）的容許誤差：±0.5，或 0.2%（很大的 k₉₅ 允許 ln 的四捨五入誤差） */
const BLOCK_TOL: HandCalcResult['tolerance'] = { abs: 0.5, rel: 0.002 }

const MSG_RHO_GT1 = String.raw`$|\rho|>1$：$\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}$ 的 eigenvalue $1-|\rho|<0$，不是半正定——自相關矩陣滿足 $\mathbf c^T\mathbf R\mathbf c=E[(\mathbf c^T\mathbf u)^2]\ge0$，兩個 unit-RMS regressor 的相關係數不可能超過 1。請輸入 $|\rho|\le1$。`
const MSG_RHO_EQ1 = String.raw`$|\rho|=1$：$\lambda_{\min}=1-|\rho|=0$，兩個 regressor 完全相關，有一個方向 GMAC 完全看不到（不可辨識，缺乏 persistent excitation）。這個方向的 pole 恆為 1、變異無限大，公式不適用；Preconditioner 可以加速，但不能製造缺失的資訊。請輸入 $|\rho|<1$。`
const MSG_SIGMA = String.raw`$\sigma_v$ 必須 $>0$：$K_q=\sqrt{2/\pi}/\sigma_v$，沒有雜訊（$\sigma_v=0$）時 1-bit comparator 是純粹的 sign，沒有線性的小訊號增益。`
const MSG_GAMMA = String.raw`$\gamma$ 必須在 $0<\gamma<2$：完整 Preconditioner 的每個 pole 都是 $1-\gamma$，$\gamma\le0$ 時 $p\ge1$（不修正或修正方向相反），$\gamma\ge2$ 時 $p\le-1$（每個 block 都修正過頭而且越跳越遠）。`
const MSG_N = String.raw`$N$ 必須是 $\ge1$ 的整數：它是 GMAC 每次更新前累加的 comparator sample 數。`

const kqStep = (sigmaV: number, Kq: number): HandCalcStep => ({
  tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(C_KQ)}}{${tx(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`,
  why: String.raw`1-bit comparator 的小訊號增益（第 5 章）。$\sqrt{2/\pi}$：計算機按 $2\div\pi$ 再開根號，得 $${texNum(C_KQ)}$，之後當常數用；剩下一次除法。`,
})

/** k₉₅ 的一步（ln 一次、除一次、無條件進位）；k 由模型的 stepsToDecay 給定 */
function k95Tex(sym: string, p: number, k: number): string {
  if (p === 0) return String.raw`${sym}=1\qquad(p=0\ \Rightarrow\ \text{一個 block 就到位，deadbeat})`
  const a = Math.abs(p)
  return String.raw`${sym}=\left\lceil\frac{\ln 0.05}{\ln|p|}\right\rceil=\left\lceil\frac{\ln 0.05}{\ln ${tx(a, 7)}}\right\rceil=\left\lceil\frac{${texNum(LN_DECAY)}}{${texNum(Math.log(a))}}\right\rceil=\lceil ${texNum(stepsToDecayReal(p))}\rceil=${k}`
}

/** 2×2 相關矩陣 R(ρ)、K_q = 1 的 scalar LMS 分析（HC-10.2 用） */
function scalarLoop(rho: number, muKq: number) {
  const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV: SIGMA_KQ1, N: 1 })
  const an = analyzeRule(plant, rule({ rule: 'scalar', muKq }), plant.Jn)
  return { plant, an }
}

/** HC-10.6 的預設讀數：±1 碼、R_jj = 1、σ_v = 100 fs、Δ = 30 fs 時 GMAC 的精確平均（signGmacMean），取 4 位有效數字當作「讀數」 */
const FD_DEMO_READING = (() => {
  const plant = buildPlant({ mode: 'R', R: [[1]], sigmaV: 100, N: 4096, dist: 'pm1' })
  return Number(signGmacMean(plant, [30])[0].toPrecision(4)) // δ = +Δ ⇔ w − Δ ⇒ G > 0
})()

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────── HC-10.1：耦合（F-10.1）＋一次 scalar 更新 ─────────────────────────
  {
    id: 'HC-10.1',
    title: '耦合：$w_1$ 明明是對的，$G_1$ 卻不是 0（再更新一次看看）',
    page: PAGE,
    formulaId: 'F-10.1',
    formulaTex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad G_i\approx K_q\big(R_{i1}\,\delta_1+R_{i2}\,\delta_2\big),\qquad \delta_i'=\delta_i-\mu\,G_i\qquad(\boldsymbol\delta=\mathbf a-\mathbf w)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho`, label: 'regressor 相關係數（$R_{12}=R_{21}=\\rho$，$R_{11}=R_{22}=1$）', default: 0.8, min: -2, max: 2, practice: { choices: [0, 0.2, 0.5, 0.8, 0.9] } },
      { key: 'd1', symbol: String.raw`\delta_1`, label: '參數 1 的誤差 $a_1-w_1$', unit: String.raw`\mathrm{fs}`, default: 0, min: -1000, max: 1000, practice: { choices: [0, 0, 2, 5, -5] } },
      { key: 'd2', symbol: String.raw`\delta_2`, label: '參數 2 的誤差 $a_2-w_2$', unit: String.raw`\mathrm{fs}`, default: 10, min: -1000, max: 1000, practice: { choices: [5, 10, 20, -10] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [50, 100, 200, 400] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'scalar LMS 步長（$\\mathbf M=\\mu\\mathbf I$）', unit: String.raw`\mathrm{fs}`, default: 10, min: 0, max: 1000, practice: { choices: [5, 10, 20, 50] } },
    ],
    validate: ({ rho, sigmaV }) => {
      if (Math.abs(rho) > 1) return MSG_RHO_GT1
      if (!(sigmaV > 0)) return MSG_SIGMA
      return null
    },
    solve: ({ rho, d1, d2, sigmaV, mu }) => {
      const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV, N: 1 })
      const Kq = plant.Kq
      const delta = [d1, d2]
      const Gm = gmacLinear(plant, delta, noNoise) // 線性 GMAC 的平均 K_q R δ（雜訊 = 0）
      const c12 = rho * d2 // R₁₂δ₂：從參數 2 漏進 GMAC₁ 的部分
      const c21 = rho * d1 // R₂₁δ₁：從參數 1 漏進 GMAC₂ 的部分
      // 兩項剛好抵銷時（例如 −4 + 0.8×5），double 會留下 1e−16 的殘渣；手算得到的是 0
      const s1 = snap(d1 + c12, Math.max(Math.abs(d1), Math.abs(c12)))
      const s2 = snap(c21 + d2, Math.max(Math.abs(c21), Math.abs(d2)))
      const G = [s1 === 0 ? 0 : Gm[0], s2 === 0 ? 0 : Gm[1]]
      const muG1 = mu * G[0]
      const muG2 = mu * G[1]
      const upd = blockUpdate(delta, mScalar(plant.Jn, rule({ rule: 'scalar', muKq: mu * Kq })), G, Kq) // δ ← δ − μG
      const next = [snap(upd[0], Math.max(Math.abs(d1), Math.abs(muG1))), snap(upd[1], Math.max(Math.abs(d2), Math.abs(muG2)))]
      const exact = signGmacMean(plant, delta) // 不用小訊號近似的精確平均（F-10.13）
      const q = (d1 * s1 + d2 * s2) / (sigmaV * sigmaV) // δᵀRδ/σ_v²
      const notes: string[] = []
      if (d1 === 0 && s1 !== 0) {
        notes.push(String.raw`$\delta_1=0$（$w_1$ 完全正確），但 $G_1=K_qR_{12}\delta_2=${texNum(G[0])}\ne0$：$\delta_2$ 經由 $R_{12}$ 漏進 $\mathrm{GMAC}_1$，一次更新就把 $w_1$ 推離了 $${texNum(Math.abs(next[0] - d1))}\ \mathrm{fs}$。這就是 cross-coupling。`)
      } else if (rho === 0) {
        notes.push(String.raw`$\rho=0$：$\mathbf R=\mathbf I$，沒有耦合，$G_i=K_q\delta_i$——每個 GMAC 只看到自己的誤差。`)
      } else {
        notes.push(String.raw`$G_1$ 裡來自別人的部分是 $K_qR_{12}\delta_2=${texNum(Kq * c12)}$，來自自己的部分是 $K_qR_{11}\delta_1=${texNum(Kq * d1)}$。`)
      }
      if (q > 0) {
        notes.push(
          String.raw`線性化檢查：$\boldsymbol\delta^T\mathbf R\boldsymbol\delta/\sigma_v^2=${texNum(q, 3)}$。Gaussian regressor 的精確平均（F-10.13）是 $G_1=${texNum(s1 === 0 ? 0 : exact[0])}$、$G_2=${texNum(s2 === 0 ? 0 : exact[1])}$，等於線性值乘上 $1/\sqrt{1+${texNum(q, 3)}}=${texNum(1 / Math.sqrt(1 + q), 4)}$` +
            (q > 0.05 ? '——誤差已經不算小，真正的 1-bit comparator 增益被壓縮，$G\\approx K_q\\mathbf R\\boldsymbol\\delta$ 會高估。' : '，小訊號近似很準。'),
        )
      }
      if (Math.max(Math.abs(G[0]), Math.abs(G[1])) > 1) {
        notes.push(
          String.raw`注意：線性值 $|G|>1$ 在真實硬體上不可能出現——average 模式的 $G=\frac1N\sum q\,x$ 是 $\pm1$ 乘上 unit-RMS code 的平均，$|G|\le E|x|\le1$。這組數字只能當成「$K_q$ 正規化的線性平均遞迴」（§10.1 的手算表）來看；要代表真實的 1-bit GMAC，請讓 $|\delta|\ll\sigma_v$。`,
        )
      }
      return {
        steps: [
          kqStep(sigmaV, Kq),
          {
            tex: String.raw`s_1=R_{11}\,\delta_1+R_{12}\,\delta_2=1\times${txP(d1)}+${txP(rho)}\times${txP(d2)}=${tx(d1)}+${txP(c12)}=${tx(s1)}\ \mathrm{fs}`,
            why: String.raw`$\mathbf R\boldsymbol\delta$ 的第 1 列：自己的誤差 $R_{11}\delta_1$，加上從參數 2 漏進來的 $R_{12}\delta_2$（先乘、再加）。`,
          },
          {
            tex: String.raw`G_1\approx K_q\,s_1=${texNum(Kq)}\times${txP(s1)}=${texNum(G[0])}`,
            why: String.raw`乘上 comparator 增益，得到 $\mathrm{GMAC}_1$ 的平均輸出（average 模式，無因次）。`,
          },
          {
            tex: String.raw`s_2=R_{21}\,\delta_1+R_{22}\,\delta_2=${txP(rho)}\times${txP(d1)}+1\times${txP(d2)}=${tx(c21)}+${txP(d2)}=${tx(s2)}\ \mathrm{fs}`,
            why: String.raw`$\mathbf R\boldsymbol\delta$ 的第 2 列（$R_{21}=R_{12}=\rho$，$\mathbf R$ 對稱）。`,
          },
          {
            tex: String.raw`G_2\approx K_q\,s_2=${texNum(Kq)}\times${txP(s2)}=${texNum(G[1])}`,
            why: String.raw`$\mathrm{GMAC}_2$ 的平均輸出。`,
          },
          {
            tex: String.raw`\delta_1'=\delta_1-\mu\,G_1=${tx(d1)}-${tx(mu)}\times${texNumP(G[0])}=${tx(d1)}-${texNumP(muG1)}=${tx(next[0])}\ \mathrm{fs}`,
            why: String.raw`更新一次：$w_1\leftarrow w_1+\mu G_1$，而 $\delta_1=a_1-w_1$，所以 $\delta_1$ 減少 $\mu G_1$（先乘出 $\mu G_1$，再相減）。`,
          },
          {
            tex: String.raw`\delta_2'=\delta_2-\mu\,G_2=${tx(d2)}-${tx(mu)}\times${texNumP(G[1])}=${tx(d2)}-${texNumP(muG2)}=${tx(next[1])}\ \mathrm{fs}`,
            why: String.raw`同一個步長 $\mu$ 也更新 $w_2$。`,
          },
        ],
        results: [
          { symbol: 'G_1', label: '$\\mathrm{GMAC}_1$ 的平均輸出（無因次）', value: G[0] },
          { symbol: 'G_2', label: '$\\mathrm{GMAC}_2$ 的平均輸出（無因次）', value: G[1] },
          { symbol: String.raw`\delta_1'`, label: '更新一次後參數 1 的誤差', value: next[0], unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\delta_2'`, label: '更新一次後參數 2 的誤差', value: next[1], unit: String.raw`\mathrm{fs}` },
        ],
        notes,
      }
    },
    tips: [
      String.raw`$\sqrt{2/\pi}\approx0.79788$。$\sigma_v=100\ \mathrm{fs}$ 時 $K_q=0.0079788\ \mathrm{fs}^{-1}$（第 5 章的數字）。`,
      String.raw`畫面上寫不完的中間值（商、$\sqrt{\ }$、$\ln$）四捨五入到 5 位有效數字。拿這些數字接著按計算機，最後一位可能和畫面差 1——那是四捨五入，不是算錯；想完全對上就在計算機裡保留全部位數。「自己算算看」的容許誤差是 1%。`,
      String.raw`單位檢查：$\delta$ 是 fs、$K_q$ 是 $\mathrm{fs}^{-1}$，所以 $G$ 無因次；$\mu$ 是 fs，$\mu G$ 才會是 fs（勘誤 E05／E08）。`,
      String.raw`想重現 §10.1 的手算表：把 $\sigma_v$ 設成 $0.79788\ \mathrm{fs}$（$K_q=1$）、$\mu=0.5\ \mathrm{fs}$，得到 $(\delta_1',\delta_2')\approx(-4,\ 5)$；再把這組結果當成新的 $\delta_1,\delta_2$ 代入一次，得到 $(-4,\ 4.1)$。（這是線性模型的平均遞迴；$K_q$ 正規化成 1 只是換單位，題目下方的「線性化檢查」會提醒你真正的 comparator 在這麼大的誤差下已經被壓縮。）`,
    ],
  },

  // ───────────────────────── HC-10.2：scalar LMS 的 poles 與 k₉₅（F-10.3 / F-10.5 / F-10.12） ─────────────────────────
  {
    id: 'HC-10.2',
    title: '慢模式：一般 LMS 要幾個 block？（598 的由來）',
    page: PAGE,
    formulaId: 'F-10.3',
    formulaTex: String.raw`\lambda_{\max,\min}=1\pm|\rho|,\qquad p_i=1-\mu K_q\lambda_i,\quad 0<\mu K_q<\frac{2}{\lambda_{\max}},\qquad k_{95}=\left\lceil\frac{\ln 0.05}{\ln|p|_{\max}}\right\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho`, label: 'regressor 相關係數（$R_{12}=R_{21}=\\rho$，對角為 1）', default: 0.99, min: -2, max: 2, practice: { choices: [0.5, 0.8, 0.9, 0.95, 0.99] } },
      { key: 'muKq', symbol: String.raw`\mu K_q`, label: '無因次 loop gain（$K_q$ 正規化為 1 時就是 $\\mu$）', default: 0.5, min: -1, max: 4, practice: { choices: [0.1, 0.2, 0.25, 0.5, 1] } },
    ],
    validate: ({ rho, muKq }) => {
      if (Math.abs(rho) > 1) return MSG_RHO_GT1
      if (Math.abs(rho) === 1) return MSG_RHO_EQ1
      if (!(muKq > 0)) return String.raw`$\mu K_q$ 必須 $>0$：$\mu K_q=0$ 等於不更新（所有 pole $=1$），$\mu K_q<0$ 時 $p_i=1-\mu K_q\lambda_i>1$，更新方向相反而發散。`
      const lmax = 1 + Math.abs(rho)
      if (muKq >= 2 / lmax) {
        return String.raw`$\mu K_q=${texNum(muKq)}\ge2/\lambda_{\max}=${texNum(2 / lmax)}$：快模式的 pole $1-\mu K_q\lambda_{\max}=${texNum(1 - muKq * lmax)}\le-1$，每個 block 都修正過頭而且越跳越遠（發散），$k_{95}$ 沒有定義。請把 $\mu K_q$ 降到 $${texNum(2 / lmax)}$ 以下。`
      }
      const { an } = scalarLoop(rho, muKq)
      if (!an.ok || !an.stable || an.blocks95 === null) {
        return String.raw`最慢的 pole 與 1 的差距不到 $10^{-9}$：$\lambda_{\min}=1-|\rho|$ 太接近 0，實務上等同不可辨識（誤差幾乎凍結），$k_{95}$ 沒有意義。請減小 $|\rho|$ 或加大 $\mu K_q$。`
      }
      return null
    },
    solve: ({ rho, muKq }) => {
      const { plant, an } = scalarLoop(rho, muKq)
      const [lmax, lmin] = plant.modeValues // R 的 eigenvalues（由大到小）
      const [pFast, pSlow] = an.closedPoles as number[] // 1 − μK_q λ_i
      const pDom = an.spectralRadius
      const k95 = an.blocks95 as number
      const kReal = stepsToDecayReal(pDom)
      const trR = trace(plant.Rx)
      const muTilde = muKq * trR
      const nlms = analyzeRule(plant, rule({ rule: 'nlms', gamma: muTilde }), plant.Jn)
      const x = 1 - pDom
      const fastDominates = Math.abs(pFast) > Math.abs(pSlow) + 1e-12
      return {
        steps: [
          {
            tex: String.raw`\lambda_{\max}=1+|\rho|=1+${tx(Math.abs(rho))}=${tx(lmax)},\qquad\lambda_{\min}=1-|\rho|=1-${tx(Math.abs(rho))}=${tx(lmin)}`,
            why: String.raw`$2\times2$ 相關矩陣的 eigenvalue：$\det(\mathbf R-\lambda\mathbf I)=(1-\lambda)^2-\rho^2=0\Rightarrow\lambda=1\pm\rho$。大的那個對應「看得清楚」的方向，小的對應「看不清楚」的方向。`,
          },
          {
            tex: String.raw`\frac{2}{\lambda_{\max}}=\frac{2}{${tx(lmax)}}=${texNum(2 / lmax)}`,
            why: String.raw`穩定上限：$\mu K_q$ 必須小於它，快模式才不會 overshoot 到 $-1$ 以下。現在 $\mu K_q=${tx(muKq)}$，合格。`,
          },
          {
            tex: String.raw`p_{\text{fast}}=1-\mu K_q\,\lambda_{\max}=1-${tx(muKq)}\times${tx(lmax)}=1-${tx(muKq * lmax, 7)}=${tx(pFast, 7)}`,
            why: String.raw`快模式（沿 $\lambda_{\max}$ 的 eigenvector）每個 block 乘上的倍數：先乘、再用 1 去減。`,
          },
          {
            tex: String.raw`p_{\text{slow}}=1-\mu K_q\,\lambda_{\min}=1-${tx(muKq)}\times${tx(lmin)}=1-${tx(muKq * lmin, 7)}=${tx(pSlow, 7)}`,
            why: String.raw`慢模式：$\lambda_{\min}$ 越小，pole 越貼近 1。`,
          },
          {
            tex: String.raw`|p|_{\max}=\max\big(|${tx(pFast, 7)}|,\ |${tx(pSlow, 7)}|\big)=${tx(pDom, 7)}`,
            why: fastDominates
              ? String.raw`這組數字裡絕對值最大的是快模式（它是負的、來回震盪）：最慢收斂的不一定是 $\lambda_{\min}$ 那個模式。`
              : String.raw`絕對值最大的 pole 決定整體收斂時間——這裡是慢模式。`,
          },
          pDom === 0
            ? { tex: String.raw`|p|_{\max}=0\ \Rightarrow\ \boldsymbol\delta_1=\mathbf 0`, why: '兩個 pole 都是 0：一個 block 就把平均誤差清掉（deadbeat），不需要取對數。' }
            : {
                tex: String.raw`\ln|p|_{\max}=\ln ${tx(pDom, 7)}=${texNum(Math.log(pDom))},\qquad \ln 0.05=${texNum(LN_DECAY)}`,
                why:
                  String.raw`要 $|p|^k\le0.05$ 就兩邊取 $\ln$。計算機按 $\ln$ 即可。` +
                  (x <= 0.1 ? String.raw`沒有計算機時：$|p|$ 接近 1，可用 $\ln(1-x)\approx-x-x^2/2$（$x=1-|p|=${texNum(x)}\le0.1$ 時相對誤差 $<0.4\%$）得 $${texNum(-x - (x * x) / 2)}$。` : ''),
              },
          pDom === 0
            ? { tex: String.raw`k_{95}=1`, why: '至少要 1 個 block。' }
            : {
                tex: String.raw`\frac{\ln 0.05}{\ln|p|_{\max}}=\frac{${texNum(LN_DECAY)}}{${texNum(Math.log(pDom))}}=${texNum(kReal)}\quad\Rightarrow\quad k_{95}=\lceil ${texNum(kReal)}\rceil=${k95}`,
                why: String.raw`$\ln|p|<0$，除過去不等號反向：$k\ge\ln0.05/\ln|p|$；block 數是整數，所以無條件進位。`,
              },
          {
            tex: String.raw`\tilde\mu=\mu K_q\cdot\operatorname{tr}\mathbf R=${tx(muKq)}\times${tx(trR)}=${tx(muTilde)}`,
            why: String.raw`對照 NLMS（F-10.12）：$p_i=1-\tilde\mu\lambda_i/\operatorname{tr}\mathbf R$。取這個 $\tilde\mu$ 就得到和上面一模一樣的 poles——NLMS 只是把步長除以總能量 $\operatorname{tr}\mathbf R=\lambda_{\max}+\lambda_{\min}$，不會修正 eigenvalue spread。`,
          },
        ],
        results: [
          { symbol: String.raw`p_{\text{slow}}`, label: '慢模式的 pole', value: pSlow, digits: 7, tolerance: poleTol(pSlow) },
          { symbol: String.raw`p_{\text{fast}}`, label: '快模式的 pole', value: pFast, tolerance: poleTol(pFast) },
          { symbol: 'k_{95}', label: '誤差降到 5% 所需的 block 數', value: k95, unit: String.raw`\text{blocks}`, digits: 7, tolerance: BLOCK_TOL },
          { symbol: String.raw`\tilde\mu`, label: '等效的 NLMS 步長', value: muTilde },
        ],
        notes: [
          String.raw`eigenvalue spread $\kappa=\lambda_{\max}/\lambda_{\min}=${tx(lmax / lmin)}$。在穩定範圍 $0<\mu K_q<2/\lambda_{\max}$ 內，慢模式的 pole 一定大於 $1-2\lambda_{\min}/\lambda_{\max}=1-2/\kappa=${tx(1 - (2 * lmin) / lmax, 6)}$：$\kappa$ 越大它越貼近 1，調 $\mu$ 也救不了。`,
          String.raw`NLMS 用 $\tilde\mu=${texNum(muTilde)}$：模型算出 $k_{95}=${nlms.blocks95 ?? '\\infty'}$，和 scalar LMS 的 $${k95}$ 相同。`,
          String.raw`完整反矩陣 $\mathbf M=\gamma(K_q\mathbf R)^{-1}$ 的 pole 全部是 $1-\gamma$：$\gamma=0.5$ 只要 $${stepsToDecay(0.5)}$ 個 block（HC-10.3）。`,
        ],
      }
    },
    tips: [
      String.raw`$\ln0.05=-2.9957$ 可以背下來（$=-\ln20$）。`,
      String.raw`$|p|$ 很接近 1 時，$k_{95}\approx2.9957/(1-|p|)$：$1-|p|=0.005\Rightarrow k_{95}\approx599$（精確值 598）。`,
      String.raw`範例數字（$\rho=0.99$、$\mu K_q=0.5$）的答案是 $p_{\text{slow}}=0.995$、$k_{95}=598$（測試 T11）。這裡 $K_q$ 已正規化為 1；換成實體單位時 $\mu$ 是 fs、$K_q$ 是 $\mathrm{fs}^{-1}$，要用乘積 $\mu K_q$（勘誤 E05）。`,
    ],
  },

  // ───────────────────────── HC-10.3：2×2 反矩陣與 M_n = γR⁻¹（F-10.4） ─────────────────────────
  {
    id: 'HC-10.3',
    title: '$2\\times2$ 反矩陣與完整 Preconditioner $\\mathbf M_n=\\gamma\\mathbf R^{-1}$',
    page: PAGE,
    formulaId: 'F-10.4',
    formulaTex: String.raw`\mathbf R^{-1}=\frac{1}{R_{11}R_{22}-R_{12}^2}\begin{bmatrix}R_{22}&-R_{12}\\-R_{12}&R_{11}\end{bmatrix},\qquad \mathbf M_n=K_q\mathbf M=\gamma\,\mathbf R^{-1}\ \Rightarrow\ \mathbf M_n\mathbf R=\gamma\mathbf I,\ \ p_i=1-\gamma`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'r11', symbol: 'R_{11}', label: 'regressor 1 的功率 $E[u_1^2]$', default: 1, min: -10, max: 10, practice: { choices: [1, 1, 2] } },
      { key: 'r12', symbol: 'R_{12}', label: '互相關 $E[u_1u_2]$（$=R_{21}$）', default: 0.99, min: -10, max: 10, practice: { choices: [0.5, 0.6, 0.8, 0.9, -0.6] } },
      { key: 'r22', symbol: 'R_{22}', label: 'regressor 2 的功率 $E[u_2^2]$', default: 1, min: -10, max: 10, practice: { choices: [1, 1, 2] } },
      { key: 'gamma', symbol: String.raw`\gamma`, label: '目標 loop gain', default: 0.5, min: -1, max: 3, practice: { choices: [0.25, 0.5, 1] } },
    ],
    validate: ({ r11, r12, r22, gamma }) => {
      if (!(r11 > 0) || !(r22 > 0)) return String.raw`對角元素 $R_{ii}=E[u_i^2]$ 是 regressor 的功率，必須 $>0$（功率為 0 代表這個參數完全沒有被激勵，GMAC 看不到它）。`
      const d = inspectMatrix([
        [r11, r12],
        [r12, r22],
      ]).det
      const scale = r11 * r22
      if (d < -1e-12 * scale) {
        return String.raw`$\det\mathbf R=R_{11}R_{22}-R_{12}^2=${texNum(d)}<0$：$\mathbf R$ 不是半正定。自相關矩陣一定滿足 $|R_{12}|\le\sqrt{R_{11}R_{22}}=${texNum(Math.sqrt(scale))}$（Cauchy–Schwarz），這組數字在物理上不存在。`
      }
      if (d <= 1e-12 * scale) {
        return String.raw`$\det\mathbf R=0$：兩個 regressor 完全相關（$\lambda_{\min}=0$），有一個方向不可辨識，反矩陣不存在。Preconditioner 可以加速，但不能製造缺失的資訊；請改用 regularized（HC-10.5）或讓 $|R_{12}|<\sqrt{R_{11}R_{22}}$。`
      }
      if (!(gamma > 0 && gamma < 2)) return MSG_GAMMA
      return null
    },
    solve: ({ r11, r12, r22, gamma }) => {
      const R: Mat = [
        [r11, r12],
        [r12, r22],
      ]
      const ins = inspectMatrix(R) // det 與反矩陣
      const Rinv = ins.inverse as Mat
      const plant = buildPlant({ mode: 'R', R, sigmaV: SIGMA_KQ1, N: 1 })
      const an = analyzeRule(plant, rule({ rule: 'full', gamma }), plant.Jn) // M_n = mFull(Ĵ_n) = γR⁻¹、A = I − M_n R
      const Mn = an.Mn as Mat
      const A = an.A as Mat
      const mr11 = snap(1 - A[0][0]) // (M_n R)₁₁
      const mr12 = snap(-A[0][1]) // (M_n R)₁₂
      const lmin = plant.modeValues[1]
      const kq100 = kqFromSigma(100)
      /** 規格 §10.1 的例子（ρ = 0.99、γ = 0.5）：「±25」那句話說的就是這組數字 */
      const isSpecExample = r11 === 1 && r22 === 1 && Math.abs(r12) === 0.99 && gamma === 0.5
      return {
        steps: [
          {
            tex: String.raw`\det\mathbf R=R_{11}R_{22}-R_{12}^2=${tx(r11)}\times${tx(r22)}-${sq(r12)}=${tx(r11 * r22)}-${tx(r12 * r12)}=${tx(ins.det)}`,
            why: String.raw`行列式 $ad-bc$（對稱矩陣 $b=c=R_{12}$）：一次乘法、一次平方、一次減法。它越接近 0，兩個 regressor 越像，反矩陣的元素就越大。`,
          },
          {
            tex: String.raw`\mathbf R^{-1}=\frac{1}{\det\mathbf R}\begin{bmatrix}R_{22}&-R_{12}\\-R_{12}&R_{11}\end{bmatrix}=\frac{1}{${tx(ins.det)}}\begin{bmatrix}${tx(r22)}&${tx(-r12)}\\${tx(-r12)}&${tx(r11)}\end{bmatrix}=${bm(Rinv, 7)}`,
            why: String.raw`$2\times2$ 反矩陣的公式：對角線兩個元素互換、非對角變號、全部除以行列式（三次除法）。這裡留 7 位有效數字：下面的驗算要把兩個很接近的數相減，位數不夠會對不起來。`,
          },
          {
            tex: String.raw`\mathbf M_n=\gamma\,\mathbf R^{-1}=${tx(gamma)}\times${bm(Rinv, 7)}=${bm(Mn, 7)}`,
            why: String.raw`每個元素乘上 $\gamma$。這是正規化（無因次）的更新矩陣 $\mathbf M_n=K_q\mathbf M$；實體 $\mathbf M=\mathbf M_n/K_q$（單位 fs）。`,
          },
          {
            tex: String.raw`\begin{aligned}(\mathbf M_n\mathbf R)_{11}&=M_{n,11}R_{11}+M_{n,12}R_{21}\\&=${tx(Mn[0][0], 7)}\times${txP(r11)}+${txP(Mn[0][1], 7)}\times${txP(r12)}=${tx(Mn[0][0] * r11, 7)}+${txP(Mn[0][1] * r12, 7)}=${tx(mr11)}\end{aligned}`,
            why: String.raw`驗算第 1 列乘第 1 行（兩次乘法、一次加法），應該等於 $\gamma$。$\det\mathbf R$ 很小時這是兩個很接近的大數相減：上一步只留 5 位的話，這裡會差在第 3 位小數——這種敏感度正是近奇異矩陣的特徵。`,
          },
          {
            tex: String.raw`\begin{aligned}(\mathbf M_n\mathbf R)_{12}&=M_{n,11}R_{12}+M_{n,12}R_{22}\\&=${tx(Mn[0][0], 7)}\times${txP(r12)}+${txP(Mn[0][1], 7)}\times${txP(r22)}=${tx(Mn[0][0] * r12, 7)}+${txP(Mn[0][1] * r22, 7)}=${tx(mr12)}\end{aligned}`,
            why: String.raw`驗算第 1 列乘第 2 行，應該等於 0：$\mathbf M_n\mathbf R=\gamma\mathbf I$，耦合被消掉了。`,
          },
          {
            tex: String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I-\mathbf M_n\mathbf R=(1-\gamma)\,\mathbf I\ \Rightarrow\ p_1=p_2=1-\gamma=1-${tx(gamma)}=${tx(snap(A[0][0]))}`,
            why: String.raw`每個方向都是同一個 pole $1-\gamma$：沒有慢模式了。`,
          },
        ],
        results: [
          { symbol: String.raw`\det\mathbf R`, label: '行列式', value: ins.det },
          { symbol: 'M_{n,11}', label: '$\\mathbf M_n$ 的左上角', value: Mn[0][0], tolerance: M_TOL },
          { symbol: 'M_{n,12}', label: '$\\mathbf M_n$ 的非對角（$=M_{n,21}$）', value: Mn[0][1], tolerance: M_TOL },
          { symbol: 'M_{n,22}', label: '$\\mathbf M_n$ 的右下角', value: Mn[1][1], tolerance: M_TOL },
        ],
        notes: [
          String.raw`$\mathbf R^{-1}$ 的元素是 $${texNum(Rinv[0][0])}$／$${texNum(Rinv[0][1])}$，乘上 $\gamma$ 之後才是 $\mathbf M_n$ 的 $${texNum(Mn[0][0])}$／$${texNum(Mn[0][1])}$` +
            (isSpecExample ? String.raw`（規格寫的「$\pm25$」指的是 $0.5\mathbf R^{-1}$，不是 $\mathbf R^{-1}$；勘誤 E21）。` : String.raw`——不要把兩者混為一談（規格 §10.1 的「$\pm25$」就是 $0.5\mathbf R^{-1}$ 而不是 $\mathbf R^{-1}$；勘誤 E21）。`),
          String.raw`方向增益才是重點：$\mathbf M_n$ 沿最弱方向的 eigenvalue 是 $\gamma/\lambda_{\min}=${tx(gamma)}/${texNum(lmin)}=${texNum(gamma / lmin)}$——GMAC noise 在這個方向也被放大這麼多倍（HC-10.4）。`,
          String.raw`換成實體單位（例如 $\sigma_v=100\ \mathrm{fs}$、$K_q=${texNum(kq100)}\ \mathrm{fs}^{-1}$）：$M_{11}=M_{n,11}/K_q=${texNum(Mn[0][0] / kq100, 4)}\ \mathrm{fs}$。忘了除以 $K_q$（寫成 $\mathbf M=\gamma\mathbf R^{-1}$）pole 會變成 $1-\gamma K_q$，慢上百倍（勘誤 E05／E08）。`,
        ],
      }
    },
    tips: [
      '口訣：「對角互換、非對角變號、除以行列式」。',
      String.raw`除以 $\det\mathbf R$ 的商通常寫不完：計算機上請保留全部位數（或至少 7 位）再往下乘，最後才四捨五入。$\det\mathbf R$ 越小，這件事越重要。`,
      String.raw`對稱的 $\mathbf R$ 其反矩陣也對稱，所以只要算三個數（$M_{n,11}$、$M_{n,12}$、$M_{n,22}$）。`,
      String.raw`範例數字（$\rho=0.99$、$\gamma=0.5$）的答案是 $\mathbf M_n\approx[[25.13,-24.87],[-24.87,25.13]]$（測試 T11）。`,
    ],
  },

  // ───────────────────────── HC-10.4：完整 Preconditioning 的穩態變異（F-10.6，勘誤 E37） ─────────────────────────
  {
    id: 'HC-10.4',
    title: '雜訊代價：模式變異 $\\operatorname{Var}(\\xi_i)$ 與每個參數的 $\\operatorname{Var}(\\delta_j)$',
    page: PAGE,
    formulaId: 'F-10.6',
    formulaTex: String.raw`c=\frac{\gamma}{K_q^2\,N\,(2-\gamma)},\qquad \operatorname{Var}(\xi_i)=\frac{c}{\lambda_i},\qquad \frac{\sigma_{\text{weak}}}{\sigma_{\text{strong}}}=\sqrt{\frac{\lambda_{\max}}{\lambda_{\min}}},\qquad \operatorname{Var}(\delta_j)=c\,[\mathbf R^{-1}]_{jj}=\frac{c}{1-\rho^2}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho`, label: 'regressor 相關係數', default: 0.99, min: -2, max: 2, practice: { choices: [0.5, 0.8, 0.9, 0.99] } },
      { key: 'gamma', symbol: String.raw`\gamma`, label: 'preconditioned loop gain', default: 0.5, min: -1, max: 3, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: String.raw`\text{samples}`, default: 4096, min: 0, max: 1048576, integer: true, practice: { choices: [256, 1024, 4096, 16384] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ rho, gamma, N, sigmaV }) => {
      if (Math.abs(rho) > 1) return MSG_RHO_GT1
      if (Math.abs(rho) === 1) return MSG_RHO_EQ1
      if (!(gamma > 0 && gamma < 2)) return MSG_GAMMA
      if (!(Number.isInteger(N) && N >= 1)) return MSG_N
      if (!(sigmaV > 0)) return MSG_SIGMA
      return null
    },
    solve: ({ rho, gamma, N, sigmaV }) => {
      const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV, N })
      const Kq = plant.Kq
      const [lmax, lmin] = plant.modeValues
      const c = preconditionedModeVar(gamma, Kq, N, 1) // λ = 1 ⇒ c
      const vSlow = preconditionedModeVar(gamma, Kq, N, lmin)
      const vFast = preconditionedModeVar(gamma, Kq, N, lmax)
      const an = analyzeRule(plant, rule({ rule: 'full', gamma }), plant.Jn) // Lyapunov 數值解
      const perParam = (an.perParamVar as number[])[0]
      const rinv11 = (inspectMatrix(plant.Ru).inverse as Mat)[0][0]
      const ratio = Math.sqrt(vSlow / vFast)
      const kq2N = Kq * Kq * N
      const validity = an.validityIndex ?? NaN
      return {
        steps: [
          kqStep(sigmaV, Kq),
          {
            tex: String.raw`K_q^2N=${sq(Kq)}\times${texInt(N)}=${par(texNum(Kq * Kq))}\times${texInt(N)}=${texNum(kq2N)}\ \mathrm{fs}^{-2}`,
            why: String.raw`平方一次、乘一次。也可以先記 $K_q^2=\dfrac{2}{\pi\sigma_v^2}=\dfrac{0.63662}{\sigma_v^2}$。`,
          },
          {
            tex: String.raw`c=\frac{\gamma}{K_q^2N\,(2-\gamma)}=\frac{${tx(gamma)}}{${texNum(kq2N)}\times(2-${tx(gamma)})}=\frac{${tx(gamma)}}{${texNum(kq2N)}\times${tx(2 - gamma)}}=\frac{${tx(gamma)}}{${texNum(kq2N * (2 - gamma))}}=${texNum(c)}\ \mathrm{fs}^2`,
            why: String.raw`所有模式共用的係數：先算 $2-\gamma$，乘上 $K_q^2N$，再用 $\gamma$ 去除。$N$ 加倍 $\Rightarrow$ $c$ 減半（多平均一倍的 sample）；$\gamma\to2$ 時分母 $\to0$（迴路快要不穩定，雜訊無限放大）。`,
          },
          {
            tex: String.raw`\lambda_{\max}=1+|\rho|=1+${tx(Math.abs(rho))}=${tx(lmax)},\qquad\lambda_{\min}=1-|\rho|=1-${tx(Math.abs(rho))}=${tx(lmin)}`,
            why: String.raw`$\mathbf R$ 的兩個 eigenvalue（HC-10.2 的第一步）。`,
          },
          {
            tex: String.raw`\operatorname{Var}(\xi_{\text{slow}})=\frac{c}{\lambda_{\min}}=\frac{${texNum(c)}}{${tx(lmin)}}=${texNum(vSlow)}\ \mathrm{fs}^2`,
            why: String.raw`弱（慢）模式：反矩陣把這個方向的增益放大 $1/\lambda_{\min}$，雜訊也跟著放大。`,
          },
          {
            tex: String.raw`\operatorname{Var}(\xi_{\text{fast}})=\frac{c}{\lambda_{\max}}=\frac{${texNum(c)}}{${tx(lmax)}}=${texNum(vFast)}\ \mathrm{fs}^2`,
            why: '強（快）模式：幾乎沒有被放大。',
          },
          {
            tex: String.raw`\frac{\sigma_{\text{weak}}}{\sigma_{\text{strong}}}=\sqrt{\frac{\lambda_{\max}}{\lambda_{\min}}}=\sqrt{\frac{${tx(lmax)}}{${tx(lmin)}}}=\sqrt{${tx(lmax / lmin)}}=${texNum(ratio)}`,
            why: String.raw`兩個模式的 RMS 比：$c$ 約掉，只剩 eigenvalue 的比值（$=\sqrt\kappa$）。先除、再按計算機的 $\sqrt{x}$ 鍵。`,
          },
          {
            tex: String.raw`[\mathbf R^{-1}]_{jj}=\frac{1}{1-\rho^2}=\frac{1}{1-${sq(rho)}}=\frac{1}{1-${tx(rho * rho)}}=\frac{1}{${tx(1 - rho * rho)}}=${texNum(rinv11)}`,
            why: String.raw`反矩陣的對角元素（HC-10.3 的公式，$R_{11}=R_{22}=1$）：平方、用 1 去減、取倒數。`,
          },
          {
            tex: String.raw`\operatorname{Var}(\delta_j)=c\,[\mathbf R^{-1}]_{jj}=${texNum(c)}\times${texNum(rinv11)}=${texNum(perParam)}\ \mathrm{fs}^2`,
            why: String.raw`每個「參數」的變異（$\operatorname{Cov}(\boldsymbol\delta)=c\,\mathbf R^{-1}$ 的對角）。它等於兩個模式變異的平均 $\tfrac12(${texNum(vSlow)}+${texNum(vFast)})$，不等於任何一個模式（勘誤 E37）。`,
          },
          {
            tex: String.raw`\mathrm{RMS}(\delta_j)=\sqrt{\operatorname{Var}(\delta_j)}=\sqrt{${texNum(perParam)}}=${texNum(Math.sqrt(perParam))}\ \mathrm{fs}`,
            why: String.raw`開根號（$\sqrt{x}$ 鍵）得到每個校正係數的穩態 RMS 抖動。`,
          },
        ],
        results: [
          { symbol: String.raw`\operatorname{Var}(\xi_{\text{slow}})`, label: '弱（慢）模式的變異', value: vSlow, unit: String.raw`\mathrm{fs}^2` },
          { symbol: String.raw`\operatorname{Var}(\xi_{\text{fast}})`, label: '強（快）模式的變異', value: vFast, unit: String.raw`\mathrm{fs}^2` },
          { symbol: String.raw`\sigma_{\text{weak}}/\sigma_{\text{strong}}`, label: '兩個模式的 RMS 比', value: ratio },
          { symbol: String.raw`\mathrm{RMS}(\delta_j)`, label: '每個參數的穩態 RMS', value: Math.sqrt(perParam), unit: String.raw`\mathrm{fs}` },
        ],
        notes: [
          String.raw`$\operatorname{Var}(\xi_{\text{slow}})$ 是第 2 個 eigen-mode（$\boldsymbol\xi=\mathbf V^T\boldsymbol\delta$）的變異，$\operatorname{Var}(\delta_j)$ 才是第 $j$ 個參數的變異——兩者差 $${texNum(vSlow / perParam, 3)}$ 倍（勘誤 E37）。`,
          String.raw`近平衡檢查：$E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]/\sigma_v^2=\dfrac{P\gamma}{N(2-\gamma)}\cdot\dfrac{\pi}{2}=${texNum(validity, 3)}$（$P=2$）` +
            (validity > 0.05 ? '，不夠小（$>0.05$）：殘差已和 comparator noise 同量級，真正的 1-bit 迴路會偏離這個公式；請加大 $N$ 或減小 $\\gamma$。' : '，遠小於 1，線性化（$K_q$）可信。'),
        ],
      }
    },
    tips: [
      String.raw`$K_q^2=2/(\pi\sigma_v^2)=0.63662/\sigma_v^2$：$\sigma_v=100\ \mathrm{fs}$ 時是 $6.3662\times10^{-5}\ \mathrm{fs}^{-2}$。`,
      String.raw`範例數字（$\rho=0.99$、$\gamma=0.5$、$N=4096$、$\sigma_v=100\ \mathrm{fs}$）：$c=1.2783$、模式 $127.83$／$0.6424\ \mathrm{fs}^2$、$\sqrt{199}=14.107$、每個參數 $64.24\ \mathrm{fs}^2$（RMS $8.015\ \mathrm{fs}$）。`,
      String.raw`只想估數量級：$\mathrm{RMS}(\xi_{\text{slow}})\approx\dfrac{\sigma_v}{0.798}\sqrt{\dfrac{\gamma}{N\lambda_{\min}(2-\gamma)}}$。`,
    ],
  },

  // ───────────────────────── HC-10.5：Regularized pole，R 形式 vs J 形式（F-10.8 / F-10.10，勘誤 E22） ─────────────────────────
  {
    id: 'HC-10.5',
    title: 'Regularized pole：同一個 $\\lambda_{\\mathrm{reg}}$ 放進 R 形式與 J 形式',
    page: PAGE,
    formulaId: 'F-10.8',
    formulaTex: String.raw`p_i^{(R)}=1-\gamma\,\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}},\quad m_i=\frac{\gamma}{\lambda_i+\lambda_{\mathrm{reg}}};\qquad p_i^{(J)}=1-\gamma\,\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}\quad(\sigma_i=K_q\lambda_i,\ K_q=1)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'lam', symbol: String.raw`\lambda_i`, label: '這個模式的 eigenvalue（$K_q$ 正規化為 1 時 $\\sigma_i=\\lambda_i$）', default: 0.01, min: -1, max: 10, practice: { choices: [0.01, 0.05, 0.1, 0.2, 1, 1.9] } },
      { key: 'gamma', symbol: String.raw`\gamma`, label: '目標 loop gain', default: 0.5, min: -1, max: 3, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'lamReg', symbol: String.raw`\lambda_{\mathrm{reg}}`, label: 'regularization 參數（不是 eigenvalue）', default: 0.1, min: -1, max: 100, practice: { choices: [0.05, 0.1, 0.2, 1] } },
    ],
    validate: ({ lam, gamma, lamReg }) => {
      if (lam < 0) return String.raw`$\lambda_i<0$：自相關矩陣 $\mathbf R=E[\mathbf u\mathbf u^T]$ 半正定，eigenvalue 不可能是負的。（一般 Jacobian 的方向增益請用 singular value $\sigma_i\ge0$。）`
      if (lamReg < 0) return String.raw`$\lambda_{\mathrm{reg}}$ 必須 $\ge0$：負的 regularizer 會讓 $\mathbf R+\lambda_{\mathrm{reg}}\mathbf I$ 更接近奇異，甚至把分母變成 0。`
      if (lam === 0 && lamReg === 0) return String.raw`$\lambda_i=0$ 而且 $\lambda_{\mathrm{reg}}=0$：分母是 0。這個方向不可辨識，沒有 regularizer 時反矩陣不存在；請設定 $\lambda_{\mathrm{reg}}>0$。`
      if (!(gamma > 0 && gamma < 2)) return String.raw`$\gamma$ 必須在 $0<\gamma<2$：$\lambda_i\gg\lambda_{\mathrm{reg}}$ 的模式 pole 趨近 $1-\gamma$，$\gamma\ge2$ 時它 $\le-1$（發散），$\gamma\le0$ 時不收斂。`
      return null
    },
    solve: ({ lam, gamma, lamReg }) => {
      const cfgR = rule({ rule: 'regularized', regForm: 'R', gamma, lambdaReg: lamReg })
      const cfgJ = rule({ rule: 'regularized', regForm: 'J', gamma, lambdaReg: lamReg })
      const mR = ruleModeGain(cfgR, lam, 0) as number // γ/(λ + λ_reg)
      const mJ = ruleModeGain(cfgJ, lam, 0) as number // γσ/(σ² + λ_reg)
      const pR = snap(1 - mR * lam)
      const pJ = snap(1 - mJ * lam)
      const mFullGain = ruleModeGain(rule({ rule: 'full', gamma }), lam, 0) // γ/λ（λ = 0 時不存在）
      const kR = stepsToDecay(pR)
      const kJ = stepsToDecay(pJ)
      const kText = (k: number) => (Number.isFinite(k) ? String(k) : '\\infty')
      const s2 = lam * lam
      const fracR = lam / (lam + lamReg) // 這個模式拿到的 loop gain 比例（R 形式）
      const fracJ = s2 / (s2 + lamReg) // J 形式
      return {
        steps: [
          {
            tex: String.raw`\lambda_i+\lambda_{\mathrm{reg}}=${tx(lam)}+${tx(lamReg)}=${tx(lam + lamReg)}`,
            why: String.raw`R 形式：$\mathbf R+\lambda_{\mathrm{reg}}\mathbf I$ 不改變 eigenvector，只把每個 eigenvalue 加上 $\lambda_{\mathrm{reg}}$。`,
          },
          {
            tex: String.raw`\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}}=\frac{${tx(lam)}}{${tx(lam + lamReg)}}=${tx(fracR, 7)}`,
            why: String.raw`這個模式實際拿到的 loop gain 比例（1 = 像完整反矩陣，接近 0 = 幾乎不動）。多留幾位：下一步要用 1 去減，pole 很接近 1 時「離 1 多遠」才是重點。`,
          },
          {
            tex: String.raw`p_i^{(R)}=1-\gamma\,\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}}=1-${tx(gamma)}\times${txMul(fracR, 7)}=1-${tx(gamma * fracR, 7)}=${tx(pR, 7)}`,
            why: 'R 形式的 pole（F-10.8）：乘上 $\\gamma$，再用 1 去減。',
          },
          {
            tex: String.raw`\begin{aligned}m_i&=\frac{\gamma}{\lambda_i+\lambda_{\mathrm{reg}}}\\&=\frac{${tx(gamma)}}{${tx(lam + lamReg)}}=${tx(mR)}\end{aligned}`,
            why:
              String.raw`更新矩陣沿這個方向的增益：GMAC noise 也乘上它。` +
              (mFullGain === null ? String.raw`完整反矩陣在 $\lambda_i=0$ 時不存在；regularizer 讓它變成有限值。` : String.raw`完整反矩陣是 $\gamma/\lambda_i=${texNum(mFullGain)}$，regularizer 把它壓成 $${texNum(mR / mFullGain, 3)}$ 倍。`),
          },
          {
            tex: String.raw`\sigma_i^2=\lambda_i^2=${sq(lam)}=${tx(s2)}`,
            why: String.raw`J 形式的分母裡是 singular value 的「平方」。匹配模型 $\mathbf J=-K_q\mathbf R$、$K_q$ 正規化為 1 時 $\sigma_i=\lambda_i$。`,
          },
          {
            tex: String.raw`\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}=\frac{${tx(s2)}}{${tx(s2)}+${tx(lamReg)}}=\frac{${tx(s2)}}{${tx(s2 + lamReg)}}=${tx(fracJ, 7)}`,
            why: String.raw`同一個數字 $\lambda_{\mathrm{reg}}$，現在是和 $\sigma_i^2$（不是 $\lambda_i$）比大小。`,
          },
          {
            tex: String.raw`p_i^{(J)}=1-\gamma\,\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}=1-${tx(gamma)}\times${txMul(fracJ, 7)}=1-${tx(gamma * fracJ, 7)}=${tx(pJ, 7)}`,
            why: String.raw`J 形式（regularized pseudoinverse）的 pole（F-10.10；只在 $\hat{\mathbf J}=\mathbf J$ 時成立，勘誤 E24）。`,
          },
        ],
        results: [
          { symbol: 'p_i^{(R)}', label: 'R 形式的 pole', value: pR, digits: 7, tolerance: poleTol(pR) },
          { symbol: 'm_i', label: 'R 形式沿這個方向的更新增益', value: mR },
          { symbol: 'p_i^{(J)}', label: 'J 形式的 pole', value: pJ, digits: 7, tolerance: poleTol(pJ) },
        ],
        notes: [
          String.raw`換成 block 數（F-10.5，算法見 HC-10.2）：R 形式 $k_{95}=${kText(kR)}$，J 形式 $k_{95}=${kText(kJ)}$。` +
            (lamReg === 0
              ? String.raw`$\lambda_{\mathrm{reg}}=0$：兩種形式都退化成完整反矩陣，pole 都是 $1-\gamma$。`
              : lam === 0
                ? String.raw`$\lambda_i=0$：兩種形式的 pole 都是 1。`
                : Math.abs(pR - pJ) < 1e-12
                  ? String.raw`這個模式剛好 $\lambda_i=1$（$\sigma_i^2=\lambda_i$），兩種形式給出同一個 pole；其他模式（$\lambda_i\ne1$）就不會一樣——R 形式的 $\lambda_{\mathrm{reg}}$ 與 $\mathbf R$ 同尺度，J 形式的與 $J^2$ 同尺度（實體單位 $\mathrm{fs}^{-2}$；勘誤 E22）。`
                  : String.raw`同一個 $\lambda_{\mathrm{reg}}=${tx(lamReg)}$ 放進兩種形式是完全不同的設計——R 形式的 $\lambda_{\mathrm{reg}}$ 與 $\mathbf R$ 同尺度，J 形式的與 $J^2$ 同尺度（實體單位 $\mathrm{fs}^{-2}$；勘誤 E22）。`),
          ...(pR === 1 ? [String.raw`$\lambda_i=0\Rightarrow p_i=1$：這個方向永遠不收斂。Regularizer 只是讓更新矩陣存在，不能製造缺失的資訊。`] : []),
        ],
      }
    },
    tips: [
      String.raw`兩個極端：$\lambda_i\gg\lambda_{\mathrm{reg}}\Rightarrow p_i\approx1-\gamma$（像完整反矩陣）；$\lambda_i\ll\lambda_{\mathrm{reg}}\Rightarrow p_i\approx1-\gamma\lambda_i/\lambda_{\mathrm{reg}}$（像 $\mu K_q=\gamma/\lambda_{\mathrm{reg}}$ 的一般 LMS）。`,
      String.raw`範例數字（$\lambda_{\min}=0.01$、$\gamma=0.5$、$\lambda_{\mathrm{reg}}=0.1$）：R 形式 $p=1-0.5\times0.01/0.11=0.954545$（598／5／65 的 65）；J 形式 $p=0.9995005$。`,
      String.raw`記號：勘誤 E22 把兩種 regularizer 分別記成 $\varepsilon_R$、$\varepsilon_J$；本站統一寫 $\lambda_{\mathrm{reg}}$ 並標明是 R 形式或 J 形式（$\lambda_i$ 只留給 eigenvalue，$\varepsilon$ 留給 $\hat{\mathbf J}$ 的相對誤差）。`,
      String.raw`T18 的例子（§10.5.1）：$\sigma(\mathbf J)=\{3,1\}$。把 $\lambda_i$ 填 3 或 1，看 J 形式那幾步：$1-0.5\times9/9.1=0.5055$、$1-0.5\times1/1.1=0.5455$。`,
    ],
  },

  // ───────────────────────── HC-10.6：中央差分量測 Jacobian（F-10.9 / F-10.14） ─────────────────────────
  {
    id: 'HC-10.6',
    title: '中央差分：兩個 GMAC 讀數 → $\\hat J_{ij}$ → 截斷與雜訊',
    page: PAGE,
    formulaId: 'F-10.9',
    // 通式排成兩行（第二行是量測雜訊）：寫成一行在桌機的正文欄放不下
    formulaTex: String.raw`\begin{gathered}\hat J_{ij}=\frac{G_i(\mathbf w+\Delta\mathbf e_j)-G_i(\mathbf w-\Delta\mathbf e_j)}{2\Delta},\qquad r=\frac{\Delta}{\sigma_v}:\ \ \frac{\hat J_{ij}}{J_{ij}}=\frac{\operatorname{erf}(r/\sqrt2)}{K_q\Delta}\ (\pm1\text{ 碼}),\ \ \frac{1}{\sqrt{1+r^2}}\ (\text{Gaussian})\\[4pt] \operatorname{std}\!\Big(\frac{\hat J_{ij}}{K_q}\Big)\approx\frac{\sqrt{2/N_J}}{2K_q\Delta}\end{gathered}`,
    level: 'research',
    claim: 'approx',
    // practice：讀數的差 ≤ 0.24，而 2K_qΔ ≥ 2×0.0039894×30 = 0.2394 ⇒ |Ĵ/K_q| ≤ 1.003：每一種組合都是 |R_ij| ≤ 1 的 unit-RMS regressor（在雜訊內）量得到的數字
    inputs: [
      { key: 'gp', symbol: String.raw`G_i(\mathbf w+\Delta\mathbf e_j)`, label: '第 $j$ 個參數 $+\\Delta$ 時 $\\mathrm{GMAC}_i$ 的讀數', default: -FD_DEMO_READING, min: -2, max: 2, practice: { choices: [-0.12, -0.1, -0.08, -0.06] } },
      { key: 'gm', symbol: String.raw`G_i(\mathbf w-\Delta\mathbf e_j)`, label: '第 $j$ 個參數 $-\\Delta$ 時 $\\mathrm{GMAC}_i$ 的讀數', default: FD_DEMO_READING, min: -2, max: 2, practice: { choices: [0.12, 0.1, 0.08, 0.06] } },
      { key: 'dfs', symbol: String.raw`\Delta`, label: '擾動量', unit: String.raw`\mathrm{fs}`, default: 30, min: 0, max: 10000, practice: { choices: [30, 40, 50, 60] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [100, 200] } },
      { key: 'NJ', symbol: 'N_J', label: '每次量測累加的 sample 數', unit: String.raw`\text{samples}`, default: 4096, min: 0, max: 262144, integer: true, practice: { choices: [1024, 4096, 16384, 65536] } },
    ],
    validate: ({ gp, gm, dfs, sigmaV, NJ }) => {
      if (Math.abs(gp) > 1 || Math.abs(gm) > 1) {
        return String.raw`GMAC 讀數的絕對值不可能超過 1：average 模式的 $G=\frac1N\sum q\,x$ 是 $\pm1$ 的 comparator 輸出乘上 unit-RMS code 的平均（$|G|\le E|x|\le1$）。若你的讀數是 sum 模式，請先除以 $N_J$（勘誤 E18）。`
      }
      if (!(dfs > 0)) return String.raw`$\Delta$ 必須 $>0$：兩次量測要在 $\mathbf w\pm\Delta\mathbf e_j$ 兩個不同的點，分母 $2\Delta$ 不能是 0。`
      if (!(sigmaV > 0)) return MSG_SIGMA
      if (!(Number.isInteger(NJ) && NJ >= 1)) return String.raw`$N_J$ 必須是 $\ge1$ 的整數（每次量測累加的 comparator sample 數）。`
      // 這一題的截斷與雜訊公式假設 unit-RMS regressor：|J_ij/K_q| = |R_ij| ≤ 1，所以兩個讀數的差不可能比 2K_qΔ 大出雜訊很多
      const linMax = 2 * kqFromSigma(sigmaV) * dfs
      const noise5 = 5 * Math.sqrt(2 / NJ)
      const diff = Math.abs(gp - gm)
      if (diff > linMax + noise5) {
        return String.raw`兩個讀數相差 $|G_+-G_-|=${tx(diff)}$，比這個 $\Delta$ 能產生的上限 $2K_q\Delta=${texNum(linMax)}$ 加上 5 倍量測雜訊 $5\sqrt{2/N_J}=${texNum(noise5)}$ 還大。這等於 $|\hat J_{ij}/K_q|=${texNum(diff / linMax)}$，但本題的模型是 unit-RMS regressor：$|J_{ij}/K_q|=|R_{ij}|\le1$（Cauchy–Schwarz），1-bit 截斷只會讓量到的值更小。多半是 $\Delta$ 或 $\sigma_v$ 填錯（兩者的單位都是 fs），或讀數是 sum 模式而沒有除以 $N_J$（勘誤 E18）。`
      }
      return null
    },
    solve: ({ gp, gm, dfs, sigmaV, NJ }) => {
      const Kq = kqFromSigma(sigmaV)
      // 把兩個讀數交給實際的中央差分函式（P = 1）：δ = −Δ ⇔ w + Δ，δ = +Δ ⇔ w − Δ
      const Jhat = centralDiffJacobian((d) => [d[0] < 0 ? gp : gm], [0], dfs)[0][0]
      const JhatN = Jhat / Kq
      const r = dfs / sigmaV
      const x = r / Math.SQRT2
      const erfX = erf(x)
      const kqDelta = Kq * dfs
      const tPm1 = fdTruncationFactor('pm1', r)
      const tGauss = fdTruncationFactor('gaussian', r)
      // 同樣的 Δ、N_J 讓模型實際量一次（±1 碼、R_jj = 1、固定 seed）：info.std 是 Ĵ_n 的理論標準差
      const plant = buildPlant({ mode: 'R', R: [[1]], sigmaV, N: NJ, dist: 'pm1' })
      const fd = resolveJhat(plant, { source: 'finiteDiff', fdDeltaFs: dfs, fdSamples: NJ }, [0], FD_SEED)
      const stdN = (fd.info.std as Mat)[0][0]
      const measuredN = fd.JnHat[0][0]
      const series = (2 / Math.sqrt(Math.PI)) * (x - (x * x * x) / 3)
      const onePlus = 1 + r * r
      const root = Math.sqrt(2 / NJ)
      // 「≈」的修正：每個讀數的變異是 (1 − G²)/N_J（q·x 的二階動差是 1、平均是 G）
      const stdRefined = Math.sqrt((2 - gp * gp - gm * gm) / NJ) / (2 * kqDelta)
      return {
        steps: [
          {
            tex: String.raw`\hat J_{ij}=\frac{G_i(\mathbf w+\Delta\mathbf e_j)-G_i(\mathbf w-\Delta\mathbf e_j)}{2\Delta}=\frac{${tx(gp)}-${txP(gm)}}{2\times${tx(dfs)}}=\frac{${tx(gp - gm)}}{${tx(2 * dfs)}}=${texNum(Jhat)}\ \mathrm{fs}^{-1}`,
            why: String.raw`Freeze $\mathbf w$，把第 $j$ 個係數分別 $\pm\Delta$，各量一次 GMAC，相減再除以 $2\Delta$。$w_j$ 增加時 $\delta_j=a_j-w_j$ 減少，所以正常極性的對角斜率是負的。`,
          },
          kqStep(sigmaV, Kq),
          {
            tex: String.raw`\frac{\hat J_{ij}}{K_q}=\frac{${texNum(Jhat)}}{${texNum(Kq)}}=${texNum(JhatN)}`,
            why: String.raw`除以 $K_q$ 變成無因次的 $\hat J_{n,ij}$。匹配模型的真值是 $-R_{ij}$（對角元素是 $-1$），量到的絕對值偏小就是下面要算的 1-bit 截斷。`,
          },
          {
            tex: String.raw`r=\frac{\Delta}{\sigma_v}=\frac{${tx(dfs)}}{${tx(sigmaV)}}=${tx(r)}`,
            why: String.raw`擾動量相對於 comparator 雜訊有多大（無因次）。下面兩個截斷係數都只跟 $r$ 有關。`,
          },
          {
            tex: String.raw`x=\frac{r}{\sqrt2}=\frac{${tx(r)}}{1.4142}=${texNum(x)}`,
            why: String.raw`erf 的引數 $\Delta/(\sqrt2\,\sigma_v)$：$\sqrt2\approx1.4142$，一次除法。`,
          },
          {
            tex: String.raw`\operatorname{erf}(x)=\operatorname{erf}(${texNum(x)})=${texNum(erfX)}`,
            why:
              String.raw`查 erf 表（或試算表的 ERF 函數；一般工程計算機沒有這個鍵）。` +
              (x <= 0.5
                ? String.raw`沒有表時用級數前兩項 $\operatorname{erf}(x)\approx\dfrac{2}{\sqrt\pi}\Big(x-\dfrac{x^3}{3}\Big)=1.12838\times(${texNum(x)}-${texNum((x * x * x) / 3)})=${texNum(series)}$（$|x|\le0.5$ 時誤差 $<1\%$）。`
                : String.raw`這裡 $x>0.5$，級數前兩項 $\frac{2}{\sqrt\pi}(x-x^3/3)$ 的誤差會超過 1%，請查表或再加一項 $+x^5/10$。`),
          },
          {
            tex: String.raw`K_q\Delta=${texNum(Kq)}\times${tx(dfs)}=${texNum(kqDelta)}`,
            why: String.raw`如果 S 曲線是完美的直線，$\pm\Delta$ 處的 GMAC 就是 $\pm K_q\Delta$。`,
          },
          {
            tex: String.raw`\Big(\frac{\hat J_{ij}}{J_{ij}}\Big)_{\pm1}=\frac{\operatorname{erf}(x)}{K_q\Delta}=\frac{${texNum(erfX)}}{${texNum(kqDelta)}}=${texNum(tPm1)}`,
            why: String.raw`$\pm1$ 碼的截斷係數（F-10.14）：erf 形狀的 S 曲線在 $\pm\Delta$ 已開始飽和，量到的斜率只有真值的這個比例。`,
          },
          {
            tex: String.raw`1+r^2=1+${sq(r)}=1+${tx(r * r)}=${tx(onePlus)}`,
            why: String.raw`Gaussian regressor（$R_{jj}=1$）的截斷係數 $1/\sqrt{1+r^2}$ 的分母：先平方、再加 1。`,
          },
          {
            tex: String.raw`\Big(\frac{\hat J_{ij}}{J_{ij}}\Big)_{\text{Gauss}}=\frac{1}{\sqrt{1+r^2}}=\frac{1}{\sqrt{${tx(onePlus)}}}=\frac{1}{${texNum(Math.sqrt(onePlus), 6)}}=${texNum(tGauss)}`,
            why: String.raw`開根號（計算機的 $\sqrt{x}$ 鍵）、取倒數。Gaussian code 的振幅有大有小，比 $\pm1$ 碼更早飽和，所以這個係數比上一個小。`,
          },
          {
            tex: String.raw`\sqrt{\frac{2}{N_J}}=\sqrt{\frac{2}{${texInt(NJ)}}}=\sqrt{${texNum(2 / NJ)}}=${texNum(root)}`,
            why: String.raw`雜訊：每次 $N_J$-sample GMAC 的變異約 $R_{x,ii}/N_J=1/N_J$，兩次獨立量測相減 $\Rightarrow$ 變異相加（$2/N_J$），再開根號。$N_J$ 是 2 的冪次時可以心算：$\sqrt{2/4096}=\sqrt2/64$。`,
          },
          {
            tex: String.raw`\operatorname{std}\!\Big(\frac{\hat J_{ij}}{K_q}\Big)\approx\frac{\sqrt{2/N_J}}{2K_q\Delta}=\frac{${texNum(root)}}{2\times${texNum(kqDelta)}}=\frac{${texNum(root)}}{${texNum(2 * kqDelta)}}=${texNum(stdN)}`,
            why: String.raw`再除以 $2K_q\Delta$（上面算過 $K_q\Delta$），就是正規化斜率的量測雜訊。$\Delta$ 越小雜訊越大——和截斷剛好相反（bias–variance trade-off）。`,
          },
        ],
        results: [
          { symbol: String.raw`\hat J_{ij}`, label: '量到的 Jacobian 元素', value: Jhat, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: String.raw`\hat J_{ij}/K_q`, label: '正規化後（無因次）', value: JhatN },
          { symbol: String.raw`(\hat J_{ij}/J_{ij})_{\pm1}`, label: '$\\pm1$ 碼的截斷係數', value: tPm1 },
          { symbol: String.raw`(\hat J_{ij}/J_{ij})_{\text{Gauss}}`, label: 'Gaussian regressor 的截斷係數', value: tGauss },
          { symbol: String.raw`\operatorname{std}(\hat J_{ij}/K_q)`, label: '每個元素的量測雜訊', value: stdN },
        ],
        notes: [
          String.raw`把截斷補回來，就得到 $R_{ij}$ 的估計值：$\hat R_{ij}=-\dfrac{\hat J_{ij}/K_q}{(\hat J_{ij}/J_{ij})_{\pm1}}=\dfrac{${texNum(-JhatN)}}{${texNum(tPm1)}}=${texNum(-JhatN / tPm1)}$（$\pm1$ 碼；Gaussian regressor 則除以 $${texNum(tGauss)}$ 得 $${texNum(-JhatN / tGauss)}$），量測雜訊約 $\pm${texNum(stdN, 2)}$。對角元素（$i=j$）應該接近 1；非對角元素就是兩個 regressor 的相關係數。`,
          String.raw`「$\approx$」的來源：每個讀數的變異其實是 $(1-G^2)/N_J$（$q\,x$ 的平方平均是 1、平均是 $G$），上面取 $G^2\ll1$。用你的兩個讀數修正：$\sqrt{(2-G_+^2-G_-^2)/N_J}\,/\,(2K_q\Delta)=${texNum(stdRefined)}$，比上面的近似小 $${texNum(100 * (1 - stdRefined / stdN), 2)}\%$` +
            (stdRefined / stdN < 0.95 ? '——讀數已經不算小（$\\Delta$ 相對於 $\\sigma_v$ 偏大），請用修正後的值。' : '，可以忽略。'),
          String.raw`網站的 1-bit GMAC 模型用同樣的 $\Delta$、$N_J$ 對一個對角元素（$\pm1$ 碼、$R_{jj}=1$、固定 seed）實際量一次，得到 $\hat J_{n,jj}=${texNum(measuredN)}$（期望值 $-${texNum(tPm1)}$）：單次量測就是會在期望值附近抖 $\pm${texNum(stdN, 2)}$ 左右。`,
          String.raw`對 $\rho=0.99$ 的 $\mathbf R$（$\lambda_{\min}=0.01$）：雜訊 $${texNum(stdN, 2)}$ ` + (stdN > 0.01 ? '比 $\\lambda_{\\min}$ 還大，用這個 $\\hat{\\mathbf J}$ 求完整反矩陣等於拿雜訊去除以接近 0 的數——需要更大的 $N_J$ 或 regularizer（勘誤 E24）。' : '已小於 $\\lambda_{\\min}$，但仍要留意截斷造成的系統性偏差（勘誤 E24）。'),
        ],
      }
    },
    tips: [
      String.raw`$\operatorname{erf}$ 小抄：$\operatorname{erf}(0.1)=0.1125$、$\operatorname{erf}(0.2)=0.2227$、$\operatorname{erf}(0.3)=0.3286$、$\operatorname{erf}(0.5)=0.5205$、$\operatorname{erf}(0.707)=0.6827$、$\operatorname{erf}(1)=0.8427$；中間的值用線性內插或級數 $\frac{2}{\sqrt\pi}(x-x^3/3)$（$|x|\le0.5$ 時誤差 $<1\%$）。和 $\Phi$ 的關係：$\operatorname{erf}(x)=2\Phi(\sqrt2\,x)-1$，所以也可以查標準常態表 $\Phi(r)$ 再算 $2\Phi(r)-1$。`,
      String.raw`極性：引數寫的是 $\mathbf w$。$\mathbf w+\Delta\mathbf e_j$ 等於 $\delta_j$ 減少 $\Delta$，所以 $G_i(\mathbf w+\Delta\mathbf e_j)$ 通常是負的、$G_i(\mathbf w-\Delta\mathbf e_j)$ 是正的。兩個讀數不必對稱：$\mathbf w$ 還沒校正好時，別的參數的誤差會讓兩個讀數一起平移，在線性範圍內相減後剛好消掉。`,
      String.raw`範例數字：$\Delta=0.3\sigma_v=30\ \mathrm{fs}$，$\pm1$ 碼的讀數 $\mp\operatorname{erf}(0.3/\sqrt2)=\mp0.2358$ $\Rightarrow$ 截斷係數 $0.9852$（$-1.5\%$）、Gaussian $0.9578$、$N_J=4096$ 的雜訊 $0.0462$（§10.5 表格 $\Delta/\sigma_v=0.3$ 那一列）。`,
    ],
  },

  // ───────────────────────── HC-10.7：T18——用 trace / determinant 求 eig(I + MJ)（F-10.11） ─────────────────────────
  {
    id: 'HC-10.7',
    title: 'T18：每個 loop 單獨穩定，一起更新呢？（用 trace 與 determinant 求 pole）',
    page: PAGE,
    formulaId: 'F-10.11',
    formulaTex: String.raw`\mathbf A=\mathbf I+\mu\mathbf J,\qquad T=\operatorname{tr}\mathbf A,\quad D=\det\mathbf A,\qquad p_{1,2}=\frac{T\pm\sqrt{T^2-4D}}{2},\qquad \rho(\mathbf A)=\max_i|p_i|<1\ \text{才收斂}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'j11', symbol: 'J_{11}', label: '$\\mathrm{GMAC}_1$ 對 $w_1$ 的斜率（$K_q$ 正規化為 1）', default: -1, min: -10, max: 10, practice: { choices: [-1, -1, -2, -0.5] } },
      { key: 'j12', symbol: 'J_{12}', label: '$\\mathrm{GMAC}_1$ 對 $w_2$ 的斜率（耦合）', default: 2, min: -10, max: 10, practice: { choices: [2, 1.5, 1, 0.5, -1] } },
      { key: 'j21', symbol: 'J_{21}', label: '$\\mathrm{GMAC}_2$ 對 $w_1$ 的斜率（耦合）', default: 2, min: -10, max: 10, practice: { choices: [2, 1.5, 1, 0.5, -1] } },
      { key: 'j22', symbol: 'J_{22}', label: '$\\mathrm{GMAC}_2$ 對 $w_2$ 的斜率', default: -1, min: -10, max: 10, practice: { choices: [-1, -1, -2, -0.5] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'scalar 步長（$\\mathbf M=\\mu\\mathbf I$）', default: 0.2, min: -1, max: 4, practice: { choices: [0.1, 0.2, 0.25, 0.5] } },
    ],
    validate: ({ j11, j12, j21, j22, mu }) => {
      if (j11 === 0 && j12 === 0 && j21 === 0 && j22 === 0) return String.raw`$\mathbf J=\mathbf 0$：GMAC 對任何係數都沒有斜率，$\mathbf A=\mathbf I$，誤差永遠不動。請至少輸入一個非零元素。`
      if (!(mu > 0)) return String.raw`$\mu$ 必須 $>0$：$\mu=0$ 等於不更新；$\mu<0$ 等於把所有 loop 的極性反過來（那是另一個問題，請直接改 $\mathbf J$ 的正負號）。`
      return null
    },
    solve: ({ j11, j12, j21, j22, mu }) => {
      const J: Mat = [
        [j11, j12],
        [j21, j22],
      ]
      const plant = buildPlant({ mode: 'J', Jn: J, sigmaV: SIGMA_KQ1, N: 1 })
      const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: mu }), J) // A = I + μJ、eig、ρ(A)
      const A = an.A as Mat
      const ins = inspectMatrix(A)
      const T = ins.trace
      const D = ins.det
      const discRaw = T * T - 4 * D
      const disc = Math.abs(discRaw) < 1e-12 * Math.max(1, T * T) ? 0 : discRaw
      const rhoA = an.spectralRadius
      const single = [snap(1 + mu * j11), snap(1 + mu * j22)]
      const singleStable = single.every((p) => Math.abs(p) < 1)
      const Dz = snap(D)
      const steps: HandCalcStep[] = [
        {
          // 兩個 pole 各一行（對齊等號）：寫成一行在桌機的正文欄也放不下，會多出一條橫向捲軸
          tex: String.raw`\begin{aligned}p_{\text{single},1}&=1+\mu J_{11}=1+${tx(mu)}\times${txP(j11)}=1${txSigned(mu * j11)}=${tx(single[0])}\\p_{\text{single},2}&=1+\mu J_{22}=1+${tx(mu)}\times${txP(j22)}=1${txSigned(mu * j22)}=${tx(single[1])}\end{aligned}`,
          why: String.raw`先看「只開一個 loop、另一個凍結」：純量遞迴的 pole 是 $1+\mu J_{ii}$（先乘、再加 1）。$J_{ii}<0$ 代表單一 loop 的極性正確。`,
        },
        {
          tex: String.raw`\mathbf A=\mathbf I+\mu\mathbf J=\begin{bmatrix}1+\mu J_{11}&\mu J_{12}\\\mu J_{21}&1+\mu J_{22}\end{bmatrix}=\begin{bmatrix}${tx(single[0])}&${tx(mu)}\times${txP(j12)}\\${tx(mu)}\times${txP(j21)}&${tx(single[1])}\end{bmatrix}=${bm(A)}`,
          why: String.raw`兩個 loop 一起更新時的迴路矩陣（F-10.2 的 $\mathbf A_{\mathrm{cal}}=\mathbf I+\mathbf M\mathbf J$）：對角就是上一步的兩個 single-loop pole，非對角各做一次乘法。`,
        },
        {
          tex: String.raw`T=\operatorname{tr}\mathbf A=A_{11}+A_{22}=${tx(A[0][0])}+${txP(A[1][1])}=${tx(T)}`,
          why: String.raw`Trace = 對角線的和 = 兩個 eigenvalue 的和 $p_1+p_2$。`,
        },
        {
          tex: String.raw`D=\det\mathbf A=A_{11}A_{22}-A_{12}A_{21}=${txP(A[0][0])}\times${txP(A[1][1])}-${txP(A[0][1])}\times${txP(A[1][0])}=${tx(A[0][0] * A[1][1])}-${txP(A[0][1] * A[1][0])}=${tx(Dz)}`,
          why: String.raw`Determinant = 兩個 eigenvalue 的乘積 $p_1p_2$：兩次乘法、一次減法。`,
        },
        {
          tex: String.raw`T^2-4D=${sq(snap(T))}-4\times${txP(Dz)}=${tx(T * T)}-${txP(4 * Dz)}=${tx(disc)}`,
          why: String.raw`特徵方程式 $\det(\mathbf A-p\mathbf I)=p^2-Tp+D=0$ 的判別式：$\ge0$ 是兩個實數 pole，$<0$ 是一對共軛複數。`,
        },
      ]
      const notes: string[] = []
      let results: HandCalcResult[]
      if (disc >= 0) {
        const root = Math.sqrt(disc)
        const re = an.poles.map((z) => z.re)
        const p1 = snap(Math.max(...re))
        const p2 = snap(Math.min(...re))
        steps.push(
          {
            tex: String.raw`\sqrt{T^2-4D}=\sqrt{${tx(disc)}}=${tx(root)}`,
            why: String.raw`計算機開一次根號（$\sqrt{x}$ 鍵）。`,
          },
          {
            tex: String.raw`p_1=\frac{T+\sqrt{T^2-4D}}{2}=\frac{${tx(T)}+${tx(root)}}{2}=\frac{${tx(T + root)}}{2}=${tx(p1)},\qquad p_2=\frac{T-\sqrt{T^2-4D}}{2}=\frac{${tx(T)}-${tx(root)}}{2}=\frac{${tx(snap(T - root, T))}}{2}=${tx(p2)}`,
            why: String.raw`二次方程式的公式解（先加／減、再除以 2）：這兩個數就是 $\operatorname{eig}(\mathbf I+\mu\mathbf J)$，也就是兩個模式每個 block 乘上的倍數。`,
          },
          {
            tex: String.raw`\rho(\mathbf A)=\max\big(|${tx(p1)}|,\ |${tx(p2)}|\big)=${tx(rhoA)}`,
            why: String.raw`Spectral radius：最大的 $|p_i|$。$<1$ 才收斂。`,
          },
        )
        results = [
          { symbol: 'p_1', label: '較大的 pole', value: p1, tolerance: poleTol(p1) },
          { symbol: 'p_2', label: '較小的 pole', value: p2, tolerance: poleTol(p2) },
          { symbol: String.raw`\rho(\mathbf A)`, label: 'spectral radius', value: rhoA },
        ]
        const s1 = (p1 - 1) / mu
        const s2 = (p2 - 1) / mu
        const e1 = snap(s1)
        const e2 = snap(s2)
        notes.push(
          String.raw`對應的 $\operatorname{eig}(\mathbf J)=(p-1)/\mu=${tx(e1)},\ ${tx(e2)}$。` +
            (e1 > 0
              ? String.raw`有一個是正的：$-\mathbf J$ 不是正定，這個方向的斜率極性是錯的，$p=1+\mu s>1$ 對任何 $\mu>0$ 都成立——縮小步長沒有用，要用 $-\gamma\mathbf J^{-1}$ 或 regularized pinv 修正方向。`
              : e1 === 0
                ? String.raw`有一個是 0：$\mathbf J$ 奇異（$\det\mathbf J=0$），GMAC 在這個方向完全沒有斜率（不可辨識）。$p=1+\mu\cdot0=1$ 對任何 $\mu$ 都成立——這個方向的誤差永遠凍結，改步長或換更新矩陣都救不了，只能固定其中一個參數或增加激勵。`
                : String.raw`全部是負的：$\mathbf J$ 的每個方向極性都正確，只要 $\mu$ 夠小（$\mu<2/|s|_{\max}=${texNum(2 / Math.max(Math.abs(e1), Math.abs(e2)))}$）就穩定。`),
        )
      } else {
        const z = an.poles[0]
        const re = z.re
        const im = Math.abs(z.im)
        const root = Math.sqrt(-disc)
        steps.push(
          {
            tex: String.raw`\operatorname{Re}p=\frac{T}{2}=\frac{${tx(T)}}{2}=${tx(re)}`,
            why: String.raw`判別式是負的 $\Rightarrow$ 一對共軛複數 $p=\operatorname{Re}p\pm j\operatorname{Im}p$。實部與虛部分開算：實部就是 $T/2$。`,
          },
          {
            tex: String.raw`\operatorname{Im}p=\pm\frac{\sqrt{4D-T^2}}{2}=\pm\frac{\sqrt{${tx(-disc)}}}{2}=\pm\frac{${tx(root)}}{2}=\pm${tx(im)}`,
            why: String.raw`虛部：把判別式變號後開根號（$\sqrt{x}$ 鍵），再除以 2。複數 pole 代表誤差一邊旋轉（振盪）一邊縮小或放大——$\mathbf J$ 不對稱造成的。`,
          },
          {
            tex: String.raw`|p|=\sqrt{(\operatorname{Re}p)^2+(\operatorname{Im}p)^2}=\sqrt{${sq(re)}+${sq(im)}}=\sqrt{${tx(re * re)}+${tx(im * im)}}=\sqrt{${tx(Dz)}}=${tx(rhoA)}`,
            why: String.raw`模長：實部平方加虛部平方，再開根號。平方和剛好就是上面的 $D$（共軛複數的乘積 $p\,\bar p=|p|^2=\det\mathbf A$），所以也可以直接開 $D$ 的根號。兩個 pole 模長相同，它就是 $\rho(\mathbf A)$。`,
          },
        )
        results = [
          { symbol: String.raw`\operatorname{Re}p`, label: 'pole 的實部', value: re, tolerance: { abs: Math.max(1e-9, 0.01 * rhoA), rel: 0 } },
          { symbol: String.raw`|\operatorname{Im}p|`, label: 'pole 的虛部（絕對值）', value: im },
          { symbol: String.raw`\rho(\mathbf A)=|p|`, label: 'spectral radius', value: rhoA },
        ]
        const angleDeg = (Math.atan2(im, re) * 180) / Math.PI
        notes.push(
          String.raw`複數 pole $${tx(re)}\pm j\,${tx(im)}$：誤差向量每個 block 旋轉 $\theta=\arctan(\operatorname{Im}p/\operatorname{Re}p)=${texNum(angleDeg, 4)}^\circ$（計算機切到 DEG，按 $\tan^{-1}$` +
            (re < 0 ? String.raw`；實部是負的，要把計算機給的角度加上 $180^\circ$` : '') +
            String.raw`），長度乘上 $${tx(rhoA)}$；轉一圈大約要 $360^\circ/\theta=${texNum(360 / angleDeg, 3)}$ 個 block。`,
        )
      }
      const marginal = Math.abs(rhoA - 1) <= 1e-9
      if (marginal) {
        notes.push(String.raw`$\rho(\mathbf A)=1$：臨界——有一個模式的誤差不衰減也不放大（凍結或等幅振盪），不算收斂。`)
      } else if (rhoA > 1) {
        notes.push(
          singleStable
            ? String.raw`每個 loop 單獨的 pole 是 $${texNum(single[0])}$、$${texNum(single[1])}$（都穩定），一起更新卻有 $\rho(\mathbf A)=${texNum(rhoA)}>1$：誤差每個 block 放大 $${texNum(rhoA)}$ 倍。每個 loop 單獨穩定，不代表 MIMO 一起穩定（T18）。`
            : String.raw`$\rho(\mathbf A)=${texNum(rhoA)}>1$：發散。連單一 loop 的 pole（$${texNum(single[0])}$、$${texNum(single[1])}$）都有不在單位圓內的，先檢查對角斜率的極性與步長。`,
        )
      } else {
        notes.push(String.raw`$\rho(\mathbf A)=${texNum(rhoA)}<1$：穩定，需要 $k_{95}=${stepsToDecay(rhoA)}$ 個 block（F-10.5）。`)
      }
      return { steps, results, notes }
    },
    tips: [
      String.raw`對稱的 $\mathbf J$（$J_{12}=J_{21}$、$J_{11}=J_{22}=a$、$J_{12}=b$）有捷徑：$\operatorname{eig}(\mathbf J)=a\pm b$，所以 $p=1+\mu(a\pm b)$。T18：$a=-1$、$b=2$ $\Rightarrow$ $p=1+0.2\times\{1,-3\}=\{1.2,\ 0.4\}$。`,
      String.raw`檢查：$p_1+p_2$ 應等於 $T$、$p_1p_2$ 應等於 $D$。`,
      String.raw`想看複數 pole：試 $J_{12}=2$、$J_{21}=-2$（旋轉型耦合），判別式會變成負的；這時把實部 $T/2$ 與虛部 $\sqrt{4D-T^2}/2$ 分開算，模長就是 $\sqrt D$。`,
    ],
  },

  // ───────────────────────── HC-10.8：綜合——598 / 5 / 65 的速度與雜訊（F-10.3 / 10.4 / 10.5 / 10.6 / 10.7 / 10.8） ─────────────────────────
  {
    id: 'HC-10.8',
    title: '綜合題：598／5／65——三種更新矩陣在慢模式上的速度與雜訊',
    page: PAGE,
    formulaId: 'F-10.7',
    formulaTex: String.raw`m=\begin{cases}\mu K_q&\text{一般 LMS}\\ \gamma/\lambda_{\min}&\text{完整反矩陣}\\ \gamma/(\lambda_{\min}+\lambda_{\mathrm{reg}})&\text{Regularized}\end{cases}\quad p=1-m\,\lambda_{\min},\quad k_{95}=\left\lceil\frac{\ln0.05}{\ln|p|}\right\rceil,\quad \operatorname{Var}(\xi_{\text{slow}})=\frac{m^2\,\lambda_{\min}}{K_q^2\,N\,(1-p^2)}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho`, label: 'regressor 相關係數', default: 0.99, min: -2, max: 2, practice: { choices: [0.8, 0.9, 0.95, 0.99] } },
      { key: 'muKq', symbol: String.raw`\mu K_q`, label: '一般 LMS 的無因次 loop gain', default: 0.5, min: -1, max: 4, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'gamma', symbol: String.raw`\gamma`, label: '完整反矩陣／regularized 的 loop gain', default: 0.5, min: -1, max: 3, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'lamReg', symbol: String.raw`\lambda_{\mathrm{reg}}`, label: 'regularization 參數（R 形式）', default: 0.1, min: -1, max: 100, practice: { choices: [0.05, 0.1, 0.2] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: String.raw`\text{samples}`, default: 4096, min: 0, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ rho, muKq, gamma, lamReg, N, sigmaV }) => {
      if (Math.abs(rho) > 1) return MSG_RHO_GT1
      if (Math.abs(rho) === 1) return MSG_RHO_EQ1
      const lmax = 1 + Math.abs(rho)
      if (!(muKq > 0 && muKq < 2 / lmax)) {
        return String.raw`一般 LMS 的 $\mu K_q$ 必須在 $0<\mu K_q<2/\lambda_{\max}=${texNum(2 / lmax)}$：否則快模式的 pole $1-\mu K_q\lambda_{\max}=${texNum(1 - muKq * lmax)}$ 不在單位圓內（$\mu K_q\le0$ 則根本不收斂），沒有穩態變異可算。`
      }
      if (!(gamma > 0 && gamma < 2)) return MSG_GAMMA
      if (lamReg < 0) return String.raw`$\lambda_{\mathrm{reg}}$ 必須 $\ge0$（$=0$ 時 regularized 就是完整反矩陣）。`
      if (!(Number.isInteger(N) && N >= 1)) return MSG_N
      if (!(sigmaV > 0)) return MSG_SIGMA
      const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV, N })
      const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq }), plant.Jn)
      if (!sc.ok || !sc.stable) {
        return String.raw`慢模式的 pole 與 1 的差距不到 $10^{-9}$（$\lambda_{\min}=1-|\rho|$ 太接近 0）：實務上等同不可辨識，$k_{95}$ 與穩態變異沒有意義。請減小 $|\rho|$。`
      }
      return null
    },
    solve: ({ rho, muKq, gamma, lamReg, N, sigmaV }) => {
      const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV, N })
      const Kq = plant.Kq
      const lmin = plant.modeValues[1]
      const trRx = trace(plant.Rx)
      const kq2N = Kq * Kq * N
      const row = (cfg: RuleConfig) => {
        const m = ruleModeGain(cfg, lmin, trRx) as number // 規則沿慢 eigenvector 的增益 m
        const p = snap(1 - m * lmin)
        const an = analyzeRule(plant, cfg, plant.Jn)
        return { m, p, k: stepsToDecay(p), v: modeVarianceClosed(m, lmin, Kq, N), rhoA: an.spectralRadius, kAll: an.blocks95, validity: an.validityIndex ?? 0 }
      }
      const s = row(rule({ rule: 'scalar', muKq }))
      const f = row(rule({ rule: 'full', gamma }))
      const r = row(rule({ rule: 'regularized', regForm: 'R', gamma, lambdaReg: lamReg }))
      /** 1 − p²：寫成 (1 − p)(1 + p)，p 很接近 1 時手算才不會損失有效位數 */
      const gapTex = (sub: string, x: { p: number }) =>
        String.raw`1-p_{\mathrm ${sub}}^2=(1-p_{\mathrm ${sub}})(1+p_{\mathrm ${sub}})=${tx(1 - x.p, 7)}\times${tx(1 + x.p, 7)}=${tx((1 - x.p) * (1 + x.p))}`
      const varTex = (sym: string, sub: string, x: { m: number; p: number; v: number }) =>
        String.raw`${sym}=\frac{m_{\mathrm ${sub}}^2\,\lambda_{\min}}{K_q^2N\,(1-p_{\mathrm ${sub}}^2)}=\frac{${sq(x.m, 7)}\times${tx(lmin)}}{${texNum(kq2N)}\times${tx((1 - x.p) * (1 + x.p))}}=\frac{${tx(x.m * x.m * lmin)}}{${texNum(kq2N * (1 - x.p) * (1 + x.p))}}=${texNum(x.v)}\ \mathrm{fs}^2`
      const notes: string[] = [
        f.m > s.m
          ? String.raw`速度：完整反矩陣比一般 LMS 快 $${s.k}/${f.k}=${texNum(s.k / f.k, 4)}$ 倍；代價：慢模式 RMS 大 $\sqrt{${texNum(f.v)}/${texNum(s.v)}}=${texNum(Math.sqrt(f.v / s.v), 4)}$ 倍。Preconditioner 可以加速，但不能製造缺失的資訊。`
          : String.raw`這組數字下 $m_{\mathrm f}=\gamma/\lambda_{\min}=${tx(f.m)}\le m_{\mathrm s}=\mu K_q=${tx(s.m)}$：完整反矩陣在慢模式上並沒有比一般 LMS 快（$k_{95}$：$${f.k}$ 對 $${s.k}$）。$\lambda_{\min}$ 不小（eigenvalue spread 不大）時，Preconditioner 沒有什麼可以修的；它的價值在 $\lambda_{\min}\ll1$ 的時候。`,
        lamReg === 0
          ? String.raw`$\lambda_{\mathrm{reg}}=0$：Regularized 就是完整反矩陣，兩列的數字完全相同。`
          : r.m >= s.m
            ? String.raw`Regularized 在中間：$k_{95}=${r.k}$，慢模式 RMS 是完整反矩陣的 $${texNum(Math.sqrt(r.v / f.v), 3)}$ 倍、一般 LMS 的 $${texNum(Math.sqrt(r.v / s.v), 3)}$ 倍。`
            : String.raw`這個 $\lambda_{\mathrm{reg}}$ 很大：$m_{\mathrm r}=${tx(r.m)}<m_{\mathrm s}=${tx(s.m)}$，Regularized 在慢模式上比一般 LMS 還慢（$k_{95}=${r.k}$ 對 $${s.k}$），但也更安靜（RMS 是一般 LMS 的 $${texNum(Math.sqrt(r.v / s.v), 3)}$ 倍）。$\lambda_{\mathrm{reg}}$ 應該選在 $\lambda_{\min}$ 與 $\lambda_{\max}$ 之間。`,
        String.raw`三個 RMS（$\sqrt{\operatorname{Var}}$）：一般 LMS $${texNum(Math.sqrt(s.v), 4)}\ \mathrm{fs}$、完整反矩陣 $${texNum(Math.sqrt(f.v), 4)}\ \mathrm{fs}$、regularized $${texNum(Math.sqrt(r.v), 4)}\ \mathrm{fs}$。這是慢 eigen-mode $\xi_{\text{slow}}$ 的抖動，不是單一參數的（勘誤 E37；每個參數的算法見 HC-10.4）。`,
      ]
      const fastLed = [
        { name: '一般 LMS', x: s },
        { name: 'Regularized', x: r },
      ].filter(({ x }) => x.rhoA > Math.abs(x.p) + 1e-9)
      const worst = [
        { name: '一般 LMS', x: s },
        { name: '完整反矩陣', x: f },
        { name: 'Regularized', x: r },
      ].reduce((a, b) => (b.x.validity > a.x.validity ? b : a))
      if (worst.x.validity > 0.05) {
        notes.push(
          String.raw`近平衡檢查：$E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]/\sigma_v^2$ 最大的是${worst.name}的 $${texNum(worst.x.validity, 3)}$（$>0.05$）：穩態誤差已經和 comparator noise 同量級，真正的 1-bit 迴路會偏離這些變異公式（線性化的 $K_q$ 不再準）；請加大 $N$ 或減小步長。`,
        )
      }
      fastLed.forEach(({ name, x }) => {
        notes.push(String.raw`注意：${name} 在這組數字下，絕對值最大的 pole 是快模式（$\rho(\mathbf A)=${texNum(x.rhoA)}>|p_{\text{slow}}|=${texNum(Math.abs(x.p))}$，快模式是負的、來回震盪），整個迴路的 $k_{95}$ 是 $${x.kAll ?? '\\infty'}$ 而不是上面慢模式的 $${x.k}$。`)
      })
      return {
        steps: [
          {
            tex: String.raw`\begin{aligned}\lambda_{\min}&=1-|\rho|\\&=1-${tx(Math.abs(rho))}=${tx(lmin)}\end{aligned}`,
            why: String.raw`慢模式的 eigenvalue（差模方向 $[1,-1]^T/\sqrt2$）。三種更新矩陣都與 $\mathbf R$ 共用 eigenvector，所以只要比較它們沿這個方向的增益 $m$。`,
          },
          kqStep(sigmaV, Kq),
          {
            tex: String.raw`K_q^2N=${sq(Kq)}\times${texInt(N)}=${par(texNum(Kq * Kq))}\times${texInt(N)}=${texNum(kq2N)}\ \mathrm{fs}^{-2}`,
            why: String.raw`變異公式的共同分母（平方一次、乘一次）。$K_q$ 只影響雜訊的大小，不影響 pole（$\mathbf A=\mathbf I+\mathbf M\mathbf J$ 與 $K_q$ 無關）。`,
          },
          {
            // 三種更新矩陣的「m、p」這一步都排成兩行（m 一行、p 一行，對齊等號）：寫成一行時 Regularized 那一步在桌機的正文欄也放不下
            tex: String.raw`\begin{aligned}\text{一般 LMS：}\quad m_{\mathrm s}&=\mu K_q=${tx(muKq)}\\p_{\mathrm s}&=1-m_{\mathrm s}\lambda_{\min}=1-${tx(muKq)}\times${tx(lmin)}=1-${tx(muKq * lmin, 7)}=${tx(s.p, 7)}\end{aligned}`,
            why: String.raw`$\mathbf M=\mu\mathbf I$：每個方向的增益都是 $\mu K_q$，完全不看 $\mathbf R$（F-10.3）。`,
          },
          {
            tex: k95Tex(String.raw`k_{95,\mathrm s}`, s.p, s.k),
            why: String.raw`F-10.5：兩個 $\ln$ 各按一次計算機（$\ln0.05=-2.9957$ 可以背下來）、除一次、無條件進位（分解步驟見 HC-10.2）。`,
          },
          {
            tex: gapTex('s', s),
            why: String.raw`變異公式分母裡的 $1-p^2$。$p$ 很接近 1 時直接「平方再用 1 去減」會損失有效位數，所以拆成 $(1-p)(1+p)$：一次減法、一次加法、一次乘法。`,
          },
          {
            tex: varTex(String.raw`\operatorname{Var}_{\mathrm s}`, 's', s),
            why: String.raw`F-10.7：分子 $m^2\lambda_{\min}$（平方一次、乘一次），分母 $K_q^2N$ 乘上剛才的 $1-p^2$，最後相除。`,
          },
          {
            tex: String.raw`\begin{aligned}\text{完整反矩陣：}\quad m_{\mathrm f}&=\frac{\gamma}{\lambda_{\min}}=\frac{${tx(gamma)}}{${tx(lmin)}}=${tx(f.m)}\\p_{\mathrm f}&=1-m_{\mathrm f}\lambda_{\min}=1-\gamma=1-${tx(gamma)}=${tx(f.p, 7)}\end{aligned}`,
            why: String.raw`$\mathbf M=\gamma(K_q\mathbf R)^{-1}$：把弱方向的增益放大 $1/\lambda_{\min}$ 倍，使每個方向的 loop gain 都是 $\gamma$（F-10.4）；$m_{\mathrm f}\lambda_{\min}=\gamma$ 剛好約掉，不必再乘一次。`,
          },
          {
            tex: k95Tex(String.raw`k_{95,\mathrm f}`, f.p, f.k),
            why: String.raw`與 $\rho$ 無關：沒有慢模式了。`,
          },
          {
            tex: gapTex('f', f),
            why: String.raw`$p_{\mathrm f}=1-\gamma$，所以 $1-p_{\mathrm f}^2=\gamma(2-\gamma)$——這就是 F-10.6 分母裡 $(2-\gamma)$ 的來源。`,
          },
          {
            tex: varTex(String.raw`\operatorname{Var}_{\mathrm f}`, 'f', f),
            why: String.raw`同一個公式代 $m_{\mathrm f}$；化簡後就是 F-10.6 的 $\gamma/\big(K_q^2N\lambda_{\min}(2-\gamma)\big)$。$m^2$ 讓雜訊隨增益的平方成長。`,
          },
          {
            tex: String.raw`\begin{aligned}\text{Regularized：}\quad m_{\mathrm r}&=\frac{\gamma}{\lambda_{\min}+\lambda_{\mathrm{reg}}}=\frac{${tx(gamma)}}{${tx(lmin)}+${tx(lamReg)}}=\frac{${tx(gamma)}}{${tx(lmin + lamReg)}}=${tx(r.m, 7)}\\p_{\mathrm r}&=1-m_{\mathrm r}\lambda_{\min}=1-${tx(r.m, 7)}\times${tx(lmin)}=1-${tx(r.m * lmin, 7)}=${tx(r.p, 7)}\end{aligned}`,
            why: String.raw`$\mathbf M=\gamma\big(K_q(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}$：分母多了 $\lambda_{\mathrm{reg}}$，弱方向的增益不再被放大到 $1/\lambda_{\min}$（F-10.8）。$m_{\mathrm r}$ 多留幾位：$p_{\mathrm r}$ 離 1 多遠決定了後面的 $k_{95}$ 與變異。`,
          },
          {
            tex: k95Tex(String.raw`k_{95,\mathrm r}`, r.p, r.k),
            why: '比完整反矩陣慢，但比一般 LMS 快得多。',
          },
          {
            tex: gapTex('r', r),
            why: String.raw`同樣拆成 $(1-p)(1+p)$ 再相乘。`,
          },
          {
            tex: varTex(String.raw`\operatorname{Var}_{\mathrm r}`, 'r', r),
            why: String.raw`同一個公式代 $m_{\mathrm r}$：用一點速度換回大部分的雜訊。`,
          },
        ],
        results: [
          { symbol: String.raw`k_{95,\mathrm s}`, label: '一般 LMS 的 block 數', value: s.k, unit: String.raw`\text{blocks}`, digits: 7, tolerance: BLOCK_TOL },
          { symbol: String.raw`k_{95,\mathrm f}`, label: '完整反矩陣的 block 數', value: f.k, unit: String.raw`\text{blocks}`, digits: 7, tolerance: BLOCK_TOL },
          { symbol: String.raw`k_{95,\mathrm r}`, label: 'Regularized 的 block 數', value: r.k, unit: String.raw`\text{blocks}`, digits: 7, tolerance: BLOCK_TOL },
          { symbol: String.raw`\operatorname{Var}_{\mathrm s}(\xi_{\text{slow}})`, label: '一般 LMS 的慢模式變異', value: s.v, unit: String.raw`\mathrm{fs}^2`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\operatorname{Var}_{\mathrm f}(\xi_{\text{slow}})`, label: '完整反矩陣的慢模式變異', value: f.v, unit: String.raw`\mathrm{fs}^2`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\operatorname{Var}_{\mathrm r}(\xi_{\text{slow}})`, label: 'Regularized 的慢模式變異', value: r.v, unit: String.raw`\mathrm{fs}^2`, tolerance: { rel: 0.02 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`建議在紙上畫一張 $3\times4$ 的表：列是三種更新矩陣，欄是 $m$、$p$、$k_{95}$、$\operatorname{Var}$；每一列都是同樣的三個公式，只有 $m$ 不同。`,
      String.raw`$1-p^2$ 在 $p$ 很接近 1 時會損失有效位數：$p=0.995$ 時請算成 $(1-p)(1+p)=0.005\times1.995=0.009975$。`,
      String.raw`範例數字（$\rho=0.99$、$\mu K_q=\gamma=0.5$、$\lambda_{\mathrm{reg}}=0.1$、$N=4096$、$\sigma_v=100\ \mathrm{fs}$）的答案：$k_{95}=598$／$5$／$65$（測試 T11），慢模式變異 $0.9611$／$127.83$／$8.918\ \mathrm{fs}^2$（§10.4 的表格）。`,
      String.raw`畫面上寫不完的中間值四捨五入到 5 位有效數字（$p$ 與 $1\pm p$ 留 7 位）；用它們接著算，最後一位可能差 1。$k_{95}$ 接近整數邊界時（例如 $\lceil 64.99\rceil$ 對 $\lceil 65.01\rceil$）請多留幾位再進位。`,
    ],
  },
]

/** 依 id 取出本章的手算題（章內各節放置 <HandCalc> 時使用）；id 打錯會在載入時立刻丟錯，不會靜靜地少一題。 */
export function handcalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Ch10 沒有手算題 ${id}`)
  return def
}
