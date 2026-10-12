import { CLAIM_LABEL } from '@/components'
import { pageById } from '@/app/registry'
import { buildHaystack, filterByTokens, richToPlain } from './search'
import { refValues } from './refValues'
import { GLOBAL_SYMBOLS, SYMBOL_COLLISIONS, SYMBOL_GROUP_LABEL, type GlobalSymbol, type SymbolCollision } from './symbols'
import { QUICK_GROUP_LABEL, QUICK_REF, type QuickRefRow } from './appendixA'
import { LIMITATIONS, type Limitation } from './appendixB'
import { GLOSSARY, GLOSSARY_CATEGORY_LABEL, type GlossaryTerm } from './glossary'
import { ALL_FORMULAS, type RegistryRow } from './registry'

/**
 * 「單位與時間索引約定」段落的子題（每個子題可被搜尋；內容在 sections/UnitsSection.tsx）。
 * keywords 收錄該子題裡出現的重要符號與術語（中、英、TeX 都可）。
 */
export interface UnitTopic {
  id: string
  /** 純文字標題（搜尋用；Unicode 寫法也能被找到） */
  title: string
  /** 顯示用標題（'$TeX$' 夾雜的說明文字；頁面上的目錄按鈕以 KaTeX 顯示） */
  label: string
  keywords: string
  errata: string[]
}

export const UNIT_TOPICS: UnitTopic[] = [
  {
    id: 'index',
    title: '時間索引 n / k / m 與取樣率',
    label: '時間索引 $n$ / $k$ / $m$ 與取樣率',
    keywords: String.raw`n k m sample block PVT tracking f_s f_u=f_s/N f_ref n_0 ZOH zero-order hold 零階保持 commit latency n_c \lfloor floor 地板函數 時間軸 取樣率 更新率 窗口 code delay D 更新延遲 d rad/sample rad/block 索引 timeline`,
    errata: ['E35', 'E44', 'E34'],
  },
  {
    id: 'timePhase',
    title: '時間 fs ↔ 相位 rad ↔ UI',
    label: '時間（fs）、相位（rad）與 UI',
    keywords: String.raw`fs rad UI unit interval \phi=2\pi f \Delta t f_{out} f_{ref} 相位 時間 phase time jitter dBc 20log10 10log10 單位換算 除頻比 spur \beta Bessel 小角近似 sideband 積化和差 fsToRad`,
    errata: [],
  },
  {
    id: 'muUnits',
    title: 'μ、K_q、C、K、g 的單位與 sum / average',
    label: String.raw`$\mu$、$K_q$、$C$、$K$、$g$ 的單位與 sum / average`,
    keywords: String.raw`\mu K_q C K=K_qC g=\mu K p=1-g sum average N gm_mode 學習率 learning rate step size 單位 fs^{-1} 無因次 dimensionless 因次分析 dimensional analysis 正規化 K_q\equiv1 normalized loop gain accumulator 右移 limit cycle Conventional Sign-Error Sign-Sign calLoop`,
    errata: ['E13', 'E18', 'E05'],
  },
  {
    id: 'codeUnits',
    title: 'Code 正規化、LSB 與 0/1 → ±1',
    label: String.raw`Code 正規化、LSB 與 $0/1\to\pm1$`,
    keywords: String.raw`code LSB \Delta_{LSB} UI unit RMS normalized k_x 尺度 scale q=2b-1 0/1 bipolar unipolar 位元 bit 映射 正規化 gain_lsb_fs gain register E[x] DC 固定點偏移 41.27 meanGmacEncoding`,
    errata: ['E13', 'E07'],
  },
  {
    id: 'psd',
    title: 'PSD 正規化：DTFT 形式、單邊 per-Hz 與 ℒ(f)',
    label: String.raw`PSD 正規化：DTFT 形式、單邊 per-Hz 與 $\mathcal L(f)$`,
    keywords: String.raw`PSD S(e^{j\Omega}) S^{(1)}(f) one-sided two-sided per-Hz per-rad cycle/sample cycle/block Parseval \mathcal L(f) dBc/Hz 單邊 雙邊 2/f_r 功率頻譜密度 power spectral density phase noise 相位雜訊 window Welch 變數代換 白雜訊 white`,
    errata: ['E28'],
  },
  {
    id: 'bw',
    title: '頻寬的四個數：exact −3 dB、−ln p、(1 − p)、ENBW',
    label: String.raw`頻寬的四個數：exact −3 dB、$-\ln p$、$(1-p)$、ENBW`,
    keywords: String.raw`f_{3dB} -3dB corner ENBW noise bandwidth equivalent noise bandwidth -\ln p 1-p 3-2\sqrt2 high-pass low-pass flat 頻寬 等效雜訊頻寬 T14 12.93 kHz 12.4 kHz 20.29 kHz \arcsin 泰勒 Taylor 等比級數 impulse response \pi/2 regime 不存在`,
    errata: ['E06', 'E10', 'E26', 'E27'],
  },
  {
    id: 'multirate',
    title: 'Multirate：block-rate 與 sample-rate 頻譜',
    label: 'Multirate：block-rate 與 sample-rate 頻譜',
    keywords: String.raw`multirate ZOH zero-order hold S_w^{(f_s)} S_w^{(f_u)} sinc droop boxcar upsample 上取樣 補零 \theta rad/sample rad/block cyclostationary 週期平穩 多速率 \delta t=x\delta w images 零點 cross-spectrum 號誌`,
    errata: ['E09', 'E29', 'E33'],
  },
  {
    id: 'calculator',
    title: '互動：單位與頻寬換算器（T13 / T14）',
    label: '互動：單位與頻寬換算器（T13 / T14）',
    keywords: String.raw`calculator 換算器 互動 experiment preset T13 T14 T15 \sigma_w ENBW f_{3dB} Monte Carlo sum average spur \beta 累積功率 F(f) units-calculator linear 1-bit Binomial seed z 分數 ESS 單位鏈`,
    errata: ['E06', 'E13', 'E18', 'E30'],
  },
]

export interface IndexEntry<T> {
  item: T
  haystack: string
}

export interface SearchIndex {
  symbols: IndexEntry<GlobalSymbol>[]
  collisions: IndexEntry<SymbolCollision>[]
  quick: IndexEntry<QuickRefRow>[]
  limits: IndexEntry<Limitation>[]
  glossary: IndexEntry<GlossaryTerm>[]
  units: IndexEntry<UnitTopic>[]
  formulas: IndexEntry<RegistryRow>[]
}

const navOf = (id: string) => pageById(id)?.nav ?? id

let cache: SearchIndex | null = null

/** 所有段落的 haystack（第一次呼叫時建立；example 的數字也可被搜尋） */
export function searchIndex(): SearchIndex {
  if (cache) return cache
  const r = refValues()
  cache = {
    symbols: GLOBAL_SYMBOLS.map((s) => ({
      item: s,
      haystack: buildHaystack([
        s.symbol,
        richToPlain(s.meaning),
        s.unit,
        richToPlain(s.convention),
        s.specOriginal && richToPlain(s.specOriginal),
        s.example && richToPlain(s.example(r)),
        SYMBOL_GROUP_LABEL[s.group],
        ...s.errata,
        ...s.errata.map((e) => `勘誤 ${e}`),
        ...s.pages.map(navOf),
      ]),
    })),
    collisions: SYMBOL_COLLISIONS.map((c) => ({
      item: c,
      haystack: buildHaystack([c.symbol, ...c.meanings.flatMap((m) => [m.tex, m.where, m.note]), ...c.errata]),
    })),
    quick: QUICK_REF.map((q) => ({
      item: q,
      haystack: buildHaystack([
        q.topic,
        q.tex,
        richToPlain(q.conditions),
        q.spec && richToPlain(q.spec),
        q.example && richToPlain(q.example(r)),
        QUICK_GROUP_LABEL[q.group],
        CLAIM_LABEL[q.claim],
        q.fromSpec ? '規格附錄 A' : '本站補充',
        ...q.errata,
        ...q.related,
      ]),
    })),
    limits: LIMITATIONS.map((l) => ({
      item: l,
      haystack: buildHaystack([
        l.title,
        richToPlain(l.text),
        richToPlain(l.why),
        l.example && richToPlain(l.example(r)),
        l.specNo !== null ? `附錄 B 第 ${l.specNo} 點` : '本站補充',
        ...l.errata,
        ...l.pages.map(navOf),
      ]),
    })),
    glossary: GLOSSARY.map((g) => ({
      item: g,
      haystack: buildHaystack([
        g.zh,
        g.en,
        g.abbr,
        richToPlain(g.def),
        GLOSSARY_CATEGORY_LABEL[g.category],
        ...(g.formulas ?? []),
        ...(g.errata ?? []),
        ...g.pages.map(navOf),
      ]),
    })),
    units: UNIT_TOPICS.map((u) => ({ item: u, haystack: buildHaystack([u.title, u.keywords, ...u.errata]) })),
    formulas: ALL_FORMULAS.map((f) => ({ item: f, haystack: f.haystack })),
  }
  return cache
}

export function filterEntries<T>(entries: readonly IndexEntry<T>[], tokens: readonly string[]): T[] {
  return filterByTokens(entries, (e) => e.haystack, tokens).map((e) => e.item)
}
