import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import server
from scripts.crawl_moe import format_school


class APITests(unittest.TestCase):
    def test_handler_paginates_and_returns_400_for_invalid_query(self):
        # Exercise the real handler's routing and JSON serializer without opening a socket.
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)/'data';data.mkdir()
            schools=[format_school({'title': '新北市私立快樂幼兒園', 'district': '板橋區', 'type': '私立', 'address': '新北市板橋區幸福路1號'}, None, 'unmatched')]
            (data/'real_schools.json').write_text(json.dumps(schools))
            (data/'crawl_metadata.json').write_text('{"partial": false}')
            for path,expected in [('/api/schools?page=0&size=1',200),('/api/schools?size=101',400),('/api/schools?format=legacy',200),('/api/schools?mode=demo',200)]:
                handler=object.__new__(server.RadarAPIHandler)
                handler.command="GET";handler._allow_request=lambda:True;handler.path=path;handler.wfile=io.BytesIO();status=[]
                handler.send_response=status.append
                handler.send_header=lambda *args: None
                handler.end_headers=lambda: None
                with patch.object(server, 'BASE_DIR', Path(directory)):handler.do_GET()
                self.assertEqual(status,[expected])
                payload=json.loads(handler.wfile.getvalue())
                if 'size=1' in path and expected==200:
                    self.assertEqual(payload['total'],1)
                    self.assertEqual(payload['data'][0]['name'],schools[0]['name'])
                if 'legacy' in path:self.assertIsInstance(payload,list)
                if 'demo' in path:self.assertEqual(payload['status'],'use_demo')

    def test_missing_snapshot_is_service_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            handler=object.__new__(server.RadarAPIHandler)
            handler.command='GET';handler._allow_request=lambda:True;handler.path='/api/workspace';handler.wfile=io.BytesIO();status=[]
            handler.send_response=status.append;handler.send_header=lambda *args: None;handler.end_headers=lambda: None
            with patch('server.load_workspace_schools',side_effect=OSError):handler.do_GET()
            self.assertEqual(status,[503])
