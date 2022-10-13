import { Button } from "@nextui-org/react";
import React from "react"

interface ConnectWalletPageProps {
    connect: () => void;
}

const ConnectWalletPage: React.FC<ConnectWalletPageProps> = ({ connect }) => {
    return (
        <Button onClick={() => connect()}>
          Connect Wallet
        </Button>
    );
}

export default ConnectWalletPage;
