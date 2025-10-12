#!/bin/sh

# Wait for MinIO to be ready
sleep 5

# Get credentials from environment variables
MINIO_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-minioadmin}"

# Configure mc (MinIO Client) using environment variables
mc alias set myminio http://minio:9000 "$MINIO_USER" "$MINIO_PASS"

# Create bucket if it doesn't exist
mc mb myminio/codeclashers-avatars --ignore-existing

# Set public read policy on the bucket
mc anonymous set download myminio/codeclashers-avatars

# Set CORS policy for the bucket (restrictive for production)
# Adjust AllowedOrigins based on your deployment
cat > /tmp/cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:3000", "http://localhost:3001"],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
}
EOF

mc cors set /tmp/cors.json myminio/codeclashers-avatars

echo "MinIO initialization complete!"

