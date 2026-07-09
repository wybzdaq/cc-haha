import { existsSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodeModulesRoot = join(projectRoot, "node_modules")
const nativeCacheDirs = [
  join(projectRoot, "android", "app", ".cxx"),
]

function addNodeModuleNativeCaches(scopeDir) {
  if (!existsSync(scopeDir)) {
    return
  }

  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const moduleDir = join(scopeDir, entry.name)
    if (entry.name.startsWith("@")) {
      addNodeModuleNativeCaches(moduleDir)
      continue
    }

    nativeCacheDirs.push(join(moduleDir, "android", ".cxx"))
  }
}

function assertInsideProject(path) {
  const resolvedPath = resolve(path)
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(`${projectRoot}\\`)) {
    throw new Error(`Refusing to remove cache outside project: ${resolvedPath}`)
  }
}

addNodeModuleNativeCaches(nodeModulesRoot)

let removedCount = 0
for (const cacheDir of nativeCacheDirs) {
  if (!existsSync(cacheDir)) {
    continue
  }

  assertInsideProject(cacheDir)
  rmSync(cacheDir, { recursive: true, force: true })
  removedCount += 1
  console.log(`removed ${cacheDir}`)
}

console.log(`removed ${removedCount} native cache director${removedCount === 1 ? "y" : "ies"}`)
