import crypto from "node:crypto";

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
export const desktopOAuthProtocol = "tavro:";

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

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

export function buildDesktopOAuthCallbackUrl(input:
  | {
      code: string;
      error?: never;
    }
  | {
      code?: never;
      error: string;
    }
): string {
  const url = new URL(`${desktopOAuthProtocol}//auth/callback`);
  if (input.code !== undefined) {
    url.searchParams.set("code", input.code);
  } else {
    url.searchParams.set("error", input.error);
  }
  return url.toString();
}

/**
 * Build an HTML page for the desktop / mobile OAuth return flow.
 *
 * Chrome Custom Tabs cannot follow HTTP 302 redirects to custom URL
 * schemes (tavro://), but it DOES fire an Android intent when the
 * user *taps* a link with a custom scheme.  This page shows a brief
 * auto-redirect attempt (which may work in some browsers) and a
 * visible "Return to app" button as a guaranteed fallback.
 */
export function buildDesktopOAuthCallbackHtml(input:
  | { code: string; error?: never }
  | { code?: never; error: string }
): string {
  const callbackUrl = buildDesktopOAuthCallbackUrl(input);
  const title = input.code ? "Authorization complete" : "Authorization failed";
  const message = input.code
    ? "Returning to Tavro…"
    : "Something went wrong. Return to Tavro to try again.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #fafafa;
    color: #161616;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.08);
    max-width: 360px; width: 100%; padding: 32px 24px;
    text-align: center;
  }
  h1 { font-size: 1.25rem; margin-bottom: 8px; }
  p { color: #525252; margin-bottom: 24px; line-height: 1.5; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 44px; padding: 0 24px;
    border-radius: 9999px; border: 1px solid #161616;
    background: #161616; color: #fff;
    font-size: .9375rem; font-weight: 600;
    text-decoration: none; cursor: pointer;
    transition: background .15s;
  }
  .btn:hover { background: #393939; }
</style>
<script>
  // Attempt an automatic redirect — some browsers / Chrome versions
  // allow window.location changes that happen soon after a user-initiated
  // navigation (the OAuth flow was triggered by a user tap in the app).
  setTimeout(function () {
    window.location.href = ${JSON.stringify(callbackUrl)};
  }, 300);
</script>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>${message}</p>
  <a class="btn" href="${callbackUrl.replace(/"/g, '&quot;')}">Return to Tavro</a>
</div>
</body>
</html>`;
}

/**
 * Build an HTML page that sets the session cookie (via a top-level
 * navigation to this endpoint) and then redirects to the app via
 * JavaScript.  Unlike a 302 redirect, this keeps the navigation
 * inside the Capacitor WebView instead of being intercepted by
 * Chrome Custom Tabs.
 */
export function buildDesktopCompleteHtml(targetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${targetUrl.replace(/"/g, '&quot;')}">
<title>Login complete</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #fafafa;
    color: #161616;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.08);
    max-width: 360px; width: 100%; padding: 32px 24px;
    text-align: center;
  }
  h1 { font-size: 1.25rem; margin-bottom: 8px; }
  p { color: #525252; margin-bottom: 24px; line-height: 1.5; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 44px; padding: 0 24px;
    border-radius: 9999px; border: 1px solid #161616;
    background: #161616; color: #fff;
    font-size: .9375rem; font-weight: 600;
    text-decoration: none; cursor: pointer;
    transition: background .15s;
  }
  .btn:hover { background: #393939; }
</style>
</head>
<body>
<div class="card">
  <h1>Logged in</h1>
  <p>Returning to Tavro…</p>
  <a class="btn" href="${targetUrl.replace(/"/g, '&quot;')}">Open Tavro</a>
</div>
<script>
  // Replace the current page so the back button doesn't return here.
  document.location.replace(${JSON.stringify(targetUrl)});
</script>
</body>
</html>`;
}

export function getSafeWebOrigin(
  value: string | null,
  fallbackWebUrl: string,
  allowedWebUrls: string[] = [],
): string {
  const fallback = new URL(fallbackWebUrl).origin;
  const allowedOrigins = new Set([
    fallback,
    ...allowedWebUrls.map((url) => new URL(url).origin),
  ]);

  if (!value) {
    return fallback;
  }

  try {
    const origin = new URL(value).origin;

    // Allow configured app origins.
    if (allowedOrigins.has(origin)) {
      return origin;
    }

    // Allow common dev-server origins (web, iOS simulator)
    if (
      origin === "http://127.0.0.1:5173" ||
      origin === "http://localhost:5173"
    ) {
      return origin;
    }

    // Capacitor / mobile WebView origins — Capacitor assigns a dynamic
    // port for its local asset server (e.g. http://localhost:8017), so
    // accept any port on localhost / 127.0.0.1 over http or https.
    if (
      origin === "capacitor://localhost" ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
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
  allowedWebUrls: string[] = [],
): string {
  const fallback = new URL(fallbackWebUrl).origin;
  const safeOrigin = getSafeWebOrigin(value, fallbackWebUrl, allowedWebUrls);

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
      path === "/" ||
      path === "/welcome" ||
      path === "/chat" ||
      path.startsWith("/chat/") ||
      path === "/runs" ||
      path === "/daemon" ||
      path === "/logs" ||
      path === "/users" ||
      path.startsWith("/users/") ||
      path.startsWith("/editor/")
    ) {
      return path;
    }
  } catch {
    return "/welcome";
  }

  return "/welcome";
}
