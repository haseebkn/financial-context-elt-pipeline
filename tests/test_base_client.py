"""
Exhaustive coverage of is_retryable_exception — the core resilience predicate
that every extractor's API calls run through. It must retry transient
failures (429, 5xx, timeouts) and NOT retry permanent ones (4xx other than
429), across every SDK exception shape the codebase catches.
"""

import json

import pytest
import requests
from alpaca.common.exceptions import APIError as AlpacaAPIError
from googleapiclient.errors import HttpError
from plaid.exceptions import ApiException as PlaidApiException

from extract.base_client import is_retryable_exception


# ---------------------------------------------------------------------------
# 1. requests.exceptions.RequestException
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


@pytest.mark.parametrize(
    "status_code,expected",
    [
        (429, True),  # rate limited
        (500, True),  # server error
        (503, True),  # service unavailable
        (599, True),  # top of the 5xx range
        (400, False),  # bad request — not retryable
        (401, False),  # auth failure — not retryable
        (404, False),  # not found — not retryable
        (200, False),  # sanity: a 2xx should never be marked retryable
    ],
)
def test_requests_exception_by_status_code(status_code, expected):
    exc = requests.exceptions.RequestException(response=_FakeResponse(status_code))
    assert is_retryable_exception(exc) is expected


def test_requests_exception_without_response_is_retryable():
    # No response attached (connection-level failure) — treat as transient.
    exc = requests.exceptions.ConnectionError("connection refused")
    assert is_retryable_exception(exc) is True


def test_requests_timeout_is_retryable():
    exc = requests.exceptions.Timeout("timed out")
    assert is_retryable_exception(exc) is True


# ---------------------------------------------------------------------------
# 2. googleapiclient.errors.HttpError
# ---------------------------------------------------------------------------


class _FakeGoogleResp:
    def __init__(self, status):
        self.status = status
        self.reason = "error"


@pytest.mark.parametrize(
    "status,expected",
    [
        (429, True),
        (500, True),
        (503, True),
        (400, False),
        (403, False),
        (404, False),
    ],
)
def test_google_http_error_by_status(status, expected):
    exc = HttpError(_FakeGoogleResp(status), b"error body")
    assert is_retryable_exception(exc) is expected


# ---------------------------------------------------------------------------
# 3. plaid.exceptions.ApiException
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status,expected",
    [
        (429, True),
        (500, True),
        (503, True),
        (400, False),
        (401, False),
        (404, False),
    ],
)
def test_plaid_api_exception_by_status(status, expected):
    exc = PlaidApiException(status=status, reason="error")
    assert is_retryable_exception(exc) is expected


# ---------------------------------------------------------------------------
# 4. alpaca.common.exceptions.APIError
#
# Regression coverage for a real bug: APIError.code is Alpaca's own
# domain-specific error code (e.g. 42910000), not an HTTP status, so
# comparing it to 429/5xx never matched — and reading .code on a non-JSON
# error body raised an uncaught JSONDecodeError. The fix reads .status_code
# (the real HTTP status, present when the SDK attaches the underlying
# requests.HTTPError) and only falls back to message sniffing when no
# structured status is available.
# ---------------------------------------------------------------------------


class _FakeHTTPErrorWithResponse(Exception):
    def __init__(self, status_code):
        self.response = _FakeResponse(status_code)


def _alpaca_error(status_code=None, body=None):
    http_error = (
        _FakeHTTPErrorWithResponse(status_code) if status_code is not None else None
    )
    return AlpacaAPIError(
        body or json.dumps({"code": 40410000, "message": "not found"}),
        http_error=http_error,
    )


@pytest.mark.parametrize(
    "status_code,expected",
    [
        (429, True),
        (500, True),
        (503, True),
        (400, False),
        (404, False),
    ],
)
def test_alpaca_error_uses_http_status_not_domain_code(status_code, expected):
    # The JSON body's "code" is a business code (40410000) that must NOT be
    # confused with the HTTP status — only .status_code should drive the decision.
    exc = _alpaca_error(status_code=status_code)
    assert is_retryable_exception(exc) is expected


def test_alpaca_error_with_non_json_body_does_not_crash():
    # Previously raised JSONDecodeError instead of returning a bool.
    exc = AlpacaAPIError("Internal Server Error", http_error=None)
    assert (
        is_retryable_exception(exc) is True
    )  # falls back to "server error" in message


def test_alpaca_error_without_status_or_retry_keywords_is_not_retryable():
    exc = AlpacaAPIError("insufficient buying power", http_error=None)
    assert is_retryable_exception(exc) is False


# ---------------------------------------------------------------------------
# 5. Generic fallback (unrecognized exception types)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Connection timeout occurred", True),
        ("Connection pool is full, discarding connection", True),
        ("something else entirely", False),
    ],
)
def test_generic_exception_fallback(message, expected):
    assert is_retryable_exception(RuntimeError(message)) is expected
