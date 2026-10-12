import { renderTex } from '@/components'
import { runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'
import { quantizeFcw } from '@/simulation/models/dsm'
import { runFixedGmacLoop, type FixedLoopParams } from '@/simulation/models/gmac'
import { MODEL_TEXT_RULE_COUNT, modelTextRuleIndex, texifyModelText, texModelNumber } from './modelText'

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 用 Unicode 拼數學時會出現的字元（轉換後不應留在 $...$ 之外） */
const UNICODE_MATH = /[σμδΔεχℓπηΣ≤≥≈≠±∝⇒√½−·×²³∞≪]|\u0304|\u0302|\u0124/
/** 設定鍵名（程式識別字，不是數學）：檢查「底線拼的下標」時先拿掉 */
const CONFIG_KEYS = /gm_mode|comparator_encoding|unipolar_unmapped_bug|gain_step|gain_register|quantize_physical|internal_bits|physical_bits|pll_error_path|unit_rms|zero_mean|regressor_mode|gm_code_delay_samples/g

const FP_BASE: FixedLoopParams = {
  bx: 6,
  log2N: 10,
  accBits: 16,
  accOverflow: 'saturate',
  negate: 'extend',
  gmMode: 'average',
  gFracBits: 2,
  rounding: 'floor',
  codeRange: 'symmetric',
  codeKind: 'uniform',
  dsmFrac: 0.3,
  aTrue: 3,
  aStepBlock: -1,
  aStepValue: 3,
  w0: 0,
  mu: 10,
  sigmaV: 100,
  physMin: -16,
  physMax: 16,
  regMin: -32,
  regMax: 32,
  regOverflow: 'saturate',
  antiWindup: true,
  numBlocks: 60,
  seed: 7,
}

/** 每一組都會讓 gmac.ts 的 runFixedGmacLoop 發出至少一種警告 */
const FP_CASES: Partial<FixedLoopParams>[] = [
  {}, // floor 偏差
  { accBits: 12, accOverflow: 'wrap', sigmaV: 1, aTrue: 16, w0: -30 }, // accumulator 溢位（wrap）
  { accBits: 12, accOverflow: 'saturate', sigmaV: 1, aTrue: 16, w0: -30 }, // accumulator 溢位（saturate）
  { codeRange: 'full', negate: 'inplace', accBits: 17 }, // 條件取負 bug
  { gmMode: 'sum', mu: 0.01, accBits: 18 }, // sum 模式
  { mu: 1000 }, // g ≥ 2
  { sigmaV: 0 }, // 沒有雜訊
  { log2N: 14, gFracBits: 0, accBits: 20 }, // ÷N 的 dead zone
  { log2N: 12, gFracBits: 0, accBits: 20, rounding: 'toward_zero' }, // ÷N 的 dead zone（toward-zero：下限加倍，σ_S/2^ℓ = 0.284 也警告）
  { gFracBits: 4, rounding: 'half_even', wLsb: 0.15625, wRounding: 'floor' }, // W floor（preset gmac-fp-w-truncation 的 Case B）
  { gFracBits: 4, rounding: 'half_even', wLsb: 0.15625, wRounding: 'half_up' },
  { gFracBits: 4, rounding: 'half_even', wLsb: 1.25, wRounding: 'floor' }, // W 的 dead zone
  { gFracBits: 4, rounding: 'half_even', wLsb: 0.625, wRounding: 'toward_zero' }, // W 的 dead zone（toward-zero：μσ_G/Δ_W = 0.284）
  { aTrue: 20, antiWindup: true }, // a 超出實體範圍
  { aTrue: 20, antiWindup: false },
  { aTrue: 20, antiWindup: false, regOverflow: 'wrap' }, // gain 暫存器 wrap（沒有數學，原樣）
]

const LMS_BASE: BlockLmsConfigInput = {
  seed: 11,
  gm_accum_samples: 16,
  num_blocks: 40,
  gain_step: 10,
  gm_mode: 'average',
  pd_noise_rms_fs: 20,
  gain_true: 30,
  gain_initial: 0,
  code_normalization: 'none',
  comparator_encoding: 'bipolar_pm_one',
  pll_error_path: { kind: 'identity', parameters: {} },
  seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
}

/** 每一組都對應 blockLms.ts 的一種警告／假設（本章 gmac-signal-flow、gmac-bit-encoding 會遇到的，加上延遲、極性錯誤等反面設定） */
const LMS_CASES: Partial<BlockLmsConfigInput>[] = [
  {},
  { gm_mode: 'sum' },
  { gm_mode: 'sum', gain_step: 100 },
  { comparator_encoding: 'unipolar_unmapped_bug', seeded_pattern: { kind: 'dsm_first_order', parameters: {} } as BlockLmsConfigInput['seeded_pattern'] },
  { comparator_encoding: 'unipolar_unmapped_bug', seeded_pattern: { kind: 'gaussian', parameters: { mean: 0.5, sigma: 1 } } as BlockLmsConfigInput['seeded_pattern'], pd_noise_rms_fs: 100, gain_true: 3, gain_step: 2, num_blocks: 400 },
  { pd_noise_rms_fs: 0 },
  { gain_step: 0 },
  { gain_step: 200 }, // g ≥ 2
  { gain_step: 40, cal_update_delay_blocks: 2 }, // g ≥ g_crit(d)
  { pll_error_path: { kind: 'first_order_hp', parameters: { pole: 0.9 } }, seeded_pattern: { kind: 'dsm_first_order', parameters: {} } as BlockLmsConfigInput['seeded_pattern'] }, // H_PD(1) = 0
  { pll_error_path: { kind: 'fir', parameters: { taps: [-1] } }, gain_step: 1e12, num_blocks: 60 }, // C ≤ 0、發散
  { pll_error_path: { kind: 'fir', parameters: { taps: [0] } } }, // C ≈ 0
  { pll_error_path: { kind: 'iir', parameters: { b: [1], a: [1, -1.05] } }, num_blocks: 4 }, // 不穩定的路徑
]

function modelStrings(): string[] {
  const out = new Set<string>()
  for (const c of FP_CASES) for (const w of runFixedGmacLoop({ ...FP_BASE, ...c }).warnings) out.add(w)
  for (const c of LMS_CASES) {
    const r = runBlockLms({ ...LMS_BASE, ...c })
    for (const w of [...r.warnings, ...r.assumptions]) out.add(w)
  }
  for (const [frac, bits, dither] of [
    [0.999999, 4, false],
    [0.97, 4, true],
  ] as const)
    for (const w of quantizeFcw(frac, bits, dither).warnings) out.add(w)
  return Array.from(out)
}

const ALL = modelStrings()

describe('Ch04 模型文字 → LaTeX（modelText.ts）', () => {
  it('每一條樣板都被實際的模型輸出命中（沒有打錯字的死樣板）', () => {
    const hit = new Set(ALL.map(modelTextRuleIndex).filter((i) => i >= 0))
    const missing = Array.from({ length: MODEL_TEXT_RULE_COUNT }, (_, i) => i).filter((i) => !hit.has(i))
    expect(missing).toEqual([])
    expect(ALL.length).toBeGreaterThan(MODEL_TEXT_RULE_COUNT - 1)
  })

  it('含數學的模型輸出全部被轉換：$...$ 之外沒有 Unicode 拼的符號、底線下標或 ^，每一段都能被 KaTeX 解析', () => {
    const untouched: string[] = []
    for (const s of ALL) {
      const t = texifyModelText(s)
      const plain = t.replace(INLINE, '')
      expect(plain, `${s}\n→ ${t}`).not.toMatch(UNICODE_MATH)
      expect(plain.replace(CONFIG_KEYS, ''), `${s}\n→ ${t}`).not.toMatch(/[A-Za-z]_[A-Za-z{]|\^|\*|\|/)
      expect(plain, `落單的 $：${t}`).not.toContain('$')
      for (const m of t.matchAll(INLINE)) expect(renderTex(m[1], false), `${t}\n段落：${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
      // 數字原樣沿用（不重算）：原文裡的每個小數都出現在轉換後的字串
      for (const m of s.matchAll(/-?\d+\.\d+(?:e[+-]?\d+)?/g)) expect(t, `${s}\n→ ${t}`).toContain(texModelNumber(m[0]))
      // 冪等：轉過的字串（已含 $）不再處理
      expect(texifyModelText(t)).toBe(t)
      if (t === s) untouched.push(s)
    }
    // 原樣保留的只有不含數學的句子
    for (const s of untouched) expect(s, s).not.toMatch(/[=<>]/)
  })

  it('範例：preset gmac-fp-w-truncation Case B 的警告、sum 模式、忘了映射', () => {
    const fl = runFixedGmacLoop({ ...FP_BASE, gFracBits: 4, rounding: 'half_even', wLsb: 0.15625, wRounding: 'floor' })
    const raw = fl.warnings.find((w) => w.includes('取整到 W 的 LSB'))!
    expect(raw).toContain('Δ_W = 0.1563 fs（R = Δ_W/(μΔ_G) = 8）')
    const t = texifyModelText(raw)
    expect(t).toContain(String.raw`更新量 $\mu G$ 以 floor（算術右移截斷，朝 $-\infty$） 取整到 $W$ 的 LSB $\Delta_W=0.1563\,\mathrm{fs}$（$R=\Delta_W/(\mu\Delta_G)=8$）`)
    expect(t).toContain(String.raw`$\Rightarrow w^*-a\approx\bar\varepsilon_W\Delta_W/g=-2.653\,\mathrm{fs}$（F-04.18）`)
    const sum = runBlockLms({ ...LMS_BASE, gm_mode: 'sum' })
    expect(sum.warnings.map(texifyModelText).join('\n')).toMatch(/gm_mode=sum 時有效增益放大 \$N\$ 倍（\$N=16\$：\$g=6\.383\$；若沿用 average 模式的 \$\\mu\$，需改為 \$\\mu\/N=0\.625\$）/)
    // sum 模式的假設：模型把總和也寫成 G_k，頁面改用本站的 S_k（勘誤 E07 / E18）
    expect(sum.assumptions.map(texifyModelText).join('\n')).toContain(String.raw`GMAC（sum 模式）：$S_k=\sum q\,x_\mathrm{ref}$（$N=16$），$w_{k+1}=w_k+\mu S_k$`)
  })

  it('toward-zero 的 dead zone 警告（下限加倍）：兩個取整點各一句，數字原樣沿用', () => {
    const shift = runFixedGmacLoop({ ...FP_BASE, log2N: 12, gFracBits: 0, accBits: 20, rounding: 'toward_zero' }).warnings.find((w) => w.includes('dead zone'))!
    expect(shift).toContain('σ_S/2^ℓ = 0.284 < 0.5（toward-zero 的下限是 floor 的兩倍）')
    expect(texifyModelText(shift)).toBe(
      String.raw`$\sigma_S/2^\ell=0.284<0.5$（toward-zero 的下限是 floor 的兩倍）：$|S|<2^\ell$ 時 toward-zero 一律輸出 $0$，$0$ 兩側的平台合起來寬 $2$ 個 LSB——平衡點 $\delta=0$ 附近的回復斜率只剩 $\chi\approx0.0057$（$1$ = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 $F_G$`,
    )
    const wq = runFixedGmacLoop({ ...FP_BASE, gFracBits: 4, rounding: 'half_even', wLsb: 0.625, wRounding: 'toward_zero' }).warnings.find((w) => w.includes('dead zone'))!
    expect(texifyModelText(wq)).toBe(
      String.raw`$\mu\sigma_G/\Delta_W=0.284<0.5$（toward-zero 的下限是 floor 的兩倍）：更新量的絕對值小於一個 $W$-LSB 時 toward-zero 一律取成 $0$，$0$ 兩側的平台合起來寬 $2$ 個 LSB——平衡點 $\delta=0$ 附近的回復斜率只剩 $\chi\approx0.0057$，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）`,
    )
    // 極小的斜率以科學記號印出時也能轉換（σ_S/2^ℓ = 0.142：χ ≈ 9.8e-11）
    const tiny = runFixedGmacLoop({ ...FP_BASE, log2N: 14, gFracBits: 0, accBits: 20, rounding: 'toward_zero', numBlocks: 20 }).warnings.find((w) => w.includes('dead zone'))!
    expect(tiny).toContain('χ ≈ 9.8e-11')
    expect(texifyModelText(tiny)).toContain(String.raw`$\chi\approx9.8\times10^{-11}$`)
  })

  it('不在對照表裡的句子、已含 $ 的字串原樣回傳；數字格式', () => {
    expect(texifyModelText('模擬錯誤：something unknown σ_v')).toBe('模擬錯誤：something unknown σ_v')
    expect(modelTextRuleIndex('gain register 飽和 3 次（anti-windup / 調整範圍不足，§13.6）')).toBe(-1)
    const own = String.raw`$N\times\text{blocks}=123$：閉迴路計算量較大`
    expect(texifyModelText(own)).toBe(own)
    expect(texModelNumber('1.5e-7')).toBe(String.raw`1.5\times10^{-7}`)
    expect(texModelNumber('-1e-7')).toBe('-10^{-7}')
    expect(texModelNumber('1000000000000')).toBe('10^{12}')
    expect(texModelNumber('-2.653')).toBe('-2.653')
    expect(texModelNumber('4096')).toBe('4096')
  })
})
