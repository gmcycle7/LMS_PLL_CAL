import { useMemo, type ReactNode } from 'react'
import { Callout, ClaimTag, Tex } from '@/components'
import { ALL_PRESETS } from '@/app/presets'
import { PAGES } from '@/app/registry'
import { auditSlots, experimentName, invalidGalleryIndices, PREVIEWABLE_EXPERIMENTS, type SlotAudit as SlotAuditRow } from '../data'
import { ErrataList, PageLink, Rich, SlotStatusChip, TestBadges } from '../common'
import { presetDomId } from './PresetCard'

export function useSlotAudit(): SlotAuditRow[] {
  return useMemo(
    () =>
      auditSlots(
        ALL_PRESETS,
        PAGES.map((p) => p.path),
      ),
    [],
  )
}

/** §19.2 的 12 個必備 preset：存在、唯一、頁面與實驗與規格一致、T-id 齊全 */
export function SlotAudit({ audit }: { audit: SlotAuditRow[] }) {
  const ok = audit.filter((a) => a.status === 'ok').length
  const missing = audit.filter((a) => a.status === 'missing')
  const bad = audit.filter((a) => a.status !== 'ok' && a.status !== 'missing')
  const invalid = invalidGalleryIndices(ALL_PRESETS)
  return (
    <>
      <p>
        規格 §19.2 要求 Gallery 至少提供 12 個 preset。下表直接讀 <code>src/data/presets/*.json</code>（<code>ALL_PRESETS</code>），以
        <code>galleryIndex</code> 找出每一格，並檢查：
      </p>
      <ol className="small">
        <li>
          <strong>存在且唯一</strong>：恰好一個 preset 的 <code>galleryIndex</code> 等於該編號（缺少就標「缺少」，<em>不會</em>補一個假的）。
        </li>
        <li>
          <strong>頁面在網站目錄中</strong>：<code>preset.page</code> 是 <code>src/app/registry.ts</code> 的路由，否則「載入並執行」會落到「找不到此頁面」。
        </li>
        <li>
          <strong>頁面與實驗與規格一致</strong>：例如 #3 必須在 Ch06 的 <code>polarity-explorer</code>。
        </li>
        <li>
          <strong>T-id 齊全</strong>：preset 的 <code>tests</code> 包含規格 §17 對應的編號。
        </li>
        <li>
          <strong>連結真的會套用參數</strong>：該頁面原始碼含有這個 experiment id 並呼叫 <code>useUrlPreset</code>——這一項需要讀原始碼，由
          <code>src/pages/gallery/data.test.ts</code> 在建置／測試時掃描驗證（瀏覽器端無法讀原始碼）。
        </li>
      </ol>
      <Callout kind={ok === 12 ? 'ok' : missing.length || bad.length ? 'danger' : 'warn'} title={`稽核結果：${ok} / 12 個正確`}>
        {missing.length > 0 && (
          <p>
            缺少：{missing.map((m) => `#${m.slot.index}`).join('、')}（尚未有任何 preset 填這個 <code>galleryIndex</code>）。
          </p>
        )}
        {bad.length > 0 && (
          <ul>
            {bad.map((b) => (
              <li key={b.slot.index}>
                #{b.slot.index}：{b.issues.join(' ')}
              </li>
            ))}
          </ul>
        )}
        {ok === 12 && <p>12 個 preset 都存在、唯一、頁面與實驗與規格一致，且帶有規格要求的 T-id。</p>}
        {invalid.length > 0 && <p>另有 galleryIndex 不在 1–12 的資料錯誤：{invalid.map((p) => `${p.id}（${String(p.galleryIndex)}）`).join('、')}。</p>}
      </Callout>
      <div className="table-wrap">
        <table className="gal-audit-table">
          <thead>
            <tr>
              <th>#</th>
              <th>規格 §19.2 的條件 → 現象</th>
              <th>preset</th>
              <th>頁面 / 實驗</th>
              <th>T-id</th>
              <th>結論</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.slot.index} data-slot={a.slot.index} data-status={a.status}>
                <td className="num">{a.slot.index}</td>
                <td>
                  <Rich text={a.slot.condition} /> → <Rich text={a.slot.lesson} />
                  <div>
                    <ErrataList ids={a.slot.errata} />
                  </div>
                </td>
                <td>
                  {a.preset ? (
                    <JumpButton domId={presetDomId(a.preset.id)}>
                      <code className="gal-id">{a.preset.id}</code>
                    </JumpButton>
                  ) : a.found.length > 1 ? (
                    a.found.map((p) => (
                      <code key={p.id} className="gal-id">
                        {p.id}
                      </code>
                    ))
                  ) : (
                    <span className="gal-bad">（缺少）</span>
                  )}
                </td>
                <td>
                  {a.preset ? (
                    <>
                      <PageLink path={a.preset.page} />
                      <div className="small muted">
                        {experimentName(a.preset.experiment)}
                        {PREVIEWABLE_EXPERIMENTS.includes(a.preset.experiment) ? '（可即時預覽）' : ''}
                      </div>
                    </>
                  ) : (
                    <span className="small muted">規格頁面：{a.slot.pages.join(' / ')}</span>
                  )}
                </td>
                <td>{a.slot.tests.length ? <TestBadges ids={a.slot.tests} /> : <span className="small muted">規格未指定</span>}</td>
                <td>
                  <ClaimTag kind={a.slot.claim} />
                </td>
                <td>
                  <SlotStatusChip status={a.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        T-id 徽章的狀態讀自 <code>src/data/verification-status.json</code>（<code>npm run verify</code> 產生）；只有 TypeScript 與 Python golden 都通過才顯示 verified。#11 在規格 §17 沒有對應的 T-id，以 <Tex>{'R_x\\mathbf n=\\mathbf 0'}</Tex> 的單元測試代替。
      </p>
    </>
  )
}

/** 頁內捲動到某個元素（HashRouter 下 #anchor 會被當成路由，所以用按鈕 + scrollIntoView） */
export function scrollToId(domId: string) {
  const el = document.getElementById(domId)
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

export function JumpButton({ domId, children }: { domId: string; children: ReactNode }) {
  return (
    <button type="button" className="gal-linkbtn" onClick={() => scrollToId(domId)}>
      {children}
    </button>
  )
}
