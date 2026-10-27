import os

import boto3
from botocore.exceptions import ClientError

bucket = os.getenv("S3_BUCKET", "evidence")
client = boto3.client(
    "s3",
    endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://rustfs:9000"),
    aws_access_key_id=os.getenv("S3_ACCESS_KEY", ""),
    aws_secret_access_key=os.getenv("S3_SECRET_KEY", ""),
    region_name=os.getenv("S3_REGION", "us-east-1"),
)

try:
    client.create_bucket(
        Bucket=bucket,
        ObjectLockEnabledForBucket=True,
    )
except ClientError as exc:
    if exc.response["Error"]["Code"] not in {
        "BucketAlreadyExists",
        "BucketAlreadyOwnedByYou",
    }:
        raise
    lock_config = client.get_object_lock_configuration(Bucket=bucket)
    if lock_config.get("ObjectLockConfiguration", {}).get("ObjectLockEnabled") != "Enabled":
        raise RuntimeError("Existing object bucket was created without Object Lock") from exc

client.put_bucket_versioning(
    Bucket=bucket,
    VersioningConfiguration={"Status": "Enabled"},
)
print(f"Initialized versioned Object Lock bucket: {bucket}")
