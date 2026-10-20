import { sectionIdReport } from '@/components/chapter/sectionIds'
import { renderPage } from '@/test/renderPage'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

/**
 * 渲染後的 DOM 也要有穩定的段落 id（docs/dev-conventions.md §1.6）：
 * 每個有標題的 <section> 都有 id、整頁沒有重複的 id。原始碼層級的檢查在 chapterTemplate.test.ts；
 * 這裡看的是實際渲染出來的結果（ChapterSection 之類的包裝元件、同一個 id 被兩個元件各用一次）。
 * 用 Research 模式渲染：ModeGate 內的段落才會出現。
 */
const CHAPTERS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '11b', '12', '13', '14']

/** 還沒補 id 的章節（理由同 chapterTemplate.test.ts 的 EXCEPTIONS） */
const MISSING_IDS_EXCUSED: Record<string, string> = {}

describe('章節頁渲染後：段落 id 穩定且唯一', () => {
  it.each(CHAPTERS)(
    'ch%s：每個有標題的 section 都有 id、整頁沒有重複的 id',
    async (ch) => {
      const { default: Chapter } = await import(`../chapters/ch${ch}/index.tsx`)
      const { container, unmount } = renderPage(<Chapter />, { url: `/ch/${ch}`, mode: 'research' })
      const report = sectionIdReport(container)
      unmount()
      expect(report.count, `ch${ch} 沒有掃到任何有標題的段落`).toBeGreaterThan(5)
      expect(report.duplicates, `ch${ch} 有重複的 id`).toEqual([])
      if (MISSING_IDS_EXCUSED[ch]) {
        expect(report.missing.length, `ch${ch} 已經全部有 id 了：把 MISSING_IDS_EXCUSED 的 ${ch} 拿掉`).toBeGreaterThan(0)
      } else {
        expect(report.missing, `ch${ch} 沒有 id 的段落`).toEqual([])
      }
    },
    180_000,
  )
})

describe('長頁（案例頁、Unified Lab）渲染後：段落 id 穩定且唯一', () => {
  it.each([
    ['案例頁 /case/sspll', () => import('../pages/case-sspll/index'), '/case/sspll'],
    ['Unified Lab /lab', () => import('../pages/lab/index'), '/lab'],
  ] as const)(
    '%s：每個有標題的 section 都有 id、沒有重複的 id',
    async (_name, load, url) => {
      const { default: Page } = await load()
      const { container, unmount } = renderPage(<Page />, { url, mode: 'research' })
      const report = sectionIdReport(container)
      unmount()
      expect(report.count).toBeGreaterThan(20)
      expect(report.duplicates, '重複的 id').toEqual([])
      expect(report.missing, '沒有 id 的段落').toEqual([])
    },
    180_000,
  )
})
