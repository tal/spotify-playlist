import { expect, test } from 'bun:test'
import { albumArt } from '../album-art'

test('returns null when there is no artwork', () => {
  expect(albumArt(undefined)).toBeNull()
  expect(albumArt(null)).toBeNull()
  expect(albumArt([])).toBeNull()
})

test('picks the smallest image at least 64px wide', () => {
  expect(
    albumArt([
      { url: 'big', width: 640 },
      { url: 'mid', width: 300 },
      { url: 'sm', width: 64 },
    ]),
  ).toBe('sm')
})

test('order-independent: still picks the ~64px thumbnail', () => {
  expect(
    albumArt([
      { url: 'sm', width: 64 },
      { url: 'big', width: 640 },
    ]),
  ).toBe('sm')
})

test('falls back to the largest when every image is under 64px', () => {
  expect(
    albumArt([
      { url: 'a', width: 40 },
      { url: 'b', width: 50 },
    ]),
  ).toBe('b')
})

test('tolerates a missing width', () => {
  expect(albumArt([{ url: 'x' }])).toBe('x')
})
