import * as Dialog from "@radix-ui/react-dialog";
import { buildConnectLink } from "@smarternews/client";
import { useState } from "react";
import { encode } from "uqr";
import { readToken } from "../lib/token-store.ts";
import { Button } from "../ui/controls.tsx";

const BORDER = 4;

/** A QR code as one SVG path: a one-by-one square for every dark module, in a grid `size` wide. */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { border: BORDER, ecc: "M" });
  let d = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!data[y]![x]) continue;
      // Neighbours in a row become one rectangle.
      let run = 1;
      while (x + run < size && data[y]![x + run]) run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return { size, d };
}

/**
 * The code the Android app scans to connect: the address this page was loaded from, and the API token. It is
 * drawn only while the dialog is open, because whoever can see it can read everything.
 */
export function ConnectCode() {
  const [link, setLink] = useState<string | null>(null);
  const code = link === null ? null : qrPath(link);

  function show() {
    const token = readToken();
    if (token) setLink(buildConnectLink(window.location.origin, token));
  }

  return (
    <>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        Androidアプリは、このQRコードを読み取って接続します。QRコードにはトークンが含まれます。ほかの人に見える場所では表示しないでください。
      </p>
      <div>
        <Button onClick={show}>アプリ接続用のQRコードを表示する</Button>
      </div>
      <Dialog.Root open={code !== null} onOpenChange={(open) => (open ? undefined : setLink(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-outline bg-surface p-xl">
            <Dialog.Title className="type-headline-md">アプリを接続する</Dialog.Title>
            <Dialog.Description className="type-body-md">
              アプリの接続の画面で「QRコードを読み取る」を押し、このコードを写してください。
            </Dialog.Description>
            {code ? (
              // Always dark on white, in both colour schemes: a camera needs the contrast.
              <svg role="img" aria-label="接続用のQRコード" viewBox={`0 0 ${code.size} ${code.size}`} className="w-full rounded-sm bg-[#FFFFFF]" shapeRendering="crispEdges">
                <path d={code.d} fill="#000000" />
              </svg>
            ) : null}
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <Button>閉じる</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
