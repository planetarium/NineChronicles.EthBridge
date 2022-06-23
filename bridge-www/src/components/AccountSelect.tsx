import { randomId } from "../random";

export interface AccountSelectProps {
    accounts: string[],
    onChange: (value: string) => void,
    label: string,
}

export const AccountSelect: React.FC<AccountSelectProps> = ({ accounts, onChange, label }) => {
    const id = randomId();
    return (
        <div>
            <label htmlFor={id}>{label}</label>
            <select id={id} onChange={event => onChange(event.target.value)}>
                {accounts.map(account => <option>{account}</option>)}
            </select>
        </div>
    );
}
