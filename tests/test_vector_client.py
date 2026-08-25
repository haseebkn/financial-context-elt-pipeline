"""
Tests for LocalVectorClient's collection-metric handling.

Regression cover for a silent bug: ChromaDB applies the `metadata` passed to
get_or_create_collection only when it actually creates the collection. For an
existing collection it returns it unchanged and ignores the requested
"hnsw:space". The client logged "cosine" unconditionally, so a store that had
been created under l2 kept serving l2 distances while every log line claimed
cosine — and retrieval_service's `similarity = 1 - distance` turned good
matches into negative scores, which the agent then sees in its tool results.

These tests assert the client reports the metric the collection actually has,
and warns when that isn't cosine.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vector_prep"))

from vector_prep.vector_client import LocalVectorClient  # noqa: E402


def _client_with_collection(metadata):
    """Builds a LocalVectorClient whose underlying Chroma client is a mock."""
    collection = MagicMock()
    collection.metadata = metadata

    with patch("vector_prep.vector_client.chromadb.PersistentClient") as persistent:
        persistent.return_value.get_or_create_collection.return_value = collection
        client = LocalVectorClient(persist_directory="./unused")

    return client, collection


def test_requests_cosine_space():
    client, _ = _client_with_collection({"hnsw:space": "cosine"})
    client.get_or_create_collection("c")

    _, kwargs = client.client.get_or_create_collection.call_args
    assert kwargs["metadata"] == {"hnsw:space": "cosine"}


def test_warns_when_existing_collection_is_not_cosine():
    client, _ = _client_with_collection({"hnsw:space": "l2"})

    with patch("vector_prep.vector_client.logger") as logger:
        client.get_or_create_collection("c")

    assert logger.warning.called, "a non-cosine collection must warn, not log success"
    assert logger.warning.call_args.kwargs["metric_space"] == "l2"


def test_does_not_warn_when_collection_is_cosine():
    client, _ = _client_with_collection({"hnsw:space": "cosine"})

    with patch("vector_prep.vector_client.logger") as logger:
        client.get_or_create_collection("c")

    assert not logger.warning.called
    assert logger.info.call_args.kwargs["metric_space"] == "cosine"


@pytest.mark.parametrize("metadata", [None, {}])
def test_missing_metadata_is_treated_as_unknown_and_warns(metadata):
    """A collection with no space metadata is not provably cosine — warn."""
    client, _ = _client_with_collection(metadata)

    with patch("vector_prep.vector_client.logger") as logger:
        client.get_or_create_collection("c")

    assert logger.warning.called
    assert logger.warning.call_args.kwargs["metric_space"] == "unknown"
