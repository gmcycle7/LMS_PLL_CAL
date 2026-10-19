import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'uncommitted'
  }
}

/**
 * 非同步 chunk 的檔名：路由用 `import('../chapters/chNN/index.tsx')`、`import('../pages/<名稱>/index.tsx')` 載入，
 * 預設全部叫 `index-<hash>.js`（上百個同名檔，看不出誰是誰，大小警戒也只能寫「最大的 index」）。
 * 依入口模組改名：`chapter-ch05-<hash>.js`、`page-lab-<hash>.js`；其餘（Mermaid、Plotly、共用的 vendor chunk、worker）維持 Rollup 的預設命名。
 * scripts/check-bundle-size.mjs 讀到的就是這些名字。
 */
export function chunkFileName(chunk: { facadeModuleId: string | null }): string {
  const id = (chunk.facadeModuleId ?? '').replace(/\\/g, '/')
  const chapter = /\/src\/chapters\/(ch\w+)\/index\.tsx$/.exec(id)
  if (chapter) return `assets/chapter-${chapter[1]}-[hash].js`
  const page = /\/src\/pages\/([^/]+)\/index\.tsx$/.exec(id)
  if (page) return `assets/page-${page[1]}-[hash].js`
  return 'assets/[name]-[hash].js'
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  worker: { format: 'es' },
  build: {
    // Vite 在任何單一 chunk（minify 後）超過這個大小（kB）時警告。目前最大的是 plotly.js-cartesian-dist-min（約 1,385 kB），
    // 其次是主要頁面／章節 chunk（< 700 kB）；1,500 kB 剛好放得下 Plotly、超過就會在建置輸出看到警告
    // （更嚴格的位元組預算與成長比較在 scripts/check-bundle-size.mjs，CI 會跑）。
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: { chunkFileNames: chunkFileName },
    },
  },
  test: {
    globals: true,
    // 多個 agent／開發者同時跑測試時避免 CPU 嚴重超額（18 核機器上 load average 曾達 200）
    maxWorkers: 8,
    // 整章的 jsdom 測試會把好幾份章節 DOM 留在記憶體裡（docs/dev-conventions.md §6「測試」）；
    // 預設約 4 GB 的 heap 在滿載時偶爾會爆（Worker exited unexpectedly），所以把每個 worker 的上限提高到 6 GB。
    // 代價：maxWorkers 個 worker 同時滿載最多吃 maxWorkers × 6 GB，多個 agent／開發者同時跑時請用 --maxWorkers=2 並只跑改到的檔案。
    poolOptions: { forks: { execArgv: ['--max-old-space-size=6144'] } },
    // 整章／整頁的 jsdom smoke test 要渲染上百個 KaTeX 與手算題，5 s 預設值在平行執行時不夠
    testTimeout: 60_000,
    minWorkers: 1,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
})
