import { consola } from 'consola'
import { $ } from 'zx'
import { defineCommand, runMain } from 'citty'
import * as path from 'path'
import * as fs from 'fs'
import toml from 'toml'
import { Address, PublicClient, createPublicClient, http } from 'viem'
import { getViemChainForNetworkName } from '../utils/viemScriptHelpers'
import Table from 'cli-table3'
import chalk from 'chalk'
import { Spinner } from '../utils/spinner'

// ---------------------------------------------------------------------
// Constants & Enums
// ---------------------------------------------------------------------
enum VerificationStatus {
  ERROR = 'ERROR',
  WARN = 'WARN',
  SUCCESS = 'SUCCESS',
  INFO = 'INFO',
}

const NA = 'N/A'
const NO_VERSION = 'none'
const UNKNOWN = 'unknown'

// ---------------------------------------------------------------------
// Interfaces and Types
// ---------------------------------------------------------------------

interface FacetReport {
  facet: string
  onChain: string
  deployLog: string
  diamondDeployLog?: string // Only used for diamond verification
  status: VerificationStatus
  message: string
}

type DeployLogContracts = Record<string, Address>

interface DiamondDeployLog {
  LiFiDiamond: {
    Facets: Record<string, { Name: string; Version: string }>
    Periphery: Record<string, string>
  }
}

// Global arrays for reports
const onChainReports: FacetReport[] = [] // Process 1: On-Chain vs. Deploy Log
const diamondReports: FacetReport[] = [] // Process 2: Diamond vs. Deploy Log

// Global sets to hold processed facet names
const processedOnChainFacets = new Set<string>() // For Process 1
const processedDiamondFacets = new Set<string>() // For Process 2

// Global set to hold on-chain facet addresses (used for missing-onchain check)
const onChainAddressSet = new Set<string>()

// Helper function to safely check own property without using Object.hasOwn()
function hasOwnProp(obj: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// Helper function to format version strings.
function formatVersion(version: string | null): string {
  return version && version.trim() !== '' ? version.trim() : NO_VERSION
}

// ---------------------------------------------------------------------
// Main Command Definition
// ---------------------------------------------------------------------

const main = defineCommand({
  meta: {
    name: 'LIFI Deployment Verification',
    description:
      'Verifies that on-chain facet data and diamond registry are consistent with the deploy log ({network}.json).',
  },
  args: {
    network: {
      type: 'string',
      description: 'EVM network to check',
      required: true,
    },
    onlyIssues: {
      type: 'boolean',
      description:
        'If true, only rows with status ERROR or WARN are displayed in the final reports',
      default: false,
    },
  },
  async run({ args }) {
    const spinner = new Spinner('Initializing...')
    spinner.start()

    // INITIAL SETUP
    const { default: networksConfig } = await import(
      '../../config/networks.json'
    )
    type NetworkName = keyof typeof networksConfig
    let { network } = args
    network = network.toLowerCase() as NetworkName
    const { onlyIssues } = args

    spinner.text = `Loading deployment logs for ${network.toUpperCase()}...`
    const networkDeployLogPath = path.resolve(
      __dirname,
      '../../deployments/',
      `${network}.json`
    )
    const networkDiamondLogPath = path.resolve(
      __dirname,
      '../../deployments/',
      `${network}.diamond.json`
    )

    const { default: networkDeployLogContracts } = (await import(
      networkDeployLogPath
    )) as { default: DeployLogContracts }
    const { default: networkDiamondLog } = (await import(
      networkDiamondLogPath
    )) as { default: DiamondDeployLog }

    const chain = getViemChainForNetworkName(network)
    const publicClient = createPublicClient({
      batch: { multicall: true },
      chain,
      transport: http(),
    })
    spinner.succeed(`Deployment logs loaded for ${network.toUpperCase()}.`)

    // STEP 1: Check LiFiDiamond Deployment.
    spinner.start('Checking LiFiDiamond contract deployment...')
    const diamondDeployed = await checkIsDeployed(
      'LiFiDiamond',
      networkDeployLogContracts,
      publicClient
    )
    if (!diamondDeployed) {
      spinner.fail('LiFiDiamond contract is not deployed. Exiting process.')
      throw new Error('Diamond contract not found on-chain.')
    }
    spinner.succeed('LiFiDiamond contract is deployed.')
    const diamondLogAddress = networkDeployLogContracts['LiFiDiamond']

    // STEP 2: Verify On-Chain Facets vs. Deploy Log.
    spinner.start('Verifying on-chain facets against deploy log...')
    await verifyOnChainAgainstDeployLog({
      network,
      diamondLogAddress,
      networkDeployLogContracts,
      networksConfig,
    })
    // Also check for deploy log entries missing on-chain.
    verifyMissingOnChain(networkDeployLogContracts, onChainAddressSet)
    spinner.succeed('On-chain facets verification complete.')

    // STEP 3: Verify Diamond File vs. Deploy Log.
    spinner.start('Verifying diamond file facets against deploy log...')
    await verifyDiamondAgainstDeployLog({
      network,
      networkDeployLogContracts,
      networkDiamondLog,
    })
    spinner.succeed('Diamond file facets verification complete.')

    // STEP 4: Verify Missing Entries in Diamond File.
    spinner.start('Verifying missing entries in diamond file...')
    verifyMissingInDiamond(networkDeployLogContracts, networkDiamondLog)
    spinner.succeed('Missing entries verification complete.')

    // Print report tables.
    printReportTable(
      onChainReports,
      'On-Chain vs. Deploy Log Verification',
      false,
      onlyIssues
    )
    printReportTable(
      diamondReports,
      'Diamond File vs. Deploy Log Verification',
      true,
      onlyIssues
    )

    spinner.succeed('Verification Process Completed.')
  },
})

// ---------------------------------------------------------------------
// Process 1: Verify On-Chain Facets vs. Deploy Log ({network}.json)
// ---------------------------------------------------------------------

interface OnChainParams {
  network: string
  diamondLogAddress: Address
  networkDeployLogContracts: DeployLogContracts
  networksConfig: any
}
async function verifyOnChainAgainstDeployLog({
  network,
  diamondLogAddress,
  networkDeployLogContracts,
  networksConfig,
}: OnChainParams) {
  try {
    const foundryTomlPath = path.resolve(__dirname, '../../foundry.toml')
    const foundryTomlContent = fs.readFileSync(foundryTomlPath, 'utf8')
    const foundryConfig = toml.parse(foundryTomlContent)
    const etherscanConfig = foundryConfig.etherscan[network]
    if (!etherscanConfig)
      throw new Error(
        `Etherscan configuration not found for network: ${network}`
      )
    const baseUrl = etherscanConfig.url
    const rpcUrl: string = networksConfig[network].rpcUrl
    if (!rpcUrl) throw new Error(`RPC URL not found for network: ${network}`)

    const facetsCmd =
      await $`cast call ${diamondLogAddress} "facets() returns ((address,bytes4[])[])" --rpc-url ${rpcUrl}`
    const rawData = facetsCmd.stdout
    const jsonStr = rawData
      .replace(/\(/g, '[')
      .replace(/\)/g, ']')
      .replace(/0x[0-9a-fA-F]+/g, '"$&"')
    const onChainFacets: string[][] = JSON.parse(jsonStr)
    if (!Array.isArray(onChainFacets))
      throw new Error('Unexpected on-chain facets format.')

    for (const [facetAddress] of onChainFacets) {
      const onChainAddr = facetAddress.toLowerCase()
      // Add to global on-chain address set.
      onChainAddressSet.add(onChainAddr)
      let facetName = ''
      let deployLogAddr = ''
      let status: VerificationStatus
      let message = ''

      const facetData = await fetchContractDetails(
        baseUrl,
        onChainAddr,
        network
      )
      facetName = facetData?.ContractName || ''
      if (!facetName) {
        const foundName = Object.keys(networkDeployLogContracts).find(
          (name) =>
            networkDeployLogContracts[name].toLowerCase() === onChainAddr
        )
        if (!foundName) {
          message += `No contract name on-chain and not found in deploy log.`
          status = VerificationStatus.ERROR
          onChainReports.push({
            facet: UNKNOWN,
            onChain: onChainAddr,
            deployLog: NA,
            status,
            message,
          })
          continue
        } else {
          facetName = foundName
          message += `Contract not verified. Assumed contract name "${facetName}" from deploy log. `
          status = VerificationStatus.INFO
        }
      }
      // Record processed facet name to avoid duplicates.
      processedOnChainFacets.add(facetName)
      deployLogAddr = networkDeployLogContracts[facetName]?.toLowerCase() || NA

      // Check for contract file in src/; if not found, check archive/.
      const srcPath = findContractFile('src', facetName)
      if (!srcPath) {
        const archivePath = findContractFile('archive', facetName)
        if (archivePath) {
          message += `Contract file found in archive; please remove contract from diamond and deploy log.`
        } else {
          message += `Contract file not found in src.`
        }
        status = VerificationStatus.ERROR
        onChainReports.push({
          facet: facetName,
          onChain: onChainAddr,
          deployLog: deployLogAddr,
          status,
          message,
        })
        continue
      }
      const repoSource = fs.readFileSync(srcPath, 'utf8')
      const repoVersion = extractVersion(repoSource)
      if (!repoVersion) {
        message += `Repo version missing in source.`
        status = VerificationStatus.ERROR
        onChainReports.push({
          facet: facetName,
          onChain: onChainAddr,
          deployLog: deployLogAddr,
          status,
          message,
        })
        continue
      }

      message += `Facet "${facetName}": `
      if (deployLogAddr === onChainAddr) {
        const onChainVersion = extractVersion(facetData.SourceCode) || ''
        if (isVersionNewer(repoVersion, onChainVersion)) {
          message += `Repo version (${repoVersion}) is newer than on-chain (${onChainVersion}).`
          status = VerificationStatus.WARN
        } else {
          message += `Addresses match and versions are consistent.`
          status = VerificationStatus.SUCCESS
        }
      } else {
        message += `Address mismatch: on-chain (${onChainAddr}) vs deploy log (${deployLogAddr}). `
        const deployLogData = await fetchContractDetails(
          baseUrl,
          deployLogAddr,
          network
        )
        const deployLogVersion = extractVersion(deployLogData?.SourceCode) || ''
        const onChainVersion = extractVersion(facetData.SourceCode) || ''
        if (isVersionNewer(onChainVersion, deployLogVersion)) {
          message += `On-chain version (${onChainVersion}) is newer than deploy log version (${deployLogVersion}). Please update the deploy log.`
          status = VerificationStatus.ERROR
        } else if (isVersionNewer(deployLogVersion, onChainVersion)) {
          message += `Deploy log version (${deployLogVersion}) is newer than on-chain version (${onChainVersion}). Please register facet from deploy log.`
          status = VerificationStatus.ERROR
        } else {
          message += `Versions identical but addresses differ. Please reconcile.`
          status = VerificationStatus.ERROR
        }
      }
      onChainReports.push({
        facet: facetName,
        onChain: onChainAddr,
        deployLog: deployLogAddr,
        status,
        message: message.trim(),
      })
    }
  } catch (error) {
    consola.error(
      'Error in on-chain verification:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// ---------------------------------------------------------------------
// New function: Verify Missing Facets in Deploy Log Not Fetched On-Chain.
function verifyMissingOnChain(
  deployLog: DeployLogContracts,
  onChainSet: Set<string>
) {
  // Iterate over deploy log keys that include 'Facet' (excluding LiFiDiamond).
  for (const key in deployLog) {
    if (key === 'LiFiDiamond') continue
    if (key.includes('Facet')) {
      // Skip if already processed in Process 1.
      if (processedOnChainFacets.has(key)) continue
      const deployAddr = deployLog[key].toLowerCase()
      if (!onChainSet.has(deployAddr)) {
        const srcPath = findContractFile('src', key)
        let message = ''
        if (srcPath) {
          message = `Contract file found in src; please verify its status.`
        } else {
          const archivePath = findContractFile('archive', key)
          if (archivePath) {
            message = `Contract file found in archive; please remove contract from diamond and deploy log.`
          } else {
            message = `Contract file not found in src.`
          }
        }
        onChainReports.push({
          facet: key,
          onChain: NA,
          deployLog: deployAddr,
          status: VerificationStatus.ERROR,
          message: `Facet "${key}" is present in deploy log but not fetched on-chain. ${message}`,
        })
      }
    }
  }
}

// ---------------------------------------------------------------------
// Process 2: Verify Diamond File vs. Deploy Log
// In this process, we display only Diamond Log Address and Deploy Log Address.
// If the diamond file facet has an unknown name or missing deploy log entry,
// we attempt to fetch contract details using the diamond log address to update the name,
// then look up its deploy log address and compare versions.
// Additionally, we now check whether the contract file exists in src/ (or in archive/)
// and also fetch the on-chain version. The on-chain version is compared with the diamond file version;
// if both are empty, they are considered matching.
interface DiamondParams {
  network: string
  networkDeployLogContracts: DeployLogContracts
  networkDiamondLog: DiamondDeployLog
}
async function verifyDiamondAgainstDeployLog({
  network,
  networkDeployLogContracts,
  networkDiamondLog,
}: DiamondParams) {
  try {
    const foundryTomlPath = path.resolve(__dirname, '../../foundry.toml')
    const foundryTomlContent = fs.readFileSync(foundryTomlPath, 'utf8')
    const foundryConfig = toml.parse(foundryTomlContent)
    const etherscanConfig = foundryConfig.etherscan[network]
    if (!etherscanConfig)
      throw new Error(
        `Etherscan configuration not found for network: ${network}`
      )
    const baseUrl = etherscanConfig.url

    const diamondLogFacets = networkDiamondLog.LiFiDiamond.Facets
    for (const addr in diamondLogFacets) {
      const diamondLogAddr = addr.toLowerCase()
      let facetName = diamondLogFacets[addr].Name || UNKNOWN
      // Get diamond file version from JSON.
      const diamondFileVersion = diamondLogFacets[addr].Version || ''
      // Fetch the on-chain version for this facet.
      const chainDiamondData = await fetchContractDetails(
        baseUrl,
        diamondLogAddr,
        network
      )
      const chainDiamondVersion = chainDiamondData
        ? formatVersion(extractVersion(chainDiamondData.SourceCode))
        : ''
      // Only add a version note if at least one version is non-empty and they differ.
      let versionNote = ''
      if (
        (diamondFileVersion.trim() !== '' ||
          chainDiamondVersion.trim() !== '') &&
        diamondFileVersion.trim() !== chainDiamondVersion.trim()
      ) {
        versionNote = ` Note: Diamond file version (${formatVersion(
          diamondFileVersion
        )}) does not match on-chain version (${formatVersion(
          chainDiamondVersion
        )}).`
      }
      let deployLogAddr =
        networkDeployLogContracts[facetName]?.toLowerCase() || NA
      let status: VerificationStatus
      let message = ''

      // If facetName is unknown or deployLogAddr is missing, try to fetch contract details using diamond log address.
      if (facetName === UNKNOWN || deployLogAddr === NA) {
        const diamondData = await fetchContractDetails(
          baseUrl,
          diamondLogAddr,
          network
        )
        if (diamondData && diamondData.ContractName) {
          facetName = diamondData.ContractName
          message += `Diamond log contract verified as "${facetName}". `
          deployLogAddr =
            networkDeployLogContracts[facetName]?.toLowerCase() || NA
        } else {
          message += `Diamond contract at ${diamondLogAddr} is not verified. `
        }
      }

      // Check for contract file in src/; if not found, check archive/.
      const srcPath = findContractFile('src', facetName)
      if (!srcPath) {
        const archivePath = findContractFile('archive', facetName)
        if (archivePath) {
          message += `Contract file found in archive; please remove contract from diamond and deploy log. `
          status = VerificationStatus.ERROR
          diamondReports.push({
            facet: facetName,
            onChain: NA,
            deployLog: deployLogAddr,
            diamondDeployLog: diamondLogAddr,
            status,
            message: (message + versionNote).trim(),
          })
          processedDiamondFacets.add(facetName)
          continue
        } else {
          message += `Contract file not found in src. `
          status = VerificationStatus.ERROR
        }
      }

      if (deployLogAddr === NA) {
        message += `Facet "${facetName}" is present in diamond file but missing in deploy log.`
        status = VerificationStatus.ERROR
      } else if (deployLogAddr === diamondLogAddr) {
        if (
          chainDiamondVersion.trim() === '' ||
          chainDiamondVersion === NO_VERSION
        ) {
          message += `On-chain diamond version is empty; facet may be unverified.`
          status = VerificationStatus.WARN
        } else {
          message += `Facet "${facetName}" matches between diamond file and deploy log.`
          status = VerificationStatus.SUCCESS
        }
      } else {
        // Address mismatch.
        const deployLogData = await fetchContractDetails(
          baseUrl,
          deployLogAddr,
          network
        )
        const deployLogVersion =
          deployLogData && typeof deployLogData.SourceCode === 'string'
            ? formatVersion(extractVersion(deployLogData.SourceCode))
            : ''
        let compareMessage = ''
        if (isVersionNewer(chainDiamondVersion, deployLogVersion)) {
          compareMessage = `On-chain diamond version (${formatVersion(
            chainDiamondVersion
          )}) is newer than deploy log version (${formatVersion(
            deployLogVersion
          )}). Please update the deploy log accordingly.`
        } else if (isVersionNewer(deployLogVersion, chainDiamondVersion)) {
          compareMessage = `Deploy log version (${formatVersion(
            deployLogVersion
          )}) is newer than on-chain diamond version (${formatVersion(
            chainDiamondVersion
          )}). Please register facet from deploy log.`
        } else {
          compareMessage = `Versions are identical but addresses differ. Please reconcile.`
        }
        message += `Address mismatch for facet "${facetName}": diamond file shows (${diamondLogAddr}) vs deploy log (${deployLogAddr}). ${compareMessage}`
        status = VerificationStatus.ERROR
      }
      // Append note about version mismatch between diamond file and on-chain version.
      message += versionNote
      diamondReports.push({
        facet: facetName,
        onChain: NA,
        deployLog: deployLogAddr,
        diamondDeployLog: diamondLogAddr,
        status,
        message: message.trim(),
      })
      processedDiamondFacets.add(facetName)
    }

    // Process periphery contracts.
    const diamondPeriphery = networkDiamondLog.LiFiDiamond.Periphery
    for (const key in diamondPeriphery) {
      const diamondPeriphAddr = diamondPeriphery[key].toLowerCase()
      const deployLogPeriphAddr =
        networkDeployLogContracts[key]?.toLowerCase() || NA
      let status: VerificationStatus
      let message = ''

      // Fetch contract details for version comparison.
      const diamondPeriphDetails = await fetchContractDetails(
        baseUrl,
        diamondPeriphAddr,
        network
      )
      const deployLogPeriphDetails =
        deployLogPeriphAddr !== NA
          ? await fetchContractDetails(baseUrl, deployLogPeriphAddr, network)
          : null
      const diamondVersion = diamondPeriphDetails
        ? formatVersion(extractVersion(diamondPeriphDetails.SourceCode))
        : NO_VERSION
      const deployLogVersion = deployLogPeriphDetails
        ? formatVersion(extractVersion(deployLogPeriphDetails.SourceCode))
        : NO_VERSION

      if (deployLogPeriphAddr === diamondPeriphAddr) {
        status = VerificationStatus.SUCCESS
        message = `Periphery contract "${key}" matches.`
        if (diamondVersion !== NO_VERSION && deployLogVersion !== NO_VERSION) {
          if (diamondVersion !== deployLogVersion) {
            message += ` However, version mismatch: diamond (${diamondVersion}) vs deploy log (${deployLogVersion}).`
            status = VerificationStatus.WARN
          } else {
            message += ` Versions match (${diamondVersion}).`
          }
        }
      } else {
        status = VerificationStatus.ERROR
        message = `Periphery contract "${key}" mismatch: diamond (${diamondPeriphAddr}) vs deploy log (${deployLogPeriphAddr}).`
        if (diamondVersion !== NO_VERSION && deployLogVersion !== NO_VERSION) {
          if (diamondVersion !== deployLogVersion) {
            message += ` Versions: diamond (${diamondVersion}) vs deploy log (${deployLogVersion}).`
          } else {
            message += ` Versions identical (${diamondVersion}) but addresses differ.`
          }
        }
      }
      diamondReports.push({
        facet: key,
        onChain: NA,
        deployLog: deployLogPeriphAddr,
        diamondDeployLog: diamondPeriphAddr,
        status,
        message,
      })
    }
  } catch (error) {
    consola.error(
      'Error in diamond verification:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// ---------------------------------------------------------------------
// Additional: Verify Missing Entries in Diamond File
// This function checks for contracts present in the deploy log but missing in the diamond file.
// It will ignore those facets already processed in Process 2.
function verifyMissingInDiamond(
  deployLog: DeployLogContracts,
  diamondLog: DiamondDeployLog
) {
  for (const key in deployLog) {
    if (key === 'LiFiDiamond') continue
    if (key.includes('Facet')) {
      if (processedDiamondFacets.has(key)) continue
      let found = false
      for (const addr in diamondLog.LiFiDiamond.Facets) {
        if (diamondLog.LiFiDiamond.Facets[addr].Name === key) {
          found = true
          break
        }
      }
      if (!found) {
        diamondReports.push({
          facet: key,
          onChain: NA,
          deployLog: deployLog[key].toLowerCase(),
          diamondDeployLog: NA,
          status: VerificationStatus.WARN,
          message: `Facet "${key}" is present in deploy log but missing in diamond file.`,
        })
      }
    } else {
      if (!hasOwnProp(diamondLog.LiFiDiamond.Periphery, key)) {
        diamondReports.push({
          facet: key,
          onChain: NA,
          deployLog: deployLog[key].toLowerCase(),
          diamondDeployLog: NA,
          status: VerificationStatus.WARN,
          message: `Contract "${key}" is present in deploy log but missing in diamond file.`,
        })
      }
    }
  }
}

// ---------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------

function findContractFile(
  baseDir: string,
  contractName: string
): string | null {
  const files = fs.readdirSync(baseDir, { withFileTypes: true })
  for (const file of files) {
    const filePath = path.join(baseDir, file.name)
    if (file.isDirectory()) {
      const found = findContractFile(filePath, contractName)
      if (found) return found
    } else if (file.name === `${contractName}.sol`) {
      return filePath
    }
  }
  return null
}

const fetchContractDetails = async (
  baseUrl: string,
  contractAddress: string,
  network: string
) => {
  await delay(400)
  const apiKeyEnvVar = `${network.toUpperCase()}_ETHERSCAN_API_KEY`
  const apiKey = process.env[apiKeyEnvVar]
  if (!apiKey)
    throw new Error(
      `Missing API key for ${network}. Please set ${apiKeyEnvVar} in your environment.`
    )
  const url = new URL(baseUrl)
  url.searchParams.append('module', 'contract')
  url.searchParams.append('action', 'getsourcecode')
  url.searchParams.append('address', contractAddress)
  url.searchParams.append('apiKey', apiKey)
  const response = await fetch(url.toString())
  const data = await response.json()
  if (data.result.includes('Invalid API Key')) {
    consola.error(data.result)
    return null
  }
  if (
    data.result.includes(
      'Missing or unsupported chainid parameter (required for v2 api)'
    )
  ) {
    consola.warn(
      'Missing or unsupported chainid parameter. See https://api.etherscan.io/v2/chainlist for details.'
    )
    return null
  }
  return data.result[0] ?? null
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function extractVersion(sourceCode: string): string | null {
  const versionMatch = sourceCode.match(/@custom:version\s+([\d.]+)/)
  return versionMatch ? versionMatch[1] : null
}

function parseVersion(version: string): number[] {
  return version.split('.').map((num) => parseInt(num, 10) || 0)
}

function isVersionNewer(
  versionA: string | null,
  versionB: string | null
): boolean {
  if (versionA === null) return false
  if (versionB === null) return true
  const aParts = parseVersion(versionA)
  const bParts = parseVersion(versionB)
  for (let i = 0; i < 3; i++) {
    const a = aParts[i] || 0
    const b = bParts[i] || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

const checkIsDeployed = async (
  contract: string,
  networkDeployLogContracts: DeployLogContracts,
  publicClient: PublicClient
): Promise<boolean> => {
  const address = networkDeployLogContracts[contract]
  if (!address) return false
  const code = await publicClient.getCode({ address })
  return code !== '0x'
}

// ---------------------------------------------------------------------
// Reporting: Print a Terminal Table of Verification Results
// Process 1 (On-Chain vs. Deploy Log): 5 columns: Facet, On-Chain Address, Deploy Log Address, Status, Action/Description.
// Process 2 (Diamond vs. Deploy Log): 5 columns: Facet, Diamond Log Address, Deploy Log Address, Status, Action/Description.
// Column widths are set accordingly.
function printReportTable(
  reportArray: FacetReport[],
  title: string,
  includeDiamond: boolean,
  filterOnlyIssues = false
) {
  let head: string[]
  let colWidths: number[]
  if (includeDiamond) {
    head = [
      'Facet',
      'Diamond Log Address',
      'Deploy Log Address',
      'Status',
      'Action / Description',
    ]
    colWidths = [40, 55, 55, 10, 60]
  } else {
    head = [
      'Facet',
      'On-Chain Address',
      'Deploy Log Address',
      'Status',
      'Action / Description',
    ]
    colWidths = [35, 50, 50, 10, 60]
  }
  const table = new Table({ head, colWidths, wordWrap: true })

  reportArray.forEach((report) => {
    if (
      filterOnlyIssues &&
      report.status !== VerificationStatus.ERROR &&
      report.status !== VerificationStatus.WARN
    )
      return
    // Explicitly declare coloredStatus as a string.
    let coloredStatus: string = report.status as string
    if (report.status === VerificationStatus.ERROR)
      coloredStatus = chalk.red(report.status)
    else if (report.status === VerificationStatus.WARN)
      coloredStatus = chalk.yellow(report.status)
    else if (report.status === VerificationStatus.SUCCESS)
      coloredStatus = chalk.green(report.status)
    if (includeDiamond) {
      table.push([
        report.facet,
        report.diamondDeployLog || NA,
        report.deployLog,
        coloredStatus,
        report.message,
      ])
    } else {
      table.push([
        report.facet,
        report.onChain,
        report.deployLog,
        coloredStatus,
        report.message,
      ])
    }
  })

  consola.info(`\n=== ${title} ===\n`)
  console.log(table.toString())
}

runMain(main)
