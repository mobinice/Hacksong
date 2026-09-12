#!/usr/bin/env python3
"""Download NTPC registered kindergartens and MOE evaluation histories/reports.

Python standard library only. TLS verification stays enabled; --transport curl
uses the system curl trust store on hosts whose Python CA store is incomplete.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from difflib import SequenceMatcher
from hashlib import sha256
from html.parser import HTMLParser
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

BASE_DIR = Path(__file__).resolve().parents[1]
MOE_URL = 'https://ap.ece.moe.edu.tw/webecems/evaSearch.aspx'
NTPC_URL = 'https://data.ntpc.gov.tw/api/datasets/f563b4cd-b850-41f5-9709-b910f2d147e9/json'
FIELDS = {
    'name': ('園所名稱', None), 'district': ('行政區', None),
    'address': ('真實地址', None), 'type': ('設立別', None),
    'serviceType': ('新北市資料集類型（含準公共）', None),
    'telephone': ('電話', None), 'registrationNumber': ('立案字號', None),
    'capacity': ('核定招生人數', '人'), 'studentCount': ('實際在園人數', '人'),
    'monthlyFee': ('每生月費', '新臺幣／生／月'),
    'evaluations': ('評鑑歷史紀錄', None),
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def normalized(value):
    return re.sub(r'[\s\W_]+', '', unicodedata.normalize('NFKC', str(value or '')).replace('臺', '台')).casefold()


def identity(s):
    return normalized(s.get('district')), normalized(s.get('name') or s.get('title'))


def stable_id(s):
    return 'NTPC-' + sha256('|'.join(identity(s)).encode()).hexdigest()[:16]


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')
        temp = f.name
    os.replace(temp, path)


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def nodes(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.nodes(tag)

    def text(self):
        if self.tag in ('script', 'style'):
            return ''
        return ' '.join(' '.join(c.text() if isinstance(c, Node) else c for c in self.children).split())

    def by_id(self, token):
        return next((n for n in self.nodes() if token in n.attrs.get('id', '')), None)


class Document(HTMLParser):
    VOID = {'input', 'br', 'hr', 'meta', 'link', 'img', 'area', 'base', 'embed', 'param', 'source', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs)
        self.stack[-1].children.append(n)
        if tag not in self.VOID:
            self.stack.append(n)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def text_by_id(node, token):
    found = node.by_id(token)
    return found.text() if found else None


def form_fields(source):
    return {n.attrs['name']: n.attrs.get('value', '')
            for n in Document(source).root.nodes('input')
            if n.attrs.get('name', '').startswith('__')}


def get_field(name, text):
    return form_fields(text).get(name, '')


class Session:
    def __init__(self, transport='urllib', delay=0.15):
        self.transport, self.delay = transport, delay
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, url, data=None):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in {'ap.ece.moe.edu.tw', 'data.ntpc.gov.tw'}:
            raise ValueError('Only the two configured HTTPS government sources are allowed')
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        for attempt in range(3):
            time.sleep(self.delay if attempt == 0 else 2 ** attempt)
            try:
                if self.transport == 'curl':
                    cmd = ['curl', '--fail', '--silent', '--show-error', '--location',
                           '--proto', '=https', '--proto-redir', '=https', '--max-time', '40',
                           '--user-agent', 'YouanRadar/1.0 (public education data)',
                           '--referer', MOE_URL]
                    if body is not None:
                        cmd += ['--header', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-']
                    result = subprocess.run(cmd + [url], input=body, capture_output=True, timeout=45)
                    if result.returncode:
                        raise RuntimeError(result.stderr.decode(errors='replace').strip())
                    return result.stdout.decode('utf-8-sig')
                request = urllib.request.Request(url, data=body, headers={
                    'User-Agent': 'YouanRadar/1.0 (public education data)', 'Referer': MOE_URL})
                with self.opener.open(request, timeout=40) as response:
                    return response.read().decode('utf-8-sig')
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                if attempt == 2:
                    raise


def create_session(transport='urllib', delay=0.15):
    return Session(transport, delay)


def report_url(link):
    m = re.search(r"window\.open\(['\"]([^'\"]+)['\"]", link.attrs.get('onclick', ''))
    value = m[1] if m else link.attrs.get('href', '')
    absolute = urllib.parse.urljoin(MOE_URL, value)
    p = urllib.parse.urlparse(absolute)
    return absolute if p.scheme == 'https' and p.hostname == 'ap.ece.moe.edu.tw' and p.path.endswith('/eva_view.aspx') else None


def parse_schools(source, district_name=''):
    root = Document(source).root
    schools = []
    for card in root.nodes('div'):
        if 'kdCard-txt' not in card.attrs.get('class', '').split():
            continue
        name = text_by_id(card, '_lblSchName_')
        if not name:
            raise ValueError('MOE card has no school name; source format changed')
        district = text_by_id(card, '_lblArea_') or district_name
        city = text_by_id(card, '_lblCity_')
        if city and city != '新北市':
            raise ValueError('MOE returned a school outside New Taipei City')
        address_raw = text_by_id(card, '_hlAddr_')
        address = re.sub(r'\[\d{3,6}\]', '', address_raw or '').strip()
        if address and not address.startswith('新北市'):
            address = '新北市' + ('' if address.startswith(district) else district) + address
        cap = (text_by_id(card, '_lblGenStd_') or '').replace(',', '').strip()
        evaluations = []
        for row in card.nodes('tr'):
            result = text_by_id(row, '_lblResult_')
            if result is None:
                continue
            date = text_by_id(row, '_lblDate_') or text_by_id(row, '_lblFinishDate_')
            url = next((u for a in row.nodes('a') if (u := report_url(a))), None)
            evaluations.append({'year': text_by_id(row, '_lblSYear_'),
                                'date': date.replace('/', '-') if date else None,
                                'result': result, 'sourceUrl': MOE_URL, 'reportUrl': url,
                                'reportStatus': 'pending' if url else 'not_published'})
        previous = card.by_id('_lbPrev_')
        m = re.search(r"__doPostBack\('([^']+)'", previous.attrs.get('href', '')) if previous else None
        schools.append({'name': name, 'district': district, 'pubType': text_by_id(card, '_lblPub_'),
                        'address': address or None, 'addressRaw': address_raw,
                        'telephone': text_by_id(card, '_lblTel_'),
                        'capacity': int(cap) if cap.isdigit() else None,
                        'afterSchool': text_by_id(card, '_lblChildSvc_'),
                        'evaluations': evaluations,
                        'evaluationStatus': 'published' if evaluations else ('not_evaluated' if '尚未接受' in card.text() else 'not_published'),
                        'historyTarget': m[1] if m else None})
    return schools


def postback(source, district_code='', target='', **extra):
    fields = form_fields(source)
    if '__VIEWSTATE' not in fields:
        raise ValueError('Missing MOE ViewState; refusing to publish an empty dataset')
    fields.update({'__EVENTTARGET': target, '__EVENTARGUMENT': '', 'txtSchNameS': '',
                   'ddlCityS': '03', 'ddlAreaS': district_code, 'ddlEResult': ''})
    fields.update(extra)
    return fields


def merge_evaluations(*groups):
    found = {}
    for rows in groups:
        for row in rows:
            key = (row.get('year'), row.get('date'), row.get('result'))
            if key not in found or (not found[key].get('reportUrl') and row.get('reportUrl')):
                found[key] = row
    return sorted(found.values(), key=lambda e: (int(e['year']) if str(e.get('year')).isdigit() else 0, e.get('date') or '', e.get('result') or ''), reverse=True)


def fetch_district_schools(opener, district_code='', district_name='新北市', max_pages=None,
                           cache_dir=None, workers=4, include_history=True):
    """Follow actual ASP.NET next-page links; expand each school's prior history."""
    source = opener.get(MOE_URL)
    source = opener.get(MOE_URL, postback(source, district_code, btnSearch='搜尋'))
    root = Document(source).root
    total = int((text_by_id(root, 'lblTotalCount') or '0').replace(',', ''))
    page_count = int(text_by_id(root, 'lblTotalPage') or '1')
    if total == 0 and 'lblRowCnt' not in source:
        raise ValueError('MOE query did not return a recognizable result page')
    all_schools, seen = [], set()
    limit = min(page_count, max_pages) if max_pages else page_count
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for page in range(1, limit + 1):
            cache = Path(cache_dir) / f'{district_code or "all"}-{page:03d}.json' if cache_dir else None
            if cache and cache.exists():
                rows = json.loads(cache.read_text())
            else:
                if page > 1:
                    source = opener.get(MOE_URL, postback(source, district_code, 'PageControl1$lbPageChg', **{'PageControl1$txtPages': str(page)}))
                current_page = text_by_id(Document(source).root, 'lblCurrentPage')
                if current_page != str(page):
                    raise ValueError(f'MOE pagination mismatch: requested {page}, received {current_page}')
                rows = parse_schools(source, district_name)
                if not rows and total:
                    raise ValueError(f'MOE page {page} unexpectedly empty')

                def history(s):
                    if include_history and s.get('historyTarget'):
                        # Each postback carries its own ViewState. Do not share mutable cookies across workers.
                        client = create_session(opener.transport, opener.delay)
                        expanded = client.get(MOE_URL, postback(source, district_code, s['historyTarget']))
                        match = [x for x in parse_schools(expanded, district_name) if identity(x) == identity(s)]
                        if len(match) != 1:
                            raise ValueError('Could not associate expanded evaluation history with school')
                        s['evaluations'] = merge_evaluations(s['evaluations'], match[0]['evaluations'])
                    s['historyComplete'] = include_history or not s.get('historyTarget')
                    s.pop('historyTarget', None)
                    return s

                rows = list(pool.map(history, rows))
                if cache:
                    atomic_json(cache, rows)
            for s in rows:
                key = identity(s)
                if key in seen:
                    raise ValueError(f'Duplicate school across MOE pages: {s["name"]}')
                seen.add(key)
            all_schools.extend(rows)
            print(f'MOE {district_name}: page {page}/{limit}, {len(all_schools)}/{total} schools', flush=True)
    if limit == page_count and len(all_schools) != total:
        raise ValueError(f'MOE result count changed: expected {total}, got {len(all_schools)}; use a fresh cache')
    return all_schools


def fetch_ntpc(session, page_size=100):
    records, fingerprints = [], set()
    for page in range(1000):
        url = NTPC_URL + '?' + urllib.parse.urlencode({'page': page, 'size': page_size})
        batch = json.loads(session.get(url))
        if not isinstance(batch, list):
            raise ValueError('NTPC API response is not a JSON array')
        if not batch:
            if not records:
                raise ValueError('NTPC returned an empty registry')
            return records
        fingerprint = sha256(json.dumps(batch, sort_keys=True).encode()).hexdigest()
        if fingerprint in fingerprints:
            raise ValueError('NTPC repeated a page; refusing truncated/duplicated registry')
        fingerprints.add(fingerprint)
        for row in batch:
            if not isinstance(row, dict) or not all(row.get(k) for k in ('title', 'district', 'address', 'type')):
                raise ValueError('NTPC registry field format changed')
        records.extend(batch)
        print(f'NTPC page {page}: {len(records)} schools', flush=True)
    raise ValueError('NTPC pagination exceeded safety limit')


def parse_report(source, url, school_name):
    root = Document(source).root
    tables = []
    for table in root.nodes('table'):
        rows = []
        for row in table.nodes('tr'):
            cells = [n for n in row.children if isinstance(n, Node) and n.tag in ('td', 'th')]
            if cells:
                rows.append([{'text': c.text(), 'rowSpan': int(c.attrs.get('rowspan', 1)),
                              'colSpan': int(c.attrs.get('colspan', 1)), 'header': c.tag == 'th'} for c in cells])
        if rows:
            tables.append(rows)
    text = root.text()
    if normalized(school_name) not in normalized(text) or '評鑑' not in text or not tables:
        raise ValueError('Report does not identify the expected school or has no evaluation table')
    return {'schoolName': school_name, 'sourceUrl': url, 'retrievedAt': utc_now(),
            'format': 'html_table', 'tables': tables, 'text': text}


def download_reports(schools, session, output, workers=4, refresh=False):
    jobs = [(s, e) for s in schools for e in s['evaluations'] if e.get('reportUrl')]
    def download(job):
        s, e = job
        key = sha256(json.dumps([identity(s), e['year'], e['date'], e['result']], ensure_ascii=False).encode()).hexdigest()[:24]
        path = Path(output) / 'reports' / (key + '.json')
        try:
            if path.exists() and not refresh:
                report = json.loads(path.read_text())
                if report['schoolName'] != s['name'] or not report.get('tables'):
                    raise ValueError('Cached report identity mismatch')
            else:
                client = create_session(session.transport, session.delay)
                report = parse_report(client.get(e['reportUrl']), e['reportUrl'], s['name'])
                atomic_json(path, report)
            e.update(reportStatus='downloaded', reportPath='data/reports/' + path.name)
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            e.update(reportStatus='failed', reportError=str(exc))
        return e['reportStatus']
    counts = Counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, status in enumerate(pool.map(download, jobs), 1):
            counts[status] += 1
            if i % 50 == 0 or i == len(jobs):
                print(f'Reports {i}/{len(jobs)}: {dict(counts)}', flush=True)
    return dict(counts)


def integrate_schools(registry, moe_schools):
    """Conservative exact name+district matching, never fuzzy auto-merging branches."""
    index = defaultdict(list)
    for m in moe_schools:
        index[identity(m)].append(m)
    used, result = set(), []
    for r in registry:
        key = identity(r)
        candidates = index[key]
        m = candidates[0] if len(candidates) == 1 else None
        if m:
            used.add(key)
        result.append(format_school(r, m, 'matched' if m else 'ambiguous' if candidates else 'unmatched'))
    for key, candidates in index.items():
        if key not in used:
            for m in candidates:
                result.append(format_school(None, m, 'moe_only'))
    ids = [s['id'] for s in result]
    if len(ids) != len(set(ids)):
        raise ValueError('Ambiguous duplicate school identity; resolve source records before publishing')
    return sorted(result, key=lambda s: (s['district'], s['name'], s['id']))


def format_school(registry, moe, match_status):
    r, m = registry or {}, moe or {}
    name, district = r.get('title') or m.get('name'), r.get('district') or m.get('district')
    service_type = r.get('type')
    school_type = m.get('pubType') or (service_type if service_type in ('公立', '私立', '非營利') else None)
    address = re.sub(r'\[\d{3,6}\]', '', r.get('address') or m.get('address') or '').strip() or None
    s = {'name': name, 'district': district, 'city': '新北市', 'type': school_type,
         'serviceType': service_type, 'address': address,
         'telephone': r.get('tel') or m.get('telephone'), 'areaCode': r.get('areacode'),
         'postalCode': r.get('zipcode'), 'capacity': m.get('capacity'),
         'registrationNumber': None, 'studentCount': None, 'monthlyFee': None, 'tuition': None,
         'coordinates': None, 'afterSchool': m.get('afterSchool'),
         'evaluations': [dict(e, sourceSchoolName=m.get('name')) for e in merge_evaluations(m.get('evaluations', []))],
         'evaluationStatus': m.get('evaluationStatus', 'unmatched'),
         'historyComplete': m.get('historyComplete', False), 'matchStatus': match_status,
         'registryStatus': 'listed' if registry else 'not_matched',
         'totalScore': None, 'riskLevel': 'incomplete', 'scores': {},
         'keyFactors': [], 'aiChecklist': [], 'dataKind': 'official',
         'sources': [], 'fieldMetadata': {}}
    s['id'] = stable_id(s)
    s['schoolId'] = s['id']
    if registry:
        s['sources'].append({'id': 'ntpc', 'url': NTPC_URL, 'record': r})
    if moe:
        s['sources'].append({'id': 'moe', 'url': MOE_URL,
                             'record': {k: m.get(k) for k in ('name', 'district', 'addressRaw', 'pubType', 'telephone', 'capacity')}})
    for field, (label, unit) in FIELDS.items():
        value = s[field]
        source = 'moe' if field in ('capacity', 'evaluations') or (field == 'type' and m.get('pubType')) else ('ntpc' if registry else 'moe')
        missing = value is None or value == '' or value == []
        note = None
        if field in ('registrationNumber', 'monthlyFee', 'studentCount'):
            note = '本次兩個公開來源未提供此欄位；未推估或以 0 代替。'
        elif field == 'evaluations' and missing:
            note = {'not_evaluated': '來源明示尚未接受評鑑。', 'unmatched': '尚未精確配對教育部園所；不代表未受評。'}.get(s['evaluationStatus'], '來源沒有公布評鑑紀錄。')
        elif missing:
            note = '來源未提供或尚未配對。'
        s['fieldMetadata'][field] = {'label': label, 'unit': unit,
                                    'status': 'missing' if missing else 'available',
                                    'source': None if missing else source, 'note': note}
    s['completeness'] = round(sum(x['status'] == 'available' for x in s['fieldMetadata'].values()) / len(FIELDS) * 100)
    return s


def enrich_risk_metrics(schools):
    """Compatibility for crawl-live: official fields only, no fabricated risk scores."""
    return [format_school(None, s, 'moe_only') for s in schools]


def generate_insights(schools):
    evaluated = sum(bool(s['evaluations']) for s in schools)
    return {'summary': {'totalInstitutions': len(schools), 'evaluatedInstitutions': evaluated,
                        'institutionsWithoutPublishedHistory': len(schools) - evaluated},
            'districts': dict(Counter(s['district'] for s in schools)),
            'types': dict(Counter(s['type'] or '未提供' for s in schools)),
            'matching': dict(Counter(s['matchStatus'] for s in schools)),
            'missingFields': {k: sum(s.get(k) is None for s in schools) for k in ('registrationNumber', 'capacity', 'monthlyFee')},
            'keyFindings': [], 'notice': '僅統計公開資料；資料缺漏不代表低風險，未推估財務或輿情分數。'}


def query_schools(schools, query):
    def first(k, default=''):
        return query.get(k, [default])[0]
    try:
        page, size = int(first('page', '0')), int(first('size', '25'))
    except (TypeError, ValueError):
        raise ValueError('page 與 size 必須是整數') from None
    if page < 0 or not 1 <= size <= 100:
        raise ValueError('page 必須 >= 0；size 必須介於 1–100')
    q = normalized(first('q').strip())
    if len(q) > 100:
        raise ValueError('搜尋字串最多 100 字')
    district, kind = first('district'), first('type')
    rows = sorted(schools, key=lambda s: (s['district'], s['name'], s['id']))
    if district:
        rows = [s for s in rows if s['district'] == district]
    if kind:
        rows = [s for s in rows if kind in (s.get('type'), s.get('serviceType'))]
    if q:
        def rank(s):
            name = normalized(s['name'])
            fields = [name, normalized(s['address']), normalized(s['district']), normalized(s.get('registrationNumber'))]
            if any(q in v for v in fields):
                return 2
            # Ordered partial name and one-character typo windows, only for search (never entity merging).
            it = iter(name)
            if all(any(c == n for n in it) for c in q):
                return 1
            if len(q) >= 3:
                return max((SequenceMatcher(None, q, name[i:i+len(q)]).ratio() for i in range(max(1, len(name)-len(q)+1))), default=0)
            return 0
        scored = [(rank(s), s) for s in rows]
        rows = [s for score, s in sorted(scored, key=lambda item: -item[0]) if score >= 0.75]
    total = len(rows)
    return {'data': rows[page*size:(page+1)*size], 'page': page, 'size': size, 'total': total,
            'totalPages': (total+size-1)//size, 'hasNext': (page+1)*size < total,
            'districts': sorted({s['district'] for s in schools}),
            'filters': {'q': first('q'), 'district': district, 'type': kind}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=BASE_DIR / 'data')
    parser.add_argument('--cache-dir', type=Path, default=BASE_DIR / '.cache' / 'crawl-moe')
    parser.add_argument('--transport', choices=('urllib', 'curl'), default='urllib')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--max-pages', type=int, help='Development sample only; writes sample_schools.json')
    parser.add_argument('--skip-reports', action='store_true')
    parser.add_argument('--refresh-reports', action='store_true', help='Redownload previously saved reports')
    args = parser.parse_args()
    if args.max_pages is not None and args.max_pages < 1:
        parser.error('--max-pages must be positive')
    started = utc_now()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    session = create_session(args.transport)
    registry_path = args.cache_dir / 'ntpc.json'
    if registry_path.exists():
        registry = json.loads(registry_path.read_text())
    else:
        registry = fetch_ntpc(session)
        atomic_json(registry_path, registry)
    moe = fetch_district_schools(session, max_pages=args.max_pages, cache_dir=args.cache_dir / 'moe-pages', workers=args.workers)
    reports = {} if args.skip_reports else download_reports(moe, session, args.output_dir, args.workers, args.refresh_reports)
    schools = integrate_schools(registry, moe)
    insights = generate_insights(schools)
    page_files = list((args.cache_dir / 'moe-pages').glob('*.json'))
    def file_time(path):
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')
    source_times = {'ntpc': {'cachedAt': file_time(registry_path)},
                    'moe': {'firstPageCachedAt': min(map(file_time, page_files)),
                            'lastPageCachedAt': max(map(file_time, page_files))}}
    metadata = {'schemaVersion': 1, 'retrievedAt': source_times['moe']['lastPageCachedAt'],
                'generatedAt': utc_now(), 'sourceSnapshots': source_times, 'runStartedAt': started,
                'registryCount': len(registry), 'moeCount': len(moe), 'schoolCount': len(schools),
                'reportDownloads': reports, 'partial': bool(args.max_pages),
                'evaluationCount': sum(len(s['evaluations']) for s in schools),
                'reportsNotPublished': sum(e.get('reportStatus') == 'not_published' for s in schools for e in s['evaluations']),
                'sources': [NTPC_URL, MOE_URL], 'matching': insights['matching'],
                'fieldDefinitions': {k: {'label': v[0], 'unit': v[1]} for k, v in FIELDS.items()},
                'notice': '名錄與評鑑資料以行政區及標準化全名精確配對；未配對資料保留。空值不是 0 或安全認定。'}
    prefix = 'sample_' if args.max_pages else ''
    atomic_json(args.output_dir / (prefix + 'real_schools.json'), schools)
    atomic_json(args.output_dir / (prefix + 'moe_insights.json'), insights)
    atomic_json(args.output_dir / (prefix + 'crawl_metadata.json'), metadata)
    print(json.dumps(metadata, ensure_ascii=False, indent=2), flush=True)
    if reports.get('failed'):
        raise SystemExit('Some reports failed; dataset marks failures. Rerun with the same cache to retry.')


if __name__ == '__main__':
    main()
