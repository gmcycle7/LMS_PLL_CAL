import { render } from '@testing-library/react'
import { MathText } from '@/components'
import { presetsForExperiment } from '@/app/presets'
import { analyzeBlockLms, runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'
import { designDtLoop } from '@/simulation/models/pll'
import { EXPERIMENT_ID } from './jsonLabModel'
import { MODEL_TEXT_RULE_COUNT, UNICODE_MATH, modelTextRuleIndex, outsideMath, texModelNumber, texifyModelText } from './modelText'

/** 小而快的基底設定（N = 64、40 blocks）；其餘欄位用 §15.3 預設 */
const SMALL = { gm_accum_samples: 64, num_blocks: 40, record: { sample_trace_blocks: 0, decimate: 1 } } as const
const Q6 = { internal_bits: 20, physical_bits: 6, rounding: 'nearest', overflow: 'saturate', quantize_physical: true } as const
const TONE = { kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0, random_phase: false } } as const

/** 刻意觸發每一種警告／假設的設定（反面測試） */
const CASES: Record<string, BlockLmsConfigInput> = {
  default: { ...SMALL },
  rawIgnoresDelay: { ...SMALL, gm_code_delay_samples: 4 },
  unstablePath: { ...SMALL, pll_error_path: { kind: 'iir', parameters: { b: [1], a: [1, -1.1] } } },
  unstableHat: { ...SMALL, regressor_mode: 'filtered', pll_error_path: { kind: 'iir', parameters: { b: [1], a: [1, -1.05] } } },
  polarity: { ...SMALL, code_normalization: 'none', seeded_pattern: TONE, pll_error_path: { kind: 'single_tone', parameters: { magnitude: 1, phase_deg: 120, omega: Math.PI / 6 } } },
  zeroCorrelation: { ...SMALL, gm_accum_samples: 1200, code_normalization: 'none', seeded_pattern: TONE, pll_error_path: { kind: 'single_tone', parameters: { magnitude: 1, phase_deg: 90, omega: Math.PI / 6 } } },
  sigmaZero: { ...SMALL, pd_noise_rms_fs: 0 },
  negativeMu: { ...SMALL, gain_step: -1 },
  gTooLarge: { ...SMALL, gain_step: 300 },
  delayTooLarge: { ...SMALL, gain_step: 100, cal_update_delay_blocks: 2 },
  sumMode: { ...SMALL, gm_mode: 'sum' },
  sumDiverges: { ...SMALL, gm_mode: 'sum', gain_step: 1e10, num_blocks: 200 },
  unipolarBug: { ...SMALL, comparator_encoding: 'unipolar_unmapped_bug', code_normalization: 'none', seeded_pattern: { kind: 'gaussian', parameters: { mean: 0.5, sigma: 1 } } },
  dcNull: { ...SMALL, pll_error_path: { kind: 'first_order_hp', parameters: {} }, dtc_nonlinearity: { offset_fs: 5, c2: 0, c3: 0 } },
  offsetBias: { ...SMALL, gm_accum_samples: 4096, comparator_offset_fs: 30, seeded_pattern: { kind: 'uniform', parameters: {} } },
  filteredMismatch: { ...SMALL, regressor_mode: 'filtered', pll_error_path: { kind: 'fir', parameters: { taps: [1, -0.5] } }, filtered_x_model: { path: 'same_as_path', gain_mismatch: 1.2, extra_delay_samples: 0 } },
  coarseLsb: { ...SMALL, gm_accum_samples: 4096, gain_register: { ...Q6, lsb_fs: 1 } },
  saturate: { ...SMALL, gain_true: 9, gain_step: 40, gain_register: Q6 },
  wrap: { ...SMALL, gain_true: 9, gain_step: 40, gain_register: { ...Q6, overflow: 'wrap' } },
}

/** 收集實際的模型輸出：JSON Lab 的全部 preset ＋ 上面的反面設定（analyze 與 run 都跑） */
function collect(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  const add = (name: string, list: string[]) => list.forEach((text) => out.push({ name, text }))
  for (const p of presetsForExperiment(EXPERIMENT_ID)) {
    const cfg = (p.params as { config: BlockLmsConfigInput }).config
    const a = analyzeBlockLms(cfg)
    add(p.id, [...a.warnings, ...a.assumptions])
    // 模擬階段才出現的警告（飽和、wrap、有界振盪）：把 block 數縮短後實際跑一次
    add(p.id, runBlockLms({ ...cfg, num_blocks: Math.min(400, a.config.num_blocks), record: { sample_trace_blocks: 0, decimate: 1 } }).warnings)
  }
  for (const [name, cfg] of Object.entries(CASES)) {
    const r = runBlockLms(cfg)
    add(name, [...r.warnings, ...r.assumptions])
  }
  for (const spec of [
    { wnTs: 0.1, zeta: 0.7, loopDelay: 1 },
    { wnTs: 0.5, zeta: 0.5, loopDelay: 0 },
    { wnTs: 1, zeta: 1, loopDelay: 4 },
  ]) {
    add(`designDtLoop ${JSON.stringify(spec)}`, designDtLoop(spec).warnings)
  }
  return out
}

/** 字串裡的所有數字（比對轉換前後數字沒有被改動；指數寫法先還原） */
function numbers(s: string): string[] {
  const plain = s
    .replace(/(\d(?:\.\d+)?)\\times10\^\{(-?\d+)\}/g, (_, m: string, e: string) => `${m}e${e}`)
    .replace(/(?<![\d.])10\^\{(-?\d+)\}/g, (_, e: string) => `1e${e}`)
  return (plain.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? []).map((x) => String(Number(x)))
}

describe('texifyModelText：共用模型（blockLms.ts、pll.ts）的警告與假設 → `$...$`', () => {
  const all = collect()

  it('每一句實際輸出不是命中樣板，就是本來就沒有 Unicode 數學符號；每一條樣板都被命中', () => {
    const hit = new Set<number>()
    const unconverted: string[] = []
    for (const { name, text } of all) {
      const i = modelTextRuleIndex(text)
      if (i >= 0) hit.add(i)
      else if (UNICODE_MATH.test(text)) unconverted.push(`${name}: ${text}`)
    }
    expect(unconverted).toEqual([])
    const dead = Array.from({ length: MODEL_TEXT_RULE_COUNT }, (_, i) => i).filter((i) => !hit.has(i))
    expect(dead, '沒有被任何模型輸出命中的樣板（模型原文改了？）').toEqual([])
    expect(all.length).toBeGreaterThan(150)
  })

  it('轉換後：`$` 成對、`$...$` 之外沒有殘留的 Unicode 數學符號、數字與原文相同', () => {
    for (const { name, text } of all) {
      const t = texifyModelText(text)
      expect((t.match(/(?<!\\)\$/g) ?? []).length % 2, `${name}: ${t}`).toBe(0)
      expect(UNICODE_MATH.test(outsideMath(t)), `${name}: ${t}`).toBe(false)
      if (modelTextRuleIndex(text) >= 0) {
        expect(t, name).not.toBe(text)
        // 原文的 2sin(π/(4d+2))、(1/N)Σ、√(2/π)、c2·x²、c3·x³、2ζω_nT_s、(ω_nT_s)² 帶有公式自己的數字，轉換後寫成 \frac／下標／上標，其餘（模型算出來的值）必須逐一相同
        const strip = (s: string) =>
          s
            .replace(/2sin\(π\/\(4d\+2\)\)|2\\sin\\frac\{\\pi\}\{4d\+2\}/g, '')
            .replace(/\(1\/N\)Σ|\\frac1N\\sum/g, '')
            .replace(/√\(2\/π\)|\\sqrt\{2\/\\pi\}/g, '')
            .replace(/c2·x²|c3·x³|c_2x\^2|c_3x\^3|x²|u²|\^2|\^\*|w_\{k\+1\}/g, '')
            .replace(/2ζω_nT_s|2\\zeta\\omega_nT_s|\(ω_nT_s\)²/g, '')
            .replace(/E\[x_ref\]\/2|E\[x_\\mathrm\{ref\}\]\/2/g, '')
        expect(numbers(strip(t)), `${name}: ${text}`).toEqual(numbers(strip(text)))
      }
    }
  })

  it('KaTeX 可以渲染每一句（沒有 .katex-error、沒有殘留的 $）', () => {
    const unique = Array.from(new Set(all.map((x) => texifyModelText(x.text))))
    const { container } = render(
      <ul>
        {unique.map((t) => (
          <li key={t}>
            <MathText>{t}</MathText>
          </li>
        ))}
      </ul>,
    )
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(container.textContent).not.toContain('ParseError')
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.katex').forEach((e) => e.remove())
    expect(clone.textContent).not.toContain('$')
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(40)
  })

  it('具體例子——sum 模式的 N 倍增益、極性錯誤的 C ≤ 0、更新延遲的臨界增益', () => {
    const sum = analyzeBlockLms({ gm_mode: 'sum' }).warnings.map(texifyModelText)
    expect(sum).toContain(String.raw`$g\ge2$：一階模型不穩定（$g=\mu K=326.8$，pole $p=-325.8$）`)
    expect(sum).toContain(String.raw`gm_mode=sum 時有效增益放大 $N$ 倍（$N=4096$：$g=326.8$；若沿用 average 模式的 $\mu$，需改為 $\mu/N=0.002441$）`)
    const t06 = analyzeBlockLms(CASES.polarity).warnings.map(texifyModelText)
    expect(t06[0]).toMatch(/^\$C\\le0\$：更新極性錯誤.*\$C=-0\.25\$/)
    const dly = analyzeBlockLms({ gain_step: 100, cal_update_delay_blocks: 2 }).warnings.map(texifyModelText)
    expect(dly[0]).toBe(String.raw`$g\ge2\sin\frac{\pi}{4d+2}=0.618$：含 $d=2$ 個 block 更新延遲的一階模型不穩定（$g=0.7979$）`)
    expect(texifyModelText(designDtLoop({ wnTs: 0.5, zeta: 0.5 }).warnings[0])).toBe(
      String.raw`$\omega_nT_s=0.500$ 不夠小：DT 迴路與 CT 原型的對應（$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$）明顯失準（E44）。`,
    )
  })

  it('數字格式與不認得的句子', () => {
    expect(texModelNumber('5.96e-7')).toBe(String.raw`5.96\times10^{-7}`)
    expect(texModelNumber('1e+21')).toBe('10^{21}')
    expect(texModelNumber('-1e-7')).toBe('-10^{-7}')
    expect(texModelNumber('NaN')).toBe(String.raw`\text{NaN}`)
    expect(texModelNumber('-Infinity')).toBe(String.raw`-\infty`)
    expect(texModelNumber('0.618')).toBe('0.618')
    // 不在對照表：原樣回傳（寧可不轉，也不要轉錯）；已含 $ 的字串不處理
    expect(texifyModelText('模型將來新增的某一句 σ_x = 3')).toBe('模型將來新增的某一句 σ_x = 3')
    expect(texifyModelText('本頁自己寫的 $g=2$')).toBe('本頁自己寫的 $g=2$')
    // Ĥ 的兩種 Unicode 寫法（單一字元／H + 結合符號）都認得
    for (const hat of ['Ĥ', 'Ĥ']) {
      const t = texifyModelText(`filtered-x 模型 ${hat} ≠ H：有效相關為 E[u·u_f] = 1.2（不是 E[u²] = 1；E45）`)
      expect(t).toBe(String.raw`filtered-x 模型 $\hat H\ne H$：有效相關為 $E[u\,u_f]=1.2$（不是 $E[u^2]=1$；E45）`)
    }
  })
})
