export const DEFAULT_AVATAR_PATHS = [
  "/avatars/avatar-01.png",
  "/avatars/avatar-02.png",
  "/avatars/avatar-03.png",
  "/avatars/avatar-04.png",
  "/avatars/avatar-05.png",
  "/avatars/avatar-06.png",
  "/avatars/avatar-07.png",
  "/avatars/avatar-08.png",
  "/avatars/avatar-09.png",
  "/avatars/avatar-10.png",
  "/avatars/avatar-11.png",
  "/avatars/avatar-12.png",
  "/avatars/avatar-13.png",
  "/avatars/avatar-14.png",
  "/avatars/avatar-15.png",
  "/avatars/avatar-16.png",
  "/avatars/avatar-17.png",
  "/avatars/avatar-18.png",
  "/avatars/avatar-19.png",
  "/avatars/avatar-20.png",
] as const;

export type DefaultAvatarPath = (typeof DEFAULT_AVATAR_PATHS)[number];

export function isDefaultAvatarPath(value: unknown): value is DefaultAvatarPath {
  return (
    typeof value === "string" &&
    (DEFAULT_AVATAR_PATHS as readonly string[]).includes(value)
  );
}

export function pickRandomDefaultAvatar(): DefaultAvatarPath {
  const index = Math.floor(Math.random() * DEFAULT_AVATAR_PATHS.length);
  return DEFAULT_AVATAR_PATHS[index];
}
