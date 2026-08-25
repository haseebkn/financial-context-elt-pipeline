"""
Centralized, typed application settings.

Replaces scattered os.getenv() calls across the codebase with a single
validated settings object. Values are resolved from environment variables
(or a repo-root .env file) with sane local-dev defaults, so the pipeline
runs out of the box on a fresh clone with no configuration.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # General
    environment: str = "development"
    log_level: str = "INFO"
    raw_data_dir: str = "raw_data"

    # Alpaca Markets
    alpaca_api_key_id: str | None = None
    alpaca_api_secret_key: str | None = None
    alpaca_is_paper: bool = True

    # Plaid
    plaid_client_id: str | None = None
    plaid_secret: str | None = None
    plaid_environment: str = "sandbox"
    plaid_access_token: str | None = None

    # Google Calendar
    google_application_credentials: str = "credentials.json"
    google_token_path: str = "token.json"
    google_calendar_id: str = "primary"

    # AWS S3
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_default_region: str = "us-east-1"
    aws_s3_bucket: str | None = None

    # Retrieval service (internal, called by the Node agent service — never
    # exposed publicly). A shared secret rather than a public API: the agent
    # service and the retrieval service run on the same trust boundary.
    retrieval_service_token: str | None = None
    retrieval_service_host: str = "127.0.0.1"
    retrieval_service_port: int = 8100


settings = Settings()
