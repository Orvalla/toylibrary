import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ItemTiles from './ItemTiles'

const items = [
  { id: '1', platform: 'tonies', title: 'The Very Hungry Caterpillar', details: 'Story Tonie', notes: '', image_url: '' },
  { id: '2', platform: 'projector', title: 'Goodnight Moon', details: 'Story cartridge', notes: '', image_url: 'https://example.com/moon.jpg' },
]

describe('ItemTiles', () => {
  it('groups tiles under platform headings', () => {
    render(<ItemTiles items={items} emptyText="Nothing here" />)
    expect(screen.getByText(/Tonies \/ Toniebox/)).toBeInTheDocument()
    expect(screen.getByText(/Storybook projector/)).toBeInTheDocument()
    expect(screen.getByText('The Very Hungry Caterpillar')).toBeInTheDocument()
    expect(screen.getByText('Goodnight Moon')).toBeInTheDocument()
  })

  it('renders a photo when the item has one, platform art when it does not', () => {
    render(<ItemTiles items={items} emptyText="Nothing here" />)
    const img = screen.getByAltText('Goodnight Moon')
    expect(img).toHaveAttribute('src', 'https://example.com/moon.jpg')
    // The photo-less tile falls back to the platform emoji art.
    expect(screen.getByText('🎧')).toBeInTheDocument()
  })

  it('shows the empty text when there are no items', () => {
    render(<ItemTiles items={[]} emptyText="Nothing here yet" />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })
})
