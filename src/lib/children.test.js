import { describe, expect, it } from 'vitest'
import { childNameFor, groupByChild } from './children'

const KIDS = [
  { id: 'sam', name: 'Sam' },
  { id: 'noah', name: 'Noah' },
]
const item = (id, child_id) => ({ id, child_id, title: id })

describe('childNameFor', () => {
  it('returns the child name for a child item', () => {
    expect(childNameFor(item('a', 'noah'), KIDS)).toBe('Noah')
  })

  it('returns Family for null child_id and unknown children', () => {
    expect(childNameFor(item('a', null), KIDS)).toBe('Family')
    expect(childNameFor(item('a', 'ghost'), KIDS)).toBe('Family')
    expect(childNameFor(item('a', undefined), KIDS)).toBe('Family')
  })
})

describe('groupByChild', () => {
  it('groups in the given child order with Family last', () => {
    const items = [item('f1', null), item('n1', 'noah'), item('e1', 'sam'), item('e2', 'sam')]
    const sections = groupByChild(items, KIDS)
    expect(sections.map((s) => s.childName)).toEqual(['Sam', 'Noah', 'Family'])
    expect(sections[0].items.map((i) => i.id)).toEqual(['e1', 'e2'])
    expect(sections[2].childId).toBeNull()
  })

  it('omits the Family section when nothing is shared', () => {
    const sections = groupByChild([item('e1', 'sam')], KIDS)
    expect(sections.map((s) => s.childName)).toEqual(['Sam'])
  })

  it('omits children with no items, and folds orphaned items into Family', () => {
    const sections = groupByChild([item('x', 'ghost'), item('n1', 'noah')], KIDS)
    expect(sections.map((s) => s.childName)).toEqual(['Noah', 'Family'])
    expect(sections[1].items.map((i) => i.id)).toEqual(['x'])
  })

  it('handles no children at all: everything is one Family section', () => {
    const sections = groupByChild([item('a', null), item('b', null)], [])
    expect(sections).toEqual([
      { childId: null, childName: 'Family', items: [item('a', null), item('b', null)] },
    ])
    expect(groupByChild([], [])).toEqual([])
  })
})
