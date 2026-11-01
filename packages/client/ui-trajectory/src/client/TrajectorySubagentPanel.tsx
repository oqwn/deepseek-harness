/** Expanded subagent panel: retains one descendant Session and renders its Trajectory Slot. */

import { Fragment, useCallback, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryImageRenderer } from './TrajectoryTable.tsx'
import {
  trajectorySubagentAddress, type TrajectorySubagentLink,
} from './trajectory-subagent.ts'
import css from './TrajectoryTable.module.css'

/** Content Factory seats the panel uses to retain a descendant and render its Slot. */
export type TrajectorySubagentSeats = Pick<
  FactoryComponentPropsOf<'conversation.trajectory.content'>,
  'useResource' | 'SessionProvider' | 'renderSlot'
>

/** Props for one expanded subagent panel. */
export interface TrajectorySubagentPanelProps extends TrajectorySubagentSeats {
  /** Direct child linked from the parent ledger record. */
  readonly link: TrajectorySubagentLink
  /** Parent image renderer reused by every descendant shown in the panel. */
  readonly renderImages: TrajectoryImageRenderer
  /** Trajectory locale seat. */
  readonly t: TrajectoryTranslate
}

function labelOf(link: TrajectorySubagentLink): string {
  return link.label ?? link.address.childSessionId
}

/**
 * Show the linked child, or a deeper descendant opened from it, through
 * `conversation.trajectory.subagent` beneath a Session Provider bound to it.
 * A path control returns to any shown ancestor; the path resets on unmount.
 * @param props - Linked child, content Factory seats, image renderer, and locale seat.
 * @returns The descendant's Trajectory, or a status notice while it cannot be shown.
 */
export function TrajectorySubagentPanel({
  link, useResource, SessionProvider, renderSlot, renderImages, t,
}: TrajectorySubagentPanelProps) {
  const [path, setPath] = useState<readonly TrajectorySubagentLink[]>([link])
  const current = path.at(-1) ?? link
  const openSubagent = useCallback((next: TrajectorySubagentLink) => {
    setPath(previous => [...previous, next])
  }, [])
  const resource = useResource<'trajectorysubagent'>(trajectorySubagentAddress(current.address))
  let body
  if (resource.value !== undefined) {
    body = (
      <SessionProvider session={resource.value.reference}>
        {renderSlot('conversation.trajectory.subagent', { renderImages, openSubagent })}
      </SessionProvider>
    )
  } else if (resource.status === 'loading') {
    body = (
      <p className={css.subagentNotice} role="status">
        <StateDot state="ongoing" />
        {t('subagent.opening')}
      </p>
    )
  } else if (resource.status === 'failed') {
    body = (
      <p className={`${css.subagentNotice} ${css.error}`} role="alert">
        {t('subagent.failed', { code: resource.failure?.code ?? '' })}
      </p>
    )
  } else {
    body = <p className={css.subagentNotice}>{t('subagent.unavailable')}</p>
  }
  return (
    <>
      {path.length > 1 && (
        <nav className={css.subagentPath} aria-label={t('subagent.path')}>
          {path.map((entry, index) => {
            const label = labelOf(entry)
            const last = index === path.length - 1
            return (
              <Fragment key={`${index}:${entry.address.childSessionId}`}>
                {index > 0 && <span className={css.subagentPathSeparator} aria-hidden="true">›</span>}
                {last
                  ? <span className={css.subagentPathCurrent} aria-current="location" title={label}>{label}</span>
                  : (
                    <button
                      type="button"
                      className={css.subagentPathButton}
                      title={label}
                      onClick={() => { setPath(path.slice(0, index + 1)) }}
                    >
                      {label}
                    </button>
                  )}
              </Fragment>
            )
          })}
        </nav>
      )}
      <div className={css.subagentPanelBody}>{body}</div>
    </>
  )
}
