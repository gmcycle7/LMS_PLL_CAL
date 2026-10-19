import { useEffect, useState, type ReactNode } from 'react'
import { erratumIndexEntry } from '@/data/errataIndex'
import { ErratumLink } from '../links/ErratumLink'
import { mathText } from '../Tex'
import './chapter.css'

type CorrectionMap = ReadonlyMap<string, string>

/** 載入完成後的快取：之後才掛載的 ChapterErratumNote 第一次 render 就有官方修正文字（不閃「載入中」） */
let loadedCorrections: CorrectionMap | null = null
let pendingCorrections: Promise<CorrectionMap> | null = null

/**
 * 官方修正文字（src/data/errata.json 的 `correction`，全部 49 條約 75 KB）：第一次需要時才動態 import，
 * 所有 ChapterErratumNote 共用同一份 promise。行內徽章不需要全文，只讀 src/data/errataIndex.ts 的精簡索引；
 * 若在這裡靜態 import errata.json，它會被打包進每一頁都載入的主 chunk（scripts/build-errata-index.mjs 檔頭）。
 * 載入失敗（離線、chunk 404）時清掉 promise，下一次掛載可以重試。
 */
export function loadErratumCorrections(): Promise<CorrectionMap> {
  pendingCorrections ??= import('@/data/errata.json').then(
    (m) => {
      const file = m.default as { errata: { eid: string; correction?: string }[] }
      loadedCorrections = new Map(file.errata.flatMap((e) => (e.correction ? [[e.eid, e.correction] as const] : [])))
      return loadedCorrections
    },
    (err: unknown) => {
      pendingCorrections = null
      throw err
    },
  )
  return pendingCorrections
}

/** 清掉快取（測試用：讓「載入前」與「載入失敗」的畫面可以重現；網站本身不會呼叫） */
export function resetErratumCorrections(): void {
  loadedCorrections = null
  pendingCorrections = null
}

export interface ChapterErratumProps {
  /** 勘誤編號，例如 'E44' */
  id: string
  /** 徽章後面的一句說明（可以放 JSX／`<Tex>`） */
  children?: ReactNode
  /**
   * 同 children，但是純文字，`$…$` 以 KaTeX 排版（mathText）。
   * 原本 Ch03／Ch04／Ch10／Ch11 的 `note`／`title` 是只有滑鼠移上去才看得到的浮動提示（觸控裝置與鍵盤看不到）；現在直接顯示在徽章後面。
   */
  note?: string
  /**
   * 比較長的說明（一兩句話，可以有 `<Tex>`）：放在徽章「後面」，不在徽章（連結）裡面，所以不會變成一個整句都是連結的長藥丸。
   * children／note 是徽章裡的短註記（「勘誤 E43：原文拼成 Regessor」）；超過一個短語就用 detail。
   */
  detail?: ReactNode
}

/**
 * 章節裡的「勘誤 Exx」行內徽章：全站只有一種（連到驗證頁的 `?e=Exx` 卡片，浮動提示是嚴重度與區域，取自精簡索引 src/data/errataIndex.ts）。
 * 原本每章各有一份 Erratum／ErratumNote／ErrataNote（有的連到 #/verification 頁首、有的帶 ?e=、顏色與邊框各自定義）。
 * 這只是 ErratumLink 的章節入口，多了 `note`。
 */
export function ChapterErratum({ id, children, note, detail }: ChapterErratumProps) {
  const badge = <ErratumLink id={id}>{children ?? (note ? mathText(note) : undefined)}</ErratumLink>
  if (!detail) return badge
  return (
    <span className="c-erratum-wrap">
      {badge} <span className="c-erratum-detail">{detail}</span>
    </span>
  )
}

export interface ChapterErratumNoteProps {
  id: string
  /** 這一章怎麼處理這條勘誤（一兩句話） */
  children: ReactNode
}

/**
 * 區塊版的勘誤說明（Ch00 的做法）：一個琥珀色外框，裡面是勘誤徽章、本章的處理方式，
 * 以及可展開的「官方修正文字」（docs/validation.md 的原文，來自 src/data/errata.json）。
 * 句子中間提到勘誤用 ChapterErratum；要把一條勘誤的來龍去脈放在段落之間才用這個。
 *
 * 官方修正文字是延後載入的（loadErratumCorrections）：載入前外框裡只有徽章與本章的處理方式，加上一句「載入修正文字…」
 * （外框 `aria-busy`）；載入後換成可展開的 `details`。編號不在索引裡（打錯）時不載入、不畫 `details`，徽章會標 data-missing。
 */
export function ChapterErratumNote({ id, children }: ChapterErratumNoteProps) {
  const known = erratumIndexEntry(id) !== undefined
  const [corrections, setCorrections] = useState<CorrectionMap | null>(loadedCorrections)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!known || corrections) return
    let alive = true
    loadErratumCorrections().then(
      (map) => {
        if (alive) setCorrections(map)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [known, corrections])
  const correction = corrections?.get(id)
  const loading = known && !corrections && !failed
  return (
    <aside className="c-erratum-block" aria-label={`勘誤 ${id}`} data-erratum-block={id} aria-busy={loading || undefined}>
      <ErratumLink id={id} />
      <span className="c-erratum-block-text">{children}</span>
      {loading && <span className="small muted c-erratum-block-loading"> 載入修正文字…</span>}
      {failed && <span className="small muted c-erratum-block-loading"> 修正文字載入失敗（請重新整理頁面）</span>}
      {correction && (
        <details className="c-erratum-block-details">
          <summary>官方修正文字</summary>
          <p className="small">{correction}</p>
        </details>
      )}
    </aside>
  )
}
