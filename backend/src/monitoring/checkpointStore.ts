/// Tracks "the last block we've already scanned" per source key, so a scan
/// pass only looks at NEW activity rather than re-scanning
/// MAX_EVENT_LOOKBACK_BLOCKS every time. This is deliberately a small
/// interface rather than a concrete Postgres table, because Postgres
/// persistence hasn't been built yet (see backend/README.md's "not yet
/// built" list) — swap InMemoryCheckpointStore for a DB-backed
/// implementation later without touching scan.ts.
///
/// HONEST LIMITATION: the in-memory default resets to "nothing scanned yet"
/// on every process restart. Combined with the Render free-tier's
/// sleep-after-15-minutes-idle behavior discussed earlier in this project,
/// that means a free-tier deployment re-scans its full lookback window on
/// every wake-up rather than incrementally — bounded and correct, just not
/// as efficient as it would be with real persistence or an always-on
/// instance. Worth fixing whenever Postgres lands.
export interface CheckpointStore {
  get(sourceKey: string): Promise<bigint | undefined>;
  set(sourceKey: string, blockNumber: bigint): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints = new Map<string, bigint>();

  async get(sourceKey: string): Promise<bigint | undefined> {
    return this.checkpoints.get(sourceKey);
  }

  async set(sourceKey: string, blockNumber: bigint): Promise<void> {
    this.checkpoints.set(sourceKey, blockNumber);
  }
}

export const defaultCheckpointStore = new InMemoryCheckpointStore();
