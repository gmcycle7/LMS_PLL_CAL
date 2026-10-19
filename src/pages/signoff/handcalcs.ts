import { texNum, texNumP } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import { svd } from '@/simulation/core'
import { SETTLE_FROM_POLES_MAX_STEPS, settleFromPoles } from '@/simulation/models/stability'
import { F_REF, makeL2, typeIIFinv } from '@/simulation/models/sspll'
import { cornerJudge, failureUpperBound, gCrit, identifiabilityThreshold, kq, oneHotPatternFactor, polarityReadoutPlan, requiredBlocks, secantRatio, slopeStdErr, timingToneFromSpur, trialsForZeroFailure, twoParamJlin, type CornerRowResult } from './judges'

/**
 * Sign-off 頁的「帶入手算」題（docs/teaching-style.md §7）。ID 採 'HC-SO.n'（SO = sign-off 頁，與公式的 'F-SO.n' 對應）。
 *
 * 只收「這一頁才有」的公式，編號依頁面上出現的順序：
 *   HC-SO.1 freeze ± Δ 的判決與所需 block 數（§2.2，F-SO.1／F-SO.3）
 *   HC-SO.2 兩參數 Jacobian 的行列式與可辨識性門檻（§2.5，F-SO.6／F-SO.12）
 *   HC-SO.3 0 次失效的證據強度（§3.5，F-SO.8）
 *   HC-SO.4 同一個 μ 過最快與最慢的 corner（§4 的 Corner 判斷器，F-SO.5）
 *   HC-SO.5 矽上量測計畫：要讀幾個 block 的 Ḡ 才能以 z = 3 判定極性、要花多少時間（§8.5，F-SO.3）
 *   HC-SO.6 從頻譜儀的 spur dBc 反推 timing tone 的 peak 與單相 PHOS 殘差（§8.5，F-SO.13 = F-12.18 反過來用）
 *   HC-SO.7 PVT corner 表的一列：σ_v → K_q、增益倍率 → 帶緣、κ → K_c 與 g、TC → Δa 的重新收斂與斜坡落後（§4b，F-SO.14；d = 0 才有封閉式；在陣列裡排在 HC-SO.4 之後＝頁面順序）
 * 本頁其他公式（累加器位元 F-SO.10、EFB 週期 F-SO.11、T18 的各自／聯合 pole F-SO.7、含延遲的 PM 與 μ 上限）在原章節已有手算題
 * （Ch04、Ch13、Ch10、Ch08），這裡不重複出題，頁面上改放連結。
 *
 *  - solve() 的答案一律取自 ./judges.ts 的實際函式（頁面上的實驗、表格與測試用的是同一批函式）；
 *    步驟裡的中間量每個等號只做「一次」基本運算，讓讀者用紙筆＋工程計算機就能跟著算。
 *  - 預設數字＝本頁 worked example：§2.1（σ_v = 100 fs、C = cos 85°、Δ = 20 fs、N = 4096、M = 8）、
 *    §4 Corner 判斷器預設的 FF 125°C 與 near-grid FCW 兩列、§3.5 的 n = 100、§2.5 SSPLL 實驗的預設值。
 *  - 極性一律是 δ = a − w（全站約定）。
 */

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
/** √(2/π)：K_q = √(2/π)/σ_v 的常數（手算用 0.79788） */
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
/** ln 0.05：「衰減 95%」的對數（手算用 −2.9957） */
const LN_005 = Math.log(0.05)
/** 這一題的 N 不影響答案（cornerJudge 只用它算 σ_w），沿用 Corner 判斷器的預設值 */
const CORNER_N = 4096
/** HC-SO.7 的迴路：案例頁的標稱 L2（PM 60°、320 MHz）的 K_p、K_i——和 §4b 的表（S4bPvt.tsx 的 PVT_LOOP_PARAMS）同一個設計；這裡自己算一次，避免 handcalcs ↔ sections 的循環 import */
const PVT_LOOP_PARAMS = (() => {
  const l = makeL2({ pm: 60 })
  return { Kp: Number(l.params.Kp), Ki: Number(l.params.Ki) }
})()

/** 把 1e-12 以下的浮點尾巴當成 0（例如 cos 90° = 6.1e-17） */
const clean = (x: number): number => (Math.abs(x) < 1e-12 ? 0 : x)
/** 使用者輸入的數字：最多 10 位有效數字，不提早四捨五入 */
const inp = (x: number): string => texNum(x, 10)
/** 同上，負數加括號（代入乘法、加減法時用） */
const inpP = (x: number): string => texNumP(x, 10)
/** 角度（度）的 TeX：數值包在大括號裡，避免科學記號的指數和 ^\circ 形成雙重上標 */
const deg = (x: number, sig = 5): string => String.raw`{${texNum(clean(x), sig)}}^\circ`
/** 整數：每一位都寫出來（49152 不可顯示成 4.9152×10⁴） */
const int = (k: number): string => (Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12))
/**
 * 「寫得完」的小數完整顯示、寫不完的才取 sig 位：輸入值的積與和（0.995² = 0.990025、1 − 0.990025 = 0.009975）若先四捨五入成 5 位，
 * 讀者照畫面上的數字往下算就對不起來。判準：去掉 double 的最後一兩位（15 位）之後，有效數字不超過 10 位。
 */
function num(x: number, sig = 5): string {
  if (!Number.isFinite(x) || x === 0) return texNum(x, sig)
  const c = Number(x.toPrecision(15))
  const digits = c
    .toExponential()
    .replace(/e.*$/, '')
    .replace(/[-.]/g, '').length
  return digits <= 10 ? texNum(c, 15) : texNum(x, sig)
}
/** 同上，負數加括號 */
const numP = (x: number, sig = 5): string => {
  const s = num(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}
/** x²：負數與科學記號當底數時加括號 */
const sq = (x: number, sig = 5): string => {
  const s = num(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})^2` : `${s}^2`
}
/** 接近 1 的數（ρ、α^{1/n}）：多顯示幾位，讓讀者自己算 1 − x 或 ln x 時仍有約 5 位有效數字 */
const nearOne = (x: number): string => {
  const gap = Math.abs(1 - x)
  return texNum(x, gap > 0 && gap < 1 ? Math.min(15, 5 + Math.ceil(-Math.log10(gap))) : 5)
}
/**
 * ⌈r⌉ 裡的 r 要顯示幾位：位數太少時 5.99996 會被顯示成 6，畫面變成「⌈6⌉ = 6」而真正的答案是另一個整數。
 * 從 5 位起逐步增加，直到「顯示出來的數字取上整（至少 1）」等於真正的答案 n。
 */
function ceilArg(r: number, n: number): string {
  if (!Number.isFinite(r)) return texNum(r)
  for (let sig = 5; sig <= 15; sig++) {
    const shown = Number(r.toPrecision(sig))
    if (Math.max(1, Math.ceil(shown)) === n) return texNum(shown, sig)
  }
  return texNum(r, 15)
}

/** 無條件進位的整數答案：小的數字必須完全正確；上千時容許中間量四捨五入造成的千分之二 */
const CEIL_TOL = { abs: 1e-9, rel: 0.002 }
const ANGLE_TOL = { abs: 0.05, rel: 0.01 }
/** 接近 1 的量（ρ）：1% 的相對容許太寬（0.95 與 0.96 的收斂時間差 25%），改用絕對容許 */
const NEAR_ONE_TOL = { abs: 5e-4, rel: 0 }

/* ───────────────────────────── HC-SO.4 用：兩個 corner 交給實際的 cornerJudge ───────────────────────────── */

interface CornerInputs {
  sigmaF: number
  thetaF: number
  sigmaS: number
  thetaS: number
  mu: number
  d: number
  pmT: number
  B: number
}

/** [最快, 最慢] 兩列——和頁面 Corner 判斷器的表格是同一個函式 */
function cornerRows(v: CornerInputs): [CornerRowResult, CornerRowResult] {
  const [F, S] = cornerJudge(
    [
      { name: 'fast', sigmaV: v.sigmaF, thetaDeg: v.thetaF },
      { name: 'slow', sigmaV: v.sigmaS, thetaDeg: v.thetaS },
    ],
    { mu: v.mu, d: v.d, pmTargetDeg: v.pmT, B: v.B, N: CORNER_N, sigmaWMax: Infinity },
  )
  return [F, S]
}

/** 每個 corner 的前三步：K_q、K = K_q cos θ、g = μK（下標 sub = 'F' 或 'S'） */
function cornerGainSteps(sub: 'F' | 'S', name: string, sigmaV: number, theta: number, mu: number, row: CornerRowResult): HandCalcStep[] {
  const Kq = kq(sigmaV)
  const C = clean(Math.cos(theta * DEG2RAD))
  return [
    {
      tex: String.raw`K_{q,${sub}}=\frac{\sqrt{2/\pi}}{\sigma_{v,${sub}}}=\frac{${texNum(SQRT_2_OVER_PI)}}{${inp(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`,
      why: sub === 'F' ? String.raw`${name} corner 的 comparator 增益；$\sqrt{2/\pi}=0.79788$。$\sigma_v$ 越小，$K_q$ 越大——所以雜訊最小的 corner 通常就是「最快」的 corner。` : String.raw`${name} corner 同樣先算 comparator 增益。`,
    },
    {
      tex: String.raw`K_${sub}=K_{q,${sub}}\cos\theta_${sub}=${texNum(Kq)}\times\cos(${deg(theta, 10)})=${texNum(Kq)}\times${texNumP(C)}=${texNum(row.K)}\ \mathrm{fs}^{-1}`,
      why: String.raw`這個 corner 的恢復力（計算機切到 DEG 模式按 $\cos$，再乘）。`,
    },
    {
      tex: String.raw`g_${sub}=\mu K_${sub}=${inp(mu)}\times${texNum(row.K)}=${texNum(row.g)}`,
      why: sub === 'F' ? String.raw`無因次迴路增益（fs 乘 fs$^{-1}$）。硬體只有一個 $\mu$，所以兩個 corner 用的是同一個數字。` : String.raw`同一個 $\mu$ 在最慢的 corner 只有這麼小的迴路增益。`,
    },
  ]
}

/**
 * d = 1 的 k95（逐 block）：y_{k+1} = y_k − g_S·y_{k−1}、y_0 = y_{−1} = 1 有封閉解（z_{1,2} 是 z² − z + g_S = 0 的根）：
 *   兩個實根（g_S < 1/4）：y_k = (z_1^{k+2} − z_2^{k+2})/(z_1 − z_2)
 *   重根 z = 1/2（g_S = 1/4）：y_k = (k + 2)/2^{k+1}
 *   共軛複根（g_S > 1/4）：y_k = ρ^{k+1}·sin((k + 2)φ)/sin φ，ρ = √g_S，cos φ = 1/(2ρ)
 * 三種都滿足 y_{−1} = y_0 = 1。紙筆只驗證夾住 5% 的兩項：k1 = k95 − 1（最後一次超過）與 k2 = k95（之後不再超過）。
 */
function exactSettleSteps(g: number, rhoS: number, k95: number): HandCalcStep[] {
  const k1 = k95 - 1
  const steps: HandCalcStep[] = []
  /** 顯示 |y| 時，位數要多到看得出它在 0.05 的哪一側（離 0.05 越近、需要的位數越多） */
  const near = (y: number): string => {
    const gap = Math.abs(Math.abs(y) - 0.05)
    return texNum(y, gap > 0 ? Math.min(12, Math.max(5, 2 + Math.ceil(-Math.log10(gap)))) : 12)
  }
  const side = (y: number): string => (Math.abs(y) > 0.05 ? '>' : String.raw`\le`)
  const disc = clean(1 - 4 * g)
  if (disc > 0) {
    const root = Math.sqrt(disc)
    const z1 = rhoS
    const z2 = 1 - z1
    steps.push({
      tex: String.raw`z_1=\rho_S,\quad z_2=1-z_1=1-${nearOne(z1)}=${texNum(z2, 6)}`,
      why: String.raw`兩個實根相加等於 $1$（$z^2-z+g_S=0$ 的係數）。平均遞迴 $y_{k+1}=y_k-g_S\,y_{k-1}$ 從 $y_0=y_{-1}=1$ 出發的解是 $y_k=\dfrac{z_1^{\,k+2}-z_2^{\,k+2}}{z_1-z_2}$（$k=-1$ 與 $k=0$ 代入都得 $1$）。`,
    })
    for (const [k, why] of [
      [k1, String.raw`最後一次還超過 $0.05$ 的 block：用計算機的 $y^x$ 鍵算兩個冪。$z_2$ 的冪小得多，常常可以忽略。`],
      [k95, String.raw`下一個 block 就降到 $0.05$ 以下。實根時每一步都減去一個正數 $g_S\,y_{k-1}$，$y_k$ 單調遞減，所以之後不會再超過 $0.05$。`],
    ] as const) {
      const n1 = z1 ** (k + 2)
      const n2 = z2 ** (k + 2)
      const y = (n1 - n2) / root
      // z_2 的冪比 z_1 的冪小 8 個數量級以上：6 位有效數字內等於 0，直接寫 0（z_2 ≈ z_1 的重根附近才會有感）
      const tiny = Math.abs(n2) < 1e-8 * Math.abs(n1)
      steps.push({
        tex: String.raw`y_{${k}}=\frac{z_1^{${k + 2}}-z_2^{${k + 2}}}{z_1-z_2}=\frac{${texNum(n1, 6)}-${tiny ? '0' : texNum(n2, 6)}}{${texNum(root, 6)}}=${near(y)}${side(y)}0.05`,
        why,
      })
    }
    return steps
  }
  if (disc === 0) {
    for (const [k, why] of [
      [k1, String.raw`重根 $z=\tfrac12$ 時 $y_k=(k+2)/2^{k+1}$（$k=-1,0$ 代入都得 $1$）。這是最後一次還超過 $0.05$ 的 block。`],
      [k95, String.raw`下一個 block 降到 $0.05$ 以下；$y_k$ 單調遞減，之後不會再超過。`],
    ] as const) {
      const y = (k + 2) / 2 ** (k + 1)
      steps.push({ tex: String.raw`y_{${k}}=\frac{${k}+2}{2^{${k}+1}}=\frac{${k + 2}}{${2 ** (k + 1)}}=${near(y)}${side(y)}0.05`, why })
    }
    return steps
  }
  // 共軛複根：ρ = √g_S，cos φ = 1/(2ρ)
  const phi = Math.acos(1 / (2 * rhoS))
  steps.push({
    tex: String.raw`\varphi=\arccos\frac{1}{2\rho_S}=\arccos\frac{1}{2\times${nearOne(rhoS)}}=\arccos(${texNum(1 / (2 * rhoS), 6)})=${deg(phi * RAD2DEG, 6)}`,
    why: String.raw`複根 $z=\rho_S e^{\pm j\varphi}$ 的相角（兩根相加 $=1$ ⇒ $2\rho_S\cos\varphi=1$）。從 $y_0=y_{-1}=1$ 出發的解是 $y_k=\dfrac{\rho_S^{\,k+1}\sin((k+2)\varphi)}{\sin\varphi}$（$k=-1$ 與 $k=0$ 代入都得 $1$）。`,
  })
  for (const [k, why] of [
    [k1, String.raw`最後一次還超過 $0.05$ 的 block（計算機切到 DEG 模式；取絕對值，複根的 $y_k$ 正負交替）。`],
    [k95, String.raw`下一個 block 降到 $0.05$ 以下。複根時 $y_k$ 正負交替，紙筆只能驗證這兩項夾住 $0.05$；「之後不再超過」要檢查之後的每個 block——判斷器逐 block 數到暫態消失為止。`],
  ] as const) {
    const A = rhoS ** (k + 1)
    const sn = Math.abs(Math.sin((k + 2) * phi))
    const y = (A * sn) / Math.sin(phi)
    steps.push({
      tex: String.raw`|y_{${k}}|=\frac{\rho_S^{${k + 1}}\left|\sin(${k + 2}\varphi)\right|}{\sin\varphi}=\frac{${texNum(A, 6)}\times${texNum(sn, 6)}}{${texNum(Math.sin(phi), 6)}}=${near(y)}${side(y)}0.05`,
      why,
    })
  }
  return steps
}

export const HANDCALCS: HandCalcDef[] = [
  // ─────────────────────────── HC-SO.1 freeze ± Δ：z 與所需 block 數（F-SO.1、F-SO.3） ───────────────────────────
  {
    id: 'HC-SO.1',
    title: String.raw`Freeze $\pm\Delta w$ 量測：這次量測判得出極性嗎？至少要幾個 block？`,
    page: '/signoff',
    formulaId: 'F-SO.3',
    // 兩行（桌機欄寬約 880px，一行排不下會出現橫向捲軸）：恢復力與標準誤；信心倍數與需要的 block 數
    formulaTex: String.raw`\begin{aligned}&K=K_qC=\frac{\sqrt{2/\pi}}{\sigma_v}\cos\theta,\qquad \mathrm{se}(\hat S)=\frac{\sigma_\eta}{\Delta\sqrt{2M}},\quad\sigma_\eta\approx\frac1{\sqrt N}\\[2pt]&z=\frac{K}{\mathrm{se}},\qquad M_{\min}=\Big\lceil M\Big(\frac{z_t}{z}\Big)^{2}\Big\rceil=\Big\lceil\frac{z_t^2}{2N\Delta^2K^2}\Big\rceil\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 80, 100, 200] } },
      { key: 'theta', symbol: String.raw`\theta`, label: '誤差路徑的有效相位（含 code delay）', unit: String.raw`^\circ`, default: 85, min: -180, max: 180, practice: { choices: [0, 30, 45, 60, 75, 80, 85, 95, 120] } },
      { key: 'delta', symbol: String.raw`\Delta`, label: '加在校正係數上的擾動', unit: String.raw`\mathrm{fs}`, default: 20, min: 0.01, max: 10000, practice: { choices: [10, 20, 25, 30] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', unit: String.raw`\text{samples}`, default: 4096, min: 1, max: 1e8, integer: true, practice: { choices: [1024, 2048, 4096, 16384] } },
      { key: 'M', symbol: 'M', label: '每一側量測的 block 數', unit: String.raw`\text{blocks}`, default: 8, min: 1, max: 1e6, integer: true, practice: { choices: [2, 4, 8, 16, 32] } },
      { key: 'zt', symbol: 'z_t', label: '判決要求的信心倍數', default: 3, min: 0.5, max: 10, practice: { choices: [2, 3, 4, 6] } },
    ],
    validate: ({ sigmaV, theta, delta }) => {
      if (Math.abs(Math.cos(theta * DEG2RAD)) < 1e-9) {
        return String.raw`$\theta=\pm90^\circ\Rightarrow C=\cos\theta=0$：GMAC 用的 code 與誤差路徑的輸出完全不相關，沒有恢復力（$K=0$）。這時 $z=0$、所需的 $M\to\infty$——不是量測不夠久，而是這個 FCW／delay 設定下參數不可辨識；請改 code delay $D$ 或換一個 $\theta$。`
      }
      if (delta > sigmaV) {
        return String.raw`$\Delta=${inp(delta)}$ fs $>\sigma_v=${inp(sigmaV)}$ fs：擾動已經把 comparator 推進 erf 的飽和區。小訊號的 $K=K_qC$ 會高估量得到的斜率（identity path 時只剩 $${texNum(secantRatio(delta, sigmaV), 3)}$ 倍，F-SO.2），$\sigma_\eta\approx1/\sqrt N$ 也不再準——這一題的 $z$ 與 $M_{\min}$ 不適用。請把 $\Delta$ 降到 $\sigma_v$ 以下（建議 $\Delta\le0.3\sigma_v=${texNum(0.3 * sigmaV)}$ fs）。`
      }
      return null
    },
    solve: ({ sigmaV, theta, delta, N, M, zt }) => {
      const Kq = kq(sigmaV)
      const C = clean(Math.cos(theta * DEG2RAD))
      const K = Kq * C
      const rootN = Math.sqrt(N)
      const sigmaEta = 1 / rootN
      const root2M = Math.sqrt(2 * M)
      const se = slopeStdErr(delta, N, M)
      const z = K / se
      const mNeed = requiredBlocks(K, delta, N, zt)
      const ratio = zt / Math.abs(z)
      // requiredBlocks 內部取上整的量；數學上等於 M·(z_t/z)²
      const mArg = (zt * zt) / (2 * N * delta * delta * K * K)
      const verdict =
        z > zt
          ? String.raw`期望 $z=${texNum(z, 4)}>z_t=${inp(zt)}$：平均而言判得出「極性正確」。但 $\hat K$ 本身有雜訊，實際的 $\hat K/\mathrm{se}$ 以 $${texNum(z, 4)}$ 為中心、標準差 $1$ 散布；$z$ 只比 $z_t$ 高一點時，仍有不小的機率落在「無法判定」。`
          : z < -zt
            ? String.raw`期望 $z=${texNum(z, 4)}<-z_t$：$C<0$，量測會顯著判為「極性錯誤」——正的 $\mu$ 會讓平均誤差發散（pole $1-\mu K>1$）。要修的是 code delay／filtered-x，不是 $M$。`
            : String.raw`$|z|=${texNum(Math.abs(z), 4)}\le z_t=${inp(zt)}$：這次量測多半「無法判定」。把每側的 block 數加到 $M\ge${int(mNeed)}$（或加大 $\Delta$、$N$）再量。`
      const notes = [verdict, String.raw`$z\propto\Delta\sqrt{MN}$：要把 $z$ 加倍，$M$ 要 4 倍，或 $\Delta$ 加倍（但 $\Delta\le0.3\sigma_v=${texNum(0.3 * sigmaV)}$ fs 才不會有明顯的 erf 截斷偏差）。`]
      if (delta > 0.3 * sigmaV) {
        notes.push(String.raw`這裡 $\Delta=${inp(delta)}$ fs $>0.3\sigma_v$：實際量到的 $|\hat K|$ 比小訊號 $K_qC$ 小（identity path 的截斷比 $r_\text{CD}=${texNum(secantRatio(delta, sigmaV), 4)}$，F-SO.2），判極性沒問題，但期望的 $z$ 也要打同樣的折扣，而且別拿它直接設計 $\mu$。`)
      }
      return {
        steps: [
          { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${inp(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`, why: String.raw`1-bit comparator 的小訊號增益；$\sqrt{2/\pi}=0.79788$ 可以直接背。` },
          { tex: String.raw`C=\cos\theta=\cos(${deg(theta, 10)})=${texNum(C)}`, why: String.raw`有效相關（$|H|=1$、unit-RMS code）：計算機切到 DEG 模式按 $\cos$。$C<0$ 代表極性相反。` },
          { tex: String.raw`K=K_q\,C=${texNum(Kq)}\times${texNumP(C)}=${texNum(K)}\ \mathrm{fs}^{-1}`, why: String.raw`恢復力：$w$ 偏離 $1$ fs 時，GMAC 平均值改變多少。` },
          { tex: String.raw`\sigma_\eta\approx\frac1{\sqrt N}=\frac1{\sqrt{${int(N)}}}=\frac1{${texNum(rootN)}}=${texNum(sigmaEta)}`, why: String.raw`一個 block 的 GMAC 雜訊：$N$ 個 $\pm1$ 的平均，標準差 $1/\sqrt N$（先開根號，再取倒數）。` },
          { tex: String.raw`\sqrt{2M}=\sqrt{2\times${int(M)}}=\sqrt{${int(2 * M)}}=${texNum(root2M)}`, why: String.raw`兩側各 $M$ 個 block、變異數相加，所以出現 $2M$。` },
          {
            tex: String.raw`\mathrm{se}=\frac{\sigma_\eta}{\Delta\sqrt{2M}}=\frac{${texNum(sigmaEta)}}{${inp(delta)}\times${texNum(root2M)}}=\frac{${texNum(sigmaEta)}}{${texNum(delta * root2M)}}=${texNum(se)}\ \mathrm{fs}^{-1}`,
            why: String.raw`斜率估計的標準誤（F-SO.3）：分母先乘起來再除。`,
          },
          { tex: String.raw`z=\frac{K}{\mathrm{se}}=\frac{${texNum(K)}}{${texNum(se)}}=${texNum(z)}`, why: String.raw`信心倍數：真實恢復力是量測誤差的幾倍。$z>z_t$ 才判得出「極性正確」，$z<-z_t$ 則顯著判為「極性錯誤」。` },
          { tex: String.raw`\frac{z_t}{|z|}=\frac{${inp(zt)}}{${texNum(Math.abs(z))}}=${texNum(ratio)}`, why: String.raw`$z\propto\sqrt M$：要讓 $|z|$ 變成 $z_t$，$M$ 要乘上這個比值的平方。` },
          {
            tex: String.raw`M_{\min}=\Big\lceil M\Big(\frac{z_t}{z}\Big)^{2}\Big\rceil=\big\lceil${int(M)}\times${sq(ratio)}\big\rceil=\big\lceil${int(M)}\times${texNum(ratio * ratio)}\big\rceil=\left\lceil${ceilArg(mArg, mNeed)}\right\rceil=${int(mNeed)}`,
            why: String.raw`$\lceil\cdot\rceil$ 是無條件進位（block 數必須是整數，而且至少 $1$）。把 $z$ 的定義代回去，就是 F-SO.3 的 $z_t^2/(2N\Delta^2K^2)$——和 $M$ 無關。`,
          },
        ],
        results: [
          { symbol: 'K', label: '恢復力', value: K, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: String.raw`\mathrm{se}`, label: '斜率的標準誤', value: se, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: 'z', label: '期望的信心倍數', value: z },
          { symbol: String.raw`M_{\min}`, label: '每側至少要幾個 block', value: mNeed, unit: String.raw`\text{blocks}`, digits: 10, tolerance: CEIL_TOL },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例（§2.1 的數字）：$K_q=0.0079788$、$C=\cos85^\circ=0.087156$、$K=0.0006954$、$\mathrm{se}=0.00019531$、$z=3.5605$、$M_{\min}=6$——和 §2.1 表格最後三列相同。`,
      String.raw`心算捷徑：$z=K\Delta\sqrt{2MN}$。$N=4096$、$M=8$ 時 $\sqrt{2MN}=\sqrt{65536}=256$，所以 $z=256\,K\Delta$。`,
      String.raw`$\theta$ 換成 $95^\circ$ 再算一次：$C$ 變成負的，$z$ 也變負——同樣的量測會（不太有把握地）判為「極性錯誤」。`,
      String.raw`$M_{\min}$ 對四捨五入很敏感：中間量至少留 4 位有效數字，最後一步才無條件進位。`,
    ],
  },

  // ─────────────────────────── HC-SO.2 兩參數 Jacobian：行列式的符號與可辨識性門檻（F-SO.6、F-SO.12） ───────────────────────────
  {
    id: 'HC-SO.2',
    title: String.raw`GOS／PHOS 兩參數：$\mathbf J$ 的行列式、$\sigma_{\min}$，以及這次量測分得出「不是奇異」嗎？`,
    page: '/signoff',
    formulaId: 'F-SO.12',
    // 三行（一行排不下會出現橫向捲軸）：Jacobian 與 B；最大奇異值；可辨識性的判準
    formulaTex: String.raw`\begin{aligned}&\mathbf J=-K_q\mathbf B,\quad \mathbf B=\mathbf R\,\mathrm{diag}(c_G,c_P)=\begin{bmatrix}c_G&\rho_{GP}c_P\\\rho_{GP}c_G&c_P\end{bmatrix}\\[2pt]&\sigma_{\max}(\mathbf B)=\sqrt{\frac{F+\sqrt{F^2-4\det^2\mathbf B}}{2}},\quad F=\|\mathbf B\|_F^2\\[2pt]&\sigma_{\min}(\mathbf J)=K_q\frac{|\det\mathbf B|}{\sigma_{\max}(\mathbf B)}\ \overset{?}{>}\ z\,\|\mathrm{se}\|_F=\frac{2z}{\Delta\sqrt{2MN}}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'rho', symbol: String.raw`\rho_{GP}`, label: '兩個 regressor 的相關係數', default: 0.3, min: -1, max: 1, practice: { choices: [0, 0.3, 0.5, 0.7, 0.9] } },
      { key: 'cG', symbol: 'c_G', label: 'GOS 路徑的有效相關', default: 1, min: -2, max: 2, practice: { choices: [0.5, 1] } },
      { key: 'cP', symbol: 'c_P', label: 'PHOS 路徑的有效相關（可以是負的）', default: 0.8, min: -2, max: 2, practice: { choices: [-0.8, 0.5, 0.8, 1] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'delta', symbol: String.raw`\Delta`, label: '每個參數的擾動（兩個參數相同）', unit: String.raw`\mathrm{fs}`, default: 20, min: 0.01, max: 10000, practice: { choices: [10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', unit: String.raw`\text{samples}`, default: 2048, min: 1, max: 1e8, integer: true, practice: { choices: [1024, 2048, 4096] } },
      { key: 'M', symbol: 'M', label: '每次擾動每一側的 block 數', unit: String.raw`\text{blocks}`, default: 12, min: 2, max: 1e6, integer: true, practice: { choices: [4, 8, 12, 16] } },
      { key: 'z', symbol: 'z', label: '判決要求的信心倍數', default: 3, min: 0.5, max: 10, practice: { choices: [2, 3] } },
    ],
    validate: ({ cG, cP, sigmaV, delta }) => {
      if (cG === 0 && cP === 0) return String.raw`$c_G=c_P=0$：兩條路徑的有效相關都是 $0$，$\mathbf J=\mathbf 0$——兩個 GMAC 對兩個參數都沒有反應，$\sigma_{\max}=\sigma_{\min}=0$（式子變成 $0/0$）。這不是「不容易辨識」，而是完全沒有資訊；請至少給一條路徑非零的 $c$。`
      const cMax = Math.max(Math.abs(cG), Math.abs(cP))
      if (delta * cMax > sigmaV) {
        return String.raw`$\Delta\,|c|_{\max}=${texNum(delta * cMax)}$ fs $>\sigma_v=${inp(sigmaV)}$ fs：擾動把 comparator 推進 erf 的飽和區，量到的 $\hat{\mathbf J}$ 會明顯小於小訊號的 $-K_q\mathbf B$（截斷比 $${texNum(secantRatio(delta * cMax, sigmaV), 3)}$，F-SO.2），$\sigma_\eta\approx1/\sqrt N$ 也不再準——這一題的門檻不適用。請把 $\Delta$ 降到 $\sigma_v/|c|_{\max}$ 以下（建議 $\Delta\,|c|_{\max}\le0.3\sigma_v$）。`
      }
      return null
    },
    solve: ({ rho, cG, cP, sigmaV, delta, N, M, z }) => {
      const Kq = kq(sigmaV)
      const J = twoParamJlin({ rho, cG, cP, sigmaV })
      const [sMaxJ, sMinJ] = svd(J).S
      const offGP = clean(rho * cP)
      const offPG = clean(rho * cG)
      const prodDiag = cG * cP
      const prodOff = offGP * offPG
      const det = clean(prodDiag - prodOff)
      const F = cG * cG + offGP * offGP + offPG * offPG + cP * cP
      const inner = Math.max(0, clean(F * F - 4 * det * det))
      const disc = Math.sqrt(inner)
      const sMaxB = sMaxJ / Kq
      const sMinB = clean(sMinJ / Kq)
      const sigmaMin = clean(sMinJ)
      const root = Math.sqrt(2 * M * N)
      const se = slopeStdErr(delta, N, M)
      const thr = identifiabilityThreshold(
        [
          [se, se],
          [se, se],
        ],
        z,
      )
      const ratio = sigmaMin / thr
      const identifiable = sigmaMin > thr
      // σ_min > 2z·se(M) ⇔ M ≥ (2z)²/(2NΔ²σ_min²)：就是 requiredBlocks 把 z 換成 2z
      const mNeed = sigmaMin > 0 ? requiredBlocks(sigmaMin, delta, N, 2 * z) : Infinity
      const notes: string[] = []
      if (det === 0) notes.push(String.raw`$\det\mathbf B=0$：$\mathbf J$ 奇異（$|\rho_{GP}|=1$ 或某條路徑的 $c=0$），有一個參數組合完全沒有資訊——$\sigma_{\min}=0$，量再久也不會過門檻。要凍結其中一個參數，或換一組不那麼相關的 regressor。`)
      else if (det < 0) notes.push(String.raw`$\det\mathbf B=${texNum(det, 4)}<0$（$c_Gc_P<0$）：$\mathbf B$ 有一個負的 eigenvalue，對任何 $\mu>0$ 都有一個發散模式——其中一個 loop 的極性相反。注意「可辨識」（$\sigma_{\min}$ 夠大）和「極性正確」是兩件事，要分開檢查。`)
      else if (cG < 0) notes.push(String.raw`$\det\mathbf B=${texNum(det, 4)}>0$，但 $c_G$、$c_P$ 都是負的：兩個 loop 的極性「都」相反（對角 $J_{ii}=-K_qc_i>0$）。行列式看不出這件事——極性要看對角元素的符號，不能只看 $\det$。`)
      else notes.push(String.raw`$\det\mathbf B=${texNum(det, 4)}>0$，而且 $c_G,c_P>0$：兩個 loop 的極性都正確，只有步長太大才會不穩（各自／一起更新的 pole 見 Ch10 的 T18 手算題）。`)
      if (det !== 0) {
        notes.push(
          identifiable
            ? String.raw`$\sigma_{\min}(\mathbf J)$ 是門檻的 $${texNum(ratio, 3)}$ 倍（$>1$）：這個量測長度足以排除「$\mathbf J$ 奇異」，誤判機率 $\le1/z^2=${texNum(100 / (z * z), 3)}\%$（Weyl + Markov，不需要分布假設）。`
            : String.raw`$\sigma_{\min}(\mathbf J)$ 只有門檻的 $${texNum(ratio, 3)}$ 倍（$\le1$）：這次量測分不出「接近奇異」與「真的奇異」。門檻 $\propto1/\sqrt M$，要每側 $M\ge${int(mNeed)}$ 個 block 才過得了（或加大 $\Delta$、$N$）；量不起就凍結其中一個參數。`,
        )
      }
      notes.push(String.raw`這裡的 $\mathrm{se}$ 是量測前的預期值（$\sigma_\eta\approx1/\sqrt N$）；實驗用每個元素的樣本標準誤代入，數字會差幾個百分點。`)
      return {
        steps: [
          { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${inp(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`, why: String.raw`comparator 的小訊號增益。它只是整個 $\mathbf J$ 的公因數，所以先把它提出來，用無因次的 $\mathbf B=-\mathbf J/K_q$ 算。` },
          {
            tex: String.raw`\mathbf B=\begin{bmatrix}c_G&\rho_{GP}c_P\\\rho_{GP}c_G&c_P\end{bmatrix}=\begin{bmatrix}${inp(cG)}&${inp(rho)}\times${inpP(cP)}\\${inp(rho)}\times${inpP(cG)}&${inp(cP)}\end{bmatrix}=\begin{bmatrix}${inp(cG)}&${num(offGP)}\\${num(offPG)}&${inp(cP)}\end{bmatrix}`,
            why: String.raw`F-SO.6：對角是各自路徑的有效相關，非對角多乘一個 regressor 相關 $\rho_{GP}$（兩次乘法）。$c_G\ne c_P$ 時 $\mathbf B$ 不對稱。`,
          },
          {
            tex: String.raw`\det\mathbf B=c_Gc_P-(\rho_{GP}c_P)(\rho_{GP}c_G)=${inp(cG)}\times${inpP(cP)}-${numP(offGP)}\times${numP(offPG)}=${num(prodDiag)}-${numP(prodOff)}=${num(det)}`,
            why: String.raw`$2\times2$ 行列式：主對角相乘減副對角相乘（$=c_Gc_P(1-\rho_{GP}^2)$）。$|\rho_{GP}|<1$ 時它的符號就是 $c_Gc_P$ 的符號。`,
          },
          {
            tex: String.raw`F=\|\mathbf B\|_F^2=${sq(cG)}+${sq(offGP)}+${sq(offPG)}+${sq(cP)}=${num(cG * cG)}+${num(offGP * offGP)}+${num(offPG * offPG)}+${num(cP * cP)}=${num(F)}`,
            why: String.raw`四個元素的平方和。它等於兩個奇異值的平方和：$F=\sigma_{\max}^2+\sigma_{\min}^2$；而 $|\det\mathbf B|=\sigma_{\max}\sigma_{\min}$。`,
          },
          {
            // \nolimits：獨立公式（display style）裡 \det^2 的 2 會被排到 det 的正上方，看起來像打錯
            tex: String.raw`\begin{aligned}\sqrt{F^2-4\det\nolimits^2\mathbf B}&=\sqrt{${sq(F)}-4\times${sq(det)}}=\sqrt{${num(F * F)}-4\times${num(det * det)}}\\&=\sqrt{${num(F * F)}-${num(4 * det * det)}}=\sqrt{${num(inner)}}=${texNum(disc)}\end{aligned}`,
            why: String.raw`$\sigma^2$ 是 $t^2-Ft+\det^2\mathbf B=0$ 的兩個根（和 $=F$、積 $=\det^2$），這是它的判別式開根號，等於 $\sigma_{\max}^2-\sigma_{\min}^2$。依序：兩個平方、乘 $4$、相減、開根號。`,
          },
          {
            tex: String.raw`\sigma_{\max}(\mathbf B)=\sqrt{\frac{F+\sqrt{F^2-4\det^2\mathbf B}}{2}}=\sqrt{\frac{${num(F)}+${texNum(disc)}}{2}}=\sqrt{\frac{${texNum(F + disc)}}{2}}=\sqrt{${texNum((F + disc) / 2)}}=${texNum(sMaxB)}`,
            why: String.raw`取 $+$ 號的根（相加、除以 $2$），再開根號。`,
          },
          {
            tex: String.raw`\sigma_{\min}(\mathbf B)=\frac{|\det\mathbf B|}{\sigma_{\max}(\mathbf B)}=\frac{${num(Math.abs(det))}}{${texNum(sMaxB)}}=${texNum(sMinB)}`,
            why: String.raw`不要用 $\sqrt{(F-\sqrt{\cdots})/2}$：接近奇異時那是兩個幾乎相等的數相減，手算會把有效位數全部丟光。用「積 $=|\det|$」除回來才準。`,
          },
          { tex: String.raw`\sigma_{\min}(\mathbf J)=K_q\,\sigma_{\min}(\mathbf B)=${texNum(Kq)}\times${texNum(sMinB)}=${texNum(sigmaMin)}\ \mathrm{fs}^{-1}`, why: String.raw`把公因數 $K_q$ 乘回來（$\mathbf J=-K_q\mathbf B$，負號不影響奇異值）。` },
          { tex: String.raw`\sqrt{2MN}=\sqrt{2\times${int(M)}\times${int(N)}}=\sqrt{${int(2 * M * N)}}=${texNum(root)}`, why: String.raw`每個元素的標準誤和 §2.2 相同：$\mathrm{se}=\frac{\sigma_\eta}{\Delta\sqrt{2M}}=\frac1{\Delta\sqrt{2MN}}$。` },
          { tex: String.raw`\mathrm{se}=\frac{1}{\Delta\sqrt{2MN}}=\frac{1}{${inp(delta)}\times${texNum(root)}}=\frac{1}{${texNum(delta * root)}}=${texNum(se)}\ \mathrm{fs}^{-1}`, why: String.raw`四個元素用同樣的 $\Delta$、$N$、$M$，所以標準誤都一樣。` },
          {
            tex: String.raw`z\,\|\mathrm{se}\|_F=z\sqrt{4\,\mathrm{se}^2}=2z\,\mathrm{se}=2\times${inp(z)}\times${texNum(se)}=${texNum(thr)}\ \mathrm{fs}^{-1}`,
            why: String.raw`F-SO.12 的門檻：四個元素的 $\mathrm{se}^2$ 相加再開根號是 $2\,\mathrm{se}$，再乘信心倍數 $z$。`,
          },
          {
            tex: String.raw`\frac{\sigma_{\min}(\mathbf J)}{z\,\|\mathrm{se}\|_F}=\frac{${texNum(sigmaMin)}}{${texNum(thr)}}=${texNum(ratio)}`,
            why: String.raw`大於 $1$ 才算「顯著不是 $0$」。${identifiable ? '這組數字過得了門檻。' : '這組數字過不了門檻。'}`,
          },
        ],
        results: [
          { symbol: String.raw`\det\mathbf B`, label: '無因次 Jacobian 的行列式', value: det, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: String.raw`\sigma_{\min}(\mathbf J)`, label: '最小奇異值', value: sigmaMin, unit: String.raw`\mathrm{fs}^{-1}`, tolerance: { abs: 1e-12, rel: 0.01 } },
          { symbol: String.raw`z\,\|\mathrm{se}\|_F`, label: '可辨識性門檻', value: thr, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: String.raw`\sigma_{\min}/(z\|\mathrm{se}\|_F)`, label: '最小奇異值是門檻的幾倍', value: ratio, tolerance: { abs: 1e-6, rel: 0.02 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例（本頁 SSPLL 實驗的預設值）：$\mathbf B=\begin{bmatrix}1&0.24\\0.3&0.8\end{bmatrix}$、$\det\mathbf B=0.728$、$F=1.7876$、$\sigma_{\max}(\mathbf B)=1.1884$、$\sigma_{\min}(\mathbf B)=0.61258$、$\sigma_{\min}(\mathbf J)=0.0048877$ fs$^{-1}$；門檻 $0.0013532$ fs$^{-1}$，是 $3.612$ 倍——和實驗顯示的「可辨識性：顯著」一致。`,
      String.raw`$c_G=c_P=c$ 時可以心算：$\sigma_{\max}=|c|\,(1+|\rho_{GP}|)$、$\sigma_{\min}=|c|\,(1-|\rho_{GP}|)$。`,
      String.raw`把 $\rho_{GP}$ 改成 $0.995$、$c_P$ 改成 $1$（實驗的「不可辨識」preset）：$\sigma_{\min}(\mathbf B)=0.005$，只有門檻的 $0.03$ 倍——要一萬多個 block 才分得出來。`,
      String.raw`把 $c_P$ 改成 $-0.8$：$\det\mathbf B$ 變號，$\sigma_{\min}$ 卻完全一樣（把矩陣的一行變號不改變奇異值）——可辨識卻極性相反，這正是 SSPLL 某些 mode 下 PHOS 的情況。`,
    ],
  },

  // ─────────────────────────── HC-SO.3 0 次失效的證據強度（F-SO.8） ───────────────────────────
  {
    id: 'HC-SO.3',
    title: String.raw`$n$ 次試驗 0 次失效：失效機率的上界，以及要跑幾次才夠`,
    page: '/signoff',
    formulaId: 'F-SO.8',
    formulaTex: String.raw`p_U=1-\alpha^{1/n}\approx\frac{-\ln\alpha}{n},\qquad n_\text{need}=\left\lceil\frac{\ln\alpha}{\ln(1-p_{\max})}\right\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'n', symbol: 'n', label: '獨立試驗數（seeds 數乘以 sweep 點數）', default: 100, min: 1, max: 1e6, integer: true, practice: { choices: [20, 30, 50, 100, 200, 500, 1000] } },
      { key: 'alpha', symbol: String.raw`\alpha`, label: '顯著水準（一減信心水準）', default: 0.05, min: 0, max: 1, practice: { choices: [0.01, 0.05, 0.1] } },
      { key: 'pMax', symbol: String.raw`p_{\max}`, label: '想宣稱的失效機率上限', default: 0.01, min: 0, max: 1, practice: { choices: [0.001, 0.005, 0.01, 0.02, 0.05] } },
    ],
    validate: ({ alpha, pMax }) => {
      if (!(alpha > 0)) return String.raw`$\alpha=0$（信心 $100\%$）：有限次試驗永遠排除不了任何 $p<1$——$(1-p)^n>0$ 對每個 $p<1$ 都成立，所以 $p_U=1$、$n_\text{need}\to\infty$。請給 $0<\alpha<1$（常用 $0.05$ 或 $0.01$）。`
      if (alpha >= 1) return String.raw`$\alpha\ge1$（信心 $\le0\%$）：$p_U=1-\alpha^{1/n}\le0$，等於什麼都沒宣稱。請給 $0<\alpha<1$（常用 $0.05$ 或 $0.01$）。`
      if (!(pMax > 0)) return String.raw`$p_{\max}=0$：要宣稱「失效機率是 $0$」需要無限多次試驗（$\ln(1-p_{\max})=0$，$n_\text{need}\to\infty$）——Monte Carlo 只能把上界壓低，不能證明「不會失效」（附錄 B 第 8 點）。請填一個 $0<p_{\max}<1$ 的上限。`
      if (pMax >= 1) return String.raw`$p_{\max}\ge1$：任何失效機率都 $\le1$，不用做試驗就成立（$\ln(1-p_{\max})$ 無定義）。請填想宣稱的上限，例如 $0.01$。`
      return null
    },
    solve: ({ n, alpha, pMax }) => {
      const lnA = Math.log(alpha)
      const expo = lnA / n
      const root = Math.exp(expo)
      const pU = failureUpperBound(0, n, 1 - alpha)
      const approx = -lnA / n
      const ln1p = Math.log(1 - pMax)
      const nNeed = trialsForZeroFailure(pMax, 1 - alpha)
      const over = 100 * (approx / pU - 1)
      return {
        steps: [
          { tex: String.raw`\ln\alpha=\ln(${inp(alpha)})=${texNum(lnA)}`, why: String.raw`計算機按 $\ln$。$\alpha=0.05$ 時 $\ln\alpha=-2.9957\approx-3$——「rule of three」的 $3$ 就是它。` },
          { tex: String.raw`\frac{\ln\alpha}{n}=\frac{${texNum(lnA)}}{${int(n)}}=${texNum(expo)}`, why: String.raw`$\alpha^{1/n}=e^{(\ln\alpha)/n}$：先算指數。` },
          {
            tex: String.raw`\alpha^{1/n}=e^{${texNum(expo)}}=${nearOne(root)}`,
            why: String.raw`按 $e^x$。這是「若失效機率剛好是 $p_U$，$n$ 次全過的機率等於 $\alpha$」時的單次成功率 $1-p_U$。它很接近 $1$，要多留幾位小數（下一步要被 $1$ 減）；計算機位數不夠時直接用後面的近似式。`,
          },
          { tex: String.raw`p_U=1-\alpha^{1/n}=1-${nearOne(root)}=${texNum(pU)}`, why: String.raw`失效機率的單邊上界（信心 $1-\alpha$）。` },
          {
            tex: String.raw`p_U\approx\frac{-\ln\alpha}{n}=\frac{${texNum(-lnA)}}{${int(n)}}=${texNum(approx)}`,
            why: String.raw`$n$ 大時 $e^{-t}\approx1-t$ 的近似（rule of three）。它比上一步的精確值大 $${texNum(over, 2)}\%$（約 $\frac{-\ln\alpha}{2n}$）：偏保守，$n$ 越大越準。`,
          },
          {
            tex: String.raw`\ln(1-p_{\max})=\ln(1-${inp(pMax)})=\ln(${inp(1 - pMax)})=${texNum(ln1p)}`,
            why: String.raw`反過來問「要宣稱 $p\le p_{\max}$ 需要幾次」：$(1-p_{\max})^n\le\alpha$ 兩邊取 $\ln$。小 $p_{\max}$ 時 $\ln(1-p_{\max})\approx-p_{\max}$。`,
          },
          {
            tex: String.raw`n_\text{need}=\left\lceil\frac{\ln\alpha}{\ln(1-p_{\max})}\right\rceil=\left\lceil\frac{${texNum(lnA)}}{${texNum(ln1p)}}\right\rceil=\left\lceil${ceilArg(lnA / ln1p, nNeed)}\right\rceil=${int(nNeed)}`,
            why: String.raw`兩個負數相除得正數；除以負數時不等號方向反轉，所以是 $n\ge\cdots$，再無條件進位。`,
          },
        ],
        results: [
          { symbol: 'p_U', label: '失效機率上界', value: pU },
          { symbol: String.raw`n_\text{need}`, label: '零失效時要達到宣稱上限所需的試驗數', value: nNeed, digits: 10, tolerance: CEIL_TOL },
        ],
        notes: [
          pU <= pMax
            ? String.raw`$p_U=${texNum(pU, 4)}\le p_{\max}=${inp(pMax)}$：這 $${int(n)}$ 次 0 失效，已足以（在信心 $${texNum(100 * (1 - alpha), 6)}\%$ 下）宣稱失效機率不超過 $p_{\max}$。`
            : String.raw`$p_U=${texNum(pU, 4)}>p_{\max}=${inp(pMax)}$：$${int(n)}$ 次還不夠，要 $${int(nNeed)}$ 次全過才能宣稱 $p\le p_{\max}$。`,
          String.raw`這個上界只對「與試驗同分布的隨機條件」成立：掃的是均勻隨機 FCW，就不能推論到某個特定的 near-integer FCW；seeds 若共用同一段雜訊（不獨立），有效的 $n$ 更小。`,
          String.raw`再多 seeds 也只是把上界壓低，永遠不會變成「證明穩定」（附錄 B 第 8 點）。`,
        ],
      }
    },
    tips: [
      String.raw`範例 $n=100$、$\alpha=0.05$：$\ln\alpha=-2.9957$、$\alpha^{1/100}=e^{-0.029957}=0.970487$、$p_U=0.029513$（rule of three 給 $0.03$）；要宣稱 $p\le1\%$ 需 $n_\text{need}=299$。`,
      String.raw`沒有 $e^x$ 鍵時：直接用 $p_U\approx3/n$（$95\%$）或 $4.6/n$（$99\%$）；$n\ge50$ 時只高估不到 $5\%$，而且偏保守。`,
      String.raw`有失效（$k_f>0$）時不能用這個公式，要解二項分布的 $P(X\le k_f\mid n,p_U)=\alpha$（Clopper–Pearson；本頁「證據強度」實驗會幫你算）。`,
    ],
  },

  // ─────────────────────────── HC-SO.4 同一個 μ：最快與最慢的 corner（§4 Corner 判斷器、F-SO.5） ───────────────────────────
  {
    id: 'HC-SO.4',
    title: String.raw`同一個 $\mu$ 過兩個 corner：最快的 $PM_d$ 夠嗎？最慢的 $B$ 次內收斂嗎？`,
    page: '/signoff',
    formulaId: 'F-SO.5',
    // 四行（一行排不下會出現橫向捲軸；每一行都不比第一行寬）：每個 corner 的 g 與最快 corner 的 PM；最慢 corner 的 ρ；k95 的定義；k95 用的平均遞迴（d = 0 時 k95 = ⌈ln 0.05/ln ρ⌉，見步驟）
    formulaTex: String.raw`\begin{aligned}&g_c=\mu K_q(\sigma_{v,c})\cos\theta_c,\qquad PM_d(g_F)=90^\circ-(2d+1)\arcsin\frac{g_F}{2}\ge PM_t\\[2pt]&\rho_S=\begin{cases}|1-g_S|&d=0\\[2pt]\max|z|:\ z^2-z+g_S=0&d=1\end{cases}\\[2pt]&k_{95}=1+\max\{k:\ |y_k|>0.05\}\le B\\[2pt]&y_{k+1}=y_k-g_S\,y_{k-d},\quad y_0=y_{-1}=1\end{aligned}`,
    level: 'engineer',
    // g、PM_d、ρ_S 與 k95（平均遞迴逐 block 數、判斷器同一個函式）在線性化一階模型內都是精確的；⌈ln 0.05/ln ρ_S⌉ 只是步驟裡另列的「漸近估計」
    claim: 'exact',
    inputs: [
      { key: 'sigmaF', symbol: String.raw`\sigma_{v,F}`, label: '最快的 corner：comparator 雜訊', unit: String.raw`\mathrm{fs}`, default: 70, min: 1, max: 10000, practice: { choices: [50, 70, 80, 100] } },
      { key: 'thetaF', symbol: String.raw`\theta_F`, label: '最快的 corner：有效相位', unit: String.raw`^\circ`, default: 10, min: -180, max: 180, practice: { choices: [0, 10, 20, 30] } },
      { key: 'sigmaS', symbol: String.raw`\sigma_{v,S}`, label: '最慢的 corner：comparator 雜訊', unit: String.raw`\mathrm{fs}`, default: 100, min: 1, max: 10000, practice: { choices: [100, 140, 200] } },
      { key: 'thetaS', symbol: String.raw`\theta_S`, label: '最慢的 corner：有效相位', unit: String.raw`^\circ`, default: 60, min: -180, max: 180, practice: { choices: [45, 60, 70] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate（所有 corner 共用）', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 1e5, practice: { choices: [5, 10, 20, 30] } },
      { key: 'd', symbol: 'd', label: '更新（commit）延遲', unit: String.raw`\text{blocks}`, default: 1, min: 0, max: 6, integer: true, practice: { choices: [0, 1] } },
      { key: 'pmT', symbol: 'PM_t', label: '要求的 phase margin 下限', unit: String.raw`^\circ`, default: 60, min: 0, max: 89, practice: { choices: [30, 45, 60] } },
      { key: 'B', symbol: 'B', label: '允許的更新次數', unit: String.raw`\text{blocks}`, default: 120, min: 1, max: 1e7, integer: true, practice: { choices: [50, 100, 120, 200] } },
    ],
    validate: ({ sigmaF, thetaF, sigmaS, thetaS, mu, d }) => {
      if (d >= 2) {
        return String.raw`$d=${int(d)}\ge2$：特徵方程 $z^{d+1}-z^d+g=0$ 是三次以上，沒有紙筆好用的求根公式。這一題只做 $d=0$（$\rho=|1-g|$）與 $d=1$（二次式）；$d\ge2$ 請用下面的 Corner 判斷器（數值求根）——它算的是同一組判準。`
      }
      const cF = Math.cos(thetaF * DEG2RAD)
      const cS = Math.cos(thetaS * DEG2RAD)
      if (cF <= 1e-9 || cS <= 1e-9) {
        return String.raw`C ≤ 0：${cF <= 1e-9 ? '最快' : '最慢'}的 corner $\cos\theta\le0$，恢復力 $K=K_q\cos\theta\le0$——更新極性錯誤（或沒有恢復力），任何正的 $\mu$ 都讓這個 corner 的平均誤差發散，$PM$ 與收斂時間都沒有意義。先修正 code delay／filtered-x（或在這個 corner freeze），再回來選 $\mu$。`
      }
      const KF = kq(sigmaF) * cF
      const KS = kq(sigmaS) * cS
      if (KF < KS) {
        return String.raw`你填的「最快」corner 的 $K_F=${texNum(KF, 4)}$ fs$^{-1}$ 比「最慢」的 $K_S=${texNum(KS, 4)}$ fs$^{-1}$ 還小：請把兩組數字對調。$K=K_q\cos\theta$ 最大的 corner 決定穩定與 $PM$ 的上限，最小的決定收斂時間。`
      }
      if (mu * KF > 2) {
        return String.raw`$g_F=\mu K_F=${texNum(mu * KF, 4)}>2$：$|L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}>1$ 對所有頻率成立，沒有 gain crossover（$\arcsin\frac{g_F}{2}$ 無實數解）；pole $1-g_F<-1$，連無延遲的一階模型都發散。請把 $\mu$ 調小。`
      }
      if (mu * KS >= gCrit(d)) {
        return String.raw`$g_S=\mu K_S=${texNum(mu * KS, 4)}\ge g_\text{crit}(${int(d)})=${texNum(gCrit(d), 4)}$：連最慢的 corner 都不穩定（$\rho_S\ge1$），更快的 corner 當然也是——沒有「收斂時間」可言。請把 $\mu$ 調小。`
      }
      return null
    },
    solve: ({ sigmaF, thetaF, sigmaS, thetaS, mu, d, pmT, B }) => {
      const [F, S] = cornerRows({ sigmaF, thetaF, sigmaS, thetaS, mu, d, pmT, B })
      // deadbeat（g_S = 1、d = 0）時 1 − g_S 可能留下 1e-16 的浮點殘渣：顯示與答案都當成 0
      const rhoS = clean(S.rho)
      const m = 2 * d + 1
      const half = F.g / 2
      const phi = Math.asin(half) * RAD2DEG
      const gc = gCrit(d)
      const steps: HandCalcStep[] = [
        ...cornerGainSteps('F', '最快的', sigmaF, thetaF, mu, F),
        {
          tex: String.raw`\varphi_F=\arcsin\frac{g_F}{2}=\arcsin\frac{${texNum(F.g)}}{2}=\arcsin(${texNum(half)})=${deg(phi, 6)}`,
          why: String.raw`DEG 模式按 $\sin^{-1}$；沒有這個鍵時，$g\le0.4$ 可用 $\varphi\approx28.65^\circ\times g$（把 $\arcsin x$ 當成 $x$，低估不到 $0.7\%$）。多留一位小數，下一步要乘 $2d+1$。`,
        },
        {
          tex: String.raw`PM_d=90^\circ-(2d+1)\,\varphi_F=90^\circ-${m}\times${deg(phi, 6)}=90^\circ-${deg(m * phi, 6)}=${deg(F.pm)}`,
          why: String.raw`每多一個 block 的更新延遲，在 crossover 多吃掉 $2\varphi_F$ 的相位（F-SO.5）。和 $PM_t=${deg(pmT, 10)}$ 比：${F.ok.pm ? '夠' : '不夠'}。`,
        },
        ...cornerGainSteps('S', '最慢的', sigmaS, thetaS, mu, S),
      ]
      if (d === 0) {
        steps.push({
          tex: String.raw`\rho_S=|1-g_S|=|1-${texNum(S.g)}|=${nearOne(rhoS)}`,
          why: String.raw`$d=0$：平均誤差每個 block 乘上 pole $1-g_S$；$\rho$（spectral radius）是它的絕對值。`,
        })
      } else {
        const disc = clean(1 - 4 * S.g)
        steps.push({
          tex: String.raw`1-4g_S=1-4\times${texNum(S.g)}=1-${texNum(4 * S.g)}=${texNum(disc)}`,
          why: String.raw`$d=1$：$\delta_{k+1}=\delta_k-g_S\,\delta_{k-1}$ 的特徵方程 $z^2-z+g_S=0$，先算判別式。`,
        })
        if (disc >= 0) {
          const root = Math.sqrt(disc)
          steps.push({
            tex: String.raw`\rho_S=\frac{1+\sqrt{1-4g_S}}{2}=\frac{1+\sqrt{${texNum(disc)}}}{2}=\frac{1+${texNum(root)}}{2}=\frac{${texNum(1 + root, 6)}}{2}=${nearOne(rhoS)}`,
            why: String.raw`判別式 $\ge0$：兩個實根 $\frac{1\pm\sqrt{1-4g_S}}{2}$ 都在 $0$ 與 $1$ 之間，絕對值大的那個（取 $+$）決定收斂速度。`,
          })
        } else {
          steps.push({
            tex: String.raw`\rho_S=|z|=\sqrt{g_S}=\sqrt{${texNum(S.g)}}=${nearOne(rhoS)}`,
            why: String.raw`判別式 $<0$：一對共軛複根，兩根相乘等於常數項，所以 $|z|^2=g_S$（誤差一邊振盪一邊衰減）。`,
          })
        }
      }
      if (rhoS === 0) {
        steps.push({ tex: String.raw`\rho_S=0\ \Rightarrow\ k_{95}=1`, why: String.raw`deadbeat（$g_S=1$、$d=0$）：一次更新就到位，不需要（也不能）取 $\ln0$；但至少要 $1$ 次更新。` })
      } else {
        const lnRho = Math.log(rhoS)
        steps.push({ tex: String.raw`\ln\rho_S=\ln(${nearOne(rhoS)})=${texNum(lnRho)}`, why: String.raw`計算機按 $\ln$；$\rho$ 接近 $1$ 時 $\ln\rho\approx-(1-\rho)$。` })
        const asymRatio = ceilArg(LN_005 / lnRho, S.settleAsym)
        const asymFrac = String.raw`\Big\lceil\frac{\ln0.05}{\ln\rho_S}\Big\rceil=\Big\lceil\frac{${texNum(LN_005)}}{${texNum(lnRho)}}\Big\rceil=\left\lceil${asymRatio}\right\rceil=${int(S.settleAsym)}`
        const budget = String.raw`和 $B=${int(B)}$ 比：${S.ok.settle ? '來得及' : '來不及'}。`
        if (d === 0) {
          steps.push({
            tex: String.raw`k_{95}=${asymFrac}`,
            why: String.raw`$d=0$ 時平均誤差的大小每個 block 剛好乘上 $\rho_S$：$\rho_S^{\,k}\le0.05$ ⇒ $k\ge\ln0.05/\ln\rho_S$（兩個負數相除得正數），再無條件進位。` + budget,
          })
        } else {
          steps.push({
            tex: String.raw`k_{95}^{(\rho)}=${asymFrac}`,
            why: String.raw`$\rho$ 漸近估計：只用 $\rho_S$ 的漸近衰減率，解 $\rho_S^{\,k}\le0.05$。$d=1$ 時這只是估計——實際的誤差是兩個模式的組合，$\rho_S^{\,k}$ 不是它的包絡，逐 block 數出來的 $k_{95}$ 可能比它多、也可能比它少（相對差距在 $g_S=\tfrac14$ 附近最大：那裡是重根 $z=\tfrac12$，估計給 $5$，從定值的初始歷史逐 block 數要 $7$）。判定 $k_{95}\le B$ 用的是下面逐 block 的 $k_{95}$。`,
          })
          if (S.settle95Exact) {
            steps.push(...exactSettleSteps(S.g, rhoS, S.settle95))
            steps.push({
              tex: String.raw`k_{95}=k_\text{last}+1=${int(S.settle95 - 1)}+1=${int(S.settle95)}`,
              why: String.raw`$k_{95}$ 定義為「最後一次 $|y_k|>0.05$ 的 block」的下一個 block（和判斷器同一個函式 settleFromPoles：用 $z^2-z+g_S=0$ 的兩個根做模態展開逐步求值，正是上面兩行的式子；首頁 settleDelayed 從 $y_0=y_{-1}=1$ 起逐 block 遞推得到同樣的數字）。` + (S.settle95 === S.settleAsym ? String.raw`這一題和 $\rho$ 漸近估計相同。` : String.raw`這一題和 $\rho$ 漸近估計差 $${int(Math.abs(S.settle95 - S.settleAsym))}$ 個 block。`) + budget,
            })
          } else {
            steps.push({
              tex: String.raw`k_{95}\ge k_{95}^{(\rho)}=${int(S.settleAsym)}`,
              why: String.raw`這個 mode 極慢：模態展開在 $${texNum(SETTLE_FROM_POLES_MAX_STEPS, 2)}$ 步內證明不了「之後不再超過」，$k_{95}$ 只能列 $\rho$ 漸近估計當下界（$\ge$）。` + budget,
            })
          }
        }
      }
      const muMax = (2 * Math.sin(((90 - pmT) / m) * DEG2RAD)) / F.K
      const fastOk = F.ok.stable && F.ok.pm
      const notes: string[] = []
      if (!F.ok.stable) notes.push(String.raw`最快的 corner：$g_F=${texNum(F.g, 4)}\ge g_\text{crit}(${int(d)})=${texNum(gc, 4)}$，不穩定（$PM_d\le0$）——一階模型的「$0<g<2$」在有更新延遲時不適用。`)
      else if (!F.ok.pm) notes.push(String.raw`最快的 corner：$PM_d=${deg(F.pm, 4)}<PM_t$，裕度不足。要 $PM_d\ge PM_t$，$\mu$ 不能超過 $\frac{2\sin\big(\frac{90^\circ-PM_t}{2d+1}\big)}{K_F}=${texNum(muMax, 4)}$ fs。`)
      if (!S.ok.settle) notes.push(String.raw`最慢的 corner：$k_{95}${S.settle95Exact ? '=' : String.raw`\ge`}${int(S.settle95)}>B=${int(B)}$，來不及收斂。可以加大 $\mu$（但上限由最快的 corner 決定：$\mu\le${texNum(muMax, 4)}$ fs）、延長 $B$，或每個 corner 量 $\hat K_c$ 後用各自的 $\mu_c=g/\hat K_c$。`)
      if (fastOk && S.ok.settle) notes.push(String.raw`兩個 corner 都通過：最快的 $PM_d=${deg(F.pm, 4)}\ge PM_t$，最慢的 $k_{95}=${int(S.settle95)}\le B$。在不違反 $PM_t$ 的前提下，$\mu$ 最大可以到 $${texNum(muMax, 4)}$ fs。`)
      if (!fastOk && !S.ok.settle) notes.push(String.raw`兩頭都不合格：這組 corner 沒有任何單一的 $\mu$ 能同時滿足 $PM_t$ 與 $B$——要縮小 $K$ 的散佈、延長 $B$ 或放寬 $PM_t$。`)
      notes.push(String.raw`這一題只手算 $PM$ 與收斂時間兩個判準；完整的 sign-off 還要對每個 corner 檢查 $\sigma_w$ 預算，而且中間的 corner 也都要過（下面的 Corner 判斷器一次算完）。`)
      return {
        steps,
        results: [
          { symbol: 'g_F', label: '最快 corner 的迴路增益', value: F.g },
          { symbol: 'PM_d', label: '最快 corner 含延遲的 phase margin', value: clean(F.pm), unit: String.raw`^\circ`, tolerance: ANGLE_TOL },
          { symbol: String.raw`\rho_S`, label: '最慢 corner 的 spectral radius', value: rhoS, digits: 6, tolerance: NEAR_ONE_TOL },
          { symbol: 'k_{95}', label: '最慢 corner 衰減九成五要幾個 block', value: S.settle95, unit: String.raw`\text{blocks}`, digits: 10, tolerance: { abs: 1e-9, rel: 0.01 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`範例（Corner 判斷器預設的 FF 125°C 與 near-grid FCW 兩列，$\mu=10$ fs、$d=1$）：$g_F=0.11225$、$\varphi_F=3.2174^\circ$、$PM_1=80.35^\circ$；$g_S=0.039894$、$\rho_S=0.95837$、$k_{95}=71\le120$——和判斷器表格的同兩列一致。`,
      String.raw`$\ln0.05=-2.9957$（「95%」就是剩下 $0.05$）。$\rho_S$ 至少留 5 位有效數字：$\rho_S$ 差 $0.001$，$k_{95}$ 就差好幾個 block。`,
      String.raw`$d=1$ 的二次式 $z^2-z+g=0$：兩根相加 $=1$、相乘 $=g$。$g\le\tfrac14$ 是兩個實根（取大的）；$g>\tfrac14$ 是共軛複根，$|z|=\sqrt g$，到 $g=1=g_\text{crit}(1)$ 時剛好碰到單位圓。`,
      String.raw`$d=1$ 時 $\rho$ 漸近估計與逐 block 的 $k_{95}$ 不一定相同：$g_S=\tfrac14$（重根 $z=\tfrac12$）估計給 $5$、逐 block 要 $7$；$g_S=0.8$ 則估計給 $27$、逐 block 是 $26$。判定 $k_{95}\le B$ 用逐 block 的那個，所以 $B=6$ 時，只看估計會誤判通過。`,
      String.raw`把 $d$ 從 $1$ 改成 $0$ 再算一次：$PM$ 多了 $2\varphi_F$，$\rho_S$ 從 $0.95837$ 變成 $1-g_S=0.96011$——延遲不只吃掉相位，也改變收斂速度（$g$ 很小時反而快一點點；$g$ 一大就變成振盪衰減，到 $g_\text{crit}(d)$ 發散）。`,
    ],
  },

  // ─────────────────────────── HC-SO.7 PVT corner 表的一列（§4b，F-SO.14） ───────────────────────────
  {
    id: 'HC-SO.7',
    title: String.raw`PVT corner 表的一列：雜訊、增益倍率與溫度漂移在這個 corner 各造成什麼？`,
    page: '/signoff',
    formulaId: 'F-SO.14',
    // 四行：K_q 與 K_c；帶緣；Δa 與重新收斂（d = 0 的封閉式）；斜坡落後
    formulaTex: String.raw`\begin{aligned}&K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad K_c=K_q\,\kappa,\qquad g=\mu K_c\\[2pt]&f_{inv}=\frac{f_{ref}}{\pi}\arcsin\sqrt{\frac{sK_i}{2(2-sK_p)}}\\[2pt]&\Delta a=a\,\mathrm{TC}\,(T_c-25^\circ\mathrm{C}),\qquad k_{re}=\Big\lceil\frac{\ln(\delta_{tol}/\lvert\Delta a\rvert)}{\ln\lvert1-g\rvert}\Big\rceil\\[2pt]&\dot a=a\,\mathrm{TC}\,\dot T,\qquad r=\frac{\dot a}{f_{ref}/N},\qquad \delta_{lag}=\frac{r}{g}\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: '這個 corner 的 comparator 雜訊', unit: String.raw`\mathrm{fs}`, default: 140, min: 1, max: 10000, practice: { choices: [70, 100, 140, 200] } },
      { key: 's', symbol: 's', label: '主迴路增益相對標稱的倍率（PVT 之後不重新設計）', default: 0.8, min: 0.05, max: 3, practice: { choices: [0.8, 1, 1.25] } },
      { key: 'kappa', symbol: String.raw`\kappa`, label: 'regressor 在這個 corner 的有效相關係數（表 4b-1 的有效相關欄；§4 的判斷器裡是有效相位的餘弦）', default: 0.5, min: 0.01, max: 1.5, practice: { choices: [0.3, 0.5, 1] } },
      { key: 'mu', symbol: String.raw`\mu`, label: 'learning rate（所有 corner 共用）', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 1e5, practice: { choices: [5, 10, 20, 40] } },
      { key: 'aPs', symbol: 'a', label: 'DTC 的真實 gain（以時間計；illustrative：16 GHz 的 VCO 週期）', unit: String.raw`\mathrm{ps}`, default: 62.5, min: 0.1, max: 1000, practice: { choices: [31.25, 62.5] } },
      { key: 'tc', symbol: String.raw`\mathrm{TC}`, label: 'DTC gain 的溫度係數（相對 TT 25°C）', unit: String.raw`\mathrm{ppm/{}^\circ C}`, default: 300, min: 0, max: 5000, practice: { choices: [100, 300, 1000] } },
      { key: 'Tc', symbol: 'T_c', label: 'corner 的溫度', unit: String.raw`{}^\circ\mathrm{C}`, default: -40, min: -100, max: 200, practice: { choices: [-40, 0, 85, 125] } },
      { key: 'tol', symbol: String.raw`\delta_{tol}`, label: '重新收斂與落後的容許誤差', unit: String.raw`\mathrm{fs}`, default: 5, min: 0.01, max: 1000, practice: { choices: [2, 5] } },
      { key: 'ramp', symbol: String.raw`\dot T`, label: '溫度斜坡', unit: String.raw`{}^\circ\mathrm{C/s}`, default: 10, min: 0, max: 1e5, practice: { choices: [10, 1000] } },
      { key: 'N', symbol: 'N', label: 'GMAC block 長度（block 率是 reference 率除以 N，reference 率為 4 GHz）', unit: String.raw`\text{samples}`, default: 4096, min: 1, max: 1e7, integer: true, practice: { choices: [1024, 4096] } },
    ],
    validate: ({ sigmaV, s, kappa, mu, aPs, tc, Tc, tol }) => {
      const { Kp, Ki } = PVT_LOOP_PARAMS
      if (!(sigmaV > 0)) return String.raw`$\sigma_v$ 必須大於 0：$K_q=\sqrt{2/\pi}/\sigma_v$ 沒有定義。`
      if (!(s > 0) || s * Kp >= 2) return String.raw`增益倍率 $s$ 要在 $0<s<2/K_p=${texNum(2 / Kp, 4)}$ 內：超過時 1 拍延遲的 Type-II 主迴路本身不穩定（特徵方程 $z^2-(2-sK_p-sK_i)z+(1-sK_p)=0$ 的根跑出單位圓），談不上校正迴路。`
      const ratio = (s * Ki) / (2 * (2 - s * Kp))
      if (ratio >= 1) return String.raw`$\dfrac{sK_i}{2(2-sK_p)}=${texNum(ratio, 4)}\ge1$：$\arcsin$ 沒有實數解——反號帶已經蓋滿整個頻帶，這個增益倍率下主迴路幾乎不穩定。請把 $s$ 調小。`
      if (!(kappa > 0)) return String.raw`C ≤ 0：$\kappa\le0$ 表示 regressor 的功率落在反號帶內，恢復力 $K_c=K_q\kappa\le0$——更新極性錯誤，任何正的 $\mu$ 都發散（案例頁 §7）。先換 regressor（一階差分）或 keep-out 這個頻道。`
      const g = (mu * SQRT_2_OVER_PI * kappa) / sigmaV
      if (g >= 2) return String.raw`$g=\mu K_c=${texNum(g, 4)}\ge2$：$d=0$ 的平均模型 pole $1-g\le-1$，發散。請把 $\mu$ 調小（這一題只做 $d=0$；有更新延遲時上限更低，見 §4 的 Corner 判斷器）。`
      if (!(aPs > 0)) return String.raw`$a$ 必須大於 0。`
      if (tc < 0 || !(tol > 0)) return String.raw`$\mathrm{TC}\ge0$、$\delta_{tol}>0$。`
      const dA = aPs * 1000 * tc * 1e-6 * (Tc - 25)
      if (Math.abs(dA) > 0.2 * sigmaV * 50 && Math.abs(dA) > 1e5) return String.raw`$|\Delta a|=${texNum(Math.abs(dA), 4)}$ fs 已經超過 DTC 的整個範圍量級：comparator 從頭到尾飽和，線性的 $k_{re}$ 沒有意義。請把 TC 或 $|T_c-25|$ 調小。`
      return null
    },
    solve: ({ sigmaV, s, kappa, mu, aPs, tc, Tc, tol, ramp, N }) => {
      const { Kp, Ki } = PVT_LOOP_PARAMS
      const Kq = kq(sigmaV)
      const Kc = Kq * kappa
      const g = mu * Kc
      const sKi = s * Ki
      const twoMinus = 2 - s * Kp
      const den = 2 * twoMinus
      const ratio = sKi / den
      const root = Math.sqrt(ratio)
      const asin = Math.asin(root)
      const fInvNorm = typeIIFinv(s * Kp, s * Ki)
      const fInv = (fInvNorm * F_REF) / 1e6
      const aFs = aPs * 1000
      const dT = Tc - 25
      const tcFrac = tc * 1e-6
      const dA = aFs * tcFrac * dT
      const absA = Math.abs(dA)
      const rho = Math.abs(1 - g)
      const frac = absA > tol ? tol / absA : 1
      const settle = frac < 1 ? settleFromPoles(g, 0, frac) : null
      const kRe = settle ? settle.blocks : 0
      const lnFrac = frac < 1 ? Math.log(frac) : 0
      const lnRho = Math.log(rho)
      const fu = F_REF / N
      const aDot = aFs * tcFrac * ramp
      const r = aDot / fu
      const lag = r / g
      const steps: HandCalcStep[] = [
        { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${inp(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`, why: String.raw`效應 ①：這個 corner 的 comparator 增益（$\sqrt{2/\pi}=0.79788$）。` },
        { tex: String.raw`K_c=K_q\,\kappa=${texNum(Kq)}\times${inp(kappa)}=${texNum(Kc)}\ \mathrm{fs}^{-1}`, why: String.raw`效應 ② 的結果 $\kappa$（表 4b-1；它已經含了帶緣移動對鋸齒各諧波的影響）乘上去。§4 的判斷器把它寫成 $\cos\theta$。` },
        { tex: String.raw`g=\mu K_c=${inp(mu)}\times${texNum(Kc)}=${texNum(g)}`, why: String.raw`無因次迴路增益。$d=0$ 時 pole 是 $1-g$，要 $0<g<2$。` },
        { tex: String.raw`sK_i=${inp(s)}\times${texNum(Ki)}=${texNum(sKi)},\qquad 2(2-sK_p)=2\times(2-${inp(s)}\times${texNum(Kp)})=2\times${num(twoMinus)}=${num(den)}`, why: String.raw`效應 ②：PVT 把標稱的 $K_p=${texNum(Kp)}$、$K_i=${texNum(Ki)}$（案例頁 §6.2，320 MHz 的設計值）一起乘上 $s$。` },
        { tex: String.raw`\sqrt{\frac{sK_i}{2(2-sK_p)}}=\sqrt{\frac{${texNum(sKi)}}{${num(den)}}}=\sqrt{${texNum(ratio)}}=${texNum(root)}`, why: String.raw`先除後開根號（案例頁 F-CS.8 的 closed form）。` },
        { tex: String.raw`f_{inv}=\frac{f_{ref}}{\pi}\arcsin(${texNum(root)})=\frac{4000}{\pi}\times${texNum(asin)}=${texNum(fInv)}\ \mathrm{MHz}`, why: String.raw`計算機切到 RAD 模式按 $\sin^{-1}$，再乘 $f_{ref}/\pi=1273.24$ MHz。增益倍率越大、帶緣越高（×0.8 時 118.56 MHz、×1 時 134.82 MHz、×1.25 時 154.09 MHz）。` },
        { tex: String.raw`\Delta a=a\,\mathrm{TC}\,(T_c-25^\circ\mathrm{C})=${inp(aPs)}\times10^{3}\times${inp(tc)}\times10^{-6}\times${inpP(dT)}=${texNum(dA)}\ \mathrm{fs}`, why: String.raw`效應 ③：ps 換成 fs（$\times10^3$）、ppm 換成倍率（$\times10^{-6}$）、再乘溫差。這是在 TT 校準好的 $w$ 搬到這個 corner 後的初始誤差。` },
        { tex: String.raw`\rho=\lvert1-g\rvert=\lvert1-${texNum(g)}\rvert=${nearOne(rho)}`, why: String.raw`$d=0$：平均誤差每個 block 乘上 $1-g$。` },
      ]
      if (frac < 1) {
        const ratioTex = ceilArg(lnFrac / lnRho, kRe)
        steps.push(
          { tex: String.raw`\frac{\delta_{tol}}{\lvert\Delta a\rvert}=\frac{${inp(tol)}}{${texNum(absA)}}=${texNum(frac)}`, why: String.raw`要把 $|\Delta a|$ 縮到 $\delta_{tol}$：需要的縮減比（小於 1）。` },
          { tex: String.raw`\ln\Big(\frac{\delta_{tol}}{\lvert\Delta a\rvert}\Big)=\ln(${texNum(frac)})=${texNum(lnFrac)}`, why: String.raw`取對數：縮減比小於 1，所以結果是負數。` },
          { tex: String.raw`k_{re}=\Big\lceil\frac{\ln(\delta_{tol}/\lvert\Delta a\rvert)}{\ln\rho}\Big\rceil=\Big\lceil\frac{${texNum(lnFrac)}}{${texNum(lnRho)}}\Big\rceil=\left\lceil${ratioTex}\right\rceil=${int(kRe)}`, why: String.raw`$\rho^k\le\delta_{tol}/|\Delta a|$（兩個負數相除得正數），無條件進位。和 §4 的 $k_{95}$ 是同一個函式（settleFromPoles，把 5% 換成 $\delta_{tol}/|\Delta a|$）；$d\ge1$ 時沒有封閉式，判斷器用模態展開逐 block 數。` },
        )
      } else {
        steps.push({ tex: String.raw`\lvert\Delta a\rvert=${texNum(absA)}\le\delta_{tol}=${inp(tol)}\ \Rightarrow\ k_{re}=0`, why: String.raw`漂移本來就在容許誤差內，不需要重新收斂。` })
      }
      steps.push(
        { tex: String.raw`f_u=\frac{f_{ref}}{N}=\frac{4\times10^{9}}{${int(N)}}=${texNum(fu)}\ \mathrm{Hz}`, why: String.raw`block 率：每 $N$ 個 reference 週期更新一次。` },
        { tex: String.raw`\dot a=a\,\mathrm{TC}\,\dot T=${inp(aPs)}\times10^{3}\times${inp(tc)}\times10^{-6}\times${inp(ramp)}=${texNum(aDot)}\ \mathrm{fs/s}`, why: String.raw`溫度斜坡讓 $a$ 每秒漂這麼多。` },
        { tex: String.raw`r=\frac{\dot a}{f_u}=\frac{${texNum(aDot)}}{${texNum(fu)}}=${texNum(r)}\ \mathrm{fs/block}`, why: String.raw`換成每個 block 的漂移量：block 率是 MHz 級，所以每個 block 只漂一點點。` },
        { tex: String.raw`\delta_{lag}=\frac{r}{g}=\frac{${texNum(r)}}{${texNum(g)}}=${texNum(lag)}\ \mathrm{fs}`, why: String.raw`$\delta_{k+1}=(1-g)\delta_k+r$ 的穩態（Ch14 F-14.12 的 lag 項）：迴路永遠落後這麼多。和 $\delta_{tol}=${inp(tol)}$ fs 比：${lag <= tol ? '可以忽略' : '不能忽略'}。` },
      )
      return {
        steps,
        results: [
          { symbol: 'K_c', label: '這個 corner 的恢復力', value: Kc, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: 'g', label: '迴路增益', value: g },
          { symbol: 'f_{inv}', label: '反號帶上緣', value: fInv, unit: String.raw`\mathrm{MHz}`, tolerance: { rel: 0.002, abs: 0.05 } },
          { symbol: String.raw`\Delta a`, label: '溫度造成的 gain 偏移', value: dA, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.01, abs: 1e-9 } },
          { symbol: 'k_{re}', label: '重新收斂到容許誤差要幾個 block', value: kRe, unit: String.raw`\text{blocks}`, digits: 10, tolerance: CEIL_TOL },
          { symbol: String.raw`\delta_{lag}`, label: '溫度斜坡的穩態落後', value: lag, unit: String.raw`\mathrm{fs}`, tolerance: { rel: 0.01, abs: 1e-12 } },
        ],
        notes: [
          String.raw`這一列只在 $d=0$ 有封閉式；§4b 的表用 $d=1$，$k_{re}$ 由模態展開逐 block 數（同一個 settleFromPoles）。`,
          String.raw`三種效應不是獨立相加：$K_c$ 是效應 ① 與 ② 的乘積，效應 ③ 的 $k_{re}$ 又除以 $\ln\rho\approx-g$——雜訊大、增益低的 corner 同時也最難把 $\Delta a$ 收掉。`,
          frac < 1 ? String.raw`比較：$k_{re}=${int(kRe)}$ 與 §4 的 $k_{95}$（5%）$=${int(settleFromPoles(g, 0, 0.05).blocks)}$——$|\Delta a|/\delta_{tol}=${texNum(absA / tol, 4)}$ 比 20 ${absA / tol > 20 ? '大' : '小'}，所以重新收斂比「衰減 95%」${absA / tol > 20 ? '久' : '快'}。` : String.raw`$\Delta a$ 在容許內：這個 corner 不需要重新收斂，只剩斜坡落後要看。`,
        ],
      }
    },
    tips: [
      String.raw`範例（表 4b-1 的 SS −40°C：$\sigma_v=140$ fs、$s=0.8$、$\kappa=0.5$、$\mu=10$ fs、$a=62.5$ ps、TC $=300$ ppm/°C、$T_c=-40$ °C、$\delta_{tol}=5$ fs、$\dot T=10$ °C/s、$N=4096$）：$K_q=0.0056992$、$K_c=0.0028496$、$g=0.028496$、$f_{inv}=118.56$ MHz、$\Delta a=-1218.8$ fs、$k_{re}=191$、$\delta_{lag}=6.74\times10^{-3}$ fs。`,
      String.raw`$f_{ref}/\pi=1273.24$ MHz、$\sqrt{2/\pi}=0.79788$、$K_p=0.287717$、$K_i=0.0382535$：這四個常數每列都一樣。`,
      String.raw`$\ln\rho\approx-g$（$g$ 小時）：所以 $k_{re}\approx\ln(|\Delta a|/\delta_{tol})/g$——$|\Delta a|$ 每大 $e$ 倍多 $1/g$ 個 block。`,
      String.raw`把 TC 改成 1000 ppm/°C：$|\Delta a|$ 變 3.3 倍，$k_{re}$ 只多 $\ln3.3/g\approx42$ 個 block（對數）；把 $\dot T$ 改成 1000 °C/s：$\delta_{lag}$ 變 100 倍仍只有 0.67 fs——block 率 MHz 級時斜坡追蹤幾乎免費。`,
    ],
  },
  // ─────────────────────────── HC-SO.5 矽上量測計畫：要讀幾個 block、花多少時間（§8.5，F-SO.3） ───────────────────────────
  {
    id: 'HC-SO.5',
    title: String.raw`矽上極性量測：$\Delta=0.3\sigma_v$ 時，要讀幾個 block 的 $\bar G$ 才能以 $z_t$ 判定極性？要花多少時間？`,
    page: '/signoff',
    formulaId: 'F-SO.3',
    // 五行（手機欄寬約 290px，一行排不下會出現橫向捲軸）：Δ 與 σ_η；K；所需 block 數（兩種寫法各一行）；量測時間（每個 reference 週期一個 comparator sample ⇒ T_blk = N/f_ref）
    formulaTex: String.raw`\begin{aligned}&\Delta=r\,\sigma_v,\qquad \sigma_\eta\approx\frac1{\sqrt N}\\[2pt]&K=K_qC=\frac{\sqrt{2/\pi}}{\sigma_v}\,C\\[2pt]&M_{\min}=\Big\lceil\frac{z_t^2}{2N\Delta^2K^2}\Big\rceil\\[2pt]&\phantom{M_{\min}}=\Big\lceil\frac12\Big(\frac{z_t\,\sigma_\eta}{K\Delta}\Big)^2\Big\rceil\\[2pt]&T_\text{blk}=\frac{N}{f_\text{ref}},\qquad T_\text{meas}=2M_{\min}T_\text{blk}\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 200, min: 1, max: 10000, practice: { choices: [100, 150, 200, 300] } },
      { key: 'r', symbol: String.raw`r=\Delta/\sigma_v`, label: '擾動相對雜訊的比例', default: 0.3, min: 0.001, max: 1, practice: { choices: [0.1, 0.2, 0.25, 0.3] } },
      { key: 'C', symbol: 'C', label: '這個 channel 的有效相關（可以是負的）', default: 0.1, min: -1, max: 1, practice: { choices: [0.05, 0.1, 0.2, 0.5, 1] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', unit: String.raw`\text{samples}`, default: 1024, min: 1, max: 1e8, integer: true, practice: { choices: [256, 512, 1024, 4096] } },
      { key: 'fRef', symbol: String.raw`f_\text{ref}`, label: 'reference 頻率（每個 reference 週期一個 sample）', unit: String.raw`\mathrm{MHz}`, default: 100, min: 0.001, max: 1e5, practice: { choices: [50, 100, 200, 500, 1000] } },
      { key: 'zt', symbol: 'z_t', label: '判決要求的信心倍數', default: 3, min: 0.5, max: 10, practice: { choices: [2, 3, 4, 6] } },
    ],
    validate: ({ sigmaV, r, C }) => {
      if (C === 0) {
        return String.raw`$C=0$：這個 channel 的 code 與誤差路徑的輸出完全不相關，沒有恢復力（$K=0$）——$M\to\infty$，讀再多 block 也判不出極性；這不是量測不夠久，而是參數不可辨識（§5 的 keep-out 候選）。請換 code delay $D$ 或換一個 channel。`
      }
      if (r > 0.3) {
        return String.raw`$\Delta/\sigma_v=${inp(r)}>0.3$：擾動太大，中央差分的截斷偏差不能忽略（identity path 的截斷比 $r_\text{CD}=${texNum(secantRatio(r * sigmaV, sigmaV), 4)}$，F-SO.2），量到的 $|\hat K|$ 比小訊號的 $K_qC$ 小，這一題算的 $M_{\min}$ 會偏少。矽上量測請把強制的 $w$ 控制在 $w_0\pm0.3\sigma_v$ 以內（$\sigma_v=${inp(sigmaV)}$ fs 時 $\Delta\le${texNum(0.3 * sigmaV)}$ fs）。`
      }
      return null
    },
    solve: ({ sigmaV, r, C, N, fRef, zt }) => {
      const plan = polarityReadoutPlan({ sigmaV, deltaRatio: r, C, N, fRefHz: fRef * 1e6, z: zt })
      const { delta, Kq, K, sigmaEta, M } = plan
      const rootN = Math.sqrt(N)
      const kd = K * delta
      const numer = zt * sigmaEta
      const ratio = numer / Math.abs(kd)
      const half = (ratio * ratio) / 2
      const tBlkUs = plan.tBlockS * 1e6
      const tMeasUs = plan.tMeasS * 1e6
      const sign = C > 0 ? String.raw`$C>0$：預期 $\bar G_+<\bar G_-$（$\hat K>0$）` : String.raw`$C<0$：預期 $\bar G_+>\bar G_-$（$\hat K<0$，這個 channel 極性相反，要反相 $q$ 或修 regressor）`
      return {
        steps: [
          { tex: String.raw`\Delta=r\,\sigma_v=${inp(r)}\times${inp(sigmaV)}=${num(delta)}\ \mathrm{fs}`, why: String.raw`強制寫進暫存器的擾動：$r\le0.3$ 才沒有明顯的 erf 截斷（F-SO.2）。這就是 w_force 暫存器要支援的最小步進量級。` },
          { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${inp(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs}^{-1}`, why: String.raw`comparator 的小訊號增益；$\sqrt{2/\pi}=0.79788$。` },
          { tex: String.raw`K=K_q\,C=${texNum(Kq)}\times${inpP(C)}=${texNum(K)}\ \mathrm{fs}^{-1}`, why: String.raw`這個 channel 的恢復力。${sign}。` },
          { tex: String.raw`\sigma_\eta\approx\frac1{\sqrt N}=\frac1{\sqrt{${int(N)}}}=\frac1{${texNum(rootN)}}=${texNum(sigmaEta)}`, why: String.raw`讀出的每一個 block 平均 $\bar G$ 的雜訊：$N$ 個 $\pm1$ 的平均（F-SO.3 的 $\sigma_\eta$）。` },
          { tex: String.raw`K\Delta=${texNum(K)}\times${num(delta)}=${texNum(kd)}`, why: String.raw`兩個工作點相差 $2\Delta$，GMAC 平均相差 $2K\Delta$：這是要從雜訊裡分辨出來的「訊號」的一半。` },
          { tex: String.raw`\frac{z_t\,\sigma_\eta}{|K\Delta|}=\frac{${inp(zt)}\times${texNum(sigmaEta)}}{${texNum(Math.abs(kd))}}=\frac{${texNum(numer)}}{${texNum(Math.abs(kd))}}=${texNum(ratio)}`, why: String.raw`要求 $z=|K|\Delta\sqrt{2M}/\sigma_\eta\ge z_t$，解出 $\sqrt{2M}\ge z_t\sigma_\eta/(|K|\Delta)$：先把右邊算出來。` },
          { tex: String.raw`M_{\min}=\Big\lceil\frac12\Big(\frac{z_t\sigma_\eta}{|K|\Delta}\Big)^2\Big\rceil=\Big\lceil\frac{${sq(ratio)}}{2}\Big\rceil=\Big\lceil\frac{${texNum(ratio * ratio)}}{2}\Big\rceil=\left\lceil${ceilArg(half, M)}\right\rceil=${int(M)}`, why: String.raw`兩邊平方再除以 $2$，無條件進位（每側至少 $1$ 個 block）。代回去就是 F-SO.3 的 $z_t^2/(2N\Delta^2K^2)$。` },
          { tex: String.raw`T_\text{blk}=\frac{N}{f_\text{ref}}=\frac{${int(N)}}{${inp(fRef)}\ \mathrm{MHz}}=${texNum(tBlkUs)}\ \mu\mathrm{s}`, why: String.raw`每個 reference 週期一個 comparator sample，所以一個 block 要 $N$ 個 reference 週期（$1/\mathrm{MHz}=\mu\mathrm{s}$）。` },
          { tex: String.raw`T_\text{meas}=2M_{\min}T_\text{blk}=2\times${int(M)}\times${texNum(tBlkUs)}=${texNum(tMeasUs)}\ \mu\mathrm{s}`, why: String.raw`兩側（$+\Delta$、$-\Delta$）各 $M_{\min}$ 個 block。每次改 $w$ 後丟掉的 settling block（主 PLL 經 $T$ 的暫態，通常幾個 block）另外加。` },
        ],
        results: [
          { symbol: String.raw`\Delta`, label: '強制寫入的擾動', value: delta, unit: String.raw`\mathrm{fs}` },
          { symbol: 'K', label: '恢復力', value: K, unit: String.raw`\mathrm{fs}^{-1}` },
          { symbol: String.raw`M_{\min}`, label: '每側至少要讀幾個 block', value: M, unit: String.raw`\text{blocks}`, digits: 10, tolerance: CEIL_TOL },
          { symbol: String.raw`T_\text{meas}`, label: '兩側各 M 個 block 的量測時間', value: tMeasUs, unit: String.raw`\mu\mathrm{s}`, tolerance: { abs: 1e-9, rel: 0.01 } },
        ],
        notes: [
          String.raw`讀出 $2M_{\min}=${int(2 * M)}$ 個 block 平均後：$\hat K=-(\bar G_+-\bar G_-)/(2\Delta)$，和 $\mathrm{se}=\sigma_\eta/(\Delta\sqrt{2M})=${texNum(plan.se)}$ fs$^{-1}$ 比，預期的 $z=${texNum(plan.zExpected, 4)}\ge z_t$。${sign}。`,
          String.raw`$M_{\min}\propto1/(C^2\Delta^2N)$：$C$ 小一半要 4 倍的 block；$\Delta$ 已經卡在 $0.3\sigma_v$ 不能再大，所以靠近 keep-out 的 channel 只能靠 $N$ 與 $M$（也就是時間）換信心。`,
          String.raw`這是「期望」的 $z$：實際的 $\hat K/\mathrm{se}$ 以它為中心、標準差 $1$ 散布，要有裕度就把 $z_t$ 設成 $4$–$6$ 再算一次。`,
        ],
      }
    },
    tips: [
      String.raw`範例（§8.5 表格的數字）：$\sigma_v=200$ fs、$r=0.3$、$C=0.1$、$N=1024$、$f_\text{ref}=100$ MHz、$z_t=3$：$\Delta=60$ fs、$K_q=0.0039894$、$K=0.00039894$ fs$^{-1}$、$\sigma_\eta=1/32$、$M_{\min}=8$、$T_\text{blk}=10.24\ \mu$s、$T_\text{meas}=163.84\ \mu$s。`,
      String.raw`心算捷徑：$N=1024$ 時 $\sigma_\eta=1/32$；$z_t=3$ 時 $z_t\sigma_\eta=3/32=0.09375$，除以 $K\Delta$ 再平方、除以 $2$ 就是 $M_{\min}$。`,
      String.raw`把 $C$ 改成 $0.05$（更靠近 keep-out）：$M_{\min}$ 變 4 倍（$31$），時間也 4 倍；把 $N$ 改成 $4096$：$M_{\min}$ 變 $2$，但每個 block 長 4 倍，總時間差不多——時間預算真正由 $N\cdot M$ 決定。`,
      String.raw`$\Delta$ 的步進：w_force 暫存器的最小步進要明顯小於 $0.3\sigma_v$（例如 $\le0.1\sigma_v$），不然 $\Delta$ 只能取到 $0$ 或太大。`,
    ],
  },

  // ─────────────────────────── HC-SO.6 從頻譜儀的 spur dBc 反推 timing tone 與 PHOS 殘差（§8.5，F-SO.13） ───────────────────────────
  {
    id: 'HC-SO.6',
    title: String.raw`從頻譜儀的 spur（dBc）反推 DTC／PMUX 端的 timing tone peak $A_t$，再反推單相的 PHOS 殘差 $\delta_P$`,
    page: '/signoff',
    formulaId: 'F-SO.13',
    // 五行（手機欄寬約 290px）：spur 的定義；β；A_t（輸出端除以 |T| 回到 DTC 端）；δ_P；pattern 係數
    formulaTex: String.raw`\begin{aligned}&\mathrm{spur}\approx20\log_{10}\frac\beta2\\[2pt]&\beta=2\cdot10^{\mathrm{spur}/20}\\[2pt]&A_t=\frac{\beta}{2\pi f_\text{out}\,|T(f_m)|}\\[2pt]&\delta_P=\frac{A_t}{\kappa_\text{pat}}\\[2pt]&\kappa_\text{pat}=\frac{2\sin(\pi/P)}{\pi}\ \ (\text{單相殘差})\end{aligned}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'spur', symbol: String.raw`\mathrm{spur}`, label: '頻譜儀讀到的單邊 spur', unit: String.raw`\mathrm{dBc}`, default: -60, min: -200, max: 0, practice: { choices: [-80, -70, -60, -50, -40] } },
      { key: 'fOut', symbol: String.raw`f_\text{out}`, label: 'PLL 輸出頻率', unit: String.raw`\mathrm{GHz}`, default: 13, min: 0.001, max: 1000, practice: { choices: [8, 10, 13, 16, 20] } },
      { key: 'tDb', symbol: String.raw`|T(f_m)|`, label: 'tone 頻率處的輸出 transfer', unit: String.raw`\mathrm{dB}`, default: 0, min: -100, max: 20, practice: { choices: [-20, -12, -6, -3, 0, 1, 2] } },
      { key: 'P', symbol: 'P', label: 'PMUX 的相數（單一相有殘差）', default: 8, min: 2, max: 64, integer: true, practice: { choices: [4, 8, 16] } },
    ],
    validate: ({ spur }) => {
      if (spur > -20) {
        return String.raw`spur $=${inp(spur)}$ dBc $>-20$ dBc：$\beta=2\cdot10^{\mathrm{spur}/20}=${texNum(2 * 10 ** (spur / 20), 3)}$ rad，小角近似 $J_1(\beta)/J_0(\beta)\approx\beta/2$ 開始失準（要用 F-12.18 的 Bessel 精確式），而且這麼大的 spur 遠超過任何校正後的預算——先確認它不是 reference spur 或其他來源。`
      }
      return null
    },
    solve: ({ spur, fOut, tDb, P }) => {
      const fOutHz = fOut * 1e9
      const magT = 10 ** (tDb / 20)
      const halfBeta = 10 ** (spur / 20)
      const beta = 2 * halfBeta
      const twoPiF = 2 * Math.PI * fOutHz
      const atOutS = beta / twoPiF
      const atOut = timingToneFromSpur(fOutHz, spur, 1)
      const at = timingToneFromSpur(fOutHz, spur, magT)
      const kappa = oneHotPatternFactor(P)
      const dP = at / kappa
      return {
        steps: [
          { tex: String.raw`10^{\mathrm{spur}/20}=10^{${inp(spur)}/20}=10^{${num(spur / 20)}}=${texNum(halfBeta)}`, why: String.raw`dBc 是 $20\log_{10}$ 的振幅比：先把 spur 換回線性振幅比 $\beta/2$（計算機按 $10^x$）。` },
          { tex: String.raw`\beta=2\times10^{\mathrm{spur}/20}=2\times${texNum(halfBeta)}=${texNum(beta)}\ \mathrm{rad}`, why: String.raw`單邊 spur $\approx20\log_{10}(\beta/2)$（F-12.18 的小角近似），所以 $\beta$ 是它的兩倍。$\beta$ 是輸出相位調變的 peak（rad）。` },
          { tex: String.raw`2\pi f_\text{out}=2\pi\times${inp(fOut)}\times10^{9}=${texNum(twoPiF)}\ \mathrm{rad/s}`, why: String.raw`時間誤差換相位的係數：輸出每差 $1$ s 就是 $2\pi f_\text{out}$ rad。` },
          { tex: String.raw`A_{t,\text{out}}=\frac{\beta}{2\pi f_\text{out}}=\frac{${texNum(beta)}}{${texNum(twoPiF)}}=${texNum(atOutS)}\ \mathrm{s}`, why: String.raw`F-12.16 反過來：輸出端的 timing tone peak（相位 ÷ $2\pi f_\text{out}$）。` },
          { tex: String.raw`A_{t,\text{out}}=${texNum(atOutS)}\times10^{15}=${texNum(atOut)}\ \mathrm{fs}`, why: String.raw`換成 fs（$1\ \mathrm{fs}=10^{-15}$ s）。` },
          { tex: String.raw`|T(f_m)|=10^{${inp(tDb)}/20}=10^{${num(tDb / 20)}}=${texNum(magT)}`, why: String.raw`輸出 transfer 在 tone 頻率的大小（dB 換回線性）。帶內 $\approx1$（有 peaking 時略大於 $1$），帶外被 PLL 濾掉、遠小於 $1$。` },
          { tex: String.raw`A_t=\frac{A_{t,\text{out}}}{|T(f_m)|}=\frac{${texNum(atOut)}}{${texNum(magT)}}=${texNum(at)}\ \mathrm{fs}`, why: String.raw`儀器量到的是經 $|T|$ 的輸出量；除回去才是 DTC／PMUX 端（PD 的 reference 輸入）的 tone peak。帶外的 tone 在輸出看起來小，不代表 DTC 端的殘差小。` },
          { tex: String.raw`\kappa_\text{pat}=\frac{2\sin(\pi/P)}{\pi}=\frac{2\sin(\pi/${int(P)})}{\pi}=\frac{2\times${texNum(Math.sin(Math.PI / P))}}{${texNum(Math.PI)}}=${texNum(kappa)}`, why: String.raw`只有一相有 offset 殘差 $\delta_P$ 時，one-hot 的指示函數是分數相位 $\mathrm{frac}(\alpha n)$ 的寬 $1/P$ 方窗（殘量交給 DTC），$\alpha f_\text{ref}$ 那一根（$\ell=1$）的 Fourier 係數是 $\sin(\pi/P)/\pi$，實數 tone 的 peak 再乘 $2$（§8.5 的推導；等於 $P$ 點 DFT 的 $\delta_P/P$ 乘案例頁 F-CS.21 的 $\sqrt{w_1}=P\sin(\pi/P)/\pi$）。只有 $\alpha=s/P$（DTC 殘量固定）時才是 $2/P$。多相同時有殘差要用 F-CS.21 的 DFT。` },
          { tex: String.raw`\delta_P=\frac{A_t}{\kappa_\text{pat}}=\frac{${texNum(at)}}{${texNum(kappa)}}=${texNum(dP)}\ \mathrm{fs}`, why: String.raw`那一相的 PHOS 殘差：和 freeze 後讀到的該相 $w^*$（或 PMUX 相位強制量到的 $\hat J_{PP}$ 殘差）比對，差太多就是 bias 或量到了別的來源。` },
        ],
        results: [
          { symbol: String.raw`\beta`, label: '輸出相位調變指數', value: beta, unit: String.raw`\mathrm{rad}` },
          { symbol: 'A_t', label: 'DTC 或 PMUX 端 timing tone 的 peak', value: at, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\delta_P`, label: '單一相的 PHOS 殘差', value: dP, unit: String.raw`\mathrm{fs}` },
        ],
        notes: [
          String.raw`驗算（正向）：$20\log_{10}(\pi f_\text{out}|T|A_t)=20\log_{10}(\beta/2)=${texNum(20 * Math.log10(halfBeta), 4)}$ dBc，就是輸入的 spur。`,
          String.raw`同一個 $A_t$ 在不同 $f_\text{out}$ 的 spur 差 $20\log_{10}$ 的頻率比：$f_\text{out}$ 加倍，spur 高 $6$ dB。`,
          String.raw`這裡的 spur 是校正「之後」殘留的那一根（在 $\alpha f_\text{ref}$ 或其倍頻）；reference spur（$f_\text{ref}$ 偏移）另有來源，不能拿來反推 PHOS。`,
        ],
      }
    },
    tips: [
      String.raw`範例（§8.5 表格）：spur $=-60$ dBc、$f_\text{out}=13$ GHz、$|T|=0$ dB、$P=8$：$\beta=0.002$ rad、$2\pi f_\text{out}=8.1681\times10^{10}$、$A_t=24.485$ fs、$\kappa_\text{pat}=0.24362$、$\delta_P=100.5$ fs。`,
      String.raw`心算：$-60$ dBc $\Rightarrow\beta/2=10^{-3}$；$-40$ dBc $\Rightarrow10^{-2}$（每 $20$ dB 一個數量級）。`,
      String.raw`把 $|T|$ 改成 $-20$ dB（tone 在帶外）：輸出看到同樣的 $-60$ dBc，DTC 端的 $A_t$ 卻是 $10$ 倍（$244.85$ fs）——帶外的殘差在輸出被 PLL 濾掉了，不代表它不存在。`,
      String.raw`$P=8$ 時 $\kappa_\text{pat}=0.2436$（$\approx1/4$）：殘差 $\delta_P$ 是 tone peak 的 $4.10$ 倍；$P=16$ 時 $\kappa_\text{pat}=0.1242$、$8.05$ 倍。$P$ 越大 $\kappa_\text{pat}\to2/P$（$\sin(\pi/P)\approx\pi/P$）。`,
    ],
  },
]

/** 依 id 取本頁的手算題（頁內 `<HandCalcSlot id="HC-SO.1">` 用） */
export function handcalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Sign-off 頁找不到手算題 ${id}`)
  return def
}
