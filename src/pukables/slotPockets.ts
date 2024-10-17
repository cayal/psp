import { link, readFileSync } from "fs"
import { dirname } from "path"
import { FSPeep } from "../paths/filePeeping"
import { PP, pprintProblem } from "../../ppstuff.js"
import { PLink, LinkPeeps, LinkPeepLocator, PeepedLinkResolution, QF, LinkLocator, indeedHtml, PLinkLocable, Queried } from "../paths/linkPeeping"
import { CursedDataGazer, CursedLens } from "../textEditing/evilCurses"

export class PukableSlotPocket {

    rootLoc
    reprName
    slurpSigil: string
    wholeFileSlurpDecls: {startTruth: number, endTruth: number}[] = []
    #gazer: CursedDataGazer
    #juiceSigilName: string
    #juiceLens: CursedLens
    #wholeFileLens: CursedLens
    #ownLocator
    #ownLink: PLink & Queried & { type: 'html' }
    #includedFromChain

    /** @type {Object<string, PukableSlotPocket>} */
    #ownSlurpMap: {[as: string]: {
        sourceLine: number,
        pocket: PukableSlotPocket
    }} = {}
    #ownSlotNames = []
    #ownSlotSlippers: {slotName: string, tagName: string, markup: string}[] = []
    #ownStyleContent = []
    #validations: [number, string][] = []

    static slurpDeclFromPattern = /^<!slurp [^<>]*from=['"]([^'"]+)['"][^<>]*>/
    static slurpDeclAsPattern = /^<!slurp [^<>]*as=['"]([^'"]+)['"][^<>]*>/
    static slotEnjoyerPattern = /<([a-zA-Z0-9\-]+)\s[^<>]*slot="?([^<>"]+)"?[^<>]*>.*<\/\1>/g
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

        let juiceLensName
        if (this.#ownLink.fragment) {
            if (!("fragments" in markupData.lensNames) || !markupData.lensNames.fragments[this.#ownLink.fragment]) {
                throw new ReferenceError(
                    `${targetPath} refers to fragment ${this.#ownLink.fragment},` +
                    `but file only includes ${PP.o(markupData.lensNames.fragments)}`)
            }

            juiceLensName = markupData.lensNames.fragments[this.#ownLink.fragment]
        } else if (markupData.hasBody) {
            juiceLensName = markupData.lensNames.body
        } else {
            juiceLensName = markupData.lensNames.wholeFile
        }

        this.#juiceLens = this.#gazer.getLens(juiceLensName)
        this.#juiceSigilName = juiceLensName + '.Inner'
        this.#wholeFileLens = markupData.gazer.getLens(markupData.lensNames.wholeFile)

        if (!this.#juiceLens) {
            this.#gazer.summonBugs()
            pprintProblem(this.reprName, 0, `${this.#gazer.id.description} is missing lens ${juiceLensName}.`, true)
        }

        this.slurpSubPockets()
        this.pocketOwnSlots()
        this.slurpSlotSlippers()
        this.slurpStyles()

        const initEnd = performance.now()
        process.stderr.write(`${arrow} Done (${(initEnd - initStart).toFixed(2)} ms).\n`)
        for (let line of this.debugRepr()) {
            process.stderr.write('\n' + line)
        }
    }

    get ownFilename() {
        return this.#ownLink.relpath
    }

    get assocFilenames() {
        return [this.#ownLink.relpath,
        ...Object.values(this.#ownSlurpMap).flatMap(x => x.pocket.assocFilenames),
        ]
    }

    slurpSubPockets() {
        const slurpDeclPattern = /<!slurp [^>]*>/g
        this.slurpSigil = PP.shortcode('slurpDecl')

        const slurpDecls = this.#wholeFileLens.lensedCaptureAll(slurpDeclPattern)

        for (let { startTruth, endTruth, endSourceLine, groups } of slurpDecls) {
            this.#gazer.brandRange(this.slurpSigil, startTruth, endTruth)
            this.wholeFileSlurpDecls.push({startTruth, endTruth})
            let chars = groups[0]

            let match: RegExpMatchArray;
            if (!(match = chars.match(PukableSlotPocket.slurpDeclFromPattern))) {
                const vmsg = `Missing 'from' attribute in slurp tag.`
                pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                this.#validations.push([endSourceLine, vmsg])
            }
            else {
                let subLink = this.#ownLocator(match[1]);
                if ("reason" in subLink) {
                    const vmsg = `File '${match[1]}' not found: ${subLink.reason}`
                    pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, true, this.#gazer.takeLines(endSourceLine, 3, 3))
                    this.#validations.push([endSourceLine, 'File not found'])
                }

                let subPukable = new PukableSlotPocket(this.rootLoc, subLink, this.#includedFromChain.concat(this))

                if (!(match = chars.match(PukableSlotPocket.slurpDeclAsPattern))) {
                    const vmsg = `Missing 'as' attribute in slurp tag.`
                    pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                    this.#validations.push([endSourceLine, vmsg])
                } else {
                    let asName = match[1]

                    if (asName.match(/[A-Z]/) || !asName.includes('-')) {
                        const vmsg = `Lint: Custom tag names must be lowercase with 1+ hyphens: '${asName}'`
                        pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                        this.#validations.push([endSourceLine, vmsg])
                    }

                    this.#ownSlurpMap[asName] = {
                        sourceLine: endSourceLine,
                        pocket: subPukable
                    }
                }
            }
        }
        return
    }

    pocketOwnSlots() {
        const slotOpenPattern = /^<slot [^<>]*name=['"]([^'"]+)['"][^<>]*>/
        const slotClosePattern = /<\/slot[^<>]*>$/
        let slots;
        slots = this.#juiceLens.dichotomousJudgement(slotOpenPattern, slotClosePattern, 'slotPocket', true, 256, 256)
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
        for (let [tagName, { pocket, sourceLine }] of (Object.entries(this.#ownSlurpMap))) {
            let { presence, entry, exit } = PukableSlotPocket.getNamedTagPatterns(tagName)
            let match;
            if (!(match = this.#juiceLens.image.match(presence))) {
                const vmsg = `Lint: Unused slurp <${tagName}>`

                pprintProblem(this.#ownLink.relpath, sourceLine, vmsg, false, this.#gazer.takeLines(sourceLine, 2, 2))
                this.#validations.push([sourceLine, vmsg])
                continue
            } else {
                const usages = this.#juiceLens.dichotomousJudgement(entry, exit, tagName, true, 512, 512)

                for (let { chars, endSourceLine } of usages) {
                    this.#juiceLens.replaceBySigil(tagName, pocket.blowChunks(), [this.#juiceSigilName])
                    const match = chars.matchAll(PukableSlotPocket.slotEnjoyerPattern) || []
                    let foundSlots = []
                    for (let m of match) {
                        let [markup, tagName, slotName] = m
                        foundSlots.push(slotName)
                        this.#ownSlotSlippers.push({slotName, tagName, markup})
                    }

                    const needs = [...pocket.slots.values()]
                    if (needs.some(n => !foundSlots.includes(n))) {
                        const missing = needs.filter(n => !foundSlots.includes(n)).map(s => `"${s}"`).join(', ')
                        const vmsg = `${tagName} has unfilled slots: ${missing}.`
                        pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                        this.#validations.push([endSourceLine, vmsg])
                    }
                }
            }

        }

        return
    }

    get slots() {
        let own = []
        for (let subSlot of Object.values(this.#ownSlurpMap).flatMap(psp => psp.pocket.slots)) {
            if (own.includes(subSlot)) {
                this.#validations.push([1, `Slot name collision: ${subSlot}`])
            } else {
                own.push(subSlot)
            }
        }

        return own
    }

    get slotSlippers() {
        return [...this.#ownSlotSlippers, ...Object.values(this.#ownSlurpMap).flatMap(psp => psp.pocket.slotSlippers)]
    }

    get styleContent() {
        return [...this.#ownStyleContent, ...Object.values(this.#ownSlurpMap).flatMap(psp => psp.pocket.styleContent)]
    }

    get slurps() {
        return Object.values(this.#ownSlurpMap).map(psp => psp.pocket.ownFilename)
    }

    blowChunks() {
        return this.#juiceLens.image
    }
    
    *debugRepr(depth=0) {
        let ind = PP.spaces(depth * 2)
        let arrow = ''
        yield ind + arrow + PP.styles.pink + this.reprName + PP.styles.none

        for (let sl of this.#ownSlotSlippers) {
            yield ind + `${PP.spaces(arrow.length)}|- # (${sl.slotName}) => <${sl.tagName}>`
        }

        for (let [name, val] of Object.entries(this.#ownSlurpMap)) {
            yield ind + PP.styles.pink + PP.spaces(arrow.length) + '|-- ' + `<${name}> (<!slurp @ line ${val.sourceLine}>)` + PP.styles.none
            yield* val.pocket.debugRepr(depth+2)
        }


        for (let sn of this.#ownSlotNames) {
            yield ind + `${PP.spaces(arrow.length)} |- * [ ${sn} ]`
        }

        for (let [ln, msg] of this.#validations) {
            let exclamation = PP.styles.some('yellow', 'inverse') + ' ! ' + PP.styles.none
            yield PP.spaces(2 + (depth * 2)) + '|--' + exclamation + `->  ${PP.styles.yellow}${msg} @ line ${ln}\n`
        }


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