import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcResult, HandCalcStep } from '@/data/types'
import { dtcCodeRange, dtcDelayFs, dtcInlDnl, dtcMapping, quantizeDtcCode, roundCode, type DtcParams } from '@/simulation/models/dtc'
import { designDtLoop } from '@/simulation/models/pll'
import { getWindow, windowStats, type WindowName } from '@/simulation/signal'
import {
  DEFAULT_FFT_PARAMS,
  FFT_DEMO_FS,
  dbPowerSum,
  lobeNoiseDbc,
  noiseFloorPerBinDbc,
  rectLeakageApproxDb,
  rectLeakageDb,
  tonePeakDensityDbcHz,
  welchLobeBins,
  whiteNoiseDensityDbcHz,
} from './experiments/fftPitfalls'
import { truncationDerived } from './experiments/gmacMath'
import { DEFAULT_GMAC_PARAMS, gmacSizing } from './experiments/gmacSizing'
import { ar1EffectiveSamples, ar1RelSeStd, ar1SeMean } from './experiments/jsonLabModel'
import { SPEC_NUMBERS } from './refNumbers'

/**
 * Part D（/models）的「帶入手算」題（docs/teaching-style.md §7）。ID 前綴 HC-MD（Models 頁專用，全站唯一）。
 *
 * 選題原則：只放「公式在本頁推導、而且其他章節沒有同一題」的計算。
 *  K_q→g→p、σ_w、−3 dB／ENBW（Ch12）、含延遲的 PM（Ch08）、accumulator 位元數／floor 偏差／sum vs average（Ch04）
 *  在那些章節已經有手算題，本頁只在對應的推導後面指路，不重複出題。
 *
 * 數值來源（solve 不另寫第二套公式）：
 *  - HC-MD.1：pll.ts 的 designDtLoop（K_p、K_i、特徵多項式係數、closed-loop poles、spectral radius）
 *  - HC-MD.2：dtc.ts 的 roundCode / quantizeDtcCode / dtcMapping / dtcDelayFs / dtcInlDnl
 *  - HC-MD.3、HC-MD.4：experiments/fftPitfalls.ts 的 core:fftHandFormulas（runFftPitfalls 自己也用同一組函式）與 signal 的 windowStats
 *  - HC-MD.5：experiments/jsonLabModel.ts 的 core:ar1StandardError（JSON Lab 指標表的容忍度就是用它算的）
 *  - HC-MD.6：experiments/gmacSizing.ts 的 gmacSizing（§9.2 計算器的同一個函式）
 * 步驟裡的中間量只對上述函式的輸出做「一次一種」的四則／開根號／log，讓讀者用紙筆＋工程計算機跟著算；handcalcs.test.tsx 逐題再比對一次。
 * 預設數字＝本頁的 worked example。每一行含 TeX 的字串都用同一行的 String.raw（index.test.tsx 的 LaTeX 檢查）。
 *
 * 題目位置：HC-MD.1 → §4.1；HC-MD.2 → §4.3；HC-MD.5 → §7.1；HC-MD.3 → §8.1；HC-MD.4 → §8.2；HC-MD.6（綜合）→ §11 思考題之前。
 */

/** √(2/π) */
const SQ = Math.sqrt(2 / Math.PI)

/** 代入用：負數加括號 */
const tp = (x: number, sig = 5): string => texNumP(x, sig)

/** 線性功率比：一律寫成 a\times10^{b}（1e-8 也寫成 1\times10^{-8}，才看得出是「代入後的數字」） */
const sci = (x: number, sig = 5): string => {
  const t = texNum(x, sig)
  return t.startsWith('10^{') ? String.raw`1\times${t}` : t
}

const KQ_WHY = String.raw`comparator 小訊號增益：$\sqrt{2/\pi}=0.79788$ 除以雜訊 RMS。雜訊越大，每一次比較帶的資訊越少。`

/** HC-MD.4 的視窗代號（HandCalc 的輸入只能是數字） */
const WINDOW_BY_CODE: Record<number, { name: WindowName; label: string }> = {
  1: { name: 'rectangular', label: '矩形窗' },
  2: { name: 'hann', label: 'Hann 窗' },
  3: { name: 'blackmanHarris', label: 'Blackman-Harris 窗' },
}

/** HC-MD.3：近似式 $\sin x\approx x$ 的適用上限 ν ≤ N/8（此時誤差 0.22 dB） */
const LEAK_APPROX_MAX_FRACTION = 1 / 8

/** HC-MD.5：漸近公式需要的最少有效樣本數 */
const AR1_MIN_NEFF = 10

/** HC-MD.6：近似式 Δ_G/(2K) 需要的自然 dither（LSB），與 §9.2 計算器的門檻相同 */
const MIN_DITHER_LSB = 0.4
/** HC-MD.6：保留 F_G 個小數 bit 之後至少還要丟掉這麼多 bit（ℓ = log₂N − F_G），近似式才準（±A code 時多估 2^{1−ℓ}） */
const MIN_SHIFT_BITS = 4

type GmacOut = ReturnType<typeof gmacSizing>

/**
 * HC-MD.6 的全部數字都取自 §9.2 計算器的 gmacSizing（floor、symmetric code）：
 * F_G = 0 的結果、讓近似偏差 ≤ σ_w 的最少小數 bit F_G,min（逐一試，保留全部 bit 時不再截斷）與該 F_G 的結果。
 * validate 與 solve 會連續用同一組輸入各呼叫一次，所以記住最後一次的結果。
 */
let md6Cache: { key: string; out: { o0: GmacOut; fMin: number; oF: GmacOut } } | null = null
function md6(v: Record<string, number>): { o0: GmacOut; fMin: number; oF: GmacOut } {
  const key = `${v.sigmaV}|${v.mu}|${v.bx}|${v.log2N}`
  if (md6Cache && md6Cache.key === key) return md6Cache.out
  const at = (F: number): GmacOut => gmacSizing({ ...DEFAULT_GMAC_PARAMS, bx: v.bx, log2N: v.log2N, gFracBits: F, sigmaV: v.sigmaV, mu: v.mu, range: 'symmetric', rounding: 'floor' })
  const o0 = at(0)
  let fMin = 0
  let oF = o0
  while (fMin < v.log2N && oF.eq.approxDeltaStar > o0.sigmaW) {
    fMin++
    oF = at(fMin)
  }
  const out = { o0, fMin, oF }
  md6Cache = { key, out }
  return out
}

export const HANDCALCS: HandCalcDef[] = [
  // ─────────────────────────── HC-MD.1：DT 主 PLL 的 K_p、K_i、特徵多項式與 poles（F-15.8） ───────────────────────────
  {
    id: 'HC-MD.1',
    title: String.raw`離散時間主 PLL（$d=0$）：$K_p$、$K_i$、特徵多項式與 closed-loop poles`,
    page: '/models',
    formulaId: 'F-15.8',
    // 三行（桌機欄寬約 880px；一行排不下會出現橫向捲軸）：增益、特徵式、二次公式
    formulaTex: String.raw`\begin{aligned}&K_p=2\zeta\,\omega_nT_s,\quad K_i=(\omega_nT_s)^2\\&1+L(z)=0\;\overset{d=0}{\Longleftrightarrow}\;z^2+a_1z+a_2=0,\quad a_1=K_p+K_i-2,\;a_2=1-K_p\\&z=\frac{-a_1\pm\sqrt{a_1^2-4a_2}}{2}\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'wnTs', symbol: String.raw`\omega_nT_s`, label: '正規化自然頻率（pll_error_path.parameters.wn_ts）', unit: String.raw`\text{rad/sample}`, default: 0.1, min: 0, max: 2, practice: { choices: [0.05, 0.1, 0.2, 0.25, 0.4, 0.5] } },
      { key: 'zeta', symbol: String.raw`\zeta`, label: '阻尼（zeta）', default: 0.7, min: 0, max: 5, practice: { choices: [0.5, 0.6, 0.7, 0.8, 1, 1.2] } },
    ],
    validate: ({ wnTs, zeta }) => {
      if (wnTs === 0) return String.raw`$\omega_nT_s=0$：$K_p=K_i=0$，迴路沒有增益，特徵式退化成 $(z-1)^2=0$（兩個 pole 都卡在 $z=1$，PLL 根本沒有鎖）。請輸入 $0<\omega_nT_s\le2$。`
      if (zeta === 0) return String.raw`$\zeta=0$：$K_p=0$，只剩積分路徑，$a_2=1$——一對 pole 落在單位圓上（$|z|=\sqrt{a_2}=1$），迴路持續振盪、沒有阻尼。請輸入 $\zeta>0$。`
      return null
    },
    solve: ({ wnTs, zeta }) => {
      const des = designDtLoop({ wnTs, zeta, loopDelay: 0 })
      const a1 = des.Hpd.a[1] ?? 0
      const a2 = des.Hpd.a[2] ?? 0
      const a1sq = a1 * a1
      const fourA2 = 4 * a2
      const rawDisc = a1sq - fourA2
      const disc = Math.abs(rawDisc) < 1e-12 ? 0 : rawDisc
      // designDtLoop 會去掉 z = 0 的 pole（特徵多項式尾端的 0）：補回來才是兩個
      const poles = des.poles.slice()
      while (poles.length < 2) poles.push({ re: 0, im: 0 })
      const complexPair = disc < 0
      const rho = des.spectralRadius
      const steps: HandCalcStep[] = [
        { tex: String.raw`K_p=2\zeta\,\omega_nT_s=2\times${texNum(zeta)}\times${texNum(wnTs)}=${texNum(des.Kp)}`, why: String.raw`比例增益：每 1 rad 的相位誤差，這個 sample 修正多少 rad。` },
        { tex: String.raw`K_i=(\omega_nT_s)^2=${texNum(wnTs)}^2=${texNum(des.Ki)}`, why: String.raw`積分增益：誤差每多累積一個 sample，再多修正多少。` },
        { tex: String.raw`a_1=K_p+K_i-2=${texNum(des.Kp)}+${texNum(des.Ki)}-2=${texNum(a1, 8)}`, why: String.raw`$1+L(z)=0$ 兩邊乘上 $(1-z^{-1})^2z^2$：$(z-1)^2+(K_p+K_i)z-K_p=0$，展開後 $z$ 的係數。` },
        { tex: String.raw`a_2=1-K_p=1-${texNum(des.Kp)}=${texNum(a2, 8)}`, why: String.raw`常數項。由 Vieta 定理，它也是兩個 pole 的乘積。` },
        { tex: String.raw`a_1^2=${tp(a1, 8)}^2=${texNum(a1sq, 8)}`, why: String.raw`判別式的第一項。請多留幾位：下一步是兩個很接近的數相減。` },
        { tex: String.raw`4a_2=4\times${tp(a2, 8)}=${texNum(fourA2, 8)}`, why: String.raw`判別式的第二項（同樣多留幾位）。` },
        { tex: String.raw`\Delta=a_1^2-4a_2=${texNum(a1sq, 8)}-${tp(fourA2, 8)}=${texNum(disc, 5)}`, why: String.raw`判別式：$\Delta<0$ 是一對共軛複數 pole（欠阻尼），$\Delta\ge0$ 是兩個實數 pole。也可以寫成 $\Delta=(\omega_nT_s)^2\bigl[(2\zeta+\omega_nT_s)^2-4\bigr]$。` },
      ]
      const results: HandCalcResult[] = [
        { symbol: 'K_p', label: '比例增益', value: des.Kp },
        { symbol: 'K_i', label: '積分增益', value: des.Ki },
      ]
      if (complexPair) {
        const zr = poles[0].re
        const zi = Math.abs(poles[0].im)
        const root = Math.sqrt(-disc)
        steps.push({ tex: String.raw`\mathrm{Re}\,z=-\frac{a_1}{2}=-\frac{${tp(a1, 8)}}{2}=${texNum(zr)}`, why: String.raw`二次公式的實部。` })
        steps.push({ tex: String.raw`\sqrt{-\Delta}=\sqrt{${texNum(-disc, 5)}}=${texNum(root)}`, why: String.raw`$\Delta<0$：先把負號拿出來變成 $j\sqrt{-\Delta}$，再開根號。` })
        steps.push({ tex: String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{${texNum(root)}}{2}=\pm${texNum(zi)}`, why: String.raw`二次公式的虛部；兩個 pole 互為共軛。` })
        steps.push({ tex: String.raw`\rho=|z|=\sqrt{a_2}=\sqrt{${texNum(a2, 8)}}=${texNum(rho)}`, why: String.raw`$|z|^2=z\bar z$ 就是兩根的乘積 $a_2$，不必再算 $\sqrt{\mathrm{Re}^2+\mathrm{Im}^2}$（兩種算法答案相同，可以互相驗算）。` })
        results.push({ symbol: String.raw`\mathrm{Re}\,z`, label: 'pole 的實部', value: zr, tolerance: { abs: 1e-3, rel: 0.01 } })
        results.push({ symbol: String.raw`|\mathrm{Im}\,z|`, label: 'pole 的虛部（取正值）', value: zi, tolerance: { abs: 1e-3, rel: 0.02 } })
      } else {
        const sorted = poles.map((z) => z.re).sort((x, y) => y - x)
        const root = Math.sqrt(disc)
        steps.push({ tex: String.raw`\sqrt{\Delta}=\sqrt{${texNum(disc, 5)}}=${texNum(root)}`, why: String.raw`$\Delta\ge0$：兩個實數 pole（過阻尼；$\Delta=0$ 時是重根）。` })
        steps.push({ tex: String.raw`z_1=\frac{-a_1+\sqrt\Delta}{2}=\frac{${texNum(-a1, 8)}+${texNum(root)}}{2}=${texNum(sorted[0])}`, why: String.raw`較大的那個根：離 $z=1$ 比較近，衰減比較慢。` })
        steps.push({ tex: String.raw`z_2=\frac{-a_1-\sqrt\Delta}{2}=\frac{${texNum(-a1, 8)}-${texNum(root)}}{2}=${texNum(sorted[1])}`, why: String.raw`較小的那個根。驗算：$z_1z_2$ 應等於 $a_2=${texNum(a2)}$。` })
        steps.push({ tex: String.raw`\rho=\max\bigl(|z_1|,|z_2|\bigr)=${texNum(rho)}`, why: String.raw`spectral radius：絕對值最大的 pole 決定暫態衰減的速度。` })
        results.push({ symbol: 'z_1', label: '較大的實數 pole', value: sorted[0], tolerance: { abs: 1e-3, rel: 0.01 } })
        results.push({ symbol: 'z_2', label: '較小的實數 pole', value: sorted[1], tolerance: { abs: 1e-3, rel: 0.01 } })
      }
      results.push({ symbol: String.raw`\rho`, label: 'spectral radius（最大 pole 半徑）', value: rho, tolerance: { abs: 1e-3, rel: 0.01 } })
      const notes: string[] = [
        des.stable
          ? rho === 0
            ? String.raw`$\rho=0$：兩個 pole 都在原點（deadbeat），主 PLL 的線性化模型穩定，暫態在有限個 sample 內結束。`
            : String.raw`$\rho=${texNum(rho)}<1$：主 PLL 的線性化模型穩定。$\rho$ 是暫態的漸近衰減率：夠久以後每個 sample 約乘上 $\rho$，對應的時間常數是 $-1/\ln\rho=${texNum(-1 / Math.log(rho), 4)}$ 個 sample。它不是「誤差降到 $1/e$ 要幾個 sample」：實際的暫態是兩個 pole 的組合，前幾個 sample 可以比 $\rho^n$ 快，也可以比它慢。`
          : String.raw`$\rho=${texNum(rho)}\ge1$：主 PLL 的線性化模型不穩定——這時 $H_\mathrm{PD}$ 沒有穩態頻率響應，後面所有 $C$、$g$ 的計算都沒有意義。$d=0$ 的穩定條件是 $K_i>0$、$K_p<2$、$K_p+\tfrac12K_i<2$。`,
      ]
      if (complexPair && des.stable) {
        const ct = Math.exp(-zeta * wnTs)
        notes.push(String.raw`和連續時間原型比：CT 的 pole $s=-\zeta\omega_n\pm j\omega_n\sqrt{1-\zeta^2}$ 取樣後半徑是 $e^{-\zeta\omega_nT_s}=${texNum(ct)}$，DT 的差分方程給 $${texNum(rho)}$（差 $${texNum(100 * Math.abs(rho / ct - 1), 2)}\%$）。$\omega_nT_s$ 越大差越多（勘誤 E44）。`)
      }
      const d1 = designDtLoop({ wnTs, zeta, loopDelay: 1 })
      notes.push(String.raw`多 1 個 sample 的 loop latency（$d=1$）時特徵式變成三次 $z^3-2z^2+(1+K_p+K_i)z-K_p=0$，手算不動了：同一個函式（designDtLoop）給 $\rho=${texNum(d1.spectralRadius)}$${d1.stable ? '' : '（不穩定）'}。用 §4.1 的面板把 $d$ 設成 0 和 1 對照。`)
      if (wnTs > 0.3) notes.push(String.raw`$\omega_nT_s=${texNum(wnTs)}>0.3$：$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$ 與 CT 原型的對應已經明顯失準，polarity 邊界也會偏離 $\omega_n$（勘誤 E44）。`)
      return { steps, results, notes }
    },
    tips: [
      String.raw`範例數字（$\omega_nT_s=0.1$、$\zeta=0.7$）的答案：$K_p=0.14$、$K_i=0.01$、$z=0.925\pm j0.066144$、$\rho=\sqrt{0.86}=0.92736$。把 §4.1 面板的 $d$ 改成 0 就能對答案。`,
      String.raw`$\Delta$ 是兩個很接近的數相減（範例是 $3.4225-3.44$）：$a_1^2$ 與 $4a_2$ 都要留到小數第 4 位以上，否則虛部會差很多。`,
      String.raw`心算判斷複數還是實數：$\Delta<0\iff2\zeta+\omega_nT_s<2$，也就是 $\zeta<1-\tfrac12\omega_nT_s$。試試 $\zeta=1$、$\omega_nT_s=0.05$（兩個實數 pole）。`,
      String.raw`只會用到一次開根號；複數的部分已經拆成實部與虛部分開算。`,
    ],
  },

  // ─────────────────────────── HC-MD.2：DTC code → delay（量化、飽和、二階非線性；F-15.10） ───────────────────────────
  {
    id: 'HC-MD.2',
    title: String.raw`DTC mapping：一個 code 要求變成多少延遲？nearest 與 truncate 差多少？`,
    page: '/models',
    formulaId: 'F-15.10',
    formulaTex: String.raw`\hat c=\mathrm{sat}_{[0,\,2^B-1]}\bigl(Q(c)\bigr),\quad Q_\mathrm{near}(c)=\bigl\lfloor c+\tfrac12\bigr\rfloor,\;Q_\mathrm{trunc}(c)=\lfloor c\rfloor,\qquad \tau(\hat c)=g_\mathrm{DTC}\,\hat c+o+c_2\,\hat c^{\,2}`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'c', symbol: 'c', label: '要求的 code（可以不是整數，也可以超出範圍）', unit: String.raw`\mathrm{LSB}`, default: 10.5, min: -1000, max: 100000, practice: { choices: [-3, 10.4, 10.5, 12.5, 20.5, 31.49, 37.5, 70.2] } },
      { key: 'g', symbol: String.raw`g_\mathrm{DTC}`, label: 'DTC 線性增益', unit: String.raw`\mathrm{fs/LSB}`, default: 250, min: -1e6, max: 1e6, practice: { choices: [100, 200, 250, 500] } },
      { key: 'o', symbol: 'o', label: '固定延遲 offset', unit: String.raw`\mathrm{fs}`, default: 1000, min: -1e6, max: 1e6, practice: { choices: [0, 500, 1000] } },
      { key: 'c2', symbol: 'c_2', label: '二階係數', unit: String.raw`\mathrm{fs/LSB^2}`, default: 0.2, min: -1000, max: 1000, practice: { choices: [0, 0.1, 0.2, 0.5] } },
      { key: 'bits', symbol: 'B', label: '實體 code 位元數（unsigned）', unit: String.raw`\text{bits}`, default: 6, min: 1, max: 12, integer: true, practice: { choices: [4, 5, 6] } },
    ],
    validate: ({ g, c2, bits }) => {
      if (g <= 0) return String.raw`$g_\mathrm{DTC}=${texNum(g)}\le0$：code 加大、延遲卻不增加（或反而減少）。LMS 校正的前提是「DTC gain 是一個正的斜率」，這組數字不是一顆 DTC。請輸入 $g_\mathrm{DTC}>0$。`
      const hi = dtcCodeRange(bits)[1]
      const slopeEnd = g + 2 * c2 * hi
      if (slopeEnd <= 0) return String.raw`$c_2$ 太負：斜率 $\tfrac{d\tau}{dc}=g_\mathrm{DTC}+2c_2c$ 在 $c=${hi}$ 變成 $${texNum(slopeEnd)}\le0$，延遲對 code 不再單調——同一個延遲對應兩個 code，「一個 gain」的線性模型不適用。請把 $|c_2|$ 調小到 $g_\mathrm{DTC}+2c_2(2^B-1)>0$。`
      return null
    },
    solve: ({ c, g, o, c2, bits }) => {
      const near: DtcParams = { gainFs: g, offsetFs: o, c2, bits, rounding: 'nearest' }
      const trunc: DtcParams = { ...near, rounding: 'truncate' }
      const hi = dtcCodeRange(bits)[1]
      const rawN = roundCode(c, 'nearest')
      const rawT = roundCode(c, 'truncate')
      const qn = quantizeDtcCode(c, near)
      const qt = quantizeDtcCode(c, trunc)
      const tauN = dtcDelayFs(c, near)
      const tauT = dtcDelayFs(c, trunc)
      const ideal = dtcMapping(c, { gainFs: g, offsetFs: o, c2 })
      const inl = dtcInlDnl(near)
      const maxInlFs = inl.inlFs.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      const satWhy = (raw: number, q: { code: number; saturated: boolean }): string =>
        q.saturated
          ? String.raw`$${raw}$ 超出 $[0,${hi}]$：被夾到 rail $${q.code}$（飽和）。之後 LMS 再怎麼推，實體延遲都不會動（§9 第 8 項）。`
          : String.raw`$${raw}$ 在 $[0,${hi}]$ 內，不需要飽和。`
      const tauSteps = (tag: string, k: number, tau: number): HandCalcStep[] => [
        { tex: String.raw`g_\mathrm{DTC}\,\hat c_\mathrm{${tag}}=${texNum(g)}\times${k}=${texNum(g * k, 8)}\ \mathrm{fs}`, why: String.raw`線性項：每個 LSB 是 $g_\mathrm{DTC}$ fs。` },
        { tex: String.raw`c_2\,\hat c_\mathrm{${tag}}^{\,2}=${tp(c2)}\times${k}^2=${tp(c2)}\times${k * k}=${texNum(c2 * k * k, 8)}\ \mathrm{fs}`, why: String.raw`二階項：code 越大，每個 LSB 的延遲越偏離 $g_\mathrm{DTC}$（這就是 INL 的來源）。` },
        { tex: String.raw`\tau(\hat c_\mathrm{${tag}})=${texNum(g * k, 8)}+${tp(o)}+${tp(c2 * k * k, 8)}=${texNum(tau, 8)}\ \mathrm{fs}`, why: String.raw`三項相加：線性 ＋ offset ＋ 二階。` },
      ]
      const notes: string[] = []
      if (qn.code === qt.code) {
        notes.push(String.raw`這個 $c$ 的兩種 rounding 得到同一個 code，延遲沒有差別。試試小數部分 $\ge0.5$ 的 code（例如 $10.5$）：nearest 進位、truncate 不進位，差一整個 LSB。`)
      } else {
        notes.push(String.raw`兩種 rounding 差一個 code，延遲差 $\tau(${qn.code})-\tau(${qt.code})=g_\mathrm{DTC}+c_2(${qn.code}^2-${qt.code}^2)=${texNum(tauN - tauT, 6)}\ \mathrm{fs}$——比 $g_\mathrm{DTC}$ 多（或少）的部分來自 $c_2$。RTL 與行為模型的 rounding 不一致時，每一筆延遲都可能差這麼多。`)
      }
      if (!qn.saturated) notes.push(String.raw`不量化的理想延遲 $\tau(c)=${texNum(ideal, 8)}\ \mathrm{fs}$：nearest 的量化誤差是 $${texNum(tauN - ideal, 5)}\ \mathrm{fs}$，truncate 是 $${texNum(tauT - ideal, 5)}\ \mathrm{fs}$（truncate 的誤差永遠 $\le0$，平均偏 $-\tfrac12$ LSB）。`)
      notes.push(
        c2 === 0
          ? String.raw`$c_2=0$：DTC 完全線性，endpoint-fit INL 為 0。`
          : String.raw`$c_2$ 造成的 endpoint-fit INL：$\mathrm{INL}(k)=c_2\,k\,\bigl(k-(2^B-1)\bigr)$，在中間 code 最大，$|\mathrm{INL}|_{\max}=${texNum(maxInlFs, 5)}\ \mathrm{fs}=${texNum(inl.maxAbsInlLsb, 4)}\ \mathrm{LSB}$（有效 LSB $=g_\mathrm{DTC}+c_2(2^B-1)=${texNum(inl.lsbFs, 6)}\ \mathrm{fs}$；dtcInlDnl 計算）。這種非線性會讓 LMS 的固定點偏離「平均 gain」（Ch11）。`,
      )
      return {
        steps: [
          { tex: String.raw`c_{\max}=2^{B}-1=2^{${bits}}-1=${hi}`, why: String.raw`$B$-bit unsigned code 的範圍是 $0\ldots2^B-1$。` },
          { tex: String.raw`Q_\mathrm{near}(c)=\bigl\lfloor c+\tfrac12\bigr\rfloor=\lfloor${texNum(c + 0.5, 8)}\rfloor=${rawN}`, why: String.raw`round half up：先加 $\tfrac12$ 再無條件捨去（$\lfloor\cdot\rfloor$ 是「不大於它的最大整數」，負數要往更負的方向取）。` },
          { tex: String.raw`\hat c_\mathrm{near}=\mathrm{sat}_{[0,${hi}]}(${rawN})=${qn.code}`, why: satWhy(rawN, qn) },
          { tex: String.raw`Q_\mathrm{trunc}(c)=\lfloor c\rfloor=\lfloor${texNum(c, 8)}\rfloor=${rawT}`, why: String.raw`truncate：直接丟掉小數（二補數截斷，朝 $-\infty$）。RTL 的「取高位元」就是這個。` },
          { tex: String.raw`\hat c_\mathrm{trunc}=\mathrm{sat}_{[0,${hi}]}(${rawT})=${qt.code}`, why: satWhy(rawT, qt) },
          ...tauSteps('near', qn.code, tauN),
          ...tauSteps('trunc', qt.code, tauT),
          { tex: String.raw`\Delta\tau=\tau(\hat c_\mathrm{near})-\tau(\hat c_\mathrm{trunc})=${texNum(tauN, 8)}-${tp(tauT, 8)}=${texNum(tauN - tauT, 6)}\ \mathrm{fs}`, why: String.raw`同一個 code 要求，只因為 rounding 規則不同而產生的延遲差。` },
        ],
        results: [
          { symbol: String.raw`\hat c_\mathrm{near}`, label: 'nearest（round half up）後的實體 code', value: qn.code, unit: String.raw`\mathrm{LSB}`, digits: 9, tolerance: { abs: 0, rel: 0 } },
          { symbol: String.raw`\tau(\hat c_\mathrm{near})`, label: 'nearest 的延遲', value: tauN, unit: String.raw`\mathrm{fs}`, digits: 8 },
          { symbol: String.raw`\hat c_\mathrm{trunc}`, label: 'truncate 後的實體 code', value: qt.code, unit: String.raw`\mathrm{LSB}`, digits: 9, tolerance: { abs: 0, rel: 0 } },
          { symbol: String.raw`\tau(\hat c_\mathrm{trunc})`, label: 'truncate 的延遲', value: tauT, unit: String.raw`\mathrm{fs}`, digits: 8 },
          { symbol: String.raw`\Delta\tau`, label: '兩種 rounding 的延遲差', value: tauN - tauT, unit: String.raw`\mathrm{fs}`, digits: 6 },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例數字就是 §4.3 表格的第 4 列：$c=10.5$ 時 nearest 給 $11$（$3774.2\ \mathrm{fs}$）、truncate 給 $10$（$3520\ \mathrm{fs}$），差 $254.2\ \mathrm{fs}$。`,
      String.raw`整題只有加減乘與一次平方。$\lfloor\cdot\rfloor$ 對負數要小心：$\lfloor-2.5\rfloor=-3$，不是 $-2$。`,
      String.raw`試試 $c=70.2$（超出 6-bit 範圍）與 $c=-3$：兩種 rounding 都被夾到 rail，延遲差是 0。`,
    ],
  },

  // ─────────────────────────── HC-MD.3：每 bin 雜訊底與矩形窗洩漏（F-15.11） ───────────────────────────
  {
    id: 'HC-MD.3',
    title: String.raw`這條 FFT 看得到 spur 嗎？每 bin 雜訊底與矩形窗洩漏`,
    page: '/models',
    formulaId: 'F-15.11',
    formulaTex: String.raw`\hat P_\mathrm{noise/bin}\,[\mathrm{dBc}]=P_\mathrm{noise}\,[\mathrm{dBc}]-10\log_{10}\frac{N}{2\,\mathrm{ENBW_{bins}}},\qquad \frac{|W(\nu)|}{N}\approx\frac{|\sin\pi\delta|}{\pi\,\nu},\;\nu=m+\delta\quad(\text{矩形窗},\ \nu\ll N)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'log2N', symbol: String.raw`\log_2N`, label: '紀錄長度（2 的幾次方）', default: DEFAULT_FFT_PARAMS.log2N, min: 8, max: 16, integer: true, practice: { choices: [8, 10, 12, 14, 16] } },
      { key: 'noiseDbc', symbol: String.raw`P_\mathrm{noise}`, label: '白雜訊總功率（相對載波）', unit: String.raw`\mathrm{dBc}`, default: DEFAULT_FFT_PARAMS.noiseDbc, min: -200, max: 0, practice: { choices: [-40, -50, -60, -70] } },
      { key: 'enbw', symbol: String.raw`\mathrm{ENBW_{bins}}`, label: '視窗的 ENBW（矩形 1、Hann 1.5、Blackman-Harris 2.0044）', unit: String.raw`\text{bins}`, default: 1, min: 1, max: 10, practice: { choices: [1, 1.5, 2.0044] } },
      { key: 'spurDbc', symbol: String.raw`P_\mathrm{spur}`, label: '想量的 spur 位準', unit: String.raw`\mathrm{dBc}`, default: DEFAULT_FFT_PARAMS.spurDbc, min: -200, max: 0, practice: { choices: [-60, -70, -80, -90] } },
      { key: 'm', symbol: 'm', label: String.raw`要看的 bin 與載波頻率相距 $\nu=m+\delta$ 個 bin：$m$ 是整數部分`, unit: String.raw`\text{bins}`, default: DEFAULT_FFT_PARAMS.spurOffsetBins - 1, min: 1, max: 100000, integer: true, practice: { choices: [9, 19, 39, 99] } },
      { key: 'delta', symbol: String.raw`\delta`, label: '載波偏離 bin 中心（0 = coherent）', unit: String.raw`\text{bin}`, default: DEFAULT_FFT_PARAMS.offsetBins, min: 0, max: 0.5, practice: { choices: [0.25, 0.5] } },
    ],
    validate: ({ log2N, m, delta }) => {
      const N = 2 ** log2N
      if (delta === 0) return String.raw`$\delta=0$（coherent 取樣）：$\sin\pi\delta=0$，矩形窗在每一個其他 bin 都剛好是零點，洩漏為 0（$-\infty$ dBc），沒有東西可算——這正是 coherent 取樣的好處。請輸入 $0<\delta\le0.5$。`
      if (m + delta >= N / 2) return String.raw`$\nu=m+\delta=${texNum(m + delta)}$ 超過 Nyquist（$N/2=${N / 2}$ bins）：這個 bin 不存在。請把 $m$ 調小或把 $N$ 加大。`
      if (m + delta > N * LEAK_APPROX_MAX_FRACTION) return String.raw`$\nu=${texNum(m + delta)}>N/8=${N / 8}$：近似式用了 $\sin\tfrac{\pi\nu}{N}\approx\tfrac{\pi\nu}{N}$，到這裡誤差已超過 $0.2\ \mathrm{dB}$（精確式是 $\tfrac{|\sin\pi\nu|}{N|\sin(\pi\nu/N)|}$，給 $${texNum(rectLeakageDb(m + delta, N), 4)}\ \mathrm{dBc}$）。請把 $m$ 調小或把 $N$ 加大。`
      return null
    },
    solve: ({ log2N, noiseDbc, enbw, spurDbc, m, delta }) => {
      const N = 2 ** log2N
      const pgLin = N / (2 * enbw)
      const floor = noiseFloorPerBinDbc(noiseDbc, N, enbw)
      const pgDb = noiseDbc - floor
      const margin = spurDbc - floor
      const nu = m + delta
      const s = Math.sin(Math.PI * delta)
      const piNu = Math.PI * nu
      const leak = rectLeakageApproxDb(nu)
      const leakLin = 10 ** (leak / 20)
      const leakExact = rectLeakageDb(nu, N)
      const notes: string[] = [
        margin >= 10
          ? String.raw`雜訊底比 spur 低 $${texNum(margin, 3)}\ \mathrm{dB}$：就雜訊而言看得到（一般希望至少 $10\ \mathrm{dB}$，因為單一 bin 的 periodogram 是指數分布，起伏很大）。`
          : margin > 0
            ? String.raw`雜訊底只比 spur 低 $${texNum(margin, 3)}\ \mathrm{dB}$（$<10\ \mathrm{dB}$）：spur 和雜訊尖峰分不出來。紀錄每加長 4 倍雜訊底降 $6\ \mathrm{dB}$；或改用已知頻率的 coherent tone fit。`
            : String.raw`雜訊底比 spur 還高 $${texNum(-margin, 3)}\ \mathrm{dB}$：spur 埋在雜訊裡，這條 FFT「沒有峰」不代表沒有 spur。`,
        leak > spurDbc
          ? String.raw`矩形窗洩漏 $${texNum(leak, 4)}\ \mathrm{dBc}$ 比 spur 高 $${texNum(leak - spurDbc, 3)}\ \mathrm{dB}$：在這個 bin 看到的「峰」是載波的 leakage，不是 spur。改成 coherent 取樣，或換 Blackman-Harris 窗（代價是 ENBW 變 2 bins、雜訊底高 $3\ \mathrm{dB}$）。`
          : String.raw`矩形窗洩漏 $${texNum(leak, 4)}\ \mathrm{dBc}$ 低於 spur：就洩漏而言不會遮住它。`,
        String.raw`洩漏的精確式（等比級數）$\frac{|\sin\pi\nu|}{N|\sin(\pi\nu/N)|}$ 給 $${texNum(leakExact, 5)}\ \mathrm{dBc}$，和近似差 $${texNum(Math.abs(leakExact - leak), 2)}\ \mathrm{dB}$。`,
      ]
      return {
        steps: [
          { tex: String.raw`N=2^{${log2N}}=${N}`, why: String.raw`紀錄長度（FFT 的點數）。` },
          { tex: String.raw`\frac{N}{2\,\mathrm{ENBW_{bins}}}=\frac{${N}}{2\times${texNum(enbw)}}=\frac{${N}}{${texNum(2 * enbw)}}=${texNum(pgLin)}`, why: String.raw`one-sided 頻譜有 $N/2$ 個 bin；每個 bin 的等效寬度是 ENBW 個 bin，所以每個 bin 分到 $2\,\mathrm{ENBW}/N$ 的雜訊功率。` },
          { tex: String.raw`10\log_{10}(${texNum(pgLin)})=${texNum(pgDb, 5)}\ \mathrm{dB}`, why: String.raw`processing gain：按 $\log$ 再乘 10。$N$ 每加倍多 $3.01\ \mathrm{dB}$。` },
          { tex: String.raw`\hat P_\mathrm{noise/bin}=${tp(noiseDbc)}-${texNum(pgDb, 5)}=${texNum(floor, 5)}\ \mathrm{dBc/bin}`, why: String.raw`每 bin 雜訊底＝雜訊總功率減去 processing gain。` },
          { tex: String.raw`P_\mathrm{spur}-\hat P_\mathrm{noise/bin}=${tp(spurDbc)}-(${texNum(floor, 5)})=${texNum(margin, 4)}\ \mathrm{dB}`, why: String.raw`spur 比雜訊底高多少；負的表示埋在雜訊裡。` },
          { tex: String.raw`\nu=m+\delta=${m}+${texNum(delta)}=${texNum(nu)}`, why: String.raw`要看的 bin 離載波的真實頻率多少個 bin（不是整數）。` },
          { tex: String.raw`|\sin\pi\delta|=\sin(180^\circ\times${texNum(delta)})=\sin(${texNum(180 * delta)}^\circ)=${texNum(s)}`, why: String.raw`$\sin\pi(m+\delta)=\pm\sin\pi\delta$，所以只跟 $\delta$ 有關。計算機用 DEG 模式按 $\sin$（$\pi$ rad $=180^\circ$）。` },
          { tex: String.raw`\pi\,\nu=3.1416\times${texNum(nu)}=${texNum(piNu)}`, why: String.raw`分母：裙邊只以 $1/\nu$ 緩慢下降。` },
          { tex: String.raw`\frac{|W(\nu)|}{N}\approx\frac{|\sin\pi\delta|}{\pi\,\nu}=\frac{${texNum(s)}}{${texNum(piNu)}}=${texNum(leakLin)}`, why: String.raw`矩形窗在這個 bin 讀到的載波振幅比（相對 bin 中心的滿刻度）。` },
          { tex: String.raw`20\log_{10}(${texNum(leakLin)})=${texNum(leak, 5)}\ \mathrm{dBc}`, why: String.raw`振幅比換成 dB（相對載波）：按 $\log$ 再乘 20。` },
        ],
        results: [
          { symbol: String.raw`\hat P_\mathrm{noise/bin}`, label: '每 bin 雜訊底', value: floor, unit: String.raw`\mathrm{dBc/bin}`, tolerance: { abs: 0.1, rel: 0.002 } },
          { symbol: String.raw`20\log_{10}\frac{|W(\nu)|}{N}`, label: '該 bin 的載波洩漏（矩形窗）', value: leak, unit: String.raw`\mathrm{dBc}`, tolerance: { abs: 0.1, rel: 0.002 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例數字就是下方 FFT 實驗的預設值：雜訊底 $-93.11\ \mathrm{dBc/bin}$、$\nu=39.5$ 的洩漏 $-41.87\ \mathrm{dBc}$——洩漏比 $-80\ \mathrm{dBc}$ 的 spur 高了 $38\ \mathrm{dB}$。`,
      String.raw`為什麼是 $\nu=39.5$：實驗的載波在第 $512.5$ 個 bin、spur 在 $552.5$；量 spur 時取它前後 1 個 bin（$552,\,553,\,554$）的最大值，其中離載波最近的是 $552-512.5=39.5$，所以 $m=39$、$\delta=0.5$。`,
      String.raw`$\log_{10}$ 的手算技巧：$10\log_{10}2=3.01$、$10\log_{10}N=3.01\times\log_2N$，所以 $N=4096$ 是 $36.12\ \mathrm{dB}$，再減 $10\log_{10}(2\,\mathrm{ENBW})$。`,
      String.raw`洩漏公式只適用矩形窗；Hann、Blackman-Harris 的裙邊下降快得多，請直接看實驗的「只有載波」那條曲線。`,
    ],
  },

  // ─────────────────────────── HC-MD.4：Welch 主瓣積分與 dBc／dBc/Hz（F-15.11） ───────────────────────────
  {
    id: 'HC-MD.4',
    title: String.raw`Welch 主瓣積分為什麼高估 spur？功率（dB）相加，以及 dBc 與 dBc/Hz`,
    page: '/models',
    formulaId: 'F-15.11',
    // 三行（一行排不下會出現橫向捲軸）：主瓣內的雜訊、功率和、峰值 PSD 與 RBW
    formulaTex: String.raw`\begin{aligned}P_\mathrm{noise,lobe}&=P_\mathrm{noise}+10\log_{10}\frac{2\,n_\mathrm{bins}}{n_\mathrm{seg}}\\[2pt]P_\mathrm{B}&=10\log_{10}\bigl(10^{P_\mathrm{spur}/10}+10^{P_\mathrm{noise,lobe}/10}\bigr)\\[2pt]S_\mathrm{peak}&=P_\mathrm{spur}-10\log_{10}\mathrm{RBW},\quad\mathrm{RBW}=\mathrm{ENBW_{bins}}\frac{f_s}{n_\mathrm{seg}}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'win', symbol: String.raw`\text{視窗}`, label: '視窗代號（1 = 矩形、2 = Hann、3 = Blackman-Harris）', default: 1, min: 0, max: 9, integer: true, practice: { choices: [1, 2, 3] } },
      { key: 'log2Seg', symbol: String.raw`\log_2n_\mathrm{seg}`, label: 'Welch segment 長度（2 的幾次方）', default: DEFAULT_FFT_PARAMS.welchLog2Seg, min: 5, max: 16, integer: true, practice: { choices: [8, 9, 10, 12] } },
      { key: 'spurDbc', symbol: String.raw`P_\mathrm{spur}`, label: '真實 spur 位準', unit: String.raw`\mathrm{dBc}`, default: DEFAULT_FFT_PARAMS.spurDbc, min: -200, max: 0, practice: { choices: [-60, -70, -80] } },
      { key: 'noiseDbc', symbol: String.raw`P_\mathrm{noise}`, label: '白雜訊總功率（相對載波）', unit: String.raw`\mathrm{dBc}`, default: DEFAULT_FFT_PARAMS.noiseDbc, min: -200, max: 0, practice: { choices: [-50, -60, -70] } },
      { key: 'fsMHz', symbol: 'f_s', label: '取樣率', unit: String.raw`\mathrm{MHz}`, default: FFT_DEMO_FS / 1e6, min: 0.001, max: 1e6, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ win }) => {
      if (!WINDOW_BY_CODE[win]) return String.raw`視窗代號只有 $1$（矩形）、$2$（Hann）、$3$（Blackman-Harris）三種——主瓣寬度 $n_\mathrm{bins}$ 與 ENBW 要由視窗決定，其他代號沒有對應的表。`
      return null
    },
    solve: ({ win, log2Seg, spurDbc, noiseDbc, fsMHz }) => {
      const w = WINDOW_BY_CODE[win]
      const nseg = 2 ** log2Seg
      const nBins = welchLobeBins(w.name)
      const enbw = windowStats(getWindow(w.name, nseg)).enbwBins
      const frac = (2 * nBins) / nseg
      const lobeNoise = lobeNoiseDbc(noiseDbc, nBins, nseg)
      const fracDb = lobeNoise - noiseDbc
      const linSpur = 10 ** (spurDbc / 10)
      const linNoise = 10 ** (lobeNoise / 10)
      const reading = dbPowerSum(spurDbc, lobeNoise)
      const fsHz = fsMHz * 1e6
      const binHz = fsHz / nseg
      const rbwHz = enbw * binHz
      const peak = tonePeakDensityDbcHz(spurDbc, rbwHz)
      const rbwDb = spurDbc - peak
      const n0 = whiteNoiseDensityDbcHz(noiseDbc, fsHz)
      const rbw2 = windowStats(getWindow(w.name, 2 * nseg)).enbwBins * (fsHz / (2 * nseg))
      const over = reading - spurDbc
      return {
        steps: [
          { tex: String.raw`\text{${w.label}：}\quad n_\mathrm{bins}=${nBins},\qquad \mathrm{ENBW_{bins}}=${texNum(enbw, 5)}`, why: String.raw`查表：主瓣積分取 spur 峰值 bin 左右各 $L+1$ 個 bin（$L$ 是主瓣半寬：矩形 1、Hann 2、Blackman-Harris 4），共 $2(L+1)+1$ 個；ENBW 見 §8.1 的視窗表。` },
          { tex: String.raw`n_\mathrm{seg}=2^{${log2Seg}}=${nseg}`, why: String.raw`每個 Welch segment 的長度：one-sided 頻譜有 $n_\mathrm{seg}/2$ 個 bin。` },
          // 寫成兩行（中間的 2×n_bins 那一步照樣留著）：排成一行在手機上會比正文欄寬 2px，多出一條沒有用途的橫向捲軸
          { tex: String.raw`\begin{aligned}\frac{2\,n_\mathrm{bins}}{n_\mathrm{seg}}&=\frac{2\times${nBins}}{${nseg}}=\frac{${2 * nBins}}{${nseg}}\\&=${texNum(frac)}\end{aligned}`, why: String.raw`白雜訊平均攤在 $n_\mathrm{seg}/2$ 個 bin 上；積分 $n_\mathrm{bins}$ 個 bin 就拿到這個比例的雜訊功率。` },
          { tex: String.raw`10\log_{10}(${texNum(frac)})=${texNum(fracDb, 5)}\ \mathrm{dB}`, why: String.raw`換成 dB：按 $\log$ 再乘 10。` },
          { tex: String.raw`P_\mathrm{noise,lobe}=${tp(noiseDbc)}+(${texNum(fracDb, 5)})=${texNum(lobeNoise, 5)}\ \mathrm{dBc}`, why: String.raw`主瓣積分範圍裡「只有白雜訊」時的期望功率。` },
          { tex: String.raw`10^{P_\mathrm{spur}/10}=10^{${texNum(spurDbc / 10, 6)}}=${sci(linSpur)}`, why: String.raw`dB 不能直接相加：先換回線性功率比（按 $10^x$）。` },
          { tex: String.raw`10^{P_\mathrm{noise,lobe}/10}=10^{${texNum(lobeNoise / 10, 6)}}=${sci(linNoise)}`, why: String.raw`同樣換成線性功率比。` },
          { tex: String.raw`10^{P_\mathrm{spur}/10}+10^{P_\mathrm{noise,lobe}/10}=${sci(linSpur)}+${sci(linNoise)}=${sci(linSpur + linNoise)}`, why: String.raw`spur 與雜訊不相關，功率（不是振幅）相加。` },
          { tex: String.raw`P_\mathrm{B}=10\log_{10}(${sci(linSpur + linNoise)})=${texNum(reading, 5)}\ \mathrm{dBc}`, why: String.raw`(B) Welch 主瓣積分的期望讀值：比真實 spur 高 $${texNum(over, 3)}\ \mathrm{dB}$。` },
          { tex: String.raw`\frac{f_s}{n_\mathrm{seg}}=\frac{${texNum(fsMHz)}\ \mathrm{MHz}}{${nseg}}=${texNum(binHz / 1e6, 7)}\ \mathrm{MHz}=${texNum(binHz / 1e3, 7)}\ \mathrm{kHz}`, why: String.raw`Welch 的 bin 間隔（$1\ \mathrm{MHz}=1000\ \mathrm{kHz}$）。` },
          { tex: String.raw`\mathrm{RBW}=\mathrm{ENBW_{bins}}\times\frac{f_s}{n_\mathrm{seg}}=${texNum(enbw, 5)}\times${texNum(binHz / 1e3, 7)}=${texNum(rbwHz / 1e3, 7)}\ \mathrm{kHz}`, why: String.raw`解析頻寬（resolution bandwidth）就是以 Hz 表示的 ENBW。` },
          { tex: String.raw`10\log_{10}(${texNum(rbwHz, 7)})=${texNum(rbwDb, 5)}\ \mathrm{dB}`, why: String.raw`取 $\log$ 的是以 Hz 為單位的數值：先把 kHz 換成 Hz（乘 1000），$\mathrm{RBW}=${texNum(rbwHz, 7)}\ \mathrm{Hz}$。` },
          { tex: String.raw`S_\mathrm{peak}=P_\mathrm{spur}-10\log_{10}\mathrm{RBW}=${tp(spurDbc)}-${texNum(rbwDb, 5)}=${texNum(peak, 5)}\ \mathrm{dBc/Hz}`, why: String.raw`一根 tone 在 density PSD 上的峰值＝它的功率除以 RBW：這個數字不是 tone 的性質，換一個 $n_\mathrm{seg}$ 就變。` },
        ],
        results: [
          { symbol: String.raw`P_\mathrm{noise,lobe}`, label: '主瓣內白雜訊的期望功率', value: lobeNoise, unit: String.raw`\mathrm{dBc}`, tolerance: { abs: 0.1, rel: 0.002 } },
          { symbol: String.raw`P_\mathrm{B}`, label: 'Welch 主瓣積分的期望讀值', value: reading, unit: String.raw`\mathrm{dBc}`, tolerance: { abs: 0.1, rel: 0.002 } },
          { symbol: String.raw`\mathrm{RBW}`, label: '解析頻寬（ENBW）', value: rbwHz / 1e3, unit: String.raw`\mathrm{kHz}`, digits: 7 },
          { symbol: String.raw`S_\mathrm{peak}`, label: 'tone 在 PSD 上的峰值', value: peak, unit: String.raw`\mathrm{dBc/Hz}`, tolerance: { abs: 0.1, rel: 0.002 } },
        ],
        notes: [
          over > 1
            ? String.raw`讀值高估 $${texNum(over, 3)}\ \mathrm{dB}$：主瓣裡的雜訊（$${texNum(lobeNoise, 4)}\ \mathrm{dBc}$）和 spur 同一個量級。$n_\mathrm{seg}$ 每加倍，$P_\mathrm{noise,lobe}$ 降 $3.01\ \mathrm{dB}$；要讓高估小於 $1\ \mathrm{dB}$，雜訊要比 spur 低 $6\ \mathrm{dB}$ 以上。`
            : String.raw`讀值只高估 $${texNum(over, 2)}\ \mathrm{dB}$：主瓣裡的雜訊比 spur 低 $${texNum(spurDbc - lobeNoise, 3)}\ \mathrm{dB}$，(B) 可以信任（前提是 coherent 取樣，沒有載波洩漏）。`,
          String.raw`把 $n_\mathrm{seg}$ 加倍：RBW 變成 $${texNum(rbw2 / 1e3, 5)}\ \mathrm{kHz}$，同一根 tone 的峰值 PSD 變成 $${texNum(tonePeakDensityDbcHz(spurDbc, rbw2), 5)}\ \mathrm{dBc/Hz}$（高 $3.01\ \mathrm{dB}$），但積分出來的 dBc 不變——所以 tone 要報 dBc，noise 才報 dBc/Hz。`,
          String.raw`對照：白雜訊本身的密度是 $P_\mathrm{noise}+10\log_{10}\tfrac{2}{f_s}=${texNum(n0, 5)}\ \mathrm{dBc/Hz}$（與 $n_\mathrm{seg}$ 無關）；實驗量到的 spur 峰值 PSD 是兩者的功率和 $${texNum(dbPowerSum(peak, n0), 5)}\ \mathrm{dBc/Hz}$。`,
          String.raw`這是期望值，而且有兩個前提：(1) coherent 取樣——非相干時還要再加上載波洩漏（看實驗的「只有載波」指標）；(2) spur 與載波在 Welch 頻譜上相隔超過 $n_\mathrm{bins}$ 個 bin，否則主瓣積分會把載波的主瓣也算進去。實驗只有一筆紀錄（幾十個 segment 平均），(B) 的讀值會在期望值附近 $\pm1\ \mathrm{dB}$ 左右起伏。`,
        ],
      }
    },
    tips: [
      String.raw`範例數字是下方 FFT 實驗的預設值（矩形窗、$n_\mathrm{seg}=512$）：$P_\mathrm{noise,lobe}=-77.09\ \mathrm{dBc}$、$P_\mathrm{B}=-75.30\ \mathrm{dBc}$。把實驗的 $\delta$ 設成 0，指標表的「Spur (B) Welch 主瓣積分」就在這個數字附近。`,
      String.raw`功率（dB）相加的捷徑：兩個一樣大 $\Rightarrow+3\ \mathrm{dB}$；差 $3\ \mathrm{dB}\Rightarrow$ 比大的那個多 $1.76\ \mathrm{dB}$；差 $10\ \mathrm{dB}\Rightarrow+0.41\ \mathrm{dB}$。`,
      String.raw`計算機沒有 $10^x$ 鍵時用 $10^x=e^{2.3026x}$。`,
    ],
  },

  // ─────────────────────────── HC-MD.5：AR(1) 有效樣本數與 4·SE 容忍度（F-15.12） ───────────────────────────
  {
    id: 'HC-MD.5',
    title: String.raw`模擬平均與 $w^*$ 差多少算「一致」？AR(1) 有效樣本數與 $4\,\mathrm{SE}$`,
    page: '/models',
    formulaId: 'F-15.12',
    formulaTex: String.raw`N_\mathrm{eff}=N_\mathrm{blk}\,\frac{1-\rho_1}{1+\rho_1},\qquad \mathrm{SE}(\bar w)=\frac{s_w}{\sqrt{N_\mathrm{eff}}},\qquad \frac{\mathrm{SE}(s_w)}{s_w}\approx\sqrt{\frac{1+\rho_1^2}{2N_\mathrm{blk}(1-\rho_1^2)}}\qquad(\rho_1\approx p)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'nBlk', symbol: String.raw`N_\mathrm{blk}`, label: '拿來做統計的 block 數（JSON Lab 取後半段：num_blocks 的一半）', unit: String.raw`\text{blocks}`, default: 1000, min: 3, max: 1000000, integer: true, practice: { choices: [500, 1000, 2000, 5000] } },
      { key: 'rho', symbol: String.raw`\rho_1`, label: '相鄰 block 的相關係數（一階迴路時就是 pole $p$）', default: 0.92021, min: -2, max: 2, practice: { choices: [0.5, 0.8, 0.9, 0.95] } },
      { key: 's', symbol: 's_w', label: '後半段 $w$ 的標準差（約等於 $\\sigma_w$）', unit: String.raw`\mathrm{fs}`, default: 0.39919, min: 1e-9, max: 1e6, practice: { choices: [0.2, 0.4, 1] } },
    ],
    validate: ({ nBlk, rho }) => {
      if (Math.abs(rho) >= 1) return String.raw`$|\rho_1|=${texNum(Math.abs(rho))}\ge1$：序列不是平穩的（$\rho_1=1$ 是 random walk，也就是 $g=0$ 的迴路；$|\rho_1|>1$ 發散），沒有固定的平均值可以估計，有效樣本數沒有意義。請輸入 $|\rho_1|<1$。`
      const nEff = ar1EffectiveSamples(nBlk, rho)
      if (nEff < AR1_MIN_NEFF) return String.raw`紀錄太短：$N_\mathrm{eff}=${texNum(nEff, 3)}<${AR1_MIN_NEFF}$。這個公式是 $N_\mathrm{blk}\gg1/(1-\rho_1)$ 的漸近式；紀錄只涵蓋幾個時間常數時，平均值幾乎由單一段暫態決定，$\mathrm{SE}$ 的估計本身就不可靠。請把 $N_\mathrm{blk}$ 加大到 $N_\mathrm{eff}\ge${AR1_MIN_NEFF}$（至少 $${Math.ceil((AR1_MIN_NEFF * (1 + rho)) / (1 - rho))}$ 個 block）。`
      return null
    },
    solve: ({ nBlk, rho, s }) => {
      const oneMinus = 1 - rho
      const onePlus = 1 + rho
      const ratio = oneMinus / onePlus
      const nEff = ar1EffectiveSamples(nBlk, rho)
      const rootN = Math.sqrt(nEff)
      const se = ar1SeMean(s, rho, nBlk)
      const tol = 4 * se
      const rho2 = rho * rho
      const den = 2 * nBlk * (1 - rho2)
      const rel = ar1RelSeStd(rho, nBlk)
      const labTol = Math.max(0.05, 4 * rel)
      // 要讓 4·SE ≤ s_w/4（平均值的容忍度是 σ_w 的四分之一）需要的 block 數：N_eff = 256
      const need = Math.ceil((256 * onePlus) / oneMinus)
      return {
        steps: [
          { tex: String.raw`1-\rho_1=1-${tp(rho)}=${texNum(oneMinus)}`, why: String.raw`一階迴路時 $\rho_1=p$，所以這就是 loop gain $g$。` },
          { tex: String.raw`1+\rho_1=1+${tp(rho)}=${texNum(onePlus)}`, why: String.raw`分母：$\rho_1$ 接近 1 時大約是 2。` },
          { tex: String.raw`\frac{1-\rho_1}{1+\rho_1}=\frac{${texNum(oneMinus)}}{${texNum(onePlus)}}=${texNum(ratio)}`, why: String.raw`每個 block 值多少個「獨立樣本」：$\rho_1$ 越接近 1，相鄰的 $w_k$ 越像，新資訊越少。` },
          { tex: String.raw`N_\mathrm{eff}=N_\mathrm{blk}\times${texNum(ratio)}=${nBlk}\times${texNum(ratio)}=${texNum(nEff)}`, why: String.raw`有效樣本數：平均值的不確定度相當於這麼多個獨立樣本。` },
          { tex: String.raw`\sqrt{N_\mathrm{eff}}=\sqrt{${texNum(nEff)}}=${texNum(rootN)}`, why: String.raw`開根號：誤差與樣本數的平方根成反比，紀錄要加長 4 倍，平均值才準 2 倍。` },
          { tex: String.raw`\mathrm{SE}(\bar w)=\frac{s_w}{\sqrt{N_\mathrm{eff}}}=\frac{${texNum(s)}}{${texNum(rootN)}}=${texNum(se)}\ \mathrm{fs}`, why: String.raw`平均值的標準誤（standard error）：重複做很多次模擬，$\bar w$ 的標準差大約是這麼多。` },
          { tex: String.raw`4\,\mathrm{SE}=4\times${texNum(se)}=${texNum(tol)}\ \mathrm{fs}`, why: String.raw`JSON Lab 的容忍度：$|\bar w-w^*|\le4\,\mathrm{SE}$ 才打勾（$4\sigma$：純屬運氣而超過的機率約 $6\times10^{-5}$）。` },
          { tex: String.raw`\rho_1^2=${tp(rho)}^2=${texNum(rho2)}`, why: String.raw`接下來估「標準差本身」準不準：$w_k^2$ 的相關係數是 $\rho_1^2$。` },
          { tex: String.raw`1-\rho_1^2=1-${texNum(rho2)}=${texNum(1 - rho2)}`, why: String.raw`和平均值的情形一樣，相關越強（$\rho_1^2\to1$）資訊越少。` },
          { tex: String.raw`2N_\mathrm{blk}(1-\rho_1^2)=2\times${nBlk}\times${texNum(1 - rho2)}=${texNum(den)}`, why: String.raw`分母：樣本越多、相關越弱，標準差估得越準。` },
          { tex: String.raw`\frac{1+\rho_1^2}{2N_\mathrm{blk}(1-\rho_1^2)}=\frac{1+${texNum(rho2)}}{${texNum(den)}}=\frac{${texNum(1 + rho2)}}{${texNum(den)}}=${texNum((1 + rho2) / den)}`, why: String.raw`這是 $s_w$ 的相對變異數：$s_w^2$ 的相對變異數 $\tfrac{2}{N_\mathrm{blk}}\cdot\tfrac{1+\rho_1^2}{1-\rho_1^2}$ 的四分之一（開根號會把相對誤差減半）。Gaussian AR(1) 時成立。` },
          { tex: String.raw`\frac{\mathrm{SE}(s_w)}{s_w}\approx\sqrt{${texNum((1 + rho2) / den)}}=${texNum(rel)}`, why: String.raw`標準差的相對標準誤：模擬的 $\sigma_w$ 與預測值差這個比例的 4 倍以內都算一致。` },
        ],
        results: [
          { symbol: String.raw`N_\mathrm{eff}`, label: '有效樣本數', value: nEff },
          { symbol: String.raw`\mathrm{SE}(\bar w)`, label: '平均值的標準誤', value: se, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`4\,\mathrm{SE}`, label: '平均值的容忍度（JSON Lab 指標表）', value: tol, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\mathrm{SE}(s_w)/s_w`, label: '標準差的相對標準誤', value: rel, tolerance: { rel: 0.02 } },
        ],
        notes: [
          String.raw`${nBlk} 個 block 只相當於 $${texNum(nEff, 3)}$ 個獨立樣本（每 $${texNum(1 / ratio, 3)}$ 個 block 才算 1 個）。如果誤把它們當成獨立的，會以為 $\mathrm{SE}=s_w/\sqrt{N_\mathrm{blk}}=${texNum(s / Math.sqrt(nBlk), 3)}\ \mathrm{fs}$——小了 $${texNum(1 / Math.sqrt(ratio), 3)}$ 倍，正確的結果會被誤判成「不一致」。`,
          String.raw`JSON Lab 對 $\sigma_w$ 的容忍度是 $\max(5\%,\,4\times${texNum(100 * rel, 3)}\%)=${texNum(100 * labTol, 3)}\%$。`,
          String.raw`想把平均值量到 $4\,\mathrm{SE}\le s_w/4$（$N_\mathrm{eff}\ge256$），需要 $N_\mathrm{blk}\ge256\,\tfrac{1+\rho_1}{1-\rho_1}=${need}$ 個 block；改用 8 個獨立 seed 的 Monte Carlo 則是另一條路（Student-t 信賴區間，不需要假設 AR(1)）。`,
        ],
      }
    },
    tips: [
      String.raw`範例數字是 §15.3 範例的預設模擬（num_blocks $=2000$，後半段 $1000$ 個；$\rho_1=p=0.92021$、$s_w=\sigma_w=0.39919\ \mathrm{fs}$）：$N_\mathrm{eff}=41.55$、$\mathrm{SE}=0.0619\ \mathrm{fs}$、容忍度 $0.248\ \mathrm{fs}$。JSON Lab 用資料估出來的 $\hat\rho_1$ 與 $s_w$ 代同一個公式，所以數字會略有不同。`,
      String.raw`$\rho_1$ 接近 1 時 $\tfrac{1-\rho_1}{1+\rho_1}\approx\tfrac{g}{2}$：有效樣本數大約是「$N_\mathrm{blk}$ 除以兩個時間常數」。`,
      String.raw`試試 $\rho_1=0.99$、$N_\mathrm{blk}=1000$：題目會告訴你這筆紀錄太短。`,
    ],
  },

  // ─────────────────────────── HC-MD.6：綜合——L1 的 σ_w 對 L5 的截斷偏差，要保留幾個小數 bit（F-15.5、F-16.3） ───────────────────────────
  {
    id: 'HC-MD.6',
    title: String.raw`綜合：回答開場問題——浮點模型的 $\sigma_w$ 對上 RTL 的截斷偏差 $\delta^*$，要保留幾個小數 bit？`,
    page: '/models',
    formulaId: 'F-16.3',
    // 兩行（一行排不下會出現橫向捲軸）：迴路的 K、σ_w、p；truncation 的平衡點與需要的小數位元
    formulaTex: String.raw`\begin{aligned}&K=\frac{\sqrt{2/\pi}}{\sigma_v}\,x_n^2,\quad \sigma_w=\frac{\mu\,x_n}{\sqrt{N\,(1-p^2)}},\;p=1-\mu K\\&\delta^*(F_G)\approx\frac{\Delta_G}{2K}=\frac{2^{-F_G}}{2^{B_x-1}\cdot2K};\qquad F_{G,\min}=\max\Bigl(0,\Bigl\lceil\log_2\frac{\delta^*(0)}{\sigma_w}\Bigr\rceil\Bigr)\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊 RMS（pd_noise_rms_fs）', unit: String.raw`\mathrm{fs}`, default: DEFAULT_GMAC_PARAMS.sigmaV, min: 0.1, max: 1e5, practice: { choices: [50, 100, 200] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate（gain_step，average GMAC）', unit: String.raw`\mathrm{fs}`, default: DEFAULT_GMAC_PARAMS.mu, min: -1e6, max: 1e6, practice: { choices: [5, 10, 20] } },
      { key: 'bx', symbol: 'B_x', label: 'code 位元數（code 只取正、負的最大幅度）', unit: String.raw`\text{bits}`, default: DEFAULT_GMAC_PARAMS.bx, min: 2, max: 12, integer: true, practice: { choices: [5, 6, 8] } },
      { key: 'log2N', symbol: String.raw`\log_2N`, label: 'block 長度（2 的幾次方）', default: DEFAULT_GMAC_PARAMS.log2N, min: 1, max: 16, integer: true, practice: { choices: [8, 10, 12] } },
    ],
    validate: ({ sigmaV, mu, bx, log2N }) => {
      const d = truncationDerived({ bx, log2N, gFracBits: 0, rounding: 'floor', sigmaV })
      const g = mu * d.K
      if (g === 0) return String.raw`$\mu=0$：$g=0$，$w$ 不會更新，$\sigma_w$ 與截斷偏差都沒有意義。請輸入 $\mu>0$。`
      if (g < 0) return String.raw`這個 $\mu$ 使 $g=\mu K=${texNum(g)}<0$：pole $p=1-g=${texNum(1 - g)}>1$，更新極性錯誤，平均誤差被推離固定點，沒有穩態可談。`
      if (g >= 2) return String.raw`這個 $\mu$ 使 $g=\mu K=${texNum(g)}\ge2$：pole $p=1-g=${texNum(1 - g)}\le-1$，一階平均模型不穩定，$\sigma_w$ 的公式不適用。請把 $\mu$ 調小到 $g<2$。`
      if (d.ditherLsb < MIN_DITHER_LSB) return String.raw`自然 dither 不足：$F_G=0$ 時截斷前 $S/2^\ell$ 的標準差只有 $x_n/(\sqrt N\,\Delta_G)=${texNum(d.ditherLsb, 3)}$ LSB（$<${MIN_DITHER_LSB}$）。近似式 $\Delta_G/(2K)$ 假設雜訊把截斷前的值抹平到至少半個 LSB；現在平衡點是一段死區，不能這樣算。請減小 $N$ 或加大 $B_x$（精確值看 §9.2 的計算器）。`
      const { fMin } = md6({ sigmaV, mu, bx, log2N })
      const ell = log2N - fMin
      if (fMin > 0 && ell < MIN_SHIFT_BITS) return String.raw`這組數字要保留 $F_G=${fMin}$ 個小數 bit 才壓得住偏差，右移只剩下不到 ${MIN_SHIFT_BITS} 個 bit 被丟掉（$\ell=\log_2N-F_G=${ell}$）。被丟掉的部分只有 $2^\ell$ 種可能時，floor 的平均誤差不是半個 LSB 而是 $\tfrac12(1-2^{1-\ell})$ LSB，近似式 $\Delta_G/(2K)$ 會多估——請加大 $N$ 或 $\mu$，或直接看 §9.2 計算器的精確值。`
      return null
    },
    solve: ({ sigmaV, mu, bx, log2N }) => {
      const { o0, fMin, oF } = md6({ sigmaV, mu, bx, log2N })
      const d = o0.eq.derived
      const half = 2 ** (bx - 1)
      const xn2 = d.xNorm * d.xNorm
      const p = 1 - o0.g
      const p2 = p * p
      const den = d.N * (1 - p2)
      const rootDen = Math.sqrt(den)
      const twoK = 2 * d.K
      const d0 = o0.eq.approxDeltaStar
      const ratio = d0 / o0.sigmaW
      const dF = oF.eq.approxDeltaStar
      const lg = Math.log2(ratio)
      const steps: HandCalcStep[] = [
        { tex: String.raw`x_n=\frac{2^{B_x-1}-1}{2^{B_x-1}}=\frac{${d.A}}{${half}}=${texNum(d.xNorm)}`, why: String.raw`$\pm A$ code（$A=2^{B_x-1}-1$）正規化後的幅度：RTL 的 code 是整數，行為模型的 $x$ 是它除以滿刻度。` },
        { tex: String.raw`x_n^2=${texNum(d.xNorm)}^2=${texNum(xn2)}`, why: String.raw`$C=E[x^2]=x_n^2$：誤差乘一次 $x_n$、GMAC 再乘一次。` },
        { tex: String.raw`K_q=\frac{0.79788}{\sigma_v}=\frac{0.79788}{${texNum(sigmaV)}}=${texNum(d.Kq)}\ \mathrm{fs^{-1}}`, why: KQ_WHY },
        { tex: String.raw`K=K_q\,x_n^2=${texNum(d.Kq)}\times${texNum(xn2)}=${texNum(d.K)}\ \mathrm{fs^{-1}}`, why: String.raw`平均 GMAC 斜率：$E[G]\approx K\delta$（F-15.3）。` },
        { tex: String.raw`g=\mu K=${texNum(mu)}\times${texNum(d.K)}=${texNum(o0.g)}`, why: String.raw`無因次 loop gain：$\mathrm{fs}\times\mathrm{fs^{-1}}$ 單位抵消。` },
        { tex: String.raw`p=1-g=1-${texNum(o0.g)}=${texNum(p)}`, why: String.raw`平均 pole：參數誤差 $\delta_k=a-w_k$ 每個 block 平均乘上的倍數。` },
        { tex: String.raw`p^2=${tp(p)}^2=${texNum(p2)}`, why: String.raw`雜訊的「記憶」：$\mathrm{Var}(\delta_{k+1})=p^2\,\mathrm{Var}(\delta_k)+\mu^2\sigma_\eta^2$。` },
        { tex: String.raw`1-p^2=1-${texNum(p2)}=${texNum(1 - p2)}`, why: String.raw`穩態時兩邊的變異數相等，移項後出現 $1-p^2$（§3.4）。` },
        { tex: String.raw`N\,(1-p^2)=2^{${log2N}}\times${texNum(1 - p2)}=${d.N}\times${texNum(1 - p2)}=${texNum(den)}`, why: String.raw`$\sigma_\eta^2=x_n^2/N$：$N$ 個獨立樣本平均後，變異數是單一樣本的 $1/N$。` },
        { tex: String.raw`\sqrt{N\,(1-p^2)}=\sqrt{${texNum(den)}}=${texNum(rootDen)}`, why: String.raw`開根號（變異數換成標準差）。` },
        { tex: String.raw`\sigma_w=\frac{\mu\,x_n}{\sqrt{N(1-p^2)}}=\frac{${texNum(mu)}\times${texNum(d.xNorm)}}{${texNum(rootDen)}}=\frac{${texNum(mu * d.xNorm)}}{${texNum(rootDen)}}=${texNum(o0.sigmaW)}\ \mathrm{fs}`, why: String.raw`L1 浮點模型的答案：$w$ 以 $a$ 為中心、標準差 $\sigma_w$ 抖動（F-15.5，$\sigma_\eta^2=x_n^2/N$）。` },
        { tex: String.raw`\Delta_G(F_G=0)=\frac{1}{2^{B_x-1}}=\frac{1}{${half}}=${texNum(d.deltaG)}`, why: String.raw`RTL 把總和右移 $\log_2N$ bits、不保留小數時，$\hat G$ 的 LSB（正規化單位）。` },
        { tex: String.raw`2K=2\times${texNum(d.K)}=${texNum(twoK)}\ \mathrm{fs^{-1}}`, why: String.raw`分母：「半個 LSB」的 $\tfrac12$ 和斜率 $K$ 合在一起。` },
        { tex: String.raw`\delta^*(0)\approx\frac{\Delta_G}{2K}=\frac{${texNum(d.deltaG)}}{${texNum(twoK)}}=${texNum(d0)}\ \mathrm{fs}`, why: String.raw`L5 的答案：floor 平均截掉半個 LSB，gain 停在比真值小 $\delta^*$ 的地方（F-16.3）。` },
        { tex: String.raw`\frac{\delta^*(0)}{\sigma_w}=\frac{${texNum(d0)}}{${texNum(o0.sigmaW)}}=${texNum(ratio)}`, why: String.raw`系統偏差是隨機抖動的幾倍：大於 1 表示「RTL 與浮點模型的差」不是雜訊，是看得見的 bias。` },
      ]
      if (ratio > 1) {
        steps.push({ tex: String.raw`\log_2(${texNum(ratio)})=\frac{\ln${texNum(ratio)}}{\ln2}=${texNum(lg, 4)}\;\Rightarrow\;F_{G,\min}=\lceil${texNum(lg, 4)}\rceil=${fMin}`, why: String.raw`每多保留 1 個小數 bit，$\Delta_G$ 減半、偏差也減半；要讓 $\delta^*\le\sigma_w$ 至少需要這麼多 bit。計算機沒有 $\log_2$ 就用 $\ln x/\ln2$。` })
        steps.push({ tex: String.raw`\delta^*(${fMin})=\frac{\delta^*(0)}{2^{${fMin}}}=\frac{${texNum(d0)}}{${2 ** fMin}}=${texNum(dF)}\ \mathrm{fs}`, why: String.raw`保留 $F_{G,\min}$ 個小數 bit 之後的偏差：小於 $\sigma_w=${texNum(o0.sigmaW)}\ \mathrm{fs}$。` })
      } else {
        steps.push({ tex: String.raw`\frac{\delta^*(0)}{\sigma_w}=${texNum(ratio)}\le1\;\Rightarrow\;F_{G,\min}=0`, why: String.raw`不保留小數 bit 時偏差就已經小於 $\sigma_w$。` })
      }
      const notes: string[] = [
        String.raw`這就是開場問題的答案：浮點模型說「$w$ 在 $a$ 附近 $\pm${texNum(o0.sigmaW, 3)}\ \mathrm{fs}$」，$F_G=0$ 的 RTL 說「$w$ 停在 $a-${texNum(d0, 4)}\ \mathrm{fs}$」。兩個都對，差別在 L5 多了右移截斷。`,
        String.raw`精確的 Binomial mean-field（§9.2 計算器）：$F_G=0$ 時 $\delta^*=${texNum(o0.eq.deltaStar)}\ \mathrm{fs}$（近似式差 $${texNum(100 * Math.abs(d0 / o0.eq.deltaStar - 1), 2)}\%$）${fMin > 0 ? String.raw`；$F_G=${fMin}$ 時 $\delta^*=${texNum(oF.eq.deltaStar)}\ \mathrm{fs}$（差 $${texNum(100 * Math.abs(dF / oF.eq.deltaStar - 1), 2)}\%$）` : ''}。近似式在 $N$ 小、或被丟掉的 bit 數 $\ell$ 少時會差到幾個百分點。`,
        String.raw`$\delta^*\propto\sigma_v$ 而 $\sigma_w\propto\sqrt{\mu\,\sigma_v/N}$（$g\ll1$ 時）：雜訊越大、$\mu$ 越小、$N$ 越大，比值越大，需要保留的小數 bit 越多。改用 round half up 則 $\delta^*\approx0$，不需要靠加 bit。`,
      ]
      return {
        steps,
        results: [
          { symbol: String.raw`\sigma_w`, label: 'L1 浮點模型的穩態係數雜訊', value: o0.sigmaW, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`\delta^*(0)`, label: String.raw`L5：$F_G=0$ 的截斷偏差（近似）`, value: d0, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.02 } },
          { symbol: String.raw`F_{G,\min}`, label: String.raw`讓 $\delta^*\le\sigma_w$ 的最少小數 bit`, value: fMin, unit: String.raw`\text{bits}`, digits: 9, tolerance: { abs: 0, rel: 0 } },
          { symbol: String.raw`\delta^*(F_{G,\min})`, label: '保留這些 bit 之後的偏差', value: dF, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.02 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例數字（$\sigma_v=100$、$\mu=10$、6-bit、$N=4096$）：$\sigma_w=0.3987\ \mathrm{fs}$、$\delta^*(0)=2.087\ \mathrm{fs}$（是 $\sigma_w$ 的 $5.23$ 倍）、$F_{G,\min}=3$、$\delta^*(3)=0.2608\ \mathrm{fs}$。到 §9.2 的計算器把 $F_G$ 設成 0 與 3 對答案。`,
      String.raw`這裡的 $\sigma_w$ 比 §3.4 的 $${texNum(SPEC_NUMBERS.sigmaW, 5)}\ \mathrm{fs}$ 小一點點：§3.4 的 code 是 $\pm1$（$x_n=1$），這裡是 6-bit 的 $\pm\tfrac{31}{32}$。`,
      String.raw`各步驟的單獨練習在別的章節：$K_q\to g\to p\to\sigma_w$ 在 Ch12，右移截斷的四種取整在 Ch04。這一題把它們接起來。`,
    ],
  },
]

/** 依 id 取題（找不到時丟錯：章節裡的 id 打錯要在測試就發現） */
export function handcalc(id: string): HandCalcDef {
  const h = HANDCALCS.find((x) => x.id === id)
  if (!h) throw new Error(`找不到手算題 ${id}`)
  return h
}

/** 測試用：近似式門檻與 √(2/π)（與上面的題目使用同一組常數） */
export const HANDCALC_CONSTANTS = { SQ, LEAK_APPROX_MAX_FRACTION, AR1_MIN_NEFF, MIN_DITHER_LSB, MIN_SHIFT_BITS } as const
