import type { ReactNode } from 'react'
import { ClaimTag, ModelLevel, SourceTag } from '@/components'
import { md } from './shared'
import { S1Intro } from './sections/S1Intro'
import { S2Msd } from './sections/S2Msd'
import { S3Objectives } from './sections/S3Objectives'
import { S4Budget } from './sections/S4Budget'
import { S5Calculator } from './sections/S5Calculator'
import { S6Corner } from './sections/S6Corner'
import { S7Schedule } from './sections/S7Schedule'
import { S8StateMachine } from './sections/S8StateMachine'
import { S9Wrap } from './sections/S9Wrap'
import './chapter.css'

const TOC: { id: string; label: ReactNode }[] = [
  { id: 'ch14-question', label: '14.0 問題與手算' },
  { id: 'ch14-msd', label: md(String.raw`14.1 推導 $E[\delta_B^2]$`) },
  { id: 'ch14-objectives', label: '14.2 不同目標' },
  { id: 'ch14-budget', label: '14.3 固定總預算' },
  { id: 'ch14-calculator', label: '14.4 第 10 課計算器' },
  { id: 'ch14-corner', label: '14.5 Corner 區間（E16）' },
  { id: 'ch14-schedule', label: '14.6 步長排程' },
  { id: 'ch14-state-machine', label: '14.7 狀態機' },
  { id: 'ch14-compare', label: '14.8 策略比較' },
  { id: 'ch14-synthesis', label: '綜合手算' },
  { id: 'ch14-quiz', label: '思考題' },
]

/**
 * Ch14：Learning Rate、Accumulation Length 與 Tracking Schedule（規格 §14、§14.1、§14.2；第 10 課；勘誤 E16、E48）。
 * 所有數字與曲線由 src/simulation/models/optimizer.ts 即時計算（重的 Monte Carlo 走 Web Worker）。
 */
export default function Chapter14() {
  return (
    <div className="ch14">
      <div className="c-tag-row">
        <ModelLevel level="L1" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
      </div>
      <nav aria-label="本章目錄" className="small">
        {TOC.map((t, i) => (
          <span key={t.id}>
            {i > 0 && ' · '}
            <a href={`#${t.id}`} onClick={(e) => {
              e.preventDefault()
              document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>
              {t.label}
            </a>
          </span>
        ))}
      </nav>
      <S1Intro />
      <S2Msd />
      <S3Objectives />
      <S4Budget />
      <S5Calculator />
      <S6Corner />
      <S7Schedule />
      <S8StateMachine />
      <S9Wrap />
    </div>
  )
}
