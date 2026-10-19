/**
 * golden/vectors/*.json（Python golden model 產生；NumPy / SciPy 獨立重算）以相對路徑靜態匯入。
 * 頁面上的「Golden」欄就是這些檔案的 expected，原封不動；網站的即時值由 acceptance.ts 呼叫各章模型計算。
 */
import { loadWebJson } from '@/data/golden/schemas'
import type { AcceptanceId, GoldenVectorLike } from '@/simulation/models/acceptance'
import T01 from '../../../golden/vectors/T01.json'
import T02 from '../../../golden/vectors/T02.json'
import T03 from '../../../golden/vectors/T03.json'
import T04 from '../../../golden/vectors/T04.json'
import T05 from '../../../golden/vectors/T05.json'
import T06 from '../../../golden/vectors/T06.json'
import T07 from '../../../golden/vectors/T07.json'
import T08 from '../../../golden/vectors/T08.json'
import T09 from '../../../golden/vectors/T09.json'
import T10 from '../../../golden/vectors/T10.json'
import T11 from '../../../golden/vectors/T11.json'
import T12 from '../../../golden/vectors/T12.json'
import T13 from '../../../golden/vectors/T13.json'
import T14 from '../../../golden/vectors/T14.json'
import T15 from '../../../golden/vectors/T15.json'
import T16 from '../../../golden/vectors/T16.json'
import T17 from '../../../golden/vectors/T17.json'
import T18 from '../../../golden/vectors/T18.json'
import NEG from '../../../golden/vectors/negative_tests.json'
import INDEX from '../../../golden/vectors/index.json'

const asVector = (v: unknown, name: string): GoldenVectorLike => loadWebJson<GoldenVectorLike>('golden/vector', v, name)

export const GOLDEN: Record<AcceptanceId, GoldenVectorLike> = {
  T01: asVector(T01, 'T01.json'),
  T02: asVector(T02, 'T02.json'),
  T03: asVector(T03, 'T03.json'),
  T04: asVector(T04, 'T04.json'),
  T05: asVector(T05, 'T05.json'),
  T06: asVector(T06, 'T06.json'),
  T07: asVector(T07, 'T07.json'),
  T08: asVector(T08, 'T08.json'),
  T09: asVector(T09, 'T09.json'),
  T10: asVector(T10, 'T10.json'),
  T11: asVector(T11, 'T11.json'),
  T12: asVector(T12, 'T12.json'),
  T13: asVector(T13, 'T13.json'),
  T14: asVector(T14, 'T14.json'),
  T15: asVector(T15, 'T15.json'),
  T16: asVector(T16, 'T16.json'),
  T17: asVector(T17, 'T17.json'),
  T18: asVector(T18, 'T18.json'),
}

export const GOLDEN_NEGATIVE: GoldenVectorLike = loadWebJson<GoldenVectorLike>('golden/vector', NEG, 'negative_tests.json')

export interface GoldenIndex {
  schema_version: number
  golden_model_version: string
  generator: string
  comparison_rule: string
  vectors: { id: string; file: string; spec_section: string; description_zh: string }[]
}

export const GOLDEN_INDEX = loadWebJson<GoldenIndex>('golden/index', INDEX, 'index.json')
