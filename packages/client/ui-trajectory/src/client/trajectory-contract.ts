import type {
  AssistantMessageNode, AssistantTiming, ConversationLocation, ConversationNode, ConversationPromptSnapshot,
  ConversationViewNode, ConvViewOwnerProps, MessageImagesOwnerProps, PartialAssistant, RequestPromptChange,
  RequestView, RunningToolCall, SystemPromptNode, ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type { TrajectorySubagentLink } from './trajectory-subagent.ts'
import type { TrajectoryViewInjected } from './TrajectoryView.tsx'

/** Request-header facts retained by the Trajectory target. */
export interface TrajectoryRequestHeaderState {
  readonly seq: number
  readonly time: number
  readonly prompt: ConversationPromptSnapshot
  readonly change?: RequestPromptChange
  readonly location: ConversationLocation
}

/** In-flight assistant output with the loaded Step start and first token timestamps. */
export interface TrajectoryPartialAssistant extends PartialAssistant {
  readonly timing?: Pick<AssistantTiming, 'stepStartTime' | 'firstTokenTime'>
}

/** One independently assembled contribution to the legacy Trajectory ledger. */
export type TrajectoryContribution =
  | { readonly kind: 'system-prompt'; readonly prompt: SystemPromptNode }
  | {
    readonly kind: 'node'
    readonly node: ConversationNode
  }
  | {
    readonly kind: 'assistant'
    readonly node?: AssistantMessageNode
    readonly partial: TrajectoryPartialAssistant | null
    readonly request?: Extract<RequestView, { purpose: 'assistant' }>
  }
  | {
    readonly kind: 'tool'
    readonly root: ToolCallBlock
  }
  | {
    readonly kind: 'request-header'
    readonly header: TrajectoryRequestHeaderState
  }
  | {
    readonly kind: 'compaction'
    readonly request: Extract<RequestView, { purpose: 'compaction' }>
  }
  | {
    readonly kind: 'session-end'
    readonly seq: number
    readonly time: number
  }
  | {
    readonly kind: 'turn-end'
    readonly turn: number
    readonly time: number
    readonly error?: string
    readonly errorCode?: string
  }

/** Target envelope consumed by the Trajectory snapshot builder. */
export interface TrajectoryConversationViewNode extends ConversationViewNode {
  readonly target: 'trajectory'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: TrajectoryContribution
}

/** Stage-oriented Trajectory data assembled from registered business Contexts. */
export interface TrajectorySnapshot {
  /** Complete loaded prompt text whose request header is outside the window. */
  readonly systemPrompts?: readonly SystemPromptNode[]
  readonly eventNodes: readonly ConversationNode[]
  readonly eventLocations: ReadonlyMap<number, ConversationLocation>
  readonly requests: readonly RequestView[]
  readonly callSchemas: ReadonlyMap<string, ConversationPromptSnapshot['tools'][number]>
  readonly partial: TrajectoryPartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

/** Selector hook over the current Conversation binding's Trajectory target. */
export type UseTrajectory = SnapshotSelectorHook<TrajectorySnapshot>

/** Caller-owned input for one Session's Trajectory content occurrence. */
export interface TrajectoryContentInput {
  /** Focus request addressed to the Trajectory View. */
  readonly viewRequest: ConvViewOwnerProps['viewRequest']
  /** Acknowledge the current focus request. */
  readonly completeViewRequest: () => void
}

/** Parent-owned capabilities for one subagent Session shown inside a parent ledger panel. */
export interface TrajectorySubagentOwnerProps {
  /** Render one durable image group through the parent's `conversation.trajectory.images` Slot. */
  readonly renderImages: (owner: MessageImagesOwnerProps) => ReactNode
  /** Show a subagent created by the displayed Session in the same panel. */
  readonly openSubagent: (link: TrajectorySubagentLink) => void
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the Trajectory view. */
    trajectory: TrajectorySnapshot
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's Trajectory target. */
    useTrajectory: UseTrajectory
  }

  interface SlotFactoryMap {
    /**
     * One Session's Trajectory toolbar, overview, ledger, and inspector,
     * rendered by the Trajectory View for its own Session. Expanded subagent
     * records render `conversation.trajectory.subagent` beneath a Session
     * Provider bound to the child.
     */
    'conversation.trajectory.content': {
      scope: 'session'
      props: TrajectoryContentInput
      inject: TrajectoryViewInjected
      locale: 'trajectory'
      children: {
        'conversation.trajectory.images': { kind: 'single'; scope: 'session' }
        'conversation.trajectory.subagent': { kind: 'single'; scope: 'session' }
      }
    }
  }

  interface SlotMap {
    /**
     * Renderer for one group of durable record images in the Trajectory
     * ledger. The owner supplies image references, an authorized loader, and
     * alignment. A registration replaces the shipped gallery; without one,
     * images are omitted.
     */
    'conversation.trajectory.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
    /**
     * One subagent Session's Trajectory inside an expanded parent ledger
     * panel, bound to that child Session. The shipped entry renders the
     * child's ledger, routes images through the owner, and opens deeper
     * subagents in the same panel. A registration replaces that renderer.
     */
    'conversation.trajectory.subagent': { kind: 'single'; scope: 'session'; owner: TrajectorySubagentOwnerProps }
  }
}
