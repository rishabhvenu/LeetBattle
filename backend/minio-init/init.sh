#!/bin/sh

# Wait for MinIO to be ready
sleep 5

# Configure mc (MinIO Client)
mc alias set myminio http://minio:9000 minioadmin minioadmin123

# Create bucket if it doesn't exist
mc mb myminio/codeclashers-avatars --ignore-existing

# Set public read policy on the bucket
mc anonymous set download myminio/codeclashers-avatars

# Set CORS policy for the bucket
cat > /tmp/cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
}
EOF

mc cors set /tmp/cors.json myminio/codeclashers-avatars

echo "MinIO initialization complete!"

