#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = PROJECT_ROOT / "out" / "ZCall.yul" / "ZCall.json"

RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
FROM = os.environ.get("FROM", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")

INPUT_MAGIC = b"ZCL1"
OUTPUT_MAGIC = b"ZCR1"

MALFORMED_PAYLOAD_SELECTOR = "0x0ea77364"
CALL_FAILED_SELECTOR = "0x2dd41103"


@dataclass(frozen=True)
class CallSpec:
    target: str
    allow_failure: bool
    calldata: bytes


class RpcError(RuntimeError):
    def __init__(self, method: str, error: dict[str, object]) -> None:
        self.method = method
        self.error = error
        super().__init__(f"RPC {method} failed: {error}")

    @property
    def revert_data(self) -> str | None:
        data = self.error.get("data")
        return data if isinstance(data, str) else None


def rpc(method: str, params: list[object]) -> object:
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": 1,
        }
    ).encode()

    request = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request) as response:
            body = json.load(response)
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not reach RPC at {RPC_URL}: {exc}") from exc

    if "error" in body:
        raise RpcError(method, body["error"])

    return body["result"]


def load_initcode() -> str:
    artifact = json.loads(ARTIFACT_PATH.read_text())

    for key in ("bytecode", "deployedBytecode"):
        candidate = artifact.get(key)
        if isinstance(candidate, dict) and isinstance(candidate.get("object"), str):
            bytecode = candidate["object"]
            if bytecode and bytecode != "0x":
                return normalize_hex(bytecode)

    raise SystemExit(f"Could not find compiled bytecode in {ARTIFACT_PATH}")


def normalize_hex(value: str) -> str:
    return value if value.startswith("0x") else f"0x{value}"


def deploy_raw(initcode: str) -> str:
    tx_hash = rpc(
        "eth_sendTransaction",
        [
            {
                "from": FROM,
                "data": normalize_hex(initcode),
            }
        ],
    )
    receipt = rpc("eth_getTransactionReceipt", [tx_hash])
    return receipt["contractAddress"]


def eth_call_create(initcode: str) -> str:
    return rpc(
        "eth_call",
        [
            {
                "from": FROM,
                "data": normalize_hex(initcode),
            },
            "latest",
        ],
    )


def build_payload(calls: list[CallSpec]) -> bytes:
    payload = bytearray(INPUT_MAGIC)

    for call in calls:
        target = bytes.fromhex(call.target.removeprefix("0x"))
        if len(target) != 20:
            raise ValueError(f"Expected 20-byte address, got {call.target}")

        calldata = call.calldata
        if len(calldata) > 0xFFFF:
            raise ValueError("Per-call calldata must fit into uint16")

        flags = 0x01 if call.allow_failure else 0x00

        payload.extend(target)
        payload.append(flags)
        payload.extend(len(calldata).to_bytes(2, "big"))
        payload.extend(calldata)

    return bytes(payload)


def decode_response(result_hex: str) -> list[tuple[bool, bytes]]:
    blob = bytes.fromhex(result_hex.removeprefix("0x"))

    if len(blob) < 4 or blob[:4] != OUTPUT_MAGIC:
        raise ValueError(f"Unexpected response prefix: {result_hex}")

    cursor = 4
    decoded: list[tuple[bool, bytes]] = []

    while cursor < len(blob):
        if cursor + 3 > len(blob):
            raise ValueError("Truncated response header")

        success = blob[cursor] == 1
        returndata_length = int.from_bytes(blob[cursor + 1 : cursor + 3], "big")
        cursor += 3

        if cursor + returndata_length > len(blob):
            raise ValueError("Truncated response body")

        returndata = blob[cursor : cursor + returndata_length]
        decoded.append((success, returndata))
        cursor += returndata_length

    return decoded


def main() -> int:
    initcode = load_initcode()

    # Runtime: PUSH4 0x11223344 PUSH1 0x00 MSTORE PUSH1 0x20 PUSH1 0x00 RETURN
    returner = deploy_raw("0x600d600c600039600d6000f3631122334460005260206000f3")

    # Runtime: PUSH1 0x00 PUSH1 0x00 REVERT
    reverter = deploy_raw("0x6005600c60003960056000f360006000fd")

    success_payload = build_payload(
        [
            CallSpec(target=returner, allow_failure=False, calldata=b""),
            CallSpec(target=reverter, allow_failure=True, calldata=b""),
        ]
    )
    success_result = eth_call_create(initcode + success_payload.hex())
    decoded = decode_response(success_result)

    assert len(decoded) == 2, decoded
    assert decoded[0][0] is True, decoded
    assert decoded[0][1] == bytes.fromhex(
        "0000000000000000000000000000000000000000000000000000000011223344"
    ), decoded
    assert decoded[1][0] is False, decoded
    assert decoded[1][1] == b"", decoded

    print("happy path:", success_result)

    try:
        failure_payload = build_payload([CallSpec(target=reverter, allow_failure=False, calldata=b"")])
        eth_call_create(initcode + failure_payload.hex())
    except RpcError as exc:
        revert_data = exc.revert_data or str(exc)
        assert revert_data.startswith(CALL_FAILED_SELECTOR), revert_data
        print("disallowed failure revert:", revert_data)
    else:
        raise AssertionError("Expected a top-level revert for a disallowed subcall failure")

    try:
        eth_call_create(initcode + "00")
    except RpcError as exc:
        revert_data = exc.revert_data or str(exc)
        assert revert_data.startswith(MALFORMED_PAYLOAD_SELECTOR), revert_data
        print("malformed payload revert:", revert_data)
    else:
        raise AssertionError("Expected a top-level revert for malformed payload")

    print("all integration checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
