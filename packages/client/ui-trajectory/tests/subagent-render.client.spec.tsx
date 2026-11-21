// @vitest-environment jsdom
/**
 * Production-renderer acceptance for subagent expansion: the plugin renders the
 * Trajectory View through the real Slot renderer and the real Conversation
 * assembly, an expanded delegation record shows the child Session's ledger
 * through `conversation.trajectory.subagent`, deeper subagents open in the same
 * panel, and each shown Session is retained, with its `conversation` facet,
 * only while its panel shows it. The assembly folds a Session's events only
 * while some reference holds that facet, so these cases fail if the panel
 * retains the child without it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import * as localePlugin from '@deepseek-ai/dsh-client-locale/client'
import * as resourcesPlugin from '@deepseek-ai/dsh-client-resources/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-trajectory/client'

const PARENT = 'parent-session' as SessionId
const CHILD = '7e17d76b-ee79-49f7-bc83-986d13bb5f92' as SessionId
const GRANDCHILD = '0d31f10a-a851-4856-84b1-f569a6344640' as SessionId

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

/** One durable Session event in the shape the Session window delivers. */
function at(seq: number, time: number, type: string, data: unknown, extra: object = {}): SessionEventLikeEntry {
  return { type: 'event', event: { seq, time, type, data, ...extra } as unknown as SessionEvent }
}

/** One completed turn: a user request, an assistant reply, and an optional subagent delegation. */
function turnEvents(
  reply: string,
  start: number,
  delegation?: { readonly child: SessionId; readonly label: string },
): SessionEventLikeEntry[] {
  const callId = delegation === undefined ? undefined : `delegate-${delegation.child}`
  const args = delegation === undefined ? undefined : JSON.stringify({ description: delegation.label, prompt: 'work' })
  const toolCall = callId === undefined || args === undefined
    ? []
    : [{ type: 'tool-call', id: callId, name: 'subagent', arguments: args }]
  const events = [
    at(1, start, 'turn/start', { turn: 1 }),
    at(2, start, 'step/start', { turn: 1, step: 1 }),
    at(3, start, 'user/message', {
      id: 'user-1', role: 'user', content: [{ type: 'text', text: 'Please help' }], source: { kind: 'user' },
    }, { surfaceOp: 'append' }),
    at(4, start + 50, 'assistant/message', {
      turn: 1,
      step: 1,
      // The Client window carries the settled stream beside the durable message.
      stream: [],
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: reply }, ...toolCall],
        source: { kind: 'model', provider: 'test', model: 'test' },
      },
    }),
  ]
  if (delegation !== undefined && callId !== undefined && args !== undefined) {
    events.push(
      at(5, start + 100, 'tool/call', { turn: 1, step: 1, callId, name: 'subagent', arguments: args }),
      at(6, start + 500, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'result-1',
          role: 'tool',
          toolCallId: callId,
          source: { kind: 'tool', callId },
          content: [{ type: 'text', text: `started subagent ${delegation.child}` }],
          isError: false,
        },
      }, { surfaceOp: 'append', sourceEventSeqs: [5] }),
    )
  }
  events.push(
    at(7, start + 500, 'step/end', { turn: 1, step: 1 }),
    at(8, start + 600, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  )
  return events
}

function catalogEntry(id: SessionId, createdAt: number, label: string): SubagentCatalogEntry {
  return { id, createdAt, mode: 'one-shot', label }
}

async function renderedParent() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const { ctx } = runtime
  runtime.remote.provideNamespaces({ toolResults: {} })
  await runtime.sessions.add({
    id: PARENT,
    events: turnEvents('Delegating the video', 2_000, { child: CHILD, label: 'Like a video' }),
  })
  await runtime.sessions.add({
    id: CHILD,
    events: turnEvents('child assistant says hi', 5_000, { child: GRANDCHILD, label: 'Inner task' }),
  })
  await runtime.sessions.add({ id: GRANDCHILD, events: turnEvents('grandchild reply', 8_000) })
  await runtime.sessions.setProjection(PARENT, 'subagentCatalog', [catalogEntry(CHILD, 2_200, 'Like a video')])
  await runtime.sessions.setProjection(CHILD, 'subagentCatalog', [catalogEntry(GRANDCHILD, 5_200, 'Inner task')])
  // The real Conversation service: Trajectory definitions fold each Session's own event window.
  void new UiConversation(ctx, runtime.sessions)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await runtime.mount(localePlugin)
  await runtime.mount(resourcesPlugin)
  // The main view's reference: the fixture default retains the conversation facet.
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
  const retainInfo = (id: SessionId) => runtime.sessions.retainInfo(id).getSnapshot()
  const trajectoryRetains = (id: SessionId) => retainInfo(id).retainedBy.trajectorySubagent ?? 0
  const conversationFacets = (id: SessionId) => retainInfo(id).retainedFacets?.conversation ?? 0
  return { runtime, view, trajectoryRetains, conversationFacets }
}

describe('subagent expansion through the production renderer', () => {
  it('folds and shows the child Session ledger only while its panel retains the conversation facet', async () => {
    const { trajectoryRetains, conversationFacets } = await renderedParent()
    expect(await screen.findByText('Delegating the video')).toBeTruthy()
    expect(trajectoryRetains(CHILD)).toBe(0)
    expect(conversationFacets(CHILD)).toBe(0)

    fireEvent.click(await screen.findByRole('button', { name: 'Show subagent trajectory: Like a video' }))

    const panel = await screen.findByRole('region', { name: 'Subagent trajectory: Like a video' })
    expect(await within(panel).findByText('child assistant says hi')).toBeTruthy()
    expect(panel.querySelector('[data-trajectory-nested]')).toBeTruthy()
    expect(panel.querySelector('[data-conversation-composer-overlay]')).toBeNull()
    expect(screen.getByText('Delegating the video')).toBeTruthy()
    expect(trajectoryRetains(CHILD)).toBe(1)
    expect(conversationFacets(CHILD)).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Hide subagent trajectory: Like a video' }))

    expect(screen.queryByRole('region', { name: 'Subagent trajectory: Like a video' })).toBeNull()
    await waitFor(() => { expect(trajectoryRetains(CHILD)).toBe(0) })
    expect(conversationFacets(CHILD)).toBe(0)
  })

  it('opens a deeper subagent in the same panel and returns through the path control', async () => {
    const { trajectoryRetains, conversationFacets } = await renderedParent()
    fireEvent.click(await screen.findByRole('button', { name: 'Show subagent trajectory: Like a video' }))
    const panel = await screen.findByRole('region', { name: 'Subagent trajectory: Like a video' })
    const open = await within(panel).findByRole('button', { name: 'Open subagent trajectory: Inner task' })
    expect(open.hasAttribute('aria-expanded')).toBe(false)

    fireEvent.click(open)

    expect(await within(panel).findByText('grandchild reply')).toBeTruthy()
    expect(within(panel).queryByText('child assistant says hi')).toBeNull()
    const path = within(panel).getByRole('navigation', { name: 'Subagent path' })
    expect(within(path).getByText('Inner task').getAttribute('aria-current')).toBe('location')
    expect(trajectoryRetains(GRANDCHILD)).toBe(1)
    expect(conversationFacets(GRANDCHILD)).toBe(1)
    await waitFor(() => { expect(trajectoryRetains(CHILD)).toBe(0) })

    fireEvent.click(within(path).getByRole('button', { name: 'Like a video' }))

    expect(await within(panel).findByText('child assistant says hi')).toBeTruthy()
    expect(within(panel).queryByRole('navigation', { name: 'Subagent path' })).toBeNull()
    expect(trajectoryRetains(CHILD)).toBe(1)
    await waitFor(() => { expect(trajectoryRetains(GRANDCHILD)).toBe(0) })
  })
})
