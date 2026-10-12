import { texNum, texNumP } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { SIX_CONDITIONS } from './data'
import { CONDITION_ORDER, DEFAULT_PARAMS, comparatorGain, evaluateThesis, trajectory, type CheckState, type ConditionId, type ThesisParams, type ThesisResult } from './thesisModel'

/**
 * Dashboard（/）的「帶入手算」題（docs/teaching-style.md §7）：把「一條方程式看懂六個條件」的每個重要公式代數字算一次。
 *
 *  1. 每一題的「答案」都由本頁的計算核心 evaluateThesis / trajectory 算出（與「六條件一分鐘體檢」同一份程式），
 *     不另寫一套公式；handcalcs.test.tsx 再用照課本公式寫的獨立重算逐一比對。
 *  2. 每一步只做一種運算（一次乘除、一次開根號、一次 cos / log），tex 都是「符號式 = 代入數字 = 結果」；
 *     同一行內若連做兩件事（例如先乘再開根號），中間值一定寫出來。
 *  3. 預設數字是規格 T13 / T15 與本頁體檢 preset 的例子，手算結果可以直接和文中數字、體檢的指標表對上。
 *  4. validate 擋掉模型不適用的輸入，並說明是哪一個條件不成立（不是只說「不合法」）。
 *
 * 位置：HC-DB.1 → 推導 1、HC-DB.2 → 推導 2、HC-DB.3 → 推導 3、HC-DB.5 → 推導 4、HC-DB.4 → 推導 7 之後（所有模式都顯示）、
 *       HC-DB.6（綜合）→ 思考題之前。極性：δ = a − w、Δw = w* − a；時間單位 fs。
 *
 * 與各章題目的分工：這一頁只算「把六個條件串起來」的那幾條式子（F-DB.1 … F-DB.5）。
 * 598 blocks 的慢模式（HC-09.3 / HC-10.2）、β 與 dBc 的細節（HC-12.7）、−3 dB / ENBW（HC-12.4 / 12.5）留在各章。
 */

/** 手算題共用的基準：T13 的條件、無 bias */
const BASE: ThesisParams = { ...DEFAULT_PARAMS, B: 0 }
/** √(2/π)：K_q 的分子 */
const SQRT_2_OVER_PI = comparatorGain(1)

const STATE_ZH: Record<CheckState, string> = { ok: '通過', warn: '注意', fail: '未通過' }
/** 六個條件的名稱直接取自條件卡片（data.ts），HC-DB.6 的判定列才不會和卡片各寫各的 */
const CONDITION_ZH = Object.fromEntries(SIX_CONDITIONS.map((c) => [c.id, c.zh])) as Record<ConditionId, string>

const PAGE = '/'

/** 筆數、block 數這類整數：不做 5 位有效數字的四捨五入 */
const texInt = (k: number): string => texNum(k, 12)

/** 小角度近似 Spur ≈ 20 log10(β/2) 的適用上限：sideband 的相對誤差約 β²/8（β = 0.2 時 0.5%，約 0.04 dB） */
export const BETA_SMALL_ANGLE_MAX = 0.2

/**
 * 讓體檢的計算核心得到指定的 loop gain：g = μ·K_q·C ⇒ σ_v = μ·√(2/π)·C / g。
 * （題目直接給 g 時用：模型的 σ_v 只是把同一個 g 換一種寫法。）
 */
const sigmaVForGain = (mu: number, g: number, C = 1): number => (mu * SQRT_2_OVER_PI * C) / g

/**
 * HC-DB.5 用：|H| = 1、θ = 0（C = P_x）、B = Δw·P_x ⇒ 模型的 Δw 就是輸入值；
 * 再選 N 讓模型的 σ_w = μ√(P_x/(N g(2 − g))) 等於輸入的 σ_w（N = μ²P_x/(σ_w² g(2 − g))，σ_w = 0 時 N → ∞）。
 * 這樣 σ_δt、A_t、β、spur 全部直接取自 evaluateThesis。
 */
function systemCase(sigmaW: number, dW: number, Px: number, fout: number, Tmag: number): ThesisResult {
  const g = BASE.mu * comparatorGain(BASE.sigmaV) * Px
  const N = (BASE.mu * BASE.mu * Px) / (sigmaW * sigmaW * g * (2 - g))
  return evaluateThesis({ ...BASE, Px, N, B: dW * Px, foutGHz: fout, Tmag })
}

/**
 * HC-DB.2 用：P_x = C（|H| = 1、θ = 0）⇒ 模型的 C 就是輸入值；σ_v 取成讓 g 等於輸入值。
 * 回傳體檢的結果與平均軌跡的前兩步 E[δ_1]、E[δ_2]（δ = a − w，所以要對 E[w_k − a] 變號）。
 */
function meanCase(B: number, C: number, g: number, w0: number): { r: ThesisResult; d1: number; d2: number } {
  const r = evaluateThesis({ ...BASE, Px: C, sigmaV: sigmaVForGain(BASE.mu, g, C), B, w0MinusA: w0 })
  const mean = trajectory(r, 2).mean // E[w_k − a]
  return { r, d1: -mean[1], d2: -mean[2] }
}

/**
 * 提示文字裡引用的參考數字（T13 / T06 / T15 與體檢預設值、preset）：一律由計算核心在載入時算出，不手打。
 */
const REF = (() => {
  const t13 = evaluateThesis(BASE)
  const t06 = evaluateThesis({ ...BASE, phiDeg: 120, Px: 0.5 })
  const precond = evaluateThesis({ ...BASE, twoParam: true, rho: 0.99, update: 'precond' }) // preset「ρ = 0.99 ＋ preconditioner」（B = 0）
  const t15 = evaluateThesis({ ...BASE, Px: 0.5, B: 0.25 })
  const dflt = evaluateThesis(DEFAULT_PARAMS)
  return { t13, t06, precond, t15, dflt }
})()

/** T13 的 loop gain 取 5 位有效數字（就是 HC-DB.1 手算出來的 g），當作後面幾題的預設輸入 */
const G_T13 = Number(REF.t13.g.toPrecision(5))
/** 體檢 preset「13 GHz、0.5 fs peak tone（T15）」的 σ_w 取 4 位有效數字（指標表顯示的數字），當作 HC-DB.5 的預設輸入 */
const SIGMA_W_T15 = Number(REF.t15.sigmaW.toPrecision(4))
/** HC-DB.2 提示用：預設數字（體檢的預設值）與一組好算的數字（g = 0.5）各自的答案 */
const MEAN_REF = {
  dflt: meanCase(DEFAULT_PARAMS.B, 1, G_T13, DEFAULT_PARAMS.w0MinusA),
  easy: meanCase(DEFAULT_PARAMS.B, 1, 0.5, DEFAULT_PARAMS.w0MinusA),
}

export const HANDCALCS: HandCalcDef[] = [
  // ───────────── HC-DB.1：從晶片數字到 pole（F-DB.1，推導 1） ─────────────
  {
    id: 'HC-DB.1',
    title: String.raw`從晶片數字到 calibration pole：$K_q$、$C$、$g$、$p$`,
    page: PAGE,
    formulaId: 'F-DB.1',
    formulaTex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\qquad C=P_x\,|H|\cos\theta,\qquad g=\mu K_qC,\qquad p=1-g`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 1, max: 1000, practice: { choices: [50, 100, 200] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（average-mode）', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 10000, practice: { choices: [5, 10, 20, 40] } },
      { key: 'Px', symbol: 'P_x', label: 'code 功率', default: 1, min: 0, max: 4, practice: { choices: [0.5, 1, 2] } },
      { key: 'Hmag', symbol: '|H|', label: 'error path 在 code 頻率的幅度', default: 1, min: 0, max: 4, practice: { choices: [0.5, 1] } },
      { key: 'theta', symbol: String.raw`\theta`, label: '殘餘相位（error path 相位加上 code delay 的補償）', unit: String.raw`^\circ`, default: 0, min: -180, max: 180, practice: { choices: [0, 60, 120, 180] } },
    ],
    solve: ({ sigmaV, mu, Px, Hmag, theta }) => {
      const r = evaluateThesis({ ...BASE, sigmaV, mu, Px, Hmag, phiDeg: theta, D: 0, d: 0 })
      const { Kq, g } = r
      const { cosTheta, C } = r.polarity
      const p = 1 - g
      let verdict: string
      if (C < 0) verdict = String.raw`$C<0$：$p=${texNum(p)}>1$，正的 $\mu$ 讓平均誤差每個 block 放大 $p$ 倍（條件 2「更新方向正確」不成立）。`
      else if (C === 0) verdict = String.raw`$C=0$：$p=1$，沒有平均恢復力，$w$ 只會隨 GMAC 雜訊 random walk（條件 2 不成立）。`
      else if (g >= 2) verdict = String.raw`$g=${texNum(g)}\ge2$：$|p|\ge1$，步子太大，係數正負交替而且不會縮小（條件 3「動態穩定」不成立）。`
      else if (g > 1) verdict = String.raw`$1<g<2$：$-1<p<0$，誤差每個 block 變號但會收斂（震盪收斂）。`
      else if (g === 1) verdict = String.raw`$g=1$：$p=0$，平均誤差一個 block 就歸零（deadbeat）；但雜訊也最不被平均，見 HC-DB.3。`
      else
        verdict = String.raw`$0<g<1$：$0<p<1$，誤差單調縮小，時間常數 $\tau=-1/\ln p=${texNum(-1 / Math.log(p), 4)}$ 個 block（$g\ll1$ 時 $\tau\approx1/g=${texNum(1 / g, 4)}$）。`
      return {
        steps: [
          {
            tex: String.raw`\sqrt{2/\pi}=\sqrt{${texNum(2 / Math.PI)}}=${texNum(SQRT_2_OVER_PI)}`,
            why: String.raw`這是一個常數：先算 $2\div\pi$，再按計算機的 $\sqrt{x}$ 鍵。算一次就可以記起來（約 $0.8$）。`,
          },
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${texNum(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs^{-1}}`,
            why: String.raw`1-bit comparator 的統計小訊號增益：雜訊 $\sigma_v$ 越大，每 1 fs 的誤差讓 $E[q]$ 偏離 0 的量越小。`,
          },
          {
            tex: String.raw`\cos\theta=\cos(${texNum(theta)}^\circ)=${texNum(cosTheta)}`,
            why: String.raw`計算機切到 DEG（角度）模式再按 cos。$\theta=\phi+\Omega D$ 是 error path 相位與 code delay 補償的總和。`,
          },
          {
            tex: String.raw`C=P_x\,|H|\cos\theta=${texNum(Px)}\times${texNum(Hmag)}\times${texNumP(cosTheta)}=${texNum(C)}`,
            why: String.raw`code 與它造成的誤差之間的相關；正負號就是更新極性。`,
          },
          {
            tex: String.raw`g=\mu\,K_q\,C=${texNum(mu)}\times${texNum(Kq)}\times${texNumP(C)}=${texNum(g)}`,
            why: String.raw`正規化 loop gain（無因次）：$\mu$ 的 fs 與 $K_q$ 的 $\mathrm{fs^{-1}}$ 相消。`,
          },
          {
            tex: String.raw`p=1-g=1-${texNumP(g)}=${texNum(p)}`,
            why: String.raw`calibration pole：平均誤差 $E[\delta_k]$ 每個 block 乘上的倍數。`,
          },
        ],
        results: [
          { symbol: 'K_q', label: 'comparator 增益', value: Kq, unit: String.raw`\mathrm{fs^{-1}}` },
          { symbol: 'C', label: '相關（極性）', value: C, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: 'g', label: 'loop gain', value: g, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: 'p', label: 'pole', value: p, tolerance: { abs: 1e-4, rel: 0.01 } },
        ],
        notes: [verdict],
      }
    },
    tips: [
      String.raw`常用角度不必按計算機：$\cos0^\circ=1$、$\cos60^\circ=0.5$、$\cos90^\circ=0$、$\cos120^\circ=-0.5$、$\cos180^\circ=-1$。`,
      String.raw`預設數字是規格 T13 的條件：答案應為 $K_q=${texNum(REF.t13.Kq)}\ \mathrm{fs^{-1}}$、$g=${texNum(REF.t13.g)}$、$p=${texNum(1 - REF.t13.g)}$。`,
      String.raw`把 $\theta$ 改成 $120^\circ$、$P_x$ 改成 $0.5$，就是 T06 的極性錯誤：$C=${texNum(REF.t06.polarity.C)}$、$p=${texNum(1 - REF.t06.g)}>1$。`,
      String.raw`想和模擬對照：在下方「動手體檢」輸入同一組數字，看指標表的 $K_q$、$C$、$g$、$\max|z|$。`,
    ],
  },

  // ───────────── HC-DB.2：固定點與平均軌跡（推導 2） ─────────────
  {
    id: 'HC-DB.2',
    title: String.raw`GMAC 歸零時 gain 停在哪裡？$\Delta w=B/C$ 與平均誤差的前兩步`,
    page: PAGE,
    formulaId: 'F-DB.1',
    formulaTex: String.raw`E[\delta_{k+1}]=p\,E[\delta_k]-g\,\Delta w,\qquad \Delta w=w^*-a=\frac{B}{C},\qquad p=1-g\quad(\delta=a-w)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      { key: 'B', symbol: 'B', label: 'code 相關干擾與 code 的相關', unit: String.raw`\mathrm{fs}`, default: DEFAULT_PARAMS.B, min: -100, max: 100, practice: { choices: [-0.2, 0.1, 0.2, 0.5] } },
      { key: 'C', symbol: 'C', label: 'code 與有效 regressor 的相關', default: 1, min: -4, max: 4, practice: { choices: [0.25, 0.5, 1] } },
      { key: 'g', symbol: 'g', label: 'loop gain（HC-DB.1 的結果）', default: G_T13, min: -1, max: 3, practice: { choices: [0.1, 0.2, 0.5] } },
      { key: 'w0', symbol: 'w_0-a', label: '一開始的 gain 誤差', unit: String.raw`\mathrm{fs}`, default: DEFAULT_PARAMS.w0MinusA, min: -500, max: 500, practice: { choices: [-5, -2, 2, 4] } },
    ],
    validate: ({ C, g }) => {
      if (C < 0) return String.raw`$C<0$：$w^*=a+B/C$ 是排斥點（極性錯誤時平均誤差離它越來越遠），談不上「停在哪裡」。請換一個 $C>0$。`
      if (C === 0) return String.raw`$C=0$：沒有恢復力，$B/C$ 沒有定義（$B\ne0$ 時 $w$ 以固定速率一直漂移）。請換一個 $C>0$。`
      if (g <= 0 || g >= 2) return String.raw`需要 $0<g<2$ 才有 $|p|<1$（$d=0$ 的穩定條件）；現在 $p=1-g=${texNum(1 - g)}$，平均誤差不會停在固定點。`
      return null
    },
    solve: ({ B, C, g, w0 }) => {
      // 答案來自體檢的計算核心（evaluateThesis + trajectory），不是另一套公式
      const { r, d1, d2 } = meanCase(B, C, g, w0)
      const dW = r.deltaW
      const p = 1 - g
      const gdW = g * dW
      const d0 = -w0
      const start = d0 + dW // E[δ_0] − δ*
      return {
        steps: [
          { tex: String.raw`\Delta w=\frac{B}{C}=\frac{${texNum(B)}}{${texNum(C)}}=${texNum(dW)}\ \mathrm{fs}`, why: String.raw`固定點相對真值的偏移：$C$ 在分母，$C$ 越小同樣的 $B$ 造成越大的 bias。` },
          { tex: String.raw`\delta_0=a-w_0=-(w_0-a)=-${texNumP(w0)}=${texNum(d0)}\ \mathrm{fs}`, why: String.raw`全站極性 $\delta=a-w$，所以要變號。` },
          { tex: String.raw`p=1-g=1-${texNum(g)}=${texNum(p)}`, why: String.raw`pole（推導 1）。` },
          {
            tex: String.raw`g\,\Delta w=${texNum(g)}\times${texNumP(dW)}=${texNum(gdW)}\ \mathrm{fs}`,
            why: String.raw`遞迴裡的常數項 $\mu K_qB=(\mu K_qC)\,(B/C)=g\,\Delta w$：先算好，後面每一步都會用到。`,
          },
          {
            tex: String.raw`E[\delta_1]=p\,\delta_0-g\,\Delta w=${texNumP(p)}\times${texNumP(d0)}-${texNumP(gdW)}=${texNum(p * d0)}-${texNumP(gdW)}=${texNum(d1)}\ \mathrm{fs}`,
            why: String.raw`推導 1 的平均遞迴：一次乘法、一次減法。`,
          },
          {
            tex: String.raw`E[\delta_2]=p\,E[\delta_1]-g\,\Delta w=${texNumP(p)}\times${texNumP(d1)}-${texNumP(gdW)}=${texNum(p * d1)}-${texNumP(gdW)}=${texNum(d2)}\ \mathrm{fs}`,
            why: String.raw`同一條遞迴再做一次。`,
          },
          { tex: String.raw`E[w_2]-a=-E[\delta_2]=${texNum(-d2)}\ \mathrm{fs}`, why: String.raw`換回 $w$ 的座標：它朝著 $\Delta w=${texNum(dW)}\ \mathrm{fs}$ 靠近${dW === 0 ? '（這一題 $B=0$，固定點就是真值）' : '，而不是朝 0'}。` },
        ],
        results: [
          { symbol: String.raw`\Delta w`, label: '固定點的偏移', value: dW, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: String.raw`E[\delta_1]`, label: '第 1 個 block 後的平均誤差', value: d1, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 1e-4, rel: 0.01 } },
          { symbol: String.raw`E[\delta_2]`, label: '第 2 個 block 後的平均誤差', value: d2, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 1e-4, rel: 0.01 } },
        ],
        notes: [
          String.raw`繼續算下去 $E[\delta_k]\to\delta^*=-\Delta w=${texNum(-dW)}\ \mathrm{fs}$：GMAC 的平均歸零，但 gain 偏了 $${texNum(dW)}\ \mathrm{fs}$（條件 5）。`,
          start === 0
            ? String.raw`這一題的初值剛好就在固定點上（$\delta_0=\delta^*$）：平均誤差一步都不會動。`
            : String.raw`驗算：到固定點的距離 $E[\delta_k]-\delta^*$ 每一步乘上 $p$，所以 $\dfrac{E[\delta_1]-\delta^*}{\delta_0-\delta^*}=\dfrac{${texNum(d1 + dW)}}{${texNum(start)}}=${texNum((d1 + dW) / start)}$ 應等於 $p=${texNum(p)}$。`,
        ],
      }
    },
    tips: [
      String.raw`每一步只有一次乘法和一次減法；把 $g\,\Delta w$ 先算好（第 4 步），後面直接拿來減。`,
      String.raw`預設數字就是「動手體檢」的預設值（T13 加上 $B=${texNum(DEFAULT_PARAMS.B)}\ \mathrm{fs}$、$w_0-a=${texNum(DEFAULT_PARAMS.w0MinusA)}\ \mathrm{fs}$）：答案 $E[\delta_1]=${texNum(MEAN_REF.dflt.d1)}\ \mathrm{fs}$、$E[\delta_2]=${texNum(MEAN_REF.dflt.d2)}\ \mathrm{fs}$，就是體檢那張圖（或它的 CSV）在 $k=1$、$k=2$ 的 $E[w_k-a]$ 變號。`,
      String.raw`想先用好算的數字：把 $g$ 改成 $0.5$，答案是 $E[\delta_1]=${texNum(MEAN_REF.easy.d1)}\ \mathrm{fs}$、$E[\delta_2]=${texNum(MEAN_REF.easy.d2)}\ \mathrm{fs}$；一直算下去會停在 $\delta^*=${texNum(-MEAN_REF.easy.r.deltaW)}\ \mathrm{fs}$，不是 0。`,
      String.raw`這是 MSE-LMS 的線性固定點；1-bit Sign-LMS 只在殘差遠小於 $\sigma_v$ 時近似成立（勘誤 E01）。`,
    ],
  },

  // ───────────── HC-DB.3：σ_w（d = 0 的等比級數與 d = 1 的封閉式；F-DB.2，推導 3 / 6） ─────────────
  {
    id: 'HC-DB.3',
    title: String.raw`係數雜訊 $\sigma_w$：沒有延遲（$d=0$）與晚一個 block（$d=1$）`,
    page: PAGE,
    formulaId: 'F-DB.2',
    formulaTex: String.raw`\sigma_w=\mu\sqrt{\sigma_\eta^2\textstyle\sum y^2},\qquad \sigma_\eta^2=\frac{P_x}{N},\qquad \textstyle\sum y^2=\dfrac{1}{g(2-g)}\ (d=0),\quad \dfrac{1+g}{g(1-g)(2+g)}\ (d=1)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 10000, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'Px', symbol: 'P_x', label: 'code 功率', default: 1, min: 0.01, max: 4, practice: { choices: [0.5, 1] } },
      { key: 'g', symbol: 'g', label: 'loop gain（HC-DB.1 的結果）', default: G_T13, min: 0.0001, max: 1, practice: { choices: [0.05, 0.1, 0.2, 0.5] } },
    ],
    validate: ({ g }) =>
      g <= 0 || g >= 1
        ? String.raw`需要 $0<g<1$：$d=1$ 的臨界增益是 $g^*(1)=2\sin(\pi/6)=1$，$g\ge1$ 時晚一個 block 的迴路已經不穩，$\sigma_w$ 無界。`
        : null,
    solve: ({ mu, N, Px, g }) => {
      // 讓體檢的計算核心得到同一個 g（C = P_x）
      const sigmaV = sigmaVForGain(mu, g, Px)
      const r0 = evaluateThesis({ ...BASE, mu, N, Px, sigmaV, d: 0 })
      const r1 = evaluateThesis({ ...BASE, mu, N, Px, sigmaV, d: 1 })
      const eta2 = r0.sigmaEta2
      const S0 = r0.modes[0].energy
      const S1 = r1.modes[0].energy
      const v0 = eta2 * S0
      const v1 = eta2 * S1
      const den1 = g * (1 - g) * (2 + g)
      const ratio = r1.sigmaW / r0.sigmaW
      return {
        steps: [
          { tex: String.raw`\sigma_\eta^2=\frac{P_x}{N}=\frac{${texNum(Px)}}{${texInt(N)}}=${texNum(eta2)}`, why: String.raw`近平衡時 $q$ 近似 iid $\pm1$，$N$ 筆平均的變異數是 $E[x^2]/N$。` },
          { tex: String.raw`g\,(2-g)=${texNum(g)}\times${texNum(2 - g)}=${texNum(g * (2 - g))}`, why: String.raw`其實就是 $1-p^2$（$p=1-g$）：等比級數 $\sum p^{2m}$ 的分母。` },
          { tex: String.raw`\textstyle\sum y^2\big|_{d=0}=\dfrac{1}{g\,(2-g)}=\dfrac{1}{${texNum(g * (2 - g))}}=${texNum(S0)}`, why: String.raw`白雜訊經過校正迴路後的功率增益（推導 3）。` },
          { tex: String.raw`\sigma_\eta^2\textstyle\sum y^2\big|_{d=0}=${texNum(eta2)}\times${texNum(S0)}=${texNum(v0)}`, why: String.raw`根號裡面的數字（無因次）；它很小是正常的，因為 $N$ 很大。` },
          { tex: String.raw`\sqrt{\sigma_\eta^2\textstyle\sum y^2}=\sqrt{${texNum(v0)}}=${texNum(Math.sqrt(v0))}`, why: String.raw`按計算機的 $\sqrt{x}$ 鍵。` },
          {
            tex: String.raw`\sigma_w\big|_{d=0}=\mu\sqrt{\sigma_\eta^2\textstyle\sum y^2}=${texNum(mu)}\times${texNum(Math.sqrt(v0))}=${texNum(r0.sigmaW)}\ \mathrm{fs}`,
            why: String.raw`最後乘上 $\mu$（單位 fs）。`,
          },
          {
            tex: String.raw`g\,(1-g)\,(2+g)=${texNum(g)}\times${texNum(1 - g)}\times${texNum(2 + g)}=${texNum(den1)}`,
            why: String.raw`晚一個 block 的封閉式（Research 模式的推導 6）的分母；多了 $(1-g)$，$g\to1$ 時趨近 0。`,
          },
          {
            tex: String.raw`\textstyle\sum y^2\big|_{d=1}=\dfrac{1+g}{g\,(1-g)\,(2+g)}=\dfrac{${texNum(1 + g)}}{${texNum(den1)}}=${texNum(S1)}`,
            why: String.raw`同樣是「白雜訊的功率增益」，只是迴路的脈衝響應變成 $y_m=y_{m-1}-g\,y_{m-2}$。`,
          },
          {
            tex: String.raw`\sigma_w\big|_{d=1}=\mu\sqrt{\sigma_\eta^2\textstyle\sum y^2}=${texNum(mu)}\times\sqrt{${texNum(eta2)}\times${texNum(S1)}}=${texNum(mu)}\times\sqrt{${texNum(v1)}}=${texNum(mu)}\times${texNum(Math.sqrt(v1))}=${texNum(r1.sigmaW)}\ \mathrm{fs}`,
            why: String.raw`和第 4–6 步一樣的三個動作：先乘、再開根號、最後乘 $\mu$。`,
          },
          { tex: String.raw`\frac{\sigma_w|_{d=1}}{\sigma_w|_{d=0}}=\frac{${texNum(r1.sigmaW)}}{${texNum(r0.sigmaW)}}=${texNum(ratio)}`, why: String.raw`延遲讓雜訊放大幾倍。` },
        ],
        results: [
          { symbol: String.raw`\sigma_w\big|_{d=0}`, label: '沒有延遲', value: r0.sigmaW, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_w\big|_{d=1}`, label: '晚一個 block', value: r1.sigmaW, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_w|_{d=1}/\sigma_w|_{d=0}`, label: '放大倍數', value: ratio },
        ],
        notes: [
          g < 0.15
            ? String.raw`$g\ll1$ 時兩個 $\sum y^2$ 都約為 $1/(2g)=${texNum(1 / (2 * g), 4)}$：延遲幾乎不影響雜訊。`
            : String.raw`$g$ 不小時延遲的代價很明顯；$g\to g^*(1)=1$ 時 $\sigma_w$ 會先爆掉——穩定邊界不是「還能用」的邊界。`,
          String.raw`$\sigma_w$ 是 gain-equivalent 的係數雜訊，還要乘上 code 才是 DTC 的 timing error（HC-DB.5）。`,
        ],
      }
    },
    tips: [
      String.raw`預設數字是規格 T13：$g=${texNum(G_T13)}$ 就是 HC-DB.1 的答案，$\sigma_w|_{d=0}$ 應為 $${texNum(REF.t13.sigmaW, 4)}\ \mathrm{fs}$（文中推導 3 的數字）。`,
      String.raw`$N$ 是 2 的偶數次方時 $\sqrt N$ 可以心算（$\sqrt{${BASE.N}}=${Math.sqrt(BASE.N)}$），所以也可以算 $\sigma_w=\mu\sqrt{P_x\sum y^2}\,/\sqrt N$。`,
      String.raw`快速估算：$g\le0.1$ 時 $\sum y^2\approx1/(2g)$，$\sigma_w\approx\mu\sqrt{P_x/(2gN)}$；它比 $d=0$ 的精確值小約 $g/4$（不到 2.5%）。`,
    ],
  },

  // ───────────── HC-DB.4：preconditioner 的雜訊代價（F-DB.4，推導 7） ─────────────
  {
    id: 'HC-DB.4',
    title: String.raw`Preconditioner 的代價：兩個 mode 的係數雜訊差 $\sqrt\kappa$ 倍`,
    page: PAGE,
    formulaId: 'F-DB.4',
    formulaTex: String.raw`\begin{gathered}\tilde\lambda_\pm=1\pm\rho,\qquad \kappa=\frac{\tilde\lambda_+}{\tilde\lambda_-},\qquad \mathrm{Var}(\xi_\pm)=\frac{\mu^2}{N\,g\,(2-g)}\cdot\frac{1}{\tilde\lambda_\pm}\\[4pt]\frac{\sigma_{\xi,-}}{\sigma_{\xi,+}}=\sqrt\kappa,\qquad \sigma_w=\sqrt{\tfrac12\big(\mathrm{Var}(\xi_+)+\mathrm{Var}(\xi_-)\big)}\qquad\big(\mathbf M=\mu\tilde{\mathbf R}^{-1},\ P_x=|H|=1,\ \theta=0^\circ\big)\end{gathered}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 10000, practice: { choices: [5, 10, 20] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'g', symbol: 'g', label: '每個 mode 的 loop gain（HC-DB.1 的結果）', default: G_T13, min: 0.0001, max: 2, practice: { choices: [0.05, 0.1, 0.2, 0.5] } },
      { key: 'rho', symbol: String.raw`\rho`, label: '兩個 regressor 的相關係數', default: 0.99, min: 0, max: 1, practice: { choices: [0.5, 0.8, 0.9, 0.99] } },
    ],
    validate: ({ g, rho }) => {
      if (rho >= 1)
        return String.raw`$\rho=1$：$\tilde\lambda_-=0$，兩個 regressor 完全相同，「差」的方向不可辨識（條件 1 不成立），$\tilde{\mathbf R}^{-1}$ 不存在，$\kappa$ 與弱方向的雜訊都是無限大。`
      if (g <= 0 || g >= 2)
        return String.raw`需要 $0<g<2$：preconditioner 讓每個 mode 的 pole 都是 $p=1-g=${texNum(1 - g)}$，$|p|\ge1$ 時沒有穩態（條件 3），variance 無界。`
      return null
    },
    solve: ({ mu, N, g, rho }) => {
      // P_x = |H| = 1、θ = 0（C = 1）；σ_v 取成讓模型的 g 等於輸入值
      const base: ThesisParams = { ...BASE, mu, N, sigmaV: sigmaVForGain(mu, g), twoParam: true, rho }
      const pc = evaluateThesis({ ...base, update: 'precond' })
      const sc = evaluateThesis({ ...base, update: 'scalar' })
      const [strong, weak] = pc.modes
      const lamP = strong.lam
      const lamM = weak.lam
      const kappa = pc.kappa
      const gg = g * (2 - g)
      const V0 = (mu * mu) / (N * gg) // 單一純量迴路的 σ_w²（HC-DB.3，d = 0、P_x = 1）
      const sS = Math.sqrt(strong.variance)
      const sW = Math.sqrt(weak.variance)
      const ratio = sW / sS
      const sum = strong.variance + weak.variance
      const notes: string[] = [String.raw`驗算（F-DB.4）：比值應等於 $\sqrt\kappa=\sqrt{${texNum(kappa)}}=${texNum(Math.sqrt(kappa))}$——和 $\mu$、$N$、$g$ 都無關，只由 $\rho$ 決定。`]
      // 一般 LMS 的兩個 mode：強方向 loop gain g·λ̃₊、弱方向 g·λ̃₋。g ≤ 2/(λ̃₊ + λ̃₋) = 1 時最慢的是弱方向；
      // g 更大時強方向過衝（pole 靠近 −1），最慢的反而是強方向——不能再把最慢的 block 數說成「弱方向」的。
      // 這一題 d = 0，「誰最慢」直接比 |pole|（等價於 g > 1 且 ρ > 0）：只比取整後的 block 數的話，g 略大於 1 時兩者同數，
      // 會落回下面那句「代價是 σ_w 變成…快與安靜不能兼得」，而 g > 1 時 preconditioner 的 σ_w 其實比較小。
      // σ_w(precond)/σ_w(一般 LMS) = √(((2−g)² − g²ρ²)/((2−g)²(1−ρ²)))：ρ = 0 或 g = 1 時恰好是 1，這兩種情況沒有「代價」可言，各寫一句。
      const [scStrong, scWeak] = sc.modes
      const noCorrelation = rho < 1e-9 // ρ = 0：R̃ = I，兩種更新是同一件事
      const atBoundary = Math.abs(g - 1) <= 1e-9 // g = 1：兩個方向的 |pole| 都是 ρ，σ_w 的比值恰好是 1
      const weakIsSlowest = atBoundary || !(scStrong.radius > scWeak.radius * (1 + 1e-12))
      const sameCount = scWeak.t95Blocks === sc.slowT95Blocks
      if (sc.stable && noCorrelation)
        notes.push(
          String.raw`對照一般 LMS（$\mathbf M=\mu\mathbf I$，同一組數字）：$\rho=0$ 時 $\tilde{\mathbf R}=\mathbf I$，preconditioner 和一般 LMS 是同一個更新——每個係數的 $\sigma_w$ 同樣是 $${texNum(sc.sigmaW, 4)}\ \mathrm{fs}$，衰減 95% 同樣要 $${texInt(sc.slowT95Blocks)}$ 個 block。兩個 regressor 有相關（$\rho\ne0$）時 preconditioner 才比較快；它比較吵是在 $g<1$ 的時候。`,
        )
      else if (sc.stable && atBoundary)
        notes.push(
          String.raw`對照一般 LMS（$\mathbf M=\mu\mathbf I$，同一組數字）：每個係數的 $\sigma_w=${texNum(sc.sigmaW, 4)}\ \mathrm{fs}$，弱方向衰減 95% 要 $${texInt(scWeak.t95Blocks)}$ 個 block；preconditioner 只要 $${texInt(pc.slowT95Blocks)}$ 個 block，$\sigma_w$ 也是 $${texNum(pc.sigmaW, 4)}\ \mathrm{fs}$。$g=1$ 剛好是分界：$g<1$ 時 preconditioner 比較吵（快與安靜要取捨），$g>1$ 時它反而比較安靜。`,
        )
      else if (sc.stable && weakIsSlowest)
        notes.push(
          String.raw`對照一般 LMS（$\mathbf M=\mu\mathbf I$，同一組數字）：每個係數的 $\sigma_w=${texNum(sc.sigmaW, 4)}\ \mathrm{fs}$，但弱方向衰減 95% 要 $${texInt(scWeak.t95Blocks)}$ 個 block；preconditioner 只要 $${texInt(pc.slowT95Blocks)}$ 個 block，代價是 $\sigma_w$ 變成 $${texNum(pc.sigmaW, 4)}\ \mathrm{fs}$（$${texNum(pc.sigmaW / sc.sigmaW, 3)}$ 倍）。快與安靜不能兼得。`,
        )
      else if (sc.stable)
        notes.push(
          String.raw`對照一般 LMS（$\mathbf M=\mu\mathbf I$，同一組數字）：每個係數的 $\sigma_w=${texNum(sc.sigmaW, 4)}\ \mathrm{fs}$；這個 $g$ 已經超過 $2/(\tilde\lambda_++\tilde\lambda_-)=1$，強方向過衝（loop gain $g\,\tilde\lambda_+=${texNum(scStrong.gain)}$，pole $1-g\,\tilde\lambda_+=${texNum(1 - scStrong.gain)}$），最慢的反而是強方向，衰減 95% 要 $${texInt(scStrong.t95Blocks)}$ 個 block（弱方向 $${texInt(scWeak.t95Blocks)}$ 個${sameCount ? '，取整後相同' : ''}）；preconditioner 只要 $${texInt(pc.slowT95Blocks)}$ 個 block，$\sigma_w$ 是 $${texNum(pc.sigmaW, 4)}\ \mathrm{fs}$（$${texNum(pc.sigmaW / sc.sigmaW, 3)}$ 倍：$g>1$ 時它反而比較小）。`,
        )
      else
        notes.push(
          String.raw`對照一般 LMS（$\mathbf M=\mu\mathbf I$）：強方向的 loop gain 是 $g\,\tilde\lambda_+=${texNum(g * lamP)}\ge2$，已經不穩；preconditioner 把每個 mode 都拉回 $g=${texNum(g)}$ 才收斂。`,
        )
      return {
        steps: [
          { tex: String.raw`\tilde\lambda_+=1+\rho=1+${texNum(rho)}=${texNum(lamP)}`, why: String.raw`「和」的方向 $(1,1)/\sqrt2$：兩個 regressor 同進同退，看得最清楚（強方向）。` },
          { tex: String.raw`\tilde\lambda_-=1-\rho=1-${texNum(rho)}=${texNum(lamM)}`, why: String.raw`「差」的方向 $(1,-1)/\sqrt2$：$\rho$ 越接近 1 越看不見（弱方向）。` },
          { tex: String.raw`\kappa=\frac{\tilde\lambda_+}{\tilde\lambda_-}=\frac{${texNum(lamP)}}{${texNum(lamM)}}=${texNum(kappa)}`, why: String.raw`condition number：強、弱方向的資訊量比。` },
          { tex: String.raw`g\,(2-g)=${texNum(g)}\times${texNum(2 - g)}=${texNum(gg)}`, why: String.raw`preconditioner 讓兩個 mode 的 pole 都是 $p=1-g$；這是 $1-p^2$。` },
          { tex: String.raw`N\,g\,(2-g)=${texInt(N)}\times${texNum(gg)}=${texNum(N * gg)}`, why: String.raw`再乘上 block 長度。` },
          {
            tex: String.raw`V_0=\frac{\mu^2}{N\,g\,(2-g)}=\frac{${texNum(mu)}^2}{${texNum(N * gg)}}=\frac{${texNum(mu * mu)}}{${texNum(N * gg)}}=${texNum(V0)}\ \mathrm{fs^2}`,
            why: String.raw`只有一個參數時的 $\sigma_w^2$（推導 3、HC-DB.3）。兩個 mode 的 variance 都是它除以自己的 $\tilde\lambda$。`,
          },
          { tex: String.raw`\mathrm{Var}(\xi_+)=\frac{V_0}{\tilde\lambda_+}=\frac{${texNum(V0)}}{${texNum(lamP)}}=${texNum(strong.variance)}\ \mathrm{fs^2}`, why: String.raw`強方向：$\tilde{\mathbf R}^{-1}$ 的增益 $1/\tilde\lambda_+$ 小於 1，雜訊反而被壓小。` },
          { tex: String.raw`\mathrm{Var}(\xi_-)=\frac{V_0}{\tilde\lambda_-}=\frac{${texNum(V0)}}{${texNum(lamM)}}=${texNum(weak.variance)}\ \mathrm{fs^2}`, why: String.raw`弱方向：增益 $1/\tilde\lambda_-$ 很大，GMAC 雜訊被放大。` },
          { tex: String.raw`\sigma_{\xi,+}=\sqrt{\mathrm{Var}(\xi_+)}=\sqrt{${texNum(strong.variance)}}=${texNum(sS)}\ \mathrm{fs}`, why: String.raw`開根號（計算機的 $\sqrt{x}$ 鍵）。` },
          { tex: String.raw`\sigma_{\xi,-}=\sqrt{\mathrm{Var}(\xi_-)}=\sqrt{${texNum(weak.variance)}}=${texNum(sW)}\ \mathrm{fs}`, why: String.raw`再開一次根號。` },
          { tex: String.raw`\frac{\sigma_{\xi,-}}{\sigma_{\xi,+}}=\frac{${texNum(sW)}}{${texNum(sS)}}=${texNum(ratio)}`, why: String.raw`弱方向比強方向吵幾倍。` },
          {
            tex: String.raw`\sigma_w=\sqrt{\tfrac12\big(\mathrm{Var}(\xi_+)+\mathrm{Var}(\xi_-)\big)}=\sqrt{\frac{${texNum(strong.variance)}+${texNum(weak.variance)}}{2}}=\sqrt{${texNum(sum / 2)}}=${texNum(pc.sigmaW)}\ \mathrm{fs}`,
            why: String.raw`換回單一係數：$\delta_1=(\xi_++\xi_-)/\sqrt2$，兩個 mode 互不相關，variance 各取一半再相加。這就是體檢顯示的 $\sigma_w$。`,
          },
        ],
        results: [
          { symbol: String.raw`\kappa`, label: 'condition number', value: kappa },
          { symbol: String.raw`\sigma_{\xi,+}`, label: '強方向的雜訊 RMS', value: sS, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_{\xi,-}`, label: '弱方向的雜訊 RMS', value: sW, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\sigma_{\xi,-}/\sigma_{\xi,+}`, label: '弱方向比強方向吵幾倍', value: ratio },
          { symbol: String.raw`\sigma_w`, label: '每個係數的雜訊 RMS', value: pc.sigmaW, unit: String.raw`\mathrm{fs}` },
        ],
        notes,
      }
    },
    tips: [
      String.raw`預設數字就是體檢的 preset「$\rho=0.99$ ＋ preconditioner」：載入它（Engineer 以上的模式），eigen-mode 表的 $\sigma_{\xi,i}$ 欄應該是 $${texNum(Math.sqrt(REF.precond.modes[0].variance), 4)}$ 與 $${texNum(Math.sqrt(REF.precond.modes[1].variance), 4)}\ \mathrm{fs}$，指標表的 $\sigma_w=${texNum(REF.precond.sigmaW, 4)}\ \mathrm{fs}$（超過 $${texNum(DEFAULT_PARAMS.jitterBudget)}\ \mathrm{fs}$ 的預算，條件 4 未通過）。`,
      String.raw`$V_0$ 就是 HC-DB.3 的 $\sigma_w^2$（$d=0$、$P_x=1$）：預設數字時 $V_0=${texNum(REF.t13.sigmaW ** 2, 4)}\ \mathrm{fs^2}$，也就是 $${texNum(REF.t13.sigmaW, 4)}^2$。`,
      String.raw`開根號用計算機的 $\sqrt{x}$ 鍵；$\sqrt{199}\approx14.1$（因為 $14^2=196$）。`,
      String.raw`「慢模式要幾個 block」的手算（598 的由來）在 Ch09 的 HC-09.3 與 Ch10 的 HC-10.2；這一題只算雜訊這一面。`,
      String.raw`這一題取 $\theta=0^\circ$：兩個 regressor 的交叉相關就是 $C\,\tilde{\mathbf R}$。$\theta\ne0^\circ$ 時要另外確認交叉相關的假設（體檢會提醒；F-DB.6）。`,
    ],
  },

  // ───────────── HC-DB.5：System-level（F-DB.5，推導 4） ─────────────
  {
    id: 'HC-DB.5',
    title: String.raw`換算到 DTC 輸出：$\sigma_{\delta t}$、tone 幅度 $A_t$、調變指數 $\beta$ 與 spur`,
    page: PAGE,
    formulaId: 'F-DB.5',
    formulaTex: String.raw`\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)},\qquad A_t=\sqrt{2P_x}\,|\Delta w|,\qquad \beta=2\pi f_{\mathrm{out}}\,|T|\,A_t,\qquad \mathrm{Spur}\approx20\log_{10}\frac{\beta}{2}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaW', symbol: String.raw`\sigma_w`, label: '係數雜訊（HC-DB.3 的結果）', unit: String.raw`\mathrm{fs}`, default: SIGMA_W_T15, min: 0, max: 100, practice: { choices: [0.2, 0.4, 0.8] } },
      { key: 'dW', symbol: String.raw`\Delta w`, label: 'gain bias（HC-DB.2 的結果）', unit: String.raw`\mathrm{fs}`, default: 0.5, min: -100, max: 100, practice: { choices: [0.1, 0.25, 0.5, 1] } },
      { key: 'Px', symbol: 'P_x', label: 'code 功率（單頻 code 的振幅平方除以 2）', default: 0.5, min: 0.01, max: 4, practice: { choices: [0.5, 1] } },
      { key: 'fout', symbol: String.raw`f_{\mathrm{out}}`, label: 'PLL 輸出頻率', unit: String.raw`\mathrm{GHz}`, default: 13, min: 0.1, max: 100, practice: { choices: [5, 10, 13] } },
      { key: 'Tmag', symbol: '|T|', label: 'PLL output transfer 在 tone 頻率的幅度', default: 1, min: 0.001, max: 4, practice: { choices: [0.5, 1] } },
    ],
    validate: ({ sigmaW, dW, Px, fout, Tmag }) => {
      if (dW === 0) return String.raw`$\Delta w=0$：沒有 gain bias 就沒有這一根 code tone（$A_t=0$，$\log_{10}0$ 沒有定義）。請輸入非零的 $\Delta w$。`
      const beta = systemCase(sigmaW, dW, Px, fout, Tmag).betaRad
      if (beta > BETA_SMALL_ANGLE_MAX)
        return String.raw`$\beta=2\pi f_{\mathrm{out}}|T|A_t=${texNum(beta, 3)}\ \mathrm{rad}$ 已經不算小角度：$\mathrm{Spur}\approx20\log_{10}(\beta/2)$ 的相對誤差約 $\beta^2/8$，這一題只在 $\beta\le${BETA_SMALL_ANGLE_MAX}$ 時使用（更大要用 Bessel 函數 $J_1(\beta)/J_0(\beta)$，見 Ch12）。請減小 $\Delta w$、$f_{\mathrm{out}}$ 或 $|T|$。`
      return null
    },
    solve: ({ sigmaW, dW, Px, fout, Tmag }) => {
      const r = systemCase(sigmaW, dW, Px, fout, Tmag)
      const At = r.AtPeak
      const beta = r.betaRad
      const spur = r.spurDbc
      const sum2 = dW * dW + sigmaW * sigmaW
      const logHalf = Math.log10(beta / 2)
      return {
        steps: [
          {
            tex: String.raw`\Delta w^2+\sigma_w^2=${texNumP(dW)}^2+${texNum(sigmaW)}^2=${texNum(dW * dW)}+${texNum(sigmaW * sigmaW)}=${texNum(sum2)}\ \mathrm{fs^2}`,
            why: String.raw`固定的 bias 與隨機的係數雜訊互不相關，功率（平方）相加。`,
          },
          {
            tex: String.raw`\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)}=\sqrt{${texNum(Px)}\times${texNum(sum2)}}=\sqrt{${texNum(Px * sum2)}}=${texNum(r.sigmaDt)}\ \mathrm{fs}`,
            why: String.raw`乘上 code 功率再開根號（$\sqrt{x}$ 鍵）：DTC-referred 的 timing error RMS（還沒經過 PLL 的 output transfer，不能直接叫輸出 jitter）。`,
          },
          {
            tex: String.raw`A_t=\sqrt{2P_x}\,|\Delta w|=\sqrt{${texNum(2 * Px)}}\times${texNum(Math.abs(dW))}=${texNum(Math.sqrt(2 * Px))}\times${texNum(Math.abs(dW))}=${texNum(At)}\ \mathrm{fs}`,
            why: String.raw`單頻 code 的振幅是 $A=\sqrt{2P_x}$；bias 那一項是 peak 值 $A\,|\Delta w|$ 的 timing tone。`,
          },
          {
            tex: String.raw`\beta=2\pi f_{\mathrm{out}}\,|T|\,A_t=2\pi\times${texNum(fout)}\times10^{9}\times${texNum(Tmag)}\times${texNum(At)}\times10^{-15}=${texNum(beta)}\ \mathrm{rad}`,
            why: String.raw`時間換成相位要乘 $2\pi f_{\mathrm{out}}$；GHz 是 $10^{9}$、fs 是 $10^{-15}$，指數合起來是 $10^{-6}$。先把前面的數字連乘，最後再補上 $10^{-6}$。`,
          },
          { tex: String.raw`\frac{\beta}{2}=\frac{${texNum(beta)}}{2}=${texNum(beta / 2)}`, why: String.raw`小角度相位調變：載波兩側各一根 sideband，振幅是載波的 $\beta/2$。` },
          { tex: String.raw`\log_{10}\frac{\beta}{2}=\log_{10}(${texNum(beta / 2)})=${texNum(logHalf)}`, why: String.raw`計算機的 log 鍵（以 10 為底，不是 ln）。結果是負的，因為 $\beta/2<1$。` },
          { tex: String.raw`\mathrm{Spur}\approx20\log_{10}\frac{\beta}{2}=20\times${texNumP(logHalf)}=${texNum(spur)}\ \mathrm{dBc}`, why: String.raw`振幅比換成 dB 要乘 20。` },
        ],
        results: [
          { symbol: String.raw`\sigma_{\delta t}`, label: 'DTC-referred timing error', value: r.sigmaDt, unit: String.raw`\mathrm{fs}` },
          { symbol: 'A_t', label: 'timing tone 的 peak 值', value: At, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\beta`, label: '調變指數', value: beta, unit: String.raw`\mathrm{rad}` },
          { symbol: String.raw`\mathrm{Spur}`, label: '每根 sideband', value: spur, unit: String.raw`\mathrm{dBc}`, tolerance: { abs: 0.1 } },
        ],
        notes: [
          String.raw`$\beta=${texNum(beta)}\ll1$，小角度近似成立（相對誤差約 $\beta^2/8=${texNum((beta * beta) / 8, 2)}$）。$\Delta w$ 每減半，spur 降 $20\log_{10}2=${texNum(20 * Math.log10(2), 3)}\ \mathrm{dB}$。`,
          String.raw`只計了 gain bias 造成的 code tone；$\varepsilon_{\mathrm{det}}$ 本身（例如 INL 殘差）與 6-bit 量化的 tone 要另外算（Ch11、Ch13）。`,
        ],
      }
    },
    tips: [
      String.raw`預設數字就是規格 T15，也是體檢的 preset「$13\,\mathrm{GHz}$、$0.5\,\mathrm{fs}$ peak tone（T15）」：$A_t=${texNum(REF.t15.AtPeak)}\ \mathrm{fs}$ peak、$${REF.t15.params.foutGHz}\ \mathrm{GHz}$、$|T|=${REF.t15.params.Tmag}$，得到 $\beta=${texNum(REF.t15.betaRad, 4)}\ \mathrm{rad}$、spur $=${texNum(REF.t15.spurDbc, 4)}\ \mathrm{dBc}$；載入那個 preset，指標表的 $\sigma_w=${texNum(SIGMA_W_T15)}\ \mathrm{fs}$、$\sigma_{\delta t}$ 合計 $=${texNum(REF.t15.sigmaDt, 4)}\ \mathrm{fs}$。`,
      String.raw`心算檢查：$2\pi\times${REF.t15.params.foutGHz}\approx${texNum(2 * Math.PI * REF.t15.params.foutGHz, 3)}$，所以 $\beta\approx${texNum(2 * Math.PI * REF.t15.params.foutGHz, 3)}\times A_t\times10^{-6}$（$A_t$ 以 fs 計）。`,
      String.raw`沒有 log 鍵：把 $\beta/2$ 寫成 $m\times10^{e}$，則 $20\log_{10}(\beta/2)=20e+20\log_{10}m$；記住 $20\log_{10}2\approx6.02$、$20\log_{10}3\approx9.54$、$20\log_{10}5\approx13.98$ 就能估到 1 dB 以內。`,
    ],
  },

  // ───────────── HC-DB.6：綜合（六個條件一次算完；思考題之前） ─────────────
  {
    id: 'HC-DB.6',
    title: String.raw`綜合手算：一組晶片數字，六個條件一次算完（單參數、$d=0$）`,
    page: PAGE,
    formulaTex: String.raw`g=\mu K_q\cos\phi,\qquad \sigma_w=\frac{\mu}{\sqrt{N\,g\,(2-g)}},\qquad \Delta w=\frac{B}{\cos\phi},\qquad \sigma_{\delta t}=\sqrt{\Delta w^2+\sigma_w^2}\quad(P_x=|H|=1)`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'sigmaV', symbol: String.raw`\sigma_v`, label: 'comparator 前雜訊 RMS', unit: String.raw`\mathrm{fs}`, default: 100, min: 1, max: 1000, practice: { choices: [50, 100, 200] } },
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率', unit: String.raw`\mathrm{fs}`, default: 10, min: 0.001, max: 10000, practice: { choices: [5, 10, 20, 40] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', default: 4096, min: 1, max: 1048576, integer: true, practice: { choices: [1024, 4096, 16384] } },
      { key: 'phi', symbol: String.raw`\phi`, label: 'error path 在 code 頻率的相位', unit: String.raw`^\circ`, default: 0, min: -180, max: 180, practice: { choices: [0, 45, 60] } },
      { key: 'B', symbol: 'B', label: 'code 相關干擾與 code 的相關', unit: String.raw`\mathrm{fs}`, default: 0.1, min: -100, max: 100, practice: { choices: [0.1, 0.3, 0.5] } },
      { key: 'budget', symbol: String.raw`\sigma_{\delta t,\max}`, label: 'DTC-referred timing error 預算', unit: String.raw`\mathrm{fs}`, default: 1, min: 0.001, max: 1000, practice: { choices: [0.5, 1] } },
    ],
    validate: ({ sigmaV, mu, phi }) => {
      const r = evaluateThesis({ ...BASE, sigmaV, mu, phiDeg: phi, D: 0, d: 0 })
      if (r.polarity.C <= 0)
        return String.raw`$C=\cos\phi=${texNum(r.polarity.cosTheta)}\le0$：條件 2「更新方向正確」不成立，平均誤差不收斂，後面的 $\sigma_w$、$\Delta w$ 都沒有意義。請用 $|\phi|<90^\circ$。`
      if (r.g >= 2) return String.raw`$g=${texNum(r.g)}\ge2$：條件 3「動態穩定」不成立（$|p|\ge1$），$\sigma_w$ 無界。請減小 $\mu$ 或加大 $\sigma_v$。`
      return null
    },
    solve: ({ sigmaV, mu, N, phi, B, budget }) => {
      const r = evaluateThesis({ ...DEFAULT_PARAMS, sigmaV, mu, N, phiDeg: phi, B, jitterBudget: budget, Px: 1, Hmag: 1, D: 0, d: 0 })
      const { Kq, g } = r
      const C = r.polarity.C
      const gg = g * (2 - g)
      const root = Math.sqrt(N * gg)
      const sum2 = r.deltaW * r.deltaW + r.sigmaW * r.sigmaW
      const verdicts = CONDITION_ORDER.map((id, i) => {
        const c = r.checks.find((k) => k.id === id)
        return c ? `${i + 1}. ${CONDITION_ZH[id]}：${STATE_ZH[c.state]}` : ''
      }).filter(Boolean)
      // 沒有通過的條件：直接引用體檢給的原因（同一份文字，`$…$` 內為 TeX）
      const reasons = CONDITION_ORDER.flatMap((id, i) => {
        const c = r.checks.find((k) => k.id === id)
        return c && c.state !== 'ok' ? [`條件 ${i + 1}（${STATE_ZH[c.state]}）：${c.reason}`] : []
      })
      return {
        steps: [
          {
            tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${texNum(SQRT_2_OVER_PI)}}{${texNum(sigmaV)}}=${texNum(Kq)}\ \mathrm{fs^{-1}}`,
            why: String.raw`comparator 的統計增益；分子 $\sqrt{2/\pi}=${texNum(SQRT_2_OVER_PI)}$ 是 HC-DB.1 第 1 步算過的常數。`,
          },
          { tex: String.raw`C=\cos\phi=\cos(${texNum(phi)}^\circ)=${texNum(C)}`, why: String.raw`$P_x=|H|=1$、$D=0$，所以 $C$ 就是 $\cos\phi$（計算機用 DEG 模式）。$C>0$：條件 2 成立。` },
          { tex: String.raw`g=\mu\,K_q\,C=${texNum(mu)}\times${texNum(Kq)}\times${texNum(C)}=${texNum(g)}`, why: String.raw`$0<g<2$：條件 3 成立（$d=0$）。` },
          { tex: String.raw`g\,(2-g)=${texNum(g)}\times${texNum(2 - g)}=${texNum(gg)}`, why: String.raw`等比級數的分母 $1-p^2$。` },
          { tex: String.raw`N\,g\,(2-g)=${texInt(N)}\times${texNum(gg)}=${texNum(N * gg)}`, why: String.raw`乘上 block 長度：$N$ 越大，雜訊被平均得越乾淨。` },
          // 寫成兩行：一行排在手機上會比正文欄寬 3px，多出一條沒有用途的橫向捲軸
          { tex: String.raw`\begin{aligned}\sqrt{N\,g\,(2-g)}&=\sqrt{${texNum(N * gg)}}\\&=${texNum(root)}\end{aligned}`, why: String.raw`開根號（$\sqrt{x}$ 鍵）。` },
          {
            tex: String.raw`\sigma_w=\frac{\mu}{\sqrt{N\,g\,(2-g)}}=\frac{${texNum(mu)}}{${texNum(root)}}=${texNum(r.sigmaW)}\ \mathrm{fs}`,
            why: String.raw`條件 4：$\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)$，$\sigma_\eta^2=1/N$。`,
          },
          { tex: String.raw`\Delta w=\frac{B}{C}=\frac{${texNum(B)}}{${texNum(C)}}=${texNum(r.deltaW)}\ \mathrm{fs}`, why: String.raw`條件 5：GMAC 歸零時 gain 的偏移。` },
          {
            tex: String.raw`\Delta w^2+\sigma_w^2=${texNumP(r.deltaW)}^2+${texNum(r.sigmaW)}^2=${texNum(r.deltaW * r.deltaW)}+${texNum(r.sigmaW * r.sigmaW)}=${texNum(sum2)}\ \mathrm{fs^2}`,
            why: String.raw`bias 與雜訊互不相關：平方後相加。`,
          },
          {
            tex: String.raw`\sigma_{\delta t}=\sqrt{\Delta w^2+\sigma_w^2}=\sqrt{${texNum(sum2)}}=${texNum(r.sigmaDt)}\ \mathrm{fs}`,
            why: String.raw`條件 6：開根號（$P_x=1$），再和預算 $${texNum(budget)}\ \mathrm{fs}$ 比。`,
          },
        ],
        results: [
          { symbol: 'g', label: 'loop gain', value: g, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: String.raw`\sigma_w`, label: '係數雜訊', value: r.sigmaW, unit: String.raw`\mathrm{fs}` },
          { symbol: String.raw`\Delta w`, label: 'gain bias', value: r.deltaW, unit: String.raw`\mathrm{fs}`, tolerance: { abs: 1e-6, rel: 0.01 } },
          { symbol: String.raw`\sigma_{\delta t}`, label: 'DTC-referred timing error', value: r.sigmaDt, unit: String.raw`\mathrm{fs}` },
        ],
        notes: [
          `體檢（同一個計算核心）對這組數字的判定——${verdicts.join('；')}。`,
          r.sigmaDt <= budget
            ? String.raw`$\sigma_{\delta t}=${texNum(r.sigmaDt)}\ \mathrm{fs}\le${texNum(budget)}\ \mathrm{fs}$：timing error 在預算內。`
            : String.raw`$\sigma_{\delta t}=${texNum(r.sigmaDt)}\ \mathrm{fs}>${texNum(budget)}\ \mathrm{fs}$：超出預算——即使條件 2–5 的數字各自看起來都不大。`,
          ...reasons,
        ],
      }
    },
    tips: [
      String.raw`預設數字是本頁「動手體檢」的預設值（T13 加上 $B=${texNum(DEFAULT_PARAMS.B)}\ \mathrm{fs}$）：$g=${texNum(REF.dflt.g)}$、$\sigma_w=${texNum(REF.dflt.sigmaW, 4)}\ \mathrm{fs}$、$\Delta w=${texNum(REF.dflt.deltaW, 4)}\ \mathrm{fs}$、$\sigma_{\delta t}=${texNum(REF.dflt.sigmaDt, 4)}\ \mathrm{fs}$。`,
      String.raw`$N$ 取 $1024$、$4096$、$16384$ 時 $\sqrt N=32$、$64$、$128$，可以把第 5–6 步改成 $\sqrt N\times\sqrt{g(2-g)}$ 來算。`,
      String.raw`算完後把同一組數字輸入「動手體檢」，六個燈號與指標表應該和你的手算一致。條件 6 還包含 spur 上限（體檢預設 $${texNum(DEFAULT_PARAMS.spurLimit)}\ \mathrm{dBc}$、$f_{\mathrm{out}}=${DEFAULT_PARAMS.foutGHz}\ \mathrm{GHz}$），spur 的手算在 HC-DB.5。`,
      String.raw`條件 1（identifiability）在單參數、$P_x=|H|=1$ 時自動成立（$\lambda_{\min}=1$）；兩個參數的情況見 HC-DB.4。`,
    ],
  },
]

export function handcalc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`unknown handcalc ${id}`)
  return def
}
