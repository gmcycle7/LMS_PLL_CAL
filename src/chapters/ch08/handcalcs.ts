import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcResult, HandCalcStep } from '@/data/types'
import {
  analyzeDualLoop,
  comparatorKq,
  delayCharPoly,
  delayCriticalGain,
  delayCriticalOmega,
  delayNoOvershootGain,
  delayStable,
  dualLoopCharPoly,
  dualLoopFullMuRange,
  dualLoopGainMargin,
  dualLoopSimplifiedMuRange,
  omegaToHz,
  pmFirstOrder,
  pmWithDelay,
  polarityMarginArcsin,
  polarityMarginMod180Bug,
  polarityMarginWrap,
  posMod,
  simulateDelayRecursion,
  updateRateHz,
  wrap180Spec,
} from '@/simulation/models/stability'

/**
 * Ch08 的「帶入手算」題（docs/teaching-style.md §7）。
 *  - solve() 的答案一律取自 src/simulation/models/stability.ts 的實際函式（pmFirstOrder、pmWithDelay、delayStable、
 *    analyzeDualLoop…）；步驟裡的中間量只做「一次」基本運算，讓讀者用紙筆＋工程計算機就能跟著算。
 *  - 預設數字＝本章的 worked example：T08（g = 1）、§8.3 的手算表（d = 1、g = 0.5）、§8.3 數值驗證表的 g = 0.3 欄（d = 2）、
 *    T09／Gallery #5（r_s = 0.8、b_s = 0.2、c_s = 1、μ = 1.2）、入門課 Lesson 4／T13（σ_v = 100 fs、μ = 10 fs）。
 *  - 極性一律是 δ = a − w（全站約定）；雙迴路記號依勘誤 E31（r_s, b_s, c_s），完整上界依勘誤 E19（(1 − r_s)/(b_s c_s)）。
 *  - 顯示位數：使用者輸入照原樣（inp，10 位）；由輸入只做加減乘得到的有限小數留 8 位（ex）；無理數結果 5 位；
 *    還要再乘或取 log 的中間量多留一位（φ、GM 比值 6 位）。這樣讀者照著畫面上的數字按計算機，會得到畫面上的下一個數字
 *    （handcalcs.test.tsx 的「算式鏈」測試逐步驗算；預設值的每一步另與獨立的 Python 第一原理重算逐字比對）。
 *  - 備註裡的定性敘述（會不會衝過頭、quasi-static 是樂觀還是保守）一律由模型函式的數字決定，不寫死。
 */

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
/** 判別式 |Δ| ≤ DISC_TOL 視為重根（避免 0.04 − 0.04 的浮點尾巴被誤判成複數根） */
const DISC_TOL = 1e-12
/** 手算遞迴題要算幾個 block */
export const HAND_BLOCKS = 5
/** 遞迴題的 δ_k 顯示位數：手算友善的輸入（0.25 的倍數…）下 δ_5 是有限小數，照原樣寫出來（0.2373046875 不寫成 0.2373） */
const SEQ_SIG = 10
/** 判斷「會不會衝過頭」時，同一個遞迴往下再跑幾個 block */
export const OVERSHOOT_BLOCKS = 200

/** 把 1e-12 以下的浮點尾巴當成 0（例如 cos 90° = 6.1e-17） */
const clean = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : x)
/** 角度（度）的 TeX：18.966^\circ */
const deg = (x: number, sig = 5): string => String.raw`${texNum(clean(x), sig)}^\circ`
/** 代入用的角度：負值加括號 */
const degP = (x: number, sig = 5): string => String.raw`${texNumP(clean(x), sig)}^\circ`

/**
 * 使用者輸入的數字：照原樣顯示（最多 10 位有效數字），不做 5 位四捨五入——
 * 代入式裡的數字要和讀者手上的一模一樣（g = 0.0797885 不可顯示成 0.079789）。
 */
const inp = (x: number): string => texNum(x, 10)
/** 代入用的輸入值：負值加括號 */
const inpP = (x: number): string => texNumP(x, 10)
/**
 * 由輸入只做加減乘（或除以 2）得到的「有限小數」中間量（g/2、1 − g、4g、Δ、a₁、a₀…）：留 8 位有效數字，
 * 讀者輸入 g = 0.2500001 時才不會出現 1 − 4×0.2500001 = 1 − 1 這種對不上的式子；手算友善的輸入下顯示完全不變。
 */
const ex = (x: number): string => texNum(clean(x), 8)
const exP = (x: number): string => texNumP(clean(x), 8)
/** 只做加減的角度（輸入 θ 與它的平移）：同樣不四捨五入 */
const degX = (x: number): string => deg(x, 10)
/** 要再餵給 log 的比值多留一位（6 位有效數字）：比值接近 1 時，5 位會讓 dB 的第 4 位對不上 */
const RATIO_SIG = 6

const ANGLE_TOL = { abs: 0.05, rel: 0.01 }
const DB_TOL = { abs: 0.02, rel: 0.01 }
const NUM_TOL = { abs: 1e-6, rel: 0.01 }

/** PM／crossover 的封閉式只在 0 < g ≤ 2 有定義；其他情況回傳原因 */
function gainRangeError(g: number): string | null {
  if (g <= 0) {
    return String.raw`$g=${inp(g)}\le0$：沒有更新（$g=0$）或更新極性錯誤（$g<0$，pole $1-g>1$，平均誤差單調發散）。這時 gain crossover 與 $PM$ 依定義不適用——先回 §8.1 把極性修好，再選 $0<g\le2$。`
  }
  if (g > 2) {
    return String.raw`$g=${inp(g)}>2$：$|L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}\ge\frac g2>1$ 對所有 $\omega$ 成立，沒有 gain crossover（$\arcsin\frac g2$ 沒有實數解），$PM$ 無定義；pole $1-g<-1$，誤差正負交替發散。請選 $0<g\le2$。`
  }
  return null
}

/** 一階 pole 的行為（文字） */
function firstOrderBehaviour(g: number): string {
  if (g < 1) return String.raw`$0<p<1$：單調收斂，不 overshoot（$PM>60^\circ$）。`
  if (g === 1) return String.raw`$p=0$：一步到位（deadbeat），$PM=60^\circ$——T08 的數字。`
  if (g < 2) return String.raw`$-1<p<0$：正負交替但收斂（$PM<60^\circ$）；「穩定」不代表「不振盪」。`
  return String.raw`$p=-1$：臨界（$PM=0^\circ$），誤差 $\pm$ 交替、永遠不衰減——不可視為穩定。`
}

/** 延遲模型的穩定結論（文字） */
function delayVerdict(g: number, d: number): string {
  const st = delayStable(g, d)
  const gStar = delayCriticalGain(d)
  if (g <= 0) return String.raw`$g\le0$：極性錯誤或沒有更新，特徵式有實根 $z\ge1$（$\rho=${texNum(st.rho)}$），不會收斂。`
  if (st.marginal) return String.raw`$g=g^*(${d})=${texNum(gStar)}$：根剛好落在單位圓上（$\rho=1$），臨界振盪——不可視為穩定。`
  return st.stable
    ? String.raw`$g=${texNum(g)}<g^*(${d})=${texNum(gStar)}\Rightarrow \rho=${texNum(st.rho)}<1$：穩定。`
    : String.raw`$g=${texNum(g)}>g^*(${d})=${texNum(gStar)}\Rightarrow \rho=${texNum(st.rho)}>1$：振盪發散。`
}

export const HANDCALCS: HandCalcDef[] = [
  // ─────────────────────────── HC-08.1 Polarity margin ───────────────────────────
  {
    id: 'HC-08.1',
    title: String.raw`Polarity margin：把相位 $\theta$ 折回 $[-180^\circ,180^\circ)$ 再算 $M$`,
    page: '/ch/08',
    formulaId: 'F-08.1',
    formulaTex: String.raw`\psi=\mathrm{wrap}_{180}(\theta)=\big((\theta+180^\circ)\bmod 360^\circ\big)-180^\circ,\qquad M_{\mathrm{polarity}}=90^\circ-|\psi|=\arcsin(\cos\theta)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      {
        key: 'theta',
        symbol: String.raw`\theta`,
        label: '單頻相關的總相位',
        unit: String.raw`^\circ`,
        default: -150,
        min: -3600,
        max: 3600,
        practice: { choices: [-300, -210, -150, -120, -60, -30, 45, 60, 120, 150, 200, 270, 330, 400, 480] },
      },
    ],
    solve: ({ theta }) => {
      const shifted = theta + 180
      const rem = posMod(shifted, 360)
      const q = Math.round((shifted - rem) / 360) // = ⌊(θ + 180)/360⌋
      const psi = wrap180Spec(theta)
      const M = clean(polarityMarginWrap(theta))
      const cos = clean(Math.cos(theta * DEG2RAD))
      const Marc = clean(polarityMarginArcsin(theta))
      const bug = polarityMarginMod180Bug(theta)
      const notes: string[] = [
        M > 0
          ? String.raw`$M>0\iff\cos\theta>0$：平均更新方向正確（有恢復力）。`
          : M < 0
            ? String.raw`$M<0\iff\cos\theta<0$：極性錯誤，平均誤差被推離 $a$——把 $\mu$ 調小也救不回來，要先修正 delay alignment／filtered-x（Ch07）。`
            : String.raw`$M=0$（$\theta=\pm90^\circ$）：單頻相關 $C=0$，完全沒有平均恢復力（random walk）。`,
        String.raw`計算機驗算（DEG 模式）：$\cos\theta=\cos(${degX(theta)})=${texNum(cos)}$，$\arcsin(${texNum(cos)})=${deg(Marc)}$，和上面的 $M$ 相同；有效 GMAC 斜率是同相（$\theta=0^\circ$）時的 $\sin M=\cos\theta=${texNum(cos)}$ 倍${cos < 0 ? '（負號＝更新方向相反）' : ''}。`,
      ]
      if (Math.sign(bug) !== Math.sign(M) && M !== 0) {
        notes.push(
          String.raw`反面教材（勘誤 E20）：若把 wrap 誤寫成 $\theta\bmod180^\circ$，會得到 $${degX(bug)}$——符號和正確的 $M$ 相反，${M < 0 ? '把極性錯誤看成正的 margin' : '把極性正確看成負的 margin'}。`,
        )
      }
      return {
        steps: [
          {
            tex: String.raw`\theta+180^\circ=${degP(theta, 10)}+180^\circ=${degX(shifted)}`,
            why: String.raw`先平移 $180^\circ$，讓「折回」的斷點落在 $\pm180^\circ$。`,
          },
          {
            tex: String.raw`q=\left\lfloor\frac{\theta+180^\circ}{360^\circ}\right\rfloor=\left\lfloor\frac{${inp(clean(shifted))}}{360}\right\rfloor=\lfloor${texNum(shifted / 360)}\rfloor=${texNum(q)}`,
            why: String.raw`除以 $360$ 後「往下取整」：負數要往更小的整數取，例如 $\lfloor-0.33\rfloor=-1$（不是 $0$）。`,
          },
          {
            tex: String.raw`(\theta+180^\circ)\bmod360^\circ=${degP(shifted, 10)}-360^\circ\times${texNumP(q)}=${degX(rem)}`,
            why: String.raw`非負餘數＝被除數 $-\,360\times q$，一定落在 $[0^\circ,360^\circ)$。`,
          },
          {
            tex: String.raw`\psi=\mathrm{wrap}_{180}(\theta)=${degX(rem)}-180^\circ=${degX(psi)}`,
            why: String.raw`平移回來：$\psi\in[-180^\circ,180^\circ)$，而且 $\cos\psi=\cos\theta$（只差整數圈）。`,
          },
          {
            tex: String.raw`M_{\mathrm{polarity}}=90^\circ-|\psi|=90^\circ-${degX(Math.abs(psi))}=${degX(M)}`,
            why: String.raw`$\theta$ 離 $\pm90^\circ$ 的邊界還有幾度；正的才有恢復力。`,
          },
        ],
        results: [
          { symbol: String.raw`\psi`, label: '折回後的角度', value: clean(psi), unit: String.raw`^\circ`, digits: 10, tolerance: ANGLE_TOL },
          { symbol: String.raw`M_{\mathrm{polarity}}`, label: 'Polarity margin', value: M, unit: String.raw`^\circ`, digits: 10, tolerance: ANGLE_TOL },
        ],
        notes,
      }
    },
    tips: [
      String.raw`「$\bmod$ 取非負餘數」的手算法：先除、往下取整、再用「被除數 $-\,360\times$ 商」。例如 $-120\bmod360=-120-360\times(-1)=240$。`,
      String.raw`整題只有加減和一次整數除法。想驗算再按計算機：DEG 模式下先按 $\cos\theta$、再按 $\sin^{-1}$，應該得到同一個 $M$。`,
      String.raw`範例 $\theta=-150^\circ$ 的答案是 $M=-60^\circ$；$\theta=200^\circ$ 是 $-70^\circ$。兩個都是勘誤 E20 的反面測試（錯誤的 $\bmod180^\circ$ 寫法會算成 $+60^\circ$、$+70^\circ$）。`,
    ],
  },

  // ─────────────────────────── HC-08.2 一階 pole / PM / ω_c（T08） ───────────────────────────
  {
    id: 'HC-08.2',
    title: String.raw`一階 calibration loop：pole、phase margin、crossover（T08）`,
    page: '/ch/08',
    formulaId: 'F-08.5',
    formulaTex: String.raw`p=1-g,\qquad \varphi=\arcsin\frac g2,\qquad PM=90^\circ-\varphi,\qquad \omega_c=2\varphi\ \ [\mathrm{rad/block}]`,
    level: 'engineer',
    claim: 'exact',
    inputs: [{ key: 'g', symbol: 'g', label: '正規化 loop gain', default: 1, min: -5, max: 5, practice: { choices: [0.2, 0.4, 0.5, 0.8, 1, 1.2, 1.5, 1.6, 1.8] } }],
    validate: ({ g }) => gainRangeError(g),
    solve: ({ g }) => {
      const r = pmFirstOrder(g)
      const half = g / 2
      const phiDeg = (r.omegaC / 2) * RAD2DEG
      const notes = [firstOrderBehaviour(g)]
      if (r.tauBlocks > 0 && Number.isFinite(r.tauBlocks)) {
        notes.push(String.raw`收斂時間常數 $\tau=-1/\ln|p|=${texNum(r.tauBlocks, 4)}$ blocks（誤差每 $\tau$ 個 block 縮小成 $1/e\approx37\%$）。`)
      }
      if (half <= 0.25) {
        notes.push(String.raw`小增益近似：$\varphi\approx\frac g2\times57.296^\circ=${deg(half * RAD2DEG, 4)}$（精確值 $${deg(phiDeg, 4)}$）、$\omega_c\approx g=${inp(g)}$（精確值 $${texNum(r.omegaC)}$）。`)
      }
      return {
        steps: [
          { tex: String.raw`p=1-g=1-${inpP(g)}=${ex(r.pole)}`, why: String.raw`閉迴路 pole：誤差每個 block 乘上 $p$（$\delta_{k+1}=p\,\delta_k$，$\delta_k=a-w_k$）。` },
          { tex: String.raw`\frac g2=\frac{${inp(g)}}{2}=${ex(half)}`, why: String.raw`crossover 條件 $\sin\frac{\omega_c}{2}=\frac g2$ 的右邊。` },
          {
            tex: String.raw`\varphi=\arcsin\frac g2=\arcsin(${ex(half)})=${deg(phiDeg)}`,
            why: String.raw`計算機切到 DEG 模式按 $\sin^{-1}$。$\frac g2\le0.25$ 時可用 $\arcsin x\approx x\ \mathrm{rad}=57.296^\circ\times x$（誤差 $<1.1\%$）。`,
          },
          { tex: String.raw`PM=90^\circ-\varphi=90^\circ-${deg(phiDeg)}=${deg(r.pmDeg)}`, why: String.raw`$PM=180^\circ+\angle L(e^{j\omega_c})$，而 $\angle L=-90^\circ-\frac{\omega_c}{2}=-90^\circ-\varphi$。` },
          {
            tex: String.raw`\omega_c=2\varphi\times\frac{\pi}{180^\circ}=2\times${texNum(phiDeg)}\times0.017453=${texNum(r.omegaC)}\ \mathrm{rad/block}`,
            why: String.raw`$\omega_c=2\arcsin\frac g2$；把度換成 rad 要乘 $\frac{\pi}{180}=0.017453$。`,
          },
        ],
        results: [
          { symbol: 'p', label: '閉迴路 pole', value: clean(r.pole), digits: 8, tolerance: NUM_TOL },
          { symbol: 'PM', label: 'Phase margin', value: clean(r.pmDeg), unit: String.raw`^\circ`, tolerance: ANGLE_TOL },
          { symbol: String.raw`\omega_c`, label: 'Gain crossover', value: r.omegaC, unit: String.raw`\mathrm{rad/block}` },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例 $g=1$：$p=0$、$\arcsin0.5=30^\circ$、$PM=60^\circ$、$\omega_c=\pi/3=1.0472$ rad/block（測試 T08 的 golden vector）。`,
      String.raw`常用值可以背起來：$\arcsin0.1=5.74^\circ$、$\arcsin0.25=14.48^\circ$、$\arcsin0.5=30^\circ$、$\arcsin0.6=36.87^\circ$、$\arcsin0.75=48.59^\circ$。`,
      String.raw`$g>2$ 時 $\frac g2>1$，計算機的 $\sin^{-1}$ 會報錯——那不是按錯，而是真的沒有 gain crossover。`,
    ],
  },

  // ─────────────────────────── HC-08.3 ω_c → Hz、GM、DM ───────────────────────────
  {
    id: 'HC-08.3',
    title: String.raw`把 $\omega_c$ 換成 Hz，再算 gain margin 與 delay margin`,
    page: '/ch/08',
    formulaId: 'F-08.6',
    formulaTex: String.raw`\omega_c=2\arcsin\frac g2,\qquad f_u=\frac{f_s}{N},\qquad f_c=\frac{\omega_c}{2\pi}\,f_u,\qquad GM=\frac2g,\qquad DM=\frac{PM\,[\mathrm{rad}]}{\omega_c}=\frac{\pi/2-\omega_c/2}{\omega_c}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'g', symbol: 'g', label: '正規化 loop gain', default: 1, min: -5, max: 5, practice: { choices: [0.1, 0.2, 0.5, 1, 1.2, 1.5] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率（通常就是參考頻率）', unit: String.raw`\mathrm{MHz}`, default: 4000, min: 0.001, max: 1e6, practice: { choices: [1000, 2000, 4000, 8000] } },
      { key: 'N', symbol: 'N', label: 'GMAC 累加長度', unit: String.raw`\mathrm{samples}`, default: 4096, min: 1, max: 1e8, integer: true, practice: { choices: [1024, 2048, 4096, 8192, 16384] } },
    ],
    validate: ({ g }) => gainRangeError(g),
    solve: ({ g, fs, N }) => {
      const r = pmFirstOrder(g)
      const asinRad = r.omegaC / 2
      const fuHz = updateRateHz(fs * 1e6, N)
      const fuKHz = fuHz / 1e3
      const fcKHz = omegaToHz(r.omegaC, fuHz) / 1e3
      const gmLin = 2 / g
      const cyclesPerBlock = r.omegaC / (2 * Math.PI) // ω_c/(2π)：每個 block 轉幾圈
      const pmRad = r.pmDeg * DEG2RAD
      const dm = clean(r.delayMarginBlocks)
      const dmMicroSec = (dm / fuHz) * 1e6
      const fcApproxKHz = omegaToHz(g, fuHz) / 1e3
      const notes = [
        String.raw`換成時間：一個 block 是 $1/f_u=${texNum(1e3 / fuKHz, 4)}\ \mu\mathrm{s}$，所以還能容忍的純延遲是 $DM/f_u=${texNum(dmMicroSec, 4)}\ \mu\mathrm{s}$（$DM<1$ 表示連一個 block 的 pipeline 都撐不住）。`,
        String.raw`小增益近似 $\omega_c\approx g\Rightarrow f_c\approx\frac{g}{2\pi}f_u=${texNum(fcApproxKHz, 4)}$ kHz（與精確值差 $${texNum(Math.abs(fcApproxKHz / fcKHz - 1) * 100, 2)}\%$；$g\le0.5$ 時誤差 $<1.1\%$）。`,
        String.raw`$f_c$ 就是 calibration loop 的「頻寬」量級：比它慢的 gain 漂移追得上，比它快的追不上。`,
      ]
      return {
        steps: [
          {
            tex: String.raw`\arcsin\frac g2=\arcsin\frac{${inp(g)}}{2}=\arcsin(${ex(g / 2)})=${texNum(asinRad)}\ \mathrm{rad}`,
            why: String.raw`先把 $g$ 除以 $2$，再把計算機切到 RAD 模式按 $\sin^{-1}$（或 DEG 模式算完再乘 $\frac{\pi}{180}=0.017453$）。`,
          },
          { tex: String.raw`\omega_c=2\arcsin\frac g2=2\times${texNum(asinRad)}=${texNum(r.omegaC)}\ \mathrm{rad/block}`, why: String.raw`Gain crossover：$|L(e^{j\omega_c})|=1$ 的頻率，單位是「每個 block 幾 rad」。` },
          {
            tex: String.raw`f_u=\frac{f_s}{N}=\frac{${inp(fs)}\ \mathrm{MHz}}{${inp(N)}}=${texNum(fuKHz / 1e3)}\ \mathrm{MHz}=${texNum(fuKHz)}\ \mathrm{kHz}`,
            why: String.raw`係數更新率：每累加 $N$ 個 comparator sample 才更新一次（$1\ \mathrm{MHz}=1000\ \mathrm{kHz}$）。`,
          },
          {
            tex: String.raw`f_c=\frac{\omega_c}{2\pi}\,f_u=\frac{${texNum(r.omegaC)}}{6.2832}\times${texNum(fuKHz)}\ \mathrm{kHz}=${texNum(cyclesPerBlock)}\times${texNum(fuKHz)}\ \mathrm{kHz}=${texNum(fcKHz)}\ \mathrm{kHz}`,
            why: String.raw`$\omega=2\pi f/f_u$ 反過來解 $f$：先除以 $2\pi=6.2832$ 得到「每個 block 轉幾圈」，再乘上每秒幾個 block（$f_u$）。`,
          },
          { tex: String.raw`GM=\frac2g=\frac{2}{${inp(g)}}=${texNum(gmLin, RATIO_SIG)}`, why: String.raw`Nyquist 曲線在 $\omega=\pi$ 穿過 $-\frac g2$：增益還能再放大幾倍才碰到 $-1$。` },
          {
            tex: String.raw`GM_{\mathrm{dB}}=20\log_{10}(${texNum(gmLin, RATIO_SIG)})=${texNum(clean(r.gmDb))}\ \mathrm{dB}`,
            why: String.raw`換成 dB：按 $\log$（以 $10$ 為底，不是 $\ln$）再乘 $20$。心算參考：$2$ 倍 $=6.02$ dB、$10$ 倍 $=20$ dB。`,
          },
          {
            tex: String.raw`PM\,[\mathrm{rad}]=\frac{\pi}{2}-\frac{\omega_c}{2}=1.5708-${texNum(asinRad)}=${texNum(clean(pmRad))}`,
            why: String.raw`$PM=90^\circ-\arcsin\frac g2$ 改用 rad 表示（$90^\circ=\frac\pi2=1.5708$）。`,
          },
          {
            tex: String.raw`DM=\frac{PM\,[\mathrm{rad}]}{\omega_c}=\frac{${texNum(clean(pmRad))}}{${texNum(r.omegaC)}}=${texNum(dm)}\ \text{blocks}`,
            why: String.raw`多 $\tau$ 個 block 的純延遲在 $\omega_c$ 吃掉 $\omega_c\tau$ rad 的相位；吃光 $PM$ 就到臨界。`,
          },
        ],
        results: [
          { symbol: 'f_c', label: 'Crossover 頻率', value: fcKHz, unit: String.raw`\mathrm{kHz}` },
          { symbol: String.raw`GM_{\mathrm{dB}}`, label: 'Gain margin', value: clean(r.gmDb), unit: String.raw`\mathrm{dB}`, tolerance: DB_TOL },
          { symbol: 'DM', label: 'Delay margin', value: dm, unit: String.raw`\text{blocks}`, tolerance: { abs: 0.005, rel: 0.01 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例 $g=1$、$f_s=4$ GHz、$N=4096$：$\omega_c=\pi/3\Rightarrow f_c=f_u/6=162.76$ kHz；$GM=6.02$ dB；$DM=1$ block——剛好撐得住一個 block 的延遲（所以 $d=1$ 的臨界增益正是 $g^*=1$）。`,
      String.raw`手上沒有 $\sin^{-1}$ 鍵時：$g\le0.5$ 直接用 $\omega_c\approx g$；更準一點用 $\omega_c\approx g+\frac{g^3}{24}$（$g\le1$ 時誤差 $<0.6\%$）。`,
      String.raw`單位檢查：$\omega_c$ 是 rad/block、$f_u$ 是 block/s，相乘再除以 $2\pi$ rad 才是 Hz。`,
    ],
  },

  // ─────────────────────────── HC-08.4 延遲遞迴（紙筆 5 步） ───────────────────────────
  {
    id: 'HC-08.4',
    title: String.raw`更新延遲的遞迴：用紙筆走 ${HAND_BLOCKS} 個 block`,
    page: '/ch/08',
    formulaId: 'F-08.7',
    formulaTex: String.raw`\delta_{k+1}=\delta_k-g\,\delta_{k-d},\qquad \delta_{k}=\delta_0\ \ (k\le0),\qquad \delta_k=a-w_k`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'g', symbol: 'g', label: '正規化 loop gain', default: 0.5, min: -2, max: 3, practice: { choices: [0.25, 0.5, 0.75, 1, 1.25, 1.5] } },
      { key: 'd', symbol: 'd', label: '更新延遲', unit: String.raw`\text{blocks}`, default: 1, min: 0, max: 3, integer: true, practice: { choices: [0, 1, 2] } },
      { key: 'd0', symbol: String.raw`\delta_0`, label: '初始參數誤差', unit: String.raw`\mathrm{fs}`, default: 1, min: -1000, max: 1000, practice: { choices: [1, 2, 4, 8] } },
    ],
    validate: ({ d0 }) => (d0 === 0 ? String.raw`$\delta_0=0$：一開始就沒有誤差，之後每個 $\delta_k$ 都是 $0$，看不出迴路的動態。請給一個非零的初始誤差。` : null),
    solve: ({ g, d, d0 }) => {
      const dl = Array.from(simulateDelayRecursion(g, d, HAND_BLOCKS, d0).delta, clean)
      const seq = (x: number): string => texNum(x, SEQ_SIG)
      const seqP = (x: number): string => texNumP(x, SEQ_SIG)
      const steps: HandCalcStep[] = []
      const results: HandCalcResult[] = []
      for (let k = 0; k < HAND_BLOCKS; k++) {
        const idx = k - d
        const past = idx < 0 ? d0 : dl[idx]
        const corr = clean(g * past) // 這一步的修正量 g·δ_{k−d}（一次乘法）
        steps.push({
          tex: String.raw`\delta_{${k + 1}}=\delta_{${k}}-g\,\delta_{${idx}}=${seq(dl[k])}-${inpP(g)}\times${seqP(past)}=${seq(dl[k])}-${seqP(corr)}=${seq(dl[k + 1])}`,
          why:
            idx < 0
              ? String.raw`$k-d=${idx}<0$：GMAC 量到的仍是初始係數 $w_0$ 造成的誤差，所以 $\delta_{${idx}}$ 用 $\delta_0=${inp(d0)}$。先乘（$g\,\delta_{${idx}}$）再減。`
              : d === 0
                ? String.raw`沒有延遲：修正量用的是「這一個」block 的誤差 $\delta_{${k}}$。先乘再減。`
                : String.raw`修正量用的是 $${d}$ 個 block 前的誤差 $\delta_{${idx}}=${seq(past)}$（不是現在的 $\delta_{${k}}$）。先乘再減。`,
        })
        results.push({
          symbol: String.raw`\delta_{${k + 1}}`,
          label: `第 ${k + 1} 個 block 後的誤差`,
          value: dl[k + 1],
          unit: String.raw`\mathrm{fs}`,
          digits: SEQ_SIG,
          tolerance: NUM_TOL,
        })
      }
      const notes = [delayVerdict(g, d)]
      if (d === 0) notes.push(String.raw`$d=0$ 就是 §8.2 的一階模型：每一步都只是乘上 $p=1-g=${texNum(pmFirstOrder(g).pole)}$。`)
      else if (g > 0 && g < 2) {
        // 會不會衝過頭（變號）由同一個遞迴再往下跑 OVERSHOOT_BLOCKS 個 block 決定，不靠印象
        const long = simulateDelayRecursion(g, d, OVERSHOOT_BLOCKS, d0).delta
        const flip = long.findIndex((x) => x * d0 < 0)
        const gSmooth = delayNoOvershootGain(d)
        const pole0 = pmFirstOrder(g).pole
        const rho = delayStable(g, d).rho
        const base = String.raw`同一個 $g$ 若沒有延遲，pole 是 $1-g=${texNum(clean(pole0))}$（一階模型說穩定）`
        const bound = String.raw`\frac{d^d}{(d+1)^{d+1}}=${texNum(gSmooth, 4)}` // d = 1 → 1/4（就是下一題的判別式 1 − 4g ≥ 0）
        notes.push(
          g > 1
            ? String.raw`${base}，但 $p<0$：就算沒有延遲，$\delta_k$ 也會正負交替。加上 $${d}$ 個 block 的延遲後，$\rho$ 從 $|1-g|=${texNum(Math.abs(pole0))}$ ${rho > Math.abs(pole0) ? '變大成' : '變成'} $${texNum(rho)}$。`
            : flip > 0
              ? String.raw`${base}，而且 $0\le p<1$ 不會衝過頭；延遲讓修正「慢半拍」，$\delta_k$ 在 $k=${flip}$ 第一次變號（衝過頭）。$d=${d}$ 時不衝過頭的條件是 $g\le${bound}$。`
              : g <= gSmooth
                ? String.raw`${base}。$d=${d}$ 時這個 $g$ 夠小（$g\le${bound}$）：即使修正慢半拍，$\delta_k$ 也不會變號——同一個遞迴往下再算 $${OVERSHOOT_BLOCKS}$ 個 block，都和 $\delta_0$ 同號。`
                : String.raw`${base}。$d=${d}$ 時 $g$ 只比不衝過頭的門檻 $${bound}$ 大一點：$\delta_k$ 遲早會變號，但衝過頭的幅度極小，前 $${OVERSHOOT_BLOCKS}$ 個 block 內還看不到。`,
        )
      }
      return { steps, results, notes }
    },
    tips: [
      String.raw`在紙上畫兩列：上面寫 $k$、下面寫 $\delta_k$。每一格＝「左邊那一格」減掉「$g$ 乘上往左數第 $d+1$ 格」；不夠格數時用 $\delta_0$。`,
      String.raw`範例 $g=0.5$、$d=1$、$\delta_0=1$ 的答案是 $0.5,\ 0,\ -0.25,\ -0.25,\ -0.125$（和 §8.3「先算一次」的表相同）：會 overshoot 到負的，但振幅越來越小。`,
      String.raw`每一步只有一次乘法、一次減法；減掉負數就是加（$-0.25-(-0.125)=-0.125$）。「換一題」抽到的 $g$ 都是 $0.25$ 的倍數，每個 $\delta_k$ 都是有限小數，照抄即可、不需要四捨五入。`,
      String.raw`把 $g$ 換成 $1.25$ 再算一次（$d=1$）：振幅越來越大——一階模型認為穩定的 $g$，多一個 block 延遲就發散。`,
    ],
  },

  // ─────────────────────────── HC-08.5 d = 1 的 poles ───────────────────────────
  {
    id: 'HC-08.5',
    title: String.raw`$d=1$ 的閉迴路 poles：解 $z^2-z+g=0$`,
    page: '/ch/08',
    formulaId: 'F-08.7',
    formulaTex: String.raw`P(z)=z^2-z+g=0,\qquad \Delta=1-4g,\qquad z=\begin{cases}\dfrac{1\pm\sqrt{\Delta}}{2},&\Delta\ge0\\[2ex]\dfrac12\pm j\,\dfrac{\sqrt{-\Delta}}{2},\quad|z|=\sqrt g,&\Delta<0\end{cases}`,
    level: 'research',
    claim: 'exact',
    inputs: [{ key: 'g', symbol: 'g', label: '正規化 loop gain', default: 0.5, min: -2, max: 4, practice: { choices: [0.09, 0.16, 0.21, 0.24, 0.5, 0.65, 1, 1.25] } }],
    solve: ({ g }) => {
      const [, a1, a0] = delayCharPoly(g, 1) // [1, −1, g]
      const disc = a1 * a1 - 4 * a0
      const st = delayStable(g, 1)
      const verdict = delayVerdict(g, 1)
      const head: HandCalcStep = {
        tex: String.raw`\Delta=1-4g=1-4\times${inpP(g)}=1-${exP(4 * g)}=${ex(disc)}`,
        why: String.raw`二次式 $z^2-z+g$ 的判別式 $a_1^2-4a_0$（$a_1=-1$、$a_0=g$）：先乘再減。$\Delta<0$ 是共軛複數根，$\Delta\ge0$ 是兩個實根。`,
      }
      if (disc < -DISC_TOL) {
        const top = st.roots.find((z) => z.im > 0) ?? st.roots[0]
        const angleDeg = Math.atan2(top.im, top.re) * RAD2DEG
        const mod2 = top.re * top.re + top.im * top.im
        return {
          steps: [
            head,
            { tex: String.raw`\mathrm{Re}\,z=\frac{1}{2}=${texNum(top.re)}`, why: String.raw`實部＝$-a_1/2$，與 $g$ 無關：根只會沿著 $\mathrm{Re}\,z=\frac12$ 這條直線上下移動。` },
            {
              tex: String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{\sqrt{${ex(-disc)}}}{2}=\pm\frac{${texNum(Math.sqrt(-disc))}}{2}=\pm${texNum(top.im)}`,
              why: String.raw`複數的實部、虛部分開算：先開根號，再除以 $2$。`,
            },
            {
              tex: String.raw`|z|^2=(\mathrm{Re}\,z)^2+(\mathrm{Im}\,z)^2=${texNum(top.re)}^2+${texNum(top.im)}^2=${texNum(top.re * top.re)}+${texNum(top.im * top.im)}=${texNum(mod2)}`,
              why: String.raw`模數平方＝實部平方＋虛部平方（各自平方再相加）。捷徑（Vieta）：共軛根的 $|z|^2=z\bar z=a_0=g$，不用算也知道是 $${inp(g)}$。`,
            },
            { tex: String.raw`|z|=\sqrt{${texNum(mod2)}}=${texNum(st.rho)}`, why: String.raw`$|z|<1\iff g<1$：這就是 $d=1$ 的穩定上界 $g^*(1)=1$。` },
            {
              tex: String.raw`\angle z=\arctan\frac{\mathrm{Im}\,z}{\mathrm{Re}\,z}=\arctan\frac{${texNum(top.im)}}{${texNum(top.re)}}=\arctan(${texNum(top.im / top.re)})=${deg(angleDeg)}`,
              why: String.raw`先做除法，再用 DEG 模式按 $\tan^{-1}$（實部是正的，不需要補 $180^\circ$）。每個 block 轉這麼多度 $\Rightarrow$ 振盪週期 $360^\circ/\angle z$ 個 block。`,
            },
          ],
          results: [
            { symbol: String.raw`\mathrm{Im}\,z`, label: '虛部（取正的那個）', value: top.im },
            { symbol: '|z|', label: '模數（spectral radius）', value: st.rho },
            { symbol: String.raw`\angle z`, label: 'pole 的角度', value: angleDeg, unit: String.raw`^\circ`, tolerance: ANGLE_TOL },
          ],
          notes: [
            verdict,
            String.raw`振盪週期 $360^\circ/${deg(angleDeg, 4)}=${texNum(360 / angleDeg, 4)}$ blocks，包絡每個 block 乘上 $|z|=${texNum(st.rho)}$——拿上一題手算的 $\delta_k$ 對照看看。`,
          ],
        }
      }
      const sq = Math.sqrt(Math.max(0, disc))
      const reals = st.roots.map((z) => z.re).sort((x, y) => y - x)
      const z1 = Math.abs(disc) <= DISC_TOL ? 0.5 : reals[0]
      const z2 = Math.abs(disc) <= DISC_TOL ? 0.5 : clean(reals[reals.length - 1])
      return {
        steps: [
          head,
          { tex: String.raw`\sqrt{\Delta}=\sqrt{${ex(disc)}}=${texNum(sq)}`, why: String.raw`$\Delta\ge0$：兩個根都是實數，先把根號算出來。` },
          { tex: String.raw`z_1=\frac{1+\sqrt\Delta}{2}=\frac{1+${texNum(sq)}}{2}=${texNum(z1)}`, why: String.raw`較大的根（慢的模態；$g$ 很小時 $z_1\approx1-g$）。` },
          { tex: String.raw`z_2=\frac{1-\sqrt\Delta}{2}=\frac{1-${texNum(sq)}}{2}=${texNum(z2)}`, why: String.raw`較小的根（延遲帶來的快模態；$g$ 很小時 $z_2\approx g$）。` },
          {
            tex: String.raw`\rho=\max\big(|z_1|,|z_2|\big)=\max(${texNum(Math.abs(z1))},\,${texNum(Math.abs(z2))})=${texNum(st.rho)}`,
            why: String.raw`Spectral radius：絕對值最大的根決定收斂（$<1$）或發散（$>1$）。`,
          },
        ],
        results: [
          { symbol: 'z_1', label: '較大的實根', value: z1, tolerance: NUM_TOL },
          { symbol: 'z_2', label: '較小的實根', value: z2, tolerance: NUM_TOL },
          { symbol: String.raw`\rho`, label: 'Spectral radius', value: st.rho, tolerance: NUM_TOL },
        ],
        notes: [verdict, String.raw`驗算（Vieta）：$z_1+z_2=${texNum(z1 + z2)}$ 應等於 $1$，$z_1z_2=${texNum(clean(z1 * z2))}$ 應等於 $g=${inp(g)}$。$g>\frac14$ 之後兩根相撞、變成共軛複數。`],
      }
    },
    tips: [
      String.raw`範例 $g=0.5$：$\Delta=-1\Rightarrow z=0.5\pm j0.5$、$|z|=\sqrt{0.5}=0.7071$、角度 $45^\circ$（週期 $8$ blocks）。`,
      String.raw`複數不用怕：整題只做「實部一個數、虛部一個數」的四則運算，再加一次開根號和一次 $\tan^{-1}$。`,
      String.raw`想快速判斷穩不穩：共軛複數根的 $|z|=\sqrt g$，所以只要看 $g$ 有沒有小於 $1$。`,
    ],
  },

  // ─────────────────────────── HC-08.6 g*(d)、GM_d、PM_d ───────────────────────────
  {
    id: 'HC-08.6',
    title: String.raw`$d$ 個 block 延遲的臨界增益 $g^*(d)$、$GM_d$ 與 $PM_d$`,
    page: '/ch/08',
    formulaId: 'F-08.8',
    formulaTex: String.raw`g^{*}(d)=2\sin\frac{\pi}{4d+2}=2\sin\frac{180^\circ}{4d+2},\qquad GM_d=\frac{g^{*}(d)}{g},\qquad PM_d=90^\circ-(2d+1)\arcsin\frac g2`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'd', symbol: 'd', label: '更新延遲', unit: String.raw`\text{blocks}`, default: 2, min: 0, max: 6, integer: true, practice: { choices: [0, 1, 2, 3, 4] } },
      { key: 'g', symbol: 'g', label: '正規化 loop gain', default: 0.3, min: -5, max: 5, practice: { choices: [0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.8, 1, 1.2] } },
    ],
    validate: ({ g }) => gainRangeError(g),
    solve: ({ d, g }) => {
      const pm = pmWithDelay(g, d)
      const gStar = delayCriticalGain(d)
      const halfAngleDeg = (delayCriticalOmega(d) / 2) * RAD2DEG // = 180°/(4d + 2)
      const gmLin = gStar / g
      const phiDeg = (pm.omegaC / 2) * RAD2DEG
      const m = 2 * d + 1
      const pm0 = pmFirstOrder(g).pmDeg
      const notes = [delayVerdict(g, d)]
      if (d > 0) {
        notes.push(String.raw`忽略延遲的一階模型會說 $PM=90^\circ-\varphi=${deg(pm0, 4)}$；每多一個 block 延遲再扣 $2\varphi=\omega_c=${deg(2 * phiDeg, 4)}$，$${d}$ 個 block 共扣 $${deg(2 * d * phiDeg, 4)}$。`)
      }
      notes.push(String.raw`臨界時單位圓上的根角度 $\omega^*=\frac{180^\circ}{2d+1}=${deg((delayCriticalOmega(d) * RAD2DEG), 4)}$（$PM_d=0$ 與「根穿越單位圓」是同一件事）。`)
      return {
        steps: [
          {
            tex: String.raw`\frac{180^\circ}{4d+2}=\frac{180^\circ}{4\times${d}+2}=\frac{180^\circ}{${4 * d + 2}}=${deg(halfAngleDeg)}`,
            why: String.raw`$\frac{\pi}{4d+2}$ rad 換成度（$\pi\ \mathrm{rad}=180^\circ$），等一下用 DEG 模式按 $\sin$。`,
          },
          {
            tex: String.raw`g^{*}(${d})=2\sin${deg(halfAngleDeg)}=2\times${texNum(gStar / 2)}=${texNum(gStar)}`,
            why: String.raw`臨界增益：$g$ 一超過它，就有一對根跑出單位圓。$d\ge3$ 時可用 $g^*\approx\frac{\pi}{2d+1}$（$\sin x\approx x$，誤差 $<1\%$）。`,
          },
          {
            tex: String.raw`GM_d=\frac{g^{*}}{g}=\frac{${texNum(gStar)}}{${inp(g)}}=${texNum(gmLin, RATIO_SIG)}`,
            why: String.raw`$g$ 離臨界值還差幾倍；$>1$ 才穩定。這個倍數就是留給 $K_q$、$C$ 的 PVT 變化的餘裕。（多留一位小數，下一步要取 $\log$。）`,
          },
          {
            tex: String.raw`GM_d\,[\mathrm{dB}]=20\log_{10}(${texNum(gmLin, RATIO_SIG)})=${texNum(clean(pm.gmDb))}\ \mathrm{dB}`,
            why: String.raw`換成 dB：按 $\log$（以 $10$ 為底）再乘 $20$；負的 dB 表示已經超過臨界。`,
          },
          {
            tex: String.raw`\varphi=\arcsin\frac g2=\arcsin\frac{${inp(g)}}{2}=\arcsin(${ex(g / 2)})=${deg(phiDeg, 6)}`,
            why: String.raw`先把 $g$ 除以 $2$，再用 DEG 模式按 $\sin^{-1}$（多留一位小數，等一下要乘 $2d+1$）；延遲不改變 $|L|$，所以 $\omega_c=2\varphi$ 與 $d$ 無關。$\frac g2\le0.25$ 時可用 $\varphi\approx57.296^\circ\times\frac g2$（誤差 $<1.1\%$）。`,
          },
          {
            tex: String.raw`PM_d=90^\circ-(2d+1)\,\varphi=90^\circ-${m}\times${deg(phiDeg, 6)}=90^\circ-${deg(m * phiDeg, 6)}=${deg(pm.pmDeg)}`,
            why: String.raw`$\angle L(e^{j\omega_c})=-90^\circ-(d+\tfrac12)\,\omega_c=-90^\circ-(2d+1)\varphi$，再加 $180^\circ$。先乘再減。`,
          },
        ],
        results: [
          { symbol: String.raw`g^{*}`, label: '臨界增益', value: gStar },
          { symbol: String.raw`GM_d`, label: 'Gain margin（以 dB 表示）', value: clean(pm.gmDb), unit: String.raw`\mathrm{dB}`, tolerance: DB_TOL },
          { symbol: String.raw`PM_d`, label: '含延遲的 phase margin', value: clean(pm.pmDeg), unit: String.raw`^\circ`, tolerance: ANGLE_TOL },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例 $d=2$、$g=0.3$：$g^*=2\sin18^\circ=0.618$、$GM_2=6.28$ dB、$PM_2=46.87^\circ$（和下面數值驗證表 $d=2$ 那一列的最後一欄相同）。`,
      String.raw`把 $g$ 改成 $0.65$ 再算一次：一階模型以為 $PM$ 還有 $71^\circ$，你算出來的 $PM_2$ 是正的還是負的？（這就是本節思考題的情境。）`,
      String.raw`值得背的三個數：$g^*(0)=2$、$g^*(1)=2\sin30^\circ=1$、$g^*(2)=2\sin18^\circ=\frac{\sqrt5-1}{2}=0.618$。`,
      String.raw`$GM_d$ 與 $PM_d$ 會同時變號：$g<g^*\iff GM_d>0\ \mathrm{dB}\iff PM_d>0^\circ$。算出來一正一負就代表按錯了。`,
    ],
  },

  // ─────────────────────────── HC-08.7 雙迴路（T09） ───────────────────────────
  {
    id: 'HC-08.7',
    title: String.raw`雙迴路：解特徵式、算 $|z|$，再和 quasi-static 的預測比（T09）`,
    page: '/ch/08',
    formulaId: 'F-08.10',
    formulaTex: String.raw`\begin{aligned}&\mathbf A_{\mathrm{comb}}=\begin{bmatrix}r_s&b_s\\-\mu c_s&1\end{bmatrix},\qquad P(z)=\det(z\mathbf I-\mathbf A_{\mathrm{comb}})=z^2-(1+r_s)\,z+(r_s+\mu b_sc_s)\\[1ex]&|z|=\sqrt{r_s+\mu b_sc_s}\ \ (\Delta<0),\qquad 0<\mu<\frac{1-r_s}{b_sc_s},\qquad g_{\mathrm{eff}}=\mu F(1)=\frac{\mu b_sc_s}{1-r_s}\end{aligned}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'r', symbol: 'r_s', label: '觀測 pole（主迴路每 block 保留的比例）', default: 0.8, min: -2, max: 2, practice: { choices: [0, 0.5, 0.6, 0.8] } },
      { key: 'b', symbol: 'b_s', label: '誤差進入觀測狀態的耦合', default: 0.2, min: -5, max: 5, practice: { choices: [0.1, 0.2, 0.25, 0.5] } },
      { key: 'c', symbol: 'c_s', label: '觀測增益', default: 1, min: -5, max: 5, practice: { choices: [1, 2] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '正規化步長', default: 1.2, min: -10, max: 100, practice: { choices: [0.1, 0.5, 1, 1.2, 2] } },
    ],
    validate: ({ r, b, c, mu }) => {
      const simp = dualLoopSimplifiedMuRange(r, b, c)
      if (simp.empty) {
        if (Math.abs(r) >= 1) return String.raw`${simp.note}。觀測狀態 $s_{k+1}=r_ss_k+\dots$ 自己就不收斂，沒有「穩態 $s=\frac{b_s\delta}{1-r_s}$」可以比較；請選 $|r_s|<1$。`
        if (b * c === 0) return String.raw`$b_sc_s=0$：$\delta$ 完全不影響 $G$（不可觀測），特徵式 $(z-r_s)(z-1)$ 恆有 $z=1$ 的根，任何 $\mu$ 都只是臨界；$\frac{1-r_s}{b_sc_s}$ 也沒有定義。請讓 $b_s$、$c_s$ 都不為零。`
        return String.raw`${dualLoopFullMuRange(r, b, c).note}。等效斜率 $F(1)=\frac{b_sc_s}{1-r_s}<0$，$\mu_{\max}$ 沒有意義；先修正 GMAC 的相關極性（Ch06／Ch07），讓 $b_sc_s>0$。`
      }
      if (mu <= 0) return String.raw`$\mu=${inp(mu)}\le0$：沒有更新（$\mu=0$ 時根是 $r_s$ 與 $1$，臨界）或更新方向相反（$P(1)=\mu b_sc_s<0$，必有實根 $z>1$）。請選 $\mu>0$。`
      return null
    },
    solve: ({ r, b, c, mu }) => {
      const p = { r, b, c, mu }
      const [, a1, a0] = dualLoopCharPoly(p)
      const an = analyzeDualLoop(p)
      const gm = dualLoopGainMargin(p)
      const disc = clean(an.discriminant)
      const bc = b * c
      const muB = mu * bc
      const head: HandCalcStep[] = [
        { tex: String.raw`a_1=-(1+r_s)=-(1+${inpP(r)})=${ex(a1)}`, why: String.raw`特徵式 $z^2+a_1z+a_0$ 的一次項係數＝$-\mathrm{tr}\,\mathbf A_{\mathrm{comb}}$（對角線 $r_s$ 與 $1$ 相加再變號）。` },
        {
          tex: String.raw`a_0=r_s+\mu\,b_s\,c_s=${inp(r)}+${inp(mu)}\times${inpP(b)}\times${inpP(c)}=${inp(r)}+${exP(muB)}=${ex(a0)}`,
          why: String.raw`常數項＝$\det\mathbf A_{\mathrm{comb}}=r_s\times1-b_s\times(-\mu c_s)$：先把 $\mu b_sc_s$ 乘出來，再加 $r_s$。$\mu$ 只出現在這裡：$\mu$ 越大，$a_0$ 越大。`,
        },
        {
          tex: String.raw`\Delta=a_1^2-4a_0=${exP(a1)}^2-4\times${exP(a0)}=${ex(a1 * a1)}-${exP(4 * a0)}=${ex(disc)}`,
          why: String.raw`判別式（也等於 $(1-r_s)^2-4\mu b_sc_s$）：平方、乘 $4$、再相減。$\Delta<0$：共軛複數根；$\Delta\ge0$：兩個實根。`,
        },
      ]
      const tail: HandCalcStep[] = [
        {
          tex: String.raw`\mu_{\max}=\frac{1-r_s}{b_sc_s}=\frac{1-${inpP(r)}}{${inpP(b)}\times${inpP(c)}}=\frac{${ex(1 - r)}}{${ex(bc)}}=${texNum(an.fullRange.hi)}`,
          why: String.raw`完整模型的穩定上界（Jury 條件 $|a_0|<1$；勘誤 E19）。`,
        },
        {
          tex: String.raw`g_{\mathrm{eff}}=\mu F(1)=\frac{\mu\,b_sc_s}{1-r_s}=\frac{${ex(muB)}}{${ex(1 - r)}}=${texNum(gm.gEff)}`,
          why: String.raw`quasi-static 假設觀測瞬間到穩態：GMAC 的等效斜率是 DC 增益 $F(1)=\frac{b_sc_s}{1-r_s}$。注意 $g_{\mathrm{eff}}=\mu/\mu_{\max}$。`,
        },
        {
          tex: String.raw`p_{\mathrm{qs}}=1-g_{\mathrm{eff}}=1-${texNumP(gm.gEff)}=${texNum(clean(an.simplifiedPole))}`,
          why: String.raw`quasi-static 的一階 pole；它只要求 $|p_{\mathrm{qs}}|<1\iff g_{\mathrm{eff}}<2$，比完整模型的 $g_{\mathrm{eff}}<1$ 寬一倍。`,
        },
      ]
      const tailResults: HandCalcResult[] = [
        { symbol: String.raw`\mu_{\max}`, label: '完整模型的步長上界', value: an.fullRange.hi },
        { symbol: String.raw`p_{\mathrm{qs}}`, label: 'quasi-static 預測的 pole', value: clean(an.simplifiedPole), tolerance: NUM_TOL },
      ]
      // quasi-static 的 |p_qs| 與完整模型的 ρ 誰大：直接比較兩個數字，不用「差不多」這種說法
      const pqsAbs = Math.abs(an.simplifiedPole)
      const qsVsFull =
        Math.abs(pqsAbs - an.rho) <= 1e-9
          ? String.raw`$|p_{\mathrm{qs}}|=\rho$，兩者相同`
          : pqsAbs < an.rho
            ? String.raw`$|p_{\mathrm{qs}}|=${texNum(pqsAbs)}<\rho$，比實際樂觀：真正的收斂比它慢`
            : String.raw`$|p_{\mathrm{qs}}|=${texNum(pqsAbs)}>\rho$，比實際保守：真正的收斂比它預測的快`
      const verdict = an.marginal
        ? String.raw`$\rho=1$：完整模型臨界（$\mu=\mu_{\max}$），誤差持續振盪不衰減——不可視為穩定。`
        : an.stable
          ? String.raw`完整模型穩定（$\rho=${texNum(an.rho)}<1$，$\mu<\mu_{\max}$）；quasi-static 預測 pole $${texNum(clean(an.simplifiedPole))}$——${qsVsFull}。`
          : an.simplifiedStable
            ? String.raw`完整模型發散（$\rho=${texNum(an.rho)}>1$），但 quasi-static 預測穩定（$|p_{\mathrm{qs}}|=${texNum(Math.abs(an.simplifiedPole))}<1$）——簡化模型給出相反的結論（T09、勘誤 E19）。`
            : String.raw`完整模型發散（$\rho=${texNum(an.rho)}>1$），quasi-static 也不穩定（$|p_{\mathrm{qs}}|\ge1$）：$\mu$ 太大。`
      const notes = [
        verdict,
        String.raw`quasi-static 的上界是 $\frac{2(1-r_s)}{b_sc_s}=${texNum(an.simplifiedRange.hi)}$，恰為 $\mu_{\max}$ 的 $2$ 倍，而且與 $r_s$ 無關：差異來自觀測路徑內建的一個 block latency。`,
        String.raw`頻域版本（F-08.16）：$\omega_{180}=\arccos\frac{1+r_s}{2}=${texNum(gm.omega180, 4)}$ rad/block，$GM_{\text{完整}}=\frac{1}{g_{\mathrm{eff}}}=${texNum(1 / gm.gEff, 4)}$（$${texNum(clean(gm.gmFullDb), 3)}$ dB），quasi-static 卻以為有 $\frac{2}{g_{\mathrm{eff}}}=${texNum(2 / gm.gEff, 4)}$（$${texNum(clean(gm.gmSimplifiedDb), 3)}$ dB）。`,
      ]
      if (r === 0) notes.push(String.raw`$r_s=0$：特徵式變成 $z^2-z+\mu b_sc_s$，正好是 §8.3 $d=1$ 的延遲模型（$g=\mu b_sc_s$）——和 HC-08.5 是同一題。`)
      if (disc < -DISC_TOL) {
        const top = an.poles.find((z) => z.im > 0) ?? an.poles[0]
        notes.push(String.raw`複數 pole 的門檻是 $\mu=\frac{(1-r_s)^2}{4b_sc_s}=${texNum(an.muComplex, 4)}$；超過之後 $|z|=\sqrt{a_0}$ 只會隨 $\mu$ 變大，「加大 $\mu$ 讓它更快」不再成立。`)
        return {
          steps: [
            ...head,
            { tex: String.raw`\mathrm{Re}\,z=-\frac{a_1}{2}=-\frac{${ex(a1)}}{2}=${texNum(top.re)}`, why: String.raw`共軛根的實部：正好在兩個開迴路 pole（$r_s$ 與 $1$）的正中間 $\frac{1+r_s}{2}$。` },
            {
              tex: String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{\sqrt{${ex(-disc)}}}{2}=\pm\frac{${texNum(Math.sqrt(-disc))}}{2}=\pm${texNum(top.im)}`,
              why: String.raw`虛部分開算：先開根號，再除以 $2$。`,
            },
            {
              tex: String.raw`|z|=\sqrt{a_0}=\sqrt{${ex(a0)}}=${texNum(an.rho)}`,
              why: String.raw`共軛根的模數平方＝常數項（Vieta：$z\bar z=a_0$）。驗算：$\sqrt{${texNum(top.re)}^2+${texNum(top.im)}^2}=\sqrt{${texNum(top.re * top.re + top.im * top.im)}}$。`,
            },
            ...tail,
          ],
          results: [
            { symbol: String.raw`\mathrm{Re}\,z`, label: 'pole 的實部', value: top.re, tolerance: NUM_TOL },
            { symbol: String.raw`\mathrm{Im}\,z`, label: 'pole 的虛部（取正的那個）', value: top.im },
            { symbol: '|z|', label: '模數（spectral radius）', value: an.rho },
            ...tailResults,
          ],
          notes,
        }
      }
      const sq = Math.sqrt(Math.max(0, disc))
      const reals = an.poles.map((z) => z.re).sort((x, y) => y - x)
      const z1 = disc <= DISC_TOL ? -a1 / 2 : reals[0]
      const z2 = disc <= DISC_TOL ? -a1 / 2 : reals[reals.length - 1]
      notes.push(String.raw`$\mu\le\frac{(1-r_s)^2}{4b_sc_s}=${texNum(an.muComplex, 4)}$：兩個實根，一慢（$z_1$）一快（$z_2$）；只有在 $\mu$ 遠小於這個門檻時，慢根才近似 quasi-static 的 $p_{\mathrm{qs}}$。`)
      return {
        steps: [
          ...head,
          { tex: String.raw`\sqrt{\Delta}=\sqrt{${ex(disc)}}=${texNum(sq)}`, why: String.raw`$\Delta\ge0$：兩個實根，先把根號算出來。` },
          { tex: String.raw`z_1=\frac{-a_1+\sqrt\Delta}{2}=\frac{${ex(-a1)}+${texNum(sq)}}{2}=${texNum(z1)}`, why: String.raw`慢根（靠近 $1$）：校正迴路的主要模態。` },
          { tex: String.raw`z_2=\frac{-a_1-\sqrt\Delta}{2}=\frac{${ex(-a1)}-${texNum(sq)}}{2}=${texNum(clean(z2))}`, why: String.raw`快根（靠近 $r_s$）：觀測狀態自己的模態。` },
          {
            tex: String.raw`\rho=\max\big(|z_1|,|z_2|\big)=\max(${texNum(Math.abs(z1))},\,${texNum(Math.abs(clean(z2)))})=${texNum(an.rho)}`,
            why: String.raw`Spectral radius：絕對值最大的根決定收斂速度。`,
          },
          ...tail,
        ],
        results: [
          { symbol: 'z_1', label: '慢根', value: z1, tolerance: NUM_TOL },
          { symbol: 'z_2', label: '快根', value: clean(z2), tolerance: NUM_TOL },
          { symbol: String.raw`\rho`, label: 'Spectral radius', value: an.rho, tolerance: NUM_TOL },
          ...tailResults,
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例（Gallery #5、T09）：$a_1=-1.8$、$a_0=1.04$、$\Delta=-0.92\Rightarrow z=0.9\pm j0.4796$、$|z|=\sqrt{1.04}=1.0198>1$；$\mu_{\max}=1$，但 quasi-static 的 $p_{\mathrm{qs}}=-0.2$ 看起來很穩定。`,
      String.raw`複數運算拆成實部／虛部兩個實數來算就好；$\sqrt{0.92}=0.9592$ 用計算機的 $\sqrt{\ }$ 鍵。`,
      String.raw`最快的判斷法：只算 $a_0=r_s+\mu b_sc_s$。$\Delta<0$ 時 $|z|^2=a_0$，所以 $a_0\ge1$ 就不穩定——不用解根。`,
    ],
  },

  // ─────────────────────────── HC-08.8 綜合：晶片數字 → 穩定裕度 ───────────────────────────
  {
    id: 'HC-08.8',
    title: String.raw`綜合手算：從晶片數字（$\sigma_v$、$\mu$、$d$）到 pole、$\mu$ 上限與裕度`,
    page: '/ch/08',
    formulaId: 'F-08.2',
    formulaTex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad K=K_qC,\qquad g=\mu K,\qquad p=1-g,\qquad \mu_{\max}(d)=\frac{g^{*}(d)}{K},\qquad GM_d=\frac{g^{*}(d)}{g},\qquad PM_d=90^\circ-(2d+1)\arcsin\frac g2`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 0.1, max: 1e5, practice: { choices: [50, 100, 200, 400] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（average GMAC）', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 1e5, practice: { choices: [2, 5, 10, 20, 50, 100] } },
      { key: 'C', symbol: 'C', label: '正規化相關（identity path 時為 1）', default: 1, min: -1, max: 4, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'd', symbol: 'd', label: '更新延遲', unit: String.raw`\text{blocks}`, default: 1, min: 0, max: 6, integer: true, practice: { choices: [0, 1, 2, 3] } },
    ],
    validate: ({ sigmaV, mu, C }) => {
      if (C <= 0) {
        return String.raw`$C=${inp(C)}\le0$：GMAC 的平均斜率 $K=K_qC\le0$，沒有恢復力（$C=0$）或更新極性錯誤（$C<0$，§8.1 的 $M_{\mathrm{polarity}}<0$）。$g=\mu K_qC\le0$ 時 pole $1-g\ge1$，$PM$ 依定義不適用——先修正極性，再談 $\mu$ 要選多大。`
      }
      const kq = comparatorKq(sigmaV)
      const g = mu * kq * C
      if (g > 2) {
        return String.raw`$g=\mu K_qC=${texNum(g)}>2$：連沒有延遲的一階模型都不穩定（pole $1-g<-1$），也沒有 gain crossover，$PM$ 無定義。這組 $\sigma_v$、$C$ 下 $\mu$ 必須小於 $\frac{2}{K_qC}=${texNum(2 / (kq * C))}$ fs。`
      }
      return null
    },
    solve: ({ sigmaV, mu, C, d }) => {
      const kq = comparatorKq(sigmaV)
      const K = kq * C // GMAC 的平均斜率（E13）
      const g = mu * kq * C
      const first = pmFirstOrder(g)
      const pm = pmWithDelay(g, d)
      const gStar = delayCriticalGain(d)
      const halfAngleDeg = (delayCriticalOmega(d) / 2) * RAD2DEG
      const muMax = gStar / (kq * C)
      const gmLin = gStar / g
      const phiDeg = (pm.omegaC / 2) * RAD2DEG
      const m = 2 * d + 1
      return {
        steps: [
          { tex: String.raw`\sqrt{\frac{2}{\pi}}=\sqrt{0.63662}=0.79788`, why: String.raw`1-bit comparator 的常數（Ch05）：先算 $2\div\pi$，再開根號。這個數字值得背：$\approx0.798$。` },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{0.79788}{${inp(sigmaV)}\ \mathrm{fs}}=${texNum(kq)}\ \mathrm{fs}^{-1}`,
            why: String.raw`comparator 在小誤差時的等效斜率 $E[q]\approx K_q\,\delta$（$\delta=a-w$）：雜訊越大，斜率越小。`,
          },
          {
            tex: String.raw`K=K_q\,C=${texNum(kq)}\ \mathrm{fs}^{-1}\times${inp(C)}=${texNum(K)}\ \mathrm{fs}^{-1}`,
            why: String.raw`GMAC 的平均斜率（勘誤 E13 的定義 $K=K_qC$）：$C<1$ 表示 regressor 與誤差的相關打了折扣（Ch06）。`,
          },
          {
            tex: String.raw`g=\mu\,K=${inp(mu)}\ \mathrm{fs}\times${texNum(K)}\ \mathrm{fs}^{-1}=${texNum(g)}`,
            why: String.raw`無因次的 loop gain：$\mathrm{fs}\times\mathrm{fs}^{-1}$ 抵消。`,
          },
          { tex: String.raw`p=1-g=1-${texNum(g)}=${texNum(clean(first.pole))}`, why: String.raw`沒有延遲時的閉迴路 pole（Ch12／T13 的 noise 分析用的就是這個 $p$）。` },
          {
            tex: String.raw`g^{*}(${d})=2\sin\frac{180^\circ}{4\times${d}+2}=2\sin${deg(halfAngleDeg)}=2\times${texNum(gStar / 2)}=${texNum(gStar)}`,
            why: String.raw`$d$ 個 block 更新延遲下的臨界增益：先算角度 $\frac{180^\circ}{4d+2}$，DEG 模式按 $\sin$，再乘 $2$。`,
          },
          {
            tex: String.raw`\mu_{\max}=\frac{g^{*}(${d})}{K}=\frac{${texNum(gStar)}}{${texNum(K)}\ \mathrm{fs}^{-1}}=${texNum(muMax)}\ \mathrm{fs}`,
            why: String.raw`把無因次的上界換回硬體單位：暫存器的 $\mu$ 最大能設到幾 fs。`,
          },
          {
            tex: String.raw`GM_d=\frac{g^{*}}{g}=\frac{${texNum(gStar)}}{${texNum(g)}}=${texNum(gmLin, RATIO_SIG)}`,
            why: String.raw`也等於 $\mu_{\max}/\mu$：$K_q$ 或 $C$ 再變大幾倍才會不穩。（多留一位小數，下一步要取 $\log$。）`,
          },
          {
            tex: String.raw`GM_d\,[\mathrm{dB}]=20\log_{10}(${texNum(gmLin, RATIO_SIG)})=${texNum(clean(pm.gmDb))}\ \mathrm{dB}`,
            why: String.raw`換成 dB：按 $\log$（以 $10$ 為底）再乘 $20$。`,
          },
          {
            tex: String.raw`\varphi=\arcsin\frac g2=\arcsin\frac{${texNum(g)}}{2}=\arcsin(${texNum(g / 2)})=${deg(phiDeg, 6)}`,
            why: String.raw`先把 $g$ 除以 $2$，再用 DEG 模式按 $\sin^{-1}$；$\frac g2\le0.25$ 時可用 $\varphi\approx57.296^\circ\times\frac g2=${deg((g / 2) * RAD2DEG, 4)}$（誤差 $<1.1\%$）。`,
          },
          {
            tex: String.raw`PM_d=90^\circ-(2d+1)\,\varphi=90^\circ-${m}\times${deg(phiDeg, 6)}=90^\circ-${deg(m * phiDeg, 6)}=${deg(pm.pmDeg)}`,
            why: String.raw`含 $d$ 個 block 延遲的 phase margin（F-08.9）：先乘再減。`,
          },
        ],
        results: [
          { symbol: 'g', label: '正規化 loop gain', value: g },
          { symbol: 'p', label: '閉迴路 pole（無延遲）', value: clean(first.pole), tolerance: NUM_TOL },
          { symbol: String.raw`\mu_{\max}`, label: '學習率的穩定上限', value: muMax, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`GM_d`, label: 'Gain margin（以 dB 表示）', value: clean(pm.gmDb), unit: String.raw`\mathrm{dB}`, tolerance: DB_TOL },
          { symbol: String.raw`PM_d`, label: '含延遲的 phase margin', value: clean(pm.pmDeg), unit: String.raw`^\circ`, tolerance: ANGLE_TOL },
        ],
        notes: [
          delayVerdict(g, d),
          String.raw`Delay margin（無延遲時）$=\frac{PM[\mathrm{rad}]}{\omega_c}=${texNum(first.delayMarginBlocks, 4)}$ blocks：$d$ 只要小於它，$PM_d$ 就是正的。`,
          String.raw`$K_q$ 是小誤差線性化（近似｜需驗證）：誤差大時 1-bit comparator 的等效斜率下降，實際裕度比這裡算的大；真正的 sign-LMS 請用 PM Lab 的 Monte Carlo 確認。`,
        ],
      }
    },
    tips: [
      String.raw`範例（入門課 Lesson 4、T13 的設定）：$\sigma_v=100$ fs、$\mu=10$ fs、$C=1\Rightarrow K_q=0.0079788\ \mathrm{fs}^{-1}$、$g=0.079788$、$p=0.92021$；$d=1$ 時 $\mu_{\max}=125.33$ fs（$d=0$ 是 $250.66$ fs、$d=2$ 是 $77.46$ fs）。`,
      String.raw`單位自我檢查：$\mu$ [fs] $\times K_q$ [fs$^{-1}$] 必須得到沒有單位的 $g$；如果你的 $\mu$ 是用 LSB 表示，先乘上 LSB 的大小（fs/LSB）。`,
      String.raw`心算版：$g\ll1$ 時 $\varphi\approx28.65^\circ\times g$，所以 $PM_d\approx90^\circ-(2d+1)\times28.65^\circ\times g$。`,
    ],
  },
]

/** 依 id 取本章的手算題（章內 `<HandCalc def={handcalc('HC-08.1')} />` 用） */
export function handcalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Ch08 找不到手算題 ${id}`)
  return def
}
