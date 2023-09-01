#!/bin/bash

set -e

ETHERSCAN_API_KEY="$1"
SLACK_BOT_TOKEN="$2"
SLACK_CHANNEL="$3"

ETHERSCAN_API_ENDPOINT='https://api.etherscan.io'
CONTRACT_ADDRESS='0xf203ca1769ca8e9e8fe1da9d147db68b6c919817'
BRIDGE_NC_ADDRESS='0x9093dd96c4bb6b44a9e0a522e2de49641f146223'
BRIDGE_ETHEREUM_ADDRESS='0x4A2FbE06004e37dE6Fe7Da59a53D14a407Def0ed'
BRIDGE_ETHEREUM_SAFE_EXECUTOR_ADDRESS='0x241085D7772E12740d6b1420043F04C51Cb3B45A'
BRIDGE_BSC_OPERATOR_ADDRESS='0x4f2b59A8779aea05e5187312FFCb5E8d751cC4CA'

GRAPHQL_API_ENDPOINT='https://9c-main-full-state.nine-chronicles.com'

function get_total_supply() {
    local raw_total_supply=$(curl "$ETHERSCAN_API_ENDPOINT/api?module=stats&action=tokensupply&contractaddress=$CONTRACT_ADDRESS&apiKey=$ETHERSCAN_API_KEY" -s | jq '.result' -r)
    echo "scale=18; $raw_total_supply / 10^18" | bc -l
}

function get_eth_balance() {
    local ADDRESS="$1"

    local raw_balance=$(curl "$ETHERSCAN_API_ENDPOINT/api?module=account&action=balance&address=$ADDRESS&apiKey=$ETHERSCAN_API_KEY" -s | jq '.result' -r)
    echo "scale=18; $raw_balance / 10^18" | bc -l
}

function get_gold_balance() {
    local ADDRESS="$1"
   
    local OPERATION_NAME='GetGoldBalance'
    local GOLD_BALANCE_QUERY="query $OPERATION_NAME(\$address: Address!) { goldBalance(address: \$address) }"
    local VARIABLES="{\"address\": \"$ADDRESS\"}"
    local DATA="{\"operationName\": \"$OPERATION_NAME\", \"query\": \"$GOLD_BALANCE_QUERY\", \"variables\": $VARIABLES}"

    curl "$GRAPHQL_API_ENDPOINT/graphql" --request POST -H "Content-Type: application/json" --data "$DATA" -s \
        | jq '.data.goldBalance' -r
}

TOTAL_SUPPLY=$(get_total_supply)
GOLD_BALANCE=$(get_gold_balance "$BRIDGE_NC_ADDRESS")
ETH_BALANCE=$(get_eth_balance "$BRIDGE_ETHEREUM_ADDRESS")
ETH_BALANCE_THRESHOLD=0.5
ETH_SAFE_EXECUTOR_BALANCE=$(get_eth_balance "$BRIDGE_ETHEREUM_SAFE_EXECUTOR_ADDRESS")
ETH_SAFE_EXECUTOR_THRESHOLD=2
ETH_BRIDGE_BSC_OPERATOR_BALANCE=$(get_eth_balance "$BRIDGE_BSC_OPERATOR_ADDRESS")
ETH_BRIDGE_BSC_OPERATOR_THRESHOLE=2

# https://etherscan.io/tx/0x851bffbfcb2084bd6ea376b0e799d8111e2b38a04a6eadc74d0c9dbd8c59b7d4
# https://etherscan.io/tx/0x6e7d5d173d2acc7d33f22f4b65da0a33fdfe1a605072e9e70ac1873a7cfe0c18
# https://etherscan.io/tx/0xe388b2cee05340c23838758dda6604506aa17373897647a776344486fd4ce2e9
# https://etherscan.io/tx/0x6d1c74f7ca3e1ce1a77cc6797bbb501652f1f72a3d0f8d6f23ee3680e890ed77
# https://etherscan.io/tx/0xe5677a9bc5a4742bfda137e32e0ac8eeaac1d0b5ad442eb2a6a033eb65c16925
# https://etherscan.io/tx/0x208746218c94414ad008cff71358a3997c4c1aeec9b1e838f040ca21f712d30b
# https://etherscan.io/tx/0xe0a0fbc12a7bee129b49fab027577316ff4cb934cd6b06f7b718a9166f486afb
MINTED_BALANCE=$((54073334 + 30000000 + 450000 + 13000000 + 13000000 + 9000000 + 8515273 + 3000000))

GAP=$(bc <<< "$TOTAL_SUPPLY - $MINTED_BALANCE - $GOLD_BALANCE")

TEXT=":notebook: *9c-bridge report*\\n\
> Currently, there are WNCGs minted manually not through bridge swap process. The total amount is *$MINTED_BALANCE*. So the gap was calculated via:\
\`\`\`total_supply - $MINTED_BALANCE - ncg_balance\`\`\`\\n
:wncg: WNCG Total Supply:                               *$TOTAL_SUPPLY*\\n\
:ncg: NCG Balance:                                           *$GOLD_BALANCE*\\n\
GAP between :wncg: and :ncg::                           *$GAP*
:ether: Ether Safe Contract balance:                  *$ETH_BALANCE*\\n
:ether: Ether Safe Contract Executor balance: *$ETH_SAFE_EXECUTOR_BALANCE*\\n
:ether: Ether Bridge bsc operator balance: *$ETH_BRIDGE_BSC_OPERATOR_BALANCE*\\n"

if [ $(echo "${ETH_BALANCE} <= ${ETH_BALANCE_THRESHOLD}" | bc) -eq 1 ];then
    TEXT+="Ether Balance is lower than the threshold (*$ETH_BALANCE_THRESHOLD ETH*). <!here>\\n"
fi

if [ $(echo "${ETH_SAFE_EXECUTOR_BALANCE} <= ${ETH_SAFE_EXECUTOR_THRESHOLD}" | bc) -eq 1 ];then
    TEXT+="Ether Safe Executor Balance is lower than the threshold (*$ETH_SAFE_EXECUTOR_THRESHOLD ETH*). <!here>\\n"
fi

if [ $(echo "${ETH_BRIDGE_BSC_OPERATOR_BALANCE} <= ${ETH_BRIDGE_BSC_OPERATOR_THRESHOLE}" | bc) -eq 1 ];then
    TEXT+="Ether Bridge BSC Operator Balance is lower than the threshold (*$ETH_BRIDGE_BSC_OPERATOR_THRESHOLE ETH*). <!here>\\n"
fi

DATA="{\"channel\":\"$SLACK_CHANNEL\",\"text\":\"$TEXT\",\"mrkdwn\":true}"
curl "https://slack.com/api/chat.postMessage" --request POST --data "$DATA" -H "Content-Type: application/json; charset=utf-8" -H "Authorization: Bearer $SLACK_BOT_TOKEN" -s
