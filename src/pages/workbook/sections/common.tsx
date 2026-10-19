import type { ReactNode } from 'react'
import { Badge, ChapterFig, Tex, TexBlock, mathText } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { LEVEL_LABEL, givenTex, resultTex, type Level } from '../logic'

/** 難度徽章（文字與 HandCalc 標頭相同） */
export function LevelBadge({ level }: { level: Level }) {
  // 難度不是「結論強度」，不借用精確／近似／研究假說的綠／琥珀／紫：三種難度都是中性徽章，靠文字區分
  return <Badge className={`wb-level wb-level-${level}`}>{LEVEL_LABEL[level]}</Badge>
}

/** 「已知」：把這一題的輸入量排成 符號 = 數值 單位（白話說明） */
export function GivenList({ def, values }: { def: HandCalcDef; values: Record<string, number> }) {
  return (
    <ul className="wb-given">
      {def.inputs.map((i) => (
        <li key={i.key}>
          <Tex>{givenTex(i.symbol, values[i.key], i.unit)}</Tex>
          <span className="wb-given-label">{mathText(i.label)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 詳解：def.solve() 回傳的逐步代入（符號式 = 代入數字 = 結果）＋答案框＋補充觀察。
 * 版面沿用 HandCalc 元件的 class，螢幕上看起來與各章的「帶入手算」一致。
 */
export function SolutionView({ sol }: { sol: HandCalcSolution }) {
  return (
    <div className="wb-solution">
      <ol className="c-steps-list">
        {sol.steps.map((s, idx) => (
          <li key={idx} className="c-step">
            <div className="c-step-tex">
              <TexBlock>{s.tex}</TexBlock>
            </div>
            <div className="c-step-why">{mathText(s.why)}</div>
          </li>
        ))}
      </ol>
      <div className="c-handcalc-results">
        {sol.results.map((r, idx) => (
          <TexBlock key={idx} label={r.label ? mathText(r.label) : undefined}>
            {resultTex(r)}
          </TexBlock>
        ))}
      </div>
      {sol.notes && sol.notes.length > 0 && (
        <ul className="c-handcalc-notes">
          {sol.notes.map((n, idx) => (
            <li key={idx}>{mathText(n)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 方塊圖版位（docs/teaching-style.md §8）：一張 Mermaid 圖、一句圖說（要看什麼），下面緊接「先看…再看…」的導讀。
 * 圖說支援 `$…$` 行內公式（Mermaid 元件會用 KaTeX 排版）；導讀的數學用 <Tex>。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children?: ReactNode }) {
  return (
    <ChapterFig chart={chart} caption={caption} ariaLabel={ariaLabel} className="wb-diagram">
      {children}
    </ChapterFig>
  )
}
