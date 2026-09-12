from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from scripts import s3_artifacts


ROOT = Path(__file__).resolve().parents[1]


class FakeS3:
    def __init__(self):
        self.call = None

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.call = (operation, Params, ExpiresIn)
        return "https://signed.example.test/object"


class InfrastructureTests(unittest.TestCase):
    def test_template_blocks_public_access_and_encrypts(self):
        template = (ROOT / "infra" / "private-artifacts.yaml").read_text()
        for setting in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"):
            self.assertIn(f"{setting}: true", template)
        self.assertIn("SSEAlgorithm: AES256", template)
        self.assertIn("aws:SecureTransport: false", template)

    @mock.patch.dict(os.environ, {"YOUAN_ARTIFACT_BUCKET": "private-demo", "YOUAN_PRESIGN_TTL_SECONDS": "300"})
    def test_presigned_download_is_short_lived(self):
        client = FakeS3()
        url = s3_artifacts.create_presigned_download(client, "reports/YA-0001.pdf")
        self.assertEqual(url, "https://signed.example.test/object")
        self.assertEqual(client.call[0], "get_object")
        self.assertEqual(client.call[1], {"Bucket": "private-demo", "Key": "reports/YA-0001.pdf"})
        self.assertEqual(client.call[2], 300)

    def test_object_key_rejects_parent_traversal(self):
        with self.assertRaises(ValueError):
            s3_artifacts.validate_object_key("reports/../secret")


if __name__ == "__main__":
    unittest.main()
