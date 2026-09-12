#!/usr/bin/env python3
"""Start a loopback-only preview with SQLite, regardless of inherited RDS settings."""
import argparse
import os
from pathlib import Path
import runpy
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8090)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    root = Path(__file__).resolve().parents[1]
    # Both storage and server dotenv readers preserve explicit environment values.
    os.environ.update(RDS_HOST='', DB_HOST='', HOST='127.0.0.1', PORT=str(args.port))
    sys.path.insert(0, str(root))
    print(f'Local SQLite preview: http://127.0.0.1:{args.port}/preview.html', flush=True)
    runpy.run_path(str(root / 'server.py'), run_name='__main__')


if __name__ == '__main__':
    main()
