import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { currentPageId, makeQuizId, recordQuiz, registerQuiz } from '@/app/quizProgress'
import { ScrollRegion } from './ScrollRegion'
import { badgeClass } from './Tags'
import { Tex, TexBlock, accessibleText, hasInlineMath, mathText, nodeHasMath, nodeToAccessibleText } from './Tex'
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
      <ScrollRegion className="table-wrap" label="符號表（可左右捲動）">
        <table>
          {/* 表格標題：視覺上已有 .c-symbols-title，這裡給螢幕閱讀器（讀表格時會先念 caption）。
              文字刻意加上「符號表：」，不和可見標題逐字相同（各章測試以 getByText('本章符號') 找可見標題，逐字相同會變成兩個符合） */}
          <caption className="c-sr-only">符號表：{accessibleText(title)}</caption>
          <thead>
            <tr>
              <th scope="col">符號</th>
              <th scope="col">意義</th>
              {hasUnit && <th scope="col">單位</th>}
              {hasSeen && (
                <th scope="col" className="nowrap">
                  首次出現
                </th>
              )}
              {hasNote && <th scope="col">備註</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <th scope="row" className="nowrap c-rowhead">
                  <Tex>{r.symbol}</Tex>
                </th>
                <td>{r.meaning}</td>
                {hasUnit && <td className="nowrap">{r.unit ? <Tex>{r.unit}</Tex> : '—'}</td>}
                {hasSeen && <td className="nowrap">{r.firstSeen ?? ''}</td>}
                {hasNote && <td>{r.note ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
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
  /** 進度紀錄用的題目 id（選填）：沒給就由標題與題目文字雜湊出來（src/app/quizProgress.ts） */
  id?: string
  question: ReactNode
  /** 選擇題選項；省略則為計算題（只顯示「看答案」） */
  options?: QuizOption[]
  /** 解析（含推導） */
  answer: ReactNode
}

export function Quiz({ title = '思考題', id, question, options, answer }: QuizProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  // 進度回報：頁面 id 與題目 id 掛載時決定一次；掛載時登記（Dashboard 的分母），作答時記一筆（src/app/quizProgress.ts）
  const progress = useRef<{ pageId: string; quizId: string } | null>(null)
  if (!progress.current) progress.current = { pageId: currentPageId(), quizId: id ?? makeQuizId(title, nodeToAccessibleText(question)) }
  useEffect(() => registerQuiz(progress.current!.pageId, progress.current!.quizId), [])
  const pick = (i: number) => {
    setPicked(i)
    recordQuiz(progress.current!.pageId, progress.current!.quizId, { picked: i, correct: !!options?.[i]?.correct })
  }
  const toggleAnswer = () => {
    // 計算題（沒有選項）：第一次打開解析就算作答；選擇題要選了選項才算
    if (!shown && !options) recordQuiz(progress.current!.pageId, progress.current!.quizId, { picked: null, correct: null })
    setShown((v) => !v)
  }
  const name = useId()
  const questionId = `${name}-q`
  const correct = picked !== null && options ? !!options[picked]?.correct : null
  return (
    <div className="c-quiz">
      <div className="c-quiz-title">{mathText(title)}</div>
      <div className="c-quiz-q" id={questionId}>
        {question}
      </div>
      {options && (
        // radiogroup 以題目文字命名；每個選項是原生 <input type=radio>（同 name：Tab 只停在一個，←→↑↓ 切換並選取）
        <div className="c-quiz-options" role="radiogroup" aria-labelledby={questionId}>
          {options.map((o, i) => {
            const letter = String.fromCharCode(65 + i)
            return (
              <label key={i} className={`c-quiz-opt${picked === i ? (o.correct ? ' ok' : ' bad') : ''}`}>
                {/* 選項含數學時，單選鈕的名稱不能只靠 <label> 的內容（KaTeX 會被丟掉，名稱只剩「A.」），另給可念的 aria-label */}
                <input
                  type="radio"
                  name={name}
                  checked={picked === i}
                  onChange={() => pick(i)}
                  aria-label={nodeHasMath(o.label) ? `${letter}. ${nodeToAccessibleText(o.label)}` : undefined}
                />
                <span>
                  {letter}. {mathText(o.label)}
                </span>
              </label>
            )
          })}
        </div>
      )}
      {correct !== null && <div className={`c-quiz-verdict ${correct ? 'ok' : 'bad'}`}>{correct ? '答對了！' : '再想想看。'}</div>}
      <div className="c-sr-only" aria-live="polite">
        {correct !== null && <span key={picked ?? -1}>{correct ? '作答結果：答對了' : '作答結果：再想想看'}</span>}
      </div>
      <button type="button" className="btn" onClick={toggleAnswer} aria-expanded={shown}>
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
      {/* 標題含數學時，<summary> 的名稱（由內容算出）會漏掉公式，另給可念的 aria-label */}
      <summary aria-label={hasInlineMath(title) ? `先備知識 ${accessibleText(title)}` : undefined}>
        <span className={badgeClass('neutral', 'c-prereq-badge')}>先備知識</span> {mathText(title)}
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
