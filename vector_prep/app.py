import os
import sys

# Ensure vector_prep directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import torch
import structlog
from fastapi import FastAPI, Query
from sentence_transformers import SentenceTransformer
from vector_client import LocalVectorClient

# Set up structured logging
logger = structlog.get_logger(__name__)

app = FastAPI(title="Semantic Context Explorer")

DB_PATH = "financial_engine.db"
COLLECTION_NAME = "financial_communication_context"
MODEL_NAME = "all-MiniLM-L6-v2"

# Initialize resources globally for high-performance reuse
logger.info("Initializing search models and clients...")
device = "cuda" if torch.cuda.is_available() else "cpu"
device_name = torch.cuda.get_device_name(0) if device == "cuda" else "CPU"
model = SentenceTransformer(MODEL_NAME, device=device)
vector_client = LocalVectorClient()
collection = vector_client.get_or_create_collection(COLLECTION_NAME)

@app.get("/api/stats")
def get_stats():
    """Returns basic index database stats."""
    return {
        "total_records": collection.count(),
        "device": device_name,
        "model": MODEL_NAME,
        "collection": COLLECTION_NAME,
        "metric": "Cosine Similarity"
    }

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 5):
    """Executes semantic vector search using GPU embeddings."""
    logger.info("Received query", query=q, limit=limit)
    try:
        # Generate query vector on GPU
        query_vector = model.encode([q], normalize_embeddings=True).tolist()
        
        # Query ChromaDB
        results = collection.query(
            query_embeddings=query_vector,
            n_results=limit
        )
        
        # Format response
        formatted_results = []
        if results['ids'] and results['ids'][0]:
            for i in range(len(results['ids'][0])):
                formatted_results.append({
                    "id": results['ids'][0][i],
                    "document": results['documents'][0][i],
                    "distance": float(results['distances'][0][i]),
                    "metadata": results['metadatas'][0][i]
                })
        
        return {"query": q, "results": formatted_results}
    except Exception as e:
        logger.error("Search failed", error=str(e))
        return {"error": str(e), "results": []}

