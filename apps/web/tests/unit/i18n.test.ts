import { describe, expect, it } from 'vitest'

import {
  changeLocale,
  getInitialLocale,
  i18n,
  isSupportedLocale,
} from '../../src/i18n'

describe('i18n locale selection', () => {
  it('prefers a stored supported locale', () => {
    expect(getInitialLocale({
      navigatorLanguage: 'en-US',
      storedLocale: 'zh-CN',
    })).toBe('zh-CN')
  })

  it('detects Chinese browser languages', () => {
    expect(getInitialLocale({
      navigatorLanguages: ['fr-FR', 'zh-Hans-CN'],
      storedLocale: null,
    })).toBe('zh-CN')
  })

  it('falls back to English for unknown languages', () => {
    expect(getInitialLocale({
      navigatorLanguage: 'fr-FR',
      storedLocale: null,
    })).toBe('en')
  })

  it('rejects unsupported locale values', async () => {
    await i18n.changeLanguage('en')
    await changeLocale('fr' as never)

    expect(isSupportedLocale('fr')).toBe(false)
    expect(i18n.language).toBe('en')
  })
})
