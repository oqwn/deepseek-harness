/**
 * An expanded subagent panel row hosts a nested ledger that uses the same
 * stylesheet, so rules keyed on attributes the panel row carries must reach
 * only that row's own cells, never the nested ledger's.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/TrajectoryTable.module.css', import.meta.url)), 'utf8')

/**
 * List the selectors whose row condition a subagent panel row can satisfy.
 * @param source - Stylesheet text.
 * @returns Normalized selectors keyed on the subagent-row or turn-end attributes.
 */
function panelRowSelectors(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, selectors = '']) => selectors.split(','))
    .map(selector => selector.trim().replace(/\s+/g, ' '))
    .filter(selector => /tr\[data-(?:subagent-row|turn-end)/.test(selector))
}

describe('nested subagent ledger styles', () => {
  it('detects descendant selectors that would leak into a nested ledger', () => {
    expect(panelRowSelectors('.table tbody tr[data-subagent-row=\'panel\'] td { height: 480px; }'))
      .toEqual(['.table tbody tr[data-subagent-row=\'panel\'] td'])
    expect(panelRowSelectors('/* tr[data-turn-end] */ .other { color: red; }')).toEqual([])
  })

  it('scopes rules keyed on panel-row attributes to the row\'s own cells', () => {
    const selectors = panelRowSelectors(css)
    expect(selectors).toEqual(expect.arrayContaining([
      '.table > tbody > tr[data-subagent-row=\'toggle\'] > td',
      '.table > tbody > tr[data-subagent-row=\'panel\'] > td',
      '.table > tbody > tr[data-turn-end=\'true\'] > td > .turnRail',
    ]))
    for (const selector of selectors) {
      expect(selector).toMatch(/^\.table > tbody > tr\[[^\]]+\] > td(?: > \.[\w-]+)?$/)
    }
  })
})
