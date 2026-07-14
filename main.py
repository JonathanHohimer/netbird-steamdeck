import asyncio
import json
import os
import re
import shlex
import shutil
from pathlib import Path
from typing import Any, Optional

import decky

BINARY_CANDIDATES = [
    "/usr/bin/netbird",
    "/usr/local/bin/netbird",
    "/opt/netbird/netbird",
    "/home/deck/.local/bin/netbird",
]

AUTH_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
UNSAFE_TOKEN_RE = re.compile(r"[;&|`$<>\\\n\r]")

# Tokens that look like network IDs / route names in `networks list` output
NETWORK_ID_LINE_RE = re.compile(
    r"(?:^|\s)(?:[-*]\s*)?(?:ID|Network ID|Route ID)\s*[:=]\s*(\S+)",
    re.IGNORECASE,
)
NETWORK_STATUS_RE = re.compile(
    r"(?:Status|Selected)\s*[:=]\s*(Selected|Not\s*Selected|true|false|yes|no)",
    re.IGNORECASE,
)
# Fallback: lines like "- route-name (Selected)" or "route-name  Selected"
NETWORK_SIMPLE_RE = re.compile(
    r"^[\s*\-]*(?P<id>[A-Za-z0-9_.:/@\-]+)\s*(?:\((?P<paren>[^)]+)\)|\s+(?P<status>Selected|Not\s*Selected))?",
    re.IGNORECASE,
)


def _settings_path() -> Path:
    return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"


def _load_settings() -> dict[str, Any]:
    path = _settings_path()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        decky.logger.warning(f"Failed to read settings: {exc}")
        return {}


def _save_settings(data: dict[str, Any]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _resolve_binary() -> Optional[str]:
    found = shutil.which("netbird")
    if found:
        return found
    for candidate in BINARY_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _extract_auth_url(text: str) -> Optional[str]:
    if not text:
        return None
    matches = AUTH_URL_RE.findall(text)
    for url in matches:
        # Prefer SSO / login style URLs; fall back to first http(s) URL
        lower = url.lower()
        if any(k in lower for k in ("login", "sso", "auth", "oauth", "netbird")):
            return url.rstrip(").,]}")
    return matches[0].rstrip(").,]}") if matches else None


def _redact_cmd(cmd: list[str]) -> str:
    redacted: list[str] = []
    skip_next = False
    for i, part in enumerate(cmd):
        if skip_next:
            skip_next = False
            redacted.append("<redacted>")
            continue
        if part in ("--setup-key", "-k"):
            redacted.append(part)
            skip_next = True
            continue
        if part.startswith("--setup-key=") or part.startswith("-k="):
            key, _, _ = part.partition("=")
            redacted.append(f"{key}=<redacted>")
            continue
        redacted.append(part)
    return " ".join(redacted)


def _parse_networks_list(output: str) -> list[dict[str, Any]]:
    """Best-effort parse of `netbird networks list` human output."""
    networks: list[dict[str, Any]] = []
    current: Optional[dict[str, Any]] = None

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.lower().startswith("available"):
            continue

        id_match = NETWORK_ID_LINE_RE.search(line)
        if id_match:
            if current and current.get("id"):
                networks.append(current)
            current = {"id": id_match.group(1), "selected": False, "raw": line}
            continue

        if current is not None:
            status_match = NETWORK_STATUS_RE.search(line)
            if status_match:
                val = status_match.group(1).lower().replace(" ", "")
                current["selected"] = val in ("selected", "true", "yes")
                continue
            # Capture network/domain descriptions when present
            if re.search(r"(?:Network|Domains?)\s*[:=]", line, re.IGNORECASE):
                current["description"] = line
                continue

        # Simple one-line format
        simple = NETWORK_SIMPLE_RE.match(line)
        if simple and not id_match:
            nid = simple.group("id")
            if nid.lower() in ("id", "network", "status", "route", "name"):
                continue
            paren = (simple.group("paren") or "").lower()
            status = (simple.group("status") or "").lower().replace(" ", "")
            selected = "selected" in paren or status == "selected"
            not_selected = "notselected" in paren.replace(" ", "") or status == "notselected"
            if selected or not_selected or paren or status:
                networks.append(
                    {
                        "id": nid,
                        "selected": selected and not not_selected,
                        "raw": line,
                    }
                )

    if current and current.get("id"):
        networks.append(current)

    # Deduplicate by id, prefer later entries
    by_id: dict[str, dict[str, Any]] = {}
    for net in networks:
        by_id[net["id"]] = net
    return list(by_id.values())


class Plugin:
    async def _main(self) -> None:
        decky.logger.info("NetBird plugin loaded")
        binary = _resolve_binary()
        if binary:
            decky.logger.info(f"Found netbird binary at {binary}")
        else:
            decky.logger.warning("netbird binary not found on PATH or known locations")

    async def _unload(self) -> None:
        decky.logger.info("NetBird plugin unloading")

    async def _run(
        self,
        args: list[str],
        timeout: float = 30.0,
        *,
        log_cmd: bool = True,
    ) -> dict[str, Any]:
        binary = _resolve_binary()
        if not binary:
            return {
                "success": False,
                "stdout": "",
                "stderr": "netbird binary not found. Install NetBird on the Steam Deck first.",
                "code": -1,
                "auth_url": None,
            }

        cmd = [binary, *args]
        if log_cmd:
            decky.logger.info(f"Running: {_redact_cmd(cmd)}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "TERM": "dumb"},
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout}s",
                    "code": -2,
                    "auth_url": None,
                }

            stdout = stdout_b.decode("utf-8", errors="replace")
            stderr = stderr_b.decode("utf-8", errors="replace")
            code = proc.returncode if proc.returncode is not None else -1
            combined = f"{stdout}\n{stderr}"
            return {
                "success": code == 0,
                "stdout": stdout,
                "stderr": stderr,
                "code": code,
                "auth_url": _extract_auth_url(combined),
            }
        except Exception as exc:
            decky.logger.error(f"Command failed: {exc}")
            return {
                "success": False,
                "stdout": "",
                "stderr": str(exc),
                "code": -1,
                "auth_url": None,
            }

    def _auth_flags(
        self,
        management_url: Optional[str] = None,
        setup_key: Optional[str] = None,
        no_browser: bool = False,
    ) -> list[str]:
        flags: list[str] = []
        url = (management_url or "").strip()
        if not url:
            url = str(_load_settings().get("management_url") or "").strip()
        if url:
            flags.extend(["--management-url", url])
        key = (setup_key or "").strip()
        if key:
            flags.extend(["--setup-key", key])
        if no_browser:
            flags.append("--no-browser")
        return flags

    async def get_binary_info(self) -> dict[str, Any]:
        binary = _resolve_binary()
        if not binary:
            return {"found": False, "path": None, "version": None}
        result = await self._run(["version"], timeout=10.0)
        version = (result["stdout"] or result["stderr"] or "").strip() or None
        return {"found": True, "path": binary, "version": version}

    async def get_settings(self) -> dict[str, Any]:
        settings = _load_settings()
        return {"management_url": settings.get("management_url", "")}

    async def set_management_url(self, url: str = "") -> dict[str, Any]:
        settings = _load_settings()
        settings["management_url"] = (url or "").strip()
        _save_settings(settings)
        return {"management_url": settings["management_url"]}

    async def status(self, detailed: bool = False) -> dict[str, Any]:
        # Prefer JSON for structured UI
        result = await self._run(["status", "--json"], timeout=10.0)
        parsed: Any = None
        if result["success"] and result["stdout"].strip():
            try:
                parsed = json.loads(result["stdout"])
            except json.JSONDecodeError:
                parsed = None

        detail_text = ""
        if detailed or parsed is None:
            detail = await self._run(["status", "--detail"], timeout=10.0)
            detail_text = detail["stdout"] or detail["stderr"]

        # Also grab a short summary when JSON failed
        if parsed is None and not detail_text:
            summary = await self._run(["status"], timeout=10.0)
            detail_text = summary["stdout"] or summary["stderr"]

        daemon_status = None
        connected = False
        if isinstance(parsed, dict):
            daemon_status = (
                parsed.get("daemonStatus")
                or parsed.get("status")
                or parsed.get("DaemonStatus")
            )
            if isinstance(daemon_status, str):
                connected = daemon_status.lower() == "connected"
            elif parsed.get("management"):
                mgmt = parsed["management"]
                if isinstance(mgmt, dict):
                    connected = str(mgmt.get("connected", "")).lower() in (
                        "true",
                        "connected",
                    )

        return {
            **result,
            "parsed": parsed,
            "detail": detail_text,
            "daemon_status": daemon_status,
            "connected": connected,
        }

    async def up(
        self,
        setup_key: str = "",
        management_url: str = "",
        no_browser: bool = True,
    ) -> dict[str, Any]:
        flags = self._auth_flags(
            management_url=management_url,
            setup_key=setup_key,
            no_browser=no_browser and not (setup_key or "").strip(),
        )
        return await self._run(["up", *flags], timeout=120.0, log_cmd=True)

    async def down(self) -> dict[str, Any]:
        return await self._run(["down"], timeout=30.0)

    async def login(
        self,
        setup_key: str = "",
        management_url: str = "",
        no_browser: bool = True,
    ) -> dict[str, Any]:
        # SSO login needs --no-browser in Gaming Mode; setup-key does not
        use_no_browser = bool(no_browser) and not (setup_key or "").strip()
        flags = self._auth_flags(
            management_url=management_url,
            setup_key=setup_key,
            no_browser=use_no_browser,
        )
        return await self._run(["login", *flags], timeout=120.0, log_cmd=True)

    async def logout(self) -> dict[str, Any]:
        return await self._run(["logout"], timeout=30.0)

    async def networks_list(self) -> dict[str, Any]:
        result = await self._run(["networks", "list"], timeout=15.0)
        networks = _parse_networks_list(result["stdout"] or "")
        # Older alias fallback
        if result["success"] and not networks:
            alt = await self._run(["routes", "list"], timeout=15.0)
            if alt["success"]:
                networks = _parse_networks_list(alt["stdout"] or "")
                result = {**result, "stdout": alt["stdout"], "stderr": alt["stderr"]}
        return {**result, "networks": networks}

    async def networks_select(
        self,
        network_ids: Optional[list[str]] = None,
        append: bool = False,
    ) -> dict[str, Any]:
        ids = network_ids or ["all"]
        cleaned = [str(i).strip() for i in ids if str(i).strip()]
        if not cleaned:
            cleaned = ["all"]
        flags: list[str] = []
        # Default CLI mode is replace; -a appends for per-network toggles
        if append and cleaned != ["all"]:
            flags.append("-a")
        return await self._run(
            ["networks", "select", *flags, *cleaned], timeout=30.0
        )

    async def networks_deselect(
        self, network_ids: Optional[list[str]] = None
    ) -> dict[str, Any]:
        ids = network_ids or ["all"]
        cleaned = [str(i).strip() for i in ids if str(i).strip()]
        if not cleaned:
            cleaned = ["all"]
        return await self._run(["networks", "deselect", *cleaned], timeout=30.0)

    async def run_command(self, args: str = "") -> dict[str, Any]:
        """Run arbitrary netbird subcommand args (no shell)."""
        raw = (args or "").strip()
        if not raw:
            return {
                "success": False,
                "stdout": "",
                "stderr": "No arguments provided",
                "code": -1,
                "auth_url": None,
            }
        if UNSAFE_TOKEN_RE.search(raw):
            return {
                "success": False,
                "stdout": "",
                "stderr": "Shell metacharacters are not allowed",
                "code": -1,
                "auth_url": None,
            }
        try:
            tokens = shlex.split(raw)
        except ValueError as exc:
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Invalid arguments: {exc}",
                "code": -1,
                "auth_url": None,
            }
        if not tokens:
            return {
                "success": False,
                "stdout": "",
                "stderr": "No arguments provided",
                "code": -1,
                "auth_url": None,
            }
        # Prevent users from prefixing with the binary name twice
        if tokens[0].lower() in ("netbird",):
            tokens = tokens[1:]
        if not tokens:
            return {
                "success": False,
                "stdout": "",
                "stderr": "No arguments provided",
                "code": -1,
                "auth_url": None,
            }
        for token in tokens:
            if UNSAFE_TOKEN_RE.search(token):
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": "Shell metacharacters are not allowed",
                    "code": -1,
                    "auth_url": None,
                }
        return await self._run(tokens, timeout=120.0)
