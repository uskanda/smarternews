import { useState } from "react";
import ReactMarkdown from "react-markdown";

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https:\/\//i;

/**
 * An image of a feed article. The reader's browser asks the other site for it, so the request carries no
 * referrer. When it cannot be loaded, its description takes its place.
 */
function ArticleImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (state === "failed") return alt ? <span className="article-image-missing">{alt}</span> : null;
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
 * Images are loaded only when `images` is set, which is for the content of a feed article, and only over
 * HTTPS; everywhere else an image is shown as its description.
 */
export function Markdown({ text, images = false }: { text: string; images?: boolean }) {
  return (
    <ReactMarkdown
      urlTransform={(url, key) => ((key === "src" ? SAFE_IMAGE : SAFE_LINK).test(url) ? url : "")}
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
        img: ({ src, alt }) => (images && typeof src === "string" && src.length > 0 ? <ArticleImage src={src} alt={alt ?? ""} /> : <>{alt}</>),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
