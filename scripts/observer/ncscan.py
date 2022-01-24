from typing import Optional
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
