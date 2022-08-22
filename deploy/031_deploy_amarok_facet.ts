import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { addOrReplaceFacets } from '../utils/diamond'
import { verifyContract } from './9999_verify_all_facets'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  await deploy('AmarokFacet', {
    from: deployer,
    log: true,
    deterministicDeployment: true,
  })

  const amarokFacet = await ethers.getContract('AmarokFacet')

  const diamond = await ethers.getContract('LiFiDiamond')

  await addOrReplaceFacets([amarokFacet], diamond.address)

  await verifyContract(hre, 'AmarokFacet', {
    address: amarokFacet.address,
  })
}

export default func
func.id = 'deploy_amarok_facet'
func.tags = ['DeployAmarokFacet']
func.dependencies = [
  'InitialFacets',
  'LiFiDiamond',
  'InitFacets',
  'DeployDexManagerFacet',
]
