#!/usr/bin/env bash

set -e

# Deploy WNCG contract.
pushd contracts > /dev/null
    rm -rf build
    yarn
    yarn truffle migrate --network ropsten
    contract_address=$(jq '.networks."3".address' ./build/contracts/WrappedNCG.json | tr -d '"')
popd > /dev/null

# Create KMS key.
key_id="16b2c06f-d1bb-4e8a-8c38-0cab0836e816"
public_key=$(aws kms get-public-key \
  --region us-east-2 \
  --key-id "$key_id" | jq ".PublicKey" | tr -d '"' | \
  python3 -c "import base64; print(base64.b64encode(base64.b64decode(input())[23:]).decode('utf-8'))")

pushd contracts > /dev/null
  address=$(node -e "console.log('0x' + require('web3').utils.keccak256('0x' + Buffer.from('$public_key', 'base64').toString('hex').slice(2)).slice(26))")
  yarn truffle exec --network ropsten ./scripts/transfer-ownership.js "$address"
popd > /dev/null

echo "WNCG_CONTRACT_ADDRESS=$contract_address"
echo "KMS_PROVIDER_KEY_ID=$key_id"
echo "KMS_PROVIDER_PUBLIC_KEY=$public_key"
echo "KMS_PROVIDER_ADDRESS=$address"
