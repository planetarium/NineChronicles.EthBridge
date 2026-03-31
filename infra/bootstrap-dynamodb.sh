#!/bin/bash
# Creates bridge-monitor-state and bridge-exchange-histories DynamoDB tables
# Usage: AWS_REGION=us-east-1 bash bootstrap-dynamodb.sh

set -e

REGION="${AWS_REGION:-us-east-1}"

echo "Creating DynamoDB tables in region: ${REGION}"

# bridge-monitor-state table
echo "Creating bridge-monitor-state..."
aws dynamodb create-table \
  --region "$REGION" \
  --table-name bridge-monitor-state \
  --attribute-definitions AttributeName=network,AttributeType=S \
  --key-schema AttributeName=network,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

echo "Waiting for bridge-monitor-state to become active..."
aws dynamodb wait table-exists \
  --region "$REGION" \
  --table-name bridge-monitor-state

echo "bridge-monitor-state created."

# bridge-exchange-histories table with GSI
echo "Creating bridge-exchange-histories..."
aws dynamodb create-table \
  --region "$REGION" \
  --table-name bridge-exchange-histories \
  --attribute-definitions \
    AttributeName=tx_id,AttributeType=S \
    AttributeName=network,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=tx_id,KeyType=HASH \
  --global-secondary-indexes '[
    {
      "IndexName": "network-timestamp-index",
      "KeySchema": [
        {"AttributeName": "network", "KeyType": "HASH"},
        {"AttributeName": "timestamp", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST

echo "Waiting for bridge-exchange-histories to become active..."
aws dynamodb wait table-exists \
  --region "$REGION" \
  --table-name bridge-exchange-histories

echo "bridge-exchange-histories created."

echo ""
echo "All DynamoDB tables created successfully."
