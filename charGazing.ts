import { FSPeep } from "./filePeeping"

type fEB = (_: string) => RegExpMatchArray | boolean | null
type fEL = (_: string) => number
type Range = { start: number, end?: number, innerStart?: number, innerEnd?: number }

export function ModalCharGaze(con: string, enterSeq: string | RegExp, exitSeq: string | RegExp): Range[] {
    let enteredBy: fEB, exitedBy: fEB,
        enterLength: fEL, exitLength: fEL,
        nLookahead: number, nLookbehind: number

    if (enterSeq instanceof RegExp) {
        if (!enterSeq.source.startsWith('^')) {
            console.warn(`ModalCharGazer.enrange() | Entry pattern '${enterSeq.source}' does not start with '^'.`)
        }

        enteredBy = (s) => s.match(enterSeq)
        enterLength = (s) => s.match(enterSeq)?.[0].length ?? 0
        nLookahead = Infinity
    } else {
        enteredBy = (s) => s == enterSeq
        enterLength = (_) => enterSeq.length
        nLookahead = enterSeq.length
    }

    if (exitSeq instanceof RegExp) {
        if (!exitSeq.source.endsWith('$')) {
            console.warn(`ModalCharGazer.enrange() | Exit pattern '${enterSeq.source}' does not end with '$'.`)
        }

        exitedBy = (s) => s.match(exitSeq)
        exitLength = (s) => s.match(exitSeq)?.[0].length ?? 0
        nLookbehind = Infinity
    } else {
        exitedBy = (s) => s == exitSeq
        exitLength = (_) => exitSeq.length
        nLookbehind = exitSeq.length
    }

    const anyInners = (i: number, la: string, lb: string, ro: number, iro: number) => {
        const maybeInnerEnd = i - exitLength(lb)
        const maybeInnerStart = innerRangeOpen
        return (maybeInnerEnd > maybeInnerStart
            ? { innerStart: innerRangeOpen, innerEnd: i - exitLength(lb) }
            : {})
    }

    const ranges: Range[] = []
    let rangeOpen = -1
    let innerRangeOpen = -1
    let depth = 0
    for (let i = 0; i <= con.length; i++) {
        const lookahead = con.slice(i, Math.min(con.length, i + nLookahead))
        const lookbehind = con.slice(Math.max(0, i - nLookbehind), i)
        const entered = enteredBy(lookahead)
        const exited = exitedBy(lookbehind)
        depth += entered ? 1 : (exited) ? -1 : 0

        if (depth > 0 && i === (con.length - 1)) {
            ranges.push({ start: rangeOpen, innerStart: innerRangeOpen })
            continue
        }
        else if (depth == 1 && entered) {
            rangeOpen = i
            innerRangeOpen = i + enterLength(lookahead)
            continue
        }
        else if (depth == 0 && exited) {
            ranges.push({
                start: rangeOpen,
                end: i,
                ...anyInners(i, lookahead, lookbehind, rangeOpen, innerRangeOpen)
            })
            rangeOpen = -1
            innerRangeOpen = -1
        }
    }

    return ranges
}

//              @ts-ignore
if (import.meta.vitest) {
    //                                   @ts-ignore
    const { test, expect } = import.meta.vitest
    let editme = FSPeep({ entrypoint: './testdata/filePeeking/hello.txt' })

    test('Finds string patterns', () => {
        expect(editme.imp).toBe('f')
        expect(editme.imp == 'f' && ModalCharGaze(editme.contents, 'll', 'wo')).toStrictEqual([{ start: 2, innerStart: 4, end: 9, innerEnd: 7 }])
    })

    test('Finds regex patterns identically, ignores nests', () => {
        let instring = `ABC<!-->I<!-- hmm -->VWX<!-- .. <!-- nest --> . -->z`
        //              012     8          21,22,23                       51
        let expRs = [
            { start: 3, end: 8 },
            { start: 9, end: 21, innerStart: 13, innerEnd: 18, },
            { start: 24, end: 51, innerStart: 28, innerEnd: 48, }
        ]

        expect(ModalCharGaze(instring, '<!--', '-->')).toStrictEqual(expRs)
        expect(ModalCharGaze(instring, /^<!--/, /-->$/)).toStrictEqual(expRs)
    })
}