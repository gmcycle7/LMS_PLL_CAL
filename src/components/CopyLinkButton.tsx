import { useEffect, useId, useRef, useState } from 'react'
import { experimentShareUrl, type ExperimentUrlState } from './experimentUrl'
import './copyLink.css'

export interface CopyLinkButtonProps extends ExperimentUrlState {
  /** 實驗 id（ExperimentShell 的 id） */
  experimentId: string
  /** 按鈕文字（預設「複製連結」） */
  label?: string
}

/** 「已複製」回饋停留多久（毫秒） */
export const COPIED_FEEDBACK_MS = 2500

/**
 * 複製這個實驗目前設定的完整網址（目前頁面 + ?a=／p=／seed=）。
 *
 *   - 優先用 navigator.clipboard.writeText；成功 → 按鈕旁出現「已複製」，同時在 aria-live 區播報。
 *   - 沒有 clipboard API 或被拒絕（非 https、權限、iframe）→ 改顯示一個唯讀文字框，內容已全選，讀者按 Ctrl／⌘+C；
 *     不假裝複製成功。
 *   - 網址在按下去的當下才計算（不是 render 時），所以永遠是最新的 preset 與 seed。
 */
export function CopyLinkButton({ experimentId, presetId, seed, label = '複製連結' }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | null>(null)
  const inputId = useId()

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  // 文字框出現就聚焦並全選
  useEffect(() => {
    if (status === 'manual') {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [status])

  const onClick = async () => {
    const next = experimentShareUrl(experimentId, { presetId, seed })
    setUrl(next)
    if (timer.current !== null) window.clearTimeout(timer.current)
    let ok = false
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(next)
        ok = true
      }
    } catch {
      ok = false
    }
    if (ok) {
      setStatus('copied')
      timer.current = window.setTimeout(() => setStatus('idle'), COPIED_FEEDBACK_MS)
    } else {
      setStatus('manual')
    }
  }

  return (
    <div className="c-copylink" data-experiment-link={experimentId}>
      <button type="button" className="btn" onClick={onClick}>
        {label}
      </button>
      <span className="c-copylink-status small" role="status" aria-live="polite">
        {status === 'copied' ? '已複製' : status === 'manual' ? '無法自動複製：請按 Ctrl／⌘+C 複製下面的網址' : ''}
      </span>
      {status === 'manual' && (
        <input
          id={inputId}
          ref={inputRef}
          className="c-copylink-input mono"
          type="text"
          readOnly
          value={url}
          aria-label="分享連結"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  )
}
