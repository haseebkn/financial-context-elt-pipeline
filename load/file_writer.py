import os
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict
import structlog
import boto3
from botocore.exceptions import ClientError

logger = structlog.get_logger("file_writer")

class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle date, datetime, and other custom types gracefully."""
    def default(self, obj):
        from datetime import date, datetime
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        try:
            return super().default(obj)
        except TypeError:
            # Fallback to string representation to prevent crashes (resilience)
            return str(obj)

class RawFileWriter:
    """
    Handles writing raw API responses to the local landing zone (mock S3 bucket)
    and synchronizes them to an actual AWS S3 bucket if configured.
    Enforces the ELT pattern by capturing raw payloads wrapped in a metadata envelope.
    """

    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)
        
        # Read AWS S3 details from environment variables
        self.s3_bucket = os.getenv("AWS_S3_BUCKET")
        self.s3_client = None
        
        # Initialize AWS S3 Client if credentials are provided
        if self.s3_bucket and not self.s3_bucket.startswith("your_"):
            try:
                self.s3_client = boto3.client(
                    "s3",
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                    region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1")
                )
                logger.info("Successfully initialized AWS S3 Client for data lake sync", bucket=self.s3_bucket)
            except Exception as e:
                logger.warning(
                    "Failed to initialize S3 client. Pipeline will run in offline-local mode.",
                    error=str(e)
                )

    def _upload_to_s3(self, local_file_path: str, s3_key: str):
        """Helper to upload a local file to S3 bucket resiliently."""
        if not self.s3_client:
            return
            
        try:
            logger.info("Uploading raw record to AWS S3 data lake...", bucket=self.s3_bucket, key=s3_key)
            self.s3_client.upload_file(local_file_path, self.s3_bucket, s3_key)
            logger.info("Successfully synced record to AWS S3 data lake", bucket=self.s3_bucket, key=s3_key)
        except ClientError as e:
            # Enforce resilience standard: do not crash if cloud storage uploads fail
            logger.error(
                "AWS S3 Upload failed (ClientError). Record remains safe in local storage.",
                bucket=self.s3_bucket,
                key=s3_key,
                error=str(e)
            )
        except Exception as e:
            logger.error(
                "AWS S3 Upload failed (General Exception). Record remains safe in local storage.",
                bucket=self.s3_bucket,
                key=s3_key,
                error=str(e)
            )

    def write_record(self, source: str, resource: str, payload: Any, partition_date: str = None) -> str:
        """
        Wraps the raw payload in a metadata envelope and writes it to a partitioned directory.
        If S3 is configured, also uploads the file to the S3 bucket.
        
        Local path: {base_dir}/{source}/{resource}/{partition_date}/
        S3 Key: raw/{source}/{resource}/{partition_date}/{filename}
        """
        now = datetime.now(timezone.utc)
        
        if not partition_date:
            partition_date = now.strftime("%Y-%m-%d")

        # Metadata Envelope configuration
        envelope: Dict[str, Any] = {
            "metadata": {
                "extracted_at": now.isoformat(),
                "source": source,
                "resource": resource,
                "run_id": str(uuid.uuid4()),
                "partition_date": partition_date
            },
            "raw_payload": payload
        }

        # Setup destination directory
        target_dir = os.path.join(self.base_dir, source, resource, partition_date)
        os.makedirs(target_dir, exist_ok=True)

        # Unique filename using timestamp + uuid to prevent collisions (idempotency safety)
        timestamp = now.strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        filename = f"{resource}_{timestamp}_{unique_id}.json"
        file_path = os.path.join(target_dir, filename)

        try:
            # 1. Write file locally
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(envelope, f, indent=2, ensure_ascii=False, cls=DateTimeEncoder)
            
            logger.info(
                "Successfully wrote raw landing record locally",
                source=source,
                resource=resource,
                partition_date=partition_date,
                file_path=file_path
            )
            
            # 2. Upload file to AWS S3 if client is active
            if self.s3_client:
                s3_key = f"raw/{source}/{resource}/{partition_date}/{filename}"
                self._upload_to_s3(file_path, s3_key)
                
            return file_path
        except Exception as e:
            logger.error(
                "Failed writing raw landing record",
                source=source,
                resource=resource,
                file_path=file_path,
                error=str(e)
            )
            raise e
