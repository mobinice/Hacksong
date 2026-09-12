#!/usr/bin/env python3
"""Small dependency-free safety scan for this hackathon repository."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {".git", "vendor", "__pycache__"}
SKIP_FILES = {Path(__file__).name}
TEXT_SUFFIXES = {".py", ".js", ".html", ".css", ".md", ".yml", ".yaml", ".json", ".toml", ".sh", ".env"}
PATTERNS = {
    "possible AWS access key": re.compile("AK" + r"IA[0-9A-Z]{16}"),
    "private key material": re.compile("BEGIN " + r"(?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "TLS certificate verification disabled": re.compile(r"(?:CERT_NONE|check_hostname\s*=\s*False)"),
    "wildcard CORS response": re.compile(r"Access-Control-Allow-Origin[^\n]{0,30}['\"]\*['\"]"),
}


def main() -> int:
    findings: list[str] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.name in SKIP_FILES or any(part in SKIP_PARTS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name != ".env.example":
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for name, pattern in PATTERNS.items():
            for match in pattern.finditer(content):
                line = content.count("\n", 0, match.start()) + 1
                findings.append(f"{path.relative_to(ROOT)}:{line}: {name}")
    if findings:
        print("Security scan failed:")
        print("\n".join(findings))
        return 1
    print("Security scan passed: no embedded credentials, disabled TLS checks, or wildcard CORS found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
