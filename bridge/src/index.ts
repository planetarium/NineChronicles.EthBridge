import { config } from "dotenv";

import Web3 from "web3";
import { Monitor } from "./monitor";
import { wNCGToken } from "./wrapped-ncg-token";

config();

const WEB_SOCKET_PROVIDER_URI: string | undefined = process.env.WEB_SOCKET_PROVIDER_URI;
if (WEB_SOCKET_PROVIDER_URI === undefined) {
    console.error("Please set 'WEB_SOCKET_PROVIDER_URI' at .env");
    process.exit(-1);
}

(async () => {
    const web3 = new Web3(new Web3.providers.WebsocketProvider(WEB_SOCKET_PROVIDER_URI));
    const monitor = new Monitor(web3, wNCGToken, await web3.eth.getBlockNumber());
    const callbackRemover = monitor.watch(eventLog => {
        console.log(eventLog);
    });
    monitor.run();
})();
