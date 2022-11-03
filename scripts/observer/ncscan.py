from typing import Any, Dict, List, Optional
import json
import asyncio

import requests

from models import TxId


async def get_transaction(txid: TxId, retries=5) -> Optional[dict]:
    async def retry_get_transaction():
        await asyncio.sleep(1)
        return await get_transaction(txid, retries - 1)

    if retries <= 0:
        return None

    try:
        response = requests.get(f"https://api.9cscan.com/transactions/{txid}")
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            return None
        else:
            return await retry_get_transaction()
    except requests.exceptions.ConnectionError:
        return await retry_get_transaction()
    except json.decoder.JSONDecodeError:
        return await retry_get_transaction()

class TransactionIterator:
    def __init__(self, address: str):
        self.address: str = address
        self.__before: Optional[str] = None
        self.__txs_queue: List[Dict] = []

    def __iter__(self):
        self.__txs_queue: List[Dict] = []
        return self

    def __next__(self) -> dict:
        if len(self.__txs_queue) == 0:
            self.__fill_txs()

        return self.__txs_queue.pop(0)

    def __fill_txs(self):
        before: Dict[str, Any] = {} if self.__before is None else {
            "before": self.__before
        }

        data = requests.get(
            f"https://api.9cscan.com/accounts/{self.address}/transactions",
            params={
                **before,
                "limit": 20,
            }).json()

        self.__before = data["before"]
        for tx in data["transactions"]:
            self.__txs_queue.append(tx)
