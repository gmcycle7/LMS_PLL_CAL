import type { FormulaEntry } from '@/data/types'

/**
 * Dashboard（/）的公式登錄：只收錄「在首頁推導、把六個條件串起來」的式子；各章自己的公式在 src/chapters/chNN/formulas.ts。
 * ID 採 'F-DB.n'（DB = dashboard），與頁面內 TexBlock 的 id 相同（錨點 #formula-F-DB.n）；
 * Formula & Unit Reference 頁以 import.meta.glob 收集 src/pages/<name>/formulas.ts，一併收錄。
 * 極性：δ = a − w、δw = w − w*；時間單位 fs；g、C、P_x 無因次。
 * title / conditions 會由 Formula & Unit Reference 頁以 mathText 顯示：數學一律寫在 `$…$` 內（docs/teaching-style.md §3）；
 * units 是純文字欄位（搜尋索引與匯出用），次方寫成 fs^-1。
 */
export const FORMULAS: FormulaEntry[] = [
  {
    id: 'F-DB.1',
    title: '線性化 block 方程式（六個條件的共同骨架）',
    tex: String.raw`\delta_{k+1}=p\,\delta_k-\mu K_qB-\mu\eta_k,\qquad p=1-\mu K_qC=1-g`,
    conditions: String.raw`$|e_{\mathrm{det}}|\ll\sigma_v$（erf 一階線性化）；average-mode GMAC；無 commit 延遲（$d=0$）；$\delta=a-w$；$C=E[x\,u]$、$B=E[x\,\varepsilon_{\mathrm{det}}]$`,
    claim: 'approx',
    level: 'L1',
    specSection: '8.2',
    page: '/',
    units: { delta: 'fs', mu: 'fs', K_q: 'fs^-1', B: 'fs', C: '無因次', g: '無因次' },
    erratumId: 'E12',
  },
  {
    id: 'F-DB.2',
    title: '有 commit 延遲時的係數雜訊（$d=0$、$d=1$ 的封閉式）',
    tex: String.raw`\sigma_w^2=\mu^2\sigma_\eta^2\sum_m y_m^2,\qquad \sum_m y_m^2=\frac{1}{g\,(2-g)}\ \ (d=0),\qquad \frac{1+g}{g\,(1-g)\,(2+g)}\ \ (d=1)`,
    conditions: String.raw`$\delta w_{k+1}=\delta w_k-g\,\delta w_{k-d}+\mu\,\eta_{k-d}$；$\eta_k$ 在 block 之間獨立（white）；$0<g<g^*(d)=2\sin\frac{\pi}{4d+2}$`,
    claim: 'exact',
    level: 'L1',
    specSection: '8.3',
    page: '/',
    units: { sigma_w: 'fs', mu: 'fs', sigma_eta: '無因次（average GMAC）', g: '無因次' },
  },
  {
    id: 'F-DB.3',
    title: '任意 commit 延遲的雜訊增益：離散 Lyapunov 方程',
    tex: String.raw`\mathbf P=\mathbf A\,\mathbf P\,\mathbf A^{T}+\mathbf e_1\mathbf e_1^{T},\qquad \sum_m y_m^2=P_{11}`,
    conditions: String.raw`$\mathbf A$ 為 $y_m=y_{m-1}-g\,y_{m-1-d}$ 的 $(d+1)\times(d+1)$ companion matrix；所有特徵根 $|z|<1$；以 $(\mathbf I-\mathbf A\otimes\mathbf A)\,\mathrm{vec}(\mathbf P)=\mathrm{vec}(\mathbf e_1\mathbf e_1^{T})$ 求解`,
    claim: 'exact',
    level: 'L1',
    specSection: '8.3',
    page: '/',
    units: { P: '無因次', g: '無因次', d: 'blocks' },
  },
  {
    id: 'F-DB.4',
    title: 'Preconditioner 的弱方向雜訊放大',
    tex: String.raw`\mathbf M=\mu\tilde{\mathbf R}^{-1}:\qquad \frac{\sigma_{\xi,\mathrm{weak}}}{\sigma_{\xi,\mathrm{strong}}}=\sqrt{\frac{\tilde\lambda_{\max}}{\tilde\lambda_{\min}}}=\sqrt{\kappa}`,
    conditions: String.raw`兩個 regressor 經相同 path；GMAC 雜訊的共變異 $\propto\tilde{\mathbf R}$；所有 mode 的 loop gain 相同（$g$，無 commit 延遲）；$\tilde{\mathbf R}$ 已知且可逆（$|\rho|<1$）`,
    claim: 'approx',
    level: 'L3',
    specSection: '10.1',
    page: '/',
    units: { sigma_xi: 'fs', kappa: '無因次' },
    erratumId: 'E05',
  },
  {
    id: 'F-DB.5',
    title: 'System-level：DTC-referred timing error 與單 tone spur',
    tex: String.raw`\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)},\qquad \mathrm{Spur}\approx20\log_{10}\frac{\beta}{2}=20\log_{10}\!\big(\pi f_{\mathrm{out}}\,|T|\,A_t\big)`,
    conditions: String.raw`單頻 code，$A_t=\sqrt{2P_x}\,|\Delta w|$ 為 peak 值；$\delta w$ 零均值且與 code 獨立；小角度 $\beta=2\pi f_{\mathrm{out}}|T|A_t\ll1$；$\sigma_{\delta t}$ 為 DTC-referred（不是 output jitter）`,
    claim: 'approx',
    level: 'L4',
    specSection: '12.2',
    page: '/',
    units: { sigma_dt: 'fs', Delta_w: 'fs', A_t: 'fs（peak）', beta: 'rad', f_out: 'Hz', Spur: 'dBc' },
    erratumId: 'E09',
  },
]
