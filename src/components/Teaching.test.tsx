import { fireEvent, render, screen } from '@testing-library/react'
import { CodeBlock, Quiz, SymbolTable } from '@/components'

describe('Teaching components', () => {
  it('Quiz reveals verdict and answer', () => {
    render(<Quiz question="w=2, x=-3, y=-9, μ=0.1，下一步 w？" options={[{ label: '1.1' }, { label: '2.9', correct: true }]} answer="2+0.1·(−3)(−3)=2.9" />)
    fireEvent.click(screen.getByLabelText(/2\.9/))
    expect(screen.getByText('答對了！')).toBeTruthy()
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
})
