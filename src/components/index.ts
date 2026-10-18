/**
 * 共用 UI 元件庫（docs/dev-conventions.md §2–§3）。
 * 使用方式：import { Tex, TexBlock, Plot, ParamControl, ExperimentShell } from '@/components'
 */
import './components.css'

// 型別
export type {
  CheckEntry,
  CheckStatus,
  ClaimKind,
  CrossCheck,
  CsvCell,
  CsvColumns,
  ExperimentActions,
  ExperimentPreset,
  MetricRow,
  ModelLevelId,
  SourceKind,
} from './types'

// 數學與圖
export {
  Tex,
  TexBlock,
  MathText,
  mathText,
  stripMathDelimiters,
  accessibleText,
  texToSpeech,
  hasInlineMath,
  nodeToAccessibleText,
  nodeHasMath,
  renderTex,
  type TexBlockProps,
} from './Tex'
export { Mermaid, type MermaidProps } from './Mermaid'
export { Plot, loadPlotly, PLOT_NEAR_MARGIN, type PlotProps } from './Plot'
export {
  PlotRegistryProvider,
  createPlotRegistry,
  usePlotRegistry,
  type CapturedPlot,
  type PlotImageSource,
  type PlotRegistry,
} from './plotRegistry'
export { buildThemedLayout, buildExportLayout, filterLogData, tracesToColumns, mergeDeep, applyDashCycle, withAlpha, DASH_CYCLE, LEGEND_INSIDE_MAX } from './plotUtils'

// 參數控制
export {
  ParamControl,
  SelectControl,
  ToggleControl,
  type ParamControlProps,
  type SelectControlProps,
  type SelectOption,
  type ToggleControlProps,
} from './ParamControl'
export { parseNumberInput, roundSig, formatInput } from './paramMath'
export { CaseSelector } from './CaseSelector'

// 標籤與版面
export { ClaimTag, ModelLevel, SourceTag, TipBadge, type TipBadgeProps } from './Tags'
export { ScrollRegion, type ScrollRegionProps } from './ScrollRegion'
export {
  CLAIM_LABEL,
  CLAIM_DESCRIPTION,
  SOURCE_LABEL,
  SOURCE_DESCRIPTION,
  MODEL_LEVEL_INFO,
  CHECK_LABEL,
  modelLevelText,
  type ModelLevelInfo,
} from './labels'
export { Callout, type CalloutKind, type CalloutProps } from './Callout'
export { Section, SECTION_LABEL, type SectionKind, type SectionProps } from './Section'
export { Derivation, type DerivationProps, type SymbolRow } from './Derivation'
export { MetricTable, type MetricTableProps } from './MetricTable'
export { evaluateMetric, formatMetricValue, type MetricEvaluation } from './metrics'
export { TestBadge } from './TestBadge'
export { getTestStatus, TEST_STATUS_LABEL, type TestStatus, type TestStatusInfo } from './testStatus'
export {
  ExperimentShell,
  ControlGroup,
  progressText,
  type ControlGroupProps,
  type ExperimentShellProps,
  type ExperimentShellActions,
  type RunProgress,
  type RunKind,
} from './ExperimentShell'
export {
  buildExperimentPayload,
  buildExperimentReportInput,
  normalizeCrossCheck,
  type ExperimentExportInput,
  type ExperimentPayload,
} from './experimentExport'

// 學習模式（實作在 @/app/settings，這裡只是轉出方便使用）
export { ModeGate } from '@/app/settings'

// hooks
export {
  useDebouncedValue,
  usePersistentState,
  useCases,
  randomSeed,
  CASE_IDS,
  type CaseId,
  type ParamCase,
  type UseCasesResult,
} from './hooks'
export { useThemeTokens, useDocumentTheme, readThemeTokens, cssVar, type ThemeTokens, type DocumentTheme } from './theme'

// 匯出工具
export { downloadText, downloadBlob, toCsv, csvCell, csvPreview } from './download'
export { buildReportHtml, escapeHtml, isSafeImageDataUrl, type ReportInput, type ReportMetric, type ReportPlot } from './report'
export { fmtNum, fmtWithUnit, toJsonSafe, prettyJson, fileTimestamp, safeFileName } from './format'
export { APP_VERSION, GIT_COMMIT } from './buildInfo'

// 教學元件（docs/teaching-style.md）
export { CodeBlock, CodeCompare, type CodeBlockProps, type CodeCompareProps, type CodeCompareItem, type CodeLang } from './CodeBlock'
export { extractRegion, listRegions, diffLines, DIFF_MARKER } from './codeRegion'
export {
  SymbolTable,
  Quiz,
  Recap,
  Prereq,
  StepDerivation,
  type SymbolEntry,
  type QuizProps,
  type QuizOption,
  type Step,
} from './Teaching'

// 帶入手算
export { HandCalc, type HandCalcProps } from './HandCalc'
export { texNum, texNumP, checkAnswer, defaultValues, randomValues, inputError } from './handcalcMath'

// 系統地圖（每章開頭的「你在這裡」方塊圖）
export {
  SystemMap,
  systemMapModel,
  SYSTEM_BLOCK_LABEL,
  SYSTEM_MAP_BLOCKS,
  SYSTEM_MAP_WIRES,
  SYSTEM_MAP_SIZE,
  type SystemBlock,
  type SystemMapBlock,
  type SystemMapModel,
  type SystemMapProps,
  type SystemMapWire,
} from './SystemMap'
export { DiagramFrame, type DiagramFrameProps, type DiagramSize } from './DiagramFrame'

// 圖內數學（Plotly 的 pseudo-HTML 轉換；Mermaid 的 KaTeX 前處理）
export { plotMath, texToPlotly, applyPlotMath } from './plotMath'
export { sanitizeMermaidSource, mermaidMathDelimiters, hasUnsupportedMarkdown, withReadableMinWidth } from './mermaidSource'

// 連結：公式 ID 連結、頁內錨點連結、章節交叉參照（src/components/links）
export * from './links'

// 全站搜尋：頂列的搜尋鈕與延後載入的命令面板（src/components/search）
export { SearchButton, loadSearchPalette, type SearchPaletteProps } from './search'

// 本頁目錄（PageFrame 掛在每一頁；從 h2 自動產生）與浮動「回到頂端」
export { PageOutline, collectOutline, headingLabel, slugify, currentIndex, sectionProgress, OUTLINE_COLUMN_QUERY, OUTLINE_COLUMN_MIN_WIDTH, OUTLINE_MIN_ENTRIES, type OutlineLayout, type OutlineModel, type OutlineEntry, type PageOutlineProps } from './PageOutline'
