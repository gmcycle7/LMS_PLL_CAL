import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criticalGain, gainScale } from '../bridge'
import { DEFAULT_PARAMS, LOCAL_PRESETS, analyzeLab, crossCheckLab, parseLabParams, radiusCurve, tex, type LabParams } from './labModel'

function golden(name: string): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as { expected: Record<string, unknown> }).expected
}

const preset = (i: number): LabParams => parseLabParams(LOCAL_PRESETS[i].params as Record<string, unknown>)

describe('文獻寫法換算器（labModel）', () => {
  it('parseLabParams：型別錯、超出範圍、非整數的欄位一律忽略', () => {
    const p = parseLabParams({ convention: 'bogus', mu: -1, rho: 2, d: 1.5, N: 3.2, polarity: 0, steps: 'x', Px: 2, sumMode: true })
    expect(p).toEqual({ ...DEFAULT_PARAMS, Px: 2, sumMode: true })
    expect(parseLabParams({ convention: 'nlms', d: 3, polarity: -1 })).toMatchObject({ convention: 'nlms', d: 3, polarity: -1 })
  })

  it('T11: preset「Widrow 型 μ_W = 0.25、ρ = 0.99」⇒ 本站 μ = 0.5、慢模式 pole 0.995、598 步', () => {
    const r = analyzeLab(preset(0))
    const T11 = golden('T11')
    expect(r.s).toBe(0.5)
    expect(r.radiusSlow).toBeCloseTo(T11.slow_pole as number, 12)
    expect(r.stepsSlow).toBe(T11.blocks_95)
    expect(r.equivalents.half).toBe(0.5)
    expect(r.equivalents.widrow).toBe(0.25)
    expect(r.warnings).toEqual([])
  })

  it('T13: preset「block sign-GMAC μ = 10 fs、σ_v = 100 fs」⇒ g ≈ 0.0798、p ≈ 0.92021', () => {
    const r = analyzeLab(preset(1))
    const T13 = golden('T13')
    expect(Math.abs(r.gFast - (T13.g as number))).toBeLessThan(1e-12)
    expect(Math.abs(r.radiusFast - (T13.p as number))).toBeLessThan(1e-12)
    expect(r.equivalents.signBlock).toBeCloseTo(10, 10)
  })

  it('T13: 反面 preset「sum 模式忘記 /N」⇒ g = 326.8、警告說明原因', () => {
    const r = analyzeLab(preset(2))
    const T13 = golden('T13')
    expect(r.gFast / (T13.g_sum_mode as number)).toBeCloseTo(1, 12)
    expect(r.radiusFast).toBeGreaterThan(300)
    expect(r.warnings.some((w) => w.includes('總和') && w.includes('4096'))).toBe(true)
    // 同時也超過一階界限 0 < g < 2：警告寫出 g_max 與 pole
    expect(r.warnings.some((w) => w.includes(String.raw`g_{\max}=s\,\lambda_{\max}`) && w.includes(String.raw`\ge 2`))).toBe(true)
  })

  it('T06: 反面 preset「極性接反」⇒ pole = 1 + μK_q = 1.0798，警告寫出 C ≤ 0 的原因', () => {
    const r = analyzeLab(preset(3))
    const neg = golden('negative_tests')
    expect(r.s).toBeLessThan(0)
    expect(Math.abs(r.radiusFast - (neg.reversed_polarity_pole as number))).toBeLessThan(1e-12)
    expect(r.warnings[0].startsWith(String.raw`$C\le 0$：更新極性錯誤`)).toBe(true)
    expect(r.warnings[0]).toContain('任何正的步長都會使平均誤差發散')
    expect(Number.isNaN(r.muBookMax)).toBe(true)
    expect(r.stepsFast).toBe(Infinity)
  })

  it('反面 preset「d = 2、g = 0.7」：極性正確仍發散，警告點出 g*(2)', () => {
    const r = analyzeLab(preset(4))
    expect(r.gFast).toBeCloseTo(0.7, 15)
    expect(r.gStar).toBeCloseTo(criticalGain(2), 15)
    expect(r.radiusFast).toBeGreaterThan(1)
    expect(r.warnings.some((w) => w.includes(String.raw`\ge g^*(2)=0.618`) && w.includes('更新延遲'))).toBe(true)
    // 拿掉延遲就收斂
    expect(analyzeLab({ ...preset(4), d: 0 }).radiusFast).toBeCloseTo(0.3, 12)
  })

  it('NLMS preset：s ≈ μ̃/(ε_reg + tr R) = 0.5；μ̃ ≥ 2 時出現 a posteriori 警告', () => {
    const r = analyzeLab(preset(5))
    expect(r.s).toBeCloseTo(0.5, 15)
    expect(r.warnings).toEqual([])
    const bad = analyzeLab({ ...preset(5), mu: 2.5 })
    expect(bad.warnings.some((w) => w.startsWith('NLMS'))).toBe(true)
  })

  it('反面 preset「ρ = 1」：λ_min = 0、慢模式不衰減、警告說明不可辨識', () => {
    const r = analyzeLab(preset(6))
    expect(r.lmin).toBe(0)
    expect(r.radiusSlow).toBe(1)
    expect(r.stepsSlow).toBe(Infinity)
    expect(r.warnings.some((w) => w.startsWith(String.raw`$\lambda_{\min}=0$`) && w.includes('不可辨識'))).toBe(true)
  })

  it('步長太大時最慢的不一定是 λ_min 的模式：μ = 1.2、ρ = 0.5 ⇒ 快模式 pole −0.8（14 步）、慢模式 pole 0.4（4 步）', () => {
    const r = analyzeLab({ ...DEFAULT_PARAMS, convention: 'half', mu: 1.2, rho: 0.5, d: 0 })
    expect(r.radiusFast).toBeCloseTo(0.8, 12)
    expect(r.radiusSlow).toBeCloseTo(0.4, 12)
    expect(r.stepsFast).toBe(14)
    expect(r.stepsSlow).toBe(4)
    expect(r.warnings).toEqual([]) // 兩個模式都收斂，不是錯誤；畫面在「快模式 95% 衰減」那一列加註
    // 預設（T11）：最慢的是 λ_min 的模式
    const d = analyzeLab(DEFAULT_PARAMS)
    expect(d.radiusSlow).toBeGreaterThan(d.radiusFast)
    expect(d.stepsFast).toBe(1)
  })

  it('換算表：四種寫法的等效步長都給出同一個 |s|；步長上限對應 g = g*(d)', () => {
    for (const base of LOCAL_PRESETS.map((_, i) => preset(i))) {
      const r = analyzeLab(base)
      const ctx = { traceR: 2 * base.Px, epsReg: base.epsReg, sigmaV: base.sigmaV, N: base.N, sumMode: base.sumMode }
      for (const c of ['half', 'widrow', 'nlms', 'signBlock'] as const) {
        expect(gainScale({ ...ctx, convention: c, mu: r.equivalents[c], polarity: 1 })).toBeCloseTo(Math.abs(r.s), 10)
        expect(gainScale({ ...ctx, convention: c, mu: r.bounds[c], polarity: 1 }) * r.lmax).toBeCloseTo(r.gStar, 10)
      }
    }
  })

  it('交叉比對：所有 presets 與 d = 0…6 皆 ok；數值求根被竄改時回報 mismatch', () => {
    for (let i = 0; i < LOCAL_PRESETS.length; i++) {
      const p = preset(i)
      expect(crossCheckLab(p, analyzeLab(p)).ok).toBe(true)
    }
    for (let d = 0; d <= 6; d++) {
      const p = { ...DEFAULT_PARAMS, d }
      expect(crossCheckLab(p, analyzeLab(p)).ok).toBe(true)
    }
    const p = DEFAULT_PARAMS
    const r = analyzeLab(p)
    expect(crossCheckLab(p, { ...r, gStarNumeric: r.gStar + 1e-3 }).ok).toBe(false)
    const bad = new Float64Array(r.trajFast)
    bad[3] += 0.1
    expect(crossCheckLab(p, { ...r, trajFast: bad }).ok).toBe(false)
  })

  it('警告與交叉比對說明都是合法的 mathText 字串：$ 成對、$…$ 之外沒有反斜線，KaTeX 可解析', async () => {
    const katex = (await import('katex')).default
    const texts: string[] = []
    for (let i = 0; i < LOCAL_PRESETS.length; i++) {
      const p = preset(i)
      const r = analyzeLab(p)
      texts.push(...r.warnings, crossCheckLab(p, r).note)
    }
    const nlmsBad = { ...preset(5), mu: 2.5 }
    texts.push(...analyzeLab(nlmsBad).warnings)
    const big = { ...preset(2), mu: 1e4 } // g 很大：數字以 \times10^{n} 表示
    texts.push(...analyzeLab(big).warnings)
    texts.push(crossCheckLab(DEFAULT_PARAMS, { ...analyzeLab(DEFAULT_PARAMS), gStarNumeric: 1 }).note)
    expect(texts.length).toBeGreaterThan(10)
    for (const t of texts) {
      expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
      expect(t.replace(/\$[^$]+\$/g, ''), t).not.toMatch(/\\/)
      for (const m of t.matchAll(/\$([^$]+)\$/g)) expect(() => katex.renderToString(m[1], { throwOnError: true }), m[1]).not.toThrow()
    }
  })

  it('tex()：一般數字、科學記號、無限大', () => {
    expect(tex(0.61803398, 4)).toBe('0.618')
    expect(tex(-325.8, 4)).toBe('-325.8')
    expect(tex(1.5e-9, 3)).toBe(String.raw`1.5\times10^{-9}`)
    expect(tex(3.268e24, 3)).toBe(String.raw`3.27\times10^{24}`)
    expect(tex(Infinity)).toBe(String.raw`\infty`)
    expect(tex(-Infinity)).toBe(String.raw`-\infty`)
  })

  it('radiusCurve：d = 3 時曲線在 g*(3) 附近穿過 1；d = 0 時在 g = 2', () => {
    for (const d of [0, 3]) {
      const c = radiusCurve(d, 600)
      let cross = Number.NaN
      for (let i = 1; i < c.g.length; i++) {
        if (c.rD[i - 1] < 1 && c.rD[i] >= 1) {
          cross = c.g[i]
          break
        }
      }
      expect(Math.abs(cross / criticalGain(d) - 1)).toBeLessThan(0.02)
    }
  })
})
