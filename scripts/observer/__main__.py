import time
import datetime
import sys
from typing import Any, Callable, Optional

import slack_sdk

from scripts.observer.models import WrappingEvent, UnwrappingEvent
from scripts.observer.ncscan import get_transaction
from scripts.observer.parser import parse_slack_response

TOKEN = sys.argv[1]
CHANNEL_NAME = sys.argv[2]

client = slack_sdk.web.WebClient(TOKEN)
bot_id = client.users_profile_get().get("profile")["bot_id"]


def get_channel_id_from_channel_name(name: str) -> Optional[str]:
    for channel in client.conversations_list()["channels"]:
        if channel["name"] == name:
            return channel["id"]

    return None


channel_id = get_channel_id_from_channel_name(CHANNEL_NAME)
events = []

OLDEST = "1630854000.0"
LATEST = str(
    (
        datetime.datetime.fromtimestamp(time.time()) - datetime.timedelta(hours=2)
    ).timestamp()
)

cursor = None
while True:
    response = client.conversations_history(
        channel=channel_id, cursor=cursor, oldest=OLDEST, latest=LATEST
    )

    messages = response["messages"]

    events += list(filter(lambda x: x is not None, map(parse_slack_response, messages)))
    if response["response_metadata"] is None:
        break

    cursor = response["response_metadata"]["next_cursor"]


Handler = Callable[[Any], None]
handlers = dict[type, list[Handler]]()


def handle(_type: type) -> Callable[[Handler], None]:
    def decorator(f: Handler) -> None:
        if _type not in handlers:
            handlers[_type] = list()

        handlers[_type].append(f)

    return decorator


total_fee = 0


@handle(WrappingEvent)
def count_total_fee(e: WrappingEvent):
    global total_fee

    total_fee += e.fee


# [request_txid, response_txid, recipient, type, amount]
gone_txs = list[tuple[str, str, str, int]]()


@handle(UnwrappingEvent)
def validate_unwrapping_event(e: UnwrappingEvent):
    txid = e.response_txid
    tx = get_transaction(txid)
    if tx is None:
        gone_txs.append((e.request_txid, txid, e.recipient, "unwrapping", e.amount))
        try:
            messages = client.conversations_replies(channel=channel_id, ts=e.ts).get(
                "messages"
            )
            if any(filter(lambda x: "bot_id" in x and x["bot_id"] == bot_id, messages)):
                return

            client.chat_postMessage(
                channel=channel_id,
                text="@dogeon this transaction seems gone.",
                thread_ts=e.ts,
                as_user=True,
                link_names=True,
            )
        except Exception as exc:
            print("Exception", exc)
            pass


@handle(WrappingEvent)
def validate_wrapping_event(e: WrappingEvent):
    if e.refund_txid is None:
        return

    txid = e.refund_txid
    tx = get_transaction(txid)
    if tx is None:
        gone_txs.append((e.request_txid, txid, e.sender, "refund", e.refund_amount))
        try:
            messages = client.conversations_replies(channel=channel_id, ts=e.ts).get(
                "messages"
            )
            if any(filter(lambda x: "bot_id" in x and x["bot_id"] == bot_id, messages)):
                return

            client.chat_postMessage(
                channel=channel_id,
                text="@dogeon this transaction seems gone.",
                thread_ts=e.ts,
                as_user=True,
            )

        except Exception as exc:
            print("Exception", exc)
            pass


for event in events:
    t = type(event)
    if t in handlers:
        for handler in handlers[t]:
            handler(event)

print("Earned", total_fee, "NCG")
print(*gone_txs, sep="\n")
