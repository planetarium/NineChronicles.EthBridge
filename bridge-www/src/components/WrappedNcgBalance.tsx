import React, { useEffect, useState } from "react";

export interface WrappedNcgBalanceProps {
    address: string;
    balanceOf: (address: string) => Promise<string>;
};

export const WrappedNcgBalance: React.FC<WrappedNcgBalanceProps> = ({ address, balanceOf }) => {
    const [balance, setBalance] = useState<string | null>(null);
    useEffect(() => {
        balanceOf(address).then(setBalance);
    }, [address, balanceOf]);

    console.log(address, balanceOf, balance);

    if (balance === null) {
        return <b>🕑</b>
    } else {
        return <b>{parseInt(balance) / 10e17}</b>;
    }
}
