import { fireEvent, render, screen } from '@testing-library/react'
import { Callout, CodeCompare, HandCalc, MetricTable, Quiz, SymbolTable } from '@/components'
import { handcalcById } from '@/app/handcalcs'

const SRC = '// #region core:a\nconst a = 1\n// #endregion\n// #region core:b\nconst b = 2\n// #endregion\n// #region core:c\nconst c = 3\n// #endregion'

describe('Tabs 模式：CodeCompare', () => {
  const setup = () =>
    render(
      <CodeCompare
        layout="tabs"
        items={[
          { label: 'A 版', source: SRC, region: 'a' },
          { label: 'B 版', source: SRC, region: 'b' },
          { label: 'C 版', source: SRC, region: 'c' },
        ]}
      />,
    )

  it('tablist / tab / tabpanel：aria-selected、roving tabindex，tab 與 panel 互相指到對方', () => {
    setup()
    const tabs = screen.getAllByRole('tab')
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    tabs.forEach((t, i) => {
      expect(t.getAttribute('aria-controls')).toBe(panels[i].id)
      expect(panels[i].getAttribute('aria-labelledby')).toBe(t.id)
    })
  })

  it('← → 循環移動並選取、焦點跟著走；Home／End 跳到頭尾', () => {
    setup()
    const list = screen.getByRole('tablist')
    const tabs = () => screen.getAllByRole('tab')
    tabs()[0].focus()
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[1])
    fireEvent.keyDown(list, { key: 'End' })
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[2])
    fireEvent.keyDown(list, { key: 'ArrowRight' }) // 循環回第一個
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowLeft' }) // 往前循環到最後一個
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('不相關的按鍵與帶修飾鍵的方向鍵不處理', () => {
    setup()
    const list = screen.getByRole('tablist')
    fireEvent.keyDown(list, { key: 'a' })
    fireEvent.keyDown(list, { key: 'ArrowRight', ctrlKey: true })
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
  })
})

describe('Tabs 模式：HandCalc 的手算模式分頁', () => {
  it('兩個分頁共用一個 tabpanel；方向鍵切換並選取', () => {
    render(<HandCalc def={handcalcById('HC-00.1')!} />)
    const tabs = screen.getAllByRole('tab')
    const panel = screen.getByRole('tabpanel')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id)
    expect(tabs[1].getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id)
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1'])
    tabs[0].focus()
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[1])
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[1].id)
    expect(screen.getByText('對答案')).toBeTruthy() // 切到「自己算算看」
  })
})

describe('Quiz：radiogroup', () => {
  it('radiogroup 以題目命名；選項是原生 radio（同一個 name，Tab 只停一個）', () => {
    render(<Quiz question="w=2 時下一步 w 是多少？" options={[{ label: '1.1' }, { label: '2.9', correct: true }]} answer="略" />)
    const group = screen.getByRole('radiogroup', { name: 'w=2 時下一步 w 是多少？' })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(group.contains(radios[0])).toBe(true)
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1)
    fireEvent.click(radios[1])
    expect((radios[1] as HTMLInputElement).checked).toBe(true)
  })
})

describe('Callout：note／alert 以標題命名', () => {
  it('有標題：role=note、aria-labelledby 指到標題', () => {
    render(<Callout kind="warn">內容</Callout>)
    expect(screen.getByRole('note', { name: '注意' })).toBeTruthy()
  })
  it('自訂標題含數學時仍以標題命名；danger 是 alert', () => {
    render(
      <>
        <Callout title="假設：$\mu>0$">一</Callout>
        <Callout kind="danger" title="發散">
          二
        </Callout>
      </>,
    )
    const note = screen.getByRole('note')
    const title = note.querySelector('.c-callout-title')!
    expect(note.getAttribute('aria-labelledby')).toBe(title.id)
    expect(screen.getByRole('alert', { name: '發散' })).toBeTruthy()
  })
  it('title={null}：沒有標題就不指 aria-labelledby', () => {
    render(<Callout title={null}>只有內容</Callout>)
    expect(screen.getByRole('note').hasAttribute('aria-labelledby')).toBe(false)
  })
})

describe('表格：caption 與 scope', () => {
  it('SymbolTable：caption（可念形式）、欄標題 scope=col、符號欄是 scope=row', () => {
    const { container } = render(<SymbolTable title="本章符號 $\mu$" rows={[{ symbol: 'w_k', meaning: '係數', unit: 'fs' }]} />)
    const table = container.querySelector('table')!
    expect(table.querySelector('caption')?.textContent).toBe('符號表：本章符號 mu')
    expect(table.querySelector('caption')?.className).toContain('c-sr-only')
    expect([...table.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(1)
    expect(screen.getByRole('table', { name: '符號表：本章符號 mu' })).toBeTruthy()
  })
  it('MetricTable：沒給 caption 時有視覺隱藏的預設標題；給了就用給的；欄標題 scope=col', () => {
    const rows = [{ name: 'P', value: 0.5 }]
    const a = render(<MetricTable rows={rows} />)
    expect(a.container.querySelector('caption')?.className).toContain('c-sr-only')
    expect(a.container.querySelector('caption')?.textContent).toBe('指標表')
    expect([...a.container.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    a.unmount()
    const b = render(<MetricTable rows={rows} caption="比較結果" />)
    expect(b.container.querySelector('caption')?.textContent).toBe('比較結果')
    expect(b.container.querySelector('caption')?.className).not.toContain('c-sr-only')
  })
})
