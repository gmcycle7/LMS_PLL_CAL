/**
 * 「手算工具」框的數字：Φ(z) 表、小 |z| 近似與其誤差、常用常數、dB 換算。
 * 所有數值都在這裡由 @/simulation/core 的函式（normCdf、normInv、db10 …）當場算出，頁面上不手打任何數字。
 */
import { texNum } from '@/components'
import { db10, db20, fromDb10, fromDb20, normCdf, normInv } from '@/simulation/core'

/* ───────────────────────── Φ(z) 表 ───────────────────────── */

/** 表格的格距與上限：z = 0, 0.1, …, 3.0（31 格） */
export const PHI_STEP = 0.1
export const PHI_Z_MAX = 3
export const PHI_DECIMALS = 4

/** 四捨五入到小數 places 位（遇到 …5 一律進位，和手算一致；浮點的 0.64415 不會被當成 0.644149…） */
const round = (x: number, places: number): number => {
  const k = 10 ** places
  return Math.round(x * k + 1e-6) / k
}

export interface PhiEntry {
  /** 0 … 30（z = index / 10，避免 0.1 連加的浮點誤差） */
  index: number
  z: number
  /** normCdf(z)，未捨入 */
  phi: number
  /** 表上印的值（4 位小數）；手算內插用的就是它 */
  shown: number
}

/** z = 0 … 3（每 0.1 一格）的 Φ(z)，由 normCdf 計算。 */
export function phiTable(): PhiEntry[] {
  const n = Math.round(PHI_Z_MAX / PHI_STEP)
  return Array.from({ length: n + 1 }, (_, index) => {
    const z = index / 10
    const phi = normCdf(z)
    return { index, z, phi, shown: round(phi, PHI_DECIMALS) }
  })
}

/** 表格排版：列 = 小數第一位（.0 … .9），欄 = 整數部分（0、1、2、3）；z = 3 那一欄只有 3.0。 */
export function phiGrid(): { tenths: number; cells: (PhiEntry | null)[] }[] {
  const table = phiTable()
  return Array.from({ length: 10 }, (_, tenths) => ({
    tenths,
    cells: [0, 1, 2, 3].map((unit) => table[unit * 10 + tenths] ?? null),
  }))
}

/* ───────────────────────── 查表＋線性內插（手算的做法） ───────────────────────── */

export interface PhiLookup {
  z: number
  /** |z|（先用對稱性 Φ(−z) = 1 − Φ(z) 換成正的） */
  az: number
  negative: boolean
  /** |z| 超出表格（> 3）：只能說 Φ 介於 Φ(3) 與 1 之間 */
  outOfTable: boolean
  /** |z| 剛好落在格點上（不必內插） */
  onGrid: boolean
  z0: number
  z1: number
  /** 表上的值（4 位小數） */
  phi0: number
  phi1: number
  /** 內插比例 (|z| − z0) / 0.1 */
  t: number
  /** Φ(z1) − Φ(z0) */
  diff: number
  /** t × diff */
  increment: number
  /** 內插得到的 Φ(|z|)（4 位小數） */
  phiAbs: number
  /** 手算結果 Φ(z) */
  phi: number
  /** normCdf(z) */
  exact: number
  /** 手算 − 精確 */
  error: number
}

/** 用表上的 4 位小數做線性內插，並回傳每個中間量（頁面把它排成「符號式 = 代入 = 結果」）。 */
export function phiLookup(z: number): PhiLookup {
  const table = phiTable()
  const last = table[table.length - 1]
  const az = Math.abs(z)
  const negative = z < 0
  const exact = normCdf(z)
  const outOfTable = az > PHI_Z_MAX
  const i0 = outOfTable ? last.index - 1 : Math.min(last.index - 1, Math.floor(az * 10 + 1e-9))
  const lo = table[i0]
  const hi = table[i0 + 1]
  const t = outOfTable ? 1 : round((az - lo.z) / PHI_STEP, 6)
  const diff = round(hi.shown - lo.shown, PHI_DECIMALS)
  const increment = round(t * diff, 6)
  const phiAbs = round(lo.shown + increment, PHI_DECIMALS)
  const phi = negative ? round(1 - phiAbs, PHI_DECIMALS) : phiAbs
  return {
    z,
    az,
    negative,
    outOfTable,
    onGrid: !outOfTable && (t === 0 || t === 1),
    z0: lo.z,
    z1: hi.z,
    phi0: lo.shown,
    phi1: hi.shown,
    t,
    diff,
    increment,
    phiAbs,
    phi,
    exact,
    error: phi - exact,
  }
}

/* ───────────────────────── 小 |z| 近似 ───────────────────────── */

/** φ(0) = 1/√(2π)：Φ 在 z = 0 的斜率 */
export const PHI_SLOPE_0 = 1 / Math.sqrt(2 * Math.PI)

/** 一階（切線）近似：Φ(z) ≈ 0.5 + z/√(2π) */
export function phiLinear(z: number): number {
  return 0.5 + z * PHI_SLOPE_0
}

/** 多留一項：Φ(z) ≈ 0.5 + (z − z³/6)/√(2π) */
export function phiCubic(z: number): number {
  return 0.5 + (z - (z * z * z) / 6) * PHI_SLOPE_0
}

export interface PhiApproxRow {
  z: number
  exact: number
  linear: number
  /** linear − exact（切線永遠高估，z > 0 時為正） */
  linearError: number
  /** (linear − 0.5)/(exact − 0.5) − 1：2Φ − 1（也就是 E[q]）被高估的比例 */
  slopeOverestimate: number
  cubic: number
  cubicError: number
}

/** 題目指定的三個檢查點 */
export const PHI_APPROX_POINTS = [0.1, 0.3, 0.5] as const

export function phiApproxRows(zs: readonly number[] = PHI_APPROX_POINTS): PhiApproxRow[] {
  return zs.map((z) => {
    const exact = normCdf(z)
    const linear = phiLinear(z)
    const cubic = phiCubic(z)
    return {
      z,
      exact,
      linear,
      linearError: linear - exact,
      slopeOverestimate: (linear - 0.5) / (exact - 0.5) - 1,
      cubic,
      cubicError: cubic - exact,
    }
  })
}

/** 單調遞增函式 f 在 [lo, hi] 上 f(z) = target 的根（二分法）。 */
function bisect(f: (z: number) => number, target: number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (a + b)
    if (f(m) < target) a = m
    else b = m
  }
  return 0.5 * (a + b)
}

/** 切線近似的絕對誤差 0.5 + z/√(2π) − Φ(z) 剛好等於 tol 的 z（誤差隨 z 單調變大，所以 |z| 比它小就合格）。 */
export function phiLinearLimit(tol: number): number {
  return bisect((z) => phiLinear(z) - normCdf(z), tol, 0, 6)
}

/** 2Φ(z) − 1 被切線 √(2/π)·z 高估的比例剛好等於 rel 的 z（即 K_q 線性化「高估 rel」的 s/σ_v）。 */
export function slopeOverestimateLimit(rel: number): number {
  return bisect((z) => (z * PHI_SLOPE_0) / (normCdf(z) - 0.5) - 1, rel, 1e-6, 6)
}

/* ───────────────────────── 常用分位數（反查） ───────────────────────── */

export const QUANTILE_LEVELS = [0.9, 0.95, 0.975, 0.99, 0.999] as const

/** Φ(z) = p 的 z，由 normInv 計算。 */
export function quantileRows(ps: readonly number[] = QUANTILE_LEVELS): { p: number; z: number }[] {
  return ps.map((p) => ({ p, z: normInv(p) }))
}

/* ───────────────────────── 常用常數 ───────────────────────── */

export interface HandConstant {
  key: string
  /** 符號（TeX） */
  tex: string
  value: number
  /** 顯示的有效位數 */
  digits: number
  /** 在哪裡用到（支援 $...$） */
  use: string
}

/** 說明文字裡的數字也由程式算出（不手打） */
const n = (x: number, sig: number): string => texNum(x, sig)

export const HAND_CONSTANTS: HandConstant[] = [
  { key: 'pi', tex: String.raw`\pi`, value: Math.PI, digits: 6, use: String.raw`弧度與角度；離散時間頻率 $\Omega = 2\pi f/f_s$` },
  { key: 'twoPi', tex: String.raw`2\pi`, value: 2 * Math.PI, digits: 6, use: String.raw`時間換相位：$\phi = 2\pi f\,t$；一圈的弧度` },
  { key: 'sqrt2', tex: String.raw`\sqrt{2}`, value: Math.SQRT2, digits: 6, use: String.raw`$\operatorname{erf}(x) = 2\Phi(\sqrt{2}\,x) - 1$；峰值與 RMS 的比` },
  {
    key: 'sqrt2overPi',
    tex: String.raw`\sqrt{2/\pi}`,
    value: Math.sqrt(2 / Math.PI),
    digits: 6,
    use: String.raw`1-bit comparator 的小訊號增益 $K_q = \sqrt{2/\pi}\,/\sigma_v$`,
  },
  {
    key: 'invSqrt2Pi',
    tex: String.raw`1/\sqrt{2\pi}`,
    value: PHI_SLOPE_0,
    digits: 6,
    use: String.raw`$\Phi$ 在 $z=0$ 的斜率：$\Phi(z)\approx 0.5 + z/\sqrt{2\pi}$`,
  },
  { key: 'sqrt2Pi', tex: String.raw`\sqrt{2\pi}`, value: Math.sqrt(2 * Math.PI), digits: 6, use: '上一列的倒數（除以它，等於乘上一列）' },
  { key: 'piOver2', tex: String.raw`\pi/2`, value: Math.PI / 2, digits: 6, use: String.raw`$90^\circ$ 的弧度：相關 $C\propto\cos\theta$ 變號的邊界` },
  {
    key: 'e',
    tex: 'e',
    value: Math.E,
    digits: 6,
    use: String.raw`$e^{-1} = ${n(Math.exp(-1), 4)}$：過了一個時間常數 $\tau$ 還剩 $${n(100 * Math.exp(-1), 3)}\%$`,
  },
  { key: 'ln2', tex: String.raw`\ln 2`, value: Math.LN2, digits: 6, use: String.raw`誤差減半要 $\tau\ln 2$ 步（$\tau = -1/\ln|p|$）` },
  { key: 'ln10', tex: String.raw`\ln 10`, value: Math.LN10, digits: 6, use: String.raw`$\ln x = \ln 10\times\log_{10}x$` },
  { key: 'log10e', tex: String.raw`\log_{10}e`, value: Math.LOG10E, digits: 6, use: String.raw`$\log_{10}x = \log_{10}e\times\ln x$` },
  {
    key: 'log10of2',
    tex: String.raw`\log_{10}2`,
    value: Math.log10(2),
    digits: 6,
    use: String.raw`$2^n = 10^{\,n\log_{10}2}$；振幅每加倍（多 1 bit）是 $20\log_{10}2 = ${n(db20(2), 4)}\ \mathrm{dB}$`,
  },
  {
    key: 'ln005',
    tex: String.raw`\ln 0.05`,
    value: Math.log(0.05),
    digits: 6,
    use: String.raw`收斂到 5%：$k_{95} = \lceil \ln 0.05/\ln|p|\,\rceil$，約 $${n(-Math.log(0.05), 3)}\,\tau$`,
  },
  {
    key: 'radToDeg',
    tex: String.raw`180/\pi`,
    value: 180 / Math.PI,
    digits: 6,
    use: String.raw`rad → deg：乘上它（$1\ \mathrm{rad} = ${n(180 / Math.PI, 4)}^\circ$）`,
  },
  {
    key: 'degToRad',
    tex: String.raw`\pi/180`,
    value: Math.PI / 180,
    digits: 6,
    use: String.raw`deg → rad：乘上它（$1^\circ = ${n(Math.PI / 180, 4)}\ \mathrm{rad}$）`,
  },
]

export function handConstant(key: string): HandConstant {
  const c = HAND_CONSTANTS.find((x) => x.key === key)
  if (!c) throw new Error(`未知的常數：${key}`)
  return c
}

/* ───────────────────────── dB 換算 ───────────────────────── */

export interface DbRow {
  db: number
  /** 功率比 10^(dB/10) */
  power: number
  /** 振幅比 10^(dB/20) */
  amplitude: number
}

export const DB_POINTS = [-20, -10, -6, -3, -1, 0, 1, 3, 6, 10, 20] as const

export function dbRows(points: readonly number[] = DB_POINTS): DbRow[] {
  return points.map((db) => ({ db, power: fromDb10(db), amplitude: fromDb20(db) }))
}

export interface RatioRow {
  /** 倍數（TeX） */
  tex: string
  ratio: number
  /** 當成功率比：10 log10 */
  db10: number
  /** 當成振幅比：20 log10 */
  db20: number
}

export function ratioRows(): RatioRow[] {
  const rows: [string, number][] = [
    [String.raw`\sqrt{2}`, Math.SQRT2],
    ['2', 2],
    ['4', 4],
    ['10', 10],
    ['100', 100],
    [String.raw`1/2`, 0.5],
    [String.raw`1/\sqrt{2}`, Math.SQRT1_2],
  ]
  return rows.map(([tex, ratio]) => ({ tex, ratio, db10: db10(ratio), db20: db20(ratio) }))
}

/** 任意 dB ↔ 倍數（小計算器用） */
export function dbConvert(db: number): DbRow {
  return { db, power: fromDb10(db), amplitude: fromDb20(db) }
}

/* ───────────────────────── 查表內插的逐步 TeX ───────────────────────── */

const fix4 = (x: number): string => x.toFixed(PHI_DECIMALS)

/** 把 phiLookup 的中間量排成「符號式 = 代入數字 = 結果」；每個等號只做一種運算。 */
export function phiLookupSteps(l: PhiLookup): { tex: string; why: string }[] {
  const z = texNum(l.z, 6)
  const az = texNum(l.az, 6)
  const steps: { tex: string; why: string }[] = []
  if (l.outOfTable) {
    steps.push({
      tex: String.raw`${fix4(l.phi1)} = \Phi(${texNum(PHI_Z_MAX, 2)}) < \Phi(${az}) < 1`,
      why: String.raw`$|z| > ${texNum(PHI_Z_MAX, 2)}$ 已經超出表格：只能說 $\Phi$ 介於表上最後一格與 1 之間。需要更多位數時改用計算機的 $\operatorname{erf}$：$\Phi(z) = \tfrac12\bigl[1 + \operatorname{erf}(z/\sqrt2)\bigr]$。`,
    })
  } else if (l.onGrid) {
    const zGrid = l.t === 0 ? l.z0 : l.z1
    steps.push({
      tex: String.raw`\Phi(${texNum(zGrid, 2)}) = ${fix4(l.phiAbs)}`,
      why: '剛好在格點上：直接讀表，不必內插。',
    })
  } else {
    steps.push({
      tex: String.raw`t = \frac{|z| - z_0}{z_1 - z_0} = \frac{${az} - ${texNum(l.z0, 2)}}{${texNum(PHI_STEP, 2)}} = ${texNum(l.t, 4)}`,
      why: String.raw`$|z|$ 落在表上相鄰兩格 $z_0 = ${texNum(l.z0, 2)}$ 與 $z_1 = ${texNum(l.z1, 2)}$ 之間；$t$ 是它離 $z_0$ 的比例。`,
    })
    steps.push({
      tex: String.raw`\Phi(z_1) - \Phi(z_0) = ${fix4(l.phi1)} - ${fix4(l.phi0)} = ${fix4(l.diff)}`,
      why: '讀出兩格的表值，相減得到這一格之間的增加量。',
    })
    steps.push({
      tex: String.raw`\Phi(${az}) \approx \Phi(z_0) + t\,\bigl[\Phi(z_1) - \Phi(z_0)\bigr] = ${fix4(l.phi0)} + ${texNum(l.t, 4)}\times${fix4(l.diff)} = ${fix4(l.phi0)} + ${texNum(l.increment, 4)} = ${fix4(l.phiAbs)}`,
      why: '線性內插：把兩格之間當成直線。先乘、再加，最後取 4 位小數。',
    })
  }
  if (l.negative) {
    steps.push(
      l.outOfTable
        ? {
            tex: String.raw`0 < \Phi(${z}) = 1 - \Phi(${az}) < 1 - ${fix4(l.phi1)} = ${fix4(1 - l.phi1)}`,
            why: String.raw`負的 $z$ 用對稱性 $\Phi(-z) = 1 - \Phi(z)$。`,
          }
        : {
            tex: String.raw`\Phi(${z}) = 1 - \Phi(${az}) = 1 - ${fix4(l.phiAbs)} = ${fix4(l.phi)}`,
            why: String.raw`表只列 $z\ge0$；負的 $z$ 用對稱性 $\Phi(-z) = 1 - \Phi(z)$。`,
          },
    )
  }
  return steps
}
