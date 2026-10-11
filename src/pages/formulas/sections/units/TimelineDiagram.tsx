import { mathText } from '@/components'

/**
 * 時間軸示意圖：sample 索引 n（f_s）→ block 索引 k（f_u = f_s/N）→ ZOH 之後的 w[n]（含 commit latency n_c）。
 * 純示意（N 畫成 8），不含數值資料；顏色用 CSS 變數，深淺主題都可讀。
 * 圖中的數學（符號、索引、公式）和內文一樣寫 `$...$`，用 KaTeX 排版：SVG 的 <text> 放不進 KaTeX，
 * 所以每個標籤是一個 <foreignObject>（裡面是 HTML 的 KaTeX），位置沿用 SVG 的座標，整張圖仍隨 viewBox 等比縮放。
 */
const N = 8
const X0 = 70
const DX = 24
const BLOCKS = 3
const W_LEVELS = [112, 96, 104, 88] // w_{k-1}, w_k, w_{k+1}, w_{k+2} 的畫面 y 座標（示意）

/** 圖上的一個文字標籤（可含 `$...$`）：(x, y) 是方框左上角，align 決定文字靠左或置中；wrap 允許折行（長說明） */
function Label({ x, y, w, h, cls, align = 'start', wrap = false, children }: { x: number; y: number; w: number; h: number; cls: string; align?: 'start' | 'center'; wrap?: boolean; children: string }) {
  return (
    <foreignObject x={x} y={y} width={w} height={h} className="fr-tl-fo">
      <div className={`fr-tl-math ${cls}${align === 'center' ? ' fr-tl-center' : ''}${wrap ? ' fr-tl-wrap' : ''}`}>
        <span>{mathText(children)}</span>
      </div>
    </foreignObject>
  )
}

/** block 邊界在 sample 軸上的位置標籤（第 j 個邊界 = (k−1+j)N） */
const TICKS = [String.raw`$(k-1)N$`, String.raw`$kN$`, String.raw`$(k+1)N$`, String.raw`$(k+2)N$`]

export function TimelineDiagram() {
  const blockW = N * DX
  const xEnd = X0 + BLOCKS * blockW
  const nc = 3 // commit latency（sample），示意
  const ticks = Array.from({ length: BLOCKS * N + 1 }, (_, i) => i)
  // w[n]：第 j 個 block 算出的 G_j 在 block 結束後 n_c 個 sample 才生效
  const steps: { x1: number; x2: number; y: number }[] = []
  for (let j = 0; j <= BLOCKS; j++) {
    const start = j === 0 ? X0 : X0 + j * blockW + nc * DX
    const end = j === BLOCKS ? xEnd : X0 + (j + 1) * blockW + nc * DX
    if (start < xEnd) steps.push({ x1: start, x2: Math.min(end, xEnd), y: W_LEVELS[j] })
  }
  const wLabels = [String.raw`$w_{k-1}$`, String.raw`$w_k$`, String.raw`$w_{k+1}$`]
  return (
    <figure className="fr-figure" aria-label="時間軸示意圖：sample 索引 n、block 索引 k 與零階保持後的係數">
      <svg viewBox="0 0 680 236" role="img" className="fr-timeline" preserveAspectRatio="xMinYMin meet">
        <title>sample 索引 n、block 索引 k 與 ZOH 後的係數 w[n]</title>
        {/* 第 1 列：sample */}
        <Label x={4} y={20} w={64} h={20} cls="fr-tl-label">
          {String.raw`$n$（$f_s$）`}
        </Label>
        <line x1={X0} y1="30" x2={xEnd + 14} y2="30" className="fr-tl-axis" />
        {ticks.map((i) => (
          <line key={i} x1={X0 + i * DX} y1={i % N === 0 ? 20 : 25} x2={X0 + i * DX} y2={i % N === 0 ? 40 : 35} className={i % N === 0 ? 'fr-tl-tick-major' : 'fr-tl-tick'} />
        ))}
        {TICKS.map((tick, j) => (
          <Label key={j} x={X0 + j * blockW - 45} y={3} w={90} h={17} cls="fr-tl-small" align="center">
            {tick}
          </Label>
        ))}
        {/* 第 2 列：block */}
        <Label x={4} y={58} w={64} h={20} cls="fr-tl-label">
          {String.raw`$k$（$f_u$）`}
        </Label>
        {[0, 1, 2].map((j) => (
          <g key={j}>
            <rect x={X0 + j * blockW + 2} y="54" width={blockW - 4} height="28" rx="5" className={j === 1 ? 'fr-tl-block fr-tl-block-on' : 'fr-tl-block'} />
            <Label x={X0 + j * blockW + 2} y={54} w={blockW - 4} h={28} cls="fr-tl-text" align="center">
              {j === 0 ? String.raw`block $k-1$` : j === 1 ? String.raw`block $k$：$G_k = \frac{1}{N}\sum q\cdot x$` : String.raw`block $k+1$`}
            </Label>
          </g>
        ))}
        {/* 第 3 列：w[n]（ZOH + commit latency） */}
        <Label x={4} y={90} w={64} h={20} cls="fr-tl-label">
          {String.raw`$w[n]$`}
        </Label>
        {steps.map((s, i) => (
          <g key={i}>
            <line x1={s.x1} y1={s.y} x2={s.x2} y2={s.y} className="fr-tl-w" />
            {i > 0 && <line x1={s.x1} y1={steps[i - 1].y} x2={s.x1} y2={s.y} className="fr-tl-w" />}
          </g>
        ))}
        <Label x={X0 + 4} y={W_LEVELS[0] - 20} w={60} h={18} cls="fr-tl-small">
          {wLabels[0]}
        </Label>
        <Label x={X0 + blockW + nc * DX + 4} y={W_LEVELS[1] - 20} w={60} h={18} cls="fr-tl-small">
          {wLabels[1]}
        </Label>
        <Label x={X0 + 2 * blockW + nc * DX + 4} y={W_LEVELS[2] - 20} w={60} h={18} cls="fr-tl-small">
          {wLabels[2]}
        </Label>
        {/* block 邊界與 commit latency */}
        {[1, 2].map((j) => (
          <g key={j}>
            <line x1={X0 + j * blockW} y1="44" x2={X0 + j * blockW} y2="150" className="fr-tl-guide" />
            <line x1={X0 + j * blockW + nc * DX} y1="86" x2={X0 + j * blockW + nc * DX} y2="150" className="fr-tl-guide" />
            <line x1={X0 + j * blockW} y1="142" x2={X0 + j * blockW + nc * DX} y2="142" className="fr-tl-dim" />
            <Label x={X0 + j * blockW + (nc * DX) / 2 - 20} y={146} w={40} h={16} cls="fr-tl-small" align="center">
              {String.raw`$n_c$`}
            </Label>
          </g>
        ))}
        {/* 第 4 列：PVT */}
        <Label x={4} y={182} w={64} h={20} cls="fr-tl-label">
          {String.raw`$m$（PVT）`}
        </Label>
        <line x1={X0} y1="192" x2={xEnd + 14} y2="192" className="fr-tl-axis" />
        <rect x={X0 + 2} y="180" width={BLOCKS * blockW - 4} height="24" rx="5" className="fr-tl-block" />
        <Label x={X0 + 2} y={180} w={BLOCKS * blockW - 4} h={24} cls="fr-tl-text" align="center">
          {String.raw`同一次 tracking 更新 $m$：涵蓋很多個 block（溫度、電壓慢慢漂）`}
        </Label>
        <Label x={X0} y={208} w={606} h={28} cls="fr-tl-small" wrap>
          {String.raw`示意圖把 $N$ 畫成 8；T13 的 $N=4096$。block $k$ 涵蓋 $n=kN,\ \ldots,\ kN+N-1$；新係數在 block 結束後 $n_c$ 個 sample 才生效。`}
        </Label>
      </svg>
    </figure>
  )
}
