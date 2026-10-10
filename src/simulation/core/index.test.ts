import { describe, expect, it } from 'vitest'
import * as core from '@/simulation/core'

describe('core barrel（@/simulation/core）', () => {
  it('匯出所有模組的主要 API', () => {
    const names = [
      // complex
      'c', 'cAdd', 'cMul', 'cDiv', 'cAbs', 'cExpj', 'cSqrt',
      // rng
      'createRng', 'deriveSeed',
      // special
      'erf', 'erfc', 'erfcx', 'normPdf', 'normCdf', 'normInv', 'lgamma', 'betaIncReg', 'binomPmf', 'binomCdf', 'binomSf',
      'studentTCdf', 'studentTInv',
      // poly
      'polyval', 'polyvalC', 'polyRoots', 'polyFromRoots',
      // linalg
      'identity', 'zeros', 'transpose', 'matMul', 'matVec', 'matAdd', 'matSub', 'matScale', 'inv', 'solve', 'det',
      'trace', 'eigSym', 'eigvals', 'svd', 'cond', 'spectralRadius', 'pinvReg', 'pinv', 'cholesky',
      // stats
      'mean', 'variance', 'std', 'rms', 'quantile', 'histogram', 'meanCI', 'wilsonCI', 'autocorr', 'effectiveSampleSize',
      // units
      'fmt', 'fmtSI', 'db10', 'db20', 'wrap180', 'deg2rad', 'rad2deg', 'clamp', 'fsToRad', 'radToFs',
    ]
    const exported = core as unknown as Record<string, unknown>
    for (const n of names) expect(typeof exported[n], n).toBe('function')
  })

  it('跨模組整合：R 的特徵分解 + 格式化', () => {
    const { values } = core.eigSym([
      [1, 0.99],
      [0.99, 1],
    ])
    expect(values.map((v) => core.fmt(v, 4))).toEqual(['1.99', '0.01'])
    expect(core.fmtSI(core.normCdf(0.01), '', 6)).toBe('0.503989')
  })
})
