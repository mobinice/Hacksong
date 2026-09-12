#!/usr/bin/env python3
"""Private S3 artifact helpers for the deployed version.

The module never accepts or stores AWS keys. boto3 uses the normal AWS credential
chain, preferably an EC2 instance role in production.
"""

from __future__ import annotations

import os
import re
from typing import Any, BinaryIO


SAFE_KEY = re.compile(r"^[a-zA-Z0-9/_\.\-]{1,240}$")


def artifact_bucket() -> str:
    bucket = os.environ.get("YOUAN_ARTIFACT_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("YOUAN_ARTIFACT_BUCKET is not configured")
    return bucket


def validate_object_key(object_key: str) -> str:
    key = str(object_key or "").strip()
    if not SAFE_KEY.fullmatch(key) or key.startswith("/") or ".." in key.split("/"):
        raise ValueError("invalid artifact object key")
    return key


def upload_private(client: Any, object_key: str, file_body: BinaryIO, content_type: str) -> None:
    """Upload an encrypted private object; bucket policy still blocks public ACLs."""
    key = validate_object_key(object_key)
    allowed = {"application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"}
    if content_type not in allowed:
        raise ValueError("unsupported artifact content type")
    client.upload_fileobj(
        file_body,
        artifact_bucket(),
        key,
        ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
    )


def create_presigned_download(client: Any, object_key: str, expires_seconds: int | None = None) -> str:
    """Return a short-lived GET URL without changing object visibility."""
    key = validate_object_key(object_key)
    ttl = int(expires_seconds or os.environ.get("YOUAN_PRESIGN_TTL_SECONDS", "300"))
    if ttl < 60 or ttl > 900:
        raise ValueError("presigned URL TTL must be between 60 and 900 seconds")
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": artifact_bucket(), "Key": key},
        ExpiresIn=ttl,
    )


def default_client() -> Any:
    import boto3  # Optional deployment dependency; not needed by the local Demo.

    return boto3.client("s3")
