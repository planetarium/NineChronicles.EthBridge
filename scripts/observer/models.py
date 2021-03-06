from dataclasses import dataclass
from enum import Enum
from typing import NewType, Optional


class NetworkType(Enum):
    MAINNET = "9c-main"
    INTERNAL = "9c-internal"


Address = NewType("Address", str)
TxId = NewType("TxId", str)


@dataclass
class SlackMessage:
    network_type: NetworkType
    ts: str


@dataclass
class WrappingEvent(SlackMessage):
    sender: Address  # NineChronicles
    recipient: Address  # Ethereum
    amount: float
    fee: float

    request_txid: TxId
    response_txid: TxId

    refund_txid: Optional[TxId]
    refund_amount: Optional[float]

@dataclass
class RefundEvent(SlackMessage):
    reason: str
    address: Address  # NineChronicles

    request_txid: TxId
    request_amount: float

    refund_txid: TxId
    refund_amount: float


@dataclass
class WrappingFailureEvent(SlackMessage):
    sender: Address  # NineChronicles
    recipient: Address  # Ethereum
    amount: float

    request_txid: TxId


@dataclass
class UnwrappingEvent(SlackMessage):
    sender: Address  # Ethereum
    recipient: Address  # NineChronicles
    amount: float

    request_txid: TxId
    response_txid: TxId

@dataclass
class UnwrappingFailureEvent:
    ts: str
    sender: Address  # Ethereum
    recipient: Address  # NineChronicles
    amount: float

    request_txid: TxId
