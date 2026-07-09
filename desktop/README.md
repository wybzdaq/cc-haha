# Claude Code Haha Desktop

基于 Tauri 2 + React 的桌面客户端。

## 开发

```bash
bun install
bun run tauri dev
```

## 构建

```bash
# macOS (Apple Silicon)
./scripts/build-macos-arm64.sh

# Windows x64 installer
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -Arch x64 -Kind installer

# Windows x64 no-install directory
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -Arch x64 -Kind portable-dir
```

构建产物位于 `build-artifacts/` 目录，文件名会显式包含平台、架构和包类型。

## 常见问题

### macOS 提示"已损坏，无法打开"

```bash
xattr -cr /Applications/Claude\ Code\ Haha.app
```
