import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import { normCdf, normPdf } from '@/simulation/core'
import {
  accumulatorBits,
  eig2,
  floorTol,
  hysteresisStats,
  inverseDesign,
  kalmanSteady,
  liftedDualLoop,
  nearIntegerAsymptote,
  nearIntegerKeepOut,
  optimalTrackingGain,
  quasiStaticPole,
  regularizedPreconditioner,
  sigmaW2Colored,
  windowLambdaMin,
  worstCaseAccumulate,
  worstCaseSafeCount,
  zohAutocorr,
} from './model'

/**
 * Research Backlog（/roadmap）的「帶入手算」題。題號跟著研究項目走：HC-RM.n ↔ Rn 的數學預覽，放在該預覽的推導正後方。
 *
 *  - 只收「這一頁才有的公式」。R3（一階 EF quantizer 的週期、v/y/r 表、譜線）在第 13 章已有 HC-13.3／13.5／13.6，
 *    所以沒有 HC-RM.3；SSPLL 的手算題在案例頁（HC-CS.1 – HC-CS.8）。R9 與第 4 章 HC-04.6（需要幾個 bit）互補：
 *    這裡算的是「第幾筆溢位、wrap 與 saturate 各存到多少」。
 *  - solve() 的「答案」一律呼叫 model.ts 的實際函式（頁面的實驗與圖表用的是同一批函式）；步驟裡的中間量只是把
 *    那個函式的算式拆成紙筆＋工程計算機做得到的一步一個運算。handcalcs.test.tsx 逐題以獨立重算比對，並把每一步的
 *    TeX 重新求值：同一步裡每個「全是數字」的等號段都必須算出同一個數。
 *  - 每一步的 tex 都是「符號式 = 代入數字 =（中間結果 =）結果」，每個等號只做一種運算；需要 √、ln、eˣ、tanh、Φ 的
 *    步驟在 why 或 tips 說明怎麼按計算機、可以用哪個近似與它的適用範圍。
 *  - inputs 的 default 是各預覽 worked example 的數字（T13：σ_v = 100 fs、N = 4096、μ = 10 fs；T18：σ = 3、1；
 *    §8.4：r_s = 0.8、b_s = 0.2、μ = 1.2；golden negative test：6-bit × 4096、17-bit）。
 *  - validate 擋掉模型不適用的輸入並解釋原因；practice 範圍內的每一種組合都合法。
 * 極性：δw = w − w*（勘誤 E33）；R7、R8 沿用各自預覽的定義。
 */

const r = String.raw
const PAGE = '/roadmap'

/** 中間值：5 位有效數字（去尾零；極大極小用 a×10^b） */
const n = (x: number, sig = 5): string => texNum(x, sig)
/** 乘數、加數：負數加括號 */
const np = (x: number, sig = 5): string => texNumP(x, sig)
/** 底數（後面接 ^2、^{N}）：負數或科學記號加括號，避免 KaTeX 的 double superscript 與 −0.3² 的歧義 */
const nb = (x: number, sig = 5): string => {
  const t = texNum(x, sig)
  return x < 0 || t.includes('^') ? `(${t})` : t
}
/** 使用者輸入的數字：照原樣顯示（最多 10 位有效數字），不被四捨五入成 5 位 */
const u = (x: number): string => n(x, 10)
const up = (x: number): string => np(x, 10)
const ub = (x: number): string => nb(x, 10)
/** 整數：每一位都寫出來（131072 不可顯示成 131070 或 1.3107×10⁵） */
const ni = (k: number): string => (Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12))

/**
 * 相減（或正負相加）時，運算元要顯示幾位有效數字，畫面上的「a − b = 結果」才對得起來：
 * 讓結果仍保有 5 位有效數字（最多 12 位）。沒有抵銷時就是 5。
 */
function sigSub(result: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  const a = Math.abs(result)
  if (!Number.isFinite(scale) || a === 0 || !(scale > a)) return 5
  const lost = Math.log10(scale / a) // 相減吃掉幾位有效數字
  return lost < 0.31 ? 5 : Math.min(12, 5 + Math.ceil(lost)) // 抵銷不到 2 倍時 5 位就夠
}

/**
 * ⌊x⌋ 裡的 x 要顯示幾位：位數不夠時 195.99996 會被顯示成 196（畫面變成「⌊196⌋ = 195」），
 * 2114.03 會被顯示成 2114（看不出它不是整數）。逐步加位數，直到取整正確、而且非整數看得到小數部分。
 */
function floorArg(x: number): string {
  for (let sig = 5; sig < 15; sig++) {
    const shown = Number(x.toPrecision(sig))
    if (Math.floor(shown) === Math.floor(x) && Number.isInteger(shown) === Number.isInteger(x)) return texNum(x, sig)
  }
  return texNum(x, 15)
}

/** √(2/π)：Gaussian comparator 的 K_q·σ_v */
const KQ1 = Math.sqrt(2 / Math.PI)
/** √(2π)：標準常態 PDF 的分母 */
const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** (approx − exact)/|exact| 的百分比（TeX） */
function pctTex(approx: number, exact: number): string {
  const p = (100 * (approx - exact)) / Math.abs(exact)
  return `${p >= 0 ? '+' : ''}${texNum(p, 3)}\\%`
}

/** T13 的設計點（σ_v = 100 fs、N = 4096、μ = 10 fs）：提示裡的對照數字由同一批函式算出，不手寫。 */
const T13 = (() => {
  const K = KQ1 / 100
  const p = 1 - 10 * K
  const sigmaEta2 = 1 / 4096
  return { K, p, sigmaW: Math.sqrt(sigmaW2Colored({ p, mu: 10, sigmaEta2, rho: 0 })), sigmaY: Math.sqrt(sigmaEta2 / (K * K)) }
})()

/** 規格 §8.4（T09）的數字在 N = 1、2、16 時的 spectral radius（HC-RM.7 的提示與 R7 預覽的「先算一次」表共用）。 */
export const R7_EXAMPLE = { r: 0.8, b: 0.2, c: 1, mu: 1.2 }
export const r7Rho = (N: number): number => eig2(liftedDualLoop({ ...R7_EXAMPLE, N })).rho

/** HC-RM.6：Φ(z) 的兩項級數近似 ½ + φ(0)·(z − z³/6) 的適用範圍（|z| ≤ PHI_SERIES_ZMAX 時絕對誤差 < 4×10⁻⁴；測試會驗證）。 */
export const PHI_SERIES_ZMAX = 0.5
export const phiSeries = (z: number): number => 0.5 + (z - (z * z * z) / 6) / SQRT_2PI
/** HC-RM.6：查表的 Φ 只有 4–5 位小數，z 再大時 c = 1 − Φ(z) 就剩不到 3 位有效數字 */
export const HYST_ZMAX = 3
/** HC-RM.8：σ_ζ²/σ_y² 超過這個倍數時，g* 的分子 s − σ_ζ² 是兩個幾乎相等的數相減（吃掉 1.7 位以上的有效數字；測試會驗證） */
export const TRACK_RATIO_MAX = 100
/**
 * HC-RM.10：y ≤ TANH_SERIES_YMAX 時 tanh(y) 與 y 的前幾位完全相同，5 位計算機按 tanh 再相除只會得到 1；
 * 這個範圍改用泰勒展開 tanh(y)/y ≈ 1 − y²/3（誤差 < 1.4×10⁻⁵，在顯示位數之內；測試會驗證）。
 */
export const TANH_SERIES_YMAX = 0.1

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────── HC-RM.1：R1 有色 GMAC 雜訊（F-R1.1） ─────────────────────────
  {
    id: 'HC-RM.1',
    title: r`R1：相鄰 block 的 GMAC 雜訊有相關 $\rho$ 時，$\sigma_w$ 變成多少？`,
    page: PAGE,
    formulaId: 'F-R1.1',
    formulaTex: r`K=\frac{\sqrt{2/\pi}}{\sigma_v},\quad p=1-\mu K,\quad \sigma_\eta^2=\frac1N,\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{1+p\rho}{1-p\rho}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: r`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: r`\mathrm{samples}`, default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'mu', symbol: r`\mu`, label: '步長', unit: r`\mathrm{fs}`, default: 10, min: 0, max: 100000, practice: { choices: [5, 10, 20] } },
      { key: 'rho', symbol: r`\rho`, label: '相鄰 block 的 GMAC 雜訊相關係數', default: 0.5, min: -1, max: 1, practice: { choices: [-0.5, -0.25, 0.25, 0.5, 0.8] } },
    ],
    validate: ({ sigmaV, mu, rho }) => {
      if (Math.abs(rho) >= 1)
        return r`$|\rho|=${u(Math.abs(rho))}\ge1$：AR(1) 雜訊 $\eta_{k+1}=\rho\,\eta_k+\sqrt{1-\rho^2}\,\sigma_\eta\xi_k$ 不平穩——$|\rho|=1$ 時它不會忘記過去：$\rho=1$ 是固定不變的 offset（造成 bias）、$\rho=-1$ 是每個 block 反號的 tone，都不是會被平均掉的雜訊，$R_\eta[\ell]=\sigma_\eta^2\rho^{|\ell|}$ 的模型不適用。請選 $|\rho|<1$。`
      const K = KQ1 / sigmaV
      const g = mu * K
      if (g <= 0) return r`$\mu=0$：係數完全不更新（$g=\mu K=0$、$p=1$），$\sigma_w^2$ 的分母 $1-p^2=0$——沒有「收斂後的抖動」可算。請給一個大於 0 的 $\mu$。`
      if (g >= 2)
        return r`$g=\mu K=${n(g)}\ge2$：校正迴路的 pole $p=1-g=${n(1 - g)}$ 落在單位圓上或圓外（$|p|\ge1$），雜訊會被無限累積，沒有穩態 $\sigma_w$。請把 $\mu$ 降到 $2/K=${n(2 / K)}$ fs 以下。`
      return null
    },
    solve: ({ sigmaV, N, mu, rho }) => {
      const K = KQ1 / sigmaV
      const g = mu * K
      const p = 1 - g
      const sEta2 = 1 / N
      const white = sigmaW2Colored({ p, mu, sigmaEta2: sEta2, rho: 0 })
      const colored = sigmaW2Colored({ p, mu, sigmaEta2: sEta2, rho })
      const F = colored / white
      const pr = p * rho
      const p2 = p * p
      const oneMinusP2 = 1 - p2
      const drive = mu * mu * sEta2
      const kP = sigSub(p, 1, g)
      const kP2 = sigSub(oneMinusP2, 1, p2)
      const kF = Math.max(sigSub(1 + pr, 1, pr), sigSub(1 - pr, 1, pr))
      const sw = Math.sqrt(colored)
      return {
        steps: [
          {
            tex: r`K=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${n(KQ1)}}{${u(sigmaV)}}=${n(K)}\ \mathrm{fs^{-1}}`,
            why: r`Gaussian comparator 的小訊號增益（第 5 章），這裡取 $C=1$。常數 $\sqrt{2/\pi}$：$2\div\pi=0.63662$，再開根號得 $0.79788$。`,
          },
          { tex: r`g=\mu K=${u(mu)}\times${n(K)}=${n(g)}`, why: r`無因次的迴路增益（$\mathrm{fs}\times\mathrm{fs^{-1}}$，單位消掉）。` },
          { tex: r`p=1-g=1-${n(g, kP)}=${n(p)}`, why: r`校正迴路的 pole；$|p|<1$ 才有穩態。` },
          { tex: r`\sigma_\eta^2=\frac1N=\frac{1}{${ni(N)}}=${n(sEta2)}`, why: r`average-mode sign-GMAC：$N$ 個 $\pm1$ 平均後的變異數。` },
          { tex: r`1-p^2=1-${nb(p, kP2)}^2=1-${n(p2, kP2)}=${n(oneMinusP2)}`, why: '分母：先平方、再用 1 去減。' },
          { tex: r`\mu^2\sigma_\eta^2=${ub(mu)}^2\times${n(sEta2)}=${n(mu * mu, 10)}\times${n(sEta2)}=${n(drive)}\ \mathrm{fs^2}`, why: '分子：每個 block 注入的雜訊功率。' },
          {
            tex: r`\sigma_{w,\mathrm{white}}^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{${n(drive)}}{${n(oneMinusP2)}}=${n(white)}\ \mathrm{fs^2}`,
            why: r`白雜訊（$\rho=0$）的結果，就是第 12 章的 $\sigma_w^2$。`,
          },
          { tex: r`p\rho=${np(p)}\times${up(rho)}=${n(pr)}`, why: r`相關的影響只透過乘積 $p\rho$。` },
          {
            tex: r`\frac{1+p\rho}{1-p\rho}=\frac{1+${np(pr, kF)}}{1-${np(pr, kF)}}=\frac{${n(1 + pr)}}{${n(1 - pr)}}=${n(F)}`,
            why: r`放大因子：$p\rho>0$ 時大於 1，$p\rho<0$ 時小於 1。`,
          },
          {
            tex: r`\sigma_w^2=\sigma_{w,\mathrm{white}}^2\times\frac{1+p\rho}{1-p\rho}=${n(white)}\times${n(F)}=${n(colored)}\ \mathrm{fs^2}`,
            why: '白雜訊的結果乘上放大因子（F-R1.1）。',
          },
          { tex: r`\sigma_w=\sqrt{\sigma_w^2}=\sqrt{${n(colored)}}=${n(sw)}\ \mathrm{fs}`, why: r`開根號（計算機的 $\sqrt{x}$ 鍵）得到 RMS。` },
        ],
        results: [
          { symbol: 'p', label: '校正 pole', value: p },
          { symbol: r`\tfrac{1+p\rho}{1-p\rho}`, label: '放大因子', value: F },
          { symbol: r`\sigma_w`, label: '係數雜訊 RMS', value: sw, unit: r`\mathrm{fs}` },
        ],
        notes: [
          r`白雜訊時 $\sigma_w=${n(Math.sqrt(white))}$ fs；現在是它的 $\sqrt{${n(F)}}=${n(Math.sqrt(F))}$ 倍。`,
          r`這是 gain-equivalent 的係數雜訊，不是 output jitter。`,
        ],
      }
    },
    tips: [
      r`預設值是 T13 的設計點再加上 $\rho=0.5$：$K=${n(T13.K)}\ \mathrm{fs^{-1}}$、$p=${n(T13.p)}$；把 $\rho$ 設成 0 就回到第 12 章的 $${n(T13.sigmaW, 4)}$ fs。`,
      r`$p\to1$（迴路很慢）時放大因子趨近 $\tfrac{1+\rho}{1-\rho}$：$\rho=0.5$ 最多放大 3 倍（$\sigma_w$ 放大 $\sqrt3$ 倍）。`,
      r`中間值留 5 位有效數字，最後才四捨五入；$1-p^2$ 是兩個接近的數相減，$p$ 至少要留 5 位。`,
    ],
  },

  // ───────────────────────── HC-RM.2：R2 ZOH 係數的時間平均自相關（F-R2.2 的第二個因子） ─────────────────────────
  {
    id: 'HC-RM.2',
    title: r`R2：係數保持 $N$ 個 sample 不變時，相隔 $m$ 個 sample 的平均相關`,
    page: PAGE,
    formulaId: 'F-R2.2',
    formulaTex: r`\bar R_{\delta t}[m]=\bar R_x[m]\cdot\bar R_w[m]\ \ (\gcd(P,N)=1),\qquad \frac{\bar R_w[m]}{\sigma_w^2}=\Big(1-\frac{m'}{N}\Big)p^{q}+\frac{m'}{N}\,p^{q+1},\quad m=qN+m',\ 0\le m'<N`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'p', symbol: 'p', label: '相鄰 block 的係數相關（校正 pole）', default: 0.6, min: -1, max: 1, practice: { choices: [0.5, 0.6, 0.8, 0.9] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: r`\mathrm{samples}`, default: 16, min: 1, max: 65536, integer: true, practice: { choices: [4, 8, 16] } },
      { key: 'm', symbol: 'm', label: '時間差（lag）', unit: r`\mathrm{samples}`, default: 20, min: 0, max: 1000000, integer: true, practice: { min: 1, max: 14, step: 1 } },
    ],
    validate: ({ p }) =>
      Math.abs(p) >= 1
        ? r`$|p|=${u(Math.abs(p))}\ge1$：block-rate 的係數誤差 $\delta w_{k+1}=p\,\delta w_k+\mu\eta_k$ 不平穩（校正迴路不穩定或不更新），$\sigma_w^2$ 不存在，「相隔 $\ell$ 個 block 的相關是 $p^{|\ell|}$」也就不成立。請選 $|p|<1$。`
        : null,
    solve: ({ p, N, m }) => {
      const q = Math.floor(m / N)
      const mp = m - q * N
      const pq = Math.pow(p, q)
      const pq1 = Math.pow(p, q + 1)
      const frac = mp / N
      const t1 = (1 - frac) * pq
      const t2 = frac * pq1
      const R = zohAutocorr(p, N, m)
      const kR = sigSub(R, t1, t2)
      return {
        steps: [
          {
            tex: r`q=\Big\lfloor\frac mN\Big\rfloor=\Big\lfloor\frac{${ni(m)}}{${ni(N)}}\Big\rfloor=\lfloor${floorArg(m / N)}\rfloor=${ni(q)}`,
            why: r`$m$ 個 sample 至少跨過 $q$ 個完整的 block（整數除法的商）。`,
          },
          { tex: r`m'=m-qN=${ni(m)}-${ni(q)}\times${ni(N)}=${ni(m)}-${ni(q * N)}=${ni(mp)}`, why: '餘下不滿一個 block 的部分（餘數）。' },
          {
            tex: r`p^{q}=${ub(p)}^{${ni(q)}}=${n(pq)}`,
            why: q === 0 ? r`$q=0$：任何數的 0 次方是 1（同一個 block 內完全相關）。` : r`起點落在 block 的前段（$N-m'$ 個位置）時只跨 $q$ 個邊界：把 $p$ 連乘 $q$ 次。`,
          },
          { tex: r`p^{q+1}=${ub(p)}^{${ni(q + 1)}}=${n(pq1)}`, why: r`起點落在 block 的後段（$m'$ 個位置）時多跨一個邊界：再多乘一次 $p$。` },
          { tex: r`\frac{m'}{N}=\frac{${ni(mp)}}{${ni(N)}}=${n(frac)}`, why: '「多跨一個邊界」的起點佔多少比例（起點在一個 block 內均勻分布）。' },
          { tex: r`\Big(1-\frac{m'}{N}\Big)p^{q}=(1-${n(frac)})\times${np(pq)}=${n(1 - frac)}\times${np(pq)}=${n(t1)}`, why: '前段的起點：比例乘上相關。' },
          { tex: r`\frac{m'}{N}\,p^{q+1}=${n(frac)}\times${np(pq1)}=${n(t2)}`, why: '後段的起點。' },
          { tex: r`\frac{\bar R_w[m]}{\sigma_w^2}=${n(t1, kR)}+${np(t2, kR)}=${n(R)}`, why: '兩種情況按比例相加。' },
        ],
        results: [
          { symbol: 'q', label: '跨過的完整 block 數', value: q, digits: 12, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: "m'", label: '餘下的 sample 數', value: mp, digits: 12, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: r`\bar R_w[m]/\sigma_w^2`, label: '正規化的時間平均自相關', value: R, tolerance: { abs: 2e-3, rel: 0.01 } },
        ],
        notes: [
          p > 0
            ? r`它在兩個整數 block 之間是直線內插，不是指數 $p^{m/N}=${n(Math.pow(p, m / N))}$：係數在 block 內保持不變（ZOH），頻譜因此多出 Fejér（$\mathrm{sinc}^2$ 形）權重（第 12 章，勘誤 E09）。`
            : r`$p\le0$ 時相鄰 block 反號相關（或不相關），$\bar R_w[m]$ 在整數 block 之間仍是直線內插。`,
          r`$\gcd(P,N)=1$ 時把它乘上 code 的 $\bar R_x[m]$ 就是 $\bar R_{\delta t}[m]$（F-R2.2）；$\gcd>1$ 時這個乘積只是近似，要用預覽實驗的精確式。`,
        ],
      }
    },
    tips: [
      r`$m<N$ 時 $q=0$：$\bar R_w[m]/\sigma_w^2=1-\tfrac mN(1-p)$，一條從 1 往下的直線。`,
      r`預設值（$p=0.6$、$N=16$、$m=20$）：$q=1$、$m'=4$，答案 $0.75\times0.6+0.25\times0.36=0.54$；預覽實驗的指標「ZOH 的 $\bar R_w[m]$：逐點平均 vs 封閉式」驗的就是這條公式。`,
      r`$p^q$ 用連乘（$0.6^3=0.6\times0.6\times0.6$）或計算機的 $x^y$ 鍵。`,
    ],
  },

  // ───────────────────────── HC-RM.4：R4 regularized preconditioner（F-R4.1） ─────────────────────────
  {
    id: 'HC-RM.4',
    title: r`R4：正則化 $\varepsilon$ 讓強、弱兩個方向的 pole 與雜訊各變成多少？`,
    page: PAGE,
    formulaId: 'F-R4.1',
    formulaTex: r`p_i=1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\varepsilon},\qquad b_i=\frac{\gamma\sigma_i}{\sigma_i^2+\varepsilon},\qquad \mathrm{Var}_i=\frac{b_i^2\,\sigma_\eta^2}{1-p_i^2},\quad \sigma_\eta^2=\frac1N`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 's1', symbol: r`\sigma_1`, label: '強方向的 singular value', default: 3, min: 0.001, max: 1000, practice: { choices: [2, 3, 4] } },
      { key: 's2', symbol: r`\sigma_2`, label: '弱方向的 singular value', default: 1, min: 0, max: 1000, practice: { choices: [0.1, 0.5, 1] } },
      { key: 'gamma', symbol: r`\gamma`, label: '收斂因子', default: 0.5, min: 0, max: 2, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'eps', symbol: r`\varepsilon`, label: '正則化參數', default: 0.1, min: 0, max: 1000, practice: { choices: [0.01, 0.1, 0.25, 1] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: r`\mathrm{samples}`, default: 64, min: 1, max: 1048576, integer: true, practice: { choices: [16, 64, 256] } },
    ],
    validate: ({ s1, s2, gamma }) => {
      if (s2 <= 1e-12 * s1)
        return r`$\sigma_2=${u(s2)}$（相對於 $\sigma_1$ 等於 0）：這個方向不可辨識——GMAC 對它完全沒有反應，pole 是 1（不收斂、也不被雜訊推動）。$\varepsilon$ 與 $\gamma$ 都救不回缺少的資訊，要改 regressor 或 training sequence（R5）。請給一個大於 0 的 $\sigma_2$。`
      if (s2 > s1) return r`請讓 $\sigma_1\ge\sigma_2$（$\sigma_1$ 是強方向、$\sigma_2$ 是弱方向）；把兩個數字對調即可，答案只是換個編號。`
      if (!(gamma > 0 && gamma < 2))
        return r`$\gamma=${u(gamma)}$ 不在 $(0,2)$：$\varepsilon\ll\sigma_i^2$ 的方向 pole 趨近 $1-\gamma$，$\gamma\ge2$ 時它 $\le-1$（發散）、$\gamma=0$ 時不更新（pole 為 1），$\mathrm{Var}_i$ 的分母 $1-p_i^2$ 不是正數。請選 $0<\gamma<2$。`
      return null
    },
    solve: ({ s1, s2, gamma, eps, N }) => {
      // 對角 J 的 singular values 就是 |對角元素|；regularizedPreconditioner 依 σ 由大到小排列
      const res = regularizedPreconditioner({
        J: [
          [-s1, 0],
          [0, -s2],
        ],
        gamma,
        eps,
        sigmaEta2: 1 / N,
      })
      const steps: HandCalcStep[] = []
      const mode = (i: 1 | 2, s: number, p: number, v: number) => {
        const s2e = s * s + eps
        const ratio = (s * s) / s2e
        const gr = gamma * ratio
        const b = (gamma * s) / s2e
        const b2N = (b * b) / N
        const kP = sigSub(p, 1, gr)
        const kV = sigSub(1 - p * p, 1, p * p)
        steps.push(
          {
            tex: r`\sigma_${i}^2+\varepsilon=${ub(s)}^2+${u(eps)}=${n(s * s, 10)}+${u(eps)}=${n(s2e, 10)}`,
            why: i === 1 ? '強方向：先算分母（平方、再加上正則化）。' : '弱方向：同樣的五步。',
          },
          {
            tex: r`p_${i}=1-\gamma\frac{\sigma_${i}^2}{\sigma_${i}^2+\varepsilon}=1-${u(gamma)}\times\frac{${n(s * s, 10)}}{${n(s2e, 10)}}=1-${u(gamma)}\times${n(ratio, kP)}=1-${n(gr, kP)}=${n(p)}`,
            why: r`這個方向的 pole：$\varepsilon\ll\sigma_i^2$ 時 $\approx1-\gamma$；$\varepsilon\gg\sigma_i^2$ 時趨近 1（變慢）。`,
          },
          {
            tex: r`b_${i}=\frac{\gamma\sigma_${i}}{\sigma_${i}^2+\varepsilon}=\frac{${u(gamma)}\times${u(s)}}{${n(s2e, 10)}}=\frac{${n(gamma * s, 10)}}{${n(s2e, 10)}}=${n(b)}`,
            why: r`GMAC 雜訊進到這個方向的增益；$\varepsilon=0$ 時是 $\gamma/\sigma_i$，弱方向會很大。`,
          },
          { tex: r`b_${i}^2\sigma_\eta^2=\frac{b_${i}^2}{N}=\frac{${nb(b)}^2}{${ni(N)}}=\frac{${n(b * b)}}{${ni(N)}}=${n(b2N)}`, why: '每個 block 注入這個方向的雜訊功率（先平方、再除以 $N$）。' },
          {
            tex: r`\mathrm{Var}_${i}=\frac{b_${i}^2\sigma_\eta^2}{1-p_${i}^2}=\frac{${n(b2N)}}{1-${nb(p, kV)}^2}=\frac{${n(b2N)}}{1-${n(p * p, kV)}}=\frac{${n(b2N)}}{${n(1 - p * p)}}=${n(v)}`,
            why: r`每個方向都是純量 AR(1)，和 R1 的白雜訊公式同一個形狀：$b^2\sigma_\eta^2/(1-p^2)$。`,
          },
        )
      }
      mode(1, s1, res.poles[0], res.modeVar[0])
      mode(2, s2, res.poles[1], res.modeVar[1])
      steps.push({
        tex: r`E\|\delta\mathbf w\|^2=\mathrm{Var}_1+\mathrm{Var}_2=${n(res.modeVar[0])}+${n(res.modeVar[1])}=${n(res.totalVar)}`,
        why: r`$\mathbf V$ 正交：總變異是兩個方向的和。`,
      })
      return {
        steps,
        results: [
          { symbol: 'p_1', label: '強方向的 pole', value: res.poles[0] },
          { symbol: 'p_2', label: '弱方向的 pole', value: res.poles[1] },
          { symbol: r`\mathrm{Var}_2`, label: '弱方向的穩態變異', value: res.modeVar[1], unit: '[w]^2' },
          { symbol: r`E\|\delta\mathbf w\|^2`, label: '總穩態變異', value: res.totalVar, unit: '[w]^2' },
        ],
        notes: [
          r`弱方向的變異是強方向的 $${n(res.modeVar[1] / res.modeVar[0])}$ 倍；最慢的 pole 是 $${n(res.slowest)}$，95% 收斂約 $${ni(res.settle)}$ 個 block。`,
          r`這是 eigen-mode 的變異，不是第 $i$ 個參數的變異（勘誤 E37）。`,
        ],
      }
    },
    tips: [
      r`預設值是 T18 反例 $\mathbf J=\begin{bmatrix}-1&2\\2&-1\end{bmatrix}$ 的 singular values $3$、$1$：$p_1=1-0.5\times\tfrac{9}{9.1}=0.50549$、$p_2=1-0.5\times\tfrac{1}{1.1}=0.54545$（pole 那一步與第 10 章 HC-10.5 的 J 形式相同；這一題多算的是 $\varepsilon$ 對雜訊的影響）。`,
      r`把 $\varepsilon$ 改成 0 再算一次：兩個 pole 都是 $1-\gamma$，但 $\mathrm{Var}_2/\mathrm{Var}_1=(\sigma_1/\sigma_2)^2$——這就是「收斂 vs 雜訊」的取捨。`,
      r`只有加減乘除與平方；中間值留 5 位有效數字（答案容許 1% 的誤差）。`,
    ],
  },

  // ───────────────────────── HC-RM.5：R5 near-integer keep-out（F-R5.2） ─────────────────────────
  {
    id: 'HC-RM.5',
    title: r`R5：FCW 離整數多近時，$N_0$ 個 sample 的窗口就「看不出」gain 與 offset 的差別？`,
    page: PAGE,
    formulaId: 'F-R5.2',
    formulaTex: r`\mathrm{Var}_{\mathrm{win}}(x)=\frac{\alpha^2(N_0^2-1)}{12},\qquad \lambda_{\min}\approx\frac{\mathrm{Var}_{\mathrm{win}}(x)}{1+\bar x^2}\approx\frac{\alpha^2(N_0^2-1)}{15},\qquad \alpha_{\mathrm{keep}}=\sqrt{\frac{15\,\lambda_t}{N_0^2-1}}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'alpha', symbol: r`\alpha`, label: 'FCW 小數（離整數的距離）', default: 1e-4, min: 1e-7, max: 0.5, practice: { choices: [5e-5, 1e-4, 2e-4, 5e-4] } },
      { key: 'N0', symbol: 'N_0', label: 'PE 窗口長度', unit: r`\mathrm{samples}`, default: 256, min: 4, max: 65536, integer: true, practice: { choices: [64, 128, 256, 512] } },
      { key: 'lt', symbol: r`\lambda_t`, label: '要求的最小 eigenvalue（PE 門檻）', default: 1e-3, min: 1e-9, max: 0.08, practice: { choices: [1e-4, 1e-3, 4e-3] } },
    ],
    validate: ({ alpha, N0, lt }) => {
      if (alpha * N0 > 0.5)
        return r`$\alpha N_0=${n(alpha * N0)}>0.5$：窗口已經涵蓋半個以上的 residue 週期，裡面可能有 wrap，「一條緩坡」的漸近式不適用（請看預覽 B 的數值掃描）。請把 $\alpha$ 或 $N_0$ 調小。`
      const keep = nearIntegerKeepOut(lt, N0)
      if (keep * N0 > 0.5)
        return r`$\lambda_t=${u(lt)}$ 太大：反解出來的 $\alpha_{\mathrm{keep}}=${n(keep)}$ 使 $\alpha_{\mathrm{keep}}N_0=${n(keep * N0)}>0.5$，已經不在「窗口內沒有 wrap」的適用範圍內，漸近式算出的 keep-out 邊界沒有意義（完整 sawtooth 的 $\lambda_{\min}$ 也只有約 $0.08$）。請把 $\lambda_t$ 調小。`
      return null
    },
    solve: ({ alpha, N0, lt }) => {
      const nn = N0 * N0 - 1
      const a2 = alpha * alpha
      const varWin = (a2 * nn) / 12
      const lam = nearIntegerAsymptote(alpha, N0)
      const keep = nearIntegerKeepOut(lt, N0)
      const numeric = windowLambdaMin(alpha, N0, 48).worst
      return {
        steps: [
          { tex: r`N_0^2-1=${ni(N0)}^2-1=${ni(N0 * N0)}-1=${ni(nn)}`, why: r`離散均勻 $\{0,\dots,N_0-1\}$ 的變異數是 $(N_0^2-1)/12$，先把分子算出來。` },
          { tex: r`\alpha^2=${ub(alpha)}^2=${n(a2)}`, why: r`窗口內 residue 是斜率 $\alpha$ 的緩坡 $x[n_0+i]=x_0+i\alpha$，變異數與 $\alpha^2$ 成正比。` },
          {
            tex: r`\mathrm{Var}_{\mathrm{win}}(x)=\frac{\alpha^2(N_0^2-1)}{12}=\frac{${n(a2)}\times${ni(nn)}}{12}=\frac{${n(a2 * nn)}}{12}=${n(varWin)}`,
            why: '窗口內 code 的變異數：這就是 gain 與 offset 兩個方向「分得開」的程度。',
          },
          {
            tex: r`\lambda_{\min}\approx\frac{\mathrm{Var}_{\mathrm{win}}(x)}{1+\bar x^2}=\frac{${n(varWin)}}{1+0.5^2}=\frac{${n(varWin)}}{1.25}=${n(lam)}`,
            why: r`$\lambda_{\min}\approx\det/\mathrm{tr}$（$\det\ll\mathrm{tr}^2$ 時的泰勒一階）；最差的窗口 $\bar x\to\pm\tfrac12$，$\mathrm{tr}\approx1+\tfrac14$。`,
          },
          {
            tex: r`\alpha N_0=${u(alpha)}\times${ni(N0)}=${n(alpha * N0)}`,
            why: r`檢查適用條件：要遠小於 1（窗口內沒有 wrap）。$\alpha N_0\le0.1$ 時漸近式與數值掃描相差 5% 以內；到 0.5 時低估約 15%（偏保守）。`,
          },
          { tex: r`15\lambda_t=15\times${u(lt)}=${n(15 * lt)}`, why: r`反過來問 keep-out：令 $\lambda_{\min}=\lambda_t$，$\alpha^2=15\lambda_t/(N_0^2-1)$。先算分子。` },
          {
            tex: r`\alpha_{\mathrm{keep}}=\sqrt{\frac{15\lambda_t}{N_0^2-1}}=\sqrt{\frac{${n(15 * lt)}}{${ni(nn)}}}=\sqrt{${n((15 * lt) / nn)}}=${n(keep)}`,
            why: r`相除、開根號（計算機的 $\sqrt{x}$ 鍵）：比這個更靠近整數的 FCW 要避開。`,
          },
        ],
        results: [
          { symbol: r`\lambda_{\min}`, label: '最差窗口的最小 eigenvalue（漸近式）', value: lam, tolerance: { rel: 0.02 } },
          { symbol: r`\alpha_{\mathrm{keep}}`, label: 'keep-out 邊界', value: keep, tolerance: { rel: 0.02 } },
        ],
        notes: [
          r`數值掃描（48 個窗口起點，model.ts 的 windowLambdaMin）得到 $${n(numeric)}$，漸近式相差 $${pctTex(lam, numeric)}$。`,
          alpha >= keep ? r`$\alpha\ge\alpha_{\mathrm{keep}}$：這個 FCW 在 keep-out 之外，PE 門檻可以達到。` : r`$\alpha<\alpha_{\mathrm{keep}}$：這個 FCW 在 keep-out 之內，$\lambda_{\min}<\lambda_t$。`,
          r`這是 raw-x 的上限；經 $H_{\mathrm{PD}}$（DC null）觀測時 offset 方向完全看不見（勘誤 E04）。`,
        ],
      }
    },
    tips: [
      r`$\lambda_{\min}\propto\alpha^2$：FCW 離整數近 10 倍，資訊少 100 倍。`,
      r`keep-out 與 $1/N_0$ 成正比：窗口加長 4 倍，keep-out 縮小 4 倍。`,
      r`科學記號的平方：$(10^{-4})^2=10^{-8}$，底數平方、指數乘 2；開根號則指數除以 2。`,
      r`預設值（$\alpha=10^{-4}$、$N_0=256$、$\lambda_t=10^{-3}$）對照預覽 B 的指標表：keep-out 邊界（漸近式）那一列。`,
    ],
  },

  // ───────────────────────── HC-RM.6：R6 遲滯 comparator（F-R6.2 / F-R6.3） ─────────────────────────
  {
    id: 'HC-RM.6',
    title: r`R6：Gaussian 雜訊加上遲滯 $H$：斜率變大，資訊卻變少`,
    page: PAGE,
    formulaId: 'F-R6.3',
    formulaTex: r`z=\frac{H}{2\sigma_v},\quad c=1-\Phi(z),\quad f_v\big(\tfrac H2\big)=\frac{\varphi(z)}{\sigma_v},\qquad \frac{dE[q]}{ds}\Big|_{s=\theta}=\frac{f_v(H/2)}{c},\quad \nu=1-2c,\quad \mathcal I=\frac{f_v(H/2)^2}{c(1-c)}`,
    level: 'research',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: r`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'H', symbol: 'H', label: '遲滯寬度', unit: r`\mathrm{fs}`, default: 100, min: 0, max: 100000, practice: { choices: [0, 50, 100, 200] } },
    ],
    validate: ({ sigmaV, H }) =>
      H / (2 * sigmaV) > HYST_ZMAX
        ? r`$z=H/(2\sigma_v)=${n(H / (2 * sigmaV))}>${HYST_ZMAX}$：翻轉機率 $c=1-\Phi(z)<1.4\times10^{-3}$，comparator 幾乎卡死；查表的 $\Phi$ 只有 4–5 位小數，$c$ 剩不到 3 位有效數字，後面的除法全部不準。請把 $H$ 調小（或把 $\sigma_v$ 調大）。`
        : null,
    solve: ({ sigmaV, H }) => {
      const st = hysteresisStats({ kind: 'gaussian', sigma: sigmaV }, 0, H, 0)
      const z = H / (2 * sigmaV)
      const half = (z * z) / 2
      const ex = Math.exp(-half)
      const phi = normPdf(z)
      const Phi = normCdf(z)
      const c = st.tUp
      const f = phi / sigmaV
      const cc = c * (1 - c)
      const kq2 = (KQ1 * KQ1) / (sigmaV * sigmaV)
      const ratio = st.info / kq2
      // H = 0 時 t₊ + t₋ = 1：double 可能留下 1e-17 的殘渣，手算是 ν = 0
      const nu = Math.abs(st.nu) < 1e-12 ? 0 : st.nu
      const kC = sigSub(c, 1, Phi)
      const kNu = sigSub(nu, 1, 2 * c)
      return {
        steps: [
          { tex: r`z=\frac{H}{2\sigma_v}=\frac{${u(H)}}{2\times${u(sigmaV)}}=\frac{${u(H)}}{${n(2 * sigmaV, 10)}}=${n(z)}`, why: r`上門檻 $\theta+H/2$ 離中心的距離，以 $\sigma_v$ 為單位。` },
          { tex: r`\frac{z^2}{2}=\frac{${nb(z)}^2}{2}=\frac{${n(z * z)}}{2}=${n(half)}`, why: '標準常態 PDF 的指數：先平方、再除以 2。' },
          {
            tex: r`\varphi(z)=\frac{e^{-z^2/2}}{\sqrt{2\pi}}=\frac{e^{-${n(half)}}}{2.5066}=\frac{${n(ex)}}{2.5066}=${n(phi)}`,
            why: r`標準常態的 PDF。計算機：輸入上一步的數、變號、按 $e^x$，再除以 $\sqrt{2\pi}\approx2.5066$。`,
          },
          {
            tex: r`\Phi(z)=\Phi(${n(z)})=${n(Phi)}`,
            why: r`標準常態的 CDF：查常態分布表，或用計算機的 normal CDF（統計模式）。沒有表時 $|z|\le${PHI_SERIES_ZMAX}$ 可用 $\Phi(z)\approx0.5+0.39894\,(z-z^3/6)$，誤差小於 $4\times10^{-4}$。`,
          },
          { tex: r`c=1-\Phi(z)=1-${n(Phi, kC)}=${n(c)}`, why: r`$s=\theta$ 時兩個方向的翻轉機率相同：$t_+=t_-=c$（輸入要越過「對面」的門檻才翻轉）。` },
          { tex: r`f_v\big(\tfrac H2\big)=\frac{\varphi(z)}{\sigma_v}=\frac{${n(phi)}}{${u(sigmaV)}}=${n(f)}\ \mathrm{fs^{-1}}`, why: r`雜訊 PDF 在門檻處的值（變數變換 $v=\sigma_vz$ 多一個 $1/\sigma_v$）。` },
          {
            tex: r`\frac{dE[q]}{ds}\Big|_{s=\theta}=\frac{f_v(H/2)}{c}=\frac{${n(f)}}{${n(c)}}=${n(st.slope)}\ \mathrm{fs^{-1}}`,
            why: r`Markov 平穩分布的斜率（F-R6.2 對 $s$ 微分後代入 $t_+=t_-=c$）。`,
          },
          { tex: r`\nu=1-2c=1-2\times${n(c, kNu)}=1-${n(2 * c, kNu)}=${n(nu)}`, why: r`記憶因子：相鄰兩次決策的相關係數；$H=0$ 時 $c=\tfrac12$、$\nu=0$。` },
          { tex: r`c(1-c)=${n(c)}\times(1-${n(c)})=${n(c)}\times${n(1 - c)}=${n(cc)}`, why: '資訊量的分母。' },
          {
            tex: r`\mathcal I=\frac{f_v(H/2)^2}{c(1-c)}=\frac{${nb(f)}^2}{${n(cc)}}=\frac{${n(f * f)}}{${n(cc)}}=${n(st.info)}\ \mathrm{fs^{-2}}`,
            why: r`斜率平方除以每個 sample 的有效雜訊 $(1-m^2)\tfrac{1+\nu}{1-\nu}$（這裡 $m=0$）：$\tfrac{f^2}{c^2}\cdot\tfrac{c}{1-c}$。`,
          },
          {
            tex: r`K_q^2=\frac{2/\pi}{\sigma_v^2}=\frac{0.63662}{${ub(sigmaV)}^2}=\frac{0.63662}{${n(sigmaV * sigmaV, 10)}}=${n(kq2)}\ \mathrm{fs^{-2}}`,
            why: r`沒有遲滯的 Gaussian comparator 每個 sample 的資訊（第 5 章的 $K_q$ 平方）。`,
          },
          { tex: r`\frac{\mathcal I}{K_q^2}=\frac{${n(st.info)}}{${n(kq2)}}=${n(ratio)}`, why: '相除：遲滯之後還剩幾成資訊。' },
        ],
        results: [
          { symbol: r`dE[q]/ds`, label: '含遲滯的小訊號斜率', value: st.slope, unit: r`\mathrm{fs^{-1}}`, tolerance: { rel: 0.02 } },
          { symbol: r`\nu`, label: '記憶因子', value: nu, tolerance: { abs: 0.01, rel: 0.02 } },
          { symbol: r`\mathcal I/K_q^2`, label: '每 sample 資訊（相對無遲滯）', value: ratio, tolerance: { rel: 0.02 } },
        ],
        notes: [
          r`斜率是 $K_q$ 的 $${n(st.slope / (KQ1 / sigmaV))}$ 倍，但 block 平均的雜訊變異是 iid 時的 $\tfrac{1+\nu}{1-\nu}=${n((1 + nu) / (1 - nu))}$ 倍——淨資訊只剩 $${n(100 * ratio, 3)}\%$。`,
          r`$\mathcal I$ 用到「$N$ 遠大於相關長度 $1/(1-\nu)=${n(1 / (1 - nu))}$」的漸近變異，所以標為近似。`,
        ],
      }
    },
    tips: [
      r`常用值：$\Phi(0.25)=${n(normCdf(0.25))}$、$\Phi(0.5)=${n(normCdf(0.5))}$、$\Phi(1)=${n(normCdf(1))}$、$\Phi(2)=${n(normCdf(2))}$；$\sqrt{2\pi}\approx2.5066$、$1/\sqrt{2\pi}\approx0.39894$。`,
      r`把 $H$ 設成 0：$c=\tfrac12$、$\nu=0$、$\mathcal I/K_q^2=1$，回到第 5 章的一般 comparator。`,
      r`預設值是預覽的 preset「Gaussian + 遲滯 $H=\sigma_v$」：算完對照實驗指標表的「含遲滯的斜率」「記憶因子」「每 sample 資訊」。`,
    ],
  },

  // ───────────────────────── HC-RM.7：R7 多速率 lifting（F-R7.1） ─────────────────────────
  {
    id: 'HC-RM.7',
    title: r`R7：同一個 $\mu$，GMAC 每 $N$ 個 sample 才更新一次，還會發散嗎？`,
    page: PAGE,
    formulaId: 'F-R7.1',
    formulaTex: r`\mathbf A_N=\begin{bmatrix}r_s^N&b_sS_N\\[2pt]-\dfrac{\mu c_sS_N}{N}&1-\mu c_sb_s\dfrac{N-S_N}{N(1-r_s)}\end{bmatrix},\quad S_N=\frac{1-r_s^N}{1-r_s},\qquad \lambda^2-\mathrm{tr}\,\lambda+\det=0`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'r', symbol: 'r_s', label: '觀測狀態的 pole（每 sample）', default: R7_EXAMPLE.r, min: -2, max: 2, practice: { choices: [0.5, 0.6, 0.8] } },
      { key: 'b', symbol: 'b_s', label: '誤差到觀測狀態的增益', default: R7_EXAMPLE.b, min: -5, max: 5, practice: { choices: [0.2, 0.4, 0.5] } },
      { key: 'c', symbol: 'c_s', label: '觀測狀態到 GMAC 的增益', default: R7_EXAMPLE.c, min: -5, max: 5, practice: { choices: [1] } },
      { key: 'mu', symbol: r`\mu`, label: '正規化步長', default: R7_EXAMPLE.mu, min: 0, max: 100, practice: { choices: [0.5, 1, 1.2, 1.5] } },
      { key: 'N', symbol: 'N', label: '每 block 的快迴路 sample 數', unit: r`\mathrm{samples}`, default: 2, min: 1, max: 64, integer: true, practice: { choices: [2, 3, 4] } },
    ],
    validate: ({ r: rs, b, c, mu }) => {
      if (Math.abs(rs) >= 1)
        return r`$|r_s|=${u(Math.abs(rs))}\ge1$：快迴路（觀測狀態 $s_{n+1}=r_ss_n+\dots$）自己就不收斂，等比級數 $S_N$ 的封閉式在 $r_s=1$ 時分母為 0，也沒有「穩態 $s=\tfrac{b_s\delta}{1-r_s}$」可以和 quasi-static 比較。請選 $|r_s|<1$。`
      if (b * c === 0) return r`$b_sc_s=0$：$\delta$ 完全不影響 GMAC（不可觀測），$\mathbf A_N$ 恆有一個 eigenvalue 等於 1，任何 $\mu$ 都只是臨界。請讓 $b_s$、$c_s$ 都不為零。`
      if (mu === 0) return r`$\mu=0$：LMS 不更新，$\mathbf A_N$ 的 eigenvalue 是 $r_s^N$ 與 $1$（臨界），沒有收斂或發散可言。請給一個大於 0 的 $\mu$。`
      return null
    },
    solve: ({ r: rs, b, c, mu, N }) => {
      const P = { r: rs, b, c, mu, N }
      const A = liftedDualLoop(P)
      const { z, rho } = eig2(A)
      const qs = quasiStaticPole(P)
      const rN = Math.pow(rs, N)
      const SN = (1 - rN) / (1 - rs)
      const eff = (N - SN) / (N * (1 - rs))
      const [a11, a12] = A[0]
      const [a21, a22] = A[1]
      const coupling = mu * c * b * eff
      const tr = a11 + a22
      const prodD = a11 * a22
      const prodO = a12 * a21
      const det = prodD - prodO
      const disc = tr * tr - 4 * det
      const kS = sigSub(1 - rN, 1, rN)
      const kE = sigSub(N - SN, N, SN)
      const kA = sigSub(a22, 1, coupling)
      const kT = sigSub(tr, a11, a22)
      const kD = sigSub(det, prodD, prodO)
      const kDisc = sigSub(disc, tr * tr, 4 * det)
      const steps: HandCalcStep[] = [
        { tex: r`a_{11}=r_s^N=${ub(rs)}^{${ni(N)}}=${n(rN)}`, why: r`一個 block（$N$ 步）後，觀測狀態的舊值只剩這麼多：把 $r_s$ 連乘 $N$ 次。` },
        {
          tex: r`S_N=\frac{1-r_s^N}{1-r_s}=\frac{1-${np(rN, kS)}}{1-${up(rs)}}=\frac{${n(1 - rN)}}{${n(1 - rs, 10)}}=${n(SN)}`,
          why: r`等比級數 $1+r_s+\dots+r_s^{N-1}$ 的和。`,
        },
        { tex: r`a_{12}=b_sS_N=${u(b)}\times${n(SN)}=${n(a12)}`, why: r`$\delta$ 在 block 內不變（ZOH），$N$ 步累積的驅動。` },
        {
          tex: r`a_{21}=-\frac{\mu c_sS_N}{N}=-\frac{${u(mu)}\times${up(c)}\times${n(SN)}}{${ni(N)}}=-\frac{${n(mu * c * SN)}}{${ni(N)}}=${n(a21)}`,
          why: r`block 起點的觀測狀態在 GMAC 的平均值裡佔 $S_N/N$。`,
        },
        {
          tex: r`\frac{N-S_N}{N(1-r_s)}=\frac{${ni(N)}-${np(SN, kE)}}{${ni(N)}\times(1-${up(rs)})}=\frac{${n(N - SN)}}{${ni(N)}\times${n(1 - rs, 10)}}=\frac{${n(N - SN)}}{${n(N * (1 - rs), 10)}}=${n(eff)}`,
          why: r`GMAC 平均到的「$\delta$ 的直接貢獻」：$N=1$ 時為 0，$N\to\infty$ 時趨近 $1/(1-r_s)$。`,
        },
        {
          tex: r`a_{22}=1-\mu c_sb_s\,\frac{N-S_N}{N(1-r_s)}=1-${u(mu)}\times${up(c)}\times${up(b)}\times${n(eff, kA)}=1-${np(coupling, kA)}=${n(a22)}`,
          why: 'LMS 自己的那一格：連乘三次，再用 1 去減。',
        },
        { tex: r`\mathrm{tr}=a_{11}+a_{22}=${n(rN, kT)}+${np(a22, kT)}=${n(tr)}`, why: '兩個 eigenvalue 的和。' },
        {
          tex: r`\det=a_{11}a_{22}-a_{12}a_{21}=${n(a11)}\times${np(a22)}-${np(a12)}\times${np(a21)}=${n(prodD, kD)}-${np(prodO, kD)}=${n(det)}`,
          why: '兩個 eigenvalue 的乘積：對角相乘減掉反對角相乘。',
        },
        {
          tex: r`\mathrm{tr}^2-4\det=${nb(tr, kDisc)}^2-4\times${np(det, kDisc)}=${n(tr * tr, kDisc)}-${np(4 * det, kDisc)}=${n(disc)}`,
          why: r`判別式：負的就是一對共軛複數（振盪），非負則是兩個實根。`,
        },
      ]
      if (disc < 0) {
        steps.push({ tex: r`\rho(\mathbf A_N)=|\lambda|=\sqrt{\det}=\sqrt{${n(det)}}=${n(rho)}`, why: r`共軛複數根 $\lambda,\bar\lambda$ 的乘積 $|\lambda|^2$ 等於 $\det$：開根號（計算機的 $\sqrt{x}$ 鍵）。` })
      } else {
        const sq = Math.sqrt(disc)
        const l1 = z[0].re
        const l2 = z[1].re
        const k2 = sigSub(tr - sq, tr, sq)
        steps.push(
          { tex: r`\sqrt{\mathrm{tr}^2-4\det}=\sqrt{${n(disc)}}=${n(sq)}`, why: r`判別式開根號（計算機的 $\sqrt{x}$ 鍵）。` },
          { tex: r`\lambda_1=\frac{\mathrm{tr}+\sqrt{\cdot}}{2}=\frac{${n(tr)}+${n(sq)}}{2}=\frac{${n(tr + sq)}}{2}=${n(l1)}`, why: '二次方程的大根。' },
          { tex: r`\lambda_2=\frac{\mathrm{tr}-\sqrt{\cdot}}{2}=\frac{${n(tr, k2)}-${n(sq, k2)}}{2}=\frac{${n(tr - sq)}}{2}=${n(l2)}`, why: '小根。' },
          {
            tex: r`\rho(\mathbf A_N)=\max(|\lambda_1|,\ |\lambda_2|)=\max(${n(Math.abs(l1))},\ ${n(Math.abs(l2))})=${n(rho)}`,
            why: 'spectral radius 取絕對值較大的那個。',
          },
        )
      }
      const qsRatio = (mu * c * b) / (1 - rs)
      steps.push({
        tex: r`p_{\mathrm{qs}}=1-\frac{\mu c_sb_s}{1-r_s}=1-\frac{${n(mu * c * b, 10)}}{${n(1 - rs, 10)}}=1-${np(qsRatio, sigSub(qs, 1, qsRatio))}=${n(qs)}`,
        why: r`對照：quasi-static（時間尺度分離）近似的 pole。它和 $N$ 無關，所以看不出 $N$ 的影響。`,
      })
      return {
        steps,
        results: [
          { symbol: 'S_N', label: '等比級數和', value: SN },
          { symbol: r`\det\mathbf A_N`, label: 'eigenvalue 的乘積', value: det, tolerance: { abs: 2e-3, rel: 0.01 } },
          { symbol: r`\rho(\mathbf A_N)`, label: 'spectral radius', value: rho },
        ],
        notes: [
          rho < 1 ? r`$\rho(\mathbf A_N)=${n(rho)}<1$：收斂。` : rho > 1 ? r`$\rho(\mathbf A_N)=${n(rho)}>1$：發散。` : r`$\rho(\mathbf A_N)=1$：臨界。`,
          Math.abs(qs) < 1 === rho < 1
            ? r`quasi-static 的 $|p_{\mathrm{qs}}|=${n(Math.abs(qs))}$ 給出相同的結論，但數值不同：真正的收斂速度要看 $\rho(\mathbf A_N)$。`
            : r`quasi-static 的 $|p_{\mathrm{qs}}|=${n(Math.abs(qs))}$ 給出「相反」的結論——時間尺度分離在這組數字下失效。`,
          ...(b * c < 0 ? [r`$b_sc_s<0$：GMAC 的平均斜率反號（polarity 錯誤），正的 $\mu$ 會把 $\delta$ 推離 0。`] : []),
        ],
      }
    },
    tips: [
      r`預設值是規格 §8.4（T09）的 $r_s=0.8$、$b_s=0.2$、$c_s=1$、$\mu=1.2$，但 GMAC 改成每 $N=2$ 個 sample 才更新：$\rho=${n(r7Rho(2))}<1$。把 $N$ 改回 1 就是 T09 的 $\rho=\sqrt{1.04}=${n(r7Rho(1))}$（發散；那個特例的手算在第 8 章 HC-08.7），$N=16$ 時 $\rho=${n(r7Rho(16))}$。`,
      r`$r_s^N$ 用連乘或計算機的 $x^y$ 鍵；$N=1$ 時 $S_N=1$、$\tfrac{N-S_N}{N(1-r_s)}=0$，$\mathbf A_1=\begin{bmatrix}r_s&b_s\\-\mu c_s&1\end{bmatrix}$。`,
      r`判別式為負時不必解複數根：$|\lambda|^2=\lambda\bar\lambda=\det$，直接開根號。`,
    ],
  },

  // ───────────────────────── HC-RM.8：R8 最佳追蹤增益（F-R8.1） ─────────────────────────
  {
    id: 'HC-RM.8',
    title: r`R8：目標每個 block 漂移 $\sigma_\zeta$，固定步長最好設多少？`,
    page: PAGE,
    formulaId: 'F-R8.1',
    formulaTex: r`\sigma_y^2=\frac{1}{NK^2},\quad s=\sqrt{\sigma_\zeta^4+4\sigma_\zeta^2\sigma_y^2},\qquad g^*=\frac{s-\sigma_\zeta^2}{2\sigma_y^2}=\frac{P^-}{P^-+\sigma_y^2},\qquad P^-=\frac{\sigma_\zeta^2+s}{2}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: r`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度', unit: r`\mathrm{samples}`, default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'sz', symbol: r`\sigma_\zeta`, label: '每 block 的漂移 RMS', unit: r`\mathrm{fs}`, default: 0.01, min: 1e-6, max: 1000, practice: { choices: [0.005, 0.01, 0.02, 0.05, 0.1] } },
    ],
    validate: ({ sigmaV, N, sz }) => {
      const K = KQ1 / sigmaV
      const sy2 = 1 / (N * K * K)
      const ratio = (sz * sz) / sy2
      if (ratio > TRACK_RATIO_MAX)
        return r`$\sigma_\zeta^2/\sigma_y^2=${n(ratio)}>${TRACK_RATIO_MAX}$：漂移遠大於量測雜訊，$g^*$ 的分子 $s-\sigma_\zeta^2$ 是兩個幾乎相等的數相減，會吃掉將近 2 位有效數字（5 位只剩 3 位左右可信）。這個區域直接用 $g^*\approx1-\sigma_y^2/\sigma_\zeta^2=${n(1 - 1 / ratio)}$（每個 block 幾乎完全相信新的量測）；要練習這一題請把 $\sigma_\zeta$ 調小或把 $N$ 調小。`
      return null
    },
    solve: ({ sigmaV, N, sz }) => {
      const K = KQ1 / sigmaV
      const K2 = K * K
      const sy2 = 1 / (N * K2)
      const sz2 = sz * sz
      const sz4 = sz2 * sz2
      const four = 4 * sz2 * sy2
      const gStar = optimalTrackingGain(sz2, sy2)
      const kal = kalmanSteady(sz2, sy2)
      const s = Math.sqrt(sz4 + four)
      const muStar = gStar / K
      const muApprox = sz * Math.sqrt(N)
      const kG = sigSub(s - sz2, s, sz2)
      return {
        steps: [
          { tex: r`K=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${n(KQ1)}}{${u(sigmaV)}}=${n(K)}\ \mathrm{fs^{-1}}`, why: r`Gaussian comparator 的小訊號增益（$C=1$）；$\sqrt{2/\pi}\approx0.79788$。` },
          { tex: r`K^2=${nb(K)}^2=${n(K2)}\ \mathrm{fs^{-2}}`, why: '平方。' },
          {
            tex: r`\sigma_y^2=\frac{\sigma_\eta^2}{K^2}=\frac{1}{NK^2}=\frac{1}{${ni(N)}\times${n(K2)}}=\frac{1}{${n(N * K2)}}=${n(sy2)}\ \mathrm{fs^2}`,
            why: r`把 GMAC 雜訊（$\sigma_\eta^2=1/N$）換算成「量測 $w^*$ 的雜訊」：一個 block 等於一次量測。`,
          },
          { tex: r`\sigma_\zeta^2=${ub(sz)}^2=${n(sz2)}\ \mathrm{fs^2}`, why: '每個 block 的漂移變異數。' },
          { tex: r`\sigma_\zeta^4=${nb(sz2)}^2=${n(sz4)}`, why: '再平方一次。' },
          { tex: r`4\sigma_\zeta^2\sigma_y^2=4\times${n(sz2)}\times${n(sy2)}=${n(four)}`, why: '根號裡的第二項。' },
          {
            tex: r`s=\sqrt{\sigma_\zeta^4+4\sigma_\zeta^2\sigma_y^2}=\sqrt{${n(sz4)}+${n(four)}}=\sqrt{${n(sz4 + four)}}=${n(s)}`,
            why: r`二次方程 $\sigma_y^2g^2+\sigma_\zeta^2g-\sigma_\zeta^2=0$ 的判別式開根號（計算機的 $\sqrt{x}$ 鍵）。`,
          },
          {
            tex: r`g^*=\frac{s-\sigma_\zeta^2}{2\sigma_y^2}=\frac{${n(s, kG)}-${n(sz2, kG)}}{2\times${n(sy2)}}=\frac{${n(s - sz2)}}{${n(2 * sy2)}}=${n(gStar)}`,
            why: r`$dV/dg=0$ 的正根：最佳的無因次增益。`,
          },
          { tex: r`\mu^*=\frac{g^*}{K}=\frac{${n(gStar)}}{${n(K)}}=${n(muStar)}\ \mathrm{fs}`, why: '換回有單位的步長。' },
          { tex: r`P^-=\frac{\sigma_\zeta^2+s}{2}=\frac{${n(sz2)}+${n(s)}}{2}=\frac{${n(sz2 + s)}}{2}=${n(kal.Pprior)}\ \mathrm{fs^2}`, why: r`穩態 Riccati 方程的解，也就是 $V(g^*)$。` },
          { tex: r`\sqrt{P^-}=\sqrt{${n(kal.Pprior)}}=${n(Math.sqrt(kal.Pprior))}\ \mathrm{fs}`, why: '最佳的穩態追蹤誤差 RMS（更新前）。' },
          {
            tex: r`K_\infty=\frac{P^-}{P^-+\sigma_y^2}=\frac{${n(kal.Pprior)}}{${n(kal.Pprior)}+${n(sy2)}}=\frac{${n(kal.Pprior)}}{${n(kal.Pprior + sy2)}}=${n(kal.gain)}`,
            why: r`驗算：穩態 Kalman 增益應該等於上面的 $g^*$。`,
          },
        ],
        results: [
          { symbol: 'g^*', label: '最佳無因次增益（也就是穩態 Kalman 增益）', value: gStar, tolerance: { rel: 0.02 } },
          { symbol: r`\mu^*`, label: '最佳固定步長', value: muStar, unit: r`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: r`\sqrt{P^-}`, label: '最佳穩態追蹤誤差 RMS', value: Math.sqrt(kal.Pprior), unit: r`\mathrm{fs}` },
        ],
        notes: [
          r`第 14 章的近似 $\mu^*\approx\sigma_\zeta/\sigma_\eta=\sigma_\zeta\sqrt N=${n(muApprox)}$ fs，相差 $${pctTex(muApprox, muStar)}$（$\sigma_\zeta\ll\sigma_y$ 時才準）。`,
          r`$g^*<1$ 恆成立，所以一階校正迴路的 PM 自動大於 $60^\circ$。`,
        ],
      }
    },
    tips: [
      r`預設值（T13 的 $\sigma_v$、$N$）下 $\sigma_y=${n(T13.sigmaY)}$ fs；$\sigma_\zeta=0.01$ fs 時 $\mu^*\approx${n(optimalTrackingGain(1e-4, T13.sigmaY ** 2) / T13.K, 2)}$ fs，比 T13 的 $\mu=10$ fs 小很多。`,
      r`$\sigma_\zeta\ll\sigma_y$ 時 $s\approx2\sigma_\zeta\sigma_y$，所以 $g^*\approx\sigma_\zeta/\sigma_y$：可以先用它估一個數量級。`,
      r`$\sigma_\zeta^4$ 通常比 $4\sigma_\zeta^2\sigma_y^2$ 小很多；相加時小的那一項可能完全不影響前 5 位，這是正常的。`,
    ],
  },

  // ───────────────────────── HC-RM.9：R9 wrap 還是 saturate（F-R9.1） ─────────────────────────
  {
    id: 'HC-RM.9',
    title: r`R9：最壞情況下第幾筆開始溢位？wrap 與 saturate 各存到多少？`,
    page: PAGE,
    formulaId: 'F-R9.1',
    formulaTex: r`M=\max|q\,x|,\quad U=2^{W_\mathrm{acc}-1}-1,\quad n_{\mathrm{safe}}=\Big\lfloor\frac UM\Big\rfloor,\qquad \mathrm{wrap}_W(T)=\big((T+2^{W-1})\bmod2^W\big)-2^{W-1},\quad \mathrm{sat}_W(T)=\min(T,\ U)\ \ (T\ge0)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'Wx', symbol: 'W_x', label: 'code 位寬', unit: r`\mathrm{bits}`, default: 6, min: 2, max: 12, integer: true, practice: { choices: [4, 5, 6, 8] } },
      { key: 'k', symbol: r`\log_2N`, label: '累加筆數是 2 的幾次方', default: 12, min: 0, max: 16, integer: true, practice: { choices: [8, 10, 12] } },
      { key: 'neg', symbol: 'm_-', label: 'code 是否含最負值（0 = 對稱範圍，1 = 完整 two’s complement）', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'Wacc', symbol: r`W_\mathrm{acc}`, label: '累加器位寬', unit: r`\mathrm{bits}`, default: 17, min: 2, max: 40, integer: true, practice: { choices: [12, 14, 16, 17, 18, 20] } },
    ],
    validate: ({ Wx, neg, Wacc }) => {
      const M = neg >= 1 ? 2 ** (Wx - 1) : 2 ** (Wx - 1) - 1
      const U = 2 ** (Wacc - 1) - 1
      if (U < M)
        return r`$W_\mathrm{acc}=${ni(Wacc)}$ bits 的正上限 $2^{W_\mathrm{acc}-1}-1=${ni(U)}$ 比單筆乘積的最大值 $\max|q\,x|=${ni(M)}$ 還小：連一筆都放不下，這不是「累加溢位」而是 datapath 位寬接錯。累加器至少要比 code 寬（$W_\mathrm{acc}\ge W_x${neg >= 1 ? '+1' : ''}$）。`
      return null
    },
    solve: ({ Wx, k, neg, Wacc }) => {
      const N = 2 ** k
      const most = neg >= 1
      const req = accumulatorBits(Wx, N, most)
      const wc = worstCaseAccumulate(Wx, N, Wacc, most)
      const nSafe = worstCaseSafeCount(Wx, Wacc, most)
      const M = req.maxProduct
      const half = 2 ** (Wacc - 1)
      const U = half - 1
      const T = wc.trueSum
      const overflow = wc.firstOverflowAt !== null
      const steps: HandCalcStep[] = [
        most
          ? { tex: r`M=\max|q\,x|=2^{W_x-1}=2^{${ni(Wx - 1)}}=${ni(M)}`, why: r`$q=-1$、$x=-2^{W_x-1}$ 時 conditional negate 得到 $+2^{W_x-1}$，比正的最大 code 多 1。` }
          : { tex: r`M=\max|q\,x|=2^{W_x-1}-1=2^{${ni(Wx - 1)}}-1=${ni(2 ** (Wx - 1))}-1=${ni(M)}`, why: r`對稱 code 範圍 $\pm(2^{W_x-1}-1)$：單筆乘積的最大值。` },
        { tex: r`U=2^{W_\mathrm{acc}-1}-1=2^{${ni(Wacc - 1)}}-1=${ni(half)}-1=${ni(U)}`, why: r`$W_\mathrm{acc}$-bit signed 累加器能存的最大正數。` },
        {
          tex: r`n_{\mathrm{safe}}=\Big\lfloor\frac UM\Big\rfloor=\Big\lfloor\frac{${ni(U)}}{${ni(M)}}\Big\rfloor=\lfloor${floorArg(U / M)}\rfloor=${ni(nSafe)}`,
          why: r`最壞情況每筆都加 $M$，第 $n$ 筆後是 $nM$：最多放得下幾筆（整數除法的商）。`,
        },
        { tex: r`N=2^{\log_2N}=2^{${ni(k)}}=${ni(N)}`, why: '這個 block 要累加的筆數。' },
        overflow
          ? {
              tex: r`n_{\mathrm{ov}}=n_{\mathrm{safe}}+1=${ni(nSafe)}+1=${ni(nSafe + 1)}`,
              why: r`$n_{\mathrm{safe}}<N$：第 $${ni(nSafe + 1)}$ 筆就溢位，這個 block 才過了 $${n((100 * (nSafe + 1)) / N, 3)}\%$。`,
            }
          : {
              tex: r`n_{\mathrm{safe}}-N=${ni(nSafe)}-${ni(N)}=${ni(nSafe - N)}`,
              why: r`結果 $\ge0$：整個 block 都放得下，不會溢位。`,
            },
        { tex: r`T=N\cdot M=${ni(N)}\times${ni(M)}=${ni(T)}`, why: '無限位寬時 block 結束的真實總和（誤差很大、comparator 一直輸出同號的最壞情況）。' },
      ]
      if (overflow) {
        const shifted = T + half
        const mod = 2 ** Wacc
        const quot = Math.floor(shifted / mod)
        const rem = shifted - quot * mod
        steps.push(
          { tex: r`T+2^{W_\mathrm{acc}-1}=${ni(T)}+${ni(half)}=${ni(shifted)}`, why: 'wrap 的第一步：加上半個範圍，把「signed」平移成「unsigned」。' },
          {
            tex: r`(T+2^{W_\mathrm{acc}-1})\bmod2^{W_\mathrm{acc}}=${ni(shifted)}\bmod${ni(mod)}=${ni(shifted)}-${ni(quot)}\times${ni(mod)}=${ni(rem)}`,
            why: r`硬體只保留低 $W_\mathrm{acc}$ 個 bit：減掉 $2^{W_\mathrm{acc}}$ 的整數倍（這裡 $${ni(quot)}$ 次），直到落在 $[0,\ 2^{W_\mathrm{acc}})$。`,
          },
          { tex: r`\mathrm{wrap}_W(T)=${ni(rem)}-2^{W_\mathrm{acc}-1}=${ni(rem)}-${ni(half)}=${ni(wc.wrapped)}`, why: '再把半個範圍減回來。' },
          { tex: r`\mathrm{sat}_W(T)=\min(T,\ U)=\min(${ni(T)},\ ${ni(U)})=${ni(wc.saturated)}`, why: 'saturate：超過上限就卡在上限（需要額外的比較器）。' },
        )
      } else {
        steps.push({
          tex: r`T=${ni(T)}\le U=${ni(U)}\ \Rightarrow\ \mathrm{wrap}_W(T)=\mathrm{sat}_W(T)=T=${ni(wc.wrapped)}`,
          why: '沒有溢位時 wrap 與 saturate 都不改變數值。',
        })
      }
      const flipped = overflow && Math.sign(wc.wrapped) !== Math.sign(T)
      return {
        steps,
        results: [
          { symbol: r`n_{\mathrm{safe}}`, label: '最壞情況下不溢位最多能累加幾筆', value: nSafe, digits: 12, tolerance: { abs: 0.5, rel: 0 } },
          { symbol: r`\mathrm{wrap}_W(T)`, label: 'wrap 累加器在 block 結束時的值', value: wc.wrapped, digits: 12, tolerance: { abs: 0.5, rel: 0 } },
          { symbol: r`\mathrm{sat}_W(T)`, label: 'saturate 累加器在 block 結束時的值', value: wc.saturated, digits: 12, tolerance: { abs: 0.5, rel: 0 } },
        ],
        notes: [
          flipped
            ? r`wrap 的結果與真實總和 $+${ni(T)}$ 不同號（或歸零）：LMS 往錯的方向更新，而且正好發生在誤差最大的時候。saturate 的符號正確、大小錯（$${ni(wc.saturated)}$ 而不是 $${ni(T)}$），迴路只是變慢。`
            : overflow
              ? r`溢位後 wrap 的數值錯誤（這組數字符號剛好沒翻；再多累加幾筆就會翻）。saturate 卡在 $${ni(wc.saturated)}$。`
              : r`不溢位：離上限還有 $${ni(U - T)}$ 的餘裕。`,
          r`不溢位需要 $W_\mathrm{acc}\ge${ni(req.bitsRequired)}$ bits（F-R9.1；「需要幾個 bit」的手算在第 4 章 HC-04.6）。`,
        ],
      }
    },
    tips: [
      r`預設值是 golden negative test：6-bit 對稱 code、$N=4096$、17-bit 累加器。$n_{\mathrm{safe}}=\lfloor65535/31\rfloor=2114$，第 2115 筆溢位；block 結束時 $126976$ wrap 成 $-4096$，saturate 則停在 $65535$。`,
      r`把 $m_-$ 改成 1、$W_\mathrm{acc}$ 改成 18：$n_{\mathrm{safe}}=\lfloor131071/32\rfloor=4095$，只差最後一筆——$131072=2^{17}$ 比上限多 1，wrap 成 $-131072$。`,
      r`$\bmod$ 的手算：先做整數除法求商，再用 $\text{餘數}=\text{被除數}-\text{商}\times\text{除數}$。2 的冪次表：$2^{10}=1024$、$2^{16}=65536$、$2^{17}=131072$。`,
    ],
  },

  // ───────────────────────── HC-RM.10：R10 規格反推（F-R10.1） ─────────────────────────
  {
    id: 'HC-RM.10',
    title: r`R10：給定校正時間與 $N$，固定步長最小要多大？係數雜訊剩多少？`,
    page: PAGE,
    formulaId: 'F-R10.1',
    formulaTex: r`\begin{gathered}B=\Big\lfloor\frac{f_sT_{\max}}{N}\Big\rfloor,\qquad g=1-\varepsilon^{1/B},\qquad \sigma_w^2=\frac{g}{K^2N(2-g)}\\[4pt]\sigma_{w,\min}^2(N)=\frac{L_\varepsilon}{2K^2f_sT_{\max}}\cdot\frac{\tanh y}{y},\qquad y=\frac{NL_\varepsilon}{2f_sT_{\max}},\quad L_\varepsilon=\ln\frac1\varepsilon\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: r`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'fsG', symbol: 'f_s', label: 'comparator 取樣率', unit: r`\mathrm{GHz}`, default: 4, min: 0.01, max: 100, practice: { choices: [1, 2, 4] } },
      { key: 'tUs', symbol: r`T_{\max}`, label: '校正時間上限', unit: r`\mu\mathrm{s}`, default: 200, min: 0.01, max: 1000000, practice: { choices: [100, 200, 500] } },
      { key: 'eps', symbol: r`\varepsilon`, label: '平均誤差縮減比（相對比例，不是 fs）', default: 0.01, min: 1e-9, max: 1000, practice: { choices: [0.001, 0.01, 0.05] } },
      { key: 'k', symbol: r`\log_2N`, label: 'GMAC block 長度是 2 的幾次方', default: 12, min: 0, max: 24, integer: true, practice: { choices: [8, 10, 12, 14] } },
    ],
    validate: ({ fsG, tUs, eps, k }) => {
      if (eps >= 1)
        return r`$\varepsilon=${u(eps)}\ge1$：$\varepsilon$ 是「平均誤差要縮到原來的幾倍」的相對比例，必須 $0<\varepsilon<1$（勘誤 E16）。若規格給的是絕對誤差 $e_{\mathrm{abs}}$（fs），請用 $\varepsilon=e_{\mathrm{abs}}/|\delta_0|$；直接填 fs 的數字會讓步長下界變成 0 或負的。`
      const total = fsG * 1e9 * tUs * 1e-6
      if (floorTol(total / 2 ** k) < 1) return r`$N=2^{${ni(k)}}=${ni(2 ** k)}$ 比總比較次數 $f_sT_{\max}=${n(total, 10)}$ 還大：一個 block 都跑不完（$B=0$）。請加長 $T_{\max}$ 或減小 $N$。`
      return null
    },
    solve: ({ sigmaV, fsG, tUs, eps, k }) => {
      const fs = fsG * 1e9
      const tMax = tUs * 1e-6
      // sigmaWMax 設得很大、δ0 = 0、PM_min 很小：只留下「時間」這一個下界，其他約束都不作用
      const res = inverseDesign({ sigmaV, C: 1, fs, sigmaWMax: 1e9, tMax, eps, delta0: 0, pmMinDeg: 1, log2Nmin: k, log2Nmax: k })
      const row = res.rows[0]
      const K = res.K
      const N = row.N
      const B = row.Bmax
      const total = fs * tMax
      const L = Math.log(1 / eps)
      const epsU = Math.pow(eps, 1 / B)
      const g = row.gTime
      const K2N = K * K * N
      const sw2 = g / (K2N * (2 - g))
      const y = (N * L) / (2 * total)
      const th = Math.tanh(y) / y
      const floor2 = res.floorMany * res.floorMany
      const cont2 = row.sigmaWContinuous * row.sigmaWContinuous
      const kE = sigSub(g, 1, epsU)
      return {
        steps: [
          { tex: r`K=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${n(KQ1)}}{${u(sigmaV)}}=${n(K)}\ \mathrm{fs^{-1}}`, why: r`Gaussian comparator 的小訊號增益（$C=1$）；$\sqrt{2/\pi}\approx0.79788$。` },
          {
            tex: r`f_sT_{\max}=${u(fsG)}\times10^{9}\times${u(tUs)}\times10^{-6}=${n(total, 10)}`,
            why: r`可用的總比較次數：GHz 是 $10^9$、$\mu$s 是 $10^{-6}$，指數相加得 $10^3$。`,
          },
          { tex: r`N=2^{\log_2N}=2^{${ni(k)}}=${ni(N)}`, why: '每個 block 的比較次數。' },
          {
            tex: r`B=\Big\lfloor\frac{f_sT_{\max}}{N}\Big\rfloor=\Big\lfloor\frac{${n(total, 10)}}{${ni(N)}}\Big\rfloor=\lfloor${floorArg(total / N)}\rfloor=${ni(B)}`,
            why: '時間內可以更新幾次（無條件捨去：不滿一個 block 的不算）。',
          },
          { tex: r`L_\varepsilon=\ln\frac1\varepsilon=\ln\frac{1}{${u(eps)}}=\ln(${n(1 / eps, 10)})=${n(L)}`, why: r`計算機按 $\ln$。` },
          {
            tex: r`\varepsilon^{1/B}=e^{-L_\varepsilon/B}=e^{-\frac{${n(L)}}{${ni(B)}}}=e^{-${n(L / B)}}=${n(epsU, kE)}`,
            why: r`每次更新平均誤差要乘上的倍數（$p=1-g$）。計算機：先算 $L_\varepsilon/B$、變號，再按 $e^x$；這個數很接近 1，要多留幾位。`,
          },
          {
            tex: r`g=1-\varepsilon^{1/B}=1-${n(epsU, kE)}=${n(g)}`,
            why: r`$(1-g)^B=\varepsilon$：剛好在 $B$ 次內把平均誤差縮到 $\varepsilon$ 倍的最小 $g$（$\sigma_w$ 隨 $g$ 遞增，所以取最小）。`,
          },
          { tex: r`\mu=\frac gK=\frac{${n(g)}}{${n(K)}}=${n(row.muLo)}\ \mathrm{fs}`, why: '換回有單位的步長。' },
          { tex: r`K^2N=${nb(K)}^2\times${ni(N)}=${n(K * K)}\times${ni(N)}=${n(K2N)}\ \mathrm{fs^{-2}}`, why: r`$\sigma_w^2$ 的分母會用到：先平方、再乘 $N$。` },
          {
            tex: r`\sigma_w^2=\frac{g}{K^2N(2-g)}=\frac{${n(g)}}{${n(K2N)}\times(2-${n(g)})}=\frac{${n(g)}}{${n(K2N)}\times${n(2 - g)}}=\frac{${n(g)}}{${n(K2N * (2 - g))}}=${n(sw2)}\ \mathrm{fs^2}`,
            why: r`第 12 章的白雜訊結果，$\sigma_\eta^2=1/N$。`,
          },
          { tex: r`\sigma_w=\sqrt{\sigma_w^2}=\sqrt{${n(sw2)}}=${n(row.sigmaWAtLo)}\ \mathrm{fs}`, why: r`開根號：以這個 $g$ 持續校正時的係數雜訊 RMS（整數 $B$）。` },
          {
            tex: r`y=\frac{NL_\varepsilon}{2f_sT_{\max}}=\frac{${ni(N)}\times${n(L)}}{2\times${n(total, 10)}}=\frac{${n(N * L)}}{${n(2 * total, 10)}}=${n(y)}`,
            why: r`tanh 律的自變數：$y=L_\varepsilon/(2B)$（把 $B$ 當成連續的 $f_sT_{\max}/N$）。`,
          },
          y <= TANH_SERIES_YMAX
            ? {
                tex: r`\frac{\tanh y}{y}\approx1-\frac{y^2}{3}=1-\frac{${nb(y)}^2}{3}=1-\frac{${n(y * y)}}{3}=1-${n((y * y) / 3)}=${n(th)}`,
                why: r`$y$ 這麼小時 $\tanh y$ 與 $y$ 的前幾位完全相同，按 $\tanh$ 再相除只會得到 1；改用泰勒展開 $\tanh y=y-\tfrac{y^3}{3}+\dots$（$y\le${TANH_SERIES_YMAX}$ 時誤差小於 $1.4\times10^{-5}$）。`,
              }
            : {
                tex: r`\frac{\tanh y}{y}=\frac{\tanh(${n(y)})}{${n(y)}}=\frac{${n(Math.tanh(y))}}{${n(y)}}=${n(th)}`,
                why: r`計算機的 $\tanh$ 鍵（hyp + tan）；沒有的話用 $\tanh y=\tfrac{e^{2y}-1}{e^{2y}+1}$。`,
              },
          {
            tex: r`\sigma_{w,\min}^2(N)=\frac{L_\varepsilon}{2K^2f_sT_{\max}}\cdot\frac{\tanh y}{y}=\frac{${n(L)}}{2\times${n(K * K)}\times${n(total, 10)}}\times${n(th)}=${n(floor2)}\times${n(th)}=${n(cont2)}\ \mathrm{fs^2}`,
            why: r`tanh 律（F-R10.1）：前面的分數是多 block 極限，$\tanh(y)/y\le1$ 是有限 block 數的修正。`,
          },
          { tex: r`\sigma_{w,\min}(N)=\sqrt{${n(cont2)}}=${n(row.sigmaWContinuous)}\ \mathrm{fs}`, why: '開根號，和第 11 步的整數 $B$ 結果比較。' },
        ],
        results: [
          { symbol: 'B', label: '可用的更新次數', value: B, digits: 12, tolerance: { abs: 0.01, rel: 0 } },
          { symbol: 'g', label: '最小的無因次增益', value: g, tolerance: { rel: 0.02 } },
          { symbol: r`\mu`, label: '對應的步長', value: row.muLo, unit: r`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: r`\sigma_w`, label: '這個 N 的係數雜訊 RMS（整數 B）', value: row.sigmaWAtLo, unit: r`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: r`\sigma_{w,\min}(N)`, label: 'tanh 律的預測（連續 B）', value: row.sigmaWContinuous, unit: r`\mathrm{fs}`, tolerance: { rel: 0.02 } },
        ],
        notes: [
          floorTol(total / N) === Math.ceil(total / N - 1e-9)
            ? r`$f_sT_{\max}/N$ 剛好是整數：整數 $B$ 的 $\sigma_w$ 與 tanh 律完全相同（$\tfrac{g}{2-g}=\tanh\tfrac{L_\varepsilon}{2B}$ 是恆等式）。`
            : r`整數 $B$ 的 $\sigma_w$ 比 tanh 律大 $${n(100 * (row.sigmaWAtLo / row.sigmaWContinuous - 1), 3)}\%$：$\lfloor\cdot\rfloor$ 把 $${floorArg(total / N)}$ 個 block 捨成 $${ni(B)}$ 個，$g$ 只好再大一點。`,
          r`多 block 極限 $\sqrt{L_\varepsilon/(2K^2f_sT_{\max})}=${n(res.floorMany)}$ fs：規格若要求 $\sigma_{w,\max}$ 低於它，在 $B\gg1$ 的區域換 $N$ 也沒用。`,
          r`把全部樣本平均一次（$N=f_sT_{\max}$、$g=1$）可以到 $1/(K\sqrt{f_sT_{\max}})=${n(res.floorOneShot)}$ fs。`,
          r`這裡只算「時間」這個下界；slew、PM 與 $\sigma_{w,\max}$ 的上界在預覽的實驗裡一起檢查。`,
        ],
      }
    },
    tips: [
      r`預設值：$f_sT_{\max}=8\times10^5$、$N=4096$ 時 $B=195$，對照預覽實驗表格 $N=4096$ 那一列的 $B_{\max}$、$g_{\mathrm{lo}}$ 與 $\sigma_w(g_{\mathrm{lo}})$。`,
      r`$B$ 很大時 $g\approx L_\varepsilon/B$（$e^{-x}\approx1-x$），可以先用它估一個數量級。`,
      r`$\varepsilon^{1/B}$ 很接近 1：算 $g=1-\varepsilon^{1/B}$ 時前面相同的位數會抵銷，所以 $\varepsilon^{1/B}$ 要留到小數後 6–7 位。`,
    ],
  },
]

/** 依 id 取題目（預覽元件用；找不到時丟錯，測試會抓到）。 */
export function roadmapHandCalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到手算題 ${id}`)
  return def
}
