import './chapter.css'
import { Intro } from './sections/Intro'
import { S1GradientDescent } from './sections/S1GradientDescent'
import { S2Stochastic } from './sections/S2Stochastic'
import { S3SignError } from './sections/S3SignError'
import { S4SignSign } from './sections/S4SignSign'
import { S5Compare } from './sections/S5Compare'
import { S6Wrap } from './sections/S6Wrap'
import { ChapterSymbols } from './sections/Symbols'

/**
 * Ch02：Gradient Descent、Sign-Error LMS 與 Sign-Sign LMS（規格 §1.1、§2.2–§2.3；勘誤 E40、E41、E43）。
 * 計算核心：src/simulation/models/lms.ts（四個 stepper，唯讀）與 sgd.ts（本章的 GD / SGD / mean-field / Monte Carlo）。
 * 版面：章首是系統地圖（SystemMap）與本章路線圖；每個主要概念先放方塊圖（diagrams.ts）再推導（docs/teaching-style.md §8）；
 * 符號表在最後（§5），章首只留一行連結。
 */
export default function Chapter02() {
  return (
    <div className="ch02">
      <Intro />
      <S1GradientDescent />
      <S2Stochastic />
      <S3SignError />
      <S4SignSign />
      <S5Compare />
      <S6Wrap />
      <ChapterSymbols />
    </div>
  )
}
