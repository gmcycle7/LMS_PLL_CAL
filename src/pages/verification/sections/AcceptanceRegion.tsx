import { CodeBlock } from '@/components'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'

/**
 * 驗收表某一列展開後顯示的核心程式碼：acceptance.ts 的一個 #region。
 * 整份 acceptance.ts 的原始碼（約 95 KB）要放在這個獨立的 lazy chunk，驗收表本身才不必為了它讓首屏多下載約 25 KB（gzip）。
 */
export default function AcceptanceRegion({ region, title, caption }: { region: string; title: string; caption: string }) {
  return <CodeBlock source={acceptanceSrc} region={region} path="src/simulation/models/acceptance.ts" title={title} caption={caption} />
}
