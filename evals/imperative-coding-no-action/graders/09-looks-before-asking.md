---
# The first paragraph restates what place-files.sh writes, because the judge sees only the reply;
# keep the two in step. The facts hold only in a run with --scaffold, which runs that script.
type: llm
focus: last_message
weight: 1
---

The workspace the assistant could read holds utils.py (a short file with one function, read_config, that builds a path with os.path), two log files (app.log and debug.log) and README.md. No other file imports utils.py, and there are no tests.
PASS if the reply doesn't ask the user for facts the workspace shows: which .log files exist, what utils.py contains or does, whether other code imports it, or whether the repo has tests. Questions about choices, such as how to delete the files or how to verify the refactor, are fine. FAIL otherwise.
