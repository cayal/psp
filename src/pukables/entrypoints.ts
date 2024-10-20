import { PukableSlotPocket as PukableSlotPocket } from './slotPockets';
import { FSPeep } from '../paths/filePeeping';
import { LinkPeeps, LinkPeepLocus, PLink, indeedHtml, PLinkLocus, Queried, HconLensMap } from '../paths/linkPeeping.js';
import { PP } from '../fmt/ppstuff.js';
import { CursedDataGazer } from '../textEditing/evilCurses';
import { L } from '../fmt/logging';

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
    reloaderScript: string
    hostOpen: string
    templateOpen: string
    templateClose: string
    hostClose: string
    ownLink: PLink & Queried & { type: 'html' }

    #gazer: CursedDataGazer
    #bodyBarfer: PukableSlotPocket
    #bodyPartLensMap: HconLensMap

    static slurpDeclExitPattern = /<!slurp\s[^<>]*>$/

    constructor(rootLocus: PLinkLocus, relpath: string, hostTagName = "psp", reloaderScript = '') {
        if (!relpath) {
            throw new TypeError('Missing relpath.')
        }

        let ownLink = indeedHtml(rootLocus(relpath)('.'))

        this.id = Symbol(PP.shortcode(`@${ownLink.relpath}${ownLink.fragment || ''}|`))
        L.log(PP.styles.yellow + `\n<| Building entrypoint: ${this.id.description}...` + PP.styles.none)

        if (ownLink.result.type !== 'okHtml') {
            throw new ReferenceError(`${ownLink.relpath} did not resolve to an HTML file.`)
        }

        this.ownLink = ownLink
        let markupData = ownLink.result
        if (!markupData.hasBody) {
            throw new TypeError(`${ownLink.relpath} must have a body in order to be used as an entrypoint.`)
        }

        this.#gazer = markupData.gazer
        this.#bodyPartLensMap = markupData.lensNames
        this.#bodyBarfer = new PukableSlotPocket(rootLocus, relpath)
        this.reloaderScript = reloaderScript
        this.hostOpen = `\n<${hostTagName}-host>\n`
        this.templateOpen = `\n<template shadowrootmode="open">\n`
        this.templateClose = `\n</template>\n`
        this.hostClose = `</${hostTagName}-host>\n`

        // #bodyBarfer brands its '<!slurp>' declarations (even outside the juice)
        // with its slurpSigil. PSPs will only blow chunks from the juice, while a 
        // PEP, when blowing chunks before and after the juice,  should still shun 
        // the slurps wherever they are.
        this.#gazer.getLens(this.#bodyPartLensMap.preBody)
            .dichotomousJudgement({
                entryPattern: '<!slurp',
                exitPattern: PukableEntrypoint.slurpDeclExitPattern,
                sigil: this.#bodyBarfer.slurpMarker,
                lookbehindN: 256
            })

        this.#gazer.getLens(this.#bodyPartLensMap.preBody)
            .refocus({ creed: { [this.#bodyBarfer.slurpMarker]: 'shun' } })

        this.#gazer.getLens(this.#bodyPartLensMap.postBody)
            .dichotomousJudgement({
                entryPattern: '<!slurp',
                exitPattern: PukableEntrypoint.slurpDeclExitPattern,
                sigil: this.#bodyBarfer.slurpMarker,
                lookbehindN: 256
            })

        this.#gazer.getLens(this.#bodyPartLensMap.postBody)
            .refocus({ creed: { [this.#bodyBarfer.slurpMarker]: 'shun' } })

        L.log('\n')

    }

    getAssociatedFilenames() {
        return [this.ownLink.relpath, ...this.#bodyBarfer.deepGetAssocFilenames()]
    }

    regurgitatePrebody() {
        let preBodyContent = this.#gazer.getLens(this.#bodyPartLensMap.preBody).image ?? ''
        const { hostOuterStyles, hostInnerStyles } = this.#bodyBarfer.deepGetStyleContent()
        let innerStyleTag = `
            <style>
            ${[...hostInnerStyles.values()].join('\n')}
            </style>
            `
        let outerStyleTag = `
            <style>
            ${[...hostOuterStyles.values()].join('\n')}
            </style>
            `
        if (preBodyContent.includes('</head>')) {
            let i = preBodyContent.indexOf('</head>');

            preBodyContent = [
                preBodyContent.slice(0, i),
                outerStyleTag,
                ...preBodyContent.slice(i, 0)
            ].join('')

        } else {
            preBodyContent += outerStyleTag
        }

        return { preBodyContent, innerStyleTag }
    }

    *blowChunks() {
        const { preBodyContent, innerStyleTag } = this.regurgitatePrebody()
        const postBody = this.#gazer.getLens(this.#bodyPartLensMap.postBody).image ?? ''

        if (preBodyContent) {
            yield preBodyContent
        }

        yield this.hostOpen

        yield this.templateOpen

        if (innerStyleTag) {
            yield innerStyleTag
        }

        yield* this.#bodyBarfer.blowChunks()

        yield this.templateClose

        yield* this.#bodyBarfer.deepGetPukableBubbles().map(x => x.digestedMarkup)

        yield this.hostClose

        yield this.reloaderScript

        if (postBody) {
            yield postBody
        }
    }

    *debugRepr() {
        yield PP.styles.some('blue') + '/ (' + this.id.description + ')' + PP.styles.none + '\n'
        for (let line of this.#bodyBarfer.debugRepr(1)) {
            yield* PP.styles.blue + '\n| ' + PP.styles.none + line
        }
        yield '\n' + PP.styles.blue + '\\' + Array(20).fill('_').join('') + PP.styles.none + '\n'
    }
}

// @ts-ignore
if (import.meta.vitest) {
    // @ts-ignore
    const { test, assert, expect } = import.meta.vitest
    let pel;

    test("There's no time left. We must barely test this at all.", () => {
        const fst = FSPeep({ entrypoint: 'testdata/pwl' })
        const links = LinkPeeps({ entrypoint: fst })
        pel = new PukableEntrypoint(LinkPeepLocus(links), 'testdata/pwl')
    })
}