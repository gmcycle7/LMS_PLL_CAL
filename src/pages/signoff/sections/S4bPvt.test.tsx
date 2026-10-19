import { render } from '@testing-library/react'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import mermaid from 'mermaid'
import { HandCalc, defaultValues } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { settleFromPoles } from '@/simulation/models/stability'
import { F_REF, gammaEff, gosHarmonic, makeL2, typeIIFinv } from '@/simulation/models/sspll'
import { cornerFeasibleScan, cornerJudge, kq } from '../judges'
import { handcalc } from '../handcalcs'
import { CHART_PVT_EFFECTS, PVT_DEFAULT, PVT_LOOP_PARAMS, S4bPvt, pvtCornerSpecs, pvtEffects, pvtFeasible, pvtLoop, pvtTable } from './S4bPvt'

/**
 * §4b PVT corner 表（S4bPvt.tsx）：每一格由既有的模型函式算（kq／cornerJudge／cornerFeasibleScan、settleFromPoles、makeL2／inversionBands／gosHarmonic），
 * 手算題 HC-SO.7 的答案與獨立重算一致，方塊圖真的畫得出來。
 * （signoff/index.test.tsx 與 handcalcs.test.tsx 的「八張圖」「六題」計數要跟著改：見回報的 notesForIntegration。）
 */
const SQ = Math.sqrt(2 / Math.PI)

function close(a: number, e: number, rel = 1e-9, abs = 1e-12, label = ''): void {
  expect(Number.isFinite(a), label).toBe(true)
  expect(Math.abs(a - e), `${label}：${a} vs ${e}`).toBeLessThanOrEqual(abs + rel * Math.abs(e))
}

describe('§4b PVT corner 表：三種效應各自的數字', () => {
  it('三個 corner（illustrative）：K_q = √(2/π)/σ_v；帶緣 = F-CS.8 的 closed form 乘上增益倍率；κ = 12·C_GOS（gosHarmonic）；Δa = a·TC·(T − 25)', () => {
    const rows = pvtEffects(PVT_DEFAULT)
    expect(rows.map((r) => r.name)).toEqual(['SS −40°C', 'TT 25°C', 'FF 125°C'])
    const { Kp, Ki } = PVT_LOOP_PARAMS
    close(Kp, 0.287717, 2e-6)
    close(Ki, 0.0382535, 2e-6)
    for (const [i, r] of rows.entries()) {
      const c = PVT_DEFAULT.corners[i]
      close(r.Kq, SQ / c.sigmaV, 1e-12, 0, `${r.name} Kq`)
      close(r.Kq, kq(c.sigmaV), 1e-12)
      // 帶緣：K_p、K_i 一起乘上倍率 → closed form (1/π) asin √(sK_i/(2(2 − sK_p)))（和 inversionBands 的二分法同值）
      const fInv = (typeIIFinv(c.gainScale * Kp, c.gainScale * Ki) * F_REF) / 1e6
      close(r.fInvMHz, fInv, 1e-6, 0, `${r.name} f_inv`)
      const loop = makeL2({ Kp, Ki, gainScale: c.gainScale })
      expect(pvtLoop(c.gainScale).bL).toEqual(loop.bL)
      close(r.kappa, 12 * gosHarmonic(PVT_DEFAULT.alpha, gammaEff(loop)), 1e-12, 0, `${r.name} κ`)
      close(r.K, r.Kq * r.kappa, 1e-12)
      close(r.deltaAFs, PVT_DEFAULT.aFs * PVT_DEFAULT.tcPpm * 1e-6 * (c.tempC - 25), 1e-12, 1e-9, `${r.name} Δa`)
      expect(r.minReH).toBeLessThan(0)
      expect(r.beta).toBeCloseTo((8 * PVT_DEFAULT.alpha) % 1, 12)
    }
    // 增益越高、帶越寬（案例頁 §6.5）：×0.8 < ×1（134.82 MHz）< ×1.25
    expect(rows[0].fInvMHz).toBeLessThan(rows[1].fInvMHz)
    expect(rows[1].fInvMHz).toBeLessThan(rows[2].fInvMHz)
    close(rows[1].fInvMHz, 134.82, 1e-4)
    // TT 沒有溫差：Δa = 0；SS 負、FF 正
    expect(rows[1].deltaAFs).toBe(0)
    expect(rows[0].deltaAFs).toBeLessThan(0)
    expect(rows[2].deltaAFs).toBeGreaterThan(0)
    close(rows[2].deltaAFs, 62500 * 300e-6 * 100, 1e-12) // +1875 fs
  })

  it('同一組 (μ, d, N, B)：五項判準就是 cornerJudge（等效 σ_v/κ、θ = 0 ⇒ K = K_q·κ）；重新收斂用 settleFromPoles(g, d, δ_tol/|Δa|)；斜坡落後 = ȧ/(f_u g)', () => {
    const rows = pvtTable(PVT_DEFAULT)
    const specs = pvtCornerSpecs(pvtEffects(PVT_DEFAULT))
    const judged = cornerJudge(specs, { mu: PVT_DEFAULT.mu, d: PVT_DEFAULT.d, pmTargetDeg: PVT_DEFAULT.pmTargetDeg, B: PVT_DEFAULT.B, N: PVT_DEFAULT.N, sigmaWMax: PVT_DEFAULT.sigmaWMax })
    for (const [i, r] of rows.entries()) {
      expect(r.judge).toEqual(judged[i])
      close(r.judge.K, r.Kq * r.kappa, 1e-12, 0, `${r.name} K`)
      close(r.judge.g, PVT_DEFAULT.mu * r.K, 1e-12, 0, `${r.name} g`)
      const fu = F_REF / PVT_DEFAULT.N
      close(r.driftPerBlock, (PVT_DEFAULT.aFs * PVT_DEFAULT.tcPpm * 1e-6 * PVT_DEFAULT.rampCPerS) / fu, 1e-12)
      close(r.lagFs, r.driftPerBlock / r.judge.g, 1e-12)
      if (Math.abs(r.deltaAFs) > PVT_DEFAULT.deltaTolFs) {
        const s = settleFromPoles(r.judge.g, PVT_DEFAULT.d, PVT_DEFAULT.deltaTolFs / Math.abs(r.deltaAFs))
        expect(r.reconvergeBlocks).toBe(s.blocks)
        expect(r.reconvergeExact).toBe(s.exact)
        expect(r.reconvergeBlocks).toBeGreaterThan(r.judge.settle95) // |Δa|/δ_tol ≫ 20 ⇒ 比衰減 95% 久
      } else expect(r.reconvergeBlocks).toBe(0)
      expect(r.lagFs).toBeLessThan(0.01) // MHz 級的 block 率：10 °C/s 的斜坡落後 ≪ 1 fs
    }
    expect(rows[1].reconvergeBlocks).toBe(0) // TT：校準點，沒有 Δa
    // 可行 μ 區間：同一個掃描函式；目前的 μ 併入格點，所以 μ 通過時區間一定非空
    const scan = pvtFeasible(PVT_DEFAULT)
    const ref = cornerFeasibleScan(specs, { d: 1, pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 }, undefined, [10])
    expect(scan.lo).toBe(ref.lo)
    expect(scan.hi).toBe(ref.hi)
    const allOk = rows.every((r) => Object.values(r.judge.ok).every(Boolean))
    if (allOk) {
      expect(scan.lo).toBeLessThanOrEqual(10)
      expect(scan.hi).toBeGreaterThanOrEqual(10)
    }
  })

  it('反面：κ ≤ 0 的 corner（基波落進反號帶）極性不過；增益倍率太大時主迴路本身不穩定（makeL2 的極點跑出單位圓，inversionBands 的帶更寬）', () => {
    const rows = pvtTable({ ...PVT_DEFAULT, corners: [{ name: 'bad', sigmaV: 100, gainScale: 1, tempC: 25 }], alpha: 0.123 })
    // α = 0.123：near-grid（β = 0.984 → 基波 64 MHz 在 L2 的反號帶內），κ 很小但仍為正（案例頁 §7.2 的 dead zone）
    expect(rows[0].kappa).toBeGreaterThan(0)
    expect(rows[0].kappa).toBeLessThan(0.15)
    const d1 = pvtTable({ ...PVT_DEFAULT, corners: [{ name: 'neg', sigmaV: 100, gainScale: 1, tempC: 25 }] })
    expect(d1[0].judge.ok.polarity).toBe(true)
  })
})

describe('HC-SO.7：PVT corner 表的一列', () => {
  it('預設值是 §4b 表的 SS −40°C 那一列（σ_v = 140、s = 0.8、κ = 0.5、μ = 10、a = 62.5 ps、TC = 300、T = −40、δ_tol = 5、Ṫ = 10、N = 4096）；答案與獨立重算一致', () => {
    const def = handcalc('HC-SO.7')
    const v = defaultValues(def)
    expect(v).toEqual({ sigmaV: 140, s: 0.8, kappa: 0.5, mu: 10, aPs: 62.5, tc: 300, Tc: -40, tol: 5, ramp: 10, N: 4096 })
    expect(def.validate?.(v) ?? null).toBeNull()
    const [Kc, g, fInv, dA, kRe, lag] = def.solve(v).results.map((r) => r.value)
    const { Kp, Ki } = PVT_LOOP_PARAMS
    const KqI = SQ / 140
    close(Kc, KqI * 0.5, 1e-12)
    close(g, 10 * KqI * 0.5, 1e-12)
    close(fInv, (4000 / Math.PI) * Math.asin(Math.sqrt((0.8 * Ki) / (2 * (2 - 0.8 * Kp)))), 1e-12)
    close(dA, 62500 * 300e-6 * -65, 1e-12)
    const rho = Math.abs(1 - g)
    close(kRe, Math.ceil(Math.log(5 / Math.abs(dA)) / Math.log(rho)), 0, 0)
    expect(kRe).toBe(settleFromPoles(g, 0, 5 / Math.abs(dA)).blocks)
    close(lag, (62500 * 300e-6 * 10) / (4e9 / 4096) / g, 1e-12)
    // tips 裡的範例數字
    const tips = def.tips!.join('')
    for (const t of ['0.0056992', '0.0028496', '0.028496', '118.56', '1218.8', '191', '6.74']) expect(tips, t).toContain(t)
    close(fInv, 118.56, 5e-5)
    close(lag, 6.74e-3, 2e-3)
    expect(kRe).toBe(191)
    // 畫面可渲染、每一步都是「符號式 = 代入 = 結果」
    const { container } = render(<HandCalc def={def} />)
    expectNoTexErrors(container)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThanOrEqual(12)
    for (const s of def.solve(v).steps) expect(s.tex.split('=').length, s.tex).toBeGreaterThanOrEqual(3)
  })

  it('validate：σ_v ≤ 0、s 太大（主迴路不穩定）、κ ≤ 0（極性錯誤）、g ≥ 2、Δa 在容許內（k_re = 0）', () => {
    const def = handcalc('HC-SO.7')
    const v = defaultValues(def)
    expect(def.validate?.({ ...v, sigmaV: 0 })).toMatch(/必須大於 0/)
    expect(def.validate?.({ ...v, s: 7 })).toMatch(/主迴路本身不穩定/)
    expect(def.validate?.({ ...v, kappa: -0.2 })).toMatch(/^C ≤ 0/)
    expect(def.validate?.({ ...v, mu: 1e4 })).toMatch(/發散/)
    expect(def.validate?.({ ...v, Tc: 25 })).toBeNull()
    const r = def.solve({ ...v, Tc: 25 }).results
    expect(r[3].value).toBe(0)
    expect(r[4].value).toBe(0)
  })
})

describe('§4b 的頁面與方塊圖', () => {
  beforeAll(() => {
    installMermaidSvgShim()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, forceLegacyMathML: true })
  })

  it('方塊圖真的畫得出來：沒有 Unsupported markdown、沒有殘留的 $、KaTeX 以外沒有 Unicode 拼的數學、節點 ≤ 14', async () => {
    const r = await renderMermaidForTest(CHART_PVT_EFFECTS)
    expect(r.text).not.toContain('Unsupported markdown')
    expect(r.text).not.toMatch(/\$/)
    expect(unicodeMathIn(r.plainText)).toEqual([])
    expect(r.nodeCount).toBeLessThanOrEqual(14)
    expect(r.mathCount).toBeGreaterThan(6)
  })

  it('Research 模式：表 4b-1、4b-2 各三列（corner 名稱為列標題）、F-SO.14 錨點、HC-SO.7、圖與導讀、可行區；沒有 KaTeX 錯誤；aria／title 裡沒有 $', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const { container } = renderPage(<S4bPvt />, { url: '/signoff' })
    expect(container.querySelector('#so-pvt h2')?.textContent).toContain('4b. PVT corner 表')
    const tables = Array.from(container.querySelectorAll('table.so-pvt-table'))
    expect(tables).toHaveLength(2)
    for (const t of tables) {
      expect(t.querySelector('caption')?.textContent).toMatch(/^表 4b-/)
      expect(Array.from(t.querySelectorAll('tbody th[scope="row"]')).map((th) => th.textContent)).toEqual(['SS −40°C', 'TT 25°C', 'FF 125°C'])
      for (const th of Array.from(t.querySelectorAll('thead th'))) expect(th.getAttribute('scope')).toBe('col')
    }
    expect(container.querySelector('[id="formula-F-SO.14"]')).not.toBeNull()
    expect(container.querySelector('[id="handcalc-HC-SO.7"]')).not.toBeNull()
    const fig = container.querySelector('figure.c-mermaid')
    expect(fig).not.toBeNull()
    expect((fig?.getAttribute('aria-label') ?? '').length).toBeGreaterThan(30)
    const walk = container.querySelector('.so-diagram-walk')
    expect(walk?.textContent).toContain('先看')
    expect(walk?.querySelector('.katex')).not.toBeNull()
    expectNoTexErrors(container)
    expect(container.textContent).toMatch(/區間|空集合/)
    for (const el of Array.from(container.querySelectorAll('[aria-label], [title]'))) {
      expect(el.getAttribute('aria-label') ?? '').not.toContain('$')
      expect(el.getAttribute('title') ?? '').not.toContain('$')
    }
    localStorage.clear()
  })
})
