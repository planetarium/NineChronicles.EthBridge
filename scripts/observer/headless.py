from typing import Optional
from models import TxId

import requests

async def get_transaction(txid: TxId) -> Optional[dict]:
    QUERY = "query { chainQuery { transactionQuery { transaction(id: \"%s\") { signer nonce } } } }" % txid

    response = requests.post(
        "https://9c-main-full-state.planetarium.dev/graphql",
        json={
            "operationName": None,
            "query": QUERY,
            "variables": {},
        }
    )

    if response.status_code == 200:
        json = response.json()
        if "data" not in json:
            return None
        return json["data"]["chainQuery"]["transactionQuery"]["transaction"]

    return None
