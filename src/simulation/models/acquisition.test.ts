import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRng, normCdf, normInv } from '@/simulation/core'
import {
  ACQ_STATES,
  DEFAULT_ACQ,
  acquisitionAnalytic,
  acquisitionMonteCarlo,
  acquisitionTimeline,
  dtcWorkingPoint,
  effectivePhaseGain,
  expectedRunLength,
  fllCyclesToTol,
  fllGain,
  fllGainLsbFor,
  fllLockCycle,
  harmonicCapture,
  lockDetectFalseAlarm,
  lockDetectInWindowProb,
  lockDetectMeanCycle,
  lockDetectMiss,
  noFllCheck,
  noFllConfig,
  pdCharacteristic,
  phaseLockCycles,
  phaseLoopGain,
  rampFsPerCycle,
  runAcquisition,
  settleCycles,
  slipBoundary,
  slipProbPerCycle,
  staticOffsetFs,
  steadyStateThetaRms,
  tVcoFs,
  wrapTheta,
  type AcqParams,
} from './acquisition'

/**
 * Ch14 §14.6b 模型（acquisition.ts）與 Python golden（golden/lms_pll_golden/acquisition.py）的交叉比對：
 *   golden/vectors/acquisition_timeline.json。判定規則同 golden/README.md §5：|actual − expected| ≤ abs + rel·|expected|；
 *   週期數、block 數、次數與 1／0 旗標（dtc_ok）等整數 key 用 abs = 0.5（必須完全相等）。Monte Carlo（σ_f、σ_θ > 0）的數字不放進 vector（RNG 不同），這裡用 CI 對照線性模型。
 */

interface Tol {
  abs?: number
  rel?: number
}
interface GoldenVector {
  id: string
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: Tol
  tolerance_overrides?: Record<string, Tol>
}
const load = (name: string): GoldenVector => JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

function expectClose(actual: number, v: GoldenVector, key: string) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const exp = v.expected[key] as number
  expect(typeof exp, `${key} 在 vector 裡`).toBe('number')
  expect(Number.isFinite(actual), `${key} 有限`).toBe(true)
  expect(Math.abs(actual - exp), `${key}: ${actual} vs ${exp}`).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(exp))
}

const V = load('acquisition_timeline')
const P: AcqParams = DEFAULT_ACQ

describe('Ch14 §14.6b acquisition：golden vector（確定性時間表與封閉式）', () => {
  it('vector 的 inputs 就是 DEFAULT_ACQ（illustrative：4 GHz、M = 4、320 MHz 頻寬）', () => {
    const i = V.inputs as Record<string, number | number[]>
    expect(i.f_ref_hz).toBe(P.fRefHz)
    expect(i.div_ratio).toBe(P.divRatio)
    expect(i.k_vco_hz_per_lsb).toBe(P.kVcoHzPerLsb)
    expect(i.fll_gain_lsb).toBe(P.fllGainLsb)
    expect(i.df0_hz).toBe(P.df0Hz)
    expect(i.sigma_f_hz).toBe(P.sigmaFHz)
    expect(i.f_tol_hz).toBe(P.fTolHz)
    expect(i.n_ld).toBe(P.nLd)
    expect(i.f_bw_hz).toBe(P.fBwHz)
    expect(i.theta0_fs).toBe(P.theta0Fs)
    expect(i.theta_max_fs).toBe(P.thetaMaxFs)
    expect(i.settle_window).toBe(P.settleWindow)
    expect(i.rms_max_fs).toBe(P.rmsMaxFs)
    expect(i.dtc_gains_fs).toEqual(P.dtcGainsFs)
    expect(i.block_n).toBe(P.blockN)
  })

  it('封閉式：K_f、T_vco、g_p、n_c、n_FL、Δf_h、ΔT、θ_ss、σ_ss、n_PL、n_settle、enable、LOCK blocks（線性與 sine 上界）', () => {
    const a = acquisitionAnalytic(P)
    expectClose(a.kF, V, 'k_f')
    expectClose(a.tVcoFs, V, 't_vco_fs')
    expectClose(a.gp, V, 'g_p')
    expectClose(a.nC, V, 'n_c')
    expectClose(a.nFL, V, 'n_fl')
    expectClose(a.dfHandoffHz, V, 'df_handoff_hz')
    expectClose(a.rampFsPerCycle, V, 'ramp_fs_per_cycle')
    expectClose(a.thetaSsFs, V, 'theta_ss_fs')
    expectClose(a.sigmaSsFs, V, 'sigma_ss_fs')
    expectClose(a.nPlRel, V, 'n_pl_rel')
    expectClose(a.nSettleRel, V, 'n_settle_rel')
    expectClose(a.nEnable, V, 'n_enable')
    expectClose(a.lockBlocks, V, 'lock_blocks')
    expectClose(a.gEff, V, 'g_eff')
    expectClose(a.nPlRelBound, V, 'n_pl_rel_bound')
    expectClose(a.nSettleRelBound, V, 'n_settle_rel_bound')
    expectClose(a.nEnableBound, V, 'n_enable_bound')
    expect(a.nC).toBe(8762)
    expect(a.nFL).toBe(8793)
    expect(a.nEnable).toBe(9310)
    expect(a.lockBlocks).toBe(10)
  })

  it('lock detect：p_in(0)、P_miss、E[T_N]、誤報（Δf_x = f_tol + σ_f）；手算例 σ_f = 0.4 MHz（z = 2.5）、Δf_x = 2 f_tol', () => {
    const a = acquisitionAnalytic(P)
    expectClose(a.pIn0, V, 'p_in0')
    expectClose(a.pMiss, V, 'p_miss')
    expectClose(a.expectedDetectCycles, V, 'expected_detect_cycles')
    expectClose(a.dfFalseAlarmHz, V, 'df_false_alarm_hz')
    expectClose(a.pFalseAlarm, V, 'p_false_alarm')
    expectClose(a.noisyLockMeanCycle, V, 'noisy_lock_mean_cycle')
    expectClose(lockDetectMeanCycle(P.df0Hz, P.fTolHz, a.kF, V.inputs.hc_sigma_f_hz as number, P.nLd), V, 'hc_noisy_lock_mean_cycle')
    const sf = V.inputs.hc_sigma_f_hz as number
    const dfx = V.inputs.hc_df_x_hz as number
    const pin0 = lockDetectInWindowProb(0, P.fTolHz, sf)
    expectClose(pin0, V, 'hc_p_in0')
    expectClose(lockDetectMiss(P.fTolHz, sf, P.nLd), V, 'hc_p_miss')
    expectClose(expectedRunLength(pin0, P.nLd), V, 'hc_expected_detect_cycles')
    expectClose(lockDetectInWindowProb(dfx, P.fTolHz, sf), V, 'hc_p_in_x')
    expectClose(lockDetectFalseAlarm(dfx, P.fTolHz, sf, P.nLd), V, 'hc_p_false_alarm')
    // 和直接用 Φ 算的一致
    expect(pin0).toBeCloseTo(2 * normCdf(2.5) - 1, 12)
    expect(lockDetectMiss(P.fTolHz, sf, P.nLd)).toBeCloseTo(1 - Math.pow(pin0, P.nLd), 9)
    let sum = 0
    for (let k = 1; k <= P.nLd; k++) sum += Math.pow(pin0, -k)
    expect(expectedRunLength(pin0, P.nLd)).toBeCloseTo(sum, 9)
    expect(expectedRunLength(1, 7)).toBe(7)
    expect(lockDetectInWindowProb(0.5e6, 1e6, 0)).toBe(1)
    expect(lockDetectInWindowProb(1.5e6, 1e6, 0)).toBe(0)
  })

  it('SSPD 範圍與 cycle slip：單調 ±T_vco/4、吸引區 ±T_vco/2、每週期拉得回來的斜坡上限與 Δf 上限；穩態 slip 機率', () => {
    const a = acquisitionAnalytic(P)
    expectClose(a.slip.monotonicFs, V, 'slip_monotonic_fs')
    expectClose(a.slip.basinFs, V, 'slip_basin_fs')
    expectClose(a.slip.rampLimitFsPerCycle, V, 'slip_ramp_limit_fs_per_cycle')
    expectClose(a.slip.dfLimitHz, V, 'slip_df_limit_hz')
    expectClose(a.slipProbPerCycle, V, 'slip_prob_per_cycle')
    const T = tVcoFs(P)
    const s = (th: number) => pdCharacteristic(th, T, 'sine')
    const h = 1e-3
    expect((s(h) - s(-h)) / (2 * h)).toBeCloseTo(1, 6)
    expect((s(T / 4 + h) - s(T / 4 - h)) / (2 * h)).toBeCloseTo(0, 6)
    expect(s(T / 2 - 1)).toBeGreaterThan(0)
    expect(s(-T / 2 + 1)).toBeLessThan(0)
    expect(pdCharacteristic(123, T, 'linear')).toBe(123)
    expect(wrapTheta(0.6 * T, T)).toEqual({ theta: expect.closeTo(-0.4 * T, 6) as number, slipped: true })
    expect(wrapTheta(0.4 * T, T)).toEqual({ theta: 0.4 * T, slipped: false })
    expect(rampFsPerCycle(a.slip.dfLimitHz, P)).toBeCloseTo(a.slip.rampLimitFsPerCycle, 9)
    // 有雜訊的 slip 機率：θ_ss = 0、σ_ss = T/8 時雙尾 2Φ(−4)
    expect(slipProbPerCycle(0, T / 8, T)).toBeCloseTo(2 * normCdf(-4), 12)
  })

  it('DTC 工作點（Ch04 §5b）：預設 gain 0／100 fs 在範圍內；90 ps 超出 T_0 ⇒ 飽和、不能 enable', () => {
    const ok = dtcWorkingPoint(P)
    expect(ok.ok ? 1 : 0).toBe(V.expected.dtc_ok)
    expectClose(ok.t0Fs, V, 'dtc_t0_fs')
    expectClose(ok.rangeFs, V, 'dtc_range_fs')
    expectClose(ok.lsbFs, V, 'dtc_lsb_fs')
    const bad = dtcWorkingPoint({ ...P, dtcGainsFs: V.inputs.dtc_bad_gains_fs as number[] })
    expect(bad.ok ? 1 : 0).toBe(V.expected.dtc_bad_ok)
    expect(bad.ok).toBe(false)
    expect(bad.reason).toContain('超出範圍')
    expect(bad.rows[1].xMax.saturated).toBe(true)
  })

  it('無雜訊時間表（線性 PD）＝ golden ＝ 封閉式：n_FL 8793、phase lock 8830、settle 9310、enable 9310、LOCK 10 blocks', () => {
    const lin = acquisitionTimeline({ ...P, pdShape: 'linear' })
    const s = lin.summary
    expectClose(s.freqLockCycle, V, 'linear_freq_lock_cycle')
    expectClose(s.phaseLockCycle, V, 'linear_phase_lock_cycle')
    expectClose(s.settleCycle, V, 'linear_settle_cycle')
    expectClose(s.enableCycle, V, 'linear_enable_cycle')
    expectClose(s.lockBlocks, V, 'linear_lock_blocks')
    expectClose(s.dfHandoffHz, V, 'linear_df_handoff_hz')
    const a = acquisitionAnalytic({ ...P, pdShape: 'linear' })
    expect(s.freqLockCycle).toBe(a.nFL)
    expect(s.phaseLockCycle).toBe(a.nFL + a.nPlRel)
    expect(s.settleCycle).toBe(a.nFL + a.nSettleRel)
    expect(s.enableCycle).toBe(a.nEnable)
    expect(s.lockBlocks).toBe(a.lockBlocks)
    expect(s.dfHandoffHz).toBeCloseTo(a.dfHandoffHz, 6)
    expect(lin.segments.map((g) => g.state)).toEqual(['ACQ', 'PLOCK', 'CAL'])
    expect(lin.segments[1].from).toBe(8794)
    expect(lin.segments[2].from).toBe(9311)
    expect(lin.segments.every((g) => g.reason.length > 0)).toBe(true)
    // 狀態索引與逐週期紀錄：ACQ 期間 θ 是 NaN、PLOCK 第一個週期的 θ 已經更新過一次
    expect(ACQ_STATES[lin.state[0]]).toBe('ACQ')
    expect(ACQ_STATES[lin.state[9000]]).toBe('PLOCK')
    expect(ACQ_STATES[lin.state[16000]]).toBe('CAL')
    expect(Number.isNaN(lin.theta[100])).toBe(true)
    expect(Math.abs(lin.theta[8794])).toBeLessThan(P.theta0Fs)
    expect(lin.df[0]).toBe(P.df0Hz)
  })

  it('sine PD：比線性慢、但在弦斜率上界內；enable 9313、沒有 slip', () => {
    const sin = acquisitionTimeline(P).summary
    expectClose(sin.freqLockCycle, V, 'sine_freq_lock_cycle')
    expectClose(sin.phaseLockCycle, V, 'sine_phase_lock_cycle')
    expectClose(sin.settleCycle, V, 'sine_settle_cycle')
    expectClose(sin.enableCycle, V, 'sine_enable_cycle')
    expectClose(sin.lockBlocks, V, 'sine_lock_blocks')
    expectClose(sin.slips, V, 'sine_slips')
    const a = acquisitionAnalytic(P)
    expect(sin.enableCycle).toBeGreaterThanOrEqual(a.nEnable)
    expect(sin.enableCycle).toBeLessThanOrEqual(a.nEnableBound)
    expect(sin.phaseLockCycle).toBeGreaterThanOrEqual(a.nFL + a.nPlRel)
    expect(sin.phaseLockCycle).toBeLessThanOrEqual(a.nFL + a.nPlRelBound)
    expect(effectivePhaseGain(0, 0.4, 'sine', 1000)).toBe(0.4)
    expect(effectivePhaseGain(250, 0.4, 'linear', 1000)).toBe(0.4)
    expect(effectivePhaseGain(250, 0.4, 'sine', 1000)).toBeCloseTo((0.4 * Math.sin(Math.PI / 2)) / (Math.PI / 2), 12)
  })

  it('失鎖事件（CAL 中 +50 MHz）：slip → HOLD → 失鎖 → ACQ → PLOCK → CAL；重新 enable 8429 週期 = 9 blocks', () => {
    const r = acquisitionTimeline({ ...P, lossCycle: V.inputs.loss_cycle as number, cycles: V.inputs.loss_cycles as number })
    expectClose(r.summary.unlocks, V, 'loss_unlocks')
    expectClose(r.summary.holds, V, 'loss_holds')
    expectClose(r.summary.relockCycles, V, 'loss_relock_cycles')
    expectClose(r.summary.relockBlocks, V, 'loss_relock_blocks')
    expect(r.segments.map((g) => g.state)).toEqual(['ACQ', 'PLOCK', 'CAL', 'HOLD', 'ACQ', 'PLOCK', 'CAL'])
    expect(r.segments[4].from).toBe((V.inputs.loss_cycle as number) + P.nUl)
    expect(r.events.some((e) => e.kind === 'unlock' && e.msg.startsWith('失鎖'))).toBe(true)
    expect(r.events.some((e) => e.kind === 'hold')).toBe(true) // +50 MHz 的斜坡 781 fs/週期還拉得回來（上限 3930），是 |θ| ≥ θ_max 進 HOLD，不是 slip
  })
})

describe('Ch14 §14.6b acquisition：倍頻模糊（SSPLL 為什麼需要 FLL）與「不用 FLL」的兩層條件', () => {
  const int = (b: boolean) => (b ? 1 : 0)
  it('golden：交棒時的倍頻捕獲；不用 FLL 的 k、混疊、斜坡、靜態偏移、四個尺度與 binding', () => {
    const a = acquisitionAnalytic(P)
    expectClose(a.harmonic.captureHz, V, 'harmonic_capture_hz')
    expectClose(a.harmonic.k, V, 'harmonic_handoff_k')
    expectClose(int(a.harmonic.ok), V, 'harmonic_handoff_ok')
    const c = a.noFll
    expectClose(c.harmonic.k, V, 'no_fll_k')
    expectClose(c.harmonic.aliasHz, V, 'no_fll_alias_hz')
    expectClose(int(c.harmonic.ok), V, 'no_fll_harmonic_ok')
    expectClose(c.rampFsPerCycle, V, 'no_fll_ramp_fs_per_cycle')
    expectClose(int(c.slipOk), V, 'no_fll_slip_ok')
    expectClose(c.thetaSsFs, V, 'no_fll_theta_ss_fs')
    expectClose(c.thetaSsPdFs, V, 'no_fll_theta_ss_pd_fs')
    expectClose(int(c.phaseLockOk), V, 'no_fll_phase_lock_ok')
    expectClose(int(c.settleOk), V, 'no_fll_settle_ok')
    expectClose(c.dfThetaMaxHz, V, 'no_fll_df_theta_max_hz')
    expectClose(c.dfRmsMaxHz, V, 'no_fll_df_rms_max_hz')
    expect(c.binding).toBe('phaseLock')
    // 四個尺度：f_ref/2 ≫ Δf_limit ≫ Δf(θ_max) ≫ Δf(rms_max)；80 MHz 落在 slip 上限與 θ_max 之間
    expect(P.fRefHz / 2).toBeGreaterThan(a.slip.dfLimitHz)
    expect(a.slip.dfLimitHz).toBeGreaterThan(P.df0Hz)
    expect(P.df0Hz).toBeGreaterThan(c.dfThetaMaxHz)
    expect(c.dfThetaMaxHz).toBeGreaterThan(c.dfRmsMaxHz)
    expect(staticOffsetFs(rampFsPerCycle(c.dfThetaMaxHz, P), P)).toBeCloseTo(P.thetaMaxFs, 6)
  })

  it('golden：FLL 關掉（K_f = 0）的模擬——第 N_ld − 1 個週期交棒、沒有 slip、永遠不 phase lock，相位停在 sine PD 的平衡點', () => {
    const r = acquisitionTimeline({ ...noFllConfig(P), cycles: V.inputs.no_fll_cycles as number })
    expectClose(r.summary.freqLockCycle, V, 'no_fll_sim_freq_lock_cycle')
    expectClose(r.summary.phaseLockCycle, V, 'no_fll_sim_phase_lock_cycle')
    expectClose(r.summary.enableCycle, V, 'no_fll_sim_enable_cycle')
    expectClose(r.summary.slips, V, 'no_fll_sim_slips')
    expectClose(r.theta[r.theta.length - 1], V, 'no_fll_sim_theta_end_fs')
    expect(r.theta[r.theta.length - 1]).toBeCloseTo(acquisitionAnalytic(P).noFll.thetaSsPdFs, 6)
  })

  it('golden：錯的倍頻（Δf_0 = f_ref + 0.5 MHz、不用 FLL）——SSPD 只看得到 0.5 MHz，phase lock 與穩態都過、沒有 slip，倍頻捕獲擋住 enable', () => {
    const df0 = V.inputs.wrong_harmonic_df0_hz as number
    const c = noFllCheck(P, df0)
    expectClose(c.harmonic.k, V, 'wrong_harmonic_k')
    expectClose(c.harmonic.aliasHz, V, 'wrong_harmonic_alias_hz')
    expectClose(int(c.harmonic.ok), V, 'wrong_harmonic_ok')
    expectClose(c.thetaSsPdFs, V, 'wrong_harmonic_theta_ss_pd_fs')
    expect(c.binding).toBe('harmonic')
    const s = acquisitionTimeline({ ...noFllConfig(P, df0), cycles: V.inputs.no_fll_cycles as number }).summary
    expectClose(s.phaseLockCycle, V, 'wrong_harmonic_sim_phase_lock_cycle')
    expectClose(s.settleCycle, V, 'wrong_harmonic_sim_settle_cycle')
    expectClose(s.enableCycle, V, 'wrong_harmonic_sim_enable_cycle')
    expectClose(s.slips, V, 'wrong_harmonic_sim_slips')
    expect(s.phaseLockCycle).toBeGreaterThan(0)
    expect(s.enableCycle).toBe(-1)
  })

  it('SSPD 分不出倍頻：Δf 與 Δf + f_ref 的取樣（相位）序列逐週期相同；多一個 f_ref 的斜坡剛好是一個 T_vco', () => {
    expect(harmonicCapture(8e7, P)).toEqual({ captureHz: 2e9, k: 0, aliasHz: 8e7, ok: true })
    expect(harmonicCapture(-P.fRefHz - 5e5, P).k).toBe(-1)
    expect(harmonicCapture(2.1e9, P)).toMatchObject({ k: 1, ok: false })
    expect(rampFsPerCycle(P.fRefHz, P)).toBeCloseTo(tVcoFs(P), 9)
    const a = acquisitionTimeline({ ...noFllConfig(P), cycles: 2000 })
    const b = acquisitionTimeline({ ...noFllConfig(P, P.df0Hz + P.fRefHz), cycles: 2000 })
    const fin = (x: Float64Array) => Array.from(x).filter(Number.isFinite)
    expect(fin(b.theta)).toEqual(fin(a.theta))
    expect(a.summary.slips).toBe(0)
    expect(b.summary.slips).toBe(0)
    // 封閉式：交棒時的殘餘誤差在捕獲範圍外 ⇒ n_enable = ∞
    expect(acquisitionAnalytic({ ...P, fTolHz: 5e9, fUnlockHz: 1e10, df0Hz: P.fRefHz + 5e5, fllGainLsb: 1e-6 }).nEnable).toBe(Infinity)
  })
})

describe('Ch14 §14.6b acquisition：封閉式的性質', () => {
  it('K_f 的組成與反推；n_c 是遞迴首次進門檻的週期；不合法輸入回傳 ∞', () => {
    expect(fllGain(P)).toBeCloseTo(5e-4, 15)
    expect(fllGainLsbFor(5e-4, P)).toBeCloseTo(P.fllGainLsb, 12)
    const kF = fllGain(P)
    let df = P.df0Hz
    let first = -1
    for (let n = 0; n < 20000; n++) {
      if (Math.abs(df) < P.fTolHz) {
        first = n
        break
      }
      df *= 1 - kF
    }
    expect(first).toBe(fllCyclesToTol(P.df0Hz, P.fTolHz, kF))
    expect(fllLockCycle(P.df0Hz, P.fTolHz, kF, P.nLd)).toBe(first + P.nLd - 1)
    expect(fllCyclesToTol(0.5e6, 1e6, kF)).toBe(0)
    expect(fllCyclesToTol(1e8, 1e6, 0)).toBe(Infinity)
    expect(fllCyclesToTol(1e8, 1e6, 1)).toBe(Infinity)
    expect(phaseLoopGain(P)).toBeCloseTo(1 - Math.exp(-2 * Math.PI * 0.08), 15)
  })

  it('phaseLockCycles／settleCycles 的邊界：已在門檻內、門檻小於靜態偏移、g_p 不合法', () => {
    expect(phaseLockCycles(100, 0, 2000, 0.4, 32)).toBe(32) // 已在門檻內：第一個計數的樣本在 n_FL + 1，n_tr = 1
    expect(phaseLockCycles(25000, 3000, 2000, 0.4, 32)).toBe(Infinity)
    expect(phaseLockCycles(25000, 0, 2000, 0, 32)).toBe(Infinity)
    expect(settleCycles(10, 0, 100, 0.4, 512)).toBe(512) // 視窗從 n_FL + 1 開始填，最快 W 個週期
    // n_tr = 1 的分支也要和無雜訊模擬逐週期一致（線性 PD）：θ_0 已在門檻內、視窗短
    for (const o of [{ theta0Fs: 500 }, { theta0Fs: 0, settleWindow: 4, nPl: 4 }, { theta0Fs: 50, settleWindow: 1, nPl: 1 }]) {
      const q = { ...P, pdShape: 'linear' as const, ...o }
      const an = acquisitionAnalytic(q)
      const tl = acquisitionTimeline(q).summary
      expect(tl.phaseLockCycle).toBe(an.nFL + an.nPlRel)
      expect(tl.settleCycle).toBe(an.nFL + an.nSettleRel)
      expect(tl.enableCycle).toBe(an.nEnable)
    }
    expect(settleCycles(25000, 200, 100, 0.4, 512)).toBe(Infinity)
    expect(steadyStateThetaRms(100, 0.4)).toBeCloseTo(100 * Math.sqrt(0.4 / 1.6), 12)
    const b = slipBoundary({ ...P, pdShape: 'linear' })
    expect(b.monotonicFs).toBe(Infinity)
    expect(b.rampLimitFsPerCycle).toBeCloseTo((phaseLoopGain(P) * tVcoFs(P)) / 2, 9)
  })

  it('殘餘頻率誤差超過 Δf_limit：相位迴路拉不回來，一路 slip、永遠不 enable', () => {
    const b = slipBoundary(P)
    const r = acquisitionTimeline({ ...P, fTolHz: 2 * b.dfLimitHz, fUnlockHz: 3 * b.dfLimitHz, df0Hz: 1.5 * b.dfLimitHz, cycles: 4000 })
    expect(r.summary.freqLockCycle).toBe(P.nLd - 1)
    expect(r.summary.slips).toBeGreaterThan(10)
    expect(r.summary.enableCycle).toBe(-1)
    expect(r.summary.lockBlocks).toBe(Infinity)
  })

  it('θ_max 小於靜態偏移 θ_ss 時永遠不 phase lock（封閉式 ∞、模擬 −1）', () => {
    const p = { ...P, thetaMaxFs: 30, cycles: 12000 }
    expect(acquisitionAnalytic(p).nPlRel).toBe(Infinity)
    expect(acquisitionTimeline(p).summary.enableCycle).toBe(-1)
    expect(acquisitionTimeline({ ...p, thetaMaxFs: 60 }).summary.enableCycle).toBeGreaterThan(0)
  })
})

describe('Ch14 §14.6b acquisition：Monte Carlo（固定 seed，CI 對照線性模型）', () => {
  it('E[Δf[n]] = (1 − K_f)^n Δf_0：16 runs 的平均在 4·se 內；同 seed 可重現', () => {
    const mc = acquisitionMonteCarlo({ config: { ...P, sigmaFHz: 2e6, cycles: 400 }, runs: 16, nTrace: 400 })
    expect(mc.fllTrace.maxZ).toBeLessThan(4)
    expect(mc.fllTrace.model[0]).toBe(P.df0Hz)
    const again = acquisitionMonteCarlo({ config: { ...P, sigmaFHz: 2e6, cycles: 400 }, runs: 16, nTrace: 400 })
    expect(again.fllTrace.mean).toEqual(mc.fllTrace.mean)
  })

  it('預設雜訊（σ_f = 0.1 MHz、σ_θ = 100 fs）：16 個 seed 都在 10 個 block 內 enable；σ_f = 0.4 MHz 時 lock 由雜訊決定、晚一千多個週期', () => {
    const mc = acquisitionMonteCarlo({ config: P, runs: 16 })
    expect(mc.enable.failed).toBe(0)
    expect(mc.lockBlocks.every((b) => b === 10)).toBe(true)
    expect(mc.enable.mean).toBeGreaterThan(acquisitionAnalytic(P).nEnable)
    expect(mc.meanSlips).toBe(0)
    const noisy = acquisitionMonteCarlo({ config: { ...P, sigmaFHz: 4e5 }, runs: 16 })
    expect(noisy.freqLock.mean - mc.freqLock.mean).toBeGreaterThan(500)
    // 單一 seed 的結果和 MC 的第一個 run 用的是不同 fork（seed 不同），但同一個 seed 兩次一樣
    const a = runAcquisition(P)
    const b = runAcquisition(P)
    expect(a.summary).toEqual(b.summary)
    expect(a.summary.enableCycle).toBeGreaterThan(0)
    expect(a.summary.lockBlocks).toBe(10)
  })

  it('有雜訊的 lock detect：renewal 近似的平均宣告週期 vs 24 個 seed 的模擬，容許 4·se + 1%（近似本身的系統差）；比「單一視窗 p^N = ½」的點早', () => {
    const kF = fllGain(P)
    for (const sigmaF of [1e5, 4e5]) {
      const est = lockDetectMeanCycle(P.df0Hz, P.fTolHz, kF, sigmaF, P.nLd)
      const mc = acquisitionMonteCarlo({ config: { ...P, sigmaFHz: sigmaF }, runs: 24 })
      expect(mc.freqLock.n).toBe(24)
      const se = (mc.freqLock.hi - mc.freqLock.mean) / 1.96
      expect(Math.abs(mc.freqLock.mean - est), `σ_f = ${sigmaF}: MC ${mc.freqLock.mean} ± ${se} vs ${est}`).toBeLessThanOrEqual(4 * se + 0.01 * est)
      // 單一視窗的中位點：p_in(Δf)^N = ½ ⇒ 真實誤差約 f_tol − 2σ_f；renewal 的平均比這個點早（每個週期都是新的嘗試）
      const zHalf = normInv(Math.pow(0.5, 1 / P.nLd))
      const nHalf = Math.log((P.fTolHz - zHalf * sigmaF) / P.df0Hz) / Math.log(1 - kF)
      expect(est).toBeLessThan(nHalf)
    }
    // 無雜訊極限：每個週期都在窗內時 λ = 1/N_ld，平均落在 n_c + N_ld 附近（比確定性的 n_FL 多約 1 個週期）
    expect(Math.abs(lockDetectMeanCycle(P.df0Hz, P.fTolHz, kF, 1, P.nLd) - (fllCyclesToTol(P.df0Hz, P.fTolHz, kF) + P.nLd))).toBeLessThan(2)
    expect(lockDetectMeanCycle(P.df0Hz, P.fTolHz, 0, 1e5, P.nLd)).toBe(Infinity)
  })

  it('穩態相位 rms = σ_θ √(g_p/(2 − g_p))：線性 PD、無斜坡、長模擬在 10% 內', () => {
    const gp = phaseLoopGain(P)
    const pred = steadyStateThetaRms(P.sigmaThetaFs, gp)
    const r = runAcquisition({ ...P, pdShape: 'linear', df0Hz: 0, sigmaFHz: 0, theta0Fs: 0, cycles: 40000, seed: createRng(7).seed })
    let s = 0
    let n = 0
    for (let k = 2000; k < r.theta.length; k++) {
      s += r.theta[k] * r.theta[k]
      n++
    }
    expect(Math.sqrt(s / n) / pred).toBeGreaterThan(0.9)
    expect(Math.sqrt(s / n) / pred).toBeLessThan(1.1)
  })
})
