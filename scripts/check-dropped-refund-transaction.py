from typing import Optional
import requests
import sys

if len(sys.argv) < 1:
    print(sys.argv[0], "[LOGFILE]")
    exit(-1)

LOGFILE = sys.argv[1]

lines = open(LOGFILE).readlines()
logs = [line for line in lines if "[LOG]" in line]


def after(s: str, sub: str):
    return s[s.index(sub) + len(sub) :]


def until(s: str, sub: str):
    return s[: s.index(sub)]


def get_transaction(txid: str) -> dict:
    try:
        return requests.get(f"https://api.9cscan.com/transactions/{txid}").json()
    except:
        raise KeyError(txid)


def try_get_transaction(txid: str) -> Optional[dict]:
    try:
        return get_transaction(txid)
    except:
        return None


def get_amount_from_reason(reason: str) -> float:
    if "The amount" in reason:
        return float(until(after(reason, "The amount("), ")"))
    elif "so refund NCG as " in reason:
        return float(until(after(reason, "so refund NCG as "), ". "))
    else:
        raise ValueError(reason)


TX_DESCRIPTION_STRING = "The transaction's id is"
results = [
    (
        after(logs[index - 1], "Process NineChronicles transaction ").strip(),
        after(log, "[LOG]   ").strip(),
        (after(log, TX_DESCRIPTION_STRING).strip(), try_get_transaction(after(log, TX_DESCRIPTION_STRING).strip())),
    )
    for index, log in enumerate(logs)
    if TX_DESCRIPTION_STRING in log
]

failed_results = [
    (request_txid, get_amount_from_reason(reason), reason, txid)
    for (request_txid, reason, (txid, tx)) in results
    if tx is None
]

print("request_txid,txid,signer,amount,reason")
for request_txid, amount, reason, tx in failed_results:
    request_tx = get_transaction(request_txid)
    signer = request_tx["signer"]
    print(request_txid, ",", tx, ",", signer, ",", amount, ",", f'"{reason}"')
