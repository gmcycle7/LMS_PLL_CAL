import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import {
  hasExplicitTarget,
  readScroll,
  restoreScroll,
  restoreTarget,
  scrollKey,
  useScrollMemory,
  writeScroll,
} from './scrollMemory'

let scrollY = 0
let docHeight = 5000
let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  scrollY = 0
  docHeight = 5000
  scrollTo = vi.fn((_x: number, y: number) => {
    scrollY = y
  })
  Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true, writable: true })
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => docHeight, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  sessionStorage.clear()
})

describe('純函式', () => {
  it('key 與讀寫（整數 px；壞值讀成 null）', () => {
    expect(scrollKey('/ch/04')).toBe('lmspll.scroll./ch/04')
    writeScroll('/ch/04', 1234.6)
    expect(sessionStorage.getItem('lmspll.scroll./ch/04')).toBe('1235')
    expect(readScroll('/ch/04')).toBe(1235)
    sessionStorage.setItem('lmspll.scroll./x', 'abc')
    expect(readScroll('/x')).toBeNull()
    expect(readScroll('/none')).toBeNull()
  })
  it('hasExplicitTarget：?a=／?f=／?e= 才算', () => {
    expect(hasExplicitTarget('?a=sec')).toBe(true)
    expect(hasExplicitTarget('f=F-05.1')).toBe(true)
    expect(hasExplicitTarget('?e=E44')).toBe(true)
    expect(hasExplicitTarget('?p=x&seed=1')).toBe(false)
    expect(hasExplicitTarget('')).toBe(false)
  })
  it('restoreTarget：整頁載入或 POP、沒有明確目標、位置夠大才還原；PUSH 不還原', () => {
    writeScroll('/ch/04', 900)
    writeScroll('/ch/05', 10)
    const base = { path: '/ch/04', search: '', navigationType: 'POP', firstLoad: false }
    expect(restoreTarget(base)).toBe(900)
    expect(restoreTarget({ ...base, navigationType: 'PUSH', firstLoad: true })).toBe(900) // 整頁載入
    expect(restoreTarget({ ...base, navigationType: 'PUSH' })).toBeNull()
    expect(restoreTarget({ ...base, navigationType: 'REPLACE' })).toBeNull()
    expect(restoreTarget({ ...base, search: '?a=ch04-x' })).toBeNull()
    expect(restoreTarget({ ...base, path: '/ch/05' })).toBeNull() // 太靠近頁首
    expect(restoreTarget({ ...base, path: '/ch/99' })).toBeNull() // 沒記過
  })
})

describe('restoreScroll', () => {
  it('頁面夠高就（瞬間）捲過去，2 秒內偏掉會拉回來，之後呼叫 onDone', () => {
    const onDone = vi.fn()
    restoreScroll(1200, { onDone })
    vi.advanceTimersByTime(10)
    expect(scrollTo).toHaveBeenCalledWith(0, 1200)
    scrollY = 1100 // 版面晚到，被推開了
    vi.advanceTimersByTime(200)
    expect(scrollY).toBe(1200)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2100)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
  it('頁面一開始不夠高（lazy 還沒長出來）：等它長到夠高才捲', () => {
    docHeight = 900
    restoreScroll(2000)
    vi.advanceTimersByTime(500)
    expect(scrollTo).not.toHaveBeenCalled()
    docHeight = 6000
    vi.advanceTimersByTime(200)
    expect(scrollTo).toHaveBeenCalledWith(0, 2000)
  })
  it('一直長不到：逾時後放棄、呼叫 onDone，不捲', () => {
    docHeight = 900
    const onDone = vi.fn()
    restoreScroll(2000, { onDone })
    vi.advanceTimersByTime(7000)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
  it('使用者自己動了（wheel）：立刻停止，不再把頁面拉回去', () => {
    const onDone = vi.fn()
    restoreScroll(1200, { onDone })
    vi.advanceTimersByTime(10)
    fireEvent.wheel(window)
    expect(onDone).toHaveBeenCalledTimes(1)
    scrollY = 300
    vi.advanceTimersByTime(1000)
    expect(scrollY).toBe(300)
  })
  it('取消函式：停止且只呼叫 onDone 一次', () => {
    const onDone = vi.fn()
    const cancel = restoreScroll(1200, { onDone })
    cancel()
    cancel()
    vi.advanceTimersByTime(1000)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

function Memory() {
  useScrollMemory()
  return null
}
function Nav() {
  const nav = useNavigate()
  return (
    <>
      <Link to="/ch/05">to5</Link>
      <button type="button" onClick={() => nav(-1)}>
        back
      </button>
    </>
  )
}
function App({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Memory />
      <Nav />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  )
}

describe('useScrollMemory', () => {
  it('scroll 事件：記在目前路徑的 key 下', () => {
    render(<App start="/ch/04" />)
    scrollY = 1500
    fireEvent.scroll(window)
    expect(readScroll('/ch/04')).toBe(1500)
  })

  it('整頁載入（重新整理）：還原到記住的位置，還原期間不把 0 寫回去', () => {
    writeScroll('/ch/04', 2400)
    render(<App start="/ch/04" />)
    scrollY = 0
    fireEvent.scroll(window) // PageFrame 換頁時的 scrollTo(0, 0)
    expect(readScroll('/ch/04')).toBe(2400)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(scrollY).toBe(2400)
  })

  it('網址有 ?a=：不還原', () => {
    writeScroll('/ch/04', 2400)
    render(<App start="/ch/04?a=ch04-budget" />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('點連結換章（PUSH）：新頁從頂端，不還原；回到上一頁（POP）：還原', () => {
    writeScroll('/ch/05', 3000) // 之前看過第 5 章
    const { getByText } = render(<App start="/ch/04" />)
    scrollY = 1800
    fireEvent.scroll(window)
    fireEvent.click(getByText('to5'))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(scrollTo).not.toHaveBeenCalled() // PUSH：不還原 ch05 的 3000
    expect(readScroll('/ch/04')).toBe(1800) // 離開時 ch04 的位置還在
    scrollY = 0
    fireEvent.scroll(window)
    expect(readScroll('/ch/05')).toBe(0) // 新頁從頂端開始記
    fireEvent.click(getByText('back'))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(scrollTo).toHaveBeenCalledWith(0, 1800)
    expect(scrollY).toBe(1800)
  })

  it('history.scrollRestoration 設成 manual（讓這裡是唯一的還原者）', () => {
    // jsdom 沒有這個屬性（瀏覽器預設 'auto'）
    Object.defineProperty(window.history, 'scrollRestoration', { value: 'auto', writable: true, configurable: true })
    render(<App start="/ch/04" />)
    expect(window.history.scrollRestoration).toBe('manual')
  })

  it('sessionStorage 不能用：不丟錯', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<App start="/ch/04" />)
    scrollY = 500
    expect(() => fireEvent.scroll(window)).not.toThrow()
    spy.mockRestore()
  })
})
