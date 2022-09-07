import { DeployFunction } from 'hardhat-deploy/types'
import { ethers, getNamedAccounts } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

export const verifyContract = async function (
  hre: HardhatRuntimeEnvironment,
  name: string,
  options?: { address?: string; args?: string[] }
) {
  if (hre.network.name === 'hardhat') {
    return
  }

  try {
    await hre.run('verify:verify', {
      address: options?.address || (await ethers.getContract(name)).address,
      constructorArguments: options?.args || [],
    })
  } catch (e) {
    console.log(`Failed to verify contract: ${e}`)
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { network } = hre

  if (network.name === 'hardhat') return

  const { deployer } = await getNamedAccounts()

  await verifyContract(hre, 'LiFiDiamond', {
    args: [deployer, (await ethers.getContract('DiamondCutFacet')).address],
  })

  await verifyContract(hre, 'DiamondLoupeFacet')
  await verifyContract(hre, 'DiamondCutFacet')
  await verifyContract(hre, 'OwnershipFacet')

  await verifyContract(hre, 'NXTPFacet')
  await verifyContract(hre, 'WithdrawFacet')
  await verifyContract(hre, 'HopFacet')
  await verifyContract(hre, 'AnyswapFacet')
  await verifyContract(hre, 'HyphenFacet')
  await verifyContract(hre, 'CBridgeFacet')
  await verifyContract(hre, 'GenericBridgeFacet')
  await verifyContract(hre, 'WormholeFacet')
  await verifyContract(hre, 'AcrossFacet')
  await verifyContract(hre, 'OpticsRouterFacet')
  await verifyContract(hre, 'GenericSwapFacet')
  await verifyContract(hre, 'DexManagerFacet')
  await verifyContract(hre, 'StargateFacet')
  await verifyContract(hre, 'GnosisBridgeFacet')
  await verifyContract(hre, 'PolygonBridgeFacet')
  await verifyContract(hre, 'ArbitrumBridgeFacet')
  await verifyContract(hre, 'XChainExecFacet')
  await verifyContract(hre, 'FeeCollector', { args: [deployer] })
  await verifyContract(hre, 'OptimismBridgeFacet')
  await verifyContract(hre, 'OmniBridgeFacet')
  await verifyContract(hre, 'AmarokFacet')
}
export default func
func.id = 'verify_all_facets'
func.tags = ['VerifyAllFacets']
