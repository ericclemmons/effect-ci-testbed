import { pathGlob, pathPatterns } from "@effect-ci-testbed/ci/paths"

export interface OutputFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly executable: boolean
}
export interface OutputManifest {
  readonly version: 1
  readonly patterns: ReadonlyArray<string>
  readonly files: ReadonlyArray<OutputFile>
}

// This fixed program only reads files. Python is an explicit container contract,
// not a project command or a dependency silently installed during a comparison.
const inspect = String.raw`
import os,sys,json,stat,re,hashlib
spec=json.loads(sys.argv[1]); root=os.getcwd()
if os.path.realpath(root)!=root: raise ValueError('Output root contains a symlink')
files={}; visited=set(); total=0
def walk(path):
 global total
 if path in visited: return
 visited.add(path)
 if len(visited)>10000: raise ValueError('Output traversal limit exceeded')
 try: s=os.lstat(path or '.')
 except FileNotFoundError: return
 if stat.S_ISLNK(s.st_mode): raise ValueError('Output symlinks are unsupported')
 if stat.S_ISDIR(s.st_mode):
  for name in sorted(os.listdir(path or '.')): walk(path+'/'+name if path else name)
 elif any(re.fullmatch(pattern,path) for pattern in spec['matches']):
  if not stat.S_ISREG(s.st_mode) or len(files)>=1000 or s.st_size>16777216: raise ValueError('Invalid output file')
  h=hashlib.sha256(); size=0
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
   before=os.fstat(f.fileno())
   while True:
    chunk=f.read(65536)
    if not chunk: break
    h.update(chunk); size+=len(chunk); total+=len(chunk)
    if total>16777216: raise ValueError('Output byte limit exceeded')
   after=os.fstat(f.fileno())
  if (s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)!=(after.st_ino,size,after.st_mtime_ns,after.st_ctime_ns,after.st_mode) or before.st_mtime_ns!=after.st_mtime_ns: raise ValueError('Output changed while reading')
  files[path]={'path':path,'size':size,'sha256':h.hexdigest(),'executable':bool(s.st_mode&0o111)}
for prefix in spec['prefixes']: walk(prefix)
print(json.dumps({'version':1,'patterns':spec['patterns'],'files':list(files.values())},ensure_ascii=True,separators=(',',':')))
`

export function outputManifestCommand(input: ReadonlyArray<string>): string[] {
  const patterns = pathPatterns(input)
  const prefixes = patterns.map(pattern => {
    const parts = pattern.split("/"), first = parts.findIndex(part => /[*?]/.test(part))
    return (first < 0 ? parts : parts.slice(0, first)).join("/")
  })
  return ["/usr/bin/python3", "-I", "-c", inspect, JSON.stringify({ patterns, prefixes, matches: patterns.map(pattern => pathGlob(pattern).source) })]
}

export function parseOutputManifest(text: string, input: ReadonlyArray<string>): OutputManifest {
  if (text.length > 1_048_576) throw Error("Output manifest limit exceeded")
  const patterns = pathPatterns(input), matchers = patterns.map(pathGlob)
  const value = JSON.parse(text)
  if (!value || Object.keys(value).sort().join() !== "files,patterns,version" || value.version !== 1 ||
    JSON.stringify(value.patterns) !== JSON.stringify(patterns) || !Array.isArray(value.files) || value.files.length > 1000)
    throw Error("Invalid output manifest")
  const files: OutputFile[] = [], seen = new Set<string>()
  let size = 0
  for (const file of value.files) {
    if (!file || Object.keys(file).sort().join() !== "executable,path,sha256,size" || typeof file.path !== "string" ||
      file.path.length > 4096 || file.path.split("/").some((part: string) => !part || part === "." || part === "..") ||
      /[\\\x00-\x1f]/.test(file.path) || !matchers.some(matcher => matcher.test(file.path)) || seen.has(file.path) ||
      !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== "boolean")
      throw Error("Invalid output manifest file")
    size += file.size
    if (size > 16 * 1024 * 1024) throw Error("Output byte limit exceeded")
    seen.add(file.path)
    files.push({ path: file.path, size: file.size, sha256: file.sha256, executable: file.executable })
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { version: 1, patterns, files }
}

export async function outputManifestDigest(manifest: OutputManifest): Promise<string> {
  const checked = parseOutputManifest(JSON.stringify(manifest), manifest.patterns)
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(checked)))), b => b.toString(16).padStart(2, "0")).join("")
}
