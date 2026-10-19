import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeQuizId, quizStats, readQuiz } from '@/app/quizProgress'
import { CodeBlock, CodeCompare, Prereq, Quiz, SymbolTable, Tex } from '@/components'

describe('Teaching components', () => {
  it('Quiz reveals verdict and answer', () => {
    render(<Quiz question="w=2, x=-3, y=-9, μ=0.1，下一步 w？" options={[{ label: '1.1' }, { label: '2.9', correct: true }]} answer="2+0.1·(−3)(−3)=2.9" />)
    fireEvent.click(screen.getByLabelText(/2\.9/))
    expect(document.querySelector('.c-quiz-verdict')?.textContent).toBe('答對了！')
    // 結果也會由 sr-only 的 live 區播報
    const live = document.querySelector('.c-quiz .c-sr-only[aria-live="polite"]')!
    expect(live.textContent).toBe('作答結果：答對了')
    fireEvent.click(screen.getByLabelText(/1\.1/))
    expect(live.textContent).toBe('作答結果：再想想看')
    fireEvent.click(screen.getByText('看答案與解析'))
    expect(screen.getByText(/2\+0\.1/)).toBeTruthy()
  })
  it('SymbolTable renders rows', () => {
    const { container } = render(<SymbolTable rows={[{ symbol: 'w_k', meaning: '校正係數', unit: '\\mathrm{fs}' }]} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelector('.katex')).toBeTruthy()
  })
  it('CodeBlock highlights diff-marked lines and escapes HTML', () => {
    const src = '// #region core:x\nconst a = "<script>" // ← 差異\nconst b = 2\n// #endregion'
    const { container } = render(<CodeBlock source={src} region="x" />)
    expect(container.querySelectorAll('.c-code-line')).toHaveLength(2)
    expect(container.querySelectorAll('.c-code-mark')).toHaveLength(1)
    expect(container.innerHTML).not.toContain('<script>')
  })
  it('CodeBlock shows an error for a missing region', () => {
    render(<CodeBlock source="const a = 1" region="missing" />)
    expect(screen.getByRole('alert').textContent).toMatch(/找不到/)
  })
  it('CodeBlock 與 SymbolTable 的捲動區：放得下時不可聚焦，溢位時 tabIndex=0 並有名稱', () => {
    const { container } = render(
      <>
        <CodeBlock source={'const a = 1\n'} />
        <SymbolTable rows={[{ symbol: 'w_k', meaning: '校正係數' }]} />
      </>,
    )
    const pre = container.querySelector('pre.c-code-pre')!
    const wrap = container.querySelector('.table-wrap')!
    expect(pre.getAttribute('tabindex')).toBeNull()
    expect(wrap.getAttribute('tabindex')).toBeNull()
    expect(pre.className).toContain('c-scroll')
    expect(wrap.className).toContain('c-scroll')
  })
})

describe('CodeCompare 分頁標籤', () => {
  const SRC = '// #region core:a\nconst a = 1\n// #endregion\n// #region core:b\nconst b = 2\n// #endregion'

  it('標籤裡的 `$...$` 以 KaTeX 排版，不把 `$` 原樣印在分頁上', () => {
    const { container } = render(
      <CodeCompare
        items={[
          { label: '$2\\times2$ 閉式解 eig2x2', source: SRC, region: 'a' },
          { label: 'Mean-square：$E[\\boldsymbol\\delta\\boldsymbol\\delta^T]$', source: SRC, region: 'b' },
          { label: 'Conventional LMS', source: SRC, region: 'a' },
        ]}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    for (const tab of tabs) expect(tab.textContent).not.toContain('$')
    expect(tabs[0].querySelector('.katex')).toBeTruthy()
    expect(tabs[1].querySelector('.katex')).toBeTruthy()
    expect(tabs[2].querySelector('.katex')).toBeNull()
    expect(container.querySelector('.c-code-tabs .katex-error')).toBeNull()
  })

  it('有數學的分頁給可念的 aria-label；沒有數學的分頁不加（避免與可見文字重複）', () => {
    render(
      <CodeCompare
        items={[
          { label: '$2\\times2$ 閉式解 eig2x2', source: SRC, region: 'a' },
          { label: 'Mean-square：$E[\\boldsymbol\\delta\\boldsymbol\\delta^T]$', source: SRC, region: 'b' },
          { label: '延遲 code（本站 $D$）', source: SRC, region: 'a' },
          { label: 'Conventional LMS', source: SRC, region: 'a' },
        ]}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual([
      '2 乘 2 閉式解 eig2x2',
      'Mean-square：E[delta delta 轉置]',
      '延遲 code（本站 D）',
      null,
    ])
    for (const tab of tabs) expect(tab.getAttribute('aria-label') ?? '').not.toMatch(/[\\$]/)
    // 以可念名稱找得到分頁
    expect(screen.getByRole('tab', { name: '2 乘 2 閉式解 eig2x2' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Conventional LMS' })).toBeTruthy()
  })

  it('切換分頁仍然可用（aria-selected 跟著走）', () => {
    render(
      <CodeCompare
        layout="tabs"
        items={[
          { label: '$a$ 版', source: SRC, region: 'a' },
          { label: '$b$ 版', source: SRC, region: 'b' },
        ]}
      />,
    )
    const [t0, t1] = screen.getAllByRole('tab')
    expect(t0.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(t1)
    expect(t0.getAttribute('aria-selected')).toBe('false')
    expect(t1.getAttribute('aria-selected')).toBe('true')
  })
})

describe('Quiz／Prereq 的無障礙名稱', () => {
  it('Quiz 選項含數學時，單選鈕另給可念的 aria-label（「A.」之後不能是空的）', () => {
    render(
      <Quiz
        question="哪一個會發散？"
        options={[
          { label: <Tex>{'\\mu=0.5'}</Tex>, correct: true },
          { label: '$\\mu\\ge2/x^2$' },
          { label: '純文字選項' },
        ]}
        answer="略"
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['A. mu 等於 0.5', 'B. mu 大於等於 2 除以 x 平方', null])
    // 字串選項裡的 `$...$` 以 KaTeX 排版，不印出 `$`
    const labels = document.querySelectorAll('.c-quiz-opt')
    expect(labels[1].querySelector('.katex')).toBeTruthy()
    expect(labels[1].textContent).not.toContain('$')
    // 純文字選項照舊以 <label> 命名
    expect(screen.getByLabelText(/純文字選項/)).toBe(radios[2])
    fireEvent.click(radios[0])
    expect(document.querySelector('.c-quiz-verdict')?.textContent).toBe('答對了！')
  })

  it('Prereq 標題含數學時，<summary> 另給可念的 aria-label；純文字標題不加', () => {
    const { container } = render(
      <>
        <Prereq title={'期望值 $E[\\cdot]$：做很多次取平均'}>內容</Prereq>
        <Prereq title="chain rule 與下坡法">內容</Prereq>
      </>,
    )
    const [a, b] = Array.from(container.querySelectorAll('summary'))
    expect(a.getAttribute('aria-label')).toBe('先備知識 期望值 E[點]：做很多次取平均')
    expect(b.getAttribute('aria-label')).toBeNull()
  })
})

describe('Quiz 進度回報（src/app/quizProgress.ts）', () => {
  const OPTS = [{ label: '1.1' }, { label: '2.9', correct: true }]
  const tick = () => new Promise((r) => setTimeout(r, 5))

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '#/ch/04')
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('選擇題：選了選項就記 { picked, correct, at }；改選會覆蓋；只看解析不算作答', async () => {
    render(<Quiz id="q-a" question="下一步 w？" options={OPTS} answer="2.9" />)
    fireEvent.click(screen.getByText('看答案與解析'))
    expect(readQuiz('ch04', 'q-a')).toBeNull()
    fireEvent.click(screen.getByLabelText(/1\.1/))
    expect(readQuiz('ch04', 'q-a')).toMatchObject({ picked: 0, correct: false })
    fireEvent.click(screen.getByLabelText(/2\.9/))
    const rec = readQuiz('ch04', 'q-a')!
    expect(rec).toMatchObject({ picked: 1, correct: true })
    expect(typeof rec.at).toBe('number')
    await tick()
    expect(quizStats('ch04')).toEqual({ answered: 1, correct: 1, total: 1 })
  })

  it('計算題（沒有選項）：第一次打開解析就算作答（picked／correct 為 null）', () => {
    render(<Quiz id="q-calc" question="算出 w" answer="2.9" />)
    expect(readQuiz('ch04', 'q-calc')).toBeNull()
    fireEvent.click(screen.getByText('看答案與解析'))
    expect(readQuiz('ch04', 'q-calc')).toMatchObject({ picked: null, correct: null })
    expect(quizStats('ch04')).toMatchObject({ answered: 1, correct: 0 })
  })

  it('沒給 id：由標題與題目文字推出穩定的 id（重新掛載同一題 → 同一筆紀錄）；不同題目 → 不同筆', () => {
    const first = render(<Quiz title="思考題 1" question="題目甲" options={OPTS} answer="x" />)
    fireEvent.click(screen.getByLabelText(/2\.9/))
    first.unmount()
    render(
      <>
        <Quiz title="思考題 1" question="題目甲" options={OPTS} answer="x" />
        <Quiz title="思考題 1" question="題目乙" options={OPTS} answer="x" />
      </>,
    )
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('lmspll.quiz.ch04.'))
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe(`lmspll.quiz.ch04.${makeQuizId('思考題 1', '題目甲')}`)
    expect(keys[0]).not.toContain(makeQuizId('思考題 1', '題目乙'))
  })

  it('total = 頁面上的 Quiz 數；寫進哪一頁取決於網址（pageId）', async () => {
    window.history.replaceState(null, '', '#/ch/09')
    render(
      <>
        <Quiz id="a" question="甲" options={OPTS} answer="x" />
        <Quiz id="b" question="乙" options={OPTS} answer="x" />
        <Quiz id="c" question="丙" answer="x" />
      </>,
    )
    expect(quizStats('ch09').total).toBe(3)
    fireEvent.click(screen.getAllByLabelText(/2\.9/)[0])
    fireEvent.click(screen.getAllByLabelText(/1\.1/)[1])
    expect(quizStats('ch09')).toEqual({ answered: 2, correct: 1, total: 3 })
    expect(quizStats('ch04').answered).toBe(0)
    await tick()
    cleanup()
    // 離開後仍讀得到上次的題數
    expect(quizStats('ch09')).toEqual({ answered: 2, correct: 1, total: 3 })
  })

  it('作答仍照舊運作（localStorage 寫不進去也一樣）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<Quiz id="q" question="題" options={OPTS} answer="x" />)
    fireEvent.click(screen.getByLabelText(/2\.9/))
    expect(document.querySelector('.c-quiz-verdict')?.textContent).toBe('答對了！')
    spy.mockRestore()
  })
})
