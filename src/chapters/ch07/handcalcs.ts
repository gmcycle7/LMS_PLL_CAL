import { texNum } from '@/components'
import type { HandCalcDef, HandCalcResult, HandCalcStep } from '@/data/types'
import { cAbs, cArg, wrap180 } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import { designDtLoop, polarityMarginDeg } from '@/simulation/models/pll'
import {
  analyticCorr,
  averagingPenalty,
  bestToneDelay,
  buildHat,
  calPole,
  calTimeConstant,
  delayToleranceRad,
  HAT_EXACT,
  kqFromSigma,
  normalizedCorr,
  pathStability,
  pathTransfer,
  residualPhaseDeg,
  secondDiffResponse,
  toneCorrAtTheta,
  toneCorrCodeDelay,
  toneCorrErrorDelay,
  type DelayConvention,
  type FxCodeSpec,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import {
  add,
  breakChain,
  calc,
  chain,
  cosd,
  cosDeg,
  deg,
  degT,
  div,
  dpOf,
  given,
  mul,
  roundDec,
  roundSig,
  SHOWN_TOL,
  sind,
  sq,
  sqrt,
  sub,
  tidy,
  wrapDeg,
  wrapTex,
  type ChainOpt,
  type ChainOut,
} from './handcalcTex'
import { DEG, RAD } from './util'

/**
 * Ch07「帶入手算」題（docs/teaching-style.md §7；範本 src/chapters/ch00/handcalcs.ts）。
 *
 *  - 答案（results）一律來自 src/simulation/models/filteredX.ts（與 pll.polarityMarginDeg／designDtLoop）的實際函式；
 *    步驟中的中間量（ΩD、cos θ、複數的實部／虛部…）只是同一條公式拆開的四則運算。handcalcs.test.tsx 逐題驗證
 *    「模型函式 = 測試內的獨立重算」，並且把每一步的 TeX 重新求值（畫面上的數字自己算得出下一個等號）。
 *  - 每一步用 ./handcalcTex.ts 的 chain() 產生「符號式 = 代入數字 =（中間結果 =）結果」：一個等號只做一種運算；
 *    使用者輸入的數完整顯示；相減會吃掉有效位數的地方，運算元自動多顯示幾位。
 *    桌機的內文欄（約 850 px）放不下一整行的步驟（HC-07.7 的複數乘除），用 breakChain() 在等號前換行、對齊第一個等號——內容不變。
 *  - 極性約定：δ = a − w；延遲 GMAC 的 code ⇒ θ = φ + ΩD；延遲 comparator 誤差 ⇒ θ′ = φ − ΩD。
 *  - 頻率一律是離散時間 Ω（E44）；單頻公式只適用 0 < Ω < π（E46）；Ĥ ≠ H 時 pole 用 E[u·u_f]（E45）。
 *  - 角度：手算最常用「度」，所以多數題目的 Ω 以 °/sample 輸入；和本文 rad/sample 的例子對照的題目（HC-07.3、HC-07.4）
 *    多一步「× 180°/π」。
 *
 * 題目在章內的位置（緊跟在對應的推導／worked example 之後；章內用 ./Hand.tsx 依 id 取出）：
 *   HC-07.1 → §7.1 的 D 掃描表之後；HC-07.2 → §7.2 的 boxed F-07.2 之後；HC-07.3 → §7.3 的 Type-II 例子之後；
 *   HC-07.4 → §7.3 的多頻表之後；HC-07.5 → §7.4 的 ρ 定義（F-07.13）之後；HC-07.6 → §7.5 的失效表之後；
 *   HC-07.7 → §7.5 二次差分的相位表之後（Engineer 模式以上）；HC-07.8（綜合）→ §7.7 Lab 之後、§7.8 思考題之前。
 */

const r = String.raw

/** 算出來的數（TeX，四捨五入到 sig 位有效數字） */
const num = (v: number, sig = 5): string => texNum(tidy(v), sig)

/** 這一步的運算元比平常多寫了幾位時，附在說明後面的一句話 */
const WHY_EXTRA = r`（這一步的結果對捨入很敏感，所以運算元多寫了幾位；手算時這些量也請多留幾位，不要只抄 5 位。）`
const step = (c: ChainOut, why: string): HandCalcStep => ({ tex: c.tex, why: c.extended ? why + WHY_EXTRA : why })

/** 角度的加、減、乘：使用者輸入的小數完整顯示（最多 6 位小數），不四捨五入到 5 位有效數字 */
const ANG: ChainOpt = { round: (v) => roundDec(v, 6), absTol: 1e-6 }

const WHY_WRAP = r`轉整圈不改變 $\cos$：超過 $180^\circ$ 就減 $360^\circ$、小於等於 $-180^\circ$ 就加 $360^\circ$，把角度折回 $(-180^\circ,180^\circ]$。`
const WHY_NO_WRAP = r`已經在 $(-180^\circ,180^\circ]$ 內，不必折返。`

/** 模型算出的殘餘相位（度）對到十進位格點上：去掉浮點尾巴，$180^\circ$ 不會因為 $10^{-14}$ 的誤差變成 $-180^\circ$。 */
function snapAngle(model: number, raw: number): number {
  const exact = wrapDeg(raw)
  return Math.abs(wrapDeg(model - exact)) < 1e-6 ? exact : tidy(model)
}

/** 殘餘相位的三個手算量：ΩD、φ ± ΩD（未折返）、θ（折回 (−180°, 180°]；數值來自模型的 residualPhaseDeg）。 */
interface Residual {
  /** ΩD = Ω × D */
  omD: ChainOut
  /** φ ± ΩD 的那一段算式（沒有左式） */
  sum: ChainOut
  raw: number
  theta: number
  wrap: { tex: string; wrapped: boolean }
}
function residual(phi: number, omega: number, D: number, convention: DelayConvention = 'code', lhs = r`\Omega D`): Residual {
  const omD = chain(lhs, mul(deg(omega), given(D)), ANG)
  const sum = chain('', convention === 'code' ? add(deg(phi), deg(omD.shown)) : sub(deg(phi), deg(omD.shown)), ANG)
  const theta = snapAngle(residualPhaseDeg(phi * RAD, omega * RAD, D, convention), sum.shown)
  return { omD, sum, raw: sum.shown, theta, wrap: wrapTex(sum.shown, theta) }
}
/** 「θ = φ + ΩD = … = θ」；需要折返時寫成兩句：「φ + ΩD = … = raw ⇒ θ = raw − 360° = θ」（每個等號都成立）。 */
function thetaTex(sym: string, expr: string, a: { sum: ChainOut; wrap: { tex: string; wrapped: boolean } }): string {
  return a.wrap.wrapped ? r`${expr} = ${a.sum.tex}\;\Rightarrow\;${sym} = ${a.wrap.tex}` : `${sym} = ${expr} = ${a.sum.tex}`
}

const E46_DEG = r`單頻公式只適用 $0<\Omega<180^\circ$/sample（勘誤 E46）：$\Omega=0$ 或 $180^\circ$ 時兩倍頻的項不會平均掉，$C_D=A^2H\cos(\Omega D)$ 是一般公式的 2 倍，而且實係數濾波器在這兩個頻率只允許 $\phi\in\{0^\circ,180^\circ\}$。請換一個 $\Omega$。`
const E46_RAD = r`單頻公式只適用 $0<\Omega<\pi$ rad/sample（也就是 $0<f<f_s/2$；勘誤 E46）：$\Omega=0$ 或 $\pi$ 時兩倍頻的項不會平均掉，公式要改成 2 倍的 $C_D=A^2H\cos(\Omega D)$。請換一個 $\Omega$。`
const omegaDegError = (omega: number): string | null => (omega > 0 && omega < 180 ? null : E46_DEG)
const omegaRadError = (omega: number): string | null => (omega > 0 && omega < Math.PI ? null : E46_RAD)
const SIGMA_ERR = r`$\sigma_v$ 必須大於 0：沒有雜訊時 1-bit comparator 的平均輸出是階梯而不是斜率 $K_q$ 的直線，$p=1-\mu K_qC$ 這個線性化 pole 不適用。`

const TIP_COS = r`$\cos$ 用計算機的 DEG（角度）模式。常用角可以直接背：$\cos0^\circ=1$、$\cos30^\circ=0.8660$、$\cos45^\circ=0.7071$、$\cos60^\circ=0.5$、$\cos90^\circ=0$；另外 $\cos(-\alpha)=\cos\alpha$、$\cos(180^\circ-\alpha)=-\cos\alpha$。`
const TIP_KQ = r`$\sqrt{2/\pi}$：先算 $2\div\pi=0.63662$，再開根號得 $0.79788$（多留幾位是 $0.7978846$）；所以 $K_q=0.79788/\sigma_v$（單位 $\mathrm{fs^{-1}}$）。`
const TIP_TAU = r`時間常數 $\tau=-1/\ln|p|$（按計算機的 $\ln$）。$g=1-p$ 很小時可以不按 $\ln$：$\tau\approx1/g-\tfrac12$（$g\le0.1$ 時誤差小於 $0.1\%$；只用 $1/g$ 則約高估 $5\%$）。`
const TIP_POLE = r`$p=1-g$（$g=\mu K_qC$）：先乘、再用 1 去減。$g$ 很接近 1 時相減會吃掉有效位數，步驟會自動把 $\mu K_q$ 多寫幾位——照計算機上完整的數字算就對了。`
const TIP_RAD = r`$180^\circ/\pi=57.2958$（多留幾位是 $57.29578$）。弧度很大（幾百 rad 以上）時 6 位不夠，步驟會自動多寫幾位。`

/**
 * pole 顯示到小數幾位：一般 5 位（和本文表格一致）。
 *  - $|p|$ 很小或 $p$ 很接近 1：改成看得出 $p$（5 位有效數字）與 $g=1-p$（3 位有效數字）的位數，最多 8 位；
 *  - $|p|\ge1$ 而且 $|g|\ge1$：$g$ 只有 5 位有效數字，$p=1-g$ 就顯示到 $g$ 的最後一位小數（$1-6.3831=-5.3831$）。
 */
function poleDec(p: number): number {
  if (p === 0 || !Number.isFinite(p)) return 5
  const g = Math.abs(1 - p)
  if (Math.abs(p) >= 1 && g >= 1) return Math.max(0, Math.min(5, 4 - Math.floor(Math.log10(g))))
  const e = Math.floor(Math.log10(Math.abs(p)))
  const forG = g === 0 ? 0 : 2 - Math.floor(Math.log10(g))
  return Math.min(8, Math.max(e >= 0 ? 5 : 4 - e, forG))
}
const poleRound = (p: number): number => roundDec(p, poleDec(p))
const pole = (p: number): string => texNum(poleRound(p), 12)
/** pole 的容許誤差：以 loop gain $g=1-p$ 的 1% 為準（$g$ 很小時 $p\approx1$，用 $p$ 的相對誤差會把 $g$ 差一倍的答案也判對）。 */
const poleTol = (g: number): HandCalcResult['tolerance'] => ({ abs: Math.max(2e-5, 0.01 * Math.abs(g)), rel: 0 })

/** pole 的一句話判讀（含時間常數；τ 由 calTimeConstant 計算） */
function poleVerdict(name: string, p: number): string {
  if (p === 1) return `${name}：$p=1$，沒有平均恢復力，$w$ 只會隨雜訊漂移。`
  if (p > 1) return `${name}：$p=${pole(p)}>1$，平均誤差每個 block 放大 $${pole(p)}$ 倍（反向更新，發散）。`
  if (p <= -1) return `${name}：$p=${pole(p)}\\le-1$（$g\\ge2$），每個 block 修正過頭而且越跳越遠（發散）；請減小 $\\mu$。`
  if (Math.abs(p) < 5e-7) return `${name}：$p\\approx0$（$g\\approx1$），一個 block 就把平均誤差修完。`
  return `${name}：$|p|=${pole(Math.abs(p))}<1$，收斂；時間常數 $\\tau=-1/\\ln|p|=${num(calTimeConstant(p), 4)}$ blocks${p < 0 ? '（$p<0$：每個 block 跳到答案的另一側）' : ''}。`
}

/** 平均 pole 的一步：p = 1 − μK_q·C = 1 − g = p（先乘、再用 1 去減） */
const poleStep = (lhs: string, muKq: ChainOut, C: ChainOut, p: number): ChainOut => chain(lhs, sub(given(1), mul(muKq.leaf, C.leaf)), { target: p, round: poleRound })

// ── 本文 worked example 的數字：由模型即時算出再取到本文顯示的位數（模型若改動，預設值會跟著變，測試會抓到）──
const TYPE2: FxPathSpec = { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 }
const T2 = pathTransfer(TYPE2)
const [T2_H1, T2_H2] = freqz(T2.b, T2.a, [0.03, 0.05])
/** 7.3 節 Type-II 例子：Ω = 0.03 的 ∠H（本文顯示到小數 3 位）與對齊它的整數 D（= 119） */
const T2_PHI1_DEG = roundDec(cArg(T2_H1) * DEG, 3)
const T2_D1 = bestToneDelay(cArg(T2_H1), 0.03, 400).D

/** 取最接近的整數；剛好差 0.5 時取較小的（F-07.4 的手算規則） */
const roundHalfDown = (x: number): number => {
  const lo = Math.floor(x)
  return x - lo <= 0.5 ? lo : lo + 1
}

/**
 * 弧度換成的角度要顯示到小數幾位（3…6）：照畫面上的 θ 按 cos，要得到畫面上的 cos θ。
 * θ 接近 ±90° 時 cos 對角度很敏感，小數 3 位不夠。
 */
function angleDecimals(phiDeg: number, turnDeg: number, cosTrue: number): number {
  let d = Math.min(6, Math.max(3, dpOf(phiDeg)))
  while (d < 6 && Math.abs(cosDeg(roundDec(phiDeg + roundDec(turnDeg, d), d)) - cosTrue) > 0.5 * SHOWN_TOL * Math.abs(cosTrue)) d++
  return d
}

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.1',
    title: r`殘餘相位 $\theta$ 與 polarity margin：這個 $D$ 的極性對不對？`,
    page: '/ch/07',
    formulaId: 'F-07.4',
    formulaTex: r`\theta=\mathrm{wrap}_{180}(\phi+\Omega D),\qquad M_{\mathrm{pol}}=90^\circ-|\theta|,\qquad C_D>0\iff|\theta|<90^\circ\iff M_{\mathrm{pol}}>0`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'phi', symbol: r`\phi`, label: '誤差路徑在 code 頻率的相位（負 = PD 端落後）', unit: r`\mathrm{deg}`, default: -120, min: -180, max: 180, practice: { choices: [-150, -135, -90, -60, -120, -45, 60, 120, 150] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率（每個 sample 轉幾度）', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [15, 20, 30, 45, 60, 90] } },
      { key: 'D', symbol: 'D', label: 'GMAC code 的延遲（shift register 級數）', unit: r`\text{samples}`, default: 4, min: 0, max: 5000, integer: true, practice: { min: 0, max: 11, step: 1 } },
    ],
    validate: ({ omega }) => omegaDegError(omega),
    solve: ({ phi, omega, D }) => {
      const a = residual(phi, omega, D)
      const aE = residual(phi, omega, D, 'error')
      const M = tidy(polarityMarginDeg(a.theta))
      const ME = tidy(polarityMarginDeg(aE.theta))
      const mStep = chain(r`M_{\mathrm{pol}} = 90^\circ - |\theta|`, sub(deg(90), deg(Math.abs(a.theta))), { ...ANG, target: M })
      return {
        steps: [
          step(a.omD, r`每多延遲 1 個 sample，code 的相位就多落後 $\Omega$；延遲 $D$ 個 sample 一共轉 $\Omega D$。`),
          {
            tex: r`\phi+\Omega D = ${a.sum.tex}`,
            why: r`延遲的是 GMAC 那一側的 code，所以是「加」$\Omega D$（延遲 comparator 那一側則是減，見下方的對照）。`,
          },
          {
            tex: r`\theta = \mathrm{wrap}_{180}\big(${degT(a.raw)}\big) = ${a.wrap.tex}`,
            why: a.wrap.wrapped ? WHY_WRAP : WHY_NO_WRAP,
          },
          step(mStep, r`離變號（$|\theta|=90^\circ$，$\cos\theta=0$）還有幾度；負值表示已經過頭。`),
        ],
        results: [
          { symbol: r`\theta`, label: '殘餘相位', value: a.theta, unit: r`\mathrm{deg}`, digits: 8, tolerance: { abs: 0.05, rel: 0.005 } },
          { symbol: r`M_{\mathrm{pol}}`, label: 'polarity margin', value: M, unit: r`\mathrm{deg}`, digits: 8, tolerance: { abs: 0.05, rel: 0.005 } },
        ],
        notes: [
          M > 0
            ? r`$M_{\mathrm{pol}}>0$（$|\theta|<90^\circ$）$\Rightarrow\cos\theta>0\Rightarrow C_D>0$：更新方向正確${a.theta === 0 ? r`；而且 $\theta=0^\circ$，相關達到最大值 $A^2|H|/2$（對得最準）` : ''}。`
            : M === 0
              ? r`$\theta=\pm90^\circ$：$\cos\theta=0$，$C_D=0$——GMAC 完全沒有平均恢復力，$w$ 只會隨雜訊漂移。`
              : r`$M_{\mathrm{pol}}<0$（$|\theta|>90^\circ$）$\Rightarrow C_D<0$：LMS 反向更新，減小 $\mu$ 也救不回來，要換 $D$。`,
          r`對照（F-07.3）：同樣的 $D$ 若放在 comparator 那一側，$\theta'=\mathrm{wrap}_{180}(\phi-\Omega D)=${degT(aE.theta)}$、$M'_{\mathrm{pol}}=${degT(ME)}$${(ME > 0) === (M > 0) ? '' : '——極性剛好相反'}。延遲放哪一側，$\Omega D$ 的正負號就不同。`,
        ],
      }
    },
    tips: [
      r`全部只有乘、加、減：先算 $\Omega D$，加上 $\phi$，折回 $(-180^\circ,180^\circ]$，最後用 $90^\circ$ 去減絕對值。`,
      r`折返的訣竅：把 $\phi+\Omega D$ 除以 $360^\circ$ 看大約是幾圈，減掉那麼多個 $360^\circ$；如果剩下的還大於 $180^\circ$，再減一個 $360^\circ$。`,
      r`範例數字（$\phi=-120^\circ$、$\Omega=30^\circ$、$D=4$）的答案是 $\theta=0^\circ$、$M_{\mathrm{pol}}=90^\circ$（測試 T07）；把 $D$ 改成 1 或 7 會得到 $\theta=\mp90^\circ$。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.2',
    title: r`單頻相關 $C_D$：延遲之後 GMAC 算出來的相關是多少？`,
    page: '/ch/07',
    formulaId: 'F-07.2',
    formulaTex: r`C_D=E\big[x[n-D]\,u[n]\big]=\frac{A^2}{2}\,|H|\cos(\phi+\Omega D),\qquad C'_D=E\big[x[n]\,u[n-D]\big]=\frac{A^2}{2}\,|H|\cos(\phi-\Omega D)`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'A', symbol: 'A', label: r`code 的振幅：$x[n]=A\cos(\Omega n)$`, default: 1, min: 0.001, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'mag', symbol: '|H|', label: '誤差路徑在 code 頻率的增益', default: 1, min: 0, max: 100, practice: { choices: [0.25, 0.5, 1, 2] } },
      { key: 'phi', symbol: r`\phi`, label: '誤差路徑在 code 頻率的相位', unit: r`\mathrm{deg}`, default: -120, min: -180, max: 180, practice: { choices: [-150, -120, -90, -60, -45, 45, 120] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [15, 30, 45, 60, 90] } },
      { key: 'D', symbol: 'D', label: '延遲', unit: r`\text{samples}`, default: 4, min: 0, max: 5000, integer: true, practice: { min: 0, max: 8, step: 1 } },
    ],
    validate: ({ omega }) => omegaDegError(omega),
    solve: ({ A, mag, phi, omega, D }) => {
      const tone = { A, mag, phiRad: phi * RAD, omega: omega * RAD }
      // E[x²] = A²/2：x 與自己的相關（模型的 toneCorrAtTheta，|H| = 1、θ = 0）
      const P = chain(r`\frac{A^2}{2}`, div(sq(given(A)), given(2)), { target: toneCorrAtTheta({ A, mag: 1, phiRad: 0, omega: tone.omega }, 0) })
      const a = residual(phi, omega, D)
      const aE = residual(phi, omega, D, 'error')
      const cosT = chain(r`\cos\theta`, cosd(deg(a.theta)))
      const cosE = chain(r`\cos\theta'`, cosd(deg(aE.theta)))
      const C = chain(r`C_D = \frac{A^2}{2}\,|H|\cos\theta`, mul(P.leaf, given(mag), cosT.leaf), { target: toneCorrCodeDelay(tone, D) })
      const CE = chain(r`C'_D = \frac{A^2}{2}\,|H|\cos\theta'`, mul(P.leaf, given(mag), cosE.leaf), { target: toneCorrErrorDelay(tone, D) })
      const C0 = chain('', mul(P.leaf, given(mag), calc(cosDeg(phi))), { target: toneCorrCodeDelay(tone, 0) }).value
      const Cmax = chain('', mul(P.leaf, given(mag))).shown
      return {
        steps: [
          step(P, r`單頻 code 的功率 $E[x^2]=A^2/2$（$\cos^2$ 在一個週期的平均是 $\tfrac12$）：先平方、再除以 2。`),
          step(a.omD, r`延遲 $D$ 個 sample 讓 code 的相位落後 $\Omega D$。`),
          {
            tex: thetaTex(r`\theta`, r`\phi+\Omega D`, a),
            why: r`殘餘相位：延遲的是 code，所以是加 $\Omega D$。${a.wrap.wrapped ? WHY_WRAP : ''}`,
          },
          step(cosT, r`計算機切到 DEG 模式按 $\cos$（特殊角見手算提示）。正負號就是更新的極性。`),
          step(C, r`三個數相乘。最大只能到 $A^2|H|/2=${texNum(Cmax, 12)}$（$\theta=0^\circ$ 時）。`),
          {
            tex: thetaTex(r`\theta'`, r`\phi-\Omega D`, aE),
            why: r`對照：把同樣的延遲放在 comparator 輸出那一側（延遲 error），就變成減 $\Omega D$。${aE.wrap.wrapped ? WHY_WRAP : ''}`,
          },
          step(cosE, r`同樣按 $\cos$：角度不同，結果通常也不同。`),
          step(CE, r`F-07.3：延遲放錯邊，得到的是另一個數（常常連符號都不同）。`),
        ],
        results: [
          { symbol: r`\theta`, label: '殘餘相位（延遲 code）', value: a.theta, unit: r`\mathrm{deg}`, digits: 8, tolerance: { abs: 0.05, rel: 0.005 } },
          { symbol: 'C_D', label: '延遲 code 的相關', value: C.value, tolerance: { abs: 0.002, rel: 0.01 } },
          { symbol: "C'_D", label: '延遲 comparator 誤差的相關', value: CE.value, tolerance: { abs: 0.002, rel: 0.01 } },
        ],
        notes: [
          C.value > 0
            ? r`$C_D=${num(C.value)}>0$：GMAC 的平均輸出與 $a-w$ 同號，LMS 往正確方向更新。`
            : C.value < 0
              ? r`$C_D=${num(C.value)}<0$：GMAC 的平均輸出與 $a-w$ 反號，LMS 反向更新（$p_D=1-\mu K_qC_D>1$）。`
              : r`$C_D=0$：沒有平均恢復力（$p_D=1$）。`,
          r`不延遲（$D=0$）時 $C_0=\tfrac{A^2}{2}|H|\cos\phi=${num(C0)}$；平均 pole 是 $p_D=1-\mu K_qC_D$（綜合題 HC-07.8 會把它算出來）。`,
        ],
      }
    },
    tips: [
      TIP_COS,
      r`範例數字（$A=|H|=1$、$\phi=-120^\circ$、$\Omega=30^\circ$、$D=4$）：$\theta=0^\circ$、$C_4=0.5$（測試 T07 的 golden vector）；$D=0$ 時 $C_0=-0.25$；延遲放錯邊的 $C'_4=-0.25$。`,
      r`Lab 把 code 正規化成 unit power（$A=\sqrt2$，$A^2/2=1$）：同一個例子在 Lab 顯示成 $+1$ 與 $-0.5$，剛好 2 倍。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.3',
    title: r`最佳延遲 $D^\star$：要放幾級 shift register？對準之後能容忍多少頻偏？`,
    page: '/ch/07',
    formulaId: 'F-07.4',
    formulaTex: r`D^\star=\frac{(-\phi)\bmod 360^\circ}{\Omega},\qquad D=\mathrm{round}(D^\star),\qquad\theta=\mathrm{wrap}_{180}(\phi+\Omega D),\qquad|\Omega'-\Omega|<\frac{\pi}{2D}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'phi', symbol: r`\phi`, label: '誤差路徑在 code 頻率的相位（正 = 超前）', unit: r`\mathrm{deg}`, default: T2_PHI1_DEG, min: -180, max: 180, practice: { choices: [-150, -120, -90, -60, -45, 120, 150] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率', unit: r`\mathrm{rad/sample}`, default: 0.03, min: 0, max: 3.1416, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.5, 1] } },
    ],
    validate: ({ omega }) => omegaRadError(omega),
    solve: ({ phi, omega }) => {
      const phiRad = phi * RAD
      // 連續解 D* 與「第一個週期內 cos 最大的整數」都由 bestToneDelay 計算；手算採 F-07.4 的規則「取最接近 D* 的整數」
      const best = bestToneDelay(phiRad, omega, Infinity)
      const dStar = tidy(best.continuous)
      const D = roundHalfDown(dStar)
      // D* 至少顯示 6 位；剛好在 .5 附近時多顯示幾位，讓「把畫面上的 D* 四捨五入」得到的就是 D
      let kD = 6
      while (kD < 12 && roundHalfDown(roundSig(dStar, kD)) !== D) kD++
      const om = chain(r`\Omega\ [\text{度}] = \Omega\ [\mathrm{rad}]\times\frac{180^\circ}{\pi}`, mul(given(omega), calc(DEG, 'deg')), { round: (v) => roundSig(v, 6), from: 6 })
      const omLeaf = calc(omega * DEG, 'deg')
      const target = phi > 0 ? chain(r`(-\phi)\bmod360^\circ`, add(deg(-phi), deg(360)), ANG) : chain(r`(-\phi)\bmod360^\circ`, deg(-phi), ANG)
      const ds = chain(r`D^\star = \frac{(-\phi)\bmod360^\circ}{\Omega}`, div(deg(target.shown), omLeaf), { target: dStar, round: (v) => roundSig(v, kD), from: 6 })
      // 角度顯示到小數 dA 位（至少 3 位；φ 的小數更多時跟著加），之後的加減都在這個格點上精確計算
      const dA = Math.min(6, Math.max(3, dpOf(phi)))
      const omD = chain(r`\Omega D`, mul(omLeaf, given(D)), { round: (v) => roundDec(v, dA), absTol: 0.6 * 10 ** -dA, from: 6 })
      const sum = chain('', add(deg(phi), deg(omD.shown)), ANG)
      const wrap = wrapTex(sum.shown, wrapDeg(sum.shown))
      const theta = tidy(residualPhaseDeg(phiRad, omega, D))
      const steps: HandCalcStep[] = [
        step(om, r`把 rad/sample 換成 度/sample（$180/\pi\approx57.2958$），之後全部用「度」算。`),
        {
          tex: target.tex,
          why:
            phi > 0
              ? r`要補的相位。$\phi>0$（誤差路徑超前）時 $-\phi$ 是負的：延遲只能讓相位「往後」轉，所以加 $360^\circ$——多繞將近一圈才對得上。`
              : r`要補的相位：延遲 $D$ 個 sample 提供 $+\Omega D$，剛好抵消落後的 $\phi$。`,
        },
        step(ds, r`連續解：每延遲 1 個 sample 補 $\Omega$，要補幾個 sample。`),
        {
          tex: r`D = \mathrm{round}(D^\star) = \mathrm{round}(${texNum(ds.shown, 12)}) = ${D}`,
          why: r`shift register 只能是整數級：取最接近 $D^\star$ 的整數（剛好差 0.5 時取較小的，硬體較省）。`,
        },
        step(omD, r`整數 $D$ 實際補到的相位。`),
        {
          tex: thetaTex(r`\theta`, r`\phi+\Omega D`, { sum, wrap }),
          why: r`整數 $D$ 留下的殘餘相位（一定有 $|\theta|\le\Omega/2$）。${wrap.wrapped ? WHY_WRAP : ''}`,
        },
      ]
      const results: HandCalcResult[] = [
        { symbol: r`D^\star`, label: '連續解', value: dStar, unit: r`\text{samples}`, digits: 6 },
        { symbol: 'D', label: '整數延遲（shift register 級數）', value: D, unit: r`\text{samples}`, digits: 8, tolerance: { abs: 0.01, rel: 0 } },
        { symbol: r`\theta`, label: '殘餘相位', value: theta, unit: r`\mathrm{deg}`, digits: 3, tolerance: { abs: 0.05, rel: 0.02 } },
      ]
      const notes: string[] = []
      if (D >= 1) {
        const tol = delayToleranceRad(D)
        const tolStep = chain(r`\Delta\Omega_{\max} = \frac{\pi}{2D}`, div(calc(Math.PI), mul(given(2), given(D))), { target: tol, suffix: r`\ \mathrm{rad/sample}` })
        steps.push(
          step(tolStep, r`對準之後換到別的頻率 $\Omega'$（把 $\phi$ 在附近當成常數）：$\theta=(\Omega'-\Omega)D$，$|\theta|<90^\circ$ 才是正的。$D$ 越大，容許的頻偏越窄。先算分母 $2D$，再除。`),
        )
        results.push({ symbol: r`\Delta\Omega_{\max}`, label: '容許的頻偏', value: tol, unit: r`\mathrm{rad/sample}` })
        // 下限小於 Ω 的千分之一（或為負）時寫成 0；上限不超過 π
        const lo = omega - tol > 1e-3 * omega ? num(omega - tol, 4) : '0'
        const hi = omega + tol < Math.PI ? num(omega + tol, 4) : r`\pi`
        notes.push(r`$C_D>0$ 的頻率範圍約為 $${lo}<\Omega'<${hi}$ rad/sample；code 裡若有落在這個範圍外的 tone，它會對 $C_D$ 投負票（下一題 HC-07.4）。`)
        notes.push(r`硬體成本：${D} 級的 code FIFO（每級 $B$ 個 flip-flop，$B$ = code 位元數）加一個 tap MUX。`)
      } else {
        notes.push(r`$D=0$：不需要延遲，raw-x 就是最接近的整數選擇（$\theta=\phi=${degT(roundDec(theta, 6))}$）。`)
      }
      if (best.D !== D) {
        // 相位以 360° 為週期：第一個週期 D = 0…⌈2π/Ω⌉ 內可能有別的整數（多繞或少繞一圈）殘餘相位一樣小或更小
        const thB = tidy(best.thetaDeg)
        const ang = (v: number): string => degT(roundDec(v, 3))
        notes.push(
          Math.abs(Math.abs(thB) - Math.abs(theta)) < 1e-9
            ? r`相位以 $360^\circ$ 為週期：$D=${best.D}$ 的殘餘相位也是 $${ang(thB)}$（和 $D=${D}$ 只差整數圈），而且 register 更少——Lab 顯示的「整數最佳 $D$」就是它。`
            : r`相位以 $360^\circ$ 為週期，所以「最接近 $D^\star$」不一定是整個第一週期（$D=0\ldots${Math.ceil((2 * Math.PI) / omega)}$）裡最好的：這組數字 $D=${best.D}$ 的殘餘相位 $${ang(thB)}$ 更小（Lab 顯示的「整數最佳 $D$」）。${best.D === 0 ? r`$\phi$ 是很小的正角度時，不延遲反而最準。` : r`$\Omega$ 越大、整數格點越粗，越容易發生；代價是更多級 register。`}`,
        )
      }
      return { steps, results, notes }
    },
    tips: [
      r`預設數字是 7.3 節的 Type-II 例子（$\omega_nT_s=0.1$、$\zeta=0.7$、$d=0$，code tone 在 $\Omega=0.03$ rad/sample）：$\angle H_{\mathrm{PD}}=${texNum(T2_PHI1_DEG, 9)}^\circ\Rightarrow D^\star\approx119.04\Rightarrow D=${T2_D1}$。`,
      r`T07 的例子：$\phi=-120^\circ$、$\Omega=\pi/6\approx0.5236$ rad/sample（$=30^\circ$）時 $D^\star=120^\circ/30^\circ=4$。思考題 1：$\phi=-90^\circ$、$\Omega=45^\circ=0.7854$ rad 時 $D=2$。`,
      r`只用到乘、除、加和四捨五入。$\pi$ 用 $3.1416$；${TIP_RAD}`,
      r`殘餘相位是兩個大角度相加再減 $360^\circ$，$\Omega$ 換成度之後至少留 6 位有效數字（步驟裡的 $\Omega D$ 取到小數 3 位）。答案框裡的 $\theta$ 是完整精度的值，和照步驟算的結果差在小數第 3 位以內。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.4',
    title: r`兩個 tone 共用一個 $D$：對準 tone 1 之後，總相關還是正的嗎？`,
    page: '/ch/07',
    formulaId: 'F-07.7',
    formulaTex: r`C_D=\sum_{i=1}^{2}\frac{A_i^2}{2}\,|H_i|\cos\big(\phi_i+\Omega_iD\big),\qquad H_i\equiv H(e^{j\Omega_i})=|H_i|e^{j\phi_i},\qquad A_1=A_2=1`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'mag1', symbol: '|H_1|', label: r`誤差路徑在 $\Omega_1$ 的增益`, default: roundDec(cAbs(T2_H1), 4), min: 0, max: 100, practice: { choices: [0.1, 0.2, 0.5, 1] } },
      { key: 'phi1', symbol: r`\phi_1`, label: r`誤差路徑在 $\Omega_1$ 的相位`, unit: r`\mathrm{deg}`, default: roundDec(cArg(T2_H1) * DEG, 2), min: -180, max: 180, practice: { choices: [-150, -120, -90, 120, 150] } },
      { key: 'om1', symbol: r`\Omega_1`, label: 'tone 1 的頻率', unit: r`\mathrm{rad/sample}`, default: 0.03, min: 0, max: 3.1416, practice: { choices: [0.1, 0.2] } },
      { key: 'mag2', symbol: '|H_2|', label: r`誤差路徑在 $\Omega_2$ 的增益`, default: roundDec(cAbs(T2_H2), 4), min: 0, max: 100, practice: { choices: [0.2, 0.5, 1] } },
      { key: 'phi2', symbol: r`\phi_2`, label: r`誤差路徑在 $\Omega_2$ 的相位`, unit: r`\mathrm{deg}`, default: roundDec(cArg(T2_H2) * DEG, 2), min: -180, max: 180, practice: { choices: [-120, -90, -60, 90, 135] } },
      { key: 'om2', symbol: r`\Omega_2`, label: 'tone 2 的頻率', unit: r`\mathrm{rad/sample}`, default: 0.05, min: 0, max: 3.1416, practice: { choices: [0.25, 0.3, 0.5] } },
      { key: 'D', symbol: 'D', label: '兩個 tone 共用的 code 延遲', unit: r`\text{samples}`, default: T2_D1, min: 0, max: 5000, integer: true, practice: { choices: [0, 2, 4, 5, 8, 10, 20] } },
    ],
    validate: ({ om1, om2 }) =>
      omegaRadError(om1) ??
      omegaRadError(om2) ??
      (Math.abs(om1 - om2) < 1e-9
        ? r`兩個 tone 的頻率必須不同：$\Omega_1=\Omega_2$ 時交叉項 $\cos((\Omega_1-\Omega_2)n+\cdots)$ 不會平均成 0，要先把兩個弦波合成一個再用單頻公式。`
        : null),
    solve: ({ mag1, phi1, om1, mag2, phi2, om2, D }) => {
      const half = toneCorrAtTheta({ A: 1, mag: 1, phiRad: 0, omega: om1 }, 0) // A²/2，A = 1
      const tones = [
        { i: 1, mag: mag1, phi: phi1, om: om1 },
        { i: 2, mag: mag2, phi: phi2, om: om2 },
      ].map((t) => {
        const tone = { A: 1, mag: t.mag, phiRad: t.phi * RAD, omega: t.om }
        const cosTrue = Math.cos(tone.phiRad + tone.omega * D)
        const turnDeg = t.om * D * DEG
        // 角度顯示到小數 dA 位：照畫面上的 θ 按 cos，要得到畫面上的 cos θ
        const dA = angleDecimals(t.phi, turnDeg, cosTrue)
        const rad = chain(r`\Omega_${t.i}D`, mul(given(t.om), given(D)), { suffix: r`\ \mathrm{rad}` })
        const turn = chain(r`\Omega_${t.i}D\ [\text{度}] = \Omega_${t.i}D\ [\mathrm{rad}]\times\frac{180^\circ}{\pi}`, mul(rad.leaf, calc(DEG, 'deg')), {
          target: turnDeg,
          round: (v) => roundDec(v, dA),
          absTol: 0.6 * 10 ** -dA,
          from: 6,
        })
        const sum = chain('', add(deg(t.phi), deg(turn.shown)), ANG)
        const thetaShown = wrapDeg(sum.shown)
        const wrap = wrapTex(sum.shown, thetaShown)
        const cos = chain(r`\cos\theta_${t.i}`, cosd(deg(thetaShown)), { target: cosTrue })
        const part = chain(r`\frac{A_${t.i}^2}{2}\,|H_${t.i}|\cos\theta_${t.i}`, mul(given(half), given(t.mag), cos.leaf), { target: toneCorrCodeDelay(tone, D) })
        return { ...t, rad, turn, sum, wrap, cos, part }
      })
      const total = chain(r`C_D`, add(tones[0].part.leaf, tones[1].part.leaf), { target: tones[0].part.value + tones[1].part.value })
      // 對照：filtered-x（Ĥ = H）的相關 E[u²] = Σ (A_i|H_i|)²/2 —— u 的每個 tone 與自己的相關
      const eu2 = tones.reduce((s, t) => s + toneCorrAtTheta({ A: t.mag, mag: 1, phiRad: 0, omega: t.om }, 0), 0)
      const steps: HandCalcStep[] = tones.flatMap((t) => [
        step(t.rad, r`tone ${t.i} 被延遲 $D$ 個 sample 所轉的相位（弧度）。`),
        step(t.turn, r`換成度，才能和 $\phi_${t.i}$ 相加（$180/\pi\approx57.2958$）。`),
        {
          tex: thetaTex(r`\theta_${t.i}`, r`\phi_${t.i}+\Omega_${t.i}D`, t),
          why: r`tone ${t.i} 的殘餘相位。${t.wrap.wrapped ? WHY_WRAP : ''}`,
        },
        step(t.cos, r`DEG 模式按 $\cos$；負的就是這個 tone 投「反對票」。`),
        step(t.part, r`tone ${t.i} 對 $C_D$ 的貢獻（$A_${t.i}=1$，所以 $A_${t.i}^2/2=0.5$）。增益 $|H_${t.i}|$ 越大，它的票越重。`),
      ])
      steps.push(step(total, r`不同頻率的交叉項平均為 0，所以直接把兩個 tone 的貢獻相加。`))
      const [p1, p2] = [tones[0].part.value, tones[1].part.value]
      return {
        steps,
        results: [
          { symbol: r`\tfrac{A_1^2}{2}|H_1|\cos\theta_1`, label: 'tone 1 的貢獻', value: tidy(p1), tolerance: { abs: 5e-4, rel: 0.02 } },
          { symbol: r`\tfrac{A_2^2}{2}|H_2|\cos\theta_2`, label: 'tone 2 的貢獻', value: tidy(p2), tolerance: { abs: 5e-4, rel: 0.02 } },
          { symbol: 'C_D', label: '總相關', value: tidy(total.value), tolerance: { abs: 5e-4, rel: 0.02 } },
        ],
        notes: [
          total.value > 0
            ? r`$C_D=${num(total.value)}>0$：這個 $D$ 讓加權後的總票數為正，極性正確。`
            : total.value < 0
              ? r`$C_D=${num(total.value)}<0$：${(p1 > 0) !== (p2 > 0) ? '一個 tone 對齊了，另一個的反對票卻更重——' : ''}LMS 反向更新。一個 $D$ 只是一條線性相位 $\Omega D$，不能同時對準兩個頻率。`
              : r`$C_D=0$：兩個 tone 的票剛好抵消，沒有恢復力。`,
          r`對照 filtered-x（$\hat H=H$、regressor 不再另外延遲）：$E[u^2]=\sum_i\tfrac{A_i^2}{2}|H_i|^2=${num(eu2)}${eu2 > 0 ? '>0' : ''}$，不管 code 有幾個頻率都不會是負的，也不需要選 $D$。`,
        ],
      }
    },
    tips: [
      r`預設數字是 7.3 節多頻例子的那張表（Type-II 迴路，$\Omega_1=0.03$、$\Omega_2=0.05$，$D=${T2_D1}$ 對準 tone 1）；表中的值用完整精度的 $|H_i|$、$\phi_i$，手算（四位小數的輸入）會在第 4 位有效數字附近有出入。`,
      r`$\Omega D$ 是弧度，$\phi$ 是度：先乘 $57.2958$ 換成度再相加（或把計算機切到 RAD 模式，改把 $\phi$ 乘 $\pi/180$）。${TIP_RAD}`,
      TIP_COS,
      r`最後一步是一正一負相加：兩個貢獻很接近時，請把它們多留幾位再相加（步驟會自動多寫幾位）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.5',
    title: r`正規化相關 $\rho$：這個 regressor 的效率是 filtered-x 的幾成？`,
    page: '/ch/07',
    formulaId: 'F-07.13',
    formulaTex: r`\begin{aligned}&\rho_{\mathrm{ref}}=\frac{E[x_{\mathrm{ref}}\,u]}{\sqrt{E[x_{\mathrm{ref}}^2]\,E[u^2]}},\qquad E[x_{\mathrm{ref}}\,u]=C_D,\quad E[x_{\mathrm{ref}}^2]=\frac{A^2}{2},\quad E[u^2]=\frac{A^2}{2}|H|^2;\\[1ex]&\sigma_w\propto\frac{1}{\sqrt N\,|\rho|}\Rightarrow N\propto\frac1{\rho^2}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'A', symbol: 'A', label: r`code 的振幅：$x[n]=A\cos(\Omega n)$`, default: 1, min: 0.001, max: 100, practice: { choices: [1, 2] } },
      { key: 'mag', symbol: '|H|', label: '誤差路徑在 code 頻率的增益', default: 1, min: 0.001, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'phi', symbol: r`\phi`, label: '誤差路徑在 code 頻率的相位', unit: r`\mathrm{deg}`, default: -120, min: -180, max: 180, practice: { choices: [-150, -120, -90, -60] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [15, 30, 45] } },
      { key: 'D', symbol: 'D', label: 'delayed-x 的延遲', unit: r`\text{samples}`, default: 2, min: 0, max: 5000, integer: true, practice: { min: 0, max: 6, step: 1 } },
    ],
    validate: ({ A, mag, phi, omega, D }) => {
      const bad = omegaDegError(omega)
      if (bad) return bad
      const tone = { A, mag, phiRad: phi * RAD, omega: omega * RAD }
      const rho = normalizedCorr(toneCorrCodeDelay(tone, D), toneCorrAtTheta({ A, mag: 1, phiRad: 0, omega: tone.omega }, 0), toneCorrAtTheta({ A: A * mag, mag: 1, phiRad: 0, omega: tone.omega }, 0))
      return Math.abs(rho) < 1e-9
        ? r`這組數字的 $\theta=\pm90^\circ$：$C_D=0$、$\rho=0$，GMAC 沒有恢復力——$N$ 放大幾倍都沒有用（$1/\rho^2$ 是無限大）。請換一個 $D$。`
        : null
    },
    solve: ({ A, mag, phi, omega, D }) => {
      const tone = { A, mag, phiRad: phi * RAD, omega: omega * RAD }
      const a = residual(phi, omega, D)
      const cosT = chain(r`\cos\theta`, cosd(deg(a.theta)))
      // x 與自己的相關 = A²/2；u 的振幅是 A|H| ⇒ E[u²] = (A|H|)²/2（都用模型的 toneCorrAtTheta）
      const Ex2 = chain(r`E[x_{\mathrm{ref}}^2] = \frac{A^2}{2}`, div(sq(given(A)), given(2)), { target: toneCorrAtTheta({ A, mag: 1, phiRad: 0, omega: tone.omega }, 0) })
      const C = chain(r`C_D = \frac{A^2}{2}\,|H|\cos\theta`, mul(Ex2.leaf, given(mag), cosT.leaf), { target: toneCorrCodeDelay(tone, D) })
      const Eu2 = chain(r`E[u^2] = \frac{A^2}{2}\,|H|^2`, mul(Ex2.leaf, sq(given(mag))), { target: toneCorrAtTheta({ A: A * mag, mag: 1, phiRad: 0, omega: tone.omega }, 0) })
      const prod = chain(r`E[x_{\mathrm{ref}}^2]\,E[u^2]`, mul(Ex2.leaf, Eu2.leaf))
      const den = chain(r`\sqrt{E[x_{\mathrm{ref}}^2]\,E[u^2]}`, sqrt(prod.leaf))
      const rho = chain(r`\rho_{\mathrm{ref}} = \frac{C_D}{\sqrt{E[x_{\mathrm{ref}}^2]\,E[u^2]}}`, div(C.leaf, den.leaf), { target: normalizedCorr(C.value, Ex2.value, Eu2.value) })
      const steps: HandCalcStep[] = [
        step(a.omD, r`延遲 $D$ 個 sample 轉的相位。`),
        { tex: thetaTex(r`\theta`, r`\phi+\Omega D`, a), why: r`殘餘相位（HC-07.1 的算法）。${a.wrap.wrapped ? WHY_WRAP : ''}` },
        step(cosT, r`DEG 模式按 $\cos$。`),
        step(Ex2, r`regressor $x_{\mathrm{ref}}=x[n-D]$ 的功率：延遲不改變功率。先平方、再除以 2。`),
        step(C, r`分子：regressor 與 $u$ 的相關（F-07.2）。`),
        step(Eu2, r`$u$ 是振幅 $A|H|$ 的弦波。這也是 $\hat H=H$、$D=0$ 的 filtered-x 得到的相關——它永遠 $\ge0$。`),
        step(prod, r`分母根號裡面的量：regressor 的功率乘上 $u$ 的功率。`),
        step(den, r`按計算機的 $\sqrt{x}$ 鍵。這是 Cauchy–Schwarz 的上限：$|C_D|$ 不可能比它大。`),
        step(rho, r`每單位 regressor 功率的恢復力；$A$ 和 $|H|$ 全部約掉，只剩 $\cos\theta$。`),
      ]
      const results: HandCalcResult[] = [
        { symbol: 'C_D', label: 'delayed-x 的相關', value: tidy(C.value), tolerance: { abs: 0.002, rel: 0.01 } },
        { symbol: 'E[u^2]', label: r`filtered-x（$\hat H=H$、$D=0$）的相關`, value: tidy(Eu2.value) },
        { symbol: r`\rho_{\mathrm{ref}}`, label: '正規化相關', value: tidy(rho.value), tolerance: { abs: 0.002, rel: 0.01 } },
      ]
      const notes = [r`單頻 delayed-x 的 $\rho=\cos\theta$：和 $A$、$|H|$ 無關。filtered-x（$\hat H=H$、$D=0$）的 $\rho$ 恆為 1。$\rho$ 本身是精確的；最後一步「$N$ 的倍數」來自 $\sigma_w$ 的小訊號近似（7.4 節）。`]
      if (rho.value > 0) {
        const pen = chain(r`\frac{N}{N_{\rho=1}} = \frac{1}{\rho^2}`, div(given(1), sq(rho.leaf)), { target: averagingPenalty(rho.value) })
        steps.push(step(pen, r`同樣的收斂速度 $g$ 下 $\sigma_w\propto1/(\sqrt N|\rho|)$：要和 filtered-x 一樣準，$N$（校正時間）要放大 $1/\rho^2$ 倍。先平方、再取倒數。［近似］`))
        results.push({ symbol: r`N/N_{\rho=1}`, label: r`要多平均幾倍`, value: tidy(pen.value), tolerance: { abs: 0.01, rel: 0.02 } })
        notes.push(r`$\rho=${num(rho.value)}$：要 $${num(pen.value, 4)}$ 倍的 $N$ 才有 filtered-x 的穩態抖動。`)
      } else {
        notes.push(r`$\rho=${num(rho.value)}<0$：極性錯誤，LMS 反向更新——這時談「多平均幾倍」沒有意義，要先把 $D$ 修對。`)
      }
      return { steps, results, notes }
    },
    tips: [
      TIP_COS,
      r`範例數字（$\phi=-120^\circ$、$\Omega=30^\circ$、$D=2$）：$\theta=-60^\circ$、$C_2=0.25$（7.1 節掃描表的 $D=2$ 那一列）、$\rho=0.5$，所以 $N$ 要 4 倍（思考題 4）。把 $|H|$ 改成 0.5，$C_D$ 和 $E[u^2]$ 都變了，$\rho$ 不變。`,
      r`整數 $D$ 最好能做到 $|\theta|\le\Omega/2$，所以最佳 delayed-x 的 $\rho\ge\cos(\Omega/2)$（$\Omega=30^\circ$ 時 $\cos15^\circ=0.966$）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.6',
    title: r`模型 $\hat H$ 多算了 $\Delta$ 個 sample：filtered-x 的極性還對嗎？`,
    page: '/ch/07',
    formulaId: 'F-07.12',
    formulaTex: r`\begin{aligned}&E[u\,u_f]=\frac{A^2}{2}\,|H|\,|\hat H|\cos\!\big(\angle H-\angle\hat H\big),\qquad\hat H=r\,H\,z^{-\Delta}\Rightarrow\angle H-\angle\hat H=\Omega\Delta;\\[1ex]&p_f=1-\mu K_q\,E[u\,u_f],\quad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mag', symbol: '|H|', label: '真實誤差路徑在 code 頻率的增益', default: 1, min: 0.001, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'ratio', symbol: r`r=|\hat H|/|H|`, label: '模型的增益誤差（1 = 沒有誤差）', default: 1, min: 0, max: 100, practice: { choices: [0.5, 0.8, 1, 1.25, 2] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [15, 30, 45, 60] } },
      { key: 'Delta', symbol: r`\Delta`, label: r`$\hat H$ 多算的 latency`, unit: r`\text{samples}`, default: 4, min: 0, max: 64, integer: true, practice: { min: 0, max: 6, step: 1 } },
      { key: 'mu', symbol: r`\mu`, label: 'learning rate（gain_step）', unit: r`\mathrm{fs}`, default: 10, min: 0, max: 1e6, practice: { choices: [5, 10, 20] } },
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前的雜訊', unit: r`\mathrm{fs}`, default: 100, min: 0, max: 1e6, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ ratio, omega, sigmaV }) =>
      omegaDegError(omega) ??
      (ratio > 0 ? null : r`$r=|\hat H|/|H|$ 必須大於 0：$r\le0$ 等於把 $\hat H$ 反相，極性一定錯（那是 $180^\circ$ 的相位誤差，不是增益誤差）。`) ??
      (sigmaV > 0 ? null : SIGMA_ERR),
    solve: ({ mag, ratio, omega, Delta, mu, sigmaV }) => {
      const om = omega * RAD
      // T07 的單頻路徑（φ = −120°；E[u·u_f] 與 φ 無關）與 unit-power 單頻 code：和 7.5 節失效例子的表格用同一組函式
      const path: FxPathSpec = { kind: 'single_tone', magnitude: mag, phaseDeg: -120, omega: om }
      const code: FxCodeSpec = { kind: 'sinusoid', omega: om }
      const H = pathTransfer(path)
      const hat = buildHat(path, { ...HAT_EXACT, extraDelay: Delta, gainErrPct: (ratio - 1) * 100 }, code)
      const err = chain(r`\angle H-\angle\hat H = \Omega\Delta`, mul(deg(omega), given(Delta)), ANG)
      const cosE = chain(r`\cos(\Omega\Delta)`, cosd(deg(err.shown)))
      const magHat = chain(r`|\hat H| = r\,|H|`, mul(given(ratio), given(mag)), { target: cAbs(freqz(hat.full.b, hat.full.a, [om])[0]) })
      const Euf = chain(r`E[u\,u_f] = \frac{A^2}{2}\,|H|\,|\hat H|\cos(\Omega\Delta)`, mul(given(1), given(mag), magHat.leaf, cosE.leaf), {
        target: analyticCorr({ code, h: H, g: hat.full, D: 0 }) as number,
      })
      const Eu2 = chain(r`E[u^2] = \frac{A^2}{2}\,|H|^2`, mul(given(1), sq(given(mag))), { target: analyticCorr({ code, h: H, g: H, D: 0 }) as number })
      const pf = calPole(mu, sigmaV, Euf.value)
      const pw = calPole(mu, sigmaV, Eu2.value)
      const Kq = chain(r`K_q = \frac{\sqrt{2/\pi}}{\sigma_v}`, div(calc(kqFromSigma(1)), given(sigmaV)), { target: pf.Kq, suffix: r`\ \mathrm{fs^{-1}}` })
      const muKq = chain(r`\mu K_q`, mul(given(mu), Kq.leaf))
      const pF = poleStep(r`p_f = 1-\mu K_q\,E[u\,u_f]`, muKq, Euf, pf.p)
      const pW = poleStep(r`p_{E[u^2]} = 1-\mu K_q\,E[u^2]`, muKq, Eu2, pw.p)
      const pfv = tidy(pF.value)
      const pwv = tidy(pW.value)
      return {
        steps: [
          step(err, r`$\hat H=rHz^{-\Delta}$：$z^{-\Delta}$ 的相位是 $-\Omega\Delta$，所以模型比真實路徑多落後 $\Omega\Delta$（和 $\phi$ 是多少無關）。`),
          step(cosE, r`DEG 模式按 $\cos$。相位誤差（折回 $\pm180^\circ$ 以內之後）超過 $90^\circ$ 就變負。`),
          step(magHat, r`模型的增益。`),
          step(Euf, r`F-07.12 的單頻版本（regressor 沒有額外延遲，$D=0$）；code 是 unit power（$A=\sqrt2$，$A^2/2=1$，和 Lab 相同），所以第一個因子是 1。`),
          step(Eu2, r`模型完美（$\hat H=H$）時的相關。有模型誤差時「不可以」拿它來算 pole（勘誤 E45）。`),
          step(Kq, r`1-bit comparator 的小訊號增益（Ch05）；$\sqrt{2/\pi}\approx0.79788$。`),
          step(muKq, r`先把兩個常數乘起來，下面兩個 pole 都會用到。`),
          step(pF, r`正確的平均 pole：用 $E[u\,u_f]$。先乘出 loop gain $g=\mu K_qE[u\,u_f]$，再用 1 去減。`),
          step(pW, r`錯的算法：誤用 $E[u^2]$——它和 $\Delta$ 完全無關。`),
        ],
        results: [
          { symbol: r`E[u\,u_f]`, label: '有效相關', value: tidy(Euf.value), tolerance: { abs: 0.002, rel: 0.01 } },
          { symbol: 'p_f', label: '正確的平均 pole', value: pfv, digits: 6, tolerance: poleTol(1 - pfv) },
          { symbol: r`p_{E[u^2]}`, label: r`誤用 $E[u^2]$ 算出的 pole（錯的）`, value: pwv, digits: 6, tolerance: poleTol(1 - pwv) },
        ],
        notes: [
          poleVerdict(r`正確的 pole`, pfv),
          Euf.value < 0
            ? Math.abs(pwv) < 1
              ? r`相位誤差 $${degT(err.shown)}$ 折回後超過 $90^\circ$：filtered-x 一樣反向更新，而誤用 $E[u^2]$ 的 pole $${pole(pwv)}$ 仍然顯示「收斂」——這正是 E45 要避免的錯誤。`
              : r`相位誤差 $${degT(err.shown)}$ 折回後超過 $90^\circ$：filtered-x 一樣反向更新（$E[u\,u_f]<0$）。誤用 $E[u^2]$ 的 pole $${pole(pwv)}$ 完全看不出這個符號翻轉（E45）。`
            : r`增益比 $r$ 只會把 $E[u\,u_f]$ 放大或縮小（改變收斂速度），不會改變它的符號；會讓極性翻轉的只有相位誤差。`,
        ],
      }
    },
    tips: [
      TIP_COS,
      TIP_KQ,
      TIP_POLE,
      TIP_TAU,
      r`範例數字（$|H|=1$、$\Omega=30^\circ$、$\Delta=4$、$\mu=10$ fs、$\sigma_v=100$ fs）就是 7.5 節失效例子表格的 $\Delta=4$ 那一列：$E[u\,u_f]=-0.5$、$p_f=1.03989$、誤用 $E[u^2]$ 得 $0.92021$。把 $\Delta$ 改成 3 得到 $E[u\,u_f]=0$（思考題 2）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.7',
    title: r`二次差分 regressor 遇到中頻 tone：用複數算出 $E[u\,u_f]$ 的符號`,
    page: '/ch/07',
    formulaId: 'F-07.14',
    formulaTex: r`\begin{aligned}&H_{\mathrm{PD}}=\frac{\nabla^2}{\nabla^2+(K_i+K_p\nabla)\,z^{-(1+d)}},\qquad\hat H_2=K_2\nabla^2,\qquad\nabla=1-e^{-j\Omega},\ z^{-1}=e^{-j\Omega};\\[1ex]&E[u\,u_f]=\mathrm{Re}\big\{H_{\mathrm{PD}}\,\overline{\hat H_2}\big\}\quad(A^2/2=1)\end{aligned}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'wnTs', symbol: r`\omega_nT_s`, label: 'Type-II DPLL 的正規化自然頻率', unit: r`\mathrm{rad/sample}`, default: 0.1, min: 0.001, max: 1, practice: { choices: [0.1, 0.2, 0.25] } },
      { key: 'zeta', symbol: r`\zeta`, label: '阻尼', default: 0.7, min: 0.05, max: 5, practice: { choices: [0.5, 0.7, 1] } },
      { key: 'd', symbol: 'd', label: '額外 loop latency', unit: r`\text{samples}`, default: 0, min: 0, max: 8, integer: true, practice: { choices: [0, 1] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code tone 的頻率', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [30, 45, 60, 90] } },
    ],
    validate: ({ wnTs, zeta, d, omega }) => {
      const bad = omegaDegError(omega)
      if (bad) return bad
      const st = pathStability({ kind: 'type2_dt', wnTs, zeta, loopDelay: d })
      return st.stable
        ? null
        : r`這組 $\omega_nT_s$、$\zeta$、$d$ 的主 PLL 迴路不穩定（closed-loop pole 半徑 $${num(st.radius, 4)}\ge1$）：$u=h*x$ 會發散，$H_{\mathrm{PD}}(e^{j\Omega})$ 與 $E[u\,u_f]$ 都沒有定義。請降低 $\omega_nT_s$ 或 $d$。`
    },
    solve: ({ wnTs, zeta, d, omega }) => {
      const om = omega * RAD
      // ── 模型值：K_p、K_i 來自 designDtLoop；H_PD 用它的轉移函數（pathTransfer）+ freqz；K₂ 與 Ĥ₂ 來自 buildHat／secondDiffResponse；
      //    E[u·u_f] 用 analyticCorr（與 Lab、思考題 3 相同的呼叫）──
      const path: FxPathSpec = { kind: 'type2_dt', wnTs, zeta, loopDelay: d }
      const code: FxCodeSpec = { kind: 'sinusoid', omega: om }
      const des = designDtLoop({ wnTs, zeta, loopDelay: d })
      const hat = buildHat(path, { ...HAT_EXACT, base: 'second_diff' }, code)
      const Htf = pathTransfer(path)
      const H = freqz(Htf.b, Htf.a, [om])[0]
      const N2 = secondDiffResponse(om, 1) // ∇² = (1 − e^{−jΩ})²
      const H2 = secondDiffResponse(om, hat.secondDiffScale as number)
      // ── 手算：同一條公式拆成實部／虛部，每一步一個 chain（結果以模型值為準）──
      const Om = deg(omega)
      const Kp = chain(r`K_p = 2\zeta\,\omega_nT_s`, mul(given(2), given(zeta), given(wnTs)), { target: des.Kp })
      const Ki = chain(r`K_i = (\omega_nT_s)^2`, sq(given(wnTs)), { target: des.Ki })
      const K2 = chain(r`K_2 = \frac{1}{K_i}`, div(given(1), Ki.leaf), { target: hat.secondDiffScale as number })
      const nr = chain(r`\mathrm{Re}\,\nabla = 1-\cos\Omega`, sub(given(1), cosd(Om)))
      const ni = chain(r`\mathrm{Im}\,\nabla = \sin\Omega`, sind(Om))
      const n2r = chain(r`\mathrm{Re}\,\nabla^2 = (\mathrm{Re}\,\nabla)^2-(\mathrm{Im}\,\nabla)^2`, sub(sq(nr.leaf), sq(ni.leaf)), { target: N2.re })
      const n2i = chain(r`\mathrm{Im}\,\nabla^2 = 2\,(\mathrm{Re}\,\nabla)(\mathrm{Im}\,\nabla)`, mul(given(2), nr.leaf, ni.leaf), { target: N2.im })
      const qr = chain(r`\mathrm{Re}\,Q = K_i+K_p\,\mathrm{Re}\,\nabla`, add(Ki.leaf, mul(Kp.leaf, nr.leaf)))
      const qi = chain(r`\mathrm{Im}\,Q = K_p\,\mathrm{Im}\,\nabla`, mul(Kp.leaf, ni.leaf))
      const cz = chain(r`c\equiv\cos\big((1+d)\Omega\big)`, cosd(mul(given(1 + d), Om)))
      const sz = chain(r`s\equiv\sin\big((1+d)\Omega\big)`, sind(mul(given(1 + d), Om)))
      const qzr = chain(r`\mathrm{Re}\{Qz^{-(1+d)}\} = \mathrm{Re}\,Q\cdot c+\mathrm{Im}\,Q\cdot s`, add(mul(qr.leaf, cz.leaf), mul(qi.leaf, sz.leaf)))
      const qzi = chain(r`\mathrm{Im}\{Qz^{-(1+d)}\} = \mathrm{Im}\,Q\cdot c-\mathrm{Re}\,Q\cdot s`, sub(mul(qi.leaf, cz.leaf), mul(qr.leaf, sz.leaf)))
      const dr = chain(r`\mathrm{Re}\,\mathcal D = \mathrm{Re}\,\nabla^2+\mathrm{Re}\{Qz^{-(1+d)}\}`, add(n2r.leaf, qzr.leaf))
      const di = chain(r`\mathrm{Im}\,\mathcal D = \mathrm{Im}\,\nabla^2+\mathrm{Im}\{Qz^{-(1+d)}\}`, add(n2i.leaf, qzi.leaf))
      const den2 = chain(r`|\mathcal D|^2 = (\mathrm{Re}\,\mathcal D)^2+(\mathrm{Im}\,\mathcal D)^2`, add(sq(dr.leaf), sq(di.leaf)))
      const Hre = chain(
        r`\mathrm{Re}\,H_{\mathrm{PD}} = \frac{\mathrm{Re}\,\nabla^2\,\mathrm{Re}\,\mathcal D+\mathrm{Im}\,\nabla^2\,\mathrm{Im}\,\mathcal D}{|\mathcal D|^2}`,
        div(add(mul(n2r.leaf, dr.leaf), mul(n2i.leaf, di.leaf)), den2.leaf),
        { target: H.re },
      )
      const Him = chain(
        r`\mathrm{Im}\,H_{\mathrm{PD}} = \frac{\mathrm{Im}\,\nabla^2\,\mathrm{Re}\,\mathcal D-\mathrm{Re}\,\nabla^2\,\mathrm{Im}\,\mathcal D}{|\mathcal D|^2}`,
        div(sub(mul(n2i.leaf, dr.leaf), mul(n2r.leaf, di.leaf)), den2.leaf),
        { target: H.im },
      )
      const h2r = chain(r`\mathrm{Re}\,\hat H_2 = K_2\,\mathrm{Re}\,\nabla^2`, mul(K2.leaf, n2r.leaf), { target: H2.re })
      const h2i = chain(r`\mathrm{Im}\,\hat H_2 = K_2\,\mathrm{Im}\,\nabla^2`, mul(K2.leaf, n2i.leaf), { target: H2.im })
      const E = chain(
        r`E[u\,u_f] = \mathrm{Re}\,H_{\mathrm{PD}}\cdot\mathrm{Re}\,\hat H_2+\mathrm{Im}\,H_{\mathrm{PD}}\cdot\mathrm{Im}\,\hat H_2`,
        add(mul(Hre.leaf, h2r.leaf), mul(Him.leaf, h2i.leaf)),
        { target: analyticCorr({ code, h: Htf, g: hat.full, D: 0 }) as number },
      )
      const phH = cArg(H) * DEG
      const ph2 = cArg(H2) * DEG
      const diff = tidy(wrap180(phH - ph2))
      const ang = (v: number): string => degT(roundSig(v, 4))
      return {
        steps: [
          step(Kp, r`PI loop filter 的比例項（E44 的 DT 參考模型）。`),
          step(Ki, r`積分項。`),
          step(K2, r`二次差分 regressor 的增益 $K_2=1/(\hat\omega_nT_s)^2$（這裡假設 $\hat\omega_n=\omega_n$）。它是正數，只影響大小、不影響符號。`),
          step(nr, r`歐拉公式：$e^{-j\Omega}=\cos\Omega-j\sin\Omega$，所以 $\nabla=1-e^{-j\Omega}=(1-\cos\Omega)+j\sin\Omega$。先算實部（DEG 模式按 $\cos$）。`),
          step(ni, r`$\nabla$ 的虛部（DEG 模式按 $\sin$）。`),
          step(n2r, r`複數平方 $(a+jb)^2=(a^2-b^2)+j\,2ab$ 的實部：兩個平方相減。`),
          step(n2i, r`複數平方的虛部。$\nabla^2$ 就是「二次差分」的頻率響應（不含 $K_2$）。`),
          step(qr, r`令 $Q\equiv K_i+K_p\nabla$（loop filter 的分子）；實數 $K_i$ 加在實部。`),
          step(qi, r`$Q$ 的虛部。`),
          step(cz, r`迴路延遲 $1+d$ 個 sample：$z^{-(1+d)}=e^{-j(1+d)\Omega}=c-js$。先算角度 $(1+d)\Omega$，再按 $\cos$。`),
          step(sz, r`同一個角度按 $\sin$。`),
          step(breakChain(qzr, [2]), r`複數相乘 $(a+jb)(c-js)=(ac+bs)+j(bc-as)$ 的實部。`),
          step(breakChain(qzi, [2]), r`同一個乘法的虛部。`),
          step(dr, r`分母 $\mathcal D\equiv\nabla^2+Qz^{-(1+d)}$ 的實部。`),
          step(di, r`分母的虛部。`),
          step(den2, r`複數除法要用到分母的絕對值平方。`),
          step(breakChain(Hre, [2, 3]), r`複數除法：分子分母同乘分母的共軛，$\dfrac{a+jb}{c+je}=\dfrac{(ac+be)+j(bc-ae)}{c^2+e^2}$。這是實部：兩個乘積相加，再除以 $|\mathcal D|^2$。`),
          step(breakChain(Him, [2, 3]), r`同一個除法的虛部。到這裡就得到真實誤差路徑在這個頻率的響應。`),
          step(h2r, r`regressor 路徑的響應 $\hat H_2=K_2\nabla^2$：實部乘 $K_2$。`),
          step(h2i, r`虛部也乘 $K_2$。`),
          step(breakChain(E, [2]), r`$\mathrm{Re}\{(a+jb)\overline{(c+je)}\}=ac+be$：兩個複數的「內積」。它等於 $|H||\hat H_2|\cos(\angle H-\angle\hat H_2)$（F-07.12 取 $D=0$，unit-power code）。`),
        ],
        results: [
          { symbol: r`\mathrm{Re}\,H_{\mathrm{PD}}`, label: '真實誤差路徑響應的實部', value: tidy(Hre.value), tolerance: { abs: 2e-3, rel: 0.02 } },
          { symbol: r`\mathrm{Im}\,H_{\mathrm{PD}}`, label: '真實誤差路徑響應的虛部', value: tidy(Him.value), tolerance: { abs: 2e-3, rel: 0.02 } },
          { symbol: r`E[u\,u_f]`, label: '二次差分 regressor 的有效相關', value: tidy(E.value), tolerance: { abs: 2e-3, rel: 0.02 } },
        ],
        notes: [
          r`極座標對照（由模型的 freqz 計算）：$|H_{\mathrm{PD}}|=${num(cAbs(H))}$、$\angle H_{\mathrm{PD}}=${ang(phH)}$；$|\hat H_2|=4K_2\sin^2(\Omega/2)=${num(cAbs(H2))}$、$\angle\hat H_2=180^\circ-\Omega=${ang(ph2)}$；相位差 $\angle H_{\mathrm{PD}}-\angle\hat H_2=${ang(diff)}$。`,
          E.value < 0
            ? r`$E[u\,u_f]=${num(E.value)}<0$：相位差超過 $90^\circ$，二次差分 regressor 在這個頻率會讓 LMS 反向更新——它只複製了 $H_{\mathrm{PD}}$ 的低頻漸近線。`
            : E.value > 0
              ? r`$E[u\,u_f]=${num(E.value)}>0$：相位差小於 $90^\circ$，這個頻率用二次差分的極性是對的。`
              : r`$E[u\,u_f]=0$：相位差剛好 $90^\circ$，沒有平均恢復力。`,
          r`對照 raw-x：$C=\mathrm{Re}\,H_{\mathrm{PD}}=${num(Hre.value)}$${Hre.value > 0 ? r`，本來就是正的（$\Omega$ 高於 $\omega_nT_s$ 時 $H_{\mathrm{PD}}\approx1$）` : r`，不是正的（低頻 tone 經 Type-II 後相位接近 $180^\circ$）`}。`,
        ],
      }
    },
    tips: [
      r`複數一律拆成實部、虛部分開算，每一步只有一兩個乘法。建議在紙上畫兩欄（Re／Im），算一格填一格。`,
      r`$\sin$、$\cos$ 用 DEG 模式；$30^\circ$、$45^\circ$、$60^\circ$、$90^\circ$ 可以查特殊角：$\sin30^\circ=0.5$、$\cos30^\circ=0.86603$、$\sin45^\circ=\cos45^\circ=0.70711$、$\sin60^\circ=0.86603$、$\cos60^\circ=0.5$。`,
      r`要把 $a+jb$ 換成極座標：$|\cdot|=\sqrt{a^2+b^2}$，角度 $=\arctan(b/a)$；$a<0$ 時計算機給的角度要再加 $180^\circ$（或直接用計算機的 Rec→Pol 功能）。`,
      r`範例數字（$\omega_nT_s=0.1$、$\zeta=0.7$、$d=0$、$\Omega=30^\circ=\pi/6$）是思考題 3 與 Lab preset「二次差分在中頻 tone 失效」：$\angle H_{\mathrm{PD}}\approx16.3^\circ$、相位差 $\approx-133.7^\circ$、$E[u\,u_f]\approx-19.9$。`,
      r`中間值請保留至少 5 位有效數字。有幾步是兩個接近的數相減（例如 $\mathrm{Re}\,\mathcal D$、$\mathrm{Im}\,H_{\mathrm{PD}}$ 的分子）：相減會吃掉有效位數，這時步驟會把運算元多寫幾位——照計算機上完整的數字往下算就對了，不要抄 5 位再算。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-07.8',
    title: r`綜合：raw-x／delayed-x／filtered-x 三個平均 pole（算完到 Lab 對答案）`,
    page: '/ch/07',
    formulaId: 'F-07.11',
    formulaTex: r`\begin{aligned}&C_{\mathrm{raw}}=|H|\cos\phi,\qquad C_D=|H|\cos(\phi+\Omega D),\qquad E[u^2]=|H|^2\qquad(\text{unit power：}A^2/2=1);\\[1ex]&p=1-\mu K_q\,C,\quad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mag', symbol: '|H|', label: '誤差路徑在 code 頻率的增益', default: 1, min: 0.001, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'phi', symbol: r`\phi`, label: '誤差路徑在 code 頻率的相位', unit: r`\mathrm{deg}`, default: -120, min: -180, max: 180, practice: { choices: [-150, -120, -90, -60, 120] } },
      { key: 'omega', symbol: r`\Omega`, label: 'code 頻率', unit: r`\mathrm{deg/sample}`, default: 30, min: 0, max: 180, practice: { choices: [15, 30, 45, 60] } },
      { key: 'D', symbol: 'D', label: 'delayed-x 的延遲', unit: r`\text{samples}`, default: 4, min: 0, max: 512, integer: true, practice: { min: 0, max: 8, step: 1 } },
      { key: 'mu', symbol: r`\mu`, label: 'learning rate（gain_step）', unit: r`\mathrm{fs}`, default: 10, min: 0, max: 1e6, practice: { choices: [5, 10, 20] } },
      { key: 'sigmaV', symbol: r`\sigma_v`, label: 'comparator 前的雜訊', unit: r`\mathrm{fs}`, default: 100, min: 0, max: 1e6, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ omega, sigmaV }) => omegaDegError(omega) ?? (sigmaV > 0 ? null : SIGMA_ERR),
    solve: ({ mag, phi, omega, D, mu, sigmaV }) => {
      const om = omega * RAD
      // 與 Lab（analyzeFxLab）相同的函式：2-tap FIR 的單頻路徑 + unit-power 單頻 code
      const path: FxPathSpec = { kind: 'single_tone', magnitude: mag, phaseDeg: phi, omega: om }
      const code: FxCodeSpec = { kind: 'sinusoid', omega: om }
      const H = pathTransfer(path)
      const cosPhi = chain(r`\cos\phi`, cosd(deg(phi)))
      const Craw = chain(r`C_{\mathrm{raw}} = |H|\cos\phi`, mul(given(mag), cosPhi.leaf), { target: analyticCorr({ code, h: H, g: null, D: 0 }) as number })
      const a = residual(phi, omega, D)
      const cosT = chain(r`\cos\theta`, cosd(deg(a.theta)))
      const CD = chain(r`C_D = |H|\cos\theta`, mul(given(mag), cosT.leaf), { target: analyticCorr({ code, h: H, g: null, D }) as number })
      const Eu2 = chain(r`E[u^2] = |H|^2`, sq(given(mag)), { target: analyticCorr({ code, h: H, g: H, D: 0 }) as number })
      const pr = calPole(mu, sigmaV, Craw.value)
      const pd = calPole(mu, sigmaV, CD.value)
      const pf = calPole(mu, sigmaV, Eu2.value)
      const Kq = chain(r`K_q = \frac{\sqrt{2/\pi}}{\sigma_v}`, div(calc(kqFromSigma(1)), given(sigmaV)), { target: pr.Kq, suffix: r`\ \mathrm{fs^{-1}}` })
      const muKq = chain(r`\mu K_q`, mul(given(mu), Kq.leaf))
      const pR = poleStep(r`p_{\mathrm{raw}} = 1-\mu K_qC_{\mathrm{raw}}`, muKq, Craw, pr.p)
      const pD = poleStep(r`p_D = 1-\mu K_qC_D`, muKq, CD, pd.p)
      const pF = poleStep(r`p_f = 1-\mu K_qE[u^2]`, muKq, Eu2, pf.p)
      const [prv, pdv, pfv] = [tidy(pR.value), tidy(pD.value), tidy(pF.value)]
      return {
        steps: [
          step(cosPhi, r`raw-x 不補任何相位：殘餘相位就是 $\phi$。DEG 模式按 $\cos$。`),
          step(Craw, r`F-07.2 取 $D=0$；unit-power code（$A^2/2=1$，和 Lab 相同）。`),
          step(a.omD, r`delayed-x：延遲 $D$ 個 sample 轉的相位。`),
          { tex: thetaTex(r`\theta`, r`\phi+\Omega D`, a), why: r`延遲的是 code，所以是加 $\Omega D$。${a.wrap.wrapped ? WHY_WRAP : ''}` },
          step(cosT, r`DEG 模式按 $\cos$。`),
          step(CD, r`delayed-x 的相關。`),
          step(Eu2, r`filtered-x（$\hat H=H$、$D=0$）：regressor 就是 $u$ 本身，相關是 $u$ 的功率——不可能是負的。`),
          step(Kq, r`1-bit comparator 的小訊號增益；$\sqrt{2/\pi}\approx0.79788$。`),
          step(muKq, r`三個 pole 共用的常數。`),
          step(pR, r`raw-x 的平均 pole：先乘出 loop gain $g=\mu K_qC$，再用 1 去減。`),
          step(pD, r`delayed-x 的平均 pole。`),
          step(pF, r`filtered-x（$\hat H=H$、$D=0$）的平均 pole。`),
        ],
        results: [
          { symbol: r`C_{\mathrm{raw}}`, label: 'raw-x 的相關', value: tidy(Craw.value), tolerance: { abs: 0.002, rel: 0.01 } },
          { symbol: 'C_D', label: 'delayed-x 的相關', value: tidy(CD.value), tolerance: { abs: 0.002, rel: 0.01 } },
          { symbol: 'E[u^2]', label: r`filtered-x（$\hat H=H$、$D=0$）的相關`, value: tidy(Eu2.value) },
          { symbol: r`p_{\mathrm{raw}}`, label: 'raw-x 的 pole', value: prv, digits: 6, tolerance: poleTol(1 - prv) },
          { symbol: 'p_D', label: 'delayed-x 的 pole', value: pdv, digits: 6, tolerance: poleTol(1 - pdv) },
          { symbol: 'p_f', label: r`filtered-x（$\hat H=H$、$D=0$）的 pole`, value: pfv, digits: 6, tolerance: poleTol(1 - pfv) },
        ],
        notes: [
          poleVerdict('raw-x', prv),
          poleVerdict(r`delayed-x（$D=${D}$）`, pdv),
          poleVerdict('filtered-x', pfv),
          r`到上面的 Lab 對答案：誤差路徑選 single_tone、把 $|H|$、$\phi$、$\Omega$（rad/sample：$${num(om)}$）、$\sigma_v$ 設成同樣的數字，Case A/B/C 分別是 raw-x、delayed-x、filtered-x（Case C 的 $D$ 保持 0）；指標表的 $C$ 與「平均 pole」、閉迴路結果的 $p$ 應該和你算的一樣。`,
        ],
      }
    },
    tips: [
      TIP_COS,
      TIP_KQ,
      TIP_POLE,
      TIP_TAU,
      r`範例數字就是 Lab 的預設（Gallery #4；T07 的 unit-power 版本）：$C_{\mathrm{raw}}=-0.5$、$C_4=+1$、$E[u^2]=1$；$p_{\mathrm{raw}}=1.03989$（發散）、$p_D=p_f=0.92021$（$\tau\approx12$ blocks）。7.1 節用 $A=1$，所以那裡的 $C$ 是這裡的一半、pole 是 $1.01995$ 與 $0.96011$。`,
    ],
  },
]
