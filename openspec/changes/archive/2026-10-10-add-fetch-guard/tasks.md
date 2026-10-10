# Tasks

どの作業も、仕様のScenarioに対応する失敗するテストを先に書き、そのテストが通る実装を足す順で進める。

## 1. 範囲とURLの検査

- [x] 1.1 `packages/core` に、アドレスが拒否する範囲にあるかを判定する処理を足す。設計D4の範囲ごとに、範囲の中と外のアドレスをテストで確かめる
- [x] 1.2 `packages/core` に、URLの方式と、アドレスで書かれたホストを確かめる処理を足す。`file:` のURL、ループバックのアドレス、許可するホストに書いたアドレスのScenarioをテストで通す

## 2. 取得への組み込み

- [x] 2.1 `packages/core` の取得の処理で、リダイレクトを1段ずつたどり、各段でURLを確かめる。制限の範囲へ移動させる応答、公開されたサイトへの移動、6回目のリダイレクトのScenarioを、取得を差し替えたテストで通す
- [x] 2.2 `undici` を依存に足し、接続の直前に解決されたアドレスを確かめる。テストの中で立てたHTTPサーバーに対して、`localhost` への取得が拒否され、許可するホストに書くと取得できることを確かめる
- [x] 2.3 `config.yaml` に `fetch.allowPrivateHosts` を足し、起動の処理から取得の処理へ渡す。既定が空であることと、文字列の一覧でない値が拒否されることをテストで確かめる
- [x] 2.4 `packages/core` の実行のテストに、フィードのURLが制限の範囲を指す場合を足す。実行がほかの取得元で続き、実行の記録に拒否の理由が残るScenarioを通す

## 3. 文書と全体の確認

- [x] 3.1 `examples/config.example.yaml`、`README.md`、`README.ja.md` に、取得先の制限と `fetch.allowPrivateHosts` の説明を足す。例の設定を読み込めることをテストで確かめる
- [x] 3.2 `openspec validate add-fetch-guard --strict` と `make verify` が成功することを確かめる
