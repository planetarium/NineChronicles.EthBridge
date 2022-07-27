import Decimal from "decimal.js";
import React, { useEffect, useState } from "react";
import { Text } from "@nextui-org/react";

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
        return <Text>🕑</Text>
    } else {
        return <Text weight="bold">{new Decimal(balance).div(new Decimal(10).pow(18)).toString()}</Text>;
    }
}
