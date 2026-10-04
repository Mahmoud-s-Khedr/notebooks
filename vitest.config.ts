import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'preload',
          environment: 'node',
          include: ['src/preload/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/renderer/src/test/setup.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      all: true,
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['src/{main,preload,renderer,shared}/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'out/**', 'dist/**', 'release/**', 'coverage/**', '**/*.config.*']
    }
  }
})
