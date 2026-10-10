import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import {
  BW,
  F_REF,
  W1,
  eqOffset,
  foldFreq,
  gammaEff,
  gosBeta,
  gosOffsetBias,
  gosSmallBeta,
  kqGain,
  kqOffset,
  loopH,
  loopL,
  loopStable,
  lowFreqReHCoeff,
  makeL1,
  makeL2,
  oneDiffMargin,
  phosLambdaHarmonic,
  phosM1Bounds,
  singleLinePhos,
  toySignLmsStep,
  typeIIFinv,
  typeIIOneDiffG,
  typeIIReL,
  typeIKClosedForm,
  typeILatencyCriterion,
  typeIReH,
} from '@/simulation/models/sspll'

/**
 * 案例頁 /case/sspll 的「帶入手算」題（HC-CS.1 – HC-CS.8）。
 *  1. solve() 的數值一律呼叫 src/simulation/models/sspll.ts 的實際函式（頁面的圖表與表格用的是同一批函式）；
 *     中間量（平方、開根號…）只是把那個函式的算式拆成紙筆做得到的步驟，handcalcs.test.tsx 逐題與獨立重算比對。
 *  2. 每一步的 tex 都是「符號式 = 代入數字 =（中間結果 =）結果」：每個等號只做一種運算（一次函數、一串乘除、或一串加減），
 *     而且畫面上的數字自己就算得出下一個等號；需要 sin／arcsin／erf／exp 的步驟在 why 或 tips 說明怎麼按計算機與手算近似。
 *  3. 預設值就是內文 worked example 的數字（L2：K_p = 0.28771696、K_i = 0.038253471；L1：K = 0.38883636；f_ref = 4000 MHz；
 *     增益取 8 位有效數字，內文印成 0.287717、0.0382535、0.388836），所以答案與內文印出的數字逐位相同。
 *  4. 使用者會打自己的數字，所以顯示要耐得住邊界情況：
 *     - 手算得到 0 的地方就是 0：double 的 1e-16 殘渣（cos(π/2)、0.1 + 0.2 − 0.3…）以 snap()／dec()／decSum() 去掉，
 *       否則 sign(殘渣) 會走到和紙筆相反的方向；
 *     - 兩個接近的數相減（1 + Re L、f_rot − f_inv…）用 sumDecimals()／fixedTex() 把運算元多寫幾位，畫面上的減法才對得起來；
 *     - 要平方的底數用 nb()：負數與科學記號加括號（否則 a×10^{b}^2 是 KaTeX 的 double superscript 錯誤）。
 *     - 輸入值照輸入框的樣子代進去（ni()，不四捨五入成 6 位）；輸入值之間的加減乘照十進位寫（nx()）；
 *     - 角度靠近 π/2 的整數倍時多寫幾位（angleSig()），畫面上的角度按出來才是畫面上的 sin／cos；
 *     - f/f_ref < 10⁻⁵ 時 double 精度下 1 − e^{−jΩ} 的抵消讓 loopL／loopH 不夠準，validate 直接擋掉並說明。
 * 極性：δ = 真值 − 估計；H_PD ≡ 1 時 w ← w + μ q r 為正確方向。頻率以 MHz 輸入，Ω = 2πf/f_ref（rad/sample）。
 *
 * 題目在頁面上的位置（sections/*.tsx 用 common.tsx 的 <Hand id="…" /> 以 id 查表；順序與本陣列相同）：
 * HC-CS.1 → §4.1、HC-CS.2 → §5.2、HC-CS.3 → §6.1、HC-CS.4／HC-CS.5 → §6.2、HC-CS.6 → §11.1、HC-CS.7 → §13、
 * HC-CS.8（綜合）→ §15.3，也就是 §16 思考題之前。
 */

const r = String.raw
const PAGE = '/case/sspll'
const TWO_PI = 2 * Math.PI

/** f_ref [MHz]（本頁設定：4 GHz） */
export const HC_FREF_MHZ = F_REF / 1e6
/**
 * 標稱迴路的增益（§6 的設計結果，取 8 位有效數字；內文印成 K = 0.388836、K_p = 0.287717、K_i = 0.0382535）。
 * 多留兩位是為了讓手算的答案與內文印出的數字逐位相同；handcalcs.test.tsx 會與 nominalLoops() 的設計結果比對。
 */
export const HC_NOMINAL = { K: 0.38883636, Kp: 0.28771696, Ki: 0.038253471 } as const

/** 代入用的數字：預設 6 位有效數字（帶緣要算到 0.01 MHz，5 位不夠） */
const n = (x: number, sig = 6): string => texNum(x, sig)
/** 同上，負數加括號 */
const np = (x: number, sig = 6): string => texNumP(x, sig)
/** 使用者輸入的數字：照輸入框的樣子代進去（最多 10 位有效數字），不四捨五入成 6 位 */
const ni = (x: number): string => texNum(x, 10)
/** 輸入值之間做加、減、乘得到的十進位數（已用 dec() 收到 12 位）：照樣寫出來 */
const nx = (x: number): string => texNum(x, 12)
/** 同上，負數加括號 */
const nxp = (x: number): string => texNumP(x, 12)
/** 當底數用（後面接 ^2）：負數與科學記號（a\times10^{b}、10^{b}）都加括號 */
const nb = (x: number, sig = 6): string => {
  const s = texNum(x, sig)
  return /^-|\\times|\^/.test(s) ? `(${s})` : s
}

/** double 的捨入殘渣（cos(π/2) = 6e-17 之類）視為 0：紙筆與計算機在這裡得到的就是 0 */
const snap = (x: number, eps = 1e-12): number => (Math.abs(x) < eps ? 0 : x)
/** 使用者輸入的十進位數相乘之後，去掉 double 的尾巴（0.30000000000000004 → 0.3）：留 12 位有效數字 */
const dec = (x: number): number => (x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(12)))
/**
 * 十進位數相加減的結果：四捨五入到「最大的運算元的第 13 位」（絕對位置）。
 * 相減抵消之後剩下的小數（1 − 0.99999928 = 7.2e-7）也不會留下 double 的尾巴；剛好抵消時得到真正的 0。
 */
function decSum(x: number, ...terms: number[]): number {
  const m = Math.max(...terms.map((t) => Math.abs(t)))
  if (!(m > 0) || !Number.isFinite(x)) return x
  return Number(x.toFixed(Math.min(30, Math.max(0, 13 - Math.ceil(Math.log10(m))))))
}

/**
 * 加減法要顯示到小數第幾位：讓結果有 sig 位有效數字（結果是 0 時改看最大的運算元），介於 0 與 15 之間。
 * 兩個接近的數相減時，結果的前幾位抵消，運算元就要多寫幾位，畫面上的數字才加得出畫面上的結果。
 */
function sumDecimals(result: number, terms: number[], sig = 6): number {
  const ref = result !== 0 ? Math.abs(result) : Math.max(...terms.map((t) => Math.abs(t)))
  if (!(ref > 0) || !Number.isFinite(ref)) return 0
  return Math.min(15, Math.max(0, sig - 1 - Math.floor(Math.log10(ref))))
}
/**
 * 加減法的運算元：寫到小數第 p 位（至少和平常的 6 位有效數字一樣多；去尾零、不用科學記號）；負數加括號。
 * 本身就很小（要超過 12 位小數才看得到 6 位有效數字）或很大（≥ 10⁶）的數改用科學記號，不寫一長串 0。
 */
function fixedTex(x: number, p: number, paren = true): string {
  const own = sumDecimals(x, [x])
  if (own > 12 || Math.abs(x) >= 1e6) return paren ? np(x) : n(x)
  let s = x.toFixed(Math.max(p, own))
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  return paren && s.startsWith('-') ? `(${s})` : s
}

/**
 * 角度要顯示幾位有效數字：角度靠近 π/2 的整數倍時，sin 或 cos 接近 0，角度的捨入會被放大
 * （條件數 |θ·cosθ/sinθ|、|θ·sinθ/cosθ|）；放大超過 3 倍就多寫幾位，畫面上的角度按出來才是畫面上的函數值。
 * 剛好是 0 的那一個（特殊角）不算，另外在 why 說明。
 */
function angleSig(th: number, useSin = true, useCos = true): number {
  const sn = Math.sin(th)
  const cs = Math.cos(th)
  const cond = Math.max(useSin && Math.abs(sn) > 1e-12 ? Math.abs((th * cs) / sn) : 0, useCos && Math.abs(cs) > 1e-12 ? Math.abs((th * sn) / cs) : 0)
  return Math.min(12, 6 + Math.max(0, Math.ceil(Math.log10(Math.max(cond / 3, 1)))))
}

/** 近似值與精確值的比較（中文 + `$...$`）：同號時比大小，異號時直接說符號不同 */
function compareText(approx: number, exact: number): string {
  if (!Number.isFinite(approx) || !Number.isFinite(exact) || exact === 0) return '無法比較（精確值為 0）'
  if (approx === 0) return '近似值剛好是 0，符號要看精確值'
  if (Math.sign(approx) !== Math.sign(exact)) return '連符號都不同'
  const p = (100 * (Math.abs(approx) - Math.abs(exact))) / Math.abs(exact)
  return `大小${p >= 0 ? '高估' : '低估'}了 $${texNum(Math.abs(p), 3)}\\%$`
}

/** (approx − exact)/|exact| 的百分比（TeX）；exact = 0 時回傳 null */
function pctTex(approx: number, exact: number): string | null {
  if (exact === 0 || !Number.isFinite(exact) || !Number.isFinite(approx)) return null
  const p = (100 * (approx - exact)) / Math.abs(exact)
  return `${p >= 0 ? '+' : ''}${texNum(p, 3)}\\%`
}

/** 1 拍延遲的 Type-II（P + I）迴路是否可用；不可用時回傳原因 */
function typeIIProblem(Kp: number, Ki: number): string | null {
  if (!(Kp > 0)) return r`$K_p$ 必須大於 0：只有雙積分器、沒有比例路徑的迴路不穩定（極點落在單位圓上或圓外）。`
  if (!(Ki > 0)) return r`$K_i$ 必須大於 0：$K_i=0$ 就不是 Type-II 了（沒有雙積分器，也沒有從 DC 開始的反號帶）；Type-I 請用 HC-CS.3。`
  if (!loopStable(makeL2({ Kp, Ki })))
    return r`主迴路不穩定：1 拍延遲的 Type-II 迴路需要 $0<K_p<2$ 且 $K_p+\tfrac{K_i}{2}<2$（特徵方程式 $z^2-(2-K_p-K_i)z+(1-K_p)=0$ 的根要在單位圓內）；這裡 $K_p+\tfrac{K_i}{2}=${texNum(Kp + Ki / 2)}$。先修 PLL 本身，再談 LMS 的極性。`
  return null
}

/** 頻率是否落在 (0, f_ref/2]；否則回傳原因 */
function freqProblem(f: number, fref: number): string | null {
  if (!(fref > 0)) return r`$f_{ref}$ 必須大於 0。`
  if (!(f > 0)) return r`$f$ 必須大於 0：$f=0$ 時 $L\to\infty$、$H_{PD}=0$（DC 誤差被迴路完全吸收），沒有東西可算。`
  if (f > fref / 2) return r`$f$ 不能超過 $f_{ref}/2=${texNum(fref / 2)}$ MHz：每個 $T_{ref}$ 只取樣一次，更高的頻率會折回來（請先換成 $f_{ref}-f$）。`
  if (f < 1e-5 * fref)
    return r`$f$ 太低（$f/f_{ref}<10^{-5}$，也就是 $f<${texNum(1e-5 * fref, 3)}$ MHz）：這裡 $\lvert L\rvert$ 已經大到 $H_{PD}$ 幾乎是 0，而且 $1-e^{-j\Omega}$ 是兩個幾乎相等的數相減，double 精度下模型算出的 $L$ 有效位數越來越少（$f/f_{ref}=10^{-7}$ 時只剩約 5 位），沒辦法和手算逐位比對。請用 $f\ge${texNum(1e-5 * fref, 3)}$ MHz。`
  return null
}

// ── 範例數字（tips 用）：全部由 sspll.ts 的函式算出，不手寫 ──────────────────────────────
const EX = (() => {
  const { Kp, Ki } = HC_NOMINAL
  const W3 = (TWO_PI * BW) / F_REF
  const c = 2 - Math.cos(W3)
  const K = typeIKClosedForm()
  const ratio = Ki / (2 * (2 - Kp))
  const s8 = Math.sin(Math.PI / 8)
  return {
    W3,
    c,
    K,
    ratio,
    root: Math.sqrt(ratio),
    asin: Math.PI * typeIIFinv(Kp, Ki),
    finv: typeIIFinv(Kp, Ki) * HC_FREF_MHZ,
    reH20: loopH(makeL2({ Kp, Ki }), 20 / HC_FREF_MHZ).re,
    s8,
    nearGridBias: gosOffsetBias(0.0803 / 12, 0.496, 25, 200),
  }
})()

export const HANDCALCS: HandCalcDef[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.1',
    title: 'sign-error LMS 走四步：迴路把殘差「反相」之後會怎樣',
    page: PAGE,
    formulaTex: r`e_n=g\,(a-w_n)\,x,\qquad q_n=\mathrm{sign}(e_n),\qquad w_{n+1}=w_n+\mu\,q_n\,x`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真值（黑盒子裡的數，LMS 不知道）', default: 1, min: -10, max: 10, practice: { choices: [-1, 1, 2] } },
      { key: 'w0', symbol: 'w_0', label: '一開始的估計', default: 0, min: -10, max: 10, practice: { choices: [-0.5, 0, 0.5] } },
      { key: 'mu', symbol: r`\mu`, label: '步長', default: 0.1, min: 0, max: 2, practice: { choices: [0.05, 0.1, 0.2, 0.25] } },
      { key: 'x', symbol: 'x', label: 'regressor', default: 1, min: -4, max: 4, practice: { choices: [-1, 1, 2] } },
      { key: 'g', symbol: 'g', label: r`迴路的作用：PD 看到 $g\times$ 誤差（玩具版的 $\mathrm{Re}\,H_{PD}$）`, default: -0.2, min: -2, max: 2, practice: { choices: [-1, -0.2, 0.5, 1] } },
    ],
    validate: ({ mu, x, g }) => {
      if (x === 0) return r`$x=0$：regressor 是 0，$w$ 完全不動，比較器也看不到 $a$（不可觀測）。請換一個非零的 $x$。`
      if (g === 0) return r`$g=0$：PD 完全看不到誤差（$e\equiv0$），$q$ 與 $a$ 無關——這是 dead zone，既不是收斂也不是反號。請換一個非零的 $g$。`
      if (!(mu > 0)) return r`$\mu=0$ 時權重不會更新。請給一個正的步長。`
      return null
    },
    solve: ({ a, w0, mu, x, g }) => {
      const steps: HandCalcStep[] = []
      const ws = [w0]
      let w = w0
      for (let i = 0; i < 4; i++) {
        // w 每一步都收回十進位（decSum）：0.1 + 0.2 在 double 裡是 0.30000000000000004，直接拿去算 a − w 會得到 −5.6e-17 而不是 0，
        // sign 就和紙筆相反。toySignLmsStep 本身不變，§4.1 的表格用的是同一個函式；畫面上的 e 用收回十進位的 a − w 重乘一次（同號）。
        const s = toySignLmsStep(w, a, x, mu, g)
        const diff = decSum(a - w, a, w)
        const dw = dec(mu * s.q * x)
        const wNext = decSum(s.w, w, dw)
        const qTex = s.q > 0 ? '+1' : '-1'
        steps.push({
          tex: r`e_${i}=g\,(a-w_${i})\,x=${nxp(g)}\times(${nx(a)}-${nxp(w)})\times${nxp(x)}=${nxp(g)}\times${nxp(diff)}\times${nxp(x)}=${nx(dec(g * diff * x))}`,
          why: i === 0 ? r`PD 看到的殘差：真正的誤差 $(a-w)x$ 先被迴路乘上 $g$。先做括號裡的減法，再連乘。` : r`用新的 $w_${i}$ 再算一次殘差。`,
        })
        steps.push({
          tex: r`w_${i + 1}=w_${i}+\mu\,q_${i}\,x=${nx(w)}+${nx(mu)}\times(${qTex})\times${nxp(x)}=${nx(w)}+${nxp(dw)}=${nx(wNext)}`,
          why:
            i === 0
              ? r`比較器只留下符號 $q_0=\mathrm{sign}(e_0)=${qTex}$（$e=0$ 時取 $+1$），照 sign-error LMS 更新：先乘出修正量 $\mu\,q\,x$，再加到 $w$ 上。步幅固定是 $\mu\lvert x\rvert$，方向由 $q\,x$ 決定。`
              : r`$q_${i}=\mathrm{sign}(e_${i})=${qTex}$${s.e === 0 ? r`（$e_${i}=0$ 時取 $+1$）` : ''}。`,
        })
        w = wNext
        ws.push(w)
      }
      const delta4 = decSum(a - ws[4], a, ws[4])
      steps.push({
        tex: r`\delta_4=a-w_4=${nx(a)}-${nxp(ws[4])}=${nx(delta4)}`,
        why: r`還差多少：$\delta=$ 真值 $-$ 估計（全站的極性約定）。和一開始的 $\delta_0=a-w_0=${nx(decSum(a - w0, a, w0))}$ 比，$\lvert\delta\rvert$ 變小才是收斂。`,
      })
      const d0 = Math.abs(decSum(a - w0, a, w0))
      const d4 = Math.abs(delta4)
      return {
        steps,
        results: [
          { symbol: 'w_1', label: '第 1 步之後', value: ws[1], tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: 'w_4', label: '第 4 步之後', value: ws[4], tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: r`\delta_4=a-w_4`, label: '還差多少（真值 − 估計）', value: delta4, tolerance: { abs: 1e-6, rel: 0.01 } },
        ],
        notes: [
          g < 0
            ? r`$g<0$：每一步 $q$ 都把 $w$ 推離 $a$，$\lvert a-w\rvert$ 由 $${nx(d0)}$ 變成 $${nx(d4)}$。離得越遠 $q$ 越肯定，所以會一直走下去——這就是「反號、不收斂」。`
            : r`$g>0$：每一步都朝 $a$ 的方向走 $\mu\lvert x\rvert=${nx(dec(mu * Math.abs(x)))}$（步幅固定，和誤差的大小無關），$\lvert a-w\rvert$ 由 $${nx(d0)}$ 變成 $${nx(d4)}$；走到 $a$ 附近之後不會停下來，而是跨過去再走回來，在 $\pm\mu\lvert x\rvert$ 內來回（sign-LMS 的 limit cycle）。`,
          r`把 $\lvert g\rvert$ 換成別的大小（符號不變），$w$ 的軌跡完全一樣：1-bit 比較器只看符號。把 $\mu$ 縮小也只是用更慢的速度走同一個方向。`,
        ],
      }
    },
    tips: [
      r`每一步只有一次減法、兩次乘法，再判斷正負號；$e=0$ 時比較器輸出取 $+1$。`,
      r`範例數字（$a=1,\ w_0=0,\ \mu=0.1,\ x=1,\ g=-0.2$）就是 §4.1 表格的情況 B：$w=0,\,-0.1,\,-0.2,\,-0.3,\,-0.4$；把 $g$ 改成 $+1$ 就是情況 A。`,
      r`真正的迴路裡，$g$ 對應 regressor 所在頻率的 $\mathrm{Re}\,H_{PD}$（regressor 有很多條譜線時是功率加權平均，§4.3）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.2',
    title: r`Type-II 的低頻近似：$\mathrm{Re}\,H_{PD}\approx-\Omega^2/K_i$`,
    page: PAGE,
    formulaId: 'F-CS.5',
    formulaTex: r`\Omega=\frac{2\pi f}{f_{ref}},\qquad H_{PD}\approx\frac{1}{L}\approx-\frac{4\sin^2(\Omega/2)}{K_i}\approx-\frac{\Omega^2}{K_i}\qquad(f\ll f_{inv})`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'f', symbol: 'f', label: '要看的頻率（例如 PMUX 的旋轉頻率）', unit: r`\mathrm{MHz}`, default: 20, min: 0, max: 1e5, practice: { choices: [5, 10, 20, 40] } },
      { key: 'fref', symbol: 'f_{ref}', label: 'reference 頻率', unit: r`\mathrm{MHz}`, default: HC_FREF_MHZ, min: 1, max: 1e5 },
      { key: 'Ki', symbol: 'K_i', label: '積分增益（每 sample）', default: HC_NOMINAL.Ki, min: 0, max: 4, practice: { choices: [0.02, 0.04, 0.05, 0.08] } },
      { key: 'Kp', symbol: 'K_p', label: '比例增益（只用來算帶緣與精確值）', default: HC_NOMINAL.Kp, min: 0, max: 2, practice: { choices: [0.25, 0.3, 0.4, 0.5] } },
    ],
    validate: ({ f, fref, Ki, Kp }) => {
      const bad = typeIIProblem(Kp, Ki) ?? freqProblem(f, fref)
      if (bad) return bad
      const finv = typeIIFinv(Kp, Ki) * fref
      if (f >= finv)
        return r`$f=${texNum(f)}$ MHz 已經超過反號帶上緣 $f_{inv}=${texNum(finv, 6)}$ MHz（HC-CS.4）：那裡真正的 $\mathrm{Re}\,H_{PD}$ 是正的，而 $-\Omega^2/K_i$ 永遠是負的，連符號都不對。低頻近似只適用 $f\ll f_{inv}$。`
      return null
    },
    solve: ({ f, fref, Ki, Kp }) => {
      const loop = makeL2({ Kp, Ki })
      const fn = f / fref
      const W = TWO_PI * fn
      const approx = -W * W * lowFreqReHCoeff(loop) // −Ω²/K_i
      const sHalf = Math.sin(W / 2)
      const approxSin = 1 / typeIIReL(0, Ki, fn) // 1/(雙積分器那一項) = −4 sin²(Ω/2)/K_i
      const exact = loopH(loop, fn).re
      const finv = typeIIFinv(Kp, Ki) * fref
      return {
        steps: [
          { tex: r`\Omega=\frac{2\pi f}{f_{ref}}=\frac{2\pi\times${ni(f)}}{${ni(fref)}}=${n(W)}`, why: r`把頻率換成每個 sample 轉過的弧度（rad/sample）：計算機按 $2\times\pi\times f\div f_{ref}$。` },
          { tex: r`\Omega^2=${nb(W)}^2=${n(W * W)}`, why: '平方。' },
          { tex: r`-\frac{\Omega^2}{K_i}=-\frac{${n(W * W)}}{${ni(Ki)}}=${n(approx)}`, why: r`低頻時 PD 看到的是誤差的二次微分除以 $K_i$；這個負號就是反號的來源。` },
          {
            tex: r`\sin\frac{\Omega}{2}=\sin\frac{${n(W)}}{2}=\sin(${n(W / 2)})=${n(sHalf)}`,
            why: r`先把 $\Omega$ 除以 2，計算機切到 RAD（弧度）再按 sin。小角度可以手算：$\sin x\approx x-\tfrac{x^3}{6}$，$\lvert x\rvert\le0.2$ 時誤差小於 $3\times10^{-6}$。`,
          },
          { tex: r`\sin^2\frac{\Omega}{2}=${nb(sHalf)}^2=${n(sHalf * sHalf)}`, why: '平方。' },
          {
            tex: r`-\frac{4\sin^2(\Omega/2)}{K_i}=-\frac{4\times${n(sHalf * sHalf)}}{${ni(Ki)}}=${n(approxSin)}`,
            why: r`不做 $\sin x\approx x$ 的版本（$1/L$ 只留雙積分器那一項）：乘 4、再除以 $K_i$。和第 3 步的差距，就是「小角度」這個近似用掉的誤差。`,
          },
        ],
        results: [
          { symbol: r`\Omega`, label: '離散頻率', value: W, unit: r`\mathrm{rad/sample}`, digits: 6 },
          { symbol: r`-\Omega^2/K_i`, label: r`低頻近似的 $\mathrm{Re}\,H_{PD}$`, value: approx, digits: 6 },
          { symbol: r`-4\sin^2(\Omega/2)/K_i`, label: '不做小角度近似的版本', value: approxSin, digits: 6 },
        ],
        notes: [
          r`sspll.ts 的精確值（loopH）：$\mathrm{Re}\,H_{PD}=${n(exact)}$；$-\Omega^2/K_i$ 的${compareText(approx, exact)}。`,
          r`這組增益的反號帶上緣是 $f_{inv}=${n(finv)}$ MHz（HC-CS.4），$f/f_{inv}=${texNum(f / finv, 3)}$。越接近帶緣近似越差：被丟掉的是比例路徑（$K_p$）與 $1+L\approx L$ 這兩件事。`,
        ],
      }
    },
    tips: [
      r`全程用 RAD（弧度）模式。$\pi$ 用計算機的 $\pi$ 鍵，不要只取 3.14。`,
      r`範例數字（$f=20$ MHz、L2 的 $K_i$）對應 §5.2 的表：精確值 $${texNum(EX.reH20, 5)}$，漸近式 $-\Omega^2/K_i$ 略為高估。`,
      r`想看近似失效的樣子：把 $f$ 調到接近 $f_{inv}$，誤差會迅速變大；超過 $f_{inv}$ 這題會拒絕計算並說明原因。精確的算法見 HC-CS.5。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.3',
    title: r`Type-I（延遲 $d$ 拍）：判據 $K(d-\tfrac12)$ 與 $\mathrm{Re}\,H_{PD}(f)$`,
    page: PAGE,
    formulaId: 'F-CS.10',
    formulaTex: r`\begin{gathered}L=\frac{Kz^{-d}}{1-z^{-1}}:\quad \mathrm{Re}\,L=-\frac{K\sin\theta}{2\sin(\Omega/2)},\quad \mathrm{Im}\,L=-\frac{K\cos\theta}{2\sin(\Omega/2)},\quad \theta=\big(d-\tfrac12\big)\Omega\\[4pt]\mathrm{Re}\,H_{PD}=\frac{1+\mathrm{Re}\,L}{(1+\mathrm{Re}\,L)^2+(\mathrm{Im}\,L)^2}\approx\frac{\Omega^2}{K^2}\Big[1-K\big(d-\tfrac12\big)\Big]\quad(\Omega\ll K)\end{gathered}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'K', symbol: 'K', label: '迴路增益（每 sample）', default: HC_NOMINAL.K, min: 0, max: 2, practice: { choices: [0.2, 0.25, 0.3, 0.45, 0.5] } },
      { key: 'd', symbol: 'd', label: '迴路延遲（拍；本文標稱 1）', default: 1, min: 1, max: 8, integer: true, practice: { choices: [1, 2, 3] } },
      { key: 'f', symbol: 'f', label: '要看的頻率', unit: r`\mathrm{MHz}`, default: 20, min: 0, max: 1e5, practice: { choices: [10, 20, 40, 50, 100] } },
      { key: 'fref', symbol: 'f_{ref}', label: 'reference 頻率', unit: r`\mathrm{MHz}`, default: HC_FREF_MHZ, min: 1, max: 1e5 },
    ],
    validate: ({ K, d, f, fref }) => {
      if (!(K > 0)) return r`$K$ 必須大於 0（$K=0$ 沒有迴路）。`
      const bad = freqProblem(f, fref)
      if (bad) return bad
      if (!loopStable(makeL1({ K, lat: d })))
        return r`主迴路不穩定：延遲 $d=${d}$ 拍時 $K$ 必須小於 $2\sin\frac{\pi}{2(2d-1)}=${texNum(2 * Math.sin(Math.PI / (2 * (2 * d - 1))))}$（$L=-1$ 的臨界增益）。先修 PLL 本身，再談 LMS 的極性。`
      return null
    },
    solve: ({ K, d, f, fref }) => {
      const loop = makeL1({ K, lat: d })
      const fn = f / fref
      const W = TWO_PI * fn
      const crit = typeILatencyCriterion(K, d)
      const wk = W / K
      const ratio = wk * wk
      const oneMinus = decSum(1 - crit, 1, crit)
      const approx = ratio * oneMinus
      const sHalf = Math.sin(W / 2)
      const th = (d - 0.5) * W
      // Ω = π（f = f_ref/2）等特殊角：sin／cos 的 1e-16 殘渣視為 0（紙筆與計算機得到的就是 0）
      const sinT = snap(Math.sin(th))
      const cosT = snap(Math.cos(th))
      const L = loopL(loop, fn)
      const reL = snap(L.re)
      const imL = snap(L.im)
      const onePlus = snap(1 + reL, 1e-9) // 離 −1 不到 10⁻⁹：當成剛好在邊界上
      const den = onePlus * onePlus + imL * imL
      const reH = onePlus === 0 ? 0 : loopH(loop, fn).re
      const pCrit = sumDecimals(oneMinus, [1, crit])
      const pOne = sumDecimals(onePlus, [1, reL])
      const lostDigits = pOne - sumDecimals(reL, [reL]) >= 2 && fixedTex(reL, pOne) !== np(reL)
      const thSig = angleSig(th)
      const exactZero = r`這個 $\theta$ 剛好是 $\tfrac{\pi}{2}$ 的整數倍，精確值是 0；拿四捨五入後的 $${n(th, thSig)}$ 去按計算機會得到很小但不是 0 的數，那只是角度四捨五入的誤差。`
      const steps: HandCalcStep[] = [
        {
          tex: r`K\big(d-\tfrac12\big)=${ni(K)}\times(${d}-0.5)=${ni(K)}\times${n(d - 0.5)}=${n(crit)}`,
          why: r`延遲判據：$\mathrm{Re}\,L\ge-K(d-\tfrac12)$，所以這個數要 $>1$ 才可能有 $\mathrm{Re}\,L<-1$（反號）。`,
        },
        { tex: r`\Omega=\frac{2\pi f}{f_{ref}}=\frac{2\pi\times${ni(f)}}{${ni(fref)}}=${n(W)}`, why: '頻率換成 rad/sample。' },
        {
          tex: r`\frac{\Omega^2}{K^2}=\Big(\frac{\Omega}{K}\Big)^2=\Big(\frac{${n(W)}}{${ni(K)}}\Big)^2=${nb(wk)}^2=${n(ratio)}`,
          why: r`低頻近似的大小：先除、再平方。它要求 $\Omega/K\ll1$。`,
        },
        {
          tex: r`\mathrm{Re}\,H_{PD}\approx\frac{\Omega^2}{K^2}\Big[1-K\big(d-\tfrac12\big)\Big]=${n(ratio)}\times(1-${fixedTex(crit, pCrit, false)})=${n(ratio)}\times${np(oneMinus)}=${n(approx)}`,
          why: '低頻近似（F-CS.6）：先算方括號，再相乘。符號只由方括號決定。',
        },
        {
          tex: r`\sin\frac{\Omega}{2}=\sin\frac{${n(W)}}{2}=\sin(${n(W / 2)})=${n(sHalf)}`,
          why: r`接下來算精確值。先把 $\Omega$ 除以 2，RAD 模式按 sin；小角度可用 $\sin x\approx x-\tfrac{x^3}{6}$（$\lvert x\rvert\le0.2$ 時誤差小於 $3\times10^{-6}$）。`,
        },
        {
          tex: r`\theta=\big(d-\tfrac12\big)\Omega=${n(d - 0.5)}\times${n(W, thSig)}=${n(th, thSig)}`,
          why:
            r`$z^{-d}/(1-z^{-1})=e^{-j\theta}/(2j\sin\frac{\Omega}{2})$：延遲把相位多轉了 $\theta$（rad）。` +
            (thSig > 6 ? r`這個角度靠近 $\tfrac{\pi}{2}$ 的整數倍，$\sin$ 或 $\cos$ 接近 0，角度的捨入會被放大，所以多寫幾位。` : ''),
        },
        {
          tex: r`\sin\theta=\sin(${n(th, thSig)})=${n(sinT)}`,
          why: (d === 1 ? r`RAD 模式按 sin。$d=1$ 時 $\theta=\Omega/2$，就是第 5 步的數字。` : 'RAD 模式按 sin。') + (sinT === 0 ? exactZero : ''),
        },
        {
          tex: r`\cos\theta=\cos(${n(th, thSig)})=${n(cosT)}`,
          why: r`同一個角度再按一次 cos。小角度可以手算：$\cos x\approx1-\tfrac{x^2}{2}$，$\lvert x\rvert\le0.2$ 時誤差小於 $7\times10^{-5}$。` + (cosT === 0 ? exactZero : ''),
        },
        {
          tex: r`\mathrm{Re}\,L=-\frac{K\sin\theta}{2\sin(\Omega/2)}=-\frac{${ni(K)}\times${np(sinT)}}{2\times${n(sHalf)}}=${n(reL)}`,
          why: d === 1 ? r`$d=1$ 時 $\theta=\Omega/2$，所以 $\mathrm{Re}\,L$ 恆為 $-K/2$：含 1 拍延遲的積分器，實部永遠是 $-\tfrac12$。` : r`$\Omega\to0$ 時趨近 $-K(d-\tfrac12)$，就是第 1 步的判據。`,
        },
        { tex: r`\mathrm{Im}\,L=-\frac{K\cos\theta}{2\sin(\Omega/2)}=-\frac{${ni(K)}\times${np(cosT)}}{2\times${n(sHalf)}}=${n(imL)}`, why: '低頻時虛部很大（積分器），但它不決定符號。' },
        {
          tex: r`1+\mathrm{Re}\,L=1+${fixedTex(reL, pOne)}=${n(onePlus)}`,
          why: lostDigits
            ? r`它的符號就是 $\mathrm{Re}\,H_{PD}$ 的符號。這裡把 $\mathrm{Re}\,L$ 多寫了幾位：兩個很接近的數相減，前面的位數會抵消，手算時第 9 步的結果不要先四捨五入。`
            : r`它的符號就是 $\mathrm{Re}\,H_{PD}$ 的符號。`,
        },
        {
          tex: r`\lvert1+L\rvert^2=(1+\mathrm{Re}\,L)^2+(\mathrm{Im}\,L)^2=${nb(onePlus)}^2+${nb(imL)}^2=${n(onePlus * onePlus)}+${n(imL * imL)}=${n(den)}`,
          why: '複數的模平方：實部、虛部分開平方，再相加。',
        },
        {
          tex: r`\mathrm{Re}\,H_{PD}=\frac{1+\mathrm{Re}\,L}{\lvert1+L\rvert^2}=\frac{${n(onePlus)}}{${n(den)}}=${n(reH)}`,
          why: r`$H_{PD}=\frac{1}{1+L}=\frac{\overline{1+L}}{\lvert1+L\rvert^2}$，實部的分子是 $1+\mathrm{Re}\,L$。`,
        },
      ]
      if (d === 1) {
        // 驗算：d = 1 的 closed form（F-CS.7），拆成分子、分母、相除三步
        const s2 = sHalf * sHalf
        const num = (2 - K) * 2 * s2
        const den1 = K * K + 4 * (1 - K) * s2
        const pDen = sumDecimals(den1, [K * K, 4 * (1 - K) * s2]) // K > 1 時第二項是負的：兩項相減
        // 相減抵消掉的位數要由 sin²(Ω/2) 補回來：它（以及它的底數）在這兩步多寫幾位
        const wide = pDen + 1 > sumDecimals(s2, [s2])
        const s2Tex = wide ? fixedTex(s2, pDen + 1, false) : n(s2)
        const sHalfTex = wide ? fixedTex(sHalf, pDen + 2, false) : nb(sHalf)
        steps.push(
          {
            tex: r`(2-K)(1-\cos\Omega)=(2-K)\cdot2\sin^2\frac{\Omega}{2}=(2-${ni(K)})\times2\times${sHalfTex}^2=${n(2 - K)}\times2\times${s2Tex}=${n(num)}`,
            why: r`驗算用 $d=1$ 的 closed form（F-CS.7），先算分子：括號的減法與 $\sin\frac{\Omega}{2}$（第 5 步）的平方，再連乘。把 $1-\cos\Omega$ 寫成 $2\sin^2\frac{\Omega}{2}$（半角公式），避免兩個很接近的數相減。`,
          },
          {
            tex: r`\lvert1-(1-K)e^{-j\Omega}\rvert^2=K^2+4(1-K)\sin^2\frac{\Omega}{2}=${nb(K, 10)}^2+4\times(1-${ni(K)})\times${s2Tex}=${fixedTex(K * K, pDen, false)}+${fixedTex(4 * (1 - K) * s2, pDen)}=${n(den1)}`,
            why: r`分母：$\lvert1-ae^{-j\Omega}\rvert^2=1-2a\cos\Omega+a^2=(1-a)^2+4a\sin^2\frac{\Omega}{2}$，這裡 $a=1-K$。$\sin^2\frac{\Omega}{2}$ 用上一步平方出來的數；兩項各自算完再相加。`,
          },
          {
            tex: r`\mathrm{Re}\,H_{PD}=\frac{(2-K)(1-\cos\Omega)}{\lvert1-(1-K)e^{-j\Omega}\rvert^2}=\frac{${n(num)}}{${n(den1)}}=${n(typeIReH(K, fn))}`,
            why: r`相除。結果應該和第 13 步（實部、虛部分開算）相同：$0<K<2$ 時分子、分母都是正的，所以 L1 的 $\mathrm{Re}\,H_{PD}\ge0$。`,
          },
        )
      }
      return {
        steps,
        results: [
          { symbol: r`K(d-\tfrac12)`, label: r`延遲判據（$>1$ 才有反號帶）`, value: crit, digits: 6 },
          { symbol: r`\tfrac{\Omega^2}{K^2}\big[1-K(d-\tfrac12)\big]`, label: r`低頻近似的 $\mathrm{Re}\,H_{PD}$`, value: approx, digits: 6, tolerance: { rel: 0.02, abs: 1e-6 } },
          { symbol: r`\mathrm{Re}\,H_{PD}`, label: '精確值', value: reH, digits: 6, tolerance: { rel: 0.02, abs: 1e-6 } },
        ],
        notes: [
          crit > 1
            ? r`$K(d-\tfrac12)=${n(crit)}>1$：$\Omega\to0$ 時 $\mathrm{Re}\,L\to-K(d-\tfrac12)<-1$，這個 Type-I 迴路有一條從 DC 開始的反號帶——Type-I 不是天生免疫。`
            : crit < 1
              ? r`$K(d-\tfrac12)=${n(crit)}<1$：對任何頻率 $\mathrm{Re}\,L\ge-K(d-\tfrac12)>-1$，所以 $\mathrm{Re}\,H_{PD}>0$——這個 Type-I 迴路沒有反號帶。`
              : r`$K(d-\tfrac12)=1$：剛好在臨界點，低頻近似給 0，符號要看更高階的項（精確值）。`,
          r`低頻近似和精確值相比：${compareText(approx, reH)}（$\Omega/K=${texNum(W / K, 3)}$；近似要求它遠小於 1）。精確值就是 sspll.ts 的 loopH。`,
        ],
      }
    },
    tips: [
      r`RAD 模式。$d=1$ 時 $\theta=\Omega/2$，$\sin\theta$ 與分母的 $\sin\frac{\Omega}{2}$ 相消，$\mathrm{Re}\,L=-K/2$ 不必按計算機。畫面上每個數字只顯示 6 位有效數字；中間結果留在計算機裡連續算，你的最後一位可能和畫面差 1。`,
      r`L1 的 $K$ 怎麼來（1 拍延遲、$\lvert T\rvert$ 的 $-3$ dB 在 320 MHz）：$\Omega_3=2\pi\cdot320/4000=${texNum(EX.W3, 6)}$，$c=2-\cos\Omega_3=${texNum(EX.c, 6)}$，$1-K=c-\sqrt{c^2-1}=${texNum(1 - EX.K, 6)}$，所以 $K=${texNum(EX.K, 6)}$（F-CS.7）。`,
      r`把 §6.1 表格的其他列填進來（它們都重新調到 320 MHz）：$d=5$ 那一列的判據超過 1，低頻的 $\mathrm{Re}\,H_{PD}$ 會變成負的。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.4',
    title: r`Type-II 反號帶的上緣 $f_{inv}$`,
    page: PAGE,
    formulaId: 'F-CS.8',
    formulaTex: r`\begin{gathered}\mathrm{Re}\,L_2=-\frac{K_p}{2}-\frac{K_i}{4\sin^2(\Omega/2)}<-1\iff\sin^2\frac{\Omega}{2}<\frac{K_i}{2(2-K_p)}\\[4pt]f_{inv}=\frac{f_{ref}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}}\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'Kp', symbol: 'K_p', label: '比例增益（每 sample）', default: HC_NOMINAL.Kp, min: 0, max: 2, practice: { choices: [0.2, 0.25, 0.3, 0.4, 0.5] } },
      { key: 'Ki', symbol: 'K_i', label: '積分增益（每 sample）', default: HC_NOMINAL.Ki, min: 0, max: 4, practice: { choices: [0.01, 0.02, 0.04, 0.05, 0.08] } },
      { key: 'fref', symbol: 'f_{ref}', label: 'reference 頻率', unit: r`\mathrm{MHz}`, default: HC_FREF_MHZ, min: 1, max: 1e5 },
    ],
    validate: ({ Kp, Ki }) => typeIIProblem(Kp, Ki),
    solve: ({ Kp, Ki, fref }) => {
      const a = 2 - Kp
      const ratio = Ki / (2 * a)
      const root = Math.sqrt(ratio)
      const fNorm = typeIIFinv(Kp, Ki) // (1/π)·asin √(K_i/(2(2 − K_p)))
      const asin = Math.PI * fNorm
      const finv = fNorm * fref
      const reLEdge = typeIIReL(Kp, Ki, fNorm)
      return {
        steps: [
          { tex: r`2-K_p=2-${ni(Kp)}=${n(a)}`, why: '先算分母裡的括號。' },
          { tex: r`\frac{K_i}{2(2-K_p)}=\frac{${ni(Ki)}}{2\times${n(a)}}=${n(ratio)}`, why: r`這是帶緣上的 $\sin^2(\Omega/2)$：比它小的頻率，$\mathrm{Re}\,L_2<-1$。` },
          { tex: r`\sin\frac{\Omega_{inv}}{2}=\sqrt{\frac{K_i}{2(2-K_p)}}=\sqrt{${n(ratio)}}=${n(root)}`, why: r`開根號，得到帶緣上的 $\sin(\Omega/2)$。` },
          {
            tex: r`\frac{\Omega_{inv}}{2}=\arcsin\Big(\sin\frac{\Omega_{inv}}{2}\Big)=\arcsin(${n(root)})=${n(asin)}\ \mathrm{rad}`,
            why: r`RAD 模式按 $\sin^{-1}$。小值可以手算：$\arcsin x\approx x+\tfrac{x^3}{6}$，$x\le0.3$ 時誤差小於 $2\times10^{-4}$。`,
          },
          { tex: r`f_{inv}=\frac{f_{ref}}{\pi}\cdot\frac{\Omega_{inv}}{2}=\frac{${ni(fref)}}{\pi}\times${n(asin)}=${n(finv)}\ \mathrm{MHz}`, why: r`$f=\Omega f_{ref}/(2\pi)$，所以 $f_{inv}=\frac{f_{ref}}{\pi}\cdot\frac{\Omega_{inv}}{2}$。` },
          {
            tex: r`\mathrm{Re}\,L_2(f_{inv})=-\frac{K_p}{2}-\frac{K_i}{4\sin^2(\Omega_{inv}/2)}=-\frac{${ni(Kp)}}{2}-\frac{${ni(Ki)}}{4\times${n(ratio)}}=-${n(Kp / 2)}-${n(Ki / (4 * ratio))}=${n(reLEdge)}`,
            why: r`驗算：把第 2 步的 $\sin^2\frac{\Omega_{inv}}{2}$ 代回 $\mathrm{Re}\,L_2$，兩項各自除完再相加。帶緣上 $\mathrm{Re}\,L$ 應該剛好是 $-1$，也就是 $\mathrm{Re}\,H_{PD}=0$。`,
          },
        ],
        results: [
          { symbol: r`\frac{K_i}{2(2-K_p)}`, label: r`帶緣上的 $\sin^2(\Omega/2)$`, value: ratio, digits: 6 },
          { symbol: 'f_{inv}', label: '反號帶上緣', value: finv, unit: r`\mathrm{MHz}`, digits: 6 },
        ],
        notes: [
          r`$\mathrm{Re}\,H_{PD}<0$ 的頻帶是 $0<f<${n(finv)}$ MHz：只要是 Type-II，左端永遠黏在 DC。PMUX 的旋轉頻率 $\alpha f_{ref}$（折回後）落在這裡，PHOS mode-1 的基波就在帶內（HC-CS.8）。`,
          r`不按 $\arcsin$ 的近似：$f_{inv}\approx\frac{f_{ref}}{\pi}\sqrt{\frac{K_i}{2(2-K_p)}}=${n((fref / Math.PI) * root)}$ MHz（誤差 $${pctTex((fref / Math.PI) * root, finv) ?? '0\\%'}$；根號內的值 $\le0.09$ 時誤差小於 $1.6\%$）。`,
        ],
      }
    },
    tips: [
      r`預設的 $K_p$、$K_i$ 是 L2 的設計值（比內文印的 $${texNum(HC_NOMINAL.Kp, 6)}$、$${texNum(HC_NOMINAL.Ki, 6)}$ 多留兩位），所以答案和 §6.2 印出來的數字逐位相同：$${texNum(EX.ratio, 6)}\to${texNum(EX.root, 6)}\to${texNum(EX.asin, 6)}\to f_{inv}=${texNum(EX.finv, 6)}$ MHz。`,
      r`$K_i$ 很小時 $f_{inv}\propto\sqrt{K_i}$：把 $K_i$ 加倍（思考題 1），帶緣大約變成 $\sqrt2$ 倍。`,
      r`這個 closed form 只適用 1 拍延遲的 P + I 迴路；延遲更長或 CPPLL 的帶緣要用實驗 A 掃描。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.5',
    title: r`L2 在頻率 $f$ 的 $\mathrm{Re}\,H_{PD}$：實部、虛部分開算`,
    page: PAGE,
    formulaId: 'F-CS.4',
    formulaTex: r`\begin{gathered}\mathrm{Re}\,L_2=-\frac{K_p}{2}-\frac{K_i}{4\sin^2(\Omega/2)},\qquad \mathrm{Im}\,L_2=-\frac{K_p}{2}\cot\frac{\Omega}{2}\\[4pt]\mathrm{Re}\,H_{PD}=\frac{1+\mathrm{Re}\,L}{(1+\mathrm{Re}\,L)^2+(\mathrm{Im}\,L)^2},\qquad \kappa_1\approx W_1\,\mathrm{Re}\,H_{PD}(\alpha f_{ref}),\quad W_1=\frac{64\sin^2(\pi/8)}{\pi^2}\end{gathered}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'f', symbol: 'f', label: r`要看的頻率（例如 PMUX 的旋轉頻率 $\alpha f_{ref}$）`, unit: r`\mathrm{MHz}`, default: 83.8, min: 0, max: 1e5, practice: { choices: [20, 40, 60, 80, 100, 160, 200, 400] } },
      { key: 'fref', symbol: 'f_{ref}', label: 'reference 頻率', unit: r`\mathrm{MHz}`, default: HC_FREF_MHZ, min: 1, max: 1e5 },
      { key: 'Kp', symbol: 'K_p', label: '比例增益（每 sample）', default: HC_NOMINAL.Kp, min: 0, max: 2, practice: { choices: [0.25, 0.3, 0.4] } },
      { key: 'Ki', symbol: 'K_i', label: '積分增益（每 sample）', default: HC_NOMINAL.Ki, min: 0, max: 4, practice: { choices: [0.02, 0.04, 0.05] } },
    ],
    validate: ({ f, fref, Kp, Ki }) => typeIIProblem(Kp, Ki) ?? freqProblem(f, fref),
    solve: ({ f, fref, Kp, Ki }) => {
      const loop = makeL2({ Kp, Ki })
      const fn = f / fref
      const W = TWO_PI * fn
      const sHalf = Math.sin(W / 2)
      const cHalf = snap(Math.cos(W / 2)) // f = f_ref/2 時 cos(π/2) 的 6e-17 殘渣視為 0
      const s2 = sHalf * sHalf
      const cot = cHalf / sHalf
      const reL = typeIIReL(Kp, Ki, fn)
      const imL = snap(loopL(loop, fn).im)
      const onePlus = snap(1 + reL, 1e-9) // 離 −1 不到 10⁻⁹：當成剛好在邊界上
      const den = onePlus * onePlus + imL * imL
      const H = loopH(loop, fn)
      const reH = onePlus === 0 ? 0 : H.re
      const k1 = onePlus === 0 ? 0 : singleLinePhos(fn, gammaEff(loop)) // W₁·Re H_PD(f)
      const k1Full = 8 * phosLambdaHarmonic(fn, gammaEff(loop))[1].re
      const finv = typeIIFinv(Kp, Ki) * fref
      // 接近帶緣：1 + Re L 是兩個幾乎相等的數相減，Re L 要多寫幾位，畫面上的減法才對得起來
      const pOne = sumDecimals(onePlus, [1, reL])
      const lostDigits = pOne - sumDecimals(reL, [reL]) >= 2 && fixedTex(reL, pOne) !== np(reL)
      const nearEdge = Math.abs(onePlus) < 1e-3
      const hSig = angleSig(W / 2, false) // Ω/2 靠近 π/2 時 cos 接近 0：角度多寫幾位
      const fSig = nearEdge ? 9 : 6
      return {
        steps: [
          { tex: r`\Omega=\frac{2\pi f}{f_{ref}}=\frac{2\pi\times${ni(f)}}{${ni(fref)}}=${n(W)}`, why: '頻率換成 rad/sample。' },
          { tex: r`\sin\frac{\Omega}{2}=\sin\frac{${n(W, hSig)}}{2}=\sin(${n(W / 2, hSig)})=${n(sHalf)}`, why: r`先把 $\Omega$ 除以 2，RAD 模式按 sin。` },
          { tex: r`\sin^2\frac{\Omega}{2}=${nb(sHalf)}^2=${n(s2)}`, why: '平方。' },
          {
            tex: r`\mathrm{Re}\,L=-\frac{K_p}{2}-\frac{K_i}{4\sin^2(\Omega/2)}=-\frac{${ni(Kp)}}{2}-\frac{${ni(Ki)}}{4\times${n(s2)}}=-${n(Kp / 2)}-${n(Ki / (4 * s2))}=${n(reL)}`,
            why: r`比例路徑（含 1 拍延遲的積分器）的實部恆為 $-K_p/2$；雙積分器那一項是純實數而且為負。兩項各自除完再相加。$\mathrm{Re}\,L<-1$ 就是反號。`,
          },
          {
            tex: r`\cos\frac{\Omega}{2}=\cos(${n(W / 2, hSig)})=${n(cHalf)}`,
            why:
              r`同一個角度（第 2 步的 $\Omega/2$）按 cos。` +
              (cHalf === 0
                ? r`$f=f_{ref}/2$ 時 $\tfrac{\Omega}{2}=\tfrac{\pi}{2}$，精確值是 0；拿四捨五入後的 $${n(W / 2, hSig)}$ 去按計算機會得到很小但不是 0 的數，那只是角度四捨五入的誤差。`
                : hSig > 6
                  ? r`$\tfrac{\Omega}{2}$ 靠近 $\tfrac{\pi}{2}$，$\cos$ 接近 0，角度的捨入會被放大，所以角度多寫了幾位。`
                  : ''),
          },
          {
            tex: r`\cot\frac{\Omega}{2}=\frac{\cos(\Omega/2)}{\sin(\Omega/2)}=\frac{${n(cHalf)}}{${n(sHalf)}}=${n(cot)}`,
            why: r`計算機沒有 cot 鍵：用上一步的 cos 除以第 2 步的 sin（或按 $1/\tan$）。`,
          },
          {
            tex: r`\mathrm{Im}\,L=-\frac{K_p}{2}\cot\frac{\Omega}{2}=-${n(Kp / 2)}\times${np(cot)}=${n(imL)}`,
            why: r`虛部只來自比例路徑：$\frac{z^{-1}}{1-z^{-1}}=-\tfrac12-\tfrac{j}{2}\cot\tfrac{\Omega}{2}$；$\tfrac{K_p}{2}$ 在第 4 步算過。`,
          },
          {
            tex: r`1+\mathrm{Re}\,L=1+${fixedTex(reL, pOne)}=${n(onePlus)}`,
            why: lostDigits
              ? r`它的符號就是 $\mathrm{Re}\,H_{PD}$ 的符號。這裡把 $\mathrm{Re}\,L$ 多寫了幾位：兩個很接近的數相減，前面的位數會抵消，手算時第 4 步的結果不要先四捨五入。`
              : r`它的符號就是 $\mathrm{Re}\,H_{PD}$ 的符號。`,
          },
          {
            tex: r`\lvert1+L\rvert^2=(1+\mathrm{Re}\,L)^2+(\mathrm{Im}\,L)^2=${nb(onePlus)}^2+${nb(imL)}^2=${n(onePlus * onePlus)}+${n(imL * imL)}=${n(den)}`,
            why: '複數的模平方：實部、虛部分開平方再相加。',
          },
          {
            tex: r`\mathrm{Re}\,H_{PD}=\frac{1+\mathrm{Re}\,L}{\lvert1+L\rvert^2}=\frac{${n(onePlus)}}{${n(den)}}=${n(reH)}`,
            why: r`$H_{PD}=\frac{1}{1+L}=\frac{\overline{1+L}}{\lvert1+L\rvert^2}$：分子分母同乘共軛，實部的分子是 $1+\mathrm{Re}\,L$。`,
          },
          {
            tex: r`\kappa_1\approx W_1\,\mathrm{Re}\,H_{PD}=${n(W1)}\times${np(reH)}=${n(k1)}`,
            why: r`單線近似：如果 PMUX 的旋轉頻率 $\alpha f_{ref}$ 剛好是這個 $f$，PHOS mode-1 有 $W_1=64\sin^2(\pi/8)/\pi^2$ 的權重落在這條線上。`,
          },
        ],
        results: [
          { symbol: r`\mathrm{Re}\,L`, label: r`開迴路增益的實部（$<-1$ 就反號）`, value: reL, digits: 6 },
          { symbol: r`\lvert1+L\rvert^2`, value: den, digits: 6 },
          { symbol: r`\mathrm{Re}\,H_{PD}`, label: '誤差 → PD 轉移函數的實部', value: reH, digits: 6, tolerance: { rel: 0.02, abs: 5e-4 } },
          { symbol: r`W_1\mathrm{Re}\,H_{PD}`, label: r`PHOS mode-1 的單線近似 $\kappa_1$`, value: k1, digits: 6, tolerance: { rel: 0.02, abs: 5e-4 } },
        ],
        notes: [
          onePlus === 0
            ? r`$\mathrm{Re}\,L=-1\Rightarrow\mathrm{Re}\,H_{PD}=0$：$f=${ni(f)}$ MHz 剛好在反號帶的上緣（$f_{inv}=${n(finv, fSig)}$ MHz，HC-CS.4）。`
            : reH < 0
              ? r`$\mathrm{Re}\,L<-1\Rightarrow\mathrm{Re}\,H_{PD}<0$：$f=${ni(f)}$ MHz 在反號帶內（上緣 $f_{inv}=${n(finv, fSig)}$ MHz，HC-CS.4）。`
              : r`$\mathrm{Re}\,L>-1\Rightarrow\mathrm{Re}\,H_{PD}>0$：$f=${ni(f)}$ MHz 在反號帶之外（上緣 $f_{inv}=${n(finv, fSig)}$ MHz，HC-CS.4）。`,
          r`sspll.ts 的 loopH 給 $H_{PD}=${n(reH)}${H.im >= 0 ? '+' : '-'}${n(Math.abs(snap(H.im)))}\,j$；實部與手算相同。`,
          r`完整的諧波和（sspll.ts 的 phosLambdaHarmonic，把 $\alpha=f/f_{ref}$ 當成無理數）給 $\kappa_1=${n(k1Full, 5)}$：其餘 $1-W_1\approx${texNum(100 * (1 - W1), 2)}\%$ 的權重落在高頻，那裡 $\mathrm{Re}\,H_{PD}>0$。`,
          ...(Math.abs(fn - 0.25) < 0.02 || fn > 0.48
            ? [
                r`注意 $f/f_{ref}=${n(fn, 4)}$ 在 $\tfrac14$ 或 $\tfrac12$ 附近：把它當成 PMUX 的旋轉頻率時，mode-4（或 mode-2）的方波基頻會折回低頻、掉進反號帶，形成 alias dead zone（§8.4）；單線近似只看 $\ell=1$ 這一條線，看不到這件事。$\mathrm{Re}\,H_{PD}$ 本身仍然是精確值。`,
              ]
            : []),
          ...(nearEdge && onePlus !== 0
            ? [
                r`$f$ 幾乎就在帶緣上：$1+\mathrm{Re}\,L=${n(onePlus)}$ 是兩個幾乎相等的數相減。手算時中間結果不要先四捨五入（用計算機的 Ans／記憶鍵連續算），否則 $\mathrm{Re}\,H_{PD}$ 只剩一兩位可信。這也是實際電路的情況：帶緣附近 $\mathrm{Re}\,H_{PD}$ 的符號對增益的微小變化很敏感，所以 keep-out 要留 PVT margin（§6.5）。`,
              ]
            : []),
        ],
      }
    },
    tips: [
      r`RAD 模式；$\cot x=\cos x/\sin x$。中間結果不要先四捨五入（用計算機的 Ans／記憶鍵連續算）：接近帶緣時 $1+\mathrm{Re}\,L$ 是兩個接近的數相減。畫面上每個數字只顯示 6 位有效數字，所以你的最後一位可能和畫面差 1。`,
      r`$W_1$ 怎麼按：$\sin(\pi/8)=${texNum(EX.s8, 6)}$，平方得 $${texNum(EX.s8 ** 2, 6)}$，乘 64 得 $${texNum(64 * EX.s8 ** 2, 6)}$，除以 $\pi^2=${texNum(Math.PI ** 2, 6)}$ 得 $W_1=${texNum(W1, 6)}$。`,
      r`範例數字（$f=83.8$ MHz）是 L2 反號帶的最低點，也就是 §6.2 的手算例。把 $f$ 改成 HC-CS.4 算出的 $f_{inv}=${texNum(EX.finv, 5)}$ MHz，$1+\mathrm{Re}\,L$ 幾乎是 0，$\mathrm{Re}\,H_{PD}$ 掉到 $10^{-6}$ 的量級（不是剛好 0，因為 $f_{inv}$ 只取到小數兩位）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.6',
    title: r`一階差分 regressor 安全嗎？$K_i\le2K_p$ 與 $K_p+\tfrac{K_i}{2}\le2$ 的 margin`,
    page: PAGE,
    formulaId: 'F-CS.16',
    formulaTex: r`\begin{gathered}g(\Omega)=1-\frac{K_i}{2}-(1-K_p)\cos\Omega,\qquad g(0)=K_p-\frac{K_i}{2},\quad g(\pi)=2-K_p-\frac{K_i}{2}\\[4pt]\min_\Omega g=\min\{g(0),\,g(\pi)\}\ge0\iff\text{1diff 安全}\iff K_i\le2K_p\ \text{且}\ K_p+\frac{K_i}{2}\le2\end{gathered}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'Kp', symbol: 'K_p', label: '比例增益（每 sample）', default: HC_NOMINAL.Kp, min: 0, max: 2, practice: { choices: [0.1, 0.2, 0.25, 0.3, 0.5, 1, 1.5] } },
      { key: 'Ki', symbol: 'K_i', label: '積分增益（每 sample）', default: HC_NOMINAL.Ki, min: 0, max: 4, practice: { choices: [0.02, 0.05, 0.1, 0.2, 0.5, 0.8] } },
    ],
    validate: ({ Kp, Ki }) => typeIIProblem(Kp, Ki),
    solve: ({ Kp, Ki }) => {
      const half = Ki / 2
      const g0 = typeIIOneDiffG(Kp, Ki, 0) // cos Ω = +1
      const gPi = typeIIOneDiffG(Kp, Ki, 0.5) // cos Ω = −1
      const gMin = Math.min(g0, gPi)
      const scan = oneDiffMargin(makeL2({ Kp, Ki })).min
      const pG = Math.max(sumDecimals(g0, [Kp, half]), sumDecimals(gPi, [2, Kp, half])) // K_i/2 ≈ K_p 時兩數相減：K_i/2 多寫幾位
      const moreDigits = fixedTex(half, pG, false) !== n(half) ? r`這裡把 $\tfrac{K_i}{2}$ 多寫了幾位：兩個很接近的數相減，前面的位數會抵消。` : ''
      const ratioTex = texNum(Ki / Kp, Math.abs(Ki / Kp - 2) < 5e-3 ? 10 : 4) // 接近 2 時多寫幾位，才看得出在 2 的哪一邊
      return {
        steps: [
          { tex: r`\frac{K_i}{2}=\frac{${ni(Ki)}}{2}=${n(half)}`, why: '兩個條件都用得到。' },
          {
            tex: r`g(0)=K_p-\frac{K_i}{2}=${ni(Kp)}-${fixedTex(half, pG, false)}=${n(g0)}`,
            why: r`$\cos\Omega=1$（DC 端）。$g(0)\ge0\iff K_i\le2K_p$：積分路徑不能比比例路徑強太多。` + moreDigits,
          },
          {
            tex: r`g(\pi)=2-K_p-\frac{K_i}{2}=2-${ni(Kp)}-${fixedTex(half, pG, false)}=${n(gPi)}`,
            why: r`$\cos\Omega=-1$（$f_{ref}/2$ 那一端）。$g(\pi)\ge0\iff K_p+\tfrac{K_i}{2}\le2$。`,
          },
          {
            tex: r`\min_\Omega g=\min\{g(0),\,g(\pi)\}=\min\{${n(g0)},\ ${n(gPi)}\}=${n(gMin)}`,
            why: r`$g$ 是 $\cos\Omega$ 的一次函數，極值只會出現在兩端；$K_p\le1$ 時最小值在 DC 端。`,
          },
        ],
        results: [
          { symbol: 'g(0)', label: r`$K_i\le2K_p$ 的 margin`, value: g0, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`g(\pi)`, label: r`$K_p+\tfrac{K_i}{2}\le2$ 的 margin`, value: gPi, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`\min_\Omega g`, label: '一階差分的 margin', value: gMin, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
        ],
        notes: [
          gMin >= 0
            ? r`$\min_\Omega g=${n(gMin)}\ge0$：$\mathrm{Re}\,\Gamma_{1d}=g(\Omega)/\lvert1+L\rvert^2\ge0$ 對所有頻率成立；由 PSD 定理（§9），一階差分 regressor 對任何 $\alpha$ 都不反號。`
            : r`$\min_\Omega g=${n(gMin)}<0$：DC 附近 $\mathrm{Re}\,\Gamma_{1d}<0$，PSD 定理的保證不成立——這組增益下一階差分 regressor 也可能反號（$K_i/K_p=${ratioTex}>2$）。`,
          Math.abs(scan - gMin) <= 1e-6
            ? r`sspll.ts 的數值掃描（oneDiffMargin）得到 $\min_\Omega g=${n(snap(scan, 1e-6))}$，與 closed form 相差不到 $10^{-6}$（掃描的格點與捨入誤差）。`
            : r`sspll.ts 的數值掃描（oneDiffMargin）得到 $\min_\Omega g=${n(scan)}$；與 closed form 的差距來自掃描的頻率格點。`,
          r`第二個條件其實就是主迴路自己的穩定條件（$K_p+\tfrac{K_i}{2}<2$）；所以穩定的 1 拍延遲 Type-II 迴路只需要檢查 $K_i\le2K_p$（這裡 $K_i/K_p=${ratioTex}$）。`,
        ],
      }
    },
    tips: [
      '只有除以 2 和加減法。',
      r`L2（PM 60°）的 $K_i/K_p=${texNum(HC_NOMINAL.Ki / HC_NOMINAL.Kp, 3)}$，離 2 很遠；§11.1 列出 PM 降到 30° 時的值。`,
      r`這個 closed form 只適用 1 拍延遲的 Type-II（P + I）迴路。延遲更長、寄生極點或 CPPLL 要直接檢查 $g(\Omega)=1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}\ge0$（實驗 A 的指標「一階差分的 margin」）。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.7',
    title: '比較器 offset 把 raw GOS 推偏多少？',
    page: PAGE,
    formulaId: 'F-CS.19',
    formulaTex: r`\begin{gathered}E[q]=\mathrm{erf}\!\Big(\frac{u_{os}}{\sqrt2\,\sigma_v}\Big),\qquad K_q(u_{os})=\sqrt{\tfrac{2}{\pi}}\,\frac{e^{-u_{os}^2/2\sigma_v^2}}{\sigma_v}\\[4pt]\delta^{\star}_{GOS}=-\frac{E[q]\,\langle\rho\rangle}{K_q(u_{os})\,C_{GOS}},\qquad C_{GOS}=\frac{\kappa_{GOS}}{12}\end{gathered}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'uos', symbol: 'u_{os}', label: '比較器看到的 DC offset（換算成時間）', unit: r`\mathrm{fs}`, default: 25, min: -1e5, max: 1e5, practice: { choices: [10, 20, 25, 40, 50] } },
      { key: 'sigma', symbol: r`\sigma_v`, label: '比較器輸入端的雜訊 rms', unit: r`\mathrm{fs}`, default: 200, min: 0, max: 1e5, practice: { choices: [100, 200, 400] } },
      { key: 'kG', symbol: r`\kappa_{GOS}`, label: r`GOS 的正規化斜率 $12\,C_{GOS}$（§7；L2、$\alpha=0.137$ 時為 1.0259）`, default: 1.0259, min: -2, max: 2, practice: { choices: [0.5, 0.8, 1, 1.1] } },
      { key: 'rho', symbol: r`\langle\rho\rangle`, label: r`regressor 的平均（raw 約 $\tfrac12$；$\alpha=137/1000$ 一個週期的平均是 0.496；zero-mean 為 0）`, default: 0.496, min: 0, max: 1, practice: { choices: [0.5] } },
    ],
    validate: ({ uos, sigma, kG }) => {
      if (!(sigma > 0)) return r`$\sigma_v$ 必須大於 0：沒有雜訊時 1-bit 比較器沒有有限的線性增益（$K_q\to\infty$），Bussgang 線性化不成立。`
      if (!(kG > 0))
        return r`$\kappa_{GOS}\le0$：GOS 沒有恢復力（$=0$ 是不可觀測或 dead zone，$<0$ 是反號），forcing 無法被平衡，誤差會一直漂移而不是停在 $\delta^\star$。這個公式只適用 $C_{GOS}>0$。`
      if (Math.abs(uos) > 3 * sigma)
        return r`$\lvert u_{os}\rvert>3\sigma_v$：比較器幾乎飽和（$K_q(u_{os})/K_{q0}=e^{-u_{os}^2/2\sigma_v^2}<e^{-4.5}\approx1.1\%$），LMS 等於失明；要先把比較器門檻 trim 到 PD 的 static 工作點（§13）。這個小訊號（Bussgang）公式在那裡也不再適用。`
      return null
    },
    solve: ({ uos, sigma, kG, rho }) => {
      const z = uos / (Math.SQRT2 * sigma)
      const Eq = eqOffset(uos, sigma)
      const Kq0 = kqGain(sigma)
      const expo = (uos * uos) / (2 * sigma * sigma)
      const KqU = kqOffset(uos, sigma)
      const C = kG / 12
      const num = Eq * rho
      const den = KqU * C
      const bias = gosOffsetBias(C, rho, uos, sigma)
      return {
        steps: [
          {
            tex: r`z=\frac{u_{os}}{\sqrt2\,\sigma_v}=\frac{${ni(uos)}}{${n(Math.SQRT2, 8)}\times${ni(sigma)}}=${n(z)}`,
            why: r`erf 的引數：offset 是雜訊標準差的幾倍（再除以 $\sqrt2=${n(Math.SQRT2, 8)}$）。`,
          },
          {
            tex: r`E[q]=\mathrm{erf}(z)=\mathrm{erf}(${n(z)})=${n(Eq)}`,
            why: r`查 erf 表；只有標準常態表時用 $\mathrm{erf}(z)=2\Phi(\sqrt2\,z)-1=2\Phi(u_{os}/\sigma_v)-1$。手算近似：$\mathrm{erf}(z)\approx\frac{2}{\sqrt\pi}\big(z-\tfrac{z^3}{3}\big)$，$\tfrac{2}{\sqrt\pi}=1.12838$，$\lvert z\rvert\le0.3$ 時相對誤差小於 $0.1\%$。`,
          },
          {
            tex: r`K_{q0}=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}=\frac{${n(Math.sqrt(2 / Math.PI))}}{${ni(sigma)}}=${n(Kq0)}\ \mathrm{fs}^{-1}`,
            why: r`沒有 offset 時的 Bussgang 增益（§4.2）。常數 $\sqrt{2/\pi}$：先按 $2\div\pi$ 再開根號，得 $${n(Math.sqrt(2 / Math.PI))}$。`,
          },
          {
            tex: r`\frac{u_{os}^2}{2\sigma_v^2}=z^2=${nb(z)}^2=${n(expo)}`,
            why: r`offset 讓比較器離開最陡的工作點，增益要打折；先算指數。它就是第 1 步的 $z$ 的平方：$z^2=u_{os}^2/(2\sigma_v^2)$，所以只要按一次平方。`,
          },
          {
            tex: r`e^{-u_{os}^2/2\sigma_v^2}=e^{-${n(expo)}}=${n(Math.exp(-expo))}`,
            why: r`按 $e^x$ 鍵（先輸入負的指數）。小值可以手算：$e^{-x}\approx1-x$，$x\le0.05$ 時誤差小於 $0.13\%$。`,
          },
          { tex: r`K_q(u_{os})=K_{q0}\,e^{-u_{os}^2/2\sigma_v^2}=${n(Kq0)}\times${n(Math.exp(-expo))}=${n(KqU)}\ \mathrm{fs}^{-1}`, why: r`在 $u_{os}$ 這個工作點的斜率：erf 在該點的導數。` },
          { tex: r`C_{GOS}=\frac{\kappa_{GOS}}{12}=\frac{${ni(kG)}}{12}=${n(C)}`, why: r`$\kappa_{GOS}=C_{GOS}/\mathrm{var}(\rho)$，而均勻鋸齒的 $\mathrm{var}(\rho)=\tfrac{1}{12}$。` },
          { tex: r`E[q]\,\langle\rho\rangle=${np(Eq)}\times${ni(rho)}=${n(num)}`, why: 'forcing 項：與誤差無關，只要 regressor 有平均值就存在。' },
          { tex: r`K_q(u_{os})\,C_{GOS}=${n(KqU)}\times${n(C)}=${n(den)}\ \mathrm{fs}^{-1}`, why: '恢復力：每 1 fs 的 GOS 誤差產生多少平均梯度。' },
          {
            tex: r`\delta^{\star}_{GOS}=-\frac{E[q]\,\langle\rho\rangle}{K_q(u_{os})\,C_{GOS}}=-\frac{${n(num)}}{${n(den)}}=${n(bias)}\ \mathrm{fs}`,
            why: r`forcing 與恢復力平衡的位置，就是 GOS 的穩態偏差（$\delta=$ 真值 $-$ 估計：$u_{os}>0$ 時估計被推得太大，所以 $\delta^\star<0$）。`,
          },
        ],
        results: [
          { symbol: 'E[q]', label: '比較器輸出的平均', value: Eq, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: r`K_q(u_{os})`, label: 'offset 工作點的 Bussgang 增益', value: KqU, unit: r`\mathrm{fs}^{-1}`, digits: 6 },
          { symbol: r`\delta^{\star}_{GOS}`, label: 'raw GOS 的穩態偏差', value: bias, unit: r`\mathrm{fs}`, digits: 5, tolerance: { rel: 0.02, abs: 1e-6 } },
        ],
        notes: [
          uos !== 0 && rho !== 0
            ? r`偏差的大小是 offset 本身的 $${texNum(Math.abs(bias / uos), 3)}$ 倍：1-bit 比較器把很小的 DC 變成很大的 GOS 誤差。單位是 fs——DTC 走滿一格（$\rho=1$）時的時間誤差。`
            : r`forcing 項為 0，所以偏差是 0。`,
          rho === 0
            ? r`$\langle\rho\rangle=0$（zero-mean regressor）：forcing 項消失——這就是 ac／zm／一階差分 regressor 不怕 offset 的原因。`
            : r`把 $\langle\rho\rangle$ 改成 0（ac、zm 或一階差分 regressor）偏差就消失：所有對策都要搭配 zero-mean regressor（§13 的結論）。`,
          r`$\kappa_{GOS}$ 越小偏差越大：near-grid 的 dead zone 會把它放大到 ps 等級，推進大訊號的反向區（§10）。`,
        ],
      }
    },
    tips: [
      r`erf 怎麼查：多數工程計算機沒有 erf 鍵，用數學手冊的表，或換成標準常態分布 $\Phi$：$\mathrm{erf}(z)=2\Phi(\sqrt2\,z)-1$。小 offset 直接用 $\mathrm{erf}(z)\approx\frac{2}{\sqrt\pi}z=1.12838\,z$（$\lvert z\rvert\le0.1$ 時誤差小於 $0.4\%$）。`,
      r`範例數字（$u_{os}=25$ fs、$\sigma_v=200$ fs、L2 的 $\alpha=0.137$）重現 §13：$E[q]\approx0.0995$、raw GOS 偏差約 $-145.8$ fs。`,
      r`near-grid 的例子：把 $\kappa_{GOS}$ 改成 0.0803（§13 的 $\alpha=0.123$），偏差變成約 $${texNum(EX.nearGridBias, 3)}$ fs。`,
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-CS.8',
    title: r`綜合：頻道 $\alpha$ 用 raw regressor 校準會反號嗎？`,
    page: PAGE,
    formulaId: 'F-CS.8',
    formulaTex: r`\begin{gathered}f_{rot}=\min(\alpha,\,1-\alpha)\,f_{ref},\qquad \beta=\mathrm{frac}(8\alpha),\qquad f_{saw}=\min(\beta,\,1-\beta)\,f_{ref}\\[4pt]f_{inv}=\frac{f_{ref}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}},\qquad \min_\Omega g=\min\Big\{K_p-\frac{K_i}{2},\ 2-K_p-\frac{K_i}{2}\Big\}\end{gathered}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'alpha', symbol: r`\alpha`, label: '分數分頻的小數部分（FCW 的 frac）', default: 0.021, min: 0, max: 1, practice: { choices: [0.01, 0.02, 0.03, 0.05, 0.123, 0.137, 0.2, 0.26, 0.49, 0.98] } },
      { key: 'fref', symbol: 'f_{ref}', label: 'reference 頻率', unit: r`\mathrm{MHz}`, default: HC_FREF_MHZ, min: 1, max: 1e5 },
      { key: 'Kp', symbol: 'K_p', label: '比例增益（每 sample）', default: HC_NOMINAL.Kp, min: 0, max: 2, practice: { choices: [0.25, 0.3, 0.4] } },
      { key: 'Ki', symbol: 'K_i', label: '積分增益（每 sample）', default: HC_NOMINAL.Ki, min: 0, max: 4, practice: { choices: [0.02, 0.04, 0.05] } },
    ],
    validate: ({ alpha, Kp, Ki }) => {
      if (!(alpha > 0 && alpha < 1))
        return r`$\alpha$ 是分數分頻的小數部分，要在 $0<\alpha<1$ 之間。$\alpha=0$ 是整數頻道：PMUX 不旋轉、$\rho\equiv0$，GOS 與 PHOS 都不可觀測。`
      return typeIIProblem(Kp, Ki)
    },
    solve: ({ alpha, fref, Kp, Ki }) => {
      const loop = makeL2({ Kp, Ki })
      // α、f_ref 是使用者打的十進位數：它們的乘、加減照十進位寫（dec／toFixed 去掉 double 的尾巴），不四捨五入成 6 位
      const fA = dec(alpha * fref)
      const fold = foldFreq(alpha)
      const fRot = dec(fold * fref)
      const eightA = dec(8 * alpha)
      const beta = Number(gosBeta(alpha).toFixed(13)) % 1 // 8α − ⌊8α⌋：小數第 13 位以後是 double 的殘渣（進位到 1 時就是 0）
      const bMin = Number(foldFreq(beta).toFixed(13))
      const fSaw = dec(bMin * fref)
      const a = 2 - Kp
      const ratio = Ki / (2 * a)
      const root = Math.sqrt(ratio)
      const fNorm = typeIIFinv(Kp, Ki)
      const asin = Math.PI * fNorm
      const finv = fNorm * fref
      const dF = fRot - finv
      const pDF = sumDecimals(dF, [fRot, finv])
      const g0 = typeIIOneDiffG(Kp, Ki, 0)
      const gPi = typeIIOneDiffG(Kp, Ki, 0.5)
      const gMin = Math.min(g0, gPi)
      const pG = Math.max(sumDecimals(g0, [Kp, Ki / 2]), sumDecimals(gPi, [2, Kp, Ki / 2]))
      // 以下只用在「結論」：sspll.ts 對這個頻道的判斷
      const reH = loopH(loop, fold).re
      const single = singleLinePhos(alpha, gammaEff(loop))
      const bnd = phosM1Bounds(loop, alpha)
      const bndTex = r`$${n(bnd.lower, 4)}\le\kappa_1\le${n(bnd.upper, 4)}$`
      const phos =
        dF < 0
          ? r`PHOS：$f_{rot}<f_{inv}$，mode-1 的基波落在反號帶內。sspll.ts 算出 $\mathrm{Re}\,H_{PD}(f_{rot})=${n(reH, 5)}$，單線近似 $\kappa_1\approx W_1\mathrm{Re}\,H_{PD}=${n(single, 5)}$，嚴格界限 ${bndTex}：` +
            (bnd.upper < 0 ? '上界也是負的，mode-1 一定反號——raw regressor 不能在這個頻道更新 PHOS。' : '界限跨過 0（基波太靠近 DC 或帶緣，或反號帶很淺），只看基波無法判定符號，要看完整的諧波和（實驗 B）；$\\lvert\\kappa_1\\rvert$ 很小時實務上是 dead zone：不收斂、會漂移。')
          : r`PHOS：$f_{rot}\ge f_{inv}$，mode-1 的基波在帶外（$\mathrm{Re}\,H_{PD}(f_{rot})=${n(reH, 5)}$），嚴格界限 ${bndTex}：` +
            (bnd.lower >= 0 ? 'mode-1 不可能反號。' : '下界仍為負（剛出帶緣），要看完整的諧波和（實驗 B）。')
      const gos =
        beta === 0
          ? r`GOS：$\beta=0$（$\alpha=k/8$），$\rho\equiv0$，DTC 的細部 code 不動，GOS 不可觀測（PE failure）。`
          : bMin < 0.05
            ? r`GOS：near-grid（$\min(\beta,1-\beta)=${n(bMin, 4)}$），$\rho$ 是每 $${texNum(1 / bMin, 3)}$ 拍才跳一次的慢斜坡。小訊號恢復力只剩 $12C_{GOS}\approx12\,b^2/K_i=${texNum(12 * gosSmallBeta(loop, bMin), 3)}$（$b=\min(\beta,1-\beta)$；Type-II、$D=0$ 的漸近式），大訊號與比較器 offset 很容易把它推反（§10、§13）。`
            : r`GOS：鋸齒基波（折回後）在 $f_{saw}=${n(fSaw)}$ MHz，${fSaw < finv ? '落在反號帶內，但' : '在帶外；'}高次諧波 $m\beta$ 折回後散在全頻帶，延遲對齊（$D=0$）時數值上不反號（§7.2 的猜想）。`
      const notes = [phos, gos]
      if (Math.abs(fold - 0.25) < 0.02 || fold > 0.48)
        notes.push(r`注意 $\alpha$ 在 $\tfrac14$ 或 $\tfrac12$ 附近：mode-4（或 mode-2）的方波基頻 $4\lvert\alpha-\tfrac14\rvert f_{ref}$ 等會掉進反號帶，形成 dead zone（§8.4）——只看 mode-1 不夠。`)
      notes.push(
        gMin >= 0
          ? r`對策：$\min_\Omega g=${n(gMin)}\ge0$，改用一階差分 regressor 之後任何 $\alpha$ 都安全（§11.1；前提是相關器延遲對齊）。`
          : r`$\min_\Omega g=${n(gMin)}<0$：這組增益下一階差分 regressor 也不保證安全（HC-CS.6）。`,
      )
      return {
        steps: [
          { tex: r`\alpha f_{ref}=${ni(alpha)}\times${ni(fref)}=${nx(fA)}\ \mathrm{MHz}`, why: r`PMUX 每拍前進 $8\alpha$ 相，繞一圈的頻率是 $\alpha f_{ref}$；PHOS mode-1 的 regressor 就以這個頻率旋轉。` },
          {
            tex: r`f_{rot}=\min(\alpha f_{ref},\ f_{ref}-\alpha f_{ref})=\min(${nx(fA)},\ ${ni(fref)}-${nx(fA)})=\min(${nx(fA)},\ ${nx(decSum(fref - fA, fref, fA))})=${nx(fRot)}\ \mathrm{MHz}`,
            why: r`取樣後的頻譜以 $f_{ref}$ 為週期，而且 $\mathrm{Re}\,H(f)=\mathrm{Re}\,H(-f)$，所以折到 $[0,f_{ref}/2]$。`,
          },
          {
            tex: r`\beta=8\alpha-\lfloor8\alpha\rfloor=8\times${ni(alpha)}-\lfloor8\times${ni(alpha)}\rfloor=${nx(eightA)}-${Math.floor(eightA)}=${nx(beta)}`,
            why: r`DTC 的細部 code $\rho[n]=\mathrm{frac}(n\beta)$ 是鋸齒，GOS 只依賴 $\beta$。先乘 8；$\lfloor\cdot\rfloor$ 是無條件捨去到整數，減掉它就只剩小數部分。`,
          },
          {
            tex: r`f_{saw}=\min(\beta,\ 1-\beta)\,f_{ref}=\min(${nx(beta)},\ 1-${nx(beta)})\times${ni(fref)}=\min(${nx(beta)},\ ${nx(decSum(1 - beta, 1))})\times${ni(fref)}=${nx(bMin)}\times${ni(fref)}=${nx(fSaw)}\ \mathrm{MHz}`,
            why: r`鋸齒基波折回後的頻率。$\min(\beta,1-\beta)$ 很小就是 near-grid（$\alpha\approx k/8$）。`,
          },
          { tex: r`\frac{K_i}{2(2-K_p)}=\frac{${ni(Ki)}}{2\times(2-${ni(Kp)})}=\frac{${ni(Ki)}}{2\times${n(a)}}=${n(ratio)}`, why: r`帶緣上的 $\sin^2(\Omega/2)$（HC-CS.4）：先算括號，再除。` },
          { tex: r`\sin\frac{\Omega_{inv}}{2}=\sqrt{\frac{K_i}{2(2-K_p)}}=\sqrt{${n(ratio)}}=${n(root)}`, why: '開根號。' },
          { tex: r`\frac{\Omega_{inv}}{2}=\arcsin\Big(\sin\frac{\Omega_{inv}}{2}\Big)=\arcsin(${n(root)})=${n(asin)}\ \mathrm{rad}`, why: r`RAD 模式按 $\sin^{-1}$（小值可用 $x+\tfrac{x^3}{6}$）。` },
          { tex: r`f_{inv}=\frac{f_{ref}}{\pi}\cdot\frac{\Omega_{inv}}{2}=\frac{${ni(fref)}}{\pi}\times${n(asin)}=${n(finv)}\ \mathrm{MHz}`, why: r`$\mathrm{Re}\,H_{PD}<0$ 的頻帶是 $0<f<f_{inv}$。` },
          {
            tex: r`f_{rot}-f_{inv}=${nx(fRot)}-${fixedTex(finv, pDF, false)}=${n(dF)}\ \mathrm{MHz}`,
            why: r`負＝PMUX 的旋轉頻率在反號帶內；正＝在帶外。（$f_{inv}$ 寫到和答案相同的小數位數。）`,
          },
          { tex: r`\frac{K_i}{2}=\frac{${ni(Ki)}}{2}=${n(Ki / 2)}`, why: '最後看對策：一階差分的 margin（HC-CS.6）的兩個候選都用得到它。' },
          {
            tex: r`\min_\Omega g=\min\Big\{K_p-\frac{K_i}{2},\ 2-K_p-\frac{K_i}{2}\Big\}=\min\{${ni(Kp)}-${fixedTex(Ki / 2, pG, false)},\ 2-${ni(Kp)}-${fixedTex(Ki / 2, pG, false)}\}=\min\{${n(g0)},\ ${n(gPi)}\}=${n(gMin)}`,
            why: r`兩個候選各做一次減法，取小的。$\ge0$ 就對任何 $\alpha$ 都安全。`,
          },
        ],
        results: [
          { symbol: 'f_{rot}', label: 'PMUX 旋轉頻率（折回後）', value: fRot, unit: r`\mathrm{MHz}`, digits: 6 },
          { symbol: r`\beta`, label: r`GOS 鋸齒的基頻 $\mathrm{frac}(8\alpha)$`, value: beta, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
          { symbol: 'f_{inv}', label: '反號帶上緣', value: finv, unit: r`\mathrm{MHz}`, digits: 6 },
          { symbol: 'f_{rot}-f_{inv}', label: '負＝在反號帶內', value: dF, unit: r`\mathrm{MHz}`, digits: 6, tolerance: { rel: 0.02, abs: 0.5 } },
          { symbol: r`\min_\Omega g`, label: '一階差分的 margin', value: gMin, digits: 6, tolerance: { rel: 0.01, abs: 1e-6 } },
        ],
        notes,
      }
    },
    tips: [
      r`這題把前面幾題串起來：先算兩個頻率（PMUX 的旋轉、鋸齒的基頻），再和帶緣比（HC-CS.4），最後看對策（HC-CS.6）。想知道「反得多嚴重」，把 $f_{rot}$ 代進 HC-CS.5。`,
      r`$\lfloor x\rfloor$ 的例子：$8\times0.137=1.096$，所以 $\beta=0.096$（§7.1 的手算例）。`,
      r`範例數字（L2、$\alpha=0.021$）就是 §8.1 的手算例：$\alpha f_{ref}=84$ MHz 落在 $0$–$${texNum(EX.finv, 5)}$ MHz 的反號帶內。換成 $\alpha=0.137$（548 MHz）就在帶外。`,
    ],
  },
]
