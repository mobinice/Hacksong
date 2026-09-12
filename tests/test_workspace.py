import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import workspace_data as workspace, storage_db
from scripts.risk_engine import evaluate_school_risk, recalculate_all_schools


class WorkspaceTests(unittest.TestCase):
    def test_missing_data_never_becomes_synthetic_evidence(self):
        result=evaluate_school_risk({'id':0,'capacity':120,'complete':100})
        self.assertEqual(result['riskLevel'],'資料不足')
        self.assertEqual(result['completeness'],0)
        self.assertEqual(result['anomaliesCount'],0)
        self.assertTrue(all(e['status']=='資料不足' for e in result['evidences']))

    def test_latest_followup_supersedes_old_failure(self):
        evaluations=[{'year':'110','date':'2021-10-01','result':'基礎評鑑－部分指標通過'},
                     {'year':'110','date':'2022-03-01','result':'追蹤評鑑－全數指標通過'}]
        result=evaluate_school_risk({'evaluations':evaluations})
        self.assertEqual(result['anomaliesCount'],0)
        self.assertEqual(result['completeness'],20)
        self.assertTrue(result['isIncomplete'])
        self.assertEqual(evaluate_school_risk({'evaluationResult':'待改善'})['anomaliesCount'],1)

    def test_stable_identity_ignores_snapshot_order_and_demo_state(self):
        schools=workspace.load_workspace_schools({'reviews':{'0':{'saved':'demo'}}})
        self.assertEqual(len(schools),1122)
        self.assertEqual(len({s['id'] for s in schools}),1122)
        self.assertTrue(all(s['id']<2**48 and s['officialId'].startswith('NTPC-') for s in schools))
        result=recalculate_all_schools(schools)
        self.assertEqual(result['stats']['low'],0)
        self.assertEqual(result['stats']['hasAnomalies'],13)
        self.assertEqual(result['stats']['incomplete'],1122)

    def test_conflicting_import_is_not_used(self):
        school=workspace.load_workspace_schools()[0]
        state={'workspace':workspace.WORKSPACE,'p0':{'year':'最新快照','data':{str(school['id']):{'最新快照':{
            'penaltyCount':{'conflict':True,'chosen':'x','candidates':[{'id':'x','value':8}]}}}}}}
        result=evaluate_school_risk(workspace.load_workspace_schools(state)[0])
        self.assertFalse(result['evidences'][0]['available'])

    def test_real_review_and_case_survive_sqlite_reload(self):
        key=workspace.load_workspace_schools()[0]['id']
        state={'workspace':workspace.WORKSPACE,'reviews':{str(key):{'status':'資料不足待補充','saved':'test','owner':'測試'}},
               'casework':{str(key):{'stage':'待處理','owner':'測試','actions':[],'timeline':[]}}}
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ',{'RDS_HOST':'','DB_HOST':''}), patch.object(storage_db,'SQLITE_DB_PATH',str(Path(directory)/'test.db')):
            storage_db.init_db()
            storage_db.save_state(state)
            restored=storage_db.get_state()['data']
            self.assertEqual(restored['reviews'][str(key)]['status'],'資料不足待補充')
            self.assertEqual(restored['casework'][str(key)]['stage'],'待處理')

if __name__=='__main__':unittest.main()
