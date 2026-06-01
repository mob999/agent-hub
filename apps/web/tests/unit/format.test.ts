import { describe, expect, it } from 'vitest'

import { formatTime } from '../../src/lib/format'

describe('formatTime', () => {
  it('renders local date and time for search results', () => {
    expect(formatTime('2026-05-31T14:05:00')).toBe('2026-05-31 14:05')
  })
})
