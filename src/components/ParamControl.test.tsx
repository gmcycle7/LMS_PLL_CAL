import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ParamControl, SelectControl, ToggleControl, type ParamControlProps } from './ParamControl'

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
})
