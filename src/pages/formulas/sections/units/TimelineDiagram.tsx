/**
 * 時間軸示意圖：sample 索引 n（f_s）→ block 索引 k（f_u = f_s/N）→ ZOH 之後的 w[n]（含 commit latency n_c）。
 * 純示意（N 畫成 8），不含數值資料；顏色用 CSS 變數，深淺主題都可讀。
 * 圖中文字用 SVG text（KaTeX 無法放進 SVG），符號與內文的 LaTeX 一一對應。
 */
const N = 8
const X0 = 70
const DX = 24
const BLOCKS = 3
const W_LEVELS = [112, 96, 104, 88] // w_{k-1}, w_k, w_{k+1}, w_{k+2} 的畫面 y 座標（示意）

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
  return (
    <figure className="fr-figure" aria-label="時間軸示意圖：sample 索引 n、block 索引 k 與零階保持後的係數">
      <svg viewBox="0 0 680 236" role="img" className="fr-timeline" preserveAspectRatio="xMinYMin meet">
        <title>sample 索引 n、block 索引 k 與 ZOH 後的係數 w[n]</title>
        {/* 第 1 列：sample */}
        <text x="8" y="34" className="fr-tl-label">
          n（f_s）
        </text>
        <line x1={X0} y1="30" x2={xEnd + 14} y2="30" className="fr-tl-axis" />
        {ticks.map((i) => (
          <line key={i} x1={X0 + i * DX} y1={i % N === 0 ? 20 : 25} x2={X0 + i * DX} y2={i % N === 0 ? 40 : 35} className={i % N === 0 ? 'fr-tl-tick-major' : 'fr-tl-tick'} />
        ))}
        {[0, 1, 2, 3].map((j) => (
          <text key={j} x={X0 + j * blockW} y="14" textAnchor="middle" className="fr-tl-small">
            {j === 0 ? '(k−1)N' : j === 1 ? 'kN' : j === 2 ? '(k+1)N' : '(k+2)N'}
          </text>
        ))}
        {/* 第 2 列：block */}
        <text x="8" y="72" className="fr-tl-label">
          k（f_u）
        </text>
        {[0, 1, 2].map((j) => (
          <g key={j}>
            <rect x={X0 + j * blockW + 2} y="54" width={blockW - 4} height="28" rx="5" className={j === 1 ? 'fr-tl-block fr-tl-block-on' : 'fr-tl-block'} />
            <text x={X0 + j * blockW + blockW / 2} y="73" textAnchor="middle" className="fr-tl-text">
              {j === 0 ? 'block k−1' : j === 1 ? 'block k：G_k = (1/N)Σ q·x' : 'block k+1'}
            </text>
          </g>
        ))}
        {/* 第 3 列：w[n]（ZOH + commit latency） */}
        <text x="8" y="104" className="fr-tl-label">
          w[n]
        </text>
        {steps.map((s, i) => (
          <g key={i}>
            <line x1={s.x1} y1={s.y} x2={s.x2} y2={s.y} className="fr-tl-w" />
            {i > 0 && <line x1={s.x1} y1={steps[i - 1].y} x2={s.x1} y2={s.y} className="fr-tl-w" />}
          </g>
        ))}
        <text x={X0 + 4} y={W_LEVELS[0] - 6} className="fr-tl-small">
          w_(k−1)
        </text>
        <text x={X0 + blockW + nc * DX + 4} y={W_LEVELS[1] - 6} className="fr-tl-small">
          w_k
        </text>
        <text x={X0 + 2 * blockW + nc * DX + 4} y={W_LEVELS[2] - 6} className="fr-tl-small">
          w_(k+1)
        </text>
        {/* block 邊界與 commit latency */}
        {[1, 2].map((j) => (
          <g key={j}>
            <line x1={X0 + j * blockW} y1="44" x2={X0 + j * blockW} y2="150" className="fr-tl-guide" />
            <line x1={X0 + j * blockW + nc * DX} y1="86" x2={X0 + j * blockW + nc * DX} y2="150" className="fr-tl-guide" />
            <line x1={X0 + j * blockW} y1="142" x2={X0 + j * blockW + nc * DX} y2="142" className="fr-tl-dim" />
            <text x={X0 + j * blockW + (nc * DX) / 2} y="158" textAnchor="middle" className="fr-tl-small">
              n_c
            </text>
          </g>
        ))}
        {/* 第 4 列：PVT */}
        <text x="8" y="196" className="fr-tl-label">
          m（PVT）
        </text>
        <line x1={X0} y1="192" x2={xEnd + 14} y2="192" className="fr-tl-axis" />
        <rect x={X0 + 2} y="180" width={BLOCKS * blockW - 4} height="24" rx="5" className="fr-tl-block" />
        <text x={X0 + (BLOCKS * blockW) / 2} y="196" textAnchor="middle" className="fr-tl-text">
          同一次 tracking 更新 m：涵蓋很多個 block（溫度、電壓慢慢漂）
        </text>
        <text x={X0} y="226" className="fr-tl-small">
          示意圖把 N 畫成 8；T13 的 N = 4096。block k 涵蓋 n = kN … kN+N−1；新係數在 block 結束後 n_c 個 sample 才生效。
        </text>
      </svg>
    </figure>
  )
}
