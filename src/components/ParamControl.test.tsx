import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ParamControl, SelectControl, ToggleControl, type ParamControlProps } from './ParamControl'
import { Tex } from './Tex'

function setup(props: Partial<ParamControlProps> = {}) {
  const onChange = vi.fn()
  const utils = render(<ParamControl label="μ 學習率" value={0.1} onChange={onChange} min={0} max={1} step={0.01} unit="fs" {...props} />)
  const input = screen.getByLabelText('μ 學習率') as HTMLInputElement
  const slider = screen.getByRole('slider') as HTMLInputElement
  return { onChange, input, slider, ...utils }
}

/** 受控版本：模擬父元件把 onChange 的值寫回 value */
function Controlled(props: Omit<ParamControlProps, 'value' | 'onChange'> & { initial: number; spy: (v: number) => void }) {
  const { initial, spy, ...rest } = props
  const [v, setV] = useState(initial)
  return (
    <>
      <ParamControl
        {...rest}
        value={v}
        onChange={(x) => {
          spy(x)
          setV(x)
        }}
      />
      <button type="button" onClick={() => setV(0.25)}>
        preset
      </button>
      <output data-testid="value">{v}</output>
    </>
  )
}

describe('ParamControl', () => {
  it("輸入 '0.00001' 會呼叫 onChange(0.00001)（不受滑桿步長 0.01 限制）", () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '0.00001' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(0.00001)
    expect(input.value).toBe('0.00001')
  })

  it('科學記號 1e-5 也被接受，且受控更新後保留使用者的寫法', () => {
    const spy = vi.fn()
    render(<Controlled label="μ" min={0} max={1} step={0.01} initial={0.1} spy={spy} />)
    const input = screen.getByLabelText('μ') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1e-5' } })
    expect(spy).toHaveBeenCalledWith(1e-5)
    expect(screen.getByTestId('value').textContent).toBe('0.00001')
    expect(input.value).toBe('1e-5')
  })

  it('超出範圍時顯示「超出合法範圍 [0, 1]」且預設不套用', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/超出合法範圍 \[0, 1\]/)).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('clampOnBlur：離開欄位時夾回範圍並套用', () => {
    const { onChange, input } = setup({ clampOnBlur: true })
    fireEvent.change(input, { target: { value: '-3' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/超出合法範圍/).textContent).toContain('離開欄位時夾回範圍')
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(0)
    expect(input.value).toBe('0')
  })

  it('allowOutOfRange：仍套用超出範圍的值並標示僅供探索', () => {
    const { onChange, input } = setup({ allowOutOfRange: true })
    fireEvent.change(input, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith(2)
    expect(screen.getByText(/僅供探索/)).toBeTruthy()
  })

  it('無法解析的文字顯示警告，離開欄位時還原', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.getByText('不是有效的數字')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input.value).toBe('0.1')
    expect(screen.queryByText('不是有效的數字')).toBeNull()
  })

  it('整數參數：小數顯示「必須為整數」', () => {
    const { onChange, input } = setup({ integer: true, min: 1, max: 65536, step: 1, value: 4096 })
    fireEvent.change(input, { target: { value: '4096.5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('必須為整數')).toBeTruthy()
  })

  it('滑桿改變時呼叫 onChange 並同步數字欄', () => {
    const spy = vi.fn()
    render(<Controlled label="μ" min={0} max={1} step={0.01} initial={0.1} spy={spy} />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.37' } })
    expect(spy).toHaveBeenCalledWith(0.37)
    expect((screen.getByLabelText('μ') as HTMLInputElement).value).toBe('0.37')
  })

  it('log 滑桿以 log10 對應，取 3 位有效數字', () => {
    const { onChange, slider } = setup({ log: true, min: 1e-6, max: 1e-1, value: 1e-3 })
    expect(Number(slider.min)).toBe(-6)
    expect(Number(slider.max)).toBe(-1)
    expect(Number(slider.value)).toBeCloseTo(-3, 12)
    expect(slider.getAttribute('aria-valuetext')).toBe('0.001 fs')
    fireEvent.change(slider, { target: { value: '-3.5' } })
    // python: float('%.3g' % 10**-3.5) = 0.000316
    expect(onChange).toHaveBeenCalledWith(0.000316)
  })

  it('外部值改變（preset）時更新輸入框', () => {
    render(<Controlled label="μ" min={0} max={1} step={0.01} initial={0.1} spy={vi.fn()} />)
    fireEvent.click(screen.getByText('preset'))
    expect((screen.getByLabelText('μ') as HTMLInputElement).value).toBe('0.25')
  })

  it('顯示單位、合法範圍、hint 與 Hardware Reg', () => {
    setup({ hint: '越大收斂越快', reg: 'REG_GMAC_N[15:0]' })
    expect(screen.getByText('REG_GMAC_N[15:0]')).toBeTruthy()
    expect(screen.getByText('越大收斂越快')).toBeTruthy()
    expect(screen.getByText(/合法範圍 \[0, 1\] fs/)).toBeTruthy()
    expect(screen.getByText('fs')).toBeTruthy()
  })

  it('reg 說明裡的 `$...$` 以 KaTeX 顯示（三種控制項都是）；沒有 `$` 的暫存器名稱原樣輸出', () => {
    const reg = '開迴路（$H\\equiv1$）每個 block 乘上 $1-1/N_\\tau$'
    const { container } = render(
      <>
        <ParamControl label="N_tau" value={25} onChange={() => {}} min={2} max={500} reg={reg} />
        <SelectControl label="迴路" value="L1" onChange={() => {}} options={['L1', 'L2'] as const} reg={reg} />
        <ToggleControl label="raw" value onChange={() => {}} reg={reg} />
        <ParamControl label="N" value={64} onChange={() => {}} min={1} max={4096} reg="REG_GMAC_N[15:0]" />
      </>,
    )
    const regs = Array.from(container.querySelectorAll('.c-param-reg'))
    expect(regs).toHaveLength(4)
    for (const el of regs.slice(0, 3)) {
      expect(Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent)).toEqual(['H\\equiv1', '1-1/N_\\tau'])
      expect(el.querySelector('.katex-error')).toBeNull()
      expect(el.textContent).not.toContain('$')
    }
    expect(regs[3].textContent).toBe('REG_GMAC_N[15:0]')
    expect(regs[3].querySelector('.katex')).toBeNull()
  })
})

describe('SelectControl / ToggleControl', () => {
  it('SelectControl 回傳原本的數值型別', () => {
    const onChange = vi.fn()
    render(
      <SelectControl
        label="Bits"
        value={6}
        onChange={onChange}
        options={[
          { value: 4, label: '4-bit' },
          { value: 6, label: '6-bit' },
          { value: 8, label: '8-bit' },
        ]}
      />,
    )
    const sel = screen.getByLabelText('Bits') as HTMLSelectElement
    expect(sel.selectedOptions[0].textContent).toBe('6-bit')
    fireEvent.change(sel, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith(8)
  })

  it('SelectControl 接受純值陣列', () => {
    const onChange = vi.fn()
    render(<SelectControl label="Window" value="hann" onChange={onChange} options={['hann', 'rect'] as const} />)
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '1' } })
    expect(onChange).toHaveBeenCalledWith('rect')
  })

  it('ToggleControl', () => {
    const onChange = vi.fn()
    render(<ToggleControl label="Dither" value={false} onChange={onChange} />)
    const sw = screen.getByRole('switch') as HTMLInputElement
    expect(sw.checked).toBe(false)
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  // 技術審查 R12 的版面回歸：.c-param-meta 是 flex 容器，hint 若不包成單一元素，
  // 「文字 + 行內公式 + 文字」會變成三個 flex item（公式自己佔一行，句子被拆成三段）。
  it('hint 含行內公式時，整段包在同一個元素裡（Toggle 與 Select 都是；字串與 JSX 兩種寫法都是）', () => {
    const text = '兩個參數共用同一個 code，零延遲相關係數 $\\rho$ 的 regressor 當抽象例子'
    const { container } = render(
      <>
        <ToggleControl label="雙參數" value={false} onChange={() => {}} hint={text} />
        <SelectControl label="Window" value="hann" onChange={() => {}} options={['hann', 'rect'] as const} hint={text} />
        <ToggleControl
          label="JSX"
          value={false}
          onChange={() => {}}
          hint={
            <>
              前半句 <em>中間</em> 後半句
            </>
          }
        />
      </>,
    )
    const metas = Array.from(container.querySelectorAll('.c-toggle > .c-param-meta, .c-select > .c-param-meta'))
    expect(metas).toHaveLength(3)
    for (const meta of metas) {
      // flex 容器只有一個子節點（沒有直接掛在容器下的文字節點或公式）
      expect(meta.childNodes).toHaveLength(1)
      expect((meta.firstChild as Element).tagName).toBe('SPAN')
      expect((meta.firstChild as Element).className).toBe('c-param-note')
    }
    for (const meta of metas.slice(0, 2)) {
      const note = meta.firstElementChild!
      // 文字、KaTeX、文字三段都在同一個 span 裡，順序不變
      expect(note.childNodes).toHaveLength(3)
      expect(note.childNodes[0].textContent).toBe('兩個參數共用同一個 code，零延遲相關係數 ')
      expect((note.childNodes[1] as Element).querySelector('annotation')?.textContent).toBe('\\rho')
      expect(note.childNodes[2].textContent).toBe(' 的 regressor 當抽象例子')
    }
    expect(metas[2].firstElementChild!.textContent).toBe('前半句 中間 後半句')
    // 沒有 hint 時不產生空的說明列
    const none = render(<ToggleControl label="無說明" value onChange={() => {}} />)
    expect(none.container.querySelector('.c-param-meta')).toBeNull()
  })
})

describe('無障礙名稱：TeX 轉成可念的文字（不含 `\\` 或 `$`）', () => {
  /** 掃整棵樹：所有 aria-label／title／aria-valuetext／<option> 都不含 TeX 原始碼 */
  function rawTexNames(root: HTMLElement): string[] {
    const bad: string[] = []
    for (const el of Array.from(root.querySelectorAll('*'))) {
      for (const a of ['aria-label', 'title', 'aria-valuetext']) {
        const v = el.getAttribute(a)
        if (v && /[\\$]/.test(v)) bad.push(`${a}=${v}`)
      }
      if (el.tagName === 'OPTION' && /[\\$]/.test(el.textContent ?? '')) bad.push(`option=${el.textContent}`)
    }
    return bad
  }

  it('滑桿的 aria-label 與 aria-valuetext：標籤與單位裡的 `$...$` 念成 sigma v、fs 的負 1 次方', () => {
    const { container } = render(
      <>
        <ParamControl label="$\sigma_v$（comparator 前雜訊）" value={0.5} onChange={() => {}} min={0.01} max={10} log unit="$\mathrm{fs}^{-1}$" />
        <ParamControl label="$\mu$（Case A）" value={0.1} onChange={() => {}} min={0} max={1} step={0.01} unit="$\times$" />
      </>,
    )
    const [log, lin] = screen.getAllByRole('slider')
    expect(log.getAttribute('aria-label')).toBe('sigma v（comparator 前雜訊）（滑桿，log 刻度）')
    expect(log.getAttribute('aria-valuetext')).toBe('0.5 fs 的負 1 次方')
    expect(lin.getAttribute('aria-label')).toBe('mu（Case A）（滑桿）')
    expect(lin.getAttribute('aria-valuetext')).toBe('0.1 乘')
    expect(rawTexNames(container)).toEqual([])
  })

  it('ariaLabel 屬性與非字串標籤：輸入框的 aria-label 也是可念形式', () => {
    const { container } = render(
      <>
        <ParamControl label={<span>J11</span>} ariaLabel="$J_{11}$（回授）" value={1} onChange={() => {}} min={0} max={2} />
        <ParamControl label="$\rho_j$" ariaLabel="斜率 $\rho_j$" value={1} onChange={() => {}} min={0} max={2} />
      </>,
    )
    expect(screen.getByLabelText('J 11（回授）')).toBeTruthy()
    expect(screen.getByLabelText('斜率 rho j')).toBeTruthy()
    expect(rawTexNames(container)).toEqual([])
  })

  it('SelectControl：aria-label 與 <option> 文字、ToggleControl：aria-label', () => {
    const { container } = render(
      <>
        <SelectControl
          label="迴路"
          ariaLabel="迴路 $L$"
          value={1}
          onChange={() => {}}
          options={[
            { value: 1, label: '$\\mu$ 固定' },
            { value: 2, label: '$\\mu_k$ 隨時間遞減' },
          ]}
        />
        <ToggleControl label="gain" ariaLabel="基底 $\phi=x$" value onChange={() => {}} />
      </>,
    )
    expect(screen.getByLabelText('迴路 L')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['mu 固定', 'mu k 隨時間遞減'])
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe('基底 phi 等於 x')
    expect(rawTexNames(container)).toEqual([])
  })

  it('可見的標籤與單位仍以 KaTeX 排版（名稱用可念形式，畫面不變）', () => {
    const { container } = render(<ParamControl label="$\sigma_v$" value={1} onChange={() => {}} min={0} max={2} unit="$\mathrm{fs}$" />)
    expect(container.querySelector('.c-param-label .katex')).toBeTruthy()
    expect(container.querySelector('.c-param-unit .katex')).toBeTruthy()
    expect(container.querySelector('.c-param-label')?.textContent).not.toContain('$')
  })

  it('標籤含數學時輸入框另給 aria-label（KaTeX 在 <label> 的「由內容算名稱」裡會被丟掉，名稱會漏掉符號）', () => {
    render(
      <>
        <ParamControl label="$\mu$（Case A）" value={0.1} onChange={() => {}} min={0} max={1} />
        <ParamControl label="$\delta_0 = a - w_0$" value={1} onChange={() => {}} min={0} max={2} />
        <ParamControl label="純文字標籤" value={1} onChange={() => {}} min={0} max={2} />
        <ParamControl label={<Tex>{'J_{11}'}</Tex>} value={1} onChange={() => {}} min={0} max={2} />
      </>,
    )
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.map((i) => i.getAttribute('aria-label'))).toEqual(['mu（Case A）', 'delta 0 等於 a 減 w 0', null, 'J 11'])
    // 沒有數學的標籤維持 <label htmlFor> 的關聯，不另外加 aria-label（避免重複）
    expect(screen.getByLabelText('純文字標籤')).toBe(inputs[2])
    // 非字串標籤（<Tex>）也念得出符號，不再是「參數」
    expect(screen.getAllByRole('slider')[3].getAttribute('aria-label')).toBe('J 11（滑桿）')
  })

  it('SelectControl／ToggleControl 的標籤含數學時也另給 aria-label', () => {
    render(
      <>
        <SelectControl label="$\mu$ 的排程" value="a" onChange={() => {}} options={['a', 'b'] as const} />
        <ToggleControl label="基底 $\phi=x$" value onChange={() => {}} />
        <ToggleControl label="純文字" value onChange={() => {}} />
      </>,
    )
    expect(screen.getByRole('combobox').getAttribute('aria-label')).toBe('mu 的排程')
    const [t1, t2] = screen.getAllByRole('switch')
    expect(t1.getAttribute('aria-label')).toBe('基底 phi 等於 x')
    expect(t2.getAttribute('aria-label')).toBeNull()
  })
})
