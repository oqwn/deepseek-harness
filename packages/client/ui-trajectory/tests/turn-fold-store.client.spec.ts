// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTrajectoryTurnFoldStore } from '../src/client/turn-fold-store.ts'

const key = 'dsh.trajectory.turnsCollapsed'
let original: string | null

beforeEach(() => {
  original = localStorage.getItem(key)
  localStorage.removeItem(key)
})

afterEach(() => {
  if (original === null) localStorage.removeItem(key)
  else localStorage.setItem(key, original)
})

it('restores the last turn fold mode when the view is recreated', () => {
  const first = createTrajectoryTurnFoldStore()
  expect(first.getSnapshot()).toBe(false)
  first.set(true)
  const second = createTrajectoryTurnFoldStore()
  expect(second.getSnapshot()).toBe(true)
  second.set(false)
  expect(createTrajectoryTurnFoldStore().getSnapshot()).toBe(false)
})
