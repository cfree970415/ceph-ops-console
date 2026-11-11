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
import socket
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
VERSION = "1.2.0"
AUDIT_PATH = "/var/log/ceph-console/audit.jsonl"
# 「一键换盘」硬门禁：cephadm 的 --replace 是异步的，只有原编号被打上
# destroyed 之后 OSDSpec 才会复用它。pre 阶段提交移除后最多等这么久，
# post 阶段（zap）之前必须重新确认，否则宁可拒绝执行，也绝不多出一块盘。
REPLACE_DESTROY_TRIES = 5
REPLACE_DESTROY_INTERVAL = 2
CONF_PATH = "/etc/ceph-console/config.json"
USERS_PATH = "/etc/ceph-console/users.json"
# Real capacity / IO history. Sampled once a minute by the backend itself, so
# the 24h trend keeps filling even while nobody has the page open. Persisted as
# jsonl next to the runtime data, trimmed to a 24h sliding window.
HISTORY_PATH = "/var/lib/ceph-console/history.jsonl"
HISTORY_WINDOW = 24 * 3600
HISTORY_STEP = 60
HISTORY_MAX_POINTS = 24 * 60 + 60
# Alert lifecycle. One health check = one alert until it actually clears.
# Kept on disk so an acknowledged alert stays acknowledged across restarts.
ALERT_STATE_PATH = "/var/lib/ceph-console/alerts.json"
ALERT_RESOLVE_TTL = 2 * 3600      # keep resolved rows this long for review
ALERT_SILENCE_DEFAULT = 60        # minutes
# 一个 check 连续多少次采集都看不到，才判定「已恢复」。单次采集抖动
# （MON 忙、命令超时，尤其是刚做完 OUT/IN 之后）不该把还在的告警标成恢复。
ALERT_MISS_LIMIT = 2
# 只看次数不够：刚刚 OUT/IN 完，Ceph 有几十秒的窗口还没开始报 PG_DEGRADED
# （OSD 已经 in、回填尚未启动），此时 health detail 是空的，两轮刷新就能凑够
# 次数，界面看起来像「IN 一下就把告警治好了」。所以再加两道时间闸：
#   * 距最后一次看到该 check 至少 ALERT_CONFIRM_AGE 秒；
#   * 真实写操作后 ALERT_WRITE_GRACE 秒内一律不判恢复，原状态照旧。
ALERT_CONFIRM_AGE = 60
ALERT_WRITE_GRACE = 180
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
# 存储池名称：不允许空格 / 斜杠 / 冒号，也不能以 . 开头（Ceph 保留命名空间，
# 例如 .mgr、.rgw.root）。参数化 subprocess 不经 shell，这里只做最小必要限制。
POOL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------
def _int_arg(raw, env, default, lo=1, hi=65535):
    """从若干候选值里取第一个能转成整数的（带范围钳制），都不行就用兜底。

    ssh 端口 / 超时既可能来自命令行、环境变量，也可能来自 config.json，
    任何一处填错都不应该让整个进程起不来 —— 一律回退到安全默认值。
    """
    for v in (raw, env):
        if v in (None, ""):
            continue
        try:
            n = int(str(v).strip())
        except (TypeError, ValueError):
            continue
        return max(lo, min(hi, n))
    return default


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
        self.conf_path = (getattr(args, "config_file", "") or
                          os.environ.get("CEPH_CONSOLE_CONFIG", "") or CONF_PATH)
        self.users_file = getattr(args, "users_file", "") or os.environ.get("CEPH_CONSOLE_USERS", "") or USERS_PATH
        self.history_file = getattr(args, "history_file", "") or os.environ.get("CEPH_CONSOLE_HISTORY", "") or HISTORY_PATH
        self.auth_required = not bool(getattr(args, "no_auth", False) or
                                      os.environ.get("CEPH_CONSOLE_NO_AUTH") == "1")
        self.session_ttl = int(getattr(args, "session_ttl", 0) or SESSION_TTL)
        self.cors_origin = getattr(args, "cors_origin", "") or os.environ.get("CEPH_CONSOLE_CORS", "") or "*"
        # 远程执行（二进制 / 包安装集群）：systemctl、ceph-volume、ceph-disk 必须
        # 在「盘所在的那台机器」上跑，cephadm 有 orchestrator 代劳，包安装没有。
        # 优先级：命令行 > 环境变量 > config.json 的 ssh 段 > 默认值。
        self.ssh = {
            "enabled": not bool(getattr(args, "no_ssh", False)
                                or os.environ.get("CEPH_CONSOLE_SSH_DISABLE") == "1"),
            "user": (getattr(args, "ssh_user", "") or os.environ.get("CEPH_CONSOLE_SSH_USER", "")
                     or getattr(args, "host_ssh_user", "") or "root"),
            "port": _int_arg(getattr(args, "ssh_port", ""),
                             os.environ.get("CEPH_CONSOLE_SSH_PORT"), 22, 1, 65535),
            "key": (getattr(args, "ssh_key", "") or os.environ.get("CEPH_CONSOLE_SSH_KEY", "") or ""),
            "sudo": not bool(getattr(args, "no_ssh_sudo", False)
                             or os.environ.get("CEPH_CONSOLE_SSH_NOSUDO") == "1"),
            "connect_timeout": _int_arg(getattr(args, "ssh_timeout", ""),
                                        os.environ.get("CEPH_CONSOLE_SSH_TIMEOUT"), 6, 2, 60),
        }
        # --host-metrics 沿用同一套凭据，避免出现「两处 ssh 配置互相打架」
        self.host_ssh_user = self.ssh["user"]
        # 「部署方式覆盖」：某些包安装集群仍然装着 cephadm 包（orch 命令能跑但没用），
        # 自动探测会误判成 cephadm。这里允许在页面上强制按传统方式生成命令。
        self.deploy_override = "auto"
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
        self.deploy_mode = "unknown"   # cephadm | ceph-volume | ceph-disk
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
            # 「部署方式覆盖」：包安装集群也可能装了 cephadm 包（orch 命令能执行，
            # 但没有实际接管）。此时自动探测会把命令模板带偏，允许人工强制。
            ov = str(getattr(self.cfg, "deploy_override", "auto") or "auto").lower()
            if ov == "legacy":
                self.caps["orch"] = False
            self.orchestrator = "cephadm" if self.caps["orch"] else "legacy"
            # 真正决定「动盘命令长什么样」的是 OSD 是怎么创建出来的：
            #   cephadm  -> orch daemon add / orch device zap
            #   包安装    -> ceph-volume lvm create / zap（12.x 前是 ceph-disk）
            if self.caps["orch"]:
                self.deploy_mode = "cephadm"
            elif self.major and self.major < 13:
                self.deploy_mode = "ceph-disk"
            elif self.major or shutil.which("ceph-volume"):
                self.deploy_mode = "ceph-volume"
            else:
                self.deploy_mode = "unknown"
            if ov == "cephadm" and not self.caps["orch"]:
                # 覆盖成 cephadm 但集群确实没有 orchestrator：如实标记，不假装可用
                self.orchestrator = "legacy (orch 不可用)"
            _DEPLOY_STATE.update({"mode": self.deploy_mode, "orch": bool(self.caps["orch"])})
        else:
            self.caps = {"orch": False, "purge": False, "ok_to_stop": False,
                         "safe_to_destroy": False, "device_ls": False, "mgr_services": True}
            self.orchestrator = "legacy"
            self.deploy_mode = "unknown"
            self.codename = "rest-proxy"
        if self.cfg.read_only:
            self.orchestrator += " (read-only)"

    def as_dict(self):
        d = dict(self.env)
        d.update({"version": self.version, "major": self.major, "codename": self.codename,
                  "orchestrator": self.orchestrator, "backend": self.cfg.backend,
                  "caps": self.caps, "detected": self.detected, "error": self.error,
                  "dry_run": self.cfg.dry_run, "read_only": self.cfg.read_only,
                  "deploy_mode": self.deploy_mode,
                  "deploy_override": getattr(self.cfg, "deploy_override", "auto"),
                  # remote 只是一份配置概况（不探活），逐主机连通性走 /api/remote
                  "remote": ssh_summary(self.cfg),
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


def _addr_str(d):
    """public_addr 在不同版本里是字符串，也可能是 addrvec 结构。"""
    if isinstance(d, str):
        return d
    if isinstance(d, dict):
        vec = d.get("addrvec")
        if isinstance(vec, list) and vec and isinstance(vec[0], dict):
            return vec[0].get("addr") or ""
    return ""


def _quorum_names(raw_quorum, raw_names, mons):
    """把 quorum（可能是 rank 列表，也可能是名字列表）归一成名字列表。

    返回 None 表示这个来源没有仲裁信息；返回 [] 表示明确「没有仲裁」
    （MON 没形成 quorum）。两者在页面上必须区分，不能都当成 0。
    """
    if isinstance(raw_names, list) and raw_names:
        return [str(x) for x in raw_names]
    if isinstance(raw_quorum, list):
        if not raw_quorum:
            return []
        out = []
        for x in raw_quorum:
            if isinstance(x, str):
                out.append(x)
                continue
            name = ""
            for m in mons:
                if m.get("rank") == x and m.get("name"):
                    name = m["name"]
                    break
            out.append(name or str(x))
        return out
    return None


def read_mons(cfg, doc=None):
    """MON 成员 / 位次 / 是否在 quorum / leader，返回 (mon_list, quorum, leader)。

    `ceph status` 的 monmap 从 Octopus 起只保留 num_mons，不再带 mons 数组，
    照它取成员名永远是空（页面就显示「—」，主机角色也认不出 MON）。
    真正带成员表的是 quorum_status 和 mon dump，status 只作最后兜底。
    """
    doc = doc if isinstance(doc, dict) else {}
    monmap = doc.get("monmap") if isinstance(doc.get("monmap"), dict) else {}
    mons = []
    quorum = None
    leader = ""
    qdoc = None
    qs, _ = ceph_json(cfg, ["quorum_status"])
    if isinstance(qs, dict):
        qdoc = qs
        mp = qs.get("monmap") if isinstance(qs.get("monmap"), dict) else {}
        mons = [m for m in (mp.get("mons") or []) if isinstance(m, dict)]
        quorum = _quorum_names(qs.get("quorum"), qs.get("quorum_names"), mons)
    if not mons:
        md, _ = ceph_json(cfg, ["mon", "dump"])
        if isinstance(md, dict):
            mons = [m for m in (md.get("mons") or []) if isinstance(m, dict)]
            if quorum is None:
                quorum = _quorum_names(md.get("quorum"), md.get("quorum_names"), mons)
    if not mons:
        mons = [m for m in (monmap.get("mons") or []) if isinstance(m, dict)]
    if quorum is None:
        quorum = _quorum_names(monmap.get("quorum"),
                               monmap.get("quorum_names") or doc.get("quorum_names"), mons)
    if quorum is None:
        quorum = _quorum_names(doc.get("quorum"), None, mons)
    out = []
    for m in mons:
        name = m.get("name") or ""
        if not name:
            continue
        out.append({"name": name, "rank": m.get("rank", 0),
                    "addr": (_addr_str(m.get("public_addr")) or _addr_str(m.get("public_addrs"))
                             or _addr_str(m.get("addr"))),
                    # 仲裁信息完全拿不到时（老版本），只能按「在册即在线」显示，
                    # 这种情况通常伴随 ceph 命令整体失败，不会走到这里。
                    "inQuorum": (name in quorum) if quorum is not None else True})
    out.sort(key=lambda x: (x["rank"], x["name"]))
    if qdoc and qdoc.get("quorum_leader_name"):
        leader = qdoc["quorum_leader_name"]
    for m in out:
        if leader:
            break
        if m["inQuorum"]:
            leader = m["name"]
    return out, quorum, leader


def read_mgr(cfg, doc=None):
    """MGR active / standby / 是否可用；status 里没给就用 mgr dump。"""
    doc = doc if isinstance(doc, dict) else {}
    mp = doc.get("mgrmap") if isinstance(doc.get("mgrmap"), dict) else {}
    active = mp.get("active_name") or ""
    standbys = [s.get("name") or "" for s in (mp.get("standbys") or []) if isinstance(s, dict)]
    available = bool(mp.get("available", False))
    if not active:
        md, _ = ceph_json(cfg, ["mgr", "dump"])
        if isinstance(md, dict):
            active = md.get("active_name") or ""
            if not standbys:
                standbys = [s.get("name") or "" for s in (md.get("standbys") or [])
                            if isinstance(s, dict)]
            if md.get("available") is not None:
                available = bool(md.get("available"))
    return {"active": active, "standbys": [s for s in standbys if s], "available": available}


_LOCAL_USAGE = {"ts": 0.0, "host": "", "ips": [], "cpu": None, "mem": None}


def _cpu_times():
    """(总时间, 空闲时间)，单位 jiffies，取自 /proc/stat 第一行。"""
    with open("/proc/stat", "r") as f:
        parts = f.readline().split()
    vals = [int(x) for x in parts[1:] if x.isdigit()]
    if len(vals) < 4:
        raise ValueError("bad /proc/stat")
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals), idle


def local_usage(ttl=15):
    """运行控制台这台机器的真实 CPU / 内存水位（/proc 采样，结果缓存 ttl 秒）。

    没装 node_exporter 时这是唯一真实可得的来源；采样只覆盖控制台所在的
    节点，其它节点保持空（页面显「未采集」），绝不拿 0 或演示值充数。
    """
    now = time.time()
    if _LOCAL_USAGE["ts"] and now - _LOCAL_USAGE["ts"] < ttl:
        return _LOCAL_USAGE
    host = ""
    ips = []
    try:
        host = socket.gethostname() or ""
    except Exception:
        host = ""
    if host:
        try:
            ips = socket.gethostbyname_ex(host)[2]
        except Exception:
            ips = []
    cpu = None
    try:
        t1, i1 = _cpu_times()
        time.sleep(0.15)
        t2, i2 = _cpu_times()
        span = t2 - t1
        if span > 0:
            cpu = int(round(max(0.0, min(100.0, (1.0 - float(i2 - i1) / span) * 100.0))))
    except Exception:
        cpu = None
    mem = None
    try:
        info = {}
        with open("/proc/meminfo", "r") as f:
            for line in f:
                key, _, val = line.partition(":")
                num = val.strip().split(" ")[0] if val.strip() else ""
                if num.isdigit():
                    info[key] = int(num)
        total = info.get("MemTotal") or 0
        avail = info.get("MemAvailable")
        if avail is None:
            avail = (info.get("MemFree") or 0) + (info.get("Buffers") or 0) + (info.get("Cached") or 0)
        if total > 0:
            mem = int(round(max(0.0, min(100.0, (1.0 - float(avail) / total) * 100.0))))
    except Exception:
        mem = None
    _LOCAL_USAGE.update({"ts": now, "host": host, "ips": ips, "cpu": cpu, "mem": mem})
    return _LOCAL_USAGE


def _is_local_node(name, ip):
    """这台主机是不是运行控制台的机器（主机名或本机任一 IP 匹配）。"""
    u = local_usage()
    lh = (u.get("host") or "").split(".")[0].lower()
    if name and lh and name.split(".")[0].lower() == lh:
        return True
    return bool(ip) and ip in (u.get("ips") or [])


# 远端一条命令同时算 CPU%（两次 /proc/stat 差值）和内存水位。
# 命令是常量；主机名只作为 ssh 的 argv 参数传入，不会被拼进 shell。
_MET_CMD = (
    "sn() { awk '/^cpu /{t=0;i=0;for(k=2;k<=NF;k++){t+=$k; if(k==5||k==6)i+=$k} "
    "print t, i; exit}' /proc/stat; }; "
    "a=$(sn); sleep 0.2; b=$(sn); "
    "m=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t+0, a+0}' /proc/meminfo); "
    "echo \"CCMET $a $b $m\""
)
_HOST_MET = {}
_HOST_MET_LOCK = threading.Lock()
_MET_TTL = 15          # 采集成功缓存 15 秒
_MET_RETRY = 300       # 失败后 5 分钟内不再尝试，避免每轮刷新都卡 ssh 超时


def _parse_metrics(out):
    # 远端只认自己打的标记行，避免登录 banner / motd 里的数字被当成采样值
    line = ""
    for ln in (out or "").splitlines():
        if ln.startswith("CCMET"):
            line = ln[5:]
    if not line:
        line = (out or "").strip()
    line = line.strip()
    nums = [x for x in re.split(r"\s+", line)
            if re.match(r"^\d+(\.\d+)?$", x)]
    if len(nums) < 6:
        return None
    t1, i1, t2, i2, mt, av = [float(x) for x in nums[:6]]
    span = t2 - t1
    cpu = None
    if span > 0:
        cpu = int(round(max(0.0, min(100.0, (1.0 - (i2 - i1) / span) * 100.0))))
    mem = None
    if mt > 0:
        mem = int(round(max(0.0, min(100.0, (1.0 - av / mt) * 100.0))))
    return {"cpu": cpu, "mem": mem}


def remote_usage(cfg, target, timeout=6):
    """ssh 到目标节点读 /proc，返回 ({cpu,mem}|None, err)。

    cephadm 部署时 bootstrap 节点本来就有到各主机的免密 key，直接复用；
    没有 key 就失败——失败即如实留空，不改用本地数据冒充。
    """
    user = getattr(cfg, "host_ssh_user", "root") or "root"
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", target or ""):
        return None, "主机名不合法"
    if shutil.which("ssh") is None:
        return None, "本机没有 ssh 客户端"
    dest = "%s@%s" % (user, target)
    base = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
            "-o", "LogLevel=ERROR", "-o", "PreferredAuthentications=publickey"]
    # accept-new 需要 OpenSSH 7.6+；老发行版（CentOS 7 是 7.4）会直接报错，
    # 这种情况下退一次到不写 known_hosts 的只读抓取，别让整列变成未采集。
    plans = [(base + ["-o", "StrictHostKeyChecking=accept-new", dest, _MET_CMD], True),
             (base + ["-o", "StrictHostKeyChecking=no",
                      "-o", "UserKnownHostsFile=/dev/null", dest, _MET_CMD], False)]
    last = "ssh 失败"
    for argv, primary in plans:
        try:
            rc, out, err = run(argv, timeout)
        except Exception as e:
            return None, str(e)
        if rc == 0:
            return _parse_metrics(out), ""
        msg = (err or out or "ssh 失败").strip().splitlines()
        last = (msg[-1] if msg else "ssh 失败")[:160]
        if not primary or not re.search(r"accept-new|Bad configuration option|Unsupported option",
                                        err or ""):
            break
    return None, last


# --------------------------------------------------------------------------
# remote execution (binary / package-installed clusters)
#   cephadm 有 orchestrator：`ceph orch daemon stop` / `orch device zap` 都是
#   mon 侧下发，控制台在哪台机器上跑都行。二进制包安装没有这一层：
#   systemctl、ceph-volume、ceph-disk 必须落到「盘所在的那台主机」上执行。
#   这里只补这一个能力缺口，命令本身仍然由 build_plan 生成，argv 原样传递：
#     * 本机命令直接 exec，不经 shell；
#     * 远端命令由 ssh 拼成一行，每个 token 都过 shlex.quote；
#     * 主机名只作为 ssh 的 argv 参数，不会被拼进命令里（防注入）。
#   执行层不可用时绝不用本机命令顶替 —— 那会把盘操作打到错误的机器上。
# --------------------------------------------------------------------------
SSH_PROBE_CACHE = {}       # host -> {"ts":..., "ok":..., "out":..., "err":...}
_SSH_LOCK = threading.Lock()
SSH_OK_TTL = 60            # 连通时缓存 60s
SSH_BAD_TTL = 30           # 失败后 30s 内不再重试，避免每次刷新都卡超时


def ssh_settings(cfg):
    """当前生效的远程执行配置（已做过范围钳制与兜底）。"""
    st = dict(getattr(cfg, "ssh", None) or {})
    return {"enabled": st.get("enabled", True) is not False,
            "user": str(st.get("user") or "root"),
            "port": _int_arg(st.get("port"), None, 22),
            "key": str(st.get("key") or ""),
            "sudo": st.get("sudo", True) is not False,
            "connect_timeout": _int_arg(st.get("connect_timeout"), None, 6, 2, 60)}


def ssh_client():
    return shutil.which("ssh") or ""


def ssh_ready(cfg):
    """远程执行是否可用：开关打开 + 本机有 ssh 客户端。"""
    return bool(ssh_settings(cfg)["enabled"] and ssh_client())


def host_is_local(host):
    """这台主机是不是控制台所在的机器（主机名 / 短名 / 本机任一 IP）。"""
    if not host:
        return True
    try:
        u = local_usage()
    except Exception:
        u = {}
    name = str(host).split(".")[0].lower()
    lh = (u.get("host") or socket.gethostname() or "").split(".")[0].lower()
    if name and lh and name == lh:
        return True
    return bool(host) and host in (u.get("ips") or [])


def _sudo_wrap(cfg, argv, sudo, local=False):
    """需要提权时前置 sudo -n（-n = 不提示输入密码，失败就报错，绝不挂住）。"""
    st = ssh_settings(cfg)
    use = st["sudo"] if sudo is None else bool(sudo)
    if not use:
        return list(argv)
    try:
        if os.geteuid() == 0:
            return list(argv)     # 本地已经是 root，再加 sudo 反而多一层
    except AttributeError:
        # 非 Linux（开发机 / 测试）：谈不上 sudo，原样执行
        if local:
            return list(argv)
    return ["sudo", "-n"] + list(argv)


def host_run(cfg, host, argv, timeout=60, sudo=None):
    """在指定主机执行 argv，返回 (rc, out, err, via)。

    host 为空或就是本机 → 直接执行（via='local'）；
    否则经 ssh 下发（via='ssh'）。任何「做不到」都返回 rc=127 与原因，
    调用方据此报错，绝不静默改成在本机执行。
    """
    argv = [str(x) for x in argv]
    via = "local"
    if host and not host_is_local(host):
        st = ssh_settings(cfg)
        if not st["enabled"]:
            return 127, "", "远程执行未启用：系统设置 → 远程执行（或 --ssh-user）", "disabled"
        if not ssh_client():
            return 127, "", "控制台主机上没有 ssh 客户端（openssh-clients）", "nossh"
        if not HOST_RE.match(str(host)):
            return 127, "", "主机名不合法：%s" % host, "badhost"
        dest = "%s@%s" % (st["user"], host)
        remote = cmd_str(_sudo_wrap(cfg, argv, sudo))
        base = ["ssh", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
                "-o", "ConnectTimeout=%d" % st["connect_timeout"],
                "-p", str(st["port"])]
        if st["key"]:
            base += ["-i", st["key"]]
        # accept-new 需要 OpenSSH 7.6+；CentOS 7（7.4）只认 StrictHostKeyChecking=no。
        # 只在「参数不被支持」时降级重试，避免命令已经执行成功再跑第二遍。
        plans = [base + ["-o", "StrictHostKeyChecking=accept-new", "--", dest, remote],
                 base + ["-o", "StrictHostKeyChecking=no",
                         "-o", "UserKnownHostsFile=/dev/null", "--", dest, remote]]
        for i, cmd in enumerate(plans):
            rc, out, err = run(cmd, timeout)
            if rc == 0:
                return rc, out, err, "ssh"
            if i == 0 and re.search(r"Bad configuration option|Unsupported option|"
                                    r"command-line: line 0", err or ""):
                continue
            return rc, out, err, "ssh"
        return 127, "", "ssh 不可用", "ssh"
    return run(_sudo_wrap(cfg, argv, sudo, local=True), timeout) + (via,)


def ssh_probe(cfg, host, timeout=6, force=False):
    """只读探活：能不能 ssh 到这台主机。结果缓存，避免页面刷新卡 ssh 超时。"""
    host = str(host or "")
    if not host:
        return {"host": host, "local": True, "ok": True, "out": "", "err": ""}
    local = host_is_local(host)
    if local:
        return {"host": host, "local": True, "ok": True, "out": socket.gethostname(), "err": ""}
    now = time.time()
    with _SSH_LOCK:
        c = dict(SSH_PROBE_CACHE.get(host) or {})
    if c and not force and now - c.get("ts", 0) < (SSH_OK_TTL if c.get("ok") else SSH_BAD_TTL):
        return {"host": host, "local": False, "ok": bool(c.get("ok")),
                "out": c.get("out", ""), "err": c.get("err", "")}
    rc, out, err, via = host_run(cfg, host, ["hostname"], timeout, sudo=False)
    msg = (err or out or "").strip().splitlines()
    res = {"host": host, "local": False, "ok": rc == 0,
           "out": (out or "").strip().splitlines()[0][:80] if rc == 0 and out.strip() else "",
           "err": "" if rc == 0 else ((msg[-1] if msg else "ssh 失败")[:160] + ("" if via == "ssh" else "（%s）" % via))}
    with _SSH_LOCK:
        SSH_PROBE_CACHE[host] = {"ts": now, "ok": res["ok"], "out": res["out"], "err": res["err"]}
    return res


def ssh_summary(cfg, hosts=None, probe=False):
    """给页面用的远程执行概况：配置 + 可选逐主机连通性。"""
    st = ssh_settings(cfg)
    ready = ssh_ready(cfg)
    out = {"enabled": st["enabled"], "ready": ready, "user": st["user"],
           "port": st["port"], "key": st["key"], "sudo": st["sudo"],
           "connect_timeout": st["connect_timeout"], "client": ssh_client(),
           "hosts": [], "local_host": (local_usage().get("host") or socket.gethostname())}
    if not ready:
        out["reason"] = ("远程执行已关闭" if not st["enabled"]
                         else "控制台主机上没有 ssh 客户端（openssh-clients）")
    for h in (hosts or []):
        out["hosts"].append(ssh_probe(cfg, h) if probe
                            else {"host": h, "local": host_is_local(h), "ok": None, "err": ""})
    return out


def apply_remote_settings(cfg, settings):
    """把 config.json 里的 ssh / deploy_mode 合并进运行时配置。

    命令行显式给过值的项优先（避免页面上改一次就把运维的启动参数覆盖掉）。
    """
    st = ssh_settings(cfg)
    saved = settings.get("ssh") if isinstance(settings.get("ssh"), dict) else {}
    if saved:
        if "user" in saved and saved.get("user"):
            st["user"] = str(saved["user"])[:64]
        if "port" in saved:
            st["port"] = _int_arg(saved.get("port"), None, st["port"])
        if "key" in saved:
            st["key"] = str(saved.get("key") or "")[:512]
        if "enabled" in saved:
            st["enabled"] = saved.get("enabled") is not False
        if "sudo" in saved:
            st["sudo"] = saved.get("sudo") is not False
        if "connect_timeout" in saved:
            st["connect_timeout"] = _int_arg(saved.get("connect_timeout"), None, 6, 2, 60)
    cfg.ssh = st
    cfg.host_ssh_user = st["user"]
    mode = str(settings.get("deploy_mode") or "auto").lower()
    cfg.deploy_override = mode if mode in ("auto", "cephadm", "legacy") else "auto"
    return cfg


def host_usage(cfg, name, ip):
    """返回 (cpu, mem, src, err)。本机读 /proc，其它节点走 ssh（--host-metrics）。"""
    mode = getattr(cfg, "host_metrics", "auto") or "auto"
    key = name or ip or "?"
    now = time.time()
    with _HOST_MET_LOCK:
        cached = dict(_HOST_MET.get(key) or {})
    if cached:
        ttl = _MET_RETRY if cached.get("err") else _MET_TTL
        if now - cached.get("ts", 0) < ttl:
            return cached.get("cpu"), cached.get("mem"), cached.get("src", ""), cached.get("err", "")
    if mode == "off":
        res = {"ts": now, "cpu": None, "mem": None, "src": "", "err": "已关闭主机指标采集"}
    elif _is_local_node(name, ip):
        u = local_usage()
        res = {"ts": now, "cpu": u.get("cpu"), "mem": u.get("mem"), "src": "local", "err": ""}
    else:
        m, err = remote_usage(cfg, ip or name)
        res = {"ts": now, "cpu": (m or {}).get("cpu"), "mem": (m or {}).get("mem"),
               "src": "ssh" if m else "", "err": err}
    with _HOST_MET_LOCK:
        _HOST_MET[key] = res
    return res["cpu"], res["mem"], res["src"], res["err"]


def fill_host_usage(cfg, hosts):
    """给每台主机补 CPU / 内存，多节点并行 ssh，避免串行累加延迟。"""
    if not hosts:
        return hosts
    results = {}

    def work(h):
        try:
            results[h["name"]] = host_usage(cfg, h["name"], h.get("ip", ""))
        except Exception as e:
            results[h["name"]] = (None, None, "", str(e))

    threads = []
    for h in hosts:
        t = threading.Thread(target=work, args=(h,))
        t.daemon = True
        threads.append(t)
        t.start()
    for t in threads:
        t.join(9)
    for h in hosts:
        cpu, mem, src, err = results.get(h["name"], (None, None, "", ""))
        h["cpu"], h["mem"], h["src"], h["err"] = cpu, mem, src, err
    return hosts


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
    # MON / MGR：`ceph status` 的 monmap 在新版本只有 num_mons（没有 mons 数组），
    # 个别版本 mgrmap 也不带 active_name —— 直接读 status 会把成员名、leader、
    # MGR active 全显示成「—」。改由 quorum_status / mon dump / mgr dump 提供，
    # status 仅兜底。
    mon_list, quorum, mon_leader = read_mons(cfg, doc)
    mon_in = len([m for m in mon_list if m["inQuorum"]])
    if not mon_list:
        mon_in = len(quorum or [])
    mon_total = _g(monmap, "num_mons") or len(mon_list)
    if mon_total < len(mon_list):
        mon_total = len(mon_list)
    mgr = read_mgr(cfg, doc)
    return {"health": health, "fsid": doc.get("fsid", ""),
            "version": probe.version, "codename": probe.codename,
            "osds": osds, "osdsUp": up, "osdsIn": inn,
            "mons": mon_total, "monInQuorum": mon_in, "monList": mon_list,
            "monLeader": mon_leader,
            "mgrActive": mgr["active"], "mgrStandbys": mgr["standbys"],
            "mgrAvailable": mgr["available"],
            "pgs": pgs, "pgActiveClean": pg_active_clean, "pgDegraded": pg_bad,
            "pgBackfill": pg_backfill,
            "recoveringBytes": _g(pgmap, "recovering_bytes_per_sec") or 0,
            "used": raw_used, "total": raw_total,
            "iops": (_g(pgmap, "read_op_per_sec") or 0) + (_g(pgmap, "write_op_per_sec") or 0),
            "throughput": (_g(pgmap, "read_bytes_sec") or 0) + (_g(pgmap, "write_bytes_sec") or 0),
            "objects": _g(pgmap, "num_objects") or 0,
            "deploy": probe.orchestrator}


def _dev_path(d):
    """Normalise a device name to /dev/xxx (multi-device strings keep the first)."""
    d = str(d or "").strip()
    if not d:
        return ""
    d = d.split(",")[0].strip()
    if not d:
        return ""
    return d if d.startswith("/") else "/dev/" + d


def _run_argv(cfg, argv, timeout=60):
    """ceph 命令需要注入 conf / keyring；systemctl 等系统命令原样执行。"""
    if argv and argv[0] == "ceph":
        return ceph_run(cfg, list(argv[1:]), timeout)
    return run(argv, timeout)


def osd_daemon_cmd(probe, action, oid):
    """停 / 起 OSD 守护进程（action = stop / start）。

    `ceph osd down` 只是把 osdmap 里的标记改成 down，守护进程还活着时心跳会
    立刻把它改回 up —— 这就是「踢盘只生效了 out、down 没生效」的原因。
    要让 down 真正保持住，必须停掉进程本身：cephadm 走 orch，包安装走 systemctl。
    """
    if probe.caps.get("orch") or probe.orchestrator == "cephadm":
        return ["ceph", "orch", "daemon", action, "osd.%d" % oid]
    return ["systemctl", action, "ceph-osd@%d" % oid]


def osd_upin_state(cfg, oid):
    """单个 OSD 的权威 up / in / 权重（来自 ceph osd dump，df 里没有这几个字段）。

    crush_weight 用来在「原编号重建」之后把设备权重改回原值：新建的 OSD 默认
    权重是 1.0，而 cephadm 部署的 NVMe 常常是 3.6 之类的真实值，不恢复会让
    这块盘承载的数据量明显偏少。
    """
    doc, _ = ceph_json(cfg, ["osd", "dump"], 30)
    if isinstance(doc, dict):
        for o in (doc.get("osds") or []):
            if not isinstance(o, dict):
                continue
            try:
                if int(o.get("osd")) == int(oid):
                    try:
                        weight = float(o.get("crush_weight") or 0)
                    except (TypeError, ValueError):
                        weight = 0.0
                    return {"up": bool(o.get("up")), "in": bool(o.get("in")),
                            "weight": weight}
            except (TypeError, ValueError):
                continue
    return None


def check_downout(cfg, oid):
    """踢盘后复核：down 与 out 是否真的都生效了。"""
    st = osd_upin_state(cfg, oid)
    if st is None:
        return {"ok": False, "up": None, "in": None,
                "message": "osd.%d 状态读取失败（ceph osd dump 无返回）" % oid}
    if (not st["up"]) and (not st["in"]):
        return {"ok": True, "up": False, "in": False,
                "message": "osd.%d 已 down 且 out" % oid}
    reasons = []
    if st["up"]:
        reasons.append("仍为 up：OSD 守护进程没停掉（或权限不足），心跳把它改回了 up。"
                       "在集群节点执行 ceph orch daemon stop osd.%d 或 systemctl stop ceph-osd@%d 后重试"
                       % (oid, oid))
    if st["in"]:
        reasons.append("仍为 in：osd out 未生效")
    return {"ok": False, "up": st["up"], "in": st["in"],
            "message": "osd.%d %s" % (oid, "；".join(reasons))}


def osd_map_flags(cfg):
    """从 ceph osd dump 读出每个编号的真实标记（exists / up / destroyed / new）。

    cephadm `orch osd rm --replace` 走完的硬证据，是 osd.<id> 在 osdmap 里带
    destroyed 标记：只有这时 OSDSpec 才会在下一次部署时认领这个编号。没有
    destroyed 就 zap 新盘，编排器会把它当成一块全新的盘、分配一个新编号 ——
    这正是「一键换盘变成新增磁盘」的根因。
    """
    doc, err = ceph_json(cfg, ["osd", "dump"], 30)
    if not isinstance(doc, dict):
        return None, err or "ceph osd dump 无返回"
    flags = {}
    for o in (doc.get("osds") or []):
        if not isinstance(o, dict):
            continue
        try:
            oid = int(o.get("osd"))
        except (TypeError, ValueError):
            continue
        flags[oid] = [str(x).lower() for x in (o.get("state") or [])
                      if isinstance(x, (str, bytes))]
    return flags, ""


def osd_destroyed(cfg, oid):
    """原编号是否已释放为 destroyed，可以被 OSDSpec 复用。"""
    flags, _ = osd_map_flags(cfg)
    return bool(flags and "destroyed" in (flags.get(int(oid)) or []))


def osdspec_managed(cfg):
    """是否存在能自动按编号重建 OSD 的 managed OSDSpec。"""
    doc, err = ceph_json(cfg, ["orch", "ls", "--service-type", "osd"], 30)
    if doc is None:
        return False, err or "ceph orch ls --service-type osd 无返回"
    items = doc if isinstance(doc, list) else (doc.get("services") or [])
    managed = [x for x in items if isinstance(x, dict)
               and not bool(x.get("unmanaged"))]
    if not managed:
        return False, ("没有可用的 OSDSpec：ceph orch ls --service-type osd 里的服务"
                       "全部是 unmanaged=true（或根本没有 osd 服务）。这种状态下 zap "
                       "之后不会有任何 daemon 被重建，必须先配置匹配该主机的 managed "
                       "spec（ceph orch apply osd --all-available-devices 或 apply -i）")
    return True, ""


def _queue_age_min(ts):
    """ceph orch osd rm status 里的时间是 UTC ISO 串，返回已排队分钟数。"""
    if not ts:
        return None
    try:
        s = str(ts).replace("Z", "").split("+")[0].split(".")[0]
        start = datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
        return max(0.0, (datetime.utcnow() - start).total_seconds() / 60.0)
    except (ValueError, TypeError):
        return None


def osd_rm_queue(cfg):
    """只读回读 ceph orch osd rm status：谁还在移除队列里、卡了多久。

    cephadm 的 --replace 是异步队列。只要还留着 draining / done, waiting for
    purge 的条目，原编号就不会变成 destroyed，这时做第 ② 步一定失败。
    """
    doc, err = ceph_json(cfg, ["orch", "osd", "rm", "status"], 30)
    if doc is None:
        return None, err or "ceph orch osd rm status 无返回"
    items = doc if isinstance(doc, list) else (doc.get("osds") or doc.get("queue") or [])
    rows = []
    for x in items:
        if not isinstance(x, dict):
            continue
        try:
            i = int(x.get("osd_id"))
        except (TypeError, ValueError):
            continue
        started = x.get("process_started_at") or x.get("drain_started_at") or ""
        rows.append({"osd_id": i, "draining": bool(x.get("draining")),
                     "drainDone": bool(x.get("drain_done_at")),
                     "replace": bool(x.get("replace")), "force": bool(x.get("force")),
                     "startedAt": started, "ageMin": _queue_age_min(started)})
    return rows, ""


def queue_state(row):
    """把一条移除队列记录翻译成人能看懂的状态。"""
    if not row:
        return "none"
    if row.get("drainDone") and not row.get("draining"):
        return "done-waiting-for-purge"
    if row.get("draining"):
        return "draining"
    return "pending"


def osd_safe_to_destroy(cfg, oid):
    """cephadm 在 purge 前反复执行的只读检查：ceph osd safe-to-destroy <id>。

    ok=True/False/None（None 表示采集不到，不能当成通过）。PG 不是 active+clean、
    或 OSD 被手工停掉后没有 stats 时，mon 一直返回 EAGAIN / EBUSY，队列就永远
    停在 "done, waiting for purge"，编号不会变成 destroyed。
    """
    rc, out, err = ceph_run(cfg, ["osd", "safe-to-destroy", str(int(oid))], 30)
    text = (err or "").strip() or (out or "").strip()
    low = text.lower()
    if rc == 127 or not text or "no valid command" in low or "unknown command" in low:
        return {"ok": None, "message": "读不到 ceph osd safe-to-destroy %d（%s）"
                % (oid, text or "无返回")}
    if rc == 0 and "Error E" not in text:
        return {"ok": True, "message": text[:300]}
    return {"ok": False, "message": text[:400]}


def _dev_key(path):
    """把分区路径归一到整盘：/dev/nvme0n2p1、/dev/sda1 -> /dev/nvme0n2、/dev/sda。"""
    p = str(path or "").strip()
    p = re.sub(r"p\d+$", "", p)
    p = re.sub(r"^(/dev/(?:sd|vd|hd)[a-z]+)\d+$", r"\1", p)
    return p


def device_owner(cfg, dev):
    """这块盘现在被哪个 OSD 占用。

    优先看 `ceph orch device ls` 里 LVM 标签上的 osd_id（cephadm 现场扫描到的
    真实归属），再用 osd metadata 兜底。旧 OSD 的 metadata 可能还留着旧设备路径，
    只看 metadata 会把「新盘其实已经被新编号占了」误判成「还挂在原编号」。
    """
    if not dev:
        return None
    key = _dev_key(dev)
    doc, _ = ceph_json(cfg, ["orch", "device", "ls"], 30)
    if isinstance(doc, list):
        for h in doc:
            if not isinstance(h, dict):
                continue
            for d in (h.get("devices") or []):
                if not isinstance(d, dict) or _dev_key(d.get("path") or "") != key:
                    continue
                for lv in (d.get("lvs") or []):
                    if not isinstance(lv, dict) or lv.get("osd_id") is None:
                        continue
                    try:
                        return int(lv["osd_id"])
                    except (TypeError, ValueError):
                        continue
    dev_by_id, _ = osd_used_devices(cfg)
    for i, d in (dev_by_id or {}).items():
        if d and _dev_key(d) == key:
            try:
                return int(i)
            except (TypeError, ValueError):
                continue
    return None


def retire_prereq(cfg, oid, cephadm=True):
    """① 换盘前·清退的硬门禁：OSD 必须真的已经 down。

    1.1.24 起换盘**不保留 OSD 编号**：① 用 mon 侧命令式
    `ceph osd purge <id> --yes-i-really-mean-it` 把旧编号连同 CRUSH / auth /
    osdmap 记录一起删掉，② 让新盘以新编号加入。purge 不经过 cephadm 的
    --replace 队列，也不做 osd safe-to-destroy 检查，因此单节点 / PG 不
    active+clean 的拓扑不会再卡在 done, waiting for purge。

    结果是不可逆的：旧编号消失、旧盘数据放弃。所以仍 up 时坚决拒绝。
    """
    oid = int(oid)
    flags, err = osd_map_flags(cfg)
    info = {"ok": False, "down": False, "out": False, "exists": False,
            "alreadyRetired": False, "blockers": [], "warnings": [],
            "queue": [], "message": ""}
    st = osd_upin_state(cfg, oid)
    info["exists"] = bool(st)
    # purge 之后编号从 osdmap 消失；老版本可能短暂留下 destroyed 标记，都算已清退。
    if st is None or (flags and "destroyed" in (flags.get(oid) or [])):
        info.update({"ok": True, "down": True, "out": True,
                     "alreadyRetired": True})
        info["message"] = ("osd.%d 已从 osdmap 移除，清退已完成：现场换盘后执行"
                           "第 ② 步「新盘入群」，新盘会分配一个新的 OSD 编号" % oid)
        return info
    info["down"] = not st["up"]
    info["out"] = not st["in"]
    if st["up"]:
        info["blockers"].append(
            "osd.%d 仍是 up：清退会永久删除该 OSD 的编号与身份，健康盘不能这样操作。"
            "先确认故障盘已下线（ceph osd down %d && ceph osd out %d，或让故障盘"
            "自然 down），在 ceph osd tree 里看到 down 后再点清退" % (oid, oid, oid))
    if cephadm:
        rows, qerr = osd_rm_queue(cfg)
        info["queue"] = rows or []
        mine = [r for r in (rows or []) if r["osd_id"] == oid]
        if mine:
            info["warnings"].append(
                "ceph orch osd rm status 里 osd.%d 还有未完成的 --replace 任务（%s）："
                "本步会先用 ceph orch osd rm stop %d 清掉它（只取消移除任务，不动数据），"
                "再用 mon 命令式 purge 删除编号，不依赖这个队列走完"
                % (oid, queue_state(mine[0]), oid))
        elif rows is None:
            info["warnings"].append("读不到 ceph orch osd rm status（%s）；"
                                    "不影响 purge，但建议人工看一眼有没有僵尸任务"
                                    % (qerr or "无返回"))
        others = [r for r in (rows or []) if r["osd_id"] != oid]
        if others:
            info["warnings"].append(
                "移除队列里还有别的任务 %s（可能是旧版留下的僵尸任务）：purge "
                "不依赖它们，但建议用 ceph orch osd rm stop <id> 清掉，避免编排器"
                "一直重跑无效调度"
                % "、".join("osd.%d/%s" % (r["osd_id"], queue_state(r)) for r in others))
    info["warnings"].append(
        "本步不可逆：ceph osd purge %d 会同时删除 CRUSH 条目、认证与 osdmap 记录，"
        "旧编号 osd.%d 不再保留，旧盘上的数据视为放弃；第 ② 步的新盘由 mon "
        "分配一个新编号（可能与旧编号相同，也可能不同，平台不做保证）" % (oid, oid))
    if not info["blockers"]:
        info["ok"] = True
        info["message"] = ("osd.%d 已 down（%s），可以清退：删除旧编号，现场换盘后"
                           "以新编号加入"
                           % (oid, "且已 out" if info["out"] else "仍 in，流程会先 out"))
    else:
        info["message"] = "；".join(info["blockers"])
    return info


def check_retire(cfg, oid, cephadm=True):
    """① 清退后的复核：旧编号是否已从 osdmap 彻底删除。

    purge 是 mon 侧同步操作，执行完就该生效；不再有「等 --replace 队列
    变成 destroyed」这种异步等待，也不再区分 pending / blocked 的轮询。
    没删干净就明确报错并给出手工命令，不让前端无限转圈。
    """
    oid = int(oid)
    st = osd_upin_state(cfg, oid)
    flags, err = osd_map_flags(cfg)
    destroyed = bool(flags and "destroyed" in (flags.get(oid) or []))
    base = {"ok": False, "down": bool(st and not st["up"]),
            "out": bool(st and not st["in"]), "destroyed": destroyed,
            "pending": False, "blocked": False, "action": None, "fix": []}
    if st is None or destroyed:
        base.update({"ok": True, "action": "deploy"})
        base["message"] = ("osd.%d 已从 osdmap 删除，旧编号不再保留。现场换盘后"
                           "执行第 ② 步「新盘入群」，新盘会分配一个新 OSD 编号" % oid)
        return base
    if flags is None:
        base.update({"blocked": True, "action": "manual"})
        base["message"] = "读不到 ceph osd dump，无法确认清退结果：%s" % (err or "无返回")
        base["fix"] = ["ceph osd tree", "ceph osd dump --format=json"]
        return base
    base.update({"blocked": True, "action": "manual"})
    base["fix"] = [
        "ceph osd tree",
        "ceph osd out %d" % oid,
        "ceph osd purge %d --yes-i-really-mean-it" % oid,
        "ceph orch osd rm stop %d   # 若还有旧的 --replace 僵尸任务" % oid,
        "ceph osd dump --format=json   # 期望 osd.%d 不再出现在 osds[]" % oid,
    ]
    base["message"] = (
        "osd.%d 仍在 osdmap（state=%s）：清退没删干净，purge 可能失败了。"
        "这一步不靠等待自愈，不会自动完成，请按上面的命令手工确认 / 重做，"
        "成功后再现场换盘。"
        % (oid, "/".join(flags.get(oid) or ["exists"])))
    return base


def replace_prereq(cfg, oid, dev=None):
    """② 换盘后·新盘入群之前的硬门禁（1.1.24 起换盘不保留编号）。

    只拦真正危险的一件事：**目标盘正被别的 OSD 使用**。zap 会抹掉整块盘，
    盘位填错时必须拒绝。其余信息（旧编号是否还在、OSDSpec 是否 managed、
    osdmap 里有没有残留的 state=new 编号）都只是提示：新编号由 mon 分配、
    创建走命令式 ceph orch daemon add osd，不依赖 destroyed / osd_id_claims。
    """
    oid = int(oid)
    blockers = []
    info = {"ok": False, "owner": None, "newOsds": [], "warnings": [],
            "blockers": blockers, "oldOsdRetired": False}
    flags, err = osd_map_flags(cfg)
    if flags is None:
        blockers.append("读不到 ceph osd dump，无法确认设备归属：" + (err or "无返回"))
        return info
    info["oldOsdRetired"] = oid not in flags or "destroyed" in (flags.get(oid) or [])
    if not info["oldOsdRetired"]:
        info["warnings"].append(
            "osd.%d 仍在 osdmap（state=%s）：① 清退可能没做或没成功。本步仍可继续，"
            "但旧编号不会被复用，新盘会拿到一个新编号；建议先确认 ① 已完成"
            % (oid, "/".join(flags.get(oid) or ["exists"])))
    owner = device_owner(cfg, dev)
    info["owner"] = owner
    if owner is not None:
        # 只拦「正被一个 up/in 的健康 OSD 使用」的盘。旧版误操作留下的
        # down/out、state=new 记录或盘上的旧 LVM 标签（osd_id 还指向旧编号）
        # 恰恰是 zap 要清掉的东西，拦掉它们会让新盘永远加不进来。
        st_owner = osd_upin_state(cfg, owner)
        if st_owner and st_owner.get("up") and st_owner.get("in"):
            blockers.append("%s 当前属于 osd.%d，该 OSD 是 up/in，zap 会抹掉"
                            "一块正在服务的数据盘；请核对设备路径"
                            % (dev or "<新盘>", owner))
        else:
            info["warnings"].append(
                "%s 的旧签名 / metadata 仍指向 osd.%d（该 OSD 当前不是 up/in，"
                "多半是旧版残留记录或换盘前的旧标签）：本步 zap 正是要清掉它，"
                "不阻断；执行前请用 lsblk -o NAME,FSTYPE,LABEL 与盘位 / SN 再核对一次"
                % (dev or "<新盘>", owner))
    new_ids = sorted(i for i, f in flags.items() if i != oid and "new" in f)
    info["newOsds"] = new_ids
    if new_ids:
        info["warnings"].append(
            "osdmap 里存在从未上线的编号 %s（旧版误操作残留）：不影响本次入群，"
            "但建议换盘完成后用 ceph osd tree / ceph orch ps 核对并清理"
            % "、".join("osd.%d" % i for i in new_ids))
    # managed OSDSpec 不再是门禁：创建走命令式 ceph orch daemon add osd，
    # 有没有 spec 都能完成（有 spec 时编排器可能抢先自动部署，那条命令
    # 失败会被 TOLERANT_STEPS 放行）。保留字段只为兼容前端展示。
    info["specManaged"] = None
    info["warnings"].append(
        "本步会不可逆地清理 %s 上的旧签名并创建 OSD；新编号由 mon 分配，"
        "可能与 osd.%d 不同" % (dev or "<新盘>", oid))
    info["ok"] = not blockers
    return info


def orch_osd_daemon(cfg, oid):
    """cephadm 侧某个 osd 的 daemon 记录（ceph orch ps 的一行）。

    `check_replace` 要区分「容器还在起」和「容器起不来」：前者等几秒就好，
    后者等多久都不会自愈。status_desc 是唯一能区分这两者的字段。
    """
    if cfg.backend != "cli":
        return None
    doc, _ = ceph_json(cfg, ["orch", "ps", "--daemon-type", "osd"], 15)
    items = doc if isinstance(doc, list) else []
    for d in items:
        if not isinstance(d, dict):
            continue
        if str(d.get("daemon_name") or "") == "osd.%d" % int(oid):
            return d
    return None


def check_replace(cfg, oid, dev=None):
    """② 入群后复核：新盘是否被一个 up/in 的 OSD 接管。

    1.1.24 起换盘不保证编号不变，所以复核**完全与编号解耦**：不看
    osd.<old_id> 是否 up，只看「这块新盘现在归谁、那个 OSD 是否 up/in」。
    旧编号可能恰好被 mon 重新分配，也可能变成别的号，两者都算成功。
    """
    owner = device_owner(cfg, dev)
    base = {"ok": False, "up": None, "in": None, "deployed": False,
            "pending": False, "newOsd": owner, "action": None,
            "stale": False, "fix": None}
    if owner is not None:
        st = osd_upin_state(cfg, owner)
        base["up"] = (st or {}).get("up")
        base["in"] = (st or {}).get("in")
        if st and st["up"] and st["in"]:
            base.update({"ok": True, "deployed": True})
            base["message"] = (
                "新盘 %s 已由 osd.%d 接管并 up/in，换盘完成。"
                "编号由 mon 分配（原编号 osd.%d 已在 ① 清退时删除），"
                "数据开始回填；ceph -s 观察 PG 回到 active+clean"
                % (dev or "<新盘>", owner, oid))
            return base
        base.update({"pending": True, "action": "recheck"})
        # 区分「还在起」和「起不来」：cephadm 报 error 说明 daemon 已经反复重启失败。
        # 最常见的成因是编号复用后 unit.run 里的 --osd-uuid 还是上一块盘的
        # （旧 LV 已被 zap），ceph-volume activate 找不到设备，容器秒退。
        # 这种情况不会自愈，必须 redeploy 让 cephadm 按当前 osdmap 重建 unit。
        dmn = orch_osd_daemon(cfg, owner)
        if dmn and str(dmn.get("status_desc") or "") == "error":
            base.update({
                "pending": False, "action": "redeploy", "stale": True,
                "fix": {
                    "osd": owner,
                    "command": "ceph orch daemon redeploy osd.%d" % owner,
                    "why": ("osd.%d 的守护进程处于 error：cephadm 侧 unit 可能还写着"
                            "上一块盘的 osd uuid（编号复用后常见），"
                            "activate 找不到 LV，容器起来就退" % owner),
                },
            })
            base["message"] = (
                "新盘 %s 已登记到 osd.%d，但守护进程起不来（cephadm 状态 error，"
                "不是还在启动）。多半是编号复用后 unit.run 里的 --osd-uuid 还是"
                "上一块盘的，activate 找不到设备。点「修复守护进程」执行 "
                "ceph orch daemon redeploy osd.%d：只重建 unit 与容器，不 zap、不删数据"
                % (dev or "<新盘>", owner, owner))
            return base
        base["message"] = (
            "新盘 %s 已登记到 osd.%d，但守护进程还没 up/in（%s）："
            "cephadm 拉起容器常需几十秒，稍后点「重新复核」即可"
            % (dev or "<新盘>", owner,
               "down" if not base["up"] else ("out" if not base["in"] else "采集中")))
        return base
    flags, _ = osd_map_flags(cfg)
    fresh = sorted(i for i, f in (flags or {}).items() if i != oid and "new" in f)
    base.update({"pending": True, "action": "recheck",
                 "newOsd": fresh[0] if fresh else None})
    base["message"] = (
        "新盘 %s 还没被任何 OSD 认领（设备信息可能还没采到，或编排器仍在部署）："
        "%s稍后点「重新复核」，或看 ceph orch ps --daemon-type osd / ceph osd tree"
        % (dev or "<新盘>",
           ("osdmap 已出现新编号 %s。" % "、".join("osd.%d" % i for i in fresh)) if fresh else ""))
    return base


def osd_used_devices(cfg):
    """osd id -> 设备 / 主机，用来判断某块盘是否已经被 OSD 占用。"""
    ids = []
    doc, _ = ceph_json(cfg, ["osd", "dump"], 20)
    if isinstance(doc, dict):
        for o in (doc.get("osds") or []):
            if not isinstance(o, dict):
                continue
            try:
                ids.append(int(o.get("osd")))
            except (TypeError, ValueError):
                continue
    dev_by_id, host_by_id, _ = osd_device_map(cfg, ids)
    return dev_by_id, host_by_id


_OSD_HOST_CACHE = {"ts": 0.0, "map": {}}


def osd_host_map(cfg, force=False):
    """osd id -> 主机名。

    包安装集群没有 orchestrator 代跑 systemctl / ceph-volume，这两类命令必须
    落到 OSD 所在的那台机器上。主机名一律以 CRUSH 树为准（`ceph osd tree`），
    它不依赖 OSD 进程是否活着 —— metadata 在 OSD down 时是空的，靠不住。
    """
    now = time.time()
    if not force and _OSD_HOST_CACHE["map"] and now - _OSD_HOST_CACHE["ts"] < 30:
        return _OSD_HOST_CACHE["map"]
    out = {}
    doc, _ = ceph_json(cfg, ["osd", "tree"], 20)
    nodes = doc.get("nodes") if isinstance(doc, dict) else doc
    by_id = {}
    for n in (nodes or []):
        if isinstance(n, dict) and n.get("id") is not None:
            by_id[n.get("id")] = n

    def walk(n, host):
        if not isinstance(n, dict):
            return
        h = n.get("name") if n.get("type") == "host" else host
        if n.get("type") == "osd":
            try:
                out[int(n.get("id"))] = h or ""
            except (TypeError, ValueError):
                pass
        for c in (n.get("children") or []):
            walk(by_id.get(c) if not isinstance(c, dict) else c, h)

    for n in by_id.values():
        if n.get("type") in ("root", "host"):
            walk(n, "")
    _OSD_HOST_CACHE["ts"] = now
    _OSD_HOST_CACHE["map"] = out
    return out


_DEV_SCAN = {"ts": 0.0, "devices": [], "hosts": [], "mode": "", "key": ""}
_DEV_SCAN_TTL = 20
_DEV_SCAN_LOCK = threading.Lock()
_LSBLK_COLS = "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL"


def cluster_hosts(cfg):
    """动盘要下发到哪些主机：CRUSH 树里的 host 节点 + 本机。

    cephadm 时代这些命令都由 mon 转发，主机名只是参数；包安装没有转发层，
    主机名就是「ssh 去哪台机器执行」，所以这份清单必须来自集群真实拓扑。
    """
    hosts = []
    if cfg.backend != "cli":
        return hosts
    doc, _ = ceph_json(cfg, ["osd", "tree"], 20)
    nodes = doc.get("nodes") if isinstance(doc, dict) else doc
    for n in (nodes or []):
        if not isinstance(n, dict) or n.get("type") != "host":
            continue
        name = str(n.get("name") or "").strip()
        if name and name not in hosts:
            hosts.append(name)
    try:
        me = (local_usage().get("host") or socket.gethostname() or "").split(".")[0]
    except Exception:
        me = ""
    if me and me not in hosts:
        hosts.append(me)
    return hosts


def _lsblk_json(cfg, host, timeout=12):
    """在一台主机上跑 lsblk，返回 (blockdevices, err)。"""
    rc, out, err, via = host_run(cfg, host, ["lsblk", "-J", "-b", "-o", _LSBLK_COLS],
                                 timeout, sudo=False)
    if rc != 0:
        msg = (err or out or "lsblk 执行失败").strip().splitlines()
        reason = (msg[-1] if msg else "lsblk 执行失败")[:160]
        if via == "local":
            reason = "本机 lsblk 执行失败：" + reason
        return [], reason
    try:
        doc = json.loads(out) if out.strip() else {}
    except ValueError:
        return [], "lsblk 返回的不是合法 JSON"
    return (doc.get("blockdevices") or []), ""


def _free_from_lsblk(nodes, used):
    """从 lsblk 树里挑「没有任何签名、没挂载、没子分区」的整盘。"""
    out = []
    for d in (nodes or []):
        if not isinstance(d, dict):
            continue
        dev = _dev_path(d.get("name"))
        if (d.get("type") != "disk" or not dev or dev in used
                or d.get("fstype") or d.get("mountpoint") or d.get("children")):
            continue
        out.append({"dev": dev, "size": d.get("size") or 0, "note": d.get("model") or ""})
    return out


def device_scan(cfg, probe, force=False):
    """各主机的磁盘清单，供「一键换盘 / 新增磁盘」选择新盘。

    返回 {"devices": [...], "hosts": [...], "mode": "...", "ts": ...}：
      * cephadm：`ceph orch device ls` 本来就能看到全集群，一轮就够；
      * 包安装：mon 没有设备视图，只能逐个宿主机 lsblk。以前只跑本机，
        多节点集群里永远看不到别的机器的盘 —— 这是「平移不了」的核心原因之一。
    每台主机读不到都会在 hosts 里留下原因（ssh 未启用 / 不可达 / 无 lsblk），
    宁可显示「该主机未采集」，也不把本机的盘冒充成全集群的盘。
    """
    now = time.time()
    orch = bool(probe.caps.get("orch"))
    mode = getattr(probe, "deploy_mode", "") or ""
    # 缓存必须带「采集方式」：同一进程里 cephadm 与 legacy 的取盘逻辑完全不同，
    # 只按时间缓存会让切换部署方式后仍返回上一轮的结果。
    key = "%s|%s" % ("orch" if orch else "legacy", mode)
    with _DEV_SCAN_LOCK:
        cached = dict(_DEV_SCAN)
    if (not force and cached["devices"] and cached.get("key") == key
            and now - cached["ts"] < _DEV_SCAN_TTL):
        return cached
    out, hosts_info = [], []
    if cfg.backend != "cli":
        return {"devices": out, "hosts": hosts_info, "mode": mode, "ts": now, "key": key}

    if probe.caps.get("orch"):
        doc, _ = ceph_json(cfg, ["orch", "device", "ls"], 30)
        seen = set()
        for it in (doc if isinstance(doc, list) else []):
            if not isinstance(it, dict):
                continue
            host = it.get("hostname") or it.get("host") or ""
            devs = it.get("devices")
            if isinstance(devs, list) and devs and isinstance(devs[0], dict):
                for d in devs:
                    dev = _dev_path(d.get("path") or d.get("dev") or "")
                    if not dev or (host, dev) in seen:
                        continue
                    seen.add((host, dev))
                    out.append({"host": host, "dev": dev,
                                "size": d.get("size") or 0,
                                "available": bool(d.get("available")),
                                "note": ",".join(d.get("rejected_reasons") or [])})
            else:
                for p in (devs or []):
                    dev = _dev_path(p)
                    if not dev or (host, dev) in seen:
                        continue
                    seen.add((host, dev))
                    out.append({"host": host, "dev": dev,
                                "size": it.get("size") or 0,
                                "available": bool(it.get("available")),
                                "note": ""})
        hosts_info = [{"host": h, "local": host_is_local(h), "ok": bool(doc is not None),
                       "err": "" if doc is not None else "ceph orch device ls 无返回",
                       "src": "orch"} for h in sorted(set(x["host"] for x in out if x["host"]))]
        res = {"devices": sorted(out, key=lambda x: (x.get("host") or "", x.get("dev") or "")),
               "hosts": hosts_info, "mode": mode or "cephadm", "ts": now, "key": key}
        with _DEV_SCAN_LOCK:
            _DEV_SCAN.update(res)
        return res

    # 包安装 / legacy：逐台宿主机 lsblk。设备「是否在用」必须按主机算 ——
    # /dev/sda 在每台机器上都存在，拿全集群的集合去比对会把新盘全排掉。
    hosts = cluster_hosts(cfg)
    remote_ok = ssh_ready(cfg)
    dev_by_id, host_by_id = osd_used_devices(cfg)
    used_by_host = {}
    for oid, d in dev_by_id.items():
        if not d:
            continue
        h = host_by_id.get(oid) or ""
        used_by_host.setdefault(h, set()).add(d)
    results = {}

    def work(h):
        if h and not host_is_local(h) and not remote_ok:
            results[h] = ([], "控制台未启用远程执行（SSH），读不到该主机的磁盘")
            return
        try:
            nodes, err = _lsblk_json(cfg, h)
        except Exception as e:
            results[h] = ([], str(e))
            return
        used = used_by_host.get(h)
        if used is None:
            # 该主机没有已知 OSD 设备记录：仍按全集群集合排一遍（宁可少列）
            used = set(d for d in dev_by_id.values() if d)
        results[h] = (_free_from_lsblk(nodes, used), err)

    threads = []
    for h in hosts:
        t = threading.Thread(target=work, args=(h,))
        t.daemon = True
        threads.append(t)
        t.start()
    for t in threads:
        t.join(15)
    for h in hosts:
        devs, err = results.get(h, ([], "采集超时（主机无响应）"))
        for d in devs:
            out.append({"host": h, "dev": d["dev"], "size": d["size"],
                        "available": True, "note": d["note"]})
        hosts_info.append({"host": h, "local": host_is_local(h), "ok": not err,
                           "err": err, "src": "lsblk",
                           "devices": len(devs)})
    res = {"devices": sorted(out, key=lambda x: (x.get("host") or "", x.get("dev") or "")),
           "hosts": hosts_info, "mode": mode or "ceph-volume", "ts": now, "key": key}
    with _DEV_SCAN_LOCK:
        _DEV_SCAN.update(res)
    return res


def read_free_devices(cfg, probe):
    """各主机的磁盘清单（保持旧签名：只返回设备数组）。"""
    return device_scan(cfg, probe)["devices"]


_LSBLK_OSD_CACHE = {"ts": 0.0, "map": {}}
# Probe 每次刷新都会把「当前是不是 cephadm」记在这里，供不持有 probe 的
# 读路径（read_osds → osd_lsblk_map）判断要不要跨主机扫盘。
_DEPLOY_STATE = {"mode": "unknown", "orch": False}


def _lsblk_osd_map_on(cfg, host):
    """单台主机：ceph-volume LVM 名 → 整盘。返回 {fsid: {...}}。"""
    rc, txt, err, via = host_run(cfg, host, ["lsblk", "-J", "-b", "-o",
                                             "NAME,KNAME,SIZE,TYPE,FSTYPE,PKNAME,ROTA"],
                                 10, sudo=False)
    if rc != 0 or not txt.strip():
        return {}
    try:
        doc = json.loads(txt)
    except ValueError:
        return {}
    flat = {}

    def walk(nodes, parent):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            flat[n.get("name") or ""] = (n, parent)
            walk(n.get("children") or [], n.get("name") or "")

    walk(doc.get("blockdevices") or [], "")
    out = {}
    for name, (n, parent) in flat.items():
        if str(n.get("fstype") or "") != "ceph_bluestore":
            continue
        m = re.search(r"osd--block--([0-9a-f]{8}(?:--[0-9a-f]{4}){3}--[0-9a-f]{12})",
                      name)
        if not m:
            continue
        fsid = m.group(1).replace("--", "-")
        # 顺着 PKNAME 往上追到整盘（type=disk），盘符与容量都以整盘为准。
        cur_name, dev, size = parent, "", int(n.get("size") or 0)
        seen = set()
        while cur_name and cur_name not in seen:
            seen.add(cur_name)
            cur, cur_parent = flat.get(cur_name, ({}, ""))
            if cur.get("type") == "disk":
                dev = _dev_path(cur.get("name"))
                size = int(cur.get("size") or size)
                break
            cur_name = cur_parent
        rota = str(n.get("rota") or n.get("ROTA") or "") == "1"
        out[fsid] = {"dev": dev, "size": size, "rota": rota, "host": host}
    return out


def osd_lsblk_map(cfg=None):
    """osd fsid -> {"dev": 整盘, "size": 字节, "rota": bool, "host": 主机}。

    `ceph osd metadata` 只在 OSD 进程活着时才有；OSD down / daemon 起不来时
    metadata 只剩 {"id": n}，平台就会把服务器 / 设备 / 容量全显示成"未采集"。
    这里不依赖任何 ceph 命令，直接读 ceph-volume 建出来的 LVM 命名
    （ceph--<vg>--osd--block--<osd_fsid>）反查盘符与容量，down 的 OSD 也能定位。

    包安装集群里 OSD 分散在多台主机，本机 lsblk 只看得到本机的盘，所以
    cephadm 之外会按主机并行扫一遍并合并（fsid 全局唯一，合并是安全的）。
    读不到就返回空字典，调用方保持"未采集"，不猜。
    """
    now = time.time()
    if _LSBLK_OSD_CACHE["map"] and now - _LSBLK_OSD_CACHE["ts"] < 30:
        return _LSBLK_OSD_CACHE["map"]
    hosts = [""]
    if cfg is not None and getattr(cfg, "backend", "cli") == "cli" and not _DEPLOY_STATE.get("orch"):
        if ssh_ready(cfg):
            try:
                hosts = cluster_hosts(cfg) or [""]
            except Exception:
                hosts = [""]
    out, lock = {}, threading.Lock()

    def work(h):
        try:
            m = _lsblk_osd_map_on(cfg, h)
        except Exception:
            m = {}
        with lock:
            for k, v in (m or {}).items():
                out.setdefault(k, v)

    threads = []
    for h in hosts:
        t = threading.Thread(target=work, args=(h,))
        t.daemon = True
        threads.append(t)
        t.start()
    for t in threads:
        t.join(12)
    _LSBLK_OSD_CACHE["ts"] = now
    _LSBLK_OSD_CACHE["map"] = out
    return out


def osd_device_map(cfg, want=None):
    """OSD id -> 真实设备 / 主机 / 序列号。

    设备名以 `ceph osd metadata <id>` 的 bluestore_bdev 为准——它是唯一
    “按 osd 查自己那块盘”的来源。ceph-volume lvm list 仅在覆盖全部 OSD 且
    无重复时作为快路径直接采信；否则逐个用 metadata 核对覆盖。
    `ceph device ls` 只用来补仍然缺失的设备与序列号，且只采信“一个设备只挂
    一个 OSD”的记录：NVMe 的 nvme0n2 / nvme0n3 共用一个 nvme0n1 控制器，
    device ls 会把多个 daemon 挂在 nvme0n1 名下，直接采信就会出现“所有 OSD
    都叫 /dev/nvme0n1”。

    任何一个来源都拿不到就留空，前端显示“未采集”，绝不把同一块盘复制给多个 OSD。
    """
    dev_by_id, host_by_id, serial_by_id = {}, {}, {}
    if cfg.backend == "rest":
        return dev_by_id, host_by_id, serial_by_id
    ids = []
    for i in (want or []):
        try:
            ids.append(int(str(i).replace("osd.", "")))
        except (TypeError, ValueError):
            continue

    # 1) ceph-volume lvm list：{"0": [{devices:["/dev/nvme0n1"], ...}], ...}
    argv = ["ceph-volume", "lvm", "list", "--format=json"]
    if cfg.ceph_conf:
        argv += ["--conf", cfg.ceph_conf]
    rc, out, _ = run(argv, timeout=30)
    if rc == 0 and out.strip():
        try:
            data = json.loads(out)
        except ValueError:
            data = None
        entries = []
        if isinstance(data, dict):
            for k, v in data.items():
                for e in (v if isinstance(v, list) else [v]):
                    if isinstance(e, dict):
                        entries.append((k, e))
        elif isinstance(data, list):
            for e in data:
                if isinstance(e, dict):
                    entries.append((e.get("osd_id") or e.get("id") or "", e))
        for key, e in entries:
            try:
                oid = int(str(e.get("osd_id") or key).replace("osd.", ""))
            except (TypeError, ValueError):
                continue
            devs = e.get("devices") or []
            if isinstance(devs, str):
                devs = [devs]
            dev = _dev_path(devs[0]) if devs else ""
            if dev:
                dev_by_id.setdefault(oid, dev)

    # 同一设备被分给多个 OSD，说明这个来源给的是“控制器 / 整盘”级别的聚合。
    # NVMe 的 nvme0n2、nvme0n3 是 nvme0n1 控制器的 namespace，ceph device ls
    # 常把它们报成同一个 /dev/nvme0n1 —— 这种值必须丢弃，不能套给多个 OSD。
    def _dup_ids(mapping):
        seen, bad = {}, set()
        for oid in sorted(mapping):
            dev = mapping[oid]
            if dev in seen:
                bad.add(oid)
                bad.add(seen[dev])
            else:
                seen[dev] = oid
        return bad

    def _purge_dupes(mapping):
        for oid in _dup_ids(mapping):
            mapping.pop(oid, None)

    # lvm list 只有“覆盖全部 OSD 且没有重复”时才算可信快路径；否则交给
    # metadata 逐个核对（raw 部署下 lvm list 是空的，这里一定为 False）。
    lvm_ok = bool(ids) and all(i in dev_by_id for i in ids) and not _dup_ids(dev_by_id)

    # 2) ceph osd metadata <id>：唯一“按 osd 查自身设备”的来源，结果覆盖前一步。
    #    cephadm 默认 raw 部署下 lvm list 为空、device ls 只看到控制器，
    #    只有 metadata 的 bluestore_bdev 能给出 nvme0n2 / nvme0n3。
    if not lvm_ok and ids and len(ids) <= 64:
        for oid in ids:
            meta, _ = ceph_json(cfg, ["osd", "metadata", str(oid)], timeout=5)
            if not isinstance(meta, dict):
                continue
            raw = meta.get("bluestore_bdev") or meta.get("devices") or ""
            if isinstance(raw, list):
                raw = raw[0] if raw else ""
            dev = _dev_path(raw)
            if dev:
                dev_by_id[oid] = dev
            host = meta.get("hostname") or ""
            if host:
                host_by_id.setdefault(oid, host)

    # metadata 也拿不到时，清掉前面来源里的重复项（宁可未采集，不给错设备）。
    _purge_dupes(dev_by_id)

    # 3) ceph device ls：只补仍然缺设备的 OSD，并且只信任“一个设备只挂一个 OSD”
    #    的记录；多 daemon 的记录是控制器级聚合，用它会重现“所有盘都叫 nvme0n1”。
    doc, _ = ceph_json(cfg, ["device", "ls"])
    items = doc if isinstance(doc, list) else (
        (doc.get("devices") or []) if isinstance(doc, dict) else [])
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            loc = item.get("location")
            if isinstance(loc, list):
                loc = loc[0] if loc and isinstance(loc[0], dict) else {}
            elif not isinstance(loc, dict):
                loc = {}
            dev = _dev_path(loc.get("dev") or loc.get("path") or item.get("dev") or "")
            host = loc.get("host") or item.get("host") or ""
            sn = item.get("device_id") or item.get("serial") or ""
            oids = []
            for daemon in (item.get("daemons") or []):
                m = re.match(r"osd\.(\d+)", str(daemon))
                if m:
                    oids.append(int(m.group(1)))
            for x in (item.get("osd_ids") or []):
                try:
                    oids.append(int(x))
                except (TypeError, ValueError):
                    pass
            for oid in oids:
                if dev and oid not in dev_by_id and len(oids) == 1:
                    dev_by_id[oid] = dev
                if host:
                    host_by_id.setdefault(oid, host)
                # SN 只在该设备确实属于这个 OSD 时才采纳，避免把控制器的
                # 序列号复制给挂在它上面的多个 namespace。
                if sn and (dev_by_id.get(oid) == dev or len(oids) == 1):
                    serial_by_id.setdefault(oid, sn)

    # 4) lsblk 兜底：OSD down 时 `ceph osd metadata` 只剩 {"id": n}，前三步都拿
    #    不到设备。ceph-volume 的 LVM 名里带着 osd fsid，能反查回盘符。
    #    没有这一条，down 的 OSD 会被当成"盘没被占用"，换盘时这块盘会出现在
    #    「可选新盘」里，zap 一下就把还在的数据抹了。
    missing = [i for i in ids if i not in dev_by_id]
    if missing:
        uuid_by_id = {}
        dump, _ = ceph_json(cfg, ["osd", "dump"], 20)
        if isinstance(dump, dict):
            for o in (dump.get("osds") or []):
                if isinstance(o, dict):
                    try:
                        uuid_by_id[int(o.get("osd"))] = str(o.get("uuid") or "")
                    except (TypeError, ValueError):
                        continue
        lb = osd_lsblk_map(cfg)
        for oid in missing:
            backing = lb.get(uuid_by_id.get(oid, "")) or {}
            if backing.get("dev"):
                dev_by_id[oid] = backing["dev"]

    # 最后再过一遍：任何重复都清空，宁可显示“未采集”也不给错设备名。
    _purge_dupes(dev_by_id)
    return dev_by_id, host_by_id, serial_by_id


def read_osds(cfg):
    if cfg.backend == "rest":
        return []

    def _oid(value):
        try:
            return int(str(value).replace("osd.", ""))
        except (TypeError, ValueError):
            return None

    # 全量 OSD 集合以 `osd dump` 为准。新加入集群的 OSD 在 `osd df` 里可能
    # 还没有统计行（进程刚起 / 尚未产生 PG / kb 还没上报），早前只遍历 df，
    # 新盘就会直接从列表里消失。df 现在只负责补容量与使用率。
    dump, _ = ceph_json(cfg, ["osd", "dump"], timeout=30)
    dump_osds = []
    if isinstance(dump, dict):
        dump_osds = [o for o in (dump.get("osds") or []) if isinstance(o, dict)]

    df, _ = ceph_json(cfg, ["osd", "df"])
    if isinstance(df, dict):
        df_nodes = df.get("nodes") or df.get("OSDs") or []
    else:
        df_nodes = df if isinstance(df, list) else []
    if not isinstance(df_nodes, list):
        df_nodes = []

    stats = {}
    for n in df_nodes:
        if not isinstance(n, dict):
            continue
        oid = _oid(n.get("id", n.get("osd", n.get("name"))))
        if oid is not None:
            stats[oid] = n

    by_dump = {}
    for o in dump_osds:
        oid = _oid(o.get("osd"))
        if oid is not None:
            by_dump[oid] = o

    ids = sorted(set(stats) | set(by_dump))
    host_by_id = {}
    tree_state = {}
    tree_osd_ids = set()

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
                # 兜底状态：status=down 表示进程停了；reweight=0 通常对应 out。
                rw = node.get("reweight")
                tree_state[node["id"]] = (
                    node.get("status") != "down",
                    (float(rw) if isinstance(rw, (int, float)) else 1.0) > 0)
            for child in node.get("children", []) or []:
                rec(child, h)
        for node in by_id.values():
            if node.get("type") == "osd":
                # 即使该 OSD 还没挂到任何 root 下（未进 CRUSH），也要能被列出来。
                tree_osd_ids.add(node["id"])
            if node.get("type") == "root":
                rec(node["id"], "")

    # 三源并集：dump（权威状态）、df（容量）、tree（CRUSH 归属）。
    # 任何一个单独出现都不能被漏掉——新盘往往先出现在 dump/tree，最后才进 df。
    ids = sorted(set(ids) | tree_osd_ids)
    if not ids:
        return []

    # 真实设备 / SN：按 osd id 精确映射，不能拿“第一个设备”套给所有 OSD。
    dev_by_id, dev_host_by_id, serial_by_id = osd_device_map(cfg, ids)
    # OSD 进程挂掉时 metadata 是空的，设备和容量只能从宿主机 lsblk 反查
    # （ceph-volume 的 LVM 名里带 osd fsid）。读不到就仍是"未采集"。
    lsblk_by_fsid = osd_lsblk_map(cfg)

    out = []
    for oid in ids:
        n = stats.get(oid) or {}
        d = by_dump.get(oid) or {}
        kb = n.get("kb", 0) or 0
        used = n.get("kb_used", 0) or 0
        util = n.get("utilization", 0) or 0
        dev = dev_by_id.get(oid) or _dev_path(n.get("device") or "")
        host = host_by_id.get(oid) or dev_host_by_id.get(oid) or ""
        fsid = str(d.get("uuid") or "")
        backing = lsblk_by_fsid.get(fsid) or {}
        size = int(kb) * 1024 if kb else 0
        if not dev and backing.get("dev"):
            dev = backing["dev"]
        if not size and backing.get("size"):
            # 没有 df 统计行（OSD down / 刚创建）时用整盘容量，标注 capacityKnown，
            # 让「设备 / 容量」不再是"未采集"——盘是哪块、多大本来就是事实。
            size = int(backing["size"])
        # up/in 以 osd dump 为准（df 里没有这两个字段），tree 兜底。
        if "up" in d:
            up = bool(d.get("up"))
        elif oid in tree_state:
            up = tree_state[oid][0]
        else:
            up = bool(n.get("up", 1))
        if "in" in d:
            inn = bool(d.get("in"))
        elif oid in tree_state:
            inn = tree_state[oid][1]
        else:
            inn = bool(n.get("in", 1))
        weight = d.get("weight")
        if not isinstance(weight, (int, float)):
            weight = n.get("crush_weight", 1) or 1
        # 介质类型只有 df 提供；新盘还没进 df 时用 lsblk 的 ROTA 兜底。
        cls = str(n.get("device_class") or n.get("type") or "").upper()
        if not cls and backing:
            cls = "HDD" if backing.get("rota") else "SSD"
        # SMART 需要 cephadm / node_exporter 侧的真实指标，这里不伪造 "OK"。
        out.append({"id": oid, "host": host,
                    "dev": dev,
                    "type": cls[:8] if cls else "",
                    "size": size, "used": int(used * 1024),
                    "capacityKnown": bool(size),
                    # capacityKnown=有容量（df 或 lsblk 整盘）；
                    # usageKnown=有 df 统计行（down 的 OSD 没有，使用率不能显示 0%）
                    "usageKnown": oid in stats,
                    "up": up, "inn": inn,
                    "pgs": n.get("pgs", 0) or 0, "weight": weight,
                    "smart": "", "serial": serial_by_id.get(oid, ""),
                    "utilization": util})
    return out


# --------------------------------------------------------------------------
# alert lifecycle
#   `health detail` 是「当前状态快照」，每 20 秒重算一次。早前直接把它当告警
#   列表返回，since 每次都是「现在」、status 每次都是 active —— 页面于是像
#   「每刷新一次就冒出一条新告警」，用户点确认也会在下一轮被覆盖回去。
#   现在按 health check code 归并：同一问题只有一条，首次发现时间、累计发作
#   次数、确认 / 静音状态都保留，并落盘到 alerts.json（重启不丢）。
# --------------------------------------------------------------------------
_ALERT_LOCK = threading.Lock()
_ALERT_STATE = {}
_ALERT_LOADED = {"done": False, "path": ""}
# 上一次成功解析出的告警行。「取不到」不等于「没有告警」：health detail 超时 /
# MON 忙时若直接返回空列表，前端会把整屏告警清掉、健康还会显示 OK。
# 失败时沿用这份快照，并通过 alertsOk=false 让前端知道数据是陈旧的。
_ALERT_LAST = {"rows": [], "ok": False, "err": "", "ts": 0}
# 最近一次真实写操作（osd in/out/kick/replace/init）的观察截止时间。
# 写操作会改变集群状态，Ceph 的 health check 有滞后期：这段时间里「health
# detail 里没有这条」不能当成「已经恢复」，否则一次 IN 就能把告警整屏刷绿。
_WRITE_GRACE_UNTIL = 0


def alert_write_grace(seconds=None):
    """记一次真实写操作，随后一窗口内不把任何告警判为已恢复。"""
    global _WRITE_GRACE_UNTIL
    sec = ALERT_WRITE_GRACE if seconds is None else int(seconds)
    _WRITE_GRACE_UNTIL = int(time.time()) + max(0, sec)
    return _WRITE_GRACE_UNTIL


def alert_state_path(cfg):
    raw = (getattr(cfg, "alert_file", "") or os.environ.get("CEPH_CONSOLE_ALERTS", "")
           or ALERT_STATE_PATH)
    folder = os.path.dirname(raw) or "."
    try:
        if not os.path.isdir(folder):
            os.makedirs(folder, 0o755)
        return raw
    except OSError:
        return os.path.join(getattr(cfg, "dir", HERE) or HERE, "alerts.json")


def alert_state_load(cfg):
    if _ALERT_LOADED["done"]:
        return
    _ALERT_LOADED["done"] = True
    _ALERT_LOADED["path"] = alert_state_path(cfg)
    try:
        with open(_ALERT_LOADED["path"], "r", encoding="utf-8") as f:
            doc = json.load(f)
        if isinstance(doc, dict):
            for k, v in doc.items():
                if isinstance(v, dict):
                    _ALERT_STATE[str(k)] = v
    except (IOError, OSError, ValueError):
        pass


def save_conf(path, data):
    """把设置写回 config.json：原子替换 + 0600。返回 (ok, error)。

    安全策略（allow_write / confirm）改动要能跨重启保留，所以必须落盘；
    写失败要让调用方回滚内存值，不能出现「页面显示已开、重启又变回去」。
    """
    tmp = path + ".tmp"
    try:
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        if hasattr(os, "replace"):
            os.replace(tmp, path)
        else:
            os.rename(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return True, ""
    except (IOError, OSError, ValueError) as e:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False, str(e)


def conf_path(cfg):
    """安全策略写到哪个文件：默认 /etc/ceph-console/config.json，
    --config-file / CEPH_CONSOLE_CONFIG 可覆盖（测试与非标准安装用）。"""
    return getattr(cfg, "conf_path", "") or CONF_PATH


def security_update(cfg, settings, user, role, body, remote=""):
    """校验并落盘「修改安全策略」。返回 (http_status, payload)。

    独立成模块函数是为了能脱离 HTTP 层测试。要点：
    - 只认 admin，且必须是真实登录会话（服务令牌没有 user）；
    - 必须重新输入该账号密码，失败计入登录失败节流，避免成为暴力破解旁路；
    - allow_write 只有在进程本身带 --allow-write 时才允许打开，否则返回 409
      说明「开了也不会下发」，不制造已开启的假象；
    - 先改内存再落盘，落盘失败回滚内存，不出现「页面显示已开、重启又变回去」。
    """
    if not user:
        return 403, {"error": "请用账号密码登录后修改安全策略（服务令牌不支持）"}
    if role != "admin":
        return 403, {"error": "只有 admin 角色可以修改安全策略"}
    users = load_users(cfg.users_file)
    rec = users.get(user)
    if not isinstance(rec, dict) or "hash" not in rec:
        return 403, {"error": "当前账号不在本地用户库中，无法修改安全策略"}
    if not login_allowed(remote):
        return 429, {"error": "尝试次数过多，请几分钟后再试"}
    if not verify_password(str(body.get("password", "") or ""), rec):
        note_login_fail(remote)
        audit("SECURITY_SETTING", "-", "-", "REJECTED", "bad password", remote, user)
        return 403, {"error": "密码不正确"}
    note_login_ok(remote)
    want = {}
    for key in ("allow_write", "confirm"):
        if key in body:
            val = body.get(key)
            if not isinstance(val, bool):
                return 400, {"error": "%s 必须是布尔值" % key}
            want[key] = val
    if not want:
        return 400, {"error": "没有需要修改的项"}
    if want.get("allow_write") is True:
        if not cfg.allow_write:
            return 409, {"error": "服务端以 DRY-RUN 启动（缺少 --allow-write），"
                                  "此开关打开也不会下发命令；请先用 --allow-write 重启服务"}
        if getattr(cfg, "read_only", False) or cfg.backend != "cli":
            return 409, {"error": "当前为只读 keyring 或 REST 后端，无法开启真实写操作"}
    old = dict((k, settings.get(k)) for k in ("allow_write", "confirm"))
    settings.update(want)
    path = conf_path(cfg)
    ok, err = save_conf(path, settings)
    if not ok:
        settings.update(old)
        audit("SECURITY_SETTING", "-", "-", "FAIL", "写入配置失败：%s" % err, remote, user)
        return 500, {"error": "写入 %s 失败：%s" % (path, err)}
    audit("SECURITY_SETTING", ",".join(sorted(want.keys())), "-", "OK",
          json.dumps(want, ensure_ascii=False), remote, user)
    return 200, {"ok": True,
                 "settings": {"allow_write": settings.get("allow_write") is True,
                              "confirm": settings.get("confirm", True) is not False},
                 "capability": bool(cfg.allow_write),
                 "read_only": bool(getattr(cfg, "read_only", False)),
                 "path": path}


def remote_update(cfg, settings, user, role, body, remote=""):
    """保存「远程执行」配置（SSH 账号 / 端口 / 私钥 / sudo）与部署方式覆盖。

    为什么单独一个入口：二进制包安装的集群没有 orchestrator，动盘命令必须
    由控制台 ssh 到目标主机执行。这是唯一需要落盘、且会改变命令「跑到哪台
    机器上」的设置，必须能一眼看清、随时能关。

    权限：只认 admin 会话。它本身不下发任何命令，真正危险的是「允许真实
    写操作」（另需密码），两者是分开的两道闸门。
    """
    if not user:
        return 403, {"error": "请用账号密码登录后修改远程执行配置（服务令牌不支持）"}
    if role != "admin":
        return 403, {"error": "只有 admin 角色可以修改远程执行配置"}
    cur = ssh_settings(cfg)
    want = {}
    src = body.get("ssh") if isinstance(body.get("ssh"), dict) else body
    if "enabled" in src:
        if not isinstance(src.get("enabled"), bool):
            return 400, {"error": "ssh.enabled 必须是布尔值"}
        want["enabled"] = src["enabled"]
    if "sudo" in src:
        if not isinstance(src.get("sudo"), bool):
            return 400, {"error": "ssh.sudo 必须是布尔值"}
        want["sudo"] = src["sudo"]
    if "user" in src:
        u = str(src.get("user") or "").strip()
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$", u or ""):
            return 400, {"error": "ssh 用户名不合法（字母数字 . _ - ，不超过 32 字符）"}
        want["user"] = u
    if "port" in src:
        try:
            p = int(str(src.get("port")).strip())
        except (TypeError, ValueError):
            return 400, {"error": "ssh 端口必须是 1-65535 的整数"}
        if p < 1 or p > 65535:
            return 400, {"error": "ssh 端口必须是 1-65535 的整数"}
        want["port"] = p
    if "key" in src:
        k = str(src.get("key") or "").strip()
        if k and (not k.startswith("/") or re.search(r"\s|[\"'`$;&|<>]", k)):
            return 400, {"error": "私钥路径必须是绝对路径，且不能含空格或 shell 特殊字符"}
        want["key"] = k
    if "connect_timeout" in src:
        want["connect_timeout"] = _int_arg(src.get("connect_timeout"), None, 6, 2, 60)
    mode = body.get("deploy_mode")
    if mode is not None:
        mode = str(mode or "auto").lower()
        if mode not in ("auto", "cephadm", "legacy"):
            return 400, {"error": "deploy_mode 只能是 auto / cephadm / legacy"}
    if not want and mode is None:
        return 400, {"error": "没有需要修改的项"}
    if "key" in want and want["key"] and not os.path.isfile(want["key"]):
        return 400, {"error": "私钥文件不存在：%s（请在控制台主机上确认路径）" % want["key"]}

    merged = dict(cur)
    merged.update(want)
    old_ssh = settings.get("ssh")
    old_mode = settings.get("deploy_mode")
    settings["ssh"] = merged
    if mode is not None:
        settings["deploy_mode"] = mode
    path = conf_path(cfg)
    ok, err = save_conf(path, settings)
    if not ok:
        if old_ssh is None:
            settings.pop("ssh", None)
        else:
            settings["ssh"] = old_ssh
        if old_mode is None:
            settings.pop("deploy_mode", None)
        else:
            settings["deploy_mode"] = old_mode
        audit("REMOTE_SETTING", "-", "-", "FAIL", "写入配置失败：%s" % err, remote, user)
        return 500, {"error": "写入 %s 失败：%s" % (path, err)}
    apply_remote_settings(cfg, settings)
    # 配置变了，之前的探测结论和扫盘结果都失效
    with _SSH_LOCK:
        SSH_PROBE_CACHE.clear()
    with _DEV_SCAN_LOCK:
        _DEV_SCAN.update({"ts": 0.0, "devices": [], "hosts": [], "mode": "", "key": ""})
    _LSBLK_OSD_CACHE.update({"ts": 0.0, "map": {}})
    audit("REMOTE_SETTING", ",".join(sorted(want.keys())) or "deploy_mode", "-", "OK",
          json.dumps({"ssh": merged, "deploy_mode": mode or settings.get("deploy_mode")},
                     ensure_ascii=False), remote, user)
    return 200, {"ok": True, "ssh": merged,
                 "deploy_mode": mode if mode is not None else settings.get("deploy_mode", "auto"),
                 "path": path}


def alert_state_save(cfg):
    path = _ALERT_LOADED["path"] or alert_state_path(cfg)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_ALERT_STATE, f, ensure_ascii=False)
        if hasattr(os, "replace"):
            os.replace(tmp, path)
        else:
            os.rename(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except (IOError, OSError):
        pass


def _alert_key(code):
    """同一个 health check 只对应一个 key，ceph 的 check code 本身是稳定的
    （OSD_DOWN / PG_DEGRADED / MON_CLOCK_SKEW…），不会每轮采集换一个。"""
    return re.sub(r"[^A-Za-z0-9_]", "_", str(code or "")).upper()[:48] or "UNKNOWN"


def _alert_live_status(item, now_s):
    st = item.get("status") or "active"
    if st == "silenced" and int(item.get("until") or 0) and int(item["until"]) <= now_s:
        return "active"
    return st


# health detail 里只有 detail 文本带具体对象，例如
#   "osd.0 (root=default,host=ceph-single) is down"   ← 新版本：host=xxx
#   "osd.1 is down" / "host 'ceph-node-2' (root=default) is down"
#   "Device /dev/nvme0n2 is expected to fail soon" / "acting [0,1]"
_ALERT_OSD_RE = re.compile(r"\bosd[. ](\d+)\b")
_ALERT_HOST_RE = re.compile(r"\bhost '([^']{1,64})'")
_ALERT_HOST_EQ_RE = re.compile(r"\bhost\s*[:=]\s*([A-Za-z0-9._-]{1,64})")
_ALERT_DEV_RE = re.compile(r"(/dev/[A-Za-z0-9/_.\-]{1,64})")
_ALERT_ACTING_RE = re.compile(r"acting \[([0-9,\s]{1,64})\]")


def alert_assets(texts, osds=None):
    """从告警文本认出 osd / 主机 / 设备盘符，再用 osd 表补全主机与盘符。
    认不出来就留空，不用推测值填空。"""
    osd_ids, hosts, devs = [], [], []

    def add(seq, v):
        # 不能用 `if v`：osd.0 的编号是整数 0，会被当成假值丢掉，
        # 于是「涉及 OSD / 主机 / 设备」全空（单 OSD 集群最常见的编号）。
        if v is None or v == "":
            return
        if v not in seq:
            seq.append(v)

    for t in texts:
        if not t:
            continue
        for m in _ALERT_OSD_RE.finditer(str(t)):
            try:
                add(osd_ids, int(m.group(1)))
            except ValueError:
                pass
        for m in _ALERT_HOST_RE.finditer(str(t)):
            add(hosts, m.group(1))
        for m in _ALERT_HOST_EQ_RE.finditer(str(t)):
            add(hosts, m.group(1))
        for m in _ALERT_DEV_RE.finditer(str(t)):
            add(devs, m.group(1))
    # PG 类告警没有 osd.N 字样，退化取 acting 列表（只取第一条 PG 的）
    if not osd_ids:
        for t in texts:
            m = _ALERT_ACTING_RE.search(str(t or ""))
            if m:
                for x in re.split(r"[,\s]+", m.group(1)):
                    if x.isdigit():
                        add(osd_ids, int(x))
                break
    by_id = {}
    for o in (osds or []):
        if isinstance(o, dict) and o.get("id") is not None:
            by_id[o["id"]] = o
    for oid in list(osd_ids):
        o = by_id.get(oid) or {}
        add(hosts, o.get("host") or "")
        add(devs, o.get("dev") or "")
    # 只认到盘符时，用 osd 表按设备反查主机（DEVICE_HEALTH 这类告警没有 host 字样）
    if devs and not hosts:
        for o in (osds or []):
            if isinstance(o, dict) and o.get("dev") in devs and o.get("host"):
                add(hosts, o["host"])
    return osd_ids[:12], hosts[:8], devs[:8]


def _alert_rows(now_s):
    """把 _ALERT_STATE 渲染成前端行（排序：未处置优先、严重优先）。

    调用方需持有 _ALERT_LOCK。既用于正常采集，也用于「采集失败时用磁盘
    状态兜底」—— 否则服务重启后第一次采集失败会返回空列表，把告警清空。
    """
    now_ms = now_s * 1000
    rows = []
    for key, item in _ALERT_STATE.items():
        oids = [x for x in (item.get("osdIds") or []) if isinstance(x, int)]
        rows.append({"id": "H-" + key,
                     "sev": item.get("sev") or "warning",
                     "code": item.get("code") or key,
                     "title": item.get("title") or key,
                     "msg": item.get("msg") or "",
                     "src": "ceph health detail",
                     "osd": oids[0] if oids else None,
                     "osdIds": oids,
                     "hosts": list(item.get("hosts") or []),
                     "devs": list(item.get("devs") or []),
                     "since": int(item.get("first") or now_ms),
                     "status": _alert_live_status(item, now_s),
                     "count": int(item.get("count") or 1),
                     "by": item.get("by") or "",
                     "pending": bool(item.get("pending")),
                     "hold": int(item.get("hold") or 0),
                     "until": int(item.get("until") or 0)})
    stat_rank = {"active": 0, "acked": 1, "silenced": 2, "resolved": 3}
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    rows.sort(key=lambda r: (stat_rank.get(r["status"], 4), sev_rank.get(r["sev"], 3), -r["since"]))
    return rows


def _alert_stale(cfg, err):
    """采集失败时返回上一次成功的结果（逐行标 stale），绝不当成「没有告警」。

    否则 `ceph health detail` 偶尔超时（刚做完 OUT/IN、MON 忙时最常发生）
    就会把整屏告警清空，健康也跟着显示 OK —— 看起来像「操作把告警治好了」。
    内存快照为空（服务刚重启）时改用磁盘里的 alerts.json 兜底。
    """
    with _ALERT_LOCK:
        _ALERT_LAST["ok"] = False
        _ALERT_LAST["err"] = str(err or "")
        if not _ALERT_LAST["rows"]:
            alert_state_load(cfg)
            if _ALERT_STATE:
                _ALERT_LAST["rows"] = [dict(r) for r in _alert_rows(int(time.time()))]
        rows = [dict(r) for r in _ALERT_LAST["rows"]]
    for r in rows:
        r["stale"] = True
    return rows


def read_alerts(cfg, settings, osds=None):
    """当前 health check → 告警列表；同一 code 一条，状态跨刷新保持。

    两种「读不到」的情况都沿用上次快照（并置 alertsOk=false），而不是返回 []：
      * `ceph health detail` 失败 / 超时 / 非 JSON；
      * 文档里没有 `checks` 字段（HEALTH_OK 时 Ceph 给的是 `{"checks": {}}`）。
    """
    if cfg.backend == "rest":
        return []
    doc, err = ceph_json(cfg, ["health", "detail"])
    if doc is None or not isinstance(doc, dict):
        return _alert_stale(cfg, err or "ceph health detail 没有返回 JSON 对象")
    checks = doc.get("checks")
    if not isinstance(checks, dict):
        return _alert_stale(cfg, "health detail 缺少 checks 字段")
    now_s = int(time.time())
    now_ms = now_s * 1000
    changed = False
    with _ALERT_LOCK:
        alert_state_load(cfg)
        # 升级前落盘的旧记录，资产字段可能是空的（1.1.17 及更早把 osd.0 的
        # 整数 0 当假值丢掉了）。用保存下来的标题/正文再解析一次补空字段，
        # 不必等 health detail 下次再出现这条 check 才补得上。
        for item in _ALERT_STATE.values():
            if item.get("osdIds") and item.get("hosts") and item.get("devs"):
                continue
            oids, hnames, dnames = alert_assets(
                [item.get("title"), item.get("msg")], osds)
            if oids and not item.get("osdIds"):
                item["osdIds"] = oids
                changed = True
            if hnames and not item.get("hosts"):
                item["hosts"] = hnames
                changed = True
            if dnames and not item.get("devs"):
                item["devs"] = dnames
                changed = True
        # 静音到期自动恢复为活跃，不需要用户再点一次。
        for item in _ALERT_STATE.values():
            if (item.get("status") or "") == "silenced" \
                    and int(item.get("until") or 0) and int(item["until"]) <= now_s:
                item["status"] = "active"
                changed = True
        seen = set()
        for code, c in checks.items():
            if not isinstance(c, dict):
                continue
            key = _alert_key(code)
            seen.add(key)
            snum = str(c.get("severity", "")).upper()
            # HEALTH_ERR 必须算严重：早前只判 WARN，ERR 反而落进「提示」。
            sev = "critical" if ("ERR" in snum or "CRIT" in snum) else (
                "warning" if "WARN" in snum else "info")
            summary = c.get("summary", {}) or {}
            msg = summary.get("message", code) if isinstance(summary, dict) else str(summary)
            detail = c.get("detail", []) or []
            body = " ".join(str(x.get("message", "")) if isinstance(x, dict) else str(x)
                            for x in detail[:3])
            item = _ALERT_STATE.get(key)
            osd_ids, hosts, devs = alert_assets([msg, body], osds)
            if item is None:
                # 首次发现：这才是唯一「产生一条新告警」的时机。
                item = {"key": key, "code": code, "first": now_ms, "last": now_ms,
                        "count": 1, "status": "active", "by": "", "until": 0,
                        "resolvedAt": 0, "sev": sev, "title": msg, "msg": body,
                        "osdIds": osd_ids, "hosts": hosts, "devs": devs}
                _ALERT_STATE[key] = item
                changed = True
            else:
                if (item.get("status") or "") == "resolved":
                    # 恢复之后再次出现：算同一问题的新一次发作，累计次数累加，
                    # 「首次发现」重置为本次发作时间。
                    item["count"] = int(item.get("count") or 1) + 1
                    item["first"] = now_ms
                    item["resolvedAt"] = 0
                    item["status"] = ("silenced" if int(item.get("until") or 0) > now_s
                                      else "active")
                    changed = True
                if int(item.get("miss") or 0) or item.get("pending"):
                    # 又看到了：把「连续缺席」计数清零，避免下次抖动直接判恢复。
                    item["miss"] = 0
                    item["pending"] = False
                    item["hold"] = 0
                    changed = True
                item["last"] = now_ms
                item["sev"] = sev
                item["title"] = msg
                item["msg"] = body
                item["code"] = code
                # 设备可能刚刚才被 metadata 采到，有值就刷新，没值不覆盖旧值
                if osd_ids or hosts or devs:
                    item["osdIds"] = osd_ids or item.get("osdIds") or []
                    item["hosts"] = hosts or item.get("hosts") or []
                    item["devs"] = devs or item.get("devs") or []
        # 已经不在 health detail 里的：次数 + 时间双重确认后才标恢复。
        # 只在「次数够」且「最后一次看到它已经是 ALERT_CONFIRM_AGE 之前」且
        # 「不在写操作观察期」时才下结论，否则保持原状态并标 pending（核实中）。
        grace_left = max(0, int(_WRITE_GRACE_UNTIL) - now_s)
        for key in list(_ALERT_STATE.keys()):
            if key in seen:
                continue
            item = _ALERT_STATE[key]
            if (item.get("status") or "") != "resolved":
                miss = int(item.get("miss") or 0) + 1
                item["miss"] = miss
                seen_age = max(0, (now_ms - int(item.get("last") or now_ms)) // 1000)
                hold = max(ALERT_CONFIRM_AGE - seen_age, grace_left, 0)
                if miss < ALERT_MISS_LIMIT or hold > 0:
                    # 观测时间不够、或刚做过写操作：不改状态，挂上「核实中」。
                    item["pending"] = True
                    item["hold"] = int(hold)
                    changed = True
                    continue
                item["miss"] = 0
                item["pending"] = False
                item["hold"] = 0
                item["status"] = "resolved"
                item["resolvedAt"] = now_ms
                item["last"] = now_ms
                changed = True
            elif now_s - int(item.get("resolvedAt") or 0) // 1000 > ALERT_RESOLVE_TTL:
                _ALERT_STATE.pop(key, None)
                changed = True
        if changed:
            alert_state_save(cfg)
        rows = _alert_rows(now_s)
    # 只有「真的读到了完整的 health detail」才更新快照；下一次失败时用它兜底。
    with _ALERT_LOCK:
        _ALERT_LAST["rows"] = [dict(r) for r in rows]
        _ALERT_LAST["ok"] = True
        _ALERT_LAST["err"] = ""
        _ALERT_LAST["ts"] = now_s
    return rows


def alert_ack(cfg, aid, action, by="", minutes=0):
    """确认 / 静音 / 重新激活 / 手动标恢复。只改控制台侧状态，不碰集群。"""
    key = str(aid or "").strip()
    if key.upper().startswith("H-"):
        key = key[2:]
    key = _alert_key(key)
    now_s = int(time.time())
    with _ALERT_LOCK:
        alert_state_load(cfg)
        item = _ALERT_STATE.get(key)
        if item is None:
            return {"ok": False, "error": "告警不存在或已过保留期（%s）" % key}
        if action == "ack":
            item["status"] = "acked"
            item["by"] = by
        elif action == "silence":
            item["status"] = "silenced"
            item["by"] = by
            item["until"] = now_s + max(5, int(minutes or ALERT_SILENCE_DEFAULT)) * 60
        elif action == "reopen":
            item["status"] = "active"
            item["by"] = ""
            item["until"] = 0
        elif action == "resolve":
            item["status"] = "resolved"
            item["resolvedAt"] = now_s * 1000
        else:
            return {"ok": False, "error": "未知操作 %s" % action}
        alert_state_save(cfg)
        # 处置结果立刻反映到快照里：否则下一轮采集失败时会用旧快照把它显示回
        # 未处置，看起来像「确认了又弹回来」。
        _ALERT_LAST["rows"] = [dict(r) for r in _alert_rows(now_s)]
        return {"ok": True, "id": "H-" + key, "status": item["status"],
                "until": int(item.get("until") or 0), "by": item.get("by") or "",
                "count": int(item.get("count") or 1)}


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _pool_type_name(d):
    ptype = _int_or_none(d.get("type"))
    if ptype == 3:
        return "erasure"
    if ptype == 1:
        return "replicated"
    return "erasure" if d.get("erasure_code_profile") else "replicated"


def _pool_app(d, fallback=""):
    """application 只体现在 osd pool ls detail 的 application_metadata 里
    （{app: {}} 的字典，可能有多个），df detail 不带这个字段。"""
    apps = d.get("application_metadata")
    if isinstance(apps, dict) and apps:
        return "/".join(sorted(str(k) for k in apps.keys()))
    if isinstance(apps, list) and apps:
        return "/".join(str(x) for x in apps)
    return str(d.get("application") or fallback or "")


def read_pools(cfg):
    """池清单以 `osd pool ls detail` 为准，`df detail` 只补用量。

    之前只用 df detail 当主列表，而它**没有 pg_num 字段**，导致 PG 一列恒为 0；
    application 也不在 df 里。同理，池只要没出现在 df 里就会被整条漏掉。
    """
    if cfg.backend == "rest":
        return []
    df, _ = ceph_json(cfg, ["df", "detail"], 25)
    detail, _ = ceph_json(cfg, ["osd", "pool", "ls", "detail"], 25)
    usage = {}
    if isinstance(df, dict):
        for p in (df.get("pools") or []):
            if isinstance(p, dict) and p.get("name"):
                usage[p["name"]] = p
    defs = []
    if isinstance(detail, list):
        defs = [d for d in detail if isinstance(d, dict)]
    defs.sort(key=lambda d: _int_or_none(d.get("pool")) or 0)
    out = []
    for d in defs:
        name = d.get("poolname") or d.get("pool_name") or ""
        if not name:
            continue
        u = usage.get(name) or {}
        stats = u.get("stats") or {}
        used = _int_or_none(stats.get("bytes_used")) if stats.get("bytes_used") is not None else None
        stored = _int_or_none(stats.get("stored")) if stats.get("stored") is not None else None
        avail = _int_or_none(stats.get("max_avail")) if stats.get("max_avail") is not None else None
        pct = None
        if used is not None and avail is not None and (used + avail) > 0:
            pct = round(used * 100.0 / (used + avail), 4)
        pg = _int_or_none(d.get("pg_num"))
        if pg is None:
            pg = _int_or_none(d.get("pg_placement_num"))
        if pg is None:
            pg = _int_or_none(u.get("pg_num"))
        pgp = _int_or_none(d.get("pgp_num"))
        if pgp is None:
            pgp = _int_or_none(d.get("pg_placement_num"))
        out.append({"name": name, "type": _pool_type_name(d),
                    "size": _int_or_none(d.get("size")),
                    "minSize": _int_or_none(d.get("min_size")),
                    "pgs": pg, "pgp": pgp,
                    "autoscale": str(d.get("pg_autoscale_mode") or d.get("autoscale_mode") or ""),
                    "used": used, "stored": stored, "pct": pct,
                    "app": _pool_app(d)})
    if out:
        return out
    # 读不到 pool 定义时退回 df：池名和用量还能看，PG / 类型只能留空（不填 0 冒充）。
    for name, u in usage.items():
        stats = u.get("stats") or {}
        used = _int_or_none(stats.get("bytes_used"))
        stored = _int_or_none(stats.get("stored"))
        avail = _int_or_none(stats.get("max_avail"))
        pct = None
        if used is not None and avail is not None and (used + avail) > 0:
            pct = round(used * 100.0 / (used + avail), 4)
        out.append({"name": name, "type": "", "size": None, "minSize": None,
                    "pgs": _int_or_none(u.get("pg_num")), "pgp": None, "autoscale": "",
                    "used": used, "stored": stored, "pct": pct,
                    "app": str(u.get("application") or "")})
    return out


# --------------------------------------------------------------------------
# pool create (replicated / erasure)
# --------------------------------------------------------------------------
def pool_names(cfg):
    """已存在的池名，用来在创建前挡住重名。"""
    doc, _ = ceph_json(cfg, ["osd", "pool", "ls"], 20)
    return [str(x) for x in doc] if isinstance(doc, list) else []


def ec_profile_list(cfg):
    """EC profile + k / m。`osd erasure-code-profile get` 只输出 key=value
    文本（不支持 --format=json），所以这里解析文本而不是走 ceph_json。"""
    names, _ = ceph_json(cfg, ["osd", "erasure-code-profile", "ls"], 20)
    out = []
    if not isinstance(names, list):
        return out
    for n in names:
        item = {"name": str(n), "k": None, "m": None, "plugin": ""}
        rc, text, _ = ceph_run(cfg, ["osd", "erasure-code-profile", "get", str(n)], 15)
        if rc == 0:
            for line in (text or "").splitlines():
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if k in ("k", "m"):
                    try:
                        item[k] = int(v)
                    except ValueError:
                        pass
                elif k == "plugin":
                    item["plugin"] = v
        out.append(item)
    return out


def suggest_pg_num(osds, divisor, floor=8, cap=1024):
    """按「每 OSD 约 100 个 PG / 单个池」估一个 2 的幂，仅作建议值。"""
    target = max(floor, (max(1, int(osds)) * 100) // max(1, int(divisor)))
    p = 1
    while p < target:
        p *= 2
    return int(min(cap, max(floor, p)))


def read_pool_options(cfg, probe):
    """创建存储池弹窗需要的下拉项与建议值，全部来自集群实际状态。"""
    ids, _ = ceph_json(cfg, ["osd", "ls"], 20)
    osd_count = len(ids) if isinstance(ids, list) else 0
    rules, _ = ceph_json(cfg, ["osd", "crush", "rule", "ls"], 20)
    return {"osds": osd_count,
            "pools": pool_names(cfg),
            "rules": [str(x) for x in rules] if isinstance(rules, list) else [],
            "ec_profiles": ec_profile_list(cfg),
            "autoscale": probe.major >= 14 or probe.major == 0,
            # 拿不到 OSD 数就不给建议值，免得用 0 算出一个看似精确的假数字
            "pg_suggest": suggest_pg_num(osd_count, 3) if osd_count else 0,
            "version": probe.version,
            "orchestrator": probe.orchestrator}


def validate_pool_spec(body):
    """把请求体收敛成一份可信的建池参数，非法输入直接报错而不是拼进命令。"""
    name = str(body.get("name", "") or "").strip()
    if not name:
        raise ValueError("请填写存储池名称")
    if name.startswith("."):
        raise ValueError("存储池名称不能以 . 开头（Ceph 保留给 .mgr / .rgw.root 等）")
    if not POOL_NAME_RE.match(name):
        raise ValueError("存储池名称只允许字母、数字、点、下划线、短横线，且不超过 64 位")

    ptype = str(body.get("type", "replicated") or "replicated")
    if ptype not in ("replicated", "erasure"):
        raise ValueError("type must be replicated or erasure")

    def num(key, default=None):
        raw = body.get(key, None)
        if raw is None or raw == "":
            return default
        try:
            return int(raw)
        except (TypeError, ValueError):
            raise ValueError("%s 必须是整数" % key)

    pg = num("pg_num", 32)
    if pg is None or pg < 1 or pg > 65536:
        raise ValueError("pg_num 必须在 1 ~ 65536 之间")
    pgp = num("pgp_num", pg)
    if pgp is None or pgp < 1 or pgp > 65536:
        raise ValueError("pgp_num 必须在 1 ~ 65536 之间")

    app = str(body.get("app", "") or "")
    if app and app not in ("rbd", "cephfs", "rgw", "nfs"):
        raise ValueError("unknown application: %s" % app)
    rule = str(body.get("rule", "") or "")
    if rule and not re.match(r"^[A-Za-z0-9._-]{1,64}$", rule):
        raise ValueError("invalid crush rule name")
    ec = str(body.get("ec_profile", "") or "")
    if ec and not re.match(r"^[A-Za-z0-9._-]{1,64}$", ec):
        raise ValueError("invalid erasure code profile name")

    if ptype == "replicated":
        size = num("size", 3)
        if size is None or size < 1 or size > 10:
            raise ValueError("副本数 size 必须在 1 ~ 10 之间")
        min_size = num("min_size", max(1, size - 1))
        if min_size is None or min_size < 1 or min_size > size:
            raise ValueError("min_size 必须在 1 ~ size 之间（大于 size 会让池无法写入）")
    else:
        # EC 池的 size 由 profile 的 k+m 决定，不能单独设 size。
        ec = ec or "default"
        size = 0
        min_size = num("min_size", 0) or 0
        if min_size < 0 or min_size > 32:
            raise ValueError("min_size 超出合理范围")

    autoscale = body.get("autoscale", True)
    if isinstance(autoscale, str):
        autoscale = autoscale not in ("0", "false", "False", "off")
    return {"name": name, "type": ptype, "size": size, "min_size": min_size,
            "pg_num": pg, "pgp_num": pgp, "rule": rule, "ec_profile": ec,
            "app": app, "autoscale": bool(autoscale)}


def build_pool_plan(cfg, probe, spec):
    """建池命令模板：12.x ~ 19.x 通用（不使用 --size 之类的版本相关参数）。"""
    name = spec["name"]
    plan = []

    def add(n, argv, note=""):
        plan.append((n, argv, note))

    add("检查池名是否已被占用", ["ceph", "osd", "pool", "ls"],
        "同名池存在时创建会失败；执行前后端还会再校验一次")
    if spec["type"] == "replicated":
        argv = ["ceph", "osd", "pool", "create", name, str(spec["pg_num"]),
                str(spec["pgp_num"]), "replicated"]
        if spec["rule"]:
            argv.append(spec["rule"])
        add("创建副本池", argv, "先按默认参数建池，size / min_size 由后续两条命令显式设定")
        add("设置副本数 size", ["ceph", "osd", "pool", "set", name, "size", str(spec["size"])],
            "副本数 %d：同时保存 %d 份数据" % (spec["size"], spec["size"]))
        add("设置 min_size", ["ceph", "osd", "pool", "set", name, "min_size", str(spec["min_size"])],
            "可用副本低于 min_size 时停止写入，避免数据进入不可恢复状态")
    else:
        add("创建 EC 池", ["ceph", "osd", "pool", "create", name, str(spec["pg_num"]),
                          str(spec["pgp_num"]), "erasure", spec["ec_profile"]],
            "纠删码池：profile %s，size 由 k+m 决定" % spec["ec_profile"])
        if spec["min_size"]:
            add("设置 min_size", ["ceph", "osd", "pool", "set", name, "min_size",
                                  str(spec["min_size"])], "一般取 k+1：丢掉一块盘仍可读写")
    if spec["autoscale"]:
        add("启用 PG 自动扩缩", ["ceph", "osd", "pool", "set", name, "pg_autoscale_mode", "on"],
            "由 mgr 按实际使用量自动调整 PG（14.x 及以上支持；老版本失败不影响建池）")
    if spec["app"]:
        add("标记应用类型 " + spec["app"], ["ceph", "osd", "pool", "application", "enable",
                                            name, spec["app"]],
            "rbd / cephfs / rgw 必须先 enable 才允许使用；cephfs 还需另外创建文件系统")
    add("复核池配置", ["ceph", "osd", "pool", "ls", "detail", "--format=json"],
        "确认池已出现，且 size / min_size / pg_num 与提交的参数一致")
    add("集群健康验证", ["ceph", "-s", "--format=json"],
        "新建池会立刻产生 PG，观察是否很快回到 active+clean")
    return plan


def check_pool(cfg, name):
    """回读池配置：只有 pool ls detail 里真的出现且参数对得上才算成功。"""
    doc, err = ceph_json(cfg, ["osd", "pool", "ls", "detail"], 30)
    if not isinstance(doc, list):
        return {"ok": False, "message": "无法回读池列表：%s" % (err or "命令失败")}
    for d in doc:
        if not isinstance(d, dict):
            continue
        pn = d.get("poolname") or d.get("pool_name") or ""
        if pn != name:
            continue
        ptype = d.get("type")
        if ptype == 3:
            tname = "erasure"
        elif ptype == 1:
            tname = "replicated"
        else:
            tname = "erasure" if d.get("erasure_code_profile") else "replicated"
        pg = d.get("pg_num")
        if pg is None:
            pg = d.get("pg_placement_num")
        return {"ok": True, "name": name, "type": tname,
                "size": d.get("size"), "min_size": d.get("min_size"),
                "pg_num": pg, "pgp_num": d.get("pgp_num") or d.get("pg_placement_num"),
                "ec_profile": d.get("erasure_code_profile") or "",
                "message": "%s 已创建：%s · size=%s · min_size=%s · pg_num=%s" % (
                    name, tname, d.get("size"), d.get("min_size"), pg)}
    return {"ok": False,
            "message": "池 %s 没有出现在 ceph osd pool ls detail 中，请检查创建命令的返回" % name}


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
    # 主机角色按「这台机器上有没有该守护进程」判断，不看是否在仲裁里：
    # MON 掉出 quorum 仍然是 MON 主机。
    mon_names = set(m.get("name") for m in (cl.get("monList") or []) if m.get("name"))
    mgr_names = set(cl.get("mgrStandbys") or [])
    if cl.get("mgrActive"):
        mgr_names.add(cl["mgrActive"])
    out = []
    # `ceph osd tree` 是扁平列表，children 里放的是 id 而不是对象 —— 不建索引
    # 就数不到每个 host 下的 OSD，up 只能靠 children 个数冒充。
    nodes_all = doc.get("nodes", []) if isinstance(doc, dict) else doc
    by_id = {}
    for n in (nodes_all or []):
        if isinstance(n, dict) and n.get("id") is not None:
            by_id[n["id"]] = n

    def kids_of(n):
        kids = []
        for c in (n.get("children") or []):
            if isinstance(c, dict):
                kids.append(c)
            elif c in by_id:
                kids.append(by_id[c])
        return kids

    seen = set()

    def walk(nodes):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            if id(n) in seen:
                continue
            seen.add(id(n))
            if n.get("type") == "host":
                name = n.get("name", "")
                kids = [k for k in kids_of(n)
                        if k.get("type") == "osd" or str(k.get("name", "")).startswith("osd.")]
                total = len(kids) if kids else len(n.get("children") or [])
                # osd tree 给的是每个 OSD 的 up/down；没有状态字段才退回「按在册计」。
                if kids and all("status" in k for k in kids):
                    up = len([k for k in kids if str(k.get("status", "")).lower() == "up"])
                else:
                    up = total
                out.append({"name": name, "ip": addr_by_host.get(name, ""),
                            "mons": name in mon_names, "mgr": name in mgr_names,
                            "osds": total, "up": up,
                            "mem": None, "cpu": None, "src": "", "err": "", "ver": ""})
            walk(kids_of(n))
    walk(doc.get("nodes", []) if isinstance(doc, dict) else doc)
    return fill_host_usage(cfg, out)


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
    # OSD 只取一次：告警要按 osd 编号反查主机与设备盘符，不能再跑一遍命令。
    osds = read_osds(cfg)
    alerts = read_alerts(cfg, settings, osds)
    # rest 后端本就不提供 health detail（返回空是真实答案）；cli 后端要区分
    # 「读到的是空」与「这次没读到」，前者才允许前端清空列表。
    if cfg.backend == "rest":
        alerts_ok, alerts_err, alerts_at = True, "", 0
    else:
        alerts_ok = bool(_ALERT_LAST["ok"])
        alerts_err = _ALERT_LAST["err"]
        alerts_at = int(_ALERT_LAST["ts"] or 0)
    return {"cluster": cluster, "osds": osds,
            "alerts": alerts,
            "alertsOk": alerts_ok, "alertsErr": alerts_err, "alertsAt": alerts_at,
            "pools": pools,
            "hosts": read_hosts(cfg, cluster), "profile": probe.as_dict(),
            # 阈值来自后端配置文件，前端不再用自己的演示默认值 85/95。
            # 安全策略随状态下发：页面开关只显示真实值，默认 DRY-RUN + 二次确认开。
            "settings": {"nearfull": settings.get("nearfull"),
                         "full": settings.get("full"),
                         "downMin": settings.get("downMin"),
                         "allow_write": settings.get("allow_write") is True,
                         "confirm": settings.get("confirm", True) is not False,
                         # 二进制 / 包安装集群：动盘要走 ssh。这里给的是配置概况
                         # （不探活），逐主机连通性由 /api/remote?probe=1 现查。
                         "ssh": ssh_summary(cfg),
                         "deploy_mode": getattr(probe, "deploy_mode", "unknown")}}


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


def _plan_retire(cfg, probe, oid, add, host=""):
    """① 换盘前·清退：确认 down → 从集群彻底删除旧编号（不保留）。

    直接用 mon 侧命令式 ceph osd purge，绕过 cephadm 的 --replace 队列：
    那个队列在 purge 前会反复跑 osd safe-to-destroy，单节点 / PG 不
    active+clean 时永远不通过，是之前「清退卡住」的根因。
    绝不 zap、绝不碰新盘 —— 现场换盘是之后独立的人工动作。
    """
    orch = probe.caps.get("orch", False)
    purge = probe.caps.get("purge", False)
    if not orch:
        # 包安装集群的 OSD 是 systemd 服务：ceph osd purge 只删 mon 侧记录，
        # 不会停掉进程，而 /etc/systemd/system/ceph-osd.target.wants 下的
        # 符号链接还会让它开机自启。不停不禁用，进程会继续占着旧盘，
        # 之后 ceph-volume zap 新盘 / 拔盘都会被占用报错。
        add("停止并禁用旧 OSD 服务",
            ["systemctl", "disable", "--now", "ceph-osd@%d" % oid],
            "只停服务、不动数据：包安装集群必须显式停掉，否则 purge 之后进程仍在跑，"
            "旧盘一直被占用。服务不存在时报错属正常（12.x 命名可能不同），流程继续",
            host=host)
    if orch:
        add("清掉旧版的僵尸移除任务",
            ["ceph", "orch", "osd", "rm", "stop", str(oid)],
            "只取消 cephadm 的 osd rm / --replace 排队任务，不动 OSD 数据。"
            "队列里没有该任务时会报错，属正常，流程会继续；这一步同时放弃"
            "旧版 --replace 留下的 osd_id_claims（本方案不保留编号）")
    add("标记 OSD OUT", ["ceph", "osd", "out", str(oid)],
        "把 PG 从故障盘迁走；盘已损坏时其他副本通常早已接管，该步幂等")
    if purge:
        add("永久删除故障 OSD（编号不保留）",
            ["ceph", "osd", "purge", str(oid), "--yes-i-really-mean-it"],
            "mon 侧命令式：一次删掉 CRUSH 条目 / 认证 / osdmap 记录并标记 destroyed。"
            "不经过 cephadm 的 --replace 队列，也不做 osd safe-to-destroy 检查，"
            "因此不会卡在 done, waiting for purge。不可逆：旧编号 osd.%d 不再保留，"
            "旧盘数据视为放弃；第 ② 步新盘由 mon 分配新编号" % oid)
    else:
        add("从 CRUSH 移除", ["ceph", "osd", "crush", "remove", "osd.%d" % oid],
            "老版本没有 ceph osd purge，分三步删除编号（不保留）")
        add("删除认证", ["ceph", "auth", "del", "osd.%d" % oid])
        add("删除 OSD", ["ceph", "osd", "rm", str(oid)])
    if orch:
        # 现场踩过的坑（11-11）：只 purge 不清 cephadm 的 daemon 定义时，
        # 宿主机 /var/lib/ceph/<fsid>/osd.<id>/unit.run 里还写着上一块盘的
        # --osd-uuid。新盘拿到同一个编号后 cephadm 认为「这个 daemon 已部署」，
        # 只做 activate 不重建 unit，于是去激活一个已被 zap 掉的 LV，
        # 容器起不来、OSD 永远 error/down，metadata 为空 → 设备/容量全"未采集"。
        # 放在 purge 之后：先让 mon 侧没这个编号，再清 daemon，避免编排器抢跑重建。
        add("清掉 cephadm 的旧 daemon 定义",
            ["ceph", "orch", "daemon", "rm", "osd.%d" % oid, "--force"],
            "删除 cephadm 侧 osd.%d 的 daemon 记录，以及宿主机上的 systemd unit 与 "
            "/var/lib/ceph/<fsid>/osd.%d 目录（只删守护进程定义，不碰数据盘）。"
            "不清理的话，新盘复用同一编号时会沿用旧的 --osd-uuid，OSD 起来就是 "
            "error/down。daemon 已不存在时报错属正常，流程继续" % (oid, oid))
        add("确认旧 daemon 已退出",
            ["ceph", "orch", "ps", "--daemon-type", "osd", "--format=json"],
            "只读复核：列表里不应再有 osd.%d 的 daemon；若还在且状态 error，"
            "说明上一步没删掉，可手工 ceph orch daemon rm osd.%d --force" % (oid, oid))
    add("复核旧编号已从 osdmap 删除", ["ceph", "osd", "dump", "--format=json"],
        "只读复核：osds[] 里不应再有 osd.%d。成功后才能现场换盘" % oid)


def _plan_deploy(cfg, probe, oid, host, dev, add):
    """② 换盘后·新盘入群：清签名 → 创建 OSD（mon 分配新编号）→ 回读复核。

    cephadm 用 zap + 命令式 daemon add osd；包安装用 ceph-volume lvm create
    不带 --osd-id。都不传原编号，也不依赖 destroyed / osd_id_claims。
    """
    orch = probe.caps.get("orch", False)
    if orch:
        add("确认新盘已被编排器识别",
            ["ceph", "orch", "device", "ls", str(host), "--format=json"],
            "新盘应出现在 %s 的设备列表（available 可能为 false，还带着旧签名）" % host)
        add("清理新盘残留签名",
            ["ceph", "orch", "device", "zap", str(host), str(dev), "--force"],
            "只作用于 %s：抹掉旧 LVM / 分区表签名（旧盘位上可能还留着 osd.%d 的标签）。"
            "执行前平台会确认这块盘不属于别的 OSD" % (dev, oid))
        add("创建并部署新 OSD（分配新编号）",
            ["ceph", "orch", "daemon", "add", "osd", "%s:%s" % (host, dev)],
            "命令式创建，由 mon 分配一个新 OSD 编号；不传 --osd-id、不认领旧编号。"
            "若已 apply osd 自动纳管，这条可能提示已被管理而失败（属正常，"
            "编排器会自己部署），流程继续")
        add("等待新 OSD 上线",
            ["ceph", "orch", "ps", "--daemon-type", "osd", "--format=json"],
            "只读：新 OSD 应为 running；编号可能与 osd.%d 不同，属正常" % oid)
    else:
        # 这一段的命令全部落在「盘所在的那台机器」上：包安装集群没有 orchestrator
        # 转发，必须由控制台 ssh 过去执行（本机则直接 exec）。
        if probe.major >= 13:
            add("清理新盘元数据", ["ceph-volume", "lvm", "zap", str(dev), "--destroy"],
                "清掉旧签名；只作用于 %s，执行前请核对盘位与 SN" % dev, host=host)
            add("创建 OSD（不指定编号，由 mon 分配）",
                ["ceph-volume", "lvm", "create", "--data", str(dev)],
                "不带 --osd-id：mon 分配一个新编号，旧编号 osd.%d 不再保留" % oid, host=host)
        else:
            add("准备新盘（12.x）", ["ceph-disk", "prepare", str(dev)],
                "ceph-disk 时代的老命令；12.x 之后请升到 bluestore + ceph-volume", host=host)
            add("激活 OSD（12.x）", ["ceph-disk", "activate", str(dev)], "", host=host)
        add("确认新 OSD 的 CRUSH 权重",
            ["ceph", "osd", "crush", "tree", "--format=json"],
            "只读：新 OSD 默认权重 1.0。若原盘是自定义权重，按新编号手工 "
            "ceph osd crush reweight osd.<新编号> <原权重>")


def build_plan(cfg, probe, intent, osd_id, host, dev):
    orch = probe.caps.get("orch", False)
    purge = probe.caps.get("purge", False)
    if intent not in ("remove", "replace", "retire", "deploy", "in", "downout", "init"):
        raise ValueError("unknown intent: %s" % intent)
    # 新增磁盘（init）针对的是「额外插进来的一块盘」，没有 OSD id，只认 host + 设备路径。
    # 注意它与「换盘」不是一回事：init 不删任何旧 OSD，是纯扩容；换盘先删旧编号再加新盘。
    if intent == "init":
        oid = None
        if not dev:
            raise ValueError("device path is required for a new disk")
        if host and not HOST_RE.match(str(host)):
            raise ValueError("invalid host")
        if probe.caps.get("orch") and not host:
            raise ValueError("host is required for cephadm: ceph orch daemon add osd <host>:<dev>")
        if ".." in dev or not DEV_RE.match(str(dev)):
            raise ValueError("invalid device path")
    else:
        oid = validate_target(osd_id, host, dev)
    # osd in / down+out / 清退 / 新增磁盘只按 id 或设备操作，不要求「先有新盘」的设备路径。
    # ① 清退阶段此时新盘根本还没换上，要求 dev 是荒谬的。
    if intent not in ("in", "downout", "init", "retire") and not dev and (not orch or intent == "remove"):
        raise ValueError("device path is required for this operation")
    plan = []  # (name, argv_or_None, note, host)

    def add(name, argv, note="", host=None):
        # host 只在「包安装 + 非本机」时才有值：它决定这条命令经 ssh 落到哪台机器。
        # cephadm 的计划一律 host=None —— mon 侧命令在哪执行都一样。
        plan.append((name, argv, note, host if (host and not orch) else None))

    DOWN_NOTE = "先停服务再摘盘：避免故障盘抖动产生 slow ops；已 down 时该命令幂等"
    # 包安装集群：systemctl / ceph-volume 必须在 OSD 所在主机执行。
    # 主机名优先用调用方给的（界面上就是这个 OSD 的 host），否则按 CRUSH 树反查。
    osd_host = ""
    if not orch and oid is not None:
        try:
            osd_host = host or (osd_host_map(cfg).get(int(oid)) or "")
        except (TypeError, ValueError):
            osd_host = host or ""

    if intent in ("replace", "retire", "deploy"):
        # 换盘（1.1.24 起不保留 OSD 编号）拆成两个互不依赖的动作：
        #   ① retire：确认故障盘已 down → mon 命令式 purge 彻底删除旧编号
        #   --- 人工：按盘位 / SN 换上同规格新盘 ---
        #   ② deploy：清签名 → 创建 OSD，由 mon 分配新编号 → 回读复核 up/in
        # 不依赖 destroyed / osd_id_claims / OSDSpec 自动认领，也就不受
        # cephadm 的 osd safe-to-destroy 卡死影响。
        # 与「退役 remove」的区别：remove 是永久减容量，换盘只是换硬件。
        # 与「新增磁盘 init」的区别：init 不删旧 OSD、纯扩容。
        # replace 仅保留给「高级向导」做完整流程预览 = ① + 人工 + ②。
        if intent in ("replace", "deploy"):
            if not dev:
                raise ValueError("换盘后入群必须指定新盘的设备路径（换上的是哪块盘）")
            if not host:
                raise ValueError("换盘后入群必须指定新盘所在的服务器")
        if intent in ("replace", "retire"):
            _plan_retire(cfg, probe, oid, add, osd_host)
        if intent == "replace":
            add("物理更换故障盘", None,
                "现场操作：按盘位 / SN 换上同规格新盘，装回原盘位、原主机。"
                "新盘会以一个新 OSD 编号加入，旧编号已在 ① 删除")
        if intent in ("replace", "deploy"):
            _plan_deploy(cfg, probe, oid, host, dev, add)
            add("确认新盘已被新 OSD 接管", ["ceph", "osd", "dump", "--format=json"],
                "只读复核：新盘应被某个 up=true / in=true 的 OSD 占用；编号由 mon "
                "分配，不要求等于 osd.%d" % oid)
            add("集群健康验证", ["ceph", "-s", "--format=json"],
                "新 OSD 上线后数据开始回填，观察 PG 回到 active+clean")
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
            add("清除磁盘元数据", ["ceph-volume", "lvm", "zap", str(dev), "--destroy"],
                "在本机执行；多节点集群会自动下发到该 OSD 所在主机", host=host)
        add("集群健康验证", ["ceph", "-s", "--format=json"])
    elif intent == "downout":
        # 一键踢盘的真实语义：把盘停掉并从 CRUSH 摘出，保留 OSD 身份与数据。
        # 不走 purge / crush remove / zap —— 这些是「退役」，是不可逆的。
        # 必须先停守护进程：只发 osd down 时，进程的心跳会在几秒内把它改回 up，
        # 结果就是「只 out 了、down 没生效」。
        add("停止 OSD 守护进程", osd_daemon_cmd(probe, "stop", oid),
            "只改 osdmap 标记不够：进程还在跑时心跳会把 down 立刻改回 up，必须先停服务。"
            "但若下一步是「① 换盘前·清退」，不要长期停着 daemon：cephadm 在 purge "
            "前需要 OSD 上报 stats 才能通过 osd safe-to-destroy，长期停服务会让"
            "移除队列卡在 done, waiting for purge", host=osd_host)
        add("强制标记 OSD DOWN", ["ceph", "osd", "down", str(oid)], DOWN_NOTE)
        add("标记 OSD OUT", ["ceph", "osd", "out", str(oid)],
            "从 CRUSH 摘出并触发数据回填；不 purge、不清盘，随时可 osd in 恢复")
        add("集群健康验证", ["ceph", "-s", "--format=json"], "观察 PG 回到 active+clean")
    elif intent == "in":
        # 踢盘时停过守护进程，IN 必须把它拉起来，否则 osd in 之后仍是 down。
        add("启动 OSD 守护进程", osd_daemon_cmd(probe, "start", oid),
            "踢盘时停过服务；进程没起来时 osd in 只会恢复权重，状态仍是 down",
            host=osd_host)
        add("确认 OSD 仍在 CRUSH map", ["ceph", "osd", "tree", "--format=json"],
            "已被 purge / rm 的 OSD 无法 in，只能重新部署")
        add("重新加入集群（osd in）", ["ceph", "osd", "in", str(oid)],
            "取消 out 标记，恢复 CRUSH 权重并触发数据回填")
        add("确认 OSD 处于 up/in", ["ceph", "osd", "dump", "--format=json"],
            "osds[] 中该 OSD 的 up / in 都应为 true")
        add("集群健康验证", ["ceph", "-s", "--format=json"], "观察 PG 回到 active+clean")
    elif intent == "init":
        # 新增磁盘 = 扩容：预检 -> 清元数据 -> 创建 OSD（新编号）-> 等上线。
        # 不是「换盘」：init 保留所有旧 OSD，只是多插一块盘扩容。
        if orch:
            add("预检设备是否可加入集群", ["ceph", "orch", "device", "ls", "--format=json"],
                "确认 %s 的 available 为 true，且没有被其它 OSD 占用" % dev)
            add("清理新盘旧元数据", ["ceph", "orch", "device", "zap", host, dev, "--force"],
                "清掉分区表 / LVM / 文件系统签名；只作用于 %s，执行前请核对盘位与 SN" % dev)
            add("初始化并部署 OSD", ["ceph", "orch", "daemon", "add", "osd", "%s:%s" % (host, dev)],
                "由 cephadm 在该设备上创建并启动 OSD；若已 apply osd 自动纳管，可能提示已被管理")
            add("等待 OSD 上线", ["ceph", "orch", "ps", "--daemon-type", "osd", "--format=json"],
                "新 OSD 应为 running，且 ceph osd tree 中显示 up / in")
        else:
            # 包安装：这三步都要在「插了新盘的那台机器」上跑。单节点集群时
            # 它解析成本机，自动退化成本地执行，不需要配 ssh。
            try:
                _hs = cluster_hosts(cfg)
            except Exception:
                _hs = []
            init_host = host or (_hs[0] if len(_hs) == 1 else "")
            add("预检设备是否未被占用", ["ceph-volume", "lvm", "list", "--format=json"],
                "确认 %s 不在已用设备列表里（在这台机器上执行）" % dev, host=init_host)
            add("清理新盘旧元数据", ["ceph-volume", "lvm", "zap", dev, "--destroy"],
                "清掉分区表 / LVM / 文件系统签名；执行前请核对盘位与 SN", host=init_host)
            add("初始化并创建 OSD", ["ceph-volume", "lvm", "create", "--data", dev],
                "在该设备上创建 OSD 并自动加入 CRUSH，随后开始回填", host=init_host)
        add("集群健康验证", ["ceph", "-s", "--format=json"],
            "新 OSD 上线后数据开始回填，观察 PG 回到 active+clean")
    else:
        raise ValueError("unknown intent: %s" % intent)
    return plan


def _step(it):
    """计划项统一成 (name, argv, note, host)，兼容只有三个字段的旧计划（建池）。"""
    name, argv, note = it[0], it[1], it[2]
    host = it[3] if len(it) > 3 else ""
    return name, argv, note, (host or "")


def plan_strings(plan, cfg=None):
    """把计划渲染成可直接粘贴执行的命令行。

    远程步骤写成 `ssh user@host -- <cmd>`：既让人一眼看出「这条不是在本机跑」，
    也让复制出去的文本能直接落地执行。本机步骤保持裸命令，不额外加噪声。
    """
    out = []
    for it in plan:
        name, argv, note, host = _step(it)
        if not argv:
            out.append("# %s：%s" % (name, note or "人工步骤"))
            continue
        cmd = cmd_str(argv)
        if host and not host_is_local(host):
            out.append("ssh %s@%s -- %s" % (ssh_settings(cfg)["user"], host, cmd))
        else:
            out.append(cmd)
    return out


# 这些步骤失败不应中断整个流程（权限不足 / 服务本来就没跑 / 编排器未接管），
# 失败只记警告，后续步骤继续，最后由状态复核给出真实结论。
TOLERANT_STEPS = ("停止 OSD 守护进程", "启动 OSD 守护进程", "停止故障 OSD 守护进程",
                  # 包安装集群：服务可能已经不存在（purge 过 / 12.x 命名不同）
                  "停止并禁用旧 OSD 服务",
                  "预检设备是否可加入集群", "预检设备是否未被占用",
                  "轮询移除进度", "确认新盘已被编排器识别",
                  # ① 清退：队列里没有任务时 orch osd rm stop 会报错，属正常；
                  # ② 入群：已有 managed OSDSpec 时 daemon add 会提示已被管理，属正常。
                  "清掉旧版的僵尸移除任务", "确认旧 daemon 已退出",
                  # ① 清退：daemon 记录可能已被 cephadm 自己清掉，报错属正常。
                  "清掉 cephadm 的旧 daemon 定义",
                  "复核旧编号已从 osdmap 删除",
                  "创建并部署新 OSD（分配新编号）", "等待新 OSD 上线",
                  "确认新盘已被新 OSD 接管", "确认新 OSD 的 CRUSH 权重",
                  # 建池：预检 / autoscale / 复核失败都不应中断（池可能已经建好）
                  "检查池名是否已被占用", "启用 PG 自动扩缩", "复核池配置")


def execute_plan(cfg, probe, plan, allow_write):
    """DRY-RUN by default. Real execution only with --allow-write (and not read-only)."""
    commands = plan_strings(plan, cfg)
    if not allow_write or cfg.read_only or cfg.backend != "cli":
        return commands, ["dry-run: not executed"] * len(plan), True
    results = []
    for it in plan:
        name, argv, note, host = _step(it)
        if argv is None:
            results.append("manual step acknowledged (not automated)")
            continue
        remote = bool(host and not host_is_local(host))
        # ceph 命令（mon 侧）注入 conf/keyring 后在本机执行；
        # ceph-volume / systemctl / ceph-disk 必须在目标主机执行（远程步骤走 ssh）。
        if remote:
            rc, out, err, _via = host_run(cfg, host, argv, 180)
            label = "%s@%s: %s" % (ssh_settings(cfg)["user"], host, cmd_str(argv))
        elif argv[0] == "ceph":
            rc, out, err = ceph_run(cfg, argv[1:], 60)
            label = cmd_str(argv)
        else:
            rc, out, err = run(argv, 120)
            label = cmd_str(argv)
        text = (out.strip() or err.strip() or "rc=%d" % rc)[:300]
        results.append("rc=%d %s" % (rc, text))
        audit("EXEC", name, label, "OK" if rc == 0 else "FAIL", text)
        if rc != 0:
            if name in TOLERANT_STEPS:
                results.append("warning: %s 未成功，继续执行后续步骤" % name)
                continue
            results.append("stopped after failure: " + name)
            break
    return commands, results, False


def split_plan(plan):
    """Split around the human disk-swap step: (pre, manual_item, post)."""
    for i, item in enumerate(plan):
        if item[1] is None:
            return plan[:i], item, plan[i + 1:]
    return plan, None, []


def plan_detail(plan, cfg=None):
    """前端展示用的步骤清单：带上目标主机，界面据此显示「这台机器上执行」。"""
    out = []
    for it in plan:
        name, argv, note, host = _step(it)
        remote = bool(host and not host_is_local(host))
        out.append({"name": name,
                    "command": cmd_str(argv) if argv else "",
                    "manual": argv is None, "note": note or "",
                    "host": host, "remote": remote,
                    "via": (("ssh %s@%s" % (ssh_settings(cfg)["user"], host)) if remote
                            else ("local" if argv else ""))})
    return out


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

    def _write_allowed(self):
        """真实下发能力的两个服务端条件（不含身份判断）。

        1. `--allow-write` / `CEPH_CONSOLE_ALLOW_WRITE=1` 给了进程写权限；
        2. 设置页的「允许真实写操作」总开关为开。
           该开关默认关闭，且只有 admin 输入自己的密码才能改（/api/security）。
        只满足第 1 条时仍然全程 DRY-RUN，避免「装了带 --allow-write 就默认能动手」。
        """
        return bool(self.cfg.allow_write) and self.settings.get("allow_write") is True

    def _confirm_required(self):
        """危险操作二次确认（默认开）。关闭后仍需 admin + 写开关，只是不再要求
        手工输入 OSD 编号 / 池名。"""
        return self.settings.get("confirm", True) is not False

    def _security_update(self, body):
        """修改安全策略：必须 admin 会话 + 重新输入该账号的密码。

        这是一次「二次授权」：会话本身不能替代密码，避免有人用别人没锁屏的
        浏览器把真实写操作打开。两项设置持久化在 config.json（0600）。
        """
        s = self._session()
        status, payload = security_update(self.cfg, self.settings,
                                          s["user"] if s else "",
                                          s.get("role", "") if s else "",
                                          body, self._client())
        if status == 200:
            _STATE_CACHE["data"] = None
            _STATE_CACHE["ts"] = 0
            # 返回「本次请求视角」的最终可写状态：服务端能力 + 总开关 + 身份。
            payload["allow_write"] = self._write_allowed() and self._can_write()
        return self._json(payload, status)

    def _remote_config(self, body):
        """保存远程执行配置（admin）：写入 config.json 并立即生效，不需要重启。"""
        s = self._session()
        status, payload = remote_update(self.cfg, self.settings,
                                        s["user"] if s else "",
                                        (s or {}).get("role", ""), body, self._client())
        if status == 200:
            # 部署方式可能被改成 legacy：命令模板跟着变，必须重探一次
            try:
                self.probe.refresh()
            except Exception:
                pass
            _STATE_CACHE["data"] = None
            _STATE_CACHE["ts"] = 0
            payload["profile"] = self.probe.as_dict()
        return self._json(payload, status)

    def _remote_test(self, body):
        """只读探活：ssh 到指定主机跑 `hostname`。不执行任何写命令。"""
        s = self._session()
        if not s or s.get("role") != "admin":
            return self._json({"error": "只有 admin 角色可以测试远程执行"}, 403)
        host = str(body.get("host", "") or "").strip()
        if not host:
            hosts = cluster_hosts(self.cfg) if self.cfg.backend == "cli" else []
        else:
            if not HOST_RE.match(host):
                raise ValueError("invalid host")
            hosts = [host]
        res = [ssh_probe(self.cfg, h, force=True) for h in hosts]
        audit("REMOTE_TEST", ",".join(hosts), "ssh <host> hostname", "OK",
              json.dumps([{"host": r["host"], "ok": r["ok"], "err": r["err"]} for r in res],
                         ensure_ascii=False), self._client(), self._user())
        return self._json({"ok": True, "hosts": res,
                           "ready": ssh_ready(self.cfg),
                           "ssh": ssh_summary(self.cfg, hosts)})

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
                           "auth_required": True,
                           "allow_write": self._write_allowed() and role == "admin",
                           "write_capability": bool(self.cfg.allow_write),
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
                           "allow_write": self._write_allowed() and s["role"] == "admin",
                           "write_capability": bool(self.cfg.allow_write),
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
        if path == "/api/devices":
            # 「一键换盘」要先选新盘：只返回未被占用、可直接加入集群的设备。
            # 包安装集群由后端逐台宿主机 lsblk（多节点必须走 ssh），
            # 每台主机读不到的原因一并返回，前端据此提示「哪台没采到」。
            scan = device_scan(self.cfg, self.probe)
            return self._json({"ok": True, "devices": scan["devices"],
                               "hosts": scan["hosts"], "mode": scan["mode"],
                               "orchestrator": self.probe.orchestrator,
                               "deploy_mode": self.probe.deploy_mode,
                               "remote": ssh_summary(self.cfg,
                                                     [h["host"] for h in scan["hosts"]])})
        if path == "/api/remote":
            # 远程执行配置 + （可选）逐主机连通性。?probe=1 才会真的去连，
            # 平时只返回配置，避免页面每次刷新都等一遍 ssh 超时。
            hosts = cluster_hosts(self.cfg) if self.cfg.backend == "cli" else []
            probe_now = ("probe=1" in (self.path or "")) and self._session() is not None
            return self._json({"ok": True,
                               "data": ssh_summary(self.cfg, hosts, probe=probe_now),
                               "deploy_mode": self.probe.deploy_mode,
                               "deploy_override": getattr(self.cfg, "deploy_override", "auto"),
                               "orchestrator": self.probe.orchestrator})
        if path == "/api/pool/options":
            # 创建存储池弹窗的下拉项：OSD 数、CRUSH rule、EC profile、已有池名。
            return self._json({"ok": True, "data": read_pool_options(self.cfg, self.probe)})
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
        # 新增磁盘没有 OSD id，确认短语是设备路径；其余意图（含换盘）仍是 osd.<id>。
        if intent == "init":
            oid = None
            expected = dev
        else:
            oid = validate_target(oid, host, dev)
            expected = "osd.%d" % oid
        # 关闭「危险操作二次确认」后不再要求手工输入短语；写开关与 admin 身份仍必查。
        if self._confirm_required() and phrase != expected:
            return self._json({"error": "confirm_phrase mismatch (expected %s)" % expected}, 403)
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
            plan, pending, pause = pre, plan_strings(post, self.cfg), manual is not None
        elif stage == "post":
            plan, pending, pause = post, [], False
        else:
            plan, pending, pause = full, [], False
        allow = bool(body.get("allow_write")) and self._write_allowed() and self._can_write()
        if intent == "init" and allow:
            # 安全闸：不允许把已经在用的盘当新盘初始化（zap 是不可逆的）。
            used = set(osd_used_devices(self.cfg)[0].values())
            if dev in used:
                return self._json({"error": "%s 已被现有 OSD 使用，拒绝初始化；请确认新盘设备路径" % dev}, 400)
        if intent in ("replace", "deploy") and allow:
            # 只拦「目标盘正被一个 up/in 的健康 OSD 使用」。旧版残留编号 /
            # 盘上的旧 LVM 标签会让它看起来属于某个 down 的 OSD，那正是
            # ② 要 zap 掉的东西，不能拦。
            dev_by_id = osd_used_devices(self.cfg)[0]
            for i, d in dev_by_id.items():
                if not d or d != dev or i == oid:
                    continue
                st_i = osd_upin_state(self.cfg, i)
                if st_i and st_i.get("up") and st_i.get("in"):
                    return self._json({"error":
                        "%s 当前被 up/in 的 osd.%d 使用，zap 会抹掉正在服务的数据盘；"
                        "请核对设备路径" % (dev, i)}, 400)
        if intent == "retire" and allow:
            # ① 清退的硬门禁：OSD 必须确实已经 down。把还在 up 的盘清退掉，
            # 等于自己制造一次故障；这一步不能只靠前端提示。
            rp = retire_prereq(self.cfg, oid, self.probe.caps.get("orch", False))
            if rp.get("alreadyRetired"):
                audit("OSD_RETIRE", "osd.%d" % oid, "-", "SKIP",
                      "旧编号已从 osdmap 删除，清退已完成，直接执行第 ② 步",
                      self._client(), self._user())
                return self._json({"ok": True, "commands": [],
                                   "results": ["skip: osd.%d 已从 osdmap 删除，无需重复清退；"
                                               "现场换盘后执行第 ② 步「新盘入群」（新编号）" % oid],
                                   "target": "osd.%d" % oid,
                                   "verify": check_retire(self.cfg, oid,
                                                          self.probe.caps.get("orch", False)),
                                   "prereq": rp, "dry_run": False,
                                   "version": self.probe.version,
                                   "orchestrator": self.probe.orchestrator,
                                   "stage": stage, "pause": False,
                                   "pending_commands": [], "manual_step": None})
            if not rp["ok"]:
                audit("OSD_RETIRE", "osd.%d" % oid, "-", "BLOCKED",
                      "故障 OSD 未确认 down，拒绝清退：" + "；".join(rp["blockers"]),
                      self._client(), self._user())
                hint = ("\n顺序：让 osd.%d 真正 down（ceph osd down %d && "
                        "ceph osd out %d，或故障盘自然 down），确认 ceph osd tree "
                        "里 down 后再点「① 换盘前·清退」。本步用 mon 命令式 purge，"
                        "不经过 cephadm 的 --replace 队列，不检查 osd "
                        "safe-to-destroy，不会卡在 waiting for purge。"
                        % (oid, oid, oid))
                if rp.get("warnings"):
                    hint += "\n风险提示：\n" + "\n".join("· " + w for w in rp["warnings"])
                return self._json({"error":
                    "已阻止清退：前置条件不满足。\n"
                    + "\n".join("· " + b for b in rp["blockers"]) + hint,
                    "prereq": rp}, 409)
        if intent == "replace" and allow and stage == "auto" and manual is not None:
            return self._json({"error":
                "完整换盘预览必须按 pre / post 两阶段执行：先清退旧 OSD（删除编号），"
                "现场换好盘后再把新盘加入集群。一次请求跳过人工换盘步骤会被拒绝；"
                "日常操作请直接用「① 清退」「② 入群」两个按钮"}, 409)
        if intent in ("replace", "deploy") and allow and (stage == "post" or intent == "deploy"):
            # ② 入群前只判断「这块新盘是不是已经有一个 up/in 的 OSD 接管了」，
            # 是就跳过 zap，避免把刚部署好的盘抹掉。编号不参与判断：
            # 旧编号可能恰好被 mon 重新分配，也可能换成别的号。
            owner = device_owner(self.cfg, dev)
            if owner is not None:
                st_owner = osd_upin_state(self.cfg, owner)
                if st_owner and st_owner.get("up") and st_owner.get("in"):
                    verify = check_replace(self.cfg, oid, dev)
                    _STATE_CACHE["data"] = None
                    _STATE_CACHE["ts"] = 0
                    audit("OSD_REPLACE", "osd.%d" % oid, dev or "-", "SKIP",
                          "新盘已有 osd.%d 接管并 up/in，跳过重复 zap" % owner,
                          self._client(), self._user())
                    return self._json({"ok": True, "commands": [],
                                       "results": ["skip: %s 已被 osd.%d 接管并 up/in，"
                                                   "无需再 zap（新编号，旧编号已在 ① 删除）"
                                                   % (dev, owner)],
                                       "target": "osd.%d" % oid, "verify": verify,
                                       "dry_run": False, "version": self.probe.version,
                                       "orchestrator": self.probe.orchestrator,
                                       "stage": stage, "pause": False,
                                       "pending_commands": [], "manual_step": None})
                # 盘上的旧签名 / 残留编号仍指向一个非 up/in 的 OSD：继续 zap，
                # 不暂停 —— 那正是本步要清掉的东西。
            # ② 的硬门禁只剩「别抹掉别人的盘」；不再要求 destroyed /
            # osd_id_claims / managed OSDSpec，新编号由 mon 分配。
            pre_ok = replace_prereq(self.cfg, oid, dev)
            if not pre_ok["ok"]:
                audit("OSD_REPLACE", "osd.%d" % oid, dev or "-", "BLOCKED",
                      "新盘归属校验失败，拒绝 zap：" + "；".join(pre_ok["blockers"]),
                      self._client(), self._user())
                return self._json({"error":
                    "已阻止 zap：目标盘归属有问题，继续会抹掉别的 OSD 正在用的盘。\n"
                    + "\n".join("· " + b for b in pre_ok["blockers"])
                    + "\n核对：ceph orch device ls / ceph osd metadata <id> / "
                      "lsblk -o NAME,FSTYPE,LABEL，确认设备路径确实是换上的新盘。"
                      "本方案不保留编号，不需要等 destroyed 或 osd_id_claims。",
                    "prereq": pre_ok}, 409)
        # 包安装集群的硬门禁：计划里出现「非本机」步骤时必须能 ssh 过去。
        # 没有远程执行层就拒绝，绝不退化成在本机跑 ceph-volume/systemctl ——
        # 那会把盘操作打到控制台自己的盘上，是最危险的一类误操作。
        if allow:
            remote_hosts = sorted(set(h for h in (_step(x)[3] for x in plan)
                                      if h and not host_is_local(h)))
            if remote_hosts and not ssh_ready(self.cfg):
                st = ssh_settings(self.cfg)
                reason = ("远程执行已被关闭" if not st["enabled"]
                          else "控制台主机上没有 ssh 客户端（openssh-clients）")
                audit("OSD_%s" % intent.upper(), "osd.%s" % oid, "-", "BLOCKED",
                      "缺少远程执行能力，拒绝下发：" + reason,
                      self._client(), self._user())
                return self._json({"error":
                    "已阻止执行：这些命令必须在目标主机上运行，但控制台现在连不过去。\n"
                    + "· 目标主机：" + "、".join(remote_hosts) + "\n"
                    + "· 原因：" + reason + "\n"
                    + "请在「系统设置 → 远程执行」里配置 SSH（用户 / 端口 / 私钥），"
                      "并用「测试连通性」确认每台主机都是可达的。\n"
                      "也可以先用 DRY-RUN 只生成命令，拿到目标主机上手工执行。",
                    "remote_hosts": remote_hosts,
                    "ssh": ssh_summary(self.cfg, remote_hosts)}, 409)
        commands, results, dry = execute_plan(self.cfg, self.probe, plan, allow)
        prereq = None
        if intent == "replace" and not dry and stage == "pre":
            # 完整预览的 pre 阶段：附上 ② 的只读预检，暂停界面好提前显示。
            # 不再轮询 destroyed —— 编号不保留，purge 是 mon 侧同步操作。
            prereq = replace_prereq(self.cfg, oid, dev)
        verify = None
        if intent == "downout" and not dry:
            # 命令返回码为 0 不等于 down 真的生效（心跳会把标记改回 up），
            # 必须回读 ceph osd dump 复核，并把真实结论回给前端。
            verify = check_downout(self.cfg, oid)
            if verify["message"]:
                results.append("verify: " + verify["message"])
        if intent == "retire" and not dry:
            # ① 阶段的结论是「旧编号是不是真的删掉了」，不是「OSD 上线了没」。
            # 拿 check_replace 复核清退会必然报失败，那是拿错了尺子。
            verify = check_retire(self.cfg, oid, self.probe.caps.get("orch", False))
            if verify["message"]:
                results.append("verify: " + verify["message"])
        if intent in ("replace", "deploy") and not dry and stage != "pre":
            # ② 只看「新盘有没有被一个 up/in 的 OSD 接管」，编号不参与判定。
            # stage=pre 时新盘还没换，此刻复核必然失败，不能当成结论。
            verify = check_replace(self.cfg, oid, dev)
            if verify["message"]:
                results.append("verify: " + verify["message"])
        if not dry:
            # 真正下发过命令：丢掉状态缓存，下一次 /api/state 必须重新读取，
            # 否则前端会拿 20 秒内的旧快照把刚改的 up/in 覆盖回去。
            _STATE_CACHE["data"] = None
            _STATE_CACHE["ts"] = 0
            # 观察期：刚改过集群状态，health check 有滞后期，这段时间里
            # 「health detail 暂时没这条」不等于「已经恢复」。
            alert_write_grace()
        target = "osd.%d" % oid if oid is not None else dev
        audit("OSD_%s" % intent.upper(), target, " ; ".join(commands),
              "DRY-RUN" if dry else "EXECUTED",
              "remote=%s ceph=%s stage=%s" % (self._client(), self.probe.version, stage),
              self._client(), self._user())
        manual_note = (manual[2] or "") if manual else ""
        if manual and prereq and not prereq["ok"]:
            manual_note += ("｜新盘归属校验未满足，现场换盘后点「继续执行」会被拒绝："
                            + "；".join(prereq["blockers"]))
        return self._json({"ok": True, "commands": commands, "results": results,
                           "target": target, "verify": verify, "prereq": prereq,
                           "dry_run": dry, "version": self.probe.version,
                           "orchestrator": self.probe.orchestrator,
                           "stage": stage, "pause": pause, "pending_commands": pending,
                           "manual_step": ({"name": manual[0], "note": manual_note}
                                           if manual else None)})

    def _pool_create(self, body):
        """创建存储池：与 OSD 操作共用同一套权限闸、DRY-RUN 与审计，
        确认短语是池名（新建对象没有 OSD 编号可确认）。"""
        if not self._authorized():
            return self._auth_error()
        s = self._session()
        if s is not None and s.get("role") != "admin" and bool(body.get("allow_write")):
            return self._json({"error": "viewer role cannot create pools"}, 403)
        if self.cfg.read_only:
            return self._json({"error": "read-only keyring: write operations are disabled"}, 403)
        if self.cfg.backend != "cli":
            return self._json({"error": "REST backend is read-only; deploy CLI backend for pool operations"}, 403)
        spec = validate_pool_spec(body)
        if self._confirm_required() and str(body.get("confirm_phrase", "") or "") != spec["name"]:
            return self._json({"error": "confirm_phrase mismatch (expected %s)" % spec["name"]}, 403)
        # 重名会让 create 直接失败，也可能误以为「建好了」；提前挡住并说清楚。
        if spec["name"] in pool_names(self.cfg):
            return self._json({"error": "存储池 %s 已存在，请换一个名称" % spec["name"]}, 400)
        plan = build_pool_plan(self.cfg, self.probe, spec)
        allow = bool(body.get("allow_write")) and self._write_allowed() and self._can_write()
        commands, results, dry = execute_plan(self.cfg, self.probe, plan, allow)
        verify = None
        if not dry:
            # 只有回读到池且参数对得上才算成功，命令返回 0 不当作结论。
            verify = check_pool(self.cfg, spec["name"])
            if verify["message"]:
                results.append("verify: " + verify["message"])
            _STATE_CACHE["data"] = None
            _STATE_CACHE["ts"] = 0
        audit("POOL_CREATE", spec["name"], " ; ".join(commands),
              "DRY-RUN" if dry else ("EXECUTED" if (verify is None or verify.get("ok")) else "UNVERIFIED"),
              "remote=%s ceph=%s type=%s pg=%s" % (self._client(), self.probe.version,
                                                  spec["type"], spec["pg_num"]),
              self._client(), self._user())
        return self._json({"ok": True, "commands": commands, "results": results,
                           "target": spec["name"], "spec": spec, "verify": verify,
                           "dry_run": dry, "version": self.probe.version,
                           "orchestrator": self.probe.orchestrator})

    def _osd_redeploy(self, body):
        """修复 cephadm 侧陈旧的 daemon unit（编号复用后 osd 永远 error/down）。

        只重建守护进程的 systemd unit / 容器：不 zap、不删数据、不动 osdmap。
        现场证据：purge 掉旧 osd.0 后新盘又拿到编号 0，cephadm 沿用旧的
        /var/lib/ceph/<fsid>/osd.0/unit.run（里面 --osd-uuid 还是上一块盘的），
        ceph-volume activate 找不到 LV，容器起来 1 秒就退，OSD 永远 down。
        """
        if not self._authorized():
            return self._auth_error()
        s = self._session()
        if s is not None and s.get("role") != "admin" and bool(body.get("allow_write")):
            return self._json({"error": "viewer role cannot redeploy daemons"}, 403)
        if self.cfg.read_only:
            return self._json({"error": "read-only keyring: write operations are disabled"}, 403)
        if self.cfg.backend != "cli" or not self.probe.caps.get("orch"):
            return self._json({"error": "redeploy needs the cephadm orchestrator"}, 400)
        try:
            oid = int(str(body.get("osd_id", "")).replace("osd.", ""))
        except (TypeError, ValueError):
            raise ValueError("invalid osd id")
        if oid < 0 or oid > 99999:
            raise ValueError("osd_id out of range")
        phrase = "osd.%d" % oid
        if self._confirm_required() and str(body.get("confirm_phrase", "") or "") != phrase:
            return self._json({"error": "confirm_phrase mismatch (expected %s)" % phrase}, 403)
        plan = [("重新部署 OSD 守护进程（重建 unit）",
                 ["ceph", "orch", "daemon", "redeploy", "osd.%d" % oid],
                 "只重建 daemon 的 systemd unit 与容器，不 zap、不删数据")]
        allow = bool(body.get("allow_write")) and self._write_allowed() and self._can_write()
        commands, results, dry = execute_plan(self.cfg, self.probe, plan, allow)
        verify = None
        if not dry:
            # redeploy 是异步的：给 cephadm 几秒把容器拉起来再回读。
            time.sleep(6)
            st = osd_upin_state(self.cfg, oid)
            dmn = orch_osd_daemon(self.cfg, oid) or {}
            verify = {"ok": bool(st and st.get("up")),
                      "up": (st or {}).get("up"), "in": (st or {}).get("in"),
                      "daemon": dmn.get("status_desc") or "",
                      "message": ("osd.%d 已重新部署并 up" % oid)
                      if (st and st.get("up")) else
                      ("已提交 redeploy，但 osd.%d 还没 up（cephadm 状态 %s）；"
                       "cephadm 拉起容器常需几十秒，稍后重新复核 "
                       "ceph orch ps --daemon-type osd" % (oid, dmn.get("status_desc") or "unknown"))}
            results.append("verify: " + verify["message"])
            _STATE_CACHE["data"] = None
            _STATE_CACHE["ts"] = 0
        audit("OSD_REDEPLOY", phrase, " ; ".join(commands),
              "DRY-RUN" if dry else ("EXECUTED" if (verify or {}).get("ok") else "UNVERIFIED"),
              "remote=%s ceph=%s" % (self._client(), self.probe.version),
              self._client(), self._user())
        return self._json({"ok": True, "commands": commands, "results": results,
                           "target": phrase, "verify": verify, "dry_run": dry,
                           "allow_write": allow})

    def _alert_ack(self, body):
        """确认 / 静音告警。状态存在后端，刷新页面和换浏览器都保持，
        不会下一轮采集又被 health detail 覆盖成「未处置」。"""
        if not self._authorized():
            return self._auth_error()
        s = self._session()
        if s is not None and s.get("role") != "admin":
            return self._json({"error": "viewer role cannot acknowledge alerts"}, 403)
        aid = str(body.get("id", "") or "")
        action = str(body.get("action", "ack") or "ack")
        try:
            minutes = int(body.get("minutes") or ALERT_SILENCE_DEFAULT)
        except (TypeError, ValueError):
            minutes = ALERT_SILENCE_DEFAULT
        res = alert_ack(self.cfg, aid, action, self._user(), minutes)
        if not res.get("ok"):
            return self._json(res, 404)
        audit({"ack": "ALERT_ACK", "silence": "ALERT_SILENCE",
               "reopen": "ALERT_REOPEN", "resolve": "ALERT_RESOLVE"}.get(action, "ALERT_ACK"),
              aid, "-", "OK",
              "status=%s by=%s%s" % (res["status"], self._user(),
                                     (" until_ts=%s" % res["until"]) if res.get("until") else ""),
              self._client(), self._user())
        # 让下一次 /api/state 重新取告警（否则还是旧的 active 快照）。
        _STATE_CACHE["data"] = None
        _STATE_CACHE["ts"] = 0
        return self._json({"ok": True, "alert": res})

    def api_post(self, path, body):
        if path == "/api/beacon":
            # 前端行为埋点：只写日志，不写审计、不需要写权限。
            # 存在的唯一理由：「点了按钮什么都没发生」这类问题只在浏览器里发生，
            # 光看后端访问日志只能知道「没发请求」，不知道卡在前端哪一步。
            # 前端在 q-run 的每个分支都会打一条，服务端原样记下来，
            # 之后 journalctl -u ceph-console | grep '\[beacon\]' 就能看到完整路径。
            kind = str(body.get("kind", ""))[:24]
            branch = str(body.get("branch", ""))[:40]
            detail = str(body.get("detail", ""))[:400]
            ui = str(body.get("ui", ""))[:24]
            sys.stderr.write("[beacon] ui=%s user=%s ip=%s kind=%s branch=%s detail=%s\n"
                             % (ui or "-", self._user(), self.client_address[0],
                                kind or "-", branch or "-", detail.replace("\n", " ")))
            sys.stderr.flush()
            return self._json({"ok": True})
        if path == "/api/osd/verify":
            # 只读复核：换盘后 OSD 起来有延迟，前端用它重新回读，不必重跑流程。
            # 只看 ceph osd dump / metadata，不执行任何写命令。
            try:
                oid = int(str(body.get("osd_id", "")).replace("osd.", ""))
            except (TypeError, ValueError):
                raise ValueError("invalid osd id")
            dev = str(body.get("dev", "") or "")
            if ".." in dev or (dev and not DEV_RE.match(dev)):
                raise ValueError("invalid device path")
            st = osd_upin_state(self.cfg, oid)
            # ① 清退阶段复核的是「旧编号是否已删除」，② 入群阶段复核的是
            # 「新盘有没有被一个 up/in 的 OSD 接管」，两把尺子不能混用。
            phase = str(body.get("phase", "deploy"))
            verify = (check_retire(self.cfg, oid, self.probe.caps.get("orch", False))
                      if phase == "retire" else check_replace(self.cfg, oid, dev))
            return self._json({"ok": True, "verify": verify, "phase": phase,
                               "up": (st or {}).get("up"), "in": (st or {}).get("in"),
                               "ts": int(time.time())})
        if path == "/api/alert/ack":
            return self._alert_ack(body)
        if path == "/api/osd/redeploy":
            return self._osd_redeploy(body)
        if path == "/api/security":
            return self._security_update(body)
        if path == "/api/remote/config":
            return self._remote_config(body)
        if path == "/api/remote/test":
            return self._remote_test(body)
        if path == "/api/password":
            return self.api_password(body)
        if path == "/api/pool/plan":
            # 只预览不落库：前端第二步展示的必须与执行时同一套模板。
            spec = validate_pool_spec(body)
            plan = build_pool_plan(self.cfg, self.probe, spec)
            return self._json({"ok": True, "spec": spec,
                               "steps": plan_detail(plan, self.cfg),
                               "commands": plan_strings(plan, self.cfg),
                               "exists": spec["name"] in pool_names(self.cfg),
                               "version": self.probe.version,
                               "orchestrator": self.probe.orchestrator,
                               "allow_write": self._write_allowed() and self._can_write(),
                               "read_only": self.cfg.read_only})
        if path == "/api/pool/create":
            return self._pool_create(body)
        if path == "/api/plan":
            intent = str(body.get("intent", "replace"))
            oid = body.get("osd_id")
            host = str(body.get("host", "") or "")
            dev = str(body.get("dev", "") or "")
            # 校验交给 build_plan：init 意图没有 osd_id，只认 host + dev。
            plan = build_plan(self.cfg, self.probe, intent, oid, host, dev)
            resp = {"ok": True, "steps": plan_detail(plan, self.cfg),
                    "commands": plan_strings(plan, self.cfg),
                    "version": self.probe.version,
                    "orchestrator": self.probe.orchestrator,
                    "allow_write": self._write_allowed() and self._can_write(),
                    "read_only": self.cfg.read_only}
            # 只读预检：让弹窗在动手之前就显示「盘确实 down 了吗」
            # 「新盘是不是被别的 OSD 占着」。执行时后端会重新核验一遍。
            if intent == "retire":
                resp["precheck"] = retire_prereq(
                    self.cfg, oid, self.probe.caps.get("orch", False))
            elif intent in ("deploy", "replace"):
                resp["precheck"] = replace_prereq(self.cfg, oid, dev)
            return self._json(resp)
        if path in ("/api/quick/kick", "/api/quick/replace", "/api/quick/retire",
                    "/api/quick/deploy", "/api/quick/in", "/api/quick/init", "/api/execute"):
            override = None
            if path == "/api/quick/kick":
                # 踢盘 = 停服务 + down + out，不是退役。
                override = "downout"
            elif path == "/api/quick/retire":
                override = "retire"
            elif path == "/api/quick/deploy":
                override = "deploy"
            elif path == "/api/quick/replace":
                override = "replace"
            elif path == "/api/quick/in":
                override = "in"
            elif path == "/api/quick/init":
                # 新增磁盘 = 扩容（清元数据 + 创建 OSD，分配新编号）
                override = "init"
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
            if self._write_allowed() and (body.get("confirm_phrase") == "osd.%d" % oid
                                          or not self._confirm_required()):
                daemon = ""
                if action == "in":
                    # 踢盘时停过守护进程：只做 osd in 会恢复权重但状态仍是 down。
                    d_argv = osd_daemon_cmd(self.probe, "start", oid)
                    drc, dout, derr = _run_argv(self.cfg, d_argv, 90)
                    daemon = "rc=%d %s" % (drc, (dout.strip() or derr.strip() or "")[:160])
                    audit("OSD_DAEMON_START", "osd.%d" % oid, cmd_str(d_argv),
                          "OK" if drc == 0 else "FAIL", daemon,
                          self._client(), self._user())
                rc, out, err = ceph_run(self.cfg, argv[1:], 30)
                res = "OK" if rc == 0 else "FAIL"
                if rc == 0:
                    # osd out / in 立即改变 up·in，必须让 /api/state 丢掉旧缓存，
                    # 否则前端点完按钮几秒后又被旧快照翻回原状态。
                    _STATE_CACHE["data"] = None
                    _STATE_CACHE["ts"] = 0
                    # 同时开一个观察期：这段时间 health detail 里暂时看不到的
                    # 告警不判恢复（IN 之后 Ceph 往往要几十秒才开始报 PG_DEGRADED）。
                    alert_write_grace()
                audit("OSD_%s" % action.upper(), "osd.%d" % oid, cmd_str(argv), res, err[:200],
                      self._client(), self._user())
                return self._json({"ok": rc == 0, "result": res, "daemon": daemon,
                                   "detail": (out or err)[:300]})
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
            # 静态资源的 cache-bust 跟随后端版本：升级后浏览器必定重新拉取 JS，
            # 不再依赖用户手动 Ctrl+F5，也避免「改了这个页面还是旧的」。
            data = re.sub(rb"\?v=[A-Za-z0-9._-]+", b"?v=" + VERSION.encode(), data)
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
    p.add_argument("--config-file", default="",
                   help="config.json holding alert thresholds and security policy (default %s)" % CONF_PATH)
    p.add_argument("--no-auth", action="store_true", help="disable login (NOT recommended)")
    p.add_argument("--session-ttl", default="", help="session lifetime in seconds (default 8h)")
    p.add_argument("--cors-origin", default="",
                   help="allowed UI origin(s), comma separated; default * for intranet")
    p.add_argument("--host-metrics", choices=["auto", "ssh", "off"], default="auto",
                   help="per-host CPU/mem source: auto (local /proc + ssh to other nodes) | "
                        "ssh (ssh only) | off (do not collect)")
    # 远程执行：二进制 / 包安装集群动盘时必须能把 systemctl、ceph-volume
    # 下发到「盘所在的主机」。cephadm 集群用不到，可以不配。
    p.add_argument("--ssh-user", default="",
                   help="remote-exec user for binary/package clusters (default root)")
    p.add_argument("--ssh-port", default="", help="remote-exec ssh port (default 22)")
    p.add_argument("--ssh-key", default="",
                   help="ssh private key path (default: agent / ~/.ssh/id_* of the service account)")
    p.add_argument("--ssh-sudo", dest="ssh_sudo", action="store_true", default=None,
                   help="run remote commands through sudo -n (default on)")
    p.add_argument("--no-ssh-sudo", dest="no_ssh_sudo", action="store_true",
                   help="remote commands run as the ssh user without sudo")
    p.add_argument("--no-ssh", action="store_true",
                   help="disable remote execution entirely (single-node / cephadm only)")
    p.add_argument("--ssh-timeout", default="", help="ssh connect timeout seconds (default 6)")
    p.add_argument("--host-ssh-user", default="",
                   help="(deprecated) alias of --ssh-user, kept for older deploy scripts")
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
    # 安全策略的出厂值：真实写操作默认关闭、危险操作二次确认默认开启。
    # 两者持久化在 config.json，修改必须验证 admin 密码（见 /api/security）。
    # 注意：即使以 --allow-write 启动，allow_write 仍默认 False —— 服务端能力
    # 与「人是否授权本次真实下发」是两层闸门，后者只能由 admin 在页面上开。
    settings = {"nearfull": 85, "full": 95, "downMin": 10,
                "allow_write": False, "confirm": True}
    if os.path.isfile(conf_path(cfg)):
        try:
            with open(conf_path(cfg), "r") as f:
                settings.update(json.load(f))
        except (IOError, ValueError):
            pass
    # config.json 里的 ssh / deploy_mode 生效后必须重探一次：
    # 「部署方式覆盖」直接决定命令模板（orch vs ceph-volume），不能沿用启动时的结论。
    before = (probe.orchestrator, probe.deploy_mode)
    apply_remote_settings(cfg, settings)
    if (probe.orchestrator, probe.deploy_mode) != before or cfg.deploy_override != "auto":
        try:
            probe.refresh()
        except Exception:
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
    print("  Deploy    : %s (orchestrator=%s, override=%s)" %
          (probe.deploy_mode, probe.orchestrator, cfg.deploy_override))
    _st = ssh_settings(cfg)
    print("  Remote    : %s (%s@<host>:%d, sudo=%s, key=%s)" %
          ("ssh ready" if ssh_ready(cfg) else "unavailable",
           _st["user"], _st["port"], _st["sudo"], _st["key"] or "agent/default"))
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
