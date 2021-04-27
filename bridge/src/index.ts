import { config } from "dotenv";

import Web3 from "web3";
import { BurnEventResult } from "./interfaces/burn-event-result";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { Monitor } from "./monitor";
import { NCGTransfer } from "./ncg-transfer";
import { wNCGToken } from "./wrapped-ncg-token";

config();

const WEB_SOCKET_PROVIDER_URI: string | undefined = process.env.WEB_SOCKET_PROVIDER_URI;
if (WEB_SOCKET_PROVIDER_URI === undefined) {
    console.error("Please set 'WEB_SOCKET_PROVIDER_URI' at .env");
    process.exit(-1);
}

const GRAPHQL_API_ENDPOINT: string | undefined = process.env.GRAPHQL_API_ENDPOINT;
if (GRAPHQL_API_ENDPOINT === undefined) {
    console.error("Please set 'GRAPHQL_API_ENDPOINT' at .env");
    process.exit(-1);
}

const BRIDGE_9C_ADDRESS: string | undefined = process.env.BRIDGE_9C_ADDRESS;
if (BRIDGE_9C_ADDRESS === undefined) {
    console.error("Please set 'BRIDGE_9C_ADDRESS' at .env");
    process.exit(-1);
}

(async () => {
    const CONFIRMATIONS = 10;

    const ncgTransfer: INCGTransfer = new NCGTransfer(GRAPHQL_API_ENDPOINT, BRIDGE_9C_ADDRESS);
    const web3 = new Web3(new Web3.providers.WebsocketProvider(WEB_SOCKET_PROVIDER_URI));
    const monitor = new Monitor(web3, wNCGToken, await web3.eth.getBlockNumber(), CONFIRMATIONS);
    const unsubscribe = monitor.subscribe(async eventLog => {
        const burnEventResult = eventLog.returnValues as BurnEventResult;
        const txId = await ncgTransfer.transfer(burnEventResult._sender, BigInt(burnEventResult.amount));
        console.log("Transferred", txId);
    });
    monitor.run();
})();
