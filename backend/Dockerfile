FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml uv.lock* requirements.txt* ./
RUN pip install --no-cache-dir -U pip \
    && (pip install --no-cache-dir -r requirements.txt 2>/dev/null || pip install --no-cache-dir .)

COPY . .

ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "dmwe_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
