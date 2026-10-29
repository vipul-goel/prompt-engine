---
# The key is replaced by a [[placeholder]] or by an environment variable such as
# OPENAI_API_KEY; the second is the better practice in a prompt for a coding agent.
type: regex
pattern: '\[\[[^\]]*(key|token|secret)[^\]]*\]\]|\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET)\b'
weight: 1
---
