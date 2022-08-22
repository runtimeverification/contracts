interface OmniBridgeConfig {
  [key: string]: {
    foreignOmniBridge: string // OmniBridge address for non-native asset.
    wethOmniBridge: string // OmniBridge address for native asset.
    homeOmniBridge: string // HomeOmniBridge address on Gnosis chain.
  }
}

export const BRIDGED_TOKEN_ADDRESS_ABI = [
  `function bridgedTokenAddress(address assetId) external view returns (address)`,
]

export const WETH_ADDRESS_ABI = [
  `function WETH() external view returns (address)`,
]

const config: OmniBridgeConfig = {
  hardhat: {
    foreignOmniBridge: '0x88ad09518695c6c3712AC10a214bE5109a655671',
    wethOmniBridge: '0xa6439Ca0FCbA1d0F80df0bE6A17220feD9c9038a',
    homeOmniBridge: '0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d',
  },
  mainnet: {
    foreignOmniBridge: '0x88ad09518695c6c3712AC10a214bE5109a655671',
    wethOmniBridge: '0xa6439Ca0FCbA1d0F80df0bE6A17220feD9c9038a',
    homeOmniBridge: '0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d',
  },
  kovan: {
    foreignOmniBridge: '0xA960d095470f7509955d5402e36d9DB984B5C8E2',
    wethOmniBridge: '0x227A6F13AA0dBa8912d740c0F88Fb1304b2597e1',
    homeOmniBridge: '0x40CdfF886715A4012fAD0219D15C98bB149AeF0e',
  },
  bsc: {
    foreignOmniBridge: '0xF0b456250DC9990662a6F25808cC74A6d1131Ea9',
    wethOmniBridge: '0xefC33f8b2c4d51005585962BE7ea20518eA9Fd0D',
    homeOmniBridge: '0x59447362798334d3485c64D1e4870Fde2DDC0d75',
  },
}

export default config
