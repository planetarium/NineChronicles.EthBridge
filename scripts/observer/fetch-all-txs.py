import bencodex

from ncscan import TransactionIterator

if __name__ == "__main__":
    it = TransactionIterator("0x9093dd96c4bb6b44a9e0a522e2de49641f146223")
    for tx in it:
        if tx["involved"]["type"] == "SIGNED":
            action: dict = bencodex.loads(bytes.fromhex(tx["actions"][0]["raw"]))
            if action["values"]["memo"] and action["values"]["memo"].startswith("0x"):
                print(tx["nonce"], tx["id"], action["type_id"], action["values"]["amount"][1], action["values"]["memo"], tx["timestamp"], sep=",")
