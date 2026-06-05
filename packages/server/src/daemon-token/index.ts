import { createHmac, timingSafeEqual } from "node:crypto";

const tokenPrefix = "tvd";

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function signDaemonDeviceId(input: {
  deviceId: string;
  secret: string;
}): string {
  return base64Url(
    createHmac("sha256", input.secret).update(input.deviceId).digest(),
  );
}

export function createDaemonDeviceToken(input: {
  deviceId: string;
  secret: string;
}): string {
  return [tokenPrefix, input.deviceId, signDaemonDeviceId(input)].join("_");
}

export function verifyDaemonDeviceToken(input: {
  deviceId: string;
  secret: string;
  token: string;
}): boolean {
  const tokenPrefixWithDevice = `${tokenPrefix}_${input.deviceId}_`;

  if (!input.token.startsWith(tokenPrefixWithDevice)) {
    return false;
  }

  const signature = input.token.slice(tokenPrefixWithDevice.length);

  if (signature.length === 0) {
    return false;
  }

  const expected = Buffer.from(
    signDaemonDeviceId({
      deviceId: input.deviceId,
      secret: input.secret,
    }),
  );
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
