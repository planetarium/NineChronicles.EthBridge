import { config } from "dotenv";

import Web3 from "web3";
import { BurnEventResult } from "./interfaces/burn-event-result";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { Monitor } from "./monitor";
import { wNCGToken } from "./wrapped-ncg-token";

config();

const WEB_SOCKET_PROVIDER_URI: string | undefined = process.env.WEB_SOCKET_PROVIDER_URI;
if (WEB_SOCKET_PROVIDER_URI === undefined) {
    console.error("Please set 'WEB_SOCKET_PROVIDER_URI' at .env");
    process.exit(-1);
}

(async () => {
    const CONFIRMATIONS = 10;

    const ncgTransfer: INCGTransfer = {
        transfer: (address, amount) => {
            console.log(address, amount);
        }
    };

    const web3 = new Web3(new Web3.providers.WebsocketProvider(WEB_SOCKET_PROVIDER_URI));
    const monitor = new Monitor(web3, wNCGToken, await web3.eth.getBlockNumber(), CONFIRMATIONS);
    const unsubscribe = monitor.subscribe(eventLog => {
        const burnEventResult = eventLog.returnValues as BurnEventResult;
        ncgTransfer.transfer(burnEventResult._sender, BigInt(burnEventResult.amount));
    });
    monitor.run();
})();
