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

GAP=$(bc <<< "$TOTAL_SUPPLY - 54073334 - $GOLD_BALANCE")

TEXT=":notebook: *9c-bridge report*\\n\
> Currently, there are WNCGs minted manually not through bridge swap process. The total amount is *44,073,334*. So the gap was calculated via:\
\`\`\`total_supply - 44073334 - ncg_balance\`\`\`\\n
:wncg: WNCG Total Supply:     *$TOTAL_SUPPLY*\\n\
:donggeul_01: NCG Balance:                *$GOLD_BALANCE*\\n\
GAP between :wncg: and :donggeul_01:: *$GAP*
:ether: Ether balance:                *$ETH_BALANCE*\\n"

DATA="{\"channel\":\"$SLACK_CHANNEL\",\"text\":\"$TEXT\",\"mrkdwn\":true}"
curl "https://slack.com/api/chat.postMessage" --request POST --data "$DATA" -H "Content-Type: application/json; charset=utf-8" -H "Authorization: Bearer $SLACK_BOT_TOKEN" -s
