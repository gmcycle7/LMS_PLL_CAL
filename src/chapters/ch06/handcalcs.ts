import { texNum } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import { ctBandwidth3dB } from '@/simulation/models/pll'
import {
  autocorrCorrelation,
  calPole,
  ctHpd,
  designPolarityLoop,
  kqFromSigma,
  lineCorrelation,
  linePower,
  polarityMarginDeg,
  sawtoothAutocorr,
  sawtoothMomentApprox,
  SQRT_2_OVER_PI,
  stableMuRange,
  toneCorrelation,
  toneHandTable,
  toneLargeErrorGain,
} from '@/simulation/models/polarity'
import { impulseResponse } from '@/simulation/signal'

/**
 * 第 06 章的「帶入手算」題（docs/teaching-style.md §7）。
 *  - solve() 的數值一律來自 src/simulation/models/polarity.ts（與 pll.ts）的實際函式；
 *    這裡只把數字排成「符號式 = 代入 = 結果」，中間的乘加只是把同一個式子拆開顯示。
 *  - 極性一律 δ = a − w；H_PD 的 CT 式只當「參考原型」（E44），單頻公式要求 0 < Ω < π（E46）。
 *  - 預設值 = 本章 worked example（§1 手算表／T06、§5 的 ν = 0.3、§6.4 的 frac 表、思考題 1）。
 *  - 每一步的 TeX 是「符號式 = 代入數字 =（中間結果 =）結果」，而且畫面上的數字自己就算得出下一個等號
 *    （handcalcs.test.tsx 會把每一步的 TeX 重新求值）：預設顯示 6 位；相減會抵消有效位數的地方（C₁ + C₂、
 *    一階項 + 二階項、90° − tan⁻¹ν）用 guardSig 多留位數；p = 1 − g 顯示到和 g 同一個小數位（poleSig）。
 */

const PAGE = '/ch/06'
const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI

/** 去掉浮點殘渣：|x| < 1e−12 視為 0（cos 90° = 6e−17 這類），順便把 −0 變成 0 */
const clean = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : x)
/**
 * 步驟裡的數字預設顯示 6 位有效數字——比答案框（HandCalc 預設 5 位）多留一位「保護位數」：
 * 讀者把上一步顯示的數字原樣代進下一步，算出來的答案在 5 位有效數字內和答案框一致
 * （只顯示 5 位時，例如 0.09/1.0022 = 0.089802，會和正確的 0.089798 差在第 4 位）。
 */
const STEP_SIG = 6
/** 為了補償相減時抵消掉的位數而多顯示時，最多顯示到幾位有效數字 */
const MAX_SIG = 10
const tn = (x: number, sig = STEP_SIG): string => texNum(clean(x), sig)
/**
 * 當乘數、被減數或次方的底數用：負數與科學記號（a×10^b）都加括號。
 * 使用者可以輸入很小／很大的數字；沒有括號的 `5\times10^{-5}^2` 會讓 KaTeX 報 double superscript。
 */
const tp = (x: number, sig = STEP_SIG): string => {
  const s = tn(x, sig)
  return s.startsWith('-') || s.includes('10^') ? `(${s})` : s
}
const tdeg = (x: number, sig = STEP_SIG): string => `${tn(x, sig)}^\\circ`

/** x 以 sig 位有效數字顯示時，小數點後有幾位（0 視為「精確」，回傳 ∞） */
const decimalsAt = (x: number, sig = STEP_SIG): number => (clean(x) === 0 ? Number.POSITIVE_INFINITY : sig - 1 - Math.floor(Math.log10(Math.abs(x))))
/** 把 x 顯示到小數點後 dec 位，需要幾位有效數字（夾在 1…12） */
const sigAtDecimals = (x: number, dec: number): number =>
  clean(x) === 0 || !Number.isFinite(dec) ? 12 : Math.max(1, Math.min(12, dec + 1 + Math.floor(Math.log10(Math.abs(x)))))
/**
 * 加減法 result = Σ terms 會抵消掉前幾位有效數字（例如 −0.0407666 + 0.0320665 只剩 −0.0087001）。
 * 回傳各項需要顯示的有效位數（STEP_SIG…MAX_SIG），讓「畫面上的數字相加」本身就有結果的第 STEP_SIG 位。
 */
function guardSig(result: number, terms: number[]): number {
  const dec = decimalsAt(result)
  let sig = STEP_SIG
  for (const t of terms) if (clean(t) !== 0) sig = Math.max(sig, sigAtDecimals(t, dec))
  return Math.min(MAX_SIG, sig)
}
/**
 * p = 1 − g 要顯示幾位：和 g 顯示到同一個小數位（g 有 6 位有效數字 ⇒ p 的小數位數相同）。
 * p 很接近 1 時自動多給位數（g = −3.36e−6 ⇒ p = 1.00000336269），不會把有意義的位數捨掉；也不會多給手算得不到的位數。
 */
const poleSig = (p: number, g: number): number => sigAtDecimals(p, decimalsAt(g))

/** pole 很接近 1，答案的容許誤差以 |p − 1| 的 2% 計（不是 p 的 1%） */
const poleTol = (p: number): { rel: number; abs: number } => ({ rel: 0, abs: Math.max(0.02 * Math.abs(p - 1), 1e-9) })

const UNIT_FS = String.raw`\mathrm{fs}`
const UNIT_PER_FS = String.raw`\mathrm{fs}^{-1}`
const UNIT_DEG = String.raw`\mathrm{deg}`
const UNIT_SAMPLES = String.raw`\text{samples}`
const UNIT_MHZ = String.raw`\mathrm{MHz}`

/** HC-06.6 提示用的對照值：ζ = 0.5、0.7、1 的 ω_3dB/ω_n（由 pll.ts 的 ctBandwidth3dB 算出，不手打） */
const C3DB_TIP = [0.5, 0.7, 1].map((zeta) => ctBandwidth3dB({ zeta, wn: 1 }).toFixed(3))

const MSG_MU = String.raw`本章討論的是正的 learning rate：請輸入 $\mu>0$。$\mu=0$ 不會更新；把 $\mu$ 變號等於把 comparator 極性反接，只能「修好」某一個 $C<0$ 的情況，換一個 FCW 或頻寬又會錯（§3）。`
const MSG_SIGMA = String.raw`$\sigma_v$ 必須為正：$K_q=\sqrt{2/\pi}/\sigma_v$ 來自 Gaussian comparator 雜訊的線性化，$\sigma_v\to0$ 時 comparator 變成理想的 sign，小訊號增益沒有定義。`

/** 依 C 與 pole 的一句判定（§3「三種情況」）；pSig = 步驟裡 p 顯示的有效位數（poleSig） */
function poleVerdict(C: number, Kq: number, p: number, pSig: number): string {
  if (C < 0) {
    return String.raw`$C<0\;\Rightarrow\;p=1+\mu K_q|C|=${tn(p, pSig)}>1$：更新極性錯誤，平均誤差每個 block 放大 $${tn((p - 1) * 100, 3)}\%$。任何 $\mu>0$ 都發散，減小 $\mu$ 只會發散得慢一點。`
  }
  if (C === 0) return String.raw`$C=0\;\Rightarrow\;p=1$：GMAC 沒有平均恢復力，$w$ 只會隨 comparator 雜訊 random walk；調 $\mu$ 沒有用。`
  const range = stableMuRange(Kq, C)
  const muMax = range ? range[1] : Number.NaN
  if (p <= -1) {
    return String.raw`$C>0$ 但 $g=\mu K_qC\ge2\;\Rightarrow\;p=${tn(p, pSig)}\le-1$：極性正確、步長太大，平均誤差振盪發散。這種情況降低 $\mu$ 才有用（$\mu_{\max}=2/(K_qC)=${tn(muMax)}\,\mathrm{fs}$）。`
  }
  return String.raw`$C>0$ 且 $0<g<2\;\Rightarrow\;|p|=${tn(Math.abs(p), pSig)}<1$：平均收斂${p < 0 ? '（$p<0$：每個 block 跳到另一側）' : ''}。穩定範圍 $0<\mu<2/(K_qC)=${tn(muMax)}\,\mathrm{fs}$。`
}

/**
 * Type-II CT 原型在 ν 的 Re{H} 的四個手算步驟（HC-06.7 兩個 tone 共用）。
 * sig：這四步的數字要顯示幾位（後面 C = C₁ + C₂ 相減會抵消掉幾位，就要在這裡多留幾位；見 guardSig）。
 */
function typeIIReSteps(m: number, nu: number, zeta: number, sig: number): { steps: HandCalcStep[]; re: number } {
  const H = ctHpd('typeII', nu, zeta)
  const nu2 = nu * nu
  const a = 1 - nu2
  const b = 2 * zeta * nu
  const den = a * a + b * b
  const which = m === 1 ? '第 1 個 tone' : '第 2 個 tone'
  return {
    re: H.re,
    steps: [
      {
        tex: String.raw`a_${m}=1-\nu_${m}^2=1-${tp(nu, sig)}^2=1-${tp(nu2, sig)}=${tn(a, sig)}`,
        why: String.raw`${which}：分母的實部（先平方、再用 1 去減）。$a_${m}>0\iff\nu_${m}<1$（頻率低於 $\omega_n$）。`,
      },
      {
        tex: String.raw`b_${m}=2\zeta\nu_${m}=2\times${tp(zeta, sig)}\times${tp(nu, sig)}=${tn(b, sig)}`,
        why: '分母的虛部（阻尼項）。',
      },
      {
        tex: String.raw`\Delta_${m}=a_${m}^2+b_${m}^2=${tp(a, sig)}^2+${tp(b, sig)}^2=${tn(a * a, sig)}+${tn(b * b, sig)}=${tn(den, sig)}`,
        why: String.raw`$|1-\nu^2+j2\zeta\nu|^2$：兩個平方相加，永遠為正。`,
      },
      {
        tex: String.raw`\operatorname{Re}H_${m}=\frac{-\nu_${m}^2\,a_${m}}{\Delta_${m}}=\frac{-${tp(nu2, sig)}\times${tp(a, sig)}}{${tn(den, sig)}}=\frac{${tn(-nu2 * a, sig)}}{${tn(den, sig)}}=${tn(H.re, sig)}`,
        why: String.raw`F-06.8：先乘出分子，再除以 $\Delta_${m}$。正負號只由 $a_${m}$ 決定：${H.re < 0 ? '$\\nu<1$，所以是負的（這個 tone 想把更新方向反過來）' : H.re > 0 ? '$\\nu>1$，所以是正的（PLL 來不及追，PD 幾乎看到原本的 $x$）' : '$\\nu=1$，所以剛好是 0'}。`,
      },
    ],
  }
}

/** Type-II DPLL（ζ、ω_nT_s、latency d）的脈衝響應；長度隨 ω_nT_s 調整，讓尾巴衰減到可忽略 */
function typeIIImpulse(wnTs: number, zeta: number, d: number): { h: Float64Array; Ki: number; stable: boolean } {
  const des = designPolarityLoop({ type: 'typeII', zeta, wLTs: wnTs, loopDelay: d })
  const len = Math.min(1 << 17, Math.max(4096, Math.ceil(60 / (Math.min(zeta, 1) * wnTs))))
  return { h: impulseResponse(des.b, des.a, len), Ki: des.Ki, stable: des.stable }
}

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.1',
    title: String.raw`平均 pole：把 $\mu$ 減半救得回來嗎？`,
    page: PAGE,
    formulaId: 'F-06.3',
    formulaTex: String.raw`E[G_k]\approx K_q\,\delta_k\,C,\qquad \delta_{k+1}=\delta_k-\mu\,G_k\;\Rightarrow\;E[\delta_{k+1}]=p\,E[\delta_k],\qquad p=1-\mu K_qC`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'C', symbol: 'C', label: String.raw`相關 $E[x\,u]$（無因次）`, default: -0.1, min: -100, max: 100, practice: { choices: [-0.5, -0.25, -0.1, 0.1, 0.25, 0.5] } },
      { key: 'Kq', symbol: 'K_q', label: 'comparator 小訊號增益', unit: UNIT_PER_FS, default: 0.008, min: 0, max: 10, practice: { choices: [0.004, 0.005, 0.008, 0.01] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate（gain step）', unit: UNIT_FS, default: 20, min: -1e5, max: 1e5, practice: { choices: [5, 10, 20, 50] } },
      { key: 'd0', symbol: String.raw`\delta_0`, label: String.raw`起始參數誤差 $a-w_0$`, unit: UNIT_FS, default: 10, min: -1e5, max: 1e5, practice: { choices: [-10, 5, 10, 20] } },
    ],
    validate: ({ Kq, mu }) => {
      if (Kq <= 0) return String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$ 一定是正的（$\sigma_v>0$）。若 comparator 極性接反，請把負號放進 $C$，不要放進 $K_q$。`
      if (mu <= 0) return MSG_MU
      return null
    },
    solve: ({ C, Kq, mu, d0 }) => {
      const p = calPole(mu, Kq, C)
      const pHalf = calPole(mu / 2, Kq, C)
      const muKq = mu * Kq
      const g = muKq * C
      const G0 = Kq * d0 * C
      const muG0 = mu * G0
      const d1 = p * d0
      const d2 = p * d1
      // 加減法的結果顯示到「被加減的那個數」顯示到的小數位（不多給手算得不到的位數）
      const pSig = poleSig(p, g)
      const pHalfSig = poleSig(pHalf, g / 2)
      const d1Sig = Math.min(MAX_SIG, sigAtDecimals(d1, decimalsAt(muG0)))
      const d2Sig = Math.min(MAX_SIG, Math.max(STEP_SIG + 1, d1Sig))
      return {
        steps: [
          {
            tex: String.raw`\mu K_q=${tp(mu)}\times${tp(Kq)}=${tn(muKq)}`,
            why: String.raw`正規化步長：$\mu$ [$\mathrm{fs}$] 乘 $K_q$ [$\mathrm{fs}^{-1}$]，單位消掉，是純數字。`,
          },
          {
            tex: String.raw`g=(\mu K_q)\,C=${tp(muKq)}\times${tp(C)}=${tn(g)}`,
            why: String.raw`校正迴路的增益 $g$。$\mu K_q>0$，所以 $g$ 的正負號就是 $C$ 的正負號。`,
          },
          {
            tex: String.raw`p=1-g=1-${tp(g)}=${tn(p, pSig)}`,
            why: String.raw`pole（F-06.3）：平均參數誤差每個 block 乘上的倍數。$|p|<1$ 才收斂。`,
          },
          {
            tex: String.raw`E[G_0]\approx K_q\,\delta_0\,C=${tp(Kq)}\times${tp(d0)}\times${tp(C)}=${tn(G0)}`,
            why: String.raw`第一個 block 的 GMAC 平均輸出（F-06.2；$q=\pm1$、$x$ 無因次，所以 $G$ 也無因次）。正確的極性應該讓 $G$ 與 $\delta$ 同號（$\delta=a-w>0$ 代表 $w$ 太小，要往上加）。`,
          },
          {
            tex: String.raw`E[\delta_1]=\delta_0-\mu\,E[G_0]=${tn(d0)}-${tp(mu)}\times${tp(G0)}=${tn(d0)}-${tp(muG0)}=${tn(d1, d1Sig)}`,
            why: String.raw`更新一次：$w_1=w_0+\mu G_0$，兩邊用 $a$ 去減（先乘、再減；單位 $\mathrm{fs}$）。結果應等於 $p\,\delta_0$。`,
          },
          {
            tex: String.raw`E[\delta_2]=p\,E[\delta_1]=${tp(p, pSig)}\times${tp(d1, d1Sig)}=${tn(d2, d2Sig)}`,
            why: String.raw`等比數列：每一步都乘上同一個 $p$，所以 $E[\delta_k]=p^k\delta_0$。`,
          },
          {
            tex: String.raw`p_{\mu/2}=1-\frac{g}{2}=1-\frac{${tn(g)}}{2}=1-${tp(g / 2)}=${tn(pHalf, pHalfSig)}`,
            why: String.raw`把 $\mu$ 減半：$g$ 也減半，但正負號不變。`,
          },
        ],
        results: [
          { symbol: 'p', label: '平均 pole', value: clean(p), digits: pSig, tolerance: poleTol(p) },
          { symbol: String.raw`E[\delta_1]`, label: '更新 1 次後的平均誤差', value: clean(d1), unit: UNIT_FS, digits: d1Sig, tolerance: { rel: 0, abs: Math.max(0.02 * Math.abs(d1 - d0), 1e-9) } },
          { symbol: String.raw`E[\delta_2]`, label: '更新 2 次後的平均誤差', value: clean(d2), unit: UNIT_FS, digits: d2Sig, tolerance: { rel: 0, abs: Math.max(0.02 * Math.abs(d2 - d0), 1e-9) } },
          { symbol: String.raw`p_{\mu/2}`, label: String.raw`$\mu$ 減半後的 pole`, value: clean(pHalf), digits: pHalfSig, tolerance: poleTol(pHalf) },
        ],
        notes: [
          poleVerdict(C, Kq, p, pSig),
          C < 0
            ? String.raw`$\mu$ 減半後 $p_{\mu/2}=${tn(pHalf, pHalfSig)}$ 仍然 $>1$：learning rate 只決定每一步走多遠，決定不了方向。`
            : C > 0
              ? String.raw`$\mu$ 減半後 $p_{\mu/2}=${tn(pHalf, pHalfSig)}$：${Math.abs(pHalf) < 1 ? '收斂' : '仍發散'}。$C>0$ 時 $\mu$ 才是有用的旋鈕（速度與雜訊的取捨）。`
              : String.raw`$\mu$ 減半後 $p$ 仍是 1。`,
        ],
      }
    },
    tips: [
      String.raw`全程只有乘法與減法。$p$ 很接近 1，請多留幾位小數（至少算到 $|p-1|$ 的 3 位有效數字）。`,
      String.raw`範例數字 $C=-0.1$、$K_q=0.008\,\mathrm{fs}^{-1}$、$\mu=20\,\mathrm{fs}$ 就是思考題 1：$p=1.016$，$\mu$ 減半後 $1.008$（$\delta_0=10\,\mathrm{fs}$ 是另外假設的起始誤差）。`,
      String.raw`這是線性化平均模型（小訊號 $|\delta u|\ll\sigma_v$）裡的精確結果；誤差變大後 comparator 飽和，指數發散會轉為線性漂移（F-06.15）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.2',
    title: String.raw`單頻相關 $C_D$ 與 pole（§1 手算表、T06）`,
    page: PAGE,
    formulaId: 'F-06.4',
    formulaTex: String.raw`C_D=\frac{A^2}{2}\,|H|\cos(\phi+\Omega D),\qquad \Omega=\frac{2\pi}{P},\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad p=1-\mu K_qC_D`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'A', symbol: 'A', label: 'code 振幅', default: 1, min: 0.001, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'mag', symbol: '|H|', label: String.raw`路徑在 $\Omega$ 的增益`, default: 1, min: 0, max: 100, practice: { choices: [0.5, 0.8, 1] } },
      { key: 'phi', symbol: String.raw`\phi`, label: String.raw`路徑相位 $\angle H(e^{j\Omega})$`, unit: UNIT_DEG, default: 120, min: -720, max: 720, practice: { choices: [0, 30, 45, 60, 120, 135, 150, 180] } },
      { key: 'P', symbol: 'P', label: String.raw`code 週期（$\Omega=2\pi/P$）`, unit: UNIT_SAMPLES, default: 12, min: 0.1, max: 1e6, practice: { choices: [6, 8, 12, 24] } },
      { key: 'D', symbol: 'D', label: 'GMAC code delay', unit: UNIT_SAMPLES, default: 0, min: 0, max: 256, integer: true, practice: { choices: [0, 1, 2, 3] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate', unit: UNIT_FS, default: 10, min: -1e5, max: 1e5, practice: { choices: [5, 10, 20, 50] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: UNIT_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ P, mu, sigmaV }) => {
      if (P === 2) {
        return String.raw`$P=2$ 就是 $\Omega=\pi$（交替碼），這是 E46 的邊界：兩倍頻項 $\cos(2\Omega n+\psi)$ 變成常數、不會平均掉，而且實係數 $h$ 在這個頻率只能給 $\phi\in\{0^\circ,180^\circ\}$。此時 $C_D=A^2H(e^{j\pi})\cos(\Omega D)$，是本公式的 2 倍（F-06.5）。請用 $P>2$。`
      }
      if (P < 2) return String.raw`$P<2$ 表示 $\Omega>\pi$，超過 Nyquist：每個週期至少要 2 個 sample，離散時間看到的其實是折返後的頻率 $2\pi-\Omega$。請用 $P>2$。`
      if (sigmaV <= 0) return MSG_SIGMA
      if (mu <= 0) return MSG_MU
      return null
    },
    solve: ({ A, mag, phi, P, D, mu, sigmaV }) => {
      const omega = TWO_PI / P
      const stepDeg = 360 / P
      const shiftDeg = stepDeg * D
      const thetaDeg = phi + shiftDeg
      const C = clean(toneCorrelation({ A, mag, phiRad: phi * DEG, omega, delay: D }))
      const cosT = Math.cos(thetaDeg * DEG)
      const half = (A * A) / 2
      const Kq = kqFromSigma(sigmaV)
      const p = calPole(mu, Kq, C)
      const g = mu * Kq * C
      const pSig = poleSig(p, g)
      const margin = polarityMarginDeg(thetaDeg)
      const notes = [poleVerdict(C, Kq, p, pSig), String.raw`polarity margin $M=90^\circ-|\mathrm{wrap}_{180}(\theta)|=${tdeg(margin)}$（$M<0\iff\cos\theta<0\iff$ 極性錯誤；第 08 章）。`]
      if (C < 0) {
        const drift = mu * Math.abs(toneLargeErrorGain(A, phi * DEG, omega, D))
        notes.push(
          String.raw`誤差大到 comparator 飽和後（$|\delta u|\gg\sigma_v$），指數發散轉為線性漂移：每個 block $\mu\cdot\tfrac{2A}{\pi}|\cos\theta|=${tn(drift, 4)}\,\mathrm{fs}$（F-06.15，相位等分布近似）。`,
        )
      }
      return {
        steps: [
          {
            tex: String.raw`\Omega=\frac{360^\circ}{P}=\frac{360^\circ}{${tn(P)}}=${tdeg(stepDeg)}\text{/sample}`,
            why: String.raw`每個 sample 走過的相位。用「度」比較好按計算機；換成弧度是 $\Omega=2\pi/P=${tn(omega)}\,\mathrm{rad/sample}$。`,
          },
          {
            tex: String.raw`\theta=\phi+\Omega D=${tdeg(phi)}+${tdeg(stepDeg)}\times${tn(D)}=${tdeg(phi)}+${tdeg(shiftDeg)}=${tdeg(thetaDeg)}`,
            why: String.raw`GMAC 乘的是 $x[n-D]$：code 每延遲一個 sample，等於多給 $\Omega$ 的相位（$D=0$ 就是 raw $x$）。先乘、再加。`,
          },
          {
            tex: String.raw`\cos\theta=\cos(${tdeg(thetaDeg)})=${tn(cosT)}`,
            why: String.raw`計算機切到 DEG 模式按 $\cos$。$\cos\theta<0$ 表示相位差超過 $90^\circ$，也就是 $x$ 與 $u$ 大多數時間反號。`,
          },
          {
            tex: String.raw`\frac{A^2}{2}=\frac{${tp(A)}^2}{2}=\frac{${tn(A * A)}}{2}=${tn(half)}`,
            why: String.raw`單頻 code 的平均功率 $\sigma_x^2=E[x^2]$（先平方、再除以 2）。`,
          },
          {
            tex: String.raw`C_D=\frac{A^2}{2}\,|H|\cos\theta=${tp(half)}\times${tp(mag)}\times${tp(cosT)}=${tn(C)}`,
            why: String.raw`F-06.4（連乘兩次）。$|H|$ 只影響大小，正負號完全由 $\cos\theta$ 決定。`,
          },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${tn(SQRT_2_OVER_PI)}}{${tn(sigmaV)}}=${tn(Kq)}\ \mathrm{fs}^{-1}`,
            why: String.raw`第 05 章：1-bit comparator 的小訊號增益。$\sqrt{2/\pi}$：按 $2\div\pi$ 再開根號 $=${tn(SQRT_2_OVER_PI)}$；再除以 $\sigma_v$ [$\mathrm{fs}$]，所以單位是 $\mathrm{fs}^{-1}$。`,
          },
          {
            tex: String.raw`g=\mu K_qC_D=${tp(mu)}\times${tp(Kq)}\times${tp(C)}=${tn(g)}`,
            why: String.raw`校正迴路的增益（$\mathrm{fs}\times\mathrm{fs}^{-1}$，無因次）；正負號跟著 $C_D$。`,
          },
          {
            tex: String.raw`p=1-g=1-${tp(g)}=${tn(p, pSig)}`,
            why: String.raw`平均 pole（F-06.3）。`,
          },
        ],
        results: [
          { symbol: 'C_D', label: String.raw`單頻相關 $E[x[n-D]\,u[n]]$`, value: C },
          { symbol: 'K_q', label: 'comparator 小訊號增益', value: Kq, unit: UNIT_PER_FS },
          { symbol: 'p', label: '平均 pole', value: clean(p), digits: pSig, tolerance: poleTol(p) },
        ],
        notes,
      }
    },
    tips: [
      String.raw`計算機先切到 DEG（度）模式。常用值：$\cos60^\circ=0.5$、$\cos120^\circ=-0.5$、$\cos150^\circ=-0.866025$、$\cos135^\circ=-0.707107$。`,
      String.raw`範例數字（$A=|H|=1$、$\phi=120^\circ$、$P=12$、$D=0$、$\mu=10\,\mathrm{fs}$、$\sigma_v=100\,\mathrm{fs}$）就是 §1 的手算表與測試 T06：$C=-0.25$、$p=1.0199471$。`,
      String.raw`試試看：把 $D$ 改成 8，$\theta=120^\circ+240^\circ=360^\circ$，$C_D$ 回到 $+0.5$（delay alignment，第 07 章的主題）。`,
      String.raw`公式只在 $0<\Omega<\pi$（$P>2$）、長時間或整數週期平均時成立（E46）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.3',
    title: String.raw`2-tap 濾波器與手算表的一列：$u=h*x$`,
    page: PAGE,
    formulaId: 'F-06.1',
    formulaTex: String.raw`h_1=-\frac{|H|\sin\phi}{\sin\Omega},\qquad h_0=|H|\cos\phi-h_1\cos\Omega,\qquad u[n]=h_0\,x[n]+h_1\,x[n-1],\qquad x[n]=\cos(\Omega n)`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'mag', symbol: '|H|', label: String.raw`要在 $\Omega$ 得到的增益`, default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'phi', symbol: String.raw`\phi`, label: String.raw`要在 $\Omega$ 得到的相位`, unit: UNIT_DEG, default: 120, min: -720, max: 720, practice: { choices: [30, 60, 90, 120, 150] } },
      { key: 'P', symbol: 'P', label: String.raw`code 週期（$\Omega=360^\circ/P$）`, unit: UNIT_SAMPLES, default: 12, min: 0.1, max: 1e6, practice: { choices: [6, 8, 12] } },
      { key: 'n', symbol: 'n', label: '要算手算表的第幾列', default: 1, min: 0, max: 60, integer: true, practice: { choices: [0, 1, 2, 3, 4, 5] } },
    ],
    validate: ({ P }) => {
      if (P === 2) {
        return String.raw`$P=2$（$\Omega=\pi$）時 $\sin\Omega=0$，$h_1$ 的分母為 0：實係數濾波器在 $\Omega=\pi$ 的 $H=h_0-h_1$ 一定是實數，做不出 $0^\circ/180^\circ$ 以外的相位（E46）。請用 $P>2$。`
      }
      if (P < 2) return String.raw`$P<2$ 表示 $\Omega>\pi$，超過 Nyquist（每個週期至少 2 個 sample）。請用 $P>2$。`
      return null
    },
    solve: ({ mag, phi, P, n }) => {
      const omega = TWO_PI / P
      const stepDeg = 360 / P
      const phiRad = phi * DEG
      const t = toneHandTable({ A: 1, mag, phiRad, omega, rows: n + 1 })
      const [h0, h1] = t.h
      const x = t.x[n]
      const xp = t.xPrev[n]
      const u = t.u[n]
      const xu = t.xu[n]
      const sinPhi = Math.sin(phiRad)
      const cosPhi = Math.cos(phiRad)
      const sinOm = Math.sin(omega)
      const cosOm = Math.cos(omega)
      /** 手算得到 0 的地方，計算機會留下 1e−6 等級的捨入殘餘：提醒一句 */
      const zeroHint = (v: number): string => (clean(v) === 0 ? String.raw`手算若得到 $10^{-6}$ 等級的小數，那是前面四捨五入的殘餘，當成 0。` : '')
      const white = (lag: number): number => (lag === 0 ? 1 : 0)
      const notes: string[] = []
      if (Number.isInteger(P) && P <= 64) {
        const full = toneHandTable({ A: 1, mag, phiRad, omega, rows: P })
        notes.push(
          String.raw`把 $n=0,\dots,${P - 1}$ 這 ${P} 列的 $x[n]\,u[n]$ 全部加起來除以 ${P}：$C=${tn(full.mean)}$，正好是 $\tfrac12|H|\cos\phi$（F-06.4；HC-06.2）。`,
        )
      }
      notes.push(
        String.raw`同一個濾波器換成白色 code（$\sigma_x^2=1$）：$C_D=h[D]$（F-06.13），$C_0=h_0=${tn(autocorrCorrelation(t.h, white, 0))}$、$C_1=h_1=${tn(autocorrCorrelation(t.h, white, 1))}$——$C$ 同時取決於路徑與 code 的頻譜。`,
      )
      return {
        steps: [
          {
            tex: String.raw`\Omega=\frac{360^\circ}{P}=\frac{360^\circ}{${tn(P)}}=${tdeg(stepDeg)}`,
            why: '每個 sample 的相位（度）。',
          },
          {
            tex: String.raw`\sin\phi=\sin(${tdeg(phi)})=${tn(sinPhi)},\qquad \sin\Omega=\sin(${tdeg(stepDeg)})=${tn(sinOm)}`,
            why: String.raw`計算機 DEG 模式，各按一次 $\sin$。`,
          },
          {
            tex: String.raw`h_1=-\frac{|H|\sin\phi}{\sin\Omega}=-\frac{${tp(mag)}\times${tp(sinPhi)}}{${tn(sinOm)}}=-\frac{${tn(mag * sinPhi)}}{${tn(sinOm)}}=${tn(h1)}`,
            why: String.raw`$H(e^{j\Omega})=h_0+h_1e^{-j\Omega}$ 的虛部是 $-h_1\sin\Omega$，令它等於 $|H|\sin\phi$（先乘、再除，最後加上負號）。`,
          },
          {
            tex: String.raw`\cos\phi=\cos(${tdeg(phi)})=${tn(cosPhi)},\qquad \cos\Omega=\cos(${tdeg(stepDeg)})=${tn(cosOm)}`,
            why: String.raw`各按一次 $\cos$。`,
          },
          {
            tex: String.raw`h_0=|H|\cos\phi-h_1\cos\Omega=${tp(mag)}\times${tp(cosPhi)}-${tp(h1)}\times${tp(cosOm)}=${tn(mag * cosPhi)}-${tp(h1 * cosOm)}=${tn(h0)}`,
            why: String.raw`實部 $h_0+h_1\cos\Omega$ 等於 $|H|\cos\phi$，把剛算出的 $h_1$ 代入：兩個乘積相減。${zeroHint(h0)}`,
          },
          {
            tex: String.raw`x[${n}]=\cos(${tdeg(stepDeg)}\times${n})=\cos(${tdeg(stepDeg * n)})=${tn(x)},\qquad x[${n - 1}]=\cos(${tdeg(stepDeg)}\times${tp(n - 1)})=\cos(${tdeg(stepDeg * (n - 1))})=${tn(xp)}`,
            why: String.raw`code 是 $x[n]=\cos(\Omega n)$（$A=1$）：先乘出角度，再按 $\cos$。訊號在 $n=0$ 之前就存在，所以 $x[-1]=\cos(-\Omega)$。`,
          },
          {
            tex: String.raw`u[${n}]=h_0\,x[${n}]+h_1\,x[${n - 1}]=${tp(h0)}\times${tp(x)}+${tp(h1)}\times${tp(xp)}=${tn(h0 * x)}+${tp(h1 * xp)}=${tn(u)}`,
            why: String.raw`卷積 $u=h*x$ 只有兩項（兩個乘積相加）：這就是 PD「看到」的 code。${zeroHint(u)}`,
          },
          {
            tex: String.raw`|H|\cos(\Omega n+\phi)=${tp(mag)}\times\cos(${tdeg(stepDeg)}\times${n}${phi < 0 ? '-' : '+'}${tdeg(Math.abs(phi))})=${tp(mag)}\times\cos(${tdeg(stepDeg * n + phi)})=${tn(mag * Math.cos((stepDeg * n + phi) * DEG))}`,
            why: String.raw`驗算：正弦進、正弦出（§2），$u[n]$ 應該等於 $A|H|\cos(\Omega n+\phi)$。和上一步一樣就代表 $h_0,h_1$ 算對了。`,
          },
          {
            tex: String.raw`x[${n}]\,u[${n}]=${tp(x)}\times${tp(u)}=${tn(xu)}`,
            why: String.raw`GMAC（去掉 comparator 後）累加的就是這個乘積；負的代表這個 sample 把 $w$ 往錯的方向推。`,
          },
        ],
        results: [
          { symbol: 'h_1', label: '第 2 個 tap', value: clean(h1) },
          { symbol: 'h_0', label: '第 1 個 tap', value: clean(h0) },
          { symbol: `u[${n}]`, label: String.raw`PD 看到的 code`, value: clean(u), tolerance: { rel: 0.01, abs: 2e-3 } },
          { symbol: String.raw`x[${n}]\,u[${n}]`, label: '手算表這一列的乘積', value: clean(xu), tolerance: { rel: 0.01, abs: 2e-3 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例數字（$|H|=1$、$\phi=120^\circ$、$P=12$）得到 $h=[1,\,-\sqrt3]=[1,\,-1.73205]$，就是 §1 手算表用的濾波器；$n=1$ 那一列是 $u[1]=-0.866$、$x[1]u[1]=-0.75$（測試 T06）。`,
      String.raw`先算 $h_1$（只用虛部），再算 $h_0$（實部）。$\sin30^\circ=0.5$、$\cos30^\circ=\sin60^\circ=0.866025$。`,
      String.raw`把 $n$ 從 0 改到 $P-1$ 各算一次，就能自己重建 §1 的整張表。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.4',
    title: String.raw`Type-I：$H_{\mathrm{PD}}(j\omega)$ 的實部、虛部與相位`,
    page: PAGE,
    formulaId: 'F-06.7',
    formulaTex: String.raw`L=\frac{\omega_c}{j\omega}=\frac{1}{j\nu}\;\Rightarrow\;H_{\mathrm{PD}}=\frac{1}{1+L}=\frac{j\nu}{1+j\nu}=\frac{\nu^2+j\nu}{1+\nu^2},\qquad \angle H=90^\circ-\tan^{-1}\nu,\qquad \nu=\frac{\omega}{\omega_c}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'nu', symbol: String.raw`\nu`, label: String.raw`頻率比 $\omega/\omega_c$`, default: 0.3, min: 0, max: 1e4, practice: { choices: [0.1, 0.2, 0.3, 0.5, 1, 2, 3] } },
      { key: 'A', symbol: 'A', label: '單頻 code 的振幅', default: 1, min: 0.001, max: 100, practice: { choices: [1, 2] } },
    ],
    validate: ({ nu }) => (nu <= 0 ? String.raw`$\nu=0$ 是 DC：$H_{\mathrm{PD}}(0)=0$（PLL 把固定的誤差完全追掉），相位沒有定義。請輸入 $\nu>0$。` : null),
    solve: ({ nu, A }) => {
      const H = ctHpd('typeI', nu)
      const den = 1 + nu * nu
      const mag = Math.hypot(H.re, H.im)
      const phase = Math.atan2(H.im, H.re) / DEG
      const atanDeg = Math.atan(nu) / DEG
      const half = (A * A) / 2
      const C = lineCorrelation({ omega: Float64Array.of(1), power: Float64Array.of(half) }, [H])
      return {
        steps: [
          { tex: String.raw`\nu^2=${tp(nu)}^2=${tn(nu * nu)}`, why: '先算頻率比的平方。' },
          { tex: String.raw`1+\nu^2=1+${tn(nu * nu)}=${tn(den)}`, why: String.raw`分母 $|1+j\nu|^2$：乘上共軛 $(1-j\nu)$ 之後分母變成的實數。` },
          {
            tex: String.raw`\operatorname{Re}H=\frac{\nu^2}{1+\nu^2}=\frac{${tn(nu * nu)}}{${tn(den)}}=${tn(H.re)}`,
            why: String.raw`分子 $j\nu(1-j\nu)=\nu^2+j\nu$ 的實部除以分母。對任何 $\nu>0$ 都是正的。`,
          },
          {
            tex: String.raw`\operatorname{Im}H=\frac{\nu}{1+\nu^2}=\frac{${tn(nu)}}{${tn(den)}}=${tn(H.im)}`,
            why: '分子的虛部除以同一個分母。',
          },
          {
            tex: String.raw`|H|=\frac{\nu}{\sqrt{1+\nu^2}}=\frac{${tn(nu)}}{\sqrt{${tn(den)}}}=\frac{${tn(nu)}}{${tn(Math.sqrt(den))}}=${tn(mag)}`,
            why: String.raw`按一次 $\sqrt{\ }$。也等於 $\sqrt{(\operatorname{Re}H)^2+(\operatorname{Im}H)^2}$。`,
          },
          {
            tex: String.raw`\angle H=90^\circ-\tan^{-1}\nu=90^\circ-\tan^{-1}(${tn(nu)})=90^\circ-${tdeg(atanDeg, guardSig(phase, [atanDeg]))}=${tdeg(phase)}`,
            why: String.raw`DEG 模式按 $\tan^{-1}$（atan）。分子 $j\nu$ 給 $90^\circ$，分母 $1+j\nu$ 扣掉 $\tan^{-1}\nu$；結果永遠在 $(0^\circ,90^\circ)$。`,
          },
          {
            tex: String.raw`C=\frac{A^2}{2}\operatorname{Re}H=\frac{${tp(A)}^2}{2}\times${tp(H.re)}=${tp(half)}\times${tp(H.re)}=${tn(C)}`,
            why: String.raw`F-06.4 的 $|H|\cos\phi$ 就是 $\operatorname{Re}H$。沒有 PLL（$H=1$）時 $C=A^2/2$，所以有效增益剩下 $\operatorname{Re}H$ 倍。`,
          },
        ],
        results: [
          { symbol: String.raw`\operatorname{Re}H`, label: '實部（決定極性）', value: H.re },
          { symbol: String.raw`\operatorname{Im}H`, label: '虛部', value: H.im },
          { symbol: '|H|', label: '大小', value: mag },
          { symbol: String.raw`\angle H`, label: '相位', value: phase, unit: UNIT_DEG, tolerance: { rel: 0.01, abs: 0.1 } },
          { symbol: 'C', label: String.raw`單頻相關 $E[x\,u]$`, value: C },
        ],
        notes: [
          String.raw`$\operatorname{Re}H>0$：Type-I（CT 原型、無額外 latency）對任何頻率都不變號，只是變慢——要得到和沒有 PLL 時一樣的 pole，$\mu$ 要放大 $1/\operatorname{Re}H=${tn(1 / H.re, 4)}$ 倍。`,
          String.raw`驗算：$|H|\cos(\angle H)=${tn(mag)}\times\cos(${tdeg(phase)})=${tn(mag * Math.cos(phase * DEG))}$，應等於 $\operatorname{Re}H$。`,
        ],
      }
    },
    tips: [
      String.raw`範例 $\nu=0.3$ 就是 §5.1 的數字：$H=0.0826+j0.2752$，相位 $73.3^\circ$。`,
      String.raw`$\tan^{-1}$ 要在 DEG 模式下按；$\tan^{-1}0.3=16.70^\circ$、$\tan^{-1}1=45^\circ$、$\tan^{-1}2=63.43^\circ$。`,
      String.raw`沒有 $\tan^{-1}$ 鍵時：$\nu\le0.3$ 可用小角度近似 $\tan^{-1}\nu\approx57.3^\circ\times\nu$（相對誤差約 $\nu^2/3$，$\nu=0.3$ 時不到 $3\%$，相位只差 $0.5^\circ$）。同樣是低頻近似：$|H|\approx\nu$（相對高估約 $\nu^2/2$）、$\operatorname{Re}H\approx\nu^2$（相對高估 $\nu^2$：$\nu=0.3$ 時是 $9\%$，只適合估量級）。`,
      String.raw`這是連續時間（CT）參考原型；DT 迴路加上 latency $d$ 後低頻可能變號（$\kappa=1-K(d+\tfrac12)<0$，§5.4 Research）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.5',
    title: String.raw`Type-II：把 $H_{\mathrm{PD}}(j\omega)$ 拆成實部／虛部手算（規格 §6.1 的例子）`,
    page: PAGE,
    formulaId: 'F-06.8',
    formulaTex: String.raw`H_{\mathrm{PD}}(j\omega)=\frac{-\nu^2}{a+jb}=\frac{-\nu^2(a-jb)}{a^2+b^2},\qquad a=1-\nu^2,\quad b=2\zeta\nu,\quad \nu=\frac{\omega}{\omega_n}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'nu', symbol: String.raw`\nu`, label: String.raw`頻率比 $\omega/\omega_n$`, default: 0.3, min: 0, max: 1e4, practice: { choices: [0.2, 0.3, 0.5, 0.8, 1, 2, 3] } },
      { key: 'zeta', symbol: String.raw`\zeta`, label: '阻尼比', default: 0.7, min: 0, max: 100, practice: { choices: [0.5, 0.7, 1] } },
    ],
    validate: ({ nu, zeta }) => {
      if (nu <= 0) return String.raw`$\nu=0$ 是 DC：$H_{\mathrm{PD}}(0)=0$（Type-II 把固定誤差、連斜坡都追掉），相位沒有定義。請輸入 $\nu>0$。`
      if (zeta <= 0) return String.raw`阻尼比必須 $\zeta>0$：$\zeta=0$ 時迴路在 $\omega_n$ 無阻尼振盪（$\nu=1$ 的分母為 0），$\zeta<0$ 則主 PLL 不穩定，$H_{\mathrm{PD}}$ 沒有意義。`
      return null
    },
    solve: ({ nu, zeta }) => {
      const H = ctHpd('typeII', nu, zeta)
      const nu2 = nu * nu
      const a = 1 - nu2
      const b = 2 * zeta * nu
      const den = a * a + b * b
      const mag = Math.hypot(H.re, H.im)
      const phase = Math.atan2(H.im, H.re) / DEG
      const phaseStep: HandCalcStep =
        clean(a) > 0
          ? {
              tex: String.raw`\angle H=180^\circ-\tan^{-1}\frac{b}{a}=180^\circ-\tan^{-1}\frac{${tn(b)}}{${tn(a)}}=180^\circ-\tan^{-1}(${tn(b / a)})=180^\circ-${tdeg(Math.atan(b / a) / DEG)}=${tdeg(phase, 6)}`,
              why: String.raw`分子 $-\nu^2$ 是負實數（$180^\circ$），分母 $a+jb$ 在第一象限（$\tan^{-1}(b/a)$）；相除就是角度相減。先按 $b\div a$，再在 DEG 模式按 $\tan^{-1}$，最後用 $180^\circ$ 去減。`,
            }
          : clean(a) === 0
            ? {
                tex: String.raw`\angle H=180^\circ-90^\circ=90^\circ`,
                why: String.raw`$a=0$：分母 $jb$ 是純虛數（$90^\circ$），所以 $H=j\nu^2/b$ 剛好在 $90^\circ$——相關性的符號界線。`,
              }
            : {
                tex: String.raw`\angle H=\tan^{-1}\frac{b}{|a|}=\tan^{-1}\frac{${tn(b)}}{${tn(-a)}}=\tan^{-1}(${tn(b / -a)})=${tdeg(phase, 6)}`,
                why: String.raw`$a<0$：分母在第二象限，角度是 $180^\circ-\tan^{-1}(b/|a|)$；用 $180^\circ$ 去減就剩 $\tan^{-1}(b/|a|)<90^\circ$。先按 $b\div|a|$，再在 DEG 模式按 $\tan^{-1}$。`,
              }
      const notes = [
        H.re < 0
          ? String.raw`$\nu<1\;\Rightarrow\;\operatorname{Re}H<0$、相位 $>90^\circ$：這個頻率的單頻 code 讓 raw-$x$ LMS 反向更新（$C/\sigma_x^2=\operatorname{Re}H=${tn(H.re)}$），而主 PLL 本身完全穩定。`
          : H.re > 0
            ? String.raw`$\nu>1\;\Rightarrow\;\operatorname{Re}H>0$：頻率高於 $\omega_n$，PLL 來不及追，極性正確（$C/\sigma_x^2=\operatorname{Re}H=${tn(H.re)}$）。`
            : String.raw`$\nu=1\;\Rightarrow\;\operatorname{Re}H=0$：剛好在 CT 原型的極性邊界，$C=0$ 沒有恢復力。`,
      ]
      if (nu < 1) {
        notes.push(
          String.raw`低頻近似（F-06.9）：$\operatorname{Re}H\approx-\nu^2=${tn(-nu2)}$，與精確值差 $${tn(Math.abs(-nu2 / H.re - 1) * 100, 3)}\%$（$\nu\ll1$ 才準）；它就是 $u\approx x''/\omega_n^2$。`,
        )
      }
      notes.push(String.raw`把 $|H|=${tn(mag)}$、$\phi=${tdeg(phase)}$ 代進 HC-06.2，就能算這個 tone 的 $C_D$ 與 pole。`)
      return {
        steps: [
          { tex: String.raw`\nu^2=${tp(nu)}^2=${tn(nu2)}`, why: String.raw`$s=j\omega$ 代入 $s^2$：$(j\omega)^2=-\omega^2$，所以分子是 $-\nu^2$（負實數）。` },
          { tex: String.raw`a=1-\nu^2=1-${tn(nu2)}=${tn(a)}`, why: String.raw`分母的實部。$a>0\iff\omega<\omega_n$。` },
          { tex: String.raw`b=2\zeta\nu=2\times${tp(zeta)}\times${tp(nu)}=${tn(b)}`, why: '分母的虛部（阻尼項）。' },
          {
            tex: String.raw`\Delta=a^2+b^2=${tp(a)}^2+${tp(b)}^2=${tn(a * a)}+${tn(b * b)}=${tn(den)}`,
            why: String.raw`複數除法：分子分母同乘分母的共軛 $(a-jb)$，分母變成實數 $\Delta=|a+jb|^2$。`,
          },
          {
            tex: String.raw`N_{\mathrm{re}}=-\nu^2\,a=-${tp(nu2)}\times${tp(a)}=${tn(-nu2 * a)}`,
            why: String.raw`新分子 $-\nu^2(a-jb)$ 的實部。`,
          },
          {
            tex: String.raw`N_{\mathrm{im}}=+\nu^2\,b=${tp(nu2)}\times${tp(b)}=${tn(nu2 * b)}`,
            why: String.raw`新分子的虛部：$-\nu^2\times(-jb)=+j\nu^2b$（負負得正）。`,
          },
          {
            tex: String.raw`\operatorname{Re}H=\frac{N_{\mathrm{re}}}{\Delta}=\frac{${tn(-nu2 * a)}}{${tn(den)}}=${tn(H.re)}`,
            why: String.raw`F-06.8。$\nu^2$ 與 $\Delta$ 都是正的，正負號只由 $a=1-\nu^2$ 決定。`,
          },
          {
            tex: String.raw`\operatorname{Im}H=\frac{N_{\mathrm{im}}}{\Delta}=\frac{${tn(nu2 * b)}}{${tn(den)}}=${tn(H.im)}`,
            why: String.raw`也可寫成 $2\zeta\nu^3/\Delta$；永遠為正。`,
          },
          {
            tex: String.raw`|H|=\frac{\nu^2}{\sqrt{\Delta}}=\frac{${tn(nu2)}}{\sqrt{${tn(den)}}}=\frac{${tn(nu2)}}{${tn(Math.sqrt(den))}}=${tn(mag)}`,
            why: String.raw`大小相除：$|-\nu^2|/|a+jb|$。按一次 $\sqrt{\ }$。`,
          },
          phaseStep,
        ],
        results: [
          { symbol: String.raw`\Delta`, label: String.raw`分母 $|a+jb|^2$`, value: den },
          { symbol: String.raw`\operatorname{Re}H`, label: '實部（決定極性）', value: clean(H.re), tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: String.raw`\operatorname{Im}H`, label: '虛部', value: H.im },
          { symbol: '|H|', label: '大小', value: mag },
          { symbol: String.raw`\angle H`, label: '相位', value: phase, unit: UNIT_DEG, digits: 6, tolerance: { rel: 0.002, abs: 0.1 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例 $\nu=0.3$、$\zeta=0.7$ 是規格 §6.1 與 golden vector T06：$H=-0.0815+j0.0376$、相位 $155.22^\circ$。`,
      String.raw`複數除法的固定做法：分子分母同乘分母的共軛，分母就變成實數 $a^2+b^2$；然後實部、虛部分開算。`,
      String.raw`中間值請多留一位（步驟顯示 6 位有效數字）再往下算：例如只留 5 位的 $\sqrt{1.0045}=1.0022$ 會算出 $|H|=0.09/1.0022=0.089802$，和正確的 $0.089798$ 差在第 4 位。`,
      String.raw`相位請用「$180^\circ$ 減掉分母的角度」，不要直接按 $\tan^{-1}(\operatorname{Im}/\operatorname{Re})$：實部為負時計算機會給錯象限（少了 $180^\circ$）。`,
      String.raw`這是 CT 參考原型。拿它估 DT 的相關 $C$ 只在 $\omega_nT_s\ll1$、無額外 loop latency 時近似成立（E44）：例如 $\omega_nT_s=0.3$、$d=1$ 時 DT 的相位是 $161.3^\circ$，邊界移到 $1.49\,\omega_n$。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.6',
    title: String.raw`從 $-3\,\mathrm{dB}$ 頻寬到 $\omega_nT_s$、$K_p$、$K_i$，以及 code 的 $\Omega$ 與 $\nu$`,
    page: PAGE,
    formulaId: 'F-06.10',
    formulaTex: String.raw`\frac{\omega_{3\mathrm{dB}}}{\omega_n}=\sqrt{\beta+\sqrt{\beta^2+1}},\;\; \beta=1+2\zeta^2;\qquad K_p=2\zeta\,\omega_nT_s,\quad K_i=(\omega_nT_s)^2;\qquad \Omega=\frac{2\pi f}{f_s},\quad \nu=\frac{\Omega}{\omega_nT_s}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'fref', symbol: String.raw`f_{\mathrm{ref}}`, label: String.raw`reference／取樣頻率（$f_s=f_{\mathrm{ref}}$）`, unit: UNIT_MHZ, default: 100, min: 0, max: 1e6, practice: { choices: [50, 100, 200, 400] } },
      { key: 'bw', symbol: String.raw`\mathrm{BW}`, label: String.raw`主 PLL 的 $-3\,\mathrm{dB}$ 頻寬`, unit: UNIT_MHZ, default: 1, min: 0, max: 1e6, practice: { choices: [0.5, 1, 2] } },
      { key: 'zeta', symbol: String.raw`\zeta`, label: '阻尼比', default: 0.7, min: 0, max: 100, practice: { choices: [0.5, 0.7, 1] } },
      { key: 'f', symbol: 'f', label: 'code 的頻率（例如 residue 基頻）', unit: UNIT_MHZ, default: 0.2, min: 0, max: 1e6, practice: { choices: [0.05, 0.1, 0.2, 0.5, 1, 2] } },
    ],
    validate: ({ fref, bw, zeta, f }) => {
      if (fref <= 0 || bw <= 0) return String.raw`$f_{\mathrm{ref}}$ 與頻寬都必須是正的頻率。`
      if (zeta <= 0) return String.raw`阻尼比必須 $\zeta>0$（$\zeta\le0$ 的主 PLL 不穩定，沒有 $-3\,\mathrm{dB}$ 頻寬可言）。`
      if (f <= 0) return String.raw`$f=0$ 是 DC，$\Omega=0$：Type-II 的 $H_{\mathrm{PD}}(e^{j0})=0$，沒有東西可以相關。請輸入 $f>0$。`
      if (f >= fref / 2) return String.raw`$f\ge f_s/2$ 超過 Nyquist：$\Omega\ge\pi$，取樣後會折返（alias）成 $f_s-f$。請輸入 $f<f_s/2=${tn(fref / 2)}\,\mathrm{MHz}$。`
      const des = designPolarityLoop({ type: 'typeII', zeta, bwRatio: bw / fref, loopDelay: 0 })
      if (!des.stable) {
        return String.raw`頻寬太大：$\omega_nT_s=${tn(des.wLTs, 4)}$ 時 DT 迴路的 closed-loop pole 半徑是 $${tn(des.spectralRadius, 4)}\ge1$，主 PLL 的線性化模型不穩定，$H_{\mathrm{PD}}$ 與 $K_p,K_i$ 的對應都沒有意義。請降低 $\mathrm{BW}/f_{\mathrm{ref}}$。`
      }
      return null
    },
    solve: ({ fref, bw, zeta, f }) => {
      const r = bw / fref
      const beta = 1 + 2 * zeta * zeta // 與 Laplace 變數 s 區分，手算時記成 β
      const inner = Math.sqrt(beta * beta + 1)
      const c3 = ctBandwidth3dB({ zeta, wn: 1 })
      const des = designPolarityLoop({ type: 'typeII', zeta, bwRatio: r, loopDelay: 0 })
      const wn = des.wLTs
      const Omega = (TWO_PI * f) / fref
      const nu = Omega / wn
      const fn = bw / c3
      const notes = [
        String.raw`自然頻率 $f_n=\omega_n/2\pi=\mathrm{BW}/c_{3\mathrm{dB}}=${tn(fn)}\,\mathrm{MHz}$；$\nu=f/f_n$ 也可以這樣直接算。`,
        nu < 1
          ? String.raw`$\nu=${tn(nu)}<1$：這個頻率落在 Type-II $\operatorname{Re}H<0$ 的頻帶內（CT 原型的邊界是 $\nu=1$；DT 邊界略高，E44）。把 $\nu$ 代進 HC-06.5 就能算 $\operatorname{Re}H$。`
          : String.raw`$\nu=${tn(nu)}\ge1$：頻率在 $\omega_n$ 以上，CT 原型的 $\operatorname{Re}H\ge0$（極性正確；DT 邊界略高於 1，E44）。`,
        String.raw`若 $f$ 是一階 DSM residue 的基頻，對應的 FCW 小數是 $\mathrm{frac}=f/f_{\mathrm{ref}}=${tn(f / fref)}$（$\Omega_0=2\pi\,\mathrm{frac}$），此時 $\nu$ 就是 §6.4 的 $\Delta$。`,
      ]
      if (wn > 0.3) {
        notes.push(String.raw`注意 $\omega_nT_s=${tn(wn, 4)}>0.3$ 不算「遠小於 1」：DT 迴路與 CT 原型的對應明顯失準（E44），極性邊界與相位請以 §5.4 的 DT 實驗為準。`)
      }
      return {
        steps: [
          {
            tex: String.raw`\frac{\mathrm{BW}}{f_{\mathrm{ref}}}=\frac{${tn(bw)}}{${tn(fref)}}=${tn(r)}`,
            why: String.raw`本章所有結果只和這個比值有關（$T_s=1/f_{\mathrm{ref}}$；兩個頻率用同一個單位，比值無因次）。`,
          },
          {
            tex: String.raw`\beta=1+2\zeta^2=1+2\times${tp(zeta)}^2=1+2\times${tp(zeta * zeta)}=${tn(beta)}`,
            why: String.raw`$|T(j\omega)|^2=\tfrac12$ 化簡後是 $\nu^4-2\beta\,\nu^2-1=0$，$\beta$ 是其中的係數（只是代號，方便分兩次開根號）。先平方、乘 2、再加 1。`,
          },
          {
            tex: String.raw`\sqrt{\beta^2+1}=\sqrt{${tp(beta)}^2+1}=\sqrt{${tn(beta * beta + 1)}}=${tn(inner)}`,
            why: String.raw`二次方程（未知數 $\nu^2$）的判別式開根號。先算根號裡面，再按一次 $\sqrt{\ }$。`,
          },
          {
            tex: String.raw`c_{3\mathrm{dB}}=\frac{\omega_{3\mathrm{dB}}}{\omega_n}=\sqrt{\beta+\sqrt{\beta^2+1}}=\sqrt{${tn(beta)}+${tn(inner)}}=\sqrt{${tn(beta + inner)}}=${tn(c3)}`,
            why: String.raw`取正根 $\nu^2=\beta+\sqrt{\beta^2+1}$ 再開一次根號：Type-II 的 $-3\,\mathrm{dB}$ 頻寬是 $\omega_n$ 的幾倍。`,
          },
          {
            tex: String.raw`\omega_nT_s=\frac{2\pi\,(\mathrm{BW}/f_{\mathrm{ref}})}{c_{3\mathrm{dB}}}=\frac{${tn(TWO_PI)}\times${tp(r)}}{${tn(c3)}}=\frac{${tn(TWO_PI * r)}}{${tn(c3)}}=${tn(wn)}\ \mathrm{rad/sample}`,
            why: String.raw`$\omega_{3\mathrm{dB}}T_s=2\pi\,\mathrm{BW}/f_{\mathrm{ref}}$，再除以上一步的倍數。這是每個 sample 的角度，無因次。`,
          },
          {
            tex: String.raw`K_p=2\zeta\,\omega_nT_s=2\times${tp(zeta)}\times${tp(wn)}=${tn(des.Kp)}`,
            why: String.raw`DT 迴路的比例增益（F-06.10）。`,
          },
          {
            tex: String.raw`K_i=(\omega_nT_s)^2=${tp(wn)}^2=${tn(des.Ki)}`,
            why: String.raw`DT 迴路的積分增益；§6.4 的近整數公式會用到它。`,
          },
          {
            tex: String.raw`\Omega=\frac{2\pi f}{f_s}=\frac{${tn(TWO_PI)}\times${tp(f)}}{${tn(fref)}}=\frac{${tn(TWO_PI * f)}}{${tn(fref)}}=${tn(Omega)}\ \mathrm{rad/sample}`,
            why: String.raw`離散角頻率：code 每個 sample 轉過的角度（$\Omega=\pi$ 是 Nyquist）。$f$ 與 $f_s$ 用同一個單位（這裡是 $\mathrm{MHz}$）。`,
          },
          {
            tex: String.raw`\nu=\frac{\Omega}{\omega_nT_s}=\frac{${tn(Omega)}}{${tn(wn)}}=${tn(nu)}`,
            why: String.raw`相對於迴路自然頻率的頻率比：$\nu<1$ 就在 Type-II 的反相頻帶裡。`,
          },
        ],
        results: [
          { symbol: String.raw`\omega_nT_s`, label: '自然頻率乘上取樣週期', value: wn, unit: String.raw`\mathrm{rad/sample}`, digits: STEP_SIG },
          { symbol: 'K_p', label: '比例增益', value: des.Kp },
          { symbol: 'K_i', label: '積分增益', value: des.Ki, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\Omega`, label: 'code 的離散角頻率', value: Omega, unit: String.raw`\mathrm{rad/sample}` },
          { symbol: String.raw`\nu`, label: String.raw`頻率比 $\Omega/(\omega_nT_s)$`, value: nu },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例取 $f_{\mathrm{ref}}=100\,\mathrm{MHz}$、$\mathrm{BW}=1\,\mathrm{MHz}$ 只是為了得到本章實驗的預設 $\mathrm{BW}/f_{\mathrm{ref}}=0.01$、$\zeta=0.7$：$\omega_nT_s=0.0306654$、$K_i=9.4037\times10^{-4}$；$f=0.2\,\mathrm{MHz}$ 對應 $\mathrm{frac}=0.002$、$\nu=\Delta=0.410$。請換成你自己的 PLL。`,
      String.raw`$\omega_nT_s$ 還要拿去算 $K_p$、$K_i$、$\nu$（以及 HC-06.8），請留 6 位（範例是 $0.0306654$，答案框也給 6 位）：用只留 5 位的 $0.030665$ 去平方會得到 $K_i=9.4034\times10^{-4}$，而不是 $9.4037\times10^{-4}$。`,
      String.raw`兩層根號可以對照這三個值檢查：$\zeta=0.5,\ 0.7,\ 1$ 時 $c_{3\mathrm{dB}}=${C3DB_TIP.join(String.raw`,\ `)}$——$\zeta=0.7$ 的頻寬大約是 $\omega_n$ 的兩倍。$2\pi=6.28319$。`,
      String.raw`$\omega_{3\mathrm{dB}}$ 的公式來自 CT 原型 $T(s)=\dfrac{2\zeta\omega_ns+\omega_n^2}{s^2+2\zeta\omega_ns+\omega_n^2}$；$K_p,K_i$ 的對應只在 $\omega_nT_s\ll1$、$d=0$ 時等同 CT 原型（E44）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.7',
    title: String.raw`雙頻 code：$C$ 是 $\operatorname{Re}H$ 的功率加權和`,
    page: PAGE,
    formulaId: 'F-06.11',
    formulaTex: String.raw`C=\sum_m P_m\operatorname{Re}H(\nu_m),\quad P_m=\frac{A_m^2}{2},\qquad \operatorname{Re}H_{\text{Type-II}}(\nu)=\frac{-\nu^2(1-\nu^2)}{(1-\nu^2)^2+(2\zeta\nu)^2},\qquad \sigma_x^2=\sum_mP_m`,
    level: 'beginner',
    claim: 'approx',
    inputs: [
      { key: 'zeta', symbol: String.raw`\zeta`, label: '阻尼比', default: 0.7, min: 0, max: 100, practice: { choices: [0.5, 0.7, 1] } },
      { key: 'nu1', symbol: String.raw`\nu_1`, label: String.raw`tone 1 的 $\omega/\omega_n$（低頻）`, default: 0.3, min: 0, max: 1e4, practice: { choices: [0.2, 0.3, 0.5] } },
      { key: 'A1', symbol: 'A_1', label: 'tone 1 的振幅', default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'nu2', symbol: String.raw`\nu_2`, label: String.raw`tone 2 的 $\omega/\omega_n$（高頻）`, default: 2, min: 0, max: 1e4, practice: { choices: [1.5, 2, 3, 4] } },
      { key: 'A2', symbol: 'A_2', label: 'tone 2 的振幅', default: 0.3, min: 0, max: 100, practice: { choices: [0.1, 0.2, 0.3, 0.4, 0.5] } },
    ],
    validate: ({ zeta, nu1, A1, nu2, A2 }) => {
      if (zeta <= 0) return String.raw`阻尼比必須 $\zeta>0$（否則主 PLL 不穩定，$H_{\mathrm{PD}}$ 沒有意義）。`
      if (nu1 <= 0 || nu2 <= 0) return String.raw`兩個頻率比都要 $>0$：$\nu=0$ 是 DC，$H_{\mathrm{PD}}(0)=0$，那條譜線對 $C$ 沒有貢獻。`
      if (nu1 === nu2) return String.raw`$\nu_1=\nu_2$：兩個同頻率的正弦會先合成「一個」正弦，振幅取決於它們的相對相位，功率不是 $P_1+P_2$。譜線和公式要求不同頻率的譜線（互不相關），請讓 $\nu_1\ne\nu_2$。`
      if (A1 === 0 && A2 === 0) return String.raw`$A_1=A_2=0$：沒有 code，$\sigma_x^2=0$，$C/\sigma_x^2$ 沒有定義。`
      return null
    },
    solve: ({ zeta, nu1, A1, nu2, A2 }) => {
      const re1 = ctHpd('typeII', nu1, zeta).re
      const re2 = ctHpd('typeII', nu2, zeta).re
      const P1 = (A1 * A1) / 2
      const P2 = (A2 * A2) / 2
      const lines = { omega: Float64Array.of(nu1, nu2), power: Float64Array.of(P1, P2) }
      const C = lineCorrelation(lines, [ctHpd('typeII', nu1, zeta), ctHpd('typeII', nu2, zeta)])
      const sig2 = linePower(lines)
      const ratio = C / sig2
      const C1 = P1 * re1
      const C2 = P2 * re2
      // C₁ 與 C₂ 異號時相加會抵消掉前幾位：兩個 tone 的 Re H、C₁、C₂ 多留同樣多位，C 才有 6 位可信
      const sig = guardSig(C, [C1, C2])
      const t1 = typeIIReSteps(1, nu1, zeta, sig)
      const t2 = typeIIReSteps(2, nu2, zeta, sig)
      const guardNote =
        sig > STEP_SIG
          ? String.raw`$C_1$ 與 $C_2$ 異號，相加時前 ${sig - STEP_SIG} 位有效數字會互相抵消，所以這一題的中間值顯示 ${sig} 位（比平常多 ${sig - STEP_SIG} 位）；手算時 $\operatorname{Re}H$、$C_1$、$C_2$ 也要留這麼多位，$C$ 才有 5 位可信。`
          : null
      // 兩條「有功率」的線的 Re H 一正一負，才有加權和的拉鋸
      const mixed = clean(C1) * clean(C2) < 0
      return {
        steps: [
          ...t1.steps,
          ...t2.steps,
          {
            tex: String.raw`P_1=\frac{A_1^2}{2}=\frac{${tp(A1)}^2}{2}=${tn(P1, sig)},\qquad P_2=\frac{A_2^2}{2}=\frac{${tp(A2)}^2}{2}=${tn(P2, sig)}`,
            why: String.raw`每條譜線的功率（振幅 $A$ 的正弦平均功率是 $A^2/2$）：先平方，再除以 2。`,
          },
          {
            tex: String.raw`C_1=P_1\operatorname{Re}H_1=${tp(P1, sig)}\times${tp(re1, sig)}=${tn(C1, sig)}`,
            why: String.raw`tone 1 單獨的相關（就是 F-06.4：$\tfrac{A^2}{2}|H|\cos\phi$）。`,
          },
          {
            tex: String.raw`C_2=P_2\operatorname{Re}H_2=${tp(P2, sig)}\times${tp(re2, sig)}=${tn(C2, sig)}`,
            why: 'tone 2 單獨的相關。',
          },
          {
            tex: String.raw`C=C_1+C_2=${tn(C1, sig)}+${tp(C2, sig)}=${tn(C)}`,
            why: String.raw`不同頻率的正弦互不相關（交叉項平均為 0），所以相關直接相加——這就是 $\tfrac{1}{2\pi}\int S_{xx}\operatorname{Re}H\,d\Omega$ 在譜線上的樣子。`,
          },
          {
            tex: String.raw`\sigma_x^2=P_1+P_2=${tn(P1, sig)}+${tn(P2, sig)}=${tn(sig2, sig)}`,
            why: 'Parseval：總功率是各譜線功率的和。',
          },
          {
            tex: String.raw`\frac{C}{\sigma_x^2}=\frac{${tn(C)}}{${tn(sig2, sig)}}=${tn(ratio)}`,
            why: String.raw`$\operatorname{Re}H$ 以功率為權重的加權平均，一定落在 $\operatorname{Re}H_1$ 與 $\operatorname{Re}H_2$ 之間。`,
          },
        ],
        results: [
          { symbol: String.raw`\operatorname{Re}H_1`, label: String.raw`tone 1 的 $\operatorname{Re}H$`, value: clean(t1.re), tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: String.raw`\operatorname{Re}H_2`, label: String.raw`tone 2 的 $\operatorname{Re}H$`, value: clean(t2.re), tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: 'C', label: String.raw`總相關 $E[x\,u]$`, value: clean(C), tolerance: { rel: 0.02, abs: 5e-5 } },
          { symbol: String.raw`C/\sigma_x^2`, label: String.raw`正規化相關`, value: clean(ratio), tolerance: { rel: 0.02, abs: 5e-5 } },
        ],
        notes: [
          ...(mixed
            ? [
                clean(C) < 0
                  ? String.raw`$C<0$：$\operatorname{Re}H<0$ 那條線（低於 $\omega_n$）的負貢獻贏了，raw-$x$ LMS 平均發散。`
                  : clean(C) > 0
                    ? String.raw`$C>0$：$\operatorname{Re}H>0$ 那條線（高於 $\omega_n$）的正貢獻贏了，極性正確。`
                    : String.raw`$C=0$：兩條線剛好抵消，沒有恢復力。`,
                String.raw`只看 $\operatorname{Re}H<0$ 的那個 tone 會以為「一定發散」，只看另一個會以為「一定收斂」；真正決定方向的是功率加權和——所以規格說 $C$ 不是某一個頻率的 phase margin。`,
              ]
            : [
                clean(C) < 0
                  ? String.raw`$C<0$：對 $C$ 有貢獻的 tone 都在反相頻帶（$\nu<1$）裡，$\operatorname{Re}H$ 沒有正的可以抵消——不論功率怎麼分配，raw-$x$ LMS 都平均發散。把其中一個 $\nu$ 改到 1 以上（振幅不為 0），才看得到「加權和」的拉鋸。`
                  : clean(C) > 0
                    ? String.raw`$C>0$：對 $C$ 有貢獻的 tone 都在 $\omega_n$ 以上，$\operatorname{Re}H$ 沒有負的——不論功率怎麼分配，極性都正確。把其中一個 $\nu$ 改到 1 以下（振幅不為 0），才看得到「加權和」的拉鋸。`
                    : String.raw`$C=0$：兩條線對 $C$ 都沒有貢獻（$\nu=1$ 時 $\operatorname{Re}H=0$，或振幅為 0），沒有恢復力。`,
              ]),
          ...(guardNote ? [guardNote] : []),
        ],
      }
    },
    tips: [
      String.raw`全程只有四則運算，但步驟多：建議先把兩個 tone 的 $a,b,\Delta,\operatorname{Re}H$ 各寫成一欄。`,
      String.raw`範例：tone 1 在 $\nu=0.3$（$\operatorname{Re}H=-0.0815$，§5.2），tone 2 在 $\nu=2$（$\operatorname{Re}H=+0.7126$，思考題 3）。$A_2=0.3$ 時 $C<0$；把 $A_2$ 改成 0.4，只多一點點高頻能量，$C$ 就翻成正的。`,
      String.raw`這裡用 CT 原型的 $\operatorname{Re}H$ 代表 DT 迴路，只在 $\omega_nT_s\ll1$、無額外 latency 時近似成立（E44），所以標成「近似」。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'HC-06.8',
    title: String.raw`綜合題：近整數 FCW ＋ GMAC code delay，極性會不會翻？`,
    page: PAGE,
    formulaId: 'F-06.18',
    // 兩行（gathered）：排成一行在桌機的正文欄會超出幾個像素，多出一條沒有用途的橫向捲軸
    formulaTex: String.raw`\begin{gathered}\frac{R_x[\ell]}{\sigma_x^2}=1-6\,t_\ell(1-t_\ell),\;\;t_\ell=|\ell|\,\mathrm{frac}\\[4pt] \frac{C_D}{\sigma_x^2}\approx-12\,\mathrm{frac}\,D+\frac{12\,\mathrm{frac}^2}{K_i},\;\;K_i=(\omega_nT_s)^2;\qquad p=1-\mu K_qC_D\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'frac', symbol: String.raw`\mathrm{frac}`, label: 'FCW 的小數部分', default: 5e-4, min: 0, max: 1, practice: { choices: [2e-4, 5e-4, 1e-3, 2e-3] } },
      { key: 'wn', symbol: String.raw`\omega_nT_s`, label: 'Type-II 迴路的自然頻率（HC-06.6）', unit: String.raw`\mathrm{rad/sample}`, default: 0.0306654, min: 0, max: 10, practice: { choices: [0.02, 0.03, 0.05, 0.1] } },
      { key: 'd', symbol: 'd', label: '主迴路額外 latency', unit: UNIT_SAMPLES, default: 0, min: 0, max: 4, integer: true, practice: { choices: [0, 1, 2] } },
      { key: 'D', symbol: 'D', label: 'GMAC code delay（regressor 落後）', unit: UNIT_SAMPLES, default: 1, min: 0, max: 16, integer: true, practice: { choices: [0, 1, 2, 3] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate', unit: UNIT_FS, default: 150, min: -1e5, max: 1e5, practice: { choices: [50, 100, 150, 200] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: UNIT_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ frac, wn, d, D, mu, sigmaV }) => {
      if (frac <= 0) return String.raw`$\mathrm{frac}=0$ 是整數 FCW：一階 DSM 的 residue 恆為常數，沒有鋸齒，$\sigma_x^2=0$。請輸入 $0<\mathrm{frac}\le0.5$。`
      if (frac > 0.5) return String.raw`$\mathrm{frac}>0.5$ 時鋸齒的基頻超過 Nyquist，等效於 $1-\mathrm{frac}$ 的反向鋸齒；「近整數」指的是 $\mathrm{frac}\to0$（或 $\to1$）。請輸入 $0<\mathrm{frac}\le0.5$。`
      if (wn < 1e-3) return String.raw`$\omega_nT_s$ 太小（$<10^{-3}$）：脈衝響應要幾十萬個 sample 才衰減完，超出這一題的計算範圍。請輸入 $\omega_nT_s\ge10^{-3}$。`
      if (sigmaV <= 0) return MSG_SIGMA
      if (mu <= 0) return MSG_MU
      const loop = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: wn, loopDelay: d })
      if (!loop.stable) {
        return String.raw`$\omega_nT_s=${tn(wn, 4)}$、$d=${d}$ 的 Type-II DPLL 不穩定（closed-loop pole 半徑 $${tn(loop.spectralRadius, 4)}\ge1$，以 $\zeta=0.7$ 計）：$H_{\mathrm{PD}}$ 沒有意義。請降低 $\omega_nT_s$ 或 $d$。`
      }
      const Delta = (TWO_PI * frac) / wn
      if (Delta >= 1) {
        return String.raw`$\Delta=2\pi\,\mathrm{frac}/(\omega_nT_s)=${tn(Delta, 4)}\ge1$：residue 的基頻已經在迴路頻寬之外，脈衝響應還沒衰減完鋸齒就折返了，動差展開（F-06.14／F-06.18）不適用。請減小 $\mathrm{frac}$ 或加大 $\omega_nT_s$；這種情況要用精確的自相關和 $\sum_kh[k]R_x[k-D]$（§6.4 的 FCW 掃描實驗）。`
      }
      if (D > d + 1) {
        // 用使用者自己的數字算出「硬套兩項式」與精確自相關和的差距（數字來自模型函式，不是寫死的例子）
        const { h, Ki } = typeIIImpulse(wn, 0.7, d)
        const two = -12 * frac * D + (12 * frac * frac) / Ki
        const exact = autocorrCorrelation(h, sawtoothAutocorr(frac), D)
        return String.raw`F-06.18 只在 $D\le d+1=${d + 1}$ 時成立：DT 迴路要 $1+d$ 個 sample 後才開始修正（$h[0]=1$、$h[1..d]=0$），所以一階項的 $\sum_{k<D}h[k](D-k)$ 才剛好等於 $D$。$D>d+1$ 時還要扣掉 $O(\omega_nT_s)$ 的修正——以你的數字，硬套兩項式會得到 $${tn(two, 3)}$，精確的自相關和（$\zeta=0.7$）是 $${tn(exact, 3)}$——手算不划算。請減小 $D$ 或加大 $d$。`
      }
      return null
    },
    solve: ({ frac, wn, d, D, mu, sigmaV }) => {
      const { h, Ki } = typeIIImpulse(wn, 0.7, d)
      const rx = sawtoothAutocorr(frac)
      const tD = D * frac
      const RD = rx(D)
      const Delta = (TWO_PI * frac) / wn
      const first = -12 * frac * D
      const second = (12 * frac * frac) / Ki
      // 動差展開（D ≤ d + 1 時 = −12·frac·D + 12·frac²/K_i）。兩項剛好抵消（D = D*）時，剩下的只有
      // 截斷脈衝響應的浮點殘渣（1e−13）與鋸齒折返後的尾巴（1e−11）：比兩項小 8 個數量級、已在顯示位數（MAX_SIG）之外，當成 0
      const negligible = 1e-8 * Math.max(Math.abs(first), Math.abs(second))
      const Craw = sawtoothMomentApprox(h, frac, D)
      const C = Math.abs(Craw) <= negligible ? 0 : Craw
      const exactRaw = autocorrCorrelation(h, rx, D)
      const exact = Math.abs(exactRaw) <= negligible ? 0 : exactRaw
      const Dstar = frac / Ki
      const Kq = kqFromSigma(sigmaV)
      const p = calPole(mu, Kq, C)
      const g = mu * Kq * C
      const pSig = poleSig(p, g)
      // 一階項（負）與二階項（正）相加會抵消掉前幾位：K_i 與兩項都多留同樣多位
      const sig = guardSig(C, [first, second])
      const diff = Math.abs(C - exact)
      const relDiff = diff / Math.max(Math.abs(exact), Math.abs(C), Number.MIN_VALUE)
      const exactRef = String.raw`對照網站的精確自相關和 $\sum_kh[k]R_x[k-D]/\sigma_x^2=${tn(exact)}$（F-06.12＋F-06.17，$\zeta=0.7$ 的 DT 迴路）`
      const compare =
        C * exact < 0
          ? String.raw`${exactRef}：正負號和兩項式不同！$\Delta=${tn(Delta, 3)}$ 不夠小，而且 $D$ 很接近門檻 $D^*$，兩項互相抵消後剩下的值比展開本身的誤差還小——這種情況以精確和為準。`
          : relDiff > 0.01
            ? String.raw`${exactRef}：兩項式差了 $${tn(relDiff * 100, 2)}\%$。$\Delta=${tn(Delta, 3)}$ 不算遠小於 1：脈衝響應的尾巴還沒衰減完，鋸齒就折返了（$k>1/\mathrm{frac}$ 的項不再是二次式），兩項式只能當估計。`
            : String.raw`${exactRef}：和兩項式一致（相差${diff < 1e-9 ? String.raw`小於 $10^{-9}$` : String.raw` $${tn(diff, 2)}$`}）。鋸齒的自相關在 $|k-D|\,\mathrm{frac}<1$ 內恰好是二次式，所以展開沒有 $\mathrm{frac}^3$ 以上的項；誤差只來自脈衝響應在 $k>1/\mathrm{frac}$ 之後的尾巴，$\Delta$ 越小越可以忽略。`
      return {
        steps: [
          {
            tex: String.raw`K_i=(\omega_nT_s)^2=${tp(wn)}^2=${tn(Ki, sig)}`,
            why: String.raw`Type-II DPLL 的積分增益（F-06.10）；它決定脈衝響應的二階動差 $m_2=2/K_i$。`,
          },
          {
            tex: String.raw`\Delta=\frac{2\pi\,\mathrm{frac}}{\omega_nT_s}=\frac{${tn(TWO_PI)}\times${tp(frac)}}{${tn(wn)}}=\frac{${tn(TWO_PI * frac)}}{${tn(wn)}}=${tn(Delta)}`,
            why: String.raw`residue 基頻 $\Omega_0=2\pi\,\mathrm{frac}$ 相對於迴路頻率。$\Delta<1$：基頻在 Type-II 的反相頻帶裡；$\Delta\ll1$ 才是「近整數」，下面的展開才準。`,
          },
          {
            tex: String.raw`t_D=D\cdot\mathrm{frac}=${tn(D)}\times${tp(frac)}=${tn(tD)}`,
            why: String.raw`regressor 落後 $D$ 個 sample，等於鋸齒相位差了 $t_D$ 個週期。`,
          },
          {
            tex: String.raw`\frac{R_x[D]}{\sigma_x^2}=1-6\,t_D(1-t_D)=1-6\times${tp(tD)}\times(1-${tp(tD)})=1-6\times${tp(tD)}\times${tn(1 - tD, 8)}=1-${tp(6 * tD * (1 - tD), 8)}=${tn(RD, 8)}`,
            why: String.raw`鋸齒的自相關（F-06.17）。注意它對 $t$ 有「一次項」$-6t$（折返跳變造成的折角）：這就是 $D\ge1$ 會出事的來源。`,
          },
          {
            tex: String.raw`D^*=\frac{\mathrm{frac}}{K_i}=\frac{${tn(frac)}}{${tn(Ki, sig)}}=${tn(Dstar)}`,
            why: String.raw`變號門檻（F-06.18）：$D>D^*$ 時 $C_D<0$。越接近整數（$\mathrm{frac}$ 越小）門檻越低。`,
          },
          {
            tex: String.raw`-12\,\mathrm{frac}\,D=-12\times${tp(frac)}\times${tn(D)}=${tn(first, sig)}`,
            why: String.raw`一階項：跳變當下的尖峰 $h[0]=1$ 乘到跳變「前」的鋸齒頂部，Type-II 消不掉。$D=0$ 時這一項是 0。`,
          },
          {
            tex: String.raw`\frac{12\,\mathrm{frac}^2}{K_i}=\frac{12\times${tp(frac)}^2}{${tn(Ki, sig)}}=\frac{${tn(12 * frac * frac, sig)}}{${tn(Ki, sig)}}=${tn(second, sig)}`,
            why: String.raw`二階項（F-06.14）：$D=0$ 時唯一剩下的、正的恢復力，等於 $\tfrac{3}{\pi^2}\Delta^2$（可以用第 2 步的 $\Delta$ 驗算）。`,
          },
          {
            tex: String.raw`\frac{C_D}{\sigma_x^2}\approx-12\,\mathrm{frac}\,D+\frac{12\,\mathrm{frac}^2}{K_i}=${tn(first, sig)}+${tp(second, sig)}=${tn(C)}`,
            why: String.raw`兩項相加（code 已 standardize，$\sigma_x^2=1$，所以這就是 $C_D$）。${sig > STEP_SIG ? String.raw`兩項異號、互相抵消掉前 ${sig - STEP_SIG} 位，所以上面的 $K_i$ 與兩項都顯示 ${sig} 位。` : ''}`,
          },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${tn(SQRT_2_OVER_PI)}}{${tn(sigmaV)}}=${tn(Kq)}\ \mathrm{fs}^{-1}`,
            why: String.raw`comparator 小訊號增益：按 $2\div\pi$、開根號（$=${tn(SQRT_2_OVER_PI)}$），再除以 $\sigma_v$ [$\mathrm{fs}$]。`,
          },
          {
            tex: String.raw`g=\mu K_qC_D=${tp(mu)}\times${tp(Kq)}\times${tp(C)}=${tn(g)}`,
            why: String.raw`校正迴路增益（$\mathrm{fs}\times\mathrm{fs}^{-1}$，無因次）。`,
          },
          {
            tex: String.raw`p=1-g=1-${tp(g)}=${tn(p, pSig)}`,
            why: '平均 pole（F-06.3，小訊號）。',
          },
        ],
        results: [
          { symbol: String.raw`R_x[D]/\sigma_x^2`, label: String.raw`鋸齒自相關（lag $D$）`, value: RD, digits: 7, tolerance: { rel: 0, abs: Math.max(0.02 * Math.abs(1 - RD), 1e-9) } },
          { symbol: 'D^*', label: String.raw`變號門檻 $\mathrm{frac}/K_i$`, value: Dstar, tolerance: { rel: 0.02 } },
          { symbol: String.raw`C_D/\sigma_x^2`, label: '小訊號相關（兩項近似）', value: C, tolerance: { rel: 0.03, abs: 1e-7 } },
          { symbol: 'p', label: '平均 pole', value: clean(p), digits: pSig, tolerance: { rel: 0, abs: Math.max(0.04 * Math.abs(p - 1), 1e-9) } },
        ],
        notes: [
          C === 0
            ? String.raw`$D=${D}=D^*\;\Rightarrow\;C_D=0$：一階項與二階項剛好抵消，沒有恢復力；$\mathrm{frac}$ 再小一點就變號。`
            : D > Dstar
              ? String.raw`$D=${D}>D^*=${tn(Dstar)}\;\Rightarrow\;C_D<0$：regressor 只落後 ${D} 個 sample，raw-$x$ LMS 的極性就反了。`
              : D === 0
                ? String.raw`$D=0$：一階項為 0，只剩正的二階項——小訊號不變號，但恢復力以 $\mathrm{frac}^2$ 消失（$C\to0^+$），而且只是局部穩定（§6.4 但書 1）。`
                : String.raw`$D=${D}<D^*=${tn(Dstar)}\;\Rightarrow\;C_D>0$：這個 $\mathrm{frac}$ 還不夠接近整數，極性沒有翻；再靠近整數（$\mathrm{frac}<K_iD=${tn(Ki * D)}$）就會變號。`,
          poleVerdict(C, Kq, p, pSig),
          compare,
        ],
      }
    },
    tips: [
      String.raw`範例：預設 Type-II 迴路（$\mathrm{BW}/f_{\mathrm{ref}}=0.01$、$\zeta=0.7\;\Rightarrow\;\omega_nT_s=0.0306654$，就是 HC-06.6 的答案，留 6 位）、$\mathrm{frac}=5\times10^{-4}$、$D=1$，就是 §6.4 表格的那一格：$C_1/\sigma_x^2\approx-0.00281$，門檻 $D^*=0.532$。`,
      String.raw`把 $D$ 改成 0 再算一次：$C/\sigma_x^2=12\,\mathrm{frac}^2/K_i=+0.00319$。同一個 FCW，regressor 差一個 sample，符號就相反。`,
      String.raw`$\sqrt{2/\pi}=0.797885$。$p$ 非常接近 1，請保留 6 位以上小數。`,
      String.raw`一階項（負）與二階項（正）大小接近時，相加會抵消掉前幾位有效數字：$D$ 越接近 $D^*$，$K_i$ 與兩項就要多留幾位（步驟會自動多顯示）。`,
      String.raw`適用條件：一階 DSM residue（理想鋸齒）、Type-II DPLL、$\Delta\ll1$、$D\le d+1$、小訊號（$|\delta|u_{\max}\ll\sigma_v$）。`,
    ],
  },
]
