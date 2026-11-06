import argparse
import asyncio
import datetime
import functools
import hashlib
import http.server
import json
import pathlib
import re
import threading

from ai_dev_browser.core import (
    browser_start,
    browser_stop,
    cdp_send,
    connect_browser,
    get_active_tab,
    page_goto,
    page_screenshot,
)

parser = argparse.ArgumentParser(
    description="Exercise camera input during real Mermaid theme rendering. Requires ai-dev-browser."
)
parser.add_argument(
    "--output",
    type=pathlib.Path,
    required=True,
    help="Fresh directory for the retained receipt and screenshot",
)
options = parser.parse_args()
ROOT = options.output.resolve()
ROOT.mkdir(parents=True, exist_ok=False)
attempt = "acceptance"
out = ROOT / "receipt.json"
repo = pathlib.Path(__file__).resolve().parents[2]
markdown = (repo / "docs/sudo-cloud-plan.md").read_text(encoding="utf-8")
graph = markdown.split("<!-- cloud-plan:first-diagram -->", 1)[1].split(
    "<!-- /cloud-plan:first-diagram -->", 1
)[0]
expected_nodes = len(re.findall(r"^\s*([A-Z][A-Z0-9_]*)\[", graph, re.MULTILINE))
expected_diagrams = len(re.findall(r"^```mermaid", markdown, re.MULTILINE))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(repo))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
proof = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "passed": False,
    "tool": "ai-dev-browser",
    "sourceSha256": hashlib.sha256(
        (repo / "docs/sudo-cloud-plan.html").read_bytes()
    ).hexdigest(),
}
port = None
measure = 'JSON.stringify({theme:document.documentElement.dataset.theme,nodes:document.querySelectorAll("#diagram svg g.node").length,all:document.querySelectorAll("pre.mermaid").length,rendered:document.querySelectorAll("pre.mermaid svg").length,width:document.querySelector("#diagram svg")?.viewBox.baseVal.width,height:document.querySelector("#diagram svg")?.viewBox.baseVal.height,transformed:document.getElementById("diagram").style.transform.includes("scale("),triggered:window.__qaCameraTriggered===true})'


async def run():
    browser = await connect_browser(port=port)
    try:
        tab = await get_active_tab(browser)
        await cdp_send(
            tab,
            "Emulation.setDeviceMetricsOverride",
            json.dumps(
                {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False}
            ),
        )
        await page_goto(
            tab,
            "http://127.0.0.1:"
            + str(server.server_port)
            + "/docs/sudo-cloud-plan.html",
        )

        async def ready(target=None):
            for _ in range(90):
                state = json.loads(await tab.evaluate(measure))
                if (
                    state["nodes"] == expected_nodes
                    and state["rendered"] == state["all"] == expected_diagrams
                    and state["transformed"]
                    and (not target or state["triggered"] and state["theme"] == target)
                ):
                    await asyncio.sleep(0.3)
                    return json.loads(await tab.evaluate(measure))
                await asyncio.sleep(0.5)
            raise AssertionError("Actual diagram render did not finish")

        before = await ready()
        proof["before"] = before
        target = "dark" if before["theme"] == "light" else "light"
        await tab.evaluate(
            '(()=>{const timer=setInterval(()=>{if(document.getElementById("diagram").style.transform==="none"){document.getElementById("zoomIn").click();window.__qaCameraTriggered=true;clearInterval(timer)}},0);window.postMessage({source:"shareone-shell",type:"theme",value:'
            + json.dumps(target)
            + '},"*");return true})()'
        )
        after = await ready(target)
        proof["after"] = after
        await page_screenshot(
            tab,
            path=str(ROOT / "camera-race.png"),
            full_page=False,
            max_long_edge=1600,
            max_total_pixels=2300000,
        )
        assert after["triggered"], (
            "The regression must actually apply camera input during diagram rendering"
        )
        assert (
            abs(after["width"] - before["width"]) < 1
            and abs(after["height"] - before["height"]) < 1
        ), "Camera input changed the measured text geometry during theme rendering"
        proof["passed"] = True
    finally:
        await browser.close()


try:
    record = browser_start(
        headless=True,
        temp=True,
        reuse="none",
        url="about:blank",
        silent_stderr=True,
        extra_args=["--no-proxy-server"],
        match_proxy=False,
    )
    port = record["port"]
    proof["ownedBrowserPort"] = port
    asyncio.run(run())
except Exception as error:
    proof["error"] = type(error).__name__ + ": " + str(error)
    raise
finally:
    if port:
        proof["browserStop"] = browser_stop(port=port)
    server.shutdown()
    server.server_close()
    proof["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out.write_text(json.dumps(proof, indent=2), encoding="utf-8")
    print(json.dumps(proof))
assert proof["passed"], "Preserve this exact browser regression result"
