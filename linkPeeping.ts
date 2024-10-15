import { existsSync, link, readFileSync, statSync } from "fs";
import { CursedDataGazer as CursedDataGazer, ShatteredMemory } from "./evilCursing";
import { FSPeep } from "./filePeeping.js";
import { PP } from "./ppstuff.js";
import { join, relative, resolve } from "path";
import { ModalCharGaze } from "./charGazing.js";
import { isAscii, isUtf8 } from "buffer";
import { assert } from "console";


export type QF = {
    query?: string,
    fragment?: string,
}

export type PLink = {
    webpath: string,
    relpath: string,
    type: 'dir' | 'html' | 'file'
    cwd: string,
    ogPeep: FSPeep
} & QF

export type LinkPeepOpts = { entrypoint: FSPeep }
export type LinkPeeps = { rootAbs: string, links: PLink[] }
export function LinkPeeps({ entrypoint }: LinkPeepOpts): LinkPeeps {
    if (entrypoint.parent) {
        throw new RangeError('Entrypoint for LinkPeep must be a root-level FSPeep.')
    }

    const index = entrypoint.getRelative('index.html')
    if ("reason" in index) {
        throw new ReferenceError(`Linked to directory ${entrypoint.relpath}, but no index.html found.`)
    }

    const wtrR = (acc: PLink[], peep: FSPeep) => {
        return [...acc, PLink(entrypoint, peep)]
    }

    const pLinks = entrypoint.peepReduce(wtrR, [])

    return { rootAbs: entrypoint.abspath, links: pLinks }
}

function normalize(targetLink: string): QF & { target: string } {
    const fPat = /#.*$/
    const fragment = targetLink.match(fPat)?.[0]?.slice(1)
    targetLink = targetLink.replace(fPat, '')

    const qPat = /\?.*$/
    const query = targetLink.match(qPat)?.[0]
    targetLink = targetLink.replace(qPat, '')

    const trailingSlashes = /\/+$/
    targetLink = targetLink.replace(trailingSlashes, '')

    return { target: targetLink || '/', fragment, query }
}


function PLink(entrypoint: FSPeep, peep: FSPeep): PLink {
    const _type = peep.imp === 'd' ? 'dir' : peep.path.ext === '.html' ? 'html' : 'file'
    const _webpath = normalize('/' + relative(entrypoint.abspath, peep.abspath).replace(/index\.html$/, '')).target
    const _relpath = normalize(peep.relpath).target
    const _cwd = _type === 'dir' ? _relpath : _relpath.replace(/\/[^/]*$/, '')

    return {
        webpath: _webpath,
        relpath: _relpath,
        type: _type,
        cwd: _cwd,
        ogPeep: peep
    }
}

type GazedMarkup = { gazer: CursedDataGazer, hasBody: boolean, fragmentNames: string[], lensNames: string[] }

export type Queried = { type: PLink["type"] } & QF & {
    result: (
        | { type: 'okFile', getData: () => Buffer | string }
        | { type: 'okHtml', getData: () => GazedMarkup }
        | { type: 'err', reason: 'string' }
    )
}

export function indeedHtml(q: Queried | { type: '404', reason: string }): PLink & Queried & { type: 'html' } {
    if (q.type === '404') {
        throw new ReferenceError(`Could not find self: ${q.reason}`)
    }

    if (q.type === 'dir') {
        throw new ReferenceError(`Link result is a directory.`)
    }

    if (q.type === 'file') {
        throw new ReferenceError(`Link result is a file.`)
    }

    return q as PLink & Queried & { type: 'html' }
}

function PLQ(from: Exclude<PLink, { type: 'dir' }>, respondingTo: QF): PLink & Queried {
    let { query, fragment } = respondingTo
    let responder = { 'file': _getBuffer, 'html': _getGazedMarkup }[from.type]

    return {
        ...from,
        query,
        fragment,
        result: responder()
    }

    function _getBuffer() {
        const buf = Buffer.from(from.ogPeep.contents as string)

        // TODO mimetypes etc
        if (isUtf8(buf) || isAscii(buf)) {
            return {
                type: 'okFile',
                contentType: 'application/octet-stream',
                getData: () => buf.toString('utf-8')
            }
        } else {
            return {
                type: 'okFile',
                contentType: 'application/octet-stream',
                getData: () => buf
            }
        }
    }

    function _getGazedMarkup() {
        const gazer = new CursedDataGazer(ShatteredMemory({ content: (from.ogPeep.contents as string) }))
        const content = gazer.lens({ creed: { comment: 'shun' } }, 'default')
        content.dichotomousJudgement('<!--', '-->', 'comment')
        const hasBody = content.image.match(/<body.*>.*<\/body.*>/gs) !== null
        const fragmentNames = [...content.image.matchAll(/id=['"]([^\t\n\f \/>"'=]+)['"]/gs)].map(m => m[1])
        if (fragment && !fragmentNames.includes(fragment)) {
            return { type: 'err', reason: `Fragment ${fragment} not found in ${gazer.id.description}.` }
        }
        const lensNames = HConLM(gazer, hasBody, fragmentNames)

        return {
            type: 'okHtml',
            getData: (() => ({
                gazer,
                hasBody,
                lensNames
            }))
        }
    }
}


export type PLinkLocable = (atA: string) => LinkLocator
export type LinkLocator = (toB: string) => Queried | { type: '404', reason: string }
export type PeepedLinkResolution = { type: '404', reason: string } | (PLink)

export const LinkPeepLocator: (_: LinkPeeps) => PLinkLocable = ({ rootAbs, links }: LinkPeeps) =>
    (atA: string) => {
        const dbgInfo = `LPResolveRelative{rootAbs: ${rootAbs}}.atA(${atA})`

        if (!rootAbs.startsWith('/')) { throw new TypeError(`${dbgInfo}: root is not an abspath.`) }

        atA = normalize(atA).target
        const itSaMe = (l: PLink) => (l.relpath == atA)

        if (!existsSync(atA)) {
            throw new ReferenceError(`${dbgInfo}: '${atA}' does not exist.`)
        }
        else if (!links.some(itSaMe)) {
            throw new ReferenceError(`${dbgInfo}: '${atA}' is not a point in targetLinks: ${PP.o(links)}`)
        }
        else {
            const selfPoint = links.find(itSaMe)

            const resolveAbsolute = ({ query, fragment, target }) => {
                let found: PLink;
                if (!(found = links.find(x => x.webpath === target))) {
                    return { type: '404' as const, reason: `Webpath ${target} not found in links: ${PP.o(links)}` }
                }

                else if (found.type === 'dir') {
                    return resolveAbsolute({ query, fragment, target: `${target}/index.html` })
                }

                return PLQ(found, { query, fragment })
            }

            return function seek(toB: string) {
                let { query, fragment, target } = normalize(toB.replace(/index\.html$/, ''))

                if (target.startsWith('/')) {
                    return resolveAbsolute({ query, fragment, target })
                } else {
                    const candidate = resolve(selfPoint.cwd, target)
                    const asWebpath = '/' + relative(rootAbs, candidate)
                    return resolveAbsolute({ query, fragment, target: asWebpath })
                }
            }
        }
    }


type HconLensMap = {
    wholeFile: 'default',
    body?: string,
    preBody?: string,
    postBody?: string,
    fragments: {
        [fragmentName: string]: string
    }
}

export function HConLM(visions: CursedDataGazer, hasBody: boolean, fragmentNames: string[]): HconLensMap {
    const uniquer = PP.shortcode('.Peep', 3)
    const uniquing = (s: string) => s + uniquer
    const retVal: HconLensMap = {
        wholeFile: 'default',
        ...(hasBody ? { body: undefined } : {}),
        ...(hasBody ? { preBody: undefined } : {}),
        ...(hasBody ? { postBody: undefined } : {}),
        fragments: { ...fragmentNames.reduce((a, fn) => ({ ...a, [fn]: undefined }), {}) }
    }

    const DL = visions.getLens('default')
    if ("body" in retVal) {
        const bodyOpenPattern = /^<body\s*[^<>]*>/
        const bodyClosePattern = /<\/body[^<>]*>$/
        const bodySigil = uniquing('body')
        DL.dichotomousJudgement(bodyOpenPattern, bodyClosePattern, bodySigil)
        visions.lens({ creed: { [`${bodySigil}.Inner`]: 'prosyletize' } }, bodySigil)
        retVal.body = bodySigil

        const { endTruth: preBodyEnd } = (DL.lensedCapture(/<body\s*[^<>]*>/))
        const { startTruth: postBodyStart } = (DL.lensedCapture(/<\/body\s*[^<>]*>/))
        const prBS = 'pre' + bodySigil
        const poBS = 'post' + bodySigil
        visions.brandRange(prBS, 0, preBodyEnd)
        visions.brandRange(poBS, postBodyStart)
        visions.lens({ creed: { prBS: 'prosyletize' } }, prBS)
        visions.lens({ creed: { poBS: 'prosyletize' } }, poBS)
        retVal.preBody = prBS
        retVal.postBody = poBS
    }

    for (let frn of fragmentNames) {
        if (frn === '') { continue }
        const targetMatcher = new RegExp(`<([a-zA-Z\-]+)[^<>]+id=['"]${frn}['"][^<>]*>`) // sosumi
        const { _0, groups } = visions.getLens('default').lensedCapture(targetMatcher)
        const [_1, tagName] = groups

        const tfOpenPattern = new RegExp(`^<${tagName}[^<>]*>`)
        const tfClosePattern = new RegExp(`</${tagName}[^<>]*>$`)
        const targetRanges = visions.getLens('default').dichotomousJudgement(tfOpenPattern, tfClosePattern, frn)
        if (!targetRanges || !targetRanges.length) {
            DL.pprintProblemLine(null, `Tag with ID '${frn}' not found.`, true)
        } else if (targetRanges.length > 1) {
            DL.pprintProblemLine(null, `Multiple tags with ID '${frn}'.`, true)
        } else {
            const frnBrand = uniquing(frn)
            visions.lens({ creed: { [frn + '.Inner']: 'prosyletize' } }, frnBrand)
            retVal.fragments[frn] = frnBrand
        }
    }

    return retVal
}

//              @ts-ignore
if (import.meta.vitest) {
    //                                       @ts-ignore
    const { test, expect } = import.meta.vitest
    let lps;
    let f = FSPeep({ entrypoint: 'testdata/pwl/' });
    let pizzaP, main, buzz, index
    let links;

    test('Can construct in folder', () => {
        lps = LinkPeeps({ entrypoint: f })
    })

    test("Can't construct without index", () => {
        expect(() => LinkPeeps({ entrypoint: FSPeep({ entrypoint: 'testdata/pwl/subworld' }) })).toThrowError()
    })

    test("Can't resolve garbo gumbo", () => {
        expect(() => LinkPeepLocator(lps)('garbo')).toThrowError()

        pizzaP = LinkPeepLocator(lps)('testdata/pwl/subworld/pizza.html')
        expect(pizzaP('/garbogumbo').type).toBe('404')
        expect(pizzaP('./buzz.html').type).toBe('404')
        expect(pizzaP('../../buzz.html').type).toBe('404')
        expect(pizzaP('/pizza.html').type).toBe('404')

        expect(pizzaP('./../buzz.html').webpath).toBe('/buzz.html')
        expect(pizzaP('./../../pwl/buzz.html').webpath).toBe('/buzz.html')
        expect(pizzaP('/buzz.html').webpath).toBe('/buzz.html')
        expect(pizzaP('/subworld/pizza.html').webpath).toBe('/subworld/pizza.html')
    })

    test("Folders resolve to indexes or errors if missing", () => {
        main = LinkPeepLocator(lps)('testdata/pwl/')

        expect(main('.').type).toBe('html')
        expect(main('.').webpath).toBe('/')
        expect(main('.').relpath).toBe('testdata/pwl/index.html')
        expect(main('/subworld').type).toBe('404')
    })

    test("Can resolve sideways", () => {
        buzz = LinkPeepLocator(lps)('testdata/pwl/buzz.html')
        index = LinkPeepLocator(lps)('testdata/pwl/index.html')

        expect(buzz('index.html').relpath).toBe('testdata/pwl/index.html')
        expect(index('buzz.html').relpath).toBe('testdata/pwl/buzz.html')
        expect(buzz('./index.html').relpath).toBe('testdata/pwl/index.html')
        expect(index('./buzz.html').relpath).toBe('testdata/pwl/buzz.html')
    })

    test("Can resolve outward", () => {
        expect(buzz('..').type).toBe('404')
        expect(pizzaP('..').relpath).toBe('testdata/pwl/index.html')
    })

    test("Result includes fragment and query information", () => {
        expect(main('#identifiable').fragment).toBe('identifiable')
        expect(pizzaP('../?query=foo#').fragment).toBe('')
        expect(pizzaP('../?query=foo#bar').fragment).toBe('bar')
        expect(pizzaP('../?query=foo#bar').query).toBe('?query=foo')
    })

    test("Can't resolve missing fragments", () => {
        expect(main('#identifiable').result.type).toBe('okHtml')
        expect(pizzaP('../?query=foo#').result.type).toBe('okHtml')
        expect(pizzaP('../?query=foo#bar').result.type).toBe('err')
    })

}
