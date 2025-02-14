// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import { LibAllowList, TestBaseFacet, console, ERC20 } from "../utils/TestBaseFacet.sol";
import { ChainflipFacet } from "lifi/Facets/ChainflipFacet.sol";
import { IChainflipVault } from "lifi/Interfaces/IChainflip.sol";
import { LibAsset } from "lifi/Libraries/LibAsset.sol";
import { LibSwap } from "lifi/Libraries/LibSwap.sol";

// Stub ChainflipFacet Contract
contract TestChainflipFacet is ChainflipFacet {
    constructor(
        address _chainflipVault
    ) ChainflipFacet(IChainflipVault(_chainflipVault)) {}

    function addDex(address _dex) external {
        LibAllowList.addAllowedContract(_dex);
    }

    function setFunctionApprovalBySignature(bytes4 _signature) external {
        LibAllowList.addAllowedSelector(_signature);
    }
}

contract ChainflipFacetTest is TestBaseFacet {
    ChainflipFacet.ChainflipData internal validChainflipData;
    TestChainflipFacet internal chainflipFacet;
    address internal CHAINFLIP_VAULT;

    uint256 internal constant CHAIN_ID_ETHEREUM = 1;
    uint256 internal constant CHAIN_ID_ARBITRUM = 42161;
    uint256 internal constant CHAIN_ID_SOLANA = 1151111081099710;
    uint256 internal constant CHAIN_ID_BITCOIN = 20000000000001;

    function setUp() public {
        customBlockNumberForForking = 18277082;
        initTestBase();

        // Read chainflip vault address from config using the new helper
        CHAINFLIP_VAULT = getConfigAddressFromPath(
            "chainflip.json",
            ".chainflipVault.mainnet"
        );
        vm.label(CHAINFLIP_VAULT, "Chainflip Vault");
        console.log("Chainflip Vault Address:", CHAINFLIP_VAULT);

        chainflipFacet = new TestChainflipFacet(CHAINFLIP_VAULT);
        bytes4[] memory functionSelectors = new bytes4[](4);
        functionSelectors[0] = chainflipFacet
            .startBridgeTokensViaChainflip
            .selector;
        functionSelectors[1] = chainflipFacet
            .swapAndStartBridgeTokensViaChainflip
            .selector;
        functionSelectors[2] = chainflipFacet.addDex.selector;
        functionSelectors[3] = chainflipFacet
            .setFunctionApprovalBySignature
            .selector;

        addFacet(diamond, address(chainflipFacet), functionSelectors);
        chainflipFacet = TestChainflipFacet(address(diamond));
        chainflipFacet.addDex(ADDRESS_UNISWAP);
        chainflipFacet.setFunctionApprovalBySignature(
            uniswap.swapExactTokensForTokens.selector
        );
        chainflipFacet.setFunctionApprovalBySignature(
            uniswap.swapTokensForExactETH.selector
        );
        chainflipFacet.setFunctionApprovalBySignature(
            uniswap.swapETHForExactTokens.selector
        );

        setFacetAddressInTestBase(address(chainflipFacet), "ChainflipFacet");

        // adjust bridgeData
        bridgeData.bridge = "chainflip";
        bridgeData.destinationChainId = 42161; // Arbitrum chain ID

        // produce valid ChainflipData
        validChainflipData = ChainflipFacet.ChainflipData({
            nonEVMReceiver: bytes32(0), // Default to empty for EVM addresses
            dstToken: 7,
            message: "", // Add new field
            gasAmount: 0, // Add new field
            cfParameters: ""
        });
    }

    function initiateBridgeTxWithFacet(bool isNative) internal override {
        if (isNative) {
            chainflipFacet.startBridgeTokensViaChainflip{
                value: bridgeData.minAmount
            }(bridgeData, validChainflipData);
        } else {
            chainflipFacet.startBridgeTokensViaChainflip(
                bridgeData,
                validChainflipData
            );
        }
    }

    function initiateSwapAndBridgeTxWithFacet(
        bool isNative
    ) internal override {
        if (isNative) {
            chainflipFacet.swapAndStartBridgeTokensViaChainflip{
                value: swapData[0].fromAmount
            }(bridgeData, swapData, validChainflipData);
        } else {
            chainflipFacet.swapAndStartBridgeTokensViaChainflip(
                bridgeData,
                swapData,
                validChainflipData
            );
        }
    }

    function test_CanBridgeTokensToSolana()
        public
        assertBalanceChange(
            ADDRESS_USDC,
            USER_SENDER,
            -int256(defaultUSDCAmount)
        )
        assertBalanceChange(ADDRESS_DAI, USER_SENDER, 0)
    {
        bridgeData.receiver = LibAsset.NON_EVM_ADDRESS;
        bridgeData.destinationChainId = CHAIN_ID_SOLANA;
        validChainflipData = ChainflipFacet.ChainflipData({
            dstToken: 6,
            nonEVMReceiver: bytes32(
                abi.encodePacked(
                    "EoW7FWTdPdZKpd3WAhH98c2HMGHsdh5yhzzEtk1u68Bb"
                )
            ), // Example Solana address
            message: "",
            gasAmount: 0,
            cfParameters: ""
        });

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        //prepare check for events
        vm.expectEmit(true, true, true, true, _facetTestContractAddress);
        emit LiFiTransferStarted(bridgeData);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    function test_CanBridgeTokensToBitcoin()
        public
        assertBalanceChange(
            ADDRESS_USDC,
            USER_SENDER,
            -int256(defaultUSDCAmount)
        )
        assertBalanceChange(ADDRESS_DAI, USER_SENDER, 0)
    {
        bridgeData.receiver = LibAsset.NON_EVM_ADDRESS;
        bridgeData.destinationChainId = CHAIN_ID_BITCOIN;
        validChainflipData = ChainflipFacet.ChainflipData({
            dstToken: 6,
            nonEVMReceiver: bytes32(
                abi.encodePacked("bc1q6l08rtj6j907r2een0jqs6l7qnruwyxfshmf8a")
            ), // Example Bitcoin address
            message: "",
            gasAmount: 0,
            cfParameters: ""
        });

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        //prepare check for events
        vm.expectEmit(true, true, true, true, _facetTestContractAddress);
        emit LiFiTransferStarted(bridgeData);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    function test_CanBridgeTokensToEthereum()
        public
        assertBalanceChange(
            ADDRESS_USDC,
            USER_SENDER,
            -int256(defaultUSDCAmount)
        )
        assertBalanceChange(ADDRESS_USDC, USER_RECEIVER, 0)
        assertBalanceChange(ADDRESS_DAI, USER_SENDER, 0)
        assertBalanceChange(ADDRESS_DAI, USER_RECEIVER, 0)
    {
        // Set source chain to Arbitrum for this test
        vm.chainId(CHAIN_ID_ARBITRUM);
        vm.roll(208460950); // Set specific block number for Arbitrum chain

        // Set destination to Ethereum
        bridgeData.destinationChainId = CHAIN_ID_ETHEREUM;
        validChainflipData = ChainflipFacet.ChainflipData({
            dstToken: 3, // USDC on Ethereum
            nonEVMReceiver: bytes32(0), // Not needed for EVM chains
            message: "",
            gasAmount: 0,
            cfParameters: ""
        });

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        //prepare check for events
        vm.expectEmit(true, true, true, true, _facetTestContractAddress);
        emit LiFiTransferStarted(bridgeData);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    function testRevert_WhenUsingUnsupportedDestinationChain() public {
        // Set destination chain to Polygon (unsupported)
        bridgeData.destinationChainId = 137;

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        vm.expectRevert(ChainflipFacet.UnsupportedChainflipChainId.selector);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    function testRevert_WhenUsingEmptyNonEVMAddress() public {
        bridgeData.receiver = LibAsset.NON_EVM_ADDRESS;
        bridgeData.destinationChainId = CHAIN_ID_SOLANA;
        validChainflipData = ChainflipFacet.ChainflipData({
            dstToken: 6,
            nonEVMReceiver: bytes32(0), // Empty address should fail
            message: "",
            gasAmount: 0,
            cfParameters: ""
        });

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        vm.expectRevert(ChainflipFacet.EmptyNonEvmAddress.selector);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    function test_CanBridgeTokensWithDestinationCall()
        public
        assertBalanceChange(
            ADDRESS_USDC,
            USER_SENDER,
            -int256(defaultUSDCAmount)
        )
        assertBalanceChange(ADDRESS_USDC, USER_RECEIVER, 0)
        assertBalanceChange(ADDRESS_DAI, USER_SENDER, 0)
        assertBalanceChange(ADDRESS_DAI, USER_RECEIVER, 0)
    {
        // Set destination to Arbitrum where our receiver contract is
        bridgeData.destinationChainId = CHAIN_ID_ARBITRUM;
        bridgeData.hasDestinationCall = true;

        // Create swap data for the destination chain
        LibSwap.SwapData[] memory destSwapData = new LibSwap.SwapData[](0);

        // Encode the message for the receiver contract
        bytes memory message = abi.encode(
            bridgeData.transactionId,
            destSwapData,
            USER_RECEIVER // Final receiver of the tokens
        );

        validChainflipData = ChainflipFacet.ChainflipData({
            dstToken: 7, // USDC on Arbitrum
            nonEVMReceiver: bytes32(0), // Not needed for EVM chains
            message: message, // Use message here
            gasAmount: 0, // Add gas amount
            cfParameters: "" // Empty parameters
        });

        vm.startPrank(USER_SENDER);

        // approval
        usdc.approve(_facetTestContractAddress, bridgeData.minAmount);

        //prepare check for events
        vm.expectEmit(true, true, true, true, _facetTestContractAddress);
        emit LiFiTransferStarted(bridgeData);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }
}
