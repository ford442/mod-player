"""Cross-origin isolation (COOP/COEP) checks for the live xm-player site (#516 item 4).

`check_coi_headers` is pure and stdlib-only (tests/python/test_coi_headers.py); `probe_live_coi`
is the network side used by deploy.py (`--dry-run` and after an upload). `requests` is imported
lazily so the unit tests never need it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

OK = "ok"
WARN = "warn"
FAIL = "fail"

_SEVERITY = {OK: 0, WARN: 1, FAIL: 2}

PROBE_PATHS: tuple[str, ...] = ("/xm-player/", "/xm-player/worklets/openmpt-worklet.js")


@dataclass
class CoiResult:
    status: str
    messages: list[str] = field(default_factory=list)
    coop: str | None = None
    coep: str | None = None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


def _tokens(value: str) -> list[str]:
    # requests (and RFC 9110) join repeated header lines with ", ".
    return [part.strip().lower() for part in value.split(",") if part.strip()]


def check_coi_headers(headers: Mapping[str, str]) -> CoiResult:
    """Judge one response's COOP/COEP: ok = require-corp, warn = credentialless, fail otherwise."""
    coop = _header(headers, "Cross-Origin-Opener-Policy")
    coep = _header(headers, "Cross-Origin-Embedder-Policy")
    result = CoiResult(status=OK, coop=coop, coep=coep)

    def flag(status: str, message: str) -> None:
        result.messages.append(message)
        if _SEVERITY[status] > _SEVERITY[result.status]:
            result.status = status

    coop_tokens = _tokens(coop) if coop is not None else []
    if coop_tokens != ["same-origin"]:
        flag(FAIL, f"COOP is {coop!r}, expected 'same-origin'")

    coep_tokens = _tokens(coep) if coep is not None else []
    if not coep_tokens:
        flag(FAIL, "COEP is missing")
    elif len(coep_tokens) > 1:
        flag(FAIL, f"COEP is sent more than once ({coep!r}); browsers ignore a duplicated policy")
    elif coep_tokens[0] == "credentialless":
        flag(WARN, "COEP is credentialless: isolated on Chromium/Firefox only, not Safari")
    elif coep_tokens[0] != "require-corp":
        flag(FAIL, f"COEP is {coep!r}, expected 'require-corp'")

    if result.status == OK:
        result.messages.append("COOP same-origin + COEP require-corp")
    return result


def worst_status(results: list[CoiResult]) -> str:
    return max((r.status for r in results), key=lambda s: _SEVERITY[s], default=OK)


def probe_live_coi(host: str, *, timeout: float = 15.0) -> list[tuple[str, CoiResult]]:
    """GET each probe URL on `host` (following redirects, bypassing caches) and judge the final response."""
    import requests  # noqa: PLC0415 — keep the module importable without requests

    results: list[tuple[str, CoiResult]] = []
    for path in PROBE_PATHS:
        url = f"https://{host}{path}"
        try:
            resp = requests.get(
                url,
                timeout=timeout,
                allow_redirects=True,
                headers={"Cache-Control": "no-cache", "User-Agent": "mod-player-deploy-verify"},
            )
        except Exception as exc:  # noqa: BLE001 — report any network failure as a failed probe
            results.append((url, CoiResult(status=FAIL, messages=[f"request failed: {exc}"])))
            continue
        result = check_coi_headers(resp.headers)
        if resp.status_code != 200:
            result.status = FAIL
            result.messages.append(f"HTTP {resp.status_code} from {resp.url}")
        results.append((url, result))
    return results


def print_probe(results: list[tuple[str, CoiResult]]) -> None:
    for url, result in results:
        print(f"  [{result.status.upper()}] {url}")
        print(f"      COOP: {result.coop}")
        print(f"      COEP: {result.coep}")
        for message in result.messages:
            print(f"      - {message}")
