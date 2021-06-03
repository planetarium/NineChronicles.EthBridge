import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { MetaMaskInpageProvider } from "@metamask/providers";
import { WrappedNcgBalance } from "./components/WrappedNcgBalance";
import { AbiItem, isAddress } from 'web3-utils';
import Web3 from 'web3';
import { provider as Provider } from 'web3-core';
import { Contract } from "web3-eth-contract";

declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider | undefined;
  }
}

const wNCGAbi: AbiItem[] = [{ "inputs": [], "stateMutability": "nonpayable", "type": "constructor" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "owner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "spender", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }], "name": "Approval", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "_sender", "type": "address" }, { "indexed": true, "internalType": "bytes32", "name": "_to", "type": "bytes32" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "Burn", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "from", "type": "address" }, { "indexed": true, "internalType": "address", "name": "to", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }], "name": "Transfer", "type": "event" }, { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "decimals", "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "subtractedValue", "type": "uint256" }], "name": "decreaseAllowance", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "addedValue", "type": "uint256" }], "name": "increaseAllowance", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "name", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "renounceOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "symbol", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "recipient", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "transfer", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "sender", "type": "address" }, { "internalType": "address", "name": "recipient", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "transferFrom", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "bytes32", "name": "to", "type": "bytes32" }], "name": "burn", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "mint", "outputs": [], "stateMutability": "nonpayable", "type": "function" }];

function App() {
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [contractAddress, setContractAddress] = useState<string>("0x2395900038eEf1814161A76621912B3599D7d242");
  const [ncAddress, setNcAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("0");
  const validContractAddress = useMemo<boolean>(() => isAddress(contractAddress), [contractAddress]);
  const contract = useMemo<Contract | null>(() => web3 !== null && validContractAddress
    ? new web3.eth.Contract(wNCGAbi, contractAddress)
    : null,
    [web3, validContractAddress, contractAddress]);

  useEffect(() => {
    if (window.ethereum === undefined || !window.ethereum.isMetaMask) {
      return;
    } else {
      // FIXME: ethereum.enable() method was deprecated. Use ethereum.request(...) method.
      window.ethereum.enable();
      setWeb3(new Web3(window.ethereum as Provider))
    }
  }, []);

  useEffect(() => {
    if (web3 === null) {
      return;
    }

    web3.eth.requestAccounts().then(accounts => {
      setAccounts(accounts);
      setAccount(accounts[0]);
    });
  }, [web3]);


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
          : <select onChange={event => setAccount(event.target.value)}>{accounts.map(account => <option>{account}</option>)}</select>
      }
      <br />
      Your wNCG :
      {
        contract === null || account === null
          ? <b>🕑</b>
          : <WrappedNcgBalance address={account} balanceOf={(address: string) => contract.methods.balanceOf(address).call()} />
      }
      <hr/>
      Amount : <input type="text" value={amount} onChange={event => { setAmount(event.target.value) }}/>
      <br/>
      To : <input type="text" value={ncAddress} onChange={event => { setNcAddress(event.target.value) }}/>
      <br/>
      {
        contract === null || account === null || amount === null || isNaN(parseInt(amount)) || !isAddress(ncAddress)
          ? <b>Fill corret values</b>
          : <button onClick={event => {
            event.preventDefault();            
            contract.methods.burn(amount, ncAddress).send({ from: account }).then(console.debug)
          }}>Burn</button>
      }
    </div>
  );
}

export default App;
