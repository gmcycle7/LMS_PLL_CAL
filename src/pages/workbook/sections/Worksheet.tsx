import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Callout, ParamControl, Tex, TexBlock, mathText, randomSeed } from '@/components'
import type { HandCalcDef } from '@/data/types'
import {
  DEFAULT_SEED,
  LEVELS,
  LEVEL_LABEL,
  SEED_MAX,
  WORKSHEET_DEFAULT_COUNT,
  WORKSHEET_MAX,
  WORKSHEET_MIN,
  buildWorksheet,
  parseSeed,
  type ChapterGroup,
  type Level,
  type Worksheet,
  type WorksheetItem,
  type WorksheetOptions,
} from '../logic'
import { GivenList, SolutionView } from './common'
import { ConstantsTable, PhiTable } from './HandTools'

/**
 * 練習卷顯示在畫面上時掛在 <body> 的 class：workbook.css 的 @media print 規則全部以它為前提，
 * 所以只有「練習卷」分頁開著時，列印才會只印卷子；離開分頁（或離開本頁）就移除，其他頁面的列印不受影響。
 */
export const PRINT_BODY_CLASS = 'wb-print-sheet'

/** 作答區的橫線數 */
const WORK_LINES = [0, 4, 8, 12] as const

/* ───────────────────────── 卷面 ───────────────────────── */

function Question({ item, lines, tips }: { item: WorksheetItem; lines: number; tips: boolean }) {
  const { def, values, solution } = item
  return (
    <li className="wb-q" data-handcalc={def.id}>
      <div className="wb-q-head">
        <span className="wb-q-no">{item.no}.</span>
        <span className="wb-q-title">{mathText(def.title)}</span>
        <span className="wb-q-meta">
          {def.id} · {item.chapter.nav} · {LEVEL_LABEL[def.level]}
        </span>
      </div>
      <TexBlock label={def.formulaId ? `通式（${def.formulaId}）` : '通式'}>{def.formulaTex}</TexBlock>
      <div className="wb-q-row">
        <span className="wb-block-label">已知</span>
        <GivenList def={def} values={values} />
      </div>
      <div className="wb-q-row">
        <span className="wb-block-label">求</span>
        <ul className="wb-asks">
          {solution.results.map((r, i) => (
            <li key={i}>
              <Tex>{`${r.symbol} =`}</Tex>
              <span className="wb-blank" aria-label="作答空格" role="img" />
              {r.unit && <Tex>{r.unit}</Tex>}
              {r.label && <span className="wb-given-label">{mathText(r.label)}</span>}
            </li>
          ))}
        </ul>
      </div>
      {tips && def.tips && def.tips.length > 0 && (
        <div className="wb-q-tips">
          <span className="wb-block-label">提示</span>
          <ul>
            {def.tips.map((t, i) => (
              <li key={i}>{mathText(t)}</li>
            ))}
          </ul>
        </div>
      )}
      {lines > 0 && (
        <div className="wb-work" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="wb-work-line" />
          ))}
        </div>
      )}
    </li>
  )
}

export interface SheetViewProps {
  ws: Worksheet
  /** 章節 key → 名稱（卷首列出涵蓋的章節） */
  chapterNames: Record<string, string>
  withAnswers: boolean
  withTools: boolean
  withTips: boolean
  lines: number
}

/** 卷子本身（螢幕預覽與列印共用同一份 DOM）。 */
export function SheetView({ ws, chapterNames, withAnswers, withTools, withTips, lines }: SheetViewProps) {
  const { options, items } = ws
  const covered = [...new Set(items.map((it) => it.chapter.key))].map((k) => chapterNames[k] ?? k)
  const levels = options.levels.length === 0 || options.levels.length === LEVELS.length ? '全部難度' : options.levels.map((l) => LEVEL_LABEL[l]).join('、')
  return (
    <div className="wb-sheet" id="wb-sheet" data-seed={options.seed} data-count={items.length}>
      <header className="wb-sheet-head">
        <h2 className="wb-sheet-title">LMS × PLL 手算練習卷</h2>
        <div className="wb-sheet-meta">
          <span>
            seed <code>{options.seed}</code>
          </span>
          <span>共 {items.length} 題</span>
          <span>數字：{options.numbers === 'default' ? '課文範例' : '依 seed 隨機'}</span>
          <span>難度：{levels}</span>
        </div>
        <div className="wb-sheet-meta">涵蓋：{covered.join('；') || '—'}</div>
        <div className="wb-sheet-name">
          <span>
            姓名 <span className="wb-blank wb-blank-wide" />
          </span>
          <span>
            日期 <span className="wb-blank" />
          </span>
          <span>
            答對 <span className="wb-blank wb-blank-short" />／{items.length} 題
          </span>
        </div>
        <p className="wb-sheet-rules">
          作答說明：只用紙、筆與一般工程計算機。每個等號只做一種運算，中間結果保留 4–5 位有效數字並寫出單位；最後答案與解答的相對誤差在{' '}
          <Tex>{String.raw`1\%`}</Tex> 以內就算對（個別題目另有標示）。全卷的參數誤差一律定義為 <Tex>{String.raw`\delta = a - w`}</Tex>。
        </p>
      </header>

      <ol className="wb-sheet-questions">
        {items.map((it) => (
          <Question key={`${it.no}-${it.def.id}`} item={it} lines={lines} tips={withTips} />
        ))}
      </ol>

      {withTools && (
        <section className="wb-sheet-tools" aria-label="附錄：查表與常數">
          <h3 className="wb-sheet-sub">
            附錄｜<Tex>{String.raw`\Phi(z)`}</Tex> 表與常用常數
          </h3>
          <PhiTable />
          <p className="wb-sheet-rules">
            負的 <Tex>z</Tex>：<Tex>{String.raw`\Phi(-z) = 1 - \Phi(z)`}</Tex>；兩格之間用線性內插；<Tex>{String.raw`|z|`}</Tex> 很小時{' '}
            <Tex>{String.raw`\Phi(z)\approx \tfrac12 + z/\sqrt{2\pi}`}</Tex>。
          </p>
          <ConstantsTable />
        </section>
      )}

      {withAnswers && (
        <section className="wb-sheet-answers" aria-label="解答">
          <h2 className="wb-sheet-title">解答（逐步代入）</h2>
          <p className="wb-sheet-rules">每一步都是「符號式 = 代入數字 = 結果」，數值由網站的模擬函式算出。對答案時先比最後的框，再往回找第一個不一樣的中間結果。</p>
          {items.map((it) => (
            <div key={`${it.no}-${it.def.id}`} className="wb-a" data-handcalc={it.def.id}>
              <div className="wb-q-head">
                <span className="wb-q-no">{it.no}.</span>
                <span className="wb-q-title">{mathText(it.def.title)}</span>
                <span className="wb-q-meta">{it.def.id}</span>
              </div>
              <SolutionView sol={it.solution} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/* ───────────────────────── 出卷控制 ───────────────────────── */

export interface WorksheetBuilderProps {
  all: readonly HandCalcDef[]
  groups: readonly ChapterGroup[]
  /** 起始選項（測試或由篩選條件帶入） */
  initial?: Partial<WorksheetOptions>
}

export function WorksheetBuilder({ all, groups, initial }: WorksheetBuilderProps) {
  const allKeys = useMemo(() => groups.map((g) => g.key), [groups])
  const [chapters, setChapters] = useState<string[]>(() => (initial?.chapters && initial.chapters.length > 0 ? initial.chapters.filter((k) => allKeys.includes(k)) : allKeys))
  const [levels, setLevels] = useState<Level[]>(() => (initial?.levels && initial.levels.length > 0 ? [...initial.levels] : [...LEVELS]))
  const [count, setCount] = useState(initial?.count ?? WORKSHEET_DEFAULT_COUNT)
  const [seed, setSeed] = useState(initial?.seed ?? DEFAULT_SEED)
  const [seedText, setSeedText] = useState(String(initial?.seed ?? DEFAULT_SEED))
  const [numbers, setNumbers] = useState<WorksheetOptions['numbers']>(initial?.numbers ?? 'random')
  const [withAnswers, setWithAnswers] = useState(true)
  const [withTools, setWithTools] = useState(true)
  const [withTips, setWithTips] = useState(false)
  const [lines, setLines] = useState<number>(8)

  // 只有這個分頁開著時，列印才只印卷子（見 PRINT_BODY_CLASS 的說明）；卸載時一定移除
  useEffect(() => {
    document.body.classList.add(PRINT_BODY_CLASS)
    return () => document.body.classList.remove(PRINT_BODY_CLASS)
  }, [])

  const options: WorksheetOptions = useMemo(() => ({ chapters, levels, count, seed, numbers }), [chapters, levels, count, seed, numbers])
  // 打字（seed、題數）時先讓輸入框更新，卷面稍後再重排
  const deferred = useDeferredValue(options)
  const empty = deferred.chapters.length === 0 || deferred.levels.length === 0
  const ws = useMemo(() => (empty ? null : buildWorksheet(all, deferred)), [all, deferred, empty])
  const chapterNames = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g.nav])), [groups])

  const toggleChapter = (key: string) => setChapters((c) => (c.includes(key) ? c.filter((k) => k !== key) : allKeys.filter((k) => k === key || c.includes(k))))
  const toggleLevel = (l: Level) => setLevels((c) => (c.includes(l) ? c.filter((x) => x !== l) : LEVELS.filter((x) => x === l || c.includes(x))))
  const onSeedText = (raw: string) => {
    setSeedText(raw)
    const s = parseSeed(raw)
    if (s !== null) setSeed(s)
  }
  const newSeed = () => {
    const s = randomSeed()
    setSeed(s)
    setSeedText(String(s))
  }
  const print = () => {
    try {
      if (typeof window.print === 'function') window.print()
    } catch {
      /* 有些內嵌環境不允許列印：忽略，使用者仍可用瀏覽器選單列印 */
    }
  }
  const seedOk = parseSeed(seedText) !== null

  return (
    <div className="wb-worksheet">
      <div className="wb-sheet-controls wb-noprint">
        <p>
          選好範圍、題數與 seed，下方就是卷子的預覽；同一組選項（特別是同一個 <code>seed</code>）永遠產生同一張卷。按「列印／存成 PDF」時只會印出卷子：題目在前，解答從新的一頁開始。
        </p>

        <fieldset className="wb-fieldset">
          <legend>
            章節（已選 {chapters.length}／{allKeys.length}）
          </legend>
          <div className="wb-fieldset-actions">
            <button type="button" className="btn" onClick={() => setChapters(allKeys)}>
              全選
            </button>
            <button type="button" className="btn" onClick={() => setChapters([])}>
              全不選
            </button>
          </div>
          <div className="wb-checks">
            {groups.map((g) => (
              <label key={g.key} className="wb-check">
                <input type="checkbox" checked={chapters.includes(g.key)} onChange={() => toggleChapter(g.key)} data-chapter={g.key} />
                <span>
                  {g.nav}
                  <span className="muted">（{g.items.length}）</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="wb-control-grid">
          <fieldset className="wb-fieldset">
            <legend>難度</legend>
            <div className="wb-checks wb-checks-col">
              {LEVELS.map((l) => (
                <label key={l} className="wb-check">
                  <input type="checkbox" checked={levels.includes(l)} onChange={() => toggleLevel(l)} data-level={l} />
                  <span>{LEVEL_LABEL[l]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="wb-fieldset">
            <legend>題數與 seed</legend>
            <ParamControl label="題數" value={count} onChange={setCount} min={WORKSHEET_MIN} max={WORKSHEET_MAX} step={1} integer clampOnBlur unit="題" />
            <label className="wb-inline-field">
              <span>
                <code>seed</code>
              </span>
              <input type="text" inputMode="numeric" value={seedText} onChange={(e) => onSeedText(e.target.value)} onBlur={() => setSeedText(String(seed))} aria-label="練習卷 seed" aria-invalid={!seedOk} />
              <button type="button" className="btn" onClick={newSeed}>
                隨機 seed
              </button>
            </label>
            {!seedOk && <p className="small wb-bad">seed 必須是 0 到 {SEED_MAX} 的整數；目前仍使用 {seed}。</p>}
          </fieldset>

          <fieldset className="wb-fieldset">
            <legend>數字與版面</legend>
            <div className="wb-checks wb-checks-col">
              <label className="wb-check">
                <input type="radio" name="wb-numbers" checked={numbers === 'random'} onChange={() => setNumbers('random')} />
                <span>依 seed 隨機出數字（手算友善的範圍）</span>
              </label>
              <label className="wb-check">
                <input type="radio" name="wb-numbers" checked={numbers === 'default'} onChange={() => setNumbers('default')} />
                <span>用課文範例的數字（答案可和各章對照）</span>
              </label>
              <label className="wb-check">
                <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
                <span>附逐步解答（另起一頁）</span>
              </label>
              <label className="wb-check">
                <input type="checkbox" checked={withTools} onChange={(e) => setWithTools(e.target.checked)} />
                <span>
                  附 <Tex>{String.raw`\Phi(z)`}</Tex> 表與常數
                </span>
              </label>
              <label className="wb-check">
                <input type="checkbox" checked={withTips} onChange={(e) => setWithTips(e.target.checked)} />
                <span>題目下方印出手算提示（可能提到範例答案）</span>
              </label>
              <label className="wb-inline-field">
                <span>每題作答區</span>
                <select value={lines} onChange={(e) => setLines(Number(e.target.value))} aria-label="每題作答區的橫線數">
                  {WORK_LINES.map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? '不留橫線' : `${n} 行橫線`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
        </div>

        <div className="wb-sheet-actions">
          <button type="button" className="btn btn-primary" onClick={print} disabled={!ws || ws.items.length === 0}>
            列印 / 存成 PDF
          </button>
          <span className="small muted" role="status" data-testid="wb-sheet-status">
            {ws ? `已產生 ${ws.items.length} 題（符合條件的題庫 ${ws.poolSize} 題）` : '尚未產生'}
          </span>
        </div>
        <p className="small muted">
          列印對話框的「目的地」選「另存為 PDF」即可存檔。公式太長被右邊界切掉時，改成橫向或把縮放調到 80% 左右。深色主題下列印仍然是白底黑字。
        </p>
        {empty && (
          <Callout kind="warn" title="還沒有選範圍">
            請至少勾選一個章節與一種難度。
          </Callout>
        )}
        {ws && ws.shortfall && (
          <Callout kind="warn" title="題庫不夠出滿指定的題數">
            符合條件的題目只有 {ws.poolSize} 題
            {deferred.numbers === 'default' ? '，而且「課文範例的數字」每題只有一組，所以最多出這麼多題。' : '；同一題換了數字仍然重複時會跳過，所以實際題數較少。'}
            可以多選幾個章節或難度。
          </Callout>
        )}
      </div>

      {ws && ws.items.length > 0 && <SheetView ws={ws} chapterNames={chapterNames} withAnswers={withAnswers} withTools={withTools} withTips={withTips} lines={lines} />}
    </div>
  )
}
