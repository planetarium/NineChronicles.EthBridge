import { NextUIProvider } from '@nextui-org/react';
import { getDefaultProvider } from 'ethers';
import React from 'react';
import ReactDOM from 'react-dom';
import { createClient, WagmiConfig } from 'wagmi';
import App from './App';

const client = createClient({
  autoConnect: true,
  provider: config => getDefaultProvider(config.chainId),
})

ReactDOM.render(
  <React.StrictMode>
    <NextUIProvider>
      <WagmiConfig client={client}>
        <App />
      </WagmiConfig>
    </NextUIProvider>
  </React.StrictMode>,
  document.getElementById('root')
);
