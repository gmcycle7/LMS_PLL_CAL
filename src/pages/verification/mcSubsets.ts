import { MC_IDS, type AcceptanceId } from '@/simulation/models/acceptance'

/**
 * Monte Carlo 實驗的「項目」選項（單次執行與多 seed 校準共用）：
 *   all：全部有 MC 的 T-id；fast：單步／Binomial 類（毫秒級）；closed-loop：逐 sample 的閉迴路與 block MC（較慢）；
 *   或單一 T-id。
 */
export type McSubset = 'all' | 'fast' | 'closed-loop' | AcceptanceId

export const MC_SUBSETS: Record<'all' | 'fast' | 'closed-loop', AcceptanceId[]> = {
  all: MC_IDS,
  fast: ['T03', 'T04', 'T05', 'T13', 'T14', 'T17'],
  'closed-loop': ['T06', 'T07', 'T12', 'T18'],
}

export function idsOfSubset(subset: McSubset): AcceptanceId[] {
  return subset === 'all' || subset === 'fast' || subset === 'closed-loop' ? MC_SUBSETS[subset] : [subset]
}

export function isMcSubset(v: unknown): v is McSubset {
  return typeof v === 'string' && (v === 'all' || v === 'fast' || v === 'closed-loop' || (MC_IDS as string[]).includes(v))
}
