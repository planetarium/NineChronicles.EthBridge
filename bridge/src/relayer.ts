import { ethers } from "ethers";
import { ContractDescription } from "./types/contract-description";
import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { IObserver } from "./observers";
import { BlockHash } from "./types/block-hash";
import { EventData } from "web3-eth-contract";
import { TransactionLocation } from "./types/transaction-location";
import { NCGTransferredEvent } from "./types/ncg-transferred-event";

const CONFIRMATIONS = 10;
const ETH_LOGS_CHUNK_SIZE = 2000;
const BURN_EVENT_SIG = "Burn(address,bytes32,uint256)";

export interface EthereumRelayerDeps {
    provider: ethers.providers.JsonRpcProvider;
    contractDescription: ContractDescription;
    monitorStateStore: IMonitorStateStore;
    burnEventObserver: IObserver<{
        blockHash: BlockHash;
        events: (EventData & TransactionLocation)[];
    }>;
    networkKey: string;
}

export interface NineChroniclesRelayerDeps {
    headlessGraphQLClient: IHeadlessGraphQLClient;
    monitorStateStore: IMonitorStateStore;
    ncgTransferredEventObserver: IObserver<{
        blockHash: BlockHash;
        events: (NCGTransferredEvent & TransactionLocation)[];
    }>;
    address: string;
}

function parseEthLogs(
    contract: ethers.Contract,
    logs: ethers.providers.Log[]
): (EventData & TransactionLocation)[] {
    return logs.map((log) => {
        const parsedEvent = contract.interface.parseLog(log);
        return {
            ...log,
            ...parsedEvent,
            txId: log.transactionHash,
            returnValues: {
                ...parsedEvent.args,
                amount: ethers.BigNumber.from(
                    parsedEvent.args.amount
                ).toString(),
            },
            raw: {
                data: log.data,
                topics: log.topics,
            },
            event: parsedEvent.name,
        } as EventData & TransactionLocation;
    });
}

async function fetchEthBurnEvents(
    provider: ethers.providers.JsonRpcProvider,
    contract: ethers.Contract,
    contractAddress: string,
    fromBlock: number,
    toBlock: number
): Promise<Map<number, (EventData & TransactionLocation)[]>> {
    const eventsByBlock = new Map<number, (EventData & TransactionLocation)[]>();

    for (
        let chunkFrom = fromBlock;
        chunkFrom <= toBlock;
        chunkFrom += ETH_LOGS_CHUNK_SIZE
    ) {
        const chunkTo = Math.min(chunkFrom + ETH_LOGS_CHUNK_SIZE - 1, toBlock);
        const filter = {
            address: contractAddress,
            topics: [ethers.utils.id(BURN_EVENT_SIG)],
            fromBlock: chunkFrom,
            toBlock: chunkTo,
        };
        const logs = await provider.getLogs(filter);
        const parsed = parseEthLogs(contract, logs);

        for (const event of parsed) {
            const blockNum = (event as any).blockNumber as number;
            if (!eventsByBlock.has(blockNum)) {
                eventsByBlock.set(blockNum, []);
            }
            eventsByBlock.get(blockNum)!.push(event);
        }
    }

    return eventsByBlock;
}

export async function relayEthereum(deps: EthereumRelayerDeps): Promise<void> {
    const {
        provider,
        contractDescription,
        monitorStateStore,
        burnEventObserver,
        networkKey,
    } = deps;

    const contract = new ethers.Contract(
        contractDescription.address,
        contractDescription.abi,
        provider
    );

    const tipBlock = await provider.getBlockNumber();
    const confirmedTip = tipBlock - CONFIRMATIONS;

    const lastState = await monitorStateStore.load(networkKey);
    let fromBlock: number;

    if (lastState === null) {
        fromBlock = confirmedTip;
    } else {
        const lastBlock = await provider.getBlock(lastState.blockHash);
        fromBlock = lastBlock.number + 1;
    }

    if (fromBlock > confirmedTip) {
        console.log(
            `[relayEthereum:${networkKey}] No new blocks to process (fromBlock=${fromBlock}, confirmedTip=${confirmedTip})`
        );
        return;
    }

    console.log(
        `[relayEthereum:${networkKey}] Processing blocks ${fromBlock} to ${confirmedTip}`
    );

    const eventsByBlock = await fetchEthBurnEvents(
        provider,
        contract,
        contractDescription.address,
        fromBlock,
        confirmedTip
    );

    for (let blockNum = fromBlock; blockNum <= confirmedTip; blockNum++) {
        const block = await provider.getBlock(blockNum);
        const blockHash = block.hash;
        const events = eventsByBlock.get(blockNum) ?? [];

        await burnEventObserver.notify({ blockHash, events });
    }
}

export async function relayBSC(deps: EthereumRelayerDeps): Promise<void> {
    return relayEthereum(deps);
}

export async function relayNineChronicles(
    deps: NineChroniclesRelayerDeps
): Promise<void> {
    const {
        headlessGraphQLClient,
        monitorStateStore,
        ncgTransferredEventObserver,
        address,
    } = deps;

    const tipIndex = await headlessGraphQLClient.getTipIndex();
    const lastState = await monitorStateStore.load("nineChronicles");

    let fromIndex: number;
    if (lastState === null) {
        fromIndex = tipIndex;
    } else {
        const lastBlockIndex = await headlessGraphQLClient.getBlockIndex(
            lastState.blockHash
        );
        fromIndex = lastBlockIndex + 1;
    }

    if (fromIndex > tipIndex) {
        console.log(
            `[relayNineChronicles] No new blocks to process (fromIndex=${fromIndex}, tipIndex=${tipIndex})`
        );
        return;
    }

    console.log(
        `[relayNineChronicles] Processing blocks ${fromIndex} to ${tipIndex}`
    );

    for (let blockIndex = fromIndex; blockIndex <= tipIndex; blockIndex++) {
        const blockHash = await headlessGraphQLClient.getBlockHash(blockIndex);
        const events = await headlessGraphQLClient.getNCGTransferredEvents(
            blockHash,
            address
        );

        const eventsWithLocation = events.map((event) => ({
            ...event,
            blockHash,
            txId: (event as any).txId ?? null,
        }));

        await ncgTransferredEventObserver.notify({
            blockHash,
            events: eventsWithLocation,
        });
    }
}
