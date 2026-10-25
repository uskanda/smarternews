import { relayedImageUrl, type TermMatcher } from "@smarternews/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { rehypeHighlights, SKIP_ATTRIBUTE, type AnnotationMarks } from "./highlight.tsx";

/** The attribute that keeps a description out of the text highlights are found in. */
const skip = { [SKIP_ATTRIBUTE]: "" };

const SAFE_LINK = /^(https?:|mailto:)/i;

/** The address of an image on the server's relay, on this origin; empty for any other, which is never loaded. */
const relayed = (url: string): string => relayedImageUrl("", url) ?? "";

/**
 * An image of a feed article, loaded from the server's relay, which fetches it from the other site. The
 * request carries no referrer. When it cannot be loaded, its description takes its place.
 */
function ArticleImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (state === "failed")
    return alt ? (
      <span className="article-image-missing" {...skip}>
        {alt}
      </span>
    ) : null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      // Until the image arrives, a box of a usual shape holds its place, so that the text below moves little.
      className={`article-image ${state === "loading" ? "article-image-pending" : ""}`}
      onLoad={() => setState("loaded")}
      onError={() => setState("failed")}
    />
  );
}

/**
 * Renders an article body. The text is not trusted markup, whether a model wrote it or a feed delivered it:
 * raw HTML stays text (react-markdown does not parse it), and only web and mail links become links.
 * Images are loaded only when `images` is set, which is for the content of a feed article, and only from the
 * server's relay, whose addresses the API puts in the content; everywhere else an image is shown as its
 * description.
 * With `plainHeadings` a heading is drawn as a line of bold text: the original under a translated heading
 * must not be a second heading in the outline of the page.
 * With `highlight`, the words of an article opened from search results are marked wherever they are in the text.
 * With `groups`, the terms of the term groups are coloured in the text, never in the address of a link or image.
 * With `annotations`, the reader's highlights are marked around both, and the text they are counted in is told
 * after each drawing. The description of an image is no part of that text.
 */
export function Markdown({
  text,
  images = false,
  plainHeadings = false,
  highlight,
  groups,
  annotations,
}: {
  text: string;
  images?: boolean;
  plainHeadings?: boolean;
  highlight?: readonly string[];
  groups?: TermMatcher | null;
  annotations?: AnnotationMarks;
}) {
  const colored = groups && !groups.empty ? groups : null;
  const searched = highlight && highlight.length > 0 ? highlight : undefined;
  // The plugin runs while the tree is drawn; the text it finds is told once the drawing is done.
  const told = useRef<string | null>(null);
  const onText = annotations?.onText;
  useEffect(() => {
    if (told.current !== null) onText?.(told.current);
  });
  const plain = ({ children }: { children?: ReactNode }) => (
    <p>
      <strong>{children}</strong>
    </p>
  );
  return (
    <ReactMarkdown
      rehypePlugins={
        searched || colored || annotations
          ? [rehypeHighlights(searched, colored, annotations ? { ranges: annotations.ranges, onText: (found) => (told.current = found) } : undefined)]
          : []
      }
      urlTransform={(url, key) => (key === "src" ? relayed(url) : SAFE_LINK.test(url) ? url : "")}
      components={{
        a: ({ href, children }) =>
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
              {children}
            </a>
          ) : (
            <>{children}</>
          ),
        // The headline of the article is the page's own; a heading inside the content never outranks it.
        h1: ({ children }) => <h2>{children}</h2>,
        ...(plainHeadings ? { h1: plain, h2: plain, h3: plain, h4: plain, h5: plain, h6: plain } : {}),
        img: ({ src, alt }) =>
          images && typeof src === "string" && src.length > 0 ? <ArticleImage src={src} alt={alt ?? ""} /> : alt ? <span {...skip}>{alt}</span> : null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
