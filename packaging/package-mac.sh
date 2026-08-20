#!/usr/bin/env bash
# 打包 DDDown.app 与 dmg。用法：package-mac.sh <二进制路径> <版本号> <输出dmg路径>
# 需在 macOS 上运行（依赖 sips/iconutil/hdiutil/codesign）
set -euo pipefail

BIN=$1
VERSION=$2
DMG_OUT=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)

STAGE=DDDown.app
rm -rf "$STAGE"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
cp "$BIN" "$STAGE/Contents/MacOS/dddown"

# icon-512.png → icns
ICONSET=$(mktemp -d)/dddown.iconset
mkdir -p "$ICONSET"
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  set -- $spec
  sips -z "$1" "$1" "$ROOT/web/public/icons/icon-512.png" --out "$ICONSET/$2.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$STAGE/Contents/Resources/dddown.icns"

sed -e "s/@VERSION@/$VERSION/g" "$ROOT/packaging/Info.plist" > "$STAGE/Contents/Info.plist"

codesign --force --sign - "$STAGE"

rm -f "$DMG_OUT"
hdiutil create -volname "DDDown $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG_OUT" >/dev/null
rm -rf "$STAGE"
echo "dmg: $DMG_OUT"
