from typing import Callable, Optional, Sequence, TypeVar, TypedDict, Union

from slack_sdk.web.slack_response import SlackResponse

from scripts.observer.models import NetworkType, UnwrappingEvent, WrappingEvent


class _Field(TypedDict):
    title: str
    value: str


T = TypeVar("T")
U = TypeVar("U")


def _map(value: Optional[T], mapper: Callable[[T], U]) -> Optional[U]:
    if value is not None:
        return mapper(value)

    return None


def _first_from_fields(
    fields: Sequence[_Field], title: str, comparer: Callable[[str, str], bool]
) -> Optional[str]:
    for field in fields:
        if comparer(field["title"], title):
            return field["value"]

    return None


def parse_slack_response(
    message: SlackResponse,
) -> Optional[Union[UnwrappingEvent, WrappingEvent]]:
    if "attachments" not in message:
        return None

    attachment = message["attachments"][0]

    if "fields" not in attachment:
        return None

    fields = attachment["fields"]

    sender = _first_from_fields(fields, "sender", lambda x, y: y in x)
    recipient = _first_from_fields(fields, "recipient", lambda x, y: y in x)
    amount = _first_from_fields(fields, "amount", lambda x, y: y == x)
    fee = _first_from_fields(fields, "fee", lambda x, y: y == x)

    fee = _map(fee, float)

    nc_tx = _first_from_fields(fields, "9c network transaction", lambda x, y: y == x)
    eth_tx = _first_from_fields(
        fields, "Ethereum network transaction", lambda x, y: x == y
    )
    refund_tx = _first_from_fields(fields, "refund transaction", lambda x, y: y == x)
    refund_amount = _first_from_fields(fields, "refund amount", lambda x, y: y == x)

    if nc_tx is None or eth_tx is None:
        return None

    nc_tx = nc_tx.replace("<", "").replace(">", "")
    eth_tx = eth_tx.replace("<", "").replace(">", "")

    refund_tx = _map(refund_tx, lambda x: x.replace("<", "").replace(">", ""))

    import urllib3.util.url

    nc_txid = urllib3.util.url.parse_url(nc_tx).query

    refund_txid: Optional[str] = None
    if refund_tx is not None:
        refund_txid = urllib3.util.url.parse_url(refund_tx).query

    if refund_amount is not None:
        refund_amount = float(refund_amount)

    try:
        network_type = NetworkType(urllib3.util.url.parse_url(nc_tx).path.split("/")[1])
    except ValueError:
        return None

    if network_type != NetworkType.MAINNET:
        return None

    eth_txid = urllib3.util.url.parse_url(eth_tx).path.split("/")[-1]

    text: str = message["text"]
    if text.startswith("wNCG → NCG"):  # WNCG to NCG
        return UnwrappingEvent(
            network_type,
            message["ts"],
            sender,
            recipient,
            amount,
            eth_txid,
            nc_txid,
        )
    elif text.startswith("NCG → wNCG"):  # NCG to WNCG
        return WrappingEvent(
            network_type,
            message["ts"],
            sender,
            recipient,
            amount,
            fee,
            nc_txid,
            eth_txid,
            refund_txid,
            refund_amount,
        )
    else:
        return None
