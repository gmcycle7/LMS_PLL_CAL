import type { ReactNode } from 'react'
import { badgeClass } from '@/components'

/**
 * 小型勘誤標記：「勘誤 Exx」連到 #/verification（驗證頁依 id 列出勘誤）。
 * 用純 <a>（HashRouter 下 href="#/verification" 即可），不依賴 router context。
 */
export function ErratumNote({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <span className="ch07-erratum">
      <a href="#/verification" className={badgeClass('erratum', 'ch07-erratum-tag')} title={`本站與規格書不同之處，見驗證頁的勘誤 ${id}`}>
        勘誤 {id}
      </a>
      {children && <span className="ch07-erratum-text">{children}</span>}
    </span>
  )
}
