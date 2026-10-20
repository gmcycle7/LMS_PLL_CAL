import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { cppll3InversionEdge, cppll3Loop, cppll3MinusReL, pmuxClosedFormEigen, pmuxUniformStepLimits } from '@/simulation/models/unifiedLab'
import { cppll3Numbers } from './numbers'

/**
 * /lab 的「帶入手算」題（wave 5；docs/teaching-style.md §7）。
 *  - HC-LAB.1（§5b.2）：8 相 PMUX + GOS 的 9 個權重——H_PD = 1、8 相等機率、x 與相位獨立時資訊矩陣的封閉式特徵值 ⇒ 條件數、共用步長的 μ 上限、最慢模式的時間常數。
 *  - HC-LAB.2（§5b.3）：三階 CPPLL 的反號帶——由 PM 與第三極點比算出 K、ω_z、ω_p，再在一個測試頻率算 −Re L 的兩項，判斷 Re H_PD 的正負；帶緣 f_inv 由二分法求根。
 * solve() 的數值一律呼叫 unifiedLab.ts 的函式（pmuxClosedFormEigen、pmuxUniformStepLimits、cppll3Loop、cppll3MinusReL、cppll3InversionEdge）；
 * 每一步只做一種運算，畫面上的數字代得出下一步。handcalcs.test.tsx 逐題與獨立重算（9×9 矩陣的 eigSym、L(z) 的複數直接求值）比對。
 */

const r = String.raw
const PAGE = '/lab'
const n = (x: number, sig = 6): string => texNum(x, sig)
const np = (x: number, sig = 6): string => texNumP(x, sig)
const ni = (x: number): string => texNum(x, 10)

/** HC-LAB.1 的預設：§5b.2 的例子（x ~ U[0,1)：E[x] = 1/2、E[x²] = 1/3；σ_v = 100 fs、μ = 10 fs），與 numbers.ts 的 pmuxNumbers 相同 */
export const HC_PMUX_DEFAULT = { Ex: 0.5, Ex2: 1 / 3, sigmaV: 100, mu: 10 } as const

/** HC-LAB.2 的預設：§5b.3 的設計（|T| 的 −3 dB = 320 MHz、PM 60°、r_p = 4、f_ref = 4 GHz；f_c 取 4 位有效數字）與測試頻率 100 MHz */
const CP = cppll3Numbers()
export const HC_CPPLL_DEFAULT = { fcMHz: Number((CP.c.fcCtHz / 1e6).toPrecision(4)), pmDeg: CP.pmDeg, p3Ratio: CP.p3Ratio, fRefMHz: CP.fRefHz / 1e6, fTestMHz: CP.fTestHz / 1e6 } as const

export const HANDCALCS: HandCalcDef[] = [
  {
    id: 'HC-LAB.1',
    title: '9 個權重的條件數、共用步長的 μ 上限與最慢模式',
    page: PAGE,
    formulaId: 'F-LAB.20',
    formulaTex: r`\begin{aligned}
\lambda_\pm&=\frac{\tfrac18+E[x^2]}{2}\pm\sqrt{\Bigl(\frac{\tfrac18-E[x^2]}{2}\Bigr)^2+\frac{E[x]^2}{8}},\qquad \kappa=\frac{\lambda_{\max}}{\lambda_{\min}}\\
\mu_{\max}&=\frac{2}{K_q\lambda_{\max}},\qquad \tau_{\mathrm{slow}}=\frac{1}{\mu K_q\lambda_{\min}}
\end{aligned}`,
    level: 'engineer',
    // 特徵值與條件數（λ±、κ）對給定的 R 是精確的矩陣代數；但 K_q = √(2/π)/σ_v 是小訊號線性化、τ_slow = 1/(μK_qλ_min) 是 g ≪ 1 的近似 ⇒ 整題標近似
    claim: 'approx',
    inputs: [
      { key: 'Ex', symbol: 'E[x]', label: 'DTC code 的平均（$x\\sim U[0,1)$ 時 $1/2$）', default: HC_PMUX_DEFAULT.Ex, min: 0, max: 1, practice: { choices: [0.25, 0.4, 0.5, 0.6] } },
      { key: 'Ex2', symbol: 'E[x^2]', label: 'DTC code 的均方（$x\\sim U[0,1)$ 時 $1/3$）', default: HC_PMUX_DEFAULT.Ex2, min: 0.01, max: 1, practice: { choices: [0.4, 0.45, 0.5, 0.6] } },
      { key: 'sigmaV', symbol: '\\sigma_v', label: 'comparator 前雜訊', unit: '\\mathrm{fs}', default: HC_PMUX_DEFAULT.sigmaV, min: 1, max: 10000, practice: { choices: [50, 100, 200, 400] } },
      { key: 'mu', symbol: '\\mu', label: '9 個權重共用的 learning rate', unit: '\\mathrm{fs}', default: HC_PMUX_DEFAULT.mu, min: 0.01, max: 10000, practice: { choices: [5, 10, 20, 40] } },
    ],
    validate: (v) => (v.Ex2 < v.Ex * v.Ex ? '$E[x^2]$ 不可小於 $E[x]^2$（變異數 $E[x^2]-E[x]^2$ 會是負的）' : null),
    solve: (v) => {
      const { Ex, Ex2, sigmaV, mu } = v
      const cf = pmuxClosedFormEigen(Ex, Ex2)
      const Kq = Math.sqrt(2 / Math.PI) / sigmaV
      const lim = pmuxUniformStepLimits(Kq, cf.lambdaMax, cf.lambdaMin, mu)
      const a = 1 / 8
      const h = (a + Ex2) / 2
      const dh = (a - Ex2) / 2
      const rad = Math.sqrt(dh * dh + cf.b * cf.b)
      return {
        steps: [
          { tex: r`b=\frac{E[x]}{\sqrt8}=\frac{${ni(Ex)}}{${n(Math.sqrt(8))}}=${n(cf.b)}`, why: '共模方向（8 個 one-hot 一起動，單位向量 $\\mathbf 1/\\sqrt8$）與 $x$ 的耦合：$\\sum_p\\frac{1}{\\sqrt8}\\cdot\\frac{E[x]}{8}=E[x]/\\sqrt8$。' },
          { tex: r`\lambda_{\mathrm{PHOS}}=\tfrac18=${n(a)}`, why: '7 個「和為 0」的 PHOS 模式和 $x$ 無關（$\\mathbf 1^{\\mathsf T}\\mathbf v=0$ 時與 $x$ 的耦合相消），各自的特徵值就是 one-hot 的能量 $1/8$。' },
          { tex: r`h=\frac{\tfrac18+E[x^2]}{2}=\frac{${n(a)}+${ni(Ex2)}}{2}=${n(h)}`, why: '剩下的 2×2 區塊是 $\\begin{bmatrix}1/8&b\\\\b&E[x^2]\\end{bmatrix}$：先算對角線的平均。' },
          { tex: r`\Delta h=\frac{\tfrac18-E[x^2]}{2}=\frac{${n(a)}-${ni(Ex2)}}{2}=${n(dh)}`, why: '對角線的差的一半。' },
          { tex: r`r_\lambda=\sqrt{\Delta h^2+b^2}=\sqrt{${np(dh)}^2+${np(cf.b)}^2}=${n(rad)}`, why: '2×2 對稱矩陣的特徵值是「平均 ± 半徑」，半徑是 $\\Delta h$ 與耦合 $b$ 的平方和開根號。' },
          { tex: r`\lambda_+=h+r_\lambda=${n(h)}+${n(rad)}=${n(cf.lambdaPlus)}`, why: '「共模 + GOS」同向的混合模式，主要是 $x$ 的能量。' },
          { tex: r`\lambda_-=h-r_\lambda=${n(h)}-${n(rad)}=${n(cf.lambdaMinus)}`, why: '共模與 $x$ 幾乎抵消的方向：PHOS 全部加一個常數、GOS 減一點，PD 幾乎看不出來。' },
          { tex: r`\lambda_{\max}=\max\bigl(\lambda_+,\tfrac18\bigr)=${n(cf.lambdaMax)},\qquad \lambda_{\min}=\min\bigl(\lambda_-,\tfrac18\bigr)=${n(cf.lambdaMin)}`, why: '9 個特徵值是 $\\lambda_+$、$\\lambda_-$ 與 7 個 $1/8$，挑出最大與最小。' },
          { tex: r`\kappa=\frac{\lambda_{\max}}{\lambda_{\min}}=\frac{${n(cf.lambdaMax)}}{${n(cf.lambdaMin)}}=${n(cf.cond)}`, why: '條件數 = 最快模式與最慢模式的能量比；$H_{\\mathrm{PD}}=1$ 時共模可觀測，9 個模式都算進去（有主 PLL 時共模被濾掉，$\\kappa$ 改看剩下的 8 個）。' },
          { tex: r`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${n(Math.sqrt(2 / Math.PI))}}{${ni(sigmaV)}}=${n(Kq)}\ \mathrm{fs}^{-1}`, why: 'comparator 的小訊號增益（F-LAB.5）：$|e|\\ll\\sigma_v$ 的線性化（近似）；上面的特徵值與條件數只是矩陣代數（精確），從這一步起才進入近似。' },
          { tex: r`\mu_{\max}=\frac{2}{K_q\lambda_{\max}}=\frac{2}{${n(Kq)}\times${n(cf.lambdaMax)}}=${n(lim.muMax)}\ \mathrm{fs}`, why: '所有權重共用一個 $\\mu$ 時，每個模式的 pole 是 $1-\\mu K_q\\lambda_i$；最快的模式先碰到 $-1$。' },
          { tex: r`\tau_{\mathrm{slow}}=\frac{1}{\mu K_q\lambda_{\min}}=\frac{1}{${ni(mu)}\times${n(Kq)}\times${n(cf.lambdaMin)}}=${n(lim.tauSlowBlocks)}\ \text{blocks}`, why: '最慢模式的時間常數：pole $1-g$ 的精確值是 $-1/\\ln(1-g)$，$g\\ll1$ 時 $\\approx1/g$（近似）；同一個 $\\mu$ 下最快模式只要 $\\tau_{\\mathrm{slow}}/\\kappa$ 個 block。' },
        ],
        results: [
          { symbol: '\\kappa', label: '條件數', value: cf.cond },
          { symbol: '\\mu_{\\max}', label: '共用步長的上限', value: lim.muMax, unit: '\\mathrm{fs}' },
          { symbol: '\\tau_{\\mathrm{slow}}', label: '最慢模式的時間常數', value: lim.tauSlowBlocks, unit: '\\text{blocks}' },
        ],
        notes: [
          `$\\mu=${ni(mu)}\\,\\mathrm{fs}$ 時最快模式 $g_{\\max}=\\mu K_q\\lambda_{\\max}=${n(mu * Kq * cf.lambdaMax)}$、單一 PHOS 模式 $g_p=\\mu K_q/8=${n((mu * Kq) / 8)}$；$\\mu$ 只要小於 $\\mu_{\\max}$ 就全部收斂，但最慢的模式要 $\\kappa$ 倍的時間。`,
          '這是 $H_{\\mathrm{PD}}=1$（none 路徑）、8 相等機率走訪、$x$ 與相位獨立的封閉式；有主 PLL 時 Lab 用實際的 code 序列算 $R_u$ 與 $J$，共模方向不可觀測（E04），條件數只看剩下的 8 個模式。',
          '哪些步驟是精確的：$b$、$\\lambda_\\pm$、$\\kappa$ 對這個 $R$ 是精確的矩陣代數；$K_q$ 是 Gaussian comparator 的小訊號線性化（$|e|\\ll\\sigma_v$），$\\mu_{\\max}$ 與 $\\tau_{\\mathrm{slow}}$ 建立在它之上，$\\tau_{\\mathrm{slow}}=1/g$ 又再用了 $g\\ll1$——所以整題標「近似」。',
        ],
      }
    },
    tips: [
      '$\\sqrt8=2.8284$、$\\sqrt{2/\\pi}=0.79788$；2×2 對稱矩陣 $\\begin{bmatrix}a&b\\\\b&d\\end{bmatrix}$ 的特徵值是 $\\frac{a+d}{2}\\pm\\sqrt{(\\frac{a-d}{2})^2+b^2}$。',
      '$\\kappa$ 很大時先想 preconditioning（第 10 章）：PHOS 與 GOS 各用自己的步長（Lab 的 $\\mu_p$ 與 $\\mu$）就是最簡單的 diagonal 版本。',
    ],
  },
  {
    id: 'HC-LAB.2',
    title: '三階 CPPLL 的反號帶：在一個頻率判斷 Re H_PD 的正負',
    page: PAGE,
    formulaId: 'F-LAB.21',
    formulaTex: r`\begin{aligned}
-\mathrm{Re}\,L(\Omega)&=\frac{K}{4\sin^2(\Omega/2)}+\frac{B(1-p^2)}{2\bigl(1-2p\cos\Omega+p^2\bigr)}\\
\mathrm{Re}\,H_{\mathrm{PD}}&<0\iff-\mathrm{Re}\,L>1
\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'fc', symbol: 'f_c', label: '連續時間 crossover', unit: '\\mathrm{MHz}', default: HC_CPPLL_DEFAULT.fcMHz, min: 0.01, max: 1000, practice: { choices: [50, 100, 150, 200] } },
      { key: 'pm', symbol: '\\mathrm{PM}', label: 'crossover 處的 phase margin', unit: '^\\circ', default: HC_CPPLL_DEFAULT.pmDeg, min: 20, max: 85, practice: { choices: [45, 55, 60, 70] } },
      { key: 'rp', symbol: 'r_p', label: '第三極點比 $\\omega_{p3}/\\omega_c$', default: HC_CPPLL_DEFAULT.p3Ratio, min: 1.5, max: 50, practice: { choices: [3, 4, 6, 8] } },
      { key: 'fref', symbol: 'f_{\\mathrm{ref}}', label: 'reference 頻率', unit: '\\mathrm{MHz}', default: HC_CPPLL_DEFAULT.fRefMHz, min: 10, max: 20000, practice: { choices: [1000, 2000, 4000] } },
      { key: 'ftest', symbol: 'f', label: '要判斷的頻率（例如 PMUX 的旋轉頻率 $\\alpha f_{\\mathrm{ref}}$）', unit: '\\mathrm{MHz}', default: HC_CPPLL_DEFAULT.fTestMHz, min: 0.001, max: 10000, practice: { choices: [20, 50, 100, 300] } },
    ],
    validate: (v) =>
      v.pm + (Math.atan(1 / v.rp) * 180) / Math.PI >= 89.5
        ? '$\\mathrm{PM}+\\arctan(1/r_p)$ 必須小於 $90^\\circ$，零點才解得出來（PM 太大或第三極點太靠近 crossover）'
        : v.ftest >= v.fref / 2
          ? '$f$ 必須小於 $f_{\\mathrm{ref}}/2$（取樣後的頻率軸只到 Nyquist）'
          : v.fc >= v.fref / 4
            ? '$f_c$ 要遠小於 $f_{\\mathrm{ref}}$（$f_c<f_{\\mathrm{ref}}/4$；impulse-invariant 的連續時間設計才有意義）'
            : null,
    solve: (v) => {
      const { fc, pm, rp, fref, ftest } = v
      const wc = (2 * Math.PI * fc) / fref
      const { design: d } = cppll3Loop(wc, pm, rp, 0)
      const atanDeg = (Math.atan(1 / rp) * 180) / Math.PI
      const thetaZ = (pm * Math.PI) / 180 + Math.atan(1 / rp)
      const W = (2 * Math.PI * ftest) / fref
      const t = cppll3MinusReL(d, ftest / fref)
      const fInv = cppll3InversionEdge(d) * fref
      const inverted = t.total > 1
      const sin2 = Math.sin(W / 2) ** 2
      const den = 1 - 2 * d.p * Math.cos(W) + d.p * d.p
      return {
        steps: [
          { tex: r`\theta_z=\mathrm{PM}+\arctan\frac1{r_p}=${ni(pm)}^\circ+${n(atanDeg)}^\circ=${n((thetaZ * 180) / Math.PI)}^\circ`, why: '零點的放置：$\\mathrm{PM}=\\arctan(\\omega_c/\\omega_z)-\\arctan(\\omega_c/\\omega_p)$，把 $\\omega_p=r_p\\omega_c$ 代進去移項；計算機按 $\\tan^{-1}(1/r_p)$（度）。' },
          { tex: r`\omega_c=\frac{2\pi f_c}{f_{\mathrm{ref}}}=\frac{2\pi\times${ni(fc)}}{${ni(fref)}}=${n(wc)}\ \mathrm{rad/sample}`, why: '以 $T_s=1/f_{\\mathrm{ref}}$ 為時間單位，連續時間頻率變成每拍的弧度。' },
          { tex: r`\omega_z=\frac{\omega_c}{\tan\theta_z}=\frac{${n(wc)}}{${n(Math.tan(thetaZ))}}=${n(d.wz)}`, why: '零點在 crossover 下方（rad/sample）。' },
          { tex: r`\omega_p=r_p\,\omega_c=${ni(rp)}\times${n(wc)}=${n(d.wp)}`, why: '第三極點在 crossover 上方（rad/sample）。' },
          { tex: r`K=\omega_c^2\sqrt{1+\tfrac1{r_p^2}}\,\cos\theta_z=${n(wc)}^2\times${n(Math.sqrt(1 + 1 / (rp * rp)))}\times${n(Math.cos(thetaZ))}=${n(d.K)}`, why: '由 $|L(j\\omega_c)|=1$ 解出：$|L|=K\\sqrt{1+(\\omega_c/\\omega_z)^2}/(\\omega_c^2\\sqrt{1+(\\omega_c/\\omega_p)^2})$，而 $\\sqrt{1+\\tan^2\\theta_z}=1/\\cos\\theta_z$。' },
          { tex: r`B=\frac{K(\omega_p/\omega_z-1)}{\omega_p}=\frac{${n(d.K)}\times(${n(d.wp / d.wz)}-1)}{${n(d.wp)}}=${n(d.B)}`, why: 'impulse-invariant：$l(t)=Kt+B(1-e^{-\\omega_pt})$ 的第二個係數（零點與第三極點那一對）。' },
          { tex: r`p=e^{-\omega_p}=e^{-${n(d.wp)}}=${n(d.p)}`, why: '第三極點在 $z$ 平面的位置。' },
          { tex: r`\begin{aligned}\Omega&=\frac{2\pi f}{f_{\mathrm{ref}}}\\&=\frac{2\pi\times${ni(ftest)}}{${ni(fref)}}=${n(W)}\end{aligned}`, why: '把要判斷的頻率換成每拍的弧度。' },
          { tex: r`\sin^2\frac\Omega2=\sin^2(${n(W / 2)})=${n(sin2)}`, why: '第一項的分母（計算機用弳度）。' },
          { tex: r`D=1-2p\cos\Omega+p^2=1-2\times${n(d.p)}\times${np(Math.cos(W))}+${np(d.p)}^2=${n(den)}`, why: '$|1-pe^{-j\\Omega}|^2$ 展開：第二項的分母。' },
          { tex: r`\frac{K}{4\sin^2(\Omega/2)}=\frac{${n(d.K)}}{4\times${n(sin2)}}=${n(t.term1)}`, why: '雙積分器 $Kz^{-1}/(1-z^{-1})^2$ 的實部恰為 $-K/(4\\sin^2(\\Omega/2))$，低頻時它主導。' },
          { tex: r`\frac{B(1-p^2)}{2D}=\frac{${n(d.B)}\times${n(1 - d.p * d.p)}}{2\times${n(den)}}=${n(t.term2)}`, why: '$Bz^{-1}/(1-z^{-1})$ 的實部是常數 $-B/2$，和第三項 $-Bpz^{-1}/(1-pz^{-1})$ 的實部合併成這一項。' },
          { tex: r`-\mathrm{Re}\,L=${n(t.term1)}+${n(t.term2)}=${n(t.total)}`, why: '兩項相加。' },
          {
            tex: inverted ? r`-\mathrm{Re}\,L=${n(t.total)}>1\ \Rightarrow\ \mathrm{Re}\,H_{\mathrm{PD}}=\frac{1+\mathrm{Re}\,L}{|1+L|^2}<0` : r`-\mathrm{Re}\,L=${n(t.total)}<1\ \Rightarrow\ \mathrm{Re}\,H_{\mathrm{PD}}=\frac{1+\mathrm{Re}\,L}{|1+L|^2}>0`,
            why: inverted ? '這個頻率在反號帶內：regressor 的功率落在這裡時相關 $C$ 變負、sign-LMS 往反方向走（案例頁 §6）。' : '這個頻率在反號帶外：負回授方向正確。',
          },
        ],
        results: [
          { symbol: '-\\mathrm{Re}\\,L(f)', label: '測試頻率的 $-\\mathrm{Re}\\,L$（大於 1 即反號）', value: t.total },
          { symbol: 'f_{\\mathrm{inv}}', label: '反號帶上緣（$-\\mathrm{Re}\\,L=1$ 的根，二分法）', value: fInv, unit: '\\mathrm{MHz}', digits: 5, tolerance: { rel: 0.02 } },
        ],
        notes: [
          `反號帶是 $[0,\\,${n(fInv, 5)}]\\,\\mathrm{MHz}$：$-\\mathrm{Re}\\,L$ 對頻率單調遞減，帶緣是 $-\\mathrm{Re}\\,L=1$ 的唯一根（Lab 用二分法；紙筆上可以在幾個頻率各算一次把它夾住）。`,
          '8 相 PMUX 的 PHOS mode-1 regressor 以 $\\alpha f_{\\mathrm{ref}}$ 旋轉：$\\alpha f_{\\mathrm{ref}}$（折回 $[0,f_{\\mathrm{ref}}/2]$）落在這一帶，PHOS 就反號——這就是案例頁 §8 的結論。',
          `這組設計的 sampled-data crossover 與 PM 由 Lab 另外用 loopMargins 算（和連續時間的 $${ni(pm)}^\\circ$ 不完全相同，差別來自取樣的一拍延遲）。`,
        ],
      }
    },
    tips: [
      '$r_p=4$、$\\mathrm{PM}=60^\\circ$ 時：$\\arctan(1/4)=14.036^\\circ$、$\\tan74.036^\\circ=3.4958$、$\\cos74.036^\\circ=0.27503$。',
      '$f=100\\,\\mathrm{MHz}$、$f_{\\mathrm{ref}}=4000\\,\\mathrm{MHz}$ 時 $\\Omega=0.15708$、$\\sin^2(\\Omega/2)=0.0061558$。',
    ],
  },
]
