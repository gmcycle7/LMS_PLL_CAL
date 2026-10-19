import { Section, SymbolTable, Tex } from '@/components'
import { r } from '../common'
import { SYMBOLS } from '../symbols'

/** 章末符號表的錨點 id（docs/teaching-style.md §5） */
export const SYMBOLS_ANCHOR = 'symbols'

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
