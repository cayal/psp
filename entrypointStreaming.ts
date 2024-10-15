import { PukableSlotPocket as PukableSlotPocket } from './htmlSlotPocketing';
import { FSPeep } from './filePeeping.js';
import { HData, LinkPeeps, LinkPeepLocator, PLink, PeepedLinks, QF, LinkLocator, indeedHtml, PLinkLocable } from './linkPeeping.js';
import { PP } from './ppstuff.js';

let ti = `<!doctype html>
<html>
<head></he<!--ad>-->ad>
<body class="somestuff">
<!-- Nothing of note right here to be honest -->
    <h1>Right here</h1>
    <template>
    <!-- yawn

    multiline -->
   This is not a comment. 
    <!---->This should exist.
    <!---> THis is...
        This is in the template
        Name: <slot name="foobar">This is sloot</slot>
    </template>
    <span slot="foobar">Cayal</span>
    <h2>Other stuff</h2>
</body>
</html>`

export class PukableEntrypoint {
    id
    bodyPreamble
    postBodyLens
    reloaderScript
    hostClose
    templateClose
    ownLink

    #gazer
    #bodyBarfer: PukableSlotPocket
    #bodyPartLensMap

    #link
    #preambleBarfer
    #emitNext = false
    #slotStack = []
    #slotterStack = []
    #backbuf = []
    #frontbuf = []
    #skips = []
    #deps = []
    #slurpFromPattern = /^<slurp-tags [^<>]*from=['"]([^'"]+)['"][^<>]*>/


    constructor(rootLoc: PLinkLocable, relpath: string, hostTagName = "psp", reloaderScript = '') {
        let ownLink = indeedHtml(rootLoc(relpath)('.'))

        this.id = Symbol(PP.shortcode(`@${ownLink.relpath}${ownLink.fragment || ''}|`))
        process.stderr.write(PP.styles.yellow + `\n--= ENTRYPOINT ${this.id.description} ==-` + PP.styles.none)

        if (ownLink.result.type !== 'okHtml') {
            throw new ReferenceError(`${ownLink.relpath} did not resolve to an HTML file.`)
        }

        this.ownLink = ownLink
        let markupData = ownLink.result.getData()
        if (!markupData.hasBody) {
            throw new TypeError(`${ownLink.relpath} must have a body in order to be used as an entrypoint.`)
        }

        this.#gazer = markupData.gazer
        this.#bodyPartLensMap = markupData.lensNames
        this.#bodyBarfer = new PukableSlotPocket(rootLoc, relpath)
        this.reloaderScript = reloaderScript
        this.bodyPreamble = `\n<${hostTagName}-host>\n    <template shadowrootmode="open">`
        this.templateClose = `\n    </template>\n`
        this.hostClose = `</${hostTagName}-host>\n`

        process.stderr.write('\n')
    }

    getAssociatedFilenames() {
        return [this.fullPath, ...this.#bodyBarfer.slurps]
    }

    traceDeps() {
        const con = this.#frontbuf.join('')
        let dbgLineNo = 1;
        let inComment;
        let i = 0;
        let match;

        while (i < con.length) {
            let cur = con.slice(i)

            if (cur.startsWith('\n')) {
                dbgLineNo += 1
                i += 1
                continue
            }

            if (inComment) {
                inComment = !cur.startsWith('-->')
                i += 1
                continue
            }

            if (match = cur.match(this.#slurpFromPattern)) {
                let subTarget = match[1].split("#")[0]
                let subPukable = new PukableSlotPocket(subTarget, [])
                if (this.#deps.includes(this.fullPath)) {
                    this.printTagProblem(dbgLineNo, `Circular dependency: ${this.#deps.join('->')}->${subPukable.getOwnFilename()}`, true)
                    return []
                }
                let subdeps = subPukable.slurpSubPockets()
                this.#deps.push(...subdeps)
                i += 1
                continue
            }

            i += 1
        }

        return [this.fullPath, ...this.#deps]
    }

    *blowChunks() {
        yield this.preBodyLens?.image || ''
        yield this.reloaderScript
        yield this.#bodyBarfer.styleContent.join('\n')
        yield this.bodyPreamble
        yield* this.#bodyBarfer.blowChunks()
        yield this.templateClose
        yield this.#bodyBarfer.slotEnjoyers.join('\n')
        yield this.hostClose
        yield this.postBodyLens?.image || ''
    }
}

if (import.meta.vitest) {
    const { test, assert, expect } = import.meta.vitest
    let pel;

    test("There's no time left. We must barely test this at all.", () => {
        const fst = FSPeep({ entrypoint: 'testdata/pwl' })
        const links = LinkPeeps({ entrypoint: fst })
        pel = new PukableEntrypoint(LinkPeepLocator(links, 'testdata/pwl', '/'))
    })
}