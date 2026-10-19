import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SettingsProvider } from '@/app/settings'
import { cornerFeasibleScan, cornerJudge } from '../judges'
import { CORNER_JUDGE_DEFAULT, CORNER_LOCAL_PRESETS, CornerJudgeExperiment, refLineName } from './CornerJudge'
import { EvidenceLabExperiment } from './EvidenceLab'
import { FixedPointJudgeExperiment } from './FixedPointJudge'
import { MimoJudgeExperiment } from './MimoJudgeLab'
import { PolarityPerturbExperiment } from './PolarityPerturb'
import { SspllJacobianExperiment } from './SspllJacobian'

vi.mock('plotly.js-cartesian-dist-min', () => ({
  default: {
    react: vi.fn(async () => undefined),
    purge: vi.fn(),
    toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    downloadImage: vi.fn(async () => ''),
    Plots: { resize: vi.fn() },
    Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
  },
}))

function mount(node: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/signoff']}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>,
  )
}

/** 警告框的純文字（把 KaTeX 的 MathML／HTML 重複內容去掉，只留一般文字節點）。 */
function warningTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.c-exp-warnings p')).map((p) =>
    Array.from(p.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('…'),
  )
}

/** 以名稱載入 ExperimentShell 的 preset（<select> 的 option 文字）。 */
function loadPreset(container: HTMLElement, namePart: string) {
  const sel = container.querySelector('.c-exp-presets select') as HTMLSelectElement
  const opt = Array.from(sel.options).find((o) => o.textContent?.includes(namePart))
  expect(opt, namePart).toBeTruthy()
  fireEvent.change(sel, { target: { value: (opt as HTMLOptionElement).value } })
}

const verdictKinds = (container: HTMLElement) => Array.from(container.querySelectorAll('.so-kv .so-verdict')).map((e) => e.className.replace('so-verdict so-verdict-', ''))
/** 交叉比對列的三個狀態：[Analytic, Monte Carlo, Fixed-point]（'ok' | 'mismatch' | 'not-implemented' | 'n/a'） */
const crossCheck = (container: HTMLElement) => Array.from(container.querySelectorAll('.c-exp-crosscheck .c-check')).map((e) => e.className.replace('c-check c-check-', ''))
const noTexErrors = (container: HTMLElement) => expect(Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)).toEqual([])

afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('Polarity Perturbation 實驗（A／B／C 同 seed 對照）', () => {
  it('T06/T07: 掛載後三組的參數都生效——A 對齊（通過）、B 未對齊（極性錯誤＋解釋）、C 接反（極性錯誤＋解釋）', async () => {
    const { container } = mount(<PolarityPerturbExperiment />)
    await waitFor(() => expect(container.querySelectorAll('.so-kv .so-verdict').length).toBe(3))
    // 迴歸：useCases.addCase() 會蓋掉同一個 tick 內較早的 update()；Case B 曾經因此與 A 相同
    await waitFor(() => expect(verdictKinds(container)).toEqual(['ok', 'bad', 'bad']))
    const w = warningTexts(container)
    expect(w.some((t) => t.startsWith('Case B：C ≤ 0：更新極性錯誤'))).toBe(true)
    expect(w.some((t) => t.startsWith('Case C：位元映射錯誤'))).toBe(true)
    expect(w.some((t) => t.startsWith('Case A'))).toBe(false)
    noTexErrors(container)
  })

  it('preset 在 3 組 → 2 組 → 3 組之間切換時，每一組的參數都正確套用', async () => {
    const { container } = mount(<PolarityPerturbExperiment />)
    await waitFor(() => expect(verdictKinds(container)).toEqual(['ok', 'bad', 'bad']))
    // 2 組：±1 code、identity path、Δ = σ_v（正確映射 vs 未映射）——兩組極性都正確，但都有「Δ 太大」的警告
    loadPreset(container, 'identity path')
    await waitFor(() => expect(container.querySelectorAll('.so-kv .so-verdict').length).toBe(2))
    await waitFor(() => expect(verdictKinds(container)).toEqual(['ok', 'ok']))
    const w2 = warningTexts(container)
    expect(w2.filter((t) => t.includes('erf S 曲線的三次項')).length).toBe(2)
    expect(w2.some((t) => t.startsWith('Case B：位元映射錯誤'))).toBe(true)
    // 回到 3 組：需要先補回 Case C 再套用參數
    loadPreset(container, 'A/B/C')
    await waitFor(() => expect(container.querySelectorAll('.so-kv .so-verdict').length).toBe(3))
    await waitFor(() => expect(verdictKinds(container)).toEqual(['ok', 'bad', 'bad']))
    noTexErrors(container)
  })
})

describe('所有 preset 都能載入，且每個狀態的警告／指標／標題都沒有 KaTeX 解析錯誤', () => {
  const all: [string, () => ReactNode][] = [
    ['Polarity', () => <PolarityPerturbExperiment />],
    ['SSPLL', () => <SspllJacobianExperiment />],
    ['Evidence', () => <EvidenceLabExperiment />],
    ['Corner', () => <CornerJudgeExperiment />],
    ['Fixed-point', () => <FixedPointJudgeExperiment />],
    ['MIMO', () => <MimoJudgeExperiment />],
  ]
  for (const [name, make] of all) {
    it(`${name}：逐一載入本地 presets`, async () => {
      const { container } = mount(make())
      const sel = container.querySelector('.c-exp-presets select') as HTMLSelectElement
      const n = sel.options.length - 1
      expect(n).toBeGreaterThanOrEqual(3)
      for (let i = 0; i < n; i++) {
        fireEvent.change(sel, { target: { value: String(i) } })
        // 等 useDeferredValue 的重算完成（指標表至少有一列）
        await waitFor(() => expect(container.querySelectorAll('.c-exp-results table tbody tr, .c-exp-body table tbody tr').length).toBeGreaterThan(0))
        noTexErrors(container)
        // 警告字串中的 `$…$` 都已轉成 KaTeX，不殘留成對的 $
        for (const t of warningTexts(container)) expect(/\$[^$]+\$/.test(t), t).toBe(false)
        // 交叉比對：Analytic 欄是「算出來」的 ok（兩條獨立的計算路徑相符），任何 preset 都不應出現 mismatch
        const cc = crossCheck(container)
        expect(cc).toHaveLength(3)
        expect(cc[0], `${name} preset ${i}`).toBe('ok')
        expect(cc, `${name} preset ${i}`).not.toContain('mismatch')
      }
    })
  }

  it('交叉比對的狀態誠實：沒有實作的欄位標 Not implemented／n/a，不會寫死成 ok', async () => {
    const expected: [string, () => ReactNode, string[]][] = [
      ['Polarity', () => <PolarityPerturbExperiment />, ['ok', 'ok', 'not-implemented']],
      ['SSPLL', () => <SspllJacobianExperiment />, ['ok', 'ok', 'not-implemented']],
      ['Evidence', () => <EvidenceLabExperiment />, ['ok', 'ok', 'n/a']],
      ['Corner', () => <CornerJudgeExperiment />, ['ok', 'ok', 'n/a']],
      ['Fixed-point', () => <FixedPointJudgeExperiment />, ['ok', 'n/a', 'ok']],
      ['MIMO', () => <MimoJudgeExperiment />, ['ok', 'n/a', 'not-implemented']], // Monte Carlo：確定性的矩陣計算，不適用（附說明）
    ]
    for (const [name, make, want] of expected) {
      const { container, unmount } = mount(make())
      // Corner 的 Monte Carlo 欄在參數停 300 ms 後才啟動、再跑 8 seeds 的 blockLms：給它較長的時間
      await waitFor(() => expect(crossCheck(container), name).toEqual(want), { timeout: 20_000 })
      unmount()
    }
  })

  it('T03: 證據強度的 Monte Carlo 欄是真的比對：樣本路徑 ln|δ_n/δ_0| 的平均 vs n·λ(μ)，附差值與 4 se 容許', async () => {
    const { container } = mount(<EvidenceLabExperiment />)
    const mc = container.querySelectorAll('.c-exp-crosscheck .c-check')[1] as HTMLElement
    expect(mc.className).toContain('c-check-ok')
    const note = mc.getAttribute('title') ?? ''
    // title 是 accessibleText 之後的可念文字（$…$ 已轉成「正負 4 se 等於 3.6」這樣的字句）
    const m = /相差 (-?[\d.]+(?:e[+-]?\d+)?)（容許 正負 4 se 等於 ([\d.]+)）/.exec(note)
    expect(m, note).toBeTruthy()
    expect(Math.abs(Number(m![1]))).toBeLessThanOrEqual(Number(m![2]))
    expect(Number(m![2])).toBeGreaterThan(0)
    noTexErrors(container)
  })
})

describe('其他判斷器的失效模式（解釋型警告）', () => {
  it('SSPLL：PHOS 路徑變號 ⇒ PHOS 判為相反並解釋；強耦合大步長 ⇒ 各自穩定、聯合發散', async () => {
    const { container } = mount(<SspllJacobianExperiment />)
    // 四個判決：GOS 極性、PHOS 極性、聯合穩定、可辨識性
    await waitFor(() => expect(verdictKinds(container)).toEqual(['ok', 'ok', 'ok', 'ok']))
    expect(warningTexts(container)).toEqual([])
    loadPreset(container, 'PHOS 路徑變號')
    await waitFor(() => expect(verdictKinds(container).slice(0, 2)).toEqual(['ok', 'bad']))
    expect(warningTexts(container).some((t) => t.startsWith('C ≤ 0：PHOS'))).toBe(true)
    loadPreset(container, '強耦合')
    await waitFor(() => expect(verdictKinds(container).slice(0, 3)).toEqual(['ok', 'ok', 'bad']))
    expect(warningTexts(container).some((t) => t.includes('各 loop 單獨穩定') && t.includes('一起更新時發散'))).toBe(true)
    // 不可辨識：ρ_GP = 0.995 ⇒ σ_min(Ĵ) 在量測誤差內與 0 無法區分
    loadPreset(container, '不可辨識')
    await waitFor(() => expect(verdictKinds(container)[3]).toBe('warn'))
    expect(warningTexts(container).some((t) => t.includes('不可辨識') && t.includes('沒有顯著大於 0'))).toBe(true)
    noTexErrors(container)
  })

  it('Corner：有效相位超過 90° 的 corner ⇒「C ≤ 0」警告，且沒有任何可行的 learning rate', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    expect(warningTexts(container)).toEqual([])
    loadPreset(container, '有效相位超過 90°')
    await waitFor(() => expect(warningTexts(container).some((t) => t.startsWith('C ≤ 0：「low-BW mode」'))).toBe(true))
    expect(warningTexts(container).some((t) => t.startsWith('在掃描範圍內沒有任何'))).toBe(true)
    noTexErrors(container)
  })

  it('A6：Corner 結果表多一欄「ρ 漸近估計」；k95 欄是逐 block 的數字（d = 3、μ = 30：TT 25°C 21 vs 估計 24、FF 125°C 47 vs 53）', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    const cells = () =>
      Array.from(container.querySelectorAll('.so-corner-table tbody tr')).map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'))
        return { name: tds[0].textContent, k95: tds[5].textContent, asym: tds[6].textContent }
      })
    const heads = Array.from(container.querySelectorAll('.so-corner-table thead th')).map((th) => th.textContent ?? '')
    expect(heads).toHaveLength(9)
    expect(heads[5]).toContain('k')
    expect(heads[6]).toContain('漸近')
    expect(heads[6]).toContain('估計')
    expect(cells().map((c) => [c.k95, c.asym])).toEqual([['33', '33'], ['54', '54'], ['22', '22'], ['71', '71']])
    loadPreset(container, 'commit latency d = 3')
    await waitFor(() => expect(cells().map((c) => c.k95)).toEqual(['21', '15', '47', '12']))
    expect(cells().map((c) => c.asym)).toEqual(['24', '15', '53', '12'])
    // 判定不變：B = 120 都來得及；沒有「只看 ρ 會誤判」的警告
    expect(warningTexts(container).some((t) => t.includes('只看'))).toBe(false)
    noTexErrors(container)
  })

  it('A6：本地四個 preset 都沒有 pass/fail 翻盤——逐 block 的 k95 與 ρ 漸近估計對 B 的判定相同，格點上的可行 μ 區間也相同', () => {
    for (const pr of CORNER_LOCAL_PRESETS) {
      const p = { ...CORNER_JUDGE_DEFAULT, ...(pr.params as Partial<typeof CORNER_JUDGE_DEFAULT>) }
      const o = { d: p.d, pmTargetDeg: p.pmTargetDeg, B: p.B, N: p.N, sigmaWMax: p.sigmaWMax }
      const rows = cornerJudge(p.corners, { mu: p.mu, ...o })
      for (const r of rows) expect(r.ok.settle, `${pr.name}：${r.name}`).toBe(r.settleAsym <= p.B)
      const scan = cornerFeasibleScan(p.corners, o, undefined, [p.mu])
      // 舊判法（漸近估計）在同一組格點上的可行集合
      const asymOk = scan.mu.map((mu) => cornerJudge(p.corners, { mu, ...o }).every((r) => r.ok.polarity && r.ok.stable && r.ok.pm && r.ok.noise && r.settleAsym <= p.B))
      expect(scan.ok, pr.name).toEqual(asymOk)
    }
    // 四個 preset 的可行區間（格點）：預設 6.033–26.59 fs、d = 3 時 5.802–13.17 fs，另外兩個為空
    const band = (i: number) => {
      const p = { ...CORNER_JUDGE_DEFAULT, ...(CORNER_LOCAL_PRESETS[i].params as Partial<typeof CORNER_JUDGE_DEFAULT>) }
      const sc = cornerFeasibleScan(p.corners, { d: p.d, pmTargetDeg: p.pmTargetDeg, B: p.B, N: p.N, sigmaWMax: p.sigmaWMax }, undefined, [p.mu])
      return [sc.lo, sc.hi]
    }
    expect(band(0)[0]).toBeCloseTo(6.0331, 3)
    expect(band(0)[1]).toBeCloseTo(26.588, 2)
    expect(band(1).every(Number.isNaN)).toBe(true)
    expect(band(2)[0]).toBeCloseTo(5.8021, 3)
    expect(band(2)[1]).toBeCloseTo(13.169, 2)
    expect(band(3).every(Number.isNaN)).toBe(true)
  })

  it('A6：d ≥ 1 時只看 ρ 會誤判通過——μ 調到某個 corner 在 d = 1 剛好是重根（g = 1/4）、B = 6：警告寫明逐 block 的 k95 = 7 > 6，估計 5 ≤ 6', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    // 只留一個 corner（TT 25°C，σ_v = 100 fs、θ = 0°）：g = μ·K_q(100)，μ = 0.25/K_q(100) = 31.33 fs
    const last = () => container.querySelectorAll<HTMLButtonElement>('.so-toolbar .btn')[1]
    for (let i = 0; i < 3; i++) fireEvent.click(last())
    const mu = container.querySelector('input[aria-label="μ（learning rate）"]:not([type=range])') as HTMLInputElement
    fireEvent.change(mu, { target: { value: String(0.25 / Math.sqrt(2 / Math.PI) * 100) } })
    const b = container.querySelector('input[aria-label="B（允許的更新次數）"]:not([type=range])') as HTMLInputElement
    fireEvent.change(b, { target: { value: '6' } })
    await waitFor(() => expect(warningTexts(container).some((t) => t.includes('只看'))).toBe(true))
    const row = Array.from(container.querySelectorAll('.so-corner-table tbody tr td')).map((td) => td.textContent)
    expect(row[5]).toBe('7')
    expect(row[6]).toBe('5')
    expect(row.at(-1)).toContain('收斂') // 判定欄寫明「收斂」不合格
    noTexErrors(container)
  })

  it('A6：極慢的 mode（逐 block 數不完）——k95 欄寫「≥」、附警告；ρ 漸近估計欄仍是數字', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    const setNum = (label: string, v: number) => fireEvent.change(container.querySelector(`input[aria-label="${label}"]:not([type=range])`) as HTMLInputElement, { target: { value: String(v) } })
    setNum('corner 4 的 σ_v', 1000)
    setNum('corner 4 的有效相位 θ', 89.99)
    await waitFor(() => expect(warningTexts(container).some((t) => t.includes('極慢的 mode'))).toBe(true))
    const tds = Array.from(container.querySelectorAll('.so-corner-table tbody tr:last-child td'))
    expect(tds[5].textContent).toContain('≥')
    expect(tds[6].textContent).not.toContain('≥')
    expect(tds[5].textContent?.endsWith(tds[6].textContent ?? '?')).toBe(true) // 「≥」後面接的就是 ρ 漸近估計的數字（極慢時下界 = 估計）
    noTexErrors(container)
  })

  it('A6：Monte Carlo 欄是真的比對（blockLms 8 seeds）：每個 preset 都等到有結論；ok 的說明寫出 corner、k95、最差比值', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    const mcCell = () => container.querySelectorAll<HTMLElement>('.c-exp-crosscheck .c-check')[1]
    await waitFor(() => expect(mcCell().className).toContain('c-check-ok'), { timeout: 20_000 })
    const note = mcCell().getAttribute('title') ?? ''
    expect(note).toContain('near-grid FCW')
    expect(note).toContain('k 95 等於 71') // title 是 accessibleText 之後的可念文字
    expect(note).toContain('8 個 seeds')
    expect(/最差為容許值的 0\.\d+ 倍/.test(note), note).toBe(true)
    expect(/第 71 個 block：MC 絕對值（delta）除以 delta 0 等於 [\d.]+ 正負 [\d.]+（se），遞迴 0\.0\d+/.test(note), note).toBe(true)
    // 每個 preset 都有結論：d = 3、B = 20 是 ok；θ = 100° 的 corner 極性錯誤，仍用其餘穩定的 corner 比對（SS −40°C）
    for (const [name, who] of [
      ['commit latency d = 3', 'FF 125°C'],
      ['B 太小', 'near-grid FCW'],
      ['有效相位超過 90°', 'SS −40°C'],
    ] as const) {
      loadPreset(container, name)
      await waitFor(() => expect(mcCell().getAttribute('title') ?? '', name).toContain(who), { timeout: 20_000 })
      await waitFor(() => expect(mcCell().className, name).toContain('c-check-ok'), { timeout: 20_000 })
    }
    expect(crossCheck(container)[2]).toBe('n/a')
    noTexErrors(container)
  }, 60_000)

  it('A6：Monte Carlo 欄沒有可比對的 corner（全部極性錯誤）時寫 n/a 並說明原因，Fixed-Point 欄一律 n/a 並指向 Fixed-point 判斷器', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    for (let i = 0; i < 3; i++) fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.so-toolbar .btn')[1])
    fireEvent.change(container.querySelector('input[aria-label="corner 1 的有效相位 θ"]:not([type=range])') as HTMLInputElement, { target: { value: '120' } })
    await waitFor(() => expect(crossCheck(container)).toEqual(['ok', 'n/a', 'n/a']))
    const cells = container.querySelectorAll<HTMLElement>('.c-exp-crosscheck .c-check')
    expect(cells[1].getAttribute('title')).toContain('沒有「極性正確且穩定」的 corner')
    expect(cells[2].getAttribute('title')).toBe('量化見本頁 Fixed-point 判斷器')
    noTexErrors(container)
  })

  it('A6：掃描圖的 ρ = 0.05^{1/B} 線——d = 0 是判定線（B 內衰減 95%），d ≥ 1 只標成漸近參考線', () => {
    expect(refLineName(0, 120)).toBe(String.raw`$\rho = 0.05^{1/B}$（$B = 120$ 內衰減 95%）`)
    expect(refLineName(1, 120)).toBe(String.raw`$\rho = 0.05^{1/B}$（漸近參考線，$B = 120$）`)
    expect(refLineName(3, 6)).toContain('漸近參考線')
  })

  it('T16: Fixed-point：預設 17-bit wrap 翻號；F = 10 bit 時 EFB 週期 512 與封閉式一致', async () => {
    const { container } = mount(<FixedPointJudgeExperiment />)
    expect(warningTexts(container).some((t) => t.includes('符號翻轉'))).toBe(true)
    expect(container.querySelector('.so-kv .so-verdict')?.className).toContain('so-verdict-bad')
    loadPreset(container, 'F = 10 bit')
    await waitFor(() => expect(container.querySelector('.so-kv .so-verdict')?.className).toContain('so-verdict-ok'))
    const kv = Array.from(container.querySelectorAll('.so-kv > div')).map((d) => d.querySelector('.v')?.textContent ?? '')
    expect(kv[2]).toBe('512')
    noTexErrors(container)
  })

  it('T18: MIMO：預設「各自穩定、一起發散」；E24 的近奇異例子在沒有 regularization 時發散', async () => {
    const { container } = mount(<MimoJudgeExperiment />)
    expect(warningTexts(container).some((t) => t.startsWith('各 loop 單獨穩定'))).toBe(true)
    loadPreset(container, 'ε_J = 0 ⇒ 發散')
    await waitFor(() => expect(warningTexts(container).some((t) => t.includes('不再成立（勘誤 E24）'))).toBe(true))
    expect(container.querySelector('.so-verdict-bad')).toBeTruthy()
    loadPreset(container, 'ε_J = 1e-4 ⇒ 穩定')
    await waitFor(() => expect(container.querySelector('.so-verdict-bad')).toBeNull())
    noTexErrors(container)
  })

  it('T03: 證據強度：μ = 0.8 時均方發散但樣本路徑幾乎都收斂 ⇒ 警告；有失效時不能寫「未觀察到失效」', async () => {
    const { container } = mount(<EvidenceLabExperiment />)
    expect(warningTexts(container).some((t) => t.includes('mean-square unstable') && t.includes('不能拿來宣稱均方穩定'))).toBe(true)
    expect(verdictKinds(container)).toEqual(['ok', 'bad', 'ok'])
    loadPreset(container, '有 2 個失效')
    await waitFor(() => expect(warningTexts(container).some((t) => t.startsWith('觀察到 2 次失效'))).toBe(true))
    noTexErrors(container)
  })
})
