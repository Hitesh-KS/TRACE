from datetime import datetime, timedelta, timezone
from typing import BinaryIO

import boto3
from botocore.exceptions import BotoCoreError
from botocore.config import Config as BotoConfig

from app.config import Settings


class StorageUnavailable(RuntimeError):
    pass


class ObjectStorage:
    def __init__(self, settings: Settings):
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=BotoConfig(s3={"addressing_style": "path"}),
        )
        self.bucket = settings.s3_bucket
        self.lock_mode = settings.object_lock_mode
        self.retention_days = settings.object_retention_days

    def put(
        self,
        *,
        key: str,
        body: BinaryIO,
        content_length: int,
        content_type: str,
    ) -> str:
        retained_until = datetime.now(timezone.utc) + timedelta(days=self.retention_days)
        try:
            response = self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentLength=content_length,
                ContentType=content_type,
                ObjectLockMode=self.lock_mode,
                ObjectLockRetainUntilDate=retained_until,
            )
        except BotoCoreError as exc:
            raise StorageUnavailable("Object upload failed") from exc
        version_id = response.get("VersionId")
        if not version_id:
            raise RuntimeError("Object storage did not return a version ID")
        return version_id

    def get(self, *, key: str, version_id: str) -> BinaryIO:
        try:
            response = self.client.get_object(
                Bucket=self.bucket, Key=key, VersionId=version_id
            )
        except BotoCoreError as exc:
            raise StorageUnavailable("Object read failed") from exc
        return response["Body"]

    def delete(self, *, key: str, version_id: str) -> None:
        try:
            self.client.delete_object(
                Bucket=self.bucket, Key=key, VersionId=version_id
            )
        except BotoCoreError as exc:
            raise StorageUnavailable("Object deletion failed") from exc
