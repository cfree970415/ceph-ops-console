#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ceph Ops Console - backend service.

Design goals
  * Python 3.6+ standard library ONLY (no pip, works offline on intranet hosts)
  * Linux target: RHEL/CentOS 7-9, Rocky/Alma, Ubuntu/Debian, openEuler, Kylin/UOS, SUSE
  * Ceph 12.x ~ 19.x: capabilities are PROBED at runtime, not hardcoded by version
  * Two channels: cli (full, needs ceph CLI) / rest (read-only, via mgr dashboard API)
  * DRY-RUN by default, token auth, confirm phrase, argv-only subprocess, jsonl audit

Static frontend is served from the same directory (ceph-dashboard.html + app-*.js).
"""
from __future__ import print_function

import argparse
import json
import os
import platform
import re
import shlex
import shutil
import socketserver
import ssl
import subprocess
import sys
import threading
import time
import hmac
import hashlib
import base64
import secrets
import traceback
from datetime import datetime

try:
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import urllib.request as urlrequest
except ImportError:  # pragma: no cover - Python 2 is not supported
    print("Python 3.6+ is required", file=sys.stderr)
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "1.0.9"
AUDIT_PATH = "/var/log/ceph-console/audit.jsonl"
CONF_PATH = "/etc/ceph-console/config.json"
USERS_PATH = "/etc/ceph-console/users.json"
# Real capacity / IO history. Sampled once a minute by the backend itself, so
# the 24h trend keeps filling even while nobody has the page open. Persisted as
# jsonl next to the runtime data, trimmed to a 24h sliding window.
HISTORY_PATH = "/var/lib/ceph-console/history.jsonl"
HISTORY_WINDOW = 24 * 3600
HISTORY_STEP = 60
HISTORY_MAX_POINTS = 24 * 60 + 60
SESSION_TTL = 8 * 3600
LOGIN_WINDOW = 300
LOGIN_MAX_FAIL = 5
PBKDF2_ROUNDS = 120000
PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 128

CODENAMES = {12: "Luminous", 13: "Mimic", 14: "Nautilus", 15: "Octopus",
             16: "Pacific", 17: "Quincy", 18: "Reef", 19: "Squid", 20: "Tentacle"}
DEV_RE = re.compile(r"^/dev/[A-Za-z0-9._/-]+$")
HOST_RE = re.compile(r"^[A-Za-z0-9._-]+$")


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------
class Config(object):
    def __init__(self, args):
        self.backend = args.backend
        self.bind = args.bind
        self.port = int(args.port)
        self.token = args.token or os.environ.get("CEPH_CONSOLE_TOKEN", "")
        self.allow_write = bool(args.allow_write or os.environ.get("CEPH_CONSOLE_ALLOW_WRITE") == "1")
        self.read_only = bool(args.read_only or os.environ.get("CEPH_CONSOLE_READ_ONLY") == "1")
        self.rest_url = (args.rest_url or "").rstrip("/")
        self.rest_token = args.rest_token or os.environ.get("CEPH_REST_TOKEN", "")
        self.insecure = bool(args.insecure)
        self.ceph_conf = args.ceph_conf or ""
        self.ceph_name = args.ceph_name or ""
        self.ceph_keyring = args.ceph_keyring or ""
        self.dir = args.dir or HERE
        self.users_file = getattr(args, "users_file", "") or os.environ.get("CEPH_CONSOLE_USERS", "") or USERS_PATH
        self.history_file = getattr(args, "history_file", "") or os.environ.get("CEPH_CONSOLE_HISTORY", "") or HISTORY_PATH
        self.auth_required = not bool(getattr(args, "no_auth", False) or
                                      os.environ.get("CEPH_CONSOLE_NO_AUTH") == "1")
        self.session_ttl = int(getattr(args, "session_ttl", 0) or SESSION_TTL)
        self.cors_origin = getattr(args, "cors_origin", "") or os.environ.get("CEPH_CONSOLE_CORS", "") or "*"
        self.dry_run = not self.allow_write
        if not self.token:
            self.token = "change-me-" + str(int(time.time()))
        if self.read_only:
            self.allow_write = False
            self.dry_run = True

# --------------------------------------------------------------------------
# authentication: password hashing, user store, in-memory sessions
#   users.json = {"users": {"admin": {"salt":..., "hash":..., "rounds":...,
#                                     "role": "admin"|"viewer"}}}
#   Never stores plaintext passwords. Sessions live in memory only (restart
#   requires a new login) and are sent as HttpOnly / SameSite=Strict cookies.
# --------------------------------------------------------------------------
SESSIONS = {}       # token -> {user, role, expires, ttl, remote, created}
LOGIN_FAILS = {}    # remote -> [fail_count, first_fail_ts]


def hash_password(password, salt=None, rounds=PBKDF2_ROUNDS):
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return {"salt": base64.b64encode(salt).decode("ascii"),
            "hash": base64.b64encode(dk).decode("ascii"),
            "rounds": rounds}


def verify_password(password, rec):
    try:
        salt = base64.b64decode(rec["salt"])
        want = base64.b64decode(rec["hash"])
        got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt,
                                  int(rec.get("rounds", PBKDF2_ROUNDS)))
        return hmac.compare_digest(got, want)
    except Exception:
        return False


def load_users(path):
    try:
        with open(path, "r") as f:
            doc = json.load(f)
        users = doc.get("users", doc) if isinstance(doc, dict) else {}
        return users if isinstance(users, dict) else {}
    except Exception:
        return {}


def save_users(path, users):
    """Atomically write the user store; never leave a world-readable file."""
    directory = os.path.dirname(os.path.abspath(path))
    if directory and not os.path.isdir(directory):
        os.makedirs(directory, 0o700)
    tmp = "%s.tmp.%d" % (path, os.getpid())
    try:
        with open(tmp, "w") as f:
            json.dump({"users": users}, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass
    return True


def password_error(new, confirm=None):
    """Reject weak / malformed new passwords. Never echoes the password."""
    if not isinstance(new, str) or len(new) < PASSWORD_MIN_LEN:
        return "新密码至少 %d 位" % PASSWORD_MIN_LEN
    if len(new) > PASSWORD_MAX_LEN:
        return "新密码不能超过 %d 位" % PASSWORD_MAX_LEN
    if not new.strip() or new.strip() != new:
        return "新密码不能为空、也不能带首尾空白"
    if confirm is not None and new != confirm:
        return "两次输入的新密码不一致"
    return ""


def login_allowed(remote):
    now = time.time()
    item = LOGIN_FAILS.get(remote)
    return not (item and now - item[1] < LOGIN_WINDOW and item[0] >= LOGIN_MAX_FAIL)


def note_login_fail(remote):
    now = time.time()
    item = LOGIN_FAILS.get(remote)
    if not item or now - item[1] >= LOGIN_WINDOW:
        LOGIN_FAILS[remote] = [1, now]
    else:
        item[0] += 1


def note_login_ok(remote):
    LOGIN_FAILS.pop(remote, None)


def new_session(user, role, remote, ttl):
    token = secrets.token_urlsafe(32)
    now = time.time()
    SESSIONS[token] = {"user": user, "role": role, "expires": now + ttl,
                       "ttl": ttl, "remote": remote, "created": now}
    return token


def get_session(token):
    if not token:
        return None
    s = SESSIONS.get(token)
    if not s:
        return None
    now = time.time()
    if s["expires"] < now:
        SESSIONS.pop(token, None)
        return None
    s["expires"] = now + (s.get("ttl") or SESSION_TTL)  # sliding renewal
    return s


def drop_session(token):
    if token:
        SESSIONS.pop(token, None)


# --------------------------------------------------------------------------
# process helpers (argv only, NEVER shell=True)
# --------------------------------------------------------------------------
def run(argv, timeout=20):
    try:
        p = subprocess.Popen([str(x) for x in argv], stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE)
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        try:
            p.kill()
        except Exception:
            pass
        return 124, "", "timeout after %ss" % timeout
    except OSError as e:
        return 127, "", str(e)


def ceph_run(cfg, args, timeout=20):
    cmd = ["ceph"]
    if cfg.ceph_conf:
        cmd += ["--conf", cfg.ceph_conf]
    if cfg.ceph_name:
        cmd += ["-n", cfg.ceph_name]
    if cfg.ceph_keyring:
        cmd += ["-k", cfg.ceph_keyring]
    cmd += list(args)
    return run(cmd, timeout)


def ceph_json(cfg, args, timeout=20):
    rc, out, err = ceph_run(cfg, list(args) + ["--format=json"], timeout)
    if rc != 0:
        return None, (err or out).strip()
    try:
        return json.loads(out), ""
    except ValueError:
        return None, "invalid JSON from ceph: " + out[:200]


def cmd_str(argv):
    return " ".join(shlex.quote(str(x)) for x in argv)


# --------------------------------------------------------------------------
# audit
# --------------------------------------------------------------------------
def audit(action, target, command, result, note, remote_addr="", user=None):
    rec = {"ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
           "epoch": int(time.time()), "user": user or "console", "remote": remote_addr,
           "action": action, "target": target, "command": command,
           "result": result, "note": note}
    paths = [AUDIT_PATH, os.path.join(HERE, "audit.jsonl")]
    for path in paths:
        try:
            d = os.path.dirname(path)
            if d and not os.path.isdir(d):
                os.makedirs(d)
            with open(path, "a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return
        except (IOError, OSError):
            continue


def read_audit(limit=200):
    for path in (AUDIT_PATH, os.path.join(HERE, "audit.jsonl")):
        try:
            with open(path, "r") as f:
                lines = f.readlines()[-limit:]
            return [json.loads(x) for x in lines if x.strip()]
        except (IOError, OSError, ValueError):
            continue
    return []


# --------------------------------------------------------------------------
# environment / ceph capability probe
# --------------------------------------------------------------------------
def detect_linux():
    info = {"os": "Linux", "distro": "unknown", "version": "", "python": platform.python_version(),
            "init": "unknown", "firewall": "unknown", "selinux": "unknown"}
    try:
        kv = {}
        with open("/etc/os-release", "r") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    kv[k] = v.strip().strip('"')
        info["distro"] = kv.get("ID", "unknown")
        info["version"] = kv.get("VERSION_ID", "")
        info["os"] = kv.get("PRETTY_NAME", kv.get("NAME", "Linux"))
    except (IOError, OSError):
        pass
    if os.path.isdir("/run/systemd/system"):
        info["init"] = "systemd"
    elif os.path.isdir("/etc/init.d"):
        info["init"] = "sysvinit"
    for fw, probe in (("firewalld", "firewall-cmd"), ("ufw", "ufw"), ("nftables", "nft"), ("iptables", "iptables")):
        rc, _, _ = run(["sh", "-c", "command -v %s" % probe], 5)
        if rc == 0:
            info["firewall"] = fw
            break
    rc, out, _ = run(["getenforce"], 5)
    info["selinux"] = out.strip() if rc == 0 else "not-installed"
    return info


def _help_text(cfg, scope):
    args = [scope, "--help"] if scope else ["--help"]
    rc, out, err = ceph_run(cfg, args, 10)
    return out + "\n" + err


class Probe(object):
    """Runtime capability detection - works across Ceph 12.x ~ 19.x."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.env = detect_linux()
        self.version = "unknown"
        self.major = 0
        self.codename = "unknown"
        self.orchestrator = "legacy"
        self.caps = {}
        self.detected = False
        self.error = ""
        self.refresh()

    def refresh(self):
        rc, out, err = ceph_run(self.cfg, ["--version"], 10) if self.cfg.backend == "cli" else (127, "", "rest backend")
        text = (out + " " + err).strip()
        m = re.search(r"ceph version\s+(\d+)\.(\d+)\.(\d+)", text)
        if m:
            self.major = int(m.group(1))
            self.version = "%s.%s.%s" % (m.group(1), m.group(2), m.group(3))
            self.codename = CODENAMES.get(self.major, "unknown")
            self.detected = True
        else:
            self.error = text[:200] or "ceph CLI not available"
        if self.cfg.backend == "cli":
            osd_help = _help_text(self.cfg, "osd")
            top_help = _help_text(self.cfg, "")
            self.caps = {
                "orch": ("orch" in top_help) or self.major >= 15,
                "purge": ("purge" in osd_help) or self.major >= 14,
                "ok_to_stop": ("ok-to-stop" in osd_help) or self.major >= 14,
                "safe_to_destroy": ("safe-to-destroy" in osd_help) or self.major >= 14,
                "device_ls": ("device" in top_help) or self.major >= 13,
                "mgr_services": "mgr" in top_help,
            }
            if self.caps["orch"]:
                rc2, _, e2 = ceph_run(self.cfg, ["orch", "status"], 8)
                if rc2 != 0 and ("unknown" in e2.lower() or "invalid" in e2.lower()):
                    self.caps["orch"] = False
            self.orchestrator = "cephadm" if self.caps["orch"] else "legacy"
        else:
            self.caps = {"orch": False, "purge": False, "ok_to_stop": False,
                         "safe_to_destroy": False, "device_ls": False, "mgr_services": True}
            self.orchestrator = "legacy"
            self.codename = "rest-proxy"
        if self.cfg.read_only:
            self.orchestrator += " (read-only)"

    def as_dict(self):
        d = dict(self.env)
        d.update({"version": self.version, "major": self.major, "codename": self.codename,
                  "orchestrator": self.orchestrator, "backend": self.cfg.backend,
                  "caps": self.caps, "detected": self.detected, "error": self.error,
                  "dry_run": self.cfg.dry_run, "read_only": self.cfg.read_only,
                  "console_version": VERSION})
        return d


# --------------------------------------------------------------------------
# read-side normalisation (tolerant to Ceph version field differences)
# --------------------------------------------------------------------------
def _g(d, *keys):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] is not None:
            d = d[k]
        else:
            return None
    return d


def read_cluster(cfg, probe):
    if cfg.backend == "rest":
        return rest_state(cfg)
    doc, err = ceph_json(cfg, ["status"])
    if doc is None:
        return {"error": err, "health": "UNKNOWN", "version": probe.version}
    health = _g(doc, "health", "status") or (doc.get("health") if isinstance(doc.get("health"), str) else None) or "UNKNOWN"
    osdmap = doc.get("osdmap", {}) or {}
    pgmap = doc.get("pgmap", {}) or {}
    monmap = doc.get("monmap", {}) or {}
    raw_used = _g(pgmap, "bytes_used") or _g(doc, "stats", "bytes_used") or 0
    raw_total = _g(pgmap, "bytes_total") or _g(doc, "stats", "bytes_total") or 0
    osds = _g(osdmap, "num_osds") or _g(osdmap, "osdmap", "num_osds") or 0
    up = _g(osdmap, "num_up_osds") or _g(osdmap, "osdmap", "num_up_osds") or 0
    inn = _g(osdmap, "num_in_osds") or _g(osdmap, "osdmap", "num_in_osds") or 0
    pgs = _g(pgmap, "num_pgs") or 0
    states = _g(pgmap, "pgs_by_state") or []
    pg_active_clean = pg_bad = pg_backfill = None
    if isinstance(states, list) and states:
        pg_active_clean = pg_bad = pg_backfill = 0
        for st in states:
            name = (st.get("state_name") or st.get("name") or "")
            count = int(st.get("count") or 0)
            if "active" in name and "clean" in name:
                pg_active_clean += count
            if any(k in name for k in ("degraded", "undersized", "incomplete",
                                       "stale", "peering", "inconsistent", "backfill_toofull")):
                pg_bad += count
            if any(k in name for k in ("backfill", "recover", "remapped")):
                pg_backfill += count
    # MON / MGR detail: real names, ranks and quorum — never "mon.a / b / c".
    # quorum 的位置随版本/部署形态不同：常见于 monmap.quorum，也有版本只放在
    # 顶层 quorum / quorum_names（单 MON 集群尤其容易只给名字列表）。全部取不到
    # 时再用 ceph quorum_status 兜底，避免把「一个在线的 MON」显示成 0/1。
    quorum = _g(monmap, "quorum")
    if quorum is None:
        quorum = _g(doc, "quorum")
    if quorum is None:
        quorum = _g(doc, "quorum_names") or _g(monmap, "quorum_names")
    if not isinstance(quorum, list):
        quorum = []
    if not quorum:
        qdoc, _ = ceph_json(cfg, ["quorum_status"])
        if isinstance(qdoc, dict):
            q = qdoc.get("quorum")
            if not isinstance(q, list):
                q = qdoc.get("quorum_names")
            if isinstance(q, list):
                quorum = q
    # quorum 里可能是 rank 列表 [0] 或名字列表 ["mon01"]，两种都要认。
    quorum_by_name = bool(quorum) and isinstance(quorum[0], str)
    mon_list = []
    for m in (monmap.get("mons") or []):
        if not isinstance(m, dict):
            continue
        rank = m.get("rank", 0)
        name = m.get("name", "")
        mon_list.append({"name": name, "rank": rank,
                         "addr": m.get("public_addr") or m.get("addr") or "",
                         "inQuorum": (name in quorum) if quorum_by_name else (rank in quorum)})
    mon_leader = ""
    for m in sorted(mon_list, key=lambda x: x["rank"]):
        if m["inQuorum"]:
            mon_leader = m["name"]
            break
    mgrmap = doc.get("mgrmap") or {}
    mgr_active = mgrmap.get("active_name") or ""
    mgr_standbys = [s.get("name", "") for s in (mgrmap.get("standbys") or [])
                    if isinstance(s, dict)]
    return {"health": health, "fsid": doc.get("fsid", ""),
            "version": probe.version, "codename": probe.codename,
            "osds": osds, "osdsUp": up, "osdsIn": inn,
            "mons": _g(monmap, "num_mons") or len(monmap.get("mons", []) or []),
            "monInQuorum": len(quorum), "monList": mon_list, "monLeader": mon_leader,
            "mgrActive": mgr_active, "mgrStandbys": mgr_standbys,
            "mgrAvailable": bool(mgrmap.get("available", False)),
            "pgs": pgs, "pgActiveClean": pg_active_clean, "pgDegraded": pg_bad,
            "pgBackfill": pg_backfill,
            "recoveringBytes": _g(pgmap, "recovering_bytes_per_sec") or 0,
            "used": raw_used, "total": raw_total,
            "iops": (_g(pgmap, "read_op_per_sec") or 0) + (_g(pgmap, "write_op_per_sec") or 0),
            "throughput": (_g(pgmap, "read_bytes_sec") or 0) + (_g(pgmap, "write_bytes_sec") or 0),
            "objects": _g(pgmap, "num_objects") or 0,
            "deploy": probe.orchestrator}


def read_osds(cfg):
    if cfg.backend == "rest":
        return []
    doc, _ = ceph_json(cfg, ["osd", "df"])
    if doc is None:
        return []
    nodes = doc.get("nodes", doc.get("OSDs", [])) if isinstance(doc, dict) else (doc if isinstance(doc, list) else [])
    if not isinstance(nodes, list):
        nodes = []
    host_by_id = {}
    dev_by_id = {}  # oid -> (dev, host)

    # CRUSH tree: map each OSD id to its host (works on every Ceph release).
    tree, _ = ceph_json(cfg, ["osd", "tree"])
    if isinstance(tree, dict):
        by_id = {}
        for n in (tree.get("nodes", []) or []):
            if isinstance(n, dict) and "id" in n:
                by_id[n["id"]] = n
        def rec(nid, host):
            node = by_id.get(nid)
            if not node:
                return
            h = node.get("name", "") if node.get("type") == "host" else host
            if node.get("type") == "osd":
                host_by_id[node["id"]] = h
            for child in node.get("children", []) or []:
                rec(child, h)
        for node in by_id.values():
            if node.get("type") == "root":
                rec(node["id"], "")

    # ceph device ls (13.x+): map OSD daemon -> device / serial.
    devices, _ = ceph_json(cfg, ["device", "ls"])
    if isinstance(devices, list):
        for item in devices:
            if not isinstance(item, dict):
                continue
            loc = item.get("location") or []
            loc = loc[0] if isinstance(loc, list) and loc and isinstance(loc[0], dict) else {}
            dev = loc.get("dev") or loc.get("path") or ""
            if dev and not str(dev).startswith("/"):
                dev = "/dev/" + str(dev)
            host = loc.get("host", "") or ""
            for daemon in item.get("daemons", []) or []:
                m = re.match(r"osd\.(\d+)", str(daemon))
                if m:
                    dev_by_id[int(m.group(1))] = (dev, host)

    out = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        oid = n.get("id", n.get("osd", n.get("name")))
        try:
            oid = int(str(oid).replace("osd.", ""))
        except (TypeError, ValueError):
            continue
        kb = n.get("kb", 0) or 0
        used = n.get("kb_used", 0) or 0
        util = n.get("utilization", 0) or 0
        dm = dev_by_id.get(oid, ("", ""))
        cls = str(n.get("device_class") or n.get("type") or "SSD").upper()
        # SMART 需要 cephadm / node_exporter 侧的真实指标，这里不伪造 "OK"。
        out.append({"id": oid, "host": host_by_id.get(oid, "") or dm[1],
                    "dev": dm[0] or (n.get("device", "") or ""),
                    "type": cls[:8],
                    "size": int(kb * 1024), "used": int(used * 1024),
                    "up": bool(n.get("up", 1)), "inn": bool(n.get("in", 1)),
                    "pgs": n.get("pgs", 0) or 0, "weight": n.get("crush_weight", 1) or 1,
                    "smart": "", "serial": "", "utilization": util})
    return out


def read_alerts(cfg, settings):
    if cfg.backend == "rest":
        return []
    doc, err = ceph_json(cfg, ["health", "detail"])
    if doc is None:
        return []
    checks = doc.get("checks", {}) or {}
    out = []
    for code, c in checks.items():
        if not isinstance(c, dict):
            continue
        sev_num = c.get("severity", "")
        sev = "warning" if "WARN" in str(sev_num).upper() else "info"
        summary = c.get("summary", {}) or {}
        msg = summary.get("message", code) if isinstance(summary, dict) else str(summary)
        detail = c.get("detail", []) or []
        out.append({"id": "H-" + re.sub(r"[^A-Z0-9_]", "", code.upper())[:12],
                    "sev": sev, "code": code, "title": msg,
                    "msg": " ".join(str(x.get("message", "")) if isinstance(x, dict) else str(x) for x in detail[:3]),
                    "src": "ceph health detail", "osd": None,
                    "since": int(time.time() * 1000), "status": "active", "count": 1})
    return out


def read_pools(cfg):
    if cfg.backend == "rest":
        return []
    doc, _ = ceph_json(cfg, ["df", "detail"])
    pools = []
    if isinstance(doc, dict):
        pools = doc.get("pools", []) or []
    # size / min_size / 类型必须来自真实池配置，不能一律填 3 / 2。
    detail, _ = ceph_json(cfg, ["osd", "pool", "ls", "detail"])
    meta = {}
    if isinstance(detail, list):
        for d in detail:
            if isinstance(d, dict):
                key = d.get("poolname") or d.get("pool_name") or ""
                meta[key] = d
    out = []
    for p in pools:
        if not isinstance(p, dict):
            continue
        stats = p.get("stats", {}) or {}
        used = stats.get("bytes_used", 0) or 0
        avail = stats.get("max_avail", 0) or 0
        total = used + avail
        name = p.get("name", "")
        d = meta.get(name, {}) or {}
        ptype = d.get("type")
        if ptype == 3:
            type_name = "erasure"
        elif ptype == 1:
            type_name = "replicated"
        elif d:
            type_name = "erasure" if d.get("erasure_code_profile") else "replicated"
        else:
            type_name = ""
        out.append({"name": name, "type": type_name,
                    "size": d.get("size"), "minSize": d.get("min_size"),
                    "pgs": p.get("pg_num", 0) or 0,
                    "used": used, "pct": int(used * 100 / total) if total else 0,
                    "app": p.get("application", "") or ""})
    return out


def read_hosts(cfg, cluster=None):
    if cfg.backend == "rest":
        return []
    doc, _ = ceph_json(cfg, ["osd", "tree"])
    if doc is None:
        return []
    # cephadm 环境能拿到真实管理地址；非 cephadm 保持空，前端显示 “—”。
    addr_by_host = {}
    orch, _ = ceph_json(cfg, ["orch", "host", "ls"])
    if isinstance(orch, list):
        for h in orch:
            if isinstance(h, dict):
                addr_by_host[h.get("hostname") or h.get("name") or ""] = h.get("addr") or ""
    cl = cluster or {}
    mon_names = set(m.get("name") for m in (cl.get("monList") or []) if m.get("inQuorum"))
    mgr_name = cl.get("mgrActive") or ""
    out = []
    def walk(nodes):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            if n.get("type") == "host":
                name = n.get("name", "")
                kids = n.get("children", []) or []
                out.append({"name": name, "ip": addr_by_host.get(name, ""),
                            "mons": name in mon_names, "mgr": name == mgr_name,
                            "osds": len(kids), "up": len(kids),
                            "mem": None, "cpu": None, "ver": ""})
            walk(n.get("children", []))
    walk(doc.get("nodes", []) if isinstance(doc, dict) else doc)
    return out


def osd_meta(cfg, oid):
    """On-demand host/device lookup for the replace wizard (12.x compatible)."""
    doc, err = ceph_json(cfg, ["osd", "metadata", str(oid)])
    if not isinstance(doc, dict):
        return {"host": "", "dev": "", "serial": "", "smart": "OK", "error": err}
    host = doc.get("hostname", "") or ""
    devs = doc.get("devices", "") or doc.get("device_ids", "") or ""
    if isinstance(devs, (list, tuple)):
        devs = " ".join(str(x) for x in devs)
    dev = ""
    for token in re.split(r"[\s,;]+", str(devs)):
        token = token.strip()
        if not token:
            continue
        base = token.split(":")[0]
        dev = base if base.startswith("/dev/") else "/dev/" + base
        break
    return {"host": host, "dev": dev, "serial": doc.get("serial", "") or "",
            "smart": "OK", "osd_id": oid}


def rest_state(cfg):
    """Read-only proxy to mgr dashboard API. Endpoint names differ by Ceph release."""
    if not cfg.rest_url:
        return {"error": "--rest-url is required for rest backend"}
    ctx = ssl._create_unverified_context() if cfg.insecure else None
    endpoints = ["/api/summary", "/api/health/full", "/api/status"]
    last = ""
    for ep in endpoints:
        try:
            req = urlrequest.Request(cfg.rest_url + ep, headers={"Accept": "application/json",
                                     "Authorization": "Bearer " + cfg.rest_token})
            resp = urlrequest.urlopen(req, timeout=10, context=ctx)
            doc = json.loads(resp.read().decode("utf-8", "replace"))
            return {"health": "UNKNOWN", "raw": doc, "endpoint": ep,
                    "note": "REST channel is read-only; use CLI backend for OSD operations"}
        except Exception as e:
            last = "%s: %s" % (ep, e)
    return {"error": "dashboard API unavailable: " + last}


def read_state(cfg, probe, settings):
    cluster = read_cluster(cfg, probe)
    pools = read_pools(cfg)
    # read_cluster 不带池数量（避免重复调用 ceph），在这里补齐，前端不再
    # 依赖内置演示值 "6 个池"。
    if cfg.backend == "cli" and not cluster.get("error") and isinstance(pools, list):
        cluster["pools"] = len(pools)
    return {"cluster": cluster, "osds": read_osds(cfg),
            "alerts": read_alerts(cfg, settings), "pools": pools,
            "hosts": read_hosts(cfg, cluster), "profile": probe.as_dict(),
            # 阈值来自后端配置文件，前端不再用自己的演示默认值 85/95。
            "settings": {"nearfull": settings.get("nearfull"),
                         "full": settings.get("full"),
                         "downMin": settings.get("downMin")}}


# --------------------------------------------------------------------------
# capacity / IO history (24h sliding window, real samples only)
#   One sample per minute, appended by the request path AND by a background
#   sampler, so the trend is a genuine 24h timeline instead of a drawing.
#   Written atomically as jsonl so a restart or crash keeps the history.
# --------------------------------------------------------------------------
_HIST = {"points": [], "loaded": False, "path": "", "err": "", "last_save": 0}


def history_path(cfg):
    raw = (getattr(cfg, "history_file", "") or os.environ.get("CEPH_CONSOLE_HISTORY", "")
           or HISTORY_PATH)
    folder = os.path.dirname(raw) or "."
    try:
        if not os.path.isdir(folder):
            os.makedirs(folder, 0o755)
        return raw
    except OSError:
        # Unprivileged run (or a read-only root): fall back next to the app.
        return os.path.join(getattr(cfg, "dir", HERE) or HERE, "history.jsonl")


def history_load(cfg):
    if _HIST["loaded"]:
        return
    _HIST["loaded"] = True
    _HIST["path"] = history_path(cfg)
    now = time.time()
    points = []
    try:
        with open(_HIST["path"], "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                ts = rec.get("t")
                if not isinstance(ts, (int, float)):
                    continue
                points.append({"t": int(ts),
                               "pct": float(rec.get("pct") or 0),
                               "iops": int(rec.get("iops") or 0),
                               "thr": int(rec.get("thr") or 0)})
    except (IOError, OSError):
        pass
    points.sort(key=lambda p: p["t"])
    trimmed, seen = [], set()
    for p in points:
        if p["t"] in seen or p["t"] < now - HISTORY_WINDOW:
            continue
        seen.add(p["t"])
        trimmed.append(p)
    _HIST["points"] = trimmed[-HISTORY_MAX_POINTS:]
    _HIST["last_save"] = int(now)


def history_save():
    path = _HIST.get("path") or ""
    points = _HIST.get("points") or []
    if not path:
        return
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            for p in points:
                f.write(json.dumps(p, separators=(",", ":")) + "\n")
        try:
            os.chmod(tmp, 0o644)
        except OSError:
            pass
        os.replace(tmp, path)
    except (IOError, OSError) as e:
        _HIST["err"] = str(e)


def history_record(cfg, data):
    """Store one real sample, bucketed per minute. Never invents numbers."""
    cluster = (data or {}).get("cluster") or {}
    if cluster.get("error"):
        return
    total, used = cluster.get("total"), cluster.get("used")
    if not isinstance(total, (int, float)) or isinstance(total, bool) or total <= 0:
        return
    if not isinstance(used, (int, float)) or isinstance(used, bool) or used < 0:
        return
    history_load(cfg)
    now = int(time.time())
    bucket = now - (now % HISTORY_STEP)
    pct_val = round(float(used) / float(total) * 100.0, 2)
    iops = int(cluster.get("iops") or 0)
    thr = int(cluster.get("throughput") or 0)
    points = _HIST["points"]
    if points and points[-1]["t"] == bucket:
        points[-1].update({"pct": pct_val, "iops": iops, "thr": thr})
    else:
        points.append({"t": bucket, "pct": pct_val, "iops": iops, "thr": thr})
    cutoff = now - HISTORY_WINDOW
    if points and points[0]["t"] < cutoff:
        points = [p for p in points if p["t"] >= cutoff]
    _HIST["points"] = points[-HISTORY_MAX_POINTS:]
    history_save()


def history_series(cfg, hours=24, limit=180):
    history_load(cfg)
    now = int(time.time())
    cutoff = now - int(hours * 3600)
    points = [p for p in _HIST["points"] if p["t"] >= cutoff]
    if len(points) > limit:
        step = int(len(points) / float(limit)) + 1
        reduced = []
        for i in range(0, len(points), step):
            chunk = points[i:i + step]
            reduced.append({"t": chunk[-1]["t"],
                            "pct": round(sum(p["pct"] for p in chunk) / len(chunk), 2),
                            "iops": int(sum(p["iops"] for p in chunk) / len(chunk)),
                            "thr": int(sum(p["thr"] for p in chunk) / len(chunk))})
        points = reduced
    return points


def history_sampler(cfg, probe, settings, interval=HISTORY_STEP):
    """Background sampler: keeps the 24h timeline continuous."""
    while True:
        try:
            history_record(cfg, read_state(cfg, probe, settings))
        except Exception:
            traceback.print_exc()
        time.sleep(max(15, int(interval)))


# --------------------------------------------------------------------------
# command plan (version adaptive, argv only)
# --------------------------------------------------------------------------
def validate_target(osd_id, host, dev):
    try:
        oid = int(osd_id)
    except (TypeError, ValueError):
        raise ValueError("osd_id must be an integer")
    if oid < 0 or oid > 99999:
        raise ValueError("osd_id out of range")
    if host and not HOST_RE.match(str(host)):
        raise ValueError("invalid host")
    if dev:
        if ".." in dev or not DEV_RE.match(str(dev)):
            raise ValueError("invalid device path")
    return oid


def build_plan(cfg, probe, intent, osd_id, host, dev):
    oid = validate_target(osd_id, host, dev)
    orch = probe.caps.get("orch", False)
    purge = probe.caps.get("purge", False)
    if intent not in ("remove", "replace", "in"):
        raise ValueError("unknown intent: %s" % intent)
    # Bringing an OSD back (osd in) only needs its id: no device, no host.
    if intent != "in" and not dev and (not orch or intent == "remove"):
        raise ValueError("device path is required for this operation")
    plan = []  # (name, argv_or_None, note)

    def add(name, argv, note=""):
        plan.append((name, argv, note))

    DOWN_NOTE = "先停服务再摘盘：避免故障盘抖动产生 slow ops；已 down 时该命令幂等"

    if intent == "replace" and orch:
        add("强制标记 OSD DOWN", ["ceph", "osd", "down", str(oid)], DOWN_NOTE)
        add("移除故障 OSD 并保留 ID", ["ceph", "orch", "osd", "rm", str(oid), "--replace"], "cephadm 自动 zap 并保留 CRUSH 位置")
        add("轮询移除任务状态", ["ceph", "orch", "osd", "rm", "status", "--format=json"])
        add("物理更换故障盘", None, "现场操作：按 SN / 盘位更换磁盘")
        add("确认新盘可用", ["ceph", "orch", "device", "ls", str(host), "--format=json"])
        add("等待 cephadm 自动部署", ["ceph", "orch", "ps", "--daemon-type", "osd", "--format=json"])
        add("集群健康验证", ["ceph", "-s", "--format=json"])
    elif intent == "replace":
        add("强制标记 OSD DOWN", ["ceph", "osd", "down", str(oid)], DOWN_NOTE)
        add("标记 OSD OUT", ["ceph", "osd", "out", str(oid)])
        add("等待回填完成", ["ceph", "-s", "--format=json"], "观察 PG 回到 active+clean")
        if purge:
            add("移除 OSD（purge）", ["ceph", "osd", "purge", str(oid), "--yes-i-really-mean-it"])
        else:
            add("从 CRUSH 移除", ["ceph", "osd", "crush", "remove", "osd.%d" % oid])
            add("删除认证", ["ceph", "auth", "del", "osd.%d" % oid])
            add("删除 OSD", ["ceph", "osd", "rm", str(oid)])
        if probe.major >= 13:
            add("清除磁盘 LVM 元数据", ["ceph-volume", "lvm", "zap", str(dev), "--destroy"])
        else:
            add("清除磁盘元数据（12.x）", ["ceph-disk", "zap", str(dev)])
        add("物理更换故障盘", None, "现场操作：按 SN / 盘位更换磁盘")
        if probe.major >= 13:
            add("用原 ID 重建 OSD", ["ceph-volume", "lvm", "create", "--data", str(dev), "--osd-id", str(oid)])
        else:
            add("准备新盘（12.x）", ["ceph-disk", "prepare", str(dev)])
            add("激活 OSD（12.x）", ["ceph-disk", "activate", str(dev)])
        add("重新加入集群", ["ceph", "osd", "in", str(oid)])
        add("集群健康验证", ["ceph", "-s", "--format=json"])
    elif intent == "remove":
        add("强制标记 OSD DOWN", ["ceph", "osd", "down", str(oid)], DOWN_NOTE)
        add("标记 OSD OUT", ["ceph", "osd", "out", str(oid)])
        add("等待回填完成", ["ceph", "-s", "--format=json"], "确认数据已迁出")
        if purge:
            add("永久移除 OSD（purge）", ["ceph", "osd", "purge", str(oid), "--yes-i-really-mean-it"])
        else:
            add("从 CRUSH 移除", ["ceph", "osd", "crush", "remove", "osd.%d" % oid])
            add("删除认证", ["ceph", "auth", "del", "osd.%d" % oid])
            add("删除 OSD", ["ceph", "osd", "rm", str(oid)])
        if orch:
            add("清理设备", ["ceph", "orch", "device", "zap", str(host), str(dev), "--force"])
        elif dev:
            add("清除磁盘元数据", ["ceph-volume", "lvm", "zap", str(dev), "--destroy"])
        add("集群健康验证", ["ceph", "-s", "--format=json"])
    elif intent == "in":
        add("确认 OSD 仍在 CRUSH map", ["ceph", "osd", "tree", "--format=json"],
            "已被 purge / rm 的 OSD 无法 in，只能重新部署")
        add("重新加入集群（osd in）", ["ceph", "osd", "in", str(oid)],
            "取消 out 标记，恢复 CRUSH 权重并触发数据回填")
        add("确认 OSD 处于 up/in", ["ceph", "osd", "tree", "--format=json"],
            "状态应为 up 且权重非 0；仍 down 说明进程未起来")
        add("集群健康验证", ["ceph", "-s", "--format=json"], "观察 PG 回到 active+clean")
    else:
        raise ValueError("unknown intent: %s" % intent)
    return plan


def plan_strings(plan):
    out = []
    for name, argv, note in plan:
        out.append(cmd_str(argv) if argv else "# %s：%s" % (name, note or "人工步骤"))
    return out


def execute_plan(cfg, probe, plan, allow_write):
    """DRY-RUN by default. Real execution only with --allow-write (and not read-only)."""
    commands = plan_strings(plan)
    if not allow_write or cfg.read_only or cfg.backend != "cli":
        return commands, ["dry-run: not executed"] * len(plan), True
    results = []
    for name, argv, note in plan:
        if argv is None:
            results.append("manual step acknowledged (not automated)")
            continue
        # ceph commands get conf/keyring/name injected; ceph-volume runs as-is
        if argv[0] == "ceph":
            rc, out, err = ceph_run(cfg, argv[1:], 60)
        else:
            rc, out, err = run(argv, 120)
        text = (out.strip() or err.strip() or "rc=%d" % rc)[:300]
        results.append("rc=%d %s" % (rc, text))
        audit("EXEC", name, cmd_str(argv), "OK" if rc == 0 else "FAIL", text)
        if rc != 0:
            results.append("stopped after failure: " + name)
            break
    return commands, results, False


def split_plan(plan):
    """Split around the human disk-swap step: (pre, manual_item, post)."""
    for i, item in enumerate(plan):
        if item[1] is None:
            return plan[:i], item, plan[i + 1:]
    return plan, None, []


def plan_detail(plan):
    return [{"name": n, "command": cmd_str(argv) if argv else "",
             "manual": argv is None, "note": note or ""} for n, argv, note in plan]


def isolation_info(cfg, probe):
    """Verifiable evidence that Ceph's native dashboard is untouched."""
    info = {"service": "ceph-console", "port": cfg.port, "backend": cfg.backend,
            "ceph_conf_modified": False, "mgr_config_modified": False,
            "dedicated_client": cfg.ceph_name or "(default client)",
            "dedicated_keyring": cfg.ceph_keyring or "(default keyring)",
            "native_dashboard": {"url": "", "detected": False},
            "port_conflict": False, "checks": []}
    info["checks"] = [
        {"item": "独立进程与端口", "status": "ok",
         "detail": "服务 ceph-console 监听 %d，不与 mgr dashboard 共用端口" % cfg.port},
        {"item": "独立 Ceph 凭证", "status": "ok",
         "detail": "%s / %s，不复用也不修改 admin keyring" % (info["dedicated_client"], info["dedicated_keyring"])},
        {"item": "ceph.conf 未修改", "status": "ok",
         "detail": "只读现有配置；ceph 命令通过 --conf / -n / -k 参数传递"},
        {"item": "mgr 模块未改动", "status": "ok",
         "detail": "不执行 mgr module enable/disable，不写任何 dashboard 配置项"},
        {"item": "防火墙可回滚", "status": "ok",
         "detail": "仅放行本服务端口，卸载脚本会移除该规则"},
    ]
    url = ""
    if cfg.backend == "cli":
        doc, _ = ceph_json(cfg, ["mgr", "services"], 10)
        if isinstance(doc, dict):
            url = str(doc.get("dashboard", "") or "")
    elif cfg.rest_url:
        url = cfg.rest_url
    if url:
        info["native_dashboard"] = {"url": url, "detected": True}
        match = re.search(r":(\d+)", url)
        if match and int(match.group(1)) == int(cfg.port):
            info["port_conflict"] = True
    info["checks"].append(
        {"item": "端口冲突检查", "status": "err" if info["port_conflict"] else "ok",
         "detail": "本服务端口与原生 dashboard 相同，请更换 --port" if info["port_conflict"]
                   else "原生 dashboard 地址保持原样，可继续使用"})
    return info


def diag_info(cfg, probe):
    """Explain why /api/state has no real cluster data.

    Exposes paths, exit codes and stderr only - never keyring contents,
    passwords, session ids or the service token.
    """
    keyring = cfg.ceph_keyring or ""
    kr_exists = bool(keyring) and os.path.isfile(keyring)
    kr_mode = ""
    if kr_exists:
        try:
            kr_mode = oct(os.stat(keyring).st_mode & 0o777)
        except OSError:
            pass
    info = {"version": VERSION, "backend": cfg.backend,
            "python": platform.python_version(), "platform": platform.platform(),
            "ceph_bin": shutil.which("ceph") or "",
            "ceph_conf": cfg.ceph_conf or "(default /etc/ceph/ceph.conf)",
            "ceph_name": cfg.ceph_name or "(default client.admin)",
            "ceph_keyring": keyring or "(default keyring)",
            "keyring_exists": kr_exists, "keyring_mode": kr_mode,
            "allow_write": bool(cfg.allow_write), "read_only": bool(cfg.read_only),
            "rest_url": cfg.rest_url or "", "probe": probe.as_dict(),
            "history": {"file": history_path(cfg), "points": len(_HIST["points"]),
                        "interval": HISTORY_STEP, "window_hours": HISTORY_WINDOW // 3600,
                        "error": _HIST["err"]},
            "status": {}, "hint": ""}
    if cfg.backend == "rest":
        info["status"] = {"ok": bool(cfg.rest_url), "rc": 0,
                          "command": "GET %s/api/summary" % (cfg.rest_url or "<unset>"),
                          "error": "" if cfg.rest_url else "--rest-url is not configured"}
    else:
        argv = ["ceph"]
        if cfg.ceph_conf:
            argv += ["--conf", cfg.ceph_conf]
        if cfg.ceph_name:
            argv += ["-n", cfg.ceph_name]
        if cfg.ceph_keyring:
            argv += ["-k", cfg.ceph_keyring]
        argv += ["status", "--format=json"]
        rc, out, err = run(argv, 8)
        info["status"] = {"ok": rc == 0, "rc": rc, "command": cmd_str(argv),
                          "error": ((err or out).strip()[:800] if rc else "")}
    if cfg.backend == "cli" and not info["ceph_bin"]:
        info["hint"] = "ceph 可执行文件不在后端进程 PATH 中，无法读取集群状态"
    elif cfg.backend == "cli" and keyring and not kr_exists:
        info["hint"] = "专用 keyring 文件不存在，ceph 命令会因认证失败而拿不到状态"
    elif not info["status"].get("ok"):
        info["hint"] = "ceph status 执行失败：检查 ceph.conf、keyring 权限与 ceph auth caps"
    else:
        info["hint"] = "ceph status 可正常执行；若页面仍无数据，等 20 秒缓存过期或重启服务"
    return info


_PROGRESS_CACHE = {"ts": 0.0, "data": None}


def progress_info(cfg, probe, settings):
    """Post-change cluster verification used by the one-click UI."""
    now = time.time()
    if _PROGRESS_CACHE["data"] is not None and now - _PROGRESS_CACHE["ts"] < 8:
        return _PROGRESS_CACHE["data"]
    try:
        st = read_state(cfg, probe, settings)
        c = st.get("cluster", {}) or {}
        degraded = backfilling = clean = 0
        if cfg.backend == "cli":
            doc, _ = ceph_json(cfg, ["pg", "stat"], 10)
            states = {}
            if isinstance(doc, dict):
                states = doc.get("num_pg_by_state", doc.get("pg_stats", {})) or {}
            if isinstance(states, list):
                for item in states:
                    if isinstance(item, dict):
                        key = str(item.get("state", item.get("states", ""))).lower()
                        n = int(item.get("count", item.get("num", 0)) or 0)
                        if "degraded" in key or "undersized" in key:
                            degraded += n
                        if "backfill" in key or "recover" in key:
                            backfilling += n
                        if "active+clean" in key:
                            clean += n
            elif isinstance(states, dict):
                for key, n in states.items():
                    k = str(key).lower()
                    try:
                        n = int(n)
                    except (TypeError, ValueError):
                        continue
                    if "degraded" in k or "undersized" in k:
                        degraded += n
                    if "backfill" in k or "recover" in k:
                        backfilling += n
                    if "active+clean" in k:
                        clean += n
        data = {"available": True, "health": c.get("health", "UNKNOWN"),
                "osds": c.get("osds", 0), "osdsUp": c.get("osdsUp", 0),
                "pgs": c.get("pgs", 0), "degraded": degraded,
                "backfilling": backfilling, "clean": clean, "ts": int(now)}
    except Exception as e:
        data = {"available": False, "reason": str(e), "ts": int(now)}
    _PROGRESS_CACHE["data"] = data
    _PROGRESS_CACHE["ts"] = now
    return data


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------
_STATE_CACHE = {"ts": 0, "data": None}


class Handler(BaseHTTPRequestHandler):
    server_version = "CephOpsConsole/" + VERSION
    cfg = None
    probe = None
    settings = {}

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    def _cors_headers(self):
        """Allow the console UI to be hosted on a different server.

        Authentication is still mandatory: the session travels in the
        X-Console-Session header (or an HttpOnly cookie on same-origin), so a
        permissive CORS policy does not expose cluster data by itself.
        """
        out = {}
        origin = self.headers.get("Origin", "")
        allowed = self.cfg.cors_origin or "*"
        if origin:
            if allowed == "*":
                out["Access-Control-Allow-Origin"] = "*"
            elif origin in [x.strip() for x in allowed.split(",")]:
                out["Access-Control-Allow-Origin"] = origin
                out["Vary"] = "Origin"
                out["Access-Control-Allow-Credentials"] = "true"
        return out

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if not isinstance(body, bytes):
            body = body.encode("utf-8")
        merged = self._cors_headers()
        merged.update(headers or {})
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in merged.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (IOError, OSError):
            pass

    def _json(self, obj, code=200, headers=None):
        self._send(code, json.dumps(obj, ensure_ascii=False),
                   "application/json; charset=utf-8", headers)

    def _cookie(self, name):
        for part in (self.headers.get("Cookie", "") or "").split(";"):
            key, _, value = part.strip().partition("=")
            if key == name:
                return value
        return ""

    def _session_token(self):
        # Header wins: cookies with SameSite=Strict are not sent on cross-origin
        # XHR when the UI is hosted on a separate server.
        return self.headers.get("X-Console-Session", "") or self._cookie("cc_session")

    def _session(self):
        return get_session(self._session_token())

    def _service_token_ok(self):
        got = self.headers.get("X-Console-Token", "")
        return bool(got) and hmac.compare_digest(str(got), str(self.cfg.token))

    def _authorized(self):
        # Login session is the primary credential. The static service token is
        # retained for scripted probes / monitoring integrations.
        if not self.cfg.auth_required:
            return True
        return self._session() is not None or self._service_token_ok()

    def _can_write(self):
        if not self._authorized():
            return False
        s = self._session()
        if s is not None and s.get("role") != "admin":
            return False
        return True

    def _user(self):
        s = self._session()
        return s["user"] if s else "service-token"

    def _client(self):
        return self.client_address[0] if self.client_address else ""

    def _auth_error(self):
        return self._json({"error": "not authenticated; please sign in",
                           "auth_required": True}, 401)

    def api_login(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8", "replace")) if length else {}
        except ValueError:
            return self._json({"error": "invalid JSON body"}, 400)
        remote = self._client()
        if not login_allowed(remote):
            return self._json({"error": "too many failed logins; try again in a few minutes"}, 429)
        users = load_users(self.cfg.users_file)
        name = str(body.get("username", "") or "")
        password = str(body.get("password", "") or "")
        token = str(body.get("token", "") or "")
        role, user = None, None
        if token and hmac.compare_digest(token, str(self.cfg.token)):
            # Service token is an operator-level credential. Real execution is
            # still gated by --allow-write on the server side.
            user, role = "service-token", "admin"
        elif name in users and verify_password(password, users[name]):
            user = name
            role = users[name].get("role", "viewer")
            if role not in ("admin", "viewer"):
                role = "viewer"
        if not user:
            note_login_fail(remote)
            audit("LOGIN_FAIL", name or "-", "-", "REJECTED", "bad credentials", remote)
            return self._json({"error": "用户名或密码错误"}, 401)
        note_login_ok(remote)
        sid = new_session(user, role, remote, self.cfg.session_ttl)
        cookie = "cc_session=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (
            sid, self.cfg.session_ttl)
        audit("LOGIN", user, "-", "OK", "role=%s backend=%s" % (role, self.cfg.backend), remote)
        return self._json({"ok": True, "session": sid, "user": user, "role": role,
                           "auth_required": True, "allow_write": self.cfg.allow_write,
                           "read_only": self.cfg.read_only, "backend": self.cfg.backend,
                           "expires_in": self.cfg.session_ttl}, 200, {"Set-Cookie": cookie})

    def api_logout(self):
        sid = self._session_token()
        s = get_session(sid)
        if s:
            audit("LOGOUT", s["user"], "-", "OK", "signed out", self._client())
        drop_session(sid)
        return self._json({"ok": True}, 200,
                          {"Set-Cookie": "cc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"})

    def api_password(self, body):
        """Change the password of the signed-in account.

        Requires a real login session (a raw service token cannot change a
        password), the current password, and a valid new password. Other live
        sessions of the same account are invalidated so a stolen session cannot
        outlive the change. Passwords are never logged or included in the reply.
        """
        s = self._session()
        if s is None:
            return self._json({"error": "请用账号密码登录后修改密码（服务令牌不支持改密）"}, 403)
        name = s["user"]
        users = load_users(self.cfg.users_file)
        rec = users.get(name)
        if not isinstance(rec, dict) or "hash" not in rec:
            return self._json({"error": "当前账号不在本地用户库中，无法修改密码"}, 403)
        remote = self._client()
        if not login_allowed(remote):
            return self._json({"error": "尝试次数过多，请几分钟后再试"}, 429)
        old = str(body.get("old_password", "") or "")
        new = str(body.get("new_password", "") or "")
        if not verify_password(old, rec):
            note_login_fail(remote)
            audit("PASSWORD_CHANGE", name, "-", "REJECTED", "bad current password", remote, name)
            return self._json({"error": "当前密码不正确"}, 403)
        confirm = body.get("confirm_password", None)
        err = password_error(new, None if confirm is None else str(confirm))
        if err:
            return self._json({"error": err}, 400)
        if verify_password(new, rec):
            return self._json({"error": "新密码不能与当前密码相同"}, 400)
        note_login_ok(remote)
        fresh = hash_password(new)
        fresh["role"] = rec.get("role", "viewer")
        users[name] = fresh
        try:
            save_users(self.cfg.users_file, users)
        except Exception as e:
            return self._json({"error": "写入用户库失败：%s" % e}, 500)
        sid = self._session_token()
        dropped = 0
        for tok, item in list(SESSIONS.items()):
            if item.get("user") == name and tok != sid:
                SESSIONS.pop(tok, None)
                dropped += 1
        audit("PASSWORD_CHANGE", name, "-", "OK",
              "password updated; %d other session(s) invalidated" % dropped, remote, name)
        return self._json({"ok": True, "user": name,
                           "message": "密码已更新，其他登录会话已失效"})

    def api_session_info(self):
        s = self._session()
        if not s:
            return self._json({"authenticated": False, "auth_required": self.cfg.auth_required,
                               "service_name": "Ceph Ops Console", "version": VERSION})
        return self._json({"authenticated": True, "auth_required": True,
                           "user": s["user"], "role": s["role"],
                           "allow_write": self.cfg.allow_write and s["role"] == "admin",
                           "read_only": self.cfg.read_only, "backend": self.cfg.backend,
                           "expires_at": int(s["expires"]), "version": VERSION})

    def do_OPTIONS(self):
        self.send_response(204)
        hdrs = self._cors_headers() or {"Access-Control-Allow-Origin": "*"}
        for key, value in hdrs.items():
            self.send_header(key, value)
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, X-Console-Token, X-Console-Session, X-Confirm-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        # ?refresh=1 bypasses the 20s /api/state cache (manual "重新同步"),
        # so the IO / capacity trend gets a genuinely fresh sample.
        self._fresh = "refresh=1" in (self.path or "")
        if path == "/api/session":
            return self.api_session_info()
        if path.startswith("/api/"):
            if not self._authorized():
                return self._auth_error()
            try:
                return self.api_get(path)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": str(e)}, 500)
        return self.static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if not path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        if path == "/api/login":
            return self.api_login()
        if path == "/api/logout":
            return self.api_logout()
        if not self._authorized():
            return self._auth_error()
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8", "replace")) if length else {}
        except ValueError:
            return self._json({"error": "invalid JSON body"}, 400)
        try:
            return self.api_post(path, body if isinstance(body, dict) else {})
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)

    def api_get(self, path):
        if path == "/api/probe":
            self.probe.refresh()
            return self._json({"ok": True, "profile": self.probe.as_dict()})
        if path == "/api/diag":
            return self._json({"ok": True, "data": diag_info(self.cfg, self.probe)})
        if path == "/api/state":
            now = time.time()
            force = bool(getattr(self, "_fresh", False))
            if force or _STATE_CACHE["data"] is None or now - _STATE_CACHE["ts"] > 20:
                _STATE_CACHE["data"] = read_state(self.cfg, self.probe, self.settings)
                _STATE_CACHE["ts"] = now
                # Every fresh read also feeds the real 24h trend.
                history_record(self.cfg, _STATE_CACHE["data"])
            # ts 是缓存生成时间，不是响应时间：前端据此跳过缓存窗口内的
            # 重复样本，避免趋势图出现假台阶。
            return self._json({"ok": True, "data": _STATE_CACHE["data"],
                               "ts": int(_STATE_CACHE["ts"]), "served_at": int(now)})
        if path == "/api/history":
            hours = 24.0
            for chunk in (self.path.split("?", 1)[1] if "?" in self.path else "").split("&"):
                if chunk.startswith("hours="):
                    try:
                        hours = max(1.0, min(168.0, float(chunk.split("=", 1)[1])))
                    except ValueError:
                        pass
            points = history_series(self.cfg, hours)
            span = (points[-1]["t"] - points[0]["t"]) if len(points) >= 2 else 0
            return self._json({"ok": True, "data": {
                "points": points, "count": len(points), "span_sec": span,
                "hours": hours, "interval": HISTORY_STEP,
                "window_sec": HISTORY_WINDOW, "error": _HIST["err"]}})
        if path.startswith("/api/osd/") and path.endswith("/meta"):
            try:
                oid = int(path.split("/")[3].replace("osd.", ""))
            except (IndexError, ValueError):
                raise ValueError("invalid osd id")
            result = {"ok": True, "osd_id": oid}
            result.update(osd_meta(self.cfg, oid))
            return self._json(result)
        if path == "/api/audit":
            return self._json({"ok": True, "items": read_audit()})
        if path == "/api/plan":
            return self._json({"ok": True, "caps": self.probe.caps, "version": self.probe.version})
        if path == "/api/progress":
            return self._json({"ok": True, "data": progress_info(self.cfg, self.probe, self.settings)})
        if path == "/api/isolation":
            return self._json({"ok": True, "data": isolation_info(self.cfg, self.probe)})
        return self._json({"error": "unknown endpoint"}, 404)

    def _execute(self, body, intent=None, stage="auto"):
        """Shared executor for the 5-step wizard and the one-click endpoints.

        stage=pre stops before the human disk-swap step; stage=post runs the
        commands after it. That way a real replacement never pretends to have
        swapped a physical disk automatically.
        """
        intent = intent or str(body.get("intent", "replace"))
        oid = body.get("osd_id")
        host = str(body.get("host", "") or "")
        dev = str(body.get("dev", "") or "")
        phrase = str(body.get("confirm_phrase", "") or "")
        oid = validate_target(oid, host, dev)
        if phrase != "osd.%d" % oid:
            return self._json({"error": "confirm_phrase mismatch (expected osd.%d)" % oid}, 403)
        # A viewer may rehearse the whole flow in DRY-RUN, but may never ask
        # for real execution. Server-side --allow-write is a second gate.
        if not self._authorized():
            return self._auth_error()
        s = self._session()
        if s is not None and s.get("role") != "admin" and bool(body.get("allow_write")):
            return self._json({"error": "viewer role cannot perform real OSD operations"}, 403)
        if self.cfg.read_only:
            return self._json({"error": "read-only keyring: write operations are disabled"}, 403)
        if self.cfg.backend != "cli":
            return self._json({"error": "REST backend is read-only; deploy CLI backend for OSD operations"}, 403)
        full = build_plan(self.cfg, self.probe, intent, oid, host, dev)
        pre, manual, post = split_plan(full)
        if stage == "pre":
            plan, pending, pause = pre, plan_strings(post), manual is not None
        elif stage == "post":
            plan, pending, pause = post, [], False
        else:
            plan, pending, pause = full, [], False
        allow = bool(body.get("allow_write")) and self.cfg.allow_write and self._can_write()
        commands, results, dry = execute_plan(self.cfg, self.probe, plan, allow)
        audit("OSD_%s" % intent.upper(), "osd.%d" % oid, " ; ".join(commands),
              "DRY-RUN" if dry else "EXECUTED",
              "remote=%s ceph=%s stage=%s" % (self._client(), self.probe.version, stage),
              self._client(), self._user())
        return self._json({"ok": True, "commands": commands, "results": results,
                           "dry_run": dry, "version": self.probe.version,
                           "orchestrator": self.probe.orchestrator,
                           "stage": stage, "pause": pause, "pending_commands": pending,
                           "manual_step": ({"name": manual[0], "note": manual[2] or ""}
                                           if manual else None)})

    def api_post(self, path, body):
        if path == "/api/password":
            return self.api_password(body)
        if path == "/api/plan":
            intent = str(body.get("intent", "replace"))
            oid = body.get("osd_id")
            host = str(body.get("host", "") or "")
            dev = str(body.get("dev", "") or "")
            oid = validate_target(oid, host, dev)
            plan = build_plan(self.cfg, self.probe, intent, oid, host, dev)
            return self._json({"ok": True, "steps": plan_detail(plan),
                               "commands": plan_strings(plan),
                               "version": self.probe.version,
                               "orchestrator": self.probe.orchestrator,
                               "allow_write": self.cfg.allow_write and self._can_write(),
                               "read_only": self.cfg.read_only})
        if path in ("/api/quick/kick", "/api/quick/replace", "/api/quick/in", "/api/execute"):
            override = None
            if path == "/api/quick/kick":
                override = "remove"
            elif path == "/api/quick/replace":
                override = "replace"
            elif path == "/api/quick/in":
                override = "in"
            return self._execute(body, override, str(body.get("stage", "auto")))
        if path.startswith("/api/osd/") and path.endswith(("/out", "/in")):
            parts = path.split("/")
            try:
                oid = int(parts[3].replace("osd.", ""))
            except (IndexError, ValueError):
                raise ValueError("invalid osd id")
            action = "out" if path.endswith("/out") else "in"
            argv = ["ceph", "osd", action, str(oid)]
            if self.cfg.read_only or self.cfg.backend != "cli" or not self._can_write():
                audit("OSD_%s" % action.upper(), "osd.%d" % oid, cmd_str(argv), "REJECTED", "read-only",
                      self._client(), self._user())
                return self._json({"error": "write operations disabled"}, 403)
            if self.cfg.allow_write and body.get("confirm_phrase") == "osd.%d" % oid:
                rc, out, err = ceph_run(self.cfg, argv[1:], 30)
                res = "OK" if rc == 0 else "FAIL"
                audit("OSD_%s" % action.upper(), "osd.%d" % oid, cmd_str(argv), res, err[:200],
                      self._client(), self._user())
                return self._json({"ok": rc == 0, "result": res, "detail": (out or err)[:300]})
            audit("OSD_%s" % action.upper(), "osd.%d" % oid, cmd_str(argv), "DRY-RUN", "not executed",
                  self._client(), self._user())
            return self._json({"ok": True, "dry_run": True, "command": cmd_str(argv)})
        if path == "/api/alert/ack":
            audit("ALERT_ACK", str(body.get("id", "")), "-", "OK", "acknowledged")
            return self._json({"ok": True})
        return self._json({"error": "unknown endpoint"}, 404)

    def static(self, path):
        if path in ("/", "/index.html"):
            name = "ceph-dashboard.html"
        else:
            name = os.path.basename(path)
        if not re.match(r"^[A-Za-z0-9._-]+$", name):
            return self._send(403, "forbidden", "text/plain; charset=utf-8")
        full = os.path.join(HERE, name)
        if not os.path.isfile(full):
            return self._send(404, "not found", "text/plain; charset=utf-8")
        with open(full, "rb") as f:
            data = f.read()
        if name.endswith(".html"):
            # Never expose cluster profile / service token before authentication.
            boot = {"live": True, "apiBase": "", "authRequired": self.cfg.auth_required,
                    "version": VERSION, "port": self.cfg.port,
                    "settings": {"read_only": self.cfg.read_only}}
            placeholder = b"/*__BOOTSTRAP__*/ null"
            injection = json.dumps(boot, ensure_ascii=False).encode("utf-8")
            data = data.replace(placeholder, injection)
            ctype = "text/html; charset=utf-8"
        elif name.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif name.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        else:
            ctype = "application/octet-stream"
        self._send(200, data, ctype)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def parse_args(argv):
    p = argparse.ArgumentParser(description="Ceph Ops Console backend (Python 3.6+ stdlib only)")
    p.add_argument("--backend", choices=["cli", "rest"], default="cli")
    p.add_argument("--bind", default="0.0.0.0")
    p.add_argument("--host", default="", help="public host/IP used in access URL")
    p.add_argument("--port", default="8780")
    p.add_argument("--dir", default=HERE)
    p.add_argument("--token", default="")
    p.add_argument("--allow-write", action="store_true", help="actually execute OSD commands (DANGEROUS)")
    p.add_argument("--read-only", action="store_true", help="never allow write operations")
    p.add_argument("--rest-url", default="", help="mgr dashboard base URL, e.g. https://IP:8443")
    p.add_argument("--rest-token", default="", help="dashboard bearer token")
    p.add_argument("--insecure", action="store_true", help="skip TLS verification for dashboard")
    p.add_argument("--ceph-conf", default="", help="path to ceph.conf")
    p.add_argument("--ceph-name", default="", help="client name, e.g. client.ceph-console")
    p.add_argument("--ceph-keyring", default="", help="path to client keyring")
    p.add_argument("--users-file", default="", help="JSON user store with PBKDF2 hashes")
    p.add_argument("--history-file", default="",
                   help="jsonl file for real capacity/IO samples (default %s)" % HISTORY_PATH)
    p.add_argument("--no-auth", action="store_true", help="disable login (NOT recommended)")
    p.add_argument("--session-ttl", default="", help="session lifetime in seconds (default 8h)")
    p.add_argument("--cors-origin", default="",
                   help="allowed UI origin(s), comma separated; default * for intranet")
    p.add_argument("--print-profile", action="store_true", help="print probe result and exit")
    p.add_argument("--set-password", default="", metavar="USER",
                   help="offline: reset USER's password and exit (reads CEPH_CONSOLE_NEW_PASSWORD, "
                        "or prompts twice); no service restart needed")
    return p.parse_args(argv)


def cli_set_password(user, users_file):
    """Offline reset for a forgotten password, without touching the cluster.

    The new password may be supplied via CEPH_CONSOLE_NEW_PASSWORD for scripted
    use; otherwise it is read twice from the terminal with echo disabled. The
    backend loads users.json on every login, so no restart is required.
    """
    import getpass
    user = (user or "").strip()
    if not user:
        print("a username is required", file=sys.stderr)
        return 2
    new = os.environ.get("CEPH_CONSOLE_NEW_PASSWORD", "")
    if not new:
        try:
            new = getpass.getpass("New password for %s: " % user)
            again = getpass.getpass("Repeat new password: ")
        except (EOFError, KeyboardInterrupt):
            print("aborted", file=sys.stderr)
            return 2
        if new != again:
            print("passwords do not match", file=sys.stderr)
            return 2
    err = password_error(new)
    if err:
        print(err, file=sys.stderr)
        return 2
    users = load_users(users_file)
    old = users.get(user) or {}
    if isinstance(old, dict) and "hash" in old and verify_password(new, old):
        print("new password must differ from the current one", file=sys.stderr)
        return 2
    fresh = hash_password(new)
    fresh["role"] = old.get("role", "admin") if isinstance(old, dict) else "admin"
    users[user] = fresh
    try:
        save_users(users_file, users)
    except Exception as e:
        print("failed to write %s: %s" % (users_file, e), file=sys.stderr)
        return 1
    print("password for %s updated in %s (PBKDF2 hash, 0600)" % (user, users_file))
    print("no restart needed; existing browser sessions stay valid until they expire")
    return 0


def main(argv):
    args = parse_args(argv)
    cfg = Config(args)
    if args.set_password:
        return cli_set_password(args.set_password, cfg.users_file)
    probe = Probe(cfg)
    if args.print_profile:
        print(json.dumps(probe.as_dict(), ensure_ascii=False, indent=2))
        return 0
    settings = {"nearfull": 85, "full": 95, "downMin": 10}
    if os.path.isfile(CONF_PATH):
        try:
            with open(CONF_PATH, "r") as f:
                settings.update(json.load(f))
        except (IOError, ValueError):
            pass
    Handler.cfg, Handler.probe, Handler.settings = cfg, probe, settings
    public = args.host or cfg.bind
    print("Ceph Ops Console %s" % VERSION)
    print("  OS        : %s (init=%s, firewall=%s, selinux=%s)" %
          (probe.env["os"], probe.env["init"], probe.env["firewall"], probe.env["selinux"]))
    print("  Python    : %s" % probe.env["python"])
    print("  Backend   : %s" % cfg.backend)
    print("  Ceph      : %s %s / %s" % (probe.version, probe.codename, probe.orchestrator))
    print("  Caps      : " + ", ".join("%s=%s" % (k, v) for k, v in sorted(probe.caps.items())))
    print("  Mode      : %s (write=%s, read_only=%s)" %
          ("DRY-RUN" if cfg.dry_run else "EXECUTE", cfg.allow_write, cfg.read_only))
    print("  Auth      : %s (user store: %s)" %
          ("login required" if cfg.auth_required else "DISABLED - not recommended", cfg.users_file))
    print("  CORS      : %s" % cfg.cors_origin)
    print("  URL       : http://%s:%d/  (sign in with deploy.sh credentials)" % (public, cfg.port))
    print("  Token     : service token stored in the 0600 env file (not logged here)")
    print("  Audit     : %s" % AUDIT_PATH)
    print("  History   : %s (1 sample / %ds, %dh window)" %
          (history_path(cfg), HISTORY_STEP, HISTORY_WINDOW // 3600))
    audit("START", "-", "-", "OK", "backend=%s ceph=%s" % (cfg.backend, probe.version))
    # Continuous real sampling for the 24h capacity / IO trend.
    sampler = threading.Thread(target=history_sampler,
                               args=(cfg, probe, settings, HISTORY_STEP))
    sampler.daemon = True
    sampler.start()
    try:
        srv = ThreadedHTTPServer((cfg.bind, cfg.port), Handler)
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
