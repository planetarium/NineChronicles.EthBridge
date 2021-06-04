export interface IObserver<T> {
    notify(data: T): Promise<void>;
}
