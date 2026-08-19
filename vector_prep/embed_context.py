import argparse
import hashlib
import os
import sys
import time
import duckdb
import torch
from sentence_transformers import SentenceTransformer
import structlog
from vector_client import LocalVectorClient

# Set up structured logging
logger = structlog.get_logger(__name__)

DB_PATH = "financial_engine.db"
COLLECTION_NAME = "financial_communication_context"
MODEL_NAME = "all-MiniLM-L6-v2"
BATCH_SIZE = 100

def check_hardware(requested_device: str = "auto") -> str:
    """
    Resolves and logs the device to run embeddings on.
    Prefers GPU acceleration when available, but falls back to CPU
    rather than failing so the pipeline runs on any machine.
    """
    logger.info("Checking hardware configuration...", requested_device=requested_device)

    if requested_device == "cpu":
        logger.info("Running on CPU (explicitly requested)")
        return "cpu"

    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        logger.info("Hardware acceleration verified",
                    device="cuda:0",
                    device_name=device_name,
                    rtx_4070_detected="4070" in device_name)
        return "cuda"

    if requested_device == "cuda":
        raise RuntimeError("CUDA was explicitly requested but is not available on this system.")

    logger.warning("CUDA is not available; falling back to CPU. Embedding will be slower.")
    return "cpu"

def load_embedding_model(device: str):
    """
    Initializes the embedding transformer model on the target device.
    """
    logger.info("Loading sentence-transformer model", model_name=MODEL_NAME, target_device=device)
    try:
        model = SentenceTransformer(MODEL_NAME, device=device)
        logger.info("Model successfully loaded onto device", model_name=MODEL_NAME, device=device)
        return model
    except Exception as e:
        logger.error("Failed to load embedding model", error=str(e))
        raise

def fetch_analytics_data(db_path: str):
    """
    Fetches records from the DuckDB analytical warehouse.
    """
    logger.info("Opening connection to DuckDB analytical warehouse", db_path=db_path)
    if not os.path.exists(db_path):
        logger.error("DuckDB database file not found", db_path=db_path)
        raise FileNotFoundError(f"Database not found at: {db_path}")
        
    try:
        conn = duckdb.connect(db_path, read_only=True)
        # Select rows where summary_text is not null and not empty
        query = """
            SELECT 
                row_id AS unique_id,
                summary_text AS context_string,
                source AS source_system,
                CAST(event_timestamp AS VARCHAR) AS record_date
            FROM main_analytics.fct_context_rows
            WHERE summary_text IS NOT NULL AND TRIM(summary_text) != '';
        """
        df = conn.execute(query).fetch_df()
        conn.close()
        logger.info("Successfully fetched rows from DuckDB", rows_fetched=len(df))
        return df
    except Exception as e:
        logger.error("Failed to query DuckDB analytical warehouse", error=str(e))
        raise

def content_hash(text: str) -> str:
    """Stable content fingerprint used to detect unchanged rows between runs."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def filter_changed_rows(df, collection):
    """
    Drops rows whose content_hash already matches what's stored in ChromaDB,
    so re-runs only pay embedding cost for new or updated records.

    Returns the filtered dataframe (with a content_hash column attached) plus
    a stats dict for logging.
    """
    df = df.copy()
    df["content_hash"] = df["context_string"].map(content_hash)

    total = len(df)
    if total == 0 or collection.count() == 0:
        return df, {"scanned": total, "embedded": total, "skipped": 0}

    ids = df["unique_id"].tolist()
    existing = collection.get(ids=ids, include=["metadatas"])
    existing_hashes = {
        eid: (meta or {}).get("content_hash")
        for eid, meta in zip(existing["ids"], existing["metadatas"])
    }

    changed_mask = df.apply(
        lambda row: existing_hashes.get(row["unique_id"]) != row["content_hash"], axis=1
    )
    filtered = df[changed_mask].reset_index(drop=True)

    stats = {
        "scanned": total,
        "embedded": len(filtered),
        "skipped": total - len(filtered),
    }
    return filtered, stats

def vectorize_and_store(df, model, collection):
    """
    Processes the dataframe in batches, computes embeddings, and stores them in ChromaDB.
    Expects df to already be filtered to new/changed rows via filter_changed_rows,
    and to carry a content_hash column.
    """
    total_rows = len(df)
    if total_rows == 0:
        logger.info("No new or changed records to vectorize.")
        return

    logger.info("Beginning vector prep and storage process", total_records=total_rows, batch_size=BATCH_SIZE)
    
    for start_idx in range(0, total_rows, BATCH_SIZE):
        end_idx = min(start_idx + BATCH_SIZE, total_rows)
        batch_df = df.iloc[start_idx:end_idx]
        
        # Prepare batches
        ids = batch_df['unique_id'].tolist()
        documents = batch_df['context_string'].tolist()
        
        # Prepare metadatas (each entry must be a dictionary)
        metadatas = []
        for _, row in batch_df.iterrows():
            metadatas.append({
                "source_system": str(row['source_system']),
                "record_date": str(row['record_date']),
                "content_hash": str(row['content_hash'])
            })
            
        logger.info("Embedding batch...", 
                    batch_start=start_idx, 
                    batch_end=end_idx, 
                    batch_count=len(documents))
        
        try:
            # Normalize to unit vectors so cosine distance (and the app's
            # similarity display) is well-defined and consistent across queries.
            embeddings = model.encode(documents, show_progress_bar=False, normalize_embeddings=True).tolist()
            
            # Upsert into ChromaDB to ensure idempotency (updates existing ids in-place)
            collection.upsert(
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents
            )
            logger.info("Batch successfully upserted to ChromaDB", 
                        batch_start=start_idx, 
                        batch_end=end_idx)
        except Exception as e:
            logger.error("Failed storing batch in ChromaDB", 
                         batch_start=start_idx, 
                         batch_end=end_idx, 
                         error=str(e))
            raise

def main():
    parser = argparse.ArgumentParser(description="Compute embeddings and load them into ChromaDB.")
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Device to run the embedding model on. 'auto' prefers CUDA and falls back to CPU.",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop and recreate the ChromaDB collection before embedding. "
             "Required once when switching distance metrics or models, since "
             "vectors embedded under a different configuration are not comparable.",
    )
    args = parser.parse_args()

    try:
        # 1. Hardware Verification
        device = check_hardware(args.device)

        # 2. Initialize ChromaDB client and collection
        vector_client = LocalVectorClient()
        collection = vector_client.get_or_create_collection(COLLECTION_NAME, recreate=args.recreate)
        
        # 3. Load Sentence Transformer Model on GPU
        model = load_embedding_model(device)
        
        # 4. Fetch clean data from DuckDB
        df = fetch_analytics_data(DB_PATH)

        # 5. Skip rows whose content hasn't changed since the last run
        df, change_stats = filter_changed_rows(df, collection)
        logger.info(
            "Change detection complete",
            rows_scanned=change_stats["scanned"],
            rows_to_embed=change_stats["embedded"],
            rows_skipped_unchanged=change_stats["skipped"],
        )

        # 6. Vectorize and Upsert to ChromaDB
        start_time = time.monotonic()
        vectorize_and_store(df, model, collection)
        elapsed = time.monotonic() - start_time

        logger.info(
            "Vectorization pipeline completed successfully!",
            rows_embedded=change_stats["embedded"],
            rows_skipped_unchanged=change_stats["skipped"],
            embed_seconds=round(elapsed, 2),
        )
        
    except Exception as e:
        logger.critical("Vectorization pipeline failed", error=str(e))
        sys.exit(1)

if __name__ == "__main__":
    main()
