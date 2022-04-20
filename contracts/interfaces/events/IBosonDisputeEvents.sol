// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import {BosonTypes} from "../../domain/BosonTypes.sol";

/**
 * @title IBosonDisputeEvents
 *
 * @notice Events related to disputes within the protocol.
 */
interface IBosonDisputeEvents {
    event DisputeRaised(uint256 indexed exchangeId, uint256 indexed buyerId, uint256 indexed sellerId, string complaint);
}