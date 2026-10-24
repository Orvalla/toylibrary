import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ItemTile from './ItemTile'

// The store mark (2026-10-23): an item on a platform with no
// logo of its own gets its store's favicon stamped in the
// tile corner. A CSS specificity bug once sized that stamp
// across the whole tile and hid the photo — these tests pin
// the DOM contract the stylesheet relies on: the photo is a
// plain img, and the mark is a separate img carrying the
// .tile-store-mark class that the scoped photo rule excludes.
const base = {
  id: 'i1',
  title: 'Sesame Street Elmo & Friends Story Collection',
  details: 'Dream Machine story collection',
  image_url: 'https://example.com/elmo.jpg',
  product_url: 'https://www.littletikes.com/products/elmo-collection',
  logo_url: null,
}

describe('ItemTile store mark', () => {
  it('renders the photo AND a corner store mark for a logo-less platform', () => {
    const { container } = render(<ItemTile item={{ ...base, platform: 'projector' }} />)
    const photo = screen.getByAltText(base.title)
    expect(photo).toHaveAttribute('src', base.image_url)
    expect(photo).not.toHaveClass('tile-store-mark')
    const mark = container.querySelector('img.tile-store-mark')
    expect(mark).not.toBeNull()
    expect(mark.getAttribute('src')).toContain('google.com/s2/favicons')
    expect(mark.getAttribute('src')).toContain('domain=www.littletikes.com')
  })

  it('renders no store mark for a platform with its own logo', () => {
    const { container } = render(<ItemTile item={{ ...base, platform: 'tonies' }} />)
    expect(screen.getByAltText(base.title)).toBeInTheDocument()
    expect(container.querySelector('img.tile-store-mark')).toBeNull()
  })

  it('prefers a stamped logo_url over the derived favicon', () => {
    const { container } = render(
      <ItemTile
        item={{ ...base, platform: 'other', logo_url: 'https://example.com/store.png' }}
      />
    )
    const mark = container.querySelector('img.tile-store-mark')
    expect(mark).not.toBeNull()
    expect(mark).toHaveAttribute('src', 'https://example.com/store.png')
  })
})
