// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import {BosonTypes} from "../../domain/BosonTypes.sol";
import {IBosonMetaTransactionsEvents} from "../events/IBosonMetaTransactionsEvents.sol";

/**
 * @title IBosonMetaTransactionsHandler
 *
 * @notice Manages incoming meta-transactions in the protocol.
 *
 * The ERC-165 identifier for this interface is: 0xc387cb03
 */
interface IBosonMetaTransactionsHandler is IBosonMetaTransactionsEvents {

    /**
     * @notice Checks nonce and returns true if used already.
     *
     * @param _nonce - the nonce that we want to check.
     */
    function isUsedNonce(uint256 _nonce) external view returns(bool);

    /**
     * @notice Handles the general form of incoming meta transaction.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - function signature matches to executeMetaTransaction.
     * - function name does not match with bytes 4 version of the function signature.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _functionName - the function name that we want to execute.
     * @param _functionSignature - the function signature.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTransaction(
        address _userAddress,
        string memory _functionName,
        bytes memory _functionSignature,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external payable returns (bytes memory);

    /**
     * @notice Handles the incoming meta transaction for commit to offer.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _offerDetails - the fully populated BosonTypes.MetaTxOfferDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxCommitToOffer(
        address _userAddress,
        BosonTypes.MetaTxOfferDetails calldata _offerDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external payable returns (bytes memory);

    /**
     * @notice Handles the incoming meta transaction for cancel Voucher.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _exchangeDetails - the fully populated BosonTypes.MetaTxExchangeDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxCancelVoucher(
        address _userAddress,
        BosonTypes.MetaTxExchangeDetails calldata _exchangeDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external returns (bytes memory);

    /**
     * @notice Handles the incoming meta transaction for Redeem Voucher.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _exchangeDetails - the fully populated BosonTypes.MetaTxExchangeDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxRedeemVoucher(
        address _userAddress,
        BosonTypes.MetaTxExchangeDetails calldata _exchangeDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external returns (bytes memory);

    /**
     * @notice Handles the incoming meta transaction for Complete Exchange.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _exchangeDetails - the fully populated BosonTypes.MetaTxExchangeDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxCompleteExchange(
        address _userAddress,
        BosonTypes.MetaTxExchangeDetails calldata _exchangeDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external returns (bytes memory);

    /**
     * @notice Handles the incoming meta transaction for Withdraw Funds.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _fundDetails - the fully populated BosonTypes.MetaTxFundDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxWithdrawFunds(
        address _userAddress,
        BosonTypes.MetaTxFundDetails calldata _fundDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external returns (bytes memory);


    /**
     * @notice Handles the incoming meta transaction for Retract Dispute.
     *
     * Reverts if:
     * - nonce is already used by another transaction.
     * - sender does not match the recovered signer.
     * - any code executed in the signed transaction reverts.
     *
     * @param _userAddress - the sender of the transaction.
     * @param _exchangeDetails - the fully populated BosonTypes.MetaTxExchangeDetails struct.
     * @param _nonce - the nonce value of the transaction.
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function executeMetaTxRetractDispute(
        address _userAddress,
        BosonTypes.MetaTxExchangeDetails calldata _exchangeDetails,
        uint256 _nonce,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external returns (bytes memory);
}
