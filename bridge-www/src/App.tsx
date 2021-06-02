import React, { useEffect, useState } from 'react';
import './App.css';
import { MetaMaskInpageProvider } from "@metamask/providers";
import { WrappedNcgBalance } from "./components/WrappedNcgBalance";
import { AbiItem } from 'web3-utils';
import Web3 from 'web3';
import { provider as Provider } from 'web3-core';

declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider | undefined;
  }
}

const wNCGAbi: AbiItem[] = [{ "inputs": [], "stateMutability": "nonpayable", "type": "constructor" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "owner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "spender", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }], "name": "Approval", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "_sender", "type": "address" }, { "indexed": true, "internalType": "bytes32", "name": "_to", "type": "bytes32" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "Burn", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "from", "type": "address" }, { "indexed": true, "internalType": "address", "name": "to", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }], "name": "Transfer", "type": "event" }, { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "decimals", "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "subtractedValue", "type": "uint256" }], "name": "decreaseAllowance", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "addedValue", "type": "uint256" }], "name": "increaseAllowance", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "name", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "renounceOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "symbol", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function", "constant": true }, { "inputs": [{ "internalType": "address", "name": "recipient", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "transfer", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "sender", "type": "address" }, { "internalType": "address", "name": "recipient", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "transferFrom", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "bytes32", "name": "to", "type": "bytes32" }], "name": "burn", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "mint", "outputs": [], "stateMutability": "nonpayable", "type": "function" }];

function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [contractAddress, setContractAddress] = useState<string>("0x2395900038eEf1814161A76621912B3599D7d242");

  useEffect(() => {
    web3.eth.requestAccounts().then(accounts => {
      setAccounts(accounts);
      setAccount(accounts[0]);
    });
  }, []);

  if (window.ethereum === undefined || !window.ethereum.isMetaMask) {
    return <h1>MetaMask doesn't exist. 😥</h1>;
  }

  // FIXME: ethereum.enable() method was deprecated. Use ethereum.request(...) method.
  window.ethereum.enable();
  const web3 = new Web3(window.ethereum as Provider);

  console.log(contractAddress, accounts, account)
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
        contractAddress === null || !web3.utils.isAddress(contractAddress) || account === null
          ? <b>🕑</b>
          : <WrappedNcgBalance address={account} balanceOf={(address: string) => {
            const contract = new web3.eth.Contract(wNCGAbi, contractAddress)
            return contract.methods.balanceOf(address).call();
          }} />
      }
    </div>
  );
}

export default App;
