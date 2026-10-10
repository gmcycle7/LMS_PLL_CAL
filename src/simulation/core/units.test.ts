import { describe, expect, it } from 'vitest'
import {
  clamp,
  db10,
  db20,
  deg2rad,
  fmt,
  fmtSI,
  fromDb10,
  fromDb20,
  fsToRad,
  isSiPrefixable,
  rad2deg,
  radToFs,
  wrap180,
  wrapPi,
} from '@/simulation/core/units'

describe('units：fmt（有效位數）', () => {
  it.each([
    [0.5039893563146316, 6, '0.503989'],
    [1, 4, '1'],
    [2.5, 4, '2.5'],
    [123456.7, 4, '123500'],
    [1234567, 4, '1.235e6'],
    [999999.6, 4, '1e6'],
    [0.00797885, 4, '0.007979'],
    [7.97885e-5, 4, '7.979e-5'],
    [-3.2e-9, 3, '-3.2e-9'],
    [-93.79873541326022, 4, '-93.8'],
    [976562.5, 7, '976562.5'],
    [1e-4, 4, '0.0001'],
  ])('fmt(%f, %i) = %s', (x, d, s) => expect(fmt(x, d)).toBe(s))

  it('特殊值', () => {
    expect(fmt(NaN)).toBe('NaN')
    expect(fmt(Infinity)).toBe('∞')
    expect(fmt(-Infinity)).toBe('-∞')
    expect(fmt(0)).toBe('0')
    expect(fmt(-0)).toBe('0')
    expect(fmt(Math.PI)).toBe('3.142')
  })
})

describe('units：fmtSI（SI 前綴）', () => {
  it.each([
    [976562.5, 'Hz', '976.6 kHz'],
    [13e9, 'Hz', '13 GHz'],
    [4e9, 'Hz', '4 GHz'],
    [12.9e3, 'Hz', '12.9 kHz'],
    [999.96, 'Hz', '1 kHz'],
    [1.5e-12, 's', '1.5 ps'],
    [1e-15, 's', '1 fs'],
    [1e-18, 's', '0.001 fs'],
    [250e-9, 's', '250 ns'],
    [-3.3e-6, 's', '-3.3 µs'],
    [4.084070449666731e-5, 'rad', '40.84 µrad'],
    [0.025, 'V', '25 mV'],
    [5e15, 'Hz', '5000 THz'],
    [0, 's', '0 s'],
    [0.399, 'fs', '0.399 fs'],
    [-93.8, 'dBc', '-93.8 dBc'],
    [-120.5, 'dBc/Hz', '-120.5 dBc/Hz'],
    [3.2, 'dB', '3.2 dB'],
    [32.4, 'LSB', '32.4 LSB'],
    [2.5, '', '2.5'],
  ])('fmtSI(%f, %s) = %s', (x, u, s) => expect(fmtSI(x, u)).toBe(s))

  it('位數參數、NaN 與單位判斷', () => {
    expect(fmtSI(976562.5, 'Hz', 7)).toBe('976.5625 kHz')
    expect(fmtSI(NaN, 'Hz')).toBe('NaN Hz')
    expect(isSiPrefixable('Hz')).toBe(true)
    expect(isSiPrefixable('fs')).toBe(false)
    expect(isSiPrefixable('dBc')).toBe(false)
  })
})

describe('units：dB、角度與換算', () => {
  it('db10 / db20 / fromDb', () => {
    expect(db10(100)).toBe(20)
    expect(db20(0.5)).toBeCloseTo(-6.020599913279624, 14)
    expect(db20(-2)).toBe(db20(2))
    expect(db10(0)).toBe(-Infinity)
    expect(Number.isNaN(db10(-1))).toBe(true)
    expect(fromDb10(-30)).toBeCloseTo(1e-3, 17)
    expect(fromDb20(db20(0.123))).toBeCloseTo(0.123, 15)
  })

  it('wrap180 折返到 (−180, 180]', () => {
    expect(wrap180(-180)).toBe(180)
    expect(wrap180(180)).toBe(180)
    expect(wrap180(540)).toBe(180)
    expect(wrap180(-540)).toBe(180)
    expect(wrap180(190)).toBe(-170)
    expect(wrap180(-190)).toBe(170)
    expect(wrap180(359.5)).toBe(-0.5)
    expect(wrap180(-120)).toBe(-120)
    expect(wrap180(720)).toBe(0)
    expect(Object.is(wrap180(-0), 0)).toBe(true)
    expect(Object.is(wrap180(-360), 0)).toBe(true)
  })

  it('wrapPi 折返到 (−π, π]', () => {
    expect(wrapPi(-Math.PI)).toBe(Math.PI)
    expect(wrapPi(Math.PI)).toBe(Math.PI)
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 14)
    expect(wrapPi(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 14)
    expect(wrapPi(0.3)).toBe(0.3)
  })

  it('deg2rad / rad2deg / clamp', () => {
    expect(deg2rad(180)).toBe(Math.PI)
    expect(rad2deg(Math.PI / 2)).toBe(90)
    expect(rad2deg(deg2rad(-120))).toBeCloseTo(-120, 13)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.3, 0, 1)).toBe(0.3)
    expect(Number.isNaN(clamp(NaN, 0, 1))).toBe(true)
    expect(() => clamp(0, 1, 0)).toThrow()
  })

  it('fs ↔ rad：0.5 fs @ 13 GHz → β = 2π f t = 4.0841e-5 rad，窄頻 PM 單邊 spur 20log10(β/2) ≈ −93.80 dBc（mpmath）', () => {
    const beta = fsToRad(0.5, 13e9)
    expect(Math.abs(beta - 4.084070449666731e-5) / 4.084070449666731e-5).toBeLessThan(1e-15)
    expect(db20(beta / 2)).toBeCloseTo(-93.79873541326022, 12)
    expect(radToFs(beta, 13e9)).toBeCloseTo(0.5, 14)
    // 1 rad @ 4 GHz = 1/(2π·4e9) s = 39788.735772973836 fs
    expect(radToFs(1, 4e9)).toBeCloseTo(39788.735772973836, 9)
  })
})
