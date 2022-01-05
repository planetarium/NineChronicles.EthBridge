from typing import Optional

import requests

from models import TxId


def get_transaction(txid: TxId) -> Optional[dict]:
    try:
        return requests.get(f"https://api.9cscan.com/transactions/{txid.hex()}").json()
    except:
        return None
