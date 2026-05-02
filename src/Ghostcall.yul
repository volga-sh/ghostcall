object "Ghostcall" {
    code {
        // Ghostcall is an "initcode program" rather than a normal deployed contract.
        //
        // Mental model:
        // 1. A normal CREATE transaction executes initcode.
        // 2. That initcode usually builds runtime bytecode and RETURNs it.
        // 3. Ghostcall uses the same mechanism, but inside eth_call.
        // 4. Because this is only a simulation, nothing is deployed.
        // 5. Whatever bytes this program RETURNs become the eth_call result.
        //
        // In other words: Ghostcall treats CREATE initcode like a tiny one-shot program that can
        // batch external CALLs and return their raw results.
        //
        // The caller sends one byte blob:
        //   <compiled ghostcall initcode><payload>
        //
        // The payload is appended directly after the compiled initcode. It is not normal calldata.
        // This program reads that appended payload back out of its own code using CODECOPY.
        //
        // Payload layout:
        //   repeated call entries
        //
        // Each call entry:
        //    2 bytes  calldata length (big-endian uint16)
        //   20 bytes  target address
        //    N bytes  calldata
        //
        // Output layout:
        //   repeated result entries
        //
        // Each result entry:
        //    2 bytes  packed header
        //             bit 15    = success flag from CALL
        //             bits 0-14 = returndata length (big-endian uint15)
        //    N bytes  returndata
        //
        // The program does the same high-level loop for every entry:
        // - read the next calldata length + target
        // - copy that call's calldata into memory
        // - execute CALL(target, calldata)
        // - append (success, returndata) to the response buffer
        // - continue until the payload is fully consumed
        //
        // The SDK is expected to validate caller-facing input invariants ahead of time. The only
        // top-level check left here protects response packing, because returndata size is learned
        // from the EVM after each CALL.

        // dataoffset("user_payload_anchor") is the byte offset of the empty data section declared at
        // the bottom of this file. Because that data section is placed after the code, its offset is
        // exactly "the first byte after the compiled initcode". That makes it the start of the
        // caller-appended payload.
        let payloadCursor := dataoffset("user_payload_anchor")

        // Memory layout used by this program:
        // - 0x00..writePtr: finalized output buffer that will become the eth_call return value
        // - writePtr..writePtr+0x1f: scratch space for reading the current entry header
        //
        // writePtr always points to where the next result entry starts. The entry's memory is
        // scratch until CALL completes, then the packed result overwrites that same region.
        let writePtr := 0x00

        // Process entries until the cursor reaches the end of the CREATE payload. SDK-generated
        // payloads always land exactly on codesize(); raw malformed trailing bytes are outside the
        // supported boundary and are not checked here.
        for {} lt(payloadCursor, codesize()) {} {
            // Read the 22-byte fixed-size entry header into scratch memory at writePtr.
            //
            // The header layout is [len(2)][target(20)]. One mload gives us:
            //   [2-byte len][20-byte target][10 trailing bytes]
            codecopy(writePtr, payloadCursor, 0x16)

            let headerWord := mload(writePtr)

            // The high 2 bytes hold the big-endian uint16 calldata length. The target occupies the
            // next 20 bytes, so shr(80, headerWord) yields the address for CALL.
            let calldataSize := shr(240, headerWord)

            // Put calldata after the 22-byte input header scratch. The returned entry later uses
            // only writePtr..writePtr+0x01 for its packed header and writePtr+0x02 onward for
            // returndata, so this staging area can be safely overwritten after CALL.
            let calldataPtr := add(writePtr, 0x16)
            let returndataPtr := add(writePtr, 0x02)

            // Copy just this call's calldata into memory so CALL can read it.
            codecopy(calldataPtr, add(payloadCursor, 0x16), calldataSize)

            // Execute the external call with:
            // - all remaining gas
            // - zero ETH value
            // - calldata in memory at calldataPtr
            // - no output buffer yet, because we do not know returndata size in advance
            //
            let success := call(gas(), shr(80, headerWord), 0, calldataPtr, calldataSize, 0, 0)
            let returndataSize := returndatasize()

            // The packed result header has 15 returndata length bits; bit 15 is the success flag.
            // Revert rather than letting oversized returndata collide with the success bit.
            if shr(15, returndataSize) {
                revert(0x00, 0x00)
            }

            // Intentionally do not enforce an aggregate response-size cap here. CREATE-style
            // execution already treats returned bytes as would-be runtime code, so the active
            // chain/client/RPC environment will reject oversized responses according to its own
            // code-size policy. Keeping this uncapped lets the same Ghostcall initcode benefit from
            // networks with larger limits, such as Monad's MIP-2:
            // https://mips.monad.xyz/MIPS/MIP-2

            // Write the packed 2-byte result header into the high 2 bytes of the 32-byte word at
            // writePtr. The rest of that word does not matter because the return length is computed
            // explicitly at the end.
            mstore(writePtr, shl(240, or(shl(15, success), returndataSize)))

            // Append the raw returndata bytes immediately after the 2-byte header.
            returndatacopy(returndataPtr, 0, returndataSize)

            // Advance both cursors:
            // - writePtr moves to the start of the next result entry
            // - payloadCursor moves to the next input entry
            writePtr := add(returndataPtr, returndataSize)
            payloadCursor := add(payloadCursor, add(0x16, calldataSize))
        }

        // Return exactly the bytes that were written to the response buffer.
        return(0x00, writePtr)

    }

    data "user_payload_anchor" hex""
}
