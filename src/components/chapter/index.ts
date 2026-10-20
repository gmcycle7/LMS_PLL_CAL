/** 章節層級的共用元件（docs/dev/infra-api.md「章節共用元件」）；由 `@/components` 轉出。 */
export { ChapterErratum, ChapterErratumNote, type ChapterErratumProps, type ChapterErratumNoteProps } from './ChapterErratum'
export { ChapterHandCalc, HandLink, bindHandCalc, HAND_CALC_DEFAULT_LEAD, HAND_CALC_HOWTO_TAIL, type ChapterHandCalcProps, type HandLinkProps } from './ChapterHandCalc'
export { ChapterFig, FigRef, type ChapterFigProps, type FigRefProps } from './ChapterFig'
export { JumpTo, jumpToId, type JumpToProps } from './JumpTo'
export { texNumber, makeTexNum, type TexNumOptions } from './texNum'
export { sectionIdReport, isChapterSectionId, type SectionIdReport } from './sectionIds'
