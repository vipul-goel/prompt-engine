---
# The key is replaced by a [[placeholder]] that names a key, token or secret (the word ends
# the placeholder, or it says API key; snake_case such as [[your_api_key]] counts), or by an
# environment variable such as OPENAI_API_KEY; the second is the better practice in a prompt
# for a coding agent. No flags: the env-var branch stays upper case, so client_secret or
# refresh_token don't count.
type: regex
pattern: '\[\[[^\]\n]*(?:\b|_)([Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])\]\]|\[\[[^\]\n]*(?:\b|_)[Aa][Pp][Ii][ _-]?[Kk][Ee][Yy](?:\b|_)[^\]\n]*\]\]|\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET)\b'
weight: 1
---
