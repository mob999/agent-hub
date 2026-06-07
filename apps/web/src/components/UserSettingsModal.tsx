import { InlineNotification, Modal, Select, SelectItem } from '@carbon/react'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  changeLocale,
  isSupportedLocale,
  localeLabels,
  supportedLocales,
  type SupportedLocale,
} from '../i18n'
import type { User } from '../lib/api'
import { AvatarPicker } from './AvatarPicker'

interface UserSettingsModalProps {
  error: string | null
  isSaving: boolean
  onClose: () => void
  onSave: (input: { avatar: string }) => void
  open: boolean
  user: User
}

export function UserSettingsModal({
  error,
  isSaving,
  onClose,
  onSave,
  open,
  user,
}: UserSettingsModalProps) {
  const { i18n, t } = useTranslation()
  const [avatar, setAvatar] = useState(user.avatar ?? DEFAULT_AVATAR_PATHS[0])
  const currentLocale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en'

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading={t('common.settings')}
      modalLabel={t('settings.account')}
      primaryButtonText={isSaving ? t('common.saving') : t('common.save')}
      secondaryButtonText={t('common.cancel')}
      primaryButtonDisabled={isSaving}
      onRequestClose={onClose}
      onSecondarySubmit={onClose}
      onRequestSubmit={() => onSave({ avatar })}
    >
      <div className="grid gap-5">
        {error && (
          <InlineNotification
            kind="error"
            title={error}
            lowContrast
            hideCloseButton
          />
        )}
        <div className="grid gap-1 rounded-xl border border-[#d8dee6] bg-[#f7f8fa] p-3">
          <p className="text-sm font-semibold text-[var(--cds-text-primary)]">
            {user.name ?? user.email}
          </p>
          <p className="text-sm text-[var(--cds-text-secondary)]">{user.email}</p>
        </div>
        <AvatarPicker
          label={t('settings.avatar')}
          value={avatar}
          onChange={setAvatar}
          disabled={isSaving}
        />
        <div className="grid gap-2 rounded-xl border border-[#d8dee6] bg-white p-3">
          <Select
            id="user-settings-language"
            labelText={t('settings.language')}
            helperText={t('settings.languageDescription')}
            value={currentLocale}
            onChange={(event) => {
              void changeLocale(event.target.value as SupportedLocale)
            }}
          >
            {supportedLocales.map((locale) => (
              <SelectItem
                key={locale}
                value={locale}
                text={localeLabels[locale]}
              />
            ))}
          </Select>
        </div>
      </div>
    </Modal>
  )
}
