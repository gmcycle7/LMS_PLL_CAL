import { classifyPole, POLE_BEHAVIOUR_LABEL } from '@/simulation/models/lms'

/**
 * lms.ts 的 pole 行為標籤（純文字，圖例用）→ 帶 `$…$` 的版本，給 mathText／tx 以 KaTeX 顯示。
 * 分類（classifyPole）與文字仍以 lms.ts 為唯一來源；這裡只把「：」前的條件式與 μ = 0 改成 LaTeX。
 * 例：'−1 < p < 0：正負交替、震盪收斂' → '$-1 < p < 0$：正負交替、震盪收斂'
 */
export function poleLabelTex(p: number): string {
  const label = POLE_BEHAVIOUR_LABEL[classifyPole(p)]
  const i = label.indexOf('：')
  if (i < 0) return label
  const head = label.slice(0, i).replace(/−/g, '-')
  const tail = label.slice(i + 1).replace(/μ = 0/g, String.raw`$\mu = 0$`)
  return `$${head}$：${tail}`
}
