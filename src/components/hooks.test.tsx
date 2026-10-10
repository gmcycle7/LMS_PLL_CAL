import { act, renderHook } from '@testing-library/react'
import { randomSeed, useCases, useDebouncedValue, usePersistentState } from './hooks'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('延遲 ms 後才更新；連續變動只取最後一次', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), { initialProps: { v: 1 } })
    expect(result.current).toBe(1)
    rerender({ v: 2 })
    rerender({ v: 3 })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(3)
  })

  it('ms ≤ 0 時直接回傳最新值', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), { initialProps: { v: 'a' } })
    rerender({ v: 'b' })
    expect(result.current).toBe('b')
  })
})

describe('usePersistentState', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('寫入並在下次掛載時讀回', () => {
    const { result, unmount } = renderHook(() => usePersistentState('lmspll.test.mu', 0.1))
    act(() => result.current[1](0.00001))
    expect(result.current[0]).toBe(0.00001)
    expect(localStorage.getItem('lmspll.test.mu')).toBe('0.00001')
    unmount()
    const again = renderHook(() => usePersistentState('lmspll.test.mu', 0.1))
    expect(again.result.current[0]).toBe(0.00001)
  })

  it('函式型更新與 validate（不合格的舊資料退回預設值）', () => {
    localStorage.setItem('lmspll.test.obj', JSON.stringify({ old: true }))
    const isCfg = (v: unknown): v is { n: number } => !!v && typeof (v as { n?: unknown }).n === 'number'
    const { result } = renderHook(() => usePersistentState('lmspll.test.obj', { n: 1 }, isCfg))
    expect(result.current[0]).toEqual({ n: 1 })
    act(() => result.current[1]((p) => ({ n: p.n + 1 })))
    expect(result.current[0]).toEqual({ n: 2 })
  })

  it('localStorage 丟例外（私密模式 / 停用）時仍可運作', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => usePersistentState('lmspll.test.x', 5))
    expect(result.current[0]).toBe(5)
    act(() => result.current[1](6))
    expect(result.current[0]).toBe(6)
  })

  it('損壞的 JSON 退回預設值', () => {
    localStorage.setItem('lmspll.test.bad', '{not json')
    const { result } = renderHook(() => usePersistentState('lmspll.test.bad', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })
})

describe('useCases', () => {
  const initial = { mu: 0.1, N: 4096 }

  it('最多 3 個 case，新 case 複製目前參數，共用 seed', () => {
    const { result } = renderHook(() => useCases(initial, { seed: 7 }))
    expect(result.current.cases.map((c) => c.id)).toEqual(['A'])
    expect(result.current.seed).toBe(7)

    act(() => result.current.update({ mu: 0.2 }))
    let id: string | null = null
    act(() => {
      id = result.current.addCase()
    })
    expect(id).toBe('B')
    expect(result.current.activeId).toBe('B')
    expect(result.current.active.params).toEqual({ mu: 0.2, N: 4096 })
    act(() => result.current.update({ N: 1024 }))
    expect(result.current.cases.find((c) => c.id === 'A')?.params).toEqual({ mu: 0.2, N: 4096 })
    expect(result.current.cases.find((c) => c.id === 'B')?.params).toEqual({ mu: 0.2, N: 1024 })

    act(() => {
      result.current.addCase()
    })
    expect(result.current.cases.map((c) => [c.id, c.seriesIndex, c.colorVar])).toEqual([
      ['A', 0, '--series-1'],
      ['B', 1, '--series-2'],
      ['C', 2, '--series-3'],
    ])
    expect(result.current.canAdd).toBe(false)
    act(() => {
      id = result.current.addCase()
    })
    expect(id).toBeNull()
  })

  it('移除 case 至少保留一個；移除後可補回空缺的 id；reset 回到只有 A', () => {
    const { result } = renderHook(() => useCases(initial))
    act(() => {
      result.current.addCase()
    })
    act(() => {
      result.current.addCase()
    })
    act(() => result.current.removeCase('B'))
    expect(result.current.cases.map((c) => c.id)).toEqual(['A', 'C'])
    act(() => {
      result.current.addCase()
    })
    expect(result.current.cases.map((c) => c.id)).toEqual(['A', 'B', 'C'])
    act(() => result.current.removeCase('A'))
    act(() => result.current.removeCase('B'))
    act(() => result.current.removeCase('C'))
    expect(result.current.cases.map((c) => c.id)).toEqual(['C'])
    act(() => result.current.reset({ mu: 1, N: 1 }))
    expect(result.current.cases).toHaveLength(1)
    expect(result.current.active.id).toBe('A')
    expect(result.current.active.params).toEqual({ mu: 1, N: 1 })
  })

  it('setSeed 轉為 32-bit 無號整數；randomSeed 範圍正確', () => {
    const { result } = renderHook(() => useCases(initial))
    act(() => result.current.setSeed(-1))
    expect(result.current.seed).toBe(4294967295)
    for (let i = 0; i < 20; i++) {
      const s = randomSeed()
      expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true)
    }
  })
})
