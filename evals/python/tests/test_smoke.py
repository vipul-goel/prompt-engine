"""Smoke test: pytest runs, and it can see the eval cases next to this project."""

from pathlib import Path

EVALS = Path(__file__).resolve().parents[2]


def test_eval_cases_are_visible() -> None:
    cases = [d for d in EVALS.iterdir() if (d / "prompt.md").is_file()]
    assert cases, f"no eval case folders (with a prompt.md) in {EVALS}"
