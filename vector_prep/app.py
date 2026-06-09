import os
import sys

# Ensure vector_prep directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import torch
import structlog
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
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
        "metric": "L2 Space"
    }

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 5):
    """Executes semantic vector search using GPU embeddings."""
    logger.info("Received query", query=q, limit=limit)
    try:
        # Generate query vector on GPU
        query_vector = model.encode([q]).tolist()
        
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

@app.get("/", response_class=HTMLResponse)
def index():
    """Serves the main single-page application dashboard."""
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Semantic Context Explorer</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg-primary: #0a0e17;
                --bg-secondary: rgba(18, 26, 44, 0.6);
                --accent-cyan: #00f2fe;
                --accent-purple: #4facfe;
                --text-primary: #f3f4f6;
                --text-secondary: #9ca3af;
                --border-color: rgba(255, 255, 255, 0.08);
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: 'Outfit', sans-serif;
                background-color: var(--bg-primary);
                background-image: 
                    radial-gradient(at 10% 20%, rgba(0, 242, 254, 0.05) 0px, transparent 50%),
                    radial-gradient(at 90% 80%, rgba(79, 172, 254, 0.05) 0px, transparent 50%);
                color: var(--text-primary);
                min-height: 100vh;
                padding: 2rem;
            }

            .container {
                max-width: 1100px;
                margin: 0 auto;
            }

            header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2rem;
                padding-bottom: 1rem;
                border-bottom: 1px solid var(--border-color);
            }

            h1 {
                font-size: 2.2rem;
                font-weight: 700;
                background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: -0.5px;
            }

            .badge {
                font-size: 0.8rem;
                padding: 0.35rem 0.75rem;
                border-radius: 9999px;
                font-weight: 600;
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .badge-source {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-primary);
            }

            .badge-plaid {
                background: rgba(59, 130, 246, 0.15);
                color: #60a5fa;
                border: 1px solid rgba(59, 130, 246, 0.3);
            }

            .badge-alpaca {
                background: rgba(16, 185, 129, 0.15);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.3);
            }

            .badge-calendar {
                background: rgba(245, 158, 11, 0.15);
                color: #fbbf24;
                border: 1px solid rgba(245, 158, 11, 0.3);
            }

            /* Stats Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 1rem;
                margin-bottom: 2rem;
            }

            .stat-card {
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 12px;
                padding: 1.25rem;
                backdrop-filter: blur(12px);
                transition: transform 0.2s;
            }

            .stat-card:hover {
                transform: translateY(-2px);
            }

            .stat-label {
                font-size: 0.85rem;
                color: var(--text-secondary);
                margin-bottom: 0.5rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .stat-value {
                font-size: 1.25rem;
                font-weight: 600;
                color: var(--text-primary);
                font-family: 'JetBrains Mono', monospace;
            }

            /* Search Panel */
            .search-panel {
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 2rem;
                margin-bottom: 2rem;
                backdrop-filter: blur(12px);
            }

            .search-box {
                display: flex;
                gap: 1rem;
                position: relative;
            }

            .search-input {
                flex: 1;
                background: rgba(10, 14, 23, 0.8);
                border: 1px solid var(--border-color);
                border-radius: 10px;
                padding: 1rem 1.5rem;
                color: var(--text-primary);
                font-family: inherit;
                font-size: 1.1rem;
                outline: none;
                transition: border-color 0.2s, box-shadow 0.2s;
            }

            .search-input:focus {
                border-color: var(--accent-cyan);
                box-shadow: 0 0 15px rgba(0, 242, 254, 0.15);
            }

            .search-btn {
                background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
                border: none;
                border-radius: 10px;
                padding: 1rem 2rem;
                color: #000;
                font-weight: 700;
                font-size: 1rem;
                font-family: inherit;
                cursor: pointer;
                transition: opacity 0.2s, transform 0.1s;
            }

            .search-btn:hover {
                opacity: 0.9;
            }

            .search-btn:active {
                transform: scale(0.98);
            }

            /* Results Section */
            .results-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 1.5rem;
            }

            .results-title {
                font-size: 1.3rem;
                font-weight: 600;
            }

            .results-grid {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }

            .result-card {
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 14px;
                padding: 1.5rem;
                backdrop-filter: blur(12px);
                transition: border-color 0.2s, transform 0.2s;
                position: relative;
                overflow: hidden;
            }

            .result-card::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 4px;
                background: var(--accent-purple);
                opacity: 0.6;
            }

            .result-card:hover {
                border-color: rgba(255, 255, 255, 0.15);
                transform: translateX(4px);
            }

            .result-top {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 1rem;
            }

            .result-text {
                font-size: 1.1rem;
                line-height: 1.6;
                color: var(--text-primary);
                margin-bottom: 1rem;
            }

            .result-bottom {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.85rem;
                color: var(--text-secondary);
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                padding-top: 0.75rem;
            }

            .result-id {
                font-family: 'JetBrains Mono', monospace;
            }

            .distance-indicator {
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }

            .distance-bar {
                width: 60px;
                height: 6px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                overflow: hidden;
            }

            .distance-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--accent-cyan), var(--accent-purple));
            }

            .no-results {
                text-align: center;
                padding: 3rem;
                color: var(--text-secondary);
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 12px;
            }

            .loading-spinner {
                display: inline-block;
                width: 20px;
                height: 20px;
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-radius: 50%;
                border-top-color: var(--accent-cyan);
                animation: spin 0.8s ease-in-out infinite;
                margin-right: 0.5rem;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div>
                    <h1>Semantic Context Explorer</h1>
                    <p style="color: var(--text-secondary); font-size: 0.95rem; margin-top: 0.25rem;">
                        Vectorized Context Data Warehouse Visualizer
                    </p>
                </div>
                <div style="text-align: right;">
                    <span class="badge" style="background: rgba(0, 242, 254, 0.1); color: var(--accent-cyan); border: 1px solid rgba(0, 242, 254, 0.3)">
                        Local GPU Pipeline
                    </span>
                </div>
            </header>

            <!-- Stats Bar -->
            <div class="stats-grid" id="stats-container">
                <div class="stat-card">
                    <div class="stat-label">Total Documents</div>
                    <div class="stat-value" id="stat-count">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Compute Device</div>
                    <div class="stat-value" id="stat-device">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Embedding Model</div>
                    <div class="stat-value" id="stat-model">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Metric Space</div>
                    <div class="stat-value" id="stat-metric">-</div>
                </div>
            </div>

            <!-- Search Panel -->
            <div class="search-panel">
                <div class="search-box">
                    <input type="text" id="query-input" class="search-input" placeholder="Type a semantic query (e.g. 'Uber rides', 'Alpaca account balance', 'Meeting with team')..." value="transaction or bank transfer">
                    <button id="search-btn" class="search-btn">Search</button>
                </div>
            </div>

            <!-- Results Section -->
            <div class="results-header">
                <div class="results-title" id="results-title-text">Query Results</div>
                <div style="font-size: 0.9rem; color: var(--text-secondary);" id="results-meta"></div>
            </div>

            <div class="results-grid" id="results-container">
                <div class="no-results">Type a query above to start semantic search.</div>
            </div>
        </div>

        <script>
            // Elements
            const queryInput = document.getElementById('query-input');
            const searchBtn = document.getElementById('search-btn');
            const resultsContainer = document.getElementById('results-container');
            const resultsTitleText = document.getElementById('results-title-text');
            const resultsMeta = document.getElementById('results-meta');

            // Stats Elements
            const statCount = document.getElementById('stat-count');
            const statDevice = document.getElementById('stat-device');
            const statModel = document.getElementById('stat-model');
            const statMetric = document.getElementById('stat-metric');

            // Fetch Dashboard Stats
            async function fetchStats() {
                try {
                    const res = await fetch('/api/stats');
                    const stats = await res.json();
                    statCount.innerText = stats.total_records;
                    statDevice.innerText = stats.device;
                    statModel.innerText = stats.model;
                    statMetric.innerText = stats.metric;
                } catch (err) {
                    console.error("Failed fetching stats", err);
                }
            }

            // Map source system to CSS class and formatted name
            function getSourceDetails(source) {
                const s = (source || '').toLowerCase();
                if (s.includes('plaid')) return { class: 'badge-plaid', label: 'Plaid' };
                if (s.includes('alpaca')) return { class: 'badge-alpaca', label: 'Alpaca' };
                if (s.includes('calendar') || s.includes('google')) return { class: 'badge-calendar', label: 'Google Calendar' };
                return { class: 'badge-source', label: source };
            }

            // Execute Search
            async function executeSearch() {
                const query = queryInput.value.trim();
                if (!query) return;

                // Show loading state
                searchBtn.disabled = true;
                searchBtn.innerHTML = '<span class="loading-spinner"></span>Searching...';
                resultsContainer.innerHTML = '<div class="no-results">Computing semantic vectors and querying ChromaDB...</div>';

                const start = performance.now();
                try {
                    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=5`);
                    const data = await response.json();
                    const duration = ((performance.now() - start) / 1000).toFixed(3);

                    if (data.error) {
                        resultsContainer.innerHTML = `<div class="no-results" style="color: #ef4444;">Error: ${data.error}</div>`;
                        return;
                    }

                    resultsTitleText.innerText = `Semantic Matches for "${query}"`;
                    resultsMeta.innerText = `${data.results.length} results found in ${duration}s`;

                    if (data.results.length === 0) {
                        resultsContainer.innerHTML = '<div class="no-results">No matches found in ChromaDB collection.</div>';
                        return;
                    }

                    resultsContainer.innerHTML = data.results.map(r => {
                        const source = getSourceDetails(r.metadata.source_system);
                        // L2 distance normalization (smaller L2 = more similar)
                        // L2 space usually ranges from 0 to 2 for cosine-normalized models
                        // We will map 0.0 distance to 100% match and 2.0 to 0% match
                        const matchPercentage = Math.max(0, Math.min(100, (1 - (r.distance / 2)) * 100)).toFixed(0);

                        return `
                            <div class="result-card">
                                <div class="result-top">
                                    <span class="badge ${source.class}">${source.label}</span>
                                    <div class="distance-indicator">
                                        <span style="font-size: 0.85rem; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace;">
                                            Match Score: ${matchPercentage}% (L2: ${r.distance.toFixed(4)})
                                        </span>
                                        <div class="distance-bar">
                                            <div class="distance-fill" style="width: ${matchPercentage}%"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="result-text">${r.document}</div>
                                <div class="result-bottom">
                                    <span class="result-id">ID: ${r.id}</span>
                                    <span>Date: ${r.metadata.record_date}</span>
                                </div>
                            </div>
                        `;
                    }).join('');

                } catch (err) {
                    resultsContainer.innerHTML = `<div class="no-results" style="color: #ef4444;">Network Error: ${err.message}</div>`;
                } finally {
                    searchBtn.disabled = false;
                    searchBtn.innerText = 'Search';
                }
            }

            // Event Listeners
            searchBtn.addEventListener('click', executeSearch);
            queryInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') executeSearch();
            });

            // Initialize
            fetchStats().then(() => {
                // Execute initial search on page load
                executeSearch();
            });
        </script>
    </body>
    </html>
    """
    return html_content
