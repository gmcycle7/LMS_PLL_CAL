import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { DEFAULT_ACQ, acquisitionAnalytic, acquisitionMonteCarlo, acquisitionTimeline, dtcWorkingPoint, runAcquisition, type AcqParams } from '@/simulation/models/acquisition'
import {
  DEFAULT_CAL_SM,
  cornerInterval,
  gmacModel,
  loopGainK,
  optimizeMu,
  runCalStateMachine,
  runCalStateMachineMonteCarlo,
  slopeTruncationBias,
  type CalSmParams,
} from '@/simulation/models/optimizer'

const DIR = resolve(process.cwd(), 'src/data/presets')
const presets: PresetEntry[] = readdirSync(DIR)
  .filter((f) => f.startsWith('optimizer') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as PresetEntry)
const byId = (id: string) => {
  const p = presets.find((q) => q.id === id)
  if (!p) throw new Error(`missing preset ${id}`)
  return p
}

describe('Ch14 presets（src/data/presets/optimizer*.json）', () => {
  it('格式合法：id = 檔名、page /ch/14、實驗 id 屬於本章、來源標籤合法', () => {
    expect(presets.length).toBeGreaterThanOrEqual(15)
    for (const p of presets) {
      expect(p.id.startsWith('optimizer')).toBe(true)
      expect(p.page).toBe('/ch/14')
      expect(['lr-optimizer', 'corner-interval', 'cal-state-machine']).toContain(p.experiment)
      expect(['illustrative', 'simulation', 'literature', 'measured']).toContain(p.source)
      expect(p.expected.length).toBeGreaterThan(10)
    }
  })

  it('optimizer-lesson10 的 expected 與模型一致（μ* = 10.66 fs、RMS 0.4474 fs）', () => {
    const p = byId('optimizer-lesson10').params as { sigmaV: number; N: number; T: number; delta0: number; thetaDeg: number }
    const o = optimizeMu('final', { K: loopGainK(p.sigmaV, p.thetaDeg), delta0: p.delta0, sigmaEta2: 1 / p.N, B: p.T / p.N })
    expect(o.mu).toBeCloseTo(10.66, 2)
    expect(Math.sqrt(o.cost)).toBeCloseTo(0.4474, 4)
  })

  it('optimizer-phase60 與 optimizer-tracking-ramp 的數字', () => {
    const a = byId('optimizer-phase60').params as { thetaDeg: number }
    const o = optimizeMu('final', { K: loopGainK(100, a.thetaDeg), delta0: 3, sigmaEta2: 1 / 4096, B: 32 })
    expect(o.mu).toBeCloseTo(16.2, 1)
    expect(Math.sqrt(o.cost)).toBeCloseTo(0.794, 3)
    const r = byId('optimizer-tracking-ramp').params as { driftRate: number }
    const t = optimizeMu('trackRamp', { K: loopGainK(100, 0), delta0: 3, sigmaEta2: 1 / 4096, B: 32, driftRate: r.driftRate })
    expect(t.mu).toBeCloseTo(2.01, 2)
  })

  it('corner presets：e16 非空 [79.677, 83.333]、empty 為空、polarity 不合法', () => {
    const ks = (id: string) => {
      const prm = byId(id).params as { directK?: boolean; corners: { sigmaV: number; thetaDeg: number; k?: number }[] }
      return prm.corners.map((c) => (prm.directK && c.k !== undefined ? c.k : loopGainK(c.sigmaV, c.thetaDeg)))
    }
    const e16 = cornerInterval(ks('optimizer-corner-e16'), 0.01, 12)
    expect(e16.muLo).toBeCloseTo(79.677, 3)
    expect(e16.muHi).toBeCloseTo(83.333, 3)
    expect(cornerInterval(ks('optimizer-corner-empty'), 0.01, 11).nonEmpty).toBe(false)
    expect(cornerInterval(ks('optimizer-corner-polarity'), 0.01, 12).ok).toBe(false)
    // 直接輸入的 K 與等效 σ_v 反推的 K 一致
    const e16p = byId('optimizer-corner-e16').params as { corners: { sigmaV: number; thetaDeg: number; k: number }[] }
    for (const c of e16p.corners) expect(loopGainK(c.sigmaV, c.thetaDeg)).toBeCloseTo(c.k, 12)
    const d = cornerInterval(ks('optimizer-corner-default'), 0.01, 12)
    expect(d.bMin).toBe(9)
    expect(d.muLo).toBeCloseTo(69.64, 2)
    expect(d.muHi).toBeCloseTo(89.09, 2)
  })

  it('optimizer-c-near-zero 與 optimizer-e48-large-delta0 的 expected 數字', () => {
    const c = byId('optimizer-c-near-zero').params as { sigmaV: number; N: number; T: number; delta0: number; thetaDeg: number }
    const Kc = loopGainK(c.sigmaV, c.thetaDeg)
    expect(Kc).toBeCloseTo(2.785e-4, 6)
    expect(Math.sqrt(optimizeMu('final', { K: Kc, delta0: c.delta0, sigmaEta2: 1 / c.N, B: c.T / c.N }).cost)).toBeCloseTo(2.87, 2)
    const e = byId('optimizer-e48-large-delta0').params as { sigmaV: number; N: number; T: number; delta0: number; thetaDeg: number }
    const oe = optimizeMu('final', { K: loopGainK(e.sigmaV, e.thetaDeg), delta0: e.delta0, sigmaEta2: 1 / e.N, B: e.T / e.N })
    expect(e.T / e.N).toBe(30)
    expect(oe.mu).toBeCloseTo(26.2, 1)
    expect(Math.sqrt(oe.cost)).toBeCloseTo(0.69, 2)
  })

  it('optimizer-corner-measured：se = 6.91e-5 fs⁻¹；F-14.21 截斷偏差 TT −0.67%、near-grid（55°）−1.56%', () => {
    const prm = byId('optimizer-corner-measured').params as { N: number; Delta: number; M: number; corners: { sigmaV: number; thetaDeg: number }[] }
    expect(Math.sqrt(1 / prm.N) / (prm.Delta * Math.sqrt(2 * prm.M))).toBeCloseTo(6.905e-5, 8)
    const tt = prm.corners[0]
    const ng = prm.corners[3]
    expect(100 * slopeTruncationBias(gmacModel(prm.N, tt.sigmaV, tt.thetaDeg), prm.Delta)).toBeCloseTo(-0.667, 3)
    expect(100 * slopeTruncationBias(gmacModel(prm.N, ng.sigmaV, ng.thetaDeg), prm.Delta)).toBeCloseTo(-1.561, 3)
  })

  it('state-machine presets：預設約 block 107 進入 TRACK、低雜訊視窗不更新；極性錯誤 ⇒ FAULT', () => {
    const cfg = (id: string): CalSmParams => ({ ...DEFAULT_CAL_SM, ...(byId(id).params as Partial<CalSmParams>) })
    const d = runCalStateMachine(cfg('optimizer-sm-default'))
    expect(d.summary.firstTrackBlock).toBe(107)
    expect(d.summary.updatesInLowNoise).toBe(0)
    expect(runCalStateMachine(cfg('optimizer-sm-polarity')).summary.fault).toBe(true)
    expect(runCalStateMachine(cfg('optimizer-sm-pvt-step')).summary.restarts).toBeGreaterThanOrEqual(1)
  })

  it('state-machine presets 的 expected 數字（MC 48 runs、固定 seed；RMS 以 DTC 實際誤差計，含 VERIFY 的 ±Δ）', () => {
    const cfg = (id: string, patch: Partial<CalSmParams> = {}): CalSmParams => ({ ...DEFAULT_CAL_SM, ...(byId(id).params as Partial<CalSmParams>), ...patch })
    const mc = (c: CalSmParams) => runCalStateMachineMonteCarlo({ config: c, runs: 48 })
    const near = (x: number, ref: number, rel = 0.05) => expect(Math.abs(x / ref - 1)).toBeLessThan(rel)
    // 預設：狀態機 0.40、固定快 μ 0.80、固定安靜 μ 0.71 fs；收斂 47／60／268 blocks；沒有誤警報
    const d = mc(cfg('optimizer-sm-default'))
    near(d.evalRms.mean, 0.399)
    near(d.evalRmsBase.mean, 0.803)
    near(d.evalRmsBase2.mean, 0.705)
    expect(d.evalRms.hi).toBeLessThan(d.evalRmsBase.lo)
    expect([d.settle.sm, d.settle.base, d.settle.base2]).toEqual([47, 60, 268])
    expect(d.meanRestarts).toBe(0)
    const one = runCalStateMachine(cfg('optimizer-sm-default'))
    expect([one.summary.updatesInLowNoise, one.summary.updatesInLowNoiseBase, one.summary.updatesInLowNoiseBase2]).toEqual([0, 76, 80])
    // PVT step 100 fs：8.8（暫存器 8.7）vs 10.5 vs 23.0；VERIFY Δ = 40 fs 時優勢消失
    const s = mc(cfg('optimizer-sm-pvt-step'))
    near(s.evalRms.mean, 8.81, 0.03)
    near(s.evalRmsRegister.mean, 8.67, 0.03)
    near(s.evalRmsBase.mean, 10.5, 0.03)
    near(s.evalRmsBase2.mean, 23.0, 0.03)
    expect(s.evalRms.hi).toBeLessThan(s.evalRmsBase.lo)
    const s40 = mc(cfg('optimizer-sm-pvt-step', { verifyDelta: 40 }))
    expect(s40.evalRms.mean).toBeGreaterThan(s40.evalRmsBase.mean)
    // 小 step 25 fs：RESTART（3.1）比留在 TRACK（5.65）好，但輸給固定快 μ（2.65）
    const sm = mc(cfg('optimizer-sm-small-step'))
    near(sm.evalRms.mean, 3.11, 0.04)
    near(sm.evalRmsBase.mean, 2.65, 0.04)
    expect(sm.evalRms.lo).toBeGreaterThan(sm.evalRmsBase.hi)
    const noRestart = mc(cfg('optimizer-sm-small-step', { alarmHiZ: 1e9, alarmLoZ: 1e8 }))
    near(noRestart.evalRms.mean, 5.65, 0.04)
    // 失鎖：lock detect 開 1.64 fs（暫存器 0.47）；關掉 ≈ 38 fs
    const l = mc(cfg('optimizer-sm-lock-loss'))
    near(l.evalRms.mean, 1.64, 0.03)
    near(l.evalRmsRegister.mean, 0.465, 0.1)
    near(l.evalRmsBase.mean, 21.1, 0.03)
    expect(mc(cfg('optimizer-sm-lock-loss', { lockDetect: false })).evalRms.mean).toBeGreaterThan(25)
    // bad-FCW：ignore ⇒ 48/48 FAULT、≈ 11.6 fs；freeze ⇒ 0.43 fs
    const b = mc(cfg('optimizer-sm-bad-fcw-ignore'))
    expect(b.faultRuns).toBe(48)
    near(b.evalRms.mean, 11.6, 0.06)
    const bf = mc(cfg('optimizer-sm-bad-fcw-ignore', { badFcwPolicy: 'freeze' }))
    expect(bf.faultRuns).toBe(0)
    near(bf.evalRms.mean, 0.426, 0.1)
    // 沒有 hysteresis（3σ）：≈ 0.6 次 RESTART／run、RMS ≈ 1.2 fs；同門檻打開 hysteresis：≈ 0.17 次、0.76 fs
    const nh = mc(cfg('optimizer-sm-no-hysteresis'))
    expect(nh.meanRestarts).toBeGreaterThan(0.45)
    expect(nh.meanRestarts).toBeLessThan(0.8)
    near(nh.evalRms.mean, 1.19, 0.15)
    const h = mc(cfg('optimizer-sm-no-hysteresis', { hysteresis: true }))
    expect(h.meanRestarts).toBeLessThan(0.25)
    near(h.evalRms.mean, 0.76, 0.15)
    // 極性錯誤：48/48 FAULT、4 次 clip；定點 LSB：0.49 fs
    expect(mc(cfg('optimizer-sm-polarity')).faultRuns).toBe(48)
    expect(runCalStateMachine(cfg('optimizer-sm-polarity')).summary.clipEvents).toBe(4)
    near(mc(cfg('optimizer-sm-register-lsb')).evalRms.mean, 0.485, 0.1)
  })
})

describe('Ch14 §14.6b acquisition presets（src/data/presets/ch14-acq-*.json）', () => {
  const acqPresets: PresetEntry[] = readdirSync(DIR)
    .filter((f) => f.startsWith('ch14-acq-') && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as PresetEntry)
  const acqById = (id: string) => {
    const p = acqPresets.find((q) => q.id === id)
    if (!p) throw new Error(`missing preset ${id}`)
    return p
  }
  /** 和實驗的 buildAcqConfig 同一個接法：seed／N／[w0, a0]／失鎖事件放在干擾結束的週期 */
  const acqCfg = (id: string): AcqParams => {
    const { acq, ...sm } = acqById(id).params as { acq?: Partial<AcqParams> } & Partial<CalSmParams>
    const c: CalSmParams = { ...DEFAULT_CAL_SM, ...sm }
    const hasLoss = c.lockLossStart >= 0 && c.lockLossLen > 0
    const lossCycle = hasLoss ? (c.lockLossStart + c.lockLossLen) * c.N : -1
    return { ...DEFAULT_ACQ, ...(acq ?? {}), seed: c.seed, blockN: c.N, dtcGainsFs: [c.w0, c.a0], lossCycle, cycles: hasLoss ? lossCycle + 32768 : 40000 }
  }

  it('格式合法：6 個、id = 檔名、page /ch/14、實驗 cal-state-machine、params 有 acq 子物件', () => {
    expect(acqPresets.length).toBe(6)
    for (const p of acqPresets) {
      expect(p.page).toBe('/ch/14')
      expect(p.experiment).toBe('cal-state-machine')
      expect(p.source).toBe('illustrative')
      expect(typeof (p.params as { acq?: unknown }).acq).toBe('object')
      expect(p.expected.length).toBeGreaterThan(10)
    }
  })

  it('default：LOCK = 10 blocks（無雜訊 enable 9313、有雜訊的 12 個 seed 全部 10）', () => {
    const c = acqCfg('ch14-acq-default')
    expect(acquisitionTimeline(c).summary.enableCycle).toBe(9313)
    expect(acquisitionTimeline(c).summary.lockBlocks).toBe(10)
    expect(acquisitionMonteCarlo({ config: c, runs: 12 }).lockBlocks.every((b) => b === 10)).toBe(true)
  })

  it('noisy-fd：σ_f = 0.4 MHz ⇒ lock 由雜訊決定，12 個 seed 全部 11 blocks；P_miss ≈ 0.33、E[T] ≈ 39.6', () => {
    const c = acqCfg('ch14-acq-noisy-fd')
    const mc = acquisitionMonteCarlo({ config: c, runs: 12 })
    expect(mc.lockBlocks.every((b) => b === 11)).toBe(true)
    expect(mc.freqLock.mean).toBeGreaterThan(acquisitionAnalytic(c).nFL + 1000)
    const a = acquisitionAnalytic(c)
    expect(a.pMiss).toBeCloseTo(0.3296, 3)
    expect(a.expectedDetectCycles).toBeCloseTo(39.59, 1)
  })

  it('slow-fll：K_f = 2.5×10⁻⁴ ⇒ n_c = 17526、LOCK 18 blocks', () => {
    const a = acquisitionAnalytic(acqCfg('ch14-acq-slow-fll'))
    expect(a.kF).toBeCloseTo(2.5e-4, 12)
    expect(a.nC).toBe(17526)
    expect(a.lockBlocks).toBe(18)
    expect(acquisitionTimeline(acqCfg('ch14-acq-slow-fll')).summary.lockBlocks).toBe(18)
    // 實驗顯示的是預設 σ_f = 0.1 MHz 的有雜訊模擬：lock detect 晚幾百個週期，跨過 block 邊界 ⇒ 19（expected 文字寫的數字）
    expect(acquisitionMonteCarlo({ config: acqCfg('ch14-acq-slow-fll'), runs: 12 }).lockBlocks.every((b) => b === 19)).toBe(true)
  })

  it('dtc-out-of-range：w_0 = −4000 fs 在 x = +1 飽和 ⇒ 不能 enable、LOCK = ∞', () => {
    const c = acqCfg('ch14-acq-dtc-out-of-range')
    expect(c.dtcGainsFs).toEqual([-4000, 100])
    const d = dtcWorkingPoint(c)
    expect(d.ok).toBe(false)
    expect(d.rows[0].xMax.saturated).toBe(true)
    const r = runAcquisition(c)
    expect(r.summary.enableCycle).toBe(-1)
    expect(r.summary.lockBlocks).toBe(Infinity)
  })

  it('loss-relock：干擾結束後 +50 MHz ⇒ 重新 enable 8429 週期 = 9 blocks（block 級失鎖視窗 10 + 9）', () => {
    const c = acqCfg('ch14-acq-loss-relock')
    expect(c.lossCycle).toBe(310 * 1024)
    const s = acquisitionTimeline(c).summary
    expect(s.unlocks).toBe(1)
    expect(s.relockCycles).toBe(8429)
    expect(s.relockBlocks).toBe(9)
    const noisy = runAcquisition(c).summary // 實驗用的單一 seed（有雜訊）：expected 寫的 8799
    expect(noisy.relockCycles).toBe(8799)
    expect(noisy.relockBlocks).toBe(9)
  })

  it('phase-noise：σ_θ = 2 ps ⇒ CAL → HOLD → RECAL → CAL 走過、沒有失鎖、沒有 slip', () => {
    const r = runAcquisition(acqCfg('ch14-acq-phase-noise'))
    const walked = new Set(r.events.filter((e) => e.kind === 'state').map((e) => e.msg))
    for (const t of ['CAL → HOLD', 'HOLD → RECAL', 'RECAL → CAL']) expect(walked.has(t), t).toBe(true)
    expect(r.summary.holds).toBeGreaterThan(0)
    expect(r.summary.unlocks).toBe(0)
    expect(r.summary.slips).toBe(0)
  })
})
