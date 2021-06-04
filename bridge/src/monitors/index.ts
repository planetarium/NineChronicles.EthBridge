import { BlockHash } from "../types/block-hash";
import { IObserver } from "../observers";

type IMonitorObserver<TEvent> = IObserver<{ blockHash: BlockHash, events: TEvent[] }>;
type ObserverRemover = () => void;

export abstract class Monitor<TEvent> {
    private readonly _observers: Map<Symbol, IMonitorObserver<TEvent>>;
    private running: boolean;

    protected constructor() {
        this.running = false;
        this._observers = new Map();
    }

    public attach(observer: IMonitorObserver<TEvent>): ObserverRemover {
        const symbol = Symbol();
        this._observers.set(symbol, observer);
        return () => {
            this._observers.delete(symbol);
        };
    }

    public run() {
        this.running = true;
        this.startMonitoring();
    }

    public stop(): void {
        this.running = false;
    }

    abstract loop(): AsyncIterableIterator<{ blockHash: string, events: TEvent[] }>;

    private async startMonitoring(): Promise<void> {
        const loop = this.loop();
        while (this.running) {
            const { value }  = await loop.next();
            for (const observer of this._observers.values()) {
                await observer.notify(value);
            }
        }
    }
}
