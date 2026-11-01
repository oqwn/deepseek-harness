// @vitest-environment jsdom
/**
 * Subagent links from Trajectory tool records, the resource that retains a
 * linked child Session, and the panel that shows a descendant through its Slot.
 */
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress, SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import type { TrajectorySubagentOwnerProps } from '../src/client/trajectory-contract.ts'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import {
  deriveTrajectorySubagentLinks, parseTrajectorySubagentAddress,
  trajectorySubagentAddress, trajectorySubagentResourceProvider,
} from '../src/client/trajectory-subagent.ts'
import { TrajectorySubagentPanel, type TrajectorySubagentSeats } from '../src/client/TrajectorySubagentPanel.tsx'
import { tZh } from './locale.client.ts'

const PARENT = 'parent/a' as SessionId
const CHILD = '7e17d76b-ee79-49f7-bc83-986d13bb5f92' as SessionId
const OTHER = '0d31f10a-a851-4856-84b1-f569a6344640' as SessionId
const ADDRESS: SubagentAddress = { parentSessionId: PARENT, childSessionId: CHILD, mode: 'one-shot' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function toolCell(overrides: Partial<TrajectoryCellProps> = {}): TrajectoryCellProps {
  return {
    index: 1,
    kind: 'tool',
    text: 'subagent',
    callId: 'call-1',
    toolName: 'subagent',
    outputDetail: `started subagent ${CHILD}`,
    resultSeq: 12,
    timeSeconds: 0.5,
    startedAt: 1_000,
    ...overrides,
  }
}

function turnsOf(...cells: TrajectoryCellProps[]): TrajectoryTurnModel[] {
  return [{ turn: 1, groups: [{ title: 'Step 1', cells }] }]
}

function entry(
  id: SessionId,
  overrides: Partial<{ createdAt: number; mode: SubagentCatalogEntry['mode']; label: string }> = {},
): SubagentCatalogEntry {
  return { id, createdAt: 1_200, mode: 'one-shot', label: 'Like a video', ...overrides }
}

describe('deriveTrajectorySubagentLinks', () => {
  it('links a completed tool record to the own child its result names and that it created', () => {
    const links = deriveTrajectorySubagentLinks(turnsOf(toolCell()), [entry(CHILD)], PARENT)
    expect([...links]).toEqual([[
      'tool\u0000call\u0000call-1',
      { address: ADDRESS, label: 'Like a video' },
    ]])
  })

  it('links nested PTC subtool records and keeps the catalog mode', () => {
    const links = deriveTrajectorySubagentLinks(
      turnsOf(toolCell({ kind: 'subtool', callId: 'sub-1' })),
      [{ id: CHILD, createdAt: 1_200, mode: 'continuable', label: 'Worker' }],
      PARENT,
    )
    expect(links.get('subtool\u0000call\u0000sub-1')).toEqual({
      address: { ...ADDRESS, mode: 'continuable' },
      label: 'Worker',
    })
  })

  it('omits an absent label', () => {
    const links = deriveTrajectorySubagentLinks(
      turnsOf(toolCell()),
      [{ id: CHILD, createdAt: 1_200, mode: 'unknown' }],
      PARENT,
    )
    expect(links.get('tool\u0000call\u0000call-1')).toEqual({ address: { ...ADDRESS, mode: 'unknown' } })
  })

  it('returns one shared empty map without own local children', () => {
    const none = deriveTrajectorySubagentLinks(turnsOf(toolCell()), undefined, PARENT)
    expect(none.size).toBe(0)
    expect(deriveTrajectorySubagentLinks(turnsOf(toolCell()), [], PARENT)).toBe(none)
    expect(deriveTrajectorySubagentLinks(
      turnsOf(toolCell()), [entry(CHILD, { mode: 'external' })], PARENT,
    )).toBe(none)
    expect(deriveTrajectorySubagentLinks(
      turnsOf(toolCell({ outputDetail: 'no child here' })), [entry(CHILD)], PARENT,
    )).toBe(none)
  })

  it.each<[string, (cell: TrajectoryCellProps) => TrajectoryCellProps]>([
    ['a non-tool record', cell => ({ ...cell, kind: 'message' })],
    ['a pending call', ({ resultSeq: _resultSeq, ...cell }) => cell],
    ['a failed call', cell => ({ ...cell, isError: true })],
    ['a call without output text', ({ outputDetail: _outputDetail, ...cell }) => cell],
  ])('does not link %s', (_name, change) => {
    expect(deriveTrajectorySubagentLinks(turnsOf(change(toolCell())), [entry(CHILD)], PARENT).size).toBe(0)
  })

  it('requires the child to be created between the recorded call and result times', () => {
    const before = deriveTrajectorySubagentLinks(turnsOf(toolCell()), [entry(CHILD, { createdAt: 990 })], PARENT)
    const after = deriveTrajectorySubagentLinks(turnsOf(toolCell()), [entry(CHILD, { createdAt: 1_502 })], PARENT)
    const edges = deriveTrajectorySubagentLinks(turnsOf(
      toolCell({ callId: 'start' }),
      toolCell({ callId: 'end', startedAt: 700 }),
    ), [entry(CHILD, { createdAt: 1_000 }), entry(OTHER, { createdAt: 1_201 })], PARENT)
    expect(before.size).toBe(0)
    expect(after.size).toBe(0)
    expect(edges.get('tool\u0000call\u0000start')?.address.childSessionId).toBe(CHILD)
    expect(edges.get('tool\u0000call\u0000end')?.address.childSessionId).toBe(CHILD)
  })

  it.each<[string, (cell: TrajectoryCellProps) => TrajectoryCellProps]>([
    ['no start time', ({ startedAt: _startedAt, ...cell }) => cell],
    ['a null start time', cell => ({ ...cell, startedAt: null })],
    ['no duration', cell => ({ ...cell, timeSeconds: null })],
  ])('relies on catalog membership and the result text with %s', (_name, change) => {
    const links = deriveTrajectorySubagentLinks(
      turnsOf(change(toolCell())), [entry(CHILD, { createdAt: 99_999 })], PARENT,
    )
    expect(links.size).toBe(1)
  })

  it('skips results that name several created children', () => {
    const links = deriveTrajectorySubagentLinks(
      turnsOf(toolCell({ outputDetail: `${CHILD}\n${OTHER}` })),
      [entry(CHILD), entry(OTHER)],
      PARENT,
    )
    expect(links.size).toBe(0)
  })
})

describe('Trajectory subagent resource address', () => {
  it('round-trips the child identity, direct parent, and mode', () => {
    const address = trajectorySubagentAddress({ ...ADDRESS, childSessionId: 'child#1' as SessionId })
    expect(address).toBe('dsh-resource://trajectorysubagent/session/child%231?parent=parent%2Fa&mode=one-shot')
    expect(parseTrajectorySubagentAddress(address)).toEqual({ ...ADDRESS, childSessionId: 'child#1' })
    for (const mode of ['continuable', 'unknown'] as const) {
      expect(parseTrajectorySubagentAddress(trajectorySubagentAddress({ ...ADDRESS, mode })))
        .toEqual({ ...ADDRESS, mode })
    }
  })

  it.each([
    'not an address',
    'https://trajectorysubagent/session/child?parent=p&mode=one-shot',
    'dsh-resource://other/session/child?parent=p&mode=one-shot',
    'dsh-resource://trajectorysubagent/other/child?parent=p&mode=one-shot',
    'dsh-resource://trajectorysubagent/session?parent=p&mode=one-shot',
    'dsh-resource://trajectorysubagent/session/child/extra?parent=p&mode=one-shot',
    'dsh-resource://trajectorysubagent/session/child?mode=one-shot',
    'dsh-resource://trajectorysubagent/session/child?parent=&mode=one-shot',
    'dsh-resource://trajectorysubagent/session/child?parent=p&mode=external',
    'dsh-resource://trajectorysubagent/session/%E0%A4%A?parent=p&mode=one-shot',
  ])('rejects %s', (address) => {
    expect(parseTrajectorySubagentAddress(address)).toBeUndefined()
  })
})

describe('Trajectory subagent resource provider', () => {
  it('retains the child for the resource lifetime and releases it on close', async () => {
    const release = vi.fn()
    const reference = { sessionId: CHILD, release, [Symbol.dispose]: release } as unknown as SessionReference
    const retain = vi.fn(() => reference)
    const provider = trajectorySubagentResourceProvider({ retain } as unknown as ISessions)
    expect(provider.protocol).toBe('trajectorysubagent')

    const controller = new AbortController()
    const stream = provider.open(trajectorySubagentAddress(ADDRESS), { signal: controller.signal })[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({ done: false, value: { ok: true, value: { address: ADDRESS, reference } } })
    expect(retain).toHaveBeenCalledWith(ADDRESS, { source: 'trajectorySubagent', signal: controller.signal })
    const completion = stream.next()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
    controller.abort()
    expect(await completion).toEqual({ done: true, value: undefined })
    expect(release).toHaveBeenCalledOnce()

    const abortedAfterYield = new AbortController()
    const yielded = provider.open(trajectorySubagentAddress(ADDRESS), { signal: abortedAfterYield.signal })[Symbol.asyncIterator]()
    expect((await yielded.next()).done).toBe(false)
    abortedAfterYield.abort()
    expect(await yielded.next()).toEqual({ done: true, value: undefined })
    expect(release).toHaveBeenCalledTimes(2)

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    const stopped = provider.open(trajectorySubagentAddress(ADDRESS), { signal: alreadyAborted.signal })[Symbol.asyncIterator]()
    expect(await stopped.next()).toEqual({ done: true, value: undefined })
    expect(retain).toHaveBeenCalledTimes(2)
  })

  it('treats a malformed address as a programming error', async () => {
    const provider = trajectorySubagentResourceProvider({ retain: vi.fn() } as unknown as ISessions)
    const stream = provider.open('invalid', { signal: new AbortController().signal })[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toThrow('invalid subagent resource address "invalid"')
  })
})

type ResourceSnapshot = ReturnType<GlobalStandardProps['useResource']>

const GRANDCHILD = 'grandchild-1' as SessionId
const GRAND_ADDRESS: SubagentAddress = { parentSessionId: CHILD, childSessionId: GRANDCHILD, mode: 'one-shot' }

function liveSnapshot(address: string): ResourceSnapshot {
  const parsed = parseTrajectorySubagentAddress(address)
  if (parsed === undefined) throw new Error(`unexpected resource address "${address}"`)
  const reference = { sessionId: parsed.childSessionId } as SessionReference
  return { status: 'live', value: { address: parsed, reference }, failure: undefined }
}

function panelSeats(read: (address: string) => ResourceSnapshot) {
  const resourceReads = vi.fn(read)
  const slotRenders = vi.fn((_key: string, _owner: TrajectorySubagentOwnerProps) => <div data-testid="child-trajectory" />)
  const SessionProvider = ({ session, children }: { session?: SessionReference | undefined; children?: ReactNode }) => (
    <div data-testid="child-binding" data-session={session?.sessionId}>{children}</div>
  )
  const seats: TrajectorySubagentSeats = {
    useResource: resourceReads as unknown as GlobalStandardProps['useResource'],
    renderSlot: slotRenders as unknown as TrajectorySubagentSeats['renderSlot'],
    SessionProvider,
  }
  return { seats, resourceReads, slotRenders }
}

describe('TrajectorySubagentPanel', () => {
  const link = { address: ADDRESS, label: 'Like a video' }
  const renderImages = () => null

  it('binds the retained child around the subagent Slot and routes the owner capabilities', () => {
    const { seats, resourceReads, slotRenders } = panelSeats(liveSnapshot)
    render(<TrajectorySubagentPanel link={link} {...seats} renderImages={renderImages} t={tZh} />)

    expect(resourceReads).toHaveBeenCalledWith(trajectorySubagentAddress(ADDRESS))
    expect(screen.getByTestId('child-binding').getAttribute('data-session')).toBe(CHILD)
    expect(screen.getByTestId('child-binding').contains(screen.getByTestId('child-trajectory'))).toBe(true)
    const [key, owner] = slotRenders.mock.calls.at(-1) ?? []
    expect(key).toBe('conversation.trajectory.subagent')
    expect(owner?.renderImages).toBe(renderImages)
    expect(screen.queryByRole('navigation', { name: '子智能体路径' })).toBeNull()
  })

  it('opens a deeper subagent in place and returns through the path control', () => {
    const { seats, resourceReads, slotRenders } = panelSeats(liveSnapshot)
    render(<TrajectorySubagentPanel link={link} {...seats} renderImages={renderImages} t={tZh} />)
    const owner = slotRenders.mock.calls.at(-1)?.[1]

    act(() => { owner?.openSubagent({ address: GRAND_ADDRESS }) })

    expect(resourceReads).toHaveBeenLastCalledWith(trajectorySubagentAddress(GRAND_ADDRESS))
    expect(screen.getByTestId('child-binding').getAttribute('data-session')).toBe(GRANDCHILD)
    const path = screen.getByRole('navigation', { name: '子智能体路径' })
    expect(within(path).getByText(GRANDCHILD).getAttribute('aria-current')).toBe('location')
    expect(path.textContent).toBe(`Like a video›${GRANDCHILD}`)

    fireEvent.click(within(path).getByRole('button', { name: 'Like a video' }))

    expect(screen.queryByRole('navigation', { name: '子智能体路径' })).toBeNull()
    expect(screen.getByTestId('child-binding').getAttribute('data-session')).toBe(CHILD)
  })

  it('reports opening, failure, and an unavailable resource service', () => {
    const notice = (snapshot: ResourceSnapshot) => panelSeats(() => snapshot).seats
    const view = render(<TrajectorySubagentPanel link={link}
      {...notice({ status: 'loading', value: undefined, failure: undefined })} renderImages={renderImages} t={tZh} />)
    expect(screen.getByRole('status').textContent).toBe('正在打开子智能体会话…')

    view.rerender(<TrajectorySubagentPanel link={link}
      {...notice({ status: 'failed', value: undefined, failure: { code: 'session/not-found' } as ResourceSnapshot['failure'] })}
      renderImages={renderImages} t={tZh} />)
    expect(screen.getByRole('alert').textContent).toBe('无法打开子智能体会话（session/not-found）。')

    view.rerender(<TrajectorySubagentPanel link={link}
      {...notice({ status: 'failed', value: undefined, failure: undefined })} renderImages={renderImages} t={tZh} />)
    expect(screen.getByRole('alert').textContent).toBe('无法打开子智能体会话（）。')

    view.rerender(<TrajectorySubagentPanel link={link}
      {...notice({ status: 'none', value: undefined, failure: undefined })} renderImages={renderImages} t={tZh} />)
    expect(screen.getByText('此页面无法打开子智能体会话。')).toBeTruthy()
    expect(screen.queryByTestId('child-trajectory')).toBeNull()
  })
})
