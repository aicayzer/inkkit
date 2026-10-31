import { BaseSequencer } from 'vitest/node'
import type { TestSpecification } from 'vitest/node'

// The default sharding hashes file paths, which left one shard with more than
// half of the slow preservation suites. Dealing the files out in name order
// spreads those neighbours across the shards.
export default class ShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { index, count } = this.ctx.config.shard!
    return [...files]
      .sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1))
      .filter((_, position) => position % count === index - 1)
  }
}
