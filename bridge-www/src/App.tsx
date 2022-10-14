import { useAccount, useConnect } from 'wagmi';
import { InjectedConnector } from 'wagmi/connectors/injected'
import ConnectWalletPage from './pages/ConnectWallet';
import SwapWncgPage from './pages/SwapWncg';

function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({
    connector: new InjectedConnector(),
  });

  if (!isConnected) {    
    return (
      <ConnectWalletPage connect={connect} />
    );
  }

  if (address === undefined) {
    return (
      <b>Error occurred while fetching address.</b>
    )
  }

  return (
    <SwapWncgPage address={address} />
  )
}

export default App;
