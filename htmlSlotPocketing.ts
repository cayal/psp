import { link, readFileSync } from "fs"
import { dirname } from "path"
import { FSPeep } from "./filePeeping"
import { PP, pprintProblem } from "./ppstuff.js"
import { PLink, LinkPeeps, LinkPeepLocator, PeepedLinkResolution, QF, LinkLocator, indeedHtml, PLinkLocable, Queried } from "./linkPeeping"
import { CursedDataGazer, CursedLens } from "./evilCursing"

export class PukableSlotPocket {

    rootLoc
    reprName
    #gazer: CursedDataGazer
    #juiceLens: CursedLens
    #ownLocator
    #ownLink: PLink & Queried & { type: 'html' }
    #includedFromChain

    /** @type {Object<string, PukableSlotPocket>} */
    #ownSlurpMap: {[as: string]: PukableSlotPocket} = {}
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

    constructor(rootLoc: PLinkLocable, targetPath: string | (PLink & QF), includedFromChain = []) {

        this.rootLoc = rootLoc
        this.#ownLocator = typeof targetPath == 'string' ? rootLoc(targetPath) : rootLoc(targetPath.relpath)

        this.#ownLink = indeedHtml(typeof targetPath == 'string' ? this.#ownLocator('.') : targetPath)
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
                    `${targetPath} refers to fragment ${this.#ownLink.fragment},` +
                    `but file only includes ${PP.o(markupData.lensNames.fragments)}`)
            }

            const lensName = markupData.lensNames.fragments[this.#ownLink.fragment]
            this.#juiceLens = this.#gazer.getLens(lensName)
        } else if (markupData.hasBody) {
            this.#juiceLens = this.#gazer.getLens(markupData.lensNames.body)
        } else {
            this.#juiceLens = markupData.gazer.getLens(markupData.lensNames.wholeFile)
        }

        if (!this.#juiceLens) {
            this.#gazer.summonBugs()
            pprintProblem(this.reprName, 0, `${this.#gazer.id.description} is missing lens.`, true)
        }

        this.slurpSubPockets()
        this.pocketOwnSlots()
        this.slurpSlotSlippers()
        this.slurpStyles()

        const initEnd = performance.now()
        process.stderr.write(`${arrow} Done (${(initEnd - initStart).toFixed(2)} ms).`)
    }

    get ownFilename() {
        return this.#ownLink.relpath
    }

    get assocFilenames() {
        return [this.#ownLink.relpath,
        ...Object.values(this.#ownSlurpMap).flatMap(x => x.assocFilenames),
        ]
    }

    slurpSubPockets() {
        const spsEnterPattern = '<!slurp '
        const spsExitPattern = '>'
        const slurpSigil = PP.shortcode('slurpDecl')

        const spses = this.#juiceLens.dichotomousJudgement(spsEnterPattern, spsExitPattern, slurpSigil)
        for (let { chars, endSourceLine } of spses) {
            let match: RegExpMatchArray;
            if (!(match = chars.match(PukableSlotPocket.slurpDeclFromPattern))) {
                pprintProblem(this.#ownLink.relpath, endSourceLine, `Missing 'from' attribute in slurp tag.`, true)
            }
            else {
                let subLink = this.#ownLocator(match[1]);
                if ("reason" in subLink) {
                    pprintProblem(this.#ownLink.relpath, endSourceLine, `File '${match[1]}' not found: ${subLink.reason}`, true, this.#juiceLens.takeSourceLines(endSourceLine, 3, 3))
                }

                let subPukable = new PukableSlotPocket(this.rootLoc, subLink, this.#includedFromChain.concat(this))

                if (!(match = chars.match(PukableSlotPocket.slurpDeclAsPattern))) {
                    pprintProblem(this.#ownLink.relpath, endSourceLine, `Missing 'as' attribute in slurp tag.`, true)
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
        const slots = this.#juiceLens.dichotomousJudgement(slotOpenPattern, slotClosePattern, 'slotPocket')
        for (let { chars, endSourceLine } of slots) {
            let match
            if ((match = chars.match(slotOpenPattern)) && (match?.[1]?.length > 0)) {
                this.#ownSlotNames.push(match[1])
            } else {
                pprintProblem(this.#ownLink.relpath, endSourceLine, `Missing 'name' attribute in slot tag.`, true)
            }
        }
    }

    slurpStyles() {
        const styleTags = this.#juiceLens.dichotomousJudgement('<style>', '</style>', 'styleTag')
        for (let { chars } of styleTags) {
            this.#ownStyleContent.push(chars)
        }
    }

    slurpSlotSlippers() {
        for (let tagName of (Object.keys(this.#ownSlurpMap))) {
            let { presence, entry, exit } = PukableSlotPocket.getNamedTagPatterns(tagName)
            let match;
            if (!(match = this.#juiceLens.image.match(presence))) {
                pprintProblem(this.#ownLink.relpath, 1, `Lint: unused slurp <${tagName}>`, false)
                continue
            } else {
                const usages = this.#juiceLens.dichotomousJudgement(entry, exit, tagName)
                for (let { chars, endSourceLine } of usages) {
                    this.#juiceLens.replaceBySigil(tagName, this.#ownSlurpMap[tagName].blowChunks(), ['juice'])
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
                        pprintProblem(this.#ownLink.relpath, endSourceLine, `${tagName} has unfilled slots: ${missing}.`, false)
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
        return this.#juiceLens.image
    }
}


// @ts-ignore
if (import.meta.vitest) {
    // @ts-ignore
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