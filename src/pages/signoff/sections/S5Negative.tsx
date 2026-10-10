import { useMemo } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, MetricTable, Section, SourceTag, Tex, TestBadge, type MetricRow } from '@/components'
import { meanCI } from '@/simulation/core'
import judgesSrc from '../judges.ts?raw'
import { NEGATIVE_TESTS } from '../data'
import { kq, linearSigmaWMc, negativeSignatures } from '../judges'
import { ErratumTag, RichText, SiteLink, nf } from '../shared'

const PATH = 'src/pages/signoff/judges.ts'

/** §9：規格 §17 的反面測試（數學特徵即時計算）＋「公式錯但 UI 顯示成功」的交叉比對示範 */
export function S5Negative() {
  const sig = useMemo(() => negativeSignatures(), [])
  const mc = useMemo(() => {
    const K = kq(100)
    const pole = 1 - 10 * K
    const runs = linearSigmaWMc({ pole, mu: 10, sigmaEta: 1 / Math.sqrt(4096), blocks: 20000, burn: 2000, seeds: 8, seed: 20261010 })
    return meanCI(runs, 0.95)
  }, [])

  const crossRows: MetricRow[] = [
    {
      name: String.raw`$\sigma_w$：MC（8 seeds）vs 正確公式 $\mu\sigma_\eta/\sqrt{1-p^2}$`,
      value: mc.mean,
      unit: 'fs',
      analytic: sig.sigmaWRight,
      tolerance: mc.halfWidth,
      claim: 'approx',
      note: `95% CI 半寬 ${nf(mc.halfWidth, 3)} fs（Student-t）`,
    },
    {
      name: String.raw`$\sigma_w$：同一個 MC vs 錯誤公式 $\mu\sigma_\eta/\sqrt{1-p}$`,
      value: mc.mean,
      unit: 'fs',
      analytic: sig.sigmaWWrong,
      tolerance: mc.halfWidth,
      claim: 'approx',
      note: '交叉比對必須顯示 ✗——這就是反面測試要抓的情境',
    },
    { name: String.raw`PM（$g=1$）：正確 $90^\circ-\arcsin(g/2)$`, value: sig.pmRight, unit: '°', analytic: sig.pmNumeric, tolerance: 1e-9, claim: 'exact', note: String.raw`對照：數值 crossover 直接算 $L(e^{j\omega_c})$ 的相位（與封閉式獨立）` },
    { name: String.raw`PM（$g=1$）：漏掉 $/2$ 的 $90^\circ-\arcsin(g)$`, value: sig.pmWrong, unit: '°', analytic: sig.pmNumeric, tolerance: 1e-9, claim: 'exact', note: '同一個數值參考，錯誤公式被抓出來' },
  ]

  return (
    <Section kind="assumptions" level={2} title="9. 反面測試（規格 §17）：確認系統會「失敗得正確」" id="so-negative">
      <p>
        只測「正確設定會通過」抓不到最危險的錯誤：公式寫錯、極性接反、位元不夠，UI 卻照樣畫出一條漂亮的收斂曲線。規格 §17 要求另外做<strong>反面測試</strong>：
        故意注入錯誤，確認模擬、RTL 與 UI 都出現預期的數學特徵與解釋型警告。下面每一項的「數學特徵」都由本頁程式即時計算，並在 <code>src/pages/signoff/judges.test.ts</code> 與 golden vectors
        （<code>golden/vectors/negative_tests.json</code>、T04、T06、T07、T13）交叉比對。這些項目也已列入上方 Matrix 的第 9 個 case，可以逐項記錄「已執行」。
      </p>
      <div className="c-tag-row">
        <ClaimTag kind="exact" />
        <SourceTag kind="illustrative" />
      </div>
      <div className="so-limits">
        {NEGATIVE_TESTS.map((t, i) => (
          <div className="so-limit" key={t.id} data-negative={t.id}>
            <h3>
              <span className="so-limit-no">{i + 1}.</span>
              <RichText text={t.title} /> {t.tId && <TestBadge id={t.tId} />}
            </h3>
            <div className="small muted">{t.fromSpec ? '規格 §17 原列項目' : '本站補充（golden test_NEG_*）'}{t.errata?.map((e) => <ErratumTag key={e} id={e} />)}</div>
            <p>
              <strong>注入：</strong>
              <RichText text={t.inject} />
            </p>
            <p>
              <strong>應該看到：</strong>
              <RichText text={t.expect} />
            </p>
            <div className="table-wrap">
              <table className="so-neg-sig">
                <tbody>
                  {t.signature.map((s) => (
                    <tr key={s.key}>
                      <td>
                        <Tex>{s.label}</Tex>
                      </td>
                      <td className="num">
                        {nf(sig[s.key], s.digits ?? 6)}
                        {s.unit ? ` ${s.unit}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="so-links small">
              {t.links.map((l) => (
                <SiteLink key={l.to + l.label} link={l} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <h3>同一段 GMAC，三種 RTL 寫法（§16.1-3、§16.1-4）</h3>
      <p>
        反面測試「<Tex>{'N'}</Tex> 改變卻忘記 scaling」與「定點 overflow」的特徵值，就是用下面這三個函式算出來的（例如全部 <Tex>{'q\\,x=31'}</Tex> 的 4096 筆，17-bit wrap 後得到 {nf(sig.gmacWrapped17, 8)}）：
      </p>
      <CodeCompare
        items={[
          { label: 'average（正確）', source: judgesSrc, region: 'gmacAverage', path: PATH, note: String.raw`$G=\frac1N\sum q\,x$：$\mu$ 的單位與 $w$ 相同` },
          { label: 'sum（少了 $/N$）', source: judgesSrc, region: 'gmacSum', path: PATH, note: `有效 $g$ 乘 $N$（$N=4096\\Rightarrow\\times${nf(sig.sumModeGainMultiplier, 6)}$）` },
          { label: 'sum + 17-bit wrap', source: judgesSrc, region: 'gmacSumWrapped', path: PATH, note: `需要 ${sig.gmacBitsRequired} bit；不足時翻號` },
        ]}
      />

      <h3>「模型公式有錯，UI 卻顯示成功」：交叉比對要能抓到</h3>
      <p>
        防線是<strong>獨立</strong>的第二條計算路徑：用時域模擬（而不是同一條公式）估 <Tex>{'\\sigma_w'}</Tex>，再與解析值比對容許誤差。下表兩列用<strong>同一個</strong> Monte Carlo 結果，
        分別對照正確公式與分母寫成 <Tex>{'1-p'}</Tex> 的錯誤公式；PM 兩列對照數值求 crossover 的結果（T08）。
      </p>
      <MetricTable rows={crossRows} caption="差距欄是「數值減解析值」；✓／✗ 依容許誤差判定（MC 用 95% CI 半寬）。" />
      <CodeBlock source={judgesSrc} region="linearSigmaWMc" path={PATH} title="獨立的時域估計（本頁執行的程式碼）" />
    </Section>
  )
}
