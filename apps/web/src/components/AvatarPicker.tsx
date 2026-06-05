import { CheckmarkFilled } from "@carbon/react/icons";
import { useState } from "react";
import { DEFAULT_AVATAR_PATHS } from "@agent-hub/core";

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
              className={`relative h-[50px] w-[50px] appearance-none overflow-hidden rounded-md border p-0.5 leading-none shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.75)_inset] transition ${
                selected
                  ? "border-[#0f62fe] ring-2 ring-[#0f62fe]/20 ring-offset-2 ring-offset-white"
                  : "border-[#dde1e6] hover:border-[#b9c3cf]"
              }`}
              onClick={() => onChange(avatarPath)}
              onDoubleClick={() => setPreviewAvatar(avatarPath)}
            >
              <img
                src={avatarPath}
                alt={avatarPath}
                className="h-full w-full rounded-[3px] object-cover"
              />
              {selected && (
                <span className="absolute bottom-0 right-0 rounded-tl-lg bg-white">
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
            className="h-72 w-72 max-h-[80vh] max-w-[80vw] rounded-md border-4 border-white object-cover shadow-[0_10px_32px_rgba(0,0,0,0.22)]"
          />
        </button>
      )}
    </div>
  );
}
