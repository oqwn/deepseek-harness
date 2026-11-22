import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'

/**
 * Create the browser-wide turn fold mode for Trajectory ledgers.
 * @returns A persisted preference: `true` folds every turn the user has not opened.
 */
export function createTrajectoryTurnFoldStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, {
    persist: { name: 'dsh.trajectory.turnsCollapsed' },
  })
}
