import { Button, Container, Row, Spacer } from "@nextui-org/react";
import React from "react"

interface ConnectWalletPageProps {
    connect: () => void;
}

const ConnectWalletPage: React.FC<ConnectWalletPageProps> = ({ connect }) => {
    return (
        <Container style={{margin: "10vh 10vw"}}>
            <Row>
                <h1>MetaMask is not connected.</h1>
            </Row>
            <Spacer/>
            <Row>
                <Button onClick={() => connect()}>
                    Connect Wallet
                </Button>
            </Row>
        </Container>
    );
}

export default ConnectWalletPage;
