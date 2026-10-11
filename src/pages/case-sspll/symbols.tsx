import { Tex, type SymbolEntry } from '@/components'
import { kqGain, W1 } from '@/simulation/models/sspll'
import { FREF_MHZ, PARAMS, SIM_CFG } from './data'
import { fx, r, txs } from './common'

const T_REF_PS = PARAMS.assumptions.T_ref_ps
const F_VCO_GHZ = PARAMS.assumptions.f_vco_Hz_illustrative / 1e9

/**
 * 本章符號（對應分析文件 §1）。數值欄位由 params.json 與 TS port 計算。
 * 符號表放在章末（§21，docs/teaching-style.md §5）；「首次出現」欄是正文第一次用一句話說明這個符號的段落
 * （「章首」＝目錄之前的「本頁設定」）。
 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: r`f_{ref},\ T_{ref}`, meaning: 'reference 頻率／週期（一個週期稱為「一拍」）', unit: r`\mathrm{Hz},\ \mathrm{s}`, firstSeen: '章首', note: <><Tex>{`${FREF_MHZ / 1000}\\ \\mathrm{GHz}`}</Tex>／<Tex>{`${T_REF_PS}\\ \\mathrm{ps}`}</Tex></> },
  { symbol: 'n', meaning: <>比較器取樣索引（每個 <Tex>{r`T_{ref}`}</Tex> 一個）</>, unit: r`\text{sample}`, firstSeen: '章首', note: '同全站 n' },
  { symbol: 'k', meaning: <>GMAC block 索引（<Tex>{'N'}</Tex> 個 sample 一個 block）；也用作 PMUX 相位編號 <Tex>{r`0..7`}</Tex>（看上下文）</>, unit: r`\text{block}`, firstSeen: '章首', note: <>同全站 k；方塊圖上的 block 索引寫成 <Tex>{'[k]'}</Tex></> },
  { symbol: 'N', meaning: '一個 GMAC block 的 sample 數', unit: r`\text{sample}`, firstSeen: '章首', note: '閉迴路模擬取 512' },
  { symbol: r`f,\ \Omega`, meaning: <>正規化頻率 <Tex>{r`f/f_{ref}`}</Tex>；<Tex>{r`\Omega=2\pi f/f_{ref}`}</Tex></>, unit: r`\text{cycles/sample},\ \mathrm{rad/sample}`, firstSeen: '§0' },
  { symbol: r`z^{-1}`, meaning: <>延遲一拍；在單位圓上 <Tex>{r`z^{-1}=e^{-j\Omega}`}</Tex></>, firstSeen: '§2', note: <>方塊圖上 <Tex>{r`\tfrac{1}{z-1}=\tfrac{z^{-1}}{1-z^{-1}}`}</Tex> 是「積分器加 1 拍延遲」</> },
  { symbol: r`f_{vco},\ T_{vco},\ \Delta`, meaning: <>VCO 頻率、週期、PMUX 相位間隔 <Tex>{r`\Delta=T_{vco}/8`}</Tex></>, unit: r`\mathrm{Hz},\ \mathrm{s},\ \mathrm{s}`, firstSeen: '§2', note: <>插圖值 <Tex>{`f_{vco}=${F_VCO_GHZ}`}</Tex> GHz、<Tex>{`\\Delta=${SIM_CFG.deltaPs}`}</Tex> ps</> },
  { symbol: r`\alpha`, meaning: <>FCW 的分數部分，<Tex>{r`\mathrm{FCW}=N_{int}+\alpha`}</Tex></>, firstSeen: '章首' },
  { symbol: r`P,\ Q`, meaning: <><Tex>{r`\alpha=P/Q`}</Tex> 的最簡分數；regressor 每 <Tex>{'Q'}</Tex> 拍重複一次</>, firstSeen: '§7', note: <><Tex>{r`8\mid Q`}</Tex> 時 8 相的佔用率均勻</> },
  { symbol: r`\varphi[n]`, meaning: <>累積分數相位 <Tex>{r`\mathrm{frac}(n\alpha)`}</Tex></>, unit: r`\text{VCO 週期}`, firstSeen: '§2' },
  { symbol: 'p[n]', meaning: <>PMUX 相位索引 <Tex>{r`\lfloor8\varphi[n]\rfloor\in\{0..7\}`}</Tex></>, firstSeen: '§2', note: <>不帶 <Tex>{'[n]'}</Tex> 的 <Tex>{'p'}</Tex> 是 <Tex>{'z'}</Tex> 平面上的極點位置（§0、§6）</> },
  { symbol: r`\rho[n]`, meaning: <>DTC 細部殘差 <Tex>{r`8\varphi[n]-p[n]\in[0,1)`}</Tex></>, unit: r`\text{以 }\Delta\text{ 為單位}`, firstSeen: '§0', note: 'GOS 的 regressor；定義在 §2' },
  { symbol: r`\beta`, meaning: <><Tex>{r`\mathrm{frac}(8\alpha)`}</Tex>，鋸齒 <Tex>{r`\rho`}</Tex> 的基頻</>, unit: r`\text{cycles/sample}`, firstSeen: '§0', note: '推導在 §7' },
  { symbol: r`a,\ w_g`, meaning: 'DTC 增益誤差（GOS）、其估計', firstSeen: '§2', note: <>理想模型 <Tex>{r`e_{GOS}=(a-w_g)\rho\Delta`}</Tex></> },
  { symbol: r`\varepsilon_k,\ w_k`, meaning: <>第 <Tex>{'k'}</Tex> 個 PMUX 相位的偏差（PHOS）、其估計</>, unit: r`\mathrm{fs}`, firstSeen: '§2' },
  {
    symbol: r`\delta`,
    meaning: <>權重誤差：<Tex>{r`\delta_g=a-w_g`}</Tex>，<Tex>{r`\delta_k=\varepsilon_k-w_k`}</Tex></>,

    firstSeen: '§2',
    note: <><strong>本章採 <Tex>{r`\delta=`}</Tex> 真值 − 估計</strong>（全站 §0 的 <Tex>{r`\delta=a-w`}</Tex>；規格書前後不一致處以此為準）</>,
  },
  { symbol: 'x_i[n]', meaning: <>regressor：<Tex>{r`x_0=\rho`}</Tex>，<Tex>{r`x_{1+k}=\mathbf 1\{p[n]=k\}`}</Tex></>, firstSeen: '§2' },
  { symbol: 'r_i[n]', meaning: <>GMAC 實際使用的 regressor <Tex>{r`=g*x_i`}</Tex></>, firstSeen: '§0', note: <>raw 時 <Tex>{'r=x'}</Tex></> },
  { symbol: 'G(z)', meaning: <>regressor 前置濾波（raw：1；一階差分：<Tex>{r`1-z^{-1}`}</Tex>；…）</>, firstSeen: '§4', note: <>注意：不是 GMAC 的輸出 <Tex>{'G_i[k]'}</Tex>（block 平均）</> },
  { symbol: 'G_i[k]', meaning: <>GMAC 的輸出：第 <Tex>{'k'}</Tex> 個 block 的平均 <Tex>{r`\tfrac1N\sum_n q[n]\,r_i[n]`}</Tex></>, firstSeen: '§4', note: <>注意：不是前置濾波 <Tex>{'G(z)'}</Tex></> },
  { symbol: r`\mu`, meaning: <>LMS 步長：每個 block <Tex>{r`w\leftarrow w+\mu\,G`}</Tex></>, unit: r`\mathrm{fs}\ (\text{PHOS})`, firstSeen: '§2', note: <>實驗 C 用 <Tex>{r`N_\tau`}</Tex> 設定；GOS 與 PHOS 各有一個</> },
  { symbol: 'u[n]', meaning: '注入在相位比較點的時間誤差', unit: r`\mathrm{fs}`, firstSeen: '§0', note: <>全站的 <Tex>{'u=h*x'}</Tex> 在本章寫成 <Tex>{r`h_{PD}*x_j`}</Tex></> },
  { symbol: 'y[n]', meaning: <>主迴路的修正量：<Tex>{r`e_{PD}=u-y`}</Tex>，<Tex>{r`Y=L\,E_{PD}`}</Tex></>, unit: r`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: r`e_{PD}[n]`, meaning: <>PD／比較器輸入的殘差 <Tex>{r`=h_{PD}*u`}</Tex></>, unit: r`\mathrm{fs}`, firstSeen: '§0' },
  { symbol: 'L(z)', meaning: '開迴路增益（含 1 拍延遲，嚴格 proper）', firstSeen: '章首' },
  { symbol: r`H_{PD},\ h_{PD}`, meaning: <><Tex>{'1/(1+L)'}</Tex> 與其脈衝響應；<Tex>{r`h_{PD}[0]=1`}</Tex></>, firstSeen: '§0' },
  { symbol: 'T', meaning: <><Tex>{'L/(1+L)'}</Tex>，−3 dB = 320 MHz 的那一個</>, firstSeen: '章首' },
  { symbol: r`K,\ K_p,\ K_i`, meaning: 'Type-I 增益；Type-II 比例／積分增益（每 sample）', firstSeen: '§0' },
  { symbol: 'd', meaning: <>主迴路的延遲拍數：<Tex>{'L'}</Tex> 中的 <Tex>{r`z^{-d}`}</Tex></>, unit: r`\text{sample}`, firstSeen: '§0', note: <>標稱 <Tex>{'d=1'}</Tex>；不是相關器延遲 <Tex>{'D'}</Tex></> },
  { symbol: r`b,\ \omega_c,\ \omega_z,\ \omega_p`, meaning: <>CPPLL 極零點比與頻率（以 <Tex>{r`1/T_{ref}`}</Tex> 為單位）</>, unit: r`\mathrm{rad/sample}`, firstSeen: '§0', note: <Tex>{r`b=1+C_1/C_2`}</Tex> },
  {
    symbol: r`l(t),\ B`,
    meaning: <>CPPLL：CP 打進一個電荷包之後的相位 <Tex>{r`l(t)=Kt+B(1-e^{-\omega_pt})`}</Tex>；<Tex>{r`B=K(\omega_p/\omega_z-1)/\omega_p`}</Tex> 是其中步階的高度</>,
    firstSeen: '§6',
    note: <>這裡的 <Tex>{r`K=\omega_c^2/\sqrt b`}</Tex> 是 L3 的連續時間增益（§5.2 寫成 <Tex>{'K_d'}</Tex>）；每拍取樣一次得到 <Tex>{'L_3(z)'}</Tex></>,
  },
  { symbol: r`v[n],\ \sigma_v`, meaning: '比較器輸入雜訊與其標準差', unit: r`\mathrm{fs}`, firstSeen: '章首', note: <>插圖值 <Tex>{`\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}`}</Tex> fs</> },
  { symbol: 'q[n]', meaning: <><Tex>{r`\mathrm{sign}(e_{PD}+v)\in\{\pm1\}`}</Tex></>, firstSeen: '§0', note: '同全站' },
  { symbol: 'K_q', meaning: <>Bussgang 增益 <Tex>{r`\sqrt{2/\pi}/\sigma_v`}</Tex></>, unit: r`\mathrm{fs}^{-1}`, firstSeen: '§4', note: <>數值 <Tex>{`${txs(kqGain(SIM_CFG.sigmaPs * 1000), 4)}\\ \\mathrm{fs}^{-1}`}</Tex></> },
  { symbol: r`c^i_\nu,\ f_\nu`, meaning: <>第 <Tex>{'i'}</Tex> 條 regressor 的第 <Tex>{r`\nu`}</Tex> 條譜線的複數係數與頻率</>, firstSeen: '§2', note: <>功率是 <Tex>{r`\lvert c^i_\nu\rvert^2`}</Tex>；展開在 §4.3</> },
  { symbol: r`\Gamma_{\rm eff}(f)`, meaning: <>有效 kernel <Tex>{r`H_{PD}(f)\,\overline{G(f)}`}</Tex></>, firstSeen: '§0', note: '定義在 §4.3' },
  { symbol: 'C', meaning: <><Tex>{r`9\times9`}</Tex> 平均 GMAC 矩陣 <Tex>{r`C_{ij}=\langle r_i\,(h_{PD}*x_j)\rangle`}</Tex></>, firstSeen: '§0', note: <>全站的純量 <Tex>{'C'}</Tex> 在這裡是矩陣；定義在 §4</> },
  { symbol: r`m,\ \ell`, meaning: <><Tex>{'m'}</Tex>：PHOS 的 DFT 模態編號 <Tex>{'0..7'}</Tex>；<Tex>{r`\ell`}</Tex>：one-hot 的譜線編號（頻率 <Tex>{r`\ell\alpha`}</Tex>）</>, firstSeen: '§7', note: <>§7 的 <Tex>{'m'}</Tex> 是鋸齒的諧波次數；§8 起是模態編號</> },
  { symbol: r`\lambda_m`, meaning: <>PHOS <Tex>{r`8\times8`}</Tex> circulant 的 DFT 模態特徵值，<Tex>{'m=0..7'}</Tex></>, firstSeen: '§2', note: <>不是全站 <Tex>{'R'}</Tex> 的 eigenvalue；推導在 §8</> },
  {
    symbol: r`\kappa`,
    meaning: (
      <>
        正規化斜率：<Tex>{r`\kappa_m=8\lambda_m`}</Tex>、<Tex>{r`\kappa_{PHOS}=8\min_m\mathrm{Re}\lambda_m`}</Tex>、<Tex>{r`\kappa_{GOS}=C_{GOS}/\mathrm{var}(\rho)=12C_{GOS}`}</Tex>
      </>
    ),

    firstSeen: '§0',
    note: <><Tex>{r`H\equiv1`}</Tex> 時 <Tex>{r`\kappa=1`}</Tex></>,
  },
  { symbol: 'f_{inv}', meaning: <>反號帶的上緣：<Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex> 的頻帶是 <Tex>{r`0<f<f_{inv}`}</Tex>（Type-II）</>, unit: r`\mathrm{Hz}`, firstSeen: '§6', note: <>L2 的 closed form 見 F-CS.8</> },
  { symbol: r`f_{rot},\ f_{saw}`, meaning: <>PMUX 的旋轉頻率 <Tex>{r`\min(\alpha,1-\alpha)f_{ref}`}</Tex>；鋸齒基波（折回後）<Tex>{r`\min(\beta,1-\beta)f_{ref}`}</Tex></>, unit: r`\mathrm{Hz}`, firstSeen: '§8', note: '綜合手算在 §15.3' },
  { symbol: r`g(\Omega)`, meaning: <>一階差分 kernel 的分子 <Tex>{r`1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}`}</Tex>；<Tex>{r`\min_\Omega g`}</Tex> 是 margin</>, firstSeen: '§11', note: <>不是玩具模型的 <Tex>{'g'}</Tex>（§4.1 的單 tap 增益）</> },
  { symbol: r`\tau`, meaning: <>判定 dead zone 的門檻（<Tex>{r`\kappa<-\tau`}</Tex> 才算反號）</>, firstSeen: '§0', note: <Tex>{r`10^{-3}\text{ 或 }10^{-2}`}</Tex> },
  { symbol: r`N_\tau`, meaning: <>開迴路（<Tex>{r`H\equiv1`}</Tex>）時 LMS 的時間常數</>, unit: r`\text{block}`, firstSeen: '§8', note: 'sim 取 25' },
  { symbol: r`\theta_k`, meaning: <>權重誤差沿 <Tex>{'C'}</Tex> 的一個特徵方向的分量（複數），<Tex>{'k'}</Tex> 是 block 索引</>, firstSeen: '§12' },
  { symbol: 'W_1', meaning: <>mode-1 基波權重 <Tex>{r`64\sin^2(\pi/8)/\pi^2`}</Tex></>, firstSeen: '§0', note: <Tex>{fx(W1, 5)}</Tex> },
  { symbol: 'D', meaning: <>相關器延遲：<Tex>{'r[n]=x[n-D]'}</Tex></>, unit: r`\text{sample}`, firstSeen: '§0', note: '正確值為 0；時序圖在 §7.2' },
  { symbol: r`s[n],\ S_\infty,\ S_D`, meaning: <><Tex>{r`h_{PD}`}</Tex> 的步階響應；<Tex>{r`S_\infty=\sum_n s[n]`}</Tex>、<Tex>{r`S_D=\sum_{n<D}s[n]`}</Tex></>, firstSeen: '§7', note: <>Type-II 的 <Tex>{r`S_\infty=0`}</Tex></> },
  { symbol: r`u_{os}`, meaning: '比較器／PD 的 DC offset', unit: r`\mathrm{fs}`, firstSeen: '§13' },
  { symbol: 'A', meaning: '大訊號分析的誤差振幅', unit: r`\mathrm{ps}`, firstSeen: '§0', note: '分析在 §10.4' },
]
