/**
 * 網頁用資料 JSON 的 schema 目錄（讀 `schemas.json`；同一份檔案給 Python 的 `--check-web` 用）。
 *
 * 用法：
 *   import { loadWebJson } from '@/data/golden/schemas'
 *   export const PARAMS = loadWebJson<ParamsJson>('sspll/params', paramsJson, 'params.json')
 *
 * `id` 是 schemas.json 裡每個條目的 id（一個條目可以涵蓋多個檔案，例如 hpd_L1／L2／L3 共用 'sspll/hpd'）。
 * 條目同時記載該檔對應的 TS 型別與使用者（`tsType`、`usedBy`），是「Python → TypeScript 資料邊界」的盤點表。
 */
import schemasJson from './schemas.json'
import { loadJson, parseSchemaDoc, type SchemaBundle, type SchemaDoc, type SchemaFile } from '../validate'

/** 已檢查過格式的 schemas.json（打錯字會在載入時丟錯，不是等到驗資料時才發現） */
export const WEB_SCHEMAS: SchemaDoc = parseSchemaDoc(schemasJson)

const BY_ID = new Map<string, SchemaFile>(WEB_SCHEMAS.files.map((f) => [f.id, f]))

export function schemaFile(id: string): SchemaFile {
  const f = BY_ID.get(id)
  if (!f) throw new Error(`schemas.json 沒有 id 為 '${id}' 的條目（現有：${[...BY_ID.keys()].join('、')}）`)
  return f
}

/** 某個條目的 schema 與它引用的 defs */
export function webSchema(id: string): SchemaBundle {
  return { schema: schemaFile(id).schema, defs: WEB_SCHEMAS.defs }
}

/** 驗證後原樣回傳；`name` 是錯誤訊息裡顯示的檔名 */
export function loadWebJson<T>(id: string, raw: unknown, name: string): T {
  return loadJson<T>(raw, webSchema(id), name)
}
