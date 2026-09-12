#!/usr/bin/env python3
"""Verify frontend and API readiness through Nginx, with bounded startup retries."""
import argparse
import json
import time
import urllib.request


def check(base_url, attempts=12, delay=3, timeout=5):
    base_url=base_url.rstrip('/')
    last_error=None
    for attempt in range(1,attempts+1):
        try:
            def fetch(path):
                with urllib.request.urlopen(base_url+path,timeout=timeout) as response:
                    if response.status!=200:
                        raise ValueError(f'{path}: HTTP {response.status}')
                    return response.read().decode('utf-8')
            frontend=fetch('/preview.html')
            if 'assets/youan-p0.js' not in frontend:
                raise ValueError('Frontend does not include the risk demo')
            health=json.loads(fetch('/api/health'))
            if health.get('status')!='ok':
                raise ValueError('API is not healthy')
            schools=json.loads(fetch('/api/schools?page=0&size=1'))
            if not isinstance(schools,dict) or schools.get('total',0)<1 or len(schools.get('data',[]))!=1:
                raise ValueError('Official school snapshot is unavailable')
            print(f'Frontend and API healthy; {schools["total"]} official records',flush=True)
            return
        except (OSError,ValueError,TypeError) as error:
            last_error=error
            print(f'Readiness attempt {attempt}/{attempts}: {error}',flush=True)
            if attempt<attempts:time.sleep(delay)
    raise RuntimeError(f'Deployment did not become ready: {last_error}')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1')
    args=parser.parse_args()
    check(args.base_url)
