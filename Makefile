# Verification entry point. `make verify` is the convention the harness looks for: the Stop hook `verify-gate`
# and the `verify` skill both call this target, and nothing is called done until it passes.
SHELL := /usr/bin/env bash
HARNESS := $(HOME)/.local/share/uskn-harness
TEXTLINTRC := $(HARNESS)/skills/ja-writing/textlintrc.json
TERMS_CHECK := $(HARNESS)/plugins/uskn-harness/hooks/scripts/terms-check.sh
DOCS_JA = AGENTS.md $(wildcard *.ja.md) $(shell find openspec -name '*.md' -not -path '*/archive/*')

.PHONY: verify verify-lint verify-types verify-test verify-private verify-textlint verify-terms

verify: verify-lint verify-types verify-test verify-private verify-textlint verify-terms ## Run every check
	@echo "verify: ok"

verify-lint:
	pnpm run lint

verify-types:
	pnpm run typecheck

verify-test:
	pnpm run test

verify-private:
	@# 公開リポジトリに個人情報らしい文字列が入っていないことを確かめる。
	pnpm run --silent check:private

verify-textlint:
	@# 日本語のMarkdown。textlint か設定が無い環境では、その旨を出して飛ばす。
	@if command -v textlint >/dev/null && [ -f "$(TEXTLINTRC)" ]; then \
		textlint --config "$(TEXTLINTRC)" --format compact $(DOCS_JA); \
	else echo "[textlint] skipped (textlint or ja-writing config missing)"; fi

verify-terms:
	@# 用語集にない語と、実在しない名前を探す。ハーネスが無い環境では飛ばす。
	@if [ -x "$(TERMS_CHECK)" ]; then "$(TERMS_CHECK)" $(DOCS_JA); \
	else echo "[terms] skipped (uskn-harness not installed)"; fi
