import { link, readFileSync } from "fs"
import { dirname } from "path"
import { FSPeep } from "./filePeeping"
import { PP, pprintProblem } from "./ppstuff.js"
import { PLink, LinkPeeps, LinkPeepLocator, PeepedLinkResolution, QF, LinkLocator, indeedHtml, PLinkLocable, Queried } from "./linkPeeping"
import { CursedDataGazer } from "./evilCursing"

export class PukableSlotPocket {

    lens
    rootLoc
    reprName
    #gazer
    #juiceLens
    #ownLocator
    #ownLink: PLink & Queried & { type: 'html' }
    #includedFromChain

    /** @type {Object<string, PukableSlotPocket>} */
    #ownSlurpMap = {}
    #ownSlotNames = []
    #ownSlotEnjoyers = []
    #ownStyleContent = []
    #targetFragment
    #resPath
    #frontbuf = []
    #backbuf = []

    static slurpDeclFromPattern = /^<!slurp [^<>]*from=['"]([^'"]+)['"][^<>]*>/
    static slurpDeclAsPattern = /^<!slurp [^<>]*as=['"]([^'"]+)['"][^<>]*>/
    static slotEnjoyerPattern = /<([a-z\-]+)\s[^<>]*slot="?([^<>"]+)"?[^<>]*>.*<\/\1>/g
    static getNamedTagPatterns = (name) => ({
        presence: new RegExp(`<${name}(?:\\s*>|\\s[^<>]*>).*</${name}\\s*>`, 's'),
        entry: new RegExp(`^<${name}(?:\\s*>|\\s[^<>]*>)`),
        exit: new RegExp(`</${name}\\s*>$`),
    })

    constructor(rootLoc: PLinkLocable, fromPath: string, includedFromChain = []) {

        this.rootLoc = rootLoc
        this.#ownLocator = rootLoc(fromPath)

        this.#ownLink = indeedHtml(this.#ownLocator('.'))
        this.reprName = `<PSP @="${this.#ownLink.relpath}">`

        const initStart = performance.now()

        this.#includedFromChain = includedFromChain

        const arrow = `\n|${PP.spaces(includedFromChain.length, '-')}>`
        process.stderr.write(`${arrow} ${this.reprName}...`)

        for (let b of this.#includedFromChain) {
            if (b.id == this.reprName) {
                let loopDescription = includedFromChain.map(c => c.id).join('->')
                pprintProblem(this.reprName, 0, `Circular dependency: ${loopDescription}->${this.reprName}`, true)
            }
        }

        if (this.#ownLink.result.type !== 'okHtml') {
            throw new ReferenceError(`${this.#ownLink.relpath} did not resolve to an HTML file.`)
        }

        const markupData = this.#ownLink.result.getData()
        this.#gazer = markupData.gazer

        if (this.#ownLink.fragment) {
            if (!("fragments" in markupData.lensNames) || !markupData.lensNames.fragments[this.#ownLink.fragment]) {
                throw new ReferenceError(
                    `${fromPath} refers to fragment ${this.#ownLink.fragment},` +
                    `but file only includes ${PP.o(markupData.fragmentNames)}`)
            }

            const lensName = markupData.lensNames.fragments[this.#ownLink.fragment]
            const lens = this.#gazer
        }

        this.lens = this.#ownLink.content.getLens(lensName).refocus({ creed: { slurpDecl: 'shun', styleTag: 'shun' } })

        if (!this.lens || !lensName) {
            link.content.summonBugs()
            pprintProblem(this.reprName, 0, `${link.content.id.description} is missing lens: ${lensName}.`, true)
        }

        this.slurpSubPockets()
        this.pocketOwnSlots()
        this.slurpSlotEnjoyers()
        this.slurpStyles()

        const initEnd = performance.now()
        process.stderr.write(`${arrow} Done (${(initEnd - initStart).toFixed(2)} ms).`)
    }

    get ownFilename() {
        return this.#ownLink.fsPath
    }

    get assocFilenames() {
        return [this.#ownLink.fsPath,
        ...Object.values(this.#ownSlurpMap).flatMap(x => x.assocFilenames),
        ]
    }

    slurpSubPockets() {
        const spsEnterPattern = '<slot-pocket-slurp '
        const spsExitPattern = '>'
        const slurpSigil = 'slurpDecl'

        const spses = this.lens.dichotomousJudgement(spsEnterPattern, spsExitPattern, slurpSigil)
        for (let { chars, endSourceLine } of spses) {
            let match;
            if (!(match = chars.match(PukableSlotPocket.slurpDeclFromPattern))) {
                pprintProblem(this.#ownLink.fullPath, endSourceLine, `Missing 'from' attribute in slurp tag.`, true)
            }
            else {
                let subLink;
                try {
                    subLink = LinkPeepLocator(this.#ownLocator, this.#ownLink.relpath, match[1])
                } catch (e) {
                    pprintProblem(this.#ownLink.fullPath, endSourceLine, `File '${match[1]}' not found: ${e}`, true, this.lens.takeSourceLines(endSourceLine, 3, 3))
                }

                let subPukable = new PukableSlotPocket(this.#ownLocator, subLink.relpath, '.', this.#includedFromChain.concat(this))

                if (!(match = chars.match(PukableSlotPocket.slurpDeclAsPattern))) {
                    pprintProblem(this.#ownLink.fullPath, endSourceLine, `Missing 'as' attribute in slurp tag.`, true)
                } else {
                    let asName = match[1]
                    this.#ownSlurpMap[asName] = subPukable
                }
            }
        }
        return
    }

    pocketOwnSlots() {
        const slotOpenPattern = /^<slot [^<>]*name=['"]([^'"]+)['"][^<>]*>/
        const slotClosePattern = /<\/slot[^<>]*>$/
        const slots = this.lens.dichotomousJudgement(slotOpenPattern, slotClosePattern, 'slotPocket')
        for (let { chars, endSourceLine } of slots) {
            let match
            if ((match = chars.match(slotOpenPattern)) && (match?.[1]?.length > 0)) {
                this.#ownSlotNames.push(match[1])
            } else {
                pprintProblem(this.#ownLink.fullPath, endSourceLine, `Missing 'name' attribute in slot tag.`, true)
            }
        }
    }

    slurpStyles() {
        const styleTags = this.lens.dichotomousJudgement('<style>', '</style>', 'styleTag')
        for (let { chars } of styleTags) {
            this.#ownStyleContent.push(chars)
        }
    }

    slurpSlotEnjoyers() {
        for (let tagName of (Object.keys(this.#ownSlurpMap))) {
            let { presence, entry, exit } = PukableSlotPocket.getNamedTagPatterns(tagName)
            let match;
            if (!(match = this.lens.image.match(presence))) {
                pprintProblem(this.#ownLink.fullPath, 1, `Lint: unused slurp <${tagName}>`, false)
                continue
            } else {
                const usages = this.lens.dichotomousJudgement(entry, exit, tagName)
                for (let { chars, endSourceLine } of usages) {
                    this.lens.replaceBySigil(tagName, this.#ownSlurpMap[tagName].blowChunks(), ['juice'])
                    const match = chars.matchAll(PukableSlotPocket.slotEnjoyerPattern) || []
                    let foundSlots = []
                    for (let m of match) {
                        let [slotEnjoyer, tagName, slotName] = m
                        foundSlots.push(slotName)
                        this.#ownSlotEnjoyers.push(slotEnjoyer)
                    }
                    const needs = [...this.#ownSlurpMap[tagName].slots.values()]
                    if (needs.some(n => !foundSlots.includes(n))) {
                        const missing = needs.filter(n => !foundSlots.includes(n)).map(s => `"${s}"`).join(', ')
                        pprintProblem(this.#ownLink.fullPath, endSourceLine, `${tagName} has unfilled slots: ${missing}.`, false)
                    }
                }
            }

        }
        return
    }

    get slots() {
        let own = new Set(this.#ownSlotNames)
        for (let ss of Object.values(this.#ownSlurpMap).flatMap(psp => psp.slots)) {
            own = own.union(ss)
        }

        return own
    }

    get slotEnjoyers() {
        return [...this.#ownSlotEnjoyers, ...Object.values(this.#ownSlurpMap).flatMap(psp => psp.slotEnjoyers)]
    }

    get styleContent() {
        return [...this.#ownStyleContent, ...Object.values(this.#ownSlurpMap).flatMap(psp => psp.styleContent)]
    }

    get slurps() {
        return Object.values(this.#ownSlurpMap).map(psp => psp.ownFilename)
    }

    blowChunks() {
        return this.lens.image
    }
}


if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest
    let fsp = FSPeep({ entrypoint: 'testdata/psp' })
    let links = LinkPeeps({ entrypoint: fsp })
    let psp1;

    test('Can construct PSP', () => {
        let link1 = LinkPeepLocator(links, 'testdata/psp', '.')
        expect("reason" in link1).toBe(false)
        psp1 = new PukableSlotPocket(link1 as (PLink & QF))
    })

    test('Pockets slurped; Pockets in comments not slurped', () => {
        // expect(psp1.slurps).toStrictEqual(['testdata/psp/inclusion.html'])
    })
}