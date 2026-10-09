object "Ghostcall" {
    code {
        // This program is the initcode of a CREATE-style eth_call. The EVM
        // executes the eth_call data as initcode. The data that this program
        // returns becomes the eth_call result. No contract is deployed.
        //
        // Request bytes (the code of this program, then the entries):
        //
        //   [program][entry 0][entry 1]...[entry n-1]
        //
        //   entry  = [calldata length: uint16][target: 20 bytes][calldata]
        //
        // Response bytes (one result for each entry, in the same order):
        //
        //   [result 0][result 1]...[result n-1]
        //
        //   result = [header: uint16][returndata]
        //   header = returndata length * 2 + success bit
        //
        // The SDK does a check of each request before it sends the request.
        // This program does not do a check of the entries. The request must
        // contain one or more entries. The result of a bad request is not
        // defined.
        //
        // Memory layout in the loop:
        //
        //   0         datasize  entry        codesize     writePtr
        //   |         |         |            |            |
        //   +---------+---------+------------+------------+-----------+
        //   | program | entries | entries    | results    | temporary |
        //   |         | (done)  | (not done) |            | bytes     |
        //   +---------+---------+------------+------------+-----------+
        //   |<------ copy of the code ------>|<- RETURN ->|
        //
        // The program copies all of its code into memory one time. It reads
        // each entry with one mload, and CALL reads the calldata from the copy.
        // The results start at codesize(), after the copy. Thus a result
        // cannot overwrite an entry that the program did not read.
        codecopy(0, 0, codesize())

        // Solc adds an INVALID byte at the end of the code only for an object
        // with a data section. This object has no data section. Thus entry 0
        // starts at datasize().
        let entry := datasize("Ghostcall")
        let writePtr := codesize()

        // Each iteration calls the target of one entry. The program does the
        // end check after the call. Thus the SDK must not send a request with
        // no entries.
        for {} 1 {} {
            // mload(entry) gives this 32-byte word:
            //
            //   entry     entry+2            entry+22      entry+32
            //   |         |                  |             |
            //   +---------+------------------+-------------+
            //   | length  | target           | calldata    |
            //   | 2 bytes | 20 bytes         | (not used)  |
            //   +---------+------------------+-------------+
            //
            // For the last entry, the bytes after entry+22 can be result bytes.
            // The program does not use these bytes.
            let headerWord := mload(entry)
            let calldataSize := shr(240, headerWord)
            let calldataStart := add(entry, 22)
            entry := add(calldataStart, calldataSize)

            // shr(80, headerWord) puts [length][target] in the low 176 bits.
            // CALL uses only the low 160 bits, which contain the target.
            // The program uses CALL with zero value, not STATICCALL. A call can
            // change the state, and the calls after it see these changes.
            let success := call(gas(), shr(80, headerWord), 0, calldataStart, calldataSize, 0, 0)

            // The program writes the result header, then the returndata:
            //
            //   writePtr  writePtr+2                    writePtr+32
            //   |         |                             |
            //   +---------+-----------------------------+
            //   | header  | temporary bytes             |   1. mstore
            //   +---------+-----------------------------+
            //   +---------+----------------------+
            //   | header  | returndata           |          2. returndatacopy
            //   +---------+----------------------+
            //                                    |
            //                                    writePtr for the next result
            //
            // The mstore writes 32 bytes. The returndata or the next result
            // overwrites the temporary bytes, or RETURN does not include them.
            // A success bit in bit 0 makes the code 1 byte smaller than a
            // success bit in bit 15.
            mstore(writePtr, shl(240, add(success, add(returndatasize(), returndatasize()))))
            writePtr := add(2, writePtr)

            // The header has 15 bits for the length. Thus the maximum length is
            // 32,767 bytes. For more bytes, shr(15, returndatasize()) is not
            // zero, and RETURNDATACOPY reads after the end of the returndata.
            // This is an exceptional halt. The full eth_call stops with an
            // error and no data, and the program does not return the bad header.
            returndatacopy(writePtr, shr(15, returndatasize()), returndatasize())
            writePtr := add(writePtr, returndatasize())

            // The last entry ends at codesize(), where the results start. Thus
            // entry is equal to codesize() here, and writePtr - entry is the
            // length of the results. This expression gives smaller code than
            // writePtr - codesize().
            if iszero(lt(entry, codesize())) { return(codesize(), sub(writePtr, entry)) }
        }
    }
}
