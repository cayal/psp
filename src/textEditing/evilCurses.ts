import { L } from "../fmt/logging"
import { PP } from "../fmt/ppstuff"
import { ModalCharGaze } from "../textEditing/charGazer"
import { assert } from "console"

const sliceStyleCoord = (i: number, l: number) => i < 0 ? Math.max(0, l + i) : Math.min(l, 0 + i)

export type Lines = {
    at: string,
    before: string[],
    after: string[]
}
export type LensOptions = {
    includeConfabulated: boolean,
    includeDestroyed: boolean,
    creed: {
        [sigilName: string]: 'prosyletize' | 'shun'
    }
}

export type CursedRangedOpRes = {
    chars: string,
    startSourceLine: number,
    startSourceOffset: number,
    endSourceLine: number,
    endSourceOffset: number
}

export type DJOpts = {
    entryPattern: string | RegExp,
    exitPattern: string | RegExp,
    sigil?: string,
    encompass?: boolean,
    lookaheadN?: number,
    lookbehindN?: number
}

export type CLOCPointer = { voice: string, sigils: string[], truth: number, linenoTruth: number }
export interface CursedLens {
    image: string,
    lensOpts: string,
    invalidatePointers: () => void,
    refocus: (newOpts: Partial<LensOptions>) => void,
    retome: (newTome: CursedDataGazer) => void,
    point: (offset: number) => CLOCPointer,
    shine: (startOffset?: number) => Generator<CLOCPointer>
    selectOnce: (lensOpts: LensOptions) => string,
    replaceBySigil: (replacingSigilName: string, content: string, addSigils: string[]) => string[],
    lensedCapture: (pattern: RegExp, o?: number) => {
        index: number,
        startTruth: number,
        endTruth: number,
        endSourceLine: number,
        groups: string[]
    },
    lensedCaptureAll: (pattern: RegExp, o?: number) => {
        index: number,
        startTruth: number,
        endTruth: number,
        endSourceLine: number,
        groups: string[]
    }[],
    lensedDestroy: (offset, count) => CursedRangedOpRes
    lensedIntrude: (offset: number, content: string, sigils: string[]) => number
    lensedLiftRanges(...cutPointOffsets: [number, number][]): CursedDataGazer[]

    dichotomousJudgement: (opts: DJOpts) => CursedRangedOpRes[]
    stashCreed: (sigil: string) => void
    popCreed: () => void
    lensedBrandRange: (sigil: string,
        encompass: boolean,
        start: number,
        end: number,
        unbrand: boolean) => CursedRangedOpRes[]

    takeSourceLines: (sourceLineNumber: number,
        contextBefore?: number,
        contextAfter?: number) => Lines

    summonBugs: (...debugStuff: any) => any
}

export class CursedDataGazer {
    id: Symbol

    #memory: ShatteredMemory

    #lenses: { [lensName: string]: CursedLens } = {}

    constructor(memory: ShatteredMemory, lenses?: { [lensName: string]: CursedLens }) {
        this.#memory = memory
        this.id = Symbol(PP.shortcode('anth'))
        if (lenses) {
            for (let [k, l] of Object.entries(lenses)) {
                this.lens(l.lensOpts, k)
            }
        }
    }

    get totalLength() { return this.#memory.length }

    getLens(name: string): CursedLens {
        return this.#lenses[name]
    }

    /**
     * Pass intrusion operation to memory and notify lenses.
     *
     * @param start Insertion point for intrusion
     * @param intrusion Intrusion content
     * @param sigils Additional sigils to add
     * @returns The updated memory.
     */
    intrudeAt(start = 0, intrusion: string, sigils: string[] = []) {
        this.#memory = ShatOps.intrude(this.#memory, start, intrusion, sigils)
        this.#invalidateLenses()
        return this.#memory
    }

    /**
     * Pass destroy operation to memory and notify lenses.
     *
     * @param location 
     * @returns The destroyed character.
     */
    destroyAt(location: number): string {
        this.#memory.destroyAt(location)
        this.#invalidateLenses()
        return this.#memory.getVoiceAt(location)
    }

    /**
     * Ensures that lenses constructed with the lens()
     * function invalidate their representations any time
     * memory changes.
     */
    #invalidateLenses() {
        for (let l in this.#lenses) {
            this.#lenses[l].invalidatePointers()
        }
    }

    /**
     * Non-destructively copies out new CursedAnthologies off
     * the existing memory, according to a range of start and
     * end points.
     * 
     * @param cutPointOffsets Starting and ending points to cut
     * @returns A new array of CursedAnthologies.
     */
    liftRanges(...cutPointOffsets: [number, number][]): CursedDataGazer[] {
        let splits = []
        let lastPoint = undefined
        cutPointOffsets.sort((a, b) => b[0] - a[0])
        for (let [start, end] of cutPointOffsets) {
            let shard = this.#memory.sliceShard(start, end)
            splits.push(new CursedDataGazer(shard))
            lastPoint = start
        }

        if (lastPoint > 0) {
            splits.push(new CursedDataGazer(this.#memory.sliceShard(0, lastPoint)))
        }

        return splits.reverse()
    }

    /**
     * Debug representation.
     *
     * @param title 
     * @param depth 
     * @param cWidth 
     * @param maxCols 
     * @param offsetBase 
     * @returns 
     */
    summonBugs(title = '', depth = 0, cWidth = 3, maxCols = 20, offsetBase = 32) {
        const idMaxW = 8

        let tt = title ? ' | ' + title : ''
        const ownid = '(' + this.id.description + tt + ')';
        const indent = PP.spaces(depth)
        let sent = ''
        const send = (s) => {
            L.log(s)
            sent += s.replaceAll(new RegExp('\x1b\\[[0-9][0-9]?m', 'g'), '')
        }
        send(PP.styles.green)
        send('\n' + indent)
        send(PP.padded(ownid, idMaxW))
        send(PP.styles.none)

        send(PP.styles.green)
        send('\n' + indent)
        send("Lenses: " + PP.keys(this.#lenses))
        send(PP.styles.none)

        let rainbow = [
            PP.styles.green,
            PP.styles.blue,
            PP.styles.red,
            PP.styles.purple,
            PP.styles.pink,
            PP.styles.yellow
        ]


        let p = this.#memory
        let lo = 0, len, line1, line2
        let bugLiner = ShatOps.bugForm(p, 0, cWidth, maxCols, offsetBase, {})
        let i = 0
        while (bugLiner.next()) {
            let charsMaybe = bugLiner.next(lo)?.value

            lo += charsMaybe

            if (!(line1 = bugLiner.next()?.value)) { break; }
            send(PP.styles.green + '\n' + indent + '|' + PP.styles.none)
            send(line1)

            line2 = bugLiner.next()?.value || '(nil)'
            send(PP.styles.green + '\n' + indent + '|' + PP.styles.none)
            send(line2)
            i++

        }

        return sent
    }

    takeLines(atLine, contextBefore, contextAfter) {
        return ShatOps.takeLines(this.#memory, atLine, contextBefore, contextAfter)
    }

    replaceBySigil(replacingSigilName, content, addSigils) {
        let ranges = ShatOps.selectBySigil(this.#memory, replacingSigilName)
            .sort((a, b) => (b[0] - a[0]));

        let destroyed = []
        for (let [start, end] of ranges) {
            for (let i = start; i < end; i++) {
                if (!this.#memory.getSigilsAt(i).includes('destroyed')) {
                    destroyed.push(this.destroyAt(i))
                }
            }
            this.intrudeAt(start, content, addSigils)
        }

        this.#invalidateLenses()
        return destroyed
    }

    shatterBySigil(removingSigilName: string): CursedDataGazer[] {
        let ranges = ShatOps.selectBySigil(this.#memory, removingSigilName)
        let cuts = []
        let highlightStart = 0, highlightEnd
        for (let [start, end] of ranges) {
            highlightEnd = start
            cuts.push([highlightStart, highlightEnd])
            highlightStart = end
        }

        let shards = []
        let last = 0
        for (let [start, end] of cuts) {
            shards.push(new CursedDataGazer(this.#memory.sliceShard(start, end), this.#lenses))
            last = end
        }

        shards.push(new CursedDataGazer(this.#memory.sliceShard(last, this.#memory.length), this.#lenses))

        return shards
    }

    brandRange(sigil, start = 0, end = this.totalLength) {
        if (!sigil) { throw new TypeError('sigil required') }

        let b = []
        for (let i = start; i < end; i++) {
            b.push(this.#memory.setSigilAt(i, sigil))
        }

        this.#invalidateLenses()
        return b
    }

    brandAt(sigil, offset, unbrand = false) {
        if (!sigil) { throw new TypeError('sigil required') }
        if (typeof offset !== 'number') { throw new TypeError(`offset required (got: ${offset})`) }

        let b = this.#memory.setSigilAt(offset, sigil, unbrand)

        this.#invalidateLenses()
        return b
    }

    lens(lensOpts = {}, name = PP.shortcode()) {
        let newLens = new CursedDataGazer.Cloc(this, lensOpts, name)
        this.#lenses[name] = newLens
        return newLens
    }


    static Cloc = class CursedLensOfRecollection implements CursedLens {
        static DefaultLens = { includeConfabulated: true, includeDestroyed: false, creed: {} }

        /** @type {CursedDataGazer} */
        #tome

        /**
         * @typedef {[sigil: string]: ('shun'|'prosyletize')} CreedSet
         * @typedef {{?creed: CreedSet, ?includeConfabulations: boolean, ?includeDestroyed: boolean}} LensOpts
         *
         * @type {LensOpts} */
        #lensOpts

        /** @type {symbol} */
        id

        constructor(anthology, lensOpts = {}, name = PP.shortcode()) {
            if (!(anthology instanceof CursedDataGazer)) { throw new TypeError(`${anthology} is not CursedAnthology.`) }
            this.id = Symbol(PP.shortcode('lens_' + name))
            this.#tome = anthology

            if (Object.keys(lensOpts).some(k => !Object.keys(CursedLensOfRecollection.DefaultLens).includes(k))) {
                throw new TypeError(`Unknown option format: \n${JSON.stringify(lensOpts)}. \nKeys should follow: \n${JSON.stringify(CursedLensOfRecollection.DefaultLens)}`)
            }
            this.#lensOpts = { ...CursedLensOfRecollection.DefaultLens, ...lensOpts }
        }

        get lensOpts() { return this.#lensOpts }

        #silenced = (sigils) => {
            return (
                (sigils.includes('confabulated') && !this.#lensOpts?.includeConfabulated)
                || (sigils.includes('destroyed') && !this.#lensOpts?.includeDestroyed)
                || this.#blasphemer(sigils)
                || this.#nonbeliever(sigils)
            )
        }
        #blasphemer = (sigils) => (sigils.some(s => this.#lensOpts?.creed?.[s] === 'shun'))
        #nonbeliever = (sigils) => Object.entries(this.#lensOpts?.creed ?? {}).some(([sk, mode]) => (mode === 'prosyletize') && !sigils.includes(sk))

        #_ptrs
        get #pointers() {
            if (this.#_ptrs) { return this.#_ptrs }
            if (this.#tome.totalLength === 0) { return [] }
            else {
                const ptrs = []
                let truth = 0
                let linenoTruth = 1
                for (let i = 0; i < this.#tome.#memory.length; i++) {
                    let voice = this.#tome.#memory.getVoiceAt(i)
                    if (voice === '\n') { linenoTruth++ }
                    let sigils = this.#tome.#memory.getSigilsAt(i)
                    if (!this.#silenced(sigils)) {
                        ptrs.push({ voice, sigils, truth, linenoTruth })
                    }
                    truth++
                }
                this.#_ptrs = ptrs
            }
            return this.#_ptrs
        }

        invalidatePointers() {
            if (this.#_ptrs) {
                this.#_ptrs = undefined
            }
        }

        refocus(newOpts) {
            this.#lensOpts = {
                ...this.#lensOpts,
                ...(newOpts.includeDestroyed ? { includeDestroyed: newOpts.includeDestroyed } : {}),
                ...(newOpts.includeConfabulated ? { includeConfabulated: newOpts.includeConfabulated } : {}),
                creed: { ...this.#lensOpts.creed, ...newOpts.creed }
            }

            this.invalidatePointers()

            return this
        }

        retome(newTome: CursedDataGazer) {
            this.#tome = newTome
            this.invalidatePointers()
        }

        point(offset) {
            this.#guardOffset(offset)
            return this.#pointers[offset]
        }

        get image() {
            return [...this.shine()].map(x => x.voice).join('')
        }

        #guardOffset(offset) {
            if (offset < 0 || offset > this.#pointers.length) {
                throw new RangeError(`${this.id.description}: Invalid offset ${offset} (Length: ${this.#pointers.length}).`)
            }
        }

        /**
         * 
         * @param {*} startOffset 
         * @param {*} startPage 
         */
        *shine(startOffset = 0) {
            this.#guardOffset(startOffset)
            for (let i = startOffset; i < this.#pointers.length; i++) {
                yield this.point(i)
            }
        }

        selectOnce(lensOpts) {
            return new CursedDataGazer.Cloc(this.#tome, lensOpts).image
        }

        replaceBySigil(replacingSigilName, content, addSigils: string[] = []) {
            return this.#tome.replaceBySigil(replacingSigilName, content, addSigils)
        }

        #lcImpl(m: RegExpMatchArray) {
            let { truth: startTruth } = this.point(m.index)
            let { truth: endTruth } = this.point(m.index + m[0].length)
            let { linenoTruth: endSourceLine } = this.point(m.index + m[0].length - 1)
            let groups = [...m]

            return { index: m.index, startTruth, endTruth, endSourceLine, groups }
        }

        lensedCapture(pattern, o = 0) {
            let v = [...this.shine(o)].map(x => x.voice).join('');

            let m = v.match(pattern)
            if (m === null) { return null }
            else { return this.#lcImpl(m) }
        }

        lensedCaptureAll(pattern, o = 0) {
            let v = [...this.shine(o)].map(x => x.voice).join('');

            let lcResults = []
            let matches = v.matchAll(pattern)
            if (matches === null) { return null }
            else {
                for (let m of matches) {
                    lcResults.push(this.#lcImpl(m))
                }
            }
            return lcResults
        }

        lensedDestroy(offset, count) {
            let retVal = []
            let dq = []
            for (let i = offset; i < offset + count; i++) {
                dq.push(this.point(i))
            }

            for (let { truth, linenoTruth } of dq) {
                retVal.push({
                    char: this.#tome.destroyAt(truth),
                    truth,
                    linenoTruth
                })
            }

            return retVal.reduce(rangedOpReducer, {})
        }

        lensedIntrude(offset, content, sigils: string[] = []) {
            const { truth } = this.point(offset)
            this.#tome.intrudeAt(truth, content, sigils)
            return truth
        }

        lensedLiftRanges(...cutPointOffsets) {
            let truths = cutPointOffsets
                .map(([s, e]) => [this.point(s).truth, this.point(e).truth])
                .sort((a, b) => (b[0] - a[0]))
            return this.#tome.liftRanges(...truths)
        }

        /**
         * @typedef {{stanza: DemonicDestruction, insets: import("./filePeeking").ModalCharSpan, content: string, lineno: number}} Evidence
         *
         * @param {string|RegExp} entryPattern 
         * @param {string|RegExp} exitPattern 
         * @param {string|null|undefined} sigil Judged passages will be branded with the sigil, or destroyed if sigil is falsy.
         * @param {function(Evidence): void} judgement 
         * @returns 
         */
        dichotomousJudgement({
            entryPattern,
            exitPattern,
            sigil,
            encompass = true,
            lookaheadN,
            lookbehindN
        }: DJOpts) {
            const ranges = ModalCharGaze(this.image, entryPattern, exitPattern, lookaheadN, lookbehindN)

            let retVal = [];
            for (let r of ranges.reverse()) {
                if (sigil) {
                    this.stashCreed(sigil)
                    retVal.push(this.lensedBrandRange(sigil, encompass, r.start, r.end))

                    if (r.innerStart) {
                        this.lensedBrandRange(`${sigil}.Open`, encompass, r.start, r.innerStart)
                    }

                    if (r.innerStart && r.innerEnd) {
                        this.lensedBrandRange(`${sigil}.Inner`, encompass, r.innerStart, r.innerEnd)
                    }

                    if (r.innerEnd && r.end) {
                        this.lensedBrandRange(`${sigil}.Close`, encompass, r.innerEnd, r.end)
                    }
                    this.popCreed()
                } else {
                    let count = r.end - r.start
                    retVal.push(this.lensedDestroy(r.start, count))
                }
            }

            return retVal.toReversed()
        }

        #stashedCreed
        stashCreed(sigil) {
            if (this.#stashedCreed && this.#stashedCreed[0] !== sigil) {
                throw new Error(`Tried to stash ${sigil}, but already stashed ${this.#stashedCreed}`)
            }

            const match = Object.entries(this.#lensOpts?.creed || {}).filter(([k, v]) => k === sigil)
            if (!match[0]) { return }
            this.#stashedCreed = match
            delete this.#lensOpts.creed[match[0][0]]
            this.invalidatePointers()
        }

        popCreed() {
            if (this.#stashedCreed) {
                Object.assign(this.#lensOpts?.creed, Object.fromEntries(this.#stashedCreed))
                this.#stashedCreed = undefined
                this.invalidatePointers()
            }
        }

        lensedBrandRange(sigil, encompass = true, start = 0, end = this.#pointers.length, unbrand = false) {
            encompass = false
            if (!sigil) { throw new TypeError('sigil required') }

            let trueRange = []
            if (encompass) {
                return this.#tome.brandRange(sigil, this.point(start).truth, this.point(end).truth, unbrand)
            }
            else {
                let retVal = []
                for (let i = start; i < end; i++) {
                    trueRange.push(this.point(i))
                }

                for (let tr of trueRange) {
                    const { truth, linenoTruth } = tr
                    let { char } = this.#tome.brandAt(sigil, truth, unbrand)
                    retVal.push({ char, truth, linenoTruth })
                }

                return retVal.reduce(rangedOpReducer, {})
            }
        }

        takeSourceLines(sourceLineNumber, contextBefore = 0, contextAfter = 0) {
            return this.#tome.takeLines(sourceLineNumber, contextBefore, contextAfter)
        }

        summonBugs({
            colors = true,
            title = '',
            depth = 0,
            cWidth = 3,
            maxCols = 20,
            offsetBase = 32
        } = {}) {
            let pp = PP
            if (!colors) { pp = pp.nostylin() }
            const idMaxW = 8

            let tt = title ? ' | ' + title : ''
            const bar = pp.styles.blue + '|' + pp.styles.none
            const ownid = '(' + this.id.description + tt + ')';
            const indent = pp.spaces(depth)
            let sent = ''
            const send = (s) => {
                L.log(s)
                sent += s.replaceAll(new RegExp('\x1b\\[[0-9][0-9]?m', 'g'), '')
            }

            send(pp.styles.blue + ownid + '\n' + pp.styles.none)
            send(bar + "lensOpts:\n")
            send(JSON.stringify(this.#lensOpts, undefined, 4).replace(/^/msg, bar + " ") + '\n')

            let rainbow = ['green', 'blue', 'red', 'purple', 'pink', 'yellow']

            const allNames = [...this.#tome.#memory.sigilSet.allNames]
            const colorPlan = allNames.reduce((acc, sName) => {
                if (sName == 'destroyed') {
                    acc[sName] = 'strike'
                }
                else if (sName.endsWith('.Open') || sName.endsWith('.Close')) {
                    acc[sName] = 'inverse'
                }
                else if (sName.endsWith('.Inner')) {
                    acc[sName] = 'bgblack'
                }
                else {
                    acc[sName] = rainbow.shift()
                    rainbow.push(acc[sName])
                }
                return acc
            }, {})

            send(bar + pp.spaces(7, '-') + 'shown:' + pp.spaces(7, '-') + '\n')
            send('\n')

            send(bar)
            for (let i = 0; i < this.image.length; i++) {
                const { voice, sigils } = this.#pointers[i]
                if (sigils.length > 1) {
                    send(pp.styles.some(...sigils.map(s => colorPlan[s])))
                } else if (sigils.length == 1) {
                    send(pp.styles[colorPlan[sigils[0]]])
                }
                send(voice == '\n' ? voice + pp.styles.none + bar : voice)
                send(pp.styles.none)
            }
            send('\n')

            send(bar + pp.spaces(7, '-') + 'full:' + pp.spaces(8, '-') + '\n')
            const optStash = structuredClone(this.#lensOpts)
            this.#lensOpts.includeConfabulated = true
            this.#lensOpts.includeDestroyed = true
            this.#lensOpts.creed = {}
            this.#_ptrs = undefined

            for (let i = 0; i < this.image.length; i++) {
                const { voice, sigils } = this.#pointers[i]
                if (sigils.length > 1) {
                    send(pp.styles.some(...sigils.map(s => colorPlan[s])))
                } else if (sigils.length == 1) {
                    send(pp.styles[colorPlan[sigils[0]]])
                }
                send(voice == '\n' ? voice + pp.styles.none + bar : voice)
                send(pp.styles.none)
            }
            send('\n')

            send(bar + pp.spaces(6, '-') + 'sigils:' + pp.spaces(7, '-') + '\n')
            for (let [k, v] of Object.entries(colorPlan)) {
                send(bar + " ")
                const color = (k.endsWith('.Open') || k.endsWith('.Inner') || k.endsWith('.Close'))
                    ? pp.styles.some(colorPlan[k.split('.')[0]], v)
                    : pp.styles[v]
                send(`${color}#${k}${pp.styles.none}`)
                send('\n')
            }

            send(bar + pp.styles.blue + pp.spaces(20, '_') + `/${ownid}` + pp.styles.none)
            send('\n')
            this.#lensOpts = optStash
            this.#_ptrs = undefined
            return sent
        }

    }
}


const _smd = {
    BYTES_PER_V: 16,
    CHARW: 4,
    SMASKS: [
        0b10000000,
        0b01000000,
        0b00100000,
        0b00010000,
        0b00001000,
        0b00000100,
        0b00000010,
        0b00000001,
    ],
    BUILTINS: ['destroyed', 'confabulated'],
}

type SigilSet = {
    readonly SIGBYTES: number,
    readonly BUILTINS: string[],
    allNames: string[],
    nameAt: (i: number) => string,
    maskOf: (s: string) => bigint,
    define: (s: string) => number,
    getNames: (b: bigint) => string[]
}

function Sigils(existing: string[] = []): SigilSet {
    const SIGBYTES = 8
    const BUILTINS = ['destroyed', 'confabulated']

    const _maxSigils = SIGBYTES * 8
    const _sigils = [];
    [...BUILTINS, ...existing].forEach((s) => {
        if (!_sigils.includes(s)) _sigils.push(s)
    })

    return {
        SIGBYTES,
        BUILTINS,
        allNames: _sigils,
        nameAt: (i: number) => _sigils[i],
        maskOf: (n: string) => BigInt.asUintN(SIGBYTES * 8, (2n ** BigInt(_sigils.indexOf(n)))),
        define: (n: string) => {
            if (_sigils.includes(n)) { return _sigils.indexOf(n) }
            const idx = _sigils.length
            if (idx === _maxSigils) { throw new RangeError('Sigil set full.') }
            _sigils[idx] = n;
            return idx
        },
        getNames: (b: bigint) => {
            const retVal = []
            let mask = BigInt.asUintN(64, 2n ** BigInt(SIGBYTES * 8 - 1))
            for (let i = 0; i < SIGBYTES * 8; i++) {
                if (mask & b) {
                    if (!_sigils[i]) { console.warn(`Sigils: Trying to get unknown sigil #${i}. Known: ${PP.ar(_sigils)}`) }
                    retVal.push(_sigils[i])
                }
                mask >>= 1n
            }
            return retVal
        }
    }
}

export type SetSigilRes = {
    char: string,
    sp: number,
    mask: bigint
}

export type ShatteredMemory = {
    CHARW: number,
    BYTES_PER_V: number,
    id: symbol,
    dataView: DataView,
    sigilSet: SigilSet,
    length: number,
    encoder: TextEncoder,
    decoder: TextDecoder,
    at: (i: number) => ArrayBuffer,
    voice: (start?: number, end?: number) => string,
    sigils: (start?: number, end?: number) => string[][],
    getVoiceAt: (i: number) => string,
    setVoiceAt: (i: number, char: string) => void,
    setSigilAt: (i: number, sigil: string, unset?: boolean) => SetSigilRes,
    getSigilsAt: (i: number) => string[],
    sliceShard: (start: number, end: number) => ShatteredMemory,
    setSigilByPosition: (i: number, sp: number, unset?: boolean) => SetSigilRes,
    destroyAt: (i: number) => SetSigilRes,
    nooob: (...boundcheckme: number[]) => true
}

export type ShatMemOpts = {
    content: string | ArrayBuffer,
    sigils?: SigilSet,
    confabulated?: boolean
}

export function ShatteredMemory({ content, sigils = Sigils(), confabulated }: ShatMemOpts): ShatteredMemory {
    const CHARW = 4
    const BYTES_PER_V = CHARW + sigils.SIGBYTES

    const _enc = new TextEncoder()
    const _dec = new TextDecoder()

    let clen = typeof content === 'string' ? content.length * BYTES_PER_V : content.byteLength
    if (!clen) { return BlankMemory }
    if (clen % BYTES_PER_V !== 0) { throw new TypeError(`Bad length ${clen}.`) }

    let _head = new ArrayBuffer(clen)
    let _dv = new DataView(_head, 0)
    const _length = _head.byteLength / BYTES_PER_V

    if (content instanceof ArrayBuffer) {
        _head = content
        _dv = new DataView(_head, 0)
    } else {
        for (let i = 0; i < content.length; i++) {
            _setVo(i, content[i])
        }
    }

    if (confabulated) {
        for (let i = 0; i < _length; i++) {
            _setSi(i, 'confabulated')
        }
    }

    return {
        CHARW,
        BYTES_PER_V,
        id: Symbol(PP.shortcode(_getVo(0))),
        sigilSet: sigils,
        dataView: _dv,
        length: _length,
        encoder: _enc,
        decoder: _dec,
        at: _at,
        voice: _sliceSMText,
        sigils: _sliceSigs,
        setSigilAt: _setSi,
        setSigilByPosition: _setSiBP,
        sliceShard: _sliceShard,
        getSigilsAt: (i: number) => _sliceSigs(i, i + 1)[0],
        destroyAt: (i: number) => _nooob(i) && _setSiBP(i, 0),
        getVoiceAt: _getVo,
        setVoiceAt: _setVo,
        nooob: _nooob
    }

    function _at(i: number): ArrayBuffer {
        _nooob(i)
        const byteOff = i * BYTES_PER_V
        return _head.slice(byteOff, byteOff + BYTES_PER_V)
    }

    function _getVo(i: number) {
        _nooob(i)
        const utfb = _dv.getUint32(i * BYTES_PER_V)
        return _dec.decode(Uint8Array.from([utfb])).replace(/\0/g, '')
    }

    function _setVo(i: number, char: string) {
        _nooob(i)
        if (char.length > 1) { return new TypeError('c should be one character.') }
        _dv.setUint32(i * BYTES_PER_V, _enc.encode(char) as unknown as number)
    }

    function _setSi(i, sigil, unset = false) {
        _nooob(i)
        let sp = sigils.define(sigil)
        return _setSiBP(i, sp, unset)
    }

    function _setSiBP(i: number, sp: number, unset = false): SetSigilRes {
        _nooob(i)

        if (sp < 0 || sp > sigils.SIGBYTES * 8) { throw new TypeError(`Invalid sigil position ${sp}.`) }

        const mask = BigInt.asUintN(64, 2n ** BigInt((sigils.SIGBYTES * 8 - 1) - sp))
        const charOffset = i * BYTES_PER_V
        const sigilData = _dv.getBigUint64(charOffset + CHARW)
        const word = unset ? (sigilData & BigInt.asUintN(64, ~mask)) : (sigilData | mask)

        _dv.setBigUint64(charOffset + CHARW, word)
        return {
            char: _getVo(i),
            sp: sp,
            mask: word
        }
    }

    function _sliceShard(start: number = 0, end: number = _length): ShatteredMemory {
        _nooob(start, end)
        return ShatteredMemory({
            content: _head.slice(start * BYTES_PER_V, end * BYTES_PER_V),
            sigils: sigils
        })
    }

    function _sliceSMText(start: number = 0, end?: number) {
        const fromIdx = sliceStyleCoord(start, _length)
        const toIdx = !end ? _length : sliceStyleCoord(end, _length)

        _nooob(fromIdx, toIdx)

        if (toIdx <= fromIdx) { return '' }
        else {
            let retVal = ''
            for (let i = fromIdx; i < toIdx; i++) {
                const byteOff = i * BYTES_PER_V
                const utfv = _dv.getUint32(byteOff)
                const char = _dec.decode(Uint8Array.from([utfv]))
                retVal += char.replace(/\0/g, '')
            }
            return retVal
        }
    }

    function _sliceSigs(start: number = 0, end?: number, whichSigils?: (string | number)[]) {
        assert(sigils.SIGBYTES === 8, '64 bits is just a nice number')

        const fromIdx = sliceStyleCoord(start, _length)
        const toIdx = !end ? _length : sliceStyleCoord(end, _length)

        _nooob(fromIdx, toIdx)

        if (toIdx <= fromIdx) { return [] }
        else {
            const sigilsv = []
            for (let i = fromIdx; i < toIdx; i++) {
                const byteOff = i * BYTES_PER_V
                sigilsv.push(_dv.getBigUint64(byteOff + CHARW))
            }
            return sigilsv.map(sigils.getNames)
        }

    }

    function _nooob(...boundcheckme: number[]): true {
        for (let i of boundcheckme) {
            if (i < 0 || i > _length) { throw new RangeError(`Index (${i}) OOB (of ${_length})`) }
        }
        return true
    }
}

export const ShatOps = {

    split(mem: ShatteredMemory, at: number): ShatteredMemory[] {
        if (at === 0 || at === mem.length) { return [mem] }

        mem.nooob(at)

        const stub = mem.sliceShard(0, at)
        const severed = mem.sliceShard(at, mem.length)

        return [stub, severed]
    },

    intrude(mem: ShatteredMemory, at: number, intrusion: string, addlSigils = []) {
        if (!intrusion) { throw new TypeError('No text to insert.') }

        mem.nooob(at)

        for (let ads of addlSigils) {
            mem.sigilSet.define(ads)
        }

        const intruder = ShatteredMemory({ content: intrusion, sigils: mem.sigilSet, confabulated: true })

        for (let i = 0; i < intruder.length; i++) {
            for (let ads of addlSigils) {
                intruder.setSigilAt(i, ads)
            }
        }

        const pieces = ShatOps.split(mem, at)

        return ShatOps.merge(pieces[0], intruder, ...pieces.slice(1))
    },


    merge(...shards: ShatteredMemory[]) {
        const totalLength = shards.reduce((acc, x) => acc + x.length, 0)
        const sUnion = shards[0].sigilSet
        for (let shard of shards.slice(1)) {
            for (let name of shard.sigilSet.allNames) {
                sUnion.define(name)
            }
        }

        const merged = ShatteredMemory({
            content: new ArrayBuffer(totalLength * shards[0].BYTES_PER_V),
            sigils: sUnion
        })

        let o = 0
        for (let sh of shards) {
            for (let i = 0; i < sh.length; i++) {
                merged.setVoiceAt(o, sh.getVoiceAt(i))
                sh.getSigilsAt(i).forEach(sig => {
                    if (!shards[0].sigilSet.BUILTINS.includes(sig)) {
                        merged.setSigilAt(o, sig)
                    } else {
                        merged.setSigilByPosition(o, shards[0].sigilSet.BUILTINS.indexOf(sig))
                    }
                })
                o++
            }
        }

        return merged
    },

    selectBySigil(mem: ShatteredMemory, sigilName: string) {
        let ranges = [];

        let open = -1;
        for (let i = 0; i < mem.length; i++) {
            const sigils = mem.getSigilsAt(i)
            if ((open < 0) && sigils.includes(sigilName)) {
                open = i
                continue
            }
            if ((open >= 0) && !sigils.includes(sigilName)) {
                ranges.push([open, i])
                open = -1
            }
        }

        if (open >= 0) {
            ranges.push([open, mem.length - 1])
        }

        return ranges
    },

    takeLines(mem: ShatteredMemory, atLine, contextBefore = 0, contextAfter = 0) {
        let lines: { at: string, before: string[], after: string[] } = { at: '', before: [], after: [] }
        let line = 1
        for (let o = 0; o < mem.length; o++) {
            const c = mem.getVoiceAt(o)
            if (c === '\n') {
                line += 1
            }

            if ((line >= atLine - contextBefore) && (line < atLine)) {
                lines.before.push(c)
            }

            if (line === atLine && c !== '\n') {
                lines.at += c
            }

            if ((line > atLine) && line <= (atLine + contextAfter)) {
                lines.after.push(c)
            }
        }

        lines.before = lines.before.join('').split('\n')
        lines.after = lines.after.join('').split('\n')

        return lines
    },

    *bugForm(mem: ShatteredMemory,
        globalOffset = 0,
        cWidth = 3,
        maxCols = 20,
        offsetBase = 32,
        brandColors = {}) {

        const powerArrow = '-: '
        const ownColor = PP.styles.purple
        const arrowThroughHead = `-(${mem.id.description})` + powerArrow

        const content = Array(mem.length).fill(0).map((_, i) => ([mem.getVoiceAt(i), mem.getSigilsAt(i)])).reverse()
        if (!content.length) {
            return `(empty ${arrowThroughHead})`
        }

        while (content.length > 0) {
            let localOffset = yield
            let line1: string = ''

            if (localOffset === 0) {
                line1 += (ownColor + arrowThroughHead + PP.styles.none)
            } else {
                line1 += PP.spaces(arrowThroughHead)
            }

            let charsOut = 0
            let end = Math.min(mem.length, localOffset + maxCols)
            for (let i = localOffset; i < end; i++) {
                let [c, sigils] = content.pop()
                if (sigils.includes('destroyed')) { line1 += PP.styles.strike }
                if (sigils.length > 1) {
                    line1 += PP.styles.black
                } else {
                    line1 += brandColors?.[sigils?.[0]] ?? ''
                }
                line1 += (PP.oneChar(c, cWidth))
                charsOut += 1
                line1 += PP.styles.none
                if (c === '\n') {
                    break
                }
            }
            line1 += ('\x1b[0m')

            yield charsOut
            yield line1

            let line2 = PP.spaces(arrowThroughHead.length)
            line2 += PP.styles.pink
            Array(charsOut).fill(0).forEach((_, i) => {
                i < maxCols && (line2 += PP.padded((i + globalOffset + localOffset).toString(offsetBase), cWidth))
            })
            line2 += '.'
            yield line2
        }
    }
}


// @ts-ignore
if (import.meta.vitest) {
    // @ts-ignore
    const { test, expect } = import.meta.vitest

    test('sigils do their thing', () => {
        const si = Sigils(['foo', 'bar', 'baz'])
        expect(si.nameAt(0)).toBe('destroyed')
        expect(si.nameAt(1)).toBe('confabulated')
        expect(si.nameAt(2)).toBe('foo')
        expect(si.nameAt(4)).toBe('baz')
        expect(si.nameAt(5)).toBe(undefined)
    })

    test('shats are voiced', () => {
        let sm = ShatteredMemory({ content: 'abc' })
        expect(() => sm.getVoiceAt(-1)).toThrowError()
        expect(sm.at(0).byteLength).toBe(12)
        expect(new Uint8Array(sm.at(0))).toStrictEqual(
            new Uint8Array([0, 0, 0, 97].concat(...Array(sm.sigilSet.SIGBYTES).fill(0)))
        )
        expect(sm.getVoiceAt(0)).toBe('a')
        expect(sm.getVoiceAt(1)).toBe('b')
        expect(sm.getVoiceAt(2)).toBe('c')
        expect(() => sm.getVoiceAt(3)).toThrowError()
    })

    test('shats are sigilled', () => {
        let sm = ShatteredMemory({ content: 'abc' })

        expect(() => sm.setSigilAt(-1, '')).toThrowError()
        expect(() => sm.setSigilAt(498, '')).toThrowError()

        sm.setSigilAt(0, 'vowel')
        expect(sm.getSigilsAt(0)).toStrictEqual(['vowel'])

        sm.setSigilAt(2, 'consonant')
        expect(sm.getSigilsAt(2)).toStrictEqual(['consonant'])

        sm.setSigilAt(0, 'neededByCayal')
        sm.setSigilAt(0, 'neededByCayal')
        sm.setSigilAt(2, 'neededByCayal')
        expect(sm.getSigilsAt(0)).toStrictEqual(['vowel', 'neededByCayal'])
        expect(sm.getSigilsAt(1)).toStrictEqual([])
        expect(sm.getSigilsAt(2)).toStrictEqual(['consonant', 'neededByCayal'])

        sm.destroyAt(1)
        expect(sm.getSigilsAt(1)).toStrictEqual(['destroyed'])
    })

    test('shats are spliced', () => {
        let sm = ShatteredMemory({ content: 'Hello world' })

        let a = ShatOps.intrude(sm, 5, 'yo')
        expect(a.voice()).toBe('Helloyo world')
        expect(new Uint8Array(a.at(0).slice(3, 4))).toStrictEqual(new Uint8Array(['H'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(1).slice(3, 4))).toStrictEqual(new Uint8Array(['e'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(2).slice(3, 4))).toStrictEqual(new Uint8Array(['l'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(3).slice(3, 4))).toStrictEqual(new Uint8Array(['l'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(4).slice(3, 4))).toStrictEqual(new Uint8Array(['o'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(5).slice(3, 4))).toStrictEqual(new Uint8Array(['y'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(6).slice(3, 4))).toStrictEqual(new Uint8Array(['o'.charCodeAt(0)]))
        expect(new Uint8Array(a.at(7).slice(3, 4))).toStrictEqual(new Uint8Array([' '.charCodeAt(0)]))
        expect(new Uint8Array(a.at(8).slice(3, 4))).toStrictEqual(new Uint8Array(['w'.charCodeAt(0)]))
        expect(a.length).toBe(13)

        let sm2 = ShatteredMemory({ content: 'abcdef' })
        let x = ShatOps.intrude(sm2, 2, 'oo')
        expect(new Uint8Array(x.at(0).slice(3, 4))).toStrictEqual(new Uint8Array(['a'.charCodeAt(0)]))
        expect(new Uint8Array(x.at(2).slice(3, 4))).toStrictEqual(new Uint8Array(['o'.charCodeAt(0)]))
        expect(new Uint8Array(x.at(4).slice(3, 4))).toStrictEqual(new Uint8Array(['c'.charCodeAt(0)]))
    })

    test('Cursed Anthology init', () => {
        let _ = new CursedDataGazer(ShatteredMemory({ content: 'aaaaaaaaa' }))
    })

    test('CA intrusion, default lens', () => {
        let ca = new CursedDataGazer(ShatteredMemory({ content: 'intrude upon this string' }))
        ca.intrudeAt(8, 'ok then ')
        expect(ca.totalLength).toBe('intrude upon this string'.length + 'ok then '.length)

        let basicLens = ca.lens()
        expect(basicLens.image).toBe('intrude ok then upon this string')
    })

    test('destruction of the realms', () => {
        let d = new CursedDataGazer(ShatteredMemory({ content: 'realms' }))
        let l = d.lens()
        expect(l.image).toBe('realms')

        let severed = l.lensedDestroy(0, 3)
        expect(severed.chars).toStrictEqual('rea')
        expect(d.totalLength).toBe(6)
        expect(l.image).toBe('lms')
    })

    test('capture of the commas', () => {
        let nimh = new CursedDataGazer(ShatteredMemory({
            content:
                `Fool, becoming immortal is a cursed crusade. ` +
                `A nemesis, leading to the grave.`
        }))
        let l = nimh.lens()
        expect(l.lensedCapture(',').index).toBe(4)
        expect(l.lensedCapture(',').startTruth).toBe(4)
        expect(l.lensedCapture(',').endTruth).toBe(5)
        expect(l.lensedCapture(',').groups).toStrictEqual([','])
        l.lensedDestroy(0, 6)
        expect(l.lensedCapture(',').index).toBe(48)
        expect(l.lensedCapture(',').startTruth).toBe(48 + 6)
        expect(l.lensedCapture(',').endTruth).toBe(48 + 6 + 1)
    })

    test('corruption of the greetings', () => {
        let hw = new CursedDataGazer(ShatteredMemory({ content: 'Hello, world!' }))
        let l = hw.lens()
        l.lensedDestroy(0, 5)
        l.lensedIntrude(0, 'Goodbye', ['pessimistic'])
        l.lensedIntrude(9, 'cruel ', ['pessimistic'])
        expect(l.image).toBe('Goodbye, cruel world!')

        let l2 = hw.lens({ creed: { pessimistic: 'prosyletize' } })

        expect(l2.image).toBe('Goodbyecruel ')
        l2.lensedIntrude(5, ' again')

        let l3 = hw.lens({ includeDestroyed: true, creed: { pessimistic: 'shun' } })
        expect(l3.image).toBe('Hello again, world!')
    })

    test('multiplication', () => {
        let hw2 = new CursedDataGazer(ShatteredMemory({ content: 'Hello, world!' }))
        let l = hw2.lens()
        let [a, b] = l.lensedLiftRanges([0, 3], [5, 8])
        let al = a.lens()
        let bl = b.lens()
        expect(al.image).toBe('Hel')
        expect(bl.image).toBe(', w')
    })

    test('judgements', () => {
        let caComments = new CursedDataGazer(ShatteredMemory({ content: '<title>Hello<!---></title><h1><!--exclude me--></h1>' }))
        let l = caComments.lens()
        l.dichotomousJudgement({ entryPattern: '<!--', exitPattern: '-->' })
        expect(l.image).toBe('<title>Hello</title><h1></h1>')

        let caComments2 = new CursedDataGazer(ShatteredMemory({ content: '<title>Hello<!---></title><h1><!--exclude me--></h1>' }))
        let l2 = caComments2.lens({ creed: { comment: 'shun' } })
        l2.dichotomousJudgement({ entryPattern: '<!--', exitPattern: '-->', sigil: 'comment' })
        expect(l2.image).toBe('<title>Hello</title><h1></h1>')
    })

    test('selections and replacements', () => {
        let gumpo = new CursedDataGazer(ShatteredMemory({ content: 'I dont know some type of gumpo guy i can be anything' }))
        let l = gumpo.lens()
        l.dichotomousJudgement({ entryPattern: 'of', exitPattern: 'guy', sigil: 'spoop' })
        l.replaceBySigil('spoop', 'of shoop fella')
        expect(l.image).toBe('I dont know some type of shoop fella i can be anything')
    })
}

const rangedOpReducer = (acc, { char, truth, linenoTruth }, i) =>
({
    chars: (acc?.chars ?? "") + char,
    startSourceOffset: i === 0 ? truth : acc.startSourceOffset,
    startSourceLine: i === 0 ? linenoTruth : acc.startSourceLine,
    endSourceLine: linenoTruth,
    endSourceOffset: truth
})

const BlankMemory: ShatteredMemory = {
    CHARW: 0,
    BYTES_PER_V: 0,
    id: Symbol('blank'),
    dataView: new DataView(new ArrayBuffer(0), 0),
    sigilSet: Sigils(),
    length: 0,
    encoder: new TextEncoder,
    decoder: new TextDecoder,
    at: (_i) => new ArrayBuffer(0),
    voice: (_start, _end) => '',
    sigils: (_start, _end) => [[]],
    getVoiceAt: (_i) => '',
    setVoiceAt: (_) => { },
    setSigilAt: () => ({ char: '', sp: 0, mask: 0n }),
    getSigilsAt: () => [],
    sliceShard: () => BlankMemory,
    setSigilByPosition: () => ({ char: '', sp: 0, mask: 0n }),
    destroyAt: () => ({ char: '', sp: 0, mask: 0n }),
    nooob: () => true
}