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

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 6000,
  },
  test: {
    globals: true,
    // 多個 agent／開發者同時跑測試時避免 CPU 嚴重超額（18 核機器上 load average 曾達 200）
    maxWorkers: 8,
    // 整章／整頁的 jsdom smoke test 要渲染上百個 KaTeX 與手算題，5 s 預設值在平行執行時不夠
    testTimeout: 60_000,
    minWorkers: 1,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
})
