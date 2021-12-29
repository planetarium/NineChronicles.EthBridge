import urllib3.util.url

from typing import Callable, Optional, Sequence, TypeVar, TypedDict, Union, cast

from slack_sdk.web.slack_response import SlackResponse

from models import NetworkType, UnwrappingEvent, UnwrappingFailureEvent, WrappingEvent, WrappingFailureEvent, Address, RefundEvent
from scripts.observer.models import SlackMessage, TxId


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

def _parse_wrapping_like_slack_response(message: SlackResponse) -> Optional[Union[WrappingFailureEvent, UnwrappingFailureEvent, UnwrappingEvent, WrappingEvent]]:
    if "attachments" not in message:
        return None

    attachment = message["attachments"][0]

    if "fields" not in attachment:
        return None

    fields = attachment["fields"]

    text: str = message["text"]
    if text.startswith("wNCG → NCG"):  # WNCG to NCG
        if text.endswith("failed."):
            return _parse_unwrapping_failure_event(message["ts"], fields)
        else:
            return _parse_unwrapping_event(message["ts"], fields)
    elif text.startswith("NCG → wNCG"):  # NCG to WNCG
        if text.endswith("failed."):
            return _parse_wrapping_failure_event(message["ts"], fields)
        else:
            return _parse_wrapping_event(message["ts"], fields)
    else:
        return None

def _parse_refund_event_slack_response(message: SlackResponse) -> Optional[RefundEvent]:
    if "attachments" not in message:
        return None

    attachment: dict = message["attachments"][0]

    if "fields" not in attachment:
        return None

    fields = attachment["fields"]

    address: Address = Address(fields["Address"])
    reason: str = fields["Reason"]
    request_txid = urllib3.util.url.parse_url(fields["Request transaction"].replace("<", "").replace(">", "")).query
    refund_txid = urllib3.util.url.parse_url(fields["Refund transaction"].replace("<", "").replace(">", "")).query
    request_amount = float(fields["Request Amount"])
    refund_amount = float(fields["Refund Amount"])
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

def _parse_wrapping_event(ts: str, fields: dict[str, str]) -> WrappingEvent:
    sender: Address = Address(fields["sender (NineChronicles)"])
    recipient: Address = Address(fields["recipient (Ethereum)"])
    amount: float = float(fields["amount"])
    fee: float = float(fields["fee"])

    nc_tx = fields["9c network transaction"].replace("<", "").replace(">", "")
    eth_tx = fields["Ethereum network transaction"].replace("<", "").replace(">", "")

    refund_txid: Optional[TxId] = _map(fields.get("refund transaction"), lambda x: TxId(urllib3.util.url.parse_url(x.replace("<", "").replace(">", "")).query))
    refund_amount = _map(fields.get("refund amount"), float)

    nc_txid: TxId = TxId(urllib3.util.url.parse_url(nc_tx).query)

    network_type = NetworkType(urllib3.util.url.parse_url(nc_tx).path.split("/")[1])
    eth_txid = TxId(urllib3.util.url.parse_url(eth_tx).path.split("/")[-1])

    return WrappingEvent(
        network_type,
        ts,
        sender,
        recipient,
        amount,
        fee,
        nc_txid,
        eth_txid,
        refund_txid,
        refund_amount,
    )

def _parse_wrapping_failure_event(ts: str, fields: dict[str, str]) -> WrappingFailureEvent:
    sender: Address = Address(fields["sender (NineChronicles)"])
    recipient: Address = Address(fields["recipient (Ethereum)"])
    amount: float = float(fields["amount"])

    nc_tx = fields["9c network transaction"].replace("<", "").replace(">", "")
    nc_txid: TxId = TxId(urllib3.util.url.parse_url(nc_tx).query)

    network_type = NetworkType(urllib3.util.url.parse_url(nc_tx).path.split("/")[1])

    return WrappingFailureEvent(
        network_type,
        ts,
        sender,
        recipient,
        amount,
        nc_txid,
    )

def _parse_unwrapping_event(ts: str, fields: dict[str, str]) -> UnwrappingEvent:
    sender: Address = Address(fields["sender (NineChronicles)"])
    recipient: Address = Address(fields["recipient (Ethereum)"])
    amount: float = float(fields["amount"])

    nc_tx = fields["9c network transaction"].replace("<", "").replace(">", "")
    eth_tx = fields["Ethereum network transaction"].replace("<", "").replace(">", "")

    nc_txid: TxId = TxId(urllib3.util.url.parse_url(nc_tx).query)

    network_type = NetworkType(urllib3.util.url.parse_url(nc_tx).path.split("/")[1])
    eth_txid = TxId(urllib3.util.url.parse_url(eth_tx).path.split("/")[-1])

    return UnwrappingEvent(
        network_type,
        ts,
        sender,
        recipient,
        amount,
        eth_txid,
        nc_txid,
    )


def _parse_unwrapping_failure_event(ts: str, fields: dict[str, str]) -> UnwrappingFailureEvent:
    sender: Address = Address(fields["sender (NineChronicles)"])
    recipient: Address = Address(fields["recipient (Ethereum)"])
    amount: float = float(fields["amount"])

    nc_tx = fields["9c network transaction"].replace("<", "").replace(">", "")
    eth_tx = fields["Ethereum network transaction"].replace("<", "").replace(">", "")

    nc_txid: TxId = TxId(urllib3.util.url.parse_url(nc_tx).query)

    network_type = NetworkType(urllib3.util.url.parse_url(nc_tx).path.split("/")[1])
    eth_txid = TxId(urllib3.util.url.parse_url(eth_tx).path.split("/")[-1])

    return UnwrappingFailureEvent(
        network_type,
        ts,
        sender,
        recipient,
        amount,
        eth_txid,
    )

def parse_slack_response(
    message: SlackResponse,
) -> Optional[Union[RefundEvent, UnwrappingEvent, WrappingEvent, UnwrappingFailureEvent, WrappingFailureEvent]]:
    text: str = message["text"]
    if text.startswith("wNCG → NCG") or text.startswith("NCG → wNCG"):
        return _parse_wrapping_like_slack_response(message)
    elif text.startswith("NCG refund"):  # NCG refund
        return _parse_refund_event_slack_response(message)
    else:
        return None
