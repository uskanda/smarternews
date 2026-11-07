import { attachmentDisplays, relayedImageUrl } from "@smarternews/client";
import type { Article } from "@smarternews/core/api";
import { Pressable, View } from "react-native";
import { useConnection } from "../connection/ConnectionProvider";
import { openSource } from "../lib/links";
import { useTheme } from "../theme/theme";
import { Txt } from "../ui/Txt";
import { ArticleImage } from "./Markdown";

/**
 * The files a feed attached to an article, below its body. An image is loaded from the server's relay, and the
 * thumbnail of a video opens the article's page. Any other file opens in the browser, with its kind and size
 * beside its name. Nothing is played or embedded. An article without attachments shows nothing.
 */
export function Attachments({ attachments }: { attachments: Article["attachments"] }) {
  const theme = useTheme();
  const server = useConnection().connection?.url;
  const displays = attachmentDisplays(attachments);
  if (displays.length === 0) return null;
  return (
    <View testID="attachments" style={{ gap: theme.spacing.md, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.outline }}>
      <Txt variant="label-sm" color="on-surface-muted" heading>
        添付
      </Txt>
      {displays.map((display) => {
        if (display.type === "image") {
          const uri = server ? relayedImageUrl(server, display.src) : null;
          if (uri === null) return null;
          const image = <ArticleImage uri={uri} alt={display.alt} theme={theme} />;
          if (display.href === null) return <View key={display.key}>{image}</View>;
          const href = display.href;
          return (
            <Pressable key={display.key} accessibilityRole="link" accessibilityLabel={display.linkLabel ?? undefined} onPress={() => void openSource(href)}>
              {image}
            </Pressable>
          );
        }
        return (
          <Pressable
            key={display.key}
            accessibilityRole="link"
            accessibilityLabel={`${display.label}、${display.details}`}
            onPress={() => void openSource(display.href)}
            style={{ minHeight: theme.spacing["touch-android"], justifyContent: "center" }}
          >
            <Txt variant="body-md">
              <Txt variant="body-md" color="primary" style={{ textDecorationLine: "underline" }}>
                {display.label}
              </Txt>
              <Txt variant="body-md" color="on-surface-muted">
                {`  ${display.details}`}
              </Txt>
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
