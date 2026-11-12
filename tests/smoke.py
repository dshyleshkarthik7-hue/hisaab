"""End-to-end smoke test. Requires Python 3, Java 17+ and TypeScript (tsc)."""
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def request(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            raw = response.read()
            return response.status, raw
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main():
    http_port, engine_port = free_port(), free_port()
    env = os.environ.copy()
    env["HISAAB_HTTP_PORT"] = str(http_port)
    env["HISAAB_ENGINE_PORT"] = str(engine_port)
    process = subprocess.Popen(["bash", "run.sh"], cwd=ROOT, env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{http_port}"
    try:
        ready = False
        for _ in range(30):
            if process.poll() is not None:
                raise RuntimeError("run.sh exited before the HTTP server became ready")
            try:
                status, body = request(base + "/")
                if status == 200 and b"HISAAB" in body:
                    ready = True
                    break
            except (OSError, TimeoutError):
                time.sleep(.4)
        if not ready:
            raise RuntimeError("Hisaab did not become ready within 12 seconds")

        status, body = request(base + "/healthz")
        assert status == 200 and json.loads(body).get("status") == "ok"

        status, body = request(base + "/readyz")
        assert status == 200 and json.loads(body).get("status") == "ready"

        
        status, body = request(base + "/api/data/snapshot")
        assert status == 200 and b"items" in body

        status, body = request(base + "/api/mitra", {"question": "What is an SIP?"})
        assert status == 200 and b"reply" in body

        status, body = request(base + "/api/tax/rules")
        assert status == 200 and b"packs" in body

        status, body = request(base + "/api/emi?loan=120000&rate=0&years=1")
        assert status == 200 and json.loads(body)["emi"] == 10000

        status, body = request(base + "/api/tax?ctc=1275000&basic=0&pt=0")
        assert status == 200 and json.loads(body)["tax"] == 0
        status, body = request(base + "/api/tax?ctc=1276000&basic=0&pt=0")
        assert status == 200 and json.loads(body)["tax"] == 1040
        status, _ = request(base + "/api/tax?ctc=50000001&basic=0&pt=0")
        assert status == 400

        scenario = {
            "years": 2, "savings": 500000, "income": 100000, "sip": 25000,
            "expense": 50000, "ret": 8, "vol": 12, "income_growth": 5,
            "medical_shock": 100000, "shocks": True, "seed": 42,
            "goals": [{"name": "Education", "at": 2, "cost": 300000,
                       "kind": "education", "flex": False}],
        }
        status, body = request(base + "/api/simulate", scenario)
        result = json.loads(body)
        assert status == 200 and result["trials"] == 2000
        assert 0 <= result["score"] <= 1 and len(result["fan"]) == 3
        status, pdf = request(base + "/api/report/pdf", {"lang": "en", "inputs": {**scenario, "events": []}, "result": result})
        assert status == 200 and pdf.startswith(b"%PDF"), "PDF endpoint did not return a valid PDF"
        status, telugu_pdf = request(base + "/api/report/pdf", {
            "lang": "te",
            "inputs": {**scenario, "events": []},
            "result": result,
        })
        assert status == 200 and telugu_pdf.startswith(b"%PDF") and b"FontFile2" in telugu_pdf, "Telugu PDF font was not embedded"

        status, _ = request(base + "/api/simulate", {"years": 99})
        assert status == 400
        status, _ = request(base + "/%2e%2e/java/Hisaab.java")
        assert status == 404
        print("Hisaab end-to-end smoke tests passed.")
    finally:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)

if __name__ == "__main__":
    main()
