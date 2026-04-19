#!/usr/bin/env bash

set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
FROM="${FROM:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

rpc() {
  local method="$1"
  local params="$2"
  curl -s \
    -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"${method}\",\"params\":${params},\"id\":1}" \
    "${RPC_URL}"
}

result() {
  jq -r '.result'
}

error_message() {
  jq -r '.error.message // empty'
}

echo "1. CREATE-style eth_call returns constructor bytes"
minimal_create_result="$(
  rpc "eth_call" "[{\"from\":\"${FROM}\",\"data\":\"0x600a600c600039600a6000f3602a60005260206000f3\"},\"latest\"]" | result
)"
echo "   result: ${minimal_create_result}"
echo

echo "2. Appended payload is readable from initcode via CODECOPY"
tail_copy_result="$(
  rpc "eth_call" "[{\"from\":\"${FROM}\",\"data\":\"0x6004600c60003960046000f3deadbeef\"},\"latest\"]" | result
)"
echo "   result: ${tail_copy_result}"
echo

echo "3. Deploy a tiny target contract that always returns 0x11223344"
deploy_tx="$(
  rpc "eth_sendTransaction" "[{\"from\":\"${FROM}\",\"data\":\"0x600d600c600039600d6000f3631122334460005260206000f3\"}]" | result
)"
receipt="$(
  rpc "eth_getTransactionReceipt" "[\"${deploy_tx}\"]"
)"
target_address="$(printf '%s' "${receipt}" | jq -r '.result.contractAddress')"
echo "   tx hash: ${deploy_tx}"
echo "   target: ${target_address}"
echo

echo "4. Normal eth_call to the target contract"
target_result="$(
  rpc "eth_call" "[{\"to\":\"${target_address}\",\"data\":\"0x\"},\"latest\"]" | result
)"
echo "   result: ${target_result}"
echo

echo "5. CREATE-style eth_call that STATICCALLs the deployed target"
target_no_prefix="${target_address#0x}"
create_staticcall_bytecode="0x602060006000600073${target_no_prefix}5afa5060206000f3"
create_staticcall_result="$(
  rpc "eth_call" "[{\"from\":\"${FROM}\",\"data\":\"${create_staticcall_bytecode}\"},\"latest\"]" | result
)"
echo "   result: ${create_staticcall_result}"
echo

echo "6. Return-size ceiling for constructor output"
python3 - <<'PY'
import json
import urllib.request

RPC_URL = "http://127.0.0.1:8545"
FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

def eth_call_with_return_size(length: int) -> dict:
    prefix = (
        bytes([0x61])
        + length.to_bytes(2, "big")
        + bytes([0x61, 0x00, 0x0F, 0x60, 0x00, 0x39, 0x61])
        + length.to_bytes(2, "big")
        + bytes([0x60, 0x00, 0xF3])
    )
    code = "0x" + (prefix + bytes(length)).hex()
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"from": FROM, "data": code}, "latest"],
            "id": 1,
        }
    ).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

ok = eth_call_with_return_size(24576)
too_big = eth_call_with_return_size(24577)

print("   24576 bytes:", "ok" if "result" in ok else ok["error"]["message"])
print("   24577 bytes:", too_big["error"]["message"] if "error" in too_big else "ok")
PY
echo

echo "7. Initcode-size ceiling"
python3 - <<'PY'
import json
import urllib.request

RPC_URL = "http://127.0.0.1:8545"
FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

def eth_call_with_initcode_size(length: int) -> dict:
    code = "0x" + ("00" * length)
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"from": FROM, "data": code}, "latest"],
            "id": 1,
        }
    ).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

ok = eth_call_with_initcode_size(49152)
too_big = eth_call_with_initcode_size(49153)

print("   49152 bytes:", "ok" if "result" in ok else ok["error"]["message"])
print("   49153 bytes:", too_big["error"]["message"] if "error" in too_big else "ok")
PY
