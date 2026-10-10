import ReactMarkdown from "react-markdown";

const SAFE_LINK = /^(https?:|mailto:)/i;

/**
 * Renders an article body. The text was written by a model that read the web, so it is not trusted:
 * raw HTML stays text (react-markdown does not parse it), images are not loaded, and only web and mail
 * links become links.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      urlTransform={(url) => (SAFE_LINK.test(url) ? url : "")}
      components={{
        a: ({ href, children }) =>
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
              {children}
            </a>
          ) : (
            <>{children}</>
          ),
        img: ({ alt }) => <>{alt}</>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
