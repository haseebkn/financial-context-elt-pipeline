"""
Tests for RawFileWriter — the landing-zone writer every extractor funnels
through. Covers the metadata envelope shape, partitioned path layout,
DateTimeEncoder's fallback behavior, and the resilience contract that an
S3 upload failure must never crash the local write.
"""

import json
from datetime import date, datetime, timezone

import pytest
from botocore.exceptions import ClientError

import load.file_writer as file_writer_module
from load.file_writer import DateTimeEncoder, RawFileWriter

# ---------------------------------------------------------------------------
# DateTimeEncoder
# ---------------------------------------------------------------------------


def test_datetime_encoder_serializes_datetime_and_date():
    payload = {
        "when": datetime(2026, 6, 15, 12, 30, 0, tzinfo=timezone.utc),
        "day": date(2026, 6, 15),
    }
    result = json.loads(json.dumps(payload, cls=DateTimeEncoder))
    assert result["when"] == "2026-06-15T12:30:00+00:00"
    assert result["day"] == "2026-06-15"


def test_datetime_encoder_falls_back_to_string_for_unknown_types():
    class Unserializable:
        def __str__(self):
            return "<unserializable-thing>"

    result = json.loads(json.dumps({"x": Unserializable()}, cls=DateTimeEncoder))
    assert result["x"] == "<unserializable-thing>"


# ---------------------------------------------------------------------------
# RawFileWriter — local write + envelope shape
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_s3_by_default(monkeypatch):
    """Default every test to offline mode unless it opts into S3 explicitly."""
    monkeypatch.setattr(file_writer_module.settings, "aws_s3_bucket", None)


def test_write_record_creates_partitioned_path_and_envelope(tmp_path):
    writer = RawFileWriter(base_dir=str(tmp_path))

    file_path = writer.write_record(
        source="plaid",
        resource="transactions",
        payload={"added": [{"transaction_id": "t1"}]},
    )

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    expected_dir = tmp_path / "plaid" / "transactions" / today
    assert expected_dir.is_dir()
    assert file_path.startswith(str(expected_dir))

    with open(file_path, encoding="utf-8") as f:
        envelope = json.load(f)

    assert envelope["metadata"]["source"] == "plaid"
    assert envelope["metadata"]["resource"] == "transactions"
    assert envelope["metadata"]["partition_date"] == today
    assert "extracted_at" in envelope["metadata"]
    assert "run_id" in envelope["metadata"]
    assert envelope["raw_payload"] == {"added": [{"transaction_id": "t1"}]}


def test_write_record_uses_explicit_partition_date(tmp_path):
    writer = RawFileWriter(base_dir=str(tmp_path))

    file_path = writer.write_record(
        source="alpaca", resource="orders", payload=[], partition_date="2026-01-15"
    )

    expected_dir = tmp_path / "alpaca" / "orders" / "2026-01-15"
    assert expected_dir.is_dir()
    assert file_path.startswith(str(expected_dir))


def test_write_record_filenames_do_not_collide(tmp_path):
    writer = RawFileWriter(base_dir=str(tmp_path))

    path1 = writer.write_record(source="plaid", resource="accounts", payload={})
    path2 = writer.write_record(source="plaid", resource="accounts", payload={})

    assert path1 != path2


def test_writer_has_no_s3_client_when_bucket_unset(tmp_path):
    writer = RawFileWriter(base_dir=str(tmp_path))
    assert writer.s3_client is None


# ---------------------------------------------------------------------------
# RawFileWriter — S3 sync resilience
# ---------------------------------------------------------------------------


class FakeS3Client:
    def __init__(self, raise_error=None):
        self._raise_error = raise_error
        self.upload_calls = []

    def upload_file(self, local_path, bucket, key):
        self.upload_calls.append((local_path, bucket, key))
        if self._raise_error:
            raise self._raise_error


def _configure_s3(monkeypatch, fake_client):
    monkeypatch.setattr(file_writer_module.settings, "aws_s3_bucket", "my-real-bucket")
    monkeypatch.setattr(file_writer_module.settings, "aws_access_key_id", "AKIAFAKE")
    monkeypatch.setattr(
        file_writer_module.settings, "aws_secret_access_key", "fake-secret"
    )
    monkeypatch.setattr(file_writer_module.boto3, "client", lambda *a, **k: fake_client)


def test_successful_s3_upload_is_attempted(tmp_path, monkeypatch):
    fake_client = FakeS3Client()
    _configure_s3(monkeypatch, fake_client)

    writer = RawFileWriter(base_dir=str(tmp_path))
    file_path = writer.write_record(source="plaid", resource="balances", payload={})

    assert len(fake_client.upload_calls) == 1
    local_path, bucket, key = fake_client.upload_calls[0]
    assert local_path == file_path
    assert bucket == "my-real-bucket"
    assert key.startswith("raw/plaid/balances/")


def test_s3_upload_failure_does_not_raise_and_local_file_survives(
    tmp_path, monkeypatch
):
    fake_client = FakeS3Client(
        raise_error=ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject")
    )
    _configure_s3(monkeypatch, fake_client)

    writer = RawFileWriter(base_dir=str(tmp_path))

    # Must not raise, despite the S3 client failing.
    file_path = writer.write_record(
        source="plaid", resource="balances", payload={"ok": True}
    )

    assert len(fake_client.upload_calls) == 1  # upload was attempted
    with open(file_path, encoding="utf-8") as f:
        envelope = json.load(f)
    assert envelope["raw_payload"] == {"ok": True}


def test_bucket_placeholder_value_disables_s3(tmp_path, monkeypatch):
    # A literal "your_bucket_name"-style placeholder must not be treated as configured.
    monkeypatch.setattr(
        file_writer_module.settings, "aws_s3_bucket", "your_s3_bucket_name"
    )
    writer = RawFileWriter(base_dir=str(tmp_path))
    assert writer.s3_client is None
