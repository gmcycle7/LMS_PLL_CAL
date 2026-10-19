/**
 * 實驗的分享網址：把「哪個實驗、哪個 preset、哪個 seed」寫進 HashRouter 的 search，重新整理或把連結傳給別人都會回到同一個設定。
 *
 *   #/ch/01?a=exp-lms-playground&p=<presetId>&seed=1234
 *
 *   - a    實驗外框的 DOM id（`exp-<experimentId>`，ExperimentShell 的 <section id>）。這個參數同時是全站「頁內錨點」的參數，
 *          所以打開連結時 AnchorDeepLink 會把頁面捲到這個實驗，不需要另外寫捲動程式。讀的時候 `a=<experimentId>`（沒有 exp- 前綴）也接受。
 *   - p    preset 的 id（`presetKey(preset)`：preset.id，沒有就用名稱的 slug）。
 *   - seed 0–4294967295 的整數。只在使用者「改過」seed（或網址原本就有）時才寫，所以沒碰 seed 的人複製出來的連結不會把隨機種子寫死。
 *
 * 寫入一律用 history.replaceState（不新增歷史紀錄、不觸發路由）。react-router 的 useLocation() 不會看到這次寫入（同 links/anchor.ts 的 ?a=），
 * 所以不會讓頁面重新渲染或再捲一次；重新整理時才由 useExperimentUrl 在掛載時讀回來。
 *
 * 相容 ch01 既有的做法：舊連結 `?preset=<id>`（Gallery、搜尋結果；`useUrlPreset` 讀它）在 `p` 不存在時當作 `p` 讀；
 * 一旦寫入新參數就把 `preset=` 拿掉，免得重新整理時兩個來源互相打架。
 *
 * 整合到 ExperimentShell 的方式見 docs/dev/infra-api.md「分享與回連」。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 實驗外框的 DOM id 前綴（ExperimentShell：`<section id="exp-<id>">`） */
export const EXPERIMENT_ANCHOR_PREFIX = 'exp-'
export const SEED_MAX = 4294967295

export function experimentAnchorId(experimentId: string): string {
  return `${EXPERIMENT_ANCHOR_PREFIX}${experimentId}`
}

/** 網址上的實驗狀態 */
export interface ExperimentUrlState {
  presetId?: string
  seed?: number
}

/** 只需要名稱與可選 id 的 preset（ExperimentPreset 的子集） */
export interface PresetLike {
  name: string
  id?: string
}

/** preset 在網址裡的 key：id 優先；沒有 id 就用名稱的 slug（小寫、空白變連字號） */
export function presetKey(p: PresetLike): string {
  if (p.id) return p.id
  return p.name.trim().toLowerCase().replace(/\s+/g, '-')
}

/** 在 presets 裡找 key 對得上的那一個 */
export function findPresetByKey<T extends PresetLike>(presets: readonly T[] | undefined, key: string): T | undefined {
  return presets?.find((p) => presetKey(p) === key)
}

function parseRoute(route: string): { path: string; params: URLSearchParams } {
  const raw = route.startsWith('#') ? route.slice(1) : route
  const q = raw.indexOf('?')
  return { path: (q < 0 ? raw : raw.slice(0, q)) || '/', params: new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)) }
}

function validSeed(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return Number.isSafeInteger(n) && n <= SEED_MAX ? n : undefined
}

function pointsAt(a: string | null, experimentId: string): boolean {
  return a === experimentAnchorId(experimentId) || a === experimentId
}

/**
 * 從路由（'#/ch/01?a=…'，有沒有 # 都可以）讀出這個實驗的狀態；網址沒有提到這個實驗就是 null。
 * `p`／`seed` 只在 `a` 指著這個實驗時才算（同一頁有好幾個實驗，分享連結只屬於其中一個）；
 * 舊式 `?preset=<id>` 不看 `a`：呼叫端要自己用 findPresetByKey 確認它真的屬於這個實驗。
 */
export function parseExperimentUrl(route: string, experimentId: string): ExperimentUrlState | null {
  const { params } = parseRoute(route)
  const mine = pointsAt(params.get('a'), experimentId)
  const state: ExperimentUrlState = {}
  const p = mine ? params.get('p') : null
  const legacy = params.get('preset')
  if (p) state.presetId = p
  else if (legacy) state.presetId = legacy
  if (mine) {
    const s = validSeed(params.get('seed'))
    if (s !== undefined) state.seed = s
  }
  return state.presetId !== undefined || state.seed !== undefined ? state : null
}

/**
 * 在 route 上寫入這個實驗的狀態，其他參數（例如別的實驗留下的）一律換掉；回傳 '#/path?…'。
 * 規則：a 設成這個實驗；f（公式）拿掉（a 與 f 互斥）；舊式 preset 拿掉；p／seed 有值才寫、沒有值就刪。
 */
export function experimentRoute(route: string, experimentId: string, state: ExperimentUrlState): string {
  const { path, params } = parseRoute(route)
  params.set('a', experimentAnchorId(experimentId))
  params.delete('f')
  params.delete('preset')
  if (state.presetId) params.set('p', state.presetId)
  else params.delete('p')
  if (state.seed !== undefined && validSeed(String(state.seed)) !== undefined) params.set('seed', String(state.seed))
  else params.delete('seed')
  return `#${path}?${params.toString()}`
}

/** 目前路由（window.location.hash）；沒有 window 時是空字串 */
function currentRoute(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/** 讀目前網址上這個實驗的狀態 */
export function readExperimentUrl(experimentId: string): ExperimentUrlState | null {
  return parseExperimentUrl(currentRoute(), experimentId)
}

/** 把狀態寫進目前網址（replaceState）。回傳是否真的改了。 */
export function writeExperimentUrl(experimentId: string, state: ExperimentUrlState): boolean {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return false
  try {
    const next = experimentRoute(currentRoute(), experimentId, state)
    if (next === window.location.hash) return false
    // 保留 history.state：react-router 把目前這一筆的索引存在裡面
    window.history.replaceState(window.history.state, '', next)
    return true
  } catch {
    return false
  }
}

/**
 * 完整的分享網址（絕對網址）：目前頁面（origin + pathname + 外層 search）加上 hash 路由 + ?a=／p=／seed=。
 * 不讀 window 上已經寫好的 a／p／seed，而是用參數重算——所以就算還沒接上 useExperimentUrl 也給得出正確的連結。
 */
export function experimentShareUrl(experimentId: string, state: ExperimentUrlState = {}, loc: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'> | null = typeof window === 'undefined' ? null : window.location): string {
  const route = experimentRoute(loc?.hash ?? '', experimentId, state)
  return `${loc?.origin ?? ''}${loc?.pathname ?? ''}${loc?.search ?? ''}${route}`
}

/**
 * 掛上實驗外框的 hook：目前的 presetId／seed 改變時寫進網址；掛載時回傳網址原本帶的狀態。
 *
 * - 第一次 render 的值當作基準：沒有人改過就不寫（只是打開頁面不會動網址）。
 * - seed 只在變得和基準不同（或網址原本就帶 seed）之後才寫。
 * - 掛載時讀到的 `initial` 在整個元件生命期內不變；呼叫端在掛載時套用它（見 useExperimentUrlSync），套用造成的 state 變動會寫回同樣的值。
 */
export function useExperimentUrl(experimentId: string, state: ExperimentUrlState): { initial: ExperimentUrlState | null } {
  const [initial] = useState<ExperimentUrlState | null>(() => readExperimentUrl(experimentId))
  const baseSeed = useRef(state.seed)
  const seedTouched = useRef(initial?.seed !== undefined)
  const last = useRef<ExperimentUrlState>({ presetId: state.presetId, seed: state.seed })
  const { presetId, seed } = state
  useEffect(() => {
    if (seed !== baseSeed.current) seedTouched.current = true
    if (presetId === last.current.presetId && seed === last.current.seed) return
    last.current = { presetId, seed }
    writeExperimentUrl(experimentId, { presetId, seed: seedTouched.current ? seed : undefined })
  }, [experimentId, presetId, seed])
  return { initial }
}

export interface ExperimentUrlSyncOptions<P extends PresetLike> {
  experimentId: string
  seed?: number
  onSeedChange?: (s: number) => void
  presets?: readonly P[]
  onLoadPreset?: (p: P) => void
}

/**
 * ExperimentShell 要呼叫的一個 hook：
 *   - 掛載時：網址有 p → 在 presets 裡找到就呼叫 onLoadPreset；網址有 seed → 呼叫 onSeedChange（一定在 preset 之後，所以明確的 seed 勝過 preset 自帶的 seed）。
 *   - 回傳 loadPreset(p)：取代工具列 <select> 直接呼叫的 onLoadPreset——先記下 presetId（寫進網址），再呼叫 onLoadPreset。
 *   - 回傳 presetId、seed：給 CopyLinkButton。
 */
export function useExperimentUrlSync<P extends PresetLike>(opts: ExperimentUrlSyncOptions<P>): { presetId: string | undefined; seed: number | undefined; loadPreset: (p: P) => void } {
  const { experimentId, seed, onSeedChange, presets, onLoadPreset } = opts
  const [presetId, setPresetId] = useState<string | undefined>(undefined)
  const { initial } = useExperimentUrl(experimentId, { presetId, seed })
  // 掛載時套用網址上的值。callbacks 放進 ref：這個 effect 只跑「掛載」這一次（StrictMode 的第二次也是同樣的值，套用兩次是冪等的）
  const live = useRef({ presets, onLoadPreset, onSeedChange })
  live.current = { presets, onLoadPreset, onSeedChange }
  useEffect(() => {
    if (!initial) return
    const cur = live.current
    if (initial.presetId) {
      const p = findPresetByKey(cur.presets, initial.presetId)
      if (p && cur.onLoadPreset) {
        cur.onLoadPreset(p)
        setPresetId(initial.presetId)
      }
    }
    if (initial.seed !== undefined) cur.onSeedChange?.(initial.seed)
  }, [initial])
  const loadPreset = useCallback(
    (p: P) => {
      setPresetId(presetKey(p))
      live.current.onLoadPreset?.(p)
    },
    [],
  )
  return { presetId, seed, loadPreset }
}
