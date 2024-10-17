import { existsSync, readdirSync, readFileSync, Stats, statSync, watch, WatchListener } from "fs"
import { resolve, parse, join, ParsedPath } from "path"
import { PP } from "../../ppstuff"
import { MessagePort } from "worker_threads"

export type FSPeep = FSPbv & (Dimp | Fimp)

type FSPbv = {
    abspath: string,
    relpath: string,
    parent?: (FSPbv & Dimp),
    path: ParsedPath,
    stat: Stats,
}

type FApC<T> = (_: FSPeep, ..._rest: unknown[]) => T
type PReC = (cur: any, next: (FSPeep)) => any

type Wimp = {
    peepReduce: (f: PReC, initial: any) => any,
    repr: (depth?: number) => Generator<string, void, void>,
    getRelative: (relpath: string) => { reason: string } | { data: FSPeep },
}

type Dimp = Wimp & {
    imp: 'd',
    contents: string[],
    getDescendants: () => FSPeep[],
    fileApply: <T>(f: FApC<T>, ...rest: unknown[]) => T[],
    getWatcher: <T>(_: MessagePort) => WatchListener<T> | null,
    getWatchSet: (_: MessagePort) => Set<unknown>
}

type Fimp = Wimp & {
    imp: 'f',
    contents: string,
    fileApply: <T>(f: FApC<T>, ...rest: unknown[]) => T,
}

type FSPeepOpts = {
    entrypoint: string,
    from?: FSPbv & Dimp,
}

export function FSPeepRoot(o: FSPeepOpts): FSPeep & Dimp {
    const peepent = FSPeep(o)
    if (!(peepent.imp === 'd')) { throw new TypeError('FSPeepRoot entrypoint must be a directory.') }

    return peepent
}

export function FSPeep(o: FSPeepOpts): FSPeep {
    const { entrypoint, from } = o
    let relpath = join((from?.relpath || ''), entrypoint)
    if (!existsSync(relpath)) { throw new ReferenceError(`'${relpath}' not found in ${process.cwd()}.`) }

    for (let p = from; p?.parent; p = p.parent) {
        if (p.parent.relpath == relpath) { throw new RangeError('Circular parent chain.') }
    }

    const ownStat = statSync(relpath)
    if (!(ownStat.isDirectory() || ownStat.isFile())) { throw new ReferenceError(`${relpath} is an unsupported filesystem object.`) }

    const basis = {
        abspath: resolve(relpath),
        relpath: relpath,
        parent: from,
        path: parse(relpath),
        stat: ownStat
    }

    const impl = ownStat.isDirectory() ? Dimp(basis) : Fimp(basis)

    return impl
}

function Dimp(basis: FSPbv, changeTransmitter?: MessagePort): FSPbv & Dimp {
    if (!basis.stat.isDirectory()) { throw new TypeError(`${basis.relpath} is not a directory.`) }
    if (basis.parent && !basis.parent.stat.isDirectory()) { throw new TypeError(`${basis.relpath} cannot be owned by file ${basis.parent.relpath}.`) }

    const contents = readdirSync(basis.relpath);

    const dimp: FSPbv & Dimp = {
        imp: 'd',
        abspath: basis.abspath,
        relpath: basis.relpath,
        parent: basis.parent,
        path: basis.path,
        stat: basis.stat,
        repr: reprd,
        contents: contents,
        peepReduce: peepReduced,
        fileApply: fileApplyd,
        getRelative: getRelatived,
        getDescendants: getDescendantsd,
        getWatcher: getWatcherd,
        getWatchSet: getWatchSetd
    }

    function getDescendantsd() {
        let x = dimp.contents.map(subEntry => FSPeep({ entrypoint: subEntry, from: dimp }))
        return x
    }

    function* reprd(depth = 0) {
        const y = PP.styles.yellow
        const ø = PP.styles.none
        if (depth === 0) {
            let position = dimp?.parent ? `(in ${dimp.parent.relpath})` : '(root)'
            yield y + `| FSPeep ${position} \n` + ø
        }

        const indent = PP.spaces(depth * 2)
        const prefix = `${indent}|->`
        yield prefix + y + dimp.path.base + '/\n' + ø

        for (let entry of dimp.getDescendants()) {
            yield* entry.repr(depth + 1)
        }
    }

    function peepReduced(f: PReC, initial: any): any {
        let acc = initial;

        for (let chilln of dimp.getDescendants()) {
            acc = chilln.peepReduce(f, acc)
        }

        const oval = f(acc, dimp)
        return oval
    }

    function fileApplyd<T>(f: FApC<T>, ...rest: unknown[]): T[] {
        const des = dimp.getDescendants()
        return des.flatMap(ch => ch.fileApply(f, ...rest))
    }

    function getRelatived(relpath: string) {
        const dbgInfo = `[FileTree '${dimp.relpath}'].getFile('${relpath}')`

        if (!relpath) {
            return { reason: `${dbgInfo} | Path required.` }
        }

        else if (relpath.startsWith('/')) {
            return { reason: `${dbgInfo} | Relative path required.` }
        }

        else if (relpath == '.') {
            return { data: dimp }
        }

        else if (relpath == '..') {
            if (!dimp.parent) {
                return { reason: `${dbgInfo} | Directory is top-most in tree.` }
            }
            return { data: dimp.parent }
        }

        if (relpath.startsWith('./')) {
            return dimp.getRelative(relpath.slice(2))
        }

        if (relpath.startsWith('../')) {
            if (!dimp.parent) {
                return { reason: `${dbgInfo} | Directory is top-most in tree.` }
            }
            return dimp.parent.getRelative(relpath.slice(3))
        }

        const parts = relpath.split('/')
        const match = dimp.getDescendants().find(c => c.path.base == parts[0])
        if (!match) {
            const descBases = dimp.getDescendants().map(s => s.path.base).join(', ')
            return {
                reason: `${dbgInfo} | '${parts[0]}' not found in ${dimp.path.base} [${descBases}].`
            }
        }

        const reassembled = parts.slice(1).join('/')
        const subpath = reassembled ? `${reassembled}` : '.'
        return match.getRelative(subpath)
    }

    let watcher;
    let lastTransmit = performance.now();

    function getWatcherd(changeTransmitter?: MessagePort) {
        if (!changeTransmitter) {
            throw new ReferenceError("Can't watch files without changeTransmitter.")
        }

        if (watcher) { return watcher }
        let ws = getWatchSetd(changeTransmitter)
        for (let subw of ws) {
            if (subw.recurse) {
                subw.recurse(changeTransmitter)
            }
        }

        if (changeTransmitter) {
            watcher = watch(dimp.path.base, { persistent: false, recursive: false }, (x, filename) => {
                let changePath = join(dimp.relpath, filename ?? '')
                process.stderr.write(`${dimp.relpath}: ${changePath} changed on disk. \n`)
                if (performance.now() - lastTransmit > 100) {
                    process.stderr.write(`${dimp.relpath}: Posting 'change ${changePath}'. \n`)
                    lastTransmit = performance.now()
                    changeTransmitter.postMessage(`change ${changePath}`)
                }
            })
        }
    }

    function getWatchSetd(ct: MessagePort) {
        type Q = { key: string, recurse: ((_: MessagePort) => void) | false }
        let x: Q[] = dimp.fileApply(fst => ({
            key: fst.path.base,
            recurse: fst.imp == 'd' ? fst.getWatcher : false
        }))
        return new Set<Q>(x)
    }

    return dimp
}

function Fimp(basis: FSPbv): FSPbv & Fimp {
    if (!basis.stat.isFile()) { throw new TypeError(`${basis.relpath} is not a file.`) }
    if (basis.parent && !basis.parent.stat.isDirectory()) {
        throw new TypeError(`${basis.relpath} cannot be owned by file ${basis.parent.path.base}.`)
    }
    const contents = readFileSync(basis.relpath, 'utf-8');

    const fimp: FSPbv & Fimp = {
        imp: 'f',
        abspath: basis.abspath,
        relpath: basis.relpath,
        parent: basis.parent,
        path: basis.path,
        stat: basis.stat,
        repr: reprf,
        contents: contents,
        peepReduce: peepReduceF,
        fileApply: fileApplyf,
        getRelative: getRelativef,
    }

    function* reprf(depth = 0) {
        const p = PP.styles.pink
        const ø = PP.styles.none
        if (depth === 0) {
            yield p + '| FSPeep (file) - \n' + ø
            let attr = basis.parent ? '(in: )' + basis.parent.relpath : ''
            yield p + '|   ' + basis.relpath + ø + attr + '\n'
        } else {
            const prefix = `${PP.spaces(depth * 2)}|--`
            yield prefix + p + basis.path.base + ø + '\n'
        }
    }

    function peepReduceF(f: PReC, initial: any): any {
        return f(initial, fimp)
    }

    function fileApplyf(f, ...rest) {
        return f(fimp, ...rest)
    }

    function getRelativef(relpath) {

        if (!relpath || relpath == '.') { return { data: fimp } }

        if (!fimp.parent) {
            process.stderr.write([...fimp.repr()].join(''))
            return {
                reason: `Attempting to resolve ${relpath} from ${fimp.relpath}, `
                    + `but it was constructed as the top of its tree. `
                    + `(parent: ${fimp.parent})`
            }
        }

        return fimp.parent.getRelative(relpath)
    }


    return fimp
}

//              @ts-ignore
if (import.meta.vitest) {
    //                                   @ts-ignore
    const { test, expect } = import.meta.vitest
    let cwdFST: FSPeep;
    let editme: any;

    test('FSPeep reads testdata dir', () => {
        cwdFST = FSPeep({ entrypoint: './testdata' })
    })

    test('type is directory', () => {
        expect(cwdFST.path.base).toBe('testdata')
        expect(cwdFST.stat.isDirectory()).toBe(true)
        expect("getDescendants" in cwdFST).toBe(true)
    })

    test('filePeeking/ in descendants', () => {
        "getDescendants" in cwdFST &&
            expect(cwdFST.getDescendants().some(c => c.path.base === 'filePeeking')).toBe(true)
    })

    test('testdata/hello.txt exists', () => {
        editme = cwdFST.getRelative('filePeeking/hello.txt')
        expect("data" in editme).toBe(true)
        expect(editme.data.path.base).toBe('hello.txt')
        expect(editme.data.stat.isFile()).toBe(true)
        expect(editme.data.contents).toBe("Hello, world!")
    })

    test('Walking with peepReduce', () => {
        let count = cwdFST.peepReduce((acc, _) => acc + 1, 0)
        expect(count).toBe(readdirSync(cwdFST.relpath, { recursive: true }).length + 1)
    })
}