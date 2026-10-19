import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { accessibleText } from '@/components'
import {
  BACKBONE,
  LAST_VISIT_KEY,
  backboneHref,
  backboneProgress,
  backboneStepId,
  backboneTotalMinutes,
  formatMinutes,
  readLastVisit,
  recordLastVisit,
  resumeTarget,
  type BackboneStep,
  type LastVisit,
} from '@/app/backbone'
import { useQuizStats } from '@/app/quizProgress'
import { pageById } from '@/app/registry'
import { shortCode } from '../data'
import { Rich, type Progress } from '../ui'

/** 預設只露出這麼多步（上一步完成的 + 下一步 + 之後兩步），其餘 hidden；卡片才不會比 Hero 左欄高出一整個視窗（桌機實測 12 步全列是 1719 px、左欄 690 px） */
export const BACKBONE_WINDOW = 4

/** 預設露出的步驟範圍 [start, end)：從下一步的前一步開始；全部完成就全部露出 */
export function backboneWindow(nextIndex: number, total: number, size = BACKBONE_WINDOW): [number, number] {
  if (nextIndex < 0) return [0, total]
  const start = Math.max(0, Math.min(nextIndex - 1, total - size))
  return [start, Math.min(total, start + size)]
}

/** 路線上某一頁的最後一步：本章思考題的進度只在這一步顯示（同一頁可能有兩步，不重複列） */
function lastStepOfPage(step: BackboneStep, index: number): boolean {
  return !BACKBONE.slice(index + 1).some((s) => s.page === step.page)
}

function QuizLine({ page }: { page: string }) {
  const q = useQuizStats(page)
  if (q.total === 0 && q.answered === 0) return null
  const denom = q.total > 0 ? `/${q.total}` : ''
  return (
    <span className="dash-bb-quiz" data-quiz={`${q.answered}${denom}`}>
      本章思考題 {q.answered}
      {denom}
      {q.correct > 0 ? `（答對 ${q.correct}）` : ''}
    </span>
  )
}

function StepRow({ step, index, done, hidden, onToggle, onGo }: { step: BackboneStep; index: number; done: boolean; hidden?: boolean; onToggle: () => void; onGo: (s: BackboneStep) => void }) {
  const page = pageById(step.page)
  const id = backboneStepId(step)
  const where = `${shortCode(step.page) ?? page?.nav ?? step.page} ${step.sections}`
  return (
    <li className={`dash-bb-step${done ? ' is-done' : ''}`} data-step={id} hidden={hidden || undefined}>
      <input
        type="checkbox"
        className="dash-bb-check"
        checked={done}
        onChange={onToggle}
        aria-label={`標記第 ${index} 步（${where}：${accessibleText(step.title)}）為完成`}
      />
      <div className="dash-bb-body">
        <Link to={backboneHref(step)} className="dash-bb-link" onClick={() => onGo(step)} title={page?.title}>
          <span className="dash-bb-n">第 {index} 步</span>
          <span className="dash-bb-where">{where}</span>
        </Link>
        <div className="dash-bb-title">
          <Rich text={step.title} />
        </div>
        <div className="dash-bb-meta small muted">
          <span className="dash-bb-min">{step.minutes} 分</span>
          {step.experiments.length > 0 && <span>互動實驗 {step.experiments.length} 個</span>}
          {lastStepOfPage(step, index - 1) && <QuizLine page={step.page} />}
        </div>
      </div>
    </li>
  )
}

const RESUME_LABEL: Record<ReturnType<typeof resumeTarget>['kind'], (i: number) => string> = {
  'last-visit': (i) => `從上次離開的地方繼續（第 ${i} 步）`,
  next: (i) => `繼續第 ${i} 步`,
  start: () => '開始第 1 步',
  'all-done': () => '全部完成，從第 1 步複習',
}

/**
 * Beginner 模式首屏的「骨幹路線」卡（取代 Hero 右側的「從這裡開始」）：
 * 步驟清單（每步的章節範圍、一句話、分鐘數、互動實驗數）、完成勾選（沿用 lmspll.dashboard.done，段落級的 key 是 page#anchor）、
 * 本章思考題的進度（src/app/quizProgress.ts）、「從上次離開的地方繼續」（lmspll.lastVisited；沒有就是第一個還沒完成的步驟）。
 * 預設只露出 4 步（上一步完成的、下一步與之後兩步；backboneWindow），其餘 li 加 hidden，「顯示全部 12 步」才全列；12 個 li 永遠在 DOM 裡。
 * 按下任何一步的連結都會記下最後造訪的頁面，回到首頁就能接著走。
 */
export const BackboneCard = memo(function BackboneCard({ progress }: { progress: Progress }) {
  const [last, setLast] = useState<LastVisit | null>(() => readLastVisit())
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === LAST_VISIT_KEY) setLast(readLastVisit())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const summary = backboneProgress(progress.done)
  const resume = resumeTarget(progress.done, last)
  const [showAll, setShowAll] = useState(false)
  const nextIndex = summary.next ? BACKBONE.indexOf(summary.next) : -1
  const [winStart, winEnd] = useMemo(() => backboneWindow(nextIndex, BACKBONE.length), [nextIndex])
  const windowed = !showAll && winEnd - winStart < BACKBONE.length
  const total = backboneTotalMinutes()
  const pct = Math.round((100 * summary.done) / Math.max(1, summary.total))
  const go = useCallback((step: BackboneStep) => {
    recordLastVisit(step.page, step.anchor)
    setLast(readLastVisit())
  }, [])
  const resumeWhere = `${shortCode(resume.step.page) ?? pageById(resume.step.page)?.nav ?? resume.step.page} ${resume.step.sections}`
  return (
    <aside className="dash-start dash-backbone" id="dash-backbone" aria-labelledby="dash-backbone-title">
      <div className="dash-start-label">Beginner 骨幹路線</div>
      <h2 id="dash-backbone-title">
        最短路徑：{BACKBONE.length} 步，{formatMinutes(total)}
      </h2>
      <p className="small">
        只讀每一章最核心的一段（範圍寫在每一步），互動實驗只先露出 3–5 個關鍵參數。走完再回來用章節地圖補其餘各節；切到 Engineer 模式會看到完整內容。分鐘數是依 Beginner 模式看得到的字數、公式、圖與實驗估的。
      </p>
      <div className="dash-progress dash-bb-progress" aria-label={`骨幹路線已完成 ${summary.done} / ${summary.total} 步，還需 ${formatMinutes(summary.minutesLeft)}`}>
        <span className="dash-progress-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        已完成 {summary.done}/{summary.total} 步 · 還需 {formatMinutes(summary.minutesLeft)}
      </div>
      <Link to={resume.href} className="dash-cta dash-bb-resume" data-resume={resume.kind} onClick={() => go(resume.step)}>
        {RESUME_LABEL[resume.kind](resume.index)}：{resumeWhere} →
      </Link>
      <ol className="dash-bb-steps" id="dash-bb-steps" aria-label="骨幹路線的步驟">
        {BACKBONE.map((s, i) => {
          const id = backboneStepId(s)
          return <StepRow key={id} step={s} index={i + 1} done={progress.done.has(id)} hidden={windowed && (i < winStart || i >= winEnd)} onToggle={() => progress.toggle(id)} onGo={go} />
        })}
      </ol>
      {winEnd - winStart < BACKBONE.length && (
        <button type="button" className="dash-bb-toggle" aria-expanded={showAll} aria-controls="dash-bb-steps" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `只看接下來的 ${winEnd - winStart} 步` : `顯示全部 ${BACKBONE.length} 步`}
        </button>
      )}
      <p className="small muted dash-bb-foot">勾選只記在你自己的瀏覽器；整章的步驟和章節地圖的「已讀」是同一格。</p>
    </aside>
  )
})
