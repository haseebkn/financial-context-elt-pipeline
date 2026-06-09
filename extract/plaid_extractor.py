import os
from typing import Any, Dict, Generator
import plaid
from plaid.api import plaid_api
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from extract.base_client import BaseAPIClient

class PlaidExtractor(BaseAPIClient):
    """
    Extractor for Plaid API.
    Fetches account lists, balance checks, and syncs historical transactions.
    Implements Plaid's native cursor-based /transactions/sync pagination.
    """

    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        super().__init__(config_path)
        self.plaid_config = self.config.get("extractors", {}).get("plaid", {})
        
        self.client_id = os.getenv("PLAID_CLIENT_ID")
        self.secret = os.getenv("PLAID_SECRET")
        self.access_token = os.getenv("PLAID_ACCESS_TOKEN")
        self.env_name = os.getenv("PLAID_ENVIRONMENT", self.plaid_config.get("environment", "sandbox")).lower()

        if not self.client_id or not self.secret or not self.access_token:
            raise ValueError(
                "Plaid configuration missing. Ensure PLAID_CLIENT_ID, PLAID_SECRET, "
                "and PLAID_ACCESS_TOKEN environment variables are set."
            )

        # Map environment string to Plaid host configurations
        # Note: Plaid deprecated the Development environment in late 2023.
        # Newer SDK versions only define Sandbox and Production. We support development as a string fallback.
        env_map = {
            "sandbox": getattr(plaid.Environment, "Sandbox", "https://sandbox.plaid.com"),
            "development": "https://development.plaid.com",
            "production": getattr(plaid.Environment, "Production", "https://production.plaid.com"),
        }
        
        host = env_map.get(self.env_name)
        if not host:
            raise ValueError(f"Invalid Plaid Environment: {self.env_name}. Choose sandbox, development, or production.")

        # Initialize the Plaid Client
        configuration = plaid.Configuration(
            host=host,
            api_key={
                "clientId": self.client_id,
                "secret": self.secret,
            }
        )
        self.api_client = plaid.ApiClient(configuration)
        self.client = plaid_api.PlaidApi(self.api_client)

    def _serialize_response(self, response: Any) -> Any:
        """Converts Plaid API response objects to standard dictionaries."""
        if hasattr(response, "to_dict"):
            return response.to_dict()
        return response

    def extract_accounts(self) -> Dict[str, Any]:
        """Fetches list of accounts linked to the access token."""
        self.logger.info("Extracting Plaid accounts details")
        request = AccountsGetRequest(access_token=self.access_token)
        
        # Call API using resilience wrapper
        response = self.execute_with_resilience(self.client.accounts_get, request)
        return self._serialize_response(response)

    def extract_balances(self) -> Dict[str, Any]:
        """Fetches real-time account balances."""
        self.logger.info("Extracting Plaid balances details")
        request = AccountsBalanceGetRequest(access_token=self.access_token)
        
        response = self.execute_with_resilience(self.client.accounts_balance_get, request)
        return self._serialize_response(response)

    def extract_transactions(self, initial_cursor: str = "") -> Generator[Dict[str, Any], None, None]:
        """
        Syncs transactions using Plaid's /transactions/sync endpoint.
        Paginates using the next_cursor until has_more is False.
        """
        cursor = initial_cursor
        batch_size = self.plaid_config.get("batch_size", 100)
        self.logger.info("Starting Plaid transactions sync", cursor=cursor, batch_size=batch_size)

        while True:
            request = TransactionsSyncRequest(
                access_token=self.access_token,
                cursor=cursor,
                count=batch_size
            )
            
            self.logger.debug("Requesting Plaid transactions sync page", cursor=cursor)
            response = self.execute_with_resilience(self.client.transactions_sync, request)
            response_dict = self._serialize_response(response)
            
            # Yield this batch of updates
            yield response_dict
            
            # Retrieve pagination loop parameters
            has_more = response_dict.get("has_more", False)
            cursor = response_dict.get("next_cursor", "")
            
            added = len(response_dict.get("added", []))
            modified = len(response_dict.get("modified", []))
            removed = len(response_dict.get("removed", []))
            
            self.logger.info(
                "Plaid sync page parsed",
                added=added,
                modified=modified,
                removed=removed,
                has_more=has_more,
                next_cursor=cursor
            )

            if not has_more:
                self.logger.info("Plaid transaction sync complete (has_more=False)")
                break

    def extract(self) -> Generator[Dict[str, Any], None, None]:
        """
        Extracts accounts, balances, and syncs transactions.
        Yields structured payloads ready for landing zone file writer.
        """
        # 1. Accounts
        try:
            accounts_data = self.extract_accounts()
            yield {"resource": "accounts", "data": accounts_data}
        except Exception as e:
            self.logger.error("Failed to extract Plaid accounts", error=str(e))
            raise e

        # 2. Balances
        try:
            balances_data = self.extract_balances()
            yield {"resource": "balances", "data": balances_data}
        except Exception as e:
            self.logger.error("Failed to extract Plaid balances", error=str(e))
            raise e

        # 3. Transactions Sync
        try:
            # We start with empty cursor to fetch all sandbox history
            for page in self.extract_transactions(initial_cursor=""):
                yield {"resource": "transactions", "data": page}
        except Exception as e:
            self.logger.error("Failed to sync Plaid transactions", error=str(e))
            raise e

if __name__ == "__main__":
    try:
        extractor = PlaidExtractor()
        for idx, dataset in enumerate(extractor.extract()):
            res = dataset["resource"]
            data = dataset["data"]
            print(f"Dataset {idx}: Resource '{res}' keys: {list(data.keys()) if isinstance(data, dict) else len(data)}")
    except Exception as err:
        print(f"Extraction error: {err}")
