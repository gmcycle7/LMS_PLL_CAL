// @vitest-environment jsdom
import { createElement as h, StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  experimentAnchorId,
  experimentRoute,
  experimentShareUrl,
  findPresetByKey,
  parseExperimentUrl,
  presetKey,
  readExperimentUrl,
  useExperimentUrlSync,
  writeExperimentUrl,
} from './experimentUrl'

const ID = 'lms-playground'
const A = experimentAnchorId(ID)

function setHash(hash: string) {
  window.history.replaceState({ idx: 7 }, '', hash)
}

afterEach(() => {
  cleanup()
  setHash('#/')
})

describe('presetKey', () => {
  it('id 優先；沒有 id 就用名稱的 slug', () => {
    expect(presetKey({ name: '穩定 Case', id: 'lms-stable' })).toBe('lms-stable')
    expect(presetKey({ name: '  Big Step  Case ' })).toBe('big-step-case')
  })
  it('findPresetByKey 依 key 找', () => {
    const list = [{ name: 'A', id: 'a1' }, { name: 'B', id: 'b2' }]
    expect(findPresetByKey(list, 'b2')).toBe(list[1])
    expect(findPresetByKey(list, 'zzz')).toBeUndefined()
    expect(findPresetByKey(undefined, 'a1')).toBeUndefined()
  })
})

describe('parseExperimentUrl／experimentRoute', () => {
  it('a 指著這個實驗：讀出 p 與 seed（有沒有 # 都可以；a 用 DOM id 或實驗 id 都接受）', () => {
    expect(parseExperimentUrl(`#/ch/01?a=${A}&p=lms-stable&seed=1234`, ID)).toEqual({ presetId: 'lms-stable', seed: 1234 })
    expect(parseExperimentUrl(`/ch/01?a=${ID}&seed=0`, ID)).toEqual({ seed: 0 })
  })
  it('a 指著別的實驗或沒有 a：p／seed 不算；沒有任何資訊回傳 null', () => {
    expect(parseExperimentUrl('#/ch/01?a=exp-other&p=x&seed=5', ID)).toBeNull()
    expect(parseExperimentUrl('#/ch/01?p=x&seed=5', ID)).toBeNull()
    expect(parseExperimentUrl(`#/ch/01?a=${A}`, ID)).toBeNull()
    expect(parseExperimentUrl('#/ch/01', ID)).toBeNull()
  })
  it('seed 必須是 0–4294967295 的整數，其餘忽略', () => {
    expect(parseExperimentUrl(`#/c?a=${A}&seed=4294967295`, ID)).toEqual({ seed: 4294967295 })
    for (const bad of ['4294967296', '-1', '1.5', 'abc', '']) expect(parseExperimentUrl(`#/c?a=${A}&seed=${bad}`, ID)).toBeNull()
  })
  it('相容 ch01 舊連結 ?preset=<id>：p 不存在時當作 p（不看 a）；p 存在時 p 優先', () => {
    expect(parseExperimentUrl('#/ch/01?preset=lms-big', ID)).toEqual({ presetId: 'lms-big' })
    expect(parseExperimentUrl(`#/ch/01?a=${A}&p=new&preset=old`, ID)).toEqual({ presetId: 'new' })
  })
  it('experimentRoute：寫 a／p／seed、拿掉 f 與舊 preset、保留其他參數；沒值的 p／seed 刪除', () => {
    expect(experimentRoute('#/ch/01', ID, { presetId: 'x', seed: 9 })).toBe(`#/ch/01?a=${A}&p=x&seed=9`)
    expect(experimentRoute('#/ch/01?f=F-01.1&preset=old&keep=1', ID, { presetId: 'x' })).toBe(`#/ch/01?keep=1&a=${A}&p=x`)
    expect(experimentRoute(`#/ch/01?a=${A}&p=x&seed=9`, ID, {})).toBe(`#/ch/01?a=${A}`)
    expect(experimentRoute('', ID, { seed: 1 })).toBe(`#/?a=${A}&seed=1`)
  })
  it('experimentRoute：中文／特殊字元的 preset id 會被編碼，讀回來一致', () => {
    const r = experimentRoute('#/ch/01', ID, { presetId: '穩定 case&1' })
    expect(parseExperimentUrl(r, ID)).toEqual({ presetId: '穩定 case&1' })
  })
})

describe('writeExperimentUrl／readExperimentUrl（replaceState）', () => {
  it('不新增歷史紀錄、保留 history.state', () => {
    setHash('#/ch/01')
    const len = window.history.length
    expect(writeExperimentUrl(ID, { presetId: 'p1', seed: 3 })).toBe(true)
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&p=p1&seed=3`)
    expect(window.history.length).toBe(len)
    expect(window.history.state).toEqual({ idx: 7 })
    expect(readExperimentUrl(ID)).toEqual({ presetId: 'p1', seed: 3 })
  })
  it('內容沒變就不寫（回傳 false）', () => {
    setHash('#/ch/01')
    writeExperimentUrl(ID, { presetId: 'p1' })
    expect(writeExperimentUrl(ID, { presetId: 'p1' })).toBe(false)
  })
})

describe('experimentShareUrl', () => {
  const loc = { origin: 'https://x.example', pathname: '/lab/', search: '', hash: '#/ch/01?f=F-01.2' }
  it('絕對網址 = origin + pathname + hash 路由；參數用傳入的值重算，不依賴 window 上已寫的內容', () => {
    expect(experimentShareUrl(ID, { presetId: 'p1', seed: 42 }, loc)).toBe(`https://x.example/lab/#/ch/01?a=${A}&p=p1&seed=42`)
    expect(experimentShareUrl(ID, {}, loc)).toBe(`https://x.example/lab/#/ch/01?a=${A}`)
  })
  it('外層 search（部署時的 ?v=…）保留在 # 之前', () => {
    expect(experimentShareUrl(ID, { seed: 1 }, { ...loc, search: '?v=2' })).toBe(`https://x.example/lab/?v=2#/ch/01?a=${A}&seed=1`)
  })
  it('預設讀 window.location（jsdom：http://localhost:3000/）', () => {
    setHash('#/ch/05')
    expect(experimentShareUrl(ID, { seed: 8 })).toBe(`${window.location.origin}${window.location.pathname}#/ch/05?a=${A}&seed=8`)
  })
})

/* ───────────── 假的 ExperimentShell：驗證整合方式 ───────────── */

interface FakePreset {
  name: string
  id?: string
  params: { seed?: number; mu: number }
}
const PRESETS: FakePreset[] = [
  { name: '穩定', id: 'lms-stable', params: { mu: 0.1 } },
  { name: '大步長', id: 'lms-big', params: { mu: 1.5, seed: 77 } },
]

/** ExperimentShell 的整合方式（docs/dev/infra-api.md「分享與回連」）：<select> 呼叫 loadPreset，seed 欄呼叫 onSeedChange */
function FakeShell({ onApplied }: { onApplied?: (kind: string, v: unknown) => void }) {
  const [mu, setMu] = useState(0.5)
  const [seed, setSeed] = useState(1)
  const sync = useExperimentUrlSync<FakePreset>({
    experimentId: ID,
    seed,
    onSeedChange: (s) => {
      onApplied?.('seed', s)
      setSeed(s)
    },
    presets: PRESETS,
    onLoadPreset: (p) => {
      onApplied?.('preset', p.id)
      setMu(p.params.mu)
      if (p.params.seed !== undefined) setSeed(p.params.seed)
    },
  })
  return h(
    'div',
    null,
    h(
      'select',
      { 'aria-label': 'preset', value: '', onChange: (e: { target: { value: string } }) => sync.loadPreset(PRESETS[Number(e.target.value)]) },
      h('option', { value: '' }, '載入 preset…'),
      PRESETS.map((p, i) => h('option', { key: p.id, value: String(i) }, p.name)),
    ),
    h('input', { 'aria-label': 'seed', value: String(seed), onChange: (e: { target: { value: string } }) => setSeed(Number(e.target.value)) }),
    h('output', { 'data-testid': 'mu' }, String(mu)),
    h('output', { 'data-testid': 'cur' }, sync.presetId ?? '-'),
  )
}

describe('useExperimentUrlSync（假的 ExperimentShell）', () => {
  it('只是打開頁面：不動網址', () => {
    setHash('#/ch/01')
    render(h(StrictMode, null, h(FakeShell)))
    expect(window.location.hash).toBe('#/ch/01')
  })

  it('載入 preset：網址有 a、p（seed 沒碰過就不寫）；不新增歷史紀錄', () => {
    setHash('#/ch/01')
    const len = window.history.length
    render(h(FakeShell))
    fireEvent.change(screen.getByLabelText('preset'), { target: { value: '0' } })
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&p=lms-stable`)
    expect(screen.getByTestId('mu').textContent).toBe('0.1')
    expect(window.history.length).toBe(len)
  })

  it('載入的 preset 自帶 seed：seed 也寫進網址；之後再換 preset 會更新 p', () => {
    setHash('#/ch/01')
    render(h(FakeShell))
    fireEvent.change(screen.getByLabelText('preset'), { target: { value: '1' } })
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&p=lms-big&seed=77`)
    fireEvent.change(screen.getByLabelText('preset'), { target: { value: '0' } })
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&p=lms-stable&seed=77`)
  })

  it('改 seed：網址有 seed（沒有選 preset 時只有 a 與 seed）', () => {
    setHash('#/ch/01')
    render(h(FakeShell))
    fireEvent.change(screen.getByLabelText('seed'), { target: { value: '2024' } })
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&seed=2024`)
  })

  it('掛載時網址有 p 與 seed：套用 preset 再套用 seed（明確的 seed 勝過 preset 自帶的），網址維持原樣', () => {
    setHash(`#/ch/01?a=${A}&p=lms-big&seed=5`)
    const applied: [string, unknown][] = []
    render(h(StrictMode, null, h(FakeShell, { onApplied: (k: string, v: unknown) => applied.push([k, v]) })))
    expect(screen.getByTestId('mu').textContent).toBe('1.5')
    expect((screen.getByLabelText('seed') as HTMLInputElement).value).toBe('5')
    expect(screen.getByTestId('cur').textContent).toBe('lms-big')
    // 順序：preset 在前、seed 在後
    expect(applied.slice(0, 2)).toEqual([['preset', 'lms-big'], ['seed', 5]])
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&p=lms-big&seed=5`)
  })

  it('重新整理＝卸載後再掛載：preset 與 seed 還在', () => {
    setHash('#/ch/01')
    const first = render(h(FakeShell))
    fireEvent.change(screen.getByLabelText('preset'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('seed'), { target: { value: '99' } })
    const url = window.location.hash
    expect(url).toBe(`#/ch/01?a=${A}&p=lms-stable&seed=99`)
    first.unmount()
    render(h(FakeShell))
    expect(screen.getByTestId('mu').textContent).toBe('0.1')
    expect((screen.getByLabelText('seed') as HTMLInputElement).value).toBe('99')
    expect(window.location.hash).toBe(url)
  })

  it('舊式 ?preset=<id>（ch01 既有連結）：套用，並在使用者改動後換成新參數', () => {
    setHash('#/ch/01?preset=lms-big')
    render(h(FakeShell))
    expect(screen.getByTestId('mu').textContent).toBe('1.5')
    expect(window.location.hash).toContain('p=lms-big')
    expect(window.location.hash).not.toContain('preset=')
  })

  it('網址的 preset 不屬於這個實驗（找不到）：什麼都不套用、不丟錯', () => {
    setHash(`#/ch/01?a=${A}&p=does-not-exist`)
    render(h(FakeShell))
    expect(screen.getByTestId('mu').textContent).toBe('0.5')
    expect(screen.getByTestId('cur').textContent).toBe('-')
  })

  it('a 指著別的實驗：這個實驗不理會 p／seed', () => {
    setHash('#/ch/01?a=exp-other&p=lms-big&seed=5')
    render(h(FakeShell))
    expect(screen.getByTestId('mu').textContent).toBe('0.5')
    expect((screen.getByLabelText('seed') as HTMLInputElement).value).toBe('1')
  })

  it('act 之外的 StrictMode 重複掛載不會重複寫入出不同的結果', () => {
    setHash('#/ch/01')
    render(h(StrictMode, null, h(FakeShell)))
    act(() => {
      fireEvent.change(screen.getByLabelText('seed'), { target: { value: '3' } })
    })
    expect(window.location.hash).toBe(`#/ch/01?a=${A}&seed=3`)
  })
})
