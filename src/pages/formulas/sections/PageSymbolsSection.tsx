import { SymbolTable, Tex } from '@/components'
import { refValues } from '../refValues'
import { texNum } from '../format'
import { ErratumTag, Rich } from '../common'

/**
 * 頁尾：本頁自己新增的記號（SymbolTable）。teaching-style §5：符號表放在頁面最底端，外層 id="symbols"，頁首只留一行連結。
 * 全站符號總表（§1，GLOBAL_SYMBOLS）是本頁的主要內容，仍在 §1，不在這裡。
 * 搜尋中不顯示（由 index.tsx 控制）。
 */
export const PAGE_SYMBOLS_ID = 'symbols'

export function PageSymbolsSection() {
  const r = refValues()
  return (
    <div id={PAGE_SYMBOLS_ID} className="fr-page-symbols">
      <SymbolTable
        title="本頁符號（只在這一頁新增的記號；全站符號見 §1）"
        rows={[
          { symbol: '[y]', meaning: <Rich text="「$y$ 的單位」；因次分析時把單位當代數符號運算" />, firstSeen: '§2.3', note: <Rich text="例：$[\mu]=[w]/[G]$" /> },
          {
            symbol: 'f_r',
            meaning: '「這個序列自己的」取樣率',
            unit: String.raw`\mathrm{Hz}`,
            firstSeen: '§2.5',
            note: <Rich text="block 量（$w_k,G_k$）取 $f_u$；sample 量（$x[n],\delta t[n]$）取 $f_s$" />,
          },
          {
            symbol: String.raw`\Omega,\ \theta`,
            meaning: <Rich text="同一個頻率 $f$ 在 block 軸與 sample 軸上的角頻率" />,
            unit: String.raw`\mathrm{rad/block},\ \mathrm{rad/sample}`,
            firstSeen: '§2.1',
            note: <Rich text={String.raw`$\Omega=2\pi f/f_u=N\theta$；例 $f_{3\mathrm{dB}}$：$${texNum(r.loop.omega3dbBlock)}$ 與 $${texNum(r.loop.theta3dbSample)}$`} />,
          },
          {
            symbol: 'F(f)',
            meaning: <Rich text="$0\dots f$ 的雜訊功率佔總功率的比例（累積功率）" />,
            unit: '1',
            firstSeen: '§2.8',
            note: <Rich text={String.raw`$F(f_{3\mathrm{dB}})\approx\tfrac12$：corner 以下只有一半的雜訊`} />,
          },
          { symbol: 'k_x', meaning: <Rich text="code 的記帳倍率：$x'=k_xx$（例如 unit-RMS → LSB）" />, unit: '1', firstSeen: '§2.4', note: <Rich text={String.raw`$\mu\to\mu/k_x^2$ 才維持同一個 $g$`} /> },
          {
            symbol: 'n_c',
            meaning: 'commit／apply latency：新係數算出來到生效之間的延遲',
            unit: String.raw`\mathrm{samples}`,
            firstSeen: '§2.1',
            note: <Rich text="與 code delay $D$（samples）、更新延遲 $d$（blocks）是三個不同的量" />,
          },
          { symbol: String.raw`\varepsilon_p`, meaning: <Rich text="$1-p$（$=g$）：泰勒展開用的小量" />, unit: '1', firstSeen: '§2.6', note: <Rich text={String.raw`不是 §14 的 $\varepsilon$，也不是 $\varepsilon_{\mathrm{cc}}$`} /> },
          {
            symbol: String.raw`\hat\sigma_w,\ z`,
            meaning: <Rich text="Monte Carlo 估計的 $\sigma_w$ 與它對解析值的 z 分數" />,
            unit: String.raw`\mathrm{fs},\ 1`,
            firstSeen: '§2.8',
            note: <Rich text={String.raw`$z=(\hat\sigma_w^2-\sigma_w^2)/\mathrm{SE}$，以 AR(1) 有效樣本數修正`} />,
          },
        ]}
        caption={
          <>
            全站約定（<Tex>{String.raw`\delta=a-w`}</Tex>、<Tex>{'q=2b-1'}</Tex>、時間單位 fs、PSD 單邊）在 §1；本頁的例子預設 T13 條件：<Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex>、
            <Tex>{'N=4096'}</Tex>、<Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex>、<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'C=1'}</Tex>、average mode（<ErratumTag eid="E30" />）。
          </>
        }
      />
    </div>
  )
}
