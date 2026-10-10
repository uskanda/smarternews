# Verification entry point. `make verify` is the convention the harness looks for: the Stop hook `verify-gate`
# and the `verify` skill both call this target, and nothing is called done until it passes.
# Keep every check guarded so the target still runs where a tool is missing.
SHELL := /usr/bin/env bash
TEXTLINTRC := $(HOME)/.local/share/uskn-harness/skills/ja-writing/textlintrc.json

.PHONY: verify verify-lint verify-types verify-test verify-textlint

verify: verify-lint verify-types verify-test verify-textlint ## Run every check that applies to this repository
	@echo "verify: ok"

verify-lint:
	@if [ -f package.json ]; then pnpm run lint; else echo "[lint] skipped (no package.json yet)"; fi

verify-types:
	@if [ -f package.json ]; then pnpm run typecheck; else echo "[types] skipped (no package.json yet)"; fi

verify-test:
	@if [ -f package.json ]; then pnpm run test; else echo "[test] skipped (no test suite yet)"; fi

verify-textlint:
	@# 日本語のMarkdown（openspec と docs）。textlint か設定が無い環境では、その旨を出して飛ばす。
	@if command -v textlint >/dev/null && [ -f "$(TEXTLINTRC)" ]; then \
		find openspec docs -name '*.md' -not -path '*/node_modules/*' -print0 2>/dev/null | xargs -0 -r textlint --config "$(TEXTLINTRC)" --format compact; \
	else echo "[textlint] skipped (textlint or ja-writing config missing)"; fi
