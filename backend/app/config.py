import os
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    api_token: str
    actor_id: str
    database_url: str
    s3_endpoint_url: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket: str
    s3_region: str
    object_lock_mode: str
    object_retention_days: int
    max_upload_bytes: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_token=os.getenv("TRACE_API_TOKEN", ""),
            actor_id=os.getenv(
                "TRACE_ACTOR_ID", "00000000-0000-4000-8000-000000000001"
            ),
            database_url=os.getenv(
                "DATABASE_URL",
                "postgresql+psycopg://trace:trace-dev-password@localhost:5432/trace",
            ),
            s3_endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://localhost:9000"),
            s3_access_key=os.getenv("S3_ACCESS_KEY", ""),
            s3_secret_key=os.getenv("S3_SECRET_KEY", ""),
            s3_bucket=os.getenv("S3_BUCKET", "evidence"),
            s3_region=os.getenv("S3_REGION", "us-east-1"),
            object_lock_mode=os.getenv("OBJECT_LOCK_MODE", "COMPLIANCE").upper(),
            object_retention_days=int(os.getenv("OBJECT_RETENTION_DAYS", "365")),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024**3))),
        )

    def validate(self) -> None:
        if len(self.api_token) < 32 or self.api_token.startswith("replace-"):
            raise RuntimeError("TRACE_API_TOKEN must contain at least 32 characters")
        try:
            uuid.UUID(self.actor_id)
        except ValueError as exc:
            raise RuntimeError("TRACE_ACTOR_ID must be a UUID") from exc
        if self.object_lock_mode not in {"GOVERNANCE", "COMPLIANCE"}:
            raise RuntimeError("OBJECT_LOCK_MODE must be GOVERNANCE or COMPLIANCE")
        if self.object_retention_days < 1:
            raise RuntimeError("OBJECT_RETENTION_DAYS must be positive")
        if self.max_upload_bytes < 1:
            raise RuntimeError("MAX_UPLOAD_BYTES must be positive")
