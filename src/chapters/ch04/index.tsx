import './chapter.css'
import { IntroSection } from './sections/Intro'
import { ResidueSection } from './sections/Residue'
import { HardwareSection } from './sections/Hardware'
import { GmacMathSection } from './sections/GmacMath'
import { FixedPointSection } from './sections/FixedPoint'
import { HardwareNotesSection } from './sections/HardwareNotes'
import { WrapupSection } from './sections/Wrapup'

/**
 * Ch04：DSM → DTC → PD → GMAC → Gain Update 系統訊號流（規格 §4、§4.1、§4.2、§16.1 第 1–8 項）。
 * 勘誤：E07（S vs G、tie 規則）、E13（單位：x/u 無因次，a/w/μ 帶 fs，K = K_qC）、E18（sum/average 的變異數）。
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
    </div>
  )
}
