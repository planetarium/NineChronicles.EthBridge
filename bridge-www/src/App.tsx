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
import { TextInput } from './components/TextInput';

declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider | undefined;
  }
}

function App() {
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [contractAddress, setContractAddress] = useState<string>("0x5686b17ada75d682ea8a8103edbea77e86d909f4");
  const [ncAddress, setNcAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("0");
  const validContractAddress = useMemo<boolean>(() => isAddress(contractAddress), [contractAddress]);
  const amountInEthereum = useMemo<Decimal>(() => new Decimal(amount || "0").mul(new Decimal(10).pow(18)), [amount]);
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
      loadAccounts(web3);
    }
  }, []);


  if (web3 === null) {
    return <h1>Maybe MetaMask doesn't exist. 😥</h1>;
  }

  console.log(contract, contractAddress, accounts, account, amount)
  return (
    <div className="App">
      Contract Address : <input type="text" value={contractAddress} onChange={event => setContractAddress(event.target.value)} />
      <br />
      Choose Address : {
        accounts === null
          ? <b>🕑</b>
          : <AccountSelect accounts={accounts} onChange={setAccount} />
      }
      <br />
      Your wNCG :
      {
        contract === null || account === null
          ? <b>🕑</b>
          : <WrappedNcgBalance address={account} balanceOf={(address: string) => contract.methods.balanceOf(address).call()} />
      }
      <hr/>
      Amount : <TextInput onChange={setAmount}/>
      <br/>
      To : <TextInput onChange={setNcAddress}/>
      <br/>
      {
        contract === null || account === null || amount === null || amountInEthereum.toString().indexOf(".") !== -1 || !isAddress(ncAddress)
          ? <b>Fill corret values</b>
          : <button onClick={event => {
            event.preventDefault();            
            contract.methods.burn(web3.utils.toBN(amountInEthereum.toString()), ncAddress).send({ from: account }).then(console.debug)
          }}>Burn</button>
      }
    </div>
  );
}

export default App;
