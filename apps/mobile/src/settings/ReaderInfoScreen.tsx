import { messageFor } from "@smarternews/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../api/AppProvider";
import { useSettings } from "../api/queries";
import { useBack } from "../lib/back";
import { useTheme } from "../theme/theme";
import { Button, ErrorNotice, Field, IconButton, Loading, Notice } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Sheet } from "../ui/Sheet";
import { Txt } from "../ui/Txt";

/** The text about the reader that the server hands to the model when it judges and writes. */
export function ReaderInfoScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const back = useBack("/settings");
  const navigation = useNavigation();
  const client = useQueryClient();
  const { api } = useApp();
  const settings = useSettings();
  const [text, setText] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const leaving = useRef(false);
  const stored = settings.data?.readerInfo ?? "";
  const value = text ?? stored;
  const dirty = text !== null && text !== stored;

  const save = useMutation({
    mutationFn: () => api.updateSettings({ readerInfo: value }),
    onSuccess: (updated) => {
      client.setQueryData(["settings"], updated);
      setText(null);
    },
  });

  // Every way of leaving goes through here, the system's back gesture included.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (!dirty || leaving.current) return;
        event.preventDefault();
        setAsking(true);
      }),
    [navigation, dirty],
  );

  function discard() {
    leaving.current = true;
    setAsking(false);
    back();
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScreenHeader title="読み手情報" left={<IconButton label="設定へ戻る" icon="back" onPress={back} />} />
      {settings.isError ? <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {settings.isPending ? <Loading /> : null}
      {settings.isSuccess ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: theme.spacing.lg, padding: theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.lg }}>
          <Txt variant="body-md" color="on-surface-muted">
            記事を選ぶときと、読み手への影響を書くときに使われます。仕事、関心、住んでいる地域などを書いてください。
          </Txt>
          <Field
            label="読み手情報"
            value={value}
            onChangeText={(next) => {
              setText(next);
              save.reset();
            }}
            multiline
            editable={!save.isPending}
          />
          {save.isError ? <Notice tone="error">{messageFor(save.error)}</Notice> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
            <Button label="保存する" variant="primary" onPress={() => save.mutate()} disabled={!dirty} busyLabel={save.isPending ? "保存しています…" : null} />
            {save.isSuccess && !dirty ? (
              <Txt variant="body-md" accessibilityLiveRegion="polite">
                保存しました
              </Txt>
            ) : null}
          </View>
        </ScrollView>
      ) : null}
      <Sheet title="保存していない変更があります" visible={asking} onClose={() => setAsking(false)}>
        <Txt variant="body-md">このまま戻ると、書き換えた内容は失われます。</Txt>
        <Button label="編集を続ける" variant="primary" onPress={() => setAsking(false)} />
        <Button label="変更を捨てる" variant="danger" onPress={discard} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
