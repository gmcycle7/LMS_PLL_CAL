import { Section, SymbolTable, Tex } from '@/components'
import { r, scrollToId } from '../common'
import { SYMBOLS } from '../symbols'

/** 章末符號表的錨點 id（docs/teaching-style.md §5） */
export const SYMBOLS_ANCHOR = 'symbols'

/**
 * 章首只留這一行：按下去捲到章末的符號表。
 * HashRouter 下 `href="#symbols"` 會被當成路由，所以用按鈕 + scrollIntoView，不改網址。
 */
export function SymbolsLink() {
  return (
    <p className="cs-symbols-link">
      <button type="button" className="cs-linkbtn" onClick={() => scrollToId(SYMBOLS_ANCHOR)}>
        本章符號表在最後 ↓
      </button>
      <span className="small muted">（每個符號第一次出現時，正文也會就地用一句話說明。）</span>
    </p>
  )
}

/** §21 本章符號表：放在頁面最後（「本課必記」與其後各節之後），外層 id="symbols"。 */
export function S21Symbols() {
  return (
    <Section kind="formula" level={2} title="21. 本章符號表" id={SYMBOLS_ANCHOR}>
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            時間索引：<Tex>{'n'}</Tex> = 比較器 sample（每個 <Tex>{r`T_{ref}`}</Tex> 一個）、<Tex>{'k'}</Tex> = GMAC block。時間誤差以 fs 為單位、頻率以 <Tex>{r`f_{ref}`}</Tex> 正規化、<Tex>{r`\Omega`}</Tex> 為 rad/sample；本章的 <Tex>{r`\delta`}</Tex>{' '}
            一律是「真值 − 估計」。「首次出現」欄是正文第一次說明這個符號的段落。
          </>
        }
      />
    </Section>
  )
}
