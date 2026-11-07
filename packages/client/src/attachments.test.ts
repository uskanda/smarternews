import type { ArticleAttachment } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { attachmentDisplays, formatFileSize } from "./attachments.ts";

const RELAYED = "/api/v1/image-proxy/c2lnbmF0dXJl/aHR0cHM6Ly9pbWcuZXhhbXBsZS5vcmcvYS5wbmc";

const attachment = (overrides: Partial<ArticleAttachment>): ArticleAttachment => ({
  url: "https://cdn.example.org/files/episode%2012.mp3",
  kind: "audio",
  mimeType: "audio/mpeg",
  size: null,
  title: null,
  thumbnailOf: null,
  imageUrl: null,
  ...overrides,
});

describe("formatFileSize", () => {
  it("rounds to kilobytes below a megabyte, and to a tenth of a megabyte or gigabyte above", () => {
    expect(formatFileSize(1)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_500)).toBe("2 KB");
    expect(formatFileSize(12_345_678)).toBe("11.8 MB");
    expect(formatFileSize(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("attachmentDisplays", () => {
  it("shows an image through the relay, and the thumbnail of a page as a link to that page", () => {
    expect(
      attachmentDisplays([
        attachment({ kind: "image", url: "https://img.example.org/a.png", imageUrl: RELAYED, title: "Cover" }),
        attachment({ kind: "image", url: "https://img.example.org/t.jpg", imageUrl: RELAYED, thumbnailOf: "https://video.example.org/watch/1" }),
      ]),
    ).toEqual([
      { type: "image", key: "https://img.example.org/a.png", src: RELAYED, alt: "Cover", href: null, linkLabel: null },
      { type: "image", key: "https://img.example.org/t.jpg", src: RELAYED, alt: "", href: "https://video.example.org/watch/1", linkLabel: "元のページを開く" },
    ]);
  });

  it("links audio, video and other files with their kind and size, named by their title or their file name", () => {
    expect(
      attachmentDisplays([
        attachment({ size: 12_345_678 }),
        attachment({ kind: "video", url: "https://cdn.example.org/v.mp4", title: "The talk" }),
        attachment({ kind: "other", url: "https://cdn.example.org/", mimeType: "application/pdf", size: 2048 }),
      ]),
    ).toEqual([
      { type: "link", key: "https://cdn.example.org/files/episode%2012.mp3", href: "https://cdn.example.org/files/episode%2012.mp3", label: "episode 12.mp3", details: "音声、11.8 MB" },
      { type: "link", key: "https://cdn.example.org/v.mp4", href: "https://cdn.example.org/v.mp4", label: "The talk", details: "動画" },
      { type: "link", key: "https://cdn.example.org/", href: "https://cdn.example.org/", label: "cdn.example.org", details: "ファイル、2 KB" },
    ]);
  });

  it("links an image that the relay does not serve instead of loading it, and leaves out what is not a web address", () => {
    expect(
      attachmentDisplays([
        attachment({ kind: "image", url: "https://img.example.org/a.png", imageUrl: "https://img.example.org/a.png", title: "Cover" }),
        attachment({ url: "javascript:alert(1)" }),
      ]),
    ).toEqual([{ type: "link", key: "https://img.example.org/a.png", href: "https://img.example.org/a.png", label: "Cover", details: "画像" }]);
  });

  it("names the link of a thumbnail after the title when there is one", () => {
    const [display] = attachmentDisplays([attachment({ kind: "image", imageUrl: RELAYED, title: "How it works", thumbnailOf: "https://video.example.org/1" })]);
    expect(display).toMatchObject({ linkLabel: "元のページを開く：How it works" });
  });
});
