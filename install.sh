#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly AGENT_DRIVER_NODE_VERSION="22.22.0"
readonly AGENT_DRIVER_NPM_VERSION="11.11.0"
readonly DEFAULT_REPOSITORY="https://github.com/deepdivekr/agent-office.git"

# Korean when the system language is Korean, English otherwise (a fresh Ubuntu is C.UTF-8).
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in ko*) KO=1 ;; *) KO=0 ;; esac
m() { if [[ "$KO" == 1 ]]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say() { printf '[agent-office] %s\n' "$(m "$1" "$2")"; }
fail() { printf '[agent-office] %s%s\n' "$(m '설치 중단: ' 'Install stopped: ')" "$(m "$1" "$2")" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 명령이 필요합니다." "The $1 command is needed."; }

[[ "$(uname -s)" == "Linux" ]] || fail "현재 자동 설치는 Ubuntu/Linux와 WSL만 지원합니다." "The installer supports Ubuntu/Linux and WSL only."
[[ -n "${HOME:-}" && "$HOME" == /* && "$HOME" != "/" ]] || fail "안전한 HOME 경로를 확인할 수 없습니다." "HOME is not a safe path."

readonly REPOSITORY_URL="${AGENT_OFFICE_REPOSITORY_URL:-${AGENT_DRIVER_REPOSITORY_URL:-$DEFAULT_REPOSITORY}}"
readonly REPOSITORY_REF="${AGENT_OFFICE_VERSION:-${AGENT_DRIVER_VERSION:-v0.8.0}}"
readonly INSTALL_DIR="${AGENT_OFFICE_INSTALL_DIR:-${AGENT_DRIVER_INSTALL_DIR:-$HOME/.local/share/agent-office}}"
readonly BIN_DIR="${AGENT_OFFICE_BIN_DIR:-${AGENT_DRIVER_BIN_DIR:-$HOME/.local/bin}}"
readonly RUNTIME_DIR="${AGENT_OFFICE_RUNTIME_DIR:-${AGENT_DRIVER_RUNTIME_DIR:-$HOME/.local/share/agent-office-runtime}}"

if [[ "$REPOSITORY_URL" != "$DEFAULT_REPOSITORY" ]]; then
  [[ "${AGENT_DRIVER_ALLOW_LOCAL_FIXTURE:-0}" == "1" && "$REPOSITORY_URL" == file:///* ]] || fail "공식 Agent Office 저장소만 자동 설치할 수 있습니다." "Only the official Agent Office repository can be installed."
fi

safe_home_path() {
  local target="$1" parent resolved_home resolved_parent resolved_target
  [[ "$target" == /* && "$target" != "/" && "$target" != *$'\n'* && "$target" != *$'\r'* ]] || fail "설치 경로가 안전하지 않습니다." "The install path is not safe."
  resolved_home="$(readlink -f -- "$HOME")"
  resolved_target="$(readlink -m -- "$target")"
  [[ "$resolved_target" == "$resolved_home/"* ]] || fail "설치 경로는 사용자 HOME 내부여야 합니다: $target" "The install path must be inside HOME: $target"
  [[ ! -L "$target" ]] || fail "심볼릭 링크에는 설치하지 않습니다: $target" "Will not install into a symbolic link: $target"
  mkdir -p -- "$(dirname -- "$target")"
  parent="$(dirname -- "$target")"
  resolved_parent="$(readlink -f -- "$parent")"
  resolved_target="$resolved_parent/$(basename -- "$target")"
  [[ "$resolved_target" == "$resolved_home/"* ]] || fail "설치 경로는 사용자 HOME 내부여야 합니다: $target" "The install path must be inside HOME: $target"
}

for tool in git curl tar sha256sum readlink; do need "$tool"; done
safe_home_path "$INSTALL_DIR"
safe_home_path "$BIN_DIR"
safe_home_path "$RUNTIME_DIR"
mkdir -p -- "$BIN_DIR" "$RUNTIME_DIR"

node_version() { "$1" --version 2>/dev/null | sed 's/^v//'; }
node_bin="${AGENT_DRIVER_NODE_BIN:-}"
if [[ -n "$node_bin" ]]; then
  [[ "$node_bin" == /* && -x "$node_bin" && ! -L "$node_bin" ]] || fail "지정한 Node 실행 파일이 안전하지 않습니다." "The given Node executable is not safe."
elif command -v node >/dev/null 2>&1 && [[ "$(node_version "$(command -v node)")" == "$AGENT_DRIVER_NODE_VERSION" ]]; then
  node_bin="$(readlink -f -- "$(command -v node)")"
else
  case "$(uname -m)" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "지원하지 않는 CPU 아키텍처입니다: $(uname -m)" "Unsupported CPU architecture: $(uname -m)" ;;
  esac
  node_name="node-v${AGENT_DRIVER_NODE_VERSION}-linux-${node_arch}"
  node_root="$RUNTIME_DIR/$node_name"
  safe_home_path "$node_root"
  if [[ ! -x "$node_root/bin/node" ]]; then
    say "Node.js ${AGENT_DRIVER_NODE_VERSION} 준비" "Preparing Node.js ${AGENT_DRIVER_NODE_VERSION}"
    temporary="$(mktemp -d "$RUNTIME_DIR/.node-install.XXXXXX")"
    trap 'rm -rf -- "${temporary:-}"' EXIT
    base_url="https://nodejs.org/dist/v${AGENT_DRIVER_NODE_VERSION}"
    archive_name="${node_name}.tar.xz"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$base_url/SHASUMS256.txt" --output "$temporary/SHASUMS256.txt"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$base_url/$archive_name" --output "$temporary/$archive_name"
    expected="$(awk -v file="$archive_name" '$2==file {print $1}' "$temporary/SHASUMS256.txt")"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "Node.js checksum을 확인할 수 없습니다." "Could not read the Node.js checksum."
    printf '%s  %s\n' "$expected" "$temporary/$archive_name" | sha256sum --check --status - || fail "Node.js checksum이 일치하지 않습니다." "The Node.js checksum does not match."
    tar -xJf "$temporary/$archive_name" -C "$temporary"
    [[ -x "$temporary/$node_name/bin/node" ]] || fail "Node.js 배포물 형식이 올바르지 않습니다." "The Node.js archive is not in the expected form."
    mv -- "$temporary/$node_name" "$node_root"
    rm -rf -- "$temporary"
    trap - EXIT
  fi
  node_bin="$node_root/bin/node"
fi
[[ "$(node_version "$node_bin")" == "$AGENT_DRIVER_NODE_VERSION" ]] || fail "Node.js ${AGENT_DRIVER_NODE_VERSION}이 필요합니다." "Node.js ${AGENT_DRIVER_NODE_VERSION} is needed."

# npm and package lifecycle scripts resolve `node` through /usr/bin/env. Keep
# the selected, verified Node first for each child without changing the user's
# shell PATH or relying on an unrelated system Node installation.
readonly AGENT_DRIVER_TOOL_PATH="$(dirname -- "$node_bin"):${PATH:-}"
with_selected_node() { env PATH="$AGENT_DRIVER_TOOL_PATH" "$@"; }

if [[ -e "$INSTALL_DIR" ]]; then
  [[ -d "$INSTALL_DIR/.git" && -f "$INSTALL_DIR/.git/agent-driver-managed" ]] || fail "기존 비관리 디렉터리를 덮어쓰지 않습니다: $INSTALL_DIR" "Will not overwrite a folder this installer does not manage: $INSTALL_DIR"
  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=normal)" ]] || fail "기존 설치에 수정된 파일이 있어 업데이트하지 않습니다." "The installed copy has changed files, so it is not updated."
  current_repository="$(git -C "$INSTALL_DIR" remote get-url origin)"
  if [[ "$current_repository" == "https://github.com/deepdivekr/agent-driver.git" && "$REPOSITORY_URL" == "$DEFAULT_REPOSITORY" ]]; then
    git -C "$INSTALL_DIR" remote set-url origin "$DEFAULT_REPOSITORY"
  else
    [[ "$current_repository" == "$REPOSITORY_URL" ]] || fail "기존 설치의 원격 저장소가 다릅니다." "The installed copy comes from a different repository."
  fi
  say "Agent Office 소스 업데이트" "Updating Agent Office"
  git -C "$INSTALL_DIR" fetch --quiet --depth 1 origin "$REPOSITORY_REF"
  git -C "$INSTALL_DIR" checkout --quiet --detach FETCH_HEAD
else
  say "Agent Office 내려받기" "Downloading Agent Office"
  git -c advice.detachedHead=false clone --quiet --filter=blob:none --depth 1 --branch "$REPOSITORY_REF" --single-branch "$REPOSITORY_URL" "$INSTALL_DIR" 2> >(grep -v "filtering not recognized by server" >&2)
  [[ -d "$INSTALL_DIR/.git" ]] || fail "저장소를 내려받지 못했습니다." "Could not download the repository."
  printf 'format=1\nrepository=%s\n' "$REPOSITORY_URL" > "$INSTALL_DIR/.git/agent-driver-managed"
fi

base_npm=""
if [[ -x "$(dirname -- "$node_bin")/npm" ]]; then base_npm="$(dirname -- "$node_bin")/npm"; elif command -v npm >/dev/null 2>&1; then base_npm="$(command -v npm)"; else fail "npm bootstrap을 찾지 못했습니다." "Could not find npm to start from."; fi
npm_bin="$base_npm"
if [[ "$(with_selected_node "$base_npm" --version 2>/dev/null || true)" != "$AGENT_DRIVER_NPM_VERSION" ]]; then
  npm_root="$RUNTIME_DIR/npm-${AGENT_DRIVER_NPM_VERSION}"
  safe_home_path "$npm_root"
  if [[ ! -x "$npm_root/node_modules/.bin/npm" ]]; then
    say "npm ${AGENT_DRIVER_NPM_VERSION} 준비" "Preparing npm ${AGENT_DRIVER_NPM_VERSION}"
    with_selected_node "$base_npm" install --silent --no-audit --no-fund --prefix "$npm_root" --no-save "npm@${AGENT_DRIVER_NPM_VERSION}"
  fi
  npm_bin="$npm_root/node_modules/.bin/npm"
fi
[[ "$(with_selected_node "$npm_bin" --version)" == "$AGENT_DRIVER_NPM_VERSION" ]] || fail "npm ${AGENT_DRIVER_NPM_VERSION}을 준비하지 못했습니다." "Could not prepare npm ${AGENT_DRIVER_NPM_VERSION}."

say "의존성 설치" "Installing dependencies"
(cd "$INSTALL_DIR" && with_selected_node "$npm_bin" ci --no-audit --no-fund)
say "Agent Office 빌드" "Building Agent Office"
(cd "$INSTALL_DIR" && with_selected_node "$npm_bin" run build)
if [[ "${AGENT_DRIVER_SKIP_BROWSER_INSTALL:-0}" != "1" ]]; then
  say "전용 Chromium 준비" "Preparing the dedicated Chromium"
  (cd "$INSTALL_DIR" && with_selected_node "$npm_bin" exec -- playwright install chromium)
  say "전용 Chromium 실행 확인" "Checking the dedicated Chromium"
  browser_starts() {
    (cd "$INSTALL_DIR" && AGENT_OFFICE_KO="$KO" with_selected_node "$node_bin" --input-type=module -e '
    import {chromium} from "playwright";
    const ko=process.env.AGENT_OFFICE_KO==="1";
    const browser=await chromium.launch({headless:true,timeout:60000}).catch(error=>{
      console.error(error.name==="TimeoutError"
        ? (ko?"[agent-office] Chromium 준비 시간이 60초를 초과했습니다. PC 부하를 확인하고 다시 시도하세요.":"[agent-office] Chromium took over 60 seconds to start. Check the load on this PC and try again.")
        : (ko?"[agent-office] Chromium 시작에 실패했습니다. 시스템 라이브러리와 설치 환경을 확인하세요.":"[agent-office] Chromium did not start. Check the system libraries and this environment."));
      process.exit(1);
    });
    try {
      const page=await browser.newPage();
      await page.goto("data:text/html,<title>agent-driver-browser-check</title>",{timeout:15000});
      if(await page.title()!=="agent-driver-browser-check")throw Error("BROWSER_SMOKE_TITLE_MISMATCH");
    } finally {await browser.close();}
  ') >/dev/null
  }
  if ! browser_starts; then
    deps_cli="$INSTALL_DIR/node_modules/playwright/cli.js"
    printf -v browser_deps_command 'sudo %q %q install-deps chromium' "$node_bin" "$deps_cli"
    manual_deps() { fail "Chromium 실행 확인에 실패했습니다. 시간 초과이면 PC 부하를 줄인 후 다시 시도하세요. 시스템 라이브러리 문제인 경우 '${browser_deps_command}'를 실행한 뒤 설치를 다시 시도하세요." "Chromium did not start. If it timed out, reduce the load on this PC and try again. If system libraries are missing, run '${browser_deps_command}' and run the installer again."; }
    # A fresh Ubuntu lacks Chromium's system libraries (clean-install check, 2026-10-12). At a terminal the installer
    # asks once and installs them with sudo; without a terminal (scripts, CI) nothing privileged runs.
    sudo_bin="sudo"
    [[ "${AGENT_DRIVER_ALLOW_LOCAL_FIXTURE:-0}" == "1" && -n "${AGENT_DRIVER_SUDO_BIN:-}" ]] && sudo_bin="$AGENT_DRIVER_SUDO_BIN"
    if [[ -t 1 ]] && (: </dev/tty) 2>/dev/null && { [[ "$(id -u)" == 0 ]] || command -v "$sudo_bin" >/dev/null 2>&1; }; then
      say "Chromium 실행에 필요한 시스템 라이브러리(글꼴·그래픽 등 Ubuntu 공식 패키지)가 없습니다." "Chromium needs system libraries (fonts, graphics and similar official Ubuntu packages) that are missing."
      say "설치하면 이 명령 하나만 sudo로 실행해 apt로 설치합니다: playwright install-deps chromium" "Installing runs this one command with sudo, which installs them with apt: playwright install-deps chromium"
      say "비밀번호는 sudo가 터미널에서 직접 받습니다. Agent Office는 보지도 저장하지도 않습니다." "sudo reads the password in this terminal; Agent Office never sees or keeps it."
      say "비밀번호는 Windows 비밀번호가 아니라, WSL Ubuntu를 처음 켰을 때 만든 비밀번호예요. 잊었다면 PowerShell에서 'wsl -u root passwd $(id -un)'로 바꿀 수 있어요." "The password is not your Windows one: it is the one you made when WSL Ubuntu first started. If you forgot it, change it from PowerShell with 'wsl -u root passwd $(id -un)'."
      printf '[agent-office] %s ' "$(m '지금 설치할까요? [Y/n]' 'Install them now? [Y/n]')"
      answer=""; read -r answer </dev/tty || answer="n"
      [[ -z "$answer" || "$answer" == [Yy]* ]] || manual_deps
      say "Chromium 시스템 라이브러리 설치" "Installing Chromium's system libraries"
      if [[ "$(id -u)" == 0 ]]; then deps_runner=(); else deps_runner=("$sudo_bin" --); fi
      "${deps_runner[@]}" env PATH="$AGENT_DRIVER_TOOL_PATH" "$node_bin" "$deps_cli" install-deps chromium </dev/tty || manual_deps
      say "전용 Chromium 실행 다시 확인" "Checking the dedicated Chromium again"
      browser_starts || manual_deps
    else
      manual_deps
    fi
  fi
fi

launcher="$BIN_DIR/agent-office"
temporary_launcher="$BIN_DIR/.agent-office.$$.tmp"
[[ ! -L "$launcher" ]] || fail "기존 agent-office 심볼릭 링크를 덮어쓰지 않습니다." "Will not overwrite an agent-office symbolic link."
printf -v expected_launcher '#!/usr/bin/env bash\nexec %q %q "$@"' "$node_bin" "$INSTALL_DIR/dist/cli.js"
if [[ -e "$launcher" ]]; then
  [[ -f "$launcher" && "$(cat -- "$launcher")" == "$expected_launcher" ]] || fail "다른 agent-office 실행 파일을 덮어쓰지 않습니다." "Will not overwrite another agent-office command."
fi
printf '#!/usr/bin/env bash\nexec %q %q "$@"\n' "$node_bin" "$INSTALL_DIR/dist/cli.js" > "$temporary_launcher"
chmod 0700 "$temporary_launcher"
mv -- "$temporary_launcher" "$launcher"

# Keep the old command as an alias only when it is not already owned by an installation.
if [[ ! -e "$BIN_DIR/agent-driver" && ! -L "$BIN_DIR/agent-driver" ]]; then
  printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$launcher" > "$BIN_DIR/.agent-driver.$$.tmp"
  chmod 0700 "$BIN_DIR/.agent-driver.$$.tmp"
  mv -- "$BIN_DIR/.agent-driver.$$.tmp" "$BIN_DIR/agent-driver"
fi

say "설치 완료: $launcher" "Installed: $launcher"
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  say "새 터미널에서 명령이 보이지 않으면 PATH에 $BIN_DIR 를 추가하세요." "If a new terminal does not find the command, add $BIN_DIR to PATH."
fi
if [[ "${AGENT_DRIVER_SKIP_CONNECT:-0}" != "1" ]]; then
  say "관제센터 시작" "Starting the Control Center"
  "$launcher" connect
fi
