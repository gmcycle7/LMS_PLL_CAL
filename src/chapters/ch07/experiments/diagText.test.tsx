import { renderTex } from '@/components'
import { presetsForExperiment } from '@/app/presets'
import { analyzeFxLab, buildHat, closedLoopConsistent, HAT_EXACT, runFxComparison } from '@/simulation/models/filteredX'
import { CLOSED_LOOP_WARNING, diagMath } from './diagText'
import { EXPERIMENT_ID, parseLabPreset, toCaseSpec, toCodeSpec, toFxScenario, toHatSpec, toPathSpec } from './labState'

// 多個測試行程同時執行時 CPU 可能嚴重超額：閉迴路模擬給足夠的時間
vi.setConfig({ testTimeout: 240_000 })

const r = String.raw

/** Unicode／ASCII 拼的數學（與 ch07.test.tsx 的 UNICODE_MATH 同一組字元，再加上落單的關係符號） */
const UNICODE_MATH = /[θΩωζφσμτρδηπ∠Ĥĥ√²³⁻¹₀₁₂≤≥≈≠±∇ΔΣ·×°]|\u0302|(?<![A-Za-z0-9])[A-Za-z]_[A-Za-z0-9]|[=<>]/
const FIXED_PREFIX = /^C (?:≤|≈) 0/
const MATH = /\$([^$]+)\$/g

/** 去掉固定標籤與 `$...$` 之後剩下的純文字 */
const plainPart = (s: string): string => s.replace(FIXED_PREFIX, '').replace(MATH, '')

function expectClean(original: string): string {
  const out = diagMath(original)
  // (1) `$` 成對，每個片段 KaTeX 都能解析
  expect((out.match(/\$/g) ?? []).length % 2, out).toBe(0)
  for (const m of out.matchAll(MATH)) {
    const html = renderTex(m[1], false)
    expect(html.includes('katex-error') || html.includes('c-tex-error'), `${m[1]} ← ${original}`).toBe(false)
  }
  // (2) 純文字部分不再有 Unicode 拼的數學（也就是沒有退回原文）
  expect(plainPart(out), `${original}\n→ ${out}`).not.toMatch(UNICODE_MATH)
  // (3) 中文敘述一字不漏：把數學片段拿掉之後，剩下的每個中日韓字元都還在、順序不變
  const cjk = (s: string) => s.replace(/[^一-鿿]/g, '')
  expect(cjk(plainPart(out))).toBe(cjk(original))
  return out
}

describe('diagMath：模型診斷訊息的 Unicode 數學 → $...$', () => {
  it('analyzeFxLab 的極性警告：保留「C ≤ 0／C ≈ 0」標籤，其餘數學改成 TeX', () => {
    expect(diagMath('C ≤ 0：更新極性錯誤（C = -0.5000），正 learning rate 會使平均誤差發散；只減小 μ 不會改變符號')).toBe(
      r`C ≤ 0：更新極性錯誤（$C=-0.5000$），正 learning rate 會使平均誤差發散；只減小 $\mu$ 不會改變符號`,
    )
    expect(diagMath('C ≤ 0：E[u·u_f] = -0.5000 < 0，Ĥ 與 H 在激勵頻帶的相位差超過 90°（E45）：filtered-x 一樣會反向更新')).toBe(
      r`C ≤ 0：$E[u\,u_f]=-0.5000<0$，$\hat H$ 與 $H$ 在激勵頻帶的相位差超過 $90^\circ$（E45）：filtered-x 一樣會反向更新`,
    )
    expect(diagMath('C ≈ 0（6.12e-17）：殘餘相位約 ±90°，GMAC 沒有平均恢復力，w 會隨雜訊漂移')).toBe(
      r`C ≈ 0（$6.12\times10^{-17}$）：殘餘相位約 $\pm90^\circ$，GMAC 沒有平均恢復力，$w$ 會隨雜訊漂移`,
    )
    expect(diagMath('Ĥ ≠ H：有效相關是 E[u·u_f] = -0.5000，不是 E[u²] = 1.000（E45）')).toBe(
      r`$\hat H\ne H$：有效相關是 $E[u\,u_f]=-0.5000$，不是 $E[u^2]=1.000$（E45）`,
    )
    expect(diagMath('raw-x 模式忽略 D = 4（請改用 delayed-x 或 filtered-x）')).toBe(r`raw-x 模式忽略 $D=4$（請改用 delayed-x 或 filtered-x）`)
  })

  it('runBlockLms 的閉迴路警告與 closedLoopConsistent 的比對說明', () => {
    expect(diagMath('C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（C = -0.5；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）')).toBe(
      r`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$C=-0.5$；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）`,
    )
    expect(diagMath('g ≥ 2：一階模型不穩定（g = μK = 2.5，pole = -1.5）')).toBe(r`$g\ge2$：一階模型不穩定（$g=\mu K=2.5$，$\text{pole}=-1.5$）`)
    expect(diagMath('filtered-x 模型 Ĥ 不穩定（pole 半徑 1.00234 ≥ 1）：模擬結果無物理意義')).toBe(
      r`filtered-x 模型 $\hat H$ 不穩定（pole 半徑 $1.00234\ge1$）：模擬結果無物理意義`,
    )
    expect(diagMath('τ = 129 blocks：block 數 300 不足 10τ，後半段尚未收斂，不做定量比對')).toBe(
      r`$\tau=129$ blocks：block 數 300 不足 $10\tau$，後半段尚未收斂，不做定量比對`,
    )
    expect(diagMath('預測發散（p = 1.0399 > 1）：|w_end − a| − |w_0 − a| = 196.2 fs，隨機漫步 σ_rw = μ√(Kσ_η²) = 3.87 fs，被推離真值')).toBe(
      r`預測發散（$p=1.0399>1$）：$|w_{\mathrm{end}}-a|-|w_0-a|=196.2$ fs，隨機漫步 $\sigma_{\mathrm{rw}}=\mu\sqrt{K\sigma_\eta^2}=3.87$ fs，被推離真值`,
    )
    expect(diagMath('預測收斂：後半段 mean w = 3.0012，固定點 3.0000，SE = 0.0123（150 個相關 block）；偏差 0.098 SE，離開初值 244 SE')).toBe(
      r`預測收斂：後半段 mean $w=3.0012$，固定點 3.0000，$\mathrm{SE}=0.0123$（150 個相關 block）；偏差 0.098 SE，離開初值 244 SE`,
    )
    expect(diagMath('g = 0.000123 ≈ 0：沒有平均恢復力（隨機漂移），不做定量比對')).toBe(r`$g=0.000123\approx0$：沒有平均恢復力（隨機漂移），不做定量比對`)
    expect(diagMath('預測發散（p = 1.01 > 1）：x，位移不到 3σ_rw，分不出發散與隨機漫步')).toContain(r`$3\sigma_{\mathrm{rw}}$`)
    expect(diagMath('w 在 block 12 發散（|w| > 1000000000000 fs 或非有限數），模擬停止')).toBe(r`$w$ 在 block 12 發散（$|w|>1000000000000$ fs 或非有限數），模擬停止`)
  })

  it('buildHat 的說明與警告（Ĥ 的結構、模型誤差）', () => {
    expect(diagMath('Ĥ 的模型迴路不穩定（ω̂_nT_s = 0.4000、d̂ = 5，pole 半徑 1.0234 ≥ 1）：u_f 會發散')).toBe(
      r`$\hat H$ 的模型迴路不穩定（$\hat\omega_nT_s=0.4000$、$\hat d=5$，pole 半徑 $1.0234\ge1$）：$u_f$ 會發散`,
    )
    expect(diagMath('相位誤差 Δφ 只對單頻（sinusoid）code 定義；寬頻 code 請改用 latency 誤差（Δ 或 Δd）')).toBe(
      r`相位誤差 $\Delta\phi$ 只對單頻（sinusoid）code 定義；寬頻 code 請改用 latency 誤差（$\Delta$ 或 $\Delta d$）`,
    )
    expect(diagMath('二次差分 Ĥ₂ 是 Type-II 主 PLL 的低頻近似；目前的誤差路徑不是 type2_dt，Ĥ₂ 與 H 沒有對應關係')).toBe(
      r`二次差分 $\hat H_2$ 是 Type-II 主 PLL 的低頻近似；目前的誤差路徑不是 type2_dt，$\hat H_2$ 與 $H$ 沒有對應關係`,
    )
    expect(
      diagMath('目前 Case 的 Ĥ 設定不穩定（type-II DPLL 模型（ω̂_nT_s = 0.4000、d̂ = 5）、× z^−4、增益 ×1.250）；此模式不使用 Ĥ，對照用的 E[u·u_f] 改以 Ĥ = H 計算'),
    ).toBe(
      r`目前 Case 的 $\hat H$ 設定不穩定（type-II DPLL 模型（$\hat\omega_nT_s=0.4000$、$\hat d=5$）、$\times z^{-4}$、增益 $\times1.250$）；此模式不使用 $\hat H$，對照用的 $E[u\,u_f]$ 改以 $\hat H=H$ 計算`,
    )
    // 真的由模型產生的訊息（不是測試裡手抄的字串）
    const unstable = buildHat({ kind: 'type2_dt', wnTs: 0.3, zeta: 0.7, loopDelay: 2 }, { ...HAT_EXACT, bwErrPct: 200, loopDelayErr: 4, phaseErrDeg: 30, gainErrPct: 25, extraDelay: 3 }, { kind: 'white_pm_one' })
    expect(unstable.stable).toBe(false)
    expect(unstable.warnings.length).toBeGreaterThanOrEqual(2)
    for (const w of [...unstable.warnings, unstable.description]) expectClean(w)
    const sd = buildHat({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 }, { ...HAT_EXACT, base: 'second_diff', phaseErrDeg: -30 }, { kind: 'sinusoid', omega: 0.5 })
    expect(expectClean(sd.description)).toContain(r`(1-z^{-1})^2/(\hat\omega_nT_s)^2`)
    expect(diagMath(sd.description)).toContain(r`-30^\circ`)
  })

  it('不是數學的東西原樣保留：識別字、單獨的數字、已經是 $...$ 的字串', () => {
    for (const s of [
      '閉迴路模擬執行中…',
      'DSM code（mash111／dsm1）不提供封閉式 PSD：只顯示同一段 code 的經驗值',
      'gain register 飽和 3 次（anti-windup / 調整範圍不足，§13.6）',
      'block 數 300、seed 20261010、E45、T07、type2_dt、raw-x、1-bit comparator',
      r`已經轉好的 $C=-0.5$ 不再處理`,
    ]) {
      expect(diagMath(s)).toBe(s)
    }
    // 同一個輸入回傳同一個結果（快取）
    expect(diagMath('只減小 μ 不會改變符號')).toBe(diagMath('只減小 μ 不會改變符號'))
  })

  it('全有或全無：有不認得的 Unicode 數學時整句退回原文（不顯示半套公式）', () => {
    for (const s of [
      'H_PD(z=1) = 0：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）',
      'g ≥ 2sin(π/(4d+2)) = 0.618：含 d = 1 個 block 更新延遲的一階模型不穩定（g = 0.7）',
      '相位 θ = ∠H − ∠Ĥ_ref + ΩD 超過 90°',
      'g = NaN ≈ 0：沒有平均恢復力',
    ]) {
      expect(diagMath(s), s).toBe(s)
    }
  })

  it('所有 delay-fx-lab preset 實際產生的訊息（分析警告、Ĥ 說明、閉迴路警告、交叉比對說明）都能完整轉換', () => {
    const seen = new Set<string>()
    let converted = 0
    const check = (msg: string) => {
      if (seen.has(msg)) return
      seen.add(msg)
      const out = expectClean(msg)
      if (out !== msg) converted++
    }
    const presets = presetsForExperiment(EXPERIMENT_ID)
    expect(presets.length).toBeGreaterThanOrEqual(6)
    for (const preset of presets) {
      const parsed = parseLabPreset(preset.params) as NonNullable<ReturnType<typeof parseLabPreset>>
      const s = parsed.scenario
      for (const c of parsed.cases) {
        const an = analyzeFxLab({ path: toPathSpec(s), code: toCodeSpec(s), mode: c.mode, D: c.D, hat: toHatSpec(c), seed: parsed.seed ?? 1, Dmax: Math.max(8, c.D) })
        an.warnings.forEach(check)
        check(an.hat.description)
      }
      // 閉迴路只跑 60 個 block（訊息的種類與 block 數無關；「block 數不足 10τ」的分支也因此會出現）
      const res = runFxComparison({
        scenario: toFxScenario({ ...s, blocks: 60 }, parsed.seed ?? 1),
        cases: parsed.cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })),
      })
      for (const cs of res.cases) {
        // 與 Lab 相同的篩選：只有這幾類閉迴路警告會顯示在頁面上
        cs.warnings.filter((w) => CLOSED_LOOP_WARNING.test(w)).forEach(check)
        check(closedLoopConsistent(cs, s.a, s.w0).note)
      }
    }
    // 真的有東西被轉換（不是每一句都剛好沒有數學）
    expect(seen.size).toBeGreaterThan(15)
    expect(converted).toBeGreaterThan(15)
  })
})
