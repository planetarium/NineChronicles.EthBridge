import { PromiEvent } from "web3-core"

declare function PromiEventConstructor<T>(justPromise: boolean): {
    resolve: (value: T) => void,
    reject: (err: any) => void,
    eventEmitter: PromiEvent<T> & { emit: (event: string, value: any) => void },
};

export default PromiEventConstructor;
