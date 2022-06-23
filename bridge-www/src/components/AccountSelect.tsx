export interface AccountSelectProps {
    accounts: string[],
    onChange: (value: string) => void,
}

export const AccountSelect: React.FC<AccountSelectProps> = ({ accounts, onChange }) => {
    return (
        <select onChange={event => onChange(event.target.value)}>
            {accounts.map(account => <option>{account}</option>)}
        </select>
    );
}
