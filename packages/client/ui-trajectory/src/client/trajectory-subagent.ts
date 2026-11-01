/** Subagent records linked from a Trajectory ledger and the resource that retains their Sessions. */

import type {
  ISessions, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress, SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryRecordId } from './trajectory-record.ts'

/** Resource-address prefix for one subagent Session opened from a Trajectory ledger. */
export const TRAJECTORY_SUBAGENT_ADDRESS = 'dsh-resource://trajectorysubagent/session/'

/** Tolerance for floating-point reconstruction of a recorded result time from its duration. */
const CREATION_WINDOW_TOLERANCE_MS = 1

/** Ledger tool record whose call created one local subagent Session. */
export interface TrajectorySubagentLink {
  /** Durable direct-parent address used to retain the child Session. */
  readonly address: SubagentAddress
  /** Creation label recorded by the parent catalog, when present. */
  readonly label?: string
}

/** Value retained by one live Trajectory subagent resource occurrence. */
export interface TrajectorySubagentResource {
  readonly address: SubagentAddress
  readonly reference: SessionReference
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    trajectorySubagent: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    trajectorysubagent: TrajectorySubagentResource
  }
}

type LocalCatalogEntry = Extract<SubagentCatalogEntry, { readonly mode: SubagentAddress['mode'] }>

const NO_LINKS: ReadonlyMap<string, TrajectorySubagentLink> = new Map()

function isLocalChild(entry: SubagentCatalogEntry): entry is LocalCatalogEntry {
  return entry.mode !== 'external'
}

function createdDuringCall(createdAt: number, cell: TrajectoryCellProps): boolean {
  const startedAt = cell.startedAt
  const seconds = cell.timeSeconds
  // Without both recorded call times, the catalog and result-text checks decide alone.
  if (startedAt === undefined || startedAt === null || seconds === null) return true
  return createdAt >= startedAt - CREATION_WINDOW_TOLERANCE_MS
    && createdAt <= startedAt + seconds * 1000 + CREATION_WINDOW_TOLERANCE_MS
}

/**
 * Link completed tool records to the direct child Session each one created.
 * A record links only when its result text names exactly one local child from
 * the parent's own catalog, and that child was created between the recorded
 * call and result times. External executions have no local Session and never link.
 * @param turns - Ledger layout whose tool and subtool records are inspected.
 * @param catalog - The parent Session's own direct-child catalog, excluding fork-inherited children.
 * @param parentSessionId - Session that owns the ledger and the catalog.
 * @returns Links keyed by the linked record's stable identity.
 */
export function deriveTrajectorySubagentLinks(
  turns: readonly TrajectoryTurnModel[],
  catalog: readonly SubagentCatalogEntry[] | undefined,
  parentSessionId: SessionId,
): ReadonlyMap<string, TrajectorySubagentLink> {
  const children = catalog?.filter(isLocalChild) ?? []
  if (children.length === 0) return NO_LINKS
  const links = new Map<string, TrajectorySubagentLink>()
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        if (cell.kind !== 'tool' && cell.kind !== 'subtool') continue
        const output = cell.outputDetail
        if (cell.resultSeq === undefined || cell.isError === true || output === undefined) continue
        const matches = children.filter(child =>
          output.includes(child.id) && createdDuringCall(child.createdAt, cell))
        const child = matches.length === 1 ? matches[0] : undefined
        if (child === undefined) continue
        links.set(trajectoryRecordId(cell), {
          address: { parentSessionId, childSessionId: child.id, mode: child.mode },
          ...(child.label === undefined ? {} : { label: child.label }),
        })
      }
    }
  }
  return links.size === 0 ? NO_LINKS : links
}

/**
 * Address one linked subagent Session as a Trajectory resource.
 * @param address - Durable direct-parent subagent address.
 * @returns Canonical resource address carrying the parent and mode.
 */
export function trajectorySubagentAddress(address: SubagentAddress): string {
  const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
  return `${TRAJECTORY_SUBAGENT_ADDRESS}${encodeURIComponent(address.childSessionId)}?${query}`
}

/**
 * Parse one canonical Trajectory subagent resource address.
 * @param value - Possible resource address.
 * @returns The encoded direct-parent address, or undefined for another or malformed address.
 */
export function parseTrajectorySubagentAddress(value: string): SubagentAddress | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch (_invalidUrl) {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'trajectorysubagent') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  const encodedChild = parts[1]
  if (parts.length !== 2 || parts[0] !== 'session' || encodedChild === undefined) return undefined
  const parent = url.searchParams.get('parent')
  const mode = url.searchParams.get('mode')
  if (parent === null || parent === '' || (mode !== 'one-shot' && mode !== 'continuable' && mode !== 'unknown')) {
    return undefined
  }
  let child: string
  try {
    child = decodeURIComponent(encodedChild)
  } catch (_invalidEncoding) {
    return undefined
  }
  return { parentSessionId: parent as SessionId, childSessionId: child as SessionId, mode }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/**
 * Retain the addressed subagent Session while its resource has a holder.
 * @param sessions - Client Session service that owns references.
 * @returns Provider yielding one reference and releasing it when the resource closes.
 */
export function trajectorySubagentResourceProvider(sessions: ISessions): ResourceProvider<'trajectorysubagent'> {
  return {
    protocol: 'trajectorysubagent',
    async *open(resourceAddress, { signal }) {
      const address = parseTrajectorySubagentAddress(resourceAddress)
      if (address === undefined) {
        throw new Error(`ui-trajectory: invalid subagent resource address "${resourceAddress}"`)
      }
      if (signal.aborted) return
      const reference = sessions.retain(address, { source: 'trajectorySubagent', signal })
      try {
        yield { ok: true, value: { address, reference } }
        await waitForAbort(signal)
      } finally {
        reference.release()
      }
    },
  }
}
