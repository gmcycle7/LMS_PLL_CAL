import { act, cleanup, render, renderHook } from '@testing-library/react'
import {
  clearQuizProgress,
  currentPageId,
  makeQuizId,
  pageIdForPath,
  quizKey,
  quizStats,
  readQuiz,
  recordQuiz,
  registerQuiz,
  useQuizStats,
} from './quizProgress'

const tick = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '#/ch/04')
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('id', () => {
  it('pageIdForPath：registry 的 id；不認得的路徑用 slug', () => {
    expect(pageIdForPath('/ch/04')).toBe('ch04')
    expect(pageIdForPath('/ch/11b/')).toBe('ch11b')
    expect(pageIdForPath('/case/sspll')).toBe('case-sspll')
    expect(pageIdForPath('/')).toBe('dashboard')
    expect(pageIdForPath('/x/y z')).toBe('x-y-z')
  })
  it('currentPageId 讀 window.location.hash（忽略 ?query）', () => {
    window.history.replaceState(null, '', '#/ch/05?a=ch05-x')
    expect(currentPageId()).toBe('ch05')
  })
  it('makeQuizId：同樣的標題與題目文字 → 同一個 id；題目不同 → 不同；空白差異不影響', () => {
    const a = makeQuizId('思考題 1', 'w = 2，μ = 0.1')
    expect(a).toBe(makeQuizId('思考題 1', 'w  =  2，μ =\n0.1'))
    expect(a).not.toBe(makeQuizId('思考題 1', 'w = 3，μ = 0.1'))
    expect(a).not.toBe(makeQuizId('思考題 2', 'w = 2，μ = 0.1'))
    expect(a).toMatch(/^[\p{L}\p{N}-]+$/u)
    expect(a).not.toContain('.')
  })
})

describe('recordQuiz／readQuiz', () => {
  it('寫成 { picked, correct, at } 放在 lmspll.quiz.<pageId>.<quizId>', () => {
    expect(recordQuiz('ch04', 'q1', { picked: 2, correct: true, at: 1000 })).toBe(true)
    expect(JSON.parse(localStorage.getItem('lmspll.quiz.ch04.q1')!)).toEqual({ picked: 2, correct: true, at: 1000 })
    expect(quizKey('ch04', 'q1')).toBe('lmspll.quiz.ch04.q1')
    expect(readQuiz('ch04', 'q1')).toEqual({ picked: 2, correct: true, at: 1000 })
  })
  it('預設 at = 現在；同一題再答會覆蓋', () => {
    const t0 = Date.now()
    recordQuiz('ch04', 'q1', { picked: 0, correct: false })
    expect(readQuiz('ch04', 'q1')!.at).toBeGreaterThanOrEqual(t0)
    recordQuiz('ch04', 'q1', { picked: 1, correct: true })
    expect(readQuiz('ch04', 'q1')).toMatchObject({ picked: 1, correct: true })
  })
  it('壞掉的紀錄讀成 null', () => {
    localStorage.setItem('lmspll.quiz.ch04.bad', '{oops')
    localStorage.setItem('lmspll.quiz.ch04.bad2', JSON.stringify({ picked: 1 }))
    expect(readQuiz('ch04', 'bad')).toBeNull()
    expect(readQuiz('ch04', 'bad2')).toBeNull()
    expect(readQuiz('ch04', 'missing')).toBeNull()
  })
  it('localStorage 不能用（setItem 丟錯）：回傳 false，不丟錯', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(recordQuiz('ch04', 'q1', { picked: 0, correct: true })).toBe(false)
    spy.mockRestore()
  })
})

describe('registerQuiz／quizStats', () => {
  it('total = 頁面上登記的題數；answered、correct 由紀錄算出（計算題 correct = null 不算答對）', () => {
    const offs = ['a', 'b', 'c', 'd'].map((id) => registerQuiz('ch04', id))
    recordQuiz('ch04', 'a', { picked: 1, correct: true })
    recordQuiz('ch04', 'b', { picked: 0, correct: false })
    recordQuiz('ch04', 'c', { picked: null, correct: null })
    expect(quizStats('ch04')).toEqual({ answered: 3, correct: 1, total: 4 })
    offs.forEach((f) => f())
  })
  it('卸載後保留上次的題數（別頁的 Dashboard 讀得到分母）；從來沒開過的頁 total = 0', async () => {
    const offs = ['a', 'b', 'c'].map((id) => registerQuiz('ch07', id))
    await tick()
    expect(JSON.parse(localStorage.getItem('lmspll.quizset.ch07')!)).toEqual(['a', 'b', 'c'])
    offs.forEach((f) => f())
    recordQuiz('ch07', 'b', { picked: 0, correct: true })
    expect(quizStats('ch07')).toEqual({ answered: 1, correct: 1, total: 3 })
    expect(quizStats('ch09')).toEqual({ answered: 0, correct: 0, total: 0 })
  })
  it('頁面開著時的題數隨登記變動（例如切學習模式藏起一題）；不在清單裡的舊紀錄不算', async () => {
    const offs = ['a', 'b', 'c'].map((id) => registerQuiz('ch08', id))
    recordQuiz('ch08', 'c', { picked: 0, correct: true })
    expect(quizStats('ch08')).toEqual({ answered: 1, correct: 1, total: 3 })
    offs[2]() // c 被藏起來
    await tick()
    expect(quizStats('ch08')).toEqual({ answered: 0, correct: 0, total: 2 })
    offs[0]()
    offs[1]()
  })
  it('題目清單未知（從沒掛載過）時，answered 退回該頁所有紀錄，total = 0', () => {
    recordQuiz('ch10', 'x', { picked: 1, correct: true })
    recordQuiz('ch10', 'y', { picked: 0, correct: false })
    expect(quizStats('ch10')).toEqual({ answered: 2, correct: 1, total: 0 })
  })
  it('clearQuizProgress：清掉某頁（或全部）的紀錄，不動題目清單', async () => {
    const off = registerQuiz('ch11', 'a')
    await tick()
    recordQuiz('ch11', 'a', { picked: 0, correct: true })
    recordQuiz('ch12', 'a', { picked: 0, correct: true })
    clearQuizProgress('ch11')
    expect(readQuiz('ch11', 'a')).toBeNull()
    expect(readQuiz('ch12', 'a')).not.toBeNull()
    expect(localStorage.getItem('lmspll.quizset.ch11')).not.toBeNull()
    clearQuizProgress()
    expect(readQuiz('ch12', 'a')).toBeNull()
    off()
  })
})

describe('useQuizStats', () => {
  it('作答後自動更新', () => {
    const offs = ['a', 'b'].map((id) => registerQuiz('ch13', id))
    const { result } = renderHook(() => useQuizStats('ch13'))
    expect(result.current).toEqual({ answered: 0, correct: 0, total: 2 })
    act(() => {
      recordQuiz('ch13', 'a', { picked: 0, correct: true })
    })
    expect(result.current).toEqual({ answered: 1, correct: 1, total: 2 })
    offs.forEach((f) => f())
  })
  it('render 輔助：元件裡可以直接用', () => {
    const off = registerQuiz('ch14', 'a')
    function Probe() {
      const s = useQuizStats('ch14')
      return <span data-testid="s">{`${s.answered}/${s.total}`}</span>
    }
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('s').textContent).toBe('0/1')
    act(() => {
      recordQuiz('ch14', 'a', { picked: null, correct: null })
    })
    expect(getByTestId('s').textContent).toBe('1/1')
    off()
  })
})
