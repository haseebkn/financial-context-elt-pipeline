import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Generator, List
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetOrdersRequest
from alpaca.trading.enums import QueryOrderStatus
from extract.base_client import BaseAPIClient

class AlpacaExtractor(BaseAPIClient):
    """
    Extractor for Alpaca Markets Trading API.
    Extracts Account information, active Positions, and historical Orders.
    Implements cursor-based pagination using order creation timestamps for historical data.
    """

    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        super().__init__(config_path)
        self.alpaca_config = self.config.get("extractors", {}).get("alpaca", {})
        
        self.api_key = os.getenv("ALPACA_API_KEY_ID")
        self.secret_key = os.getenv("ALPACA_API_SECRET_KEY")
        self.is_paper = os.getenv("ALPACA_IS_PAPER", str(self.alpaca_config.get("is_paper", True))).lower() == "true"
        
        if not self.api_key or not self.secret_key:
            raise ValueError(
                "Alpaca API credentials missing. Ensure ALPACA_API_KEY_ID and "
                "ALPACA_API_SECRET_KEY environment variables are set."
            )
        
        # Initialize the official SDK TradingClient
        self.client = TradingClient(
            api_key=self.api_key,
            secret_key=self.secret_key,
            paper=self.is_paper
        )

    def _serialize_pydantic(self, obj: Any) -> Any:
        """Helper to serialize SDK models to python dicts safely across Pydantic v1 & v2."""
        if hasattr(obj, "model_dump"):
            return obj.model_dump(mode="json")
        elif hasattr(obj, "dict"):
            return obj.dict()
        return dict(obj)

    def extract_account(self) -> Dict[str, Any]:
        """Fetches Alpaca Account details resiliently."""
        self.logger.info("Extracting Alpaca account details")
        # Wrapped in resilience framework
        account = self.execute_with_resilience(self.client.get_account)
        return self._serialize_pydantic(account)

    def extract_positions(self) -> List[Dict[str, Any]]:
        """Fetches active positions resiliently."""
        self.logger.info("Extracting Alpaca active positions")
        positions = self.execute_with_resilience(self.client.get_all_positions)
        return [self._serialize_pydantic(p) for p in positions]

    def extract_orders(self) -> Generator[List[Dict[str, Any]], None, None]:
        """
        Extracts orders page by page using a rolling created_at datetime cursor.
        Returns pages of orders to support high volume scaling without OOM errors.
        """
        history_days = self.alpaca_config.get("history_days", 90)
        # Start querying from 90 days ago
        start_time = datetime.now(timezone.utc) - timedelta(days=history_days)
        limit = self.alpaca_config.get("orders_limit", 500)
        
        self.logger.info("Starting Alpaca orders extraction", start_time=start_time, limit=limit)
        
        after_cursor = start_time
        while True:
            # Setup order request filter
            request_params = GetOrdersRequest(
                status=QueryOrderStatus.ALL,
                limit=limit,
                after=after_cursor,
                nested=True
            )
            
            self.logger.debug("Fetching page of Alpaca orders", after=after_cursor)
            orders = self.execute_with_resilience(self.client.get_orders, filter=request_params)
            
            if not orders:
                self.logger.info("No more orders found")
                break
                
            serialized_orders = [self._serialize_pydantic(o) for o in orders]
            yield serialized_orders
            
            if len(orders) < limit:
                self.logger.info("Retrieved all available orders in final page", count=len(orders))
                break
            
            # Use the created_at of the latest retrieved order as the new 'after' cursor
            # Note: Orders are sorted by creation time ascending/descending depending on SDK.
            # We sort them by created_at here to find the latest creation time in this batch.
            latest_order_time = max(order.created_at for order in orders)
            
            # To avoid infinite loops, check if we're advancing the cursor.
            # Since 'after' is exclusive/inclusive, adding a small microsecond fraction prevents duplicates.
            new_cursor = latest_order_time + timedelta(microseconds=1)
            if new_cursor <= after_cursor:
                self.logger.warning("Alpaca orders cursor failed to advance. Stopping pagination.")
                break
                
            after_cursor = new_cursor

    def extract(self) -> Generator[Dict[str, Any], None, None]:
        """
        Extracts all financial datasets (account, positions, orders) from Alpaca.
        Yields structured payloads ready for landing zone file writer.
        """
        # 1. Account Info
        try:
            account_data = self.extract_account()
            yield {"resource": "account", "data": account_data}
        except Exception as e:
            self.logger.error("Failed to extract account details", error=str(e))
            raise e

        # 2. Positions
        try:
            positions_data = self.extract_positions()
            yield {"resource": "positions", "data": positions_data}
        except Exception as e:
            self.logger.error("Failed to extract positions details", error=str(e))
            raise e

        # 3. Orders (yields per page)
        try:
            has_orders = False
            for page_index, orders_page in enumerate(self.extract_orders()):
                has_orders = True
                yield {"resource": "orders", "data": orders_page}
            if not has_orders:
                # Yield empty array to ensure downstream folder setup and dbt compiles successfully
                yield {"resource": "orders", "data": []}
        except Exception as e:
            self.logger.error("Failed to extract orders details", error=str(e))
            raise e

if __name__ == "__main__":
    try:
        extractor = AlpacaExtractor()
        for idx, dataset in enumerate(extractor.extract()):
            res = dataset["resource"]
            data = dataset["data"]
            length = len(data) if isinstance(data, list) else 1
            print(f"Dataset {idx}: Resource '{res}' with {length} items")
    except Exception as err:
        print(f"Extraction error: {err}")
