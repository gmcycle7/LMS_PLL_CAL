/**
 * 教學段落用的數字：全部由模型函式即時計算（不手打），而且都很便宜（不跑迴路）。
 * 測試（logic.test.ts）會用 golden vectors 核對 T13 / T14 / T15 的錨點。
 */
import { DsmStream } from '@/simulation/models/dsm'
import { erf } from '@/simulation/core'
import {
  ar1MeanVar,
  calBandwidths,
  delayLoopRadius,
  dtMag2,
  firstOrderResidueStats,
  foldFrequency,
  makeTone,
  pllDesign,
  type1PoleFromBw,
} from '@/simulation/models/unifiedLab'

/** 手算例：一階 DSM、α = 1/4、B = 4 bit（K = 4、M = 16、週期 P = 4） */
export function dsmHandExample(frac = 0.25, bits = 4, length = 8) {
  const st = firstOrderResidueStats(frac, bits)
  const s = new DsmStream({ kind: 'first_order', frac, bits })
  const rows: { n: number; y: number; r: number; x: number }[] = []
  const scale = 1 / Math.sqrt(st.meanSquare) // unit_rms：s = 1/√E[r²]
  for (let n = 0; n < length; n++) {
    const y = s.step()
    rows.push({ n, y, r: s.residue, x: s.residue * scale })
  }
  return { st, rows, scale, xMean: st.mean * scale }
}

/** T13 錨點（iid ±1、H_PD = 1、average GMAC）的一步一步數字 */
export function anchorNumbers(sigmaV = 100, N = 4096, mu = 10, fs = 4e9, a = 3, w0 = 0) {
  const Kq = Math.sqrt(2 / Math.PI) / sigmaV
  const C = 1
  const K = Kq * C
  const g = mu * K
  const p = 1 - g
  const tau = -1 / Math.log(p)
  const sigmaEta2 = 1 / N
  const sigmaW = mu * Math.sqrt(sigmaEta2 / (1 - p * p))
  const fu = fs / N
  const bw = calBandwidths(p, fu)
  const delta0 = a - w0
  // 第一個 block 的平均 G：E[q·x] = erf(δ₀/(√2σ_v))（x = ±1 時 |x| = 1）
  const meanG0 = erf(delta0 / (Math.SQRT2 * sigmaV))
  const w1 = w0 + mu * meanG0
  return { sigmaV, N, mu, fs, a, w0, Kq, C, K, g, p, tau, sigmaEta2, sigmaW, fu, bw, delta0, meanG0, meanG0Lin: K * delta0, w1, snrBlock: (K * delta0) / Math.sqrt(sigmaEta2) }
}

/** 主 PLL：Type-I 由頻寬反解 pole，Type-II 的 K_p / K_i，以及兩者在幾個頻率的 |H_PD|、|T| */
export function pllNumbers(fBw = 2e6, fs = 4e9, zeta = 0.7) {
  const s = Math.sin((Math.PI * fBw) / fs)
  const rho = type1PoleFromBw(fBw, fs)
  const t1 = pllDesign({ pll: 'type1', pllBwHz: fBw, fRefHz: fs, zeta, loopDelay: 0 })
  const t2 = pllDesign({ pll: 'type2', pllBwHz: fBw, fRefHz: fs, zeta, loopDelay: 0 })
  const freqs = [fBw / 100, fBw / 10, fBw, 10 * fBw, 100 * fBw]
  const rows = freqs.map((f) => {
    const om = (2 * Math.PI * f) / fs
    return { f, h1: Math.sqrt(dtMag2(t1.H, om)), t1: Math.sqrt(dtMag2(t1.T, om)), h2: Math.sqrt(dtMag2(t2.H, om)), t2: Math.sqrt(dtMag2(t2.T, om)) }
  })
  return { fBw, fs, zeta, s, r: Math.sqrt(rho), rho, k: 1 - rho, t1, t2, rows }
}

/** spur 的兩個例子：T15（0.5 fs peak @ 13 GHz）與近整數一階 DSM 的封閉式 */
export function spurNumbers(deltaA = 0.1, frac = 1e-4, bits = 20, fs = 4e9, nInt = 3, fBw = 2e6, zeta = 0.7) {
  const t15 = makeTone(90e3, 0.5, 13e9, 'closed-form')
  const st = firstOrderResidueStats(frac, bits)
  const scale = 1 / Math.sqrt(st.meanSquare)
  const f1 = foldFrequency(st.fracEff * fs, fs)
  const des = pllDesign({ pll: 'type2', pllBwHz: fBw, fRefHz: fs, zeta, loopDelay: 0 })
  const tMag = Math.sqrt(dtMag2(des.T, (2 * Math.PI * f1) / fs))
  const amp = deltaA * scale * st.line1 * tMag
  const fOut = (nInt + st.fracEff) * fs
  return { t15, deltaA, frac, st, scale, f1, tMag, amp, fOut, tone: makeTone(f1, amp, fOut, 'closed-form') }
}

/** AR(1) 平均的不確定度：為什麼單一 seed 的 mean w 沒有想像中準 */
export function seNumbers(sigmaW = 0.3992, rho = 0.9202, m = 1000) {
  const naive = sigmaW / Math.sqrt(m)
  const se = Math.sqrt(ar1MeanVar(sigmaW * sigmaW, rho, m))
  const nEffMean = (sigmaW * sigmaW) / (se * se)
  const nEffVar = (m * (1 - rho * rho)) / (1 + rho * rho)
  return { sigmaW, rho, m, naive, se, ratio: se / naive, nEffMean, nEffVar }
}

/**
 * 更新延遲表（d = 0…4）：
 *   gCrit  = 2 sin(π/(4d + 2))：根碰到單位圓的臨界增益；
 *   gBreak = d^d/(d + 1)^{d+1}：z^d(1 − z) 在 (0, 1) 的最大值（位於 z = d/(d + 1)）；g 超過它，兩個實根合併成共軛複根（開始振鈴）。d = 0 時沒有這個點；
 *   rho    = 數值求根的最大根模；rhoHalfCrit = g 取臨界值一半時的 ρ（看「離臨界一半」時還剩多少阻尼）；
 *   pmDeg  = 90° − (2d + 1)·asin(g/2)：校正迴路的 phase margin。
 */
export function delayTable(g: number) {
  return [0, 1, 2, 3, 4].map((d) => {
    const gCrit = 2 * Math.sin(Math.PI / (4 * d + 2))
    return {
      d,
      gCrit,
      gBreak: d === 0 ? NaN : Math.pow(d, d) / Math.pow(d + 1, d + 1),
      rho: delayLoopRadius(g, d),
      rhoHalfCrit: delayLoopRadius(gCrit / 2, d),
      pmDeg: 90 - (2 * d + 1) * ((Math.asin(g / 2) * 180) / Math.PI),
    }
  })
}

/**
 * 「固定點隨 block 擺動」的手算例（§5.2 的 mean-field 段落）：一階 DSM、α = 0.3、B = 20 bit、unit_rms、無 PLL（H_PD = 1）、
 * comparator offset b。residue 用封閉式 r[n] = −((n+1)K mod M)/M 直接算（(n+1)K < 2^53，整數運算精確），
 * 取第 k 個 GMAC block（N 個樣本）自己的 E_k[x]、E_k[x²]，準靜態固定點 w*_k = a + b·E_k[x]/E_k[x²]。
 */
export function blockFixedPointExample(frac = 0.3, bits = 20, N = 4096, b = 20, a = 3, blocks = [0, 32, 64, 96, 127, 128]) {
  const st = firstOrderResidueStats(frac, bits)
  const s = 1 / Math.sqrt(st.meanSquare) // unit_rms：整個週期的 E[x²] = 1
  const rows = blocks.map((k) => {
    let m1 = 0
    let m2 = 0
    for (let n = k * N; n < (k + 1) * N; n++) {
      const x = (-(((n + 1) * st.K) % st.M) / st.M) * s
      m1 += x
      m2 += x * x
    }
    m1 /= N
    m2 /= N
    return { k, xMean: m1, x2Mean: m2, wStar: a + (b * m1) / m2 }
  })
  const wFull = a + b * st.mean * s // 整個週期：E[x²] = 1、E[x] = E[r]·s
  return { frac, bits, N, b, a, st, s, rows, wFull, superPeriodBlocks: st.P / N }
}
