// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.9;

import { BosonTypes } from "../../domain/BosonTypes.sol";
import { IBosonOfferEvents } from "../events/IBosonOfferEvents.sol";

/**
 * @title IBosonOfferHandler
 *
 * @notice Handles creation, voiding, and querying of offers within the protocol.
 *
 * The ERC-165 identifier for this interface is: 0xdd282b34
 */
interface IBosonOfferHandler is IBosonOfferEvents {
    /**
     * @notice Creates an offer.
     *
     * Emits an OfferCreated event if successful.
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - Caller is not an operator
     * - Valid from date is greater than valid until date
     * - Valid until date is not in the future
     * - Both voucher expiration date and voucher expiration period are defined
     * - Neither of voucher expiration date and voucher expiration period are defined
     * - Voucher redeemable period is fixed, but it ends before it starts
     * - Voucher redeemable period is fixed, but it ends before offer expires
     * - Dispute period is less than minimum dispute period
     * - Resolution period is set to zero or above the maximum resolution period
     * - Voided is set to true
     * - Available quantity is set to zero
     * - Dispute resolver wallet is not registered, except for absolute zero offers with unspecified dispute resolver
     * - Dispute resolver is not active, except for absolute zero offers with unspecified dispute resolver
     * - Seller is not on dispute resolver's seller allow list
     * - Dispute resolver does not accept fees in the exchange token
     * - Buyer cancel penalty is greater than price
     * - When agent id is non zero:
     *   - If Agent does not exist
     *   - If the sum of agent fee amount and protocol fee amount is greater than the offer fee limit
     *
     * @param _offer - the fully populated struct with offer id set to 0x0 and voided set to false
     * @param _offerDates - the fully populated offer dates struct
     * @param _offerDurations - the fully populated offer durations struct
     * @param _disputeResolverId - the id of chosen dispute resolver (can be 0)
     * @param _agentId - the id of agent
     */
    function createOffer(
        BosonTypes.Offer memory _offer,
        BosonTypes.OfferDates calldata _offerDates,
        BosonTypes.OfferDurations calldata _offerDurations,
        uint256 _disputeResolverId,
        uint256 _agentId
    ) external;

    /**
     * @notice Creates a batch of offers.
     *
     * Emits an OfferCreated event for every offer if successful.
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - Number of offers exceeds maximum allowed number per batch
     * - Number of elements in offers, offerDates and offerDurations do not match
     * - For any offer:
     *   - Caller is not an operator
     *   - Valid from date is greater than valid until date
     *   - Valid until date is not in the future
     *   - Both voucher expiration date and voucher expiration period are defined
     *   - Neither of voucher expiration date and voucher expiration period are defined
     *   - Voucher redeemable period is fixed, but it ends before it starts
     *   - Voucher redeemable period is fixed, but it ends before offer expires
     *   - Dispute period is less than minimum dispute period
     *   - Resolution period is set to zero or above the maximum resolution period
     *   - Voided is set to true
     *   - Available quantity is set to zero
     *   - Dispute resolver wallet is not registered, except for absolute zero offers with unspecified dispute resolver
     *   - Dispute resolver is not active, except for absolute zero offers with unspecified dispute resolver
     *   - Seller is not on dispute resolver's seller allow list
     *   - Dispute resolver does not accept fees in the exchange token
     *   - Buyer cancel penalty is greater than price
     * - When agent ids are non zero:
     *   - If Agent does not exist
     *   - If the sum of agent fee amount and protocol fee amount is greater than the offer fee limit
     *
     * @param _offers - the array of fully populated Offer structs with offer id set to 0x0 and voided set to false
     * @param _offerDates - the array of fully populated offer dates structs
     * @param _offerDurations - the array of fully populated offer durations structs
     * @param _disputeResolverIds - the array of ids of chosen dispute resolvers (can be 0)
     * @param _agentIds - the array of ids of agents
     */
    function createOfferBatch(
        BosonTypes.Offer[] calldata _offers,
        BosonTypes.OfferDates[] calldata _offerDates,
        BosonTypes.OfferDurations[] calldata _offerDurations,
        uint256[] calldata _disputeResolverIds,
        uint256[] calldata _agentIds
    ) external;

    /**
     * @notice Reserves a range of vouchers to be associated with an offer
     *
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - The exchanges region of protocol is paused
     * - Offer does not exist
     * - Offer already voided
     * - Caller is not the seller
     * - Range length is zero
     * - Range length is greater than quantity available
     * - Range length is greater than maximum allowed range length
     * - Call to BosonVoucher.reserveRange() reverts
     *
     * @param _offerId - the id of the offer
     * @param _length - the length of the range
     */
    function reserveRange(uint256 _offerId, uint256 _length) external;

    /**
     * @notice Voids a given offer.
     * Existing exchanges are not affected.
     * No further vouchers can be issued against a voided offer.
     *
     * Emits an OfferVoided event if successful.
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - Offer id is invalid
     * - Caller is not the operator of the offer
     * - Offer has already been voided
     *
     * @param _offerId - the id of the offer to void
     */
    function voidOffer(uint256 _offerId) external;

    /**
     * @notice  Voids a batch of offers.
     * Existing exchanges are not affected.
     * No further vouchers can be issued against a voided offer.
     *
     * Emits an OfferVoided event for every offer if successful.
     *
     * Reverts if, for any offer:
     * - The offers region of protocol is paused
     * - Number of offers exceeds maximum allowed number per batch
     * - Offer id is invalid
     * - Caller is not the operator of the offer
     * - Offer has already been voided
     *
     * @param _offerIds - list of ids of offers to void
     */
    function voidOfferBatch(uint256[] calldata _offerIds) external;

    /**
     * @notice Sets new valid until date.
     *
     * Emits an OfferExtended event if successful.
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - Offer does not exist
     * - Caller is not the operator of the offer
     * - New valid until date is before existing valid until dates
     * - Offer has voucherRedeemableUntil set and new valid until date is greater than that
     *
     *  @param _offerId - the id of the offer to extend
     *  @param _validUntilDate - new valid until date
     */
    function extendOffer(uint256 _offerId, uint256 _validUntilDate) external;

    /**
     * @notice Sets new valid until date for a batch of offers.
     *
     * Emits an OfferExtended event for every offer if successful.
     *
     * Reverts if:
     * - The offers region of protocol is paused
     * - Number of offers exceeds maximum allowed number per batch
     * - For any of the offers:
     *   - Offer does not exist
     *   - Caller is not the operator of the offer
     *   - New valid until date is before existing valid until dates
     *   - Offer has voucherRedeemableUntil set and new valid until date is greater than that
     *
     *  @param _offerIds - list of ids of the offers to extend
     *  @param _validUntilDate - new valid until date
     */
    function extendOfferBatch(uint256[] calldata _offerIds, uint256 _validUntilDate) external;

    /**
     * @notice Gets the details about a given offer.
     *
     * @param _offerId - the id of the offer to retrieve
     * @return exists - the offer was found
     * @return offer - the offer details. See {BosonTypes.Offer}
     * @return offerDates - the offer dates details. See {BosonTypes.OfferDates}
     * @return offerDurations - the offer durations details. See {BosonTypes.OfferDurations}
     * @return disputeResolutionTerms - the details about the dispute resolution terms. See {BosonTypes.DisputeResolutionTerms}
     * @return offerFees - the offer fees details. See {BosonTypes.OfferFees}
     */
    function getOffer(uint256 _offerId)
        external
        view
        returns (
            bool exists,
            BosonTypes.Offer memory offer,
            BosonTypes.OfferDates memory offerDates,
            BosonTypes.OfferDurations memory offerDurations,
            BosonTypes.DisputeResolutionTerms memory disputeResolutionTerms,
            BosonTypes.OfferFees memory offerFees
        );

    /**
     * @notice Gets the next offer id.
     *
     * @dev Does not increment the counter.
     *
     * @return nextOfferId - the next offer id
     */
    function getNextOfferId() external view returns (uint256 nextOfferId);

    /**
     * @notice Checks if offer is voided or not.
     *
     * @param _offerId - the id of the offer to check
     * @return exists - the offer was found
     * @return offerVoided - true if voided, false otherwise
     */
    function isOfferVoided(uint256 _offerId) external view returns (bool exists, bool offerVoided);

    /**
     * @notice Gets the agent id for a given offer id.
     *
     * @param _offerId - the offer id
     * @return exists - whether the agent id exists
     * @return agentId - the agent id
     */
    function getAgentIdByOffer(uint256 _offerId) external view returns (bool exists, uint256 agentId);
}
