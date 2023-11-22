// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.21;

import "../../domain/BosonConstants.sol";
import { BosonErrors } from "../../domain/BosonErrors.sol";
import { IBosonOfferHandler } from "../../interfaces/handlers/IBosonOfferHandler.sol";
import { IBosonExchangeHandler } from "../../interfaces/handlers/IBosonExchangeHandler.sol";
import { IBosonAccountHandler } from "../../interfaces/handlers/IBosonAccountHandler.sol";
import { BosonTypes } from "../../domain/BosonTypes.sol";
import { BeaconClientLib } from "../libs/BeaconClientLib.sol";
import { IClientExternalAddresses } from "../../interfaces/clients/IClientExternalAddresses.sol";

/**
 * @title BeaconClientBase
 *
 * @notice Extended by Boson Protocol contracts that need to communicate with the ProtocolDiamond
 * but are NOT facets of the ProtocolDiamond. This is used where it's expected that multiple clients
 * will use the same implementation. If it's expected that only one client will use it, it's recommended to use `ClientBase` instead
 *
 * Boson client contracts include BosonVoucher
 */
abstract contract BeaconClientBase is BosonTypes, BosonErrors {
    /**
     * @dev Modifier that checks that the caller has a specific role.
     *
     * Reverts if:
     * - Caller doesn't have role
     *
     * See: {AccessController.hasRole}
     *
     * @param _role - the role to check
     */
    modifier onlyRole(bytes32 _role) {
        if (!BeaconClientLib.hasRole(_role)) revert AccessDenied();
        _;
    }

    /**
     * @notice Gets the info about the offer associated with a voucher's exchange
     *
     * @param _exchangeId - the id of the exchange
     * @return exists - the offer was found
     * @return offer - the offer associated with the _exchangeId
     */
    function getBosonOfferByExchangeId(uint256 _exchangeId) internal view returns (bool exists, Offer memory offer) {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();
        (, Exchange memory exchange, ) = IBosonExchangeHandler(protocolDiamond).getExchange(_exchangeId);
        (exists, offer, , , , ) = IBosonOfferHandler(protocolDiamond).getOffer(exchange.offerId);
    }

    /**
     * @notice Gets the info about the offer associated with a voucher's exchange
     *
     * @param _offerId - the offer id
     * @return offer - the offer associated with the _offerId
     * @return offerDates - the offer dates associated with the _offerId
     */
    function getBosonOffer(uint256 _offerId) internal view returns (Offer memory offer, OfferDates memory offerDates) {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();
        (, offer, offerDates, , , ) = IBosonOfferHandler(protocolDiamond).getOffer(_offerId);
    }

    /**
     * @notice Informs protocol of new buyer associated with an exchange
     *
     * @param _tokenId - the voucher id
     * @param _newBuyer - the address of the new buyer
     */
    function onVoucherTransferred(uint256 _tokenId, address payable _newBuyer) internal {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();
        IBosonExchangeHandler(protocolDiamond).onVoucherTransferred(_tokenId, _newBuyer);
    }

    /**
     * @notice Informs protocol of a pre-minted voucher transfer
     *
     * @param _tokenId - the voucher id
     * @param _to - the address of the new buyer
     * @param _from - the address of current owner
     * @param _rangeOwner - the address of the preminted range owner
     */
    function onPremintedVoucherTransferred(
        uint256 _tokenId,
        address payable _to,
        address _from,
        address _rangeOwner
    ) internal returns (bool) {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();
        return IBosonExchangeHandler(protocolDiamond).onPremintedVoucherTransferred(_tokenId, _to, _from, _rangeOwner);
    }

    /**
     * @notice Gets the info about the seller associated with the sellerId.
     *
     * @param _sellerId - the id of the seller
     * @return exists - the seller was found
     * @return seller - the seller associated with the _sellerId
     */
    function getBosonSeller(uint256 _sellerId) internal view returns (bool exists, Seller memory seller) {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();

        (exists, seller, ) = IBosonAccountHandler(protocolDiamond).getSeller(_sellerId);
    }

    /**
     * @notice Gets the info about the seller associated with the address.
     *
     * @param _sellerAddress - the address of the seller
     * @return exists - the seller was found
     * @return seller - the seller associated with the _sellerAddress
     */
    function getBosonSellerByAddress(address _sellerAddress) internal view returns (bool exists, Seller memory seller) {
        address protocolDiamond = IClientExternalAddresses(BeaconClientLib._beacon()).getProtocolAddress();

        (exists, seller, ) = IBosonAccountHandler(protocolDiamond).getSellerByAddress(_sellerAddress);
    }
}
