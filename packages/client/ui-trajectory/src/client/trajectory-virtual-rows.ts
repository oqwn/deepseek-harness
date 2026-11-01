/** Pure projection from trajectory records to measurable virtual ledger rows. */

import type { TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryRecordId } from './trajectory-record.ts'

const CONTENT_ROW_HEIGHT = 30
const COLLAPSED_SUMMARY_HEIGHT = 20
const TERMINAL_BOUNDARY_HEIGHT = 9
/** CSS-owned height of the disclosure row beneath a linked subagent record. */
const SUBAGENT_TOGGLE_HEIGHT = 24
/** CSS-owned height of an expanded subagent's embedded Trajectory row. */
const SUBAGENT_PANEL_HEIGHT = 480

/** Synthetic row beneath a tool record linked to a subagent Session. */
export type TrajectorySubagentRowKind = 'toggle' | 'panel'

/** Minimal record shape required by the trajectory virtual-row projection. */
export interface VirtualizableTrajectoryRecord {
  cell: TrajectoryCellProps
  collapsedSummaryKind?: 'turn' | 'assistant' | 'tool'
  /** Present on a synthetic subagent row, whose cell is the linked tool record. */
  subagent?: { readonly row: TrajectorySubagentRowKind }
}

function rowHeight(record: VirtualizableTrajectoryRecord): number {
  if (record.subagent !== undefined) {
    return record.subagent.row === 'toggle' ? SUBAGENT_TOGGLE_HEIGHT : SUBAGENT_PANEL_HEIGHT
  }
  return record.collapsedSummaryKind === undefined ? CONTENT_ROW_HEIGHT : COLLAPSED_SUMMARY_HEIGHT
}

/** One logical record retained inside a measurable virtual row. */
export interface TrajectoryVirtualRowEntry<T extends VirtualizableTrajectoryRecord> {
  logicalIndex: number
  record: T
}

/** One virtualizer item, which may carry zero-height request boundaries. */
export interface TrajectoryVirtualRow<T extends VirtualizableTrajectoryRecord> {
  entries: readonly TrajectoryVirtualRowEntry<T>[]
  height: number
  key: string
}

/**
 * Derive the DOM-safe row identity shared by React, the virtualizer, and
 * browser scroll contracts.
 * @param record - Display record whose identity is required.
 * @returns Stable record identity with a suffix for synthetic fold summaries and subagent rows.
 */
export function trajectoryVirtualRecordKey(
  record: VirtualizableTrajectoryRecord,
): string {
  const identity = encodeURIComponent(trajectoryRecordId(record.cell))
  if (record.subagent !== undefined) return `${identity}\u0000subagent\u0000${record.subagent.row}`
  return record.collapsedSummaryKind === undefined
    ? identity
    : `${identity}\u0000summary\u0000${record.collapsedSummaryKind}`
}

/**
 * Attach separator-only records to the next content row so the virtualizer
 * never owns a zero-height item. A terminal separator retains its CSS-owned
 * lower-marker clearance as a standalone item.
 * @param records - Final search/fold projection in ledger order.
 * @returns Measurable virtual rows with original logical positions retained.
 */
export function groupTrajectoryVirtualRows<T extends VirtualizableTrajectoryRecord>(
  records: readonly T[],
): readonly TrajectoryVirtualRow<T>[] {
  const rows: TrajectoryVirtualRow<T>[] = []
  let pending: TrajectoryVirtualRowEntry<T>[] = []

  for (const [logicalIndex, record] of records.entries()) {
    const entry = { logicalIndex, record }
    if (record.cell.requestOnly === true) {
      pending.push(entry)
      continue
    }
    const entries = [...pending, entry]
    pending = []
    rows.push({
      entries,
      height: rowHeight(record),
      key: trajectoryVirtualRecordKey(record),
    })
  }

  if (pending.length > 0) {
    rows.push({
      entries: pending,
      height: TERMINAL_BOUNDARY_HEIGHT,
      key: pending.map(candidate => trajectoryVirtualRecordKey(candidate.record)).join('|'),
    })
  }

  return rows
}
