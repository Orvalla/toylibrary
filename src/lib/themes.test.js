import { describe, expect, it } from 'vitest'
import { THEMES, themesOf } from './themes'

const item = (platform, title, details = '') => ({ platform, title, details, item_type: 'content' })

describe('themesOf', () => {
  it('excludes devices and pure-audio platforms entirely', () => {
    expect(themesOf({ platform: 'tonies', item_type: 'device', title: 'Toniebox', details: '' })).toEqual([])
    expect(themesOf(item('tonies', 'Fire Truck Rescue Tonie', 'Tonie figure'))).toEqual([])
    expect(themesOf(item('yoto', 'Dinosaur Roar', 'Yoto Card'))).toEqual([])
    expect(themesOf(item('projector', 'The Very Hungry Caterpillar', 'Story reel'))).toEqual([])
    expect(themesOf(null)).toEqual([])
  })

  it('gives focused brands their platform theme', () => {
    expect(themesOf(item('smartgames', 'Penguins on Ice', 'Logic game'))).toContain('puzzles')
    expect(themesOf(item('thinkfun', 'Roll and Play', 'Game'))).toContain('puzzles')
    expect(themesOf(item('magnatiles', 'Classic 32-Piece Set'))).toContain('building')
    expect(themesOf(item('sphero', 'indi Student Kit'))).toContain('science')
    expect(themesOf(item('unclegoose', 'Classic ABC Blocks'))).toEqual(
      expect.arrayContaining(['building', 'words-numbers'])
    )
  })

  it('reads themes from title words on broad brands', () => {
    expect(themesOf(item('melissaanddoug', 'Wooden Jigsaw Puzzle - Safari'))).toEqual(
      expect.arrayContaining(['puzzles', 'animals'])
    )
    expect(themesOf(item('hape', 'Fix-It Tool Bench', 'Wooden workbench'))).toContain('pretend')
    expect(themesOf(item('brio', 'Railway Starter Set', 'Wooden train set'))).toEqual(
      expect.arrayContaining(['vehicles', 'building'])
    )
    expect(themesOf(item('plantoys', 'PlanWood Water Blocks'))).toContain('building')
  })

  it('themes books from their titles', () => {
    expect(themesOf(item('books', 'National Geographic Little Kids First Big Book of Dinosaurs', 'Nonfiction'))).toContain('animals')
    expect(themesOf(item('books', 'First Big Book of Space', 'Nonfiction'))).toContain('science')
    expect(themesOf(item('books', 'The Very Hungry Caterpillar', 'Picture book'))).toContain('animals')
    expect(themesOf(item('books', 'Dragons Love Tacos', 'Picture book'))).toEqual([])
  })

  it('catches the classic learning-toy shapes', () => {
    expect(themesOf(item('learningresources', 'Pretend & Play Cash Register'))).toContain('pretend')
    expect(themesOf(item('learningresources', 'Counting Cookies Game'))).toContain('words-numbers')
    // Broad brands earn themes per item, never by badge:
    // an EXIT escape game is not a science kit, and a plush
    // puppy is not a numbers toy.
    expect(themesOf(item('thamesandkosmos', 'EXIT: The Game - The Abandoned Cabin'))).not.toContain('science')
    expect(themesOf(item('leapfrog', 'My Pal Violet Personalized Plush Puppy'))).not.toContain('words-numbers')
    expect(themesOf(item('janod', 'Crossroads White Valley Sports Car'))).not.toContain('active')
    expect(themesOf(item('vtech', 'Touch and Learn Activity Desk'))).toEqual(
      expect.arrayContaining(['words-numbers'])
    )
    expect(themesOf(item('janod', 'Wooden Xylophone', 'Musical instrument'))).toContain('music')
  })

  it('does not trip on lookalike words', () => {
    // "card" must not make a vehicle; "art" inside "smart" is fine
    // because SmartGames earns puzzles from its platform anyway.
    expect(themesOf(item('melissaanddoug', 'Birthday Party Cake Set', 'Play food'))).not.toContain('vehicles')
    expect(themesOf(item('books', 'Smart but Scattered', 'Chapter book'))).toEqual([])
  })

  it('only returns declared theme keys, in THEMES order', () => {
    const keys = THEMES.map((t) => t.key)
    const got = themesOf(item('kiwico', 'Volcano Eruption Science & Art Kit', 'STEM kit'))
    for (const k of got) expect(keys).toContain(k)
    expect(got).toEqual([...got].sort((a, b) => keys.indexOf(a) - keys.indexOf(b)))
    expect(THEMES).toHaveLength(10)
  })
})
