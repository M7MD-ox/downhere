FROM python:3.12-slim

# Install FFmpeg, Node.js (for yt-dlp JS challenges), and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast, reproducible dependency installation
RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --frozen || uv sync --no-dev

COPY server/ ./server/
COPY src/ ./src/
COPY public/ ./public/
COPY run_app.py ./

ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["uv", "run", "python", "run_app.py"]
