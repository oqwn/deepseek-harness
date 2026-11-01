// @vitest-environment jsdom
/**
 * Production-renderer acceptance for subagent expansion: the plugin renders the
 * Trajectory View through the real Slot renderer, an expanded delegation record
 * shows the child Session's ledger through `conversation.trajectory.subagent`,
 * deeper subagents open in the same panel, and each shown Session is retained
 * only while its panel shows it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT, UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationBinding, ConversationSnapshot, ConvViewOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LegacyConversationSlice } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import * as localePlugin from '@deepseek-ai/dsh-client-locale/client'
import * as resourcesPlugin from '@deepseek-ai/dsh-client-resources/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'

const PARENT = 'parent-session' as SessionId
const CHILD = '7e17d76b-ee79-49f7-bc83-986d13bb5f92' as SessionId
const GRANDCHILD = '0d31f10a-a851-4856-84b1-f569a6344640' as SessionId

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

function delegationNodes(
  task: string,
  child: SessionId,
  callTime: number,
): LegacyConversationSlice['nodes'] {
  return [
    { kind: 'user', seq: 1, time: callTime - 1_000, content: [], source: null },
    {
      kind: 'assistant', seq: 2, time: callTime - 100, turn: 1, step: 1,
      blocks: [
        { kind: 'text', text: task },
        { kind: 'tool-call', callId: `delegate-${child}`, name: 'subagent', argsRaw: '{}' },
      ],
    },
    {
      kind: 'tool-result', seq: 3, time: callTime + 400, callId: `delegate-${child}`,
      name: 'subagent', args: PartialArguments.fromText('{}'),
      call: { name: 'subagent', argsRaw: '{}' }, callTime,
      content: [{ type: 'text', text: `started subagent ${child}` }], isError: false, subCalls: [],
    },
  ]
}

function trajectoryOf(nodes: LegacyConversationSlice['nodes']): TrajectorySnapshot {
  return {
    eventNodes: nodes,
    eventLocations: new Map(),
    requests: [],
    callSchemas: new Map(),
    partial: null,
    runningCalls: [],
  }
}

function catalogEntry(id: SessionId, createdAt: number, label: string): SubagentCatalogEntry {
  return { id, createdAt, mode: 'one-shot', label }
}

async function renderedParent() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const { ctx } = runtime
  runtime.remote.provideNamespaces({ toolResults: {} })
  for (const id of [PARENT, CHILD, GRANDCHILD]) {
    await runtime.sessions.add({ id, snapshot: { blank: false } })
  }
  await runtime.sessions.setProjection(PARENT, 'subagentCatalog', [catalogEntry(CHILD, 2_200, 'Like a video')])
  await runtime.sessions.setProjection(CHILD, 'subagentCatalog', [catalogEntry(GRANDCHILD, 5_200, 'Inner task')])
  const trajectories = new Map<SessionId, SnapshotStore<TrajectorySnapshot>>([
    [PARENT, createSnapshotStore(trajectoryOf(delegationNodes('Delegating the video', CHILD, 2_100)))],
    [CHILD, createSnapshotStore(trajectoryOf(delegationNodes('child assistant says hi', GRANDCHILD, 5_100)))],
    [GRANDCHILD, createSnapshotStore(trajectoryOf([{
      kind: 'assistant', seq: 1, time: 6_000, turn: 1, step: 1,
      blocks: [{ kind: 'text', text: 'grandchild reply' }],
    }]))],
  ])
  const uiConversation = new UiConversation(ctx, runtime.sessions)
  vi.spyOn(uiConversation, 'binding').mockImplementation((source: SessionBinding | SessionId): ConversationBinding => {
    const id = typeof source === 'string' ? source : source.sessionId
    const trajectory = trajectories.get(id)
    if (trajectory === undefined) throw new Error(`no trajectory fixture for "${id}"`)
    return {
      snapshot: createSnapshotStore<ConversationSnapshot>({
        views: EMPTY_CONVERSATION_SNAPSHOT.views,
        activeTargets: new Set(['trajectory']),
      }),
      openTurn: createSnapshotStore<number | undefined>(undefined),
      activate: () => {},
      target: (target) => {
        if (target !== 'trajectory') throw new Error(`unexpected Conversation target "${target}"`)
        return trajectory as never
      },
    }
  })
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await runtime.mount(localePlugin)
  await runtime.mount(resourcesPlugin)
  const parent = runtime.sessions.retain(PARENT)
  await parent.ready
  const owner: ConvViewOwnerProps = {
    inspectCall: undefined,
    viewRequest: null,
    openView: () => {},
    completeViewRequest: () => {},
  }
  await runtime.root.declare(
    { 'conversation.view': { kind: 'list', scope: 'session' } },
    ({ renderSlot, SessionProvider }) => (
      <SessionProvider session={parent}>
        {renderSlot('conversation.view', owner, { only: 'trajectory' })}
      </SessionProvider>
    ),
  )
  await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  const trajectoryRetains = (id: SessionId) =>
    runtime.sessions.retainInfo(id).getSnapshot().retainedBy.trajectorySubagent ?? 0
  return { runtime, view, trajectoryRetains }
}

describe('subagent expansion through the production renderer', () => {
  it('shows the child Session ledger in the panel and retains it only while expanded', async () => {
    const { trajectoryRetains } = await renderedParent()
    expect(screen.getByText('Delegating the video')).toBeTruthy()
    expect(trajectoryRetains(CHILD)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Show subagent trajectory: Like a video' }))

    const panel = await screen.findByRole('region', { name: 'Subagent trajectory: Like a video' })
    expect(await within(panel).findByText('child assistant says hi')).toBeTruthy()
    expect(panel.querySelector('[data-trajectory-nested]')).toBeTruthy()
    expect(panel.querySelector('[data-conversation-composer-overlay]')).toBeNull()
    expect(screen.getByText('Delegating the video')).toBeTruthy()
    expect(trajectoryRetains(CHILD)).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Hide subagent trajectory: Like a video' }))

    expect(screen.queryByRole('region', { name: 'Subagent trajectory: Like a video' })).toBeNull()
    await waitFor(() => { expect(trajectoryRetains(CHILD)).toBe(0) })
  })

  it('opens a deeper subagent in the same panel and returns through the path control', async () => {
    const { trajectoryRetains } = await renderedParent()
    fireEvent.click(screen.getByRole('button', { name: 'Show subagent trajectory: Like a video' }))
    const panel = await screen.findByRole('region', { name: 'Subagent trajectory: Like a video' })
    const open = await within(panel).findByRole('button', { name: 'Open subagent trajectory: Inner task' })
    expect(open.hasAttribute('aria-expanded')).toBe(false)

    fireEvent.click(open)

    expect(await within(panel).findByText('grandchild reply')).toBeTruthy()
    expect(within(panel).queryByText('child assistant says hi')).toBeNull()
    const path = within(panel).getByRole('navigation', { name: 'Subagent path' })
    expect(within(path).getByText('Inner task').getAttribute('aria-current')).toBe('location')
    expect(trajectoryRetains(GRANDCHILD)).toBe(1)
    await waitFor(() => { expect(trajectoryRetains(CHILD)).toBe(0) })

    fireEvent.click(within(path).getByRole('button', { name: 'Like a video' }))

    expect(await within(panel).findByText('child assistant says hi')).toBeTruthy()
    expect(within(panel).queryByRole('navigation', { name: 'Subagent path' })).toBeNull()
    expect(trajectoryRetains(CHILD)).toBe(1)
    await waitFor(() => { expect(trajectoryRetains(GRANDCHILD)).toBe(0) })
  })
})
