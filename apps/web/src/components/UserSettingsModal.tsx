import { Button, InlineLoading, InlineNotification, Modal, Select, SelectItem } from '@carbon/react'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { Logout, UserAvatar } from '@carbon/react/icons'
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
  onLogout: () => void
  onSave: (input: { avatar: string }) => void
  open: boolean
  user: User
}

export function UserSettingsModal({
  error,
  isSaving,
  onClose,
  onLogout,
  onSave,
  open,
  user,
}: UserSettingsModalProps) {
  const { i18n, t } = useTranslation()
  const [avatar, setAvatar] = useState(user.avatar ?? DEFAULT_AVATAR_PATHS[0])
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null)
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<TavroDesktopUpdateInfo | null>(null)
  const desktopUpdates = window.tavroDesktop?.updates
  const desktopVersion = window.tavroDesktop?.version
  const currentLocale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en'

  const checkForDesktopUpdate = async () => {
    if (!desktopUpdates || updateCheckLoading) {
      return
    }

    setUpdateCheckError(null)
    setUpdateCheckLoading(true)
    try {
      const result = await desktopUpdates.check()
      setUpdateInfo(result)
    } catch (error) {
      setUpdateCheckError(
        error instanceof Error ? error.message : t('settings.updates.error'),
      )
    } finally {
      setUpdateCheckLoading(false)
    }
  }

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
        <div className="grid items-stretch gap-3 min-[560px]:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#d8dee6] bg-[#f7f8fa] p-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#d8dee6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
              {avatar ? (
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserAvatar size={24} />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--cds-text-primary)]">
                {user.name ?? user.email}
              </p>
              <p className="truncate text-sm text-[var(--cds-text-secondary)]">{user.email}</p>
            </div>
          </div>
          <Button
            className="self-center justify-self-start min-[560px]:justify-self-end"
            kind="danger--ghost"
            size="md"
            type="button"
            renderIcon={Logout}
            onClick={onLogout}
          >
            {t('appRail.logOut')}
          </Button>
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
        {desktopUpdates && (
          <div className="grid gap-3 rounded-xl border border-[#d8dee6] bg-white p-3">
            <div className="grid gap-1">
              <p className="text-sm font-semibold text-[var(--cds-text-primary)]">
                {t('settings.updates.title')}
              </p>
              {desktopVersion && (
                <p className="text-xs text-[var(--cds-text-secondary)]">
                  {t('settings.updates.currentVersion', { version: desktopVersion })}
                </p>
              )}
            </div>
            {updateCheckError && (
              <InlineNotification
                kind="error"
                title={t('settings.updates.errorTitle')}
                subtitle={updateCheckError}
                lowContrast
                hideCloseButton
              />
            )}
            {updateInfo && !updateCheckError && (
              <InlineNotification
                kind={updateInfo.updateAvailable ? 'info' : 'success'}
                title={
                  updateInfo.updateAvailable
                    ? t('settings.updates.availableTitle')
                    : t('settings.updates.upToDateTitle')
                }
                subtitle={
                  updateInfo.updateAvailable
                    ? t('settings.updates.availableSubtitle', {
                        version: updateInfo.latestVersion ?? '',
                      })
                    : t('settings.updates.upToDateSubtitle')
                }
                lowContrast
                hideCloseButton
              />
            )}
            <div>
              <Button
                kind="tertiary"
                size="sm"
                type="button"
                disabled={updateCheckLoading}
                onClick={() => void checkForDesktopUpdate()}
              >
                {updateCheckLoading ? (
                  <InlineLoading description={t('settings.updates.checking')} />
                ) : (
                  t('settings.updates.check')
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
