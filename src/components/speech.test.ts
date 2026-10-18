import type { FormulaEntry } from '@/data/types'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { accessibleText, texToSpeech } from './speech'
import { defaultValues } from './handcalcMath'
import { stripMathDelimiters } from './Tex'

/** 輸出裡不可以還有的字元：反斜線、大括號、上下標符號、`$` */
const RAW_TEX = /[\\{}^_$]/

describe('texToSpeech：站上實際出現的 20+ 種寫法', () => {
  // 左邊是 TeX 原始碼（來自量測到的 aria-label／title／aria-valuetext 與公式表），右邊是螢幕閱讀器會念的文字
  it.each([
    // 希臘字母與下標：「backslash sigma underscore v」→「sigma v」
    ['\\sigma_v', 'sigma v'],
    ['\\mu', 'mu'],
    ['\\varepsilon_{cc}=\\kappa x', 'epsilon cc 等於 kappa x'],
    ['\\omega_n T_s', 'omega n T s'],
    ['\\lambda_{\\min}>0', 'lambda min 大於 0'],
    ['f_{\\mathrm{ref}}', 'f ref'],
    ['N_{\\mathrm{int}}', 'N int'],
    ['\\hat{w}_k', 'w hat k'],
    ['\\hat\\mu_k', 'mu hat k'],
    // 減號：二元念「減」、一元念「負」；絕對值
    ['a-w_0', 'a 減 w 0'],
    ['|a-w_0|', '絕對值（a 減 w 0）'],
    ['\\delta_0 = a - w_0', 'delta 0 等於 a 減 w 0'],
    ['q=+1', 'q 等於 正 1'],
    ['|H|^2', '絕對值（H）平方'],
    ['P(q|e)', 'P(q 給定 e)'],
    // 上標
    ['p=1-\\mu x^2', 'p 等於 1 減 mu x 平方'],
    ['\\mathrm{fs}^{-1}', 'fs 的負 1 次方'],
    ['\\mathrm{code}^{-2}', 'code 的負 2 次方'],
    ['10^{-6}', '10 的負 6 次方'],
    ['2^{A-1}', '2 的（A 減 1）次方'],
    ['e^{j\\Omega}', 'e 的 j Omega 次方'],
    ['E[\\boldsymbol\\delta\\boldsymbol\\delta^T]', 'E[delta delta 轉置]'],
    ['g^*(d=0)=2', 'g 星號(d 等於 0) 等於 2'],
    ['90^\\circ', '90 度'],
    // 運算與關係
    ['2\\times2', '2 乘 2'],
    ['\\pm', '正負'],
    ['h*x', 'h 卷積 x'],
    ['\\alpha=0.001\\ldots0.500', 'alpha 等於 0.001 … 0.500'],
    ['n\\to\\infty', 'n 趨近 無限大'],
    ['0/1 \\to \\pm1', '0 或 1 對應到 正負 1'],
    // 分數、根號、總和
    ['\\frac{a}{b}', 'a 除以 b'],
    ['\\frac{1}{z-1}', '1 除以（z 減 1）'],
    ['\\frac{\\mu\\,\\sigma_v^2}{2-\\mu x^2}', '（mu sigma v 平方）除以（2 減 mu x 平方）'],
    ['\\sqrt N', '根號 N'],
    ['\\sqrt{2\\pi}', '根號（2 pi）'],
    ['\\sum_{k=0}^{q-1}c_k', '從 k 等於 0 到 q 減 1 的總和 c k'],
    ['y_{m-1}', 'y（m 減 1）'],
    // 其他
    ['x[n]', 'x[n]'],
    ['\\log_2', 'log 2'],
    ['\\Phi(\\cdot)', 'Phi(點)'],
    ['\\text{對所有 }\\Omega', '對所有 Omega'],
    ['\\left(a+b\\right)^2', '(a 加 b) 平方'],
    ['\\begin{bmatrix}1&\\rho\\\\\\rho&1\\end{bmatrix}', '矩陣（1, rho；rho, 1）'],
    ['\\lfloor n/2\\rfloor', '向下取整（n 除以 2）'],
    // 絕對值關閉後的下標（papers 頁的最大根模）：不是「代入」
    ['|z|_{\\max}^k', '絕對值（z）max 的 k 次方'],
    ['|z|_{\\max}<1', '絕對值（z）max 小於 1'],
    ['\\sigma_w\\big|_{d=0}', 'sigma w 在 d 等於 0 時'],
    ['\\sigma_w|_{d=1}/\\sigma_w|_{d=0}', 'sigma w 在 d 等於 1 時 除以 sigma w 在 d 等於 0 時'],
    // 有方向的 \lvert / \rvert / \lVert / \rVert
    ['\\lvert T(f_{rot})\\rvert', '絕對值（T(f rot)）'],
    ['\\lvert1+L\\rvert^2', '絕對值（1 加 L）平方'],
    ['\\lVert\\mathbf x\\rVert^2', '範數（x）平方'],
    ['\\max\\lvert\\Delta\\mathrm{Re}\\,H\\rvert', 'max 絕對值（Delta Re H）'],
    // 單側極限與角度
    ['C\\to0^+', 'C 趨近 0 正'],
    ['h\\to0^-', 'h 趨近 0 負'],
    ['\\mathrm{PM}=-12.44^\\circ', 'PM 等於 負 12.44 度'],
    ['{}^\\circ', '度'],
    ['360^\\circ/P', '360 度 除以 P'],
  ])('%s → %s', (tex, spoken) => {
    expect(texToSpeech(tex)).toBe(spoken)
    expect(texToSpeech(tex)).not.toMatch(RAW_TEX)
  })

  it('不認識的指令保留指令名稱，不輸出反斜線', () => {
    expect(texToSpeech('\\foo_1 + \\bar{x}')).toBe('foo 1 加 x bar')
  })

  it('壞掉或極端的輸入不丟例外、不留 TeX 符號、很快回來', () => {
    const nasty = [
      '',
      '\\',
      '\\frac{1}{',
      '{{{{',
      '}}}}',
      'a^',
      'x_',
      '^^^___',
      '\\begin{cases}',
      '\\left',
      '\\sqrt[',
      '|a|b|',
      '\\textcolor{red}',
      '{'.repeat(300) + 'x' + '}'.repeat(300),
      '\\frac{'.repeat(120) + 'x' + '}{y}'.repeat(120),
      '\\hat'.repeat(500) + 'x',
      'x^'.repeat(2000),
    ]
    const t0 = performance.now()
    for (const tex of nasty) {
      expect(() => texToSpeech(tex)).not.toThrow()
      expect(texToSpeech(tex)).not.toMatch(RAW_TEX)
    }
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('accessibleText：字串裡的每個 $...$ 換成可念形式', () => {
  it('沒有 $ 的字串原樣回傳', () => {
    expect(accessibleText('μ 學習率')).toBe('μ 學習率')
    expect(accessibleText('')).toBe('')
  })

  it('只換 $...$，其餘文字保留', () => {
    expect(accessibleText('要走的距離 $|a-w_0|$（D）')).toBe('要走的距離 絕對值（a 減 w 0）（D）')
    expect(accessibleText('$\\mu$（Case A）（滑桿）')).toBe('mu（Case A）（滑桿）')
    expect(accessibleText('$g\\times$ 誤差、$\\mathrm{Re}\\,H_{PD}$')).toBe('g 乘 誤差、Re H PD')
  })

  it('`\\$` 是字面的金額符號，不當作分隔符', () => {
    expect(accessibleText('價格 \\$5 與 $x$')).toBe('價格 $5 與 x')
  })

  it('\\lvert 與 \\rvert 拆在兩段 $...$ 裡（中間是中文）也念成一個絕對值', () => {
    expect(accessibleText('$\\lvert$GOS 誤差$\\rvert$（code = 1 時）對 block')).toBe('絕對值（GOS 誤差）（code = 1 時）對 block')
    expect(accessibleText('快模式的 $|z|_{\\max}^k$（漸近衰減率）')).toBe('快模式的 絕對值（z）max 的 k 次方（漸近衰減率）')
  })

  it('西文字母／數字相鄰時補空白，不黏成一個字', () => {
    expect(accessibleText('Case$\\alpha$ 與 $\\mu$K')).toBe('Case alpha 與 mu K')
  })

  it('stripMathDelimiters 仍保留 TeX 原始碼（給程式碼、id、報告用）', () => {
    const s = '$\\sigma_v$（comparator 前雜訊）'
    expect(stripMathDelimiters(s)).toBe('\\sigma_v（comparator 前雜訊）')
    expect(accessibleText(s)).toBe('sigma v（comparator 前雜訊）')
  })

  it('量測到的名稱字串（ParamControl 標籤、圖說、tooltip）轉完不含 `\\` 或 `$`', () => {
    const measured = [
      '$\\mu$（Case A）',
      '$\\sigma_v$（comparator 前雜訊）',
      '初始誤差 $a-w_0$（d0）',
      '$J(w)$ 與每一步的切線',
      '三種批次成本（各自正規化到 $[0,1]$）與最小值位置',
      'Monte Carlo：$|a-w_n|$ 的中位數與 10–90% 帶（Case A）',
      '$g^*(d=0)=2$ 與特徵根一致；$\\sum y^2$：封閉式 = 直接加總（相對誤差 $<10^{-8}$）',
      '$\\mathrm{fs}^{-1}$',
      '$\\operatorname{eig}(\\mathbf I+\\mathbf M\\mathbf J)$ vs 封閉式 poles：$\\max|\\Delta p|=2.2\\times10^{-16}$',
      '$\\lvert H_{PD}\\rvert$ 與 $\\lvert T\\rvert$',
    ]
    for (const s of measured) {
      expect(s).toMatch(/[\\$]/)
      expect(accessibleText(s), s).not.toMatch(/[\\$]/)
    }
  })
})

describe('全站掃描：真實的公式與手算題轉成可念形式後不含 TeX 符號', () => {
  const modules = {
    ...import.meta.glob<FormulaEntry[]>('../chapters/*/formulas.ts', { eager: true, import: 'FORMULAS' }),
    ...import.meta.glob<FormulaEntry[]>('../pages/*/formulas.ts', { eager: true, import: 'FORMULAS' }),
  }
  const formulas = Object.values(modules).flat().filter(Boolean)

  it('公式表（FORMULAS）的每一條 tex 與標題', () => {
    expect(formulas.length).toBeGreaterThan(300)
    for (const f of formulas) {
      expect(texToSpeech(f.tex), f.id).not.toMatch(RAW_TEX)
      expect(texToSpeech(f.tex).length, f.id).toBeGreaterThan(0)
      expect(accessibleText(f.title), f.id).not.toMatch(/\$/)
    }
  })

  it('手算題：輸入／答案的標籤、符號、單位與每一步的 TeX', () => {
    expect(ALL_HANDCALCS.length).toBeGreaterThan(50)
    for (const def of ALL_HANDCALCS) {
      for (const i of def.inputs) {
        expect(accessibleText(i.label), `${def.id}/${i.key}`).not.toMatch(/[\\$]/)
        expect(texToSpeech(i.symbol), `${def.id}/${i.key}`).not.toMatch(RAW_TEX)
        if (i.unit) expect(texToSpeech(i.unit), `${def.id}/${i.key}`).not.toMatch(RAW_TEX)
      }
      const sol = def.solve(defaultValues(def))
      for (const r of sol.results) {
        expect(texToSpeech(r.symbol), def.id).not.toMatch(RAW_TEX)
        if (r.label) expect(accessibleText(r.label), def.id).not.toMatch(/[\\$]/)
      }
      for (const s of sol.steps) expect(texToSpeech(s.tex), def.id).not.toMatch(RAW_TEX)
    }
  })
})

describe('這個資料夾的共用元件不把 TeX 原始碼放進無障礙名稱（原始碼層級的防線）', () => {
  // 元件的 aria-label / title / aria-valuetext 不得用 stripMathDelimiters（它保留 TeX 原始碼）；一律用 accessibleText / texToSpeech
  const sources = import.meta.glob<string>(
    ['./ParamControl.tsx', './HandCalc.tsx', './CodeBlock.tsx', './Teaching.tsx', './MetricTable.tsx'],
    { eager: true, query: '?raw', import: 'default' },
  )

  it('掃到五個檔案', () => {
    expect(Object.keys(sources).sort()).toEqual(['./CodeBlock.tsx', './HandCalc.tsx', './MetricTable.tsx', './ParamControl.tsx', './Teaching.tsx'])
  })

  it.each(['./ParamControl.tsx', './HandCalc.tsx', './CodeBlock.tsx', './Teaching.tsx', './MetricTable.tsx'])('%s 沒有用 stripMathDelimiters 組名稱', (file) => {
    const src = (sources[file] ?? '').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(src).not.toMatch(/stripMathDelimiters/)
  })
})
