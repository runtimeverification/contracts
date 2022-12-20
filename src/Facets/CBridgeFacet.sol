// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { LibAsset, IERC20 } from "../Libraries/LibAsset.sol";
import { ILiFi } from "../Interfaces/ILiFi.sol";
import { ICBridge } from "../Interfaces/ICBridge.sol";
import { ReentrancyGuard } from "../Helpers/ReentrancyGuard.sol";
import { SwapperV2, LibSwap } from "../Helpers/SwapperV2.sol";
import { ExternalCallFailed, InvalidReceiver, InvalidAmount, InvalidCaller, InvalidConfig, InformationMismatch, CannotBridgeToSameNetwork } from "../Errors/GenericErrors.sol";
import { LibUtil } from "../Libraries/LibUtil.sol";
import { Validatable } from "../Helpers/Validatable.sol";
import { MessageSenderLib, MsgDataTypes, IMessageBus } from "celer-network/contracts/message/libraries/MessageSenderLib.sol";
import { ERC20 } from "solmate/tokens/ERC20.sol";
import { IMessageReceiverApp } from "celer-network/contracts/message/interfaces/IMessageReceiverApp.sol";
import { RelayerCelerIM } from "lifi/Periphery/RelayerCelerIM.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { console } from "test/solidity/utils/Console.sol"; // TODO: REMOVE

/// @title CBridge Facet
/// @author LI.FI (https://li.fi)
/// @notice Provides functionality for bridging through CBridge
contract CBridgeFacet is ILiFi, ReentrancyGuard, SwapperV2, Validatable {
    event CelerIMMessageWithTransferRefunded(bytes32 indexed transactionId, address indexed refundAddress);

    /// Storage ///

    /// @notice The contract address of the cbridge on the source chain.
    ICBridge private immutable cBridge;
    IMessageBus private immutable cBridgeMessageBus;
    RelayerCelerIM private immutable relayer;

    /// Types ///

    /// @param maxSlippage The max slippage accepted, given as percentage in point (pip).
    /// @param nonce A number input to guarantee uniqueness of transferId. Can be timestamp in practice.
    /// @param callTo the address of the contract to be called at destination
    /// @param callData the encoded calldata (bytes32 transactionId, LibSwap.SwapData[] memory swapData, address receiver, address refundAddress)
    /// @param messageBusFee the fee to be paid to CBridge message bus for relaying the message
    /// @param bridgeType defines the bridge operation type (must be one of the values of CBridge library MsgDataTypes.BridgeSendType)
    struct CBridgeData {
        uint32 maxSlippage;
        uint64 nonce;
        bytes callTo;
        bytes callData;
        uint256 messageBusFee;
        MsgDataTypes.BridgeSendType bridgeType;
    }

    /// Modifiers ///

    /// Constructor ///

    /// @notice Initialize the contract.
    /// @param _cBridge The contract address of the cbridge on the source chain.
    /// @param _messageBus The contract address of the cBridge Message Bus on the source chain.
    /// @param _relayer The contract address of the RelayerCelerIM on the source chain.
    constructor(
        ICBridge _cBridge,
        IMessageBus _messageBus,
        RelayerCelerIM _relayer
    ) {
        cBridge = _cBridge;
        cBridgeMessageBus = _messageBus;
        relayer = _relayer;
    }

    /// External Methods ///

    /// @notice Bridges tokens via CBridge
    /// @param _bridgeData the core information needed for bridging
    /// @param _cBridgeData data specific to CBridge
    function startBridgeTokensViaCBridge(ILiFi.BridgeData memory _bridgeData, CBridgeData calldata _cBridgeData)
        external
        payable
        nonReentrant
        refundExcessNative(payable(msg.sender))
        doesNotContainSourceSwaps(_bridgeData)
        validateBridgeData(_bridgeData)
    {
        validateDestinationCallFlag(_bridgeData, _cBridgeData);
        if (!LibAsset.isNativeAsset(_bridgeData.sendingAssetId)) {
            // transfer ERC20 tokens directly to relayer
            IERC20 asset = IERC20(_bridgeData.sendingAssetId);
            uint256 prevBalance = asset.balanceOf(address(relayer));
            SafeERC20.safeTransferFrom(asset, msg.sender, address(relayer), _bridgeData.minAmount);
            if (asset.balanceOf(address(relayer)) - prevBalance != _bridgeData.minAmount) revert InvalidAmount();
        }
        // LibAsset.transferAsset(_bridgeData.sendingAssetId, payable(address(relayer)), _bridgeData.minAmount);
        _startBridge(_bridgeData, _cBridgeData);
    }

    /// @notice Performs a swap before bridging via CBridge
    /// @param _bridgeData the core information needed for bridging
    /// @param _swapData an array of swap related data for performing swaps before bridging
    /// @param _cBridgeData data specific to CBridge
    function swapAndStartBridgeTokensViaCBridge(
        ILiFi.BridgeData memory _bridgeData,
        LibSwap.SwapData[] calldata _swapData,
        CBridgeData memory _cBridgeData
    )
        external
        payable
        nonReentrant
        refundExcessNative(payable(msg.sender))
        containsSourceSwaps(_bridgeData)
        validateBridgeData(_bridgeData)
    {
        validateDestinationCallFlag(_bridgeData, _cBridgeData);

        _bridgeData.minAmount = _depositAndSwap(
            _bridgeData.transactionId,
            _bridgeData.minAmount,
            _swapData,
            payable(msg.sender)
        );
        if (!LibAsset.isNativeAsset(_bridgeData.sendingAssetId)) {
            // transfer ERC20 tokens directly to relayer
            IERC20 asset = IERC20(_bridgeData.sendingAssetId);
            uint256 prevBalance = asset.balanceOf(address(relayer));
            SafeERC20.safeTransfer(asset, address(relayer), _bridgeData.minAmount);
            if (asset.balanceOf(address(relayer)) - prevBalance != _bridgeData.minAmount) revert InvalidAmount();
        }

        _startBridge(_bridgeData, _cBridgeData);
    }

    /// Private Methods ///

    /// @dev Contains the business logic for the bridge via CBridge
    /// @param _bridgeData the core information needed for bridging
    /// @param _cBridgeData data specific to CBridge
    function _startBridge(ILiFi.BridgeData memory _bridgeData, CBridgeData memory _cBridgeData) private {
        // assuming messageBusFee is pre-calculated off-chain and available in _cBridgeData
        // determine correct native asset amount to be forwarded (if so) and send funds to relayer
        uint256 msgValue = LibAsset.isNativeAsset(_bridgeData.sendingAssetId) ? _bridgeData.minAmount : 0;
        (bytes32 transferId, ) = relayer.sendTokenTransfer{ value: msgValue }(_bridgeData, _cBridgeData);

        // check if transaction contains a destination call
        if (_bridgeData.hasDestinationCall) {
            // call message bus via relayer incl messageBusFee
            relayer.forwardSendMessageWithTransfer{ value: _cBridgeData.messageBusFee }(
                _bridgeData.receiver,
                uint64(_bridgeData.destinationChainId),
                address(cBridge),
                transferId,
                _cBridgeData.callData
            );
        }

        // emit LiFi event
        emit LiFiTransferStarted(_bridgeData);
    }

    function validateDestinationCallFlag(ILiFi.BridgeData memory _bridgeData, CBridgeData memory _cBridgeData)
        private
        pure
    {
        if ((_cBridgeData.callData.length > 0) != _bridgeData.hasDestinationCall) {
            revert InformationMismatch();
        }
    }
}
