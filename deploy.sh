#!/usr/bin/env bash
# Ceph Ops Console - one-click deploy on an existing Linux host.
# Compatible: RHEL/CentOS 7-9, Rocky/Alma, Fedora, Ubuntu/Debian, openEuler,
#             Kylin V10 / UOS, SUSE, and generic systemd / SysVinit hosts.
# No network access, no pip packages, no compilation. Python 3.6+ only.
set -euo pipefail

VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------- defaults ----------------
DO_INSTALL=0
DO_UNINSTALL=0
DO_PURGE=0
LOCAL_MODE=0
NO_FIREWALL=0
NO_SERVICE=0
NO_KEYRING=0
INSTALL_DEPS=0
ALLOW_WRITE=0
BACKEND="cli"
HOST=""
PORT="8780"
DIR="/opt/ceph-console"
KEYRING_MODE="full"
REST_URL=""
REST_TOKEN=""
TOKEN=""
PY=""
CEPH_CONF=""
CEPH_NAME="client.ceph-console"
CEPH_KEYRING="/etc/ceph/ceph.client.ceph-console.keyring"
CONF_DIR="/etc/ceph-console"
LOG_DIR="/var/log/ceph-console"
SERVICE_NAME="ceph-console"
FILES="ceph-console.py ceph-dashboard.html app-core.js app-views.js app-wizard.js app-live.js"
FRONTEND_FILES="ceph-dashboard.html app-core.js app-views.js app-wizard.js app-live.js"
MODE="all"
ADMIN_USER="admin"
ADMIN_PASS="${CEPH_CONSOLE_PASSWORD:-}"
BACKEND_URL=""
CORS_ORIGIN="*"
NO_AUTH=0
USERS_FILE="$CONF_DIR/users.json"

C_OK="\033[32m"; C_WARN="\033[33m"; C_ERR="\033[31m"; C_B="\033[1m"; C_0="\033[0m"
say()  { printf "%b\n" "$*"; }
ok()   { say "${C_OK}[ OK ]${C_0} $*"; }
warn() { say "${C_WARN}[WARN]${C_0} $*"; }
err()  { say "${C_ERR}[FAIL]${C_0} $*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
cat <<'EOF'
Ceph Ops Console - one-click deploy (Linux)

Usage:  sudo bash deploy.sh [options]

  --install            Perform the installation (without this: preview only)
  --local              Install on the current host (files are read from script dir)
  --host IP            Public IP / hostname used in the access URL
  --port N             Service port (default 8780)
  --dir DIR            Install directory (default /opt/ceph-console)
  --keyring MODE       full (read+write OSD ops) | readonly (monitoring only)
                       | none (reuse existing admin keyring)
  --token STR          API token (auto-generated when omitted)
  --allow-write        Allow real OSD operations (DANGEROUS; default DRY-RUN)
  --backend MODE       cli (default, full) | rest (read-only proxy)
  --rest-url URL       mgr dashboard URL for rest backend, e.g. https://IP:8443
  --rest-token STR     dashboard bearer token
  --mode MODE         all (default: one-click on the Ceph admin node)
                      | backend (API service only, UI hosted elsewhere)
                      | frontend (static UI only, on a separate web server)
  --user NAME         Login username (default: admin)
  --password STR      Login password; env CEPH_CONSOLE_PASSWORD is safer.
                      Auto-generated when omitted and printed once at the end.
                      Re-running --install without it keeps the current password.
  --backend-url URL   Backend API URL for --mode frontend, e.g. http://IP:8780
  --cors-origin LIST  Allowed UI origins (default *; comma separated to restrict)
  --no-auth           Disable login (NOT recommended)
  --no-firewall       Do not modify firewall rules
  --no-service        Do not register systemd/SysV service
  --install-deps       Attempt to install python3 / ceph-common via package manager
  --uninstall          Stop and remove the service
  --purge              With --uninstall: also remove config, keyring and logs
  -h, --help           Show this help

Examples:
  # Preview only (no changes):
  bash deploy.sh --local --host 192.168.27.134 --port 8780
  # One-click install on the Ceph admin node (real OSD ops enabled):
  sudo bash deploy.sh --local --host 192.168.27.134 --allow-write --install
  # Split deployment: UI on a separate web server, backend on the Ceph node:
  sudo bash deploy.sh --local --mode frontend --dir /var/www/ceph-console \
    --backend-url http://192.168.27.134:8780 --install
  # Uninstall (add --purge to also remove config, keyring and logs):
  sudo bash deploy.sh --uninstall
  sudo bash deploy.sh --uninstall --purge
EOF
}

# ---------------- args ----------------
while [ $# -gt 0 ]; do
  case "$1" in
    --install) DO_INSTALL=1 ;;
    --uninstall) DO_UNINSTALL=1 ;;
    --purge) DO_PURGE=1 ;;
    --local) LOCAL_MODE=1 ;;
    --no-firewall) NO_FIREWALL=1 ;;
    --no-service) NO_SERVICE=1 ;;
    --install-deps) INSTALL_DEPS=1 ;;
    --allow-write) ALLOW_WRITE=1 ;;
    --no-auth) NO_AUTH=1 ;;
    --mode) MODE="$2"; shift ;;
    --user) ADMIN_USER="$2"; shift ;;
    --password) ADMIN_PASS="$2"; shift ;;
    --backend-url) BACKEND_URL="$2"; shift ;;
    --cors-origin) CORS_ORIGIN="$2"; shift ;;
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --keyring) KEYRING_MODE="$2"; shift ;;
    --token) TOKEN="$2"; shift ;;
    --backend) BACKEND="$2"; shift ;;
    --rest-url) REST_URL="$2"; shift ;;
    --rest-token) REST_TOKEN="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
  shift
done

case "$KEYRING_MODE" in
  full|readonly) ;;
  none|no|skip) NO_KEYRING=1; KEYRING_MODE="readonly" ;;
  *) die "--keyring must be full, readonly or none" ;;
esac
case "$BACKEND" in cli|rest) ;; *) die "--backend must be cli or rest" ;; esac
case "$MODE" in all|backend|frontend) ;; *) die "--mode must be all / backend / frontend" ;; esac
case "$PORT" in ''|*[!0-9]*) die "--port must be numeric" ;; esac
if [ "$MODE" = "frontend" ] && [ "$DIR" = "/opt/ceph-console" ]; then DIR="/var/www/ceph-console"; fi
[ -z "$HOST" ] && HOST="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
[ -z "$HOST" ] && HOST="127.0.0.1"

# ---------------- environment detection ----------------
ID="unknown"; VERSION_ID=""; PRETTY="Linux"; ID_LIKE=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  ID="${ID:-unknown}"; VERSION_ID="${VERSION_ID:-}"; PRETTY="${PRETTY_NAME:-$ID}"; ID_LIKE="${ID_LIKE:-}"
fi
case "$ID $ID_LIKE" in
  *rhel*|*fedora*|*centos*|*rocky*|*alma*|*openEuler*|*euleros*|*kylin*|*uos*) FAMILY="rhel" ;;
  *debian*|*ubuntu*) FAMILY="debian" ;;
  *suse*|*sles*) FAMILY="suse" ;;
  *) FAMILY="generic" ;;
esac

if [ -d /run/systemd/system ] || [ "$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')" = "systemd" ]; then
  INIT="systemd"
elif [ -d /etc/init.d ]; then
  INIT="sysvinit"
else
  INIT="manual"
fi

FIREWALL="none"
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  FIREWALL="firewalld"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "active"; then
  FIREWALL="ufw"
elif command -v iptables >/dev/null 2>&1; then
  FIREWALL="iptables"
fi

SELINUX="not-installed"
if command -v getenforce >/dev/null 2>&1; then SELINUX="$(getenforce 2>/dev/null || echo unknown)"; fi

py_supported() { "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)' >/dev/null 2>&1; }
find_python() {
  local c
  for c in python3 python3.12 python3.11 python3.10 python3.9 python3.8 python3.7 python3.6 python \
           /usr/bin/python3 /usr/libexec/platform-python /opt/rh/rh-python36/root/usr/bin/python3; do
    if command -v "$c" >/dev/null 2>&1 && py_supported "$c"; then echo "$(command -v "$c")"; return 0; fi
  done
  return 1
}

install_deps_if_requested() {
  [ "$INSTALL_DEPS" -eq 1 ] || return 0
  warn "--install-deps: attempting package install (requires network / local repo)"
  case "$FAMILY" in
    rhel)   command -v dnf >/dev/null 2>&1 && dnf install -y python3 ceph-common || yum install -y python3 ceph-common ;;
    debian) apt-get update -qq && apt-get install -y -qq python3 ceph-common ;;
    suse)   zypper -n install python3 ceph-common ;;
    *) warn "unknown distribution family; please install python3 and ceph-common manually" ;;
  esac
}

PY="$(find_python || true)"

# ---------------- uninstall ----------------
if [ "$DO_UNINSTALL" -eq 1 ]; then
  say "${C_B}Ceph Ops Console - uninstall${C_0}"
  if [ "$INIT" = "systemd" ]; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
  else
    [ -x "/etc/init.d/$SERVICE_NAME" ] && "/etc/init.d/$SERVICE_NAME" stop >/dev/null 2>&1 || true
    rm -f "/etc/init.d/$SERVICE_NAME"
  fi
  if [ "$NO_FIREWALL" -eq 0 ]; then
    case "$FIREWALL" in
      firewalld) firewall-cmd --permanent --remove-port="${PORT}/tcp" >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true ;;
      ufw) ufw delete allow "${PORT}/tcp" >/dev/null 2>&1 || true ;;
      iptables) iptables -D INPUT -p tcp --dport "$PORT" -j ACCEPT >/dev/null 2>&1 || true ;;
    esac
  fi
  rm -rf "$DIR"
  if [ "$DO_PURGE" -eq 1 ]; then
    rm -rf "$CONF_DIR" "$LOG_DIR" "$CEPH_KEYRING"
    ok "config / keyring / logs removed"
  else
    warn "kept $CONF_DIR (use --purge to remove)"
  fi
  ok "uninstalled"
  exit 0
fi

# ---------------- preview banner ----------------
say ""
say "${C_B}Ceph Ops Console ${VERSION} - deployment preflight${C_0}"
say "  OS          : $PRETTY  (ID=$ID, VERSION_ID=$VERSION_ID, family=$FAMILY)"
say "  Python      : ${PY:-NOT FOUND}"
say "  init        : $INIT"
say "  firewall    : $FIREWALL"
say "  SELinux     : $SELINUX"
say "  backend     : $BACKEND"
say "  target host : $HOST:$PORT"
say "  install dir : $DIR"
say "  keyring     : $KEYRING_MODE"
say "  write mode  : $([ "$ALLOW_WRITE" -eq 1 ] && echo 'ENABLED (dangerous)' || echo 'DRY-RUN (safe default)')"
say "  deploy mode : $MODE"
if [ "$MODE" != "frontend" ]; then
  say "  login user  : $ADMIN_USER  (password auto-generated when omitted)"
  say "  CORS        : $CORS_ORIGIN"
fi

MISSING=""
if [ "$MODE" = "frontend" ]; then CHECK_FILES="$FRONTEND_FILES"; else CHECK_FILES="$FILES"; fi
for f in $CHECK_FILES; do [ -f "$SCRIPT_DIR/$f" ] || MISSING="$MISSING $f"; done
if [ -n "$MISSING" ]; then
  die "missing files in $SCRIPT_DIR:$MISSING  -> copy all files from the release bundle first"
fi

# ---- make sure the native Ceph dashboard is not affected ----
if [ "$MODE" != "frontend" ]; then
  CONFLICT=0
  for p in 8443 8080 3000 7000 9283 5000; do
    if [ "$PORT" = "$p" ]; then CONFLICT=1; fi
  done
  if [ "$CONFLICT" -eq 1 ]; then
    die "port $PORT may be used by mgr dashboard / other services; choose another --port so the native dashboard is untouched"
  fi
  ok "port $PORT does not overlap native dashboard ports (8443/8080/3000/7000/9283)"
  if command -v ceph >/dev/null 2>&1; then
    NATIVE_URL="$(ceph mgr services 2>/dev/null | tr -d '\n' | sed -n 's/.*"dashboard"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || NATIVE_URL=""
    if [ -n "$NATIVE_URL" ]; then
      ok "native dashboard detected at $NATIVE_URL -- left unchanged"
    else
      ok "no native dashboard URL reported -- no mgr configuration will be modified"
    fi
  fi
  ok "isolation: separate service, separate client keyring, ceph.conf / mgr modules untouched"
fi

if [ -z "$PY" ]; then
  install_deps_if_requested
  PY="$(find_python || true)"
  [ -n "$PY" ] || die "Python >= 3.6 not found. Install python3, or re-run with --install-deps"
fi
PY_VER="$($PY -c 'import sys; print(".".join(map(str,sys.version_info[:3])))')"
ok "python interpreter: $PY ($PY_VER)"

if [ "$BACKEND" = "cli" ]; then
  if command -v ceph >/dev/null 2>&1; then
    CEPH_VER="$(ceph --version 2>&1 | head -n 1)"
    ok "ceph CLI: $CEPH_VER"
    if timeout 8 ceph -s --connect-timeout=5 >/dev/null 2>&1; then
      ok "cluster reachable (ceph -s succeeded)"
    else
      warn "ceph -s failed: check /etc/ceph/ceph.conf and the keyring; deployment will continue"
    fi
  else
    warn "ceph CLI not found; install ceph-common or use --backend rest"
    install_deps_if_requested
  fi
else
  [ -n "$REST_URL" ] || warn "--backend rest needs --rest-url (e.g. https://MON:8443)"
fi

if [ -z "$TOKEN" ]; then
  if command -v openssl >/dev/null 2>&1; then TOKEN="$(openssl rand -hex 20)"
  elif [ -r /dev/urandom ]; then TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  else TOKEN="cc$(date +%s)$$"; fi
fi

say ""
if [ "$DO_INSTALL" -eq 0 ]; then
  say "${C_WARN}PREVIEW ONLY - nothing was changed.${C_0}"
  say "To install, re-run with --install:"
  if [ "$MODE" = "frontend" ]; then
    say "  sudo bash $0 --local --mode frontend --dir $DIR --backend-url ${BACKEND_URL:-http://$HOST:$PORT} --install"
  else
    say "  sudo bash $0 --local --host $HOST --port $PORT --dir $DIR --mode $MODE --keyring $KEYRING_MODE --token $TOKEN --install"
  fi
  exit 0
fi

# ---------------- install ----------------
[ "$(id -u)" -eq 0 ] || die "root required for --install (use sudo)"
say "${C_B}Installing...${C_0}"

# ---- split deployment: static UI only, on a separate web server ----
if [ "$MODE" = "frontend" ]; then
  mkdir -p "$DIR"
  for f in $FRONTEND_FILES; do install -m 0644 "$SCRIPT_DIR/$f" "$DIR/$f"; done
  cp "$DIR/ceph-dashboard.html" "$DIR/index.html"
  ok "static UI files deployed to $DIR"
  API_URL="${BACKEND_URL:-http://${HOST}:${PORT}}"
  ENC_API="$(printf '%s' "$API_URL" | sed -e 's/:/%3A/g' -e 's#/#%2F#g')"
  say ""
  say "${C_B}==================== FRONTEND DEPLOYED ====================${C_0}"
  say "  Static root : $DIR  (index.html + app-*.js)"
  say "  Web server  : nginx -> root $DIR; index index.html;"
  say "                or: cd $DIR && python3 -m http.server 8080"
  say "  Backend API : $API_URL"
  say "  Open UI     : ${C_OK}http://<this-web-server>/?api=${ENC_API}${C_0}"
  say "  Login       : use the account printed by the backend deploy.sh"
  say ""
  say "  No service, no ceph keyring, no firewall rule, no ceph.conf / mgr change on this host."
  say "  The native Ceph dashboard is completely unaffected."
  exit 0
fi

mkdir -p "$DIR" "$CONF_DIR" "$LOG_DIR"
for f in $FILES; do install -m 0644 "$SCRIPT_DIR/$f" "$DIR/$f"; done
chmod 0755 "$DIR/ceph-console.py"
ok "files installed to $DIR"

# ---- login credentials (PBKDF2 hash only, never plaintext on disk) ----
# Re-running --install must NOT wipe a password the operator changed in the UI.
# Only an explicit --password (or a brand new install) rewrites the store.
GENERATED_PASS=0
KEEP_USERS=0
if [ -z "$ADMIN_PASS" ]; then
  if [ -f "$USERS_FILE" ] && grep -q "\"$ADMIN_USER\"" "$USERS_FILE" 2>/dev/null; then
    KEEP_USERS=1
  else
    if command -v openssl >/dev/null 2>&1; then
      ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
    elif [ -r /dev/urandom ]; then
      ADMIN_PASS="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-16)"
    else
      ADMIN_PASS="cc$(date +%s | tail -c 9)"
    fi
    GENERATED_PASS=1
  fi
fi
if [ "$NO_AUTH" -eq 1 ]; then
  warn "--no-auth: login is DISABLED; anyone reaching port $PORT can read cluster data"
elif [ "$KEEP_USERS" -eq 1 ]; then
  chmod 0600 "$USERS_FILE"
  ok "existing user store kept: $ADMIN_USER password unchanged ($USERS_FILE)"
else
  "$PY" - "$DIR/ceph-console.py" "$USERS_FILE" "$ADMIN_USER" "$ADMIN_PASS" <<'PYEOF'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cc", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    with open(sys.argv[2]) as f:
        users = json.load(f).get("users", {}) or {}
except Exception:
    users = {}
users[sys.argv[3]] = dict(mod.hash_password(sys.argv[4]), role="admin")
mod.save_users(sys.argv[2], users)
PYEOF
  chmod 0600 "$USERS_FILE"
  ok "login user store created ($USERS_FILE, mode 0600, PBKDF2-SHA256)"
fi

# ---- ceph client keyring (least privilege) ----
CEPH_NAME_ARG=""; CEPH_KEYRING_ARG=""
if [ "$NO_KEYRING" -eq 0 ] && [ "$BACKEND" = "cli" ] && command -v ceph >/dev/null 2>&1; then
  if [ "$KEYRING_MODE" = "readonly" ]; then
    MON_CAP="allow r"; OSD_CAP="allow r"; MGR_CAP="allow r"
  else
    MON_CAP="allow rwx"; OSD_CAP="allow rwx"; MGR_CAP="allow rwx"
  fi
  if ceph auth get-or-create "$CEPH_NAME" mon "$MON_CAP" osd "$OSD_CAP" mgr "$MGR_CAP" \
        -o "$CEPH_KEYRING" >/dev/null 2>&1; then
    ok "created keyring $CEPH_KEYRING ($KEYRING_MODE)"
  elif ceph auth get-or-create "$CEPH_NAME" mon "$MON_CAP" osd "$OSD_CAP" \
        -o "$CEPH_KEYRING" >/dev/null 2>&1; then
    warn "created keyring without mgr cap (older Ceph release)"
  else
    warn "could not create dedicated keyring; falling back to the default admin keyring"
    NO_KEYRING=1
  fi
  if [ "$NO_KEYRING" -eq 0 ]; then
    chmod 0600 "$CEPH_KEYRING"
    CEPH_NAME_ARG="--ceph-name $CEPH_NAME"
    CEPH_KEYRING_ARG="--ceph-keyring $CEPH_KEYRING"
  fi
else
  NO_KEYRING=1
fi
READ_ONLY_FLAG=0
[ "$KEYRING_MODE" = "readonly" ] && READ_ONLY_FLAG=1

# ---- config / env (token never appears in the unit file or process list) ----
cat > "$CONF_DIR/config.json" <<EOF
{
  "nearfull": 85,
  "full": 95,
  "downMin": 10,
  "pgDegraded": 1,
  "slowOps": 1000,
  "backend": "$BACKEND",
  "keyring_mode": "$KEYRING_MODE"
}
EOF
chmod 0644 "$CONF_DIR/config.json"

cat > "$CONF_DIR/env" <<EOF
CEPH_CONSOLE_TOKEN=$TOKEN
CEPH_CONSOLE_ALLOW_WRITE=$ALLOW_WRITE
CEPH_CONSOLE_READ_ONLY=$READ_ONLY_FLAG
EOF
chmod 0600 "$CONF_DIR/env"
ok "config and token env written ($CONF_DIR/env, mode 0600)"

EXTRA_ARGS="--backend $BACKEND --port $PORT --dir $DIR --users-file $USERS_FILE --cors-origin $CORS_ORIGIN $CEPH_NAME_ARG $CEPH_KEYRING_ARG"
if [ "$NO_AUTH" -eq 1 ]; then EXTRA_ARGS="$EXTRA_ARGS --no-auth"; fi
[ -n "$CEPH_CONF" ] && EXTRA_ARGS="$EXTRA_ARGS --ceph-conf $CEPH_CONF"
if [ "$BACKEND" = "rest" ]; then
  [ -n "$REST_URL" ] && EXTRA_ARGS="$EXTRA_ARGS --rest-url $REST_URL"
  [ -n "$REST_TOKEN" ] && EXTRA_ARGS="$EXTRA_ARGS --rest-token $REST_TOKEN"
fi
[ "$ALLOW_WRITE" -eq 1 ] && warn "REAL WRITE MODE ENABLED - OSD operations will be executed"

# ---- service unit ----
if [ "$NO_SERVICE" -eq 0 ]; then
  if [ "$INIT" = "systemd" ]; then
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Ceph Ops Console (multiversion monitoring and disk operations)
Documentation=file://$DIR/ceph-console.py
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-$CONF_DIR/env
WorkingDirectory=$DIR
ExecStart=$PY $DIR/ceph-console.py $EXTRA_ARGS
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    systemctl restart "$SERVICE_NAME"
    sleep 2
    systemctl is-active --quiet "$SERVICE_NAME" || die "service failed: journalctl -u $SERVICE_NAME -n 50"
    ok "systemd service $SERVICE_NAME active"
  elif [ "$INIT" = "sysvinit" ]; then
    cat > "/etc/init.d/$SERVICE_NAME" <<EOF
#!/bin/sh
### BEGIN INIT INFO
# Provides:          ceph-console
# Required-Start:    \$network \$remote_fs
# Required-Stop:     \$network
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Ceph Ops Console
### END INIT INFO
. $CONF_DIR/env
export CEPH_CONSOLE_TOKEN CEPH_CONSOLE_ALLOW_WRITE CEPH_CONSOLE_READ_ONLY
PID=/var/run/${SERVICE_NAME}.pid
CMD="$PY $DIR/ceph-console.py $EXTRA_ARGS"
case "\$1" in
  start) echo "Starting ceph-console"; nohup \$CMD >>$LOG_DIR/console.log 2>&1 & echo \$! > \$PID ;;
  stop)  echo "Stopping ceph-console"; [ -f \$PID ] && kill \$(cat \$PID) 2>/dev/null; rm -f \$PID ;;
  restart) "\$0" stop; sleep 1; "\$0" start ;;
  status) [ -f \$PID ] && kill -0 \$(cat \$PID) 2>/dev/null && echo running || echo stopped ;;
  *) echo "Usage: \$0 {start|stop|restart|status}"; exit 1 ;;
esac
exit 0
EOF
    chmod 0755 "/etc/init.d/$SERVICE_NAME"
    "/etc/init.d/$SERVICE_NAME" restart
    ok "SysV init script installed and started"
  else
    warn "unknown init system; start manually:  set -a; . $CONF_DIR/env; set +a; $PY $DIR/ceph-console.py $EXTRA_ARGS"
  fi
fi

# ---- firewall ----
if [ "$NO_FIREWALL" -eq 0 ]; then
  case "$FIREWALL" in
    firewalld)
      firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 \
        && ok "firewalld: opened ${PORT}/tcp" || warn "firewalld rule failed; open ${PORT}/tcp manually" ;;
    ufw)
      ufw allow "${PORT}/tcp" >/dev/null 2>&1 && ok "ufw: allowed ${PORT}/tcp" || warn "ufw rule failed" ;;
    iptables)
      iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT >/dev/null 2>&1 || iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT >/dev/null 2>&1 || true
      warn "iptables rule added at runtime; persist it with iptables-save / your distro tool" ;;
    *) ok "no active firewall detected" ;;
  esac
fi

if [ "$SELINUX" = "Enforcing" ]; then
  warn "SELinux is Enforcing. If the port is blocked, run: semanage port -a -t http_port_t -p tcp $PORT"
fi

# ---- health check ----
say ""
PROBE_URL="http://127.0.0.1:${PORT}/api/probe"
HEALTHY=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  PROBE_OK=0
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 -H "X-Console-Token: $TOKEN" "$PROBE_URL" >/dev/null 2>&1; then PROBE_OK=1; fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -q -O /dev/null --timeout=3 --header="X-Console-Token: $TOKEN" "$PROBE_URL" >/dev/null 2>&1; then PROBE_OK=1; fi
  else
    if "$PY" -c "import sys,urllib.request; r=urllib.request.Request(sys.argv[1],headers={'X-Console-Token':sys.argv[2]}); urllib.request.urlopen(r,timeout=3).read()" \
         "$PROBE_URL" "$TOKEN" >/dev/null 2>&1; then PROBE_OK=1; fi
  fi
  if [ "$PROBE_OK" -eq 1 ]; then HEALTHY=1; break; fi
  sleep 1
done
if [ "$HEALTHY" -eq 1 ]; then
  ok "health check passed (/api/probe)"
else
  if [ "$INIT" = "systemd" ]; then
    warn "health check did not pass; run: journalctl -u $SERVICE_NAME -n 50"
  else
    warn "health check did not pass; inspect $LOG_DIR/console.log"
  fi
fi

# ---- summary ----
say ""
say "${C_B}==================== DEPLOYED ====================${C_0}"
say "  Console URL : ${C_OK}http://${HOST}:${PORT}/${C_0}"
if [ "$NO_AUTH" -eq 0 ]; then
  if [ "$KEEP_USERS" -eq 1 ]; then
    say "  Login       : ${C_B}${ADMIN_USER}${C_0} / (unchanged - existing password kept)"
    say "                change it in Settings, or pass --password to reset"
  else
    say "  Login       : ${C_B}${ADMIN_USER}${C_0} / ${C_B}${ADMIN_PASS}${C_0}"
    if [ "$GENERATED_PASS" -eq 1 ]; then
      say "                (auto-generated, shown only once - save it now)"
    fi
  fi
else
  say "  Login       : DISABLED (--no-auth) - not recommended"
fi
say "  API URL     : http://${HOST}:${PORT}  (use with ?api= when the UI is on another server)"
if [ "$NO_AUTH" -eq 0 ]; then
  say "  Password    : Settings page, or: sudo python3 $DIR/ceph-console.py --set-password $ADMIN_USER --users-file $USERS_FILE"
fi
say "  API probe   : curl -H \"X-Console-Token: ${TOKEN}\" http://${HOST}:${PORT}/api/probe"
say "  Mode        : $([ "$ALLOW_WRITE" -eq 1 ] && echo 'REAL EXECUTION' || echo 'DRY-RUN (no cluster changes)')"
say "  Deploy mode : $MODE"
say "  Files       : $DIR"
say "  Config      : $CONF_DIR/config.json"
say "  User store  : $USERS_FILE (0600, PBKDF2 hashes only)"
say "  Token file  : $CONF_DIR/env (0600)"
say "  Isolation   : native mgr dashboard untouched; dedicated client keyring; only ${PORT}/tcp opened"
if [ "$INIT" = "systemd" ]; then
  say "  Log         : journalctl -u $SERVICE_NAME -f"
else
  say "  Log         : $LOG_DIR/console.log"
fi
say "  Audit       : $LOG_DIR/audit.jsonl"
if [ "$INIT" = "systemd" ]; then
  say "  Service     : systemctl status $SERVICE_NAME"
else
  say "  Service     : /etc/init.d/$SERVICE_NAME status"
fi
say "  Uninstall   : sudo bash $0 --uninstall [--purge]"
say ""
say "  Split deployment (optional) - put the UI on another web server:"
say "    sudo bash deploy.sh --local --mode frontend --backend-url http://${HOST}:${PORT} \\"
say "      --dir /var/www/ceph-console --install"
say "    then open  http://<web-server>/?api=http%3A%2F%2F${HOST}%3A${PORT}  and sign in"
say ""
if [ "$ALLOW_WRITE" -eq 0 ]; then
  say "${C_WARN}IMPORTANT${C_0}: 默认 DRY-RUN，踢盘/换盘只生成命令与审计，不下发到集群。"
  say "  观察确认命令序列无误后，再执行："
  say "  sudo bash $0 --local --host $HOST --port $PORT --keyring full --allow-write --install"
fi
say ""
