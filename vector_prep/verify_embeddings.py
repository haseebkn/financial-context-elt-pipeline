import structlog
from vector_client import LocalVectorClient
from sentence_transformers import SentenceTransformer

# Set up structured logging
logger = structlog.get_logger(__name__)

COLLECTION_NAME = "financial_communication_context"
MODEL_NAME = "all-MiniLM-L6-v2"

def main():
    try:
        logger.info("Initializing vector client for verification...")
        client = LocalVectorClient()
        collection = client.get_or_create_collection(COLLECTION_NAME)
        
        # Get count of items in collection
        count = collection.count()
        logger.info("Collection verification", collection=COLLECTION_NAME, total_records=count)
        
        if count == 0:
            logger.warn("Collection is empty! Embed context needs to run first.")
            return

        # Initialize the embedding model on CPU just for querying
        logger.info("Loading embedding model for sample query...")
        model = SentenceTransformer(MODEL_NAME, device="cpu")
        
        # Run a semantic search test query
        query_text = "transaction or bank transfer"
        logger.info("Executing sample query...", query=query_text)
        
        query_embeddings = model.encode([query_text]).tolist()
        
        results = collection.query(
            query_embeddings=query_embeddings,
            n_results=3
        )
        
        logger.info("Query execution successful! Results:")
        for idx in range(len(results['ids'][0])):
            print(f"\n[{idx + 1}] ID: {results['ids'][0][idx]}")
            print(f"    Document: {results['documents'][0][idx]}")
            print(f"    Distance (L2): {results['distances'][0][idx]:.4f}")
            print(f"    Metadata: {results['metadatas'][0][idx]}")
            
    except Exception as e:
        logger.error("Verification failed", error=str(e))

if __name__ == "__main__":
    main()
