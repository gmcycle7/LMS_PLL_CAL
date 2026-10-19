import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Callout, ClaimTag, badgeClass, Tex, TexBlock, checkAnswer, mathText, parseNumberInput, randomSeed } from '@/components'
import type { HandCalcDef } from '@/data/types'
import {
  NEW_RECORD,
  SEED_MAX,
  accuracy,
  chapterOf,
  parseSeed,
  practiceItem,
  scoreCheck,
  statsTotals,
  type ChapterGroup,
  type InstanceRecord,
  type PracticeItem,
  type StatsAction,
  type WorkbookStats,
} from '../logic'
import { GivenList, LevelBadge, SolutionView } from './common'

/* ───────────────────────── 一題（練習模式） ───────────────────────── */

interface PracticeCardProps {
  item: PracticeItem
  record: InstanceRecord
  /** 按下「對答案」且至少填了一格；allCorrect = 每一格都在容許誤差內 */
  onCheck: (allCorrect: boolean) => void
  onReveal: () => void
}

/**
 * 隨機練習的一題：數字由 seed 決定（不能改），先自己算、填答案、對答案，再看詳解。
 * 判定用共用的 checkAnswer（與各章 HandCalc 的「自己算算看」同一套容許誤差）。
 */
function PracticeCard({ item, record, onCheck, onReveal }: PracticeCardProps) {
  const { def, values, solution } = item
  const chapter = chapterOf(def)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const parsed = solution.results.map((_, i) => parseNumberInput(answers[i] ?? ''))
  const verdicts = solution.results.map((r, i) => (parsed[i] === null ? null : checkAnswer(parsed[i] as number, r)))
  const anyFilled = parsed.some((p) => p !== null)
  const nCorrect = verdicts.filter((v) => v?.ok).length
  const allCorrect = nCorrect === solution.results.length

  const check = () => {
    setChecked(true)
    if (anyFilled) onCheck(allCorrect)
  }
  const toggleReveal = () => {
    if (!revealed) onReveal()
    setRevealed((v) => !v)
  }

  return (
    <section className="c-handcalc wb-practice-card" aria-label={`隨機練習 ${def.id}`} data-handcalc={def.id}>
      <header className="c-handcalc-head">
        <span className={badgeClass('neutral', 'c-handcalc-badge')}>隨機練習</span>
        <span className="c-handcalc-title">{mathText(def.title)}</span>
        <span className="c-handcalc-meta">
          <ClaimTag kind={def.claim} />
          <LevelBadge level={def.level} />
          <span className="c-handcalc-id">{def.id}</span>
        </span>
      </header>
      <p className="small muted wb-practice-from">
        出自 <Link to={chapter.path}>{chapter.nav}</Link>
        ；推導在該章，這裡只練代數字。
      </p>

      <TexBlock label={def.formulaId ? `通式（${def.formulaId}）` : '通式'}>{def.formulaTex}</TexBlock>

      <div className="wb-block-label">已知</div>
      <GivenList def={def} values={values} />

      <div className="c-handcalc-practice">
        <div className="wb-block-label">求</div>
        <p className="small">用紙筆和計算機算出下面的量，填入後按「對答案」。容許一般手算的四捨五入誤差。</p>
        {solution.results.map((r, idx) => {
          const raw = answers[idx] ?? ''
          const verdict = checked ? verdicts[idx] : null
          return (
            <div key={idx} className="c-handcalc-answer">
              <label>
                <span className="c-handcalc-sym">
                  <Tex>{`${r.symbol} =`}</Tex>
                </span>
                {r.label && <span className="c-handcalc-label">{mathText(r.label)}</span>}
                <input
                  type="text"
                  inputMode="decimal"
                  value={raw}
                  placeholder="你的答案"
                  onChange={(e) => {
                    setAnswers((a) => ({ ...a, [idx]: e.target.value }))
                    setChecked(false)
                  }}
                  aria-label={`你的答案：${r.label ?? r.symbol}`}
                />
                {r.unit && (
                  <span className="c-handcalc-unit">
                    <Tex>{r.unit}</Tex>
                  </span>
                )}
              </label>
              {checked && parsed[idx] === null && <span className="c-handcalc-verdict bad">{raw.trim() === '' ? '還沒填' : '請輸入數字'}</span>}
              {verdict && (
                <span className={`c-handcalc-verdict ${verdict.ok ? 'ok' : 'bad'}`}>
                  {verdict.ok ? '✓ 正確' : `✗ 還差一點（相對誤差 ${Number.isFinite(verdict.relError) ? (verdict.relError * 100).toPrecision(3) + '%' : '很大'}）`}
                </span>
              )}
            </div>
          )
        })}
        <div className="c-handcalc-actions">
          <button type="button" className="btn btn-primary" onClick={check}>
            對答案
          </button>
          <button type="button" className="btn" onClick={toggleReveal} aria-expanded={revealed}>
            {revealed ? '收起詳解' : '看詳解'}
          </button>
        </div>
        {checked && (
          <p className={`small wb-practice-summary${allCorrect ? ' ok' : ''}`} role="status">
            {!anyFilled
              ? '先填入至少一個答案再對答案（空白不計入統計）。'
              : allCorrect
                ? record.credited
                  ? `全部答對（${solution.results.length}／${solution.results.length}）。已記入統計。`
                  : '全部答對。這一題先看過詳解，所以只記作答、不記答對。'
                : `答對 ${nCorrect}／${solution.results.length} 格。可以修正後再對一次；在看詳解之前全部答對，仍然算答對。`}
          </p>
        )}
      </div>

      {revealed && (
        <div className="c-handcalc-solution">
          <SolutionView sol={solution} />
        </div>
      )}

      {def.tips && def.tips.length > 0 && (
        <details className="c-handcalc-tips">
          <summary>手算提示</summary>
          <ul>
            {def.tips.map((t, idx) => (
              <li key={idx}>{mathText(t)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/* ───────────────────────── 統計 ───────────────────────── */

const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(100 * x)}%`)

export function StatsPanel({ stats, groups, onReset }: { stats: WorkbookStats; groups: readonly ChapterGroup[]; onReset: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const total = statsTotals(stats)
  const rows = groups.filter((g) => stats.chapters[g.key])
  return (
    <section className="wb-stats card" aria-labelledby="wb-stats-title">
      <div className="wb-stats-head">
        <h3 id="wb-stats-title">作答統計</h3>
        <span className="small muted">只存在這台裝置的瀏覽器裡；無法儲存時（例如私密瀏覽）只在這次瀏覽中有效。</span>
      </div>
      <div className="wb-stats-total" data-testid="wb-stats-total">
        <span>
          作答 <strong data-stat="attempted">{total.attempted}</strong> 題
        </span>
        <span>
          答對 <strong data-stat="correct">{total.correct}</strong> 題
        </span>
        <span>
          正確率 <strong data-stat="rate">{pct(accuracy(total))}</strong>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="small muted">還沒有紀錄。在上面的題目按一次「對答案」就會開始統計。</p>
      ) : (
        <div className="table-wrap">
          <table className="wb-stats-table">
            <thead>
              <tr>
                <th scope="col">章節</th>
                <th scope="col" className="num">
                  作答
                </th>
                <th scope="col" className="num">
                  答對
                </th>
                <th scope="col" className="num">
                  正確率
                </th>
                <th scope="col">進度</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const c = stats.chapters[g.key]
                const rate = accuracy(c)
                return (
                  <tr key={g.key} data-chapter={g.key}>
                    <th scope="row">
                      <Link to={g.path}>{g.nav}</Link>
                    </th>
                    <td className="num">{c.attempted}</td>
                    <td className="num">{c.correct}</td>
                    <td className="num">{pct(rate)}</td>
                    <td>
                      <span className="wb-bar" role="img" aria-label={`正確率 ${pct(rate)}`}>
                        <span className="wb-bar-fill" style={{ width: `${Math.round(100 * (rate ?? 0))}%` }} />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="wb-stats-actions">
        {confirming ? (
          <>
            <span className="small">確定要清除所有作答紀錄？</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onReset()
                setConfirming(false)
              }}
            >
              確定重設
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={total.attempted === 0 && stats.solved.length === 0}>
            重設統計
          </button>
        )}
      </div>
    </section>
  )
}

/* ───────────────────────── 隨機練習 ───────────────────────── */

export interface RandomPracticeProps {
  /** 符合目前篩選條件的題目 */
  pool: readonly HandCalcDef[]
  /** 全部章節（統計表列出章節名稱用） */
  groups: readonly ChapterGroup[]
  stats: WorkbookStats
  dispatch: (a: StatsAction) => void
  /** 起始 seed（網址 ?seed= 或隨機） */
  initialSeed: number
}

/**
 * 隨機練習：題目 = f（篩選後的題庫、seed、第幾題）。seed 顯示在畫面上，輸入同一個 seed 就會得到同一串題目。
 * 每一題（含它的數字）在這次瀏覽中只記一次作答、最多一次答對。
 */
export function RandomPractice({ pool, groups, stats, dispatch, initialSeed }: RandomPracticeProps) {
  const [seed, setSeed] = useState(initialSeed)
  const [seedText, setSeedText] = useState(String(initialSeed))
  const [k, setK] = useState(0)
  const [records, setRecords] = useState<Record<string, InstanceRecord>>({})

  const item = useMemo(() => practiceItem(pool, seed, k), [pool, seed, k])
  const seedOk = parseSeed(seedText) !== null

  const applySeed = (s: number) => {
    setSeed(s)
    setSeedText(String(s))
    setK(0)
  }
  const onSeedText = (raw: string) => {
    setSeedText(raw)
    const s = parseSeed(raw)
    if (s !== null) {
      setSeed(s)
      setK(0)
    }
  }

  const record = item ? (records[item.key] ?? NEW_RECORD) : NEW_RECORD
  const onCheck = (allCorrect: boolean) => {
    if (!item) return
    const chapter = chapterOf(item.def).key
    const { record: next, actions } = scoreCheck(record, allCorrect)
    setRecords((r) => ({ ...r, [item.key]: next }))
    for (const type of actions) dispatch(type === 'attempt' ? { type, chapter } : { type, chapter, id: item.def.id })
  }
  const onReveal = () => {
    if (!item) return
    setRecords((r) => ({ ...r, [item.key]: { ...(r[item.key] ?? NEW_RECORD), revealed: true } }))
  }

  return (
    <div className="wb-practice">
      <div className="wb-practice-bar">
        <label className="wb-inline-field">
          <span>
            題目種子 <code>seed</code>
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={seedText}
            onChange={(e) => onSeedText(e.target.value)}
            onBlur={() => setSeedText(String(seed))}
            aria-label="題目種子 seed"
            aria-invalid={!seedOk}
          />
        </label>
        <button type="button" className="btn" onClick={() => applySeed(randomSeed())}>
          換一組種子
        </button>
        <span className="wb-practice-pos small" data-testid="wb-practice-pos">
          {item ? (
            <>
              第 <strong>{item.index + 1}</strong> 題 · 題庫 {item.poolSize} 題 · 這一題的數字種子 <code>{item.valueSeed}</code>
            </>
          ) : (
            '題庫 0 題'
          )}
        </span>
        <button type="button" className="btn btn-primary wb-next" onClick={() => setK((v) => v + 1)} disabled={!item}>
          下一題 →
        </button>
      </div>
      {!seedOk && <p className="small wb-bad">seed 必須是 0 到 {SEED_MAX} 的整數；目前仍使用 {seed}。</p>}
      <p className="small muted">
        題目由（篩選條件、seed、第幾題）完全決定：同一個 seed 會依同樣的順序出同樣的題目與數字，整個題庫輪完之前不會重複。把 seed 告訴同事，就能做同一份練習。
      </p>

      {item ? (
        <PracticeCard key={item.key} item={item} record={record} onCheck={onCheck} onReveal={onReveal} />
      ) : (
        <Callout kind="warn" title="沒有符合篩選條件的題目">
          請放寬上方的章節、難度或關鍵字條件。
        </Callout>
      )}

      <StatsPanel
        stats={stats}
        groups={groups}
        onReset={() => {
          setRecords({})
          dispatch({ type: 'reset' })
        }}
      />
    </div>
  )
}
