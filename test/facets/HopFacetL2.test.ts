import { IERC20__factory as ERC20__factory, HopFacet } from '../../typechain'
import { deployments, network } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers'
import { constants, utils } from 'ethers'
import { node_url } from '../../utils/network'
import { addOrReplaceFacets } from '../../utils/diamond'
import { Hop, Chain } from '@hop-protocol/sdk'
import { expect } from '../chai-setup'
import { parseEther } from 'ethers/lib/utils'

const USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'

describe('HopFacet L2', function () {
  let bob: SignerWithAddress
  let lifi: HopFacet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lifiData: any

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers, getUnnamedAccounts }) => {
      const [deployer] = await getUnnamedAccounts()
      await deployments.fixture('InitFacets')

      await deployments.deploy('HopFacet', {
        from: deployer,
        log: true,
        deterministicDeployment: false,
      })

      const hopFacet = await ethers.getContract('HopFacet')
      const diamond = await ethers.getContract('LiFiDiamond')
      lifi = <HopFacet>await ethers.getContractAt('HopFacet', diamond.address)

      await addOrReplaceFacets([hopFacet], diamond.address)

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: ['0x7cd7a5a66d3cd2f13559d7f8a052fa6014e07d35'],
      })

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: ['0x06959153b974d0d5fdfd87d561db6d8d4fa0bb0b'],
      })

      bob = await ethers.getSigner('0x06959153b974d0d5fdfd87d561db6d8d4fa0bb0b')

      lifiData = {
        transactionId: utils.randomBytes(32),
        integrator: 'ACME Devs',
        referrer: constants.AddressZero,
        sendingAssetId: USDC_ADDRESS,
        receivingAssetId: USDC_ADDRESS,
        receiver: bob.address,
        destinationChainId: 100,
        amount: utils.parseUnits('10000', 6),
      }
    }
  )

  before(async function () {
    this.timeout(0)
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: node_url('polygon'),
            blockNumber: 23039952,
          },
        },
      ],
    })
  })

  beforeEach(async function () {
    this.timeout(0)
    await setupTest()
  })

  it('starts a bridge transaction on the sending chain', async () => {
    const amountIn = utils.parseUnits('10010', 6)
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current Unix time
    const hop = new Hop('mainnet')
    const bridge = hop.connect(bob).bridge('USDC')

    const fee = await bridge.getTotalFee(amountIn, Chain.Polygon, Chain.Gnosis)
    // Approve ERC20 for swapping
    const token = ERC20__factory.connect(USDC_ADDRESS, bob)
    await token.approve(lifi.address, amountIn)

    const HopData = {
      fromChainId: 137,
      toChainId: 100,
      assetId: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      bridge: '0x76b22b8C1079A44F1211D867D68b1eda76a635A7',
      receiver: bob.address,
      amount: amountIn,
      bonderFee: fee,
      amountOutMin: utils.parseUnits('10000', 6),
      deadline,
      destinationAmountOutMin: utils.parseUnits('9000', 6),
      destinationDeadline: deadline,
    }

    await expect(
      lifi.connect(bob).startBridgeTokensViaHop(lifiData, HopData, {
        gasLimit: 500000,
      })
    ).to.emit(lifi, 'LiFiTransferStarted')
  })

  it('starts a bridge transaction on the sending chain with MATIC', async () => {
    const amountIn = utils.parseEther('1')
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current Unix time
    const hop = new Hop('mainnet')
    const bridge = hop.connect(bob).bridge('MATIC')

    const fee = await bridge.getTotalFee(amountIn, Chain.Polygon, Chain.Gnosis)

    const HopData = {
      fromChainId: 137,
      toChainId: 100,
      assetId: '0x0000000000000000000000000000000000000000',
      bridge: '0x884d1Aa15F9957E1aEAA86a82a72e49Bc2bfCbe3',
      receiver: bob.address,
      amount: amountIn,
      bonderFee: fee,
      amountOutMin: utils.parseEther('0.9'),
      deadline,
      destinationAmountOutMin: utils.parseEther('0.8'),
      destinationDeadline: deadline,
    }

    await expect(
      lifi.connect(bob).startBridgeTokensViaHop(lifiData, HopData, {
        gasLimit: 500000,
        value: parseEther('1'),
      })
    ).to.emit(lifi, 'LiFiTransferStarted')
  })

  // it('performs a swap then starts bridge transaction on the sending chain', async function () {
  //   const amountIn = utils.parseEther('100000')
  //   const amountOut = utils.parseUnits('100000', 6)
  //   const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current Unix time

  //   const hop = new Hop('mainnet')
  //   const bridge = hop.connect(bob).bridge('USDC')

  //   const fee = await bridge.getMinBonderFee(
  //     amountIn,
  //     Chain.Polygon,
  //     Chain.xDai
  //   )

  //   const HopData = {
  //     chainId: 100,
  //     receiver: bob.address,
  //     amount: amountOut,
  //     bonderFee: fee,
  //     amountOutMin: utils.parseUnits('95000', 6),
  //     deadline,
  //     destinationAmountOutMin: utils.parseUnits('90000', 6),
  //     destinationDeadline: deadline,
  //   }

  //   const quickSwap = new Contract(
  //     SUSHISWAP_ADDRESS,
  //     [
  //       'function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline) external payable returns(uint[] memory amounts)',
  //     ],
  //     bob
  //   )

  //   // Generate swap calldata
  //   const swapData =
  //     await quickSwap.populateTransaction.swapExactTokensForTokens(
  //       amountIn,
  //       amountOut,
  //       [DAI_ADDRESS, USDC_ADDRESS],
  //       lifi.address,
  //       deadline
  //     )

  //   // Approve ERC20 for swapping
  //   const token = ERC20__factory.connect(DAI_ADDRESS, bob)
  //   await token.approve(lifi.address, amountIn)

  //   await expect(
  //     lifi.connect(bob).swapAndStartBridgeTokensViaHop(
  //       lifiData,
  //       [
  //         {
  //           callTo: <string>swapData.to,
  //           approveTo: <string>swapData.to,
  //           sendingAssetId: DAI_ADDRESS,
  //           receivingAssetId: USDC_ADDRESS,
  //           callData: <string>swapData?.data,
  //           fromAmount: amountIn,
  //         },
  //       ],
  //       HopData,
  //       { gasLimit: 500000 }
  //     )
  //   )
  //     .to.emit(lifi, 'AssetSwapped')
  //     .and.to.emit(lifi, 'LiFiTransferStarted')
  // })
})
