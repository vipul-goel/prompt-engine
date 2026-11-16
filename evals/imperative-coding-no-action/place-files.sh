#!/usr/bin/env bash
set -eu
cat > utils.py <<'EOF'
import os

def read_config(name):
    path = os.path.join(os.path.dirname(__file__), "config", name)
    with open(path) as f:
        return f.read()
EOF
printf 'started\n' > app.log
printf 'debug line\n' > debug.log
printf '# Demo app\n' > README.md
