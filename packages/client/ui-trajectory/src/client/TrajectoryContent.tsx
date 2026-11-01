/** Slot and Factory components that host the Trajectory presentation for one Session. */

import { useCallback, useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  FactoryComponentPropsOf, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectoryImageRenderer } from './TrajectoryTable.tsx'
import { TrajectorySubagentPanel } from './TrajectorySubagentPanel.tsx'
import {
  TrajectoryView, type TrajectorySubagentPresentation, type TrajectoryViewInjected,
} from './TrajectoryView.tsx'

/** Props of the Conversation View entry that hosts the Trajectory content. */
export type TrajectoryViewEntryProps =
  & Pick<ConvViewProps, 'viewRequest' | 'completeViewRequest'>
  & PropsRenderFactories

/**
 * Render the Trajectory content Factory for the View's own Session.
 * @param props - View focus request, its acknowledgement, and the Factory renderer.
 * @returns The Trajectory content occurrence.
 */
export function TrajectoryViewEntry({
  viewRequest, completeViewRequest, renderFactorySlot,
}: TrajectoryViewEntryProps) {
  return renderFactorySlot('conversation.trajectory.content', { viewRequest, completeViewRequest })
}

/** Complete props of one `conversation.trajectory.content` occurrence. */
export type TrajectoryContentProps = FactoryComponentPropsOf<'conversation.trajectory.content'>

/**
 * Render one Session's Trajectory, expanding linked subagent records into panels.
 * @param props - Factory occurrence input, Session standard props, seats, and injected controls.
 * @returns The Trajectory presentation for the bound Session.
 */
export function TrajectoryContent(props: TrajectoryContentProps) {
  const { renderSlot, SessionProvider, useResource, t } = props
  const renderImages = useCallback<TrajectoryImageRenderer>(
    owner => renderSlot('conversation.trajectory.images', owner),
    [renderSlot],
  )
  const subagents = useMemo<TrajectorySubagentPresentation>(() => ({
    kind: 'expand',
    render: link => (
      <TrajectorySubagentPanel
        link={link}
        useResource={useResource}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
        renderImages={renderImages}
        t={t}
      />
    ),
  }), [SessionProvider, renderImages, renderSlot, t, useResource])
  return <TrajectoryView {...props} renderImages={renderImages} subagents={subagents} />
}

/** Complete props of the shipped `conversation.trajectory.subagent` entry. */
export type TrajectorySubagentContentProps =
  & PropsRuntime<'conversation.trajectory.subagent'>
  & PropsRenderFactories
  & InjectFace<TrajectoryViewInjected>
  & PropsLocale<'trajectory'>

function completeNoViewRequest(): void {
  // Panel occurrences receive no View focus request to acknowledge.
}

/**
 * Render a subagent Session's Trajectory inside its parent's panel. Deeper
 * subagent records open in the same panel through the owner callback.
 * @param props - Owner capabilities, child-bound standard props, and injected controls.
 * @returns The nested Trajectory presentation.
 */
export function TrajectorySubagentContent(props: TrajectorySubagentContentProps) {
  const { openSubagent } = props
  const subagents = useMemo<TrajectorySubagentPresentation>(
    () => ({ kind: 'open', open: openSubagent }),
    [openSubagent],
  )
  return (
    <TrajectoryView
      {...props}
      viewRequest={null}
      completeViewRequest={completeNoViewRequest}
      nested
      subagents={subagents}
    />
  )
}
