import { normalizeServerUrl, parseConnectLink } from "@smarternews/client";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnection, type ConnectFailure } from "../connection/ConnectionProvider";
import { lastUrl } from "../connection/store";
import { useTheme } from "../theme/theme";
import { Button, Field, Notice } from "../ui/controls";
import { Txt } from "../ui/Txt";

const FAILURE: Record<ConnectFailure, string> = {
  token: "トークンが正しくありません。サーバーの設定のディレクトリにあるトークンを確かめてください。",
  unreachable: "サーバーに届きません。URLと、この端末からサーバーへの経路を確かめてください。",
};

/** The first screen after installing: scan the web app's connection code, or type the URL and the token. */
export function ConnectScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { connect, invalidated } = useConnection();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // Set when the user asked to scan and the camera was not allowed. Before that there is nothing to explain.
  const [cameraRefused, setCameraRefused] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handling = useRef(false);
  const tokenField = useRef<TextInput>(null);

  // After the token was refused, the URL is still known: only the token has to be entered again.
  useEffect(() => {
    void lastUrl().then((stored) => {
      if (stored) setUrl((current) => (current === "" ? stored : current));
    });
  }, []);

  async function attempt(candidateUrl: string, candidateToken: string) {
    setBusy(true);
    setProblem(null);
    const failure = await connect({ url: candidateUrl, token: candidateToken });
    // On success the app leaves this screen, so there is nothing more to set.
    if (failure) {
      setProblem(FAILURE[failure]);
      setBusy(false);
    }
  }

  function submit() {
    const normalized = normalizeServerUrl(url);
    if (normalized === null) return setProblem("URLの形が正しくありません。http://で始まるサーバーのURLを入力してください。");
    if (token.trim() === "") return setProblem("トークンを入力してください。");
    void attempt(normalized, token.trim());
  }

  async function startScanning() {
    setProblem(null);
    const answer = permission?.granted ? permission : await requestPermission();
    setScanning(answer.granted);
    setCameraRefused(!answer.granted);
  }

  function scanned(data: string) {
    if (handling.current) return;
    const connection = parseConnectLink(data);
    if (!connection) return setProblem("接続用のQRコードではありません。Webの設定の画面で表示したQRコードを読み取ってください。");
    handling.current = true;
    setScanning(false);
    void attempt(connection.url, connection.token).finally(() => {
      handling.current = false;
    });
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.xl, gap: theme.spacing.xl }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Txt variant="headline-lg" heading>
            サーバーに接続
          </Txt>
          <Txt variant="body-md" color="on-surface-muted">
            Webの設定の画面で接続用のQRコードを表示し、読み取ってください。URLとトークンを入力しても接続できます。
          </Txt>
        </View>

        {invalidated ? <Notice tone="warning">トークンが無効になりました。新しいトークンで、もう一度接続してください。</Notice> : null}
        {problem ? <Notice tone="error">{problem}</Notice> : null}

        <View style={{ gap: theme.spacing.md }}>
          {scanning ? (
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ aspectRatio: 1, overflow: "hidden", borderRadius: theme.rounded.lg, backgroundColor: theme.colors["on-surface"] }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={({ data }) => scanned(data)}
                />
              </View>
              <Button label="読み取りをやめる" onPress={() => setScanning(false)} />
            </View>
          ) : (
            <Button label="QRコードを読み取る" variant="primary" onPress={() => void startScanning()} disabled={busy} />
          )}
          {cameraRefused && !scanning ? (
            <Notice>カメラの許可が必要です。端末の設定でこのアプリにカメラを許可するか、下の欄にURLとトークンを入力してください。</Notice>
          ) : null}
        </View>

        <View style={{ gap: theme.spacing.lg }}>
          <Field
            label="サーバーのURL"
            hint="例: http://news.example:8787"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => tokenField.current?.focus()}
            editable={!busy}
          />
          <Field
            ref={tokenField}
            label="トークン"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
          />
          <Button label="接続する" onPress={submit} busyLabel={busy ? "確かめています…" : null} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
