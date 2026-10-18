import { PER_GROUP, collectPageSections, headingText, makeEntry, search } from './searchCore'

/** 一段 KaTeX 的輸出（MathML + HTML 兩份，textContent 會重複） */
const katex = (tex: string, html: string) =>
  `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${html}</span></span>`

afterEach(() => {
  document.body.innerHTML = ''
})

describe('headingText：h2 的純文字（KaTeX 換回 $TeX$）', () => {
  it('MathML 與 HTML 兩份只留一份，寫成 $…$；空白合併', () => {
    document.body.innerHTML = `<h2>1.  先算一次：${katex('\\sigma_v=100\\,\\mathrm{fs}', 'σv=100 fs')}
      之後</h2>`
    expect(headingText(document.querySelector('h2')!)).toBe('1. 先算一次：$\\sigma_v=100\\,\\mathrm{fs}$ 之後')
  })
  it('沒有 annotation 的 .katex 退回 HTML 那一份的文字', () => {
    document.body.innerHTML = `<h2>速率 <span class="katex"><span class="katex-html">f_s</span></span></h2>`
    expect(headingText(document.querySelector('h2')!)).toBe('速率 f_s')
  })
})

describe('search：打的正好是某筆 id 的那一組排最前面', () => {
  it('E13 同時是勘誤的 id 與一條公式內文提到的字：勘誤組先、公式組後；多個 token 也算；沒有完全相同的 id 時照 KIND_ORDER', () => {
    const f = makeEntry({ kind: 'formula', id: 'F-05.1', title: '公式', detail: '勘誤 E13 修正', to: '/ch/05?f=F-05.1' })
    const e = makeEntry({ kind: 'erratum', id: 'E13', title: '勘誤標題', detail: 'spur', to: '/verification?e=E13' })
    expect(search([f, e], 'E13').map((g) => g.kind)).toEqual(['erratum', 'formula'])
    expect(search([f, e], 'e13 spur').map((g) => g.kind)).toEqual(['erratum'])
    expect(search([f, e], '修正 E13').map((g) => g.kind)).toEqual(['formula'])
    expect(search([f, e], '勘誤').map((g) => g.kind)).toEqual(['formula', 'erratum'])
  })
})

describe('collectPageSections：目前這一頁的 h2', () => {
  function mountPage() {
    document.body.innerHTML = `
      <main id="main">
        <article class="page" data-page="ch05">
          <section class="c-modepicker"><h2>先選一個學習模式</h2></section>
          <h1>第五章</h1>
          <section class="c-section" id="ch05-intro"><h2 class="c-section-title">直覺：${katex('K_q', 'Kq')} 是什麼</h2></section>
          <h2 id="own-id">自己有 id</h2>
          <div><h2>   </h2></div>
          <div><h2>沒有 id 的段落</h2></div>
          <div role="dialog"><h2>對話框裡的不算</h2></div>
        </article>
      </main>`
  }

  it('每個 h2 一筆：有 id 的目標是 路徑?a=id（最近的有 id 的祖先或自己），沒有 id 的目標是路徑本身、el 是 h2；模式選擇器、對話框、空標題略過', () => {
    mountPage()
    const list = collectPageSections('/ch/05')
    expect(list.map((e) => e.id)).toEqual(['ch05-intro', 'own-id', 'h2-3'])
    expect(list.map((e) => e.to)).toEqual(['/ch/05?a=ch05-intro', '/ch/05?a=own-id', '/ch/05'])
    expect(list[0].title).toBe('直覺：$K_q$ 是什麼')
    expect(list[0].el).toBe(document.getElementById('ch05-intro'))
    expect(list[1].el).toBe(document.getElementById('own-id'))
    expect(list[2].el?.tagName).toBe('H2')
    expect(list[2].el?.textContent).toBe('沒有 id 的段落')
    for (const e of list) {
      expect(e.kind).toBe('section')
      expect(e.label).toBe('本頁')
      expect(e.detail).toBe('05 1-bit Comparator 統計') // registry 的側欄名稱
    }
  })

  it('<main id="main"> 本身的 id 不算錨點；不在 registry 的路徑用「目前這一頁」當說明', () => {
    document.body.innerHTML = `<main id="main"><article class="page"><h2>段落</h2></article></main>`
    const [e] = collectPageSections('/nope')
    expect(e.to).toBe('/nope')
    expect(e.detail).toBe('目前這一頁')
    expect(e.el?.tagName).toBe('H2')
  })

  it('沒有 <main> 時回傳空陣列', () => {
    document.body.innerHTML = '<div>nothing</div>'
    expect(collectPageSections('/ch/05')).toEqual([])
  })

  it('空查詢 = 本頁目錄，要完整：段落再多也不受每組 PER_GROUP 筆的限制；有關鍵字時才限制', () => {
    const n = PER_GROUP + 4
    document.body.innerHTML = `<main id="main"><article class="page">${Array.from({ length: n }, (_, i) => `<section id="s${i}"><h2>段落 ${i}</h2></section>`).join('')}</article></main>`
    const sections = collectPageSections('/ch/05')
    expect(sections).toHaveLength(n)
    const [g] = search(sections, '')
    expect(g.total).toBe(n)
    expect(g.items).toHaveLength(n)
    const [h] = search(sections, '段落')
    expect(h.total).toBe(n)
    expect(h.items).toHaveLength(PER_GROUP)
  })

  it('空查詢只列本頁段落；關鍵字能找到段落（TeX 與 Unicode 寫法互通）', () => {
    mountPage()
    const sections = collectPageSections('/ch/05')
    const staticEntry = makeEntry({ kind: 'formula', id: 'F-05.1', title: '公式', to: '/ch/05?f=F-05.1' })
    const all = [...sections, staticEntry]
    expect(search(all, '').map((g) => g.kind)).toEqual(['section'])
    expect(search(all, '')[0].items).toHaveLength(3)
    expect(search(all, 'K_q')[0].items[0].id).toBe('ch05-intro')
    expect(search(all, 'Kq')[0].items[0].id).toBe('ch05-intro')
    expect(search(all, '沒有 id').flatMap((g) => g.items).map((e) => e.id)).toEqual(['h2-3'])
  })
})
