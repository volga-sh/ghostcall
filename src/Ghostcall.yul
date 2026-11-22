object "Ghostcall" {
    code {
        // CREATE-style eth_call initcode: RETURN becomes the simulated runtime bytes.
        // Input: appended [uint16 calldata length][20-byte target][calldata] entries.
        // Output: [uint15 returndata length | success bit][returndata] entries.
        // The SDK validates inputs; malformed hand-built payloads are unsupported.

        // Copy the request once so every CALL reads its calldata in place.
        codecopy(0x00, 0x00, codesize())

        // Without a data section solc appends no trailing INVALID byte, so this
        // object's size is the offset of the first caller-appended byte.
        let payloadCursor := datasize("Ghostcall")

        // [codesize(), writePtr) is finalized output, kept after the request so it
        // cannot overwrite a pending entry. Everything after it is scratch.
        let writePtr := codesize()

        // The end of the payload is checked after each call, so the payload needs
        // at least one entry. The SDK never sends an empty batch.
        for {} 1 {} {
            // One word holds [length(2)][target(20)][unused(10)].
            let headerWord := mload(payloadCursor)
            let calldataSize := shr(240, headerWord)
            let calldataStart := add(payloadCursor, 0x16)
            let nextCursor := add(calldataStart, calldataSize)

            // CALL truncates the shifted word to the low 160 address bits.
            // Zero-value CALL (not STATICCALL) exposes state changes to later calls.
            // The output size is zero, so the output offset is ignored; passing the
            // cursor there is one byte smaller than pushing another zero.
            let success := call(gas(), shr(80, headerWord), 0, calldataStart, calldataSize, payloadCursor, 0)
            payloadCursor := nextCursor

            // Put the header in the high two bytes; the rest of the word is scratch
            // that later writes overwrite or leave unreturned. The constant comes
            // first in the add because solc emits eight more bytes the other way.
            mstore(writePtr, shl(240, add(add(returndatasize(), returndatasize()), success)))
            writePtr := add(0x02, writePtr)

            // A length past uint15 overflows the header. It also makes the source
            // offset nonzero, so the copy reads out of bounds and the EVM halts
            // before the bad header is returned.
            returndatacopy(writePtr, shr(15, returndatasize()), returndatasize())
            writePtr := add(writePtr, returndatasize())

            // Aggregate size is governed by the active chain/client's CREATE policy.
            // The last entry ends at codesize(), where the output starts, so the cursor
            // measures the output two bytes cheaper than codesize() would.
            if iszero(lt(payloadCursor, codesize())) {
                return(codesize(), sub(writePtr, payloadCursor))
            }
        }
    }
}
