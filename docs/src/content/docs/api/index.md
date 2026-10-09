---
title: API Reference
description: Select a ghostcall function for the necessary result.
---

ghostcall exports four functions, one error class, and their
[types](/api/types/).

| Goal | Function |
| --- | --- |
| Decode each result. Failed calls cause errors. | [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) |
| Read success flags and return data. Let selected calls fail. | [`aggregateCalls()`](/api/aggregate-calls/) |
| Build request data for an `eth_call` sent by the application | [`encodeCalls()`](/api/encode-calls/) |
| Parse the response to that `eth_call` | [`decodeResults()`](/api/decode-results/) |

[`GhostcallSubcallError`](/api/subcall-error/) shows which call failed.

Read [Limits](/limits/) before you build large batches.
