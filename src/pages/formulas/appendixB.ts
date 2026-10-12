import { batchOptima, gaussianLyapunov, meanSquareFactor } from '@/simulation/models/lms'
import { kq, kqLocal, linearizationRelError, sumVarianceAr1 } from '@/simulation/models/comparator'
import { ctHpd } from '@/simulation/models/polarity'
import { delayCriticalGain, pmWithDelay } from '@/simulation/models/stability'
import { cAbs, cArg, cSub, c } from '@/simulation/core'
import type { RefValues } from './refValues'
import { T13_SETUP } from './refValues'
import { texHz, texNum, texPct } from './format'

/**
 * 附錄 B「數學與工程上的關鍵限制」（修正版，含勘誤 E36 的「週期」用字）＋ 本站依勘誤補充的 5 條。
 * 每條附一個**算出來的**反例或數字（example），說明「如果忘了這條限制會錯多少」。
 */
export interface Limitation {
  key: string
  /** 規格附錄 B 的編號（1–10）；本站補充者為 null */
  specNo: number | null
  title: string
  /** 限制本身（rich） */
  text: string
  /** 為什麼（rich） */
  why: string
  example?: (r: RefValues) => string
  errata: string[]
  pages: string[]
}

export const LIMITATIONS: Limitation[] = [
  {
    key: 'paths',
    specNo: 1,
    title: 'PLL 的 H(z) 並非一種通用定義',
    text: String.raw`PLL error transfer、DTC 輸入到 PD、gain register 到 phase error、noise 到 output 都是不同路徑，必須依注入位置推導。`,
    why: String.raw`同一個 DTC 殘差（在 PD 的 reference 輸入注入）：到 PD 是 $H_{\mathrm{PD}}=1/(1+L)$（high-pass），到 output 是 $T=L/(1+L)$（low-pass），兩者都是正號，$H_{\mathrm{PD}}+T=1$。算更新極性 $C$ 用前者，算 output jitter 用後者；而且算 $C$ 要用 DT 的 $H(e^{j\Omega})$。`,
    example: () => {
      const h = ctHpd('typeII', 0.3, 0.7)
      const t = cSub(c(1), h)
      const deg = (cArg(h) * 180) / Math.PI
      return String.raw`Type-II、$\zeta=0.7$、$\omega=0.3\omega_n$（CT 參考模型）：$H_{\mathrm{PD}}=${texNum(h.re)}${h.im >= 0 ? '+' : '-'}j${texNum(Math.abs(h.im))}$，相位 $${texNum(deg)}^\circ$（$\operatorname{Re}<0$，單頻 $C<0$）；同一頻率 $|T|=${texNum(cAbs(t))}$`
    },
    errata: ['E44'],
    pages: ['ch06', 'ch12'],
  },
  {
    key: 'polarityVsPm',
    specNo: 2,
    title: '純相位差法不等於完整 PM',
    text: String.raw`$\cos\phi>0$ 是理想單頻相關的正負條件；閉迴路動態仍要計算 poles／PM。`,
    why: String.raw`polarity margin 只回答「平均更新方向對不對」。迴路增益 $g$ 太大、或有更新延遲 $d$ 時，方向正確的迴路一樣會不穩定。`,
    example: () => {
      const pm = pmWithDelay(1.5, 1)
      return String.raw`$\theta=0^\circ$（$M_{\mathrm{polarity}}=90^\circ$ 最好）但 $g=1.5$、$d=1$：$g^*(1)=${texNum(delayCriticalGain(1))}$，$\mathrm{PM}_1=${texNum(pm.pmDeg)}^\circ<0$ ⇒ 發散`
    },
    errata: ['E20'],
    pages: ['ch08'],
  },
  {
    key: 'kqLocal',
    specNo: 3,
    title: 'White Gaussian comparator 的增益不是全域常數',
    text: String.raw`高偏移時 S 曲線飽和，$K_q$ 取決於 operating point、threshold 與 noise PDF。`,
    why: String.raw`$E[q]=\operatorname{erf}(s/\sqrt2\sigma_v)$ 只在原點附近像直線；局部斜率 $K_q(s)=K_q\,e^{-s^2/2\sigma_v^2}$。大初始誤差時每個 block 的步長被限制在 $\mu\max|x|$（slew-limited），線性公式會低估收斂時間。`,
    example: () =>
      String.raw`$s/\sigma_v=0.246$：$K_qs$ 高估 $${texPct(linearizationRelError(0.246))}$；$0.56$：$${texPct(linearizationRelError(0.56))}$；在 $s=\sigma_v$ 處的局部斜率只剩 $${texNum(kqLocal(100, 100) / kq(100), 3)}\,K_q$`,
    errata: ['E48'],
    pages: ['ch05', 'ch14'],
  },
  {
    key: 'noiseCorrelated',
    specNo: 4,
    title: 'Noise 並非一定互相獨立',
    text: String.raw`真實 PLL error 的 DSM、reference／divider、comparator 與 LMS 狀態之間可能共用源頭，不能一律功率相加。`,
    why: String.raw`相關的 comparator 雜訊讓 $N$ 個樣本的「有效樣本數」變少：$\operatorname{Var}(S_N)$ 比 iid 的 $N$ 大，方向判斷需要更多樣本；兩個相關源相加的功率是 $\sigma_1^2+\sigma_2^2+2\rho\sigma_1\sigma_2$。`,
    example: () => {
      const v = sumVarianceAr1(1000, 0.9)
      return String.raw`$N=1000$、雜訊 AR(1) $\rho=0.9$（$s=0$）：$\operatorname{Var}(S_N)=${texNum(v.varSum)}$（iid 為 $1000$），有效樣本數只有 $${texNum(v.nEff)}$`
    },
    errata: [],
    pages: ['ch05', 'ch12', 'roadmap'],
  },
  {
    key: 'indices',
    specNo: 5,
    title: '時域索引嚴格分開',
    text: String.raw`$n$ 為 comparator sample，$k$ 為 GMAC update，$m$ 為可能的更慢 PVT tracking 時間軸。`,
    why: String.raw`block $k$ 涵蓋 $n=kN,\ldots,kN+N-1$。把期望值、sample 索引和 block 索引混在同一條更新式（例如 $w_{k+1}=w_k+\mu E[q[n]u_f[n]]$）會讓實作者無法判斷要累加什麼；PE 窗口的起點也應寫成 sample 索引 $n_0$。`,
    example: (r) =>
      String.raw`$f_s=4\,\mathrm{GHz}$、$N=${T13_SETUP.N}$：1 個 block $=${T13_SETUP.N}$ samples $=${texNum((1 / r.loop.fu) * 1e6)}\,\mu\mathrm{s}$（$f_u=${texHz(r.loop.fu, 7)}$）`,
    errata: ['E35'],
    pages: ['ch04', 'ch07', 'ch09'],
  },
  {
    key: 'lossFixedPoint',
    specNo: 6,
    title: '損失函數與最佳點不完全相同',
    text: String.raw`MSE 的 GMAC 固定點是 $E[ex]=0$；Sign-Error 的固定點是 $E[\operatorname{sign}(e)x]=0$，一般不等價。`,
    why: String.raw`MSE 對大誤差懲罰重（平均值），MAE 對 outlier 穩健（中位數）。Sign-LMS 在雜訊很大時才趨近 MSE 解（comparator 被雜訊「線性化」）。`,
    example: (r) => {
      const o = batchOptima([0, 0, 0, 10])
      return String.raw`$y=[0,0,0,10]$：MSE 解 $${texNum(o.mse)}$、MAE 解 $[${texNum(o.maeLow)},${texNum(o.maeHigh)}]$。三階 INL：MSE $${texNum(r.bias.mse)}$、無雜訊 Sign $${texNum(r.bias.sign0, 6)}$`
    },
    errata: ['E01', 'E40'],
    pages: ['ch01', 'ch02', 'ch11'],
  },
  {
    key: 'pe',
    specNo: 7,
    title: 'PE 是資訊存在的條件，不是保證輸出雜訊低',
    text: String.raw`近 singular 的資訊矩陣可讓係數 noise 很大。`,
    why: String.raw`完整 preconditioner 讓所有 mode 同速收斂，但慢 mode 的雜訊被放大 $1/\lambda_{\min}$ 倍；preconditioner 不能製造缺失的資訊。`,
    example: (r) =>
      String.raw`$\rho=0.99$、$\gamma=0.5$：mode 變異 $${texNum(r.mimo.modeVarSlow)}$ vs $${texNum(r.mimo.modeVarFast)}\,\mathrm{fs^2}$（比值 $\lambda_{\max}/\lambda_{\min}=${texNum(r.mimo.lamMax / r.mimo.lamMin)}$）`,
    errata: ['E37', 'E21'],
    pages: ['ch09', 'ch10'],
  },
  {
    key: 'mc',
    specNo: 8,
    title: '有限樣本 Monte Carlo 不能證明全域穩定',
    text: String.raw`應與解析模型、pole／eigenvalue、最差條件測試結合。`,
    why: String.raw`Gaussian 純量 LMS 在 $2/3<\mu<2.42$ 時：均方發散，但幾乎每條樣本路徑都收斂（heavy tail）。少量 seeds 的 MC 會「看起來收斂」；用長時間 $\delta^2$ 平均加 sample-SE 驗證 MS 界會得到錯誤結論。`,
    example: () =>
      String.raw`$\mu=0.8$：$E[(1-\mu x^2)^2]=${texNum(meanSquareFactor(0.8, 1, 3))}>1$（MS 發散），但 $E\ln|1-\mu x^2|=${texNum(gaussianLyapunov(0.8))}<0$（路徑收斂）`,
    errata: ['E14'],
    pages: ['ch03', 'signoff'],
  },
  {
    key: 'units',
    specNo: 9,
    title: 'Normalized code、gain register 單位不可混淆',
    text: String.raw`一個正規化的 1 可以表示 1 LSB、1 UI、1 ps 或 unit RMS，都會影響 $\mu$ 的單位。`,
    why: String.raw`本站約定：$x,u$ 無因次（正規化 code），時間單位由 $a,w$ 承載（fs）；於是 $K=K_qC$ 為 $\mathrm{fs^{-1}}$、$\mu$ 為 fs、$g=\mu K$ 無因次。另一種自洽的寫法是讓 $x,u$ 帶 fs、$w$ 無因次（此時 $\mu$ 為 $\mathrm{fs^{-1}}$）；不自洽的是兩種混用：$x,u$ 帶 fs 而 $\mu,w$ 也以 fs 計，$g$ 就會帶 $\mathrm{fs}^2$，不再是無因次 loop gain。6-bit register 的 LSB 還要乘 $\Delta_{\mathrm{LSB}}$ 才能接到 fs。`,
    example: (r) => String.raw`T13：$g=10\,\mathrm{fs}\times${texNum(r.loop.K, 6)}\,\mathrm{fs^{-1}}=${texNum(r.loop.g, 6)}$（無因次）`,
    errata: ['E13'],
    pages: ['ch04', 'ch12', 'ch13'],
  },
  {
    key: 'quantTones',
    specNo: 10,
    title: '量化誤差不一定等效獨立白雜訊',
    text: String.raw`決定性循環、PRBS 週期、限幅及非線性產生 tones／spurs，需要 time-domain simulation。`,
    why: String.raw`一階 EFB 對常數有理目標必然進入週期 $q$ 的 limit cycle，總誤差功率也不等於 white-uniform 模型的 $2/12$。規格原文「PRBS 周期」用字依 E36 統一為「週期」。`,
    example: (r) =>
      String.raw`$w_H=32.4$：實際 $${texNum(r.quant.total)}\,\mathrm{LSB^2}$（只有 $f_u/5$、$2f_u/5$ 兩條線）vs white 模型 $${texNum(r.quant.whiteModel)}\,\mathrm{LSB^2}$`,
    errata: ['E15', 'E47', 'E36'],
    pages: ['ch13'],
  },
  // ───────── 本站補充 ─────────
  {
    key: 'ties',
    specNo: null,
    title: 'sign(0) 與 tie rule 必須明定',
    text: String.raw`偶數 $N$ 的 $S_N=0$、comparator 的 $e=0$、Sign-Error 的 $\operatorname{sign}(0)$ 都需要明確規則，Monte Carlo 與解析要用同一條。`,
    why: String.raw`CLT 式（無連續性修正）在偶數 $N$ 近似的是「tie 平分」的機率，不是嚴格的 $P(S_N>0)$。`,
    example: (r) =>
      String.raw`$N=100$：嚴格 $${texNum(r.direction.n100.pos)}$（低於 50%！）、tie $${texNum(r.direction.n100.tie)}$、sign(0)=+1 $${texNum(r.direction.n100PlusRule)}$、CLT $${texNum(r.direction.n100Clt)}$`,
    errata: ['E02', 'E07', 'E40'],
    pages: ['ch05', 'ch02'],
  },
  {
    key: 'bwLabels',
    specNo: null,
    title: '−3 dB 頻寬不是 Noise BW',
    text: String.raw`白雜訊積分要用 ENBW；$f_{3\mathrm{dB}}$ 只是 corner。`,
    why: String.raw`一階 low-pass 的 ENBW $\approx\frac{\pi}{2}f_{3\mathrm{dB}}$；用 $f_{3\mathrm{dB}}$ 乘 $S^{(1)}(0)$ 會低估 variance 約 36%、RMS 約 20%。`,
    example: (r) =>
      String.raw`T14：$f_{3\mathrm{dB}}=${texHz(r.loop.f3dbExact)}$、ENBW $=${texHz(r.loop.enbw)}$；$\sqrt{S^{(1)}(0)f_{3\mathrm{dB}}}=${texNum(r.loop.sigmaFromF3db)}$ vs $\sigma_w=${texNum(r.loop.sigmaW)}\,\mathrm{fs}$`,
    errata: ['E06', 'E10'],
    pages: ['ch12'],
  },
  {
    key: 'kqNorm',
    specNo: null,
    title: '正規化（K_q ≡ 1）的數字不能直接搬到物理單位',
    text: String.raw`§9–10 的 pole 與收斂步數假設 $\mu$ 已吸收 $K_q$；換成物理的 $K_q$（$\mathrm{fs^{-1}}$）要重算。`,
    why: String.raw`pole $=1-\mu K_q\lambda_i$；$K_q=\sqrt{2/\pi}/\sigma_v$、$\sigma_v=100\,\mathrm{fs}$ 時，同一個數值 $\mu=0.5$ 慢了兩個數量級。`,
    example: (r) =>
      String.raw`慢 mode 95% 衰減：$${r.mimo.blocks95}$ blocks（$K_q\equiv1$）vs $${r.mimo.physicalBlocks95}$ blocks（物理 $K_q=${texNum(r.mimo.kqPhysical)}\,\mathrm{fs^{-1}}$、$\mu=0.5\,\mathrm{fs}$）`,
    errata: ['E05', 'E08'],
    pages: ['ch09', 'ch10'],
  },
  {
    key: 'dcNull',
    specNo: null,
    title: '主 PLL 的 DC null 會改變 bias 公式與可觀察性',
    text: String.raw`共用 BBPD 的 type-II 迴路強制 $E[q]=0$；經 $H_{\mathrm{PD}}(1)=0$ 觀測的 DC 分量完全不可觀察。`,
    why: String.raw`靜態 $w^*=a+bE[x]/E[x^2]$ 的 offset bias 在共用 BBPD 時消失，分母變成 $\operatorname{Var}(x)$；GOS/PHOS 的 global offset $b$ 在 u-domain 是零 eigenvalue。`,
    example: () => String.raw`非負 residue $x\sim U[0,1)$：$E[x^2]=1/3$ 但 $\operatorname{Var}(x)=1/12$，差 $${texNum(1 / 3 / (1 / 12))}$ 倍`,
    errata: ['E03', 'E04'],
    pages: ['ch11', 'ch09'],
  },
  {
    key: 'multirate',
    specNo: null,
    title: 'Block-rate 與 sample-rate 的頻譜不能混用',
    text: String.raw`$S_w$ 定義在 $f_u$；放到 sample 軸前要做 ZOH 轉換；DTFT 形式與單邊 per-Hz 之間差 $2/f_r$。`,
    why: String.raw`把 DTFT 形式的 PSD 直接當成 per-Hz 用，$\mathcal L(f)$ 會偏 $10\log_{10}(f_s/2)$；把 block-rate $S_w$ 直接放到 sample 軸，tone 附近的 skirt 約差 $N$ 倍。`,
    example: () => String.raw`$f_s=4\,\mathrm{GHz}$：$10\log_{10}(f_s/2)=${texNum(10 * Math.log10(T13_SETUP.fs / 2))}\,\mathrm{dB}$；$N=${T13_SETUP.N}$ 相當於 $${texNum(10 * Math.log10(T13_SETUP.N))}\,\mathrm{dB}$`,
    errata: ['E09', 'E28', 'E29'],
    pages: ['ch12'],
  },
]
