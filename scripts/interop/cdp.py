# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets"]
# ///

import argparse
import asyncio
import json
import os
import urllib.parse
import urllib.request

import websockets

parser = argparse.ArgumentParser(description="Evaluate an expression in a disposable CDP page.")
parser.add_argument("url_match", help="Page URL substring, or first for a disposable single-page session")
parser.add_argument("expression")
arguments = parser.parse_args()


async def main():
    endpoint = os.environ.get("CDP_HTTP", "http://127.0.0.1:19229")
    with urllib.request.urlopen(endpoint + "/json/list", timeout=10) as response:
        targets = json.load(response)
    target = next(
        target
        for target in targets
        if target.get("type") == "page"
        and (arguments.url_match in target.get("url", "") or arguments.url_match == "first")
    )
    original = urllib.parse.urlparse(target["webSocketDebuggerUrl"])
    forwarded = urllib.parse.urlparse(endpoint)
    url = urllib.parse.urlunparse(original._replace(netloc=forwarded.netloc))
    async with websockets.connect(url, max_size=16 * 1024 * 1024) as socket:
        await socket.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": arguments.expression,
                        "returnByValue": True,
                        "awaitPromise": True,
                    },
                }
            )
        )
        while True:
            result = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
            if result.get("id") == 1:
                print(json.dumps(result, indent=2))
                if "error" in result or "exceptionDetails" in result.get("result", {}):
                    raise SystemExit(1)
                break


asyncio.run(main())
