import { cssVar } from './theme'

/**
 * 全站方塊圖（Mermaid）的視覺主題：把 Mermaid 預設的淡紫／淡黃配色換成與網站一致的樣式。
 *   - 節點：白底（深色主題為 surface）、細邊框、圓角、極淡的陰影
 *   - 群組（subgraph）：淡色底、虛線框、圓角、粗體小標題
 *   - 連線：稍粗、石板灰；連線標籤是有邊框的小膠囊
 * 顏色從 global.css 的 design token 讀取（主題切換時 Mermaid 元件會重新 render）。
 * 各圖自己用 classDef 標示重點的顏色（focus／warn／ok…）不受影響。
 */
export type DiagramTheme = 'light' | 'dark'

interface Palette {
  nodeFill: string
  nodeBorder: string
  text: string
  muted: string
  line: string
  clusterFill: string
  clusterBorder: string
  labelBg: string
  labelBorder: string
  shadow: string
  noteFill: string
}

function palette(theme: DiagramTheme): Palette {
  const dark = theme === 'dark'
  // 後面的值只在 CSS 還沒載入時使用（例如 jsdom 測試），與 global.css 相同
  return {
    nodeFill: cssVar('--diagram-node', dark ? '#1a222c' : '#ffffff'),
    nodeBorder: cssVar('--diagram-node-border', dark ? '#55667a' : '#93a4ba'),
    text: cssVar('--text', dark ? '#e6ebf1' : '#1b2430'),
    muted: cssVar('--text-muted', dark ? '#a3aebb' : '#5b6676'),
    line: cssVar('--diagram-line', dark ? '#8c9bb0' : '#5f6f84'),
    clusterFill: cssVar('--diagram-group', dark ? 'rgba(106,168,236,0.06)' : 'rgba(31,95,168,0.045)'),
    clusterBorder: cssVar('--diagram-group-border', dark ? '#3d4a59' : '#b4c2d4'),
    labelBg: cssVar('--surface', dark ? '#161d25' : '#ffffff'),
    labelBorder: cssVar('--border', dark ? '#2c3744' : '#d9dee6'),
    shadow: cssVar('--diagram-shadow', dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.13)'),
    noteFill: cssVar('--surface-2', dark ? '#1d2630' : '#f0f2f5'),
  }
}

/** 圖內文字的基準字級（px）。Mermaid 依此量測節點大小；窄螢幕的最小可讀寬度也以此為準。 */
export const DIAGRAM_FONT_PX = 15

/** 注入到每張 SVG 自己的 <style>（Mermaid 會自動加上該 SVG 的 id 作為範圍）。 */
function themeCss(p: Palette): string {
  return `
    .node rect, .node polygon, .node circle, .node ellipse, .node path, .node .label-container { stroke-width: 1.3px; }
    .node rect.label-container, .node rect.basic { rx: 9px; ry: 9px; }
    .node .label-container, .node > rect, .node > polygon, .node > circle { filter: drop-shadow(0 1px 1.5px ${p.shadow}); }
    .nodeLabel, .nodeLabel p { line-height: 1.4; }
    .katex-display { margin: 0.1em 0; }
    .edgeLabel .katex-display { margin: 0; }
    .cluster rect { rx: 14px; ry: 14px; stroke-width: 1.1px; stroke-dasharray: 6 4; }
    .cluster-label .nodeLabel, .cluster-label span, .cluster-label p { font-weight: 650; font-size: 0.86em; letter-spacing: 0.01em; color: ${p.muted}; fill: ${p.muted}; }
    .flowchart-link, .edgePath .path, .transition, .messageLine0, .messageLine1 { stroke-width: 1.5px; }
    .edgeLabel { font-size: 0.9em; }
    .edgeLabel .labelBkg, .edgeLabel p { background-color: transparent; }
    .edgeLabel span.edgeLabel:not(:empty) { display: inline-block; background-color: ${p.labelBg}; border: 1px solid ${p.labelBorder}; border-radius: 7px; padding: 0 6px; }
    .marker { fill: ${p.line}; stroke: ${p.line}; }
    .statediagram-state rect.basic, g.stateGroup rect { rx: 9px; ry: 9px; }
    .note rect, .noteGroup rect { rx: 6px; ry: 6px; }
  `
}

/** mermaid.initialize() 的設定（不含 startOnLoad 等與主題無關的項目由呼叫端補上）。 */
export function diagramConfig(theme: DiagramTheme, fontFamily: string) {
  const p = palette(theme)
  return {
    theme: 'base' as const,
    themeVariables: {
      darkMode: theme === 'dark',
      fontFamily,
      fontSize: `${DIAGRAM_FONT_PX}px`,
      background: 'transparent',
      primaryColor: p.nodeFill,
      primaryTextColor: p.text,
      primaryBorderColor: p.nodeBorder,
      secondaryColor: p.noteFill,
      secondaryTextColor: p.text,
      secondaryBorderColor: p.nodeBorder,
      tertiaryColor: p.clusterFill,
      tertiaryTextColor: p.text,
      tertiaryBorderColor: p.clusterBorder,
      mainBkg: p.nodeFill,
      nodeBorder: p.nodeBorder,
      nodeTextColor: p.text,
      textColor: p.text,
      lineColor: p.line,
      defaultLinkColor: p.line,
      clusterBkg: p.clusterFill,
      clusterBorder: p.clusterBorder,
      titleColor: p.muted,
      edgeLabelBackground: p.labelBg,
      // stateDiagram / sequenceDiagram
      labelColor: p.text,
      altBackground: p.noteFill,
      stateBkg: p.nodeFill,
      stateLabelColor: p.text,
      transitionColor: p.line,
      transitionLabelColor: p.text,
      compositeBackground: p.clusterFill,
      compositeBorder: p.clusterBorder,
      actorBkg: p.nodeFill,
      actorBorder: p.nodeBorder,
      actorTextColor: p.text,
      actorLineColor: p.clusterBorder,
      signalColor: p.line,
      signalTextColor: p.text,
      labelBoxBkgColor: p.noteFill,
      labelBoxBorderColor: p.nodeBorder,
      labelTextColor: p.text,
      loopTextColor: p.text,
      noteBkgColor: p.noteFill,
      noteBorderColor: p.clusterBorder,
      noteTextColor: p.text,
      activationBkgColor: p.noteFill,
      activationBorderColor: p.nodeBorder,
    },
    themeCSS: themeCss(p),
    flowchart: { htmlLabels: true, curve: 'basis' as const, nodeSpacing: 38, rankSpacing: 46, padding: 13, diagramPadding: 10, useMaxWidth: true },
    state: { useMaxWidth: true, padding: 10 },
    sequence: { useMaxWidth: true, actorMargin: 60, messageMargin: 34, boxMargin: 8 },
  }
}
