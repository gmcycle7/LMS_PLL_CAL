import type { CsvCell, CsvColumns } from './types'

/**
 * 觸發瀏覽器下載一段文字（JSON / CSV / HTML）。
 * `bom: true` 會在開頭加 UTF-8 BOM，讓 Excel 正確辨識中文欄名（CSV 建議開啟）。
 */
export function downloadText(filename: string, mime: string, text: string, opts: { bom?: boolean } = {}): void {
  const body = opts.bom ? '\uFEFF' + text : text
  const blob = new Blob([body], { type: `${mime};charset=utf-8` })
  downloadBlob(filename, blob)
}

/** 觸發下載一個 Blob */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延遲釋放，避免部分瀏覽器（Safari）在下載開始前就失效
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 將單一儲存格轉為 CSV 字串（數值保留完整精度：String(x) 為最短可回推表示） */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (v === Infinity) return 'Infinity'
    if (v === -Infinity) return '-Infinity'
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return csvQuote(guardFormula(v))
}

/** 欄名或字串儲存格：必要時加雙引號並跳脫內部雙引號（RFC 4180） */
function csvQuote(s: string): string {
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 防止 CSV formula injection：以 = + - @ 開頭、且不是合法數字的字串前面加上單引號。
 * （純數值儲存格不受影響，例如 -3.2 仍輸出為 -3.2）
 */
function guardFormula(s: string): string {
  if (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) return `'${s}`
  return s
}

/**
 * 將「欄名 → 數列」轉成 CSV 字串。
 * - 第一列為欄名；各欄長度可不同，較短的欄以空白補齊至最長欄的長度。
 * - 換行使用 '\n'。
 */
export function toCsv(columns: CsvColumns): string {
  const names = Object.keys(columns)
  if (names.length === 0) return ''
  const nRows = names.reduce((m, k) => Math.max(m, columns[k]?.length ?? 0), 0)
  const lines: string[] = [names.map((n) => csvQuote(guardFormula(n))).join(',')]
  for (let i = 0; i < nRows; i++) {
    const row = new Array<string>(names.length)
    for (let j = 0; j < names.length; j++) {
      const col = columns[names[j]]
      row[j] = col && i < col.length ? csvCell(col[i]) : ''
    }
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

/** 取 CSV 欄位的前 maxRows 列作為預覽表（報告用） */
export function csvPreview(columns: CsvColumns, maxRows = 200): { headers: string[]; rows: string[][]; totalRows: number } {
  const headers = Object.keys(columns)
  const totalRows = headers.reduce((m, k) => Math.max(m, columns[k]?.length ?? 0), 0)
  const n = Math.min(totalRows, Math.max(0, maxRows))
  const rows: string[][] = []
  for (let i = 0; i < n; i++) {
    rows.push(
      headers.map((h) => {
        const col = columns[h]
        if (!col || i >= col.length) return ''
        const v = col[i]
        return v === null || v === undefined ? '' : String(v)
      }),
    )
  }
  return { headers, rows, totalRows }
}
