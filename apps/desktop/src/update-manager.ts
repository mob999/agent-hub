export type DesktopUpdateCheckSource = "auto" | "manual";

export interface DesktopUpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  checkedAt: string;
  updateAvailable: boolean;
}

interface GitHubRelease {
  draft?: boolean;
  html_url?: string;
  name?: string;
  prerelease?: boolean;
  tag_name?: string;
}

interface DesktopUpdateManagerOptions {
  currentVersion: string;
  onUpdateAvailable?: (
    info: DesktopUpdateInfo,
    source: DesktopUpdateCheckSource,
  ) => Promise<void> | void;
  releaseApiUrl?: string;
}

const defaultReleaseApiUrl =
  "https://api.github.com/repos/mob999/agent-hub/releases?per_page=20";
const desktopReleaseTagPrefix = "tavro-desktop-v";
const updateCheckIntervalMs = 60 * 60 * 1000;

export class DesktopUpdateManager {
  private readonly currentVersion: string;
  private readonly onUpdateAvailable:
    | ((
      info: DesktopUpdateInfo,
      source: DesktopUpdateCheckSource,
    ) => Promise<void> | void)
    | undefined;
  private readonly releaseApiUrl: string;
  private checkTimer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<DesktopUpdateInfo> | null = null;
  private lastPromptedVersion: string | null = null;

  constructor(options: DesktopUpdateManagerOptions) {
    this.currentVersion = normalizeVersion(options.currentVersion);
    this.onUpdateAvailable = options.onUpdateAvailable;
    this.releaseApiUrl =
      options.releaseApiUrl ??
      process.env.TAVRO_DESKTOP_RELEASE_API_URL ??
      defaultReleaseApiUrl;
  }

  startAutoChecks(): void {
    if (this.checkTimer !== null) {
      return;
    }

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates("auto").catch((error: unknown) => {
        console.warn("Tavro desktop update check failed.", error);
      });
    }, updateCheckIntervalMs);
    this.checkTimer.unref?.();

    setTimeout(() => {
      void this.checkForUpdates("auto").catch((error: unknown) => {
        console.warn("Tavro desktop update check failed.", error);
      });
    }, 30_000).unref?.();
  }

  stopAutoChecks(): void {
    if (this.checkTimer === null) {
      return;
    }

    clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  async checkForUpdates(
    source: DesktopUpdateCheckSource = "manual",
  ): Promise<DesktopUpdateInfo> {
    if (this.checkPromise !== null) {
      return this.checkPromise;
    }

    this.checkPromise = this.fetchLatestDesktopRelease()
      .then(async (release) => {
        const latestVersion = release?.tag_name === undefined
          ? undefined
          : versionFromDesktopReleaseTag(release.tag_name);
        const info: DesktopUpdateInfo = {
          checkedAt: new Date().toISOString(),
          currentVersion: this.currentVersion,
          latestVersion,
          releaseName: release?.name,
          releaseUrl: release?.html_url,
          updateAvailable:
            latestVersion !== undefined &&
            compareVersions(latestVersion, this.currentVersion) > 0,
        };

        if (info.updateAvailable && info.latestVersion && info.releaseUrl) {
          await this.notifyUpdateAvailable(info, source);
        }

        return info;
      })
      .finally(() => {
        this.checkPromise = null;
      });

    return this.checkPromise;
  }

  private async fetchLatestDesktopRelease(): Promise<GitHubRelease | null> {
    const response = await fetch(this.releaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Tavro-AI-Desktop/${this.currentVersion}`,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub release check failed with status ${response.status}.`);
    }

    const body = await response.json() as unknown;
    const releases = Array.isArray(body) ? body : [body];

    return releases.find((release): release is GitHubRelease => {
      if (typeof release !== "object" || release === null) {
        return false;
      }

      const candidate = release as GitHubRelease;
      return candidate.draft !== true &&
        candidate.prerelease !== true &&
        typeof candidate.tag_name === "string" &&
        candidate.tag_name.startsWith(desktopReleaseTagPrefix) &&
        typeof candidate.html_url === "string";
    }) ?? null;
  }

  private async notifyUpdateAvailable(
    info: DesktopUpdateInfo,
    source: DesktopUpdateCheckSource,
  ): Promise<void> {
    if (
      source === "auto" &&
      info.latestVersion !== undefined &&
      this.lastPromptedVersion === info.latestVersion
    ) {
      return;
    }

    this.lastPromptedVersion = info.latestVersion ?? null;
    await this.onUpdateAvailable?.(info, source);
  }
}

function versionFromDesktopReleaseTag(tagName: string): string | undefined {
  if (!tagName.startsWith(desktopReleaseTagPrefix)) {
    return undefined;
  }

  return normalizeVersion(tagName.slice(desktopReleaseTagPrefix.length));
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function versionParts(version: string): number[] {
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
