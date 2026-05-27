import { CheckmarkFilled } from "@carbon/react/icons";
import { DEFAULT_AVATAR_PATHS } from "@agent-hub/core";
import { useState } from "react";

interface AvatarPickerProps {
  disabled?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function AvatarPicker({
  disabled = false,
  label,
  value,
  onChange,
}: AvatarPickerProps) {
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      <p className="cds--label">{label}</p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {DEFAULT_AVATAR_PATHS.map((avatarPath) => {
          const selected = avatarPath === value;

          return (
            <button
              key={avatarPath}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              title="Double click to preview"
              className={`relative h-[50px] w-[50px] appearance-none overflow-hidden border-4 p-0 leading-none transition ${
                selected
                  ? "border-[var(--cds-border-interactive)] ring-2 ring-[var(--cds-border-interactive)] ring-offset-2 ring-offset-[var(--cds-layer-01)]"
                  : "border-[var(--cds-border-subtle-01)] hover:border-[var(--cds-border-strong-01)]"
              }`}
              onClick={() => onChange(avatarPath)}
              onDoubleClick={() => setPreviewAvatar(avatarPath)}
            >
              <img
                src={avatarPath}
                alt={avatarPath}
                className="h-full w-full object-cover"
              />
              {selected && (
                <span className="absolute bottom-0 right-0 bg-[var(--cds-background)]">
                  <CheckmarkFilled
                    size={18}
                    className="text-[var(--cds-support-success)]"
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {previewAvatar && (
        <button
          type="button"
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
          onClick={() => setPreviewAvatar(null)}
        >
          <img
            src={previewAvatar}
            alt="Avatar preview"
            className="h-72 w-72 max-h-[80vh] max-w-[80vw] border-4 border-white object-cover"
          />
        </button>
      )}
    </div>
  );
}
