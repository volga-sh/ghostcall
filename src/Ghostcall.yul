object "Ghostcall" {
    code {
        // CREATE-style eth_call initcode: RETURN becomes the simulated runtime bytes.
        // Input: appended [uint16 calldata length][20-byte target][calldata] entries.
        // Output: [success bit | uint15 returndata length][returndata] entries.
        // The SDK validates inputs; malformed hand-built payloads are unsupported.

        // Without a data section solc appends no trailing INVALID byte, so this
        // object's size is the offset of the first caller-appended byte.
        let payloadCursor := datasize("Ghostcall")

        // [0, writePtr) is finalized output. Everything after it is scratch.
        let writePtr := 0x00

        for {} 1 {} {
            // Append the previous call's returndata after its header. The buffer is
            // empty before the first call, and the loop only comes back here once
            // the length has passed the uint15 check below.
            returndatacopy(writePtr, 0, returndatasize())
            writePtr := add(writePtr, returndatasize())

            // Aggregate size is governed by the active chain/client's CREATE policy.
            if iszero(lt(payloadCursor, codesize())) {
                return(0x00, writePtr)
            }

            // One word holds [length(2)][target(20)][unused(10)].
            codecopy(writePtr, payloadCursor, 0x16)
            let headerWord := mload(writePtr)
            payloadCursor := add(payloadCursor, 0x16)
            let calldataSize := shr(240, headerWord)

            // Stage calldata over the input header, which now lives on the stack.
            codecopy(writePtr, payloadCursor, calldataSize)
            payloadCursor := add(payloadCursor, calldataSize)

            // CALL truncates the shifted word to the low 160 address bits.
            // Zero-value CALL (not STATICCALL) exposes state changes to later calls.
            let success := call(gas(), shr(80, headerWord), 0, writePtr, calldataSize, 0, 0)

            // Put the header in the high two bytes; the rest of the word is scratch
            // that the next iteration's returndatacopy overwrites or leaves unreturned.
            mstore(writePtr, or(shl(255, success), shl(240, returndatasize())))
            writePtr := add(writePtr, 0x02)

            // Reject lengths that would collide with the success bit. The bad
            // header above is never returned.
            if shr(15, returndatasize()) {
                revert(0x00, 0x00)
            }
        }
    }
}
