# Python tooling for the eval cases. Needs uv (https://docs.astral.sh/uv/) and make.
# From the repository root: make -C evals/python test lint
.PHONY: test lint

test:
	uv run --locked pytest

lint:
	uv run --locked ruff check
	uv run --locked ruff format --check
