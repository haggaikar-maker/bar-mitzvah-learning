FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/tmp/cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY tools/text_sync_worker.py /app/tools/text_sync_worker.py
COPY tools/text-sync-runtime/ /app/tools/text-sync-runtime/
COPY src/data/tikkun-torah-layout.json /app/src/data/tikkun-torah-layout.json

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install -r /app/tools/text-sync-runtime/requirements.txt

CMD ["python", "/app/tools/text_sync_worker.py"]
