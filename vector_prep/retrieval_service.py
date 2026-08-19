"""
Internal semantic retrieval service.

Wraps ChromaDB + sentence-transformers behind a small HTTP API so the
TypeScript agent service (agent/) can call it as a tool without needing to
run the embedding model itself. Not a public API — protected by a shared
secret header (RETRIEVAL_SERVICE_TOKEN) and intended to run on the same
trust boundary as the agent service (localhost, or a private network in
production).

This is deliberately a separate module from vector_prep/app.py, which
remains the human-facing dashboard. The dashboard and the agent's retrieval
tool have different concerns (a UI to browse vs. a contract for a caller
that needs structured, addressable results) and shouldn't share one FastAPI
app.
"""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import structlog
import torch
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vector_client import LocalVectorClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.settings import settings  # noqa: E402

logger = structlog.get_logger(__name__)

COLLECTION_NAME = "financial_communication_context"
MODEL_NAME = "all-MiniLM-L6-v2"
MAX_LIMIT = 50


class ServiceState:
    """Holds the loaded model/collection, or the reason they failed to load."""

    def __init__(self) -> None:
        self.model: Optional[SentenceTransformer] = None
        self.collection: Any = None
        self.device_name: str = "unknown"
        self.error: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self.model is not None and self.collection is not None


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = ServiceState()
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        state.device_name = torch.cuda.get_device_name(0) if device == "cuda" else "CPU"
        state.model = SentenceTransformer(MODEL_NAME, device=device)

        vector_client = LocalVectorClient()
        state.collection = vector_client.get_or_create_collection(COLLECTION_NAME)

        logger.info(
            "Retrieval service ready",
            device=device,
            device_name=state.device_name,
            record_count=state.collection.count(),
        )
    except Exception as e:
        # Do not crash at startup — a reviewer without the vector store
        # populated yet should still be able to reach /health and see why.
        state.error = str(e)
        logger.error("Retrieval service failed to initialize", error=state.error)

    app.state.retrieval = state
    yield


app = FastAPI(title="Context Retrieval Service", lifespan=lifespan)


def require_auth(x_internal_token: Optional[str] = Header(None)) -> None:
    if not settings.retrieval_service_token:
        raise HTTPException(
            status_code=503,
            detail="RETRIEVAL_SERVICE_TOKEN is not configured — refusing to serve authenticated routes.",
        )
    if x_internal_token != settings.retrieval_service_token:
        raise HTTPException(
            status_code=401, detail="Invalid or missing X-Internal-Token header."
        )


def require_ready(request: Request) -> ServiceState:
    state: ServiceState = request.app.state.retrieval
    if not state.ready:
        raise HTTPException(
            status_code=503,
            detail=f"Retrieval service not ready: {state.error or 'still initializing'}",
        )
    return state


@app.get("/health")
def health(request: Request):
    """Unauthenticated readiness probe."""
    state: ServiceState = request.app.state.retrieval
    if not state.ready:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "detail": state.error or "still initializing",
            },
        )
    return {"status": "ready", "record_count": state.collection.count()}


@app.get("/api/stats")
def get_stats(
    _auth: None = Depends(require_auth),
    state: ServiceState = Depends(require_ready),
):
    return {
        "total_records": state.collection.count(),
        "device": state.device_name,
        "model": MODEL_NAME,
        "collection": COLLECTION_NAME,
        "metric": "cosine",
    }


def _build_where(
    source: Optional[str], after: Optional[str], before: Optional[str]
) -> Optional[dict]:
    """
    Builds a Chroma `where` filter from optional source/date-range params.
    record_date is stored as a string cast of a TIMESTAMP (YYYY-MM-DD HH:MM:SS),
    which sorts correctly under lexicographic $gte/$lte comparison.
    """
    clauses: list[dict] = []
    if source:
        clauses.append({"source_system": {"$eq": source}})
    if after:
        clauses.append({"record_date": {"$gte": after}})
    if before:
        clauses.append({"record_date": {"$lte": before}})

    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


@app.get("/api/search")
def search(
    q: str = Query(..., min_length=1, description="Natural-language semantic query."),
    limit: int = Query(5, ge=1, le=MAX_LIMIT),
    source: Optional[str] = Query(
        None, description="Filter to one source: calendar | plaid | alpaca."
    ),
    after: Optional[str] = Query(
        None,
        description="Only rows with record_date >= this value (YYYY-MM-DD[ HH:MM:SS]).",
    ),
    before: Optional[str] = Query(
        None,
        description="Only rows with record_date <= this value (YYYY-MM-DD[ HH:MM:SS]).",
    ),
    _auth: None = Depends(require_auth),
    state: ServiceState = Depends(require_ready),
):
    logger.info(
        "Received query",
        query=q,
        limit=limit,
        source=source,
        after=after,
        before=before,
    )

    # require_ready() guarantees state.ready (model is not None); assert
    # narrows the type for mypy and doubles as a cheap runtime safety net.
    assert state.model is not None
    # encode()'s stub return type is a broad union including list[Tensor],
    # which lacks .tolist() — with default params (no convert_to_tensor) it
    # always returns an ndarray at runtime, which does have it.
    query_vector = state.model.encode([q], normalize_embeddings=True).tolist()  # type: ignore[union-attr]
    where = _build_where(source, after, before)

    results = state.collection.query(
        query_embeddings=query_vector,
        n_results=limit,
        where=where,
    )

    formatted = []
    ids = results.get("ids") or [[]]
    if ids and ids[0]:
        for i in range(len(ids[0])):
            distance = float(results["distances"][0][i])
            formatted.append(
                {
                    "row_id": results["ids"][0][i],
                    "document": results["documents"][0][i],
                    "source": results["metadatas"][0][i].get("source_system"),
                    "record_date": results["metadatas"][0][i].get("record_date"),
                    "distance": distance,
                    "similarity": 1 - distance,
                }
            )

    return {"query": q, "results": formatted}
