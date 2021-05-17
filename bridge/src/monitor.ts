type Callback<TEvent> = (data: TEvent) => Promise<void>;
type CallbackRemover = () => void;

export abstract class Monitor<TEvent> {
    private readonly _callbacks: Map<Symbol, Callback<TEvent>>;
    private running: boolean;

    protected constructor() {
        this.running = false;
        this._callbacks = new Map();
    }

    public subscribe(callback: Callback<TEvent>): CallbackRemover {
        const symbol = Symbol();
        this._callbacks.set(symbol, callback);
        return () => {
            this._callbacks.delete(symbol);
        };
    }

    public run() {
        this.running = true;
        this.startMonitoring();
    }

    public stop(): void {
        this.running = false;
    }

    abstract loop(): AsyncIterableIterator<TEvent>;

    private async startMonitoring(): Promise<void> {
        const loop = this.loop();
        while (this.running) {
            const { value }  = await loop.next();
            for (const callback of this._callbacks.values()) {
                await callback(value);
            }
        }
    }
}
