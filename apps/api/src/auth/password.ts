export function canVerifyPasswordLogin(
  passwordHash: string | null | undefined,
): passwordHash is string {
  return typeof passwordHash === "string" && passwordHash.length > 0;
}
