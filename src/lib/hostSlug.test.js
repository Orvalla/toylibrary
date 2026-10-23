import { describe, it, expect } from 'vitest'
import { shareSlugFromHost } from './hostSlug'

describe('shareSlugFromHost', () => {
  it('reads a slug label under toylibrary.store', () => {
    expect(shareSlugFromHost('millers.toylibrary.store')).toBe('millers')
    expect(shareSlugFromHost('the-millers.toylibrary.store')).toBe('the-millers')
    expect(shareSlugFromHost('FAM-AE17DE53.toylibrary.store')).toBe('fam-ae17de53')
  })

  it('ignores the apex, www, and other hosts', () => {
    expect(shareSlugFromHost('toylibrary.store')).toBeNull()
    expect(shareSlugFromHost('www.toylibrary.store')).toBeNull()
    expect(shareSlugFromHost('toylibrary.fly.dev')).toBeNull()
    expect(shareSlugFromHost('localhost')).toBeNull()
    expect(shareSlugFromHost('a.b.toylibrary.store')).toBeNull()
  })

  it('rejects labels that could never be slugs', () => {
    expect(shareSlugFromHost('-bad.toylibrary.store')).toBeNull()
    expect(shareSlugFromHost('bad-.toylibrary.store')).toBeNull()
    expect(shareSlugFromHost('bad_name.toylibrary.store')).toBeNull()
  })
})
