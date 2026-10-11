import './chapter.css'
import { IntroSection } from './sections/Intro'
import { ResidueSection } from './sections/Residue'
import { HardwareSection } from './sections/Hardware'
import { GmacMathSection } from './sections/GmacMath'
import { FixedPointSection } from './sections/FixedPoint'
import { HardwareNotesSection } from './sections/HardwareNotes'
import { WrapupSection } from './sections/Wrapup'
import { SymbolsSection } from './sections/Symbols'

/**
 * Ch04：DSM → DTC → PD → GMAC → Gain Update 系統訊號流（規格 §4、§4.1、§4.2、§16.1 第 1–8 項）。
 * 勘誤：E07（S vs G、tie 規則）、E13（單位：x/u 無因次，a/w/μ 帶 fs，K = K_qC）、E18（sum/average 的變異數）。
 * 版面（docs/teaching-style.md §2、§5、§8）：章首 = 問題 + 系統地圖（SystemMap）+ 一行「本章符號表在最後」；
 * 每個主要概念先放方塊圖（diagrams.ts）再推導；符號表（id="symbols"）是整頁最後一個區塊。
 */
export default function Chapter04() {
  return (
    <div className="ch04">
      <IntroSection />
      <ResidueSection />
      <HardwareSection />
      <GmacMathSection />
      <FixedPointSection />
      <HardwareNotesSection />
      <WrapupSection />
      <SymbolsSection />
    </div>
  )
}
