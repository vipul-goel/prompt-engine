#!/usr/bin/env bash
set -eu
# A file at the save path that the recorded menu offers, which the save must not overwrite.
mkdir -p prompts
printf 'ORIGINAL-SENTINEL\n' > prompts/etsy-mug-description.md
