import './chapter.css'
import { PartFold, PartHead } from './common'
import { QuestionSection, SystemSection } from './sections/Intro'
import { ResidueSection } from './sections/Residue'
import { GmacMathSection } from './sections/GmacMath'
import { Part1QuizSection } from './sections/Part1Quiz'
import { HardwareSection } from './sections/Hardware'
import { FixedPointSection } from './sections/FixedPoint'
import { DtcRangeSection } from './sections/DtcRange'
import { HardwareNotesSection } from './sections/HardwareNotes'
import { WrapupSection } from './sections/Wrapup'
import { RecapSection } from './sections/Recap'
import { SymbolsSection } from './sections/Symbols'

/**
 * Ch04：DSM → DTC → PD → GMAC → Gain Update 系統訊號流（規格 §4、§4.1、§4.2、§16.1 第 1–8 項）。
 * 勘誤：E07（S vs G、tie 規則）、E13（單位：x/u 無因次，a/w/μ 帶 fs，K = K_qC）、E18（sum/average 的變異數）。
 * 版面（docs/teaching-style.md §2、§5、§8）：章首 = 問題 → 系統地圖（SystemMap）→「你在這裡」（.c-map-note）→ PageFrame 的本章資訊 strip 與先備自檢 → 符號說明與目錄（.ch04-guide）；
 * 每個主要概念先放方塊圖（diagrams.ts）再推導；符號表（id="symbols"）是整頁最後一個區塊。
 *
 * 兩個 Part（2026-10-19，審查 pedagogy：Beginner 路徑上第一個 PLL 章卻是全站最重的一章，RTL 細節和訊號流混在一起）：
 *   Part 1「訊號流：DTC → DSM → PD → GMAC」= §1 系統、§2 residue、§3 GMAC 的數學（含訊號流實驗）＋ 六題數學／訊號流思考題；
 *   Part 2「硬體實作：定點、暫存器、RTL 對照」= §4 硬體對應與時序（含條件取負）、§5 定點、§5b DTC 的範圍／LSB／量化抖動／T_0 預算（2026-10-19，審查 depth）、§6 RTL 檢查清單、§7 比較表／綜合手算／RTL 思考題。
 *   Part 2 在 Beginner 模式整段收成一個 <details>（PartFold），Engineer／Research 展開；§8 本課必記與符號表在摺疊框外面，所有模式都看得到。
 *   既有的 id（ch04-*、handcalc-HC-04.x、formula-F-04.x）、公式／手算／preset 的數量都不變；§3 與 §4 的編號對調（GMAC 的數學先於硬體對應）。
 */
export default function Chapter04() {
  return (
    <div className="ch04">
      <QuestionSection />
      <PartHead n={1} id="ch04-part-1" title="訊號流：DTC → DSM → PD → GMAC">
        用數學把訊號流走一遍：DSM 累加器裡的數字就是 DTC 要補的量（§2），PD 的一串 0/1 經過 GMAC 平均之後正比於 gain 誤差（§3）。只需要微積分和一點機率；位元數、右移、暫存器這些 RTL 細節留到 Part 2。
      </PartHead>
      <SystemSection />
      <ResidueSection />
      <GmacMathSection />
      <Part1QuizSection />
      <PartFold
        n={2}
        id="ch04-part-2"
        title="硬體實作：定點、暫存器、RTL 對照"
        lead="把 Part 1 的數學做成 RTL：硬體對應表與 clock domain／更新延遲（§4）、每條線幾個 bit、「÷N」怎麼右移與取整、gain accumulator 碰到 rail 怎麼辦（§5）、DTC 本身有幾個 bit——範圍、LSB、量化抖動與基準延遲的預算（§5b）、一份 RTL 檢查清單（§6），最後是比較表、綜合手算與四題 RTL 思考題（§7）。"
      >
        <HardwareSection />
        <FixedPointSection />
        <DtcRangeSection />
        <HardwareNotesSection />
        <WrapupSection />
      </PartFold>
      <RecapSection />
      <SymbolsSection />
    </div>
  )
}
