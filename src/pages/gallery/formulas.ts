import type { FormulaEntry } from '@/data/types'
import { modelAssumes } from '@/app/chapterMeta'

/**
 * Experiment Gallery（/gallery，規格 §19.2）的公式登錄。ID 與頁面內 TexBlock id 相同（F-GA.x）。
 * Formula & Unit Reference 頁以 import.meta.glob('../*\/formulas.ts') 收錄本檔；`title` / `conditions` 在該頁以純文字顯示，
 * 所以這兩欄不用 `$...$`（公式本體在 `tex`）。
 *
 * 12 個例子各自的公式（pole、K_q、C_D、σ_w…）已登錄在所屬章節（F-01.x … F-13.x），這裡只登錄 Gallery 自己的四條：
 * 預期文字比對的判據、偵測視窗、巧合相符機率，以及把 12 個例子放在同一個框架下的「統一觀點」。
 */
export const FORMULAS: FormulaEntry[] = [
  {
    id: 'F-GA.1',
    assumes: modelAssumes('L0'),
    title: '預期文字的捨入半寬與相符判據',
    tex: String.raw`y_{\mathrm t}=m\times10^{e}\ (m\ \text{寫到小數}\ n_{\mathrm d}\ \text{位})\;\Rightarrow\;\Delta_{\mathrm t}=\tfrac12\,10^{\,e-n_{\mathrm d}},\qquad \text{相符}\iff|\hat y-y_{\mathrm t}|\le\begin{cases}k_{\mathrm{tol}}\,\Delta_{\mathrm t},&\Delta_{\mathrm t}\le0.01\,|y_{\mathrm t}|\ \ (\text{夠精確})\\[2pt]10^{-9}\max(1,|y_{\mathrm t}|),&\text{否則（只接受相等；限必備數值）}\end{cases}`,
    conditions: 'ŷ = 以真實模型函式重算的值；y_t = 預期文字中的數字；百分比同時當作 y_t 與 y_t/100；k_tol = 1 表示文字就是 ŷ 的正確捨入（程式用 1.001 吸收浮點誤差）；不夠精確的短數字（例如 1.8、0.6）不足以當證據，只在重算值與它相等時才算相符',
    claim: 'exact',
    level: 'L0',
    specSection: '19.2',
    page: '/gallery',
    units: { 'ŷ, y_t, Δ_t': '與該數值相同的單位', k_tol: '無因次' },
  },
  {
    id: 'F-GA.2',
    assumes: modelAssumes('L0'),
    title: '偵測視窗：模型的相對誤差多大才會被比對抓到',
    tex: String.raw`|\hat y(1+\varepsilon)-y_{\mathrm t}|\le W\iff\frac{y_{\mathrm t}-W-\hat y}{\hat y}\le\varepsilon\le\frac{y_{\mathrm t}+W-\hat y}{\hat y}\quad(\hat y>0),\qquad W=\text{F-GA.1 的接受半寬}`,
    conditions: 'ŷ < 0 時兩端對調；ŷ = 0 時相對誤差沒有定義（任何 ε 都相符）；視窗外的 ε 一定被判為 mismatch；夠精確的數字 W = k_tol·Δ_t',
    claim: 'exact',
    level: 'L0',
    specSection: '17',
    page: '/gallery',
    units: { ε: '無因次（相對誤差）' },
  },
  {
    id: 'F-GA.3',
    assumes: modelAssumes('L0'),
    title: '巧合相符機率（模型誤差均勻分布的假設下）',
    tex: String.raw`P_{\text{match}}(\varepsilon_{\max})=\frac{1}{2\varepsilon_{\max}}\left|\,\bigcup_i I_i\cap[-\varepsilon_{\max},\varepsilon_{\max}]\right|,\qquad I_i=\left[\frac{y_{\mathrm t,i}-W_i-\hat y}{\hat y},\ \frac{y_{\mathrm t,i}+W_i-\hat y}{\hat y}\right]`,
    conditions: '假設 ε 在 [−ε_max, ε_max] 均勻分布（這是假設，不是量測）；I_i 為文字中第 i 個數字換到 ε 軸的接受區間（W_i 為 F-GA.1 的接受半寬）；扣掉對到原本那個數字的部分才是「巧合」',
    claim: 'approx',
    level: 'L0',
    specSection: '17',
    page: '/gallery',
    units: { P_match: '機率（0–1）', 'ε_max': '無因次' },
  },
  {
    id: 'F-GA.4',
    assumes: modelAssumes('L3'),
    title: '統一觀點：線性化的誤差遞迴與三個問題',
    tex: String.raw`\boldsymbol\delta_{k+1}=\mathbf A\,\boldsymbol\delta_k+\mathbf b+\mu\,\boldsymbol\eta_k:\quad \underbrace{\rho(\mathbf A)<1}_{\text{走不走得回來}},\quad \underbrace{\boldsymbol\delta_\infty=(\mathbf I-\mathbf A)^{-1}\mathbf b}_{\text{停在哪裡}},\quad \underbrace{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}}_{\text{停下來後抖多大（純量）}}`,
    conditions: 'δ = a − w；A、b、η 依模型層級而定（L0：A = 1 − μx²；L1/L2：A = 1 − μK_qC；L3：A = I + MJ）；b = −μB，B 為 GMAC 平均輸出中與 δ 無關的固定項；η 零均值、各 block 獨立（以 δ = a − w 表示時雜訊項其實是 −μη，正負號併入 η 的定義，不影響平均與變異數）；小訊號線性化、平均（mean）遞迴；ρ(A) 為 spectral radius；(I − A) 奇異時固定點不唯一（不可辨識）',
    claim: 'approx',
    level: 'L3',
    specSection: '19.2',
    page: '/gallery',
    units: { δ: 'fs per unit code', μ: 'fs（Sign-LMS、average GMAC）', 'σ_w': 'fs' },
    erratumId: 'E39',
  },
]
