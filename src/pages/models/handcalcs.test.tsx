import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fireEvent, render } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, inputError, randomValues } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { createRng } from '@/simulation/core'
import { runBlockLms } from '@/simulation/models/blockLms'
import { dtcDelayFs, dtcInlDnl, quantizeDtcCode } from '@/simulation/models/dtc'
import { designDtLoop } from '@/simulation/models/pll'
import { freqz, getWindow, windowStats } from '@/simulation/signal'
import { DEFAULT_FFT_PARAMS, FFT_DEMO_FS, dbPowerSum, runFftPitfalls, scallopLossDb, welchLobeBins } from './experiments/fftPitfalls'
import { truncationEquilibrium } from './experiments/gmacMath'
import { DEFAULT_GMAC_PARAMS, gmacSizing } from './experiments/gmacSizing'
import { buildMetricRows, tailStats } from './experiments/jsonLabModel'
import { FORMULAS } from './formulas'
import { HANDCALCS, HANDCALC_CONSTANTS, handcalc } from './handcalcs'
import { SPEC_NUMBERS } from './refNumbers'

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** |actual − expected| ≤ abs + rel·|expected| */
function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, label = ''): void {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

/** 預設值 ＋ 20 組隨機練習值（randomValues 已保證通過 validate） */
function valueSets(h: HandCalcDef): Record<string, number>[] {
  return [defaultValues(h), ...SEEDS.map((s) => randomValues(h, s))]
}

/** 依序取出答案的數值 */
function values(h: HandCalcDef, v: Record<string, number>): number[] {
  return h.solve(v).results.map((r) => r.value)
}

/** 去掉 KaTeX 後的文字：`$…$` 沒成對或沒被 mathText 處理時會殘留 `$` */
function plainText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex, annotation').forEach((e) => e.remove())
  return clone.textContent ?? ''
}

/** 遞迴列出 src 下所有 handcalcs.ts（檢查 ID 前綴沒有和別的資料夾撞號；不 import 別人的模組） */
function handcalcFiles(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...handcalcFiles(p))
    else if (f === 'handcalcs.ts') out.push(p)
  }
  return out
}

describe('Models 頁「帶入手算」（docs/teaching-style.md §7）', () => {
  it('登錄：6 題、ID 為本頁專用前綴 HC-MD.n 且全站唯一、頁面 /models、公式 ID 存在、每個輸入都有手算友善的練習值', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-MD.1', 'HC-MD.2', 'HC-MD.3', 'HC-MD.4', 'HC-MD.5', 'HC-MD.6'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.id).toMatch(/^HC-MD\.\d+$/)
      expect(h.page).toBe('/models')
      expect(h.formulaId && formulaIds.has(h.formulaId), `${h.id} → ${h.formulaId}`).toBe(true)
      expect(h.tips && h.tips.length > 0, `${h.id} tips`).toBe(true)
      expect(typeof h.validate, `${h.id} validate`).toBe('function')
      for (const i of h.inputs) {
        expect(i.practice?.choices?.length, `${h.id}.${i.key} practice`).toBeGreaterThanOrEqual(2)
        expect(inputError(i, i.default), `${h.id}.${i.key} default`).toBeNull()
        for (const c of i.practice?.choices ?? []) expect(inputError(i, c), `${h.id}.${i.key} choice ${c}`).toBeNull()
      }
      expect(h.validate?.(defaultValues(h)) ?? null, `${h.id} 預設值`).toBeNull()
    }
    // 全站唯一：HC-MD. 前綴只出現在本頁的 handcalcs.ts（讀檔比對，不依賴其他資料夾的模組能不能載入）
    const mine = resolve(process.cwd(), 'src/pages/models/handcalcs.ts')
    for (const file of handcalcFiles(resolve(process.cwd(), 'src'))) {
      const ids = Array.from(readFileSync(file, 'utf8').matchAll(/^\s*id: '(HC-[^']+)'/gm)).map((m) => m[1])
      if (file === mine) expect(ids).toEqual(HANDCALCS.map((h) => h.id))
      else expect(ids.filter((id) => id.startsWith('HC-MD.')), file).toEqual([])
    }
    // 全站彙整（手算練習簿）以 glob 收錄 src/pages/*/handcalcs.ts 的 HANDCALCS
    expect(readFileSync(resolve(process.cwd(), 'src/app/handcalcs.ts'), 'utf8')).toContain("'../pages/*/handcalcs.ts'")
    expect(() => handcalc('HC-99.9')).toThrow(/找不到手算題/)
  })

  it('每一題：預設值與 20 組隨機練習值都合法、答案有限、每一步都是「式子 = 代入 = 結果」；自己的答案通過、錯 5% 不通過', () => {
    for (const h of HANDCALCS) {
      const distinct = new Set<string>()
      for (const v of valueSets(h)) {
        distinct.add(JSON.stringify(v))
        expect(h.validate?.(v) ?? null, `${h.id} ${JSON.stringify(v)}`).toBeNull()
        const sol = h.solve(v)
        expect(sol.steps.length, h.id).toBeGreaterThanOrEqual(6)
        expect(sol.results.length, h.id).toBeGreaterThan(0)
        for (const s of sol.steps) {
          expect(s.tex, `${h.id} step`).toContain('=')
          expect(s.why.length, `${h.id} why`).toBeGreaterThan(4)
        }
        // 代入的數字不可以是 NaN／∞（texNum 會把它們印成 \text{NaN}、\infty）；說明文字裡的「朝 −∞」不算
        for (const s of sol.steps) expect(s.tex, `${h.id} ${JSON.stringify(v)}`).not.toMatch(/NaN|undefined|Infinity|\\infty|\[object/)
        for (const s of [...sol.steps.map((x) => x.why), ...(sol.notes ?? []), ...sol.results.map((r) => r.symbol + (r.label ?? ''))]) {
          expect(s, `${h.id} ${JSON.stringify(v)}`).not.toMatch(/NaN|undefined|Infinity|\[object/)
        }
        for (const r of sol.results) {
          expect(Number.isFinite(r.value), `${h.id} ${r.symbol} ${JSON.stringify(v)}`).toBe(true)
          expect(checkAnswer(r.value, r).ok, `${h.id} ${r.symbol}`).toBe(true)
          if (r.value !== 0) expect(checkAnswer(r.value * 1.05 + (Number.isInteger(r.value) ? 1 : 0), r).ok, `${h.id} ${r.symbol} ${JSON.stringify(v)}`).toBe(false)
        }
      }
      // 「換一題」真的換得到題目（沒有因為 validate 太嚴而一直退回預設值）
      expect(distinct.size, `${h.id} 隨機題目的種類`).toBeGreaterThanOrEqual(8)
    }
  })

  it('HC-MD.1（F-15.8）：K_p、K_i、poles、ρ = pll.ts 的 designDtLoop = 獨立的二次公式；pole 代回 H_PD 的分母為 0', () => {
    const h = handcalc('HC-MD.1')
    expect(defaultValues(h)).toEqual({ wnTs: 0.1, zeta: 0.7 })
    const extra = [
      { wnTs: 0.05, zeta: 1 }, // 兩個實數 pole
      { wnTs: 0.4, zeta: 0.8 }, // 2ζ + ω_nT_s = 2：重根
      { wnTs: 1.5, zeta: 1 }, // 不穩定
      { wnTs: 1, zeta: 0.5 }, // K_p = K_i = 1：兩個 pole 都在原點（deadbeat）
      { wnTs: 0.5, zeta: 1 }, // K_p = 1：一個 pole 在原點
    ]
    for (const v of [...valueSets(h), ...extra]) {
      const { wnTs, zeta } = v
      const sol = h.solve(v)
      const [Kp, Ki, r1, r2, rho] = sol.results.map((r) => r.value)
      // 獨立重算
      const kp = 2 * zeta * wnTs
      const ki = wnTs * wnTs
      const a1 = kp + ki - 2
      const a2 = 1 - kp
      const disc = a1 * a1 - 4 * a2
      close(Kp, kp, 1e-12, 1e-15, 'Kp')
      close(Ki, ki, 1e-12, 1e-15, 'Ki')
      const des = designDtLoop({ wnTs, zeta, loopDelay: 0 })
      close(rho, des.spectralRadius, 1e-12, 1e-12, 'rho')
      if (disc < -1e-12) {
        expect(sol.results[2].symbol).toContain('Re')
        close(r1, -a1 / 2, 1e-9, 1e-9, 'Re')
        close(r2, Math.sqrt(-disc) / 2, 1e-6, 1e-9, 'Im')
        close(rho, Math.sqrt(a2), 1e-9, 1e-9, '|z| = √a2')
        close(rho, Math.hypot(r1, r2), 1e-9, 1e-9, '|z| = √(Re² + Im²)')
      } else {
        expect(sol.results[2].symbol).toBe('z_1')
        const root = Math.sqrt(Math.max(disc, 0))
        close(r1, (-a1 + root) / 2, 1e-6, 1e-6, 'z1')
        close(r2, (-a1 - root) / 2, 1e-6, 1e-6, 'z2')
        close(rho, Math.max(Math.abs(r1), Math.abs(r2)), 1e-6, 1e-6, 'rho = max')
        close(r1 * r2, a2, 1e-6, 1e-6, 'Vieta')
      }
      // pole 是 1 + L(z) = 0 的根：把 z^{-1} 代回 H_PD 的分母（實際模型的係數）
      const zinv = disc < -1e-12 ? { re: r1 / (r1 * r1 + r2 * r2), im: -r2 / (r1 * r1 + r2 * r2) } : r1 !== 0 ? { re: 1 / r1, im: 0 } : null
      if (zinv) {
        const [c0, c1, c2] = [des.Hpd.a[0], des.Hpd.a[1] ?? 0, des.Hpd.a[2] ?? 0]
        const z2 = { re: zinv.re * zinv.re - zinv.im * zinv.im, im: 2 * zinv.re * zinv.im }
        const re = c0 + c1 * zinv.re + c2 * z2.re
        const im = c1 * zinv.im + c2 * z2.im
        expect(Math.hypot(re, im), `char(z) ${JSON.stringify(v)}`).toBeLessThan(1e-6 * (1 + Math.hypot(zinv.re, zinv.im) ** 2))
      }
      // 穩定與否的說明和實際模型一致
      expect(sol.notes?.[0]).toMatch(des.stable ? /穩定，暫態/ : /不穩定/)
    }
    // 範例數字（tips）
    const [Kp, Ki, re, im, rho] = values(h, defaultValues(h))
    expect([Kp, Ki].map((x) => Number(x.toPrecision(6)))).toEqual([0.14, 0.01])
    expect(re.toFixed(3)).toBe('0.925')
    expect(im.toFixed(6)).toBe('0.066144')
    expect(rho.toFixed(5)).toBe('0.92736')
    // 穩定時 H_PD 在 DC 為 0（type-II）、h_PD[0] = 1：和 §4.1 的推導一致
    const des = designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 0 })
    const H0 = freqz(des.Hpd.b, des.Hpd.a, [0])[0]
    expect(Math.hypot(H0.re, H0.im)).toBeLessThan(1e-9)
    expect(des.Hpd.b[0] / des.Hpd.a[0]).toBe(1)
    // d = 1 的說明用同一個函式
    expect(h.solve(defaultValues(h)).notes?.join('')).toContain(designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 }).spectralRadius.toPrecision(5))
    // validate：沒有增益／沒有阻尼時解釋原因
    expect(h.validate?.({ wnTs: 0, zeta: 0.7 })).toMatch(/沒有增益/)
    expect(h.validate?.({ wnTs: 0.1, zeta: 0 })).toMatch(/沒有阻尼/)
    expect(h.validate?.({ wnTs: 1.5, zeta: 1 })).toBeNull() // 不穩定仍然可以算，notes 會說明
    expect(inputError(h.inputs[0], 2.5)).toMatch(/不可大於/) // JSON 合法範圍 (0, 2]
    expect(h.solve({ wnTs: 0.5, zeta: 0.5 }).notes?.join('')).toMatch(/E44/)
  })

  it('HC-MD.2（F-15.10）：量化、飽和與延遲 = dtc.ts 的 quantizeDtcCode / dtcDelayFs = 獨立重算；§4.3 表格的每一列', () => {
    const h = handcalc('HC-MD.2')
    expect(defaultValues(h)).toEqual({ c: 10.5, g: 250, o: 1000, c2: 0.2, bits: 6 })
    for (const v of valueSets(h)) {
      const { c, g, o, c2, bits } = v
      const [cn, tn, ct, tt, dt] = values(h, v)
      const hi = 2 ** bits - 1
      const clamp = (k: number) => Math.min(hi, Math.max(0, k))
      const kn = clamp(Math.floor(c + 0.5))
      const kt = clamp(Math.floor(c))
      const tau = (k: number) => g * k + o + c2 * k * k
      expect(cn).toBe(kn)
      expect(ct).toBe(kt)
      close(tn, tau(kn), 1e-12, 1e-9, 'tau near')
      close(tt, tau(kt), 1e-12, 1e-9, 'tau trunc')
      close(dt, tau(kn) - tau(kt), 1e-9, 1e-9, 'delta tau')
      // 實際模型
      const P = { gainFs: g, offsetFs: o, c2, bits }
      expect(cn).toBe(quantizeDtcCode(c, { ...P, rounding: 'nearest' }).code)
      expect(tt).toBe(dtcDelayFs(c, { ...P, rounding: 'truncate' }))
    }
    // §4.3 表格（g = 250、o = 1000、c2 = 0.2、6-bit）：c = −3、10.4、10.5、31.49、63、70.2
    const base = defaultValues(h)
    const table: [number, number, number, number, number][] = [
      [-3, 0, 1000, 0, 1000],
      [10.4, 10, 3520, 10, 3520],
      [10.5, 11, 3774.2, 10, 3520],
      [31.49, 31, 8942.2, 31, 8942.2],
      [63, 63, 17543.8, 63, 17543.8],
      [70.2, 63, 17543.8, 63, 17543.8],
    ]
    for (const [c, cn, tn, ct, tt] of table) {
      const got = values(h, { ...base, c })
      expect(got[0]).toBe(cn)
      close(got[1], tn, 1e-12, 1e-9, `tau near c=${c}`)
      expect(got[2]).toBe(ct)
      close(got[3], tt, 1e-12, 1e-9, `tau trunc c=${c}`)
    }
    close(values(h, base)[4], 254.2, 1e-12, 1e-9, '10.5 的兩種 rounding 差 254.2 fs')
    // 負數的 floor：⌊−2.5⌋ = −3（不是 −2），飽和到 0
    expect(h.solve({ ...base, c: -3 }).steps[1].tex).toContain(String.raw`\lfloor-2.5\rfloor=-3`)
    expect(h.solve({ ...base, c: 70.2 }).steps[2].why).toMatch(/飽和/)
    // INL 的說明取自 dtcInlDnl：6-bit、c2 = 0.2 時 0.2 × 31 × 32 = 198.4 fs = 0.7555 LSB
    const inl = dtcInlDnl({ gainFs: 250, offsetFs: 1000, c2: 0.2, bits: 6 })
    close(Math.max(...Array.from(inl.inlFs).map(Math.abs)), 0.2 * 31 * 32, 1e-9, 1e-9, 'INL max')
    expect(h.solve(base).notes?.join('')).toContain('198.4')
    expect(h.solve(base).notes?.join('')).toContain(inl.maxAbsInlLsb.toPrecision(4))
    // 整數答案必須完全正確
    const r0 = h.solve(base).results[0]
    expect(checkAnswer(11, r0).ok).toBe(true)
    expect(checkAnswer(10, r0).ok).toBe(false)
    expect(checkAnswer(11.2, r0).ok).toBe(false)
    // validate：不是單調的 DTC 不給算
    expect(h.validate?.({ ...base, g: 0 })).toMatch(/不是一顆 DTC/)
    expect(h.validate?.({ ...base, g: -250 })).toMatch(/不是一顆 DTC/)
    expect(h.validate?.({ ...base, c2: -3 })).toMatch(/不再單調/) // 250 + 2·(−3)·63 < 0
    expect(h.validate?.({ ...base, c2: -1 })).toBeNull() // 250 − 126 > 0
  })

  it('HC-MD.3（F-15.11）：每 bin 雜訊底 = runFftPitfalls 的解析值（三種視窗）；矩形窗洩漏近似 ≈ 視窗 DTFT 的精確值 ≈ 實際 periodogram', () => {
    const h = handcalc('HC-MD.3')
    for (const window of ['rectangular', 'hann', 'blackmanHarris'] as const) {
      for (const log2N of [8, 12, 14]) {
        const p = { ...DEFAULT_FFT_PARAMS, window, log2N, spurOffsetBins: 20 }
        const r = runFftPitfalls(p)
        const enbw = windowStats(getWindow(window, 2 ** log2N)).enbwBins
        const floor = values(h, { log2N, noiseDbc: p.noiseDbc, enbw, spurDbc: p.spurDbc, m: 19, delta: 0.5 })[0]
        close(floor, r.noiseFloorDbc, 0, 1e-9, `${window} N=2^${log2N}`)
        // 模擬的雜訊底（遠離 tone 的 bin 中位數 ÷ ln2）只在洩漏不主導、而且 bin 夠多時可比：Blackman-Harris、N ≥ 4096
        if (window === 'blackmanHarris' && log2N >= 12) close(r.floorMedianDbc + 10 * Math.log10(1 / Math.LN2), floor, 0, 0.6, `periodogram 中位數 N=2^${log2N}`)
      }
    }
    for (const v of valueSets(h)) {
      const { log2N, noiseDbc, enbw, m, delta } = v
      const [floor, leak] = values(h, v)
      const N = 2 ** log2N
      close(floor, noiseDbc - 10 * Math.log10(N / (2 * enbw)), 1e-12, 1e-9, 'floor 獨立重算')
      close(leak, 20 * Math.log10(Math.sin(Math.PI * delta) / (Math.PI * (m + delta))), 1e-12, 1e-9, 'leak 獨立重算')
      // 視窗 DTFT 的直接求和（scallopLossDb）是精確值：ν ≤ N/8 時近似誤差 < 0.25 dB
      close(leak, scallopLossDb(getWindow('rectangular', N), m + delta), 0, 0.25, `leak vs exact DTFT ${JSON.stringify(v)}`)
    }
    // 預設值 = FFT 實驗的預設值：ν = 39.5
    const d = defaultValues(h)
    expect(d.log2N).toBe(DEFAULT_FFT_PARAMS.log2N)
    expect(d.noiseDbc).toBe(DEFAULT_FFT_PARAMS.noiseDbc)
    expect(d.spurDbc).toBe(DEFAULT_FFT_PARAMS.spurDbc)
    expect(d.m + d.delta).toBe(DEFAULT_FFT_PARAMS.spurOffsetBins - 0.5)
    expect(d.delta).toBe(DEFAULT_FFT_PARAMS.offsetBins)
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    const [floor, leak] = values(h, d)
    close(floor, r.noiseFloorDbc, 0, 1e-9, 'floor')
    close(leak, r.leakAtSpurDbc, 0, 0.3, 'leak vs periodogram') // 實驗取 spur 前後 1 bin 的最大值
    close(leak, scallopLossDb(getWindow('rectangular', r.N), d.m + d.delta), 0, 0.01, 'leak vs exact DTFT')
    expect(floor.toFixed(2)).toBe('-93.11')
    expect(leak.toFixed(2)).toBe('-41.87')
    expect(Math.round(leak - d.spurDbc)).toBe(38)
    // 反面：coherent 沒有洩漏可算；ν 超過 Nyquist；ν 太大時近似式失準（訊息裡給精確值）
    expect(h.validate?.({ ...d, delta: 0 })).toMatch(/coherent/)
    expect(h.validate?.({ ...d, log2N: 8, m: 200 })).toMatch(/Nyquist/)
    const far = h.validate?.({ ...d, log2N: 8, m: 99 }) ?? ''
    expect(far).toMatch(/誤差已超過/)
    expect(far).toContain(scallopLossDb(getWindow('rectangular', 256), 99.5).toPrecision(4))
    expect(HANDCALC_CONSTANTS.LEAK_APPROX_MAX_FRACTION).toBe(1 / 8)
    // notes 會判斷看不看得到
    expect(h.solve(d).notes?.join('')).toMatch(/leakage/)
    expect(h.solve({ ...d, log2N: 8, m: 19 }).notes?.[0]).toMatch(/埋在雜訊裡|分不出來/)
  })

  it('HC-MD.4（F-15.11）：主瓣雜訊與 RBW = runFftPitfalls 的值；功率和 ≈ 實際 Welch 讀值；峰值 PSD 隨 RBW 改變', () => {
    const h = handcalc('HC-MD.4')
    const d = defaultValues(h)
    expect(d).toEqual({ win: 1, log2Seg: DEFAULT_FFT_PARAMS.welchLog2Seg, spurDbc: DEFAULT_FFT_PARAMS.spurDbc, noiseDbc: DEFAULT_FFT_PARAMS.noiseDbc, fsMHz: FFT_DEMO_FS / 1e6 })
    const NAMES = { 1: 'rectangular', 2: 'hann', 3: 'blackmanHarris' } as const
    const NBINS = { 1: 5, 2: 7, 3: 11 } as const
    const ENBW = { 1: 1, 2: 1.5, 3: 2.0044 } as const
    for (const v of valueSets(h)) {
      const win = v.win as 1 | 2 | 3
      const [lobe, reading, rbwKHz, peak] = values(h, v)
      const nseg = 2 ** v.log2Seg
      // 獨立重算（視窗表：n_bins = 5 / 7 / 11、ENBW = 1 / 1.5 / 2.0044）
      close(lobe, v.noiseDbc + 10 * Math.log10((2 * NBINS[win]) / nseg), 1e-12, 1e-9, 'lobe noise')
      close(reading, 10 * Math.log10(10 ** (v.spurDbc / 10) + 10 ** (lobe / 10)), 1e-12, 1e-9, 'power sum')
      close(rbwKHz, (ENBW[win] * v.fsMHz * 1e3) / nseg, 2e-4, 0, 'RBW')
      close(peak, v.spurDbc - 10 * Math.log10(rbwKHz * 1e3), 1e-12, 1e-9, 'peak PSD')
      expect(welchLobeBins(NAMES[win])).toBe(NBINS[win])
      expect(reading).toBeGreaterThan(Math.max(v.spurDbc, lobe)) // 功率和一定比兩者都大
      expect(reading).toBeLessThanOrEqual(Math.max(v.spurDbc, lobe) + 3.0103)
    }
    // 實際模型（coherent 取樣，沒有載波洩漏）：三種視窗、兩種 segment 長度。
    // spur 放在 400 個 bin 外（Welch 頻譜上相隔 50／100 個 bin），主瓣積分才不會碰到載波的主瓣（題目 notes 的前提）
    for (const win of [1, 2, 3] as const) {
      for (const log2Seg of [9, 10]) {
        const r = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0, spurOffsetBins: 400, window: NAMES[win], welchLog2Seg: log2Seg })
        expect(r.welchLobeLeakDbc, `載波洩漏 ${NAMES[win]}`).toBeLessThan(-150)
        const [lobe, reading, rbwKHz, peak] = values(h, { ...d, win, log2Seg })
        close(lobe, r.welchLobeNoiseDbc, 0, 1e-9, `lobe noise ${NAMES[win]}`)
        close(rbwKHz * 1e3, r.welchEnbwHz, 1e-9, 0, `RBW ${NAMES[win]}`)
        close(r.spurWelchDbc, reading, 0, 1.5, `Welch 讀值 ${NAMES[win]} 2^${log2Seg}`) // 單一紀錄的統計起伏
        // 峰值 PSD：雜訊很小（−110 dBc）時就是 tone 的 P_spur − 10log₁₀(RBW)（0.2 dB 內）；
        // 預設雜訊下是 tone 與雜訊密度的功率和，但單一 bin、只有 7～15 個 segment 平均，起伏約 ±2 dB
        const quiet = runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0, spurOffsetBins: 400, window: NAMES[win], welchLog2Seg: log2Seg, noiseDbc: -110 })
        close(quiet.spurWelchPeakDbcHz, peak, 0, 0.2, `峰值 PSD（低雜訊）${NAMES[win]} 2^${log2Seg}`)
        const n0 = v0NoiseDensity(d.noiseDbc, d.fsMHz * 1e6)
        close(r.spurWelchPeakDbcHz, dbPowerSum(peak, n0), 0, 2.5, `峰值 PSD ${NAMES[win]} 2^${log2Seg}`)
      }
    }
    // 範例數字（tips）：−77.09 dBc、−75.30 dBc、195.3125 kHz；實驗把 δ 設成 0 時 (B) 的讀值就在附近
    const [lobe, reading, rbwKHz, peak] = values(h, d)
    close(runFftPitfalls({ ...DEFAULT_FFT_PARAMS, offsetBins: 0 }).spurWelchDbc, reading, 0, 1.5, '預設實驗（δ = 0）的 Welch 讀值')
    expect(lobe.toFixed(2)).toBe('-77.09')
    expect(reading.toFixed(2)).toBe('-75.30')
    expect(rbwKHz).toBe(195.3125)
    expect(peak.toFixed(2)).toBe('-132.91')
    // n_seg 加倍：主瓣雜訊 −3.01 dB、tone 的峰值 PSD +3.01 dB（dBc/Hz 不是 tone 的單位）
    const twice = values(h, { ...d, log2Seg: d.log2Seg + 1 })
    close(twice[0] - lobe, -10 * Math.log10(2), 1e-9, 1e-9, 'lobe −3 dB')
    close(twice[3] - peak, 10 * Math.log10(2), 1e-9, 1e-9, 'peak +3 dB')
    expect(h.solve(d).notes?.[1]).toContain(String(Number(twice[3].toPrecision(5)))) // −129.9 dBc/Hz
    // validate：視窗代號
    expect(h.validate?.({ ...d, win: 0 })).toMatch(/視窗代號只有/)
    expect(h.validate?.({ ...d, win: 4 })).toMatch(/視窗代號只有/)
    expect(h.validate?.({ ...d, win: 3 })).toBeNull()
  })

  it('HC-MD.5（F-15.12）：N_eff、SE = JSON Lab 用的函式 = 有限長度的精確雙重和（差 < 0.5/N_eff）= AR(1) Monte Carlo；T13 的預設模擬', () => {
    const h = handcalc('HC-MD.5')
    const d = defaultValues(h)
    // 預設值 = §15.3 範例：後半段 1000 個 block、ρ₁ = p、s_w = σ_w（5 位有效數字）
    expect(d.nBlk).toBe(1000)
    expect(d.rho).toBe(Number(SPEC_NUMBERS.p.toPrecision(5)))
    expect(d.s).toBe(Number(SPEC_NUMBERS.sigmaW.toPrecision(5)))
    for (const v of valueSets(h)) {
      const { nBlk, rho, s } = v
      const [nEff, se, tol, rel] = values(h, v)
      close(nEff, (nBlk * (1 - rho)) / (1 + rho), 1e-12, 0, 'N_eff')
      close(se, s / Math.sqrt(nEff), 1e-12, 0, 'SE')
      close(tol, 4 * se, 1e-12, 0, '4SE')
      close(rel, Math.sqrt((1 + rho * rho) / (2 * nBlk * (1 - rho * rho))), 1e-12, 0, 'relSE')
      // 精確的有限長度結果：Var(w̄) = σ²/m²·[m + 2Σ_{ℓ=1}^{m−1}(m − ℓ)ρ^ℓ]（F-15.12 推導的第 3 步，不取極限）
      let sum = nBlk
      let pw = 1
      for (let l = 1; l < nBlk; l++) {
        pw *= rho
        if (Math.abs(pw) < 1e-300) break
        sum += 2 * (nBlk - l) * pw
      }
      const exactSe = (s * Math.sqrt(sum)) / nBlk
      expect(Math.abs(se / exactSe - 1), `漸近式 vs 精確 ${JSON.stringify(v)}`).toBeLessThan(0.5 / nEff)
      expect(nEff).toBeGreaterThanOrEqual(HANDCALC_CONSTANTS.AR1_MIN_NEFF)
    }
    // Monte Carlo：600 條 AR(1)（ρ = 0.9、m = 500、σ = 1）的樣本平均與樣本標準差的散佈
    const rho = 0.9
    const m = 500
    const rng = createRng(20261010).fork('hc-md5-ar1')
    const means: number[] = []
    const stds: number[] = []
    const innov = Math.sqrt(1 - rho * rho)
    for (let t = 0; t < 600; t++) {
      let x = rng.normal()
      let a = 0
      let b = 0
      for (let k = 0; k < m; k++) {
        x = rho * x + innov * rng.normal()
        a += x
        b += x * x
      }
      means.push(a / m)
      stds.push(Math.sqrt(b / m - (a / m) ** 2))
    }
    const sd = (xs: number[]) => {
      const mu = xs.reduce((p, c) => p + c, 0) / xs.length
      return Math.sqrt(xs.reduce((p, c) => p + (c - mu) ** 2, 0) / (xs.length - 1))
    }
    const [nEff, se, , rel] = values(h, { nBlk: m, rho, s: 1 })
    close(nEff, 500 / 19, 1e-12, 0, 'N_eff(0.9, 500)')
    close(sd(means), se, 0.12, 0, 'MC: 平均值的標準差 ≈ SE') // 600 次試驗的統計誤差約 3%，再加上有限長度修正 2%
    close(sd(stds), rel, 0.15, 0, 'MC: 標準差的相對標準誤')
    // 把同一條 AR(1) 丟給 JSON Lab 的 tailStats：它用資料的 ρ̂₁ 與 s 代同一個公式
    const series = new Float64Array(2 * m + 1)
    let x = 0
    for (let k = 0; k < series.length; k++) {
      x = rho * x + innov * rng.normal()
      series[k] = x
    }
    const ts = tailStats(series)
    expect(ts.m).toBe(m)
    expect(Math.abs(ts.rho1 - rho)).toBeLessThan(0.06)
    const viaHand = values(h, { nBlk: ts.m, rho: ts.rho1, s: 1 })[1]
    expect(ts.seMean / viaHand).toBeGreaterThan(0.7) // s 是資料的標準差（約 1）
    expect(ts.seMean / viaHand).toBeLessThan(1.3)
    // T13 的預設模擬：指標表「平均 w」的容忍度（資料的 ρ̂₁、s_w）與手算（解析的 p、σ_w）同一個量級
    const res = runBlockLms({})
    const row = buildMetricRows(res)[0]
    expect(row.name).toContain('平均')
    const tolHand = values(h, d)[2]
    expect((row.tolerance as number) / tolHand).toBeGreaterThan(0.6)
    expect((row.tolerance as number) / tolHand).toBeLessThan(1.6)
    expect(Math.abs((row.value as number) - (row.analytic as number))).toBeLessThan(row.tolerance as number) // 模擬與 w* 一致
    // 範例數字（tips）
    const [n0, se0, tol0, rel0] = values(h, d)
    expect(n0.toFixed(2)).toBe('41.55')
    expect(se0.toFixed(4)).toBe('0.0619')
    expect(tol0.toFixed(3)).toBe('0.248')
    expect((100 * rel0).toFixed(2)).toBe('7.76')
    // validate：非平穩、紀錄太短
    expect(h.validate?.({ ...d, rho: 1 })).toMatch(/random walk/)
    expect(h.validate?.({ ...d, rho: -1.2 })).toMatch(/不是平穩的/)
    const short = h.validate?.({ ...d, rho: 0.99 }) ?? ''
    expect(short).toMatch(/紀錄太短/)
    expect(short).toContain('1990') // 至少 10 × 1.99/0.01 = 1990 個 block
    expect(h.validate?.({ ...d, rho: 0.99, nBlk: 1990 })).toBeNull()
    expect(h.validate?.({ ...d, rho: -0.5 })).toBeNull() // 負相關：N_eff > N_blk，仍然成立
    expect(values(h, { ...d, rho: -0.5 })[0]).toBe(3000)
  }, 60_000)

  it('HC-MD.6（綜合；F-15.5、F-16.3）：σ_w、δ*、F_G,min = §9.2 計算器的 gmacSizing = 獨立重算；與精確 Binomial mean-field 的差距在 2^{1−ℓ} + 3.5% 內', () => {
    const h = handcalc('HC-MD.6')
    const d = defaultValues(h)
    expect(d).toEqual({ sigmaV: DEFAULT_GMAC_PARAMS.sigmaV, mu: DEFAULT_GMAC_PARAMS.mu, bx: DEFAULT_GMAC_PARAMS.bx, log2N: DEFAULT_GMAC_PARAMS.log2N })
    for (const v of valueSets(h)) {
      const { sigmaV, mu, bx, log2N } = v
      const [sigmaW, d0, fMin, dF] = values(h, v)
      // 獨立重算（封閉式）
      const half = 2 ** (bx - 1)
      const xn = (half - 1) / half
      const K = (HANDCALC_CONSTANTS.SQ / sigmaV) * xn * xn
      const g = mu * K
      const N = 2 ** log2N
      const sw = (mu * xn) / Math.sqrt(N * (1 - (1 - g) ** 2))
      const delta0 = 1 / half / (2 * K)
      const F = delta0 > sw ? Math.ceil(Math.log2(delta0 / sw) - 1e-12) : 0
      close(sigmaW, sw, 1e-9, 0, 'sigma_w')
      close(d0, delta0, 1e-9, 0, 'delta*(0)')
      expect(fMin, `F_min ${JSON.stringify(v)}`).toBe(F)
      close(dF, delta0 / 2 ** F, 1e-9, 0, 'delta*(F_min)')
      expect(dF).toBeLessThanOrEqual(sigmaW * (1 + 1e-12))
      if (F > 0) expect(2 * dF).toBeGreaterThan(sigmaW) // 少 1 bit 就不夠
      // 實際模型：§9.2 計算器的 gmacSizing（同一個函式）與精確的 Binomial mean-field
      const at = (gFracBits: number) => gmacSizing({ ...DEFAULT_GMAC_PARAMS, sigmaV, mu, bx, log2N, gFracBits })
      expect(sigmaW).toBe(at(0).sigmaW)
      expect(d0).toBe(at(0).eq.approxDeltaStar)
      expect(dF).toBe(at(F).eq.approxDeltaStar)
      for (const FF of F > 0 ? [0, F] : [0]) {
        const ell = log2N - FF
        const eq = truncationEquilibrium({ bx, log2N, gFracBits: FF, rounding: 'floor', sigmaV })
        expect(eq.hasEquilibrium).toBe(true)
        // ±A code 的總和只取偶數倍：被丟掉的部分平均是 (1 − 2^{1−ℓ})/2 LSB，近似式多估 2^{1−ℓ}；其餘（N = 256 時最多約 3%）是 Binomial 離散造成的
        expect(Math.abs(eq.deltaStar / (FF === 0 ? d0 : dF) - 1), `exact vs approx F=${FF} ${JSON.stringify(v)}`).toBeLessThan(2 ** (1 - ell) + 0.035)
      }
    }
    // 範例數字（tips）＝ §9.2 計算器的預設值
    const [sigmaW, d0, fMin, dF] = values(h, d)
    expect(sigmaW.toPrecision(4)).toBe('0.3987')
    expect(d0.toPrecision(4)).toBe('2.087')
    expect((d0 / sigmaW).toFixed(2)).toBe('5.23')
    expect(fMin).toBe(3)
    expect(dF.toPrecision(4)).toBe('0.2608')
    // 開場問題的數字：精確 mean-field 2.0848 fs 寫在 notes
    expect(h.solve(d).notes?.[1]).toContain(truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 0, rounding: 'floor', sigmaV: 100 }).deltaStar.toPrecision(5))
    // tips 提到的 §3.4 σ_w（±1 code）比這裡（±31/32）大一點
    expect(SPEC_NUMBERS.sigmaW).toBeGreaterThan(sigmaW)
    expect(h.tips?.[1]).toContain(SPEC_NUMBERS.sigmaW.toPrecision(5))
    // σ_v 加倍：δ*(0) 加倍；偏差已經小於雜訊時不需要小數 bit
    close(values(h, { ...d, sigmaV: 200 })[1], 2 * d0, 1e-9, 0, 'δ* ∝ σ_v')
    const easy = h.solve({ sigmaV: 10, mu: 20, bx: 8, log2N: 8 })
    expect(easy.results[2].value).toBe(0)
    expect(easy.steps[easy.steps.length - 1].tex).toContain(String.raw`F_{G,\min}=0`)
    // validate：極性、穩定、自然 dither、F_G,min 太接近 log2N
    expect(h.validate?.({ ...d, mu: 0 })).toMatch(/不會更新/)
    expect(h.validate?.({ ...d, mu: -10 })).toMatch(/極性錯誤/)
    expect(h.validate?.({ ...d, mu: 300 })).toMatch(/不穩定/)
    expect(h.validate?.({ ...d, log2N: 16 })).toMatch(/自然 dither 不足/)
    expect(h.validate?.({ sigmaV: 1000, mu: 0.01, bx: 6, log2N: 8 })).toMatch(/剩下不到/)
    expect(HANDCALC_CONSTANTS.MIN_DITHER_LSB).toBe(0.4)
  }, 60_000)

  it('jsdom：每一題都能渲染（預設值與一組隨機值），沒有 KaTeX 錯誤、沒有殘留的 $；不合法輸入顯示原因；自己算算看可以對答案', () => {
    for (const h of HANDCALCS) {
      for (const v of [defaultValues(h), randomValues(h, 7)]) {
        const def: HandCalcDef = { ...h, inputs: h.inputs.map((i) => ({ ...i, default: v[i.key] })) }
        const { container, unmount } = render(<HandCalc def={def} />)
        expect(container.querySelector(`[id="handcalc-${h.id}"]`), h.id).toBeTruthy()
        expect(container.querySelectorAll('.c-step').length, h.id).toBe(h.solve(v).steps.length)
        expect(container.querySelector('.katex-error, .c-tex-error'), h.id).toBeNull()
        expect(container.textContent, h.id).not.toContain('ParseError')
        expect(plainText(container), h.id).not.toContain('$')
        unmount()
      }
    }
    // HC-MD.2 的 g 改成 0：顯示解釋原因的提示，而不是步驟
    const { container, unmount } = render(<HandCalc def={handcalc('HC-MD.2')} />)
    const inputs = container.querySelectorAll('.c-handcalc-input input')
    fireEvent.change(inputs[1], { target: { value: '0' } })
    expect(container.querySelector('.callout-warn')?.textContent).toContain('不是一顆 DTC')
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(plainText(container.querySelector('.callout-warn') as HTMLElement)).not.toContain('$')
    unmount()
    // 自己算算看：HC-MD.2 的五個答案，填對四個、填錯一個
    const p = render(<HandCalc def={handcalc('HC-MD.2')} initialMode="practice" />)
    expect(p.container.querySelectorAll('.c-step').length).toBe(0)
    const answers = p.container.querySelectorAll('.c-handcalc-answer input')
    expect(answers.length).toBe(5)
    ;['11', '3774.2', '10', '3520', '250'].forEach((val, i) => fireEvent.change(answers[i], { target: { value: val } }))
    fireEvent.click(Array.from(p.container.querySelectorAll('button')).find((b) => b.textContent === '對答案') as HTMLButtonElement)
    expect(p.container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(4)
    expect(p.container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(1) // Δτ 是 254.2，不是 250
  }, 120_000)
})

/** one-sided 白雜訊密度（dBc/Hz）的獨立重算：P_noise + 10·log₁₀(2/f_s) */
function v0NoiseDensity(noiseDbc: number, fs: number): number {
  return noiseDbc + 10 * Math.log10(2 / fs)
}
