import type { ComponentType, ReactNode } from 'react'
import type { HandCalcDef } from '@/data/types'
import { HandCalc } from '../HandCalc'
import { AnchorLink } from '../links/FormulaLink'
import { mathText } from '../Tex'
import './chapter.css'

/** 沒有給引言時的預設句子 */
export const HAND_CALC_DEFAULT_LEAD = '把下面的數字換成你自己的，先用紙筆和計算機算一次，再展開步驟對答案。'

/**
 * 接在引言後面的「怎麼用」固定句子（`bindHandCalc(defs, { tail: HAND_CALC_HOWTO_TAIL })`）：每一題都補一句怎麼代數字、怎麼切到「自己算算看」、怎麼換一題。
 * Ch11、Ch11b 共用；以前各章 Hand.tsx 各抄一份同一句長字串。
 */
export const HAND_CALC_HOWTO_TAIL = '把數字換成你自己的，下面會一步一步把它們代進公式；想先自己用紙筆（或一般的工程計算機）算，就切到「自己算算看」，算完再對答案；按「換一題」可以隨機出數字。'

export interface ChapterHandCalcProps {
  /** 題目 id，例如 'HC-07.3' */
  id: string
  /** 本章的手算題清單（handcalcs.ts 的 HANDCALCS） */
  defs: readonly HandCalcDef[]
  /** 「換你算：」後面的引言；字串裡的 `$…$` 以 KaTeX 排版。沒給就用 HAND_CALC_DEFAULT_LEAD */
  children?: ReactNode
  /** 接在引言後面的固定句子（Ch08／Ch11 的做法：每一題都再補一句怎麼用） */
  tail?: ReactNode
}

/**
 * 章內的「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章的題庫取出，前面加一句邀請讀者「先自己算、再對答案」的引言。
 * id 打錯時丟錯（章節測試會抓到），不會默默少一題。
 * 原本每章各有一份（Hand／HandCalcSlot／HandCalcBox／ChapterHandCalc／HC：標籤、邊界、引言的樣式各不相同，Ch13 找不到題目時還會回傳 null）。
 */
export function ChapterHandCalc({ id, defs, children, tail }: ChapterHandCalcProps) {
  const def = defs.find((h) => h.id === id)
  if (!def) throw new Error(`找不到手算題 ${id}（請檢查本章的 handcalcs.ts）`)
  return (
    <div className="c-chapter-hand" data-handcalc={id}>
      <p className="c-chapter-hand-lead">
        <strong>換你算：</strong>
        {typeof children === 'string' ? mathText(children) : (children ?? HAND_CALC_DEFAULT_LEAD)}
        {tail ? <> {tail}</> : null}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/**
 * 把本章的題庫綁進去，回傳這一章專用的 `<Hand id>`：`export const Hand = bindHandCalc(HANDCALCS)`。
 * 這樣章內幾十個呼叫點不必每次都傳 defs，也沒有第二份實作。
 */
export function bindHandCalc(defs: readonly HandCalcDef[], opts: { tail?: ReactNode } = {}): ComponentType<{ id: string; children?: ReactNode }> {
  return function BoundHandCalc({ id, children }) {
    return (
      <ChapterHandCalc id={id} defs={defs} tail={opts.tail}>
        {children}
      </ChapterHandCalc>
    )
  }
}

export interface HandLinkProps {
  /** 題目 id，例如 'HC-09.2' */
  id: string
  /** 連結文字（預設「帶入手算 HC-…」） */
  children?: ReactNode
  className?: string
}

/** 連到本頁某一題「帶入手算」（HandCalc 的錨點是 `handcalc-<id>`）；用 AnchorLink，所以複製連結、在新分頁開啟都能定位。 */
export function HandLink({ id, children, className }: HandLinkProps) {
  return (
    <AnchorLink id={`handcalc-${id}`} className={className ? `c-handlink ${className}` : 'c-handlink'}>
      {children ?? `帶入手算 ${id}`}
    </AnchorLink>
  )
}
