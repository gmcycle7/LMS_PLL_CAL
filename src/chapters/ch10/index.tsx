import './chapter.css'
import { Section, Tex } from '@/components'
import { MimoLab } from './experiments/MimoLab'
import { S0Intro } from './sections/S0Intro'
import { S1Coupling } from './sections/S1Coupling'
import { S2UpdateMatrix } from './sections/S2UpdateMatrix'
import { S3Noise } from './sections/S3Noise'
import { S4Jacobian } from './sections/S4Jacobian'
import { S5Architectures } from './sections/S5Architectures'
import { S6Wrapup } from './sections/S6Wrapup'
import { S7Symbols } from './sections/S7Symbols'

/**
 * 第 10 章：多參數 Sign-LMS、Jacobian 與 Preconditioner（規格 §10；ChatGPT 入門課第 11 課）。
 * 勘誤：E05、E08、E21、E22、E24、E25、E37（docs/validation.md）。驗證：T18（＋ T10 / T11 重用）。
 * 所有數字由 src/simulation/models/mimo.ts 計算（numbers.ts 彙整）。
 * 方塊圖登錄在 diagrams.ts（章首另有共用的 SystemMap）；符號表在章末（S7Symbols，id="symbols"）。
 */
export default function Chapter10() {
  return (
    <div className="ch10">
      <S0Intro />
      <S1Coupling />
      <S2UpdateMatrix />
      <S3Noise />
      <S4Jacobian />
      <S5Architectures />
      <Section kind="explore" title="互動實驗：MIMO LMS Lab" level={2} id="ch10-lab">
        <p>
          下面的實驗把本章全部的元素放在一起：2×2 / 3×3 Matrix Inspector（可直接編輯 <Tex>{String.raw`\mathbf R`}</Tex> 或 <Tex>{String.raw`\mathbf J`}</Tex>）、eigen / singular values、更新方向場、同一個 seed 下 Case A / B / C 與六種規則的權重軌跡、
          穩態共變異橢圓（Monte Carlo 在 Web Worker 中執行，對照 Lyapunov 與封閉式），以及收斂速度 vs 雜訊懲罰表。上方 Preset 選單包含 Gallery #12、598 / 5 / 65、E24 的{' '}
          <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 失配、sequential 陷阱、3×3 GOS / PHOS / gain 與中央差分量測 <Tex>{String.raw`\hat{\mathbf J}`}</Tex>。
        </p>
        <MimoLab />
      </Section>
      <S6Wrapup />
      {/* 符號表放在章末（docs/teaching-style.md §5）：整頁最後一個區塊，id="symbols" */}
      <S7Symbols />
    </div>
  )
}
