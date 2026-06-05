import { InlineNotification, Modal } from '@carbon/react'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { useState } from 'react'
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
  const [avatar, setAvatar] = useState(user.avatar ?? DEFAULT_AVATAR_PATHS[0])

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading="Settings"
      modalLabel="Account"
      primaryButtonText="Save"
      secondaryButtonText="Cancel"
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
          label="User avatar"
          value={avatar}
          onChange={setAvatar}
          disabled={isSaving}
        />
      </div>
    </Modal>
  )
}
