object "Ghostcall" {
    code {
        // The EVM runs this initcode for an eth_call without a target address.
        // RETURN gives the results to eth_call. No contract stays on the chain.
        // The SDK does a check of each request before it sends the request.
        // This program does not do a check of the request entries.

        // Memory at the start of each loop:
        //
        // 0         datasize("Ghostcall")   entry       codesize()     writePtr
        // |         |                      |           |              |
        // +---------+----------------------+-----------+--------------+-------->
        // | program | calls that have run  | next calls| results      | unused |
        // +---------+----------------------+-----------+--------------+-------->
        // |<-------------- input copy ---------------->|<-- RETURN -->|
        //                                              ^
        //                              The input copy ends at codesize().
        //
        // Copy the request into memory one time. CALL reads calldata from this copy.
        // Put results after the input copy. A result cannot change the next call's input.
        codecopy(0, 0, codesize())

        // This object has no data section. Solc does not add an INVALID byte.
        // Thus the first entry starts at datasize("Ghostcall").
        let entry := datasize("Ghostcall")
        let writePtr := codesize()

        // The main program must have one or more entries.
        // For an empty batch, the SDK uses a different program that returns no data.
        for {} 1 {} {
            // mload(entry) reads this word. Offsets are in bytes.
            //
            // entry         entry + 2               entry + 22     entry + 32
            // |             |                       |              |
            // +-------------+-----------------------+--------------+
            // | length (2)  | target address (20)   | next bytes   |
            // +-------------+-----------------------+--------------+
            // |<--- 16 --->|<--------- 160 -------->|<---- 80 ---->|
            //                       Widths are in bits.
            //
            // The program does not use the last 80 bits.
            let headerWord := mload(entry)
            let calldataSize := shr(240, headerWord)
            let oldEntry := entry
            let calldataStart := add(entry, 22)
            entry := add(calldataStart, calldataSize)

            // The shift puts the target in the low 160 bits. CALL uses these bits only.
            // CALL sends zero value. A later call can read state changes from an earlier call.
            // CALL has output size zero. Thus the output offset does not affect memory.
            // Use the old cursor as this offset to remove its stack item.
            // This removes one stack instruction and saves one byte.
            let success := call(gas(), shr(80, headerWord), 0, calldataStart, calldataSize, oldEntry, 0)

            // Result memory after each write:
            //
            // writePtr    writePtr + 2                            writePtr + 32
            // |           |                                       |
            // +-----------+---------------------------------------+
            // | header(2) | temporary bytes                       |  MSTORE
            // +-----------+---------------------------------------+
            // +-----------+-----------------------------+
            // | header(2) | returndata                  |            RETURNDATACOPY
            // +-----------+-----------------------------+
            //                                           ^ next writePtr
            //
            // The header stores length in bits 1-15 and success in bit 0.
            // Later writes replace the temporary bytes. RETURN does not include unused bytes.
            mstore(writePtr, shl(240, add(success, add(returndatasize(), returndatasize()))))
            writePtr := add(2, writePtr)

            // A length of 32,767 bytes or less gives source offset zero.
            // A larger length gives a nonzero offset. The copy reads past the data buffer.
            // The EVM stops with an error and no data. It cannot return the incorrect header.
            returndatacopy(writePtr, shr(15, returndatasize()), returndatasize())
            writePtr := add(writePtr, returndatasize())

            // The last entry ends at codesize(). Thus entry is the start of the results.
            // Reuse entry to calculate the result length. This decreases the program size.
            if iszero(lt(entry, codesize())) { return(codesize(), sub(writePtr, entry)) }
        }
    }
}
