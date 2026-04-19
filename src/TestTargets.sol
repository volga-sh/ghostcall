// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract AbiReturner {
    function getValue() external pure returns (uint256) {
        return 0x11223344;
    }
}

contract AbiReverter {
    error AlwaysReverts();

    function fail() external pure {
        revert AlwaysReverts();
    }
}
