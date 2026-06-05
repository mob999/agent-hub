export type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};

export type GitHubTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export const githubOAuthStateCookie = "agent_hub_github_oauth_state";

export function buildGitHubAuthorizeUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
}): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function buildGitHubOAuthErrorRedirect(
  webUrl: string,
  error: string,
): string {
  const url = new URL("/login", webUrl);
  url.searchParams.set("error", error);
  return url.toString();
}

export function getSafeWebOrigin(
  value: string | null,
  fallbackWebUrl: string,
): string {
  const fallback = new URL(fallbackWebUrl).origin;
  if (!value) {
    return fallback;
  }

  try {
    const origin = new URL(value).origin;
    if (
      origin === fallback ||
      origin === "http://127.0.0.1:5173" ||
      origin === "http://localhost:5173"
    ) {
      return origin;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function getGitHubOAuthWebOrigin(
  value: string | null,
  fallbackWebUrl: string,
): string {
  const fallback = new URL(fallbackWebUrl).origin;
  const safeOrigin = getSafeWebOrigin(value, fallbackWebUrl);

  if (
    fallback === "http://127.0.0.1:5173" &&
    safeOrigin === "http://localhost:5173"
  ) {
    return fallback;
  }

  return safeOrigin;
}

export function selectVerifiedGitHubEmail(emails: GitHubEmail[]): string | null {
  const primaryEmail = emails.find((email) => email.primary && email.verified);
  return primaryEmail?.email.toLowerCase() ?? null;
}

export function getSafeAuthRedirectPath(value: string | null): string {
  if (!value) {
    return "/welcome";
  }

  try {
    const decoded = decodeURIComponent(value);
    const url = new URL(decoded, "http://127.0.0.1");

    if (url.origin !== "http://127.0.0.1") {
      return "/welcome";
    }

    const path = `${url.pathname}${url.search}${url.hash}`;
    if (
      path === "/welcome" ||
      path === "/chat" ||
      path.startsWith("/chat/") ||
      path === "/runs" ||
      path === "/daemon" ||
      path.startsWith("/editor/")
    ) {
      return path;
    }
  } catch {
    return "/welcome";
  }

  return "/welcome";
}
