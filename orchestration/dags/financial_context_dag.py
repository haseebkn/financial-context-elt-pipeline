import os
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.exceptions import AirflowFailException

# Default arguments for DAG execution
default_args = {
    "owner": "airflow",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

def upload_database_to_s3(**kwargs):
    """
    Python task to upload the compiled DuckDB database file back to AWS S3.
    Reads AWS credentials from env vars with fallback to Airflow Variables
    (stored in encrypted metadata DB) — production-grade credential handling.
    """
    import boto3
    from airflow.models import Variable

    def get_cfg(env_key, default=None):
        """Try os.getenv first, fall back to Airflow Variable."""
        return os.getenv(env_key) or Variable.get(env_key, default_var=default)

    bucket = get_cfg("AWS_S3_BUCKET")
    db_path = "/usr/local/airflow/project/financial_engine.db"
    s3_key = "databases/financial_engine.db"

    if not bucket or bucket.startswith("your_"):
        print("AWS_S3_BUCKET is not configured. Skipping S3 upload sync.")
        return "Skipped: S3 Bucket not configured"

    if not os.path.exists(db_path):
        raise AirflowFailException(f"DuckDB database file not found at: {db_path}. Verify dbt task succeeded.")

    try:
        print(f"Initializing S3 client for database upload. Target: s3://{bucket}/{s3_key}")
        s3 = boto3.client(
            "s3",
            aws_access_key_id=get_cfg("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=get_cfg("AWS_SECRET_ACCESS_KEY"),
            region_name=get_cfg("AWS_DEFAULT_REGION", "us-east-1"),
        )
        s3.upload_file(db_path, bucket, s3_key)
        print(f"Successfully synchronized DuckDB database to AWS S3: s3://{bucket}/{s3_key}")
        return f"Successfully synced db to s3://{bucket}/{s3_key}"
    except Exception as e:
        print(f"Failed synchronizing DuckDB database to S3: {str(e)}")
        raise AirflowFailException(f"AWS S3 database sync failed: {str(e)}")

# Define the DAG
with DAG(
    "financial_communication_context_engine",
    default_args=default_args,
    description="Orchestrates ingestion from Alpaca/Plaid/Calendar APIs and builds dbt models in DuckDB with S3 syncs.",
    schedule_interval=timedelta(days=1),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["elt", "financial", "dbt", "s3"],
) as dag:

    # Task 1: Extract API data locally and optionally stream to S3
    extract_landing_data = BashOperator(
        task_id="extract_landing_data",
        # Execute extractor runner within the mapped volume path inside the container
        bash_command="python /usr/local/airflow/project/extract/run_extraction.py",
        env={**os.environ, "PYTHONPATH": "/usr/local/airflow/project"},
    )

    # Task 2: Compile and run dbt models
    dbt_transform = BashOperator(
        task_id="dbt_transform",
        # Runs build: compiles, executes staging/intermediate/marts views/tables, and runs checks
        bash_command="dbt build --project-dir /usr/local/airflow/project/transform --profiles-dir /usr/local/airflow/project/transform",
    )

    # Task 3: Sync DuckDB database back to AWS S3
    sync_database_to_s3 = PythonOperator(
        task_id="sync_database_to_s3",
        python_callable=upload_database_to_s3,
    )

    # Define task execution dependency sequence
    extract_landing_data >> dbt_transform >> sync_database_to_s3
