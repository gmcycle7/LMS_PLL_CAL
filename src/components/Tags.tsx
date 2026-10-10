import { useId } from 'react'
import { CLAIM_DESCRIPTION, CLAIM_LABEL, MODEL_LEVEL_INFO, SOURCE_DESCRIPTION, SOURCE_LABEL, modelLevelText } from './labels'
import type { ClaimKind, ModelLevelId, SourceKind } from './types'

/**
 * 帶 tooltip 的小徽章。tooltip 用 CSS（:hover / :focus-within）顯示，
 * 因此在手機上點一下（取得 focus）也能看到；同時以 aria-describedby 提供給螢幕閱讀器。
 */
function TipBadge({ className, label, tip }: { className: string; label: string; tip: string }) {
  const tipId = useId()
  return (
    <span className={`c-badge c-has-tip ${className}`} tabIndex={0} aria-describedby={tipId}>
      {label}
      <span className="c-tip" role="tooltip" id={tipId}>
        {tip}
      </span>
    </span>
  )
}

/** 規格 §0.1 三層結論標籤：「精確｜指定模型」「近似｜需驗證」「研究假說／延伸」 */
export function ClaimTag({ kind }: { kind: ClaimKind }) {
  return <TipBadge className={`c-claim c-claim-${kind}`} label={CLAIM_LABEL[kind]} tip={CLAIM_DESCRIPTION[kind]} />
}

/** 模型層級徽章 L0–L6；tooltip 取自規格 §15.1 表格 */
export function ModelLevel({ level, showName = false }: { level: ModelLevelId; showName?: boolean }) {
  const label = showName ? `${level} ${MODEL_LEVEL_INFO[level].model}` : `模型 ${level}`
  return <TipBadge className={`c-level c-level-${level}`} label={label} tip={modelLevelText(level)} />
}

/** 範例來源標示（預設 illustrative） */
export function SourceTag({ kind = 'illustrative' }: { kind?: SourceKind }) {
  return <TipBadge className={`c-source c-source-${kind}`} label={SOURCE_LABEL[kind]} tip={SOURCE_DESCRIPTION[kind]} />
}
