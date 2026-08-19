# syntax=docker/dockerfile:1
FROM python:3.11-slim AS runtime
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY vector_prep/requirements-service.txt vector_prep/requirements-service.txt
RUN pip install --no-cache-dir -r vector_prep/requirements-service.txt

COPY config/ config/
COPY vector_prep/retrieval_service.py vector_prep/retrieval_service.py
COPY vector_prep/vector_client.py vector_prep/vector_client.py

# ChromaDB persistence directory and the sentence-transformers cache both
# need a writable, non-root-owned home — /repo/vector_store is mounted from
# an EFS access point in production (see infra/aws/efs.tf); the cache dir
# is baked in below so cold starts don't re-download the model from HF.
ENV HF_HOME=/repo/.cache/huggingface
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /repo/vector_store /repo/.cache \
    && chown -R appuser:appuser /repo
USER appuser

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

EXPOSE 8100
CMD ["uvicorn", "vector_prep.retrieval_service:app", "--host", "0.0.0.0", "--port", "8100"]
