---
# D5: a prompt for code or agents names an environment variable for the key, such as
# OPENAI_API_KEY, instead of a [[placeholder]] for its value; 09 fails a key placeholder in the
# prompt. No flags, so client_secret or refresh_token don't count.
type: regex
pattern: '\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET)\b'
weight: 1
---
