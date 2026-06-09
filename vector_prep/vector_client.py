import os
import chromadb
from chromadb.config import Settings
import structlog

# Set up structured logging
logger = structlog.get_logger(__name__)

class LocalVectorClient:
    """
    A persistent local client for ChromaDB, configured for LLM context storage.
    Enforces consistent collection metrics and persistence configurations.
    """
    def __init__(self, persist_directory: str = "./vector_store"):
        self.persist_directory = os.path.abspath(persist_directory)
        logger.info("Initializing persistent ChromaDB client", persist_directory=self.persist_directory)
        
        # Initialize persistent client
        self.client = chromadb.PersistentClient(path=self.persist_directory)
        
    def get_or_create_collection(self, collection_name: str = "financial_communication_context"):
        """
        Gets or creates a ChromaDB collection with the L2 distance metric (hnsw:space: l2).
        """
        logger.info("Accessing collection", collection_name=collection_name)
        try:
            # We configure the distance metric to be L2 (squared L2 distance)
            collection = self.client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "l2"}
            )
            logger.info("Collection successfully retrieved or created", 
                        collection_name=collection_name,
                        metric_space="l2")
            return collection
        except Exception as e:
            logger.error("Failed to get or create collection", 
                         collection_name=collection_name, 
                         error=str(e))
            raise
