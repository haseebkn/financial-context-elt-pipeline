import os
import sys
import structlog
from dotenv import load_dotenv

# Add workspace root to path to ensure imports work correctly when executing from anywhere
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extract.google_calendar_extractor import GoogleCalendarExtractor
from extract.alpaca_extractor import AlpacaExtractor
from extract.plaid_extractor import PlaidExtractor
from load.file_writer import RawFileWriter
from config.settings import settings

logger = structlog.get_logger("run_extraction")


def main():
    load_dotenv()
    logger.info(
        "Initializing Financial & Communication Context Engine - Ingestion Phase 1"
    )

    # Initialize landing zone file writer
    writer = RawFileWriter(base_dir=settings.raw_data_dir)

    # 1. Google Calendar Extraction
    if os.path.exists(settings.google_application_credentials):
        try:
            logger.info("Starting Google Calendar Extraction Phase...")
            calendar_extractor = GoogleCalendarExtractor()
            for idx, response_page in enumerate(calendar_extractor.extract()):
                writer.write_record(
                    source="google_calendar", resource="events", payload=response_page
                )
            logger.info("Google Calendar Ingestion Complete.")
        except Exception as e:
            logger.error("Google Calendar Ingestion failed", error=str(e))
    else:
        logger.warning(
            "Skipping Google Calendar Extraction: Credentials file not found. "
            "Please create credentials.json to configure Google OAuth."
        )

    # 2. Alpaca Markets Extraction
    if settings.alpaca_api_key_id and settings.alpaca_api_secret_key:
        try:
            logger.info("Starting Alpaca Markets Extraction Phase...")
            alpaca_extractor = AlpacaExtractor()
            for dataset in alpaca_extractor.extract():
                writer.write_record(
                    source="alpaca",
                    resource=dataset["resource"],
                    payload=dataset["data"],
                )
            logger.info("Alpaca Markets Ingestion Complete.")
        except Exception as e:
            logger.error("Alpaca Ingestion failed", error=str(e))
    else:
        logger.warning(
            "Skipping Alpaca Ingestion: ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY environment variables not set."
        )

    # 3. Plaid Extraction
    if (
        settings.plaid_client_id
        and settings.plaid_secret
        and settings.plaid_access_token
    ):
        try:
            logger.info("Starting Plaid Extraction Phase...")
            plaid_extractor = PlaidExtractor()
            for dataset in plaid_extractor.extract():
                writer.write_record(
                    source="plaid",
                    resource=dataset["resource"],
                    payload=dataset["data"],
                )
            logger.info("Plaid Ingestion Complete.")
        except Exception as e:
            logger.error("Plaid Ingestion failed", error=str(e))
    else:
        logger.warning(
            "Skipping Plaid Ingestion: PLAID_CLIENT_ID, PLAID_SECRET, or PLAID_ACCESS_TOKEN "
            "environment variables not set."
        )

    logger.info("Phase 1 Extraction Run execution completed.")


if __name__ == "__main__":
    main()
