import { readFileSync } from 'node:fs'
import { CODE_SOURCES, kappaPhosCode, makeL2, type CodeSource } from '@/simulation/models/sspll'
import { CERT_NF, CERT_TAU, PM_SWEEP, certificateTable, codeCertificate, codeModeLowerBound, interpThreshold, mashKappaMinScan, pmSweepRow } from './codeCertificate'
import { CODE_LOOPS } from './experiments/CodeSourceLab'

/**
 * §10b.8 的全頻道證書（F-CS.29）：TS port vs analysis/sspll/golden/results/dither_certificate.json（tools/dither_certificate.py）。
 * 容差（JSON 的 _meta.tolerances）：同一套式子、同一個 g_min 格點 → 相對 1e-6（PM 的設計兩邊各自求根）；
 * 「下界 ≤ closed form」是不等式，在每個測試的 α 上直接檢查（容許 1e-12）。
 */
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const G: Json = JSON.parse(readFileSync(new URL('../../../analysis/sspll/golden/results/dither_certificate.json', import.meta.url), 'utf8'))
const close = (a: number, e: number, rel: number, abs = 0) => expect(Math.abs(a - e), `${a} ≈ ${e}`).toBeLessThanOrEqual(abs + rel * Math.abs(e))

describe('SSPLL §10b.8 全頻道證書（F-CS.29）vs golden dither_certificate.json', () => {
  const table = certificateTable(CODE_LOOPS)

  it('SSPLL: 常數與 golden 相同（τ、n_f、PM 掃描）', () => {
    expect(CERT_TAU).toBe(G._meta.tau)
    expect(CERT_NF).toBe(G._meta.nf)
    expect(PM_SWEEP).toEqual(G._meta.pm_sweep)
  })

  it('SSPLL: 三個迴路 × 五種 source 的 LB_m、g_min、L_g、狀態與 golden 一致（相對 1e-6）；MASH 的 1 MHz 掃描逐項相同', () => {
    for (const [lk, row] of Object.entries(table)) {
      const g = G.loops[lk]
      close(row.Lg, g.Lg, 1e-9)
      for (const s of CODE_SOURCES) {
        const c = row.certs[s]
        const gc = g.certificates[s]
        close(c.gMin, gc.g_min, 1e-9, 1e-12)
        close(c.fAtMin, gc.f_at_min, 0, 1e-12)
        for (let m = 0; m < 7; m++) close(c.lbModes[m], gc.lb_modes[m], 1e-6, 1e-12)
        expect(c.status, `${lk} ${s}`).toBe(gc.status)
        expect(c.worstMode).toBe(gc.worst_mode)
      }
      close(row.mashScan.min, g.mash_scan.min, 1e-9)
      expect(row.mashScan.fMHzAtMin).toBe(g.mash_scan.f_MHz_at_min)
      expect(row.mashScan.deadMHz).toEqual(g.mash_scan.dead_MHz)
      expect(row.mashScan.invertedMHz).toEqual(g.mash_scan.inverted_MHz)
    }
    // headline：L2（PM 60°）的 MASH、rot4、rot8 全頻道 restoring；PM 45° 的 MASH 證書不成立，掃描找到 98–131 MHz 的 dead zone
    expect(CODE_SOURCES.map((s) => table.L2.certs[s].status)).toEqual(['inconclusive', 'inconclusive', 'restoring-all', 'restoring-all', 'restoring-all'])
    expect(table.L2_pm45.certs.mash.status).toBe('inconclusive')
    expect(table.L2_pm45.mashScan.deadMHz).toEqual([98, 131])
    close(table.L2.certs.mash.lbMin, 0.0606, 0, 1e-4)
  })

  it('SSPLL: 下界真的是下界——每個迴路、source、模態，在 60 個 α（含帶內、谷底、alias 附近）上 LB_m ≤ closed form 的 Re κ_m', () => {
    const alphas = Array.from({ length: 60 }, (_, i) => 0.001 + i * 0.0083)
    for (const [lk, lp] of Object.entries(CODE_LOOPS)) {
      for (const s of ['acc1', 'dq', 'mash', 'rot4'] as CodeSource[]) {
        const lbs = table[lk].certs[s].lbModes
        for (const a of alphas) {
          const km = kappaPhosCode(lp, a, s, 64).kappaM
          for (let m = 0; m < 7; m++) expect(lbs[m], `${lk} ${s} α=${a} m=${m + 1}`).toBeLessThanOrEqual(km[m] + 1e-12)
        }
      }
    }
    // acc1 的下界就是 g_min；rot8 是 1；codeModeLowerBound 的三項逐項重算
    const c = table.L2.certs.mash
    const mash1 = c.gMin * 0.730986474297788 + 0.26901352570221204 - Math.abs(c.h[1]) * 0.14696615047574557 - Math.abs(c.h[2]) * 0.038763691937419464
    close(codeModeLowerBound('mash', 1, c.gMin, c.h), mash1, 1e-9)
    expect(table.L2.certs.acc1.lbMin).toBe(table.L2.certs.acc1.gMin)
    close(table.L2.certs.rot8.lbMin, 1, 0, 1e-12)
  })

  it('SSPLL: PM 掃描——每一列與 golden 一致；下界與掃描最小值隨 PM 單調；內插的門檻（證書 58.5°、dead zone 47.9°）與 golden 的 bisection 差 < 1.5°', () => {
    const rows = PM_SWEEP.map(pmSweepRow)
    rows.forEach((r, i) => {
      const g = G.pm_sweep[i]
      expect(r.pm).toBe(g.pm)
      close(r.Kp, g.Kp, 1e-6)
      close(r.Ki, g.Ki, 1e-6)
      close(r.gMin, g.g_min, 1e-6)
      for (const k of ['mash', 'rot4', 'dq'] as const) close(r.lb[k], g.lb[k], 1e-6, 1e-9)
      expect(r.statusMash).toBe(g.status_mash)
      close(r.mashScan.min, g.mash_scan.min, 1e-6)
      expect(r.mashScan.deadMHz).toEqual(g.mash_scan.dead_MHz)
    })
    const pmCert = interpThreshold(PM_SWEEP, rows.map((r) => r.lb.mash), CERT_TAU)!
    const pmDead = interpThreshold(PM_SWEEP, rows.map((r) => r.mashScan.min), CERT_TAU)!
    close(pmCert, G.thresholds.pm_cert_interp, 1e-5)
    close(pmDead, G.thresholds.pm_dead_interp, 1e-5)
    expect(Math.abs(pmCert - G.thresholds.pm_cert)).toBeLessThan(1.5)
    expect(Math.abs(pmDead - G.thresholds.pm_dead)).toBeLessThan(1.5)
    // 門檻上的證書剛好等於 τ（golden 的 bisection）
    close(codeCertificate(makeL2({ pm: G.thresholds.pm_cert }), 'mash').lbMin, CERT_TAU, 0, 1e-5)
    expect(mashKappaMinScan(makeL2({ pm: 70 })).deadMHz).toBeNull()
    // 頁面文字引用的 golden 二分法門檻（58.5° 與 47.9°）與「差 0.1° 以內」
    const page = readFileSync(new URL('./sections/S10bDither.tsx', import.meta.url), 'utf8')
    expect(page).toContain(`golden 用二分法得到 ${G.thresholds.pm_cert.toFixed(1)}° 與 ${G.thresholds.pm_dead.toFixed(1)}°`)
    expect(Math.max(Math.abs(G.thresholds.pm_cert - G.thresholds.pm_cert_interp), Math.abs(G.thresholds.pm_dead - G.thresholds.pm_dead_interp))).toBeLessThan(0.1)
  }, 60000)
})
