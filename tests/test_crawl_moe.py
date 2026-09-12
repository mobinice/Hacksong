import json
from pathlib import Path
import tempfile
import unittest

from scripts.crawl_moe import (MOE_URL, atomic_json, fetch_district_schools, fetch_ntpc,
    format_school, integrate_schools, merge_evaluations, parse_report, parse_schools, query_schools)

FIXTURES = Path(__file__).parent / 'fixtures'


class CrawlTests(unittest.TestCase):
    def setUp(self):
        self.card = (FIXTURES / 'moe_school.html').read_text()
        self.moe = parse_schools(self.card)[0]
        self.registry = {'title': self.moe['name'], 'district': '萬里區', 'type': '公立',
                         'address': '[207]新北市萬里區瑪鋉路221號2樓', 'tel': '(02)24921670',
                         'areacode': '65000280', 'zipcode': '207'}

    def test_actual_page_extracts_dates_capacity_and_report(self):
        self.assertEqual(self.moe['capacity'], 105)
        self.assertEqual(self.moe['address'], '新北市萬里區瑪鋉路221號2樓')
        self.assertEqual(self.moe['evaluations'][0]['date'], '2023-10-04')
        self.assertIn('/dtl/eva_view.aspx?', self.moe['evaluations'][0]['reportUrl'])
        self.assertEqual(self.moe['historyTarget'], 'GridView1$ctl02$lbPrev')

    def test_missing_capacity_is_not_defaulted_to_sixty(self):
        card = self.card.replace('lblGenStd_0">105', 'lblGenStd_0">未提供')
        self.assertIsNone(parse_schools(card)[0]['capacity'])

    def test_history_merge_keeps_followup_and_deduplicates(self):
        recent = {'year': '112', 'date': '2023-10-04', 'result': '基礎評鑑－部分指標通過', 'reportUrl': None}
        prior = {'year': '109', 'date': '2020-10-01', 'result': '基礎評鑑－全數指標通過'}
        follow = {'year': '112', 'date': '2024-01-01', 'result': '追蹤評鑑－全數指標通過'}
        merged = merge_evaluations([recent], [prior, recent, follow])
        self.assertEqual(len(merged), 3)
        self.assertEqual(merged[0], follow)

    def test_report_preserves_checkmarks_columns_and_school_identity(self):
        report = parse_report((FIXTURES / 'moe_report.html').read_text(), MOE_URL, self.moe['name'])
        self.assertIn('1.1.1', report['text'])
        self.assertIn('免檢核', report['text'])
        self.assertTrue(any(c['text'] == 'V' for t in report['tables'] for r in t for c in r))
        self.assertTrue(any(c['rowSpan'] > 1 for t in report['tables'] for r in t for c in r))
        with self.assertRaises(ValueError):
            parse_report((FIXTURES / 'moe_report.html').read_text(), MOE_URL, '另一間幼兒園')

    def test_official_values_are_not_synthetic_scores_or_fees(self):
        school = integrate_schools([self.registry], [self.moe])[0]
        self.assertEqual(school['matchStatus'], 'matched')
        for key in ('monthlyFee', 'registrationNumber', 'studentCount', 'totalScore', 'coordinates'):
            self.assertIsNone(school[key])
        self.assertEqual(school['fieldMetadata']['monthlyFee']['status'], 'missing')
        self.assertEqual(school['fieldMetadata']['capacity']['source'], 'moe')

    def test_id_stable_across_reordering_and_no_branch_fuzzy_merge(self):
        branch = dict(self.moe, name=self.moe['name']+'分班')
        first = integrate_schools([self.registry], [self.moe, branch])
        second = integrate_schools([self.registry], [branch, self.moe])
        self.assertEqual([s['id'] for s in first], [s['id'] for s in second])
        self.assertEqual(len(first), 2)
        self.assertEqual(sum(s['matchStatus'] == 'matched' for s in first), 1)

    def test_quasi_public_is_separate_from_ownership(self):
        r = dict(self.registry, type='準公共')
        m = dict(self.moe, pubType='私立')
        s = integrate_schools([r], [m])[0]
        self.assertEqual((s['type'], s['serviceType']), ('私立', '準公共'))

    def test_normalized_name_match_preserves_report_source_name(self):
        r = dict(self.registry, title=self.registry['title']+'（委託甲協會辦理）')
        m = dict(self.moe, name=self.moe['name']+'(委託甲協會辦理)')
        s = integrate_schools([r], [m])[0]
        self.assertEqual(s['matchStatus'], 'matched')
        self.assertEqual(s['name'], r['title'])
        self.assertEqual(s['evaluations'][0]['sourceSchoolName'], m['name'])

    def test_unmatched_does_not_mean_unevaluated(self):
        s = integrate_schools([self.registry], [])[0]
        self.assertEqual(s['evaluationStatus'], 'unmatched')
        self.assertIn('不代表未受評', s['fieldMetadata']['evaluations']['note'])

    def test_duplicate_registry_fails_before_publication(self):
        with self.assertRaises(ValueError):
            integrate_schools([self.registry, self.registry], [self.moe])

    def test_ntpc_fetch_follows_zero_based_pages_until_empty(self):
        class Fake:
            def __init__(self): self.urls=[]
            def get(inner, url):
                inner.urls.append(url)
                return json.dumps([dict(self.registry, title=str(len(inner.urls)))]) if len(inner.urls)<3 else '[]'
        client=Fake()
        self.assertEqual(len(fetch_ntpc(client)), 2)
        self.assertIn('page=2&size=100', client.urls[-1])

    def test_ntpc_repeated_page_is_error(self):
        class Fake:
            def get(inner, url): return json.dumps([self.registry])
        with self.assertRaises(ValueError): fetch_ntpc(Fake())

    def test_moe_uses_current_pager_and_fetches_every_page(self):
        card2=self.card.replace(self.moe['name'], self.moe['name']+'分班')
        def response(page, card):
            return f'<input name="__VIEWSTATE" value="x"><span id="PageControl1_lblTotalCount">2</span><span id="PageControl1_lblTotalPage">2</span><span id="PageControl1_lblCurrentPage">{page}</span>'+card
        class Fake:
            transport='urllib';delay=0
            def __init__(inner):inner.posts=[]
            def get(inner, url, data=None):
                if data:inner.posts.append(data)
                page=2 if data and data.get('PageControl1$txtPages')=='2' else 1
                return response(page, card2 if page==2 else self.card)
        client=Fake()
        rows=fetch_district_schools(client, include_history=False)
        self.assertEqual(len(rows),2)
        self.assertEqual(client.posts[-1]['__EVENTTARGET'],'PageControl1$lbPageChg')
        self.assertEqual(client.posts[-1]['ddlCityS'],'03')

    def test_failed_pager_is_not_published_as_complete(self):
        response='<input name="__VIEWSTATE" value="x"><span id="PageControl1_lblTotalCount">2</span><span id="PageControl1_lblTotalPage">2</span><span id="PageControl1_lblCurrentPage">1</span>'+self.card
        class Fake:
            def get(inner,*args):return response
        with self.assertRaises(ValueError):fetch_district_schools(Fake(),include_history=False)

    def test_empty_or_wrong_city_page_is_rejected(self):
        with self.assertRaises(ValueError):parse_schools(self.card.replace('lblCity_0">新北市','lblCity_0">臺北市'))
        class Fake:
            def get(inner,*args):return '<html>maintenance</html>'
        with self.assertRaises(ValueError):fetch_district_schools(Fake())

    def test_query_pagination_filter_partial_typo_and_empty(self):
        rows=[]
        for name,district in [('新北市私立快樂幼兒園','板橋區'),('新北市私立幸福幼兒園','三重區'),('新北市立板橋幼兒園','板橋區')]:
            rows.append(format_school(dict(self.registry,title=name,district=district), None, 'unmatched'))
        result=query_schools(rows,{'district':['板橋區'],'page':['0'],'size':['1']})
        self.assertEqual(result['total'],2)
        self.assertTrue(result['hasNext'])
        self.assertEqual(len(query_schools(rows,{'district':['板橋區'],'page':['1'],'size':['1']})['data']),1)
        self.assertEqual(query_schools(rows,{'q':['快樂']})['total'],1)
        self.assertEqual(query_schools(rows,{'q':['快樂幼而園']})['total'],1)
        self.assertEqual(query_schools(rows,{'q':['不存在的搜尋']})['total'],0)
        self.assertEqual(query_schools(rows,{'page':['99']})['data'],[])
        for params in ({'page':['-1']},{'size':['0']},{'size':['101']},{'page':['1.5']}):
            with self.assertRaises(ValueError): query_schools(rows, params)

    def test_atomic_json_replaces_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'records.json';atomic_json(path,[1]);atomic_json(path,[2])
            self.assertEqual(json.loads(path.read_text()),[2])


if __name__=='__main__':unittest.main()
