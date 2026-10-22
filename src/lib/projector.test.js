import { describe, expect, it } from 'vitest'
import { projectorBrandOf, projectorGroups } from './projector'

const p = (title, details) => ({ platform: 'projector', title, details })

describe('projectorBrandOf', () => {
  it('classifies Moonlite content by its story-reel wording', () => {
    expect(projectorBrandOf(p('Biscuit', 'Story reel'))).toBe('moonlite')
    expect(projectorBrandOf(p('Bible 4-Story Boxed Set', 'Story reel bundle'))).toBe('moonlite')
    expect(projectorBrandOf(p('Moonlite Storytime Projector', 'Moonlite projector (clips to a phone)'))).toBe(
      'moonlite'
    )
  })

  it('classifies Dream Machine content and the player itself', () => {
    expect(projectorBrandOf(p('Colección de héroes de Paw Patrol', 'Dream Machine story collection'))).toBe(
      'dream-machine'
    )
    expect(projectorBrandOf(p('Some Story', 'Dream Machine story cartridge'))).toBe('dream-machine')
    expect(
      projectorBrandOf(p('Little Tikes Story Dream Machine', 'Story Dream Machine projector'))
    ).toBe('dream-machine')
  })

  it('returns null for other platforms and unbranded projector items', () => {
    expect(projectorBrandOf({ platform: 'tonies', title: 'Story reel', details: '' })).toBeNull()
    expect(projectorBrandOf(p('My homemade projector story', 'Scanned at home'))).toBeNull()
    expect(projectorBrandOf(null)).toBeNull()
  })
})

describe('projectorGroups', () => {
  it('orders Moonlite, then Dream Machine, then unbranded items', () => {
    const items = [
      p('DM one', 'Dream Machine story collection'),
      p('Homemade', 'Scanned at home'),
      p('ML one', 'Story reel'),
      p('ML two', 'Story reel'),
    ]
    const groups = projectorGroups(items)
    expect(groups.map((g) => g.key)).toEqual(['moonlite', 'dream-machine', null])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[2].label).toBeNull()
  })

  it('omits empty groups', () => {
    const groups = projectorGroups([p('ML one', 'Story reel')])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('moonlite')
  })
})
