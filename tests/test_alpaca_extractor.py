"""
Tests for AlpacaExtractor.extract_orders — cursor-based pagination over
order creation timestamps. Covers a multi-page walk, the final short page
that ends pagination, and the non-advancing-cursor guard that prevents an
infinite loop when the API returns stale/out-of-order data.

The Alpaca SDK's TradingClient is never constructed for real — it's patched
out so these tests run with no network access and no credentials.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

import extract.alpaca_extractor as alpaca_extractor_module
from extract.alpaca_extractor import AlpacaExtractor


class FakeOrder:
    """Minimal stand-in for an Alpaca SDK order model."""

    def __init__(self, order_id: str, created_at: datetime):
        self.id = order_id
        self.created_at = created_at

    def model_dump(self, mode="json"):
        return {"id": self.id, "created_at": self.created_at.isoformat()}


@pytest.fixture
def extractor(monkeypatch):
    monkeypatch.setattr(
        alpaca_extractor_module.settings, "alpaca_api_key_id", "test-key"
    )
    monkeypatch.setattr(
        alpaca_extractor_module.settings, "alpaca_api_secret_key", "test-secret"
    )
    with patch.object(alpaca_extractor_module, "TradingClient") as mock_client_cls:
        mock_client_cls.return_value = MagicMock()
        ext = AlpacaExtractor()
        ext.alpaca_config = {"history_days": 90, "orders_limit": 2}
        yield ext


def test_extract_orders_stops_on_final_short_page(extractor):
    start = datetime.now(timezone.utc) - timedelta(days=90)
    page1 = [
        FakeOrder("o1", start + timedelta(days=1)),
        FakeOrder("o2", start + timedelta(days=2)),  # limit=2, full page -> continue
    ]
    page2 = [
        FakeOrder("o3", start + timedelta(days=3)),  # 1 < limit=2 -> stop after this
    ]
    extractor.client.get_orders.side_effect = [page1, page2]

    pages = list(extractor.extract_orders())

    assert len(pages) == 2
    assert [o["id"] for o in pages[0]] == ["o1", "o2"]
    assert [o["id"] for o in pages[1]] == ["o3"]
    assert extractor.client.get_orders.call_count == 2

    # Second call's cursor must have advanced past the latest order in page 1.
    second_call_filter = extractor.client.get_orders.call_args_list[1].kwargs["filter"]
    assert second_call_filter.after == page1[1].created_at + timedelta(microseconds=1)


def test_extract_orders_no_orders_yields_nothing(extractor):
    extractor.client.get_orders.side_effect = [[]]

    pages = list(extractor.extract_orders())

    assert pages == []
    assert extractor.client.get_orders.call_count == 1


def test_extract_orders_stops_on_non_advancing_cursor(extractor):
    extractor.alpaca_config["orders_limit"] = 1
    start = datetime.now(timezone.utc) - timedelta(days=90)

    later_order = FakeOrder("o1", start + timedelta(days=10))
    # Page 2 misbehaves: returns an order older than the cursor we just
    # advanced past. Without the guard this would loop forever re-requesting
    # the same stale window.
    stale_order = FakeOrder("o2", start + timedelta(days=10))  # == cursor after page 1

    extractor.client.get_orders.side_effect = [[later_order], [stale_order]]

    pages = list(extractor.extract_orders())

    assert len(pages) == 2
    assert extractor.client.get_orders.call_count == 2  # did not loop a third time
