import { describe, expect, it } from "vitest";

import {
  createDaemonDeviceToken,
  verifyDaemonDeviceToken,
} from "../../src/daemon-token/index.js";

describe("daemon device token", () => {
  it("creates a stable token that verifies for the matching device", () => {
    const token = createDaemonDeviceToken({
      deviceId: "device-123",
      secret: "secret",
    });

    expect(token).toBe(
      createDaemonDeviceToken({
        deviceId: "device-123",
        secret: "secret",
      }),
    );
    expect(
      verifyDaemonDeviceToken({
        deviceId: "device-123",
        secret: "secret",
        token,
      }),
    ).toBe(true);
  });

  it("verifies tokens whose base64url signature contains underscores", () => {
    const token = createDaemonDeviceToken({
      deviceId: "device-test",
      secret: "secret-0",
    });

    expect(token).toContain("_J");
    expect(
      verifyDaemonDeviceToken({
        deviceId: "device-test",
        secret: "secret-0",
        token,
      }),
    ).toBe(true);
  });

  it("rejects tokens for another device or secret", () => {
    const token = createDaemonDeviceToken({
      deviceId: "device-123",
      secret: "secret",
    });

    expect(
      verifyDaemonDeviceToken({
        deviceId: "device-456",
        secret: "secret",
        token,
      }),
    ).toBe(false);
    expect(
      verifyDaemonDeviceToken({
        deviceId: "device-123",
        secret: "other-secret",
        token,
      }),
    ).toBe(false);
  });
});
