import { fireEvent, render, screen } from '@testing-library/react'
import { CodeBlock, Quiz, SymbolTable } from '@/components'

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
