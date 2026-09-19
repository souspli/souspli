import { defineConfig } from 'vitest/config'

// Its own config so it does not inherit the desktop app's from the directory above.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], root: import.meta.dirname } })
