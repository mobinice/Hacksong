import io
import unittest
from unittest.mock import patch
from scripts.deployment_health import check

class Response(io.BytesIO):
    status=200

class DeploymentHealthTests(unittest.TestCase):
    def test_validates_frontend_and_paginated_official_data(self):
        responses=[Response(b'assets/official-workspace.js'),Response(b'{"status":"ok"}'),Response(b'{"total":1122,"data":[{}]}')]
        with patch('scripts.deployment_health.urllib.request.urlopen',side_effect=responses):
            check('http://localhost',attempts=1)

    def test_retries_service_startup(self):
        responses=[OSError('starting'),Response(b'assets/official-workspace.js'),Response(b'{"status":"ok"}'),Response(b'{"total":1122,"data":[{}]}')]
        with patch('scripts.deployment_health.urllib.request.urlopen',side_effect=responses),patch('scripts.deployment_health.time.sleep') as sleep:
            check('http://localhost',attempts=2)
            sleep.assert_called_once_with(3)

    def test_old_frontend_does_not_pass(self):
        with patch('scripts.deployment_health.urllib.request.urlopen',return_value=Response(b'old page')):
            with self.assertRaises(RuntimeError):check('http://localhost',attempts=1)

    def test_missing_snapshot_does_not_pass(self):
        responses=[Response(b'assets/official-workspace.js'),Response(b'{"status":"ok"}'),Response(b'{"total":0,"data":[]}')]
        with patch('scripts.deployment_health.urllib.request.urlopen',side_effect=responses):
            with self.assertRaises(RuntimeError):check('http://localhost',attempts=1)
