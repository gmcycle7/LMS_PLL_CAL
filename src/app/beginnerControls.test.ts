import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BEGINNER_CONTROLS, beginnerControlKeys, controlInList, normalizeControlKey } from './beginnerControls'

/** src/chapters 與 src/pages 的原始碼（不含測試），一次讀進來給每個實驗 id 比對 */
function allSources(): string {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(join(process.cwd(), 'src/chapters'))
  walk(join(process.cwd(), 'src/pages'))
  return out.join('\n')
}

describe('Beginner 的精簡參數面板（beginnerControls.ts）', () => {
  it('每個 experimentId 都是原始碼裡真的有的實驗；每張清單 3–5 個 key、正規化後不重複', () => {
    const src = allSources()
    const ids = Object.keys(BEGINNER_CONTROLS)
    expect(ids.length).toBeGreaterThanOrEqual(12)
    for (const id of ids) {
      expect(src.includes(`'${id}'`) || src.includes(`"${id}"`), `實驗 ${id} 不在原始碼裡`).toBe(true)
      const keys = BEGINNER_CONTROLS[id]
      expect(keys.length, id).toBeGreaterThanOrEqual(3)
      expect(keys.length, id).toBeLessThanOrEqual(5)
      const norm = keys.map(normalizeControlKey)
      expect(new Set(norm).size, `${id} 的 key 重複`).toBe(keys.length)
      for (const k of keys) expect(k.trim().length, `${id} 空的 key`).toBeGreaterThan(0)
    }
    // 骨幹路線一定會遇到的幾個
    for (const id of ['intro-playground', 'lms-playground', 'gd-tangent', 'sign-lms-band', 'gmac-residue', 'lr-optimizer']) expect(BEGINNER_CONTROLS[id], id).toBeDefined()
  })

  it('beginnerControlKeys：表裡沒有的實驗回傳 null（全部顯示），原型鏈上的名字不算', () => {
    expect(beginnerControlKeys('lms-playground')).toBe(BEGINNER_CONTROLS['lms-playground'])
    expect(beginnerControlKeys('no-such-experiment')).toBeNull()
    expect(beginnerControlKeys('toString')).toBeNull()
    expect(beginnerControlKeys('constructor')).toBeNull()
  })

  it('normalizeControlKey：全形括號、下標字、底線與空白、大小寫都不影響比對', () => {
    expect(normalizeControlKey('σᵥ（量測雜訊 RMS）')).toBe(normalizeControlKey('σ_v(量測雜訊rms)'))
    expect(normalizeControlKey('w₀（初值）')).toBe(normalizeControlKey('w0(初值)'))
    expect(normalizeControlKey('步數 N')).toBe('步數n')
    expect(normalizeControlKey('REG_GMAC_N[23:0]')).toBe('reggmacn[23:0]')
    // 不同的東西不會被弄成一樣
    expect(normalizeControlKey('N（每 block sample 數）')).not.toBe(normalizeControlKey('N'))
    expect(normalizeControlKey('μ（學習率）')).not.toBe(normalizeControlKey('μ₀（初始步長）'))
  })

  it('controlInList：任一候選名稱（id／ariaLabel／label 可念文字／reg）對上就算；沒有候選就不算', () => {
    const keys = BEGINNER_CONTROLS['lms-playground']
    expect(controlInList(keys, [undefined, 'μ（學習率）', 'mu（學習率）', 'REG_LMS_MU'])).toBe(true)
    expect(controlInList(keys, ['w₀（初始值）', 'REG_LMS_W_INIT'])).toBe(false)
    expect(controlInList(keys, [undefined, null, ''])).toBe(false)
    expect(controlInList([], ['μ（學習率）'])).toBe(false)
    // 標籤隨 Case 變動的控制項用 reg 比對（ComparatorLab）
    expect(controlInList(BEGINNER_CONTROLS['comparator-lab'], ['s（固定誤差）— Case B', 'Behavioral: s = DTC residual (a − w)'])).toBe(true)
  })
})
