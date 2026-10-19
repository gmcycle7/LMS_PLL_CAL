import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT_MAX_DELAY, criticalGain, criticalGainInfo, delayCharPoly, delaySpectralRadius, latencyCalc } from './latency'

/** 直接跑平均模型的時域遞迴 δ_{k+1} = δ_k − g[(1 − d_f)δ_{k−d} + d_f·δ_{k−d−1}]（與特徵多項式無關的獨立實作）。 */
function recursionPeak(g: number, d: number, dFrac: number, steps: number): number {
  const hist = new Array<number>(d + 2).fill(1) // δ_{k}, δ_{k−1}, …（初值全為 1）
  let peak = 0
  for (let k = 0; k < steps; k++) {
    const next = hist[0] - g * ((1 - dFrac) * hist[d] + dFrac * hist[d + 1])
    hist.unshift(next)
    hist.pop()
    if (k >= steps - 50) peak = Math.max(peak, Math.abs(next))
  }
  return peak
}

describe('Ch04 §4：latency 與更新延遲', () => {
  it('整數 d 的臨界增益與 golden delay_bounds 一致（封閉式與求根兩種算法）', () => {
    const v = JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', 'delay_bounds.json'), 'utf8')) as {
      inputs: { d_list: number[] }
      expected: { g_crit_list: number[] }
    }
    v.inputs.d_list.forEach((d, i) => {
      expect(criticalGain(d)).toBeCloseTo(v.expected.g_crit_list[i], 12)
      const g = v.expected.g_crit_list[i]
      expect(delaySpectralRadius(0.98 * g, d)).toBeLessThan(1)
      expect(delaySpectralRadius(1.02 * g, d)).toBeGreaterThan(1)
    })
  })

  it('F-04.17 分數延遲 d_f（d = 0）：Jury 封閉式與求根一致；端點回到 d = 0（g = 2）與 d = 1（g = 1），d_f = ¼ 時最大為 4', () => {
    expect(criticalGain(0, 1e-9)).toBeCloseTo(2, 6)
    expect(criticalGain(0, 1)).toBeCloseTo(1, 12)
    expect(criticalGain(0, 0.25)).toBeCloseTo(4, 12)
    expect(criticalGain(0, 0.5)).toBeCloseTo(2, 12)
    for (const df of [0.01, 0.1, 0.25, 0.4, 0.5, 0.75, 0.99]) {
      const g = criticalGain(0, df)
      expect(delaySpectralRadius(0.99 * g, 0, df)).toBeLessThan(1)
      expect(delaySpectralRadius(1.01 * g, 0, df)).toBeGreaterThan(1)
    }
  })

  it('特徵多項式：d_f = 0 為 z^{d+1} − z^d + g；d_f > 0 為 z^{d+2} − z^{d+1} + g(1 − d_f)z + g·d_f', () => {
    expect(delayCharPoly(0.3, 0)).toEqual([1, -0.7])
    expect(delayCharPoly(0.3, 2)).toEqual([1, -1, 0, 0.3])
    expect(delayCharPoly(0.4, 0, 0.25)).toEqual([1, -1 + 0.4 * 0.75, 0.4 * 0.25])
    const p = delayCharPoly(0.4, 2, 0.25)
    expect(p).toHaveLength(5)
    expect(p[0]).toBe(1)
    expect(p[1]).toBe(-1)
    expect(p[2]).toBe(0)
    expect(p[3]).toBeCloseTo(0.3, 15)
    expect(p[4]).toBeCloseTo(0.1, 15)
  })

  it('整數 + 分數延遲（d ≥ 1、d_f > 0）：求根的 g_crit 在 d_f → 0 與 d_f → 1 接回整數延遲，且與時域遞迴一致', () => {
    for (const d of [1, 2, 3]) {
      expect(criticalGain(d, 1e-6)).toBeCloseTo(criticalGain(d), 4)
      expect(criticalGain(d, 1 - 1e-6)).toBeCloseTo(criticalGain(d + 1), 4)
      for (const df of [0.2, 0.5, 0.8]) {
        const g = criticalGain(d, df)
        expect(g).toBeGreaterThan(0)
        expect(delaySpectralRadius(0.99 * g, d, df)).toBeLessThan(1)
        expect(delaySpectralRadius(1.01 * g, d, df)).toBeGreaterThan(1)
        // 獨立的時域遞迴：臨界以下衰減、以上成長
        expect(recursionPeak(0.9 * g, d, df, 4000)).toBeLessThan(1e-3)
        expect(recursionPeak(1.1 * g, d, df, 4000)).toBeGreaterThan(1e3)
      }
    }
    // d = 0 的封閉式也和時域遞迴一致（含 g_crit > 2 的區段）
    expect(recursionPeak(3.6, 0, 0.25, 300)).toBeLessThan(1e-3) // |z| = √0.9
    expect(recursionPeak(4.4, 0, 0.25, 300)).toBeGreaterThan(1e3) // 實根 −1.62
  })

  it('latencyCalc：f_s = 4 GHz、N = 4096 ⇒ f_u = 976.5625 kHz；P_c > 0 且等 block 邊界 ⇒ d = ⌈P_c/N⌉', () => {
    const r = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 8, dCfg: 0, apply: 'boundary' })
    expect(r.fuKHz).toBeCloseTo(976.5625, 9)
    expect(r.TsPs).toBeCloseTo(250, 9)
    expect(r.dEff).toBe(1)
    expect(r.dFrac).toBe(0)
    expect(r.gCrit).toBeCloseTo(1, 12)
    expect(r.ageSamples).toBe(2048 + 4096)
    const imm = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 8, dCfg: 0, apply: 'immediate' })
    expect(imm.dEff).toBe(0)
    expect(imm.dFrac).toBeCloseTo(8 / 4096, 12)
    expect(imm.gCrit).toBeCloseTo(2 / (1 - 2 * (8 / 4096)), 12)
    expect(imm.ageSamples).toBe(2048 + 8)
    expect(imm.warnings.join('\n')).toMatch(/block 中途/)
    const zero = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 0, dCfg: 0, apply: 'boundary' })
    expect(zero.dEff).toBe(0)
    expect(zero.gCrit).toBeCloseTo(2, 12)
  })

  it('反面測試：P_c > N（commit 比一個 block 慢）時延遲要算 ⌈P_c/N⌉ 個 block，不是 1 個；immediate 模式拆成整數 + 分數', () => {
    const slow = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 9000, dCfg: 0, apply: 'boundary' })
    expect(slow.dEff).toBe(3) // ⌈9000/4096⌉
    expect(slow.gCrit).toBeCloseTo(2 * Math.sin(Math.PI / 14), 12) // 0.445，不是 d = 1 的 1
    expect(slow.ageSamples).toBe(2048 + 3 * 4096)
    expect(slow.warnings.join('\n')).toMatch(/commit 比一個 block 還慢/)
    const exact = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 4096, dCfg: 1, apply: 'boundary' })
    expect(exact.dEff).toBe(2) // 剛好一個 block：下一個邊界生效，再加設定的 1 個
    const imm = latencyCalc({ fsGHz: 4, N: 4096, D: 0, Pc: 4096 + 1024, dCfg: 1, apply: 'immediate' })
    expect(imm.dEff).toBe(2)
    expect(imm.dFrac).toBeCloseTo(0.25, 12)
    expect(imm.gCrit).toBeCloseTo(criticalGain(2, 0.25), 12)
    expect(imm.gCrit).toBeLessThan(criticalGain(2))
    expect(imm.gCrit).toBeGreaterThan(criticalGain(3))
    expect(imm.ageSamples).toBe(2048 + 2 * 4096 + 1024)
    expect(imm.gCritMethod).toBe('root_finding')
    expect(slow.gCritMethod).toBe('closed_form')
  })

  it('d 很大時（多項式次數太高）改用連續延拓：在 d = ROOT_MAX_DELAY 與求根相差 < 0.03%；極端輸入不會卡住', () => {
    for (const df of [0.25, 0.5, 0.75]) {
      const root = criticalGainInfo(ROOT_MAX_DELAY, df)
      expect(root.method).toBe('root_finding')
      const cont = 2 * Math.sin(Math.PI / (4 * (ROOT_MAX_DELAY + df) + 2))
      expect(Math.abs(cont / root.g - 1)).toBeLessThan(3e-4)
      expect(criticalGainInfo(ROOT_MAX_DELAY + 1, df)).toEqual({ g: 2 * Math.sin(Math.PI / (4 * (ROOT_MAX_DELAY + 1 + df) + 2)), method: 'continuation' })
    }
    expect(criticalGainInfo(0, 0.3).method).toBe('jury')
    // N = 3、P_c = 65536：d = 21845、d_f = 1/3——必須立刻回傳（不對 2 萬次多項式求根）
    const t0 = Date.now()
    const extreme = latencyCalc({ fsGHz: 4, N: 3, D: 0, Pc: 65536, dCfg: 16, apply: 'immediate' })
    expect(Date.now() - t0).toBeLessThan(200)
    expect(extreme.dEff).toBe(16 + 21845)
    expect(extreme.dFrac).toBeCloseTo(1 / 3, 12)
    expect(extreme.gCritMethod).toBe('continuation')
    expect(extreme.gCrit).toBeCloseTo(Math.PI / (2 * (extreme.dEff + extreme.dFrac) + 1), 9) // 小角度：2 sin(x) ≈ 2x
  })
})
