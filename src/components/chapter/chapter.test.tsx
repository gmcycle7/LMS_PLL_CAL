import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HANDCALCS } from '@/chapters/ch07/handcalcs'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import { renderedCharts } from '@/test/mocks/mermaid'
import { Tex } from '../Tex'
import { loadErratumCorrections, resetErratumCorrections } from './ChapterErratum'
import { ChapterErratum, ChapterErratumNote, ChapterFig, ChapterHandCalc, FigRef, HAND_CALC_HOWTO_TAIL, HandLink, JumpTo, bindHandCalc, jumpToId } from './index'

vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

afterEach(cleanup)

describe('ChapterErratum（行內勘誤徽章）', () => {
  it('就是 ErratumLink：連到驗證頁的 ?e= 卡片，提示有嚴重度與區域', () => {
    const { container } = renderPage(<ChapterErratum id="E44" />, { url: '/ch/06' })
    const a = container.querySelector('a[data-erratum="E44"]')!
    expect(a.getAttribute('href')).toBe('/verification?e=E44')
    expect(a.className).toContain('c-badge--erratum')
    expect(a.getAttribute('title')).toMatch(/^E44（/)
  })

  it('children 與 note 都顯示在徽章後面；note 的 $…$ 以 KaTeX 排版', () => {
    const { container } = renderPage(
      <>
        <ChapterErratum id="E12">干擾改名</ChapterErratum>
        <ChapterErratum id="E13" note={String.raw`$K=K_qC$ 才是 loop gain`} />
      </>,
      { url: '/ch/11' },
    )
    const notes = [...container.querySelectorAll('.c-erratum-note')].map((n) => n.textContent)
    expect(notes[0]).toBe('：干擾改名')
    expect(notes[1]).toContain('loop gain')
    expect(container.querySelectorAll('.c-erratum-note')[1].querySelector('.katex')).toBeTruthy()
    expectNoTexErrors(container)
  })

  it('detail：較長的說明放在徽章後面（不在連結裡面）', () => {
    const { container } = renderPage(<ChapterErratum id="E45" detail={<>有模型誤差時要用 <b>E[u u_f]</b>。</>} />, { url: '/ch/07' })
    const wrap = container.querySelector('.c-erratum-wrap')!
    expect(wrap.querySelector('a[data-erratum="E45"]')?.textContent).toBe('勘誤 E45')
    expect(wrap.querySelector('.c-erratum-detail')?.textContent).toBe('有模型誤差時要用 E[u u_f]。')
    expect(wrap.querySelector('a')?.contains(wrap.querySelector('.c-erratum-detail'))).toBe(false)
  })

  it('找不到的勘誤編號照樣畫出連結，但標 data-missing（審查時抓打錯的編號）', () => {
    const { container } = renderPage(<ChapterErratum id="E9999" />, { url: '/ch/06' })
    expect(container.querySelector('a[data-missing="true"]')).toBeTruthy()
  })
})

describe('ChapterErratumNote（區塊版）', () => {
  beforeEach(() => resetErratumCorrections())

  it('徽章＋本章的處理方式馬上出現；官方修正文字延後載入（先「載入修正文字…」，載入後換成可展開的 details）', async () => {
    const { container } = renderPage(<ChapterErratumNote id="E44">本站採用修正後的版本。</ChapterErratumNote>, { url: '/ch/00' })
    const aside = container.querySelector('aside.c-erratum-block')!
    expect(aside.getAttribute('aria-label')).toBe('勘誤 E44')
    expect(aside.querySelector('a[data-erratum="E44"]')).toBeTruthy()
    expect(aside.textContent).toContain('本站採用修正後的版本。')
    // 載入前：只有徽章與處理方式，加上一句載入中的說明；外框標 aria-busy
    expect(aside.querySelector('.c-erratum-block-loading')?.textContent?.trim()).toBe('載入修正文字…')
    expect(aside.getAttribute('aria-busy')).toBe('true')
    expect(aside.querySelector('details')).toBeNull()
    // 載入後：載入說明消失，換成 details
    expect(await screen.findByText('官方修正文字')).toBeTruthy()
    expect(aside.querySelector('details > summary')?.textContent).toBe('官方修正文字')
    expect(aside.querySelector('details p')?.textContent?.length).toBeGreaterThan(5)
    expect(aside.querySelector('.c-erratum-block-loading')).toBeNull()
    expect(aside.hasAttribute('aria-busy')).toBe(false)
  })

  it('修正文字就是 errata.json 的 correction；載入過一次之後，再掛載的區塊第一次 render 就有（不再閃「載入中」）', async () => {
    const { default: file } = await import('@/data/errata.json')
    const e44 = (file as { errata: { eid: string; correction: string }[] }).errata.find((e) => e.eid === 'E44')!
    await loadErratumCorrections()
    const { container } = renderPage(<ChapterErratumNote id="E44">x</ChapterErratumNote>, { url: '/ch/00' })
    expect(container.querySelector('.c-erratum-block-loading')).toBeNull()
    expect(container.querySelector('aside.c-erratum-block details p')?.textContent).toBe(e44.correction)
  })

  it('同一頁的多個區塊共用一次載入（只動態 import 一次）', async () => {
    const first = loadErratumCorrections()
    expect(loadErratumCorrections()).toBe(first)
    const { container } = renderPage(
      <>
        <ChapterErratumNote id="E39">a</ChapterErratumNote>
        <ChapterErratumNote id="E40">b</ChapterErratumNote>
      </>,
      { url: '/ch/00' },
    )
    await waitFor(() => expect(container.querySelectorAll('details.c-erratum-block-details')).toHaveLength(2))
    expect(container.querySelectorAll('.c-erratum-block-loading')).toHaveLength(0)
  })

  it('找不到的編號（打錯）：不載入、不畫「載入中」、不畫 details，徽章標 data-missing', async () => {
    const { container } = renderPage(<ChapterErratumNote id="E9999">x</ChapterErratumNote>, { url: '/ch/00' })
    expect(container.querySelector('.c-erratum-block-loading')).toBeNull()
    expect(container.querySelector('aside.c-erratum-block')!.hasAttribute('aria-busy')).toBe(false)
    expect(container.querySelector('a[data-missing="true"]')).toBeTruthy()
    await loadErratumCorrections()
    expect(container.querySelector('details')).toBeNull()
  })

  it('載入失敗（離線、chunk 404）：顯示失敗說明、不畫 details；下一次掛載可以重試', async () => {
    vi.doMock('@/data/errata.json', () => {
      throw new Error('offline')
    })
    try {
      const failed = renderPage(<ChapterErratumNote id="E44">x</ChapterErratumNote>, { url: '/ch/00' })
      expect((await failed.findByText(/修正文字載入失敗/)).textContent).toContain('請重新整理頁面')
      expect(failed.container.querySelector('details')).toBeNull()
      expect(failed.container.querySelector('aside.c-erratum-block')!.hasAttribute('aria-busy')).toBe(false)
      failed.unmount()
    } finally {
      vi.doUnmock('@/data/errata.json')
    }
    const retry = renderPage(<ChapterErratumNote id="E44">x</ChapterErratumNote>, { url: '/ch/00' })
    expect(await retry.findByText('官方修正文字')).toBeTruthy()
  })
})

describe('ChapterHandCalc／bindHandCalc／HandLink', () => {
  const id = HANDCALCS[0].id

  it('依 id 取出題目，前面是「換你算：」引言；沒給引言用預設句', () => {
    const { container } = renderPage(<ChapterHandCalc id={id} defs={HANDCALCS} />, { url: '/ch/07' })
    const box = container.querySelector('.c-chapter-hand')!
    expect(box.getAttribute('data-handcalc')).toBe(id)
    expect(box.querySelector('.c-chapter-hand-lead strong')?.textContent).toBe('換你算：')
    expect(box.querySelector('.c-chapter-hand-lead')?.textContent).toContain('紙筆')
    expect(box.querySelector(`section[id="handcalc-${id}"]`)).toBeTruthy()
  })

  it('引言字串裡的 $…$ 以 KaTeX 排版；tail 接在引言後面', () => {
    const { container } = renderPage(
      <ChapterHandCalc id={id} defs={HANDCALCS} tail="再看詳解。">
        {String.raw`把 $\mu$ 換成你自己的。`}
      </ChapterHandCalc>,
      { url: '/ch/07' },
    )
    const lead = container.querySelector('.c-chapter-hand-lead')!
    expect(lead.querySelector('.katex')).toBeTruthy()
    expect(lead.textContent).toContain('再看詳解。')
    expectNoTexErrors(container)
  })

  it('id 打錯時丟錯，不會默默少一題', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderPage(<ChapterHandCalc id="HC-99.9" defs={HANDCALCS} />, { url: '/ch/07' })).toThrow(/HC-99\.9/)
    spy.mockRestore()
  })

  it('bindHandCalc 回傳綁好題庫的元件', () => {
    const Hand = bindHandCalc(HANDCALCS, { tail: <em>尾巴</em> })
    const { container } = renderPage(<Hand id={id}>先算。</Hand>, { url: '/ch/07' })
    expect(container.querySelector('.c-chapter-hand-lead')?.textContent).toBe('換你算：先算。 尾巴')
  })

  it('HAND_CALC_HOWTO_TAIL（Ch11／Ch11b 共用的「怎麼用」句子）接在引言後面，一句、不含未排版的 $', () => {
    const Hand = bindHandCalc(HANDCALCS, { tail: HAND_CALC_HOWTO_TAIL })
    const { container } = renderPage(<Hand id={id}>先算。</Hand>, { url: '/ch/07' })
    const lead = container.querySelector('.c-chapter-hand-lead')?.textContent ?? ''
    expect(lead).toBe(`換你算：先算。 ${HAND_CALC_HOWTO_TAIL}`)
    expect(HAND_CALC_HOWTO_TAIL).toContain('自己算算看')
    expect(HAND_CALC_HOWTO_TAIL).toContain('換一題')
    expect(HAND_CALC_HOWTO_TAIL).not.toContain('$')
  })

  it('HandLink 是 AnchorLink：href 是真的路由網址（?a=handcalc-…），不是 #id', () => {
    const { container } = renderPage(<HandLink id={id} />, { url: '/ch/07' })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe(`#/ch/07?a=handcalc-${id}`)
    expect(a.textContent).toBe(`帶入手算 ${id}`)
    expect(a.getAttribute('data-anchor-link')).toBe(`handcalc-${id}`)
  })
})

describe('ChapterFig／FigRef', () => {
  const CHART = 'flowchart LR\n  A["$x[n]$"] --> B["$e[n]$"]'

  it('圖號、圖種、圖說組成 figcaption；導讀在圖下方', async () => {
    const { container } = renderPage(
      <ChapterFig chart={CHART} label="圖 10-3" kind="比較圖" caption="看 $x[n]$ 怎麼變成 $e[n]$" ariaLabel="圖 10-3：x 到 e" id="fig-a" dataAttrs={{ 'data-diagram': 'a' }}>
        先看左邊，再看右邊。
      </ChapterFig>,
      { url: '/ch/10' },
    )
    const box = container.querySelector('#fig-a')!
    expect(box.getAttribute('data-diagram')).toBe('a')
    await vi.waitFor(() => expect(renderedCharts().length).toBeGreaterThan(0))
    expect(box.querySelector('figcaption')?.textContent).toContain('圖 10-3（比較圖）｜看')
    expect(box.querySelector('figcaption .katex')).toBeTruthy()
    expect(box.querySelector('.c-chapter-fig-walk-label')?.textContent).toBe('怎麼看這張圖')
    expect(box.querySelector('.c-chapter-fig-walk-body')?.textContent).toBe('先看左邊，再看右邊。')
    expectNoTexErrors(container)
  })

  it('沒有導讀就不畫導讀框；walkLabel=false 不畫標籤', () => {
    const a = renderPage(<ChapterFig chart={CHART} caption="圖說" />, { url: '/ch/10' })
    expect(a.container.querySelector('.c-chapter-fig-walk')).toBeNull()
    a.unmount()
    const b = renderPage(
      <ChapterFig chart={CHART} caption="圖說" walkLabel={false}>
        導讀
      </ChapterFig>,
      { url: '/ch/10' },
    )
    expect(b.container.querySelector('.c-chapter-fig-walk-label')).toBeNull()
    expect(b.container.querySelector('.c-chapter-fig-walk-body')?.textContent).toBe('導讀')
  })

  it('richCaption：圖說是 JSX（含 <Tex>）時畫成圖下方的一段，圖號粗體、圖種括在後面；Mermaid 本身沒有 figcaption', () => {
    const { container } = renderPage(
      <ChapterFig chart={CHART} label="圖 9.3" kind="資料流" richCaption={<>看藍色的方塊：<Tex>{'e[n]'}</Tex> 只有一個數。</>} ariaLabel="圖 9.3：資料流" id="fig-c" />,
      { url: '/ch/09' },
    )
    const box = container.querySelector('#fig-c')!
    expect(box.querySelector('figure.c-mermaid figcaption')).toBeNull()
    const cap = box.querySelector('p.c-chapter-fig-richcap')!
    expect(cap.querySelector('strong')?.textContent).toBe('圖 9.3')
    expect(cap.textContent).toMatch(/^圖 9\.3（資料流）看藍色的方塊/)
    expect(cap.querySelector('.katex')).toBeTruthy()
    expect(box.querySelector('figure')?.getAttribute('aria-label')).toBe('圖 9.3：資料流')
    expectNoTexErrors(container)
  })

  it('FigRef 的 dataAttrs 加在圖號上', () => {
    const { container } = renderPage(<FigRef label="圖 10-2" dataAttrs={{ 'data-figref': 'coupling' }} />, { url: '/ch/10' })
    expect(container.querySelector('strong.c-figref')?.getAttribute('data-figref')).toBe('coupling')
  })

  it('圖說的 $ 不成對時丟錯', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderPage(<ChapterFig chart={CHART} caption="壞的 $x" />, { url: '/ch/10' })).toThrow(/不成對/)
    spy.mockRestore()
  })

  it('FigRef：沒有 target 是粗體文字；有 target 是捲到那張圖的按鈕', () => {
    const { container } = renderPage(
      <>
        <FigRef label="圖 1-1" />
        <FigRef label="圖 1-2" target="fig-b" />
      </>,
      { url: '/ch/01' },
    )
    expect(container.querySelector('strong.c-figref')?.textContent).toBe('圖 1-1')
    expect(container.querySelector('button.c-figref')?.getAttribute('data-jump')).toBe('fig-b')
  })
})

describe('JumpTo／jumpToId', () => {
  it('捲到目標前先展開祖先 <details>（Beginner 的推導框、Ch04 的 Part 2 預設收合）', () => {
    const { container } = renderPage(
      <>
        <JumpTo target="deep">去深處</JumpTo>
        <details>
          <summary>摺起來</summary>
          <p id="deep">目標</p>
        </details>
      </>,
      { url: '/ch/04' },
    )
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '去深處' }))
    expect(details.open).toBe(true)
    expect(document.getElementById('deep')?.getAttribute('tabindex')).toBe('-1')
  })

  it('onJump 在捲動之前呼叫；找不到目標時 jumpToId 回傳 false 且不丟錯', () => {
    const order: string[] = []
    renderPage(
      <>
        <JumpTo target="nope" onJump={() => order.push('before')} className="x">
          去
        </JumpTo>
      </>,
      { url: '/ch/04' },
    )
    fireEvent.click(screen.getByRole('button', { name: '去' }))
    expect(order).toEqual(['before'])
    expect(jumpToId('nope')).toBe(false)
    expect(screen.getByRole('button', { name: '去' }).className).toBe('c-jump x')
  })
})
