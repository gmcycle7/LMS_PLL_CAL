/**
 * 共用模型輸出的文字 → 含 `$...$` 的版本（顯示層；docs/teaching-style.md §3：數學一律 LaTeX）。
 *
 * JSON Lab 的警告與假設來自 read-only 的 blockLms.ts，§4.1 面板的警告來自 pll.ts 的 designDtLoop；
 * 那些字串用 Unicode 拼公式（σ_v、w* − a ≈ …）。ExperimentShell 的 warnings / assumptions 會把 `$...$` 轉成 KaTeX，
 * 所以在顯示之前以「模型原文樣板 → LaTeX 樣板」逐句對照轉換：
 *  - 樣板左邊就是模型原始碼裡的字串，`${…}` 換成 #N（數字）、#I（整數）、#W（不含空白的詞）、#T（任意文字）；
 *  - 數字原樣沿用模型印出來的值（不重算），只把 5.96e-7 換成 5.96\times10^{-7}、NaN／Infinity 換成對應的 TeX；
 *  - 不在對照表裡的句子原樣回傳（寧可不轉，也不要轉錯）。
 * modelText.test.ts 以實際的模型輸出逐句檢查：每條樣板都被命中、轉換後沒有殘留的 Unicode 數學符號、KaTeX 可以渲染、數字沒有被改動。
 */

const NUM = String.raw`-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|NaN|-?Infinity`

/** 模型原文樣板 → 整句比對的 regex */
function pat(template: string): RegExp {
  const esc = template.normalize('NFC').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`^${esc.replace(/#N/g, `(${NUM})`).replace(/#I/g, '(-?\\d+)').replace(/#W/g, '(\\S+?)').replace(/#T/g, '(.*?)')}$`)
}

/** 模型印出的數字 → TeX：5.96e-7 → 5.96\times10^{-7}、1e-7 → 10^{-7}、1e+21 → 10^{21}、NaN → \text{NaN}、Infinity → \infty */
export function texModelNumber(s: string): string {
  if (s === 'NaN') return String.raw`\text{NaN}`
  if (s === 'Infinity') return String.raw`\infty`
  if (s === '-Infinity') return String.raw`-\infty`
  const sci = /^(-?)(\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(s)
  if (sci) return `${sci[1]}${sci[2] === '1' ? '' : `${sci[2]}\\times`}10^{${Number(sci[3])}}`
  return s
}

const n = texModelNumber

type Rule = [RegExp, (m: RegExpExecArray) => string]

const RULES: Rule[] = [
  // ───────────── blockLms.ts：warnings ─────────────
  [pat('#T 不穩定（pole 半徑 #N ≥ 1）：模擬結果無物理意義'), (m) => String.raw`${m[1].replace('Ĥ', String.raw`$\hat H$`)} 不穩定（pole 半徑 $${n(m[2])}\ge1$）：模擬結果無物理意義`],
  [
    pat('C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（C = #N；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）'),
    (m) => String.raw`$C\le0$：更新極性錯誤，正 learning rate 會使平均誤差發散（$C=${n(m[1])}$；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）`,
  ],
  [
    pat('C ≈ 0：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），w 會隨雜訊漂移（C = #N）'),
    (m) => String.raw`$C\approx0$：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），$w$ 會隨雜訊漂移（$C=${n(m[1])}$）`,
  ],
  [
    pat('σ_v = 0：comparator 為純 sign，K_q 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone'),
    () => String.raw`$\sigma_v=0$：comparator 為純 sign，$K_q$ 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone`,
  ],
  [pat('gain_step μ = #N ≤ 0：除非 C < 0，平均誤差不會收斂'), (m) => String.raw`gain_step $\mu=${n(m[1])}\le0$：除非 $C<0$，平均誤差不會收斂`],
  [pat('g ≥ 2：一階模型不穩定（g = μK = #N，pole = #N）'), (m) => String.raw`$g\ge2$：一階模型不穩定（$g=\mu K=${n(m[1])}$，pole $p=${n(m[2])}$）`],
  [
    pat('g ≥ 2sin(π/(4d+2)) = #N：含 d = #I 個 block 更新延遲的一階模型不穩定（g = #N）'),
    (m) => String.raw`$g\ge2\sin\frac{\pi}{4d+2}=${n(m[1])}$：含 $d=${m[2]}$ 個 block 更新延遲的一階模型不穩定（$g=${n(m[3])}$）`,
  ],
  [
    pat('gm_mode=sum 時有效增益放大 N 倍（N = #I：g = #N；若沿用 average 模式的 μ，需改為 μ/N = #N）'),
    (m) => String.raw`gm_mode=sum 時有效增益放大 $N$ 倍（$N=${m[1]}$：$g=${n(m[2])}$；若沿用 average 模式的 $\mu$，需改為 $\mu/N=${n(m[3])}$）`,
  ],
  [
    pat('comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 ±1（q = b），有效增益減半，且 E[x_ref] ≠ 0 時 GMAC 多出 E[x_ref]/2 的偏差項（反面測試）'),
    () =>
      String.raw`comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 $\pm1$（$q=b$），有效增益減半，且 $E[x_\mathrm{ref}]\ne0$ 時 GMAC 多出 $E[x_\mathrm{ref}]/2$ 的偏差項（反面測試）`,
  ],
  [
    pat('H_PD(z=1) = 0：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）'),
    () => String.raw`$H_\mathrm{PD}(z=1)=0$：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）`,
  ],
  [
    pat('預測固定點偏差 w* − a ≈ #N fs（offset / DTC 非線性 / code 平均造成；GMAC 歸零 ≠ DTC 誤差為零，§11）'),
    (m) => String.raw`預測固定點偏差 $w^*-a\approx${n(m[1])}\,\mathrm{fs}$（offset / DTC 非線性 / code 平均造成；GMAC 歸零不代表 DTC 誤差為零，§11）`,
  ],
  [
    pat('filtered-x 模型 Ĥ ≠ H：有效相關為 E[u·u_f] = #N（不是 E[u²] = #N；E45）'),
    (m) => String.raw`filtered-x 模型 $\hat H\ne H$：有效相關為 $E[u\,u_f]=${n(m[1])}$（不是 $E[u^2]=${n(m[2])}$；E45）`,
  ],
  [
    pat('實體 gain LSB = #N fs 遠大於預測 σ_w = #N fs：量化誤差主導，可能出現 limit cycle 或 dead zone（§13）'),
    (m) => String.raw`實體 gain LSB $=${n(m[1])}\,\mathrm{fs}$ 遠大於預測 $\sigma_w=${n(m[2])}\,\mathrm{fs}$：量化誤差主導，可能出現 limit cycle 或 dead zone（§13）`,
  ],
  [
    pat('w 在 block #I 發散（|w| > #N fs 或非有限數），模擬停止'),
    (m) => String.raw`$w$ 在 block ${m[1]} 發散（$|w|>${n(m[2])}\,\mathrm{fs}$ 或非有限數），模擬停止`,
  ],
  [
    pat('線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（|G| ≤ max|x_ref|，sum 模式再乘 N），因此實際表現為大振幅振盪／limit cycle，而非數值發散'),
    () => String.raw`線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（$|G|\le\max|x_\mathrm{ref}|$，sum 模式再乘 $N$），因此實際表現為大振幅振盪／limit cycle，而非數值發散`,
  ],

  // ───────────── blockLms.ts：assumptions ─────────────
  [
    pat('時間單位 fs；code 依 #W 正規化後無因次；a、w 的單位為 fs per unit code（δ = a − w 極性）'),
    (m) => String.raw`時間單位 fs；code 依 ${m[1]} 正規化後無因次；$a$、$w$ 的單位為 fs per unit code（$\delta=a-w$ 極性）`,
  ],
  [
    pat('PD 誤差 e[n] = H_PD{δt}[n] + b + v[n]，δt[n] = (a − w_applied)·x[n] + offset + c2·x² + c3·x³；H_PD 狀態跨 block 持續（§15.2）'),
    () =>
      String.raw`PD 誤差 $e[n]=H_\mathrm{PD}\{\delta t\}[n]+b+v[n]$，$\delta t[n]=(a-w_\mathrm{app})\,x[n]+o+c_2x^2+c_3x^3$；$H_\mathrm{PD}$ 狀態跨 block 持續（§15.2）`,
  ],
  [
    pat('comparator 前雜訊 v[n] 為 iid Gaussian（σ_v = #N fs），與 code 獨立'),
    (m) => String.raw`comparator 前雜訊 $v[n]$ 為 iid Gaussian（$\sigma_v=${n(m[1])}\,\mathrm{fs}$），與 code 獨立`,
  ],
  [pat('q = sign(e)，tie 規則 e ≥ 0 ⇒ q = +1（§15.2、E07）'), () => String.raw`$q=\operatorname{sign}(e)$，tie 規則 $e\ge0\Rightarrow q=+1$（§15.2、E07）`],
  [
    // average：G_k = (1/N)Σ q·x_ref
    pat('GMAC：G_k = (1/N)Σ q·x_ref（N = #I），w_{k+1} = w_k + μG_k，更新延遲 d = #I block'),
    (m) => String.raw`GMAC：$G_k=\frac1N\sum q\,x_\mathrm{ref}$（$N=${m[1]}$），$w_{k+1}=w_k+\mu G_k$，更新延遲 $d=${m[2]}$ block`,
  ],
  [
    // sum：模型把總和也寫成 G_k；本頁把總和寫成 S_k（符號表；勘誤 E18）
    pat('GMAC：G_k = Σ q·x_ref（N = #I），w_{k+1} = w_k + μG_k，更新延遲 d = #I block'),
    (m) => String.raw`GMAC（sum 模式）：$S_k=\sum q\,x_\mathrm{ref}$（$N=${m[1]}$），$w_{k+1}=w_k+\mu S_k$，更新延遲 $d=${m[2]}$ block`,
  ],
  [pat('f_s = f_ref：每個 code sample 對應一個 comparator sample'), () => String.raw`$f_s=f_\mathrm{ref}$：每個 code sample 對應一個 comparator sample`],
  [
    pat('K_q = √(2/π)/σ_v 為小訊號近似（|e_det| ≪ σ_v）；σ_w 預測假設 GMAC 雜訊 iid（σ_η² ≈ E[x_ref²]/N）且線性化有效'),
    () =>
      String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$ 為小訊號近似（$|e_\mathrm{det}|\ll\sigma_v$）；$\sigma_w$ 預測假設 GMAC 雜訊 iid（$\sigma_\eta^2\approx E[x_\mathrm{ref}^2]/N$）且線性化有效`,
  ],
  [
    pat('C 與固定點由前 #I 個 code 樣本（略過前 #I 個暫態）估計；mean-field 固定點使用 #I 個樣本'),
    (m) => String.raw`$C$ 與固定點由前 ${m[1]} 個 code 樣本（略過前 ${m[2]} 個暫態）估計；mean-field 固定點使用 ${m[3]} 個樣本`,
  ],
  [
    pat('gain_register 未啟用（quantize_physical = false）：w 為理想浮點，internal_bits / physical_bits 不生效'),
    () => String.raw`gain_register 未啟用（quantize_physical = false）：$w$ 為理想浮點，internal_bits / physical_bits 不生效`,
  ],

  // ───────────── pll.ts：designDtLoop 的 warnings ─────────────
  [
    pat('主 PLL 線性化模型不穩定：closed-loop pole 半徑 #N ≥ 1（ω_nT_s = #N、d = #I）。請降低頻寬或 loop latency。'),
    (m) => String.raw`主 PLL 線性化模型不穩定：closed-loop pole 半徑 $${n(m[1])}\ge1$（$\omega_nT_s=${n(m[2])}$、$d=${m[3]}$）。請降低頻寬或 loop latency。`,
  ],
  [
    pat('ω_nT_s = #N 不夠小：DT 迴路與 CT 原型的對應（K_p = 2ζω_nT_s、K_i = (ω_nT_s)²）明顯失準（E44）。'),
    (m) => String.raw`$\omega_nT_s=${n(m[1])}$ 不夠小：DT 迴路與 CT 原型的對應（$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$）明顯失準（E44）。`,
  ],
]

/** 對照表的句數（測試用：確認每一句樣板都被實際的模型輸出命中，沒有打錯字的死樣板） */
export const MODEL_TEXT_RULE_COUNT = RULES.length

/**
 * 這句模型輸出命中第幾條樣板（−1 = 不在對照表裡，會原樣顯示）。已含 `$` 的字串（本頁自己寫的 LaTeX）不處理。
 * 比對前先做 Unicode NFC 正規化：模型原始碼裡的 Ĥ 有「單一字元」與「H + 結合符號」兩種寫法。
 */
export function modelTextRuleIndex(s: string): number {
  if (s.includes('$')) return -1
  const t = s.normalize('NFC')
  return RULES.findIndex(([re]) => re.test(t))
}

/** 把一句模型輸出（警告或假設）換成含 `$...$` 的版本；不在對照表裡的句子原樣回傳。 */
export function texifyModelText(s: string): string {
  const i = modelTextRuleIndex(s)
  if (i < 0) return s
  const [re, to] = RULES[i]
  const m = re.exec(s.normalize('NFC'))
  return m ? to(m) : s
}

/** 用 Unicode 拼公式時會出現的字元：轉換後的字串（`$...$` 之外）不應再有這些 */
export const UNICODE_MATH = /[σμδΔπΩωφζρληκτ≤≥≈≠≪≫±×√∞²³⁻₀₁₂Σ∂⇒∈·ΦĤ]|\u0302|[A-Za-z]\*|(?<![A-Za-z_])[A-Za-z]_[A-Za-z{]/

/** `$...$` 以外的文字（檢查殘留的 Unicode 數學符號用） */
export function outsideMath(s: string): string {
  return s.replace(/(?<!\\)\$(?:[^$\\]|\\.)+?(?<!\\)\$/g, ' ')
}
