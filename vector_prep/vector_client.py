import os

import chromadb
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
        logger.info(
            "Initializing persistent ChromaDB client",
            persist_directory=self.persist_directory,
        )

        # Initialize persistent client
        self.client = chromadb.PersistentClient(path=self.persist_directory)

    def get_or_create_collection(
        self,
        collection_name: str = "financial_communication_context",
        recreate: bool = False,
    ):
        """
        Gets or creates a ChromaDB collection using the cosine distance metric.
        Embeddings are stored normalized (see embed_context.py), so cosine
        distance maps directly onto similarity as 1 - distance.

        If recreate=True, any existing collection under this name is dropped
        first — required when changing the distance metric on data embedded
        under a previous configuration.
        """
        logger.info(
            "Accessing collection", collection_name=collection_name, recreate=recreate
        )
        try:
            if recreate:
                try:
                    self.client.delete_collection(name=collection_name)
                    logger.info(
                        "Deleted existing collection before recreate",
                        collection_name=collection_name,
                    )
                except Exception:
                    pass

            # Cosine distance: embeddings are unit-normalized at encode time,
            # so similarity = 1 - distance.
            collection = self.client.get_or_create_collection(
                name=collection_name, metadata={"hnsw:space": "cosine"}
            )

            # Chroma applies `metadata` only when it actually creates the
            # collection — for an existing one it returns it as-is and
            # silently ignores the requested space. Report what the
            # collection IS, never what we asked for: this previously logged
            # "cosine" unconditionally while serving an l2 collection, which
            # made retrieval_service's `similarity = 1 - distance` return
            # negative scores for good matches.
            actual_space = (collection.metadata or {}).get("hnsw:space", "unknown")
            if actual_space != "cosine":
                logger.warning(
                    "Collection uses a non-cosine distance metric — similarity "
                    "scores derived as (1 - distance) will be wrong. Re-run "
                    "`python vector_prep/embed_context.py --recreate` to rebuild "
                    "it under cosine.",
                    collection_name=collection_name,
                    metric_space=actual_space,
                    expected="cosine",
                )
            else:
                logger.info(
                    "Collection successfully retrieved or created",
                    collection_name=collection_name,
                    metric_space=actual_space,
                )
            return collection
        except Exception as e:
            logger.error(
                "Failed to get or create collection",
                collection_name=collection_name,
                error=str(e),
            )
            raise
