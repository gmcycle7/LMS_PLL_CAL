import { eigSym, eigvals, inv, matAdd, matMul, identity, normCdf, fsToRad, type Matrix } from '@/simulation/core'
import { conventionalStep, fixedXMuMax, fixedXPole, gaussianAlmostSureMuMax, meanPole, meanSquareFactor, meanSquareMuMax, signErrorStep } from '@/simulation/models/lms'
import {
  directionCltPlain,
  directionExact,
  kq,
  linearizationRelError,
  meanGmacEncoding,
  meanQ,
  pPlus,
  signLmsFixedPointEncoding,
  sumMoments,
} from '@/simulation/models/comparator'
import { calLoop, spurBeta, spurDbcBessel, spurDbcSmallAngle, swDtft, swOneSided, swZohDtft, swZohOneSided, P_MIN_3DB } from '@/simulation/models/calNoise'
import {
  delayCriticalGain,
  dualLoopFullMuRange,
  dualLoopSimplifiedMuRange,
  pmFirstOrder,
  pmWithDelay,
  polarityMarginArcsin,
  polarityMarginMod180Bug,
} from '@/simulation/models/stability'
import { corrMatrix, preconditionedModeVar, stepsToDecay } from '@/simulation/models/mimo'
import { buildCodeDistribution, cubicReferenceTable, linearizedFixedPoint, type ErrorModel } from '@/simulation/models/bias'
import { bernoulliMoments, lineSpectrum, TOGGLE_PATTERN_5 } from '@/simulation/models/quantizer'
import { convergenceMuMin, msdAfterBlocks } from '@/simulation/models/optimizer'
import { calPole, toneCorrelation } from '@/simulation/models/polarity'

/**
 * 本頁所有「代入數字」的參考值（附錄 A 範例欄、符號表的例子、單位換算的例子、思考題）。
 * 規則：頁面上的數字一律由這裡呼叫**站內同一套模擬／解析核心**算出，不手寫；
 * refValues.test.ts 再拿這些值與 golden/vectors/*.json（Python 獨立計算）交叉比對。
 */

/** 規格 §12.1 / T13 / T14 的示例條件（勘誤 E30 補齊的前提：unit-RMS code、identity path C = 1、average-mode、σ_η² = 1/N） */
export const T13_SETUP = { fs: 4e9, N: 4096, mu: 10, sigmaV: 100, C: 1 } as const

export interface RefValues {
  t01: { a: number; x: number; w0: number; mu: number; w: number[]; delta: number[]; pole: number }
  fixedX: { x: number; muMax: number; poleAtMu: number }
  stability: { meanMuMax: number; msMuMax: number; asMuMax: number; msMuMaxBpsk: number; meanPoleAt05: number }
  comparator: { s: number; sigma: number; pPlus: number; meanQ: number; kq: number; kqTimesS: number; relDiff: number; linErrAt056: number }
  direction: {
    m: number
    n100: { pos: number; tie: number; neg: number }
    n100Clt: number
    n101: number
    n100PlusRule: number
    sum10000: { mean: number; sd: number; meanAvg: number; sdAvg: number }
  }
  loop: {
    fu: number
    Kq: number
    K: number
    g: number
    p: number
    tau: number
    sigmaW: number
    f3dbExact: number
    f3dbNegLnP: number
    f3dbOneMinusP: number
    enbw: number
    enbwOverF3db: number
    sw1Dc: number
    sigmaFromF3db: number
    gSum: number
    pSum: number
    omega3dbBlock: number
    theta3dbSample: number
    pMin3db: number
    muKMax3db: number
  }
  pm: { g1: { pole: number; pmDeg: number; omegaC: number }; g15: { pmDeg: number; delayMargin: number }; gCrit: number[] }
  polarity: { theta: number; correct: number; bug: number; theta200: number; correct200: number; bug200: number }
  dual: { r: number; b: number; c: number; muFullHi: number; muSimpHi: number }
  mimo: {
    rho: number
    lamMax: number
    lamMin: number
    slowPole: number
    blocks95: number
    preconditionedPole: number
    preconditionedBlocks95: number
    rInvDiag: number
    rInvOff: number
    mDiag: number
    mOff: number
    kqPhysical: number
    physicalSlowPole: number
    physicalBlocks95: number
    modeVarSlow: number
    modeVarFast: number
    paramVar: number
    t18Eig: number[]
  }
  bias: { mse: number; sign0: number; sign1: number; gaussianCode: number; pm1Code: number; ex2: number; ex4: number }
  quant: { f5Power: number; f25Power: number; total: number; f5Peak: number; f25Peak: number; freezePower: number; whiteModel: number; ratioDb: number; stochasticVar: number }
  corner: { ratio: number; eps: number; bMin: number; bCeil: number; kMin: number; kMax: number; B: number; muLo: number; muHi: number }
  spur: { fOut: number; At: number; beta: number; dbc: number; dbcBessel: number; radPerFs: number }
  /** Part A 的兩個手算例：同一筆資料，LMS 與 Sign-Error 各走一步（入門課第 3 課）；有雜訊時的穩態 MSD／MSE（勘誤 E42） */
  partA: {
    step: { a: number; x: number; w0: number; mu: number; lms: number; sign: number }
    msd: { x: number; mu: number; sigmaV: number; px: number; msd: number; mse: number; factor: number }
  }
  /** 單頻相關（§6.1 / §7；T06、T07；勘誤 E46） */
  tone: {
    A: number
    mag: number
    omega: number
    /** T06：φ = +120° */
    phiDeg: number
    C: number
    /** T13 的 μ、K_q 下的 pole 1 − μK_qC */
    pole: number
    /** 反面：comparator 極性接反（C → −1）的 pole */
    reversedPole: number
    /** T07：φ = −120°、D = 4 */
    phiDegDelay: number
    D: number
    CDelay0: number
    CD: number
    CDList: number[]
    /** 反面：φ = 0 卻延遲了 D = 4 */
    misalignedCD: number
  }
  /** §14 的 E[δ_B²]（線性化 iid 模型；golden：msd_after_blocks） */
  msdB: { delta0: number; B: number[]; msd: number[]; floor: number }
  /** §11.1 offset 造成的假 gain bias，與共用 BBPD（type-II，E[q] = 0）時的版本（勘誤 E03） */
  offsetBias: { values: number[]; b: number; a: number; ex: number; ex2: number; varX: number; staticW: number; sharedW: number }
  /** 換算器「試試看」清單要讀者輸入的數字（由 T13 的 K 反推，不手寫） */
  tryIt: {
    gSum: number
    /** μ [fs] 使 g ≈ 0.9（p < 3 − 2√2：沒有 −3 dB 點） */
    muNo3db: number
    gNo3db: number
    /** μ [fs] 使 g ≈ 1.5（p < 0：high-pass） */
    muHighPass: number
    gHighPass: number
    /** σ_v [fs] 小到同一個 μ 的 g 剛超過 2 */
    sigmaUnstable: number
    gUnstable: number
    /** N 改成 1/4 */
    N2: number
  }
  /** 「單位與時間索引」段落的例子 */
  units: {
    fRef: number
    /** 1 fs 在 f_ref 的相位 [rad] */
    radPerFsRef: number
    /** f_out / f_ref */
    divRatio: number
    /** 1 fs 是幾個 output UI */
    uiPerFsOut: number
    samplePeriodPs: number
    blockPeriodUs: number
    /** 例：sample n 落在哪一個 block */
    exampleN: number
    exampleK: number
    exampleBlockStart: number
    exampleBlockEnd: number
    /** commit latency 例：n_c 個 sample 之後才生效 */
    exampleNc: number
    exampleKWithLatency: number
    /** code 尺度改成 k_x 倍（x' = k_x·x）時要維持同一個 g 的 μ' 與 C' */
    scale: { kx: number; muScaled: number; cScaled: number; gScaled: number; gIfMuNotRescaled: number }
    lsbFs: number
    sigmaWLsb: number
    sigmaWRad: number
    /** sum mode 等效步長 μ/N [fs] */
    muSumEquivalent: number
    /** Part A 純量 LMS 的單位例：x 放大 10 倍時 μ_max 縮小 100 倍 */
    lmsScale: { x1: number; muMax1: number; x2: number; muMax2: number }
  }
  /** PSD 正規化的例子（T13 條件） */
  psd: {
    /** block-rate DTFT 形式在 DC [fs²/(rad/block)… 依 σ² = (1/2π)∫S dΩ 的約定] */
    swDtftDc: number
    /** 單邊 per-Hz 在 DC [fs²/Hz] */
    sw1Dc: number
    /** 忘了 2/f_u 的誤差 [dB] */
    dbErrBlock: number
    /** 把 sample-rate 的 DTFT 形式直接當 per-Hz 的誤差 10log10(f_s/2) [dB] */
    dbErrSample: number
    /** ZOH 之後 sample-rate DTFT 形式在 DC */
    swZohDtftDc: number
    /** 兩者的比（= N） */
    zohOverBlockDtft: number
    /** ZOH 之後單邊 per-Hz 在 DC（與 block-rate 的 per-Hz 相同） */
    swZoh1Dc: number
    /** f = f_u/2 處：ZOH 的 droop（功率比） */
    zohDroopAtHalfFu: number
    zohDroopDb: number
    /** 白序列 σ² = 1/N 在 f_u 的單邊 PSD [1/Hz] */
    whiteEta1: number
    /** 例：S_t^(1) = 1e−6 fs²/Hz 的 output timing PSD 對應的 ℒ(f) [dBc/Hz] */
    exampleSt: number
    exampleSphi: number
    exampleL: number
  }
  /** 0/1 位元沒有映射成 ±1（T04 反面測試的條件） */
  encoding: {
    values: number[]
    a: number
    meanX: number
    ex2: number
    meanUpdateAtTruth: number
    meanUpdateBipolar: number
    /** 精確（erf 模型）的固定點偏移 [fs] */
    shiftFs: number
    /** 線性化估計 E[x]/(K_q·E[x²]) [fs] */
    shiftLinear: number
    zeroMeanUpdate: number
  }
}

function round(x: number, d = 12): number {
  return Number(x.toPrecision(d))
}

function computeRefValues(): RefValues {
  // ── T01：手算 LMS（a=3、x=2、w0=1、μ=0.1），δ = a − w（勘誤 E32/E39）
  const t01 = { a: 3, x: 2, w0: 1, mu: 0.1 }
  const w = [t01.w0]
  for (let n = 0; n < 2; n++) {
    const y = t01.a * t01.x
    w.push(conventionalStep({ w: w[n], x: t01.x, y, mu: t01.mu }).w)
  }
  const delta = w.map((wn) => t01.a - wn)

  // ── 隨機 x 的三種穩定界（勘誤 E14、E38）：Gaussian E[x²]=1、E[x⁴]=3
  const stability = {
    meanMuMax: 2 / 1,
    msMuMax: meanSquareMuMax(1, 3),
    asMuMax: gaussianAlmostSureMuMax(1),
    msMuMaxBpsk: meanSquareMuMax(1, 1),
    meanPoleAt05: meanPole(0.5, 1),
  }

  // ── Comparator（§5、T04）
  const s = 1
  const sigma = 100
  const kqv = kq(sigma)
  const mq = meanQ(s, sigma)
  const comparator = {
    s,
    sigma,
    pPlus: pPlus(s, sigma),
    meanQ: mq,
    kq: kqv,
    kqTimesS: kqv * s,
    relDiff: (kqv * s - mq) / mq,
    linErrAt056: linearizationRelError(0.56),
  }

  // ── 方向判斷（勘誤 E02、E07、E18）
  const p = normCdf(s / sigma)
  const n100 = directionExact(p, 100)
  const sm = sumMoments(10000, mq)
  const direction = {
    m: mq,
    n100,
    n100Clt: directionCltPlain(mq, 100),
    n101: directionExact(p, 101).pos,
    n100PlusRule: n100.pos + n100.tie,
    sum10000: { mean: sm.meanSum, sd: sm.sdSum, meanAvg: sm.meanAvg, sdAvg: sm.sdAvg },
  }

  // ── T13 / T14（勘誤 E06、E10、E13、E18、E26–E30）
  const lp = calLoop({ ...T13_SETUP })
  const lpSum = calLoop({ ...T13_SETUP, gmMode: 'sum' })
  const loop = {
    fu: lp.fu,
    Kq: lp.Kq,
    K: lp.K,
    g: lp.g,
    p: lp.p,
    tau: lp.tauBlocks,
    sigmaW: lp.sigmaW,
    f3dbExact: lp.f3dbExact,
    f3dbNegLnP: lp.f3dbNegLnP,
    f3dbOneMinusP: lp.f3dbOneMinusP,
    enbw: lp.enbw,
    enbwOverF3db: lp.enbw / lp.f3dbExact,
    sw1Dc: lp.sw1Dc,
    sigmaFromF3db: Math.sqrt(lp.sw1Dc * lp.f3dbExact),
    gSum: lpSum.g,
    pSum: lpSum.p,
    omega3dbBlock: (2 * Math.PI * lp.f3dbExact) / lp.fu,
    theta3dbSample: (2 * Math.PI * lp.f3dbExact) / T13_SETUP.fs,
    pMin3db: P_MIN_3DB,
    muKMax3db: 1 - P_MIN_3DB,
  }

  // ── Calibration PM（§8.2–8.3、T08、delay_bounds）
  const pm1 = pmFirstOrder(1)
  const pm15 = pmWithDelay(1.5, 0)
  const pm = {
    g1: { pole: pm1.pole, pmDeg: pm1.pmDeg, omegaC: pm1.omegaC },
    g15: { pmDeg: pm15.pmDeg, delayMargin: pm15.delayMarginBlocks },
    gCrit: [0, 1, 2, 3, 4, 5, 6].map(delayCriticalGain),
  }

  // ── Polarity margin（勘誤 E20）
  const polarity = {
    theta: -150,
    correct: polarityMarginArcsin(-150),
    bug: polarityMarginMod180Bug(-150),
    theta200: 200,
    correct200: polarityMarginArcsin(200),
    bug200: polarityMarginMod180Bug(200),
  }

  // ── 雙迴路（勘誤 E19、E31；T09）
  const dual = { r: 0.8, b: 0.2, c: 1, muFullHi: dualLoopFullMuRange(0.8, 0.2, 1).hi, muSimpHi: dualLoopSimplifiedMuRange(0.8, 0.2, 1).hi }

  // ── MIMO / PE（勘誤 E05、E08、E21、E23、E37；T10、T11、T18）
  const rho = 0.99
  const R = corrMatrix(2, rho)
  const eig = eigSym(R).values
  const lamMax = eig[0]
  const lamMin = eig[eig.length - 1]
  const Rinv = inv(R)
  const gamma = 0.5
  const kqPhysical = kq(100)
  const slowPole = 1 - 0.5 * lamMin
  const physicalSlowPole = 1 - 0.5 * kqPhysical * lamMin
  const Nm = 4096
  const scale = gamma / (kqPhysical * kqPhysical * Nm * (2 - gamma)) // Cov(δ) = scale·R⁻¹
  const J: Matrix = [
    [-1, 2],
    [2, -1],
  ]
  const A = matAdd(identity(2), matMul([[0.2, 0], [0, 0.2]], J))
  const t18Eig = eigvals(A)
    .map((z) => z.re)
    .sort((x, y) => y - x)
  const mimo = {
    rho,
    lamMax,
    lamMin,
    slowPole,
    blocks95: stepsToDecay(slowPole),
    preconditionedPole: 1 - gamma,
    preconditionedBlocks95: stepsToDecay(1 - gamma),
    rInvDiag: Rinv[0][0],
    rInvOff: Rinv[0][1],
    mDiag: gamma * Rinv[0][0],
    mOff: gamma * Rinv[0][1],
    kqPhysical,
    physicalSlowPole,
    physicalBlocks95: stepsToDecay(physicalSlowPole),
    modeVarSlow: preconditionedModeVar(gamma, kqPhysical, Nm, lamMin),
    modeVarFast: preconditionedModeVar(gamma, kqPhysical, Nm, lamMax),
    paramVar: scale * Rinv[0][0],
    t18Eig,
  }

  // ── Bias / INL（勘誤 E01、E11）：x ∈ {−2..2} 等機率、a = 1、c_3 = 0.1
  const xs = [-2, -1, 0, 1, 2]
  const ex2 = xs.reduce((acc, x) => acc + x * x, 0) / xs.length
  const ex4 = xs.reduce((acc, x) => acc + x ** 4, 0) / xs.length
  const cubic = cubicReferenceTable({ sigmas: [0, 1], a: 1, c3: 0.1 })
  const bias = {
    mse: 1 + (0.1 * ex4) / ex2,
    sign0: cubic[0].exact,
    sign1: cubic[1].exact,
    gaussianCode: 1 + 0.1 * 3, // unit-variance Gaussian：E[x⁴]/E[x²] = 3
    pm1Code: 1 + 0.1 * 1, // ±1 code：E[x⁴]/E[x²] = 1
    ex2,
    ex4,
  }

  // ── 量化（勘誤 E15、E47、E49；T16、T17）
  const e = TOGGLE_PATTERN_5.map((v) => v - 32.4)
  const lines = lineSpectrum(e)
  const f5 = lines.find((l) => l.k === 1)
  const f25 = lines.find((l) => l.k === 2)
  const quant = {
    f5Power: f5?.power ?? NaN,
    f25Power: f25?.power ?? NaN,
    total: lines.reduce((acc, l) => acc + l.power, 0),
    f5Peak: 2 * (f5?.mag ?? NaN),
    f25Peak: 2 * (f25?.mag ?? NaN),
    freezePower: (32 - 32.4) ** 2,
    whiteModel: 2 / 12,
    ratioDb: 10 * Math.log10((f25?.power ?? NaN) / (f5?.power ?? NaN)),
    stochasticVar: bernoulliMoments(32, 0.4).variance,
  }

  // ── Corner-based μ 區間（勘誤 E16）
  const kMin = 0.004
  const kMax = 0.012
  const B = 12
  const eps = 0.01
  const corner = {
    ratio: 1 / 3,
    eps,
    bMin: Math.log(eps) / Math.log(1 - 1 / 3),
    bCeil: Math.ceil(Math.log(eps) / Math.log(1 - 1 / 3)),
    kMin,
    kMax,
    B,
    muLo: convergenceMuMin(kMin, eps, B),
    muHi: 1 / kMax,
  }

  // ── Spur（§12.4、T15）
  const fOut = 13e9
  const At = 0.5
  const beta = spurBeta(fOut, At, 1)
  const spur = { fOut, At, beta, dbc: spurDbcSmallAngle(beta), dbcBessel: spurDbcBessel(beta), radPerFs: fsToRad(1, fOut) }

  // ── Part A 的手算例：a = 3、x = 1、w0 = 1、μ = 0.2（入門課第 3 課）；固定 x = 2、μ = 0.1、σ_v = 1 的穩態 MSD（勘誤 E42）
  const stepIn = { a: 3, x: 1, w0: 1, mu: 0.2 }
  const stepArgs = { w: stepIn.w0, x: stepIn.x, y: stepIn.a * stepIn.x, mu: stepIn.mu }
  const msdIn = { x: 2, mu: 0.1, sigmaV: 1 }
  const px = msdIn.x * msdIn.x
  const factor = meanSquareFactor(msdIn.mu, px, px * px) // E[(1 − μx²)²]（固定 x：E[x⁴] = x⁴）
  // MSD_{n+1} = factor·MSD_n + μ²P_xσ_v² 的固定點（= μP_xσ_v²/(2P_x − μE[x⁴])）
  const msdSs = (msdIn.mu * msdIn.mu * px * msdIn.sigmaV * msdIn.sigmaV) / (1 - factor)
  const partA = {
    step: { ...stepIn, lms: round(conventionalStep(stepArgs).w), sign: round(signErrorStep(stepArgs).w) },
    msd: { ...msdIn, px, msd: msdSs, mse: px * msdSs + msdIn.sigmaV * msdIn.sigmaV, factor },
  }

  // ── 單頻相關（T06、T07；勘誤 E46）：A = |H| = 1、Ω = π/6
  const toneBase = { A: 1, mag: 1, omega: Math.PI / 6 }
  const rad = (deg: number) => (deg * Math.PI) / 180
  const toneC = toneCorrelation({ ...toneBase, phiRad: rad(120) })
  const toneD = 4
  const tone = {
    ...toneBase,
    phiDeg: 120,
    C: toneC,
    pole: calPole(T13_SETUP.mu, kqv, toneC),
    reversedPole: calPole(T13_SETUP.mu, kqv, -1),
    phiDegDelay: -120,
    D: toneD,
    CDelay0: toneCorrelation({ ...toneBase, phiRad: rad(-120), delay: 0 }),
    CD: toneCorrelation({ ...toneBase, phiRad: rad(-120), delay: toneD }),
    CDList: Array.from({ length: 12 }, (_, D) => toneCorrelation({ ...toneBase, phiRad: rad(-120), delay: D })),
    misalignedCD: toneCorrelation({ ...toneBase, phiRad: 0, delay: toneD }),
  }

  // ── §14 的 E[δ_B²]（T13 的 μ、p、σ_η² = 1/N；δ0 = 20 fs）
  const msdBList = [10, 40]
  const msdB = {
    delta0: 20,
    B: msdBList,
    msd: msdBList.map((B) => msdAfterBlocks(20, lp.p, T13_SETUP.mu, lp.sigmaEta2, B)),
    floor: lp.sigmaW2,
  }

  // ── §11.1 offset bias（勘誤 E03）：x ∈ {0,1,2,3} 等機率、a = 1、b = 0.5
  const offModel: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
  const offDist = buildCodeDistribution({ kind: 'unipolar4' })
  const offEx = offDist.values.reduce((acc, v, i) => acc + v * offDist.probs[i], 0)
  const offEx2 = offDist.values.reduce((acc, v, i) => acc + v * v * offDist.probs[i], 0)
  const offsetBias = {
    values: [...offDist.values],
    b: offModel.b,
    a: offModel.a,
    ex: offEx,
    ex2: offEx2,
    varX: offEx2 - offEx * offEx,
    staticW: linearizedFixedPoint(offModel, offDist, 'none', false).w,
    sharedW: linearizedFixedPoint(offModel, offDist, 'shared_bbpd', false).w,
  }

  // ── 換算器「試試看」：μ 使 g ≈ 0.9、g ≈ 1.5（取整數 fs）；σ_v 小到 g = μ√(2/π)/σ_v 剛超過 2（往下取到 0.1 fs）
  const muNo3db = Math.round(0.9 / lp.K)
  const muHighPass = Math.round(1.5 / lp.K)
  const sigmaUnstable = Math.floor((T13_SETUP.mu * Math.sqrt(2 / Math.PI) * 10) / 2) / 10
  const tryIt = {
    gSum: lpSum.g,
    muNo3db,
    gNo3db: calLoop({ ...T13_SETUP, mu: muNo3db }).g,
    muHighPass,
    gHighPass: calLoop({ ...T13_SETUP, mu: muHighPass }).g,
    sigmaUnstable,
    gUnstable: calLoop({ ...T13_SETUP, sigmaV: sigmaUnstable }).g,
    N2: T13_SETUP.N / 4,
  }

  // ── 單位與時間索引（規格 §0、附錄 B 第 5、9 點；勘誤 E13、E18、E35）
  const fRef = T13_SETUP.fs // 示例：comparator 取樣率 = f_ref = 4 GHz
  const exampleN = 10000
  const exampleK = Math.floor(exampleN / T13_SETUP.N)
  const exampleNc = 2000
  const kx = 16
  const scaled = calLoop({ ...T13_SETUP, mu: T13_SETUP.mu / (kx * kx), C: T13_SETUP.C * kx * kx })
  const notRescaled = calLoop({ ...T13_SETUP, C: T13_SETUP.C * kx * kx })
  const lsbFs = 0.125
  const units = {
    fRef,
    radPerFsRef: fsToRad(1, fRef),
    divRatio: fOut / fRef,
    uiPerFsOut: fOut * 1e-15,
    samplePeriodPs: 1e12 / T13_SETUP.fs,
    blockPeriodUs: (1e6 * T13_SETUP.N) / T13_SETUP.fs,
    exampleN,
    exampleK,
    exampleBlockStart: exampleK * T13_SETUP.N,
    exampleBlockEnd: exampleK * T13_SETUP.N + T13_SETUP.N - 1,
    exampleNc,
    exampleKWithLatency: Math.floor((exampleN - exampleNc) / T13_SETUP.N),
    scale: { kx, muScaled: T13_SETUP.mu / (kx * kx), cScaled: T13_SETUP.C * kx * kx, gScaled: scaled.g, gIfMuNotRescaled: notRescaled.g },
    lsbFs,
    sigmaWLsb: lp.sigmaW / lsbFs,
    sigmaWRad: fsToRad(lp.sigmaW, fOut),
    muSumEquivalent: T13_SETUP.mu / T13_SETUP.N,
    lmsScale: { x1: 2, muMax1: fixedXMuMax(2), x2: 20, muMax2: fixedXMuMax(20) },
  }

  // ── PSD 正規化（勘誤 E09、E28、E29）
  const swDc = swDtft(0, T13_SETUP.mu, lp.p, lp.sigmaEta2)
  const swZohDc = swZohDtft(0, T13_SETUP.N, T13_SETUP.mu, lp.p, lp.sigmaEta2)
  const fHalf = lp.fu / 2
  const droop = swZohOneSided(fHalf, T13_SETUP.fs, T13_SETUP.N, T13_SETUP.mu, lp.p, lp.sigmaEta2) / swOneSided(fHalf, T13_SETUP.mu, lp.p, lp.sigmaEta2, lp.fu)
  const exampleSt = 1e-6
  const exampleSphi = spur.radPerFs * spur.radPerFs * exampleSt
  const psd = {
    swDtftDc: swDc,
    sw1Dc: swOneSided(0, T13_SETUP.mu, lp.p, lp.sigmaEta2, lp.fu),
    dbErrBlock: 10 * Math.log10(lp.fu / 2),
    dbErrSample: 10 * Math.log10(T13_SETUP.fs / 2),
    swZohDtftDc: swZohDc,
    zohOverBlockDtft: swZohDc / swDc,
    swZoh1Dc: swZohOneSided(0, T13_SETUP.fs, T13_SETUP.N, T13_SETUP.mu, lp.p, lp.sigmaEta2),
    zohDroopAtHalfFu: droop,
    zohDroopDb: 10 * Math.log10(droop),
    whiteEta1: (2 / lp.fu) * lp.sigmaEta2,
    exampleSt,
    exampleSphi,
    exampleL: 10 * Math.log10(exampleSphi / 2),
  }

  // ── 0/1 位元未映射（T04 反面測試；code 有 DC 時固定點偏移）
  const encValues = [-1, -0.5, 0, 0.5, 1, 1.5]
  const encProbs = encValues.map(() => 1 / encValues.length)
  const encA = 300
  const zeroMeanValues = [-1, 1]
  const encMeanX = encValues.reduce((acc, v) => acc + v, 0) / encValues.length
  const encEx2 = encValues.reduce((acc, v) => acc + v * v, 0) / encValues.length
  const encoding = {
    values: encValues,
    a: encA,
    meanX: encMeanX,
    ex2: encEx2,
    shiftLinear: encMeanX / (kq(100) * encEx2),
    meanUpdateAtTruth: meanGmacEncoding(encA, encA, encValues, encProbs, 100, 'unipolar'),
    meanUpdateBipolar: meanGmacEncoding(encA, encA, encValues, encProbs, 100, 'bipolar'),
    shiftFs: signLmsFixedPointEncoding(encA, encValues, encProbs, 100, 'unipolar', [-700, 1300]) - encA,
    zeroMeanUpdate: meanGmacEncoding(encA, encA, zeroMeanValues, [0.5, 0.5], 100, 'unipolar'),
  }

  return {
    tryIt,
    partA,
    tone,
    msdB,
    offsetBias,
    units,
    psd,
    encoding,
    t01: { ...t01, w: w.map((v) => round(v)), delta: delta.map((v) => round(v)), pole: fixedXPole(t01.mu, t01.x) },
    fixedX: { x: 2, muMax: fixedXMuMax(2), poleAtMu: fixedXPole(0.1, 2) },
    stability,
    comparator,
    direction,
    loop,
    pm,
    polarity,
    dual,
    mimo,
    bias,
    quant,
    corner,
    spur,
  }
}

let cache: RefValues | null = null

/** 第一次呼叫時計算（a.s. 界需要數值積分，約數十 ms），之後重用。 */
export function refValues(): RefValues {
  if (!cache) cache = computeRefValues()
  return cache
}
