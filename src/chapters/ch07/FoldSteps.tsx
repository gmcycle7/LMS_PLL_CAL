import type { ComponentProps } from 'react'
import { StepDerivation, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'

type StepsProps = ComponentProps<typeof StepDerivation>

/**
 * 依學習模式呈現逐步推導（docs/teaching-style.md §6）：
 *   Beginner：推導預設收合、一鍵展開；boxed 結果仍然直接顯示（先看結論，想看再展開）。
 *   Engineer / Research：直接展開（與 StepDerivation 相同）。
 * 三種模式顯示的是同一份推導，只改變呈現。
 */
export function FoldSteps(props: StepsProps) {
  const { mode } = useSettings()
  if (mode !== 'beginner') return <StepDerivation {...props} />
  const { result, title, steps } = props
  return (
    <div className="ch07-fold">
      <details>
        <summary>
          <span className="ch07-fold-badge">推導</span> {title ?? '一步一步推導'}（{steps.length} 步，點一下展開）
        </summary>
        <StepDerivation steps={steps} />
      </details>
      {result && (
        <div className="c-steps-result">
          <TexBlock>{String.raw`\boxed{${result}}`}</TexBlock>
        </div>
      )}
    </div>
  )
}
