/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the resources plugin's Context merge (ctx.resources) and useResource seat.
import type {} from '@deepseek-ai/dsh-client-resources/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createToolResultWatcher } from './watch-tool-result.ts'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { createTrajectoryStringWrappingStore } from './string-wrapping-store.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import {
  EMPTY_TRAJECTORY_SNAPSHOT, registerTrajectoryConversationView,
} from './trajectory-snapshot-builder.ts'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import { trajectorySubagentResourceProvider } from './trajectory-subagent.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import {
  TrajectoryContent, TrajectorySubagentContent, TrajectoryViewEntry,
} from './TrajectoryContent.tsx'
import type { TrajectoryViewInjected } from './TrajectoryView.tsx'

export type { TrajectoryKey } from './locales.ts'
export type {
  TrajectoryContentInput,
  TrajectoryContribution,
  TrajectoryConversationViewNode,
  TrajectoryRequestHeaderState,
  TrajectorySnapshot,
  TrajectorySubagentOwnerProps,
  UseTrajectory,
} from './trajectory-contract.ts'
export type { TrajectorySubagentLink, TrajectorySubagentResource } from './trajectory-subagent.ts'

/** Required services: the conversation slot, registries, ordinary Session paging, and the locale service. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale', 'remote', 'remote.toolResults']

/**
 * Client plugin body: register the Trajectory content Factory, its shipped
 * subagent panel entry, and the view tab that renders the Factory.
 * Registrations ride the slot service's effect wrapper, so plugin unload
 * removes the tab, the Factory, and the image and subagent slots it declares.
 * While the resources service is present, the plugin also owns the resource
 * that retains a subagent Session for an expanded ledger record.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const trajectorySources = new WeakMap<SessionBinding, ObservableSnapshot<TrajectorySnapshot>>()
  const trajectorySource = (binding: SessionBinding): ObservableSnapshot<TrajectorySnapshot> => {
    let source = trajectorySources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('trajectory')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_TRAJECTORY_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      trajectorySources.set(binding, source)
    }
    return source
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-trajectory: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const duration = createTrajectoryDurationStore()
  const stringWrapping = createTrajectoryStringWrappingStore()
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  ctx.uiSession.provide({
    hooks: ['trajectory'],
    resolve: binding => ({ hooks: { trajectory: trajectorySource(binding) } }),
  })
  ctx.inject(['resources'], (scope) => {
    scope.effect(
      () => scope.resources.register(trajectorySubagentResourceProvider(ctx.sessions)),
      'ui-trajectory: subagent Session resources',
    )
  })
  // One Session's controls, shared by the content Factory and subagent panel occurrences.
  const injectTrajectory = (sessionId: SessionId): TrajectoryViewInjected => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`ui-trajectory: session "${sessionId}" is unavailable`)
    }
    const trajectory = ctx.uiConversation.binding(sessionId).target('trajectory')
    return {
      hooks: { duration },
      watchToolResult: createToolResultWatcher(ctx.remote, sessionId, (error) => {
        ctx.logger.warn('live tool result unavailable: %s', error)
      }),
      jsonStringWrapping: {
        getDefault: () => stringWrapping.getSnapshot(),
        setDefault: (value) => { stringWrapping.set(value) },
      },
      loadOlder: async () => {
        const before = trajectory.getSnapshot()
        await session.loadOlder()
        return trajectory.getSnapshot() !== before
      },
      loadImage: Object.assign(
        (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
        { peek: (attachment: ImageAttachmentRef) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
      ),
      setActualDuration: (value) => { duration.set(value) },
    }
  }
  ctx.slots.registerFactory({
    name: 'conversation.trajectory.content',
    scope: 'session',
    locale: NS,
    children: {
      'conversation.trajectory.images': { kind: 'single', scope: 'session' },
      'conversation.trajectory.subagent': { kind: 'single', scope: 'session' },
    },
    inject: injectTrajectory,
  }, TrajectoryContent)
  ctx.slots.inject('conversation.trajectory.subagent', () => ctx.slots.register({
    name: 'conversation.trajectory.subagent',
    locale: NS,
    inject: injectTrajectory,
  }, TrajectorySubagentContent))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    locale: NS,
    label: () => t('view.trajectory'),
  }, TrajectoryViewEntry))
}
