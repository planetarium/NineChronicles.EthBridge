#!/bin/bash
# Manual local deploy script for bridge-relayer Lambda.
# Run this instead of using CI/CD to reduce supply chain attack surface.
#
# Prerequisites:
#   - AWS CLI configured with sufficient permissions
#   - pnpm installed
#   - zip installed
#
# Usage:
#   AWS_REGION=us-east-1 \
#   LAMBDA_FUNCTION_NAME=bridge-relayer \
#   ETH_RPC_URL=https://... \
#   BSC_RPC_URL=https://... \
#   GRAPHQL_API_ENDPOINT=https://... \
#   bash deploy-lambda.sh
#
# To skip DynamoDB checkpoint initialization (e.g. already initialized):
#   SKIP_CHECKPOINT_INIT=true bash deploy-lambda.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-bridge-relayer}"
SKIP_CHECKPOINT_INIT="${SKIP_CHECKPOINT_INIT:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="${SCRIPT_DIR}/../bridge"
BUILD_DIR="${BRIDGE_DIR}/dist"
PACKAGE_DIR="/tmp/lambda-package-$$"
ZIP_PATH="/tmp/bridge-relayer-$$.zip"

echo "=== Bridge Relayer Lambda Deploy ==="
echo "  Region        : ${REGION}"
echo "  Function      : ${LAMBDA_FUNCTION_NAME}"
echo "  Skip checkpoint init: ${SKIP_CHECKPOINT_INIT}"
echo ""

# --- Step 1: Build TypeScript ---
echo "[1/4] Building TypeScript..."
cd "${BRIDGE_DIR}"
pnpm install --frozen-lockfile
pnpm build
echo "  Build complete: ${BUILD_DIR}"

# --- Step 2: Package Lambda zip ---
echo ""
echo "[2/4] Packaging Lambda zip..."
rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}"

# Copy compiled output
cp -r "${BUILD_DIR}/." "${PACKAGE_DIR}/"

# Copy production node_modules (exclude devDependencies)
cp -r "${BRIDGE_DIR}/node_modules" "${PACKAGE_DIR}/node_modules"

# Remove dev-only packages to reduce zip size (best-effort)
for pkg in \
    "@babel" \
    "jest" \
    "jest-cli" \
    "jest-config" \
    "babel-jest" \
    "prettier" \
    "eslint" \
    "husky" \
    "lint-staged" \
    "ts-node" \
    "typescript" \
    "nyc" \
    "npm-run-all" \
    "web3-core-promievent" \
    "@typescript-eslint"; do
    rm -rf "${PACKAGE_DIR}/node_modules/${pkg}" 2>/dev/null || true
done

# Create zip
rm -f "${ZIP_PATH}"
cd "${PACKAGE_DIR}"
zip -r "${ZIP_PATH}" . -x "*.map" -x "**/*.d.ts" > /dev/null
ZIP_SIZE=$(du -sh "${ZIP_PATH}" | cut -f1)
echo "  Package size: ${ZIP_SIZE} → ${ZIP_PATH}"

# --- Step 3: Deploy to Lambda ---
echo ""
echo "[3/4] Deploying to Lambda..."

# Check if function exists
if aws lambda get-function \
    --region "${REGION}" \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --query 'Configuration.FunctionName' \
    --output text 2>/dev/null | grep -q "${LAMBDA_FUNCTION_NAME}"; then

    echo "  Updating existing function..."
    aws lambda update-function-code \
        --region "${REGION}" \
        --function-name "${LAMBDA_FUNCTION_NAME}" \
        --zip-file "fileb://${ZIP_PATH}" \
        --query 'CodeSize' \
        --output text | xargs -I{} echo "  Deployed: {} bytes"

    # Wait for update to complete
    echo "  Waiting for update to complete..."
    aws lambda wait function-updated \
        --region "${REGION}" \
        --function-name "${LAMBDA_FUNCTION_NAME}"
    echo "  Function updated successfully."
else
    echo "  ERROR: Lambda function '${LAMBDA_FUNCTION_NAME}' not found in region ${REGION}."
    echo "  Create the function first, then re-run this script."
    echo "  (Tip: set up the function via the AWS console or terraform before deploying code.)"
    exit 1
fi

# --- Step 4: Initialize DynamoDB checkpoints ---
echo ""
echo "[4/4] Initializing DynamoDB checkpoints..."

if [ "${SKIP_CHECKPOINT_INIT}" = "true" ]; then
    echo "  Skipped (SKIP_CHECKPOINT_INIT=true)"
else
    # ETH checkpoint
    if [ -z "${ETH_RPC_URL}" ]; then
        echo "  WARNING: ETH_RPC_URL not set, skipping ETH checkpoint"
    else
        echo "  Querying ETH tip block..."
        ETH_TIP_HEX=$(curl -s -X POST "${ETH_RPC_URL}" \
            -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null || echo "")

        if [ -n "${ETH_TIP_HEX}" ]; then
            ETH_TIP=$(python3 -c "print(int('${ETH_TIP_HEX}', 16))" 2>/dev/null || echo "")
            # Get the actual block hash for the tip block
            ETH_BLOCK_HASH=$(curl -s -X POST "${ETH_RPC_URL}" \
                -H 'Content-Type: application/json' \
                -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"${ETH_TIP_HEX}\",false],\"id\":1}" \
                | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['hash'])" 2>/dev/null || echo "")

            if [ -n "${ETH_BLOCK_HASH}" ] && [ -n "${ETH_TIP}" ]; then
                echo "  ETH tip: block ${ETH_TIP} (${ETH_BLOCK_HASH})"
                aws dynamodb put-item \
                    --region "${REGION}" \
                    --table-name bridge-monitor-state \
                    --item "{\"network\":{\"S\":\"ethereum\"},\"blockHash\":{\"S\":\"${ETH_BLOCK_HASH}\"}}" \
                    --condition-expression "attribute_not_exists(network)" \
                    2>/dev/null && echo "  ETH checkpoint written." \
                    || echo "  ETH checkpoint already exists, skipped."
            else
                echo "  WARNING: Could not get ETH block hash, skipping ETH checkpoint"
            fi
        else
            echo "  WARNING: Could not query ETH tip, skipping ETH checkpoint"
        fi
    fi

    # BSC checkpoint
    if [ -z "${BSC_RPC_URL}" ]; then
        echo "  WARNING: BSC_RPC_URL not set, skipping BSC checkpoint"
    else
        echo "  Querying BSC tip block..."
        BSC_TIP_HEX=$(curl -s -X POST "${BSC_RPC_URL}" \
            -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null || echo "")

        if [ -n "${BSC_TIP_HEX}" ]; then
            BSC_TIP=$(python3 -c "print(int('${BSC_TIP_HEX}', 16))" 2>/dev/null || echo "")
            BSC_BLOCK_HASH=$(curl -s -X POST "${BSC_RPC_URL}" \
                -H 'Content-Type: application/json' \
                -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"${BSC_TIP_HEX}\",false],\"id\":1}" \
                | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['hash'])" 2>/dev/null || echo "")

            if [ -n "${BSC_BLOCK_HASH}" ] && [ -n "${BSC_TIP}" ]; then
                echo "  BSC tip: block ${BSC_TIP} (${BSC_BLOCK_HASH})"
                aws dynamodb put-item \
                    --region "${REGION}" \
                    --table-name bridge-monitor-state \
                    --item "{\"network\":{\"S\":\"bsc\"},\"blockHash\":{\"S\":\"${BSC_BLOCK_HASH}\"}}" \
                    --condition-expression "attribute_not_exists(network)" \
                    2>/dev/null && echo "  BSC checkpoint written." \
                    || echo "  BSC checkpoint already exists, skipped."
            else
                echo "  WARNING: Could not get BSC block hash, skipping BSC checkpoint"
            fi
        else
            echo "  WARNING: Could not query BSC tip, skipping BSC checkpoint"
        fi
    fi

    # NineChronicles checkpoint
    if [ -z "${GRAPHQL_API_ENDPOINT}" ]; then
        echo "  WARNING: GRAPHQL_API_ENDPOINT not set, skipping 9c checkpoint"
    else
        echo "  Querying NineChronicles tip block..."
        NC_RESPONSE=$(curl -s -X POST "${GRAPHQL_API_ENDPOINT}" \
            -H 'Content-Type: application/json' \
            -d '{"query":"{ nodeStatus { tip { hash index } } }"}' 2>/dev/null || echo "")

        NC_BLOCK_HASH=$(echo "${NC_RESPONSE}" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d['data']['nodeStatus']['tip']['hash'])" \
            2>/dev/null || echo "")
        NC_TIP=$(echo "${NC_RESPONSE}" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d['data']['nodeStatus']['tip']['index'])" \
            2>/dev/null || echo "")

        if [ -n "${NC_BLOCK_HASH}" ] && [ -n "${NC_TIP}" ]; then
            echo "  9c tip: block ${NC_TIP} (${NC_BLOCK_HASH})"
            aws dynamodb put-item \
                --region "${REGION}" \
                --table-name bridge-monitor-state \
                --item "{\"network\":{\"S\":\"nineChronicles\"},\"blockHash\":{\"S\":\"${NC_BLOCK_HASH}\"}}" \
                --condition-expression "attribute_not_exists(network)" \
                2>/dev/null && echo "  9c checkpoint written." \
                || echo "  9c checkpoint already exists, skipped."
        else
            echo "  WARNING: Could not query 9c tip, skipping 9c checkpoint"
        fi
    fi
fi

# --- Cleanup ---
rm -rf "${PACKAGE_DIR}"
rm -f "${ZIP_PATH}"

echo ""
echo "=== Deploy complete ==="
echo "  Function : ${LAMBDA_FUNCTION_NAME}"
echo "  Region   : ${REGION}"
echo ""
echo "Next steps:"
echo "  1. Verify the Lambda runs clean: aws lambda invoke --function-name ${LAMBDA_FUNCTION_NAME} --region ${REGION} /tmp/lambda-out.json && cat /tmp/lambda-out.json"
echo "  2. Run E2E test locally: cd bridge && pnpm e2e:live"
echo "  3. Once confirmed stable, terminate the old EC2 instances."
