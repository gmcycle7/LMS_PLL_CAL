/**
 * 規格 §15.2 的最小 Block Sign-LMS 參考偽程式。
 * SPEC_PSEUDO 為規格原文（逐字）；SPEC_PSEUDO_ANNOTATED 是同一段加上「← 差異」註解，
 * 標出本站實作（src/simulation/models/blockLms.ts 的 core:blockLmsBlockLoop）與偽程式不同之處。
 * 這兩段是「規格文字」，不是網站執行的程式；網站執行的程式一律以 ?raw + region 顯示。
 */

export const SPEC_PSEUDO = `# All time quantities in fs. Code/regressor normalized.
# q is bipolar +/-1, not 0/1.
for k in range(num_updates):
    gm = 0.0
    for n in range(N):
        x = code_generator.next()
        u = pll_pd_error_path.filter(x)        # use physically modeled path
        e = (a_true - w) * u + noise_source.next()
        q = +1.0 if e >= 0 else -1.0
        x_ref = aligned_or_filtered_regressor(x, u)
        gm += q * x_ref
    G = gm / N
    w = saturate_or_update_high_precision(w + mu * G)
    record(k, w, G)
`

export const SPEC_PSEUDO_ANNOTATED = `# All time quantities in fs. Code/regressor normalized.
# q is bipolar +/-1, not 0/1.
for k in range(num_updates):
    w_app = phys(w[k - d])                      # ← 差異：新 gain 延遲 d 個 block 才生效，且經實體 code 量化（L5）
    gm = 0.0
    for n in range(N):
        x = code_generator.next()               # 本站：整段 record 先掃一次求 normalization（非因果，見 §3.2）
        dt = (a_true - w_app) * x + nl(x)       # ← 差異：先算 DTC 誤差（nl 含 offset、c2*x**2、c3*x**3）
        u = pll_pd_error_path.filter(dt)        # ← 差異：濾波的是 DTC 誤差，狀態跨 block 持續
        e = u + b + noise_source.next()         # ← 差異：另加 comparator offset b（comparator_offset_fs）
        q = +1.0 if e >= 0 else -1.0            # tie 規則相同（E07）；另有 0/1 未映射的反面測試模式
        x_ref = aligned_or_filtered_regressor(x, u)   # 本站：raw x、x[n-D] 或 filtered-x 的 (h_hat * x)[n-D]
        gm += q * x_ref
    G = gm / N                                  # ← 差異：gm_mode = sum 時不除 N（有效增益變成 N 倍）
    w = saturate_or_update_high_precision(w + mu * G)   # quantize_physical 時：整數暫存器 + rounding + saturate/wrap
    record(k, w, G)
`
