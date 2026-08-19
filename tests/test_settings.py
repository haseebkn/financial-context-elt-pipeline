"""
Tests for the centralized Settings object: sane local-dev defaults with no
.env present, and that environment variables correctly override them.
"""

from config.settings import Settings

# Every field this suite exercises, so tests are robust to other modules
# calling load_dotenv() earlier in the same process (e.g. extract/base_client.py
# does this at import time, which otherwise leaks .env values into os.environ
# for the rest of the pytest session regardless of _env_file=None here).
_SETTINGS_ENV_KEYS = [
    "RAW_DATA_DIR",
    "LOG_LEVEL",
    "ENVIRONMENT",
    "ALPACA_API_KEY_ID",
    "ALPACA_API_SECRET_KEY",
    "ALPACA_IS_PAPER",
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
    "PLAID_ENVIRONMENT",
    "PLAID_ACCESS_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_TOKEN_PATH",
    "GOOGLE_CALENDAR_ID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_DEFAULT_REGION",
    "AWS_S3_BUCKET",
]


def _clear_settings_env(monkeypatch):
    for key in _SETTINGS_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults_require_no_configuration(monkeypatch):
    _clear_settings_env(monkeypatch)
    settings = Settings(_env_file=None)  # ignore any local .env for this test

    assert settings.raw_data_dir == "raw_data"
    assert settings.log_level == "INFO"
    assert settings.environment == "development"
    assert settings.alpaca_is_paper is True
    assert settings.plaid_environment == "sandbox"
    assert settings.google_calendar_id == "primary"
    assert settings.alpaca_api_key_id is None
    assert settings.aws_s3_bucket is None


def test_environment_variables_override_defaults(monkeypatch):
    monkeypatch.setenv("RAW_DATA_DIR", "/custom/path")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("ALPACA_API_KEY_ID", "PKTEST123")
    monkeypatch.setenv("ALPACA_IS_PAPER", "False")

    settings = Settings(_env_file=None)

    assert settings.raw_data_dir == "/custom/path"
    assert settings.log_level == "DEBUG"
    assert settings.alpaca_api_key_id == "PKTEST123"
    assert settings.alpaca_is_paper is False


def test_env_var_lookup_is_case_insensitive(monkeypatch):
    monkeypatch.setenv("raw_data_dir", "/lowercase/path")
    settings = Settings(_env_file=None)
    assert settings.raw_data_dir == "/lowercase/path"
