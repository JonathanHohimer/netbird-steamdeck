import asyncio
import json
import os
import platform
import re
import shlex
import shutil
import ssl
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

import decky

try:
    import certifi
except ImportError:  # pragma: no cover - always present under Decky Loader
    certifi = None  # type: ignore

try:
    import aiohttp
except ImportError:  # pragma: no cover
    aiohttp = None  # type: ignore

# Steam Deck–friendly install location (survives OS updates with /home)
OPT_ROOT = Path("/opt/netbird")
OPT_BIN_DIR = OPT_ROOT / "bin"
OPT_BIN = OPT_BIN_DIR / "netbird"
OPT_TMP = OPT_ROOT / "tmp"
PROFILE_D = Path("/etc/profile.d/netbird.sh")
ATOMIC_UPDATE = Path("/etc/atomic-update.conf.d/netbird.conf")
SYSTEMD_UNIT = Path("/etc/systemd/system/netbird.service")
DAEMON_SOCKETS = [
    Path("/var/run/netbird.sock"),
    Path("/run/netbird.sock"),
    Path("/var/run/netbird/netbird.sock"),
    Path("/run/netbird/netbird.sock"),
]

GITHUB_LATEST = "https://api.github.com/repos/netbirdio/netbird/releases/latest"
GITHUB_RELEASE_ASSET = (
    "https://github.com/netbirdio/netbird/releases/download/"
    "v{version}/netbird_{version}_linux_{arch}.tar.gz"
)
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
USER_AGENT = "netbird-steamdeck-decky-plugin/1.1"

BINARY_CANDIDATES = [
    str(OPT_BIN),
    "/usr/bin/netbird",
    "/usr/local/bin/netbird",
    "/opt/netbird/netbird",
    "/home/deck/.local/bin/netbird",
    "/home/linuxbrew/.linuxbrew/bin/netbird",
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
    # Prefer the Steam Deck managed install first
    if OPT_BIN.is_file() and os.access(OPT_BIN, os.X_OK):
        return str(OPT_BIN)
    found = shutil.which("netbird")
    if found:
        return found
    for candidate in BINARY_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _linux_arch() -> str:
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "amd64"
    if machine in ("aarch64", "arm64"):
        return "arm64"
    return "amd64"


def _ssl_context() -> ssl.SSLContext:
    """Build a verify-enabled SSL context that works under Decky Loader.

    Decky’s bundled Python often fails default CA discovery; prefer certifi
    (shipped with the loader), then common system CA bundles.
    """
    candidates: list[str] = []
    if certifi is not None:
        try:
            candidates.append(certifi.where())
        except Exception:
            pass
    candidates.extend(
        [
            "/etc/ssl/certs/ca-certificates.crt",
            "/etc/pki/tls/certs/ca-bundle.crt",
            "/etc/ssl/cert.pem",
            "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
        ]
    )
    for cafile in candidates:
        if cafile and os.path.isfile(cafile):
            try:
                return ssl.create_default_context(cafile=cafile)
            except Exception:
                continue
    return ssl.create_default_context()


async def _http_get_bytes(url: str, timeout: float = 60.0) -> bytes:
    """HTTPS GET with Decky-friendly SSL. Prefers aiohttp when available."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github+json,application/octet-stream,*/*",
    }
    if aiohttp is not None:
        timeout_cfg = aiohttp.ClientTimeout(total=timeout)
        connector = aiohttp.TCPConnector(ssl=_ssl_context())
        async with aiohttp.ClientSession(
            connector=connector,
            timeout=timeout_cfg,
            headers=headers,
        ) as session:
            async with session.get(url, allow_redirects=True) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise RuntimeError(
                        f"HTTP {resp.status} for {url}: {body[:200]}"
                    )
                return await resp.read()

    def _sync() -> bytes:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(
            req, timeout=timeout, context=_ssl_context()
        ) as resp:
            return resp.read()

    return await asyncio.to_thread(_sync)


async def _http_download(url: str, dest: Path, timeout: float = 300.0) -> None:
    data = await _http_get_bytes(url, timeout=timeout)
    dest.write_bytes(data)


async def _latest_version() -> str:
    raw = await _http_get_bytes(GITHUB_LATEST, timeout=30.0)
    data = json.loads(raw.decode("utf-8"))
    tag = str(data.get("tag_name") or "").lstrip("v")
    if not VERSION_RE.match(tag):
        raise RuntimeError(f"Unexpected release tag: {tag!r}")
    return tag


def _normalize_version(version: str) -> str:
    cleaned = (version or "").strip().lstrip("v")
    if not VERSION_RE.match(cleaned):
        raise ValueError(f"Invalid version: {version!r}")
    return cleaned


def _write_steamos_persist_files() -> None:
    PROFILE_D.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_D.write_text(
        "# Managed by NetBird Decky plugin\n"
        "append_path /opt/netbird/bin\n",
        encoding="utf-8",
    )
    try:
        PROFILE_D.chmod(0o644)
    except OSError:
        pass

    ATOMIC_UPDATE.parent.mkdir(parents=True, exist_ok=True)
    ATOMIC_UPDATE.write_text(
        "# Managed by NetBird Decky plugin — keep across SteamOS updates\n"
        "/etc/profile.d/netbird.sh\n",
        encoding="utf-8",
    )
    try:
        ATOMIC_UPDATE.chmod(0o644)
    except OSError:
        pass


def _clean_subprocess_env() -> dict[str, str]:
    """Env for system binaries — Drop Decky/PyInstaller OpenSSL from LD_LIBRARY_PATH.

    Decky Loader sets LD_LIBRARY_PATH to its /tmp/_MEI* bundle. That makes
    netbird/systemctl fail with libcrypto.so.3 / OPENSSL_ version errors.
    """
    env = {k: v for k, v in os.environ.items() if k not in (
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "LD_AUDIT",
    )}
    env["TERM"] = "dumb"
    # Prefer system OpenSSL / certs for child processes
    if "SSL_CERT_FILE" not in env and certifi is not None:
        try:
            env["SSL_CERT_FILE"] = certifi.where()
        except Exception:
            pass
    return env


def _install_log_path() -> Path:
    return Path(decky.DECKY_PLUGIN_RUNTIME_DIR) / "last_install.log"


def _save_install_log(text: str) -> None:
    try:
        path = _install_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text or "", encoding="utf-8")
    except Exception as exc:
        decky.logger.warning(f"Could not save install log: {exc}")


def _load_install_log() -> str:
    path = _install_log_path()
    try:
        if path.is_file():
            return path.read_text(encoding="utf-8")
    except Exception:
        pass
    return ""


async def _run_system(
    cmd: list[str], timeout: float = 60.0
) -> dict[str, Any]:
    decky.logger.info(f"System: {' '.join(cmd)}")
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_clean_subprocess_env(),
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
                "stderr": f"Timed out after {timeout}s",
                "code": -2,
            }
        stdout = stdout_b.decode("utf-8", errors="replace")
        stderr = stderr_b.decode("utf-8", errors="replace")
        code = proc.returncode if proc.returncode is not None else -1
        return {
            "success": code == 0,
            "stdout": stdout,
            "stderr": stderr,
            "code": code,
        }
    except Exception as exc:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(exc),
            "code": -1,
        }


async def _systemctl_is_active(unit: str = "netbird.service") -> bool:
    result = await _run_system(["systemctl", "is-active", unit], timeout=10.0)
    state = (result["stdout"] or "").strip()
    return state == "active"


async def _systemctl_is_enabled(unit: str = "netbird.service") -> bool:
    result = await _run_system(["systemctl", "is-enabled", unit], timeout=10.0)
    state = (result["stdout"] or "").strip()
    return state in ("enabled", "enabled-runtime", "static", "indirect")


def _daemon_socket_exists() -> bool:
    return any(path.exists() for path in DAEMON_SOCKETS)


def _daemon_unreachable_text(text: str) -> bool:
    lower = text.lower()
    return any(
        needle in lower
        for needle in (
            "failed to connect to daemon",
            "daemon is not running",
            "connection refused",
            "dial unix",
            "no such file or directory",
        )
    )


def _extract_auth_url(text: str) -> Optional[str]:
    if not text:
        return None
    matches = AUTH_URL_RE.findall(text)
    for url in matches:
        # Prefer SSO / login style URLs; fall back to first http(s) URL
        lower = url.lower()
        if any(
            k in lower
            for k in (
                "login",
                "sso",
                "auth",
                "oauth",
                "netbird",
                "authorize",
                "device",
                "user_code",
            )
        ):
            return url.rstrip(").,]}'\"")
    return matches[0].rstrip(").,]}'\"") if matches else None


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
                "stderr": "netbird binary not found. Use Install in the plugin to install NetBird under /opt/netbird.",
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
                env=_clean_subprocess_env(),
            )
            timed_out = False
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                timed_out = True
                proc.kill()
                stdout_b, stderr_b = await proc.communicate()

            stdout = stdout_b.decode("utf-8", errors="replace")
            stderr = stderr_b.decode("utf-8", errors="replace")
            code = proc.returncode if proc.returncode is not None else -1
            combined = f"{stdout}\n{stderr}"
            auth_url = _extract_auth_url(combined)
            if timed_out:
                return {
                    "success": False,
                    "stdout": stdout,
                    "stderr": (
                        f"Command timed out after {timeout}s"
                        + (f"\n{stderr}" if stderr else "")
                    ),
                    "code": -2,
                    "auth_url": auth_url,
                }
            return {
                "success": code == 0,
                "stdout": stdout,
                "stderr": stderr,
                "code": code,
                "auth_url": auth_url,
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

    async def _run_until_auth_url(
        self,
        args: list[str],
        *,
        url_timeout: float = 45.0,
        wait_after_url: float = 180.0,
    ) -> dict[str, Any]:
        """Run a NetBird command that prints an SSO URL then blocks.

        Returns as soon as a URL is seen (keeping the process alive so the
        daemon can finish login), or when the process exits / times out.
        """
        binary = _resolve_binary()
        if not binary:
            return {
                "success": False,
                "stdout": "",
                "stderr": "netbird binary not found. Use Install in the plugin first.",
                "code": -1,
                "auth_url": None,
            }

        cmd = [binary, *args]
        decky.logger.info(f"Running (SSO wait): {_redact_cmd(cmd)}")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_clean_subprocess_env(),
        )
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        auth_url: Optional[str] = None
        deadline = asyncio.get_running_loop().time() + url_timeout

        async def _pump(stream, bucket: list[str]) -> None:
            nonlocal auth_url
            assert stream is not None
            while True:
                line_b = await stream.readline()
                if not line_b:
                    break
                line = line_b.decode("utf-8", errors="replace")
                bucket.append(line)
                if auth_url is None:
                    found = _extract_auth_url(line)
                    if found:
                        auth_url = found

        pump_out = asyncio.create_task(_pump(proc.stdout, stdout_parts))
        pump_err = asyncio.create_task(_pump(proc.stderr, stderr_parts))

        try:
            while auth_url is None and proc.returncode is None:
                if asyncio.get_running_loop().time() >= deadline:
                    break
                await asyncio.sleep(0.15)

            stdout = "".join(stdout_parts)
            stderr = "".join(stderr_parts)
            if auth_url is None:
                auth_url = _extract_auth_url(f"{stdout}\n{stderr}")

            if auth_url and proc.returncode is None:
                # Keep waiting for login completion in the background.
                async def _finish_wait() -> None:
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=wait_after_url)
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                    finally:
                        await asyncio.gather(pump_out, pump_err, return_exceptions=True)

                asyncio.create_task(_finish_wait())
                return {
                    "success": False,
                    "stdout": stdout,
                    "stderr": stderr,
                    "code": 0,
                    "auth_url": auth_url,
                    "pending_sso": True,
                }

            await asyncio.gather(pump_out, pump_err, return_exceptions=True)
            if proc.returncode is None:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            code = proc.returncode if proc.returncode is not None else -1
            return {
                "success": code == 0,
                "stdout": "".join(stdout_parts),
                "stderr": "".join(stderr_parts),
                "code": code,
                "auth_url": auth_url,
                "pending_sso": False,
            }
        except Exception as exc:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            decky.logger.error(f"SSO command failed: {exc}")
            return {
                "success": False,
                "stdout": "".join(stdout_parts),
                "stderr": str(exc),
                "code": -1,
                "auth_url": auth_url,
                "pending_sso": False,
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
        managed = OPT_BIN.is_file()
        is_root = os.geteuid() == 0
        unit_present = SYSTEMD_UNIT.is_file()
        service_active = await _systemctl_is_active("netbird.service")
        if not service_active:
            service_active = await _systemctl_is_active("netbird")
        service_enabled = await _systemctl_is_enabled("netbird.service")
        if not service_enabled:
            service_enabled = await _systemctl_is_enabled("netbird")

        # Daemon may be running even if systemctl reporting is flaky from Decky
        daemon_socket = _daemon_socket_exists()
        daemon_reachable = False
        if binary:
            status_probe = await self._run(["status"], timeout=8.0)
            probe_text = f"{status_probe['stdout']}\n{status_probe['stderr']}"
            daemon_reachable = not _daemon_unreachable_text(probe_text) and bool(
                (status_probe["stdout"] or status_probe["stderr"] or "").strip()
            )

        # Treat daemon reply / socket as "service active" for UI purposes
        if daemon_reachable or daemon_socket:
            service_active = True

        if not binary:
            return {
                "found": False,
                "path": None,
                "version": None,
                "managed": False,
                "service_active": service_active,
                "service_enabled": service_enabled,
                "unit_present": unit_present,
                "daemon_socket": daemon_socket,
                "daemon_reachable": daemon_reachable,
                "opt_path": str(OPT_BIN),
                "is_root": is_root,
                "uid": os.geteuid(),
            }
        result = await self._run(["version"], timeout=10.0)
        version = (result["stdout"] or result["stderr"] or "").strip() or None
        return {
            "found": True,
            "path": binary,
            "version": version,
            "managed": managed,
            "service_active": service_active,
            "service_enabled": service_enabled,
            "unit_present": unit_present,
            "daemon_socket": daemon_socket,
            "daemon_reachable": daemon_reachable,
            "opt_path": str(OPT_BIN),
            "is_root": is_root,
            "uid": os.geteuid(),
        }

    async def get_install_status(self) -> dict[str, Any]:
        info = await self.get_binary_info()
        latest: Optional[str] = None
        latest_error: Optional[str] = None
        try:
            latest = await _latest_version()
        except Exception as exc:
            latest_error = str(exc)
        return {
            **info,
            "latest": latest,
            "latest_error": latest_error,
            "update_available": bool(
                latest
                and info.get("version")
                and latest not in str(info.get("version"))
            ),
            "last_install_log": _load_install_log(),
        }

    async def install_netbird(self, version: str = "") -> dict[str, Any]:
        """Install or update NetBird under /opt/netbird for SteamOS persistence."""
        logs: list[str] = []

        def _finish(**kwargs: Any) -> dict[str, Any]:
            message = str(kwargs.get("message") or "\n".join(logs))
            stderr = str(kwargs.get("stderr") or "")
            full = "\n\n".join(part for part in (message, stderr) if part)
            _save_install_log(full)
            kwargs["message"] = message
            return kwargs

        try:
            if os.geteuid() != 0:
                return _finish(
                    success=False,
                    version=None,
                    path=None,
                    message="\n".join(logs),
                    stderr=(
                        "Permission denied writing /opt/netbird: plugin is not running as root "
                        f"(uid={os.geteuid()}). Reinstall the plugin zip so plugin.json has "
                        '"flags": ["root"], then restart Decky / PluginLoader.'
                    ),
                )

            if version.strip():
                ver = _normalize_version(version)
            else:
                logs.append("Resolving latest GitHub release…")
                ver = await _latest_version()
            logs.append(f"Installing NetBird v{ver}")

            arch = _linux_arch()
            url = GITHUB_RELEASE_ASSET.format(version=ver, arch=arch)
            logs.append(f"Downloading {url}")

            try:
                OPT_BIN_DIR.mkdir(parents=True, exist_ok=True)
                if OPT_TMP.exists():
                    shutil.rmtree(OPT_TMP, ignore_errors=True)
                OPT_TMP.mkdir(parents=True, exist_ok=True)
            except PermissionError as exc:
                return _finish(
                    success=False,
                    version=ver,
                    path=None,
                    message="\n".join(logs),
                    stderr=(
                        f"Permission denied creating {OPT_ROOT}: {exc}. "
                        'Ensure plugin.json includes "flags": ["root"] and reinstall/reload the plugin.'
                    ),
                )

            archive = OPT_TMP / f"netbird_{ver}_linux_{arch}.tar.gz"
            await _http_download(url, archive, timeout=300.0)
            logs.append(f"Downloaded {archive.name} ({archive.stat().st_size} bytes)")

            def _extract() -> str:
                with tarfile.open(archive, "r:gz") as tar:
                    # Find netbird binary member
                    member = None
                    for m in tar.getmembers():
                        name = Path(m.name).name
                        if name == "netbird" and m.isfile():
                            member = m
                            break
                    if member is None:
                        raise RuntimeError("Archive does not contain netbird binary")
                    with tempfile.TemporaryDirectory(dir=str(OPT_TMP)) as tmp:
                        try:
                            tar.extract(member, path=tmp, filter="data")
                        except TypeError:
                            # Python < 3.12
                            tar.extract(member, path=tmp)
                        extracted = Path(tmp) / member.name
                        # tar may nest paths
                        if not extracted.is_file():
                            matches = list(Path(tmp).rglob("netbird"))
                            if not matches:
                                raise RuntimeError("Failed to extract netbird binary")
                            extracted = matches[0]
                        staging = OPT_BIN_DIR / f".netbird.new.{os.getpid()}"
                        shutil.copy2(extracted, staging)
                        os.chmod(staging, 0o755)
                        staging.replace(OPT_BIN)
                return str(OPT_BIN)

            binary_path = await asyncio.to_thread(_extract)
            logs.append(f"Installed binary to {binary_path}")

            _write_steamos_persist_files()
            logs.append(f"Wrote {PROFILE_D} and {ATOMIC_UPDATE}")

            # Stop existing service before reinstalling unit (best effort)
            await _run_system(
                [str(OPT_BIN), "service", "stop"], timeout=30.0
            )
            uninstall = await _run_system(
                [str(OPT_BIN), "service", "uninstall"], timeout=30.0
            )
            if uninstall["stdout"] or uninstall["stderr"]:
                logs.append(
                    "service uninstall:\n"
                    f"{(uninstall['stdout'] or '').strip()}\n"
                    f"{(uninstall['stderr'] or '').strip()}".strip()
                )

            install = await _run_system(
                [str(OPT_BIN), "service", "install"], timeout=60.0
            )
            logs.append(
                f"service install: exit {install['code']}\n"
                f"{(install['stdout'] or '').strip()}\n"
                f"{(install['stderr'] or '').strip()}".strip()
            )

            # NetBird may return non-zero even when the unit lands; continue if present.
            await _run_system(["systemctl", "daemon-reload"], timeout=30.0)
            unit_ok = SYSTEMD_UNIT.is_file()
            if not install["success"] and not unit_ok:
                return _finish(
                    success=False,
                    version=ver,
                    path=binary_path,
                    message="\n".join(logs),
                    stderr=install["stderr"]
                    or install["stdout"]
                    or "service install failed and no unit file was created",
                )
            if not install["success"] and unit_ok:
                logs.append(
                    f"service install reported failure, but {SYSTEMD_UNIT} exists — continuing"
                )

            # Force enable + start via systemctl (more reliable than service helpers on Deck)
            enable = await _run_system(
                ["systemctl", "enable", "--now", "netbird.service"], timeout=60.0
            )
            logs.append(
                f"systemctl enable --now: exit {enable['code']}\n"
                f"{(enable['stdout'] or '').strip()}\n"
                f"{(enable['stderr'] or '').strip()}".strip()
            )
            if not enable["success"]:
                # Retry as separate steps
                enable_only = await _run_system(
                    ["systemctl", "enable", "netbird.service"], timeout=30.0
                )
                logs.append(
                    f"systemctl enable: exit {enable_only['code']}\n"
                    f"{(enable_only['stdout'] or enable_only['stderr'] or '').strip()}"
                )
                start = await _run_system(
                    ["systemctl", "start", "netbird.service"], timeout=60.0
                )
                if not start["success"]:
                    start = await _run_system(
                        [str(OPT_BIN), "service", "start"], timeout=60.0
                    )
                logs.append(
                    f"service start: exit {start['code']}\n"
                    f"{(start['stdout'] or '').strip()}\n"
                    f"{(start['stderr'] or '').strip()}".strip()
                )
            else:
                start = enable

            # Cleanup download temp
            shutil.rmtree(OPT_TMP, ignore_errors=True)

            # Brief settle time for the socket to appear
            await asyncio.sleep(1.0)
            info = await self.get_binary_info()
            ok = bool(
                start.get("success")
                or info.get("service_active")
                or info.get("daemon_reachable")
                or SYSTEMD_UNIT.is_file()
            )
            return _finish(
                success=ok,
                version=ver,
                path=binary_path,
                message="\n".join(logs),
                stderr=""
                if ok
                else (start.get("stderr") or start.get("stdout") or enable.get("stderr") or ""),
                install=info,
            )
        except urllib.error.HTTPError as exc:
            msg = f"HTTP {exc.code} while downloading NetBird: {exc.reason}"
            decky.logger.error(msg)
            return _finish(
                success=False,
                version=None,
                path=None,
                message="\n".join(logs),
                stderr=msg,
            )
        except Exception as exc:
            decky.logger.error(f"install_netbird failed: {exc}")
            return _finish(
                success=False,
                version=None,
                path=None,
                message="\n".join(logs),
                stderr=str(exc),
            )

    async def update_netbird(self) -> dict[str, Any]:
        return await self.install_netbird("")

    async def uninstall_netbird(self) -> dict[str, Any]:
        logs: list[str] = []
        binary = _resolve_binary() or (str(OPT_BIN) if OPT_BIN.is_file() else None)
        try:
            if binary:
                await _run_system([binary, "down"], timeout=30.0)
                stop = await _run_system([binary, "service", "stop"], timeout=30.0)
                logs.append(f"service stop: exit {stop['code']}")
                un = await _run_system(
                    [binary, "service", "uninstall"], timeout=30.0
                )
                logs.append(
                    f"service uninstall: exit {un['code']} "
                    f"{(un['stdout'] or un['stderr'] or '').strip()}"
                )

            # Fallback cleanup if unit remains
            await _run_system(
                ["systemctl", "disable", "--now", "netbird.service"], timeout=30.0
            )
            if SYSTEMD_UNIT.is_file():
                try:
                    SYSTEMD_UNIT.unlink()
                    logs.append(f"Removed {SYSTEMD_UNIT}")
                except OSError as exc:
                    logs.append(f"Could not remove unit: {exc}")
                await _run_system(["systemctl", "daemon-reload"], timeout=30.0)

            for path in (PROFILE_D, ATOMIC_UPDATE):
                if path.is_file():
                    try:
                        path.unlink()
                        logs.append(f"Removed {path}")
                    except OSError as exc:
                        logs.append(f"Could not remove {path}: {exc}")

            if OPT_ROOT.exists():
                shutil.rmtree(OPT_ROOT, ignore_errors=True)
                logs.append(f"Removed {OPT_ROOT}")

            return {
                "success": not OPT_BIN.is_file(),
                "message": "\n".join(logs) or "Uninstalled",
                "stderr": "",
            }
        except Exception as exc:
            decky.logger.error(f"uninstall_netbird failed: {exc}")
            return {
                "success": False,
                "message": "\n".join(logs),
                "stderr": str(exc),
            }

    async def service_start(self) -> dict[str, Any]:
        await _run_system(["systemctl", "daemon-reload"], timeout=20.0)
        enable = await _run_system(
            ["systemctl", "enable", "--now", "netbird.service"], timeout=60.0
        )
        if enable["success"]:
            return enable
        binary = _resolve_binary()
        if binary:
            result = await self._run(["service", "start"], timeout=60.0)
            if result["success"]:
                return result
        start = await _run_system(
            ["systemctl", "start", "netbird.service"], timeout=60.0
        )
        return start

    async def service_stop(self) -> dict[str, Any]:
        binary = _resolve_binary()
        if binary:
            result = await self._run(["service", "stop"], timeout=60.0)
            if result["success"]:
                return result
        return await _run_system(
            ["systemctl", "stop", "netbird.service"], timeout=60.0
        )

    async def service_enable(self) -> dict[str, Any]:
        await _run_system(["systemctl", "daemon-reload"], timeout=20.0)
        return await _run_system(
            ["systemctl", "enable", "--now", "netbird.service"], timeout=60.0
        )

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
        use_no_browser = no_browser and not (setup_key or "").strip()
        flags = self._auth_flags(
            management_url=management_url,
            setup_key=setup_key,
            no_browser=use_no_browser,
        )
        if use_no_browser:
            return await self._run_until_auth_url(["up", *flags])
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
        if use_no_browser:
            # Prefer `up` so we connect after SSO; stream until URL appears
            result = await self._run_until_auth_url(["up", *flags])
            if result.get("auth_url"):
                return result
            # Fallback to login verb
            return await self._run_until_auth_url(["login", *flags])
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
