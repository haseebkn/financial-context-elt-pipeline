FROM quay.io/astronomer/astro-runtime:11.3.0

# Install additional system packages if needed
USER root
RUN apt-get update && apt-get install -y git && apt-get clean && rm -rf /var/lib/apt/lists/*

USER airflow
