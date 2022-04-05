#!/bin/bash

set -e

ETHERSCAN_API_KEY="$1"
SLACK_BOT_TOKEN="$2"
SLACK_CHANNEL="$3"

ETHERSCAN_API_ENDPOINT='https://api.etherscan.io'
CONTRACT_ADDRESS='0xf203ca1769ca8e9e8fe1da9d147db68b6c919817'
BRIDGE_ADDRESS='0x9093dd96c4bb6b44a9e0a522e2de49641f146223'

GRAPHQL_API_ENDPOINT='https://9c-main-full-state.planetarium.dev'

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
GOLD_BALANCE=$(get_gold_balance "$BRIDGE_ADDRESS")
ETH_BALANCE=$(get_eth_balance "$BRIDGE_ADDRESS")
ETH_BALANCE_THRESHOLD=3

# https://etherscan.io/tx/0x851bffbfcb2084bd6ea376b0e799d8111e2b38a04a6eadc74d0c9dbd8c59b7d4
MINTED_BALANCE=$((54073334 + 30000000))

GAP=$(bc <<< "$TOTAL_SUPPLY - $MINTED_BALANCE - $GOLD_BALANCE")

TEXT=":notebook: *9c-bridge report*\\n\
> Currently, there are WNCGs minted manually not through bridge swap process. The total amount is *$MINTED_BALANCE*. So the gap was calculated via:\
\`\`\`total_supply - $MINTED_BALANCE - ncg_balance\`\`\`\\n
:wncg: WNCG Total Supply:     *$TOTAL_SUPPLY*\\n\
:donggeul_01: NCG Balance:                *$GOLD_BALANCE*\\n\
GAP between :wncg: and :donggeul_01:: *$GAP*
:ether: Ether balance:                *$ETH_BALANCE*\\n"

if [ $(echo "${ETH_BALANCE} <= ${ETH_BALANCE_THRESHOLD}" | bc) -eq 1 ];then
    TEXT+="Ether Balance is lower than the threshold (*$ETH_BALANCE_THRESHOLD ETH*). <!here>\\n"
fi

DATA="{\"channel\":\"$SLACK_CHANNEL\",\"text\":\"$TEXT\",\"mrkdwn\":true}"
curl "https://slack.com/api/chat.postMessage" --request POST --data "$DATA" -H "Content-Type: application/json; charset=utf-8" -H "Authorization: Bearer $SLACK_BOT_TOKEN" -s
