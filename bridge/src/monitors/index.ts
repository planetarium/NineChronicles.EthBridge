import { BlockHash } from "../types/block-hash";
import { IObserver } from "../observers";

type IMonitorObserver<TEvent> = IObserver<{
    blockHash: BlockHash;
    events: TEvent[];
}>;

export abstract class Monitor<TEvent> {
    private readonly _observers: Map<Symbol, IMonitorObserver<TEvent>>;
    private running: boolean;
    private consuming = false;
    protected stopped = false;
    private readonly stopWaiters = new Set<() => void>();

    protected constructor() {
        this.running = false;
        this._observers = new Map();
    }

    public attach(observer: IMonitorObserver<TEvent>): void {
        const symbol = Symbol();
        this._observers.set(symbol, observer);
    }

    public run() {
        if (this.consuming) return;
        this.stopped = false;
        this.running = true;
        this.startMonitoring();
    }

    public stop(): void {
        this.running = false;
        this.stopped = true;
        for (const finish of this.stopWaiters) finish();
    }

    protected wait(ms: number): Promise<void> {
        if (this.stopped) return Promise.resolve();
        return new Promise((resolve) => {
            let timer: NodeJS.Timeout | undefined;
            const finish = () => {
                if (timer !== undefined) clearTimeout(timer);
                this.stopWaiters.delete(finish);
                resolve();
            };
            this.stopWaiters.add(finish);
            timer = setTimeout(finish, ms);
        });
    }

    abstract loop(): AsyncIterableIterator<{
        blockHash: string;
        events: TEvent[];
    }>;

    private async startMonitoring(): Promise<void> {
        this.consuming = true;
        const loop = this.loop();
        try {
            while (this.running) {
                const { value, done } = await loop.next();
                if (done || !this.running) break;
                for (const observer of this._observers.values()) {
                    await observer.notify(value);
                }
            }
        } finally {
            this.running = false;
            // Closing a suspended generator releases its pinned RPC session even
            // when the consumer stops or an observer fails after a side effect.
            try {
                await loop.return?.(undefined as never);
            } finally {
                // stop() may happen during an RPC. Do not allow run() to create
                // another consumer until the previous iterator has fully closed.
                this.consuming = false;
            }
        }
    }
}
