// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { ITransactionManager } from "../Interfaces/ITransactionManager.sol";
import { ILiFi } from "../Interfaces/ILiFi.sol";
import { LibAsset, IERC20 } from "../Libraries/LibAsset.sol";
import { ReentrancyGuard } from "../Helpers/ReentrancyGuard.sol";
import { LibUtil } from "../Libraries/LibUtil.sol";
import { SwapperV2, LibSwap } from "../Helpers/SwapperV2.sol";
import { InvalidReceiver, InvalidFallbackAddress } from "../Errors/GenericErrors.sol";

/// @title NXTP (Connext) Facet
/// @author LI.FI (https://li.fi)
/// @notice Provides functionality for bridging through NXTP (Connext)
contract NXTPFacet is ILiFi, ReentrancyGuard, SwapperV2 {
    /// Types ///
    struct NXTPData {
        address nxtpTxManager;
        ITransactionManager.InvariantTransactionData invariantData;
        uint256 amount;
        uint256 expiry;
        bytes encryptedCallData;
        bytes encodedBid;
        bytes bidSignature;
        bytes encodedMeta;
    }

    /// External Methods ///

    /// @notice This function starts a cross-chain transaction using the NXTP protocol
    /// @param _lifiData data used purely for tracking and analytics
    /// @param _nxtpData data needed to complete an NXTP cross-chain transaction
    function startBridgeTokensViaNXTP(LiFiData calldata _lifiData, NXTPData calldata _nxtpData)
        external
        payable
        nonReentrant
    {
        LibAsset.depositAsset(_nxtpData.invariantData.sendingAssetId, _nxtpData.amount);
        _startBridge(_lifiData, _nxtpData, true);
    }

    /// @notice This function performs a swap or multiple swaps and then starts a cross-chain transaction
    ///         using the NXTP protocol.
    /// @param _lifiData data used purely for tracking and analytics
    /// @param _swapData array of data needed for swaps
    /// @param _nxtpData data needed to complete an NXTP cross-chain transaction
    function swapAndStartBridgeTokensViaNXTP(
        LiFiData calldata _lifiData,
        LibSwap.SwapData[] calldata _swapData,
        NXTPData memory _nxtpData
    ) external payable nonReentrant {
        _nxtpData.amount = _executeAndCheckSwaps(_lifiData, _swapData, payable(msg.sender));

        _startBridge(_lifiData, _nxtpData, true);
    }

    /// Private Methods ///

    /// @dev Contains the business logic for the bridge via NXTP
    /// @param _lifiData data used purely for tracking and analytics
    /// @param _nxtpData data specific to NXTP
    /// @param _hasSourceSwaps whether or not the bridge has source swaps
    function _startBridge(
        LiFiData calldata _lifiData,
        NXTPData memory _nxtpData,
        bool _hasSourceSwaps
    ) private {
        ITransactionManager txManager = ITransactionManager(_nxtpData.nxtpTxManager);
        IERC20 sendingAssetId = IERC20(_nxtpData.invariantData.sendingAssetId);
        // Give Connext approval to bridge tokens
        LibAsset.maxApproveERC20(IERC20(sendingAssetId), _nxtpData.nxtpTxManager, _nxtpData.amount);

        {
            address sendingChainFallback = _nxtpData.invariantData.sendingChainFallback;
            address receivingAddress = _nxtpData.invariantData.receivingAddress;

            if (LibUtil.isZeroAddress(sendingChainFallback)) {
                revert InvalidFallbackAddress();
            }
            if (LibUtil.isZeroAddress(receivingAddress)) {
                revert InvalidReceiver();
            }
        }

        // Initiate bridge transaction on sending chain
        txManager.prepare{ value: LibAsset.isNativeAsset(address(sendingAssetId)) ? _nxtpData.amount : 0 }(
            ITransactionManager.PrepareArgs(
                _nxtpData.invariantData,
                _nxtpData.amount,
                _nxtpData.expiry,
                _nxtpData.encryptedCallData,
                _nxtpData.encodedBid,
                _nxtpData.bidSignature,
                _nxtpData.encodedMeta
            )
        );

        emit LiFiTransferStarted(
            _lifiData.transactionId,
            "nxtp",
            "",
            _lifiData.integrator,
            _lifiData.referrer,
            _nxtpData.invariantData.sendingAssetId,
            _lifiData.receivingAssetId,
            _nxtpData.invariantData.receivingAddress,
            _nxtpData.amount,
            _nxtpData.invariantData.receivingChainId,
            _hasSourceSwaps,
            !LibUtil.isZeroAddress(_nxtpData.invariantData.callTo)
        );
    }
}
