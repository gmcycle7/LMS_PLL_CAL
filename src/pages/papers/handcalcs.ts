import type { HandCalcDef, HandCalcStep } from '@/data/types'
import {
  SQRT_2_OVER_PI,
  calBandwidths,
  comparatorKq,
  corr2Eigs,
  criticalGain,
  delaySpectralRadius,
  ditherErrorPowers,
  efQuantize,
  eigenExample,
  gainScale,
  muForScale,
  nlmsPosteriorFactor,
  nlmsStep,
  pmWithDelayDeg,
  poleFromEnbw,
  poleFromF3db,
  prbsHalfLsbDither,
  stepsToDecay,
} from './bridge'
import { clean, sigFor, snap, tx, txCeilArg, txInt, txP, txSq } from './handcalcTex'

/**
 * Papers / Reading 頁的「帶入手算」題（docs/teaching-style.md §7）。
 *
 * 這一頁的主題是「把文獻的寫法換成本站的量」，所以每一題都從「書上／論文上的數字」出發，算到本站的 g、p 或步長上限；
 * 純粹重算章節結論的題目（σ_w、ENBW、兩個 tone 的 C…）已經在 Ch06、Ch07、Ch12 的手算題裡，這裡不重複。
 *  1. solve() 的每個「答案」都來自 bridge.ts 的實際函式（頁面表格與 §5 實驗用的同一份程式）；
 *     步驟裡的中間值只做一次加減乘除／平方／開根號／三角函數／ln（handcalcs.test.tsx 以獨立重算逐一比對）。
 *  2. 每一步的 TeX 都是「符號式 = 代入數字 =（中間結果 =）結果」，每個等號只做一種運算；why 說明怎麼算、怎麼按計算機。
 *  3. 預設值就是本頁的 worked example：§4 手算表（μ_W = 0.05、x = 2）、T13（σ_v = 100 fs、μ = 10 fs、N = 4096）、
 *     T14（12.93 kHz、f_u = 976.5625 kHz）、D3（g = 0.7、d = 2）、D5／D6（w_H = 32.4）、§5 實驗的 T11 preset（μ_W = 0.25、ρ = 0.99 ⇒ 598 步）。
 *  4. validate 擋掉模型不適用的輸入，並說明原因；practice 範圍只會抽出手算友善、而且一定合法的數字。
 *
 * 位置：HC-PR.1／HC-PR.2／HC-PR.3 → §4；HC-PR.4 → D1 面板；HC-PR.5 → D3；HC-PR.6 → D5；HC-PR.7 → D6；
 * HC-PR.8（綜合：換算步長 → eigen-mode → 598 步）→ §8 思考題之前。
 */

const r = String.raw

const DEG = Math.PI / 180

/** 換算函式需要的背景參數（½e² 型與 Widrow 型只用到 convention 與 mu，其餘欄位不影響結果） */
const CTX = { traceR: 1, epsReg: 0, sigmaV: 1, N: 1, sumMode: false } as const

/** HC-PR.4 的備註把 g 換回本站 1-bit GMAC 的 μ 時用的 comparator 雜訊（D1 面板的 illustrative 參數，T13） */
const HC_SIGMA_V_FS = 100

/** HC-PR.6：手算幾拍、目標值以 1/100 LSB 的整數分子表示（±½ LSB 的 dither 分子才是整數） */
export const HC_DITHER_STEPS = 4
export const HC_DITHER_DEN = 100

/** 6-bit gain register 的 code 範圍 */
const MAX_CODE = 63

function poleVerdict(p: number): string {
  const a = Math.abs(p)
  if (a < 1 - 1e-12) return p < 0 ? r`$-1<p<0$：平均誤差正負交替、振幅遞減（震盪收斂）。` : p === 0 ? r`$p=0$：平均誤差一步歸零。` : r`$0<p<1$：平均誤差單調收斂。`
  if (a <= 1 + 1e-12) return p < 0 ? r`$p=-1$：等幅震盪（臨界），不收斂。` : r`$p=1$：沒有恢復力，誤差停在原地。`
  return p < 0 ? r`$p<-1$：每一步都修正過頭，震盪發散。` : r`$p>1$：更新方向反了，單調發散。`
}

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────── HC-PR.1：步長換算（F-PR.1，§4） ─────────────────────────
  {
    id: 'HC-PR.1',
    title: r`把 Widrow 型的 $\mu_W$ 換成本站的 $\mu$，再看 pole`,
    page: '/papers',
    formulaId: 'F-PR.1',
    formulaTex: r`\mu=2\,\mu_W,\qquad g=\mu\,\lambda_{\max},\qquad p=1-g,\qquad |p|<1\iff 0<\mu<\frac{2}{\lambda_{\max}}\iff 0<\mu_W<\frac{1}{\lambda_{\max}}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'muW', symbol: r`\mu_W`, label: '書上的步長（Widrow 型：更新式帶 2 倍）', default: 0.05, min: -100, max: 100, practice: { choices: [0.01, 0.02, 0.05, 0.1, 0.125, 0.2, 0.3] } },
      {
        key: 'lmax',
        symbol: r`\lambda_{\max}`,
        label: '輸入自相關矩陣的最大特徵值（只有一個固定輸入時就是輸入的平方）',
        default: 4,
        min: -1000,
        max: 1000,
        practice: { choices: [0.5, 1, 2, 4, 5] },
      },
    ],
    validate: ({ muW, lmax }) =>
      lmax <= 0
        ? r`$\lambda_{\max}\le 0$：自相關矩陣的特徵值不會是負的；等於 $0$ 表示輸入沒有功率，資料裡不含參數的資訊（不可辨識），任何步長都學不到東西。請輸入正的 $\lambda_{\max}$。`
        : muW <= 0
          ? r`$\mu_W\le 0$：步長為 $0$ 時完全不更新（$p=1$）；為負時等於更新方向接反（$p>1$，平均誤差發散）。請輸入正的 $\mu_W$。`
          : null,
    solve: ({ muW, lmax }) => {
      const mu = gainScale({ ...CTX, convention: 'widrow', mu: muW, polarity: 1 })
      const g = mu * lmax
      const p = snap(1 - g, 1, g)
      const muWMax = muForScale(criticalGain(0) / lmax, 'widrow', CTX)
      const muMax = muForScale(criticalGain(0) / lmax, 'half', CTX)
      const kP = sigFor(p, 1, g)
      return {
        steps: [
          {
            tex: r`\mu = 2\,\mu_W = 2\times${tx(muW)} = ${tx(mu)}`,
            why: r`Widrow 型的成本是 $\varepsilon^2$（沒有 $\tfrac12$），梯度多一個 $2$；兩個更新式逐項相等的條件就是 $\mu=2\mu_W$。`,
          },
          {
            tex: r`g = \mu\,\lambda_{\max} = ${tx(mu)}\times${tx(lmax)} = ${tx(g)}`,
            why: r`最快的 mode 的 loop gain：每一步把平均誤差修正掉 $g$ 倍。`,
          },
          {
            tex: r`p = 1 - g = 1 - ${tx(g, kP)} = ${tx(p)}`,
            why: r`pole：平均誤差每一步乘上的倍數（$\delta=a-w$）。`,
          },
          {
            tex: r`\mu_{W,\max} = \frac{1}{\lambda_{\max}} = \frac{1}{${tx(lmax)}} = ${tx(muWMax)}`,
            why: r`$|p|<1\iff 0<g<2\iff 0<\mu_W<1/\lambda_{\max}$：Widrow 型的上限。`,
          },
          {
            tex: r`\mu_{\max} = \frac{2}{\lambda_{\max}} = \frac{2}{${tx(lmax)}} = ${tx(muMax)}`,
            why: r`同一個界限用本站的寫法表示：正好是 $\mu_{W,\max}$ 的 2 倍，兩本書講的是同一件事。`,
          },
        ],
        results: [
          { symbol: r`\mu`, label: '本站寫法的步長', value: mu },
          { symbol: 'p', label: '最快 mode 的 pole', value: p, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`\mu_{W,\max}`, label: 'Widrow 型的步長上限', value: muWMax },
        ],
        notes: [
          poleVerdict(p),
          muW < muWMax
            ? r`$\mu_W=${tx(muW)}<\mu_{W,\max}=${tx(muWMax)}$：平均意義下穩定。`
            : r`$\mu_W=${tx(muW)}\ge\mu_{W,\max}=${tx(muWMax)}$：達到或超過上限，平均誤差不收斂。`,
        ],
      }
    },
    tips: [
      r`範例數字（$\mu_W=0.05$、$\lambda_{\max}=x^2=4$）就是 §4 的手算表：$p=0.6$，所以 $\delta_n=a-w_n$ 依序是 $2,\ 1.2,\ 0.72$，也就是 $w_n=1,\ 1.8,\ 2.28$。`,
      r`只有一個固定輸入 $x$ 時 $\lambda_{\max}=x^2$；兩個參數、相關係數 $\rho$ 時 $\lambda_{\max}=P_x(1+|\rho|)$（見 HC-PR.8）。`,
      r`看到教科書的界限寫 $1/\lambda_{\max}$ 而不是 $2/\lambda_{\max}$，先檢查它的更新式是不是 $2\mu\,\varepsilon\,\mathbf X$。`,
    ],
  },

  // ───────────────────────── HC-PR.2：NLMS 一步與 a posteriori 收縮（F-PR.2，§4） ─────────────────────────
  {
    id: 'HC-PR.2',
    title: 'NLMS 更新一步：為什麼界限與輸入大小無關',
    page: '/papers',
    formulaId: 'F-PR.2',
    formulaTex: r`w' = w+\frac{\tilde\mu\,e\,x}{D},\qquad D=\epsilon_{\mathrm{reg}}+x^2,\qquad e=y-wx,\qquad e^{\mathrm{post}}=y-w'x=\kappa\,e,\qquad \kappa=1-\frac{\tilde\mu\,x^2}{D}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'w', symbol: 'w', label: '目前的係數', default: 1, min: -100, max: 100, practice: { min: -2, max: 4, step: 0.5 } },
      { key: 'x', symbol: 'x', label: '輸入', default: 2, min: -100, max: 100, practice: { choices: [-3, -2, -1, 1, 2, 3] } },
      { key: 'y', symbol: 'y', label: '量到的輸出', default: 6, min: -1000, max: 1000, practice: { min: -12, max: 12, step: 1.5 } },
      { key: 'muT', symbol: r`\tilde\mu`, label: 'NLMS 的正規化步長', default: 0.4, min: 0, max: 10, practice: { choices: [0.2, 0.4, 0.5, 1, 1.5, 2.5] } },
      { key: 'eps', symbol: r`\epsilon_{\mathrm{reg}}`, label: 'regularizer（防止除以零）', default: 0, min: 0, max: 1000, practice: { choices: [0, 0, 1] } },
    ],
    validate: ({ x, eps }) =>
      eps + x * x <= 0
        ? r`$x=0$ 且 $\epsilon_{\mathrm{reg}}=0$：分母 $D=\epsilon_{\mathrm{reg}}+x^2=0$，更新量是 $0/0$。這正是 $\epsilon_{\mathrm{reg}}$ 存在的理由：請輸入非零的 $x$ 或正的 $\epsilon_{\mathrm{reg}}$。`
        : null,
    solve: ({ w, x, y, muT, eps }) => {
      const st = nlmsStep({ w, x, y, mu: muT, epsReg: eps })
      // 顯示用：相減的結果若只是 double 的捨入殘渣，手算得到的是 0
      const wx = w * x
      const e = snap(st.e, y, wx)
      const x2 = x * x
      const den = eps + x2
      const num = muT * e * x
      const dw = e === 0 ? 0 : st.dw
      const wNew = e === 0 ? w : snap(st.w, w, st.dw)
      const wNewX = wNew * x
      const ePost = snap(y - wNewX, y, wNewX)
      const muX2 = muT * x2
      const ratio = muX2 / den
      const kappa = snap(nlmsPosteriorFactor(muT, eps, x2), 1, ratio)
      const check = snap(kappa * e, e)
      const bound = x2 > 0 ? (2 * den) / x2 : Infinity
      const kE = sigFor(e, y, wx)
      const kW = sigFor(wNew, w, dw)
      const kPost = sigFor(ePost, y, wNewX)
      const kK = sigFor(kappa, 1, ratio)
      return {
        steps: [
          {
            tex: r`e = y - w\,x = ${tx(y)} - ${txP(w)}\times${txP(x)} = ${tx(y, kE)} - ${txP(wx, kE)} = ${tx(e)}`,
            why: '更新前的誤差（a priori error）：先乘、再減。',
          },
          { tex: r`x^2 = ${txSq(x)} = ${tx(x2)}`, why: r`輸入的能量；向量時是 $\|\mathbf x\|^2$。負的 $x$ 平方後是正的。` },
          { tex: r`D = \epsilon_{\mathrm{reg}} + x^2 = ${tx(eps)} + ${tx(x2)} = ${tx(den)}`, why: 'NLMS 的分母。' },
          {
            tex: r`\tilde\mu\,e\,x = ${tx(muT)}\times${txP(e)}\times${txP(x)} = ${tx(num)}`,
            why: r`分子：和一般 LMS 的更新量 $\mu\,e\,x$ 同一個形式（連乘兩次）。`,
          },
          {
            tex: r`\Delta w = \frac{\tilde\mu\,e\,x}{D} = \frac{${tx(num)}}{${tx(den)}} = ${tx(dw)}`,
            why: r`多除了一個 $D$：輸入越大，步長自動越小。`,
          },
          { tex: r`w' = w + \Delta w = ${tx(w, kW)} + ${txP(dw, kW)} = ${tx(wNew)}`, why: '更新後的係數。' },
          {
            tex: r`e^{\mathrm{post}} = y - w'x = ${tx(y)} - ${txP(wNew)}\times${txP(x)} = ${tx(y, kPost)} - ${txP(wNewX, kPost)} = ${tx(ePost)}`,
            why: '用更新後的係數重算同一筆資料的誤差（a posteriori error）。',
          },
          {
            tex: r`\frac{\tilde\mu\,x^2}{D} = \frac{${tx(muT)}\times${tx(x2)}}{${tx(den)}} = \frac{${tx(muX2)}}{${tx(den)}} = ${tx(ratio)}`,
            why: r`這一步修正掉的比例；$\epsilon_{\mathrm{reg}}=0$ 時它就是 $\tilde\mu$，與 $x$ 無關。`,
          },
          {
            tex: r`\kappa = 1 - \frac{\tilde\mu\,x^2}{D} = 1 - ${tx(ratio, kK)} = ${tx(kappa)}`,
            why: r`收縮因子：$e^{\mathrm{post}}=\kappa\,e$。`,
          },
          {
            tex: r`\kappa\,e = ${txP(kappa)}\times${txP(e)} = ${tx(check)}\ \checkmark`,
            why: r`驗算：應等於第 7 步直接算出的 $e^{\mathrm{post}}$（代數恆等式，把 $w'$ 代回去就得到）。`,
          },
        ],
        results: [
          { symbol: "w'", label: '更新後的係數', value: wNew, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`e^{\mathrm{post}}`, label: '更新後同一筆資料的誤差', value: ePost, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`\kappa`, label: '誤差收縮因子', value: kappa, tolerance: { rel: 0.01, abs: 1e-6 } },
        ],
        notes: [
          x === 0
            ? r`$x=0$：這筆資料不含參數的資訊，$\Delta w=0$、$\kappa=1$，係數不動。`
            : Math.abs(kappa) < 1
              ? r`$|\kappa|=${tx(Math.abs(kappa))}<1$：這一筆的誤差縮小了。條件是 $0<\tilde\mu<2D/x^2=${tx(bound)}$。`
              : r`$|\kappa|=${tx(Math.abs(kappa))}\ge1$：$\tilde\mu$ 沒有落在 $0<\tilde\mu<2D/x^2=${tx(bound)}$ 內，這一筆的誤差沒有縮小${muT > 0 ? '（修正過頭）' : '（沒有更新）'}。`,
          eps === 0 && x !== 0
            ? r`$\epsilon_{\mathrm{reg}}=0$ 時 $\kappa=1-\tilde\mu$，與 $x$ 的大小完全無關：把 $x$、$y$ 同乘 10 倍再算一次，$\kappa$ 不變。`
            : r`$\epsilon_{\mathrm{reg}}>0$ 讓分母變大、等效步長變小；$x$ 很小時它保護更新量不會爆掉。`,
        ],
      }
    },
    tips: [
      r`範例數字（$w=1,\ x=2,\ y=6,\ \tilde\mu=0.4$）就是 §4 手算表的 NLMS 欄：$\tilde\mu=\mu x^2=0.1\times4$，所以 $w'=1.8$ 與 LMS 完全相同。`,
      r`$e^{\mathrm{post}}=\kappa\,e$ 是代數恆等式（把 $w'$ 代回去就得到），$y$ 裡有沒有雜訊都成立。`,
      r`把 $\tilde\mu$ 改成 $2.5$：$\kappa=-1.5$，誤差每筆放大 1.5 倍並變號，這就是 NLMS 界限 $0<\tilde\mu<2$ 的來源。`,
    ],
  },

  // ───────────────────────── HC-PR.3：1-bit GMAC 的 μ[fs] ↔ 教科書的步長（F-PR.3，§4） ─────────────────────────
  {
    id: 'HC-PR.3',
    title: r`把 1-bit GMAC 的 gain step（$\mathrm{fs}$）換成教科書的步長，並檢查 sum 模式`,
    page: '/papers',
    formulaId: 'F-PR.3',
    formulaTex: r`K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad s_{\mathrm{GMAC}}=\mu K_q\ \ (\times N\ \text{若誤用 sum 模式}),\qquad \mu_{\frac12e^2}=s,\quad \mu_W=\frac s2,\qquad p=1-s\lambda`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: r`\mathrm{fs}`, default: 100, min: 0.001, max: 1e5, practice: { choices: [50, 100, 200, 400] } },
      { key: 'mu', symbol: r`\mu`, label: 'gain step（average 模式）', unit: r`\mathrm{fs}`, default: 10, min: -1e5, max: 1e5, practice: { choices: [5, 10, 20, 40] } },
      { key: 'N', symbol: 'N', label: 'GMAC 一個 block 累加的 sample 數', default: 4096, min: 1, max: 1 << 24, integer: true, practice: { choices: [256, 1024, 4096] } },
    ],
    validate: ({ mu }) =>
      mu <= 0 ? r`$\mu\le 0$：步長為 $0$ 時不更新；為負時等於極性接反（$s<0$、$p>1$），換成哪一種寫法都是發散，沒有「等效步長」可言。請輸入正的 $\mu$。` : null,
    solve: ({ sigmaV, mu, N }) => {
      const ctx = { traceR: 1, epsReg: 0, sigmaV, N, sumMode: false }
      const Kq = comparatorKq(sigmaV)
      const s = gainScale({ ...ctx, convention: 'signBlock', mu, polarity: 1 })
      const muW = muForScale(s, 'widrow', ctx)
      const p = snap(1 - s, 1, s)
      const muMax = muForScale(criticalGain(0), 'signBlock', ctx) // λ_max = C = 1
      const sSum = gainScale({ ...ctx, sumMode: true, convention: 'signBlock', mu, polarity: 1 })
      const pSum = snap(1 - sSum, 1, sSum)
      const muFix = muForScale(s, 'signBlock', { ...ctx, sumMode: true })
      const kP = sigFor(p, 1, s)
      const kPs = sigFor(pSum, 1, sSum)
      return {
        steps: [
          {
            tex: r`K_q = \frac{\sqrt{2/\pi}}{\sigma_v} = \frac{${tx(SQRT_2_OVER_PI)}}{${tx(sigmaV)}} = ${tx(Kq)}\ \mathrm{fs^{-1}}`,
            why: r`comparator 的小訊號增益：$E[q]\approx K_q\times$（平均誤差）。$\sqrt{2/\pi}=0.79788$；只在 $|\delta|\ll\sigma_v$ 時成立。`,
          },
          {
            tex: r`s = \mu\,K_q = ${tx(mu)}\times${tx(Kq)} = ${tx(s)}`,
            why: r`無因次的 loop gain（$\mathrm{fs}\times\mathrm{fs^{-1}}$ 剛好消掉）。它就是 $\tfrac12e^2$ 型教科書的 $\mu$：兩邊的平均動態都是 $p_i=1-s\lambda_i$。`,
          },
          {
            tex: r`\mu_W = \frac{s}{2} = \frac{${tx(s)}}{2} = ${tx(muW)}`,
            why: r`換成 Widrow 型（更新式帶 2 倍）的步長：HC-PR.1 反過來做。`,
          },
          {
            tex: r`p = 1 - s\,\lambda = 1 - ${tx(s, kP)}\times1 = 1 - ${tx(s, kP)} = ${tx(p)}`,
            why: r`unit-RMS code、identity path 時 $\lambda=C=1$：平均 pole（先乘、再用 $1$ 去減）。`,
          },
          {
            tex: r`\mu_{\max} = \frac{2}{K_q} = \frac{2}{${tx(Kq)}} = ${tx(muMax)}\ \mathrm{fs}`,
            why: r`教科書的 $0<\mu\lambda_{\max}<2$ 換回 $\mathrm{fs}$：$0<\mu K_q<2$（$\lambda_{\max}=1$、無更新延遲）。`,
          },
          {
            tex: r`s_{\mathrm{sum}} = s\,N = ${tx(s)}\times${txInt(N)} = ${tx(sSum)}`,
            why: r`反面測試：GMAC 輸出總和（忘記除以 $N$）卻沿用同一個 $\mu$，loop gain 被放大 $N$ 倍。`,
          },
          {
            tex: r`p_{\mathrm{sum}} = 1 - s_{\mathrm{sum}} = 1 - ${tx(sSum, kPs)} = ${tx(pSum)}`,
            why: r`sum 模式下的 pole；$|p_{\mathrm{sum}}|\ge1$ 就發散。`,
          },
          {
            tex: r`\mu_{\mathrm{sum}} = \frac{\mu}{N} = \frac{${tx(mu)}}{${txInt(N)}} = ${tx(muFix)}\ \mathrm{fs}`,
            why: r`sum 模式要得到同一個 $s$，步長必須除以 $N$（硬體上就是多右移 $\log_2N$ 位）。`,
          },
        ],
        results: [
          { symbol: 's', label: r`等效的 $\tfrac12e^2$ 型步長（無因次 loop gain）`, value: s },
          { symbol: r`\mu_W`, label: '等效的 Widrow 型步長', value: muW },
          { symbol: r`\mu_{\max}`, label: r`gain step 的上限`, value: muMax, unit: r`\mathrm{fs}` },
          { symbol: r`s_{\mathrm{sum}}`, label: r`誤用 sum 模式時的 loop gain`, value: sSum },
        ],
        notes: [
          s < 2 ? r`$s=${tx(s)}<2$：average 模式下平均收斂。${poleVerdict(p)}` : r`$s=${tx(s)}\ge2$：連 average 模式都不收斂，$\mu$ 必須小於 $\mu_{\max}=${tx(muMax)}\ \mathrm{fs}$。`,
          N === 1
            ? r`$N=1$：sum 與 average 是同一件事，沒有 $N$ 倍的陷阱。`
            : Math.abs(pSum) >= 1
              ? r`sum 模式：$p_{\mathrm{sum}}=${tx(pSum)}$，$|p_{\mathrm{sum}}|\ge1$，立即發散（勘誤 E13 的反面測試）。`
              : r`sum 模式：$p_{\mathrm{sum}}=${tx(pSum)}$ 還在單位圓內，但 loop gain 已經不是你以為的 $${tx(s)}$。`,
          r`這個換算是近似：$K_q$ 來自 $|\delta|\ll\sigma_v$ 的線性化；誤差很大時 comparator 飽和，等效的 $s$ 會變小（Ch05）。`,
        ],
      }
    },
    tips: [
      r`範例數字（$\sigma_v=100\ \mathrm{fs}$、$\mu=10\ \mathrm{fs}$、$N=4096$）是驗收項 T13，也是 §5 實驗的「T13」與「sum 模式」兩個 preset：$s\approx0.0798$、$p\approx0.92021$、$s_{\mathrm{sum}}\approx326.8$、$p_{\mathrm{sum}}\approx-325.8$。`,
      r`計算機：$\sqrt{2/\pi}$ 按 $2\div\pi$ 再開根號，得 $0.79788$。$K_q$ 很小，請留 5 位有效數字（$0.0079788$），不要只寫 $0.008$。`,
      r`單位檢查：$\mu$ 是 $\mathrm{fs}$、$K_q$ 是 $\mathrm{fs^{-1}}$，$s$ 才是可以和教科書的 $\mu\lambda$ 比較的無因次量（勘誤 E13）。`,
      r`多參數時把 $\lambda=1$ 換成 $\lambda_{\max}$：$\mu_{\max}=2/(K_q\lambda_{\max})$；有更新延遲 $d$ 時再把 $2$ 換成 $g^*(d)$（HC-PR.5）。`,
    ],
  },

  // ───────────────────────── HC-PR.4：論文的「頻寬 f_BW」→ p、g（F-PR.15：F-PR.9 的反函數，D1） ─────────────────────────
  {
    id: 'HC-PR.4',
    title: r`論文只寫「loop bandwidth $=f_{\mathrm{BW}}$」：當成 $-3\ \mathrm{dB}$ 或當成 ENBW，換回的 $g$ 差多少`,
    page: '/papers',
    formulaId: 'F-PR.15',
    // 三行（桌機欄寬約 820px，一行排不下會出現橫向捲軸）：(a)、(b) 兩種頻寬定義各一行，最後是兩者共用的 g = 1 − p
    formulaTex: r`\begin{aligned}&\text{(a) }f_{\mathrm{BW}}=f_{3\mathrm{dB}}:\ \ \beta=\sin\frac{\pi f_{\mathrm{BW}}}{f_u},\quad \sqrt p=\sqrt{1+\beta^2}-\beta\\[2pt]&\text{(b) }f_{\mathrm{BW}}=\mathrm{ENBW}:\ \ \nu=\frac{2f_{\mathrm{BW}}}{f_u},\quad p_E=\frac{1-\nu}{1+\nu}\\[2pt]&g=1-p\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'B', symbol: r`f_{\mathrm{BW}}`, label: '文獻上寫的校正迴路頻寬', unit: r`\mathrm{kHz}`, default: 12.93, min: -1e9, max: 1e9, practice: { choices: [5, 10, 20, 25, 50] } },
      { key: 'fu', symbol: 'f_u', label: 'block update rate', unit: r`\mathrm{kHz}`, default: 976.5625, min: 1e-6, max: 1e9, practice: { choices: [500, 1000, 2000] } },
    ],
    validate: ({ B, fu }) => {
      if (B <= 0) return r`$f_{\mathrm{BW}}\le0$：頻寬必須是正的。$f_{\mathrm{BW}}\to0$ 對應 $p\to1$（完全不更新）。`
      if (B >= fu / 2)
        return r`$f_{\mathrm{BW}}=${tx(B)}\ge f_u/2=${tx(fu / 2)}$：每個 block 才更新一次的迴路，頻率最高只到 Nyquist $f_u/2$。$-3\ \mathrm{dB}$ 點剛好在 Nyquist 時 $p=3-2\sqrt2=0.1716$；$p$ 再小，增益到 Nyquist 都還沒掉到一半，$-3\ \mathrm{dB}$ 頻寬就不存在了（勘誤 E27）。請輸入 $0<f_{\mathrm{BW}}<f_u/2$，並確認兩者用同一個單位。`
      return null
    },
    solve: ({ B, fu }) => {
      const ratio = B / fu
      const halfDeg = 180 * ratio
      const beta = Math.sin(Math.PI * ratio)
      const beta2 = beta * beta
      const root = Math.sqrt(1 + beta2)
      const rootP = root - beta
      const p3 = poleFromF3db(B, fu)
      const g3 = 1 - p3
      const nu = (2 * B) / fu
      const pE = poleFromEnbw(B, fu)
      const gE = 1 - pE
      const k = g3 / gE
      const back3 = calBandwidths(p3, fu)
      const backE = calBandwidths(pE, fu)
      const small = 2 * Math.PI * ratio
      const muFs = muForScale(g3, 'signBlock', { ...CTX, sigmaV: HC_SIGMA_V_FS })
      const S = 6
      // g = 1 − p 是兩個接近的數相減：p（以及算出它的 √p、√(1+β²)）要多顯示幾位，畫面上的減法才對得起來
      const kP = Math.max(S, sigFor(g3, 1, p3))
      const kE = Math.max(S, sigFor(gE, 1, pE))
      return {
        steps: [
          {
            tex: r`\frac{f_{\mathrm{BW}}}{f_u} = \frac{${tx(B)}}{${tx(fu)}} = ${tx(ratio, S)}`,
            why: r`先把頻寬換成「占更新率的幾分之幾」；$f_{\mathrm{BW}}$ 與 $f_u$ 要用同一個單位。`,
          },
          {
            tex: r`\frac{\Omega}{2} = 180^\circ\times\frac{f_{\mathrm{BW}}}{f_u} = 180^\circ\times${tx(ratio, S)} = ${tx(halfDeg, S)}^\circ`,
            why: r`讀法 (a)：$f_{\mathrm{BW}}$ 是 $-3\ \mathrm{dB}$ corner。$\Omega=2\pi f_{\mathrm{BW}}/f_u$ rad/block，一半是 $\pi f_{\mathrm{BW}}/f_u$ rad，也就是 $180^\circ\times f_{\mathrm{BW}}/f_u$。`,
          },
          {
            tex: r`\beta = \sin\frac{\Omega}{2} = \sin(${tx(halfDeg, S)}^\circ) = ${tx(beta, S)}`,
            why: r`計算機切到 DEG 模式按 $\sin$。角度小時 $\sin\theta\approx\theta$（弧度）$=\pi f_{\mathrm{BW}}/f_u$，相對誤差約 $\theta^2/6$。`,
          },
          { tex: r`\beta^2 = ${tx(beta, S)}^2 = ${tx(beta2, S)}`, why: '平方。' },
          {
            tex: r`\sqrt{1+\beta^2} = \sqrt{1 + ${tx(beta2, S)}} = \sqrt{${tx(1 + beta2, kP + 1)}} = ${tx(root, kP)}`,
            why: r`先加 $1$、再按計算機的 $\sqrt{x}$ 鍵。這個數很接近 $1$，請多留幾位；$\beta$ 小時可用 $\sqrt{1+\beta^2}\approx1+\beta^2/2$（誤差約 $\beta^4/8$）。`,
          },
          {
            tex: r`\sqrt p = \sqrt{1+\beta^2} - \beta = ${tx(root, kP)} - ${tx(beta, S)} = ${tx(rootP, kP)}`,
            why: r`由 $1+p^2-2p\cos\Omega=2(1-p)^2$ 整理成 $(1-p)^2=4p\,\beta^2$，再令 $t=\sqrt p$ 解 $t^2+2\beta t-1=0$ 的正根（推導在 Papers 頁的 D1 面板）。`,
          },
          { tex: r`p = \big(\sqrt p\big)^2 = ${tx(rootP, kP)}^2 = ${tx(p3, kP)}`, why: r`平方回來，就是讀法 (a) 的 pole。` },
          { tex: r`g = 1 - p = 1 - ${tx(p3, kP)} = ${tx(g3)}`, why: r`讀法 (a) 的 normalized loop gain。` },
          {
            tex: r`\nu = \frac{2f_{\mathrm{BW}}}{f_u} = \frac{2\times${tx(B)}}{${tx(fu)}} = \frac{${tx(2 * B)}}{${tx(fu)}} = ${tx(nu, S)}`,
            why: r`讀法 (b)：$f_{\mathrm{BW}}$ 是 one-sided ENBW $=\dfrac{f_u}{2}\cdot\dfrac{1-p}{1+p}$，所以 $\dfrac{1-p}{1+p}=\dfrac{2f_{\mathrm{BW}}}{f_u}$。`,
          },
          {
            tex: r`p_E = \frac{1-\nu}{1+\nu} = \frac{1-${tx(nu, S)}}{1+${tx(nu, S)}} = \frac{${tx(1 - nu, kE)}}{${tx(1 + nu, kE + 1)}} = ${tx(pE, kE)}`,
            why: r`由 $(1-p)=\nu\,(1+p)$ 解出 $p$：分子、分母各一次加減，再相除。`,
          },
          { tex: r`g_E = 1 - p_E = 1 - ${tx(pE, kE)} = ${tx(gE)}`, why: r`讀法 (b) 的 loop gain。` },
          {
            tex: r`\frac{g}{g_E} = \frac{${tx(g3)}}{${tx(gE)}} = ${tx(k)}`,
            why: r`同一個數字，兩種讀法換回的 loop gain 差這麼多倍；$f_{\mathrm{BW}}\ll f_u$ 時趨近 $\pi/2=1.5708$。`,
          },
        ],
        results: [
          { symbol: 'p', label: r`讀法 (a)：當成 $-3\ \mathrm{dB}$ corner 時的 pole`, value: p3, digits: 6, tolerance: { rel: 0.002, abs: 1e-6 } },
          { symbol: 'g', label: r`讀法 (a) 的 loop gain`, value: g3, tolerance: { rel: 0.02, abs: 1e-6 } },
          { symbol: 'g_E', label: r`讀法 (b)：當成 ENBW 時的 loop gain`, value: gE, tolerance: { rel: 0.02, abs: 1e-6 } },
          { symbol: 'g/g_E', label: '兩種讀法的 loop gain 比值', value: k, tolerance: { rel: 0.02 } },
        ],
        notes: [
          r`驗算（代回正向的 F-PR.9，由網站的 calBandwidths 計算）：$p=${tx(p3, S)}$ 的 $f_{3\mathrm{dB}}=${tx(back3.f3dbExact, S)}$、$\mathrm{ENBW}=${tx(back3.enbw, S)}$；$p_E=${tx(pE, S)}$ 的 ${
            Number.isFinite(backE.f3dbExact) ? r`$f_{3\mathrm{dB}}=${tx(backE.f3dbExact, S)}$` : r`$-3\ \mathrm{dB}$ 點不存在（$p_E<3-2\sqrt2$，勘誤 E27）`
          }、$\mathrm{ENBW}=${tx(backE.enbw, S)}$（單位同 $f_{\mathrm{BW}}$）。`,
          r`常見的近似 $g\approx2\pi f_{\mathrm{BW}}/f_u=${tx(small)}$（把 $-3\ \mathrm{dB}$ 點當成 $(1-p)f_u/2\pi$）比讀法 (a) 的精確值高估 $${tx((small / g3 - 1) * 100, 3)}\%$；$f_{\mathrm{BW}}/f_u$ 越大差越多。`,
          r`換回本站的 1-bit GMAC：$\mu=g/(K_qC)$。以 D1 面板的 $\sigma_v=${HC_SIGMA_V_FS}\ \mathrm{fs}$、$C=1$ 為例，$\mu=${tx(muFs)}\ \mathrm{fs}$。`,
        ],
      }
    },
    tips: [
      r`範例數字（$f_{\mathrm{BW}}=12.93\ \mathrm{kHz}$、$f_u=4\ \mathrm{GHz}/4096=976.5625\ \mathrm{kHz}$）是驗收項 T14 的 exact $-3\ \mathrm{dB}$ 頻率：讀法 (a) 換回 $p\approx0.9202$、$g\approx0.0798$，就是 T13 的迴路（$\mu\approx10\ \mathrm{fs}$）。若誤當成 ENBW，$g$ 只有 $0.0516$。`,
      r`沒有 DEG 模式時改用弧度：$\Omega/2=\pi f_{\mathrm{BW}}/f_u$（$\pi=3.14159$），計算機切到 RAD 再按 $\sin$。`,
      r`所有接近 $1$ 的數（$\sqrt{1+\beta^2}$、$\sqrt p$、$p$）至少留 6 位：$g=1-p$ 是兩個接近的數相減，位數不夠時 $g$ 會差到第 2 位。`,
      r`兩種讀法的比值 $g/g_E$ 只在 $f_{\mathrm{BW}}\ll f_u$ 時接近 $\pi/2$：$f_{\mathrm{BW}}=0.1f_u$ 時是 $1.37$，$f_{\mathrm{BW}}\approx0.32f_u$ 時降到 $1$，再接近 Nyquist 就小於 $1$。`,
      r`讀論文時先找它的 bandwidth 定義：$-3\ \mathrm{dB}$、noise bandwidth（ENBW）、還是 $1/(2\pi\tau)$；找不到時兩種都算，當成不確定範圍。`,
    ],
  },

  // ───────────────────────── HC-PR.5：書上的步長 + 更新延遲（F-PR.4，D3） ─────────────────────────
  {
    id: 'HC-PR.5',
    title: r`極性正確就安全嗎？把書上的 $\mu_W$ 換成 $g$，再和 $g^*(d)$ 比`,
    page: '/papers',
    formulaId: 'F-PR.4',
    // 兩行（一行比桌機欄寬多出十幾 px，會出現橫向捲軸）：迴路增益與臨界值；phase margin 與步長上限
    formulaTex: r`\begin{aligned}&g=2\mu_W\lambda_{\max},\qquad g^*(d)=2\sin\frac{180^\circ}{4d+2}\\[2pt]&\mathrm{PM}_d=90^\circ-(2d+1)\arcsin\frac g2,\qquad \mu_{W,\max}(d)=\frac{g^*(d)}{2\lambda_{\max}}\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'muW', symbol: r`\mu_W`, label: '書上的步長（Widrow 型）', default: 0.35, min: -100, max: 100, practice: { choices: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.45] } },
      { key: 'lmax', symbol: r`\lambda_{\max}`, label: '最大特徵值', default: 1, min: -1000, max: 1000, practice: { choices: [0.5, 1, 2] } },
      { key: 'd', symbol: 'd', label: '更新延遲（block）', default: 2, min: 0, max: 6, integer: true, practice: { choices: [0, 1, 2, 3, 4] } },
    ],
    validate: ({ muW, lmax }) => {
      if (lmax <= 0) return r`$\lambda_{\max}\le 0$：沒有激勵（不可辨識）。請輸入正的 $\lambda_{\max}$。`
      if (muW <= 0) return r`$\mu_W\le0$：$g\le0$，更新極性錯誤或完全不更新；延遲再短也不會收斂。請輸入正的 $\mu_W$。`
      const g = 2 * muW * lmax
      if (g > 2) return r`$g=2\mu_W\lambda_{\max}=${tx(g)}>2$：連沒有延遲的一階迴路都發散（$p=1-g<-1$），$\arcsin(g/2)$ 沒有定義。請把 $\mu_W$ 調小。`
      return null
    },
    solve: ({ muW, lmax, d }) => {
      const mu = gainScale({ ...CTX, convention: 'widrow', mu: muW, polarity: 1 })
      const g = mu * lmax
      const m = 4 * d + 2
      const angle = 180 / m
      const sinA = Math.sin(Math.PI / m)
      const gStar = criticalGain(d)
      const gm = gStar / g
      const half = g / 2
      const alpha = Math.asin(Math.min(1, half)) / DEG
      const lag = (2 * d + 1) * alpha
      const pm = snap(pmWithDelayDeg(g, d), 90, lag)
      const muWMax = muForScale(gStar / lmax, 'widrow', CTX)
      const radius = delaySpectralRadius(g, d)
      const kPm = sigFor(pm, 90, lag)
      return {
        steps: [
          { tex: r`\mu = 2\,\mu_W = 2\times${tx(muW)} = ${tx(mu)}`, why: r`先換成本站的寫法（HC-PR.1）。` },
          { tex: r`g = \mu\,\lambda_{\max} = ${tx(mu)}\times${tx(lmax)} = ${tx(g)}`, why: '最快 mode 的 loop gain。' },
          {
            tex: r`\theta^* = \frac{180^\circ}{4d+2} = \frac{180^\circ}{4\times${txInt(d)}+2} = \frac{180^\circ}{${txInt(m)}} = ${tx(angle)}^\circ`,
            why: r`臨界時 pole 落在單位圓上的角度 $\omega^*=\pi/(2d+1)$ 的一半，換成度。`,
          },
          {
            tex: r`\sin\theta^* = \sin(${tx(angle)}^\circ) = ${tx(sinA)}`,
            why: r`計算機切到 DEG 模式按 $\sin$。$d$ 大時可用 $\sin\theta\approx\theta$（弧度）$=\pi/(4d+2)$，$d\ge3$ 時誤差小於 $1\%$。`,
          },
          {
            tex: r`g^*(${txInt(d)}) = 2\sin\theta^* = 2\times${tx(sinA)} = ${tx(gStar)}`,
            why: r`更新延遲 $d$ 個 block 時 loop gain 的上限（$d=0$ 時是 $2$）。`,
          },
          {
            tex: r`\frac{g^*}{g} = \frac{${tx(gStar)}}{${tx(g)}} = ${tx(gm)}`,
            why: r`gain margin（倍數）：大於 $1$ 才穩定。`,
          },
          {
            tex: r`\alpha = \arcsin\frac{g}{2} = \arcsin\frac{${tx(g)}}{2} = \arcsin(${tx(half)}) = ${tx(alpha, kPm)}^\circ`,
            why: r`crossover 頻率的一半：$\omega_c=2\arcsin(g/2)$。先除以 $2$，再用 DEG 模式按 $\sin^{-1}$。$g/2\le0.24$ 時可用 $\arcsin x\approx57.296^\circ\times x$（誤差小於 $1\%$）。`,
          },
          {
            tex: r`(2d+1)\,\alpha = ${txInt(2 * d + 1)}\times${tx(alpha, kPm)}^\circ = ${tx(lag, kPm)}^\circ`,
            why: r`在 crossover 的總相位落後（扣掉積分器固定的 $90^\circ$ 之後）：每多一個 block 的延遲，多吃掉 $2\alpha$。`,
          },
          {
            tex: r`\mathrm{PM}_{${txInt(d)}} = 90^\circ - (2d+1)\,\alpha = 90^\circ - ${tx(lag, kPm)}^\circ = ${tx(pm)}^\circ`,
            why: r`phase margin：正的才穩定；它和上面的 $g^*/g>1$ 是同一個條件。`,
          },
          {
            tex: r`\mu_{W,\max} = \frac{g^*}{2\,\lambda_{\max}} = \frac{${tx(gStar)}}{2\times${tx(lmax)}} = \frac{${tx(gStar)}}{${tx(2 * lmax)}} = ${tx(muWMax)}`,
            why: r`把上限換回書上的寫法：這就是 §5 實驗「此寫法的步長上限」那一列。`,
          },
        ],
        results: [
          { symbol: 'g', label: '最快 mode 的 loop gain', value: g },
          { symbol: r`g^*(d)`, label: '臨界 loop gain', value: gStar },
          { symbol: r`\mathrm{PM}_d`, label: 'phase margin', value: pm, unit: r`{}^\circ`, tolerance: { rel: 0.02, abs: 0.1 } },
          { symbol: r`\mu_{W,\max}`, label: '書上寫法的步長上限', value: muWMax },
        ],
        notes: [
          g < gStar
            ? r`$g=${tx(g)}<g^*=${tx(gStar)}$、$\mathrm{PM}>0$：平均誤差收斂。網站直接解特徵多項式 $z^{d+1}-z^d+g=0$ 得到 $|z|_{\max}=${tx(radius)}<1$。`
            : r`$g=${tx(g)}\ge g^*=${tx(gStar)}$、$\mathrm{PM}\le0$：極性正確（$g>0$）仍然不收斂。網站直接解特徵多項式 $z^{d+1}-z^d+g=0$ 得到 $|z|_{\max}=${tx(radius)}\ge1$。${d > 0 ? r`把 $d$ 改成 $0$ 再算一次，同一個步長就穩定了。` : ''}`,
          r`$g^*(d)$ 與 $\mathrm{PM}_d$ 是同一件事的兩種算法：$g=g^*$ 時 $\alpha=\theta^*$，$\mathrm{PM}=90^\circ-(2d+1)\theta^*=0$。`,
        ],
      }
    },
    tips: [
      r`範例數字（$\mu_W=0.35$、$\lambda_{\max}=1$、$d=2$）就是 D3 面板的例子：$g=0.7>g^*(2)=0.618$，$\mathrm{PM}=-12.44^\circ$，$|z|_{\max}=1.0369$。`,
      r`常用值：$g^*(0)=2$、$g^*(1)=2\sin30^\circ=1$、$g^*(2)=2\sin18^\circ=0.61803$、$g^*(3)=2\sin12.857^\circ=0.44504$。`,
      r`$d$ 大時 $\sin\theta\approx\theta$（弧度）：$g^*(d)\approx\pi/(2d+1)$，$d\ge3$ 時誤差小於 $1\%$。`,
      r`若迴路是本站的 1-bit GMAC，把第 1、2 步換成 $g=\mu K_q\lambda_{\max}$（HC-PR.3），後面完全一樣。`,
    ],
  },

  // ───────────────────────── HC-PR.6：1-bit dither 打不散 limit cycle（F-PR.14，D5） ─────────────────────────
  {
    id: 'HC-PR.6',
    title: r`$\pm\tfrac12\ \mathrm{LSB}$ 的 1-bit dither：手算 ${HC_DITHER_STEPS} 拍，驗證 $y[n]=y_{\mathrm{floor}}[n]+b[n]-b[n-1]$`,
    page: '/papers',
    formulaId: 'F-PR.14',
    // 四行（原本兩行，每行都比桌機欄寬長，會出現橫向捲軸）：左邊是哪一個版本，右邊是它的三條式子
    formulaTex: r`\begin{aligned}\xi[n]=b[n]-\tfrac12:\quad&v[n]=c+r[n-1],\quad y[n]=\big\lfloor v[n]+\xi[n]+\tfrac12\big\rfloor=\lfloor v[n]+b[n]\rfloor,\\&r[n]=v[n]-y[n]\\[4pt]\text{不加 dither 的 floor 版：}\quad&v_{\mathrm f}[n]=c+\varphi[n-1],\quad y_{\mathrm{floor}}[n]=\lfloor v_{\mathrm f}[n]\rfloor,\\&\varphi[n]=v_{\mathrm f}[n]-y_{\mathrm{floor}}[n]\end{aligned}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'c', symbol: 'c', label: '高解析度的常數目標（最多兩位小數）', unit: r`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: [32.4, 32.25, 32.5, 32.7, 20.2, 40.75, 12.6] } },
      { key: 'b0', symbol: 'b[0]', label: '第 0 拍的 dither bit（0 或 1）', default: 1, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b1', symbol: 'b[1]', label: '第 1 拍的 dither bit', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b2', symbol: 'b[2]', label: '第 2 拍的 dither bit', default: 1, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b3', symbol: 'b[3]', label: '第 3 拍的 dither bit', default: 1, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
    ],
    validate: ({ c }) => {
      if (c < 1 || c >= MAX_CODE - 1)
        return r`請輸入 $1\le c<62$：加了 dither 之後 $v=c+r$ 會落在 $(c-1,\,c+1)$，輸出 code 可能用到 $\lfloor c\rfloor-1$ 到 $\lfloor c\rfloor+2$；超出 6-bit 的 $0\ldots63$ 時量化器飽和（overload），殘值不再有界，這一題的恆等式與本頁「有限狀態」的結論都不成立。`
      if (Math.abs(c * HC_DITHER_DEN - Math.round(c * HC_DITHER_DEN)) > 1e-7)
        return r`$c$ 請輸入最多兩位小數的數（例如 $32.4$、$32.25$）：手算與網站都用精確的分數運算，$v$ 剛好落在整數上時才不會被捨入誤差騙到（勘誤 E15）。`
      return null
    },
    solve: ({ c, b0, b1, b2, b3 }) => {
      const den = HC_DITHER_DEN
      const cNum = Math.round(c * den)
      const bits = [b0, b1, b2, b3]
      const dith = efQuantize(cNum, den, HC_DITHER_STEPS, { ditherNum: prbsHalfLsbDither(bits, den), shaped: true })
      const flr = efQuantize(cNum, den, HC_DITHER_STEPS, { rounding: 'floor' })
      const cc = cNum / den
      const steps: HandCalcStep[] = []
      for (let n = 0; n < HC_DITHER_STEPS; n++) {
        const rPrev = n === 0 ? 0 : dith.rNum[n - 1] / den
        const v = (cNum + (n === 0 ? 0 : dith.rNum[n - 1])) / den
        const yn = dith.y[n]
        const rn = dith.rNum[n] / den
        steps.push({
          tex: r`\begin{aligned}v[${n}]&=c+r[${n - 1}]=${tx(cc)}+${txP(rPrev)}=${tx(v)}\\ y[${n}]&=\lfloor v[${n}]+b[${n}]\rfloor=\lfloor ${tx(v)}+${bits[n]}\rfloor=\lfloor ${tx(clean(v + bits[n], v))}\rfloor=${txInt(yn)}\\ r[${n}]&=v[${n}]-y[${n}]=${tx(v)}-${txInt(yn)}=${tx(rn)}\end{aligned}`,
          why:
            n === 0
              ? r`加 dither 的量化器，第 0 拍（$r[-1]=0$）：加回上一拍的殘值 $\to$ 加上 dither bit 再往下取整（$\xi+\tfrac12=b$，所以 round-half-up 變成 $\lfloor v+b\rfloor$）$\to$ 記下殘值。`
              : r`第 ${n} 拍：同樣三步，用上一拍的 $r[${n - 1}]$。$b[${n}]=${bits[n]}$${bits[n] === 1 ? '：這一拍多進一位。' : '：這一拍就是單純的 floor。'}`,
        })
      }
      for (let n = 0; n < HC_DITHER_STEPS; n++) {
        const pPrev = n === 0 ? 0 : flr.rNum[n - 1] / den
        const v = (cNum + (n === 0 ? 0 : flr.rNum[n - 1])) / den
        const yn = flr.y[n]
        const pn = flr.rNum[n] / den
        steps.push({
          tex: r`\begin{aligned}v_{\mathrm f}[${n}]&=c+\varphi[${n - 1}]=${tx(cc)}+${tx(pPrev)}=${tx(v)}\\ y_{\mathrm{floor}}[${n}]&=\lfloor v_{\mathrm f}[${n}]\rfloor=\lfloor ${tx(v)}\rfloor=${txInt(yn)}\\ \varphi[${n}]&=v_{\mathrm f}[${n}]-y_{\mathrm{floor}}[${n}]=${tx(v)}-${txInt(yn)}=${tx(pn)}\end{aligned}`,
          why:
            n === 0
              ? r`對照組：同一個目標、不加 dither、floor 量化（$\varphi[-1]=0$）。$\varphi$ 永遠落在 $[0,1)$，就是 $v_{\mathrm f}$ 的小數部分。`
              : r`對照組第 ${n} 拍。對照上面加 dither 的第 ${n} 拍：$r[${n}]=\varphi[${n}]-b[${n}]$，兩個量化器的小數狀態完全相同。`,
        })
      }
      const lines = bits.map((b, n) => {
        const bPrev = n === 0 ? 0 : bits[n - 1]
        return r`y[${n}]-y_{\mathrm{floor}}[${n}]&=${txInt(dith.y[n])}-${txInt(flr.y[n])}=${txInt(dith.y[n] - flr.y[n])},&\quad b[${n}]-b[${n - 1}]&=${b}-${bPrev}=${txInt(b - bPrev)}\ \checkmark`
      })
      const sumD = dith.y.reduce((a, yv) => a + yv, 0)
      const sumF = flr.y.reduce((a, yv) => a + yv, 0)
      const last = HC_DITHER_STEPS - 1
      const rLast = dith.rNum[last] / den
      steps.push(
        {
          tex: r`\begin{aligned}${lines.join(r`\\ `)}\end{aligned}`,
          why: r`逐拍比較（$b[-1]=0$）：兩個輸出的差永遠等於 dither bit 的差分，和目標 $c$ 的小數部分無關。這就是 F-PR.14。`,
        },
        { tex: r`\sum_{n=0}^{${last}}y[n] = ${Array.from(dith.y).join('+')} = ${txInt(sumD)}`, why: '把加 dither 的四個 code 加起來。' },
        { tex: r`\sum_{n=0}^{${last}}y_{\mathrm{floor}}[n] = ${Array.from(flr.y).join('+')} = ${txInt(sumF)}`, why: '對照組的四個 code。' },
        {
          tex: r`\sum_{n=0}^{${last}}\big(y[n]-y_{\mathrm{floor}}[n]\big) = ${txInt(sumD)}-${txInt(sumF)} = ${txInt(sumD - sumF)} = b[${last}]-b[-1]`,
          why: r`差分相加後相鄰項抵消（telescoping），只剩頭尾：dither 對輸出總和的貢獻最多 $\pm1$，不會隨時間累積。`,
        },
      )
      const differs = dith.y.some((yv, n) => yv !== flr.y[n])
      return {
        steps,
        results: [
          { symbol: r`\textstyle\sum_{n=0}^{${last}}y[n]`, label: '加 dither 的四個 code 的和（整張表對了，它才會對）', value: sumD, digits: 12, tolerance: { abs: 1e-6, rel: 0 } },
          { symbol: r`\textstyle\sum_{n=0}^{${last}}y_{\mathrm{floor}}[n]`, label: '對照組（不加 dither、floor）四個 code 的和', value: sumF, digits: 12, tolerance: { abs: 1e-6, rel: 0 } },
          { symbol: `r[${last}]`, label: '加 dither 的量化器最後一拍的殘值', value: rLast, unit: r`\mathrm{LSB}`, tolerance: { abs: 1e-3, rel: 0.01 } },
        ],
        notes: [
          r`輸出序列 $y=[${Array.from(dith.y).join(',')}]$、對照組 $y_{\mathrm{floor}}=[${Array.from(flr.y).join(',')}]$。${differs ? r`兩者不同，但差別只有 $b[n]-b[n-1]\in\{-1,0,1\}$。` : r`這組 dither bit 剛好讓兩者完全相同。`}`,
          r`$y_{\mathrm{floor}}$ 就是不加 dither 的 limit cycle（譜線位置與大小都一樣）；$b[n]-b[n-1]$ 只是在它上面疊加 PRBS 的差分。所以準位相差整整 1 LSB 的 dither 打不散 limit cycle，總誤差功率反而變大。`,
          r`本頁的 D5 面板用週期 127 的 PRBS-7 當 $b[n]$，測試以 1270 拍逐點驗證同一個恆等式；這裡的 4 個 bit 由你自己指定。`,
        ],
      }
    },
    tips: [
      r`畫兩張三欄的表（$v$、$y$、殘值），每一列只有一次加法、一次取整、一次減法。範例（$c=32.4$、$b=[1,0,1,1]$）：$y=[33,31,34,32]$、$y_{\mathrm{floor}}=[32,32,33,32]$。`,
      r`$\lfloor\cdot\rfloor$ 是往下取整：$\lfloor31.8\rfloor=31$、$\lfloor33\rfloor=33$。殘值 $r$ 可以是負的（$b=1$ 多進了一位），$\varphi$ 一定在 $[0,1)$。`,
      r`把四個 bit 全部填 $0$：$y$ 與 $y_{\mathrm{floor}}$ 逐拍相同。全部填 $1$：只有第 0 拍多 $1$（$b[0]-b[-1]=1$），之後完全相同。`,
      r`想打散 limit cycle，dither 的準位必須比 1 LSB 細（本頁 D5 的 7-bit PRBS 字）；那時 $\lfloor v+\xi+\tfrac12\rfloor$ 不能再拆成 $\lfloor v\rfloor$ 加整數，小數狀態才會被擾動。`,
    ],
  },

  // ───────────────────────── HC-PR.7：三種量化做法的誤差功率（F-PR.13，D6） ─────────────────────────
  {
    id: 'HC-PR.7',
    title: '不加 dither、non-subtractive、subtractive：誤差功率各是多少',
    page: '/papers',
    formulaId: 'F-PR.13',
    formulaTex: r`f=c-\lfloor c\rfloor,\qquad P_{\mathrm{none}}=\big(Q(c)-c\big)^2,\qquad P_{\mathrm{ns}}=f(1-f),\qquad P_{\mathrm{s}}=\frac1{12}\qquad[\mathrm{LSB}^2]`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'c', symbol: 'c', label: '高解析度的目標值', unit: r`\mathrm{LSB}`, default: 32.4, min: -100, max: 200, practice: { choices: [32.4, 32.25, 17.5, 40.9, 12.1, 20.75, 33] } },
    ],
    validate: ({ c }) =>
      c < 0 || c > MAX_CODE
        ? r`請輸入 $0\le c\le63$：6-bit 的 code 只有 $0\ldots63$。目標超出這個範圍時量化器飽和，誤差是 $c$ 到邊界的距離，加 dither 也救不回來；$f(1-f)$ 與 $\tfrac1{12}$ 都不適用。`
        : null,
    solve: ({ c }) => {
      const pw = ditherErrorPowers(c)
      const lo = Math.floor(c)
      // 顯示用：相減的結果去掉 double 的捨入殘渣（32.4 − 32 → 0.4、63 − 62.999 → 0.001）
      const f = clean(pw.f, c)
      const e0 = clean(pw.q - c, c)
      const oneMinusF = clean(1 - f, 1)
      const rms0 = Math.abs(e0)
      const rmsS = Math.sqrt(pw.subtractivePower)
      return {
        steps: [
          { tex: r`\lfloor c\rfloor = \lfloor ${tx(c)}\rfloor = ${txInt(lo)}`, why: '整數部分（往下取整）。' },
          { tex: r`f = c - \lfloor c\rfloor = ${tx(c)} - ${txInt(lo)} = ${tx(f)}`, why: '小數部分：目標離下面那個 code 有多遠。' },
          {
            tex: r`Q(c) = \big\lfloor c+\tfrac12\big\rfloor = \lfloor ${tx(c)}+0.5\rfloor = \lfloor ${tx(clean(c + 0.5, c))}\rfloor = ${txInt(pw.q)}`,
            why: r`round-half-up：加 $\tfrac12$ 再往下取整（$f\ge\tfrac12$ 時進位）。`,
          },
          { tex: r`e_0 = Q(c) - c = ${txInt(pw.q)} - ${tx(c)} = ${tx(e0)}`, why: '不加 dither：輸出永遠是同一個 code，誤差是常數（全部在 DC）。' },
          { tex: r`P_{\mathrm{none}} = e_0^2 = ${txSq(e0)} = ${tx(pw.nonePower)}`, why: '常數誤差的功率。' },
          {
            tex: r`P_{\mathrm{ns}} = f\,(1-f) = ${tx(f)}\times(1-${tx(f)}) = ${tx(f)}\times${tx(oneMinusF)} = ${tx(pw.nonSubtractivePower)}`,
            why: r`non-subtractive：以機率 $f$ 進位、$1-f$ 不進位的兩點分布；平均剛好是 $c$（無偏），變異數是 $f(1-f)$。`,
          },
          {
            tex: r`P_{\mathrm{s}} = \frac{1}{12} = ${tx(pw.subtractivePower)}`,
            why: r`subtractive：把 dither 減回去之後，誤差在 $(-\tfrac12,\tfrac12]$ 均勻分布，$\int_{-1/2}^{1/2}e^2\,de=\tfrac1{12}$，與 $c$ 無關。`,
          },
        ],
        results: [
          { symbol: r`P_{\mathrm{none}}`, label: '不加 dither', value: pw.nonePower, unit: r`\mathrm{LSB}^2`, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: r`P_{\mathrm{ns}}`, label: 'non-subtractive dither', value: pw.nonSubtractivePower, unit: r`\mathrm{LSB}^2`, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: r`P_{\mathrm{s}}`, label: 'subtractive dither', value: pw.subtractivePower, unit: r`\mathrm{LSB}^2` },
        ],
        notes: [
          f === 0
            ? r`$c$ 剛好是整數：不加 dither 時誤差是 $0$，non-subtractive 也不會進位；這時 subtractive 的 $\tfrac1{12}$ 反而最差。`
            : r`$P_{\mathrm{ns}}\ge P_{\mathrm{none}}$ 永遠成立（$f(1-f)\ge\min(f,1-f)^2$）：non-subtractive 的總誤差功率比不加還大，換到的是「沒有 DC 誤差」。`,
          pw.subtractivePower < pw.nonePower
            ? r`這個 $c$ 下 $|e_0|=${tx(rms0)}>1/\sqrt{12}=${tx(rmsS)}$：subtractive 的 $\tfrac1{12}$ 比不加 dither 的 $${tx(pw.nonePower)}$ 小，但它需要比 1 LSB 更細的解析度把 dither 減回去。`
            : r`這個 $c$ 離 code 很近（$|e_0|=${tx(rms0)}\le1/\sqrt{12}=${tx(rmsS)}$），不加 dither 的誤差功率不比 subtractive 大。`,
        ],
      }
    },
    tips: [
      r`範例數字（$c=32.4$）：$0.16\ /\ 0.24\ /\ 0.0833\ \mathrm{LSB}^2$，其中 $0.24$ 就是驗收項 T17（$P(33)=0.4$ 的隨機進位）的變異數，也是本頁 D6 指標表的解析值。`,
      r`$f(1-f)$ 在 $f=\tfrac12$ 時最大（$0.25$），在 $f=0$ 時為 $0$。`,
      r`$1/12=0.083333$；對應的 RMS 是 $1/\sqrt{12}=0.28868\ \mathrm{LSB}$。`,
    ],
  },

  // ───────────────────────── HC-PR.8：綜合——換算步長 → eigen-mode → 598 步（F-PR.11，§8 之前） ─────────────────────────
  {
    id: 'HC-PR.8',
    title: r`綜合：書上的 $\mu_W$、兩個相關的參數，最慢的 mode 要幾步`,
    page: '/papers',
    formulaId: 'F-PR.11',
    formulaTex: r`\mu=2\mu_W,\qquad \lambda_{\max,\min}=P_x(1\pm|\rho|),\qquad p_i=1-\mu\lambda_i,\qquad |p|_{\mathrm{slow}}=\max_i|p_i|,\qquad N_{95\%}=\left\lceil\frac{\ln 0.05}{\ln|p|_{\mathrm{slow}}}\right\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'muW', symbol: r`\mu_W`, label: '書上的步長（Widrow 型）', default: 0.25, min: -100, max: 100, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.4] } },
      { key: 'rho', symbol: r`\rho`, label: '兩個參數 regressor 的相關係數', default: 0.99, min: -1, max: 1, practice: { choices: [0, 0.5, 0.8, 0.9, 0.95, 0.99, -0.9] } },
      { key: 'Px', symbol: 'P_x', label: 'regressor 功率', default: 1, min: -1000, max: 1000, practice: { choices: [0.5, 1, 1] } },
    ],
    validate: ({ muW, rho, Px }) => {
      if (Px <= 0) return r`$P_x\le0$：regressor 沒有功率，兩個參數都不可辨識。請輸入正的 $P_x$。`
      if (muW <= 0) return r`$\mu_W\le0$：不更新或極性接反，沒有「幾步收斂」可言。請輸入正的 $\mu_W$。`
      if (Math.abs(rho) >= 1) return r`$|\rho|=1$：$\lambda_{\min}=P_x(1-|\rho|)=0$，兩個 regressor 完全相關，有一個方向的誤差 GMAC 完全看不到（不可辨識），$N_{95\%}=\infty$。請輸入 $|\rho|<1$。`
      const gFast = 2 * muW * Px * (1 + Math.abs(rho))
      if (gFast >= 2 * (1 - 1e-12)) return r`$\mu\lambda_{\max}=${tx(gFast)}\ge2$：$\lambda_{\max}$ 那個 mode 已經不收斂（$|p|\ge1$），幾步收斂沒有意義。請把 $\mu_W$ 調小（需 $\mu_W<1/\lambda_{\max}$）。`
      return null
    },
    solve: ({ muW, rho, Px }) => {
      const mu = gainScale({ ...CTX, convention: 'widrow', mu: muW, polarity: 1 })
      const eig = corr2Eigs(Px, rho)
      const ex = eigenExample(rho, mu, 0.5, Px)
      const ar = Math.abs(rho)
      // 顯示用：1 − |ρ|、1 − μλ 這些相減的結果去掉 double 的捨入殘渣（1 − 0.99 → 0.01，不是 0.010000000000000009）
      const onePlus = clean(1 + ar, 1)
      const oneMinus = clean(1 - ar, 1)
      const lmax = clean(eig.lmax, Px)
      const lmin = clean(eig.lmin, Px)
      const gMax = mu * lmax
      const gMin = mu * lmin
      const p1 = clean(ex.pFast, 1, gMax)
      const p2 = clean(ex.pSlow, 1, gMin)
      const a1 = Math.abs(p1)
      const a2 = Math.abs(p2)
      const aSlow = Math.max(a1, a2)
      const slowIsMin = a2 >= a1
      // 步數由模型的 pole 直接計算（顯示用的 p₁、p₂ 只去掉 double 的尾巴）：λ_min 的 mode 最慢時就是 eigenExample 的 stepsSlow
      const n95 = slowIsMin ? ex.stepsSlow : stepsToDecay(Math.abs(ex.pFast))
      // |p| 很接近 1 時，ln|p| 對最後幾位很敏感：多顯示幾位，畫面上的 ln 才對得起來
      const kS = Math.max(8, sigFor(1 - aSlow, 1, aSlow))
      const kG1 = sigFor(p1, 1, gMax)
      const kG2 = Math.max(sigFor(p2, 1, gMin), kS - 3)
      const steps: HandCalcStep[] = [
        { tex: r`\mu = 2\,\mu_W = 2\times${tx(muW)} = ${tx(mu)}`, why: '先換成本站寫法（HC-PR.1）。' },
        {
          tex: r`\lambda_{\max} = P_x\,(1+|\rho|) = ${tx(Px)}\times(1+${tx(ar)}) = ${tx(Px)}\times${tx(onePlus)} = ${tx(lmax)}`,
          why: r`$\mathbf R=P_x\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}$ 的兩個特徵值之一（特徵向量 $[1,\pm1]^T$）。${rho < 0 ? r`$\rho<0$ 時取絕對值：$|\rho|=${tx(ar)}$。` : ''}`,
        },
        {
          tex: r`\lambda_{\min} = P_x\,(1-|\rho|) = ${tx(Px)}\times(1-${tx(ar)}) = ${tx(Px)}\times${tx(oneMinus)} = ${tx(lmin)}`,
          why: r`兩個 regressor 越像（$|\rho|\to1$），這個方向的資訊越少。`,
        },
        {
          tex: r`p_1 = 1-\mu\,\lambda_{\max} = 1-${tx(mu)}\times${tx(lmax)} = 1-${tx(gMax, kG1)} = ${tx(p1, kS)}`,
          why: r`$\lambda_{\max}$ 那個 mode 的 pole：決定「穩不穩定」（需 $|p_1|<1$）。`,
        },
        {
          tex: r`p_2 = 1-\mu\,\lambda_{\min} = 1-${tx(mu)}\times${tx(lmin)} = 1-${tx(gMin, kG2)} = ${tx(p2, kS)}`,
          why: r`$\lambda_{\min}$ 那個 mode 的 pole：通常最接近 $1$，請多留幾位。`,
        },
        {
          tex: r`|p|_{\mathrm{slow}} = \max\big(|p_1|,\,|p_2|\big) = \max(${tx(a1, kS)},\ ${tx(a2, kS)}) = ${tx(aSlow, kS)}`,
          why: slowIsMin
            ? r`絕對值大的那個衰減得慢：這裡是 $\lambda_{\min}$ 的 mode（最常見的情況）。`
            : r`絕對值大的那個衰減得慢：這裡 $\mu$ 夠大，$\lambda_{\max}$ 的 mode 過衝（$p_1<0$）而且 $|p_1|>|p_2|$，最慢的反而是它。`,
        },
      ]
      if (aSlow > 0) {
        const lnP = Math.log(aSlow)
        const lnF = Math.log(0.05)
        steps.push(
          {
            tex: r`\ln|p|_{\mathrm{slow}} = \ln(${tx(aSlow, kS)}) = ${tx(lnP)}`,
            why: r`計算機按 $\ln$。$|p|$ 接近 $1$ 時可用 $\ln(1-\epsilon)\approx-\epsilon-\epsilon^2/2$（$\epsilon\le0.02$ 時只取 $-\epsilon$ 的誤差約 $1\%$）。`,
          },
          {
            tex: r`N_{95\%} = \left\lceil\frac{\ln 0.05}{\ln|p|_{\mathrm{slow}}}\right\rceil = \left\lceil\frac{${tx(lnF)}}{${tx(lnP)}}\right\rceil = \lceil ${txCeilArg(lnF / lnP, n95)}\rceil = ${txInt(n95)}`,
            why: r`$|p|^N\le0.05$ 兩邊取 $\ln$（除以負數要變號），再無條件進位。$\ln0.05=-2.9957$。`,
          },
        )
      } else {
        steps.push({ tex: r`|p|_{\mathrm{slow}} = 0\ \Longrightarrow\ N_{95\%} = ${txInt(n95)}`, why: r`兩個 mode 都一步歸零，不需要取 $\ln$。` })
      }
      return {
        steps,
        results: [
          { symbol: r`\mu`, label: '本站寫法的步長', value: mu },
          { symbol: r`|p|_{\mathrm{slow}}`, label: '最慢 mode 的 pole 大小', value: aSlow, digits: 8, tolerance: { rel: 0.001, abs: 1e-6 } },
          { symbol: r`N_{95\%}`, label: '最慢 mode 衰減 95% 的步數', value: n95, digits: 12, tolerance: { rel: 0.02, abs: 1 } },
        ],
        notes: [
          r`eigenvalue spread $\lambda_{\max}/\lambda_{\min}=${tx(lmax / lmin)}$：步長被最大的 $\lambda$ 限制，速度通常被最小的 $\lambda$ 拖住。`,
          r`這是 mean recursion 的步數（block 平均、$K_q$ 正規化為 $1$）；若 $\mu$ 是 $\mathrm{fs}$、$K_q$ 是 $\mathrm{fs^{-1}}$，要先乘起來變成無因次的 $s$ 再代入（HC-PR.3、勘誤 E05）。`,
        ],
      }
    },
    tips: [
      r`範例數字（$\mu_W=0.25$、$\rho=0.99$、$P_x=1$）是驗收項 T11，也是 §5 實驗的第一個 preset：$p_2=0.995$、$N_{95\%}=598$。`,
      r`$\ln0.05=-2.9957$；$\ln0.995=-0.0050125$。快速估算：$N_{95\%}\approx3/(\mu\lambda_{\min})$，本例是 $3/0.005=600$。`,
      r`把 $\rho$ 改成 $0$：兩個 mode 一樣快，$N_{95\%}$ 只要幾步。這就是 preconditioning（$\mathbf M=\gamma\mathbf R^{-1}$）想達到的效果。`,
      r`把 $\mu_W$ 改成 $0.6$、$\rho$ 改成 $0.5$：$p_1=-0.8$、$p_2=0.4$，最慢的變成 $\lambda_{\max}$ 的 mode——步長太大時，「快模式」會因為過衝而拖得更久。`,
    ],
  },
]

export function handcalc(id: string): HandCalcDef {
  const h = HANDCALCS.find((x) => x.id === id)
  if (!h) throw new Error(`找不到手算題 ${id}`)
  return h
}
