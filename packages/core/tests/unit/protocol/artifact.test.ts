import { describe, expect, it } from "vitest";

import { inferArtifactFileInfo } from "../../../src/protocol";

describe("artifact file inference", () => {
  it.each([
    ["index.html", "html", "HTML", "text/html; charset=utf-8", true, true],
    ["report.md", "markdown", "Markdown", "text/markdown; charset=utf-8", true, true],
    ["changes.patch", "diff", "Diff", "text/x-diff; charset=utf-8", true, false],
    ["screen.png", "image", "Image", "image/png", true, false],
    ["src/app.tsx", "text", "File", "text/typescript; charset=utf-8", false, true],
    ["archive.zip", "binary", "File", "application/octet-stream", false, false],
  ])(
    "infers %s",
    (filename, category, label, mimeType, canPreview, canEdit) => {
      const info = inferArtifactFileInfo({ filename });

      expect(info.category).toBe(category);
      expect(info.label).toBe(label);
      expect(info.mimeType).toBe(mimeType);
      expect(info.canPreview).toBe(canPreview);
      expect(info.canEdit).toBe(canEdit);
    },
  );
});
