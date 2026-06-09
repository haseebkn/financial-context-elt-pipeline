import os
import sys
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

def check_hardware():
    """
    Checks hardware compatibility and logs PyTorch CUDA status.
    Ensures calculations are offloaded to GPU.
    """
    logger.info("Checking hardware configuration...")
    if not torch.cuda.is_available():
        logger.error("CUDA is not available! GPU acceleration is required for RTX 4070 target.")
        raise RuntimeError("CUDA is not available on this system. Please check GPU drivers and PyTorch version.")
    
    device_name = torch.cuda.get_device_name(0)
    logger.info("Hardware acceleration verified", 
                device="cuda:0", 
                device_name=device_name,
                rtx_4070_detected="4070" in device_name)
    return "cuda"

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

def vectorize_and_store(df, model, collection):
    """
    Processes the dataframe in batches, computes embeddings, and stores them in ChromaDB.
    """
    total_rows = len(df)
    if total_rows == 0:
        logger.info("No records found to vectorize.")
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
                "record_date": str(row['record_date'])
            })
            
        logger.info("Embedding batch...", 
                    batch_start=start_idx, 
                    batch_end=end_idx, 
                    batch_count=len(documents))
        
        try:
            # Generate embeddings on the GPU
            embeddings = model.encode(documents, show_progress_bar=False).tolist()
            
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
    try:
        # 1. Hardware Verification
        device = check_hardware()
        
        # 2. Initialize ChromaDB client and collection
        vector_client = LocalVectorClient()
        collection = vector_client.get_or_create_collection(COLLECTION_NAME)
        
        # 3. Load Sentence Transformer Model on GPU
        model = load_embedding_model(device)
        
        # 4. Fetch clean data from DuckDB
        df = fetch_analytics_data(DB_PATH)
        
        # 5. Vectorize and Upsert to ChromaDB
        vectorize_and_store(df, model, collection)
        
        logger.info("Vectorization pipeline completed successfully!")
        
    except Exception as e:
        logger.critical("Vectorization pipeline failed", error=str(e))
        sys.exit(1)

if __name__ == "__main__":
    main()
