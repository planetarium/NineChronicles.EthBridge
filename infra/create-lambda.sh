#!/bin/bash
# Creates the bridge-relayer Lambda function with all required configuration.
# Run this ONCE before the first deploy-lambda.sh.
#
# Prerequisites:
#   - AWS CLI configured with permissions:
#       lambda:CreateFunction, lambda:AddPermission,
#       iam:CreateRole, iam:AttachRolePolicy, iam:PassRole
#   - Copy this file's env var section and fill in actual values
#     (refer to existing EC2 instance environment variables)
#
# Usage:
#   Fill in the variables below, then:
#   bash create-lambda.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-bridge-relayer}"
ROLE_NAME="bridge-relayer-role"

# ---------------------------------------------------------------------------
# Environment variables for the Lambda function.
# Copy values from existing EC2 instances (via SSM or direct SSH).
# ---------------------------------------------------------------------------

# --- Required: NineChronicles GraphQL ---
GRAPHQL_API_ENDPOINT=""         # e.g. https://9c-main-full-state.nine-chronicles.com/graphql
STAGE_HEADLESSES=""             # comma-separated fallback endpoints
JWT_SECRET_KEY=""

# --- Required: KMS (ETH) ---
KMS_PROVIDER_URL=""             # ETH RPC endpoint
KMS_PROVIDER_KEY_ID=""          # AWS KMS key ID
KMS_PROVIDER_REGION=""          # e.g. us-east-1
KMS_PROVIDER_AWS_ACCESSKEY=""
KMS_PROVIDER_AWS_SECRETKEY=""
KMS_PROVIDER_PUBLIC_KEY=""      # base64-encoded uncompressed public key

# --- Required: KMS (BSC) ---
BSC_KMS_PROVIDER_URL=""         # BSC RPC endpoint

# --- Required: Contract Addresses ---
WNCG_CONTRACT_ADDRESS=""        # ETH WNCG contract
BSC_WNCG_CONTRACT_ADDRESS=""    # BSC WNCG contract
NCG_MINTER=""                   # 9c minter address
FEE_COLLECTOR_ADDRESS=""

# --- Required: Multi-planetary ---
PLANET_ODIN_ID=""
PLANET_HEIMDALL_ID=""
ODIN_TO_HEIMDALL_VALUT_ADDRESS=""  # typo matches original code

# --- Required: Fee policy ---
MINIMUM_NCG=""                  # e.g. 100
MAXIMUM_NCG=""                  # e.g. 100000
MAXIMUM_WHITELIST_NCG=""        # e.g. 1000000
BASE_FEE=""                     # e.g. 0.01
BASE_FEE_CRITERION=""           # e.g. 1000
FEE_RANGE_DIVIDER_AMOUNT=""     # e.g. 10000
FEE_RANGE1_RATIO=""             # e.g. 0.01
FEE_RANGE2_RATIO=""             # e.g. 0.02
PRIORITY_FEE=""                 # e.g. 2
GAS_TIP_RATIO=""                # e.g. 1.2
MAX_GAS_PRICE=""                # e.g. 500 (gwei)

# --- Required: Slack ---
SLACK_WEB_TOKEN=""
SLACK_URL=""                    # webhook URL
SLACK_CHANNEL_NAME=""           # e.g. #nine-chronicles-bridge-bot
FAILURE_SUBSCRIBERS=""          # Slack user IDs to mention on failure

# --- Required: OpenSearch ---
OPENSEARCH_ENDPOINT=""
OPENSEARCH_AUTH=""              # user:password
OPENSEARCH_INDEX=""             # e.g. 9c-eth-bridge

# --- Required: Block explorers ---
EXPLORER_ROOT_URL=""            # 9c explorer
ETHERSCAN_ROOT_URL=""           # etherscan URL prefix
NCSCAN_URL=""                   # optional
USE_NCSCAN_URL="false"

# --- Required: Google Sheets ---
USE_GOOGLE_SPREAD_SHEET="false"
GOOGLE_SPREADSHEET_URL=""
GOOGLE_SPREADSHEET_ID=""
GOOGLE_CLIENT_EMAIL=""
GOOGLE_CLIENT_PRIVATE_KEY=""    # JSON private key (escape newlines as \n)
SHEET_MINT=""
SHEET_BURN=""

# --- Required: PagerDuty ---
PAGERDUTY_ROUTING_KEY=""

# --- Optional: Safe multisig (set to false unless using Safe) ---
USE_SAFE_WRAPPED_NCG_MINTER="false"
SAFE_ADDRESS=""
SAFE_TX_SERVICE_URL=""

# ---------------------------------------------------------------------------
# Validation: check required fields
# ---------------------------------------------------------------------------
REQUIRED_VARS=(
    GRAPHQL_API_ENDPOINT STAGE_HEADLESSES JWT_SECRET_KEY
    KMS_PROVIDER_URL KMS_PROVIDER_KEY_ID KMS_PROVIDER_REGION
    KMS_PROVIDER_AWS_ACCESSKEY KMS_PROVIDER_AWS_SECRETKEY KMS_PROVIDER_PUBLIC_KEY
    BSC_KMS_PROVIDER_URL
    WNCG_CONTRACT_ADDRESS BSC_WNCG_CONTRACT_ADDRESS NCG_MINTER FEE_COLLECTOR_ADDRESS
    PLANET_ODIN_ID PLANET_HEIMDALL_ID ODIN_TO_HEIMDALL_VALUT_ADDRESS
    MINIMUM_NCG MAXIMUM_NCG MAXIMUM_WHITELIST_NCG
    BASE_FEE BASE_FEE_CRITERION FEE_RANGE_DIVIDER_AMOUNT
    FEE_RANGE1_RATIO FEE_RANGE2_RATIO PRIORITY_FEE GAS_TIP_RATIO MAX_GAS_PRICE
    SLACK_WEB_TOKEN SLACK_URL SLACK_CHANNEL_NAME FAILURE_SUBSCRIBERS
    OPENSEARCH_ENDPOINT OPENSEARCH_AUTH OPENSEARCH_INDEX
    EXPLORER_ROOT_URL ETHERSCAN_ROOT_URL
    PAGERDUTY_ROUTING_KEY
)

echo "=== Validating required variables ==="
MISSING=0
for VAR in "${REQUIRED_VARS[@]}"; do
    VAL="${!VAR}"
    if [ -z "$VAL" ]; then
        echo "  MISSING: $VAR"
        MISSING=1
    fi
done
if [ "$MISSING" = "1" ]; then
    echo ""
    echo "Fill in the missing variables in this script and re-run."
    exit 1
fi
echo "  All required variables set."

# ---------------------------------------------------------------------------
# Step 1: Create IAM role
# ---------------------------------------------------------------------------
echo ""
echo "[1/3] Creating IAM role: ${ROLE_NAME}..."

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

ROLE_ARN=$(aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "${TRUST_POLICY}" \
    --query 'Role.Arn' \
    --output text 2>/dev/null \
    || aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)

echo "  Role ARN: ${ROLE_ARN}"

# Attach managed policies
for POLICY in \
    "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
    "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"; do
    aws iam attach-role-policy \
        --role-name "${ROLE_NAME}" \
        --policy-arn "${POLICY}" \
        2>/dev/null && echo "  Attached: ${POLICY}" \
        || echo "  Already attached: ${POLICY}"
done

# KMS decrypt permission (inline policy)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name "bridge-relayer-kms" \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": [\"kms:Sign\",\"kms:GetPublicKey\",\"kms:DescribeKey\"],
            \"Resource\": \"arn:aws:kms:${KMS_PROVIDER_REGION}:${ACCOUNT_ID}:key/${KMS_PROVIDER_KEY_ID}\"
        }]
    }"
echo "  KMS policy attached."

echo "  Waiting 10s for IAM role propagation..."
sleep 10

# ---------------------------------------------------------------------------
# Step 2: Build environment variables JSON for Lambda
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Creating Lambda function: ${FUNCTION_NAME}..."

# Build the --environment Variables=... string
ENV_VARS="Variables={"
ENV_VARS+="GRAPHQL_API_ENDPOINT=${GRAPHQL_API_ENDPOINT},"
ENV_VARS+="STAGE_HEADLESSES=${STAGE_HEADLESSES},"
ENV_VARS+="JWT_SECRET_KEY=${JWT_SECRET_KEY},"
ENV_VARS+="KMS_PROVIDER_URL=${KMS_PROVIDER_URL},"
ENV_VARS+="KMS_PROVIDER_KEY_ID=${KMS_PROVIDER_KEY_ID},"
ENV_VARS+="KMS_PROVIDER_REGION=${KMS_PROVIDER_REGION},"
ENV_VARS+="KMS_PROVIDER_AWS_ACCESSKEY=${KMS_PROVIDER_AWS_ACCESSKEY},"
ENV_VARS+="KMS_PROVIDER_AWS_SECRETKEY=${KMS_PROVIDER_AWS_SECRETKEY},"
ENV_VARS+="KMS_PROVIDER_PUBLIC_KEY=${KMS_PROVIDER_PUBLIC_KEY},"
ENV_VARS+="BSC_KMS_PROVIDER_URL=${BSC_KMS_PROVIDER_URL},"
ENV_VARS+="WNCG_CONTRACT_ADDRESS=${WNCG_CONTRACT_ADDRESS},"
ENV_VARS+="BSC_WNCG_CONTRACT_ADDRESS=${BSC_WNCG_CONTRACT_ADDRESS},"
ENV_VARS+="NCG_MINTER=${NCG_MINTER},"
ENV_VARS+="FEE_COLLECTOR_ADDRESS=${FEE_COLLECTOR_ADDRESS},"
ENV_VARS+="PLANET_ODIN_ID=${PLANET_ODIN_ID},"
ENV_VARS+="PLANET_HEIMDALL_ID=${PLANET_HEIMDALL_ID},"
ENV_VARS+="ODIN_TO_HEIMDALL_VALUT_ADDRESS=${ODIN_TO_HEIMDALL_VALUT_ADDRESS},"
ENV_VARS+="MINIMUM_NCG=${MINIMUM_NCG},"
ENV_VARS+="MAXIMUM_NCG=${MAXIMUM_NCG},"
ENV_VARS+="MAXIMUM_WHITELIST_NCG=${MAXIMUM_WHITELIST_NCG},"
ENV_VARS+="BASE_FEE=${BASE_FEE},"
ENV_VARS+="BASE_FEE_CRITERION=${BASE_FEE_CRITERION},"
ENV_VARS+="FEE_RANGE_DIVIDER_AMOUNT=${FEE_RANGE_DIVIDER_AMOUNT},"
ENV_VARS+="FEE_RANGE1_RATIO=${FEE_RANGE1_RATIO},"
ENV_VARS+="FEE_RANGE2_RATIO=${FEE_RANGE2_RATIO},"
ENV_VARS+="PRIORITY_FEE=${PRIORITY_FEE},"
ENV_VARS+="GAS_TIP_RATIO=${GAS_TIP_RATIO},"
ENV_VARS+="MAX_GAS_PRICE=${MAX_GAS_PRICE},"
ENV_VARS+="SLACK_WEB_TOKEN=${SLACK_WEB_TOKEN},"
ENV_VARS+="SLACK_URL=${SLACK_URL},"
ENV_VARS+="SLACK_CHANNEL_NAME=${SLACK_CHANNEL_NAME},"
ENV_VARS+="FAILURE_SUBSCRIBERS=${FAILURE_SUBSCRIBERS},"
ENV_VARS+="OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT},"
ENV_VARS+="OPENSEARCH_AUTH=${OPENSEARCH_AUTH},"
ENV_VARS+="OPENSEARCH_INDEX=${OPENSEARCH_INDEX},"
ENV_VARS+="EXPLORER_ROOT_URL=${EXPLORER_ROOT_URL},"
ENV_VARS+="ETHERSCAN_ROOT_URL=${ETHERSCAN_ROOT_URL},"
ENV_VARS+="NCSCAN_URL=${NCSCAN_URL},"
ENV_VARS+="USE_NCSCAN_URL=${USE_NCSCAN_URL},"
ENV_VARS+="USE_GOOGLE_SPREAD_SHEET=${USE_GOOGLE_SPREAD_SHEET},"
ENV_VARS+="GOOGLE_SPREADSHEET_URL=${GOOGLE_SPREADSHEET_URL},"
ENV_VARS+="GOOGLE_SPREADSHEET_ID=${GOOGLE_SPREADSHEET_ID},"
ENV_VARS+="GOOGLE_CLIENT_EMAIL=${GOOGLE_CLIENT_EMAIL},"
ENV_VARS+="GOOGLE_CLIENT_PRIVATE_KEY=${GOOGLE_CLIENT_PRIVATE_KEY},"
ENV_VARS+="SHEET_MINT=${SHEET_MINT},"
ENV_VARS+="SHEET_BURN=${SHEET_BURN},"
ENV_VARS+="PAGERDUTY_ROUTING_KEY=${PAGERDUTY_ROUTING_KEY},"
ENV_VARS+="USE_SAFE_WRAPPED_NCG_MINTER=${USE_SAFE_WRAPPED_NCG_MINTER}"
ENV_VARS+="}"

# Create a minimal placeholder zip (will be overwritten by deploy-lambda.sh)
echo "exports.handler = async () => 'placeholder';" > /tmp/placeholder.js
cd /tmp && zip placeholder.zip placeholder.js > /dev/null

aws lambda create-function \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --role "${ROLE_ARN}" \
    --handler "src/lambda.handler" \
    --zip-file "fileb:///tmp/placeholder.zip" \
    --timeout 300 \
    --memory-size 512 \
    --environment "${ENV_VARS}" \
    --description "NineChronicles ETH+BSC bridge relayer (serverless)" \
    --query 'FunctionArn' \
    --output text | xargs -I{} echo "  Created: {}"

rm /tmp/placeholder.js /tmp/placeholder.zip

# ---------------------------------------------------------------------------
# Step 3: Print next steps
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Done."
echo ""
echo "Next steps:"
echo "  1. Run bootstrap:  bash bootstrap-dynamodb.sh"
echo "  2. Run deploy:     ETH_RPC_URL=... BSC_RPC_URL=... GRAPHQL_API_ENDPOINT=... bash deploy-lambda.sh"
echo "  3. Verify:         aws lambda invoke --function-name ${FUNCTION_NAME} --region ${REGION} /tmp/out.json && cat /tmp/out.json"
echo "  4. E2E test:       cd ../bridge && pnpm e2e:live"
echo "  5. Terminate EC2 instances after confirming stable operation."
