import type { DigestRequestResult, DigestTargetRequest } from "@smarternews/core/api";
import { ApiError } from "@smarternews/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Button } from "../ui/controls.tsx";

/** Why summing up a list made no digest, in the words of the digests page. */
const REFUSAL: Record<Exclude<DigestRequestResult["status"], "queued">, string> = {
  limit: "今日はこれ以上作れません。ダイジェストの1日の上限に達しました。",
  budget: "月の予算に達したため、作れません。",
  empty: "この一覧には記事がないため、作りませんでした。",
};

/**
 * The button that asks for a digest of the list on screen: its newest articles, at most 200, as the server
 * finds them again. What came of asking is said in a toast; a digest that was started can be opened from it.
 */
export function SummarizeList({ target }: { target: DigestTargetRequest }) {
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);

  async function summarize() {
    setAsking(true);
    try {
      const result = await api.requestDigest(target);
      if (result.status === "queued") {
        toast({
          message: "ダイジェストを作り始めました。できあがるとダイジェストの画面に表示されます。",
          action: { label: "ダイジェストを開く", run: () => void navigate("/digests") },
        });
      } else {
        toast({ message: REFUSAL[result.status] });
      }
    } catch (error) {
      toast({
        message:
          error instanceof ApiError && error.kind === "conflict"
            ? "すでに作っています。できあがってから、もう一度試してください。"
            : "作り始められませんでした。もう一度試してください。",
      });
    }
    await client.invalidateQueries({ queryKey: ["digests"] });
    setAsking(false);
  }

  return (
    <Button onClick={() => void summarize()} disabled={asking}>
      この一覧をまとめる
    </Button>
  );
}
