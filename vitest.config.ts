import { defineConfig } from 'vitest/config'
import ShardSequencer from './test/shard-sequencer'
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    sequence: { sequencer: ShardSequencer },
    setupFiles: ['test/setup.ts', 'test/cross-check.ts'],
  },
})
