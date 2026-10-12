import { renderTex } from '@/components'

/**
 * 模型回傳的診斷訊息（filteredX.ts 的 analyzeFxLab／buildHat／closedLoopConsistent、blockLms.ts 的 runBlockLms）是純文字，
 * 數學用 Unicode 拼寫（`E[u·u_f] = -0.5 < 0`、`σ_rw = μ√(Kσ_η²)`…）。這些訊息也被模型測試與其他頁面使用，模型端不改；
 * Lab 把它們放進 ExperimentShell 的 warnings／crossCheck（會經過 mathText）之前，先在這裡把數學片段改寫成 `$...$`
 * （docs/teaching-style.md §3：數學一律 LaTeX）。
 *
 * 作法：由左到右掃描，把「項（已知符號或數字）＋關係符號＋項…」的最長片段換成 TeX。
 * 全有或全無：轉換後若仍殘留 Unicode 拼的數學，或任何片段 KaTeX 無法解析，整句退回原文
 * ——寧可顯示純文字，也不顯示半套公式或紅色的 KaTeX 錯誤。
 * 開頭的「C ≤ 0」「C ≈ 0」是全站警告的固定標籤（teaching-style §3 的例子），保留為純文字。
 */

const r = String.raw

type Kind = 'atom' | 'num' | 'rel'
interface Token {
  end: number
  tex: string
  kind: Kind
  /** 科學記號的數字（6.12e-17）：單獨出現也當成公式，顯示成 6.12×10⁻¹⁷ */
  sci?: boolean
}
type AtomRule = [RegExp, string | ((m: RegExpExecArray) => string)]

/** 不在英數字或底線之後（避免切到 type2_dt、E45、raw-x 這類識別字的中間） */
const NOT_AFTER_WORD = r`(?<![A-Za-z0-9_.])`

/** 已知的數學片段 → TeX。由上到下比對：長的、特定的片段要排在前面。全部是 sticky（y）regex。 */
const ATOMS: AtomRule[] = [
  // ── 整段的式子 ──
  [/\|w_end − a\| − \|w_0 − a\|/y, r`|w_{\mathrm{end}}-a|-|w_0-a|`],
  [/\|mean w − w_0\|/y, r`|\bar w-w_0|`],
  [/\|G\| ≤ max\|x_ref\|/y, r`|G|\le\max|x_{\mathrm{ref}}|`],
  [/μ√\(Kσ_η²\)/y, r`\mu\sqrt{K\sigma_\eta^2}`],
  [/u_f = ĥ \* x/y, r`u_f=\hat h*x`],
  [/\(1 − z⁻¹\)²\/\(ω\u0302_nT_s\)²/y, r`(1-z^{-1})^2/(\hat\omega_nT_s)^2`],
  [/\(1 − z⁻¹\)²/y, r`(1-z^{-1})^2`],
  [/× R\(z\)/y, r`\times R(z)`],
  [/× z\^−(\d+)/y, (m) => r`\times z^{-${m[1]}}`],
  [/×(?=\d)/y, r`\times`],
  // ── 符號 ──
  // filtered-x 的 regressor 再延遲 D（analyzeFxLab 在 D ≠ 0 時的訊息，F-07.12）；要排在 E[u·u_f] 之前
  [/E\[u\[n\]·u_f\[n−D\]\]/y, r`E[u[n]\,u_f[n-D]]`],
  [/E\[u·u_f\]/y, r`E[u\,u_f]`],
  [/E\[u²\]/y, r`E[u^2]`],
  [/\|Ĥ\|/y, r`|\hat H|`],
  [/\|w\|/y, '|w|'],
  [/Ĥ₂/y, r`\hat H_2`],
  [/Ĥ/y, r`\hat H`],
  [/ω\u0302_nT_s/y, r`\hat\omega_nT_s`],
  [/d\u0302/y, r`\hat d`],
  [/σ_rw/y, r`\sigma_{\mathrm{rw}}`],
  [/σ_η²/y, r`\sigma_\eta^2`],
  [/σ_([vw])/y, (m) => r`\sigma_${m[1]}`],
  [/K_q/y, 'K_q'],
  [/w_0/y, 'w_0'],
  [/u_f/y, 'u_f'],
  [/Δφ/y, r`\Delta\phi`],
  [/Δd/y, r`\Delta d`],
  [/Δ/y, r`\Delta`],
  [/μK/y, r`\mu K`],
  [/μ/y, r`\mu`],
  [/τ/y, r`\tau`],
  [/Ω/y, r`\Omega`],
  // 角度：90°、±90°、-30°
  [new RegExp(r`${NOT_AFTER_WORD}([-−±]?)(\d+(?:\.\d+)?)°`, 'y'), (m) => `${m[1] === '±' ? r`\pm` : m[1] ? '-' : ''}${m[2]}^\\circ`],
  // 後面接等號時才當成量的名稱
  [new RegExp(r`${NOT_AFTER_WORD}SE(?= ?=)`, 'y'), r`\mathrm{SE}`],
  [new RegExp(r`${NOT_AFTER_WORD}pole(?= ?=)`, 'y'), r`\text{pole}`],
  // 單一字母的變數：前後都不是英數字（GMAC、Case、DSM、raw-x 裡的字母不算）
  [/(?<![A-Za-z0-9_-])[CDHKNgpw](?![A-Za-z0-9_[({-])/y, (m) => m[0]],
]

const NUM = new RegExp(r`${NOT_AFTER_WORD}([-−]?)(?:(\d+(?:\.\d+)?)(?:e([-+−]?)(\d+))?|(Infinity))(%?)(?![A-Za-z_\d])`, 'y')
const REL = /[=≠≤≥≈<>]/y
const REL_TEX: Record<string, string> = { '=': '=', '≠': r`\ne`, '≤': r`\le`, '≥': r`\ge`, '≈': r`\approx`, '<': '<', '>': '>' }

function numTex(m: RegExpExecArray): string {
  const sign = m[1] ? '-' : ''
  const pct = m[6] ? r`\%` : ''
  if (m[5]) return `${sign}\\infty`
  if (m[4] === undefined) return `${sign}${m[2]}${pct}`
  const exp = `${m[3] === '-' || m[3] === '−' ? '-' : ''}${Number(m[4])}`
  return `${sign}${m[2] === '1' ? '' : `${m[2]}\\times`}10^{${exp}}${pct}`
}

function termAt(s: string, i: number): Token | null {
  for (const [re, tex] of ATOMS) {
    re.lastIndex = i
    const m = re.exec(s)
    if (m) return { end: re.lastIndex, tex: typeof tex === 'string' ? tex : tex(m), kind: 'atom' }
  }
  NUM.lastIndex = i
  const m = NUM.exec(s)
  return m ? { end: NUM.lastIndex, tex: numTex(m), kind: 'num', sci: m[4] !== undefined } : null
}

function relAt(s: string, i: number): Token | null {
  REL.lastIndex = i
  const m = REL.exec(s)
  return m ? { end: REL.lastIndex, tex: REL_TEX[m[0]], kind: 'rel' } : null
}

function skipSpaces(s: string, i: number): number {
  let j = i
  while (s[j] === ' ') j++
  return j
}

/** 從位置 i 開始的最長數學片段：[關係] 項 (緊鄰的項 | 關係 項)*；沒有就回傳 null。 */
function runAt(s: string, i: number): { end: number; tex: string } | null {
  const parts: Token[] = []
  let j = i
  const lead = relAt(s, j)
  const first = termAt(s, lead ? skipSpaces(s, lead.end) : j)
  if (!first) return null
  if (lead) parts.push(lead)
  parts.push(first)
  j = first.end
  for (;;) {
    const adjacent = termAt(s, j) // 10τ、3σ_rw、×1.25
    if (adjacent) {
      parts.push(adjacent)
      j = adjacent.end
      continue
    }
    const rel = relAt(s, skipSpaces(s, j))
    const next = rel ? termAt(s, skipSpaces(s, rel.end)) : null
    if (!rel || !next) break
    parts.push(rel, next)
    j = next.end
  }
  // 單獨的數字（「block 數 300」「5 SE」）不是公式；科學記號例外
  const isMath = parts.some((p) => p.kind === 'atom' || p.sci) || (parts.some((p) => p.kind === 'rel') && parts.some((p) => p.kind === 'num'))
  if (!isMath) return null
  let tex = ''
  for (const p of parts) tex += (/[A-Za-z]$/.test(tex) && /^[A-Za-z]/.test(p.tex) ? ' ' : '') + p.tex
  return { end: j, tex }
}

/** 轉換後不應該還留在純文字裡的東西：Unicode 拼的符號、單字母下標、落單的關係符號 */
const LEFTOVER = /[θΩωζφσμτρδηπ∠Ĥĥ√²³⁻¹₀₁₂≤≥≈≠±∇ΔΣ·×°]|\u0302|(?<![A-Za-z0-9])[A-Za-z]_[A-Za-z0-9]|[=<>]/
/** 全站警告的固定標籤：保留純文字 */
const FIXED_PREFIX = /^C (?:≤|≈) 0/

/** runBlockLms 的警告中，Lab 會顯示在閉迴路區的那幾類（極性、沒有恢復力、Ĥ ≠ H、不穩定／發散／limit cycle） */
export const CLOSED_LOOP_WARNING = /^C ≤ 0|^C ≈ 0|filtered-x 模型|^g ≥|發散|limit cycle|不穩定/

/** runBlockLms 的「C ≤ 0」警告固定以這句建議結尾（共用核心的字串，別的頁面以樣式比對，所以模型端不改） */
const GENERIC_POLARITY_FIX = '，需 delay alignment 或 filtered-x）'

/**
 * 閉迴路的「C ≤ 0」警告結尾一律建議「需 delay alignment 或 filtered-x」。Case 本身已經是 delayed-x 或 filtered-x 時，
 * 這句話等於建議「改用現在這一種」——Lab 依 Case 的 regressor 換成對得上的建議（仍是純文字，之後照常經過 diagMath）：
 *   raw-x：原句不動；delayed-x：換一個 D，或改用 filtered-x；filtered-x：修 Ĥ 的相位或 regressor 的額外延遲 D（F-07.12）。
 * 其他警告、或結尾不是這句話的字串原樣回傳。
 */
export function closedLoopAdvice(warning: string, mode: 'raw' | 'delayed' | 'filtered' | undefined): string {
  if (!warning.startsWith('C ≤ 0') || !warning.endsWith(GENERIC_POLARITY_FIX) || mode === undefined || mode === 'raw') return warning
  const head = `${warning.slice(0, -GENERIC_POLARITY_FIX.length)}）。`
  return mode === 'delayed'
    ? `${head}這個 Case 已經是 delayed-x：要換一個 D，讓殘餘相位回到 ±90° 以內（F-07.4），或改用 filtered-x`
    : `${head}這個 Case 已經是 filtered-x：要修正的是模型 Ĥ 的相位，或 regressor 的額外延遲 D（F-07.12）`
}

const cache = new Map<string, string>()

/** 把模型診斷訊息裡用 Unicode 拼的數學改寫成 `$...$`；無法完整轉換時回傳原文。純函式（結果有快取）。 */
export function diagMath(text: string): string {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const out = convert(text)
  if (cache.size > 500) cache.clear()
  cache.set(text, out)
  return out
}

/** KaTeX 能解析（renderTex 在語法錯誤時回傳帶 katex-error／c-tex-error 的 HTML，不丟例外） */
function texOk(tex: string): boolean {
  const html = renderTex(tex, false)
  return !html.includes('katex-error') && !html.includes('c-tex-error')
}

function convert(text: string): string {
  if (text.includes('$')) return text // 已經是 mathText 格式
  const head = FIXED_PREFIX.exec(text)?.[0] ?? ''
  let plain = ''
  let out = head
  let i = head.length
  while (i < text.length) {
    const run = runAt(text, i)
    if (run) {
      if (!texOk(run.tex)) return text
      out += `$${run.tex}$`
      i = run.end
    } else {
      plain += text[i]
      out += text[i]
      i++
    }
  }
  return LEFTOVER.test(plain) ? text : out
}
