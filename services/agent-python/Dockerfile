# NOTE: build context is the REPO ROOT (see docker-compose.yml `context: .` /
# Render-Fly build instructions in DEPLOY.md) so this Dockerfile can bake the
# catalog seed + regulation corpus into the image. A standalone `docker build`
# from this directory will NOT find ../../data — see DEPLOY.md for the exact
# build command.
FROM python:3.13-slim
WORKDIR /app

# system deps for psycopg
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY services/agent-python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/agent-python/app ./app
# data baked into the image (repo-root build context); docker-compose's volume
# mount overrides this path for local dev so edits show up without a rebuild.
COPY data /data
ENV DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
