import { Tex, type SymbolEntry } from '@/components'
import { kqGain, W1 } from '@/simulation/models/sspll'
import { FREF_MHZ, PARAMS, SIM_CFG } from './data'
import { fx, r, txs } from './common'

const T_REF_PS = PARAMS.assumptions.T_ref_ps
const F_VCO_GHZ = PARAMS.assumptions.f_vco_Hz_illustrative / 1e9

/** 本章符號（對應分析文件 §1）。數值欄位由 params.json 與 TS port 計算。 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: r`f_{ref},\ T_{ref}`, meaning: 'reference 頻率／週期', unit: r`\mathrm{Hz},\ \mathrm{s}`, firstSeen: '§0', note: <><Tex>{`${FREF_MHZ / 1000}\\ \\mathrm{GHz}`}</Tex>／<Tex>{`${T_REF_PS}\\ \\mathrm{ps}`}</Tex></> },
  { symbol: 'n', meaning: <>比較器取樣索引（每個 <Tex>{r`T_{ref}`}</Tex> 一個）</>, unit: r`\text{sample}`, firstSeen: '§2', note: '同全站 n' },
  { symbol: 'k', meaning: <>GMAC block 索引（<Tex>{'N'}</Tex> 個 sample 一個 block）；也用作 PMUX 相位編號 <Tex>{r`0..7`}</Tex>（看上下文）</>, unit: r`\text{block}`, firstSeen: '§4', note: '同全站 k' },
  { symbol: r`f,\ \Omega`, meaning: <>正規化頻率 <Tex>{r`f/f_{ref}`}</Tex>；<Tex>{r`\Omega=2\pi f/f_{ref}`}</Tex></>, unit: r`\text{cycles/sample},\ \mathrm{rad/sample}`, firstSeen: '§3' },
  { symbol: r`z^{-1}`, meaning: <>延遲一拍；在單位圓上 <Tex>{r`z^{-1}=e^{-j\Omega}`}</Tex></>, firstSeen: '§3' },
  { symbol: r`f_{vco},\ T_{vco},\ \Delta`, meaning: <>VCO 頻率、週期、PMUX 相位間隔 <Tex>{r`\Delta=T_{vco}/8`}</Tex></>, unit: r`\mathrm{Hz},\ \mathrm{s},\ \mathrm{s}`, firstSeen: '§2', note: <>插圖值 <Tex>{`f_{vco}=${F_VCO_GHZ}`}</Tex> GHz、<Tex>{`\\Delta=${SIM_CFG.deltaPs}`}</Tex> ps</> },
  { symbol: r`\alpha`, meaning: <>FCW 的分數部分，<Tex>{r`\mathrm{FCW}=N_{int}+\alpha`}</Tex></>, firstSeen: '§2' },
  { symbol: r`\varphi[n]`, meaning: <>累積分數相位 <Tex>{r`\mathrm{frac}(n\alpha)`}</Tex></>, unit: r`\text{VCO 週期}`, firstSeen: '§2' },
  { symbol: 'p[n]', meaning: <>PMUX 相位索引 <Tex>{r`\lfloor8\varphi[n]\rfloor\in\{0..7\}`}</Tex></>, firstSeen: '§2' },
  { symbol: r`\rho[n]`, meaning: <>DTC 細部殘差 <Tex>{r`8\varphi[n]-p[n]\in[0,1)`}</Tex></>, unit: r`\text{以 }\Delta\text{ 為單位}`, firstSeen: '§2', note: 'GOS 的 regressor' },
  { symbol: r`\beta`, meaning: <><Tex>{r`\mathrm{frac}(8\alpha)`}</Tex>，鋸齒 <Tex>{r`\rho`}</Tex> 的基頻</>, unit: r`\text{cycles/sample}`, firstSeen: '§7' },
  { symbol: r`a,\ w_g`, meaning: 'DTC 增益誤差（GOS）、其估計', firstSeen: '§2', note: <>理想模型 <Tex>{r`e_{GOS}=(a-w_g)\rho\Delta`}</Tex></> },
  { symbol: r`\varepsilon_k,\ w_k`, meaning: <>第 <Tex>{'k'}</Tex> 個 PMUX 相位的偏差（PHOS）、其估計</>, unit: r`\mathrm{fs}`, firstSeen: '§2' },
  {
    symbol: r`\delta`,
    meaning: <>權重誤差：<Tex>{r`\delta_g=a-w_g`}</Tex>，<Tex>{r`\delta_k=\varepsilon_k-w_k`}</Tex></>,
   
    firstSeen: '§4',
    note: <><strong>本章採 <Tex>{r`\delta=`}</Tex> 真值 − 估計</strong>（全站 §0 的 <Tex>{r`\delta=a-w`}</Tex>；規格書前後不一致處以此為準）</>,
  },
  { symbol: 'x_i[n]', meaning: <>regressor：<Tex>{r`x_0=\rho`}</Tex>，<Tex>{r`x_{1+k}=\mathbf 1\{p[n]=k\}`}</Tex></>, firstSeen: '§2' },
  { symbol: 'r_i[n]', meaning: <>GMAC 實際使用的 regressor <Tex>{r`=g*x_i`}</Tex></>, firstSeen: '§4', note: <>raw 時 <Tex>{'r=x'}</Tex></> },
  { symbol: 'G(z)', meaning: <>regressor 前置濾波（raw：1；一階差分：<Tex>{r`1-z^{-1}`}</Tex>；…）</>, firstSeen: '§4', note: <>注意：不是 GMAC 的輸出 <Tex>{'G_i'}</Tex>（block 平均）</> },
  { symbol: 'u[n]', meaning: '注入在相位比較點的時間誤差', unit: r`\mathrm{fs}`, firstSeen: '§3', note: <>全站的 <Tex>{'u=h*x'}</Tex> 在本章寫成 <Tex>{r`h_{PD}*x_j`}</Tex></> },
  { symbol: r`e_{PD}[n]`, meaning: <>PD／比較器輸入的殘差 <Tex>{r`=h_{PD}*u`}</Tex></>, unit: r`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: 'L(z)', meaning: '開迴路增益（含 1 拍延遲，嚴格 proper）', firstSeen: '§3' },
  { symbol: r`H_{PD},\ h_{PD}`, meaning: <><Tex>{'1/(1+L)'}</Tex> 與其脈衝響應；<Tex>{r`h_{PD}[0]=1`}</Tex></>, firstSeen: '§3' },
  { symbol: 'T', meaning: <><Tex>{'L/(1+L)'}</Tex>，−3 dB = 320 MHz 的那一個</>, firstSeen: '§3' },
  { symbol: r`K,\ K_p,\ K_i`, meaning: 'Type-I 增益；Type-II 比例／積分增益（每 sample）', firstSeen: '§5' },
  { symbol: r`b,\ \omega_c,\ \omega_z,\ \omega_p`, meaning: <>CPPLL 極零點比與頻率（以 <Tex>{r`1/T_{ref}`}</Tex> 為單位）</>, unit: r`\mathrm{rad/sample}`, firstSeen: '§6', note: <Tex>{r`b=1+C_1/C_2`}</Tex> },
  { symbol: r`v[n],\ \sigma_v`, meaning: '比較器輸入雜訊與其標準差', unit: r`\mathrm{fs}`, firstSeen: '§4', note: <>插圖值 <Tex>{`\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}`}</Tex> fs</> },
  { symbol: 'q[n]', meaning: <><Tex>{r`\mathrm{sign}(e_{PD}+v)\in\{\pm1\}`}</Tex></>, firstSeen: '§4', note: '同全站' },
  { symbol: 'K_q', meaning: <>Bussgang 增益 <Tex>{r`\sqrt{2/\pi}/\sigma_v`}</Tex></>, unit: r`\mathrm{fs}^{-1}`, firstSeen: '§4', note: <>數值 <Tex>{`${txs(kqGain(SIM_CFG.sigmaPs * 1000), 4)}\\ \\mathrm{fs}^{-1}`}</Tex></> },
  { symbol: r`\Gamma_{\rm eff}(f)`, meaning: <>有效 kernel <Tex>{r`H_{PD}(f)\,\overline{G(f)}`}</Tex></>, firstSeen: '§4' },
  { symbol: 'C', meaning: <><Tex>{r`9\times9`}</Tex> 平均 GMAC 矩陣 <Tex>{r`C_{ij}=\langle r_i\,(h_{PD}*x_j)\rangle`}</Tex></>, firstSeen: '§4', note: <>全站的純量 <Tex>{'C'}</Tex> 在這裡是矩陣</> },
  { symbol: r`\lambda_m`, meaning: <>PHOS <Tex>{r`8\times8`}</Tex> circulant 的 DFT 模態特徵值，<Tex>{'m=0..7'}</Tex></>, firstSeen: '§8', note: <>不是全站 <Tex>{'R'}</Tex> 的 eigenvalue</> },
  {
    symbol: r`\kappa`,
    meaning: (
      <>
        正規化斜率：<Tex>{r`\kappa_m=8\lambda_m`}</Tex>、<Tex>{r`\kappa_{PHOS}=8\min_m\mathrm{Re}\lambda_m`}</Tex>、<Tex>{r`\kappa_{GOS}=C_{GOS}/\mathrm{var}(\rho)=12C_{GOS}`}</Tex>
      </>
    ),
   
    firstSeen: '§4',
    note: <><Tex>{r`H\equiv1`}</Tex> 時 <Tex>{r`\kappa=1`}</Tex></>,
  },
  { symbol: r`\tau`, meaning: <>判定 dead zone 的門檻（<Tex>{r`\kappa<-\tau`}</Tex> 才算反號）</>, firstSeen: '§8', note: <Tex>{r`10^{-3}\text{ 或 }10^{-2}`}</Tex> },
  { symbol: r`N_\tau`, meaning: <>開迴路（<Tex>{r`H\equiv1`}</Tex>）時 LMS 的時間常數</>, unit: r`\text{block}`, firstSeen: '§12', note: 'sim 取 25' },
  { symbol: 'W_1', meaning: <>mode-1 基波權重 <Tex>{r`64\sin^2(\pi/8)/\pi^2`}</Tex></>, firstSeen: '§8', note: <Tex>{fx(W1, 5)}</Tex> },
  { symbol: 'D', meaning: <>相關器延遲：<Tex>{'r[n]=x[n-D]'}</Tex></>, unit: r`\text{sample}`, firstSeen: '§7', note: '正確值為 0' },
  { symbol: r`u_{os}`, meaning: '比較器／PD 的 DC offset', unit: r`\mathrm{fs}`, firstSeen: '§13' },
  { symbol: 'A', meaning: '大訊號分析的誤差振幅', unit: r`\mathrm{ps}`, firstSeen: '§10' },
]
