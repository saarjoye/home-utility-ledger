FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_DATA_DIR=/data \
    PORT=3000

WORKDIR /app

COPY app ./app
COPY public ./public

RUN mkdir -p /data

EXPOSE 3000

CMD ["python", "-m", "app.server"]
