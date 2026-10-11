import { useId, useState, type ReactNode } from 'react'
import { Tex, TexBlock, mathText } from './Tex'
import './code.css'

/* ---------- 本章符號表（docs/teaching-style.md §5） ---------- */

export interface SymbolEntry {
  /** TeX，例如 'w_k' */
  symbol: string
  meaning: ReactNode
  unit?: string
  /** 第一次出現的段落，例如 '§3.1' */
  firstSeen?: string
  /** 與全站約定或勘誤的關係，例如「本章採 δ = a − w（勘誤 E32）」 */
  note?: ReactNode
}

export function SymbolTable({ rows, title = '本章符號', caption }: { rows: SymbolEntry[]; title?: string; caption?: ReactNode }) {
  const hasUnit = rows.some((r) => r.unit)
  const hasSeen = rows.some((r) => r.firstSeen)
  const hasNote = rows.some((r) => r.note)
  return (
    <div className="c-symbols">
      <div className="c-symbols-title">{mathText(title)}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>符號</th>
              <th>意義</th>
              {hasUnit && <th>單位</th>}
              {hasSeen && <th className="nowrap">首次出現</th>}
              {hasNote && <th>備註</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="nowrap">
                  <Tex>{r.symbol}</Tex>
                </td>
                <td>{r.meaning}</td>
                {hasUnit && <td className="nowrap">{r.unit ? <Tex>{r.unit}</Tex> : '—'}</td>}
                {hasSeen && <td className="nowrap">{r.firstSeen ?? ''}</td>}
                {hasNote && <td>{r.note ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <div className="c-code-caption">{caption}</div>}
    </div>
  )
}

/* ---------- 思考題 ---------- */

export interface QuizOption {
  label: ReactNode
  correct?: boolean
}

export interface QuizProps {
  /** 題號或標題，例如「思考題 1」 */
  title?: string
  question: ReactNode
  /** 選擇題選項；省略則為計算題（只顯示「看答案」） */
  options?: QuizOption[]
  /** 解析（含推導） */
  answer: ReactNode
}

export function Quiz({ title = '思考題', question, options, answer }: QuizProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  const name = useId()
  const correct = picked !== null && options ? !!options[picked]?.correct : null
  return (
    <div className="c-quiz">
      <div className="c-quiz-title">{mathText(title)}</div>
      <div className="c-quiz-q">{question}</div>
      {options && (
        <div className="c-quiz-options" role="radiogroup">
          {options.map((o, i) => (
            <label key={i} className={`c-quiz-opt${picked === i ? (o.correct ? ' ok' : ' bad') : ''}`}>
              <input type="radio" name={name} checked={picked === i} onChange={() => setPicked(i)} />
              <span>
                {String.fromCharCode(65 + i)}. {o.label}
              </span>
            </label>
          ))}
        </div>
      )}
      {correct !== null && <div className={`c-quiz-verdict ${correct ? 'ok' : 'bad'}`}>{correct ? '答對了！' : '再想想看。'}</div>}
      <button type="button" className="btn" onClick={() => setShown((v) => !v)} aria-expanded={shown}>
        {shown ? '收起解析' : '看答案與解析'}
      </button>
      {shown && <div className="c-quiz-answer">{answer}</div>}
    </div>
  )
}

/* ---------- 本課必記 ---------- */

export function Recap({
  title = '這一課最重要的公式',
  formulas,
  points,
}: {
  title?: string
  /** TeX 字串（會以 display mode 顯示） */
  formulas?: { tex: string; label?: ReactNode; id?: string }[]
  /** 「應該記住的 N 件事」 */
  points?: ReactNode[]
}) {
  return (
    <div className="c-recap">
      <div className="c-recap-title">{mathText(title)}</div>
      {formulas?.map((f, i) => (
        <div key={i} className="c-recap-formula">
          {f.label && <div className="c-recap-label">{mathText(f.label)}</div>}
          <TexBlock id={f.id}>{f.tex}</TexBlock>
        </div>
      ))}
      {points && points.length > 0 && (
        <>
          <div className="c-recap-sub">應該記住的 {points.length} 件事</div>
          <ol className="c-recap-points">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

/* ---------- 先備知識（只假設微積分程度） ---------- */

export function Prereq({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="c-prereq" open={defaultOpen}>
      <summary>
        <span className="c-prereq-badge">先備知識</span> {mathText(title)}
      </summary>
      <div className="c-prereq-body">{children}</div>
    </details>
  )
}

/* ---------- 一步一步推導 ---------- */

export interface Step {
  /** 這一步的 TeX（單行等式或 aligned 片段） */
  tex: string
  /** 為什麼可以這樣做（一句話） */
  why: ReactNode
}

/**
 * 逐步推導：每一步一行公式 + 理由，避免跳步（docs/teaching-style.md §2-3）。
 */
export function StepDerivation({ steps, title, result }: { steps: Step[]; title?: ReactNode; result?: string }) {
  return (
    <div className="c-steps">
      {title && <div className="c-steps-title">{title}</div>}
      <ol className="c-steps-list">
        {steps.map((s, i) => (
          <li key={i} className="c-step">
            <div className="c-step-tex">
              <TexBlock>{s.tex}</TexBlock>
            </div>
            <div className="c-step-why">{s.why}</div>
          </li>
        ))}
      </ol>
      {result && (
        <div className="c-steps-result">
          <TexBlock>{String.raw`\boxed{${result}}`}</TexBlock>
        </div>
      )}
    </div>
  )
}
