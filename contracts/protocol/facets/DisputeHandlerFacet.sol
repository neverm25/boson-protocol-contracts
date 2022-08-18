// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "../../domain/BosonConstants.sol";
import { IBosonDisputeHandler } from "../../interfaces/handlers/IBosonDisputeHandler.sol";
import { DiamondLib } from "../../diamond/DiamondLib.sol";
import { ProtocolBase } from "../bases/ProtocolBase.sol";
import { DisputeBase } from "../bases/DisputeBase.sol";
import { FundsLib } from "../libs/FundsLib.sol";
import { EIP712Lib } from "../libs/EIP712Lib.sol";

/**
 * @title DisputeHandlerFacet
 *
 * @notice Handles disputes associated with exchanges within the protocol
 */
contract DisputeHandlerFacet is DisputeBase, IBosonDisputeHandler {
    bytes32 private constant RESOLUTION_TYPEHASH =
        keccak256(bytes("Resolution(uint256 exchangeId,uint256 buyerPercent)")); // needed for verification during the resolveDispute

    /**
     * @notice Facet Initializer
     */
    function initialize() public onlyUnInitialized(type(IBosonDisputeHandler).interfaceId) {
        DiamondLib.addSupportedInterface(type(IBosonDisputeHandler).interfaceId);
    }

    /**
     * @notice Raise a dispute
     *
     * Emits a DisputeRaised event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - caller does not hold a voucher for the given exchange id
     * - exchange does not exist
     * - exchange is not in a redeemed state
     * - fulfillment period has elapsed already
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function raiseDispute(uint256 _exchangeId) external override disputesNotPaused nonReentrant {
        // Get the exchange, should be in redeemed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Redeemed);
        // Get the offer, which will exist if the exchange does
        (, Offer storage offer) = fetchOffer(exchange.offerId);

        raiseDisputeInternal(exchange, offer.sellerId);
    }

    /**
     * @notice Retract the dispute and release the funds
     *
     * Emits a DisputeRetracted event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - caller is not the buyer for the given exchange id
     * - dispute is in some state other than resolving or escalated
     * - dispute was escalated and escalation period has elapsed
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function retractDispute(uint256 _exchangeId) external override disputesNotPaused nonReentrant {
        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Make sure the caller is buyer associated with the exchange  // {MR: only by game}
        checkBuyer(exchange.buyerId);

        // Fetch the dispute
        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // If dispute was escalated, make sure that escalation period is not over yet
        if (dispute.state == DisputeState.Escalated) {
            // make sure the dispute escalation period not expired already
            require(block.timestamp <= disputeDates.timeout, DISPUTE_HAS_EXPIRED);
        } else {
            // If dispute is not escalated, make sure the it is in the resolving state
            require(dispute.state == DisputeState.Resolving, INVALID_STATE);
        }

        // Finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Retracted, 0);

        // Notify watchers of state change
        emit DisputeRetracted(_exchangeId, msgSender());
    }

    /**
     * @notice Extend the dispute timeout, allowing more time for mutual resolution.
     * As a consequnece also buyer gets more time to escalate the dispute
     *
     * Emits a DisputeTimeoutExtened event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - caller is not the seller
     * - dispute has expired already
     * - new dispute timeout is before the current dispute timeout
     * - dispute is in some state other than resolving
     *
     * @param _exchangeId - the id of the associated exchange
     * @param _newDisputeTimeout - new date when resolution period ends
     */
    function extendDisputeTimeout(uint256 _exchangeId, uint256 _newDisputeTimeout)
        external
        override
        disputesNotPaused
        nonReentrant
    {
        // Verify that the caller is the seller. Get exchange -> get offer id -> get seller id -> get operator address and compare to msg.sender
        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Get the offer, assume it exist if exchange exist
        (, Offer storage offer) = fetchOffer(exchange.offerId);

        // Get seller, we assume seller exists if offer exists
        (, Seller storage seller, ) = fetchSeller(offer.sellerId);

        // Caller must be seller's operator address
        require(seller.operator == msgSender(), NOT_OPERATOR);

        // Fetch the dispute, it exists if exchange is in Disputed state
        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // Dispute must be in a resolving state
        require(dispute.state == DisputeState.Resolving, INVALID_STATE);

        // If expired already, it cannot be extended
        require(block.timestamp <= disputeDates.timeout, DISPUTE_HAS_EXPIRED);

        // New dispute timout should be after the current dispute timeout
        require(_newDisputeTimeout > disputeDates.timeout, INVALID_DISPUTE_TIMEOUT);

        // Update the timeout
        disputeDates.timeout = _newDisputeTimeout;

        // Notify watchers of state change
        emit DisputeTimeoutExtended(_exchangeId, _newDisputeTimeout, msgSender());
    }

    /**
     * @notice Expire the dispute and release the funds
     *
     * Emits a DisputeExpired event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - dispute is still valid
     * - dispute is in some state other than resolving
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function expireDispute(uint256 _exchangeId) public override disputesNotPaused nonReentrant {
        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Fetch the dispute and dispute dates
        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // Make sure the dispute is in the resolving state
        require(dispute.state == DisputeState.Resolving, INVALID_STATE);

        // make sure the dispute not expired already
        require(block.timestamp > disputeDates.timeout, DISPUTE_STILL_VALID);

        // Finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Retracted, 0);

        // Notify watchers of state change
        emit DisputeExpired(_exchangeId, msgSender());
    }

    /**
     * @notice Expire a batch of disputes and release the funds
     *
     * Emits a DisputeExpired event for every dispute if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - Number of disputes exceeds maximum allowed number per batch
     * - for any dispute:
     *   - exchange does not exist
     *   - exchange is not in a disputed state
     *   - dispute is still valid
     *   - dispute is in some state other than resolving
     *
     * @param _exchangeIds - the array of ids of the associated exchanges
     */
    function expireDisputeBatch(uint256[] calldata _exchangeIds) external override disputesNotPaused {
        // limit maximum number of disputes to avoid running into block gas limit in a loop
        require(_exchangeIds.length <= protocolLimits().maxDisputesPerBatch, TOO_MANY_DISPUTES);

        for (uint256 i = 0; i < _exchangeIds.length; i++) {
            // create offer and update structs values to represent true state
            expireDispute(_exchangeIds[i]);
        }
    }

    /**
     * @notice Resolve a dispute by providing the information about the split. Callable by the buyer or seller, but they must provide the resolution signed by the other party
     *
     * Emits a DisputeResolved event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - specified buyer percent exceeds 100%
     * - dispute has expired (resolution period has ended and dispute was not escalated)
     * - exchange does not exist
     * - exchange is not in the disputed state
     * - caller is neither the seller nor the buyer
     * - signature does not belong to the address of the other party
     * - dispute state is neither resolving nor escalated
     * - dispute was escalated and escalation period has elapsed
     *
     * @param _exchangeId  - exchange id to resolve dispute
     * @param _buyerPercent - percentage of the pot that goes to the buyer
     * @param _sigR - r part of the signer's signature.
     * @param _sigS - s part of the signer's signature.
     * @param _sigV - v part of the signer's signature.
     */
    function resolveDispute(
        uint256 _exchangeId,
        uint256 _buyerPercent,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external override disputesNotPaused nonReentrant {
        // buyer should get at most 100%
        require(_buyerPercent <= 10000, INVALID_BUYER_PERCENT);

        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);
        // Fetch teh dispute and dispute dates

        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // Make sure the dispute is in the resolving or escalated state
        require(dispute.state == DisputeState.Resolving || dispute.state == DisputeState.Escalated, INVALID_STATE);

        // Make sure the dispute not expired already
        require(block.timestamp <= disputeDates.timeout, DISPUTE_HAS_EXPIRED);

        // wrap the code in a separate block to avoid stack too deep error
        {
            // Fetch the offer to get the info who the seller is
            (, Offer storage offer) = fetchOffer(exchange.offerId);

            // get seller id to check if caller is the seller
            (bool exists, uint256 sellerId) = getSellerIdByOperator(msgSender());

            // variable to store who the expected signer is
            address expectedSigner;

            // find out if the caller is the seller or the buyer, and which address should be the signer
            if (exists && offer.sellerId == sellerId) {
                // caller is the seller
                // get the buyer's address, which should be the signer of the resolution
                (, Buyer storage buyer) = fetchBuyer(exchange.buyerId);
                expectedSigner = buyer.wallet;
            } else {
                uint256 buyerId;
                (exists, buyerId) = getBuyerIdByWallet(msgSender());
                require(exists && buyerId == exchange.buyerId, NOT_BUYER_OR_SELLER);

                // caller is the buyer
                // get the seller's address, which should be the signer of the resolution
                (, Seller storage seller, ) = fetchSeller(offer.sellerId);
                expectedSigner = seller.operator;
            }

            // verify that the signature belongs to the expectedSigner
            require(
                EIP712Lib.verify(expectedSigner, hashResolution(_exchangeId, _buyerPercent), _sigR, _sigS, _sigV),
                SIGNER_AND_SIGNATURE_DO_NOT_MATCH
            );
        }

        // finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Resolved, _buyerPercent);

        // Notify watchers of state change
        emit DisputeResolved(_exchangeId, _buyerPercent, msgSender());
    }

    /**
     * @notice Puts the dispute into escalated state
     *
     * Emits a DisputeEscalated event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - caller is not the buyer
     * - dispute is already expired
     * - dispute is not in a resolving state
     * - dispute resolver is not specified (absolute zero offer)
     * - offer price is in native token and buyer caller does not send enough
     * - offer price is in some ERC20 token and caller also send native currency
     * - if contract at token address does not support erc20 function transferFrom
     * - if calling transferFrom on token fails for some reason (e.g. protocol is not approved to transfer)
     * - received ERC20 token amount differs from the expected value
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function escalateDispute(uint256 _exchangeId) external payable override disputesNotPaused nonReentrant {
        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Make sure the caller is buyer associated with the exchange
        checkBuyer(exchange.buyerId);

        // Fetch the dispute and dispute dates
        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // make sure the dispute not expired already
        require(block.timestamp <= disputeDates.timeout, DISPUTE_HAS_EXPIRED);

        // Make sure the dispute is in the resolving state
        require(dispute.state == DisputeState.Resolving, INVALID_STATE);

        // Fetch the dispute resolution terms from the storage
        DisputeResolutionTerms storage disputeResolutionTerms = fetchDisputeResolutionTerms(exchange.offerId);

        // absolute zero offers can be without DR. In that case we prevent escalation
        require(disputeResolutionTerms.disputeResolverId > 0, ESCALATION_NOT_ALLOWED);

        // fetch offer to get info about dispute resolver id
        (, Offer storage offer) = fetchOffer(exchange.offerId);

        // make sure buyer sent enough funds to proceed
        FundsLib.validateIncomingPayment(offer.exchangeToken, disputeResolutionTerms.buyerEscalationDeposit);

        // fetch the escalation period from the storage
        uint256 escalationResponsePeriod = disputeResolutionTerms.escalationResponsePeriod;

        // store the time of escalation
        disputeDates.escalated = block.timestamp;
        disputeDates.timeout = block.timestamp + escalationResponsePeriod;

        // Set the dispute state
        dispute.state = DisputeState.Escalated;

        // Notify watchers of state change
        emit DisputeEscalated(_exchangeId, disputeResolutionTerms.disputeResolverId, msgSender());
    }

    /**
     * @notice Decide a dispute by providing the information about the split. Callable by the dispute resolver, specified in the offer
     *
     * Emits a DisputeDecided event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - specified buyer percent exceeds 100%
     * - exchange does not exist
     * - exchange is not in the disputed state
     * - caller is not the dispute resolver for this dispute
     * - dispute state is not escalated
     * - dispute escalation response period has elapsed
     *
     * @param _exchangeId  - exchange id to resolve dispute
     * @param _buyerPercent - percentage of the pot that goes to the buyer
     */
    function decideDispute(uint256 _exchangeId, uint256 _buyerPercent)
        external
        override
        disputesNotPaused
        nonReentrant
    {
        // buyer should get at most 100%
        require(_buyerPercent <= 10000, INVALID_BUYER_PERCENT);

        // Make sure the dispute is valid and the caller is the dispute resolver
        (Exchange storage exchange, Dispute storage dispute, DisputeDates storage disputeDates) = disputeResolverChecks(
            _exchangeId
        );

        // finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Decided, _buyerPercent);

        // Notify watchers of state change
        emit DisputeDecided(_exchangeId, _buyerPercent, msgSender());
    }

    /**
     * @notice Explicity refuse to resolve a dispute in escalated state and release the funds
     *
     * Emits a EscalatedDisputeRefused event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - dispute is in some state other than escalated
     * - dispute escalation response period has elapsed
     * - caller is not the dispute resolver for this dispute
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function refuseEscalatedDispute(uint256 _exchangeId) external override disputesNotPaused nonReentrant {
        // Make sure the dispute is valid and the caller is the dispute resolver
        (Exchange storage exchange, Dispute storage dispute, DisputeDates storage disputeDates) = disputeResolverChecks(
            _exchangeId
        );

        // Finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Refused, 0);

        // Notify watchers of state change
        emit EscalatedDisputeRefused(_exchangeId, msgSender());
    }

    /**
     * @notice Expire the dispute in escalated state and release the funds
     *
     * Emits a EscalatedDisputeExpired event if successful.
     *
     * Reverts if:
     * - The disputes region of protocol is paused
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - dispute is in some state other than escalated
     * - dispute escalation period has not passed yet
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function expireEscalatedDispute(uint256 _exchangeId) external override disputesNotPaused nonReentrant {
        // Get the exchange, should be in disputed state
        Exchange storage exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Fetch the dispute and dispute dates
        (, Dispute storage dispute, DisputeDates storage disputeDates) = fetchDispute(_exchangeId);

        // Make sure the dispute is in the escalated state
        require(dispute.state == DisputeState.Escalated, INVALID_STATE);

        // make sure the dispute escalation has expired already
        require(block.timestamp > disputeDates.timeout, DISPUTE_STILL_VALID);

        // Finalize the dispute
        finalizeDispute(_exchangeId, exchange, dispute, disputeDates, DisputeState.Refused, 0);

        // Notify watchers of state change
        emit EscalatedDisputeExpired(_exchangeId, msgSender());
    }

    /**
     * @notice Transition dispute to a "finalized" state
     *
     * Target state must be Retracted, Resolved, or Decided.
     * Sets finalized date for exchange and dispute, store the resolution if exists and releases the funds
     *
     * Reverts if the current dispute state is not resolving or escalated.
     *
     * @param _exchangeId  - exchange id to resolve dispute
     * @param _exchange - pointer to exchange storage slot
     * @param _dispute - pointer to dispute storage slot
     * @param _disputeDates - pointer to disputeDates storage slot
     * @param _targetState - target final state
     * @param _buyerPercent - percentage of the pot that goes to the buyer
     */
    function finalizeDispute(
        uint256 _exchangeId,
        Exchange storage _exchange,
        Dispute storage _dispute,
        DisputeDates storage _disputeDates,
        DisputeState _targetState,
        uint256 _buyerPercent
    ) internal {
        // update dispute and exchange
        _disputeDates.finalized = block.timestamp;
        _dispute.state = _targetState;
        _exchange.finalizedDate = block.timestamp;

        // store the resolution if it exists
        if (_targetState == DisputeState.Resolved || _targetState == DisputeState.Decided) {
            _dispute.buyerPercent = _buyerPercent;
        }

        // Release the funds
        FundsLib.releaseFunds(_exchangeId);
    }

    /**
     * @notice Gets the details about a given dispute.
     *
     * @param _exchangeId - the id of the exchange to check
     * @return exists - true if the dispute exists
     * @return dispute - the dispute details. See {BosonTypes.Dispute}
     * @return disputeDates - the dispute dates details {BosonTypes.DisputeDates}
     */
    function getDispute(uint256 _exchangeId)
        external
        view
        override
        returns (
            bool exists,
            Dispute memory dispute,
            DisputeDates memory disputeDates
        )
    {
        return fetchDispute(_exchangeId);
    }

    /**
     * @notice Gets the state of a given dispute.
     *
     * @param _exchangeId - the id of the exchange to check
     * @return exists - true if the dispute exists
     * @return state - the dispute state. See {BosonTypes.DisputeState}
     */
    function getDisputeState(uint256 _exchangeId) external view override returns (bool exists, DisputeState state) {
        Dispute storage dispute;
        (exists, dispute, ) = fetchDispute(_exchangeId);
        if (exists) state = dispute.state;
    }

    /**
     * @notice Gets the timeout of a given dispute.
     *
     * @param _exchangeId - the id of the exchange to check
     * @return exists - true if the dispute exists
     * @return timeout - the end of resolution period
     */
    function getDisputeTimeout(uint256 _exchangeId) external view override returns (bool exists, uint256 timeout) {
        DisputeDates storage disputeDates;
        (exists, , disputeDates) = fetchDispute(_exchangeId);
        if (exists) timeout = disputeDates.timeout;
    }

    /**
     * @notice Is the given dispute in a finalized state?
     *
     * Returns true if
     * - Dispute state is Retracted, Resolved, Decided or Refused
     *
     * @param _exchangeId - the id of the exchange to check
     * @return exists - true if the dispute exists
     * @return isFinalized - true if the dispute is finalized
     */
    function isDisputeFinalized(uint256 _exchangeId) external view override returns (bool exists, bool isFinalized) {
        Dispute storage dispute;

        // Get the dispute
        (exists, dispute, ) = fetchDispute(_exchangeId);

        // if exists, set isFinalized to true if state is a valid finalized state
        if (exists) {
            // Check for finalized dispute state
            isFinalized = (dispute.state == DisputeState.Retracted ||
                dispute.state == DisputeState.Resolved ||
                dispute.state == DisputeState.Decided ||
                dispute.state == DisputeState.Refused);
        }
    }

    /**
     * @notice Validates that exchange and dispute are in the correct state and that the caller is the dispute resolver for this dispute
     *
     * Reverts if:
     * - exchange does not exist
     * - exchange is not in a disputed state
     * - dispute is in some state other than escalated
     * - dispute escalation response period has elapsed
     * - caller is not the dispute resolver for this dispute
     *
     * @param _exchangeId - the id of the associated exchange
     */
    function disputeResolverChecks(uint256 _exchangeId)
        internal
        view
        returns (
            Exchange storage exchange,
            Dispute storage dispute,
            DisputeDates storage disputeDates
        )
    {
        // Get the exchange, should be in disputed state
        exchange = getValidExchange(_exchangeId, ExchangeState.Disputed);

        // Fetch the dispute and dispute dates
        (, dispute, disputeDates) = fetchDispute(_exchangeId);

        // Make sure the dispute is in the escalated state
        require(dispute.state == DisputeState.Escalated, INVALID_STATE);

        // Make sure the dispute escalation period not expired already
        require(block.timestamp <= disputeDates.timeout, DISPUTE_HAS_EXPIRED);

        // Fetch the offer to get the info who the seller is
        (, Offer storage offer) = fetchOffer(exchange.offerId);

        // get dispute resolver id to check if caller is the dispute resolver
        uint256 disputeResolverId = protocolLookups().disputeResolverIdByOperator[msgSender()];
        require(
            disputeResolverId == fetchDisputeResolutionTerms(offer.id).disputeResolverId,
            NOT_DISPUTE_RESOLVER_OPERATOR
        );
    }

    /**
     * @notice Returns hashed resolution information. Needed for the verfication in resolveDispute.
     *
     * @param _exchangeId - if of the exchange for which dispute was resolved
     * @param _buyerPercent - percentage of the pot that goes to the buyer
     */
    function hashResolution(uint256 _exchangeId, uint256 _buyerPercent) internal pure returns (bytes32) {
        return keccak256(abi.encode(RESOLUTION_TYPEHASH, _exchangeId, _buyerPercent));
    }
}
