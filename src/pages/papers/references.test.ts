import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pageById } from '@/app/registry'
import katex from 'katex'
import { CONVENTIONS, CONVENTION_MU_TEX, CONVENTION_SHORT, CONVENTION_UPDATE_TEX } from './bridge'
import { erratumHref } from './common'
import { BOOK_TOPICS, PAPERS, PAPERS_BY_ORDER, bibtexKey, doiUrl, formatCitation, latexEscape, pageCount, paperById, toBibtex } from './references'

const spec = readFileSync(join(process.cwd(), 'docs', 'LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md'), 'utf8')
const appendixD = spec.slice(spec.indexOf('# 附錄 D'), spec.indexOf('# 附錄 E'))
const validation = readFileSync(join(process.cwd(), 'docs', 'validation.md'), 'utf8')

/** 比對題名用：去掉 ISSCC 論文編號、統一破折號與大小寫 */
const norm = (s: string) =>
  s
    .replace(/^\d+\.\d+\s+/, '')
    .replace(/[−–—-]/g, '-')
    .toLowerCase()

describe('附錄 D 的 7 份文獻：不捏造、不改動', () => {
  it('恰好 7 份，id D1–D7 與規格書編號 1–7 一一對應', () => {
    expect(PAPERS.map((p) => p.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'])
    expect(PAPERS.map((p) => p.specIndex)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(paperById('D4').authors[0]).toBe('Rishabh Gurbaxani')
    expect(() => paperById('D9' as never)).toThrow()
  })

  it('本頁的 DOI 集合 = 規格書附錄 D 的 DOI 集合（沒有新增、沒有改動），連結都指向 https://doi.org/', () => {
    const specDois = Array.from(appendixD.matchAll(/DOI: \[([^\]]+)\]\(https:\/\/doi\.org\/(.+?)\)(?=。|\s|$)/g))
    expect(specDois.length).toBe(6)
    for (const m of specDois) expect(m[1]).toBe(m[2]) // 規格書本身的顯示文字與連結一致
    const mine = PAPERS.filter((p) => p.doi).map((p) => p.doi as string)
    expect(new Set(mine)).toEqual(new Set(specDois.map((m) => m[1])))
    for (const p of PAPERS) {
      if (!p.doi) continue
      expect(p.doi).toMatch(/^10\.\d{4,9}\/\S+$/)
      expect(doiUrl(p.doi)).toBe(`https://doi.org/${p.doi}`)
      expect(appendixD).toContain(`https://doi.org/${p.doi}`)
    }
  })

  it('D7 是講義：沒有 DOI，第一個連結就是規格書給的 PDF，並如實標示連結狀態', () => {
    const d7 = paperById('D7')
    expect(d7.doi).toBeUndefined()
    expect(d7.kind).toBe('lecture')
    expect(d7.links?.[0].url).toBe('https://www.commsp.ee.ic.ac.uk/~mandic/ASP_Slides/SSPI_Lecture_7_Adaptive_Filters_2025.pdf')
    expect(appendixD).toContain(d7.links?.[0].url)
    expect(d7.links?.[0].status).toMatch(/404/)
    for (const l of d7.links ?? []) expect(l.url).toMatch(/^https:\/\//)
  })

  it('題名與年份和規格書一致（D4 的「12.1」是 ISSCC 論文編號）', () => {
    for (const p of PAPERS) {
      expect(norm(appendixD)).toContain(norm(p.title))
      expect(appendixD).toContain(String(p.year))
    }
    expect(paperById('D4').title.startsWith('12.1 ')).toBe(true)
  })

  it('規格書附錄 D 的描述原樣引用', () => {
    for (const p of PAPERS) expect(appendixD).toContain(p.specNote)
  })

  it('相關頁面都存在於 registry；相關勘誤都存在於 docs/validation.md', () => {
    for (const p of PAPERS) {
      expect(p.pages_.length).toBeGreaterThan(0)
      for (const id of p.pages_) expect(pageById(id), `${p.id} → ${id}`).toBeDefined()
      for (const e of p.errata) expect(validation).toContain(`| ${e} |`)
    }
    for (const t of BOOK_TOPICS) for (const b of t.books) for (const id of b.pages_) expect(pageById(id), `${b.id} → ${id}`).toBeDefined()
  })

  it('閱讀順序：D7（講義）第一、D4（晶片實例）最後，順位不重複', () => {
    expect(PAPERS_BY_ORDER[0].id).toBe('D7')
    expect(PAPERS_BY_ORDER[PAPERS_BY_ORDER.length - 1].id).toBe('D4')
    expect(new Set(PAPERS.map((p) => p.order)).size).toBe(PAPERS.length)
  })

  it('引用格式與頁數', () => {
    expect(formatCitation(paperById('D2'))).toBe(
      'Rufus Fraanje, Michel Verhaegen, and Stephen J. Elliott, “Robustness of the Filtered-X LMS Algorithm—Part I: Necessary Conditions for Convergence and the Asymptotic Pseudospectrum of Toeplitz Matrices,” IEEE Transactions on Signal Processing, vol. 55, no. 8, pp. 4029–4037, Aug. 2007.',
    )
    expect(formatCitation(paperById('D1'))).toContain('in 2019 IEEE Asia Pacific Conference')
    expect(formatCitation(paperById('D1'))).toContain('Bangkok, Thailand, pp. 5–8, Nov. 2019.')
    expect(formatCitation(paperById('D4'))).toContain('San Francisco, CA, USA, pp. 208–210, Feb. 2026.')
    expect(formatCitation(paperById('D6'))).toContain('Baltimore, MD, USA, pp. 1–4, May 2017.')
    expect(formatCitation(paperById('D3'))).toBe(
      'Michael A. Vaudrey, William T. Baumann, and William R. Saunders, “Stability and operating constraints of adaptive LMS-based feedback control,” Automatica, vol. 39, no. 4, pp. 595–605, Apr. 2003.',
    )
    expect(formatCitation(paperById('D5'))).toContain('Journal of the Franklin Institute, vol. 352, no. 8, pp. 3325–3344, Aug. 2015.')
    expect(formatCitation(paperById('D7'))).toContain('D. P. Mandic')
    expect(pageCount('4029–4037')).toBe(9)
    expect(pageCount('5–8')).toBe(4)
    expect(pageCount('208–210')).toBe(3)
    expect(pageCount(undefined)).toBeNull()
    expect(pageCount('e123')).toBeNull()
  })

  it('資料中的數學一律以 $…$ 標成 TeX：$ 成對、反斜線只出現在 $…$ 之內、每段 TeX 都能被 KaTeX 解析、$…$ 之外沒有希臘字母', () => {
    const texts = [
      ...PAPERS.flatMap((p) => [p.relevance, p.titleClaim, ...p.tips, ...p.prereqs]),
      ...BOOK_TOPICS.flatMap((t) => [t.topic, t.usedFor, ...t.books.map((b) => b.why)]),
      ...CONVENTIONS.map((c) => CONVENTION_SHORT[c]),
    ]
    for (const t of texts) {
      expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
      const outside = t.replace(/\$[^$]+\$/g, '')
      expect(outside, t).not.toMatch(/\\/)
      // ΔΣ（delta-sigma）是專有名詞，不算公式；其餘希臘字母與上下標符號一律要寫成 TeX
      expect(outside.replace(/ΔΣ/g, ''), t).not.toMatch(/[α-ωΑ-Ω²³⁻¹₀-₉√≈≤≥∞]/)
      for (const m of t.matchAll(/\$([^$]+)\$/g)) expect(() => katex.renderToString(m[1], { throwOnError: true }), m[1]).not.toThrow()
    }
    for (const c of CONVENTIONS) {
      expect(() => katex.renderToString(CONVENTION_UPDATE_TEX[c], { throwOnError: true })).not.toThrow()
      expect(() => katex.renderToString(CONVENTION_MU_TEX[c], { throwOnError: true })).not.toThrow()
    }
  })

  it('BibTeX：只由核對過的欄位產生，type、key、頁碼、DOI 正確；講義為 @misc 且不放失效連結', () => {
    const d2 = toBibtex(paperById('D2'))
    expect(d2).toBe(
      [
        '@article{fraanje2007d2,',
        '  author = {Rufus Fraanje and Michel Verhaegen and Stephen J. Elliott},',
        '  title = {{Robustness of the Filtered-X LMS Algorithm---Part I: Necessary Conditions for Convergence and the Asymptotic Pseudospectrum of Toeplitz Matrices}},',
        '  journal = {IEEE Transactions on Signal Processing},',
        '  volume = {55},',
        '  number = {8},',
        '  pages = {4029--4037},',
        '  publisher = {IEEE},',
        '  year = {2007},',
        '  doi = {10.1109/TSP.2007.896083},',
        '  month = aug,',
        '}',
      ].join('\n'),
    )
    const keys = PAPERS.map(bibtexKey)
    expect(new Set(keys).size).toBe(PAPERS.length)
    expect(keys).toEqual(['vo2019d1', 'fraanje2007d2', 'vaudrey2003d3', 'gurbaxani2026d4', 'kennedy2015d5', 'tan2017d6', 'mandic2025d7'])
    for (const p of PAPERS) {
      const b = toBibtex(p)
      expect(b.startsWith(`@${p.kind === 'journal' ? 'article' : p.kind === 'conference' ? 'inproceedings' : 'misc'}{`)).toBe(true)
      expect(b.endsWith('\n}')).toBe(true)
      expect(b).toContain(`year = {${p.year}}`)
      if (p.doi) expect(b).toContain(`doi = {${p.doi}}`)
      else expect(b).not.toContain('doi =')
      // 大括號成對
      expect((b.match(/\{/g) ?? []).length).toBe((b.match(/\}/g) ?? []).length)
    }
    const d4 = toBibtex(paperById('D4'))
    expect(d4).toContain('booktitle = {2026 IEEE International Solid-State Circuits Conference (ISSCC)}')
    expect(d4).toContain('address = {San Francisco, CA, USA}')
    expect(d4).toContain('pages = {208--210}')
    const d7 = toBibtex(paperById('D7'))
    expect(d7).toContain('howpublished = {Lecture slides, Imperial College London}')
    expect(d7).toContain('url = {https://www.commsp.ee.ic.ac.uk/~mandic/courses.htm}')
    expect(d7).not.toContain('ASP_Slides') // 規格書的 2025 PDF 連結已 404，不放進 BibTeX
  })

  it('BibTeX 可直接用 LaTeX 編譯：文字欄位是純 ASCII，& 已跳脫、破折號與減號轉成 LaTeX 寫法；URL 與 DOI 原樣保留', () => {
    expect(latexEscape('A & B')).toBe(String.raw`A \& B`)
    expect(latexEscape('50% of #1_x costs $2')).toBe(String.raw`50\% of \#1\_x costs \$2`)
    expect(latexEscape('LMS\u2014Part I, pp. 5\u20138, \u221259dBc')).toBe('LMS---Part I, pp. 5--8, -59dBc')
    expect(latexEscape('plain ASCII-text (1.2)')).toBe('plain ASCII-text (1.2)')
    // D7：題名裡的 & 與 em dash
    const d7 = toBibtex(paperById('D7'))
    expect(d7).toContain(String.raw`title = {{Statistical Signal Processing \& Inference --- Adaptive Filters Lecture 7}}`)
    expect(d7).toContain('url = {https://www.commsp.ee.ic.ac.uk/~mandic/courses.htm}') // URL 的 ~ 不跳脫
    // D4：題名的 U+2212 轉成 ASCII 減號（Crossref 的題名本來就是 ASCII 的 -59dBc）
    const d4 = toBibtex(paperById('D4'))
    expect(d4).toContain('title = {{12.1 A 74fs-Jitter, -59dBc-Spur Fractional-N DPLL Using a Supply-Resilient Time-Amplifying Dual-Ramp DTC}}')
    // D3：DOI 的括號與連字號原樣保留
    expect(toBibtex(paperById('D3'))).toContain('doi = {10.1016/S0005-1098(02)00288-1}')
    for (const p of PAPERS) {
      const b = toBibtex(p)
      // eslint-disable-next-line no-control-regex
      expect(b, p.id).toMatch(/^[\x00-\x7f]*$/)
      // 沒有未跳脫的 & % #（它們會讓 LaTeX 編譯失敗）；URL 與 DOI 欄位除外
      const text = b
        .split('\n')
        .filter((l) => !/^\s*(url|doi) = /.test(l))
        .join('\n')
      expect(text, p.id).not.toMatch(/(?<!\\)[&%#]/)
    }
    // 畫面上的引用格式不經過 latexEscape：仍顯示原本的破折號
    expect(formatCitation(paperById('D2'))).toContain('Algorithm\u2014Part I')
    expect(formatCitation(paperById('D4'))).toContain('\u221259dBc')
  })

  it('勘誤標記連到驗證頁的深連結 #/verification?e=Exx', () => {
    expect(erratumHref('E05')).toBe('#/verification?e=E05')
    for (const p of PAPERS) for (const e of p.errata) expect(erratumHref(e)).toMatch(/^#\/verification\?e=E\d\d$/)
  })
})

describe('背景教科書：只到書籍層級', () => {
  it('每本書都有作者、書名、出版社，沒有 DOI 或頁碼欄位', () => {
    const books = BOOK_TOPICS.flatMap((t) => t.books)
    expect(books.length).toBeGreaterThanOrEqual(10)
    for (const b of books) {
      expect(b.authors.length).toBeGreaterThan(0)
      expect(b.title.length).toBeGreaterThan(0)
      expect(b.publisher.length).toBeGreaterThan(0)
      expect(Object.keys(b)).not.toContain('doi')
      expect(Object.keys(b)).not.toContain('pages')
    }
    expect(new Set(books.map((b) => b.id)).size).toBe(books.length)
  })

  it('任務要求的三本 LMS 教材都在：Haykin、Widrow & Stearns、Sayed', () => {
    const titles = BOOK_TOPICS.flatMap((t) => t.books.map((b) => `${b.authors} — ${b.title}`))
    expect(titles).toContain('S. Haykin — Adaptive Filter Theory')
    expect(titles).toContain('B. Widrow and S. D. Stearns — Adaptive Signal Processing')
    expect(titles).toContain('A. H. Sayed — Fundamentals of Adaptive Filtering')
  })
})
