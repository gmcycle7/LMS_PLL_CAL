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
    conditions: String.raw`$|e_{\mathrm{det}}|\ll\sigma_v$（erf 一階線性化）；$w$ 在 PLL error path 的記憶長度內近似常數（時間尺度分離，F-06.1），才能把誤差寫成 $(a-w_k)\,u[n]$；average-mode GMAC；無 commit 延遲（$d=0$）；$\delta=a-w$；$C=E[x\,u]$、$B=E[x\,\varepsilon_{\mathrm{det}}]$`,
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
    conditions: String.raw`兩個 regressor 經相同 path，且交叉相關 $E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$（$\theta=\phi+\Omega D=0^\circ$ 時成立；$\theta\ne0^\circ$ 時的充分條件是每個延遲的交叉相關都是自相關的 $\rho$ 倍，兩個固定的同頻單頻 code 做不到，見 F-DB.6）；GMAC 雜訊的共變異 $\propto\tilde{\mathbf R}$；所有 mode 的 loop gain 相同（$g$，無 commit 延遲）；$\tilde{\mathbf R}$ 已知且可逆（$|\rho|<1$）`,
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
    conditions: String.raw`單參數、單頻 code，$A_t=\sqrt{2P_x}\,|\Delta w|$ 為 peak 值；$\delta w$ 零均值且與 code 獨立；小角度 $\beta=2\pi f_{\mathrm{out}}|T|A_t\ll1$；$\sigma_{\delta t}$ 為 DTC-referred（不是 output jitter：隨機部分沒有經 $T(f)$ 積分，$|T|$ 只進入 spur；輸出 jitter 見 F-12.17）；條件 6 拿它和預算比，不是校正前後的比較`,
    claim: 'approx',
    level: 'L4',
    specSection: '12.2',
    page: '/',
    units: { sigma_dt: 'fs', Delta_w: 'fs', A_t: 'fs（peak）', beta: 'rad', f_out: 'Hz', Spur: 'dBc' },
    erratumId: 'E09',
  },
  {
    id: 'F-DB.6',
    title: '兩個固定同頻單頻 code 的交叉相關矩陣與特徵值（雙參數假設的對照）',
    tex: String.raw`E\big[x_i[n-D]\,u_j[n]\big]=P_x|H|\cos(\theta+\psi_j-\psi_i),\qquad \lambda_\pm=P_x|H|\big(\cos\theta\pm\sqrt{\rho^2-\sin^2\theta}\big)`,
    conditions: String.raw`兩個 regressor 是同一個頻率 $\Omega$（$0<\Omega<\pi$）、振幅相同的固定單頻 code $x_i=A\cos(\Omega n+\psi_i)$，$\rho=\cos(\psi_2-\psi_1)$；同一條線性、係數固定的 error path；$\theta=\phi+\Omega D$；$\theta=0^\circ$ 時回到 $C(1\pm\rho)$。用在線性化平均模型（F-DB.1）時，$\mathbf M=\mu\mathbf I$、$d=0$ 的 pole 是 $1-\mu\,s\,K_q\lambda_\pm$`,
    claim: 'exact',
    level: 'L3',
    specSection: '10.1',
    page: '/',
    units: { lambda: '無因次', theta: 'deg', psi: 'deg', rho: '無因次' },
  },
]
