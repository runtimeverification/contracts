// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import { ILiFi, LibSwap, LibAllowList, TestBaseFacet, console, ERC20 } from "../utils/TestBaseFacet.sol";
import { AmarokFacet } from "lifi/Facets/AmarokFacet.sol";
import { IConnextHandler } from "lifi/Interfaces/IConnextHandler.sol";
import { OnlyContractOwner, InvalidConfig, NotInitialized, AlreadyInitialized, InvalidAmount } from "src/Errors/GenericErrors.sol";

// Stub AmarokFacet Contract
contract TestAmarokFacet is AmarokFacet {
    constructor(IConnextHandler _connextHandler, uint32 _srcChainDomain)
        AmarokFacet(_connextHandler, _srcChainDomain)
    {}

    function addDex(address _dex) external {
        LibAllowList.addAllowedContract(_dex);
    }

    function setFunctionApprovalBySignature(bytes4 _signature) external {
        LibAllowList.addAllowedSelector(_signature);
    }
}

contract AmarokFacetTest is TestBaseFacet {
    address internal constant CONNEXT_HANDLER = 0x01EdE4Fdf8CF7Ef9942a935305C3145f8dAa180A;
    uint32 internal constant DSTCHAIN_DOMAIN_GOERLI = 1735356532;
    uint32 internal constant DSTCHAIN_DOMAIN_MAINNET = 6648936;
    uint32 internal constant DSTCHAIN_DOMAIN_POLYGON = 1886350457;
    // -----

    TestAmarokFacet internal amarokFacet;
    AmarokFacet.AmarokData internal amarokData;

    function setUp() public {
        // set custom block no for mainnet forking
        customBlockNumberForForking = 16176320;

        initTestBase();

        amarokFacet = new TestAmarokFacet(IConnextHandler(CONNEXT_HANDLER), DSTCHAIN_DOMAIN_MAINNET);
        bytes4[] memory functionSelectors = new bytes4[](5);
        functionSelectors[0] = amarokFacet.startBridgeTokensViaAmarok.selector;
        functionSelectors[1] = amarokFacet.swapAndStartBridgeTokensViaAmarok.selector;
        functionSelectors[2] = amarokFacet.setAmarokDomain.selector;
        functionSelectors[3] = amarokFacet.addDex.selector;
        functionSelectors[4] = amarokFacet.setFunctionApprovalBySignature.selector;

        addFacet(diamond, address(amarokFacet), functionSelectors);
        amarokFacet = TestAmarokFacet(address(diamond));
        amarokFacet.addDex(address(uniswap));
        amarokFacet.setFunctionApprovalBySignature(uniswap.swapExactTokensForTokens.selector);
        amarokFacet.setFunctionApprovalBySignature(uniswap.swapETHForExactTokens.selector);

        setFacetAddressInTestBase(address(amarokFacet), "AmarokFacet");

        // label addresses for better call traces
        vm.label(CONNEXT_HANDLER, "CONNEXT_HANDLER");

        // set Amarok domain mappings
        amarokFacet.setAmarokDomain(1, DSTCHAIN_DOMAIN_MAINNET);
        amarokFacet.setAmarokDomain(137, DSTCHAIN_DOMAIN_POLYGON);

        // adjust bridgeData
        bridgeData.bridge = "amarok";
        bridgeData.destinationChainId = 137;

        // produce valid AcrossData
        amarokData = AmarokFacet.AmarokData({
            callData: "",
            forceSlow: false,
            receiveLocal: false,
            callback: address(0),
            callbackFee: 0,
            relayerFee: 0,
            slippageTol: 9995,
            originMinOut: 0
        });

        // make sure relayerFee is sent with every transaction
        addToMessageValue = 1 * 10**15;
    }

    function initiateBridgeTxWithFacet(bool isNative) internal override {
        if (isNative) {
            amarokFacet.startBridgeTokensViaAmarok{ value: bridgeData.minAmount }(bridgeData, amarokData);
        } else {
            amarokFacet.startBridgeTokensViaAmarok(bridgeData, amarokData);
        }
    }

    function initiateSwapAndBridgeTxWithFacet(bool isNative) internal override {
        if (isNative) {
            amarokFacet.swapAndStartBridgeTokensViaAmarok{ value: swapData[0].fromAmount }(
                bridgeData,
                swapData,
                amarokData
            );
        } else {
            amarokFacet.swapAndStartBridgeTokensViaAmarok(bridgeData, swapData, amarokData);
        }
    }

    function testBase_CanBridgeTokens() public override {
        // reference tx: https://etherscan.io/tx/0xe1257ad80fe4fe4d682edcb76fd6ae1612b085a4e22f96ca6b0f36f0faa90708
        vm.startPrank(USER_SENDER);

        // update bridgeData
        bridgeData.sendingAssetId = ADDRESS_WETH;
        bridgeData.minAmount = 100 * 10**weth.decimals();

        // approval
        weth.approve(address(amarokFacet), bridgeData.minAmount);

        //prepare check for events
        vm.expectEmit(true, true, true, true, _facetTestContractAddress);

        emit LiFiTransferStarted(bridgeData);

        initiateBridgeTxWithFacet(false);
        vm.stopPrank();
    }

    // function testRevertToBridgeTokensWhenSendingAmountIsZero() public {
    //     vm.startPrank(TOKEN_HOLDER);

    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     ILiFi.BridgeData memory bridgeData = validBridgeData;
    //     bridgeData.minAmount = 0;

    //     vm.expectRevert(InvalidAmount.selector);
    //     amarokFacet.startBridgeTokensViaAmarok(bridgeData, validAmarokData);

    //     vm.stopPrank();
    // }

    // function testRevertToBridgeTokensWhenReceiverIsZeroAddress() public {
    //     vm.startPrank(TOKEN_HOLDER);

    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     ILiFi.BridgeData memory bridgeData = validBridgeData;
    //     bridgeData.receiver = address(0);

    //     vm.expectRevert(InvalidReceiver.selector);
    //     amarokFacet.startBridgeTokensViaAmarok(bridgeData, validAmarokData);

    //     vm.stopPrank();
    // }

    // function testRevertToBridgeTokensWhenSenderHasNoEnoughAmount() public {
    //     vm.startPrank(TOKEN_HOLDER);

    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     token.transfer(USDC_HOLDER, token.balanceOf(TOKEN_HOLDER));

    //     vm.expectRevert(abi.encodeWithSelector(InsufficientBalance.selector, 10 * 10**token.decimals(), 0));
    //     amarokFacet.startBridgeTokensViaAmarok(validBridgeData, validAmarokData);

    //     vm.stopPrank();
    // }

    // function testRevertToBridgeTokensWhenSendingNativeAsset() public {
    //     vm.startPrank(TOKEN_HOLDER);

    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     ILiFi.BridgeData memory bridgeData = validBridgeData;
    //     bridgeData.sendingAssetId = address(0);
    //     bridgeData.minAmount = 3e18;

    //     vm.expectRevert(NativeAssetNotSupported.selector);
    //     amarokFacet.startBridgeTokensViaAmarok(bridgeData, validAmarokData);

    //     vm.stopPrank();
    // }

    // function testRevertToBridgeTokensWhenInformationMismatch() public {
    //     vm.startPrank(TOKEN_HOLDER);

    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     ILiFi.BridgeData memory bridgeData = validBridgeData;
    //     bridgeData.hasSourceSwaps = true;

    //     vm.expectRevert(InformationMismatch.selector);
    //     amarokFacet.startBridgeTokensViaAmarok(bridgeData, validAmarokData);

    //     vm.stopPrank();
    // }

    // function testCanBridgeTokens() public {
    //     vm.startPrank(TOKEN_HOLDER);
    //     token.approve(address(amarokFacet), 10_000 * 10**token.decimals());

    //     amarokFacet.startBridgeTokensViaAmarok(validBridgeData, validAmarokData);
    //     vm.stopPrank();
    // }

    // function testCanSwapAndBridgeTokens() public {
    //     vm.startPrank(USDC_HOLDER);

    //     usdc.approve(address(amarokFacet), 10_000 * 10**usdc.decimals());

    //     // Swap USDC to TOKEN
    //     address[] memory path = new address[](2);
    //     path[0] = USDC_ADDRESS;
    //     path[1] = TOKEN_ADDRESS;

    //     uint256 amountOut = 10 * 10**token.decimals();

    //     // Calculate TOKEN amount
    //     uint256[] memory amounts = uniswap.getAmountsIn(amountOut, path);
    //     uint256 amountIn = amounts[0];
    //     LibSwap.SwapData[] memory swapData = new LibSwap.SwapData[](1);
    //     swapData[0] = LibSwap.SwapData(
    //         address(uniswap),
    //         address(uniswap),
    //         USDC_ADDRESS,
    //         TOKEN_ADDRESS,
    //         amountIn,
    //         abi.encodeWithSelector(
    //             uniswap.swapExactTokensForTokens.selector,
    //             amountIn,
    //             amountOut,
    //             path,
    //             address(amarokFacet),
    //             block.timestamp + 20 minutes
    //         ),
    //         true
    //     );

    //     ILiFi.BridgeData memory bridgeData = validBridgeData;
    //     bridgeData.hasSourceSwaps = true;

    //     amarokFacet.swapAndStartBridgeTokensViaAmarok(bridgeData, swapData, validAmarokData);

    //     vm.stopPrank();
    // }
}
