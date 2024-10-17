import { PukableSlotPocket as PukableSlotPocket } from './slotPockets';
import { FSPeep } from '../paths/filePeeping';
import { HData, LinkPeeps, LinkPeepLocator, PLink, PeepedLinks, QF, LinkLocator, indeedHtml, PLinkLocable, Queried, HconLensMap } from '../paths/linkPeeping.js';
import { PP, pprintProblem } from '../../ppstuff.js';
import { CursedDataGazer } from '../textEditing/evilCurses';

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
    id: symbol
    bodyPreamble: string
    reloaderScript: string
    templateClose: string
    hostClose: string
    ownLink: PLink & Queried & { type: 'html' }

    #gazer: CursedDataGazer
    #bodyBarfer: PukableSlotPocket
    #bodyPartLensMap: HconLensMap

    constructor(rootLoc: PLinkLocable, relpath: string, hostTagName = "psp", reloaderScript = '') {
        if (!relpath) {
            throw new TypeError('Missing relpath.')
        }

        let ownLink = indeedHtml(rootLoc(relpath)('.'))

        this.id = Symbol(PP.shortcode(`@${ownLink.relpath}${ownLink.fragment || ''}|`))
        process.stderr.write(PP.styles.yellow + `\n<| Building entrypoint: ${this.id.description}...` + PP.styles.none)

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
        
        // #bodyBarfer's slurp sigil refers to the <!slurp declaration. 
        // It should be shunned whether in the body, before, or after.
        for (let {startTruth, endTruth} of this.#bodyBarfer.wholeFileSlurpDecls) {
            this.#gazer.brandRange(this.#bodyBarfer.slurpSigil, startTruth, endTruth)
        }

        this.#gazer.getLens(this.#bodyPartLensMap.preBody).refocus({creed: {[this.#bodyBarfer.slurpSigil]: 'shun'}})
        this.#gazer.getLens(this.#bodyPartLensMap.postBody).refocus({creed: {[this.#bodyBarfer.slurpSigil]: 'shun'}})
        
        process.stderr.write('\n')

    }

    getAssociatedFilenames() {
        return [this.ownLink.relpath, ...this.#bodyBarfer.slurps]
    }

    *blowChunks() {
        const preBody = this.#gazer.getLens(this.#bodyPartLensMap.preBody).image ?? ''
        const postBody = this.#gazer.getLens(this.#bodyPartLensMap.postBody).image ?? ''

        yield preBody
        yield this.reloaderScript
        yield this.#bodyBarfer.styleContent.join('\n')
        yield this.bodyPreamble
        yield* this.#bodyBarfer.blowChunks()
        yield this.templateClose
        yield this.#bodyBarfer.slotSlippers.map(({markup})=>markup + '\n').join('')
        yield this.hostClose
        yield postBody
    }
    
    *debugRepr() {
        yield PP.styles.some('blue') + '/ (' +  this.id.description + ')' + PP.styles.none + '\n'
        for (let line of this.#bodyBarfer.debugRepr(1)) {
            yield* PP.styles.blue + '\n| ' + PP.styles.none + line
        }
        yield '\n' + PP.styles.blue + '\\' + Array(20).fill('_').join('') + PP.styles.none + '\n'
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