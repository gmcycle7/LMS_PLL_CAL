/**
 * Python → TypeScript 資料邊界的結構驗證器（不加新套件，約 200 行）。
 *
 * 為什麼要有它：網頁用的資料 JSON（案例頁的 params／pred_vs_sim／hpd／signmap、golden vectors、勘誤、驗證狀態…）
 * 是 Python 產生的；TypeScript 端以前用 `json as unknown as SomeType` 直接宣告型別，Python 端改了欄位名稱、
 * 少寫一個陣列元素、寫出 NaN，網頁要到畫圖那一刻才壞（或悄悄畫出空白）。現在每個 JSON 在載入時過一次
 * {@link loadJson}：結構不符就丟出帶路徑的錯誤（例如 `params.json 的 $.loops.L2.bL[1]：期望有限數值，收到字串`）。
 *
 * 同一份 schema（`src/data/golden/schemas.json`）也給 Python 端的 `python3 golden/export_vectors.py --check-web` 讀
 * （驗證器在 `analysis/sspll/golden/tools/web_schema.py`，語意與這裡一致；兩邊共用 `schema-cases.json` 的測試案例）。
 * 所以「schema 寫對了沒」由兩邊各自對真實檔案驗證，而不是只靠 TypeScript 的型別標註。
 *
 * Schema 語言（JSON，version 1）：
 *   'number'  有限數值（NaN／Infinity 不算）     'int'  整數      'string'  'boolean'  'null'
 *   'any'     任何 JSON 值，但其中所有數值必須有限
 *   { array: S, length?: n, minLength?: n }        陣列；length 為固定長度
 *   { tuple: [S, S, …] }                           固定長度、每格型別不同
 *   { object: { key: S, … }, optional?: [key…], rest?: S, sameLength?: [[key…], …], minKeys?: n }
 *        object 列出的欄位預設必填（optional 內的可省略）；沒列出的欄位：有 rest 就用 rest 驗證，沒有就放行；
 *        sameLength：同一組欄位若都是陣列，長度必須相同（「維度」檢查）；minKeys：物件至少有幾個 key
 *   { enum: [value…] }   { oneOf: [S, …] }（nullable 就是 oneOf [S, 'null']）   { $ref: 'defName' }
 *
 * 只驗結構，不驗數值的物理意義；數值的對照由各自的 golden 測試負責。
 */

export type Primitive = 'number' | 'int' | 'string' | 'boolean' | 'null' | 'any'

export type Schema =
  | Primitive
  | { array: Schema; length?: number; minLength?: number }
  | { tuple: Schema[] }
  | { object: Record<string, Schema>; optional?: string[]; rest?: Schema; sameLength?: string[][]; minKeys?: number }
  | { enum: (string | number | boolean | null)[] }
  | { oneOf: Schema[] }
  | { $ref: string }

export type Defs = Record<string, Schema>

/** 一個 JSON 檔的 schema 加上它引用的 defs */
export interface SchemaBundle {
  schema: Schema
  defs: Defs
}

/** schemas.json 裡的一個條目：哪些檔案、誰在用、TS 型別叫什麼、schema 是什麼 */
export interface SchemaFile {
  id: string
  /** 相對於專案根目錄的路徑（與 glob 擇一） */
  paths?: string[]
  /** 單一個 `*` 萬用字元，只在檔名那一層（例如 `golden/vectors/T*.json`） */
  glob?: string
  /** 檔案裡有哪些頂層欄位／檢查是 Python 端的 --check-web 要看的；純說明文字 */
  note?: string
  /** 對應的 TypeScript 型別與所在檔案（說明用；型別本身仍是手寫的 interface） */
  tsType: string
  usedBy: string[]
  schema: Schema
}

export interface SchemaDoc {
  version: number
  description: string
  defs: Defs
  files: SchemaFile[]
}

/** 驗證失敗：`jsonName` 是哪個檔案，`path` 是 `$.a.b[3]` 形式的位置，`reason` 是原因 */
export class DataValidationError extends Error {
  readonly jsonName: string
  readonly path: string
  readonly reason: string
  constructor(jsonName: string, path: string, reason: string) {
    super(`${jsonName} 的資料格式不符：${path} ${reason}`)
    this.name = 'DataValidationError'
    this.jsonName = jsonName
    this.path = path
    this.reason = reason
  }
}

const PRIMITIVES: readonly string[] = ['number', 'int', 'string', 'boolean', 'null', 'any']
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `陣列（長度 ${v.length}）`
  switch (typeof v) {
    case 'string':
      return `字串 ${JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}…` : v)}`
    case 'number':
      return Number.isFinite(v) ? `數值 ${v}` : `非有限數值 ${v}`
    case 'boolean':
      return `布林 ${v}`
    case 'object':
      return '物件'
    default:
      return typeof v
  }
}

const child = (path: string, key: string) => (IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`)

interface Err {
  path: string
  reason: string
}
const err = (path: string, reason: string): Err => ({ path, reason })

/** 'any'：任何 JSON 值，但所有數值必須有限（NaN／Infinity 不是合法 JSON，Python 的 json.dump 預設卻會寫出來） */
function checkFinite(v: unknown, path: string): Err | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : err(path, `期望有限數值，收到 ${describe(v)}`)
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const e = checkFinite(v[i], `${path}[${i}]`)
      if (e) return e
    }
    return null
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const e = checkFinite(x, child(path, k))
      if (e) return e
    }
    return null
  }
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return err(path, `不是 JSON 值（${typeof v}）`)
  return null
}

function resolve(s: Schema, defs: Defs): Schema {
  let cur = s
  for (let hops = 0; typeof cur === 'object' && '$ref' in cur; hops++) {
    const next = defs[cur.$ref]
    if (next === undefined) throw new Error(`schema 引用了不存在的 def：${cur.$ref}`)
    if (hops > 32) throw new Error(`schema 的 $ref 迴圈：${cur.$ref}`)
    cur = next
  }
  return cur
}

function check(v: unknown, schema: Schema, defs: Defs, path: string): Err | null {
  const s = resolve(schema, defs)
  if (typeof s === 'string') {
    switch (s) {
      case 'number':
        return typeof v === 'number' && Number.isFinite(v) ? null : err(path, `期望有限數值，收到 ${describe(v)}`)
      case 'int':
        return typeof v === 'number' && Number.isInteger(v) ? null : err(path, `期望整數，收到 ${describe(v)}`)
      case 'string':
        return typeof v === 'string' ? null : err(path, `期望字串，收到 ${describe(v)}`)
      case 'boolean':
        return typeof v === 'boolean' ? null : err(path, `期望布林，收到 ${describe(v)}`)
      case 'null':
        return v === null ? null : err(path, `期望 null，收到 ${describe(v)}`)
      default:
        return checkFinite(v, path)
    }
  }
  if ('array' in s) {
    if (!Array.isArray(v)) return err(path, `期望陣列，收到 ${describe(v)}`)
    if (s.length !== undefined && v.length !== s.length) return err(path, `期望長度 ${s.length} 的陣列，收到長度 ${v.length}`)
    if (s.minLength !== undefined && v.length < s.minLength) return err(path, `期望至少 ${s.minLength} 個元素，收到 ${v.length}`)
    const item = resolve(s.array, defs)
    if (item === 'number') {
      // 熱路徑：網格資料有數萬個數值，直接迴圈
      for (let i = 0; i < v.length; i++) {
        const x = v[i]
        if (typeof x !== 'number' || !Number.isFinite(x)) return err(`${path}[${i}]`, `期望有限數值，收到 ${describe(x)}`)
      }
      return null
    }
    for (let i = 0; i < v.length; i++) {
      const e = check(v[i], item, defs, `${path}[${i}]`)
      if (e) return e
    }
    return null
  }
  if ('tuple' in s) {
    if (!Array.isArray(v)) return err(path, `期望陣列，收到 ${describe(v)}`)
    if (v.length !== s.tuple.length) return err(path, `期望長度 ${s.tuple.length} 的陣列，收到長度 ${v.length}`)
    for (let i = 0; i < v.length; i++) {
      const e = check(v[i], s.tuple[i], defs, `${path}[${i}]`)
      if (e) return e
    }
    return null
  }
  if ('object' in s) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return err(path, `期望物件，收到 ${describe(v)}`)
    const rec = v as Record<string, unknown>
    const optional = new Set(s.optional ?? [])
    for (const [key, sub] of Object.entries(s.object)) {
      if (!Object.prototype.hasOwnProperty.call(rec, key) || rec[key] === undefined) {
        if (optional.has(key)) continue
        return err(child(path, key), '缺少必要欄位')
      }
      const e = check(rec[key], sub, defs, child(path, key))
      if (e) return e
    }
    if (s.rest !== undefined) {
      for (const key of Object.keys(rec)) {
        if (Object.prototype.hasOwnProperty.call(s.object, key)) continue
        const e = check(rec[key], s.rest, defs, child(path, key))
        if (e) return e
      }
    }
    if (s.minKeys !== undefined && Object.keys(rec).length < s.minKeys) return err(path, `期望至少 ${s.minKeys} 個欄位，收到 ${Object.keys(rec).length}`)
    for (const group of s.sameLength ?? []) {
      let len = -1
      let first = ''
      for (const key of group) {
        const a = rec[key]
        if (!Array.isArray(a)) continue
        if (len < 0) {
          len = a.length
          first = key
        } else if (a.length !== len) return err(child(path, key), `長度 ${a.length} 與 ${first} 的長度 ${len} 不同（同一組欄位必須等長）`)
      }
    }
    return null
  }
  if ('enum' in s) return s.enum.some((x) => x === v) ? null : err(path, `期望 ${s.enum.map((x) => JSON.stringify(x)).join(' | ')}，收到 ${describe(v)}`)
  if ('oneOf' in s) {
    const errs: Err[] = []
    for (const alt of s.oneOf) {
      const e = check(v, alt, defs, path)
      if (e === null) return null
      errs.push(e)
    }
    // 回報「走得最深」的那個選項的錯誤（路徑最長者），比籠統的「沒有一個選項符合」好找問題
    errs.sort((a, b) => b.path.length - a.path.length)
    return err(path, `不符合任何一個選項（共 ${s.oneOf.length} 個）；最接近的是 ${errs[0].path} ${errs[0].reason}`)
  }
  return err(path, `schema 不認得（${JSON.stringify(s)}）`)
}

/** 回傳第一個錯誤（`路徑 原因`），沒有錯誤就回傳 null */
export function validateValue(v: unknown, schema: Schema, defs: Defs = {}): string | null {
  const e = check(v, schema, defs, '$')
  return e === null ? null : `${e.path} ${e.reason}`
}

/** 驗證後原樣回傳；失敗丟 {@link DataValidationError}。`T` 是呼叫端宣告的型別（schema 要和它同步，見 validate.test.ts 的逐檔驗證）。 */
export function loadJson<T>(raw: unknown, schema: SchemaBundle | Schema, name: string): T {
  const bundle: SchemaBundle = typeof schema === 'object' && 'schema' in schema && 'defs' in schema ? schema : { schema: schema as Schema, defs: {} }
  const e = check(raw, bundle.schema, bundle.defs, '$')
  if (e !== null) throw new DataValidationError(name, e.path, e.reason)
  return raw as T
}

// ── schema 文件本身的檢查（schemas.json 打錯字時，在載入那一刻就報，而不是驗資料時才發現） ──────────────

function checkNode(node: unknown, defs: Defs, path: string): void {
  if (typeof node === 'string') {
    if (!PRIMITIVES.includes(node)) throw new Error(`${path}：不認得的型別 '${node}'`)
    return
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) throw new Error(`${path}：schema 節點必須是字串或物件`)
  const o = node as Record<string, unknown>
  const kinds = ['array', 'tuple', 'object', 'enum', 'oneOf', '$ref'].filter((k) => k in o)
  if (kinds.length !== 1) throw new Error(`${path}：schema 節點必須恰好有 array／tuple／object／enum／oneOf／$ref 其中一個（收到 ${Object.keys(o).join(',')}）`)
  const kind = kinds[0]
  const allowed: Record<string, string[]> = {
    array: ['array', 'length', 'minLength'],
    tuple: ['tuple'],
    object: ['object', 'optional', 'rest', 'sameLength', 'minKeys'],
    enum: ['enum'],
    oneOf: ['oneOf'],
    $ref: ['$ref'],
  }
  for (const k of Object.keys(o)) if (!allowed[kind].includes(k)) throw new Error(`${path}：${kind} 節點不認得欄位 '${k}'`)
  switch (kind) {
    case 'array':
      checkNode(o.array, defs, `${path}.array`)
      for (const k of ['length', 'minLength'] as const) if (k in o && !(Number.isInteger(o[k]) && (o[k] as number) >= 0)) throw new Error(`${path}.${k} 必須是非負整數`)
      return
    case 'tuple':
      if (!Array.isArray(o.tuple)) throw new Error(`${path}.tuple 必須是陣列`)
      o.tuple.forEach((x, i) => checkNode(x, defs, `${path}.tuple[${i}]`))
      return
    case 'object': {
      const fields = o.object
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`${path}.object 必須是物件`)
      for (const [k, x] of Object.entries(fields)) checkNode(x, defs, `${path}.object.${k}`)
      for (const k of (o.optional ?? []) as unknown[]) if (typeof k !== 'string' || !(k in fields)) throw new Error(`${path}.optional 的 '${String(k)}' 不在 object 欄位裡`)
      for (const g of (o.sameLength ?? []) as unknown[]) {
        if (!Array.isArray(g) || g.length < 2) throw new Error(`${path}.sameLength 的每一組至少要有兩個欄位`)
        for (const k of g) if (typeof k !== 'string' || !(k in fields)) throw new Error(`${path}.sameLength 的 '${String(k)}' 不在 object 欄位裡`)
      }
      if (o.rest !== undefined) checkNode(o.rest, defs, `${path}.rest`)
      return
    }
    case 'enum':
      if (!Array.isArray(o.enum) || o.enum.length === 0) throw new Error(`${path}.enum 必須是非空陣列`)
      return
    case 'oneOf':
      if (!Array.isArray(o.oneOf) || o.oneOf.length < 2) throw new Error(`${path}.oneOf 至少要有兩個選項`)
      o.oneOf.forEach((x, i) => checkNode(x, defs, `${path}.oneOf[${i}]`))
      return
    default:
      if (typeof o.$ref !== 'string' || !(o.$ref in defs)) throw new Error(`${path}：$ref '${String(o.$ref)}' 不在 defs 裡`)
  }
}

/** 檢查並回傳 schemas.json 的內容（不認得的型別、指向不存在 def 的 $ref、object.optional 列了不存在的欄位都會丟錯） */
export function parseSchemaDoc(raw: unknown): SchemaDoc {
  if (raw === null || typeof raw !== 'object') throw new Error('schemas.json 必須是物件')
  const d = raw as Record<string, unknown>
  if (d.version !== 1) throw new Error(`schemas.json 的 version 必須是 1，收到 ${String(d.version)}`)
  const defs = d.defs
  if (defs === null || typeof defs !== 'object' || Array.isArray(defs)) throw new Error('schemas.json 的 defs 必須是物件')
  for (const [k, x] of Object.entries(defs)) checkNode(x, defs as Defs, `defs.${k}`)
  if (!Array.isArray(d.files)) throw new Error('schemas.json 的 files 必須是陣列')
  const seen = new Set<string>()
  d.files.forEach((f: unknown, i: number) => {
    const e = f as Partial<SchemaFile> | null
    if (!e || typeof e.id !== 'string') throw new Error(`files[${i}] 缺少 id`)
    if (seen.has(e.id)) throw new Error(`files 的 id 重複：${e.id}`)
    seen.add(e.id)
    if ((e.paths === undefined) === (e.glob === undefined)) throw new Error(`${e.id}：paths 與 glob 必須擇一`)
    if (typeof e.tsType !== 'string' || !Array.isArray(e.usedBy)) throw new Error(`${e.id}：缺少 tsType／usedBy`)
    checkNode(e.schema, defs as Defs, `${e.id}.schema`)
  })
  return raw as SchemaDoc
}
