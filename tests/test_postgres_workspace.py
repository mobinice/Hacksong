"""Run against an isolated PostgreSQL schema in CI; never use deployment credentials."""
import os
import unittest
import uuid
from unittest.mock import patch
from scripts import storage_db


@unittest.skipUnless(os.environ.get('TEST_POSTGRES_DSN'), 'isolated PostgreSQL test service not configured')
class PostgreSQLWorkspaceTests(unittest.TestCase):
    def test_migrates_integer_keys_and_preserves_workspace_isolation(self):
        import psycopg2
        dsn=os.environ['TEST_POSTGRES_DSN']
        schema='test_workspace_'+uuid.uuid4().hex
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as c:c.execute('CREATE SCHEMA '+schema)
        def connect():return psycopg2.connect(dsn,options='-c search_path='+schema)
        try:
            with patch.object(storage_db,'get_rds_config',return_value={'enabled':True}), patch.object(storage_db,'get_rds_connection',side_effect=connect), patch.object(storage_db,'_auto_migrate_if_needed'):
                storage_db.init_db()
                # Reproduce the deployed legacy schema before running the migration.
                with connect() as conn:
                    with conn.cursor() as c:
                        c.execute('ALTER TABLE reviews ALTER COLUMN school_id TYPE INTEGER')
                        c.execute('ALTER TABLE cases ALTER COLUMN school_id TYPE INTEGER')
                storage_db.init_db()
                storage_db.save_state({'reviews':{'0':{'status':'demo'}}})
                key='273215967507972'
                state={'workspace':'ntpc-official-v1','reviews':{key:{'status':'待查核'}},'casework':{key:{'stage':'待處理'}}}
                # Direct RDS call ensures fallback cannot hide a database failure.
                storage_db._save_state_rds(state,state_key='ntpc_official')
                self.assertEqual(storage_db.get_state(state_key='ntpc_official')['data'],state)
                with connect() as conn:
                    with conn.cursor() as c:
                        c.execute('SELECT school_id FROM cases');self.assertEqual(c.fetchone()[0],int(key))
                storage_db.reset_db()
                self.assertTrue(storage_db.get_state(state_key='ntpc_official')['exists'])
        finally:
            with psycopg2.connect(dsn) as conn:
                with conn.cursor() as c:c.execute('DROP SCHEMA '+schema+' CASCADE')
