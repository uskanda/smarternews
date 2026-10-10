import { useState, type FormEvent } from "react";
import { useApp } from "../app/context.ts";
import { Button, Field, messageFor } from "../ui/controls.tsx";

/** Asks for the API token once. The token is stored only after the server has accepted it. */
export function TokenScreen({ onToken }: { onToken: (token: string) => void }) {
  const { api } = useApp();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (token.length === 0) return;
    setChecking(true);
    setProblem(null);
    try {
      if (await api.verifyToken(token)) onToken(token);
      else setProblem("トークンが正しくありません。サーバーで表示したものを、そのまま貼り付けてください。");
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-list flex-col justify-center gap-lg px-lg py-2xl">
      <h1 className="type-headline-md">smarternews</h1>
      <form onSubmit={submit} className="flex flex-col gap-md">
        <Field
          label="APIのトークン"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          hint={
            <>
              サーバーで <code>node apps/server/src/main.ts token api</code> を実行すると表示されます。このブラウザーに保存し、次からは入力を省きます。
            </>
          }
        />
        {problem ? (
          <p role="alert" className="type-body-md text-error">
            {problem}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={checking || value.trim().length === 0}>
          接続する
        </Button>
      </form>
    </main>
  );
}
