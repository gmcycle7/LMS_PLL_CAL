/**
 * 案例頁的大型資料檔改成按需載入（./lazyData）：
 *   - 載入器：同一個檔案只載一次、快取後同步取得、內容與靜態 import 時相同；
 *   - hook：資料還沒到時回傳 null，到了自動重新渲染；有 IntersectionObserver 時等區塊接近視窗才開始載入；
 *   - 三個使用者（實驗 A、實驗 B、§15 的 near-grid 區間）在資料到之前先顯示 TS port 的即時結果與佔位，到了之後補上 golden 的部分；
 *   - 原始碼層級：data.ts 與三個使用者不再靜態 import hpd／signmap 的 JSON（否則 chunk 又會變大）。
 *
 * 載入快取是模組層級的，會在同一個測試檔的測試之間保留；所以每個測試各自用「還沒載入過」的 (kind, loop) 組合，順序不要隨意調動：
 *   載入器 → hpd L1；hook（jsdom）→ hpd L3；hook（IntersectionObserver）→ signmap L1；實驗 A → hpd L2；§15 → signmap L2；
 *   實驗 B → signmap L2（已快取）再切到 signmap L3；最後一個測試把全部載完。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HpdJson, LoopKey, SignMapJson } from './data'
import { APPROACH_MARGIN_PX, loadAllSspllData, loadSspllData, peekSspllData, useSspllData } from './lazyData'
import { DataPending } from './common'
import { HpdExplorer, HPD_EXPERIMENT_ID } from './experiments/HpdExplorer'
import { HEAT_ROWS, SIGNMAP_EXPERIMENT_ID, SignMapExplorer, heatRowCount } from './experiments/SignMapExplorer'
import { NearGridIntervals, nearGridIntervals } from './sections/S15Checklist'

import { plotlyMock as P } from '@/test/mocks/plotly'
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

const DIR = join(process.cwd(), 'src/pages/case-sspll')
const src = (f: string) => readFileSync(join(DIR, f), 'utf8')

function renderWithRouter(ui: ReactElement) {
  return renderPage(ui, { url: '/case/sspll' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('按需載入的資料檔（lazyData）', () => {
  it('載入器：一開始是空的；載入後同步取得、同一個檔案只載一次（回傳同一個物件）；內容就是 JSON 本身', async () => {
    expect(peekSspllData('hpd', 'L1')).toBeNull()
    const p1 = loadSspllData('hpd', 'L1')
    const p2 = loadSspllData('hpd', 'L1')
    expect(p2).toBe(p1) // 載入中再要一次，拿到的是同一個 promise
    const d = await p1
    expect(await loadSspllData('hpd', 'L1')).toBe(d)
    expect(peekSspllData('hpd', 'L1')).toBe(d)
    expect(d.loop).toBe('L1')
    expect(d.f_MHz).toHaveLength(1500)
    expect(d.f_MHz[d.f_MHz.length - 1]).toBe(2000)
  })

  it('hook：沒有 IntersectionObserver（jsdom）時立刻載入；已快取的第一次渲染就是 ready，沒載入過的先是 loading（null），資料到了自動重新渲染', async () => {
    function Probe({ loop }: { loop: LoopKey }) {
      const { data, status } = useSspllData('hpd', loop)
      return (
        <div data-testid="probe" data-status={status}>
          {data ? `${data.loop}:${data.f_MHz.length}` : '-'}
        </div>
      )
    }
    const probe = () => screen.getByTestId('probe')
    // hpd L1 已被上一個測試載入 ⇒ 第一次渲染就同步拿到
    const { rerender } = render(<Probe loop="L1" />)
    expect(probe().getAttribute('data-status')).toBe('ready')
    expect(probe().textContent).toBe('L1:1500')
    // 換成還沒載入的 hpd L3：先是 loading（沒有資料），到了才換成 L3
    expect(peekSspllData('hpd', 'L3')).toBeNull()
    rerender(<Probe loop="L3" />)
    expect(probe().getAttribute('data-status')).toBe('loading')
    expect(probe().textContent).toBe('-')
    await waitFor(() => expect(probe().getAttribute('data-status')).toBe('ready'))
    expect(probe().textContent).toBe('L3:1500')
  })

  it('hook：有 IntersectionObserver 時，區塊離視窗還遠就不載入（idle）；進入 900 px 範圍內才開始載入', async () => {
    const io: { cb: ((entries: { isIntersecting: boolean }[]) => void) | null; observed: Element[]; options: unknown[] } = { cb: null, observed: [], options: [] }
    class FakeIO {
      constructor(c: (entries: { isIntersecting: boolean }[]) => void, o?: unknown) {
        io.cb = c
        io.options.push(o)
      }
      observe(el: Element) {
        io.observed.push(el)
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    function Probe() {
      const { data, status } = useSspllData('signmap', 'L1', 'probe-block')
      return (
        <div id="probe-block" data-testid="probe" data-status={status}>
          {data ? data.loop : '-'}
        </div>
      )
    }
    expect(peekSspllData('signmap', 'L1')).toBeNull()
    render(<Probe />)
    expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('idle')
    expect(io.observed).toEqual([document.getElementById('probe-block')])
    expect(io.options).toEqual([{ rootMargin: `${APPROACH_MARGIN_PX}px 0px` }])
    expect(APPROACH_MARGIN_PX).toBeGreaterThanOrEqual(600)
    // 還沒進入範圍：什麼都沒發生，也沒有開始載入
    await act(async () => io.cb?.([{ isIntersecting: false }]))
    expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('idle')
    expect(peekSspllData('signmap', 'L1')).toBeNull()
    // 進入範圍：開始載入，之後 ready
    await act(async () => io.cb?.([{ isIntersecting: true }]))
    await waitFor(() => expect(screen.getByTestId('probe').getAttribute('data-status')).toBe('ready'))
    expect(screen.getByTestId('probe').textContent).toBe('L1')
    expect(peekSspllData('signmap', 'L1')).not.toBeNull()
  })

  it('實驗 A（HpdExplorer）：golden 的 hpd_L2.json 到之前只有 TS port 的實線與設計指標；到了之後補上點線與「TS port 對 golden」的比對指標', async () => {
    expect(peekSspllData('hpd', 'L2')).toBeNull()
    const { container } = renderWithRouter(<HpdExplorer />)
    const exp = container.querySelector(`#exp-${HPD_EXPERIMENT_ID}`) as HTMLElement
    // 資料還沒到：TS port 的指標照常顯示，比對 golden 的那一列還沒有
    expect(exp.textContent).toContain('反號帶')
    expect(exp.textContent).toContain('0.0382') // L2 的 K_i（標稱設計）
    expect(exp.textContent).not.toContain('（1500 點）')
    // 資料到了：比對指標出現，而且 TS port 與 golden 一致
    await waitFor(() => expect(exp.textContent).toContain('（1500 點）'))
    const traceNames = () => P.react.mock.calls.flatMap((c) => ((c as unknown as [unknown, { name?: string }[]])[1] ?? []).map((t) => t.name ?? ''))
    await waitFor(() => expect(traceNames().some((n) => n.includes('golden JSON'))).toBe(true))
    expect(exp.querySelector('.c-check-mismatch')).toBeNull()
    expect(exp.querySelector('.c-check-ok')).not.toBeNull()
    expect(peekSspllData('hpd', 'L2')).not.toBeNull()
  })

  it('§15 的 near-grid 區間（NearGridIntervals）：signmap_L2.json 到之前顯示「載入中」，到了之後是和靜態 import 時相同的區間', async () => {
    expect(peekSspllData('signmap', 'L2')).toBeNull()
    const { container } = render(
      <p>
        <NearGridIntervals column="LSinf" />
        {'／'}
        <NearGridIntervals column="LSinf_ac" />
      </p>,
    )
    expect(container.textContent).toContain('載入中')
    await waitFor(() => expect(container.textContent).not.toContain('載入中'))
    expect(container.textContent).toBe('466.5–508.5、1468.5–1499.5／490.5–513.5、1487.5–1512.5')
    const map = peekSspllData('signmap', 'L2') as SignMapJson
    expect(nearGridIntervals(map, 'LSinf')).toEqual([
      [466.5, 508.5],
      [1468.5, 1499.5],
    ])
    expect(nearGridIntervals(map, 'LSinf_ac')).toEqual([
      [490.5, 513.5],
      [1487.5, 1512.5],
    ])
  })

  it('實驗 B（SignMapExplorer）：已快取的迴路直接畫圖；切到還沒載入的迴路（L3）先顯示佔位，資料到了才畫 sign map 與熱圖', async () => {
    expect(peekSspllData('signmap', 'L3')).toBeNull()
    const { container } = renderWithRouter(<SignMapExplorer />)
    const exp = container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement
    // L2 已在快取：沒有佔位，golden signmap 的比對值出現在指標表
    expect(exp.querySelector('.cs-data-pending')).toBeNull()
    expect(exp.textContent).toContain('golden signmap：')
    // 切到 L3
    const loopSelect = Array.from(exp.querySelectorAll('select.c-select-input')).find((sel) => Array.from((sel as HTMLSelectElement).options).some((o) => (o.textContent ?? '').startsWith('L3：'))) as HTMLSelectElement
    expect(loopSelect).toBeTruthy()
    const l3 = Array.from(loopSelect.options).find((o) => (o.textContent ?? '').startsWith('L3：'))!
    fireEvent.change(loopSelect, { target: { value: l3.value } })
    // L3 的 signmap_L3.json 還沒載入：兩張 sign map 圖的位置先放佔位，TS port 的結果（上面的長條圖與指標表）不受影響
    expect(exp.querySelectorAll('.cs-data-pending')).toHaveLength(2)
    expect(exp.textContent).toContain('golden sign map 載入中')
    expect(exp.textContent).toContain('sign map 熱圖 載入中')
    await waitFor(() => expect(exp.querySelector('.cs-data-pending')).toBeNull())
    expect(peekSspllData('signmap', 'L3')).not.toBeNull()
    // 載入完成之後 TS port 的結果沒有消失、也沒有 NaN
    expect(exp.textContent).not.toMatch(/NaN|undefined|Infinity/)
    expectNoTexErrors(exp)
  })

  it('佔位元件：載入中與載入失敗各說一句話，並預留圖的高度（版面不跳動）', () => {
    const { container, rerender } = render(<DataPending status="loading" what="golden sign map" height={340} />)
    const el = container.querySelector('.cs-data-pending') as HTMLElement
    expect(el.textContent).toBe('golden sign map 載入中…')
    expect(el.style.minHeight).toBe('340px')
    expect(el.getAttribute('role')).toBe('status')
    rerender(<DataPending status="error" what="golden sign map" height={340} />)
    expect(container.textContent).toContain('載入失敗')
    expect(container.textContent).not.toContain('載入中')
  })

  it('熱圖的列數：heatRowCount 與實際有資料的列相同（L1 少兩列 P-only），佔位的高度才會和載入後的圖一致', async () => {
    const { SIGNMAP } = await loadAllSspllData()
    for (const k of ['L1', 'L2', 'L3'] as LoopKey[]) {
      const n = HEAT_ROWS.filter((row) => Array.isArray(SIGNMAP[k][row.key])).length
      expect(heatRowCount(k), k).toBe(n)
    }
    expect(heatRowCount('L1')).toBe(14)
    expect(heatRowCount('L2')).toBe(16)
  })

  it('載入完成的資料與檔案本身一致：hpd 1500 點、signmap 2000 點（格點 j − 0.5 MHz）、三個迴路都在', async () => {
    const { HPD, SIGNMAP } = await loadAllSspllData()
    for (const k of ['L1', 'L2', 'L3'] as LoopKey[]) {
      const h: HpdJson = HPD[k]
      const m: SignMapJson = SIGNMAP[k]
      expect(h.loop).toBe(k)
      expect(m.loop).toBe(k)
      expect(h.f_MHz).toHaveLength(1500)
      expect(h.ReH).toHaveLength(1500)
      expect(m.f_MHz).toHaveLength(2000)
      expect(m.f_MHz[0]).toBe(0.5)
      expect(m.f_MHz[1999]).toBe(1999.5)
      expect(m.kP).toHaveLength(2000)
    }
    // 與直接讀檔案相同（沒有改動任何數字）
    for (const k of ['L1', 'L2', 'L3']) {
      const raw = JSON.parse(readFileSync(join(process.cwd(), `src/data/sspll/signmap_${k}.json`), 'utf8')) as SignMapJson
      expect(SIGNMAP[k as LoopKey].kP).toEqual(raw.kP)
      expect(SIGNMAP[k as LoopKey].LSinf_ac).toEqual(raw.LSinf_ac)
      const rawH = JSON.parse(readFileSync(join(process.cwd(), `src/data/sspll/hpd_${k}.json`), 'utf8')) as HpdJson
      expect(HPD[k as LoopKey].ReH).toEqual(rawH.ReH)
    }
  })
})

describe('chunk 大小的守門：大型 JSON 不可以回到靜態 import', () => {
  const BIG = /@\/data\/sspll\/(?:hpd_L\d|signmap_L\d)\.json/
  const STATIC_BIG = /^\s*import\b[^'"\n]*from\s+['"][^'"]*(?:hpd_L\d|signmap_L\d)\.json['"]/m

  it('只有 lazyData.ts 引用 hpd_L*.json／signmap_L*.json，而且是動態 import()；data.ts 與三個使用者沒有靜態 import', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(join(DIR, d), { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(join(d, e.name))
      }
    }
    walk('.')
    expect(files.length).toBeGreaterThan(20)
    const users = files.filter((f) => BIG.test(src(f)))
    expect(users).toEqual(['lazyData.ts'])
    const lazy = src('lazyData.ts')
    for (const kind of ['hpd', 'signmap']) for (const k of ['L1', 'L2', 'L3']) expect(lazy).toContain(`import('@/data/sspll/${kind}_${k}.json')`)
    for (const f of files) expect(src(f), f).not.toMatch(STATIC_BIG)
    // data.ts 只留小檔案：params 與 pred_vs_sim 仍是同步 import，hpd／signmap 只剩型別
    const data = src('data.ts')
    expect(data).toContain("import paramsJson from '@/data/sspll/params.json'")
    expect(data).toContain("import predJson from '@/data/sspll/pred_vs_sim.json'")
    expect(data).not.toMatch(/export const (?:HPD|SIGNMAP)\b/)
    expect(data).toContain('export interface HpdJson')
    expect(data).toContain('export interface SignMapJson')
  })

  it('三個使用者都經過 useSspllData；實驗 A、B 以自己的 experiment 區塊 id 當 watchId（接近視窗才載入）', () => {
    expect(src('experiments/HpdExplorer.tsx')).toContain("useSspllData('hpd', dP.loop, `exp-${HPD_EXPERIMENT_ID}`)")
    expect(src('experiments/SignMapExplorer.tsx')).toContain("useSspllData('signmap', dP.loop, `exp-${SIGNMAP_EXPERIMENT_ID}`)")
    expect(src('sections/S15Checklist.tsx')).toContain("useSspllData('signmap', 'L2', 'cs-15')")
    // watchId 對應的 DOM id 真的存在：ExperimentShell 的 section id、§15 的 Section id
    expect(readFileSync(join(process.cwd(), 'src/components/ExperimentShell.tsx'), 'utf8')).toContain('id={`exp-${id}`}')
    expect(src('sections/S15Checklist.tsx')).toContain('id="cs-15"')
  })
})
