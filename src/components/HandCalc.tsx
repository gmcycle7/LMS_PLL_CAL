import { useMemo, useState } from 'react'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { checkAnswer, defaultValues, inputError, randomValues, texNum } from './handcalcMath'
import { formatInput, parseNumberInput } from './paramMath'
import { ClaimTag } from './Tags'
import { Tex, TexBlock, mathText } from './Tex'
import './code.css'

const LEVEL_LABEL: Record<HandCalcDef['level'], string> = {
  beginner: '只需四則運算',
  engineer: '需要計算機',
  research: '需要查表或複數運算',
}

export interface HandCalcProps {
  def: HandCalcDef
  /** 初始模式：steps = 直接看帶入過程；practice = 先自己算（預設 steps） */
  initialMode?: 'steps' | 'practice'
  /** 精簡顯示（練習簿列表用）：不顯示通式上方的說明 */
  compact?: boolean
}

type Solved = { ok: true; sol: HandCalcSolution } | { ok: false; error: string }

/**
 * 「帶入手算」：使用者輸入自己的數字，逐步看到數字代進公式的每一步；
 * 或切到「自己算算看」，先用紙筆／計算機算，再輸入答案檢查。
 * 詳解的數值由 def.solve() 即時計算（內部呼叫 src/simulation 的實際函式）。
 */
export function HandCalc({ def, initialMode = 'steps', compact }: HandCalcProps) {
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(def.inputs.map((i) => [i.key, formatInput(i.default, 10)])))
  const [mode, setMode] = useState<'steps' | 'practice'>(initialMode)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [seed, setSeed] = useState(1)

  const parsed = useMemo(() => {
    const values: Record<string, number> = {}
    const errors: Record<string, string> = {}
    for (const i of def.inputs) {
      const v = parseNumberInput(text[i.key] ?? '')
      const err = v === null ? '請輸入數字' : inputError(i, v)
      if (err) errors[i.key] = err
      values[i.key] = v ?? Number.NaN
    }
    return { values, errors }
  }, [def, text])

  const solved: Solved = useMemo(() => {
    if (Object.keys(parsed.errors).length) return { ok: false, error: '請先修正輸入值。' }
    const msg = def.validate?.(parsed.values)
    if (msg) return { ok: false, error: msg }
    try {
      return { ok: true, sol: def.solve(parsed.values) }
    } catch (e) {
      return { ok: false, error: `無法計算：${(e as Error).message}` }
    }
  }, [def, parsed])

  const resetAttempt = () => {
    setAnswers({})
    setChecked(false)
    setRevealed(false)
  }
  const setValues = (v: Record<string, number>) => {
    setText(Object.fromEntries(def.inputs.map((i) => [i.key, formatInput(v[i.key], 10)])))
    resetAttempt()
  }
  const onInput = (key: string, raw: string) => {
    setText((t) => ({ ...t, [key]: raw }))
    resetAttempt()
  }
  const newProblem = () => {
    const next = seed + 1
    setSeed(next)
    setValues(randomValues(def, next))
    setMode('practice')
  }

  const showSteps = mode === 'steps' || revealed
  const canRandom = def.inputs.some((i) => i.practice)

  return (
    <section className="c-handcalc" id={`handcalc-${def.id}`} aria-label={`帶入手算 ${def.id}`}>
      <header className="c-handcalc-head">
        <span className="c-handcalc-badge">帶入手算</span>
        <span className="c-handcalc-title">{mathText(def.title)}</span>
        <span className="c-handcalc-meta">
          <ClaimTag kind={def.claim} />
          <span className="c-handcalc-level">{LEVEL_LABEL[def.level]}</span>
          <span className="c-handcalc-id">{def.id}</span>
        </span>
      </header>

      {!compact && <p className="c-handcalc-intro small muted">把下面的數字換成你自己的，網站會把它們一步一步代進公式；也可以切到「自己算算看」先用紙筆算，再對答案。</p>}

      <TexBlock label={def.formulaId ? `通式（${def.formulaId}）` : '通式'}>
        {def.formulaTex}
      </TexBlock>

      <div className="c-handcalc-inputs">
        {def.inputs.map((i) => (
          <label key={i.key} className={`c-handcalc-input${parsed.errors[i.key] ? ' bad' : ''}`}>
            <span className="c-handcalc-sym">
              <Tex>{i.symbol}</Tex>
            </span>
            <span className="c-handcalc-label">{mathText(i.label)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={text[i.key] ?? ''}
              onChange={(e) => onInput(i.key, e.target.value)}
              aria-label={`${i.label}（${i.key}）`}
              aria-invalid={!!parsed.errors[i.key]}
            />
            {i.unit && (
              <span className="c-handcalc-unit">
                <Tex>{i.unit}</Tex>
              </span>
            )}
            {parsed.errors[i.key] && <span className="c-handcalc-err">{parsed.errors[i.key]}</span>}
          </label>
        ))}
      </div>

      <div className="c-handcalc-actions">
        <div className="c-handcalc-modes" role="tablist" aria-label="手算模式">
          <button type="button" role="tab" aria-selected={mode === 'steps'} className={`c-code-tab${mode === 'steps' ? ' active' : ''}`} onClick={() => setMode('steps')}>
            看帶入過程
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'practice'}
            className={`c-code-tab${mode === 'practice' ? ' active' : ''}`}
            onClick={() => {
              setMode('practice')
              resetAttempt()
            }}
          >
            自己算算看
          </button>
        </div>
        {canRandom && (
          <button type="button" className="btn" onClick={newProblem}>
            換一題（隨機數字）
          </button>
        )}
        <button type="button" className="btn" onClick={() => setValues(defaultValues(def))}>
          還原範例數字
        </button>
      </div>

      {!solved.ok && (
        <div className="callout callout-warn" role="note">
          {mathText(solved.error)}
        </div>
      )}

      {solved.ok && mode === 'practice' && (
        <div className="c-handcalc-practice">
          <p className="small">用紙筆和計算機算出下面的量，填入後按「對答案」。容許一般手算的四捨五入誤差。</p>
          {solved.sol.results.map((r, idx) => {
            const raw = answers[idx] ?? ''
            const user = parseNumberInput(raw)
            const verdict = checked && user !== null ? checkAnswer(user, r) : null
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
                {checked && user === null && <span className="c-handcalc-verdict bad">請輸入數字</span>}
                {verdict && (
                  <span className={`c-handcalc-verdict ${verdict.ok ? 'ok' : 'bad'}`}>
                    {verdict.ok ? '✓ 正確' : `✗ 還差一點（相對誤差 ${Number.isFinite(verdict.relError) ? (verdict.relError * 100).toPrecision(3) + '%' : '很大'}）`}
                  </span>
                )}
              </div>
            )
          })}
          <div className="c-handcalc-actions">
            <button type="button" className="btn btn-primary" onClick={() => setChecked(true)}>
              對答案
            </button>
            <button type="button" className="btn" onClick={() => setRevealed((v) => !v)} aria-expanded={revealed}>
              {revealed ? '收起詳解' : '看詳解'}
            </button>
          </div>
        </div>
      )}

      {solved.ok && showSteps && (
        <div className="c-handcalc-solution">
          <ol className="c-steps-list">
            {solved.sol.steps.map((s, idx) => (
              <li key={idx} className="c-step">
                <div className="c-step-tex">
                  <TexBlock>{s.tex}</TexBlock>
                </div>
                <div className="c-step-why">{mathText(s.why)}</div>
              </li>
            ))}
          </ol>
          <div className="c-handcalc-results">
            {solved.sol.results.map((r, idx) => (
              <TexBlock key={idx} label={r.label ? mathText(r.label) : undefined}>
                {`\\boxed{${r.symbol} = ${Number.isInteger(r.value) && Math.abs(r.value) < 1e15 ? String(r.value) : texNum(r.value, r.digits ?? 5)}${r.unit ? `\\ ${r.unit}` : ''}}`}
              </TexBlock>
            ))}
          </div>
          {solved.sol.notes && solved.sol.notes.length > 0 && (
            <ul className="c-handcalc-notes">
              {solved.sol.notes.map((n, idx) => (
                <li key={idx}>{mathText(n)}</li>
              ))}
            </ul>
          )}
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
