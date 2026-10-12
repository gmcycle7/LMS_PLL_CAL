/**
 * 模型輸出的文字 → `$...$` LaTeX（顯示層；docs/teaching-style.md §3：數學一律 LaTeX）。
 *
 * 本章實驗的警告與假設有一部分來自模型（read-only 的 blockLms.ts / dsm.ts，以及 gmac.ts 的 runFixedGmacLoop），
 * 那些字串是純文字（用 Unicode 拼的 σ_v、w* − a ≈ …）。ExperimentShell 的 warnings / assumptions 會把 `$...$` 轉成 KaTeX，
 * 所以在交給 ExperimentShell 之前，以「模型原文樣板 → LaTeX 樣板」逐句對照轉換：
 *  - 樣板的左邊就是模型原始碼裡的字串，`${…}` 換成 #N（數字）、#I（整數）、#W（一個詞）、#T（任意文字）；
 *  - 數字原樣沿用模型印出來的值（不重算），只把 1e-7 這種寫法換成 10^{-7}；
 *  - 認不得的句子原樣回傳（寧可不轉，也不要轉錯）。modelText.test.ts 以實際的模型輸出逐句檢查：每條樣板都被命中、沒有漏轉的符號。
 */

const R = String.raw

const NUM = R`-?\d+(?:\.\d+)?(?:e[+-]?\d+)?`

/** 模型原文樣板 → 整句比對的 regex（#N 數字、#I 整數、#W 不含空白的詞、#T 任意文字） */
function pat(template: string): RegExp {
  const esc = template.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`^${esc.replace(/#N/g, `(${NUM})`).replace(/#I/g, '(-?\\d+)').replace(/#W/g, '(\\S+?)').replace(/#T/g, '(.*)')}$`)
}

/** 模型印出的數字 → TeX：1.5e-7 → 1.5\times10^{-7}、1e-7 → 10^{-7}、1000000000000 → 10^{12}；其餘原樣 */
export function texModelNumber(s: string): string {
  const sci = /^(-?)(\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(s)
  if (sci) return `${sci[1]}${sci[2] === '1' ? '' : `${sci[2]}\\times`}10^{${Number(sci[3])}}`
  const big = /^(-?)1(0{6,})$/.exec(s)
  if (big) return `${big[1]}10^{${big[2].length}}`
  return s
}

const n = texModelNumber

/** 句子裡可替換的子句（rounding 名稱、wrap / saturate / anti-windup 的說明）：原文 → LaTeX */
const PHRASES: Record<string, string> = {
  // gmac.ts ROUNDING_LABEL
  'floor（算術右移截斷，朝 −∞）': R`floor（算術右移截斷，朝 $-\infty$）`,
  'round half up（+½ 後右移）': R`round half up（$+\tfrac12$ 後右移）`,
  // fixedLoopWarnings：accumulator 溢位
  'wrap 會讓 S 跳到另一端甚至變號，更新方向錯誤': R`wrap 會讓 $S$ 跳到另一端甚至變號，更新方向錯誤`,
  'saturate 會讓大誤差時的 G 被截小，迴路變慢但方向正確': R`saturate 會讓大誤差時的 $G$ 被截小，迴路變慢但方向正確`,
  // fixedLoopWarnings：a 超出實體範圍
  '沒有 anti-windup 時內部積分器會持續積分（windup），a 回到範圍內後要先「放掉」多積的量才會恢復': R`沒有 anti-windup 時內部積分器會持續積分（windup），$a$ 回到範圍內後要先「放掉」多積的量才會恢復`,
}

const phrase = (s: string): string => PHRASES[s] ?? s

type Rule = [RegExp, (m: RegExpExecArray) => string]

const RULES: Rule[] = [
  // ───────────── gmac.ts：fixedLoopWarnings ─────────────
  [
    pat('GMAC accumulator 溢位 #I 次：B_acc = #I bits < 最壞情況需要的 #I bits（B_x + guard bits）。#T'),
    (m) => R`GMAC accumulator 溢位 ${m[1]} 次：$B_\mathrm{acc}=${m[2]}$ bits $<$ 最壞情況需要的 ${m[3]} bits（$B_x$ + guard bits）。${phrase(m[4])}`,
  ],
  [
    pat(
      '條件取負在 B_x = #I bits 內做（inplace）：x = −2^{B_x−1} = #I 時 −x 溢位回到自己，發生 #I 次（q·x 的符號錯誤，每次讓 S 少 2^{B_x} LSB）。平均模型預測 w* − a ≈ #N fs（最負 code 機率 #N，F-04.15）。請先符號延伸到 B_x+1 bits，或把 code 限制在對稱範圍',
    ),
    (m) =>
      R`條件取負在 $B_x=${m[1]}$ bits 內做（inplace）：$x=-2^{B_x-1}=${m[2]}$ 時 $-x$ 溢位回到自己，發生 ${m[3]} 次（$q\,x$ 的符號錯誤，每次讓 $S$ 少 $2^{B_x}$ LSB）。平均模型預測 $w^*-a\approx${n(m[4])}\,\mathrm{fs}$（最負 code 機率 $${n(m[5])}$，F-04.15）。請先符號延伸到 $B_x+1$ bits，或把 code 限制在對稱範圍`,
  ],
  [
    pat('gm_mode=sum 時有效增益放大 N 倍（N = #I：g = NμK = #N；若要與 average 模式相同，μ 需改為 μ/N）'),
    (m) => R`gm_mode=sum 時有效增益放大 $N$ 倍（$N=${m[1]}$：$g=N\mu K=${n(m[2])}$；若要與 average 模式相同，$\mu$ 需改為 $\mu/N$）`,
  ],
  [pat('g ≥ 2：一階模型不穩定（g = #N，pole = #N）'), (m) => R`$g\ge2$：一階模型不穩定（$g=${n(m[1])}$，pole $=${n(m[2])}$）`],
  [
    pat('σ_v = 0：comparator 為純 sign，沒有雜訊當 dither，K_q 無定義；rounding 偏差與 dead zone 由確定性的 limit cycle 決定'),
    () => R`$\sigma_v=0$：comparator 為純 sign，沒有雜訊當 dither，$K_q$ 無定義；rounding 偏差與 dead zone 由確定性的 limit cycle 決定`,
  ],
  [
    pat(
      'floor（算術右移直接截斷）在 G ≈ 0 附近平均少 #N 個 G-LSB：迴路會停在 E[G] = +(1 − 2^−ℓ)Δ_G/2 ≈ ½Δ_G 的位置 ⇒ w* − a ≈ #N fs（ε̄Δ_G/K）。改用 round-half-even 或保留更多小數位元 F_G',
    ),
    (m) =>
      R`floor（算術右移直接截斷）在 $G\approx0$ 附近平均少 $${n(m[1])}$ 個 $G$-LSB：迴路會停在 $E[G]=+(1-2^{-\ell})\,\Delta_G/2\approx\tfrac12\Delta_G$ 的位置 $\Rightarrow w^*-a\approx${n(m[2])}\,\mathrm{fs}$（$\bar\varepsilon\Delta_G/K$）。改用 round-half-even 或保留更多小數位元 $F_G$`,
  ],
  [
    pat(
      'σ_S/2^ℓ = #N < #N：GMAC 雜訊遠小於右移後的 1 個 LSB，取整後的 G 幾乎都是同一個值——平衡點附近的回復斜率只剩 χ ≈ #N（1 = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 F_G',
    ),
    (m) =>
      R`$\sigma_S/2^\ell=${n(m[1])}<${n(m[2])}$：GMAC 雜訊遠小於右移後的 1 個 LSB，取整後的 $G$ 幾乎都是同一個值——平衡點附近的回復斜率只剩 $\chi\approx${n(m[3])}$（$1$ = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 $F_G$`,
  ],
  [
    // toward-zero：下限加倍（gmac.ts 的 ditherMinFor），回復斜率是 toward-zero 自己的（towardZeroRestoringSlope）
    pat(
      'σ_S/2^ℓ = #N < #N（toward-zero 的下限是 floor 的兩倍）：|S| < 2^ℓ 時 toward-zero 一律輸出 0，0 兩側的平台合起來寬 2 個 LSB——平衡點 δ = 0 附近的回復斜率只剩 χ ≈ #N（1 = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 F_G',
    ),
    (m) =>
      R`$\sigma_S/2^\ell=${n(m[1])}<${n(m[2])}$（toward-zero 的下限是 floor 的兩倍）：$|S|<2^\ell$ 時 toward-zero 一律輸出 $0$，$0$ 兩側的平台合起來寬 $2$ 個 LSB——平衡點 $\delta=0$ 附近的回復斜率只剩 $\chi\approx${n(m[3])}$（$1$ = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 $F_G$`,
  ],
  [
    pat(
      '更新量 μ·G 以 #T 取整到 W 的 LSB Δ_W = #N fs（R = Δ_W/(μΔ_G) = #N）：平均誤差 #N fs／block ⇒ w* − a ≈ ε̄_WΔ_W/g = #N fs（F-04.18）。這個偏差 ∝ 1/g：μ 調小反而更大。請增加 W 的小數位元（Δ_W ≤ 2g × 可容忍偏差）或改用 round-half-even',
    ),
    (m) =>
      R`更新量 $\mu G$ 以 ${phrase(m[1])} 取整到 $W$ 的 LSB $\Delta_W=${n(m[2])}\,\mathrm{fs}$（$R=\Delta_W/(\mu\Delta_G)=${n(m[3])}$）：平均誤差 $${n(m[4])}\,\mathrm{fs}$／block $\Rightarrow w^*-a\approx\bar\varepsilon_W\Delta_W/g=${n(m[5])}\,\mathrm{fs}$（F-04.18）。這個偏差 $\propto1/g$：$\mu$ 調小反而更大。請增加 $W$ 的小數位元（$\Delta_W\le2g\times$ 可容忍偏差）或改用 round-half-even`,
  ],
  [
    pat(
      'μσ_G/Δ_W = #N < #N：每個 block 的更新量雜訊遠小於一個 W-LSB，取整後絕大多數更新是 0 或 ±1 LSB——平衡點附近的回復斜率只剩 χ ≈ #N，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）',
    ),
    (m) =>
      R`$\mu\sigma_G/\Delta_W=${n(m[1])}<${n(m[2])}$：每個 block 的更新量雜訊遠小於一個 $W$-LSB，取整後絕大多數更新是 $0$ 或 $\pm1$ LSB——平衡點附近的回復斜率只剩 $\chi\approx${n(m[3])}$，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）`,
  ],
  [
    pat(
      'μσ_G/Δ_W = #N < #N（toward-zero 的下限是 floor 的兩倍）：更新量的絕對值小於一個 W-LSB 時 toward-zero 一律取成 0，0 兩側的平台合起來寬 2 個 LSB——平衡點 δ = 0 附近的回復斜率只剩 χ ≈ #N，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）',
    ),
    (m) =>
      R`$\mu\sigma_G/\Delta_W=${n(m[1])}<${n(m[2])}$（toward-zero 的下限是 floor 的兩倍）：更新量的絕對值小於一個 $W$-LSB 時 toward-zero 一律取成 $0$，$0$ 兩側的平台合起來寬 $2$ 個 LSB——平衡點 $\delta=0$ 附近的回復斜率只剩 $\chi\approx${n(m[3])}$，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）`,
  ],
  [
    pat('真實 gain a 超出 DTC 可實現範圍 [#N, #N] fs：gain 只能停在 rail，#T'),
    (m) => R`真實 gain $a$ 超出 DTC 可實現範圍 $[${n(m[1])},\,${n(m[2])}]\,\mathrm{fs}$：gain 只能停在 rail，${phrase(m[3])}`,
  ],

  // ───────────── blockLms.ts：warnings ─────────────
  [
    pat('C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（C = #N；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）'),
    (m) => R`$C\le0$：更新極性錯誤，正 learning rate 會使平均誤差發散（$C=${n(m[1])}$；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）`,
  ],
  [
    pat('C ≈ 0：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），w 會隨雜訊漂移（C = #N）'),
    (m) => R`$C\approx0$：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），$w$ 會隨雜訊漂移（$C=${n(m[1])}$）`,
  ],
  [
    pat('σ_v = 0：comparator 為純 sign，K_q 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone'),
    () => R`$\sigma_v=0$：comparator 為純 sign，$K_q$ 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone`,
  ],
  [pat('gain_step μ = #N ≤ 0：除非 C < 0，平均誤差不會收斂'), (m) => R`gain_step $\mu=${n(m[1])}\le0$：除非 $C<0$，平均誤差不會收斂`],
  [pat('g ≥ 2：一階模型不穩定（g = μK = #N，pole = #N）'), (m) => R`$g\ge2$：一階模型不穩定（$g=\mu K=${n(m[1])}$，pole $=${n(m[2])}$）`],
  [
    pat('g ≥ 2sin(π/(4d+2)) = #N：含 d = #I 個 block 更新延遲的一階模型不穩定（g = #N）'),
    (m) => R`$g\ge2\sin\tfrac{\pi}{4d+2}=${n(m[1])}$：含 $d=${m[2]}$ 個 block 更新延遲的一階模型不穩定（$g=${n(m[3])}$）`,
  ],
  [
    pat('gm_mode=sum 時有效增益放大 N 倍（N = #I：g = #N；若沿用 average 模式的 μ，需改為 μ/N = #N）'),
    (m) => R`gm_mode=sum 時有效增益放大 $N$ 倍（$N=${m[1]}$：$g=${n(m[2])}$；若沿用 average 模式的 $\mu$，需改為 $\mu/N=${n(m[3])}$）`,
  ],
  [
    pat('comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 ±1（q = b），有效增益減半，且 E[x_ref] ≠ 0 時 GMAC 多出 E[x_ref]/2 的偏差項（反面測試）'),
    () =>
      R`comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 $\pm1$（$q=b$），有效增益減半，且 $E[x_\mathrm{ref}]\ne0$ 時 GMAC 多出 $E[x_\mathrm{ref}]/2$ 的偏差項（反面測試）`,
  ],
  [
    pat('H_PD(z=1) = 0：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）'),
    () => R`$H_\mathrm{PD}(z=1)=0$：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）`,
  ],
  [
    pat('預測固定點偏差 w* − a ≈ #N fs（offset / DTC 非線性 / code 平均造成；GMAC 歸零 ≠ DTC 誤差為零，§11）'),
    (m) => R`預測固定點偏差 $w^*-a\approx${n(m[1])}\,\mathrm{fs}$（offset / DTC 非線性 / code 平均造成；GMAC 歸零 $\ne$ DTC 誤差為零，§11）`,
  ],
  [pat('#W 不穩定（pole 半徑 #N ≥ 1）：模擬結果無物理意義'), (m) => R`${m[1]} 不穩定（pole 半徑 $${n(m[2])}\ge1$）：模擬結果無物理意義`],
  [
    pat('w 在 block #I 發散（|w| > #N fs 或非有限數），模擬停止'),
    (m) => R`$w$ 在 block ${m[1]} 發散（$|w|>${n(m[2])}\,\mathrm{fs}$ 或非有限數），模擬停止`,
  ],
  [
    pat('線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（|G| ≤ max|x_ref|，sum 模式再乘 N），因此實際表現為大振幅振盪／limit cycle，而非數值發散'),
    () => R`線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（$|G|\le\max|x_\mathrm{ref}|$，sum 模式再乘 $N$），因此實際表現為大振幅振盪／limit cycle，而非數值發散`,
  ],

  // ───────────── blockLms.ts：assumptions ─────────────
  [
    pat('時間單位 fs；code 依 #W 正規化後無因次；a、w 的單位為 fs per unit code（δ = a − w 極性）'),
    (m) => R`時間單位 fs；code 依 ${m[1]} 正規化後無因次；$a$、$w$ 的單位為 fs per unit code（$\delta=a-w$ 極性）`,
  ],
  [
    pat('PD 誤差 e[n] = H_PD{δt}[n] + b + v[n]，δt[n] = (a − w_applied)·x[n] + offset + c2·x² + c3·x³；H_PD 狀態跨 block 持續（§15.2）'),
    () =>
      R`PD 誤差 $e[n]=H_\mathrm{PD}\{\delta t\}[n]+b+v[n]$，$\delta t[n]=(a-w_\mathrm{applied})\,x[n]+\mathrm{offset}+c_2x^2+c_3x^3$；$H_\mathrm{PD}$ 狀態跨 block 持續（§15.2）`,
  ],
  [
    pat('comparator 前雜訊 v[n] 為 iid Gaussian（σ_v = #N fs），與 code 獨立'),
    (m) => R`comparator 前雜訊 $v[n]$ 為 iid Gaussian（$\sigma_v=${n(m[1])}\,\mathrm{fs}$），與 code 獨立`,
  ],
  [pat('q = sign(e)，tie 規則 e ≥ 0 ⇒ q = +1（§15.2、E07）'), () => R`$q=\mathrm{sign}(e)$，tie 規則 $e\ge0\Rightarrow q=+1$（§15.2、E07）`],
  [
    // average：模型寫 G_k = (1/N)Σ q·x_ref
    pat('GMAC：G_k = (1/N)Σ q·x_ref（N = #I），w_{k+1} = w_k + μG_k，更新延遲 d = #I block'),
    (m) => R`GMAC：$G_k=\tfrac1N\sum q\,x_\mathrm{ref}$（$N=${m[1]}$），$w_{k+1}=w_k+\mu G_k$，更新延遲 $d=${m[2]}$ block`,
  ],
  [
    // sum：模型把總和也寫成 G_k；本站把總和寫成 S_k（勘誤 E07 / E18）
    pat('GMAC：G_k = Σ q·x_ref（N = #I），w_{k+1} = w_k + μG_k，更新延遲 d = #I block'),
    (m) => R`GMAC（sum 模式）：$S_k=\sum q\,x_\mathrm{ref}$（$N=${m[1]}$），$w_{k+1}=w_k+\mu S_k$，更新延遲 $d=${m[2]}$ block`,
  ],
  [pat('f_s = f_ref：每個 code sample 對應一個 comparator sample'), () => R`$f_s=f_\mathrm{ref}$：每個 code sample 對應一個 comparator sample`],
  [
    pat('K_q = √(2/π)/σ_v 為小訊號近似（|e_det| ≪ σ_v）；σ_w 預測假設 GMAC 雜訊 iid（σ_η² ≈ E[x_ref²]/N）且線性化有效'),
    () =>
      R`$K_q=\sqrt{2/\pi}/\sigma_v$ 為小訊號近似（$|e_\mathrm{det}|\ll\sigma_v$）；$\sigma_w$ 預測假設 GMAC 雜訊 iid（$\sigma_\eta^2\approx E[x_\mathrm{ref}^2]/N$）且線性化有效`,
  ],
  [
    pat('C 與固定點由前 #I 個 code 樣本（略過前 #I 個暫態）估計；mean-field 固定點使用 #I 個樣本'),
    (m) => R`$C$ 與固定點由前 ${m[1]} 個 code 樣本（略過前 ${m[2]} 個暫態）估計；mean-field 固定點使用 ${m[3]} 個樣本`,
  ],
  [
    pat('gain_register 未啟用（quantize_physical = false）：w 為理想浮點，internal_bits / physical_bits 不生效'),
    () => R`gain_register 未啟用（quantize_physical = false）：$w$ 為理想浮點，internal_bits / physical_bits 不生效`,
  ],

  // ───────────── dsm.ts：FCW 量化 ─────────────
  [pat('frac = #N 量化後等於 1，已改為 K = M − 1 = #I'), (m) => R`$\mathrm{frac}=${n(m[1])}$ 量化後等於 $1$，已改為 $K_\mathrm{F}=M-1=${m[2]}$`],
  [
    pat('K = M − 1 時加 LSB dither 會使輸入偶爾等於 M（整數 FCW 進位），仍可運作但平均頻率含 dither 偏移'),
    () => R`$K_\mathrm{F}=M-1$ 時加 LSB dither 會使輸入偶爾等於 $M$（整數 FCW 進位），仍可運作但平均頻率含 dither 偏移`,
  ],
  [pat('FCW 量化誤差超過 ½ LSB（不應發生）'), () => R`FCW 量化誤差超過 $\tfrac12$ LSB（不應發生）`],
]

/** 對照表的句數（測試用：確認每一句樣板都被實際的模型輸出命中，沒有打錯字的死樣板） */
export const MODEL_TEXT_RULE_COUNT = RULES.length

/** 這句模型輸出命中第幾條樣板（−1 = 不在對照表裡，會原樣顯示） */
export function modelTextRuleIndex(s: string): number {
  return s.includes('$') ? -1 : RULES.findIndex(([re]) => re.test(s))
}

/**
 * 把一句模型輸出（警告或假設）換成含 `$...$` 的版本；不在對照表裡的句子原樣回傳。
 * 已經含 `$` 的字串（本章自己寫的 LaTeX 警告）不處理。
 */
export function texifyModelText(s: string): string {
  const i = modelTextRuleIndex(s)
  if (i < 0) return s
  const [re, to] = RULES[i]
  const m = re.exec(s)
  return m ? to(m) : s
}
