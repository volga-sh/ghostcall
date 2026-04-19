object "ZCall" {
    code {
        // ZCall is an initcode-only batching program for CREATE-style eth_call.
        //
        // The caller sends:
        //   <compiled initcode><payload>
        //
        // The compiled initcode lives in this source file. The payload is appended by the caller
        // after compilation, exactly like constructor arguments are appended to Solidity initcode.
        //
        // Input payload layout:
        //   4 bytes  magic = "ZCL1" (0x5a434c31)
        //   N bytes  repeated call entries
        //
        // Each call entry layout:
        //   20 bytes target
        //    1 byte  flags, bit 0 = allowFailure
        //    2 bytes calldata length (big-endian uint16)
        //    N bytes calldata
        //
        // Output layout:
        //   4 bytes  magic = "ZCR1" (0x5a435231)
        //   N bytes  repeated result entries
        //
        // Each result entry layout:
        //    1 byte  success flag
        //    2 bytes returndata length (big-endian uint16)
        //    N bytes returndata
        //
        // The program uses STATICCALL for every subcall so the aggregate remains read-only even if
        // the client executes eth_call in a non-static simulation mode.

        let inputMagic := 0x5a434c31
        let outputMagic := 0x5a435231

        // CREATE return data is still validated as deployed runtime code.
        let maxReturnSize := 0x6000
        let callHeaderSize := 0x17

        // dataoffset("user_payload_anchor") is a compile-time constant that resolves to the end of
        // the compiled initcode. Caller-appended payload bytes begin exactly there.
        let payloadCodeStart := dataoffset("user_payload_anchor")
        let payloadCodeEnd := codesize()
        let payloadSize := sub(payloadCodeEnd, payloadCodeStart)

        if lt(payloadSize, 0x04) {
            revertMalformedPayload()
        }

        let payloadPtr := 0x80
        codecopy(payloadPtr, payloadCodeStart, payloadSize)

        if iszero(eq(shr(224, mload(payloadPtr)), inputMagic)) {
            revertMalformedPayload()
        }

        let payloadCursor := add(payloadPtr, 0x04)
        let payloadEnd := add(payloadPtr, payloadSize)

        // Keep the payload copy intact and build the response in a separate region immediately
        // after it. This lets us pass calldata pointers directly into STATICCALL.
        let responsePtr := align32(add(payloadPtr, payloadSize))
        mstore(responsePtr, shl(224, outputMagic))

        let writePtr := add(responsePtr, 0x04)
        let callIndex := 0

        for {} 1 {} {
            if eq(payloadCursor, payloadEnd) {
                break
            }

            if gt(add(payloadCursor, callHeaderSize), payloadEnd) {
                revertMalformedPayload()
            }

            let target, allowFailure, calldataSize := parseEntryHeader(payloadCursor)
            let calldataPtr := add(payloadCursor, callHeaderSize)
            let nextCursor := add(calldataPtr, calldataSize)

            if gt(nextCursor, payloadEnd) {
                revertMalformedPayload()
            }

            let success := staticcall(gas(), target, calldataPtr, calldataSize, 0, 0)
            let returndataSize := returndatasize()

            if gt(returndataSize, 0xffff) {
                revertReturnTooLarge()
            }

            if iszero(success) {
                if iszero(allowFailure) {
                    revertCallFailed(callIndex)
                }
            }

            let nextWritePtr := add(add(writePtr, 0x03), returndataSize)

            if gt(sub(nextWritePtr, responsePtr), maxReturnSize) {
                revertReturnTooLarge()
            }

            mstore8(writePtr, success)
            writeU16(add(writePtr, 0x01), returndataSize)
            returndatacopy(add(writePtr, 0x03), 0, returndataSize)

            writePtr := nextWritePtr
            payloadCursor := nextCursor
            callIndex := add(callIndex, 1)
        }

        return(responsePtr, sub(writePtr, responsePtr))

        function align32(value) -> aligned {
            aligned := and(add(value, 0x1f), not(0x1f))
        }

        function parseEntryHeader(cursor) -> target, allowFailure, calldataSize {
            let word := mload(cursor)

            target := shr(96, word)
            allowFailure := and(byte(20, word), 0x01)
            calldataSize := or(shl(8, byte(21, word)), byte(22, word))
        }

        function writeU16(ptr, value) {
            mstore8(ptr, and(shr(8, value), 0xff))
            mstore8(add(ptr, 0x01), and(value, 0xff))
        }

        function revertMalformedPayload() {
            mstore(0x00, shl(224, 0x0ea77364))
            revert(0x00, 0x04)
        }

        function revertCallFailed(failedCallIndex) {
            mstore(0x00, shl(224, 0x2dd41103))
            mstore(0x04, failedCallIndex)
            revert(0x00, 0x24)
        }

        function revertReturnTooLarge() {
            mstore(0x00, shl(224, 0xe5f212d6))
            revert(0x00, 0x04)
        }
    }

    data "user_payload_anchor" hex""
}
