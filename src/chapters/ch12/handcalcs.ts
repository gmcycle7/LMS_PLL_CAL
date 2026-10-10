import { texNum } from '@/components'
import type { HandCalcDef, HandCalcStep } from '@/data/types'
import { radToFs } from '@/simulation/core'
import {
  REGIME_LABEL_TEX,
  SQRT_2_OVER_PI,
  bw3dbExact,
  bw3dbNegLnP,
  bw3dbOneMinusP,
  bwRegime,
  calLoop,
  dtPsdOneSided,
  dtTotalPower,
  dwStep,
  enbwOneSided,
  loopCore,
  sigmaW2Colored,
  simulateMixing,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
  swDtft,
  swOneSided,
  type CalLoop,
  type MixSystem,
  type MixingSimResult,
} from '@/simulation/models/calNoise'
import { decimalsAt, sigAtDecimals, sigFor, tx, txD, txDM, txIn, txM, txP } from './handcalcTex'

/**
 * 第 12 章的「帶入手算」題（HC-12.1 … HC-12.8，依頁面出現順序編號）。
 *  1. solve() 的數值一律呼叫 src/simulation/models/calNoise.ts 的實際函式（calLoop、bw3db*、enbwOneSided、swDtft、
 *     simulateMixing、spurBeta…），這裡只負責把數字排成「符號式 = 代入數字 = 結果」；
 *  2. 預設值 = 規格 §12.1 / §12.4 的例子（T13 / T14 / T15）：σ_v = 100 fs、μ = 10 fs、N = 4096、f_s = 4 GHz、C = 1；
 *     f_out = 13 GHz、A_t = 0.5 fs；
 *  3. 極性：δw = w − w*（勘誤 E33，與 §0 的 δ = a − w 相反；HC-12.1、HC-12.6 的補充說明給出 §0 約定下的對應結果）；
 *     頻寬一律分清楚 −3 dB 與 ENBW（勘誤 E06 / E10 / E26 / E27）；
 *  4. 輸入的頻率用手算友善的單位（f_s：GHz、f：kHz、f_BW：MHz），代入步驟中明寫換算；
 *  5. 每個等號只做一種運算，而且畫面上的數字自己就算得出下一個等號（handcalcs.test.tsx 會把每一步的 TeX 重新求值）：
 *     中間值顯示 6 位有效數字（答案 5 位）、寫得完的數完整顯示、相近的數相減時多顯示被抵銷的位數、
 *     三角函數／log 用固定小數位數（工具在 handcalcTex.ts）。π 以符號留在算式裡（計算機的 π 鍵）。
 */

const PAGE = '/ch/12'
const GHZ = 1e9
const MHZ = 1e6
const KHZ = 1e3
/** HC-12.1 不需要 f_s（只算 p 與遞迴）；呼叫 calLoop / loopCore 時填規格例的 4 GHz，結果與它無關 */
const FS_REF = 4e9
/** 規格 §12.1 例的 pole（7 位；完整值 0.9202115439…，T13 / T14）＝ HC-12.1 用範例數字算出的 p：以 p 為輸入的題目用它當預設 */
const P_EXAMPLE = 0.9202115
/** √(2/π) = 0.797885 的 TeX（6 位，與內文相同） */
const ROOT_TEX = texNum(SQRT_2_OVER_PI, 6)
const PI_TEX = texNum(Math.PI, 7)
const TWO_PI_TEX = texNum(2 * Math.PI, 7)
const SQRT2_TEX = texNum(Math.SQRT2, 7)
const U_FS = String.raw`\mathrm{fs}`
const U_KHZ = String.raw`\mathrm{kHz}`

/** 每一題共用的提示：為什麼步驟裡的數字比答案多一位 */
const GUARD_TIP = String.raw`步驟裡的中間值顯示 6 位有效數字（比答案多留一位 guard digit），寫得完的數（例如 $1/64=0.015625$）完整顯示。照著畫面上的數字按計算機，中間值的最後一位可能差 1–2（四捨五入），答案的前 4–5 位會一致；最好把中間值留在計算機裡接著算，不要重新輸入。`

/** 迴路沒有穩態（σ_v = 0、極性錯誤、|p| ≥ 1）時，直接回傳模型自己的警告文字（calLoop().warnings，含 $...$）。 */
function loopError(lp: CalLoop): string | null {
  if (lp.regime === 'undefined' || lp.regime === 'polarity' || lp.regime === 'unstable') {
    return lp.warnings[0] ?? `${REGIME_LABEL_TEX[lp.regime]}：線性化模型不適用。`
  }
  return null
}

/** f_u = f_s/N（由模型的 loopCore 計算；其餘參數與 f_u 無關） */
function blockRate(fsGHz: number, N: number): { fu: number; sigmaEta2: number } {
  const { fu, sigmaEta2 } = loopCore(N, fsGHz * GHZ, 1, 1, 1, 'average')
  return { fu, sigmaEta2 }
}

function fuStep(fsGHz: number, N: number, fu: number): HandCalcStep {
  return {
    tex: String.raw`f_u=\frac{f_s}{N}=\frac{${tx(fsGHz * GHZ)}\ \mathrm{Hz}}{${N}}=${tx(fu, 7)}\ \mathrm{Hz}=${tx(fu / KHZ, 7)}\ \mathrm{kHz}`,
    why: String.raw`block update rate：係數每 $N$ 個 sample 才更新一次，所以 $\delta w_k$ 的取樣率是 $f_u$（$1\ \mathrm{GHz}=10^{9}\ \mathrm{Hz}$、$1\ \mathrm{kHz}=10^{3}\ \mathrm{Hz}$）。`,
  }
}

/**
 * g 與 pole 要顯示幾位有效數字：p = 1 − g，所以兩者顯示到相同的小數位，「1 − g」這個減法才不會憑空多出或少掉位數
 * （g = 0.0797885 ⇒ p = 0.9202115）。小數位數取「g 的 6 位」與「p 的 6 位」中較多的那個（g > 1 時 p 比 g 小，
 * 要以 p 為準：g = 1.196827 ⇒ p = −0.196827），但最多比 g 的 6 位再多 2 位。
 */
function poleDigits(g: number, p: number): { gS: number; pS: number } {
  const dG = decimalsAt(g)
  const dec = Math.min(Math.max(dG, decimalsAt(p)), dG + 2)
  return { gS: sigAtDecimals(g, dec), pS: sigAtDecimals(p, dec) }
}

/** 相對誤差（%）的 TeX */
function pct(a: number, ref: number, sig = 3): string {
  return texNum(((a - ref) / ref) * 100, sig)
}

/**
 * HC-12.6 用：以 Code Mixing Lab 的實際模擬（simulateMixing：時域逐點相乘 + tone fit）取得混頻產物。
 * 範例數字時就是 T15 的設定（f_sim = 4.096 MHz、L = 4096，bin = 1 kHz）；頻率較高時把 f_sim 加倍到 > 4(f_x + f_w)。
 */
function runMix(A: number, B: number, fxKHz: number, fwKHz: number, m: number): { r: MixingSimResult; fsim: number } {
  const fx = fxKHz * KHZ
  const fw = fwKHz * KHZ
  let fsim = 4.096e6
  while (fsim <= 4 * (fx + fw)) fsim *= 2
  const r = simulateMixing({ fsim, L: 4096, fx, A, m, codeWhite: 0, fw, B, holdN: 1, dwNoiseSigma: 0, dwNoiseP: 0, fOut: 13e9, Tmag: 1, window: 'rectangular', seed: 1 })
  return { r, fsim }
}

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── HC-12.1：K → g → p，再讓雜訊推三步（§12.0「先算一次」） ───────────── */
  {
    id: 'HC-12.1',
    title: String.raw`先算一次：$K\to g\to p$，再讓雜訊推三步`,
    page: PAGE,
    formulaId: 'F-12.2',
    formulaTex: String.raw`K=K_q\,C=\frac{\sqrt{2/\pi}}{\sigma_v}\,C,\qquad g=\mu K,\qquad p=1-g,\qquad \delta w_{k+1}=p\,\delta w_k+\mu\,\eta_k,\quad \eta_k=\pm\sigma_\eta=\pm\frac{1}{\sqrt N}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: U_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 80, 100, 125, 200, 250] } },
      { key: 'C', symbol: 'C', label: '有效 code 相關（identity path 時為 1）', default: 1, min: -10, max: 10, practice: { choices: [0.5, 1, 1, 2] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（learning rate）', unit: U_FS, default: 10, min: -1e4, max: 1e4, practice: { choices: [2, 5, 10, 20, 25, 40] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [64, 256, 1024, 4096, 16384] } },
    ],
    validate: ({ sigmaV, C, mu, N }) => loopError(calLoop({ N, fs: FS_REF, mu, sigmaV, C })),
    solve: ({ sigmaV, C, mu, N }) => {
      const lp = loopCore(N, FS_REF, mu, sigmaV, C, 'average')
      const sEta = Math.sqrt(lp.sigmaEta2)
      const kick = mu * sEta
      const dw1 = dwStep(0, lp.p, mu, sEta)
      const dw2 = dwStep(dw1, lp.p, mu, -sEta)
      const dw3 = dwStep(dw2, lp.p, mu, sEta)
      const prod1 = lp.p * dw1 // 第 8 步的中間值 p·δw_1（章首表格的第三欄）
      const prod2 = lp.p * dw2
      const { gS, pS } = poleDigits(lp.g, lp.p)
      // 第 8、9 步是加減：運算元要多顯示被抵銷掉的位數（p·δw_1 與 μσ_η 幾乎相等時差最多）
      const s8 = sigFor(dw2, prod1, kick)
      const s9 = sigFor(dw3, prod2, kick)
      const kS = Math.max(s8, s9)
      // 第 8 步的說明依 p 的大小分三種：幾乎抵消（p > 0.5）、抵消不多（0 ≤ p ≤ 0.5）、變號而相加（p < 0）
      const why8 =
        lp.p > 0.5
          ? String.raw`兩項幾乎抵消，只剩 $-g\,\mu\sigma_\eta$。所以乘積要多寫幾位再相減。`
          : lp.p >= 0
            ? String.raw`合起來是 $-g\,\mu\sigma_\eta$。這裡 $g$ 不小，舊偏差只留下不到一半，兩項不再幾乎抵消。`
            : String.raw`合起來是 $-g\,\mu\sigma_\eta$。$g>1$ 使 $p<0$：舊偏差不只縮小還變號，兩項同號相加，一步就衝到另一邊（overshoot）；只要 $|p|<1$ 仍然穩定。`
      return {
        steps: [
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${ROOT_TEX}}{${txIn(sigmaV)}}=${tx(lp.Kq)}\ \mathrm{fs}^{-1}`,
            why: String.raw`1-bit comparator 的小訊號增益（第 5 章）。$\sqrt{2/\pi}=${ROOT_TEX}$：計算機按 $2\div\pi=0.63662$ 再開根號；這個常數整章都會用到。`,
          },
          {
            tex: String.raw`K=K_q\,C=${txM(lp.Kq)}\times${txM(C, 15)}=${tx(lp.K)}\ \mathrm{fs}^{-1}`,
            why: String.raw`GMAC 平均輸出對係數偏差的斜率。unit-RMS code、identity path 時 $C=1$（勘誤 E30 的條件）。`,
          },
          {
            tex: String.raw`g=\mu K=${txM(mu, 15)}\times${txM(lp.K)}=${tx(lp.g, gS)}`,
            why: String.raw`無因次迴路增益：$\mu$（fs）乘 $K$（$\mathrm{fs}^{-1}$），單位剛好消掉。`,
          },
          {
            tex: String.raw`p=1-g=1-${tx(lp.g, gS)}=${tx(lp.p, pS)}`,
            why: String.raw`pole：每個 block 舊的偏差只留下 $p$ 倍。$0<g<2$ 才有 $|p|<1$。$p$ 的每一位都要留著，第 8 步會用到。`,
          },
          {
            tex: String.raw`\sigma_\eta=\frac{1}{\sqrt N}=\frac{1}{\sqrt{${N}}}=\frac{1}{${tx(Math.sqrt(N), kS)}}=${tx(sEta, kS)}`,
            why: String.raw`GMAC 把 $N$ 個 $\pm1$ 的乘積取平均，雜訊 RMS 降 $\sqrt N$ 倍（$\sigma_\eta^2\approx1/N$）。`,
          },
          {
            tex: String.raw`\mu\,\sigma_\eta=${txM(mu, 15)}\times${txM(sEta, kS)}=${tx(kick, kS)}\ \mathrm{fs}`,
            why: String.raw`每個 block 的雜訊把係數推動的幅度（一個標準差）。`,
          },
          {
            tex: String.raw`\delta w_1=p\,\delta w_0+\mu(+\sigma_\eta)=${txM(lp.p, pS)}\times0+${tx(kick, kS)}=${tx(dw1, kS)}\ \mathrm{fs}`,
            why: String.raw`從固定點出發（$\delta w_0=w_0-w^*=0$），第一個 block 的雜訊取 $+\sigma_\eta$。$+,-,+$ 只是方便手算的示意圖樣，不是模擬結果。`,
          },
          {
            tex: String.raw`\delta w_2=p\,\delta w_1+\mu(-\sigma_\eta)=${txM(lp.p, pS)}\times${txM(dw1, kS)}-${tx(kick, kS)}=${tx(prod1, s8)}-${tx(kick, kS)}=${tx(dw2)}\ \mathrm{fs}`,
            why: String.raw`先乘（舊偏差留下 $p$ 倍，就是章首「先算一次」表格的 $p\,\delta w_k$ 欄），再被 $-\sigma_\eta$ 推一次。${why8}`,
          },
          {
            tex: String.raw`\delta w_3=p\,\delta w_2+\mu(+\sigma_\eta)=${txM(lp.p, pS)}\times${txM(dw2)}+${tx(kick, kS)}=${tx(prod2, s9)}+${tx(kick, kS)}=${tx(dw3, 5)}\ \mathrm{fs}`,
            why: String.raw`同樣先乘再加：再被 $+\sigma_\eta$ 推一次。$|p|<1$ 讓舊的偏差一步步被忘掉，所以係數不會跑掉；但雜訊每個 block 都在推，所以也停不下來。`,
          },
        ],
        results: [
          { symbol: 'p', label: 'pole', value: lp.p, digits: pS },
          { symbol: String.raw`\delta w_1`, label: '第 1 個 block 之後', value: dw1, unit: U_FS },
          { symbol: String.raw`\delta w_2`, label: '第 2 個 block 之後', value: dw2, unit: U_FS, tolerance: { rel: 0.03, abs: 1e-9 } },
          { symbol: String.raw`\delta w_3`, label: '第 3 個 block 之後', value: dw3, unit: U_FS, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes: [
          String.raw`$g=\mu K=${texNum(lp.g)}$ ⇒ $H_{\eta\to w}$ 的型態：${REGIME_LABEL_TEX[bwRegime(lp.p, C, sigmaV)]}。`,
          String.raw`用範例數字時，三個答案就是第 12 章章首「先算一次」表格的前三列（$0.15625$、$-0.01247$、$0.14478$ fs）。`,
          String.raw`一步只推 $\mu\sigma_\eta=${texNum(kick)}$ fs；長時間累積下來的穩態 RMS 是 $\sigma_w=\mu\sigma_\eta/\sqrt{1-p^2}=${texNum(Math.sqrt(lp.sigmaW2))}$ fs（HC-12.3）。`,
          String.raw`極性（勘誤 E33）：本章的 $\delta w_k=w_k-w^*$ 與全站 §0 的 $\delta_k=a-w_k$ 相反。$w^*=a$ 時 $\delta_k=-\delta w_k$，遞迴變成 $\delta_{k+1}=p\,\delta_k-\mu\eta_k$：$p$ 不變，上面三個答案全部變號（$\delta_1=${texNum(-dw1)}$、$\delta_2=${texNum(-dw2)}$、$\delta_3=${texNum(-dw3)}$ fs）。`,
        ],
      }
    },
    tips: [
      String.raw`$\sqrt{2/\pi}=${ROOT_TEX}$ 值得背起來：$K_q=${ROOT_TEX}/\sigma_v$。`,
      String.raw`$N$ 選 4 的冪次（$64,\,256,\,1024,\,4096,\,16384$）時 $\sqrt N=8,\,16,\,32,\,64,\,128$，不必按計算機。`,
      String.raw`第 8 步是兩個幾乎相等的數相減：$p$ 與乘積 $p\,\delta w_1$ 都要照畫面上的位數寫完（至少 6–7 位），否則答案會差很多。也可以用 $\delta w_2=-g\,\mu\sigma_\eta$ 驗算。`,
      GUARD_TIP,
    ],
  },

  /* ───────────── HC-12.2：單位圓上一點的 |H|² 與 PSD（複數拆成實部／虛部） ───────────── */
  {
    id: 'HC-12.2',
    title: String.raw`單位圓上的一點：$|H|^2$ 相對 DC 掉幾 dB、$S_w^{(1)}(f)$ 是多少`,
    page: PAGE,
    formulaId: 'F-12.4',
    formulaTex: String.raw`\Omega=\frac{2\pi f}{f_u},\qquad e^{j\Omega}-p=(\cos\Omega-p)+j\sin\Omega,\qquad \frac{|H(e^{j\Omega})|^2}{|H(1)|^2}=\frac{(1-p)^2}{|e^{j\Omega}-p|^2},\qquad S_w^{(1)}(f)=\frac{2}{f_u}\cdot\frac{\mu^2\sigma_\eta^2}{|e^{j\Omega}-p|^2}`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'p', symbol: 'p', label: 'pole（HC-12.1 的結果）', default: P_EXAMPLE, min: -2, max: 2, practice: { choices: [0.5, 0.6, 0.75, 0.8, 0.9] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（learning rate）', unit: U_FS, default: 10, min: -1e4, max: 1e4, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0.001, max: 1000, practice: { choices: [2, 4] } },
      { key: 'f', symbol: 'f', label: '要看的頻率', unit: U_KHZ, default: 12.931, min: 0, max: 1e7, practice: { choices: [5, 10, 20, 50, 100, 200] } },
    ],
    validate: ({ p, mu, N, fs, f }) => {
      if (!(Math.abs(p) < 1)) return String.raw`$|p|\ge1$：pole 不在單位圓內，$\delta w$ 沒有穩態，$S_w$ 沒有定義（F-12.4 需要 $|p|<1$，即 $0<\mu K<2$）。`
      if (!(mu > 0)) return String.raw`$\mu\le0$：learning rate 必須為正（$\mu=0$ 時係數不更新，沒有係數雜訊；$\mu<0$ 時更新方向相反）。`
      const { fu } = blockRate(fs, N)
      if (f * KHZ > fu / 2) {
        return String.raw`$f=${texNum(f)}$ kHz 超過 block rate 的 Nyquist $f_u/2=${texNum(fu / 2 / KHZ)}$ kHz：$\delta w_k$ 每個 block 才一個值，block-rate 的 $S_w$ 只定義在 $0\ldots f_u/2$；更高的頻率要先做 ZOH 換算成 sample-rate 的頻譜（F-12.14，勘誤 E29）。`
      }
      return null
    },
    solve: ({ p, mu, N, fs, f }) => {
      const { fu, sigmaEta2 } = blockRate(fs, N)
      const fHz = f * KHZ
      const ratioF = fHz / fu
      const omega = 2 * Math.PI * ratioF
      const c = Math.cos(omega)
      const s = Math.sin(omega)
      const re = c - p
      const q = mu * mu * sigmaEta2
      const S = swDtft(omega, mu, p, sigmaEta2) // μ²σ_η²/(1 − 2p cosΩ + p²)
      const den = q / S
      const rel = S / swDtft(0, mu, p, sigmaEta2)
      const dB = 10 * Math.log10(rel)
      const S1 = swOneSided(fHz, mu, p, sigmaEta2, fu)
      const S1dc = swOneSided(0, mu, p, sigmaEta2, fu)
      const f3 = bw3dbExact(p, fu)
      // cosΩ − p 是相近的數相減：Ω、cosΩ、sinΩ 顯示到小數點後 dec 位（|e^{jΩ} − p| 越小，需要的位數越多）
      const dec = Math.min(12, Math.max(7, 6 + Math.ceil(-Math.log10(Math.sqrt(den)))))
      const one = 1 - p
      return {
        steps: [
          fuStep(fs, N, fu),
          {
            tex: String.raw`\frac{f}{f_u}=\frac{${txIn(f)}\ \mathrm{kHz}}{${tx(fu / KHZ, 7)}\ \mathrm{kHz}}=${txD(ratioF, dec + 1)}`,
            why: String.raw`把頻率對 block rate 正規化（上下用同一個單位）。這個比值和下一步的 $\Omega$ 都要多留幾位：第 6 步有相近的數相減。`,
          },
          {
            tex: String.raw`\Omega=2\pi\cdot\frac{f}{f_u}=2\pi\times${txDM(ratioF, dec + 1)}=${txD(omega, dec)}\ \mathrm{rad/block}`,
            why: String.raw`離散頻率；$\Omega=\pi$ 對應 Nyquist $f_u/2$。用計算機的 $\pi$ 鍵（$2\pi=${TWO_PI_TEX}$）。`,
          },
          {
            tex: String.raw`\cos\Omega=\cos(${txD(omega, dec)})=${txD(c, dec)}`,
            why: String.raw`計算機切到 RAD（弧度）模式。$\Omega\le0.1$ 時可用 $\cos\Omega\approx1-\Omega^2/2$（誤差小於 $5\times10^{-6}$）。`,
          },
          {
            tex: String.raw`\sin\Omega=\sin(${txD(omega, dec)})=${txD(s, dec)}`,
            why: String.raw`同樣用 RAD 模式。$\Omega\le0.1$ 時可用 $\sin\Omega\approx\Omega-\Omega^3/6$（誤差小於 $10^{-7}$）。`,
          },
          {
            tex: String.raw`e^{j\Omega}-p=(\cos\Omega-p)+j\sin\Omega=(${txD(c, dec)}-${txP(p, 15)})+j\,${txD(s, dec)}=${txD(re, dec)}+j\,${txD(s, dec)}`,
            why: String.raw`Euler 公式 $e^{j\Omega}=\cos\Omega+j\sin\Omega$ 把複數拆成實部與虛部：實部減掉 $p$，虛部不變。`,
          },
          {
            tex: String.raw`|e^{j\Omega}-p|^2=\mathrm{Re}^2+\mathrm{Im}^2=${txDM(re, dec)}^2+${txDM(s, dec)}^2=${tx(re * re)}+${tx(s * s)}=${tx(den)}`,
            why: String.raw`複數的絕對值平方 = 實部平方 + 虛部平方（展開後就是 $1-2p\cos\Omega+p^2$）。`,
          },
          {
            tex: String.raw`\frac{|H(e^{j\Omega})|^2}{|H(1)|^2}=\frac{(1-p)^2}{|e^{j\Omega}-p|^2}=\frac{(1-${txP(p, 15)})^2}{${tx(den)}}=\frac{${txM(one)}^2}{${tx(den)}}=\frac{${tx(one * one)}}{${tx(den)}}=${tx(rel)}`,
            why: String.raw`$\Omega=0$（DC）時分母是 $(1-p)^2$；$\mu^2$ 上下約掉，所以這個比值只跟 $p$ 與 $\Omega$ 有關。`,
          },
          {
            tex: String.raw`10\log_{10}\frac{|H(e^{j\Omega})|^2}{|H(1)|^2}=10\log_{10}(${tx(rel)})=${txD(dB, 4)}\ \mathrm{dB}`,
            why: String.raw`功率比取 $10\log_{10}$（計算機的 log 鍵）。記住 $10\log_{10}\tfrac12=-3.0103$ dB。`,
          },
          {
            tex: String.raw`\mu^2\sigma_\eta^2=\frac{\mu^2}{N}=\frac{${txM(mu, 15)}^2}{${N}}=\frac{${tx(mu * mu)}}{${N}}=${tx(q)}\ \mathrm{fs}^2`,
            why: String.raw`每個 block 注入的雜訊功率（白色 GMAC noise，$\sigma_\eta^2=1/N$）。`,
          },
          {
            tex: String.raw`S_w(e^{j\Omega})=\frac{\mu^2\sigma_\eta^2}{|e^{j\Omega}-p|^2}=\frac{${tx(q)}}{${tx(den)}}=${tx(S)}\ \mathrm{fs}^2`,
            why: String.raw`F-12.4 的 DTFT 形式（正規化：$\sigma_w^2=\tfrac1{2\pi}\int_{-\pi}^{\pi}S_w\,d\Omega$）。`,
          },
          {
            tex: String.raw`\frac{2}{f_u}=\frac{2}{${tx(fu, 7)}\ \mathrm{Hz}}=${tx(2 / fu)}\ \mathrm{Hz}^{-1}`,
            why: String.raw`DTFT 形式換成單邊 per-Hz 的係數（F-12.10：$S^{(1)}(f)=\tfrac{2}{f_r}S$，block-rate 的量取 $f_r=f_u$）。F-12.10 的推導在後面的「PSD 正規化」一節；這裡先把它當成單位換算。$f_u$ 用 Hz。`,
          },
          {
            tex: String.raw`S_w^{(1)}(f)=\frac{2}{f_u}\,S_w(e^{j\Omega})=${txM(2 / fu)}\times${txM(S)}=${tx(S1, 5)}\ \mathrm{fs^2/Hz}`,
            why: String.raw`$0\ldots f_u/2$ 內每 1 Hz 的係數雜訊功率。漏掉 $2/f_u$ 這個係數，位準會差 $10\log_{10}(f_u/2)$ dB（勘誤 E28）。`,
          },
        ],
        results: [
          { symbol: String.raw`\Omega`, label: '離散頻率', value: omega, unit: String.raw`\mathrm{rad/block}` },
          { symbol: String.raw`|e^{j\Omega}-p|^2`, label: '分母', value: den, tolerance: { rel: 0.02, abs: 1e-12 } },
          { symbol: String.raw`10\log_{10}\tfrac{|H|^2}{|H(1)|^2}`, label: '相對 DC', value: dB, unit: String.raw`\mathrm{dB}`, digits: sigAtDecimals(dB, 4), tolerance: { rel: 0.005, abs: 0.05 } },
          { symbol: String.raw`S_w^{(1)}(f)`, label: '單邊 PSD', value: S1, unit: String.raw`\mathrm{fs^2/Hz}`, tolerance: { rel: 0.02, abs: 1e-30 } },
        ],
        notes: [
          Number.isFinite(f3)
            ? String.raw`這個 $p$ 的 exact $-3$ dB 頻率是 $${texNum(f3 / KHZ)}$ kHz（HC-12.4）：把 $f$ 設成它，第 9 步會得到 $-3.01$ dB。`
            : String.raw`這個 $p$ 沒有 $-3$ dB 點（${REGIME_LABEL_TEX[bwRegime(p, 1)]}，勘誤 E27）：Nyquist（$\Omega=\pi$）處相對 DC 是 $${texNum(10 * Math.log10(swDtft(Math.PI, mu, p, sigmaEta2) / swDtft(0, mu, p, sigmaEta2)), 3)}$ dB。`,
          String.raw`低頻位準 $S_w^{(1)}(0)=${texNum(S1dc)}\ \mathrm{fs^2/Hz}$；$f$ 遠低於 corner 時 $S_w^{(1)}(f)$ 幾乎等於它。`,
          String.raw`$\mu$ 只把整條曲線上下平移（$|H|^2\propto\mu^2$），形狀完全由 $p$ 決定。`,
        ],
      }
    },
    tips: [
      String.raw`所有三角函數都用 RAD（弧度）模式；$\Omega$ 的單位是 rad/block。`,
      String.raw`第 6 步的實部 $\cos\Omega-p$ 在 $p\to1$、$\Omega$ 很小時是兩個接近 1 的數相減：$\Omega$、$\cos\Omega$、$\sin\Omega$ 都要照畫面上的位數（至少小數點後 7 位）寫完，否則分母會差很多。`,
      String.raw`小角近似：$\Omega\le0.1$ 時 $\cos\Omega\approx1-\Omega^2/2$、$\sin\Omega\approx\Omega-\Omega^3/6$ 就夠準了。`,
      String.raw`沒有 $\log_{10}$ 鍵時：$\log_{10}x=\ln x/2.3026$。`,
      GUARD_TIP,
    ],
  },

  /* ───────────── HC-12.3：σ_w 與 τ（§12.4 的取捨表） ───────────── */
  {
    id: 'HC-12.3',
    title: String.raw`穩態係數雜訊 $\sigma_w$ 與時間常數 $\tau$：learning rate 的取捨`,
    page: PAGE,
    formulaId: 'F-12.5',
    formulaTex: String.raw`p=1-\mu\,\frac{\sqrt{2/\pi}}{\sigma_v}\ \ (C=1),\qquad \sigma_w=\frac{\mu}{\sqrt{N(1-p^2)}},\qquad \tau=\frac{-1}{\ln|p|}\ \text{[blocks]},\qquad \tau_{\mathrm s}=\frac{\tau}{f_u},\ \ f_u=\frac{f_s}{N}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（learning rate）', unit: U_FS, default: 10, min: -1e4, max: 1e4, practice: { choices: [2.5, 5, 10, 20, 40] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: U_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0.001, max: 1000, practice: { choices: [1, 2, 4] } },
    ],
    validate: ({ mu, sigmaV, N, fs }) => {
      const lp = calLoop({ N, fs: fs * GHZ, mu, sigmaV, C: 1 })
      const bad = loopError(lp)
      if (bad) return bad
      if (lp.regime === 'flat') return String.raw`${lp.warnings[0] ?? ''} 這時每個 block 都把舊的偏差完全忘掉（$\tau=0$），$\ln 0$ 沒有定義，時間常數的公式不適用。`
      return null
    },
    solve: ({ mu, sigmaV, N, fs }) => {
      const lp = calLoop({ N, fs: fs * GHZ, mu, sigmaV, C: 1 })
      const { gS, pS } = poleDigits(lp.g, lp.p)
      const p2 = lp.p * lp.p
      const one = 1 - p2
      const s3 = sigFor(one, 1, p2) // 1 − p² 是相近的數相減：p² 多顯示被抵銷的位數
      const nOne = N * one
      const root = Math.sqrt(nOne)
      const lnp = Math.log(Math.abs(lp.p))
      const tauUs = lp.tauSeconds * 1e6
      const notes: string[] = []
      const twice = calLoop({ N, fs: fs * GHZ, mu: 2 * mu, sigmaV, C: 1 })
      if (Math.abs(twice.p) < 1 && twice.p !== 0) {
        notes.push(
          String.raw`取捨：把 $\mu$ 加倍成 $${texNum(2 * mu)}$ fs 再算一次，會得到 $\sigma_w=${texNum(twice.sigmaW)}$ fs（$\times${texNum(twice.sigmaW / lp.sigmaW, 4)}$，約 $\sqrt2$）、$\tau=${texNum(twice.tauBlocks)}$ blocks（$\times${texNum(twice.tauBlocks / lp.tauBlocks, 4)}$，約 $\tfrac12$）：抖得大、收斂得快。`,
        )
      }
      notes.push(String.raw`把 $N$ 變 4 倍（$\mu$ 不變）：$p$ 不變、$\sigma_w$ 減半，但 $f_u$ 變成 $\tfrac14$，所以以秒計的 $\tau_{\mathrm s}$ 變 4 倍（思考題 2）。`)
      if (lp.g > 0 && lp.g < 1) {
        notes.push(
          String.raw`粗估（$g\ll1$）：$\tau\approx1/g=${texNum(1 / lp.g)}$ blocks（差 $${pct(1 / lp.g, lp.tauBlocks)}\%$）、$\sigma_w\approx\mu/\sqrt{2gN}=${texNum(mu / Math.sqrt(2 * lp.g * N))}$ fs（差 $${pct(mu / Math.sqrt(2 * lp.g * N), lp.sigmaW)}\%$）；兩個粗估的誤差分別約為 $+g/2$ 與 $-g/4$。`,
        )
      }
      if (lp.p < 0) notes.push(String.raw`$p<0$：相鄰 block 的 $\delta w$ 正負交替，但包絡仍以 $|p|^k$ 衰減，所以時間常數用 $\ln|p|$。`)
      notes.push(String.raw`$\sigma_w$ 是 gain-equivalent 的係數雜訊：還沒乘上 code、還沒經過 PLL，不能直接當成 output jitter（HC-12.8）。`)
      return {
        steps: [
          {
            tex: String.raw`g=\mu K=\mu\,\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${txM(mu, 15)}\times${ROOT_TEX}}{${txIn(sigmaV)}}=\frac{${tx(mu * SQRT_2_OVER_PI)}}{${txIn(sigmaV)}}=${tx(lp.g, gS)}`,
            why: String.raw`迴路增益（$K=K_qC$，這一題固定 $C=1$；分步算法見 HC-12.1）。$\sqrt{2/\pi}=${ROOT_TEX}$。`,
          },
          { tex: String.raw`p=1-g=1-${tx(lp.g, gS)}=${tx(lp.p, pS)}`, why: String.raw`pole：每個 block 舊偏差留下的比例。` },
          { tex: String.raw`p^2=${txM(lp.p, pS)}^2=${tx(p2, s3)}`, why: String.raw`變異數每個 block 留下 $p^2$ 倍（$V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2$）。下一步要用 1 去減它，所以多寫幾位。` },
          {
            tex: String.raw`1-p^2=1-${tx(p2, s3)}=${tx(one)}`,
            why: String.raw`穩態時「每個 block 漏掉的比例」$1-p^2$ 要剛好等於新注入的雜訊；$\mu$ 越小，$1-p^2\approx2g$ 越小。`,
          },
          { tex: String.raw`N(1-p^2)=${N}\times${txM(one)}=${tx(nOne)}`, why: String.raw`$\sigma_\eta^2=1/N$：$N$ 越大，每個 block 的雜訊越小。` },
          { tex: String.raw`\sqrt{N(1-p^2)}=\sqrt{${tx(nOne)}}=${tx(root)}`, why: String.raw`計算機的開根號鍵。` },
          {
            tex: String.raw`\sigma_w=\frac{\mu}{\sqrt{N(1-p^2)}}=\frac{${txIn(mu)}}{${tx(root)}}=${tx(lp.sigmaW, 5)}\ \mathrm{fs}`,
            why: String.raw`穩態係數雜訊的 RMS（F-12.5 + F-12.6）。`,
          },
          {
            tex: String.raw`\ln|p|=\ln(${tx(Math.abs(lp.p), pS)})=${tx(lnp)}`,
            why: String.raw`計算機的 ln 鍵。$g\le0.1$ 時可用 $\ln(1-g)\approx-g-g^2/2$（相對誤差小於 $0.4\%$）。`,
          },
          {
            tex: String.raw`\tau=\frac{-1}{\ln|p|}=\frac{-1}{${tx(lnp)}}=${tx(lp.tauBlocks)}\ \text{blocks}`,
            why: String.raw`偏差衰減到 $1/e\approx37\%$ 需要的 block 數（$|p|^{\tau}=e^{-1}$）。`,
          },
          fuStep(fs, N, lp.fu),
          {
            tex: String.raw`\tau_{\mathrm s}=\frac{\tau}{f_u}=\frac{${tx(lp.tauBlocks)}}{${tx(lp.fu, 7)}\ \mathrm{Hz}}=${tx(lp.tauSeconds)}\ \mathrm s=${tx(tauUs, 5)}\ \mu\mathrm s`,
            why: String.raw`一個 block 是 $1/f_u$ 秒；換成秒才能和 PLL 的 lock time 比較（$1\ \mathrm s=10^{6}\ \mu\mathrm s$）。`,
          },
        ],
        results: [
          { symbol: 'p', label: 'pole', value: lp.p, digits: pS },
          { symbol: String.raw`\sigma_w`, label: '穩態係數雜訊 RMS', value: lp.sigmaW, unit: U_FS },
          { symbol: String.raw`\tau`, label: '時間常數', value: lp.tauBlocks, unit: String.raw`\text{blocks}`, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`\tau_{\mathrm s}`, label: '時間常數（換成時間）', value: tauUs, unit: String.raw`\mu\mathrm s`, tolerance: { rel: 0.02, abs: 1e-12 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`第 4 步是相近的數相減：$p^2$ 照畫面上的位數寫完（至少 6 位有效數字）。`,
      String.raw`第 8 步的 $\ln$ 對 $p$ 的捨入很敏感（$p\to1$ 時 $\ln p\approx-(1-p)$）：$p$ 也要寫完第 2 步的每一位。`,
      String.raw`想重現 §12.4 的取捨表：依序把 $\mu$ 換成 $2.5,\,5,\,10,\,20,\,40$ fs。`,
      GUARD_TIP,
    ],
  },

  /* ───────────── HC-12.4：−3 dB 頻率三種算法（T14） ───────────── */
  {
    id: 'HC-12.4',
    title: String.raw`$-3$ dB 頻率的三種算法：$(1-p)$、$-\ln p$、exact`,
    page: PAGE,
    formulaId: 'F-12.7',
    formulaTex: String.raw`f_{3\mathrm{dB}}=\frac{\Omega_{3\mathrm{dB}}}{2\pi}f_u,\qquad \Omega_{3\mathrm{dB}}\approx\underbrace{1-p}_{\text{一階近似}}\approx\underbrace{-\ln p}_{\text{二階準確}},\qquad \Omega_{3\mathrm{dB}}=\underbrace{2\arcsin\frac{1-p}{2\sqrt p}}_{\text{exact}}\quad(3-2\sqrt2\le p<1)`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'p', symbol: 'p', label: 'pole（HC-12.1 的結果）', default: P_EXAMPLE, min: -2, max: 2, practice: { choices: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0.001, max: 1000, practice: { choices: [1, 2, 4] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
    ],
    validate: ({ p }) => {
      const regime = bwRegime(p, 1)
      if (regime === 'lowpass') return null
      const head = REGIME_LABEL_TEX[regime]
      if (regime === 'no3db') {
        return String.raw`${head}：$\arcsin$ 的引數 $\tfrac{1-p}{2\sqrt p}=${texNum((1 - p) / (2 * Math.sqrt(p)))}>1$，沒有解——$|H|^2$ 在 Nyquist $f_u/2$ 仍高於 DC 的一半。兩個近似公式還是會「算出數字」，但那個數字沒有意義（勘誤 E27）。請用 $p\ge3-2\sqrt2\approx0.1716$。`
      }
      if (regime === 'flat') return String.raw`${head}：$\delta w_{k+1}=\mu\eta_k$，頻譜是平的，沒有 $-3$ dB 點。`
      if (regime === 'highpass') return String.raw`${head}：相鄰 block 正負交替，$|H|^2$ 在高頻反而變大；low-pass 的頻寬定義不適用，$\ln p$ 與 $\sqrt p$ 也都沒有實數值（勘誤 E27）。`
      return String.raw`${head}：pole 不在單位圓內，迴路沒有穩態，也就沒有頻寬可言。請用 $3-2\sqrt2\le p<1$。`
    },
    solve: ({ p, fs, N }) => {
      const { fu } = blockRate(fs, N)
      const perRad = fu / (2 * Math.PI) / KHZ // 每 1 rad/block 對應多少 kHz
      const f1 = bw3dbOneMinusP(p, fu)
      const f2 = bw3dbNegLnP(p, fu)
      const f3 = bw3dbExact(p, fu)
      const om1 = (f1 / fu) * 2 * Math.PI
      const om2 = (f2 / fu) * 2 * Math.PI
      const om3 = (f3 / fu) * 2 * Math.PI
      const root = Math.sqrt(p)
      const s = Math.sin(om3 / 2)
      const eps = 1 - p
      const cosArg = 1 - (eps * eps) / (2 * p)
      const notes = [
        String.raw`相對 exact：$(1-p)$ 版 $${pct(f1, f3)}\%$（預測 $-(1-p)/2=${texNum((-eps / 2) * 100, 3)}\%$）；$-\ln p$ 版 $${pct(f2, f3, 2)}\%$（預測 $-(1-p)^2/12=${texNum(((-eps * eps) / 12) * 100, 2)}\%$）。`,
        String.raw`等價寫法：$\Omega_{3\mathrm{dB}}=\arccos\!\big(1-\tfrac{(1-p)^2}{2p}\big)=\arccos(${texNum(cosArg, 8)})$。$p\to1$ 時引數非常接近 1，手算容易丟掉有效位數，所以這裡用 $\arcsin$ 的寫法。`,
      ]
      if (p === P_EXAMPLE && fs === 4 && N === 4096) {
        notes.push(String.raw`規格寫的「約 12.9 kHz」只和 $-\ln p$ 版與 exact 吻合；照 $(1-p)$ 版實作會得到 12.40 kHz（T14、勘誤 E26）。`)
      }
      return {
        steps: [
          fuStep(fs, N, fu),
          {
            tex: String.raw`\frac{f_u}{2\pi}=\frac{${tx(fu / KHZ, 7)}\ \mathrm{kHz}}{2\pi}=${tx(perRad, 7)}\ \mathrm{kHz}`,
            why: String.raw`每 1 rad/block 對應多少 kHz；三種算法最後都乘這個數。用計算機的 $\pi$ 鍵（$2\pi=${TWO_PI_TEX}$）。`,
          },
          {
            tex: String.raw`\Omega^{(1-p)}=1-p=1-${txP(p, 15)}=${tx(om1)}`,
            why: String.raw`一階近似：只保留 $-\ln p=(1-p)+\tfrac{(1-p)^2}{2}+\cdots$ 的第一項。`,
          },
          {
            tex: String.raw`f_{3\mathrm{dB}}^{(1-p)}=\Omega^{(1-p)}\cdot\frac{f_u}{2\pi}=${txM(om1)}\times${txM(perRad, 7)}\ \mathrm{kHz}=${tx(f1 / KHZ, 5)}\ \mathrm{kHz}`,
            why: String.raw`相對 exact 的誤差約 $-(1-p)/2$（勘誤 E26）。`,
          },
          {
            tex: String.raw`\Omega^{(\ln)}=-\ln p=-\ln(${txIn(p)})=${tx(om2)}`,
            why: String.raw`把每個 block 的衰減 $p$ 看成連續時間的 $e^{-\omega_c/f_u}$。計算機按 ln；$1-p\le0.1$ 時可用 $-\ln p\approx(1-p)+(1-p)^2/2$（相對誤差小於 $0.4\%$）。`,
          },
          {
            tex: String.raw`f_{3\mathrm{dB}}^{(\ln)}=\Omega^{(\ln)}\cdot\frac{f_u}{2\pi}=${txM(om2)}\times${txM(perRad, 7)}\ \mathrm{kHz}=${tx(f2 / KHZ, 5)}\ \mathrm{kHz}`,
            why: String.raw`二階準確：相對 exact 的誤差約 $-(1-p)^2/12$。`,
          },
          { tex: String.raw`\sqrt p=\sqrt{${txIn(p)}}=${tx(root, 7)}`, why: String.raw`計算機的開根號鍵。` },
          {
            tex: String.raw`s=\frac{1-p}{2\sqrt p}=\frac{${tx(eps)}}{2\times${tx(root, 7)}}=\frac{${tx(eps)}}{${tx(2 * root, 7)}}=${tx(s)}`,
            why: String.raw`這就是 $\sin(\Omega_{3\mathrm{dB}}/2)$。$s\le1$ 才有解，也就是 $p\ge3-2\sqrt2\approx0.1716$（勘誤 E27）。`,
          },
          {
            tex: String.raw`\Omega_{3\mathrm{dB}}=2\arcsin s=2\arcsin(${tx(s)})=2\times${tx(om3 / 2, 7)}=${tx(om3)}`,
            why: String.raw`RAD 模式按 $\sin^{-1}$。$s\le0.3$ 時可用 $\arcsin s\approx s+s^3/6$（相對誤差小於 $0.07\%$）。`,
          },
          {
            tex: String.raw`f_{3\mathrm{dB}}=\Omega_{3\mathrm{dB}}\cdot\frac{f_u}{2\pi}=${txM(om3)}\times${txM(perRad, 7)}\ \mathrm{kHz}=${tx(f3 / KHZ, 5)}\ \mathrm{kHz}`,
            why: String.raw`exact discrete-time 的 $-3$ dB corner。它不是 noise bandwidth（積分雜訊要用 ENBW，HC-12.5）。`,
          },
        ],
        results: [
          { symbol: String.raw`f_{3\mathrm{dB}}^{(1-p)}`, label: '一階近似', value: f1 / KHZ, unit: U_KHZ, tolerance: { rel: 0.005, abs: 1e-9 } },
          { symbol: String.raw`f_{3\mathrm{dB}}^{(\ln)}`, label: '指數映射近似', value: f2 / KHZ, unit: U_KHZ, tolerance: { rel: 0.005, abs: 1e-9 } },
          { symbol: String.raw`f_{3\mathrm{dB}}`, label: 'exact', value: f3 / KHZ, unit: U_KHZ, tolerance: { rel: 0.005, abs: 1e-9 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`三角與反三角函數都用 RAD（弧度）模式。`,
      String.raw`頻率全程用 kHz：$f_u$ 是 kHz，答案就是 kHz。`,
      String.raw`手算近似：$\arcsin s\approx s+s^3/6$（$s\le0.3$）、$-\ln p\approx(1-p)+(1-p)^2/2$（$1-p\le0.1$）。`,
      String.raw`三個答案在第 3–4 位才分得出來，所以對答案的容許誤差只有 $0.5\%$：$f_u/(2\pi)$ 至少留 5 位。`,
      GUARD_TIP,
    ],
  },

  /* ───────────── HC-12.5：ENBW、低頻位準、σ_w² = S_w^(1)(0)·ENBW（T14；E06） ───────────── */
  {
    id: 'HC-12.5',
    title: String.raw`ENBW 與 $\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$：積分雜訊用的寬度`,
    page: PAGE,
    formulaId: 'F-12.9',
    formulaTex: String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p},\qquad S_w^{(1)}(0)=\frac{\pi\sigma_v^2}{C^2f_s}\ \ (C=1),\qquad \sigma_w=\sqrt{S_w^{(1)}(0)\cdot\mathrm{ENBW}}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'p', symbol: 'p', label: 'pole（HC-12.1 的結果）', default: P_EXAMPLE, min: -2, max: 2, practice: { choices: [0.5, 0.6, 0.75, 0.8, 0.9] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0.001, max: 1000, practice: { choices: [1, 2, 4] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: U_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 100, 200] } },
    ],
    validate: ({ p, sigmaV }) => {
      if (!(Math.abs(p) < 1)) return String.raw`$|p|\ge1$：迴路不穩定，$\int|H|^2df$ 發散，ENBW 與穩態 $\sigma_w$ 都不存在。請用 $|p|<1$。`
      if (!(sigmaV > 0)) return String.raw`$\sigma_v=0$：$K_q=\sqrt{2/\pi}/\sigma_v$ 無定義。沒有雜訊的 comparator 是硬限幅，小訊號線性化不成立，$S_w^{(1)}(0)=\pi\sigma_v^2/f_s$ 也就不能用。`
      return null
    },
    solve: ({ p, fs, N, sigmaV }) => {
      const fsHz = fs * GHZ
      const { fu, sigmaEta2 } = blockRate(fs, N)
      const enbw = enbwOneSided(p, fu)
      const muImp = ((1 - p) * sigmaV) / SQRT_2_OVER_PI // 這組 (p, σ_v) 對應的 μ = (1 − p)/K（C = 1）
      const s0 = swOneSided(0, muImp, p, sigmaEta2, fu) // 2μ²σ_η²/((1 − p)²f_u) = πσ_v²/f_s
      const var2 = s0 * enbw
      const sw = Math.sqrt(var2)
      const swTime = Math.sqrt(sigmaW2Colored(muImp, sigmaEta2, p, 0)) // 時域公式 μ/√(N(1 − p²))
      const f3 = bw3dbExact(p, fu)
      const shape = (1 - p) / (1 + p)
      const sv2 = sigmaV * sigmaV
      const notes = [
        String.raw`這組 $p$、$\sigma_v$ 對應的 learning rate 是 $\mu=(1-p)\,\sigma_v/\sqrt{2/\pi}=${texNum(muImp)}$ fs；時域公式 $\mu/\sqrt{N(1-p^2)}=${texNum(swTime)}$ fs（HC-12.3），兩條路的答案相同。`,
      ]
      if (Number.isFinite(f3)) {
        const wrong = Math.sqrt(s0 * f3)
        notes.push(
          String.raw`反面例子（勘誤 E06、思考題 1）：把 $f_{3\mathrm{dB}}=${texNum(f3 / KHZ)}$ kHz 當成 noise bandwidth，會得到 $\sqrt{S_w^{(1)}(0)\cdot f_{3\mathrm{dB}}}=${texNum(wrong)}$ fs，低估 $${texNum((1 - wrong / sw) * 100, 3)}\%$。$\mathrm{ENBW}/f_{3\mathrm{dB}}=${texNum(enbw / f3, 4)}$（$p\to1$ 時趨近 $\pi/2$）。`,
        )
      }
      if (p < 0) notes.push(String.raw`$p<0$（high-pass）：ENBW 以 DC 增益為參考，而 DC 正是增益最小的地方，所以 $\mathrm{ENBW}>f_u/2$——公式仍成立，但已不能稱為頻寬。`)
      notes.push(String.raw`低頻位準只跟 $\sigma_v$、$f_s$（與 $C$）有關；$\mu$ 只透過 $p$ 改變 ENBW。這就是「$\sigma_w\propto\sqrt\mu$」的頻域解釋。`)
      return {
        steps: [
          fuStep(fs, N, fu),
          {
            tex: String.raw`\frac{1-p}{1+p}=\frac{1-${txP(p, 15)}}{1+${txP(p, 15)}}=\frac{${tx(1 - p)}}{${tx(1 + p)}}=${tx(shape)}`,
            why: String.raw`ENBW 的形狀因子，只跟 $p$ 有關。`,
          },
          {
            tex: String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=\frac{${tx(fu / KHZ, 7)}\ \mathrm{kHz}}{2}\times${txM(shape)}=${tx(fu / 2 / KHZ, 7)}\ \mathrm{kHz}\times${txM(shape)}=${tx(enbw / KHZ)}\ \mathrm{kHz}=${tx(enbw)}\ \mathrm{Hz}`,
            why: String.raw`等高矩形的寬度：高度取 $|H(1)|^2$（DC），面積等於真實 $|H|^2$ 從 $0$ 到 $f_u/2$ 的面積。最後換回 Hz（乘 1000），第 6 步要用。`,
          },
          { tex: String.raw`\sigma_v^2=${txM(sigmaV, 15)}^2=${tx(sv2)}\ \mathrm{fs}^2`, why: String.raw`comparator 前雜訊的功率。` },
          {
            tex: String.raw`S_w^{(1)}(0)=\frac{\pi\,\sigma_v^2}{f_s}=\frac{\pi\times${txM(sv2)}\ \mathrm{fs}^2}{${tx(fsHz)}\ \mathrm{Hz}}=\frac{${tx(Math.PI * sv2, 7)}\ \mathrm{fs}^2}{${tx(fsHz)}\ \mathrm{Hz}}=${tx(s0)}\ \mathrm{fs^2/Hz}`,
            why: String.raw`係數雜訊 PSD 的低頻位準（F-12.19）：和 $\mu$、$N$ 都無關。它是 $v$ 的單邊 PSD $2\sigma_v^2/f_s$ 再乘上 1-bit comparator 的代價 $\pi/2$。$f_s$ 用 Hz；$\pi=${PI_TEX}$。`,
          },
          {
            tex: String.raw`\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}=${txM(s0)}\times${txM(enbw)}\ \mathrm{Hz}=${tx(var2)}\ \mathrm{fs}^2`,
            why: String.raw`位準 × 等效寬度 = 總功率。ENBW 用 Hz。`,
          },
          { tex: String.raw`\sigma_w=\sqrt{${tx(var2)}}=${tx(sw, 5)}\ \mathrm{fs}`, why: String.raw`開根號得到 RMS。` },
        ],
        results: [
          { symbol: String.raw`\mathrm{ENBW}`, label: 'one-sided 等效雜訊頻寬', value: enbw / KHZ, unit: U_KHZ },
          { symbol: String.raw`S_w^{(1)}(0)`, label: '低頻位準', value: s0, unit: String.raw`\mathrm{fs^2/Hz}`, tolerance: { rel: 0.01, abs: 1e-30 } },
          { symbol: String.raw`\sigma_w`, label: '係數雜訊 RMS', value: sw, unit: U_FS },
        ],
        notes,
      }
    },
    tips: [
      String.raw`$\pi=${PI_TEX}$；除了最後一步的開根號，其餘都是四則運算。`,
      String.raw`單位：ENBW 先用 kHz 算，代入第 6 步前乘 1000 換成 Hz；$f_s$ 換成 Hz（$4\ \mathrm{GHz}=4\times10^{9}\ \mathrm{Hz}$）。`,
      String.raw`粗估：$1-p\le0.1$ 時 $\mathrm{ENBW}\approx(1-p)\,f_u/4$，低估不超過 $5\%$。`,
      GUARD_TIP,
    ],
  },

  /* ───────────── HC-12.6：混頻（T15 的前半） ───────────── */
  {
    id: 'HC-12.6',
    title: String.raw`混頻：兩個 $\cos$ 相乘 ⇒ $f_x\pm f_w$，各 $AB/2$`,
    page: PAGE,
    formulaId: 'F-12.12',
    formulaTex: String.raw`\delta t=x\cdot\delta w:\quad\big[m+A\cos(2\pi f_xt)\big]\cdot B\cos(2\pi f_wt)=\frac{AB}{2}\cos2\pi(f_x+f_w)t+\frac{AB}{2}\cos2\pi(f_x-f_w)t+mB\cos(2\pi f_wt)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'A', symbol: 'A', label: 'code 的 tone 振幅（peak）', default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2, 4] } },
      { key: 'B', symbol: 'B', label: '係數週期性擾動的 peak', unit: U_FS, default: 1, min: 0, max: 1000, practice: { choices: [0.2, 0.5, 1, 2, 3] } },
      { key: 'fx', symbol: 'f_x', label: 'code 的 tone 頻率', unit: U_KHZ, default: 100, min: 0, max: 1e4, practice: { choices: [50, 80, 100, 200, 400] } },
      { key: 'fw', symbol: 'f_w', label: '係數擾動的頻率', unit: U_KHZ, default: 10, min: 0, max: 1e3, practice: { choices: [5, 10, 20, 30] } },
      { key: 'm', symbol: 'm', label: 'code 的 DC 成分', default: 0, min: -10, max: 10, practice: { choices: [0, 0, 0.5, 1] } },
    ],
    validate: ({ A, B, fx, fw, m }) => {
      if (!(A > 0) || !(B > 0)) return String.raw`$A=0$ 或 $B=0$：其中一個波形不存在，沒有混頻產物可算。請輸入正的 $A$ 與 $B$。`
      if (!(fw > 0)) return String.raw`$f_w=0$：$\delta w$ 是常數，乘法只是把 code 整個乘上 $B$——和頻與差頻都落回 $f_x$，合成一根 $AB$，不是兩根 $AB/2$。請用 $f_w>0$。`
      if (!(fx > 0)) return String.raw`$f_x=0$：code 是常數，三個產物都落在 $f_w$，合成一根 $|A+m|\,B$，沒有 $f_x\pm f_w$ 兩根線。請用 $f_x>0$。`
      if (fx === fw) return String.raw`$f_x=f_w$：差頻落在 $0$ Hz，變成一個固定的偏移 $AB/2$（DC），不是 tone；頻譜上只剩 $2f_x$ 一根。請讓兩個頻率不同。`
      if (m !== 0 && fx === 2 * fw) return String.raw`$f_x=2f_w$ 且 $m\ne0$：差頻 $f_x-f_w$ 與直通項 $m\,\delta w$ 都落在 $f_w$，要依相位做相量相加（這裡同相：$AB/2+mB$），不能分開讀成兩根。請改 $f_x$ 或設 $m=0$。`
      return null
    },
    solve: ({ A, B, fx, fw, m }) => {
      const { r, fsim } = runMix(A, B, fx, fw, m)
      const sum = r.tones.find((t) => t.label === 'f_x + f_w')
      const diff = r.tones.find((t) => t.label === 'f_x − f_w' || t.label === 'f_w − f_x')
      const dc = r.tones.find((t) => t.label.startsWith('f_w（DC'))
      if (!sum || !diff) throw new Error('混頻產物重疊或超出模擬頻寬，請換一組頻率')
      const dcAmp = dc ? dc.predFs : 0
      // 時域抽一點驗算：取不超過 1/8 個 f_x 週期的 sample（2 的冪次，時間才寫得完；模擬軌跡的實際數值）
      const nMax = Math.max(1, Math.min(r.trace.tUs.length - 1, Math.floor(fsim / (8 * fx * KHZ))))
      const n = 2 ** Math.floor(Math.log2(nMax))
      const t = r.trace.tUs[n] * 1e-6
      const rhs = sum.predFs * Math.cos(2 * Math.PI * sum.f * t) + diff.predFs * Math.cos(2 * Math.PI * diff.f * t) + m * B * Math.cos(2 * Math.PI * fw * KHZ * t)
      const fitOk = [sum, diff, ...(dc ? [dc] : [])].every((tn) => Math.abs(tn.measFs - tn.predFs) <= 1e-6 * Math.max(1, tn.predFs))
      const notes: string[] = []
      if (fitOk) {
        notes.push(
          String.raw`網站真的把兩個波形逐點相乘再做 tone fit（Code Mixing Lab、T15）：和頻量到 $${texNum(sum.measFs, 6)}$ fs、差頻量到 $${texNum(diff.measFs, 6)}$ fs${dc ? String.raw`、$f_w$ 處量到 $${texNum(dc.measFs, 6)}$ fs` : ''}，與上面的預測相同。`,
        )
      }
      notes.push(
        String.raw`想驗證恆等式（需要計算機的 $\cos$，RAD 模式）：$t=${tx(r.trace.tUs[n], 7)}\ \mu\mathrm s$ 時 $x=m+A\cos(2\pi f_xt)=${tx(r.trace.x[n], 7)}$、$\delta w=B\cos(2\pi f_wt)=${tx(r.trace.dw[n], 7)}$ fs，乘積 $${texNum(r.trace.dt[n])}$ fs；右邊各項在同一時刻相加也是 $${texNum(rhs)}$ fs。`,
      )
      notes.push(String.raw`乘積裡沒有 $f_x$ 也沒有 $f_w$ 本身（除非 code 有 DC）。下一步：把 $A_t=AB/2$ 代進 HC-12.7 算 spur。`)
      notes.push(
        String.raw`極性（勘誤 E33）：$\delta t=x\,\delta w$ 是 DTC 多施加的延遲，本章 $\delta w=w-w^*$；改用全站 §0 的 $\delta=a-w$（$w^*=a$ 時 $\delta=-\delta w$）寫殘餘 timing error，對應的項是 $-x\,\delta w=x\,\delta$。正負號只讓兩根 tone 的相位同時轉 $180^\circ$：頻率、peak 與後面的 dBc 都不變。`,
      )
      return {
        steps: [
          {
            tex: String.raw`f_x+f_w=${txIn(fx)}+${txIn(fw)}=${tx(sum.f / KHZ, 15)}\ \mathrm{kHz}`,
            why: String.raw`和頻：積化和差 $\cos a\cos b=\tfrac12[\cos(a+b)+\cos(a-b)]$ 的第一項。`,
          },
          {
            tex: String.raw`|f_x-f_w|=|${txIn(fx)}-${txIn(fw)}|=${tx(diff.f / KHZ, 15)}\ \mathrm{kHz}`,
            why: String.raw`差頻。$\cos$ 是偶函數，所以 $f_x<f_w$ 時它落在 $f_w-f_x$，不會消失。`,
          },
          {
            tex: String.raw`\frac{AB}{2}=\frac{${txM(A, 15)}\times${txM(B, 15)}}{2}=\frac{${tx(A * B)}}{2}=${tx(sum.predFs)}\ \mathrm{fs}`,
            why: String.raw`兩根 tone 的 peak 都是 $AB/2$：振幅各分一半。`,
          },
          {
            tex: String.raw`|m|\,B=${txM(Math.abs(m), 15)}\times${txM(B, 15)}=${tx(dcAmp)}\ \mathrm{fs}\quad @\ f_w=${txIn(fw)}\ \mathrm{kHz}`,
            why:
              m === 0
                ? String.raw`code 沒有 DC（$m=0$）⇒ 沒有直通項，$f_w$ 處沒有 tone。`
                : String.raw`code 的 DC 讓 $\delta w$ 原封不動直通：在 $f_w$ 多一根 $|m|B$ 的低頻 tone，它落在 PLL 頻寬內（$|T|\approx1$），最容易出現在輸出。`,
          },
        ],
        results: [
          { symbol: 'f_x+f_w', label: '和頻', value: sum.f / KHZ, unit: U_KHZ },
          { symbol: '|f_x-f_w|', label: '差頻', value: diff.f / KHZ, unit: U_KHZ },
          { symbol: String.raw`\tfrac{AB}{2}`, label: '兩根混頻產物各自的 peak', value: sum.predFs, unit: U_FS },
          { symbol: '|m|B', label: '直通項（落在係數擾動頻率）的 peak', value: dcAmp, unit: U_FS },
        ],
        notes,
      }
    },
    tips: [
      String.raw`只有加、減、乘和除以 2。`,
      String.raw`單位：$A$ 無因次、$B$ 是 fs，所以 $AB/2$ 的單位是 fs，而且是 peak 不是 RMS（RMS 要再除以 $\sqrt2$）。`,
      String.raw`code centering（讓 $m=0$）可以消掉 $f_w$ 那根直通項：這是第 11 章 bias 以外的另一個理由。`,
    ],
  },

  /* ───────────── HC-12.7：spur（T15） ───────────── */
  {
    id: 'HC-12.7',
    title: String.raw`Spur：調變指數 $\beta$ 與 dBc`,
    page: PAGE,
    formulaId: 'F-12.18',
    formulaTex: String.raw`\beta=2\pi f_{\mathrm{out}}\,|T|\,A_t,\qquad \text{spur}\approx20\log_{10}\frac{\beta}{2}=20\log_{10}\big(\pi f_{\mathrm{out}}|T|A_t\big)\ \mathrm{dBc}\qquad(\beta\ll1)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'fOut', symbol: String.raw`f_{\mathrm{out}}`, label: 'PLL 輸出頻率', unit: String.raw`\mathrm{GHz}`, default: 13, min: 0, max: 1000, practice: { choices: [2.5, 5, 10, 13, 20, 26] } },
      { key: 'at', symbol: 'A_t', label: 'DTC 端 timing tone 的 peak', unit: U_FS, default: 0.5, min: 0, max: 1e6, practice: { choices: [0.1, 0.2, 0.5, 1, 2, 5, 10] } },
      { key: 'tMag', symbol: '|T|', label: 'PLL 在 tone 頻率處的閉迴路增益', default: 1, min: 0, max: 10, practice: { choices: [0.1, 0.5, 1, 1] } },
    ],
    validate: ({ fOut, at, tMag }) => {
      if (!(fOut > 0) || !(at > 0) || !(tMag > 0)) {
        return String.raw`$f_{\mathrm{out}}|T|A_t=0$：output 上沒有相位調變，也就沒有 spur（$20\log_{10}0=-\infty$）。請輸入正的 $f_{\mathrm{out}}$、$A_t$ 與 $|T|$。`
      }
      const beta = spurBeta(fOut * GHZ, at, tMag)
      if (beta > 0.3) {
        const small = spurDbcSmallAngle(beta)
        const bessel = spurDbcBessel(beta)
        return String.raw`$\beta=${texNum(beta, 4)}$ rad 已不是小角（$\beta>0.3$）：$20\log_{10}(\beta/2)=${texNum(small, 4)}$ dBc 與精確的 $20\log_{10}(J_1/J_0)=${texNum(bessel, 4)}$ dBc 相差 $${texNum(Math.abs(small - bessel), 2)}$ dB，而且高階邊帶（$2f_m,3f_m,\ldots$）不能再忽略。精確值要查 Bessel 函數表，不適合手算；請減小 $A_t$ 或 $|T|$。`
      }
      return null
    },
    solve: ({ fOut, at, tMag }) => {
      const fHz = fOut * GHZ
      const beta = spurBeta(fHz, at, tMag)
      const dbc = spurDbcSmallAngle(beta)
      const bessel = spurDbcBessel(beta)
      const aOut = tMag * at
      const cycles = fHz * aOut * 1e-15
      const half = beta / 2
      const lg = Math.log10(half)
      // 提示用：把畫面上顯示的 β/2（6 位）拆成 a×10^b
      const halfShown = Number(half.toPrecision(6))
      const expo = Math.floor(Math.log10(halfShown))
      const mant = halfShown / 10 ** expo
      const aFor100 = radToFs(2e-5, fHz) // β/2 = 10⁻⁵ ⇔ −100 dBc
      return {
        steps: [
          {
            tex: String.raw`|T|\,A_t=${txM(tMag, 15)}\times${txM(at, 15)}\ \mathrm{fs}=${tx(aOut)}\ \mathrm{fs}=${tx(aOut * 1e-15)}\ \mathrm s`,
            why: String.raw`output 端 timing tone 的 peak：DTC 端的 $A_t$ 乘上 PLL 在 tone 頻率處的 $|T|$。換成秒：$1\ \mathrm{fs}=10^{-15}\ \mathrm s$。`,
          },
          {
            tex: String.raw`f_{\mathrm{out}}\cdot|T|A_t=${txM(fHz)}\ \mathrm{Hz}\times${txM(aOut * 1e-15)}\ \mathrm s=${tx(cycles)}`,
            why: String.raw`timing tone 佔一個 output 週期的比例（無因次）。$f_{\mathrm{out}}$ 用 Hz。`,
          },
          {
            tex: String.raw`\beta=2\pi\cdot f_{\mathrm{out}}|T|A_t=2\pi\times${txM(cycles)}=${tx(beta)}\ \mathrm{rad}`,
            why: String.raw`一個週期對應 $2\pi$ rad：這就是相位調變指數（peak 相位偏移）。用計算機的 $\pi$ 鍵（$2\pi=${TWO_PI_TEX}$）。`,
          },
          {
            tex: String.raw`\frac{\beta}{2}=\pi\cdot f_{\mathrm{out}}|T|A_t=\pi\times${txM(cycles)}=${tx(half)}`,
            why: String.raw`小角近似下，每一根 spur 相對 carrier 的振幅比（$J_1(\beta)/J_0(\beta)\approx\beta/2$）。直接用 $\pi$ 乘第 2 步的結果，就不必把四捨五入過的 $\beta$ 再除以 2。`,
          },
          {
            tex: String.raw`\log_{10}\frac{\beta}{2}=\log_{10}(${tx(half)})=${txD(lg, 5)}`,
            why: String.raw`計算機的 log 鍵。手算時用 $\log_{10}(a\times10^{b})=b+\log_{10}a$：這裡是 $${expo}+\log_{10}${tx(mant)}=${expo}+${txD(Math.log10(mant), 5)}$。`,
          },
          {
            tex: String.raw`\text{spur}=20\log_{10}\frac{\beta}{2}=20\times${txDM(lg, 5)}=${txD(dbc, 3)}\ \mathrm{dBc}`,
            why: String.raw`振幅比取 $20\log_{10}$。carrier 兩側 $f_{\mathrm{out}}\pm f_m$ 各一根，每根都是這個數。`,
          },
        ],
        results: [
          { symbol: String.raw`\beta`, label: '調變指數', value: beta, unit: String.raw`\mathrm{rad}` },
          { symbol: String.raw`\text{spur}`, label: '每一根單邊 spur', value: dbc, unit: String.raw`\mathrm{dBc}`, digits: sigAtDecimals(dbc, 3), tolerance: { rel: 0.0005, abs: 0.05 } },
        ],
        notes: [
          String.raw`不做小角近似的精確值：$20\log_{10}\dfrac{J_1(\beta)}{J_0(\beta)}=${texNum(bessel, 8)}$ dBc，與小角公式只差 $${texNum(Math.abs(dbc - bessel), 2)}$ dB。`,
          String.raw`$A_t$ 加倍 ⇒ $+20\log_{10}2=+6.02$ dB；tone 落在 PLL 頻寬外、$|T|=0.1$ ⇒ $-20$ dB。`,
          String.raw`反推（設計用）：這個 $f_{\mathrm{out}}$ 下要讓 spur 低於 $-100$ dBc（$\beta/2<10^{-5}$），需要 $|T|A_t<${texNum(aFor100, 4)}$ fs。`,
        ],
      }
    },
    tips: [
      String.raw`單位最容易錯：$f_{\mathrm{out}}$ 換成 Hz（$13\ \mathrm{GHz}=1.3\times10^{10}\ \mathrm{Hz}$）、$A_t$ 換成秒（$1\ \mathrm{fs}=10^{-15}\ \mathrm s$）。`,
      String.raw`沒有計算機時：$20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)=20\,[\log_{10}\pi+\log_{10}f_{\mathrm{out}}+\log_{10}(|T|A_t)]$，常用值 $\log_{10}\pi=0.4971$、$\log_{10}2=0.3010$、$\log_{10}1.3=0.1139$、$\log_{10}5=0.6990$。`,
      String.raw`小角近似的適用範圍：$\beta\le0.3$ rad 時與 Bessel 精確值相差不到 $0.1$ dB；一般 PLL 的 spur（$\beta\sim10^{-5}$）遠在範圍內。`,
      String.raw`$A_t$ 是 peak，不是 RMS；RMS 值要先乘 $\sqrt2$。`,
      String.raw`dB 值顯示到小數點後 3 位：$\log_{10}$ 要留 5 位小數，乘 20 之後第 3 位才可靠。`,
    ],
  },

  /* ───────────── HC-12.8：綜合（章末，思考題之前） ───────────── */
  {
    id: 'HC-12.8',
    title: String.raw`綜合：從 $\sigma_v$ 一路算到三種 code 的 $\delta t$`,
    page: PAGE,
    formulaTex: String.raw`p=1-\mu\frac{\sqrt{2/\pi}}{\sigma_v},\qquad\sigma_w=\frac{\mu}{\sqrt{N(1-p^2)}},\qquad\delta t=x\cdot\delta w\ \Rightarrow\ \delta t_{\mathrm{rms}}=\begin{cases}\sigma_w&x\equiv1\ (\text{總 RMS，留在低頻})\\[4pt]\dfrac{A}{\sqrt2}\,\sigma_w&x=A\cos(2\pi f_xt)\ (\text{總 RMS，搬到 }f_x\text{ 兩側})\\[8pt]\sigma_w\sqrt{\dfrac{2f_{BW}}{f_s}}&x=\pm1\ \text{白色}\ (\text{只算 }0\ldots f_{BW}\text{ 內})\end{cases}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（learning rate）', unit: U_FS, default: 10, min: -1e4, max: 1e4, practice: { choices: [5, 10, 20] } },
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前的雜訊 RMS', unit: U_FS, default: 100, min: 0, max: 1e5, practice: { choices: [50, 100, 200] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0.001, max: 1000, practice: { choices: [1, 2, 4] } },
      { key: 'A', symbol: 'A', label: '單頻 code 的振幅（peak）', default: 1, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'fBw', symbol: 'f_{BW}', label: 'PLL 頻寬（in-band 上限）', unit: String.raw`\mathrm{MHz}`, default: 1, min: 0, max: 1e6, practice: { choices: [0.5, 1, 2, 5, 10] } },
    ],
    validate: ({ mu, sigmaV, N, fs, fBw }) => {
      const bad = loopError(calLoop({ N, fs: fs * GHZ, mu, sigmaV, C: 1 }))
      if (bad) return bad
      if (!(fBw > 0)) return String.raw`$f_{BW}=0$：頻寬是 0，in-band 的功率當然是 0。請輸入正的 $f_{BW}$。`
      if (fBw * MHZ > (fs * GHZ) / 2) {
        return String.raw`$f_{BW}=${texNum(fBw)}$ MHz 超過 Nyquist $f_s/2=${texNum((fs * GHZ) / 2 / MHZ)}$ MHz：$\delta t[n]$ 是 sample-rate 的序列，功率只分布在 $0\ldots f_s/2$，$\sqrt{2f_{BW}/f_s}$ 不能超過 1。`
      }
      return null
    },
    solve: ({ mu, sigmaV, N, fs, A, fBw }) => {
      const fsHz = fs * GHZ
      const fBwHz = fBw * MHZ
      const fsMHz = fsHz / MHZ
      const lp = calLoop({ N, fs: fsHz, mu, sigmaV, C: 1 })
      const sys: MixSystem = { fs: fsHz, N, mu, p: lp.p, sEta: lp.sigmaEta2 }
      const constRms = Math.sqrt(dtTotalPower({ m: 1, A: 0, fx: 0, whiteVar: 0 }, sys)) // E[x²]σ_w²，x ≡ 1
      const toneRms = Math.sqrt(dtTotalPower({ m: 0, A, fx: 1e5, whiteVar: 0 }, sys)) // (A²/2)σ_w²
      const whitePsd = dtPsdOneSided(fBwHz / 2, { m: 0, A: 0, fx: 0, whiteVar: 1 }, sys) // 平的：σ_w²·2/f_s [fs²/Hz]
      const whiteRms = Math.sqrt(whitePsd * fBwHz)
      const { gS, pS } = poleDigits(lp.g, lp.p)
      const p2 = lp.p * lp.p
      const one = 1 - p2
      const s3 = sigFor(one, 1, p2)
      const nOne = N * one
      const frac = (2 * fBwHz) / fsHz
      const isExample = mu === 10 && sigmaV === 100 && N === 4096 && fs === 4 && A === 1 && fBw === 1
      const notes: string[] = []
      if (isExample) {
        notes.push(
          String.raw`這三個數就是入門課與 §12.7 的 0.399 / 0.282 / 0.009 fs。§12.7 的表格用數值積分、並扣掉 ZOH step 落在頻寬外的能量，所以前兩個略小（0.398 / 0.281 fs），白色 code 那一項完全相同。`,
        )
      }
      if (Number.isFinite(lp.f3dbExact)) {
        notes.push(
          String.raw`前兩項是總 RMS：要 $f_{BW}$ 遠大於校正迴路的 corner $f_{3\mathrm{dB}}=${texNum(lp.f3dbExact / KHZ)}$ kHz（本題 $f_{BW}/f_{3\mathrm{dB}}=${texNum(fBwHz / lp.f3dbExact, 3)}$），單頻 code 還要 $f_x$ 連同兩側的邊帶都在 $f_{BW}$ 內，才幾乎全部落在頻寬內。`,
        )
      }
      notes.push(String.raw`同一個 $\sigma_w$，code 決定頻譜：常數留在低頻、單頻搬到 $f_x$、白色攤平到 $0\ldots f_s/2$。所以 $\sigma_w$ 不能直接宣稱為 output jitter。`)
      notes.push(String.raw`這些都還是 DTC 端的 timing error；到 PLL 輸出還要乘上 $|T(f)|^2$ 再積分（F-12.17）。`)
      return {
        steps: [
          {
            tex: String.raw`g=\mu\,\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${txM(mu, 15)}\times${ROOT_TEX}}{${txIn(sigmaV)}}=\frac{${tx(mu * SQRT_2_OVER_PI)}}{${txIn(sigmaV)}}=${tx(lp.g, gS)}`,
            why: String.raw`迴路增益 $g=\mu K$（$C=1$；HC-12.1）。$\sqrt{2/\pi}=${ROOT_TEX}$。`,
          },
          { tex: String.raw`p=1-g=1-${tx(lp.g, gS)}=${tx(lp.p, pS)}`, why: String.raw`pole。` },
          {
            tex: String.raw`1-p^2=1-${txM(lp.p, pS)}^2=1-${tx(p2, s3)}=${tx(one)}`,
            why: String.raw`先平方再用 1 去減（相近的數相減，$p^2$ 照畫面上的位數寫完）。`,
          },
          { tex: String.raw`N(1-p^2)=${N}\times${txM(one)}=${tx(nOne)}`, why: String.raw`$\sigma_\eta^2=1/N$，所以分母多一個 $N$。` },
          {
            tex: String.raw`\sigma_w^2=\frac{\mu^2}{N(1-p^2)}=\frac{${txM(mu, 15)}^2}{${tx(nOne)}}=\frac{${tx(mu * mu)}}{${tx(nOne)}}=${tx(lp.sigmaW2)}\ \mathrm{fs}^2`,
            why: String.raw`穩態係數雜訊的變異數（F-12.5，$\sigma_\eta^2=1/N$）。`,
          },
          {
            tex: String.raw`\sigma_w=\sqrt{${tx(lp.sigmaW2)}}=${tx(lp.sigmaW)}\ \mathrm{fs}`,
            why: String.raw`gain-equivalent 的係數雜訊（HC-12.3）。接下來看它乘上三種 code 之後變成什麼。`,
          },
          {
            tex: String.raw`x\equiv1:\quad\delta t_{\mathrm{rms}}=\sigma_w=${tx(constRms, 5)}\ \mathrm{fs}`,
            why: String.raw`常數 code：$\delta t=\delta w$，頻譜原封不動留在低頻，幾乎全部落在 PLL 頻寬內。`,
          },
          {
            tex: String.raw`\frac{A}{\sqrt2}=\frac{${txIn(A)}}{${SQRT2_TEX}}=${tx(A / Math.SQRT2)}`,
            why: String.raw`$\cos^2$ 的時間平均是 $\tfrac12$：功率減半，RMS 乘 $1/\sqrt2$。`,
          },
          {
            tex: String.raw`x=A\cos(2\pi f_xt):\quad\delta t_{\mathrm{rms}}=\frac{A}{\sqrt2}\,\sigma_w=${txM(A / Math.SQRT2)}\times${txM(lp.sigmaW)}=${tx(toneRms, 5)}\ \mathrm{fs}`,
            why: String.raw`單頻 code 把係數雜訊搬到 $f_x$ 兩側；只要 $f_x$ 在 PLL 頻寬內，它一樣會到輸出。`,
          },
          {
            tex: String.raw`\frac{2f_{BW}}{f_s}=\frac{2\times${txM(fBw, 15)}\ \mathrm{MHz}}{${tx(fsMHz)}\ \mathrm{MHz}}=\frac{${tx(2 * fBw)}}{${tx(fsMHz)}}=${tx(frac)}`,
            why: String.raw`白色 code 把功率均勻攤在 $0\ldots f_s/2$；寬度 $f_{BW}$ 只佔其中的 $f_{BW}/(f_s/2)$。上下用同一個單位（$1\ \mathrm{GHz}=1000\ \mathrm{MHz}$）。`,
          },
          { tex: String.raw`\sqrt{\frac{2f_{BW}}{f_s}}=\sqrt{${tx(frac)}}=${tx(Math.sqrt(frac))}`, why: String.raw`功率比開根號變成 RMS 比。` },
          {
            tex: String.raw`x=\pm1\ \text{白色}:\quad\delta t_{\mathrm{rms}}\big|_{0\ldots f_{BW}}=\sigma_w\sqrt{\frac{2f_{BW}}{f_s}}=${txM(lp.sigmaW)}\times${txM(Math.sqrt(frac))}=${tx(whiteRms, 5)}\ \mathrm{fs}`,
            why: String.raw`同一個 $\sigma_w$，寬頻的 code 讓落在頻寬內的部分小了 $${texNum(1 / Math.sqrt(frac), 3)}$ 倍。`,
          },
        ],
        results: [
          { symbol: String.raw`\sigma_w`, label: '係數雜訊 RMS（也是常數 code 的總 RMS）', value: constRms, unit: U_FS },
          { symbol: String.raw`\delta t_{\mathrm{rms}}^{\cos}`, label: '單頻 code 的總 RMS', value: toneRms, unit: U_FS },
          { symbol: String.raw`\delta t_{\mathrm{rms}}^{\pm1}`, label: '白色 code 落在頻寬內的 RMS', value: whiteRms, unit: U_FS, tolerance: { rel: 0.01, abs: 1e-12 } },
        ],
        notes,
      }
    },
    tips: [
      String.raw`前六步就是 HC-12.3 的前半：先算 $p$，再算 $\sigma_w$。`,
      String.raw`$\sqrt2=${SQRT2_TEX}$、$1/\sqrt2=0.707107$。`,
      String.raw`單位：$f_{BW}$ 與 $f_s$ 換成同一個單位再相除（$1\ \mathrm{GHz}=1000\ \mathrm{MHz}$）。`,
      GUARD_TIP,
    ],
  },
]
