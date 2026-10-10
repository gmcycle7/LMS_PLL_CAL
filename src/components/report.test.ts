import { buildReportHtml, escapeHtml, isSafeImageDataUrl, type ReportInput } from './report'

const base: ReportInput = {
  title: 'Comparator Lab',
  experimentId: 'one-bit-comparator',
  generatedAt: '2026-10-10T00:00:00.000Z',
  appVersion: '0.1.0',
  commit: 'abc1234',
  modelLevel: 'L1',
  assumptions: ['gaussian iid noise'],
  warnings: [],
  params: [{ name: 'signal_fs', value: '1', unit: 'fs' }],
  metrics: [],
  plots: [],
}

describe('escapeHtml', () => {
  it('跳脫 & < > " \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})

describe('buildReportHtml', () => {
  it("跳脫所有使用者文字中的 '<script>'", () => {
    const evil = '<script>alert(1)</script>'
    const html = buildReportHtml({
      ...base,
      title: evil,
      assumptions: [evil],
      warnings: [evil],
      params: [{ name: evil, value: evil, unit: evil }],
      metrics: [{ name: evil, value: evil }],
      dataPreview: { headers: [evil], rows: [[evil]], totalRows: 1 },
      notes: [evil],
      crossCheck: [{ name: evil, status: evil }],
      plots: [{ title: evil, dataUrl: 'data:image/png;base64,AAAA' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('產生獨立 HTML：charset、內嵌 CSS、版本、commit、seed 與時間戳記', () => {
    const html = buildReportHtml({ ...base, seed: 20261010 })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
    expect(html).toContain('v0.1.0')
    expect(html).toContain('abc1234')
    expect(html).toContain('seed：20261010')
    expect(html).toContain('2026-10-10T00:00:00.000Z')
  })

  it('只嵌入 raster data URL 圖片，其他（javascript: / svg）會被略過並註明', () => {
    const html = buildReportHtml({
      ...base,
      plots: [
        { title: 'ok', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        { title: 'bad', dataUrl: 'javascript:alert(1)' },
        { title: 'svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
      ],
    })
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('image/svg+xml')
    expect(html).toContain('2 張圖因格式不符')
  })

  it('isSafeImageDataUrl', () => {
    expect(isSafeImageDataUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeImageDataUrl('data:image/png;base64,AA"onerror=x')).toBe(false)
    expect(isSafeImageDataUrl('https://example.com/a.png')).toBe(false)
  })
})
