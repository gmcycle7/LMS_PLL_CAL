/**
 * Python → TypeScript 資料邊界：驗證器本身的行為，以及「每一個被網頁用到的 JSON 真的過一次驗證」。
 * （node project；JSON 一律用 readFileSync 讀，和 Vite 的 import 是同一份檔案。）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataValidationError, loadJson, parseSchemaDoc, validateValue, type Defs, type Schema } from './validate'
import { WEB_SCHEMAS, loadWebJson, schemaFile, webSchema } from './golden/schemas'
import casesJson from './golden/schema-cases.json'

const ROOT = process.cwd()
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

/** schemas.json 條目涵蓋的檔案（相對路徑）；glob 只支援檔名裡的一個 `*` */
function filesOf(entry: { paths?: string[]; glob?: string }): string[] {
  if (entry.paths) return entry.paths
  const glob = entry.glob as string
  const slash = glob.lastIndexOf('/')
  const dir = glob.slice(0, slash)
  const re = new RegExp(`^${glob.slice(slash + 1).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`)
  return readdirSync(join(ROOT, dir))
    .filter((f) => re.test(f) && f !== 'index.json')
    .sort()
    .map((f) => `${dir}/${f}`)
}

describe('validate.ts：驗證器', () => {
  interface Case {
    name: string
    schema: Schema
    value: unknown
    ok: boolean
    path?: string
  }
  const cases = casesJson.cases as unknown as Case[]
  const defs = casesJson.defs as unknown as Defs

  it('共用案例（Python 的 test_web_schema.py 跑同一份）：ok 與錯誤路徑都一致', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40)
    for (const c of cases) {
      const err = validateValue(c.value, c.schema, defs)
      if (c.ok) expect(err, c.name).toBeNull()
      else {
        expect(err, c.name).not.toBeNull()
        expect((err as string).startsWith(`${c.path ?? '$'} `), `${c.name}：${err}`).toBe(true)
      }
    }
  })

  it('非有限數值：NaN／Infinity 在 number、any、陣列裡都被擋下，並指出位置', () => {
    expect(validateValue(NaN, 'number')).toContain('$')
    expect(validateValue([1, Infinity], { array: 'number' })).toMatch(/^\$\[1\] /)
    expect(validateValue({ a: [0, { b: -Infinity }] }, 'any')).toMatch(/^\$\.a\[1\]\.b /)
    expect(validateValue(undefined, 'any')).not.toBeNull()
  })

  it('loadJson：通過時原樣回傳同一個物件；失敗丟 DataValidationError，帶檔名、路徑與原因', () => {
    const raw = { loop: 'L2', f: [1, 2, 3] }
    const schema: Schema = { object: { loop: { enum: ['L1', 'L2'] }, f: { array: 'number', length: 3 } } }
    expect(loadJson<typeof raw>(raw, schema, 'x.json')).toBe(raw)
    let caught: unknown
    try {
      loadJson({ loop: 'L2', f: [1, 'x', 3] }, schema, 'x.json')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DataValidationError)
    const err = caught as DataValidationError
    expect(err.jsonName).toBe('x.json')
    expect(err.path).toBe('$.f[1]')
    expect(err.message).toContain('x.json')
    expect(err.message).toContain('$.f[1]')
  })

  it('loadJson：路徑含空白或冒號的 key 用 ["…"] 表示，錯誤訊息的路徑不會被切錯', () => {
    try {
      loadJson({ 'fx:bw 0.8': 'bad' }, { object: {}, rest: 'number' }, 'k.json')
      expect.unreachable()
    } catch (e) {
      expect((e as DataValidationError).path).toBe('$["fx:bw 0.8"]')
    }
  })

  it('oneOf 的錯誤訊息指出最接近的選項與它的路徑', () => {
    const s: Schema = { oneOf: [{ object: { a: 'number' } }, { object: { b: { array: 'number' } } }] }
    const err = validateValue({ b: [1, 'x'] }, s) as string
    expect(err).toContain('$ 不符合任何一個選項')
    expect(err).toContain('$.b[1]')
  })

  it('parseSchemaDoc：打錯字的 schema 在載入時就丟錯', () => {
    const base = { version: 1, defs: {}, files: [] }
    expect(() => parseSchemaDoc({ ...base, version: 2 })).toThrow(/version/)
    const withFile = (schema: unknown) => ({ ...base, files: [{ id: 'a', paths: ['x.json'], tsType: 'T', usedBy: [], schema }] })
    expect(() => parseSchemaDoc(withFile('numbr'))).toThrow(/numbr/)
    expect(() => parseSchemaDoc(withFile({ $ref: 'Nope' }))).toThrow(/Nope/)
    expect(() => parseSchemaDoc(withFile({ object: { a: 'number' }, optional: ['b'] }))).toThrow(/optional/)
    expect(() => parseSchemaDoc(withFile({ object: { a: 'number' }, sameLength: [['a', 'z']] }))).toThrow(/sameLength/)
    expect(() => parseSchemaDoc(withFile({ array: 'number', lenght: 3 }))).toThrow(/lenght/)
    expect(() => parseSchemaDoc(withFile({ array: 'number', tuple: [] }))).toThrow(/恰好/)
    expect(() => parseSchemaDoc({ ...base, files: [{ id: 'a', paths: ['x'], glob: 'y*', tsType: 'T', usedBy: [], schema: 'any' }] })).toThrow(/擇一/)
    expect(() => parseSchemaDoc(withFile('any'))).not.toThrow()
  })
})

describe('schemas.json：盤點表', () => {
  it('每個條目有 id、型別名稱、使用者，且涵蓋至少一個真的存在的檔案', () => {
    expect(WEB_SCHEMAS.files.length).toBeGreaterThanOrEqual(14)
    for (const f of WEB_SCHEMAS.files) {
      expect(f.tsType.length, f.id).toBeGreaterThan(0)
      expect(f.usedBy.length, f.id).toBeGreaterThan(0)
      const files = filesOf(f)
      expect(files.length, f.id).toBeGreaterThan(0)
      for (const p of files) expect(existsSync(join(ROOT, p)), p).toBe(true)
    }
  })

  it('網頁資料夾裡的每個 JSON 都有 schema（新增資料檔卻忘了寫 schema 會在這裡失敗）', () => {
    const covered = new Set(WEB_SCHEMAS.files.flatMap((f) => filesOf(f)))
    const dirs = ['src/data/sspll', 'golden/vectors', 'src/data']
    for (const d of dirs) {
      for (const f of readdirSync(join(ROOT, d)).filter((n) => n.endsWith('.json'))) {
        expect(covered.has(`${d}/${f}`), `${d}/${f} 沒有 schema 條目`).toBe(true)
      }
    }
  })

  it('golden/vector 用 glob 涵蓋 golden/vectors/*.json（index.json 除外）：新增的 vector 自動套 Vector schema；Python 的 --check-web 以 id 前綴 golden/vector 套「期望值為 0 就要有 abs 容忍度」', () => {
    const vectorIds = WEB_SCHEMAS.files.filter((f) => f.id.startsWith('golden/vector')).map((f) => f.id)
    expect(vectorIds).toEqual(['golden/vector'])
    expect(schemaFile('golden/vector').glob).toBe('golden/vectors/*.json')
    expect(filesOf(schemaFile('golden/vector'))).toContain('golden/vectors/negative_tests.json')
    expect(filesOf(schemaFile('golden/vector'))).not.toContain('golden/vectors/index.json')
  })
})

describe('每個被網頁用到的 JSON 都過一次驗證', () => {
  for (const entry of WEB_SCHEMAS.files) {
    for (const rel of filesOf(entry)) {
      it(`${entry.id}：${rel}`, () => {
        const raw = readJson(rel)
        expect(() => loadWebJson(entry.id, raw, rel)).not.toThrow()
      })
    }
  }

  it('案例頁的按需載入（lazyData）走同一個驗證，且 loop 欄位和請求的迴路一致', async () => {
    const { loadSspllData } = await import('../pages/case-sspll/lazyData')
    const hpd = await loadSspllData('hpd', 'L2')
    expect(hpd.loop).toBe('L2')
    expect(hpd.f_MHz).toHaveLength(1500)
    const sm = await loadSspllData('signmap', 'L3')
    expect(sm.loop).toBe('L3')
    expect(sm.kP).toHaveLength(2000)
  })

  it('案例頁 data.ts 的同步匯入也過驗證（PARAMS、PRED、WORKED、GOS_SCAN、DITHER、DOC_*）', async () => {
    const d = await import('../pages/case-sspll/data')
    expect(Object.keys(d.PARAMS.loops)).toEqual(['L1', 'L2', 'L3'])
    expect(d.PRED.fine.alpha).toHaveLength(500)
    expect(d.WORKED.c_lines.length).toBeGreaterThan(0)
    expect(Object.keys(d.GOS_SCAN).length).toBeGreaterThan(5)
    expect(Object.keys(d.DITHER.dither).length).toBeGreaterThan(0)
    expect(Object.keys(d.DOC_JOINT.joint_scan)).toEqual(['L1', 'L2', 'L3'])
    expect(Object.keys(d.DOC_PHOS.circulant_check)).toEqual(['L2', 'L3'])
  })
})

describe('壞資料真的會被擋下（對真實檔案做破壞，驗證器要指出正確的位置）', () => {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
  const errOf = (id: string, raw: unknown): DataValidationError => {
    try {
      loadWebJson(id, raw, 'mutated.json')
    } catch (e) {
      return e as DataValidationError
    }
    throw new Error(`${id} 應該驗證失敗`)
  }

  it('hpd：欄位少一個點、改名、loop 不是 L1／L2／L3', () => {
    const base = readJson('src/data/sspll/hpd_L1.json') as Record<string, unknown>
    const short = clone(base)
    ;(short.ReH as number[]).pop()
    expect(errOf('sspll/hpd', short).path).toBe('$.ReH')
    const renamed = clone(base)
    renamed.ReH_renamed = renamed.ReH
    delete renamed.ReH
    expect(errOf('sspll/hpd', renamed).path).toBe('$.ReH')
    expect(errOf('sspll/hpd', { ...clone(base), loop: 'L4' }).path).toBe('$.loop')
  })

  it('signmap：把 summary 的計數改成小數、把 Ponly 欄位改成字串', () => {
    const base = readJson('src/data/sspll/signmap_L2.json') as { summary: Record<string, unknown> } & Record<string, unknown>
    const m1 = clone(base)
    m1.summary.n_large_signal_inverted = 2.5
    expect(errOf('sspll/signmap', m1).path).toBe('$.summary.n_large_signal_inverted')
    const m2 = clone(base)
    m2.kP_Ponly = 'none'
    expect(errOf('sspll/signmap', m2).path).toBe('$.kP_Ponly')
  })

  it('params：某個迴路少 bL、頻帶少一格', () => {
    const base = readJson('src/data/sspll/params.json') as { loops: Record<string, Record<string, unknown>> }
    const a = clone(base)
    delete a.loops.L2.bL
    expect(errOf('sspll/params', a).path).toBe('$.loops.L2.bL')
    const b = clone(base)
    ;(b.loops.L3.ReH_neg_bands_MHz as number[][])[0].pop()
    expect(errOf('sspll/params', b).path).toBe('$.loops.L3.ReH_neg_bands_MHz[0]')
  })

  it('pred_vs_sim：fine 的欄位長度與 alpha 不同、GOS 欄位的 null 以外的垃圾', () => {
    const base = readJson('src/data/sspll/pred_vs_sim.json') as { fine: Record<string, Record<string, unknown[]>> }
    const a = clone(base)
    a.fine.L2.kP_sim.pop()
    expect(errOf('sspll/pred_vs_sim', a).path).toBe('$.fine.L2.kP_sim')
    const b = clone(base)
    b.fine.L1.kG_sim[10] = 'NaN'
    expect(errOf('sspll/pred_vs_sim', b).path).toBe('$.fine.L1.kG_sim[10]')
  })

  it('golden vector：沒有 expected、容忍度為空、非有限數值', () => {
    const base = readJson('golden/vectors/T01.json') as Record<string, unknown>
    const a = clone(base)
    delete a.expected
    expect(errOf('golden/vector', a).path).toBe('$.expected')
    const b = clone(base)
    b.tolerance = {}
    expect(errOf('golden/vector', b).path).toBe('$.tolerance')
    const c = clone(base) as { expected: Record<string, unknown> }
    c.expected.w1 = Number.NaN
    expect(errOf('golden/vector', c).path).toBe('$.expected.w1')
  })

  it('errata／verification-status：severity 不在 enum、status 不在 enum', () => {
    const e = clone(readJson('src/data/errata.json')) as { errata: Record<string, unknown>[] }
    e.errata[3].severity = 'critical'
    expect(errOf('data/errata', e).path).toBe('$.errata[3].severity')
    const s = clone(readJson('src/data/verification-status.json')) as { tests: Record<string, Record<string, unknown>> }
    s.tests.T02.status = 'ok'
    expect(errOf('data/verification-status', s).path).toBe('$.tests.T02.status')
  })

  it('schemaFile／webSchema 對不存在的 id 丟出列出現有 id 的錯誤', () => {
    expect(() => schemaFile('nope')).toThrow(/sspll\/params/)
    expect(webSchema('sspll/params').defs).toBe(WEB_SCHEMAS.defs)
  })
})

describe('golden vectors 的語意檢查（schema 之外）', () => {
  const vectorFiles = WEB_SCHEMAS.files.filter((f) => f.id.startsWith('golden/vector')).flatMap((f) => filesOf(f))

  it('期望值是 0 的量必須有 abs > 0 的容忍度（rel 對 0 沒有意義）', () => {
    const zeros = (v: unknown, p: string): string[] =>
      typeof v === 'number' ? (v === 0 ? [p] : []) : Array.isArray(v) ? v.flatMap((x, i) => zeros(x, `${p}[${i}]`)) : []
    for (const rel of vectorFiles) {
      const vec = readJson(rel) as { expected: Record<string, unknown>; tolerance: { abs?: number }; tolerance_overrides?: Record<string, { abs?: number }> }
      for (const [key, val] of Object.entries(vec.expected)) {
        const tol = vec.tolerance_overrides?.[key] ?? vec.tolerance
        const z = zeros(val, key)
        if (z.length > 0) expect((tol.abs ?? 0) > 0, `${rel}：${z.join(', ')} 的期望值是 0，容忍度 ${JSON.stringify(tol)} 沒有 abs`).toBe(true)
      }
    }
  })

  it('index.json 列出的每個檔案存在，且 id 與檔名一致', () => {
    const index = readJson('golden/vectors/index.json') as { vectors: { id: string; file: string }[] }
    for (const v of index.vectors) {
      expect(existsSync(join(ROOT, 'golden/vectors', v.file)), v.file).toBe(true)
      expect((readJson(`golden/vectors/${v.file}`) as { id: string }).id).toBe(v.id)
    }
  })
})
