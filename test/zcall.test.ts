import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {join} from 'node:path'
import test from 'node:test'

import {Abi, AbiError, AbiFunction, Bytes, Hex, RpcTransport} from 'ox'

const projectRoot = process.cwd()
const defaultSender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const zcallErrorsAbi = Abi.from([
  'error ZCallMalformedPayload()',
  'error ZCallFailed(uint256)',
  'error ZCallReturnTooLarge()',
])

const zcallInputMagic = Bytes.fromString('ZCL1')
const zcallOutputMagic = Bytes.fromString('ZCR1')

test('ZCall integration', async (t) => {
  const anvil = await startAnvil()
  t.after(async () => {
    await stopAnvil(anvil)
  })

  const zcallArtifact = await loadArtifact('out/ZCall.yul/ZCall.json')
  const returnerArtifact = await loadArtifact('out/TestTargets.sol/AbiReturner.json')
  const reverterArtifact = await loadArtifact('out/TestTargets.sol/AbiReverter.json')

  const zcallInitcode = readBytecode(zcallArtifact, 'out/ZCall.yul/ZCall.json')
  const returnerInitcode = readBytecode(returnerArtifact, 'out/TestTargets.sol/AbiReturner.json')
  const reverterInitcode = readBytecode(reverterArtifact, 'out/TestTargets.sol/AbiReverter.json')

  const returnerAbi = readAbi(returnerArtifact, 'out/TestTargets.sol/AbiReturner.json')
  const reverterAbi = readAbi(reverterArtifact, 'out/TestTargets.sol/AbiReverter.json')

  const getValue = AbiFunction.fromAbi(returnerAbi, 'getValue')
  const fail = AbiFunction.fromAbi(reverterAbi, 'fail')

  const returnerAddress = await deployContract(anvil.transport, returnerInitcode)
  const reverterAddress = await deployContract(anvil.transport, reverterInitcode)

  await t.test('aggregates a successful call and an allowed failure', async () => {
    const callData = buildZCallData(zcallInitcode, [
      {
        target: returnerAddress,
        allowFailure: false,
        calldata: AbiFunction.encodeData(getValue),
      },
      {
        target: reverterAddress,
        allowFailure: true,
        calldata: AbiFunction.encodeData(fail),
      },
    ])

    const result = await ethCallCreate(anvil.transport, callData)
    const entries = decodeZCallResponse(result)

    assert.equal(entries.length, 2)

    assert.equal(entries[0]?.success, true)
    assert.equal(AbiFunction.decodeResult(getValue, entries[0]!.returndata), 0x11223344n)

    assert.equal(entries[1]?.success, false)
    const subcallError = AbiError.fromAbi(reverterAbi, entries[1]!.returndata)
    assert.equal(subcallError.name, 'AlwaysReverts')
    assert.equal(AbiError.decode(subcallError, entries[1]!.returndata), undefined)
  })

  await t.test('reverts when a subcall failure is disallowed', async () => {
    const callData = buildZCallData(zcallInitcode, [
      {
        target: reverterAddress,
        allowFailure: false,
        calldata: AbiFunction.encodeData(fail),
      },
    ])

    const response = await ethCallCreateRaw(anvil.transport, callData)
    const error = getRpcError(response)
    const revertData = getRevertData(error)

    const abiError = AbiError.fromAbi(zcallErrorsAbi, revertData)
    assert.equal(abiError.name, 'ZCallFailed')
    assert.equal(AbiError.decode(abiError, revertData), 0n)
  })

  await t.test('reverts on malformed payload', async () => {
    const response = await ethCallCreateRaw(anvil.transport, Hex.concat(zcallInitcode, '0x00'))
    const error = getRpcError(response)
    const revertData = getRevertData(error)

    const abiError = AbiError.fromAbi(zcallErrorsAbi, revertData)
    assert.equal(abiError.name, 'ZCallMalformedPayload')
    assert.equal(AbiError.decode(abiError, revertData), undefined)
  })
})

type Artifact = {
  abi?: readonly unknown[]
  bytecode?: {
    object?: string
  }
}

type CallSpec = {
  target: Hex.Hex
  allowFailure: boolean
  calldata: Hex.Hex
}

type ZCallEntry = {
  success: boolean
  returndata: Hex.Hex
}

type RpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

type RawRpcResponse<result> =
  | {
      id: number
      jsonrpc: '2.0'
      result: result
    }
  | {
      id: number
      jsonrpc: '2.0'
      error: RpcErrorObject
    }

type AnvilInstance = {
  child: ReturnType<typeof spawn>
  logs: string[]
  transport: Transport
  url: string
}

type Transport = RpcTransport.Http<false>

async function loadArtifact(relativePath: string): Promise<Artifact> {
  const filePath = join(projectRoot, relativePath)
  return JSON.parse(await readFile(filePath, 'utf8')) as Artifact
}

function readAbi(artifact: Artifact, artifactPath: string) {
  assert.ok(artifact.abi, `Missing ABI in ${artifactPath}`)
  return Abi.from(artifact.abi as Abi.Abi)
}

function readBytecode(artifact: Artifact, artifactPath: string): Hex.Hex {
  const bytecode = artifact.bytecode?.object
  assert.ok(bytecode && bytecode !== '0x', `Missing bytecode in ${artifactPath}`)
  return normalizeHex(bytecode)
}

async function startAnvil(): Promise<AnvilInstance> {
  const port = await getFreePort()
  const url = `http://127.0.0.1:${port}`
  const logs: string[] = []

  const child = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (chunk: Buffer | string) => {
    logs.push(chunk.toString())
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    logs.push(chunk.toString())
  })

  const transport: Transport = RpcTransport.fromHttp(url)

  try {
    await waitForRpc(transport, child, logs)
  } catch (error) {
    await stopAnvil({child, logs, transport, url})
    throw error
  }

  return {child, logs, transport, url}
}

async function stopAnvil(anvil: AnvilInstance): Promise<void> {
  if (anvil.child.exitCode !== null) {
    return
  }

  const exit = once(anvil.child, 'exit')
  anvil.child.kill('SIGTERM')

  await Promise.race([exit, sleep(2_000)])

  if (anvil.child.exitCode === null) {
    anvil.child.kill('SIGKILL')
    await exit
  }
}

async function waitForRpc(
  transport: Transport,
  child: ReturnType<typeof spawn>,
  logs: string[],
): Promise<void> {
  const timeoutAt = Date.now() + 10_000

  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`anvil exited before becoming ready\n${logs.join('')}`)
    }

    try {
      await transport.request({method: 'eth_blockNumber'})
      return
    } catch {
      await sleep(100)
    }
  }

  throw new Error(`Timed out waiting for anvil to become ready\n${logs.join('')}`)
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not determine a free TCP port'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

async function deployContract(
  transport: Transport,
  bytecode: Hex.Hex,
): Promise<Hex.Hex> {
  const hash = (await transport.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: defaultSender,
        data: bytecode,
      },
    ],
  })) as Hex.Hex

  const receipt = await waitForReceipt(transport, hash)
  assert.equal(typeof receipt.contractAddress, 'string')
  return receipt.contractAddress as Hex.Hex
}

async function waitForReceipt(
  transport: Transport,
  hash: Hex.Hex,
): Promise<{contractAddress?: string | null}> {
  const timeoutAt = Date.now() + 10_000

  while (Date.now() < timeoutAt) {
    const receipt = (await transport.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    })) as {contractAddress?: string | null} | null

    if (receipt) {
      return receipt
    }

    await sleep(100)
  }

  throw new Error(`Timed out waiting for receipt for ${hash}`)
}

function buildZCallData(zcallInitcode: Hex.Hex, calls: readonly CallSpec[]): Hex.Hex {
  const parts = [zcallInputMagic]

  for (const call of calls) {
    parts.push(Bytes.from(call.target))
    parts.push(Bytes.fromNumber(call.allowFailure ? 1 : 0, {size: 1}))
    parts.push(Bytes.fromNumber(Hex.size(call.calldata), {size: 2}))
    parts.push(Bytes.from(call.calldata))
  }

  return Hex.concat(zcallInitcode, Bytes.toHex(Bytes.concat(...parts)))
}

function decodeZCallResponse(data: Hex.Hex): ZCallEntry[] {
  const bytes = Bytes.fromHex(data)
  assert.equal(Bytes.toHex(Bytes.slice(bytes, 0, 4)), Bytes.toHex(zcallOutputMagic))

  const entries: ZCallEntry[] = []
  let cursor = 4

  while (cursor < Bytes.size(bytes)) {
    assert.ok(cursor + 3 <= Bytes.size(bytes), 'Truncated ZCall response header')

    const success = Bytes.toNumber(Bytes.slice(bytes, cursor, cursor + 1), {size: 1}) === 1
    const returndataLength = Bytes.toNumber(Bytes.slice(bytes, cursor + 1, cursor + 3), {size: 2})
    const returndataStart = cursor + 3
    const returndataEnd = returndataStart + returndataLength

    assert.ok(returndataEnd <= Bytes.size(bytes), 'Truncated ZCall response body')

    entries.push({
      success,
      returndata: Bytes.toHex(Bytes.slice(bytes, returndataStart, returndataEnd)),
    })

    cursor = returndataEnd
  }

  return entries
}

async function ethCallCreate(
  transport: Transport,
  data: Hex.Hex,
): Promise<Hex.Hex> {
  return (await transport.request({
    method: 'eth_call',
    params: [
      {
        from: defaultSender,
        data,
      },
      'latest',
    ],
  })) as Hex.Hex
}

async function ethCallCreateRaw(
  transport: Transport,
  data: Hex.Hex,
): Promise<RawRpcResponse<Hex.Hex>> {
  return (await transport.request(
    {
      method: 'eth_call',
      params: [
        {
          from: defaultSender,
          data,
        },
        'latest',
      ],
    },
    {raw: true},
  )) as RawRpcResponse<Hex.Hex>
}

function getRpcError(response: RawRpcResponse<Hex.Hex>): RpcErrorObject {
  if ('error' in response) {
    return response.error
  }

  assert.fail(`Expected RPC error, received result ${response.result}`)
}

function getRevertData(error: RpcErrorObject): Hex.Hex {
  const {data} = error
  if (typeof data !== 'string') {
    throw new Error(`Expected string revert data, received ${typeof data}`)
  }

  return normalizeHex(data)
}

function normalizeHex(value: string): Hex.Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex.Hex
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
