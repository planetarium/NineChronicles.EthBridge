#!/bin/bash
# Creates bridge-monitor-state and bridge-exchange-histories DynamoDB tables,
# and sets up the EventBridge rule to trigger the Lambda every 5 minutes.
#
# Lambda timeout must be set to 5 minutes (300s) to match the schedule interval.
# EventBridge fires every 5 minutes — Lambda must finish before the next invocation.
#
# Usage:
#   AWS_REGION=us-east-1 LAMBDA_FUNCTION_NAME=bridge-relayer bash bootstrap-dynamodb.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-bridge-relayer}"
SCHEDULE_EXPRESSION="rate(5 minutes)"  # Must match Lambda timeout (300s)

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

# --- EventBridge rule: invoke Lambda every 5 minutes ---
echo ""
echo "Setting up EventBridge schedule (${SCHEDULE_EXPRESSION})..."

RULE_NAME="bridge-relayer-schedule"

RULE_ARN=$(aws events put-rule \
  --region "$REGION" \
  --name "$RULE_NAME" \
  --schedule-expression "$SCHEDULE_EXPRESSION" \
  --state ENABLED \
  --description "Triggers bridge-relayer Lambda every 5 minutes" \
  --query 'RuleArn' \
  --output text)

echo "EventBridge rule created: ${RULE_ARN}"

LAMBDA_ARN=$(aws lambda get-function \
  --region "$REGION" \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --query 'Configuration.FunctionArn' \
  --output text)

# Allow EventBridge to invoke the Lambda
aws lambda add-permission \
  --region "$REGION" \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id "AllowEventBridgeInvoke" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "$RULE_ARN" \
  2>/dev/null || echo "  (permission already exists, skipping)"

aws events put-targets \
  --region "$REGION" \
  --rule "$RULE_NAME" \
  --targets "Id=bridge-relayer-target,Arn=${LAMBDA_ARN}"

echo "EventBridge rule wired to Lambda: ${LAMBDA_FUNCTION_NAME}"

# --- Lambda timeout: enforce 300s (5 minutes) ---
echo ""
echo "Setting Lambda timeout to 300s..."
aws lambda update-function-configuration \
  --region "$REGION" \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --timeout 300

echo ""
echo "Bootstrap complete."
echo "  Schedule : ${SCHEDULE_EXPRESSION}"
echo "  Lambda   : ${LAMBDA_FUNCTION_NAME} (timeout: 300s)"
echo "  Tables   : bridge-monitor-state, bridge-exchange-histories"
