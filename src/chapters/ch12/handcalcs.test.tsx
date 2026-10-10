import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, texNum } from '@/components'
import type { HandCalcDef } from '@/data/types'
import {
  P_MIN_3DB,
  SQRT_2_OVER_PI,
  bw3dbExact,
  bw3dbNegLnP,
  bw3dbOneMinusP,
  calLoop,
  codeSpectraAnalytic,
  dwStep,
  enbwOneSided,
  simulateMixing,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
  swOneSided,
} from '@/simulation/models/calNoise'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { decimalsAt, sigAtDecimals, sigFor, tx, txD, txDM, txIn, txM, txP } from './handcalcTex'

// 平常每個測試不到 1 秒；與其他測試平行跑、機器滿載時 KaTeX 渲染會慢好幾倍，所以把逾時放寬（不影響任何斷言）
vi.setConfig({ testTimeout: 60000 })

interface Vector {
  inputs: Record<string, number>
  expected: Record<string, number | number[]>
}
function golden(id: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as Vector
}

function hc(id: string): HandCalcDef {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`找不到 ${id}`)
  return d
}
/** 以預設值為底、覆寫部分輸入後求解，回傳各結果的數值 */
function values(id: string, over: Record<string, number> = {}): number[] {
  const d = hc(id)
  const v = { ...defaultValues(d), ...over }
  expect(d.validate?.(v) ?? null, `${id} ${JSON.stringify(over)}`).toBeNull()
  return d.solve(v).results.map((r) => r.value)
}
function reject(id: string, over: Record<string, number>): string {
  const d = hc(id)
  const msg = d.validate?.({ ...defaultValues(d), ...over }) ?? null
  expect(msg, `${id} 應拒絕 ${JSON.stringify(over)}`).not.toBeNull()
  return msg as string
}
function accept(id: string, over: Record<string, number>): void {
  const d = hc(id)
  expect(d.validate?.({ ...defaultValues(d), ...over }) ?? null, `${id} 應接受 ${JSON.stringify(over)}`).toBeNull()
}
/** |a − b| ≤ abs + rel·|b| */
function close(a: number, b: number, rel = 1e-9, abs = 1e-12): boolean {
  return Math.abs(a - b) <= abs + rel * Math.abs(b)
}
/** 字串中的 $...$ 片段（與 mathText 相同的配對規則） */
function mathSegments(s: string): string[] {
  return Array.from(s.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)).map((m) => m[1])
}
function dollarsBalanced(s: string): boolean {
  return (s.match(/(?<!\\)\$/g) ?? []).length % 2 === 0
}

const T13 = golden('T13')
const T14 = golden('T14')
const T15 = golden('T15')
/** T13 / T14 標準例（勘誤 E30 的條件） */
const EX = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
/** 以 p 為輸入的題目的預設值（7 位） */
const P7 = 0.9202115

describe('第 12 章帶入手算：題庫結構', () => {
  it('HC-12.1 … HC-12.8 依序、ID 唯一、頁面 /ch/12；公式 ID 都在本章公式登錄內；三種難度都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-12.1', 'HC-12.2', 'HC-12.3', 'HC-12.4', 'HC-12.5', 'HC-12.6', 'HC-12.7', 'HC-12.8'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/12')
      if (h.formulaId) expect(formulaIds.has(h.formulaId), `${h.id}: ${h.formulaId}`).toBe(true)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThan(0)
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
  })

  it('輸入：預設值在 [min, max] 內、practice 的每個選項都合法，而且任何 practice 組合都通過 validate（不會抽到無效題）', () => {
    for (const h of HANDCALCS) {
      expect(new Set(h.inputs.map((i) => i.key)).size, h.id).toBe(h.inputs.length)
      for (const i of h.inputs) {
        expect(i.practice?.choices?.length ?? 0, `${h.id}.${i.key}`).toBeGreaterThan(1)
        for (const x of [i.default, ...(i.practice?.choices ?? [])]) {
          expect(x >= (i.min ?? -Infinity) && x <= (i.max ?? Infinity), `${h.id}.${i.key} = ${x}`).toBe(true)
          if (i.integer) expect(Number.isInteger(x), `${h.id}.${i.key} = ${x}`).toBe(true)
        }
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      // 窮舉 practice 的所有組合
      const combos = h.inputs.reduce<Record<string, number>[]>((acc, i) => acc.flatMap((v) => Array.from(new Set(i.practice?.choices ?? [i.default])).map((x) => ({ ...v, [i.key]: x }))), [{}])
      expect(combos.length, h.id).toBeGreaterThan(20)
      const bad = combos.filter((v) => (h.validate?.(v) ?? null) !== null)
      expect(bad, h.id).toEqual([])
    }
  })

  it('所有字串（標題、標籤、提示）的 $ 成對，裡面的 LaTeX 都能被 KaTeX 解析', () => {
    for (const h of HANDCALCS) {
      const strings = [h.title, ...(h.tips ?? []), ...h.inputs.map((i) => i.label)]
      for (const s of strings) {
        expect(dollarsBalanced(s), `${h.id}: ${s}`).toBe(true)
        for (const m of mathSegments(s)) expect(() => katex.renderToString(m, { throwOnError: true }), `${h.id}: ${m}`).not.toThrow()
      }
      expect(() => katex.renderToString(h.formulaTex, { throwOnError: true, displayMode: true }), h.id).not.toThrow()
      for (const i of h.inputs) {
        expect(() => katex.renderToString(i.symbol, { throwOnError: true }), `${h.id}.${i.key}`).not.toThrow()
        if (i.unit) expect(() => katex.renderToString(i.unit as string, { throwOnError: true }), `${h.id}.${i.key} unit`).not.toThrow()
      }
    }
  })
})

describe('(a) 預設值 = 本章 worked example：與模型函式、golden 向量、內文數字一致', () => {
  it('T13: HC-12.1 的 p = 0.92021（golden）；三步遞迴 = dwStep = 章首「先算一次」表格的前三列', () => {
    const [p, d1, d2, d3] = values('HC-12.1')
    expect(Math.abs(p - (T13.expected.p as number))).toBeLessThanOrEqual(1e-12)
    expect(p).toBe(EX.p)
    const kick = 10 / 64 // μσ_η = 10/√4096
    expect(d1).toBe(kick)
    expect(d2).toBe(dwStep(d1, EX.p, 10, -1 / 64))
    expect(d3).toBe(dwStep(d2, EX.p, 10, 1 / 64))
    // 與章首表格（S1Intro：ETA_PATTERN = +,−,+ …）印出的 5 位小數相同
    expect([d1, d2, d3].map((x) => x.toFixed(5))).toEqual(['0.15625', '-0.01247', '0.14478'])
    // dwStep 就是引擎 (a) linearStep 的式子 δw + μ(−Kδw + η) 把 p = 1 − μK 合併後的寫法
    for (const [dw, eta] of [
      [0, 1 / 64],
      [0.3, -1 / 64],
      [-1.7, 0.02],
    ]) {
      expect(close(dwStep(dw, EX.p, 10, eta), dw + 10 * (-EX.K * dw + eta), 1e-13, 1e-15)).toBe(true)
    }
    // 步驟裡顯示的中間值
    const sol = hc('HC-12.1').solve(defaultValues(hc('HC-12.1')))
    expect(sol.steps.length).toBe(9)
    expect(sol.steps[0].tex).toContain('0.797885')
    expect(sol.steps[3].tex).toContain('0.92021')
    expect(sol.steps[4].tex).toContain(String.raw`\frac{1}{64}`)
    // p 顯示到和 g 相同的小數位（1 − 0.0797885 = 0.9202115），也就是 HC-12.2 / 12.4 / 12.5 預設輸入的那個 p
    expect(sol.steps[3].tex).toBe('p=1-g=1-0.0797885=0.9202115')
    expect(sol.results[0].digits).toBe(7)
    expect(hc('HC-12.2').inputs.find((i) => i.key === 'p')?.default).toBe(0.9202115)
    // 第 8、9 步把乘積 p·δw_k（章首表格的第三欄）單獨列出，再做加減：一個等號只做一種運算；
    // 第 8 步是相近的數相減，乘積多顯示一位（7 位），畫面上的數字相減才得到 −0.0124669
    expect((EX.p * d1).toFixed(5)).toBe('0.14378')
    expect(sol.steps[7].tex).toContain(String.raw`=0.9202115\times0.15625-0.15625=0.1437831-0.15625=-0.0124669\ \mathrm{fs}`)
    expect(sol.steps[8].tex).toContain(`=${texNum(EX.p * d2, 6)}+${texNum(kick, 6)}=${texNum(d3)}`)
    expect(0.1437831 - 0.15625).toBeCloseTo(d2, 7)
    // 極性（E33）：補充說明給出 §0 約定 δ = a − w 下的三個值（全部變號）
    const polarity = (sol.notes ?? []).find((n) => n.includes('E33')) ?? ''
    expect(polarity).toContain(String.raw`\delta_k=a-w_k`)
    for (const d of [d1, d2, d3]) expect(polarity).toContain(`=${texNum(-d)}$`)
  })

  it('T13: HC-12.3 的 σ_w = 0.3991861 fs（golden，1e-12）、τ = 12.03 blocks = 12.31 μs（= calLoop）', () => {
    const [p, sw, tau, tauUs] = values('HC-12.3')
    expect(Math.abs(p - (T13.expected.p as number))).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(sw - (T13.expected.sigma_w_fs as number))).toBeLessThanOrEqual(1e-12)
    expect(sw).toBeCloseTo(0.3992, 4)
    expect(tau).toBe(EX.tauBlocks)
    expect(tauUs).toBe(EX.tauSeconds * 1e6)
    expect(tau.toFixed(2)).toBe('12.03')
    expect(tauUs.toFixed(2)).toBe('12.31')
    // §12.4 取捨表的每一列（μ = 2.5 … 40 fs）都能重現
    for (const mu of [2.5, 5, 10, 20, 40]) {
      const lp = calLoop({ N: 4096, fs: 4e9, mu, sigmaV: 100, C: 1 })
      expect(values('HC-12.3', { mu })).toEqual([lp.p, lp.sigmaW, lp.tauBlocks, lp.tauSeconds * 1e6])
    }
    // 思考題 2：N × 4 ⇒ σ_w 減半、τ（秒）× 4；入門課第 4 課：N = 10000 ⇒ 0.255 fs
    const n4 = values('HC-12.3', { N: 16384 })
    expect(n4[1] / sw).toBeCloseTo(0.5, 12)
    expect(n4[3] / tauUs).toBeCloseTo(4, 12)
    expect(values('HC-12.3', { N: 10000 })[1].toFixed(3)).toBe('0.255')
  })

  it('T14: HC-12.4 代入 golden 的 p：(1 − p) 12.40、−ln p 12.92、exact 12.93 kHz（rel 1e-10）；預設 p（7 位）與內文同到 4 位有效數字', () => {
    const [f1, f2, f3] = values('HC-12.4', { p: T14.inputs.p })
    expect(close(f1 * 1e3, T14.expected.bw_one_minus_p_hz as number, 1e-10, 0)).toBe(true)
    expect(close(f2 * 1e3, T14.expected.bw_neg_ln_p_hz as number, 1e-10, 0)).toBe(true)
    expect(close(f3 * 1e3, T14.expected.bw_exact_3db_hz as number, 1e-10, 0)).toBe(true)
    const d = values('HC-12.4')
    expect(d).toEqual([bw3dbOneMinusP(P7, EX.fu) / 1e3, bw3dbNegLnP(P7, EX.fu) / 1e3, bw3dbExact(P7, EX.fu) / 1e3])
    expect(d.map((x) => x.toFixed(2))).toEqual(['12.40', '12.92', '12.93'])
    expect(d.map((x) => x.toFixed(3))).toEqual([f1, f2, f3].map((x) => x.toFixed(3)))
    // f_u = 976.5625 kHz 出現在第一步
    expect(hc('HC-12.4').solve(defaultValues(hc('HC-12.4'))).steps[0].tex).toContain('976.5625')
  })

  it('T14: HC-12.5 的 ENBW = 20.29 kHz（golden）、S_w^(1)(0) = πσ_v²/f_s = calLoop().sw1Dc、√(S·ENBW) = σ_w = 0.3992 fs', () => {
    const [enbw, s0, sw] = values('HC-12.5', { p: T14.inputs.p })
    expect(close(enbw * 1e3, T14.expected.enbw_one_sided_hz as number, 1e-10, 0)).toBe(true)
    expect(close(s0, EX.sw1Dc, 1e-12, 0)).toBe(true)
    expect(close(s0, (Math.PI * 100 ** 2) / 4e9, 1e-12, 0)).toBe(true)
    expect(close(sw, T13.expected.sigma_w_fs as number, 1e-12, 0)).toBe(true)
    const d = values('HC-12.5')
    expect(d[0]).toBe(enbwOneSided(P7, EX.fu) / 1e3)
    expect(d[0].toFixed(2)).toBe('20.29')
    expect(d[2]).toBeCloseTo(0.3992, 4)
    // 反面例子（E06）：誤用 f_3dB 的數字 0.3187 fs 出現在補充說明
    const notes = hc('HC-12.5').solve(defaultValues(hc('HC-12.5'))).notes ?? []
    expect(notes.join('\n')).toContain('0.31869')
  })

  it('T14: HC-12.2 在 exact f_3dB 處得到 −3.0103 dB、S_w^(1)(f) = ½·S_w^(1)(0)；預設值 = swOneSided()', () => {
    const f3 = bw3dbExact(EX.p, EX.fu)
    const [omega, den, dB, s1] = values('HC-12.2', { p: EX.p, f: f3 / 1e3 })
    expect(omega).toBeCloseTo((2 * Math.PI * f3) / EX.fu, 14)
    expect(den).toBeCloseTo(2 * (1 - EX.p) ** 2, 14)
    expect(dB).toBeCloseTo(10 * Math.log10(0.5), 9)
    expect(close(s1, EX.sw1Dc / 2, 1e-10, 0)).toBe(true)
    const d = values('HC-12.2')
    expect(close(d[3], swOneSided(12931, 10, P7, 1 / 4096, EX.fu), 1e-12, 0)).toBe(true)
    expect(d[2]).toBeCloseTo(-3.01, 2)
    // DC：Ω = 0、0 dB、S = S_w^(1)(0)
    const dc = values('HC-12.2', { p: EX.p, f: 0 })
    expect(dc[0]).toBe(0)
    expect(dc[2]).toBeCloseTo(0, 12)
    expect(close(dc[3], EX.sw1Dc, 1e-12, 0)).toBe(true)
  })

  it('T15: HC-12.6 的兩根 tone 在 90 / 110 kHz、各 0.5 fs（golden）；數值來自 simulateMixing 的時域乘積', () => {
    const [fSum, fDiff, amp, dc] = values('HC-12.6')
    const freqs = (T15.expected.mixing_tone_freqs_hz as number[]).map((f) => f / 1e3)
    expect([fDiff, fSum]).toEqual(freqs)
    expect(amp).toBeCloseTo((T15.expected.mixing_tone_peak_s as number[])[0] * 1e15, 12)
    expect(amp).toBe(0.5)
    expect(dc).toBe(0)
    // 與 Code Mixing Lab 的 T15 preset（f_sim = 4.096 MHz、L = 4096）同一次模擬
    const r = simulateMixing({ fsim: 4.096e6, L: 4096, fx: 1e5, A: 1, m: 0, codeWhite: 0, fw: 1e4, B: 1, holdN: 1, dwNoiseSigma: 0, dwNoiseP: 0, fOut: 13e9, Tmag: 1, window: 'rectangular', seed: 1 })
    expect(r.tones.map((t) => t.f / 1e3).sort((a, b) => a - b)).toEqual([fDiff, fSum])
    for (const t of r.tones) {
      expect(t.predFs).toBe(amp)
      expect(Math.abs(t.measFs - amp)).toBeLessThan(1e-9)
    }
    // code 有 DC（Case B）：f_w 處多一根 mB
    expect(values('HC-12.6', { m: 0.5 })).toEqual([110, 90, 0.5, 0.5])
    // f_x < f_w：差頻落在 f_w − f_x，不會消失
    expect(values('HC-12.6', { fx: 10, fw: 100 }).slice(0, 3)).toEqual([110, 90, 0.5])
  })

  it('T15: HC-12.7 的 β = 4.0841e−5 rad、spur = −93.80 dBc（golden）；A_t 加倍 +6.02 dB、|T| = 0.1 −20 dB', () => {
    const [beta, dbc] = values('HC-12.7')
    expect(close(beta, T15.expected.beta_rad as number, 1e-12, 0)).toBe(true)
    expect(Math.abs(dbc - (T15.expected.spur_dbc as number))).toBeLessThanOrEqual(1e-9)
    expect(beta).toBe(spurBeta(13e9, 0.5, 1))
    expect(dbc).toBe(spurDbcSmallAngle(beta))
    expect(dbc.toFixed(1)).toBe('-93.8')
    expect(values('HC-12.7', { at: 1 })[1] - dbc).toBeCloseTo(20 * Math.log10(2), 10)
    expect(values('HC-12.7', { tMag: 0.1 })[1] - dbc).toBeCloseTo(-20, 10)
    // 思考題 4 的答案（A_t = 1 fs）
    expect(values('HC-12.7', { at: 1 })[1].toFixed(2)).toBe('-87.78')
    // 補充說明的 Bessel 精確值與 golden 一致；提示宣稱的「β ≤ 0.3 時差不到 0.1 dB」成立
    expect(Math.abs(spurDbcBessel(beta) - (T15.expected.spur_dbc_bessel as number))).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(spurDbcSmallAngle(0.3) - spurDbcBessel(0.3))).toBeLessThan(0.1)
    expect(Math.abs(spurDbcSmallAngle(0.31) - spurDbcBessel(0.31))).toBeGreaterThan(0.1)
  })

  it('T13: HC-12.8 的三個數 0.399 / 0.282 / 0.00893 fs = codeSpectraAnalytic 的總 RMS 與白色 code 的 in-band RMS', () => {
    const [cst, tone, white] = values('HC-12.8')
    expect(Math.abs(cst - (T13.expected.sigma_w_fs as number))).toBeLessThanOrEqual(1e-12)
    expect([cst, tone, white].map((x) => Number(x.toPrecision(3)))).toEqual([0.399, 0.282, 0.00893])
    const an = codeSpectraAnalytic({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1, fx: 1e5, toneA: 1, fBw: 1e6, pll: { f3dbT: 1e6, zeta: 0.707 }, fL: 1e3, fH: 1e8 })
    const row = (kind: string) => an.rows.find((r) => r.kind === kind)!
    expect(close(cst, row('const').totalRms, 1e-12, 0)).toBe(true)
    expect(close(tone, row('tone').totalRms, 1e-12, 0)).toBe(true)
    expect(close(white, row('white').inbandRms, 1e-6, 0)).toBe(true)
    // 補充說明引用的表格數字（含 ZOH 修正）就是模型的 in-band 值
    expect(an.rows.map((r) => Number(r.inbandRms.toPrecision(3)))).toEqual([0.398, 0.281, 0.00893])
    expect((hc('HC-12.8').solve(defaultValues(hc('HC-12.8'))).notes ?? []).join('\n')).toContain('0.398 / 0.281')
  })
})

/** (b) 用的獨立重算：直接照公式寫，不經過 handcalcs.ts 也不呼叫 calNoise.ts */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-12.1': ({ sigmaV, C, mu, N }) => {
    const p = 1 - mu * ((Math.sqrt(2 / Math.PI) / sigmaV) * C)
    const kick = mu / Math.sqrt(N)
    const d1 = kick
    const d2 = p * d1 - kick
    const d3 = p * d2 + kick
    return [p, d1, d2, d3]
  },
  'HC-12.2': ({ p, mu, N, fs, f }) => {
    const fu = (fs * 1e9) / N
    const om = (2 * Math.PI * f * 1e3) / fu
    const den = (Math.cos(om) - p) ** 2 + Math.sin(om) ** 2
    return [om, den, 10 * Math.log10((1 - p) ** 2 / den), ((2 / fu) * (mu * mu)) / N / den]
  },
  'HC-12.3': ({ mu, sigmaV, N, fs }) => {
    const p = 1 - (mu * Math.sqrt(2 / Math.PI)) / sigmaV
    const tau = -1 / Math.log(Math.abs(p))
    return [p, mu / Math.sqrt(N * (1 - p * p)), tau, (tau / ((fs * 1e9) / N)) * 1e6]
  },
  'HC-12.4': ({ p, fs, N }) => {
    const k = (fs * 1e9) / N / (2 * Math.PI) / 1e3
    // exact 用 arccos 的等價寫法（handcalcs / 模型用的是 arcsin）
    return [(1 - p) * k, -Math.log(p) * k, Math.acos(1 - (1 - p) ** 2 / (2 * p)) * k]
  },
  'HC-12.5': ({ p, fs, N, sigmaV }) => {
    const enbwHz = (((fs * 1e9) / N / 2) * (1 - p)) / (1 + p)
    const s0 = (Math.PI * sigmaV * sigmaV) / (fs * 1e9)
    return [enbwHz / 1e3, s0, Math.sqrt(s0 * enbwHz)]
  },
  'HC-12.6': ({ A, B, fx, fw, m }) => [fx + fw, Math.abs(fx - fw), (A * B) / 2, Math.abs(m) * B],
  'HC-12.7': ({ fOut, at, tMag }) => {
    const x = fOut * 1e9 * tMag * at * 1e-15
    return [2 * Math.PI * x, 20 * Math.log10(Math.PI * x)]
  },
  'HC-12.8': ({ mu, sigmaV, N, fs, A, fBw }) => {
    const p = 1 - (mu * Math.sqrt(2 / Math.PI)) / sigmaV
    const sw = mu / Math.sqrt(N * (1 - p * p))
    return [sw, (A / Math.SQRT2) * sw, sw * Math.sqrt((2 * fBw * 1e6) / (fs * 1e9))]
  },
}

describe('(b) 換一題：20 個 seed 的隨機題目都有有限解，且等於測試內獨立重算的結果', () => {
  for (const h of HANDCALCS) {
    it(`${h.id}：randomValues(def, 1…20)`, () => {
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(h, seed)
        expect(randomValues(h, seed)).toEqual(v) // 同 seed 可重現
        seen.add(JSON.stringify(v))
        expect(h.validate?.(v) ?? null, `${h.id} seed ${seed}`).toBeNull()
        const sol = h.solve(v)
        const want = INDEPENDENT[h.id](v)
        expect(sol.results.length).toBe(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${h.id} seed ${seed} ${r.symbol}`).toBe(true)
          expect(close(r.value, want[i], 1e-9, 1e-12), `${h.id} seed ${seed} ${JSON.stringify(v)} ${r.symbol}: ${r.value} vs ${want[i]}`).toBe(true)
          // 正確答案一定被自己的容許誤差接受；差 10% 的答案一定被拒絕
          expect(checkAnswer(r.value, r).ok).toBe(true)
          if (Math.abs(r.value) * 0.1 > (r.tolerance?.abs ?? 1e-9)) expect(checkAnswer(r.value * 1.1, r).ok, `${h.id} ${r.symbol}`).toBe(false)
        })
        // 每一步的 TeX、理由與補充說明都能渲染
        expect(sol.steps.length).toBeGreaterThan(0)
        for (const s of sol.steps) {
          expect(() => katex.renderToString(s.tex, { throwOnError: true, displayMode: true }), `${h.id} seed ${seed}: ${s.tex}`).not.toThrow()
          expect(s.tex).not.toMatch(/NaN|undefined|Infinity/)
          expect(dollarsBalanced(s.why), s.why).toBe(true)
          for (const m of mathSegments(s.why)) expect(() => katex.renderToString(m, { throwOnError: true }), `${h.id}: ${m}`).not.toThrow()
        }
        for (const n of sol.notes ?? []) {
          expect(dollarsBalanced(n), n).toBe(true)
          expect(n).not.toMatch(/NaN|undefined/)
          for (const m of mathSegments(n)) expect(() => katex.renderToString(m, { throwOnError: true }), `${h.id}: ${m}`).not.toThrow()
        }
      }
      expect(seen.size, `${h.id}：隨機題目應該有變化`).toBeGreaterThan(5)
    })
  }

  it('以預設值求解的結果也等於獨立重算（rel 1e-9）', () => {
    for (const h of HANDCALCS) {
      const v = defaultValues(h)
      const got = h.solve(v).results.map((r) => r.value)
      const want = INDEPENDENT[h.id](v)
      got.forEach((g, i) => expect(close(g, want[i], 1e-9, 1e-12), `${h.id}[${i}]: ${g} vs ${want[i]}`).toBe(true))
    }
  })
})

describe('(c) validate：模型不適用的輸入會被擋下，訊息說明原因（含可渲染的 $...$）', () => {
  const expectRenderable = (msg: string) => {
    expect(dollarsBalanced(msg), msg).toBe(true)
    expect(mathSegments(msg).length, msg).toBeGreaterThan(0)
    for (const m of mathSegments(msg)) expect(() => katex.renderToString(m, { throwOnError: true }), m).not.toThrow()
    expect(msg).not.toMatch(/NaN|undefined/)
  }

  it('HC-12.1 / HC-12.3 / HC-12.8：σ_v = 0（K_q 無定義）、μ ≤ 0、g ≥ 2（不穩定）——訊息就是 calLoop() 的警告', () => {
    for (const id of ['HC-12.1', 'HC-12.3', 'HC-12.8']) {
      const zero = reject(id, { sigmaV: 0 })
      expect(zero).toContain('無定義')
      expect(zero).toBe(calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 0, C: 1 }).warnings[0])
      const big = reject(id, { mu: 260 }) // g = 260 × 0.0079788 = 2.07
      expect(big).toContain('g ≥ 2')
      expect(big).toBe(calLoop({ N: 4096, fs: 4e9, mu: 260, sigmaV: 100, C: 1 }).warnings[0])
      expect(reject(id, { mu: 0 })).toContain('learning rate 必須為正')
      expect(reject(id, { mu: -5 })).toContain('learning rate 必須為正')
      for (const m of [zero, big]) expectRenderable(m)
      accept(id, { mu: 150 }) // g = 1.197 ⇒ p = −0.197（high-pass，但 |p| < 1：σ_w 仍存在）
    }
  })

  it('HC-12.1：C ≤ 0（極性錯誤）', () => {
    for (const C of [0, -1]) {
      const msg = reject('HC-12.1', { C })
      expect(msg).toContain('極性錯誤')
      expectRenderable(msg)
    }
    accept('HC-12.1', { C: 0.5 })
  })

  it('HC-12.3：p = 0（flat）時 ln 0 無定義', () => {
    const flat = { sigmaV: SQRT_2_OVER_PI * 100, mu: 100 }
    expect(calLoop({ N: 4096, fs: 4e9, C: 1, ...flat }).regime).toBe('flat')
    const msg = reject('HC-12.3', flat)
    expect(msg).toContain(String.raw`\ln 0`)
    expectRenderable(msg)
  })

  it('HC-12.2：|p| ≥ 1、μ ≤ 0、f 超過 block rate 的 Nyquist f_u/2（E29）', () => {
    for (const p of [1, -1, 1.2]) expectRenderable(reject('HC-12.2', { p }))
    expectRenderable(reject('HC-12.2', { mu: 0 }))
    const msg = reject('HC-12.2', { f: 500 }) // f_u/2 = 488.28 kHz
    expect(msg).toContain('Nyquist')
    expect(msg).toContain('488.28')
    expectRenderable(msg)
    accept('HC-12.2', { f: 488 })
    accept('HC-12.2', { p: -0.3 })
  })

  it('HC-12.4：−3 dB 點不存在的區域（E27）：0 < p < 3 − 2√2、p = 0、p < 0、|p| ≥ 1', () => {
    const no3db = reject('HC-12.4', { p: 0.1 })
    expect(no3db).toContain('沒有解')
    expect(no3db).toContain('E27')
    expectRenderable(no3db)
    expectRenderable(reject('HC-12.4', { p: 0.17 }))
    accept('HC-12.4', { p: 0.172 })
    expect(P_MIN_3DB).toBeGreaterThan(0.17)
    expect(P_MIN_3DB).toBeLessThan(0.172)
    expect(reject('HC-12.4', { p: 0 })).toContain('Flat')
    expect(reject('HC-12.4', { p: -0.3 })).toContain('High-pass')
    for (const p of [1, 1.5, -1]) expect(reject('HC-12.4', { p })).toContain('不穩定')
    // 反面：近似公式在 p = 0.1 仍會算出數字，但 exact 解不存在
    expect(Number.isFinite(bw3dbOneMinusP(0.1, EX.fu))).toBe(true)
    expect(Number.isNaN(bw3dbExact(0.1, EX.fu))).toBe(true)
  })

  it('HC-12.5：|p| ≥ 1（ENBW 不存在）、σ_v = 0', () => {
    for (const p of [1, -1, 1.3]) expectRenderable(reject('HC-12.5', { p }))
    expectRenderable(reject('HC-12.5', { sigmaV: 0 }))
    accept('HC-12.5', { p: -0.3 })
  })

  it('HC-12.6：沒有混頻或產物重疊的特例（A / B = 0、f_w = 0、f_x = 0、f_x = f_w、f_x = 2f_w 且 m ≠ 0）', () => {
    const special: Record<string, number>[] = [{ A: 0 }, { B: 0 }, { fw: 0 }, { fx: 0 }, { fx: 10, fw: 10 }, { fx: 20, fw: 10, m: 0.5 }]
    for (const over of special) expectRenderable(reject('HC-12.6', over))
    accept('HC-12.6', { fx: 20, fw: 10, m: 0 })
    accept('HC-12.6', { fx: 10, fw: 100 })
    // 模型在這些特例確實不是「兩根 AB/2」：f_x = 2f_w、m ≠ 0 時 f_w 處是相量和 AB/2 + mB
    const r = simulateMixing({ fsim: 4.096e6, L: 4096, fx: 2e4, A: 1, m: 0.5, codeWhite: 0, fw: 1e4, B: 1, holdN: 1, dwNoiseSigma: 0, dwNoiseP: 0, fOut: 13e9, Tmag: 1, window: 'rectangular', seed: 1 })
    expect(r.tones.length).toBe(2)
    expect(r.tones.find((t) => Math.abs(t.f - 1e4) < 1)?.predFs).toBeCloseTo(1, 12)
  })

  it('HC-12.7：沒有 tone（A_t、|T|、f_out 為 0）與 β > 0.3（不是小角）', () => {
    const noTone: Record<string, number>[] = [{ at: 0 }, { tMag: 0 }, { fOut: 0 }]
    for (const over of noTone) expectRenderable(reject('HC-12.7', over))
    const msg = reject('HC-12.7', { at: 5000 }) // β = 0.408 rad
    expect(msg).toContain('不是小角')
    expect(msg).toContain('Bessel')
    expectRenderable(msg)
    accept('HC-12.7', { at: 3000 }) // β = 0.245 rad
  })

  it('HC-12.8：f_BW = 0 與 f_BW 超過 Nyquist f_s/2', () => {
    expectRenderable(reject('HC-12.8', { fBw: 0 }))
    const msg = reject('HC-12.8', { fBw: 3000 }) // f_s/2 = 2000 MHz
    expect(msg).toContain('Nyquist')
    expectRenderable(msg)
    accept('HC-12.8', { fBw: 2000 })
  })
})

describe('(d) 渲染：每一題的 <HandCalc> 都沒有 KaTeX 錯誤，KaTeX 以外不殘留純文字公式', () => {
  /** 與 ch12.test.tsx 的教學規範檢查相同的規則：.katex 以外不得有下標 / 上標 / 希臘字母 / 未渲染的 $ */
  const plainMath = (root: HTMLElement): string[] => {
    const out: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('.katex, code, pre, option, script, style, svg, .c-tip, .c-tip-item')) continue
      const t = (n.textContent ?? '').replace(/μs/g, '')
      if (/(?<![A-Z_])[A-Za-z]_[a-z0-9{(]|\^|[σμηδτβθΩℒφΦ√∫Σπ≈∝ρ]|\$/.test(t)) out.push(t.trim().slice(0, 80))
    }
    return out
  }

  for (const h of HANDCALCS) {
    it(`${h.id}：看帶入過程`, () => {
      const sol = h.solve(defaultValues(h))
      const { container, unmount } = render(<HandCalc def={h} />)
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(sol.steps.length).toBeGreaterThanOrEqual(4)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(document.getElementById(`handcalc-${h.id}`)).toBeTruthy()
      // 每一步的理由、補充說明、提示都經過 mathText：含公式的地方有 .katex，沒有殘留的 $ 或 Unicode 公式
      expect(container.querySelectorAll('.c-step-why .katex').length).toBeGreaterThan(0)
      expect(container.querySelectorAll('.c-handcalc-tips li').length).toBe(h.tips?.length ?? 0)
      expect(plainMath(container)).toEqual([])
      unmount()
    })
  }

  it('自己算算看：填入正確答案全部判定正確；看詳解後才出現步驟', () => {
    const h = hc('HC-12.7')
    const sol = h.solve(defaultValues(h))
    const { container } = render(<HandCalc def={h} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const inputs = screen.getAllByPlaceholderText('你的答案')
    expect(inputs.length).toBe(sol.results.length)
    fireEvent.change(inputs[0], { target: { value: '4.084e-5' } })
    fireEvent.change(inputs[1], { target: { value: '-93.8' } })
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(2)
    fireEvent.change(inputs[1], { target: { value: '-90.8' } }) // 差 3 dB（把 20log 寫成 10log 之類的錯）要被抓到
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(1)
    fireEvent.click(screen.getByText('看詳解'))
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  })

  it('輸入超出模型適用範圍：不顯示步驟，改顯示原因（公式已渲染）；改回合法值後恢復', () => {
    const { container } = render(<HandCalc def={hc('HC-12.4')} />)
    const p = screen.getByLabelText(/pole/) as HTMLInputElement
    fireEvent.change(p, { target: { value: '0.1' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const warn = container.querySelector('.callout-warn') as HTMLElement
    expect(warn.textContent).toContain('沒有解')
    expect(warn.querySelectorAll('.katex').length).toBeGreaterThan(1)
    expect(warn.querySelectorAll('.katex-error').length).toBe(0)
    expect(plainMath(warn)).toEqual([])
    fireEvent.change(p, { target: { value: '0.5' } })
    expect(container.querySelectorAll('.c-step').length).toBe(10)
    // p = 0.5：exact = 112.33 kHz，(1 − p) 版 77.712 kHz（低估約三成，與內文的邀請句一致）
    const exact = bw3dbExact(0.5, EX.fu) / 1e3
    const approx = bw3dbOneMinusP(0.5, EX.fu) / 1e3
    expect(container.textContent).toContain(String(Number(exact.toPrecision(5))))
    expect(approx / exact - 1).toBeLessThan(-0.3)
    expect(approx / exact - 1).toBeGreaterThan(-0.32)
  })

  it('換一題：按鈕會換成 practice 範圍內的數字並切到「自己算算看」', () => {
    const h = hc('HC-12.6')
    const { container } = render(<HandCalc def={h} />)
    fireEvent.click(screen.getByText('換一題（隨機數字）'))
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const shown = Object.fromEntries(h.inputs.map((i) => [i.key, Number((screen.getByLabelText(new RegExp(`（${i.key}）$`)) as HTMLInputElement).value)]))
    expect(shown).toEqual(randomValues(h, 2))
    fireEvent.click(screen.getByText('還原範例數字'))
    expect((screen.getByLabelText(/（fx）$/) as HTMLInputElement).value).toBe('100')
  })
})

/* ───────────── (e) 測試用的小型 TeX 計算機：把每一步「純數字」的片段重新求值 ───────────── */

/** 片段裡還有符號（σ_v、p、\Omega…）⇒ 不是「代入數字」的片段 */
class Symbolic extends Error {}

const UNIT_RE = /\\ (?:\\mu)?(?:\\mathrm\{[^}]*\}(?:\^\{-1\}|\^2)?|\\mathrm s|\\text\{[^}]*\})/g
const stripUnits = (s: string): string => s.replace(UNIT_RE, '')

/** 以最外層的等號切開一步的 TeX（{…} 內的等號不算） */
function splitTop(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

interface Tok {
  k: 'num' | 'cmd' | 'sym' | 'op'
  v: string
}
const SPACING = new Set(['\\,', '\\!', '\\;', '\\ ', '\\quad', '\\qquad', '\\big', '\\Big'])
const FUNCS: Record<string, (x: number) => number> = { '\\cos': Math.cos, '\\sin': Math.sin, '\\ln': Math.log, '\\arcsin': Math.asin }
const KNOWN = new Set([...Object.keys(FUNCS), '\\pi', '\\frac', '\\sqrt', '\\log', '\\times', '\\cdot'])

function tokenize(src: string): Tok[] {
  const re = /\s*(?:(\d+\.\d+|\d+)|(\\[A-Za-z]+|\\[,!; ])|([A-Za-z@:])|([-+^_{}()|/]))/y
  const out: Tok[] = []
  const s = src.trim()
  let pos = 0
  while (pos < s.length) {
    re.lastIndex = pos
    const m = re.exec(s)
    if (!m) throw new Error(`無法切分 TeX：「${s.slice(pos, pos + 20)}」（${src}）`)
    pos = re.lastIndex
    if (m[1] !== undefined) out.push({ k: 'num', v: m[1] })
    else if (m[2] !== undefined) {
      if (!SPACING.has(m[2])) out.push({ k: 'cmd', v: m[2] })
    } else if (m[3] !== undefined) out.push({ k: 'sym', v: m[3] })
    else out.push({ k: 'op', v: m[4] })
  }
  return out
}

/** 求值一個純數字的 TeX 片段（支援 + − × \frac \sqrt ^ | | π 與 cos / sin / ln / arcsin / log10）；含符號時丟 Symbolic。 */
function evalTex(seg: string): number {
  const toks = tokenize(stripUnits(seg))
  for (const t of toks) if (t.k === 'sym' || (t.k === 'cmd' && !KNOWN.has(t.v))) throw new Symbolic(t.v)
  let i = 0
  const fail = (): never => {
    throw new Error(`TeX 解析失敗：${seg}`)
  }
  const eat = (v?: string): Tok => {
    const t = toks[i++]
    if (!t || (v !== undefined && t.v !== v)) fail()
    return t
  }
  const group = (): number => {
    eat('{')
    const v = expr()
    eat('}')
    return v
  }
  const paren = (): number => {
    eat('(')
    const v = expr()
    eat(')')
    return v
  }
  const atom = (): number => {
    const t = eat()
    if (t.k === 'num') return Number(t.v)
    if (t.v === '(') {
      i--
      return paren()
    }
    if (t.v === '{') {
      i--
      return group()
    }
    if (t.v === '|') {
      const v = expr()
      eat('|')
      return Math.abs(v)
    }
    if (t.v === '-') return -power()
    if (t.v === '\\pi') return Math.PI
    if (t.v === '\\frac') {
      const a = group()
      return a / group()
    }
    if (t.v === '\\sqrt') return Math.sqrt(group())
    if (t.v in FUNCS) return FUNCS[t.v](paren())
    if (t.v === '\\log') {
      eat('_')
      if (group() !== 10) fail()
      return Math.log10(paren())
    }
    return fail()
  }
  const power = (): number => {
    const b = atom()
    if (toks[i]?.v !== '^') return b
    i++
    return b ** (toks[i]?.v === '{' ? group() : Number(eat().v))
  }
  const term = (): number => {
    let v = power()
    for (;;) {
      const t = toks[i]
      if (t && (t.v === '\\times' || t.v === '\\cdot')) {
        i++
        v *= power()
      } else if (t && t.k === 'cmd' && (t.v === '\\pi' || t.v === '\\log' || t.v in FUNCS)) v *= power() // 隱含乘法：2\pi、2\arcsin(…)、10\log_{10}(…)
      else return v
    }
  }
  function expr(): number {
    let v = term()
    for (;;) {
      const t = toks[i]
      if (t && (t.v === '+' || t.v === '-')) {
        i++
        const r = term()
        v = t.v === '+' ? v + r : v - r
      } else return v
    }
  }
  const v = expr()
  if (i !== toks.length) fail()
  return v
}

/** 片段若只是一個數字（可含 a\times10^{b}、括號、單位），回傳它的值與「最後一位」的大小 */
function literal(seg: string): { value: number; ulp: number } | null {
  const s = stripUnits(seg)
    .replace(/\\[,!; ]/g, '')
    .trim()
    .replace(/^\((.*)\)$/, '$1')
  const m = /^(-?)(\d+(?:\.(\d+))?)?(?:\\times)?(?:10\^\{(-?\d+)\})?$/.exec(s)
  if (!m || (m[2] === undefined && m[4] === undefined)) return null
  const exp = m[4] !== undefined ? Number(m[4]) : 0
  const mant = m[2] !== undefined ? Number(m[2]) : 1
  return { value: (m[1] ? -1 : 1) * mant * 10 ** exp, ulp: 10 ** (exp - (m[3]?.length ?? 0)) }
}

const UNIT_SCALE: Record<string, number> = { GHz: 1e9, MHz: 1e6, kHz: 1e3, Hz: 1, fs: 1e-15 }
/** 片段結尾的單位換成基本單位（Hz、s）的倍數；只用來核對「976562.5 Hz = 976.5625 kHz」這種純換算 */
function unitScale(seg: string): { family: 'freq' | 'time'; scale: number } | null {
  const t = seg.trim()
  if (/\\ \\mu\\mathrm s$/.test(t)) return { family: 'time', scale: 1e-6 }
  if (/\\ \\mathrm s$/.test(t)) return { family: 'time', scale: 1 }
  const m = /\\ \\mathrm\{(GHz|MHz|kHz|Hz|fs)\}$/.exec(t)
  return m ? { family: m[1] === 'fs' ? 'time' : 'freq', scale: UNIT_SCALE[m[1]] } : null
}

/** 一步裡的純數字片段：[片段, 各分量的值]（複數「a+j\,b」拆成實部、虛部兩個分量） */
function numericSegments(stepTex: string): { seg: string; parts: { seg: string; value: number }[] }[] {
  let tex = stepTex
  if (tex.includes('\\quad @')) tex = tex.split('\\quad @')[0] // 「… @ f_w = 10 kHz」的註記
  if (tex.includes(':\\quad')) tex = tex.split(':\\quad').slice(1).join(':\\quad') // 「x\equiv1:」的前綴
  const out: { seg: string; parts: { seg: string; value: number }[] }[] = []
  for (const seg of splitTop(tex)) {
    const pieces = seg.includes('+j\\,') ? seg.split('+j\\,') : [seg]
    try {
      out.push({ seg, parts: pieces.map((p) => ({ seg: p, value: evalTex(p) })) })
    } catch (e) {
      if (!(e instanceof Symbolic)) throw e
    }
  }
  return out
}

/**
 * 「畫面上的數字自己算得出下一個等號」：相鄰兩個純數字片段的差，以右邊那個數的
 * max(顯示的最後一位, 第 5 位有效數字) 為單位。≤ 1 表示照著畫面按計算機，前 4–5 位一定對得上。
 */
function worstMismatch(stepTex: string): { units: number; where: string } {
  const segs = numericSegments(stepTex)
  let worst = { units: 0, where: '' }
  for (let k = 1; k < segs.length; k++) {
    const a = segs[k - 1]
    const b = segs[k]
    if (a.parts.length !== b.parts.length) return { units: Infinity, where: `${a.seg} → ${b.seg}` }
    for (let c = 0; c < b.parts.length; c++) {
      const litB = literal(b.parts[c].seg)
      const litA = literal(a.parts[c].seg)
      let lhs = a.parts[c].value
      const rhs = b.parts[c].value
      const ua = unitScale(a.parts[c].seg)
      const ub = unitScale(b.parts[c].seg)
      if (litA && litB && ua && ub && ua.family === ub.family) lhs *= ua.scale / ub.scale
      const fifth = rhs !== 0 ? 10 ** (Math.floor(Math.log10(Math.abs(rhs))) - 4) : 0
      const unit = Math.max(litB?.ulp ?? 0, fifth) || Number.MIN_VALUE
      const units = Math.abs(lhs - rhs) / unit
      if (units > worst.units) worst = { units, where: `${a.parts[c].seg.trim()} → ${b.parts[c].seg.trim()}` }
    }
  }
  return worst
}

/** practice 的所有組合（去掉重複的選項） */
function practiceCombos(h: HandCalcDef): Record<string, number>[] {
  return h.inputs.reduce<Record<string, number>[]>((acc, i) => acc.flatMap((v) => Array.from(new Set(i.practice?.choices ?? [i.default])).map((x) => ({ ...v, [i.key]: x }))), [{}])
}

/** 使用者會打的「不漂亮」數字（都在各題的適用範圍內）：相近的數相減、科學記號、p < 0、g > 1、非 2 的冪次的 N… */
const AWKWARD: Record<string, Record<string, number>[]> = {
  'HC-12.1': [
    { sigmaV: 137.5, C: 0.83, mu: 7.3, N: 1000 },
    { sigmaV: 250, C: 0.5, mu: 2, N: 16384 },
    { sigmaV: 50, C: 2, mu: 40, N: 64 },
    { sigmaV: 1000, C: 1, mu: 0.5, N: 100 },
    { sigmaV: 33.3, C: 1, mu: 61, N: 7 },
  ],
  'HC-12.2': [
    { p: 0.999, mu: 10, N: 4096, fs: 4, f: 0.2 },
    { p: -0.3, mu: 3.3, N: 1000, fs: 2.4, f: 777 },
    { p: 0.9202115, mu: 10, N: 4096, fs: 4, f: 0 },
    { p: 0.9202115, mu: 10, N: 4096, fs: 4, f: 488.28125 },
    { p: 0.9965, mu: 10, N: 4096, fs: 4, f: 12.931 },
    { p: 0.92021154392, mu: 12.5, N: 3000, fs: 3.3, f: 1.234 },
    { p: 0, mu: 10, N: 4096, fs: 4, f: 100 },
  ],
  'HC-12.3': [
    { mu: 7.3, sigmaV: 137.5, N: 1000, fs: 2.4 },
    { mu: 150, sigmaV: 100, N: 4096, fs: 4 },
    { mu: 0.5, sigmaV: 1000, N: 100, fs: 0.5 },
    { mu: 124, sigmaV: 100, N: 4096, fs: 4 },
  ],
  'HC-12.4': [
    { p: 0.172, fs: 4, N: 4096 },
    { p: 0.999, fs: 2.4, N: 1000 },
    { p: 0.33333, fs: 10, N: 12345 },
  ],
  'HC-12.5': [
    { p: -0.3, fs: 4, N: 4096, sigmaV: 100 },
    { p: 0.999, fs: 2.4, N: 1000, sigmaV: 137.5 },
    { p: 0.01, fs: 0.001, N: 3, sigmaV: 0.00001 },
  ],
  'HC-12.6': [
    { A: 1.5, B: 0.7, fx: 10, fw: 100, m: -0.25 },
    { A: 0.33, B: 12.5, fx: 1234.5, fw: 0.5, m: 0 },
  ],
  'HC-12.7': [
    { fOut: 2.4, at: 0.37, tMag: 0.82 },
    { fOut: 13, at: 3000, tMag: 1 },
    { fOut: 0.001, at: 0.01, tMag: 0.01 },
    { fOut: 77, at: 123.4, tMag: 1.2 },
  ],
  'HC-12.8': [
    { mu: 7.3, sigmaV: 137.5, N: 1000, fs: 2.4, A: 0.37, fBw: 0.123 },
    { mu: 150, sigmaV: 100, N: 4096, fs: 4, A: 3, fBw: 2000 },
  ],
}

describe('(e) 每一步都能照畫面上的數字重算：符號式 = 代入數字 = 結果', () => {
  it('TeX 計算機本身：四則、分數、次方、科學記號、函數、單位、複數片段', () => {
    expect(evalTex(String.raw`\frac{0.797885}{100}`)).toBeCloseTo(0.00797885, 12)
    expect(evalTex(String.raw`0.9202115\times0.15625-0.15625`)).toBeCloseTo(-0.012466953125, 12)
    expect(evalTex(String.raw`1-0.9202115^2`)).toBeCloseTo(1 - 0.9202115 ** 2, 12)
    expect(evalTex(String.raw`(-0.196827)^2`)).toBeCloseTo(0.196827 ** 2, 12)
    expect(evalTex(String.raw`\frac{4\times10^{9}\ \mathrm{Hz}}{4096}`)).toBe(976562.5)
    expect(evalTex(String.raw`(1.3\times10^{10})\ \mathrm{Hz}\times(5\times10^{-16})\ \mathrm s`)).toBeCloseTo(6.5e-6, 18)
    expect(evalTex(String.raw`2\pi\times0.5`)).toBeCloseTo(Math.PI, 12)
    expect(evalTex(String.raw`10\log_{10}(0.5)`)).toBeCloseTo(-3.0103, 4)
    expect(evalTex(String.raw`2\arcsin(0.5)`)).toBeCloseTo(Math.PI / 3, 12)
    expect(evalTex(String.raw`-\ln(0.9202115)`)).toBeCloseTo(0.0831517, 7)
    expect(evalTex(String.raw`\frac{-1}{-0.0831517}`)).toBeCloseTo(12.0262, 4)
    expect(evalTex(String.raw`|100-10|`)).toBe(90)
    expect(evalTex(String.raw`\sqrt{0.0005}`)).toBeCloseTo(0.0223607, 7)
    expect(() => evalTex(String.raw`\frac{\sqrt{2/\pi}}{\sigma_v}`)).toThrow(Symbolic)
    expect(() => evalTex('1-g')).toThrow(Symbolic)
    expect(() => evalTex(String.raw`\cos\Omega`)).toThrow(Symbolic)
    const lit = literal(String.raw`3.9271\times10^{-6}\ \mathrm{fs^2/Hz}`)
    expect(lit?.value).toBeCloseTo(3.9271e-6, 18)
    expect(lit?.ulp).toBeCloseTo(1e-10, 20)
    expect(literal(String.raw`(-0.0124669)`)?.ulp).toBeCloseTo(1e-7, 20)
    expect(literal(String.raw`10^{-6}`)?.value).toBeCloseTo(1e-6, 18)
    expect(literal(String.raw`0.14-0.15`)).toBeNull()
    // 抓得到錯：把 5 位的乘積拿去相減（修正前的寫法）會差到第 4 位
    expect(worstMismatch(String.raw`\delta w_2=0.99681\times0.25-0.25=0.249202-0.25=-0.00079788\ \mathrm{fs}`).units).toBeGreaterThan(10)
    expect(worstMismatch(String.raw`10\log_{10}(0.99355)=-0.028087\ \mathrm{dB}`).units).toBeGreaterThan(10)
    expect(worstMismatch(String.raw`1-p^2=1-0.9218=0.078197`).units).toBeGreaterThan(2)
    expect(worstMismatch(String.raw`f_u=\frac{4\times10^{9}\ \mathrm{Hz}}{4096}=976562.5\ \mathrm{Hz}=976.5625\ \mathrm{kHz}`).units).toBe(0)
    expect(worstMismatch(String.raw`e^{j\Omega}-p=(0.9965411-0.9202115)+j\,0.0831019=0.0763296+j\,0.0831019`).units).toBeLessThan(0.01)
  })

  for (const h of HANDCALCS) {
    it(`${h.id}：預設值、20 個隨機題、practice 的所有組合與不漂亮的輸入——每個等號都對得上（≤ 第 5 位差 1），答案框的數字就是某一步的結果`, () => {
      const cases = [defaultValues(h), ...Array.from({ length: 20 }, (_, k) => randomValues(h, k + 1)), ...practiceCombos(h), ...AWKWARD[h.id]]
      let worst = { units: 0, where: '', v: {} as Record<string, number> }
      let steps = 0
      for (const v of cases) {
        expect(h.validate?.(v) ?? null, `${h.id} ${JSON.stringify(v)}`).toBeNull()
        const sol = h.solve(v)
        const shown: { value: number; ulp: number }[] = []
        for (const s of sol.steps) {
          steps++
          const top = splitTop(s.tex)
          // 符號式 = 代入數字 = 結果：至少兩個等號，第一段是符號式
          expect(top.length, s.tex).toBeGreaterThanOrEqual(3)
          const numeric = numericSegments(s.tex)
          expect(numeric.length, s.tex).toBeGreaterThanOrEqual(/x\\equiv1/.test(s.tex) ? 1 : 2)
          expect(() => evalTex(top[0]), s.tex).toThrow(Symbolic)
          const w = worstMismatch(s.tex)
          if (w.units > worst.units) worst = { ...w, v }
          for (const n of numeric.slice(1)) for (const part of n.parts) {
            const lit = literal(part.seg)
            if (lit) shown.push(lit)
          }
        }
        // 每個答案都是某一步等號右邊顯示的數（四捨五入到那一步顯示的位數）
        for (const r of sol.results) {
          expect(shown.some((x) => Math.abs(x.value - r.value) <= 0.51 * x.ulp), `${h.id} ${JSON.stringify(v)} ${r.symbol} = ${r.value}`).toBe(true)
        }
      }
      expect(steps).toBeGreaterThan(200)
      expect(worst.units, `${h.id} ${JSON.stringify(worst.v)}：${worst.where}`).toBeLessThanOrEqual(1)
    })
  }

  it('相近的數相減時自動多顯示幾位；三角函數與 dB 用固定小數位；寫得完的數完整顯示', () => {
    // HC-12.1：g 很小（p → 1）時，p 與乘積的位數跟著增加
    const tiny = hc('HC-12.1').solve({ sigmaV: 1000, C: 1, mu: 0.5, N: 100 })
    expect(tiny.steps[3].tex).toBe('p=1-g=1-0.000398942=0.999601058')
    expect(tiny.steps[7].tex).toContain('=0.04998005289-0.05=')
    // g > 1：p 比 g 小，改以 p 的 6 位為準（兩者小數位數相同）
    const hp = hc('HC-12.3').solve({ mu: 150, sigmaV: 100, N: 4096, fs: 4 })
    expect(hp.steps[1].tex).toBe('p=1-g=1-1.196827=-0.196827')
    expect(hp.steps[2].tex).toBe('p^2=(-0.196827)^2=0.0387408')
    // HC-12.2：Ω、cos、sin 顯示到小數點後 7 位（p → 1 且 Ω → 0 時更多），dB 顯示 4 位小數
    const d = hc('HC-12.2').solve(defaultValues(hc('HC-12.2')))
    expect(d.steps.length).toBe(13)
    expect(d.steps[3].tex).toBe(String.raw`\cos\Omega=\cos(0.0831978)=0.9965411`)
    expect(d.steps[8].tex).toContain(String.raw`=-3.0102\ \mathrm{dB}`)
    expect(d.steps[11].tex).toBe(String.raw`\frac{2}{f_u}=\frac{2}{976562.5\ \mathrm{Hz}}=2.048\times10^{-6}\ \mathrm{Hz}^{-1}`)
    const near = hc('HC-12.2').solve({ p: 0.999, mu: 10, N: 4096, fs: 4, f: 0.2 })
    expect(near.steps[3].tex).toBe(String.raw`\cos\Omega=\cos(0.001286796)=0.999999172`)
    // 科學記號當底數要加括號（否則是 KaTeX 的 double superscript 錯誤）
    const small = hc('HC-12.5').solve({ p: 0.01, fs: 0.001, N: 3, sigmaV: 0.00001 })
    expect(small.steps[3].tex).toContain('(10^{-5})^2')
    for (const s of small.steps) expect(() => katex.renderToString(s.tex, { throwOnError: true, displayMode: true }), s.tex).not.toThrow()
    // HC-12.7：β/2 直接用 π 乘（不把四捨五入過的 β 再除以 2）；log 留 5 位小數、dBc 3 位
    const spur = hc('HC-12.7').solve(defaultValues(hc('HC-12.7')))
    expect(spur.steps[3].tex).toBe(String.raw`\frac{\beta}{2}=\pi\cdot f_{\mathrm{out}}|T|A_t=\pi\times(6.5\times10^{-6})=2.04204\times10^{-5}`)
    expect(spur.steps[5].tex).toBe(String.raw`\text{spur}=20\log_{10}\frac{\beta}{2}=20\times(-4.68994)=-93.799\ \mathrm{dBc}`)
    // HC-12.8：頻率比上下用同一個單位（MHz）
    expect(hc('HC-12.8').solve(defaultValues(hc('HC-12.8'))).steps[9].tex).toBe(String.raw`\frac{2f_{BW}}{f_s}=\frac{2\times1\ \mathrm{MHz}}{4000\ \mathrm{MHz}}=\frac{2}{4000}=0.0005`)
  })

  it('handcalcTex：tx / txM / txP / txIn / txD / txDM / sigFor', () => {
    expect(tx(976562.5, 7)).toBe('976562.5')
    expect(tx(0.1 + 0.2)).toBe('0.3')
    expect(tx(0.1953125)).toBe('0.1953125')
    expect(tx(1 / 3)).toBe('0.333333')
    expect(tx(Math.PI * 1e4, 7)).toBe('31415.93')
    expect(tx(4e9)).toBe(String.raw`4\times10^{9}`)
    expect(tx(0)).toBe('0')
    expect(txM(1e-5)).toBe('(10^{-5})')
    expect(txM(-0.3)).toBe('(-0.3)')
    expect(txM(5e6, 15)).toBe(String.raw`(5\times10^{6})`)
    expect(txM(0.5)).toBe('0.5')
    expect(txP(-0.3)).toBe('(-0.3)')
    expect(txP(0.3)).toBe('0.3')
    expect(txIn(0.92021154392)).toBe('0.92021154392')
    expect(txD(-3.0102019737, 4)).toBe('-3.0102')
    expect(txD(-0.0280877, 4)).toBe('-0.0281')
    expect(txD(1e-9, 4)).toBe('0')
    expect(txD(0.99999996, 7)).toBe('1')
    expect(txDM(4.1e-5, 7)).toBe(String.raw`(4.1\times10^{-5})`)
    expect(txDM(-0.1469786, 7)).toBe('(-0.1469786)')
    expect(sigAtDecimals(0.9202115, 7)).toBe(7)
    expect(decimalsAt(0.0797885)).toBe(7)
    expect(decimalsAt(1.19683)).toBe(5)
    expect(sigFor(-0.0124669, 0.1437831, 0.15625)).toBe(7)
    expect(sigFor(0.1447778, -0.0114722, 0.15625)).toBe(6)
    expect(sigFor(0.153211, 1, 0.846789)).toBe(7)
    expect(sigFor(-1.99471e-5, 0.04998, 0.05)).toBe(10)
    expect(sigFor(0, 1, 1)).toBe(6)
  })
})
