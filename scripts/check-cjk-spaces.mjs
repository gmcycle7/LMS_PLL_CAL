#!/usr/bin/env node
// 找出 JSX 文字裡「換行造成的多餘空白」：兩行都是中文（或其中一側是全形標點）時，JSX 會把換行縮成一個空格，
// 畫面上就出現「做對， 但不能取代」「…開始修。 下面兩個…」這種缺口。
//
//   node scripts/check-cjk-spaces.mjs                 檢查 src 底下所有 .tsx（略過測試檔），有違規就以 1 結束
//   node scripts/check-cjk-spaces.mjs --fix           把違規處的「換行＋縮排」直接接起來（只動空白字元）
//   node scripts/check-cjk-spaces.mjs --summary       依資料夾統計
//   node scripts/check-cjk-spaces.mjs --json          輸出所有違規（給測試或其他工具讀）
//   node scripts/check-cjk-spaces.mjs <檔案或資料夾…>  指定要掃（或 --fix 要改）的路徑（預設 src）
//
// 規則（JSX 文字的空白語意：每行去頭尾空白，非空的行用「一個空格」接起來；與標籤或 {…} 相鄰的換行不產生空格）：
//   (1) 換行前後兩個字元都是「中日韓字或全形標點」→ 空格必須拿掉（中文字之間不放空格）。
//   (2) 其中一側是全形標點、另一側是拉丁字母／數字 → 也拿掉（全形標點本身已帶空白；「修正。 learning」是錯的）。
//   (3) 同一行裡，全形的結尾標點（，。、；：！？）」』》】〕〗）後面多打的空格（「…的負的。 例：…」「）， PD 殘差」）→ 也拿掉。
//       標點後面接標籤（「。 <ClaimTag />」，空格把徽章和句子隔開）不算，那是刻意的。
//   拉丁字母（或數字）與中文字之間的空格是本站的排版慣例，保留；要在兩行之間保留空格就寫 {' '}（明確的 JSX 運算式不會被動到）。
//   「空格＋破折號」的寫法（Ch11 的「節點 —— 寫成」）兩側都要有空格：破折號前面已經有空格時，換行產生的那個空格就是對稱的右空格，
//   不算多餘（接起來會變成「節點 ——寫成」）；「」 —— 字」裡標點後面的空格同理。
// 只處理 JsxText 節點：模板字串、引號字串、註解、props 都不會被掃到或改到。
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_ROOTS = ['src']

// 漢字、假名、注音（含擴充區）
const HAN_LIKE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u
// 全形標點：CJK 符號與標點（U+3001–303F，去掉表意空白與漢字類）、全形／半形形式（U+FF00–FFEF 的標點與符號）、
// 直書用的相容標點（U+FE30–FE4F），以及中文常用的 …（U+2026）、⋯（U+22EF）、—（U+2014）、‧（U+2027）
const FULLWIDTH_PUNCT = /[\u3001-\u3004\u3008-\u3020\u3030\u303d\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\uffe0-\uffee\ufe30-\ufe4f]/
const CJK_STYLE_PUNCT = /[\u2014\u2026\u22ef\u2027]/

/** 全形的結尾標點：後面不該再跟空格 */
const CLOSING_FW = '，。、；：！？）」』》】〕〗'

/** 字元分類：'han' | 'fw'（全形標點）| 'cjkp'（中文也用的 — … ⋯，只在對方是中文時算）| 'other' */
function classify(ch) {
  if (HAN_LIKE.test(ch)) return 'han'
  if (FULLWIDTH_PUNCT.test(ch)) return 'fw'
  if (CJK_STYLE_PUNCT.test(ch)) return 'cjkp'
  return 'other'
}

/** 這個換行（左字元、右字元）在畫面上產生的空格是不是多餘的？回傳類別或 null。 */
export function classifyBreak(left, right) {
  const a = classify(left)
  const b = classify(right)
  const cjk = (k) => k === 'han' || k === 'fw'
  if (cjk(a) && cjk(b)) return `${a}-${b}`
  // 其中一側是全形標點、另一側是拉丁字母／數字（或其他符號）
  if ((a === 'fw' && b === 'other') || (a === 'other' && b === 'fw')) return `${a}-${b}`
  // — … ⋯ 只有在另一側是中文／全形標點時才算中文標點
  if ((a === 'cjkp' && cjk(b)) || (cjk(a) && b === 'cjkp')) return `${a}-${b}`
  return null
}

function firstChar(s) {
  return String.fromCodePoint(s.codePointAt(0))
}
function lastChar(s) {
  const cp = s.codePointAt(s.length - 1)
  // 低位代理：往前取一個
  if (cp >= 0xdc00 && cp <= 0xdfff && s.length > 1) return s.slice(-2)
  return s.slice(-1)
}

/**
 * 空白的左邊以「空格＋破折號／刪節號」結尾（「節點 ——」），或右邊以「破折號＋空格」開頭（「—— 寫成」）：
 * 作者用的是兩側留空的寫法，這個空格是對稱的另一側，不是多餘的。
 */
function isSpacedDash(before, after) {
  const DASH_RUN_END = /[ \t][\u2014\u2026\u22ef\u2027]+$/
  const DASH_RUN_START = /^[\u2014\u2026\u22ef\u2027]+[ \t]/
  return DASH_RUN_END.test(before) || DASH_RUN_START.test(after)
}

/**
 * 掃一份 TSX 原始碼，回傳所有多餘的換行空白。
 * 每筆：{ start, end, line, col, left, right, kind }；[start, end) 是「行尾空白＋換行＋下一行縮排」，拿掉它就是修正。
 */
export function findCjkBreaks(source, fileName = 'x.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const raw = source.slice(node.pos, node.end)
      // 內部換行：前後都有非空白字元（頭尾的換行靠近標籤或 {…}，JSX 會整段丟掉，不產生空格）
      const re = /(\S)([ \t]*\r?\n\s*)(?=(\S))/g
      let m
      while ((m = re.exec(raw))) {
        const before = raw.slice(0, m.index + 1)
        const after = raw.slice(m.index + m[0].length)
        const left = lastChar(before)
        const right = firstChar(after)
        const kind = classifyBreak(left, right)
        if (!kind) continue
        if (isSpacedDash(before, after)) continue
        const start = node.pos + m.index + 1
        const end = node.pos + m.index + m[0].length
        const lc = sf.getLineAndCharacterOfPosition(start)
        out.push({ start, end, line: lc.line + 1, col: lc.character + 1, left, right, kind })
      }
      // 同一行裡，全形結尾標點後面多打的空格（後面還有字；結尾的空格是在標籤或 {…} 前面，不算）
      const typed = new RegExp(`([${CLOSING_FW}])([ \\t]+)(?=\\S)`, 'gu')
      while ((m = typed.exec(raw))) {
        if (isSpacedDash(raw.slice(0, m.index + 1), raw.slice(m.index + m[0].length))) continue
        const start = node.pos + m.index + m[1].length
        const end = node.pos + m.index + m[0].length
        const lc = sf.getLineAndCharacterOfPosition(start)
        out.push({ start, end, line: lc.line + 1, col: lc.character + 1, left: m[1], right: firstChar(raw.slice(m.index + m[0].length)), kind: 'typed-fw' })
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out.sort((a, b) => a.start - b.start)
}

/** 套用修正：從後面往前刪，位置才不會位移。只刪空白字元。 */
export function fixCjkBreaks(source, fileName = 'x.tsx') {
  const breaks = findCjkBreaks(source, fileName)
  let out = source
  for (const b of [...breaks].sort((x, y) => y.start - x.start)) out = out.slice(0, b.start) + out.slice(b.end)
  return { text: out, count: breaks.length }
}

/** 列出要掃的 .tsx（略過測試檔） */
export function listTsx(paths, root = REPO_ROOT) {
  const out = []
  const walk = (abs) => {
    const st = statSync(abs)
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(join(abs, name))
    } else if (/\.tsx$/.test(abs) && !/\.test\.tsx$/.test(abs)) {
      out.push(abs)
    }
  }
  for (const p of paths) walk(resolve(root, p))
  return out
}

/** 掃整批檔案，回傳 [{ file, breaks }]（只含有違規的檔案） */
export function scanFiles(files, root = REPO_ROOT) {
  const res = []
  for (const abs of files) {
    const breaks = findCjkBreaks(readFileSync(abs, 'utf8'), abs)
    if (breaks.length) res.push({ file: relative(root, abs), breaks })
  }
  return res
}

export const DEFAULT_SCAN_ROOTS = DEFAULT_ROOTS

function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const paths = args.filter((a) => !a.startsWith('--'))
  const files = listTsx(paths.length ? paths : DEFAULT_ROOTS)

  if (flags.has('--fix')) {
    let total = 0
    let changed = 0
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8')
      const { text, count } = fixCjkBreaks(src, abs)
      if (!count) continue
      // 安全檢查：拿掉所有空白後，內容必須一字不差
      if (text.replace(/\s+/g, '') !== src.replace(/\s+/g, '')) {
        console.error(`拒絕寫入 ${relative(REPO_ROOT, abs)}：修正後的非空白字元與原檔不同`)
        process.exit(2)
      }
      writeFileSync(abs, text)
      total += count
      changed += 1
      console.log(`${relative(REPO_ROOT, abs)}: ${count}`)
    }
    console.log(`修正 ${total} 處，共 ${changed} 個檔案`)
    return
  }

  const found = scanFiles(files)
  const total = found.reduce((s, f) => s + f.breaks.length, 0)

  if (flags.has('--json')) {
    console.log(JSON.stringify(found.map((f) => ({ file: f.file, breaks: f.breaks.map(({ line, col, left, right, kind }) => ({ line, col, left, right, kind })) })), null, 1))
  } else if (flags.has('--summary')) {
    const byDir = new Map()
    const byKind = new Map()
    for (const f of found) {
      const parts = f.file.split('/')
      const dir = parts.slice(0, 3).join('/')
      byDir.set(dir, (byDir.get(dir) ?? 0) + f.breaks.length)
      for (const b of f.breaks) byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1)
    }
    for (const [d, n] of [...byDir].sort()) console.log(`${String(n).padStart(5)}  ${d}`)
    console.log('--- 類別 ---')
    for (const [k, n] of [...byKind].sort()) console.log(`${String(n).padStart(5)}  ${k}`)
    console.log(`合計 ${total} 處，${found.length} 個檔案（掃描 ${files.length} 個 .tsx）`)
  } else {
    for (const f of found) {
      for (const b of f.breaks) {
        const what = b.kind === 'typed-fw' ? `「${b.left}」後面多打了空格` : `「${b.left}」與「${b.right}」之間的換行會變成一個空格`
        console.log(`${f.file}:${b.line}:${b.col}  ${what}（${b.kind}）`)
      }
    }
    if (total) {
      console.error(`\n共 ${total} 處。執行 node scripts/check-cjk-spaces.mjs --fix 可自動接起來；真的要空格就寫 {' '}。`)
    } else {
      console.log(`沒有多餘的換行空白（掃描 ${files.length} 個 .tsx）`)
    }
  }
  if (total && !flags.has('--json') && !flags.has('--summary')) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
