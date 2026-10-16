import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_STORAGE_KEY } from './settings'

/**
 * index.html <head> 的 inline script：第一次繪製之前就把 data-theme 設好（深色使用者不會先閃一下淺色）。
 * 這裡把那段 script 原封不動抓出來在 jsdom 裡執行，確認它和 src/app/settings.tsx 的解析規則一致。
 */
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
const inline = head.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

function installMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({ matches: prefersDark && query.includes('dark'), media: query }) as MediaQueryList) as typeof window.matchMedia
}

function runBoot() {
  // 和瀏覽器一樣以全域（window / document / localStorage）執行
  new Function(inline)()
}

const metaContents = () => [...document.head.querySelectorAll('meta[name="color-scheme"]')].map((m) => m.getAttribute('content'))

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.querySelectorAll('meta[name="color-scheme"]').forEach((m) => m.remove())
})

describe('index.html 的主題啟動 script', () => {
  it('存在於 <head>，讀 lmspll.theme、設 data-theme，而且沒有任何樣式表或模組 script 排在它前面', () => {
    expect(inline).toContain(THEME_STORAGE_KEY)
    expect(inline).toContain('dataset.theme')
    expect(inline).toContain('prefers-color-scheme: dark')
    const at = head.indexOf('<script>')
    expect(at).toBeGreaterThan(0)
    for (const tag of ['<link rel="stylesheet"', '<script type="module"']) {
      const i = head.indexOf(tag)
      expect(i === -1 || i > at, `${tag} 應排在 inline script 之後`).toBe(true)
    }
  })

  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    ['expert', true, 'dark'],
  ] as const)('stored=%s、系統偏好深色=%s → data-theme=%s（和 settings.tsx 一樣）', (stored, prefersDark, expected) => {
    if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored)
    installMatchMedia(prefersDark)
    runBoot()
    expect(document.documentElement.dataset.theme).toBe(expected)
    expect(metaContents()).toEqual([expected])
  })

  it('localStorage 丟例外（隱私模式）時仍跟隨系統偏好', () => {
    installMatchMedia(true)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      runBoot()
    } finally {
      spy.mockRestore()
    }
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('沒有 matchMedia 的環境不會丟錯，預設淺色', () => {
    // @ts-expect-error 模擬舊環境
    window.matchMedia = undefined
    expect(() => runBoot()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
