import { isImageProxyPath, type ArticleAttachment, type AttachmentKind } from "@smarternews/core/api";

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = { image: "画像", audio: "音声", video: "動画", other: "ファイル" };

/** The words of the link around the thumbnail of a page. */
const OPEN_PAGE = "元のページを開く";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** A size in bytes as a reader reads it: whole kilobytes below a megabyte, tenths of a megabyte or gigabyte above. */
export function formatFileSize(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.ceil(bytes / KB))} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

/**
 * How a screen draws one attachment. An image is loaded from the relay (`src`, a path a screen resolves against
 * the server's URL); the thumbnail of a page is wrapped in a link to that page. Anything else is a link to the
 * file, with its kind and size. Nothing is played or embedded.
 */
export type AttachmentDisplay =
  | { type: "image"; key: string; src: string; alt: string; href: string | null; linkLabel: string | null }
  | { type: "link"; key: string; href: string; label: string; details: string };

const WEB = /^https?:\/\//i;

/** The last part of the address's path, decoded, or its host when the path has none. */
function fileName(url: URL): string {
  const last = url.pathname.split("/").filter((part) => part.length > 0).pop();
  if (last === undefined) return url.host;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The attachments of an article as a screen draws them, in their order. What is not a web address is left out. */
export function attachmentDisplays(attachments: readonly ArticleAttachment[]): AttachmentDisplay[] {
  return attachments.flatMap((attachment): AttachmentDisplay[] => {
    if (!WEB.test(attachment.url)) return [];
    let url: URL;
    try {
      url = new URL(attachment.url);
    } catch {
      return [];
    }
    const key = attachment.url;
    if (attachment.kind === "image" && attachment.imageUrl !== null && isImageProxyPath(attachment.imageUrl)) {
      const href = attachment.thumbnailOf !== null && WEB.test(attachment.thumbnailOf) ? attachment.thumbnailOf : null;
      const alt = attachment.title ?? "";
      return [{ type: "image", key, src: attachment.imageUrl, alt, href, linkLabel: href === null ? null : alt ? `${OPEN_PAGE}：${alt}` : OPEN_PAGE }];
    }
    const details = [ATTACHMENT_KIND_LABEL[attachment.kind], ...(attachment.size === null ? [] : [formatFileSize(attachment.size)])].join("、");
    return [{ type: "link", key, href: attachment.url, label: attachment.title ?? fileName(url), details }];
  });
}
