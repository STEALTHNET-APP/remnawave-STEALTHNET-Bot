FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home reports && mkdir /data && chown reports /data
COPY app.py backup.py .
COPY static static
USER reports
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "1", "--no-control-socket", "--timeout", "30", "--access-logfile", "-", "app:app"]
