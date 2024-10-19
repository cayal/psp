import { CursedDataGazer as CursedDataGazer, ShatteredMemory } from "../textEditing/evilCurses";
import { PP, pprintProblem } from "../fmt/ppstuff.js";
import { join, relative, resolve } from "path";
import { isAscii, isUtf8 } from "buffer";
import { FSPeep } from "./filePeeping";
import { L } from "../fmt/logging";
import { existsSync } from "fs";


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

type GazedMarkup = { gazer: CursedDataGazer, hasBody: boolean, lensNames: HconLensMap }

export type Queried = { type: PLink["type"] } & QF & {
    result: (
        | { type: 'okHtml' } & GazedMarkup
        | { type: 'okFile' } & FSPeep["contents"]
        | { type: 'err', reason: string }
    )
}

export function indeedHtml(q: Queried | { type: '404', reason: string }): PLink & Queried & { type: 'html' } {
    if (q.type === '404') {
        throw new ReferenceError(q.reason)
    }

    if (q.type === 'dir') {
        throw new ReferenceError(`Link result is a directory.`)
    }

    if (q.type === 'file') {
        throw new ReferenceError(`Link result is a non-HTML file.`)
    }

    return q as PLink & Queried & { type: 'html' }
}

function PLQ(from: Exclude<PLink, { type: 'dir' }>, respondingTo: QF): PLink & Queried {
    if (from.type === 'dir' || from.ogPeep.imp === 'd') {
        throw new TypeError('PLQ() | Not for directories. Examine callsites (this is a bug)')
    }

    let { query, fragment } = respondingTo
    let respond = { 'file': _getBuffer, 'html': _getGazedMarkup }[from.type]

    return {
        ...from,
        query,
        fragment,
        result: respond(query, fragment)
    }

    function _getBuffer(_query, _fragment) {
        // TODO respond to query/fragments

        return {
            type: 'okFile' as const,
            ...from.ogPeep.contents
        }
    }

    function _getGazedMarkup(_query, fragment) {
        if (from.ogPeep.contents.contentType !== 'text/html') {
            throw new TypeError('PLQ._getGazedMarkup() | Peep contentType is not text/html. Examine callsites (this is a bug)')
        }

        const textContent = from.ogPeep.contents.data
        console.log(from.ogPeep)
        const gazer = new CursedDataGazer(ShatteredMemory({ content: textContent }))
        const content = gazer.lens({ creed: { comment: 'shun' } }, 'default')
        content.dichotomousJudgement({
            entryPattern: '<!--',
            exitPattern: '-->',
            sigil: 'comment'
        })
        const hasBody = content.image.match(/<body.*>/gs) !== null

        let fragmentNames;
        if (!fragment) {
            fragmentNames = []
        }
        else {
            fragmentNames = [...content.image.matchAll(/id=['"]([^\t\n\f \/>"'=]+)['"]/gs)].map(m => m[1])

            if (!fragmentNames.includes(fragment)) {
                return { type: 'err' as const, reason: `Fragment ${fragment} not found in ${gazer.id.description}.` }
            }
        }

        let lensNames = HConLM(gazer, hasBody, fragmentNames)

        return {
            type: 'okHtml' as const,
            gazer,
            hasBody,
            lensNames
        }
    }
}


export type PLinkLocus = (atA: string) => PLinkLocator
export type PLinkLocator = (toB: string) => Queried | { type: '404', reason: string }
export type PeepedLinkResolution = { type: '404', reason: string } | (PLink)

export const LinkPeepLocus: (_: LinkPeeps)
    => PLinkLocus = ({ rootAbs, links }: LinkPeeps) => {
        if (!rootAbs || !rootAbs.startsWith('/')) { throw new TypeError(`LPResolveRelative(): root '${rootAbs}' is not an abspath.`) }

        return function makeLocator(atA: string) {
            const dbgInfo = `LPResolveRelative{rootAbs: ${rootAbs}}.atA(${atA})`

            atA = normalize(atA).target
            const itSaMe = (l: PLink) => (l.relpath == atA)

            if (!existsSync(atA)) {
                L.error(links)
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
                        return { type: '404' as const, reason: `Tried ${join(selfPoint.relpath, target)}` }
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
                        const rootRelative = relative(rootAbs, candidate)
                        if (rootRelative.startsWith('.')) {
                            return { type: '404' as const, reason: `Can't access files upward from root directory.` }
                        }
                        const asWebpath = '/' + rootRelative
                        return resolveAbsolute({ query, fragment, target: asWebpath })
                    }
                }
            }
        }
    }


export type HconLensMap = {
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
        const bodyOpenPattern = /<body\s*[^<>]*>/
        const bodyClosePattern = /<\/body\s*[^<>]*>/
        const bodySigil = uniquing('body')
        DL.dichotomousJudgement({
            entryPattern: new RegExp('^' + bodyOpenPattern.source),
            exitPattern: new RegExp(bodyClosePattern.source + '$'),
            sigil: bodySigil,
            encompass: true,
            lookaheadN: 1024,
            lookbehindN: 1024
        })
        visions.lens({ creed: { [`${bodySigil}.Inner`]: 'prosyletize' } }, bodySigil)
        retVal.body = bodySigil

        const { endTruth: preBodyEnd } = (DL.lensedCapture(bodyOpenPattern))
        const { startTruth: postBodyStart } = (DL.lensedCapture(bodyClosePattern))
        const prBS = 'pre' + bodySigil
        const poBS = 'post' + bodySigil
        visions.brandRange(prBS, 0, preBodyEnd)
        visions.brandRange(poBS, postBodyStart)
        visions.lens({ creed: { [prBS]: 'prosyletize' } }, prBS)
        visions.lens({ creed: { [poBS]: 'prosyletize' } }, poBS)
        retVal.preBody = prBS
        retVal.postBody = poBS
    }

    for (let frn of fragmentNames) {
        if (frn === '') { continue }

        const targetMatcher = new RegExp(`<([a-zA-Z\-]+)[^<>]+id=['"]${frn}['"][^<>]*>`, 'g') // sosumi
        const captures = visions.getLens('default').lensedCaptureAll(targetMatcher)

        if (!captures || !captures.length) {
            pprintProblem(1, `HConLensMap: ID '${frn}' not found. Probably a bug.`, true)
        }

        if (captures.length > 1) {
            pprintProblem(1, `Multiple tags with ID '${frn}'.`, true)
        }

        let { groups } = captures[0]
        const [tag, tagName] = groups

        const tfClosePattern = new RegExp(`</${tagName}[^<>]*>$`)
        const targetRanges = visions.getLens('default').dichotomousJudgement({
            entryPattern: tag,
            exitPattern: tfClosePattern,
            sigil: frn,
            encompass: true,
            lookbehindN: 256
        })
        if (!targetRanges || !targetRanges.length) {
            pprintProblem(null, `Tag with ID '${frn}' not found.`, true)
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
        expect(() => LinkPeepLocus(lps)('garbo')).toThrowError()

        pizzaP = LinkPeepLocus(lps)('testdata/pwl/subworld/pizza.html')
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
        main = LinkPeepLocus(lps)('testdata/pwl/')

        expect(main('.').type).toBe('html')
        expect(main('.').webpath).toBe('/')
        expect(main('.').relpath).toBe('testdata/pwl/index.html')
        expect(main('/subworld').type).toBe('404')
    })

    test("Can resolve sideways", () => {
        buzz = LinkPeepLocus(lps)('testdata/pwl/buzz.html')
        index = LinkPeepLocus(lps)('testdata/pwl/index.html')

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
