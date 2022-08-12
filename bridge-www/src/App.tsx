import React, { useEffect, useMemo, useState } from 'react';
import { MetaMaskInpageProvider } from "@metamask/providers";
import { WrappedNcgBalance } from "./components/WrappedNcgBalance";
import { isAddress } from 'web3-utils';
import Web3 from 'web3';
import { provider as Provider } from 'web3-core';
import { Contract } from "web3-eth-contract";
import { wNCGAbi } from "./wrapped-ncg-token";
import Decimal from "decimal.js";
import { AccountSelect } from './components/AccountSelect';
import { TextField } from './components/TextField';
import { Button, Text } from "@nextui-org/react";

declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider | undefined;
  }
}

function App() {
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const contractAddress = useMemo<string>(() => {
    if (chainId === 1) {
      return "0xf203ca1769ca8e9e8fe1da9d147db68b6c919817";
    } else if (chainId === 3) {
      return "0xeaa982f3424338598738c496153e55b1df11f625";
    } else {
      return "";
    }
  }, [chainId]);
  const [ncAddress, setNcAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("0");
  const validContractAddress = useMemo<boolean>(() => isAddress(contractAddress), [contractAddress]);
  const amountInEthereum = useMemo<Decimal | null>(() => {
    try {
      return new Decimal(amount || "0").mul(new Decimal(10).pow(18))
    } catch {
      return null;
    }
  }, [amount]);

  function handleChainChanged(...args: unknown[]) {
    if (args.length === 1 && typeof args[0] === "string") {
      setChainId(parseInt(args[0].replace("0x", ""), 16));
    }
  }

  const contract = useMemo<Contract | null>(() => web3 !== null && validContractAddress
    ? new web3.eth.Contract(wNCGAbi, contractAddress)
    : null,
    [web3, validContractAddress, contractAddress]);
  function loadAccounts(web3: Web3) {
    web3.eth.requestAccounts().then(accounts => {
      setAccounts(accounts);
      setAccount(accounts[0]);
    });
  }

  useEffect(() => {
    if (window.ethereum === undefined || !window.ethereum.isMetaMask) {
      return;
    } else {
      // FIXME: ethereum.enable() method was deprecated. Use ethereum.request(...) method.
      window.ethereum.enable();
      const web3 = new Web3(window.ethereum as Provider);
      setWeb3(web3)
      window.ethereum.on("accountsChanged", (accounts) => {
        loadAccounts(web3);
      });
      window.ethereum.request({ method: 'eth_chainId' }).then(chainId => {
        handleChainChanged(chainId);
      });
      window.ethereum.on('chainChanged', handleChainChanged);
      loadAccounts(web3);
    }
  }, []);

  if (web3 === null) {
    return <Text h1 css={{
      textGradient: "45deg, $purple600 -20%, $blue600 50%",
    }}>Maybe MetaMask doesn't exist. 😥</Text>;
  }

  console.log(contract, contractAddress, accounts, account, amount)
  return (
    <div className="App">
      <TextField label={'Contract Address'} value={contractAddress} readOnly/>
      {
        accounts === null
          ? <Text>🕑</Text>
          : <AccountSelect accounts={accounts} onChange={setAccount} label={"Choose Address"} />
      }
      <Text>Your wNCG : {
        contract === null || account === null
          ? <Text>🕑</Text>
          : <WrappedNcgBalance address={account} balanceOf={(address: string) => contract.methods.balanceOf(address).call()} />
      }</Text>
      <TextField label={'Amount'} onChange={setAmount}/>
      <TextField label={'To'} onChange={setNcAddress}/>
      {
        contract === null || account === null || amountInEthereum === null || amountInEthereum.toString().indexOf(".") !== -1 || !isAddress(ncAddress)
          ? <Text weight={"bold"}>Fill corret values</Text>
          : <Button onClick={event => {
            event.preventDefault();            
            contract.methods.burn(web3.utils.toBN(amountInEthereum.toString()), ncAddress).send({ from: account }).then(console.debug)
          }}>Burn</Button>
      }
    </div>
  );
}

export default App;
