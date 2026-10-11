import { useMemo } from 'react'
import { Mermaid } from './Mermaid'

/**
 * 全站共用的「系統地圖」：DTC-based Fractional-N PLL + Sign-LMS 校正迴路的完整方塊圖（規格 §4 的概念架構）。
 * 每章開頭放同一張圖，並把本章在講的方塊標成藍色，讓讀者知道「現在在系統的哪裡」。
 * 圖是教學用的概念架構，不是特定晶片的 netlist。
 */
export type SystemBlock =
  | 'ref' // Reference clock
  | 'pd' // Phase detector / SSPD / BBPD
  | 'lf' // PLL loop filter
  | 'vco' // VCO / DCO
  | 'div' // Divider / PMUX
  | 'fcw' // Frequency control word
  | 'dsm' // Delta-sigma modulator / accumulator
  | 'res' // Fractional residue x[n]（regressor）
  | 'gc' // Gain correction：code × w
  | 'dtc' // Digital-to-time converter
  | 'cmp' // 1-bit comparator q[n] = sign(e[n])
  | 'align' // Code alignment / delay / filtered-x
  | 'gmac' // GMAC：Σ q·x
  | 'scale' // ÷N、× μ
  | 'acc' // Gain accumulator w_k
  | 'qnt' // 有限位元量化（例如 6-bit）
  | 'noise' // comparator 前雜訊 v[n]

export const SYSTEM_BLOCK_LABEL: Record<SystemBlock, string> = {
  ref: 'Reference clock',
  pd: 'Phase detector（PD / SSPD / BBPD）',
  lf: 'PLL loop filter',
  vco: 'VCO / DCO',
  div: 'Divider / PMUX',
  fcw: 'FCW',
  dsm: 'DSM / accumulator',
  res: 'Fractional residue $x[n]$',
  gc: 'Gain correction（$\\times w$）',
  dtc: 'DTC',
  cmp: '1-bit comparator',
  align: 'Code alignment / delay / filtered-x',
  gmac: 'GMAC（$\\sum q\\,x$）',
  scale: 'Normalize + learning rate',
  acc: 'Gain accumulator $w_k$',
  qnt: 'Quantizer（有限位元）',
  noise: 'Comparator 前雜訊 $v[n]$',
}

const NODE_ID: Record<SystemBlock, string> = {
  ref: 'REF',
  pd: 'PD',
  lf: 'LF',
  vco: 'VCO',
  div: 'DIV',
  fcw: 'FCW',
  dsm: 'DSM',
  res: 'RES',
  gc: 'GC',
  dtc: 'DTC',
  cmp: 'CMP',
  align: 'ALIGN',
  gmac: 'GMAC',
  scale: 'SCALE',
  acc: 'ACC',
  qnt: 'QNT',
  noise: 'NOISE',
}

/** 產生系統地圖的 Mermaid 原始碼（純函式，方便測試）。 */
export function systemMapChart(focus: readonly SystemBlock[]): string {
  const lines = [
    'flowchart TB',
    '  subgraph MAIN["主 PLL 迴路（快）"]',
    '    direction LR',
    '    REF["Reference clock"] --> PD["Phase detector<br/>PD / SSPD / BBPD"]',
    '    PD --> LF["Loop filter"]',
    '    LF --> VCO["VCO / DCO"]',
    '    VCO --> DIV["Divider / PMUX"]',
    '    DIV --> DTC["DTC<br/>code → delay"]',
    '    DTC --> PD',
    '  end',
    '  subgraph FRAC["小數除頻與補償"]',
    '    direction LR',
    '    FCW["FCW"] --> DSM["DSM / accumulator"]',
    String.raw`    DSM --> RES["Fractional residue<br/>$x[n]$（regressor）"]`,
    String.raw`    RES --> GC["Gain correction<br/>code $\times\, w$"]`,
    '  end',
    '  subgraph CAL["LMS 校正迴路（慢）"]',
    '    direction LR',
    String.raw`    NOISE(["雜訊 $v[n]$"]) --> CMP["1-bit comparator<br/>$q[n] = \mathrm{sign}(e[n])$"]`,
    String.raw`    CMP --> GMAC["GMAC<br/>$\sum q[n]\, x[n]$"]`,
    '    ALIGN["Code alignment<br/>delay / filtered-x"] --> GMAC',
    String.raw`    GMAC --> SCALE["$\div N$、$\times\,\mu$"]`,
    String.raw`    SCALE --> ACC["Gain accumulator<br/>$w_k$"]`,
    '    ACC --> QNT["Quantizer<br/>有限位元"]',
    '  end',
    '  DSM --> DIV',
    '  GC --> DTC',
    String.raw`  PD -. "phase error $e[n]$" .-> CMP`,
    '  RES --> ALIGN',
    String.raw`  QNT -- "$w$" --> GC`,
    '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px',
  ]
  const ids = [...new Set(focus)].map((b) => NODE_ID[b])
  if (ids.length) lines.push(`  class ${ids.join(',')} focus`)
  return lines.join('\n')
}

export interface SystemMapProps {
  /** 本章在講的方塊（會標成藍色） */
  focus: SystemBlock[]
  /** 圖說；預設列出被標示的方塊名稱 */
  caption?: string
}

/** 每章開頭的「你在這裡」系統方塊圖。 */
export function SystemMap({ focus, caption }: SystemMapProps) {
  const chart = useMemo(() => systemMapChart(focus), [focus])
  const names = [...new Set(focus)].map((b) => SYSTEM_BLOCK_LABEL[b]).join('、')
  return (
    <Mermaid
      chart={chart}
      caption={caption ?? `系統地圖：藍色是本章的主角（${names || '整個系統'}）。教學用概念架構，不是特定晶片的 netlist。`}
      ariaLabel={`DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖；本章重點：${names || '整個系統'}`}
    />
  )
}
