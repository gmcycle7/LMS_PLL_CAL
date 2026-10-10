/**
 * 版本資訊（由 vite.config.ts 的 define 注入）。
 * 在沒有 define 的環境（例如其他工具直接載入 TS）退回 'dev' / 'unknown'。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const GIT_COMMIT: string = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'unknown'
