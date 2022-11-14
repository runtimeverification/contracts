// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

error TokenAddressIsZero();
error TokenNotSupported();
error CannotBridgeToSameNetwork();
error ZeroPostSwapBalance();
error NoSwapDataProvided();
error NativeValueWithERC();
error ContractCallNotAllowed();
error NullAddrIsNotAValidSpender();
error NullAddrIsNotAnERC20Token();
error NoTransferToNullAddress();
error NativeAssetTransferFailed();
error InvalidBridgeConfigLength();
error InvalidAmount();
error InvalidContract();
error InvalidConfig();
error UnsupportedChainId(uint256 chainId);
error InvalidReceiver();
error InvalidDestinationChain();
error InvalidSendingToken();
error InvalidCaller();
error AlreadyInitialized();
error NotInitialized();
error OnlyContractOwner();
error CannotAuthoriseSelf();
error RecoveryAddressCannotBeZero();
error CannotDepositNativeToken();
error InvalidCallData();
error NativeAssetNotSupported();
error UnAuthorized();
error NoSwapFromZeroBalance();
error InvalidFallbackAddress();
error CumulativeSlippageTooHigh(uint256 minAmount, uint256 receivedAmount);
error InsufficientBalance(uint256 required, uint256 balance);
error ZeroAmount();
error InvalidFee();
error InformationMismatch();
error NotAContract();
error NotEnoughBalance(uint256 requested, uint256 available);
error InsufficientMessageValue();
