/**
 * 獨立 HTML 報告產生器（純函式，無 DOM 依賴）。
 * 產出的 HTML 只使用內嵌 CSS，可離線開啟、列印或存檔；所有文字一律經過 escapeHtml。
 */

export interface ReportMetric {
  name: string
  value: string
  unit?: string
  formulaId?: string
  claim?: string
  analytic?: string
  delta?: string
  /** true = ✓、false = ✗、undefined = 未設定容許誤差 */
  pass?: boolean
}

export interface ReportPlot {
  title: string
  /** 必須是 data:image/(png|jpeg|webp|gif) 的 base64 data URL，否則會被略過 */
  dataUrl: string
}

export interface ReportInput {
  title: string
  experimentId: string
  /** ISO 8601 時間戳記 */
  generatedAt: string
  appVersion: string
  commit: string
  modelLevel: string
  modelLevelDescription?: string
  claim?: string
  source?: string
  tests?: { id: string; status: string }[]
  seed?: number | null
  assumptions: string[]
  warnings: string[]
  /** 參數表：每列 [名稱, 值（已序列化）, 單位] */
  params: { name: string; value: string; unit?: string }[]
  units?: Record<string, string>
  metrics: ReportMetric[]
  crossCheck?: { name: string; status: string; note?: string }[]
  plots: ReportPlot[]
  /** 資料預覽（最多 200 列） */
  dataPreview?: { headers: string[]; rows: string[][]; totalRows: number }
  /** 圖表擷取失敗等附註 */
  notes?: string[]
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 跳脫 HTML 特殊字元（文字節點與屬性值皆適用） */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/

/** 只允許 raster image 的 base64 data URL（避免 javascript: 或 SVG script 注入） */
export function isSafeImageDataUrl(url: string): boolean {
  return DATA_URL_RE.test(url)
}

const REPORT_CSS = `
:root{--bg:#ffffff;--text:#1b2430;--muted:#5b6676;--border:#d9dee6;--soft:#f0f2f5;--ok:#1d7a46;--ok-soft:#e1f3e8;--warn:#9a6200;--warn-soft:#fdf1d8;--danger:#b42318;--danger-soft:#fde4e1;--accent:#1f5fa8}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 48px;background:var(--bg);color:var(--text);font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6}
main{max-width:980px;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .3em}
h2{font-size:1.12rem;margin:1.8em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--border)}
.meta{color:var(--muted);font-size:.86rem;display:flex;flex-wrap:wrap;gap:4px 16px}
.tag{display:inline-block;padding:0 8px;border-radius:999px;border:1px solid var(--border);background:var(--soft);font-size:.82rem;margin-right:6px}
.table-wrap{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.5em 0}
th,td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
th{background:var(--soft)}
td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--danger);font-weight:600}
.warning{border-left:4px solid var(--danger);background:var(--danger-soft);padding:6px 12px;margin:6px 0;border-radius:0 4px 4px 0}
.note{border-left:4px solid var(--warn);background:var(--warn-soft);padding:6px 12px;margin:6px 0;border-radius:0 4px 4px 0}
figure{margin:12px 0;padding:8px;border:1px solid var(--border);border-radius:6px}
figure img{max-width:100%;height:auto;display:block;margin:0 auto}
figcaption{color:var(--muted);font-size:.85rem;text-align:center;margin-top:4px}
code,pre{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:.85em}
footer{margin-top:32px;color:var(--muted);font-size:.8rem}
@media print{body{padding:0}figure{break-inside:avoid}}
`

function table(headers: string[], rows: string[][], numericCols: number[] = []): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${numericCols.includes(i) ? ' class="num"' : ''}>${escapeHtml(c)}</td>`)
          .join('')}</tr>`,
    )
    .join('\n')
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function list(items: string[], empty: string): string {
  if (items.length === 0) return `<p>${escapeHtml(empty)}</p>`
  return `<ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
}

/** 產生完整、獨立的 HTML 報告字串 */
export function buildReportHtml(input: ReportInput): string {
  const parts: string[] = []
  const meta = [
    `實驗 ID：${input.experimentId}`,
    `產生時間：${input.generatedAt}`,
    `版本：v${input.appVersion}`,
    `commit：${input.commit}`,
    input.seed !== undefined && input.seed !== null ? `seed：${input.seed}` : 'seed：（無隨機性）',
  ]
  parts.push(`<h1>${escapeHtml(input.title)}</h1>`)
  parts.push(`<div class="meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>`)

  const tags = [
    `模型層級 ${input.modelLevel}${input.modelLevelDescription ? `｜${input.modelLevelDescription}` : ''}`,
    input.claim ? `結論標籤：${input.claim}` : '',
    input.source ? `來源：${input.source}` : '',
  ].filter(Boolean)
  parts.push(`<p>${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</p>`)
  if (input.tests && input.tests.length > 0) {
    parts.push(
      `<p>${input.tests
        .map((t) => `<span class="tag">${escapeHtml(`${t.id}：${t.status}`)}</span>`)
        .join('')}</p>`,
    )
  }

  parts.push('<h2>警告（Warnings）</h2>')
  parts.push(
    input.warnings.length === 0
      ? '<p>無。</p>'
      : input.warnings.map((w) => `<div class="warning">${escapeHtml(w)}</div>`).join('\n'),
  )

  parts.push('<h2>假設（Assumptions）</h2>')
  parts.push(list(input.assumptions, '未列出假設。'))

  parts.push('<h2>參數（Parameters）</h2>')
  parts.push(
    input.params.length === 0
      ? '<p>無參數。</p>'
      : table(
          ['參數', '值', '單位'],
          input.params.map((p) => [p.name, p.value, p.unit ?? '']),
          [],
        ),
  )

  if (input.units && Object.keys(input.units).length > 0) {
    parts.push('<h2>單位（Units）</h2>')
    parts.push(table(['量', '單位'], Object.entries(input.units)))
  }

  parts.push('<h2>指標（Metrics）</h2>')
  parts.push(
    input.metrics.length === 0
      ? '<p>無指標。</p>'
      : table(
          ['指標', '數值', '單位', '公式 ID', '標籤', '解析值', 'Δ', '檢查'],
          input.metrics.map((m) => [
            m.name,
            m.value,
            m.unit ?? '',
            m.formulaId ?? '',
            m.claim ?? '',
            m.analytic ?? '',
            m.delta ?? '',
            m.pass === undefined ? '' : m.pass ? '✓ 在容許誤差內' : '✗ 超出容許誤差',
          ]),
          [1, 5, 6],
        ),
  )

  if (input.crossCheck && input.crossCheck.length > 0) {
    parts.push('<h2>交叉比對（Analytic / Monte Carlo / Fixed-Point）</h2>')
    parts.push(table(['項目', '狀態', '附註'], input.crossCheck.map((c) => [c.name, c.status, c.note ?? ''])))
  }

  parts.push('<h2>圖表（Plots）</h2>')
  const safePlots = input.plots.filter((p) => isSafeImageDataUrl(p.dataUrl))
  if (safePlots.length === 0) {
    parts.push('<p>本實驗沒有可嵌入的圖表。</p>')
  } else {
    for (const p of safePlots) {
      parts.push(
        `<figure><img src="${escapeHtml(p.dataUrl)}" alt="${escapeHtml(p.title)}"><figcaption>${escapeHtml(p.title)}</figcaption></figure>`,
      )
    }
  }
  const skipped = input.plots.length - safePlots.length
  const notes = [...(input.notes ?? [])]
  if (skipped > 0) notes.push(`${skipped} 張圖因格式不符（非 raster data URL）而未嵌入。`)
  if (notes.length > 0) parts.push(notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('\n'))

  if (input.dataPreview && input.dataPreview.headers.length > 0) {
    const dp = input.dataPreview
    parts.push('<h2>資料預覽（Data Preview）</h2>')
    parts.push(
      `<p>顯示前 ${dp.rows.length} 列（共 ${dp.totalRows} 列）；完整資料請使用「下載 CSV」。</p>`,
    )
    parts.push(table(dp.headers, dp.rows, dp.headers.map((_, i) => i)))
  }

  parts.push(
    `<footer>由 LMS × Fractional-N PLL Calibration Lab 產生。所有晶片數值若未另行標示，皆為 illustrative 示例，非量測數據。</footer>`,
  )

  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${input.title} · 實驗報告`)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
${parts.join('\n')}
</main>
</body>
</html>
`
}
