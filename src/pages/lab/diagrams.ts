/**
 * 本頁的 Mermaid 圖（文字標籤不渲染 KaTeX，所以用純文字符號；diagrams.test.ts 以真正的 mermaid parser 檢查語法）。
 * 九級的編號對應 unifiedLab.ts 的 StageId 與 Lab 裡的 stage 卡片。
 */
export const PIPELINE_CHART = `flowchart LR
  FCW["FCW = N_int + frac"] --> DSM["1 DSM<br/>first-order / MASH 1-1-1"]
  DSM -->|"residue r[n]"| NORM["2 code 正規化<br/>x = (r - o) s"]
  NORM -->|"x[n]"| DTC["3 DTC<br/>gain / offset / INL"]
  DTC -->|"e_DTC[n]"| HPD["4 PLL error path<br/>H_PD = 1/(1+L)"]
  DTC -->|"e_DTC[n]"| TOUT["9 輸出端<br/>T = L/(1+L)"]
  HPD -->|"u_pd[n]"| CMP["5 Comparator<br/>1-bit, sigma_v, offset b"]
  CMP -->|"q[n]"| GMAC["6 GMAC<br/>sum or average over N"]
  NORM -->|"x_ref: raw / delayed / filtered"| GMAC
  GMAC -->|"G_k"| UPD["8 更新<br/>w += mu G, delay d"]
  UPD --> REG["7 Gain register<br/>bits / rounding / overflow"]
  REG -->|"w_app"| DTC
  TOUT --> OUT["jitter / PSD / spur"]`
