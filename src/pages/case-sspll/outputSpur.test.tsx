/**
 * §15.4 殘餘誤差 → 輸出 spur／jitter：S15Output.tsx 的純函式（插圖數字）逐一與獨立重算比對，
 * 並確認 HC-CS.9 的預設值、PVT 角落表與 params.json 的 sensitivity 同定義。
 * 獨立重算用純 Python（python3 -I，不用 numpy）：
 *   HC-CS.9（6.2 fs、16 GHz、|T| 1.2402、peak 2.13 dB）：A_out = 10.596884 fs、spur = −65.47104 dBc、spur_max = −65.21087 dBc
 *   F-CS.23 raw κ = 1：σ_θ = 1.58255 fs／模態，7 個合計 4.18703 fs，小步長閉合式 1.56664 fs
 *   單線：A_1 = 8.515555、A_−7 = 1.216508、GOS m=1 0.336135 fs（rms 6.179、GOS 1.056）
 * 另以 NumPy 2.4（直接用 params.json 的 K_p、K_i 建 T = bL/(aL + bL)，不經 sspll.ts）重算一次：|T(80 MHz)| = 1.240206、T_peak = 2.1275 dB、
 *   HC-CS.9 三個答案到 10⁻⁶、單線表前 7 條（含 ℓ = 49、−47 折回 80／240 MHz）與 jitter 7.4854／7.4846／0.1126 fs、
 *   PVT 角落 |T(80)| 1.399／1.303／1.240／1.190／1.156、|T(548)| 0.247／0.338／0.431／0.547／0.659（+3.68 dB）、
 *   F-CS.23 1.58255／4.18703／1.56664 fs、雜訊 spur −74.32 dBc、variance 條件 σ ≤ 0.8231 fs、N·N_τ ≥ 46376——全部與本檔的期望值一致。
 */
import { cAbs } from '@/simulation/core/complex'
import { F_REF, W1, loopF3dB, loopT, makeL2, nominalLoops, residualLineSpectrum, spurDbcFromToneFs } from '@/simulation/models/sspll'
import { PARAMS, PRED, SIM_CFG } from './data'
import { HANDCALCS } from './handcalcs'
import { F_VCO_HZ, OUTPUT_EXAMPLE, REG_COV_RAW, pureMode1, pvtCornerTable, regCov1diff, steadyNumbers, varianceCondition } from './sections/S15Output'
import { defaultValues } from '@/components'

const close = (a: number, e: number, rel: number, abs = 0, msg = '') => {
  expect(Number.isFinite(a), msg).toBe(true)
  expect(Math.abs(a - e), `${msg} got ${a} want ${e}`).toBeLessThanOrEqual(abs + rel * Math.abs(e))
}

describe('案例頁 §15.4 的插圖數字', () => {
  it('SSPLL: 插圖頻道與 golden：L2 α = 0.02 1diff 收斂到 6.179 fs（印成 6.2）、GOS 1.056 fs；f_vco = 16 GHz 由 Δ = T_vco/8 反推', () => {
    const g = PRED.lms[OUTPUT_EXAMPLE.key1diff]
    expect(g.final_phos_rms_fs.toFixed(3)).toBe('6.179')
    expect(g.final_gos_fs.toFixed(3)).toBe('1.056')
    expect(F_VCO_HZ).toBe(16e9)
    close(1e12 / (8 * SIM_CFG.deltaPs), F_VCO_HZ, 1e-12)
    expect(PRED.lms[OUTPUT_EXAMPLE.keyFx].final_phos_rms_fs).toBeLessThan(g.final_phos_rms_fs)
  })

  it('SSPLL: pureMode1——rms 等於給定值、全部功率在 mode 1 與 7；HC-CS.9 的預設值和 §15.4 的單線表用同一條線（A_1 = √(2W₁)·rms）', () => {
    const d = pureMode1(6.179)
    const mean = d.reduce((a, b) => a + b, 0) / 8
    expect(Math.abs(mean)).toBeLessThan(1e-12)
    close(Math.sqrt(d.reduce((a, v) => a + v * v, 0) / 8), 6.179, 1e-12)
    // DFT：|δ̂₁| = rms/√2，其他模態 0
    for (let m = 0; m < 8; m++) {
      let re = 0
      let im = 0
      for (let k = 0; k < 8; k++) {
        re += d[k] * Math.cos((-2 * Math.PI * m * k) / 8)
        im += d[k] * Math.sin((-2 * Math.PI * m * k) / 8)
      }
      const mag = Math.hypot(re, im) / 8
      if (m === 1 || m === 7) close(mag, 6.179 / Math.SQRT2, 1e-12)
      else expect(mag).toBeLessThan(1e-12)
    }
    const hc9 = HANDCALCS.find((h) => h.id === 'HC-CS.9')!
    const v = defaultValues(hc9)
    const sol = hc9.solve(v)
    close(sol.results[0].value, v.tmag * Math.sqrt(2 * W1) * v.rms, 1e-12)
    close(sol.results[1].value, -65.47104, 1e-6, 1e-9)
    close(sol.results[2].value, -65.21087, 1e-6, 1e-9)
  })

  it('SSPLL: PVT 角落表——K_p、K_i 同乘增益就是 params.json sensitivity 的 L2_gain* 定義（f3dB 204.70／498.77 MHz）；|T(80 MHz)| 在 ×0.6 最大（+1.05 dB）、|T(548 MHz)| 在 ×1.5 多 3.7 dB', () => {
    const rows = pvtCornerTable()
    expect(rows.map((r) => r.g)).toEqual([0.6, 0.8, 1, 1.25, 1.5])
    const L2 = nominalLoops().L2
    const Kp = Number(L2.params.Kp)
    const Ki = Number(L2.params.Ki)
    for (const g of [0.6, 0.8, 1.25, 1.5]) {
      const key = `L2_gain${g}` as keyof typeof PARAMS.sensitivity
      close((loopF3dB(makeL2({ Kp: g * Kp, Ki: g * Ki })) * F_REF) / 1e6, PARAMS.sensitivity[key].f3dB_MHz, 1e-6, 0, key)
    }
    const nom = rows.find((r) => r.g === 1)!
    expect(nom.d80Db).toBe(0)
    expect(nom.d548Db).toBe(0)
    close(nom.t80, cAbs(loopT(L2, 0.02)), 1e-12)
    close(nom.peakDb, PARAMS.loops.L2.T_peak_dB, 2e-3, 0)
    const g06 = rows.find((r) => r.g === 0.6)!
    const g15 = rows.find((r) => r.g === 1.5)!
    expect(g06.d80Db).toBeGreaterThan(1.0)
    expect(g06.d80Db).toBeLessThan(1.1)
    expect(g15.d548Db.toFixed(1)).toBe('3.7')
    for (const r of rows) {
      close(r.d80Db, 20 * Math.log10(r.t80 / nom.t80), 1e-12)
      close(r.d548Db, 20 * Math.log10(r.t548 / nom.t548), 1e-12)
      // 兩個頻道的 spur 位移就是 |T| 的 dB 差（spur 對振幅線性）
      close(spurDbcFromToneFs(F_VCO_HZ, 10, r.t80) - spurDbcFromToneFs(F_VCO_HZ, 10, nom.t80), r.d80Db, 1e-9)
    }
    // 帶內的 spur 只動 ±1.1 dB
    expect(Math.max(...rows.map((r) => Math.abs(r.d80Db)))).toBeLessThan(1.1)
  })

  it('SSPLL: steadyNumbers——raw κ = 1：σ_θ = 1.5825 fs／模態、7 個 4.187 fs、小步長閉合式 1.5666 fs（純 Python）；raw α = 0.137 預測 3.95 fs（golden 最終值 3.6）；1diff α = 0.02 預測 7.24 fs（golden 6.2）', () => {
    const st = steadyNumbers()
    expect(st.N).toBe(512)
    expect(st.tau).toBe(25)
    close(st.kq, Math.sqrt(2 / Math.PI) / 0.2, 1e-12)
    close(st.muRaw, 8 / (25 * st.kq), 1e-12)
    close(1000 * Math.sqrt(st.kappa1.varModePs2[0]), 1.58255, 1e-5, 1e-5)
    close(st.kappa1.rmsFs, 4.18703, 1e-5, 1e-5)
    close(st.closedFs, 1.56664, 1e-5, 1e-5)
    close(st.raw137.rmsFs, 3.952, 2e-3)
    close(PRED.lms[OUTPUT_EXAMPLE.keyRaw137].final_phos_rms_fs, 3.598, 1e-3)
    // 1diff：μ_p 對功率 2α 正規化（NLMS 式）、c[d] = [2α, −α, 0…, −α]
    close(st.mu1d, (st.muRaw * (1 / 8)) / (2 * 0.02), 1e-12)
    expect(regCov1diff(0.02)).toEqual([0.04, -0.02, 0, 0, 0, 0, 0, -0.02])
    expect(REG_COV_RAW[0]).toBe(1 / 8)
    close(st.diff02.rmsFs, 7.236, 2e-3)
    expect(st.diff02.stable).toBe(true)
    expect(st.diff02.tauMaxBlocks).toBeGreaterThan(80)
    expect(st.diff02.tauMaxBlocks).toBeLessThan(95)
  })

  it('SSPLL: varianceCondition——−80 dBc、|T| = 1.2402、16 GHz：σ_θ,1 ≤ 0.82 fs ⇒ N·N_τ ≥ 4.6×10⁴ 拍（預設 12,800 的 3.6 倍）；倒回去 spur 剛好 −80 dBc', () => {
    const t80 = cAbs(loopT(nominalLoops().L2, 0.02))
    const c = varianceCondition(-80, t80)
    close(c.sigmaMaxFs, 0.823, 3e-3)
    close(c.nnTau, 46400, 1e-2)
    expect(c.nnTau / 12800).toBeGreaterThan(3.5)
    expect(c.nnTau / 12800).toBeLessThan(3.7)
    // 倒回去：σ 用 N·N_τ = nnTau 的小步長閉合式，spur 剛好 −80 dBc
    const sigma = 1000 * Math.sqrt((Math.PI * SIM_CFG.sigmaPs ** 2) / (4 * c.nnTau))
    close(spurDbcFromToneFs(F_VCO_HZ, 2 * Math.sqrt(W1) * sigma * t80), -80, 1e-9, 1e-9)
  })
})

describe('案例頁 §15.4 的插圖數字（續）：雜訊 spur 與積分 jitter', () => {
  it('SSPLL: raw、κ = 1、80 MHz 的 mode-1 雜訊 spur = −74.3 dBc（純 Python −74.32）；單線表的輸出積分 jitter 7.49 fs = PHOS 7.49 ⊕ GOS 0.11（純 Python：jitter² = Σ A_out²/2）', () => {
    const t80 = cAbs(loopT(nominalLoops().L2, 0.02))
    const st = steadyNumbers()
    const sigma1 = 1000 * Math.sqrt(st.kappa1.varModePs2[0])
    close(spurDbcFromToneFs(F_VCO_HZ, 2 * Math.sqrt(W1) * sigma1 * t80), -74.32, 1e-3)
    const g = PRED.lms[OUTPUT_EXAMPLE.key1diff]
    const rs = residualLineSpectrum({ deltaFs: pureMode1(g.final_phos_rms_fs), gosErrFs: g.final_gos_fs, alpha: OUTPUT_EXAMPLE.alpha, loop: nominalLoops().L2, fVcoHz: F_VCO_HZ, singleLines: true, lMax: 64, mMax: 64 })
    close(rs.jitterOutFs, 7.485, 1e-3)
    close(rs.jitterOutPhosFs, 7.485, 1e-3)
    close(rs.jitterOutGosFs, 0.113, 5e-3)
    close(Math.hypot(rs.jitterOutPhosFs, rs.jitterOutGosFs), rs.jitterOutFs, 1e-9)
    // 全部殘差在 mode 1 時最強的線就是 ℓ = 1（80 MHz），比 §15.4 內文的 −65 dBc
    expect(rs.lines[0].ell).toBe(1)
    expect(rs.lines[0].spurDbc.toFixed(1)).toBe('-65.5')
    // raw 的發散值 28.39 ps（golden L2|0.02|raw）代進同一條單線公式：Φ = 2π·16 GHz·1.2402·√(2W₁)·28390 fs = 4.878 rad（NumPy），§15.4 印成 ≈4.9
    const gRaw = PRED.lms[OUTPUT_EXAMPLE.keyRaw02]
    expect(gRaw.final_phos_rms_fs).toBe(28390)
    const raw = residualLineSpectrum({ deltaFs: pureMode1(gRaw.final_phos_rms_fs), gosErrFs: gRaw.final_gos_fs, alpha: OUTPUT_EXAMPLE.alpha, loop: nominalLoops().L2, fVcoHz: F_VCO_HZ, singleLines: true, lMax: 8, mMax: 1 })
    close(raw.lines[0].betaRad, 4.878, 1e-3)
    close(raw.lines[0].betaRad, 2 * Math.PI * F_VCO_HZ * t80 * Math.sqrt(2 * W1) * gRaw.final_phos_rms_fs * 1e-15, 1e-9)
    expect(gRaw.final_phos_rms_fs / 1000).toBeGreaterThan(SIM_CFG.deltaPs)
  })
})
