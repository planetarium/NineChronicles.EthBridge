import urllib3.util.url

from typing import Callable, Optional, Sequence, TypeVar, TypedDict, Union

from slack_sdk.web.slack_response import SlackResponse

from models import NetworkType, UnwrappingEvent, UnwrappingFailureEvent, WrappingEvent, WrappingFailureEvent, Address, RefundEvent


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

def _parse_wrapping_like_slack_response(message: SlackResponse) -> Optional[Union[UnwrappingEvent, WrappingEvent]]:
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

    nc_tx = _map(nc_tx, lambda x: x.replace("<", "").replace(">", ""))
    eth_tx = _map(eth_tx, lambda x: x.replace("<", "").replace(">", ""))

    refund_tx = _map(refund_tx, lambda x: x.replace("<", "").replace(">", ""))

    nc_txid = _map(nc_tx, lambda x: urllib3.util.url.parse_url(x).query)

    refund_txid: Optional[str] = None
    if refund_tx is not None:
        refund_txid = urllib3.util.url.parse_url(refund_tx).query

    if refund_amount is not None:
        refund_amount = float(refund_amount)

    try:
        network_type = _map(nc_tx, lambda x: NetworkType(urllib3.util.url.parse_url(x).path.split("/")[1]))
    except ValueError:
        return None

    if network_type != NetworkType.MAINNET:
        return None

    eth_txid = _map(eth_tx, lambda x: urllib3.util.url.parse_url(x).path.split("/")[-1])

    text: str = message["text"]
    if text.startswith("wNCG → NCG"):  # WNCG to NCG
        if text.endswith("failed."):
            return UnwrappingFailureEvent(
                network_type,
                message["ts"],
                sender,
                recipient,
                amount,
                eth_txid,
            )
        else:
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
        if text.endswith("failed."):
            return WrappingFailureEvent(
                network_type,
                message["ts"],
                sender,
                recipient,
                amount,
                nc_txid,
            )
        else:
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

def _parse_refund_event_slack_response(message: SlackResponse) -> Optional[RefundEvent]:
    if "attachments" not in message:
        return None

    attachment = message["attachments"][0]

    if "fields" not in attachment:
        return None

    fields = attachment["fields"]

    address: Address = _first_from_fields(fields, "Address", lambda x, y: y == x)
    reason: str = _first_from_fields(fields, "Reason", lambda x, y: y == x)
    request_txid = _map(_map(_first_from_fields(fields, "Request transaction", lambda x, y: y == x), lambda x: x.replace("<", "").replace(">", "")), lambda x: urllib3.util.url.parse_url(x).query)
    refund_txid = request_txid = _map(_map(_first_from_fields(fields, "Refund transaction", lambda x, y: y == x), lambda x: x.replace("<", "").replace(">", "")), lambda x: urllib3.util.url.parse_url(x).query)
    request_amount = _map(_first_from_fields(fields, "Request Amount", lambda x, y: y == x), float)
    refund_amount = _map(_first_from_fields(fields, "Refund Amount", lambda x, y: y == x), float)
    return RefundEvent(
        request_amount=request_amount,
        request_txid=request_txid,
        address=address,
        reason=reason,
        refund_txid=refund_txid,
        refund_amount=refund_amount,
        ts=message["ts"],
        network_type=NetworkType.MAINNET
    )

def parse_slack_response(
    message: SlackResponse,
) -> Optional[Union[RefundEvent, UnwrappingEvent, WrappingEvent]]:
    text: str = message["text"]
    if text.startswith("wNCG → NCG") or text.startswith("NCG → wNCG"):
        return _parse_wrapping_like_slack_response(message)
    elif text.startswith("NCG refund"):  # NCG refund
        return _parse_refund_event_slack_response(message)
    else:
        return None
