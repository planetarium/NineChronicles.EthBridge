[![codecov](https://codecov.io/gh/planetarium/NineChronicles.EthBridge/graph/badge.svg?token=tYyiZNv83x)](https://codecov.io/gh/planetarium/NineChronicles.EthBridge)

# NineChronicles.EthBridge

A project to bridge NCG between NineChronicles network and Ethereum network.

## Notes

### Collateral

Planetarium organization manually minted as `128038607`.

The manual mint transactions are like the below list:

- https://etherscan.io/tx/0xf21098a7464fcb2015fdf1d10b93397b30beaa9ce8cc631fedd03c5b37d299da
  - Reason: MISO IDO
  - Amount: 2,000,000 NCG
  - Backed by:
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
- https://etherscan.io/tx/0xd0cb454360f2a8dcafd78e7fbc373e0658257c35d488e1e090c5e207452419bd
  - Reason: For growth partner provision, initial liquidity supply
  - Amount: 12,073,334 NCG
  - Backed by:
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
- https://etherscan.io/tx/0x87f546bcbb8528a3d2e841670a2f818dc98b1b3443991dbccbc8958ea9b59949
  - Reason: Lending of Operating Spots to Liquidity Providers
  - Amount: 30,000,000 NCG
  - Backed by:
    - [0x310518163256A9642364FDadb0eB2b218cfa86c6]
- https://etherscan.io/tx/0x7505bfe8688b00dfc4aa857fc3a6c900420a382ce8be93e2aee5913fc062bb6e
  - Reason: Some additional issues including November and December distribution for growth partners
  - Amount: 10,000,000 NCG
  - Backed by:
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
- https://etherscan.io/tx/0x851bffbfcb2084bd6ea376b0e799d8111e2b38a04a6eadc74d0c9dbd8c59b7d4
  - Reason: Key Partnership Allocation
  - Recipient: 0xFf4E09583ab03410B1F2fAC3F2242ef7d1EC6CC3
  - Amount: 30,000,000 NCG
  - Backed by:
    - [0xebCa4032529221a9BCd3fF3a17C26e7d4f829695] (as 5,000,000 NCG)
    - [0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5] (as 5,000,000 NCG)
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19] (as 20,000,000 NCG)
- https://etherscan.io/tx/0xe388b2cee05340c23838758dda6604506aa17373897647a776344486fd4ce2e9 
  - Reason: Growth partner distribution for 6 months
  - Amount: 13,000,000 NCG
  - Backed by:
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
- https://etherscan.io/tx/0x6e7d5d173d2acc7d33f22f4b65da0a33fdfe1a605072e9e70ac1873a7cfe0c18
  - Reason: Exchange listing marketing compensation budget payment
  - Amount: 450,000
  - Backed by:
    - [0xebCa4032529221a9BCd3fF3a17C26e7d4f829695]
- https://etherscan.io/tx/0x6d1c74f7ca3e1ce1a77cc6797bbb501652f1f72a3d0f8d6f23ee3680e890ed77
  - Reason: Growth partner distribution for 6 months
  - Amount: 13,000,000 NCG
  - Backed by:
    - [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
- https://etherscan.io/tx/0xe5677a9bc5a4742bfda137e32e0ac8eeaac1d0b5ad442eb2a6a033eb65c16925
  - Reason: Liquidity Supply Partnership Agreements
  - Amount: 9,000,000 NCG
  - Backed by:
    - [0xdF81374a4e4853340CCef6485083Cc1ba9100E2B]

So you can check them have enough collateral NCGs corresponded to the WNCGs:

|                   address                  |   WNCG collateral  |
|--------------------------------------------|--------------------|
| 0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19 | 78,588,607         |
| 0xebCa4032529221a9BCd3fF3a17C26e7d4f829695 |  5,450,000         |
| 0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5 |  5,000,000         |
| 0x310518163256A9642364FDadb0eB2b218cfa86c6 | 30,000,000         |
| 0xdF81374a4e4853340CCef6485083Cc1ba9100E2B | 9,000,000         |

Since Apr 01 2023, Planetarium started to organize all collaterals into one cold wallet acocunt. The cold wallet's address is [0xa86e321048c397c0f7f23c65b1ee902afe24644e]. So the sum of [0xa86e321048c397c0f7f23c65b1ee902afe24644e]'s balance and [0x9093dd96c4bb6b44a9e0a522e2de49641f146223]'s balance, must be equal or more than the issuance of WNCG.

The below transactions deposits collaterals into one Bridge Cold Wallet:

- [0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]
  - https://9cscan.com/tx/cbeb9edbd6b3694fe5197a937294772345a5f6e41b04653048b088a770c6b714
  - https://9cscan.com/tx/5d8dcb81a347d5a56d0d515da667cd854061d3fcef4217e3d590aaeec4de31db
- [0xebCa4032529221a9BCd3fF3a17C26e7d4f829695]
  - https://9cscan.com/tx/8ca99829ceca1c59f932b3ef79d9b4a308e915811675a9c313381ddfcd2192e9
- [0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5]
  - https://9cscan.com/tx/0818d8751dfd0b90343b84afd8a7539425437290b037a654f60f501958761d6f
- [0x310518163256A9642364FDadb0eB2b218cfa86c6]
  - https://9cscan.com/tx/7b3112e1a34c4fc8be1197f4703e6b28402844bda38ad18ce6405b482721dcc6
- [0xdF81374a4e4853340CCef6485083Cc1ba9100E2B]
  - https://9cscan.com/tx/07d63cbe561e4d37f1651f604df0934ce18716a00cfe47903258a390e8d91409


After the above settlement, starting with the manual mint below, write the 9c transaction link that you moved to the cold wallet, replacing the collateral account link.

- https://etherscan.io/tx/0x208746218c94414ad008cff71358a3997c4c1aeec9b1e838f040ca21f712d30b
  - Reason: Growth Partner Balance Withdrawal
  - Amount: 8,515,273 NCG
  - Collateral Deposit Transaction: https://9cscan.com/tx/90499dce3fa66913f63e05f470dee5586918111dc242d984147771db5813ea38
- https://etherscan.io/tx/0xe0a0fbc12a7bee129b49fab027577316ff4cb934cd6b06f7b718a9166f486afb
  - Reason: Securing funds for multi-chain partnerships
  - Amount: 3,000,000 NCG
  - Collateral Deposit Transaction: https://9cscan.com/tx/bd044405c45d8456963773996f21a4ce0df0e4687fd40815289683f69a937a29


[0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5]: https://9cscan.com/address/0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5
[0xebCa4032529221a9BCd3fF3a17C26e7d4f829695]: https://9cscan.com/address/0xebCa4032529221a9BCd3fF3a17C26e7d4f829695
[0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]: https://9cscan.com/address/0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19
[0x310518163256A9642364FDadb0eB2b218cfa86c6]: https://9cscan.com/address/0x310518163256A9642364FDadb0eB2b218cfa86c6
[0xdF81374a4e4853340CCef6485083Cc1ba9100E2B]: https://9cscan.com/address/0xdF81374a4e4853340CCef6485083Cc1ba9100E2B
[0xa86e321048c397c0f7f23c65b1ee902afe24644e]: https://9cscan.com/address/0xa86e321048c397c0f7f23c65b1ee902afe24644e
[0x9093dd96c4bb6b44a9e0a522e2de49641f146223]: https://9cscan.com/address/0x9093dd96c4bb6b44a9e0a522e2de49641f146223
