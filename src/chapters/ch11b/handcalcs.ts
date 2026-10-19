import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import {
  MASH_CODE_AUTOCORR,
  MASH_CODE_FIR,
  UNIFORM_KAPPA4,
  eig2,
  foldedPsdDc,
  foldedPsdDcLinearProcess,
  hankelFromMoments,
  inbandPower,
  kqFromSigma,
  linearProcessSquaredVariance,
  lutApproxRms,
  lutClosedForm,
  modeAnalysis,
  segmentClosedForm,
  uniformResidualAfterGain,
} from '@/simulation/models/dtcInl'

/**
 * Ch11b 的「帶入手算」題（docs/teaching-style.md §7）。
 *  1. 每一題的答案都由 src/simulation/models/dtcInl.ts 的函式計算（foldedPsdDc、foldedPsdDcLinearProcess、segmentClosedForm、
 *     lutClosedForm、modeAnalysis／eig2、lutApproxRms、uniformResidualAfterGain）；步驟裡的中間數字只是把這些量用四則運算串起來
 *     （handcalcs.test.tsx 逐題與獨立重算、golden vectors 比對）。
 *  2. 預設值 = 本章的 worked example：d_2 = 20 fs、f_B/f_s = 1/100；K = 8、J = 64、μ = 2 fs、σ_v = 10 fs、N = 64；uniform 的動差 1/3、1/5、1/7。
 *  3. 所有晶片數字都是 illustrative（示例），不是任何晶片的量測值。
 */

const PAGE = '/ch/11b'
const FS = String.raw`\mathrm{fs}`
const FS2 = String.raw`\mathrm{fs}^2`
/** 中間量顯示 6 位，答案 5 位（與 Ch11 相同的理由：讀者照畫面數字再乘一次，末位才不會差 1） */
const MID = 6
const LN005 = Math.log(0.05)

const chop = (x: number, scale = 1) => (Math.abs(x) <= 1e-12 * Math.max(1, Math.abs(scale)) ? 0 : x)

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── HC-11B.1：噪聲折返的帶內 rms（§11b.2） ───────────── */
  {
    id: 'HC-11B.1',
    title: '二次 INL 把 MASH 的高頻量化雜訊折回帶內：帶內 rms 是多少？',
    page: PAGE,
    formulaId: 'F-11B.5',
    formulaTex: String.raw`S_2(0)=2\sum_mR_x[m]^2+\kappa_4\Big(\sum_kh_k^2\Big)^2,\qquad P_\mathrm{in}=d_2^2\,S_2(0)\cdot2\frac{f_B}{f_s},\qquad \sigma_{t,\mathrm{in}}=\sqrt{P_\mathrm{in}}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'd2', symbol: 'd_2', label: '二次 INL 係數（x = ±1 處的峰值）', unit: FS, default: 20, min: 0, max: 1000, practice: { choices: [5, 10, 20, 40, 50] } },
      { key: 'fB', symbol: 'f_B', label: '帶寬（例如 PLL 的閉迴路頻寬）', unit: String.raw`\mathrm{MHz}`, default: 1, min: 0.001, max: 1e4, practice: { choices: [0.5, 1, 2, 4] } },
      { key: 'fs', symbol: 'f_s', label: '取樣率（= reference 頻率）', unit: String.raw`\mathrm{MHz}`, default: 100, min: 0.01, max: 1e5, practice: { choices: [50, 100, 200, 400] } },
    ],
    validate: ({ fB, fs }) => (fB >= fs / 2 ? '$f_B$ 必須小於 $f_s/2$：帶寬不可能超過 Nyquist。' : fB / fs > 0.1 ? '$f_B/f_s>0.1$：折返後的 PSD 在這麼寬的帶內已不平坦，$P_\\mathrm{in}=S(0)\\cdot2\\nu_B$ 的近似不適用（請用實驗 A 的 Welch 積分）。' : null),
    solve: ({ d2, fB, fs }) => {
      const R = MASH_CODE_AUTOCORR
      const sumR2 = R[0] ** 2 + 2 * R[1] ** 2 + 2 * R[2] ** 2
      const s2g = foldedPsdDc(R, 2)
      const h2 = MASH_CODE_FIR.reduce((s, h) => s + h * h, 0)
      const corr = UNIFORM_KAPPA4 * h2 * h2
      const s2 = foldedPsdDcLinearProcess(R, MASH_CODE_FIR, UNIFORM_KAPPA4)
      const nuB = fB / fs
      const PinG = inbandPower(d2 * d2 * s2g, nuB)
      const Pin = inbandPower(d2 * d2 * s2, nuB)
      const rms = Math.sqrt(Pin)
      const total = d2 * d2 * linearProcessSquaredVariance(R[0], MASH_CODE_FIR, UNIFORM_KAPPA4)
      const frac = total > 0 ? Pin / total : 0
      return {
        steps: [
          {
            tex: String.raw`R_x[0..2]=\tfrac1{48}\,[\,6,\,-4,\,1\,]=[\,${texNum(R[0], MID)},\ ${texNum(R[1], MID)},\ ${texNum(R[2], MID)}\,]`,
            why: 'MASH 1-1-1 的 residue 是 $-(1-z^{-1})^2$ 作用在白色 uniform 的 $s_3/M$ 上：自相關 $=\\tfrac1{12}\\,[6,-4,1]$（係數 $[1,-2,1]$ 的自相關 × 變異數 $1/12$）；正規化 $x=r/2$ 再除以 4。',
          },
          {
            tex: String.raw`\sum_mR_x[m]^2=R_0^2+2R_1^2+2R_2^2=${texNum(R[0] ** 2, MID)}+${texNum(2 * R[1] ** 2, MID)}+${texNum(2 * R[2] ** 2, MID)}=${texNum(sumR2, MID)}`,
            why: 'lag $\\pm1$、$\\pm2$ 各出現兩次。這個和就是 $\\int S_x(\\nu)^2d\\nu$：$x$ 的 PSD 在 DC 是 0，但它的「平方」不是。',
          },
          {
            tex: String.raw`S_2^\mathrm{Gauss}(0)=2\sum_mR_x[m]^2=${texNum(s2g, MID)}\ \big(=\tfrac{35}{576}\big)`,
            why: 'Gaussian–Isserlis（F-11B.3）：$x^2-\\sigma^2$ 的自相關是 $2R_x[m]^2$，在 DC 的 PSD 是它的總和。',
          },
          {
            tex: String.raw`\kappa_4\Big(\sum_kh_k^2\Big)^2=\Big(-\tfrac1{120}\Big)\times\big(\tfrac14+1+\tfrac14\big)^2=${texNum(UNIFORM_KAPPA4, MID)}\times${texNum(h2 * h2, MID)}=${texNum(corr, MID)}`,
            why: '$u=s_3/M$ 是 uniform 不是 Gaussian：四階累積量 $\\kappa_4=\\tfrac1{80}-\\tfrac3{144}=-\\tfrac1{120}$，FIR $h=[-\\tfrac12,1,-\\tfrac12]$。負的修正：bounded 的 code 比 Gaussian 少折返一些（F-11B.5）。',
          },
          {
            tex: String.raw`S_2(0)=${texNum(s2g, MID)}${texNumP(corr, MID).startsWith('(') ? '' : '+'}${texNumP(corr, MID)}=${texNum(s2, MID)}\ \big(=\tfrac{121}{2880}\big)`,
            why: 'Gaussian 項加上累積量修正，就是線性過程的精確式。',
          },
          {
            tex: String.raw`\nu_B=\frac{f_B}{f_s}=\frac{${texNum(fB)}}{${texNum(fs)}}=${texNum(nuB, MID)}`,
            why: '帶寬除以取樣率（兩邊都用 MHz，單位消掉）：折返後的 PSD 在 $|\\nu|\\le\\nu_B$ 內近似平坦，帶內功率就是「位準 × 寬度 $2\\nu_B$」。',
          },
          {
            tex: String.raw`P_\mathrm{in}=d_2^2\,S_2(0)\cdot2\nu_B=${texNum(d2)}^2\times${texNum(s2, MID)}\times${texNum(2 * nuB, MID)}=${texNum(Pin, MID)}\ ${FS2}`,
            why: 'F-11B.6。$d_2$ 的單位是 fs（$x$ 無因次），所以 $P_\\mathrm{in}$ 是 fs²。Gaussian 式會給 $' + texNum(PinG, MID) + '$（高估約 45%）。',
          },
          {
            tex: String.raw`\sigma_{t,\mathrm{in}}=\sqrt{P_\mathrm{in}}=\sqrt{${texNum(Pin, MID)}}=${texNum(rms, MID)}\ ${FS}`,
            why: '開根號得到帶內的 timing error rms：這一塊雜訊和 $x$ 本身的高頻雜訊不同，它在 PLL 頻寬內，會原封不動變成輸出 jitter（Ch12 F-12.17）。',
          },
          {
            tex: String.raw`P_\mathrm{tot}=d_2^2\big(2\sigma_x^4+\kappa_4\textstyle\sum_kh_k^4\big)=${texNum(d2)}^2\times${texNum(total / (d2 * d2), MID)}=${texNum(total, MID)}\ ${FS2},\qquad \frac{P_\mathrm{in}}{P_\mathrm{tot}}=${texNum(100 * frac, 4)}\%`,
            why: '殘餘 INL $d_2(x^2-\\sigma_x^2)$ 的總功率（同一條累積量公式的 $m=0$ 項，$\\sum h^4=\\tfrac1{16}+1+\\tfrac1{16}$）；只有這個比例落在帶內，其餘仍在高頻、被 PLL 濾掉。',
          },
        ],
        results: [
          { symbol: 'S_2(0)', label: '單位係數的折返位準（精確式）', value: s2, unit: '—', digits: 5 },
          { symbol: String.raw`P_\mathrm{in}`, label: '帶內折返功率', value: Pin, unit: FS2 },
          { symbol: String.raw`\sigma_{t,\mathrm{in}}`, label: '帶內 timing error rms', value: rms, unit: FS },
          { symbol: String.raw`P_\mathrm{in}/P_\mathrm{tot}`, label: '落在帶內的比例', value: frac, unit: '—', digits: 4 },
        ],
        notes: [
          String.raw`$x$ 自己在 $|\nu|\le\nu_B$ 內的功率只有 $\int_{-\nu_B}^{\nu_B}\tfrac{16\sin^4(\pi\nu)}{48}d\nu\approx\tfrac{16\pi^4}{48}\cdot\tfrac{2\nu_B^5}{5}$ 的量級（$\nu_B=0.01$ 時約 $1.3\times10^{-9}$）：線性的 gain 誤差 $(a-w)x$ 幾乎不會進帶內，二次 INL 卻把 $${texNum(100 * frac, 3)}\%$ 的功率搬進來。這就是 INL 校正存在的理由。`,
          '把 $f_B$ 加倍，$P_\\mathrm{in}$ 加倍（rms × 1.41）；把 $d_2$ 減半，$P_\\mathrm{in}$ 變 1/4。',
        ],
      }
    },
    tips: [
      '$6^2+2\\cdot4^2+2\\cdot1^2=70$，所以 $\\sum R^2=70/48^2=70/2304$，$2\\sum R^2=35/576$；加上 $-3/160$ 得 $121/2880$——可以用分數直接算。',
      '$\\sqrt{0.336}$：$0.58^2=0.3364$，所以約 $0.58$。',
    ],
  },

  /* ───────────── HC-11B.2：分段 LMS 的收斂（§11b.3a） ───────────── */
  {
    id: 'HC-11B.2',
    title: '分段線性校正：第 $k$ 段的 $\\lambda_k$、時間常數、$k_{95}$ 與穩態 $\\sigma_{w_k}$',
    page: PAGE,
    formulaId: 'F-11B.8',
    formulaTex: String.raw`\lambda_k=\frac{x_{k+1}^3-x_k^3}{6},\quad g_k=\mu K_q\lambda_k,\quad p_k=1-g_k,\quad \tau_k=\frac1{g_k},\quad k_{95}=\Big\lceil\frac{\ln0.05}{\ln p_k}\Big\rceil,\quad \operatorname{Var}(w_k)=\frac{\mu^2\lambda_k}{N(1-p_k^2)}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'K', symbol: 'K', label: '段數', default: 8, min: 1, max: 64, integer: true, practice: { choices: [4, 8, 16] } },
      { key: 'k', symbol: 'k', label: '第幾段（1 = 最左、K = 最右）', default: 8, min: 1, max: 64, integer: true, practice: { min: 1, max: 8, step: 1 } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（每個 block）', unit: FS, default: 2, min: 1e-4, max: 1000, practice: { choices: [0.5, 1, 2, 4] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊', unit: FS, default: 10, min: 0.001, max: 1e4, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 block 的 sample 數', default: 64, min: 1, max: 65536, integer: true, practice: { choices: [16, 64, 256] } },
    ],
    validate: ({ K, k, mu, sigma, N }) => {
      if (k > K) return '第 $k$ 段不存在：$k\\le K$。'
      const s = segmentClosedForm(k - 1, K, mu, sigma, N)
      if (s.g >= 2) return String.raw`$g_k=\mu K_q\lambda_k=${texNum(s.g, 4)}\ge2$：pole $|p_k|\ge1$，這一段的平均動態發散（請降低 $\mu$ 或加大 $\sigma_v$）。`
      return null
    },
    solve: ({ K, k, mu, sigma, N }) => {
      const s = segmentClosedForm(k - 1, K, mu, sigma, N)
      const inner = segmentClosedForm(Math.floor(K / 2), K, mu, sigma, N) // x = 0 右邊那一段
      return {
        steps: [
          {
            tex: String.raw`x_k=-1+\frac{2(k-1)}{K}=${texNum(s.lo, MID)},\qquad x_{k+1}=-1+\frac{2k}{K}=${texNum(s.hi, MID)}`,
            why: '把 $[-1,1]$ 等分成 $K$ 段，第 $k$ 段的左右邊界。',
          },
          {
            tex: String.raw`\lambda_k=E[x^2\mathbb 1_k(x)]=\int_{x_k}^{x_{k+1}}\frac{x^2}{2}dx=\frac{x_{k+1}^3-x_k^3}{6}=\frac{${texNum(s.hi ** 3, MID)}-${texNumP(s.lo ** 3, MID)}}{6}=${texNum(s.lambda, MID)}`,
            why: 'regressor 是 $\\mathbb 1_k(x)\\,x$：它的均方值只在這一段積分（uniform 的密度 $1/2$）。靠近 $x=0$ 的段 $x^2$ 很小，$\\lambda_k$ 也很小。',
          },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{0.797885}{${texNum(sigma)}}=${texNum(s.Kq, MID)}\ ${FS}^{-1}`,
            why: 'comparator 的小訊號增益（Ch05）。',
          },
          {
            tex: String.raw`g_k=\mu K_q\lambda_k=${texNum(mu)}\times${texNum(s.Kq, MID)}\times${texNum(s.lambda, MID)}=${texNum(s.g, MID)},\qquad p_k=1-g_k=${texNum(s.pole, MID)}`,
            why: '這一段的 regressor 只在自己的段上非零，$\\mathbf R$ 是對角的：每段就是一個獨立的一階迴路（F-11B.7 的 $\\lambda_i$ 就是 $\\lambda_k$）。',
          },
          {
            tex: String.raw`\tau_k=\frac1{g_k}=${texNum(s.tau, MID)}\ \text{blocks},\qquad k_{95}=\Big\lceil\frac{\ln0.05}{\ln${texNum(s.pole, MID)}}\Big\rceil=\Big\lceil\frac{${texNum(LN005, MID)}}{${texNum(Math.log(s.pole), MID)}}\Big\rceil=${s.k95}`,
            why: '等比數列 $p_k^b$：衰減到 5% 要 $\\ln0.05/\\ln p_k$ 個 block（Ch09 F-09.6）。',
          },
          {
            tex: String.raw`\operatorname{Var}(w_k)=\frac{\mu^2\lambda_k}{N(1-p_k^2)}=\frac{${texNum(mu)}^2\times${texNum(s.lambda, MID)}}{${texNum(N)}\times${texNum(1 - s.pole ** 2, MID)}}=${texNum(s.varW, MID)}\ ${FS2},\qquad \sigma_{w_k}=${texNum(s.stdW, MID)}\ ${FS}`,
            why: 'Sign-LMS 每個 block 的 GMAC 抽樣雜訊變異數 $\\lambda_k/N$（$q^2=1$），經一階迴路 $\\sum p^{2j}=1/(1-p^2)$（F-11B.10）。',
          },
          {
            tex: String.raw`\frac{\mu}{2K_qN}=\frac{${texNum(mu)}}{2\times${texNum(s.Kq, MID)}\times${texNum(N)}}=${texNum(mu / (2 * s.Kq * N), MID)}\ ${FS2}`,
            why: '小 $g$ 的近似：穩態變異數與 $\\lambda_k$ 無關——每一段最後抖得一樣大，只是慢的段要等更久。',
          },
          {
            tex: String.raw`\text{對照 }x=0\text{ 右邊那一段：}\lambda=${texNum(inner.lambda, MID)},\ \tau=${texNum(inner.tau, MID)}\text{ blocks},\ k_{95}=${inner.k95}`,
            why: '同樣的 $\\mu$，最內側的段慢了 $' + texNum(s.lambda / inner.lambda, 4) + '$ 倍：這是分段結構的代價，也是 preconditioner（每段自己的 $\\mu_k$，F-11B.14）要解決的事。',
          },
        ],
        results: [
          { symbol: String.raw`\lambda_k`, label: '這一段的 regressor 功率', value: s.lambda, unit: '—' },
          { symbol: String.raw`\tau_k`, label: '時間常數', value: s.tau, unit: String.raw`\text{blocks}` },
          { symbol: 'k_{95}', label: '衰減到 5% 的 block 數', value: s.k95, unit: String.raw`\text{blocks}`, tolerance: { abs: 0.5 } },
          { symbol: String.raw`\sigma_{w_k}`, label: '穩態的 gain 抖動', value: s.stdW, unit: FS },
        ],
        notes: [
          chop(inner.k95 - s.k95) > 0 ? String.raw`最內段的 $k_{95}=${inner.k95}$ blocks：想讓所有段在同一時間內收斂，要給每段自己的 $\mu_k\propto1/\lambda_k$（對角 preconditioner）。` : '你選的是內側的段：它本來就是最慢的。',
        ],
      }
    },
    tips: [
      '$x^3$ 的差：$1-0.75^3=1-0.421875=0.578125$，除以 6 得 $0.096354$（$K=8$ 的最外段）。',
      '$\\ln0.05=-2.9957$；$\\ln(1-g)\\approx-g$ 時 $k_{95}\\approx3/g$。',
    ],
  },

  /* ───────────── HC-11B.3：LUT 的每格樣本數（§11b.3b） ───────────── */
  {
    id: 'HC-11B.3',
    title: 'LUT 校正：$J$ 格各要等多久、每格「看到」多少樣本、抖多大？',
    page: PAGE,
    formulaId: 'F-11B.9',
    formulaTex: String.raw`\lambda_j=p_j=\frac1J,\quad g_j=\mu K_q\lambda_j,\quad \tau_j=\frac{J}{\mu K_q},\quad \frac{N}{\mu K_q}\ \text{samples/bin per }\tau,\quad n_\mathrm{eff}=\frac{2N}{\mu K_q},\quad \sigma_{\theta_j}=\sqrt{\frac{\mu^2\lambda_j}{N(1-p_j^2)}}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'J', symbol: 'J', label: 'LUT 格數', default: 64, min: 1, max: 4096, integer: true, practice: { choices: [16, 32, 64, 128] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（每個 block）', unit: FS, default: 2, min: 1e-4, max: 1000, practice: { choices: [0.5, 1, 2, 4] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊', unit: FS, default: 10, min: 0.001, max: 1e4, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 block 的 sample 數', default: 64, min: 1, max: 65536, integer: true, practice: { choices: [16, 64, 256] } },
    ],
    validate: ({ J, mu, sigma, N }) => {
      const l = lutClosedForm(J, mu, sigma, N)
      return l.g >= 2 ? String.raw`$g_j=\mu K_q/J=${texNum(l.g, 4)}\ge2$：pole $|p_j|\ge1$，發散（請降低 $\mu$）。` : null
    },
    solve: ({ J, mu, sigma, N }) => {
      const l = lutClosedForm(J, mu, sigma, N)
      return {
        steps: [
          { tex: String.raw`\lambda_j=p_j=\frac1J=\frac1{${texNum(J)}}=${texNum(l.pj, MID)}`, why: 'regressor 是 one-hot $\\mathbb 1_j(x)$：均方值就是這一格被造訪的機率（uniform 時 $1/J$；MASH 的外側格會小得多）。' },
          { tex: String.raw`K_q=\frac{0.797885}{${texNum(sigma)}}=${texNum(l.Kq, MID)}\ ${FS}^{-1},\qquad g_j=\mu K_q\lambda_j=${texNum(mu)}\times${texNum(l.Kq, MID)}\times${texNum(l.pj, MID)}=${texNum(l.g, MID)}`, why: '每格就是一個一階迴路，loop gain 被 $p_j$ 稀釋。' },
          { tex: String.raw`\tau_j=\frac1{g_j}=\frac{J}{\mu K_q}=\frac{${texNum(J)}}{${texNum(mu)}\times${texNum(l.Kq, MID)}}=${texNum(l.tau, MID)}\ \text{blocks},\qquad k_{95}=\Big\lceil\frac{\ln0.05}{\ln(1-g_j)}\Big\rceil=${l.k95}`, why: '格數 $J$ 直接乘進時間常數：格越細、等越久。' },
          { tex: String.raw`\frac{N\tau_j}{J}=\frac{N}{\mu K_q}=\frac{${texNum(N)}}{${texNum(mu)}\times${texNum(l.Kq, MID)}}=${texNum(l.samplesPerBinPerTau, MID)}`, why: '一個時間常數內總共 $N\\tau_j$ 個 sample，平均每格分到 $1/J$：與 $J$ 無關！格數只改變「要等多久」，不改變「每格看到多少樣本」。' },
          { tex: String.raw`\operatorname{Var}(\theta_j)=\frac{\mu^2\lambda_j}{N(1-p_j^2)}=\frac{${texNum(mu)}^2\times${texNum(l.pj, MID)}}{${texNum(N)}\times${texNum(1 - l.pole ** 2, MID)}}=${texNum(l.varTheta, MID)}\ ${FS2},\qquad \sigma_{\theta_j}=${texNum(l.stdTheta, MID)}\ ${FS}`, why: 'F-11B.10；小 $g$ 時 $\\approx\\mu/(2K_qN)$，與 $J$ 無關。' },
          { tex: String.raw`n_\mathrm{eff}=\frac{1}{K_q^2\operatorname{Var}(\theta_j)}\approx\frac{2N}{\mu K_q}=${texNum(l.effectiveSamples, MID)}`, why: '直接平均 $n$ 個 1-bit 樣本的估計 $\\hat d=\\bar q/K_q$ 變異數是 $1/(nK_q^2)$；LMS 的穩態變異數等於「平均了 $n_\\mathrm{eff}$ 個樣本」，是上一步每格樣本數的 2 倍（指數視窗的有效長度）。' },
        ],
        results: [
          { symbol: String.raw`\tau_j`, label: '每格的時間常數', value: l.tau, unit: String.raw`\text{blocks}` },
          { symbol: 'k_{95}', label: '衰減到 5% 的 block 數', value: l.k95, unit: String.raw`\text{blocks}`, tolerance: { abs: 0.5 } },
          { symbol: String.raw`n_\mathrm{eff}`, label: '每格的有效平均長度', value: l.effectiveSamples, unit: String.raw`\text{samples}` },
          { symbol: String.raw`\sigma_{\theta_j}`, label: '每格修正值的穩態抖動', value: l.stdTheta, unit: FS },
        ],
        notes: [
          String.raw`「雜訊 × 時間」的乘積 $\operatorname{Var}(\theta_j)\cdot\tau_j\approx\frac{J}{2K_q^2N}=\frac{\pi J\sigma_v^2}{4N}$ 只和 $J$、$\sigma_v$、$N$ 有關：$\mu$ 只是在「快但抖」與「慢但穩」之間換。`,
          'MASH 的 code 集中在中間：外側格的 $p_j$ 可能只有 $1/J$ 的百分之一，時間常數就是這裡的 100 倍（實驗 B）。',
        ],
      }
    },
    tips: ['$J/(\\mu K_q)$：$64/(2\\times0.0798)=64/0.1596=401$。', '$n_\\mathrm{eff}=2N/(\\mu K_q)=128/0.1596=802$。'],
  },

  /* ───────────── HC-11B.4：多項式基底的條件數（§11b.3c） ───────────── */
  {
    id: 'HC-11B.4',
    title: 'monomial 基底 $\\{1,x,x^2,x^3\\}$ 的條件數：用 2×2 分塊手算',
    page: PAGE,
    formulaId: 'F-11B.11',
    formulaTex: String.raw`\begin{aligned}
\mathbf R&=\begin{bmatrix}1&0&m_2&0\\0&m_2&0&m_4\\m_2&0&m_4&0\\0&m_4&0&m_6\end{bmatrix}\ \Rightarrow\ \text{偶：}\begin{bmatrix}1&m_2\\m_2&m_4\end{bmatrix},\ \text{奇：}\begin{bmatrix}m_2&m_4\\m_4&m_6\end{bmatrix}\\
\lambda_\pm&=\frac{\operatorname{tr}\pm\sqrt{\operatorname{tr}^2-4\det}}{2},\qquad \kappa=\frac{\lambda_{\max}}{\lambda_{\min}}
\end{aligned}`,
    level: 'engineer',
    claim: 'exact',
    inputs: [
      { key: 'm2', symbol: 'm_2', label: '$E[x^2]$（uniform：1/3）', unit: '—', default: 1 / 3, min: 1e-6, max: 1, practice: { choices: [0.25, 1 / 3, 0.5] } },
      { key: 'm4', symbol: 'm_4', label: '$E[x^4]$（uniform：1/5）', unit: '—', default: 0.2, min: 1e-6, max: 1, practice: { choices: [0.1, 0.2, 0.3] } },
      { key: 'm6', symbol: 'm_6', label: '$E[x^6]$（uniform：1/7）', unit: '—', default: 1 / 7, min: 1e-6, max: 1, practice: { choices: [0.08, 1 / 7, 0.2] } },
    ],
    validate: ({ m2, m4, m6 }) => {
      if (m4 < m2 * m2) return '$m_4<m_2^2$ 違反 $\\operatorname{Var}(x^2)\\ge0$：不是任何分布的動差。'
      if (m2 * m6 < m4 * m4) return '$m_2m_6<m_4^2$ 違反 Cauchy–Schwarz（$E[x\\cdot x^3]^2\\le E[x^2]E[x^6]$）：不是任何分布的動差。'
      if (m4 - m2 * m2 <= 1e-12 || m2 * m6 - m4 * m4 <= 1e-12) return '分塊的行列式是 0：$\\mathbf R$ 奇異（例如 $x=\\pm1$ 兩點分布，$x^3=x$ 不可辨識）。'
      return null
    },
    solve: ({ m2, m4, m6 }) => {
      const [eh, el] = eig2(1, m2, m4)
      const [oh, ol] = eig2(m2, m4, m6)
      const trE = 1 + m4
      const detE = m4 - m2 * m2
      const trO = m2 + m6
      const detO = m2 * m6 - m4 * m4
      const lam = [eh, el, oh, ol]
      const lmax = Math.max(...lam)
      const lmin = Math.min(...lam)
      const kappa = lmax / lmin
      const check = modeAnalysis(hankelFromMoments(m2, m4, m6), 1, 1, 1)
      return {
        steps: [
          { tex: String.raw`R_{mn}=E[x^{m+n}]:\quad R_{02}=m_2,\ R_{13}=m_4,\ R_{22}=m_4,\ R_{33}=m_6;\quad m+n\text{ 奇數時 }=0`, why: '對稱分布的奇次動差是 0，所以 $\\{1,x^2\\}$（偶）與 $\\{x,x^3\\}$（奇）互不耦合，4×4 拆成兩個 2×2。' },
          { tex: String.raw`\text{偶：}\operatorname{tr}=1+m_4=${texNum(trE, MID)},\quad \det=m_4-m_2^2=${texNum(m4, MID)}-${texNum(m2 * m2, MID)}=${texNum(detE, MID)}`, why: '2×2 的特徵值只需要跡與行列式。$\\det=\\operatorname{Var}(x^2)$：$x^2$ 越像常數，$\\{1,x^2\\}$ 越難分辨。' },
          { tex: String.raw`\lambda_\pm^\mathrm{even}=\frac{${texNum(trE, MID)}\pm\sqrt{${texNum(trE * trE, MID)}-${texNum(4 * detE, MID)}}}{2}=${texNum(eh, MID)},\ ${texNum(el, MID)}`, why: '特徵方程 $\\lambda^2-\\operatorname{tr}\\,\\lambda+\\det=0$。' },
          { tex: String.raw`\text{奇：}\operatorname{tr}=m_2+m_6=${texNum(trO, MID)},\quad \det=m_2m_6-m_4^2=${texNum(m2 * m6, MID)}-${texNum(m4 * m4, MID)}=${texNum(detO, MID)}`, why: '$\\{x,x^3\\}$ 分塊；$\\det$ 很小是因為在 $[-1,1]$ 上 $x^3$ 長得很像 $x$（相關係數 $m_4/\\sqrt{m_2m_6}$）。' },
          { tex: String.raw`\lambda_\pm^\mathrm{odd}=\frac{${texNum(trO, MID)}\pm\sqrt{${texNum(trO * trO, MID)}-${texNum(4 * detO, MID)}}}{2}=${texNum(oh, MID)},\ ${texNum(ol, MID)}`, why: '同上。最小的那一個就是整個 4×4 的 $\\lambda_{\\min}$。' },
          { tex: String.raw`\kappa(\mathbf R)=\frac{\lambda_{\max}}{\lambda_{\min}}=\frac{${texNum(lmax, MID)}}{${texNum(lmin, MID)}}=${texNum(kappa, MID)}`, why: '條件數 = 最快模式與最慢模式的 loop gain 比；scalar $\\mu$ 下兩者的時間常數也差這麼多倍（Ch09 F-09.7）。' },
          { tex: String.raw`\text{Legendre（uniform）：}\mathbf R=\operatorname{diag}(1,\tfrac13,\tfrac15,\tfrac17)\ \Rightarrow\ \kappa=7;\qquad \sqrt{2m+1}P_m:\ \mathbf R=\mathbf I\ \Rightarrow\ \kappa=1`, why: '換一組基底（同樣的函數空間、同樣的最佳 $c(x)$），只是把 $\\mathbf R$ 變對角，最慢模式就從 $\\kappa$ 倍變成 1 倍。' },
        ],
        results: [
          { symbol: String.raw`\lambda_{\max}`, label: '最大特徵值', value: lmax, unit: '—' },
          { symbol: String.raw`\lambda_{\min}`, label: '最小特徵值', value: lmin, unit: '—' },
          { symbol: String.raw`\kappa`, label: '條件數（= 最慢／最快時間常數比）', value: kappa, unit: '—' },
          { symbol: String.raw`\kappa/7`, label: '相對 Legendre 基底慢幾倍', value: kappa / 7, unit: '—' },
        ],
        notes: [
          String.raw`核對：用 Jacobi 法直接算 4×4 的特徵值得到 $\kappa=${texNum(check.cond, MID)}$（與分塊手算相同）。`,
          '$\\kappa=67.6$ 的意思：若把 $\\mu$ 設成讓最快模式一個 block 就收斂（$\\mu K_q\\lambda_{\\max}=1$），最慢的 $x^3$ 方向要 $\\ln 20\\cdot67.6\\approx200$ 個 block。',
        ],
      }
    },
    tips: ['uniform：$\\operatorname{tr}_\\mathrm{even}=1.2$、$\\det_\\mathrm{even}=0.2-0.1111=0.08889$、$\\sqrt{1.44-0.35556}=1.0414$ ⇒ $1.1207$、$0.0793$。', '奇分塊：$\\operatorname{tr}=0.47619$、$\\det=0.047619-0.04=0.007619$ ⇒ $0.45961$、$0.016580$；$\\kappa=1.1207/0.01658=67.6$。'],
  },

  /* ───────────── HC-11B.5：綜合——一顆 DTC 的 INL 校正預算 ───────────── */
  {
    id: 'HC-11B.5',
    title: '綜合：gain 校正後還剩多少 INL、LUT 要幾格、等多久、最後抖多大？',
    page: PAGE,
    formulaId: 'F-11B.13',
    formulaTex: String.raw`E[r^2]=\frac{4d_2^2}{45}+\frac{4d_3^2}{175},\qquad \text{floor}=\frac2J\sqrt{\frac{E[d'^2]}{12}},\qquad \tau_j=\frac{J}{\mu K_q},\qquad E[r^2]_\infty=\text{floor}^2+\sum_j\lambda_j\operatorname{Var}(\theta_j)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'd2', symbol: 'd_2', label: '二次 INL', unit: FS, default: 20, min: 0, max: 1000, practice: { choices: [10, 20, 40] } },
      { key: 'd3', symbol: 'd_3', label: '三次 INL', unit: FS, default: 10, min: 0, max: 1000, practice: { choices: [0, 10, 20] } },
      { key: 'J', symbol: 'J', label: 'LUT 格數', default: 64, min: 2, max: 4096, integer: true, practice: { choices: [16, 32, 64, 128] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: FS, default: 2, min: 1e-4, max: 1000, practice: { choices: [1, 2, 4] } },
      { key: 'sigma', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊', unit: FS, default: 10, min: 0.001, max: 1e4, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每 block sample 數', default: 64, min: 1, max: 65536, integer: true, practice: { choices: [16, 64, 256] } },
    ],
    validate: ({ J, mu, sigma, N }) => {
      const l = lutClosedForm(J, mu, sigma, N)
      return l.g >= 2 ? String.raw`$g_j=${texNum(l.g, 4)}\ge2$：發散（請降低 $\mu$）。` : null
    },
    solve: ({ d2, d3, J, mu, sigma, N }) => {
      const u = uniformResidualAfterGain({ d2, d3 })
      const Ed2 = (4 * d2 * d2) / 3 + (9 * d3 * d3) / 5
      const floor = lutApproxRms({ d2, d3 }, J)
      const l = lutClosedForm(J, mu, sigma, N)
      const Kq = kqFromSigma(sigma)
      const misadj = J * l.pj * l.varTheta
      const final = Math.sqrt(floor * floor + misadj)
      return {
        steps: [
          { tex: String.raw`w^*-a=\tfrac35d_3=${texNum(0.6 * d3, MID)}\ ${FS},\qquad E[r^2]=\frac{4d_2^2}{45}+\frac{4d_3^2}{175}=${texNum((4 * d2 * d2) / 45, MID)}+${texNum((4 * d3 * d3) / 175, MID)}=${texNum(u.rms2, MID)}\ ${FS2}`, why: 'uniform $x$ 的 gain 校正（Ch11 F-11.8：$w^*-a=d_3E[x^4]/E[x^2]=\\tfrac35d_3$）吸收三次項的線性部分，二次項的 DC 被主迴路吸收，剩下 $d_2(x^2-\\tfrac13)+d_3(x^3-\\tfrac35x)$。' },
          { tex: String.raw`\sigma_r=\sqrt{${texNum(u.rms2, MID)}}=${texNum(u.rms, MID)}\ ${FS}`, why: '這是「只做 gain 校正」之後留在 PD 上的確定性 timing error rms——INL 校正要從這裡開始降。' },
          { tex: String.raw`E[d'^2]=\frac{4d_2^2}{3}+\frac{9d_3^2}{5}=${texNum((4 * d2 * d2) / 3, MID)}+${texNum((9 * d3 * d3) / 5, MID)}=${texNum(Ed2, MID)}\ ${FS2}`, why: '$d\'(x)=2d_2x+3d_3x^2$ 的均方值（uniform：$E[x^2]=\\tfrac13$、$E[x^4]=\\tfrac15$、交叉項 $E[x^3]=0$）。' },
          { tex: String.raw`\text{floor}=\Delta\sqrt{\frac{E[d'^2]}{12}}=\frac{2}{${texNum(J)}}\sqrt{\frac{${texNum(Ed2, MID)}}{12}}=${texNum(2 / J, MID)}\times${texNum(Math.sqrt(Ed2 / 12), MID)}=${texNum(floor, MID)}\ ${FS}`, why: 'F-11B.13：每格存一個常數，格內的斜率沒被修正；格寬 $\\Delta=2/J$，格內殘差均勻分布的 rms 是 $|d\'|\\Delta/\\sqrt{12}$。' },
          { tex: String.raw`K_q=${texNum(Kq, MID)}\ ${FS}^{-1},\qquad \tau_j=\frac{J}{\mu K_q}=${texNum(l.tau, MID)}\ \text{blocks},\qquad k_{95}=${l.k95}`, why: 'F-11B.9：每格一個一階迴路。' },
          { tex: String.raw`\operatorname{Var}(\theta_j)=\frac{\mu^2/J}{N(1-p_j^2)}=${texNum(l.varTheta, MID)}\ ${FS2},\qquad \sum_j\lambda_j\operatorname{Var}(\theta_j)=J\cdot\tfrac1J\cdot${texNum(l.varTheta, MID)}=${texNum(misadj, MID)}\ ${FS2}`, why: 'F-11B.10 的 misadjustment：每格的抖動乘上它被使用的機率，加總就是 LMS 雜訊貢獻的殘餘功率。' },
          { tex: String.raw`\sigma_{r,\infty}=\sqrt{\text{floor}^2+${texNum(misadj, MID)}}=\sqrt{${texNum(floor * floor, MID)}+${texNum(misadj, MID)}}=${texNum(final, MID)}\ ${FS}`, why: '校正完成後的殘餘 INL rms：結構的近似誤差與 LMS 的抖動平方相加。' },
          { tex: String.raw`\frac{\sigma_r}{\sigma_{r,\infty}}=\frac{${texNum(u.rms, MID)}}{${texNum(final, MID)}}=${texNum(u.rms / final, 4)}\ \text{倍}`, why: 'INL 校正把殘餘 timing error 壓低了這麼多；折返進帶內的雜訊功率跟著降約這個比例的平方。' },
        ],
        results: [
          { symbol: String.raw`\sigma_r`, label: '只做 gain 校正的殘餘 INL rms', value: u.rms, unit: FS },
          { symbol: String.raw`\text{floor}`, label: 'LUT 的近似誤差 rms', value: floor, unit: FS },
          { symbol: String.raw`\sigma_{r,\infty}`, label: '校正完成後的殘餘 rms', value: final, unit: FS },
          { symbol: 'k_{95}', label: '收斂到 5% 的 block 數', value: l.k95, unit: String.raw`\text{blocks}`, tolerance: { abs: 0.5 } },
        ],
        notes: [
          misadj > floor * floor
            ? String.raw`LMS 的抖動（$${texNum(Math.sqrt(misadj), 4)}$）比 LUT 的近似誤差（$${texNum(floor, 4)}$）大：格數已經夠了，該降 $\mu$ 或加大 $N$（代價是 $\tau_j$ 變長）。`
            : String.raw`LUT 的近似誤差（$${texNum(floor, 4)}$）比 LMS 的抖動（$${texNum(Math.sqrt(misadj), 4)}$）大：再加格數才有用，但 $\tau_j\propto J$。`,
          '這些都是 uniform code 的數字；MASH 的 $x$ 集中在中間，外側格的 $\\tau_j$ 長得多（實驗 B 的警告）。',
        ],
      }
    },
    tips: ['$4\\times400/45=35.56$、$4\\times100/175=2.286$，和 $37.84$，開根號 $6.15$。', '$E[d\'^2]=533.3+180=713.3$；$\\sqrt{713.3/12}=7.71$；乘 $2/64=0.03125$ 得 $0.241$。'],
  },
]
