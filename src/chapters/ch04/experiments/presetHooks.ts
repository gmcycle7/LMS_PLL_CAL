import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExperimentPreset, UseCasesResult } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'

/**
 * Ch04 實驗共用：把 preset（src/data/presets/gmac*.json）套用到「共用參數 + A/B/C cases」。
 * preset.params 格式：{ ...共用參數, seed?: number, cases?: CaseParams[] }。
 * useCases 沒有「一次設定多組」的 API：先 reset 成 cases[0]，下一次 render 再逐一 addCase + update。
 */
export function useCasePresets<P>(opts: {
  experiment: string
  cases?: UseCasesResult<P>
  applyShared: (params: Record<string, unknown>) => void
  setSeed?: (seed: number) => void
  /** 初始時額外加入的 cases（例如預設就顯示 A/B 對照） */
  initialExtraCases?: P[]
  /** 把 preset 內（可能只寫了部分欄位的）case 補成完整參數；省略時原樣使用。必須是穩定的函式（模組層級或 useCallback）。 */
  normalizeCase?: (c: Partial<P>) => P
}): { presets: ExperimentPreset[]; load: (params: Record<string, unknown>) => void } {
  const { experiment, cases, applyShared, setSeed, normalizeCase } = opts
  const [pending, setPending] = useState<P[] | null>(opts.initialExtraCases && opts.initialExtraCases.length ? opts.initialExtraCases : null)
  // 同一批 pending 只處理一次。React StrictMode（dev server）會在 mount 時把 effect 連跑兩次（閉包相同），
  // 沒有這個防護時第二次會再 addCase 一次：多出一個重複的 Case C，還會蓋掉同一個 commit 內 URL preset 的 reset。
  const handled = useRef<P[] | null>(null)

  useEffect(() => {
    if (!pending || !cases) return
    if (handled.current === pending) return
    if (cases.cases.length !== 1) return // 等 reset 生效
    handled.current = pending
    // 注意：addCase 以同步快照 setState(next)，若交錯呼叫 update，下一次 addCase 會蓋掉前一個 patch；
    // 所以先把所有 case 加完，再逐一 update（functional setState 依序套用）。
    const ids = pending.map(() => cases.addCase())
    pending.forEach((p, i) => {
      const id = ids[i]
      if (id) cases.update(p, id)
    })
    cases.setActive('A')
    setPending(null)
  }, [pending, cases])

  const load = useCallback(
    (params: Record<string, unknown>) => {
      const { cases: raw, seed, ...shared } = params as { cases?: Partial<P>[]; seed?: number } & Record<string, unknown>
      applyShared(shared)
      if (typeof seed === 'number' && setSeed) setSeed(seed)
      // preset 檔案比實驗舊時可能缺少新加的 case 欄位：先補上預設值，避免控制項拿到 undefined
      const cs = Array.isArray(raw) ? raw.map((c) => (normalizeCase ? normalizeCase(c) : (c as P))) : undefined
      if (cases && cs && cs.length > 0) {
        cases.reset(cs[0])
        setPending(cs.length > 1 ? cs.slice(1) : null)
      }
    },
    [applyShared, cases, setSeed, normalizeCase],
  )

  const url = useUrlPreset(experiment)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (url && applied.current !== url.id) {
      applied.current = url.id
      load(url.params)
    }
  }, [url, load])

  const presets = useMemo(
    () => presetsForExperiment(experiment).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [experiment],
  )
  return { presets, load }
}
