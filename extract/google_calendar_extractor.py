import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Generator
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from extract.base_client import BaseAPIClient

class GoogleCalendarExtractor(BaseAPIClient):
    """
    Extractor for Google Calendar API.
    Pulls events from the configured calendar within a rolling historical window.
    Supports token-based cursor pagination and handles API limits resiliently.
    """

    def __init__(self, config_path: str = "config/pipeline_config.yaml"):
        super().__init__(config_path)
        self.cal_config = self.config.get("extractors", {}).get("google_calendar", {})
        self.scopes = self.cal_config.get("scopes", ["https://www.googleapis.com/auth/calendar.readonly"])
        self.calendar_id = os.getenv("GOOGLE_CALENDAR_ID", "primary")
        self.token_path = os.getenv("GOOGLE_TOKEN_PATH", "token.json")
        self.credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")
        self.service = None

    def _authenticate(self):
        """
        Handles Google OAuth2 authentication.
        Re-uses token.json if present, refreshes expired tokens, or runs a local flow.
        """
        creds = None
        if os.path.exists(self.token_path):
            try:
                creds = Credentials.from_authorized_user_file(self.token_path, self.scopes)
            except Exception as e:
                self.logger.warning("Failed to load token file, re-authenticating", error=str(e))

        # If there are no (valid) credentials available, let the user log in.
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    self.logger.info("Refreshing Google OAuth2 credentials...")
                    creds.refresh(Request())
                except Exception as e:
                    self.logger.error("Failed to refresh token", error=str(e))
                    creds = None
            
            if not creds:
                if not os.path.exists(self.credentials_path):
                    raise FileNotFoundError(
                        f"Google credentials file not found at: {self.credentials_path}. "
                        "Please download the OAuth client credentials JSON from Google Cloud Console "
                        "and save it in the root folder as 'credentials.json'."
                    )
                self.logger.info("Starting local OAuth web server flow for authentication...")
                flow = InstalledAppFlow.from_client_secrets_file(self.credentials_path, self.scopes)
                creds = flow.run_local_server(port=0)
            
            # Save the credentials for the next run
            with open(self.token_path, "w") as token:
                token.write(creds.to_json())

        # Build Google Calendar API service using base client resilience
        self.service = build("calendar", "v3", credentials=creds)

    def extract(self) -> Generator[Dict[str, Any], None, None]:
        """
        Extracts calendar events page by page using cursor-based token pagination.
        Yields structured payloads ready for landing zone file writer.
        """
        if not self.service:
            self._authenticate()

        history_days = self.cal_config.get("history_days", 90)
        time_min = (datetime.now(timezone.utc) - timedelta(days=history_days)).isoformat()
        
        page_token = None
        self.logger.info("Starting Google Calendar extraction", time_min=time_min, calendar_id=self.calendar_id)

        while True:
            # Query parameters for list request
            kwargs = {
                "calendarId": self.calendar_id,
                "timeMin": time_min,
                "singleEvents": True,
                "orderBy": "startTime",
                "maxResults": self.cal_config.get("max_results", 250),
            }
            if page_token:
                kwargs["pageToken"] = page_token

            # Enforce resilience when calling Google Calendar API list events
            # We call service.events().list(**kwargs).execute as a resilient operation
            try:
                self.logger.debug("Fetching page of calendar events", page_token=page_token)
                
                request = self.service.events().list(**kwargs)
                response = self.execute_with_resilience(request.execute)
                
                items = response.get("items", [])
                self.logger.info("Retrieved calendar events page", count=len(items))
                
                # Yield the raw response payload for ELT landing
                yield response
                
                # Check for next page token
                page_token = response.get("nextPageToken")
                if not page_token:
                    self.logger.info("Finished Google Calendar extraction (no more pages)")
                    break
            except Exception as e:
                self.logger.error("Failed to extract calendar events page", page_token=page_token, error=str(e))
                raise e

if __name__ == "__main__":
    # Standard helper for manual execution testing
    try:
        extractor = GoogleCalendarExtractor()
        for idx, page in enumerate(extractor.extract()):
            print(f"Page {idx}: contains {len(page.get('items', []))} items")
    except Exception as err:
        print(f"Extraction error: {err}")
