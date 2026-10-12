import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'
import { gmacModel } from '@/simulation/models/optimizer'
import { CHART_SAMPLE_TO_BLOCK } from './diagrams'

/**
 * 技術審查 R06b（§14.1 的 sample rate → block rate 圖）：圖上寫 e[n] ≈ δ_k·u[n] + v[n]，u[n] = c·x[n] + s·x[n−1]。
 * 「δ_k 在一個 block 內不變」不足以讓它成為等式：真實電路先乘 δ 再過誤差路徑，每個 block 的第一個樣本裡
 * s·x[n−1] 那一項乘的還是上一個 block 的 δ_{k−1}，所以 e[n] − (δ_k·u[n] + v[n]) = s·(δ_{k−1} − δ_k)·x[n−1]；
 * 其餘 N − 1 個樣本是等式。這裡把導讀裡的這句話釘在本章 Lab 用的 sample-level 核心（runBlockLms）上。
 */

const THETA = 60 // 誤差路徑的相位：c = cos 60° = 0.5、s = sin 60° = 0.866
const N = 16
const A = 30 // 真實 gain [fs per unit code]

/** 本章 Lab 的 sample-level 對照用的設定（optimizer.ts blockLmsMsdCheck）：FIR [c, s]、±1 iid code；這裡關掉雜訊，殘差才是確定值。 */
function cfg(mu: number): BlockLmsConfigInput {
  const gm = gmacModel(N, 100, THETA, 1)
  return {
    seed: 7,
    gm_accum_samples: N,
    gain_initial: 0,
    gain_true: A,
    gain_step: mu,
    pd_noise_rms_fs: 0,
    code_normalization: 'none',
    num_blocks: 6,
    pll_error_path: { kind: 'fir', parameters: { taps: [gm.c, gm.s] } },
    seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
    record: { sample_trace_blocks: 6, decimate: 1 },
  }
}

/** 逐 sample 的 e[n] − δ_{k(n)}·u[n]（無雜訊）與導讀的預測 s·(δ_{k−1} − δ_k)·x[n−1]·[n 是 block k ≥ 1 的第一個樣本] */
function residuals(mu: number) {
  const r = runBlockLms(cfg(mu))
  const s = gmacModel(N, 100, THETA, 1).s
  const w = Array.from(r.blocks.wPhys)
  const actual: number[] = []
  const predicted: number[] = []
  for (let n = 0; n < r.trace.e.length; n++) {
    const k = Math.floor(n / N)
    const dk = A - w[k]
    actual.push(r.trace.e[n] - dk * r.trace.u[n])
    predicted.push(n % N === 0 && k >= 1 ? s * (A - w[k - 1] - dk) * r.trace.x[n - 1] : 0)
  }
  return { r, w, actual, predicted }
}

describe('Ch14 §14.1：e[n] ≈ δ_k·u[n] + v[n] 只差每個 block 的第一個樣本（技術審查 R06b）', () => {
  it('模擬核心（先乘後濾）：殘差只出現在 w 剛更新過的 block 的第一個樣本，大小是 s·(δ_{k−1} − δ_k)·x[n−1]', () => {
    const { r, w, actual, predicted } = residuals(7)
    expect(r.trace.e.length).toBe(6 * N)
    // w 真的有動（否則這個測試沒有意義）；x 是 ±1
    expect(new Set(w).size).toBeGreaterThan(2)
    expect(Array.from(r.trace.x).every((x) => Math.abs(x) === 1)).toBe(true)
    // 逐 sample 與預測一致（實測最大差 7e-15）
    for (let n = 0; n < actual.length; n++) expect(actual[n], `n = ${n}`).toBeCloseTo(predicted[n], 11)
    // 不是等式：至少兩個 block 的第一個樣本差了 0.1 fs 以上（實測 ±0.758 fs = s × 0.875）
    const off = actual.map((v, n) => ({ n, v })).filter((p) => Math.abs(p.v) > 1e-9)
    expect(off.length).toBeGreaterThanOrEqual(2)
    for (const p of off) {
      expect(p.n % N, `n = ${p.n} 是 block 的第一個樣本`).toBe(0)
      expect(Math.abs(p.v)).toBeGreaterThan(0.1)
    }
    // 其餘 N − 1 個樣本是等式
    for (let n = 0; n < actual.length; n++) if (n % N !== 0) expect(Math.abs(actual[n]), `n = ${n}`).toBeLessThan(1e-12)
    // 第一個 block 之前沒有更新過：連第一個樣本也是等式
    expect(Math.abs(actual[0])).toBeLessThan(1e-12)
  })

  it('對照（w 凍結，μ = 0）：每一個樣本都是等式', () => {
    const { w, actual } = residuals(0)
    expect(new Set(w).size).toBe(1)
    expect(Math.max(...actual.map(Math.abs))).toBeLessThan(1e-12)
  })

  it('圖、導讀與符號表都寫 ≈，並說明差在哪一個樣本', () => {
    expect(CHART_SAMPLE_TO_BLOCK).toContain(String.raw`PD 輸出 $e[n] \approx \delta_k\,u[n] + v[n]$`)
    expect(CHART_SAMPLE_TO_BLOCK).not.toContain(String.raw`e[n] = \delta_k`)
    const read = (f: string) => readFileSync(resolve(process.cwd(), 'src/chapters/ch14/sections', f), 'utf8')
    const walk = read('S2Msd.tsx')
    expect(walk).not.toContain(String.raw`e[n]=\\delta_k\\,u[n]+v[n]`)
    expect(walk.split(String.raw`e[n]\\approx\\delta_k\\,u[n]+v[n]`).length - 1).toBe(2)
    for (const phrase of ['還不夠', '每個 block 的第一個樣本', '先乘後濾', '先濾後乘', '凍結（固定不動）', '記憶長度內近似常數', '時間尺度分離', 'F-06.1']) {
      expect(walk, phrase).toContain(phrase)
    }
    expect(walk).toContain(String.raw`e[n]&=c\,\delta_k\,x[n]+s\,\delta_{k-1}\,x[n-1]+v[n]\\` + '\n' + String.raw`&=\delta_k\,u[n]+v[n]\\` + '\n' + String.raw`&\quad+s\,(\delta_{k-1}-\delta_k)\,x[n-1]`)
    const symbols = read('S10Symbols.tsx')
    expect(symbols).toContain(String.raw`t_\mathrm{ref}^{\prime}[n]-t_\mathrm{fb}[n]\approx\delta_k\,u[n]+v[n]`)
    expect(symbols).not.toContain(String.raw`=\delta_k\,u[n]+v[n]`)
  })
})
