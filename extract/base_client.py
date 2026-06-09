import os
import sys
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Generator
import yaml
import structlog
from dotenv import load_dotenv
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    wait_random,
    retry_if_exception,
    before_sleep_log,
)
import requests

# Load environment variables
load_dotenv()

# Setup structured logging
logging.basicConfig(
    format="%(message)s",
    stream=sys.stdout,
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
)
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)
logger = structlog.get_logger("base_client")

# Define retry-able exceptions across different SDKs/libraries
def is_retryable_exception(exception: Exception) -> bool:
    """
    Determines if an exception is transient and should be retried.
    Catches 429 (Rate Limit) and 5xx (Server Error) across standard libs and SDKs.
    """
    # 1. Standard requests exceptions
    if isinstance(exception, requests.exceptions.RequestException):
        response = getattr(exception, "response", None)
        if response is not None:
            # Retry on 429 or 5xx server errors
            return response.status_code == 429 or 500 <= response.status_code < 600
        # Retry on network connection issues / timeouts
        return True

    # 2. Google API HttpError
    # We import dynamically to avoid strict dependencies in base client import
    try:
        from googleapiclient.errors import HttpError
        if isinstance(exception, HttpError):
            status = exception.resp.status
            return status == 429 or 500 <= status < 600
    except ImportError:
        pass

    # 3. Plaid API Exception
    try:
        from plaid.exceptions import ApiException
        if isinstance(exception, ApiException):
            # Plaid ApiException has status property
            status = getattr(exception, "status", None)
            if status is not None:
                return status == 429 or 500 <= status < 600
    except ImportError:
        pass

    # 4. Alpaca API Exception
    try:
        from alpaca.common.exceptions import APIError
        if isinstance(exception, APIError):
            # Alpaca APIError message or status check
            # For tenacity, if it's Alpaca's error, it could represent a rate limit (429)
            # or server error (500). Let's retry on rate limits or internal server errors.
            code = getattr(exception, "code", None)
            if code is not None:
                try:
                    code_val = int(code)
                    return code_val == 429 or 500 <= code_val < 600
                except ValueError:
                    pass
            # Fallback check on string representations if needed
            err_str = str(exception).lower()
            return "429" in err_str or "rate limit" in err_str or "500" in err_str or "server error" in err_str
    except ImportError:
        pass

    # Fallback check on standard timeout errors
    if "timeout" in str(exception).lower() or "connection pool" in str(exception).lower():
        return True

    return False

# Base retry configuration: Exponential Backoff + Jitter
# multiplier=1, min=1, max=60 with wait_random(0, 2) is exponential backoff with full jitter.
# stop_after_attempt=7 gives us reasonable retry headroom (approx. 2-3 mins total wait time).
api_retry_decorator = retry(
    reraise=True,
    stop=stop_after_attempt(7),
    wait=wait_exponential(multiplier=1, min=1, max=60) + wait_random(0, 2),
    retry=retry_if_exception(is_retryable_exception),
    before_sleep=before_sleep_log(logger, logging.WARNING),
)

class BaseAPIClient(ABC):
    """
    Abstract base class for all API extractors.
    Handles configuration loading, structured logging, and enforces resilience standards.
    """

    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        self.logger = structlog.get_logger(self.__class__.__name__)
        self.config = self._load_config(config_path)
        self.raw_data_dir = os.getenv("RAW_DATA_DIR", self.config.get("global", {}).get("raw_data_dir", "raw_data"))

    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """Loads yaml configuration safely."""
        try:
            with open(config_path, "r") as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.error("Failed to load pipeline configuration", path=config_path, error=str(e))
            return {}

    @abstractmethod
    def extract(self) -> Generator[Dict[str, Any], None, None]:
        """
        Abstract method to be implemented by each API extractor.
        Must yield dictionaries of extracted payloads (containing data and extraction metadata).
        """
        pass

    @staticmethod
    def execute_with_resilience(func, *args, **kwargs) -> Any:
        """
        Executes any function with the standard API retry policy.
        Can wrap raw requests or SDK calls.
        """
        resilient_func = api_retry_decorator(func)
        return resilient_func(*args, **kwargs)
