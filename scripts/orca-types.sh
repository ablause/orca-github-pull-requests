#!/usr/bin/env bash
# Writes .orca/types into a plugin folder from the Orca source tag matching the installed Orca.
# Stands in for `orca plugin types`, which fails on builds that ship without orca.d.ts.
set -euo pipefail

plugin_dir="${1:?usage: scripts/orca-types.sh .}"
version="${ORCA_VERSION:-$(orca --version)}"
base="https://raw.githubusercontent.com/stablyai/orca/v${version}/resources/plugins"
types="${plugin_dir}/.orca/types"
note="// Written by scripts/orca-types.sh from stablyai/orca v${version}. Do not edit."

mkdir -p "${types}/orca"
{
  echo "${note}"
  for file in orca.d.ts orca-components.d.ts orca-components-layout.d.ts orca-components-data.d.ts; do
    curl -fsSL "${base}/declarative/${file}"
    echo
  done
} > "${types}/orca/index.d.ts"

for surface in orca-host orca-frame orca-worker orca-services orca-testing; do
  mkdir -p "${types}/${surface}"
  { echo "${note}"; curl -fsSL "${base}/types/${surface}.d.ts"; } > "${types}/${surface}/index.d.ts"
done

printf '*\n' > "${plugin_dir}/.orca/.gitignore"
cat > "${types}/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "jsxImportSource": "orca",
    "lib": ["ES2022", "DOM"],
    "preserveSymlinks": true,
    "typeRoots": ["."],
    "types": ["orca", "orca-host", "orca-frame", "orca-worker", "orca-services", "orca-testing"]
  }
}
JSON
echo "Wrote Orca v${version} typings into ${types}"
