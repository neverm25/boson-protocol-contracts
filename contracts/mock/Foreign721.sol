// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

/**
 * @title Foreign721
 *
 * @notice Mock ERC-(721/2981) NFT for Unit Testing
 */
contract Foreign721 is ERC721Upgradeable {
    string public constant TOKEN_NAME = "Foreign721";
    string public constant TOKEN_SYMBOL = "721Test";

    /**
     * Mint a Sample NFT
     * @param _tokenId - the first token ID to mint
     * @param _supply - the number of tokens to mint
     */
    function mint(uint256 _tokenId, uint256 _supply) public {
        for (uint256 index = 0; index < _supply; index++) {
            _mint(msg.sender, _tokenId);
            _tokenId++;
        }
    }

    /**
     * Deletes the contract code
     */
    function destruct() public {
        selfdestruct(payable(msg.sender));
    }
}

/*
 * @title Foreign721 that consumes all gas when transfer is called
 *
 * @notice Mock ERC-(721) for Unit Testing
 */
contract Foreign721GasTheft is Foreign721 {
    function safeTransferFrom(address, address, uint256, bytes memory) public virtual override {
        while (true) {
            // consume all gas
        }
    }
}

/*
 * @title Foreign721 that succeeds, but the data cannot be decoded into a boolean
 *
 * @notice Mock ERC-(721) for Unit Testing
 */
contract Foreign721MalformedReturn is Foreign721 {
    enum AttackType {
        ReturnTooShort,
        ReturnTooLong,
        ReturnInvalid
    }

    AttackType public attackType;

    function setAttackType(AttackType _attackType) external {
        attackType = _attackType;
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public virtual override {
        if (attackType == AttackType.ReturnTooShort) {
            assembly {
                return(0, 31) // return too short data
            }
        } else if (attackType == AttackType.ReturnTooLong) {
            assembly {
                return(0, 33) // return too long data
            }
        } else if (attackType == AttackType.ReturnInvalid) {
            assembly {
                return(0x40, 32) // return a value that is not 0 or 1
            }
        }
    }
}
