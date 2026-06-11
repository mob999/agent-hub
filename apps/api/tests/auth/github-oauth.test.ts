import { describe, expect, it } from "vitest";

import {
  buildDesktopOAuthCallbackUrl,
  buildGitHubAuthorizeUrl,
  buildGitHubOAuthErrorRedirect,
  getGitHubOAuthWebOrigin,
  getSafeAuthRedirectPath,
  getSafeWebOrigin,
  selectVerifiedGitHubEmail,
} from "../../src/auth/github-oauth.js";

describe("GitHub OAuth helpers", () => {
  it("builds a GitHub authorization URL with the required OAuth parameters", () => {
    const url = new URL(
      buildGitHubAuthorizeUrl({
        clientId: "github-client-id",
        callbackUrl: "http://localhost:3000/auth/github/callback",
        state: "state-token",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("github-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBe("state-token");
  });

  it("builds desktop callback URLs for login codes and errors", () => {
    expect(buildDesktopOAuthCallbackUrl({ code: "desktop-code" })).toBe(
      "tavro://auth/callback?code=desktop-code",
    );
    expect(buildDesktopOAuthCallbackUrl({ error: "desktop_auth_failed" })).toBe(
      "tavro://auth/callback?error=desktop_auth_failed",
    );
  });

  it("selects the verified primary GitHub email", () => {
    const email = selectVerifiedGitHubEmail([
      {
        email: "secondary@example.com",
        primary: false,
        verified: true,
      },
      {
        email: "PRIMARY@example.com",
        primary: true,
        verified: true,
      },
    ]);

    expect(email).toBe("primary@example.com");
  });

  it("returns null when GitHub does not provide a verified primary email", () => {
    const email = selectVerifiedGitHubEmail([
      {
        email: "primary@example.com",
        primary: true,
        verified: false,
      },
    ]);

    expect(email).toBeNull();
  });

  it("builds a safe login redirect for OAuth errors", () => {
    const redirect = buildGitHubOAuthErrorRedirect(
      "http://127.0.0.1:5173",
      "github_email_unavailable",
    );

    expect(redirect).toBe(
      "http://127.0.0.1:5173/login?error=github_email_unavailable",
    );
  });

  it("allows localhost and 127.0.0.1 web origins for local OAuth testing", () => {
    expect(
      getSafeWebOrigin("http://localhost:5173/login", "http://127.0.0.1:5173"),
    ).toBe("http://localhost:5173");
    expect(
      getSafeWebOrigin("http://127.0.0.1:5173/login", "http://127.0.0.1:5173"),
    ).toBe("http://127.0.0.1:5173");
  });

  it("falls back when a web origin is not explicitly allowed", () => {
    expect(
      getSafeWebOrigin("https://example.com/login", "http://127.0.0.1:5173"),
    ).toBe("http://127.0.0.1:5173");
  });

  it("allows the configured admin origin", () => {
    expect(
      getSafeWebOrigin(
        "https://admin.tavro.ai/logs",
        "https://app.tavro.ai",
        ["https://admin.tavro.ai"],
      ),
    ).toBe("https://admin.tavro.ai");
  });

  it("canonicalizes localhost OAuth returns to 127.0.0.1 for local callback cookies", () => {
    expect(
      getGitHubOAuthWebOrigin(
        "http://localhost:5173/login",
        "http://127.0.0.1:5173",
      ),
    ).toBe("http://127.0.0.1:5173");
  });

  it("only allows workspace redirect paths after OAuth", () => {
    expect(getSafeAuthRedirectPath(null)).toBe("/welcome");
    expect(getSafeAuthRedirectPath("/welcome")).toBe("/welcome");
    expect(getSafeAuthRedirectPath("/runs")).toBe("/runs");
    expect(getSafeAuthRedirectPath("/logs")).toBe("/logs");
    expect(getSafeAuthRedirectPath("/users")).toBe("/users");
    expect(getSafeAuthRedirectPath("/users/user-id/show")).toBe(
      "/users/user-id/show",
    );
    expect(getSafeAuthRedirectPath("/chat/conversation-id/tasks")).toBe(
      "/chat/conversation-id/tasks",
    );
    expect(getSafeAuthRedirectPath("https://evil.example/chat")).toBe("/welcome");
    expect(getSafeAuthRedirectPath("/settings")).toBe("/welcome");
  });
});
