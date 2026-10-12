import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { normCdf, normPdf } from '@/simulation/core'
import {
  DITHER_MIN,
  accumulatorBitsClosedForm,
  accumulatorSizing,
  biasFixedPoint,
  blockUpdate,
  bugFixedPointGaussian,
  bugMeanGmac,
  comparatorBit,
  decodeComparator,
  gmacAverage,
  gmacRunningSum,
  gmacSum,
  roundingMeanError,
  runFixedGmacLoop,
  shiftRound,
  sumAverageTable,
  wrapTwos,
  type Bit,
  type CodeRange,
  type FixedLoopAnalytic,
} from '@/simulation/models/gmac'
import { criticalGain } from './latency'
import { firstOrderAccumulator, residueSignals } from './residue'

/**
 * Ch04 的「帶入手算」題（docs/teaching-style.md §7）。
 *  - solve() 的數值一律來自本章實際執行的模型：gmac.ts（GMAC、位元數、rounding、固定點）、residue.ts（一階 DSM 累加器）、latency.ts（臨界增益）。
 *  - 每一步的 tex 是「符號式 = 代入數字 = 結果」，每個等號只做一種運算；why 說明怎麼算、怎麼按計算機。
 *  - inputs 的 default 與本章 worked example 相同（§2 手算表、§4 的 N = 4 block、T13、§5 的表格與 §5.6 的例子）。
 *  - 極性一律 δ = a − w；總和寫 S、平均寫 G（勘誤 E07 / E18）；x 無因次、a / w / μ 帶 fs（勘誤 E13）。
 */

const R = String.raw

/** 整數原樣輸出：位元數、累加器內容、2 的冪不可以被四捨五入成 5 位有效數字 */
const ti = (n: number): string => String(n)
/** 同 ti，負數加括號（代入用） */
const tip = (n: number): string => (n < 0 ? `(${n})` : String(n))

/** texNum(x, sig) 顯示到小數第幾位（負數 = 只顯示到十位、百位…；x = 0 時為 0 位） */
const dpOf = (x: number, sig = 5): number => (x === 0 ? 0 : sig - 1 - Math.floor(Math.log10(Math.abs(Number(x.toPrecision(sig))))))
/**
 * 加減法的結果：四捨五入到小數 dp 位再顯示。
 * 用有效位數顯示會和「拿上一步顯示的數字去加減」對不上（例如 $1-1.0213$ 顯示成 $-0.021292$；兩項幾乎抵消時更明顯），
 * 所以加減法的結果一律和運算元顯示到同一個小數位。
 */
const tdp = (x: number, dp: number): string => {
  if (dp >= 0) return texNum(Number(x.toFixed(Math.min(dp, 15))), 15)
  const unit = 10 ** -dp // 運算元只顯示到十位、百位…（很大的數）
  return texNum(Math.round(x / unit) * unit, 15)
}
/** 幾個（以 sig 位有效數字顯示的）數相加時，和應該顯示到小數第幾位：取各項中最粗的那一個；0 不算 */
const sumDp = (terms: number[], sig = 5): number => {
  const dps = terms.filter((t) => t !== 0).map((t) => dpOf(t, sig))
  return dps.length ? Math.min(...dps) : 0
}
/**
 * 除數是 2 的冪的分數（例如 $1/512$、$-300/256$、$255/512$）是有限小數：有效數字不超過 11 位時完整顯示（手算可以完全對上），
 * 否則退回一般的 5 位有效數字。
 */
const tex2 = (x: number, fallbackSig = 5): string => {
  const full = texNum(x, 12)
  const digits = full.replace(/\\times.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').length
  return digits <= 11 ? full : texNum(x, fallbackSig)
}
const tex2p = (x: number, fallbackSig = 5): string => (x < 0 ? `(${tex2(x, fallbackSig)})` : tex2(x, fallbackSig))

/** 「顯示的數字接著算，最後一位可能差 1」的共用提示 */
const ROUNDING_TIP =
  '每一步顯示的數字都四捨五入過（通常 5 位有效數字），網站內部則用完整精度接著算；所以你拿顯示的數字往下算，最後一位偶爾會和網站差 1——這是正常的，對答案時容許 $1\\%$ 的誤差。'

/** §2 手算題固定看 5 拍（n = 0…4） */
export const HC_CYCLES = 5

/** K_q = √(2/π)/σ_v 與 K = K_q·C：直接取 sumAverageTable 的結果（μ = 1 時 g_avg 就是 K），不另寫一套公式 */
function smallSignalGain(sigmaV: number, C: number): { Kq: number; K: number } {
  const [unit] = sumAverageTable({ mu: 1, sigmaV, C: 1, Ex2: 1, Ns: [1] })
  const [row] = sumAverageTable({ mu: 1, sigmaV, C, Ex2: 1, Ns: [1] })
  return { Kq: unit.gAvg, K: row.gAvg }
}

/** 綜合題的 datapath：6-bit 之類的對稱 uniform code、÷N 與 μG → W 都用 floor。回傳 gmac.ts 閉迴路模型的解析欄位。 */
export function datapathAnalytic(v: Record<string, number>): { an: FixedLoopAnalytic; deltaW: number; gCrit: number } {
  const { sigmaV, mu, bx, m, FG, lW, d } = v
  const deltaG = 2 ** -FG / 2 ** (bx - 1)
  const deltaW = 2 ** lW * mu * deltaG
  const r = runFixedGmacLoop({
    bx,
    log2N: m,
    accBits: bx + m,
    accOverflow: 'saturate',
    negate: 'extend',
    gmMode: 'average',
    gFracBits: FG,
    rounding: 'floor',
    codeRange: 'symmetric',
    codeKind: 'uniform',
    dsmFrac: 0,
    aTrue: 0,
    aStepBlock: -1,
    aStepValue: 0,
    w0: 0,
    mu,
    sigmaV,
    physMin: -16,
    physMax: 16,
    regMin: -32,
    regMax: 32,
    regOverflow: 'saturate',
    antiWindup: true,
    numBlocks: 2, // 只需要 analytic（與亂數無關）；2 個 block 是模型允許的最小值
    seed: 1,
    wLsb: deltaW,
    wRounding: 'floor',
  })
  return { an: r.analytic, deltaW, gCrit: criticalGain(d) }
}

function datapathInvalid(v: Record<string, number>): string | null {
  const { sigmaV, mu, bx, m, FG, lW, d } = v
  if (!(sigmaV > 0)) return R`$\sigma_v\le0$：comparator 變成沒有雜訊的純 sign，小訊號增益 $K_q=\sqrt{2/\pi}/\sigma_v$ 沒有定義（也沒有 dither，rounding 偏差的平均模型不適用）。`
  if (!(mu > 0)) return R`$\mu\le0$：$g=\mu K\le0$，迴路不會往 $a$ 收斂（$\mu<0$ 時極性相反）。請用正的 $\mu$。`
  if (![bx, m, FG, lW, d].every(Number.isInteger) || bx < 2 || bx > 12 || m < 1 || m > 14 || FG < 0 || lW < 0 || lW > 12 || d < 0 || d > 32)
    return R`位元數必須是整數，且在模型支援的範圍內：$2\le B_x\le12$、$1\le\log_2N\le14$、$F_G\ge0$、$0\le\ell_W\le12$、$0\le d\le32$。`
  if (FG >= m) return R`$F_G\ge\log_2N$：$\ell=\log_2N-F_G\le0$，「$\div N$」不需要丟掉任何位元，第一個截斷點不存在（$\bar\varepsilon=0$）。請讓 $F_G<\log_2N$。`
  const { an, gCrit } = datapathAnalytic(v)
  if (!(an.g < gCrit))
    return R`$g=\mu K=${texNum(an.g, 4)}\ge g_\mathrm{crit}(d=${d})=${texNum(gCrit, 4)}$：平均模型不穩定，迴路不會停在固定點，偏差公式沒有意義。請調小 $\mu$ 或減少更新延遲 $d$。`
  if (an.ditherRatio < DITHER_MIN)
    return R`$\sigma_S/2^{\ell}=${texNum(an.ditherRatio, 3)}<${DITHER_MIN}$：GMAC 的雜訊遠小於右移後的 1 個 LSB，迴路停在 dead zone 裡，F-04.11 的偏差預測不適用。請保留更多小數位元 $F_G$。`
  if (lW > 0 && an.ditherRatioW < DITHER_MIN)
    return R`$\mu\sigma_G/\Delta_W=${texNum(an.ditherRatioW, 3)}<${DITHER_MIN}$：每個 block 的更新量雜訊遠小於一個 $W$-LSB，取整後幾乎都是 $0$ 或 $\pm1$ LSB（dead zone），F-04.18 的偏差預測不適用。請減少 $\ell_W$ 或增加 $F_G$。`
  if (!an.linearValid)
    return R`預測的偏差 $|w^*-a|=${texNum(Math.abs(an.biasPred), 4)}\,\mathrm{fs}$ 已經超過 $0.2\,\sigma_v$：小訊號線性化 $E[G]\approx K\delta$ 不再準確。請減少 $\ell_W$、增加 $F_G$ 或調大 $\mu$。`
  return null
}

export const HANDCALCS: HandCalcDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.1',
    title: '一階 DSM 累加器走 5 拍：residue、DTC 需要的補償量、gain 誤差的殘差',
    page: '/ch/04',
    formulaId: 'F-04.1',
    formulaTex: R`t[n]=s[n-1]+K_\mathrm{F},\quad s[n]=t[n]-M\,y[n];\qquad r[n]=\sum_{m=0}^{n}\Bigl(y[m]-\frac{K_\mathrm{F}}{M}\Bigr)=-\frac{s[n]}{M};\qquad\tau_\mathrm{need}[n]=\frac{s[n]}{M}\,T_\mathrm{vco},\quad e_\mathrm{det}[n]=(a-w)\,x[n]`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'KF', symbol: R`K_\mathrm{F}`, label: 'FCW 小數字（每拍加進累加器的整數）', unit: R`\text{LSB}`, default: 5, min: 0, max: 65535, integer: true, practice: { choices: [1, 3, 5, 6, 7, 9, 11, 13] } },
      { key: 'B', symbol: R`B_\mathrm{dsm}`, label: '累加器位元數（$M=2^{B_\\mathrm{dsm}}$）', unit: R`\text{bits}`, default: 4, min: 2, max: 16, integer: true, practice: { choices: [3, 4, 4] } },
      { key: 'fvco', symbol: R`f_\mathrm{vco}`, label: 'VCO 頻率', unit: R`\mathrm{GHz}`, default: 13, min: 0.1, max: 100, practice: { choices: [4, 5, 8, 10, 12.5, 16, 20] } },
      { key: 'eps', symbol: R`\varepsilon`, label: 'DTC gain 相對誤差 $(a-w)/a$', unit: R`\%`, default: 1, min: -20, max: 20, practice: { choices: [-2, -1, 0.5, 1, 2, 5] } },
    ],
    validate: ({ KF, B }) =>
      KF >= 2 ** B
        ? R`$K_\mathrm{F}=${ti(KF)}\ge M=2^{${ti(B)}}=${ti(2 ** B)}$：FCW 的小數部分必須滿足 $\mathrm{frac}=K_\mathrm{F}/M<1$（整數部分由 divider 的 $N_\mathrm{int}$ 負責）。請把 $K_\mathrm{F}$ 調小，或增加累加器位元數。`
        : null,
    solve: ({ KF, B, fvco, eps }) => {
      const M = 2 ** B
      const rows = firstOrderAccumulator(KF, B, HC_CYCLES)
      const sig = residueSignals({ kind: 'first_order', frac: KF / M, bits: B, length: HC_CYCLES, gainErrPct: eps, fvcoGHz: fvco })
      const last = rows[HC_CYCLES - 1]
      const carries = rows.reduce((acc, r) => acc + r.y, 0)
      let nMax = 0
      for (const r of rows) if (r.s > rows[nMax].s) nMax = r.n
      const sMax = rows[nMax].s
      const xMax = sMax / M
      const tauMax = sig.dtcNeedFs[nMax]
      const eMax = sig.residualFs[nMax]
      const lastN = HC_CYCLES - 1
      return {
        steps: [
          { tex: R`M=2^{B_\mathrm{dsm}}=2^{${ti(B)}}=${ti(M)}`, why: '累加器的模數：內容只能是 $0,\\dots,M-1$，加到 $M$ 以上就進位。' },
          ...rows.map((r) => ({
            tex:
              r.y === 1
                ? R`t[${r.n}]=s[${r.n - 1}]+K_\mathrm{F}=${ti(r.sPrev)}+${ti(KF)}=${ti(r.t)}\ge${ti(M)}\;\Rightarrow\;y[${r.n}]=1,\quad s[${r.n}]=t[${r.n}]-M=${ti(r.t)}-${ti(M)}=${ti(r.s)}`
                : R`t[${r.n}]=s[${r.n - 1}]+K_\mathrm{F}=${ti(r.sPrev)}+${ti(KF)}=${ti(r.t)}<${ti(M)}\;\Rightarrow\;y[${r.n}]=0,\quad s[${r.n}]=t[${r.n}]=${ti(r.s)}`,
            why:
              r.y === 1
                ? `第 ${r.n} 拍：加完滿 $M$，進位（divider 這一拍多除 1 個 VCO 週期），把 $M$ 減掉後的餘數留在累加器。`
                : `第 ${r.n} 拍：加完還沒滿 $M$，不進位，累加器直接存加法結果${r.n === 0 ? '（初值 $s[-1]=0$）' : ''}。`,
          })),
          {
            tex: R`\sum_{m=0}^{${lastN}}y[m]=${rows.map((r) => ti(r.y)).join('+')}=${ti(carries)}`,
            why: `${HC_CYCLES} 拍裡 divider 總共多除了幾個 VCO 週期。`,
          },
          {
            tex: R`r[${lastN}]=\sum_{m=0}^{${lastN}}y[m]-${HC_CYCLES}\times\frac{K_\mathrm{F}}{M}=${ti(carries)}-${HC_CYCLES}\times\frac{${ti(KF)}}{${ti(M)}}=${ti(carries)}-\frac{${ti(HC_CYCLES * KF)}}{${ti(M)}}=${ti(carries)}-${tex2((HC_CYCLES * KF) / M, 7)}=${tex2(last.cumErr, 7)}`,
            why: '逐拍累加「實際多除的」減「理想該多除的 $\\mathrm{frac}=K_\\mathrm{F}/M$」：feedback（divider）edge 的累積時間誤差（單位 $T_\\mathrm{vco}$，負 = 早到）。',
          },
          {
            tex: R`r[${lastN}]=-\frac{s[${lastN}]}{M}=-\frac{${ti(last.s)}}{${ti(M)}}=${tex2(last.residue, 7)}`,
            why: 'telescoping 的封閉式（F-04.1）：只看累加器現在的內容就夠了——應該和上一步逐拍累加的結果完全相同。',
          },
          {
            tex: R`s_{\max}=\max(${rows.map((r) => ti(r.s)).join(R`,\,`)})=${ti(sMax)}\quad(n=${nMax})`,
            why: `這 ${HC_CYCLES} 拍裡累加器內容最大的那一拍，也就是 DTC 要補償最多的那一拍（同樣大時取最早的一拍）。`,
          },
          {
            tex: R`x[${nMax}]=\frac{s[${nMax}]}{M}=\frac{${ti(sMax)}}{${ti(M)}}=${tex2(xMax, 7)}`,
            why: '把累加器內容除以 $M$：$x=s/M\\in[0,1)$ 是無因次的 code（DTC 的輸入）。',
          },
          {
            tex: R`T_\mathrm{vco}=\frac{1}{f_\mathrm{vco}}=\frac{10^{6}\,\mathrm{fs}}{${texNum(fvco)}}=${texNum(sig.tvcoFs, 8)}\,\mathrm{fs}`,
            why: '$1\\,\\mathrm{GHz}$ 的週期是 $1\\,\\mathrm{ns}=10^6\\,\\mathrm{fs}$，所以 $T_\\mathrm{vco}[\\mathrm{fs}]=10^6\\div f_\\mathrm{vco}[\\mathrm{GHz}]$。除不盡時多留幾位（這裡留 8 位有效數字），下一步的乘積才不會差在最後一位。',
          },
          {
            tex: R`\tau_\mathrm{need}^{\max}=x[${nMax}]\,T_\mathrm{vco}=${tex2(xMax, 7)}\times${texNum(sig.tvcoFs, 8)}=${texNum(tauMax, 7)}\,\mathrm{fs}`,
            why: 'feedback（divider）edge 早到 $x\\,T_\\mathrm{vco}$，reference 端的 DTC 就要把 reference edge 也提前這麼多——從基準延遲 $T_0$ 少延遲這麼多（需要的補償量，F-04.2）。',
          },
          {
            tex: R`e_\mathrm{det}^{\max}=(a-w)\,x[${nMax}]=\varepsilon\,a\,x[${nMax}]=\varepsilon\,\tau_\mathrm{need}^{\max}=${texNumP(eps / 100)}\times${texNum(tauMax, 7)}=${texNum(eMax, 7)}\,\mathrm{fs}`,
            why: '理想 gain $a=T_\\mathrm{vco}$；DTC gain 少了 $\\varepsilon$（$w=(1-\\varepsilon)a$）時 $\\delta=a-w=\\varepsilon a$，PD 看到的殘差就是 $\\delta\\,x$。先把 % 換成小數（$1\\%=0.01$）；$\\varepsilon<0$（DTC gain 太大）時殘差是負的。',
          },
        ],
        results: [
          { symbol: `s[${lastN}]`, label: `第 ${lastN} 拍的累加器內容`, value: last.s, unit: R`\text{LSB}`, digits: 7, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: `r[${lastN}]`, label: `第 ${lastN} 拍的 residue（負 = feedback edge 早到）`, value: last.residue, unit: R`T_\mathrm{vco}`, digits: 7 },
          { symbol: R`\tau_\mathrm{need}^{\max}`, label: `這 ${HC_CYCLES} 拍裡需要的補償量最大值（reference edge 要提前的時間）`, value: tauMax, unit: R`\mathrm{fs}`, digits: 7 },
          { symbol: R`e_\mathrm{det}^{\max}`, label: '$s_{\\max}$ 那一拍 PD 看到的殘差（$\\varepsilon<0$ 時為負）', value: eMax, unit: R`\mathrm{fs}`, digits: 7 },
        ],
        notes: [
          KF === 0
            ? '$K_\\mathrm{F}=0$：整數 FCW，累加器永遠不進位、residue 恆為 0——DTC 沒有東西要補，LMS 也沒有激勵可以學（Persistent Excitation，Ch09）。'
            : R`驗算：逐拍累加得到的 $${tex2(last.cumErr, 7)}$ 與封閉式 $-s[${lastN}]/M=${tex2(last.residue, 7)}$ 必須相同；序列的週期是 $M/\gcd(K_\mathrm{F},M)$ 拍。`,
          R`殘差 $e_\mathrm{det}=\delta\,x[n]$ 和 code 成正比，比例係數 $\delta=a-w$ 就是 LMS 要學的量；典型 comparator 雜訊 $\sigma_v\approx100\,\mathrm{fs}$，可以和上面的答案比大小。`,
        ],
      }
    },
    tips: [
      '每一拍只做一次加法：$t=s+K_\\mathrm{F}$；$t\\ge M$ 就記一次 carry 並減掉 $M$。也可以直接用 $s[n]=\\bigl((n+1)K_\\mathrm{F}\\bigr)\\bmod M$ 檢查。',
      '範例數字（$K_\\mathrm{F}=5$、$M=16$、$f_\\mathrm{vco}=13\\,\\mathrm{GHz}$、$\\varepsilon=1\\%$）：$s=5,10,15,4,9$，$r[4]=-0.5625$；$s_{\\max}=15$ 那一拍 $\\tau_\\mathrm{need}=72115.38\\,\\mathrm{fs}$、殘差 $721.15\\,\\mathrm{fs}$（與 §2 文中的數字相同）。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.2',
    title: '親手累加一個 GMAC block（$N=4$）：$S$、$G$ 與兩種更新',
    page: '/ch/04',
    formulaId: 'F-04.3',
    formulaTex: R`e[n]=\delta\,x[n]+v[n],\quad b[n]=\bigl[e[n]\ge0\bigr],\quad q[n]=2b[n]-1;\qquad S=\sum_{n=0}^{N-1}q[n]\,x[n],\quad G=\frac{S}{N};\qquad w_\mathrm{avg}=w+\mu G,\quad w_\mathrm{sum}=w+\mu S`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'a', symbol: 'a', label: '真實需要的 DTC gain', unit: R`\mathrm{fs}`, default: 3, min: -100, max: 100, practice: { choices: [2, 3, 4, 5] } },
      { key: 'w', symbol: 'w', label: '這個 block 使用的校正 gain', unit: R`\mathrm{fs}`, default: 1, min: -100, max: 100, practice: { choices: [0, 1, 2, 6] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率', unit: R`\mathrm{fs}`, default: 2, min: 0, max: 100, practice: { choices: [0.5, 1, 2] } },
      { key: 'x0', symbol: 'x[0]', label: 'code（第 0 拍）', default: 1, min: -8, max: 8, practice: { choices: [-1, 1] } },
      { key: 'x1', symbol: 'x[1]', label: 'code（第 1 拍）', default: -1, min: -8, max: 8, practice: { choices: [-1, 1] } },
      { key: 'x2', symbol: 'x[2]', label: 'code（第 2 拍）', default: 1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1] } },
      { key: 'x3', symbol: 'x[3]', label: 'code（第 3 拍）', default: -1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1] } },
      { key: 'v0', symbol: 'v[0]', label: 'comparator 前雜訊（第 0 拍）', unit: R`\mathrm{fs}`, default: 0.5, min: -50, max: 50, practice: { min: -3, max: 3, step: 0.5 } },
      { key: 'v1', symbol: 'v[1]', label: 'comparator 前雜訊（第 1 拍）', unit: R`\mathrm{fs}`, default: 1.5, min: -50, max: 50, practice: { min: -3, max: 3, step: 0.5 } },
      { key: 'v2', symbol: 'v[2]', label: 'comparator 前雜訊（第 2 拍）', unit: R`\mathrm{fs}`, default: -3, min: -50, max: 50, practice: { min: -3, max: 3, step: 0.5 } },
      { key: 'v3', symbol: 'v[3]', label: 'comparator 前雜訊（第 3 拍）', unit: R`\mathrm{fs}`, default: -0.5, min: -50, max: 50, practice: { min: -3, max: 3, step: 0.5 } },
    ],
    validate: ({ x0, x1, x2, x3 }) =>
      x0 === 0 && x1 === 0 && x2 === 0 && x3 === 0
        ? R`四拍的 code 全是 $0$：$q[n]\,x[n]$ 每一項都是 $0$，這個 block 完全不含 $a$ 的資訊（沒有激勵），$w$ 不會動。請至少讓一拍的 $x[n]\ne0$。`
        : null,
    solve: ({ a, w, mu, x0, x1, x2, x3, v0, v1, v2, v3 }) => {
      const x = [x0, x1, x2, x3]
      const v = [v0, v1, v2, v3]
      const N = x.length
      const delta = a - w
      const e = x.map((xi, i) => delta * xi + v[i])
      const b = e.map((ei) => comparatorBit(ei))
      const q = b.map((bi) => decodeComparator(bi, 'bipolar_pm_one'))
      const run = gmacRunningSum(q, x)
      const S = gmacSum(q, x)
      const G = gmacAverage(q, x)
      const wAvg = blockUpdate(w, q, x, mu, 'average')
      const wSum = blockUpdate(w, q, x, mu, 'sum')
      const right = x.filter((xi, i) => q[i] * xi * delta > 0).length
      const voted = x.filter((xi) => xi !== 0).length
      const ties = e.filter((ei) => ei === 0).length
      const perSample = x.flatMap((xi, n) => [
        {
          tex: R`e[${n}]=\delta\,x[${n}]+v[${n}]=${texNumP(delta)}\times${texNumP(xi)}+${texNumP(v[n])}=${texNum(delta * xi)}+${texNumP(v[n])}=${texNum(e[n])}`,
          why: `第 ${n} 拍 comparator 前的誤差：確定性的殘差 $\\delta x$ 加上雜訊。先乘、再加。`,
        },
        {
          tex: R`e[${n}]${e[n] >= 0 ? R`\ge` : '<'}0\;\Rightarrow\;b[${n}]=${ti(b[n])},\quad q[${n}]=2b[${n}]-1=2\times${ti(b[n])}-1=${ti(q[n])},\quad q[${n}]\,x[${n}]=${tip(q[n])}\times${texNumP(xi)}=${texNum(q[n] * xi)}`,
          why: `comparator 只留正負號${e[n] === 0 ? '（$e=0$ 的 tie 判成 $+1$，勘誤 E07）' : ''}；$q=\\pm1$，所以「乘 $x$」只是照抄或取負。累加到這一拍 $S=${texNum(run[n])}$。`,
        },
      ])
      return {
        steps: [
          { tex: R`\delta=a-w=${texNum(a)}-${texNumP(w)}=${texNum(delta)}`, why: '剩餘的 gain 誤差（全站極性 $\\delta=a-w$）：$\\delta>0$ 表示 DTC gain 還太小。' },
          ...perSample,
          {
            tex: R`S=\sum_{n=0}^{${N - 1}}q[n]\,x[n]=${x.map((xi, i) => texNumP(q[i] * xi)).join('+')}=${texNum(S)}`,
            why: '把四拍的 $q\\,x$ 加起來：這是 GMAC 的總和（累加器裡真正存的數）。',
          },
          { tex: R`G=\frac{S}{N}=\frac{${texNum(S)}}{${N}}=${texNum(G)}`, why: '除以 $N$ 得到平均（RTL：算術右移 $\\log_2N=2$ bits）。$G$ 的大小不隨 $N$ 成長。' },
          {
            tex: R`w_\mathrm{avg}=w+\mu G=${texNum(w)}+${texNum(mu)}\times${texNumP(G)}=${texNum(w)}+${texNumP(mu * G)}=${texNum(wAvg)}`,
            why: 'average 模式的更新（§0 的定義）。',
          },
          {
            tex: R`w_\mathrm{sum}=w+\mu S=${texNum(w)}+${texNum(mu)}\times${texNumP(S)}=${texNum(w)}+${texNumP(mu * S)}=${texNum(wSum)}`,
            why: '如果 RTL 少了「$\\div N$」的右移，同一個 $\\mu$ 會用總和去更新：更新量是 average 的 $N$ 倍。',
          },
        ],
        results: [
          { symbol: 'S', label: 'GMAC 總和', value: S },
          { symbol: 'G', label: 'GMAC 平均', value: G },
          { symbol: R`w_\mathrm{avg}`, label: 'average 模式更新後的 gain', value: wAvg, unit: R`\mathrm{fs}` },
          { symbol: R`w_\mathrm{sum}`, label: 'sum 模式更新後的 gain（同一個 $\\mu$）', value: wSum, unit: R`\mathrm{fs}` },
        ],
        notes: [
          delta === 0
            ? '$\\delta=0$：殘差只剩雜訊，$q$ 的正負號和 $x$ 無關，$S$ 只是雜訊（這就是收斂後 $w$ 仍會抖動的原因，Ch12）。'
            : R`「投票」：${voted} 拍有效的 $q\,x$ 裡有 ${right} 拍和 $\delta$ 同號（方向正確）；雜訊夠大時會把少數幾拍翻成錯的方向，所以要累加很多拍再平均。`,
          R`更新後的剩餘誤差：average $a-w_\mathrm{avg}=${texNum(a - wAvg)}$、sum $a-w_\mathrm{sum}=${texNum(a - wSum)}$；sum 的更新量恰好是 average 的 $N=${N}$ 倍（$\mu S=N\mu G$）。`,
          ...(ties > 0 ? ['這組數字有 $e[n]=0$ 的 tie：本站一律判成 $b=1$（$q=+1$），硬體也必須明訂這個規則（勘誤 E07）。'] : []),
        ],
      }
    },
    tips: [
      '建議在紙上畫一張表，欄位依序是 $x$、$\\delta x$、$v$、$e$、$b$、$q$、$q\\,x$、累加 $S$——和 §4「先算一次」的表格相同。',
      '範例數字的答案：$e=[2.5,-0.5,-1,-2.5]$、$q\\,x=[1,1,-1,1]$、$S=2$、$G=0.5$、$w_\\mathrm{avg}=2$、$w_\\mathrm{sum}=5$（衝過 $a=3$）。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.3',
    title: 'Loop gain 與 pole：average 對 sum，$N$ 一改差幾倍？',
    page: '/ch/04',
    formulaId: 'F-04.5',
    formulaTex: R`K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad K=K_qC,\qquad g_\mathrm{avg}=\mu K,\qquad g_\mathrm{sum}=N\mu K=N\,g_\mathrm{avg},\qquad p=1-g`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mu', symbol: R`\mu`, label: '學習率（average 意義）', unit: R`\mathrm{fs}`, default: 10, min: 0, max: 1000, practice: { choices: [1, 2, 5, 10, 20] } },
      { key: 'sigmaV', symbol: R`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: R`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [20, 50, 100, 200] } },
      { key: 'C', symbol: 'C', label: 'regressor 相關 $E[x_\\mathrm{ref}u]$（identity path 時 $=E[x^2]$）', default: 1, min: -10, max: 10, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的 sample 數', unit: R`\text{samples}`, default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [16, 64, 256, 1024, 4096] } },
      { key: 'N2', symbol: "N'", label: '改用的另一個 block 長度（比較用）', unit: R`\text{samples}`, default: 1024, min: 1, max: 1048576, integer: true, practice: { choices: [16, 64, 256, 1024, 4096] } },
    ],
    validate: ({ mu, sigmaV, C }) => {
      if (!(sigmaV > 0)) return R`$\sigma_v\le0$：沒有雜訊時 comparator 是純 sign，小訊號增益 $K_q=\sqrt{2/\pi}/\sigma_v$ 沒有定義（$\sigma_v\to0$ 時 $K_q\to\infty$，線性化失效）。`
      if (!(C > 0)) return R`$C\le0$：$p=1-\mu K_qC\ge1$，平均更新方向錯誤或沒有回復力（PD 路徑相位超過 $90^\circ$ 或 code 錯位，見 Ch06 / Ch07）。本題假設 $C>0$。`
      if (!(mu > 0)) return R`$\mu\le0$：$g\le0$，迴路不會往 $a$ 收斂。請用正的 $\mu$。`
      return null
    },
    solve: ({ mu, sigmaV, C, N, N2 }) => {
      const { Kq, K } = smallSignalGain(sigmaV, C)
      const [row, row2] = sumAverageTable({ mu, sigmaV, C, Ex2: C, Ns: [N, N2] })
      const c0 = Math.sqrt(2 / Math.PI)
      const verdict = (g: number): string => (g < 1 ? '穩定、單調收斂' : g < 2 ? '穩定但正負交替（$p<0$）' : '不穩定（$|p|\\ge1$）')
      return {
        steps: [
          {
            tex: R`\sqrt{\frac{2}{\pi}}=\sqrt{\frac{2}{3.14159}}=\sqrt{${texNum(2 / Math.PI)}}=${texNum(c0)}`,
            why: '計算機：先 $2\\div\\pi=0.63662$，再按 $\\sqrt{\\ }$。這個常數值得背起來：$\\approx0.798$。',
          },
          { tex: R`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(c0)}}{${texNum(sigmaV)}}=${texNum(Kq)}\,\mathrm{fs}^{-1}`, why: '1-bit comparator 的小訊號增益：雜訊越大，「$1\\,\\mathrm{fs}$ 的誤差」讓 $E[q]$ 偏離 0 的量越小。' },
          { tex: R`K=K_qC=${texNum(Kq)}\times${texNum(C)}=${texNum(K)}\,\mathrm{fs}^{-1}`, why: 'GMAC 對 $\\delta$ 的平均斜率：$E[G]\\approx K\\delta$（F-04.4）。' },
          { tex: R`g_\mathrm{avg}=\mu K=${texNum(mu)}\times${texNum(K)}=${texNum(row.gAvg)}`, why: 'average 模式的無因次 loop gain（$\\mathrm{fs}\\times\\mathrm{fs}^{-1}$），和 $N$ 無關。' },
          { tex: R`p_\mathrm{avg}=1-g_\mathrm{avg}=1-${texNum(row.gAvg)}=${tdp(row.poleAvg, dpOf(row.gAvg))}`, why: '平均誤差每個 block 乘上的倍數：$E[\\delta_{k+1}]=p\\,E[\\delta_k]$。' },
          { tex: R`g_\mathrm{sum}=N\,g_\mathrm{avg}=${ti(N)}\times${texNum(row.gAvg)}=${texNum(row.gSum)}`, why: 'RTL 少了「$\\div N$」的右移、$\\mu$ 卻沒改：loop gain 放大 $N$ 倍。' },
          { tex: R`p_\mathrm{sum}=1-g_\mathrm{sum}=1-${texNum(row.gSum)}=${tdp(row.poleSum, dpOf(row.gSum))}`, why: '$|p|<1$（也就是 $0<g<2$）才收斂。' },
          {
            tex: R`g'_\mathrm{sum}=N'\,g_\mathrm{avg}=${ti(N2)}\times${texNum(row2.gAvg)}=${texNum(row2.gSum)}`,
            why: "換成另一個 block 長度 $N'$ 再算一次 sum 模式的 loop gain（average 模式的 $g$ 和 $N$ 無關，不用重算）。",
          },
          {
            tex: R`\frac{g_\mathrm{sum}}{g'_\mathrm{sum}}=\frac{N}{N'}=\frac{${ti(N)}}{${ti(N2)}}=${tex2(N / N2)}`,
            why: "把 block 長度由 $N'$ 改成 $N$：sum 模式的 $g$ 跟著 $N$ 等比例改變——改 $N$ 就等於改了 loop gain。",
          },
          {
            tex: R`\mu_\mathrm{sum}=\frac{\mu}{N}=\frac{${texNum(mu)}}{${ti(N)}}=${tex2(mu / N)}\,\mathrm{fs}`,
            why: '如果真的要用 sum 模式，$\\mu$ 必須縮小 $N$ 倍，才會得到和 average 相同的 $g$（$w_k$ 軌跡完全相同）。',
          },
        ],
        results: [
          { symbol: 'K_q', label: 'comparator 小訊號增益', value: Kq, unit: R`\mathrm{fs}^{-1}` },
          { symbol: R`g_\mathrm{avg}`, label: 'average 模式的 loop gain', value: row.gAvg },
          { symbol: R`p_\mathrm{avg}`, label: 'average 模式的 pole', value: row.poleAvg },
          { symbol: R`g_\mathrm{sum}`, label: 'sum 模式的 loop gain（同一個 $\\mu$）', value: row.gSum },
          { symbol: R`p_\mathrm{sum}`, label: 'sum 模式的 pole', value: row.poleSum },
          { symbol: R`g'_\mathrm{sum}`, label: "block 長度為 $N'$ 時 sum 模式的 loop gain", value: row2.gSum },
        ],
        notes: [
          `average：${verdict(row.gAvg)}；sum：${verdict(row.gSum)}。`,
          R`收斂附近每個 block 的 GMAC 雜訊（identity path、$E[x^2]=C$）：$\mathrm{sd}(G)\approx\sqrt{C/N}=${texNum(row.sdAvg)}$、$\mathrm{sd}(S)\approx\sqrt{NC}=${texNum(row.sdSum)}$，兩者也差 $N$ 倍（勘誤 E18：軸一定要標明是 sum 還是 average）。`,
          'sign-LMS 的 $|S|\\le N\\max|x|$ 有界，所以 $g\\gg2$ 時實際看到的是 $w$ 在 $a$ 兩側大幅來回跳，而不是數值無限大。',
        ],
      }
    },
    tips: [
      '只有第一步需要計算機（$\\sqrt{2/\\pi}\\approx0.798$）；其餘都是乘法、除法與減法。',
      '範例數字就是測試 T13：$K_q=0.0079788\\,\\mathrm{fs}^{-1}$、$g=0.079788$、$p=0.92021$；sum 模式 $g=326.81$、$p=-325.81$。',
      '$K=K_qC$ 是小訊號近似（$|\\delta u|\\ll\\sigma_v$）；$|\\delta|/\\sigma_v\\approx0.25$ 時 $K\\delta$ 高估約 1%。',
      ROUNDING_TIP,
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.4',
    title: '硬體 0/1 要映射成 $\\pm1$：忘了 $q=2b-1$ 會算出什麼？',
    page: '/ch/04',
    formulaId: 'F-04.7',
    formulaTex: R`q=2b-1;\qquad G=\frac1N\sum_n q[n]\,x[n],\qquad G_\mathrm{bug}=\frac1N\sum_n b[n]\,x[n]=\tfrac12G+\tfrac12\bar x,\qquad\bar x=\frac1N\sum_n x[n]`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'b0', symbol: 'b[0]', label: 'comparator 位元（第 0 拍）', default: 1, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b1', symbol: 'b[1]', label: 'comparator 位元（第 1 拍）', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b2', symbol: 'b[2]', label: 'comparator 位元（第 2 拍）', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'b3', symbol: 'b[3]', label: 'comparator 位元（第 3 拍）', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'x0', symbol: 'x[0]', label: 'code（第 0 拍）', default: 1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1, 1.5] } },
      { key: 'x1', symbol: 'x[1]', label: 'code（第 1 拍）', default: -1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1, 1.5] } },
      { key: 'x2', symbol: 'x[2]', label: 'code（第 2 拍）', default: 1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1, 1.5] } },
      { key: 'x3', symbol: 'x[3]', label: 'code（第 3 拍）', default: -1, min: -8, max: 8, practice: { choices: [-1, -0.5, 0.5, 1, 1.5] } },
    ],
    validate: ({ b0, b1, b2, b3 }) =>
      [b0, b1, b2, b3].some((b) => b !== 0 && b !== 1) ? 'comparator 的輸出是一個 bit：$b[n]$ 只能是 $0$ 或 $1$（$b=1\\Leftrightarrow e\\ge0$）。' : null,
    solve: ({ b0, b1, b2, b3, x0, x1, x2, x3 }) => {
      const b = [b0, b1, b2, b3] as Bit[]
      const x = [x0, x1, x2, x3]
      const N = x.length
      const q = b.map((bi) => decodeComparator(bi, 'bipolar_pm_one'))
      const qBug = b.map((bi) => decodeComparator(bi, 'unipolar_unmapped_bug'))
      const S = gmacSum(q, x)
      const G = gmacAverage(q, x)
      const Sbug = gmacSum(qBug, x)
      const Gbug = gmacAverage(qBug, x)
      const xSum = x.reduce((acc, xi) => acc + xi, 0)
      const xbar = xSum / N
      return {
        steps: [
          {
            tex: R`q[n]=2b[n]-1:\quad ${b.map((bi, n) => `q[${n}]=2\\times${ti(bi)}-1=${ti(q[n])}`).join(R`,\;`)}`,
            why: '正確的映射：$b=1\\to q=+1$、$b=0\\to q=-1$。',
          },
          {
            tex: R`\sum_n q[n]\,x[n]=${x.map((xi, n) => `${tip(q[n])}\\times${texNumP(xi)}`).join('+')}=${x.map((xi, n) => texNumP(q[n] * xi)).join('+')}=${texNum(S)}`,
            why: '正確的 GMAC 總和：$q=-1$ 的那幾拍是「減 $x$」。',
          },
          { tex: R`G=\frac{${texNum(S)}}{${N}}=${texNum(G)}`, why: '正確的 GMAC 平均。' },
          {
            tex: R`\sum_n b[n]\,x[n]=${x.map((xi, n) => `${ti(b[n])}\\times${texNumP(xi)}`).join('+')}=${x.map((xi, n) => texNumP(qBug[n] * xi)).join('+')}=${texNum(Sbug)}`,
            why: '忘了映射：RTL 直接拿 $b$ 控制「加 $x$ 或不加」，$b=0$ 的那幾拍變成「什麼都不加」，而不是「減 $x$」。',
          },
          { tex: R`G_\mathrm{bug}=\frac{${texNum(Sbug)}}{${N}}=${texNum(Gbug)}`, why: 'bug 版本的 GMAC 平均。' },
          {
            tex: R`\bar x=\frac1N\sum_n x[n]=\frac{${x.map((xi, n) => (n === 0 ? texNum(xi) : texNumP(xi))).join('+')}}{${N}}=\frac{${texNum(xSum)}}{${N}}=${texNum(xbar)}`,
            why: '這個 block 的 code 平均（DC 成分）。',
          },
          {
            tex: R`\tfrac12G+\tfrac12\bar x=\tfrac12\times${texNumP(G)}+\tfrac12\times${texNumP(xbar)}=${texNum(G / 2)}+${texNumP(xbar / 2)}=${texNum(G / 2 + xbar / 2)}`,
            why: '恆等式（把 $b=(q+1)/2$ 代進去）：應該和上面直接算的 $G_\\mathrm{bug}$ 完全相同。',
          },
        ],
        results: [
          { symbol: 'G', label: '正確映射的 GMAC 平均', value: G },
          { symbol: R`G_\mathrm{bug}`, label: '忘了映射的 GMAC 平均', value: Gbug },
          { symbol: R`\bar x`, label: 'code 的平均', value: xbar },
        ],
        notes: [
          xbar === 0
            ? '$\\bar x=0$（零均值 code）：$G_\\mathrm{bug}=\\tfrac12G$，只有增益減半、固定點仍是 $a$——所以這個 bug 在零均值 code 的模擬裡很容易漏掉。'
            : R`$\bar x=${texNum(xbar)}\ne0$：就算 $\delta=0$（$G$ 的平均為 0），$G_\mathrm{bug}$ 的平均仍是 $\tfrac12\bar x=${texNum(xbar / 2)}$，$w$ 會被推離 $a$，直到 $\tfrac12K\delta^*+\tfrac12E[x]=0$，即 $w^*\approx a+E[x]/(K_qC)$（下一題）。`,
          '增益也減半：$E[G_\\mathrm{bug}]\\approx\\tfrac12K\\delta+\\tfrac12E[x]$，所以 $g_\\mathrm{bug}=\\tfrac12\\mu K$、時間常數加倍。',
        ],
      }
    },
    tips: [
      '範例數字是 §4 手算表的 $b=[1,0,0,0]$、$x=[1,-1,1,-1]$：$G=0.5$、$G_\\mathrm{bug}=0.25=\\tfrac12\\times0.5+\\tfrac12\\times0$。',
      '想看到偏差項，把 code 改成有 DC 的，例如 $x=[0.5,1,1.5,1]$（DSM 累加器的 code $s/M\\in[0,1)$ 就是這種）。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.5',
    title: '忘了映射＋有 DC 的 Gaussian code：$w$ 會停在哪裡？（查 $\\Phi$ 表）',
    page: '/ch/04',
    formulaId: 'F-04.16',
    formulaTex: R`\xi_\mathrm{lin}=-\frac{m_x}{\sqrt{2/\pi}\,E[x^2]};\qquad h(\xi)=m_x\,\Phi\!\Bigl(\frac{\xi m_x}{\gamma}\Bigr)+\frac{\sigma_x^2\,\xi}{\gamma}\,\varphi\!\Bigl(\frac{\xi m_x}{\gamma}\Bigr),\quad\gamma=\sqrt{1+\xi^2\sigma_x^2};\qquad w=a-\xi\,\sigma_v`,
    level: 'research',
    claim: 'exact',
    inputs: [
      { key: 'mx', symbol: 'm_x', label: 'code 的平均 $E[x]$', default: 0.5, min: -5, max: 5, practice: { choices: [-0.5, 0.25, 0.5, 1] } },
      { key: 'sx', symbol: R`\sigma_x`, label: 'code 的標準差', default: 1, min: 0, max: 10, practice: { choices: [0.5, 1, 2] } },
      { key: 'sigmaV', symbol: R`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: R`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [10, 50, 100] } },
      { key: 'a', symbol: 'a', label: '真實需要的 DTC gain', unit: R`\mathrm{fs}`, default: 3, min: -1000, max: 1000, practice: { choices: [3, 30] } },
      { key: 'xi', symbol: R`\xi`, label: '要檢查的正規化誤差 $\\xi=\\delta/\\sigma_v$（試探值）', default: -0.6023, min: -20, max: 20, practice: { choices: [-1, -0.8, -0.6, -0.5, -0.4, -0.2, 0.2, 0.5] } },
    ],
    validate: ({ sx, sigmaV }) => {
      if (!(sx > 0)) return R`$\sigma_x=0$：code 是固定的常數（單邊 code），$b\,x$ 永遠同號，$h(\xi)=m_x\Phi(\xi m_x)$ 沒有零點——忘了映射時 $w$ 會一路漂到 rail，根本沒有固定點。請用 $\sigma_x>0$。`
      if (!(sigmaV > 0)) return R`$\sigma_v\le0$：$\xi=\delta/\sigma_v$ 沒有定義（沒有雜訊時 comparator 是純 sign，mean-field 模型不連續）。`
      return null
    },
    solve: ({ mx, sx, sigmaV, a, xi }) => {
      const fp = bugFixedPointGaussian({ codeMean: mx, codeSigma: sx, sigmaV, aTrue: a })
      const Ex2 = mx * mx + sx * sx
      const c0 = Math.sqrt(2 / Math.PI)
      const gamma = Math.sqrt(1 + xi * xi * sx * sx)
      const z = (xi * mx) / gamma
      const Phi = normCdf(z)
      const phi = normPdf(z)
      const h = bugMeanGmac(xi, mx, sx)
      const t1 = mx * Phi
      const t2 = (sx * sx * xi * phi) / gamma
      const wTrial = a - xi * sigmaV
      const c1 = 1 / Math.sqrt(2 * Math.PI)
      const q2 = xi * xi * sx * sx
      const u = (z * z) / 2
      return {
        steps: [
          { tex: R`E[x^2]=m_x^2+\sigma_x^2=${texNumP(mx)}^2+${texNum(sx)}^2=${texNum(mx * mx)}+${texNum(sx * sx)}=${texNum(Ex2)}`, why: 'code 的均方值 = 平均的平方 + 變異數。' },
          {
            tex: R`\xi_\mathrm{lin}=-\frac{m_x}{\sqrt{2/\pi}\,E[x^2]}=-\frac{${texNum(mx)}}{${texNum(c0, 6)}\times${texNum(Ex2)}}=-\frac{${texNum(mx)}}{${texNum(c0 * Ex2, 6)}}=${texNum(fp.xiLin)}`,
            why: '線性化（F-04.7）：$\\delta^*=-E[x]/(K_qE[x^2])$，除以 $\\sigma_v$ 後 $\\sigma_v$ 消掉。$\\sqrt{2/\\pi}\\approx0.797885$（$2\\div\\pi$ 再開根號）。',
          },
          {
            tex: R`w^*_\mathrm{lin}=a-\xi_\mathrm{lin}\,\sigma_v=${texNum(a)}-${texNumP(fp.xiLin)}\times${texNum(sigmaV)}=${texNum(a)}-${texNumP(fp.xiLin * sigmaV)}=${texNum(fp.wStarLinear)}\,\mathrm{fs}`,
            why: '線性化預測的固定點（$\\delta=a-w\\Rightarrow w=a-\\xi\\sigma_v$）。接下來用精確的 $h(\\xi)$ 檢查你的試探值。',
          },
          {
            tex: R`\xi^2\sigma_x^2=${texNumP(xi)}^2\times${texNum(sx)}^2=${texNum(xi * xi, 6)}\times${texNum(sx * sx)}=${texNum(q2, 6)}`,
            why: '$\\gamma$ 裡面要用的乘積：兩個數各自平方，再相乘。',
          },
          {
            tex: R`\gamma=\sqrt{1+\xi^2\sigma_x^2}=\sqrt{1+${texNum(q2, 6)}}=\sqrt{${tdp(1 + q2, dpOf(q2, 6))}}=${texNum(gamma, 6)}`,
            why: '加 1 再開根號（計算機的 $\\sqrt{\\ }$ 鍵）。$\\gamma^2=1+\\xi^2\\sigma_x^2$ 就是推導第 2 步裡 $Z-\\xi x$ 的變異數。',
          },
          { tex: R`z=\frac{\xi\,m_x}{\gamma}=\frac{${texNumP(xi)}\times${texNumP(mx)}}{${texNum(gamma, 6)}}=\frac{${texNum(xi * mx)}}{${texNum(gamma, 6)}}=${texNum(z)}`, why: '$\\Phi$ 與 $\\varphi$ 的引數。' },
          {
            // 只寫 Φ(數字) = 結果：前面多一個「Φ(z) =」的話，手機（375 px）上這一行剛好比欄寬多 4 px，會多出一條沒有用途的橫向捲軸
            tex: R`\Phi(${texNum(z)})=${texNum(Phi, 6)}`,
            why:
              R`查標準常態累積分布表（負的 $z$ 用 $\Phi(-z)=1-\Phi(z)$），或用計算機 $\Phi(z)=\tfrac12\bigl[1+\mathrm{erf}(z/\sqrt2)\bigr]$。` +
              (Math.abs(z) <= 0.3
                ? R`$|z|\le0.3$ 時可用 $\Phi(z)\approx0.5+0.3989\,z$：這裡給 $${texNum(0.5 + c1 * z, 4)}$（絕對誤差 $<0.002$）。`
                : R`這裡 $|z|>0.3$，線性近似 $0.5+0.3989\,z$ 的誤差已超過 $0.002$，請查表。`),
          },
          {
            tex: R`u=\frac{z^2}{2}=\frac{${texNumP(z)}^2}{2}=\frac{${texNum(z * z)}}{2}=${texNum(u)}`,
            why: '$\\varphi$ 的指數：先平方，再除以 2。',
          },
          {
            tex: R`\varphi(z)=\frac{e^{-u}}{\sqrt{2\pi}}=${texNum(c1, 6)}\times e^{-${texNum(u)}}=${texNum(c1, 6)}\times${texNum(Math.exp(-u), 6)}=${texNum(phi, 6)}`,
            why: '標準 Gaussian 密度：$1/\\sqrt{2\\pi}\\approx0.398942$；$e^{-u}$ 用計算機的 $e^x$ 鍵，$u\\le0.05$ 時可用 $e^{-u}\\approx1-u$（誤差 $<0.0013$）。',
          },
          { tex: R`m_x\,\Phi(z)=${texNumP(mx)}\times${texNum(Phi, 6)}=${texNum(t1, 6)}`, why: '第一項：code 的 DC 乘上「$b=1$ 的機率」——就是 bug 多出來的那個 $\\tfrac12E[x]$（$\\xi=0$ 時恰為 $m_x/2$）。' },
          {
            tex: R`\frac{\sigma_x^2\,\xi\,\varphi(z)}{\gamma}=\frac{${texNum(sx * sx)}\times${texNumP(xi)}\times${texNum(phi, 6)}}{${texNum(gamma, 6)}}=\frac{${texNum(sx * sx * xi * phi, 6)}}{${texNum(gamma, 6)}}=${texNum(t2, 6)}`,
            why: '第二項：真正帶有 $\\delta$ 資訊的部分（小 $\\xi$ 時約為 $\\tfrac12K\\delta$ 的正規化版本）。',
          },
          {
            tex: R`h(\xi)=${texNum(t1, 6)}+${texNumP(t2, 6)}=${tdp(h, sumDp([t1, t2], 6))}`,
            why: '兩項相加 = 忘了映射時每個 sample 的平均更新 $E[b\\,x]$；$h=0$ 才是固定點。接近固定點時兩項幾乎抵消（有效位數會掉）：前面每一步請至少保留 5–6 位有效數字，而且這個和只準到上面兩項的最後一位——下方框內的 $h$ 是用完整精度算的。',
          },
          { tex: R`w=a-\xi\,\sigma_v=${texNum(a)}-${texNumP(xi)}\times${texNum(sigmaV)}=${texNum(a)}-${texNumP(xi * sigmaV)}=${texNum(wTrial)}\,\mathrm{fs}`, why: '這個試探值對應的 gain。' },
        ],
        results: [
          { symbol: R`\xi_\mathrm{lin}`, label: '線性化的正規化誤差', value: fp.xiLin },
          { symbol: R`w^*_\mathrm{lin}`, label: '線性化預測的固定點', value: fp.wStarLinear, unit: R`\mathrm{fs}` },
          { symbol: R`h(\xi)`, label: '試探值的平均更新（接近 0 才是固定點）', value: h, digits: 3, tolerance: { abs: 2e-3, rel: 0.02 } },
          { symbol: 'w', label: '試探值對應的 gain $a-\\xi\\sigma_v$', value: wTrial, unit: R`\mathrm{fs}` },
        ],
        notes: [
          Math.abs(h) < 1e-3
            ? R`$|h(\xi)|<10^{-3}$：這個 $\xi$ 幾乎就是固定點。二分法的精確根 $\xi^*=${texNum(fp.xi, 6)}$、$w^*=${texNum(fp.wStar, 6)}\,\mathrm{fs}$；線性化給 $${texNum(fp.wStarLinear, 5)}\,\mathrm{fs}$，差了 $${texNum(fp.wStar - fp.wStarLinear, 3)}\,\mathrm{fs}$。`
            : R`$h(\xi)${h > 0 ? '>' : '<'}0$：平均更新為${h > 0 ? '正' : '負'}，$w$ 還會往${h > 0 ? '上' : '下'}走，所以真正的根在比較${h > 0 ? '小' : '大'}的 $\xi$。二分法的精確根 $\xi^*=${texNum(fp.xi, 6)}$、$w^*=${texNum(fp.wStar, 6)}\,\mathrm{fs}$。`,
          R`把試探值改成 $\xi_\mathrm{lin}=${texNum(fp.xiLin, 4)}$ 再算一次 $h$：如果不是 0，表示線性化在這組 code 下已經不準（$|\delta x|$ 不再遠小於 $\sigma_v$）。`,
          '$h$ 只和 $\\xi$ 與 code 分布有關，所以偏差 $w^*-a=-\\xi^*\\sigma_v$ 和 $\\sigma_v$ 精確成正比；$m_x=0$ 時 $\\xi^*=0$（固定點就是 $a$）。',
        ],
      }
    },
    tips: [
      '需要查 $\\Phi$ 表（或計算機的常態分布 / erf 功能）與 $e^x$；其餘是加減乘除與一次開根號。',
      '手邊沒有表時：$|z|\\le0.3$ 用 $\\Phi(z)\\approx0.5+0.3989z$、$\\varphi(z)\\approx0.3989\\,(1-z^2/2)$，誤差都在 $0.002$ 以內，足夠判斷 $h$ 的正負號（除非 $|h|$ 本身就小於 $0.002$，那表示你已經在固定點旁邊了）。',
      ROUNDING_TIP,
      '範例數字（$m_x=0.5$、$\\sigma_x=1$、$\\sigma_v=100\\,\\mathrm{fs}$、$a=3\\,\\mathrm{fs}$）：線性化 $53.13\\,\\mathrm{fs}$；$\\xi=-0.6023$ 時 $h\\approx0$，$w=63.23\\,\\mathrm{fs}$（測試 T04 的 mean-field 固定點 $63.2341\\,\\mathrm{fs}$）。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.6',
    title: 'GMAC 累加器要幾個 bit？位元不夠時 wrap 成多少？',
    page: '/ch/04',
    formulaId: 'F-04.9',
    formulaTex: R`M_x=\begin{cases}2^{B_x-1}-1,&\text{symmetric}\\2^{B_x-1},&\text{full range}\end{cases},\qquad|S|\le N\,M_x,\qquad B_\mathrm{acc}=1+\bigl\lceil\log_2(NM_x+1)\bigr\rceil`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'bx', symbol: 'B_x', label: 'code 位元數（有號）', unit: R`\text{bits}`, default: 6, min: 2, max: 16, integer: true, practice: { choices: [4, 6, 8, 10] } },
      { key: 'N', symbol: 'N', label: '每個 block 累加的 sample 數', unit: R`\text{samples}`, default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [16, 64, 100, 256, 1000, 1024, 4096] } },
      { key: 'full', symbol: R`\text{full}`, label: 'code 是否包含最負值 $-2^{B_x-1}$（0 = 對稱範圍，1 = full range）', default: 0, min: 0, max: 1, integer: true, practice: { choices: [0, 1] } },
      { key: 'Btry', symbol: "B'", label: '手上的暫存器寬度（看最壞情況會 wrap 成多少）', unit: R`\text{bits}`, default: 17, min: 2, max: 40, integer: true, practice: { choices: [10, 12, 14, 16, 17, 18, 20] } },
    ],
    validate: ({ bx, N, full, Btry }) => {
      if (full !== 0 && full !== 1) return 'code 範圍只有兩種：填 $0$（對稱，不含最負值）或 $1$（full range，含 $-2^{B_x-1}$）。'
      if (!Number.isInteger(bx) || bx < 2 || bx > 16) return '有號 code 至少要 2 bits（1 bit 只有 $0$ 和 $-1$），本題支援 $2\\le B_x\\le16$。'
      if (!Number.isInteger(N) || N < 1) return '$N$ 必須是正整數（一個 block 至少累加 1 筆）。'
      if (!Number.isInteger(Btry) || Btry < 2 || Btry > 40) return "暫存器寬度 $B'$ 必須是 $2\\ldots40$ 的整數。"
      return null
    },
    solve: ({ bx, N, full, Btry }) => {
      const range: CodeRange = full === 1 ? 'full' : 'symmetric'
      const sz = accumulatorSizing(bx, N, range)
      const bAcc = accumulatorBitsClosedForm(bx, N, range)
      const half = 2 ** (bx - 1)
      const worst = sz.maxPosSum
      const v = worst + 1
      const ceilLog = bAcc - 1
      const ceilLogN = sz.bitsRule - bx
      const nPow2 = 2 ** ceilLogN === N
      const wrapped = wrapTwos(worst, Btry)
      const span = 2 ** Btry
      const k = (worst - wrapped) / span
      const fits = wrapped === worst
      return {
        steps: [
          { tex: R`2^{B_x-1}=2^{${ti(bx - 1)}}=${ti(half)}`, why: '有號 $B_x$-bit code 的 full scale：範圍是 $[-2^{B_x-1},\\,2^{B_x-1}-1]$，負的一邊多一個。' },
          {
            tex: range === 'full' ? R`M_x=2^{B_x-1}=${ti(sz.maxAbsProduct)}` : R`M_x=2^{B_x-1}-1=${ti(half)}-1=${ti(sz.maxAbsProduct)}`,
            why:
              range === 'full'
                ? '單筆乘積 $|q\\,x_\\mathrm{int}|$ 的最大值：最負 code 取負後是 $+2^{B_x-1}$，比最大的正 code 還多 1。'
                : '單筆乘積 $|q\\,x_\\mathrm{int}|$ 的最大值：對稱範圍不含最負 code，所以是 $2^{B_x-1}-1$。',
          },
          { tex: R`|S|_{\max}=N\,M_x=${ti(N)}\times${ti(sz.maxAbsProduct)}=${ti(worst)}`, why: '最壞情況：$N$ 筆乘積全部同號且都取最大值（剛開機、$|\\delta|\\gg\\sigma_v$ 時真的會接近）。' },
          {
            tex: R`\log_2(NM_x+1)=\frac{\ln${ti(v)}}{\ln2}=\frac{${texNum(Math.log(v), 7)}}{0.6931472}=${texNum(Math.log2(v), 6)}\;\Rightarrow\;\bigl\lceil\cdot\bigr\rceil=${ti(ceilLog)}`,
            why:
              R`計算機沒有 $\log_2$ 鍵時用換底公式（$\ln$ 或 $\log_{10}$ 都可以，$\ln2=0.6931472$、$\log_{10}2=0.30103$）。不用計算機的做法：找「不小於 $${ti(v)}$ 的最小 2 的冪」——$2^{${ti(ceilLog)}}=${ti(2 ** ceilLog)}$${ceilLog > 0 ? R`，而 $2^{${ti(ceilLog - 1)}}=${ti(2 ** (ceilLog - 1))}$ 不夠` : ''}。` +
              (2 ** ceilLog === v ? R`注意這裡 $${ti(v)}$ 恰好是 2 的冪，$\log_2$ 本身就是整數、不必再進位；計算機若因捨入顯示成 $${ti(ceilLog)}.0000001$，別多進一位。` : ''),
          },
          { tex: R`B_\mathrm{acc}=1+\bigl\lceil\log_2(NM_x+1)\bigr\rceil=1+${ti(ceilLog)}=${ti(bAcc)}`, why: '再加 1 個符號位元（有號二補數暫存器的正端上限是 $2^{B_\\mathrm{acc}-1}-1$）。' },
          {
            tex: R`2^{B_\mathrm{acc}-1}-1=${ti(2 ** (bAcc - 1) - 1)}\ge${ti(worst)},\qquad2^{B_\mathrm{acc}-2}-1=${ti(2 ** (bAcc - 2) - 1)}<${ti(worst)}`,
            why: '驗算：這個寬度剛好放得下，再少 1 bit 就放不下。',
          },
          {
            tex: R`B_x+\lceil\log_2N\rceil=${ti(bx)}+\lceil\log_2{${ti(N)}}\rceil=${nPow2 ? '' : R`${ti(bx)}+\lceil${texNum(Math.log2(N), 6)}\rceil=`}${ti(bx)}+${ti(ceilLogN)}=${ti(sz.bitsRule)}`,
            why:
              R`常見的經驗法則，拿來和精確值比較：對稱 code 時它一定夠（$N$ 不是 2 的冪時可能多 1 bit）；full range 且 $N$ 是 2 的冪時會少 1 bit。$\lceil\log_2N\rceil$ 一樣用「加倍」找：$2^{${ti(ceilLogN)}}=${ti(2 ** ceilLogN)}\ge N$` +
              (ceilLogN > 0 ? R`，而 $2^{${ti(ceilLogN - 1)}}=${ti(2 ** (ceilLogN - 1))}<N$。` : '。'),
          },
          ...(fits
            ? [
                {
                  tex: R`|S|_{\max}=${ti(worst)}\le2^{B'-1}-1=2^{${ti(Btry - 1)}}-1=${ti(span / 2 - 1)}\;\Rightarrow\;S_\mathrm{wrap}=${ti(wrapped)}`,
                  why: "手上的 $B'$-bit 暫存器放得下最壞情況：不會 wrap。",
                },
              ]
            : [
                {
                  tex: R`k=\Bigl\lfloor\frac{|S|_{\max}}{2^{B'}}+\frac12\Bigr\rfloor=\Bigl\lfloor\frac{${ti(worst)}}{${ti(span)}}+0.5\Bigr\rfloor=\lfloor${tex2(worst / span)}+0.5\rfloor=\lfloor${tex2(worst / span + 0.5)}\rfloor=${ti(k)}`,
                  why: R`放不下（上限 $2^{B'-1}-1=${ti(span / 2 - 1)}<${ti(worst)}$）時硬體只留低 $B'$ 位元：等於減掉 $2^{B'}=2^{${ti(Btry)}}=${ti(span)}$ 的整數倍，直到落回 $[-2^{B'-1},\,2^{B'-1}-1]$。要減幾次？$k$ 就是最接近 $|S|_{\max}/2^{B'}$ 的整數（剛好 $.5$ 時進位）。`,
                },
                {
                  tex: R`S_\mathrm{wrap}=|S|_{\max}-k\cdot2^{B'}=${ti(worst)}-${ti(k)}\times${ti(span)}=${ti(worst)}-${ti(k * span)}=${ti(wrapped)}`,
                  why: R`減掉 $k=${ti(k)}$ 個 $2^{B'}$ 之後留在暫存器裡的值（二補數的 wrap）。`,
                },
              ]),
        ],
        results: [
          { symbol: R`|S|_{\max}`, label: '最壞情況的總和', value: worst, unit: R`\text{LSB}`, digits: 12, tolerance: { abs: 0.5, rel: 0 } },
          { symbol: R`B_\mathrm{acc}`, label: '最少需要的有號位元數', value: bAcc, unit: R`\text{bits}`, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: R`B_x+\lceil\log_2N\rceil`, label: '經驗法則給的位元數', value: sz.bitsRule, unit: R`\text{bits}`, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: R`S_\mathrm{wrap}`, label: "$B'$-bit 暫存器在最壞情況存到的值", value: wrapped, unit: R`\text{LSB}`, digits: 12, tolerance: { abs: 0.5, rel: 0 } },
        ],
        notes: [
          fits
            ? "$B'\\ge B_\\mathrm{acc}$：位元數足夠。"
            : wrapped <= 0
              ? R`wrap 之後由 $+${ti(worst)}$ 變成 $${ti(wrapped)}$——不只變小，還變號（或歸零）：迴路最需要正確方向的時候，更新方向反而相反。改用 saturate 至少保住正負號（停在 $${ti(span / 2 - 1)}$）。`
              : R`wrap 之後由 $${ti(worst)}$ 變成 $${ti(wrapped)}$：符號碰巧沒變，但大小完全錯了（再多累加幾筆就會變號）。`,
          sz.bitsRule === bAcc
            ? '這組數字的經驗法則與精確值相同。'
            : sz.bitsRule > bAcc
              ? R`經驗法則比精確值多 $${ti(sz.bitsRule - bAcc)}$ bit：對稱 code 且 $N$ 不是 2 的冪時，$B_x+\lceil\log_2N\rceil$ 只是充分條件。`
              : R`經驗法則比精確值「少」 $${ti(bAcc - sz.bitsRule)}$ bit：code 含最負值時 $M_x=2^{B_x-1}$，$B_\mathrm{acc}=B_x+\lfloor\log_2N\rfloor+1$。`,
        ],
      }
    },
    tips: [
      '$\\lceil\\log_2v\\rceil$ 不必真的算對數：把 2 一直加倍（$2,4,8,\\dots$），第一個 $\\ge v$ 的 $2^k$ 的指數 $k$ 就是答案。',
      '$N=2^m$ 時可以直接寫答案：對稱 code $B_\\mathrm{acc}=B_x+m$，full range $B_\\mathrm{acc}=B_x+m+1$。',
      '範例數字是 golden 的反面測試：6-bit 對稱 code、$N=4096$ 需要 18 bits；只給 17 bits 時 $31\\times4096=126976$ 會 wrap 成 $-4096$。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.7',
    title: '「$\\div N$」是右移：四種取整各得多少？floor 讓 $w$ 偏多少？',
    page: '/ch/04',
    formulaId: 'F-04.11',
    formulaTex: R`\ell=\log_2N-F_G,\qquad\Delta_G=\frac{2^{-F_G}}{2^{B_x-1}},\qquad\bar\varepsilon_\mathrm{floor}=-\frac{1-2^{-\ell}}{2},\qquad\delta^*=a-w^*=-\frac{\bar\varepsilon\,\Delta_G}{K}`,
    level: 'beginner',
    claim: 'approx',
    inputs: [
      { key: 'S', symbol: 'S', label: '某個 block 累加完的總和（整數）', unit: R`\text{LSB}`, default: -300, min: -1e9, max: 1e9, integer: true, practice: { choices: [-300, -130, -77, -14, 5, 37, 100, 250] } },
      { key: 'm', symbol: R`\log_2N`, label: 'block 長度的指數（$N=2^{\\log_2N}$）', unit: R`\text{bits}`, default: 10, min: 1, max: 20, integer: true, practice: { choices: [6, 8, 10] } },
      { key: 'FG', symbol: 'F_G', label: '右移後保留的小數位元數', unit: R`\text{bits}`, default: 2, min: 0, max: 20, integer: true, practice: { choices: [0, 2, 4] } },
      { key: 'bx', symbol: 'B_x', label: 'code 位元數（有號）', unit: R`\text{bits}`, default: 6, min: 2, max: 16, integer: true, practice: { choices: [6, 8] } },
      { key: 'K', symbol: 'K', label: 'GMAC 的平均斜率 $K=K_qC$', unit: R`\mathrm{fs}^{-1}`, default: 0.0025765, min: -1, max: 10, practice: { choices: [0.001, 0.002, 0.0025, 0.004, 0.005] } },
    ],
    validate: ({ S, m, FG, bx, K }) => {
      if (FG >= m) return R`$F_G\ge\log_2N$：$\ell=\log_2N-F_G\le0$，不需要右移（反而是左移補 0），沒有任何位元被丟掉，rounding 偏差為 0。請讓 $F_G<\log_2N$。`
      if (!(K > 0)) return R`$K\le0$：平均更新方向錯誤或沒有回復力，迴路沒有穩定的固定點，$\delta^*=-\bar\varepsilon\Delta_G/K$ 沒有意義。`
      const worst = 2 ** m * 2 ** (bx - 1)
      if (Math.abs(S) > worst) return R`$|S|=${ti(Math.abs(S))}$ 超過最壞情況 $N\cdot2^{B_x-1}=${ti(worst)}$：$N$ 筆 $B_x$-bit code 加不出這麼大的總和。請把 $|S|$ 調小。`
      // 就算每一拍的 code 都是滿刻度（|x_int| = 2^{B_x−1}），σ_S 也只有 √N·2^{B_x−1}：連這個上限都不夠當 dither 時，一定在 dead zone
      const ditherMax = (Math.sqrt(2 ** m) * 2 ** (bx - 1)) / 2 ** (m - FG)
      if (ditherMax < DITHER_MIN)
        return R`就算每一拍的 code 都是滿刻度，$\sigma_S\le\sqrt N\,2^{B_x-1}=${texNum(Math.sqrt(2 ** m) * 2 ** (bx - 1), 4)}$，$\sigma_S/2^\ell\le${texNum(ditherMax, 3)}<${DITHER_MIN}$：GMAC 的雜訊遠小於右移後的 1 個 LSB，迴路停在 dead zone 裡，F-04.11 的偏差預測不適用。請保留更多小數位元 $F_G$，或用更多位元的 code。`
      return null
    },
    solve: ({ S, m, FG, bx, K }) => {
      const ell = m - FG
      const d = 2 ** ell
      const ratio = S / d
      const qFloor = shiftRound(S, ell, 'floor')
      const qHalfUp = shiftRound(S, ell, 'half_up')
      const qZero = shiftRound(S, ell, 'toward_zero')
      const qEven = shiftRound(S, ell, 'half_even')
      const rho = S - qFloor * d
      const tie = 2 * rho === d
      const epsFloor = roundingMeanError(ell, 'floor')
      const fullScale = 2 ** (bx - 1)
      const deltaG = 2 ** -FG / fullScale
      const deltaStar = biasFixedPoint({ K, sigmaV: 1, roundErr: epsFloor * deltaG, pMin: 0 })
      // 對稱 uniform code 的 σ_S = √(N·M_x(M_x+1)/3)（與 gmac.ts 閉迴路模型的 analytic.ditherRatio 相同，handcalcs.test.tsx 比對）
      const Mx = accumulatorSizing(bx, 2 ** m, 'symmetric').maxAbsProduct
      const sigmaSUniform = Math.sqrt((2 ** m * Mx * (Mx + 1)) / 3)
      const ditherUniform = sigmaSUniform / d
      return {
        steps: [
          { tex: R`\ell=\log_2N-F_G=${ti(m)}-${ti(FG)}=${ti(ell)}`, why: '實際右移的位元數：完整的「$\\div N$」要右移 $\\log_2N$ bits，保留 $F_G$ 個小數位元就少移 $F_G$ bits。' },
          { tex: R`2^{\ell}=2^{${ti(ell)}}=${ti(d)}`, why: '右移 $\\ell$ bits 就是除以 $2^\\ell$：先把除數算出來（2 連乘 $\\ell$ 次）。' },
          { tex: R`\frac{S}{2^\ell}=\frac{${ti(S)}}{${ti(d)}}=${tex2(ratio)}`, why: '還沒取整的商；問題是除不盡的小數部分要怎麼處理。（除數是 2 的冪，所以小數一定除得盡，這裡完整列出。）' },
          {
            tex: R`Q_\mathrm{floor}=\Bigl\lfloor\frac{S}{2^\ell}\Bigr\rfloor=\lfloor${tex2(ratio)}\rfloor=${ti(qFloor)}`,
            why: 'floor = 朝 $-\\infty$ 的整數（負數時是「更負」的那個）：這就是二補數的算術右移。',
          },
          {
            tex: R`\rho=S-2^\ell\,Q_\mathrm{floor}=${ti(S)}-${ti(d)}\times${tip(qFloor)}=${ti(S)}-${tip(qFloor * d)}=${ti(rho)}`,
            why: '被算術右移丟掉的低 $\\ell$ bits：永遠是 $0\\le\\rho<2^\\ell$ 的非負餘數（即使 $S$ 是負的）。',
          },
          {
            tex: R`Q_\mathrm{half\,up}=\Bigl\lfloor\frac{S+2^{\ell-1}}{2^\ell}\Bigr\rfloor=\Bigl\lfloor\frac{${ti(S)}+${ti(d / 2)}}{${ti(d)}}\Bigr\rfloor=\Bigl\lfloor\frac{${ti(S + d / 2)}}{${ti(d)}}\Bigr\rfloor=\lfloor${tex2((S + d / 2) / d)}\rfloor=${ti(qHalfUp)}`,
            why: '先加半個 LSB 再 floor：餘數 $\\rho\\ge2^{\\ell-1}$ 就進位。',
          },
          {
            tex: R`Q_\mathrm{toward\,0}=\mathrm{sign}(S)\Bigl\lfloor\frac{|S|}{2^\ell}\Bigr\rfloor=${S < 0 ? '-' : ''}\lfloor${tex2(Math.abs(ratio))}\rfloor=${ti(qZero)}`,
            why: '直接把小數部分砍掉（sign-magnitude 截斷）：正數像 floor、負數像 ceil，兩邊都往 0 縮。',
          },
          {
            tex: R`Q_\mathrm{half\,even}=${ti(qEven)}`,
            why: tie
              ? R`$\rho=${ti(rho)}$ 恰好是 $2^{\ell}$ 的一半（tie）：在 $${ti(qFloor)}$ 和 $${ti(qFloor + 1)}$ 之間取「偶數」的那個。`
              : R`取最近的整數：$\rho=${ti(rho)}${2 * rho < d ? '<' : '>'}2^{\ell-1}=${ti(d / 2)}$，所以${2 * rho < d ? '捨去' : '進位'}。只有恰好一半時才看奇偶（取偶數）。`,
          },
          {
            tex: R`\varepsilon_\mathrm{floor}(S)=Q_\mathrm{floor}-\frac{S}{2^\ell}=${ti(qFloor)}-${tex2p(ratio)}=${tex2(qFloor - ratio)}=-\frac{${ti(rho)}}{${ti(d)}}`,
            why: '這一個 block 的 floor 誤差（單位：輸出 LSB）：永遠 $\\le0$，也就是 floor 永遠往下丟；它恰好是 $-\\rho/2^\\ell$（被丟掉的餘數）。',
          },
          {
            tex: R`\bar\varepsilon_\mathrm{floor}=-\frac{1-2^{-\ell}}{2}=-\frac{1-1/${ti(d)}}{2}=-\frac{${ti(d - 1)}/${ti(d)}}{2}=-\frac{${ti(d - 1)}}{${ti(2 * d)}}=${tex2(epsFloor)}`,
            why: '餘數 $\\rho$ 在 $0,\\dots,2^\\ell-1$ 均勻出現時的平均誤差（F-04.10）：大約少半個 LSB。用分數算最省事：$2^{-\\ell}=1/2^\\ell$，所以 $\\bar\\varepsilon=-(2^\\ell-1)/2^{\\ell+1}$，最後才做一次除法。',
          },
          {
            tex: R`\Delta_G=\frac{2^{-F_G}}{2^{B_x-1}}=\frac{2^{-${ti(FG)}}}{2^{${ti(bx - 1)}}}=\frac{1}{2^{${ti(FG + bx - 1)}}}=\frac{1}{${ti(2 ** (FG + bx - 1))}}=${tex2(deltaG)}`,
            why: '右移後 1 個 LSB 換成正規化 $G$ 的大小：$2^{-F_G}$ 個 code LSB，再除以 code 的 full scale $2^{B_x-1}$。指數相加：$2^{-F_G}/2^{B_x-1}=1/2^{F_G+B_x-1}$。',
          },
          {
            tex: R`\delta^*=-\frac{\bar\varepsilon\,\Delta_G}{K}=-\frac{${tex2p(epsFloor)}\times${tex2(deltaG)}}{${texNum(K)}}=-\frac{${texNum(epsFloor * deltaG, 6)}}{${texNum(K)}}=${texNum(deltaStar)}\,\mathrm{fs}`,
            why: '迴路要靠一個正的 $E[G]=K\\delta^*$ 去抵消 floor 平均丟掉的量：$K\\delta^*+\\bar\\varepsilon\\Delta_G=0$（F-04.11）。負負得正：$\\bar\\varepsilon<0\\Rightarrow\\delta^*>0$。',
          },
          { tex: R`w^*-a=-\delta^*=${texNum(-deltaStar)}\,\mathrm{fs}`, why: '$\\delta=a-w$，所以 $w$ 停在 $a$ 的下方。' },
        ],
        results: [
          { symbol: R`Q_\mathrm{floor}(S)`, label: 'floor（算術右移）的輸出', value: qFloor, unit: R`\text{LSB}`, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: R`Q_\mathrm{half\,even}(S)`, label: 'round-half-even 的輸出', value: qEven, unit: R`\text{LSB}`, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: R`\bar\varepsilon_\mathrm{floor}`, label: 'floor 的平均誤差', value: epsFloor, unit: R`\text{LSB}` },
          { symbol: R`\delta^*`, label: 'floor 造成的係數偏差 $a-w^*$', value: deltaStar, unit: R`\mathrm{fs}` },
        ],
        notes: [
          R`四種取整的輸出：floor $${ti(qFloor)}$、half-up $${ti(qHalfUp)}$、toward-0 $${ti(qZero)}$、half-even $${ti(qEven)}$。half-even 的平均誤差是 0，所以改用它偏差就消失；half-up 只剩 $2^{-\ell-1}=${texNum(1 / (2 * d))}$ LSB。`,
          '偏差和 $\\mu$ 無關（調小 $\\mu$ 救不了）；每多保留 2 個小數位元，$\\Delta_G$ 變 $1/4$，偏差約變成 $1/4$。',
          R`適用條件一：GMAC 的雜訊要夠當 dither（$\sigma_S/2^\ell\gtrsim${DITHER_MIN}$，$\sigma_S\approx\sqrt{N\,E[x_\mathrm{int}^2]}$）。以對稱 uniform code 估計：$\sigma_S=\sqrt{N\,M_x(M_x+1)/3}=${texNum(sigmaSUniform, 4)}$，$\sigma_S/2^\ell=${texNum(ditherUniform, 3)}$——${
            ditherUniform >= DITHER_MIN ? '夠' : R`不夠：這種 code 下迴路會停在 dead zone 裡（$\delta$ 落在 $0$ 到約 $\Delta_G/K$ 之間的某處，看 $w$ 從哪一邊接近），上面的 $\delta^*$ 不再是可靠的預測`
          }。適用條件二：$|\delta^*|\ll\sigma_v$（小訊號，$E[G]\approx K\delta$ 才成立）。`,
        ],
      }
    },
    tips: [
      '全部是 2 的冪與四則運算：$2^{-\\ell}$ 可以用 $1\\div2^\\ell$ 算；負數的 floor 要往更負的方向取（$\\lfloor-1.17\\rfloor=-2$）。half-even 只要比較餘數 $\\rho$ 和 $2^{\\ell-1}$：小於就捨去、大於就進位、相等才看奇偶。',
      '範例數字是 §5 表格 $F_G=2$ 那一列：$\\ell=8$、$\\Delta_G=0.0078125$、$K=0.0025765\\,\\mathrm{fs}^{-1}$（6-bit 對稱 uniform code、$\\sigma_v=100\\,\\mathrm{fs}$）$\\Rightarrow\\delta^*\\approx1.510\\,\\mathrm{fs}$。',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'HC-04.8',
    title: '綜合題：一條定點 GMAC datapath 從頭算到尾（增益、穩定、位元數、兩個截斷點）',
    page: '/ch/04',
    formulaId: 'F-04.18',
    formulaTex: R`E[x^2]=\frac{M_x(M_x+1)}{3\cdot4^{B_x-1}},\quad K=\frac{\sqrt{2/\pi}}{\sigma_v}E[x^2],\quad g=\mu K<g_\mathrm{crit}(d)=2\sin\frac{\pi}{4d+2};\qquad w^*-a=\frac{\bar\varepsilon\,\Delta_G}{K}+\frac{\bar\varepsilon_W\Delta_W}{g}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: R`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: R`\mathrm{fs}`, default: 100, min: 0, max: 10000, practice: { choices: [50, 100, 200] } },
      { key: 'mu', symbol: R`\mu`, label: '學習率（average 意義）', unit: R`\mathrm{fs}`, default: 10, min: 0, max: 1000, practice: { choices: [5, 10, 20] } },
      { key: 'bx', symbol: 'B_x', label: 'code 位元數（有號、對稱 uniform code）', unit: R`\text{bits}`, default: 6, min: 2, max: 12, integer: true, practice: { choices: [4, 6, 8] } },
      { key: 'm', symbol: R`\log_2N`, label: 'block 長度的指數（$N=2^{\\log_2N}$）', unit: R`\text{bits}`, default: 10, min: 1, max: 14, integer: true, practice: { choices: [8, 10] } },
      { key: 'FG', symbol: 'F_G', label: '「$\\div N$」保留的小數位元數（floor）', unit: R`\text{bits}`, default: 4, min: 0, max: 13, integer: true, practice: { choices: [3, 4, 5] } },
      { key: 'lW', symbol: R`\ell_W`, label: '「$\\times\\mu$」之後再右移的位元數（floor；$\\Delta_W=2^{\\ell_W}\\mu\\Delta_G$）', unit: R`\text{bits}`, default: 3, min: 0, max: 12, integer: true, practice: { choices: [1, 2, 3] } },
      { key: 'd', symbol: 'd', label: '更新延遲（block 結束到新 gain 生效）', unit: R`\text{blocks}`, default: 1, min: 0, max: 32, integer: true, practice: { choices: [0, 1, 2] } },
    ],
    validate: datapathInvalid,
    solve: (v) => {
      const { sigmaV, mu, bx, m, FG, lW, d } = v
      const { an, deltaW, gCrit } = datapathAnalytic(v)
      const N = 2 ** m
      const Mx = an.sizing.maxAbsProduct
      const ExInt2 = (Mx * (Mx + 1)) / 3
      const fs2 = 4 ** (bx - 1)
      const c0 = Math.sqrt(2 / Math.PI)
      const deg = 180 / (4 * d + 2)
      const epsG = an.deltaG > 0 ? an.meanRoundErr / an.deltaG : 0
      const epsW = an.meanIncErr / deltaW
      const twoL = 2 ** an.ell
      const R2 = 2 ** lW
      const total = an.biasPred
      return {
        steps: [
          { tex: R`M_x=2^{B_x-1}-1=${ti(2 ** (bx - 1))}-1=${ti(Mx)}`, why: '對稱範圍的最大 code（不含最負值）。' },
          {
            tex: R`E[x_\mathrm{int}^2]=\frac{M_x(M_x+1)}{3}=\frac{${ti(Mx)}\times${ti(Mx + 1)}}{3}=\frac{${ti(Mx * (Mx + 1))}}{3}=${texNum(ExInt2)}`,
            why: 'uniform code 在 $-M_x,\\dots,M_x$ 共 $2M_x+1$ 個值上的均方：$\\sum i^2=M_x(M_x+1)(2M_x+1)/3$，除以 $2M_x+1$。',
          },
          { tex: R`E[x^2]=\frac{E[x_\mathrm{int}^2]}{4^{B_x-1}}=\frac{${texNum(ExInt2)}}{${ti(fs2)}}=${texNum(an.Ex2)}`, why: '正規化 code $x=x_\\mathrm{int}/2^{B_x-1}$，平方後除以 $4^{B_x-1}$。接近連續均勻分布的 $1/3$。' },
          { tex: R`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(c0)}}{${texNum(sigmaV)}}=${texNum(an.Kq)}\,\mathrm{fs}^{-1}`, why: '$\\sqrt{2/\\pi}=0.79788$（$2\\div\\pi$ 再開根號）。' },
          { tex: R`K=K_q\,E[x^2]=${texNum(an.Kq)}\times${texNum(an.Ex2)}=${texNum(an.K)}\,\mathrm{fs}^{-1}`, why: 'identity path、$x_\\mathrm{ref}=x$：$C=E[x^2]$。' },
          { tex: R`g=\mu K=${texNum(mu)}\times${texNum(an.K)}=${texNum(an.g)}`, why: 'average 模式的無因次 loop gain（$\\mathrm{fs}\\times\\mathrm{fs}^{-1}$）。' },
          { tex: R`p=1-g=1-${texNum(an.g)}=${tdp(an.pole, dpOf(an.g))}`, why: '一階平均模型的 pole：平均誤差每個 block 乘上 $p$。' },
          {
            tex: R`g_\mathrm{crit}=2\sin\frac{\pi}{4d+2}=2\sin\frac{180^\circ}{${ti(4 * d + 2)}}=2\sin${texNum(deg)}^\circ=2\times${texNum(Math.sin(Math.PI / (4 * d + 2)))}=${texNum(gCrit)}`,
            why: R`更新延遲 $d$ 個 block 時平均模型的穩定上限（F-04.14）。計算機切到 DEG 模式；$d=0$ 是 $\sin90^\circ=1$、$d=1$ 是 $\sin30^\circ=0.5$；$d\ge3$ 時可用 $\sin\theta\approx\theta$（弧度，誤差 $<1\%$）。這裡 $g/g_\mathrm{crit}=${texNum(an.g / gCrit, 3)}$，離不穩定還很遠。`,
          },
          { tex: R`B_\mathrm{acc}=B_x+\log_2N=${ti(bx)}+${ti(m)}=${ti(an.sizing.bitsExact)}`, why: '對稱 code 且 $N=2^m$ 時 F-04.9 化簡成這個式子（含最負 code 要再 $+1$）。' },
          { tex: R`\ell=\log_2N-F_G=${ti(m)}-${ti(FG)}=${ti(an.ell)}`, why: '第一個截斷點：「$\\div N$」實際右移 $\\ell$ bits（保留 $F_G$ 個小數位元）。' },
          {
            tex: R`\Delta_G=\frac{2^{-F_G}}{2^{B_x-1}}=\frac{2^{-${ti(FG)}}}{2^{${ti(bx - 1)}}}=\frac{1}{2^{${ti(FG + bx - 1)}}}=\frac{1}{${ti(2 ** (FG + bx - 1))}}=${tex2(an.deltaG)}`,
            why: '右移後 1 個 LSB 換成正規化 $G$ 的大小：$2^{-F_G}$ 個 code LSB 除以 code 的 full scale $2^{B_x-1}$（指數相加）。',
          },
          {
            tex: R`\bar\varepsilon=-\frac{1-2^{-\ell}}{2}=-\frac{1-1/${ti(twoL)}}{2}=-\frac{${ti(twoL - 1)}/${ti(twoL)}}{2}=-\frac{${ti(twoL - 1)}}{${ti(2 * twoL)}}=${tex2(epsG)}`,
            why: 'floor 的平均誤差（單位 $\\Delta_G$，F-04.10）。用分數算：$2^{-\\ell}=1/2^\\ell$，最後才做一次除法。',
          },
          {
            tex: R`(w^*-a)_{\div N}=\frac{\bar\varepsilon\,\Delta_G}{K}=\frac{${tex2p(epsG)}\times${tex2(an.deltaG)}}{${texNum(an.K)}}=\frac{${texNum(an.meanRoundErr, 6)}}{${texNum(an.K)}}=${texNum(an.biasPredRound)}\,\mathrm{fs}`,
            why: 'F-04.11：和 $\\mu$ 無關。',
          },
          {
            tex: R`R=2^{\ell_W}=2^{${ti(lW)}}=${ti(R2)}`,
            why: '第二個截斷點：更新量 $\\mu G$ 的格點是 $\\mu\\Delta_G$，再右移 $\\ell_W$ bits 才加進 $W$，所以 $W$ 的 LSB 比更新量的格點粗 $R=2^{\\ell_W}$ 倍。',
          },
          {
            tex: R`\Delta_W=R\,\mu\,\Delta_G=${ti(R2)}\times${texNum(mu)}\times${tex2(an.deltaG)}=${texNum(R2 * mu)}\times${tex2(an.deltaG)}=${tex2(deltaW)}\,\mathrm{fs}`,
            why: '$W$ 的 LSB（單位 fs）：F-04.18 裡的 $\\Delta_W$。',
          },
          {
            tex: R`\bar\varepsilon_W=-\frac{1-1/R}{2}=-\frac{1-1/${ti(R2)}}{2}=-\frac{${ti(R2 - 1)}/${ti(R2)}}{2}=-\frac{${ti(R2 - 1)}}{${ti(2 * R2)}}=${tex2(epsW)}`,
            why: '這次 floor 的平均誤差（單位 $\\Delta_W$）；$R=1$ 時沒有東西被丟掉。',
          },
          {
            tex: R`(w^*-a)_W=\frac{\bar\varepsilon_W\,\Delta_W}{g}=\frac{${tex2p(epsW)}\times${tex2(deltaW)}}{${texNum(an.g)}}=\frac{${texNum(an.meanIncErr, 6)}}{${texNum(an.g)}}=${texNum(an.biasPredW)}\,\mathrm{fs}`,
            why: 'F-04.18：除的是 $g$ 而不是 $K$。$\\Delta_W$ 是固定的硬體格點時，$\\mu$（也就是 $g$）越小這一項越大。',
          },
          {
            tex: R`w^*-a=(w^*-a)_{\div N}+(w^*-a)_W=${texNum(an.biasPredRound)}+${texNumP(an.biasPredW)}=${tdp(total, sumDp([an.biasPredRound, an.biasPredW]))}\,\mathrm{fs}`,
            why: '兩個截斷點的偏差相加（小訊號下可疊加）。',
          },
        ],
        results: [
          { symbol: 'K', label: 'GMAC 的平均斜率', value: an.K, unit: R`\mathrm{fs}^{-1}` },
          { symbol: 'g', label: 'loop gain', value: an.g },
          { symbol: R`g_\mathrm{crit}`, label: '延遲 $d$ 時的臨界 loop gain', value: gCrit },
          { symbol: R`B_\mathrm{acc}`, label: 'GMAC 累加器位元數', value: an.sizing.bitsExact, unit: R`\text{bits}`, tolerance: { abs: 1e-9, rel: 0 } },
          { symbol: R`(w^*-a)_{\div N}`, label: '「$\\div N$」floor 的偏差', value: an.biasPredRound, unit: R`\mathrm{fs}`, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: R`(w^*-a)_W`, label: '「$\\mu G\\to W$」floor 的偏差', value: an.biasPredW, unit: R`\mathrm{fs}`, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: 'w^*-a', label: '兩個截斷點合計的偏差', value: total, unit: R`\mathrm{fs}`, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes: [
          R`驗算：兩次 floor 等於一次右移 $\ell+\ell_W$ bits，所以合計應該等於 $-\dfrac{(1-2^{-(\ell+\ell_W)})\,\Delta_W}{2g}=${texNum((-(1 - 2 ** -(an.ell + lW)) * deltaW) / (2 * an.g))}\,\mathrm{fs}$。`,
          R`對照穩態抖動 $\sigma_w=\mu\sqrt{\dfrac{E[x^2]/N}{1-p^2}}=${texNum(an.sigmaWPred, 4)}\,\mathrm{fs}$（$N=${ti(N)}$）：偏差${Math.abs(total) > an.sigmaWPred ? '比抖動還大，值得改用 half-even 或多留小數位元' : '小於抖動'}。`,
          R`適用條件（本題已檢查）：$g<g_\mathrm{crit}$；$\sigma_S/2^\ell=${texNum(an.ditherRatio, 3)}\ge${DITHER_MIN}$${lW > 0 ? R`、$\mu\sigma_G/\Delta_W=${texNum(an.ditherRatioW, 3)}\ge${DITHER_MIN}$` : ''}（雜訊夠當 dither）；$|w^*-a|<0.2\,\sigma_v$（小訊號）。`,
        ],
      }
    },
    tips: [
      '需要計算機的只有兩步：$\\sqrt{2/\\pi}=0.79788$ 與 $\\sin$（DEG 模式）；其餘是 2 的冪與四則運算。建議把每一步的結果抄在紙上，後面會一直用到 $K$、$g$、$\\Delta_G$。',
      '範例數字是 §5.6「第二個截斷點」的例子（6-bit code、$N=1024$、$F_G=4$、$\\ell_W=3$）：$K=0.0025765\\,\\mathrm{fs}^{-1}$、$g=0.025765$、$\\Delta_W=0.15625\\,\\mathrm{fs}$、$(w^*-a)_W=-2.653\\,\\mathrm{fs}$；「$\\div N$」也用 floor 時再加 $-0.373\\,\\mathrm{fs}$。',
      '思考題 6 的情境是「$\\Delta_W$ 不變、$\\mu$ 減半」：在本題要同時把 $\\mu$ 改成 $5$、$\\ell_W$ 改成 $4$（$\\Delta_W=2^{\\ell_W}\\mu\\Delta_G$ 才會不變）。再算一次：$(w^*-a)_{\\div N}$ 不變，$(w^*-a)_W$ 由 $-2.653$ 變成 $-5.685\\,\\mathrm{fs}$。',
      ROUNDING_TIP,
    ],
  },
]

export function handcalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到手算題 ${id}`)
  return def
}
