object "Ghostcall" {
    code {
        // CREATE-style eth_call initcode: RETURN becomes the simulated runtime bytes.
        // Input: appended [uint16 calldata length][20-byte target][calldata] entries.
        // Output: [success bit | uint15 returndata length][returndata] entries.
        // The SDK validates inputs; malformed hand-built payloads are unsupported.

        // The empty trailing data section marks the first caller-appended byte.
        let payloadCursor := dataoffset("user_payload_anchor")

        // [0, writePtr) is finalized output. Everything after it is scratch until
        // CALL finishes, then overwritten with the next packed result.
        let writePtr := 0x00

        for {} lt(payloadCursor, codesize()) {} {
            // One word holds [length(2)][target(20)][unused(10)].
            codecopy(writePtr, payloadCursor, 0x16)
            let headerWord := mload(writePtr)
            let calldataSize := shr(240, headerWord)

            // Stage calldata after the input header; returndata later overwrites it.
            let calldataPtr := add(writePtr, 0x16)
            let returndataPtr := add(writePtr, 0x02)
            codecopy(calldataPtr, add(payloadCursor, 0x16), calldataSize)

            // CALL truncates the shifted word to the low 160 address bits.
            // Zero-value CALL (not STATICCALL) exposes state changes to later calls.
            let success := call(gas(), shr(80, headerWord), 0, calldataPtr, calldataSize, 0, 0)
            let returndataSize := returndatasize()

            // Reject lengths that would collide with the success bit.
            if shr(15, returndataSize) {
                revert(0x00, 0x00)
            }

            // Put the header in the high two bytes; only the final written length
            // is returned, so the remainder of this word may be overwritten freely.
            mstore(writePtr, shl(240, or(shl(15, success), returndataSize)))
            returndatacopy(returndataPtr, 0, returndataSize)

            writePtr := add(returndataPtr, returndataSize)
            payloadCursor := add(payloadCursor, add(0x16, calldataSize))
        }

        // Aggregate size is governed by the active chain/client's CREATE policy.
        return(0x00, writePtr)
    }

    data "user_payload_anchor" hex""
}
