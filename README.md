# NineChronicles.EthBridge

A project to bridge NCG between NineChronicles network and Ethereum network.

## Notes

### Collateral

Planetarium organization manually minted as `110523334`.

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

So you can check them have enough collateral NCGs corresponded to the WNCGs:

|                   address                  |   WNCG collateral  |
|--------------------------------------------|--------------------|
| 0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19 | 70,073,334         |
| 0xebCa4032529221a9BCd3fF3a17C26e7d4f829695 |  5,450,000         |
| 0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5 |  5,000,000         |
| 0x310518163256A9642364FDadb0eB2b218cfa86c6 | 30,000,000         |

[0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5]: https://9cscan.com/address/0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5
[0xebCa4032529221a9BCd3fF3a17C26e7d4f829695]: https://9cscan.com/address/0xebCa4032529221a9BCd3fF3a17C26e7d4f829695
[0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19]: https://9cscan.com/address/0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19
[0x310518163256A9642364FDadb0eB2b218cfa86c6]: https://9cscan.com/address/0x310518163256A9642364FDadb0eB2b218cfa86c6
