#!/bin/bash
# Script to check registered users in MongoDB on Oracle Cloud VM

set -e

echo "=== Checking MongoDB Pods ==="
k3s kubectl get pods -n codeclashers | grep mongodb

echo ""
echo "=== Getting MongoDB Pod Name ==="
MONGODB_POD=$(k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
              k3s kubectl get pods -n codeclashers | grep mongodb | head -1 | awk '{print $1}')

if [ -z "$MONGODB_POD" ]; then
    echo "Error: Could not find MongoDB pod"
    exit 1
fi

echo "MongoDB Pod: $MONGODB_POD"

echo ""
echo "=== Checking MongoDB Connection ==="
k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh codeclashers --eval "db.adminCommand('ping')" --quiet

echo ""
echo "=== Total Number of Registered Users ==="
k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh codeclashers --eval "db.users.countDocuments()" --quiet

echo ""
echo "=== List of All Users (email, username, createdAt) ==="
k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh codeclashers --eval "db.users.find({}, {email: 1, username: 1, name: 1, createdAt: 1, _id: 0}).sort({createdAt: -1}).pretty()" --quiet

echo ""
echo "=== User Details (Full) ==="
k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh codeclashers --eval "db.users.find().pretty()" --quiet

echo ""
echo "=== Done ==="



