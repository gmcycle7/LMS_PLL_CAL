/**
 * Ch10 內文用到的所有數字：一律由 src/simulation/models/mimo.ts 的解析／模擬函式計算，不手寫結果。
 * （頁面上的手算表格、例子數值、比較表都從這裡取。）
 */
import { erf, eigSym, inv, matScale, svd } from '@/simulation/core'
import {
  DEFAULT_RULE,
  analyzeRule,
  buildPlant,
  corrMatrix,
  fdTruncationFactor,
  inspectMatrix,
  kqFromSigma,
  propagateLinearMoments,
  signGmacMean,
  stepsToDecay,
  stepsToDecayReal,
  type Mat,
  type MimoRule,
  type RuleAnalysis,
  type RuleConfig,
} from '@/simulation/models/mimo'

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })

/** 讓 K_q = 1 fs⁻¹ 的 σ_v（「K_q 正規化為 1」） */
export const SIGMA_KQ1 = Math.sqrt(2 / Math.PI)

function sortDesc(xs: number[]): number[] {
  return xs.slice().sort((a, b) => b - a)
}

function realPolesDesc(a: RuleAnalysis): number[] {
  return sortDesc(a.poles.map((z) => z.re))
}

function computeNumbers() {
  // ── §10 開頭：交叉耦合例子 R = [[1, .8], [.8, 1]] ──
  const sigmaV = 100
  const Kq = kqFromSigma(sigmaV)
  const R08 = corrMatrix(2, 0.8)
  const p08 = buildPlant({ mode: 'R', R: R08, sigmaV, N: 4096 })
  const dCoupling = [0, 10]
  const G1lin = 0.8 * Kq * dCoupling[1]
  const G2lin = Kq * dCoupling[1]
  const Gexact = signGmacMean(p08, dCoupling)
  // 單一 sample 的 comparator 平均（圖 comparator-gain）：u₂ = +1 時 s = δ₂ = 10 fs ⇒ E[q | u] = erf(s / (√2 σ_v))，線性近似 K_q s（= G2lin）
  const erfOne = erf(dCoupling[1] / (Math.SQRT2 * sigmaV))
  const muFs = 10
  const w1Shift = muFs * G1lin // w₁ 被推離正確值的量（fs）
  // 手算表：K_q 正規化為 1、μK_q = 0.5 的平均遞迴，δ₀ = (0, 10)
  const p08n = buildPlant({ mode: 'R', R: R08, sigmaV: SIGMA_KQ1, N: 4096 })
  const hand = propagateLinearMoments(p08n, rule({ rule: 'scalar', muKq: 0.5 }), p08n.Jn, dCoupling, 6)!
  const handRows = Array.from({ length: 7 }, (_, k) => ({ k, d1: hand.mean[0][k], d2: hand.mean[1][k] }))
  const eig08 = eigSym(R08).values
  // ── §10.3（審查 R06a）：1-bit 的 K_q 是小訊號增益。Gaussian regressor 的精確平均（F-10.13）÷ 線性式 K_q·Rδ = 1/√(1 + s_δ²)，
  //    s_δ = √(δᵀRδ)/σ_v（第 9 章 F-09.3 的符號）。取 δ = (0, s_δ·σ_v)：R₂₂ = 1 ⇒ δᵀRδ = (s_δ σ_v)²
  const sDeltas = [0.1, 0.3, 1]
  const smallSignalGain = sDeltas.map((sd) => signGmacMean(p08, [0, sd * sigmaV])[1] / (Kq * sd * sigmaV))

  // ── §10.1：ρ = 0.99（K_q 正規化為 1） ──
  const R099 = corrMatrix(2, 0.99)
  const ins099 = inspectMatrix(R099)
  const p099n = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
  const scalar05 = analyzeRule(p099n, rule({ rule: 'scalar', muKq: 0.5 }), p099n.Jn)
  const full05 = analyzeRule(p099n, rule({ rule: 'full', gamma: 0.5 }), p099n.Jn)
  const reg01 = analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), p099n.Jn)
  const regJ = analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }), p099n.Jn)
  const nlms1 = analyzeRule(p099n, rule({ rule: 'nlms', gamma: 1 }), p099n.Jn)
  const diag05 = analyzeRule(p099n, rule({ rule: 'diagonal', gamma: 0.5 }), p099n.Jn)
  const Rinv = inv(R099)
  const Mn05 = full05.Mn as Mat
  const eigMn = eigSym(Mn05).values
  const slow = scalar05.closedPoles![1]
  const fast = scalar05.closedPoles![0]

  // ── §10.3（審查 C01）：步長超過 2/(λ_max+λ_min) 時，名字叫「快」的模式反而最慢（ρ = 0.5、μK_q = 1.2；K_q 正規化為 1） ──
  const pHalf = buildPlant({ mode: 'R', R: corrMatrix(2, 0.5), sigmaV: SIGMA_KQ1, N: 4096 })
  const fastLedMuKq = 1.2
  const fastLedAn = analyzeRule(pHalf, rule({ rule: 'scalar', muKq: fastLedMuKq }), pHalf.Jn)

  // ── §10.3.1（審查 R02）：A_cal 不對稱（非正規）時 F-10.5 只是下界。J_n = [[−1, 2], [0, −1]]、μK_q = 0.5 ⇒ A = [[0.5, 1], [0, 0.5]] ──
  const JnN: Mat = [
    [-1, 2],
    [0, -1],
  ]
  const pNN = buildPlant({ mode: 'J', Jn: JnN, sigmaV: SIGMA_KQ1, N: 4096 })
  const cfgNN = rule({ rule: 'scalar', muKq: 0.5 })
  const anNN = analyzeRule(pNN, cfgNN, JnN)
  const delta0NN = [0, 1]
  const momNN = propagateLinearMoments(pNN, cfgNN, JnN, delta0NN, 12)!
  const lenNN = (k: number) => Math.hypot(momNN.mean[0][k], momNN.mean[1][k])

  // ── E05 / E08：實體 K_q = 0.00797885 fs⁻¹ ──
  const p099 = buildPlant({ mode: 'R', R: R099, sigmaV, N: 4096 })
  const physScalar = analyzeRule(p099, rule({ rule: 'scalar', muKq: 0.5 * Kq }), p099.Jn) // μ = 0.5 fs
  const forgotKqPole = 1 - 0.5 * Kq // M = 0.5R⁻¹（忘了 K_q）
  const physFull = analyzeRule(p099, rule({ rule: 'full', gamma: 0.5 }), p099.Jn)

  // ── §10.1 雜訊：N = 4096、σ_v = 100 fs ──
  const N = 4096
  const fullNoise = physFull
  const scalarNoise = analyzeRule(p099, rule({ rule: 'scalar', muKq: 0.5 }), p099.Jn)
  const regNoise = analyzeRule(p099, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), p099.Jn)
  const cNoise = 0.5 / (Kq * Kq * N * (2 - 0.5))
  // E21：K_q = 1、N = 1 的「每 1/N」變異
  const p099n1 = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 1 })
  const perN = {
    scalar: analyzeRule(p099n1, rule({ rule: 'scalar', muKq: 0.5 }), p099n1.Jn),
    full: analyzeRule(p099n1, rule({ rule: 'full', gamma: 0.5 }), p099n1.Jn),
  }

  // ── §10.2：中央差分截斷與雜訊 ──
  const fdRatios = [0.1, 0.3, 0.5, 1, 2].map((r) => ({
    r,
    gaussian: fdTruncationFactor('gaussian', r),
    pm1: fdTruncationFactor('pm1', r),
    // Ĵ_n 每個元素的標準差（N_J = 4096、R_x,ii = 1）：√(2/N_J)/(2Δ)/K_q = √(2/N_J)/(2 r √(2/π))
    stdNj4096: Math.sqrt(2 / 4096) / (2 * r * Math.sqrt(2 / Math.PI)),
  }))
  const erf03 = erf(0.3 / Math.SQRT2)

  // ── T18 反例 ──
  const J18: Mat = [
    [-1, 2],
    [2, -1],
  ]
  const pJ = buildPlant({ mode: 'J', Jn: J18, sigmaV: SIGMA_KQ1, N: 4096 })
  const t18 = analyzeRule(pJ, rule({ rule: 'scalar', muKq: 0.2 }), J18)
  const t18full = analyzeRule(pJ, rule({ rule: 'full', gamma: 0.5 }), J18)
  const t18reg = analyzeRule(pJ, rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }), J18)
  const eigJ18 = inspectMatrix(J18).eigSym!.values
  const svJ18 = svd(J18).S

  // ── E24：Ĵ ≠ J ──
  const JhatRho = (rh: number) => matScale(corrMatrix(2, rh), -1)
  const e24 = [
    { rhoHat: 0.94, gamma: 0.5, lambdaReg: 0, an: analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0 }), JhatRho(0.94)) },
    { rhoHat: 0.995, gamma: 1, lambdaReg: 0, an: analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }), JhatRho(0.995)) },
    { rhoHat: 0.996, gamma: 1, lambdaReg: 0, an: analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }), JhatRho(0.996)) },
    { rhoHat: 0.996, gamma: 1, lambdaReg: 1e-4, an: analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 1e-4 }), JhatRho(0.996)) },
    { rhoHat: 0.996, gamma: 1, lambdaReg: 1e-3, an: analyzeRule(p099n, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 1e-3 }), JhatRho(0.996)) },
  ].map((x) => ({ ...x, poles: realPolesDesc(x.an), rho: x.an.spectralRadius }))

  // ── Sequential trap：x₁ = x₂（ρ = 1），a = (3, 1)、w₀ = (0, 0) ──
  const p1 = buildPlant({ mode: 'R', R: corrMatrix(2, 1), sigmaV: SIGMA_KQ1, N: 4096 })
  const seqCfg = rule({ rule: 'sequential', gamma: 0.5, seqBlocksPerPhase: 40, seqSweeps: 1 })
  const a = [3, 1]
  const seq = propagateLinearMoments(p1, seqCfg, p1.Jn, a, 80)!
  // δ_k 是第 k 次更新「之後」的值：k = 1…40 來自階段 1（只更新 w₁），k = 41…80 來自階段 2（只更新 w₂）
  const seqRows = [0, 1, 2, 5, 40, 41, 42, 80].map((k) => ({
    k,
    phase: k === 0 ? 0 : k <= 40 ? 1 : 2,
    w1: a[0] - seq.mean[0][k],
    w2: a[1] - seq.mean[1][k],
    sum: seq.mean[0][k] + seq.mean[1][k],
  }))
  // ρ = 0.99：Gauss–Seidel（γ = 1、每 phase 1 block）每個 sweep 收縮 ρ²
  const gs = analyzeRule(p099n, rule({ rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 1000 }), p099n.Jn)
  const gsSweep = Math.pow(gs.spectralRadius, 2)
  const gsBlocks = gs.blocks95
  // 同樣積極的一般 LMS（μK_q = 1）：慢 pole 1 − λ_min = ρ ⇒ 與 Gauss–Seidel 每 block 的收縮率相同
  const scalarMu1 = analyzeRule(p099n, rule({ rule: 'scalar', muKq: 1 }), p099n.Jn)

  // ── 六種規則比較（ρ = .99、σ_v = 100 fs、N = 4096） ──
  const compareCfg: Record<MimoRule, RuleConfig> = {
    scalar: rule({ rule: 'scalar', muKq: 0.5 }),
    diagonal: rule({ rule: 'diagonal', gamma: 0.5 }),
    nlms: rule({ rule: 'nlms', gamma: 1 }),
    full: rule({ rule: 'full', gamma: 0.5 }),
    regularized: rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }),
    sequential: rule({ rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 1000 }),
  }
  const compare = (Object.keys(compareCfg) as MimoRule[]).map((r) => {
    const an = analyzeRule(p099, compareCfg[r], p099.Jn)
    return {
      rule: r,
      cfg: compareCfg[r],
      blocks95: an.blocks95,
      std: an.perParamVar ? Math.sqrt(Math.max(...an.perParamVar)) : null,
      totalVar: an.totalVar,
      rho: an.spectralRadius,
    }
  })

  return {
    sigmaV,
    Kq,
    coupling: { R: R08, eig: eig08, delta: dCoupling, G1lin, G2lin, Gexact, erfOne, muFs, w1Shift, handRows },
    /** 審查 R06a：1-bit comparator 的平均增益 ÷ K_q（Gaussian regressor，F-10.13），對應 s_δ = 0.1、0.3、1 */
    smallSignal: { s: sDeltas, gain: smallSignalGain },
    rho099: {
      R: R099,
      eig: ins099.eigSym!.values,
      vectors: ins099.eigSym!.vectors,
      cond: ins099.cond,
      slow,
      fast,
      blocksScalar: scalar05.blocks95!,
      blocksScalarReal: stepsToDecayReal(slow),
      blocksFull: full05.blocks95!,
      blocksFullReal: stepsToDecayReal(0.5),
      blocksReg: reg01.blocks95!,
      regSlowPole: reg01.closedPoles![1],
      regFastPole: reg01.closedPoles![0],
      regJSlowPole: regJ.closedPoles![1],
      regJBlocks: regJ.blocks95,
      nlmsPoles: nlms1.closedPoles!,
      nlmsBlocks: nlms1.blocks95,
      diagMn: diag05.Mn as Mat,
      Rinv,
      Mn: Mn05,
      eigMn,
      ln005: Math.log(0.05),
      lnSlow: Math.log(slow),
      /** 單一 scalar μ 能做到的最小 max|p_i| = (κ − 1)/(κ + 1)（在 μK_q = 2/(λ_max + λ_min) 時；第 9 章 F-09.7） */
      bestMaxPole: (ins099.cond - 1) / (ins099.cond + 1),
    },
    /** 審查 C01：ρ = 0.5、μK_q = 1.2 ⇒ poles −0.8（λ_max 的快模式）／0.4（λ_min 的慢模式），最慢的是快模式 */
    fastLed: {
      rho: 0.5,
      muKq: fastLedMuKq,
      eig: pHalf.modeValues,
      /** 穩定上限 2/λ_max */
      muMax: 2 / pHalf.modeValues[0],
      /** 換手點 2/(λ_max + λ_min) */
      muCross: 2 / (pHalf.modeValues[0] + pHalf.modeValues[1]),
      fast: fastLedAn.closedPoles![0],
      slow: fastLedAn.closedPoles![1],
      dominant: fastLedAn.spectralRadius,
      blocks: fastLedAn.blocks95!,
      blocksSlowAlone: stepsToDecay(fastLedAn.closedPoles![1]),
    },
    /** 審查 R02：非正規 A 的例子（J-mode、scalar μK_q = 0.5），δ₀ = (0, 1) */
    nonNormal: {
      J: JnN,
      muKq: cfgNN.muKq,
      A: anNN.A as Mat,
      rho: anNN.spectralRadius,
      /** 只看 ρ(A) 的 ⌈ln 0.05/ln ρ⌉（F-10.5） */
      asym: anNN.blocks95Asymptotic!,
      /** 最壞初始方向的 ‖A^k‖₂ 降到 5% 以下且不再超過 */
      blocks: anNN.blocks95!,
      delta0: delta0NN,
      n5: lenNN(5),
      n8: lenNN(8),
      n9: lenNN(9),
    },
    phys: {
      slowPole: physScalar.spectralRadius,
      blocks: physScalar.blocks95!,
      forgotKqPole,
      forgotKqBlocks: stepsToDecay(forgotKqPole),
      fullPole: physFull.spectralRadius,
      fullBlocks: physFull.blocks95!,
      Mphys: physFull.Mphys as Mat,
    },
    noise: {
      N,
      modeVar: fullNoise.modeVar!,
      perParam: fullNoise.perParamVar!,
      c: cNoise,
      ratioStd: Math.sqrt(fullNoise.modeVar![1] / fullNoise.modeVar![0]),
      sqrt199: Math.sqrt(199),
      scalarPerParam: scalarNoise.perParamVar!,
      scalarModeVar: scalarNoise.modeVar!,
      regPerParam: regNoise.perParamVar!,
      regModeVar: regNoise.modeVar!,
      perN: {
        scalarSlow: perN.scalar.closedModeVar![1],
        fullSlow: perN.full.closedModeVar![1],
        scalarTrace: perN.scalar.totalVar!,
        fullTrace: perN.full.totalVar!,
      },
      validity: fullNoise.validityIndex!,
      validityFormula: (2 * 0.5 * Math.PI) / (2 * N * (2 - 0.5)),
    },
    fd: { rows: fdRatios, erf03 },
    t18: {
      J: J18,
      eigJ: eigJ18,
      sv: svJ18,
      A: t18.A as Mat,
      poles: realPolesDesc(t18),
      rho: t18.spectralRadius,
      fullPoles: realPolesDesc(t18full),
      regPoles: realPolesDesc(t18reg),
    },
    e24,
    seq: {
      rows: seqRows,
      a,
      gsSweep,
      gsBlocks,
      /** Gauss–Seidel 平均每個 block 的收縮率 ρ(Φ_sweep)^{1/2}（= ρ） */
      gsPerBlock: gs.spectralRadius,
      /** 只看漸近收縮率 ρ² 的輪數 ln 0.05 / ln ρ²（未含第一輪的範數放大） */
      gsNaiveSweeps: Math.log(0.05) / Math.log(gsSweep),
      /** 第一步把 δ₂ 的誤差複製到 δ₁ 造成的範數放大 √(1 + ρ²) */
      gsNormFactor: Math.sqrt(1 + 0.99 * 0.99),
      scalarMu1Pole: scalarMu1.spectralRadius,
      scalarMu1Blocks: scalarMu1.blocks95,
    },
    compare,
  }
}

export const NUM = computeNumbers()
export type ChapterNumbers = typeof NUM
