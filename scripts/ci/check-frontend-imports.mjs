import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

const root = resolve('frontend/src')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const importPattern = /(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g
const missing = []

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return sourceExtensions.has(extname(path)) ? [path] : []
  })
}

function resolvesImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier)
  const candidates = [
    base,
    ...[...sourceExtensions].map((extension) => `${base}${extension}`),
    ...[...sourceExtensions].map((extension) => join(base, `index${extension}`)),
  ]
  return candidates.some((candidate) => existsSync(candidate) && !statSync(candidate).isDirectory())
}

for (const file of sourceFiles(root)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(importPattern)) {
    if (!resolvesImport(file, match[1])) {
      missing.push(`${file.replace(`${process.cwd()}/`, '')}: ${match[1]}`)
    }
  }
}

if (missing.length) {
  console.error('Unresolved relative frontend imports:')
  missing.forEach((entry) => console.error(`- ${entry}`))
  process.exit(1)
}

console.log('Frontend relative imports resolve successfully.')

