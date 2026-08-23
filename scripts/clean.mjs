import { rm } from 'node:fs/promises'
for (const path of process.argv.slice(2)) await rm(path, { recursive: true, force: true })
